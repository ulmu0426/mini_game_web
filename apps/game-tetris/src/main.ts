import Phaser from "phaser";
import { createGameMessenger } from "@minigame/sdk";

const GAME_SLUG = "tetris";
const COLS = 10;
const ROWS = 20;
const BASE_CELL = 28;
const MIN_CELL = 16;
const BOARD_PAD_X = 12;
const BOARD_PAD_Y = 12;
const HORIZONTAL_DAS_MS = 150;
const HORIZONTAL_REPEAT_MS = 50;
const BOARD_FRAME_OUTER = 14;
const BOARD_FRAME_INNER = 9;

type Point = [number, number];
type PieceDef = {
  name: string;
  color: number;
  rotations: Point[][];
};
type PieceState = {
  def: PieceDef;
  rotation: number;
  x: number;
  y: number;
};
type ShardFx = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  life: number;
  maxLife: number;
};
type RowFlashFx = {
  y: number;
  color: number;
  life: number;
  maxLife: number;
};
type Difficulty = "easy" | "normal" | "hard";
type DifficultyConfig = {
  previewCount: 1 | 2;
  scoreMultiplier: number;
  baseDropMs: number;
  pieces: PieceDef[];
};

const scoreEl = document.getElementById("score") as HTMLDivElement;
const linesEl = document.getElementById("lines") as HTMLDivElement;
const comboEl = document.getElementById("combo") as HTMLDivElement;
const difficultyEl = document.getElementById("difficulty") as HTMLSelectElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const nextPieceCanvasEl = document.getElementById("next-piece") as HTMLCanvasElement;
const nextPieceExtraCanvasEl = document.getElementById("next-piece-extra") as HTMLCanvasElement;
const nextExtraWrapEl = document.getElementById("next-extra-wrap") as HTMLDivElement;
const gameOverEl = document.getElementById("game-over") as HTMLDivElement;
const finalScoreEl = document.getElementById("final-score") as HTMLParagraphElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const pauseOverlayEl = document.getElementById("pause-overlay") as HTMLDivElement | null;
const bgmToggleBtnEl = document.getElementById("bgm-toggle-btn") as HTMLButtonElement | null;
const bgmVolumeEl = document.getElementById("bgm-volume") as HTMLInputElement | null;

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const bgmGainFromPct = (pct: number) => (clamp(pct, 0, 100) / 100) * 0.32;

class LoopBgm {
  private bpm: number;
  private bars: number;
  private beatsPerBar: number;
  private swing: number;
  private secondsPerBeat: number;
  private loopBeats: number;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private busFilter: BiquadFilterNode | null = null;
  private busCompressor: DynamicsCompressorNode | null = null;
  private isRunning = false;
  private lookaheadMs = 25;
  private scheduleAheadTime = 0.12;
  private timer: number | null = null;
  private nextNoteTime = 0;
  private currentStep = 0;
  private readonly stepsPerBeat = 4;
  private totalSteps: number;
  private targetVolume = 0.18;

  constructor({ bpm = 120, bars = 16, beatsPerBar = 4, swing = 0.03, master = 0.18 } = {}) {
    this.bpm = bpm;
    this.bars = bars;
    this.beatsPerBar = beatsPerBar;
    this.swing = swing;
    this.secondsPerBeat = 60 / this.bpm;
    this.loopBeats = this.bars * this.beatsPerBar;
    this.totalSteps = this.loopBeats * this.stepsPerBeat;
    this.targetVolume = master;
  }

  async ensureReady() {
    if (this.ctx) {
      return this.ctx;
    }
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0001;
    this.masterGain.connect(this.ctx.destination);

    this.busFilter = this.ctx.createBiquadFilter();
    this.busFilter.type = "lowpass";
    this.busFilter.frequency.value = 9000;
    this.busFilter.Q.value = 0.2;

    this.busCompressor = this.ctx.createDynamicsCompressor();
    this.busCompressor.threshold.value = -24;
    this.busCompressor.knee.value = 20;
    this.busCompressor.ratio.value = 2.6;
    this.busCompressor.attack.value = 0.005;
    this.busCompressor.release.value = 0.12;

    this.busFilter.connect(this.busCompressor);
    this.busCompressor.connect(this.masterGain);
    return this.ctx;
  }

  getContext() {
    return this.ctx;
  }

  setVolume(value: number) {
    this.targetVolume = Math.max(0.0001, value);
    if (!this.ctx || !this.masterGain) {
      return;
    }
    const t = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.linearRampToValueAtTime(this.targetVolume, t + 0.05);
  }

  async start() {
    await this.ensureReady();
    if (!this.ctx || !this.masterGain) {
      return;
    }
    if (this.isRunning) {
      return;
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    this.isRunning = true;
    this.currentStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    const t = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
    this.masterGain.gain.linearRampToValueAtTime(this.targetVolume, t + 0.08);
    this.timer = window.setInterval(() => this.scheduler(), this.lookaheadMs);
  }

  stop() {
    if (!this.ctx || !this.masterGain || !this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const t = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
    this.masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.08);
  }

  private scheduler() {
    if (!this.ctx) {
      return;
    }
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleStep(this.currentStep, this.nextNoteTime);
      this.advanceStep();
    }
  }

