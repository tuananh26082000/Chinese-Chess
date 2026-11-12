const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext, elementStub } = require('./helpers');

// Minimal DOM: the analyzer reads two inputs and writes into a results container.
const inputs = { 'analyze-fen': { value: '' }, 'analyze-moves': { value: '' } };
const results = { innerHTML: '', textContent: '', replaceChildren(p) { this.innerHTML = ''; this.error = p.textContent; } };
const document = {
  getElementById: (id) => inputs[id] || (id === 'analyze-results' ? results : elementStub()),
  createElement: () => elementStub(),
  querySelector: () => elementStub(),
  querySelectorAll: () => [],
  addEventListener() {},
};
const UI = { showToast() {} };

const { get } = loadContext(['xiangqi', 'engine', 'analyzer'], { UI, document });
const Engine = get('Engine');
const Analyzer = get('Analyzer');

const run = async (fen, moves) => {
  inputs['analyze-fen'].value = fen;
  inputs['analyze-moves'].value = moves;
  results.innerHTML = ''; results.error = undefined;
  await Analyzer.startAnalysis();
};

test.before(async () => { await Engine.init(); });

test('analyses a legal game and reports per-move quality', async () => {
  await run('', 'h3e3 h8e8 b1c3');
  assert.equal(results.error, undefined);
  assert.match(results.innerHTML, /Kết quả phân tích/);
  assert.equal((results.innerHTML.match(/analysis-move-item/g) || []).length, 3);
});

test('accepts moves on rank 10 (Black back rank)', async () => {
  // Black rook on a10 moves along the back rank
  await run('r3k4/9/9/9/9/9/9/9/9/3K5 b - - 0 1', 'a10b10');
  assert.equal(results.error, undefined, results.error);
  assert.match(results.innerHTML, /analysis-move-item/);
});

test('rejects malformed move tokens with a clear message', async () => {
  await run('', 'h3e3 banana');
  assert.match(results.error, /banana/);
});

test('rejects illegal moves instead of silently applying them', async () => {
  await run('', 'h3e3 h3e3');   // second move: no red cannon on h3 any more, and it is Black's turn
  assert.match(results.error, /không hợp lệ/);
});

test('rejects an invalid FEN', async () => {
  await run('definitely not a fen', 'h3e3');
  assert.ok(results.error, 'an error is shown');
});
