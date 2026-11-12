const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContext } = require('./helpers');

const G = loadContext(['geometry']).get('Geometry');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// Board geometry used by ui.js: CELL = 60, PADDING = 40, piece radius = CELL * 0.48
const CELL = 60, PADDING = 40, PIECE_R = CELL * 0.48;
const xy = (row, col) => [PADDING + col * CELL, PADDING + row * CELL];

test('the arrow tip lands exactly on the destination intersection', () => {
  const cases = [
    [[7, 7], [7, 4]],     // cannon h3 -> e3 (horizontal)
    [[9, 1], [7, 2]],     // knight b1 -> c3
    [[6, 0], [5, 0]],     // pawn, one step
    [[0, 8], [9, 8]],     // full-length vertical
    [[2, 1], [2, 1 + 7]], // long horizontal
  ];
  for (const [from, to] of cases) {
    const [x1, y1] = xy(...from), [x2, y2] = xy(...to);
    const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R, headLength: 12 });
    near(p.tip.x, x2); near(p.tip.y, y2);
  }
});

test('the tail leaves from the edge of the moving piece, on the line to the target', () => {
  const [x1, y1] = xy(7, 7), [x2, y2] = xy(7, 4);
  const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R, headLength: 12 });
  near(dist(p.start, { x: x1, y: y1 }), PIECE_R);
  near(p.start.y, y1);                              // horizontal move stays horizontal
  assert.ok(p.start.x < x1, 'moves toward the target (leftwards)');
  near(p.angle, Math.PI);
});

test('the shaft stops inside the arrow head so the line never pokes past the tip', () => {
  const [x1, y1] = xy(9, 1), [x2, y2] = xy(7, 2);
  const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R, headLength: 12 });
  near(dist(p.shaftEnd, p.tip), 12 * 0.75);
  assert.ok(dist(p.start, p.shaftEnd) > 0, 'positive shaft length');
  // collinear: start -> shaftEnd -> tip
  near(dist(p.start, p.shaftEnd) + dist(p.shaftEnd, p.tip), dist(p.start, p.tip), 1e-6);
});

test('short arrows shrink the gap instead of vanishing or pointing backwards', () => {
  const [x1, y1] = xy(6, 0), [x2, y2] = xy(5, 0);   // one cell = 60px
  const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R, headLength: 12 });
  assert.ok(dist(p.start, p.tip) >= 12 * 1.5 - 1e-9, 'room for the head');
  const forward = (p.tip.y - p.start.y) * (y2 - y1) > 0;
  assert.ok(forward, 'tail is still behind the tip');

  const tiny = G.arrowPoints(0, 0, 5, 0, { startGap: 50, headLength: 12 });   // shorter than the head itself
  near(tiny.start.x, 0, 1e-9);                                                  // gap clamps to 0
  near(tiny.tip.x, 5);
});

test('the badge sits halfway along the visible arrow', () => {
  const [x1, y1] = xy(9, 1), [x2, y2] = xy(7, 2);
  const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R });
  near(dist(p.mid, p.start), dist(p.mid, p.tip));
});

test('identical points give no arrow', () => {
  assert.equal(G.arrowPoints(10, 10, 10, 10), null);
});

test('regression: the tip is not shortened by the piece radius any more', () => {
  // The old code pulled the tip back by CELL * 0.28 from the destination, so it stopped short.
  const [x1, y1] = xy(7, 7), [x2, y2] = xy(7, 4);
  const p = G.arrowPoints(x1, y1, x2, y2, { startGap: PIECE_R });
  assert.equal(dist(p.tip, { x: x2, y: y2 }), 0);
});

// ---------- move-quality badge ----------

test('the badge sits on the top-right corner of the piece', () => {
  const p = G.badgePoint(300, 300, PIECE_R, 12, 540, 600);
  assert.ok(p.x > 300 && p.y < 300, 'right of and above the centre');
  near(p.x - 300, PIECE_R * 0.72);
  near(300 - p.y, PIECE_R * 0.72);
});

test('the badge never leaves the canvas, even for pieces on the board edge', () => {
  const W = 540, H = 600, BADGE_R = CELL * 0.2;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const [cx, cy] = xy(row, col).reverse();          // xy returns [y, x]
      const p = G.badgePoint(cx, cy, PIECE_R, BADGE_R, W, H);
      assert.ok(p.x - BADGE_R >= 0 && p.x + BADGE_R <= W, `x inside for ${row},${col}`);
      assert.ok(p.y - BADGE_R >= 0 && p.y + BADGE_R <= H, `y inside for ${row},${col}`);
    }
  }
  // the right-hand file would stick out by ~9px without the clamp
  const edge = G.badgePoint(PADDING + 8 * CELL, 300, PIECE_R, BADGE_R, 540, 600);
  assert.ok(edge.x <= 540 - BADGE_R - 2 + 1e-9);
  // the top rank (row 0) is clamped downward, the piece's own corner is no longer the badge position
  const top = G.badgePoint(300, PADDING, PIECE_R, BADGE_R, 540, 600);
  assert.ok(top.y >= BADGE_R + 2 - 1e-9);
});

