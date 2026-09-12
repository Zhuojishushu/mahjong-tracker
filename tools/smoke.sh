#!/bin/zsh
# ============================================================
# 全画面の描画スモークテスト
#   ブラウザのAPIをモックして各 render 関数を実際に呼び出し、
#   未定義変数などの実行時エラーを検出する。
#   構文チェックだけでは関数の中身のエラーを拾えないため、
#   デプロイ前に必ず実行すること。
#
#   使い方:  ./tools/smoke.sh
# ============================================================
set -e
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
OUT=$(mktemp -t mj-smoke).js
cat tools/smoke-mock.js > "$OUT"
cat js/auth.js >> "$OUT"
sed -e 's/^bootstrap();$/\/\/ bootstrap();/' js/app.js >> "$OUT"
cat tools/smoke-run.js >> "$OUT"
"$JSC" "$OUT"
rm -f "$OUT"
