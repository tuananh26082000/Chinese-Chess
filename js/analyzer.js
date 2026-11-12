/**
 * analyzer.js - Full game analysis module
 * Analyzes complete games move by move
 */

const Analyzer = (() => {

  let isAnalyzing = false;
  let analysisResults = [];

  async function startAnalysis() {
    if (isAnalyzing) return;

    const fenInput = document.getElementById('analyze-fen');
    const movesInput = document.getElementById('analyze-moves');
    const resultsEl = document.getElementById('analyze-results');

    const fen = fenInput?.value.trim() || XIANGQI.DEFAULT_FEN;
    const movesText = movesInput?.value.trim() || '';

    if (!Engine.isReady()) {
      UI.showToast('Engine chưa sẵn sàng', 'error');
      return;
    }

    isAnalyzing = true;
    analysisResults = [];

    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="analyze-progress">
          <div class="analyze-progress-bar">
            <div class="analyze-progress-fill" id="analysis-progress-fill"></div>
          </div>
          <p id="analysis-progress-text">Đang phân tích ván cờ...</p>
        </div>
      `;
    }

    try {
      const parsed = XIANGQI.parseFEN(fen);
      let board = parsed.board;
      let turn = parsed.turn;

      const tokens = movesText.split(/\s+/).filter(Boolean);
      const bad = tokens.find(t => !XIANGQI.parseUCI(t));
      if (bad) throw new Error(`Nước đi không đúng định dạng: ${bad}`);
      const moves = tokens;
      const total = moves.length;

      const stats = { brilliant: 0, great: 0, good: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 };

      for (let i = 0; i < moves.length; i++) {
        const uci = moves[i];
        const m = XIANGQI.parseUCI(uci);
        if (!XIANGQI.isLegalMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol, turn)) {
          throw new Error(`Nước ${i + 1} (${uci}) không hợp lệ trong thế cờ này`);
        }

        // Update progress
        const pct = Math.round((i / total) * 100);
        const fillEl = document.getElementById('analysis-progress-fill');
        const textEl = document.getElementById('analysis-progress-text');
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (textEl) textEl.textContent = `Đang phân tích nước ${i+1}/${total}...`;

        const currentFen = XIANGQI.boardToFEN(board, turn, Math.floor(i/2)+1);

        // Get engine eval before move
        const beforeResult = await Engine.analyzePosition(currentFen, 6);
        const bestMove = beforeResult.bestMove;
        const bestScore = beforeResult.score;

        // Apply move
        const newBoard = XIANGQI.applyMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol);
        const nextTurn = turn === 'red' ? 'black' : 'red';
        const afterFen = XIANGQI.boardToFEN(newBoard, nextTurn, Math.floor(i/2)+1);

        // Get eval after move
        const afterResult = await Engine.analyzePosition(afterFen, 6);
        const scoreAfter = -afterResult.score;

        // Quality
        const isBest = (uci === bestMove);
        const quality = Engine.classifyMoveQuality(bestScore, scoreAfter, isBest);
        stats[quality.key] = (stats[quality.key] || 0) + 1;

        const evalDelta = isBest && scoreAfter < bestScore ? 0 : (scoreAfter - bestScore);
        const vn = XIANGQI.moveToVietnamese(board, m.fromRow, m.fromCol, m.toRow, m.toCol);
        const bestVn = bestMove && bestMove !== '(none)'
          ? XIANGQI.uciToVietnamese(board, bestMove)
          : '';

        analysisResults.push({
          moveNum: parsed.moveNum + Math.floor((i + (parsed.turn === 'black' ? 1 : 0)) / 2),
          color: turn,
          uci, vn, chinese: vn, quality,
          scoreBefore: bestScore,
          scoreAfter,
          evalDelta,
          bestMove,
          bestVn,
          fen: currentFen,
        });

        board = newBoard;
        turn = nextTurn;

        // Small delay to not block UI
        await new Promise(r => setTimeout(r, 10));
      }

      displayResults(analysisResults, stats);
    } catch (e) {
      console.error('Analysis error:', e);
      if (resultsEl) {
        const p = document.createElement('p');
        p.style.color = 'var(--accent-red)';
        p.textContent = `Lỗi phân tích: ${e.message}`;
        resultsEl.replaceChildren(p);
      }
    }

    isAnalyzing = false;
  }

  function displayResults(results, stats) {
    const resultsEl = document.getElementById('analyze-results');
    if (!resultsEl) return;

    const total = results.length;
    const accuracy = total > 0
      ? Math.round(((stats.brilliant||0) + (stats.great||0) + (stats.good||0) + (stats.ok||0)) / total * 100)
      : 0;

    resultsEl.innerHTML = `
      <div class="analysis-summary">
        <h3>📊 Kết quả phân tích</h3>
        <div class="accuracy-ring">
          <div class="accuracy-score">${accuracy}%</div>
          <div class="accuracy-label">Độ chính xác</div>
        </div>
        <div class="stats-grid">
          <div class="stat-item brilliant-stat">
            <span class="stat-count">${stats.brilliant||0}</span>
            <span class="stat-label">✨ Tuyệt diệu</span>
          </div>
          <div class="stat-item great-stat">
            <span class="stat-count">${stats.great||0}</span>
            <span class="stat-label">⭐ Rất tốt</span>
          </div>
          <div class="stat-item good-stat">
            <span class="stat-count">${stats.good||0}</span>
            <span class="stat-label">✓ Tốt</span>
          </div>
          <div class="stat-item ok-stat">
            <span class="stat-count">${stats.ok||0}</span>
            <span class="stat-label">— Ổn</span>
          </div>
          <div class="stat-item inaccuracy-stat">
            <span class="stat-count">${stats.inaccuracy||0}</span>
            <span class="stat-label">?! Thiếu CX</span>
          </div>
          <div class="stat-item mistake-stat">
            <span class="stat-count">${stats.mistake||0}</span>
            <span class="stat-label">? Sai lầm</span>
          </div>
          <div class="stat-item blunder-stat">
            <span class="stat-count">${stats.blunder||0}</span>
            <span class="stat-label">?? SL lớn</span>
          </div>
        </div>
      </div>
      <div class="moves-analysis-list">
        <h4>Chi tiết từng nước đi</h4>
        ${results.map(r => renderMoveItem(r)).join('')}
      </div>
    `;
  }

  function renderMoveItem(r) {
    const colorLabel = r.color === 'red' ? '🔴' : '⚫';
    const dotColor = `quality-${r.quality.key}`;
    const evalDisplay = Math.abs(r.evalDelta) < 10 ? '±0' :
      `${r.evalDelta > 0 ? '+' : ''}${(r.evalDelta/100).toFixed(1)}`;

    return `
      <div class="analysis-move-item ${dotColor}">
        <span class="analysis-move-num">${r.moveNum}${r.color === 'black' ? '...' : '.'}</span>
        <span class="quality-dot" style="background:var(--quality-${r.quality.key})"></span>
        <span class="analysis-move-text" style="font-weight:700;font-size:15px;color:var(--text-primary);">${r.vn || r.uci}</span>
        <span class="quality-badge-sm quality-${r.quality.key}">${r.quality.emoji}</span>
        <span class="analysis-move-eval">${evalDisplay}</span>
        ${r.bestMove && r.bestMove !== r.uci ? `<span class="best-alt">💡 ${r.bestVn || r.bestMove}</span>` : ''}
      </div>
    `;
  }

  return { startAnalysis, displayResults };
})();

window.analyzer = Analyzer;
