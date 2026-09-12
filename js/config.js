// ============================================================
// Supabase 接続設定
// Supabase の「Project Settings → API Keys」から取得して書き換え
// ============================================================
window.MJ_CONFIG = {
  SUPABASE_URL: 'https://uwinqmflerhesjdbophg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_UzQrVFfSk91B32RwKDpAlA_lwz5AsAW',
  // Web Push の公開鍵（公開してよい値。対になる秘密鍵は Supabase のシークレットに保管）
  VAPID_PUBLIC_KEY: 'BFBqMpog6Nm5MnOy_k_1zCljwRPvt11cVnTx4k2ovGOje_3dHDM6dEKpYp8__o5p9bngvrQ8NP4Y6pHNArgqKqk'
};
