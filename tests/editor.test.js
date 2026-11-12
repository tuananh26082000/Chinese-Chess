const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext, elementStub } = require('./helpers');

const toasts = [];
const UI = {
  state: {}, canvas: { listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } }, pos: null,
  getClickPos() { return UI.pos; },
  render() {}, updateMoveHistory() {}, updateTurnIndicator() {}, updateEvalBar() {}, showMoveQuality() {},
  evalScore: undefined, setEvalBar(v) { UI.evalScore = v; },
  animateMove: (b, a, c, d, e, done) => done(),
  showToast: (msg, type) => toasts.push({ msg, type }),
  setAnalysisVariations(vars, idx) { UI.state.analysisVariations = vars; UI.state.activeVariationIdx = idx; },
  clearAnalysisVariations() { UI.state.analysisVariations = null; },
};
const elements = new Map();
const filterButtons = ['off', 'both', 'red', 'black'].map(f => Object.assign(elementStub(), { dataset: { filter: f } }));
const storage = new Map();
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
const body = elementStub();
let clipboardText = null;
const navigator = { clipboard: { writeText: (t) => { clipboardText = t; return Promise.resolve(); } } };
const document = {
  body,
  getElementById: (id) => { if (!elements.has(id)) elements.set(id, Object.assign(elementStub(), { textContent: '', innerHTML: '' })); return elements.get(id); },
  createElement: () => elementStub(),
  querySelector: () => elementStub(),
  querySelectorAll: (sel) => (sel === '[data-filter]' ? filterButtons : []),
  addEventListener() {},
};

const ctxMatchMedia = { matches: false };   // phone-sized screen?
const { get } = loadContext(['xiangqi', 'engine', 'lessons', 'main', 'editor'], { UI, document, localStorage, navigator, matchMedia: () => ctxMatchMedia });
const X = get('XIANGQI');
const Game = get('Game');
const Editor = get('BoardEditor');
const state = Game.getState();

const facingGenerals = () => { const b = X.createEmptyBoard(); b[0][4] = 'k'; b[9][4] = 'K'; return b; };
const boardFen = () => X.boardToFEN(state.board, state.turn).split(' ')[0];
const plain = (o) => JSON.parse(JSON.stringify(o));   // objects built inside the vm are another realm
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lastToast = () => toasts.at(-1);

const click = async (row, col) => { UI.pos = { row, col }; await UI.canvas.listeners[0]({}); await sleep(2); };

test.before(async () => { await Game.init(); });
test.beforeEach(() => {
  Game.setMode('pvp');                // leaving analysis mode always resets the setup state
  Game.setMode('analyze'); Game.newGame(); Editor.selectTool('move');
  Editor.toggleAutoAnalyze(false);   // keep unit tests free of background engine work
  Editor.getState().suggestFilter = 'both';
  Editor.setSheetCollapsed(false);
  toasts.length = 0;
});

test('placement zones follow the rules of xiangqi', () => {
  const ok = (p, r, c) => Editor.isSquareLegalForPiece(p, r, c).legal;
  assert.ok(ok('K', 9, 4) && ok('K', 7, 3) && !ok('K', 6, 4) && !ok('K', 9, 2), 'red general stays in the red palace');
  assert.ok(ok('k', 0, 4) && !ok('k', 3, 4), 'black general stays in the black palace');
  assert.ok(ok('A', 8, 4) && ok('A', 9, 3) && !ok('A', 8, 3), 'advisor: the 5 diagonal points only');
  assert.ok(ok('B', 9, 2) && ok('B', 5, 6) && !ok('B', 4, 2), 'elephant never crosses the river');
  assert.ok(ok('b', 4, 2) && !ok('b', 5, 2));
  assert.ok(ok('P', 4, 1) && ok('P', 6, 0) && !ok('P', 6, 1) && !ok('P', 7, 0), 'red pawn: odd files before the river, never behind its start');
  assert.ok(ok('p', 5, 1) && ok('p', 3, 0) && !ok('p', 3, 1) && !ok('p', 2, 0), 'black pawn mirrors it');
  assert.ok(ok('R', 4, 4) && ok('n', 0, 0) && ok('C', 5, 5), 'rooks, knights and cannons go anywhere');
  assert.equal(Editor.isSquareLegalForPiece('R', 10, 0).legal, false);
});

test('placing and deleting pieces goes through the game and restarts history', () => {
  Editor.clearBoard();
  Editor.selectTool('R');
  Editor.handleEditorClick(4, 4);
  assert.equal(state.board[4][4], 'R');
  assert.equal(state.moveHistory.length, 0, 'edits restart the move history');
  assert.equal(state.boardHistory.length, 1);

  Editor.selectTool('delete');
  Editor.handleEditorClick(4, 4);
  assert.equal(state.board[4][4], null);
});

test('pieces may be placed anywhere while setting up — silently — and validation reports it later', () => {
  Editor.clearBoard();
  Editor.selectTool('A');
  toasts.length = 0;
  Editor.handleEditorClick(4, 4);                 // advisor outside the palace
  assert.equal(state.board[4][4], 'A', 'it is placed');
  assert.equal(toasts.length, 0, 'no warning, no message');
  assert.match(Editor.validateBoard().error, /^Ô e6: Sĩ Đỏ/, 'the rule is enforced when analysis starts, naming the square');
});

test('a depleted tray refuses another piece: five pawns, never a sixth', () => {
  Editor.clearBoard();
  Editor.selectTool('P');
  for (let c = 0; c < 9; c += 2) Editor.handleEditorClick(4, c);   // five red pawns
  assert.equal(Editor.countPieces().counts.P, 5);
  toasts.length = 0;
  Editor.handleEditorClick(6, 0);                                   // the sixth
  assert.equal(state.board[6][0], null, 'not placed');
  assert.equal(Editor.countPieces().counts.P, 5);
  assert.equal(lastToast().type, 'info');
  assert.match(lastToast().msg, /Hết Binh Đỏ/);
  assert.equal(Editor.getState().selectedTool, 'P', 'the tool stays selected');

  Editor.selectTool('delete'); Editor.handleEditorClick(4, 0);      // free one up: the tray has one again
  Editor.selectTool('P'); Editor.handleEditorClick(6, 0);
  assert.equal(state.board[6][0], 'P');
  Editor.handleEditorClick(6, 0);                                   // same piece on the same square changes nothing
  assert.equal(Editor.countPieces().counts.P, 5);
});

