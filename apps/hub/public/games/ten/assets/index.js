// ../../packages/sdk/src/index.ts
var asRecord = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value;
};
var isMgEnvelope = (data) => {
  const body = asRecord(data);
  if (!body) {
    return false;
  }
  return body.__mg === 1 && body.v === 1 && typeof body.type === "string";
};
var isString = (value) => typeof value === "string";
var isHubInitPayload = (payload) => {
  const body = asRecord(payload);
  return !!body && isString(body.gameSlug) && typeof body.muted === "boolean" && isString(body.locale);
};
var envelope = (type, payload) => ({
  __mg: 1,
  v: 1,
  type,
  payload
});
var createGameMessenger = (targetWindow, targetOrigin) => {
  const post = (type, payload) => {
    targetWindow.postMessage(envelope(type, payload), targetOrigin);
  };
  return {
    ready(gameSlug) {
      post("GAME_READY", { gameSlug });
    },
    submitScore(payload) {
      post("SUBMIT_SCORE", payload);
    },
    onInit(handler) {
      const listener = (event) => {
        if (event.origin !== targetOrigin) {
          return;
        }
        if (!isMgEnvelope(event.data)) {
          return;
        }
        if (event.data.type !== "HUB_INIT") {
          return;
        }
        if (!isHubInitPayload(event.data.payload)) {
          return;
        }
        handler(event.data.payload);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }
  };
};

// src/main.ts
var GAME_SLUG = "ten";
var ROWS = 10;
var COLS = 18;
var START_TIME_MS = 1e5;
var BONUS_WINDOW_MS = 5e3;
var TIME_REWARD_MS = 5e3;
var BGM_LENGTH_SECONDS = 50;
var scoreEl = document.getElementById("score");
var comboEl = document.getElementById("combo");
var comboBonusEl = document.getElementById("combo-bonus");
var timerEl = document.getElementById("timer");
var statusEl = document.getElementById("status");
var shakeToggleBtnEl = document.getElementById("shake-toggle-btn");
var startBtn = document.getElementById("start-btn");
var timeFillEl = document.getElementById("time-fill");
var countdownOverlayEl = document.getElementById("countdown-overlay");
var countdownTextEl = document.getElementById("countdown-text");
var bgmToggleBtnEl = document.getElementById("bgm-toggle-btn");
var bgmVolumeEl = document.getElementById("bgm-volume");
var finalScoreEl = document.getElementById("final-score");
var gameOverEl = document.getElementById("game-over");
var restartBtn = document.getElementById("restart-btn");
var boardWrapEl = document.getElementById("board-wrap");
var canvas = document.getElementById("board");
var ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("2D context unavailable");
}
var getHubOrigin = () => {
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
};
var messenger = createGameMessenger(window.parent, getHubOrigin());
var numberColors = [
  "#1e293b",
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#ec4899",
  "#14b8a6",
  "#a855f7",
  "#ef4444",
  "#f59e0b"
];
var audioCtx = null;
var bgmBuffer = null;
var bgmSource = null;
var bgmGain = null;
var board = [];
var score = 0;
var comboChain = 0;
var maxCombo = 0;
var comboBonusScore = 0;
var timeLeftMs = START_TIME_MS;
var firstPick = null;
var started = false;
var counting = false;
var over = false;
var tickHandle = 0;
var lastClearAt = null;
var lastTickAt = performance.now();
var layout = { cellSize: 40, boardX: 0, boardY: 0, boardW: 400, boardH: 720 };
var fxList = [];
var shakeTime = 0;
var shakePower = 0;
var shakeEnabled = true;
var bgmEnabled = true;
var bgmVolumePct = 55;
var randomCell = () => Math.floor(Math.random() * 9) + 1;
var createBoard = () => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => randomCell()));
var getAudioCtx = () => {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
};
var midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);
var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
var bgmGainFromPct = (pct) => clamp(pct, 0, 100) / 100 * 0.32;
var createBgmBuffer = (context) => {
  const sampleRate = context.sampleRate;
  const length = sampleRate * BGM_LENGTH_SECONDS;
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const tempo = 136;
  const beat = 60 / tempo;
  const sectionBeats = 16;
  const breakdownStart = 23;
  const breakdownEnd = 27;
  const bassSeqA = [40, 40, 43, 43, 47, 47, 43, 40];
  const bassSeqB = [40, 43, 47, 50, 47, 45, 43, 40];
  const hookA = [76, 79, 83, 79, 76, 79, 83, 86, 83, 79, 76, 74, 76, 79, 83, 79];
  const hookB = [76, 79, 83, 86, 88, 86, 83, 79, 81, 84, 88, 84, 81, 79, 76, 74];
  const hookC = [72, 74, 76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 83, 79, 76, 74];
  let noiseState = 305419896;
  const nextNoise = () => {
    noiseState = noiseState * 1664525 + 1013904223 >>> 0;
    return noiseState / 4294967295 * 2 - 1;
  };
  const saw = (freq, t) => {
    const phase = t * freq % 1;
    return phase * 2 - 1;
  };
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    const inBreakdown = t >= breakdownStart && t < breakdownEnd;
    const breakdownMix = inBreakdown ? 1 : 0;
    const beatIndex = Math.floor(t / beat);
    const beatTime = t - beatIndex * beat;
    const sectionIndex = Math.floor(beatIndex / sectionBeats) % 4;
    const inFillBeat = beatIndex % sectionBeats >= sectionBeats - 2;
    const halfBeat = beat / 2;
    const halfIndex = Math.floor(t / halfBeat);
    const halfTime = t - halfIndex * halfBeat;
    const bassSeq = sectionIndex % 2 === 0 ? bassSeqA : bassSeqB;
    const bassNote = bassSeq[halfIndex % bassSeq.length];
    const bassFreq = midiToFreq(bassNote);
    const bassEnv = Math.exp(-halfTime * (sectionIndex === 2 ? 9.2 : 7.2));
    const bassDrive = sectionIndex === 1 ? 0.14 : 0.11;
    sample += saw(bassFreq, t) * bassDrive * bassEnv * (1 - 0.55 * breakdownMix);
    sample += Math.sin(2 * Math.PI * bassFreq * 0.5 * t) * 0.03 * (1 - 0.35 * breakdownMix);
    const leadSeq = sectionIndex === 0 ? hookA : sectionIndex === 1 ? hookB : hookC;
    const leadStep = Math.floor(t / (beat / 4)) % leadSeq.length;
    const leadFreq = midiToFreq(leadSeq[leadStep] + (sectionIndex === 3 ? 12 : 0));
    const leadT = t % (beat / 4);
    const leadEnv = Math.exp(-leadT * (sectionIndex === 3 ? 8.5 : 12.5));
    const leadAmount = sectionIndex === 2 ? 0.035 : 0.06;
    sample += saw(leadFreq, t) * leadAmount * leadEnv * (1 - 0.7 * breakdownMix);
    sample += Math.sin(2 * Math.PI * leadFreq * (sectionIndex === 3 ? 3 : 2) * t) * 0.018 * leadEnv * (1 - 0.65 * breakdownMix);
    sample += Math.sin(2 * Math.PI * leadFreq * 0.5 * t) * 0.012 * leadEnv;
    if (sectionIndex === 3) {
      const padFreq = midiToFreq(64 + (beatIndex >> 2) % 4 * 2);
      sample += Math.sin(2 * Math.PI * padFreq * t) * 0.018;
    }
    if (inBreakdown) {
      const moodPad = midiToFreq(57 + (beatIndex >> 2) % 3 * 3);
      sample += Math.sin(2 * Math.PI * moodPad * t) * 0.045;
      sample += Math.sin(2 * Math.PI * moodPad * 1.5 * t) * 0.022;
    }
    const kickWindow = inFillBeat ? 0.12 : 0.17;
    if (beatTime < kickWindow && (!inBreakdown || beatIndex % 2 === 0)) {
      const kEnv = Math.exp(-beatTime * 27);
      const kFreq = 170 - beatTime * 640;
      sample += Math.sin(2 * Math.PI * Math.max(45, kFreq) * beatTime) * 0.38 * kEnv * (1 - 0.35 * breakdownMix);
    }
    const snareEveryBeat = sectionIndex >= 2;
    if (((snareEveryBeat || beatIndex % 2 === 1) && beatTime < 0.14 || inFillBeat && beatTime < 0.1) && !inBreakdown) {
      const sEnv = Math.exp(-beatTime * 24);
      sample += nextNoise() * 0.22 * sEnv;
    }
    const hatDivision = sectionIndex === 0 ? beat / 2 : beat / 4;
    const hatTime = t % hatDivision;
    if (hatTime < 0.03 || inFillBeat && hatTime < 0.045) {
      const hEnv = Math.exp(-hatTime * 80);
      sample += nextNoise() * (sectionIndex === 0 ? 0.05 : 0.075) * hEnv * (1 - 0.6 * breakdownMix);
    }
    data[i] = clamp(sample, -0.92, 0.92);
  }
  return buffer;
};
var ensureAudioReady = async () => {
  const context = getAudioCtx();
  if (context.state !== "running") {
    await context.resume();
  }
  if (!bgmBuffer) {
    bgmBuffer = createBgmBuffer(context);
  }
};
var stopBgm = (fadeMs = 220) => {
  const sourceToStop = bgmSource;
  const gainToStop = bgmGain;
  bgmSource = null;
  bgmGain = null;
  if (sourceToStop) {
    if (audioCtx && gainToStop) {
      const now = audioCtx.currentTime;
      gainToStop.gain.cancelScheduledValues(now);
      gainToStop.gain.setValueAtTime(gainToStop.gain.value, now);
      gainToStop.gain.linearRampToValueAtTime(1e-4, now + fadeMs / 1e3);
      window.setTimeout(() => {
        try {
          sourceToStop.stop();
        } catch {
          return;
        } finally {
          sourceToStop.disconnect();
        }
      }, fadeMs + 60);
    } else {
      try {
        sourceToStop.stop();
      } catch {
        return;
      } finally {
        sourceToStop.disconnect();
      }
    }
  }
  if (gainToStop) {
    window.setTimeout(() => {
      gainToStop.disconnect();
    }, fadeMs + 80);
  }
};
var startBgm = () => {
  if (!bgmEnabled || !audioCtx || !bgmBuffer) {
    return;
  }
  stopBgm();
  bgmGain = audioCtx.createGain();
  bgmGain.gain.value = bgmGainFromPct(bgmVolumePct);
  bgmSource = audioCtx.createBufferSource();
  bgmSource.buffer = bgmBuffer;
  bgmSource.loop = true;
  bgmSource.connect(bgmGain);
  bgmGain.connect(audioCtx.destination);
  bgmSource.start(0);
};
var playPopSound = () => {
  if (!audioCtx) {
    return;
  }
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(360, now + 0.13);
  gain.gain.setValueAtTime(1e-4, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.16);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.17);
};
var spawnShardsForCell = (row, col, color) => {
  const cx = layout.boardX + col * layout.cellSize + layout.cellSize / 2;
  const cy = layout.boardY + row * layout.cellSize + layout.cellSize / 2;
  const shardCount = 12;
  const baseSpeed = layout.cellSize * 8.8;
  for (let i = 0; i < shardCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speedMul = 1 + Math.random() * 0.5;
    const speed = baseSpeed * speedMul;
    fxList.push({
      x: cx + (Math.random() - 0.5) * 4,
      y: cy + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.9,
      size: Math.max(2, layout.cellSize * (0.11 + Math.random() * 0.11)),
      color,
      life: 0.45 + Math.random() * 0.26,
      maxLife: 0.7
    });
  }
};
var resizeCanvas = () => {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const maxW = Math.max(320, boardWrapEl.clientWidth - 20);
  const maxH = Math.max(180, boardWrapEl.clientHeight - 20);
  const cellByW = Math.floor(maxW / COLS);
  const cellByH = Math.floor(maxH / ROWS);
  const cellSize = Math.max(16, Math.min(52, Math.min(cellByW, cellByH)));
  const boardW = cellSize * COLS;
  const boardH = cellSize * ROWS;
  canvas.style.width = `${boardW}px`;
  canvas.style.height = `${boardH}px`;
  canvas.width = Math.floor(boardW * dpr);
  canvas.height = Math.floor(boardH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = { cellSize, boardX: 0, boardY: 0, boardW, boardH };
  draw(0);
};
var updateHud = () => {
  scoreEl.textContent = `Score: ${score}`;
  comboEl.textContent = `Max Combo: ${maxCombo}`;
  comboBonusEl.textContent = `Combo Bonus: ${comboBonusScore}`;
  timerEl.textContent = `${(timeLeftMs / 1e3).toFixed(2)}s`;
  const ratio = Math.max(0, Math.min(1, timeLeftMs / START_TIME_MS));
  timeFillEl.style.transform = `scaleX(${ratio})`;
};
var sumRect = (a, b) => {
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);
  const minCol = Math.min(a.col, b.col);
  const maxCol = Math.max(a.col, b.col);
  let sum = 0;
  let activeCount = 0;
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const value = board[row][col];
      sum += value;
      if (value > 0) {
        activeCount++;
      }
    }
  }
  return { minRow, maxRow, minCol, maxCol, sum, activeCount };
};
var findTenRectExists = () => {
  const prefix = Array.from({ length: ROWS + 1 }, () => Array(COLS + 1).fill(0));
  for (let row = 1; row <= ROWS; row++) {
    for (let col = 1; col <= COLS; col++) {
      prefix[row][col] = board[row - 1][col - 1] + prefix[row - 1][col] + prefix[row][col - 1] - prefix[row - 1][col - 1];
    }
  }
  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let c1 = 0; c1 < COLS; c1++) {
      for (let r2 = r1; r2 < ROWS; r2++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          const sum = prefix[r2 + 1][c2 + 1] - prefix[r1][c2 + 1] - prefix[r2 + 1][c1] + prefix[r1][c1];
          if (sum === 10) {
            return true;
          }
        }
      }
    }
  }
  return false;
};
var activeCellsCount = () => {
  let count = 0;
  for (const row of board) {
    for (const value of row) {
      if (value > 0) {
        count++;
      }
    }
  }
  return count;
};
var rerollBoardValues = () => {
  if (activeCellsCount() === 0) {
    board = createBoard();
    return;
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (board[row][col] > 0) {
        board[row][col] = randomCell();
      }
    }
  }
};
var ensurePlayable = () => {
  if (findTenRectExists()) {
    return;
  }
  let tries = 0;
  do {
    rerollBoardValues();
    tries++;
  } while (!findTenRectExists() && tries < 20);
  timeLeftMs += TIME_REWARD_MS;
  statusEl.textContent = "No sum-10 area. Re-rolled numbers and +5s.";
  updateHud();
};
var removeRect = (a, b) => {
  const rect = sumRect(a, b);
  if (rect.sum !== 10 || rect.activeCount === 0) {
    comboChain = 0;
    statusEl.textContent = `Sum is ${rect.sum}. Need exactly 10.`;
    return;
  }
  let removed = 0;
  for (let row = rect.minRow; row <= rect.maxRow; row++) {
    for (let col = rect.minCol; col <= rect.maxCol; col++) {
      const value = board[row][col];
      if (value > 0) {
        spawnShardsForCell(row, col, numberColors[value]);
        board[row][col] = 0;
        removed++;
      }
    }
  }
  playPopSound();
  const now = performance.now();
  let gained = removed;
  if (lastClearAt !== null && now - lastClearAt <= BONUS_WINDOW_MS) {
    gained += 1;
    comboBonusScore += 1;
    comboChain += 1;
  } else {
    comboChain = 1;
  }
  if (comboChain > maxCombo) {
    maxCombo = comboChain;
  }
  if (lastClearAt !== null && now - lastClearAt <= BONUS_WINDOW_MS) {
    statusEl.textContent = `Combo x${comboChain} (+1 speed bonus) | Max x${maxCombo}`;
  } else {
    statusEl.textContent = `Combo x${comboChain} | Max x${maxCombo}`;
  }
  lastClearAt = now;
  score += gained;
  if (shakeEnabled) {
    shakeTime = 0.2;
    shakePower = Math.max(shakePower, 3.5);
  }
  updateHud();
};
var toCell = (clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - layout.boardX;
  const y = clientY - rect.top - layout.boardY;
  if (x < 0 || y < 0 || x >= layout.boardW || y >= layout.boardH) {
    return null;
  }
  const col = Math.floor(x / layout.cellSize);
  const row = Math.floor(y / layout.cellSize);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
    return null;
  }
  return { row, col };
};
var onBoardClick = (event) => {
  if (!started || counting || over) {
    return;
  }
  const picked = toCell(event.clientX, event.clientY);
  if (!picked) {
    return;
  }
  if (!firstPick) {
    if (board[picked.row][picked.col] === 0) {
      statusEl.textContent = "Empty cell cannot be selected first.";
      return;
    }
    firstPick = picked;
    statusEl.textContent = `First pick: (${picked.col + 1}, ${picked.row + 1})`;
    return;
  }
  removeRect(firstPick, picked);
  firstPick = null;
  ensurePlayable();
};
var draw = (deltaSeconds) => {
  ctx.clearRect(-32, -32, layout.boardW + 64, layout.boardH + 64);
  if (shakeTime > 0) {
    shakeTime = Math.max(0, shakeTime - deltaSeconds);
  }
  const shakeAmount = shakeTime > 0 ? shakePower * (shakeTime / 0.18) : 0;
  const shakeX = shakeAmount > 0 ? (Math.random() - 0.5) * 2 * shakeAmount : 0;
  const shakeY = shakeAmount > 0 ? (Math.random() - 0.5) * 2 * shakeAmount : 0;
  shakePower *= 0.92;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  ctx.fillStyle = "#020617";
  ctx.fillRect(layout.boardX, layout.boardY, layout.boardW, layout.boardH);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const value = board[row]?.[col] ?? 0;
      const x = layout.boardX + col * layout.cellSize;
      const y = layout.boardY + row * layout.cellSize;
      if (value > 0) {
        ctx.fillStyle = numberColors[value];
        ctx.fillRect(x + 1, y + 1, layout.cellSize - 2, layout.cellSize - 2);
        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.floor(layout.cellSize * 0.48)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), x + layout.cellSize / 2, y + layout.cellSize / 2 + 1);
      }
      ctx.strokeStyle = "rgba(148, 163, 184, 0.32)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, layout.cellSize - 1, layout.cellSize - 1);
    }
  }
  if (firstPick) {
    const x = layout.boardX + firstPick.col * layout.cellSize;
    const y = layout.boardY + firstPick.row * layout.cellSize;
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, layout.cellSize - 4, layout.cellSize - 4);
  }
  if (fxList.length > 0) {
    for (const fx of fxList) {
      fx.life -= deltaSeconds;
      const p = Math.max(0, fx.life / fx.maxLife);
      fx.vy += layout.cellSize * 18 * deltaSeconds;
      fx.vx *= 0.985;
      fx.vy *= 0.992;
      fx.x += fx.vx * deltaSeconds;
      fx.y += fx.vy * deltaSeconds;
      ctx.fillStyle = fx.color;
      ctx.globalAlpha = 0.9 * p;
      ctx.fillRect(fx.x - fx.size / 2, fx.y - fx.size / 2, fx.size, fx.size);
      ctx.globalAlpha = 0.28 * p;
      ctx.fillRect(fx.x - fx.size, fx.y - fx.size, fx.size * 2, fx.size * 2);
    }
    ctx.globalAlpha = 1;
    fxList = fxList.filter((fx) => fx.life > 0);
  }
  ctx.restore();
};
var endGame = () => {
  if (over) {
    return;
  }
  over = true;
  started = false;
  counting = false;
  stopBgm();
  window.clearInterval(tickHandle);
  timerEl.textContent = "0.00s";
  finalScoreEl.textContent = `Final Score: ${score}`;
  gameOverEl.style.display = "block";
  messenger.submitScore({ gameSlug: GAME_SLUG, score });
};
var tick = () => {
  if (!started || counting || over) {
    return;
  }
  const now = performance.now();
  const elapsed = now - lastTickAt;
  lastTickAt = now;
  timeLeftMs = Math.max(0, timeLeftMs - elapsed);
  updateHud();
  if (timeLeftMs <= 0) {
    endGame();
  }
};
var setupNewGame = () => {
  board = createBoard();
  score = 0;
  comboChain = 0;
  maxCombo = 0;
  comboBonusScore = 0;
  timeLeftMs = START_TIME_MS;
  firstPick = null;
  started = false;
  over = false;
  lastClearAt = null;
  fxList = [];
  shakeTime = 0;
  shakePower = 0;
  gameOverEl.style.display = "none";
  updateHud();
  ensurePlayable();
};
var clearBoardForCountdown = () => {
  board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0));
  firstPick = null;
  fxList = [];
  shakeTime = 0;
  shakePower = 0;
  draw(0);
};
var wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
var runCountdownAndStart = async () => {
  if (counting) {
    return;
  }
  counting = true;
  startBtn.disabled = true;
  gameOverEl.style.display = "none";
  clearBoardForCountdown();
  countdownOverlayEl.style.display = "grid";
  for (const n of [3, 2, 1]) {
    countdownTextEl.textContent = String(n);
    await wait(1e3);
  }
  countdownTextEl.textContent = "GO";
  await wait(450);
  countdownOverlayEl.style.display = "none";
  setupNewGame();
  started = true;
  counting = false;
  startBtn.style.display = "none";
  startBtn.disabled = false;
  lastTickAt = performance.now();
  statusEl.textContent = "Select two cells.";
  startBgm();
  window.clearInterval(tickHandle);
  tickHandle = window.setInterval(tick, 100);
};
var onStartPressed = async () => {
  if (counting || started) {
    return;
  }
  await ensureAudioReady();
  await runCountdownAndStart();
};
var onRestartPressed = async () => {
  if (counting) {
    return;
  }
  await ensureAudioReady();
  stopBgm();
  await runCountdownAndStart();
};
var renderPrev = performance.now();
var renderLoop = (now) => {
  const deltaSeconds = Math.min(0.05, (now - renderPrev) / 1e3);
  renderPrev = now;
  draw(deltaSeconds);
  window.requestAnimationFrame(renderLoop);
};
canvas.addEventListener("click", onBoardClick);
window.addEventListener("resize", resizeCanvas);
startBtn.addEventListener("click", onStartPressed);
restartBtn.addEventListener("click", onRestartPressed);
shakeToggleBtnEl?.addEventListener("click", () => {
  shakeEnabled = !shakeEnabled;
  shakeToggleBtnEl.dataset.on = shakeEnabled ? "true" : "false";
  shakeToggleBtnEl.textContent = `Screen Shake: ${shakeEnabled ? "ON" : "OFF"}`;
  if (!shakeEnabled) {
    shakeTime = 0;
    shakePower = 0;
  }
});
bgmToggleBtnEl?.addEventListener("click", () => {
  bgmEnabled = !bgmEnabled;
  bgmToggleBtnEl.dataset.on = bgmEnabled ? "true" : "false";
  bgmToggleBtnEl.textContent = bgmEnabled ? "\u{1F50A}" : "\u{1F507}";
  if (!bgmEnabled) {
    stopBgm(140);
    return;
  }
  if (started && !over) {
    void ensureAudioReady().then(() => startBgm());
  }
});
bgmVolumeEl?.addEventListener("input", () => {
  const raw = Number(bgmVolumeEl.value);
  bgmVolumePct = Number.isFinite(raw) ? raw : 55;
  if (audioCtx && bgmGain) {
    const now = audioCtx.currentTime;
    bgmGain.gain.cancelScheduledValues(now);
    bgmGain.gain.linearRampToValueAtTime(bgmGainFromPct(bgmVolumePct), now + 0.05);
  }
});
var disposeInit = messenger.onInit(() => {
  return;
});
window.addEventListener("beforeunload", () => {
  stopBgm();
  window.clearInterval(tickHandle);
  disposeInit();
});
clearBoardForCountdown();
updateHud();
statusEl.textContent = "Press Start";
resizeCanvas();
window.requestAnimationFrame(renderLoop);
messenger.ready(GAME_SLUG);