  private advanceStep() {
    const stepDur = this.secondsPerBeat / this.stepsPerBeat;
    const isOff16th = this.currentStep % 2 === 1;
    const swingOffset = isOff16th ? stepDur * this.swing : 0;
    this.nextNoteTime += stepDur + swingOffset;
    this.currentStep = (this.currentStep + 1) % this.totalSteps;
  }

  private scheduleStep(step: number, time: number) {
    const stepInBeat = step % this.stepsPerBeat;
    const beatIndex = Math.floor(step / this.stepsPerBeat);
    const barIndex = Math.floor(beatIndex / this.beatsPerBar);
    const beatInBar = beatIndex % this.beatsPerBar;

    this.scheduleDrums(step, time, beatInBar, stepInBeat);
    if (stepInBeat === 0 || stepInBeat === 2) {
      this.scheduleBass(beatIndex, time);
    }
    if (stepInBeat === 0) {
      this.scheduleChord(barIndex, time);
    }
    if (stepInBeat === 0 || stepInBeat === 2) {
      this.scheduleLead(barIndex, beatInBar, stepInBeat, time);
      this.scheduleCounterLead(barIndex, beatInBar, stepInBeat, time);
    }
  }

  private chordForBar(bar: number) {
    const prog = ["Am", "G", "F", "E", "Am", "G", "F", "E", "C", "G", "Am", "E", "F", "G", "E", "E"];
    return prog[bar % prog.length];
  }