test('a depleted tray cannot replace another piece either; moving pieces is unaffected', () => {
  Editor.clearBoard();
  Editor.selectTool('R'); Editor.handleEditorClick(4, 0); Editor.handleEditorClick(4, 1);
  Editor.selectTool('C'); Editor.handleEditorClick(4, 2);
  Editor.selectTool('R'); Editor.handleEditorClick(4, 2);           // third rook over the cannon: refused
  assert.equal(state.board[4][2], 'C', 'the cannon is still there');
  assert.equal(Editor.countPieces().counts.R, 2);
  Editor.selectTool('move'); Editor.handleEditorClick(4, 0); Editor.handleEditorClick(5, 0);
  assert.equal(state.board[5][0], 'R', 'moving a piece never needs the tray');
});

test('even the generals can be deleted or replaced while setting up; a missing general is reported later', () => {
  Editor.selectTool('delete');
  Editor.handleEditorClick(9, 4);
  assert.equal(state.board[9][4], null);
  assert.match(Editor.validateBoard().error, /Thiếu Tướng Đỏ/);

  Editor.selectTool('K');                         // the palette offers the general again
  Editor.handleEditorClick(9, 4);
  assert.equal(state.board[9][4], 'K');
  assert.equal(Editor.validateBoard().valid, true);

  Editor.selectTool('R');
  Editor.clearBoard(); Editor.selectTool('R');
  Editor.handleEditorClick(9, 4);                 // a rook on the general's square replaces it
  assert.equal(state.board[9][4], 'R');
  assert.match(Editor.validateBoard().error, /Thiếu Tướng Đỏ/);
});

test('clearBoard keeps both generals on their home squares (facing until something stands between)', () => {
  Editor.clearBoard();
  assert.equal(Editor.countPieces().total, 2);
  assert.equal(state.board[0][4], 'k'); assert.equal(state.board[9][4], 'K');
  assert.equal(Editor.generalsFacing(state.board), true);
  assert.match(Editor.validateBoard().error, /đối mặt/, 'reported when analysis is requested');

  Editor.selectTool('P'); Editor.handleEditorClick(4, 4);   // a piece between them fixes it
  assert.equal(Editor.generalsFacing(state.board), false);
  assert.equal(Editor.validateBoard().valid, true);

  Editor.resetDefaultBoard();
  assert.equal(X.boardToFEN(state.board, state.turn), X.DEFAULT_FEN);
  assert.equal(state.turn, 'red');
});

test('validateBoard reports facing generals, misplaced or surplus pieces, missing generals and a side left in check', () => {
  const put = (fen, turn = 'red') => { const b = X.createEmptyBoard(); fen(b); Game.setPosition(b, turn); return Editor.validateBoard(); };

  let v = put((b) => { b[0][4] = 'k'; b[9][4] = 'K'; });
  assert.equal(v.valid, false);
  assert.match(v.error, /đối mặt/);

  v = put((b) => { b[0][4] = 'k'; b[9][4] = 'K'; b[5][4] = 'P'; });
  assert.equal(v.valid, true, 'a piece between the generals makes it legal');

  v = put((b) => { b[0][3] = 'k'; b[9][4] = 'K'; b[5][5] = 'A'; });
  assert.match(v.error, /Sĩ Đỏ/, 'advisor outside the palace');
  v = put((b) => { b[0][3] = 'k'; b[9][4] = 'K'; b[3][2] = 'B'; });
  assert.match(v.error, /Tượng Đỏ/, 'elephant across the river');
  v = put((b) => { b[0][3] = 'k'; b[6][4] = 'K'; });
  assert.match(v.error, /Tướng Đỏ/, 'general outside the palace');
  v = put((b) => { b[0][3] = 'k'; b[9][4] = 'K'; b[4][0] = 'R'; b[4][1] = 'R'; b[4][2] = 'R'; });
  assert.match(v.error, /Quá nhiều/, 'three red rooks');

  // Black is in check by the rook yet Red is to move => not a legal position; fixing the turn fixes it
  const checked = (b) => { b[0][3] = 'k'; b[9][5] = 'K'; b[5][3] = 'R'; };
  v = put(checked, 'red');
  assert.match(v.error, /bị chiếu/);
  Editor.setTurn('black');
  assert.equal(Editor.validateBoard().valid, true);

  const noKing = X.createEmptyBoard(); noKing[9][4] = 'K';
  Game.setPosition(noKing, 'red');
  assert.match(Editor.validateBoard().error, /Thiếu Tướng Đen/);
});

test('setTurn changes the side to move', () => {
  Editor.setTurn('black');
  assert.equal(state.turn, 'black');
  Editor.setTurn('red');
  assert.equal(state.turn, 'red');
});

test('every board click belongs to the editor while setting up, and to the game otherwise', () => {
  assert.equal(Editor.isEditingActive(), false, 'analysing: normal moves');
  Editor.setSubMode('edit');
  assert.equal(Editor.isEditingActive(), true, 'setting up: editor tools, whichever tool is selected');
  Editor.selectTool('move');
  assert.equal(Editor.isEditingActive(), true, "even the 'move' tool is a free-setup tool");
  Editor.setSubMode('play');
  assert.equal(Editor.isEditingActive(), false);
});

