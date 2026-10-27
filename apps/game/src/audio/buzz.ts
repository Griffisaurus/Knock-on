// BUZZ, the courier drone (critters.md BUZZ, GAME_SPEC §11; stream B5's sim: M5_NOTES_B5.md): its synth-chirp
// voice and its foley. Positional, like every critter; the AUDIO §7 cooldowns apply to the voice.
//
// Driven by contract 3's four critterState bytes [clip, flags, emote, fsm] (B5):
//   flags  ragdoll 1 · trapped 2 · asleep 4 · rotors 16 (B5: Dusty's `sucking` bit is BUZZ's "rotors spinning") ·
//          bits 5–7 the winch, in sevenths of 0.60 m paid out
//   clips  takeoff, land, grab, carry, drop_off, deliver_bow (role) + the required set (idle, walk = cruise, run =
//          dash, startled, tumble, getup, dizzy, trapped, celebrate, sleep, sniff = the tag scan, emote_*)
//   events Impact (part = BUZZ), Ragdoll, Getup, Emote
// Foley: the 4-rotor whir (pitch and level follow thrust: climbing, dashing, carrying; it sags with the load),
// spin-up / spin-down on the rotors bit, the winch reel while the winch moves, a claw clack when it grabs and when
// it lets go, impact plinks, a tumble clatter, a landing tap, the beacon's dock clunk.

import { impact, type Recipe } from './bank';
import { click, tone } from './m4';
import { hash01, hashStr, type Rng } from './rng';
import { SR, alloc, bp, chirp, envFn, fadeEdges, hp, lp, mixInto, modal, contact, normalize, seamless, white } from './synth';
import { Motion, clamp, fin, finite3, type AudioHost, type SimEventLike, type Vec3 } from './types';
import * as partsData from '@knockon/parts-data';

/** B5's FSM table (append-only): BUZZ docks on its beacon in 'docked'. */
const FSM = (partsData as unknown as Record<string, readonly string[] | undefined>)['CRITTER_FSM'] ?? [];
const DOCKED = FSM.indexOf('docked'), LANDED = FSM.indexOf('landed');
/** AUDIO (beta, D127): PARTSIM's startle (D121) puts BUZZ in the shared 'startled' state for 0.6 s. */
const STARTLED = FSM.indexOf('startled');

const at = (s: number): number => Math.round(s * SR);
const TAU = Math.PI * 2;
const midiHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

// ============================================================================================
// voice: bright, quick, a little officious (Dusty's sibling: same product line, smaller, faster, higher)
// ============================================================================================

/** A soft square-ish blip with an octave sparkle (Dusty's voice is rounder and lower). */
function blip(len: number, f: number | ((t: number) => number), soft = 0.5): Float32Array {
  const d = len / SR, ff = typeof f === 'number' ? () => f : f;
  const x = chirp(len, ff, (t) => Math.min(1, t / 0.002) * Math.min(1, (d - t) / 0.008));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(2.2 * x[i]!);
  mixInto(x, chirp(len, (t) => 2 * ff(t), (t) => soft * 0.5 * Math.min(1, t / 0.002) * Math.min(1, (d - t) / 0.008)));
  return x;
}

function notes(ns: readonly number[], step: number, len: number, jitter: Rng | null = null): Float32Array {
  const x = alloc(step * ns.length + len + 0.05);
  ns.forEach((n, k) => mixInto(x, blip(at(len), midiHz(n) * (jitter ? 1 + 0.01 * jitter.bi() : 1)), at(k * step), 0.8));
  return fadeEdges(normalize(lp(x, 9000), 0.3));
}

