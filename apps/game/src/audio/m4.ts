// M4 parts (GAME_SPEC §12, AUDIO.md §5, §11; "Audio hooks" rows of docs/art/briefs/{matter,air,power_signal,
// contraptions,rollers,fun}.md): procedural sounds for the 15 M4 parts and the director that drives them.
//
// Like M3, every part is driven three ways and whichever arrives first wins (a state fallback stays quiet when
// the matching event already played the cue within 0.3 s); unknown event kinds are ignored:
//   events  M2/M3 kinds (Signal, Toggle, Press, Powered/Unpowered, Launch, Pop, Impact, Break, Spawn, Splash,
//           Attach/Release, Trigger, Fire) plus likely M4 names (Open/Close, Empty, Refill, Arc/Strike/Zap, Inflate,
//           Overinflate, Lay, Splat, Squeeze, Tip, Stall); stream A4 lists the real ones in M4_NOTES_A4.md
//   state   part(): flags (powered / armed / lit / pressed), the meter byte read as a fill level (Matter
//           containers: fill(part) in keyframes) and its rate of change (a draining hopper pours, a filling sponge
//           slurps), ω of the `arm` body (waterwheel), measured motion (zippy, yolk)
//   context the Matter field (matter.ts) carries landing grains and flowing water; this file only voices the parts
// The full mapping table is in docs/dev/M4_NOTES_F4.md.

import { impact, type Recipe } from './bank';
import { F } from './mech';
import { hash01, hashStr, type Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, glide, grains, hp, keys, lp, mixInto, modal, normalize,
  seamless, sweep, white,
} from './synth';
import { Motion, clamp, fin, finite3, type AudioHost, type LoopKind, type LoopOpts, type M4LoopKind, type SimEventLike, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);
const TAU = Math.PI * 2;

// ============================================================================================
// building blocks
// ============================================================================================

export function click(f: number, tau: number, rng: Rng, w = 0.00015, r2 = 1.63): Float32Array {
  return modal(at(Math.min(0.25, tau * 10)), contact(w, rng), [{ f, amp: 1, tau }, { f: f * r2, amp: 0.45, tau: tau * 0.6 }]);
}

/** Stick-slip creak (hinges, axles, cradles). */
export function creak(sec: number, rate: number, f: number, rng: Rng): Float32Array {
  const x = alloc(sec);
  let t = 0;
  while (t < sec) {
    const i = at(t);
    if (i < x.length) x[i] = (0.6 + 0.4 * rng.next()) * (rng.chance(0.5) ? 1 : -1);
    t += 1 / (rate * (0.7 + 0.6 * rng.next()));
  }
  bp(x, f, 3);
  bp(x, f * 1.9, 1.5);
  envFn(x, (tt) => Math.sin(Math.PI * Math.min(1, tt / sec)));
  return normalize(x, 1);
}

export function tone(len: number, f: (t: number) => number, amp: (t: number) => number, harm: readonly number[] = []): Float32Array {
  const x = chirp(len, f, amp);
  harm.forEach((a, k) => mixInto(x, chirp(len, (t) => f(t) * (k + 2), amp), 0, a));
  return x;
}

export function beep(len: number, f: number, amt = 2): Float32Array {
  const x = chirp(len, () => f, (t) => Math.min(1, t / 0.003) * Math.min(1, (len / SR - t) / 0.006));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(amt * x[i]!);
  return x;
}

/** A 1 s seamless motor: integer-Hz partials (so the loop point is clean) plus filtered noise. */
export function motorLoop(base: number, harm: readonly number[], noiseF: number, noiseAmt: number, rng: Rng, whine = 0, whineAmt = 0): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    let s = 0;
    harm.forEach((a, k) => { s += a * Math.sin(TAU * base * (k + 1) * t); });
    if (whine) s += whineAmt * Math.sin(TAU * whine * t) * (0.8 + 0.2 * Math.sin(TAU * 3 * t));
    x[i] = s;
  }
  normalize(x, 1);
  if (noiseAmt > 0) mixInto(x, normalize(seamless(1, 0.1, (n) => bp(white(n, rng), noiseF, 0.7)), noiseAmt));
  return x;
}

/** A droplet plip (Minnaert bubble, small splash). */
function drop(rng: Rng, lo = 900, hi = 2200): Float32Array {
  const x = alloc(0.12);
  mixInto(x, bubble(0.1, lo + (hi - lo) * rng.next(), 0.4 + 0.4 * rng.next(), 0.018));
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0002, 0.002), 3000), 0.25));
  return fadeEdges(normalize(x, 0.4), 0.0002, 0.01);
}

/** Water noise: low-passed, bubbling AM. */
function waterNoise(len: number, f: number, rng: Rng, am = 2): Float32Array {
  const n = lp(white(len, rng), f);
  bp(n, f * 0.6, 0.5);
  let a = 0;
  for (let i = 0; i < len; i++) { a = a * 0.998 + rng.bi() * 0.04; n[i] = n[i]! * Math.max(0, 1 + am * a); }
  return normalize(n, 1);
}

/** Rubber squeak: a reedy pulse through a nasal formant, pitch contour f0(t). */
function rubberSqueak(sec: number, f0: (t: number) => number, rng: Rng, nasal = 1800): Float32Array {
  const len = at(sec);
  const x = new Float32Array(len);
  let p = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    p += f0(t) * (1 + rng.bi() * 0.004) / SR;
    if (p >= 1) p -= 1;
    x[i] = p < 0.3 ? 1 : -0.43;
  }
  lp(x, 5000);
  const y = bp(x.slice(), nasal, 2.5);
  mixInto(y, bp(x, nasal * 2.1, 3), 0, 0.5);
  envFn(y, (t) => Math.min(1, t / 0.008) * Math.min(1, (sec - t) / 0.03));
  for (let i = 0; i < len; i++) y[i] = Math.tanh(2 * y[i]!);
  return y;
}

/** Granular sand stream (pour column + landing patter) or fine trickle. */
function sandGrains(x: Float32Array, rng: Rng, rate: (t: number) => number, fLo = 2500, fHi = 8000): void {
  grains(x, rng, rate, (r) => {
    const g = envAD(white(at(0.004), r), 0.00005, 0.0004 + 0.0008 * r.next());
    bp(g, fLo * Math.pow(fHi / fLo, r.next()), 1.2);
    return normalize(g, 0.2 + 0.5 * r.next() * r.next());
  });
}

function marbleClicks(x: Float32Array, rng: Rng, rate: (t: number) => number, gain = 1): void {
  grains(x, rng, rate, (r) => {
    const f = 2200 * Math.pow(2.4, r.next());
    return normalize(modal(at(0.06), contact(0.00008, r), [{ f, amp: 1, tau: 0.015 + 0.02 * r.next() }, { f: f * 2.32, amp: 0.5, tau: 0.008 }]), gain * (0.25 + 0.75 * r.next() * r.next()));
  });
}

// ============================================================================================
// sounds
// ============================================================================================

// ---- GRIT HOPPER ----

function gate(open: boolean, rng: Rng): Float32Array {
  const x = alloc(0.25);
  const scrape = envFn(bp(white(at(0.12), rng), open ? 1800 : 2400, 1.5), (t) => Math.sin(Math.PI * t / 0.12));
  mixInto(x, normalize(scrape, 0.5));
  mixInto(x, click(open ? 1500 : 1100, open ? 0.02 : 0.03, rng, 0.0003), at(open ? 0.12 : 0.11), open ? 0.6 : 1);
  return fadeEdges(normalize(x, 0.4));
}

function pourSandLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    sandGrains(x, rng, () => 1100);
    normalize(x, 0.8);
    const hiss = hp(white(len, rng), 2200);
    bp(hiss, 4500, 0.6);
    let a = 0;
    for (let i = 0; i < len; i++) { a = a * 0.9995 + rng.bi() * 0.012; hiss[i] = hiss[i]! * (1 + 1.5 * a); }
    mixInto(x, normalize(hiss, 0.6));
    mixInto(x, normalize(lp(waterNoise(len, 900, rng, 1), 700), 0.25)); // the pile landing
    return x;
  }), 0.33);
}

function intakePatter(rng: Rng): Float32Array {
  const x = alloc(0.7);
  sandGrains(x, rng, (t) => 500 * Math.exp(-t / 0.2), 1800, 6000);
  mixInto(x, normalize(envAD(hp(white(x.length, rng), 3000), 0.01, 0.15), 0.25));
  return fadeEdges(normalize(x, 0.35), 0.002, 0.05);
}

function lastTrickle(rng: Rng): Float32Array {
  const x = alloc(1.4);
  sandGrains(x, rng, (t) => 600 * Math.exp(-t / 0.25) + 4);
  mixInto(x, normalize(envAD(hp(white(x.length, rng), 2500), 0.002, 0.3), 0.3));
  return fadeEdges(normalize(x, 0.35), 0.002, 0.1);
}

function lowBeep(): Float32Array {
  const x = alloc(0.32);
  mixInto(x, beep(at(0.07), 1480, 1.6));
  mixInto(x, beep(at(0.07), 1480, 1.6), at(0.16));
  return fadeEdges(normalize(lp(x, 5000), 0.2));
}

// ---- HOURGLASS ----

function hourglassLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    sandGrains(x, rng, () => 350, 4000, 10000);
    normalize(x, 0.6);
    mixInto(x, normalize(hp(white(len, rng), 6000), 0.15));
    mixInto(x, normalize(bp(white(len, rng), 2600, 12), 0.08)); // the bulb's faint ring
    return x;
  }), 0.2);
}

function glassTink(rng: Rng, f: number, tau: number): Float32Array {
  return fadeEdges(normalize(modal(at(Math.min(1.2, tau * 6)), contact(0.00006, rng), [
    { f: f * (1 + rng.bi() * 0.02), amp: 1, tau }, { f: f * 2.32, amp: 0.4, tau: tau * 0.5 }, { f: f * 4.25, amp: 0.2, tau: tau * 0.25 },
  ]), 0.3), 0.0001, 0.05);
}

function hourglassFlip(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, impact('poly', 1, rng), 0, 0.7);
  mixInto(x, normalize(envFn(hp(white(at(0.45), rng), 3000), (t) => Math.sin(Math.PI * t / 0.45) * 0.5), 0.3), at(0.03)); // sand shifting
  mixInto(x, impact('wood', 0, rng), at(0.09), 0.4);
  return fadeEdges(normalize(x, 0.45));
}

