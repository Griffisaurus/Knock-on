// Ambience (AUDIO.md §9, environments.md §1.7, §2.7 and §3.7): per-environment room tones, positional emitters
// and seeded random one-shots on their own bus, kept low and ducked under action.
//
// Behaviour by mode (AUDIO §9; see M2_NOTES_F.md, M3_NOTES_F3.md):
//   build      beds at full ambience level, random one-shots on: the room is what you hear while building
//   countdown  beds dip 3 dB and one-shots hold off (anticipation)
//   running    beds at −4 dB, then ducked by action (music heat + busy sfx voices) down to −12 dB;
//              one-shots only when the machine is quiet. Emitters (fridge, clock, Mochi) keep their own time.
//   paused     back to build level: time stops, the room doesn't
// Ambience never stops on Stop: it belongs to the room, not the run.
//
// M3: THE TINKER LAB (environments.md §3.7): a warm, still classroom tone with a distant, wordless schoolyard
// wash through the glass; the wall clock above the chalkboard; two pendant-lamp filament hums; MOCHI asleep at
// the bench end (purr bed + an occasional sleepy chirp, silent while the ambient Mochi is hidden); seeded
// radiator ticks and knocks; birds and leaves at the windows; a far-off school bell every few minutes.

import type { Recipe } from './bank';
import { Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, hp, lp, mixInto, modal, normalize, seamless, white,
} from './synth';
import { clamp, fin, type Vec3 } from './types';
import { spaceAmbienceRecipes } from './ambience_m5';
import { HANGAR_SET, MOON_SET, spacePreset } from '@knockon/parts-data'; // W5 (M5): space-set emitter positions

const at = (s: number): number => Math.round(s * SR);

// ============================================================================================
// sounds
// ============================================================================================

function studioRoom(rng: Rng): Float32Array {
  return normalize(seamless(8, 0.5, (len) => {
    const x = normalize(lp(brown(len, rng), 180), 0.6);
    const air = bp(lp(white(len, rng), 1500), 600, 0.4);
    for (let i = 0; i < len; i++) air[i] = air[i]! * (0.8 + 0.2 * Math.sin(2 * Math.PI * i / SR / 8));
    mixInto(x, normalize(air, 0.35));
    return x;
  }), 0.3);
}

function ballastHum(): Float32Array {
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    x[i] = Math.sin(2 * Math.PI * 120 * t) + 0.5 * Math.sin(2 * Math.PI * 240 * t) + 0.25 * Math.tanh(4 * Math.sin(2 * Math.PI * 360 * t));
  }
  return normalize(x, 0.25);
}

function kitchenRoom(rng: Rng): Float32Array {
  return normalize(seamless(10, 0.6, (len) => {
    const x = normalize(lp(brown(len, rng), 300), 0.5);
    // distant morning traffic through glass: two slow swells per loop
    const tr = lp(brown(len, rng), 120);
    for (let i = 0; i < len; i++) { const t = i / SR; tr[i] = tr[i]! * Math.pow(Math.max(0, Math.sin(Math.PI * t / 5)), 2); }
    mixInto(x, normalize(tr, 0.45));
    mixInto(x, normalize(hp(white(len, rng), 5000), 0.04));
    return x;
  }), 0.3);
}

function fridgeHum(rng: Rng): Float32Array {
  // compressor: 60 Hz family pitched down an octave for the 5:1 set (30 Hz), plus a mechanical rattle; 1 s periodic
  const x = new Float32Array(SR);
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    x[i] = 0.4 * Math.sin(2 * Math.PI * 30 * t) + Math.sin(2 * Math.PI * 60 * t + 0.3) + 0.6 * Math.sin(2 * Math.PI * 90 * t) + 0.35 * Math.sin(2 * Math.PI * 120 * t)
      + 0.15 * Math.sin(2 * Math.PI * 240 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 15 * t)) + 0.05 * Math.sin(2 * Math.PI * 400 * t);
  }
  mixInto(x, normalize(seamless(1, 0.1, (n) => lp(white(n, rng), 500)), 0.1));
  return normalize(x, 0.3);
}

function fridgeShudder(rng: Rng, start: boolean): Float32Array {
  const x = alloc(1.0);
  mixInto(x, modal(x.length, contact(0.004, rng, 0.4), [{ f: 70, amp: 1, tau: 0.12 }, { f: 160, amp: 0.5, tau: 0.08 }, { f: 410, amp: 0.25, tau: 0.04 }]));
  const r = bp(white(at(0.6), rng), 300, 1.5);
  envFn(r, (t) => (start ? Math.min(1, t / 0.05) : 1) * Math.exp(-t / 0.15) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 22 * t)));
  mixInto(x, normalize(r, 0.4), at(start ? 0.02 : 0));
  return fadeEdges(normalize(lp(x, 2000), 0.4));
}

