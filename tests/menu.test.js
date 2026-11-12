const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext, elementStub } = require('./helpers');

const toasts = [];
const UI = {
  state: { flipped: false }, canvas: { listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } }, pos: null,
  getClickPos() { return UI.pos; },
  render() {}, updateMoveHistory() {}, updateTurnIndicator() {}, updateEvalBar() {}, setEvalBar() {}, showMoveQuality() {},
  animateMove: (b, a, c, d, e, done) => done(),
  showToast: (msg, type) => toasts.push({ msg, type }),
  setAnalysisVariations() {}, clearAnalysisVariations() {},
  flipBoardCalls: 0,
};

const elements = new Map();
const el = (id) => { if (!elements.has(id)) elements.set(id, Object.assign(elementStub(), { textContent: '', innerHTML: '' })); return elements.get(id); };
const body = elementStub();
const keyHandlers = [];
const document = {
  body,
  getElementById: el,
  createElement: () => elementStub(),
  querySelector: () => elementStub(),
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'keydown') keyHandlers.push(fn); },
};
// The page ships with the menu hidden (it is opened once the splash has gone)
el('main-menu').classList.add('hidden');
el('menu-resume').classList.add('hidden');

const { get } = loadContext(['xiangqi', 'engine', 'lessons', 'main'], { UI, document });
const X = get('XIANGQI');
const Game = get('Game');
const state = Game.getState();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const menuOpen = () => !el('main-menu').classList.contains('hidden');
const resumeShown = () => !el('menu-resume').classList.contains('hidden');
const click = async (row, col) => { UI.pos = { row, col }; await UI.canvas.listeners[0]({}); await sleep(2); };
const play = async (uci) => { const m = X.parseUCI(uci); await click(m.fromRow, m.fromCol); await click(m.toRow, m.toCol); };
const press = (key) => keyHandlers.forEach(h => h({ key, target: { tagName: 'BODY' }, preventDefault() {} }));
const waitFor = async (cond, ms = 6000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await sleep(25); } };

test('the menu is closed in the page source and opens once the app has started; nothing to go back to yet', async () => {
  assert.equal(menuOpen(), false, 'hidden until the splash is gone');
  await Game.init();
  assert.equal(menuOpen(), true, 'the main menu is the first thing the player sees');
  assert.equal(body.classList.contains('menu-open'), true, 'page scroll is locked behind it');
  assert.equal(resumeShown(), false, 'no game to go back to');
  assert.equal(state.modeChosen, false);
  assert.equal(el('mode-chip-text').textContent, 'Người vs Máy · Trung bình', 'the chip describes the default');
});

test('the board cannot be played and shortcuts are ignored while the menu is open', async () => {
  UI.state.flipped = false;
  await play('h3e3');
  assert.equal(state.moveHistory.length, 0, 'clicks do nothing behind the menu');
  press('f');
  press('z');
  assert.equal(state.moveHistory.length, 0);
  press('Escape');
  assert.equal(menuOpen(), true, 'Esc cannot close a menu with nothing to go back to');
});

test('choosing a mode starts that game, hides the menu and updates the chip', async () => {
  Game.setMode('pvp');
  assert.equal(menuOpen(), false);
  assert.equal(body.classList.contains('menu-open'), false);
  assert.equal(state.mode, 'pvp');
  assert.equal(state.modeChosen, true);
  assert.equal(el('mode-chip-text').textContent, 'Người vs Người');
  assert.equal(el('mode-pvp').classList.contains('active'), true);
  assert.equal(el('mode-pvai').classList.contains('active'), false);
  await play('h3e3');
  assert.equal(state.moveHistory.length, 1, 'the game is playable now');
});

test('the menu can be reopened without touching the game, and the game can be resumed', async () => {
  const before = X.boardToFEN(state.board, state.turn, state.moveNumber);
  Game.showMenu();
  assert.equal(menuOpen(), true);
  assert.equal(resumeShown(), true, 'a "back to the game" button appears');
  assert.equal(X.boardToFEN(state.board, state.turn, state.moveNumber), before, 'opening the menu changes nothing');
  assert.equal(state.moveHistory.length, 1);

  press('Escape');
  assert.equal(menuOpen(), false, 'Esc closes it now that there is a game');
  Game.showMenu();
  Game.hideMenu();
  assert.equal(menuOpen(), false, 'the resume button works');
  assert.equal(state.moveHistory.length, 1, 'the game is intact');
});

test('picking a mode in the menu resets the board — even the same mode again', async () => {
  assert.equal(state.moveHistory.length, 1);
  Game.showMenu();
  Game.setMode('pvp');                                   // same mode as the one in use
  assert.equal(state.moveHistory.length, 0);
  assert.equal(X.boardToFEN(state.board, state.turn, state.moveNumber), X.DEFAULT_FEN);
  assert.equal(menuOpen(), false);

  await play('h3e3');
  Game.showMenu();
  Game.setMode('analyze');                               // a different mode
  assert.equal(state.moveHistory.length, 0);
  assert.equal(state.mode, 'analyze');
  assert.equal(el('mode-chip-text').textContent, 'Phân tích');
  assert.equal(el('analyze-mode-panel').classList.contains('hidden'), false);
  assert.equal(el('btn-hint').classList.contains('hidden'), true);
});

test('AI level and colour are settings of the menu: they do not touch a running game', async () => {
  Game.setMode('pvp');
  await play('h3e3');
  Game.setAILevel(8);
  Game.setPlayerColor('black');
  assert.equal(state.moveHistory.length, 1, 'the running game is not reset by changing a setting');
  assert.equal(state.aiLevel, 8);
  assert.equal(state.playerColor, 'black');
  assert.equal(el('level-label').textContent, 'Rất khó');
  assert.equal(el('level-value').textContent, 8);
  assert.equal(el('color-black').classList.contains('active'), true);
  assert.equal(el('color-red').classList.contains('active'), false);
  assert.equal(el('red-player-name').textContent, 'AI');
  assert.equal(el('black-player-name').textContent, 'Người chơi');

  Game.setMode('pvai');                                  // the settings apply to the game started now
  assert.equal(el('mode-chip-text').textContent, 'Người vs Máy · Rất khó', 'the chip shows the level');
  await waitFor(() => state.moveHistory.length === 1 && !state.isAIThinking);
  assert.equal(state.moveHistory[0].turnBefore, 'red', 'the human plays Black, so the AI (Red) opened');
  Game.setAILevel(2);
  assert.equal(el('mode-chip-text').textContent, 'Người vs Máy · Dễ', 'the chip follows the level');
  Game.setPlayerColor('red');
  Game.setMode('pvp');
});

test('a game reset by the menu cancels the AI that was thinking in the old game', async () => {
  Game.setPlayerColor('red');
  Game.setAILevel(2);
  Game.setMode('pvai');
  await play('h3e3');                                    // the AI is about to answer
  Game.showMenu();
  Game.setMode('pvp');                                   // chosen in the menu before the AI moved
  await sleep(2500);
  assert.equal(state.moveHistory.length, 0, 'the old game\'s AI move must not land in the new game');
});

test('lessons open an analysis game on their position', async () => {
  Game.loadLesson('4k4/9/9/9/9/9/9/R8/9/3K5 w - - 0 1');
  assert.equal(state.mode, 'analyze');
  assert.equal(state.board[7][0], 'R');
  assert.equal(state.moveHistory.length, 0);
  assert.equal(menuOpen(), false);
  Game.setMode('pvp');
});
