const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext, elementStub } = require('./helpers');

// ----- UI stub: records what the controller asks the UI to do -----
const toasts = [];
const modals = [];
const UI = {
  state: {},
  canvas: { listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } },
  pos: null,
  render() {}, updateMoveHistory() {}, updateTurnIndicator() {},
  pushedScores: [], evalScore: undefined,
  updateEvalBar(v) { UI.pushedScores.push(v); UI.evalScore = v; },   // bar + a new point on the history chart
  setEvalBar(v) { UI.evalScore = v; },                              // bar only
  showMoveQuality() {},
  setAnalysisVariations(vars, idx) { UI.state.analysisVariations = vars; UI.state.activeVariationIdx = idx; },
  clearAnalysisVariations() { UI.state.analysisVariations = null; },
  animateMove: (b, a, c, d, e, done) => done(),
  showToast: (msg, type) => toasts.push({ msg, type }),
  getClickPos() { return UI.pos; },
};
// game-over modal elements are looked up by id; capture the title
const modalTitle = elementStub();
const elements = new Map([['modal-title', modalTitle]]);   // stable per-id elements so tests can inspect them
const document = {
  getElementById: (id) => { if (!elements.has(id)) elements.set(id, elementStub()); return elements.get(id); },
  createElement: () => elementStub(),
  querySelector: () => elementStub(),
  querySelectorAll: () => [],
  addEventListener() {},
};

const { get } = loadContext(['xiangqi', 'engine', 'lessons', 'main'], { UI, document });
const X = get('XIANGQI');
const Game = get('Game');
const LESSONS = get('LESSONS');
const state = Game.getState();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (cond, ms = 6000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(25);
  }
};
const click = async (row, col) => { UI.pos = { row, col }; await UI.canvas.listeners[0]({}); await sleep(2); };
const play = async (uci) => {
  const m = X.parseUCI(uci);
  await click(m.fromRow, m.fromCol);
  await click(m.toRow, m.toCol);
};
const uciHistory = () => Array.from(state.moveHistory, m => m.uci);
const anyLegalUci = (color) => {
  const m = X.getLegalMoves(state.board, color)[0];
  return X.moveToUCI(m.fromRow, m.fromCol, m.toRow, m.toCol);
};

test.before(async () => { await Game.init(); });
// setMode keeps the current position (so a game can be analysed), hence tests reset explicitly
const start = (mode = 'pvp', fen = null) => { Game.setMode(mode); Game.newGame(fen); toasts.length = 0; };
test.beforeEach(() => start('pvp'));

test('human-vs-human moves alternate turns and record history', async () => {
  await play('h3e3'); await play('h8e8'); await play('b1c3');
  assert.deepEqual(uciHistory(), ['h3e3', 'h8e8', 'b1c3']);
  assert.equal(state.turn, 'black');
  assert.equal(state.moveHistory[0].vn, 'P2-5');
});

test('illegal destinations and wrong-colour pieces are ignored', async () => {
  await play('h3h8');   // cannon cannot jump straight to a black cannon
  await play('h8e8');   // black piece while it is red's turn
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.turn, 'red');
});

test('history navigation: start, next, prev, last, and click returns to live', async () => {
  await play('h3e3'); await play('h8e8'); await play('b1c3');
  const live = state.board;

  Game.goToMove(0);
  assert.equal(state.viewIdx, 0);
  assert.notEqual(UI.state.board, live, 'UI shows an old position');
  assert.equal(state.board, live, 'live board is untouched while browsing');

  Game.goToNextMove(); assert.equal(state.viewIdx, 1);
  Game.goToPrevMove(); assert.equal(state.viewIdx, 0);
  Game.goToPrevMove(); assert.equal(state.viewIdx, 0, 'cannot go before the start');
  Game.goToLastMove(); assert.equal(state.viewIdx, -1);
  Game.goToNextMove(); assert.equal(state.viewIdx, -1, 'cannot go past the end');

  Game.goToPrevMove();
  assert.equal(state.viewIdx, 2);
  await click(0, 0);   // any click while browsing returns to the live position
  assert.equal(state.viewIdx, -1);
  assert.equal(UI.state.board, state.board);
});

