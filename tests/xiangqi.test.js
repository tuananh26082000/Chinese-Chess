const test = require('node:test');
const assert = require('node:assert/strict');
const { loadXiangqi, perft } = require('./helpers');

const X = loadXiangqi();
const at = (fen) => X.parseFEN(fen);
const legal = (fen) => { const p = at(fen); return X.getLegalMoves(p.board, p.turn); };
const plain = (o) => JSON.parse(JSON.stringify(o));  // objects come from another vm realm
const hasMove = (moves, uci) => {
  const m = X.parseUCI(uci);
  return moves.some(x => x.fromRow === m.fromRow && x.fromCol === m.fromCol && x.toRow === m.toRow && x.toCol === m.toCol);
};
const inCheck = (fen, color) => X.isInCheck(at(fen).board, color);

test('perft from the start position matches known xiangqi counts', () => {
  const p = at(X.DEFAULT_FEN);
  assert.equal(perft(X, p.board, 'red', 1), 44);
  assert.equal(perft(X, p.board, 'red', 2), 1920);
  assert.equal(perft(X, p.board, 'red', 3), 79666);
});

test('FEN round trip', () => {
  const p = at(X.DEFAULT_FEN);
  assert.equal(X.boardToFEN(p.board, p.turn, 1), X.DEFAULT_FEN);
  const mid = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1';
  const q = at(mid);
  assert.equal(q.turn, 'black');
  assert.equal(X.boardToFEN(q.board, q.turn, 1), mid);
});

test('parseFEN rejects malformed input', () => {
  const bad = [
    'foo',
    '9/9/9 w',                                                                  // too few rows
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABN w - - 0 1',     // short row
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNRR w - - 0 1',   // long row
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABXR w - - 0 1',    // bad char
    '9/9/9/9/9/9/9/9/9/4K4 w - - 0 1',                                          // no black king
    '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',                                        // generals facing
    '3k5/9/9/9/9/9/9/9/9/3RK4 w - - 0 1',                                       // side not to move is in check
    null, undefined, 42,
  ];
  for (const f of bad) assert.throws(() => X.parseFEN(f), (e) => typeof e?.message === 'string', String(f));
});

test('UCI parsing uses ranks 1-10 and rejects garbage', () => {
  assert.deepEqual(plain(X.parseUCI('h3e3')), { fromRow: 7, fromCol: 7, toRow: 7, toCol: 4 });
  assert.deepEqual(plain(X.parseUCI('a10a9')), { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 });
  assert.equal(X.moveToUCI(0, 0, 1, 0), 'a10a9');
  for (const bad of ['', 'zz', 'a0a1', 'j1a1', 'a11a1', 'a1a', null, undefined]) {
    assert.equal(X.parseUCI(bad), null, String(bad));
  }
});

test('knight leg blocking', () => {
  const free = legal('4k4/9/9/9/9/9/9/4N4/9/3K5 w - - 0 1');
  assert.ok(hasMove(free, 'e3d5') && hasMove(free, 'e3f5'));
  const blocked = legal('4k4/9/9/9/9/9/4p4/4N4/9/3K5 w - - 0 1');
  assert.ok(!hasMove(blocked, 'e3d5') && !hasMove(blocked, 'e3f5'), 'leg on e4 blocks both forward jumps');
  assert.ok(hasMove(blocked, 'e3c4'), 'sideways jumps are unaffected');
});

test('cannon needs exactly one platform to capture', () => {
  const none = legal('3k5/9/9/4p4/9/9/9/4C4/9/4K4 w - - 0 1');
  assert.ok(!hasMove(none, 'e3e7'), 'no platform: cannot capture');
  const platform = legal('3k5/9/4p4/4p4/9/9/9/4C4/9/4K4 w - - 0 1');
  assert.ok(hasMove(platform, 'e3e8'), 'captures the second piece over a platform');
  assert.ok(!hasMove(platform, 'e3e7'), 'cannot capture the platform itself');
});

test('elephant stays home and respects a blocked eye', () => {
  const open = legal('3k5/9/9/9/9/9/9/9/9/2B1K4 w - - 0 1');
  assert.ok(hasMove(open, 'c1a3') && hasMove(open, 'c1e3'));
  assert.ok(!hasMove(legal('3k5/9/9/9/9/9/9/9/3p5/2B1K4 w - - 0 1'), 'c1e3'), 'eye on d2 blocked');
  const river = legal('3k5/9/9/9/9/4B4/9/9/9/4K4 w - - 0 1').filter(m => m.fromRow === 5);
  assert.ok(river.length > 0 && river.every(m => m.toRow >= 5), 'never crosses the river');
});

