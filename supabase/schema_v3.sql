-- ============================================================
-- 麻雀トラッカー v3 スキーマ追加（チップ精算の刷新）
-- - 焼き鳥/一発/役満を区別せず「チップ枚数」で統一
-- - チップ単価: 1枚 50円
-- - Daily終了時に各自のチップ増減を入力
-- ============================================================

-- rule_presets: yakitori_yen → chip_yen にリネーム、デフォルト50円
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='rule_presets' and column_name='yakitori_yen') then
    alter table rule_presets rename column yakitori_yen to chip_yen;
  end if;
end $$;
update rule_presets set chip_yen = 50;
alter table rule_presets alter column chip_yen set default 50;

-- daily_chips: セッション×プレイヤーのチップ増減（最終枚数 - 初期枚数）
create table if not exists daily_chips (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  chip_net    int  not null default 0,
  updated_at  timestamptz default now(),
  unique(session_id, player_id)
);

-- RLS
alter table daily_chips enable row level security;
drop policy if exists "allow_all_daily_chips" on daily_chips;
create policy "allow_all_daily_chips" on daily_chips for all using (true) with check (true);
