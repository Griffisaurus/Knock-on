// M3 parts (GAME_SPEC §12, AUDIO.md §4, §5, §11; "Audio hooks" rows of the art briefs): procedural sounds for
// the 30 M3 parts and the director that maps events, flags, meters and measured motion to cues and loops.
//
// Stream A3 hadn't published its EventKinds when this was written (M3 plan contract 6), so every part is
// driven three ways and whichever arrives first wins (a flag-edge fallback stays quiet when the matching
// event already played the cue within 0.3 s):
//   events  the M2 kinds (Lit/Unlit, Toggle, Launch, Signal, Press, Impact, Break, Note, Spawn/Despawn,
//           Powered/Unpowered, Pop, Detonate) plus likely M3 names (Burst, Boost, Snap, Fire, Retract, Attach,
//           PinsAllDown, Strike, …); unknown kinds are ignored
//   state   part(): flag edges and levels, the meter byte, ω of the `arm` body and the `arm` body's motion
//   context rollers: glidepath / tube / gutter paths, the nearest surface part, the environment's floor
// The full mapping table is in docs/dev/M3_NOTES_F3.md.

import { crack, debris, impact, relay, type Recipe } from './bank';
import { F } from './mech';
import { hash01, hashStr, type Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, glide, grains, hp, lp, mixInto, modal, normalize,
  pluck, seamless, softClip, sweep, white, type Mode,
} from './synth';
import { Motion, clamp, dist, finite3, type AudioHost, type LoopKind, type LoopOpts, type SimEventLike, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);

// ============================================================================================
// sounds
// ============================================================================================

function click(f: number, tau: number, rng: Rng, w = 0.00015): Float32Array {
  return modal(at(Math.min(0.2, tau * 10)), contact(w, rng), [{ f, amp: 1, tau }, { f: f * 1.63, amp: 0.45, tau: tau * 0.6 }]);
}

/** Stick-slip creak (hinges, ropes, staves). */
function creak(sec: number, rate: number, f: number, rng: Rng): Float32Array {
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

/** A sine plus a few harmonics with frequency function f(t). */
function tone(len: number, f: (t: number) => number, amp: (t: number) => number, harm: readonly number[] = []): Float32Array {
  const x = chirp(len, f, amp);
  harm.forEach((a, k) => mixInto(x, chirp(len, (t) => f(t) * (k + 2), amp), 0, a));
  return x;
}

// ---- optics, wireless, field ----

function lanceCharge(rng: Rng): Float32Array {
  const len = at(0.45);
  const env = (t: number) => Math.min(1, t / 0.02) * (t < 0.38 ? 1 : Math.max(0, (0.45 - t) / 0.07));
  const x = tone(len, (t) => 300 + 2700 * Math.pow(Math.min(1, t / 0.4), 1.5), env, [0.3, 0.15]);
  mixInto(x, normalize(envFn(hp(white(len, rng), 5000), (t) => 0.1 * env(t)), 0.08));
  return fadeEdges(normalize(x, 0.28));
}

function lanceLoop(): Float32Array {
  const x = new Float32Array(SR); // 1 s, integer-Hz partials: seamless
  for (let i = 0; i < SR; i++) {
    const t = i / SR, ph = 2 * Math.PI * 120 * t;
    let s = 0;
    for (let h = 1; h <= 9; h += 2) s += Math.sin(h * ph) / (h * h);
    x[i] = 0.5 * s + 0.12 * Math.sin(2 * Math.PI * 7200 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * t))
      + 0.08 * (Math.sin(2 * Math.PI * 2400 * t) + Math.sin(2 * Math.PI * 2403 * t));
  }
  return normalize(x, 0.28);
}

function burnLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = hp(white(len, rng), 2500);
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.997 + rng.bi() * 0.04; x[i] = x[i]! * (0.3 + 3.5 * Math.abs(am)); }
    normalize(x, 0.45);
    const fry = bp(white(len, rng), 900, 0.8);
    mixInto(x, normalize(fry, 0.12));
    grains(x, rng, () => 90, (r) => normalize(hp(envAD(white(200, r), 0.00004, 0.0006), 2500), 0.25 + 0.5 * r.next()));
    return x;
  }), 0.33);
}

function burnFlare(rng: Rng): Float32Array {
  const x = alloc(0.7);
  mixInto(x, normalize(envAD(hp(white(x.length, rng), 3000), 0.005, 0.15), 0.8));
  grains(x, rng, (t) => (t < 0.4 ? 120 : 0), (r) => normalize(hp(envAD(white(200, r), 0.00004, 0.0006), 2500), 0.3 + 0.5 * r.next()));
  return fadeEdges(normalize(x, 0.4), 0.001, 0.08);
}

function lanceOff(rng: Rng): Float32Array {
  const x = alloc(0.15);
  mixInto(x, click(2600, 0.01, rng));
  mixInto(x, chirp(at(0.12), glide(1800, 600, 0.03), (t) => 0.3 * Math.exp(-t / 0.04)));
  return fadeEdges(normalize(x, 0.25));
}

function opticTing(rng: Rng): Float32Array {
  return fadeEdges(normalize(modal(at(0.9), contact(0.00006, rng), [
    { f: 3900 * (1 + rng.bi() * 0.03), amp: 1, tau: 0.35 }, { f: 9300, amp: 0.4, tau: 0.15 }, { f: 13100, amp: 0.2, tau: 0.06 },
  ]), 0.25), 0.0001, 0.1);
}

function prismLoop(rng: Rng): Float32Array {
  const x = new Float32Array(2 * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const s = Math.sin(2 * Math.PI * 3300 * t) + Math.sin(2 * Math.PI * 3301.5 * t) + 0.7 * Math.sin(2 * Math.PI * 4950 * t)
      + 0.7 * Math.sin(2 * Math.PI * 4952 * t) + 0.3 * Math.sin(2 * Math.PI * 6600.5 * t);
    x[i] = s * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t));
  }
  normalize(x, 1);
  mixInto(x, normalize(seamless(2, 0.2, (n) => hp(white(n, rng), 7000)), 0.12));
  return normalize(x, 0.22);
}

function beep(len: number, f: number, amt = 2): Float32Array {
  const x = chirp(len, () => f, (t) => Math.min(1, t / 0.003) * Math.min(1, (len / SR - t) / 0.006));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(amt * x[i]!);
  return x;
}

function tripArm(): Float32Array {
  const x = alloc(0.16);
  mixInto(x, beep(at(0.05), 1200));
  mixInto(x, beep(at(0.06), 1800), at(0.07));
  return fadeEdges(normalize(lp(x, 6000), 0.25));
}

function tripChirp(rng: Rng): Float32Array {
  const x = alloc(0.18);
  const k = 1 + rng.bi() * 0.03;
  for (let n = 0; n < 3; n++) mixInto(x, chirp(at(0.03), (t) => (2000 + 1200 * t / 0.03) * k, (t) => Math.sin(Math.PI * t / 0.03)), at(n * 0.045), 1 - n * 0.15);
  return fadeEdges(normalize(x, 0.32));
}

function pingTx(rng: Rng): Float32Array {
  const len = at(0.14);
  const k = 1 + rng.bi() * 0.02;
  const x = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = (900 + 900 * Math.min(1, t / 0.08)) * k;
    ph += 2 * Math.PI * f / SR;
    x[i] = Math.sin(ph + 0.8 * Math.exp(-t / 0.03) * Math.sin(2 * ph)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.05);
  }
  return fadeEdges(normalize(x, 0.3));
}

function pingRx(rng: Rng): Float32Array {
  const x = alloc(0.25);
  const k = 1 + rng.bi() * 0.02;
  const b = chirp(at(0.15), (t) => (t < 0.05 ? 1800 - 500 * t / 0.05 : 1300 + 300 * (t - 0.05) / 0.1) * k, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.06));
  mixInto(x, b);
  mixInto(x, b, at(0.07), 0.35);
  return fadeEdges(normalize(x, 0.3));
}

function magOn(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(modal(x.length, contact(0.003, rng, 0.3), [{ f: 85, amp: 1, tau: 0.08 }, { f: 190, amp: 0.6, tau: 0.05 }, { f: 520, amp: 0.3, tau: 0.02 }]), 0.8));
  mixInto(x, relay(rng), 0, 0.5);
  const buzz = chirp(x.length, () => 100, (t) => Math.min(1, t / 0.2) * 0.4);
  for (let i = 0; i < buzz.length; i++) buzz[i] = Math.tanh(3 * buzz[i]!);
  mixInto(x, normalize(bp(buzz, 300, 0.8), 0.25));
  return fadeEdges(normalize(x, 0.45), 0.0005, 0.08);
}

function magHumLoop(): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    x[i] = Math.sin(2 * Math.PI * 100 * t) + 0.5 * Math.tanh(3 * Math.sin(2 * Math.PI * 200 * t)) + 0.2 * Math.sin(2 * Math.PI * 300 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 4 * t));
  }
  return normalize(lp(x, 2000), 0.3);
}

function magClack(rng: Rng): Float32Array {
  const x = impact('steel', 2, rng);
  mixInto(x, click(3000, 0.006, rng), 0, 0.5);
  return fadeEdges(normalize(x, 0.45));
}

function magRelease(rng: Rng): Float32Array {
  const x = alloc(0.4);
  mixInto(x, modal(x.length, contact(0.0001, rng), [{ f: 4200, amp: 1, tau: 0.1 }, { f: 6900, amp: 0.4, tau: 0.05 }]));
  mixInto(x, chirp(at(0.3), (t) => (900 - 300 * t / 0.3) * (1 + 0.04 * Math.sin(2 * Math.PI * 22 * t)), (t) => 0.2 * Math.exp(-t / 0.08)));
  return fadeEdges(normalize(x, 0.3));
}

// ---- rollers ----

type Surf = 'wood' | 'steel' | 'glass';

