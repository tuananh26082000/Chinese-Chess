/**
 * main.js - Game Controller
 * Orchestrates game state, AI moves, analysis, and user interaction
 */

const Game = (() => {

  let gameState = {
    board: null,
    turn: 'red',
    moveNumber: 1,
    mode: 'pvai',       // 'pvai', 'pvp', 'analyze'
    playerColor: 'red', // which color human plays
    aiLevel: 5,
    moveHistory: [],    // [{fromRow, fromCol, toRow, toCol, capturedPiece, fen, uci, vn, quality, turnBefore, moveNumberBefore, key}]
    boardHistory: [],   // board states for undo/navigation
    viewIdx: -1,        // -1 = showing the live position; k = showing the position after k moves
    gameId: 0,          // bumped on new game / undo so stale async results can be discarded
    gameOver: false,
    isMoving: false,    // a move animation is in progress
    modeChosen: false,  // false until a mode has been picked in the main menu
    analysisEnabled: true,
    isAIThinking: false,
    hintActive: false,
    lastHintMove: null,
  };

  // ===== INITIALIZATION =====
  async function init() {
    const splashStatus = document.getElementById('splash-status');
    if (splashStatus) splashStatus.textContent = 'Đang khởi tạo bàn cờ...';

    newGame();

    if (splashStatus) splashStatus.textContent = 'Đang tải engine AI...';
    await Engine.init();

    if (splashStatus) splashStatus.textContent = 'Sẵn sàng!';
    await new Promise(r => setTimeout(r, 500));

    // Hide splash
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.classList.add('hidden'), 500);
    }
    document.getElementById('app')?.classList.remove('hidden');
    updateModeChip();
    showMenu();

    setupEventListeners();
    setupNavigation();
    setupLessons();
  }

  // ===== NEW GAME =====
  function newGame(fen = null) {
    // Parse first: an invalid FEN throws before any state is touched
    const parsed = XIANGQI.parseFEN(typeof fen === 'string' ? fen : XIANGQI.DEFAULT_FEN);
    gameState.gameId++; setEngineAutoPlay(false);
    gameState.board = parsed.board;
    gameState.turn = parsed.turn;
    gameState.moveNumber = parsed.moveNum;
    gameState.moveHistory = [];
    gameState.boardHistory = [parsed.board.map(r => [...r])];
    gameState.startKey = XIANGQI.positionKey(parsed.board, parsed.turn);
    gameState.viewIdx = -1;
    gameState.gameOver = false;
    gameState.isAIThinking = false;
    gameState.isMoving = false;
    gameState.hintActive = false;
    gameState.lastHintMove = null;

    UI.state.board = gameState.board;
    UI.state.mode = gameState.mode;
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.state.lastMove = null;
    UI.state.hintMove = null;
    UI.state.evalHistory = [];
    UI.state.analysisVariations = null;
    UI.state.moveBadge = null;

    clearAnalysisPanel();
    UI.updateMoveHistory([], -1);
    UI.updateTurnIndicator(gameState.turn, XIANGQI.isInCheck(gameState.board, gameState.turn));
    UI.updateEvalBar(0);
    updateNavButtons();
    UI.render();
    if (gameState.mode === 'analyze' && window.boardEditor) window.boardEditor.syncFromGame();

    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = 'Hãy thực hiện nước đi';

    const gs = XIANGQI.getGameState(gameState.board, gameState.turn);
    if (gs !== 'playing') {
      endGameByNoMoves(gs, gameState.turn === 'red' ? 'black' : 'red');
      return;
    }

    // If AI plays first (human is black)
    if (gameState.mode === 'pvai' && gameState.playerColor !== gameState.turn) {
      const id = gameState.gameId;
      setTimeout(() => { if (id === gameState.gameId) makeAIMove(); }, 600);
    }
  }

  /**
   * Replace the position without FEN validation (the board editor passes in-progress positions,
   * e.g. generals facing). Move history restarts from this position, so undo can't restore a stale board.
   */
  function setPosition(board, turn) {
    gameState.gameId++; setEngineAutoPlay(false);
    gameState.board = board.map(r => [...r]);
    gameState.turn = turn;
    gameState.moveNumber = 1;
    gameState.moveHistory = [];
    gameState.boardHistory = [gameState.board.map(r => [...r])];
    gameState.startKey = XIANGQI.positionKey(gameState.board, turn);
    gameState.viewIdx = -1;
    gameState.gameOver = false;
    gameState.isAIThinking = false;
    gameState.isMoving = false;

    UI.state.board = gameState.board;
    UI.state.mode = gameState.mode;
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.state.lastMove = null;
    UI.state.hintMove = null;
    UI.state.analysisVariations = null;
    UI.state.moveBadge = null;
    UI.updateMoveHistory([], -1);
    UI.updateTurnIndicator(turn, XIANGQI.isInCheck(gameState.board, turn));
    clearAnalysisPanel();
    updateNavButtons();
    UI.render();
  }

  function clearAnalysisPanel() {
    const qualityEl = document.getElementById('last-move-quality');
    const detailEl = document.getElementById('analysis-detail');
    const bestMoveEl = document.getElementById('best-move-suggestion');
    if (qualityEl) qualityEl.innerHTML = '';
    if (detailEl) detailEl.innerHTML = '<p class="analysis-hint">Thực hiện nước đi để xem phân tích</p>';
    if (bestMoveEl) bestMoveEl.innerHTML = '';
  }

  // ===== LOAD FEN =====
  function loadFEN() {
    const input = document.getElementById('fen-input');
    if (!input) return;
    const fen = input.value.trim();
    if (!fen) { UI.showToast('Vui lòng nhập FEN', 'error'); return; }
    try {
      newGame(fen);
      UI.showToast('Đã tải thế cờ thành công!', 'success');
    } catch (e) {
      UI.showToast(`FEN không hợp lệ: ${e.message}`, 'error');
    }
  }

  function copyFEN() {
    const fen = XIANGQI.boardToFEN(gameState.board, gameState.turn, gameState.moveNumber);
    navigator.clipboard?.writeText(fen).then(() => {
      UI.showToast('Đã sao chép FEN!', 'success');
    }).catch(() => UI.showToast('Không thể sao chép, hãy copy thủ công từ ô FEN', 'error'));
    const input = document.getElementById('fen-input');
    if (input) input.value = fen;
  }

  // ===== MOVE HANDLING =====
  async function handleSquareClick(row, col) {
    if (isMenuOpen()) return;
    if (gameState.gameOver || gameState.isAIThinking || gameState.isMoving) return;

    // Browsing history: a click just returns to the live position
    if (gameState.viewIdx >= 0) {
      returnToCurrentPosition();
      return;
    }

    // Board editor tool active (place / delete pieces)
    if (gameState.mode === 'analyze' && window.boardEditor && window.boardEditor.isEditingActive()) {
      window.boardEditor.handleEditorClick(row, col);
      return;
    }

    // PvAI: only allow moves if it's player's turn
    if (gameState.mode === 'pvai' && gameState.turn !== gameState.playerColor) return;

    const clickedPiece = gameState.board[row][col];
    const selected = UI.state.selected;

    if (selected) {
      const isLegalDest = UI.state.legalMoves.some(([r, c]) => r === row && c === col);
      if (isLegalDest) {
        UI.state.hintMove = null;
        UI.state.selected = null;
        UI.state.legalMoves = [];
        await executeMove(selected.row, selected.col, row, col);
        return;
      }
    }

    // Select a piece
    if (clickedPiece && XIANGQI.pieceColor(clickedPiece) === gameState.turn) {
      UI.state.selected = { row, col };
      UI.state.legalMoves = XIANGQI.getLegalMovesForPiece(gameState.board, row, col, gameState.turn);
      UI.render();
      return;
    }

    // Deselect
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.render();
  }

  function endGameByNoMoves(gs, winner) {
    gameState.gameOver = true;
    const winnerName = winner === 'red' ? 'Đỏ' : 'Đen';
    // In xiangqi a side with no legal move loses (checkmate or stalemate alike)
    const title = gs === 'checkmate' ? 'Chiếu bí!' : 'Vây bí!';
    setTimeout(() => showGameOver(title, `Quân ${winnerName} thắng!`, winner), 500);
  }

  // Draw by repetition / no capture for 120 plies / no attacking material
  function detectDraw() {
    const h = gameState.moveHistory;
    if (XIANGQI.isInsufficientMaterial(gameState.board)) return 'Không đủ quân để chiếu hết';

    const key = h.length ? h[h.length - 1].key : gameState.startKey;
    let seen = key === gameState.startKey && h.length ? 1 : 0;
    for (let i = 0; i < h.length; i++) if (h[i].key === key) seen++;
    if (seen >= 3) return 'Lặp lại thế cờ 3 lần';

    let quiet = 0;
    for (let i = h.length - 1; i >= 0 && !h[i].capturedPiece; i--) quiet++;
    if (quiet >= 120) return '60 nước không ăn quân';
    return null;
  }

  async function executeMove(fromRow, fromCol, toRow, toCol, isAI = false) {
    // Always play on the live position, never on a history view
    if (gameState.viewIdx >= 0) returnToCurrentPosition(true);

    const id = gameState.gameId;
    gameState.isMoving = true;
    const board = gameState.board;
    const piece = board[fromRow][fromCol];
    const capturedPiece = board[toRow][toCol];
    const turnBefore = gameState.turn;
    const moveNumberBefore = gameState.moveNumber;

    const fenBefore = XIANGQI.boardToFEN(board, turnBefore, moveNumberBefore);
    const uci = XIANGQI.moveToUCI(fromRow, fromCol, toRow, toCol);
    const vn = XIANGQI.moveToVietnamese(board, fromRow, fromCol, toRow, toCol);
    const wasHint = (gameState.lastHintMove === uci);
    gameState.lastHintMove = null;

    await new Promise(resolve => {
      UI.animateMove(board, fromRow, fromCol, toRow, toCol, resolve);
    });
    if (id !== gameState.gameId) return;  // game was reset during the animation

    const newBoard = XIANGQI.applyMove(board, fromRow, fromCol, toRow, toCol);
    gameState.board = newBoard;
    UI.state.board = newBoard;
    UI.state.lastMove = { fromRow, fromCol, toRow, toCol };

    // Switch turn
    gameState.turn = turnBefore === 'red' ? 'black' : 'red';
    if (gameState.turn === 'red') gameState.moveNumber++;

    const moveRecord = {
      fromRow, fromCol, toRow, toCol,
      capturedPiece, piece, uci, vn,
      fen: fenBefore,
      turnBefore, moveNumberBefore,
      key: XIANGQI.positionKey(newBoard, gameState.turn),
      quality: null, scoreBefore: 0, scoreAfter: 0,
      wasHint,
    };
    gameState.moveHistory.push(moveRecord);
    gameState.boardHistory.push(newBoard.map(r => [...r]));
    gameState.viewIdx = -1;
    gameState.isMoving = false;
    UI.state.analysisVariations = null;
    UI.state.moveBadge = null;     // the new move is evaluated a moment later

    const gs = XIANGQI.getGameState(newBoard, gameState.turn);
    const inCheck = XIANGQI.isInCheck(newBoard, gameState.turn);

    UI.updateTurnIndicator(gameState.turn, inCheck);
    UI.updateMoveHistory(gameState.moveHistory, gameState.moveHistory.length - 1);
    updateNavButtons();
    UI.render();

    // Analysis mode: refresh the candidate lines for the new position
    if (gameState.mode === 'analyze' && window.boardEditor && window.boardEditor.isAutoAnalyze()) {
      setTimeout(() => { if (id === gameState.gameId) window.boardEditor.analyzeCustomBoard(); }, 150);
    }

    // Judge the move (badge on the piece + side panel). Analysis mode judges both sides' moves too.
    if (gameState.analysisEnabled && !isAI) {
      analyzeLastMove(moveRecord, fenBefore, id);
    }

    if (gs !== 'playing') {
      endGameByNoMoves(gs, turnBefore);
      return;
    }

    const drawReason = detectDraw();
    if (drawReason) {
      gameState.gameOver = true;
      setTimeout(() => showGameOver('Hòa!', drawReason, null), 500);
      return;
    }

    const statusMsg = document.getElementById('status-message');
    if (statusMsg) {
      statusMsg.textContent = inCheck
        ? `${gameState.turn === 'red' ? 'Đỏ' : 'Đen'} đang bị chiếu!`
        : '';
    }

    // AI move if needed
    if (gameState.mode === 'pvai' && gameState.turn !== gameState.playerColor && !isAI) {
      setTimeout(() => { if (id === gameState.gameId) makeAIMove(); }, 400);
    }
  }

  // ===== ANALYSIS =====
  async function analyzeLastMove(moveRecord, fenBefore, id) {
    if (!Engine.isReady()) return;

    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = '🔍 Đang phân tích...';

    try {
      const turnAfter = gameState.turn;
      const fenAfter = XIANGQI.boardToFEN(gameState.board, turnAfter, gameState.moveNumber);

      // Engine requests are serialised internally; scores are from the side-to-move's POV
      const beforeResult = await Engine.analyzePosition(fenBefore, 10);
      const afterResult = await Engine.analyzePosition(fenAfter, 10);
      if (id !== gameState.gameId) return;  // stale: game reset or move undone meanwhile

      const bestScore = beforeResult.score;     // mover's POV, best line
      const scoreAfter = -afterResult.score;    // negate: after the move it is the opponent's turn

      const isBestMove = moveRecord.wasHint || (beforeResult.bestMove && moveRecord.uci === beforeResult.bestMove);
      const quality = Engine.classifyMoveQuality(bestScore, scoreAfter, isBestMove);
      moveRecord.quality = quality;
      moveRecord.scoreBefore = bestScore;
      moveRecord.scoreAfter = scoreAfter;

      // When the move is the best move or followed hint, any apparent score drop
      // between the two searches is a horizon/depth discrepancy, not an actual error.
      const displayDelta = isBestMove && (scoreAfter < bestScore) ? 0 : (scoreAfter - bestScore);

      UI.showMoveQuality(quality, displayDelta, beforeResult.bestMove);
      refreshMoveBadge();
      UI.render();
      // Eval bar expects Red's point of view
      UI.updateEvalBar(turnAfter === 'red' ? afterResult.score : -afterResult.score);
      UI.updateMoveHistory(gameState.moveHistory, gameState.viewIdx >= 0 ? gameState.viewIdx - 1 : gameState.moveHistory.length - 1);
    } catch (e) {
      console.warn('Analysis error:', e);
    } finally {
      if (statusMsg && id === gameState.gameId) statusMsg.textContent = '';
    }
  }

  // ===== AI MOVE =====
  async function makeAIMove() {
    if (gameState.gameOver || gameState.isAIThinking || gameState.isMoving) return;
    const id = gameState.gameId;
    gameState.isAIThinking = true;
    if (gameState.viewIdx >= 0) returnToCurrentPosition(true);

    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = '🤖 AI đang suy nghĩ...';

    try {
      const fen = XIANGQI.boardToFEN(gameState.board, gameState.turn, gameState.moveNumber);
      const depth = Math.min(3 + Math.floor(gameState.aiLevel * 0.8), 12);
      const timeMs = 500 + gameState.aiLevel * 200;

      // Vary the answers (more at low levels and in the opening) instead of always playing the one best move
      const variety = Engine.varietyForLevel(gameState.aiLevel, gameState.moveHistory.length);
      const bestMove = await Engine.getBestMove(fen, depth, timeMs, { variety });
      if (id !== gameState.gameId || gameState.mode !== 'pvai') return;  // game reset / mode changed while thinking
      const m = bestMove && XIANGQI.parseUCI(bestMove);
      if (!m || !XIANGQI.isLegalMove(gameState.board, m.fromRow, m.fromCol, m.toRow, m.toCol, gameState.turn)) return;

      if (statusMsg) statusMsg.textContent = '';
      await executeMove(m.fromRow, m.fromCol, m.toRow, m.toCol, true);
    } catch (e) {
      console.error('AI error:', e);
    } finally {
      if (id === gameState.gameId) {
        gameState.isAIThinking = false;
        if (statusMsg && statusMsg.textContent.startsWith('🤖')) statusMsg.textContent = '';
      }
    }
  }

  // ===== HINT =====
  // Hint button (playing against the AI / another person): suggests exactly ONE move, drawn as one arrow.
  // Analysis mode has its own suggestions panel and no hint button.
  async function requestHint() {
    if (gameState.mode === 'analyze') return;
    if (gameState.gameOver || gameState.isAIThinking || gameState.isMoving) return;
    if (gameState.mode === 'pvai' && gameState.turn !== gameState.playerColor) return;
    if (gameState.viewIdx >= 0) returnToCurrentPosition(true);

    const id = gameState.gameId;
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = '💡 Đang tìm nước gợi ý...';

    try {
      const board = gameState.board;
      const fen = XIANGQI.boardToFEN(board, gameState.turn, gameState.moveNumber);
      const res = await Engine.analyzeMultiPV(fen, 10, 1, null, { shouldAbort: () => id !== gameState.gameId });
      if (id !== gameState.gameId) return;

      const best = res.variations[0];
      if (!best) {
        UI.showToast('Không tìm thấy nước đi gợi ý', 'warning');
        if (statusMsg) statusMsg.textContent = '';
        return;
      }

      UI.state.analysisVariations = null;
      UI.state.hintMove = best.firstMove;          // a single arrow
      gameState.lastHintMove = best.firstMove;
      UI.render();

      const vnHint = XIANGQI.uciToVietnamese(board, best.firstMove);
      const msg = `💡 Gợi ý: ${vnHint} (${best.firstMove})`;
      if (statusMsg) statusMsg.textContent = msg;
      UI.showToast(msg, 'info');

      const bestMoveEl = document.getElementById('best-move-suggestion');
      if (bestMoveEl) bestMoveEl.innerHTML = `<strong>${vnHint}</strong> <span class="uci-tag">(${best.firstMove})</span>`;
    } catch (e) {
      UI.showToast('Không thể tạo gợi ý', 'error');
      if (statusMsg) statusMsg.textContent = '';
    }
  }

  // ===== ENGINE MOVE (analysis mode) =====
  // "Máy đi" allows the engine to play moves in analysis mode:
  // - 'both': engine plays continuously for both sides
  // - 'red': engine plays only for Red; human plays Black
  // - 'black': engine plays only for Black; human plays Red
  let engineAutoPlay = false;
  let engineAutoPlaySide = 'both';   // 'both' | 'red' | 'black'
  const AUTOPLAY_PAUSE_MS = 400;   // lets the move be seen before the next one

  function setEngineAutoPlay(on, side = 'both') {
    engineAutoPlay = !!on;
    if (on) engineAutoPlaySide = side;
    if (!on) closeEngineMoveModal();
    const btn = document.getElementById('btn-engine-move');
    btn?.classList.toggle('active', engineAutoPlay);
    if (btn) btn.setAttribute('aria-pressed', String(engineAutoPlay));
    const label = document.getElementById('engine-move-label');
    if (label) {
      if (!engineAutoPlay) {
        label.textContent = 'Máy đi';
      } else if (engineAutoPlaySide === 'red') {
        label.textContent = 'Dừng (Đỏ)';
      } else if (engineAutoPlaySide === 'black') {
        label.textContent = 'Dừng (Đen)';
      } else {
        label.textContent = 'Dừng máy';
      }
    }
  }

  const canEnginePlay = () => gameState.mode === 'analyze' && !window.boardEditor?.isEditingActive() && !gameState.gameOver;

  // One engine move for the side to move. Resolves to true when a move was played.
  async function requestEngineMove() {
    if (!canEnginePlay()) return false;
    if (gameState.isAIThinking || gameState.isMoving) return false;
    if (gameState.viewIdx >= 0) returnToCurrentPosition(true);

    const id = gameState.gameId;
    gameState.isAIThinking = true;
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = '🤖 Máy đang chọn nước...';
    try {
      const fen = XIANGQI.boardToFEN(gameState.board, gameState.turn, gameState.moveNumber);
      const bestMove = await Engine.getBestMove(fen, 10, 1500);   // no variety: always the best move
      if (id !== gameState.gameId || !canEnginePlay()) return false;   // position changed while thinking
      const m = bestMove && XIANGQI.parseUCI(bestMove);
      if (!m || !XIANGQI.isLegalMove(gameState.board, m.fromRow, m.fromCol, m.toRow, m.toCol, gameState.turn)) return false;
      gameState.isAIThinking = false;
      await executeMove(m.fromRow, m.fromCol, m.toRow, m.toCol, true);
      return true;
    } catch (e) {
      console.error('Engine move error:', e);
      return false;
    } finally {
      if (id === gameState.gameId) {
        gameState.isAIThinking = false;
        if (statusMsg && statusMsg.textContent.startsWith('🤖')) statusMsg.textContent = '';
      }
    }
  }

  let autoPlayRun = 0;   // identifies the running loop, so an old one never switches off a newer one

  async function runEngineAutoPlay() {
    const id = gameState.gameId;
    const run = ++autoPlayRun;
    while (engineAutoPlay && run === autoPlayRun && id === gameState.gameId && canEnginePlay()) {
      while ((gameState.isMoving || gameState.isAIThinking) && engineAutoPlay && run === autoPlayRun && id === gameState.gameId && canEnginePlay()) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (!engineAutoPlay || run !== autoPlayRun || id !== gameState.gameId || !canEnginePlay()) break;

      // If playing for a specific side, wait until it becomes that side's turn
      if (engineAutoPlaySide !== 'both' && gameState.turn !== engineAutoPlaySide) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      if (!(await requestEngineMove()) || !canEnginePlay()) break;   // failed, or the game just ended
      await new Promise(r => setTimeout(r, AUTOPLAY_PAUSE_MS));
    }
    if (run === autoPlayRun) setEngineAutoPlay(false);   // finished, failed or interrupted
  }

  function openEngineMoveModal() {
    if (!canEnginePlay()) return;
    document.getElementById('engine-move-modal')?.classList.remove('hidden');
  }

  function closeEngineMoveModal() {
    document.getElementById('engine-move-modal')?.classList.add('hidden');
  }

  function handleEngineMoveClick() {
    if (engineAutoPlay) {
      setEngineAutoPlay(false);
      UI.showToast('Đã dừng máy', 'info');
      return;
    }
    openEngineMoveModal();
  }

  function startEngineAutoPlay(side = 'both') {
    closeEngineMoveModal();
    if (!canEnginePlay()) return;
    setEngineAutoPlay(true, side);
    runEngineAutoPlay();
    const sideLabels = { red: 'Chỉ quân Đỏ', black: 'Chỉ quân Đen', both: 'Cả hai bên' };
    UI.showToast(`Máy tự đi: ${sideLabels[side] || 'Bật'}`, 'info');
  }

  function toggleEngineAutoPlay(side = 'both') {
    if (engineAutoPlay) { setEngineAutoPlay(false); return; }
    if (!canEnginePlay()) return;
    startEngineAutoPlay(side);
  }

  // ===== UNDO =====
  function undoMove() {
    if (gameState.isAIThinking || gameState.isMoving) {
      UI.showToast('Vui lòng đợi AI đi xong', 'error');
      return;
    }
    const h = gameState.moveHistory;
    if (h.length === 0 || (gameState.mode === 'pvai' && h.length === 1 && h[0].turnBefore !== gameState.playerColor)) {
      UI.showToast('Không có nước đi để đi lại', 'error');
      return;
    }

    gameState.gameId++; setEngineAutoPlay(false);  // discard any in-flight analysis / hint

    // Undo one move; in PvAI keep going until it is the human's turn again
    let last = null;
    do {
      last = h.pop();
      gameState.boardHistory.pop();
    } while (gameState.mode === 'pvai' && h.length > 0 && last.turnBefore !== gameState.playerColor);

    gameState.board = gameState.boardHistory[gameState.boardHistory.length - 1].map(r => [...r]);
    gameState.turn = last.turnBefore;
    gameState.moveNumber = last.moveNumberBefore;
    gameState.viewIdx = -1;
    gameState.gameOver = false;

    UI.state.board = gameState.board;
    UI.state.mode = gameState.mode;
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.state.hintMove = null;
    UI.state.analysisVariations = null;
    const prev = h[h.length - 1];
    UI.state.lastMove = prev ? { fromRow: prev.fromRow, fromCol: prev.fromCol, toRow: prev.toRow, toCol: prev.toCol } : null;
    refreshMoveBadge();

    UI.updateTurnIndicator(gameState.turn, XIANGQI.isInCheck(gameState.board, gameState.turn));
    UI.updateMoveHistory(h, h.length - 1);
    updateNavButtons();
    clearAnalysisPanel();
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = '';
    UI.render();
    UI.showToast('Đã đi lại', 'info');
  }

  // ===== NAVIGATION =====
  // gameState.board always holds the live position; only UI.state.board changes while browsing.
  const viewedPly = () => gameState.viewIdx < 0 ? gameState.moveHistory.length : gameState.viewIdx;

  function updateNavButtons() {
    const total = gameState.moveHistory.length;
    const ply = viewedPly();
    const set = (id, disabled) => { const el = document.getElementById(id); if (el) el.disabled = disabled; };
    set('hist-first', total === 0 || ply === 0);
    set('hist-prev', total === 0 || ply === 0);
    set('hist-next', total === 0 || ply >= total);
    set('hist-last', total === 0 || ply >= total);
  }

  // The badge on the piece that made the viewed move (set once that move has been evaluated)
  function refreshMoveBadge() {
    if (gameState.viewIdx >= 0) {
      const idx = gameState.viewIdx;
      const m = idx > 0 ? gameState.moveHistory[idx - 1] : null;
      UI.state.moveBadge = (m && m.quality) ? { row: m.toRow, col: m.toCol, quality: m.quality } : null;
      return;
    }
    // In live play (e.g. PvAI), the AI may move shortly after the player.
    // Keep the badge visible for the most recently evaluated move.
    for (let i = gameState.moveHistory.length - 1; i >= 0; i--) {
      const m = gameState.moveHistory[i];
      if (m && m.quality) {
        UI.state.moveBadge = { row: m.toRow, col: m.toCol, quality: m.quality };
        return;
      }
    }
    UI.state.moveBadge = null;
  }

  // Show the eval / quality of the move that led to the viewed position
  function showHistoricalAnalysis(idx) {
    const m = idx > 0 ? gameState.moveHistory[idx - 1] : null;
    if (!m || !m.quality) { clearAnalysisPanel(); UI.setEvalBar(idx === 0 ? 0 : null); return; }   // not judged: unknown
    // Stored scores are from the mover's point of view; the eval bar wants Red's.
    // Only re-display it: browsing must not add points to the history chart.
    UI.setEvalBar(m.turnBefore === 'red' ? m.scoreAfter : -m.scoreAfter);
    UI.showMoveQuality(m.quality, m.scoreAfter - m.scoreBefore, null);
  }

  function goToMove(idx) {
    // idx = number of moves applied (0 = start position)
    const len = gameState.moveHistory.length;
    idx = Math.max(0, Math.min(idx, len));
    if (idx === len) { returnToCurrentPosition(true); return; }

    gameState.viewIdx = idx;
    const viewBoard = gameState.boardHistory[idx].map(r => [...r]);
    UI.state.board = viewBoard;
    const m = idx > 0 ? gameState.moveHistory[idx - 1] : null;
    UI.state.lastMove = m ? { fromRow: m.fromRow, fromCol: m.fromCol, toRow: m.toRow, toCol: m.toCol } : null;
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.state.hintMove = null;
    UI.state.analysisVariations = null;

    refreshMoveBadge();
    const turnAtPly = gameState.moveHistory[idx].turnBefore;   // idx < len
    UI.updateTurnIndicator(turnAtPly, XIANGQI.isInCheck(viewBoard, turnAtPly));
    showHistoricalAnalysis(idx);
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.textContent = `Đang xem nước ${idx}/${len} (nhấn vào bàn cờ hoặc ⏭ để tiếp tục)`;

    UI.render();
    UI.updateMoveHistory(gameState.moveHistory, idx - 1);
    updateNavButtons();
  }

  function goToPrevMove() {
    const cur = viewedPly();
    if (cur > 0) goToMove(cur - 1);
  }

  function goToNextMove() {
    const cur = viewedPly();
    if (cur < gameState.moveHistory.length) goToMove(cur + 1);
  }

  function goToLastMove() {
    goToMove(gameState.moveHistory.length);
  }

  function returnToCurrentPosition(silent = false) {
    const wasViewing = gameState.viewIdx >= 0;
    gameState.viewIdx = -1;
    UI.state.board = gameState.board;
    UI.state.mode = gameState.mode;
    UI.state.selected = null;
    UI.state.legalMoves = [];
    UI.state.analysisVariations = null;
    const last = gameState.moveHistory[gameState.moveHistory.length - 1];
    UI.state.lastMove = last ? { fromRow: last.fromRow, fromCol: last.fromCol, toRow: last.toRow, toCol: last.toCol } : null;

    refreshMoveBadge();
    const inCheck = XIANGQI.isInCheck(gameState.board, gameState.turn);
    UI.updateTurnIndicator(gameState.turn, inCheck);
    if (last) showHistoricalAnalysis(gameState.moveHistory.length);
    const statusMsg = document.getElementById('status-message');
    if (statusMsg && wasViewing && !gameState.gameOver) {
      statusMsg.textContent = inCheck ? `${gameState.turn === 'red' ? 'Đỏ' : 'Đen'} đang bị chiếu!` : '';
    }
    UI.render();
    UI.updateMoveHistory(gameState.moveHistory, gameState.moveHistory.length - 1);
    updateNavButtons();
    if (wasViewing && !silent) UI.showToast('Đã quay về vị trí hiện tại', 'info');
  }

  // ===== SETTINGS =====
  // ===== MAIN MENU =====
  const MODE_NAMES = { pvai: 'Người vs Máy', pvp: 'Người vs Người', analyze: 'Phân tích' };
  const LEVEL_LABELS = ['', 'Rất dễ', 'Dễ', 'Dễ', 'Trung bình', 'Trung bình', 'Khó', 'Khó', 'Rất khó', 'Chuyên gia', 'Cao thủ'];

  const isMenuOpen = () => {
    const menu = document.getElementById('main-menu');
    return !!menu && !menu.classList.contains('hidden');
  };

  function showMenu() {
    document.getElementById('app-header')?.classList.remove('hidden');
    document.getElementById('main-menu')?.classList.remove('hidden');
    document.getElementById('menu-resume')?.classList.toggle('hidden', !gameState.modeChosen);   // nothing to go back to yet
    if (document.body) document.body.classList.add('menu-open');
  }

  function hideMenu() {
    document.getElementById('main-menu')?.classList.add('hidden');
    if (gameState.modeChosen) {
      document.getElementById('app-header')?.classList.add('hidden');
    }
    if (document.body) document.body.classList.remove('menu-open');
  }

  // The chip above the board: current mode (and AI level), tap to open the menu
  function updateModeChip() {
    const el = document.getElementById('mode-chip-text');
    if (!el) return;
    el.textContent = gameState.mode === 'pvai'
      ? `${MODE_NAMES.pvai} · ${LEVEL_LABELS[Math.min(gameState.aiLevel, LEVEL_LABELS.length - 1)]}`
      : MODE_NAMES[gameState.mode];
  }

  // ===== SETTINGS =====
  // Choosing a mode ALWAYS starts a fresh game (also when it is the mode already in use).
  function setMode(mode, fen = null) {
    gameState.mode = mode;
    gameState.modeChosen = true;
    UI.state.mode = mode;
    document.getElementById('app-header')?.classList.add('hidden');
    // Anything in flight (AI thinking, hints, analysis) belonged to the previous game
    gameState.gameId++; setEngineAutoPlay(false);
    gameState.isAIThinking = false;

    ['pvai', 'pvp', 'analyze'].forEach(m => {
      document.getElementById(`mode-${m === 'analyze' ? 'analyze-play' : m}`)?.classList.toggle('active', m === mode);
    });

    const isAnalyze = mode === 'analyze';
    document.getElementById('player-card-red')?.classList.toggle('hidden', isAnalyze);
    document.getElementById('player-card-black')?.classList.toggle('hidden', isAnalyze);
    const redNameEl = document.getElementById('red-player-name');
    const blackNameEl = document.getElementById('black-player-name');
    if (mode === 'pvp') {
      if (redNameEl) redNameEl.textContent = 'Người chơi 1';
      if (blackNameEl) blackNameEl.textContent = 'Người chơi 2';
    } else if (mode === 'pvai') {
      if (redNameEl) redNameEl.textContent = gameState.playerColor === 'red' ? 'Người chơi' : 'AI';
      if (blackNameEl) blackNameEl.textContent = gameState.playerColor === 'black' ? 'Người chơi' : 'AI';
    }
    document.getElementById('analyze-mode-panel')?.classList.toggle('hidden', !isAnalyze);
    document.getElementById('main-analysis-card')?.classList.toggle('hidden', !isAnalyze);
    document.getElementById('move-analysis-card')?.classList.toggle('hidden', isAnalyze);
    document.getElementById('btn-engine-move')?.classList.toggle('hidden', !isAnalyze);
    document.getElementById('btn-hint')?.classList.toggle('hidden', isAnalyze);   // replaced by the suggestions panel
    if (window.boardEditor) window.boardEditor.setActive(isAnalyze);

    updateModeChip();
    hideMenu();
    newGame(fen);          // reset the board; the AI opens if the human plays Black; analysis mode syncs the editor
    UI.showToast(`Chế độ: ${MODE_NAMES[mode]} — ván mới`, 'info');
  }

  function setAILevel(level) {
    gameState.aiLevel = parseInt(level);
    const valueEl = document.getElementById('level-value');
    if (valueEl) valueEl.textContent = level;
    const lbl = document.getElementById('level-label');
    if (lbl) lbl.textContent = LEVEL_LABELS[Math.min(level, LEVEL_LABELS.length - 1)];
    updateModeChip();
  }

  // Settings only: the colour applies to the next game started from the menu
  function setPlayerColor(color) {
    gameState.playerColor = color;
    document.getElementById('color-red')?.classList.toggle('active', color === 'red');
    document.getElementById('color-black')?.classList.toggle('active', color === 'black');
    const redNameEl = document.getElementById('red-player-name');
    const blackNameEl = document.getElementById('black-player-name');
    if (redNameEl) redNameEl.textContent = color === 'red' ? 'Người chơi' : 'AI';
    if (blackNameEl) blackNameEl.textContent = color === 'black' ? 'Người chơi' : 'AI';
  }

  function flipBoard() {
    UI.state.flipped = !UI.state.flipped;
    UI.render();
  }

  function toggleAnalysis() {
    gameState.analysisEnabled = !gameState.analysisEnabled;
    const btn = document.getElementById('btn-analysis');
    if (btn) btn.classList.toggle('active', gameState.analysisEnabled);
    UI.showToast(gameState.analysisEnabled ? 'Phân tích bật' : 'Phân tích tắt', 'info');
  }

  // ===== GAME OVER =====
  function showGameOver(title, subtitle, winner) {
    const modal = document.getElementById('game-over-modal');
    const titleEl = document.getElementById('modal-title');
    const subEl = document.getElementById('modal-subtitle');
    const iconEl = document.getElementById('modal-icon');
    const statsEl = document.getElementById('modal-stats');

    if (!modal) return;
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (iconEl) iconEl.textContent = winner === null ? '🤝' : '🏆';

    // Stats
    const totalMoves = gameState.moveHistory.length;
    const blunders = gameState.moveHistory.filter(m => m.quality?.key === 'blunder').length;
    const mistakes = gameState.moveHistory.filter(m => m.quality?.key === 'mistake').length;
    const brilliant = gameState.moveHistory.filter(m => m.quality?.key === 'brilliant').length;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="modal-stat"><div class="modal-stat-val">${totalMoves}</div><div class="modal-stat-lbl">Nước đi</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${brilliant}</div><div class="modal-stat-lbl">✨ Tuyệt diệu</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${mistakes}</div><div class="modal-stat-lbl">? Sai lầm</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${blunders}</div><div class="modal-stat-lbl">?? Sai lầm lớn</div></div>
      `;
    }

    modal.classList.remove('hidden');
  }

  // ===== EVENT LISTENERS =====
  function setupEventListeners() {
    // Board click
    UI.canvas.addEventListener('click', (e) => {
      const pos = UI.getClickPos(e);
      if (pos) handleSquareClick(pos.row, pos.col);
    });

    // Modal backdrop click
    document.getElementById('engine-move-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'engine-move-modal') closeEngineMoveModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (isMenuOpen()) {                                       // the menu owns the keyboard
        if (e.key === 'Escape' && gameState.modeChosen) hideMenu();
        return;
      }
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); goToPrevMove(); break;
        case 'ArrowRight': e.preventDefault(); goToNextMove(); break;
        case 'ArrowUp': e.preventDefault(); goToMove(0); break;
        case 'ArrowDown': e.preventDefault(); goToLastMove(); break;
        case 'z': case 'Z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); undoMove(); } break;
        case 'h': case 'H': requestHint(); break;
        case 'f': case 'F': flipBoard(); break;
        case 'Escape': {
          closeEngineMoveModal();
          UI.state.selected = null;
          UI.state.legalMoves = [];
          UI.state.hintMove = null;
          UI.state.analysisVariations = null;
          UI.render();
          break;
        }
      }
    });
  }

  // ===== NAVIGATION =====
  function setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${view}`)?.classList.add('active');
      });
    });
  }

  // ===== LESSONS =====
  const DIFFICULTY_LABELS = { beginner: 'Cơ bản', intermediate: 'Trung cấp', advanced: 'Nâng cao' };

  function setupLessons() {
    const grid = document.getElementById('lessons-grid');
    if (!grid) return;

    grid.innerHTML = '';
    LESSONS.forEach((l, i) => {
      const card = document.createElement('div');
      card.className = 'lesson-card';
      card.innerHTML = `
        <div class="lesson-icon">${l.icon}</div>
        <div class="lesson-title">${l.title}</div>
        <div class="lesson-desc">${l.desc}</div>
        <span class="lesson-difficulty diff-${l.difficulty}">${DIFFICULTY_LABELS[l.difficulty]}</span>
      `;
      card.addEventListener('click', () => loadLesson(LESSONS[i].fen));
      grid.appendChild(card);
    });
  }

  function loadLesson(fen) {
    // Navigate to game view
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('nav-play')?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-game')?.classList.add('active');

    setMode('analyze', fen);   // fresh analysis game; null = standard opening position
    if (window.boardEditor) window.boardEditor.setSubMode('play');   // lessons are for analysing, not setting up
    UI.showToast('Đã tải bài học. Hãy phân tích!', 'info');
  }

  return {
    init, newGame, loadFEN, copyFEN,
    undoMove, requestHint, requestEngineMove, toggleEngineAutoPlay, stopEngineAutoPlay: () => setEngineAutoPlay(false), isEngineAutoPlay: () => engineAutoPlay, flipBoard, toggleAnalysis,
    handleEngineMoveClick, startEngineAutoPlay, openEngineMoveModal, closeEngineMoveModal, getEngineAutoPlaySide: () => engineAutoPlaySide,
    setMode, setAILevel, setPlayerColor, showMenu, hideMenu,
    goToMove, goToPrevMove, goToNextMove, goToLastMove, returnToCurrentPosition,
    executeMove, setPosition,
    loadLesson,
    getState: () => gameState,
  };
})();

// ===== BOOT =====
window.game = Game;
window.addEventListener('DOMContentLoaded', () => {
  Game.init();
});