test('analysis lists ranked variations with Vietnamese move text', async () => {
  await Editor.analyzeCustomBoard();
  const vars = Editor.getState().variations;
  assert.equal(vars.length, 3);
  assert.equal(vars[0].rank, 1);
  assert.match(vars[0].myMoveVN, /^(Xe|Mã|Pháo|Binh|Tốt|Tượng|Sĩ|Tướng) \d (tiến|thoái|bình) \d$/);
  assert.ok(vars[0].counterMoveVN, 'opponent reply is described');
  assert.ok(UI.state.analysisVariations.length >= 1, 'arrows are drawn on the board');

  // Every variation carries its whole line, and the card numbering matches the arrow numbers
  for (const v of vars) {
    assert.ok(v.pv.length >= 2 && v.pv.length <= 4, `chain of ${v.pv.length} moves`);
    assert.equal(v.pv[0], v.firstMove);
    assert.match(v.continuationText, /^1\. /);
  }
  const html = elements.get('editor-variations-list').innerHTML;
  assert.match(html, /variation-card rank-1/);
  assert.match(html, /var-badge var-rank-1/, 'badge class must match the stylesheet (.var-rank-N)');
  assert.match(html, /var-line/, 'compact one-line layout');
  assert.match(html, /Bạn/); assert.match(html, /Đối thủ/);
  assert.equal((html.match(/class="variation-card/g) || []).length, 3);
  assert.equal((html.match(/var-play-btn/g) || []).length, 3, 'a play button per variation');
  assert.match(elements.get('sheet-summary').textContent, /➔/, 'folded sheet shows the best line');
  assert.match(elements.get('editor-variations-list').innerHTML, /variation-card/);
});

test('invalid positions are explained instead of being sent to the engine', async () => {
  Game.setPosition(facingGenerals(), 'red');    // generals facing: cannot be built in the editor, but can be loaded
  await Editor.analyzeCustomBoard();
  assert.match(elements.get('editor-variations-list').innerHTML, /đối mặt/);
});

test('the eval bar is shown from Red\'s point of view whoever moves', async () => {
  // Standard position minus Black's a10 rook: Red is clearly ahead
  const b = X.parseFEN('1nbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1').board;
  Game.setPosition(b, 'red');
  await Editor.analyzeCustomBoard();
  const asRed = parseFloat(elements.get('editor-eval-score').textContent);
  Game.setPosition(b, 'black');
  await Editor.analyzeCustomBoard();
  const asBlack = parseFloat(elements.get('editor-eval-score').textContent);
  assert.ok(asRed > 2, `Red to move, Red ahead: ${asRed}`);
  assert.ok(asBlack > 2, `Black to move, Red still ahead: ${asBlack}`);
});

test('a newer analysis supersedes an older one (no stale results)', async () => {
  const early = Editor.analyzeCustomBoard();                    // start position, Red to move
  const b = X.parseFEN('3k5/9/9/9/9/9/9/9/9/R4K3 w - - 0 1').board;
  Game.setPosition(b, 'red');
  const late = Editor.analyzeCustomBoard();
  await Promise.all([early, late]);
  const first = Editor.getState().variations[0].firstMove;
  const m = X.parseUCI(first);
  assert.ok(X.isLegalMove(state.board, m.fromRow, m.fromCol, m.toRow, m.toCol, state.turn),
    `variations belong to the latest position, got ${first}`);
});

test('applying a variation plays it on the board', async () => {
  await Editor.analyzeCustomBoard();
  const vars = Editor.getState().variations;
  assert.ok(vars.length > 0);
  const first = vars[0].firstMove;
  await Editor.applyVariation(0);
  assert.equal(state.moveHistory.length, 1);
  assert.equal(state.moveHistory[0].uci, first);
});

// ---------- Suggestion filter (off / both / red / black) ----------

test('shouldSuggest follows the filter', () => {
  assert.equal(Editor.shouldSuggest('red', 'both'), true);
  assert.equal(Editor.shouldSuggest('black', 'both'), true);
  assert.equal(Editor.shouldSuggest('red', 'red'), true);
  assert.equal(Editor.shouldSuggest('black', 'red'), false);
  assert.equal(Editor.shouldSuggest('black', 'black'), true);
  assert.equal(Editor.shouldSuggest('red', 'black'), false);
  assert.equal(Editor.shouldSuggest('red', 'off'), false);
  assert.equal(Editor.shouldSuggest('black', 'off'), false);
});

test('filter buttons: selecting one marks it active, remembers it, and ignores junk values', async () => {
  Editor.setSuggestFilter('red');
  assert.equal(Editor.getState().suggestFilter, 'red');
  assert.deepEqual(filterButtons.map(b => b.classList.contains('active')), [false, false, true, false]);
  assert.equal(storage.get('cotuong.suggestFilter'), 'red');

  Editor.setSuggestFilter('purple');
  assert.equal(Editor.getState().suggestFilter, 'red', 'invalid value is ignored');

  // a fresh start restores the saved choice
  Editor.getState().suggestFilter = 'both';
  storage.set('cotuong.suggestFilter', 'black');
  Editor.init();
  assert.equal(Editor.getState().suggestFilter, 'black');
  assert.deepEqual(filterButtons.map(b => b.classList.contains('active')), [false, false, false, true]);
  storage.set('cotuong.suggestFilter', 'nonsense');
  Editor.getState().suggestFilter = 'both';
  Editor.init();
  assert.equal(Editor.getState().suggestFilter, 'both', 'a corrupted saved value is ignored');
});

test('"Tắt" removes the suggestions and explains how to turn them back on', async () => {
  await Editor.analyzeCustomBoard();                       // both: suggestions appear
  assert.equal(Editor.getState().variations.length, 3);
  assert.ok(UI.state.analysisVariations.length > 0);

  Editor.setSuggestFilter('off');
  await sleep(10);
  assert.equal(Editor.getState().variations.length, 0);
  assert.equal(UI.state.analysisVariations, null, 'arrows are removed from the board');
  assert.match(elements.get('editor-variations-list').innerHTML, /đang tắt/);
  assert.equal(elements.get('editor-eval-score').textContent, '—');
  assert.match(elements.get('sheet-summary').textContent, /tắt/);
});

test('"Chỉ Đỏ" suggests on Red\'s turn only; "Chỉ Đen" on Black\'s turn only', async () => {
  Editor.getState().suggestFilter = 'red';
  Game.setPosition(X.parseFEN(X.DEFAULT_FEN).board, 'red');
  await Editor.analyzeCustomBoard();
  assert.equal(Editor.getState().variations.length, 3, "Red to move, Red's suggestions on");

  Game.setPosition(X.parseFEN(X.DEFAULT_FEN).board, 'black');
  await Editor.analyzeCustomBoard();
  assert.equal(Editor.getState().variations.length, 0, 'Black to move, but only Red is wanted');
  assert.equal(UI.state.analysisVariations, null);
  assert.match(elements.get('editor-variations-list').innerHTML, /chỉ gợi ý cho bên Đỏ.*lượt Đen/i);

  Editor.getState().suggestFilter = 'black';
  await Editor.analyzeCustomBoard();
  assert.equal(Editor.getState().variations.length, 3, "Black to move, Black's suggestions on");
  Game.setPosition(X.parseFEN(X.DEFAULT_FEN).board, 'red');
  await Editor.analyzeCustomBoard();
  assert.equal(Editor.getState().variations.length, 0);
});

test('a filtered-out turn does no engine work', async () => {
  const Engine = get('Engine');
  const original = Engine.analyzeMultiPV;
  let engineCalls = 0;
  Engine.analyzeMultiPV = (...args) => { engineCalls++; return original(...args); };
  try {
    Editor.getState().suggestFilter = 'black';
    Game.setPosition(X.parseFEN(X.DEFAULT_FEN).board, 'red');   // Red to move, only Black wanted
    await Editor.analyzeCustomBoard();
    assert.equal(engineCalls, 0, 'engine must not be asked');
    Editor.getState().suggestFilter = 'off';
    await Editor.analyzeCustomBoard();
    assert.equal(engineCalls, 0);
    Editor.getState().suggestFilter = 'both';
    await Editor.analyzeCustomBoard();
    assert.equal(engineCalls, 1, 'and is asked when the side is wanted');
  } finally {
    Engine.analyzeMultiPV = original;
  }
});

test('a move that hands the turn to the filtered-out side clears the suggestions', async () => {
  Editor.getState().suggestFilter = 'red';
  Editor.toggleAutoAnalyze(true);
  Game.setPosition(X.parseFEN(X.DEFAULT_FEN).board, 'red');
  await Editor.analyzeCustomBoard();
  assert.equal(Editor.getState().variations.length, 3);

  // Red plays: it becomes Black's turn => nothing is suggested
  await Game.executeMove(7, 7, 7, 4);
  await sleep(450);
  assert.equal(Editor.getState().variations.length, 0, 'no suggestions on the filtered-out side');
  Editor.toggleAutoAnalyze(false);
});

test('the filter does not hide validation problems', async () => {
  Editor.getState().suggestFilter = 'off';
  Game.setPosition(facingGenerals(), 'red');                // generals facing
  await Editor.analyzeCustomBoard();
  assert.match(elements.get('editor-variations-list').innerHTML, /đối mặt/);
});

// ---------- Bottom sheet ----------

test('the suggestions sheet folds and unfolds', () => {
  const card = () => elements.get('main-analysis-card');
  assert.equal(Editor.getState().sheetCollapsed, false);
  Editor.toggleSheet();
  assert.equal(Editor.getState().sheetCollapsed, true);
  assert.equal(card().classList.contains('collapsed'), true);
  assert.equal(elements.get('sheet-handle').getAttribute('aria-expanded'), 'false');
  assert.equal(body.classList.contains('sheet-collapsed'), true, 'page padding adapts');
  Editor.toggleSheet();
  assert.equal(card().classList.contains('collapsed'), false);
  assert.equal(elements.get('sheet-handle').getAttribute('aria-expanded'), 'true');
  assert.equal(body.classList.contains('sheet-collapsed'), false);
});

test('the sheet folds while pieces are being placed and reopens when analysis starts', () => {
  Editor.setSubMode('edit');
  assert.equal(Editor.getState().sheetCollapsed, true);
  Editor.startAnalysis();
  assert.equal(Editor.getState().sheetCollapsed, false);
});

test('entering and leaving analysis mode toggles the page state used by the mobile layout', () => {
  Game.setMode('analyze');
  assert.equal(body.classList.contains('analysis-mode'), true);
  assert.equal(elements.get('btn-hint').classList.contains('hidden'), true, 'old hint button is gone in analysis mode');
  assert.equal(elements.get('main-analysis-card').classList.contains('hidden'), false);
  Game.setMode('pvp');
  assert.equal(body.classList.contains('analysis-mode'), false);
  assert.equal(elements.get('btn-hint').classList.contains('hidden'), false, 'hint button returns in the other modes');
  assert.equal(elements.get('main-analysis-card').classList.contains('hidden'), true);
});

test('the old hint action does nothing in analysis mode', async () => {
  Game.setMode('analyze');
  UI.state.analysisVariations = null;
  await Game.requestHint();
  assert.equal(UI.state.analysisVariations, null, 'no arrows from the old hint');
  Game.setMode('pvp');
});

// ---------- Free setup: pick up any piece, no turn order; rules still apply; start button begins analysis ----------

const emptyWithGenerals = () => { const b = X.createEmptyBoard(); b[0][3] = 'k'; b[9][4] = 'K'; return b; };
const setup = (build, turn = 'red') => {
  Editor.setSubMode('edit');
  const b = emptyWithGenerals(); build(b);
  Game.setPosition(b, turn);
  Editor.syncFromGame();                               // refresh the palette summary / start button
};
const targets = (row, col) => Array.from(Editor.relocationTargets(state.board, row, col), ([r, c]) => `${r},${c}`).sort();
const countEngineCalls = () => {
  const Engine = get('Engine'); const o = Engine.analyzeMultiPV; const o2 = Engine.analyzePosition;
  const spy = { calls: 0, restore() { Engine.analyzeMultiPV = o; Engine.analyzePosition = o2; } };
  Engine.analyzeMultiPV = (...a) => { spy.calls++; return o(...a); };
  Engine.analyzePosition = (...a) => { spy.calls++; return o2(...a); };
  return spy;
};

test('free setup: pieces of BOTH sides can be moved in any order, ignoring whose turn it is', async () => {
  Editor.setSubMode('edit');
  assert.equal(state.turn, 'red');

  await click(0, 0);                                   // a BLACK rook while it is Red's turn
  assert.deepEqual(plain(UI.state.selected), { row: 0, col: 0 }, 'selected even though it is not Black\'s turn');
  assert.deepEqual(plain(UI.state.legalMoves), [], 'no suggested squares');
  await click(4, 0);
  assert.equal(state.board[4][0], 'r');
  assert.equal(state.board[0][0], null);
  assert.equal(state.moveHistory.length, 0, 'setting up is not playing');
  assert.equal(state.turn, 'red', 'the side to move is not changed by setting up');

  await click(9, 0); await click(5, 0);                // two red moves in a row
  await click(9, 8); await click(5, 8);
  assert.equal(state.board[5][0], 'R'); assert.equal(state.board[5][8], 'R');
});

test('free setup: any piece goes on any empty square, with no suggestion and no warning', async () => {
  Editor.setSubMode('edit');
  toasts.length = 0;
  await click(0, 3);                                   // the black advisor
  assert.deepEqual(plain(UI.state.legalMoves), [], 'no suggestion dots');
  await click(5, 4);                                   // dropped mid-board: against the rules, yet allowed
  assert.equal(state.board[5][4], 'a');
  assert.equal(state.board[0][3], null);
  assert.equal(toasts.length, 0, 'nothing is said while setting up');
  assert.equal(elements.get('editor-status-badge').innerHTML.includes('lỗi'), false, 'the summary does not judge');
  assert.match(elements.get('editor-status-badge').innerHTML, /quân Đỏ/);
  assert.match(Editor.validateBoard().error, /^Ô e5: Sĩ Đen/);
});

test('free setup: generals may be left facing; analysis is refused until it is fixed', async () => {
  setup((b) => { b[5][6] = 'R'; });                    // e1 general vs d10 general: different files, legal
  assert.equal(Editor.validateBoard().valid, true);

  toasts.length = 0;
  await click(9, 4); await click(9, 3);                // move the red general onto the black general's file
  assert.equal(state.board[9][3], 'K', 'allowed while setting up');
  assert.equal(Editor.generalsFacing(state.board), true);
  assert.equal(toasts.length, 0, 'no warning');

  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'edit', 'pressing start does not enter analysis');
  assert.equal(lastToast().type, 'error');
  assert.match(lastToast().msg, /Phát hiện quân cờ không hợp lệ.*đối mặt/);
  assert.match(elements.get('editor-status-badge').innerHTML, /Phát hiện 1 lỗi/);
  assert.match(elements.get('editor-status-badge').innerHTML, /đối mặt/, 'the list stays visible in the panel');

  // Putting a piece between them fixes it; editing clears the old list
  Editor.selectTool('P'); await click(4, 3);
  assert.equal(elements.get('editor-status-badge').innerHTML.includes('Phát hiện'), false, 'the list is cleared by the next edit');
  assert.equal(Editor.validateBoard().valid, true);
  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'play', 'now it starts');
});

test('free setup: removing the only piece between the generals is allowed, and reported at start', async () => {
  setup((b) => { b[0][4] = 'k'; b[0][3] = null; b[5][4] = 'P'; });   // both generals on file e, a pawn between
  assert.equal(Editor.validateBoard().valid, true);
  Editor.selectTool('delete');
  await click(5, 4);
  assert.equal(state.board[5][4], null);
  assert.match(Editor.validateBoard().error, /đối mặt/);
  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'edit');
});