function marbleLoop(s: Surf | 'rail', rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    if (s === 'wood') {
      mixInto(x, normalize(lp(brown(len, rng), 900), 0.4));
      mixInto(x, normalize(bp(white(len, rng), 650, 1.2), 0.6));   // the board's hollow body
      const toks = [0, 1, 2].map(() => impact('wood', 0, rng));
      grains(x, rng, () => 40, (r) => normalize(toks[r.int(3)]!.slice(), 0.04 + 0.1 * r.next()));
    } else if (s === 'steel') {
      mixInto(x, normalize(bp(white(len, rng), 4200, 0.8), 0.5));  // bearing hiss
      mixInto(x, normalize(bp(white(len, rng), 2600, 6), 0.35));
      mixInto(x, normalize(bp(white(len, rng), 5100, 8), 0.25));   // the plate sings
      mixInto(x, normalize(lp(brown(len, rng), 300), 0.2));
    } else if (s === 'glass') {
      mixInto(x, normalize(bp(white(len, rng), 3800, 1), 0.35));
      mixInto(x, normalize(hp(white(len, rng), 7000), 0.1));
      const toks = [0, 1, 2, 3].map(() => impact('glass', 0, rng));
      grains(x, rng, () => 50, (r) => normalize(toks[r.int(4)]!.slice(), 0.05 + 0.15 * r.next()));
    } else {
      // GLIDEPATH rail: the tube rail rings at its own modes; a rumble under it
      const n = white(len, rng);
      mixInto(x, normalize(bp(n.slice(), 1800, 10), 0.35));
      mixInto(x, normalize(bp(n.slice(), 3100, 12), 0.3));
      mixInto(x, normalize(bp(n, 4700, 12), 0.2));
      mixInto(x, normalize(lp(brown(len, rng), 250), 0.4));
      mixInto(x, normalize(hp(white(len, rng), 5000), 0.08));
    }
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.9995 + rng.bi() * 0.01; x[i] = x[i]! * (0.8 + 0.15 * Math.sin(2 * Math.PI * 6 * i / SR) + am); }
    return x;
  }), 0.35);
}

function marbleClick(rng: Rng): Float32Array {
  return fadeEdges(normalize(modal(at(0.15), contact(0.00004, rng), [
    { f: 5200 * (1 + rng.bi() * 0.08), amp: 1, tau: 0.03 }, { f: 8900 * (1 + rng.bi() * 0.05), amp: 0.5, tau: 0.015 },
  ]), 0.35));
}

function boostZip(rng: Rng): Float32Array {
  const len = at(0.55);
  const n = white(len, rng);
  sweep(n, 'bp', (t) => 600 + 4400 * Math.min(1, t / 0.4), 2);
  envFn(n, (t) => Math.sin(Math.PI * Math.min(1, t / 0.55)));
  const x = normalize(n, 0.7);
  mixInto(x, tone(len, (t) => 400 + 1200 * Math.min(1, t / 0.35), (t) => 0.3 * Math.sin(Math.PI * Math.min(1, t / 0.55)), [0.4, 0.2]));
  return fadeEdges(normalize(x, 0.4));
}

// ---- motion ----

function spindeckLoop(rng: Rng): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR, ph = 2 * Math.PI * 60 * t;
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(h * ph + h) / h;
    x[i] = s + 0.25 * Math.sin(2 * Math.PI * 840 * t) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 2 * t)) + 0.08 * Math.sin(2 * Math.PI * 1680 * t);
  }
  normalize(x, 1);
  mixInto(x, normalize(seamless(1, 0.1, (n) => bp(white(n, rng), 3000, 0.8)), 0.08));
  return normalize(x, 0.3);
}

function heavyClunk(rng: Rng, f: number): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(modal(x.length, contact(0.003, rng, 0.4), [{ f, amp: 1, tau: 0.12 }, { f: f * 2.35, amp: 0.6, tau: 0.08 }, { f: f * 5.8, amp: 0.3, tau: 0.04 }]), 0.8));
  mixInto(x, lp(impact('steel', 1, rng), 3000), 0, 0.4);
  mixInto(x, relay(rng), 0, 0.3);
  return fadeEdges(normalize(x, 0.45));
}

function liftMotorLoop(rng: Rng): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR, ph = 2 * Math.PI * 75 * t;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(h * ph + 0.5 * h) / (h * (h % 2 ? 1 : 1.5));
    x[i] = s + 0.2 * Math.sin(2 * Math.PI * 450 * t);
  }
  normalize(x, 1);
  const belt = seamless(1, 0.1, (n) => bp(white(n, rng), 1500, 0.8));
  for (let i = 0; i < belt.length; i++) belt[i] = belt[i]! * (0.6 + 0.4 * Math.sin(2 * Math.PI * 12 * i / SR));
  mixInto(x, normalize(belt, 0.25));
  return normalize(x, 0.3);
}

function liftChime(): Float32Array {
  const x = alloc(1.3);
  const bell = (f: number) => chirp(at(1), () => f, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.35));
  mixInto(x, bell(1318.5)); mixInto(x, bell(1318.5 * 2.76), 0, 0.12);
  mixInto(x, bell(1046.5), at(0.22)); mixInto(x, bell(1046.5 * 2.76), at(0.22), 0.12);
  return fadeEdges(normalize(x, 0.25), 0.0005, 0.1);
}

function ratchetLoop(rng: Rng): Float32Array {
  const x = alloc(1);
  for (let k = 0; k < 10; k++) {
    mixInto(x, click(2400 + rng.bi() * 120, 0.004, rng), at(k / 10), 0.8 + 0.2 * rng.next());
    mixInto(x, modal(at(0.05), contact(0.0006, rng), [{ f: 600, amp: 1, tau: 0.01 }]), at(k / 10), 0.35);
  }
  return normalize(x, 0.3);
}

function rackThunk(rng: Rng): Float32Array {
  const x = modal(at(0.4), contact(0.002, rng, 0.3), [{ f: 140, amp: 1, tau: 0.07 }, { f: 380, amp: 0.5, tau: 0.04 }]);
  mixInto(x, impact('steel', 0, rng), 0, 0.5);
  return fadeEdges(normalize(x, 0.4));
}

function ramFire(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, normalize(bp(envAD(white(at(0.2), rng), 0.002, 0.05), 1200, 0.7), 0.8));
  mixInto(x, normalize(modal(x.length, contact(0.0012, rng, 0.2), [{ f: 180, amp: 1, tau: 0.08 }, { f: 520, amp: 0.6, tau: 0.04 }, { f: 1400, amp: 0.4, tau: 0.02 }]), 0.9), at(0.04));
  mixInto(x, normalize(envAD(hp(white(x.length, rng), 3000), 0.01, 0.12), 0.25));
  softClip(normalize(x, 1), 1.4);
  return fadeEdges(normalize(x, 0.5));
}

function ramHiss(rng: Rng): Float32Array {
  const x = alloc(0.6);
  const n = white(at(0.45), rng);
  sweep(n, 'hp', (t) => 6000 - 3500 * Math.min(1, t / 0.4), 0.7);
  mixInto(x, normalize(envFn(n, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.18)), 0.7));
  mixInto(x, normalize(modal(at(0.2), contact(0.0015, rng), [{ f: 220, amp: 1, tau: 0.04 }, { f: 610, amp: 0.4, tau: 0.02 }]), 0.5), at(0.38));
  return fadeEdges(normalize(x, 0.35));
}

// ---- fire & boom (the explosions themselves are in pyro.ts) ----

function shellLift(rng: Rng): Float32Array {
  const x = alloc(0.8);
  mixInto(x, chirp(at(0.5), glide(170, 55, 0.03), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.09)));
  mixInto(x, normalize(bp(envAD(white(at(0.1), rng), 0.0005, 0.02), 500, 0.7), 0.6));
  mixInto(x, normalize(envAD(hp(white(x.length, rng), 3000), 0.01, 0.2), 0.15), at(0.03));
  softClip(normalize(x, 1), 1.5);
  return fadeEdges(normalize(x, 0.5));
}

function shellWhistle(rng: Rng): Float32Array {
  const len = at(1.3);
  const k = 1 + rng.bi() * 0.05;
  const env = (t: number) => Math.min(1, t / 0.05) * (t > 1.1 ? Math.max(0, (1.3 - t) / 0.2) : 1);
  const x = chirp(len, (t) => (900 + 1700 * Math.min(1, t / 1.1)) * k * (1 + 0.01 * Math.sin(2 * Math.PI * 7 * t)), env);
  mixInto(x, normalize(envFn(bp(white(len, rng), 2200, 1.5), (t) => 0.3 * env(t)), 0.15));
  return fadeEdges(normalize(x, 0.22));
}

function crackles(x: Float32Array, rng: Rng, rate: (t: number) => number, lo = 0.1, hi = 0.4): void {
  grains(x, rng, rate, (r) => normalize(hp(envAD(white(220, r), 0.00004, 0.0007), 1800), lo + (hi - lo) * r.next()));
}

function aerial(rng: Rng, kind: 'boom' | 'crackle' | 'hiss' | 'pops'): Float32Array {
  const x = alloc(kind === 'hiss' ? 2.8 : 2.2);
  const big = kind === 'boom' ? 1 : 0.6;
  mixInto(x, normalize(crack(rng), 0.7 * big));
  const body = lp(brown(at(1.8), rng), 2000);
  sweep(body, 'lp', (t) => 150 + 2200 * Math.exp(-t / 0.08), 0.8);
  envFn(body, (t) => Math.min(1, t / 0.004) * Math.exp(-t / (0.35 * big + 0.1)));
  mixInto(x, normalize(body, 0.9 * big));
  mixInto(x, chirp(at(1), glide(120, 45, 0.08), (t) => Math.exp(-t / 0.25)), 0, 0.7 * big);
  if (kind === 'crackle') crackles(x, rng, (t) => (t < 0.15 ? 0 : 160 * Math.exp(-(t - 0.15) / 0.6)), 0.15, 0.5);
  if (kind === 'hiss') {
    const h = hp(white(x.length, rng), 2500);
    envFn(h, (t) => (t < 0.1 ? 0 : Math.min(1, (t - 0.1) / 0.2) * Math.exp(-(t - 0.1) / 0.9)));
    mixInto(x, normalize(h, 0.3));
    crackles(x, rng, (t) => (t < 0.2 ? 0 : 30 * Math.exp(-t / 1.2)), 0.05, 0.2);
  }
  if (kind === 'pops') {
    const n = 4 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const p = envAD(white(at(0.05), rng), 0.00005, 0.004);
      hp(p, 400);
      mixInto(x, normalize(p, 0.4 + 0.3 * rng.next()), at(0.3 + 0.5 * rng.next()));
    }
  }
  softClip(normalize(x, 1), 1.4);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.25);
}

function flamerLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = normalize(bp(white(len, rng), 3000, 0.5), 0.5);   // gas jet hiss
    const roar = lp(brown(len, rng), 500);
    let fl = 0;
    for (let i = 0; i < len; i++) { fl = fl * 0.996 + rng.bi() * 0.03; roar[i] = roar[i]! * (0.6 + 2 * Math.abs(fl)); }
    mixInto(x, normalize(roar, 0.7));
    crackles(x, rng, () => 15, 0.05, 0.2);
    return x;
  }), 0.35);
}

function flamerIgnite(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, click(4500, 0.004, rng), 0, 0.6); // piezo tick
  const w = white(at(0.8), rng);
  sweep(w, 'lp', (t) => (t < 0.06 ? 200 + 2500 * t / 0.06 : 900 + 1800 * Math.exp(-(t - 0.06) / 0.15)), 1);
  mixInto(x, normalize(envFn(w, (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.25)), 0.8), at(0.05));
  return fadeEdges(normalize(x, 0.45));
}

function flamerOff(rng: Rng): Float32Array {
  const x = alloc(0.7);
  let t = 0;
  for (let k = 0; k < 5; k++) {
    mixInto(x, normalize(bp(envAD(white(at(0.06), rng), 0.002, 0.015), 700 + 300 * rng.next(), 0.8), 0.6 * (1 - k * 0.15)), at(t));
    t += 0.05 + 0.08 * rng.next();
  }
  mixInto(x, click(1600, 0.01, rng), at(t), 0.4);
  return fadeEdges(normalize(x, 0.35));
}

function popperPop(rng: Rng): Float32Array {
  const x = alloc(1.3);
  const bang = hp(envAD(white(at(0.05), rng), 0.00005, 0.004), 300);
  mixInto(x, normalize(bang, 1));
  mixInto(x, chirp(at(0.15), glide(220, 90, 0.02), (t) => Math.exp(-t / 0.03)), 0, 0.5);
  mixInto(x, normalize(debris('paper', rng), 0.35), at(0.02));
  softClip(normalize(x, 1), 2);
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.1);
}

function fizzLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = normalize(hp(white(len, rng), 6000), 0.05);
    grains(x, rng, () => 80, (r) => normalize(bubble(0.012, 2500 + 2500 * r.next(), 0.4, 0.003), 0.1 + 0.3 * r.next()));
    return x;
  }), 0.25);
}

function jitterClink(rng: Rng): Float32Array {
  const x = modal(at(0.6), contact(0.0001, rng), [{ f: 2300 * (1 + rng.bi() * 0.04), amp: 1, tau: 0.15 }, { f: 5600, amp: 0.5, tau: 0.08 }, { f: 8700, amp: 0.3, tau: 0.04 }]);
  mixInto(x, normalize(bubble(0.08, 600 + 300 * rng.next(), 0.6, 0.02), 0.3), at(0.03));
  return fadeEdges(normalize(x, 0.3));
}

function cookLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.3, (len) => {
    const x = normalize(lp(brown(len, rng), 120), 0.15);
    for (let k = 0; k < 4; k++) mixInto(x, normalize(creak(0.3 + 0.3 * rng.next(), 35 + 30 * rng.next(), 500 + 500 * rng.next(), rng), 0.4 + 0.4 * rng.next()), at(rng.next() * (len / SR - 0.6)));
    return x;
  }), 0.3);
}

// ---- contraptions ----

function snaptrapSnap(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, normalize(modal(at(0.1), contact(0.00005, rng), [{ f: 3200, amp: 1, tau: 0.01 }, { f: 5400, amp: 0.6, tau: 0.006 }]), 0.9));
  mixInto(x, impact('wood', 2, rng), at(0.006), 0.9);
  const tw = lp(pluck(at(0.4), 240 * (1 + rng.bi() * 0.05), rng, 0.993, 0.6), 2500);
  envFn(tw, (t) => Math.exp(-t / 0.12));
  mixInto(x, normalize(tw, 0.35), at(0.01));
  const wh = white(at(0.12), rng);
  sweep(wh, 'bp', (t) => 800 + 2500 * t / 0.12, 1.2);
  mixInto(x, normalize(envFn(wh, (t) => Math.sin(Math.PI * t / 0.12)), 0.25), at(0.02));
  softClip(normalize(x, 1), 1.6);
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.05);
}

function whoosh(rng: Rng): Float32Array {
  const len = at(0.4);
  const n = white(len, rng);
  sweep(n, 'bp', (t) => 400 + 1600 * Math.sin(Math.PI * Math.min(1, t / 0.4)), 1.2);
  envFn(n, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.4)), 1.5));
  return fadeEdges(normalize(n, 0.35));
}

function bonk(rng: Rng): Float32Array {
  const x = alloc(0.4);
  mixInto(x, normalize(modal(x.length, contact(0.002, rng, 0.1), [{ f: 210 * (1 + rng.bi() * 0.05), amp: 1, tau: 0.05 }, { f: 520, amp: 0.5, tau: 0.03 }, { f: 1150, amp: 0.25, tau: 0.015 }]), 0.9));
  mixInto(x, impact('rubber', 2, rng), 0, 0.6);
  mixInto(x, chirp(at(0.15), glide(320, 170, 0.03), (t) => Math.exp(-t / 0.05)), 0, 0.4);
  return fadeEdges(normalize(x, 0.5));
}

function flingerRelease(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, click(2200, 0.008, rng), 0, 0.6);
  mixInto(x, whoosh(rng), at(0.02), 1.2);
  mixInto(x, impact('rubber', 2, rng), at(0.22), 0.9);
  mixInto(x, impact('wood', 1, rng), at(0.225), 0.5);
  const tw = lp(pluck(at(0.5), 110 * (1 + rng.bi() * 0.05), rng, 0.995, 0.6), 2000);
  envFn(tw, (t) => Math.exp(-t / 0.18));
  mixInto(x, normalize(tw, 0.4), at(0.22));
  return fadeEdges(normalize(x, 0.5));
}

function chainCreakLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.3, (len) => {
    const x = new Float32Array(len);
    for (let k = 0; k < 3; k++) mixInto(x, normalize(creak(0.4, 50, 650 + 150 * rng.next(), rng), 0.5 + 0.3 * rng.next()), at(k * 1 + 0.3 * rng.next()));
    grains(x, rng, () => 6, (r) => normalize(click(3500 + r.bi() * 300, 0.003, r), 0.1 + 0.2 * r.next()));
    return x;
  }), 0.3);
}

function swingAirLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = lp(white(len, rng), 900);
    mixInto(x, normalize(bp(white(len, rng), 500, 0.8), 0.6));
    for (let i = 0; i < len; i++) x[i] = x[i]! * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * i / SR));
    return x;
  }), 0.3);
}

function wreckerHit(rng: Rng): Float32Array {
  const x = alloc(1.6);
  mixInto(x, normalize(modal(x.length, contact(0.004, rng, 0.5), [
    { f: 95, amp: 1, tau: 0.5 }, { f: 260, amp: 0.7, tau: 0.3 }, { f: 610, amp: 0.5, tau: 0.2 }, { f: 1180, amp: 0.3, tau: 0.1 },
  ]), 0.8));
  mixInto(x, chirp(at(0.5), glide(90, 40, 0.06), (t) => Math.exp(-t / 0.15)), 0, 0.8);
  mixInto(x, normalize(debris('brick', rng), 0.3), at(0.02));
  softClip(normalize(x, 1), 1.4);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.2);
}

function pingerRelease(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, click(2600, 0.006, rng), 0, 0.5);
  mixInto(x, chirp(at(0.5), (t) => (900 - 300 * Math.min(1, t / 0.2)) * (1 + 0.05 * Math.sin(2 * Math.PI * 30 * t) * Math.exp(-t / 0.2)), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.12)));
  const coil = modal(x.length, contact(0.0003, rng), [{ f: 2800, amp: 0.5, tau: 0.12 }, { f: 3900, amp: 0.4, tau: 0.09 }]);
  mixInto(x, normalize(coil, 0.3));
  return fadeEdges(normalize(x, 0.4));
}

function pingerThock(rng: Rng): Float32Array {
  const x = modal(at(0.3), contact(0.0008, rng), [{ f: 600, amp: 1, tau: 0.02 }, { f: 1500, amp: 0.5, tau: 0.012 }]);
  mixInto(x, impact('poly', 2, rng), 0, 0.6);
  return fadeEdges(normalize(x, 0.45));
}

function paddleFlip(rng: Rng): Float32Array {
  const x = alloc(0.3);
  const buzz = chirp(at(0.03), () => 120, () => 1);
  for (let i = 0; i < buzz.length; i++) buzz[i] = Math.tanh(4 * buzz[i]!);
  mixInto(x, normalize(buzz, 0.3));
  mixInto(x, impact('poly', 2, rng), at(0.02), 0.9);
  mixInto(x, click(2600, 0.006, rng), at(0.02), 0.5);
  return fadeEdges(normalize(x, 0.45));
}

function paddleHit(rng: Rng): Float32Array {
  const x = impact('rubber', 2, rng);
  mixInto(x, normalize(bp(envAD(white(at(0.06), rng), 0.0003, 0.015), 1500, 0.8), 0.4));
  return fadeEdges(normalize(x, 0.45));
}

function bumperPop(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, normalize(modal(at(0.3), contact(0.002, rng), [{ f: 160, amp: 1, tau: 0.05 }, { f: 410, amp: 0.5, tau: 0.03 }]), 0.8));
  mixInto(x, normalize(modal(at(0.85), contact(0.00008, rng), [{ f: 1568, amp: 1, tau: 0.45 }, { f: 3910, amp: 0.35, tau: 0.18 }, { f: 6300, amp: 0.15, tau: 0.06 }]), 0.5), at(0.005));
  mixInto(x, impact('rubber', 1, rng), 0, 0.4);
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.1);
}

// ---- fun ----

function pinHit(tier: number, rng: Rng): Float32Array {
  const f0 = 1050 * (1 + rng.bi() * 0.05);
  const w = [0.0012, 0.0006, 0.00025][tier]!;
  const x = modal(at(0.3), contact(w, rng, 0.15), [
    { f: f0, amp: 1, tau: 0.05 }, { f: f0 * 2.3, amp: 0.6, tau: 0.03 }, { f: f0 * 3.9, amp: 0.35, tau: 0.02 }, { f: f0 * 5.6, amp: 0.2, tau: 0.012 },
  ]);
  normalize(x, 1);
  mixInto(x, normalize(bp(envAD(white(at(0.04), rng), 0.0003, 0.008), 3000, 0.8), 0.3 + 0.2 * tier));
  if (tier === 0) lp(x, 3500);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.02);
}

