// Critters v1 (AUDIO.md §7, critter briefs): procedural cartoon voices for Mochi, Pip, Goby and Bandit, species
// footsteps, and the director that drives them from run.critters (contract 3: [clip, flags, emote, fsm] per part)
// and the CritterState / Emote / Ragdoll / Getup / Trapped events. Everything is positional at the critter.
//
// AUDIO §7 asks for voice actors; until that session these formant-synth barks stand in (same cue names).
// Never realistic distress: every vocal is short, bright and comedic.

import * as partsData from '@knockon/parts-data';
import { impact, type Recipe } from './bank';
import { hash01, hashStr, type Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, glide, hp, keys, lp, mixInto, modal, normalize, seamless,
  voice, white, type Formant,
} from './synth';
import { Motion, clamp, finite3, type AudioHost, type SimEventLike, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);
const fm = (f: number, bw: number, amp: number): Formant => ({ f, bw, amp });

// ============================================================================================
// sounds
// ============================================================================================

// ---- Mochi (cat) ----

function meow(rng: Rng, o: { dur?: number; lo?: number; hi?: number; tense?: number; wobble?: number } = {}): Float32Array {
  const dur = (o.dur ?? 0.6) * (0.9 + 0.2 * rng.next());
  const lo = (o.lo ?? 420) * (1 + rng.bi() * 0.06), hi = (o.hi ?? 680) * (1 + rng.bi() * 0.06);
  const pk = 0.3 + 0.1 * rng.next();
  const f0 = keys([[0, lo], [pk * dur, hi], [dur, lo * 0.85]]);
  const wob = o.wobble ?? 0;
  const q = 1 + (o.tense ?? 0);
  // m-ee-ow: formants move from a closed "i" to an open "a" to a rounded "u"
  const F1 = keys([[0, 380], [pk * dur, 900], [dur, 480]]), F2 = keys([[0, 2400], [pk * dur, 1550], [dur, 900]]), F3 = keys([[0, 3100], [dur, 2600]]);
  const x = voice(dur, (t) => f0(t) * (1 + wob * Math.sin(2 * Math.PI * 6 * t)),
    (t) => [fm(F1(t), 120 / q, 1), fm(F2(t), 180 / q, 0.7), fm(F3(t), 260 / q, 0.35)],
    (t) => Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.08), rng, { breath: 0.12, jitter: 0.02 });
  return fadeEdges(normalize(x, 0.5), 0.002, 0.02);
}

function mrrp(rng: Rng): Float32Array {
  const dur = 0.28 + 0.08 * rng.next();
  const f0 = keys([[0, 360], [dur, 560 * (1 + rng.bi() * 0.08)]]);
  const x = voice(dur, f0, () => [fm(500, 120, 1), fm(1500, 200, 0.6), fm(2700, 300, 0.25)],
    (t) => Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.05) * (t < 0.1 ? 0.55 + 0.45 * Math.sin(2 * Math.PI * 28 * t) : 1), rng, { breath: 0.1 });
  return fadeEdges(normalize(x, 0.45));
}

function hiss(rng: Rng): Float32Array {
  const dur = 0.55 + 0.15 * rng.next();
  const x = hp(white(at(dur), rng), 2500);
  bp(x, 5200, 0.7);
  envFn(x, (t) => Math.min(1, t / 0.02) * (t > dur - 0.12 ? (dur - t) / 0.12 : 1) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 9 * t)));
  // a little "kh" spit at the start
  mixInto(x, normalize(bp(envAD(white(at(0.04), rng), 0.001, 0.01), 1800, 1), 0.8));
  return fadeEdges(normalize(x, 0.45));
}

function grumble(rng: Rng): Float32Array {
  const dur = 0.6;
  const x = voice(dur, keys([[0, 240], [0.35, 300], [dur, 220]]), () => [fm(600, 150, 1), fm(1200, 200, 0.6), fm(2500, 300, 0.2)],
    (t) => Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.1) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 30 * t)), rng, { breath: 0.08 });
  return fadeEdges(normalize(x, 0.45));
}

function chatter(rng: Rng, f: number, n: number, rate: number): Float32Array {
  const x = alloc(n / rate + 0.1);
  for (let k = 0; k < n; k++) {
    const d = 0.04 + 0.02 * rng.next();
    const s = voice(d, () => f * (1 + rng.bi() * 0.1), () => [fm(900, 150, 1), fm(2100, 250, 0.6)], (t) => Math.sin(Math.PI * t / d), rng, { breath: 0.15 });
    mixInto(x, normalize(s, 0.4 + 0.3 * rng.next()), at(k / rate));
  }
  return fadeEdges(normalize(x, 0.45));
}

function hup(rng: Rng): Float32Array {
  const x = voice(0.09, glide(520, 380, 0.04), () => [fm(700, 140, 1), fm(1300, 200, 0.5)], (t) => Math.min(1, t / 0.008) * Math.exp(-t / 0.04), rng, { breath: 0.3 });
  return fadeEdges(normalize(x, 0.4));
}

function purrLoop(rng: Rng): Float32Array {
  // a breathing purr: inhale (quieter, faster pulses) then exhale; pulses are filtered noise bursts
  return normalize(seamless(2.4, 0.2, (len) => {
    const x = new Float32Array(len);
    const n = lp(white(len, rng), 900);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = (i / SR) % 2.4;
      const inhale = t < 1.1;
      const rate = inhale ? 28 : 25;
      ph += rate / SR;
      const pulse = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * (ph % 1)), 3);
      const breath = inhale ? 0.45 * Math.sin(Math.PI * t / 1.1) : Math.sin(Math.PI * (t - 1.1) / 1.3);
      x[i] = n[i]! * pulse * (0.15 + 0.85 * breath);
    }
    mixInto(x, normalize(lp(brown(len, rng), 120), 0.15));
    return x;
  }), 0.3);
}

function snoreLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.2, (len) => {
    const x = new Float32Array(len);
    const n = white(len, rng);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = (i / SR) % 3;
      ph += 32 / SR;
      const inh = t < 1.0 ? Math.sin(Math.PI * t) : 0;
      const exh = t > 1.4 && t < 2.6 ? 0.5 * Math.sin(Math.PI * (t - 1.4) / 1.2) : 0;
      x[i] = n[i]! * (inh * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * (ph % 1)), 2) + exh * 0.4);
    }
    bp(x, 500, 1.2);
    return x;
  }), 0.25);
}

function pawStep(rng: Rng, f: number, w: number, noiseF: number): Float32Array {
  const x = modal(at(0.12), contact(w, rng, 0.2), [{ f: f * (1 + rng.bi() * 0.08), amp: 1, tau: 0.02 }, { f: f * 2.2, amp: 0.4, tau: 0.012 }]);
  mixInto(x, normalize(lp(envAD(white(at(0.05), rng), 0.002, 0.012), noiseF), 0.4));
  return fadeEdges(normalize(x, 0.25));
}

// ---- Pip (hamster) ----

function squeak(rng: Rng, o: { dur?: number; f?: number; up?: number; vib?: number } = {}): Float32Array {
  const dur = (o.dur ?? 0.09) * (0.8 + 0.4 * rng.next());
  const f = (o.f ?? 2900) * (1 + rng.bi() * 0.08), up = o.up ?? 1.25, vib = o.vib ?? 0;
  const x = chirp(at(dur), (t) => f * (1 + (up - 1) * Math.sin(Math.PI * t / dur)) * (1 + vib * Math.sin(2 * Math.PI * 38 * t)), (t) => Math.sin(Math.PI * t / dur));
  mixInto(x, chirp(at(dur), (t) => 2 * f * (1 + (up - 1) * Math.sin(Math.PI * t / dur)), (t) => 0.2 * Math.sin(Math.PI * t / dur)));
  return fadeEdges(normalize(x, 0.4));
}

function pipChitter(rng: Rng): Float32Array {
  const n = 4 + rng.int(3);
  const x = alloc(n / 14 + 0.15);
  for (let k = 0; k < n; k++) mixInto(x, squeak(rng, { dur: 0.05, f: 2600 + 900 * rng.next() }), at(k / 14), 0.5 + 0.5 * rng.next());
  return fadeEdges(normalize(x, 0.4));
}

function pipTrill(rng: Rng): Float32Array {
  const dur = 0.3;
  const x = chirp(at(dur), (t) => 3200 * (1 + 0.12 * Math.sin(2 * Math.PI * 24 * t)) * (1 + 0.15 * t / dur), (t) => Math.sin(Math.PI * t / dur));
  void rng;
  return fadeEdges(normalize(x, 0.38));
}

function wheee(rng: Rng): Float32Array {
  const dur = 0.5;
  const x = chirp(at(dur), (t) => (2400 + 1800 * Math.sin(Math.PI * Math.min(1, t / dur) * 0.8)) * (1 + 0.02 * rng.bi()), (t) => Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.1));
  return fadeEdges(normalize(x, 0.38));
}

