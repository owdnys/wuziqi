/* ================= 五子棋 AI 引擎（含禁手规则） =================
 * 对外接口：
 *   GomokuAI.think(board, size, player, opts) -> Promise<{r,c}|null>
 *   GomokuAI.isForbidden(board, size, r, c)   -> bool   （黑棋禁手判定）
 *   GomokuAI.evalPoint(board, size, r, c, player) -> number
 *   GomokuAI.findBestQuick(board, size, player, forbidden) -> {r,c}|null （同步快速走法，用于提示）
 */
(function (global) {
  'use strict';

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  /* =========================================================
     一、棋型评分表
     ========================================================= */
  const S = {
    FIVE: 10000000,
    OPEN_FOUR: 500000,
    FOUR: 60000,        // 冲四 / 眠四
    OPEN_THREE: 40000,
    THREE: 3000,        // 眠三
    OPEN_TWO: 1200,
    TWO: 150,
    ONE: 20
  };

  const WIN = 1e9;

  /* =========================================================
     二、基础扫描工具
     ========================================================= */
  function inB(size, r, c) { return r >= 0 && r < size && c >= 0 && c < size; }

  // 取出 (r,c) 起沿方向的连续同类子数（不含起点）
  function countDir(board, size, r, c, dr, dc, player) {
    let n = 0, rr = r + dr, cc = c + dc;
    while (inB(size, rr, cc) && board[rr][cc] === player) { n++; rr += dr; cc += dc; }
    return n;
  }

  // 去掉首尾空格，得到中心 9 格线
  function getLine(board, size, r, c, dr, dc) {
    const cells = [];
    for (let i = -4; i <= 4; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      cells.push(inB(size, rr, cc) ? board[rr][cc] : -1); // -1 表示墙
    }
    return cells; // index 4 是中心点
  }

  // 线上落子后，该方向是否能形成 >=5 连（用于判定四）
  function lineHasFive(cells, idx, player) {
    // 在 idx 位置放 player 后统计
    const arr = cells.slice();
    arr[idx] = player;
    let count = 1;
    for (let i = idx - 1; i >= 0 && arr[i] === player; i--) count++;
    for (let i = idx + 1; i < arr.length && arr[i] === player; i++) count++;
    return count;
  }

  // 在某方向的连子结构（用于评估）：返回该点落子后的形态
  function analyzeDir(board, size, r, c, dr, dc, player) {
    board[r][c] = player;
    let count = 1;
    let openA = false, openB = false;
    let rr = r + dr, cc = c + dc;
    while (inB(size, rr, cc) && board[rr][cc] === player) { count++; rr += dr; cc += dc; }
    if (inB(size, rr, cc) && board[rr][cc] === EMPTY) openA = true;
    rr = r - dr; cc = c - dc;
    while (inB(size, rr, cc) && board[rr][cc] === player) { count++; rr -= dr; cc -= dc; }
    if (inB(size, rr, cc) && board[rr][cc] === EMPTY) openB = true;
    board[r][c] = EMPTY;
    return { count, ends: (openA ? 1 : 0) + (openB ? 1 : 0) };
  }

  function shapeScore(count, ends) {
    if (count >= 5) return S.FIVE;
    if (count === 4) return ends === 2 ? S.OPEN_FOUR : ends === 1 ? S.FOUR : 0;
    if (count === 3) return ends === 2 ? S.OPEN_THREE : ends === 1 ? S.THREE : 0;
    if (count === 2) return ends === 2 ? S.OPEN_TWO : ends === 1 ? S.TWO : 0;
    if (count === 1) return ends === 2 ? S.ONE : ends === 1 ? Math.floor(S.ONE / 2) : 0;
    return 0;
  }

  // 单点价值（假设 player 落子于 (r,c) 后，四方向形态分之和）
  function evalPoint(board, size, r, c, player) {
    if (board[r][c] !== EMPTY) return -1;
    let score = 0;
    const shapes = [];
    for (let d = 0; d < 4; d++) {
      const s = analyzeDir(board, size, r, c, DIRS[d][0], DIRS[d][1], player);
      const v = shapeScore(s.count, s.ends);
      score += v;
      shapes.push({ count: s.count, ends: s.ends, value: v });
    }
    // 双威胁加成（双活三 / 四三 / 双四）
    let fours = 0, openThrees = 0;
    for (const sh of shapes) {
      if (sh.count === 4 && sh.ends >= 1) fours++;
      else if (sh.count === 3 && sh.ends === 2) openThrees++;
    }
    if (fours >= 2) score += S.OPEN_FOUR;
    else if (fours >= 1 && openThrees >= 1) score += S.OPEN_THREE;
    if (openThrees >= 2) score += S.OPEN_THREE;
    return score;
  }

  /* =========================================================
     三、禁手判定（仅黑棋）
     规则：黑棋不得走出 三三 / 四四 / 长连；形成五连时不受禁手限制（五连优先）
     ========================================================= */
  function isForbidden(board, size, r, c) {
    if (board[r][c] !== EMPTY) return false;
    board[r][c] = BLACK;

    let five = false, overline = false;
    let fourCount = 0, openThreeCount = 0;

    for (let d = 0; d < 4; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      const cells = getLine(board, size, r, c, dr, dc);
      const idx = 4;

      // 1) 长连 / 五连检查
      let cnt = 1;
      for (let i = idx - 1; i >= 0 && cells[i] === BLACK; i--) cnt++;
      for (let i = idx + 1; i < cells.length && cells[i] === BLACK; i++) cnt++;
      if (cnt === 5) five = true;
      if (cnt >= 6) overline = true;

      // 2) 该方向是否形成"四"：存在空点 X，落黑后成五
      let hasFour = false;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== EMPTY) continue;
        if (lineHasFive(cells, i, BLACK) === 5) { hasFour = true; break; }
      }
      if (hasFour) fourCount++;

      // 3) 该方向是否形成"活三"：存在空点 X，落黑后包含中心的段恰为 4 连且两端皆空（活四）
      let hasOpenThree = false;
      if (!hasFour) {
        hasOpenThree = isOpenThreeLine(cells, idx);
      }
      if (hasOpenThree) openThreeCount++;
    }

    board[r][c] = EMPTY;

    if (five && !overline) return false;      // 成五 → 合法
    if (overline) return true;                 // 长连禁手
    if (fourCount >= 2) return true;           // 四四禁手
    if (openThreeCount >= 2) return true;      // 三三禁手
    return false;
  }

  // 线上 idx 位置落子后是否恰好 5 连
  function hasFiveCheck(arr, idx) {
    let count = 1;
    for (let i = idx - 1; i >= 0 && arr[i] === BLACK; i--) count++;
    for (let i = idx + 1; i < arr.length && arr[i] === BLACK; i++) count++;
    return count === 5;
  }

  // 判断"活三"：存在空点 X，使 X 落黑后，包含中心 idx 的连子段恰为 4 且两端皆空
  function isOpenThreeLine(cells, idx) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) continue;
      const arr = cells.slice();
      arr[i] = BLACK;
      // 定位包含 idx 的连子段（注意 idx 处已有黑子）
      let a = idx, b = idx;
      while (a - 1 >= 0 && arr[a - 1] === BLACK) a--;
      while (b + 1 < arr.length && arr[b + 1] === BLACK) b++;
      const len = b - a + 1;
      if (len !== 4) continue;                       // 必须是四连
      const leftOk = a - 1 >= 0 && arr[a - 1] === EMPTY;
      const rightOk = b + 1 < arr.length && arr[b + 1] === EMPTY;
      if (leftOk && rightOk) return true;            // 活四 → 说明原本是活三
    }
    return false;
  }

  /* =========================================================
     四、局面评估（用于搜索叶子节点）
     ========================================================= */
  // 从 player 视角评估全盘（简化：累加所有已落子点的形态分）
  function evaluateBoard(board, size, player) {
    const opp = player === BLACK ? WHITE : BLACK;
    let myScore = 0, oppScore = 0;
    // 用"每条线段只统计一次"的方式
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = board[r][c];
        if (p === EMPTY) continue;
        for (let d = 0; d < 4; d++) {
          const dr = DIRS[d][0], dc = DIRS[d][1];
          const pr = r - dr, pc = c - dc;
          if (inB(size, pr, pc) && board[pr][pc] === p) continue; // 只统计线段起点
          let len = 0, rr = r, cc = c;
          while (inB(size, rr, cc) && board[rr][cc] === p) { len++; rr += dr; cc += dc; }
          let ends = 0;
          if (inB(size, pr, pc) && board[pr][pc] === EMPTY) ends++;
          if (inB(size, rr, cc) && board[rr][cc] === EMPTY) ends++;
          const v = shapeScore(len, ends);
          if (p === player) myScore += v; else oppScore += v;
        }
      }
    }
    return myScore - oppScore * 1.15;
  }

  /* =========================================================
     五、候选点生成与排序
     ========================================================= */
  function getCandidates(board, size, player, radius) {
    const set = new Set();
    let any = false;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === EMPTY) continue;
        any = true;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            const nr = r + dr, nc = c + dc;
            if (inB(size, nr, nc) && board[nr][nc] === EMPTY) set.add(nr * size + nc);
          }
        }
      }
    }
    const list = [];
    if (!any) {
      const mid = Math.floor(size / 2);
      return [{ r: mid, c: mid }];
    }
    for (const key of set) list.push({ r: Math.floor(key / size), c: key % size });
    return list;
  }

  function sortCandidates(board, size, moves, player) {
    const opp = player === BLACK ? WHITE : BLACK;
    for (const m of moves) {
      const atk = evalPoint(board, size, m.r, m.c, player);
      const def = evalPoint(board, size, m.r, m.c, opp);
      m.score = atk + def * 0.9;
    }
    moves.sort((a, b) => b.score - a.score);
    return moves;
  }

  /* =========================================================
     六、胜负检测
     ========================================================= */
  function checkWinAt(board, size, r, c, player) {
    for (let d = 0; d < 4; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      let cnt = 1;
      cnt += countDir(board, size, r, c, dr, dc, player);
      cnt += countDir(board, size, r, c, -dr, -dc, player);
      if (cnt >= 5) return true;
    }
    return false;
  }

  /* =========================================================
     七、Zobrist 置换表
     ========================================================= */
  const zobrist = [];
  let zobristReady = false, zSize = 0;
  function initZobrist(size) {
    if (zobristReady && zSize === size) return;
    zobrist.length = 0;
    let seed = 88172645463325252n;
    const rnd = () => {
      seed ^= seed << 13n; seed ^= seed >> 7n; seed ^= seed << 17n;
      return Number(seed & 0xffffffffn);
    };
    for (let i = 0; i < size * size * 2; i++) zobrist.push(rnd());
    zobristReady = true; zSize = size;
  }
  function boardHash(board, size) {
    initZobrist(size);
    let h = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = board[r][c];
        if (v === EMPTY) continue;
        h ^= zobrist[(r * size + c) * 2 + (v - 1)];
      }
    }
    return h >>> 0;
  }

  /* =========================================================
     八、迭代加深 + α-β 搜索（negamax）
     ========================================================= */
  function makeSearchCtx(size) {
    return {
      size,
      nodes: 0,
      deadline: Infinity,
      aborted: false,
      tt: new Map(),
      yieldEvery: 4000,
      lastYield: 0
    };
  }

  async function maybeYield(ctx) {
    if (ctx.nodes - ctx.lastYield > ctx.yieldEvery) {
      ctx.lastYield = ctx.nodes;
      await new Promise(res => setTimeout(res, 0));
    }
    if (Date.now() > ctx.deadline) ctx.aborted = true;
  }

  // negamax + α-β，返回相对于 player 的分数
  function negamax(board, size, depth, alpha, beta, player, ctx, beam, forbidden) {
    ctx.nodes++;
    if (ctx.aborted) return 0;

    const opp = player === BLACK ? WHITE : BLACK;
    const moves = getCandidates(board, size, player, depth >= 4 ? 2 : 1);
    if (moves.length === 0) return 0;
    sortCandidates(board, size, moves, player);
    const limit = Math.min(moves.length, beam);

    let best = -Infinity;
    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      // 禁手过滤（黑棋）
      if (forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)) continue;

      board[m.r][m.c] = player;
      let val;
      if (checkWinAt(board, size, m.r, m.c, player)) {
        val = WIN - (10 - depth); // 越早赢越好
      } else if (depth <= 1) {
        val = -evaluateBoard(board, size, opp);
      } else {
        val = -negamax(board, size, depth - 1, -beta, -alpha, opp, ctx, beam, forbidden);
      }
      board[m.r][m.c] = EMPTY;

      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? 0 : best;
  }

  // 根节点搜索：返回最佳走法
  async function searchRoot(board, size, player, depth, beam, ctx, forbidden) {
    const opp = player === BLACK ? WHITE : BLACK;
    const moves = getCandidates(board, size, player, 2);
    if (moves.length === 0) return null;
    sortCandidates(board, size, moves, player);

    const limit = Math.min(moves.length, beam * 2);
    let bestMove = null, bestVal = -Infinity;
    let alpha = -Infinity;

    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      if (forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)) continue;

      board[m.r][m.c] = player;
      let val;
      if (checkWinAt(board, size, m.r, m.c, player)) {
        val = WIN;
      } else if (depth <= 1) {
        val = -evaluateBoard(board, size, opp);
      } else {
        val = -negamax(board, size, depth - 1, -Infinity, -alpha, opp, ctx, beam, forbidden);
      }
      board[m.r][m.c] = EMPTY;

      if (val > bestVal) { bestVal = val; bestMove = m; }
      if (val > alpha) alpha = val;
      await maybeYield(ctx);
      if (ctx.aborted) break;
    }
    return bestMove;
  }

  /* =========================================================
     九、VCF（连续冲四取胜）搜索 —— 提升攻击力
     ========================================================= */
  function vcfSearch(board, size, player, depth, ctx, forbidden) {
    if (depth <= 0 || ctx.aborted) return null;
    const opp = player === BLACK ? WHITE : BLACK;
    const moves = getCandidates(board, size, player, 2);
    // 只考虑能形成"四"或五的进攻走法
    const attack = [];
    for (const m of moves) {
      if (forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)) continue;
      const v = evalPoint(board, size, m.r, m.c, player);
      if (v >= S.FOUR) attack.push({ m, v });
    }
    attack.sort((a, b) => b.v - a.v);
    if (attack.length === 0) return null;

    for (const { m } of attack.slice(0, 6)) {
      board[m.r][m.c] = player;
      if (checkWinAt(board, size, m.r, m.c, player)) {
        board[m.r][m.c] = EMPTY;
        return m; // 直接成五
      }
      // 对手必须防守：找到对手唯一能挡的点（能成五的点）
      const oppMoves = getCandidates(board, size, opp, 2);
      const blocks = [];
      for (const om of oppMoves) {
        board[om.r][om.c] = opp;
        if (checkWinAt(board, size, om.r, om.c, opp)) blocks.push(om);
        board[om.r][om.c] = EMPTY;
      }
      // 我方冲四后，对手若不堵就输 → 只看我方继续冲四
      const cont = vcfSearch(board, size, player, depth - 1, ctx, forbidden);
      board[m.r][m.c] = EMPTY;
      if (cont) return m;
    }
    return null;
  }

  /* =========================================================
     十、难度配置与主入口
     ========================================================= */
  const LEVELS = {
    1: { name: '入门', depth: 1, beam: 6, time: 120, noise: 0.45, radius: 1 },
    2: { name: '简单', depth: 2, beam: 8, time: 300, noise: 0.18, radius: 1 },
    3: { name: '中等', depth: 4, beam: 10, time: 900, noise: 0.04, radius: 2 },
    4: { name: '困难', depth: 6, beam: 12, time: 2200, noise: 0, radius: 2 },
    5: { name: '大师', depth: 8, beam: 14, time: 4500, noise: 0, radius: 2, vcf: true }
  };

  // 立即取胜点 / 必须防守点
  function findImmediate(board, size, player, forbidden) {
    const moves = getCandidates(board, size, player, 2);
    for (const m of moves) {
      if (forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)) continue;
      board[m.r][m.c] = player;
      const win = checkWinAt(board, size, m.r, m.c, player);
      board[m.r][m.c] = EMPTY;
      if (win) return m;
    }
    return null;
  }

  async function think(board, size, player, opts) {
    opts = opts || {};
    const level = opts.level || 3;
    const cfg = LEVELS[level] || LEVELS[3];
    const forbidden = !!opts.forbidden;
    const opp = player === BLACK ? WHITE : BLACK;

    // 空盘：下天元
    let any = false;
    for (let r = 0; r < size && !any; r++) for (let c = 0; c < size; c++) if (board[r][c] !== EMPTY) { any = true; break; }
    if (!any) {
      const mid = Math.floor(size / 2);
      return { r: mid, c: mid };
    }

    // 1) 我方直接取胜
    const winNow = findImmediate(board, size, player, forbidden);
    if (winNow) return winNow;
    // 2) 对手即将取胜 → 必须堵（入门级也可能漏，制造"菜"的感觉）
    const oppWin = findImmediate(board, size, opp, false);
    if (oppWin && level >= 2) return oppWin;
    if (oppWin && level === 1 && Math.random() > 0.35) return oppWin;

    // 3) VCF 算杀（高难度）
    if (cfg.vcf) {
      const ctx0 = makeSearchCtx(size);
      ctx0.deadline = Date.now() + cfg.time * 0.5;
      const vcf = vcfSearch(board, size, player, 10, ctx0, forbidden);
      if (vcf) {
        onProgressDone(opts);
        return vcf;
      }
    }

    // 4) 迭代加深
    const ctx = makeSearchCtx(size);
    ctx.deadline = Date.now() + cfg.time;
    let best = null;

    const startDepth = 2;
    for (let depth = startDepth; depth <= cfg.depth; depth += 2) {
      const m = await searchRoot(board, size, player, depth, cfg.beam, ctx, forbidden);
      if (m && !ctx.aborted) best = m;
      if (ctx.aborted || Date.now() > ctx.deadline) break;
    }

    // 5) 低难度加入噪声（可能漏防、可能下出缓手）
    if (cfg.noise > 0) {
      const moves = getCandidates(board, size, player, cfg.radius);
      const legal = moves.filter(m => !(forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)));
      if (legal.length && Math.random() < cfg.noise) {
        sortCandidates(board, size, legal, player);
        const pick = legal[Math.floor(Math.random() * Math.min(legal.length, 5))];
        onProgressDone(opts);
        return pick;
      }
    }

    if (!best) {
      const moves = getCandidates(board, size, player, 1);
      const legal = moves.filter(m => !(forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)));
      best = legal.length ? legal[Math.floor(Math.random() * legal.length)] : null;
    }
    onProgressDone(opts);
    return best;
  }

  function onProgressDone(opts) {
    if (typeof opts.onDone === 'function') opts.onDone();
  }

  // 同步快速走法（用于"提示"功能）
  function findBestQuick(board, size, player, forbidden) {
    const winNow = findImmediate(board, size, player, forbidden);
    if (winNow) return winNow;
    const opp = player === BLACK ? WHITE : BLACK;
    const oppWin = findImmediate(board, size, opp, false);
    if (oppWin) return oppWin;
    const moves = getCandidates(board, size, player, 2);
    sortCandidates(board, size, moves, player);
    for (const m of moves) {
      if (forbidden && player === BLACK && isForbidden(board, size, m.r, m.c)) continue;
      return m;
    }
    return null;
  }

  global.GomokuAI = {
    think,
    isForbidden,
    evalPoint,
    findBestQuick,
    findImmediate,
    checkWinAt,
    LEVELS
  };
})(window);
