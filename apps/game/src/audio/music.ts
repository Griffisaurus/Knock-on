// Procedural music v2 (AUDIO.md §8), in the world key (C major / A minor).
//
// Build: a calm generative bed at 72 BPM. Chords random-walk a small diatonic graph every 2 bars
// (soft detuned-saw pads + a sine sub), and sparse FM "glass piano" plinks pick pentatonic notes.
// v2 (M3): the bed is arranged in 16-bar sections; each section shuffles which extra stems play over the
// pads and plinks (marimba arpeggios, an electric-piano comp, soft brushes), so long build sessions keep
// changing (the "stem shuffle" of AUDIO §8) at ~1–3 sources per second.
//
// Run: a 112 BPM electro-funk vamp with layers that add as the machine heats up:
// L0 bass + light hats → L1 drums → L2 brass stabs → L3 synth lead → L4 choir "whoa".
// v2 (M3 scale): a 16-bar A/B form (the B section moves to F–G–Em–Am), drum fills into each 8th bar at high
// intensity, and L5 "barrage": taiko, low brass swells and crashes that follow explosion density (yield
// per 0.5 s, not just the heat integrator), with accents quantised to the next 8th on big booms. The
// Kiloton moment (> 40 yield in 2 s) gets a drop: a riser into the next downbeat, a one-beat breath, then
// everything slams back in with the choir for 8 bars.
//
// All instruments are single pre-rendered notes re-pitched by playbackRate; voices are scheduled with a
// lookahead scheduler on AudioContext time, so frame hitches never make the groove stumble.

import { Rng } from './rng';
import {
  SR, bp, chirp, contact, envAD, envFn, fadeEdges, glide, hp, lp, mixInto, modal, normalize, pulse, saw, seamless, softClip, sweep, white, yieldToMain,
} from './synth';
import { toBuffer } from './bank';
import { clamp } from './types';

const A1 = 33, A3 = 57, A4 = 69;

// ---------- instruments ----------

function padLoop(rng: Rng): Float32Array {
  // detuned saws around A3, low-passed with a slow-moving cutoff; seamless 6 s loop
  return normalize(seamless(6, 1.2, (len) => {
    const x = new Float32Array(len);
    for (const [d, a] of [[-0.07, 1], [0, 1], [0.08, 1], [-12, 0.5]] as const) {
      const s = saw(len, 220 * Math.pow(2, d / 12), rng.next());
      mixInto(x, s, 0, a);
    }
    sweep(x, 'lp', (t) => 900 + 400 * Math.sin(2 * Math.PI * t / 6), 0.6);
    lp(x, 2400);
    return x;
  }), 0.5);
}

function subLoop(): Float32Array {
  const len = SR; // 1 s: 55 Hz → 55 whole cycles, so it loops perfectly
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) { const p = 2 * Math.PI * 55 * i / SR; x[i] = Math.sin(p) + 0.15 * Math.sin(2 * p); }
  return normalize(x, 0.5);
}

function keyNote(): Float32Array {
  // two-operator FM "glass piano" at A4
  const len = Math.round(3 * SR);
  const x = new Float32Array(len);
  const f = 440;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const I = 0.2 + 1.6 * Math.exp(-t / 0.25);
    const m = Math.sin(2 * Math.PI * f * t);
    const tine = 0.18 * Math.sin(2 * Math.PI * f * 4.0 * t) * Math.exp(-t / 0.08);
    x[i] = (Math.sin(2 * Math.PI * f * t + I * m) + tine) * Math.min(1, t / 0.003) * Math.exp(-t / 0.9);
  }
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.1);
}

function malletNote(rng: Rng): Float32Array {
  // marimba at A4: bar modes 1 : 4 : 9.2 with a soft yarn mallet
  const f = 440;
  const x = modal(Math.round(1.4 * SR), contact(0.0012, rng), [{ f, amp: 1, tau: 0.5 }, { f: f * 3.99, amp: 0.25, tau: 0.09 }, { f: f * 9.2, amp: 0.06, tau: 0.03 }]);
  return fadeEdges(normalize(x, 0.5), 0.0003, 0.1);
}

function epNote(): Float32Array {
  // electric piano at A3: FM bell-ish attack that mellows, a short tine
  const len = Math.round(3 * SR);
  const x = new Float32Array(len);
  const f = 220;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const I = 0.3 + 1.8 * Math.exp(-t / 0.18);
    x[i] = (Math.sin(2 * Math.PI * f * t + I * Math.sin(2 * Math.PI * f * t)) + 0.25 * Math.sin(2 * Math.PI * f * 7 * t) * Math.exp(-t / 0.03))
      * Math.min(1, t / 0.002) * (0.6 * Math.exp(-t / 0.5) + 0.4 * Math.exp(-t / 1.6));
  }
  return fadeEdges(normalize(lp(x, 4000), 0.5), 0.0003, 0.2);
}

