// 各画面の描画関数を実際に呼び出し、未定義変数などの実行時エラーを検出する
function mkEl(tag){
  const el = { tagName: tag, children: [], style: {}, dataset: {},
    setAttribute(){}, removeAttribute(){}, addEventListener(){}, focus(){}, dispatchEvent(){},
    append(...c){ this.children.push(...c); }, appendChild(c){ this.children.push(c); return c; },
    remove(){}, querySelector(){ return mkEl('div'); }, querySelectorAll(){ return []; },
    classList:{ toggle(){}, add(){}, remove(){} }, nodeType:1, value:'', textContent:'', innerHTML:'', checked:false, disabled:false };
  return el;
}
var document = { createElement: mkEl, createTextNode: (t) => ({ nodeType:3, textContent:String(t) }),
  querySelector: () => mkEl('div'), querySelectorAll: () => [], body: mkEl('body') };
var localStorage = { getItem: () => JSON.stringify({ id:'p1', name:'TAKUMI' }), setItem(){}, removeItem(){} };
var location = { hash:'#home', reload(){} };
var setTimeout = (f) => 0;
var crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
var confirm = () => true;
var window = { addEventListener(){}, MJ_CONFIG:{ SUPABASE_URL:'https://x.supabase.co', SUPABASE_ANON_KEY:'k' } };

// Supabase クライアントのモック：テーブルごとに固定データを返す
const RULE = { id:'r1', starting_points:26000, return_points:30000, uma_1st:10, uma_2nd:5,
  yen_per_1000pt:50, ippatsu_pt:5, yakuman_pt:20, rank_pt_1st:30, rank_pt_2nd:10, rank_pt_3rd:-10, rank_pt_4th:-30, active:true };
const PLAYERS = [
  { id:'p1', name:'TAKUMI', is_admin:true,  pin_hash:'x' },
  { id:'p2', name:'テストA', is_admin:false, pin_hash:'x' },
  { id:'p3', name:'テストB', is_admin:false, pin_hash:'x' },
  { id:'p4', name:'テストC', is_admin:false, pin_hash:'x' },
];
const DATA = {
  rule_presets: [RULE],
  players: PLAYERS,
  sessions: [{ id:'s1', played_on:'2026-09-12', confirmed_at:'2026-09-12T00:00:00Z', closed:false, rule_id:'r1' }],
  availability: PLAYERS.map(p => ({ player_id:p.id, available_on:'2026-09-12' })),
  games: [{ id:'g1', game_no:1, session_id:'s1', entered_by:'p1' }],
  game_results: [
    { game_id:'g1', player_id:'p1', base_pt:31, rank:1, final_points:41, tobi:false },
    { game_id:'g1', player_id:'p2', base_pt:1,  rank:2, final_points:6,  tobi:false },
    { game_id:'g1', player_id:'p3', base_pt:-5, rank:3, final_points:-10, tobi:false },
    { game_id:'g1', player_id:'p4', base_pt:-27, rank:4, final_points:-37, tobi:true },
  ],
  daily_chips: [{ player_id:'p1', chip_net:5, session_id:'s1' }],
  yakuman_awards: [{ player_id:'p3', yakuman_count:1, session_id:'s1' }],
  v_availability_summary: [{ available_on:'2026-09-12', signup_count:4, player_names:PLAYERS.map(p=>p.name), player_ids:PLAYERS.map(p=>p.id) }],
  v_season_stats: PLAYERS.map((p,i) => ({ season:2026, player_id:p.id, name:p.name, games_played:3,
    total_points:[39,15,50,-104][i], first_count:1, second_count:1, third_count:1, fourth_count:[0,0,0,3][i],
    hako_count:[0,0,0,1][i], avg_rank:2.0 })),
};
function qb(table){
  const o = { data: DATA[table] || [], error: null, count: (DATA[table]||[]).length };
  const chain = new Proxy(o, { get(t, k){
    if (k === 'then') return undefined;
    if (k in t) return t[k];
    if (k === 'single' || k === 'maybeSingle') return () => ({ data: (DATA[table]||[])[0] || null, error: null });
    return () => chain;
  }});
  return chain;
}
var supabase = { createClient: () => ({ from: qb }) };
