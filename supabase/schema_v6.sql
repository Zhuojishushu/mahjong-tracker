-- ============================================================
-- 麻雀トラッカー v6 スキーマ変更（Phase 3.3）
-- - 暦年ごとの成績集計ビュー
-- - 順位点の配点を設定可能に
-- - 管理者ロール（ルール設定を管理者限定にするため）
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ============================================================

-- 管理者フラグ
alter table players add column if not exists is_admin boolean not null default false;

-- 運営者（テンマさん）を管理者にする
update players set is_admin = true where name = 'TAKUMI';

-- 順位点の配点（Mリーグのウマを借りた独自指標。設定画面から変更できる）
alter table rule_presets add column if not exists rank_pt_1st int not null default 30;
alter table rule_presets add column if not exists rank_pt_2nd int not null default 10;
alter table rule_presets add column if not exists rank_pt_3rd int not null default -10;
alter table rule_presets add column if not exists rank_pt_4th int not null default -30;

-- 暦年ごとの成績集計
-- total_points は 素点 + ウマ + オカ（一発賞・役満賞は日ごとの精算なので含めない）
create or replace view v_season_stats as
select
  extract(year from s.played_on)::int              as season,
  p.id                                              as player_id,
  p.name                                            as name,
  count(gr.id)                                      as games_played,
  coalesce(sum(gr.final_points), 0)                 as total_points,
  sum(case when gr.rank = 1 then 1 else 0 end)      as first_count,
  sum(case when gr.rank = 2 then 1 else 0 end)      as second_count,
  sum(case when gr.rank = 3 then 1 else 0 end)      as third_count,
  sum(case when gr.rank = 4 then 1 else 0 end)      as fourth_count,
  sum(case when gr.tobi then 1 else 0 end)          as hako_count,
  coalesce(avg(gr.rank), 0)::numeric(4,2)           as avg_rank
from game_results gr
join games    g on g.id = gr.game_id
join sessions s on s.id = g.session_id
join players  p on p.id = gr.player_id
group by 1, 2, 3;
