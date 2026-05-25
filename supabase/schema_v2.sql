-- ============================================================
-- 麻雀トラッカー v2 スキーマ追加（Phase 2a）
-- - PINログイン
-- - カレンダー参加申込
-- Supabase SQL Editor で Run してください
-- ============================================================

-- プレイヤーに PIN を追加（4桁・SHA-256 ハッシュで保存）
alter table players add column if not exists pin_hash text;

-- 既存の「テスト登録」プレイヤーを一旦削除（PIN設定なしのため）
delete from players where pin_hash is null;

-- 参加可能日（誰がいつ空いているか）
create table if not exists availability (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players(id) on delete cascade,
  available_on  date not null,
  created_at    timestamptz default now(),
  unique(player_id, available_on)
);
create index if not exists idx_availability_date on availability(available_on);

-- セッションに「成立済み」フラグと「会場メモ」追加
alter table sessions add column if not exists confirmed_at timestamptz;

-- セッションに「誰が入力した試合か」を残す
alter table games add column if not exists entered_by uuid references players(id);

-- 集計ビュー：日付別の参加申込状況
create or replace view v_availability_summary as
select
  available_on,
  count(*) as signup_count,
  array_agg(player_id order by created_at) as player_ids,
  array_agg(p.name order by a.created_at) as player_names,
  min(a.created_at) as first_signup_at
from availability a
join players p on p.id = a.player_id
group by available_on
order by available_on;

-- RLS（既存）
alter table availability enable row level security;
drop policy if exists "allow_all_availability" on availability;
create policy "allow_all_availability" on availability for all using (true) with check (true);
