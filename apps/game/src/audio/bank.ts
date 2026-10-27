// Procedural SFX bank. Every sound is synthesised at load from a fixed seed (name/variant), so it is
// identical on every machine and every run. No external files, nothing sampled (assets rule).
//
// Levels follow AUDIO.md §10 loosely: one-shots peak at -6 dBFS (0.5), loops ~0.35 peak, UI ~0.3 peak.

import { Rng } from './rng';
import {
  SR, alloc, bp, brown, chirp, contact, envAD, envFn, fadeEdges, glide, grains, hp, lp, mixInto, modal, normalize,
  pluck, reverse, seamless, softClip, sweep, white, yieldToMain, type Mode,
} from './synth';

export type Material = 'wood' | 'steel' | 'brick' | 'rubber' | 'glass' | 'paper' | 'poly' | 'tile';
export const MATERIALS: readonly Material[] = ['wood', 'steel', 'brick', 'rubber', 'glass', 'paper', 'poly', 'tile'];
export const TIERS = ['soft', 'med', 'hard'] as const;
export type Tier = (typeof TIERS)[number];
export const IMPACT_VARIANTS = 4;

interface MatSpec {
  f0: number; ratios: number[]; amps: number[]; taus: number[];
  exc: [number, number, number]; rough: number;
  noise: { f: number; q: number; tau: number; amt: number };
  dur: number;
}

const MAT: Record<Material, MatSpec> = {
  wood:   { f0: 380, ratios: [1, 1.58, 2.61, 3.9, 5.4], amps: [1, 0.7, 0.5, 0.35, 0.2], taus: [0.06, 0.04, 0.028, 0.018, 0.012], exc: [0.003, 0.0011, 0.0004], rough: 0.2, noise: { f: 2500, q: 0.8, tau: 0.012, amt: 0.35 }, dur: 0.35 },
  steel:  { f0: 820, ratios: [1, 2.756, 5.404, 8.933, 13.34], amps: [1, 0.8, 0.6, 0.4, 0.25], taus: [0.9, 0.6, 0.4, 0.25, 0.15], exc: [0.002, 0.0006, 0.00015], rough: 0.1, noise: { f: 6000, q: 0.7, tau: 0.004, amt: 0.25 }, dur: 1.4 },
  brick:  { f0: 260, ratios: [1, 1.73, 2.87, 4.2], amps: [1, 0.6, 0.4, 0.3], taus: [0.03, 0.02, 0.014, 0.01], exc: [0.004, 0.0015, 0.0006], rough: 0.5, noise: { f: 1800, q: 0.6, tau: 0.03, amt: 1.0 }, dur: 0.3 },
  rubber: { f0: 150, ratios: [1, 1.9, 3.1], amps: [1, 0.4, 0.15], taus: [0.035, 0.02, 0.012], exc: [0.008, 0.004, 0.002], rough: 0.1, noise: { f: 600, q: 0.7, tau: 0.015, amt: 0.15 }, dur: 0.25 },
  glass:  { f0: 1650, ratios: [1, 2.32, 4.25, 6.63, 9.38], amps: [1, 0.7, 0.5, 0.4, 0.3], taus: [0.5, 0.35, 0.22, 0.14, 0.09], exc: [0.0012, 0.0004, 0.0001], rough: 0.1, noise: { f: 7000, q: 1, tau: 0.003, amt: 0.2 }, dur: 1.0 },
  paper:  { f0: 320, ratios: [1, 2.3], amps: [1, 0.4], taus: [0.02, 0.012], exc: [0.005, 0.002, 0.0008], rough: 0.6, noise: { f: 1600, q: 0.5, tau: 0.025, amt: 1.2 }, dur: 0.2 },
  poly:   { f0: 560, ratios: [1, 2.1, 3.7, 5.6], amps: [1, 0.6, 0.35, 0.2], taus: [0.045, 0.03, 0.018, 0.01], exc: [0.0025, 0.0009, 0.0003], rough: 0.15, noise: { f: 3500, q: 0.8, tau: 0.008, amt: 0.3 }, dur: 0.3 },
  tile:   { f0: 1300, ratios: [1, 2.4, 4.1], amps: [1, 0.5, 0.3], taus: [0.025, 0.014, 0.008], exc: [0.0012, 0.0005, 0.0002], rough: 0.1, noise: { f: 5000, q: 1, tau: 0.004, amt: 0.3 }, dur: 0.15 },
};