  private midi(noteName: string) {
    const m = noteName.match(/^([A-G])(#|b)?(\d)$/);
    if (!m) {
      return 69;
    }
    const n = m[1];
    const accidental = m[2];
    const oct = Number.parseInt(m[3], 10);
    const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n as "A" | "B" | "C" | "D" | "E" | "F" | "G"];
    let s = semis;
    if (accidental === "#") {
      s += 1;
    }
    if (accidental === "b") {
      s -= 1;
    }
    return (oct + 1) * 12 + s;
  }

  private freq(noteName: string) {
    return midiToFreq(this.midi(noteName));
  }

  private triad(chordName: string) {
    switch (chordName) {
      case "Am":
        return ["A3", "C4", "E4"];
      case "C":
        return ["C4", "E4", "G4"];
      case "F":
        return ["F3", "A3", "C4"];
      case "G":
        return ["G3", "B3", "D4"];
      case "E":
        return ["E3", "G#3", "B3"];
      default:
        return ["A3", "C4", "E4"];
    }
  }

  private rootBass(chordName: string) {
    switch (chordName) {
      case "Am":
        return "A2";
      case "G":
        return "G2";
      case "F":
        return "F2";
      case "E":
        return "E2";
      case "C":
        return "C3";
      default:
        return "A2";
    }
  }

  private playOsc({
    type = "square",
    freq = 440,
    t = 0,
    dur = 0.12,
    gain = 0.25,
    detune = 0,
    filterHz = 0
  }: {
    type?: OscillatorType;
    freq?: number;
    t?: number;
    dur?: number;
    gain?: number;
    detune?: number;
    filterHz?: number;
  }) {
    if (!this.ctx || !this.busFilter) {
      return;
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.setValueAtTime(detune, t);

    let out: AudioNode = g;
    if (filterHz > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(filterHz, t);
      f.Q.value = 0.7;
      g.connect(f);
      out = f;
    }

    out.connect(this.busFilter);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private playNoise({ t = 0, dur = 0.04, gain = 0.12, hp = 4000 }: { t?: number; dur?: number; gain?: number; hp?: number }) {
    if (!this.ctx || !this.busFilter) {
      return;
    }
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.setValueAtTime(hp, t);
    f.Q.value = 0.7;
    src.connect(f);
    f.connect(g);
    g.connect(this.busFilter);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private scheduleDrums(step: number, t: number, beatInBar: number, stepInBeat: number) {
    if (!this.ctx || !this.busFilter) {
      return;
    }
    if (stepInBeat === 0 && (beatInBar === 0 || beatInBar === 2)) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.055);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.62, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);
      o.connect(g);
      g.connect(this.busFilter);
      o.start(t);
      o.stop(t + 0.12);
    }
    if (stepInBeat === 0 && (beatInBar === 1 || beatInBar === 3)) {
      this.playNoise({ t, dur: 0.07, gain: 0.13, hp: 1700 });
      this.playOsc({ type: "triangle", freq: 220, t, dur: 0.05, gain: 0.05, filterHz: 2600 });
    }
    if (stepInBeat === 0 || stepInBeat === 2) {
      const beatIndex = Math.floor(step / this.stepsPerBeat);
      const barIndex = Math.floor(beatIndex / this.beatsPerBar);
      const accent = barIndex % 4 === 3 && beatInBar === 3 && stepInBeat === 2 ? 1.7 : 1.0;
      this.playNoise({ t, dur: 0.02, gain: 0.055 * accent, hp: 6200 });
    }
  }

  private scheduleBass(beatIndex: number, t: number) {
    const bar = Math.floor(beatIndex / this.beatsPerBar);
    const chord = this.chordForBar(bar);
    this.playOsc({
      type: "triangle",
      freq: this.freq(this.rootBass(chord)),
      t,
      dur: this.secondsPerBeat * 0.42,
      gain: 0.17,
      filterHz: 980
    });
  }

  private scheduleChord(barIndex: number, t: number) {
    const tri = this.triad(this.chordForBar(barIndex));
    const dur = this.secondsPerBeat * 0.92;
    const detunes = [-7, 0, 7];
    for (let i = 0; i < 3; i++) {
      this.playOsc({
        type: "sawtooth",
        freq: this.freq(tri[i]),
        t,
        dur,
        gain: 0.058,
        detune: detunes[i],
        filterHz: 2300
      });
    }
  }

  private scheduleLead(barIndex: number, beatInBar: number, stepInBeat: number, t: number) {
    const slot = beatInBar * 2 + (stepInBeat === 2 ? 1 : 0);
    const motifs = [
      ["A4", "C5", "E5", "A5", "G5", "E5", "D5", "C5"],
      ["A4", "E5", "C5", "A4", "G4", "B4", "C5", "E5"],
      ["C5", "E5", "G5", "C6", "B5", "G5", "E5", "D5"],
      ["F5", "E5", "D5", "C5", "B4", "C5", "D5", "E5"]
    ];
    const phrase = Math.floor(barIndex / 4);
    const noteName = motifs[phrase][slot];
    const restProbability = phrase === 1 || phrase === 2 ? 0.15 : 0.08;
    if (Math.random() < restProbability && !(barIndex === 15 && slot === 7)) {
      return;
    }
    const isLastLong = barIndex === 15 && slot === 7;
    this.playOsc({
      type: "square",
      freq: this.freq(noteName),
      t,
      dur: isLastLong ? this.secondsPerBeat * 1.7 : this.secondsPerBeat * 0.42,
      gain: isLastLong ? 0.11 : 0.095,
      filterHz: 3400
    });
  }

  private scheduleCounterLead(barIndex: number, beatInBar: number, stepInBeat: number, t: number) {
    const slot = beatInBar * 2 + (stepInBeat === 2 ? 1 : 0);
    if (barIndex < 8) {
      return;
    }
    if (!(slot === 2 || slot === 3 || slot === 6)) {
      return;
    }
    if (Math.random() > 0.35) {
      return;
    }
    const tri = this.triad(this.chordForBar(barIndex));
    const upper = tri[2].replace(/(\d)$/, (m) => String(Number.parseInt(m, 10) + 1));
    this.playOsc({
      type: "triangle",
      freq: this.freq(upper),
      t,
      dur: this.secondsPerBeat * 0.32,
      gain: 0.04,
      filterHz: 4200
    });
  }
}

const bgmPlayer = new LoopBgm({ bpm: 120, bars: 16, swing: 0.03, master: bgmGainFromPct(55) });
let bgmEnabled = true;
let bgmVolumePct = 55;

const ensureAudioReady = async () => {
  await bgmPlayer.ensureReady();
};

const stopBgm = () => {
  bgmPlayer.stop();
};

const startBgm = async () => {
  if (!bgmEnabled) {
    return;
  }
  await bgmPlayer.start();
};

const playLineClearSound = (linesCleared: number, combo: number) => {
  const audioCtx = bgmPlayer.getContext();
  if (!audioCtx) {
    return;
  }
  const now = audioCtx.currentTime;
  const level = Math.min(4, Math.max(1, linesCleared));
  const comboBoost = Math.min(3, Math.max(0, combo - 1));
  const rootByLevel = [72, 74, 76, 79];
  const root = rootByLevel[level - 1] ?? 72;
  const notes = [root, root + 4, root + 7, root + 12 + comboBoost];
  const totalGain = Math.min(0.46, 0.28 + level * 0.05 + comboBoost * 0.03);
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.linearRampToValueAtTime(totalGain, now + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  master.connect(audioCtx.destination);

  for (let i = 0; i < notes.length; i++) {
    const t0 = now + i * 0.015;
    const osc = audioCtx.createOscillator();
    const toneGain = audioCtx.createGain();
    osc.type = i % 2 === 0 ? "square" : "triangle";
    osc.frequency.setValueAtTime(midiToFreq(notes[i]), t0);
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(notes[i] + 12), t0 + 0.09);
    toneGain.gain.setValueAtTime(0.0001, t0);
    toneGain.gain.linearRampToValueAtTime(0.8 / notes.length, t0 + 0.01);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(toneGain);
    toneGain.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  const thump = audioCtx.createOscillator();
  const thumpGain = audioCtx.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(180 + level * 20, now);
  thump.frequency.exponentialRampToValueAtTime(52, now + 0.12);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.linearRampToValueAtTime(0.3 + level * 0.04, now + 0.005);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  thump.connect(thumpGain);
  thumpGain.connect(audioCtx.destination);
  thump.start(now);
  thump.stop(now + 0.15);

  const noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.12), audioCtx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  }
  const noise = audioCtx.createBufferSource();
  const band = audioCtx.createBiquadFilter();
  const noiseGain = audioCtx.createGain();
  band.type = "bandpass";
  band.frequency.value = 1500 + level * 350;
  band.Q.value = 1.2;
  noise.buffer = noiseBuffer;
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.linearRampToValueAtTime(0.12 + level * 0.03, now + 0.005);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  noise.connect(band);
  band.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.12);

  window.setTimeout(() => {
    master.disconnect();
    thumpGain.disconnect();
    band.disconnect();
    noiseGain.disconnect();
  }, 450);
};

