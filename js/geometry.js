/**
 * geometry.js - Pure drawing maths (no DOM), so it can be unit tested.
 */

const Geometry = (() => {

  /**
   * Points for an arrow drawn from (x1,y1) to (x2,y2).
   * - The TIP is exactly (x2,y2): the arrow must land on the intersection being moved to.
   * - The tail starts `startGap` away from (x1,y1) (so it leaves from the edge of the moving piece),
   *   but the gap is shrunk for short arrows so there is always room for the arrow head.
   * - The shaft ends `headLength * 0.75` before the tip so a thick round-capped line never pokes
   *   through the point of the head.
   * Returns null when both points coincide.
   */
  function arrowPoints(x1, y1, x2, y2, { startGap = 0, headLength = 12 } = {}) {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;

    const ux = dx / length, uy = dy / length;
    const gap = Math.min(startGap, Math.max(0, length - headLength * 1.5));
    const start = { x: x1 + ux * gap, y: y1 + uy * gap };
    const tip = { x: x2, y: y2 };
    const shaftEnd = { x: x2 - ux * headLength * 0.75, y: y2 - uy * headLength * 0.75 };

    return {
      start, tip, shaftEnd,
      mid: { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 },
      angle: Math.atan2(dy, dx),
    };
  }

  /**
   * Centre of a small badge pinned to the top-right corner of a piece centred at (cx,cy).
   * Clamped so the whole badge stays inside a width x height canvas (pieces on the edge of the board
   * would otherwise have it cut off); on the right/top edges it slides inward.
   */
  function badgePoint(cx, cy, pieceRadius, badgeRadius, width, height) {
    const offset = pieceRadius * 0.72;
    const margin = badgeRadius + 2;
    return {
      x: Math.min(Math.max(cx + offset, margin), width - margin),
      y: Math.min(Math.max(cy - offset, margin), height - margin),
    };
  }

  /**
   * How to draw the horizontal evaluation bar for a score given in centipawns from RED's point of view
   * (positive = Red is better). Returns { redPct, blackPct, label, side }.
   *
   * The split uses tanh so the bar reacts to small advantages (+1.00 ≈ 56% red, +3.00 ≈ 68%, +6.00 ≈ 82%)
   * yet never leaves the board entirely: each colour keeps at least MIN_PCT so both stay visible.
   * A null/NaN score (nothing analysed yet) gives an even bar with "—".
   */
  const MIN_PCT = 4;
  function evalBarSplit(score) {
    if (score === null || score === undefined || Number.isNaN(score)) {
      return { redPct: 50, blackPct: 50, label: '—', side: 'even' };
    }
    const mate = Math.abs(score) > 9000;
    const raw = mate ? (score > 0 ? 100 : 0) : 50 + 50 * Math.tanh(score / 800);
    const redPct = Math.min(100 - MIN_PCT, Math.max(MIN_PCT, raw));
    const label = mate
      ? 'Chiếu bí'
      : (score >= 0 ? '+' : '−') + (Math.abs(score) / 100).toFixed(2);
    const side = mate || Math.abs(score) > 50 ? (score > 0 ? 'red' : 'black') : 'even';
    return { redPct, blackPct: 100 - redPct, label, side };
  }

  return { arrowPoints, badgePoint, evalBarSplit };
})();
