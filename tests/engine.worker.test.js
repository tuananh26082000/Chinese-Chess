const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext } = require('./helpers');

// A fake Worker lets us look at what the engine sends to Stockfish, without loading any WebAssembly.
class FakeWorker {
  constructor() { this.sent = []; FakeWorker.last = this; }
  postMessage(m) {
    this.sent.push(m);
    if (m === 'isready') setTimeout(() => this.onmessage({ data: 'readyok' }), 0);
  }
  say(line) { this.onmessage({ data: line }); }
  terminate() {}
}

const { get } = loadContext(['xiangqi', 'engine'], { SharedArrayBuffer: function () {}, crossOriginIsolated: true, Worker: FakeWorker });
const X = get('XIANGQI');
const Engine = get('Engine');
const tick = () => new Promise(r => setTimeout(r, 5));

test.before(async () => { assert.equal(await Engine.init(), true, 'real-worker path is used'); });

test('stopAnalysis interrupts a candidate-line analysis...', async () => {
  const w = FakeWorker.last; w.sent.length = 0;
  const p = Engine.analyzeMultiPV(X.DEFAULT_FEN, 8, 3);
  await tick();
  assert.ok(w.sent.some(m => m.startsWith('go ')), 'the search started');
  Engine.stopAnalysis();
  assert.ok(w.sent.includes('stop'), 'a candidate-line analysis is stopped on request');
  w.say('info depth 3 multipv 1 score cp 20 pv h3e3 h8e8');
  w.say('bestmove h3e3');
  const res = await p;
  assert.equal(res.variations[0].firstMove, 'h3e3');
});

test('...but never cuts short the search that judges a move', async () => {
  const w = FakeWorker.last; w.sent.length = 0;
  const p = Engine.analyzePosition(X.DEFAULT_FEN, 8);
  await tick();
  Engine.stopAnalysis();
  assert.ok(!w.sent.includes('stop'), 'the move judgement keeps running');
  w.say('info depth 8 score cp 35 pv h3e3');
  w.say('bestmove h3e3');
  const res = await p;
  assert.equal(res.score, 35);
});

test('...nor the AI\'s own move search', async () => {
  const w = FakeWorker.last; w.sent.length = 0;
  const p = Engine.getBestMove(X.DEFAULT_FEN, 6, 1000);
  await tick();
  Engine.stopAnalysis();
  assert.ok(!w.sent.includes('stop'));
  w.say('bestmove b1c3');
  assert.equal(await p, 'b1c3');
});

test('requests are served one at a time: the judgement finishes before the next analysis starts', async () => {
  const w = FakeWorker.last; w.sent.length = 0;
  const judge = Engine.analyzePosition(X.DEFAULT_FEN, 8);
  const lines = Engine.analyzeMultiPV(X.DEFAULT_FEN, 8, 3);
  await tick();
  assert.equal(w.sent.filter(m => m.startsWith('go ')).length, 1, 'only the first search has started');
  w.say('info depth 8 score cp 10 pv h3e3'); w.say('bestmove h3e3');
  await judge; await tick();
  assert.equal(w.sent.filter(m => m.startsWith('go ')).length, 2, 'the second starts once the first is done');
  w.say('info depth 3 multipv 1 score cp 5 pv h3e3 h8e8'); w.say('bestmove h3e3');
  await lines;
});

// ---------- Variety through the real-engine path ----------
const feed = (w, lines) => lines.forEach(l => w.say(l));
const searchWith = async (variety, rng, lines) => {
  const w = FakeWorker.last; w.sent.length = 0;
  const p = Engine.getBestMove(X.DEFAULT_FEN, 8, 1000, { variety, rng });
  await tick();
  const multipv = w.sent.filter(m => m.startsWith('setoption name MultiPV')).at(-1);
  feed(w, lines);
  return { multipv, move: await p };
};
const CANDIDATE_LINES = [
  'info depth 7 multipv 1 score cp 20 pv h3e3 h8e8', 'info depth 7 multipv 2 score cp -10 pv b1c3 b10c8',
  'info depth 8 multipv 1 score cp 50 pv h3e3 h8e8', 'info depth 8 multipv 2 score cp 30 pv b1c3 b10c8',
  'info depth 8 multipv 3 score cp -250 pv a4a5 a7a6', 'info depth 8 multipv 4 score cp 40 pv i4i5 i7i6',
  'bestmove h3e3',
];

test('variety asks Stockfish for several lines and picks among the near-best ones', async () => {
  const lowRng = await searchWith({ margin: 100, candidates: 4 }, () => 0, CANDIDATE_LINES);
  assert.equal(lowRng.multipv, 'setoption name MultiPV value 4', 'MultiPV 4 requested');
  assert.equal(lowRng.move, 'h3e3', 'rng 0 = the best');
  const highRng = await searchWith({ margin: 100, candidates: 4 }, () => 0.9999, CANDIDATE_LINES);
  assert.notEqual(highRng.move, 'h3e3', 'a different near-best move can be chosen');
  assert.ok(['b1c3', 'i4i5'].includes(highRng.move), `chosen from the lines within 100 cp: ${highRng.move}`);
  assert.notEqual(highRng.move, 'a4a5', 'the line 300 cp worse is never chosen');
});

test('only the deepest result of each line counts', async () => {
  const picked = new Set();
  for (let i = 0; i < 40; i++) {
    const r = await searchWith({ margin: 100, candidates: 4 }, () => i / 40, CANDIDATE_LINES);
    picked.add(r.move);
  }
  assert.ok(!picked.has('a4a5'), 'depth-8 score (-250) is used, not an earlier optimistic one');
  assert.ok(picked.size >= 2);
});

test('level 10 (margin 0) asks for ONE line and plays exactly the engine\'s best move', async () => {
  const exact = Engine.varietyForLevel(10, 0);
  for (const rng of [() => 0, () => 0.5, () => 0.9999]) {
    const r = await searchWith(exact, rng, CANDIDATE_LINES);
    assert.equal(r.multipv, 'setoption name MultiPV value 1');
    assert.equal(r.move, 'h3e3', 'the best move, whatever the dice say');
  }
});

test('without variety the behaviour is unchanged: one line, the best move', async () => {
  const r = await searchWith(undefined, () => 0.9999, CANDIDATE_LINES);
  assert.equal(r.multipv, 'setoption name MultiPV value 1');
  assert.equal(r.move, 'h3e3');
});

test('a forced mate is played even when variety is allowed', async () => {
  const r = await searchWith({ margin: 500, candidates: 4 }, () => 0.9999, [
    'info depth 9 multipv 1 score mate 2 pv h3e3 h8e8', 'info depth 9 multipv 2 score cp 300 pv b1c3 b10c8', 'bestmove h3e3',
  ]);
  assert.equal(r.move, 'h3e3');
});
