-- ============================================================
-- 麻雀トラッカー v9 スキーマ変更（Phase 3.6 前半）
-- スマホへの通知（Web Push）の受け取り側
--  - 端末ごとの購読情報を保存する
--  - 通知の重複送信を防ぐフラグをセッションに追加
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ============================================================

-- 端末ごとの購読情報（1人が複数端末を登録できる）
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_player on push_subscriptions (player_id);

alter table push_subscriptions enable row level security;
drop policy if exists "allow_all_push_subscriptions" on push_subscriptions;
-- ポリシーを置かない＝アプリからの直接アクセスは不可（RPCとEdge Function経由のみ）

-- 成立通知を送ったかどうか（重複送信の防止）
alter table sessions add column if not exists notified_at timestamptz;

-- ------------------------------------------------------------
-- 通知の登録・解除（本人確認つき）
-- ------------------------------------------------------------
create or replace function mj_push_subscribe(
  p_player_id uuid, p_pin_hash text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  insert into push_subscriptions (player_id, endpoint, p256dh, auth)
  values (p_player_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set player_id = excluded.player_id,
        p256dh    = excluded.p256dh,
        auth      = excluded.auth,
        created_at = now();
end $$;

create or replace function mj_push_unsubscribe(
  p_player_id uuid, p_pin_hash text, p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  delete from push_subscriptions
  where endpoint = p_endpoint and player_id = p_player_id;
end $$;

-- この端末が登録済みかどうか
create or replace function mj_push_status(
  p_player_id uuid, p_pin_hash text, p_endpoint text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform mj_assert_member(p_player_id, p_pin_hash);
  return exists (
    select 1 from push_subscriptions
    where endpoint = p_endpoint and player_id = p_player_id);
end $$;

grant execute on function mj_push_subscribe(uuid, text, text, text, text) to anon, authenticated;
grant execute on function mj_push_unsubscribe(uuid, text, text)           to anon, authenticated;
grant execute on function mj_push_status(uuid, text, text)                to anon, authenticated;
