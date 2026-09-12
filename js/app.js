// ============================================================
// 麻雀トラッカー メインアプリ v2
// - 名前+PINログイン
// - カレンダー参加申込（4人で自動成立）
// ============================================================
const { createClient } = supabase;
const sb = createClient(window.MJ_CONFIG.SUPABASE_URL, window.MJ_CONFIG.SUPABASE_ANON_KEY);
const { hashPin, getCurrentPlayer, setCurrentPlayer, logout } = window.MJ_AUTH;

// index.html の ?v= と必ず揃えること（キャッシュ対策・不具合報告時の切り分け用）
const APP_VERSION = '3.2.1';

// ---------- 状態 ----------
const state = { rule: null, players: [], calMonth: null, calSelected: null };

// ---------- ユーティリティ ----------
const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
};
const fmt  = (n) => (Math.round(n * 10) / 10).toFixed(1);
const yen  = (n) => `¥${Math.round(n).toLocaleString()}`;
const toast = (msg, isError = false) => {
  const el = h('div', { class: `toast ${isError ? 'err' : ''}` }, msg);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
};
const parseISO = (d) => {
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, dd);
};
const dayJa = (d) => ['日','月','火','水','木','金','土'][parseISO(d).getDay()];
// スマホの数字キーパッドにはマイナスキーが無いため、符号は専用ボタンで切り替える。
// input は type="text" にして「-」だけの途中状態を保持できるようにする。
const numInput = (attrs = {}) => h('input', { type: 'text', inputmode: 'numeric', ...attrs });
const cleanNum = (raw) => raw.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '');
const signBtn = (input) => {
  const btn = h('button', { class: 'btn small sign-btn', type: 'button', title: '＋ / − を切り替え' }, '±');
  btn.addEventListener('click', () => {
    const v = input.value.trim();
    input.value = v.startsWith('-') ? v.slice(1) : (v === '' ? '-' : `-${v}`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  return btn;
};
const fmtDate = (d) => {
  const dt = parseISO(d);
  return `${dt.getMonth()+1}月${dt.getDate()}日(${dayJa(d)})`;
};
// 「今日」は日本時間で判定する（UTC基準だとJST午前9時まで前日扱いになってしまう）
const todayISO = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
// ptの表示（整数はそのまま、端数があるときだけ小数第1位まで）
const ptFmt = (n) => {
  const v = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
const signed = (n) => (Number(n) > 0 ? `+${ptFmt(n)}` : ptFmt(n));

// ---------- スコア計算 ----------
// 2〜4位が申告した±（五捨六入後）から、トップの点数を逆算する。
// 4人の点数の合計は必ず0になり、トップの点数にはオカが自動的に含まれる。
// rows は 2位 → 4位 の順に並んでいること。
function buildResults(topId, rows, rule) {
  const umaList = [rule.uma_1st, rule.uma_2nd, -rule.uma_2nd, -rule.uma_1st];
  const topPt = -rows.reduce((sum, r) => sum + r.pt, 0);
  return [
    { player_id: topId, base_pt: topPt, rank: 1, tobi: false, final_points: topPt + umaList[0] },
    ...rows.map((r, i) => ({
      player_id: r.id,
      base_pt: r.pt,
      rank: i + 2,
      tobi: !!r.tobi,
      final_points: r.pt + umaList[i + 1],
    })),
  ];
}
// 申告値の降順で2〜4位を並べる（同値のときは現在の並び順を維持＝▲での入れ替えが効く）
function orderRows(rows) {
  return rows.map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.pt - a.r.pt || a.i - b.i)
    .map((x) => x.r);
}

// ---------- データロード ----------
async function loadRule() {
  const { data } = await sb.from('rule_presets').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1);
  state.rule = data[0];
}
async function loadPlayers() {
  const { data } = await sb.from('players').select('*').order('name');
  state.players = data || [];
}

// ============================================================
// ルーター
// ============================================================
const publicRoutes = ['login'];
const routes = {
  '': renderHome,
  'home': renderHome,
  'login': renderLogin,
  'calendar': renderCalendar,
  'players': renderPlayers,
  'sessions': renderSessions,
  'session': renderSessionDetail,
  'new-game': renderNewGame,
  'rankings': renderRankings,
  'settings': renderSettings,
};
async function router() {
  const hash = location.hash.slice(1);
  const [route, ...params] = hash.split('/');
  const me = getCurrentPlayer();

  // ログインガード
  if (!me && !publicRoutes.includes(route || 'home')) {
    location.hash = '#login';
    return;
  }
  if (me && route === 'login') {
    location.hash = '#home';
    return;
  }

  const fn = routes[route] || renderHome;
  $('#app').innerHTML = '';
  $('#app').appendChild(h('div', { class: 'loading' }, '読み込み中…'));
  try {
    const view = await fn(...params);
    $('#app').innerHTML = '';
    $('#app').appendChild(view);
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${route}`));
    updateHeader();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = '';
    $('#app').appendChild(h('div', { class: 'card err' }, `エラー: ${e.message}`));
  }
}
window.addEventListener('hashchange', router);

function updateHeader() {
  const me = getCurrentPlayer();
  const hdr = $('#header-right');
  if (!hdr) return;
  hdr.innerHTML = '';
  if (me) {
    hdr.append(
      h('span', { class: 'me' }, `👤 ${me.name}`),
      h('button', { class: 'btn small', onclick: logout }, 'ログアウト'),
    );
  }
}

// ============================================================
// 画面：ログイン / 新規登録
// ============================================================
async function renderLogin() {
  await loadPlayers();

  const card = h('div', { class: 'card' });
  const tabState = { mode: state.players.length === 0 ? 'register' : 'login' };

  const render = () => {
    card.innerHTML = '';
    card.append(
      h('h2', {}, '🀄 麻雀トラッカー'),
      h('div', { class: 'tabs' },
        h('button', { class: `tab ${tabState.mode==='login'?'active':''}`, onclick: () => { tabState.mode='login'; render(); } }, 'ログイン'),
        h('button', { class: `tab ${tabState.mode==='register'?'active':''}`, onclick: () => { tabState.mode='register'; render(); } }, '新規登録'),
      ),
      tabState.mode === 'login' ? renderLoginForm() : renderRegisterForm(),
    );
  };
  render();
  return card;
}
function renderLoginForm() {
  return h('form', { class: 'auth-form', onsubmit: async (e) => {
    e.preventDefault();
    const name = e.target.name.value;
    const pin  = e.target.pin.value;
    if (!/^\d{4}$/.test(pin)) return toast('PINは4桁の数字です', true);
    const player = state.players.find(p => p.name === name);
    if (!player) return toast('プレイヤーが見つかりません', true);
    const hash = await hashPin(pin);
    if (player.pin_hash !== hash) return toast('PINが違います', true);
    setCurrentPlayer({ id: player.id, name: player.name });
    toast(`ようこそ、${player.name}さん`);
    location.hash = '#home';
  }},
    h('label', { class: 'field' },
      h('span', {}, '名前'),
      state.players.length === 0
        ? h('p', { class: 'muted small' }, '※まだ誰も登録されていません。「新規登録」タブから始めてください')
        : h('select', { name: 'name', required: true },
            h('option', { value: '' }, '-- 選択 --'),
            ...state.players.map(p => h('option', { value: p.name }, p.name))
          ),
    ),
    h('label', { class: 'field' },
      h('span', {}, '4桁PIN'),
      h('input', { type: 'password', name: 'pin', inputmode: 'numeric', pattern: '\\d{4}', maxlength: '4', required: true, placeholder: '****' }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary full', type: 'submit' }, 'ログイン'),
    ),
  );
}
function renderRegisterForm() {
  return h('form', { class: 'auth-form', onsubmit: async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const pin  = e.target.pin.value;
    const pin2 = e.target.pin2.value;
    if (!name) return toast('名前を入力してください', true);
    if (!/^\d{4}$/.test(pin)) return toast('PINは4桁の数字です', true);
    if (pin !== pin2) return toast('PINが一致しません', true);
    if (state.players.find(p => p.name === name)) return toast('同じ名前が既に登録されています', true);
    const hash = await hashPin(pin);
    const { data, error } = await sb.from('players').insert({ name, pin_hash: hash }).select().single();
    if (error) return toast(error.message, true);
    setCurrentPlayer({ id: data.id, name: data.name });
    toast(`登録完了！ようこそ、${name}さん`);
    location.hash = '#home';
  }},
    h('p', { class: 'muted small' }, '初めての方はここから登録してください。PINは次回ログインに必要です（忘れないように）。'),
    h('label', { class: 'field' },
      h('span', {}, '名前（仲間内で識別できる名前）'),
      h('input', { name: 'name', required: true, maxlength: '20', placeholder: '例: 山田' }),
    ),
    h('label', { class: 'field' },
      h('span', {}, '4桁PIN（数字のみ）'),
      h('input', { type: 'password', name: 'pin', inputmode: 'numeric', pattern: '\\d{4}', maxlength: '4', required: true, placeholder: '****' }),
    ),
    h('label', { class: 'field' },
      h('span', {}, '4桁PIN（確認）'),
      h('input', { type: 'password', name: 'pin2', inputmode: 'numeric', pattern: '\\d{4}', maxlength: '4', required: true, placeholder: '****' }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary full', type: 'submit' }, '登録'),
    ),
  );
}

// ============================================================
// 画面：ホーム
// ============================================================
async function renderHome() {
  const me = getCurrentPlayer();
  const today = todayISO();

  // 直近の成立セッション（今日以降）
  const { data: upcomingSessions } = await sb.from('sessions')
    .select('*').not('confirmed_at', 'is', null).gte('played_on', today).order('played_on').limit(5);

  // 自分の参加申込（今日以降）
  const { data: myAvail } = await sb.from('availability')
    .select('available_on').eq('player_id', me.id).gte('available_on', today).order('available_on');

  return h('div', {},
    h('div', { class: 'card hero' },
      h('h2', {}, `🀄 こんにちは、${me.name}さん`),
      h('p', { class: 'muted' }, `参加者: ${state.players.length}人 / 自分の参加申込: ${(myAvail || []).length}件`),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: '#calendar' }, '📅 カレンダー'),
        h('a', { class: 'btn', href: '#rankings' }, '🏆 ランキング'),
        h('a', { class: 'btn', href: '#sessions' }, '📜 過去セッション'),
      ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '🎉 開催成立予定'),
      (upcomingSessions || []).length === 0
        ? h('p', { class: 'muted' }, 'まだ成立した日はありません。カレンダーから参加申込してください')
        : h('ul', { class: 'list' },
            ...upcomingSessions.map(s => h('li', {},
              h('a', { href: `#session/${s.id}` }, `${fmtDate(s.played_on)} ${s.played_on === today ? '🟢今日！' : ''}`)
            ))
          ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '🗓 自分の参加申込'),
      (myAvail || []).length === 0
        ? h('p', { class: 'muted' }, 'まだありません')
        : h('ul', { class: 'list' },
            ...myAvail.map(a => h('li', {}, fmtDate(a.available_on)))
          ),
    ),
  );
}

