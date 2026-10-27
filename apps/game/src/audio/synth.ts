// Offline DSP toolkit: everything here writes into Float32Arrays at load time (no realtime cost).
// The resulting sample data is wrapped into AudioBuffers by the bank.

import { Rng } from './rng';

export const SR = 48000;

/** Yield to the event loop. MessageChannel is not clamped/throttled like setTimeout in background tabs. */
export function yieldToMain(): Promise<void> {
  return new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); res(); };
    ch.port2.postMessage(0);
  });
}
const TAU = Math.PI * 2;

export function alloc(sec: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(sec * SR)));
}

export function dbToGain(db: number): number { return Math.pow(10, db / 20); }

/** Scale so the absolute peak equals `peak` (linear). Silent input is left alone. */
export function normalize(x: Float32Array, peak = 0.5): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]!); if (a > m) m = a; }
  if (m > 1e-9) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] = x[i]! * k; }
  return x;
}

/** Normalise several channels by their common peak. */
export function normalizeAll(chs: Float32Array[], peak = 0.5): void {
  let m = 0;
  for (const x of chs) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]!); if (a > m) m = a; }
  if (m > 1e-9) { const k = peak / m; for (const x of chs) for (let i = 0; i < x.length; i++) x[i] = x[i]! * k; }
}

/** dst += src * g starting at sample offset. */
export function mixInto(dst: Float32Array, src: Float32Array, at = 0, g = 1): void {
  const n = Math.min(src.length, dst.length - at);
  for (let i = Math.max(0, -at); i < n; i++) dst[at + i] = dst[at + i]! + src[i]! * g;
}

/** Short linear fades to kill clicks at buffer edges. */
export function fadeEdges(x: Float32Array, inSec = 0.001, outSec = 0.005): Float32Array {
  const a = Math.min(x.length, Math.round(inSec * SR)), b = Math.min(x.length, Math.round(outSec * SR));
  for (let i = 0; i < a; i++) x[i] = x[i]! * (i / a);
  for (let i = 0; i < b; i++) { const k = x.length - 1 - i; x[k] = x[k]! * (i / b); }
  return x;
}

export function softClip(x: Float32Array, drive = 1): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * drive) / k;
  return x;
}

export function reverse(x: Float32Array): Float32Array {
  x.reverse();
  return x;
}

export function white(len: number, rng: Rng): Float32Array {
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = rng.bi();
  return x;
}

/** Brown-ish (integrated, leaky) noise, roughly unit peak. */
export function brown(len: number, rng: Rng): Float32Array {
  const x = new Float32Array(len);
  let y = 0;
  for (let i = 0; i < len; i++) { y = y * 0.996 + rng.bi() * 0.06; x[i] = y; }
  return normalize(x, 1);
}

// ---------- filters ----------

export type BqType = 'lp' | 'hp' | 'bp' | 'peak';

/** RBJ biquad, direct form I. Parameters can be changed while running. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(type: BqType, f: number, q = 0.707, gainDb = 0) { this.set(type, f, q, gainDb); }
  set(type: BqType, f: number, q = 0.707, gainDb = 0): void {
    const w = TAU * Math.min(Math.max(f, 10), SR * 0.49) / SR;
    const cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(x: Float32Array): Float32Array {
    for (let i = 0; i < x.length; i++) x[i] = this.tick(x[i]!);
    return x;
  }
}

export function lp(x: Float32Array, f: number, q = 0.707): Float32Array { return new Biquad('lp', f, q).run(x); }
export function hp(x: Float32Array, f: number, q = 0.707): Float32Array { return new Biquad('hp', f, q).run(x); }
export function bp(x: Float32Array, f: number, q = 1): Float32Array { return new Biquad('bp', f, q).run(x); }

/** Time-varying filter: f(t) in Hz evaluated every 32 samples. */
export function sweep(x: Float32Array, type: BqType, f: (t: number) => number, q = 0.707): Float32Array {
  const bq = new Biquad(type, f(0), q);
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) bq.set(type, f(i / SR), q);
    x[i] = bq.tick(x[i]!);
  }
  return x;
}

// ---------- envelopes ----------