function ack(rng: Rng): Float32Array { const b = 86 + rng.int(3); return notes([b, b + 5], 0.085, 0.06, rng); } // "on it!"
function boop(rng: Rng): Float32Array { const b = 81 + rng.int(4); return notes(rng.chance(0.5) ? [b, b - 3] : [b - 2, b + 2], 0.11, 0.07, rng); }
function happy(rng: Rng): Float32Array { return notes(rng.chance(0.5) ? [84, 88, 91] : [86, 89, 93], 0.06, 0.05, rng); }
function jingle(rng: Rng): Float32Array {
  // the delivery jingle: three bell-ish notes (a doorbell-ish "ding-dong-ding" in the world key)
  const ns = rng.chance(0.5) ? [84, 79, 88] : [84, 88, 91];
  const x = alloc(0.9);
  ns.forEach((n, k) => {
    const f = midiHz(n);
    mixInto(x, modal(at(0.45), contact(0.0001, rng), [{ f, amp: 1, tau: 0.18 }, { f: f * 2.01, amp: 0.25, tau: 0.08 }]), at(k * 0.14), 0.7);
    mixInto(x, blip(at(0.05), f), at(k * 0.14), 0.3);
  });
  return fadeEdges(normalize(x, 0.32));
}
function trill(rng: Rng): Float32Array {
  // the tag scan: a quick sweeping FM trill ("scanning…")
  const sec = 0.45, f0 = 2000 + 300 * rng.next();
  const x = chirp(at(sec), (t) => f0 * (1 + 0.25 * Math.sin(TAU * 0.9 / sec * t)) * (1 + 0.04 * Math.sign(Math.sin(TAU * 26 * t))), (t) => 0.7 * Math.sin(Math.PI * t / sec));
  return fadeEdges(normalize(lp(x, 8000), 0.24));
}
function curious(rng: Rng): Float32Array {
  const sec = 0.22;
  const x = blip(at(sec), (t) => midiHz(79 + rng.int(3)) * (1 + 0.5 * Math.pow(t / sec, 2)));
  return fadeEdges(normalize(lp(x, 8000), 0.28));
}
function whoop(rng: Rng): Float32Array {
  // alarm whoop, twice
  const x = alloc(0.65);
  for (let k = 0; k < 2; k++) mixInto(x, blip(at(0.24), (t) => 620 * Math.pow(2.3, t / 0.24) * (1 + 0.02 * rng.bi())), at(k * 0.3), 0.8);
  return fadeEdges(normalize(lp(x, 7000), 0.32));
}
/**
 * AUDIO (beta, D127): BUZZ startled by a big boom (PARTSIM, D121: a 0.6 s bob, load kept): a short yelp ("bip-BIP!",
 * jumping up a sixth) over a rotor surge, about 0.3 s, so it fits inside the bob (the alarm whoop is for real trouble).
 */