function huff(rng: Rng, f: number): Float32Array {
  const x = alloc(0.32);
  for (const t0 of [0, 0.15]) mixInto(x, normalize(bp(envAD(white(at(0.12), rng), 0.008, 0.03), f, 1.2), t0 ? 0.7 : 1), at(t0));
  return fadeEdges(normalize(x, 0.3));
}

function patterLoop(rng: Rng): Float32Array {
  // wheel_run at 1×: a 0.33 s cycle of 4 footfalls → 3 cycles per second, plus a soft wheel tick per cycle
  const x = alloc(1);
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 4; k++) mixInto(x, pawStep(rng, 1400, 0.0004, 5000), at(c / 3 + k / 12 + rng.next() * 0.005), 0.5 + 0.3 * rng.next());
    mixInto(x, modal(at(0.05), contact(0.0002, rng), [{ f: 2200, amp: 1, tau: 0.006 }]), at(c / 3), 0.2);
  }
  return normalize(x, 0.3);
}

// ---- Goby (goldfish) ----

function bloop(rng: Rng): Float32Array {
  const x = bubble(0.12, 280 + 180 * rng.next(), 1.6 + rng.next(), 0.035);
  mixInto(x, normalize(lp(envAD(white(at(0.03), rng), 0.001, 0.008), 800), 0.15));
  return fadeEdges(normalize(x, 0.4));
}

function burble(rng: Rng): Float32Array {
  const n = 3 + rng.int(4);
  const x = alloc(n * 0.07 + 0.15);
  for (let k = 0; k < n; k++) mixInto(x, bloop(rng), at(k * (0.05 + 0.03 * rng.next())), 0.5 + 0.5 * rng.next());
  return fadeEdges(normalize(x, 0.4));
}

function gulp(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, voice(0.07, glide(220, 160, 0.03), () => [fm(400, 100, 1), fm(900, 150, 0.4)], (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.03), rng, { breath: 0.05 }), 0, 0.6);
  mixInto(x, bloop(rng), at(0.06), 0.8);
  return fadeEdges(normalize(x, 0.4));
}

function gasp(rng: Rng): Float32Array {
  const x = voice(0.12, glide(380, 520, 0.05), () => [fm(650, 140, 1), fm(1100, 180, 0.5)], (t) => Math.sin(Math.PI * t / 0.12), rng, { breath: 0.35 });
  return fadeEdges(normalize(x, 0.35));
}

function flopSlap(rng: Rng): Float32Array {
  const x = alloc(0.3);
  mixInto(x, normalize(hp(envAD(white(at(0.06), rng), 0.0003, 0.012), 600), 0.9));
  mixInto(x, chirp(at(0.12), glide(170, 120, 0.03), (t) => Math.exp(-t / 0.03)), 0, 0.5);
  mixInto(x, normalize(bp(envAD(white(at(0.1), rng), 0.002, 0.03), 4000, 0.8), 0.25));
  for (let k = 0; k < 2; k++) mixInto(x, normalize(bubble(0.04, 1200 + 1500 * rng.next(), 0.5, 0.01), 0.25), at(0.03 + 0.06 * rng.next()));
  return fadeEdges(normalize(x, 0.4));
}

function bubblePop(rng: Rng): Float32Array {
  const x = alloc(0.4);
  mixInto(x, normalize(hp(envAD(white(at(0.02), rng), 0.0001, 0.003), 1500), 0.7));
  [2600, 3900, 5200].forEach((f, k) => mixInto(x, chirp(at(0.3), () => f, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.08)), at(0.01 + 0.03 * k), 0.3));
  return fadeEdges(normalize(x, 0.35));
}

// ---- Bandit (raccoon) ----

function banditChitter(rng: Rng, n: number): Float32Array {
  const x = alloc(n / 12 + 0.15);
  for (let k = 0; k < n; k++) {
    const d = 0.045 + 0.025 * rng.next();
    const f0 = 900 + 400 * rng.next();
    const s = voice(d, (t) => f0 * (1 + 0.15 * t / d), () => [fm(550, 110, 1), fm(1650, 160, 0.7), fm(2800, 260, 0.3)],
      (t) => Math.sin(Math.PI * t / d), rng, { breath: 0.12 });
    mixInto(x, normalize(s, 0.4 + 0.4 * rng.next()), at(k / 12 + rng.next() * 0.01));
  }
  return fadeEdges(normalize(x, 0.42));
}

function squawk(rng: Rng): Float32Array {
  const dur = 0.3;
  const x = voice(dur, keys([[0, 1150], [0.08, 1300], [dur, 700]]), () => [fm(800, 200, 1), fm(1900, 300, 0.7), fm(3000, 400, 0.3)],
    (t) => Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.06) * (0.55 + 0.45 * Math.sign(Math.sin(2 * Math.PI * 70 * t))), rng, { breath: 0.2, jitter: 0.04 });
  return fadeEdges(normalize(x, 0.45));
}

function snicker(rng: Rng): Float32Array {
  const x = alloc(0.45);
  for (let k = 0; k < 3; k++) {
    const s = voice(0.07, () => 600 + 80 * rng.next(), () => [fm(500, 120, 1), fm(1400, 200, 0.4)], (t) => Math.sin(Math.PI * t / 0.07), rng, { breath: 0.5 });
    mixInto(x, normalize(s, 1 - k * 0.2), at(k * 0.12));
  }
  return fadeEdges(normalize(x, 0.35));
}

function coo(rng: Rng): Float32Array {
  const dur = 0.4;
  const x = voice(dur, keys([[0, 480], [dur * 0.7, 700], [dur, 640]]), () => [fm(450, 100, 1), fm(1100, 160, 0.5), fm(2600, 300, 0.15)],
    (t) => Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.08), rng, { breath: 0.08 });
  return fadeEdges(normalize(x, 0.4));
}

// ---- shared foley ----

function bodyfall(rng: Rng): Float32Array {
  const x = alloc(0.35);
  mixInto(x, chirp(at(0.3), glide(130, 70, 0.03), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.06)), 0, 0.8);
  mixInto(x, normalize(lp(envAD(white(at(0.15), rng), 0.003, 0.04), 1800), 0.6));
  mixInto(x, impact('rubber', 1, rng), 0, 0.4);
  return fadeEdges(normalize(x, 0.45));
}

function shake(rng: Rng): Float32Array {
  const x = alloc(0.65);
  for (let k = 0; k < 5; k++) mixInto(x, normalize(bp(envAD(white(at(0.09), rng), 0.01, 0.03), 1500 + 300 * rng.next(), 0.8), 1 - k * 0.12), at(k / 9));
  return fadeEdges(normalize(x, 0.35));
}

function pedalSqueakLoop(rng: Rng): Float32Array {
  // one crank revolution per second at 1×: two pedal squeaks and a saddle creak
  const x = alloc(1);
  const sq = (f: number): Float32Array => {
    const d = 0.09;
    const s = chirp(at(d), (t) => f * (1 + 0.15 * Math.sin(Math.PI * t / d)), (t) => Math.sin(Math.PI * t / d));
    for (let i = 0; i < s.length; i++) s[i] = Math.tanh(2.5 * s[i]!) * (0.85 + 0.15 * rng.bi());
    return bp(s, f * 1.1, 2);
  };
  mixInto(x, normalize(sq(950), 0.6), at(0.05));
  mixInto(x, normalize(sq(1050), 0.45), at(0.55));
  for (let k = 0; k < 4; k++) mixInto(x, modal(at(0.04), contact(0.0002, rng), [{ f: 3000, amp: 1, tau: 0.003 }]), at(k / 4), 0.15);
  return normalize(x, 0.3);
}


// ---- Biscuit (dog, M4) ----

/** A woof: a rough, pressed voice with a fast pitch drop and an open "wo" formant, plus an "uff" onset. */
function woof(rng: Rng, o: { f?: number; dur?: number; soft?: number } = {}): Float32Array {
  const dur = (o.dur ?? 0.17) * (0.9 + 0.2 * rng.next());
  const f = (o.f ?? 430) * (1 + rng.bi() * 0.07);
  const soft = o.soft ?? 0;
  const f0 = keys([[0, f * 0.92], [dur * 0.25, f * 1.08], [dur, f * 0.6]]);
  const F1 = keys([[0, 550], [dur * 0.3, 820], [dur, 620]]);
  const x = voice(dur, f0, (t) => [fm(F1(t), 160, 1), fm(1250, 220, 0.75), fm(2500, 380, 0.35)],
    (t) => Math.min(1, t / 0.008) * Math.pow(Math.max(0, 1 - t / dur), 0.7), rng, { breath: 0.18 + 0.3 * soft, jitter: 0.05, tilt: 2200 - 1000 * soft });
  const out = alloc(dur + 0.03);
  mixInto(out, normalize(lp(envAD(white(at(0.03), rng), 0.001, 0.008), 1800), 0.5 * (1 - soft)));
  mixInto(out, normalize(x, 1), at(0.004));
  if (soft > 0) lp(out, 2400);
  return fadeEdges(normalize(out, 0.5), 0.001, 0.02);
}

