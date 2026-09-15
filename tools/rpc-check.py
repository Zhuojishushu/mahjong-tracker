#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
サーバー側処理（RPC・RLS・Edge Function）の検査

スモークテスト（tools/smoke.sh）はブラウザ側の描画だけを見ており、
Supabase の応答は模擬しているため、SQL の書き間違いを検出できない。
実際に本番のサーバーへ問い合わせて、応答が想定どおりかを確認する。

既定ではデータを一切作らない（既存の名前で登録を試す、誤ったPINで弾かれるか等）。
--admin-pin をつけると、登録→ログイン→削除まで一往復して後片付けまで行う。

  使い方:
    ./tools/rpc-check.py
    ./tools/rpc-check.py --admin-pin 1234     # 登録の成功経路まで確認する
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OK, NG = 0, 0


def config():
    src = (ROOT / "js" / "config.js").read_text()
    url = re.search(r"SUPABASE_URL:\s*'([^']+)'", src).group(1)
    key = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", src).group(1)
    return url, key


URL, KEY = config()
HDR = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def http(method, path, body=None, base="rest/v1"):
    req = urllib.request.Request(
        f"{URL}/{base}/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None, headers=HDR)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def rpc(fn, body):
    return http("POST", f"rpc/{fn}", body)


def edge(body):
    return http("POST", "notify-session", body, base="functions/v1")


def body_text(raw):
    try:
        d = json.loads(raw)
        if isinstance(d, dict):
            return d.get("message") or d.get("error") or raw
        return raw
    except Exception:
        return raw


def check(label, got, want, how="contains"):
    """want を満たせば合格。how: contains / equals / empty / nonempty"""
    global OK, NG
    text = body_text(got) if isinstance(got, str) else str(got)
    if how == "contains":
        ok = want in text
    elif how == "equals":
        ok = text.strip() == want
    elif how == "empty":
        ok = text.strip() in ("[]", "")
    elif how == "nonempty":
        ok = text.strip() not in ("[]", "", "null")
    elif how == "absent":
        ok = want not in text
    else:
        raise ValueError(how)
    if ok:
        OK += 1
        print(f"  \033[32m✓\033[0m {label}")
    else:
        NG += 1
        print(f"  \033[31m✗\033[0m {label}")
        print(f"      期待: {how} {want!r}")
        print(f"      実際: {text[:160]}")
    return ok


def head(title):
    print(f"\n\033[1m{title}\033[0m")


def pin_hash(pin):
    return hashlib.sha256(f"mj-tracker:{pin}".encode()).hexdigest()


BAD = "この値は正しいPINではありません"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-pin", help="管理者の4桁PIN。指定すると登録の成功経路まで確認する")
    args = ap.parse_args()

    print(f"対象: {URL}")

    # 既存の登録者（名前だけ取得できる）
    _, raw = http("GET", "players_public?select=id,name,is_admin&order=created_at")
    players = json.loads(raw)
    if not players:
        print("登録者が1人もいないため、一部の検査を省略します")
        return 1
    someone = players[0]

    head("新規登録（mj_register）")
    _, r = rpc("mj_register", {"p_name": someone["name"], "p_pin_hash": "x"})
    check("既存の名前は拒否される", r, "同じ名前が既に登録されています")
    check("曖昧な列参照のエラーが出ない", r, "ambiguous", "absent")
    _, r = rpc("mj_register", {"p_name": "   ", "p_pin_hash": "x"})
    check("空の名前は拒否される", r, "名前を入力してください")
    _, r = rpc("mj_register", {"p_name": "あ" * 21, "p_pin_hash": "x"})
    check("長すぎる名前は拒否される", r, "20文字")

    head("ログイン（mj_login）")
    _, r = rpc("mj_login", {"p_name": someone["name"], "p_pin_hash": BAD})
    check("誤ったPINでは入れない", r, "", "empty")
    _, r = rpc("mj_login", {"p_name": "存在しない人", "p_pin_hash": BAD})
    check("存在しない名前でも入れない", r, "", "empty")

    head("PINハッシュの秘匿")
    _, r = http("GET", "players?select=name,pin_hash")
    check("players を直接読めない", r, "", "empty")
    _, r = http("GET", "players_public?select=name,is_admin")
    check("players_public は読める", r, "", "nonempty")
    check("players_public に pin_hash が含まれない", r, "pin_hash", "absent")

    head("本人確認が要る処理")
    for fn, body in [
        ("mj_update_profile", {"p_player_id": someone["id"], "p_pin_hash": BAD,
                               "p_new_name": "乗っ取り", "p_new_pin_hash": None}),
    ]:
        _, r = rpc(fn, body)
        check(f"{fn}: 誤ったPINを拒否", r, "現在のPINが違います")
    for fn in ["mj_board_list", "mj_push_status"]:
        body = {"p_player_id": someone["id"], "p_pin_hash": BAD}
        if fn == "mj_board_list":
            body["p_scope"] = "global"
        else:
            body["p_endpoint"] = "https://example.com/x"
        _, r = rpc(fn, body)
        check(f"{fn}: 誤ったPINを拒否", r, "ログインし直してください")

    head("管理者だけの処理")
    for fn, body in [
        ("mj_admin_update_rule", {"p_admin_id": someone["id"], "p_admin_pin_hash": BAD,
                                  "p_rule": {"yen_per_1000pt": 99999}}),
        ("mj_admin_delete_player", {"p_admin_id": someone["id"], "p_admin_pin_hash": BAD,
                                    "p_target_id": someone["id"]}),
        ("mj_admin_reset_pin", {"p_admin_id": someone["id"], "p_admin_pin_hash": BAD,
                                "p_target_id": someone["id"], "p_new_pin_hash": "x"}),
    ]:
        _, r = rpc(fn, body)
        check(f"{fn}: 権限のない呼び出しを拒否", r, "管理者の権限がありません")

    head("テーブルへの直接操作")
    _, r = http("POST", "players", {"name": "侵入者", "pin_hash": "x"})
    check("players への直接INSERTを拒否", r, "row-level security")
    _, r = http("GET", "board_posts?select=id")
    check("board_posts を直接読めない", r, "", "empty")
    _, r = http("GET", "push_subscriptions?select=id")
    check("push_subscriptions を直接読めない", r, "", "empty")
    _, before = http("GET", "rule_presets?select=yen_per_1000pt&active=eq.true")
    http("PATCH", "rule_presets?active=eq.true", {"yen_per_1000pt": 99999})
    _, after = http("GET", "rule_presets?select=yen_per_1000pt&active=eq.true")
    check("rule_presets を直接書き換えられない", after, before, "equals")

    head("集計ビュー")
    for v in ["v_season_stats", "v_availability_summary", "v_player_stats"]:
        s, _ = http("GET", f"{v}?select=*&limit=1")
        check(f"{v} が読める", str(s), "200")

    head("通知の送信（Edge Function）")
    _, r = edge({})
    check("パラメータ不足を拒否", r, "パラメータが足りません")
    _, r = edge({"player_id": someone["id"], "pin_hash": BAD, "test": True})
    check("誤ったPINを拒否", r, "認証できませんでした")

    if args.admin_pin:
        head("登録の成功経路（後片付けまで行う）")
        admin = next((p for p in players if p["is_admin"]), None)
        if not admin:
            check("管理者が見つかる", "管理者がいません", "管理者アカウント")
        else:
            ah = pin_hash(args.admin_pin)
            _, r = rpc("mj_login", {"p_name": admin["name"], "p_pin_hash": ah})
            if not check("管理者のPINが正しい", r, "", "nonempty"):
                print("      → --admin-pin の値を確認してください")
            else:
                name = "疎通確認用"
                th = pin_hash("0000")
                _, r = rpc("mj_register", {"p_name": name, "p_pin_hash": th})
                created = check("新しい名前で登録できる", r, "", "nonempty")
                if created:
                    _, r2 = rpc("mj_login", {"p_name": name, "p_pin_hash": th})
                    check("登録したアカウントでログインできる", r2, "", "nonempty")
                    tid = json.loads(r)[0]["id"]
                    _, r3 = rpc("mj_admin_delete_player", {
                        "p_admin_id": admin["id"], "p_admin_pin_hash": ah, "p_target_id": tid})
                    check("管理者が削除できる（後片付け）", str(r3), "", "empty")
                    _, r4 = http("GET", f"players_public?select=id&id=eq.{tid}")
                    check("削除されたことを確認", r4, "", "empty")
    else:
        print("\n  （--admin-pin をつけると、登録の成功経路まで確認できます）")

    print(f"\n{'=' * 46}")
    if NG:
        print(f"\033[31m{NG} 件が失敗、{OK} 件が成功\033[0m")
        return 1
    print(f"\033[32m全 {OK} 件が想定どおりです\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
