// ============================================================
// 認証ユーティリティ（名前 + 4桁PIN）
// PINは SHA-256 でハッシュ化して保存
// ============================================================
const AUTH_KEY = 'mj_auth_v1';

// SHA-256 ハッシュ（Web Crypto API）
async function hashPin(pin) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`mj-tracker:${pin}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ログイン状態
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

window.MJ_AUTH = { hashPin, getCurrentPlayer, setCurrentPlayer, logout };