function woofWoof(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, woof(rng));
  mixInto(x, woof(rng, { f: 470 }), at(0.21 + 0.03 * rng.next()), 0.9);
  return fadeEdges(normalize(x, 0.5));
}

function yip(rng: Rng, n = 1): Float32Array {
  const x = alloc(n * 0.13 + 0.05);
  for (let k = 0; k < n; k++) {
    const d = 0.07 + 0.02 * rng.next(), f = 760 + 120 * rng.next();
    mixInto(x, voice(d, glide(f * 1.1, f * 0.8, 0.03), () => [fm(900, 160, 1), fm(1900, 260, 0.6), fm(3000, 400, 0.25)],
      (t) => Math.min(1, t / 0.005) * Math.max(0, 1 - t / d), rng, { breath: 0.12, jitter: 0.03 }), at(k * (0.11 + 0.03 * rng.next())), 0.8 + 0.2 * rng.next());
  }
  return fadeEdges(normalize(x, 0.45));
}

function whine(rng: Rng): Float32Array {
  const dur = 0.5 + 0.15 * rng.next();
  const f0 = keys([[0, 680], [dur * 0.4, 960], [dur, 780]]);
  const x = voice(dur, (t) => f0(t) * (1 + 0.025 * Math.sin(2 * Math.PI * 6 * t)), () => [fm(420, 90, 1), fm(2100, 200, 0.7), fm(3200, 300, 0.2)],
    (t) => Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.1), rng, { breath: 0.08, jitter: 0.01, tilt: 3500 });
  return fadeEdges(normalize(x, 0.38));
}

function awoo(rng: Rng, wobble = 0.06): Float32Array {
  const dur = 0.75;
  const f0 = keys([[0, 360], [0.3, 570], [dur, 420]]);
  const F1 = keys([[0, 700], [0.3, 600], [dur, 380]]), F2 = keys([[0, 1200], [dur, 800]]);
  const x = voice(dur, (t) => f0(t) * (1 + wobble * Math.sin(2 * Math.PI * 7 * t)), (t) => [fm(F1(t), 120, 1), fm(F2(t), 180, 0.6), fm(2600, 300, 0.2)],
    (t) => Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.15), rng, { breath: 0.1, jitter: 0.015 });
  return fadeEdges(normalize(x, 0.42));
}

function yipHowl(rng: Rng): Float32Array {
  const x = alloc(1.15);
  mixInto(x, yip(rng, 2));
  mixInto(x, awoo(rng, 0.03), at(0.32), 0.9);
  return fadeEdges(normalize(x, 0.45));
}

function sighGroan(rng: Rng): Float32Array {
  const dur = 0.65;
  const x = voice(dur, keys([[0, 210], [0.25, 190], [dur, 130]]), () => [fm(550, 160, 1), fm(1100, 220, 0.4), fm(2400, 300, 0.1)],
    (t) => Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.2), rng, { breath: 0.55, jitter: 0.02, tilt: 1400 });
  return fadeEdges(normalize(x, 0.35));
}

function snuffle(rng: Rng): Float32Array {
  const n = 3 + rng.int(3);
  const x = alloc(n / 8 + 0.1);
  for (let k = 0; k < n; k++) mixInto(x, normalize(bp(envAD(white(at(0.06), rng), 0.004, 0.015), 2500 + 1500 * rng.next(), 1.2), 0.6 + 0.4 * rng.next()), at(k / 8 + 0.01 * rng.next()));
  return fadeEdges(normalize(x, 0.3));
}

function dogGrumble(rng: Rng): Float32Array {
  const dur = 0.65;
  const x = voice(dur, keys([[0, 118], [0.3, 135], [dur, 108]]), () => [fm(480, 120, 1), fm(1000, 180, 0.5), fm(2300, 300, 0.15)],
    (t) => Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.12) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 27 * t)), rng, { breath: 0.12, jitter: 0.03 });
  return fadeEdges(normalize(x, 0.42));
}

function heavyStep(rng: Rng): Float32Array {
  const x = pawStep(rng, 75, 0.007, 900);
  mixInto(x, modal(at(0.03), contact(0.00006, rng), [{ f: 3500 + 1500 * rng.next(), amp: 1, tau: 0.003 }]), at(0.004), 0.12); // nails
  return fadeEdges(normalize(x, 0.28));
}

function pantLoop(rng: Rng): Float32Array {
  // two pant cycles per second at rate 1: a breathy voiced "ha" out, a thinner "hh" in
  const x = alloc(1);
  for (let c = 0; c < 2; c++) {
    const out = voice(0.17, () => 300 + 40 * rng.next(), () => [fm(800, 300, 1), fm(1400, 400, 0.6), fm(2600, 500, 0.3)], (t) => Math.sin(Math.PI * t / 0.17), rng, { breath: 0.9, tilt: 1800 });
    mixInto(x, normalize(out, 0.8), at(c * 0.5 + 0.02));
    mixInto(x, normalize(bp(envFn(white(at(0.14), rng), (t) => Math.sin(Math.PI * t / 0.14)), 2200, 0.8), 0.35), at(c * 0.5 + 0.27));
  }
  return normalize(x, 0.3);
}

function dogSnoreLoop(rng: Rng): Float32Array {
  return normalize(seamless(3.4, 0.2, (len) => {
    const x = new Float32Array(len);
    const n = white(len, rng);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = (i / SR) % 3.4;
      ph += 24 / SR;
      const inh = t < 1.3 ? Math.sin(Math.PI * t / 1.3) : 0;
      const exh = t > 1.7 && t < 3.1 ? 0.5 * Math.sin(Math.PI * (t - 1.7) / 1.4) : 0;
      x[i] = n[i]! * (inh * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * (ph % 1)), 2) + exh * 0.35);
    }
    bp(x, 330, 1.2);
    return x;
  }), 0.28);
}

// ---- Henny (chicken, M4) ----

/** One "bok": a short, harsh, nasal cluck with a plosive onset. */
function cluck(rng: Rng, o: { f?: number; dur?: number; rise?: number } = {}): Float32Array {
  const dur = (o.dur ?? 0.075) * (0.85 + 0.3 * rng.next());
  const f = (o.f ?? 520) * (1 + rng.bi() * 0.08), rise = o.rise ?? 0.8;
  const x = voice(dur, keys([[0, f], [dur, f * rise]]), () => [fm(950, 180, 1), fm(1850, 260, 0.8), fm(3100, 400, 0.35)],
    (t) => Math.min(1, t / 0.004) * Math.pow(Math.max(0, 1 - t / dur), 0.6), rng, { breath: 0.25, jitter: 0.06 });
  const out = alloc(dur + 0.02);
  mixInto(out, normalize(bp(envAD(white(at(0.012), rng), 0.0005, 0.003), 1500, 1), 0.4));
  mixInto(out, normalize(x, 1), at(0.003));
  return fadeEdges(normalize(out, 0.45), 0.0005, 0.01);
}

function clucks(rng: Rng, n: number, gap = 0.16, f = 520): Float32Array {
  const x = alloc(n * gap * 1.3 + 0.15);
  let t = 0;
  for (let k = 0; k < n; k++) { mixInto(x, cluck(rng, { f: f * (1 + 0.06 * rng.bi()) }), at(t), 0.7 + 0.3 * rng.next()); t += gap * (0.7 + 0.6 * rng.next()); }
  return fadeEdges(normalize(x, 0.45));
}

function bagawk(rng: Rng, f = 820, dur = 0.42): Float32Array {
  const f0 = keys([[0, f * 0.85], [dur * 0.3, f * 1.25], [dur, f * 0.75]]);
  const x = voice(dur, f0, () => [fm(1000, 220, 1), fm(1900, 300, 0.75), fm(3200, 450, 0.35)],
    (t) => Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.08) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 34 * t)), rng, { breath: 0.3, jitter: 0.07 });
  return fadeEdges(normalize(x, 0.48));
}

function cackle(rng: Rng): Float32Array {
  const x = alloc(1.1);
  for (let k = 0; k < 6; k++) mixInto(x, cluck(rng, { f: 600 + 40 * k, dur: 0.06 }), at(k * 0.085), 0.6 + 0.07 * k);
  mixInto(x, bagawk(rng, 900, 0.4), at(0.55));
  return fadeEdges(normalize(x, 0.48));
}

function eggSong(rng: Rng): Float32Array {
  const x = alloc(1.15);
  mixInto(x, cluck(rng, { f: 540 }), 0, 0.8);
  mixInto(x, cluck(rng, { f: 560 }), at(0.22), 0.85);
  mixInto(x, bagawk(rng, 780, 0.55), at(0.48));
  return fadeEdges(normalize(x, 0.5));
}

