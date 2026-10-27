// M2 mechanisms (AUDIO.md §5, §11): procedural sounds for the 29 new parts, and the director that maps
// contract-1 events, part flags, meters and measured spin to cues and state loops.
//
// Drivers (see docs/dev/M2_NOTES_F.md for the full table):
//   events  Lit/Unlit · Toggle · Ring · Launch · Splash · Spawn/Despawn · Note · Sound · Break · Jam · Brownout,
//           plus type-specific Impact/Press/Signal/Pop handling
//   state   part(): flags (PartFlagBits) edges and levels, the meter byte, and ω measured from the part's
//           moving body; flag edges are fallbacks that stay silent when the matching event already played

import { crack, debris, impact, relay, type Recipe } from './bank';
import { hash01, hashStr, type Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, glide, grains, hp, lp, mixInto, modal, normalize,
  pluck, seamless, softClip, sweep, white, type Mode,
} from './synth';
import { Motion, clamp, dist, finite3, type AudioHost, type SimEventLike, type Vec3 } from './types';

// ============================================================================================
// sounds
// ============================================================================================

const at = (s: number): number => Math.round(s * SR);

function click(f: number, tau: number, rng: Rng, w = 0.00015): Float32Array {
  return modal(at(Math.min(0.2, tau * 10)), contact(w, rng), [{ f, amp: 1, tau }, { f: f * 1.63, amp: 0.45, tau: tau * 0.6 }]);
}

/** Stick-slip creak: a jittery pulse train through a resonance (hinges, pleats, saddles). */
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

// ---- power & signal ----

function dynamoLoop(rng: Rng): Float32Array {
  const len = SR; // 1 s: integer-Hz partials loop seamlessly
  const x = new Float32Array(len), buzz = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR, ph = 2 * Math.PI * 100 * t;
    x[i] = 0.6 * Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.4) + 0.5 * Math.sin(3 * ph) + 0.3 * Math.sin(5 * ph + 1) + 0.12 * Math.sin(7 * ph);
    buzz[i] = Math.tanh(6 * Math.sin(2 * ph));
  }
  mixInto(x, normalize(bp(buzz, 1500, 0.7), 0.45));
  const brush = seamless(1, 0.1, (n) => bp(white(n, rng), 3800, 0.8));
  mixInto(x, normalize(brush, 0.1));
  return normalize(x, 0.32);
}

function turbineLoop(rng: Rng): Float32Array {
  const sec = 2, bladeHz = 6; // 12 blade passes per loop; playbackRate scales whoosh and pass rate together
  const air = seamless(sec, 0.2, (n) => lp(white(n, rng), 1200));
  const swish = seamless(sec, 0.2, (n) => bp(white(n, rng), 1600, 0.9));
  const x = new Float32Array(air.length);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, ph = (t * bladeHz) % 1;
    const env = 0.3 + 0.7 * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * ph), 3);
    x[i] = air[i]! * 0.55 + swish[i]! * env + 0.06 * Math.sin(2 * Math.PI * 72 * t) + 0.03 * Math.sin(2 * Math.PI * 216 * t);
  }
  return normalize(x, 0.33);
}

function ringerBell(rng: Rng): Float32Array {
  const x = alloc(2.6);
  const fA = 1720 * (1 + rng.bi() * 0.01), fB = 1865 * (1 + rng.bi() * 0.01);
  const modes = (f: number): Mode[] => [{ f, amp: 1, tau: 0.35 }, { f: f * 2.32, amp: 0.55, tau: 0.18 }, { f: f * 4.1, amp: 0.3, tau: 0.08 }];
  const strike = [modal(at(0.5), contact(0.00012, rng), modes(fA)), modal(at(0.5), contact(0.00012, rng), modes(fB))];
  for (let k = 0; k / 17 < 2.0; k++) mixInto(x, strike[k % 2]!, at(k / 17), 0.7 + 0.3 * rng.next());
  // hammer rattle
  const r = hp(white(at(2.0), rng), 2500);
  envFn(r, (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 17 * t));
  mixInto(x, normalize(r, 0.08));
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.3);
}

function ringerWind(rng: Rng): Float32Array {
  const x = alloc(0.5);
  let t = 0, k = 0;
  while (t < 0.42) { mixInto(x, click(2300 + rng.bi() * 150, 0.004, rng), at(t), 0.6 + 0.4 * rng.next()); t += 1 / (24 + k * 1.5); k++; }
  mixInto(x, normalize(creak(0.4, 60, 900, rng), 0.25));
  return fadeEdges(normalize(x, 0.35));
}

function ringerTickLoop(rng: Rng): Float32Array {
  const x = alloc(2);
  const tk = (f: number): Float32Array => modal(at(0.15), contact(0.0002, rng), [{ f, amp: 1, tau: 0.012 }, { f: f * 1.58, amp: 0.5, tau: 0.008 }, { f: 900, amp: 0.6, tau: 0.03 }]);
  mixInto(x, tk(2600));
  mixInto(x, tk(2150), at(1.0), 0.85);
  return normalize(x, 0.3);
}

function delayTickLoop(rng: Rng): Float32Array {
  const x = alloc(1);
  for (let k = 0; k < 4; k++) mixInto(x, modal(at(0.06), contact(0.0003, rng), [{ f: 1900, amp: 1, tau: 0.006 }, { f: 620, amp: 0.6, tau: 0.012 }]), at(k * 0.25), k % 2 ? 0.7 : 1);
  return normalize(lp(x, 3200), 0.22);
}

function delayChirp(): Float32Array {
  const x = alloc(0.12);
  mixInto(x, chirp(at(0.04), () => 1500, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.015)));
  mixInto(x, chirp(at(0.06), () => 2250, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.02)), at(0.045));
  return fadeEdges(normalize(x, 0.3));
}

function toggleSnap(rng: Rng): Float32Array {
  const x = alloc(0.16);
  mixInto(x, modal(x.length, contact(0.00012, rng), [{ f: 2800, amp: 1, tau: 0.006 }, { f: 4600, amp: 0.5, tau: 0.004 }]));
  mixInto(x, normalize(modal(x.length, contact(0.0012, rng), [{ f: 320 * (1 + rng.bi() * 0.04), amp: 1, tau: 0.03 }, { f: 760, amp: 0.4, tau: 0.02 }]), 0.8), at(0.004));
  mixInto(x, chirp(at(0.05), glide(1300, 900, 0.01), (t) => 0.12 * Math.exp(-t / 0.02)));
  return fadeEdges(normalize(x, 0.45), 0.0001, 0.02);
}