// ---- TANK ----

function valveSqueak(rng: Rng): Float32Array {
  const sec = 0.3 + 0.15 * rng.next();
  const f0 = 850 + 400 * rng.next();
  const x = chirp(at(sec), (t) => f0 * (1 + 0.25 * Math.sin(Math.PI * t / sec)) * (1 + 0.03 * Math.sin(TAU * 47 * t)), (t) => Math.sin(Math.PI * t / sec) * (0.6 + 0.4 * Math.abs(Math.sin(TAU * 23 * t))));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(3 * x[i]!) * (0.9 + 0.1 * rng.bi());
  bp(x, f0 * 1.5, 1.2);
  mixInto(x, click(900, 0.02, rng, 0.0004), 0, 0.3);
  return fadeEdges(normalize(x, 0.32));
}

function pourWaterLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = waterNoise(len, 1800, rng, 1.5);
    normalize(x, 0.7);
    grains(x, rng, () => 110, (r) => normalize(bubble(0.06, 300 + 1300 * r.next(), 0.3 + 0.5 * r.next(), 0.012), 0.15 + 0.35 * r.next()));
    mixInto(x, normalize(bp(white(len, rng), 900, 0.7), 0.25)); // the stream hitting the pool
    return x;
  }), 0.35);
}

function glug(rng: Rng): Float32Array {
  const x = alloc(0.4);
  mixInto(x, bubble(0.32, 160 + 120 * rng.next(), 0.7, 0.06));
  mixInto(x, normalize(lp(envAD(white(at(0.15), rng), 0.01, 0.04), 600), 0.3));
  mixInto(x, bubble(0.12, 600 + 500 * rng.next(), 0.5, 0.02), at(0.07 + 0.05 * rng.next()), 0.3);
  return fadeEdges(normalize(x, 0.4));
}

function fillLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    grains(x, rng, () => 70, (r) => normalize(bubble(0.05, 700 + 2000 * r.next(), 0.5, 0.01), 0.2 + 0.5 * r.next()));
    normalize(x, 0.6);
    mixInto(x, normalize(hp(waterNoise(len, 3500, rng, 1), 1500), 0.25));
    return x;
  }), 0.25);
}

function gurgle(rng: Rng): Float32Array {
  const x = alloc(1.5);
  for (let k = 0; k < 6; k++) mixInto(x, glug(rng), at(k * 0.2 + 0.04 * rng.next()), 1 - k * 0.13);
  mixInto(x, normalize(envAD(bp(white(x.length, rng), 1200, 0.8), 0.6, 0.3, 0.5), 0.3)); // air sucked in at the end
  return fadeEdges(normalize(x, 0.4), 0.002, 0.1);
}

// ---- SPRINKLE CAN ----

function latch(rng: Rng): Float32Array {
  const x = alloc(0.2);
  mixInto(x, click(1400, 0.02, rng, 0.0003));
  mixInto(x, impact('poly', 0, rng), at(0.012), 0.5);
  return fadeEdges(normalize(x, 0.35));
}

function sprinkleLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    grains(x, rng, () => 380, (r) => normalize(bubble(0.03, 1500 + 3000 * r.next(), 0.5, 0.006), 0.2 + 0.6 * r.next() * r.next()));
    normalize(x, 0.7);
    mixInto(x, normalize(hp(waterNoise(len, 6000, rng, 0.8), 2500), 0.35));
    return x;
  }), 0.3);
}

function slosh(rng: Rng): Float32Array {
  const sec = 0.5;
  const x = sweep(waterNoise(at(sec), 2000, rng, 2), 'bp', (t) => 300 + 1000 * Math.sin(Math.PI * Math.min(1, t / sec)), 0.9);
  envFn(x, (t) => Math.sin(Math.PI * Math.min(1, t / sec)));
  grains(x, rng, (t) => (t < 0.35 ? 30 : 0), (r) => normalize(bubble(0.06, 400 + 900 * r.next(), 0.5, 0.015), 0.4));
  return fadeEdges(normalize(x, 0.35));
}

// ---- WATERWHEEL ----

function waterwheelLoop(rng: Rng): Float32Array {
  // one second at rate 1: a low axle rumble, two creaks and a wet bucket knock
  const x = alloc(1);
  mixInto(x, normalize(lp(brown(x.length, rng), 220), 0.4));
  mixInto(x, normalize(creak(0.3, 70, 520, rng), 0.5), at(0.1));
  mixInto(x, normalize(creak(0.25, 90, 640, rng), 0.35), at(0.6));
  mixInto(x, normalize(impact('wood', 0, rng), 0.3), at(0.45));
  return normalize(seamless(1, 0.05, (n) => { const y = new Float32Array(n); mixInto(y, x); mixInto(y, x, x.length); return y; }), 0.32);
}

function spill(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, normalize(envAD(waterNoise(at(0.4), 2600, rng, 1.5), 0.004, 0.09), 0.7));
  grains(x, rng, (t) => 160 * Math.exp(-t / 0.12), (r) => normalize(bubble(0.05, 500 + 1800 * r.next(), 0.5, 0.012), 0.2 + 0.4 * r.next()));
  return fadeEdges(normalize(x, 0.4), 0.001, 0.05);
}

function dripLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.1, (len) => {
    const x = new Float32Array(len);
    grains(x, rng, () => 7, (r) => drop(r, 700, 2600));
    return x;
  }), 0.3);
}

function stallGroan(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, normalize(creak(0.8, 26, 170, rng), 0.7));
  mixInto(x, tone(at(0.8), glide(95, 55, 0.3), (t) => 0.3 * Math.sin(Math.PI * Math.min(1, t / 0.8)), [0.4, 0.2]));
  return fadeEdges(normalize(x, 0.35), 0.005, 0.06);
}

// ---- SPONGE ----

function slurpLoop(rng: Rng): Float32Array {
  return normalize(seamless(1.5, 0.15, (len) => {
    const x = waterNoise(len, 1200, rng, 3);
    normalize(x, 0.6);
    grains(x, rng, () => 140, (r) => normalize(bubble(0.03, 1000 + 2500 * r.next(), 0.8, 0.006), 0.15 + 0.4 * r.next()));
    return x;
  }), 0.3);
}

function squish(rng: Rng): Float32Array {
  const sec = 0.3;
  const x = sweep(white(at(sec), rng), 'bp', (t) => 900 - 600 * t / sec, 1.5);
  envFn(x, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.1));
  grains(x, rng, (t) => (t < 0.2 ? 60 : 0), (r) => normalize(bubble(0.04, 800 + 1500 * r.next(), 0.6, 0.008), 0.3));
  return fadeEdges(normalize(x, 0.35));
}

function wetThud(rng: Rng): Float32Array {
  const x = alloc(0.45);
  mixInto(x, chirp(at(0.25), glide(140, 80, 0.03), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.05)), 0, 0.8);
  mixInto(x, squish(rng), at(0.01), 0.7);
  grains(x, rng, (t) => (t < 0.15 ? 90 : 0), (r) => drop(r, 1200, 3500));
  return fadeEdges(normalize(x, 0.42));
}

function dryBounce(rng: Rng): Float32Array {
  const x = impact('rubber', 0, rng);
  lp(x, 1800);
  mixInto(x, normalize(lp(envAD(white(at(0.05), rng), 0.002, 0.012), 2500), 0.3));
  return fadeEdges(normalize(x, 0.35));
}

// ---- MARBLE HOPPER ----

function feedLoop(rng: Rng): Float32Array {
  // the rotary feeder: 6 clacks per second at rate 1, each a plastic tick plus a released marble
  const x = alloc(1);
  for (let k = 0; k < 6; k++) {
    mixInto(x, click(1700, 0.012, rng, 0.0003), at(k / 6), 0.5);
    mixInto(x, modal(at(0.06), contact(0.00008, rng), [{ f: 2800 + 1500 * rng.next(), amp: 1, tau: 0.02 }, { f: 6500, amp: 0.4, tau: 0.008 }]), at(k / 6 + 0.02), 0.7);
  }
  return normalize(x, 0.3);
}

function pourMarbleLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.15, (len) => {
    const x = new Float32Array(len);
    marbleClicks(x, rng, () => 320);
    normalize(x, 0.8);
    mixInto(x, normalize(lp(brown(len, rng), 400), 0.3)); // the chute's hollow rumble
    return x;
  }), 0.33);
}

function chuteClatter(rng: Rng): Float32Array {
  const x = alloc(0.7);
  marbleClicks(x, rng, (t) => 120 * Math.exp(-t / 0.18));
  mixInto(x, impact('poly', 1, rng), 0, 0.3);
  return fadeEdges(normalize(x, 0.4), 0.001, 0.05);
}

function refillPatter(rng: Rng): Float32Array {
  const x = alloc(0.9);
  marbleClicks(x, rng, (t) => 80 * Math.sin(Math.PI * Math.min(1, t / 0.9)), 0.8);
  return fadeEdges(normalize(x, 0.35), 0.002, 0.05);
}

function emptyClunk(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, impact('poly', 1, rng), 0, 0.8);
  mixInto(x, modal(at(0.5), contact(0.002, rng), [{ f: 210, amp: 1, tau: 0.08 }, { f: 470, amp: 0.4, tau: 0.05 }]), 0, 0.5); // the hollow globe
  for (let k = 0; k < 4; k++) mixInto(x, modal(at(0.05), contact(0.00008, rng), [{ f: 3200 + 600 * rng.next(), amp: 1, tau: 0.015 }]), at(0.25 + k * (0.08 + 0.03 * k)), 0.4 - k * 0.07);
  return fadeEdges(normalize(x, 0.4));
}

// ---- BLOWOUT ----

function dryerLoop(rng: Rng): Float32Array {
  return normalize(motorLoop(110, [0.5, 1, 0.4, 0.25, 0.15, 0.1], 3000, 0.25, rng, 3300, 0.12), 0.3);
}

function airRushLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = bp(white(len, rng), 1100, 0.4);
    mixInto(x, hp(white(len, rng), 3500), 0, 0.3);
    let a = 0;
    for (let i = 0; i < len; i++) { a = a * 0.9997 + rng.bi() * 0.006; x[i] = x[i]! * (1 + 1.2 * a); }
    return x;
  }), 0.33);
}