function purrCluck(rng: Rng): Float32Array {
  const dur = 0.5;
  const x = voice(dur, keys([[0, 330], [dur, 300]]), () => [fm(700, 150, 1), fm(1500, 220, 0.5)],
    (t) => Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 22 * t)), rng, { breath: 0.2 });
  return fadeEdges(normalize(x, 0.35));
}

function wingFlaps(rng: Rng, n = 5): Float32Array {
  const x = alloc(n / 11 + 0.15);
  for (let k = 0; k < n; k++) {
    const w = lp(envAD(white(at(0.07), rng), 0.012, 0.018), 700 + 300 * rng.next());
    mixInto(w, normalize(hp(envAD(white(at(0.05), rng), 0.006, 0.01), 4000), 0.15)); // feathers
    mixInto(x, normalize(w, 0.9 - 0.08 * k), at(k / 11));
  }
  return fadeEdges(normalize(x, 0.42));
}

function flapSquawk(rng: Rng): Float32Array {
  const x = alloc(0.65);
  mixInto(x, wingFlaps(rng, 5), 0, 0.8);
  mixInto(x, bagawk(rng, 950, 0.3), at(0.04), 0.9);
  return fadeEdges(normalize(x, 0.48));
}

function roostLoop(rng: Rng): Float32Array {
  return normalize(seamless(3, 0.3, (len) => {
    const x = new Float32Array(len);
    for (const t0 of [0.2, 1.6]) {
      const m = voice(0.9, () => 260 + 20 * rng.next(), () => [fm(600, 150, 1), fm(1300, 200, 0.3)],
        (t) => Math.sin(Math.PI * t / 0.9) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 18 * t)), rng, { breath: 0.35, tilt: 1200 });
      mixInto(x, normalize(m, 0.6 + 0.3 * rng.next()), at(t0));
    }
    return x;
  }), 0.2);
}

function scratch(rng: Rng): Float32Array {
  const x = alloc(0.25);
  for (let k = 0; k < 2; k++) mixInto(x, normalize(bp(envFn(white(at(0.08), rng), (t) => Math.sin(Math.PI * t / 0.08)), 2600, 1), 0.8), at(k * 0.11));
  return fadeEdges(normalize(x, 0.28));
}

function flump(rng: Rng): Float32Array {
  const x = alloc(0.35);
  mixInto(x, chirp(at(0.2), glide(150, 90, 0.03), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.05)), 0, 0.7);
  mixInto(x, normalize(hp(envAD(white(at(0.25), rng), 0.004, 0.06), 3500), 0.35)); // feathers settling
  return fadeEdges(normalize(x, 0.38));
}

// ---- Dusty (robot vacuum, M4): synth chirps ----

function blip(len: number, f: number | ((t: number) => number), soft = 0.4): Float32Array {
  const ff = typeof f === 'number' ? () => f : f;
  const d = len / SR;
  const x = chirp(len, ff, (t) => Math.min(1, t / 0.003) * Math.min(1, (d - t) / 0.01));
  mixInto(x, chirp(len, (t) => 2 * ff(t), (t) => soft * Math.min(1, t / 0.003) * Math.min(1, (d - t) / 0.01)));
  return x;
}
const midiHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

function boops(rng: Rng): Float32Array {
  const pent = [72, 74, 76, 79, 81, 84];
  const x = alloc(0.32);
  for (let k = 0; k < 3; k++) mixInto(x, blip(at(0.07), midiHz(pent[rng.int(pent.length)]!)), at(k * 0.09));
  return fadeEdges(normalize(lp(x, 7000), 0.28));
}

function arpeggio(notes: readonly number[], step: number, len = 0.08): Float32Array {
  const x = alloc(notes.length * step + len + 0.05);
  notes.forEach((n, k) => mixInto(x, blip(at(len), midiHz(n)), at(k * step)));
  return fadeEdges(normalize(lp(x, 8000), 0.3));
}

function bweep(rng: Rng): Float32Array {
  const d = 0.2 + 0.05 * rng.next();
  const x = blip(at(d), (t) => (850 + 700 * Math.pow(t / d, 1.5)) * (1 + 0.02 * Math.sin(2 * Math.PI * 14 * t)));
  return fadeEdges(normalize(lp(x, 7000), 0.28));
}

function warble(rng: Rng): Float32Array {
  const d = 0.55;
  const k = 1 + 0.02 * rng.bi();
  const x = blip(at(d), (t) => (Math.floor(t * 24) % 2 ? 1250 : 1650) * k);
  return fadeEdges(normalize(lp(x, 6000), 0.3));
}

function errorBuzz(): Float32Array {
  const x = alloc(0.5);
  for (const t0 of [0, 0.22]) {
    const b = new Float32Array(at(0.17));
    for (let i = 0; i < b.length; i++) b[i] = (Math.sin(2 * Math.PI * 140 * i / SR) > 0 ? 1 : -1) * Math.min(1, i / 100) * Math.min(1, (b.length - i) / 200);
    mixInto(x, lp(b, 2500), at(t0));
  }
  return fadeEdges(normalize(x, 0.26));
}

function glissDown(rng: Rng): Float32Array {
  const d = 0.65, ph = rng.next() * 6;
  const x = blip(at(d), (t) => 1600 * Math.pow(300 / 1600, t / d) * (1 + 0.05 * Math.sin(2 * Math.PI * 9 * t + ph)));
  return fadeEdges(normalize(lp(x, 6000), 0.28));
}

function powerSigh(rng: Rng): Float32Array {
  const d = 0.8;
  const x = blip(at(d), (t) => 620 * Math.pow(200 / 620, t / d), 0.2);
  envFn(x, (t) => Math.exp(-t / 0.4));
  mixInto(x, normalize(envAD(bp(white(at(d), rng), 900, 0.7), 0.05, 0.25), 0.15));
  return fadeEdges(normalize(x, 0.22));
}

function binBurp(): Float32Array {
  const x = alloc(0.55);
  const b = new Float32Array(at(0.22));
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * (95 - 30 * t) * t) > 0 ? 1 : -1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 31 * t)) * Math.min(1, (b.length - i) / 400); }
  mixInto(x, lp(b, 1800));
  mixInto(x, blip(at(0.06), midiHz(84)), at(0.27), 0.5);
  mixInto(x, blip(at(0.06), midiHz(88)), at(0.36), 0.5);
  return fadeEdges(normalize(x, 0.3));
}

function scanTicks(rng: Rng): Float32Array {
  const x = alloc(0.4);
  for (let k = 0; k < 6; k++) mixInto(x, modal(at(0.02), contact(0.00005, rng), [{ f: 5200 + 300 * k, amp: 1, tau: 0.002 }]), at(k * 0.05));
  return fadeEdges(normalize(x, 0.15));
}

function driveLoop(rng: Rng): Float32Array {
  // the wheel motors (integer-Hz partials: seamless at 1 s) plus the side brush ticking 9 times a second
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) { const t = i / SR; x[i] = 0.5 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 360 * t) + 0.12 * Math.sin(2 * Math.PI * 1440 * t); }
  normalize(x, 0.6);
  for (let k = 0; k < 9; k++) mixInto(x, modal(at(0.02), contact(0.0001, rng), [{ f: 2800, amp: 1, tau: 0.003 }]), at(k / 9), 0.25);
  return normalize(x, 0.25);
}

function vacuumLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = bp(white(len, rng), 1600, 0.6);
    for (let i = 0; i < len; i++) { const t = i / SR; x[i] = x[i]! + 0.15 * Math.sin(2 * Math.PI * 210 * t) + 0.05 * Math.sin(2 * Math.PI * 3000 * t); }
    return x;
  }), 0.3);
}

function binRattleLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.15, (len) => {
    const x = hp(white(len, rng), 3000);
    normalize(x, 0.3);
    let t = 0;
    while (t < len / SR) { mixInto(x, modal(at(0.04), contact(0.00008, rng), [{ f: 2500 + 1800 * rng.next(), amp: 1, tau: 0.01 }]), at(t), 0.3 + 0.5 * rng.next()); t += 0.05 + 0.15 * rng.next(); }
    return x;
  }), 0.25);
}

function selfRight(rng: Rng): Float32Array {
  const x = alloc(0.8);
  mixInto(x, blip(at(0.55), (t) => 300 + 700 * t / 0.55, 0.6), 0, 0.4);
  mixInto(x, impact('poly', 1, rng), at(0.55), 0.8);
  return fadeEdges(normalize(x, 0.38));
}

function lidPop(rng: Rng): Float32Array {
  const x = alloc(0.15);
  mixInto(x, chirp(at(0.06), glide(1200, 500, 0.01), (t) => Math.exp(-t / 0.01)), 0, 0.8);
  mixInto(x, modal(at(0.1), contact(0.0002, rng), [{ f: 1800, amp: 1, tau: 0.015 }]), 0, 0.5);
  return fadeEdges(normalize(x, 0.3));
}