// ============================================================
// 画面：カレンダー（月表示・参加申込）
// ============================================================
async function renderCalendar() {
  const me = getCurrentPlayer();
  const today = todayISO();

  // 表示月（初回は今月）
  if (!state.calMonth) {
    const t = new Date();
    state.calMonth = { year: t.getFullYear(), month: t.getMonth() }; // month: 0-11
  }
  const { year, month } = state.calMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startISO = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const endISO   = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;

  // 当月の集計・セッション・自分の申込
  const [{ data: summary }, { data: sessions }, { data: myAvail }] = await Promise.all([
    sb.from('v_availability_summary').select('*').gte('available_on', startISO).lte('available_on', endISO),
    sb.from('sessions').select('*').gte('played_on', startISO).lte('played_on', endISO),
    sb.from('availability').select('available_on').eq('player_id', me.id).gte('available_on', startISO).lte('available_on', endISO),
  ]);
  const summaryByDate = Object.fromEntries((summary || []).map(s => [s.available_on, s]));
  const sessionByDate = Object.fromEntries((sessions || []).map(s => [s.played_on, s]));
  const mySet = new Set((myAvail || []).map(a => a.available_on));

  // カレンダー: 7列、月初の曜日から始めて末日まで
  const cells = [];
  const leading = firstDay.getDay(); // 0=Sun
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // ヘッダー
  const header = h('div', { class: 'cal-month-head' },
    h('button', { class: 'btn small', onclick: () => { state.calMonth = { year: month === 0 ? year-1 : year, month: month === 0 ? 11 : month-1 }; state.calSelected = null; router(); } }, '◀'),
    h('div', { class: 'cal-month-label' }, `${year}年${month+1}月`),
    h('button', { class: 'btn small', onclick: () => { state.calMonth = { year: month === 11 ? year+1 : year, month: month === 11 ? 0 : month+1 }; state.calSelected = null; router(); } }, '▶'),
  );

  // 曜日見出し
  const wkHead = h('div', { class: 'cal-grid cal-wk' },
    ...['日','月','火','水','木','金','土'].map((d, i) =>
      h('div', { class: `cal-cell wk ${i===0?'sun':''} ${i===6?'sat':''}` }, d))
  );

  // 日付セル
  const grid = h('div', { class: 'cal-grid' },
    ...cells.map((d, idx) => {
      if (d === null) return h('div', { class: 'cal-cell empty' });
      const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const sum = summaryByDate[iso];
      const cnt = sum ? Number(sum.signup_count) : 0;
      const isPast = iso < today;
      const isToday = iso === today;
      const isJoined = mySet.has(iso);
      const isConfirmed = cnt >= 4;
      const dow = idx % 7;
      const classes = [
        'cal-cell',
        isPast && 'past',
        isToday && 'today',
        isJoined && 'joined',
        isConfirmed && 'confirmed',
        state.calSelected === iso && 'selected',
        dow === 0 && 'sun',
        dow === 6 && 'sat',
      ].filter(Boolean).join(' ');
      return h('div', { class: classes, onclick: () => { state.calSelected = iso; router(); } },
        h('div', { class: 'd-num' }, d),
        isConfirmed
          ? h('div', { class: 'd-badge confirmed-badge' }, '🎉')
          : cnt > 0 ? h('div', { class: 'd-badge' }, `${cnt}/4`) : null,
      );
    })
  );

  // 詳細パネル
  const detail = renderDetailPanel();

  return h('div', {},
    h('div', { class: 'card' },
      header,
      wkHead,
      grid,
      h('div', { class: 'cal-legend muted small' },
        '🟡 自分が申込済み　🟢 4人成立　数字 = 申込人数/4'),
    ),
    detail,
  );

  function renderDetailPanel() {
    if (!state.calSelected) {
      return h('div', { class: 'card muted' }, '👆 日付をタップすると詳細が表示されます');
    }
    const iso = state.calSelected;
    const sum = summaryByDate[iso];
    const session = sessionByDate[iso];
    const cnt = sum ? Number(sum.signup_count) : 0;
    const isPast = iso < today;
    const isJoined = mySet.has(iso);
    const isConfirmed = cnt >= 4;
    const names = sum?.player_names || [];

    return h('div', { class: 'card' },
      h('h3', {}, `📅 ${fmtDate(iso)}`),
      isConfirmed
        ? h('div', { class: 'big-badge confirmed-badge' }, '🎉 開催成立')
        : h('div', { class: 'big-badge' }, `${cnt} / 4 人`),

      cnt === 0
        ? h('p', { class: 'muted' }, 'まだ誰も申込していません')
        : h('div', {},
            h('div', { class: 'muted small' }, '参加申込者:'),
            h('ul', { class: 'name-list' },
              ...names.map(n => h('li', {}, n === me.name ? `${n} (あなた)` : n))
            ),
          ),

      h('div', { class: 'btn-row' },
        isPast
          ? h('span', { class: 'muted small' }, '過去日のため申込不可')
          : isJoined
            ? h('button', { class: 'btn danger', onclick: () => cancelSignUp(iso) }, '✖ 申込取消')
            : !isConfirmed && h('button', { class: 'btn primary', onclick: () => signUp(iso) }, '✋ 自分も参加'),
        isConfirmed && session && h('a', { class: 'btn primary', href: `#session/${session.id}` }, '→ 試合記録へ'),
      ),
    );
  }

  async function signUp(date) {
    const { error } = await sb.from('availability').insert({ player_id: me.id, available_on: date });
    if (error) {
      if (error.code === '23505') toast('既に申込済みです', true);
      else toast(error.message, true);
      return;
    }
    const { count } = await sb.from('availability').select('*', { count: 'exact', head: true }).eq('available_on', date);
    if (count === 4) {
      const { data: existing } = await sb.from('sessions').select('id').eq('played_on', date).maybeSingle();
      if (!existing) {
        await sb.from('sessions').insert({
          played_on: date, rule_id: state.rule.id, confirmed_at: new Date().toISOString(),
        });
        toast(`🎉 ${fmtDate(date)} 開催成立！`);
      }
    } else {
      toast(`参加申込しました（${count}/4）`);
    }
    router();
  }
  async function cancelSignUp(date) {
    if (!confirm(`${fmtDate(date)} の申込を取消しますか？`)) return;
    await sb.from('availability').delete().eq('player_id', me.id).eq('available_on', date);
    toast('取消しました');
    router();
  }
}