function clockTick(rng: Rng, tock: boolean): Float32Array {
  // a heavy, slow tick (the clock is 5× scale): lower and woodier than the Ringer's
  const f = tock ? 980 : 1150;
  const x = modal(at(0.25), contact(0.0004, rng), [{ f, amp: 1, tau: 0.02 }, { f: f * 2.05, amp: 0.4, tau: 0.012 }, { f: 300, amp: 0.7, tau: 0.05 }]);
  return fadeEdges(normalize(x, 0.35));
}

function bird(rng: Rng): Float32Array {
  const n = 2 + rng.int(5);
  const x = alloc(n * 0.16 + 0.2);
  const base = 2600 + 1800 * rng.next();
  for (let k = 0; k < n; k++) {
    const d = 0.05 + 0.08 * rng.next();
    const f0 = base * (0.85 + 0.3 * rng.next()), f1 = base * (0.8 + 0.5 * rng.next());
    const c = chirp(at(d), (t) => (f0 + (f1 - f0) * t / d) * (1 + 0.04 * Math.sin(2 * Math.PI * 60 * t)), (t) => Math.sin(Math.PI * t / d));
    mixInto(x, c, at(k * (0.1 + 0.07 * rng.next())), 0.5 + 0.5 * rng.next());
  }
  return fadeEdges(normalize(lp(x, 7000), 0.3));
}

function drip(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, bubble(0.04, 1200 + 600 * rng.next(), 0.9, 0.01), 0, 0.8);
  mixInto(x, modal(x.length, contact(0.0002, rng), [{ f: 2900 + 300 * rng.next(), amp: 1, tau: 0.15 }, { f: 5100, amp: 0.4, tau: 0.08 }]), 0, 0.25);
  return fadeEdges(normalize(x, 0.3));
}

function appliance(rng: Rng, v: number): Float32Array {
  const x = alloc(1.6);
  if (v % 3 === 0) {
    // kettle switching off: a firm click, then a few settling ticks
    mixInto(x, modal(at(0.1), contact(0.0003, rng), [{ f: 1700, amp: 1, tau: 0.01 }, { f: 520, amp: 0.7, tau: 0.02 }]));
    for (let k = 0; k < 4; k++) mixInto(x, modal(at(0.05), contact(0.0002, rng), [{ f: 3000 + 800 * rng.next(), amp: 1, tau: 0.005 }]), at(0.3 + k * (0.2 + 0.15 * rng.next())), 0.2);
  } else if (v % 3 === 1) {
    // the ice maker drops a batch of cubes
    for (let k = 0; k < 9; k++) mixInto(x, modal(at(0.15), contact(0.0006, rng, 0.3), [{ f: 900 + 900 * rng.next(), amp: 1, tau: 0.03 }, { f: 2400 + 900 * rng.next(), amp: 0.4, tau: 0.015 }]), at(0.05 + k * 0.04 + rng.next() * 0.05), 0.4 + 0.6 * rng.next());
    lp(x, 3000);
  } else {
    // a distant microwave finishing in the next room
    for (let k = 0; k < 3; k++) {
      const b = chirp(at(0.18), () => 2000, (t) => Math.min(1, t / 0.005) * Math.min(1, (0.18 - t) / 0.01));
      for (let i = 0; i < b.length; i++) b[i] = Math.tanh(3 * b[i]!);
      mixInto(x, b, at(k * 0.36));
    }
    lp(x, 2500);
  }
  return fadeEdges(normalize(x, 0.3));
}

// ---- THE TINKER LAB ----

function tinkerRoom(rng: Rng): Float32Array {
  return normalize(seamless(12, 0.8, (len) => {
    // warm, still room: deep and soft, a little warmer than the Studio
    const x = normalize(lp(brown(len, rng), 220), 0.55);
    const air = bp(lp(white(len, rng), 1200), 450, 0.5);
    mixInto(x, normalize(air, 0.18));
    // the schoolyard far off through the glass: a wordless band-limited wash (no voice formants, no chatter),
    // in slow swells whose periods divide the loop (12, 6, 4 s), so it loops seamlessly
    const yard = bp(lp(white(len, rng), 1400), 650, 0.45);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const sw = 0.5 + 0.22 * Math.sin(2 * Math.PI * t / 12 + 0.7) + 0.18 * Math.sin(2 * Math.PI * t / 6 + 2.1) + 0.1 * Math.sin(2 * Math.PI * t / 4 + 4);
      yard[i] = yard[i]! * Math.max(0, sw);
    }
    mixInto(x, normalize(lp(yard, 1100), 0.2));
    // leaves and air outside, barely there
    mixInto(x, normalize(hp(white(len, rng), 3500), 0.025));
    return x;
  }), 0.3);
}

