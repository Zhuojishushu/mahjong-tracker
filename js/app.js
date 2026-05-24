// ============================================================
// 麻雀トラッカー メインアプリ
// ============================================================
const { createClient } = supabase;
const sb = createClient(window.MJ_CONFIG.SUPABASE_URL, window.MJ_CONFIG.SUPABASE_ANON_KEY);

// ---------- 状態 ----------
const state = {
  rule: null,
  players: [],
  currentSessionId: null,
};

// ---------- ユーティリティ ----------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const h  = (tag, attrs = {}, ...children) => {
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

// ---------- スコア計算 ----------
// 4人の素点 → 順位・最終ポイント
function calcResults(rawScores, rule) {
  // rawScores: [{player_id, raw_score, tobi, yakitori}]
  const oka = (rule.return_points - rule.starting_points) * 4 / 1000; // 千点単位
  const umaList = [rule.uma_1st, rule.uma_2nd, -rule.uma_2nd, -rule.uma_1st];

  // 順位決定（同点は入力順で上位）
  const indexed = rawScores.map((r, i) => ({ ...r, _idx: i }));
  indexed.sort((a, b) => b.raw_score - a.raw_score || a._idx - b._idx);

  return indexed.map((r, i) => {
    const rank = i + 1;
    const base = (r.raw_score - rule.return_points) / 1000;
    const uma  = umaList[i];
    const okaPt = rank === 1 ? oka : 0;
    const final = base + uma + okaPt;
    return { ...r, rank, final_points: Math.round(final * 10) / 10 };
  });
}

// ---------- データロード ----------
async function loadRule() {
  const { data, error } = await sb.from('rule_presets').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  state.rule = data[0];
}
async function loadPlayers() {
  const { data, error } = await sb.from('players').select('*').order('name');
  if (error) throw error;
  state.players = data;
}

// ---------- ルーター ----------
const routes = {
  '': renderHome,
  'home': renderHome,
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
  const fn = routes[route] || renderHome;
  $('#app').innerHTML = '';
  $('#app').appendChild(h('div', { class: 'loading' }, '読み込み中…'));
  try {
    const view = await fn(...params);
    $('#app').innerHTML = '';
    $('#app').appendChild(view);
    $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${route}`));
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = '';
    $('#app').appendChild(h('div', { class: 'card err' }, `エラー: ${e.message}`));
  }
}
window.addEventListener('hashchange', router);

// ============================================================
// 画面：ホーム
// ============================================================
async function renderHome() {
  const { data: sessions } = await sb.from('sessions').select('*').order('played_on', { ascending: false }).limit(5);
  const today = new Date().toISOString().slice(0, 10);
  const todaySession = sessions?.find(s => s.played_on === today && !s.closed);

  return h('div', {},
    h('div', { class: 'card hero' },
      h('h2', {}, '🀄 麻雀トラッカー'),
      h('p', { class: 'muted' }, `参加者: ${state.players.length}人 / 直近セッション: ${sessions?.length || 0}件`),
      h('div', { class: 'btn-row' },
        todaySession
          ? h('a', { class: 'btn primary', href: `#session/${todaySession.id}` }, '🎯 今日のセッションを開く')
          : h('button', { class: 'btn primary', onclick: createTodaySession }, '✨ 今日のセッションを開始'),
        h('a', { class: 'btn', href: '#players' }, '👥 参加者管理'),
        h('a', { class: 'btn', href: '#rankings' }, '🏆 ランキング'),
      ),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '直近のセッション'),
      (sessions || []).length === 0
        ? h('p', { class: 'muted' }, 'まだセッションがありません')
        : h('ul', { class: 'list' },
            ...sessions.map(s => h('li', {},
              h('a', { href: `#session/${s.id}` },
                `${s.played_on} ${s.venue || ''} ${s.closed ? '✅締め済' : '🟢進行中'}`)
            ))
          ),
    ),
  );
}

async function createTodaySession() {
  const { data, error } = await sb.from('sessions').insert({
    played_on: new Date().toISOString().slice(0, 10),
    rule_id: state.rule.id,
  }).select().single();
  if (error) return toast(error.message, true);
  location.hash = `#session/${data.id}`;
}