/** Multiply by attack (linear) then exponential decay with time constant tau. */
export function envAD(x: Float32Array, attack: number, tau: number, delay = 0): Float32Array {
  const a = Math.max(1, attack * SR), d0 = Math.round(delay * SR);
  for (let i = 0; i < x.length; i++) {
    const n = i - d0;
    const g = n < 0 ? 0 : n < a ? n / a : Math.exp(-(n - a) / (tau * SR));
    x[i] = x[i]! * g;
  }
  return x;
}

export function envFn(x: Float32Array, g: (t: number) => number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * g(i / SR);
  return x;
}

// ---------- oscillators ----------

/** Sine with frequency function f(t) (phase-accumulated) and amplitude envelope. */
export function chirp(len: number, f: (t: number) => number, amp: (t: number) => number = () => 1, phase0 = 0): Float32Array {
  const x = new Float32Array(len);
  let ph = phase0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    x[i] = Math.sin(ph) * amp(t);
    ph += TAU * f(t) / SR;
  }
  return x;
}

/** Exponential glide from f0 to f1 with time constant tau. */
export function glide(f0: number, f1: number, tau: number): (t: number) => number {
  return (t) => f1 + (f0 - f1) * Math.exp(-t / tau);
}

/** Naive saw (we always low-pass after). */
export function saw(len: number, f: number, phase = 0): Float32Array {
  const x = new Float32Array(len);
  let p = phase;
  const inc = f / SR;
  for (let i = 0; i < len; i++) { x[i] = 2 * p - 1; p += inc; if (p >= 1) p -= 1; }
  return x;
}

export function pulse(len: number, f: number, width = 0.5, vib: (t: number) => number = () => 0): Float32Array {
  const x = new Float32Array(len);
  let p = 0;
  for (let i = 0; i < len; i++) {
    x[i] = p < width ? 1 : -1;
    p += f * Math.pow(2, vib(i / SR) / 12) / SR;
    if (p >= 1) p -= 1;
  }
  return x;
}

// ---------- modal synthesis ----------

export interface Mode { f: number; amp: number; tau: number }

/**
 * Excite a bank of two-pole resonators with `exc`. Each resonator's impulse response is
 * amp · e^(−t/tau) · sin(2πft), so `amp` is the mode's level for a unit impulse.
 */
export function modal(len: number, exc: Float32Array, modes: readonly Mode[]): Float32Array {
  const out = new Float32Array(len);
  for (const m of modes) {
    if (m.f >= SR * 0.45 || m.amp === 0) continue;
    const w = TAU * m.f / SR;
    const r = Math.exp(-1 / (m.tau * SR));
    const a1 = 2 * r * Math.cos(w), a2 = r * r;
    const g = m.amp * Math.sin(w);
    let y1 = 0, y2 = 0;
    // stop once decayed below -90 dB to save time
    const stop = Math.min(len, Math.round(m.tau * SR * 10.4) + exc.length);
    for (let i = 0; i < stop; i++) {
      const xin = i < exc.length ? exc[i]! * g : 0;
      const y = xin + a1 * y1 - a2 * y2;
      y2 = y1; y1 = y;
      out[i] = out[i]! + y;
    }
  }
  return out;
}

/** Raised-cosine contact pulse of `width` seconds, plus optional roughness noise. Unit area-ish. */
export function contact(width: number, rng: Rng, rough = 0): Float32Array {
  const n = Math.max(2, Math.round(width * SR));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos(TAU * (i + 0.5) / n);
    x[i] = (w * (1 - rough) + rough * w * rng.bi()) * (2 / n) * 8;
  }
  return x;
}

/** Karplus-Strong plucked string. */
export function pluck(len: number, f: number, rng: Rng, damp = 0.996, bright = 0.5): Float32Array {
  const x = new Float32Array(len);
  const p = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(p);
  for (let i = 0; i < p; i++) buf[i] = rng.bi();
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx]!;
    const nxt = buf[(idx + 1) % p]!;
    x[i] = cur;
    buf[idx] = damp * (bright * cur + (1 - bright) * 0.5 * (cur + nxt));
    idx = (idx + 1) % p;
  }
  return x;
}