test('free setup: placing from the palette is free; every misplaced piece is listed at start', async () => {
  setup(() => {});
  toasts.length = 0;
  Editor.selectTool('B'); await click(5, 4);           // red elephant on e5: not one of its points
  Editor.selectTool('a'); await click(4, 4);           // black advisor outside its palace
  Editor.selectTool('p'); await click(0, 0);           // black pawn on its back rank
  assert.equal(state.board[5][4], 'B'); assert.equal(state.board[4][4], 'a'); assert.equal(state.board[0][0], 'p');
  assert.equal(toasts.length, 0, 'placing never complains');

  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'edit');
  const html = elements.get('editor-status-badge').innerHTML;
  assert.match(html, /Phát hiện 3 lỗi/, 'all problems are listed, not just the first');
  assert.match(html, /Ô e5: Tượng Đỏ/); assert.match(html, /Ô e6: Sĩ Đen/); assert.match(html, /Ô a10: Tốt Đen/);
  assert.match(lastToast().msg, /Phát hiện quân cờ không hợp lệ/);

  Editor.selectTool('delete'); await click(5, 4); await click(4, 4); await click(0, 0);
  Editor.selectTool('B'); await click(7, 4);
  Editor.selectTool('A'); await click(8, 4);
  Editor.selectTool('r'); await click(3, 0);           // black pieces too, in any order
  assert.equal(Editor.validateBoard().valid, true);
  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'play');
});