// ============================================================
// 画面：参加者一覧
// ============================================================
async function renderPlayers() {
  await loadPlayers();
  const me = getCurrentPlayer();
  return h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, `👥 参加者一覧 (${state.players.length}人)`),
      h('p', { class: 'muted small' }, '※新規追加は各人が「ログイン画面 → 新規登録」から自分で行います'),
      state.players.length === 0
        ? h('p', { class: 'muted' }, '参加者が未登録です')
        : h('ul', { class: 'list' },
            ...state.players.map(p => h('li', { class: 'row-between' },
              h('span', {}, `${p.name}${p.id === me.id ? ' (あなた)' : ''}`),
              p.id !== me.id && h('button', { class: 'btn small danger', onclick: async () => {
                if (!confirm(`${p.name} を削除しますか？\n（過去の試合記録は残ります。PIN忘れた時の再登録用に使ってください）`)) return;
                const { error } = await sb.from('players').delete().eq('id', p.id);
                if (error) return toast(error.message, true);
                router();
              }}, '削除'),
            ))
          ),
    ),
  );
}

// ============================================================
// 画面：セッション一覧
// ============================================================
async function renderSessions() {
  const { data: sessions } = await sb.from('sessions').select('*').order('played_on', { ascending: false });
  return h('div', { class: 'card' },
    h('h3', {}, '📜 セッション一覧'),
    (sessions || []).length === 0
      ? h('p', { class: 'muted' }, 'まだセッションがありません')
      : h('ul', { class: 'list' },
          ...sessions.map(s => h('li', {},
            h('a', { href: `#session/${s.id}` },
              `${fmtDate(s.played_on)} ${s.closed ? '✅締め済' : (s.confirmed_at ? '🟢開催成立' : '🟡')}`)
          ))
        ),
  );
}