function tinkerTick(rng: Rng, tock: boolean): Float32Array {
  // a classroom wall clock at the set's 2:1 scale: lighter than the Kitchen's giant clock
  const f = tock ? 1320 : 1560;
  const x = modal(at(0.2), contact(0.0003, rng), [{ f, amp: 1, tau: 0.015 }, { f: f * 2.1, amp: 0.35, tau: 0.008 }, { f: 420, amp: 0.5, tau: 0.03 }]);
  return fadeEdges(normalize(x, 0.32));
}

function radiator(rng: Rng, v: number): Float32Array {
  const x = alloc(0.9);
  if (v % 2 === 0) {
    // expansion tick: a small metallic ping and a tiny knock
    mixInto(x, modal(at(0.4), contact(0.0002, rng), [{ f: 2200 + 1000 * rng.next(), amp: 1, tau: 0.06 }, { f: 5100 + 900 * rng.next(), amp: 0.3, tau: 0.03 }]));
    mixInto(x, modal(at(0.1), contact(0.001, rng), [{ f: 380, amp: 1, tau: 0.02 }]), at(0.005), 0.4);
  } else {
    // a cast-iron knock as the water moves, with a short rattle
    mixInto(x, modal(at(0.8), contact(0.0015, rng, 0.3), [{ f: 420 + 60 * rng.next(), amp: 1, tau: 0.12 }, { f: 1100, amp: 0.5, tau: 0.07 }, { f: 2350, amp: 0.25, tau: 0.04 }]));
    for (let k = 0; k < 3; k++) mixInto(x, modal(at(0.06), contact(0.0004, rng), [{ f: 1800 + 600 * rng.next(), amp: 1, tau: 0.01 }]), at(0.08 + k * 0.05), 0.2);
  }
  return fadeEdges(normalize(lp(x, 6000), 0.3));
}

function leaves(rng: Rng): Float32Array {
  const x = alloc(2.4);
  const n = bp(white(x.length, rng), 2600, 0.5);
  envFn(n, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 2.4)), 2));
  mixInto(x, normalize(n, 0.6));
  for (let i = 0; i < 40; i++) {
    const g = hp(envAD(white(at(0.01), rng), 0.0005, 0.003), 2500);
    const t = 0.3 + 1.8 * rng.next();
    mixInto(x, normalize(g, 0.2 * Math.sin(Math.PI * t / 2.4)), at(t));
  }
  return fadeEdges(normalize(lp(x, 6000), 0.25), 0.05, 0.2);
}

function schoolBell(rng: Rng): Float32Array {
  // a far-off electric school bell: a hammer at ~19 Hz on a gong, heard through glass and distance
  const x = alloc(3.0);
  const strike = modal(at(0.4), contact(0.0002, rng), [{ f: 1080, amp: 1, tau: 0.25 }, { f: 2620, amp: 0.5, tau: 0.12 }, { f: 4300, amp: 0.2, tau: 0.05 }]);
  for (let k = 0; k / 19 < 2.2; k++) mixInto(x, strike, at(k / 19), 0.6 + 0.2 * rng.next());
  lp(x, 2200);
  envFn(x, (t) => Math.min(1, t / 0.05));
  return fadeEdges(normalize(x, 0.3), 0.01, 0.4);
}

function yard(rng: Rng, v: number): Float32Array {
  const x = alloc(2.0);
  if (v % 3 === 0) {
    // a ball bouncing far away on the playground
    let t = 0, g = 1, d = 0.45;
    for (let k = 0; k < 6; k++) {
      mixInto(x, modal(at(0.2), contact(0.004, rng, 0.2), [{ f: 180 + 30 * rng.next(), amp: 1, tau: 0.03 }, { f: 420, amp: 0.4, tau: 0.02 }]), at(t), g);
      t += d; d *= 0.72; g *= 0.75;
    }
  } else if (v % 3 === 1) {
    // a gate clanking shut across the yard
    mixInto(x, modal(at(1.4), contact(0.002, rng, 0.4), [{ f: 310, amp: 1, tau: 0.3 }, { f: 870, amp: 0.6, tau: 0.2 }, { f: 1730, amp: 0.3, tau: 0.1 }]));
    mixInto(x, modal(at(0.6), contact(0.002, rng, 0.4), [{ f: 330, amp: 1, tau: 0.2 }, { f: 910, amp: 0.5, tau: 0.12 }]), at(0.18), 0.5);
  } else {
    // a coach's whistle, two short trills
    for (let k = 0; k < 2; k++) {
      const w = chirp(at(0.25), (t) => 2700 * (1 + 0.03 * Math.sign(Math.sin(2 * Math.PI * 28 * t))), (t) => Math.min(1, t / 0.01) * Math.min(1, (0.25 - t) / 0.02));
      mixInto(x, w, at(k * 0.35), 0.6);
    }
  }
  return fadeEdges(normalize(lp(x, 1800), 0.3));
}