export function impact(mat: Material, tier: number, rng: Rng): Float32Array {
  const P = MAT[mat];
  const pitch = 1 + rng.bi() * 0.04;
  const modes: Mode[] = P.ratios.map((r, i) => ({
    f: P.f0 * r * pitch * (1 + rng.bi() * 0.015),
    amp: P.amps[i]! * (0.7 + 0.6 * rng.next()),
    tau: P.taus[i]! * (0.85 + 0.3 * rng.next()) * (tier === 0 ? 0.8 : 1),
  }));
  const len = Math.round(P.dur * SR * (tier === 2 ? 1 : 0.85));
  const exc = contact(P.exc[tier as 0 | 1 | 2] * (0.8 + 0.4 * rng.next()), rng, P.rough);
  const x = modal(len, exc, modes);
  normalize(x, 1);
  // contact noise: grit, crunch, scrape
  const nl = Math.min(len, Math.round(P.noise.tau * 8 * SR));
  const n = envAD(white(nl, rng), 0.0004, P.noise.tau * (tier === 2 ? 1.3 : 1));
  bp(n, P.noise.f * (tier === 0 ? 0.6 : 1), P.noise.q);
  normalize(n, P.noise.amt * (tier === 0 ? 0.5 : tier === 1 ? 0.8 : 1.1));
  mixInto(x, n);
  // a hard hit on a brittle material adds a small secondary crack
  if (tier === 2 && (mat === 'brick' || mat === 'glass' || mat === 'wood')) {
    const c = envAD(white(Math.round(0.03 * SR), rng), 0.0002, 0.004);
    hp(c, mat === 'brick' ? 1200 : 3000);
    mixInto(x, normalize(c, 0.25), Math.round((0.004 + rng.next() * 0.01) * SR));
  }
  if (tier === 0) lp(x, mat === 'steel' || mat === 'glass' ? 5000 : 3000);
  return fadeEdges(normalize(x, 0.5), 0.0003, 0.02);
}

/** Heavy-object sub thump layered under hard hits of massive parts. */
function thump(rng: Rng): Float32Array {
  const len = Math.round(0.4 * SR);
  const f0 = 85 + rng.bi() * 8;
  const x = chirp(len, glide(f0 * 1.4, f0 * 0.5, 0.05), (t) => Math.exp(-t / 0.11));
  const c = envAD(white(Math.round(0.02 * SR), rng), 0.0003, 0.004);
  lp(c, 1500);
  mixInto(x, normalize(c, 0.3));
  return fadeEdges(normalize(x, 0.5));
}

/** The BOING signature: a rubbery pitch-falling "boyoyng". */
function boing(rng: Rng): Float32Array {
  const len = Math.round(0.5 * SR);
  const f0 = 330 * (1 + rng.bi() * 0.06);
  const x = chirp(len, (t) => (f0 * 0.72 + f0 * 0.5 * Math.exp(-t / 0.06)) * (1 + 0.035 * Math.sin(2 * Math.PI * 17 * t) * Math.exp(-t / 0.2)),
    (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.13));
  const h = chirp(len, (t) => (f0 * 0.72 + f0 * 0.5 * Math.exp(-t / 0.06)) * 2.01, (t) => 0.25 * Math.exp(-t / 0.05));
  mixInto(x, h);
  mixInto(x, impact('rubber', 2, rng), 0, 0.6);
  return fadeEdges(normalize(x, 0.5));
}

/** Topple Tiles cluster layer: a dense run of clacks that stands in for ≥ 8 hits in 100 ms. */
function cascade(rng: Rng): Float32Array {
  const x = alloc(0.45);
  const toks = [0, 1, 2, 3].map(() => impact('tile', 1, rng));
  grains(x, rng, (t) => 140 * Math.exp(-t / 0.18), (r) => {
    const g = toks[r.int(4)]!.slice();
    const k = 0.25 + 0.75 * r.next();
    for (let i = 0; i < g.length; i++) g[i] = g[i]! * k;
    return g;
  });
  return fadeEdges(normalize(x, 0.5), 0.001, 0.05);
}

// ---------- pyro ----------

export function crack(rng: Rng): Float32Array {
  const x = envAD(white(Math.round(0.12 * SR), rng), 0.0002, 0.012);
  hp(x, 700);
  for (let k = 0; k < 4; k++) {
    const c = envAD(white(Math.round(0.01 * SR), rng), 0.0001, 0.0015);
    mixInto(x, c, Math.round(rng.next() * 0.025 * SR), 0.8);
  }
  softClip(normalize(x, 1), 2.5);
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.02);
}

