-- ============================================================
-- 麻雀トラッカー v8 スキーマ変更（Phase 3.5）
-- 掲示板（全体用＋卓の参加者専用）
--  - 投稿・閲覧ともサーバー側でPINを検証する
--  - 卓別掲示板はその日の参加者しか読めない
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ============================================================

create table if not exists board_posts (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('global', 'session')),
  session_id  uuid references sessions(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  -- 卓別は session_id 必須、全体は session_id なし
  constraint board_scope_check check (
    (scope = 'session' and session_id is not null) or
    (scope = 'global'  and session_id is null)
  )
);
create index if not exists idx_board_global  on board_posts (created_at desc) where scope = 'global';
create index if not exists idx_board_session on board_posts (session_id, created_at desc);

-- 直接の読み書きは禁止（すべてRPC経由）
alter table board_posts enable row level security;
drop policy if exists "allow_all_board_posts" on board_posts;

-- ------------------------------------------------------------
-- 本人確認：PINが一致する player_id を返す
-- ------------------------------------------------------------
create or replace function mj_assert_member(p_player_id uuid, p_pin_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from players where id = p_player_id and pin_hash = p_pin_hash) then
    raise exception 'ログインし直してください';
  end if;
end $$;

-- その日の参加者かどうか
create or replace function mj_is_session_member(p_player_id uuid, p_session_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1
    from sessions s
    join availability a on a.available_on = s.played_on
    where s.id = p_session_id and a.player_id = p_player_id
  );
$$;

-- ------------------------------------------------------------
-- 投稿の取得
-- ------------------------------------------------------------
create or replace function mj_board_list(
  p_player_id uuid, p_pin_hash text, p_scope text, p_session_id uuid default null)
returns table (id uuid, player_id uuid, author text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  if p_scope = 'session' then
    if not mj_is_session_member(p_player_id, p_session_id) then
      raise exception 'この卓の参加者しか閲覧できません';
    end if;
    return query
      select b.id, b.player_id, p.name, b.body, b.created_at
      from board_posts b join players p on p.id = b.player_id
      where b.scope = 'session' and b.session_id = p_session_id
      order by b.created_at;
  else
    return query
      select b.id, b.player_id, p.name, b.body, b.created_at
      from board_posts b join players p on p.id = b.player_id
      where b.scope = 'global'
      order by b.created_at desc
      limit 100;
  end if;
end $$;

-- ------------------------------------------------------------
-- 投稿する
-- ------------------------------------------------------------
create or replace function mj_board_post(
  p_player_id uuid, p_pin_hash text, p_scope text, p_body text, p_session_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  if btrim(coalesce(p_body, '')) = '' then
    raise exception '本文を入力してください';
  end if;
  if char_length(btrim(p_body)) > 1000 then
    raise exception '本文は1000文字までです';
  end if;
  if p_scope = 'session' then
    if not mj_is_session_member(p_player_id, p_session_id) then
      raise exception 'この卓の参加者しか書き込めません';
    end if;
    insert into board_posts (scope, session_id, player_id, body)
    values ('session', p_session_id, p_player_id, btrim(p_body));
  else
    insert into board_posts (scope, session_id, player_id, body)
    values ('global', null, p_player_id, btrim(p_body));
  end if;
end $$;

-- ------------------------------------------------------------
-- 削除（自分の投稿、または管理者）
-- ------------------------------------------------------------
create or replace function mj_board_delete(p_player_id uuid, p_pin_hash text, p_post_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_admin boolean;
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  select player_id into v_owner from board_posts where id = p_post_id;
  if v_owner is null then raise exception '投稿が見つかりません'; end if;
  select is_admin into v_admin from players where id = p_player_id;
  if v_owner <> p_player_id and not coalesce(v_admin, false) then
    raise exception '自分の投稿しか削除できません';
  end if;
  delete from board_posts where id = p_post_id;
end $$;

grant execute on function mj_board_list(uuid, text, text, uuid)         to anon, authenticated;
grant execute on function mj_board_post(uuid, text, text, text, uuid)   to anon, authenticated;
grant execute on function mj_board_delete(uuid, text, uuid)             to anon, authenticated;