export function ambienceRecipes(): Recipe[] {
  return [
    ['amb/studio/room', 1, studioRoom], ['amb/studio/hum', 1, () => ballastHum()],
    ['amb/kitchen/room', 1, kitchenRoom], ['amb/kitchen/fridge', 1, fridgeHum],
    ['amb/kitchen/fridgeOn', 1, (g) => fridgeShudder(g, true)], ['amb/kitchen/fridgeOff', 1, (g) => fridgeShudder(g, false)],
    ['amb/kitchen/tick', 1, (g) => clockTick(g, false)], ['amb/kitchen/tock', 1, (g) => clockTick(g, true)],
    ['amb/kitchen/bird', 6, bird], ['amb/kitchen/drip', 4, drip], ['amb/kitchen/appliance', 3, appliance],
    ['amb/tinker/room', 1, tinkerRoom], ['amb/tinker/tick', 1, (g) => tinkerTick(g, false)], ['amb/tinker/tock', 1, (g) => tinkerTick(g, true)],
    ['amb/tinker/radiator', 4, radiator], ['amb/tinker/leaves', 3, leaves], ['amb/tinker/bell', 1, schoolBell], ['amb/tinker/yard', 3, yard],
    // M5 (F5): ORBITAL HANGAR and MOON BASE (ambience_m5.ts)
    ...spaceAmbienceRecipes(),
  ];
}

// ============================================================================================
// director
// ============================================================================================

/** Kitchen set coordinates (environments.md §2.1, Blender Z-up, +Y back) → engine Y-up for the active preset. */
function kitchenPos(preset: string, sx: number, sy: number, sz: number): Vec3 {
  const oy = preset === 'room' ? 24 : 0; // Room world origin = set (0, +24, 0); Warehouse origin = set origin
  return [sx, sz, -(sy - oy)];
}

/** Tinker Lab set coordinates (§3: origin = Room floor centre, 2:1 set) → engine. Desk world origin = set (0, +6.2, +1.8). */
export function tinkerPos(preset: string, sx: number, sy: number, sz: number): Vec3 {
  return preset === 'desk' ? [sx, sz - 1.8, -(sy - 6.2)] : [sx, sz, -sy];
}

interface Emitter { name: string; pos: Vec3; ref: number; level: number }
interface EnvDef { bed: string; bedLevel: number; emitters: (preset: string) => Emitter[] }

const MOCHI = 'loop/purr';
/** Beta (D127): the Hangar's zero-g ring drones follow the world's `env.zones` (setZones). */
const RING = 'amb/hangar/zerog_ring';

const ENVS: Record<string, EnvDef> = {
  studio: {
    bed: 'amb/studio/room', bedLevel: 1,
    // the off-screen key light's ballast: barely audible, 3D
    emitters: () => [{ name: 'amb/studio/hum', pos: [9, 6, 7], ref: 4, level: 0.25 }],
  },
  kitchen: {
    bed: 'amb/kitchen/room', bedLevel: 1,
    emitters: (p) => [{ name: 'amb/kitchen/fridge', pos: kitchenPos(p, -10.25, 30.25, 1.2), ref: 5, level: 0.8 }],
  },
  tinker: {
    bed: 'amb/tinker/room', bedLevel: 1.1,
    emitters: (p) => [
      // pendant filament buzz (2 m radius): one emitter for the bench row, one for the floor-mat row
      { name: 'loop/filament', pos: tinkerPos(p, 0, 6.2, 8.2), ref: 0.7, level: 0.35 },
      { name: 'loop/filament', pos: tinkerPos(p, 0, -1, 8.2), ref: 0.7, level: 0.3 },
      // MOCHI asleep on the cushion at the bench's shade end (3 m radius); toggled by setMochi()
      { name: MOCHI, pos: tinkerPos(p, 3.6, 6.6, 1.95), ref: 0.9, level: 0.55 },
    ],
  },
  // W5 (M5) hook: ORBITAL HANGAR and MOON BASE (environments.md §5.6, §6.7). Emitter positions come from the set data
  // (parts-data env_space.ts); F5 owns the sounds (recipe names below). Until a bed's recipe exists the Studio's plays.
  // F5 (M5): the gantry is occasional servo whirs and the PA chimes are one-shots (Ambience.hangar()); the Moon's
  // beacon blip is in the suit radio (non-positional, Ambience.moon()), so only the looped emitters are listed here
  hangar: {
    bed: 'amb/hangar/room', bedLevel: 1.6,
    emitters: (p) => spaceEmitters('hangar', p, { amb_hangar_zerog_ring: ['amb/hangar/zerog_ring', 2.5, 0.5] }),
  },
  moon: {
    bed: 'amb/moon/room', bedLevel: 0.57,
    emitters: (p) => spaceEmitters('moon', p, { amb_moon_dome_hum: ['amb/moon/dome_hum', 8, 0.7] }),
  },
};

