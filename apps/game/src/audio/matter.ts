// M4 Matter audio (AUDIO.md §1, §5): granular sand, water and marbles driven by a reduction of the particles
// around the listener. Nothing reads the big particle buffers back: matterprobe.ts reduces them on the GPU to
// 72 numbers (3 kinds × 3 distance bands × 8 sums), read back a frame or two late.
//
//   field    MatterField from matterprobe.ts (GPU) or setField() (tests, a CPU reference): per kind and band, the
//            moving grains, their mean speed and centroid, the falling grains
//   streams  6 granular streams (kind × {near band, field bands}) in matter-processor.js (AudioWorklet), each a
//            mono output panned at its centroid. Sparse flow is individual grains (a trickle you can count); dense
//            flow crossfades into a filtered-noise bed (a pour hiss, a rushing stream)
//   fallback with no AudioWorklet, each stream is a pair of looped beds (sparse and dense, granular renders of the
//            same grain tables) crossfaded by density
//
// The grain tables are rendered here from fixed seeds and handed to the worklet once (processorOptions), so the
// worklet is only a player. Part-level Matter sounds (pour spouts, sponges, the waterwheel) are in m4.ts.

import type { Recipe } from './bank';
import { Rng } from './rng';
import {
  SR, alloc, bp, bubble, chirp, contact, envAD, fadeEdges, grains, hp, lp, mixInto, modal, normalize, seamless, white,
} from './synth';
import { clamp, fin, finite3, type LoopKind, type LoopOpts, type Vec3 } from './types';

import PROCESSOR_URL from './matter-processor.js?url';

const at = (s: number): number => Math.round(s * SR);

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
/** Load the granular processor into a context (once). Resolves false when AudioWorklet is unavailable. */
export function loadMatterWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(PROCESSOR_URL);
        return true;
      } catch (err) {
        console.warn('[audio] Matter worklet unavailable, using looped beds', err);
        return false;
      }
    })();
    loaded.set(ctx, p);
  }
  return p;
}

/** X5 (M5): goo (kind 3) joins as a 4th kind: its grains are slime squelches (AUDIO.md §1 "slime squelch"). */
export const MATTER_KINDS = ['sand', 'water', 'marble', 'goo'] as const;
export type MatterKindName = (typeof MATTER_KINDS)[number];
/** Outer radius (m) of each listener band: near (0–2 m), mid (2–8 m), far (8–40 m). Grains beyond 40 m are ignored. */
export const MATTER_BANDS = [2, 8, 40] as const;

/** One band's sums for one kind (already scaled by the probe's sampling stride). */
export interface MatterBand {
  /** Grains moving faster than the probe's threshold (resting grains are silent). */
  moving: number;
  /** Mean speed of the moving grains, m/s. */
  speed: number;
  /** Grains falling faster than the probe's threshold (a pour column, splashes, an avalanche front). */
  falling: number;
  /** Mean downward speed of the falling grains, m/s. */
  fallSpeed: number;
  /** Speed-weighted centroid of the moving grains, world metres. */
  cx: number; cy: number; cz: number;
  /** Every grain in the band, moving or not. */
  total: number;
}
/** Per kind (sand, water, marble), per band (MATTER_BANDS). */
export interface MatterField { bands: MatterBand[][] }

export const emptyBand = (): MatterBand => ({ moving: 0, speed: 0, falling: 0, fallSpeed: 0, cx: 0, cy: 0, cz: 0, total: 0 });
export const emptyField = (): MatterField => ({ bands: MATTER_KINDS.map(() => MATTER_BANDS.map(emptyBand)) });

// ============================================================================================
// grain tables (also the raw material of the fallback beds)
// ============================================================================================

/** A sand grain: a 1.5–4 ms band-passed tick with a tiny brittle click (quartz on quartz). */
function sandGrain(rng: Rng): Float32Array {
  const len = at(0.002 + 0.003 * rng.next());
  const x = envAD(white(len, rng), 0.00005, 0.0003 + 0.0009 * rng.next());
  bp(x, 2500 * Math.pow(3.2, rng.next()), 0.9 + rng.next());
  mixInto(x, modal(len, contact(0.00004, rng), [{ f: 4200 + 5000 * rng.next(), amp: 0.5, tau: 0.0005 }]));
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.0005);
}

/** A water droplet: a Minnaert bubble (small = high and short), sometimes with a splashy onset. */
function waterGrain(rng: Rng, v: number): Float32Array {
  const f0 = 500 * Math.pow(6, rng.next());
  const tau = clamp(9 / Math.sqrt(f0), 0.004, 0.03);
  const x = alloc(tau * 6 + 0.01);
  mixInto(x, bubble(tau * 6, f0, 0.15 + 0.5 * rng.next(), tau));
  if (v % 4 === 0) mixInto(x, normalize(lp(envAD(white(at(0.012), rng), 0.0003, 0.003), 3500), 0.4));
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.003);
}