function startleCue(rng: Rng): Float32Array {
  const x = alloc(0.34);
  const b = midiHz(86 + rng.int(3));
  mixInto(x, blip(at(0.045), (t) => b * (1 + 0.6 * t / 0.045)), 0, 0.7);
  mixInto(x, blip(at(0.09), (t) => b * 1.68 * (1 + 0.12 * Math.sin(TAU * 30 * t))), at(0.06), 0.9);
  // the rotors' surge: the four fans' blade-pass jumping up and settling (240 → 300 Hz) with a gust of duct air
  const n = at(0.3);
  const surge = new Float32Array(n);
  let p = rng.next() * TAU;
  for (let i = 0; i < n; i++) { const t = i / SR, e = Math.min(1, t / 0.02) * Math.exp(-t / 0.1); p += TAU * (240 + 60 * Math.exp(-t / 0.12)) / SR; surge[i] = e * (Math.sin(p) + 0.4 * Math.sin(2 * p)); }
  const air = bp(white(n, rng), 1600, 0.6);
  envFn(air, (t) => Math.min(1, t / 0.015) * Math.exp(-t / 0.08));
  mixInto(surge, normalize(air, 0.5));
  mixInto(x, normalize(surge, 0.5), at(0.005));
  return fadeEdges(normalize(lp(x, 8000), 0.3));
}
function strain(rng: Rng): Float32Array {
  // a strained whine: the motors and the voice working hard under a heavy load
  const sec = 0.7;
  const x = blip(at(sec), (t) => 880 * (1 + 0.15 * t / sec) * (1 + 0.025 * Math.sin(TAU * 11 * t)), 0.3);
  envFn(x, (t) => Math.sin(Math.PI * t / sec));
  mixInto(x, normalize(bp(white(x.length, rng), 1800, 2), 0.06));
  return fadeEdges(normalize(lp(x, 5000), 0.26));
}
function indignant(rng: Rng): Float32Array {
  // an indignant buzz: a short descending "bzzt-bzzt"
  const x = alloc(0.45);
  for (let k = 0; k < 2; k++) {
    const n = at(0.15);
    const b = new Float32Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; p += (520 - 180 * t / 0.15 + 20 * rng.bi() * 0) / SR; b[i] = (2 * (p % 1) - 1) * Math.min(1, t / 0.005) * Math.min(1, (0.15 - t) / 0.02); }
    mixInto(x, lp(b, 3000), at(k * 0.19), 1 - 0.15 * k);
  }
  return fadeEdges(normalize(x, 0.28));
}
function dizzy(rng: Rng): Float32Array {
  const sec = 0.9;
  const x = blip(at(sec), (t) => midiHz(88) * Math.pow(0.5, t / sec) * (1 + 0.08 * Math.sin(TAU * (6 + 2 * rng.next()) * t)), 0.3);
  return fadeEdges(normalize(lp(x, 6000), 0.26));
}
function sleepDown(rng: Rng): Float32Array {
  // power-save: a descending sigh-tone with the filter closing
  const sec = 0.9;
  const x = blip(at(sec), (t) => midiHz(84) * Math.pow(0.35, t / sec), 0.2);
  envFn(x, (t) => Math.exp(-t / 0.4));
  mixInto(x, normalize(lp(white(x.length, rng), 1200), 0.05));
  return fadeEdges(normalize(lp(x, 3500), 0.22));
}
function fanfare(rng: Rng): Float32Array {
  // the celebrate barrel roll: an arpeggio up and a little trill on top
  const x = alloc(1.0);
  mixInto(x, notes([72, 76, 79, 84, 88], 0.07, 0.06, rng));
  for (let k = 0; k < 6; k++) mixInto(x, blip(at(0.04), midiHz(k % 2 ? 91 : 88)), at(0.4 + k * 0.045), 0.4);
  return fadeEdges(normalize(x, 0.32));
}

// ============================================================================================
// foley
// ============================================================================================

function rotorLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.25, (n) => {
    // four ducted fans: blade-pass ~240 Hz (4 blades × 60 rps), each a few Hz apart (they beat), plus duct air
    const x = new Float32Array(n);
    for (const [f, a] of [[240, 1], [243, 0.8], [237, 0.8], [246, 0.7]] as const) {
      let p = rng.next() * TAU;
      for (let i = 0; i < n; i++) { p += TAU * f / SR; const s = Math.sin(p); x[i] = x[i]! + a * (s + 0.45 * Math.sin(2 * p) + 0.25 * Math.sin(3 * p) + 0.12 * Math.tanh(4 * s)); }
    }
    normalize(x, 0.7);
    const air = bp(white(n, rng), 1500, 0.6);
    envFn(air, (t) => 0.85 + 0.15 * Math.sin(TAU * 60 * t));
    mixInto(x, normalize(air, 0.35));
    mixInto(x, normalize(hp(white(n, rng), 5000), 0.05));
    return x;
  }), 0.3);
}

function spin(up: boolean, rng: Rng): Float32Array {
  const sec = up ? 0.6 : 0.8;
  const u = (t: number): number => (up ? Math.min(1, t / sec) : Math.max(0, 1 - t / (sec * 0.8)));
  const x = tone(at(sec), (t) => 40 + 200 * u(t), (t) => Math.min(1, t / 0.02) * (up ? 0.3 + 0.7 * u(t) : u(t)), [0.45, 0.25]);
  const air = bp(white(x.length, rng), 1400, 0.6);
  envFn(air, (t) => 0.6 * u(t));
  mixInto(x, normalize(air, 0.35));
  return fadeEdges(normalize(x, 0.3));
}

