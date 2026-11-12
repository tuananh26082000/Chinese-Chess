/**
 * engine.js - Fairy-Stockfish WebAssembly Engine Integration
 * Connects to the bundled engine/worker.js (Fairy-Stockfish WASM) via a Web Worker.
 * Falls back to a built-in alpha-beta search if the engine is not available
 * (e.g. no SharedArrayBuffer: the page must be served with COOP/COEP headers, see _headers / server.py)
 *
 * Score convention: every score returned by this module is in centipawns from the
 * point of view of the SIDE TO MOVE in the given position (UCI convention),
 * except evalBoard(), which is from Red's point of view.
 */

const Engine = (() => {

  const MATE = 99000;

  let worker = null;
  let isReady = false;
  let current = null;       // job currently running in the worker
  let ignoreBestmove = 0;   // bestmove lines still owed by searches we gave up on
  let chain = Promise.resolve();

  const statusEl = document.getElementById('engine-status');
  const statusTextEl = statusEl ? statusEl.querySelector('.status-text') : null;

  function setStatus(state, text) {
    if (!statusEl) return;
    statusEl.className = `engine-status ${state}`;
    if (statusTextEl) statusTextEl.textContent = text;
  }

  async function init() {
    setStatus('loading', 'Đang tải engine...');

    // Fairy-Stockfish WASM needs SharedArrayBuffer (cross-origin isolation: COOP + COEP headers).
    if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) {
      console.warn('SharedArrayBuffer unavailable (serve with COOP/COEP headers), using built-in engine');
      useFallback();
      return false;
    }

    return new Promise((resolve) => {
      try {
        worker = new Worker('engine/worker.js');

        const readyTimeout = setTimeout(() => {
          console.warn('Engine timeout, using fallback');
          useFallback();
          resolve(false);
        }, 12000);

        worker.onmessage = (e) => {
          const line = e.data;
          if (line === 'readyok') {
            clearTimeout(readyTimeout);
            isReady = true;
            setStatus('ready', 'Engine sẵn sàng');
            resolve(true);
          } else if (typeof line === 'string' && line.startsWith('ERROR')) {
            clearTimeout(readyTimeout);
            console.warn('Fairy-Stockfish load failed:', line);
            useFallback();
            resolve(false);
          } else {
            handleEngineOutput(line);
          }
        };

        worker.onerror = (err) => {
          clearTimeout(readyTimeout);
          console.warn('Worker error, using fallback:', err);
          useFallback();
          resolve(false);
        };

        // The worker queues these until the WASM module has finished loading
        worker.postMessage('uci');
        worker.postMessage('setoption name UCI_Variant value xiangqi');
        worker.postMessage('isready');
      } catch (e) {
        console.warn('Failed to start worker:', e);
        useFallback();
        resolve(false);
      }
    });
  }

  function useFallback() {
    isReady = true;
    if (worker) { worker.terminate(); }
    worker = null;
    setStatus('ready', 'Engine nội bộ (yếu hơn)');
    console.log('Using built-in alpha-beta engine');
  }

  function handleEngineOutput(line) {
    if (typeof line !== 'string') return;

    if (line.startsWith('info') && current) {
      const depthMatch = line.match(/\bdepth (\d+)/);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      if (depthMatch && scoreMatch) {
        const n = parseInt(scoreMatch[2]);
        const isMate = scoreMatch[1] === 'mate';
        const multipvMatch = line.match(/\bmultipv (\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)/);
        const info = {
          depth: parseInt(depthMatch[1]),
          score: isMate ? (n > 0 ? 1 : -1) * (MATE - Math.abs(n)) : n,
          type: scoreMatch[1],
          mateIn: isMate ? n : null,
          multipv: multipvMatch ? parseInt(multipvMatch[1]) : 1,
          pv: pvMatch ? pvMatch[1].trim().split(/\s+/).filter(m => XIANGQI.parseUCI(m)) : [],
        };
        if (info.multipv === 1) current.last = info;
        if (current.onInfo) current.onInfo(info);
      }
    }

    if (line.startsWith('bestmove')) {
      if (ignoreBestmove > 0) { ignoreBestmove--; return; }
      if (!current) return;
      const job = current;
      current = null;
      const move = line.split(' ')[1];
      job.finish({
        bestMove: move && move !== '(none)' ? move : null,
        score: job.last ? job.last.score : null,
      });
    }
  }

  // Run one search in the worker. Resolves with {bestMove, score} or null on failure.
  function runWorkerSearch(fen, goCmd, softLimitMs, onInfo, multiPV = 1, interruptible = false) {
    return new Promise((resolve) => {
      let timers = [];
      const job = {
        last: null, onInfo, interruptible,
        finish: (result) => { timers.forEach(clearTimeout); resolve(result); },
      };
      current = job;
      worker.postMessage(`setoption name MultiPV value ${multiPV}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(goCmd);

      timers.push(setTimeout(() => {
        if (current !== job) return;
        worker.postMessage('stop');
        timers.push(setTimeout(() => {
          if (current !== job) return;
          current = null;
          ignoreBestmove++;  // the stopped search will still print a bestmove later
          timers.forEach(clearTimeout);
          resolve(null);
        }, 2000));
      }, softLimitMs));
    });
  }

  // Serialise engine requests: the worker can only run one search at a time.
  function enqueue(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  // ===== Variety: do not always answer the same way =====

  /**
   * How much weaker than the best move the AI may play, by difficulty level (1-10).
   *  - Level 10 is the "most accurate" setting: margin 0 = it always plays the engine's best move.
   *  - Every level below allows a wider margin (level 9: 25 cp ... level 1: 185 cp), so weaker bots vary more.
   *  - The opening (first 10 plies) is a little wider so games start differently, except at level 10.
   * Returns { margin (centipawns; 0 = no variety), candidates (how many lines to consider) }.
   */
  function varietyForLevel(level, plyCount = 0) {
    const n = Number(level);
    const lvl = Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;      // unusable input = middle level
    if (lvl >= 10) return { margin: 0, candidates: 1 };
    const base = 25 + (9 - lvl) * 20;
    const opening = plyCount < 10 ? 30 : 0;
    return { margin: base + opening, candidates: 4 };
  }

  /**
   * Choose among candidate moves [{ move, score }] (best first, scores from the mover's view).
   * Only moves within `margin` centipawns of the best are eligible; a better move is likelier
   * (weight e^(-loss / (margin/2))). Never trades a forced win for variety, and never picks a move
   * that walks into a forced mate. opts.rng (0 <= r < 1) can be injected for tests.
   */
  function pickMove(candidates, { margin = 0, rng = Math.random } = {}) {
    if (!candidates || candidates.length === 0) return null;
    const best = candidates[0];
    if (candidates.length === 1 || margin <= 0 || Math.abs(best.score) > MATE - 100) return best.move;

    const pool = candidates.filter(c => best.score - c.score <= margin && c.score > -(MATE - 100));
    if (pool.length <= 1) return best.move;
    const weights = pool.map(c => Math.exp(-(best.score - c.score) / (margin / 2)));
    let r = Math.min(Math.max(rng(), 0), 0.999999999) * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) return pool[i].move;
    }
    return pool[pool.length - 1].move;
  }

  // Get best move (UCI string, or null if the side to move has no moves).
  // opts.variety ({ margin, candidates } from varietyForLevel) makes the answer vary between games.
  function getBestMove(fen, depth = 10, timeMs = 1500, opts = {}) {
    if (!isReady) return Promise.reject(new Error('Engine not ready'));
    const variety = opts.variety && opts.variety.margin > 0 ? opts.variety : null;
    return enqueue(async () => {
      if (worker) {
        const lines = {};                              // multipv rank -> { move, score, depth }
        const onInfo = variety ? (info) => {
          if (info.pv.length === 0) return;
          const prev = lines[info.multipv];
          if (!prev || prev.depth <= info.depth) lines[info.multipv] = { move: info.pv[0], score: info.score, depth: info.depth };
        } : undefined;
        const res = await runWorkerSearch(fen, `go depth ${depth} movetime ${timeMs}`, timeMs + 1000, onInfo, variety ? variety.candidates : 1);
        if (res) {
          if (variety) {
            const candidates = Object.values(lines).sort((a, b) => b.score - a.score);
            const picked = pickMove(candidates, { margin: variety.margin, rng: opts.rng });
            if (picked) return picked;
          }
          return res.bestMove;
        }
      }
      const parsed = XIANGQI.parseFEN(fen);
      const res = searchFallback(parsed.board, parsed.turn, fallbackDepth(depth), Math.min(timeMs, 2000), variety);
      if (variety && res.candidates) return pickMove(res.candidates, { margin: variety.margin, rng: opts.rng }) || res.bestMove;
      return res.bestMove;
    });
  }

  // Analyse a position -> { score (side to move POV), bestMove }
  function analyzePosition(fen, depth = 12, callback) {
    if (!isReady) return Promise.reject(new Error('Engine not ready'));
    return enqueue(async () => {
      if (worker) {
        const res = await runWorkerSearch(fen, `go depth ${depth}`, 5000, callback);
        if (res && res.score !== null) return res;
      }
      const parsed = XIANGQI.parseFEN(fen);
      const res = searchFallback(parsed.board, parsed.turn, fallbackDepth(depth), 1200);
      if (callback) callback({ depth: res.depth, score: res.score, pv: res.bestMove ? [res.bestMove] : [], type: 'cp' });
      return { score: res.score, bestMove: res.bestMove };
    });
  }

  /**
   * Top `numVariations` lines with the opponent's replies (MultiPV).
   * onProgress(variations) is called as deeper results arrive (real engine only).
   * opts.shouldAbort(): return true when the caller no longer wants the result; a queued request is
   * skipped and a running search is stopped, so rapid edits don't pile up engine work.
   * Resolves { variations, bestMove, aborted }. Scores are from the side to move's point of view.
   */
  function analyzeMultiPV(fen, depth = 10, numVariations = 3, onProgress, opts = {}) {
    if (!isReady) return Promise.reject(new Error('Engine not ready'));
    const shouldAbort = opts.shouldAbort || (() => false);
    return enqueue(async () => {
      if (shouldAbort()) return { variations: [], bestMove: null, aborted: true };

      const byRank = {};
      const sorted = () => Object.values(byRank).sort((a, b) => a.rank - b.rank);

      if (worker) {
        const res = await runWorkerSearch(fen, `go depth ${depth}`, 4000, (info) => {
          if (shouldAbort()) { worker.postMessage('stop'); return; }
          if (info.pv.length === 0) return;
          const prev = byRank[info.multipv];
          if (prev && prev.depth > info.depth) return;
          byRank[info.multipv] = makeVariationFromInfo(info);
          if (onProgress) onProgress(sorted());
        }, numVariations, true);   // candidate-line analysis may be interrupted by a newer request
        if (res || Object.keys(byRank).length > 0) {
          const variations = sorted();
          return { variations, bestMove: variations[0] ? variations[0].firstMove : (res && res.bestMove), aborted: shouldAbort() };
        }
      }

      const parsed = XIANGQI.parseFEN(fen);
      const variations = fallbackMultiPV(parsed.board, parsed.turn, numVariations, Math.min(fallbackDepth(depth), 3), 1500);
      if (onProgress && variations.length) onProgress(variations);
      return { variations, bestMove: variations[0] ? variations[0].firstMove : null, aborted: false };
    });
  }

  function makeVariationFromInfo(info) {
    const isMate = info.type === 'mate';
    return {
      rank: info.multipv, score: info.score, scoreType: info.type, isMate,
      mateIn: isMate ? info.mateIn : 0,
      depth: info.depth, pv: info.pv,
      firstMove: info.pv[0], counterMove: info.pv[1] || null, followupMove: info.pv[2] || null,
    };
  }

  // Interrupt the running candidate-line analysis (analyzeMultiPV). Other searches (judging a move,
  // the AI's move, a hint) are never cut short by it, otherwise their results would be wrong.
  function stopAnalysis() {
    if (worker && current && current.interruptible) worker.postMessage('stop');
  }

  function setOption(name, value) {
    if (worker) worker.postMessage(`setoption name ${name} value ${value}`);
  }

  // ===== BUILT-IN ALPHA-BETA FALLBACK =====

  // Static evaluation from Red's point of view: material + pawn advancement
  function evalBoard(board) {
    let score = XIANGQI.materialScore(board);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p === 'P') score += (6 - r) * 8 + (r < 5 ? 20 : 0);
        else if (p === 'p') score -= (r - 3) * 8 + (r > 4 ? 20 : 0);
      }
    }
    return score;
  }

  function evalSide(board, color) {
    const s = evalBoard(board);
    return color === 'red' ? s : -s;
  }

  // Map the UI "depth" (3..12 for the real engine) to something the JS search can afford
  function fallbackDepth(depth) {
    if (depth <= 4) return 2;
    if (depth <= 7) return 3;
    return 4;
  }

  class SearchAbort extends Error {}

  function orderMoves(board, moves) {
    const val = (m) => {
      const t = board[m.toRow][m.toCol];
      return t ? 10 * XIANGQI.PIECE_VALUES[t.toLowerCase()] - XIANGQI.PIECE_VALUES[board[m.fromRow][m.fromCol].toLowerCase()] : 0;
    };
    return moves.map(m => [val(m), m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }

  const opposite = (color) => color === 'red' ? 'black' : 'red';
  const uciOf = (m) => XIANGQI.moveToUCI(m.fromRow, m.fromCol, m.toRow, m.toCol);

  // Alpha-beta searcher working in place on a private copy of the board (make/unmake).
  // Throws SearchAbort once the time budget is spent.
  function createSearcher(rootBoard, timeMs) {
    const board = rootBoard.map(r => [...r]);
    const deadline = Date.now() + timeMs;
    let nodes = 0;

    const tick = () => {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new SearchAbort();
    };

    function make(m) {
      const cap = board[m.toRow][m.toCol];
      board[m.toRow][m.toCol] = board[m.fromRow][m.fromCol];
      board[m.fromRow][m.fromCol] = null;
      return cap;
    }
    function unmake(m, cap) {
      board[m.fromRow][m.fromCol] = board[m.toRow][m.toCol];
      board[m.toRow][m.toCol] = cap;
    }

    function quiesce(side, alpha, beta, qd) {
      tick();
      const stand = evalSide(board, side);
      if (stand >= beta) return beta;
      if (qd === 0) return stand;
      if (stand > alpha) alpha = stand;
      const caps = XIANGQI.getLegalMoves(board, side).filter(m => board[m.toRow][m.toCol]);
      const next = opposite(side);
      for (const m of orderMoves(board, caps)) {
        const cap = make(m);
        const score = -quiesce(next, -beta, -alpha, qd - 1);
        unmake(m, cap);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    function negamax(side, depth, alpha, beta, ply) {
      tick();
      const moves = XIANGQI.getLegalMoves(board, side);
      if (moves.length === 0) return -(MATE - ply);  // no legal move = loss in xiangqi
      if (depth === 0) return quiesce(side, alpha, beta, 4);
      const next = opposite(side);
      for (const m of orderMoves(board, moves)) {
        const cap = make(m);
        const score = -negamax(next, depth - 1, -beta, -alpha, ply + 1);
        unmake(m, cap);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    return { board, make, unmake, negamax };
  }

  function searchFallback(rootBoard, color, maxDepth, timeMs, variety = null) {
    const s = createSearcher(rootBoard, timeMs);

    // Shuffle first: orderMoves is a stable sort, so equal-valued moves keep this random order
    // (variety without perturbing scores, which would break alpha-beta bounds)
    const shuffled = XIANGQI.getLegalMoves(s.board, color);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let rootMoves = orderMoves(s.board, shuffled);
    if (rootMoves.length === 0) return { bestMove: null, score: -MATE, depth: 0 };

    let best = { move: rootMoves[0], score: 0, depth: 0 };
    const next = opposite(color);

    try {
      for (let d = 1; d <= maxDepth; d++) {
        let alpha = -Infinity, bestHere = null, bestScore = -Infinity;
        for (const m of rootMoves) {
          const cap = s.make(m);
          const score = -s.negamax(next, d - 1, -Infinity, -alpha, 1);
          s.unmake(m, cap);
          if (score > bestScore) { bestScore = score; bestHere = m; }
          if (score > alpha) alpha = score;
        }
        best = { move: bestHere, score: bestScore, depth: d };
        rootMoves = [bestHere, ...rootMoves.filter(m => m !== bestHere)];  // search best first next iteration
        if (Math.abs(bestScore) > MATE - 100) break;
      }
    } catch (e) {
      if (!(e instanceof SearchAbort)) throw e;
    }

    const result = { bestMove: uciOf(best.move), score: best.score, depth: best.depth };

    // Variety: also find the other moves that are at most `margin` worse than the best one.
    // A second, narrow-window search per move: it is cheap because most moves fail low at once.
    if (variety && rootMoves.length > 1 && Math.abs(best.score) <= MATE - 100) {
      const s2 = createSearcher(rootBoard, Math.max(150, Math.floor(timeMs * 0.5)));
      const lo = best.score - variety.margin - 1, hi = best.score + 1;
      const depth = Math.max(1, best.depth);
      const candidates = [{ move: result.bestMove, score: best.score }];
      try {
        for (const m of rootMoves) {
          if (m === best.move) continue;
          const cap = s2.make(m);
          const v = -s2.negamax(next, depth - 1, -hi, -lo, 1);
          s2.unmake(m, cap);
          if (v > lo) candidates.push({ move: uciOf(m), score: Math.min(v, best.score) });
        }
      } catch (e) {
        if (!(e instanceof SearchAbort)) throw e;     // out of time: keep what was found
      }
      result.candidates = candidates.sort((a, b) => b.score - a.score);
    }
    return result;
  }

  // Shape shared with the real engine's MultiPV output
  function makeVariation(rank, score, depth, pv) {
    const isMate = Math.abs(score) > MATE - 100;
    return {
      rank, score, scoreType: isMate ? 'mate' : 'cp', isMate,
      mateIn: isMate ? Math.sign(score) * Math.max(1, Math.ceil((MATE - Math.abs(score)) / 2)) : 0,
      depth, pv, firstMove: pv[0], counterMove: pv[1] || null, followupMove: pv[2] || null,
    };
  }

  // Top `count` candidate moves with the opponent's best reply, scored from the mover's point of view.
  function fallbackMultiPV(rootBoard, color, count = 3, depth = 3, timeMs = 1500) {
    const s = createSearcher(rootBoard, timeMs);
    const next = opposite(color);
    const scored = [];
    const replyDepth = Math.max(0, depth - 2);

    try {
      for (const m of orderMoves(s.board, XIANGQI.getLegalMoves(s.board, color))) {
        const cap = s.make(m);
        const replies = orderMoves(s.board, XIANGQI.getLegalMoves(s.board, next));
        let oppValue = -(MATE - 1), bestReply = null;   // opponent has no move: they are mated
        let alpha = -Infinity;
        for (const r of replies) {
          const cap2 = s.make(r);
          const v = -s.negamax(color, replyDepth, -Infinity, -alpha, 2);  // opponent's value after reply r
          s.unmake(r, cap2);
          if (v > alpha) { alpha = v; bestReply = r; }
        }
        if (replies.length > 0) oppValue = alpha;
        s.unmake(m, cap);
        scored.push({ m, reply: bestReply, score: -oppValue });
      }
    } catch (e) {
      if (!(e instanceof SearchAbort)) throw e;   // out of time: keep what was scored so far
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((it, i) =>
      makeVariation(i + 1, it.score, depth, [uciOf(it.m), ...(it.reply ? [uciOf(it.reply)] : [])]));
  }

  // ===== MOVE QUALITY CLASSIFICATION =====

  // symbol/color: the badge drawn on the piece that has just moved (colors match --quality-* in style.css)
  const QUALITY = {
    BRILLIANT:   { key: 'brilliant',   label: '✨ Tuyệt diệu!',  emoji: '✨', symbol: '!!', color: '#00d2c8' },
    GREAT:       { key: 'great',       label: '⭐ Rất tốt',      emoji: '⭐', symbol: '!',  color: '#22c55e' },
    GOOD:        { key: 'good',        label: '✓ Tốt',           emoji: '✓',  symbol: '✓',  color: '#86efac' },
    OK:          { key: 'ok',          label: '— Bình thường',   emoji: '—',  symbol: '–',  color: '#94a3b8' },
    INACCURACY:  { key: 'inaccuracy',  label: '?! Thiếu chính xác', emoji: '?!', symbol: '?!', color: '#f59e0b' },
    MISTAKE:     { key: 'mistake',     label: '? Sai lầm',       emoji: '?',  symbol: '?',  color: '#f97316' },
    BLUNDER:     { key: 'blunder',     label: '?? Sai lầm lớn', emoji: '??', symbol: '??', color: '#ef4444' },
  };

  /**
   * Classify move quality from the eval drop relative to the best move.
   * bestScore:  eval of the position BEFORE the move, mover's POV (engine's best line)
   * scoreAfter: eval AFTER the move, mover's POV
   * isBestMove: boolean, true if this move matches the engine's best move or active hint
   */
  function classifyMoveQuality(bestScore, scoreAfter, isBestMove = false) {
    const evalDrop = bestScore - scoreAfter;  // positive = worse than best

    if (evalDrop < -50) return QUALITY.BRILLIANT;     // clearly better than the engine expected
    if (isBestMove) {
      // If the player played the engine's best move or followed a hint,
      // it should never be penalized as an inaccuracy, mistake, or blunder
      // due to horizon/depth differences between positions.
      return evalDrop < 20 ? QUALITY.GREAT : QUALITY.GOOD;
    }
    if (evalDrop < 20) return QUALITY.GREAT;
    if (evalDrop < 50) return QUALITY.GOOD;
    if (evalDrop < 80) return QUALITY.OK;
    if (evalDrop < 150) return QUALITY.INACCURACY;
    if (evalDrop < 300) return QUALITY.MISTAKE;
    return QUALITY.BLUNDER;
  }

  return {
    init, isReady: () => isReady,
    getBestMove, pickMove, varietyForLevel, analyzePosition, analyzeMultiPV, stopAnalysis, setOption,
    QUALITY, classifyMoveQuality, evalBoard,
  };
})();
