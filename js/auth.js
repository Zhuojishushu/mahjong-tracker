// ============================================================
// 認証ユーティリティ（名前 + 4桁PIN）
// PINは SHA-256 でハッシュ化して保存
// ============================================================
(function () {
  // v2: PINハッシュをセッション資格情報として保持する（サーバー側の検証に使う）。
  // キーを変えているため、更新後は全員が一度ログインし直す必要がある。
  const AUTH_KEY = 'mj_auth_v2';

  async function hashPin(pin) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(`mj-tracker:${pin}`));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function getCurrentPlayer() {
    try {
      const s = localStorage.getItem(AUTH_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }
  function setCurrentPlayer(p) {
    if (p) localStorage.setItem(AUTH_KEY, JSON.stringify(p));
    else localStorage.removeItem(AUTH_KEY);
  }
  function logout() {
    setCurrentPlayer(null);
    location.hash = '#login';
    location.reload();
  }

  // サーバー側のRPCに渡す資格情報
  function authHash() {
    const p = getCurrentPlayer();
    return p ? p.h || null : null;
  }

  window.MJ_AUTH = { hashPin, getCurrentPlayer, setCurrentPlayer, logout, authHash };
})();