/** A marble click: glass modes (2.2–5.2 kHz), or chrome (steel ratios) for every third variant. */
function marbleGrain(rng: Rng, v: number): Float32Array {
  const steel = v % 3 === 2;
  const f = (steel ? 3000 : 2200) * Math.pow(steel ? 1.8 : 2.4, rng.next());
  const r = steel ? [1, 2.756, 5.404] : [1, 2.32, 4.25];
  const tau = (steel ? 0.05 : 0.02) * (0.6 + 0.8 * rng.next());
  const len = at(Math.min(0.12, tau * 5));
  const x = modal(len, contact(0.00005 + 0.0001 * rng.next(), rng), r.map((k, i) => ({ f: f * k * (1 + rng.bi() * 0.01), amp: [1, 0.5, 0.3][i]!, tau: tau / (1 + i) })));
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.004);
}

/**
 * A goo squelch (X5, M5; AUDIO.md "slime squelch"): a wet, low suction pop. A falling-pitch body (450 → 120 Hz over
 * 40–90 ms, the slime pulling off a surface) under a low-passed noise smack, sometimes a second, smaller pop.
 */
function gooGrain(rng: Rng, v: number): Float32Array {
  const dur = 0.04 + 0.05 * rng.next();
  const f0 = 300 + 250 * rng.next(), f1 = 90 + 60 * rng.next();
  const x = chirp(at(dur), (t) => f1 + (f0 - f1) * Math.exp(-t / (dur * 0.35)), (t) => Math.exp(-t / (dur * 0.4)) * (1 - Math.exp(-t / 0.002)));
  mixInto(x, normalize(lp(envAD(white(at(dur), rng), 0.0005, 0.006 + 0.01 * rng.next()), 900 + 600 * rng.next()), 0.5));
  if (v % 3 === 1) mixInto(x, bubble(0.03, 220 + 180 * rng.next(), -0.3, 0.008), at(dur * 0.45), 0.35);
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.008);
}

const GRAIN_GEN: readonly ((rng: Rng, v: number) => Float32Array)[] = [(r) => sandGrain(r), waterGrain, marbleGrain, gooGrain];
const GRAIN_COUNT = [24, 32, 24, 18] as const;

/** The worklet's grain tables, [kind][variant], from fixed seeds (`matter/<kind>#<v>`). */
export function grainTables(): Float32Array[][] {
  return MATTER_KINDS.map((k, ki) => {
    const out: Float32Array[] = [];
    for (let v = 0; v < GRAIN_COUNT[ki]!; v++) out.push(GRAIN_GEN[ki]!(new Rng(`matter/${k}#${v}`), v));
    return out;
  });
}

let tablesCache: Float32Array[][] | null = null;
/** The grain tables, rendered once (the fallback beds reuse them). */
export function tablesOnce(): Float32Array[][] { return (tablesCache ??= grainTables()); }

/** A granular bed rendered offline: grains of `kind` at `rate` per second plus a filtered-noise bed. */
function bed(kind: 0 | 1 | 2 | 3, rate: number, noise: number, rng: Rng): Float32Array {
  return normalize(seamless(3, 0.25, (len) => {
    const x = new Float32Array(len);
    const table = tablesOnce()[kind]!;
    grains(x, rng, () => rate, (r) => { const src = table[r.int(table.length)]!; const k = 0.3 + 0.7 * r.next() * r.next(); const g = new Float32Array(src.length); for (let i = 0; i < g.length; i++) g[i] = src[i]! * k; return g; });
    normalize(x, 1);
    if (noise > 0) {
      const n = white(len, rng);
      if (kind === 0) { hp(n, 1800); bp(n, 4200, 0.6); }
      else if (kind === 1) { lp(n, 1400); bp(n, 700, 0.5); }
      else if (kind === 3) { lp(n, 500); bp(n, 260, 0.7); } // goo (X5): a thick, low gloop
      else bp(n, 4800, 1.2);
      let am = 0;
      for (let i = 0; i < len; i++) { am = am * 0.9995 + rng.bi() * 0.02; n[i] = n[i]! * (1 + (kind === 1 ? 2.5 : 1.2) * am); }
      mixInto(x, normalize(n, 1), 0, noise);
    }
    return x;
  }), 0.35);
}