/** Sprinkle `count`-per-second (time-varying) grains rendered by `grain` into x. */
export function grains(x: Float32Array, rng: Rng, rate: (t: number) => number, grain: (rng: Rng, t: number) => Float32Array): Float32Array {
  let t = 0;
  const dur = x.length / SR;
  while (t < dur) {
    const r = Math.max(rate(t), 0.5);
    t += -Math.log(1 - rng.next() * 0.999) / r;
    if (t >= dur) break;
    if (rate(t) <= 0.01) continue;
    mixInto(x, grain(rng, t), Math.round(t * SR));
  }
  return x;
}

/**
 * Make a seamless loop: render `gen(len + xf)` and crossfade the extra tail into the head
 * with an equal-power fade, returning `len` samples whose end flows into its start.
 */
export function seamless(sec: number, xfSec: number, gen: (len: number) => Float32Array): Float32Array {
  const len = Math.round(sec * SR), xf = Math.round(xfSec * SR);
  const src = gen(len + xf);
  const out = src.slice(0, len);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    const a = Math.sin(k * Math.PI / 2), b = Math.cos(k * Math.PI / 2);
    out[i] = src[i]! * a + src[len + i]! * b;
  }
  return out;
}

// ---------- voice (formant synthesis, M2 critters) ----------

export interface Formant { f: number; bw: number; amp: number }

/**
 * A cartoon voice: a band-limited (polyBLEP) saw glottal source with pitch contour `f0(t)`, optional breath noise,
 * through time-varying band-pass formants (re-tuned every 32 samples), shaped by `amp(t)`.
 * Cheap enough to render dozens of barks at load.
 */
export function voice(sec: number, f0: (t: number) => number, formants: (t: number) => readonly Formant[], amp: (t: number) => number,
  rng: Rng, o: { breath?: number; jitter?: number; tilt?: number } = {}): Float32Array {
  const len = Math.max(1, Math.round(sec * SR));
  const src = new Float32Array(len);
  const breath = o.breath ?? 0.05, jit = o.jitter ?? 0.01;
  let p = 0, j = 0, lpState = 0;
  const tiltK = 1 - Math.exp(-TAU * (o.tilt ?? 2500) / SR); // one-pole glottal tilt
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    j = j * 0.995 + rng.bi() * 0.005 * 14; // slow pitch flutter
    const f = Math.max(20, f0(t) * (1 + jit * j));
    const dt = f / SR;
    p += dt;
    if (p >= 1) p -= 1;
    let v = 2 * p - 1;
    if (p < dt) { const x = p / dt; v -= x + x - x * x - 1; }
    else if (p > 1 - dt) { const x = (p - 1) / dt; v -= x * x + x + x + 1; }
    lpState += (v - lpState) * tiltK;
    src[i] = lpState + breath * rng.bi();
  }
  const out = new Float32Array(len);
  const first = formants(0);
  const bqs = first.map((fm) => new Biquad('bp', fm.f, Math.max(0.5, fm.f / fm.bw)));
  let fms = first;
  for (let i = 0; i < len; i++) {
    if ((i & 31) === 0) {
      fms = formants(i / SR);
      for (let k = 0; k < bqs.length; k++) { const fm = fms[k]!; bqs[k]!.set('bp', fm.f, Math.max(0.5, fm.f / fm.bw)); }
    }
    const x = src[i]!;
    let y = 0;
    for (let k = 0; k < bqs.length; k++) y += bqs[k]!.tick(x) * fms[k]!.amp;
    out[i] = y * amp(i / SR);
  }
  return out;
}

/** Linear interpolation through keyframes [[t, v], …] (clamped at the ends). */
export function keys(k: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) {
      const [t1, v1] = k[i]!;
      if (t <= t1) { const [t0, v0] = k[i - 1]!; return v0 + (v1 - v0) * (t - t0) / Math.max(1e-9, t1 - t0); }
    }
    return k[k.length - 1]![1];
  };
}

/** A cartoon bubble "bloop": a sine whose pitch rises quickly (Minnaert-style resonance shrinking). */
export function bubble(sec: number, f0: number, rise: number, tau: number): Float32Array {
  return chirp(Math.round(sec * SR), (t) => f0 * (1 + rise * (1 - Math.exp(-t / (tau * 0.8)))), (t) => Math.min(1, t / 0.002) * Math.exp(-t / tau));
}