test('pawn moves sideways only after crossing the river', () => {
  const before = legal('4k4/9/9/9/9/9/4P4/9/9/3K5 w - - 0 1');
  assert.ok(hasMove(before, 'e4e5') && !hasMove(before, 'e4d4') && !hasMove(before, 'e4f4'));
  const after = legal('4k4/9/9/9/4P4/9/9/9/9/3K5 w - - 0 1');
  assert.ok(hasMove(after, 'e6d6') && hasMove(after, 'e6f6') && hasMove(after, 'e6e7'));
  assert.ok(!hasMove(after, 'e6e5'), 'pawns never move backwards');
});

test('king and advisor stay in the palace', () => {
  for (const fen of ['4k4/9/9/9/9/9/9/9/4A4/3K5 w - - 0 1', '3k5/9/9/9/9/9/9/9/9/3AK4 w - - 0 1']) {
    for (const m of legal(fen)) {
      assert.ok(m.toRow >= 7 && m.toCol >= 3 && m.toCol <= 5, `escaped palace: ${JSON.stringify(m)}`);
    }
  }
});

test('isInCheck: rook, cannon, knight, pawn', () => {
  assert.equal(inCheck('3k5/9/9/9/9/9/9/9/9/3RK4 b - - 0 1', 'black'), true, 'rook on the file');
  assert.equal(inCheck('3k5/9/9/9/9/9/9/9/9/2R1K4 b - - 0 1', 'black'), false, 'rook on another file');
  assert.equal(inCheck('3k5/3p5/9/9/9/9/9/3C5/9/4K4 b - - 0 1', 'black'), true, 'cannon over a platform');
  assert.equal(inCheck('3k5/9/9/9/9/9/9/3C5/9/4K4 b - - 0 1', 'black'), false, 'cannon without platform');
  assert.equal(inCheck('4k4/9/3N5/9/9/9/9/9/9/5K3 b - - 0 1', 'black'), true, 'knight');
  assert.equal(inCheck('4k4/3P5/3N5/9/9/9/9/9/9/5K3 b - - 0 1', 'black'), false, 'knight leg blocked');
  assert.equal(inCheck('4k4/4P4/9/9/9/9/9/9/9/5K3 b - - 0 1', 'black'), true, 'pawn forward');
  assert.equal(inCheck('3k5/4P4/9/9/9/9/9/9/9/5K3 b - - 0 1', 'black'), false, 'pawn does not attack diagonally');
  assert.equal(inCheck('3Pk4/9/9/9/9/9/9/9/9/5K3 b - - 0 1', 'black'), true, 'pawn sideways after river');
  assert.equal(inCheck('4k4/9/9/9/9/9/9/9/9/3K1P3 b - - 0 1', 'red'), false, 'no attackers on red');
});

test('flying general counts as check', () => {
  const board = X.createEmptyBoard();
  board[0][4] = 'k'; board[9][4] = 'K';
  assert.equal(X.isInCheck(board, 'red'), true);
  assert.equal(X.isInCheck(board, 'black'), true);
  board[5][4] = 'P';
  assert.equal(X.isInCheck(board, 'red'), false);
});

test('a pinned piece cannot move off the general file', () => {
  const m = legal('4k4/9/9/9/9/9/9/9/4A4/4K4 w - - 0 1');
  assert.ok(m.length > 0);
  assert.ok(!m.some(x => x.fromRow === 8 && x.fromCol === 4), 'advisor pinned against the flying general');
});

test('game state: checkmate, stalemate (a loss for the side to move), playing', () => {
  const state = (fen) => { const p = at(fen); return X.getGameState(p.board, p.turn); };
  assert.equal(state('R2k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1'), 'checkmate');
  assert.equal(state('3k5/R8/9/9/9/4R4/9/9/9/5K3 b - - 0 1'), 'stalemate');
  assert.equal(state(X.DEFAULT_FEN), 'playing');
});

test('Vietnamese notation', () => {
  const p = at(X.DEFAULT_FEN);
  const vn = (u) => X.uciToVietnamese(p.board, u);
  assert.equal(vn('h3e3'), 'P2-5');   // pháo đầu
  assert.equal(vn('b1c3'), 'M8.7');   // red knight advances
  assert.equal(vn('b10c8'), 'M2.3');  // black counts files from its own right
  assert.equal(vn('zzzz'), 'zzzz');   // unparsable input is returned as-is
});

test('Vietnamese notation disambiguates pieces on the same file', () => {
  const two = at('3k5/9/9/9/9/4R4/9/9/4R4/5K3 w - - 0 1');
  assert.equal(X.moveToVietnamese(two.board, 5, 4, 3, 4), 'TX.2', 'front rook');
  assert.equal(X.moveToVietnamese(two.board, 8, 4, 8, 3), 'HX-6', 'rear rook');
  const three = at('3k5/9/9/9/4P4/4P4/4P4/9/9/4K4 w - - 0 1');
  assert.equal(X.moveToVietnamese(three.board, 4, 4, 3, 4), 'TB.1', 'front pawn');
  assert.equal(X.moveToVietnamese(three.board, 5, 4, 5, 3), 'GB-6', 'middle pawn');
  assert.equal(X.moveToVietnamese(three.board, 6, 4, 6, 3), 'HB-6', 'rear pawn');
});