// ============================================================
// 画面：セッション詳細
// ============================================================
async function renderSessionDetail(sessionId) {
  const me = getCurrentPlayer();
  const { data: session } = await sb.from('sessions').select('*').eq('id', sessionId).single();
  const { data: games }   = await sb.from('games').select('*').eq('session_id', sessionId).order('game_no');
  const gameIds = games.map(g => g.id);
  const { data: results } = gameIds.length
    ? await sb.from('game_results').select('*').in('game_id', gameIds)
    : { data: [] };

  // 参加者（availabilityから取得・このセッション日に申込していた人）
  const { data: avail } = await sb.from('availability').select('player_id').eq('available_on', session.played_on);
  const participantIds = new Set((avail || []).map(a => a.player_id));

  const totals = {};
  for (const r of results) {
    const t = totals[r.player_id] ||= { points: 0, yakitori: 0, tobi: 0, ranks: [] };
    t.points += Number(r.final_points);
    t.yakitori += r.yakitori ? 1 : 0;
    t.tobi    += r.tobi ? 1 : 0;
    t.ranks.push(r.rank);
  }
  const playerMap = Object.fromEntries(state.players.map(p => [p.id, p]));
  const summary = Object.entries(totals).map(([pid, t]) => ({
    player_id: pid,
    name: playerMap[pid]?.name || '(削除済)',
    ...t,
    games: t.ranks.length,
  })).sort((a, b) => b.points - a.points);

  const rule = state.rule;

  // Daily の賞（一発チップ・役満）を取得
  const { data: chips } = await sb.from('daily_chips').select('*').eq('session_id', sessionId);
  const chipMap = Object.fromEntries((chips || []).map(c => [c.player_id, c.chip_net]));
  const { data: yakumans } = await sb.from('yakuman_awards').select('*').eq('session_id', sessionId);
  const yakuMap = Object.fromEntries((yakumans || []).map(y => [y.player_id, y.yakuman_count]));

  // 役満賞：あがった人が他3人から yakuman_pt ずつ受け取る。
  // 自分 +yakuman_pt×3×自分の回数、他人の回数ぶん −yakuman_pt。まとめると下の式になる。
  const yakuTotal = summary.reduce((sum, s) => sum + (yakuMap[s.player_id] || 0), 0);
  const yakuPtOf = (pid) => rule.yakuman_pt * (4 * (yakuMap[pid] || 0) - yakuTotal);

  const settlements = summary.map(s => {
    const chipNet = chipMap[s.player_id] || 0;
    const chipPt  = chipNet * rule.ippatsu_pt;
    const yakuCnt = yakuMap[s.player_id] || 0;
    const yakuPt  = yakuPtOf(s.player_id);
    const totalPt = s.points + chipPt + yakuPt;
    return { ...s, chipNet, chipPt, yakuCnt, yakuPt, totalPt, totalYen: totalPt * rule.yen_per_1000pt };
  });

  // 役満賞の入力UI（Daily終了時のチェック①）
  function renderYakumanInput() {
    const card = h('div', { class: 'card' },
      h('h3', {}, '① 🀄 役満賞'),
      h('p', { class: 'muted small' },
        `この日に役満をあがった回数を入力。ツモ・ロンの区別なし。あがった人が他の3人から各${rule.yakuman_pt}pt（${rule.yakuman_pt * rule.yen_per_1000pt}円）ずつ受け取ります。`),
    );
    const tbl = h('table', { class: 'chip-input' },
      h('thead', {}, h('tr', {},
        h('th', {}, '名前'),
        h('th', { class: 'num' }, '役満'),
        h('th', { class: 'num' }, 'pt増減'),
        h('th', { class: 'num' }, '円換算'),
      )),
    );
    const tbody = h('tbody', {});
    const inputs = {};
    const ptCells = {};
    const yenCells = {};

    const recalc = () => {
      const counts = {};
      let total = 0;
      for (const pid in inputs) {
        const v = Math.max(0, parseInt(inputs[pid].value, 10) || 0);
        counts[pid] = v; total += v;
      }
      for (const pid in ptCells) {
        const pt = rule.yakuman_pt * (4 * counts[pid] - total);
        ptCells[pid].textContent = pt === 0 ? '0' : signed(pt);
        ptCells[pid].className = `num ${pt > 0 ? 'pos' : (pt < 0 ? 'neg' : '')}`;
        yenCells[pid].textContent = yen(pt * rule.yen_per_1000pt);
        yenCells[pid].className = `num ${pt > 0 ? 'pos' : (pt < 0 ? 'neg' : '')}`;
      }
    };

    for (const s of summary) {
      const pid = s.player_id;
      const cur = yakuMap[pid] || 0;
      const input = numInput({ value: cur, class: 'chip-num' });
      input.addEventListener('input', () => {
        // 回数なので数字のみ（マイナスは受け付けない）
        const cleaned = input.value.replace(/[^0-9]/g, '');
        if (cleaned !== input.value) input.value = cleaned;
        recalc();
      });
      inputs[pid] = input;
      const ptCell  = h('td', { class: 'num' }, '0');
      const yenCell = h('td', { class: 'num' }, yen(0));
      ptCells[pid] = ptCell; yenCells[pid] = yenCell;
      tbody.append(h('tr', {},
        h('td', {}, s.name),
        h('td', { class: 'num' }, h('div', { class: 'gi-num chip-cell' }, input)),
        ptCell, yenCell,
      ));
    }
    tbl.append(tbody);
    card.append(tbl);
    recalc();

    card.append(h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn primary', disabled: session.closed,
        onclick: async () => {
          const rows = summary.map(s => ({
            session_id: sessionId, player_id: s.player_id,
            yakuman_count: Math.max(0, parseInt(inputs[s.player_id].value, 10) || 0),
            updated_at: new Date().toISOString(),
          }));
          const { error } = await sb.from('yakuman_awards').upsert(rows, { onConflict: 'session_id,player_id' });
          if (error) return toast(error.message, true);
          toast('役満賞を保存しました');
          router();
        },
      }, '💾 役満賞を保存'),
    ));

    return card;
  }

  // チップ入力UI（Daily終了時のチェック②）
  function renderChipInput() {
    const playersInOrder = summary.map(s => ({ id: s.player_id, name: s.name }));
    const card = h('div', { class: 'card' },
      h('h3', {}, '② 🎫 一発賞（チップ）'),
      h('p', { class: 'muted small' }, `最終局終了時の各自のチップ増減を入力。プラス=もらった、マイナス=払った。1枚 = ${rule.ippatsu_pt}pt（${rule.ippatsu_pt * rule.yen_per_1000pt}円）。合計が0になるはずです。`),
    );
    const tbl = h('table', { class: 'chip-input' },
      h('thead', {}, h('tr', {},
        h('th', {}, '名前'),
        h('th', { class: 'num' }, 'チップ増減'),
        h('th', { class: 'num' }, '円換算'),
      )),
    );
    const tbody = h('tbody', {});
    const inputs = {};
    for (const p of playersInOrder) {
      const cur = chipMap[p.id] || 0;
      const input = numInput({ value: cur, 'data-pid': p.id, class: 'chip-num' });
      inputs[p.id] = input;
      const chipYenOf = (v) => v * rule.ippatsu_pt * rule.yen_per_1000pt;
      const yenSpan = h('span', {}, yen(chipYenOf(cur)));
      input.addEventListener('input', () => {
        const cleaned = cleanNum(input.value);
        if (cleaned !== input.value) input.value = cleaned;
        const v = parseInt(cleaned, 10) || 0;
        yenSpan.textContent = yen(chipYenOf(v));
        updateSum();
      });
      tbody.append(h('tr', {},
        h('td', {}, p.name),
        h('td', { class: 'num' }, h('div', { class: 'gi-num chip-cell' }, signBtn(input), input)),
        h('td', { class: `num ${cur > 0 ? 'pos' : (cur < 0 ? 'neg' : '')}` }, yenSpan),
      ));
    }
    tbl.append(tbody);
    card.append(tbl);

    const sumLine = h('div', { class: 'sum-display' }, '合計: 0');
    function updateSum() {
      let sum = 0;
      for (const pid in inputs) sum += parseInt(inputs[pid].value, 10) || 0;
      sumLine.textContent = `合計: ${sum > 0 ? '+' : ''}${sum}`;
      sumLine.className = `sum-display ${sum === 0 ? 'ok' : 'warn'}`;
    }
    updateSum();
    card.append(sumLine);

    card.append(h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn primary', disabled: session.closed,
        onclick: async () => {
          let sum = 0;
          const rows = [];
          for (const pid in inputs) {
            const v = parseInt(inputs[pid].value, 10) || 0;
            sum += v;
            rows.push({ session_id: sessionId, player_id: pid, chip_net: v, updated_at: new Date().toISOString() });
          }
          if (sum !== 0) {
            if (!confirm(`チップ増減の合計が ${sum} で、0になっていません。\nこのまま保存しますか？`)) return;
          }
          const { error } = await sb.from('daily_chips').upsert(rows, { onConflict: 'session_id,player_id' });
          if (error) return toast(error.message, true);
          toast('チップ精算を保存しました');
          router();
        }
      }, '💾 チップを保存'),
    ));

    return card;
  }

  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', {}, `📅 ${fmtDate(session.played_on)}`),
        h('span', { class: 'badge' }, session.closed ? '✅締め済' : (session.confirmed_at ? '🟢開催成立' : '🟡')),
      ),
      h('p', { class: 'muted small' }, `参加申込: ${(avail || []).length}人`),
      h('div', { class: 'btn-row' },
        !session.closed && participantIds.has(me.id) && h('a', { class: 'btn primary', href: `#new-game/${sessionId}` }, '＋ 半荘を追加'),
        !session.closed && participantIds.has(me.id) && summary.length > 0 && h('button', { class: 'btn', onclick: async () => {
          if (!confirm('このセッションをDaily締めしますか？\n（締め後も閲覧可能ですが、新規半荘は追加できなくなります）')) return;
          await sb.from('sessions').update({ closed: true }).eq('id', sessionId);
          toast('Daily締めしました');
          router();
        }}, '🔒 Daily締め'),
        session.closed && participantIds.has(me.id) && h('button', { class: 'btn', onclick: async () => {
          if (!confirm('Daily締めを解除しますか？')) return;
          await sb.from('sessions').update({ closed: false }).eq('id', sessionId);
          router();
        }}, '🔓 締め解除'),
        h('a', { class: 'btn', href: '#calendar' }, '← カレンダー'),
      ),
      !participantIds.has(me.id) && h('p', { class: 'muted small warn-box' }, '⚠️ あなたはこの日の参加者ではないため、閲覧のみ可能です'),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '💰 セッション集計（Daily精算）'),
      summary.length === 0
        ? h('p', { class: 'muted' }, 'まだ半荘が記録されていません')
        : h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, '順'), h('th', {}, '名前'),
              h('th', { class: 'num' }, '半荘'),
              h('th', { class: 'num' }, 'pt合計'),
              h('th', { class: 'num' }, '1/2/3/4着'),
              h('th', { class: 'num' }, 'トビ'),
              h('th', { class: 'num' }, '役満'),
              h('th', { class: 'num' }, 'チップ'),
              h('th', { class: 'num' }, '精算額'),
            )),
            h('tbody', {}, ...settlements.map((s, i) => {
              const rc = [1,2,3,4].map(r => s.ranks.filter(x => x===r).length).join('/');
              return h('tr', {},
                h('td', {}, i+1), h('td', {}, s.name),
                h('td', { class: 'num' }, s.games),
                h('td', { class: `num ${s.points >= 0 ? 'pos' : 'neg'}` }, ptFmt(s.points)),
                h('td', { class: 'num small' }, rc),
                h('td', { class: 'num' }, s.tobi || ''),
                h('td', { class: `num ${s.yakuCnt ? 'pos' : ''}` }, s.yakuCnt || ''),
                h('td', { class: `num ${s.chipNet > 0 ? 'pos' : (s.chipNet < 0 ? 'neg' : '')}` }, s.chipNet ? (s.chipNet > 0 ? `+${s.chipNet}` : s.chipNet) : '0'),
                h('td', { class: `num ${s.totalYen >= 0 ? 'pos' : 'neg'}` }, yen(s.totalYen)),
              );
            })),
          )),
      h('p', { class: 'muted small' }, `レート: 1,000点 = ${rule.yen_per_1000pt}円 / 一発賞1枚 = ${rule.ippatsu_pt}pt（${rule.ippatsu_pt * rule.yen_per_1000pt}円） / 役満賞 = 1人あたり${rule.yakuman_pt}pt（${rule.yakuman_pt * rule.yen_per_1000pt}円）`),
      h('p', { class: 'muted small' }, '精算額 =（半荘pt ＋ 一発pt ＋ 役満pt）× レート'),
    ),

    // Daily終了時の入力（①役満賞 → ②一発賞の順）
    summary.length > 0 && participantIds.has(me.id) && renderYakumanInput(),
    summary.length > 0 && participantIds.has(me.id) && renderChipInput(),

    h('div', { class: 'card' },
      h('h3', {}, `🀄 半荘記録 (${games.length})`),
      games.length === 0
        ? h('p', { class: 'muted' }, 'まだありません')
        : h('div', { class: 'games-list' },
            ...games.map(g => {
              const grs = results.filter(r => r.game_id === g.id).sort((a,b) => a.rank - b.rank);
              const enteredBy = playerMap[g.entered_by]?.name;
              return h('div', { class: 'game-card' },
                h('div', { class: 'game-head' },
                  h('strong', {}, `第${g.game_no}半荘`),
                  enteredBy && h('span', { class: 'muted small' }, `入力: ${enteredBy}`),
                  !session.closed && participantIds.has(me.id) && h('button', { class: 'btn small danger', onclick: async () => {
                    if (!confirm(`第${g.game_no}半荘を削除しますか？`)) return;
                    await sb.from('games').delete().eq('id', g.id);
                    router();
                  }}, '削除'),
                ),
                h('table', { class: 'mini' },
                  h('tbody', {}, ...grs.map(r => h('tr', {},
                    h('td', {}, `${r.rank}位`),
                    h('td', {}, playerMap[r.player_id]?.name || '(?)'),
                    h('td', { class: 'num' }, r.base_pt == null ? '' : signed(r.base_pt)),
                    h('td', { class: `num ${Number(r.final_points) >= 0 ? 'pos' : 'neg'}` }, ptFmt(r.final_points)),
                    h('td', { class: 'num small' }, r.tobi ? '💥' : ''),
                  ))),
                ),
              );
            })
          ),
    ),
  );
}

