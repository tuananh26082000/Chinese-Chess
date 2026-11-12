const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const idsInHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('the evaluation bar sits at the very top of the game view, above the board layout', () => {
  const view = html.indexOf('id="view-game"');
  const bar = html.indexOf('id="eval-hbar"');
  const layout = html.indexOf('class="game-layout"');
  assert.ok(view > 0 && bar > view && layout > bar, 'view-game < eval-hbar < game-layout');
  const block = html.slice(bar, layout);
  for (const id of ['eval-hbar-black', 'eval-hbar-red', 'eval-hbar-score']) assert.ok(block.includes(`id="${id}"`), id);
  assert.match(block, /class="eval-hbar-fill black"[\s\S]*class="eval-hbar-fill red"/, 'Black on the left, Red on the right');
});

test('the old vertical evaluation bar is gone (no duplicate score)', () => {
  for (const id of ['eval-bar', 'eval-fill-red', 'eval-fill-black', 'eval-indicator', 'eval-score']) {
    assert.ok(!idsInHtml.has(id), `${id} should not exist any more`);
  }
  assert.ok(idsInHtml.has('eval-chart'), 'the history chart stays');
});

test('every element the scripts look up by a fixed id exists in index.html (wiring check)', () => {
  // Elements that are created by the scripts themselves, so they are not in the static HTML
  const created = new Set(['analysis-progress-fill', 'analysis-progress-text']);
  const missing = [];
  for (const file of ['main', 'ui', 'editor', 'analyzer', 'engine', 'pwa']) {
    const src = read(`js/${file}.js`);
    for (const m of src.matchAll(/getElementById\(\s*'([^'$]+)'\s*\)/g)) {
      if (!idsInHtml.has(m[1]) && !created.has(m[1])) missing.push(`${file}.js: #${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `ids used in JS but missing from index.html:\n${missing.join('\n')}`);
});

test('every inline onclick calls a function that exists on window.game / boardEditor / analyzer', () => {
  const api = {
    game: read('js/main.js').match(/return \{\s*init,[\s\S]*?\n  \};/)[0],
    boardEditor: read('js/editor.js').match(/return \{\s*init,[\s\S]*?\n  \};/)[0],
    analyzer: read('js/analyzer.js').match(/return \{[^}]*\};/)[0],
  };
  const missing = [];
  for (const m of html.matchAll(/window\.(game|boardEditor|analyzer)\.(\w+)\(/g)) {
    if (!new RegExp(`\\b${m[2]}\\b`).test(api[m[1]])) missing.push(`window.${m[1]}.${m[2]}`);
  }
  assert.deepEqual([...new Set(missing)], [], 'onclick handlers pointing at functions that are not exported');
});

test('setup screen: Black\'s tray above the board, Red\'s tray and the FEN row below it', () => {
  const black = html.indexOf('id="editor-tray-black"');
  const board = html.indexOf('id="xiangqi-board"');
  const red = html.indexOf('id="editor-tray-red"');
  const fen = html.indexOf('id="editor-fen-row"');
  const toolbar = html.indexOf('id="editor-toolbar"');
  assert.ok(black > 0 && black < board && board < red && red < fen && fen < toolbar,
    'black tray < board < red tray < FEN row < toolbar');

  const section = (from, to) => html.slice(from, to);
  const blackTray = section(black, board), redTray = section(red, fen);
  const letters = (tray) => [...tray.matchAll(/data-piece="(\w)"/g)].map(m => m[1]);
  assert.deepEqual(letters(blackTray), ['r', 'n', 'b', 'a', 'k', 'c', 'p'], 'black pieces (lower case), in board order');
  assert.deepEqual(letters(redTray), ['R', 'N', 'B', 'A', 'K', 'C', 'P'], 'red pieces (upper case)');
  for (const l of [...letters(blackTray), ...letters(redTray)]) assert.ok(idsInHtml.has(`editor-count-${l}`), `badge for ${l}`);
});

test('setup screen: turn toggle on top, toolbar with clear / reset / flip / analyse', () => {
  const turn = html.indexOf('id="editor-turnbar"');
  assert.ok(turn > 0 && turn < html.indexOf('id="editor-tray-black"'));
  assert.ok(html.indexOf('id="editor-turn-red"') > turn && html.indexOf('id="editor-turn-black"') > turn);

  const toolbar = html.slice(html.indexOf('id="editor-toolbar"'));
  for (const call of ['clearBoard()', 'resetDefaultBoard()', 'flipBoard()', 'startAnalysis()']) {
    assert.ok(toolbar.includes(call), `toolbar offers ${call}`);
  }
  assert.ok(toolbar.indexOf('id="editor-start-btn"') > toolbar.indexOf('flipBoard()'), 'the main action is last');
});

test('everything of the setup screen starts hidden', () => {
  for (const id of ['editor-turnbar', 'editor-tray-black', 'editor-tray-red', 'editor-fen-row', 'editor-toolbar', 'editor-palette-container']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*class="[^"]*\\bhidden\\b|class="[^"]*\\bhidden\\b[^"]*"[^>]*id="${id}"`), `${id} is hidden initially`);
  }
});

// ---------- main menu ----------

test('the main menu holds the mode choices and the AI settings, and starts hidden', () => {
  const menu = html.indexOf('id="main-menu"');
  assert.ok(menu > 0);
  assert.match(html.slice(menu - 10, menu + 120), /class="main-menu hidden"/, 'hidden until the app has started');
  const end = html.indexOf('<!-- GAME OVER MODAL -->');
  const block = html.slice(menu, end);
  for (const id of ['mode-pvai', 'mode-pvp', 'mode-analyze-play', 'ai-level', 'level-label', 'level-value', 'color-red', 'color-black', 'menu-resume']) {
    assert.ok(block.includes(`id="${id}"`), `${id} is in the menu`);
  }
  assert.match(block, /setMode\('pvai'\)[\s\S]*setMode\('pvp'\)[\s\S]*setMode\('analyze'\)/);
  assert.match(block, /id="menu-resume"[^>]*hidden|class="menu-resume hidden"/, 'the back button is hidden until there is a game');
});

test('the old "Chế độ chơi" card is gone from the side panel; a chip above the board opens the menu', () => {
  assert.ok(!html.includes('class="game-controls'), 'no game-controls card any more');
  for (const id of ['mode-pvai', 'mode-pvp', 'mode-analyze-play', 'ai-level', 'color-red']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} exists exactly once`);
  }
  const chip = html.indexOf('id="mode-chip"');
  assert.ok(chip > html.indexOf('class="board-section"') && chip < html.indexOf('id="xiangqi-board"'), 'chip sits above the board');
  assert.match(html.slice(chip - 80, chip + 200), /showMenu\(\)/);
  assert.ok(idsInHtml.has('mode-chip-text'));
});