function winchLoop(rng: Rng): Float32Array {
  return normalize(seamless(1, 0.1, (n) => {
    const x = chirp(n, () => 1800, () => 0.6);
    mixInto(x, chirp(n, () => 3600, () => 0.2));
    for (let k = 0; k < 40; k++) mixInto(x, click(3800, 0.002, rng, 0.00005), at(k / 40), 0.15);
    mixInto(x, normalize(bp(white(n, rng), 900, 1), 0.15));
    return lp(x, 7000);
  }), 0.22);
}

function claw(rng: Rng): Float32Array {
  const x = alloc(0.2);
  mixInto(x, modal(at(0.15), contact(0.0002, rng), [{ f: 2200 + 300 * rng.next(), amp: 1, tau: 0.012 }, { f: 3800, amp: 0.4, tau: 0.008 }]));
  mixInto(x, click(1700, 0.01, rng, 0.0002), at(0.018), 0.6);
  return fadeEdges(normalize(x, 0.3));
}

function plink(rng: Rng): Float32Array {
  const x = modal(at(0.2), contact(0.00015, rng), [{ f: 2900 + 500 * rng.next(), amp: 1, tau: 0.02 }, { f: 6100, amp: 0.3, tau: 0.01 }, { f: 900, amp: 0.4, tau: 0.02 }]);
  return fadeEdges(normalize(x, 0.3));
}

function clatter(rng: Rng): Float32Array {
  // a tumble: plastic knocks, a duct lip scraping, rotors spinning down
  const x = alloc(1.0);
  for (let k = 0; k < 4; k++) mixInto(x, impact('poly', k === 0 ? 2 : 1, rng), at(k * (0.09 + 0.05 * rng.next())), 0.8 - 0.15 * k);
  mixInto(x, spin(false, rng), at(0.02), 0.5);
  return fadeEdges(normalize(x, 0.38));
}

function landTap(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, impact('poly', 0, rng), 0, 0.7);
  mixInto(x, impact('rubber', 0, rng), at(0.03 + 0.02 * rng.next()), 0.5); // the second skid
  return fadeEdges(normalize(x, 0.3));
}

export function buzzRecipes(): Recipe[] {
  return [
    ['buzz/ack', 3, ack], ['buzz/boop', 4, boop], ['buzz/happy', 2, happy], ['buzz/jingle', 2, jingle], ['buzz/trill', 3, trill],
    ['buzz/curious', 3, curious], ['buzz/whoop', 2, whoop], ['buzz/strain', 2, strain], ['buzz/indignant', 2, indignant], ['buzz/dizzy', 2, dizzy],
    ['buzz/sleep', 1, sleepDown], ['buzz/fanfare', 1, fanfare], ['buzz/startle', 3, startleCue], // startle: beta (D127)
    ['loop/rotor', 1, rotorLoop], ['buzz/spinup', 2, (g) => spin(true, g)], ['buzz/spindown', 2, (g) => spin(false, g)], ['loop/winch', 1, winchLoop],
    ['buzz/claw', 3, claw], ['buzz/plink', 3, plink], ['buzz/clatter', 2, clatter], ['buzz/tap', 3, landTap],
  ];
}

// ============================================================================================
// director
// ============================================================================================

/** contract 3 / B5 flag bits. */
const BF = { ragdoll: 1, trapped: 2, asleep: 4, rotors: 16 } as const;
const WINCH_SHIFT = 5;