test('undo restores board, turn and move number', async () => {
  await play('h3e3'); await play('h8e8');
  const fenAfterTwo = X.boardToFEN(state.board, state.turn, state.moveNumber);
  await play('b1c3');
  Game.undoMove();
  assert.deepEqual(uciHistory(), ['h3e3', 'h8e8']);
  assert.equal(state.turn, 'red');
  assert.equal(state.moveNumber, 2);
  assert.equal(X.boardToFEN(state.board, state.turn, state.moveNumber), fenAfterTwo);
  Game.undoMove(); Game.undoMove();
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.moveNumber, 1);
  assert.equal(X.boardToFEN(state.board, state.turn, state.moveNumber), X.DEFAULT_FEN);
  Game.undoMove();
  assert.equal(toasts.at(-1).type, 'error', 'nothing left to undo');
});

test('newGame resets everything and rejects a bad FEN without side effects', async () => {
  await play('h3e3');
  Game.newGame();
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.turn, 'red');
  await play('h3e3');
  const before = X.boardToFEN(state.board, state.turn);
  assert.throws(() => Game.newGame('not a fen'), (e) => typeof e?.message === 'string');
  assert.equal(X.boardToFEN(state.board, state.turn), before, 'state intact after bad FEN');
  assert.equal(state.moveHistory.length, 1);
});

test('checkmate ends the game and blocks further moves', async () => {
  start('analyze', LESSONS[4].fen);   // double-rook mate in one
  await play('i1i10');
  assert.equal(state.gameOver, true);
  await sleep(600);
  assert.equal(modalTitle.textContent, 'Chiếu bí!');
  await play('a9a8');
  assert.equal(state.moveHistory.length, 1, 'no moves after game over');
});

test('having no legal move loses (stalemate is not a draw)', async () => {
  // After Ra9-g9 Black's king has no safe square and is not in check
  start('analyze', '3k5/R8/9/9/9/9/9/9/9/4K3R w - - 0 1');
  await play('a9g9');
  assert.equal(state.gameOver, true);
  await sleep(600);
  assert.equal(modalTitle.textContent, 'Vây bí!');
});

test('three-fold repetition is a draw', async () => {
  start('analyze', '3k5/9/9/9/9/9/9/9/9/R4K3 w - - 0 1');
  const cycle = async () => { await play('a1a2'); await play('d10e10'); await play('a2a1'); await play('e10d10'); };
  await cycle();
  assert.equal(state.gameOver, false, 'second occurrence is not yet a draw');
  await cycle();
  assert.equal(state.gameOver, true, 'third occurrence of the start position');
  await sleep(600);
  assert.equal(modalTitle.textContent, 'Hòa!');
});

test('player vs AI: AI replies, undo removes both plies', async () => {
  start('pvai'); Game.setAILevel(2);
  await play('h3e3');
  await waitFor(() => state.moveHistory.length === 2 && !state.isAIThinking);
  assert.equal(state.turn, 'red');
  assert.equal(state.moveHistory[1].turnBefore, 'black');

  await play(anyLegalUci('red'));
  await waitFor(() => state.moveHistory.length === 4 && !state.isAIThinking);
  Game.undoMove();
  assert.equal(state.moveHistory.length, 2);
  assert.equal(state.turn, 'red');
});

test('player as black: AI opens, and that opening cannot be undone', async () => {
  Game.setAILevel(2);
  Game.setPlayerColor('black');                          // a setting: it applies to the next game
  start('pvai');                                         // choosing the mode in the menu starts that game
  await waitFor(() => state.moveHistory.length === 1 && !state.isAIThinking);
  assert.equal(state.turn, 'black');
  toasts.length = 0;
  Game.undoMove();
  assert.equal(state.moveHistory.length, 1);
  assert.equal(toasts.at(-1).type, 'error');
  Game.setPlayerColor('red');
});