function rocker(rng: Rng): Float32Array {
  const x = alloc(0.12);
  mixInto(x, click(2200, 0.008, rng, 0.0002));
  mixInto(x, click(1300, 0.015, rng, 0.0003), at(0.01), 0.6);
  return fadeEdges(normalize(x, 0.3));
}

function coolTick(rng: Rng): Float32Array {
  return fadeEdges(normalize(click(3200 + 2000 * rng.next(), 0.006, rng, 0.0001, 2.4), 0.18));
}

// ---- VAC ----

function suctionLoop(rng: Rng): Float32Array {
  const m = motorLoop(150, [0.4, 1, 0.5, 0.3, 0.2], 1400, 0.7, rng, 2200, 0.1);
  return normalize(m, 0.33);
}

function thwup(rng: Rng): Float32Array {
  const sec = 0.18;
  const x = sweep(white(at(sec), rng), 'lp', (t) => 300 + 4000 * Math.pow(t / sec, 2), 2);
  envFn(x, (t) => Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.08) / 0.02));
  mixInto(x, chirp(at(0.12), glide(160, 90, 0.03), (t) => Math.exp(-t / 0.03)), at(0.09), 0.5);
  return fadeEdges(normalize(x, 0.4));
}

function releasePop(rng: Rng): Float32Array {
  const x = alloc(0.35);
  mixInto(x, chirp(at(0.05), glide(900, 400, 0.01), (t) => Math.exp(-t / 0.008)), 0, 0.8);
  mixInto(x, normalize(envAD(bp(white(at(0.3), rng), 1500, 0.6), 0.003, 0.08), 0.4));
  return fadeEdges(normalize(x, 0.4));
}

// ---- INFLATOR ----

function inflatorValve(rng: Rng): Float32Array {
  const x = alloc(0.4);
  mixInto(x, valveSqueak(rng), 0, 0.5);
  mixInto(x, normalize(envAD(hp(white(at(0.35), rng), 3000), 0.08, 0.2), 0.4), at(0.05));
  return fadeEdges(normalize(x, 0.35));
}

function gasHissLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = hp(white(len, rng), 3000);
    mixInto(x, normalize(bp(white(len, rng), 5200, 14), 0.5)); // the nozzle's whistle
    return x;
  }), 0.3);
}

function gaugeTick(rng: Rng): Float32Array { return fadeEdges(normalize(click(4200, 0.004, rng, 0.0001, 2.1), 0.15)); }

function overBeep(): Float32Array {
  const x = alloc(0.75);
  for (let k = 0; k < 3; k++) { mixInto(x, beep(at(0.08), 2200, 2), at(k * 0.24)); mixInto(x, beep(at(0.08), 1650, 2), at(k * 0.24 + 0.1)); }
  return fadeEdges(normalize(lp(x, 6000), 0.25));
}

// ---- ARC TOWER ----

function teslaLoop(rng: Rng): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h <= 15; h += 2) s += Math.sin(TAU * 120 * h * t) / h;
    x[i] = Math.tanh(1.8 * s) + 0.3 * Math.sin(TAU * 60 * t);
  }
  normalize(x, 1);
  mixInto(x, normalize(seamless(1, 0.1, (n) => hp(white(n, rng), 6000)), 0.12));
  return normalize(x, 0.3);
}

export function snaps(x: Float32Array, rng: Rng, rate: (t: number) => number, gain = 1): void {
  grains(x, rng, rate, (r) => normalize(hp(envAD(white(at(0.003), r), 0.00002, 0.0003 + 0.0006 * r.next()), 1500 + 3000 * r.next()), gain * (0.15 + 0.85 * Math.pow(r.next(), 3))));
}

function coronaLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = hp(white(len, rng), 5000);
    normalize(x, 0.25);
    snaps(x, rng, () => 45, 0.9);
    return x;
  }), 0.25);
}

function arcCrackle(rng: Rng): Float32Array {
  const sec = 0.25 + 0.35 * rng.next();
  const x = alloc(sec + 0.1);
  mixInto(x, normalize(hp(envAD(white(at(0.012), rng), 0.0001, 0.003), 800), 1)); // the strike snap
  snaps(x, rng, (t) => (t < sec ? (300 + 500 * rng.next()) * Math.exp(-t / (sec * 0.6)) : 0), 0.8);
  mixInto(x, tone(x.length, () => 120, (t) => 0.2 * Math.exp(-t / (sec * 0.5)), [0, 0.5, 0, 0.3]));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.04);
}

function arcZap(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(hp(envAD(white(at(0.02), rng), 0.0001, 0.004), 1200), 1));
  mixInto(x, modal(at(0.45), contact(0.0001, rng), [{ f: 2400 * (1 + rng.bi() * 0.05), amp: 1, tau: 0.12 }, { f: 6600, amp: 0.4, tau: 0.05 }]), at(0.002), 0.4);
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.05);
}

function powerDown(rng: Rng): Float32Array {
  const sec = 1.1;
  const x = tone(at(sec), glide(900, 110, 0.35), (t) => 0.5 * Math.exp(-t / 0.5) * Math.min(1, t / 0.01), [0.4, 0.2]);
  snaps(x, rng, (t) => 40 * Math.exp(-t / 0.3), 0.5);
  return fadeEdges(normalize(x, 0.32), 0.002, 0.1);
}

// ---- TOAST CANNON ----

function toastLever(rng: Rng): Float32Array {
  const x = alloc(0.35);
  mixInto(x, chirp(at(0.12), (t) => 300 + 900 * t / 0.12, (t) => 0.2 * Math.sin(Math.PI * t / 0.12)));
  mixInto(x, click(2100, 0.03, rng, 0.0002, 2.7), at(0.12), 0.8); // the latch
  mixInto(x, impact('steel', 0, rng), at(0.13), 0.35);
  return fadeEdges(normalize(x, 0.4));
}

function toastLoop(rng: Rng): Float32Array {
  // a clockwork timer at 4 Hz, the element's hum and the bread starting to crackle
  const x = alloc(1);
  for (let k = 0; k < 4; k++) mixInto(x, click(2600 + (k % 2) * 300, 0.006, rng, 0.0001), at(k / 4), 0.6);
  mixInto(x, motorLoop(50, [0.3, 1, 0.5, 0.2], 6000, 0, rng), 0, 0.12);
  snaps(x, rng, () => 6, 0.25);
  return normalize(x, 0.28);
}

function toastPop(rng: Rng): Float32Array {
  const x = alloc(1.2);
  mixInto(x, chirp(at(0.3), (t) => 180 + 60 * Math.sin(TAU * 18 * t) * Math.exp(-t / 0.08), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.08)), 0, 0.7); // spring twang
  mixInto(x, impact('steel', 1, rng), 0, 0.5);
  mixInto(x, modal(at(1.1), contact(0.0001, rng), [{ f: 2637, amp: 1, tau: 0.5 }, { f: 2637 * 2.76, amp: 0.3, tau: 0.2 }, { f: 2637 * 5.4, amp: 0.1, tau: 0.08 }]), at(0.06), 0.5); // the ding (E7)
  return fadeEdges(normalize(x, 0.45));
}

function flutter(rng: Rng): Float32Array {
  const sec = 0.5;
  const x = bp(white(at(sec), rng), 1300, 0.8);
  envFn(x, (t) => Math.sin(Math.PI * t / sec) * (0.5 + 0.5 * Math.sin(TAU * 17 * t)));
  return fadeEdges(normalize(x, 0.25));
}

function toastLand(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, normalize(lp(envAD(white(at(0.06), rng), 0.001, 0.015), 1500), 0.8));
  mixInto(x, chirp(at(0.12), glide(220, 130, 0.02), (t) => Math.exp(-t / 0.025)), 0, 0.4);
  snaps(x, rng, (t) => (t < 0.04 ? 200 : 0), 0.3); // a toasty crunch
  return fadeEdges(normalize(x, 0.35));
}

// ---- YOLK ----

function yolkRollLoop(rng: Rng): Float32Array {
  // a lopsided egg: irregular shell ticks as it wobbles (≈ 6 per second at rate 1)
  const x = alloc(1);
  let t = 0;
  while (t < 0.98) { mixInto(x, click(2300 + 700 * rng.next(), 0.004, rng, 0.0001), at(t), 0.4 + 0.6 * rng.next()); t += 0.1 + 0.12 * rng.next(); }
  mixInto(x, normalize(lp(brown(x.length, rng), 300), 0.15));
  return normalize(x, 0.25);
}

function yolkTap(rng: Rng): Float32Array { return fadeEdges(normalize(click(2600 * (1 + rng.bi() * 0.06), 0.005, rng, 0.0001, 2.1), 0.3)); }

function yolkSplat(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(hp(envAD(white(at(0.03), rng), 0.0002, 0.004), 2500), 0.8)); // the shell crack
  for (let k = 0; k < 3; k++) mixInto(x, click(3000 + 2000 * rng.next(), 0.003, rng, 0.0001), at(0.002 + 0.006 * k), 0.5);
  mixInto(x, normalize(lp(envAD(white(at(0.2), rng), 0.004, 0.04), 1600), 0.8), at(0.012)); // the wet slap
  grains(x, rng, (t) => (t > 0.02 && t < 0.25 ? 40 : 0), (r) => normalize(bubble(0.05, 500 + 900 * r.next(), 0.7, 0.012), 0.25)); // squelch
  return fadeEdges(normalize(x, 0.45));
}

function yolkLaid(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, chirp(at(0.2), glide(170, 110, 0.03), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.04)), 0, 0.8);
  mixInto(x, normalize(lp(envAD(white(at(0.06), rng), 0.003, 0.02), 1200), 0.4));
  return fadeEdges(normalize(x, 0.35));
}

// ---- ZIPPY ----

function zippyLoop(rng: Rng): Float32Array {
  return normalize(motorLoop(300, [1, 0.6, 0.45, 0.3, 0.2, 0.12], 2500, 0.15, rng, 1800, 0.25), 0.3);
}

function zippyBeep(): Float32Array {
  const x = alloc(0.3);
  mixInto(x, beep(at(0.06), 1900, 1.5));
  mixInto(x, beep(at(0.06), 1900, 1.5), at(0.11));
  return fadeEdges(normalize(lp(x, 7000), 0.28));
}