test('start lists many problems compactly in the toast but completely in the panel', async () => {
  setup(() => {});
  Game.setPosition((() => { const b = emptyWithGenerals(); for (let c = 0; c < 5; c++) b[5][c] = 'R'; return b; })(), 'red');   // five red rooks (e.g. from a FEN): too many
  Editor.selectTool('a'); await click(6, 0); await click(6, 1);   // two misplaced advisors
  Editor.startAnalysis();
  const { errors } = Editor.validateBoard();
  assert.ok(errors.length >= 3);
  assert.match(lastToast().msg, new RegExp(`và ${errors.length - 3} lỗi khác`));
  assert.equal((elements.get('editor-status-badge').innerHTML.match(/<li>/g) || []).length, errors.length);
});

test('free setup: tapping the selected piece again, or choosing a tool, drops the selection', async () => {
  Editor.setSubMode('edit');
  await click(9, 0);
  assert.deepEqual(plain(UI.state.selected), { row: 9, col: 0 });
  await click(9, 0);
  assert.equal(UI.state.selected, null);
  await click(9, 0);
  Editor.selectTool('delete');
  assert.equal(UI.state.selected, null);
  assert.equal(Editor.getState().selectedSquare, null);
  await click(9, 8); await click(9, 8);                // empty drop with nothing selected does nothing
  Editor.selectTool('move');
  await click(5, 3);                                   // an empty square with nothing selected
  assert.equal(UI.state.selected, null);
});

