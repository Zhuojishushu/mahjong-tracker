-- ============================================================
-- 麻雀トラッカー v4 スキーマ変更（Phase 3.1）
-- - 半荘入力を「トップ選択 ＋ 2〜4位の±申告」方式に変更
--   （素点ではなく、五捨六入後の点数を保持する）
-- - 一発賞を「1枚あたりのpt」で管理（1枚 = 5pt = 250円）
-- Supabase SQL Editor で Run してください
-- ※ アプリのデプロイより先に実行すること
-- ============================================================

-- 素点を保持しなくなるため raw_score を任意項目にし、申告値 base_pt を追加
alter table game_results alter column raw_score drop not null;
alter table game_results add column if not exists base_pt numeric(5,1);

-- 既存データがあれば素点から base_pt に移行（1位はオカ込みの点数に換算）
update game_results gr
set base_pt = round(
      (gr.raw_score - rp.return_points) / 1000.0
      + case when gr.rank = 1
             then (rp.return_points - rp.starting_points) * 4 / 1000.0
             else 0 end
    , 1)
from rule_presets rp
where rp.active = true
  and gr.base_pt is null
  and gr.raw_score is not null;

-- 一発賞：チップ1枚あたりのpt（1pt = yen_per_1000pt 円なので 5pt = 250円）
alter table rule_presets add column if not exists ippatsu_pt int not null default 5;
update rule_presets set ippatsu_pt = 5;

-- 旧 chip_yen は使用しなくなる（列は互換のため残す）