function tyreScrub(rng: Rng): Float32Array {
  const sec = 0.3;
  const x = bp(white(at(sec), rng), 900, 1.2);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * (0.6 + 0.4 * Math.sign(Math.sin(TAU * 140 * i / SR + rng.bi() * 0.3)));
  envFn(x, (t) => Math.sin(Math.PI * t / sec));
  return fadeEdges(normalize(x, 0.3));
}

function zippyBump(rng: Rng): Float32Array {
  const x = impact('poly', 1, rng);
  mixInto(x, impact('rubber', 0, rng), 0, 0.5);
  return fadeEdges(normalize(x, 0.38));
}

function flipClatter(rng: Rng): Float32Array {
  const x = alloc(1.1);
  for (let k = 0; k < 4; k++) mixInto(x, impact('poly', k === 0 ? 2 : 0, rng), at(k * (0.09 + 0.04 * rng.next())), 1 - k * 0.2);
  mixInto(x, tone(at(0.9), glide(900, 250, 0.3), (t) => 0.2 * Math.exp(-t / 0.35), [0.4]), at(0.15)); // wheels spinning down
  return fadeEdges(normalize(x, 0.42), 0.001, 0.06);
}

function servoChirp(rng: Rng): Float32Array {
  const sec = 0.1 + 0.05 * rng.next();
  const up = rng.chance(0.5);
  const x = tone(at(sec), (t) => (up ? 1200 + 500 * t / sec : 1700 - 500 * t / sec), (t) => Math.sin(Math.PI * t / sec), [0.5, 0.3]);
  return fadeEdges(normalize(x, 0.18));
}

function towStrain(rng: Rng): Float32Array {
  const sec = 0.7;
  const x = tone(at(sec), (t) => 520 - 120 * Math.sin(Math.PI * t / sec), (t) => Math.sin(Math.PI * t / sec), [0.6, 0.4, 0.2]);
  mixInto(x, normalize(creak(sec, 40, 900, rng), 0.5));
  return fadeEdges(normalize(x, 0.3));
}

// ---- QUACK ----

function quackSqueak(tier: number, rng: Rng): Float32Array {
  // short squeezes pitch up (brief: "pitch up on short squeezes"); a hard squeeze is a long, falling honk
  const sec = [0.09, 0.16, 0.28][tier]! * (0.85 + 0.3 * rng.next());
  const f = [1150, 900, 760][tier]! * (1 + rng.bi() * 0.06);
  const f0 = keys([[0, f * 0.9], [sec * 0.3, f * 1.12], [sec, f * (tier === 2 ? 0.78 : 0.98)]]);
  const x = rubberSqueak(sec, f0, rng, 1700 + 300 * rng.next());
  return fadeEdges(normalize(x, [0.28, 0.36, 0.45][tier]!));
}

function quackSplash(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(envAD(waterNoise(at(0.3), 2400, rng, 1), 0.003, 0.06), 0.6));
  grains(x, rng, (t) => 90 * Math.exp(-t / 0.1), (r) => normalize(bubble(0.05, 600 + 1600 * r.next(), 0.5, 0.012), 0.3));
  return fadeEdges(normalize(x, 0.38));
}

export function m4Recipes(): Recipe[] {
  const r: Recipe[] = [
    // GRIT HOPPER
    ['grit/gate_open', 2, (g) => gate(true, g)], ['grit/gate_close', 2, (g) => gate(false, g)], ['loop/pour/sand', 1, pourSandLoop],
    ['grit/intake', 2, intakePatter], ['grit/last_trickle', 2, lastTrickle], ['m4/low_beep', 1, () => lowBeep()],
    // HOURGLASS
    ['loop/hourglass', 1, hourglassLoop], ['hourglass/done', 1, (g) => glassTink(g, 3150, 0.5)], ['hourglass/flip', 2, hourglassFlip], ['hourglass/clink', 3, (g) => glassTink(g, 2700 + 600 * g.next(), 0.08)],
    // TANK
    ['tank/valve', 3, valveSqueak], ['loop/pour/water', 1, pourWaterLoop], ['tank/glug', 4, glug], ['loop/fill', 1, fillLoop], ['tank/gurgle', 2, gurgle],
    // SPRINKLE CAN
    ['can/tip_creak', 2, (g) => fadeEdges(normalize(creak(0.5, 60, 700 + 200 * g.next(), g), 0.3))], ['can/latch', 2, latch], ['loop/sprinkle', 1, sprinkleLoop],
    ['can/slosh', 3, slosh], ['m4/drip', 6, (g) => drop(g)],
    // WATERWHEEL
    ['loop/waterwheel', 1, waterwheelLoop], ['wheel/slosh', 3, slosh], ['wheel/spill', 4, spill], ['loop/dripwet', 1, dripLoop], ['wheel/groan', 2, stallGroan],
    // SPONGE
    ['loop/slurp', 1, slurpLoop], ['sponge/squish', 4, squish], ['sponge/wet_thud', 3, wetThud], ['sponge/dry_bounce', 3, dryBounce],
    // MARBLE HOPPER
    ['loop/feed', 1, feedLoop], ['loop/pour/marble', 1, pourMarbleLoop], ['mhop/chute', 2, chuteClatter], ['mhop/refill', 2, refillPatter], ['mhop/empty', 2, emptyClunk],
    ['mhop/tick', 1, (g) => fadeEdges(normalize(click(2900, 0.005, g, 0.0001, 1.9), 0.18))],
    // BLOWOUT
    ['loop/dryer', 1, dryerLoop], ['loop/airrush', 1, airRushLoop], ['dryer/click', 2, rocker], ['dryer/cool_tick', 3, coolTick],
    // VAC
    ['loop/suction', 1, suctionLoop], ['vac/thwup', 3, thwup], ['vac/pop', 2, releasePop],
    // INFLATOR
    ['inflator/valve', 2, inflatorValve], ['loop/gashiss', 1, gasHissLoop], ['inflator/tick', 2, gaugeTick], ['inflator/beep', 1, () => overBeep()],
    // ARC TOWER
    ['loop/tesla', 1, teslaLoop], ['loop/corona', 1, coronaLoop], ['arc/crackle', 12, arcCrackle], ['arc/zap', 3, arcZap], ['arc/down', 1, powerDown],
    // TOAST CANNON
    ['toast/lever', 2, toastLever], ['loop/toast', 1, toastLoop], ['toast/pop', 3, toastPop], ['toast/flutter', 2, flutter], ['toast/land', 4, toastLand],
    // YOLK
    ['loop/roll/yolk', 1, yolkRollLoop], ['yolk/tap', 4, yolkTap], ['yolk/splat', 4, yolkSplat], ['yolk/laid', 2, yolkLaid],
    // ZIPPY
    ['loop/zippy', 1, zippyLoop], ['zippy/beep', 1, () => zippyBeep()], ['zippy/scrub', 2, tyreScrub], ['zippy/bump', 3, zippyBump], ['zippy/flip', 2, flipClatter],
    ['zippy/servo', 3, servoChirp], ['zippy/strain', 2, towStrain],
    // QUACK
    ['quack/splash', 2, quackSplash], ['quack/bounce', 3, (g) => fadeEdges(normalize(impact('rubber', 1, g), 0.38))],
  ];
  const TIER = ['soft', 'med', 'hard'] as const;
  for (let t = 0; t < 3; t++) r.push([`quack/squeak/${TIER[t]}`, 4, (g) => quackSqueak(t, g)]);
  return r;
}

// ============================================================================================
// loop parameters (index.ts loopParams delegates the M4 kinds here): level = intensity, aux = variant tweak
// ============================================================================================

type LP = { gain: number; rate: number; cutoff: number };
export const M4_LOOPS: Readonly<Record<M4LoopKind, (x: number, aux: number) => LP>> = {
  pour: (x, aux) => ({ gain: 0.55 * Math.min(x, 1.3), rate: (0.85 + 0.25 * Math.min(x, 1.2)) * aux, cutoff: 3000 + 9000 * Math.min(x, 1) }),
  hourglass: (x) => ({ gain: 0.12 * Math.min(x, 1), rate: 1, cutoff: 14000 }),
  fill: (x) => ({ gain: 0.35 * Math.min(x, 1.2), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 9000 }),
  sprinkle: (x) => ({ gain: 0.45 * Math.min(x, 1.2), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 4000 + 8000 * Math.min(x, 1) }),
  waterwheel: (x) => ({ gain: 0.45 * Math.min(1, x * 1.4), rate: clamp(0.35 + 0.65 * x, 0.3, 2.2), cutoff: 2500 + 5000 * Math.min(x, 1) }),
  dripwet: (x) => ({ gain: 0.3 * Math.min(x, 1), rate: 1, cutoff: 9000 }),
  slurp: (x) => ({ gain: 0.4 * Math.min(x, 1.2), rate: 0.85 + 0.3 * Math.min(x, 1), cutoff: 2500 + 5000 * Math.min(x, 1) }),
  feed: (x) => ({ gain: 0.35 * Math.min(x, 1.2), rate: clamp(0.5 + 0.6 * x, 0.4, 1.8), cutoff: 10000 }),
  dryer: (x, aux) => ({ gain: 0.4 * Math.min(x, 1.2), rate: (0.6 + 0.4 * Math.min(x, 1)) * aux, cutoff: 2500 + 8000 * Math.min(x, 1) }),
  airrush: (x) => ({ gain: 0.45 * Math.min(x, 1.3), rate: 0.8 + 0.25 * Math.min(x, 1), cutoff: 1500 + 6000 * Math.min(x, 1) }),
  suction: (x, aux) => ({ gain: 0.45 * Math.min(x, 1.2) * (aux > 1 ? 1.15 : 1), rate: (0.65 + 0.35 * Math.min(x, 1)) * aux, cutoff: 2500 + 6000 * Math.min(x, 1) }),
  gashiss: (x, aux) => ({ gain: 0.3 * Math.min(x, 1.2), rate: 0.85 + 0.45 * Math.min(aux, 1.2), cutoff: 9000 + 5000 * Math.min(aux, 1) }),
  tesla: (x) => ({ gain: 0.35 * (0.25 + 0.75 * Math.min(x, 1)), rate: 0.8 + 0.3 * Math.min(x, 1), cutoff: 1500 + 9000 * Math.min(x, 1) }),
  corona: (x) => ({ gain: 0.3 * Math.min(x, 1), rate: 1, cutoff: 16000 }),
  toast: (x) => ({ gain: 0.3 * Math.min(x, 1), rate: 1, cutoff: 10000 }),
  yolkroll: (x) => ({ gain: 0.45 * Math.pow(Math.min(1, x * 1.5), 1.1), rate: clamp(0.5 + 0.8 * x, 0.4, 2), cutoff: 3000 + 7000 * Math.min(x, 1) }),
  zippy: (x) => ({ gain: 0.35 * (0.35 + 0.65 * Math.min(x, 1.2)), rate: clamp(0.55 + 0.75 * x, 0.5, 2), cutoff: 2500 + 9000 * Math.min(x, 1) }),
  // critters: level = intensity, aux = rate (patter style)
  pant: (_x, aux) => ({ gain: 0.32, rate: clamp(aux, 0.6, 1.8), cutoff: 6000 }),
  roost: () => ({ gain: 0.22, rate: 1, cutoff: 3000 }),
  drive: (x) => ({ gain: 0.22 * (0.4 + 0.6 * Math.min(x, 1.2)), rate: clamp(0.6 + 0.6 * x, 0.5, 1.8), cutoff: 4000 + 6000 * Math.min(x, 1) }),
  vacuum: (x) => ({ gain: 0.3 * Math.min(x, 1.3), rate: 0.9 + 0.2 * Math.min(x, 1.3), cutoff: 3000 + 7000 * Math.min(x, 1) }),
  binrattle: (x) => ({ gain: 0.3 * Math.min(x, 1.2), rate: 1, cutoff: 9000 }),
  // Matter fallback beds: level = stream gain, aux = pitch
  matter: (x, aux) => ({ gain: clamp(x, 0, 1.5), rate: clamp(aux, 0.5, 2), cutoff: 16000 }),
};

