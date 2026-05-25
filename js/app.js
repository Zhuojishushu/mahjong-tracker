// ============================================================
// 麻雀トラッカー メインアプリ v2
// - 名前+PINログイン
// - カレンダー参加申込（4人で自動成立）
// ============================================================
const { createClient } = supabase;
const sb = createClient(window.MJ_CONFIG.SUPABASE_URL, window.MJ_CONFIG.SUPABASE_ANON_KEY);
const { hashPin, getCurrentPlayer, setCurrentPlayer, logout } = window.MJ_AUTH;

// ---------- 状態 ----------
const state = { rule: null, players: [] };

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
const dayJa = (d) => ['日','月','火','水','木','金','土'][new Date(d).getDay()];
const fmtDate = (d) => {
  const dt = new Date(d);
  return `${dt.getMonth()+1}月${dt.getDate()}日(${dayJa(d)})`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------- スコア計算 ----------
function calcResults(rawScores, rule) {
  const oka = (rule.return_points - rule.starting_points) * 4 / 1000;
  const umaList = [rule.uma_1st, rule.uma_2nd, -rule.uma_2nd, -rule.uma_1st];
  const indexed = rawScores.map((r, i) => ({ ...r, _idx: i }));
  indexed.sort((a, b) => b.raw_score - a.raw_score || a._idx - b._idx);
  return indexed.map((r, i) => {
    const rank = i + 1;
    const base = (r.raw_score - rule.return_points) / 1000;
    const uma  = umaList[i];
    const okaPt = rank === 1 ? oka : 0;
    return { ...r, rank, final_points: Math.round((base + uma + okaPt) * 10) / 10 };
  });
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
      h('input', { name: 'name', required: true, maxlength: '20', placeholder: '例: テンマ' }),
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
// 画面：カレンダー（参加申込）
// ============================================================
async function renderCalendar() {
  const me = getCurrentPlayer();
  const today = todayISO();

  // 集計取得
  const { data: summary } = await sb.from('v_availability_summary')
    .select('*').gte('available_on', today).order('available_on');
  // 確定セッション
  const { data: sessions } = await sb.from('sessions')
    .select('*').not('confirmed_at', 'is', null).gte('played_on', today);
  const sessionByDate = Object.fromEntries((sessions || []).map(s => [s.played_on, s]));

  // 自分の申込
  const { data: myAvail } = await sb.from('availability')
    .select('available_on').eq('player_id', me.id).gte('available_on', today);
  const mySet = new Set((myAvail || []).map(a => a.available_on));

  const newSignup = h('div', { class: 'card' },
    h('h3', {}, '➕ この日空いてる'),
    h('p', { class: 'muted small' }, '空いている日を選んで「参加申込」を押すと、他のメンバーに表示されます。4人揃ったら自動で開催成立です。'),
    h('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault();
      const date = e.target.date.value;
      if (!date) return;
      await signUp(date);
    }},
      h('input', { type: 'date', name: 'date', min: today, required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, '参加申込'),
    ),
  );

  const listCard = h('div', { class: 'card' },
    h('h3', {}, `📅 参加申込状況 (${(summary || []).length}日)`),
    (summary || []).length === 0
      ? h('p', { class: 'muted' }, 'まだ誰も参加申込していません。上から自分の都合の良い日を申し込んでください')
      : h('div', { class: 'cal-list' },
          ...summary.map(s => renderDateCard(s, sessionByDate[s.available_on], mySet.has(s.available_on)))
        ),
  );

  return h('div', {}, newSignup, listCard);

  function renderDateCard(s, session, isJoined) {
    const count = Number(s.signup_count);
    const isConfirmed = count >= 4;
    return h('div', { class: `cal-card ${isConfirmed ? 'confirmed' : ''}` },
      h('div', { class: 'cal-head' },
        h('div', { class: 'cal-date' }, fmtDate(s.available_on)),
        isConfirmed
          ? h('span', { class: 'badge confirmed-badge' }, '🎉 成立')
          : h('span', { class: 'badge' }, `${count}/4`),
      ),
      h('div', { class: 'cal-players' }, (s.player_names || []).join('・')),
      h('div', { class: 'btn-row' },
        isJoined
          ? h('button', { class: 'btn danger small', onclick: () => cancelSignUp(s.available_on) }, '申込取消')
          : !isConfirmed && h('button', { class: 'btn primary small', onclick: () => signUp(s.available_on) }, '自分も参加'),
        isConfirmed && session && h('a', { class: 'btn small', href: `#session/${session.id}` }, '→ 試合記録へ'),
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
    // 4人になったらセッション自動生成
    const { count } = await sb.from('availability').select('*', { count: 'exact', head: true }).eq('available_on', date);
    if (count === 4) {
      const { data: existing } = await sb.from('sessions').select('id').eq('played_on', date).maybeSingle();
      if (!existing) {
        await sb.from('sessions').insert({
          played_on: date,
          rule_id: state.rule.id,
          confirmed_at: new Date().toISOString(),
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
  const settlements = summary.map(s => {
    const pointYen = s.points * rule.yen_per_1000pt;
    return { ...s, totalYen: pointYen - s.yakitori * 3 * rule.yakitori_yen };
  });
  const totalYakitoriChips = summary.reduce((sum, s) => sum + s.yakitori, 0);
  for (const s of settlements) {
    s.totalYen += (totalYakitoriChips - s.yakitori) * rule.yakitori_yen;
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
              h('th', { class: 'num' }, '🐔'), h('th', { class: 'num' }, 'トビ'),
              h('th', { class: 'num' }, '精算額'),
            )),
            h('tbody', {}, ...settlements.map((s, i) => {
              const rc = [1,2,3,4].map(r => s.ranks.filter(x => x===r).length).join('/');
              return h('tr', {},
                h('td', {}, i+1), h('td', {}, s.name),
                h('td', { class: 'num' }, s.games),
                h('td', { class: `num ${s.points >= 0 ? 'pos' : 'neg'}` }, fmt(s.points)),
                h('td', { class: 'num small' }, rc),
                h('td', { class: 'num' }, s.yakitori || ''),
                h('td', { class: 'num' }, s.tobi || ''),
                h('td', { class: `num ${s.totalYen >= 0 ? 'pos' : 'neg'}` }, yen(s.totalYen)),
              );
            })),
          )),
      h('p', { class: 'muted small' }, `レート: 1,000点 = ${rule.yen_per_1000pt}円 / 焼き鳥1枚 = ${rule.yakitori_yen}円`),
    ),

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
                    h('td', { class: 'num' }, r.raw_score.toLocaleString()),
                    h('td', { class: `num ${Number(r.final_points) >= 0 ? 'pos' : 'neg'}` }, fmt(r.final_points)),
                    h('td', { class: 'num small' }, [r.tobi && '💥', r.yakitori && '🐔'].filter(Boolean).join('')),
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

  const form = h('div', { class: 'card' },
    h('h3', {}, `🀄 第${nextNo}半荘を記録（${fmtDate(session.played_on)}）`),
    h('p', { class: 'muted small' }, '4人を選んで素点（終局時の持ち点）を入力。順位は自動計算されます。'),
  );

  // デフォルトでこの日の参加者4人を埋める
  const defaultOrder = participants.slice(0, 4);
  for (let i = 0; i < 4; i++) {
    form.append(h('div', { class: 'game-input-row' },
      h('select', { name: `player_${i}` },
        h('option', { value: '' }, '-- 選択 --'),
        ...participants.map(p =>
          h('option', { value: p.id, selected: defaultOrder[i]?.id === p.id }, p.name)
        ),
      ),
      h('input', { type: 'number', name: `score_${i}`, placeholder: '素点', step: 100, inputmode: 'numeric' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `tobi_${i}` }), '💥'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `yakitori_${i}` }), '🐔'),
    ));
  }

  const sumDisplay = h('div', { class: 'sum-display muted' }, '合計: -');
  form.append(sumDisplay);

  const expectedSum = state.rule.starting_points * 4;
  form.addEventListener('input', () => {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const v = parseInt(form.querySelector(`[name=score_${i}]`).value, 10);
      if (!isNaN(v)) sum += v;
    }
    sumDisplay.textContent = `合計: ${sum.toLocaleString()} / ${expectedSum.toLocaleString()}（差 ${(sum - expectedSum).toLocaleString()}）`;
    sumDisplay.className = sum === expectedSum ? 'sum-display ok' : 'sum-display warn';
  });

  form.append(
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: async () => {
        const inputs = [];
        const used = new Set();
        for (let i = 0; i < 4; i++) {
          const pid = form.querySelector(`[name=player_${i}]`).value;
          const score = parseInt(form.querySelector(`[name=score_${i}]`).value, 10);
          if (!pid) return toast(`${i+1}人目を選択してください`, true);
          if (used.has(pid)) return toast('同じプレイヤーが重複しています', true);
          used.add(pid);
          if (isNaN(score)) return toast(`${i+1}人目の素点を入力してください`, true);
          inputs.push({
            player_id: pid, raw_score: score,
            tobi: form.querySelector(`[name=tobi_${i}]`).checked,
            yakitori: form.querySelector(`[name=yakitori_${i}]`).checked,
          });
        }
        const sum = inputs.reduce((a, b) => a + b.raw_score, 0);
        if (sum !== expectedSum) {
          if (!confirm(`素点の合計が ${expectedSum.toLocaleString()} と一致しません（${sum.toLocaleString()}）。\nこのまま保存しますか？`)) return;
        }
        const computed = calcResults(inputs, state.rule);

        const { data: gameRow, error: e1 } = await sb.from('games').insert({
          session_id: sessionId, game_no: nextNo, entered_by: me.id,
        }).select().single();
        if (e1) return toast(e1.message, true);

        const { error: e2 } = await sb.from('game_results').insert(
          computed.map(r => ({
            game_id: gameRow.id, player_id: r.player_id,
            raw_score: r.raw_score, rank: r.rank, final_points: r.final_points,
            tobi: r.tobi, yakitori: r.yakitori,
          }))
        );
        if (e2) {
          await sb.from('games').delete().eq('id', gameRow.id);
          return toast(e2.message, true);
        }
        toast('記録しました');
        location.hash = `#session/${sessionId}`;
      }}, '💾 記録する'),
      h('a', { class: 'btn', href: `#session/${sessionId}` }, 'キャンセル'),
    ),
  );

  return form;
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
            h('th', { class: 'num' }, '🐔'), h('th', { class: 'num' }, '💥'),
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
            h('td', { class: 'num' }, d.yakitori_count || ''),
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
  return h('div', { class: 'card' },
    h('h3', {}, '⚙️ ルール設定'),
    h('p', { class: 'muted small' }, '変更すると今後の試合に適用されます。'),
    h('form', { class: 'rule-form', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const upd = {
        starting_points: +f.starting_points.value, return_points: +f.return_points.value,
        uma_1st: +f.uma_1st.value, uma_2nd: +f.uma_2nd.value,
        yen_per_1000pt: +f.yen_per_1000pt.value, yakitori_yen: +f.yakitori_yen.value,
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
      labelInput('焼き鳥1枚（円）', 'yakitori_yen', r.yakitori_yen),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'submit' }, '💾 保存'),
      ),
    ),
  );
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
