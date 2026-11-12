const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext } = require('./helpers');

// No SharedArrayBuffer in the sandbox => Engine.init() selects the built-in alpha-beta engine.
const { get } = loadContext(['xiangqi', 'engine']);
const X = get('XIANGQI');
const Engine = get('Engine');

const uciLegal = (fen, uci) => {
  const p = X.parseFEN(fen); const m = X.parseUCI(uci);
  return !!m && X.isLegalMove(p.board, m.fromRow, m.fromCol, m.toRow, m.toCol, p.turn);
};

test('engine requests are rejected before init', async () => {
  await assert.rejects(() => Engine.getBestMove(X.DEFAULT_FEN, 3, 100));
});

test('init falls back to the built-in engine', async () => {
  assert.equal(await Engine.init(), false);
  assert.equal(Engine.isReady(), true);
});

test('best move is always legal, for both colours', async () => {
  for (const fen of [
    X.DEFAULT_FEN,
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1',
  ]) {
    for (const depth of [3, 6, 9]) {
      const mv = await Engine.getBestMove(fen, depth, 1000);
      assert.ok(uciLegal(fen, mv), `${mv} at depth ${depth}`);
    }
  }
});

test('finds mate in one and reports a mate score', async () => {
  const fen = '3k5/R8/9/9/9/9/9/9/9/4K3R w - - 0 1';
  const mv = await Engine.getBestMove(fen, 6, 1000);
  // Any move after which Black has no legal reply wins (checkmate or stalemate both lose in xiangqi)
  const p = X.parseFEN(fen); const m = X.parseUCI(mv);
  const after = X.applyMove(p.board, m.fromRow, m.fromCol, m.toRow, m.toCol);
  assert.equal(X.getLegalMoves(after, 'black').length, 0, `${mv} should leave Black without moves`);
  const { score } = await Engine.analyzePosition(fen, 6);
  assert.ok(score > 9000, `mate score expected, got ${score}`);
});

test('takes a free queen-sized piece', async () => {
  // Red rook can capture an undefended black rook
  const fen = '3k5/9/9/9/9/9/9/9/r3R4/5K3 w - - 0 1';
  assert.equal(await Engine.getBestMove(fen, 6, 1000), 'e2a2');
});

test('scores are from the side to move, so mirrored positions agree', async () => {
  const red = await Engine.analyzePosition('3k5/9/9/9/9/9/9/9/R8/4K4 w - - 0 1', 4);
  const black = await Engine.analyzePosition('4k4/r8/9/9/9/9/9/9/9/3K5 b - - 0 1', 4);
  assert.ok(red.score > 300, `side with a rook is better: ${red.score}`);
  assert.ok(black.score > 300, `mirror position, same sign: ${black.score}`);
});

test('no legal move: bestMove is null and score is a loss', async () => {
  const fen = 'R2k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1';  // checkmate
  assert.equal(await Engine.getBestMove(fen, 4, 500), null);
  const { score } = await Engine.analyzePosition(fen, 4);
  assert.ok(score < -9000);
});

test('concurrent requests are serialised and all resolve', async () => {
  const results = await Promise.all([
    Engine.analyzePosition(X.DEFAULT_FEN, 4),
    Engine.analyzePosition(X.DEFAULT_FEN, 4),
    Engine.getBestMove(X.DEFAULT_FEN, 4, 500),
  ]);
  assert.equal(typeof results[0].score, 'number');
  assert.equal(typeof results[1].score, 'number');
  assert.ok(uciLegal(X.DEFAULT_FEN, results[2]));
});

test('depth is bounded by the time limit', async () => {
  const t = Date.now();
  await Engine.getBestMove(X.DEFAULT_FEN, 12, 300);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
});

test('evalBoard is zero-ish for the start position and favours material', () => {
  const start = X.parseFEN(X.DEFAULT_FEN).board;
  assert.equal(Engine.evalBoard(start), 0);
  const up = X.parseFEN('3k5/9/9/9/9/9/9/9/R8/4K4 w - - 0 1').board;
  assert.ok(Engine.evalBoard(up) > 0, 'red is ahead');
});

test('classifyMoveQuality covers every band in order', () => {
  const q = (best, after) => Engine.classifyMoveQuality(best, after).key;
  assert.equal(q(0, 100), 'brilliant');
  assert.equal(q(0, 0), 'great');
  assert.equal(q(0, -30), 'good');
  assert.equal(q(0, -60), 'ok');
  assert.equal(q(0, -100), 'inaccuracy');
  assert.equal(q(0, -200), 'mistake');
  assert.equal(q(0, -500), 'blunder');
  assert.ok(Engine.QUALITY.BLUNDER.label && Engine.QUALITY.BLUNDER.emoji);
});