test('a game reset while the AI is thinking discards the stale AI move', async () => {
  start('pvai'); Game.setAILevel(2);
  await play('h3e3');          // AI move is scheduled (400ms) and then computed
  Game.newGame();              // reset before it lands
  await sleep(2500);           // longer than the AI's 400ms delay + thinking time
  assert.equal(state.moveHistory.length, 0, 'stale AI move must not be applied to the new game');
});

test('every lesson FEN is valid and playable', () => {
  assert.ok(LESSONS.length >= 8);
  for (const l of LESSONS) {
    assert.ok(l.title && l.desc && ['beginner', 'intermediate', 'advanced'].includes(l.difficulty), l.title);
    const fen = l.fen || X.DEFAULT_FEN;
    const p = X.parseFEN(fen);
    assert.equal(X.getGameState(p.board, p.turn), 'playing', `${l.title} starts mid-game`);
  }
});

test('history buttons are disabled at the ends of the history', async () => {
  const dis = (id) => elements.get(id).disabled;
  assert.ok(dis('hist-first') && dis('hist-prev') && dis('hist-next') && dis('hist-last'), 'empty game');
  await play('h3e3'); await play('h8e8');
  assert.equal(dis('hist-prev'), false); assert.equal(dis('hist-next'), true);
  Game.goToMove(0);
  assert.equal(dis('hist-prev'), true); assert.equal(dis('hist-first'), true);
  assert.equal(dis('hist-next'), false); assert.equal(dis('hist-last'), false);
  Game.goToNextMove();
  assert.equal(dis('hist-prev'), false);
  Game.goToLastMove();
  assert.equal(dis('hist-next'), true);
});

test('browsing history shows the viewed turn and clears stale candidate arrows', async () => {
  await play('h3e3'); await play('h8e8');
  UI.state.analysisVariations = [{ firstMove: 'a1a2' }];
  Game.goToMove(1);
  assert.equal(UI.state.analysisVariations, null);
  Game.goToLastMove();
});

test('choosing a mode starts a fresh game (also the mode already in use)', async () => {
  start('pvp');
  await play('h3e3'); await play('h8e8');
  assert.equal(state.moveHistory.length, 2);

  for (const mode of ['analyze', 'pvp', 'pvai', 'pvp']) {
    await play('h3e3');                                  // something to lose
    Game.setMode(mode);
    assert.equal(state.mode, mode);
    assert.equal(state.moveHistory.length, 0, `${mode}: history reset`);
    assert.equal(state.turn, 'red');
    assert.equal(X.boardToFEN(state.board, state.turn, state.moveNumber), X.DEFAULT_FEN, `${mode}: standard position`);
    assert.equal(state.gameOver, false);
    assert.equal(UI.state.moveBadge, null);
    assert.equal(UI.state.lastMove, null);
  }
});

test('hint button suggests exactly ONE move (a single arrow, no chain) and a move clears it', async () => {
  await Game.requestHint();
  assert.equal(UI.state.analysisVariations, null, 'no multi-line analysis drawn');
  const hint = UI.state.hintMove;
  assert.match(hint, /^[a-i](10|[1-9])[a-i](10|[1-9])$/, 'one UCI move');
  const m = X.parseUCI(hint);
  assert.ok(X.isLegalMove(state.board, m.fromRow, m.fromCol, m.toRow, m.toCol, state.turn), 'and it is legal');
  assert.match(elements.get('status-message').textContent, /Gợi ý: .*\(/);
  await play(hint);
  assert.equal(state.moveHistory.length, 1);
  assert.equal(UI.state.hintMove, null, 'the arrow disappears after a move');
});

test('the hint button asks the engine for a single line only', async () => {
  const Engine = get('Engine');
  const original = Engine.analyzeMultiPV;
  const asked = [];
  Engine.analyzeMultiPV = (fen, depth, n, ...rest) => { asked.push(n); return original(fen, depth, n, ...rest); };
  try { await Game.requestHint(); } finally { Engine.analyzeMultiPV = original; }
  assert.deepEqual(asked, [1]);
});

test('setPosition restarts history so undo cannot restore a stale board', async () => {
  await play('h3e3'); await play('h8e8');
  const board = X.parseFEN('3k5/9/9/9/9/9/9/9/9/R4K3 w - - 0 1').board;
  Game.setPosition(board, 'black');
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.turn, 'black');
  assert.equal(state.boardHistory.length, 1);
  toasts.length = 0;
  Game.undoMove();
  assert.equal(toasts.at(-1).type, 'error', 'nothing to undo');
  assert.equal(X.boardToFEN(state.board, state.turn).split(' ')[0], '3k5/9/9/9/9/9/9/9/9/R4K3');
});

