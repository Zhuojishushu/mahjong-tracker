-- ============================================================
-- 麻雀トラッカー: 新規プロジェクト構築用 一括スキーマ
-- schema.sql → schema_v2.sql → schema_v3.sql を正しい順で結合したもの
-- Supabase を作り直したとき、SQL Editor にこれ1枚を貼って Run すればOK
-- （既存プロジェクトへの追加マイグレーションは従来どおり schema_vX.sql を使う）
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>> schema.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 麻雀トラッカー DB スキーマ
-- Supabase の SQL Editor に丸ごと貼り付けて Run してください
-- ============================================================

-- 参加者
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text default '#888888',
  created_at  timestamptz default now()
);

-- ルール設定（履歴を残せるよう複数行可、最新の active=true を使う）
create table if not exists rule_presets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  starting_points int  not null default 26000,   -- 持ち点
  return_points   int  not null default 30000,   -- 返し点
  uma_2nd         int  not null default 5,       -- 2着ウマ
  uma_1st         int  not null default 10,      -- 1着ウマ
  yen_per_1000pt  int  not null default 50,      -- 1,000点あたりの円
  yakitori_yen    int  not null default 100,     -- 焼き鳥チップ1枚の円
  active          bool not null default true,
  created_at      timestamptz default now()
);

-- セッション（=Daily単位、開催日ごと）
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  played_on   date not null default current_date,
  venue       text,
  rule_id     uuid references rule_presets(id),
  closed      bool not null default false,        -- Daily締めフラグ
  note        text,
  created_at  timestamptz default now()
);

-- 1半荘の結果
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  game_no     int  not null,                       -- セッション内の連番
  created_at  timestamptz default now()
);

-- 各プレイヤーの1半荘の成績
create table if not exists game_results (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references games(id) on delete cascade,
  player_id      uuid not null references players(id),
  raw_score      int  not null,                    -- 素点（終局時の持ち点）
  rank           int  not null,                    -- 1〜4
  final_points   numeric(6,1) not null,            -- ウマオカ込みの最終ポイント（千点単位）
  tobi           bool not null default false,      -- トビ有無
  yakitori       bool not null default false,      -- 焼き鳥
  unique(game_id, player_id)
);

-- 便利ビュー：プレイヤー別 全期間サマリ
create or replace view v_player_stats as
select
  p.id                                        as player_id,
  p.name,
  count(gr.id)                                as games_played,
  coalesce(sum(gr.final_points), 0)           as total_points,
  coalesce(avg(gr.final_points), 0)::numeric(6,2) as avg_points,
  coalesce(avg(gr.rank), 0)::numeric(4,2)     as avg_rank,
  coalesce(sum(case when gr.rank=1 then 1 else 0 end), 0) as first_count,
  coalesce(sum(case when gr.rank=2 then 1 else 0 end), 0) as second_count,
  coalesce(sum(case when gr.rank=3 then 1 else 0 end), 0) as third_count,
  coalesce(sum(case when gr.rank=4 then 1 else 0 end), 0) as fourth_count,
  coalesce(sum(case when gr.tobi then 1 else 0 end), 0)   as tobi_count,
  coalesce(sum(case when gr.yakitori then 1 else 0 end), 0) as yakitori_count
from players p
left join game_results gr on gr.player_id = p.id
group by p.id, p.name;

-- 初期ルール挿入（テンマさんのローカルルール）
insert into rule_presets (name, starting_points, return_points, uma_2nd, uma_1st, yen_per_1000pt, yakitori_yen, active)
select '仲間内ローカル', 26000, 30000, 5, 10, 50, 100, true
where not exists (select 1 from rule_presets where active = true);

-- RLS: 身内専用なので一旦全許可（後で絞れる）
alter table players       enable row level security;
alter table rule_presets  enable row level security;
alter table sessions      enable row level security;
alter table games         enable row level security;
alter table game_results  enable row level security;

-- anon でも CRUD 可（身内限定URLを共有して使う前提）
drop policy if exists "allow_all_players"      on players;
drop policy if exists "allow_all_rule_presets" on rule_presets;
drop policy if exists "allow_all_sessions"     on sessions;
drop policy if exists "allow_all_games"        on games;
drop policy if exists "allow_all_game_results" on game_results;

create policy "allow_all_players"      on players      for all using (true) with check (true);
create policy "allow_all_rule_presets" on rule_presets for all using (true) with check (true);
create policy "allow_all_sessions"     on sessions     for all using (true) with check (true);
create policy "allow_all_games"        on games        for all using (true) with check (true);
create policy "allow_all_game_results" on game_results for all using (true) with check (true);


-- >>>>>>>>>>>>>>>>>>>> schema_v2.sql >>>>>>>>>>>>>>>>>>>>
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
  array_agg(a.player_id order by a.created_at) as player_ids,
  array_agg(p.name      order by a.created_at) as player_names,
  min(a.created_at) as first_signup_at
from availability a
join players p on p.id = a.player_id
group by available_on
order by available_on;

-- RLS（既存）
alter table availability enable row level security;
drop policy if exists "allow_all_availability" on availability;
create policy "allow_all_availability" on availability for all using (true) with check (true);


-- >>>>>>>>>>>>>>>>>>>> schema_v3.sql >>>>>>>>>>>>>>>>>>>>
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