function lampOn(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, normalize(modal(x.length, contact(0.0001, rng), [{ f: 3600 * (1 + rng.bi() * 0.03), amp: 1, tau: 0.08 }, { f: 8400, amp: 0.4, tau: 0.04 }]), 0.5));
  mixInto(x, normalize(hp(envAD(white(at(0.02), rng), 0.0001, 0.003), 4000), 0.35));
  return fadeEdges(normalize(x, 0.35), 0.0001, 0.05);
}

function lampOff(rng: Rng): Float32Array {
  const x = click(2400, 0.02, rng);
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0001, 0.002), 3000), 0.3));
  return fadeEdges(normalize(x, 0.25));
}

function filamentLoop(): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const ph = 2 * Math.PI * 120 * i / SR;
    let s = 0;
    for (let h = 1; h <= 30; h++) s += Math.sin(h * ph) / (h % 2 ? h : 2 * h);
    x[i] = s;
  }
  return normalize(bp(x, 2000, 0.6), 0.3);
}

function torchClick(rng: Rng): Float32Array {
  const x = alloc(0.08);
  mixInto(x, click(2100, 0.01, rng));
  mixInto(x, click(2600, 0.007, rng), at(0.018), 0.6);
  mixInto(x, normalize(bp(envAD(white(at(0.012), rng), 0.0005, 0.004), 2500, 0.8), 0.3));
  return fadeEdges(normalize(x, 0.35));
}

function focusTink(rng: Rng): Float32Array {
  return fadeEdges(normalize(modal(at(0.6), contact(0.0001, rng), [{ f: 4800, amp: 1, tau: 0.15 }, { f: 7400, amp: 0.4, tau: 0.08 }]), 0.3));
}

function sizzleLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = hp(white(len, rng), 3500);
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.998 + rng.bi() * 0.03; x[i] = x[i]! * (0.5 + 3 * Math.abs(am)); }
    normalize(x, 0.4);
    grains(x, rng, () => 60, (r) => normalize(hp(envAD(white(200, r), 0.00005, 0.0006), 3000), 0.2 + 0.4 * r.next()));
    return x;
  }), 0.3);
}

function suncellTick(): Float32Array {
  const x = alloc(0.6);
  [5200, 6150, 7300, 8800].forEach((f, k) => mixInto(x, chirp(at(0.5), () => f, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.12)), at(k * 0.012), 1 - k * 0.15));
  return fadeEdges(normalize(x, 0.25));
}

function shimmerLoop(rng: Rng): Float32Array {
  const x = new Float32Array(2 * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    // all partials are multiples of 0.5 Hz, so a 2 s buffer loops seamlessly
    const s = Math.sin(2 * Math.PI * 5200 * t) + Math.sin(2 * Math.PI * 5203.5 * t) + 0.7 * Math.sin(2 * Math.PI * 6900 * t) + 0.7 * Math.sin(2 * Math.PI * 6904 * t);
    x[i] = s * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t));
  }
  normalize(x, 1);
  mixInto(x, normalize(seamless(2, 0.2, (n) => hp(white(n, rng), 6000)), 0.15));
  return normalize(x, 0.25);
}

function cellLoop(): Float32Array {
  const x = new Float32Array(SR);
  let ph = 0;
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * 1800 * (1 + 0.015 * Math.sin(2 * Math.PI * 6 * t)) / SR;
    x[i] = Math.sin(ph) * 0.6 + 0.2 * Math.sin(2 * Math.PI * 50 * t);
  }
  return normalize(x, 0.22);
}

function sag(rng: Rng): Float32Array {
  const len = at(0.7);
  const x = chirp(len, (t) => 60 + 80 * Math.exp(-t / 0.25), (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.3) * (0.6 + 0.4 * Math.sign(Math.sin(2 * Math.PI * 9 * t))));
  for (let i = 0; i < len; i++) x[i] = Math.tanh(4 * x[i]!);
  mixInto(x, normalize(hp(envAD(white(len, rng), 0.005, 0.2), 4000), 0.1));
  return fadeEdges(normalize(lp(x, 2000), 0.4), 0.001, 0.05);
}

function grind(rng: Rng): Float32Array {
  const x = alloc(0.8);
  mixInto(x, creak(0.75, 40, 700, rng));
  const n = bp(white(x.length, rng), 1200, 0.8);
  envFn(n, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.3));
  mixInto(x, normalize(n, 0.4));
  grains(x, rng, (t) => (t < 0.5 ? 40 : 0), (r) => normalize(hp(envAD(white(240, r), 0.00005, 0.0008), 3000), 0.3 + 0.4 * r.next()));
  return fadeEdges(normalize(x, 0.45), 0.001, 0.05);
}

// ---- springs, contraptions ----

function sprong(rng: Rng): Float32Array {
  const len = at(0.7);
  const f0 = 190 * (1 + rng.bi() * 0.06);
  const f = (t: number) => f0 * (0.75 + 0.6 * Math.exp(-t / 0.05)) * (1 + 0.06 * Math.sin(2 * Math.PI * 11 * t) * Math.exp(-t / 0.3));
  const x = chirp(len, f, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.18));
  mixInto(x, chirp(len, (t) => f(t) * 2.01, (t) => 0.25 * Math.exp(-t / 0.08)));
  const coil = modal(len, contact(0.0003, rng), [{ f: 2300, amp: 0.5, tau: 0.15 }, { f: 3150, amp: 0.4, tau: 0.12 }, { f: 4400, amp: 0.25, tau: 0.08 }]);
  envFn(coil, (t) => 0.4 + 0.6 * Math.abs(Math.sin(2 * Math.PI * 11 * t)));
  mixInto(x, normalize(coil, 0.35));
  mixInto(x, impact('rubber', 2, rng), 0, 0.5);
  return fadeEdges(normalize(x, 0.5));
}