test('insufficient material and position keys', () => {
  assert.equal(X.isInsufficientMaterial(at('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1').board), true);
  assert.equal(X.isInsufficientMaterial(at('3ka4/9/9/9/9/9/9/9/9/3AK4 w - - 0 1').board), true);
  assert.equal(X.isInsufficientMaterial(at('3k5/9/9/9/9/9/9/9/9/3RK4 b - - 0 1').board), false);
  const p = at(X.DEFAULT_FEN);
  assert.notEqual(X.positionKey(p.board, 'red'), X.positionKey(p.board, 'black'));
});

test('isLegalMove validates ownership and rules', () => {
  const p = at(X.DEFAULT_FEN);
  const m = X.parseUCI('h3e3');
  assert.equal(X.isLegalMove(p.board, m.fromRow, m.fromCol, m.toRow, m.toCol, 'red'), true);
  assert.equal(X.isLegalMove(p.board, m.fromRow, m.fromCol, m.toRow, m.toCol, 'black'), false, "not black's piece");
  assert.equal(X.isLegalMove(p.board, 9, 0, 0, 0, 'red'), false, 'rook blocked by own pieces');
  assert.equal(X.isLegalMove(p.board, 4, 4, 5, 4, 'red'), false, 'empty square');
});

test('getLegalMoves leaves the board untouched', () => {
  const p = at(X.DEFAULT_FEN);
  const before = JSON.stringify(p.board);
  X.getLegalMoves(p.board, 'red');
  X.getLegalMovesForPiece(p.board, 7, 7, 'red');
  assert.equal(JSON.stringify(p.board), before);
});

test('full Vietnamese move descriptions', () => {
  const p = at(X.DEFAULT_FEN);
  const full = (u) => X.uciToVietnameseFull(p.board, u);
  assert.equal(full('h3e3'), 'Pháo 2 bình 5');
  assert.equal(full('b1c3'), 'Mã 8 tiến 7');
  assert.equal(full('a4a5'), 'Binh 9 tiến 1', 'red pawn is Binh');
  assert.equal(full('a7a6'), 'Tốt 1 tiến 1', 'black pawn is Tốt');
  assert.equal(full('i1i2'), 'Xe 1 tiến 1');
  assert.equal(full('zzzz'), 'zzzz', 'unparsable input is returned as-is');
  assert.equal(full('e5e6'), 'e5e6', 'empty square is returned as-is');
  const retreat = at('3k5/9/9/9/9/9/4R4/9/9/5K3 w - - 0 1');
  assert.equal(X.moveToVietnameseFull(retreat.board, 6, 4, 8, 4), 'Xe 5 thoái 2');
});

test('pvToSegments plays the line on a copy so each arrow starts where the piece really is', () => {
  const p = at(X.DEFAULT_FEN);
  const before = JSON.stringify(p.board);
  const segs = X.pvToSegments(p.board, ['h3e3', 'h8e8', 'b1c3', 'b10c8']);
  assert.deepEqual(plain(segs.map(s => s.ply)), [1, 2, 3, 4]);
  assert.deepEqual(plain(segs.map(s => s.mine)), [true, false, true, false], 'alternates: you, opponent, you, opponent');
  assert.deepEqual(plain(segs.map(s => s.uci)), ['h3e3', 'h8e8', 'b1c3', 'b10c8']);
  assert.deepEqual(plain({ r: segs[0].fromRow, c: segs[0].fromCol, tr: segs[0].toRow, tc: segs[0].toCol }), { r: 7, c: 7, tr: 7, tc: 4 });
  assert.equal(JSON.stringify(p.board), before, 'the input board is not modified');

  // the later moves depend on the earlier ones: e3 is only occupied after ply 1
  const chain = X.pvToSegments(p.board, ['h3e3', 'e3e7']);
  assert.equal(chain.length, 2, 'cannon continues from its new square');
});

test('pvToSegments stops at an unusable move and respects the length limit', () => {
  const p = at(X.DEFAULT_FEN);
  assert.equal(X.pvToSegments(p.board, ['h3e3', 'zzzz', 'b1c3']).length, 1, 'garbage ends the chain');
  assert.equal(X.pvToSegments(p.board, ['h3e3', 'e5e6']).length, 1, 'move from an empty square ends the chain');
  assert.equal(X.pvToSegments(p.board, ['h3e3', 'h8e8', 'b1c3', 'b10c8'], 2).length, 2, 'maxPlies');
  assert.equal(X.pvToSegments(p.board, []).length, 0);
  assert.equal(X.pvToSegments(p.board, ['a10a9'])[0].fromRow, 0, 'rank 10 is supported');
});