test('setPosition accepts in-progress editor positions that FEN validation would reject', () => {
  const board = X.createEmptyBoard();
  board[0][4] = 'k'; board[9][4] = 'K';           // generals facing
  assert.doesNotThrow(() => Game.setPosition(board, 'red'));
  assert.equal(state.gameOver, false);
});

// ---------- move-quality badge on the piece that has just moved ----------
const evaluated = (idx) => waitFor(() => state.moveHistory[idx] && state.moveHistory[idx].quality, 12000);

// Hold the evaluation back so the "not judged yet" moment can be observed (the built-in engine is synchronous)
function gatedEvaluation() {
  const Engine = get('Engine');
  const original = Engine.analyzePosition;
  let release;
  const gate = new Promise(r => { release = r; });
  Engine.analyzePosition = async (...args) => { await gate; return original(...args); };
  return { release, restore: () => { Engine.analyzePosition = original; } };
}

test('the evaluation badge appears on the piece that moved, once the move has been judged', async () => {
  start('pvp');
  const held = gatedEvaluation();
  try {
    await play('h3e3');                                   // red cannon to e3 => (row 7, col 4)
    assert.equal(UI.state.moveBadge, null, 'nothing yet: the move has not been evaluated');
    held.release();
    await evaluated(0);
  } finally { held.restore(); }
  const badge = UI.state.moveBadge;
  assert.deepEqual([badge.row, badge.col], [7, 4]);
  assert.equal(badge.quality.key, state.moveHistory[0].quality.key);
  assert.ok(badge.quality.symbol && badge.quality.color, 'ready to draw');
});

test('a new move removes the old badge until it has been judged itself', async () => {
  start('pvp');
  await play('h3e3'); await evaluated(0);
  assert.ok(UI.state.moveBadge, 'the first move is judged');
  const held = gatedEvaluation();
  try {
    await play('h8e8');
    assert.equal(UI.state.moveBadge, null, 'the old badge is gone while the new move is unjudged');
    held.release();
    await evaluated(1);
  } finally { held.restore(); }
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [2, 4], 'now on the black cannon');
});

test('browsing history shows the badge of the viewed move; undo and a new game clear or restore it', async () => {
  start('pvp');
  await play('h3e3'); await evaluated(0);
  await play('h8e8'); await evaluated(1);

  Game.goToMove(1);
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [7, 4], 'the first move');
  assert.equal(UI.state.moveBadge.quality.key, state.moveHistory[0].quality.key);
  Game.goToMove(0);
  assert.equal(UI.state.moveBadge, null, 'the start position has no move');
  Game.goToLastMove();
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [2, 4]);

  Game.undoMove();
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [7, 4], 'the earlier move is the last one again');

  Game.newGame();
  assert.equal(UI.state.moveBadge, null);
});

test('analysis mode judges the moves of BOTH sides and shows the badge too', async () => {
  start('analyze');
  await play('h3e3'); await evaluated(0);                // Red's move
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [7, 4]);
  assert.equal(UI.state.moveBadge.quality.key, state.moveHistory[0].quality.key);

  await play('h8e8'); await evaluated(1);                // Black's move, still the analysing user playing
  assert.deepEqual([UI.state.moveBadge.row, UI.state.moveBadge.col], [2, 4]);
  assert.equal(state.moveHistory[1].turnBefore, 'black');
});