function punch(rng: Rng): Float32Array {
  const x = alloc(0.6);
  mixInto(x, chirp(at(0.4), (t) => (120 + 120 * Math.exp(-t / 0.05)) * (1 + 0.05 * Math.sin(2 * Math.PI * 14 * t)), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.1)), 0, 0.7);
  const whap = bp(envAD(white(at(0.1), rng), 0.0005, 0.025), 1100 * (1 + rng.bi() * 0.1), 0.8);
  mixInto(x, normalize(whap, 0.9), at(0.035));
  mixInto(x, chirp(at(0.2), glide(130, 70, 0.04), (t) => Math.exp(-t / 0.05)), at(0.035), 0.6);
  softClip(normalize(x, 1), 1.5);
  return fadeEdges(normalize(x, 0.5));
}

function ratchet(rng: Rng): Float32Array {
  const x = alloc(0.55);
  for (let t = 0; t < 0.5; t += 1 / 28) mixInto(x, click(2600 + rng.bi() * 100, 0.004, rng), at(t), 1 - t);
  return fadeEdges(normalize(x, 0.3));
}

function gotchaPop(rng: Rng): Float32Array {
  const x = alloc(1.0);
  mixInto(x, impact('wood', 2, rng), 0, 0.6);
  const wh = white(at(0.1), rng);
  sweep(wh, 'bp', (t) => 800 + 2200 * Math.min(1, t / 0.06), 1);
  mixInto(x, normalize(envAD(wh, 0.002, 0.03), 0.3));
  const f0 = 160 * (1 + rng.bi() * 0.05);
  mixInto(x, chirp(at(0.95), (t) => f0 * (0.7 + 0.7 * Math.exp(-t / 0.08)) * (1 + 0.08 * Math.sin(2 * Math.PI * 7 * t) * Math.exp(-t / 0.5)), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.35)), at(0.02), 0.9);
  return fadeEdges(normalize(x, 0.5));
}

/** Music-box comb tine at C6 (MIDI 84); notes are re-pitched by playbackRate. */
function tine(rng: Rng): Float32Array {
  const f = 1046.5;
  const x = modal(at(1.6), contact(0.0002, rng), [{ f, amp: 1, tau: 1.1 }, { f: f * 6.27, amp: 0.25, tau: 0.08 }, { f: f * 17.55, amp: 0.1, tau: 0.02 }]);
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0001, 0.001), 4000), 0.05));
  return fadeEdges(normalize(x, 0.4), 0.0001, 0.1);
}

function crankLoop(rng: Rng): Float32Array {
  const x = alloc(1);
  for (let k = 0; k < 8; k++) {
    mixInto(x, click(3000 + rng.bi() * 120, 0.004, rng), at(k / 8), k % 2 ? 0.7 : 1);
    mixInto(x, modal(at(0.05), contact(0.0006, rng), [{ f: 700, amp: 1, tau: 0.01 }]), at(k / 8), 0.4);
  }
  return normalize(x, 0.3);
}

// ---- boom family (toy, not explosive) ----

function bigTop(rng: Rng): Float32Array {
  const x = alloc(1.6);
  mixInto(x, chirp(x.length, glide(95, 38, 0.12), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.22)));
  const air = white(at(0.8), rng);
  sweep(air, 'lp', (t) => 200 + 1600 * Math.exp(-t / 0.08), 0.9);
  mixInto(x, normalize(envAD(air, 0.005, 0.12), 0.6));
  mixInto(x, normalize(debris('paper', rng), 0.25), at(0.05));
  softClip(normalize(x, 1), 1.4);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.15);
}

function slideWhistle(rng: Rng): Float32Array {
  const len = at(0.75);
  const f = (t: number) => (500 + 1300 * Math.pow(Math.min(1, t / 0.55), 1.3)) * (1 + 0.015 * Math.sin(2 * Math.PI * 6 * t));
  const env = (t: number) => Math.min(1, t / 0.03) * (t > 0.62 ? Math.max(0, (0.75 - t) / 0.13) : 1);
  const x = chirp(len, f, env);
  const b = bp(white(len, rng), 1500, 0.7);
  envFn(b, (t) => 0.1 * env(t));
  mixInto(x, b);
  return fadeEdges(normalize(x, 0.3));
}

function corkPop(rng: Rng): Float32Array {
  const x = alloc(0.35);
  const k = 1 + rng.bi() * 0.08;
  mixInto(x, chirp(x.length, glide(210 * k, 150 * k, 0.03), (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.04)));
  mixInto(x, normalize(bp(envAD(white(x.length, rng), 0.002, 0.02), 900 * k, 4), 0.4));
  mixInto(x, normalize(hp(envAD(white(at(0.03), rng), 0.00005, 0.002), 1500), 0.8));
  mixInto(x, chirp(at(0.03), glide(2400, 3200, 0.01), (t) => 0.15 * Math.exp(-t / 0.008)), at(0.004));
  softClip(normalize(x, 1), 1.5);
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.03);
}

function corkZip(rng: Rng): Float32Array {
  const x = alloc(0.5);
  const z = white(at(0.13), rng);
  sweep(z, 'bp', (t) => 1500 + 3500 * (t / 0.13), 2);
  mixInto(x, normalize(envFn(z, (t) => Math.sin(Math.PI * t / 0.13)), 0.4));
  const tw = lp(pluck(at(0.35), 196, rng, 0.995, 0.6), 3000);
  envFn(tw, (t) => Math.exp(-t / 0.15));
  mixInto(x, normalize(tw, 0.7), at(0.12));
  return fadeEdges(normalize(x, 0.4));
}

function rocketLaunch(rng: Rng): Float32Array {
  const x = alloc(2.2);
  const env = (t: number) => Math.min(1, t / 0.05) * (t < 1.4 ? 1 : Math.exp(-(t - 1.4) / 0.25));
  const n = white(x.length, rng);
  // the doppler-ish sweep: the band rises on ignition, then falls as the rocket climbs away
  sweep(n, 'bp', (t) => (t < 0.3 ? 300 + 2300 * t / 0.3 : 900 + 1700 * Math.exp(-(t - 0.3) / 0.6)), 0.9);
  mixInto(x, normalize(envFn(n, env), 1));
  const rum = lp(brown(x.length, rng), 300);
  mixInto(x, normalize(envFn(rum, env), 0.5));
  mixInto(x, chirp(x.length, (t) => (t < 0.25 ? 1400 + 1400 * t / 0.25 : 1100 + 1700 * Math.exp(-(t - 0.25) / 0.5)), (t) => (t < 0.1 ? 0 : 0.25 * env(t))));
  grains(x, rng, (t) => (t < 1.6 ? 50 : 0), (r) => normalize(hp(envAD(white(200, r), 0.00005, 0.0007), 2500), 0.15 + 0.3 * r.next()));
  return fadeEdges(normalize(x, 0.5), 0.001, 0.2);
}

function thrustLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = lp(white(len, rng), 2500);
    const b = lp(brown(len, rng), 400);
    let fl = 0;
    for (let i = 0; i < len; i++) { fl = fl * 0.999 + rng.bi() * 0.02; x[i] = (x[i]! * 0.6 + b[i]! * 0.6) * (0.7 + 2 * Math.abs(fl)); }
    normalize(x, 0.5);
    grains(x, rng, () => 45, (r) => normalize(hp(envAD(white(240, r), 0.00005, 0.0008), 2200), 0.2 + 0.4 * r.next()));
    return x;
  }), 0.33);
}

// ---- frame & matter ----

function flapClack(rng: Rng): Float32Array {
  const x = impact('poly', 1, rng);
  mixInto(x, click(1900, 0.01, rng), 0, 0.3);
  mixInto(x, impact('wood', 1, rng), at(0.012), 0.5);
  return fadeEdges(normalize(x, 0.45));
}

function rollTubeLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = lp(brown(len, rng), 700);
    mixInto(x, normalize(bp(white(len, rng), 420, 5), 0.5));
    mixInto(x, normalize(bp(white(len, rng), 1150, 4), 0.3));
    for (let i = 0; i < len; i++) x[i] = x[i]! * (0.8 + 0.2 * Math.sin(2 * Math.PI * 4 * i / SR));
    return x;
  }), 0.35);
}

function rollGutterLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = lp(brown(len, rng), 1400);
    mixInto(x, normalize(bp(white(len, rng), 3000, 0.7), 0.15));
    normalize(x, 0.5);
    const toks = [0, 1, 2].map(() => impact('poly', 0, rng));
    grains(x, rng, () => 20, (r) => normalize(toks[r.int(3)]!.slice(), 0.04 + 0.1 * r.next()));
    return x;
  }), 0.35);
}

function spiralLoop(rng: Rng): Float32Array {
  const g = rollGutterLoop(rng);
  const w = seamless(2, 0.2, (n) => bp(white(n, rng), 900, 3));
  normalize(w, 0.3);
  // 3 orbits per second at 1×: the orbit rate climbs with playbackRate as the radius shrinks
  for (let i = 0; i < g.length; i++) g[i] = (g[i]! + w[i]!) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * i / SR));
  return normalize(g, 0.35);
}

function scoopFill(rng: Rng): Float32Array {
  const x = alloc(0.7);
  mixInto(x, lp(impact('steel', 1, rng), 4000), 0, 0.5);
  grains(x, rng, (t) => 60 * Math.exp(-t / 0.2), (r) => normalize(impact('steel', 0, r), 0.08 + 0.15 * r.next()));
  return fadeEdges(normalize(x, 0.45));
}

function shatter(rng: Rng): Float32Array {
  const x = alloc(1.8);
  mixInto(x, normalize(crack(rng), 0.8));
  mixInto(x, impact('glass', 2, rng), 0, 0.6);
  mixInto(x, normalize(debris('glass', rng), 0.8), at(0.01));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.2);
}

function droplets(x: Float32Array, rng: Rng, rate: (t: number) => number): void {
  grains(x, rng, rate, (r) => normalize(bubble(0.05, 800 + 1700 * r.next(), 0.6, 0.012), 0.2 + 0.5 * r.next()));
}

function waterBurst(rng: Rng): Float32Array {
  const x = alloc(1.4);
  const n = white(x.length, rng);
  sweep(n, 'lp', (t) => (t < 0.06 ? 400 + 2600 * t / 0.06 : 800 + 2200 * Math.exp(-(t - 0.06) / 0.2)), 0.8);
  mixInto(x, normalize(envAD(n, 0.02, 0.25), 0.8));
  droplets(x, rng, (t) => 50 * Math.exp(-t / 0.4));
  return fadeEdges(normalize(x, 0.5), 0.001, 0.15);
}

function splash(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, normalize(bp(envAD(white(x.length, rng), 0.004, 0.12), 1400, 0.6), 1));
  mixInto(x, chirp(at(0.3), glide(180, 90, 0.04), (t) => Math.exp(-t / 0.06)), 0, 0.5);
  droplets(x, rng, (t) => (t < 0.4 ? 30 : 0));
  return fadeEdges(normalize(x, 0.45));
}

function trapSlam(rng: Rng): Float32Array {
  const x = alloc(1.4);
  mixInto(x, normalize(modal(x.length, contact(0.0008, rng, 0.3), [
    { f: 420, amp: 1, tau: 0.5 }, { f: 1130, amp: 0.7, tau: 0.35 }, { f: 2210, amp: 0.5, tau: 0.2 }, { f: 3470, amp: 0.3, tau: 0.12 },
  ]), 0.8));
  for (let k = 0; k < 5; k++) mixInto(x, impact('steel', 0, rng), at(0.02 + rng.next() * 0.1), 0.3);
  mixInto(x, impact('rubber', 2, rng), 0, 0.7);
  return fadeEdges(normalize(x, 0.5));
}

function ding(rng: Rng): Float32Array {
  return fadeEdges(normalize(modal(at(1.2), contact(0.0001, rng), [{ f: 2600, amp: 1, tau: 0.6 }, { f: 6030, amp: 0.35, tau: 0.25 }]), 0.35));
}

function plunger(rng: Rng): Float32Array {
  const x = alloc(1.0);
  let t = 0, k = 0;
  while (t < 0.35) { mixInto(x, click(2800, 0.003, rng), at(t), 0.5); t += 1 / (30 + k * 6); k++; }
  const wh = chirp(at(0.45), glide(180, 900, 0.2), (tt) => Math.min(1, tt / 0.02) * (tt > 0.38 ? Math.max(0, (0.45 - tt) / 0.07) : 1));
  const wh2 = chirp(at(0.45), (tt) => 2 * glide(180, 900, 0.2)(tt), (tt) => 0.4 * Math.min(1, tt / 0.02) * (tt > 0.38 ? Math.max(0, (0.45 - tt) / 0.07) : 1));
  mixInto(x, wh, 0, 0.5);
  mixInto(x, wh2, 0, 0.5);
  mixInto(x, impact('poly', 2, rng), at(0.4), 0.9);
  mixInto(x, relay(rng), at(0.41), 0.6);
  return fadeEdges(normalize(x, 0.5));
}

function bubblesLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.3, (len) => {
    const x = normalize(lp(white(len, rng), 600), 0.05);
    grains(x, rng, () => 5, (r) => normalize(bubble(0.08, 500 + 900 * r.next(), 0.5, 0.02), 0.2 + 0.5 * r.next()));
    return x;
  }), 0.25);
}

function wheelLoop(rng: Rng): Float32Array {
  const x = alloc(1);
  const sq = chirp(at(0.09), (t) => 1700 + 400 * Math.sin(Math.PI * t / 0.09), (t) => Math.sin(Math.PI * t / 0.09));
  for (let i = 0; i < sq.length; i++) sq[i] = Math.tanh(3 * sq[i]!) * (0.8 + 0.2 * rng.bi());
  mixInto(x, normalize(bp(sq, 1900, 2), 0.5));
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = x[i]! + 0.08 * Math.sin(2 * Math.PI * 96 * t) + 0.04 * Math.sin(2 * Math.PI * 192 * t); }
  return normalize(x, 0.3);
}

function chainLoop(rng: Rng): Float32Array {
  const x = alloc(1);
  for (let k = 0; k < 30; k++) mixInto(x, click(3500 + rng.bi() * 200, 0.002, rng), at(k / 30), 0.3 + 0.4 * rng.next());
  mixInto(x, normalize(seamless(1, 0.1, (n) => bp(white(n, rng), 2200, 0.9)), 0.15));
  mixInto(x, normalize(creak(0.08, 45, 900, rng), 0.3), at(0.5));
  return normalize(x, 0.3);
}

function bellows(rng: Rng, v: number): Float32Array {
  const x = alloc(1.0);
  const n = white(x.length, rng);
  sweep(n, 'lp', (t) => (t < 0.08 ? 120 + 900 * t / 0.08 : 350 + 650 * Math.exp(-(t - 0.08) / 0.15)), 1);
  mixInto(x, normalize(envFn(n, (t) => Math.min(1, t / 0.05) * Math.exp(-t / 0.28)), 1));
  mixInto(x, normalize(creak(0.12, 45, 1100, rng), 0.3));
  if (v >= 2) {
    // strong puffs make the nozzle whistle
    const w = chirp(at(0.45), () => 1850 * (1 + rng.bi() * 0.02), (t) => (t < 0.05 ? 0 : Math.min(1, (t - 0.05) / 0.03) * Math.exp(-(t - 0.05) / 0.15)));
    mixInto(x, w, 0, 0.2);
  }
  return fadeEdges(normalize(x, 0.45), 0.001, 0.08);
}

function splinter(rng: Rng): Float32Array {
  const x = alloc(1.4);
  mixInto(x, normalize(crack(rng), 0.6));
  mixInto(x, impact('wood', 2, rng), 0, 0.8);
  mixInto(x, normalize(debris('wood', rng), 0.6), at(0.02));
  return fadeEdges(normalize(x, 0.5), 0.0001, 0.15);
}

export function mechRecipes(): Recipe[] {
  return [
    ['loop/dynamo', 1, dynamoLoop], ['loop/turbine', 1, turbineLoop], ['loop/filament', 1, filamentLoop], ['loop/shimmer', 1, shimmerLoop],
    ['loop/cell', 1, cellLoop], ['loop/sizzle', 1, sizzleLoop], ['loop/ringer', 1, ringerTickLoop], ['loop/delay', 1, delayTickLoop],
    ['loop/thrust', 1, thrustLoop], ['loop/crank', 1, crankLoop], ['loop/bubbles', 1, bubblesLoop], ['loop/wheel', 1, wheelLoop],
    ['loop/chain', 1, chainLoop], ['loop/spiral', 1, spiralLoop], ['loop/roll/tube', 1, rollTubeLoop], ['loop/roll/gutter', 1, rollGutterLoop],
    ['ringerBell', 2, ringerBell], ['ringerWind', 1, ringerWind], ['delayChirp', 1, delayChirp], ['toggle', 3, toggleSnap],
    ['lampOn', 3, lampOn], ['lampOff', 2, lampOff], ['torch', 2, torchClick], ['focusTink', 2, focusTink], ['suncellTick', 1, suncellTick],
    ['sag', 2, sag], ['grind', 2, grind],
    ['sprong', 6, sprong], ['punch', 4, punch], ['ratchet', 2, ratchet], ['gotchaPop', 3, gotchaPop], ['tine', 2, tine],
    ['bigTop', 2, bigTop], ['slideWhistle', 1, slideWhistle], ['corkPop', 6, corkPop], ['corkZip', 2, corkZip], ['rocketLaunch', 3, rocketLaunch],
    ['flap', 4, flapClack], ['scoopFill', 3, scoopFill], ['shatter', 3, shatter], ['waterBurst', 2, waterBurst], ['splash', 3, splash],
    ['trapSlam', 3, trapSlam], ['ding', 2, ding], ['plunger', 2, plunger], ['bellows', 2, (g) => bellows(g, 0)], ['bellowsBig', 2, (g) => bellows(g, 2)],
    ['splinter', 3, splinter],
  ];
}

// ============================================================================================
// director
// ============================================================================================

/** PartFlagBits (packages/sim machine.ts). Duplicated so audio has no runtime dependency on the sim package. */
export const F = { lit: 1, powered: 2, pressed: 4, dead: 8, armed: 16, broken: 32, fault: 64 } as const;

/** Part types Mechanisms.part() keeps state for (index.ts skips the per-frame call for every other type). */
export const MECH_PART_TYPES: ReadonlySet<string> = new Set([
  'dynamo', 'turbine', 'hamster_drive', 'pedal_rig', 'lamp', 'torch', 'suncell', 'cell', 'burning_glass', 'ringer', 'delay',
  'skyrocket', 'big_top', 'fishbowl', 'toggle', 'gotcha_box', 'vortex', 'vortex_slim',
]);