function kick(): Float32Array {
  const len = Math.round(0.45 * SR);
  const x = chirp(len, glide(170, 48, 0.035), (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.17));
  const c = chirp(Math.round(0.006 * SR), () => 1800, (t) => Math.exp(-t / 0.0015));
  mixInto(x, c, 0, 0.3);
  return fadeEdges(normalize(softClip(x, 1.4), 0.5));
}

function snare(rng: Rng): Float32Array {
  const len = Math.round(0.3 * SR);
  const x = chirp(len, glide(240, 180, 0.02), (t) => Math.exp(-t / 0.045));
  mixInto(x, chirp(len, () => 330, (t) => 0.4 * Math.exp(-t / 0.03)));
  const n = bp(white(len, rng), 4000, 0.5);
  envAD(n, 0.0005, 0.085);
  mixInto(x, normalize(n, 1.1));
  return fadeEdges(normalize(x, 0.5));
}

function clap(rng: Rng): Float32Array {
  const len = Math.round(0.35 * SR);
  const x = new Float32Array(len);
  for (const at of [0, 0.011, 0.022]) {
    const b = envAD(white(Math.round(0.02 * SR), rng), 0.0003, 0.004);
    mixInto(x, b, Math.round(at * SR));
  }
  const tail = envAD(white(len, rng), 0.0005, 0.06, 0.03);
  mixInto(x, tail, 0, 0.6);
  bp(x, 1300, 0.7);
  return fadeEdges(normalize(x, 0.5));
}

function hat(open: boolean, rng: Rng): Float32Array {
  const len = Math.round((open ? 0.45 : 0.09) * SR);
  const x = white(len, rng);
  // add a little metallic ring from inharmonic squares (808-style)
  for (const f of [205, 304, 369, 522, 540, 800]) {
    const s = pulse(len, f * 4.1);
    mixInto(x, s, 0, 0.12);
  }
  hp(x, 7000);
  envAD(x, 0.0005, open ? 0.15 : 0.022);
  return fadeEdges(normalize(x, 0.5));
}

function shaker(rng: Rng): Float32Array {
  const len = Math.round(0.08 * SR);
  const x = bp(white(len, rng), 6000, 0.8);
  envFn(x, (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.025));
  return fadeEdges(normalize(x, 0.5));
}

function bassPluck(): Float32Array {
  const len = Math.round(0.7 * SR);
  const x = saw(len, 55);
  mixInto(x, pulse(len, 55, 0.5), 0, 0.5);
  mixInto(x, chirp(len, () => 55), 0, 0.8);
  sweep(x, 'lp', (t) => 170 + 2300 * Math.exp(-t / 0.07), 2.2);
  envFn(x, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.28));
  return fadeEdges(normalize(softClip(normalize(x, 1), 1.5), 0.5));
}

function brass(rng: Rng): Float32Array {
  const len = Math.round(0.55 * SR);
  const x = new Float32Array(len);
  for (const d of [-0.12, -0.04, 0.05, 0.11]) mixInto(x, saw(len, 440 * Math.pow(2, d / 12), rng.next()), 0, 0.5);
  sweep(x, 'lp', (t) => (t < 0.025 ? 700 + 2600 * t / 0.025 : 1300 + 2000 * Math.exp(-(t - 0.025) / 0.08)), 1.2);
  envFn(x, (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.17));
  return fadeEdges(normalize(x, 0.5));
}

function swellNote(rng: Rng): Float32Array {
  // low brass swell at A3: slow filter and level rise, then a fall
  const len = Math.round(1.9 * SR);
  const x = new Float32Array(len);
  for (const d of [-0.1, -0.03, 0.04, 0.12]) mixInto(x, saw(len, 220 * Math.pow(2, d / 12), rng.next()), 0, 0.5);
  sweep(x, 'lp', (t) => 350 + 2200 * Math.min(1, t / 1.2), 1);
  envFn(x, (t) => (t < 1.1 ? Math.pow(t / 1.1, 1.5) : Math.exp(-(t - 1.1) / 0.3)));
  return fadeEdges(normalize(x, 0.5), 0.001, 0.1);
}

function leadNote(): Float32Array {
  const len = Math.round(0.6 * SR);
  const x = pulse(len, 440, 0.3, (t) => (t > 0.12 ? 0.18 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, (t - 0.12) / 0.1) : 0));
  lp(x, 3200, 0.9);
  envFn(x, (t) => Math.min(1, t / 0.005) * (0.6 + 0.4 * Math.exp(-t / 0.06)) * Math.exp(-t / 0.35));
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.08);
}