test('switching between analysis and playing clears the badge together with the game', async () => {
  start('analyze');
  await play('h3e3'); await evaluated(0);
  assert.ok(UI.state.moveBadge);
  Game.setMode('pvp');
  assert.equal(UI.state.moveBadge, null);
  assert.equal(state.moveHistory.length, 0);
});

test('a move that is not evaluated (the AI\'s own) gets no badge', async () => {
  start('pvai'); Game.setAILevel(2);
  await play('h3e3');
  await waitFor(() => state.moveHistory.length === 2 && !state.isAIThinking);
  assert.equal(state.moveHistory[1].quality, null);
  assert.equal(UI.state.moveBadge, null);
});

// ---------- the evaluation bar while browsing ----------

test('browsing history re-displays the bar (Red\'s point of view) without adding points to the history chart', async () => {
  start('pvp');
  await play('h3e3'); await evaluated(0);                 // Red's move
  await play('h8e8'); await evaluated(1);                 // Black's move
  const pushed = UI.pushedScores.length;

  const red = (m) => (m.turnBefore === 'red' ? m.scoreAfter : -m.scoreAfter);   // mover's view -> Red's view
  Game.goToMove(1);
  assert.equal(UI.evalScore, red(state.moveHistory[0]));
  Game.goToMove(2);
  assert.equal(UI.evalScore, red(state.moveHistory[1]));
  Game.goToMove(0);
  assert.equal(UI.evalScore, 0, 'the start position is even');
  Game.goToLastMove(); Game.goToPrevMove(); Game.goToNextMove();
  assert.equal(UI.pushedScores.length, pushed, 'the chart gets no extra points from browsing');
});

test('browsing to a move that was not judged shows a blank bar instead of a made-up number', async () => {
  start('pvp');
  Game.toggleAnalysis();                                  // switch judging off: the moves below stay unjudged
  try {
    await play('h3e3'); await play('h8e8'); await play('b1c3');
    assert.ok(state.moveHistory.every(m => !m.quality), 'nothing was judged');
    Game.goToMove(1);
    assert.equal(UI.evalScore, null, 'unknown, not 0.00');
    Game.goToMove(0);
    assert.equal(UI.evalScore, 0, 'but the start position is known to be even');
  } finally {
    Game.toggleAnalysis();                                // back on for the other tests
  }
  assert.equal(state.analysisEnabled, true);
});

// ---------- AI variety follows the difficulty level ----------

async function aiVarietyAt(level, plies = 1) {
  const Engine = get('Engine');
  const original = Engine.getBestMove;
  let asked = null;
  Engine.getBestMove = (fen, depth, ms, opts) => { asked = { depth, ms, opts }; return original(fen, depth, ms, opts); };
  try {
    start('pvai'); Game.setAILevel(level);
    await play('h3e3');
    await waitFor(() => asked !== null);
    await waitFor(() => state.moveHistory.length === 2 && !state.isAIThinking);
  } finally { Engine.getBestMove = original; }
  return asked;
}

test('the AI asks for variety according to its level; the top level asks for none', async () => {
  const Engine = get('Engine');
  const strong = await aiVarietyAt(10);
  assert.equal(strong.opts.variety.margin, 0, 'level 10: always the best move');
  const weak = await aiVarietyAt(3);
  assert.deepEqual(JSON.parse(JSON.stringify(weak.opts.variety)), JSON.parse(JSON.stringify(Engine.varietyForLevel(3, 1))));
  assert.ok(weak.opts.variety.margin > 0);
  assert.ok(weak.depth < strong.depth, 'weaker levels also search less deep');
  Game.setAILevel(5);
});

test('the AI never repeats a forced answer: the same human move leads to different replies across games', async () => {
  const replies = new Set();
  for (let g = 0; g < 8; g++) {
    start('pvai'); Game.setAILevel(2);
    await play('h3e3');
    await waitFor(() => state.moveHistory.length === 2 && !state.isAIThinking);
    replies.add(state.moveHistory[1].uci);
  }
  Game.setAILevel(5);
  assert.ok(replies.size >= 3, `the same opening move got ${replies.size} different replies: ${[...replies]}`);
});