type Q = readonly [number, number, number, number];

/** Gotcha Box crank tune: an original 8-bar music-box ditty in the world key (C major), MIDI notes, 4 per bar. */
export const GOTCHA_TUNE: readonly number[] = [
  79, 84, 88, 84, 86, 83, 79, 83, 84, 88, 91, 88, 89, 86, 83, 79,
  81, 84, 89, 84, 79, 83, 86, 83, 84, 88, 86, 83, 84, 79, 84, 0,
];

interface PartState {
  type: string; flags: number; meter: number; motion: Motion; rot: Q | null; spin: number; seen: number;
  tune: number; tuneIdx: number; popped: boolean;
}

interface Vortex { pos: Vec3; r: number }
export interface AudioPath { kind: string; pts: readonly Vec3[] }

/** Tine playbackRate for a MIDI note (the tine is rendered at C6 = 84). */
const tineRate = (midi: number): number => Math.pow(2, (midi - 84) / 12);
/** Note magnitude: a MIDI number (≥ 24), else a C-major scale degree from C5. */
function noteMidi(mag: number): number {
  if (mag >= 24) return Math.round(mag);
  const d = Math.max(0, Math.round(mag));
  return 72 + [0, 2, 4, 5, 7, 9, 11][d % 7]! + 12 * Math.floor(d / 7);
}

export class Mechanisms {
  private readonly parts = new Map<number, PartState>();
  private readonly recent = new Map<string, number>();
  private readonly simNotes = new Set<number>();
  private readonly rollers = new Map<string, Motion>();
  private vortices: Vortex[] = [];
  private paths: { kind: string; pts: readonly Vec3[]; r: number }[] = [];

  constructor(private readonly h: AudioHost) {}

  reset(): void {
    this.parts.clear(); this.recent.clear(); this.simNotes.clear(); this.rollers.clear(); this.vortices = [];
  }

  setPaths(paths: readonly AudioPath[]): void {
    // tubes and gutters only (GLIDEPATH rails belong to m3.ts)
    this.paths = paths.filter((p) => p.pts.length > 1 && /tube|gutter/.test(p.kind)).map((p) => ({ kind: p.kind, pts: p.pts, r: p.kind.endsWith('_slim') ? 0.1 : 0.2 }));
  }

  /** 'tube' | 'gutter' when `pos` is inside a tube or gutter path, else null (m3.ts marbles). */
  pathKind(pos: Vec3): 'tube' | 'gutter' | null {
    for (const p of this.paths) if (segDist(pos, p.pts) <= p.r) return p.kind.startsWith('gutter') ? 'gutter' : 'tube';
    return null;
  }

  /** A cue for a part, remembered so a flag-edge fallback for the same cue stays quiet. */
  private cue(id: number, name: string, var01: number, pos: Vec3, when: number, gain: number, extra: { rate?: number; prio?: number; family?: 'mech' | 'fx' } = {}): void {
    this.recent.set(`${id}:${name}`, this.h.now());
    const o: Parameters<AudioHost['play']>[2] = { family: extra.family ?? 'mech', pos, when, gain, key: name };
    if (extra.rate !== undefined) o.rate = extra.rate;
    if (extra.prio !== undefined) o.prio = extra.prio;
    this.h.play(name, var01, o);
  }

  private fresh(id: number, name: string, within = 0.3): boolean {
    return this.h.now() - (this.recent.get(`${id}:${name}`) ?? -10) < within;
  }

  /** Contract-1 kinds and M2-specific mappings. Returns true when handled (the M1 switch then skips it). */
  event(e: SimEventLike, type: string | undefined, when: number, var01: number): boolean {
    const id = e.part, p = e.pos, t = type ?? '';
    switch (e.kind) {
      case 'Lit':
        if (t === 'lamp') this.cue(id, 'lampOn', var01, p, when, 0.5);
        else if (t === 'torch') this.cue(id, 'torch', var01, p, when, 0.5, { rate: 1.05 });
        else if (t === 'suncell') this.cue(id, 'suncellTick', var01, p, when, 0.35);
        else if (t === 'burning_glass') this.cue(id, 'focusTink', var01, p, when, 0.4);
        else if (t === 'lance') this.cue(id, 'lampOn', var01, p, when, 0.4, { rate: 0.8 });
        return true;
      case 'Unlit':
        if (t === 'lamp') this.cue(id, 'lampOff', var01, p, when, 0.4);
        else if (t === 'torch') this.cue(id, 'torch', var01, p, when, 0.45, { rate: 0.9 });
        return true;
      case 'Toggle':
        if (t === 'flap') this.cue(id, 'flap', var01, p, when, 0.6, { rate: e.mag > 0 ? 1.05 : 0.92 });
        else this.cue(id, 'toggle', var01, p, when, 0.6, { rate: e.mag > 0 ? 1.06 : 0.9 });
        return true;
      case 'Ring':
        this.cue(id, 'ringerBell', var01, p, when, 0.75, { prio: 1.6, family: 'fx' });
        this.h.heat(0.05);
        return true;
      case 'Launch': this.launch(e, t, when, var01); return true;
      case 'Splash':
        this.cue(id, 'splash', var01, p, when, clamp(0.45 + 0.1 * e.mag, 0.45, 0.9), { family: 'fx' });
        return true;
      case 'Spawn': return true; // fracture replacement, corks, Yolks: the matching Break/Launch carries the sound
      case 'Despawn':
        if (t === 'scoop') this.cue(id, 'scoopFill', var01, p, when, 0.5);
        return t !== 'goby' && t !== 'mochi' && t !== 'pip' && t !== 'bandit'; // critter despawns go to critters.ts
      case 'Note': {
        if (t === 'gotcha_box') this.simNotes.add(id);
        this.cue(id, 'tine', var01, p, when, 0.5, { rate: tineRate(noteMidi(e.mag)) });
        return true;
      }
      case 'Sound': this.h.heat(clamp((e.mag - 70) / 400, 0, 0.1)); return true; // perceptual (critters hear it); its source has its own cue
      case 'Break': this.breakage(e, t, when, var01); return true;
      case 'Jam': this.cue(id, 'grind', var01, p, when, 0.55); return true;
      case 'Brownout': this.cue(id, 'sag', var01, p, when, 0.5); return true;
      case 'Press':
        if (t === 't_plunger') { this.cue(id, 'plunger', var01, p, when, 0.7); return true; }
        if (t === 'puffer') { this.cue(id, e.mag > 4 ? 'bellowsBig' : 'bellows', var01, p, when, clamp(0.4 + 0.08 * e.mag, 0.4, 0.9)); return true; }
        if (t === 'toggle') { this.cue(id, 'toggle', var01, p, when, 0.6); return true; }
        return false;
      case 'Signal':
        if (t === 'flap') this.cue(id, 'flap', var01, p, when, 0.6, { rate: 1.05 });
        else if (t === 'delay') this.cue(id, 'delayChirp', var01, p, when, 0.4);
        return false; // the relay click still plays
      case 'Pop':
        if (t === 'gotcha_box') { this.launch(e, t, when, var01); return true; }
        return false;
      case 'Impact': return this.impact(e, t, when, var01);
      default: return false;
    }
  }