/** F5 (M5): a space set's named emitter positions (PA speakers, gantry, window, dome) for a preset. */
function spacePoints(id: 'hangar' | 'moon', preset: string, name: string): Vec3[] {
  const sp = spacePreset(id === 'hangar' ? HANGAR_SET : MOON_SET, preset);
  return (sp?.emitters ?? []).filter((e) => e.name === name).map((e) => [e.pos[0], e.pos[1], e.pos[2]] as Vec3);
}

/** W5 (M5): a space set's emitters for a preset, mapped to recipe names, reference distances and levels. */
function spaceEmitters(id: 'hangar' | 'moon', preset: string, map: Readonly<Record<string, readonly [string, number, number]>>): Emitter[] {
  const sp = spacePreset(id === 'hangar' ? HANGAR_SET : MOON_SET, preset);
  return (sp?.emitters ?? []).flatMap((e) => { const m = map[e.name]; return m ? [{ name: m[0], pos: [e.pos[0], e.pos[1], e.pos[2]] as Vec3, ref: m[1], level: m[2] }] : []; });
}

export interface AmbienceState {
  mode: 'build' | 'countdown' | 'running'; paused: boolean;
  /** 0..1: how busy the mix is (music heat and live sfx voices). */
  action: number;
  /** M5: where the listener is (the Hangar window's silence pocket, the Moon dome's 20 m reach). */
  listener?: Vec3;
}

interface Src { src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null }

/** Ambience bus target relative to sfx: beds land near −48 LUFS in-mix at default volumes (environments.md §0.8). */
const AMB_TRIM = 0.044;

