// M5 ambience sounds (AUDIO.md §9, environments.md §5.6 ORBITAL HANGAR and §6.7 MOON BASE). The director logic
// is in ambience.ts (Ambience.hangar() / moon()); W5 wired the environments and their emitter positions
// (parts-data env_space.ts). Everything is procedural from fixed seeds; the PA "voice" is a wordless murmur.

import type { Recipe } from './bank';
import type { Rng } from './rng';
import { SR, alloc, bp, brown, chirp, contact, envFn, fadeEdges, hp, lp, mixInto, modal, normalize, seamless, white } from './synth';

const at = (s: number): number => Math.round(s * SR);
const TAU = Math.PI * 2;

// ---- ORBITAL HANGAR ----

function hangarRoom(rng: Rng): Float32Array {
  return normalize(seamless(12, 0.8, (len) => {
    // the air handlers: a broad low rumble, two fans' blade-pass tones wobbling slightly, vent flow in slow swells,
    // and a faint high air hiss. Steady, clean, a little bigger than the classroom (environments.md §5.6, −44 LUFS)
    const x = normalize(lp(brown(len, rng), 240), 0.5);
    for (const [f, a, w] of [[58, 0.16, 0.11], [87, 0.08, 0.07], [116, 0.06, 0.13], [61.5, 0.1, 0.09]] as const) {
      mixInto(x, chirp(len, (t) => f * (1 + 0.004 * Math.sin(TAU * w * t)), () => a));
    }
    const vent = bp(white(len, rng), 1300, 0.45);
    for (let i = 0; i < len; i++) { const t = i / SR; vent[i] = vent[i]! * (0.7 + 0.18 * Math.sin(TAU * t / 12 + 0.4) + 0.12 * Math.sin(TAU * t / 4 + 1.3)); }
    mixInto(x, normalize(vent, 0.22));
    mixInto(x, normalize(hp(white(len, rng), 6000), 0.03));
    return x;
  }), 0.3);
}

function zeroGRing(rng: Rng): Float32Array {
  return normalize(seamless(4, 0.4, (len) => {
    // the floor ring's field: a low soft drone (a fifth, slowly beating) with a faint shimmer, 6 m radius
    const x = chirp(len, (t) => 70 * (1 + 0.003 * Math.sin(TAU * 0.25 * t)), (t) => 0.8 + 0.2 * Math.sin(TAU * 0.25 * t));
    mixInto(x, chirp(len, () => 105.5, () => 0.4));
    mixInto(x, chirp(len, () => 140, (t) => 0.15 * (0.5 + 0.5 * Math.sin(TAU * 0.5 * t))));
    const sh = bp(white(len, rng), 2600, 1.2);
    envFn(sh, (t) => 0.5 + 0.5 * Math.sin(TAU * 0.75 * t));
    mixInto(x, normalize(sh, 0.05));
    return x;
  }), 0.3);
}

/** A two-tone PA chime (bing-bong) and a wordless announcement murmur through a small speaker. */
function paChime(rng: Rng, v: number): Float32Array {
  const x = alloc(4.2);
  const [a, b] = v % 2 ? [784, 659] : [659, 523];
  for (const [f, t0] of [[a, 0], [b, 0.42]] as const) {
    mixInto(x, modal(at(1.6), contact(0.0002, rng), [{ f, amp: 1, tau: 0.6 }, { f: f * 2, amp: 0.25, tau: 0.3 }, { f: f * 3.01, amp: 0.08, tau: 0.15 }]), at(t0), 0.7);
  }
  // the murmur: syllable-rate bursts of formant-coloured noise (no words, no voice pitch), 1.4–3.6 s
  const m = alloc(2.2);
  const n = white(m.length, rng);
  let env = 0, target = 0, next = 0;
  for (let i = 0; i < m.length; i++) {
    const t = i / SR;
    if (t >= next) { target = rng.chance(0.75) ? 0.5 + 0.5 * rng.next() : 0; next = t + 0.08 + 0.14 * rng.next(); }
    env += (target - env) * 0.004;
    m[i] = n[i]! * env * Math.sin(Math.PI * Math.min(1, t / 2.2));
  }
  const f1 = bp(m.slice(), 650, 2), f2 = bp(m.slice(), 1500, 3), f3 = bp(m, 2600, 4);
  for (let i = 0; i < f1.length; i++) f1[i] = f1[i]! + 0.6 * f2[i]! + 0.25 * f3[i]!;
  mixInto(x, normalize(lp(hp(f1, 320), 3400), 0.45), at(1.4));
  return fadeEdges(normalize(x, 0.3), 0.01, 0.3);
}

function radioBeeps(rng: Rng, v: number): Float32Array {
  // sparse radio beeps between the announcements: a short pattern, then a squelch tail
  const x = alloc(1.2);
  const n = 1 + (v % 3), f = 1050 + 450 * rng.next();
  for (let k = 0; k < n; k++) mixInto(x, chirp(at(0.07), () => f * (k === n - 1 && v % 2 ? 1.25 : 1), (t) => Math.sin(Math.PI * t / 0.07)), at(k * 0.12), 0.6);
  const sq = bp(white(at(0.08), rng), 2200, 0.8);
  envFn(sq, (t) => Math.exp(-t / 0.02));
  mixInto(x, normalize(sq, 0.25), at(n * 0.12 + 0.05));
  return fadeEdges(normalize(lp(hp(x, 350), 3600), 0.22));
}