type Cat = 'ack' | 'idle' | 'scan' | 'deliver' | 'alarm' | 'strain' | 'indignant' | 'dizzy' | 'sleep' | 'celebrate' | 'curious' | 'happy';
const BARK: Record<Cat, string> = {
  ack: 'buzz/ack', idle: 'buzz/boop', scan: 'buzz/trill', deliver: 'buzz/jingle', alarm: 'buzz/whoop', strain: 'buzz/strain', indignant: 'buzz/indignant',
  dizzy: 'buzz/dizzy', sleep: 'buzz/sleep', celebrate: 'buzz/fanfare', curious: 'buzz/curious', happy: 'buzz/happy',
};
const URGENT = new Set<Cat>(['alarm', 'ack', 'deliver']);
const CLIP_CAT: Readonly<Record<string, Cat | null>> = {
  takeoff: 'ack', sniff: 'scan', drop_off: null, startled: 'alarm', flee: 'alarm', trapped: 'strain', emote_angry: 'indignant', dizzy: 'dizzy',
  sleep: 'sleep', celebrate: 'celebrate', emote_confused: 'curious', emote_happy: 'happy', idle: 'idle', idle_alt: 'idle', deliver_bow: null,
};
const EMOTE_CAT: Readonly<Record<string, Cat | null>> = {
  package: 'ack', pin: null, check: 'happy', clock: 'happy', '!': 'alarm', '?': 'curious', stars: 'dizzy', zzz: null, angry: 'indignant', heart: 'happy', sweat: 'strain',
};
const PER_CD = 1.5, URGENT_CD = 0.6;

type Names = readonly string[] | Readonly<Record<string, readonly string[]>> | undefined;
function lookup(table: Names, i: number): string | null {
  if (!table) return null;
  const list = Array.isArray(table) ? (table as readonly string[]) : (table as Readonly<Record<string, readonly string[]>>)['buzz'];
  const n = list?.[i];
  if (!n) return null;
  const k = n.indexOf('__');
  return k >= 0 ? n.slice(k + 2) : n;
}

interface Rt {
  motion: Motion; clip: string | null; flags: number; emote: string | null; winch: number; winchAt: number; winchRate: number;
  lastBark: number; nextIdle: number; nextStrain: number; seen: number; descending: number; carrying: boolean; lastPlink: number; fsm: number; loadKg: number;
}

export class Buzz {
  private readonly rt = new Map<number, Rt>();
  readonly stats = { cues: 0 };

  constructor(private readonly h: AudioHost, private readonly names: () => [Names, Names]) {}

  reset(): void { this.rt.clear(); }

  private get(id: number, pos: Vec3): Rt {
    let c = this.rt.get(id);
    if (!c) {
      c = { motion: new Motion(pos), clip: null, flags: 0, emote: null, winch: 0, winchAt: this.h.now(), winchRate: 0, lastBark: -10, nextIdle: this.h.now() + 6 + 8 * hash01(id, 3), nextStrain: 0, seen: this.h.now(), descending: 0, carrying: false, lastPlink: -10, fsm: -1, loadKg: 0 };
      this.rt.set(id, c);
    }
    return c;
  }

  private play(id: number, name: string, pos: Vec3, when: number, gain: number, o: { rate?: number; family?: 'critter' | 'step' | 'impact'; prio?: number } = {}): void {
    const v = hash01(id, this.h.tick(), hashStr(name));
    const p: Parameters<AudioHost['play']>[2] = { family: o.family ?? 'critter', pos, when, gain: clamp(gain, 0, 1), rate: clamp(o.rate ?? 1, 0.25, 4), key: `buzz:${name}:${id}` };
    if (o.prio !== undefined) p.prio = o.prio;
    if (this.h.play(name, v, p)) this.stats.cues++;
  }

  private bark(id: number, c: Rt, cat: Cat, pos: Vec3, when: number, gain = 0.55): void {
    const now = this.h.now();
    const urgent = URGENT.has(cat);
    if (now - c.lastBark < (urgent ? URGENT_CD : PER_CD)) return;
    c.lastBark = now;
    const v = hash01(id, this.h.tick(), hashStr(cat));
    this.play(id, BARK[cat], pos, when, gain, { rate: 0.97 + 0.06 * v, prio: urgent ? 1.5 : 1 });
  }