// ---------- MultiPV (candidate lines with the opponent's reply) ----------
const legalFrom = (fen, uci) => uciLegal(fen, uci);
const afterMove = (fen, uci) => {
  const p = X.parseFEN(fen); const m = X.parseUCI(uci);
  const board = X.applyMove(p.board, m.fromRow, m.fromCol, m.toRow, m.toCol);
  return X.boardToFEN(board, p.turn === 'red' ? 'black' : 'red', 1);
};

test('analyzeMultiPV returns ranked, legal candidate lines with replies', async () => {
  const { variations } = await Engine.analyzeMultiPV(X.DEFAULT_FEN, 8, 3);
  assert.equal(variations.length, 3);
  assert.deepEqual(Array.from(variations, v => v.rank), [1, 2, 3]);
  for (const v of variations) {
    assert.ok(legalFrom(X.DEFAULT_FEN, v.firstMove), `candidate ${v.firstMove} is legal`);
    assert.ok(v.counterMove, 'each line carries the opponent reply');
    assert.ok(legalFrom(afterMove(X.DEFAULT_FEN, v.firstMove), v.counterMove), `reply ${v.counterMove} is legal`);
    assert.equal(v.pv[0], v.firstMove);
    assert.equal(typeof v.score, 'number');
  }
  assert.ok(variations[0].score >= variations[1].score && variations[1].score >= variations[2].score, 'sorted best first');
  assert.equal(new Set(Array.from(variations, v => v.firstMove)).size, 3, 'distinct candidates');
});

test('analyzeMultiPV flags forced mates', async () => {
  const fen = '3k5/R8/9/9/9/9/9/9/9/4K3R w - - 0 1';
  const { variations } = await Engine.analyzeMultiPV(fen, 6, 3);
  assert.equal(variations[0].isMate, true);
  assert.ok(variations[0].score > 9000);
});

test('analyzeMultiPV scores are from the mover\'s view for Black too', async () => {
  const { variations } = await Engine.analyzeMultiPV('4k4/r8/9/9/9/9/9/9/9/3K5 b - - 0 1', 4, 3);
  assert.ok(variations[0].score > 300, `Black has a rook: ${variations[0].score}`);
  assert.ok(legalFrom('4k4/r8/9/9/9/9/9/9/9/3K5 b - - 0 1', variations[0].firstMove));
});

test('analyzeMultiPV: stale requests are skipped, and a position with no moves yields none', async () => {
  const skipped = await Engine.analyzeMultiPV(X.DEFAULT_FEN, 8, 3, null, { shouldAbort: () => true });
  assert.equal(skipped.aborted, true);
  assert.equal(skipped.variations.length, 0);
  const mated = await Engine.analyzeMultiPV('R2k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1', 4, 3);
  assert.equal(mated.variations.length, 0);
});

test('analyzeMultiPV reports progress to the caller', async () => {
  let calls = 0;
  await Engine.analyzeMultiPV(X.DEFAULT_FEN, 6, 3, (vars) => { calls++; assert.ok(vars.length > 0); });
  assert.ok(calls >= 1);
});