// ============================================================
// 画面：新規半荘入力
// ============================================================
async function renderNewGame(sessionId) {
  const me = getCurrentPlayer();
  const { data: session } = await sb.from('sessions').select('played_on').eq('id', sessionId).single();
  const { data: avail } = await sb.from('availability').select('player_id').eq('available_on', session.played_on);
  const participantIds = (avail || []).map(a => a.player_id);
  const participants = state.players.filter(p => participantIds.includes(p.id));

  if (!participantIds.includes(me.id)) {
    return h('div', { class: 'card err' }, 'この日の参加者ではないため、半荘記録できません');
  }
  if (participants.length < 4) {
    return h('div', { class: 'card err' }, 'この日の参加者が4人未満です（成立してないはず）');
  }

  const { data: games } = await sb.from('games').select('id').eq('session_id', sessionId);
  const nextNo = (games?.length || 0) + 1;
  const rule = state.rule;
  const umaList = [rule.uma_1st, rule.uma_2nd, -rule.uma_2nd, -rule.uma_1st];
  const nameOf = Object.fromEntries(participants.map(p => [p.id, p.name]));

  // 入力状態：トップ1人と、残り3人の申告値。rows の並び順が同値のときの着順になる
  const st = { topId: participants[0].id, rows: [] };
  const resetRows = () => {
    st.rows = participants
      .filter(p => p.id !== st.topId)
      .map(p => ({ id: p.id, name: p.name, pt: null, tobi: false }));
  };
  resetRows();

  const rowsBox = h('div', { class: 'gi-list' });
  const preview = h('div', { class: 'pv' });
  let rowRefs = [];

  const isReady = () => st.rows.length === 3 && st.rows.every(r => Number.isFinite(r.pt));

  function updateView() {
    // 各行の着順バッジと ▲ の有効/無効
    const ordered = isReady() ? orderRows(st.rows) : null;
    rowRefs.forEach((ref, i) => {
      ref.rankEl.textContent = ordered ? `${ordered.indexOf(ref.row) + 2}位` : '–';
      // 点数順は自動で決まるため、▲ が意味を持つのは「すぐ上の行と同点」のときだけ
      const above = st.rows[i - 1];
      const tied = i > 0 && above && Number.isFinite(above.pt) && Number.isFinite(ref.row.pt) && above.pt === ref.row.pt;
      ref.upBtn.disabled = !tied;
      ref.upBtn.title = tied ? '同点の相手と着順を入れ替える' : '同点のときだけ入れ替えできます';
    });

    // 集計プレビュー
    preview.innerHTML = '';
    if (!isReady()) {
      preview.append(h('p', { class: 'muted small' },
        '3人分の±を入力すると、トップの点数と全員の最終ptが表示されます'));
      return;
    }
    const results = buildResults(st.topId, orderRows(st.rows), rule);
    const total = results.reduce((sum, r) => sum + r.final_points, 0);

    preview.append(
      h('table', { class: 'mini pv-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '着順'), h('th', {}, '名前'),
          h('th', { class: 'num' }, '点数'), h('th', { class: 'num' }, 'ウマ'),
          h('th', { class: 'num' }, '最終pt'), h('th', {}, ''),
        )),
        h('tbody', {}, ...results.map((r, i) => h('tr', { class: i === 0 ? 'pv-top' : false },
          h('td', {}, `${r.rank}位`),
          h('td', {}, nameOf[r.player_id]),
          h('td', { class: `num ${r.base_pt >= 0 ? 'pos' : 'neg'}` }, signed(r.base_pt)),
          h('td', { class: 'num' }, signed(umaList[i])),
          h('td', { class: `num ${r.final_points >= 0 ? 'pos' : 'neg'}` }, signed(r.final_points)),
          h('td', {}, r.tobi ? '💥' : ''),
        ))),
      ),
      h('div', { class: `sum-display ${total === 0 ? 'ok' : 'warn'}` }, `合計: ${ptFmt(total)}`),
    );

    if (new Set(st.rows.map(r => r.pt)).size < 3) {
      preview.append(h('p', { class: 'muted small' },
        '※ 同じ点数の人がいます。着順が違う場合は ▲ で入れ替えてください'));
    }
  }

  function renderRows() {
    rowsBox.innerHTML = '';
    rowRefs = [];
    st.rows.forEach((r, i) => {
      const rankEl = h('span', { class: 'gi-rank' }, '–');
      const input = numInput({ class: 'gi-pt', placeholder: '点数', value: r.pt === null ? '' : r.pt });
      input.addEventListener('input', () => {
        const cleaned = cleanNum(input.value);
        if (cleaned !== input.value) input.value = cleaned;
        r.pt = (cleaned === '' || cleaned === '-') ? null : parseInt(cleaned, 10);
        if (!Number.isFinite(r.pt)) r.pt = null;
        updateView();
      });
      const tobiBox = h('input', { type: 'checkbox', checked: r.tobi });
      tobiBox.addEventListener('change', () => { r.tobi = tobiBox.checked; updateView(); });

      const upBtn = h('button', { class: 'btn small', type: 'button', disabled: true }, '▲');
      upBtn.addEventListener('click', () => {
        const t = st.rows[i - 1]; st.rows[i - 1] = st.rows[i]; st.rows[i] = t;
        renderRows(); updateView();
      });

      rowsBox.append(h('div', { class: 'gi-row' },
        rankEl,
        h('span', { class: 'gi-name' }, r.name),
        h('div', { class: 'gi-num' }, signBtn(input), input),
        h('label', { class: 'check' }, tobiBox, '💥ハコ'),
        upBtn,
      ));
      rowRefs.push({ row: r, rankEl, upBtn });
    });
  }

  const topSelect = h('select', {},
    ...participants.map(p => h('option', { value: p.id, selected: p.id === st.topId }, p.name)));
  topSelect.addEventListener('change', () => {
    st.topId = topSelect.value;
    resetRows(); renderRows(); updateView();
  });

  const saveBtn = h('button', { class: 'btn primary' }, '💾 記録する');
  saveBtn.addEventListener('click', async () => {
    if (!isReady()) return toast('2位〜4位の±をすべて入力してください', true);
    saveBtn.disabled = true;
    const results = buildResults(st.topId, orderRows(st.rows), rule);

    const { data: gameRow, error: e1 } = await sb.from('games').insert({
      session_id: sessionId, game_no: nextNo, entered_by: me.id,
    }).select().single();
    if (e1) { saveBtn.disabled = false; return toast(e1.message, true); }

    const { error: e2 } = await sb.from('game_results').insert(
      results.map(r => ({
        game_id: gameRow.id, player_id: r.player_id,
        base_pt: r.base_pt, rank: r.rank, final_points: r.final_points,
        tobi: r.tobi, yakitori: false,
      }))
    );
    if (e2) {
      await sb.from('games').delete().eq('id', gameRow.id);
      saveBtn.disabled = false;
      return toast(e2.message, true);
    }
    toast('記録しました');
    location.hash = `#session/${sessionId}`;
  });

  renderRows();
  updateView();

  return h('div', { class: 'card' },
    h('h3', {}, `🀄 第${nextNo}半荘を記録（${fmtDate(session.played_on)}）`),
    h('p', { class: 'muted small' },
      'トップの人を選び、残り3人が五捨六入した後の±を申告してください。トップの点数（オカ込み）とウマは自動で計算されます。'),
    h('label', { class: 'field' }, h('span', {}, '🥇 トップ'), topSelect),
    h('div', { class: 'gi-head muted small' }, '2位〜4位の申告（着順は入力値から自動で決まります）'),
    rowsBox,
    preview,
    h('div', { class: 'btn-row' },
      saveBtn,
      h('a', { class: 'btn', href: `#session/${sessionId}` }, 'キャンセル'),
    ),
  );
}