const BODY = [
  { dur: 1.5, tau: 0.22, fs: 5200, tf: 0.06, th: 0.06, thA: 0.16, f0: 110 },
  { dur: 2.3, tau: 0.4, fs: 4200, tf: 0.1, th: 0.09, thA: 0.26, f0: 95 },
  { dur: 3.4, tau: 0.65, fs: 3400, tf: 0.16, th: 0.12, thA: 0.4, f0: 80 },
] as const;

function boomBody(size: 0 | 1 | 2, rng: Rng): Float32Array {
  const B = BODY[size];
  const len = Math.round(B.dur * SR);
  const w = white(len, rng), br = brown(len, rng);
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = w[i]! * 0.55 + br[i]! * 0.8;
  sweep(x, 'lp', (t) => 140 + B.fs * Math.exp(-t / B.tf), 0.8);
  envFn(x, (t) => Math.min(1, t / 0.003) * (0.75 * Math.exp(-t / B.tau) + 0.25 * Math.exp(-t / (B.tau * 3.2))));
  normalize(x, 1);
  const th = chirp(len, glide(B.f0 * 1.6, B.f0 * 0.42, B.th), (t) => Math.min(1, t / 0.002) * Math.exp(-t / B.thA));
  mixInto(x, th, 0, 0.9);
  // late rumble
  const rum = lp(brown(len, rng), 160);
  envFn(rum, (t) => Math.min(1, t / 0.05) * Math.exp(-t / (B.tau * 2.5)));
  mixInto(x, normalize(rum, 0.35));
  softClip(normalize(x, 1), 1.6);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.25);
}

function sub(rng: Rng): Float32Array {
  const len = Math.round(1.8 * SR);
  const f0 = 52 + rng.bi() * 4;
  const x = chirp(len, glide(f0 * 1.3, f0 * 0.55, 0.3), (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.45));
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.2);
}

export type Debris = 'wood' | 'brick' | 'glass' | 'paper';

export function debris(kind: Debris, rng: Rng): Float32Array {
  const x = alloc(kind === 'paper' ? 1.2 : 1.7);
  if (kind === 'paper') {
    // confetti and paper scraps flutter down: band-passed noise with random flutter AM
    const n = white(x.length, rng);
    bp(n, 2200, 0.5);
    let ph = 0, fr = 14;
    for (let i = 0; i < n.length; i++) {
      if ((i & 1023) === 0) fr = 9 + rng.next() * 16;
      ph += 2 * Math.PI * fr / SR;
      const t = i / SR;
      n[i] = n[i]! * (0.4 + 0.6 * Math.abs(Math.sin(ph))) * Math.min(1, t / 0.05) * Math.exp(-t / 0.35);
    }
    mixInto(x, n);
    grains(x, rng, (t) => 30 * Math.exp(-t / 0.4), (r) => normalize(impact('paper', 0, r), 0.3 * r.next()));
  } else {
    const mat: Material = kind;
    const rate = kind === 'brick' ? 70 : kind === 'glass' ? 55 : 60;
    const tau = kind === 'brick' ? 0.35 : 0.45;
    grains(x, rng, (t) => (t < 0.08 ? rate * t / 0.08 : rate * Math.exp(-(t - 0.08) / tau)), (r, t) => {
      const g = impact(mat, r.next() < 0.3 ? 1 : 0, r);
      // later grains are smaller and quieter (bits settling)
      return normalize(g, (0.15 + 0.85 * r.next()) * Math.exp(-t / 0.9) * 0.5);
    });
    if (kind === 'brick') {
      const n = lp(brown(x.length, rng), 600);
      envFn(n, (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.3));
      mixInto(x, normalize(n, 0.25));
    }
  }
  return fadeEdges(normalize(x, 0.5), 0.002, 0.2);
}

// ---------- mechanisms, power, fire ----------

export function relay(rng: Rng): Float32Array {
  const x = alloc(0.06);
  const f = 3000 * (1 + rng.bi() * 0.08);
  const k1 = modal(x.length, contact(0.00015, rng), [{ f, amp: 1, tau: 0.006 }, { f: f * 1.9, amp: 0.5, tau: 0.004 }]);
  mixInto(x, k1);
  mixInto(x, k1, Math.round((0.005 + rng.next() * 0.003) * SR), 0.6);
  const n = envAD(white(Math.round(0.01 * SR), rng), 0.0001, 0.0015);
  mixInto(x, hp(n, 3000), 0, 0.3);
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.01);
}

