/**
 * xiangqi.js - Core Xiangqi (Chinese Chess) Game Logic
 * Handles board state, move generation, validation, and FEN parsing
 */

const XIANGQI = (() => {

  // Piece types (uppercase = Red, lowercase = Black)
  // K/k = King (将/帅), A/a = Advisor (士), B/b = Bishop/Elephant (象),
  // R/r = Rook (车), N/n = Knight (马), C/c = Cannon (炮), P/p = Pawn (兵/卒)
  const PIECES = {
    K: { char: '帅', vnCode: 'Tg', vnName: 'Tướng', color: 'red' },
    A: { char: '仕', vnCode: 'S', vnName: 'Sĩ', color: 'red' },
    B: { char: '相', vnCode: 'T', vnName: 'Tượng', color: 'red' },
    R: { char: '车', vnCode: 'X', vnName: 'Xe', color: 'red' },
    N: { char: '马', vnCode: 'M', vnName: 'Mã', color: 'red' },
    C: { char: '炮', vnCode: 'P', vnName: 'Pháo', color: 'red' },
    P: { char: '兵', vnCode: 'B', vnName: 'Binh', color: 'red' },
    k: { char: '将', vnCode: 'Tg', vnName: 'Tướng', color: 'black' },
    a: { char: '士', vnCode: 'S', vnName: 'Sĩ', color: 'black' },
    b: { char: '象', vnCode: 'T', vnName: 'Tượng', color: 'black' },
    r: { char: '车', vnCode: 'X', vnName: 'Xe', color: 'black' },
    n: { char: '马', vnCode: 'M', vnName: 'Mã', color: 'black' },
    c: { char: '炮', vnCode: 'P', vnName: 'Pháo', color: 'black' },
    p: { char: '卒', vnCode: 'B', vnName: 'Binh', color: 'black' },
  };

  const DEFAULT_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

  // Board is 9 columns x 10 rows
  // Position: row 0 = black's back row, row 9 = red's back row

  function createEmptyBoard() {
    return Array.from({ length: 10 }, () => Array(9).fill(null));
  }

  function parseFEN(fen) {
    if (typeof fen !== 'string') throw new Error('FEN không hợp lệ');
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 10) throw new Error('FEN phải có 10 hàng');
    const board = createEmptyBoard();
    const counts = {};
    for (let r = 0; r < 10; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (/[1-9]/.test(ch)) { col += parseInt(ch); }
        else if (PIECES[ch]) {
          if (col > 8) throw new Error(`Hàng ${r + 1} quá 9 cột`);
          board[r][col] = ch; col++;
          counts[ch] = (counts[ch] || 0) + 1;
        } else throw new Error(`Ký tự không hợp lệ: ${ch}`);
      }
      if (col !== 9) throw new Error(`Hàng ${r + 1} phải đủ 9 cột`);
    }
    if (counts.K !== 1 || counts.k !== 1) throw new Error('Mỗi bên phải có đúng một Tướng');
    const turn = parts[1] === 'b' ? 'black' : 'red';
    const moveNum = parseInt(parts[5] || '1') || 1;
    const result = { board, turn, moveNum };
    // Tướng hai bên không được đối mặt, và bên không đi không được đang bị chiếu
    if (isInCheck(board, turn === 'red' ? 'black' : 'red')) throw new Error('Thế cờ không hợp lệ (bên không đi đang bị chiếu)');
    return result;
  }

  function boardToFEN(board, turn, moveNum = 1) {
    let rows = [];
    for (let r = 0; r < 10; r++) {
      let row = ''; let empty = 0;
      for (let c = 0; c < 9; c++) {
        if (board[r][c]) {
          if (empty > 0) { row += empty; empty = 0; }
          row += board[r][c];
        } else { empty++; }
      }
      if (empty > 0) row += empty;
      rows.push(row);
    }
    const t = turn === 'black' ? 'b' : 'w';
    return `${rows.join('/')} ${t} - - 0 ${moveNum}`;
  }

  function pieceColor(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'red' : 'black';
  }

  function isRed(piece) { return piece && piece === piece.toUpperCase(); }
  function isBlack(piece) { return piece && piece === piece.toLowerCase(); }
  function sameColor(a, b) {
    if (!a || !b) return false;
    return isRed(a) === isRed(b);
  }

  // Generate all pseudo-legal moves for a piece
  function movesForPiece(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const color = pieceColor(piece);
    const type = piece.toLowerCase();
    const moves = [];

    function addMove(r, c) {
      if (r < 0 || r > 9 || c < 0 || c > 8) return;
      if (sameColor(piece, board[r][c])) return;
      moves.push([r, c]);
    }

    switch (type) {
      case 'k': { // King
        const palace = color === 'red' ? [7, 9] : [0, 2];
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
        for (const [dr, dc] of dirs) {
          const nr = row + dr, nc = col + dc;
          if (nr >= palace[0] && nr <= palace[1] && nc >= 3 && nc <= 5) addMove(nr, nc);
        }
        break;
      }
      case 'a': { // Advisor
        const palace = color === 'red' ? [7, 9] : [0, 2];
        const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
        for (const [dr, dc] of dirs) {
          const nr = row + dr, nc = col + dc;
          if (nr >= palace[0] && nr <= palace[1] && nc >= 3 && nc <= 5) addMove(nr, nc);
        }
        break;
      }
      case 'b': { // Bishop/Elephant - cannot cross river
        const dirs = [[2,2],[2,-2],[-2,2],[-2,-2]];
        for (const [dr, dc] of dirs) {
          const nr = row + dr, nc = col + dc;
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          if (color === 'red' && nr < 5) continue;
          if (color === 'black' && nr > 4) continue;
          // Check for blocking piece at the diagonal midpoint
          const br = row + dr/2, bc = col + dc/2;
          if (!board[br][bc]) addMove(nr, nc);
        }
        break;
      }
      case 'r': { // Rook
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
        for (const [dr, dc] of dirs) {
          let nr = row + dr, nc = col + dc;
          while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
            if (board[nr][nc]) {
              if (!sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
              break;
            }
            moves.push([nr, nc]);
            nr += dr; nc += dc;
          }
        }
        break;
      }
      case 'n': { // Knight
        const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of knightMoves) {
          const nr = row + dr, nc = col + dc;
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          // Check for blocking: the leg
          const lr = dr === 0 ? row : row + Math.sign(dr);
          const lc = dc === 0 ? col : col + Math.sign(dc);
          // Determine which step is blocked
          let blockRow, blockCol;
          if (Math.abs(dr) === 2) { blockRow = row + Math.sign(dr); blockCol = col; }
          else { blockRow = row; blockCol = col + Math.sign(dc); }
          if (!board[blockRow][blockCol]) addMove(nr, nc);
        }
        break;
      }
      case 'c': { // Cannon
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
        for (const [dr, dc] of dirs) {
          let nr = row + dr, nc = col + dc;
          let platform = false;
          while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
            if (!platform) {
              if (!board[nr][nc]) { moves.push([nr, nc]); }
              else { platform = true; }
            } else {
              if (board[nr][nc]) {
                if (!sameColor(piece, board[nr][nc])) moves.push([nr, nc]);
                break;
              }
            }
            nr += dr; nc += dc;
          }
        }
        break;
      }
      case 'p': { // Pawn
        if (color === 'red') {
          // Red moves up (decreasing row)
          if (row > 0 && !sameColor(piece, board[row-1][col])) moves.push([row-1, col]);
          if (row < 5) { // Crossed river
            if (col > 0 && !sameColor(piece, board[row][col-1])) moves.push([row, col-1]);
            if (col < 8 && !sameColor(piece, board[row][col+1])) moves.push([row, col+1]);
          }
        } else {
          // Black moves down (increasing row)
          if (row < 9 && !sameColor(piece, board[row+1][col])) moves.push([row+1, col]);
          if (row > 4) { // Crossed river
            if (col > 0 && !sameColor(piece, board[row][col-1])) moves.push([row, col-1]);
            if (col < 8 && !sameColor(piece, board[row][col+1])) moves.push([row, col+1]);
          }
        }
        break;
      }
    }
    return moves;
  }

  // Check if a king is in check (attack-based lookup from the king's square)
  function isInCheck(board, color) {
    const kingChar = color === 'red' ? 'K' : 'k';
    const oppKing = color === 'red' ? 'k' : 'K';
    const enemyRook = color === 'red' ? 'r' : 'R';
    const enemyCannon = color === 'red' ? 'c' : 'C';
    const enemyKnight = color === 'red' ? 'n' : 'N';
    const enemyPawn = color === 'red' ? 'p' : 'P';

    let kr = -1, kc = -1;
    for (let r = 0; r < 10 && kr < 0; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === kingChar) { kr = r; kc = c; break; }
      }
    }
    if (kr < 0) return false;

    // Orthogonal rays: rook / flying general (first piece), cannon (second piece)
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    for (const [dr, dc] of dirs) {
      let r = kr + dr, c = kc + dc;
      let seen = 0;
      while (r >= 0 && r <= 9 && c >= 0 && c <= 8) {
        const p = board[r][c];
        if (p) {
          seen++;
          if (seen === 1 && (p === enemyRook || (p === oppKing && dc === 0))) return true;
          if (seen === 2) { if (p === enemyCannon) return true; break; }
        }
        r += dr; c += dc;
      }
    }

    // Knights: enemy knight at (kr+dr, kc+dc) jumping onto the king; its leg is next to it
    const knightOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of knightOffsets) {
      const nr = kr + dr, nc = kc + dc;
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8 || board[nr][nc] !== enemyKnight) continue;
      const legR = Math.abs(dr) === 2 ? nr - Math.sign(dr) : nr;
      const legC = Math.abs(dr) === 2 ? nc : nc - Math.sign(dc);
      if (!board[legR][legC]) return true;
    }

    // Pawns: forward attack, plus sideways attack once across the river
    const fd = color === 'red' ? 1 : -1; // enemy pawn forward direction (rows)
    const pr = kr - fd;
    if (pr >= 0 && pr <= 9 && board[pr][kc] === enemyPawn) return true;
    for (const dc of [-1, 1]) {
      const c = kc + dc;
      if (c < 0 || c > 8 || board[kr][c] !== enemyPawn) continue;
      const crossed = color === 'red' ? kr > 4 : kr < 5;
      if (crossed) return true;
    }

    return false;
  }

  // Apply a move and return new board (immutable)
  function applyMove(board, fromRow, fromCol, toRow, toCol) {
    const newBoard = board.map(r => [...r]);
    newBoard[toRow][toCol] = newBoard[fromRow][fromCol];
    newBoard[fromRow][fromCol] = null;
    return newBoard;
  }

  // Does this pseudo-move leave `color`'s king safe? (make/unmake in place)
  function isSafeMove(board, fr, fc, tr, tc, color) {
    const piece = board[fr][fc];
    const captured = board[tr][tc];
    board[tr][tc] = piece;
    board[fr][fc] = null;
    const safe = !isInCheck(board, color);
    board[fr][fc] = piece;
    board[tr][tc] = captured;
    return safe;
  }

  // Get all legal moves for a color
  function getLegalMoves(board, color) {
    const moves = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] && pieceColor(board[r][c]) === color) {
          for (const [tr, tc] of movesForPiece(board, r, c)) {
            if (isSafeMove(board, r, c, tr, tc, color)) {
              moves.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc });
            }
          }
        }
      }
    }
    return moves;
  }

  // Get legal moves for a specific piece
  function getLegalMovesForPiece(board, row, col, color) {
    return movesForPiece(board, row, col)
      .filter(([tr, tc]) => isSafeMove(board, row, col, tr, tc, color));
  }

  function isLegalMove(board, fr, fc, tr, tc, color) {
    const piece = board[fr] && board[fr][fc];
    if (!piece || pieceColor(piece) !== color) return false;
    return getLegalMovesForPiece(board, fr, fc, color).some(([r, c]) => r === tr && c === tc);
  }

  // Convert move to UCI notation (e.g., "h3e3")
  function moveToUCI(fromRow, fromCol, toRow, toCol) {
    const files = 'abcdefghi';
    return `${files[fromCol]}${10 - fromRow}${files[toCol]}${10 - toRow}`;
  }

  // Parse UCI notation with ranks 1-10 (rank 1 = Red's back row). Returns null if invalid.
  function parseUCI(uci) {
    const m = typeof uci === 'string' && uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
    if (!m) return null;
    const files = 'abcdefghi';
    return {
      fromCol: files.indexOf(m[1]), fromRow: 10 - parseInt(m[2]),
      toCol: files.indexOf(m[3]), toRow: 10 - parseInt(m[4]),
    };
  }

  /**
   * Turn a principal variation (UCI moves, side to move first) into drawable segments.
   * Plays the moves on a copy of the board so each arrow starts where the piece really is.
   * Stops at the first move that cannot be parsed or has no piece to move.
   * Segment: { ply (1-based), mine (true for the side to move, false for the opponent), uci, from/to row+col }.
   */
  function pvToSegments(board, pv, maxPlies = 4) {
    const segments = [];
    let b = board;
    for (let i = 0; i < Math.min(pv.length, maxPlies); i++) {
      const m = parseUCI(pv[i]);
      if (!m || !b[m.fromRow][m.fromCol]) break;
      segments.push({ ply: i + 1, mine: i % 2 === 0, uci: pv[i], ...m });
      b = applyMove(b, m.fromRow, m.fromCol, m.toRow, m.toCol);
    }
    return segments;
  }

  // Convert move to standard Vietnamese Xiangqi notation
  // Tg = Tướng, S = Sĩ, T = Tượng, X = Xe, M = Mã, P = Pháo, B = Binh
  // Đánh số cột từ PHẢI qua TRÁI theo góc nhìn của mỗi bên (1 đến 9)
  // Ký hiệu: . = Tiến (Tấn), \ = Thoái, - = Bình
  function moveToVietnamese(board, fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    if (!piece) return '';
    const info = PIECES[piece];
    if (!info) return '';

    const color = pieceColor(piece);

    // Cột từ phải qua trái theo góc nhìn mỗi bên:
    // Đỏ (phía dưới): cột ngoài cùng bên phải là col 8 -> lộ 1, col 0 -> lộ 9
    // Đen (phía trên): cột ngoài cùng bên phải (theo Đen) là col 0 -> lộ 1, col 8 -> lộ 9
    const fromFile = color === 'red' ? (9 - fromCol) : (fromCol + 1);
    const toFile = color === 'red' ? (9 - toCol) : (toCol + 1);

    // Kiểm tra có 2 quân cùng loại trên cùng 1 cột hay không
    const sameColPieces = [];
    for (let r = 0; r < 10; r++) {
      if (board[r][fromCol] === piece) {
        sameColPieces.push(r);
      }
    }

    let piecePrefix = '';
    if (sameColPieces.length >= 2) {
      // Xếp từ phía trước (gần đối phương) ra sau: Đỏ row nhỏ trước, Đen row lớn trước
      const ordered = [...sameColPieces].sort((x, y) => color === 'red' ? x - y : y - x);
      const pos = ordered.indexOf(fromRow);
      const labels = ordered.length === 2 ? ['T', 'H']
        : ordered.length === 3 ? ['T', 'G', 'H']
        : ordered.map((_, i) => String(i + 1)); // 4-5 quân (chỉ có thể là Binh): đánh số từ trước ra sau
      piecePrefix = labels[pos] + info.vnCode;
    } else {
      piecePrefix = `${info.vnCode}${fromFile}`;
    }

    // Xác định hướng đi: Bình (-), Tiến (.), Thoái (\)
    let dirSymbol = '';
    let targetSuffix = '';

    const isDiagonalPiece = ['n', 'b', 'a', 'N', 'B', 'A'].includes(piece);

    if (toRow === fromRow) {
      // Đi ngang (Bình) -> luôn ghi lộ đến
      dirSymbol = '-';
      targetSuffix = String(toFile);
    } else {
      // Đi dọc hoặc chéo -> Tiến (.) hoặc Thoái (\)
      const isForward = color === 'red' ? toRow < fromRow : toRow > fromRow;
      dirSymbol = isForward ? '.' : '\\';

      if (isDiagonalPiece) {
        // Quân đi chéo (Mã, Tượng, Sĩ) -> số sau là LỘ ĐẾN
        targetSuffix = String(toFile);
      } else {
        // Quân đi thẳng (Xe, Pháo, Binh, Tướng) -> số sau là SỐ BƯỚC ĐI
        targetSuffix = String(Math.abs(toRow - fromRow));
      }
    }

    return `${piecePrefix}${dirSymbol}${targetSuffix}`;
  }

  // Natural full Vietnamese move description (e.g. "Pháo 2 bình 5", "Mã 8 tiến 7")
  function moveToVietnameseFull(board, fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow] && board[fromRow][fromCol];
    if (!piece) return '';
    const isRedPiece = pieceColor(piece) === 'red';
    // Red pawns are "Binh", black pawns are "Tốt"; every other piece uses its standard name
    const pName = piece === 'p' ? 'Tốt' : PIECES[piece].vnName;

    const fromFile = isRedPiece ? (9 - fromCol) : (fromCol + 1);
    const toFile = isRedPiece ? (9 - toCol) : (toCol + 1);
    const isDiagonal = 'nba'.includes(piece.toLowerCase());

    if (toRow === fromRow) return `${pName} ${fromFile} bình ${toFile}`;
    const isForward = isRedPiece ? toRow < fromRow : toRow > fromRow;
    const stepOrFile = isDiagonal ? toFile : Math.abs(toRow - fromRow);
    return `${pName} ${fromFile} ${isForward ? 'tiến' : 'thoái'} ${stepOrFile}`;
  }

  // Convert UCI to Vietnamese notation given a board state
  function uciToVietnamese(board, uci) {
    if (!board || !uci || uci.length < 4) return uci || '';
    const parsed = parseUCI(uci);
    if (!parsed || !board[parsed.fromRow] || !board[parsed.fromRow][parsed.fromCol]) return uci;
    return moveToVietnamese(board, parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol);
  }

  function uciToVietnameseFull(board, uci) {
    if (!board || !uci) return uci || '';
    const parsed = parseUCI(uci);
    if (!parsed || !board[parsed.fromRow] || !board[parsed.fromRow][parsed.fromCol]) return uci;
    return moveToVietnameseFull(board, parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol);
  }

  const PIECE_VALUES = {
    k: 10000, a: 120, b: 120, r: 600, n: 300, c: 300, p: 100
  };

  // Material balance in centipawns from Red's perspective
  function materialScore(board) {
    let score = 0;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        const val = PIECE_VALUES[p.toLowerCase()] || 0;
        score += pieceColor(p) === 'red' ? val : -val;
      }
    }
    return score;
  }

  // Neither side has an attacking piece (rook/knight/cannon/pawn) -> cannot checkmate
  function isInsufficientMaterial(board) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && 'rncp'.includes(p.toLowerCase())) return false;
      }
    }
    return true;
  }

  function positionKey(board, turn) {
    return boardToFEN(board, turn).split(' ').slice(0, 2).join(' ');
  }

  // Check for checkmate or stalemate
  function getGameState(board, currentTurn) {
    const legalMoves = getLegalMoves(board, currentTurn);
    if (legalMoves.length === 0) {
      if (isInCheck(board, currentTurn)) return 'checkmate';
      return 'stalemate';
    }
    return 'playing';
  }

  return {
    PIECES, DEFAULT_FEN,
    parseFEN, boardToFEN,
    pieceColor, isRed, isBlack,
    movesForPiece, getLegalMoves, getLegalMovesForPiece, isLegalMove,
    isInCheck, applyMove,
    moveToUCI, parseUCI, pvToSegments, moveToVietnamese, moveToVietnameseFull, uciToVietnamese, uciToVietnameseFull,
    PIECE_VALUES, materialScore, isInsufficientMaterial, positionKey, getGameState,
    createEmptyBoard
  };
})();