function pinsStrike(rng: Rng): Float32Array {
  const x = alloc(1.5);
  const toks = [0, 1, 2, 3, 4].map((k) => pinHit(k % 3, rng));
  grains(x, rng, (t) => 70 * Math.exp(-t / 0.3), (r, t) => normalize(toks[r.int(5)]!.slice(), (0.3 + 0.7 * r.next()) * Math.exp(-t / 0.8)));
  for (let k = 0; k < 4; k++) mixInto(x, impact('wood', 1, rng), at(0.15 + 0.4 * rng.next()), 0.3);
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.15);
}

function sting(notes: readonly number[], step: number): Float32Array {
  const x = alloc(step * notes.length + 0.6);
  notes.forEach((m, k) => {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const n = tone(at(0.6), () => f, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.18), [0.3, 0.12]);
    mixInto(x, n, at(k * step), k === notes.length - 1 ? 1 : 0.8);
  });
  return fadeEdges(normalize(x, 0.3), 0.0005, 0.08);
}

function blockHit(tier: number, rng: Rng): Float32Array {
  const f0 = 1250 * (1 + rng.bi() * 0.06);
  const w = [0.0015, 0.0007, 0.0003][tier]!;
  const x = modal(at(0.25), contact(w, rng, 0.2), [{ f: f0, amp: 1, tau: 0.035 }, { f: f0 * 2.2, amp: 0.55, tau: 0.02 }, { f: f0 * 3.6, amp: 0.3, tau: 0.012 }]);
  normalize(x, 1);
  mixInto(x, normalize(bp(envAD(white(at(0.03), rng), 0.0003, 0.006), 2500, 0.8), 0.3 + 0.15 * tier));
  if (tier === 0) lp(x, 3000);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.02);
}

function towerCollapse(rng: Rng): Float32Array {
  const x = alloc(1.7);
  const toks = [0, 1, 2, 3].map((k) => blockHit(k % 3, rng));
  grains(x, rng, (t) => (t < 0.1 ? 40 + 400 * t : 80 * Math.exp(-(t - 0.1) / 0.4)), (r, t) => normalize(toks[r.int(4)]!.slice(), (0.3 + 0.7 * r.next()) * Math.exp(-t / 1)));
  for (let k = 0; k < 5; k++) mixInto(x, impact('wood', 2, rng), at(0.2 + 0.8 * rng.next()), 0.25);
  return fadeEdges(normalize(x, 0.5), 0.001, 0.15);
}

function paneShatter(rng: Rng): Float32Array {
  const x = alloc(2.6);
  mixInto(x, normalize(crack(rng), 0.9));
  mixInto(x, impact('glass', 2, rng), 0, 0.7);
  const toks = [0, 1, 2, 3, 4, 5].map((k) => impact('glass', k % 2, rng));
  grains(x, rng, (t) => (t < 0.02 ? 0 : 110 * Math.exp(-(t - 0.02) / 0.5)), (r, t) => normalize(toks[r.int(6)]!.slice(), (0.15 + 0.85 * r.next()) * Math.exp(-t / 1.1) * 0.5));
  mixInto(x, normalize(envAD(hp(white(at(1.2), rng), 6000), 0.002, 0.35), 0.12));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.3);
}

function vaseShatter(rng: Rng): Float32Array {
  const x = alloc(1.8);
  mixInto(x, impact('brick', 2, rng), 0, 0.7);
  mixInto(x, impact('glass', 2, rng), 0, 0.6);
  mixInto(x, normalize(crack(rng), 0.6));
  grains(x, rng, (t) => 80 * Math.exp(-t / 0.35), (r, t) => normalize(modal(at(0.2), contact(0.0002, r), [{ f: 1800 + 1700 * r.next(), amp: 1, tau: 0.05 }, { f: 4200 + 2000 * r.next(), amp: 0.4, tau: 0.02 }]), (0.2 + 0.8 * r.next()) * Math.exp(-t / 0.8) * 0.4));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.2);
}

function shardSettle(rng: Rng): Float32Array {
  const x = alloc(1.8);
  const toks = [0, 1, 2].map(() => impact('glass', 0, rng));
  grains(x, rng, (t) => 25 * Math.exp(-t / 0.6), (r) => normalize(toks[r.int(3)]!.slice(), 0.1 + 0.3 * r.next()));
  return fadeEdges(normalize(x, 0.25), 0.001, 0.1);
}

/** Tonebar at C6 (MIDI 84), re-pitched by playbackRate. Metal: glockenspiel bar modes; wood: marimba. */
function tonebar(skin: 'metal' | 'wood', tier: number, rng: Rng): Float32Array {
  const f = 1046.5;
  const w = [0.0012, 0.0006, 0.00025][tier]!;
  const bright = [0.5, 1, 1.5][tier]!;
  const modes: Mode[] = skin === 'metal'
    ? [{ f, amp: 1, tau: 1.6 }, { f: f * 2.756, amp: 0.35 * bright, tau: 0.5 }, { f: f * 5.404, amp: 0.18 * bright, tau: 0.2 }, { f: f * 8.933, amp: 0.07 * bright, tau: 0.08 }]
    : [{ f, amp: 1, tau: 0.55 }, { f: f * 3.99, amp: 0.3 * bright, tau: 0.12 }, { f: f * 9.2, amp: 0.1 * bright, tau: 0.04 }];
  const x = modal(at(skin === 'metal' ? 2.4 : 1.3), contact(w, rng), modes);
  normalize(x, 1);
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0001, 0.0015), 3000), 0.04 * (tier + 1)));
  return fadeEdges(normalize(x, [0.28, 0.38, 0.5][tier]!), 0.0001, 0.15);
}

/** Desk bell at C7 (MIDI 96): a beating doubled fundamental, inharmonic shell modes, a sharp clapper tick. */
function bellStrike(tier: number, rng: Rng): Float32Array {
  const f = 2093;
  const w = [0.0004, 0.0002, 0.0001][tier]!;
  const x = modal(at(3), contact(w, rng), [
    { f, amp: 1, tau: 2.4 }, { f: f * 1.0015, amp: 0.7, tau: 2.2 }, { f: f * 2.32, amp: 0.45, tau: 1.0 }, { f: f * 3.7, amp: 0.25 * (tier + 1) / 2, tau: 0.5 }, { f: f * 5.3, amp: 0.12 * (tier + 1) / 2, tau: 0.25 },
  ]);
  normalize(x, 1);
  mixInto(x, click(5200, 0.004, rng), 0, 0.2 + 0.1 * tier);
  return fadeEdges(normalize(x, [0.3, 0.4, 0.5][tier]!), 0.0001, 0.3);
}

function bellDunk(rng: Rng): Float32Array {
  const x = modal(at(0.3), contact(0.0015, rng), [{ f: 2093, amp: 0.5, tau: 0.05 }, { f: 900, amp: 1, tau: 0.03 }]);
  mixInto(x, lp(impact('steel', 0, rng), 2500), 0, 0.5);
  return fadeEdges(normalize(x, 0.35));
}

// ---- future tech ----

function fabSpawn(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, tone(at(0.26), (t) => 500 + 1200 * t, (t) => 0.4 * Math.sin(Math.PI * t / 0.26), [0.5, 0.25]));
  for (let k = 0; k < 3; k++) mixInto(x, beep(at(0.025), 1500 + 700 * rng.next(), 3), at(0.04 + k * 0.06), 0.25);
  const p = hp(envAD(white(at(0.05), rng), 0.0001, 0.006), 400);
  mixInto(x, normalize(p, 0.8), at(0.27));
  mixInto(x, chirp(at(0.2), glide(260, 120, 0.03), (t) => Math.exp(-t / 0.04)), at(0.27), 0.5);
  return fadeEdges(normalize(x, 0.45));
}

function fabHumLoop(): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    x[i] = Math.sin(2 * Math.PI * 110 * t) + 0.4 * Math.sin(2 * Math.PI * 330 * t) + 0.08 * Math.sin(2 * Math.PI * 2200 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t));
  }
  return normalize(x, 0.25);
}

function gulp(size: 0 | 1 | 2, rng: Rng): Float32Array {
  const k = [1.5, 1, 0.65][size]!, dur = [0.3, 0.45, 0.65][size]!;
  const x = alloc(dur + 0.15);
  const n = white(at(dur), rng);
  sweep(n, 'bp', (t) => (2500 - 2100 * Math.min(1, t / dur)) * k, 1.5);
  mixInto(x, normalize(envFn(n, (t) => Math.sin(Math.PI * Math.min(1, t / dur))), 0.6));
  mixInto(x, normalize(bubble(dur * 0.8, 130 * k, 0.8, dur * 0.3), 0.8), at(dur * 0.2));
  mixInto(x, click(2600, 0.006, rng), at(dur), 0.5);
  return fadeEdges(normalize(x, 0.45));
}

function zoneLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.3, (len) => {
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / SR; x[i] = Math.sin(2 * Math.PI * 55 * t) + 0.5 * Math.sin(2 * Math.PI * 110.3 * t) + 0.25 * Math.sin(2 * Math.PI * 165.2 * t); }
    normalize(x, 0.7);
    const air = bp(white(len, rng), 900, 0.7);
    for (let i = 0; i < len; i++) air[i] = air[i]! * (0.5 + 0.5 * Math.sin(2 * Math.PI * i / SR / 3));
    mixInto(x, normalize(air, 0.25));
    return x;
  }), 0.25);
}

// ---- spectacle ----

function spectReturn(rng: Rng): Float32Array {
  const len = at(0.5);
  const n = white(len, rng);
  sweep(n, 'bp', (t) => 300 + 3000 * Math.pow(t / 0.5, 2), 1.2);
  envFn(n, (t) => Math.pow(t / 0.5, 2));
  const x = normalize(n, 0.6);
  mixInto(x, chirp(len, (t) => 200 + 600 * Math.pow(t / 0.5, 2), (t) => 0.3 * Math.pow(t / 0.5, 2)));
  return fadeEdges(normalize(x, 0.3), 0.01, 0.01);
}

