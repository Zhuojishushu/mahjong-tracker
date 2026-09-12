-- ============================================================
-- 麻雀トラッカー v7 スキーマ変更（Phase 3.4）
-- 権限をDB側で強制する
--  - PINハッシュをブラウザから読めなくする（照合をサーバー側へ）
--  - 参加者の削除・PINリセット・ルール変更を管理者のPIN検証つきに
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ※ 実行後は全員が一度ログインし直す必要があります
-- ============================================================

-- ------------------------------------------------------------
-- 1. PINハッシュを含まない公開用ビュー
--    （ビューは所有者権限で動くため players のRLSを迂回できる）
-- ------------------------------------------------------------
create or replace view players_public as
select id, name, is_admin, created_at from players;

grant select on players_public to anon, authenticated;

-- ------------------------------------------------------------
-- 2. ログイン・新規登録
-- ------------------------------------------------------------
create or replace function mj_login(p_name text, p_pin_hash text)
returns table (id uuid, name text, is_admin boolean)
language sql security definer set search_path = public as $$
  select p.id, p.name, p.is_admin
  from players p
  where p.name = p_name and p.pin_hash = p_pin_hash;
$$;

create or replace function mj_register(p_name text, p_pin_hash text)
returns table (id uuid, name text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception '名前を入力してください';
  end if;
  if exists (select 1 from players where name = p_name) then
    raise exception '同じ名前が既に登録されています';
  end if;
  insert into players (name, pin_hash) values (btrim(p_name), p_pin_hash)
  returning players.id into v_id;
  return query select p.id, p.name, p.is_admin from players p where p.id = v_id;
end $$;

-- ------------------------------------------------------------
-- 3. 自分のプロフィール更新（現在のPINで本人確認）
-- ------------------------------------------------------------
create or replace function mj_update_profile(
  p_player_id uuid, p_pin_hash text, p_new_name text, p_new_pin_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from players where id = p_player_id and pin_hash = p_pin_hash) then
    raise exception '現在のPINが違います';
  end if;
  if p_new_name is not null and exists (
    select 1 from players where name = p_new_name and id <> p_player_id) then
    raise exception '同じ名前が既に登録されています';
  end if;
  update players set
    name     = coalesce(nullif(btrim(p_new_name), ''), name),
    pin_hash = coalesce(p_new_pin_hash, pin_hash)
  where id = p_player_id;
end $$;

-- ------------------------------------------------------------
-- 4. 管理者の確認
-- ------------------------------------------------------------
create or replace function mj_assert_admin(p_admin_id uuid, p_admin_pin_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from players
    where id = p_admin_id and pin_hash = p_admin_pin_hash and is_admin) then
    raise exception '管理者の権限がありません';
  end if;
end $$;

-- 管理者：参加者の削除
create or replace function mj_admin_delete_player(
  p_admin_id uuid, p_admin_pin_hash text, p_target_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_admin(p_admin_id, p_admin_pin_hash);
  if p_target_id = p_admin_id then
    raise exception '自分自身は削除できません';
  end if;
  if exists (select 1 from game_results where player_id = p_target_id) then
    raise exception 'この人には試合記録があるため削除できません';
  end if;
  delete from players where id = p_target_id;
end $$;

-- 管理者：他人のPINリセット
create or replace function mj_admin_reset_pin(
  p_admin_id uuid, p_admin_pin_hash text, p_target_id uuid, p_new_pin_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_admin(p_admin_id, p_admin_pin_hash);
  update players set pin_hash = p_new_pin_hash where id = p_target_id;
end $$;

-- 管理者：ルール変更
create or replace function mj_admin_update_rule(
  p_admin_id uuid, p_admin_pin_hash text, p_rule jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_admin(p_admin_id, p_admin_pin_hash);
  update rule_presets set
    starting_points = coalesce((p_rule->>'starting_points')::int, starting_points),
    return_points   = coalesce((p_rule->>'return_points')::int,   return_points),
    uma_1st         = coalesce((p_rule->>'uma_1st')::int,         uma_1st),
    uma_2nd         = coalesce((p_rule->>'uma_2nd')::int,         uma_2nd),
    yen_per_1000pt  = coalesce((p_rule->>'yen_per_1000pt')::int,  yen_per_1000pt),
    ippatsu_pt      = coalesce((p_rule->>'ippatsu_pt')::int,      ippatsu_pt),
    yakuman_pt      = coalesce((p_rule->>'yakuman_pt')::int,      yakuman_pt),
    rank_pt_1st     = coalesce((p_rule->>'rank_pt_1st')::int,     rank_pt_1st),
    rank_pt_2nd     = coalesce((p_rule->>'rank_pt_2nd')::int,     rank_pt_2nd),
    rank_pt_3rd     = coalesce((p_rule->>'rank_pt_3rd')::int,     rank_pt_3rd),
    rank_pt_4th     = coalesce((p_rule->>'rank_pt_4th')::int,     rank_pt_4th)
  where active = true;
end $$;

grant execute on function mj_login(text, text)                             to anon, authenticated;
grant execute on function mj_register(text, text)                          to anon, authenticated;
grant execute on function mj_update_profile(uuid, text, text, text)        to anon, authenticated;
grant execute on function mj_admin_delete_player(uuid, text, uuid)         to anon, authenticated;
grant execute on function mj_admin_reset_pin(uuid, text, uuid, text)       to anon, authenticated;
grant execute on function mj_admin_update_rule(uuid, text, jsonb)          to anon, authenticated;

-- ------------------------------------------------------------
-- 5. 直接の読み書きを禁止する
--    players と rule_presets はRPC経由でしか変更できなくなる
-- ------------------------------------------------------------
drop policy if exists "allow_all_players" on players;
-- players には select ポリシーも置かない（読み取りは players_public 経由）

drop policy if exists "allow_all_rule_presets" on rule_presets;
create policy "read_rule_presets" on rule_presets for select using (true);

-- 対局データ（sessions / games / game_results / availability /
-- daily_chips / yakuman_awards）は、参加者が自由に書き込む必要があるため
-- 現状のまま全許可とする。本格的な制限には利用者ごとの認証基盤が必要。
