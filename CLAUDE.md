# 麻雀トラッカー プロジェクト

## 概要
仲間内麻雀の **参加者管理／カレンダー参加申込／半荘ごとの結果記録／Daily精算／全期間ランキング** を一括管理する Web アプリ。

## 技術スタック
- **フロント**: HTML + Vanilla JS（ビルド不要・SPA・ハッシュルーター）
- **DB**: Supabase（プロジェクト名: `mahjong-tracker`）
- **ホスティング**: GitHub Pages（Publicリポジトリ）
- **認証**: 名前+4桁PIN（SHA-256ハッシュ・localStorage保存）

## 公開URL
https://zhuojishushu.github.io/mahjong-tracker/

## GitHub
https://github.com/Zhuojishushu/mahjong-tracker（Public）

## ローカルルール（運営者の麻雀仲間）
- 持ち点: 26,000 / 返し点: 30,000
- ウマ: 5-10（1着+10 / 2着+5 / 3着-5 / 4着-10）
- オカ: +16pt（1着総取り）
- レート: 1,000点 = 50円
- **チップ精算**: 焼き鳥/一発/役満を区別せず「チップ」として一本化
  - チップ1枚 = 50円
  - 半荘ごとではなく、**Daily終了時に各自の増減を一括入力**
- トビ: 記録のみ（賞なし）
- 日付制限: なし（成立後いつでも入力可能）

## ファイル構成
```
mahjong-tracker/
├── index.html
├── css/style.css
├── js/
│   ├── config.js        # Supabase接続情報
│   ├── auth.js          # PIN認証（IIFE）
│   └── app.js           # 本体（SPA・全画面・スコア計算）
├── supabase/
│   ├── schema.sql       # 初回スキーマ
│   ├── schema_v2.sql    # PINログイン・カレンダー（Phase 2a）
│   └── schema_v3.sql    # チップ精算刷新
└── README.md
```

## 機能フェーズ
- ✅ **Phase 1**: 基本機能（参加者・セッション・半荘記録・ランキング）
- ✅ **Phase 2a**: PINログイン・月カレンダー参加申込・4人成立自動セッション生成
- ✅ **Phase 2a+**: チップ精算をDaily終了入力に統一・プロフィール変更機能
- ⏳ **Phase 2b**: LINE通知（4人成立時に4人へ自動通知）

## 主要画面
1. **🏠 ホーム** - 直近の成立予定・自分の参加申込
2. **📅 カレンダー** - 月グリッド（過去月も閲覧可）／日付タップで詳細パネル
3. **👥 参加者** - 一覧（新規追加は各自の新規登録から）
4. **🏆 ランキング** - 全期間の通算成績
5. **⚙️ 設定** - 自分のプロフィール変更＋ルール設定

## データ更新フロー
1. ユーザーが新規登録 → `players` 追加
2. カレンダーで参加申込 → `availability` 追加
3. 4人揃った瞬間 → `sessions` 自動生成（`confirmed_at` セット）
4. 成立日のカードから半荘入力 → `games` + `game_results` 追加
5. Daily終了時 → `daily_chips` で各自のチップ増減を入力
6. Daily締めボタン → `sessions.closed = true`

## 運営者
- 麻雀アプリの運営者は **テンマ** さん（=このGitHubアカウントの所有者・Zhuojishushu）
- 仲間内（10名程度）に向けて配布予定
- 現在ドラフト版・トライアル準備中

## 開発上の注意
- **既存ファイルを編集する際は必ず Read してから Edit**
- 新しいスキーマ変更時は `supabase/schema_vX.sql` として追加し、ユーザーに手動で Supabase SQL Editor で実行してもらう
- GitHub push は ユーザー認証情報をキーチェーンから取得して自動化済み（`git push -u origin main`）
- GitHub Pages の反映には1〜2分かかる → 動作確認時は強制リロード（⌘+Shift+R）を案内
- ローカルストレージキー: `mj_auth_v1`（ログイン情報）