// ============================================================
// 画面：ランキング
// ============================================================
async function renderRankings() {
  const { data } = await sb.from('v_player_stats').select('*');
  const sorted = (data || []).filter(d => d.games_played > 0)
    .sort((a, b) => Number(b.total_points) - Number(a.total_points));
  return h('div', { class: 'card' },
    h('h3', {}, '🏆 全期間ランキング'),
    sorted.length === 0
      ? h('p', { class: 'muted' }, 'まだ集計データがありません')
      : h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '順'), h('th', {}, '名前'),
            h('th', { class: 'num' }, '半荘'), h('th', { class: 'num' }, '通算pt'),
            h('th', { class: 'num' }, '平均pt'), h('th', { class: 'num' }, '平均順位'),
            h('th', { class: 'num' }, 'トップ率'), h('th', { class: 'num' }, 'ラス率'),
            h('th', { class: 'num' }, 'トビ'),
          )),
          h('tbody', {}, ...sorted.map((d, i) => h('tr', {},
            h('td', {}, h('strong', {}, i + 1)),
            h('td', {}, d.name),
            h('td', { class: 'num' }, d.games_played),
            h('td', { class: `num ${Number(d.total_points) >= 0 ? 'pos' : 'neg'}` }, fmt(Number(d.total_points))),
            h('td', { class: 'num' }, Number(d.avg_points).toFixed(1)),
            h('td', { class: 'num' }, Number(d.avg_rank).toFixed(2)),
            h('td', { class: 'num' }, `${(d.first_count / d.games_played * 100).toFixed(1)}%`),
            h('td', { class: 'num' }, `${(d.fourth_count / d.games_played * 100).toFixed(1)}%`),
            h('td', { class: 'num' }, d.tobi_count || ''),
          ))),
        )),
  );
}