  /** Per frame (index.ts part()): `bytes` = BUZZ's contract-3 bytes, null before B5's sim lands. */
  update(id: number, pos: Vec3, bytes: ArrayLike<number> | null, meter: number, dt: number, edges: boolean, paused: boolean): void {
    if (!finite3(pos)) return;
    const h = this.h, now = h.now();
    const c = this.get(id, pos);
    c.seen = now;
    c.motion.update(pos, dt);
    const [clips, emotes] = this.names();
    const flags = bytes ? (bytes[1] ?? 0) | 0 : 0;
    const clip = bytes ? lookup(clips, bytes[0] ?? 0) : null;
    const emote = bytes && (bytes[2] ?? 0) > 0 ? lookup(emotes, bytes[2]!) : null;
    const prevFlags = c.flags, prevClip = c.clip, prevEmote = c.emote, prevFsm = c.fsm;
    const fsm = bytes ? (bytes[3] ?? -1) | 0 : -1;
    c.flags = flags; c.clip = clip; c.emote = emote; c.fsm = fsm;
    const winch = (flags >> WINCH_SHIFT) & 7;
    if (winch !== c.winch) {
      const span = Math.max(now - c.winchAt, 1 / 120);
      c.winchRate = clamp(Math.abs(winch - c.winch) / 7 * 0.6 / span, 0, 3); // m/s of tether
      c.winch = winch; c.winchAt = now;
    } else if (now - c.winchAt > 0.25) c.winchRate *= 0.7;
    if (paused) return;
    const ragdoll = (flags & BF.ragdoll) !== 0, rotors = (flags & BF.rotors) !== 0 && !ragdoll, asleep = (flags & BF.asleep) !== 0;
    const was = (prevFlags & BF.rotors) !== 0 && !(prevFlags & BF.ragdoll);
    // carrying: from B5's Fetch event (or the carry clip) until Deliver (or the bow / a tumble)
    if (clip === 'carry') c.carrying = true;
    if (clip === 'deliver_bow' || clip === 'tumble' || clip === 'sleep') c.carrying = false;
    const vy = c.motion.vel[1], vh = Math.hypot(c.motion.vel[0], c.motion.vel[2]);
    // ---- one-shots on state changes ----
    if (edges) {
      if (rotors && !was) this.play(id, 'buzz/spinup', pos, now, 0.4);
      if (!rotors && was && !ragdoll) this.play(id, 'buzz/spindown', pos, now, 0.35); // the touchdown itself: 'docked' / 'landed' below
      if (ragdoll && !(prevFlags & BF.ragdoll)) { this.play(id, 'buzz/clatter', pos, now, 0.5, { family: 'impact' }); this.bark(id, c, 'alarm', pos, now + 0.05); }
      // AUDIO (beta, D127): PARTSIM's startle (D121): the short yelp and rotor surge; it stands in for the alarm whoop the
      // 'startled' clip and the '!' emote would bark (their cooldown starts now)
      if (STARTLED >= 0 && fsm === STARTLED && prevFsm !== STARTLED && prevFsm >= 0 && !ragdoll) { this.play(id, 'buzz/startle', pos, now, 0.55, { prio: 1.5 }); c.lastBark = now; }
      if (clip && clip !== prevClip) {
        const cat = CLIP_CAT[clip];
        if (cat === 'idle') { if (hash01(id, h.tick()) < 0.3) this.bark(id, c, 'idle', pos, now, 0.45); }
        else if (cat) this.bark(id, c, cat, pos, now);
        if (clip === 'getup') { this.play(id, 'buzz/spinup', pos, now + 0.2, 0.35); c.lastBark = -10; this.bark(id, c, 'indignant', pos, now + 0.5); }
        if (prevClip === 'land' && !rotors) this.play(id, 'buzz/tap', pos, now, 0.4, { family: 'step' });
      }
      if (emote && emote !== prevEmote) { const cat = EMOTE_CAT[emote]; if (cat) this.bark(id, c, cat, pos, now, 0.5); }
      // docked on its beacon: the pad's latch clunk (m5.ts beacon/dock)
      if (DOCKED >= 0 && fsm === DOCKED && prevFsm !== DOCKED && prevFsm >= 0) this.play(id, 'beacon/dock', pos, now + 0.05, 0.45, { family: 'impact' });
      if (LANDED >= 0 && fsm === LANDED && prevFsm !== LANDED && prevFsm >= 0) this.play(id, 'buzz/tap', pos, now, 0.4, { family: 'step' });
    }
    // ---- continuous ----
    if (rotors) {
      // thrust: hover 0.8; climbing and dashing work harder; a load sags the pitch (aux) and adds effort
      const load = c.carrying ? clamp(0.3 + c.loadKg / 2.8, 0.3, 1) : 0; // B5: ≤ 2 kg
      const thrust = clamp(0.8 + Math.max(0, vy) * 0.35 + Math.min(vh, 3) * 0.12 + 0.2 * load - Math.max(0, -vy) * 0.15 + (fsm === STARTLED && STARTLED >= 0 ? 0.25 : 0), 0.4, 1.5); // + the startle's bob (beta)
      h.loop(`rotor:${id}`, 'rotor', pos, thrust, { aux: load, doppler: true });
      if (c.carrying && c.loadKg >= 1.4 && now >= c.nextStrain) { this.bark(id, c, 'strain', pos, now, 0.4); c.nextStrain = now + 4 + 3 * hash01(id, h.tick(), 9); }
    }
    if (c.winchRate > 0.05) h.loop(`winch:${id}`, 'winch', [pos[0], pos[1] - 0.03, pos[2]], Math.min(1.4, c.winchRate * 2));
    c.descending = vy < -0.15 ? Math.min(1, c.descending + dt) : Math.max(0, c.descending - dt * 0.5);
    // idle chatter while hovering or landed (not asleep, not on a job)
    if (!asleep && !ragdoll && (!clip || CLIP_CAT[clip] === 'idle') && now >= c.nextIdle) {
      this.bark(id, c, 'idle', pos, now, 0.4);
      c.nextIdle = now + 8 + 10 * hash01(id, h.tick(), 3);
    }
  }