export function m3Recipes(): Recipe[] {
  const r: Recipe[] = [
    ['lanceCharge', 1, lanceCharge], ['loop/lance', 1, () => lanceLoop()], ['loop/burn', 1, burnLoop], ['burnFlare', 2, burnFlare], ['lanceOff', 1, lanceOff],
    ['opticTing', 3, opticTing], ['loop/prism', 1, prismLoop], ['tripArm', 1, () => tripArm()], ['tripChirp', 2, tripChirp], ['pingTx', 2, pingTx], ['pingRx', 2, pingRx],
    ['magOn', 2, magOn], ['loop/maghum', 1, () => magHumLoop()], ['magClack', 3, magClack], ['magRelease', 2, magRelease],
    ['loop/marble/wood', 1, (g) => marbleLoop('wood', g)], ['loop/marble/steel', 1, (g) => marbleLoop('steel', g)], ['loop/marble/glass', 1, (g) => marbleLoop('glass', g)],
    ['loop/rail', 1, (g) => marbleLoop('rail', g)], ['marbleClick', 4, marbleClick], ['boostZip', 2, boostZip],
    ['loop/spindeck', 1, spindeckLoop], ['deckClunk', 2, (g) => heavyClunk(g, 120)], ['loop/liftmotor', 1, liftMotorLoop], ['liftClunk', 2, (g) => heavyClunk(g, 90)],
    ['liftChime', 1, () => liftChime()], ['loop/ratchet', 1, ratchetLoop], ['rackThunk', 2, rackThunk], ['ramFire', 3, ramFire], ['ramHiss', 2, ramHiss],
    ['shellLift', 3, shellLift], ['shellWhistle', 2, shellWhistle],
    ['burst/boom', 3, (g) => aerial(g, 'boom')], ['burst/crackle', 2, (g) => aerial(g, 'crackle')], ['burst/hiss', 2, (g) => aerial(g, 'hiss')], ['burst/pops', 2, (g) => aerial(g, 'pops')],
    ['loop/flamer', 1, flamerLoop], ['flamerIgnite', 2, flamerIgnite], ['flamerOff', 2, flamerOff], ['popperPop', 4, popperPop],
    ['loop/fizz', 1, fizzLoop], ['jitterClink', 3, jitterClink], ['loop/cook', 1, cookLoop],
    ['snaptrapSnap', 4, snaptrapSnap], ['whoosh', 3, whoosh], ['bonk', 4, bonk], ['flingerRelease', 3, flingerRelease],
    ['loop/chaincreak', 1, chainCreakLoop], ['loop/swingair', 1, swingAirLoop], ['wreckerHit', 3, wreckerHit],
    ['pingerRelease', 3, pingerRelease], ['pingerThock', 2, pingerThock], ['paddleFlip', 3, paddleFlip], ['paddleHit', 3, paddleHit], ['bumperPop', 4, bumperPop],
    ['pinsStrike', 2, pinsStrike], ['pinsSting', 1, () => sting([72, 76, 79, 84], 0.07)], ['towerCollapse', 2, towerCollapse],
    ['paneShatter', 3, paneShatter], ['vaseShatter', 3, vaseShatter], ['shardSettle', 2, shardSettle],
    ['dingDunk', 2, bellDunk],
    ['fabSpawn', 3, fabSpawn], ['loop/fabhum', 1, () => fabHumLoop()], ['recyclerTick', 1, () => fadeEdges(normalize(lp(beep(at(0.05), 1760), 5000), 0.2))],
    ['recyclerGoal', 1, () => sting([72, 76, 79, 84, 88], 0.09)], ['loop/zone', 1, zoneLoop],
    ['spect/return', 1, spectReturn],
  ];
  const TIER = ['soft', 'med', 'hard'] as const;
  for (let t = 0; t < 3; t++) {
    r.push([`pin/${TIER[t]}`, 4, (g) => pinHit(t, g)], [`block/${TIER[t]}`, 4, (g) => blockHit(t, g)]);
    r.push([`tonebar/metal/${TIER[t]}`, 2, (g) => tonebar('metal', t, g)], [`tonebar/wood/${TIER[t]}`, 2, (g) => tonebar('wood', t, g)]);
    r.push([`ding/${TIER[t]}`, 3, (g) => bellStrike(t, g)]);
  }
  for (let s = 0; s < 3; s++) r.push([`gulp/${['s', 'm', 'l'][s]}`, 2, (g) => gulp(s as 0 | 1 | 2, g)]);
  return r;
}

// ============================================================================================
// director
// ============================================================================================

/** Canonical M3 type names (brief ids; aliases cover the names A3 might pick). */
const ALIAS: Readonly<Record<string, string>> = {
  glint: 'marble', bearing: 'marble', pins: 'pin', stackers: 'stacker', tonebar: 'tonebars', mirror: 'mirror_splitter', splitter: 'mirror_splitter',
  keg: 'powder_keg', ping_tx: 'ping', ping_rx: 'ping', bumpers: 'bumper', paddles: 'paddle',
};
export const canonType = (t: string | undefined): string => (t ? ALIAS[t] ?? (t.startsWith('zone') ? 'zone' : t) : '');

export const M3_TYPES: ReadonlySet<string> = new Set([
  'lance', 'mirror_splitter', 'tripwire', 'ping', 'maglock', 'marble', 'spindeck', 'lift', 'rack', 'ram',
  'powder_keg', 'jitterjuice', 'skyshow', 'flamer', 'popper', 'snaptrap', 'bonker', 'flinger', 'wrecker', 'pinger', 'paddle', 'bumper',
  'pin', 'stacker', 'pane', 'vase', 'tonebars', 'ding', 'fabricator', 'recycler', 'zone',
]);
/** True for any type m3.ts voices (with aliases). */
export const isM3 = (t: string | undefined): boolean => M3_TYPES.has(canonType(t));
/** M3 types that need per-frame part() state (loops, edges, motion); the rest are event-only. */
const STATEFUL = new Set(['lance', 'mirror_splitter', 'tripwire', 'maglock', 'spindeck', 'lift', 'rack', 'ram', 'powder_keg', 'jitterjuice', 'skyshow',
  'flamer', 'wrecker', 'paddle', 'fabricator', 'zone']);

/** Surface materials a marble can roll on (the nearest part under it), by type. */
const SURFACE: Readonly<Record<string, Surf>> = {
  plank: 'wood', slope: 'wood', ledge: 'wood', fulcrum: 'wood', stacker: 'wood', treadway: 'wood', flap: 'wood', sprong: 'wood', vortex: 'wood', vortex_slim: 'wood',
  paddle: 'wood', snaptrap: 'wood', pane: 'glass', mirror_splitter: 'glass', suncell: 'glass', fishbowl: 'glass',
  tonebars: 'steel', trap_box: 'steel', spindeck: 'steel', lift: 'steel', scoop: 'steel', rack: 'steel', maglock: 'steel', big_top: 'steel',
};
/** Raw part types observe() looks at (a set lookup, so 100k Topple Tiles cost almost nothing). */
const OBSERVED: ReadonlySet<string> = new Set([...Object.keys(SURFACE), 'recycler', 'fabricator']);
/** Environment floor (and bench) material for the marble roll. */
const FLOOR: Readonly<Record<string, Surf>> = { tinker: 'wood', studio: 'wood', kitchen: 'glass' };

/** Rough masses for Recycler gulp sizes (kg). */
const MASS: Readonly<Record<string, number>> = {
  marble: 0.01, stitch: 0.15, fuzz: 0.06, boing: 0.6, thud: 7, pig_iron: 6.5, helio: 0.08, topple_tile: 0.2, pin: 0.15, stacker: 0.3, brik: 3.6, plank: 6, bangstick: 0.8,
};

const SKYSHOW_PATTERNS = ['boom', 'crackle', 'hiss', 'boom', 'hiss', 'pops', 'boom', 'boom', 'crackle'] as const; // peony, chrysanthemum, willow, ring, palm, crossette, heart, starburst, glitter

interface PState {
  type: string; flags: number; meter: number; seen: number;
  motion: Motion; arm: Motion | null; rot: readonly [number, number, number, number] | null; spin: number;
  moving: boolean; movedAt: number; peakV: number;
}

interface Pending { id: number; at: number; pos: Vec3; J: number; type: string }

const TIER_NAME = ['soft', 'med', 'hard'] as const;
const tierOf = (J: number, lo: number, hi: number): 0 | 1 | 2 => (J < lo ? 0 : J < hi ? 1 : 2);

export interface WorldKey { root: number; scale: readonly number[] }
export const SCALES: Readonly<Record<string, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9],
};

export class Gadgets {
  private readonly parts = new Map<number, PState>();
  private readonly recent = new Map<string, number>();
  private readonly rollers = new Map<string, { m: Motion; vHist: [number, number][]; boostAt: number }>();
  private readonly grid = new Map<string, Map<number, { s: Surf; pos: Vec3 }>>();
  private readonly cell = new Map<number, string>();
  private readonly recyclers = new Map<number, Vec3>();
  private readonly fabricators = new Map<number, Vec3>();
  private readonly pending: Pending[] = [];
  private readonly lastJ = new Map<number, { J: number; t: number }>();
  private bursts: { id: number; at: number; pos: Vec3; n: number }[] = [];
  private pinHits: number[] = [];
  private blockHits: number[] = [];
  private lastStrike = -10;
  private lastCollapse = -10;
  private pingLast = { t: -10, id: -1 };
  private shells = new Map<number, number>();
  private glide: { pts: readonly Vec3[] }[] = [];
  private floor: Surf = 'wood';
  key: WorldKey = { root: 0, scale: SCALES.major! };

  constructor(private readonly h: AudioHost) {}

  reset(): void {
    this.parts.clear(); this.recent.clear(); this.rollers.clear(); this.grid.clear(); this.cell.clear();
    this.recyclers.clear(); this.fabricators.clear(); this.pending.length = 0; this.lastJ.clear(); this.bursts = [];
    this.pinHits = []; this.blockHits = []; this.shells.clear();
  }

  setEnvironment(env: string): void { this.floor = FLOOR[env] ?? 'wood'; }
  setPaths(paths: readonly { kind: string; pts: readonly Vec3[] }[]): void {
    this.glide = paths.filter((p) => /glide/.test(p.kind) && p.pts.length > 1).map((p) => ({ pts: p.pts }));
  }

