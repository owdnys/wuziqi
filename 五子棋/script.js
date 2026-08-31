/* ================= 五子棋 ================= */
(() => {
  'use strict';

  const SIZE = 15;            // 15 x 15 棋盘
  const CELL = 40;            // 每格像素
  const MARGIN = 30;          // 棋盘边距
  const LOGICAL = CELL * (SIZE - 1) + MARGIN * 2;   // 逻辑尺寸 620
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];   // 横 / 竖 / 主对角 / 副对角
  const WIN_SCORE = 10000000; // 五连分值
  const CENTER = Math.floor(SIZE / 2);

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const blackScoreEl = document.getElementById('black-score');
  const whiteScoreEl = document.getElementById('white-score');
  const modeGroup = document.getElementById('mode-group');
  const modal = document.getElementById('result-modal');
  const resultTitle = document.getElementById('result-title');
  const resultSub = document.getElementById('result-sub');

  // 高分屏适配
  const dpr = window.devicePixelRatio || 1;
  canvas.width = LOGICAL * dpr;
  canvas.height = LOGICAL * dpr;
  canvas.style.width = LOGICAL + 'px';
  canvas.style.height = LOGICAL + 'px';
  ctx.scale(dpr, dpr);

  let board = [];        // 0 空 / 1 黑 / 2 白
  let current = BLACK;   // 当前执子方，黑先
  let history = [];      // 悔棋栈 [{row, col, player}]
  let gameOver = false;
  let winLine = null;    // 胜利五子坐标 [{row, col}, ...]
  let hover = null;      // 鼠标悬停格
  let blackWins = 0, whiteWins = 0;
  let animTimer = null;
  let mode = 'medium';   // pvp / easy / medium / hard

  const isAI = () => mode !== 'pvp';
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  /* ---------- 模式按钮组 ---------- */
  function setMode(m) {
    mode = m;
    for (const btn of modeGroup.children) {
      btn.classList.toggle('active', btn.dataset.mode === m);
    }
  }

  modeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn || btn.dataset.mode === mode) return;
    setMode(btn.dataset.mode);
    reset(false);
  });

  /* ---------- 初始化 ---------- */
  function newBoard() {
    board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
  }

  function reset(keepScore) {
    if (!keepScore) { blackWins = 0; whiteWins = 0; }
    clearTimeout(animTimer);
    newBoard();
    history = [];
    gameOver = false;
    winLine = null;
    hover = null;
    current = BLACK;
    modal.classList.add('hidden');
    updateScore();
    updateStatus();
    draw();
  }

  function updateScore() {
    blackScoreEl.textContent = blackWins;
    whiteScoreEl.textContent = whiteWins;
  }

  function updateStatus() {
    if (gameOver) return;
    const isBlack = current === BLACK;
    statusDot.className = 'dot ' + (isBlack ? 'black-dot' : 'white-dot');
    statusText.textContent = (isAI() && !isBlack) ? 'AI 思考中…' : (isBlack ? '黑棋落子' : '白棋落子');
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    // 棋盘底
    ctx.fillStyle = '#e6b878';
    ctx.fillRect(0, 0, LOGICAL, LOGICAL);

    // 网格
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const p = MARGIN + i * CELL;
      ctx.beginPath();
      ctx.moveTo(MARGIN, p);
      ctx.lineTo(MARGIN + (SIZE - 1) * CELL, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, MARGIN);
      ctx.lineTo(p, MARGIN + (SIZE - 1) * CELL);
      ctx.stroke();
    }

    // 坐标
    ctx.fillStyle = '#8a6138';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < SIZE; i++) {
      ctx.fillText(String.fromCharCode(65 + i), MARGIN + i * CELL, MARGIN - 17);       // A-O
      ctx.fillText(SIZE - i, MARGIN - 17, MARGIN + i * CELL);                          // 15-1
    }

    // 星位
    const stars = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
    ctx.fillStyle = '#5d3a1a';
    for (const [r, c] of stars) {
      ctx.beginPath();
      ctx.arc(MARGIN + c * CELL, MARGIN + r * CELL, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 悬停预览
    if (hover && !gameOver && board[hover.row][hover.col] === EMPTY) {
      drawStone(hover.row, hover.col, current, 0.35);
    }

    // 棋子
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (board[r][c] !== EMPTY) drawStone(r, c, board[r][c], 1);

    // 胜利标记
    if (winLine) {
      ctx.strokeStyle = '#e33';
      ctx.lineWidth = 3;
      for (const { row, col } of winLine) {
        ctx.beginPath();
        ctx.arc(MARGIN + col * CELL, MARGIN + row * CELL, CELL / 2 - 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawStone(row, col, player, alpha) {
    const x = MARGIN + col * CELL;
    const y = MARGIN + row * CELL;
    const r = CELL * 0.42;
    ctx.save();
    ctx.globalAlpha = alpha;

    // 阴影
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 2.5, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // 棋子本体
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    if (player === BLACK) {
      grad.addColorStop(0, '#6e6e6e');
      grad.addColorStop(0.6, '#2e2e2e');
      grad.addColorStop(1, '#050505');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.7, '#e8e8e8');
      grad.addColorStop(1, '#b9b9b9');
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = player === BLACK ? '#000' : '#9a9a9a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 坐标换算 ---------- */
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (LOGICAL / rect.width);
    const y = (e.clientY - rect.top) * (LOGICAL / rect.height);
    const col = Math.round((x - MARGIN) / CELL);
    const row = Math.round((y - MARGIN) / CELL);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    const px = MARGIN + col * CELL, py = MARGIN + row * CELL;
    if (Math.abs(x - px) > CELL / 2 || Math.abs(y - py) > CELL / 2) return null;
    return { row, col };
  }

  /* ---------- 胜负判定 ---------- */
  function checkWin(row, col) {
    const player = board[row][col];
    for (const [dr, dc] of DIRS) {
      const line = [{ row, col }];
      for (const s of [1, -1]) {
        let r = row + dr * s, c = col + dc * s;
        while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) {
          line.push({ row: r, col: c });
          r += dr * s;
          c += dc * s;
        }
      }
      if (line.length >= 5) return line.slice(0, 5);
    }
    return null;
  }

  function isFull() {
    return board.every(row => row.every(v => v !== EMPTY));
  }

  function endGame(winner) {
    gameOver = true;
    if (winner) {
      if (winner === BLACK) blackWins++; else whiteWins++;
      updateScore();
      const title = winner === BLACK ? '⚫ 黑棋获胜！' : '⚪ 白棋获胜！';
      const sub = isAI() ? (winner === BLACK ? '你赢了，真厉害！' : 'AI 获胜，再试一次吧') : '再来一局分胜负吧';
      showModal(title, sub);
    } else {
      showModal('🤝 平局', '棋盘已满，势均力敌');
    }
    updateStatus();
    draw();
  }

  function showModal(title, sub) {
    resultTitle.textContent = title;
    resultSub.textContent = sub;
    modal.classList.remove('hidden');
  }

  /* ---------- 落子 ---------- */
  function place(row, col, player) {
    board[row][col] = player;
    history.push({ row, col, player });
    const line = checkWin(row, col);
    if (line) {
      winLine = line;
      endGame(player);
      return true;
    }
    if (isFull()) {
      endGame(null);
      return true;
    }
    return false;
  }

  function makeMove(row, col) {
    if (gameOver || board[row][col] !== EMPTY) return;
    const done = place(row, col, current);
    if (done) return;
    current = current === BLACK ? WHITE : BLACK;
    updateStatus();
    draw();
    // 人机模式：轮到 AI（白棋）时自动落子
    if (isAI() && current === WHITE) scheduleAI();
  }

  /* ---------- 悔棋 ---------- */
  function undo() {
    clearTimeout(animTimer);
    if (gameOver) {
      // 对局结束后悔棋 = 撤销最后一手，恢复对局
      gameOver = false;
      winLine = null;
      modal.classList.add('hidden');
    }
    const steps = isAI() ? 2 : 1;
    let removed = 0;
    while (history.length && removed < steps) {
      const last = history.pop();
      board[last.row][last.col] = EMPTY;
      removed++;
    }
    if (removed > 0) {
      current = BLACK; // 无论撤回几步，都轮到黑棋（人机模式黑棋是玩家）
      hover = null;
      updateStatus();
      draw();
    }
  }

  /* ==========================================================
     AI：三档难度
     - 简单：单层评分 + 大噪声（会漏防一些棋，偶有失误）
     - 中等：2 层极小化极大搜索，基本能防住活三、冲四
     - 困难：4 层极小化极大 + α-β 剪枝，会防会攻、主动造双三
  ========================================================== */

  // 单条线段价值
  function segmentScore(len, open) {
    if (len >= 5) return WIN_SCORE;
    if (len === 4) return open === 2 ? 1000000 : open === 1 ? 60000 : 0;
    if (len === 3) return open === 2 ? 35000 : open === 1 ? 1500 : 0;
    if (len === 2) return open === 2 ? 2500 : open === 1 ? 150 : 0;
    return open === 2 ? 150 : 15;
  }

  // 假设在 (row,col) 落 player 子，四方向即时价值（用于排序与简单档）
  function pointScore(row, col, player) {
    let total = 0;
    for (const [dr, dc] of DIRS) {
      let count = 1, open = 0;
      for (const s of [1, -1]) {
        let r = row + dr * s, c = col + dc * s, len = 0;
        while (inBounds(r, c) && board[r][c] === player) { len++; r += dr * s; c += dc * s; }
        count += len;
        if (inBounds(r, c) && board[r][c] === EMPTY) open++;
      }
      total += segmentScore(count, open);
    }
    return total;
  }

  // (r,c) 处是否已有 player 的五连
  function hasFive(r, c, player) {
    for (const [dr, dc] of DIRS) {
      let count = 1;
      for (const s of [1, -1]) {
        let nr = r + dr * s, nc = c + dc * s;
        while (inBounds(nr, nc) && board[nr][nc] === player) {
          count++;
          nr += dr * s;
          nc += dc * s;
        }
      }
      if (count >= 5) return true;
    }
    return false;
  }

  // 全盘评估：白分 - 黑分（AI 执白，越大越好）。每条线段只统计一次。
  function evaluateBoard() {
    let score = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = board[r][c];
        if (p === EMPTY) continue;
        for (const [dr, dc] of DIRS) {
          // 只统计线段起点：反方向无同色
          const br = r - dr, bc = c - dc;
          if (inBounds(br, bc) && board[br][bc] === p) continue;
          // 数线段长度
          let len = 0, nr = r, nc = c;
          while (inBounds(nr, nc) && board[nr][nc] === p) { len++; nr += dr; nc += dc; }
          // 两端开放
          let open = 0;
          if (inBounds(br, bc) && board[br][bc] === EMPTY) open++;
          if (inBounds(nr, nc) && board[nr][nc] === EMPTY) open++;
          const seg = segmentScore(len, open);
          score += p === WHITE ? seg : -seg;
        }
      }
    }
    return score;
  }

  // 候选点：已有棋子的 2 格邻域内的空位
  function getCandidates() {
    const set = new Set();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && board[nr][nc] === EMPTY) set.add(nr * SIZE + nc);
          }
        }
      }
    }
    if (set.size === 0) return [{ r: CENTER, c: CENTER }];
    const list = [];
    for (const key of set) list.push({ r: Math.floor(key / SIZE), c: key % SIZE });
    return list;
  }

  // 极小化极大 + α-β 剪枝（带启发式排序与宽度限制）
  function minimax(depth, alpha, beta, player, beam) {
    const moves = getCandidates();
    if (moves.length === 0) return evaluateBoard();
    if (depth <= 0) return evaluateBoard();

    for (const m of moves) m.heur = pointScore(m.r, m.c, player) + Math.random() * 0.01;
    moves.sort((a, b) => b.heur - a.heur);
    const limit = Math.min(moves.length, beam);

    let best = player === WHITE ? -Infinity : Infinity;
    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      board[m.r][m.c] = player;
      let val;
      if (hasFive(m.r, m.c, player)) {
        // 越早赢分越高（depth 越大越靠近根）
        val = player === WHITE ? WIN_SCORE + depth : -WIN_SCORE - depth;
      } else {
        val = minimax(depth - 1, alpha, beta, player === WHITE ? BLACK : WHITE, beam);
      }
      board[m.r][m.c] = EMPTY;

      if (player === WHITE) {
        if (val > best) best = val;
        if (best > alpha) alpha = best;
      } else {
        if (val < best) best = val;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break; // 剪枝
    }
    return best;
  }

  // 搜索型走法（中等 / 困难共用）
  function aiMoveSearch(depth, rootLimit, beam, noise) {
    const moves = getCandidates();
    if (moves.length === 1) { makeMove(moves[0].r, moves[0].c); return; }

    for (const m of moves) {
      m.heur = pointScore(m.r, m.c, WHITE) + pointScore(m.r, m.c, BLACK) * 0.6 + Math.random() * noise;
    }
    moves.sort((a, b) => b.heur - a.heur);
    const limit = Math.min(moves.length, rootLimit);

    let bestMove = moves[0], bestVal = -Infinity;
    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      board[m.r][m.c] = WHITE;
      let val;
      if (hasFive(m.r, m.c, WHITE)) {
        val = WIN_SCORE + depth;
      } else {
        val = minimax(depth - 1, -Infinity, Infinity, BLACK, beam);
      }
      board[m.r][m.c] = EMPTY;
      if (val > bestVal) { bestVal = val; bestMove = m; }
    }
    makeMove(bestMove.r, bestMove.c);
  }

  // 简单档：单层评分 + 大噪声
  function aiMoveEasy() {
    const moves = getCandidates();
    let best = moves[0], bestScore = -Infinity;
    for (const m of moves) {
      const score = pointScore(m.r, m.c, WHITE)
                  + pointScore(m.r, m.c, BLACK) * 1.05
                  + Math.random() * 3000;   // 噪声：偶尔漏防、偶犯小错
      if (score > bestScore) { bestScore = score; best = m; }
    }
    makeMove(best.r, best.c);
  }

  function scheduleAI() {
    clearTimeout(animTimer);
    const delays = { easy: 200, medium: 350, hard: 550 };
    animTimer = setTimeout(aiMove, delays[mode] || 300);
  }

  function aiMove() {
    if (gameOver || !isAI() || current !== WHITE) return;

    // 开局抢占中心 / 贴住第一手
    if (history.length === 0) { makeMove(CENTER, CENTER); return; }
    if (history.length === 1) {
      const first = history[0];
      const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
      for (const [dr, dc] of offsets) {
        const r = first.row + dr, c = first.col + dc;
        if (inBounds(r, c) && board[r][c] === EMPTY) { makeMove(r, c); return; }
      }
    }

    switch (mode) {
      case 'easy':
        aiMoveEasy();
        break;
      case 'medium':
        aiMoveSearch(2, 20, 12, 40);   // 2 层搜索
        break;
      case 'hard':
        aiMoveSearch(4, 14, 7, 0);      // 4 层搜索 + α-β 剪枝
        break;
    }
  }

  /* ---------- 事件 ---------- */
  canvas.addEventListener('mousemove', (e) => {
    if (isAI() && current === WHITE) { hover = null; return; }
    const cell = cellFromEvent(e);
    const nh = cell && board[cell.row][cell.col] === EMPTY ? cell : null;
    if ((nh && hover && nh.row === hover.row && nh.col === hover.col) || (!nh && !hover)) return;
    hover = nh;
    draw();
  });

  canvas.addEventListener('mouseleave', () => {
    if (hover) { hover = null; draw(); }
  });

  canvas.addEventListener('click', (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (isAI() && current === WHITE) return; // AI 回合
    makeMove(cell.row, cell.col);
  });

  // 触摸支持
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const cell = cellFromEvent({
      clientX: t.clientX,
      clientY: t.clientY,
      target: canvas,
      currentTarget: canvas
    });
    if (cell) makeMove(cell.row, cell.col);
  }, { passive: false });

  document.getElementById('undo').addEventListener('click', undo);

  document.getElementById('restart').addEventListener('click', () => reset(false));

  document.getElementById('play-again').addEventListener('click', () => reset(false));

  /* ---------- 启动 ---------- */
  setMode('medium');
  reset(true);
})();