// ============================================================================================
// director
// ============================================================================================

/** Canonical M4 type ids (brief type_ids), with aliases A4 might pick. */
const ALIAS: Readonly<Record<string, string>> = {
  hopper: 'grit_hopper', sand_hopper: 'grit_hopper', grithopper: 'grit_hopper', water_tank: 'tank', sprinkler: 'sprinkle_can', watering_can: 'sprinkle_can',
  water_wheel: 'waterwheel', marblehopper: 'marble_hopper', marble_dispenser: 'marble_hopper', hairdryer: 'blowout', vacuum: 'vac', helium: 'inflator',
  tesla: 'arc_tower', arctower: 'arc_tower', toaster: 'toast_cannon', toastcannon: 'toast_cannon', egg: 'yolk', rc_car: 'zippy', duck: 'quack',
};
export const canonM4 = (t: string | undefined): string => (t ? ALIAS[t] ?? t : '');
export const M4_TYPES: ReadonlySet<string> = new Set([
  'grit_hopper', 'hourglass', 'tank', 'sprinkle_can', 'waterwheel', 'sponge', 'marble_hopper', 'blowout', 'vac', 'inflator', 'arc_tower',
  'toast_cannon', 'yolk', 'zippy', 'quack',
]);
export const isM4 = (t: string | undefined): boolean => M4_TYPES.has(canonM4(t));
/** Toast slices (pooled bodies): any type naming toast or a slice, other than the cannon itself. */
const isSlice = (t: string): boolean => t !== 'toast_cannon' && /toast|slice/.test(t);
/** M4 types with per-frame state (loops, fill edges, motion); yolk is a roller (roller()), quack event-only. */
const STATEFUL = new Set(['grit_hopper', 'hourglass', 'tank', 'sprinkle_can', 'waterwheel', 'sponge', 'marble_hopper', 'blowout', 'vac', 'inflator', 'arc_tower', 'toast_cannon', 'zippy']);
/** A4 (channels/m4_matter.ts matterMeter): dispensers' meter = 1 + round(20 × fill), 0 = no reading. */
export const FILL_STEPS = 20;
/** Where each container pours from, relative to its base origin (briefs: outlets, spouts, the rose). */
const SPOUT: Readonly<Record<string, Vec3>> = {
  grit_hopper: [0, 0.08, 0], marble_hopper: [0, 0.1, 0], tank: [0, 0.05, 0.12], sprinkle_can: [0.2, 0.12, 0], hourglass: [0, 0.1, 0],
  arc_tower: [0, 0.5, 0], inflator: [0, 0.25, 0], blowout: [0, 0.12, 0], vac: [0, 0.15, 0], toast_cannon: [0, 0.15, 0],
};

interface PState {
  type: string; flags: number; seen: number; fill: number; fillRate: number; fillAt: number; hasFill: boolean;
  motion: Motion; rot: readonly [number, number, number, number] | null; spin: number; peakSpin: number; moving: boolean; movedAt: number;
  pouring: boolean; pourStart: number; wetUntil: number; next: number; next2: number; low: boolean; full: boolean;
  charge: number; holding: boolean; lastArc: number; strainT: number; heading: number; headingAt: number; vPrev: number;
  bucketPhase: number; onAt: number;
}
interface Sched { at: number; name: string; pos: Vec3; gain: number; rate: number; id: number; family: 'mech' | 'fx' | 'impact' }

export class M4Parts {
  private readonly parts = new Map<number, PState>();
  private readonly recent = new Map<string, number>();
  private readonly rollers = new Map<string, Motion>();
  private readonly sched: Sched[] = [];
  /** Last known position of every M4 part (arc targets, events whose pos is the target). */
  private readonly where = new Map<number, Vec3>();
  /** Gate / valve state per dispenser (each Signal pulse toggles it; events can arrive before part() sees the part). */
  private readonly opened = new Map<number, boolean>();
  /** ZIPPY's last Drive direction (A4: mag 1 / −1 / 0). */
  private readonly driveDir = new Map<number, number>();
  /** Once the sim sends QUACK Squeak events, impacts stop squeaking on their own (no doubles). */
  private squeakEvents = false;
  readonly stats = { events: 0, cues: 0 };

  constructor(private readonly h: AudioHost) {}

  reset(): void { this.parts.clear(); this.recent.clear(); this.rollers.clear(); this.sched.length = 0; this.where.clear(); this.opened.clear(); this.driveDir.clear(); this.squeakEvents = false; }