// ---------- horizontal evaluation bar ----------

test('evalBarSplit: an even position is split 50/50 and reads +0.00', () => {
  const e = G.evalBarSplit(0);
  near(e.redPct, 50); near(e.blackPct, 50);
  assert.equal(e.label, '+0.00');
  assert.equal(e.side, 'even');
});

test('evalBarSplit: the better side gets the longer part, with a readable signed label', () => {
  const red = G.evalBarSplit(300), black = G.evalBarSplit(-300);
  assert.ok(red.redPct > 50 && red.blackPct < 50);
  assert.ok(black.blackPct > 50 && black.redPct < 50);
  assert.equal(red.label, '+3.00');
  assert.equal(black.label, '−3.00');
  assert.equal(red.side, 'red'); assert.equal(black.side, 'black');
  near(red.redPct + red.blackPct, 100);
  near(G.evalBarSplit(-300).redPct, 100 - G.evalBarSplit(300).redPct, 1e-9);     // symmetric
});

test('evalBarSplit: the bar reacts to small advantages and keeps growing with the score', () => {
  const pct = (x) => G.evalBarSplit(x).redPct;
  assert.ok(pct(100) > 54 && pct(100) < 58, `+1.00 is visible: ${pct(100)}`);
  assert.ok(pct(300) > 65 && pct(300) < 72, `+3.00: ${pct(300)}`);
  assert.ok(pct(600) > 78 && pct(600) < 85, `+6.00 (a rook up): ${pct(600)}`);
  for (let x = 0; x < 2000; x += 50) assert.ok(pct(x + 50) >= pct(x), `monotonic at ${x}`);
});

test('evalBarSplit: neither colour ever disappears; a forced mate is shown as such', () => {
  const huge = G.evalBarSplit(5000), hugeBlack = G.evalBarSplit(-5000);
  near(huge.redPct, 96); near(huge.blackPct, 4);
  near(hugeBlack.redPct, 4); near(hugeBlack.blackPct, 96);
  const mate = G.evalBarSplit(99000), mateBlack = G.evalBarSplit(-98999);
  assert.equal(mate.label, 'Chiếu bí'); assert.equal(mate.side, 'red'); near(mate.redPct, 96);
  assert.equal(mateBlack.label, 'Chiếu bí'); assert.equal(mateBlack.side, 'black'); near(mateBlack.redPct, 4);
});

test('evalBarSplit: no score yet gives an even bar with a dash; tiny edges still count as even', () => {
  for (const nothing of [null, undefined, NaN]) {
    const e = G.evalBarSplit(nothing);
    assert.equal(e.label, '—'); assert.equal(e.side, 'even'); near(e.redPct, 50);
  }
  assert.equal(G.evalBarSplit(40).side, 'even');
  assert.equal(G.evalBarSplit(-40).side, 'even');
  assert.equal(G.evalBarSplit(60).side, 'red');
  assert.equal(G.evalBarSplit(-60).side, 'black');
});

// ---------- safe vs dangerous move dots ----------

test('UI.isSquareUnderAttack detects danger (red dot) vs safe moves (green dot)', () => {
  const { elementStub } = require('./helpers');
  const { get: getUIContext } = loadContext(['xiangqi', 'geometry', 'ui'], {
    document: {
      getElementById: () => {
        const el = elementStub();
        el.getContext = () => ({
          fillRect() {}, createLinearGradient() { return { addColorStop() {} }; },
          save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
          moveTo() {}, lineTo() {}, setLineDash() {}, fillText() {}, measureText: () => ({ width: 10 }),
        });
        return el;
      },
      createElement: () => elementStub(),
    }
  });
  const UI = getUIContext('UI');
  const XIANGQI = getUIContext('XIANGQI');

  const board = XIANGQI.createEmptyBoard();
  board[0] = ['r','n','b','a','k','a','b','n','r'];
  board[2][4] = 'c';
  board[2][7] = 'c';
  board[3] = ['p', null, 'p', null, 'p', null, 'p', null, 'p'];
  board[5][4] = 'P';
  board[6] = ['P', null, 'P', null, null, null, 'P', null, 'P'];
  board[7][1] = 'C';
  board[7][7] = 'C';
  board[9] = ['R','N','B','A','K','A','B','N','R'];

  // Moving Red pawn to (4, 4) puts it in range of Black pawn at (3, 4) which can capture it
  assert.equal(UI.isSquareUnderAttack(board, 5, 4, 4, 4), true, 'move to (4,4) is under attack -> danger (red)');
  // Moving Red pawn at (6, 0) to (5, 0) is safe from any enemy attacks
  assert.equal(UI.isSquareUnderAttack(board, 6, 0, 5, 0), false, 'move to (5,0) is safe -> safe (green)');
});

