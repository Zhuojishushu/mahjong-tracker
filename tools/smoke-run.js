(async () => {
  state.rule = RULE; state.players = PLAYERS;
  const screens = [
    ['ホーム', () => renderHome()],
    ['カレンダー', () => renderCalendar()],
    ['参加者', () => renderPlayers()],
    ['セッション一覧', () => renderSessions()],
    ['セッション詳細', () => renderSessionDetail('s1')],
    ['半荘入力', () => renderNewGame('s1')],
    ['全体掲示板', () => renderBoard()],
    ['ランキング', () => renderRankings()],
    ['設定（管理者）', () => renderSettings()],
    ['ログイン', () => renderLogin()],
  ];
  let ng = 0;
  for (const [name, fn] of screens) {
    try { await fn(); print(`   ${name.padEnd(16)} OK`); }
    catch (e) { ng++; print(`   ${name.padEnd(16)} *** ${e} ***`); }
  }
  // 一般メンバーとして設定画面を描画
  PLAYERS[0].is_admin = false;
  try { await renderSettings(); print('   設定（一般）      OK'); }
  catch (e) { ng++; print(`   設定（一般）      *** ${e} ***`); }
  print('');
  print(ng === 0 ? '全画面の描画に成功しました' : `${ng}件の画面でエラー`);
})();
