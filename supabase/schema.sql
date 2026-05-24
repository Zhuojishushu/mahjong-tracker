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