// ============================================================
// 画面：設定
// ============================================================
async function renderSettings() {
  const r = state.rule;
  const me = getCurrentPlayer();

  // 自分のプロフィール変更カード
  const profileCard = h('div', { class: 'card' },
    h('h3', {}, '👤 自分のプロフィール'),
    h('form', { class: 'rule-form', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const newName = f.name.value.trim();
      const newPin  = f.pin.value;
      const newPin2 = f.pin2.value;
      if (!newName) return toast('名前を入力してください', true);

      const upd = {};
      if (newName !== me.name) {
        // 重複チェック
        const dup = state.players.find(p => p.name === newName && p.id !== me.id);
        if (dup) return toast('同じ名前が既に登録されています', true);
        upd.name = newName;
      }
      if (newPin || newPin2) {
        if (!/^\d{4}$/.test(newPin)) return toast('PINは4桁の数字です', true);
        if (newPin !== newPin2) return toast('PINが一致しません', true);
        upd.pin_hash = await window.MJ_AUTH.hashPin(newPin);
      }
      if (Object.keys(upd).length === 0) return toast('変更がありません', true);

      const { error } = await sb.from('players').update(upd).eq('id', me.id);
      if (error) return toast(error.message, true);

      // ローカルのログイン情報も更新
      if (upd.name) window.MJ_AUTH.setCurrentPlayer({ id: me.id, name: upd.name });
      toast('更新しました');
      await loadPlayers();
      router();
    }},
      h('label', { class: 'field' },
        h('span', {}, '名前'),
        h('input', { name: 'name', value: me.name, required: true, maxlength: '20' }),
      ),
      h('p', { class: 'muted small' }, '※ PIN変更したいときだけ下を入力。空のままなら現在のPINが維持されます'),
      h('label', { class: 'field' },
        h('span', {}, '新しいPIN（4桁）'),
        h('input', { type: 'password', name: 'pin', inputmode: 'numeric', pattern: '\\d{4}', maxlength: '4', placeholder: '****（変更しない場合は空欄）' }),
      ),
      h('label', { class: 'field' },
        h('span', {}, '新しいPIN（確認）'),
        h('input', { type: 'password', name: 'pin2', inputmode: 'numeric', pattern: '\\d{4}', maxlength: '4', placeholder: '****（変更しない場合は空欄）' }),
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'submit' }, '💾 プロフィール更新'),
      ),
    ),
  );

  const ruleCard = h('div', { class: 'card' },
    h('h3', {}, '⚙️ ルール設定'),
    h('p', { class: 'muted small' }, '変更すると今後の試合に適用されます。'),
    h('form', { class: 'rule-form', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const upd = {
        starting_points: +f.starting_points.value, return_points: +f.return_points.value,
        uma_1st: +f.uma_1st.value, uma_2nd: +f.uma_2nd.value,
        yen_per_1000pt: +f.yen_per_1000pt.value, ippatsu_pt: +f.ippatsu_pt.value,
      };
      const { error } = await sb.from('rule_presets').update(upd).eq('id', r.id);
      if (error) return toast(error.message, true);
      toast('保存しました');
      await loadRule();
      router();
    }},
      labelInput('持ち点', 'starting_points', r.starting_points),
      labelInput('返し点', 'return_points', r.return_points),
      labelInput('1着ウマ', 'uma_1st', r.uma_1st),
      labelInput('2着ウマ', 'uma_2nd', r.uma_2nd),
      labelInput('1,000点あたりの円（レート）', 'yen_per_1000pt', r.yen_per_1000pt),
      labelInput('一発賞 1枚あたりのpt', 'ippatsu_pt', r.ippatsu_pt),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'submit' }, '💾 保存'),
      ),
    ),
  );

  const versionCard = h('p', { class: 'muted small', style: 'text-align:center; margin-top:20px;' },
    `麻雀トラッカー v${APP_VERSION}`);

  return h('div', {}, profileCard, ruleCard, versionCard);
}
function labelInput(label, name, value) {
  return h('label', { class: 'field' },
    h('span', {}, label),
    h('input', { type: 'number', name, value, required: true }),
  );
}

// ============================================================
// 起動
// ============================================================
async function bootstrap() {
  if (window.MJ_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    $('#app').innerHTML = `<div class="card err"><h3>⚠️ セットアップが必要です</h3><p>js/config.js を設定してください。</p></div>`;
    return;
  }
  try {
    await Promise.all([loadRule(), loadPlayers()]);
    await router();
  } catch (e) {
    $('#app').innerHTML = `<div class="card err"><h3>初期化エラー</h3><p>${e.message}</p><p class="muted small">supabase/schema.sql と schema_v2.sql が実行されているか確認してください。</p></div>`;
  }
}
bootstrap();