test('"Bắt đầu phân tích" judges only when pressed; the button itself never nags', async () => {
  const startBtn = () => elements.get('editor-start-btn');
  Editor.setSubMode('edit');

  // Black is in check by the red rook but it is Red's turn
  setup((b) => { b[5][3] = 'R'; });
  assert.equal(startBtn().classList.contains('invalid'), false, 'no warning styling');
  assert.notEqual(startBtn().disabled, true, 'always pressable');
  assert.doesNotMatch(startBtn().title, /chiếu/, 'the tooltip does not reveal the problem either');
  assert.equal(elements.get('editor-status-badge').innerHTML.includes('chiếu'), false);

  toasts.length = 0;
  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'edit', 'still setting up');
  assert.equal(lastToast().type, 'error');
  assert.match(lastToast().msg, /Phát hiện quân cờ không hợp lệ.*bị chiếu/);

  Editor.setTurn('black');                              // fix it
  Editor.startAnalysis();
  assert.equal(Editor.getState().subMode, 'play');
});

test('nothing is analysed while setting up; pressing "Bắt đầu phân tích" analyses the new position', async () => {
  const spy = countEngineCalls();
  try {
    Editor.toggleAutoAnalyze(true);                    // even with auto-analysis on
    Editor.setSubMode('edit');
    Editor.clearBoard();
    Editor.selectTool('R'); await click(4, 0); await click(4, 8);
    Editor.selectTool('p'); await click(3, 4);
    await Editor.analyzeCustomBoard();                 // an explicit request is also deferred
    await sleep(500);                                  // longer than the 250 ms debounce
    assert.equal(spy.calls, 0, 'the engine was not used');
    assert.equal(Editor.getState().variations.length, 0);
    assert.match(elements.get('editor-variations-list').innerHTML, /Đang xếp cờ/);
    assert.equal(elements.get('sheet-summary').textContent, 'Đang xếp cờ');

    Editor.toggleAutoAnalyze(false);
    Editor.startAnalysis();
    assert.equal(Editor.getState().subMode, 'play');
    assert.equal(state.moveHistory.length, 0, 'the match starts from the position that was set up');
    assert.equal(state.board[4][0], 'R'); assert.equal(state.board[3][4], 'p');
    const end = Date.now() + 8000;
    while (Editor.getState().variations.length === 0 && Date.now() < end) await sleep(25);
    assert.ok(spy.calls >= 1, 'analysis started');
    assert.equal(Editor.getState().variations.length, 3);
    assert.equal(Editor.isEditingActive(), false, 'clicks now play moves');
  } finally { spy.restore(); }
});

test('after starting, the board plays by the normal rules again', async () => {
  setup((b) => { b[7][4] = 'N'; });                    // a red knight on e3
  Editor.startAnalysis();
  await click(7, 4);                                   // Red's turn: select the knight (normal game selection)
  assert.deepEqual(plain(UI.state.selected), { row: 7, col: 4 });
  const legal = UI.state.legalMoves.map(([r, c]) => `${r},${c}`);
  assert.ok(legal.includes('5,3') && legal.includes('5,5'), 'knight moves, not free-drop squares');
  assert.ok(!legal.includes('4,4'), 'normal rules apply: a knight cannot go straight');
  await click(0, 3);                                   // the black general: not Red's turn, so it cannot be picked
  assert.notDeepEqual(plain(UI.state.selected), { row: 0, col: 3 });
});

test('leaving analysis mode while setting up drops the setup without using the engine', () => {
  const spy = countEngineCalls();
  try {
    Editor.setSubMode('edit');
    assert.equal(elements.get('editor-palette-container').classList.contains('hidden'), false);
    Game.setMode('pvp');
    assert.equal(Editor.getState().subMode, 'play');
    assert.equal(elements.get('editor-palette-container').classList.contains('hidden'), true);
    assert.equal(Editor.getState().sheetCollapsed, false);
    assert.equal(spy.calls, 0);
  } finally { spy.restore(); }
});

test('the "Xếp cờ thế" button opens setup without analysing first', async () => {
  const spy = countEngineCalls();
  try {
    Game.setMode('pvp');
    Editor.toggleEditMode();
    assert.equal(state.mode, 'analyze');
    assert.equal(Editor.getState().subMode, 'edit');
    await sleep(400);
    assert.equal(spy.calls, 0, 'no analysis of the position that is about to be rearranged');
    Editor.toggleEditMode();                           // pressing it again starts the analysis
    assert.equal(Editor.getState().subMode, 'play');
  } finally { spy.restore(); }
});

test('lessons open straight into analysis, not into setup', async () => {
  Editor.setSubMode('edit');
  Game.loadLesson('4k4/9/9/9/9/9/9/R8/9/3K5 w - - 0 1');
  assert.equal(state.mode, 'analyze');
  assert.equal(Editor.getState().subMode, 'play');
  assert.equal(state.board[7][0], 'R');
});

test('a move played in analysis mode is judged (badge) and the suggestions for the new position follow', async () => {
  Editor.toggleAutoAnalyze(true);
  await Editor.analyzeCustomBoard();
  const first = Editor.getState().variations[0].firstMove;
  await Editor.applyVariation(0);
  const end = Date.now() + 15000;
  while ((!state.moveHistory[0] || !state.moveHistory[0].quality || Editor.getState().variations.length !== 3 ||
          Editor.getState().variations[0].firstMove === first) && Date.now() < end) await sleep(25);
  Editor.toggleAutoAnalyze(false);

  assert.ok(state.moveHistory[0].quality, 'the move was judged');
  const badge = UI.state.moveBadge;
  assert.deepEqual([badge.row, badge.col], [state.moveHistory[0].toRow, state.moveHistory[0].toCol], 'on the piece that moved');
  assert.equal(Editor.getState().variations.length, 3, 'suggestions for the new position are shown as well');
  assert.equal(state.turn, 'black');
});