  private launch(e: SimEventLike, t: string, when: number, var01: number): void {
    const id = e.part, p = e.pos;
    const g = (lo: number) => clamp(lo + e.mag / 20, lo, 1);
    switch (t) {
      case 'skyrocket': this.cue(id, 'rocketLaunch', var01, p, when, 0.9, { family: 'fx', prio: 1.5 }); this.h.heat(0.1); break;
      case 'big_top':
        this.cue(id, 'bigTop', var01, p, when, g(0.8), { family: 'fx', prio: 1.8 });
        this.cue(id, 'slideWhistle', var01, p, when + 0.06, 0.25, { family: 'fx' });
        this.h.heat(0.2);
        break;
      case 'cork_blaster':
        this.cue(id, 'corkPop', var01, p, when, 0.85, { family: 'fx', prio: 1.3 });
        this.cue(id, 'corkZip', var01, p, when + 0.07, 0.45);
        break;
      case 'punchline': this.cue(id, 'punch', var01, p, when, g(0.7), { family: 'fx' }); break;
      case 'gotcha_box': {
        this.cue(id, 'gotchaPop', var01, p, when, 0.85, { family: 'fx', prio: 1.4 });
        const s = this.parts.get(id);
        if (s) s.popped = true;
        break;
      }
      case 'sprong': this.cue(id, 'sprong', var01, p, when, g(0.6), { rate: clamp(1.2 - e.mag / 40, 0.8, 1.2) }); break;
      case 'puffer': this.cue(id, e.mag > 4 ? 'bellowsBig' : 'bellows', var01, p, when, g(0.5)); break;
      case 't_plunger': this.cue(id, 'plunger', var01, p, when, 0.7); break;
      case 'flinger': case 'snaptrap': this.cue(id, 'punch', var01, p, when, 0.5, { rate: 1.2 }); break;
      default: this.cue(id, 'puff', var01, p, when, 0.5, { family: 'fx' });
    }
  }

  private breakage(e: SimEventLike, t: string, when: number, var01: number): void {
    const id = e.part, p = e.pos;
    if (t === 'fishbowl') {
      this.cue(id, 'shatter', var01, p, when, 0.9, { family: 'fx', prio: 1.8 });
      this.cue(id, 'waterBurst', var01, p, when + 0.02, 0.8, { family: 'fx', prio: 1.5 });
      this.h.heat(0.15);
    } else if (t === 'pane' || t === 'vase') {
      this.cue(id, 'shatter', var01, p, when, t === 'pane' ? 0.85 : 0.7, { family: 'fx', prio: 1.5, rate: t === 'vase' ? 1.1 : 1 });
      this.h.heat(0.08);
    } else if (t === 'plank') this.cue(id, 'splinter', var01, p, when, 0.75, { family: 'fx' });
    else if (t === 'brik') this.cue(id, 'debris/brick', var01, p, when, 0.5, { family: 'fx' });
    else this.cue(id, 'debris/wood', var01, p, when, 0.4, { family: 'fx' });
  }

  private impact(e: SimEventLike, t: string, when: number, var01: number): boolean {
    const J = Math.max(0, e.mag);
    if (t === 'sprong' && J >= 0.5) {
      this.cue(e.part, 'sprong', var01, e.pos, when, clamp(Math.log10(1 + J * 2), 0.25, 1), { rate: clamp(1.25 - 0.08 * Math.log2(1 + J), 0.8, 1.25) });
      return true;
    }
    if (t === 'trap_box' && J >= 3 && !this.fresh(e.part, 'trapSlam', 0.5)) {
      this.cue(e.part, 'trapSlam', var01, e.pos, when, clamp(0.4 + J / 30, 0.4, 0.9), { family: 'fx' });
      return true;
    }
    return false;
  }

  /** Called when a critter is trapped (Trapped event): cage slam if the impact didn't already play it, then the flag's ding. */
  trapped(boxId: number, pos: Vec3, when: number, var01: number): void {
    if (!this.fresh(boxId, 'trapSlam', 0.6)) this.cue(boxId, 'trapSlam', var01, pos, when, 0.75, { family: 'fx' });
    this.cue(boxId, 'ding', var01, pos, when + 0.25, 0.45);
  }