function clunk(rng: Rng): Float32Array {
  const x = impact('poly', 2, rng);
  mixInto(x, relay(rng), 0, 0.5);
  return normalize(x, 0.5);
}

/** Motor spin up (up=true) or spin down: harmonic stack sweeping in frequency. */
function spin(up: boolean, rng: Rng): Float32Array {
  const dur = up ? 0.7 : 1.3;
  const len = Math.round(dur * SR);
  const x = new Float32Array(len);
  const f = (t: number) => (up ? 25 + 75 * (1 - Math.exp(-t / 0.2)) : 100 * Math.exp(-t / 0.4) + 8);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * f(t) / SR;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(ph * h) / h;
    s += 0.35 * Math.sin(ph * 7.0 + 0.3);
    const a = up ? Math.min(1, t / 0.05) * (t > dur - 0.15 ? (dur - t) / 0.15 : 1) : Math.exp(-t / 0.5);
    x[i] = s * a;
  }
  const n = hp(white(len, rng), 2000);
  envFn(n, (t) => 0.05 * (up ? Math.min(1, t / 0.3) : Math.exp(-t / 0.3)));
  mixInto(x, n);
  return fadeEdges(normalize(x, 0.35), 0.002, 0.03);
}

function fuseIgnite(rng: Rng): Float32Array {
  const len = Math.round(0.4 * SR);
  const x = white(len, rng);
  sweep(x, 'bp', (t) => 1400 + 5200 * Math.exp(-t / 0.05), 1.2);
  envAD(x, 0.002, 0.07);
  normalize(x, 1);
  const pop = envAD(white(Math.round(0.01 * SR), rng), 0.0001, 0.001);
  mixInto(x, pop, 0, 0.6);
  grains(x, rng, (t) => 80 * Math.exp(-t / 0.1), (r) => normalize(hp(envAD(white(160, r), 0.00005, 0.0006), 2500), 0.4 * r.next()));
  return fadeEdges(normalize(x, 0.45), 0.0001, 0.05);
}

function whoomph(rng: Rng): Float32Array {
  const len = Math.round(0.9 * SR);
  const x = white(len, rng);
  sweep(x, 'lp', (t) => (t < 0.06 ? 150 + 1400 * t / 0.06 : 450 + 1100 * Math.exp(-(t - 0.06) / 0.12)), 1.1);
  envFn(x, (t) => Math.min(1, t / 0.04) * Math.exp(-t / 0.25));
  normalize(x, 1);
  const lo = chirp(len, glide(55, 75, 0.05), (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.15));
  mixInto(x, lo, 0, 0.6);
  return fadeEdges(normalize(x, 0.45), 0.001, 0.1);
}

function puff(rng: Rng): Float32Array {
  const len = Math.round(0.5 * SR);
  const x = bp(white(len, rng), 900, 0.6);
  envAD(x, 0.006, 0.06);
  normalize(x, 1);
  const s = hp(white(len, rng), 4500);
  envFn(s, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.18) * 0.25);
  mixInto(x, s);
  return fadeEdges(normalize(x, 0.4), 0.001, 0.05);
}

function fuseEnd(rng: Rng): Float32Array {
  const x = alloc(0.5);
  grains(x, rng, (t) => (t < 0.15 ? 90 : 0), (r) => normalize(hp(envAD(white(200, r), 0.00005, 0.0007), 2000), 0.5 * r.next()));
  const p = bp(white(x.length, rng), 1500, 0.7);
  envAD(p, 0.01, 0.05, 0.12);
  mixInto(x, normalize(p, 0.5));
  mixInto(x, normalize(impact('paper', 1, rng), 0.5), Math.round(0.16 * SR));
  return fadeEdges(normalize(x, 0.45), 0.0005, 0.05);
}

function balloonPop(rng: Rng): Float32Array {
  const len = Math.round(0.4 * SR);
  const x = new Float32Array(len);
  const bang = envAD(white(Math.round(0.06 * SR), rng), 0.00005, 0.005);
  hp(bang, 250);
  mixInto(x, normalize(bang, 1));
  const fl = bp(white(len, rng), 1200, 0.7);
  envFn(fl, (t) => (t < 0.004 ? 0 : (0.5 + 0.5 * Math.sin(2 * Math.PI * 31 * t)) * Math.exp(-(t - 0.004) / 0.07)));
  mixInto(x, normalize(fl, 0.35));
  const th = chirp(len, glide(130, 60, 0.02), (t) => Math.exp(-t / 0.04));
  mixInto(x, th, 0, 0.5);
  softClip(normalize(x, 1), 2);
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.05);
}