  private cue(id: number, name: string, var01: number, pos: Vec3, when: number, gain: number, x: { rate?: number; prio?: number; family?: 'mech' | 'fx' | 'impact' } = {}): void {
    this.recent.set(`${id}:${name}`, this.h.now());
    const o: Parameters<AudioHost['play']>[2] = { family: x.family ?? 'mech', pos, when, gain: clamp(gain, 0, 1.2), key: name };
    if (x.rate !== undefined) o.rate = x.rate;
    if (x.prio !== undefined) o.prio = x.prio;
    if (this.h.play(name, var01, o)) this.stats.cues++;
  }
  private fresh(id: number, name: string, within = 0.3): boolean { return this.h.now() - (this.recent.get(`${id}:${name}`) ?? -10) < within; }
  private later(at: number, id: number, name: string, pos: Vec3, gain: number, rate = 1, family: Sched['family'] = 'mech'): void {
    if (this.sched.length < 64) this.sched.push({ at, id, name, pos: [pos[0], pos[1], pos[2]], gain, rate, family });
  }
  private spout(t: string, pos: Vec3): Vec3 { const o = SPOUT[t] ?? [0, 0, 0]; return [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]]; }

  // ---- events ----

  /** Returns true when handled (the M3/M2/M1 paths then skip it). */
  event(e: SimEventLike, rawType: string | undefined, when: number, var01: number): boolean {
    const t = canonM4(rawType);
    const k = e.kind, id = e.part, p = e.pos;
    // toast slices landing (pooled bodies with their own type)
    if (rawType && isSlice(rawType) && (k === 'Impact' || k === 'Land')) {
      if (fin(e.mag, 0) >= 0.05) this.cue(id, 'toast/land', var01, p, when, clamp(0.3 + fin(e.mag, 0) / 4, 0.3, 0.7), { family: 'impact' });
      return true;
    }
    if (!M4_TYPES.has(t)) return false;
    this.stats.events++;
    const J = Math.max(0, fin(e.mag, 0));
    const s = this.parts.get(id);
    const trigger = k === 'Signal' || k === 'Press' || k === 'Trigger' || k === 'Fire';
    switch (t) {
      case 'grit_hopper': case 'marble_hopper': case 'tank': {
        const was = this.opened.get(id) ?? false;
        // A4: Valve (mag 1 open, 0 closed); Open / Close / Toggle and bare trigger pulses (each toggles the gate) also work
        const opening = k === 'Open' || ((k === 'Valve' || k === 'Toggle') && e.mag > 0) || (trigger && !was);
        const closing = k === 'Close' || ((k === 'Valve' || k === 'Toggle') && e.mag <= 0) || (trigger && was);
        if (opening || closing) {
          this.opened.set(id, opening);
          if (t === 'tank') this.cue(id, 'tank/valve', var01, p, when, 0.45, { rate: opening ? 1 : 0.92 });
          else if (t === 'grit_hopper') this.cue(id, opening ? 'grit/gate_open' : 'grit/gate_close', var01, p, when, 0.5);
          else this.cue(id, opening ? 'mhop/chute' : 'mhop/tick', var01, p, when, opening ? 0.4 : 0.3);
          return true;
        }
        if (k === 'Empty' || k === 'Emptied') { this.empty(id, t, p, when, var01); return true; }
        if (k === 'Refill' || k === 'Absorb' || k === 'Intake') {
          if (t === 'grit_hopper' && !this.fresh(id, 'grit/intake', 0.5)) this.cue(id, 'grit/intake', var01, p, when, 0.4);
          if (t === 'marble_hopper' && !this.fresh(id, 'mhop/refill', 0.7)) this.cue(id, 'mhop/refill', var01, p, when, 0.4);
          return true;
        }
        if (k === 'Pour' || k === 'Emit' || k === 'PourEnd') return true; // part state carries the pour loop
        return false;
      }
      case 'hourglass':
        if (k === 'Signal' || k === 'Done' || k === 'Empty') { this.cue(id, 'hourglass/done', var01, p, when, 0.45); this.h.heat(0.02); return true; }
        if (k === 'Toggle' || k === 'Flip') { this.cue(id, 'hourglass/flip', var01, p, when, 0.5); return true; }
        if (k === 'Impact' && J < 0.6) { if (J >= 0.03) this.cue(id, 'hourglass/clink', var01, p, when, clamp(0.15 + J, 0.15, 0.5), { family: 'impact' }); return true; }
        return false;
      case 'sprinkle_can':
        if (k === 'Tip' || k === 'Pour' || (k === 'Trigger' && !(s?.pouring ?? false))) { if (!this.fresh(id, 'can/tip_creak', 0.6)) this.cue(id, 'can/tip_creak', var01, p, when, 0.4); return true; }
        if (k === 'Latch' || k === 'PourEnd') { this.cue(id, 'can/latch', var01, p, when, 0.4); return true; }
        if (k === 'Impact') {
          if (s && s.fill > 0.1 && J >= 0.15 && !this.fresh(id, 'can/slosh', 0.4)) this.cue(id, 'can/slosh', var01, p, when, clamp(0.25 + J / 5, 0.25, 0.6));
          return false; // the material bank still plays the knock
        }
        if (k === 'Empty') { this.drips(id, p, when, 4, 1.6); return true; }
        return false;
      case 'waterwheel':
        if (k === 'Stall' || k === 'Jam') { if (!this.fresh(id, 'wheel/groan', 1)) this.cue(id, 'wheel/groan', var01, p, when, 0.45); return true; }
        return false;
      case 'sponge':
        if (k === 'Impact' || k === 'Squeeze') {
          const f = s?.hasFill ? s.fill : 0;
          // A4: Squeeze, mag = mL held (up to 2 kg): a wet sponge wrings out drips
          if (k === 'Squeeze') { this.cue(id, 'sponge/squish', var01, p, when, clamp(0.4 + J / 4000, 0.4, 0.65)); if (f > 0.1 || J > 100) this.drips(id, p, when + 0.1, 3, 0.8); return true; }
          if (J < 0.05) return true;
          if (f > 0.5 && J >= 0.4) this.cue(id, 'sponge/wet_thud', var01, p, when, clamp(0.35 + J / 6, 0.35, 0.8), { family: 'impact' });
          else if (f > 0.1) this.cue(id, 'sponge/squish', var01, p, when, clamp(0.25 + J / 5, 0.25, 0.7), { family: 'impact' });
          else this.cue(id, 'sponge/dry_bounce', var01, p, when, clamp(0.25 + J / 5, 0.25, 0.7), { family: 'impact' });
          return true;
        }
        if (k === 'Absorb') return true;
        return false;
      case 'blowout':
        if (k === 'Powered' || k === 'Unpowered' || k === 'Toggle') {
          const on = k === 'Powered' || (k === 'Toggle' && e.mag > 0);
          if (!this.fresh(id, 'dryer/click', 0.2)) this.cue(id, 'dryer/click', var01, p, when, 0.35, { rate: on ? 1 : 0.88 });
          if (!on) this.coolTicks(id, p, when);
          return true;
        }
        return false;
      case 'vac':
        if (k === 'Attach' || k === 'Grab') { if (s) s.holding = true; this.cue(id, 'vac/thwup', var01, p, when, clamp(0.4 + J / 10, 0.4, 0.8), { family: 'fx' }); return true; }
        if (k === 'Release') { if (s) s.holding = false; this.cue(id, 'vac/pop', var01, p, when, 0.45, { family: 'fx' }); return true; }
        if (k === 'Powered' || k === 'Unpowered') {
          this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.3, rate: 0.8 });
          if (k === 'Unpowered' && s?.holding) { s.holding = false; this.cue(id, 'vac/pop', var01, p, when + 0.05, 0.45, { family: 'fx' }); }
          return true;
        }
        return false;
      case 'inflator':
        if ((k === 'Valve' && e.mag > 0) || trigger || k === 'Open' || k === 'Inflate' || k === 'Powered') { if (!this.fresh(id, 'inflator/valve', 0.5)) this.cue(id, 'inflator/valve', var01, p, when, 0.45); return true; }
        if (k === 'Valve') return true;
        if (k === 'Overfill' || k === 'Overinflate' || k === 'Overpressure') { if (!this.fresh(id, 'inflator/beep', 1)) this.cue(id, 'inflator/beep', var01, p, when, 0.4); return true; }
        if (k === 'Close' || k === 'Unpowered') return true;
        return false;
      case 'arc_tower':
        if (k === 'Arc' || k === 'Strike' || k === 'Zap' || k === 'Discharge') {
          const top = this.spout('arc_tower', this.where.get(id) ?? p);
          if (s) s.lastArc = this.h.now();
          this.cue(id, 'arc/crackle', var01, top, when, clamp(0.55 + J / 8, 0.55, 0.85), { family: 'fx', prio: 1.4 }); // A4: mag = arc length (≤ 2 m)
          // the target: the event's position when it isn't the tower's own
          if (Math.hypot(p[0] - top[0], p[1] - top[1], p[2] - top[2]) > 0.3) this.cue(id, 'arc/zap', var01, p, when + 0.005, 0.6, { family: 'fx' });
          this.h.heat(0.05);
          return true;
        }
        if (k === 'Unpowered') { if (!this.fresh(id, 'arc/down', 0.5)) this.cue(id, 'arc/down', var01, this.spout(t, p), when, 0.4); return true; }
        if (k === 'Powered') return true;
        return false;
      case 'toast_cannon':
        if (k === 'Launch' || k === 'Pop' || k === 'Fire') {
          if (!this.fresh(id, 'toast/pop', 0.3)) {
            this.cue(id, 'toast/pop', var01, p, when, 0.65, { family: 'fx', prio: 1.3 });
            this.cue(id, 'toast/flutter', var01, this.spout(t, p), when + 0.05, 0.35, { family: 'fx' });
            this.h.heat(0.05);
          }
          return true;
        }
        if (k === 'Trigger' || k === 'Press' || k === 'Signal' || k === 'Powered' || k === 'Arm') { if (!this.fresh(id, 'toast/lever', 0.4)) this.cue(id, 'toast/lever', var01, p, when, 0.5); return true; }
        // the slices are the cannon's pooled bodies (A4: m3 pools), so their landings arrive under the cannon's id
        if (k === 'Impact') { if (J >= 0.05 && !this.fresh(id, 'toast/land', 0.06)) this.cue(id, 'toast/land', var01, p, when, clamp(0.3 + J / 4, 0.3, 0.7), { family: 'impact' }); return true; }
        if (k === 'Despawn') return true;
        return false;
      case 'yolk':
        if (k === 'Break' || k === 'Splat') { this.cue(id, 'yolk/splat', var01, p, when, 0.6, { family: 'fx', prio: 1.2 }); this.h.heat(0.03); return true; }
        if (k === 'Impact') { if (J >= 0.02 && !this.fresh(id, 'yolk/tap', 0.06)) this.cue(id, 'yolk/tap', var01, p, when, clamp(0.15 + J * 1.5, 0.15, 0.55), { family: 'impact', rate: 0.95 + 0.1 * var01 }); return true; }
        if (k === 'Spawn' || k === 'Lay' || k === 'Laid') { this.cue(id, 'yolk/laid', var01, p, when, 0.45); return true; }
        return false;
      case 'zippy':
        if (k === 'Drive') {
          // A4: mag = direction 1 / −1 / 0. Setting off beeps; a reversal chirps the servo and scrubs the tyres.
          const d = Math.sign(fin(e.mag, 0)), was = this.driveDir.get(id) ?? 0;
          this.driveDir.set(id, d);
          if (d !== 0 && was === 0 && !this.fresh(id, 'zippy/beep', 0.5)) this.cue(id, 'zippy/beep', var01, p, when, 0.4);
          if (d !== 0 && was !== 0 && d !== was) { this.cue(id, 'zippy/servo', var01, p, when, 0.25); this.cue(id, 'zippy/scrub', var01, p, when + 0.05, 0.35); }
          return true;
        }
        if (k === 'Signal' || k === 'Powered' || (k === 'Toggle' && e.mag > 0)) { if (!this.fresh(id, 'zippy/beep', 0.5)) this.cue(id, 'zippy/beep', var01, p, when, 0.4); return true; }
        if (k === 'Flip') { this.cue(id, 'zippy/flip', var01, p, when, 0.55, { family: 'impact' }); return true; }
        if (k === 'Impact') {
          if (J >= 4) this.cue(id, 'zippy/flip', var01, p, when, 0.55, { family: 'impact' });
          else if (J >= 0.25) this.cue(id, 'zippy/bump', var01, p, when, clamp(0.3 + J / 6, 0.3, 0.7), { family: 'impact' });
          return J >= 0.25;
        }
        return false;
      case 'quack':
        if (k === 'Impact' || k === 'Squeeze' || k === 'Squeak') {
          if (J < 0.05 && k === 'Impact') return true;
          // A4: Squeak, mag = 0–1 intensity (an impact ≥ 0.06 N·s, or a load landing on it). Once those arrive, impacts
          // only add the rubber thud. Light, short squeezes squeak higher; a hard one is the long honk.
          if (k === 'Squeak') this.squeakEvents = true;
          const tier = k === 'Squeak' ? (J < 0.33 ? 0 : J < 0.7 ? 1 : 2) : k === 'Impact' ? (J < 0.4 ? 0 : J < 2 ? 1 : 2) : 1;
          if (!(k === 'Impact' && this.squeakEvents) && !this.fresh(id, 'quack/squeak', 0.12)) {
            this.recent.set(`${id}:quack/squeak`, this.h.now());
            this.cue(id, `quack/squeak/${['soft', 'med', 'hard'][tier]}`, var01, p, when, [0.35, 0.5, 0.65][tier]!, { family: 'fx', rate: tier === 0 ? 1.05 + 0.1 * var01 : 0.97 + 0.06 * var01 });
          }
          if (k === 'Impact' && J >= 1) this.cue(id, 'quack/bounce', var01, p, when, clamp(0.25 + J / 10, 0.25, 0.6), { family: 'impact' });
          return true;
        }
        if (k === 'Splash') { this.cue(id, 'quack/splash', var01, p, when, clamp(0.35 + J / 8, 0.35, 0.7), { family: 'fx' }); this.drips(id, p, when + 0.6, 3, 2); return true; }
        return false;
      default:
        return false;
    }
  }

  private empty(id: number, t: string, pos: Vec3, when: number, var01: number): void {
    const sp = this.spout(t, pos);
    if (t === 'grit_hopper') { if (!this.fresh(id, 'grit/last_trickle', 2)) this.cue(id, 'grit/last_trickle', var01, sp, when, 0.45); }
    else if (t === 'tank') { if (!this.fresh(id, 'tank/gurgle', 2)) this.cue(id, 'tank/gurgle', var01, sp, when, 0.5); }
    else if (t === 'marble_hopper') { if (!this.fresh(id, 'mhop/empty', 2)) this.cue(id, 'mhop/empty', var01, pos, when, 0.45); }
  }

  private drips(id: number, pos: Vec3, when: number, n: number, over: number): void {
    for (let k = 0; k < n; k++) this.later(when + over * (k + hash01(id, k, 77)) / n, id, 'm4/drip', [pos[0], pos[1] - 0.02, pos[2]], 0.25 - 0.03 * k, 0.9 + 0.2 * hash01(id, k));
  }

  private coolTicks(id: number, pos: Vec3, when: number): void {
    for (const [k, dt] of [0.4, 0.95, 1.7, 2.6, 3.8].entries()) this.later(when + dt + 0.2 * hash01(id, k, 5), id, 'dryer/cool_tick', pos, 0.22 - 0.03 * k, 0.9 + 0.2 * hash01(id, k, 6));
  }

  /** Per frame: scheduled one-shots (drips, cooling ticks) and forgetting parts that stopped reporting. */
  update(): void {
    const now = this.h.now();
    for (let i = this.sched.length - 1; i >= 0; i--) {
      const q = this.sched[i]!;
      if (now < q.at - 0.03) continue;
      this.sched.splice(i, 1);
      this.h.play(q.name, hash01(q.id, Math.floor(q.at * 20)), { family: q.family, pos: q.pos, when: Math.max(now + 0.005, q.at), gain: q.gain, rate: q.rate, key: q.name });
    }
    if (this.parts.size > 0 && Math.floor(now * 2) !== Math.floor((now - 0.017) * 2)) {
      for (const [id, s] of this.parts) if (now - s.seen > 2) { this.parts.delete(id); this.where.delete(id); }
    }
  }

  // ---- rollers (YOLK) ----

  /** YOLK's wobbly roll (only while rolling, not flying). Returns false for every other type. */
  roller(id: string, type: string, pos: Vec3, dt: number): boolean {
    if (canonM4(type) !== 'yolk') return false;
    if (!finite3(pos)) return true;
    let m = this.rollers.get(id);
    if (!m) { m = new Motion(pos); this.rollers.set(id, m); return true; }
    m.update(pos, dt);
    const vh = Math.hypot(m.vel[0], m.vel[2]);
    if (vh > 0.04 && Math.abs(m.vel[1]) < 0.35) this.h.loop(`${id}:yolk`, 'yolkroll', pos, Math.min(1.6, vh / 1.5));
    return true;
  }

  // ---- part state ----

  part(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: readonly [number, number, number, number] | null, dt: number, edges: boolean): void {
    const t = canonM4(type);
    if (!finite3(pos)) return;
    this.where.set(id, [pos[0], pos[1], pos[2]]);
    if (!STATEFUL.has(t)) return;
    const h = this.h, now = h.now();
    // A4: dispensers' meter is the fill bar, 1 + round(20 × fill) (0 = no reading)
    const m = clamp(fin(meter, 0), 0, 255);
    const f01 = m >= 1 ? clamp((m - 1) / FILL_STEPS, 0, 1) : 0;
    let s = this.parts.get(id);
    if (!s || s.type !== t) {
      s = {
        type: t, flags, seen: now, fill: f01, fillRate: 0, fillAt: now, hasFill: m >= 1, motion: new Motion(pos), rot, spin: 0, peakSpin: 0, moving: false, movedAt: -10,
        pouring: false, pourStart: -10, wetUntil: -10, next: now + 0.5, next2: now + 0.5, low: false, full: false,
        charge: 0, holding: false, lastArc: -10, strainT: 0, heading: 0, headingAt: now, vPrev: 0, bucketPhase: 0, onAt: -10,
      };
      this.parts.set(id, s);
    }
    const prev = s.flags;
    s.flags = flags; s.seen = now;
    s.motion.update(pos, dt);
    // fill and its rate (per second, smoothed); the meter only moves when the sim worker posts a frame
    if (m >= 1) s.hasFill = true;
    if (f01 !== s.fill) {
      const span = Math.max(now - s.fillAt, 1 / 120);
      const r = clamp((f01 - s.fill) / span, -5, 5);
      s.fillRate += (r - s.fillRate) * 0.5;
      s.fill = f01; s.fillAt = now;
    } else if (now - s.fillAt > 0.6) s.fillRate *= 0.85;
    // ω of the moving body (waterwheel)
    if (rot && Number.isFinite(rot[0]) && Number.isFinite(rot[1]) && Number.isFinite(rot[2]) && Number.isFinite(rot[3])) {
      const r0 = s.rot;
      if (r0 && (r0[0] !== rot[0] || r0[1] !== rot[1] || r0[2] !== rot[2] || r0[3] !== rot[3])) {
        const d = clamp(Math.abs(r0[0] * rot[0] + r0[1] * rot[1] + r0[2] * rot[2] + r0[3] * rot[3]), 0, 1);
        const w = clamp((2 * Math.acos(d)) / Math.max(dt, 1 / 240), 0, 200);
        s.spin = clamp(s.spin + (w - s.spin) * 0.35, 0, 200);
      } else if (r0) s.spin *= 0.9;
      s.rot = rot;
    }
    if (flags & F.dead) return;
    const rise = (b: number) => edges && !(prev & b) && (flags & b) !== 0;
    const fall = (b: number) => edges && (prev & b) !== 0 && !(flags & b);
    const v01 = hash01(id, h.tick(), hashStr(t));
    const L = (kind: LoopKind, level: number, o?: LoopOpts, at: Vec3 = pos) => h.loop(`${kind}:${id}`, kind, at, level, o);
    const lit = (flags & F.lit) !== 0, powered = (flags & F.powered) !== 0, armed = (flags & F.armed) !== 0, pressed = (flags & F.pressed) !== 0, fault = (flags & F.fault) !== 0;
    const drain = Math.max(0, -s.fillRate), gain = Math.max(0, s.fillRate);
    switch (t) {
      case 'grit_hopper': case 'marble_hopper': case 'tank': {
        // A4 flags: `lit` while pouring (gate open with contents), `fault` while low (< 10 %). Without them: a draining meter.
        const gateName = t === 'tank' ? 'tank/valve' : t === 'grit_hopper' ? 'grit/gate_open' : 'mhop/chute';
        if (rise(F.lit) && !this.fresh(id, gateName, 0.4) && !this.fresh(id, 'grit/gate_close', 0.1)) this.event({ tick: h.tick(), kind: 'Open', part: id, pos, mag: 1 }, t, now, v01);
        const pouring = lit || drain > 0.01;
        const sp = this.spout(t, pos);
        if (pouring) {
          // rate-scaled: the measured drain (a full 1M hopper at 20k grains/s drains 2 %/s), else the open gate
          const lvl = drain > 0.005 ? clamp(0.55 + drain * 15, 0.55, 1.3) : 0.9;
          if (t === 'grit_hopper') L('pour', lvl, { variant: 'pour/sand', aux: 1 }, sp);
          else if (t === 'tank') {
            L('pour', lvl, { variant: 'pour/water', aux: s.hasFill ? 0.85 + 0.2 * s.fill : 1 }, sp); // the stream thins and drops as the head falls
            if (s.hasFill && s.fill < 0.25 && now >= s.next) { this.cue(id, 'tank/glug', v01, pos, now, 0.4); s.next = now + 0.45 + 0.5 * hash01(id, h.tick(), 3); }
          } else {
            L('pour', lvl, { variant: 'pour/marble', aux: 1 }, sp);
            L('feed', lvl, undefined, pos);
            if (now >= s.next2) { this.cue(id, 'mhop/tick', v01, pos, now, 0.18); s.next2 = now + 0.25; }
          }
          if (!s.pouring) s.pourStart = now;
        }
        // ran dry while pouring (no Empty event within 0.3 s)
        if (s.pouring && !pouring && edges && s.hasFill && s.fill <= 0.001 && now - s.pourStart > 0.3) this.empty(id, t, pos, now, v01);
        s.pouring = pouring;
        // refilling (fill rising: grains through the intake grille)
        if (gain > 0.01) {
          if (t === 'tank') L('fill', clamp(0.45 + gain * 10, 0.45, 1.2), undefined, [pos[0], pos[1] + 0.35, pos[2]]);
          else if (now >= s.next) {
            this.cue(id, t === 'grit_hopper' ? 'grit/intake' : 'mhop/refill', v01, [pos[0], pos[1] + 0.38, pos[2]], now, 0.35);
            s.next = now + 0.6 + 0.3 * hash01(id, h.tick(), 9);
          }
        }
        // low: a soft double beep on the `fault` edge (or the fill dropping under 10 %)
        const low = fault || (s.hasFill && s.fill > 0 && s.fill < 0.1);
        if (!s.low && low && edges) { s.low = true; this.cue(id, 'm4/low_beep', v01, pos, now, 0.25); }
        else if (!low && (!s.hasFill || s.fill > 0.15 || !fault)) s.low = low;
        break;
      }
      case 'hourglass':
        // `lit` while the stream runs (A4); `pressed` for 0.2 s when it signals (its Empty event plays the chime)
        if (lit || armed) L('hourglass', 1, undefined, this.spout(t, pos));
        if (rise(F.pressed) && !this.fresh(id, 'hourglass/done', 1)) this.cue(id, 'hourglass/done', v01, pos, now, 0.45);
        break;
      case 'sprinkle_can': {
        // `lit` while it sprinkles, `armed` once latched back in the cradle
        const pouring = lit || drain > 0.01;
        const sp = this.spout(t, pos);
        if (pouring) {
          L('sprinkle', drain > 0.005 ? clamp(0.55 + drain * 10, 0.55, 1.2) : 0.9, undefined, sp);
          if (!s.pouring && edges && !this.fresh(id, 'can/tip_creak', 0.6)) this.cue(id, 'can/tip_creak', v01, pos, now, 0.35);
        } else if (s.pouring && edges && s.hasFill && s.fill <= 0.01) this.drips(id, sp, now + 0.1, 4, 1.6);
        s.pouring = pouring;
        if (rise(F.armed) && !this.fresh(id, 'can/latch', 0.6)) this.cue(id, 'can/latch', v01, pos, now, 0.35);
        if (gain > 0.01) L('fill', clamp(0.35 + gain * 10, 0.35, 1), undefined, [pos[0], pos[1] + 0.15, pos[2]]);
        break;
      }
      case 'waterwheel': {
        const w = s.spin;
        if (w > 0.15) { L('waterwheel', w / 4); s.wetUntil = now + 3; }
        // buckets: 5 per turn; each pass at the bottom spills (tips at the 25° lip), the one cresting the top sloshes
        if (w > 0.4) {
          s.bucketPhase += (w * 5 / TAU) * dt;
          if (s.bucketPhase >= 1) {
            s.bucketPhase -= Math.floor(s.bucketPhase);
            const lvl = clamp(0.2 + w / 10, 0.2, 0.5);
            this.cue(id, 'wheel/spill', v01, [pos[0], pos[1] - 0.15, pos[2]], now, lvl, { rate: 0.9 + 0.2 * v01 });
            if (w < 6) this.cue(id, 'wheel/slosh', v01, [pos[0], pos[1] + 0.15, pos[2]], now + 0.5 / Math.max(1, w), lvl * 0.6);
          }
        }
        if (now < s.wetUntil) L('dripwet', w > 0.15 ? 1 : (s.wetUntil - now) / 3, undefined, [pos[0], pos[1] - 0.1, pos[2]]);
        // a stall under load: spinning, then stopped
        if (w > s.peakSpin) s.peakSpin = w;
        if (!s.moving && w > 0.5) { s.moving = true; s.movedAt = now; s.peakSpin = w; }
        if (s.moving && w < 0.08 && now - s.movedAt > 0.5) {
          s.moving = false;
          if (edges && s.peakSpin > 1.5 && !this.fresh(id, 'wheel/groan', 1)) this.cue(id, 'wheel/groan', v01, pos, now, 0.4);
          s.peakSpin = 0;
        }
        break;
      }
      case 'sponge': {
        // `lit` while wet (≥ 20 %), `pressed` while squeezed. It drinks when it turns wet (or its fill rises).
        if (rise(F.lit)) s.onAt = now;
        if (gain > 0.01 || now - s.onAt < 0.9) L('slurp', gain > 0.01 ? clamp(0.45 + gain * 10, 0.45, 1.2) : 0.8);
        if (rise(F.pressed) && !this.fresh(id, 'sponge/squish', 0.3)) { this.cue(id, 'sponge/squish', v01, pos, now, 0.5); if (lit) this.drips(id, pos, now + 0.1, 3, 0.8); }
        const wet = lit || (s.hasFill && s.fill > 0.2);
        if (wet && now >= s.next) {
          const f = s.hasFill ? s.fill : 0.6;
          this.cue(id, 'm4/drip', v01, [pos[0], pos[1] - 0.03, pos[2]], now, clamp(0.12 + 0.2 * f, 0.12, 0.3), { rate: 0.9 + 0.2 * v01 });
          s.next = now + (2.2 - 1.8 * f) * (0.6 + 0.8 * hash01(id, h.tick(), 4));
        }
        s.wetUntil = wet ? now + 1e9 : -10;
        break;
      }
      case 'blowout': {
        // A4: `armed` while warming, `lit` while the heater glows (warm, or cooling for 2 s); power runs the fan
        const on = powered || armed;
        if (on) { L('dryer', 1, { aux: armed && !lit ? 0.9 : 1 }); L('airrush', 1, undefined, this.spout(t, pos)); }
        if (on && !s.pouring && edges && !this.fresh(id, 'dryer/click', 0.3)) this.cue(id, 'dryer/click', v01, pos, now, 0.35);
        if (!on && s.pouring && edges) { if (!this.fresh(id, 'dryer/click', 0.3)) this.cue(id, 'dryer/click', v01, pos, now, 0.35, { rate: 0.88 }); this.coolTicks(id, pos, now); }
        s.pouring = on;
        break;
      }
      case 'vac': {
        // `pressed` while holding something: the clogged whine climbs. Attach / Release events play the thwup and pop.
        const holding = s.holding || pressed;
        if (powered || holding) L('suction', 1, { aux: holding ? 1.25 : 1 }, this.spout(t, pos));
        if (rise(F.pressed) && !this.fresh(id, 'vac/thwup', 0.3)) this.cue(id, 'vac/thwup', v01, pos, now, 0.45, { family: 'fx' });
        if (fall(F.pressed) && !this.fresh(id, 'vac/pop', 0.3)) this.cue(id, 'vac/pop', v01, pos, now, 0.4, { family: 'fx' });
        if (rise(F.powered) && !this.fresh(id, 'relay', 0.3)) { this.recent.set(`${id}:relay`, now); h.play('relay', v01, { family: 'mech', pos, when: now, gain: 0.3, rate: 0.8 }); }
        break;
      }
      case 'inflator': {
        // `lit` while the valve is open: the hiss climbs as the HELIO fills (time since the valve opened, ~3 s to full)
        if (rise(F.lit)) { s.onAt = now; if (!this.fresh(id, 'inflator/valve', 0.5)) this.cue(id, 'inflator/valve', v01, pos, now, 0.45); }
        const inflating = lit || armed;
        const f = s.hasFill ? s.fill : clamp((now - s.onAt) / 3, 0, 1.1);
        if (inflating) {
          L('gashiss', 1, { aux: f }, this.spout(t, pos));
          if (now >= s.next) { this.cue(id, 'inflator/tick', v01, pos, now, 0.18); s.next = now + clamp(0.5 - 0.35 * f, 0.12, 0.5); }
        }
        // `pressed` while over-filled (the amber blink): the overpressure beep (the Overfill event plays it too)
        if (rise(F.pressed) && !this.fresh(id, 'inflator/beep', 1)) this.cue(id, 'inflator/beep', v01, pos, now, 0.4);
        if (!s.full && inflating && f > 1 && edges) { s.full = true; if (!this.fresh(id, 'inflator/beep', 1)) this.cue(id, 'inflator/beep', v01, pos, now, 0.4); }
        else if (!inflating) s.full = false;
        break;
      }
      case 'arc_tower': {
        // A4: `armed` while charging (0.5 s), `lit` while arcing. Charge ramps on `armed`, holds while lit, sags without power.
        const top = this.spout(t, pos);
        const live = armed || lit || powered;
        s.charge = clamp(s.charge + (armed ? dt / 0.5 : lit ? dt / 0.2 : live ? dt / 0.5 : -dt / 0.3), 0, 1);
        if (live || s.charge > 0.02) L('tesla', s.charge, undefined, [pos[0], pos[1] + 0.25, pos[2]]);
        if ((lit || (powered && s.charge > 0.6)) && live) L('corona', Math.max(s.charge, lit ? 1 : 0), undefined, top);
        // arcing with no Arc events reaching audio: crackle on a seeded cadence
        if (lit && now - s.lastArc > 1.2 && now >= s.next) {
          this.cue(id, 'arc/crackle', v01, top, now, 0.5, { family: 'fx' });
          s.next = now + 0.3 + 0.5 * hash01(id, h.tick(), 12);
        }
        if (s.pouring && !live && edges && !this.fresh(id, 'arc/down', 0.5)) this.cue(id, 'arc/down', v01, top, now, 0.4);
        s.pouring = live;
        break;
      }
      case 'toast_cannon': {
        // A4: `lit` + `armed` while toasting (3 s), `lit` alone while cooling (1 s); Trigger = lever down, Launch = pop
        const toasting = armed;
        if (toasting) L('toast', 1);
        if (rise(F.armed) && !this.fresh(id, 'toast/lever', 0.4)) this.cue(id, 'toast/lever', v01, pos, now, 0.5);
        // the timer ran out and no Launch event played the pop: pop it here
        if (fall(F.armed) && !this.fresh(id, 'toast/pop', 0.5)) {
          this.later(now + 0.25, id, 'toast/pop', pos, 0.65, 1, 'fx');
          this.recent.set(`${id}:toast/pop`, now + 0.25);
        }
        break;
      }
      case 'zippy': {
        // A4: `lit` (headlights) while driving, `fault` while blocked; Drive events carry the direction
        const v = Math.hypot(s.motion.vel[0], s.motion.vel[2]);
        const driving = lit || powered;
        if (driving || v > 0.05) L('zippy', driving ? Math.max(0.15, v / 1.5) : v / 1.5, { doppler: true });
        if (rise(F.lit) && !this.fresh(id, 'zippy/beep', 0.5)) this.cue(id, 'zippy/beep', v01, pos, now, 0.4);
        if (edges && dt > 0) {
          // a hard acceleration or brake scrubs the tyres
          const acc = Math.abs(v - s.vPrev) / Math.max(dt, 1 / 120);
          if (acc > 4 && v > 0.3 && !this.fresh(id, 'zippy/scrub', 0.6)) this.cue(id, 'zippy/scrub', v01, pos, now, clamp(0.2 + acc / 30, 0.2, 0.5));
          // steering: the heading turns more than 25° within a quarter second
          if (v > 0.2) {
            const hd = Math.atan2(s.motion.vel[2], s.motion.vel[0]);
            let dh = Math.abs(hd - s.heading); if (dh > Math.PI) dh = TAU - dh;
            if (dh > 0.44 && now - s.headingAt < 0.25 && !this.fresh(id, 'zippy/servo', 0.4)) this.cue(id, 'zippy/servo', v01, pos, now, 0.25);
            if (dh > 0.1 || now - s.headingAt > 0.25) { s.heading = hd; s.headingAt = now; }
          }
          // blocked (`fault`) or towing: driving but barely moving for 0.6 s
          s.strainT = fault || (driving && v < 0.03) ? s.strainT + dt : 0;
          if (s.strainT > 0.6 && !this.fresh(id, 'zippy/strain', 2)) { this.cue(id, 'zippy/strain', v01, pos, now, 0.35); s.strainT = 0; }
        }
        s.vPrev = v;
        break;
      }
      default:
    }
  }
}
