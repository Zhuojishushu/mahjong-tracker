-- ============================================================
-- 麻雀トラッカー v5 スキーマ変更（Phase 3.2）
-- - 役満賞を追加
--   あがった人が他3人から各20pt（1,000円）ずつ受け取る
--   ツモ・ロンの区別なし。Daily終了時に回数を入力する
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ============================================================

-- 役満賞の単価（1人あたり 20pt = 1,000円）
alter table rule_presets add column if not exists yakuman_pt int not null default 20;
update rule_presets set yakuman_pt = 20;

-- セッション×プレイヤーの役満回数
create table if not exists yakuman_awards (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  yakuman_count  int  not null default 0,
  updated_at     timestamptz default now(),
  unique(session_id, player_id)
);

-- RLS
alter table yakuman_awards enable row level security;
drop policy if exists "allow_all_yakuman_awards" on yakuman_awards;
create policy "allow_all_yakuman_awards" on yakuman_awards for all using (true) with check (true);