function ropeSnap(rng: Rng): Float32Array {
  const len = Math.round(0.7 * SR);
  const x = new Float32Array(len);
  for (const at of [0, 0.02 + rng.next() * 0.01]) {
    const s = hp(envAD(white(Math.round(0.04 * SR), rng), 0.0003, 0.008), 3000);
    mixInto(x, normalize(s, at === 0 ? 0.6 : 0.4), Math.round(at * SR));
  }
  const tw = lp(pluck(len, 95 + rng.next() * 35, rng, 0.994, 0.7), 2400);
  envFn(tw, (t) => Math.exp(-t / 0.18));
  mixInto(x, normalize(tw, 0.7), Math.round(0.01 * SR));
  const whip = chirp(Math.round(0.08 * SR), glide(2200, 400, 0.02), (t) => Math.exp(-t / 0.015));
  mixInto(x, whip, Math.round(0.012 * SR), 0.3);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.05);
}

function buttonPress(rng: Rng): Float32Array {
  const x = alloc(0.3);
  const down = modal(x.length, contact(0.0003, rng), [{ f: 1800, amp: 1, tau: 0.012 }, { f: 3100, amp: 0.6, tau: 0.008 }, { f: 5200, amp: 0.3, tau: 0.005 }]);
  mixInto(x, normalize(down, 0.7));
  const thock = modal(x.length, contact(0.0015, rng), [{ f: 170 * (1 + rng.bi() * 0.04), amp: 1, tau: 0.05 }, { f: 410, amp: 0.4, tau: 0.03 }]);
  mixInto(x, normalize(thock, 0.8), Math.round(0.004 * SR));
  const up = modal(x.length, contact(0.0002, rng), [{ f: 2400, amp: 1, tau: 0.008 }, { f: 4100, amp: 0.5, tau: 0.005 }]);
  mixInto(x, normalize(up, 0.35), Math.round((0.11 + rng.next() * 0.02) * SR));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.02);
}

function padPress(rng: Rng): Float32Array {
  const x = impact('rubber', 2, rng);
  mixInto(x, relay(rng), Math.round(0.01 * SR), 0.6);
  return normalize(x, 0.5);
}

// ---------- loops (seamless) ----------

function loopFuse(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.15, (len) => {
    const x = white(len, rng);
    bp(x, 5200, 0.6);
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.999 + rng.bi() * 0.02; x[i] = x[i]! * (0.7 + 4 * am); }
    normalize(x, 0.5);
    grains(x, rng, () => 28, (r) => normalize(hp(envAD(white(240, r), 0.00005, 0.0008), 1800), 0.25 + 0.45 * r.next()));
    return x;
  }), 0.35);
}

function loopMotor(rng: Rng): Float32Array {
  const len = SR; // exactly 1 s: 100 Hz fundamental and integer-Hz wobble are periodic
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const ph = 2 * Math.PI * 100 * t;
    let s = 0;
    for (let h = 1; h <= 10; h++) s += Math.sin(ph * h + h * 0.7) / (h * (h % 2 === 0 ? 1.6 : 1));
    s += 0.3 * Math.sin(ph * 7) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 3 * t)); // whine
    s += 0.12 * Math.sin(ph * 24); // commutator buzz
    x[i] = s;
  }
  normalize(x, 1);
  const brush = seamless(1, 0.1, (n) => bp(white(n, rng), 4000, 0.8));
  mixInto(x, normalize(brush, 0.12));
  return normalize(x, 0.32);
}

function loopFan(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = lp(white(len, rng), 1400);
    const b = brown(len, rng);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      x[i] = (x[i]! * 0.8 + b[i]! * 0.3) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 24 * t)) + 0.08 * Math.sin(2 * Math.PI * 120 * t);
    }
    return x;
  }), 0.32);
}