function choirNote(rng: Rng): Float32Array {
  // "whoa": saw bank through moving formants u → a → o, slight fall at the end
  const len = Math.round(2.4 * SR);
  const src = new Float32Array(len);
  for (const d of [-0.1, 0, 0.09, 0.17]) {
    const s = new Float32Array(len);
    let p = rng.next();
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = 220 * Math.pow(2, d / 12) * (1 + 0.006 * Math.sin(2 * Math.PI * 5 * t + d * 9)) * (t > 1.7 ? Math.pow(2, -1.5 * (t - 1.7) / 12) : 1);
      s[i] = 2 * p - 1; p += f / SR; if (p >= 1) p -= 1;
    }
    mixInto(src, s, 0, 0.5);
  }
  const fm = (t: number, a: number, b: number, c: number) => (t < 0.18 ? a + (b - a) * t / 0.18 : b + (c - b) * Math.min(1, (t - 0.18) / 0.6));
  const x = new Float32Array(len);
  const f1 = src.slice(), f2 = src.slice(), f3 = src.slice();
  sweep(f1, 'bp', (t) => fm(t, 300, 730, 500), 6);
  sweep(f2, 'bp', (t) => fm(t, 870, 1090, 850), 7);
  sweep(f3, 'bp', (t) => fm(t, 2240, 2440, 2600), 9);
  mixInto(x, f1); mixInto(x, f2, 0, 0.6); mixInto(x, f3, 0, 0.25);
  envFn(x, (t) => Math.min(1, t / 0.12) * (t > 1.6 ? Math.max(0, 1 - (t - 1.6) / 0.8) : 1));
  return fadeEdges(normalize(x, 0.5), 0.001, 0.05);
}

function taiko(rng: Rng): Float32Array {
  const len = Math.round(1.2 * SR);
  const x = chirp(len, glide(115, 58, 0.05), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.35));
  mixInto(x, normalize(bp(envAD(white(Math.round(0.06 * SR), rng), 0.0005, 0.012), 900, 0.8), 0.5));
  const skin = bp(white(len, rng), 220, 2);
  envAD(skin, 0.002, 0.12);
  mixInto(x, normalize(skin, 0.35));
  return fadeEdges(normalize(softClip(normalize(x, 1), 1.3), 0.5), 0.0002, 0.1);
}

function crash(rng: Rng): Float32Array {
  const len = Math.round(2.6 * SR);
  const x = white(len, rng);
  for (const f of [341, 497, 613, 787, 922, 1303]) mixInto(x, pulse(len, f * 3.3), 0, 0.08);
  hp(x, 3500);
  envFn(x, (t) => Math.min(1, t / 0.001) * (0.5 * Math.exp(-t / 0.15) + 0.5 * Math.exp(-t / 0.9)));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.3);
}

function riser(rng: Rng): Float32Array {
  const len = Math.round(2 * SR);
  const n = white(len, rng);
  sweep(n, 'bp', (t) => 300 + 5700 * Math.pow(t / 2, 2), 1.4);
  envFn(n, (t) => Math.pow(t / 2, 1.6));
  const x = normalize(n, 0.7);
  mixInto(x, chirp(len, (t) => 220 * Math.pow(4, t / 2), (t) => 0.25 * Math.pow(t / 2, 2)));
  return fadeEdges(normalize(x, 0.4), 0.01, 0.01);
}

export interface MusicBank {
  pad: AudioBuffer; sub: AudioBuffer; keys: AudioBuffer;
  kick: AudioBuffer; snare: AudioBuffer; clap: AudioBuffer; hatC: AudioBuffer; hatO: AudioBuffer; shaker: AudioBuffer;
  bass: AudioBuffer; brass: AudioBuffer; lead: AudioBuffer; choir: AudioBuffer;
  // v2
  mallet: AudioBuffer; ep: AudioBuffer; taiko: AudioBuffer; crash: AudioBuffer; swell: AudioBuffer; riser: AudioBuffer;
}


export async function buildMusicBank(): Promise<MusicBank> {
  const r = (s: string) => new Rng(`music/${s}`);
  const steps: [keyof MusicBank, () => Float32Array][] = [
    ['pad', () => padLoop(r('pad'))], ['sub', subLoop], ['keys', keyNote],
    ['kick', kick], ['snare', () => snare(r('snare'))], ['clap', () => clap(r('clap'))],
    ['hatC', () => hat(false, r('hatC'))], ['hatO', () => hat(true, r('hatO'))], ['shaker', () => shaker(r('shaker'))],
    ['bass', bassPluck], ['brass', () => brass(r('brass'))], ['lead', leadNote], ['choir', () => choirNote(r('choir'))],
    ['mallet', () => malletNote(r('mallet'))], ['ep', epNote], ['taiko', () => taiko(r('taiko'))], ['crash', () => crash(r('crash'))],
    ['swell', () => swellNote(r('swell'))], ['riser', () => riser(r('riser'))],
  ];
  const out: Partial<MusicBank> = {};
  for (const [k, f] of steps) { out[k] = toBuffer([f()]); await yieldToMain(); }
  return out as MusicBank;
}