test('the evaluation bar at the top follows the analysis, from Red\'s point of view', async () => {
  // Standard position minus Black's a10 rook: Red is clearly ahead
  const b = X.parseFEN('1nbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1').board;
  Game.setPosition(b, 'red');
  await Editor.analyzeCustomBoard();
  assert.ok(UI.evalScore > 200, `Red to move and ahead: ${UI.evalScore}`);
  Game.setPosition(b, 'black');
  await Editor.analyzeCustomBoard();
  assert.ok(UI.evalScore > 200, `Black to move, but Red is still ahead: ${UI.evalScore}`);
});

test('the evaluation bar is blank (null) when nothing is analysed: suggestions off, or still setting up', async () => {
  await Editor.analyzeCustomBoard();
  assert.equal(typeof UI.evalScore, 'number');
  Editor.getState().suggestFilter = 'off';
  await Editor.analyzeCustomBoard();
  assert.equal(UI.evalScore, null, 'suggestions off');

  Editor.getState().suggestFilter = 'both';
  await Editor.analyzeCustomBoard();
  assert.equal(typeof UI.evalScore, 'number');
  Editor.setSubMode('edit');
  await Editor.analyzeCustomBoard();
  assert.equal(UI.evalScore, null, 'setting up');
});

// ---------- Setup screen layout: trays around the board, FEN row, toolbar ----------

const CHROME = ['editor-turnbar', 'editor-tray-black', 'editor-tray-red', 'editor-fen-row', 'editor-toolbar'];
const chromeHidden = () => CHROME.map(id => elements.get(id).classList.contains('hidden'));

test('the turn bar, both piece trays, FEN row and toolbar show only while setting up', () => {
  assert.deepEqual(chromeHidden(), [true, true, true, true, true], 'analysing: none of them');
  assert.equal(body.classList.contains('edit-mode'), false);

  Editor.setSubMode('edit');
  assert.deepEqual(chromeHidden(), [false, false, false, false, false], 'setting up: all of them');
  assert.equal(body.classList.contains('edit-mode'), true, 'page switches to the compact setup layout');

  Editor.startAnalysis();
  assert.deepEqual(chromeHidden(), [true, true, true, true, true]);
  assert.equal(body.classList.contains('edit-mode'), false);
});

test('leaving analysis mode while setting up removes the setup screen', () => {
  Editor.setSubMode('edit');
  Game.setMode('pvp');
  assert.deepEqual(chromeHidden(), [true, true, true, true, true]);
  assert.equal(body.classList.contains('edit-mode'), false);
});

test('the "Xếp cờ thế" button opens the setup screen directly', () => {
  Game.setMode('pvp');
  Editor.toggleEditMode();
  assert.deepEqual(chromeHidden(), [false, false, false, false, false]);
});

test('the FEN field shows the position being set up and follows every edit and the side to move', () => {
  Editor.setSubMode('edit');
  const fen = () => elements.get('editor-fen').value;
  assert.equal(fen(), X.DEFAULT_FEN.replace(/ 0 1$/, ' 0 1'));

  Editor.clearBoard();
  assert.equal(fen().split(' ')[0], '4k4/9/9/9/9/9/9/9/9/4K4');
  Editor.selectTool('R'); Editor.handleEditorClick(4, 0);
  assert.equal(fen().split(' ')[0], '4k4/9/9/9/R8/9/9/9/9/4K4');
  Editor.setTurn('black');
  assert.equal(fen().split(' ')[1], 'b', 'side to move is part of the FEN');
  Editor.setTurn('red');
  assert.equal(fen().split(' ')[1], 'w');
  Editor.resetDefaultBoard();
  assert.equal(fen(), X.DEFAULT_FEN);
});

test('the FEN can be copied; without a clipboard it is selected for manual copying', async () => {
  Editor.setSubMode('edit');
  Editor.clearBoard();
  toasts.length = 0;
  await Editor.copyFEN();
  assert.equal(clipboardText, elements.get('editor-fen').value);
  assert.equal(lastToast().type, 'success');

  navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  let selected = false;
  elements.get('editor-fen').select = () => { selected = true; };
  toasts.length = 0;
  await Editor.copyFEN();
  assert.equal(selected, true, 'falls back to selecting the text');
  assert.equal(lastToast().type, 'info');
  navigator.clipboard.writeText = (t) => { clipboardText = t; return Promise.resolve(); };
});

test('the piece count badges still follow the board (they now live in the trays)', () => {
  Editor.setSubMode('edit');
  Editor.clearBoard();
  assert.equal(elements.get('editor-count-R').textContent, 2);
  assert.equal(elements.get('editor-count-K').textContent, 0, 'the red general is on the board');
  Editor.selectTool('R'); Editor.handleEditorClick(4, 0);
  assert.equal(elements.get('editor-count-R').textContent, 1);
});

// ===== Engine plays a move for the side to move (analysis mode) =====
test('"Máy đi" plays the engine\'s best move for the side to move, in analysis mode', async () => {
  Editor.setSubMode('play');
  const before = state.turn;
  await Game.requestEngineMove();
  assert.equal(state.moveHistory.length, 1);
  assert.notEqual(state.turn, before);
  assert.equal(state.moveHistory[0].piece && true, true);
  assert.equal(state.isAIThinking, false, 'the flag is released');
});

test('"Máy đi" does nothing while setting up, outside analysis mode, or when the position changed meanwhile', async () => {
  Editor.setSubMode('edit');
  await Game.requestEngineMove();
  assert.equal(state.moveHistory.length, 0, 'not while setting up');
  Editor.setSubMode('play');

  const Engine = get('Engine'); const orig = Engine.getBestMove;
  try {
    Engine.getBestMove = async () => { Game.newGame(); return 'h3e3'; };   // the board is reset while the engine thinks
    await Game.requestEngineMove();
    assert.equal(state.moveHistory.length, 0, 'stale result is dropped');
    assert.equal(state.isAIThinking, false);
  } finally { Engine.getBestMove = orig; }

  Game.setMode('pvp'); Game.newGame();
  await Game.requestEngineMove();
  assert.equal(state.moveHistory.length, 0, 'only analysis mode has it');
});