function clatter(rng: Rng): Float32Array {
  const x = alloc(0.7);
  for (let k = 0; k < 4; k++) mixInto(x, impact('poly', k ? 0 : 1, rng), at(k * (0.07 + 0.05 * rng.next())), 1 - 0.2 * k);
  return fadeEdges(normalize(x, 0.4));
}

export function critterRecipes(): Recipe[] {
  return [
    ['mochi/meow', 4, (g) => meow(g)], ['mochi/mrrp', 3, mrrp], ['mochi/hiss', 3, hiss],
    ['mochi/yowl', 2, (g) => meow(g, { dur: 0.35, lo: 700, hi: 1100, tense: 1 })], ['mochi/grumble', 2, grumble],
    ['mochi/chatter', 2, (g) => chatter(g, 900, 4, 9)], ['mochi/hup', 2, hup], ['mochi/woozy', 2, (g) => meow(g, { dur: 0.8, lo: 460, hi: 560, wobble: 0.1 })],
    ['mochi/step', 6, (g) => pawStep(g, 140, 0.004, 1500)],
    ['pip/squeak', 6, (g) => squeak(g)], ['pip/chitter', 3, pipChitter], ['pip/alarm', 2, (g) => squeak(g, { dur: 0.25, f: 3200, up: 1.3, vib: 0.03 })],
    ['pip/trill', 2, pipTrill], ['pip/wheee', 1, wheee], ['pip/huff', 2, (g) => huff(g, 3000)], ['pip/step', 6, (g) => pawStep(g, 1400, 0.0004, 5000)],
    ['goby/bloop', 6, bloop], ['goby/burble', 3, burble], ['goby/gulp', 2, gulp], ['goby/gasp', 2, gasp], ['goby/slap', 6, flopSlap], ['goby/bubblepop', 2, bubblePop],
    ['bandit/chitter', 4, (g) => banditChitter(g, 6 + g.int(4))], ['bandit/squawk', 2, squawk], ['bandit/snicker', 2, snicker], ['bandit/coo', 2, coo],
    ['bandit/rant', 1, (g) => banditChitter(g, 14)], ['bandit/huff', 2, (g) => huff(g, 1300)], ['bandit/step', 6, (g) => pawStep(g, 95, 0.006, 1200)],
    ['crit/bodyfall', 4, bodyfall], ['crit/shake', 2, shake],
    ['loop/purr', 1, purrLoop], ['loop/snore', 1, snoreLoop], ['loop/patter', 1, patterLoop], ['loop/pedal', 1, pedalSqueakLoop],
    // M4: Biscuit
    ['biscuit/woof', 6, (g) => woof(g)], ['biscuit/woof2', 3, woofWoof], ['biscuit/boof', 3, (g) => woof(g, { f: 230, dur: 0.15, soft: 1 })],
    ['biscuit/yip', 4, (g) => yip(g, 1)], ['biscuit/yips', 3, (g) => yip(g, 3)], ['biscuit/whine', 3, whine], ['biscuit/grumble', 2, dogGrumble],
    ['biscuit/awoo', 2, (g) => awoo(g)], ['biscuit/howl', 2, yipHowl], ['biscuit/sigh', 3, sighGroan], ['biscuit/sniff', 3, snuffle], ['biscuit/step', 6, heavyStep],
    ['loop/pant', 1, pantLoop], ['loop/dogsnore', 1, dogSnoreLoop],
    // M4: Henny
    ['henny/cluck', 6, (g) => cluck(g)], ['henny/clucks', 3, (g) => clucks(g, 3 + g.int(3))], ['henny/purr', 2, purrCluck], ['henny/buk', 3, (g) => cluck(g, { f: 460, dur: 0.11, rise: 1.5 })],
    ['henny/cackle', 2, cackle], ['henny/squawk', 3, flapSquawk], ['henny/indignant', 2, (g) => bagawk(g, 700, 0.35)], ['henny/eggsong', 2, eggSong],
    ['henny/chortle', 2, (g) => clucks(g, 5, 0.1, 380)], ['henny/warble', 2, (g) => clucks(g, 4, 0.13, 600)], ['henny/flap', 3, (g) => wingFlaps(g, 6)],
    ['henny/scratch', 3, scratch], ['henny/peck', 3, (g) => fadeEdges(normalize(modal(at(0.04), contact(0.0001, g), [{ f: 2400 + 600 * g.next(), amp: 1, tau: 0.004 }]), 0.25))],
    ['henny/flump', 2, flump], ['henny/step', 6, (g) => pawStep(g, 650, 0.0006, 4000)], ['loop/roost', 1, roostLoop],
    // M4: Dusty
    ['dusty/boop', 4, boops], ['dusty/arp', 2, (g) => arpeggio(g.chance(0.5) ? [72, 76, 79, 84] : [74, 77, 81, 86], 0.07)], ['dusty/bweep', 3, bweep],
    ['dusty/alarm', 2, warble], ['dusty/error', 2, () => errorBuzz()], ['dusty/gliss', 2, glissDown], ['dusty/sigh', 1, powerSigh],
    ['dusty/fanfare', 1, () => arpeggio([67, 72, 76, 79, 84, 79, 84], 0.075, 0.07)], ['dusty/burp', 2, () => binBurp()], ['dusty/scan', 2, scanTicks],
    ['dusty/bonk', 3, (g) => { const x = impact('rubber', 1, g); mixInto(x, impact('poly', 0, g), 0, 0.5); return fadeEdges(normalize(x, 0.38)); }],
    ['dusty/clatter', 2, clatter], ['dusty/whirr', 2, selfRight], ['dusty/lidpop', 1, lidPop],
    ['loop/drive', 1, driveLoop], ['loop/vacuum', 1, vacuumLoop], ['loop/binrattle', 1, binRattleLoop],
  ];
}

// ============================================================================================
// director
// ============================================================================================

export const CRITTER_TYPES = new Set(['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty']);
/** contract 3 flag bits */
const CF = { ragdoll: 1, trapped: 2, asleep: 4, device: 8 } as const;

type Cat = 'idle' | 'curious' | 'chase' | 'pounce' | 'startled' | 'flee' | 'indignant' | 'dizzy' | 'happy' | 'trapped' | 'grab' | 'admire' | 'celebrate' | 'flop' | 'rescue'
  // M4: Biscuit's bark (also the sim's Sound pulse), Henny's egg song, Dusty's bin-full burp
  | 'bark' | 'lay' | 'full';
type Bark = readonly [cue: string, rate: number];

const BARKS: Record<string, Partial<Record<Cat, readonly Bark[]>>> = {
  mochi: {
    idle: [['mochi/mrrp', 1]], curious: [['mochi/mrrp', 1.1]], chase: [['mochi/chatter', 1]], pounce: [['mochi/hup', 1]],
    startled: [['mochi/hiss', 1], ['mochi/yowl', 1]], flee: [['mochi/meow', 1.2]], indignant: [['mochi/grumble', 1]],
    dizzy: [['mochi/woozy', 1]], happy: [['mochi/mrrp', 0.95]], celebrate: [['mochi/meow', 1.05]], trapped: [['mochi/meow', 0.9]],
  },
  pip: {
    idle: [['pip/chitter', 1]], curious: [['pip/squeak', 1]], chase: [['pip/squeak', 1.1]], startled: [['pip/alarm', 1]], flee: [['pip/alarm', 1.05]],
    indignant: [['pip/chitter', 0.9]], dizzy: [['pip/squeak', 0.8]], happy: [['pip/trill', 1]], celebrate: [['pip/wheee', 1]], trapped: [['pip/squeak', 0.9]],
  },
  goby: {
    idle: [['goby/bloop', 1]], curious: [['goby/burble', 1]], startled: [['goby/gulp', 1]], flee: [['goby/gulp', 1.1]], dizzy: [['goby/burble', 0.8]],
    happy: [['goby/burble', 1.2]], celebrate: [['goby/burble', 1.3]], trapped: [['goby/bloop', 0.9]], flop: [['goby/gasp', 1]], rescue: [['goby/bubblepop', 1]],
    indignant: [['goby/gulp', 0.9]],
  },
  bandit: {
    idle: [['bandit/chitter', 1]], curious: [['bandit/coo', 1.2]], chase: [['bandit/chitter', 1.1]], startled: [['bandit/squawk', 1]], flee: [['bandit/squawk', 1.1]],
    indignant: [['bandit/rant', 1]], dizzy: [['bandit/coo', 0.8]], happy: [['bandit/coo', 1]], celebrate: [['bandit/chitter', 1.15]], trapped: [['bandit/chitter', 0.9]],
    grab: [['bandit/snicker', 1]], admire: [['bandit/coo', 1.1]],
  },
  // M4 (critters.md audio hooks)
  biscuit: {
    idle: [['biscuit/sigh', 1]], curious: [['biscuit/sniff', 1]], chase: [['biscuit/yips', 1]], pounce: [['biscuit/woof', 1.05]], startled: [['biscuit/boof', 1]],
    flee: [['biscuit/whine', 1.1]], indignant: [['biscuit/grumble', 1]], dizzy: [['biscuit/awoo', 1]], happy: [['biscuit/yip', 0.95]], celebrate: [['biscuit/howl', 1]],
    trapped: [['biscuit/whine', 1]], bark: [['biscuit/woof', 1]],
  },
  henny: {
    idle: [['henny/clucks', 1]], curious: [['henny/buk', 1]], chase: [['henny/clucks', 1.15]], startled: [['henny/squawk', 1]], flee: [['henny/cackle', 1]],
    indignant: [['henny/indignant', 1]], dizzy: [['henny/warble', 1]], happy: [['henny/purr', 1]], celebrate: [['henny/chortle', 1]], trapped: [['henny/clucks', 0.9]],
    lay: [['henny/eggsong', 1]],
  },
  dusty: {
    idle: [['dusty/boop', 1]], curious: [['dusty/bweep', 1]], chase: [['dusty/scan', 1]], startled: [['dusty/alarm', 1]], flee: [['dusty/alarm', 1.1]],
    indignant: [['dusty/error', 1]], dizzy: [['dusty/gliss', 1]], happy: [['dusty/arp', 1]], celebrate: [['dusty/fanfare', 1]], trapped: [['dusty/error', 0.9]],
    full: [['dusty/burp', 1]],
  },
};