  /** BUZZ events (B5). Returns true when handled. */
  event(e: SimEventLike, type: string | undefined, when: number): boolean {
    if (type !== 'buzz') return false;
    if (!finite3(e.pos)) return true;
    const c = this.get(e.part, e.pos);
    const J = Math.max(0, fin(e.mag, 0));
    switch (e.kind) {
      case 'Impact':
        if (J >= 0.05 && this.h.now() - c.lastPlink > 0.06) { c.lastPlink = this.h.now(); this.play(e.part, 'buzz/plink', e.pos, when, clamp(0.25 + Math.log10(1 + J) * 0.4, 0.2, 0.7), { family: 'impact' }); }
        return true;
      case 'Ragdoll': this.play(e.part, 'buzz/clatter', e.pos, when, 0.5, { family: 'impact' }); this.bark(e.part, c, 'alarm', e.pos, when + 0.05); c.carrying = false; return true;
      // B5: Fetch = the claw closes on an item (mag = its kg, pos = the claw); Deliver = it lets go on the pad
      case 'Fetch': c.carrying = true; c.loadKg = clamp(J, 0, 2); this.play(e.part, 'buzz/claw', e.pos, when, 0.45); return true;
      case 'Deliver': c.carrying = false; c.loadKg = 0; this.play(e.part, 'buzz/claw', e.pos, when, 0.35, { rate: 1.12 }); c.lastBark = -10; this.bark(e.part, c, 'deliver', e.pos, when + 0.12, 0.6); return true;
      case 'Getup': c.lastBark = -10; this.bark(e.part, c, 'indignant', e.pos, when + 0.5); return true;
      case 'Emote': {
        const name = lookup(this.names()[1], Math.round(fin(e.mag, 0)));
        const cat = name ? EMOTE_CAT[name] : null;
        if (cat) this.bark(e.part, c, cat, e.pos, when, 0.5);
        return true;
      }
      case 'CritterState': case 'Trapped': case 'Despawn': case 'Launch': return true;
      default: return false;
    }
  }

  /** Forget drones that stopped reporting. */
  update2(now: number): void { for (const [id, c] of this.rt) if (now - c.seen > 2) this.rt.delete(id); }
}