  private cue(id: number, name: string, var01: number, pos: Vec3, when: number, gain: number, x: { rate?: number; prio?: number; family?: 'mech' | 'fx' | 'impact' | 'pyro'; maxDist?: number } = {}): void {
    this.recent.set(`${id}:${name}`, this.h.now());
    const o: Parameters<AudioHost['play']>[2] = { family: x.family ?? 'mech', pos, when, gain: clamp(gain, 0, 1.2), key: name };
    if (x.rate !== undefined) o.rate = x.rate;
    if (x.prio !== undefined) o.prio = x.prio;
    if (x.maxDist !== undefined) o.maxDist = x.maxDist;
    this.h.play(name, var01, o);
  }
  private fresh(id: number, name: string, within = 0.3): boolean { return this.h.now() - (this.recent.get(`${id}:${name}`) ?? -10) < within; }

  /** MIDI note for a Note magnitude: ≥ 24 is MIDI, else a world-key scale degree up from octave 5. */
  noteMidi(mag: number): number {
    if (mag >= 24) return Math.round(clamp(mag, 24, 120));
    const sc = this.key.scale, d = Math.max(0, Math.round(mag));
    return 72 + this.key.root + sc[d % sc.length]! + 12 * Math.floor(d / sc.length);
  }

  // ---- events ----