/** Clip name (critter briefs) → bark category. Locomotion clips are footsteps only. */
const CLIP_CAT: Record<string, Cat | null> = {
  idle: 'idle', idle_alt: 'idle', sniff: 'curious', emote_confused: 'curious', chase: 'chase', stalk: 'chase', pounce: 'pounce',
  startled: 'startled', arch_scared: 'startled', flee: 'flee', emote_angry: 'indignant', dizzy: 'dizzy', wheel_exit: 'dizzy',
  emote_happy: 'happy', celebrate: 'celebrate', trapped: 'trapped', steal_grab: 'grab', loot_admire: 'admire', flop: 'flop', bubble_rescue: 'rescue',
  // M4 (B4's clips, M4_NOTES_B4.md). bark / lay_egg are silent here: B4's Bark and Lay events carry those sounds, once.
  bark: null, bark_run: null, wake_startle: 'startled', barge: null, tail_wag: null, shake_off: null,
  flap: 'startled', lay_egg: null, glide_down: null, peck: null, scratch: null, proud_puff: 'celebrate',
  suck: null, bin_full: 'full', bump_turn: null,
};
const EMOTE_CAT: Record<string, Cat | null> = {
  '!': 'startled', cat_alert: 'startled', dog_alert: 'startled', eyes_pip: 'chase', heart: 'happy', snack_heart: 'happy', kiss: 'happy',
  grumpy: 'indignant', steam: 'indignant', angry: 'indignant', sparkle: 'happy', grin: 'happy', '?': 'curious', seed: 'curious', food_flake: 'curious', stars: 'dizzy', sweat: 'trapped', water_drop: 'trapped', bubbles: 'idle',
  // M4 (B4): bark / egg / bin_full have their own events or clips, so the bubble itself is silent
  bark: null, eyes_mochi: 'chase', bone: 'happy', egg: null, '!!': 'startled', feather: 'indignant', sparkle_clean: 'happy', bin_full: null,
};
const LOCO = new Set(['walk', 'run', 'chase', 'flee', 'stalk', 'steal_carry', 'swim']);
/** Categories that cut through the per-critter cooldown (reactions, not chatter). */
const URGENT = new Set<Cat>(['startled', 'trapped', 'pounce', 'rescue', 'bark', 'lay', 'full']);

interface Species { step: string | null; stride: number; minSpeed: number; runSpeed: number; stepGain: number; fallRate: number; idleEvery: [number, number] }
const SPECIES: Record<string, Species> = {
  mochi: { step: 'mochi/step', stride: 0.22, minSpeed: 0.08, runSpeed: 2.5, stepGain: 0.35, fallRate: 1, idleEvery: [7, 16] },
  pip: { step: 'pip/step', stride: 0.05, minSpeed: 0.03, runSpeed: 0.8, stepGain: 0.25, fallRate: 1.8, idleEvery: [5, 12] },
  goby: { step: null, stride: 1, minSpeed: 99, runSpeed: 1, stepGain: 0, fallRate: 2.2, idleEvery: [4, 10] },
  bandit: { step: 'bandit/step', stride: 0.26, minSpeed: 0.08, runSpeed: 2.2, stepGain: 0.4, fallRate: 0.8, idleEvery: [8, 18] },
  // M4: Biscuit is heavy (12 kg) and stocky, Henny takes quick little steps, Dusty rolls (its drive motor is its "steps")
  biscuit: { step: 'biscuit/step', stride: 0.3, minSpeed: 0.1, runSpeed: 3, stepGain: 0.45, fallRate: 0.7, idleEvery: [9, 20] },
  henny: { step: 'henny/step', stride: 0.08, minSpeed: 0.05, runSpeed: 1.5, stepGain: 0.18, fallRate: 1.25, idleEvery: [4, 10] },
  dusty: { step: null, stride: 1, minSpeed: 99, runSpeed: 0.5, stepGain: 0, fallRate: 1, idleEvery: [10, 22] },
};
/** DUSTY's bin: the meter byte read as fill (B4: Matter grains sucked into the bin). */
const DUSTY_FILL_SCALE = 255;
const PER_CRITTER_CD = 1.5, PER_SPECIES_CD = 0.5, URGENT_CD = 0.6;

/** Clip and emote name tables from parts-data (stream B). Flat string[] or per-species records are both accepted. */
type Names = readonly string[] | Readonly<Record<string, readonly string[]>> | undefined;
function lookup(table: Names, type: string, i: number): string | null {
  if (!table) return null;
  const list = Array.isArray(table) ? (table as readonly string[]) : (table as Readonly<Record<string, readonly string[]>>)[type];
  const n = list?.[i];
  if (!n) return null;
  // tolerate "mochi__walk" style names
  const k = n.indexOf('__');
  return k >= 0 ? n.slice(k + 2) : n;
}

interface CritterRt {
  type: string; motion: Motion; clip: string | null; flags: number; emote: string | null;
  lastBark: number; nextIdle: number; stepPhase: number; stepIdx: number; flopT: number; effortT: number; seen: number;
  // M4
  vy: number; flapAt: number; air: boolean; fill: number; fillRate: number; full: boolean; peckT: number; lastSound: number; layAt: number;
}

export class Critters {
  private readonly rt = new Map<number, CritterRt>();
  private readonly speciesBark = new Map<string, number>();
  private clipNames: Names;
  private emoteNames: Names;

  constructor(private readonly h: AudioHost) {
    const pd = partsData as unknown as Record<string, unknown>;
    this.clipNames = pd['CRITTER_CLIPS'] as Names;
    this.emoteNames = pd['CRITTER_EMOTES'] as Names;
  }

  /** Override the clip/emote tables (tests, or if parts-data exports land under other names). */
  setNames(clips: Names, emotes: Names): void { this.clipNames = clips; this.emoteNames = emotes; }
  /** M5: the tables in use (a clip's offline director copies them). */
  names(): [Names, Names] { return [this.clipNames, this.emoteNames]; }

  reset(): void { this.rt.clear(); this.speciesBark.clear(); }

  private get(id: number, type: string, pos: Vec3): CritterRt {
    let c = this.rt.get(id);
    if (!c || c.type !== type) {
      const sp = SPECIES[type]!;
      c = {
        type, motion: new Motion(pos), clip: null, flags: 0, emote: null, lastBark: -10,
        nextIdle: this.h.now() + sp.idleEvery[0] * (0.5 + hash01(id, 7)), stepPhase: 0, stepIdx: 0, flopT: 0, effortT: 0, seen: this.h.now(),
        vy: 0, flapAt: -10, air: false, fill: 0, fillRate: 0, full: false, peckT: 0, lastSound: -10, layAt: -10,
      };
      this.rt.set(id, c);
    }
    return c;
  }