function loopFlame(rng: Rng): Float32Array {
  return normalize(seamless(2.5, 0.25, (len) => {
    const x = lp(white(len, rng), 700);
    const b = brown(len, rng);
    let fl = 0;
    for (let i = 0; i < len; i++) {
      fl = fl * 0.9995 + rng.bi() * 0.012;
      x[i] = (x[i]! * 0.7 + b[i]! * 0.5) * (0.6 + 3 * Math.abs(fl));
    }
    normalize(x, 0.5);
    grains(x, rng, () => 6, (r) => normalize(bp(envAD(white(600, r), 0.0001, 0.002), 2500, 1), 0.2 + 0.3 * r.next()));
    return x;
  }), 0.33);
}

function loopRoll(kind: 'heavy' | 'rubber' | 'hard', rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const cut = kind === 'heavy' ? 220 : kind === 'rubber' ? 450 : 1600;
    const x = lp(brown(len, rng), cut, 0.9);
    if (kind === 'hard') { const h = bp(white(len, rng), 3500, 0.7); mixInto(x, normalize(h, 0.15)); }
    let am = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      am = am * 0.9997 + rng.bi() * 0.01;
      x[i] = x[i]! * (0.75 + 0.18 * Math.sin(2 * Math.PI * 4 * t) + 2 * am);
    }
    normalize(x, 0.5);
    if (kind !== 'heavy') {
      const mat: Material = kind === 'rubber' ? 'rubber' : 'glass';
      const toks = [0, 1, 2].map(() => impact(mat, 0, rng));
      grains(x, rng, () => (kind === 'rubber' ? 18 : 30), (r) => normalize(toks[r.int(3)]!.slice(), 0.05 + 0.12 * r.next()));
    }
    return x;
  }), 0.35);
}

// ---------- UI (dry, centred) ----------

const UI: Record<string, (rng: Rng) => Float32Array> = {
  place: (rng) => {
    const x = impact('poly', 1, rng);
    const lo = modal(x.length, contact(0.002, rng), [{ f: 210, amp: 1, tau: 0.045 }]);
    mixInto(x, normalize(lo, 0.6));
    return normalize(x, 0.3);
  },
  remove: (rng) => {
    const len = Math.round(0.14 * SR);
    const x = chirp(len, glide(620, 230, 0.04), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.04));
    mixInto(x, normalize(bp(envAD(white(len, rng), 0.001, 0.02), 1200, 1), 0.15));
    return fadeEdges(normalize(x, 0.25));
  },
  rotate: (rng) => {
    const x = alloc(0.07);
    const k = modal(x.length, contact(0.0002, rng), [{ f: 2600, amp: 1, tau: 0.005 }, { f: 4300, amp: 0.4, tau: 0.003 }]);
    mixInto(x, k);
    mixInto(x, k, Math.round(0.028 * SR), 0.6);
    return fadeEdges(normalize(x, 0.2));
  },
  wire: () => {
    const len = Math.round(0.22 * SR);
    const x = chirp(len, glide(140, 200, 0.03), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.05));
    mixInto(x, chirp(len, glide(900, 1320, 0.02), (t) => Math.min(1, t / 0.004) * 0.35 * Math.exp(-t / 0.07)), Math.round(0.02 * SR));
    return fadeEdges(normalize(x, 0.3));
  },
  unwire: () => {
    const len = Math.round(0.2 * SR);
    const x = chirp(len, glide(1200, 700, 0.03), (t) => Math.min(1, t / 0.003) * 0.4 * Math.exp(-t / 0.05));
    mixInto(x, chirp(len, glide(200, 120, 0.04), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.05)), Math.round(0.03 * SR));
    return fadeEdges(normalize(x, 0.25));
  },
  select: (rng) => {
    const len = Math.round(0.08 * SR);
    const x = modal(len, contact(0.00015, rng), [{ f: 3000, amp: 1, tau: 0.004 }]);
    mixInto(x, chirp(len, glide(900, 1350, 0.015), (t) => 0.5 * Math.exp(-t / 0.02)));
    return fadeEdges(normalize(x, 0.2));
  },
  countdown: () => {
    const len = Math.round(0.35 * SR);
    const f = 523.25; // C5; later beats are re-pitched to E5 and G5
    const x = chirp(len, () => f, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.12));
    mixInto(x, chirp(len, () => f * 2, (t) => 0.3 * Math.exp(-t / 0.06)));
    mixInto(x, chirp(len, () => f * 3, (t) => 0.12 * Math.exp(-t / 0.04)));
    return fadeEdges(normalize(x, 0.3));
  },
  go: (rng) => {
    const len = Math.round(1.2 * SR);
    const x = white(len, rng);
    sweep(x, 'bp', (t) => 300 + 3500 * Math.min(1, t / 0.35), 1.4);
    envFn(x, (t) => (t < 0.3 ? t / 0.3 : Math.exp(-(t - 0.3) / 0.15)));
    normalize(x, 0.4);
    for (const [f, a] of [[523.25, 1], [659.25, 0.8], [783.99, 0.8], [1046.5, 0.6]] as const) {
      const n = chirp(len, () => f, (t) => (t < 0.28 ? 0 : Math.min(1, (t - 0.28) / 0.005) * a * Math.exp(-(t - 0.28) / 0.3)));
      mixInto(x, n, 0, 0.35);
    }
    return fadeEdges(normalize(x, 0.32));
  },
  stop: (rng) => {
    const len = Math.round(0.45 * SR);
    const sw = white(len, rng);
    sweep(sw, 'bp', (t) => 2500 * Math.exp(-t / 0.15) + 300, 1);
    envAD(sw, 0.001, 0.12);
    reverse(sw);
    const x = new Float32Array(len + Math.round(0.08 * SR));
    mixInto(x, normalize(sw, 0.6));
    mixInto(x, normalize(impact('poly', 2, rng), 0.7), len - Math.round(0.01 * SR));
    return fadeEdges(normalize(x, 0.3));
  },
  error: () => {
    const len = Math.round(0.3 * SR);
    const x = new Float32Array(len);
    mixInto(x, chirp(Math.round(0.12 * SR), () => 220, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.035)));
    mixInto(x, chirp(Math.round(0.15 * SR), () => 185, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.04)), Math.round(0.11 * SR));
    lp(x, 1200);
    return fadeEdges(normalize(x, 0.28));
  },
  chat: (rng) => {
    const len = Math.round(0.1 * SR);
    const x = chirp(len, glide(950, 420, 0.012), (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.025));
    mixInto(x, normalize(hp(envAD(white(len, rng), 0.0002, 0.003), 3000), 0.1));
    return fadeEdges(normalize(x, 0.22));
  },
  undo: () => {
    const len = Math.round(0.16 * SR);
    const x = chirp(len, (t) => 300 + 900 * Math.exp(-t / 0.05) * (1 + 0.15 * Math.sin(2 * Math.PI * 45 * t)), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.05));
    return fadeEdges(normalize(lp(x, 3000), 0.22));
  },
};