function gantryServo(rng: Rng, v: number): Float32Array {
  // the static gantry's servos (sound only): a whir that rises and settles, then a soft clunk
  const sec = 1.6 + 0.4 * (v % 2);
  const x = alloc(sec + 0.6);
  const w = chirp(at(sec), (t) => 420 + 260 * Math.sin(Math.PI * Math.min(1, t / sec)), (t) => Math.sin(Math.PI * t / sec) ** 0.6);
  mixInto(w, chirp(at(sec), (t) => 2 * (420 + 260 * Math.sin(Math.PI * Math.min(1, t / sec))), (t) => 0.25 * Math.sin(Math.PI * t / sec)));
  mixInto(x, w, 0, 0.5);
  mixInto(x, normalize(bp(white(at(sec), rng), 900, 1), 0.08));
  mixInto(x, modal(at(0.5), contact(0.002, rng, 0.3), [{ f: 180, amp: 1, tau: 0.08 }, { f: 520, amp: 0.4, tau: 0.05 }]), at(sec), 0.6);
  return fadeEdges(normalize(lp(x, 5000), 0.26));
}

// ---- MOON BASE: "listening through a suit radio" ----

function moonRoom(rng: Rng): Float32Array {
  return normalize(seamless(12, 0.8, (len) => {
    // faint radio static (band-limited, slowly fluctuating, a few soft crackles), the suit's breathing fan on a slow
    // 4 s cycle, and a very low drone (environments.md §6.7, −50 LUFS)
    const st = bp(white(len, rng), 2200, 0.7);
    for (let i = 0; i < len; i++) { const t = i / SR; st[i] = st[i]! * (0.55 + 0.25 * Math.sin(TAU * t / 6 + 0.7) + 0.2 * Math.sin(TAU * t / 2.4)); }
    const x = normalize(st, 0.18);
    for (let k = 0; k < 18; k++) {
      const c = hp(white(at(0.004), rng), 1800);
      mixInto(x, normalize(c, 0.06 + 0.06 * rng.next()), at(rng.next() * (len / SR - 0.01)));
    }
    const fan = bp(white(len, rng), 380, 0.9);
    for (let i = 0; i < len; i++) { const t = i / SR; const ph = (t % 4) / 4; fan[i] = fan[i]! * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * ph), 2)); }
    mixInto(x, normalize(fan, 0.3));
    mixInto(x, chirp(len, () => 45, () => 0.22));
    mixInto(x, chirp(len, (t) => 67.5 * (1 + 0.003 * Math.sin(TAU * t / 12)), () => 0.1));
    return x;
  }), 0.3);
}

function domeHum(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.25, (len) => {
    // the habitat's machinery through the ground (structure-borne: low, dull)
    const x = chirp(len, () => 50, () => 1);
    mixInto(x, chirp(len, () => 100, () => 0.45));
    mixInto(x, chirp(len, () => 150, () => 0.2));
    mixInto(x, normalize(lp(white(len, rng), 380), 0.35));
    return lp(x, 600);
  }), 0.3);
}

function moonBeacon(rng: Rng): Float32Array {
  // a 2 s loop: one soft radio blip at the top, synced to the antenna's 0.5 Hz blink
  const x = alloc(2.0);
  mixInto(x, chirp(at(0.05), () => 1240, (t) => Math.sin(Math.PI * t / 0.05)), at(0.01), 0.6);
  const sq = bp(white(at(0.06), rng), 2000, 1);
  envFn(sq, (t) => Math.exp(-t / 0.015));
  mixInto(x, normalize(sq, 0.12), at(0.065));
  return normalize(lp(hp(x, 400), 3200), 0.2);
}

function radioStatic(rng: Rng, v: number): Float32Array {
  // a burst of suit-radio static: crackle in and out (wordless)
  const sec = 0.35 + 0.15 * (v % 3);
  const x = bp(white(at(sec), rng), 1800 + 500 * rng.next(), 0.6);
  envFn(x, (t) => Math.sin(Math.PI * t / sec) * (0.6 + 0.4 * Math.sign(Math.sin(TAU * (9 + 5 * rng.next()) * t))));
  for (let k = 0; k < 10; k++) mixInto(x, normalize(hp(white(at(0.003), rng), 2000), 0.5), at(rng.next() * (sec - 0.005)));
  return fadeEdges(normalize(lp(x, 4000), 0.2));
}

export function spaceAmbienceRecipes(): Recipe[] {
  return [
    ['amb/hangar/room', 1, hangarRoom], ['amb/hangar/zerog_ring', 1, zeroGRing], ['amb/hangar/chime', 2, paChime], ['amb/hangar/radio', 4, radioBeeps],
    ['amb/hangar/servo', 3, gantryServo],
    ['amb/moon/room', 1, moonRoom], ['amb/moon/dome_hum', 1, domeHum], ['amb/moon/beacon', 1, moonBeacon], ['amb/moon/static', 3, radioStatic],
  ];
}