  private bark(id: number, c: CritterRt, cat: Cat, pos: Vec3, when: number, gain = 0.7): boolean {
    const list = BARKS[c.type]?.[cat];
    if (!list) return false;
    const now = this.h.now();
    const urgent = URGENT.has(cat);
    if (now - c.lastBark < (urgent ? URGENT_CD : PER_CRITTER_CD)) return false;
    if (!urgent && now - (this.speciesBark.get(c.type) ?? -10) < PER_SPECIES_CD) return false;
    const v = hash01(id, this.h.tick(), hashStr(cat));
    let t = when;
    for (const [cue, rate] of list) {
      if (this.h.play(cue, v, { family: 'critter', pos, when: t, gain, rate: rate * (0.97 + 0.06 * v), key: `crit:${id}`, prio: urgent ? 1.5 : 1 })) {
        c.lastBark = now;
        this.speciesBark.set(c.type, now);
      }
      t += 0.12; // a multi-cue bark (hiss then yowl) staggers its layers
    }
    return true;
  }

  /** Per critter per frame. `bytes` is run.critters for this part (contract 3), or null before stream B lands. */
  update(id: number, type: string, pos: Vec3, bytes: ArrayLike<number> | null, dt: number, edges: boolean, paused: boolean, meter = 0): void {
    const sp = SPECIES[type];
    if (!sp || !finite3(pos)) return;
    const h = this.h, now = h.now();
    const c = this.get(id, type, pos);
    c.seen = now;
    c.motion.update(pos, dt);
    const flags = bytes ? bytes[1] ?? 0 : 0;
    const clip = bytes ? lookup(this.clipNames, type, bytes[0] ?? 0) : null;
    const emote = bytes && (bytes[2] ?? 0) > 0 ? lookup(this.emoteNames, type, bytes[2]!) : null;
    const prevFlags = c.flags, prevClip = c.clip, prevEmote = c.emote;
    c.flags = flags; c.clip = clip; c.emote = emote;
    // DUSTY's bin fill and its rate (the meter only moves when the sim worker posts a frame)
    if (type === 'dusty') {
      const f = clamp(Number.isFinite(meter) ? meter : 0, 0, 255) / DUSTY_FILL_SCALE;
      if (f !== c.fill) { c.fillRate += ((f - c.fill) / Math.max(dt, 1 / 120) - c.fillRate) * 0.3; c.fill = f; } else c.fillRate *= 0.9;
    }
    if (paused) return;

    // ---- one-shots on state changes ----
    if (edges) {
      if (flags & CF.ragdoll && !(prevFlags & CF.ragdoll)) {
        if (type === 'dusty') h.play('dusty/clatter', hash01(id, h.tick()), { family: 'critter', pos, when: now, gain: 0.5, key: `fall:${id}` }); // tipped over: frantic
        this.bark(id, c, 'startled', pos, now);
      }
      if (flags & CF.trapped && !(prevFlags & CF.trapped)) this.bark(id, c, 'trapped', pos, now + 0.4);
      if (clip && clip !== prevClip) {
        const cat = CLIP_CAT[clip];
        if (cat === 'idle') { if (hash01(id, h.tick()) < 0.35) this.bark(id, c, 'idle', pos, now, 0.55); }
        else if (cat === 'flop') c.flopT = 0;
        else if (cat) this.bark(id, c, cat, pos, now);
        if (clip === 'getup' || clip === 'self_right' || clip === 'shake_off') this.getup(id, c, pos, now, false);
      }
      if (emote && emote !== prevEmote) { const cat = EMOTE_CAT[emote]; if (cat) this.bark(id, c, cat, pos, now, 0.6); }
    }

    // ---- continuous: loops, idles, flop slaps, footsteps ----
    const asleep = (flags & CF.asleep) !== 0 || clip === 'sleep';
    const ragdoll = (flags & CF.ragdoll) !== 0;
    const device = (flags & CF.device) !== 0 || clip === 'wheel_run' || clip === 'wheel_sprint' || clip === 'pedal';
    if (asleep && !ragdoll) {
      if (type === 'mochi') h.loop(`purr:${id}`, 'purr', pos, 1);
      else if (type === 'bandit') h.loop(`snore:${id}`, 'snore', pos, 1);
      else if (type === 'pip') h.loop(`snore:${id}`, 'snore', pos, 0.5, { aux: 0.5 });
      else if (type === 'biscuit') h.loop(`snore:${id}`, 'snore', pos, 1, { variant: 'dogsnore' });
      else if (type === 'henny') h.loop(`roost:${id}`, 'roost', pos, 1);
    } else if (device && !ragdoll) {
      if (type === 'pip') {
        const lvl = clip === 'wheel_sprint' ? 2 : clip === 'wheel_run' ? 1 : clip === 'idle' ? 0 : 1.4;
        if (lvl > 0) h.loop(`patter:${id}`, 'patter', pos, lvl);
        c.effortT += dt;
        if (c.effortT > (lvl > 0 ? 0.9 : 0.6)) { c.effortT = 0; h.play('pip/huff', hash01(id, h.tick()), { family: 'critter', pos, when: now, gain: 0.3, key: `huff:${id}` }); }
      } else if (type === 'bandit') {
        h.loop(`pedal:${id}`, 'pedal', pos, 1);
        c.effortT += dt;
        if (c.effortT > 1.2) { c.effortT = 0; h.play('bandit/huff', hash01(id, h.tick()), { family: 'critter', pos, when: now, gain: 0.35, key: `huff:${id}` }); }
      }
    } else if (!ragdoll && !(flags & CF.trapped)) {
      // idle chatter on a seeded timer
      const idleClip = !clip || CLIP_CAT[clip] === 'idle' || (type === 'goby' && (clip === 'swim' || clip === 'walk'));
      if (idleClip && c.motion.speed < sp.runSpeed * 0.5 && now >= c.nextIdle) {
        this.bark(id, c, 'idle', pos, now, 0.5);
        c.nextIdle = now + sp.idleEvery[0] + (sp.idleEvery[1] - sp.idleEvery[0]) * hash01(id, h.tick(), 3);
      }
    }
    if (type === 'biscuit' || type === 'henny' || type === 'dusty') this.m4(id, c, type, pos, clip, flags, dt, edges, now, asleep, ragdoll);
    if (type === 'goby' && clip === 'flop' && !ragdoll) {
      // the flop clip is a 0.5 s loop with a tail slap each cycle; a comic gasp now and then
      c.flopT += dt;
      if (c.flopT >= 0.5) {
        c.flopT -= 0.5;
        const v = hash01(id, h.tick(), 11);
        h.play('goby/slap', v, { family: 'step', pos, when: now, gain: 0.55, key: `slap:${id}` });
        if (v < 0.2) this.bark(id, c, 'flop', pos, now + 0.1, 0.5);
      }
    }
    // footsteps: species stride → step rate from the measured speed; positional, alternating feet
    const loco = clip ? LOCO.has(clip) : true;
    if (sp.step && loco && !asleep && !ragdoll && !device && !(flags & CF.trapped)) {
      const v = Math.hypot(c.motion.vel[0], c.motion.vel[2]);
      if (v > sp.minSpeed) {
        c.stepPhase += clamp((v / sp.stride) * dt, 0, 1); // at most one step per frame
        if (c.stepPhase >= 1) {
          c.stepPhase = Math.min(c.stepPhase - 1, 0.5);
          c.stepIdx++;
          const g = sp.stepGain * (0.6 + 0.4 * Math.min(1, v / sp.runSpeed));
          h.play(sp.step, hash01(id, c.stepIdx), { family: 'step', pos, when: now, gain: g, rate: c.stepIdx % 2 ? 1.04 : 0.97, key: `step:${id}` });
        }
      } else c.stepPhase = 0.6; // the first step lands promptly when it sets off
    }
    void edges;
  }

  /** Getup / self-right: a shake-off (Biscuit, Henny and the M2 critters) or DUSTY's self-right whirr. */
  private getup(id: number, c: CritterRt, pos: Vec3, when: number, indignant: boolean): void {
    const h = this.h;
    if (c.type === 'dusty') h.play('dusty/whirr', hash01(id, h.tick()), { family: 'critter', pos, when: when + 0.1, gain: 0.45, key: `shake:${id}` });
    else if (c.type === 'henny') h.play('henny/flap', hash01(id, h.tick()), { family: 'critter', pos, when: when + 0.15, gain: 0.4, key: `shake:${id}` });
    else h.play('crit/shake', hash01(id, h.tick()), { family: 'critter', pos, when: when + (indignant ? 0.15 : 0.25), gain: c.type === 'biscuit' ? 0.55 : 0.45, rate: c.type === 'biscuit' ? 0.8 : 1, key: `shake:${id}` });
  }

