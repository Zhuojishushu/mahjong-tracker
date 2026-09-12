// ============================================================
// 麻雀トラッカー: 卓が成立したときに参加者へ通知を送る
//
// Supabase ダッシュボード → Edge Functions → Deploy a new function
// 関数名: notify-session
// 必要なシークレット: VAPID_KEYS（.secrets/vapid.json の中身）
// ============================================================
import * as webpush from "jsr:@negrel/webpush@0.3.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_KEYS = Deno.env.get("VAPID_KEYS")!;
const CONTACT = Deno.env.get("PUSH_CONTACT") ?? "mailto:admin@example.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// service_role でDBを読み書きする（RLSを通さない）
async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日(${wd})`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { session_id, player_id, pin_hash, test } = await req.json();
    if (!player_id || !pin_hash) return json({ error: "パラメータが足りません" }, 400);

    // 呼び出した人が本人か確認する
    const caller = await db(`players?select=id&id=eq.${player_id}&pin_hash=eq.${encodeURIComponent(pin_hash)}`);
    if (!caller.length) return json({ error: "認証できませんでした" }, 401);

    const appServerOf = async () => await webpush.ApplicationServer.new({
      contactInformation: CONTACT,
      vapidKeys: await webpush.importVapidKeys(JSON.parse(VAPID_KEYS), { extractable: false }),
    });
    const sendTo = async (server: any, subs: any[], payload: string) => {
      let sent = 0; const expired: string[] = [];
      for (const s of subs) {
        try {
          await server.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any)
            .pushTextMessage(payload, {});
          sent++;
        } catch (e) {
          const m = String(e);
          if (m.includes("404") || m.includes("410")) expired.push(s.endpoint);
          console.error("送信失敗", s.endpoint, m);
        }
      }
      for (const ep of expired) {
        await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: "DELETE" });
      }
      return { sent, expired: expired.length };
    };

    // 動作確認用：自分の端末にだけテスト通知を送る
    if (test) {
      const mySubs = await db(`push_subscriptions?select=*&player_id=eq.${player_id}`);
      if (!mySubs.length) return json({ error: "この端末は通知がオフです" }, 400);
      const r = await sendTo(await appServerOf(), mySubs, JSON.stringify({
        title: "🀄 テスト通知",
        body: "通知は正しく届いています",
        url: "./#settings",
        tag: "test",
      }));
      return json({ ok: true, targets: mySubs.length, ...r });
    }

    if (!session_id) return json({ error: "パラメータが足りません" }, 400);

    const sessions = await db(`sessions?select=id,played_on,confirmed_at,notified_at&id=eq.${session_id}`);
    const session = sessions[0];
    if (!session) return json({ error: "セッションが見つかりません" }, 404);
    if (!session.confirmed_at) return json({ error: "まだ成立していません" }, 400);
    if (session.notified_at) return json({ ok: true, skipped: "通知済み" });

    // その日の参加者
    const avail = await db(`availability?select=player_id&available_on=eq.${session.played_on}`);
    const ids: string[] = avail.map((a: any) => a.player_id);
    if (!ids.includes(player_id)) return json({ error: "この卓の参加者ではありません" }, 403);

    const subs = await db(`push_subscriptions?select=*&player_id=in.(${ids.join(",")})`);

    const payload = JSON.stringify({
      title: "🀄 卓が成立しました",
      body: `${fmtDate(session.played_on)} のメンバーが4人揃いました`,
      url: `./#session/${session_id}`,
      tag: `session-${session_id}`,
    });

    const r = await sendTo(await appServerOf(), subs, payload);

    await db(`sessions?id=eq.${session_id}`, {
      method: "PATCH",
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });

    return json({ ok: true, targets: subs.length, ...r });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