// ---------- harmony ----------

const rate = (midi: number, base: number): number => Math.pow(2, (midi - base) / 12);
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** The C-major scale tone just below `m`. */
function scaleBelow(m: number): number {
  for (let k = m - 1; k > m - 4; k--) if (C_MAJOR.includes(((k % 12) + 12) % 12)) return k;
  return m - 2;
}

interface Chord { name: string; pad: number[]; root: number; next: string[] }
const BUILD_CHORDS: Record<string, Chord> = {
  C:  { name: 'C',  pad: [48, 55, 59, 62, 64], root: 36, next: ['Am', 'F', 'Em', 'Dm', 'G'] },
  Am: { name: 'Am', pad: [52, 55, 59, 60, 64], root: 45, next: ['F', 'Dm', 'Em', 'C'] },
  F:  { name: 'F',  pad: [53, 57, 60, 64, 67], root: 41, next: ['C', 'G', 'Dm', 'Am'] },
  Dm: { name: 'Dm', pad: [50, 53, 57, 60, 64], root: 38, next: ['G', 'F', 'Am'] },
  Em: { name: 'Em', pad: [52, 55, 59, 62],     root: 40, next: ['Am', 'F', 'C'] },
  G:  { name: 'G',  pad: [55, 60, 62, 64, 67], root: 43, next: ['C', 'Am', 'Em'] },
};
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];

interface RunChord { stab: number[]; root: number; minor: boolean }
const RUN_PROG: RunChord[] = [
  { stab: [64, 67, 69, 72], root: 33, minor: true },  // Am7
  { stab: [64, 67, 69, 72], root: 33, minor: true },  // Am7
  { stab: [62, 65, 69, 72], root: 38, minor: true },  // Dm7
  { stab: [62, 64, 67, 71], root: 40, minor: true },  // Em7
  { stab: [64, 65, 69, 72], root: 41, minor: false }, // Fmaj7
  { stab: [62, 64, 67, 71], root: 43, minor: false }, // G6
  { stab: [64, 67, 69, 72], root: 33, minor: true },  // Am7
  { stab: [62, 67, 71, 74], root: 43, minor: false }, // G
];
/** v2: the B section (bars 9–16 of the 16-bar form). */
const RUN_PROG_B: RunChord[] = [
  { stab: [64, 65, 69, 72], root: 41, minor: false }, // Fmaj7
  { stab: [62, 64, 67, 71], root: 43, minor: false }, // G6
  { stab: [62, 64, 67, 71], root: 40, minor: true },  // Em7
  { stab: [64, 67, 69, 72], root: 33, minor: true },  // Am7
  { stab: [62, 65, 69, 72], root: 38, minor: true },  // Dm7
  { stab: [62, 64, 67, 71], root: 40, minor: true },  // Em7
  { stab: [64, 65, 69, 72], root: 41, minor: false }, // Fmaj7
  { stab: [62, 67, 71, 74], root: 43, minor: false }, // G
];
// [step, semitones from root (or 'a' = scale approach note), velocity, length in steps]
const BASS: [number, number | 'a', number, number][] = [
  [0, 0, 1, 2], [3, 12, 0.55, 1], [4, 0, 0.8, 1], [6, 7, 0.7, 1], [7, 'a', 0.55, 1],
  [8, 0, 0.9, 2], [10, 12, 0.65, 1], [11, 0, 0.55, 1], [13, 7, 0.7, 1], [14, 'a', 0.6, 1], [15, 12, 0.45, 1],
];
const LEAD_NOTES = [69, 72, 74, 76, 79, 81, 84];

export type MusicMode = 'build' | 'countdown' | 'running';

// ---------- scheduler ----------

const LOOKAHEAD = 0.3;
const LAYERS = 6;

export class Music {
  private readonly buildBus: GainNode;
  private readonly runBus: GainNode;
  private readonly layers: GainNode[] = [];
  private readonly layerOn = [true, false, false, false, false, false];
  private readonly layerSince = [0, 0, 0, 0, 0, 0];
  private mode: MusicMode = 'build';
  private rng = new Rng('music-gen');

