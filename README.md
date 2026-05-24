# 🀄 麻雀トラッカー

仲間内の麻雀の **参加者管理／半荘ごとの結果記録／Daily精算／全期間ランキング** を一括管理する Web アプリ。

- **フロント**: HTML + Vanilla JS（ビルド不要）
- **DB / バックエンド**: Supabase（無料枠で十分）
- **ホスティング**: GitHub Pages（無料）
- **認証**: なし（身内限定URL共有方式）

---

## ⚙️ 初期セットアップ（30分で完了）

### 1. Supabase プロジェクトを作る

1. https://supabase.com にログイン
2. 「New Project」→ プロジェクト名（例: `mahjong-tracker`）、リージョン: Tokyo、DBパスワードを設定
3. プロジェクト作成完了まで2分待つ

### 2. DB スキーマを作る

1. Supabase ダッシュボード左メニュー → **SQL Editor**
2. `supabase/schema.sql` の中身を全部コピペ → **Run**
3. 「Success」が出ればOK（テーブル5つ＋ビュー1つ＋初期ルール1件が作成される）

### 3. API キーを取得

1. ダッシュボード左メニュー → **Project Settings** → **API**
2. 以下2つをメモ:
   - **Project URL**（`https://xxxxx.supabase.co`）
   - **anon public key**（`eyJhb...` で始まる長い文字列）

### 4. アプリの設定ファイルを書き換え

`js/config.js` を開き、上記2つを貼り付け:

```js
window.MJ_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhb...',
};
```

### 5. GitHub Pages で公開

1. このリポジトリを GitHub に push
2. GitHub のリポジトリページ → **Settings** → **Pages**
3. Source: **Deploy from a branch** / Branch: **main** / Folder: **/(root)** → Save
4. 1〜2分で `https://<ユーザー名>.github.io/mahjong-tracker/` が公開される
5. URLを仲間に共有して使用開始 🎉

---

## 📱 使い方

1. **設定** → ルールを確認（初期値: 26000持ち/30000返し、ウマ5-10、レート1,000点=50円、焼き鳥100円）
2. **参加者** → メンバーを登録
3. **ホーム** → 「今日のセッションを開始」
4. 半荘ごとに **「半荘を追加」** で4人選択＋素点入力（順位・最終ptは自動）
5. その日が終わったら **「Daily締め」** → 精算額が円で表示される
6. **ランキング** → 全期間の通算成績

## 💡 スコア計算ロジック

```
オカ        = (返し点 - 持ち点) × 4 / 1000  → 1着総取り
最終pt      = (素点 - 返し点) / 1000 + ウマ + (1着のみ)オカ
精算額(円)  = 最終pt合計 × レート + 焼き鳥精算
焼き鳥精算  = 自分の焼き鳥×3×100円(支払) - 他人の焼き鳥×100円(受取)
```

## 🔧 ルール変更

`設定` 画面からいつでも変更可能。  
**変更後の試合に適用**されます。過去の試合は記録時のルールで保存済みです。

## 🛠 ローカルで動かす

ビルド不要。`index.html` をブラウザで開くだけで動きます（Supabase設定済みなら）。  
Mac の場合: `open index.html`

---

## 📂 ファイル構成

```
mahjong-tracker/
├── index.html            # エントリーポイント
├── css/style.css         # スタイル（ダークテーマ・モバイル対応）
├── js/
│   ├── config.js         # Supabase接続設定（要編集）
│   └── app.js            # アプリ本体（SPAルーター・全画面・スコア計算）
├── supabase/
│   └── schema.sql        # DBスキーマ（初回1回だけ実行）
└── README.md
```
