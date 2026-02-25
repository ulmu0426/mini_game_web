import { createGameMessenger } from "@minigame/sdk";

const GAME_SLUG = "ten";
const ROWS = 10;
const COLS = 18;
const START_TIME_MS = 100_000;
const BONUS_WINDOW_MS = 5_000;
const TIME_REWARD_MS = 5_000;
const BGM_LENGTH_SECONDS = 50;

type CellPick = { row: number; col: number };

type Layout = {
  cellSize: number;
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
};

type ShardFx = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
};

const scoreEl = document.getElementById("score") as HTMLDivElement;
const comboEl = document.getElementById("combo") as HTMLDivElement;
const comboBonusEl = document.getElementById("combo-bonus") as HTMLDivElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const shakeToggleBtnEl = document.getElementById("shake-toggle-btn") as HTMLButtonElement | null;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const timeFillEl = document.getElementById("time-fill") as HTMLDivElement;
const countdownOverlayEl = document.getElementById("countdown-overlay") as HTMLDivElement;
const countdownTextEl = document.getElementById("countdown-text") as HTMLDivElement;
const bgmToggleBtnEl = document.getElementById("bgm-toggle-btn") as HTMLButtonElement | null;
const bgmVolumeEl = document.getElementById("bgm-volume") as HTMLInputElement | null;
const finalScoreEl = document.getElementById("final-score") as HTMLParagraphElement;
const gameOverEl = document.getElementById("game-over") as HTMLDivElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const boardWrapEl = document.getElementById("board-wrap") as HTMLDivElement;
const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("2D context unavailable");
}

const getHubOrigin = () => {
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
};

const messenger = createGameMessenger(window.parent, getHubOrigin());

const numberColors = [
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

let audioCtx: AudioContext | null = null;
let bgmBuffer: AudioBuffer | null = null;
let bgmSource: AudioBufferSourceNode | null = null;
let bgmGain: GainNode | null = null;

let board: number[][] = [];
let score = 0;
let comboChain = 0;
let maxCombo = 0;
let comboBonusScore = 0;
let timeLeftMs = START_TIME_MS;
let firstPick: CellPick | null = null;
let started = false;
let counting = false;
let over = false;
let tickHandle = 0;
let lastClearAt: number | null = null;
let lastTickAt = performance.now();
let layout: Layout = { cellSize: 40, boardX: 0, boardY: 0, boardW: 400, boardH: 720 };
let fxList: ShardFx[] = [];
let shakeTime = 0;
let shakePower = 0;
let shakeEnabled = true;
let bgmEnabled = true;
let bgmVolumePct = 55;

const randomCell = () => Math.floor(Math.random() * 9) + 1;

const createBoard = () =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => randomCell()));

const getAudioCtx = () => {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
};

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const bgmGainFromPct = (pct: number) => (clamp(pct, 0, 100) / 100) * 0.32;