  // build state
  private buildNext = -1;      // next beat time
  private buildBeat = 0;
  private chord: Chord = BUILD_CHORDS.C!;
  private padVoices: { g: GainNode; s: AudioBufferSourceNode }[] = [];
  private buildUntil = Infinity; // stop scheduling build after this time (fade-out)
  /** v2 stem shuffle for the current 16-bar section. */
  private stems = { mallet: false, ep: false, brush: false };

  // run state
  private runNext = -1;
  private runStep = 0;
  private runUntil = -1;
  private lead: (number | null)[] = [];
  intensity = 0;
  /** v2: explosion density 0..1 (yield per 0.5 s), drives L5. */
  density = 0;
  private whoaUntil = 0;
  private forceUntil = 0;
  private forceFrom = 0;
  private dropAt = -1;
  private hitQueued = -1;
  private lastHit = -10;
  readonly stats = { sections: 0, drops: 0, hits: 0 };

  constructor(private readonly ctx: BaseAudioContext, out: AudioNode, private readonly bank: MusicBank) {
    this.buildBus = ctx.createGain();
    this.runBus = ctx.createGain();
    this.runBus.gain.value = 0;
    this.buildBus.connect(out);
    this.runBus.connect(out);
    for (let i = 0; i < LAYERS; i++) {
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      g.connect(this.runBus);
      this.layers.push(g);
    }
  }

