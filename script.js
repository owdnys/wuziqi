/* ================= 五子棋 · 主逻辑 ================= */
(() => {
  'use strict';

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const COLS = 'ABCDEFGHJKLMNOPQRST';   // 跳过 I

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('board-wrap');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const moveCountEl = document.getElementById('move-count');
  const timerEl = document.getElementById('timer');
  const scoreEl = document.getElementById('score');
  const thinkingEl = document.getElementById('thinking');
  const hintTipEl = document.getElementById('hint-tip');
  const modeGroup = document.getElementById('mode-group');
  const modal = document.getElementById('result-modal');
  const resultTitle = document.getElementById('result-title');
  const resultSub = document.getElementById('result-sub');
  const overlay = document.getElementById('overlay');
  const drawerSettings = document.getElementById('settings');
  const drawerNotation = document.getElementById('notation');
  const notationInfo = document.getElementById('notation-info');
  const notationList = document.getElementById('notation-list');

  /* ---------- 状态 ---------- */
  const state = {
    size: 15,
    board: [],
    current: BLACK,
    history: [],
    redoStack: [],
    gameOver: false,
    winner: null,
    winLine: null,
    forbiddenLoss: false,
    hover: null,
    hint: null,
    mode: '3',
    aiSide: WHITE,
    busy: false,
    blackWins: 0, whiteWins: 0,
    timer: { mode: 'none', limit: 30, elapsedB: 0, elapsedW: 0, stepStart: Date.now(), lastTick: Date.now() }
  };

  const opts = {
    forbidden: false,
    numbers: false,
    lastmark: true,
    forbidmark: false,
    coords: true,
    sound: true,
    theme: 'dark'
  };

  let CELL = 40, MARGIN = 36, LOGICAL = 620;

  const inB = (r, c) => r >= 0 && r < state.size && c >= 0 && c < state.size;
  const isAI = () => state.mode !== 'pvp';
  const isAITurn = () => isAI() && !state.gameOver && state.current === state.aiSide;

  /* =========================================================
     一、自适应棋盘尺寸
     ========================================================= */
  function fitCanvas() {
    const rect = wrap.getBoundingClientRect();
    const availW = Math.max(200, rect.width - 8);
    const availH = Math.max(200, rect.height - 8);
    const avail = Math.min(availW, availH);
    const n = state.size;
    CELL = Math.max(12, Math.floor(avail / (n - 1 + 1.7)));
    MARGIN = Math.round(CELL * 0.85);
    LOGICAL = CELL * (n - 1) + MARGIN * 2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(LOGICAL * dpr);
    canvas.height = Math.round(LOGICAL * dpr);
    canvas.style.width = LOGICAL + 'px';
    canvas.style.height = LOGICAL + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* =========================================================
     二、绘制
     ========================================================= */
  function draw() {
    const n = state.size;
    const L = LOGICAL;

    const g = ctx.createLinearGradient(0, 0, L, L);
    if (opts.theme === 'light') { g.addColorStop(0, '#f0c98c'); g.addColorStop(1, '#dfa963'); }
    else { g.addColorStop(0, '#e2b06e'); g.addColorStop(1, '#c8904f'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);

    ctx.strokeStyle = opts.theme === 'light' ? 'rgba(120,80,40,.75)' : 'rgba(122,82,48,.95)';
    ctx.lineWidth = Math.max(1, CELL * 0.03);
    for (let i = 0; i < n; i++) {
      const p = MARGIN + i * CELL;
      ctx.beginPath(); ctx.moveTo(MARGIN, p); ctx.lineTo(MARGIN + (n - 1) * CELL, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, MARGIN); ctx.lineTo(p, MARGIN + (n - 1) * CELL); ctx.stroke();
    }

    ctx.fillStyle = opts.theme === 'light' ? 'rgba(110,70,30,.85)' : 'rgba(93,58,26,.95)';
    for (const [r, c] of starPoints(n)) {
      ctx.beginPath();
      ctx.arc(MARGIN + c * CELL, MARGIN + r * CELL, Math.max(2, CELL * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }

    if (opts.coords && CELL >= 18) {
      ctx.fillStyle = opts.theme === 'light' ? '#8a6438' : '#8a6138';
      ctx.font = `${Math.max(9, Math.round(CELL * 0.3))}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        ctx.fillText(COLS[i], MARGIN + i * CELL, MARGIN * 0.5);
        ctx.fillText(String(n - i), MARGIN * 0.5, MARGIN + i * CELL);
      }
    }

    // 禁手点提示
    if (opts.forbidmark && opts.forbidden && !state.gameOver && state.current === BLACK && !isAITurn() && !state.busy) {
      ctx.strokeStyle = 'rgba(200,40,40,.85)';
      ctx.lineWidth = Math.max(1.5, CELL * 0.06);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (state.board[r][c] !== EMPTY) continue;
          if (window.GomokuAI.isForbidden(state.board, n, r, c)) {
            const x = MARGIN + c * CELL, y = MARGIN + r * CELL, s = CELL * 0.22;
            ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
            ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
          }
        }
      }
    }

    // 悬停预览
    if (state.hover && !state.gameOver && !state.busy && state.board[state.hover.r][state.hover.c] === EMPTY) {
      drawStone(state.hover.r, state.hover.c, state.current, 0.4);
      if (opts.forbidden && state.current === BLACK &&
          window.GomokuAI.isForbidden(state.board, n, state.hover.r, state.hover.c)) {
        const x = MARGIN + state.hover.c * CELL, y = MARGIN + state.hover.r * CELL, s = CELL * 0.3;
        ctx.strokeStyle = 'rgba(220,50,50,.95)';
        ctx.lineWidth = Math.max(2, CELL * 0.07);
        ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
      }
    }

    // 棋子
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (state.board[r][c] !== EMPTY) drawStone(r, c, state.board[r][c], 1);
      }
    }

    // 手数序号
    if (opts.numbers && CELL >= 22) {
      ctx.font = `${Math.round(CELL * 0.34)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < state.history.length; i++) {
        const h = state.history[i];
        ctx.fillStyle = h.p === BLACK ? 'rgba(255,255,255,.85)' : 'rgba(30,30,30,.85)';
        ctx.fillText(String(i + 1), MARGIN + h.c * CELL, MARGIN + h.r * CELL + CELL * 0.02);
      }
    }

    // 最后一手
    if (opts.lastmark && state.history.length && !state.gameOver) {
      const last = state.history[state.history.length - 1];
      const x = MARGIN + last.c * CELL, y = MARGIN + last.r * CELL, s = Math.max(3, CELL * 0.13);
      ctx.fillStyle = '#e33';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    // 提示点
    if (state.hint && !state.gameOver) {
      const x = MARGIN + state.hint.c * CELL, y = MARGIN + state.hint.r * CELL;
      ctx.strokeStyle = 'rgba(217,164,65,.95)';
      ctx.lineWidth = Math.max(2, CELL * 0.08);
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2); ctx.stroke();
    }

    // 胜利连线
    if (state.winLine) {
      ctx.strokeStyle = 'rgba(230,50,50,.9)';
      ctx.lineWidth = Math.max(2, CELL * 0.1);
      const a = state.winLine[0], b = state.winLine[state.winLine.length - 1];
      ctx.beginPath();
      ctx.moveTo(MARGIN + a.c * CELL, MARGIN + a.r * CELL);
      ctx.lineTo(MARGIN + b.c * CELL, MARGIN + b.r * CELL);
      ctx.stroke();
      for (const s of state.winLine) {
        ctx.beginPath();
        ctx.arc(MARGIN + s.c * CELL, MARGIN + s.r * CELL, CELL * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 禁手判负标记
    if (state.forbiddenLoss && state.history.length) {
      const last = state.history[state.history.length - 1];
      const x = MARGIN + last.c * CELL, y = MARGIN + last.r * CELL;
      ctx.strokeStyle = 'rgba(220,40,40,.95)';
      ctx.lineWidth = Math.max(2, CELL * 0.09);
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function starPoints(n) {
    if (n === 19) return [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
    if (n === 15) return [[3,3],[3,11],[7,7],[11,3],[11,11]];
    if (n === 13) return [[3,3],[3,9],[6,6],[9,3],[9,9]];
    return [];
  }

  function drawStone(r, c, player, alpha) {
    const x = MARGIN + c * CELL, y = MARGIN + r * CELL, rad = CELL * 0.44;
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.arc(x + CELL * 0.04, y + CELL * 0.06, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    const grad = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.15, x, y, rad);
    if (player === BLACK) {
      grad.addColorStop(0, '#6e6e6e'); grad.addColorStop(0.6, '#2e2e2e'); grad.addColorStop(1, '#050505');
    } else {
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.7, '#e8e8e8'); grad.addColorStop(1, '#b9b9b9');
    }
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = player === BLACK ? 'rgba(0,0,0,.85)' : 'rgba(150,150,150,.9)';
    ctx.lineWidth = Math.max(0.6, CELL * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  /* =========================================================
     三、坐标换算
     ========================================================= */
  function cellFromPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = LOGICAL / rect.width;
    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;
    const col = Math.round((x - MARGIN) / CELL);
    const row = Math.round((y - MARGIN) / CELL);
    if (row < 0 || row >= state.size || col < 0 || col >= state.size) return null;
    const px = MARGIN + col * CELL, py = MARGIN + row * CELL;
    if (Math.abs(x - px) > CELL * 0.62 || Math.abs(y - py) > CELL * 0.62) return null;
    return { r: row, c: col };
  }

  /* =========================================================
     四、游戏逻辑
     ========================================================= */
  function newBoard() {
    state.board = Array.from({ length: state.size }, () => new Array(state.size).fill(EMPTY));
  }

  function checkWin(r, c, player) {
    for (const [dr, dc] of DIRS) {
      const line = [{ r, c }];
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (inB(rr, cc) && state.board[rr][cc] === player) {
          line.push({ r: rr, c: cc });
          rr += dr * s; cc += dc * s;
        }
      }
      if (line.length >= 5) {
        line.sort((a, b) => (a.r === b.r ? a.c - b.c : a.r - b.r));
        return line;
      }
    }
    return null;
  }

  function isFull() {
    return state.board.every(row => row.every(v => v !== EMPTY));
  }

  async function place(r, c) {
    if (state.gameOver || state.busy) return;
    if (!inB(r, c) || state.board[r][c] !== EMPTY) return;

    const player = state.current;

    // 禁手（黑棋）
    if (opts.forbidden && player === BLACK && window.GomokuAI.isForbidden(state.board, state.size, r, c)) {
      state.board[r][c] = BLACK;
      state.history.push({ r, c, p: BLACK });
      state.forbiddenLoss = true;
      finishGame(WHITE, '禁手');
      return;
    }

    state.board[r][c] = player;
    state.history.push({ r, c, p: player });
    state.redoStack.length = 0;
    state.hint = null;
    hintTipEl.classList.add('hidden');
    playSound('place');

    const line = checkWin(r, c, player);
    if (line) {
      state.winLine = line;
      finishGame(player, '五连');
      return;
    }
    if (isFull()) {
      finishGame('draw', '满盘');
      return;
    }

    state.current = player === BLACK ? WHITE : BLACK;
    state.timer.stepStart = Date.now();
    updateStatus();
    draw();
    saveAuto();
    maybeAIMove();
  }

  function finishGame(winner, reason) {
    state.gameOver = true;
    state.winner = winner;
    if (winner === BLACK) state.blackWins++;
    else if (winner === WHITE) state.whiteWins++;
    updateStatus();
    updateScore();
    draw();
    playSound('win');
    saveAuto();

    let title, sub;
    if (winner === 'draw') {
      title = '🤝 平局';
      sub = '棋盘已满，势均力敌';
    } else if (reason === '禁手') {
      title = '⚪ 白棋胜';
      sub = '黑棋走出禁手（三三 / 四四 / 长连），判负';
    } else if (reason === '超时') {
      title = winner === BLACK ? '⚫ 黑棋胜' : '⚪ 白棋胜';
      sub = '对方超时判负';
    } else {
      title = winner === BLACK ? '⚫ 黑棋胜' : '⚪ 白棋胜';
      sub = isAI() ? (winner === state.aiSide ? 'AI 获胜，再试一次吧' : '🎉 恭喜战胜 AI！') : '五子连珠！';
    }
    resultTitle.textContent = title;
    resultSub.textContent = sub;
    modal.classList.remove('hidden');
  }

  function undo() {
    if (state.busy) return;
    let steps = isAI() ? 2 : 1;
    let removed = 0;
    while (state.history.length && removed < steps) {
      const h = state.history.pop();
      state.board[h.r][h.c] = EMPTY;
      state.redoStack.push(h);
      removed++;
    }
    // 若撤销后仍轮到 AI，再多撤一步（让玩家能重新落子）
    if (isAI() && state.history.length) {
      const nxt = state.history.length % 2 === 0 ? BLACK : WHITE;
      if (nxt === state.aiSide && state.history.length) {
        const h = state.history.pop();
        state.board[h.r][h.c] = EMPTY;
        state.redoStack.push(h);
      }
    }
    state.gameOver = false;
    state.winner = null;
    state.winLine = null;
    state.forbiddenLoss = false;
    state.hint = null;
    state.current = state.history.length % 2 === 0 ? BLACK : WHITE;
    modal.classList.add('hidden');
    updateStatus(); draw(); saveAuto();
  }

  function redo() {
    if (state.busy || !state.redoStack.length) return;
    const h = state.redoStack.pop();
    state.board[h.r][h.c] = h.p;
    state.history.push(h);
    state.current = h.p === BLACK ? WHITE : BLACK;
    const line = checkWin(h.r, h.c, h.p);
    if (line) { state.winLine = line; finishGame(h.p, '五连'); return; }
    updateStatus(); draw(); saveAuto();
    maybeAIMove();
  }

  function restart() {
    state.gameOver = false;
    state.winner = null;
    state.winLine = null;
    state.forbiddenLoss = false;
    state.history = [];
    state.redoStack = [];
    state.hint = null;
    state.hover = null;
    state.current = BLACK;
    state.busy = false;
    state.timer.elapsedB = 0; state.timer.elapsedW = 0;
    state.timer.stepStart = Date.now(); state.timer.lastTick = Date.now();
    newBoard();
    modal.classList.add('hidden');
    hintTipEl.classList.add('hidden');
    thinkingEl.classList.add('hidden');
    updateStatus(); updateScore(); draw(); saveAuto();
    maybeAIMove();
  }

  /* =========================================================
     五、AI 调度
     ========================================================= */
  async function maybeAIMove() {
    if (!isAITurn() || state.gameOver) return;
    state.busy = true;
    thinkingEl.classList.remove('hidden');
    updateStatus();
    await new Promise(res => setTimeout(res, 60));

    const level = parseInt(state.mode, 10) || 3;
    let move = null;
    try {
      move = await window.GomokuAI.think(state.board, state.size, state.aiSide, {
        level,
        forbidden: opts.forbidden
      });
    } catch (e) {
      console.error('AI 出错：', e);
    }

    state.busy = false;
    thinkingEl.classList.add('hidden');
    if (state.gameOver) { updateStatus(); return; }
    if (move) await place(move.r, move.c);
    else if (isFull()) finishGame('draw', '满盘');
    updateStatus();
  }

  /* =========================================================
     六、提示
     ========================================================= */
  function showHint() {
    if (state.gameOver || state.busy || isAITurn()) return;
    const move = window.GomokuAI.findBestQuick(state.board, state.size, state.current, opts.forbidden);
    if (!move) return;
    state.hint = move;
    hintTipEl.textContent = `💡 推荐：${COLS[move.c]}${state.size - move.r}`;
    hintTipEl.classList.remove('hidden');
    draw();
    setTimeout(() => { hintTipEl.classList.add('hidden'); }, 2600);
  }

  /* =========================================================
     七、状态与计时
     ========================================================= */
  function updateStatus() {
    const isBlack = state.current === BLACK;
    statusDot.className = 'dot ' + (isBlack ? 'black-dot' : 'white-dot');
    if (state.gameOver) {
      statusText.textContent = state.winner === 'draw' ? '对局结束 · 平局'
        : (state.winner === BLACK ? '黑棋获胜' : '白棋获胜');
    } else if (state.busy) {
      statusText.textContent = 'AI 思考中…';
    } else {
      const who = isBlack ? '黑棋' : '白棋';
      const mine = isAI() && state.current !== state.aiSide;
      statusText.textContent = mine ? `轮到你（${who}）` : `${who}落子`;
    }
    moveCountEl.textContent = '第 ' + (state.history.length + 1) + ' 手';
  }

  function updateScore() {
    scoreEl.textContent = `黑 ${state.blackWins} : ${state.whiteWins} 白`;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function tickTimer() {
    const t = state.timer;
    const now = Date.now();

    if (t.mode === 'none') {
      const delta = (now - t.lastTick) / 1000;
      t.lastTick = now;
      // 首手落下后才开始计时
      if (!state.gameOver && !state.busy && state.history.length > 0) {
        if (state.current === BLACK) t.elapsedB += delta; else t.elapsedW += delta;
      }
      timerEl.textContent = '⏱ ' + fmtTime(state.current === BLACK ? t.elapsedB : t.elapsedW);
      timerEl.classList.remove('warn');
      return;
    }

    if (t.mode === 'step') {
      if (state.history.length === 0 && !state.gameOver) {
        timerEl.textContent = '⏱ ' + fmtTime(t.limit);
        timerEl.classList.remove('warn');
        return;
      }
      const used = (now - t.stepStart) / 1000;
      const left = t.limit - used;
      timerEl.textContent = '⏱ ' + fmtTime(Math.max(0, left));
      timerEl.classList.toggle('warn', left < 5);
      if (left <= 0 && !state.gameOver && !state.busy) {
        const loser = state.current;
        finishGame(loser === BLACK ? WHITE : BLACK, '超时');
      }
      return;
    }

    if (t.mode === 'total') {
      const delta = (now - t.lastTick) / 1000;
      t.lastTick = now;
      if (!state.gameOver && !state.busy && state.history.length > 0) {
        if (state.current === BLACK) t.elapsedB += delta; else t.elapsedW += delta;
      }
      const cur = state.current === BLACK ? t.elapsedB : t.elapsedW;
      const left = t.limit - cur;
      timerEl.textContent = '⏱ ' + fmtTime(Math.max(0, left));
      timerEl.classList.toggle('warn', left < 10);
      if (left <= 0 && !state.gameOver && state.history.length > 0) {
        const loser = state.current;
        finishGame(loser === BLACK ? WHITE : BLACK, '超时');
      }
    }
  }

  /* =========================================================
     八、音效（Web Audio 合成）
     ========================================================= */
  let audioCtx = null;
  function playSound(type) {
    if (!opts.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      if (type === 'place') {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(880, now);
        o.frequency.exponentialRampToValueAtTime(320, now + 0.08);
        g.gain.setValueAtTime(0.16, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        o.connect(g).connect(audioCtx.destination);
        o.start(now); o.stop(now + 0.13);
      } else if (type === 'win') {
        [523, 659, 784, 1047].forEach((f, i) => {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          const t0 = now + i * 0.12;
          g.gain.setValueAtTime(0.001, t0);
          g.gain.linearRampToValueAtTime(0.15, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
          o.connect(g).connect(audioCtx.destination);
          o.start(t0); o.stop(t0 + 0.32);
        });
      }
    } catch (e) { /* 忽略 */ }
  }

  /* =========================================================
     九、设置与存档
     ========================================================= */
  const LS_SETTINGS = 'gomoku_settings_v2';
  const LS_SAVE = 'gomoku_save_v2';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) Object.assign(opts, JSON.parse(raw));
    } catch (e) {}
    document.documentElement.setAttribute('data-theme', opts.theme);
    document.getElementById('opt-forbidden').checked = opts.forbidden;
    document.getElementById('opt-numbers').checked = opts.numbers;
    document.getElementById('opt-lastmark').checked = opts.lastmark;
    document.getElementById('opt-forbidmark').checked = opts.forbidmark;
    document.getElementById('opt-coords').checked = opts.coords;
    document.getElementById('opt-sound').checked = opts.sound;
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(opts)); } catch (e) {}
  }

  function saveAuto() {
    try {
      localStorage.setItem(LS_SAVE, JSON.stringify({
        size: state.size, history: state.history, mode: state.mode,
        aiSide: state.aiSide, blackWins: state.blackWins, whiteWins: state.whiteWins
      }));
    } catch (e) {}
  }

  function loadAuto() {
    try {
      const raw = localStorage.getItem(LS_SAVE);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.history || !data.history.length) return false;
      state.size = data.size || 15;
      state.mode = data.mode || '3';
      state.aiSide = data.aiSide || WHITE;
      state.blackWins = data.blackWins || 0;
      state.whiteWins = data.whiteWins || 0;
      newBoard();
      state.history = [];
      for (const h of data.history) {
        if (!inB(h.r, h.c)) continue;
        state.board[h.r][h.c] = h.p;
        state.history.push(h);
      }
      state.current = state.history.length % 2 === 0 ? BLACK : WHITE;
      // 恢复后检查是否已分胜负
      const last = state.history[state.history.length - 1];
      const line = last ? checkWin(last.r, last.c, last.p) : null;
      if (line) { state.winLine = line; state.gameOver = true; state.winner = last.p; }
      return true;
    } catch (e) { return false; }
  }

  function exportGame() {
    const data = {
      game: 'gomoku', version: 2, size: state.size,
      mode: state.mode, aiSide: state.aiSide,
      moves: state.history.map(h => `${COLS[h.c]}${state.size - h.r}`),
      history: state.history,
      date: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `五子棋棋谱_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function importGame(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.history || !Array.isArray(data.history)) throw new Error('文件格式不正确');
        state.size = data.size || 15;
        document.getElementById('opt-size').value = String(state.size);
        newBoard();
        state.history = [];
        state.redoStack = [];
        for (const h of data.history) {
          if (!inB(h.r, h.c)) continue;
          state.board[h.r][h.c] = h.p;
          state.history.push(h);
        }
        state.current = state.history.length % 2 === 0 ? BLACK : WHITE;
        state.gameOver = false; state.winLine = null; state.forbiddenLoss = false;
        fitCanvas(); updateStatus(); draw(); closeDrawers();
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    };
    reader.readAsText(file);
  }

  function updateNotation() {
    const n = state.history.length;
    notationInfo.textContent = n ? `共 ${n} 手 · ${state.size} 路棋盘` : '尚无落子';
    notationList.innerHTML = '';
    state.history.forEach((h, i) => {
      const d = document.createElement('div');
      d.className = 'notation-item ' + (h.p === BLACK ? 'black' : 'white') + (i === n - 1 ? ' last' : '');
      d.textContent = `${i + 1}.${h.p === BLACK ? '●' : '○'}${COLS[h.c]}${state.size - h.r}`;
      notationList.appendChild(d);
    });
  }

  /* =========================================================
     十、抽屉与 UI 绑定
     ========================================================= */
  function openDrawer(el) {
    closeDrawers();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('hidden');
    if (el === drawerNotation) updateNotation();
  }
  function closeDrawers() {
    drawerSettings.classList.remove('open');
    drawerNotation.classList.remove('open');
    drawerSettings.setAttribute('aria-hidden', 'true');
    drawerNotation.setAttribute('aria-hidden', 'true');
    overlay.classList.add('hidden');
  }

  document.getElementById('btn-settings').addEventListener('click', () => openDrawer(drawerSettings));
  document.getElementById('btn-notation').addEventListener('click', () => openDrawer(drawerNotation));
  overlay.addEventListener('click', closeDrawers);
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawers));

  document.getElementById('btn-theme').addEventListener('click', () => {
    opts.theme = opts.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', opts.theme);
    saveSettings(); draw();
  });

  modeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.mode) return;
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    restart();
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-hint').addEventListener('click', showHint);
  document.getElementById('btn-restart').addEventListener('click', restart);
  document.getElementById('play-again').addEventListener('click', restart);
  document.getElementById('btn-review').addEventListener('click', () => modal.classList.add('hidden'));

  const bindSwitch = (id, key) => {
    document.getElementById(id).addEventListener('change', (e) => {
      opts[key] = e.target.checked;
      saveSettings();
      draw();
    });
  };
  bindSwitch('opt-forbidden', 'forbidden');
  bindSwitch('opt-numbers', 'numbers');
  bindSwitch('opt-lastmark', 'lastmark');
  bindSwitch('opt-forbidmark', 'forbidmark');
  bindSwitch('opt-coords', 'coords');
  bindSwitch('opt-sound', 'sound');

  document.getElementById('opt-size').addEventListener('change', (e) => {
    state.size = parseInt(e.target.value, 10);
    restart();
    fitCanvas();
  });

  document.getElementById('opt-side').addEventListener('change', (e) => {
    const mySide = parseInt(e.target.value, 10);
    state.aiSide = mySide === BLACK ? WHITE : BLACK;
    restart();
  });

  document.getElementById('opt-timer-mode').addEventListener('change', (e) => {
    state.timer.mode = e.target.value;
    document.getElementById('row-timer-sec').style.display = e.target.value === 'none' ? 'none' : 'flex';
    restart();
  });

  document.getElementById('opt-timer-sec').addEventListener('change', (e) => {
    state.timer.limit = Math.max(5, parseInt(e.target.value, 10) || 30);
    restart();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    saveAuto();
    alert('对局已保存到本机浏览器（下次打开会自动恢复）');
  });
  document.getElementById('btn-load').addEventListener('click', () => {
    if (loadAuto()) { fitCanvas(); updateStatus(); updateScore(); draw(); closeDrawers(); }
    else alert('没有找到已保存的对局');
  });
  document.getElementById('btn-export').addEventListener('click', exportGame);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importGame(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    try { localStorage.removeItem(LS_SAVE); } catch (e) {}
    alert('存档已清除');
  });
  document.getElementById('btn-copy-notation').addEventListener('click', () => {
    const text = state.history.map((h, i) => `${i + 1}.${h.p === BLACK ? 'B' : 'W'}${COLS[h.c]}${state.size - h.r}`).join(' ');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => alert('棋谱已复制到剪贴板'), () => alert('复制失败'));
    } else {
      alert(text || '尚无落子');
    }
  });

  /* =========================================================
     十一、棋盘交互
     ========================================================= */
  canvas.addEventListener('mousemove', (e) => {
    if (state.gameOver || state.busy || isAITurn()) {
      if (state.hover) { state.hover = null; draw(); }
      return;
    }
    const cell = cellFromPoint(e.clientX, e.clientY);
    const nh = cell && state.board[cell.r][cell.c] === EMPTY ? cell : null;
    if ((nh && state.hover && nh.r === state.hover.r && nh.c === state.hover.c) || (!nh && !state.hover)) return;
    state.hover = nh; draw();
  });

  canvas.addEventListener('mouseleave', () => {
    if (state.hover) { state.hover = null; draw(); }
  });

  canvas.addEventListener('click', (e) => {
    if (isAITurn()) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell) place(cell.r, cell.c);
  });

  canvas.addEventListener('touchstart', (e) => {
    if (isAITurn()) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const cell = cellFromPoint(t.clientX, t.clientY);
    if (cell) place(cell.r, cell.c);
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'r') restart();
    else if (k === 'h') showHint();
    else if (e.key === 'Escape') closeDrawers();
  });

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitCanvas, 120);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 260));
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrap);

  /* =========================================================
     十二、启动
     ========================================================= */
  function boot() {
    loadSettings();
    const restored = loadAuto();
    if (!restored) { newBoard(); state.current = BLACK; }
    document.getElementById('opt-size').value = String(state.size);
    document.getElementById('opt-side').value = String(state.aiSide === WHITE ? BLACK : WHITE);
    document.getElementById('opt-timer-sec').value = String(state.timer.limit);
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    state.timer.stepStart = Date.now();
    state.timer.lastTick = Date.now();
    fitCanvas();
    updateStatus();
    updateScore();
    draw();
    setInterval(tickTimer, 250);
    setInterval(saveAuto, 5000);
    maybeAIMove();
  }

  if (document.readyState === 'complete') setTimeout(boot, 40);
  else window.addEventListener('load', () => setTimeout(boot, 40));
})();