test('every move quality has a badge symbol and a colour that matches the stylesheet', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const all = Object.values(Engine.QUALITY);
  assert.equal(all.length, 7);
  assert.equal(new Set(Array.from(all, q => q.symbol)).size, 7, 'symbols are distinct');
  for (const q of all) {
    assert.ok(q.symbol && q.symbol.length <= 2, `${q.key}: short symbol`);
    assert.match(q.color, /^#[0-9a-f]{6}$/i);
    const m = css.match(new RegExp(`--quality-${q.key}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `--quality-${q.key} exists in style.css`);
    assert.equal(m[1].toLowerCase(), q.color.toLowerCase(), `${q.key}: badge colour equals the panel colour`);
  }
});

// ---------- Variety: the AI should not always answer the same way ----------
const plainJson = (o) => JSON.parse(JSON.stringify(o));

test('varietyForLevel: level 10 is exact; every lower level allows more variety', () => {
  for (const plies of [0, 5, 9, 10, 40]) {
    assert.equal(Engine.varietyForLevel(10, plies).margin, 0, `level 10 never strays (ply ${plies})`);
  }
  for (const plies of [0, 40]) {
    let previous = Infinity;
    for (let level = 1; level <= 10; level++) {
      const m = Engine.varietyForLevel(level, plies).margin;
      assert.ok(m <= previous, `margin does not grow with level (level ${level}, ply ${plies})`);
      if (level < 10) assert.ok(m > 0, `level ${level} varies`);
      previous = m;
    }
  }
  assert.ok(Engine.varietyForLevel(1, 40).margin > Engine.varietyForLevel(9, 40).margin * 3, 'beginners roam far wider');
  assert.ok(Engine.varietyForLevel(5, 0).margin > Engine.varietyForLevel(5, 40).margin, 'the opening is wider');
  assert.ok(Engine.varietyForLevel(1, 0).margin <= 300, 'but never absurd');
});

test('varietyForLevel: odd input is clamped', () => {
  assert.equal(Engine.varietyForLevel(99).margin, 0);
  assert.ok(Engine.varietyForLevel(0, 40).margin === Engine.varietyForLevel(1, 40).margin);
  assert.ok(Engine.varietyForLevel(undefined, 40).margin > 0);
  assert.ok(Engine.varietyForLevel('7', 40).margin === Engine.varietyForLevel(7, 40).margin);
});

test('pickMove: only moves within the margin are eligible, and better ones are likelier', () => {
  const c = [{ move: 'a', score: 100 }, { move: 'b', score: 70 }, { move: 'c', score: -300 }];
  const picks = new Set();
  for (let i = 0; i < 200; i++) picks.add(Engine.pickMove(c, { margin: 100, rng: () => i / 200 }));
  assert.deepEqual([...picks].sort(), ['a', 'b'], 'the losing move c is never chosen');

  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 1000; i++) counts[Engine.pickMove(c, { margin: 100, rng: () => i / 1000 })]++;
  assert.ok(counts.a > counts.b && counts.b > 150, `weighted towards the best, but b still plays: ${JSON.stringify(counts)}`);
});

test('pickMove: rng extremes and degenerate input', () => {
  const c = [{ move: 'a', score: 10 }, { move: 'b', score: 0 }];
  assert.equal(Engine.pickMove(c, { margin: 50, rng: () => 0 }), 'a');
  assert.equal(Engine.pickMove(c, { margin: 50, rng: () => 0.999999 }), 'b');
  assert.equal(Engine.pickMove(c, { margin: 50, rng: () => 5 }), 'b', 'rng is clamped');
  assert.equal(Engine.pickMove(c, { margin: 50, rng: () => -5 }), 'a');
  assert.equal(Engine.pickMove(c, { margin: 0, rng: () => 0.9 }), 'a', 'margin 0 = always the best');
  assert.equal(Engine.pickMove([{ move: 'only', score: 3 }], { margin: 99 }), 'only');
  assert.equal(Engine.pickMove([], { margin: 99 }), null);
  assert.equal(Engine.pickMove(null, { margin: 99 }), null);
});

test('pickMove: never gives up a forced win, never walks into a forced mate', () => {
  const winning = [{ move: 'mate', score: 98990 }, { move: 'other', score: 98980 }, { move: 'slow', score: 500 }];
  for (let i = 0; i < 50; i++) assert.equal(Engine.pickMove(winning, { margin: 500, rng: () => i / 50 }), 'mate');

  const risky = [{ move: 'safe', score: 20 }, { move: 'blunder', score: -98990 }];
  for (let i = 0; i < 50; i++) assert.equal(Engine.pickMove(risky, { margin: 200000, rng: () => i / 50 }), 'safe');
});

test('getBestMove with variety: different games get different answers, all of them legal', async () => {
  const fen = X.DEFAULT_FEN;
  const seen = new Set();
  for (let i = 0; i < 24; i++) {
    const mv = await Engine.getBestMove(fen, 4, 300, { variety: { margin: 150, candidates: 4 }, rng: () => (i * 0.137) % 1 });
    assert.ok(uciLegal(fen, mv), `${mv} is legal`);
    seen.add(mv);
  }
  assert.ok(seen.size >= 4, `plenty of different replies: ${[...seen]}`);
});

test('getBestMove with variety still takes a free rook, at every level', async () => {
  const fen = '3k5/9/9/9/9/9/9/9/r3R4/5K3 w - - 0 1';        // Re2xa2 wins a whole rook
  for (const level of [1, 3, 5, 7, 9, 10]) {
    for (let i = 0; i < 5; i++) {
      const mv = await Engine.getBestMove(fen, 6, 400, { variety: Engine.varietyForLevel(level, 0), rng: () => i / 5 });
      assert.equal(mv, 'e2a2', `level ${level}`);
    }
  }
});

test('getBestMove at level 10 takes the single best move (no variety request)', async () => {
  const fen = '3k5/9/9/9/9/9/9/9/r3R4/5K3 w - - 0 1';
  const exact = Engine.varietyForLevel(10, 0);
  for (let i = 0; i < 6; i++) {
    assert.equal(await Engine.getBestMove(fen, 6, 400, { variety: exact, rng: () => i / 6 }), 'e2a2');
  }
});