  /** Per running part per frame: state loops and flag-edge fallbacks (AUDIO §5). */
  part(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: Q | null, dt: number, edges: boolean): void {
    if (!finite3(pos)) return;
    if (!Number.isFinite(meter)) meter = 0;
    const h = this.h, now = h.now();
    let s = this.parts.get(id);
    if (!s || s.type !== type) {
      s = { type, flags, meter, motion: new Motion(pos), rot, spin: 0, seen: now, tune: 0, tuneIdx: 0, popped: false };
      this.parts.set(id, s);
    }
    const prev = s.flags;
    s.flags = flags; s.meter = meter; s.seen = now;
    s.motion.update(pos, dt);
    if (rot && Number.isFinite(rot[0]) && Number.isFinite(rot[1]) && Number.isFinite(rot[2]) && Number.isFinite(rot[3])) {
      // ω from the moving body's rotation between distinct samples (capped: a scrub or reset is not a 10 krpm spin)
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
    const v01 = hash01(id, h.tick(), hashStr(type));
    const w = s.spin;
    const L = (kind: Parameters<AudioHost['loop']>[1], level: number, o?: Parameters<AudioHost['loop']>[4]) => h.loop(`${kind}:${id}`, kind, pos, level, o);
    switch (type) {
      case 'dynamo':
        if (w > 0.4) L('dynamo', w / 8, { aux: clamp((40 * w) / 300, 0.15, 1) });
        else if (flags & F.powered) L('dynamo', 0.6, { aux: 0.5 });
        break;
      case 'turbine': if (w > 0.3) L('turbine', w / 12); break;
      case 'hamster_drive': if (w > 0.3) L('wheel', w / 5); break;
      case 'pedal_rig': if (w > 0.5) L('chain', w / 18.85); break;
      case 'lamp':
        if (flags & (F.lit | F.powered)) L('filament', 1);
        if (rise(F.lit) && !this.fresh(id, 'lampOn')) this.cue(id, 'lampOn', v01, pos, now, 0.5);
        if (fall(F.lit) && !this.fresh(id, 'lampOff')) this.cue(id, 'lampOff', v01, pos, now, 0.4);
        break;
      case 'torch':
        if ((rise(F.lit) || fall(F.lit)) && !this.fresh(id, 'torch')) this.cue(id, 'torch', v01, pos, now, 0.45, { rate: flags & F.lit ? 1.05 : 0.9 });
        break;
      case 'suncell':
        if (flags & F.lit) L('shimmer', meter > 0 ? clamp(meter / 20, 0.2, 1) : 0.6);
        if (rise(F.lit) && !this.fresh(id, 'suncellTick')) this.cue(id, 'suncellTick', v01, pos, now, 0.35);
        break;
      case 'cell':
        if (flags & F.powered) L('cell', 1);
        if (fall(F.powered) && !this.fresh(id, 'sag')) this.cue(id, 'sag', v01, pos, now, 0.4);
        break;
      case 'burning_glass':
        if (flags & F.lit) L('sizzle', meter > 0 ? clamp(meter / 20, 0.3, 1.2) : 1);
        if (rise(F.lit) && !this.fresh(id, 'focusTink')) this.cue(id, 'focusTink', v01, pos, now, 0.4);
        break;
      case 'ringer':
        if (flags & F.armed) L('ringer', meter > 0 && meter <= 3 ? 1.6 : 1);
        if (rise(F.armed)) this.cue(id, 'ringerWind', v01, pos, now, 0.45);
        if (fall(F.armed) && !this.fresh(id, 'ringerBell', 0.5)) this.cue(id, 'ringerBell', v01, pos, now, 0.75, { prio: 1.6, family: 'fx' });
        break;
      case 'delay': if (flags & F.armed) L('delay', 1); break;
      case 'skyrocket': if (flags & F.lit) L('thrust', 1, { doppler: true }); break;
      case 'big_top': if (flags & F.armed) L('fuse', 0.7); break;
      case 'fishbowl':
        if (!(flags & F.broken) && dist(pos, h.listener()) < 6) L('bubbles', 1);
        if (rise(F.broken) && !this.fresh(id, 'shatter', 0.5)) this.breakage({ tick: h.tick(), kind: 'Break', part: id, pos: [pos[0], pos[1], pos[2]], mag: 0 }, type, now, v01);
        break;
      case 'toggle':
        if ((rise(F.powered) || fall(F.powered)) && !this.fresh(id, 'toggle')) this.cue(id, 'toggle', v01, pos, now, 0.6, { rate: flags & F.powered ? 1.06 : 0.9 });
        break;
      case 'gotcha_box': {
        const cranking = w > 0.5 || (flags & F.powered) !== 0;
        if (cranking && !s.popped) {
          const lvl = w > 0.5 ? clamp(w / 6, 0.3, 1.6) : 0.7;
          L('crank', lvl);
          if (!this.simNotes.has(id)) {
            s.tune += dt * 3.2 * lvl;
            while (s.tune >= 1) {
              s.tune -= 1;
              const n = GOTCHA_TUNE[s.tuneIdx++ % GOTCHA_TUNE.length]!;
              if (n > 0) this.cue(id, 'tine', hash01(id, s.tuneIdx), pos, now, 0.45, { rate: tineRate(n) });
            }
          }
        }
        break;
      }
      case 'vortex': case 'vortex_slim': {
        const r = type === 'vortex' ? 0.4 : 0.2;
        if (!this.vortices.some((v) => dist(v.pos, pos) < 0.01)) this.vortices.push({ pos: [pos[0], pos[1], pos[2]], r });
        break;
      }
      default:
    }
  }

  /**
   * Rolling bodies (AUDIO §3): picks the surface layer. Vortex → rising spiral loop; on a gutter/tube path →
   * resonant path roll; on the floor → the M1 material roll.
   */
  roller(id: string, type: string, pos: Vec3, dt: number, variant: string): void {
    if (!finite3(pos)) return;
    let m = this.rollers.get(id);
    if (!m) { m = new Motion(pos); this.rollers.set(id, m); return; }
    m.update(pos, dt);
    const v = m.speed;
    if (v < 0.05) return;
    for (const vt of this.vortices) {
      const dx = pos[0] - vt.pos[0], dz = pos[2] - vt.pos[2];
      const r = Math.hypot(dx, dz);
      if (r > vt.r * 1.05 || pos[1] < vt.pos[1] - 0.2 || pos[1] > vt.pos[1] + 0.6) continue;
      const vt01 = Math.abs((-dz * m.vel[0] + dx * m.vel[2]) / Math.max(r, 1e-3));
      const omega = vt01 / Math.max(r, 0.03);
      this.h.loop(`${id}:spiral`, 'spiral', pos, clamp(omega / 15, 0.25, 1.6), { aux: clamp(v / 2, 0.2, 1.2) });
      return;
    }
    for (const p of this.paths) {
      if (segDist(pos, p.pts) > p.r) continue;
      const kind = p.kind.startsWith('gutter') ? 'roll/gutter' : 'roll/tube';
      this.h.loop(`${id}:${kind}`, 'roll', pos, Math.min(1.6, v / 4), { variant: kind });
      return;
    }
    const vh = Math.hypot(m.vel[0], m.vel[2]);
    if (vh > 0.05 && pos[1] < 0.3) this.h.loop(`${id}:${variant}`, 'roll', pos, Math.min(1, vh / 5), { variant });
    void type;
  }
}

function segDist(p: Vec3, pts: readonly Vec3[]): number {
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