const TETROMINOES: PieceDef[] = [
  {
    name: "I",
    color: 0x38bdf8,
    rotations: [
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1]
      ],
      [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3]
      ],
      [
        [0, 2],
        [1, 2],
        [2, 2],
        [3, 2]
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3]
      ]
    ]
  },
  {
    name: "O",
    color: 0xfbbf24,
    rotations: [
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1]
      ]
    ]
  },
  {
    name: "T",
    color: 0xa78bfa,
    rotations: [
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [1, 2]
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [1, 2]
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, 2]
      ]
    ]
  },
  {
    name: "L",
    color: 0xfb923c,
    rotations: [
      [
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 2]
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 2]
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [1, 2]
      ]
    ]
  },
  {
    name: "J",
    color: 0x60a5fa,
    rotations: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [2, 1]
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [1, 2]
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 2]
      ],
      [
        [1, 0],
        [1, 1],
        [0, 2],
        [1, 2]
      ]
    ]
  },
  {
    name: "S",
    color: 0x4ade80,
    rotations: [
      [
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1]
      ],
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2]
      ],
      [
        [1, 1],
        [2, 1],
        [0, 2],
        [1, 2]
      ],
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2]
      ]
    ]
  },
  {
    name: "Z",
    color: 0xf87171,
    rotations: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1]
      ],
      [
        [2, 0],
        [1, 1],
        [2, 1],
        [1, 2]
      ],
      [
        [0, 1],
        [1, 1],
        [1, 2],
        [2, 2]
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 2]
      ]
    ]
  }
];

const EASY_TRIOMINO: PieceDef = {
  name: "I3",
  color: 0x22d3ee,
  rotations: [
    [
      [1, 1],
      [2, 1],
      [3, 1]
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2]
    ],
    [
      [1, 1],
      [2, 1],
      [3, 1]
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2]
    ]
  ]
};

const HARD_PENTOMINO: PieceDef = {
  name: "I5",
  color: 0xf472b6,
  rotations: [
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2]
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4]
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2]
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4]
    ]
  ]
};

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    previewCount: 2,
    scoreMultiplier: 0.8,
    baseDropMs: 620,
    pieces: [...TETROMINOES, EASY_TRIOMINO]
  },
  normal: {
    previewCount: 1,
    scoreMultiplier: 1,
    baseDropMs: 550,
    pieces: TETROMINOES
  },
  hard: {
    previewCount: 1,
    scoreMultiplier: 1.1,
    baseDropMs: 480,
    pieces: [...TETROMINOES, HARD_PENTOMINO]
  }
};

const LINE_MULTIPLIER: Record<number, number> = {
  1: 1,
  2: 1.2,
  3: 1.3,
  4: 1.5
};

const getBounds = (points: Point[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
};

const colorToCss = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

const drawPreview = (canvas: HTMLCanvasElement, piece: PieceDef | null) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!piece) {
    return;
  }

  const rotation = piece.rotations[0];
  const bounds = getBounds(rotation);
  const shapeW = bounds.maxX - bounds.minX + 1;
  const shapeH = bounds.maxY - bounds.minY + 1;
  const usable = Math.min(canvas.width, canvas.height) - 12;
  const cell = Math.max(8, Math.floor(Math.min(usable / Math.max(shapeW, 1), usable / Math.max(shapeH, 1))));
  const drawW = shapeW * cell;
  const drawH = shapeH * cell;
  const baseX = Math.floor((canvas.width - drawW) / 2);
  const baseY = Math.floor((canvas.height - drawH) / 2);

  ctx.fillStyle = colorToCss(piece.color);
  for (const [x, y] of rotation) {
    const gx = x - bounds.minX;
    const gy = y - bounds.minY;
    const px = baseX + gx * cell;
    const py = baseY + gy * cell;
    const radius = Math.max(2, Math.floor(cell * 0.22));
    ctx.beginPath();
    ctx.roundRect(px + 1, py + 1, cell - 2, cell - 2, radius);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(px + 2, py + 2, cell - 4, Math.max(2, Math.floor(cell * 0.3)));
    ctx.fillStyle = colorToCss(piece.color);
  }
};

const readDifficulty = (): Difficulty => {
  const raw = difficultyEl.value;
  if (raw === "easy" || raw === "hard") {
    return raw;
  }
  return "normal";
};

const setStartButtonMode = (mode: "start" | "pause" | "resume") => {
  if (mode === "start") {
    startBtn.textContent = "Start";
    return;
  }
  if (mode === "pause") {
    startBtn.textContent = "Pause";
    return;
  }
  startBtn.textContent = "Resume";
};