export class Ambience {
  private env = '';
  private preset = '';
  private bed: Src | null = null;
  private emitters: { e: Emitter; s: Src }[] = [];
  private duck = 1;
  private nextShot = 0;
  private nextTick = 0;
  private tickN = 0;
  private fridgeOn = false;
  private fridgeT0 = 0;
  private nextRadiator = 0;
  private nextBell = 0;
  private nextChirp = 0;
  private mochi = true;
  private readonly rng = new Rng('ambience');
  /** Voices the ambience holds (counted against the 64-voice budget). */
  active = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly bus: GainNode,
    private readonly get: (name: string) => readonly AudioBuffer[] | undefined,
    private readonly panning: () => PanningModelType,
    private readonly setReverb: (env: string) => void,
  ) {}

  /** Bus level (sfx volume, squared taper like the other buses). */
  static busGain(sfxVol: number): number { return sfxVol * sfxVol * AMB_TRIM; }

  setEnvironment(env: string, preset: string): void {
    // 'off' silences the room (tests); unknown environments (the Backlot) use the Studio's tone for now
    const e = env === 'off' ? 'off' : ENVS[env] && this.get(ENVS[env].bed) ? env : 'studio'; // W5 (M5): a set without its bed yet sounds like the Studio
    if (e === this.env && preset === this.preset) return;
    const now = this.ctx.currentTime;
    this.stopAll(now);
    this.env = e; this.preset = preset;
    if (e === 'off') return;
    // F5 (M5): the Hangar's Main Hall (Arena) rings longer than Bay 2 (environments.md §5.6: 2.0 s vs 1.6 s)
    this.setReverb(e === 'hangar' && preset === 'arena' ? 'hangar_arena' : e);
    const def = ENVS[e]!;
    this.bed = this.start(def.bed, null, 1, def.bedLevel, now);
    this.emitters = def.emitters(preset).flatMap((em) => {
      if (em.name === 'amb/kitchen/fridge') return []; // the fridge cycles: started in update()
      if (em.name === MOCHI && !this.mochi) return [];
      if (em.name === RING && !this.zones) return []; // beta (D127): zones switched off
      const s = this.start(em.name, em.pos, em.ref, em.level, now);
      return s ? [{ e: em, s }] : [];
    });
    this.fridgeOn = false;
    // the fridge cycle starts mid-way through its off phase, seeded so it doesn't kick in the moment you arrive
    this.fridgeT0 = now - 20 - 30 * this.rng.next();
    this.nextShot = now + 4 + 6 * this.rng.next();
    this.nextTick = Math.ceil(now);
    this.nextRadiator = now + 8 + 20 * this.rng.next();
    this.nextBell = now + 60 + 120 * this.rng.next();
    this.nextChirp = now + 15 + 30 * this.rng.next();
    // F5 (M5): the Moon's beacon blip lives in the suit radio: a non-positional 2 s loop (0.5 Hz, the antenna's blink)
    if (e === 'moon') { const s = this.start('amb/moon/beacon', null, 1, 0.35, now); if (s) this.emitters.push({ e: { name: 'amb/moon/beacon', pos: [0, 0, 0], ref: 1, level: 0.35 }, s }); }
    this.pocket = 1;
    this.recount();
  }

  /** The Tinker Lab's ambient MOCHI is hidden while the world holds a MOCHI part: so is its purr. */
  setMochi(visible: boolean): void {
    if (visible === this.mochi) return;
    this.mochi = visible;
    if (this.env !== 'tinker') return;
    const now = this.ctx.currentTime;
    const i = this.emitters.findIndex((x) => x.e.name === MOCHI);
    if (!visible && i >= 0) { this.stop(this.emitters[i]!.s, now, 0.6); this.emitters.splice(i, 1); }
    if (visible && i < 0) {
      const em = ENVS.tinker!.emitters(this.preset).find((x) => x.name === MOCHI)!;
      const s = this.start(em.name, em.pos, em.ref, em.level, now);
      if (s) this.emitters.push({ e: em, s });
    }
    this.recount();
  }

  /** Beta (D127): the world's zero-g zones are on (`env.zones`). */
  private zones = true;

  /**
   * Beta (D127): the Hangar's zero-g ring drones sound only while the world's zero-g zones are on (`env.zones`, which
   * players toggle in World settings). Off: each ring's drone fades out (0.5 s) and frees its voice; on: they fade back.
   */
  setZones(on: boolean): void {
    if (on === this.zones) return;
    this.zones = on;
    if (this.env !== 'hangar') return;
    const now = this.ctx.currentTime;
    if (!on) {
      for (let i = this.emitters.length - 1; i >= 0; i--) if (this.emitters[i]!.e.name === RING) { this.stop(this.emitters[i]!.s, now, 0.5); this.emitters.splice(i, 1); }
    } else {
      for (const em of ENVS.hangar!.emitters(this.preset)) {
        if (em.name !== RING) continue;
        const s = this.start(em.name, em.pos, em.ref, em.level, now);
        if (s) this.emitters.push({ e: em, s });
      }
    }
    this.recount();
  }

  private start(name: string, pos: Vec3 | null, ref: number, level: number, now: number): Src | null {
    const buf = this.get(name)?.[0];
    if (!buf) return null;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, loop: true });
    const gain = new GainNode(this.ctx, { gain: 0 });
    src.connect(gain);
    let panner: PannerNode | null = null;
    if (pos) {
      panner = new PannerNode(this.ctx, { panningModel: this.panning(), distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1, maxDistance: 200, positionX: pos[0], positionY: pos[1], positionZ: pos[2] });
      gain.connect(panner).connect(this.bus);
    } else gain.connect(this.bus);
    src.start(now, (this.rng.next() * buf.duration) % buf.duration);
    gain.gain.setTargetAtTime(clamp(level, 0, 2), now, 0.8); // fade in
    return { src, gain, panner };
  }

  private stop(s: Src | null, now: number, tau = 0.4): void {
    if (!s) return;
    s.gain.gain.cancelScheduledValues(now);
    s.gain.gain.setTargetAtTime(0, now, tau);
    s.src.stop(now + tau * 6);
    s.src.onended = () => { s.gain.disconnect(); s.panner?.disconnect(); };
  }

  private stopAll(now: number): void {
    this.stop(this.bed, now);
    for (const { s } of this.emitters) this.stop(s, now);
    this.bed = null; this.emitters = [];
    this.recount();
  }

  private recount(): void { this.active = (this.bed ? 1 : 0) + this.emitters.length; }

  private shot(name: string, v: number, pos: Vec3 | null, ref: number, gain: number, when: number, rate = 1): void {
    const list = this.get(name);
    if (!list?.length) return;
    const buf = list[Math.floor(v * list.length) % list.length]!;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: clamp(rate, 0.25, 4) });
    const g = new GainNode(this.ctx, { gain: clamp(gain, 0, 2) });
    src.connect(g);
    let panner: PannerNode | null = null;
    if (pos) {
      panner = new PannerNode(this.ctx, { panningModel: this.panning(), distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1, maxDistance: 200, positionX: pos[0], positionY: pos[1], positionZ: pos[2] });
      g.connect(panner).connect(this.bus);
    } else g.connect(this.bus);
    src.start(Math.max(fin(when, 0), this.ctx.currentTime));
    src.onended = () => { g.disconnect(); panner?.disconnect(); };
  }

  /** A 1 Hz tick-tock, scheduled a little ahead on whole seconds. */
  private clock(now: number, pos: Vec3, tick: string, tock: string, ref: number, gain: number): void {
    while (this.nextTick < now + 0.25) {
      if (this.nextTick >= now - 0.05) this.shot(this.tickN % 2 ? tock : tick, 0, pos, ref, gain, this.nextTick);
      this.nextTick += 1; this.tickN++;
    }
  }

  update(st: AmbienceState): void {
    if (!this.env || this.env === 'off') return;
    const now = this.ctx.currentTime;
    // ---- ducking ----
    let target = 1;
    if (!st.paused) {
      if (st.mode === 'countdown') target = 0.7;
      else if (st.mode === 'running') target = 0.63 * (1 - 0.6 * clamp(st.action, 0, 1));
    }
    // fast down (0.3 s), slow up (1.5 s)
    const k = target < this.duck ? 0.12 : 0.025;
    const next = clamp(this.duck + (target - this.duck) * k, 0, 1);
    if (Math.abs(next - this.duck) > 0.002) {
      this.duck = next;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(clamp(this.duck * this.base, 0, 1), now, 0.05);
    }
    const quiet = st.paused || st.mode === 'build' || (st.mode === 'running' && st.action < 0.2);
    if (this.env === 'kitchen') this.kitchen(now, quiet);
    else if (this.env === 'tinker') this.tinker(now, st, quiet);
    else if (this.env === 'hangar') this.hangar(now, st, quiet);
    else if (this.env === 'moon') this.moon(now, st, quiet);
  }

  // ---- F5 (M5): ORBITAL HANGAR and MOON BASE (environments.md §5.6, §6.7) ----

  /** The Hangar window's silence pocket (bed −3 dB within 10 m of the glass), smoothed. */
  private pocket = 1;

  private hangar(now: number, st: AmbienceState, quiet: boolean): void {
    const P = this.preset;
    // the window: a silence pocket within 10 m of the glass (the bed ducks 3 dB)
    const win = spacePoints('hangar', P, 'amb_hangar_window')[0];
    const l = st.listener;
    const inPocket = !!(win && l && Math.hypot(l[0] - win[0], l[2] - win[2]) < 10);
    const want = inPocket ? 0.708 : 1;
    if (Math.abs(want - this.pocket) > 0.005 && this.bed) {
      this.pocket += (want - this.pocket) * 0.05;
      this.bed.gain.gain.setTargetAtTime(clamp(ENVS.hangar!.bedLevel * this.pocket, 0, 2), now, 0.1);
    }
    // PA: a two-tone chime and a wordless announcement every 60–120 s, sparse radio beeps between (seeded)
    if (now >= this.nextBell) {
      const pa = spacePoints('hangar', P, 'amb_hangar_pa_chime');
      if (st.mode !== 'countdown' && pa.length) this.shot('amb/hangar/chime', this.rng.next(), pa[this.rng.int(pa.length)]!, 14, 0.5, now);
      this.nextBell = now + 60 + 60 * this.rng.next();
    }
    if (now >= this.nextShot) {
      const pa = spacePoints('hangar', P, 'amb_hangar_pa_chime');
      if (quiet && pa.length && now < this.nextBell - 6) this.shot('amb/hangar/radio', this.rng.next(), pa[this.rng.int(pa.length)]!, 10, 0.35, now);
      this.nextShot = now + 15 + 20 * this.rng.next();
    }
    // the gantry crane: an occasional servo whir (it's static: sound only)
    if (now >= this.nextRadiator) {
      const g = spacePoints('hangar', P, 'amb_hangar_gantry')[0];
      if (g && (quiet || st.action < 0.4)) this.shot('amb/hangar/servo', this.rng.next(), [g[0] + (this.rng.next() - 0.5) * 30, g[1], g[2]], 12, 0.4, now);
      this.nextRadiator = now + 25 + 35 * this.rng.next();
    }
  }

  private moon(now: number, st: AmbienceState, quiet: boolean): void {
    // the dome's hum is structure-borne: audible within 20 m of the dome only (a hard fade from 20 to 28 m)
    const l = st.listener;
    for (const { e, s } of this.emitters) {
      if (e.name !== 'amb/moon/dome_hum' || !l) continue;
      const d = Math.hypot(l[0] - e.pos[0], l[1] - e.pos[1], l[2] - e.pos[2]) - 15; // from the dome's skin (Ø 30 m)
      const g = clamp(1 - (d - 20) / 8, 0, 1);
      s.gain.gain.setTargetAtTime(clamp(e.level * g, 0, 2), now, 0.2);
    }
    // suit-radio static now and then (seeded), only when the machine is quiet
    if (now >= this.nextShot) {
      if (quiet) this.shot('amb/moon/static', this.rng.next(), null, 1, 0.35, now);
      this.nextShot = now + 12 + 25 * this.rng.next();
    }
  }

  private kitchen(now: number, quiet: boolean): void {
    // fridge cycle (40 s on / 60 s off), clock, random one-shots
    const P = this.preset;
    const fridge = kitchenPos(P, -10.25, 30.25, 1.2);
    const phase = (now - this.fridgeT0) % 100;
    const on = phase < 40;
    if (on !== this.fridgeOn) {
      this.fridgeOn = on;
      if (on) {
        this.shot('amb/kitchen/fridgeOn', 0, fridge, 5, 0.6, now);
        const s = this.start('amb/kitchen/fridge', fridge, 5, 0.8, now + 0.15);
        if (s) this.emitters.push({ e: { name: 'amb/kitchen/fridge', pos: fridge, ref: 5, level: 0.8 }, s });
      } else {
        const i = this.emitters.findIndex((x) => x.e.name === 'amb/kitchen/fridge');
        if (i >= 0) { this.stop(this.emitters[i]!.s, now, 0.25); this.emitters.splice(i, 1); }
        this.shot('amb/kitchen/fridgeOff', 0, fridge, 5, 0.5, now);
      }
      this.recount();
    }
    // the wall clock above the doorway
    this.clock(now, kitchenPos(P, -31.5, -28, 11), 'amb/kitchen/tick', 'amb/kitchen/tock', 6, 0.5);
    // random one-shots: birds at the window, the tap's drip, an appliance now and then; hold off while busy
    if (now >= this.nextShot) {
      const r = this.rng.next(), v = this.rng.next();
      if (quiet) {
        if (r < 0.5) this.shot('amb/kitchen/bird', v, kitchenPos(P, (v - 0.5) * 6, 32, 8.5), 6, 0.45, now);
        else if (r < 0.85) this.shot('amb/kitchen/drip', v, kitchenPos(P, 0, 30.5, 3.6), 3, 0.5, now);
        else this.shot('amb/kitchen/appliance', v, r < 0.93 ? kitchenPos(P, -20, 30.5, 5) : fridge, 6, 0.5, now);
      }
      this.nextShot = now + 3 + 8 * this.rng.next();
    }
  }

  private tinker(now: number, st: AmbienceState, quiet: boolean): void {
    const P = this.preset;
    // the wall clock above the chalkboard (back wall, centre)
    this.clock(now, tinkerPos(P, 0, 8.3, 7.4), 'amb/tinker/tick', 'amb/tinker/tock', 3, 0.42);
    // windows (left wall): birds and leaves; the schoolyard far off (wordless: a ball, a gate, a whistle)
    if (now >= this.nextShot) {
      const r = this.rng.next(), v = this.rng.next();
      if (quiet) {
        const win = tinkerPos(P, -8.6, -6 + 11 * v, 4 + 2 * this.rng.next());
        if (r < 0.45) this.shot('amb/kitchen/bird', v, win, 4, 0.4, now);
        else if (r < 0.75) this.shot('amb/tinker/leaves', v, win, 4, 0.45, now);
        else this.shot('amb/tinker/yard', v, tinkerPos(P, -26, -8 + 16 * v, 1), 8, 0.4, now);
      }
      this.nextShot = now + 4 + 8 * this.rng.next();
    }
    // radiators under the windows: an occasional tick or knock (seeded, every 20–60 s)
    if (now >= this.nextRadiator) {
      if (st.mode !== 'countdown' && (quiet || st.action < 0.4)) {
        const y = [-5, -1, 3][this.rng.int(3)]!;
        this.shot('amb/tinker/radiator', this.rng.next(), tinkerPos(P, -7.9, y, 0.5), 2, 0.5, now);
      }
      this.nextRadiator = now + 20 + 40 * this.rng.next();
    }
    // a far-off school bell every few minutes (seeded)
    if (now >= this.nextBell) {
      if (st.mode !== 'countdown') this.shot('amb/tinker/bell', 0, tinkerPos(P, -40, 10, 6), 10, 0.45, now);
      this.nextBell = now + 150 + 150 * this.rng.next();
    }
    // MOCHI's sleepy chirp now and then
    if (now >= this.nextChirp) {
      if (this.mochi && quiet) this.shot('mochi/mrrp', this.rng.next(), tinkerPos(P, 3.6, 6.6, 1.95), 0.9, 0.22, now, 0.82);
      this.nextChirp = now + 25 + 45 * this.rng.next();
    }
  }

  private base = AMB_TRIM;
  /** Called when the sfx volume changes. */
  setBase(b: number): void {
    this.base = clamp(fin(b, AMB_TRIM), 0, 1);
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(clamp(this.duck * this.base, 0, 1), now, 0.05);
  }

  dispose(): void { this.stopAll(this.ctx.currentTime); this.env = ''; }
}