/** Stereo reverb impulse response: early reflections + a darkening exponential tail. */
export function reverbIR(rng: Rng, sec = 1.8, early = 8, damp = 0.35): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const x = alloc(sec);
    const n = white(x.length, rng);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const k = 0.05 + 0.9 * Math.exp(-t / damp); // high frequencies die first
      y += (n[i]! - y) * k;
      x[i] = y * Math.exp(-t / (sec / 6.9)) * Math.min(1, t / 0.008);
    }
    for (let e = 0; e < early; e++) {
      const at = Math.round((0.007 + rng.next() * 0.045) * SR);
      x[at] = x[at]! + (rng.chance(0.5) ? 1 : -1) * Math.max(0.1, 0.5 - e * 0.04);
    }
    out.push(x);
  }
  // equal energy per channel, modest overall gain
  for (const x of out) normalize(x, 0.6);
  return out;
}

// ---------- registry ----------

export type Gen = (rng: Rng, v: number) => Float32Array;
/** [bank name, variation count, generator]: each variation gets its own seed `name#v`. */
export type Recipe = [string, number, Gen];

function recipes(): Recipe[] {
  const r: Recipe[] = [];
  for (const m of MATERIALS) for (let t = 0; t < 3; t++) r.push([`imp/${m}/${TIERS[t]}`, IMPACT_VARIANTS, (rng) => impact(m, t, rng)]);
  r.push(['thump', 3, thump], ['boing', 4, boing], ['cascade', 3, cascade]);
  r.push(['crack', 3, crack]);
  r.push(['body/0', 3, (g) => boomBody(0, g)], ['body/1', 3, (g) => boomBody(1, g)], ['body/2', 2, (g) => boomBody(2, g)]);
  r.push(['sub', 2, sub]);
  for (const d of ['wood', 'brick', 'glass', 'paper'] as const) r.push([`debris/${d}`, 2, (g) => debris(d, g)]);
  r.push(['relay', 3, relay], ['clunk', 2, clunk], ['spinup', 1, (g) => spin(true, g)], ['spindown', 1, (g) => spin(false, g)]);
  r.push(['fuseIgnite', 3, fuseIgnite], ['whoomph', 2, whoomph], ['puff', 2, puff], ['fuseEnd', 2, fuseEnd]);
  r.push(['pop', 3, balloonPop], ['snap', 3, ropeSnap], ['button', 2, buttonPress], ['pad', 2, padPress]);
  r.push(['loop/fuse', 1, loopFuse], ['loop/motor', 1, loopMotor], ['loop/fan', 1, loopFan], ['loop/flame', 1, loopFlame]);
  r.push(['loop/roll/heavy', 1, (g) => loopRoll('heavy', g)], ['loop/roll/rubber', 1, (g) => loopRoll('rubber', g)], ['loop/roll/hard', 1, (g) => loopRoll('hard', g)]);
  for (const [name, fn] of Object.entries(UI)) r.push([`ui/${name}`, 1, (g) => fn(g)]);
  return r;
}

