/**
 * editor.js - Unified Board Editor & Multi-Variation Analysis
 * Integrated directly with the main chessboard for seamless play, editing, and analysis.
 */

const BoardEditor = (() => {
  // Piece count limits per side in standard Xiangqi
  const PIECE_LIMITS = {
    // Red pieces (Đỏ)
    K: 1, // Tướng 帥 (Tối đa 1)
    A: 2, // Sĩ 仕 (Tối đa 2)
    B: 2, // Tượng 相 (Tối đa 2)
    R: 2, // Xe 俥 (Tối đa 2)
    N: 2, // Mã 傌 (Tối đa 2)
    C: 2, // Pháo 炮 (Tối đa 2)
    P: 5, // Binh 兵 (Tối đa 5)
    // Black pieces (Đen)
    k: 1, // Tướng 將 (Tối đa 1)
    a: 2, // Sĩ 士 (Tối đa 2)
    b: 2, // Tượng 象 (Tối đa 2)
    r: 2, // Xe 車 (Tối đa 2)
    n: 2, // Mã 馬 (Tối đa 2)
    c: 2, // Pháo 砲 (Tối đa 2)
    p: 5, // Tốt 卒 (Tối đa 5)
  };

  let state = {
    subMode: 'play',      // 'play' = free move testing on main board; 'edit' = piece palette editing
    selectedTool: 'move', // 'move' | 'delete' | piece char 'K', 'R', etc.
    selectedSquare: null, // {row, col} for dragging/moving piece in edit mode
    autoAnalyze: true,    // auto calculate MultiPV variations when board changes
    suggestFilter: 'both', // whose moves get suggestions: 'off' | 'both' | 'red' | 'black'
    startErrors: null,     // problems reported by the last failed "Bắt đầu phân tích" (cleared by the next edit)
    sheetCollapsed: false, // the suggestions panel (a bottom sheet on phones) is folded to one line
    isAnalyzing: false,
    variations: [],       // array of formatted variations with opponent replies
    activeVariationIdx: 0,
  };

  // e.g. "Xe Đỏ 车", "Tốt Đen 卒"
  const pieceLabel = (p) => {
    const info = XIANGQI.PIECES[p];
    if (!info) return p || 'quân';
    const name = p === 'p' ? 'Tốt' : info.vnName;
    return `${name} ${info.color === 'red' ? 'Đỏ' : 'Đen'} ${info.char}`;
  };

  function getBoard() {
    if (window.game && window.game.getState()) {
      return window.game.getState().board;
    }
    return XIANGQI.parseFEN(XIANGQI.DEFAULT_FEN).board;
  }

  function getTurn() {
    if (window.game && window.game.getState()) {
      return window.game.getState().turn;
    }
    return 'red';
  }

  // Apply an edit: work on a copy, then hand it to the game (resets move history to this position)
  function commit(mutate, turn = getTurn()) {
    const board = getBoard().map(r => [...r]);
    mutate(board);
    window.game.setPosition(board, turn);
    state.startErrors = null;
    updatePaletteCounts();
    scheduleAnalysis();
  }

  // ===== Suggestion filter (off / both / red / black) =====
  const FILTERS = ['off', 'both', 'red', 'black'];
  const FILTER_KEY = 'cotuong.suggestFilter';

  function shouldSuggest(turn, filter = state.suggestFilter) {
    return filter === 'both' || filter === turn;
  }

  function setSuggestFilter(filter) {
    if (!FILTERS.includes(filter)) return;
    state.suggestFilter = filter;
    document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(FILTER_KEY, filter); } catch (e) { /* private mode: not persisted */ }
    analyzeCustomBoard();   // an explicit choice takes effect immediately, whatever "Tự động" says
  }

  function restoreSuggestFilter() {
    try {
      const saved = typeof localStorage !== 'undefined' && localStorage.getItem(FILTER_KEY);
      if (FILTERS.includes(saved)) {
        state.suggestFilter = saved;
        document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === saved));
      }
    } catch (e) { /* ignore */ }
  }

  function filterLabel(filter) {
    return { off: 'Tắt', both: 'Cả hai', red: 'Chỉ Đỏ', black: 'Chỉ Đen' }[filter];
  }

  // ===== Bottom sheet (phones): fold the suggestions down to a one-line summary =====
  function setSheetCollapsed(collapsed) {
    state.sheetCollapsed = !!collapsed;
    document.getElementById('main-analysis-card')?.classList.toggle('collapsed', state.sheetCollapsed);
    document.getElementById('sheet-handle')?.setAttribute('aria-expanded', String(!state.sheetCollapsed));
    if (document.body) document.body.classList.toggle('sheet-collapsed', state.sheetCollapsed);
  }

  function toggleSheet() {
    setSheetCollapsed(!state.sheetCollapsed);
  }

  function updateSheetSummary(text) {
    const el = document.getElementById('sheet-summary');
    if (el) el.textContent = text || '';
  }

  // Called by the game when entering / leaving analysis mode
  function setActive(active) {
    if (document.body) document.body.classList.toggle('analysis-mode', !!active);
    if (!active) leaveEditing();
  }

  function init() {
    restoreSuggestFilter();
    // Keep the page content clear of the pinned sheet
    const card = document.getElementById('main-analysis-card');
    if (card && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${card.offsetHeight}px`)).observe(card);
    }
    updatePaletteCounts();
  }

  // Count pieces currently on board
  function countPieces() {
    const counts = { K: 0, A: 0, B: 0, R: 0, N: 0, C: 0, P: 0, k: 0, a: 0, b: 0, r: 0, n: 0, c: 0, p: 0 };
    let redTotal = 0;
    let blackTotal = 0;
    const board = getBoard();

    if (!board) return { counts, redTotal, blackTotal, total: 0 };

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && counts[p] !== undefined) {
          counts[p]++;
          if (XIANGQI.isRed(p)) redTotal++;
          else blackTotal++;
        }
      }
    }
    return { counts, redTotal, blackTotal, total: redTotal + blackTotal };
  }

  // Xiangqi legal zones for pieces
  function isSquareLegalForPiece(piece, row, col) {
    if (row < 0 || row > 9 || col < 0 || col > 8) return { legal: false, reason: 'Nằm ngoài bàn cờ' };

    // Red King (帥): rows 7-9, cols 3-5 (Cung Đỏ)
    if (piece === 'K') {
      if (row >= 7 && row <= 9 && col >= 3 && col <= 5) return { legal: true };
      return { legal: false, reason: 'Tướng Đỏ (帥) chỉ được đặt trong Cung Đỏ (hàng 8-10, cột 4-6)!' };
    }

    // Black King (將): rows 0-2, cols 3-5 (Cung Đen)
    if (piece === 'k') {
      if (row >= 0 && row <= 2 && col >= 3 && col <= 5) return { legal: true };
      return { legal: false, reason: 'Tướng Đen (將) chỉ được đặt trong Cung Đen (hàng 1-3, cột 4-6)!' };
    }

    // Red Advisor (仕): 5 fixed positions in Red Palace
    if (piece === 'A') {
      const redAdvisorPositions = [
        [7, 3], [7, 5],
        [8, 4],
        [9, 3], [9, 5]
      ];
      if (redAdvisorPositions.some(([r, c]) => r === row && c === col)) return { legal: true };
      return { legal: false, reason: 'Sĩ Đỏ (仕) chỉ được đặt tại 5 điểm hợp lệ trong Cung Đỏ!' };
    }

    // Black Advisor (士): 5 fixed positions in Black Palace
    if (piece === 'a') {
      const blackAdvisorPositions = [
        [0, 3], [0, 5],
        [1, 4],
        [2, 3], [2, 5]
      ];
      if (blackAdvisorPositions.some(([r, c]) => r === row && c === col)) return { legal: true };
      return { legal: false, reason: 'Sĩ Đen (士) chỉ được đặt tại 5 điểm hợp lệ trong Cung Đen!' };
    }

    // Red Elephant (相): 7 fixed positions on Red side (never cross river)
    if (piece === 'B') {
      const redElephantPositions = [
        [5, 2], [5, 6],
        [7, 0], [7, 4], [7, 8],
        [9, 2], [9, 6]
      ];
      if (redElephantPositions.some(([r, c]) => r === row && c === col)) return { legal: true };
      return { legal: false, reason: 'Tượng Đỏ (相) không được qua sông và chỉ đi ở 7 điểm hợp lệ!' };
    }

    // Black Elephant (象): 7 fixed positions on Black side (never cross river)
    if (piece === 'b') {
      const blackElephantPositions = [
        [0, 2], [0, 6],
        [2, 0], [2, 4], [2, 8],
        [4, 2], [4, 6]
      ];
      if (blackElephantPositions.some(([r, c]) => r === row && c === col)) return { legal: true };
      return { legal: false, reason: 'Tượng Đen (象) không được qua sông và chỉ đi ở 7 điểm hợp lệ!' };
    }

    // Red Pawn (兵): cannot move backward, so cannot be on rows 7, 8, 9
    if (piece === 'P') {
      if (row > 6) return { legal: false, reason: 'Binh Đỏ (兵) không thể lùi về sau hàng xuất phát (hàng 8, 9, 10)!' };
      if (row >= 5 && col % 2 !== 0) {
        return { legal: false, reason: 'Binh Đỏ (兵) chưa qua sông chỉ được đứng ở cột lẻ (1, 3, 5, 7, 9)!' };
      }
      return { legal: true };
    }

    // Black Pawn (卒): cannot move backward, so cannot be on rows 0, 1, 2
    if (piece === 'p') {
      if (row < 3) return { legal: false, reason: 'Tốt Đen (卒) không thể lùi về sau hàng xuất phát (hàng 1, 2, 3)!' };
      if (row <= 4 && col % 2 !== 0) {
        return { legal: false, reason: 'Tốt Đen (卒) chưa qua sông chỉ được đứng ở cột lẻ (1, 3, 5, 7, 9)!' };
      }
      return { legal: true };
    }

    // Chariots (Xe), Horses (Mã), Cannons (Pháo) can be anywhere on the board
    return { legal: true };
  }

  // Update piece badges and disabled states in palette
  function updatePaletteCounts() {
    const { counts, redTotal, blackTotal } = countPieces();

    // 1. Update piece counters & depleted state
    for (const [piece, max] of Object.entries(PIECE_LIMITS)) {
      const current = counts[piece] || 0;
      const remaining = Math.max(0, max - current);
      const badge = document.getElementById(`editor-count-${piece}`);
      const btn = document.querySelector(`.editor-pbtn[data-piece="${piece}"]`);
      const pieceName = pieceLabel(piece);

      if (badge) badge.textContent = remaining;

      if (btn) {
        btn.setAttribute('title', `${pieceName} (Còn ${remaining}/${max} quân)`);
        btn.classList.toggle('depleted', remaining <= 0);   // a depleted piece cannot be placed again
      }
    }

    // 2. Update summary status bar
    const redCountEl = document.getElementById('editor-red-count');
    const blackCountEl = document.getElementById('editor-black-count');
    const statusBadgeEl = document.getElementById('editor-status-badge');

    if (redCountEl) redCountEl.textContent = redTotal;
    if (blackCountEl) blackCountEl.textContent = blackTotal;

    const startBtn = document.getElementById('editor-start-btn');
    if (startBtn) startBtn.title = 'Kiểm tra thế cờ rồi vào phân tích';
    const fenEl = document.getElementById('editor-fen');
    const board = getBoard();
    if (fenEl && board) fenEl.value = XIANGQI.boardToFEN(board, getTurn(), 1);

    // Nothing is judged while setting up: the pill only counts pieces. Problems are listed once the
    // user presses "Bắt đầu phân tích".
    if (statusBadgeEl) {
      statusBadgeEl.innerHTML = state.startErrors
        ? `<div class="status-pill invalid"><strong>Phát hiện ${state.startErrors.length} lỗi:</strong><ul class="setup-errors">${state.startErrors.map(e => `<li>${e}</li>`).join('')}</ul></div>`
        : `<span class="status-pill">${redTotal} quân Đỏ · ${blackTotal} quân Đen</span>`;
    }
  }

  // Copy the FEN of the position (falls back to selecting it when the clipboard is not available)
  async function copyFEN() {
    const board = getBoard();
    if (!board) return;
    const fen = XIANGQI.boardToFEN(board, getTurn(), 1);
    try {
      await navigator.clipboard.writeText(fen);
      UI.showToast('Đã sao chép FEN', 'success');
    } catch (e) {
      const fenEl = document.getElementById('editor-fen');
      if (fenEl && fenEl.select) fenEl.select();
      UI.showToast('Không sao chép tự động được — FEN đã được chọn, hãy sao chép thủ công', 'info');
    }
  }

  function selectTool(tool) {
    state.selectedTool = tool;
    clearSelection();

    document.querySelectorAll('.editor-pbtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.piece === tool);
    });

    document.getElementById('editor-btn-move')?.classList.toggle('active', tool === 'move');
    document.getElementById('editor-btn-delete')?.classList.toggle('active', tool === 'delete');
  }

  // Setting up ('edit') never runs the engine; 'play' = analyse the position and try moves.
  function setSubMode(mode) {
    if (mode === state.subMode) return;

    if (mode === 'play') {
      // Leaving the setup is the "Bắt đầu phân tích" step: the position must be legal
      const v = validateBoard();
      if (!v.valid) {
        reportStartErrors(v.errors);
        return;
      }
      state.startErrors = null;
    }

    applySubMode(mode);
  }

  // "Bắt đầu phân tích" found problems: say which pieces/positions are invalid
  function reportStartErrors(errors) {
    state.startErrors = errors;
    updatePaletteCounts();
    const shown = errors.slice(0, 3).join(' • ');
    const more = errors.length > 3 ? ` … và ${errors.length - 3} lỗi khác` : '';
    UI.showToast(`Phát hiện quân cờ không hợp lệ: ${shown}${more}`, 'error');
  }

  function applySubMode(mode) {
    state.subMode = mode;
    document.getElementById('btn-sub-play')?.classList.toggle('active', mode === 'play');
    document.getElementById('btn-sub-edit')?.classList.toggle('active', mode === 'edit');
    document.getElementById('editor-palette-container')?.classList.toggle('hidden', mode !== 'edit');
    clearSelection();
    setEditChrome(mode === 'edit');
    setSheetCollapsed(mode === 'edit');   // leave the board and palette uncovered while placing pieces

    if (mode === 'edit') {
      cancelAnalysis();
      UI.clearAnalysisVariations();
      updatePaletteCounts();
      UI.render();
      UI.showToast('Xếp cờ tự do: chọn quân rồi bấm ô muốn đặt. Xong bấm “Bắt đầu phân tích”.', 'info');
    } else {
      selectTool('move');
      UI.render();
      UI.showToast('Bắt đầu phân tích: bạn có thể đi thử cho cả 2 bên.', 'success');
      analyzeCustomBoard();
    }
  }

  // Everything that only belongs to board setup: turn bar, both piece trays, FEN row, toolbar
  const EDIT_CHROME = ['editor-turnbar', 'editor-tray-black', 'editor-tray-red', 'editor-fen-row', 'editor-toolbar'];
  function setEditChrome(on) {
    EDIT_CHROME.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !on));
    if (document.body) document.body.classList.toggle('edit-mode', !!on);
  }

  // Stop the engine and make any analysis in flight irrelevant
  function cancelAnalysis() {
    analysisToken++;
    clearTimeout(analysisTimer);
    Engine.stopAnalysis();
  }

  // The "▶ Bắt đầu phân tích" button
  function startAnalysis() {
    setSubMode('play');
  }

  // Leaving analysis mode altogether: drop out of setup without running anything
  function leaveEditing() {
    if (state.subMode === 'play') return;
    state.subMode = 'play';
    document.getElementById('btn-sub-play')?.classList.add('active');
    document.getElementById('btn-sub-edit')?.classList.remove('active');
    document.getElementById('editor-palette-container')?.classList.add('hidden');
    setEditChrome(false);
    clearSelection();
    state.selectedTool = 'move';
    setSheetCollapsed(false);
  }

  function toggleEditMode() {
    if (!window.game || window.game.getState().mode !== 'analyze') {
      state.subMode = 'edit';                   // set first, so entering analysis mode does not start the engine
      window.game?.setMode('analyze');
      applySubMode('edit');
    } else {
      setSubMode(state.subMode === 'edit' ? 'play' : 'edit');
    }
  }

  // In edit mode every click on the board belongs to the editor (free setup, no turn order / move rules)
  function isEditingActive() {
    return state.subMode === 'edit';
  }

  function isAutoAnalyze() {
    return state.autoAnalyze;
  }

  function toggleAutoAnalyze(checked) {
    state.autoAnalyze = !!checked;
    if (state.autoAnalyze) {
      scheduleAnalysis();
    }
  }

  function setTurn(turn) {
    document.getElementById('editor-turn-red')?.classList.toggle('active', turn === 'red');
    document.getElementById('editor-turn-black')?.classList.toggle('active', turn === 'black');
    commit(() => {}, turn);
  }

  function clearBoard() {
    // Keep the two generals on their home squares. They face each other until a piece is placed
    // between them, which "Bắt đầu phân tích" will remind about.
    commit((board) => {
      for (let r = 0; r < 10; r++) board[r].fill(null);
      board[0][4] = 'k';
      board[9][4] = 'K';
    });
    UI.showToast('Đã dọn sạch bàn cờ (giữ lại 2 Tướng).', 'info');
  }

  function resetDefaultBoard() {
    const parsed = XIANGQI.parseFEN(XIANGQI.DEFAULT_FEN);
    commit((board) => { for (let r = 0; r < 10; r++) board[r] = [...parsed.board[r]]; }, 'red');
    document.getElementById('editor-turn-red')?.classList.add('active');
    document.getElementById('editor-turn-black')?.classList.remove('active');
    UI.showToast('Đã đặt lại bàn cờ chuẩn 32 quân!', 'success');
  }

  function clearSelection() {
    state.selectedSquare = null;
    UI.state.selected = null;
    UI.state.legalMoves = [];
  }

  function selectSquare(board, row, col) {
    state.selectedSquare = { row, col };
    UI.state.selected = { row, col };
    UI.state.legalMoves = [];            // free setup: no suggested squares, any empty square can be chosen
    UI.render();
  }

  function handleEditorClick(row, col) {
    const board = getBoard();
    if (!board) return;
    const tool = state.selectedTool;

    // 1. Delete tool
    if (tool === 'delete') {
      if (board[row][col]) commit((b) => { b[row][col] = null; });
      return;
    }

    // 2. Piece placement tool (from the palette): any square, but only while the tray still has that piece
    if (PIECE_LIMITS[tool]) {
      if (board[row][col] === tool) return;   // already there: nothing changes
      if ((countPieces().counts[tool] || 0) >= PIECE_LIMITS[tool]) {
        UI.showToast(`Hết ${pieceLabel(tool)} trong khay (${PIECE_LIMITS[tool]}/${PIECE_LIMITS[tool]}). Xóa bớt hoặc chọn quân khác.`, 'info');
        return;
      }
      commit((b) => { b[row][col] = tool; });
      return;
    }

    // 3. Move tool: pick up ANY piece (either side, no turn order) and drop it on ANY empty square
    const sel = state.selectedSquare;
    const here = board[row][col];

    if (sel && here && sel.row === row && sel.col === col) { clearSelection(); UI.render(); return; }   // tap again = drop selection
    if (here) { selectSquare(board, row, col); return; }                                               // pick (or switch to) another piece
    if (!sel) return;

    const piece = board[sel.row][sel.col];
    commit((b) => { b[sel.row][sel.col] = null; b[row][col] = piece; });
    clearSelection();
  }

  function syncFromGame() {
    const turn = getTurn();
    document.getElementById('editor-turn-red')?.classList.toggle('active', turn === 'red');
    document.getElementById('editor-turn-black')?.classList.toggle('active', turn === 'black');
    updatePaletteCounts();
    scheduleAnalysis();
  }

  // Generals on the same file with nothing between them ("lộ mặt tướng")
  function generalsFacing(board) {
    let red = null, black = null;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 'K') red = { r, c };
        if (board[r][c] === 'k') black = { r, c };
      }
    }
    if (!red || !black || red.c !== black.c) return false;
    for (let r = Math.min(red.r, black.r) + 1; r < Math.max(red.r, black.r); r++) {
      if (board[r][red.c]) return false;
    }
    return true;
  }

  const squareName = (row, col) => `${'abcdefghi'[col]}${10 - row}`;   // same naming as the UCI moves

  /**
   * Check a position against the rules of xiangqi.
   * Returns { valid, error (the first problem), errors (all problems) }.
   */
  function validateBoard() {
    const board = getBoard();
    if (!board) return { valid: false, error: 'Chưa có bàn cờ', errors: ['Chưa có bàn cờ'] };
    const errors = [];

    let kings = { K: 0, k: 0 };
    const counts = {};
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        counts[p] = (counts[p] || 0) + 1;
        if (p === 'K' || p === 'k') kings[p]++;
        const z = isSquareLegalForPiece(p, r, c);
        if (!z.legal) errors.push(`Ô ${squareName(r, c)}: ${z.reason}`);
      }
    }

    if (kings.K === 0 && kings.k === 0) errors.unshift('Thiếu cả Tướng Đỏ và Tướng Đen');
    else if (kings.K === 0) errors.unshift('Thiếu Tướng Đỏ (帥) trong cung Đỏ');
    else if (kings.k === 0) errors.unshift('Thiếu Tướng Đen (將) trong cung Đen');

    for (const [p, n] of Object.entries(counts)) {
      if (n > PIECE_LIMITS[p]) errors.push(`Quá nhiều ${pieceLabel(p)}: ${n} quân (tối đa ${PIECE_LIMITS[p]})`);
    }

    if (generalsFacing(board)) errors.unshift('Hai Tướng đối mặt trực diện (Lộ mặt Tướng) — cần có quân ở giữa');

    // Only meaningful with both generals present
    if (kings.K > 0 && kings.k > 0 && !generalsFacing(board)) {   // facing already covers "in check by the other general"
      const waiting = getTurn() === 'red' ? 'black' : 'red';
      if (XIANGQI.isInCheck(board, waiting)) {
        errors.push(`Tướng ${waiting === 'red' ? 'Đỏ' : 'Đen'} đang bị chiếu nhưng không tới lượt — hãy đổi lượt đi`);
      }
    }

    return { valid: errors.length === 0, error: errors[0], errors };
  }

  // Format a variation with piece names, moves, and opponent response
  function formatVariationDetails(board, turn, rawVar) {
    if (!rawVar || !rawVar.pv) return null;
    let moves = [];
    if (Array.isArray(rawVar.pv)) {
      moves = rawVar.pv;
    } else if (typeof rawVar.pv === 'string') {
      moves = rawVar.pv.trim().split(/\s+/);
    }
    moves = moves.filter(m => typeof m === 'string' && XIANGQI.parseUCI(m));
    if (moves.length === 0) return null;

    const firstMoveUCI = moves[0];
    const firstM = XIANGQI.parseUCI(firstMoveUCI);
    if (!firstM) return null;

    const piece = board[firstM.fromRow][firstM.fromCol];
    if (!piece) return null;

    const myMoveVN = XIANGQI.moveToVietnameseFull
      ? XIANGQI.moveToVietnameseFull(board, firstM.fromRow, firstM.fromCol, firstM.toRow, firstM.toCol)
      : XIANGQI.uciToVietnamese(board, firstMoveUCI);

    let counterMove = null;
    let counterMoveVN = null;
    let counterPiece = null;

    const boardAfterMyMove = XIANGQI.applyMove(board, firstM.fromRow, firstM.fromCol, firstM.toRow, firstM.toCol);

    if (moves.length > 1) {
      const secondMoveUCI = moves[1];
      const secondM = XIANGQI.parseUCI(secondMoveUCI);
      if (secondM) {
        counterPiece = boardAfterMyMove[secondM.fromRow][secondM.fromCol];
        counterMove = secondMoveUCI;
        counterMoveVN = XIANGQI.moveToVietnameseFull
          ? XIANGQI.moveToVietnameseFull(boardAfterMyMove, secondM.fromRow, secondM.fromCol, secondM.toRow, secondM.toCol)
          : XIANGQI.uciToVietnamese(boardAfterMyMove, secondMoveUCI);
      }
    }

    const continuationMoves = [];
    let curBoard = board;
    for (let i = 0; i < Math.min(moves.length, 4); i++) {   // same length as the arrows drawn on the board
      const uci = moves[i];
      const m = XIANGQI.parseUCI(uci);
      if (m && curBoard[m.fromRow] && curBoard[m.fromRow][m.fromCol]) {
        const vn = XIANGQI.moveToVietnameseFull
          ? XIANGQI.moveToVietnameseFull(curBoard, m.fromRow, m.fromCol, m.toRow, m.toCol)
          : uci;
        continuationMoves.push(vn);
        curBoard = XIANGQI.applyMove(curBoard, m.fromRow, m.fromCol, m.toRow, m.toCol);
      } else {
        continuationMoves.push(uci);
      }
    }

    return {
      rank: rawVar.rank || 1,
      score: rawVar.score || 0,
      isMate: rawVar.isMate || false,
      mateIn: rawVar.mateIn || 0,
      firstMove: firstMoveUCI,
      piece: piece,
      myMoveVN: myMoveVN,
      counterMove: counterMove,
      counterPiece: counterPiece,
      counterMoveVN: counterMoveVN,
      continuationMoves: continuationMoves,
      pv: moves.slice(0, 4),
      continuationText: continuationMoves.map((m, i) => `${i + 1}. ${m}`).join('  ➔  ')
    };
  }

  // Engine scores are from the side to move's view; the "Đánh giá" bar is from Red's
  const redPov = (variation, turn) => variation ? (turn === 'red' ? variation.score : -variation.score) : 0;

  function updateEvalScoreUI(score) {
    UI.setEvalBar(score === undefined ? null : score);   // the bar at the top of the page follows the analysis too
    const scoreEl = document.getElementById('editor-eval-score');
    const fillEl = document.getElementById('editor-eval-fill');
    if (!scoreEl) return;

    if (score === undefined || score === null) {
      scoreEl.textContent = '—';
      if (fillEl) fillEl.style.width = '50%';
      return;
    }

    const displayScore = Math.abs(score) > 9000 ? (score > 0 ? 'Chiếu bí +' : 'Chiếu bí −') : (score >= 0 ? '+' : '') + (score / 100).toFixed(2);
    scoreEl.textContent = displayScore;

    if (fillEl) {
      const pct = Math.max(5, Math.min(95, 50 + (score / 15)));
      fillEl.style.width = `${pct}%`;
    }
  }

  function scoreText(v) {
    if (v.isMate) return `Chiếu bí ${v.mateIn > 0 ? '+' : '−'}${Math.abs(v.mateIn)}`;
    return (v.score >= 0 ? '+' : '') + (v.score / 100).toFixed(2);
  }

  function renderVariationsUI(variations) {
    const listEl = document.getElementById('editor-variations-list');
    if (!listEl) return;

    if (!variations || variations.length === 0) {
      listEl.innerHTML = '<div class="empty-reply">Không tìm thấy nước đi khả thi</div>';
      updateSheetSummary('');
      return;
    }

    const rankLabels = ['Tối ưu', 'Khả thi', 'Biến phụ'];

    listEl.innerHTML = variations.map((v, idx) => {
      const reply = v.counterMove
        ? `<strong>${v.counterMoveVN}</strong>`
        : '<span class="text-muted">không có nước đáp mạnh</span>';

      // One compact line per variation: [rank] You ➔ Opponent   score  [Play]
      return `
        <div class="variation-card rank-${v.rank} ${idx === state.activeVariationIdx ? 'active' : ''}"
             onclick="window.boardEditor.setActiveVariation(${idx})"
             title="Biến ${v.rank} (${rankLabels[v.rank - 1] || 'phụ'}): ${v.firstMove}${v.counterMove ? ' ➔ ' + v.counterMove : ''}. Điểm tính cho bên đang đi.">
          <div class="var-line">
            <span class="var-badge var-rank-${v.rank}">${v.rank}</span>
            <div class="var-moves">
              <span class="var-move mine"><span class="var-who">Bạn</span> <strong>${v.myMoveVN}</strong></span>
              <span class="var-then" aria-hidden="true">➔</span>
              <span class="var-move opp"><span class="var-who">Đối thủ</span> ${reply}</span>
            </div>
            <span class="var-score ${v.score >= 0 ? 'pos' : 'neg'}">${scoreText(v)}</span>
            <button type="button" class="var-play-btn" onclick="event.stopPropagation(); window.boardEditor.applyVariation(${idx})" title="Đi nước này trên bàn cờ">♟️ Đi</button>
          </div>
          <div class="var-continuation" title="Cả chuỗi nước đi, đánh số giống số trên mũi tên">↳ ${v.continuationText}</div>
        </div>
      `;
    }).join('');

    const best = variations[0];
    updateSheetSummary(`${best.myMoveVN}${best.counterMoveVN ? ' ➔ ' + best.counterMoveVN : ''} · ${scoreText(best)}`);
  }

  function setActiveVariation(idx) {
    state.activeVariationIdx = idx;
    if (state.variations && state.variations.length > 0) {
      renderVariationsUI(state.variations);
      // Update arrows on main chessboard
      UI.setAnalysisVariations(state.variations, idx);
    }
  }

  async function applyVariation(idx) {
    if (!state.variations || !state.variations[idx]) return;
    const v = state.variations[idx];
    const m = XIANGQI.parseUCI(v.firstMove);
    if (!m) return;

    if (window.game && window.game.executeMove) {
      await window.game.executeMove(m.fromRow, m.fromCol, m.toRow, m.toCol);
    }
  }

  // The filter excludes the side to move: clear everything and do no engine work
  function showSuggestionsOff(turn) {
    state.variations = [];
    UI.clearAnalysisVariations();
    updateEvalScoreUI(null);
    const sideName = turn === 'red' ? 'Đỏ' : 'Đen';
    const msg = state.suggestFilter === 'off'
      ? 'Gợi ý đang tắt. Chọn “Cả hai”, “Chỉ Đỏ” hoặc “Chỉ Đen” phía trên để bật lại.'
      : `Đang chỉ gợi ý cho bên ${state.suggestFilter === 'red' ? 'Đỏ' : 'Đen'} — hiện là lượt ${sideName}.`;
    const listEl = document.getElementById('editor-variations-list');
    if (listEl) listEl.innerHTML = `<div class="empty-reply">${msg}</div>`;
    updateSheetSummary(state.suggestFilter === 'off' ? 'Gợi ý đang tắt' : `Lượt ${sideName}: không gợi ý (${filterLabel(state.suggestFilter)})`);
  }

  // Debounce rapid edits and ignore results of analyses that were superseded
  let analysisToken = 0;
  let analysisTimer = null;

  function scheduleAnalysis() {
    if (!state.autoAnalyze || state.subMode !== 'play') return;
    clearTimeout(analysisTimer);
    analysisTimer = setTimeout(analyzeCustomBoard, 250);
  }

  async function analyzeCustomBoard() {
    const token = ++analysisToken;
    const isStale = () => token !== analysisToken;
    Engine.stopAnalysis();
    if (state.subMode === 'edit') {                 // setting up: nothing to analyse yet
      state.variations = [];
      UI.clearAnalysisVariations();
      updateEvalScoreUI(null);
      const listEl = document.getElementById('editor-variations-list');
      if (listEl) listEl.innerHTML = '<div class="empty-reply">Đang xếp cờ. Xếp xong hãy bấm “▶ Bắt đầu phân tích”.</div>';
      updateSheetSummary('Đang xếp cờ');
      return;
    }
    const board = getBoard();
    const turn = getTurn();
    if (!board) return;

    const val = validateBoard();
    if (!val.valid) {
      if (!state.autoAnalyze) UI.showToast(val.error, 'error');
      const listEl = document.getElementById('editor-variations-list');
      if (listEl) listEl.innerHTML = `<div class="empty-reply">⚠️ ${val.error}</div>`;
      return;
    }

    if (!shouldSuggest(turn)) {
      showSuggestionsOff(turn);
      return;
    }

    if (!Engine.isReady()) {
      const listEl = document.getElementById('editor-variations-list');
      if (listEl) listEl.innerHTML = '<div style="padding: 0.6rem; color: var(--accent-gold); font-size: 0.82rem;"><span class="loading-spin">⏳</span> Đang khởi động AI Engine...</div>';
      return;
    }

    state.isAnalyzing = true;
    const resultBox = document.getElementById('editor-analysis-result');
    const listEl = document.getElementById('editor-variations-list');

    if (resultBox) resultBox.classList.remove('hidden');
    if (listEl) {
      listEl.innerHTML = '<div style="padding: 0.6rem; color: var(--accent-gold); font-size: 0.82rem;"><span class="loading-spin">⏳</span> Đang phân tích các biến & nước phản đòn...</div>';
    }

    const moveNum = (window.game && window.game.getState()) ? window.game.getState().moveNumber : 1;
    const fen = XIANGQI.boardToFEN(board, turn, moveNum);

    try {
      const res = await Engine.analyzeMultiPV(fen, 10, 3, (vars) => {
        if (isStale()) return;
        if (vars && vars.length > 0) {
          const formatted = vars.map(v => formatVariationDetails(board, turn, v)).filter(Boolean);
          if (formatted.length > 0) {
            state.variations = formatted;
            updateEvalScoreUI(redPov(formatted[0], turn));
            renderVariationsUI(formatted);
            UI.setAnalysisVariations(formatted, state.activeVariationIdx);
          }
        }
      }, { shouldAbort: isStale });

      if (isStale()) return;
      if (res && res.variations && res.variations.length > 0) {
        const formatted = res.variations.map(v => formatVariationDetails(board, turn, v)).filter(Boolean);
        state.variations = formatted;
        state.activeVariationIdx = 0;
        updateEvalScoreUI(redPov(formatted[0], turn));
        renderVariationsUI(formatted);
        UI.setAnalysisVariations(formatted, 0);
      } else {
        if (listEl) listEl.innerHTML = '<div class="empty-reply">Không tìm thấy nước đi hợp lệ</div>';
        UI.clearAnalysisVariations();
      }
    } catch (e) {
      console.error('Custom board analysis error:', e);
      if (!isStale() && listEl) listEl.innerHTML = `<div class="empty-reply">Lỗi phân tích: ${e.message || e}</div>`;
    } finally {
      if (!isStale()) state.isAnalyzing = false;
    }
  }

  return {
    init,
    selectTool,
    setSubMode,
    copyFEN,
    startAnalysis,
    toggleEditMode,
    isEditingActive,
    isAutoAnalyze,
    toggleAutoAnalyze,
    setTurn,
    clearBoard,
    resetDefaultBoard,
    handleEditorClick,
    syncFromGame,
    analyzeCustomBoard,
    applyVariation,
    validateBoard,
    setSuggestFilter,
    shouldSuggest,
    toggleSheet,
    generalsFacing,
    setSheetCollapsed,
    setActive,
    isSquareLegalForPiece,
    countPieces,
    setActiveVariation,
    getState: () => state,
  };
})();

window.boardEditor = BoardEditor;
window.addEventListener('DOMContentLoaded', () => {
  BoardEditor.init();
});