const createBgmBuffer = (context: AudioContext) => {
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
  let noiseState = 0x12345678;
  const nextNoise = () => {
    noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
    return (noiseState / 4294967295) * 2 - 1;
  };
  const saw = (freq: number, t: number) => {
    const phase = (t * freq) % 1;
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
    sample +=
      Math.sin(2 * Math.PI * leadFreq * (sectionIndex === 3 ? 3 : 2) * t) *
      0.018 *
      leadEnv *
      (1 - 0.65 * breakdownMix);
    sample += Math.sin(2 * Math.PI * leadFreq * 0.5 * t) * 0.012 * leadEnv;

    if (sectionIndex === 3) {
      const padFreq = midiToFreq(64 + ((beatIndex >> 2) % 4) * 2);
      sample += Math.sin(2 * Math.PI * padFreq * t) * 0.018;
    }
    if (inBreakdown) {
      const moodPad = midiToFreq(57 + ((beatIndex >> 2) % 3) * 3);
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
    if (
      (((snareEveryBeat || beatIndex % 2 === 1) && beatTime < 0.14) || (inFillBeat && beatTime < 0.1)) &&
      !inBreakdown
    ) {
      const sEnv = Math.exp(-beatTime * 24);
      sample += nextNoise() * 0.22 * sEnv;
    }

    const hatDivision = sectionIndex === 0 ? beat / 2 : beat / 4;
    const hatTime = t % hatDivision;
    if (hatTime < 0.03 || (inFillBeat && hatTime < 0.045)) {
      const hEnv = Math.exp(-hatTime * 80);
      sample += nextNoise() * (sectionIndex === 0 ? 0.05 : 0.075) * hEnv * (1 - 0.6 * breakdownMix);
    }

    data[i] = clamp(sample, -0.92, 0.92);
  }

  return buffer;
};

const ensureAudioReady = async () => {
  const context = getAudioCtx();
  if (context.state !== "running") {
    await context.resume();
  }
  if (!bgmBuffer) {
    bgmBuffer = createBgmBuffer(context);
  }
};

const stopBgm = (fadeMs = 220) => {
  const sourceToStop = bgmSource;
  const gainToStop = bgmGain;
  bgmSource = null;
  bgmGain = null;

  if (sourceToStop) {
    if (audioCtx && gainToStop) {
      const now = audioCtx.currentTime;
      gainToStop.gain.cancelScheduledValues(now);
      gainToStop.gain.setValueAtTime(gainToStop.gain.value, now);
      gainToStop.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
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

const startBgm = () => {
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

const playPopSound = () => {
  if (!audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(360, now + 0.13);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.17);
};

const spawnShardsForCell = (row: number, col: number, color: string) => {
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

const resizeCanvas = () => {
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

const updateHud = () => {
  scoreEl.textContent = `Score: ${score}`;
  comboEl.textContent = `Max Combo: ${maxCombo}`;
  comboBonusEl.textContent = `Combo Bonus: ${comboBonusScore}`;
  timerEl.textContent = `${(timeLeftMs / 1000).toFixed(2)}s`;
  const ratio = Math.max(0, Math.min(1, timeLeftMs / START_TIME_MS));
  timeFillEl.style.transform = `scaleX(${ratio})`;
};

const sumRect = (a: CellPick, b: CellPick) => {
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

const findTenRectExists = () => {
  const prefix = Array.from({ length: ROWS + 1 }, () => Array<number>(COLS + 1).fill(0));

  for (let row = 1; row <= ROWS; row++) {
    for (let col = 1; col <= COLS; col++) {
      prefix[row][col] =
        board[row - 1][col - 1] +
        prefix[row - 1][col] +
        prefix[row][col - 1] -
        prefix[row - 1][col - 1];
    }
  }

  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let c1 = 0; c1 < COLS; c1++) {
      for (let r2 = r1; r2 < ROWS; r2++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          const sum =
            prefix[r2 + 1][c2 + 1] -
            prefix[r1][c2 + 1] -
            prefix[r2 + 1][c1] +
            prefix[r1][c1];
          if (sum === 10) {
            return true;
          }
        }
      }
    }
  }

  return false;
};

const activeCellsCount = () => {
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

const rerollBoardValues = () => {
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

const ensurePlayable = () => {
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

const removeRect = (a: CellPick, b: CellPick) => {
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

const toCell = (clientX: number, clientY: number): CellPick | null => {
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

const onBoardClick = (event: MouseEvent) => {
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

const draw = (deltaSeconds: number) => {
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

const endGame = () => {
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

const tick = () => {
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

const setupNewGame = () => {
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

const clearBoardForCountdown = () => {
  board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0));
  firstPick = null;
  fxList = [];
  shakeTime = 0;
  shakePower = 0;
  draw(0);
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const runCountdownAndStart = async () => {
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
    await wait(1000);
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

const onStartPressed = async () => {
  if (counting || started) {
    return;
  }

  await ensureAudioReady();
  await runCountdownAndStart();
};

const onRestartPressed = async () => {
  if (counting) {
    return;
  }

  await ensureAudioReady();
  stopBgm();
  await runCountdownAndStart();
};

let renderPrev = performance.now();
const renderLoop = (now: number) => {
  const deltaSeconds = Math.min(0.05, (now - renderPrev) / 1000);
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
  bgmToggleBtnEl.textContent = bgmEnabled ? "🔊" : "🔇";
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

const disposeInit = messenger.onInit(() => {
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