export function toBuffer(chs: Float32Array[]): AudioBuffer {
  const b = new AudioBuffer({ length: chs[0]!.length, numberOfChannels: chs.length, sampleRate: SR });
  chs.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

export interface SfxBank {
  get(name: string): readonly AudioBuffer[] | undefined;
  /** Every cue name in the bank (the test page lists them for audition). */
  keys(): string[];
  reverb: AudioBuffer;
  /** Per-environment reverb IRs (AUDIO §1: one IR per environment); `reverb` is the Studio's. */
  irs: Readonly<Record<string, AudioBuffer>>;
  /** total synthesis time in ms */
  buildMs: number;
  bytes: number;
}


/**
 * Synthesise the whole bank, yielding to the main thread every ~8 ms so frames keep flowing. `extra` adds the
 * M2 recipe sets (mech.ts, critters.ts, ambience.ts) after M1's.
 */
export async function buildSfxBank(extra: readonly Recipe[] = []): Promise<SfxBank> {
  const map = new Map<string, AudioBuffer[]>();
  const t0 = performance.now();
  let slice = performance.now(), work = 0, bytes = 0;
  for (const [name, n, gen] of [...recipes(), ...extra]) {
    const list: AudioBuffer[] = [];
    for (let v = 0; v < n; v++) {
      const a = performance.now();
      const data = gen(new Rng(`${name}#${v}`), v);
      // M5: a recipe that produces a non-finite sample would poison every bus it reaches (NaN through the filters and
      // the compressor): zero it here and say which one
      let bad = 0;
      for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i]!)) { data[i] = 0; bad++; }
      if (bad) console.warn(`[audio] recipe ${name}#${v}: ${bad} non-finite samples zeroed`);
      bytes += data.byteLength;
      list.push(toBuffer([data]));
      work += performance.now() - a;
      if (performance.now() - slice > 8) { await yieldToMain(); slice = performance.now(); }
    }
    map.set(name, list);
  }
  const ir = reverbIR(new Rng('reverb'));
  // Mega Kitchen: a smaller, warmer room with denser early reflections off the giant cabinets
  const irK = reverbIR(new Rng('reverb:kitchen'), 1.3, 14, 0.22);
  // Tinker Lab (environments.md §3.7): a classroom, RT60 0.8 s, wood and plaster: soft, warm early reflections
  const irT = reverbIR(new Rng('reverb:tinker'), 0.8, 10, 0.18);
  // M5 (environments.md §5.6, §6.7): the Hangar, a large metal hall (Bay 2 1.6 s; the Main Hall 2.0 s, the AUDIO §1 cap),
  // and the Moon: no room at all (air 0 % closes the send; this short ground slap is only heard if players add air)
  const irH = reverbIR(new Rng('reverb:hangar'), 1.6, 12, 0.5);
  const irHA = reverbIR(new Rng('reverb:hangar_arena'), 2.0, 10, 0.55);
  const irM = reverbIR(new Rng('reverb:moon'), 0.25, 3, 0.05);
  bytes += (ir[0]!.byteLength + irK[0]!.byteLength + irT[0]!.byteLength + irH[0]!.byteLength + irHA[0]!.byteLength + irM[0]!.byteLength) * 2;
  void work;
  const reverb = toBuffer(ir);
  return { get: (k) => map.get(k), keys: () => [...map.keys()], reverb, irs: { studio: reverb, kitchen: toBuffer(irK), tinker: toBuffer(irT), hangar: toBuffer(irH), hangar_arena: toBuffer(irHA), moon: toBuffer(irM) }, buildMs: performance.now() - t0, bytes };
}