test('analysis mode: the engine button is shown only there; phones keep the suggestions open but folded setup stays folded', () => {
  assert.equal(elements.get('btn-engine-move').classList.contains('hidden'), false);
  Game.setMode('pvp');
  assert.equal(elements.get('btn-engine-move').classList.contains('hidden'), true);
  ctxMatchMedia.matches = true;
  try {
    Editor.setSheetCollapsed(false);
    Editor.setActive(true);
    assert.equal(Editor.getState().sheetCollapsed, false, 'on a phone the suggestions stay visible next to the board');
    Editor.setSubMode('edit');
    assert.equal(Editor.getState().sheetCollapsed, true, 'while setting up they fold away');
  } finally { ctxMatchMedia.matches = false; }
});

// ===== "Máy đi" stays on until the game ends =====
const firstLegalUci = () => { const m = X.getLegalMoves(state.board, state.turn)[0]; return X.moveToUCI(m.fromRow, m.fromCol, m.toRow, m.toCol); };
const withFakeEngine = async (fn) => {
  const Engine = get('Engine'); const orig = Engine.getBestMove;
  Engine.getBestMove = async () => firstLegalUci();
  try { await fn(); } finally { Engine.getBestMove = orig; Game.stopEngineAutoPlay(); }
};
const until = async (cond, ms = 4000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await sleep(25); } };

test('"Máy đi" keeps playing both sides move after move until it is switched off', async () => {
  await withFakeEngine(async () => {
    Editor.setSubMode('play');
    Game.toggleEngineAutoPlay();
    assert.equal(Game.isEngineAutoPlay(), true);
    assert.ok(elements.get('btn-engine-move').classList.contains('active'), 'the button shows it is on');
    await until(() => state.moveHistory.length >= 3);
    assert.deepEqual(plain(state.moveHistory.map(m => m.turnBefore).slice(0, 3)), ['red', 'black', 'red'], 'it plays for whichever side is to move');
    Game.toggleEngineAutoPlay();
    assert.equal(Game.isEngineAutoPlay(), false);
    assert.equal(elements.get('btn-engine-move').classList.contains('active'), false);
    await sleep(100);
    const n = state.moveHistory.length;
    await sleep(700);
    assert.equal(state.moveHistory.length, n, 'no more moves once it is off');
  });
});

test('"Máy đi" stops by itself when the game is reset, the mode changes or setup starts', async () => {
  await withFakeEngine(async () => {
    Editor.setSubMode('play');
    Game.toggleEngineAutoPlay();
    await until(() => state.moveHistory.length >= 1);
    Game.newGame();
    await sleep(900);
    assert.equal(Game.isEngineAutoPlay(), false, 'a new game ends it');
    assert.equal(state.moveHistory.length, 0);

    Game.toggleEngineAutoPlay();
    await until(() => state.moveHistory.length >= 1);
    Editor.setSubMode('edit');
    await sleep(900);
    assert.equal(Game.isEngineAutoPlay(), false, 'setting up ends it');

    Editor.setSubMode('play');
    Game.toggleEngineAutoPlay();
    Game.setMode('pvp');
    assert.equal(Game.isEngineAutoPlay(), false, 'so does leaving analysis mode');
  });
});

test('"Máy đi" stops at the end of the game', async () => {
  await withFakeEngine(async () => {
    Editor.setSubMode('edit');
    const b = emptyWithGenerals(); b[0][3] = null; b[0][4] = 'k'; b[9][4] = null; b[9][3] = 'K'; b[3][8] = 'R'; b[1][0] = 'R';   // red to mate next move
    Game.setPosition(b, 'red');
    Editor.setSubMode('play');
    state.gameOver = false;
    const Engine = get('Engine');
    Engine.getBestMove = async () => 'i7i10';        // Ri7-i10: mate (the other rook guards the 9th rank)
    Game.toggleEngineAutoPlay();
    await until(() => state.gameOver);
    await sleep(300);
    assert.equal(Game.isEngineAutoPlay(), false);
  });
});

test('"Máy đi" allows choosing red only or black only, and handles modal opening/closing', async () => {
  await withFakeEngine(async () => {
    Editor.setSubMode('play');
    elements.get('engine-move-modal').classList.add('hidden');

    // Clicking when stopped opens modal
    Game.handleEngineMoveClick();
    assert.equal(elements.get('engine-move-modal').classList.contains('hidden'), false);

    // Starting with red only closes modal and plays Red
    Game.startEngineAutoPlay('red');
    assert.equal(elements.get('engine-move-modal').classList.contains('hidden'), true);
    assert.equal(Game.isEngineAutoPlay(), true);
    assert.equal(Game.getEngineAutoPlaySide(), 'red');

    // Engine plays Red (move 1)
    await until(() => state.moveHistory.length >= 1);
    assert.equal(state.turn, 'black');
    assert.equal(state.moveHistory[0].turnBefore, 'red');

    // Engine does NOT play Black; it waits
    await sleep(600);
    assert.equal(state.moveHistory.length, 1, 'engine waits for player to move Black');

    // Player moves Black manually
    const blackMove = X.getLegalMoves(state.board, 'black')[0];
    await Game.executeMove(blackMove.fromRow, blackMove.fromCol, blackMove.toRow, blackMove.toCol);
    assert.equal(state.turn, 'red');

    // Engine detects it is Red turn and plays move 3
    await until(() => state.moveHistory.length >= 3);
    assert.equal(state.moveHistory[2].turnBefore, 'red');

    // Clicking when running stops it
    Game.handleEngineMoveClick();
    assert.equal(Game.isEngineAutoPlay(), false);
    assert.equal(elements.get('btn-engine-move').classList.contains('active'), false);
  });
});