/** Fallback beds (no AudioWorklet) and Matter one-shots. */
export function matterRecipes(): Recipe[] {
  return [
    ['loop/matter/sand/sparse', 1, (g) => bed(0, 60, 0, g)], ['loop/matter/sand/dense', 1, (g) => bed(0, 900, 1.2, g)],
    ['loop/matter/water/sparse', 1, (g) => bed(1, 25, 0.15, g)], ['loop/matter/water/dense', 1, (g) => bed(1, 500, 1.4, g)],
    ['loop/matter/marble/sparse', 1, (g) => bed(2, 30, 0, g)], ['loop/matter/marble/dense', 1, (g) => bed(2, 450, 0.4, g)],
    ['loop/matter/goo/sparse', 1, (g) => bed(3, 12, 0, g)], ['loop/matter/goo/dense', 1, (g) => bed(3, 140, 0.8, g)], // X5
  ];
}

// ============================================================================================
// director
// ============================================================================================

/** Granular streams: kind × {near band, field} (8 with goo, X5). Must match matter-processor.js. */
export const MATTER_STREAMS = MATTER_KINDS.length * 2;
/** Params per stream posted to the worklet: rate, grainGain, pitch, spread, bedGain, bedFreq, bedQ. */
export const MATTER_PARAMS = 7;

/** Per kind: activity scale (grains × m/s for a just-audible flow), trim, bed trim, rate law. */
const KIND = [
  // sand: a pour hiss; landing grains tick, avalanches rush
  { scale: 5, trim: 0.32, bedTrim: 0.75, rateK: 25, rateP: 0.75, rateMax: 1400, spread: 0.25, f0: 2500, f1: 3500, q: 0.7 },
  // water: droplets and splashes on top of a flowing bed
  { scale: 3, trim: 0.35, bedTrim: 0.9, rateK: 14, rateP: 0.7, rateMax: 900, spread: 0.5, f0: 450, f1: 1400, q: 0.6 },
  // marbles: each moving marble clatters
  { scale: 0.5, trim: 0.28, bedTrim: 0.5, rateK: 40, rateP: 0.8, rateMax: 700, spread: 0.12, f0: 4500, f1: 1200, q: 1.2 },
  // goo (X5, M5): slow, wet squelches as it drools, stretches and lands; a low gloop when a lot of it moves
  { scale: 1.5, trim: 0.34, bedTrim: 0.6, rateK: 6, rateP: 0.65, rateMax: 160, spread: 0.3, f0: 180, f1: 220, q: 0.8 },
] as const;

const smoothstep = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Stream targets for one kind and band set: pure, so the test page can print the mapping. */
export function streamParams(kind: 0 | 1 | 2 | 3, b: MatterBand, d: number, near: boolean): { gain: number; rate: number; grain: number; bed: number; pitch: number; spread: number; bedFreq: number; q: number } {
  const K = KIND[kind];
  const moving = Math.max(0, fin(b.moving, 0)), v = clamp(fin(b.speed, 0), 0, 20), falling = Math.max(0, fin(b.falling, 0));
  // water: falling water lands, so it splashes even when the flow itself is slow
  const A = moving * v + (kind === 1 ? falling * clamp(fin(b.fallSpeed, 0), 0, 20) * 0.5 : 0);
  const lg = Math.log10(1 + A / K.scale);
  const L = clamp(lg / 3.6, 0, 1);
  const gd = near ? 1 : 1 / (1 + 1.2 * Math.max(0, fin(d, 0) - 1));
  const mix = smoothstep(lg, 1.2, 3.0);
  const gain = L * K.trim * gd;
  return {
    gain,
    rate: clamp(K.rateK * Math.pow(A, K.rateP), 0, K.rateMax),
    grain: gain * (1 - 0.75 * mix),
    bed: gain * mix * K.bedTrim,
    pitch: clamp(0.85 + 0.35 * Math.min(1, v / 0.8), 0.5, 2),
    spread: K.spread,
    bedFreq: kind === 2 ? K.f0 : K.f0 + K.f1 * Math.min(1, v / (kind === 0 ? 0.8 : 1.2)),
    q: K.q,
  };
}

export interface MatterSink {
  /** Fallback loops (no worklet). */
  loop(id: string, kind: LoopKind, pos: Vec3, level: number, o?: LoopOpts): void;
  listener(): Vec3;
  panning(): PanningModelType;
}