class TetrisScene extends Phaser.Scene {
  private board: number[][] = [];
  private colorMap: number[] = [0x1e293b];
  private colorIndexByName = new Map<string, number>();
  private piecePool: PieceDef[] = TETROMINOES;
  private nextQueue: PieceDef[] = [];
  private current: PieceState | null = null;
  private difficulty: Difficulty = "normal";
  private config: DifficultyConfig = DIFFICULTY_CONFIG.normal;
  private started = false;
  private paused = false;
  private cell = BASE_CELL;
  private boardW = COLS * BASE_CELL;
  private boardH = ROWS * BASE_CELL;
  private dropElapsed = 0;
  private dropMs = DIFFICULTY_CONFIG.normal.baseDropMs;
  private leftRepeatMs = 0;
  private rightRepeatMs = 0;
  private score = 0;
  private lines = 0;
  private combo = 0;
  private fxList: ShardFx[] = [];
  private rowFlashList: RowFlashFx[] = [];
  private boardBaseX = 0;
  private boardBaseY = 0;
  private shakeTime = 0;
  private shakePower = 0;
  private over = false;
  private graphics!: Phaser.GameObjects.Graphics;
  private keys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("tetris-scene");
  }

  create() {
    this.graphics = this.add.graphics();
    this.keys = {
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      space: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    };
    this.scale.on("resize", this.onScaleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onScaleResize, this);
    });

    this.resetToLobby();
    messenger.ready(GAME_SLUG);
  }

  update(_: number, delta: number) {
    if (!this.started || this.over || this.paused || !this.current) {
      return;
    }

    this.handleHorizontalMove(delta);
    if (Phaser.Input.Keyboard.JustDown(this.keys.up)) {
      this.tryRotate();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
      this.hardDrop();
    }

    const speed = this.keys.down.isDown ? 50 : this.dropMs;
    this.dropElapsed += delta;
    if (this.dropElapsed >= speed) {
      this.dropElapsed = 0;
      if (!this.tryMove(0, 1)) {
        this.lockPiece();
        this.clearLines();
        this.spawn();
      }
    }

    this.updateFx(delta / 1000);
    this.draw();
  }

  async startGame(difficulty: Difficulty) {
    await ensureAudioReady();
    await startBgm();
    this.started = true;
    this.paused = false;
    this.over = false;
    this.difficulty = difficulty;
    this.config = DIFFICULTY_CONFIG[difficulty];
    this.piecePool = this.config.pieces;
    this.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
    this.current = null;
    this.nextQueue = [];
    this.dropElapsed = 0;
    this.dropMs = this.config.baseDropMs;
    this.leftRepeatMs = 0;
    this.rightRepeatMs = 0;
    this.score = 0;
    this.lines = 0;
    this.combo = 0;
    this.fxList = [];
    this.rowFlashList = [];
    this.shakeTime = 0;
    this.shakePower = 0;
    gameOverEl.style.display = "none";
    if (pauseOverlayEl) {
      pauseOverlayEl.style.display = "none";
    }
    difficultyEl.disabled = true;
    setStartButtonMode("pause");
    this.rebuildColorMap();
    this.refillQueue(this.config.previewCount + 2);
    this.spawn();
    this.updateHud();
    this.updatePreview();
    this.draw();
  }

  private resetToLobby() {
    stopBgm();
    this.started = false;
    this.paused = false;
    this.over = false;
    this.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
    this.current = null;
    this.nextQueue = [];
    this.leftRepeatMs = 0;
    this.rightRepeatMs = 0;
    this.score = 0;
    this.lines = 0;
    this.combo = 0;
    this.fxList = [];
    this.rowFlashList = [];
    this.shakeTime = 0;
    this.shakePower = 0;
    this.difficulty = readDifficulty();
    this.config = DIFFICULTY_CONFIG[this.difficulty];
    this.piecePool = this.config.pieces;
    if (pauseOverlayEl) {
      pauseOverlayEl.style.display = "none";
    }
    setStartButtonMode("start");
    this.rebuildColorMap();
    this.updateHud();
    this.updatePreview();
    this.updateBoardMetrics();
    this.draw();
  }

  private onScaleResize() {
    this.updateBoardMetrics();
    this.draw();
  }

  private updateBoardMetrics() {
    const hudHeight = (document.getElementById("hud")?.getBoundingClientRect().height ?? 0) + 24;
    const availableW = Math.max(1, this.scale.width - BOARD_PAD_X * 2);
    const availableH = Math.max(1, this.scale.height - hudHeight - BOARD_PAD_Y * 2);
    const nextCell = Math.max(MIN_CELL, Math.min(BASE_CELL, Math.floor(Math.min(availableW / COLS, availableH / ROWS))));

    this.cell = nextCell;
    this.boardW = COLS * this.cell;
    this.boardH = ROWS * this.cell;

    const boardX = Math.floor((this.scale.width - this.boardW) / 2);
    const topBound = Math.floor(hudHeight + BOARD_PAD_Y);
    const boardY = Math.max(topBound, Math.floor((this.scale.height - this.boardH) / 2));
    this.boardBaseX = boardX;
    this.boardBaseY = boardY;
    this.graphics.setPosition(this.boardBaseX, this.boardBaseY);
  }

  private rebuildColorMap() {
    this.colorMap = [0x1e293b];
    this.colorIndexByName.clear();
    for (const piece of this.piecePool) {
      this.colorMap.push(piece.color);
      this.colorIndexByName.set(piece.name, this.colorMap.length - 1);
    }
  }

  private updateHud() {
    scoreEl.textContent = `Score: ${this.score}`;
    linesEl.textContent = `Lines: ${this.lines}`;
    comboEl.textContent = `Combo: ${this.combo}`;
  }

  private updatePreview() {
    nextExtraWrapEl.style.display = this.config.previewCount > 1 ? "block" : "none";
    drawPreview(nextPieceCanvasEl, this.nextQueue[0] ?? null);
    drawPreview(nextPieceExtraCanvasEl, this.config.previewCount > 1 ? (this.nextQueue[1] ?? null) : null);
  }

  private randomPiece() {
    return this.piecePool[Math.floor(Math.random() * this.piecePool.length)];
  }

  private refillQueue(minSize: number) {
    while (this.nextQueue.length < minSize) {
      this.nextQueue.push(this.randomPiece());
    }
  }

  private takeNextPiece() {
    this.refillQueue(this.config.previewCount + 1);
    const next = this.nextQueue.shift();
    if (!next) {
      return this.randomPiece();
    }
    this.refillQueue(this.config.previewCount + 1);
    return next;
  }

  private activeCells(piece: PieceState): Point[] {
    return piece.def.rotations[piece.rotation].map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
  }

  private canPlace(piece: PieceState): boolean {
    const cells = this.activeCells(piece);
    for (const [x, y] of cells) {
      if (x < 0 || x >= COLS || y >= ROWS) {
        return false;
      }
      if (y >= 0 && this.board[y][x] !== 0) {
        return false;
      }
    }
    return true;
  }

  private spawn() {
    const def = this.takeNextPiece();
    const spawnRotation = def.rotations[0];
    const bounds = getBounds(spawnRotation);
    const width = bounds.maxX - bounds.minX + 1;
    const piece: PieceState = {
      def,
      rotation: 0,
      x: Math.floor((COLS - width) / 2) - bounds.minX,
      y: -bounds.minY - 1
    };
    if (!this.canPlace(piece)) {
      this.gameOver();
      return;
    }
    this.current = piece;
    this.updatePreview();
  }

  private handleHorizontalMove(delta: number) {
    const leftDown = this.keys.left.isDown;
    const rightDown = this.keys.right.isDown;

    if (leftDown === rightDown) {
      this.leftRepeatMs = 0;
      this.rightRepeatMs = 0;
      return;
    }

    if (leftDown) {
      this.rightRepeatMs = 0;
      if (Phaser.Input.Keyboard.JustDown(this.keys.left)) {
        this.tryMove(-1, 0);
        this.leftRepeatMs = HORIZONTAL_DAS_MS;
        return;
      }

      this.leftRepeatMs -= delta;
      while (this.leftRepeatMs <= 0) {
        this.tryMove(-1, 0);
        this.leftRepeatMs += HORIZONTAL_REPEAT_MS;
      }
      return;
    }

    this.leftRepeatMs = 0;
    if (Phaser.Input.Keyboard.JustDown(this.keys.right)) {
      this.tryMove(1, 0);
      this.rightRepeatMs = HORIZONTAL_DAS_MS;
      return;
    }

    this.rightRepeatMs -= delta;
    while (this.rightRepeatMs <= 0) {
      this.tryMove(1, 0);
      this.rightRepeatMs += HORIZONTAL_REPEAT_MS;
    }
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.current) {
      return false;
    }
    const next: PieceState = {
      def: this.current.def,
      rotation: this.current.rotation,
      x: this.current.x + dx,
      y: this.current.y + dy
    };
    if (!this.canPlace(next)) {
      return false;
    }
    this.current = next;
    return true;
  }

  private tryRotate() {
    if (!this.current) {
      return;
    }
    const rotated: PieceState = {
      def: this.current.def,
      rotation: (this.current.rotation + 1) % 4,
      x: this.current.x,
      y: this.current.y
    };
    if (this.canPlace(rotated)) {
      this.current = rotated;
      return;
    }
    for (const kick of [-1, 1, -2, 2]) {
      const kicked = { ...rotated, x: rotated.x + kick };
      if (this.canPlace(kicked)) {
        this.current = kicked;
        return;
      }
    }
  }

  private scoreWithDifficulty(raw: number) {
    return Math.max(0, Math.round(raw * this.config.scoreMultiplier));
  }

  private hardDrop() {
    let distance = 0;
    while (this.tryMove(0, 1)) {
      distance += 1;
    }
    if (distance > 0) {
      this.score += this.scoreWithDifficulty(distance);
      this.updateHud();
    }
  }

  private lockPiece() {
    if (!this.current) {
      return;
    }
    const colorIndex = this.colorIndexByName.get(this.current.def.name) ?? 1;
    for (const [x, y] of this.activeCells(this.current)) {
      if (y >= 0 && y < ROWS) {
        this.board[y][x] = colorIndex;
      }
    }
    this.current = null;
  }

  private clearLines() {
    let cleared = 0;
    const clearedRows: Array<{ y: number; colors: number[] }> = [];
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.board[y].every((cell) => cell !== 0)) {
        clearedRows.push({ y, colors: [...this.board[y]] });
        this.board.splice(y, 1);
        this.board.unshift(Array<number>(COLS).fill(0));
        cleared++;
        y++;
      }
    }

    if (cleared === 0) {
      this.combo = 0;
      this.updateHud();
      return;
    }

    this.spawnLineClearFx(clearedRows);
    playLineClearSound(cleared, this.combo + 1);
    this.shakeTime = Math.max(this.shakeTime, 0.18 + cleared * 0.03);
    this.shakePower = Math.max(this.shakePower, 2.2 + cleared * 1.2);

    this.combo += 1;
    const lineMulti = LINE_MULTIPLIER[cleared] ?? 1.5;
    const base = Math.round(cleared * 100 * lineMulti);
    const comboBonus = this.combo > 1 ? Math.round(base * 0.2 * (this.combo - 1)) : 0;
    const gained = this.scoreWithDifficulty(base + comboBonus);

    this.lines += cleared;
    this.score += gained;
    this.dropMs = Math.max(90, this.config.baseDropMs - Math.floor(this.lines / 5) * 40);
    this.updateHud();
  }

  private draw() {
    if (this.shakeTime > 0) {
      const amount = this.shakePower * (this.shakeTime / 0.24);
      const ox = (Math.random() - 0.5) * amount * 2;
      const oy = (Math.random() - 0.5) * amount * 2;
      this.graphics.setPosition(this.boardBaseX + ox, this.boardBaseY + oy);
    } else {
      this.graphics.setPosition(this.boardBaseX, this.boardBaseY);
    }

    this.graphics.clear();
    this.graphics.fillStyle(0xffe48c, 1);
    this.graphics.fillRoundedRect(
      -BOARD_FRAME_OUTER,
      -BOARD_FRAME_OUTER,
      this.boardW + BOARD_FRAME_OUTER * 2,
      this.boardH + BOARD_FRAME_OUTER * 2,
      18
    );
    this.graphics.fillStyle(0xd99a3c, 1);
    this.graphics.fillRoundedRect(
      -BOARD_FRAME_INNER,
      -BOARD_FRAME_INNER,
      this.boardW + BOARD_FRAME_INNER * 2,
      this.boardH + BOARD_FRAME_INNER * 2,
      14
    );
    this.graphics.fillStyle(0xffffff, 1);
    this.graphics.fillRoundedRect(0, 0, this.boardW, this.boardH, 10);
    this.graphics.fillStyle(0xf8fafc, 1);
    this.graphics.fillRect(0, 0, this.boardW, this.boardH * 0.45);
    this.graphics.fillStyle(0xffffff, 0.8);
    this.graphics.fillRect(0, 0, this.boardW, Math.max(2, this.cell * 0.3));

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        this.drawCell(x, y, this.board[y][x]);
      }
    }

    if (this.current) {
      const colorIndex = this.colorIndexByName.get(this.current.def.name) ?? 1;
      for (const [x, y] of this.activeCells(this.current)) {
        if (y >= 0) {
          this.drawCell(x, y, colorIndex);
        }
      }
    }

    this.graphics.lineStyle(1, 0x94a3b8, 0.35);
    for (let x = 0; x <= COLS; x++) {
      this.graphics.lineBetween(x * this.cell, 0, x * this.cell, this.boardH);
    }
    for (let y = 0; y <= ROWS; y++) {
      this.graphics.lineBetween(0, y * this.cell, this.boardW, y * this.cell);
    }
    this.drawFx();
  }

  private drawCell(x: number, y: number, colorIndex: number) {
    if (colorIndex === 0) {
      return;
    }
    const px = x * this.cell + 1;
    const py = y * this.cell + 1;
    const size = this.cell - 2;
    const radius = Math.max(3, this.cell * 0.2);

    this.graphics.fillStyle(this.colorMap[colorIndex], 1);
    this.graphics.fillRoundedRect(px, py, size, size, radius);
    this.graphics.fillStyle(0xffffff, 0.26);
    this.graphics.fillRoundedRect(px + 1.5, py + 1.5, size - 3, Math.max(2, size * 0.33), Math.max(2, radius - 1));
    this.graphics.fillStyle(0x0f172a, 0.16);
    this.graphics.fillRoundedRect(px + 2, py + size * 0.63, size - 4, Math.max(2, size * 0.24), Math.max(2, radius - 1));
    this.graphics.lineStyle(1, 0xffffff, 0.34);
    this.graphics.strokeRoundedRect(px + 0.5, py + 0.5, size - 1, size - 1, Math.max(2, radius - 1));
  }

  private spawnLineClearFx(rows: Array<{ y: number; colors: number[] }>) {
    const speedBase = this.cell * 10.8;
    for (const row of rows) {
      const y = row.y;
      this.rowFlashList.push({
        y,
        color: 0xffffff,
        life: 0.18,
        maxLife: 0.18
      });
      for (let x = 0; x < COLS; x++) {
        const colorIndex = row.colors[x] ?? 0;
        if (colorIndex === 0) {
          continue;
        }
        const cx = x * this.cell + this.cell / 2;
        const cy = y * this.cell + this.cell / 2;
        for (let i = 0; i < 16; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = speedBase * (0.8 + Math.random() * 0.9);
          this.fxList.push({
            x: cx + (Math.random() - 0.5) * 4,
            y: cy + (Math.random() - 0.5) * 4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.92,
            size: Math.max(2, this.cell * (0.11 + Math.random() * 0.15)),
            color: this.colorMap[colorIndex] ?? 0xffffff,
            life: 0.42 + Math.random() * 0.28,
            maxLife: 0.72
          });
        }
      }
    }
  }

  private updateFx(deltaSeconds: number) {
    for (const fx of this.fxList) {
      fx.life -= deltaSeconds;
      fx.vy += this.cell * 13 * deltaSeconds;
      fx.vx *= 0.982;
      fx.vy *= 0.988;
      fx.x += fx.vx * deltaSeconds;
      fx.y += fx.vy * deltaSeconds;
    }
    this.fxList = this.fxList.filter((fx) => fx.life > 0);
    for (const flash of this.rowFlashList) {
      flash.life -= deltaSeconds;
    }
    this.rowFlashList = this.rowFlashList.filter((flash) => flash.life > 0);
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - deltaSeconds);
      this.shakePower *= 0.9;
    }
  }

  private drawFx() {
    for (const flash of this.rowFlashList) {
      const a = Math.max(0, flash.life / flash.maxLife);
      this.graphics.fillStyle(flash.color, 0.24 * a);
      this.graphics.fillRect(0, flash.y * this.cell, this.boardW, this.cell);
      this.graphics.fillStyle(0xffffff, 0.52 * a);
      this.graphics.fillRect(0, flash.y * this.cell + this.cell * 0.4, this.boardW, Math.max(2, this.cell * 0.18));
    }
    if (this.fxList.length === 0) {
      return;
    }
    for (const fx of this.fxList) {
      const alpha = Math.max(0, fx.life / fx.maxLife);
      this.graphics.fillStyle(fx.color, 0.85 * alpha);
      this.graphics.fillRect(fx.x - fx.size / 2, fx.y - fx.size / 2, fx.size, fx.size);
      this.graphics.fillStyle(0xffffff, 0.2 * alpha);
      this.graphics.fillRect(fx.x - fx.size * 0.8, fx.y - fx.size * 0.8, fx.size * 1.6, fx.size * 1.6);
    }
  }

  private gameOver() {
    this.started = false;
    this.paused = false;
    this.over = true;
    stopBgm();
    difficultyEl.disabled = false;
    if (pauseOverlayEl) {
      pauseOverlayEl.style.display = "none";
    }
    setStartButtonMode("start");
    finalScoreEl.textContent = `Final Score: ${this.score}`;
    gameOverEl.style.display = "block";
    messenger.submitScore({
      gameSlug: GAME_SLUG,
      score: this.score,
      mode: this.difficulty
    });
  }

  async handleStartPause() {
    if (this.over) {
      await this.startGame(readDifficulty());
      return;
    }
    if (!this.started) {
      await this.startGame(readDifficulty());
      return;
    }
    if (!this.paused) {
      this.paused = true;
      stopBgm();
      if (pauseOverlayEl) {
        pauseOverlayEl.style.display = "grid";
      }
      setStartButtonMode("resume");
      return;
    }
    this.paused = false;
    if (pauseOverlayEl) {
      pauseOverlayEl.style.display = "none";
    }
    await startBgm();
    setStartButtonMode("pause");
  }

  shouldPlayBgm() {
    return this.started && !this.paused && !this.over;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  transparent: true,
  width: window.innerWidth,
  height: window.innerHeight,
  scene: [TetrisScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

const getScene = () => game.scene.getScene("tetris-scene") as TetrisScene;

startBtn.addEventListener("click", async () => {
  await getScene().handleStartPause();
});

restartBtn.addEventListener("click", async () => {
  await getScene().startGame(readDifficulty());
});

difficultyEl.addEventListener("change", () => {
  if (gameOverEl.style.display !== "block") {
    drawPreview(nextPieceCanvasEl, null);
    drawPreview(nextPieceExtraCanvasEl, null);
    nextExtraWrapEl.style.display = readDifficulty() === "easy" ? "block" : "none";
  }
});

bgmToggleBtnEl?.addEventListener("click", async () => {
  bgmEnabled = !bgmEnabled;
  bgmToggleBtnEl.dataset.on = bgmEnabled ? "true" : "false";
  bgmToggleBtnEl.textContent = bgmEnabled ? "\uD83D\uDD0A" : "\uD83D\uDD07";
  if (!bgmEnabled) {
    stopBgm();
    return;
  }
  bgmPlayer.setVolume(bgmGainFromPct(bgmVolumePct));
  if (getScene().shouldPlayBgm()) {
    await ensureAudioReady();
    await startBgm();
  }
});

bgmVolumeEl?.addEventListener("input", () => {
  const raw = Number(bgmVolumeEl.value);
  bgmVolumePct = Number.isFinite(raw) ? raw : 55;
  bgmPlayer.setVolume(bgmGainFromPct(bgmVolumePct));
});

if (bgmVolumeEl) {
  const raw = Number(bgmVolumeEl.value);
  bgmVolumePct = Number.isFinite(raw) ? raw : 55;
  bgmPlayer.setVolume(bgmGainFromPct(bgmVolumePct));
}

const disposeInit = messenger.onInit(() => {
  return;
});

window.addEventListener("beforeunload", () => {
  stopBgm();
  disposeInit();
  game.destroy(true);
});