// ============================================================
// 画面：参加者管理
// ============================================================
async function renderPlayers() {
  await loadPlayers();
  const root = h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, '参加者を追加'),
      h('form', { class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return;
        const { error } = await sb.from('players').insert({ name });
        if (error) return toast(error.message, true);
        toast('追加しました');
        location.hash = '#players';
        router();
      }},
        h('input', { name: 'name', placeholder: '名前', required: true }),
        h('button', { class: 'btn primary', type: 'submit' }, '追加'),
      ),
    ),
    h('div', { class: 'card' },
      h('h3', {}, `参加者一覧 (${state.players.length}人)`),
      state.players.length === 0
        ? h('p', { class: 'muted' }, '参加者が未登録です')
        : h('ul', { class: 'list' },
            ...state.players.map(p => h('li', { class: 'row-between' },
              h('span', {}, p.name),
              h('button', { class: 'btn small danger', onclick: async () => {
                if (!confirm(`${p.name} を削除しますか？（過去の試合記録は残ります）`)) return;
                const { error } = await sb.from('players').delete().eq('id', p.id);
                if (error) return toast(error.message, true);
                router();
              }}, '削除'),
            ))
          ),
    ),
  );
  return root;
}

// ============================================================
// 画面：セッション一覧
// ============================================================
async function renderSessions() {
  const { data: sessions } = await sb.from('sessions').select('*').order('played_on', { ascending: false });
  return h('div', { class: 'card' },
    h('h3', {}, 'セッション一覧'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: createTodaySession }, '＋ 新規セッション（今日）'),
    ),
    (sessions || []).length === 0
      ? h('p', { class: 'muted' }, 'まだセッションがありません')
      : h('ul', { class: 'list' },
          ...sessions.map(s => h('li', {},
            h('a', { href: `#session/${s.id}` },
              `${s.played_on} ${s.venue || ''} ${s.closed ? '✅締め済' : '🟢進行中'}`)
          ))
        ),
  );
}