  setMode(mode: MusicMode, now: number): void {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'running') {
      this.buildBus.gain.cancelScheduledValues(now);
      this.buildBus.gain.setTargetAtTime(0, now, 0.4);
      this.buildUntil = now + 2.5;
      this.runBus.gain.cancelScheduledValues(now);
      this.runBus.gain.setTargetAtTime(0.7, now, 0.05); // run track sits 3 dB under the bed trim: it is denser
      this.runNext = now + 0.06;
      this.runStep = 0;
      this.runUntil = Infinity;
      this.lead = [];
      this.forceUntil = 0; this.forceFrom = 0; this.dropAt = -1; this.hitQueued = -1;
      for (let i = 1; i < LAYERS; i++) { this.layerOn[i] = false; this.layers[i]!.gain.cancelScheduledValues(now); this.layers[i]!.gain.setValueAtTime(0, now); }
    } else {
      if (prev === 'running') {
        this.runBus.gain.cancelScheduledValues(now);
        this.runBus.gain.setTargetAtTime(0, now, 0.5);
        this.runUntil = now + 2.5;
      }
      this.buildBus.gain.cancelScheduledValues(now);
      this.buildBus.gain.setTargetAtTime(mode === 'countdown' ? 0.45 : 1, now, mode === 'countdown' ? 0.3 : 1.2);
      if (this.buildUntil !== Infinity || this.buildNext < 0) {
        this.buildUntil = Infinity;
        if (this.buildNext < now) { this.buildNext = now + 0.1; this.buildBeat = 0; }
      }
    }
  }

  /** A burst of total yield `y` happened: drives the choir layer (> yield 10 in 2 s, tracked by caller). */
  whoa(now: number): void { this.whoaUntil = Math.max(this.whoaUntil, now + 4); }

  /** A big boom: an L5 accent (taiko + crash) on the next 8th, at most one per beat. */
  hit(now: number): void {
    if (this.mode !== 'running' || this.runNext < 0) return;
    if (now - this.lastHit < 60 / 112) return;
    this.lastHit = now;
    this.hitQueued = now;
  }

  /** The Kiloton moment: riser → one-beat breath → everything back in on the next downbeat, choir for 8 bars. */
  mega(when: number): void {
    if (this.mode !== 'running' || this.runNext < 0 || this.dropAt > when) return;
    const step = 60 / 112 / 4;
    // the next bar line at least 1.2 s ahead
    const stepsToBar = (16 - (this.runStep % 16)) % 16;
    let t = this.runNext + stepsToBar * step;
    while (t < when + 1.2) t += 16 * step;
    this.dropAt = t;
    this.voice(this.bank.riser, Math.max(this.ctx.currentTime, t - 2), 1, 0.12, this.runBus);
    this.forceFrom = t;
    this.forceUntil = t + 8 * 16 * step;
    this.whoaUntil = Math.max(this.whoaUntil, t + 6);
    this.stats.drops++;
  }

  start(now: number): void {
    this.buildNext = now + 0.1;
    this.buildBeat = 0;
    this.buildBus.gain.setValueAtTime(0, now);
    this.buildBus.gain.setTargetAtTime(1, now, 1.5);
  }

  update(now: number): void {
    this.updateLayers(now);
    if (this.buildNext >= 0 && now < this.buildUntil) this.scheduleBuild(now);
    if (now >= this.buildUntil) this.stopPads(now);
    if (this.runNext >= 0 && now < this.runUntil) this.scheduleRun(now);
  }

  // ---- shared ----

  private voice(buf: AudioBuffer, when: number, r: number, gain: number, dest: AudioNode, dur?: number, release = 0.05): void {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = clamp(r, 0.05, 8);
    const g = this.ctx.createGain();
    g.gain.value = clamp(gain, 0, 2);
    s.connect(g).connect(dest);
    s.start(Math.max(when, this.ctx.currentTime));
    if (dur !== undefined) {
      g.gain.setValueAtTime(gain, when + dur);
      g.gain.linearRampToValueAtTime(0, when + dur + release);
      s.stop(when + dur + release + 0.01);
    }
    s.onended = () => g.disconnect();
  }

  // ---- build bed ----

  private scheduleBuild(now: number): void {
    const beat = 60 / 72;
    if (this.buildNext < now - 0.5) { this.buildNext = now + 0.05; } // resync after a long stall
    while (this.buildNext < now + LOOKAHEAD) {
      const t = this.buildNext, b = this.buildBeat;
      if (b % 64 === 0) this.newSection(b);
      if (b % 8 === 0) this.changeChord(t, beat * 8);
      // plinks: sparse, more likely on strong beats; occasional 3-note figure (thinner when the marimba plays)
      const thin = this.stems.mallet ? 0.6 : 1;
      for (let half = 0; half < 2; half++) {
        const tt = t + half * beat / 2;
        const p = (half === 0 ? (b % 4 === 0 ? 0.32 : 0.2) : 0.1) * thin;
        if (this.rng.chance(p)) {
          const pool = this.rng.chance(0.6) ? this.chord.pad.map((m) => m + 24).filter((m) => m >= 72 && m <= 90) : PENTA;
          const m = this.rng.pick(pool.length ? pool : PENTA);
          const vel = 0.05 + 0.06 * this.rng.next();
          this.voice(this.bank.keys, tt, rate(m, A4), vel, this.buildBus);
          if (this.rng.chance(0.12)) {
            const m2 = this.rng.pick(PENTA), m3 = this.rng.pick(PENTA);
            this.voice(this.bank.keys, tt + beat / 3, rate(m2, A4), vel * 0.7, this.buildBus);
            this.voice(this.bank.keys, tt + 2 * beat / 3, rate(m3, A4), vel * 0.5, this.buildBus);
          }
        }
      }
      // v2 stems
      if (this.stems.mallet) {
        // a lazy marimba arpeggio up through the chord, 8ths, with gaps
        const tones = this.chord.pad.map((m) => m + 12).filter((m) => m >= 60 && m <= 84);
        for (let half = 0; half < 2; half++) {
          if (!tones.length || !this.rng.chance(0.5)) continue;
          const m = tones[(b * 2 + half) % tones.length]!;
          this.voice(this.bank.mallet, t + half * beat / 2, rate(m, A4), 0.035 + 0.025 * this.rng.next(), this.buildBus);
        }
      }
      if (this.stems.ep && b % 4 === 0) {
        const n = this.chord.pad.length;
        for (const m of this.chord.pad) this.voice(this.bank.ep, t, rate(m, A3), 0.06 / Math.sqrt(n), this.buildBus);
        if (this.rng.chance(0.45)) for (const m of this.chord.pad.slice(1)) this.voice(this.bank.ep, t + beat * 2.5, rate(m + 12, A3), 0.035 / Math.sqrt(n), this.buildBus);
      }
      if (this.stems.brush) {
        for (let half = 0; half < 2; half++) this.voice(this.bank.shaker, t + half * beat / 2, 0.8, half ? 0.012 : 0.02, this.buildBus);
      }
      this.buildNext += beat;
      this.buildBeat++;
    }
  }

  /** Every 16 bars: shuffle the extra stems (at least one of marimba / EP from the second section on). */
  private newSection(beat: number): void {
    this.stats.sections++;
    if (beat === 0) { this.stems = { mallet: false, ep: false, brush: false }; return; }
    const prev = this.stems;
    let s = { mallet: this.rng.chance(0.55), ep: this.rng.chance(0.5), brush: this.rng.chance(0.3) };
    if (!s.mallet && !s.ep) s = { ...s, [this.rng.chance(0.5) ? 'mallet' : 'ep']: true };
    // never the same arrangement twice in a row
    if (s.mallet === prev.mallet && s.ep === prev.ep && s.brush === prev.brush) s.brush = !s.brush;
    this.stems = s;
  }

  private changeChord(t: number, len: number): void {
    const ch = this.buildBeat === 0 ? BUILD_CHORDS.C! : BUILD_CHORDS[this.rng.pick(this.chord.next)]!;
    this.chord = ch;
    // release old pads
    for (const v of this.padVoices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0, t, 0.9);
      v.s.stop(t + 5);
    }
    this.padVoices = [];
    const n = ch.pad.length;
    for (const m of ch.pad) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.bank.pad;
      s.loop = true;
      s.loopStart = 0; s.loopEnd = this.bank.pad.duration;
      s.playbackRate.value = rate(m, A3);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(0.22 / Math.sqrt(n), t, 0.8);
      s.connect(g).connect(this.buildBus);
      s.start(t, this.rng.next() * 3);
      s.onended = () => g.disconnect();
      this.padVoices.push({ g, s });
    }
    // sub: a soft root under the whole chord
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.sub;
    s.loop = true;
    s.playbackRate.value = rate(ch.root, A1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(0.16, t, 0.3);
    g.gain.setTargetAtTime(0, t + len - 0.6, 0.25);
    s.connect(g).connect(this.buildBus);
    s.start(t);
    s.stop(t + len + 1.5);
    s.onended = () => g.disconnect();
  }

  private stopPads(now: number): void {
    if (!this.padVoices.length) return;
    for (const v of this.padVoices) { v.g.gain.setTargetAtTime(0, now, 0.2); v.s.stop(now + 1.5); }
    this.padVoices = [];
    this.buildNext = -1;
  }

  // ---- run track ----

  private updateLayers(now: number): void {
    const I = this.intensity, D = this.density;
    const forced = now >= this.forceFrom - 0.05 && now < this.forceUntil;
    const th = [0, 0.12, 0.35, 0.6, 0.85];
    for (let i = 1; i < LAYERS; i++) {
      let want: boolean, off: boolean;
      if (i === 5) { want = D > 0.25; off = D < 0.12; }
      else if (i === 4) { want = I > th[i]! || now < this.whoaUntil; off = I < th[i]! - 0.1 && now >= this.whoaUntil; }
      else { want = I > th[i]!; off = I < th[i]! - 0.08; }
      if (forced) { want = true; off = false; }
      if (want && !this.layerOn[i]) {
        this.layerOn[i] = true; this.layerSince[i] = now;
        this.layers[i]!.gain.cancelScheduledValues(now);
        this.layers[i]!.gain.setTargetAtTime(1, now, i === 5 ? 0.12 : 0.25);
      } else if (off && this.layerOn[i] && now - this.layerSince[i]! > 3) {
        this.layerOn[i] = false;
        this.layers[i]!.gain.cancelScheduledValues(now);
        this.layers[i]!.gain.setTargetAtTime(0, now, i === 5 ? 2 : 1.2);
      }
    }
  }

  private layerLive(i: number, now: number): boolean {
    return this.layerOn[i]! || now - this.layerSince[i]! < 6;
  }

  private scheduleRun(now: number): void {
    const step = 60 / 112 / 4;
    if (this.runNext < now - 0.5) { this.runNext = now + 0.05; this.runStep = Math.ceil(this.runStep / 16) * 16; }
    while (this.runNext < now + LOOKAHEAD) {
      const t = this.runNext, k = this.runStep;
      const s = k % 16, bar = Math.floor(k / 16);
      const ch = (bar % 16 < 8 ? RUN_PROG : RUN_PROG_B)[bar % 8]!;
      const swing = s % 2 === 1 ? step * 0.12 : 0; // a touch of 16th swing
      const tt = t + swing;
      const L = this.layers;
      const I = this.intensity, D = this.density;
      // the Kiloton breath: one beat of silence before the drop's downbeat
      const breath = this.dropAt > 0 && t >= this.dropAt - 4 * step - 1e-4 && t < this.dropAt - 1e-4;
      const drop = this.dropAt > 0 && Math.abs(t - this.dropAt) < step * 0.5;
      if (drop) {
        this.voice(this.bank.crash, t, 1, 0.3, L[5]!);
        this.voice(this.bank.taiko, t, 1, 0.5, L[5]!);
        this.voice(this.bank.taiko, t + step * 2, 0.9, 0.35, L[5]!);
        for (const iv of ch.minor ? [0, 3, 7] : [0, 4, 7]) this.voice(this.bank.swell, t, rate(ch.root + 24 + iv, A3), 0.06, L[5]!);
      }
      const fill = I > 0.5 && bar % 8 === 7 && s >= 8;
      if (!breath) {
        // L0: bass + hats + shaker
        for (const [bs, iv, vel, len] of BASS) {
          if (bs !== s) continue;
          const m = iv === 'a' ? scaleBelow(ch.root + 12) - 12 : ch.root + iv;
          this.voice(this.bank.bass, tt, rate(m, A1), 0.42 * vel, L[0]!, len * step * 0.9, 0.03);
        }
        if (s % 2 === 0) this.voice(this.bank.hatC, tt, 1, s % 4 === 0 ? 0.13 : 0.09, L[0]!);
        else if (s === 3 || s === 11) this.voice(this.bank.hatC, tt, 1.05, 0.05, L[0]!);
        this.voice(this.bank.shaker, tt, 1, 0.025 + (s % 4 === 2 ? 0.02 : 0), L[0]!);
        // L1: drums (a 16th snare fill into every 8th bar when it's hot)
        if (this.layerLive(1, now)) {
          if (s === 0 || s === 7 || s === 10 || (bar % 2 === 1 && s === 14)) this.voice(this.bank.kick, tt, 1, s === 0 ? 0.55 : 0.45, L[1]!);
          if (fill) this.voice(this.bank.snare, tt, 1 + (s - 8) * 0.01, 0.08 + 0.03 * (s - 8), L[1]!);
          else {
            if (s === 4 || s === 12) this.voice(this.bank.snare, tt, 1, 0.36, L[1]!);
            if (s === 12 && I > 0.5) this.voice(this.bank.clap, tt, 1, 0.22, L[1]!);
            if ((s === 9 || s === 15) && I > 0.45) this.voice(this.bank.snare, tt, 1.05, 0.07, L[1]!);
            if (s === 14 && bar % 2 === 1) this.voice(this.bank.hatO, tt, 1, 0.09, L[1]!);
          }
        }
        // L2: brass stabs, a 2-bar figure
        if (this.layerLive(2, now)) {
          const hits = bar % 2 === 0 ? [6, 14] : [2, 3, 10];
          if (hits.includes(s)) for (const m of ch.stab) this.voice(this.bank.brass, tt, rate(m, A4), 0.07, L[2]!, step * (s === 2 ? 0.7 : 1.6), 0.06);
        }
        // L3: lead riff, regenerated every 4 bars
        if (this.layerLive(3, now)) {
          if (s === 0 && bar % 4 === 0) this.makeLead();
          const n = this.lead[(bar % 2) * 8 + s / 2];
          if (s % 2 === 0 && n != null) this.voice(this.bank.lead, tt, rate(n, A4), 0.09, L[3]!, step * 1.6, 0.05);
        }
        // L4: choir whoa on each bar
        if (this.layerLive(4, now) && s === 0) {
          const tri = ch.minor ? [0, 3, 7] : [0, 4, 7];
          for (const iv of tri) this.voice(this.bank.choir, tt, rate(ch.root + 24 + iv, A3), 0.12, L[4]!);
        }
        // L5: barrage, following explosion density
        if (this.layerLive(5, now) && !drop) {
          const dd = Math.max(D, now < this.forceUntil ? 0.7 : 0);
          if (s === 0 || s === 6 || s === 8 || (dd > 0.6 && (s === 12 || s === 14))) this.voice(this.bank.taiko, t, s === 0 ? 1 : 1.12, (s === 0 ? 0.3 : 0.2) * (0.6 + 0.4 * dd), L[5]!);
          if (s === 0 && bar % 2 === 0) for (const iv of [0, 7]) this.voice(this.bank.swell, t, rate(ch.root + 12 + iv, A3), 0.05 * (0.5 + 0.5 * dd), L[5]!);
          if (s === 0 && bar % 4 === 0 && dd > 0.5) this.voice(this.bank.crash, t, 1, 0.12, L[5]!);
        }
      }
      // a queued boom accent lands on the next 8th
      if (this.hitQueued > 0 && s % 2 === 0 && t >= this.hitQueued) {
        this.hitQueued = -1;
        if (!breath) {
          this.stats.hits++;
          this.voice(this.bank.taiko, t, 0.95, 0.3, this.runBus);
          if (D > 0.3) this.voice(this.bank.crash, t, 1, 0.1, this.runBus);
        }
      }
      if (this.dropAt > 0 && t > this.dropAt + step) this.dropAt = -1;
      this.runNext += step;
      this.runStep++;
    }
  }

  private makeLead(): void {
    const out: (number | null)[] = [];
    let idx = this.rng.int(3) + 1;
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      if (this.rng.chance(strong ? 0.75 : 0.45)) {
        idx = Math.max(0, Math.min(LEAD_NOTES.length - 1, idx + this.rng.pick([-2, -1, -1, 0, 1, 1, 2])));
        out.push(LEAD_NOTES[idx]!);
      } else out.push(null);
    }
    this.lead = out;
  }
}