  /** Returns true when handled (the M2/M1 paths then skip it). */
  event(e: SimEventLike, rawType: string | undefined, when: number, var01: number, typeOf: (id: number) => string | undefined): boolean {
    const t = canonType(rawType);
    const k = e.kind, id = e.part, p = e.pos;
    const now = this.h.now();
    // events whose subject isn't the M3 part: Spawn from a Fabricator, Despawn into a Recycler, Boost on a Glidepath
    if (k === 'Spawn' && t !== 'fabricator') {
      const fab = this.near(this.fabricators, p, 0.8, e.other !== undefined && canonType(typeOf(e.other)) === 'fabricator' ? e.other : undefined);
      if (fab !== undefined) { this.fabSpawn(fab, p, when, var01, rawType); return true; }
      return false;
    }
    if (k === 'Despawn' && t !== 'recycler') {
      const rec = this.near(this.recyclers, p, 0.8, e.other !== undefined && canonType(typeOf(e.other)) === 'recycler' ? e.other : undefined);
      if (rec !== undefined) { this.gulp(rec, this.recyclers.get(rec) ?? p, when, var01, rawType); return true; }
      return false;
    }
    if (k === 'Boost') { this.cue(id, 'boostZip', var01, p, when, clamp(0.4 + e.mag / 10, 0.4, 0.8), { family: 'fx' }); return true; }
    if (k === 'PinsAllDown' || (k === 'Strike' && (t === 'pin' || !t))) { this.cue(id, 'pinsSting', var01, p, when + 0.3, 0.45, { family: 'fx' }); return true; }
    if (!M3_TYPES.has(t)) return false;
    const J = Math.max(0, Number.isFinite(e.mag) ? e.mag : 0);
    if (k === 'Impact') this.lastJ.set(id, { J, t: now });
    const trigger = k === 'Signal' || k === 'Launch' || k === 'Press' || k === 'Toggle' || k === 'Fire' || k === 'Snap' || k === 'Trigger' || k === 'Extend';
    switch (t) {
      case 'lance':
        if (k === 'Lit' || k === 'Powered') { if (!this.fresh(id, 'lanceCharge')) this.cue(id, 'lanceCharge', var01, p, when, 0.4); return true; }
        if (k === 'Unlit' || k === 'Unpowered') { this.cue(id, 'lanceOff', var01, p, when, 0.35); return true; }
        if (k === 'Ignite' || k === 'Cut' || k === 'Burn' || k === 'Heat') { this.cue(id, 'burnFlare', var01, p, when, 0.5, { family: 'fx' }); return true; }
        return false;
      case 'mirror_splitter':
        if (k === 'Lit') { this.cue(id, 'opticTing', var01, p, when, 0.35); return true; }
        return k === 'Unlit';
      case 'tripwire':
        if (k === 'Lit') { this.cue(id, 'tripArm', var01, p, when, 0.3); return true; }
        if (k === 'Signal' || k === 'Trigger' || k === 'Trip') { // Trip: A3's kind (M3_NOTES_A3)
          if (this.fresh(id, 'tripChirp', 0.05)) return true; // Trip and its out-pulse Signal on the same tick
          this.cue(id, 'tripChirp', var01, p, when, 0.45);
          this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.25, rate: 1.1 });
          this.h.heat(0.02);
          return true;
        }
        return k === 'Unlit';
      case 'ping': {
        if (k === 'Signal' || k === 'Send' || k === 'Receive' || k === 'PingTx' || k === 'PingRx') {
          // a pair: the first ping to signal is the sender, a different ping within 150 ms is the receiver
          const rx = k === 'Receive' || k === 'PingRx' || (k === 'Signal' && now - this.pingLast.t < 0.15 && this.pingLast.id !== id);
          const pair = 0.92 + 0.16 * hash01(hashStr(`ping${Math.round(e.mag)}`));
          this.cue(id, rx ? 'pingRx' : 'pingTx', var01, p, when + (rx ? 0.02 : 0), 0.4, { rate: pair });
          if (!rx) this.pingLast = { t: now, id };
          this.h.heat(0.02);
          return true;
        }
        return false;
      }
      case 'maglock':
        if (k === 'Powered' || (k === 'Toggle' && e.mag > 0)) { this.cue(id, 'magOn', var01, p, when, 0.55); return true; }
        if (k === 'Unpowered' || (k === 'Toggle' && e.mag <= 0) || k === 'Release') { this.cue(id, 'magRelease', var01, p, when, 0.4); return true; }
        if (k === 'Attach' || k === 'Grab' || k === 'Latch' || (k === 'Impact' && J >= 0.3)) { this.cue(id, 'magClack', var01, p, when, clamp(0.35 + J / 10, 0.35, 0.8), { family: 'impact' }); return true; }
        return false;
      case 'marble':
        if (k === 'Impact' && e.other !== undefined && canonType(typeOf(e.other)) === 'marble') {
          this.cue(id, 'marbleClick', var01, p, when, clamp(0.15 + J * 2, 0.15, 0.6), { family: 'impact', rate: 0.9 + 0.2 * var01 });
          return true;
        }
        return false;
      case 'spindeck':
        if (k === 'Powered' || k === 'Unpowered') { this.cue(id, 'deckClunk', var01, p, when, 0.45, { rate: k === 'Powered' ? 1 : 0.9 }); return true; }
        return false;
      case 'lift':
        if (k === 'Powered' || k === 'Unpowered') { this.cue(id, 'liftClunk', var01, p, when, 0.5, { rate: k === 'Powered' ? 1 : 0.92 }); return true; }
        if (k === 'Arrive' || k === 'Arrived') { this.cue(id, 'liftChime', var01, p, when, 0.4); return true; }
        return false;
      case 'rack': return false;
      case 'ram':
        if (k === 'Retract' || (k === 'Toggle' && e.mag <= 0) || k === 'Unpowered') { this.cue(id, 'ramHiss', var01, p, when, 0.45); return true; }
        if (trigger || k === 'Powered') { this.cue(id, 'ramFire', var01, p, when, 0.65, { family: 'fx' }); this.h.heat(0.03); return true; }
        return false;
      case 'powder_keg': case 'jitterjuice':
        if ((k === 'Impact' && t === 'jitterjuice' && J < 0.15) || k === 'Jostle') { this.cue(id, 'jitterClink', var01, p, when, clamp(0.2 + J * 3, 0.2, 0.5)); return true; }
        if (k === 'Cook') return true; // the cook-creak loop follows the lit flag
        return false; // Detonate goes to pyro.ts; Ignite / FuseLit to the M1 cues
      case 'skyshow': {
        if (k === 'Launch' || k === 'Shell') {
          const n = (this.shells.get(id) ?? 0) + 1;
          this.shells.set(id, n);
          this.cue(id, 'shellLift', var01, p, when, 0.7, { family: 'fx', prio: 1.3 });
          this.cue(id, 'shellWhistle', var01, p, when + 0.05, 0.3, { family: 'fx' });
          // the burst follows ~1.5 s later unless the sim reports it itself
          this.bursts.push({ id, at: when + 1.5, pos: [p[0], p[1] + 12, p[2]], n });
          this.h.heat(0.08);
          return true;
        }
        if (k === 'Burst' || k === 'Detonate' || k === 'Pop') {
          const i = this.bursts.findIndex((b) => b.id === id);
          const n = i >= 0 ? this.bursts[i]!.n : (this.shells.get(id) ?? 0);
          if (i >= 0) this.bursts.splice(i, 1);
          const pat = Number.isInteger(e.mag) && e.mag >= 0 && e.mag < 9 ? e.mag : n % 9;
          this.burst(id, p, when, var01, pat);
          return true;
        }
        return false;
      }
      case 'flamer':
        if (k === 'Lit' || k === 'Ignite' || (k === 'Toggle' && e.mag > 0)) { if (!this.fresh(id, 'flamerIgnite')) this.cue(id, 'flamerIgnite', var01, p, when, 0.6, { family: 'fx' }); return true; }
        if (k === 'Unlit' || k === 'Extinguish' || (k === 'Toggle' && e.mag <= 0)) { if (!this.fresh(id, 'flamerOff')) this.cue(id, 'flamerOff', var01, p, when, 0.45); return true; }
        return k === 'Signal';
      case 'popper':
        if (k === 'Pop' || k === 'Launch' || k === 'Detonate' || k === 'Fire' || k === 'Burst' || k === 'Confetti') {
          if (!this.fresh(id, 'popperPop', 0.2)) this.cue(id, 'popperPop', var01, p, when, 0.75, { family: 'fx', prio: 1.3 });
          this.h.heat(0.05);
          return true;
        }
        return false;
      case 'snaptrap':
        if (trigger) { if (!this.fresh(id, 'snaptrapSnap', 0.2)) this.cue(id, 'snaptrapSnap', var01, p, when, 0.75, { family: 'fx', prio: 1.3 }); this.h.heat(0.04); return true; }
        return false;
      case 'bonker':
        if (trigger) { if (!this.fresh(id, 'whoosh', 0.2)) this.cue(id, 'whoosh', var01, p, when, 0.4, { rate: 1.1 }); return true; }
        if (k === 'Impact' && J >= 0.4) { this.cue(id, 'bonk', var01, p, when, clamp(0.35 + Math.log10(1 + J) * 0.4, 0.35, 0.9), { family: 'impact', rate: 0.95 + 0.1 * var01 }); this.h.heat(0.02); return true; }
        return false;
      case 'flinger':
        if (trigger) { if (!this.fresh(id, 'flingerRelease', 0.3)) this.cue(id, 'flingerRelease', var01, p, when, 0.7, { family: 'fx' }); this.h.heat(0.04); return true; }
        return false;
      case 'wrecker':
        if (k === 'Impact' && J >= 1) { this.cue(id, 'wreckerHit', var01, p, when, clamp(0.4 + Math.log10(1 + J) * 0.3, 0.4, 1), { family: 'fx', prio: 1.6 }); this.h.heat(0.08); return true; }
        return false;
      case 'pinger':
        if (trigger) { if (!this.fresh(id, 'pingerRelease', 0.2)) this.cue(id, 'pingerRelease', var01, p, when, 0.55); return true; }
        if (k === 'Impact' && J >= 0.5) { this.cue(id, 'pingerThock', var01, p, when, clamp(0.3 + J / 10, 0.3, 0.8), { family: 'impact' }); return true; }
        return false;
      case 'paddle':
        if (trigger) {
          const back = k === 'Toggle' && e.mag <= 0;
          this.cue(id, 'paddleFlip', var01, p, when, back ? 0.25 : 0.55, { rate: back ? 1.3 : 1 });
          return true;
        }
        if (k === 'Impact' && J >= 0.5) { this.cue(id, 'paddleHit', var01, p, when, clamp(0.3 + J / 10, 0.3, 0.8), { family: 'impact' }); return true; }
        return false;
      case 'bumper':
        if (trigger || k === 'Kick' || (k === 'Impact' && J >= 0.05)) {
          if (!this.fresh(id, 'bumperPop', 0.1)) this.cue(id, 'bumperPop', var01, p, when, clamp(0.45 + J / 10, 0.45, 0.85), { family: 'fx' });
          this.h.heat(0.02);
          return true;
        }
        return false;
      case 'pin': if (k === 'Impact') { this.cluster(id, p, when, var01, J, 'pin'); return true; } return false;
      case 'stacker': if (k === 'Impact') { this.cluster(id, p, when, var01, J, 'block'); return true; } return false;
      case 'pane': case 'vase':
        if (k === 'Break' || k === 'Shatter') {
          this.cue(id, t === 'pane' ? 'paneShatter' : 'vaseShatter', var01, p, when, t === 'pane' ? 0.85 : 0.7, { family: 'fx', prio: 1.6 });
          this.cue(id, 'shardSettle', var01, p, when + (t === 'pane' ? 1.2 : 0.9), 0.35, { family: 'fx' });
          this.h.heat(0.08);
          return true;
        }
        return false;
      case 'tonebars': case 'ding': {
        if (k === 'Note') {
          const i = this.pending.findIndex((q) => q.id === id);
          const J0 = i >= 0 ? this.pending[i]!.J : (now - (this.lastJ.get(id)?.t ?? -10) < 0.1 ? this.lastJ.get(id)!.J : 1);
          if (i >= 0) this.pending.splice(i, 1);
          // Tonebars' degrees start at C5 (the 2-octave staircase); Ding's at its own octave, C7
          this.strike(id, t, p, when, var01, J0, this.noteMidi(e.mag) + (t === 'ding' && !(e.mag >= 24) ? 24 : 0));
          return true;
        }
        if (k === 'Impact' || k === 'Press') {
          if (t === 'ding' && k === 'Impact' && J < 0.25) { this.cue(id, 'dingDunk', var01, p, when, 0.35, { family: 'impact' }); return true; }
          // the sim may follow with a Note carrying the pitch: wait a moment before the fallback
          if (!this.pending.some((q) => q.id === id) && (t === 'ding' || J >= 0.02)) this.pending.push({ id, at: now + 0.05, pos: [p[0], p[1], p[2]], J: k === 'Press' ? 1 : J, type: t });
          return true;
        }
        return k === 'Sound';
      }
      case 'fabricator':
        if (k === 'Spawn') { this.fabSpawn(id, p, when, var01, undefined); return true; }
        return false;
      case 'recycler':
        if (k === 'Despawn') { this.gulp(id, p, when, var01, e.other !== undefined ? typeOf(e.other) : undefined); return true; }
        if (k === 'Signal' || k === 'Goal') { this.cue(id, 'recyclerGoal', var01, p, when, 0.4); return k === 'Goal'; }
        return false;
      case 'zone': return k !== 'Impact';
      default: return false;
    }
  }

  private near(map: Map<number, Vec3>, p: Vec3, r: number, hint: number | undefined): number | undefined {
    if (hint !== undefined) return hint;
    let best: number | undefined, bd = r;
    for (const [id, q] of map) { const d = dist(p, q); if (d < bd) { bd = d; best = id; } }
    return best;
  }

  private fabSpawn(id: number, pos: Vec3, when: number, var01: number, spawned: string | undefined): void {
    const m = MASS[canonType(spawned)] ?? 0.5;
    this.cue(id, 'fabSpawn', var01, pos, when, 0.5, { rate: clamp(1.15 - 0.08 * Math.log2(Math.max(m, 0.01) / 0.5), 0.85, 1.3) });
  }

  private gulp(id: number, pos: Vec3, when: number, var01: number, swallowed: string | undefined): void {
    const m = MASS[canonType(swallowed)] ?? 0.5;
    const size = m < 0.3 ? 's' : m < 3 ? 'm' : 'l';
    this.cue(id, `gulp/${size}`, var01, pos, when, 0.55);
    this.cue(id, 'recyclerTick', var01, pos, when + 0.3, 0.3);
  }

  private burst(id: number, pos: Vec3, when: number, var01: number, pattern: number): void {
    const kind = SKYSHOW_PATTERNS[pattern % 9]!;
    this.cue(id, `burst/${kind}`, var01, pos, when, 0.85, { family: 'pyro', prio: 1.6, maxDist: 250 });
    this.h.heat(0.12);
  }

  private strike(id: number, t: string, pos: Vec3, when: number, var01: number, J: number, midi: number): void {
    if (t === 'tonebars') {
      const tier = tierOf(J, 0.15, 1.2);
      this.cue(id, `tonebar/metal/${TIER_NAME[tier]}`, var01, pos, when, clamp(0.35 + 0.2 * Math.log10(1 + J * 4), 0.3, 0.75), { rate: Math.pow(2, (midi - 84) / 12) });
    } else {
      const tier = tierOf(J, 0.6, 2);
      this.cue(id, `ding/${TIER_NAME[tier]}`, var01, pos, when, clamp(0.45 + 0.15 * tier, 0.45, 0.8), { family: 'fx', rate: Math.pow(2, (midi - 96) / 12), prio: 1.4 });
    }
    this.h.heat(0.03);
  }

  /** Pins and Stackers: individual knocks, or one cascade layer when ≥ 5–6 land within 150 ms. */
  private cluster(id: number, pos: Vec3, when: number, var01: number, J: number, kind: 'pin' | 'block'): void {
    const now = this.h.now();
    const hits = kind === 'pin' ? this.pinHits : this.blockHits;
    hits.push(now);
    while (hits.length && now - hits[0]! > 0.15) hits.shift();
    if (hits.length >= (kind === 'pin' ? 5 : 6)) {
      if (kind === 'pin' && now - this.lastStrike > 0.5) { this.lastStrike = now; this.cue(id, 'pinsStrike', var01, pos, when, 0.75, { family: 'fx', prio: 1.5 }); this.h.heat(0.1); }
      if (kind === 'block' && now - this.lastCollapse > 0.6) { this.lastCollapse = now; this.cue(id, 'towerCollapse', var01, pos, when, 0.7, { family: 'fx', prio: 1.4 }); this.h.heat(0.06); }
      return;
    }
    const tier = tierOf(J, 0.5, 5);
    const g = clamp(Math.log10(1 + J * (kind === 'pin' ? 4 : 5)), 0.08, 0.9);
    this.h.play(`${kind}/${TIER_NAME[tier]}`, var01, { family: 'impact', pos, when, gain: g, rate: 0.96 + 0.08 * var01, key: kind });
  }

  /** Per frame: fallback notes for Tonebars / Ding, pending Skyshow bursts. */
  update(): void {
    const now = this.h.now();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i]!;
      if (now < q.at) continue;
      this.pending.splice(i, 1);
      // no Note came: Tonebars fall back to a degree hashed from the part, Ding to the world tonic
      const midi = q.type === 'ding' ? 96 + this.key.root : this.noteMidi(Math.floor(hash01(q.id) * (this.key.scale.length * 2 + 1)));
      this.strike(q.id, q.type, q.pos, now + 0.005, hash01(q.id, Math.floor(now * 10)), q.J, midi);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      if (now < b.at - 0.03) continue;
      this.bursts.splice(i, 1);
      this.burst(b.id, b.pos, Math.max(now + 0.005, b.at), hash01(b.id, b.n), b.n % 9);
    }
    // forget parts that stopped reporting (Stop, despawn)
    if (this.parts.size > 0 && Math.floor(now * 2) !== Math.floor((now - 0.017) * 2)) {
      for (const [id, s] of this.parts) if (now - s.seen > 2) { this.parts.delete(id); this.unindex(id); this.recyclers.delete(id); this.fabricators.delete(id); }
    }
  }

  // ---- surfaces (marble roll) ----

  private key2(p: Vec3): string { return `${Math.floor(p[0] / 0.5)},${Math.floor(p[2] / 0.5)}`; }
  private index(id: number, s: Surf, pos: Vec3): void {
    const k = this.key2(pos), old = this.cell.get(id);
    if (old === k) { const e = this.grid.get(k)?.get(id); if (e) e.pos = [pos[0], pos[1], pos[2]]; return; }
    if (old !== undefined) this.grid.get(old)?.delete(id);
    let m = this.grid.get(k);
    if (!m) { m = new Map(); this.grid.set(k, m); }
    m.set(id, { s, pos: [pos[0], pos[1], pos[2]] });
    this.cell.set(id, k);
  }
  private unindex(id: number): void { const k = this.cell.get(id); if (k !== undefined) { this.grid.get(k)?.delete(id); this.cell.delete(id); } }

  /** Cheap per-part registration for surfaces and Fabricator / Recycler positions (any type, every frame). */
  observe(id: number, type: string, pos: Vec3): void {
    if (!OBSERVED.has(type)) return;
    const t = canonType(type);
    const s = SURFACE[t];
    if (s) {
      const k = this.cell.get(id);
      if (k === undefined || k !== this.key2(pos)) this.index(id, s, pos);
    }
    if (t === 'recycler') this.recyclers.set(id, [pos[0], pos[1], pos[2]]);
    else if (t === 'fabricator') this.fabricators.set(id, [pos[0], pos[1], pos[2]]);
  }

  private surfaceAt(p: Vec3): Surf | null {
    const ix = Math.floor(p[0] / 0.5), iz = Math.floor(p[2] / 0.5);
    let best: Surf | null = null, bd = 0.65;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const m = this.grid.get(`${ix + dx},${iz + dz}`);
      if (!m) continue;
      for (const e of m.values()) {
        const dy = p[1] - e.pos[1];
        if (dy < -0.1 || dy > 0.6) continue;
        const d = Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]);
        if (d < bd) { bd = d; best = e.s; }
      }
    }
    return best;
  }

  /**
   * Rolling bodies on a Glidepath (any roller: rail rumble, booster whoosh on a sudden speed-up), and Glint /
   * Bearing marbles everywhere (wood, steel or glass by the surface under them). Returns false to hand the
   * roller to mech.ts (tubes, gutters, vortices, the floor).
   */
  roller(id: string, type: string, pos: Vec3, dt: number, tubeOrGutter: (p: Vec3) => string | null): boolean {
    if (!finite3(pos)) return false;
    const t = canonType(type);
    const marble = t === 'marble';
    if (!marble && !this.glide.length) return false;
    let r = this.rollers.get(id);
    if (!r) { r = { m: new Motion(pos), vHist: [], boostAt: -10 }; this.rollers.set(id, r); return marble; }
    r.m.update(pos, dt);
    const v = r.m.speed, now = this.h.now();
    const onRail = this.glide.some((g) => segDist(pos, g.pts) < 0.15);
    if (onRail) {
      r.vHist.push([now, v]);
      while (r.vHist.length && now - r.vHist[0]![0] > 0.25) r.vHist.shift();
      const v0 = r.vHist[0]![1];
      if (v - v0 > 1.0 && now - r.boostAt > 0.8) { r.boostAt = now; this.h.play('boostZip', hash01(hashStr(id), Math.floor(now * 4)), { family: 'fx', pos, when: now + 0.005, gain: clamp(0.35 + (v - v0) / 6, 0.35, 0.8), key: 'boostZip' }); }
      if (v > 0.05) this.h.loop(`${id}:rail`, 'rail', pos, Math.min(1.6, v / 3), { aux: marble ? 1 : type === 'bearing' ? 0.9 : 0.6 });
      return true;
    }
    if (!marble) return false;
    if (v < 0.04) return true;
    const vh = Math.hypot(r.m.vel[0], r.m.vel[2]);
    // rolling, not flying: little vertical speed
    if (Math.abs(r.m.vel[1]) > 0.35 || vh < 0.04) return true;
    const path = tubeOrGutter(pos);
    const s: Surf = path === 'tube' ? 'glass' : path === 'gutter' ? 'wood' : this.surfaceAt(pos) ?? this.floor;
    this.h.loop(`${id}:marble`, 'marble', pos, Math.min(1.6, v / 2.5), { variant: `marble/${s}`, aux: type === 'bearing' ? 0.85 : 1 });
    return true;
  }

  // ---- part state ----

  /** Per running M3 part per frame. `arm` = the moving body's position (lift deck, ram rod, rack), if any. */
  part(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: readonly [number, number, number, number] | null, arm: Vec3 | null, dt: number, edges: boolean): void {
    const t = canonType(type);
    if (!STATEFUL.has(t) || !finite3(pos)) return;
    if (!Number.isFinite(meter)) meter = 0;
    const h = this.h, now = h.now();
    let s = this.parts.get(id);
    if (!s || s.type !== t) {
      s = { type: t, flags, meter, seen: now, motion: new Motion(pos), arm: arm && finite3(arm) ? new Motion(arm) : null, rot, spin: 0, moving: false, movedAt: -10, peakV: 0 };
      this.parts.set(id, s);
    }
    const prev = s.flags;
    s.flags = flags; s.meter = meter; s.seen = now;
    s.motion.update(pos, dt);
    if (arm && finite3(arm)) { if (!s.arm) s.arm = new Motion(arm); else s.arm.update(arm, dt); }
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
    const L = (kind: LoopKind, level: number, o?: LoopOpts) => h.loop(`${kind}:${id}`, kind, pos, level, o);
    const lit = (flags & F.lit) !== 0, powered = (flags & F.powered) !== 0, armed = (flags & F.armed) !== 0;
    const armV = s.arm ? s.arm.speed : 0;
    switch (t) {
      case 'lance':
        if (lit || powered) L('lance', 1);
        if (lit && (armed || meter > 0)) L('burn', meter > 0 ? clamp(meter / 20, 0.4, 1.2) : 1);
        if (rise(F.lit) && !this.fresh(id, 'lanceCharge')) this.cue(id, 'lanceCharge', v01, pos, now, 0.4);
        if (fall(F.lit) && !this.fresh(id, 'lanceOff')) this.cue(id, 'lanceOff', v01, pos, now, 0.35);
        break;
      case 'mirror_splitter':
        if (lit) L('prism', 1);
        if (rise(F.lit) && !this.fresh(id, 'opticTing')) this.cue(id, 'opticTing', v01, pos, now, 0.35);
        break;
      case 'tripwire':
        if (rise(F.lit) && !this.fresh(id, 'tripArm', 0.5)) this.cue(id, 'tripArm', v01, pos, now, 0.3);
        break;
      case 'maglock':
        if (powered) L('maghum', 1);
        if (rise(F.powered) && !this.fresh(id, 'magOn')) this.cue(id, 'magOn', v01, pos, now, 0.55);
        if (fall(F.powered) && !this.fresh(id, 'magRelease')) this.cue(id, 'magRelease', v01, pos, now, 0.4);
        break;
      case 'spindeck': {
        const w = s.spin;
        if (w > 0.2) L('spindeck', w / 4);
        this.motionEdges(id, s, w > 0.3, w < 0.12, 'deckClunk', pos, now, v01, edges);
        break;
      }
      case 'lift':
        if (s.arm) {
          if (armV > 0.02) L('liftmotor', armV / 0.4);
          if (this.motionEdges(id, s, armV > 0.03, armV < 0.008, 'liftClunk', pos, now, v01, edges)) this.cue(id, 'liftChime', v01, pos, now + 0.15, 0.35);
        } else if (powered) L('liftmotor', 0.8);
        break;
      case 'rack': {
        const v = s.arm ? armV : s.spin * 0.05;
        if (v > 0.005) L('ratchet', v / 0.08);
        if (edges && s.moving && v < 0.002 && s.peakV > 0.1 && !this.fresh(id, 'rackThunk', 0.5)) this.cue(id, 'rackThunk', v01, pos, now, clamp(0.3 + s.peakV, 0.3, 0.7));
        this.motionEdges(id, s, v > 0.01, v < 0.002, '', pos, now, v01, edges, v);
        break;
      }
      case 'ram':
        if ((rise(F.powered) || rise(F.pressed)) && !this.fresh(id, 'ramFire')) this.cue(id, 'ramFire', v01, pos, now, 0.65, { family: 'fx' });
        if ((fall(F.powered) || fall(F.pressed)) && !this.fresh(id, 'ramHiss')) this.cue(id, 'ramHiss', v01, pos, now, 0.45);
        break;
      case 'powder_keg':
        if (armed) L('fuse', 0.8);
        if (lit) L('cook', meter > 0 ? clamp(meter / 20, 0.3, 1) : 0.8);
        break;
      case 'jitterjuice':
        if (dist(pos, h.listener()) < 4) L('fizz', 1);
        break;
      case 'skyshow': if (armed) L('fuse', 0.7); break;
      case 'flamer':
        if (lit) L('flamer', meter > 0 ? clamp(meter / 20, 0.4, 1.2) : 1);
        if (rise(F.lit) && !this.fresh(id, 'flamerIgnite')) this.cue(id, 'flamerIgnite', v01, pos, now, 0.6, { family: 'fx' });
        if (fall(F.lit) && !this.fresh(id, 'flamerOff')) this.cue(id, 'flamerOff', v01, pos, now, 0.45);
        break;
      case 'wrecker': {
        const v = s.motion.speed;
        if (v > 0.3) L('chaincreak', v / 2);
        if (v > 1.5) L('swingair', (v - 1) / 4);
        break;
      }
      case 'paddle':
        if ((rise(F.powered) || rise(F.pressed)) && !this.fresh(id, 'paddleFlip')) this.cue(id, 'paddleFlip', v01, pos, now, 0.55);
        break;
      case 'fabricator':
        if (powered || armed) L('fabhum', 1);
        break;
      case 'recycler': break;
      case 'zone': L('zone', meter > 0 ? clamp(meter / 20, 0.3, 1) : 0.6); break;
      default:
    }
  }

  /** Start/stop edges from measured motion: a clunk on start and on stop. Returns true on a stop edge. */
  private motionEdges(id: number, s: PState, startCond: boolean, stopCond: boolean, clunk: string, pos: Vec3, now: number, v01: number, edges: boolean, v = 0): boolean {
    if (v > s.peakV) s.peakV = v;
    if (!s.moving && startCond) {
      s.moving = true; s.movedAt = now; s.peakV = v;
      if (edges && clunk && !this.fresh(id, clunk, 0.4)) this.cue(id, clunk, v01, pos, now, 0.45);
      return false;
    }
    if (s.moving && stopCond && now - s.movedAt > 0.3) {
      s.moving = false;
      if (edges && clunk && !this.fresh(id, clunk, 0.4)) this.cue(id, clunk, v01, pos, now, 0.4, { rate: 0.9 });
      s.peakV = 0;
      return edges;
    }
    return false;
  }
}

export function segDist(p: Vec3, pts: readonly Vec3[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const l2 = abx * abx + aby * aby + abz * abz;
    const t = l2 > 0 ? clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2, 0, 1) : 0;
    const d = Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - aby * t, p[2] - a[2] - abz * t);
    if (d < best) best = d;
  }
  return best;
}