// ============================================================
// 画面：セッション詳細
// ============================================================
async function renderSessionDetail(sessionId) {
  state.currentSessionId = sessionId;
  const { data: session } = await sb.from('sessions').select('*').eq('id', sessionId).single();
  const { data: games }   = await sb.from('games').select('*').eq('session_id', sessionId).order('game_no');
  const gameIds = games.map(g => g.id);
  const { data: results } = gameIds.length
    ? await sb.from('game_results').select('*').in('game_id', gameIds)
    : { data: [] };

  // プレイヤー別集計
  const totals = {}; // player_id → { points, yakitori, tobi, ranks: [...] }
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

  // Daily精算（円）
  const settlements = summary.map(s => {
    const pointYen   = s.points * 1000 / 1000 * rule.yen_per_1000pt; // points は千点単位
    const yakitoriYen = -s.yakitori * 3 * rule.yakitori_yen;          // 焼き鳥は他3人へ支払い
    return { ...s, pointYen, yakitoriYen, totalYen: pointYen + yakitoriYen };
  });
  // 焼き鳥の受取分（他人の焼き鳥1枚ごとに +100円）
  const totalYakitoriChips = summary.reduce((sum, s) => sum + s.yakitori, 0);
  for (const s of settlements) {
    const receivedChips = totalYakitoriChips - s.yakitori;
    s.totalYen += receivedChips * rule.yakitori_yen;
  }

  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', {}, `📅 ${session.played_on} ${session.venue || ''}`),
        h('span', { class: 'badge' }, session.closed ? '✅締め済' : '🟢進行中'),
      ),
      h('div', { class: 'btn-row' },
        !session.closed && h('a', { class: 'btn primary', href: `#new-game/${sessionId}` }, '＋ 半荘を追加'),
        !session.closed && summary.length > 0 && h('button', { class: 'btn', onclick: async () => {
          if (!confirm('このセッションをDaily締めしますか？\n（締め後も閲覧可能ですが、新規半荘は追加できなくなります）')) return;
          const { error } = await sb.from('sessions').update({ closed: true }).eq('id', sessionId);
          if (error) return toast(error.message, true);
          toast('Daily締めしました');
          router();
        }}, '🔒 Daily締め'),
        session.closed && h('button', { class: 'btn', onclick: async () => {
          if (!confirm('Daily締めを解除しますか？')) return;
          await sb.from('sessions').update({ closed: false }).eq('id', sessionId);
          router();
        }}, '🔓 締め解除'),
        h('a', { class: 'btn', href: '#sessions' }, '← 戻る'),
      ),
    ),

    // セッション集計
    h('div', { class: 'card' },
      h('h3', {}, '💰 セッション集計（Daily精算）'),
      summary.length === 0
        ? h('p', { class: 'muted' }, 'まだ半荘が記録されていません')
        : h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, '順'),
              h('th', {}, '名前'),
              h('th', { class: 'num' }, '半荘'),
              h('th', { class: 'num' }, 'pt合計'),
              h('th', { class: 'num' }, '1/2/3/4着'),
              h('th', { class: 'num' }, '🐔'),
              h('th', { class: 'num' }, 'トビ'),
              h('th', { class: 'num' }, '精算額'),
            )),
            h('tbody', {}, ...settlements.map((s, i) => {
              const rc = [1,2,3,4].map(r => s.ranks.filter(x => x===r).length).join('/');
              return h('tr', {},
                h('td', {}, i+1),
                h('td', {}, s.name),
                h('td', { class: 'num' }, s.games),
                h('td', { class: `num ${s.points >= 0 ? 'pos' : 'neg'}` }, fmt(s.points)),
                h('td', { class: 'num small' }, rc),
                h('td', { class: 'num' }, s.yakitori || ''),
                h('td', { class: 'num' }, s.tobi || ''),
                h('td', { class: `num ${s.totalYen >= 0 ? 'pos' : 'neg'}` }, yen(s.totalYen)),
              );
            })),
          )),
      h('p', { class: 'muted small' },
        `レート: 1,000点 = ${rule.yen_per_1000pt}円 / 焼き鳥1枚 = ${rule.yakitori_yen}円（他3人へ支払い）`),
    ),

    // 半荘リスト
    h('div', { class: 'card' },
      h('h3', {}, `🀄 半荘記録 (${games.length})`),
      games.length === 0
        ? h('p', { class: 'muted' }, 'まだありません')
        : h('div', { class: 'games-list' },
            ...games.map(g => {
              const grs = results.filter(r => r.game_id === g.id).sort((a,b) => a.rank - b.rank);
              return h('div', { class: 'game-card' },
                h('div', { class: 'game-head' },
                  h('strong', {}, `第${g.game_no}半荘`),
                  !session.closed && h('button', { class: 'btn small danger', onclick: async () => {
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
  const { data: games } = await sb.from('games').select('id').eq('session_id', sessionId);
  const nextNo = (games?.length || 0) + 1;

  const form = h('div', { class: 'card' },
    h('h3', {}, `🀄 第${nextNo}半荘を記録`),
    h('p', { class: 'muted small' }, '4人を選んで素点（終局時の持ち点）を入力。順位は自動計算されます。'),
  );

  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = h('div', { class: 'game-input-row' },
      h('select', { name: `player_${i}` },
        h('option', { value: '' }, '-- 選択 --'),
        ...state.players.map(p => h('option', { value: p.id }, p.name))
      ),
      h('input', { type: 'number', name: `score_${i}`, placeholder: '素点', step: 100, inputmode: 'numeric' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `tobi_${i}` }), '💥'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `yakitori_${i}` }), '🐔'),
    );
    rows.push(row);
  }
  form.append(...rows);

  const sumDisplay = h('div', { class: 'sum-display muted' }, '合計: -');
  form.append(sumDisplay);

  // 合計の自動チェック
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
        // 収集
        const inputs = [];
        const used = new Set();
        for (let i = 0; i < 4; i++) {
          const pid = form.querySelector(`[name=player_${i}]`).value;
          const score = parseInt(form.querySelector(`[name=score_${i}]`).value, 10);
          if (!pid) return toast(`${i+1}人目のプレイヤーを選択してください`, true);
          if (used.has(pid)) return toast('同じプレイヤーが重複しています', true);
          used.add(pid);
          if (isNaN(score)) return toast(`${i+1}人目の素点を入力してください`, true);
          inputs.push({
            player_id: pid,
            raw_score: score,
            tobi: form.querySelector(`[name=tobi_${i}]`).checked,
            yakitori: form.querySelector(`[name=yakitori_${i}]`).checked,
          });
        }
        const sum = inputs.reduce((a, b) => a + b.raw_score, 0);
        if (sum !== expectedSum) {
          if (!confirm(`素点の合計が ${expectedSum.toLocaleString()} と一致しません（${sum.toLocaleString()}）。\nこのまま保存しますか？`)) return;
        }
        const computed = calcResults(inputs, state.rule);

        // INSERT
        const { data: gameRow, error: e1 } = await sb.from('games').insert({
          session_id: sessionId, game_no: nextNo,
        }).select().single();
        if (e1) return toast(e1.message, true);

        const { error: e2 } = await sb.from('game_results').insert(
          computed.map(r => ({
            game_id: gameRow.id,
            player_id: r.player_id,
            raw_score: r.raw_score,
            rank: r.rank,
            final_points: r.final_points,
            tobi: r.tobi,
            yakitori: r.yakitori,
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
// 画面：ランキング（全期間）
// ============================================================
async function renderRankings() {
  const { data, error } = await sb.from('v_player_stats').select('*');
  if (error) throw error;
  const sorted = data
    .filter(d => d.games_played > 0)
    .sort((a, b) => Number(b.total_points) - Number(a.total_points));

  return h('div', { class: 'card' },
    h('h3', {}, '🏆 全期間ランキング'),
    sorted.length === 0
      ? h('p', { class: 'muted' }, 'まだ集計データがありません')
      : h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '順'),
            h('th', {}, '名前'),
            h('th', { class: 'num' }, '半荘'),
            h('th', { class: 'num' }, '通算pt'),
            h('th', { class: 'num' }, '平均pt'),
            h('th', { class: 'num' }, '平均順位'),
            h('th', { class: 'num' }, 'トップ率'),
            h('th', { class: 'num' }, 'ラス率'),
            h('th', { class: 'num' }, '🐔'),
            h('th', { class: 'num' }, '💥'),
          )),
          h('tbody', {}, ...sorted.map((d, i) => {
            const topRate  = (d.first_count / d.games_played * 100).toFixed(1);
            const lastRate = (d.fourth_count / d.games_played * 100).toFixed(1);
            return h('tr', {},
              h('td', {}, h('strong', {}, i + 1)),
              h('td', {}, d.name),
              h('td', { class: 'num' }, d.games_played),
              h('td', { class: `num ${Number(d.total_points) >= 0 ? 'pos' : 'neg'}` }, fmt(Number(d.total_points))),
              h('td', { class: 'num' }, Number(d.avg_points).toFixed(1)),
              h('td', { class: 'num' }, Number(d.avg_rank).toFixed(2)),
              h('td', { class: 'num' }, `${topRate}%`),
              h('td', { class: 'num' }, `${lastRate}%`),
              h('td', { class: 'num' }, d.yakitori_count || ''),
              h('td', { class: 'num' }, d.tobi_count || ''),
            );
          })),
        )),
  );
}

// ============================================================
// 画面：ルール設定
// ============================================================
async function renderSettings() {
  const r = state.rule;
  return h('div', { class: 'card' },
    h('h3', {}, '⚙️ ルール設定'),
    h('p', { class: 'muted small' }, '※変更すると今後の試合に適用されます。過去の試合の最終ポイントは記録時のルールで保存済みです。'),
    h('form', { class: 'rule-form', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const upd = {
        starting_points: +f.starting_points.value,
        return_points:   +f.return_points.value,
        uma_1st:         +f.uma_1st.value,
        uma_2nd:         +f.uma_2nd.value,
        yen_per_1000pt:  +f.yen_per_1000pt.value,
        yakitori_yen:    +f.yakitori_yen.value,
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
    $('#app').innerHTML = `
      <div class="card err">
        <h3>⚠️ セットアップが必要です</h3>
        <p><code>js/config.js</code> の <code>SUPABASE_URL</code> と <code>SUPABASE_ANON_KEY</code> を、自分の Supabase プロジェクトの値に書き換えてください。</p>
        <p>取得場所: Supabase ダッシュボード → Project Settings → API</p>
      </div>`;
    return;
  }
  try {
    await Promise.all([loadRule(), loadPlayers()]);
    await router();
  } catch (e) {
    $('#app').innerHTML = `<div class="card err"><h3>初期化エラー</h3><p>${e.message}</p><p class="muted small">supabase/schema.sql が実行されているか確認してください。</p></div>`;
  }
}
bootstrap();