  /** M4 species, per frame: Biscuit pants, Henny flaps and lands, Dusty drives, sucks and fills its bin. */
  private m4(id: number, c: CritterRt, type: string, pos: Vec3, clip: string | null, flags: number, dt: number, edges: boolean, now: number, asleep: boolean, ragdoll: boolean): void {
    const h = this.h;
    const trapped = (flags & CF.trapped) !== 0;
    const v = Math.hypot(c.motion.vel[0], c.motion.vel[2]), vy = c.motion.vel[1];
    if (type === 'biscuit') {
      // panting: happy, celebrating, or after a run
      const happy = clip === 'emote_happy' || clip === 'celebrate' || clip === 'pant';
      if (!asleep && !ragdoll && (happy || v > 1.2)) h.loop(`pant:${id}`, 'pant', pos, 1, { aux: v > 1.2 ? 1.4 : 1 });
    } else if (type === 'henny') {
      // startled: she flaps up a metre (GAME_SPEC §12): wings on the way up, a flump on landing
      if (edges && !ragdoll && vy > 1.0 && now - c.flapAt > 0.8) {
        c.flapAt = now; c.air = true;
        h.play('henny/flap', hash01(id, h.tick(), 21), { family: 'critter', pos, when: now, gain: 0.5, key: `flap:${id}` });
      }
      if (c.air && c.vy < -0.6 && vy > -0.15 && now - c.flapAt > 0.2) {
        c.air = false;
        h.play('henny/flump', hash01(id, h.tick(), 22), { family: 'step', pos, when: now, gain: 0.4, key: `flump:${id}` });
      }
      if (now - c.flapAt > 3) c.air = false;
      // pecking and scratching at the ground
      if (clip === 'peck' || clip === 'scratch' || clip === 'sniff') {
        c.peckT += dt;
        if (c.peckT > (clip === 'scratch' ? 0.45 : 0.3)) {
          c.peckT = 0;
          h.play(clip === 'scratch' ? 'henny/scratch' : 'henny/peck', hash01(id, h.tick(), 23), { family: 'step', pos, when: now, gain: 0.25, key: `peck:${id}` });
        }
      }
    } else if (type === 'dusty' && !asleep && !ragdoll) {
      // drive motor (pitch ∝ speed), suction roar (∝ intake rate), bin rattle (∝ fill)
      if (!trapped || v > 0.02) h.loop(`drive:${id}`, 'drive', pos, Math.min(1.4, 0.15 + v / 0.35));
      h.loop(`vacuum:${id}`, 'vacuum', pos, clamp((clip === 'suck' ? 0.9 : 0.55) + Math.max(0, c.fillRate) * 40, 0.55, 1.3));
      if (clip === 'bump_turn' && edges && now - c.flapAt > 0.5) { c.flapAt = now; h.play('dusty/bonk', hash01(id, h.tick(), 24), { family: 'critter', pos, when: now, gain: 0.35, key: `fall:${id}` }); }
      if (c.fill > 0.08 && v > 0.03) h.loop(`binrattle:${id}`, 'binrattle', pos, Math.min(1.2, c.fill * 1.4));
      // bin full: a smug burp beep, once per fill
      if (!c.full && c.fill >= 0.95 && edges) { c.full = true; this.bark(id, c, 'full', pos, now, 0.6); }
      else if (c.fill < 0.8) c.full = false;
    }
    c.vy = vy;
  }

  /** HENNY laid a YOLK (a Spawn of a yolk near her, or B4's own event): the egg song, then pride. */
  laid(henId: number | undefined, pos: Vec3, when: number): boolean {
    let id = henId !== undefined && this.rt.get(henId)?.type === 'henny' ? henId : undefined;
    if (id === undefined) {
      let best = 1.2;
      for (const [k, c] of this.rt) if (c.type === 'henny') { const d = Math.hypot(c.motion.pos[0] - pos[0], c.motion.pos[1] - pos[1], c.motion.pos[2] - pos[2]); if (d < best) { best = d; id = k; } }
    }
    if (id === undefined) return false;
    const c = this.rt.get(id)!;
    if (this.h.now() - c.layAt < 1.5) return true; // B4's Lay and a yolk Spawn for the same egg
    c.layAt = this.h.now();
    c.lastBark = -10;
    return this.bark(id, c, 'lay', c.motion.pos, when + 0.5, 0.75);
  }


  /** Critter events (contract 1, stream B kinds). Returns true when handled. */
  event(e: SimEventLike, type: string | undefined, when: number, onTrapBox: (boxId: number, pos: Vec3) => void): boolean {
    const t = type ?? '';
    const isCritter = CRITTER_TYPES.has(t);
    if (isCritter && !finite3(e.pos)) return true;
    switch (e.kind) {
      case 'CritterState': return true; // run.critters carries the clip; the FSM index alone has no sound
      case 'Bark': case 'Sound': {
        // BISCUIT's bark (B4: a Bark event, mag = dB, which causes a 70 dB sim Sound pulse; GAME_SPEC §12): audio renders it
        // once, from whichever of the pair arrives first. The sim event is authoritative, so it skips the bark cooldowns.
        if (t !== 'biscuit') return false;
        const c = this.get(e.part, t, e.pos);
        if (this.h.now() - c.lastSound < 0.3) return true;
        const v = hash01(e.part, e.tick, 31);
        const g = clamp(0.45 + (Number.isFinite(e.mag) ? (e.mag - 60) / 40 : 0.25), 0.4, 0.9);
        this.h.play(v < 0.3 ? 'biscuit/woof2' : 'biscuit/woof', v, { family: 'critter', pos: e.pos, when, gain: g, rate: 0.96 + 0.08 * v, key: `crit:${e.part}`, prio: 1.6 });
        c.lastBark = this.h.now(); c.lastSound = this.h.now();
        this.speciesBark.set(t, this.h.now());
        return true;
      }
      case 'Emote': {
        if (!isCritter) return true;
        const c = this.get(e.part, t, e.pos);
        const name = lookup(this.emoteNames, t, Math.round(e.mag));
        const cat = name ? EMOTE_CAT[name] : null;
        if (cat) this.bark(e.part, c, cat, e.pos, when, 0.6);
        return true;
      }
      case 'Lay': {
        // HENNY lays a YOLK (B4: part = HENNY, pos = the vent): the soft plop, then her egg song
        if (t !== 'henny') return false;
        this.h.play('yolk/laid', hash01(e.part, e.tick), { family: 'critter', pos: e.pos, when, gain: 0.45, key: `lay:${e.part}` });
        this.get(e.part, t, e.pos);
        this.laid(e.part, e.pos, when);
        return true;
      }
      case 'Splat': {
        // one of HENNY's laid YOLKs breaks (B4: part = HENNY, pos = the yolk)
        if (t !== 'henny') return false;
        this.h.play('yolk/splat', hash01(e.part, e.tick), { family: 'fx', pos: e.pos, when, gain: 0.6, key: `splat:${e.part}` });
        return true;
      }
      case 'Ragdoll': {
        if (!isCritter) return true;
        if (t === 'dusty') this.h.play('dusty/clatter', hash01(e.part, e.tick), { family: 'critter', pos: e.pos, when, gain: 0.5, key: `fall:${e.part}` });
        this.bark(e.part, this.get(e.part, t, e.pos), 'startled', e.pos, when);
        return true;
      }
      case 'Getup': {
        if (!isCritter) return true;
        const c = this.get(e.part, t, e.pos);
        this.getup(e.part, c, e.pos, when, true);
        // the indignant emote follows the shake-off (critter briefs: tumble → dizzy → emote_angry → getup)
        c.lastBark = -10;
        this.bark(e.part, c, 'indignant', e.pos, when + 0.6, 0.6);
        return true;
      }
      case 'Trapped': {
        // part is the critter (other = the box) or the box (other = the critter)
        if (isCritter) {
          if (e.other !== undefined) onTrapBox(e.other, e.pos);
          this.bark(e.part, this.get(e.part, t, e.pos), 'trapped', e.pos, when + 0.4);
        } else {
          onTrapBox(e.part, e.pos);
          const c = e.other !== undefined ? this.rt.get(e.other) : undefined;
          if (c && e.other !== undefined) this.bark(e.other, c, 'trapped', e.pos, when + 0.4);
        }
        return true;
      }
      case 'Despawn':
        if (t === 'goby') { this.h.play('goby/bubblepop', hash01(e.part, e.tick), { family: 'critter', pos: e.pos, when, gain: 0.5 }); return true; }
        return isCritter;
      case 'Impact':
        if (!isCritter) return false;
        if (t === 'dusty') {
          // a robot: the bumper bonks (it bumps and pushes small things all day)
          if (e.mag >= 0.2) this.h.play('dusty/bonk', hash01(e.part, e.tick), { family: 'critter', pos: e.pos, when, gain: clamp(0.25 + Math.log10(1 + e.mag) * 0.4, 0.2, 0.7), key: `fall:${e.part}` });
          return true;
        }
        if (e.mag >= 0.5) {
          const sp = SPECIES[t]!;
          this.h.play('crit/bodyfall', hash01(e.part, e.tick), { family: 'critter', pos: e.pos, when, gain: clamp(0.25 + Math.log10(1 + e.mag) * 0.4, 0.2, 0.8), rate: sp.fallRate, key: `fall:${e.part}` });
        }
        return true;
      default: return false;
    }
  }
}
