/**
 * ui.js - Board Rendering & User Interaction
 * Handles canvas drawing, piece selection, move highlighting, animations
 */

const UI = (() => {

  const canvas = document.getElementById('xiangqi-board');
  const ctx = canvas.getContext('2d');

  // Board dimensions
  const PADDING = 40;
  const CELL = 60;
  const BOARD_W = 8 * CELL; // 9 columns, 8 gaps
  const BOARD_H = 9 * CELL; // 10 rows, 9 gaps
  const CANVAS_W = BOARD_W + 2 * PADDING;
  const CANVAS_H = BOARD_H + 2 * PADDING;

  // Resize canvas
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  let state = {
    board: null,
    selected: null, // {row, col}
    legalMoves: [],
    lastMove: null,
    flipped: false,
    mode: 'pvai', // 'pvp' | 'pvai' | 'analyze'
    hintMove: null,
    animPiece: null,
    analysis: false,
    evalHistory: [],
    moveQualityMap: {}, // key: "fromRow,fromCol,toRow,toCol" -> quality
  };

  // Color palette
  // One colour per variation; the same colours are used on the variation cards (see style.css .rank-N)
  const VARIATION_COLORS = [
    { color: '#10b981', glow: 'rgba(16, 185, 129, 0.75)' },
    { color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.75)' },
    { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.75)' },
  ];
  const MAX_CHAIN_PLIES = 4;   // your move, reply, your next move, their next reply

  const RIVER_TEXT = { left: 'Cờ Tướng', right: 'Fsoft' };

  const COLORS = {
    boardBg: '#7B3F00',
    boardDark: '#5C2D0A',
    boardLight: '#A0522D',
    line: '#4a2000',
    riverText: '#3a1500',
    selectedBg: 'rgba(255, 215, 0, 0.28)',
    selectedBorder: '#ffd700',
    legalDot: 'rgba(0, 210, 200, 0.6)',
    legalCapture: 'rgba(239, 68, 68, 0.4)',
    lastMoveFrom: 'rgba(59, 130, 246, 0.25)',
    lastMoveTo: 'rgba(59, 130, 246, 0.35)',
    hintFrom: 'rgba(0, 210, 200, 0.25)',
    hintTo: 'rgba(0, 210, 200, 0.5)',
    redPieceBg: 'radial-gradient(circle at 35% 35%, #e84c4c, #9a1515)',
    blackPieceBg: 'radial-gradient(circle at 35% 35%, #4a4a7a, #111130)',
  };

  function colToX(col) { return PADDING + (state.flipped ? 8 - col : col) * CELL; }
  function rowToY(row) { return PADDING + (state.flipped ? 9 - row : row) * CELL; }
  function xToCol(x) { const c = Math.round((x - PADDING) / CELL); return state.flipped ? 8 - c : c; }
  function yToRow(y) { const r = Math.round((y - PADDING) / CELL); return state.flipped ? 9 - r : r; }

  // In 2-player mode (PvP), players face each other across the board.
  // The side situated at the top of the board faces the top player (rotate 180 deg).
  function shouldRotatePiece(piece) {
    if (state.mode !== 'pvp') return false;
    const isRed = XIANGQI.isRed(piece);
    // When not flipped, top side is Black; when flipped, top side is Red.
    return state.flipped ? isRed : !isRed;
  }

  // ===== DRAW BOARD =====
  function drawBoard() {
    const W = CANVAS_W, H = CANVAS_H;
    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#8B4513');
    bgGrad.addColorStop(0.5, '#A0522D');
    bgGrad.addColorStop(1, '#6B3410');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle wood grain
    ctx.save();
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * (H / 15));
      ctx.bezierCurveTo(W * 0.3, i * (H/15) + 5, W * 0.7, i*(H/15)-5, W, i*(H/15));
      ctx.strokeStyle = 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    ctx.restore();

    // Board border
    ctx.strokeStyle = '#3a1500';
    ctx.lineWidth = 3;
    ctx.strokeRect(PADDING - 4, PADDING - 4, BOARD_W + 8, BOARD_H + 8);
    ctx.strokeStyle = '#c8860a';
    ctx.lineWidth = 1;
    ctx.strokeRect(PADDING - 6, PADDING - 6, BOARD_W + 12, BOARD_H + 12);

    // Draw grid lines
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;

    // Horizontal lines
    for (let r = 0; r <= 9; r++) {
      const y = PADDING + r * CELL;
      ctx.beginPath();
      ctx.moveTo(PADDING, y);
      ctx.lineTo(PADDING + 8 * CELL, y);
      ctx.stroke();
    }

    // Vertical lines - split at river
    for (let c = 0; c <= 8; c++) {
      const x = PADDING + c * CELL;
      // Top half (black side, rows 0-4)
      ctx.beginPath();
      ctx.moveTo(x, PADDING);
      ctx.lineTo(x, PADDING + 4 * CELL);
      ctx.stroke();
      // Bottom half (red side, rows 5-9)
      ctx.beginPath();
      ctx.moveTo(x, PADDING + 5 * CELL);
      ctx.lineTo(x, PADDING + 9 * CELL);
      ctx.stroke();
    }

    // River text. Latin text must always read left to right, so it does not swap when the board is flipped.
    ctx.save();
    ctx.font = 'bold 19px "Outfit", sans-serif';
    ctx.fillStyle = COLORS.riverText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = PADDING + 4.5 * CELL;
    ctx.fillText(RIVER_TEXT.left, PADDING + 2 * CELL, riverY);
    ctx.fillText(RIVER_TEXT.right, PADDING + 6 * CELL, riverY);
    ctx.restore();

    // Palace diagonal lines
    drawPalace(3, 7, 5, 9);  // Red palace
    drawPalace(3, 0, 5, 2);  // Black palace

    // Column coordinates (1-9 from right to left for each player)
    ctx.save();
    ctx.font = 'bold 13px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(240, 215, 175, 0.75)';

    for (let c = 0; c < 9; c++) {
      const x = colToX(c);
      // Bottom coordinates (Red by default: 9 to 1 from left to right)
      const bottomNum = state.flipped ? (c + 1) : (9 - c);
      ctx.fillText(bottomNum, x, PADDING + 9 * CELL + 22);

      // Top coordinates (Black by default: 1 to 9 from left to right)
      // In PvP mode, rotate top numbers 180 degrees to face the opponent sitting opposite
      const topNum = state.flipped ? (9 - c) : (c + 1);
      if (state.mode === 'pvp') {
        ctx.save();
        ctx.translate(x, PADDING - 22);
        ctx.rotate(Math.PI);
        ctx.fillText(topNum, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(topNum, x, PADDING - 22);
      }
    }
    ctx.restore();
  }

  function drawPalace(c1, r1, c2, r2) {
    const x1 = PADDING + (state.flipped ? 8-c1 : c1) * CELL;
    const y1 = PADDING + (state.flipped ? 9-r1 : r1) * CELL;
    const x2 = PADDING + (state.flipped ? 8-c2 : c2) * CELL;
    const y2 = PADDING + (state.flipped ? 9-r2 : r2) * CELL;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.moveTo(x2, y1); ctx.lineTo(x1, y2);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ===== CANDIDATE-LINE ARROWS (drawn above the pieces so they are never hidden) =====
  const activeVariationIndex = () => state.activeVariationIdx || 0;
  const variationMoves = (v) => (v.pv && v.pv.length ? v.pv : [v.firstMove, v.counterMove]).filter(Boolean);

  // Colour = which variation, solid = your move, dashed = the opponent's reply, number = order in the chain.
  function drawArrows() {
    if (state.analysisVariations && state.analysisVariations.length > 0) {
      const active = activeVariationIndex();
      const drawOrder = state.analysisVariations.map((_, i) => i).sort((a, b) => (a === active) - (b === active)); // active on top

      for (const idx of drawOrder) {
        const conf = VARIATION_COLORS[idx] || VARIATION_COLORS[VARIATION_COLORS.length - 1];
        const isActive = idx === active;
        XIANGQI.pvToSegments(state.board, variationMoves(state.analysisVariations[idx]), MAX_CHAIN_PLIES).forEach((seg) => {
          drawArrow(seg.fromRow, seg.fromCol, seg.toRow, seg.toCol, conf.color, {
            lineWidth: (isActive ? 5.5 : 3.5) * (seg.mine ? 1 : 0.8),
            badgeText: String(seg.ply),
            glow: isActive && seg.mine ? conf.glow : null,
            isDashed: !seg.mine,
            dashArray: [7, 5],
            alpha: isActive ? 1.0 : 0.3,
          });
        });
      }
    } else if (state.hintMove && XIANGQI.parseUCI(state.hintMove)) {
      const m = XIANGQI.parseUCI(state.hintMove);
      drawArrow(m.fromRow, m.fromCol, m.toRow, m.toCol, 'rgba(0,210,200,0.7)');
    }
  }

  // ===== MOVE-QUALITY BADGE (on the piece that has just moved) =====
  // state.moveBadge = { row, col, quality: { symbol, color } }, set by the game once the move is evaluated
  function drawMoveBadge() {
    const badge = state.moveBadge;
    if (!badge || !badge.quality || !state.board[badge.row] || !state.board[badge.row][badge.col]) return;

    const BADGE_R = CELL * 0.2;
    const pt = Geometry.badgePoint(colToX(badge.col), rowToY(badge.row), CELL * 0.48, BADGE_R, canvas.width, canvas.height);

    const piece = state.board[badge.row] && state.board[badge.row][badge.col];
    const rotate180 = piece && shouldRotatePiece(piece);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, BADGE_R, 0, Math.PI * 2);
    ctx.fillStyle = badge.quality.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    const long = badge.quality.symbol.length > 1;
    ctx.font = `800 ${long ? 12 : 15}px "Outfit", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.translate(pt.x, pt.y + 1);
    if (rotate180) {
      ctx.rotate(Math.PI);
    }
    ctx.fillText(badge.quality.symbol, 0, 0);
    ctx.restore();
  }

  // ===== DRAW HIGHLIGHTS =====
  function drawHighlights() {
    // Last move highlight
    if (state.lastMove) {
      const { fromRow, fromCol, toRow, toCol } = state.lastMove;
      highlightCell(fromRow, fromCol, COLORS.lastMoveFrom);
      highlightCell(toRow, toCol, COLORS.lastMoveTo);
    }

    // Candidate lines: highlight where the active line starts (its arrows are drawn above the pieces)
    if (state.analysisVariations && state.analysisVariations.length > 0) {
      const active = activeVariationIndex();
      const first = XIANGQI.pvToSegments(state.board, variationMoves(state.analysisVariations[active]), 1)[0];
      if (first) highlightCell(first.fromRow, first.fromCol, 'rgba(255, 215, 0, 0.25)');
    } else if (state.hintMove && XIANGQI.parseUCI(state.hintMove)) {
      const m = XIANGQI.parseUCI(state.hintMove);
      highlightCell(m.fromRow, m.fromCol, COLORS.hintFrom);
      highlightCell(m.toRow, m.toCol, COLORS.hintTo);
    }

    // Selected piece
    if (state.selected) {
      highlightCell(state.selected.row, state.selected.col, COLORS.selectedBg, COLORS.selectedBorder);
    }

    // Legal move dots — empty squares only (drawn before pieces so pieces render on top)
    if (state.legalMoves.length > 0 && state.selected) {
      for (const [r, c] of state.legalMoves) {
        const isCapture = !!(state.board && state.board[r] && state.board[r][c]);
        if (isCapture) continue; // capture rings drawn after pieces in drawCaptureDots()
        let isDanger = false;
        if (state.board) {
          try {
            isDanger = isSquareUnderAttack(state.board, state.selected.row, state.selected.col, r, c);
          } catch (e) {
            console.error('isSquareUnderAttack error:', e);
            isDanger = false;
          }
        }
        drawLegalDot(r, c, false, isDanger);
      }
    }
  }

  // Capture-target rings drawn AFTER pieces so the coloured ring is visible on top of enemy pieces
  function drawCaptureDots() {
    if (state.legalMoves.length === 0 || !state.selected) return;
    for (const [r, c] of state.legalMoves) {
      const isCapture = !!(state.board && state.board[r] && state.board[r][c]);
      if (!isCapture) continue;
      let isDanger = false;
      if (state.board) {
        try {
          isDanger = isSquareUnderAttack(state.board, state.selected.row, state.selected.col, r, c);
        } catch (e) {
          console.error('isSquareUnderAttack error:', e);
          isDanger = false;
        }
      }
      drawLegalDot(r, c, true, isDanger);
    }
  }

  // Check if moving to [tr, tc] leaves the piece vulnerable to being captured by the enemy on the next move
  function isSquareUnderAttack(board, fr, fc, tr, tc) {
    if (!board || !board[fr] || !board[fr][fc]) return false;
    const piece = board[fr][fc];
    if (!piece) return false;
    const myColor = XIANGQI.pieceColor(piece);
    if (!myColor) return false;
    const enemyColor = myColor === 'red' ? 'black' : 'red';

    const newBoard = XIANGQI.applyMove(board, fr, fc, tr, tc);
    if (!newBoard) return false;
    const enemyMoves = XIANGQI.getLegalMoves(newBoard, enemyColor);
    if (!Array.isArray(enemyMoves)) return false;
    return enemyMoves.some(m => m.toRow === tr && m.toCol === tc);
  }

  function highlightCell(row, col, fillColor, borderColor) {
    const x = colToX(col);
    const y = rowToY(row);
    const R = CELL * 0.48;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (borderColor) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  function drawLegalDot(row, col, isCapture, isDanger = false) {
    const x = colToX(col);
    const y = rowToY(row);

    const color = isDanger ? '#ef4444' : '#22c55e'; // Red: nguy cơ bị ăn | Green: an toàn
    const glow = isDanger ? 'rgba(239, 68, 68, 0.85)' : 'rgba(34, 197, 94, 0.85)';

    ctx.save();
    if (isCapture) {
      // Outer glow ring
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.46, 0, Math.PI * 2);
      ctx.strokeStyle = color + '55';
      ctx.lineWidth = 5;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 14;
      ctx.stroke();
      // Main ring for capture
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.5;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
      ctx.stroke();
    } else {
      // Dot for empty square
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
      ctx.fill();

      // Subtle outer ring
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.strokeStyle = isDanger ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawArrow(r1, c1, r2, c2, color, opts = {}) {
    const { isDashed = false, dashArray = [8, 5], badgeText = '', lineWidth = 4, glow = null, alpha = 1.0 } = opts;
    const HEAD = 12;
    // The tip lands exactly on the centre of the destination intersection; the tail leaves from the
    // edge of the moving piece (piece radius = CELL * 0.48, see drawPiece).
    const pts = Geometry.arrowPoints(colToX(c1), rowToY(r1), colToX(c2), rowToY(r2), { startGap: CELL * 0.48, headLength: HEAD });
    if (!pts) return;
    const { start, tip, shaftEnd, mid, angle } = pts;
    const sx = start.x, sy = start.y, ex = tip.x, ey = tip.y;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 10;
    }

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    if (isDashed) {
      ctx.setLineDash(dashArray);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(shaftEnd.x, shaftEnd.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // Arrowhead
    const hw = HEAD;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hw * Math.cos(angle - 0.45), ey - hw * Math.sin(angle - 0.45));
    ctx.lineTo(ex - hw * Math.cos(angle + 0.45), ey - hw * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();

    // Badge circle at midpoint
    if (badgeText) {
      const mx = mid.x;
      const my = mid.y;

      ctx.beginPath();
      ctx.arc(mx, my, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#1e1e2f';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 11px "Outfit", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, mx, my);
    }

    ctx.restore();
  }

  // ===== DRAW PIECES =====
  function drawPieces(boardOverride) {
    const board = boardOverride || state.board;
    if (!board) return;

    // Draw non-selected pieces first
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = board[r][c];
        if (!piece) continue;

        // Skip animating piece
        if (state.animPiece && state.animPiece.skipSrc &&
          r === state.animPiece.fromRow && c === state.animPiece.fromCol) continue;

        // Draw selected piece later on top
        if (state.selected && state.selected.row === r && state.selected.col === c) continue;

        drawPiece(piece, colToX(c), rowToY(r), 1, 1, false);
      }
    }

    // Draw selected piece on top with glowing border halo
    if (state.selected && board[state.selected.row]) {
      const sp = board[state.selected.row][state.selected.col];
      if (sp) {
        drawPiece(sp, colToX(state.selected.col), rowToY(state.selected.row), 1, 1.05, true);
      }
    }
  }

  function drawPiece(piece, x, y, alpha = 1, scale = 1, isSelected = false, rotate180 = undefined) {
    const R = CELL * 0.43 * scale;
    const isRed = XIANGQI.isRed(piece);
    const info = XIANGQI.PIECES[piece];
    if (!info) return;

    if (rotate180 === undefined) {
      rotate180 = shouldRotatePiece(piece);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rotate180) {
      ctx.rotate(Math.PI);
    }

    // Glowing outer halo for selected piece
    if (isSelected) {
      // 1. Soft wide ambient glow
      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(0, 0, R + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
      ctx.fill();
      ctx.restore();

      // 2. Bright neon golden ring
      ctx.save();
      ctx.shadowColor = '#ffae00';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ffe270';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, R + 2.5, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Crisp inner highlight ring
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(0, 0, R + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Outer shadow (elevated if selected)
    ctx.shadowColor = isSelected ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = isSelected ? 12 : 8;
    ctx.shadowOffsetY = isSelected ? 5 : 3;

    // Piece background (gradient)
    const grad = ctx.createRadialGradient(-R*0.3, -R*0.3, 0, 0, 0, R);
    if (isRed) {
      grad.addColorStop(0, isSelected ? '#ff9999' : '#ff7f7f');
      grad.addColorStop(0.4, isSelected ? '#ef5350' : '#e84c4c');
      grad.addColorStop(1, '#8a1515');
    } else {
      grad.addColorStop(0, isSelected ? '#7e7eae' : '#6a6a9a');
      grad.addColorStop(0.4, isSelected ? '#46467c' : '#3a3a6a');
      grad.addColorStop(1, '#0a0a1e');
    }

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent';

    // Piece border
    if (isSelected) {
      ctx.strokeStyle = '#fff275';
      ctx.lineWidth = 2.8;
    } else {
      ctx.strokeStyle = isRed ? '#f5c842' : '#6a6a9a';
      ctx.lineWidth = 2;
    }
    ctx.stroke();

    // Inner ring
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected
      ? 'rgba(255, 245, 170, 0.9)'
      : (isRed ? 'rgba(245,200,66,0.5)' : 'rgba(100,100,170,0.4)');
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.stroke();

    // Character
    ctx.font = `bold ${Math.round(R * 0.95)}px "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isSelected) {
      ctx.shadowColor = isRed ? 'rgba(255,215,0,0.85)' : 'rgba(220,220,255,0.85)';
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = isRed ? '#ffd700' : '#c8c8e8';
    ctx.fillText(info.char, 0, 0);

    ctx.restore();
  }

  // ===== FULL RENDER =====
  function render(boardOverride) {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBoard();
    drawHighlights();
    drawPieces(boardOverride);
    drawCaptureDots();   // capture rings drawn on top of enemy pieces
    drawArrows();
    drawMoveBadge();
  }

  // ===== ANIMATION =====
  function animateMove(board, fromRow, fromCol, toRow, toCol, onComplete) {
    const piece = board[fromRow][fromCol];
    const x1 = colToX(fromCol), y1 = rowToY(fromRow);
    const x2 = colToX(toCol), y2 = rowToY(toRow);
    const duration = 220;
    const start = performance.now();

    // Board without the moving piece at source
    state.animPiece = { fromRow, fromCol, skipSrc: true };

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; // ease in-out quad

      const x = x1 + (x2 - x1) * eased;
      const y = y1 + (y2 - y1) * eased;

      render(board);
      drawPiece(piece, x, y, 1, 1 + 0.08 * Math.sin(Math.PI * t)); // slight scale pulse

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        state.animPiece = null;
        if (onComplete) onComplete();
      }
    }
    requestAnimationFrame(frame);
  }

  // ===== EVALUATION BAR =====
  // Horizontal bar only: score in centipawns from Red's point of view (null = nothing analysed)
  function setEvalBar(score) {
    const split = Geometry.evalBarSplit(score);
    const bar = document.getElementById('eval-hbar');
    const black = document.getElementById('eval-hbar-black');
    const red = document.getElementById('eval-hbar-red');
    const scoreEl = document.getElementById('eval-hbar-score');
    if (black) black.style.width = `${split.blackPct}%`;
    if (red) red.style.width = `${split.redPct}%`;
    if (scoreEl) scoreEl.textContent = split.label;
    if (bar) {
      bar.dataset.side = split.side;
      bar.setAttribute('aria-label', `Đánh giá thế cờ: ${{ red: 'Đỏ hơn', black: 'Đen hơn', even: 'cân bằng' }[split.side]} (${split.label})`);
    }
  }

  // Bar + a new point on the history chart (use setEvalBar alone when only re-displaying, e.g. browsing)
  function updateEvalBar(score) {
    setEvalBar(score);
    state.evalHistory.push(score);
    drawEvalChart();
  }

  function drawEvalChart() {
    const chartCanvas = document.getElementById('eval-chart');
    if (!chartCanvas) return;
    const cctx = chartCanvas.getContext('2d');
    const W = chartCanvas.width, H = chartCanvas.height;
    cctx.clearRect(0, 0, W, H);

    // Background
    cctx.fillStyle = 'rgba(0,0,0,0.2)';
    cctx.fillRect(0, 0, W, H);

    // Zero line
    cctx.strokeStyle = 'rgba(255,255,255,0.1)';
    cctx.lineWidth = 1;
    cctx.beginPath();
    cctx.moveTo(0, H/2); cctx.lineTo(W, H/2);
    cctx.stroke();

    if (state.evalHistory.length < 2) return;

    const hist = state.evalHistory;
    const step = W / Math.max(hist.length - 1, 1);

    // Fill area
    cctx.beginPath();
    cctx.moveTo(0, H/2);
    for (let i = 0; i < hist.length; i++) {
      const x = i * step;
      const y = H/2 - (Math.max(-1000, Math.min(1000, hist[i])) / 1000) * (H/2 * 0.9);
      cctx.lineTo(x, y);
    }
    cctx.lineTo((hist.length-1)*step, H/2);
    cctx.closePath();

    const chartGrad = cctx.createLinearGradient(0, 0, 0, H);
    chartGrad.addColorStop(0, 'rgba(232,76,76,0.4)');
    chartGrad.addColorStop(0.5, 'rgba(232,76,76,0.05)');
    chartGrad.addColorStop(1, 'rgba(59,130,246,0.1)');
    cctx.fillStyle = chartGrad;
    cctx.fill();

    // Line
    cctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = i * step;
      const y = H/2 - (Math.max(-1000, Math.min(1000, hist[i])) / 1000) * (H/2 * 0.9);
      i === 0 ? cctx.moveTo(x, y) : cctx.lineTo(x, y);
    }
    cctx.strokeStyle = '#e84c4c';
    cctx.lineWidth = 2;
    cctx.stroke();
  }

  // ===== MOVE QUALITY DISPLAY =====
  function showMoveQuality(quality, evalDelta, bestMoveUCI) {
    const qualityContainer = document.getElementById('last-move-quality');
    const analysisDetail = document.getElementById('analysis-detail');
    const bestMoveSug = document.getElementById('best-move-suggestion');

    if (!qualityContainer) return;

    qualityContainer.innerHTML = `
      <div class="quality-badge quality-${quality.key}">
        <span>${quality.emoji}</span>
        <span>${quality.label}</span>
      </div>
    `;

    // Eval delta
    const deltaSign = evalDelta >= 0 ? '+' : '';
    const deltaClass = evalDelta < -20 ? 'negative' : evalDelta > 20 ? 'positive' : 'neutral';
    const deltaDisplay = Math.abs(evalDelta) > 9000 ? 'Mất quân lớn' : `${deltaSign}${(evalDelta/100).toFixed(2)}`;

    if (analysisDetail) {
      analysisDetail.innerHTML = `
        <span class="eval-delta ${deltaClass}">${deltaDisplay}</span>
        <p>${getQualityDescription(quality)}</p>
      `;
    }

    // Best move suggestion
    if (bestMoveSug && bestMoveUCI && quality.key !== 'brilliant' && quality.key !== 'great') {
      const vnMove = (typeof XIANGQI !== 'undefined' && state.board)
        ? XIANGQI.uciToVietnamese(state.board, bestMoveUCI)
        : '';
      const displayMove = vnMove ? `${vnMove} (${bestMoveUCI})` : bestMoveUCI;
      bestMoveSug.innerHTML = `💡 Nước tốt nhất: <strong>${displayMove}</strong>`;
      bestMoveSug.style.display = 'block';
    } else if (bestMoveSug) {
      bestMoveSug.innerHTML = '';
    }
  }

  function getQualityDescription(quality) {
    const descriptions = {
      brilliant: 'Nước đi tuyệt vời, vượt trội hơn cả AI!',
      great: 'Nước đi rất tốt, chính xác và hiệu quả.',
      good: 'Nước đi tốt, không mất lợi thế.',
      ok: 'Nước đi chấp nhận được, nhưng có thể tốt hơn.',
      inaccuracy: 'Thiếu chính xác, bỏ lỡ cơ hội tốt hơn.',
      mistake: 'Sai lầm đáng tiếc! Làm yếu thế cờ của bạn.',
      blunder: 'Sai lầm nghiêm trọng! Mất lợi thế lớn.'
    };
    return descriptions[quality.key] || '';
  }

  // ===== MOVE HISTORY =====
  function updateMoveHistory(moveHistory, currentMoveIdx) {
    const moveList = document.getElementById('move-list');
    if (!moveList) return;

    moveList.innerHTML = '';
    const pairs = Math.ceil(moveHistory.length / 2);

    for (let i = 0; i < pairs; i++) {
      const num = document.createElement('div');
      num.className = 'move-num';
      num.textContent = i + 1;
      moveList.appendChild(num);

      // Red move
      const redMove = moveHistory[i * 2];
      if (redMove) {
        const cell = document.createElement('div');
        cell.className = `move-cell ${i*2 === currentMoveIdx ? 'active' : ''}`;
        if (redMove.quality) cell.classList.add(`quality-${redMove.quality.key}-dot`);
        const moveText = redMove.vn || redMove.chinese || redMove.uci;
        cell.textContent = moveText;
        cell.title = `${moveText} (${redMove.uci})`;
        cell.onclick = () => window.game.goToMove(i * 2 + 1);
        moveList.appendChild(cell);
      } else {
        moveList.appendChild(document.createElement('div'));
      }

      // Black move
      const blackMove = moveHistory[i * 2 + 1];
      if (blackMove) {
        const cell = document.createElement('div');
        cell.className = `move-cell ${i*2+1 === currentMoveIdx ? 'active' : ''}`;
        if (blackMove.quality) cell.classList.add(`quality-${blackMove.quality.key}-dot`);
        const moveText = blackMove.vn || blackMove.chinese || blackMove.uci;
        cell.textContent = moveText;
        cell.title = `${moveText} (${blackMove.uci})`;
        cell.onclick = () => window.game.goToMove(i * 2 + 2);
        moveList.appendChild(cell);
      } else {
        moveList.appendChild(document.createElement('div'));
      }
    }

    // Scroll to current move inside moveList without scrolling window/page
    const activeCell = moveList.querySelector('.active');
    if (activeCell && moveList.clientHeight > 0) {
      const containerRect = moveList.getBoundingClientRect();
      const cellRect = activeCell.getBoundingClientRect();
      if (cellRect.bottom > containerRect.bottom) {
        moveList.scrollTop += (cellRect.bottom - containerRect.bottom + 4);
      } else if (cellRect.top < containerRect.top) {
        moveList.scrollTop -= (containerRect.top - cellRect.top + 4);
      }
    }
  }

  // ===== TURN INDICATOR =====
  function updateTurnIndicator(turn, isInCheck) {
    const indicator = document.getElementById('status-turn');
    const dot = indicator ? indicator.querySelector('.turn-indicator') : null;
    const turnText = document.getElementById('turn-text');
    const statusMsg = document.getElementById('status-message');
    const checkBadge = document.getElementById('check-badge');

    if (dot) {
      dot.className = `turn-indicator ${turn}-indicator`;
    }
    if (turnText) {
      turnText.textContent = turn === 'red' ? 'Lượt Đỏ' : 'Lượt Đen';
    }
    if (checkBadge) {
      checkBadge.classList.toggle('hidden', !isInCheck);
    }

    // Highlight active player card
    document.querySelector('.red-card')?.classList.toggle('active-turn', turn === 'red');
    document.querySelector('.black-card')?.classList.toggle('active-turn', turn === 'black');
  }

  // ===== TOAST =====
  let toastTimeout;
  function showToast(message, type = '', duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.className = 'toast hidden';
    }, duration);
  }

  // ===== CLICK & TOUCH HANDLER =====
  function getClickPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;

    // Support touch and mouse
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const col = xToCol(x);
    const row = yToRow(y);
    if (col < 0 || col > 8 || row < 0 || row > 9) return null;
    return { row, col };
  }

  return {
    state,
    canvas,
    render,
    animateMove,
    drawPiece,
    colToX, rowToY,
    updateEvalBar,
    setEvalBar,
    showMoveQuality,
    updateMoveHistory,
    updateTurnIndicator,
    showToast,
    getClickPos,
    getQualityDescription,
    isSquareUnderAttack,
    setAnalysisVariations: (vars, activeIdx = 0) => {
      state.analysisVariations = vars;
      state.activeVariationIdx = activeIdx;
      render();
    },
    clearAnalysisVariations: () => {
      state.analysisVariations = null;
      render();
    }
  };
})();