/** Combine bands [from, to) of one kind into one (sums, speed-weighted centroid). */
function merge(bands: readonly MatterBand[], from: number, to: number): MatterBand {
  const o = emptyBand();
  let w = 0, fw = 0;
  for (let i = from; i < to; i++) {
    const b = bands[i];
    if (!b) continue;
    const m = Math.max(0, fin(b.moving, 0)), s = clamp(fin(b.speed, 0), 0, 50), f = Math.max(0, fin(b.falling, 0));
    o.moving += m; o.total += Math.max(0, fin(b.total, 0)); o.falling += f;
    fw += f * clamp(fin(b.fallSpeed, 0), 0, 50);
    if (m > 0 && finite3([b.cx, b.cy, b.cz])) { const k = m * Math.max(s, 1e-3); o.cx += b.cx * k; o.cy += b.cy * k; o.cz += b.cz * k; w += k; o.speed += m * s; }
  }
  if (w > 0) { o.cx /= w; o.cy /= w; o.cz /= w; }
  o.speed = o.moving > 0 ? o.speed / o.moving : 0;
  o.fallSpeed = o.falling > 0 ? fw / o.falling : 0;
  return o;
}

export class MatterAudio {
  private node: AudioWorkletNode | null = null;
  private panners: PannerNode[] = [];
  private field: MatterField | null = null;
  private fieldAt = -10;
  /** Smoothed params per stream (MATTER_PARAMS each) and stream positions. */
  private readonly cur = new Float32Array(MATTER_STREAMS * MATTER_PARAMS);
  private readonly pos: [number, number, number][] = Array.from({ length: MATTER_STREAMS }, () => [0, 0, 0]);
  private posted = -1;
  private wasActive = false;
  private readonly on = new Uint8Array(MATTER_STREAMS);
  /** Streams currently making sound (each counts as a voice in the 64-voice budget). */
  active = 0;
  /** Summed stream gain: ducks the ambience. */
  level = 0;
  mode: 'off' | 'worklet' | 'loops' = 'off';
  readonly stats = { fields: 0, posts: 0, acks: 0, ackTimeouts: 0 };
  /**
   * Beta (D127), a clip's director: post on every update (not every 20 ms) with a sequence number the worklet echoes
   * back, so `synced()` can hold the offline render until the worklet has the frame's params (a port message is
   * asynchronous: without the wait it lands a quantum or several late, depending on wall-clock timing).
   */
  sync = false;
  private seq = 0;
  private acked = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly sink: MatterSink) {}

  /** Start the granular worklet on `bus` (or the fallback loops when `worklet` is false or it fails). */
  start(ctx: BaseAudioContext, bus: AudioNode, worklet: boolean, tables: Float32Array[][]): void {
    if (this.mode !== 'off') return;
    if (worklet) {
      try {
        const node = new AudioWorkletNode(ctx, 'kn-matter', {
          numberOfInputs: 0, numberOfOutputs: MATTER_STREAMS, outputChannelCount: Array(MATTER_STREAMS).fill(1),
          processorOptions: { tables, streams: MATTER_STREAMS, params: MATTER_PARAMS, seed: 0x4d415454 },
        });
        for (let s = 0; s < MATTER_STREAMS; s++) {
          // the stream gain already includes distance: the panner only places it
          const p = new PannerNode(ctx, { panningModel: this.sink.panning(), distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0, positionX: 0, positionY: 0, positionZ: 0 });
          node.connect(p, s).connect(bus);
          this.panners.push(p);
        }
        node.port.onmessage = (e: MessageEvent) => {
          const n = e.data;
          if (typeof n !== 'number' || !(n > this.acked)) return;
          this.acked = n;
          this.stats.acks++;
          if (this.acked >= this.seq) { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
        };
        this.node = node;
        this.mode = 'worklet';
        return;
      } catch (err) {
        console.warn('[audio] Matter worklet failed to start, using looped beds', err);
      }
    }
    this.mode = 'loops';
  }

  /** A new reduction (GPU probe, CPU reference, or a test script). */
  setField(f: MatterField, now: number): void {
    if (!f || !Array.isArray(f.bands)) return;
    this.field = f;
    this.fieldAt = now;
    this.stats.fields++;
  }

  reset(): void { this.field = null; this.fieldAt = -10; }

  /** Per frame: smooth towards the field's targets (fast attack, slower release) and post them. */
  update(now: number, dt: number, running: boolean, pitchScale: number): void {
    if (this.mode === 'off') return;
    const f = this.field && now - this.fieldAt < 0.5 && running ? this.field : null;
    const L = this.sink.listener();
    const P = MATTER_PARAMS;
    let active = 0, level = 0;
    for (let k = 0; k < MATTER_KINDS.length; k++) { // X5: sand, water, marbles, goo
      const bands = f?.bands[k] ?? [];
      for (let near = 0; near < 2; near++) {
        const s = k * 2 + near;
        const b = near === 0 ? merge(bands, 0, 1) : merge(bands, 1, 3);
        const has = b.moving > 0 || b.falling > 0;
        const c: Vec3 = has && (b.cx || b.cy || b.cz) ? [b.cx, b.cy, b.cz] : L;
        const d = Math.hypot(c[0] - L[0], c[1] - L[1], c[2] - L[2]);
        const t = streamParams(k as 0 | 1 | 2 | 3, b, d, near === 0);
        const tgt = [t.rate, t.grain, t.pitch * pitchScale, t.spread, t.bed, t.bedFreq, t.q];
        const o = s * P;
        // gains: attack ~50 ms, release ~300 ms; the rest follow at ~100 ms
        for (let j = 0; j < P; j++) {
          const up = tgt[j]! > this.cur[o + j]!;
          // paused or no fresh field: release fast, so a pause is silent at once
          const tau = j === 1 || j === 4 ? (up ? 0.05 : f ? 0.3 : 0.06) : 0.1;
          const a = 1 - Math.exp(-Math.max(0, dt) / tau);
          const v = this.cur[o + j]! + (tgt[j]! - this.cur[o + j]!) * a;
          this.cur[o + j] = Number.isFinite(v) ? v : 0;
        }
        // near: halfway between the listener and the centroid, so a pile all around you isn't hard-panned
        const p = this.pos[s]!;
        const q: Vec3 = near === 0 ? [L[0] + 0.5 * (c[0] - L[0]), L[1] + 0.5 * (c[1] - L[1]), L[2] + 0.5 * (c[2] - L[2])] : c;
        if (finite3(q)) { p[0] += (q[0] - p[0]) * 0.3; p[1] += (q[1] - p[1]) * 0.3; p[2] += (q[2] - p[2]) * 0.3; }
        const g = this.cur[o + 1]!, bed = this.cur[o + 4]!;
        const on = (g > 0.002 && this.cur[o]! > 0.5) || bed > 0.002;
        if (on) active++;
        this.on[s] = on ? 1 : 0;
        level += g + bed;
        if (this.mode === 'loops') {
          // fallback: the sparse and dense beds, crossfaded by the same grain / bed split
          const name = MATTER_KINDS[k]!;
          if (g > 0.002) this.sink.loop(`matter:${s}:g`, 'matter', p, g * 1.6, { variant: `matter/${name}/sparse`, aux: this.cur[o + 2]!, ref: 50 });
          if (bed > 0.002) this.sink.loop(`matter:${s}:b`, 'matter', p, bed * 1.4, { variant: `matter/${name}/dense`, aux: this.cur[o + 2]!, ref: 50 });
        } else if (this.panners[s]) {
          const pn = this.panners[s]!;
          if (finite3(p)) { pn.positionX.value = p[0]; pn.positionY.value = p[1]; pn.positionZ.value = p[2]; }
        }
      }
    }
    this.active = active;
    this.level = level;
    // post at most every 20 ms of audio time while anything sounds, plus one last post as it falls silent
    if (this.node && now - this.posted >= (this.sync ? 0 : 0.02) && (active > 0 || this.wasActive)) {
      // streams that fell silent get exact zeros (the worklet would otherwise idle on a −60 dB bed)
      // beta (D127): a clip's posts carry a sequence number after the params; the worklet echoes it once applied
      const msg = new Float32Array(this.cur.length + (this.sync ? 1 : 0));
      msg.set(this.cur);
      for (let s = 0; s < MATTER_STREAMS; s++) if (!this.on[s]) { msg[s * P + 1] = 0; msg[s * P + 4] = 0; }
      if (this.sync) msg[this.cur.length] = ++this.seq;
      this.node.port.postMessage(msg);
      this.stats.posts++;
      this.posted = now;
      this.wasActive = active > 0;
    }
  }

  /**
   * Beta (D127), sync mode: resolves once the worklet has applied the newest post (at once when there's nothing
   * pending). A worklet that never answers (250 ms, three times) stops being waited for: the clip renders on, as before.
   */
  synced(): Promise<void> {
    if (!this.sync || !this.node || this.acked >= this.seq || this.stats.ackTimeouts >= 3) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const fin1 = (): void => { if (!done) { done = true; resolve(); } };
      this.waiters.push(fin1);
      setTimeout(() => { if (!done) { this.stats.ackTimeouts++; fin1(); } }, 250);
    });
  }

  dispose(): void {
    { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
    try { this.node?.disconnect(); for (const p of this.panners) p.disconnect(); } catch { /* already gone */ }
    this.node = null; this.panners = []; this.mode = 'off';
  }
}
