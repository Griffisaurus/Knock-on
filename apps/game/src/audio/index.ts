// KNOCK-ON audio (docs/AUDIO.md). Everything is synthesised procedurally at load (see bank.ts, music.ts);
// this file is the AudioDirector: event → cue mapping, voice management, spatialisation and the mix.
//
// Graph:
//   one-shot / loop voices ─▶ (panner) ─▶ sfxBus ─▶ sfxTone ─▶ spectGain ─┬──────────────▶ masterIn ─▶ glue ─▶ limiter ─▶ out
//                                          └▶ sfxSend ─▶ reverb ─────────┴──────────────▶ ┘
//   music layers ─▶ musicBus ─▶ duck ─▶ musicTone ─▶ musicSpect ─▶ masterIn   (musicBus also sends to the reverb)
//   ui ─▶ uiBus ─▶ masterIn (dry, centred)
//   ambience beds / emitters ─▶ ambBus (ducked under action) ─▶ masterIn (+ a little reverb)   (ambience.ts)
//
// M2: mech.ts (the 29 M2 parts), critters.ts (voices, footsteps) and ambience.ts (room tones) plug in through AudioHost.
// M3: m3.ts (the 30 M3 parts), pyro.ts (keg / nitro stacks, mass-explosion merging, the barrage bed), limiter.ts
// (AudioWorklet true-peak limiter at −1 dBTP), the Tinker Lab ambience, music v2, and spectacle audio for G3's
// hitstop and slow-mo (wall clock only: `hitstop()`, `slowmo()`, plus slow-mo inferred from the playhead rate).
// M4: m4.ts (the 15 M4 parts), BISCUIT / HENNY / DUSTY in critters.ts, and Matter audio: matterprobe.ts reduces the
// particles around the listener on the GPU (72 floats read back), matter.ts maps that to 6 granular streams played by
// matter-processor.js (AudioWorklet) on the matter bus, inside the sfx chain and under the limiter.

import { buildSfxBank, type Debris, type Material, type SfxBank } from './bank';
import { Ambience, ambienceRecipes } from './ambience';
import { CRITTER_TYPES, Critters, critterRecipes } from './critters';
import { createLimiter, loadLimiter, type LimiterStats } from './limiter';
import { Gadgets, SCALES, canonType, isM3, m3Recipes } from './m3';
import { M4Parts, M4_LOOPS, canonM4, isM4, m4Recipes } from './m4';
import { MatterAudio, tablesOnce, loadMatterWorklet, matterRecipes, type MatterField } from './matter';
import { MatterProbe, type MatterViewLike } from './matterprobe';
import { MECH_PART_TYPES, Mechanisms, mechRecipes, type AudioPath } from './mech';
import { buildMusicBank, Music, type MusicBank } from './music';
import { ClipAudio } from './clip';
import { Pyro, debrisFor, pyroRecipes } from './pyro';
import { hash01, hashStr } from './rng';
import { Motion, TELEPORT_M, fin, finite3, type AudioHost, type Family, type LoopKind, type LoopOpts, type M5LoopKind, type PlayOpts, type SimEventLike, type Vec3 } from './types';
import { AUDIO_PROP_TYPES, M5Parts, M5_EXTRA, M5_LOOPS, canonM5, isM5, m5Recipes, type PartProps } from './m5';
import './goovat'; // X5 (M5): GOO VAT's part sounds register into M5_EXTRA (before the bank is built)
import { Buzz, buzzRecipes } from './buzz';

export type { SimEventLike } from './types';
export type { AudioPath } from './mech';
export type { LimiterStats } from './limiter';
export type { MatterField, MatterBand } from './matter';
export type { MatterViewLike } from './matterprobe';
export type { PartProps } from './m5';
/** Beta (D127): the part types whose static props the director reads (setPartProps): GRAV WELL mode, FORCE WALL size, RIFT pair. */
export { AUDIO_PROP_TYPES };
export interface AudioListenerPose { pos: [number, number, number]; forward: [number, number, number]; up: [number, number, number] }

type LoopFam = 'roll' | 'mech' | 'critter' | 'matter';
const LOOP_FAMILY: Partial<Record<LoopKind, LoopFam>> = {
  roll: 'roll', spiral: 'roll', marble: 'roll', rail: 'roll', purr: 'critter', snore: 'critter', patter: 'critter', pedal: 'critter',
  // M4
  yolkroll: 'roll', pant: 'critter', roost: 'critter', drive: 'critter', vacuum: 'critter', binrattle: 'critter', matter: 'matter',
};
/** Concurrent loops per loop family (AUDIO §2: rolls 12, mechanism loops 16, critters 6; M4: Matter fallback beds 6). */
const LOOP_CAP: Record<LoopFam, number> = { roll: 12, mech: 16, critter: 6, matter: 6 };

// ---- voice management constants (AUDIO.md §2) ----
const MAX_VOICES = 64;
const FAMILY_LIMIT: Record<Family, number> = { impact: 24, roll: 12, mech: 16, pyro: 8, tail: 6, fx: 12, ui: 4, critter: 6, step: 6, amb: 4 };
const BASE_PRIO: Record<Family, number> = { impact: 1, roll: 0.6, mech: 0.9, pyro: 3, tail: 1.2, fx: 1.5, ui: 10, critter: 1.3, step: 0.45, amb: 0.3 };
/** Priority of a playing voice decays with age (a decayed tail is the first to be stolen). */
const AGE_TAU: Record<Family, number> = { impact: 0.15, roll: 1, mech: 0.4, pyro: 1, tail: 0.6, fx: 0.4, ui: 0.3, critter: 0.5, step: 0.1, amb: 0.5 };
/** A forward scrub delivers every event it jumped over in one batch: only the last 0.2 s of them are played. */
const SCRUB_KEEP_TICKS = 24;
/** Exaggerated speed of sound for the loop doppler (a "doppler-ish" sweep on a 15 m/s Skyrocket). */
const DOPPLER_C = 90;
const REF_DIST = 1, ROLLOFF = 1.2, MAX_DIST = 60;
const TICK_RATE = 120;
const IMPACT_MERGE_S = 0.04, IMPACT_MERGE_M = 1.5;
const LOOP_STALE_S = 0.2;
/** sfx bus make-up: voices are attenuated by inverse-distance from 1 m, and the camera usually sits 2–6 m away. */
const SFX_MAKEUP = 2.2;
/** Music stems are rendered with headroom; this brings the bed to roughly -22 dB RMS (build) / -19 dB (run) at volume 0.6. */
const MUSIC_TRIM = 1.8;
const SFX_SEND = 0.14;
/** Pyro make-up (measured: the loudest Kiloton, inside the fortress, reaches the −1 dBTP ceiling with < 1 dB of limiting). */
const PYRO_MAKEUP = 1.6;
/** Fallback (no AudioWorklet) sample-peak ceiling: −1 dBFS. */
const FALLBACK_CEIL = 0.891;
/** M4: Matter bus trim (granular streams → sfx bus). */
const MATTER_TRIM = 1;
/** M4: probe the Matter field at most this often (s): 30 Hz is plenty for a granular bed. */
const PROBE_EVERY = 1 / 30;

interface PartProfile { mat: Material; mass: number; debris: Debris }
const DEFAULT_PART: PartProfile = { mat: 'poly', mass: 1, debris: 'wood' };
const PARTS: Record<string, PartProfile> = {
  thud: { mat: 'poly', mass: 7, debris: 'brick' },
  boing: { mat: 'rubber', mass: 0.6, debris: 'paper' },
  stitch: { mat: 'poly', mass: 0.15, debris: 'paper' },
  helio: { mat: 'rubber', mass: 0.08, debris: 'paper' },
  brik: { mat: 'brick', mass: 3.6, debris: 'brick' },
  plank: { mat: 'wood', mass: 6, debris: 'wood' },
  slope: { mat: 'poly', mass: 20, debris: 'wood' },
  ledge: { mat: 'poly', mass: 20, debris: 'wood' },
  tube: { mat: 'poly', mass: 5, debris: 'glass' },
  fulcrum: { mat: 'wood', mass: 2.5, debris: 'wood' },
  anchor: { mat: 'steel', mass: 1, debris: 'brick' },
  sheave: { mat: 'steel', mass: 0.35, debris: 'brick' },
  treadway: { mat: 'rubber', mass: 2.3, debris: 'wood' },
  cog: { mat: 'steel', mass: 1, debris: 'brick' },
  motor: { mat: 'steel', mass: 1.6, debris: 'brick' },
  gale: { mat: 'poly', mass: 0.9, debris: 'wood' },
  mains: { mat: 'poly', mass: 1.8, debris: 'wood' },
  stomp_pad: { mat: 'rubber', mass: 1.2, debris: 'wood' },
  the_button: { mat: 'poly', mass: 0.6, debris: 'wood' },
  wick: { mat: 'poly', mass: 0.35, debris: 'paper' },
  bangstick: { mat: 'paper', mass: 0.8, debris: 'paper' },
  snipper: { mat: 'steel', mass: 1.4, debris: 'brick' },
  topple_tile: { mat: 'tile', mass: 0.2, debris: 'wood' },
  pane: { mat: 'glass', mass: 2, debris: 'glass' },
  vase: { mat: 'glass', mass: 1, debris: 'glass' },
  keg: { mat: 'wood', mass: 10, debris: 'wood' },
  marble: { mat: 'glass', mass: 0.0054, debris: 'glass' },
  pig_iron: { mat: 'steel', mass: 6.5, debris: 'brick' },
  stacker: { mat: 'wood', mass: 0.3, debris: 'wood' },
  // M2 parts (materials from the art briefs; masses from GAME_SPEC §12 where given, else by size class)
  fuzz: { mat: 'rubber', mass: 0.06, debris: 'paper' },
  gutter: { mat: 'poly', mass: 3, debris: 'wood' },
  vortex: { mat: 'poly', mass: 6, debris: 'wood' },
  vortex_slim: { mat: 'poly', mass: 3, debris: 'wood' },
  sprong: { mat: 'rubber', mass: 4, debris: 'wood' },
  scoop: { mat: 'steel', mass: 0.8, debris: 'brick' },
  flap: { mat: 'wood', mass: 1, debris: 'wood' },
  dynamo: { mat: 'steel', mass: 4, debris: 'brick' },
  turbine: { mat: 'poly', mass: 2, debris: 'wood' },
  puffer: { mat: 'wood', mass: 1.5, debris: 'wood' },
  cell: { mat: 'poly', mass: 0.4, debris: 'paper' },
  suncell: { mat: 'glass', mass: 1, debris: 'glass' },
  lamp: { mat: 'glass', mass: 0.3, debris: 'glass' },
  torch: { mat: 'poly', mass: 0.4, debris: 'paper' },
  burning_glass: { mat: 'glass', mass: 0.5, debris: 'glass' },
  toggle: { mat: 'poly', mass: 0.5, debris: 'wood' },
  ringer: { mat: 'steel', mass: 0.6, debris: 'brick' },
  delay: { mat: 'poly', mass: 0.4, debris: 'wood' },
  t_plunger: { mat: 'wood', mass: 2.5, debris: 'wood' },
  skyrocket: { mat: 'paper', mass: 0.5, debris: 'paper' },
  big_top: { mat: 'steel', mass: 25, debris: 'brick' },
  cork_blaster: { mat: 'wood', mass: 1.2, debris: 'wood' },
  punchline: { mat: 'rubber', mass: 2, debris: 'wood' },
  gotcha_box: { mat: 'wood', mass: 2, debris: 'wood' },
  hamster_drive: { mat: 'poly', mass: 3, debris: 'wood' },
  pedal_rig: { mat: 'steel', mass: 8, debris: 'brick' },
  fishbowl: { mat: 'glass', mass: 6, debris: 'glass' },
  trap_box: { mat: 'steel', mass: 5, debris: 'brick' },
  mochi: { mat: 'rubber', mass: 4.5, debris: 'paper' },
  pip: { mat: 'rubber', mass: 0.12, debris: 'paper' },
  goby: { mat: 'rubber', mass: 0.05, debris: 'paper' },
  bandit: { mat: 'rubber', mass: 5.5, debris: 'paper' },
  // M3 parts (art briefs: materials and masses)
  lance: { mat: 'poly', mass: 0.5, debris: 'wood' },
  mirror_splitter: { mat: 'glass', mass: 0.4, debris: 'glass' },
  tripwire: { mat: 'poly', mass: 0.3, debris: 'wood' },
  ping: { mat: 'poly', mass: 0.3, debris: 'wood' },
  maglock: { mat: 'steel', mass: 3, debris: 'brick' },
  glint: { mat: 'glass', mass: 0.0054, debris: 'glass' },
  bearing: { mat: 'steel', mass: 0.0167, debris: 'brick' },
  spindeck: { mat: 'steel', mass: 4, debris: 'brick' },
  lift: { mat: 'steel', mass: 8, debris: 'brick' },
  rack: { mat: 'steel', mass: 1, debris: 'brick' },
  ram: { mat: 'steel', mass: 2, debris: 'brick' },
  powder_keg: { mat: 'wood', mass: 6, debris: 'wood' },
  jitterjuice: { mat: 'glass', mass: 0.4, debris: 'glass' },
  skyshow: { mat: 'paper', mass: 1.5, debris: 'paper' },
  flamer: { mat: 'steel', mass: 1.5, debris: 'brick' },
  popper: { mat: 'paper', mass: 0.2, debris: 'paper' },
  snaptrap: { mat: 'wood', mass: 0.5, debris: 'wood' },
  bonker: { mat: 'wood', mass: 1.2, debris: 'wood' },
  flinger: { mat: 'wood', mass: 3, debris: 'wood' },
  wrecker: { mat: 'steel', mass: 20, debris: 'brick' },
  pinger: { mat: 'steel', mass: 0.8, debris: 'brick' },
  paddle: { mat: 'poly', mass: 0.8, debris: 'wood' },
  bumper: { mat: 'rubber', mass: 0.6, debris: 'wood' },
  pin: { mat: 'wood', mass: 0.15, debris: 'wood' },
  tonebars: { mat: 'steel', mass: 1.2, debris: 'brick' },
  ding: { mat: 'steel', mass: 0.45, debris: 'brick' },
  fabricator: { mat: 'steel', mass: 10, debris: 'brick' },
  recycler: { mat: 'steel', mass: 8, debris: 'brick' },
  // M4 parts (art briefs: materials and masses)
  grit_hopper: { mat: 'poly', mass: 4, debris: 'wood' },
  hourglass: { mat: 'glass', mass: 0.6, debris: 'glass' },
  tank: { mat: 'poly', mass: 5, debris: 'glass' },
  sprinkle_can: { mat: 'poly', mass: 1.2, debris: 'wood' },
  waterwheel: { mat: 'poly', mass: 1.2, debris: 'wood' },
  sponge: { mat: 'rubber', mass: 0.2, debris: 'paper' },
  marble_hopper: { mat: 'poly', mass: 4, debris: 'glass' },
  blowout: { mat: 'poly', mass: 0.8, debris: 'wood' },
  vac: { mat: 'poly', mass: 0.8, debris: 'wood' },
  inflator: { mat: 'steel', mass: 3, debris: 'brick' },
  arc_tower: { mat: 'steel', mass: 6, debris: 'brick' },
  toast_cannon: { mat: 'steel', mass: 2, debris: 'brick' },
  yolk: { mat: 'paper', mass: 0.06, debris: 'paper' },
  zippy: { mat: 'poly', mass: 0.9, debris: 'wood' },
  quack: { mat: 'rubber', mass: 0.05, debris: 'paper' },
  biscuit: { mat: 'rubber', mass: 12, debris: 'paper' },
  henny: { mat: 'rubber', mass: 2.2, debris: 'paper' },
  dusty: { mat: 'poly', mass: 3.5, debris: 'wood' },
  // M5 parts (future.md, boom.md, drive.md: materials and masses) and BUZZ
  rift_gate: { mat: 'steel', mass: 4.5, debris: 'brick' },
  grav_well: { mat: 'steel', mass: 3, debris: 'brick' },
  tractor_beam: { mat: 'steel', mass: 2, debris: 'brick' },
  hover_pad: { mat: 'poly', mass: 2.5, debris: 'wood' },
  force_wall: { mat: 'steel', mass: 1.2, debris: 'brick' },
  coilgun_ring: { mat: 'poly', mass: 4, debris: 'glass' },
  stasis_field: { mat: 'steel', mass: 1.6, debris: 'brick' },
  buzz_beacon: { mat: 'poly', mass: 0.6, debris: 'wood' },
  singularity: { mat: 'steel', mass: 7, debris: 'brick' },
  grabber: { mat: 'poly', mass: 3.5, debris: 'wood' },
  goo_vat: { mat: 'poly', mass: 6, debris: 'glass' },
  buzz: { mat: 'poly', mass: 1.1, debris: 'wood' },
};
const profile = (type: string | undefined): PartProfile => (type ? PARTS[type] ?? PARTS[canonType(type)] ?? PARTS[canonM4(type)] ?? PARTS[canonM5(type)] : undefined) ?? DEFAULT_PART;
const ROLL_VARIANT: Record<string, 'heavy' | 'rubber' | 'hard'> = { thud: 'heavy', pig_iron: 'heavy', keg: 'heavy', powder_keg: 'heavy', boing: 'rubber', helio: 'rubber', fuzz: 'rubber', stitch: 'hard', marble: 'hard', glint: 'hard', bearing: 'hard' };
/** Round bodies that get a rolling layer (AUDIO §3). Marbles (Glint / Bearing) roll per surface (m3.ts). */
export const ROLLERS: ReadonlySet<string> = new Set(['thud', 'boing', 'stitch', 'fuzz', 'pig_iron', 'marble', 'glint', 'bearing', 'yolk']);

interface Voice {
  src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null;
  family: Family; prio: number; start: number; end: number; g: number; rate: number;
  key: string; pos: Vec3 | null; dead: boolean;
}

interface LoopState {
  id: string; kind: LoopKind; variant: string; pos: [number, number, number]; level: number; aux: number; seen: number;
  fam: LoopFam; motion: Motion | null; doppler: number; ref: number;
  /** Beta (D127): loops with the same key play one shared source (RIFT GATE pairs: one LFO phase). */
  sync: string | null;
  node: {
    src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; panner: PannerNode;
    last: { gain: number; rate: number; cutoff: number; x: number; y: number; z: number };
  } | null;
  releaseAt: number;
}

export interface GameAudioOptions {
  /** Render into this context instead of creating a realtime AudioContext (e.g. an OfflineAudioContext for tests). */
  context?: BaseAudioContext;
  /** 'equalpower' (default, cheapest) or 'HRTF' (better on headphones). */
  panning?: PanningModelType;
  /** Tests: skip the AudioWorklet limiter and use the fallback chain. */
  noWorklet?: boolean;
  /** M5 (clips): reuse this director's synthesised banks instead of building new ones. */
  share?: GameAudio;
}

/** NaN-safe (NaN → a): values headed for AudioParams must never be non-finite (a write throws). */
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x >= a ? x : a);
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const attenuation = (d: number, ref = REF_DIST): number => ref / (ref + ROLLOFF * (Math.max(d, ref) - ref));
/** Pyro far-field compensation: 1 inside 3 m, then (d / 3)^0.85, capped at 8 (+18 dB, reached at ~34 m): a Kiloton reads big from the Arena camera. */
const farComp = (d: number): number => clamp(Math.pow(Math.max(d, 3) / 3, 0.85), 1, 8);
/** M5: air (percent) → vacuum amount (1 at 0 %, 0 from 20 % up). */
const vacuumOf = (air: number): number => clamp(1 - fin(air, 100) / 20, 0, 1);
/** M5: the vacuum far field: an extra (4 m / d) beyond 4 m, so a blast across the Moon is a faint thump, not a boom. */
const vacFar = (d: number, vac: number): number => (vac > 0 && d > 4 ? 1 - vac + vac * (4 / d) : 1);
/** The ambience bus's reverb send (M3 level). */
const AMB_SEND = 0.25;
/** M5: voice families that are contact sounds (the impact bus). */
const IMPACTISH: ReadonlySet<Family> = new Set<Family>(['impact', 'step', 'roll']);

export class GameAudio {
  private ctx: BaseAudioContext | null = null;
  private readonly injected: BaseAudioContext | undefined;
  private readonly noWorklet: boolean;
  private panning: PanningModelType;
  private sfx: SfxBank | null = null;
  private music: Music | null = null;
  private readonly ready: Promise<[SfxBank, MusicBank]>;

  // graph
  private masterIn!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicBus!: GainNode;
  private duck!: GainNode;
  private reverb!: ConvolverNode;
  private limIn!: GainNode;
  private fallbackIn!: AudioNode;
  private limiter: AudioWorkletNode | null = null;
  // spectacle (hitstop / slow-mo)
  private sfxTone!: BiquadFilterNode;
  private spectGain!: GainNode;
  private sfxSend!: GainNode;
  private musicTone!: BiquadFilterNode;
  private musicSpect!: GainNode;

  // state
  private vol = { master: 0.8, music: 0.6, sfx: 0.9, muted: false };
  private listener: AudioListenerPose = { pos: [0, 1.5, 4], forward: [0, 0, -1], up: [0, 1, 0] };
  private voices: Voice[] = [];
  private loops = new Map<string, LoopState>();
  private loopNodes = 0;
  private lastOfKind = new Map<string, number>();
  private tileHits: number[] = [];
  private lastCascade = -1;
  private heat = 0;
  private yields: [number, number][] = [];
  private countdownIdx = 0;
  private lastCountdown = -10;
  private mode: 'build' | 'countdown' | 'running' = 'build';
  private timer: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  // ---- M2 ----
  private readonly host: AudioHost;
  private readonly mech: Mechanisms;
  private readonly crit: Critters;
  private amb: Ambience | null = null;
  private ambBus!: GainNode;
  private envWanted: [string, string] = ['studio', 'room'];
  /** Beta (D127): the world's zero-g zones are on (`env.zones`): the Hangar's ring drones sound. */
  private zonesWanted = true;
  private mochiWanted = true;
  private paused = false;
  private speed = 1;
  private runTick = 0;
  private frameDt = 1 / 60;
  /** False for a frame after the playhead jumps (scrub): state-edge one-shots are skipped then. */
  private edges = true;
  /** Slow-motion pitch drop (AUDIO §1: pitch drops at slow-mo via playbackRate, configurable). */
  slowmoPitch = true;
  /** Errors caught at the public boundary (logged once per method). */
  private readonly faults = new Set<string>();
  /** The listener jumped (camera cut) this frame: loops hold their doppler at 1. */
  private listenerJumped = false;
  // ---- M4 ----
  private readonly m4: M4Parts;
  private readonly matter: MatterAudio;
  private matterBus: GainNode | null = null;
  private matterView: (() => MatterViewLike | null | undefined) | null = null;
  private probe: MatterProbe | null = null;
  private probeAt = -1;
  // ---- M5 ----
  private readonly m5: M5Parts;
  private readonly buzz: Buzz;
  // ---- M3 ----
  private readonly m3: Gadgets;
  private readonly pyro: Pyro;
  /** Playhead-rate history for inferred slow-mo: [ctx time, tick]. */
  private rateHist: [number, number][] = [];
  private runStartedAt = 0;
  /** Time scale inferred from the playhead (≤ 1 while it advances slower than real time), smoothed. */
  private inferredScale = 1;
  private slowUntil = -1;
  private slowScale = 1;
  private hitUntil = -1;
  private hitDepth = 0;
  /** Gain on every pyro-stack voice (pyro.ts): set so the loudest Kiloton just reaches the limiter's ceiling. */
  pyroMakeup = PYRO_MAKEUP;
  /** Optional sink for every limiter report (tests, perf overlay). */
  onLimiterStats: ((s: LimiterStats) => void) | null = null;
  /** Diagnostics for the test page / perf overlay. */
  readonly stats = {
    voices: 0, loops: 0, stolen: 0, culled: 0, merged: 0, boomsMerged: 0, buildMs: 0, scrubSkipped: 0, ambience: 0, faults: 0,
    // M3
    limiter: 'none' as 'none' | 'worklet' | 'fallback', limiterGrDb: 0, limiterMaxGrDb: 0, limiterTpOut: 0, timeScale: 1, pyroLeads: 0, megas: 0,
    // M4: Matter streams sounding (voices), the granular engine, probe results and its readback latency (ms), CPU per frame (ms)
    matter: 0, matterMode: 'off' as 'off' | 'worklet' | 'loops', matterLevel: 0, probes: 0, probeMs: 0, probeStride: 1, frameMs: 0,
    // M5: the air-0 % treatment (0 normal .. 1 vacuum), M5 part cues, BUZZ cues
    vacuum: 0, m5Cues: 0, buzzCues: 0,
    // beta (D127), a clip's director: frames settled, Matter posts the worklet confirmed, confirmations that timed out
    clipSettles: 0, matterAcks: 0, matterAckTimeouts: 0,
  };

  constructor(opts: GameAudioOptions = {}) {
    this.injected = opts.context;
    this.noWorklet = opts.noWorklet ?? false;
    // M4: the live game's director, for console checks (stats, voices, probe timings); test contexts stay private
    if (!opts.context) (globalThis as unknown as { __knAudio?: GameAudio }).__knAudio = this;
    this.panning = opts.panning ?? 'equalpower';
    this.host = {
      play: (name, var01, o) => this.play(name, var01, o) !== null,
      loop: (id, kind, pos, level, o) => this.loopEx(id, kind, pos, level, o),
      now: () => this.ctx?.currentTime ?? 0,
      tick: () => Math.floor(this.runTick),
      listener: () => this.listener.pos,
      heat: (x) => { this.heat += x; },
    };
    this.mech = new Mechanisms(this.host);
    this.crit = new Critters(this.host);
    this.m3 = new Gadgets(this.host);
    this.m4 = new M4Parts(this.host);
    this.m5 = new M5Parts(this.host, (when, s) => this.silence(when, s));
    this.buzz = new Buzz(this.host, () => this.crit.names());
    this.matter = new MatterAudio({ loop: this.host.loop, listener: this.host.listener, panning: () => this.panning });
    this.pyro = new Pyro({
      // pyro make-up: the merged chain is quieter than the sum of its parts, so it gets its headroom back here
      play: (name, var01, o) => this.play(name, var01, { ...o, gain: o.gain * this.pyroMakeup, farComp: true }) !== null,
      loop: this.host.loop, now: this.host.now, listener: this.host.listener,
      duckMusic: (when) => this.duckMusic(when),
      heat: (x, y) => {
        this.heat += x;
        const now = this.ctx?.currentTime ?? 0;
        this.yields.push([now, y]);
        if (this.music && (y >= 1.5 || this.pyro.rate(0.5) >= 5)) this.music.hit(now);
      },
      mega: (when) => { if (this.music) { this.music.mega(when); this.music.whoa(when); } },
    });
    // Synthesis needs no AudioContext, so start immediately; it's usually done before the first click.
    // M5: a clip's offline director shares the live banks (AudioBuffers aren't tied to a context).
    this.ready = opts.share ? opts.share.ready : (async () => {
      const t0 = performance.now();
      const s = await buildSfxBank([...mechRecipes(), ...critterRecipes(), ...ambienceRecipes(), ...m3Recipes(), ...pyroRecipes(), ...m4Recipes(), ...matterRecipes(), ...m5Recipes(), ...buzzRecipes(), ...M5_EXTRA.flatMap((x) => x.recipes())]); // M5_EXTRA: GOO VAT (X5)
      const m = await buildMusicBank();
      this.stats.buildMs = Math.round(performance.now() - t0);
      return [s, m] as [SfxBank, MusicBank];
    })();
  }

  /** Must be called from a user gesture (first click/key) to unlock the AudioContext. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = this.injected ?? new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.buildGraph(this.ctx);
    }
    const ctx = this.ctx;
    // resume() must be called synchronously inside the gesture, before any await
    const resumed = ctx instanceof AudioContext && ctx.state !== 'running' && !this.vol.muted ? ctx.resume() : Promise.resolve();
    const lim = this.noWorklet ? Promise.resolve(false) : loadLimiter(ctx);
    const mat = this.noWorklet ? Promise.resolve(false) : loadMatterWorklet(ctx);
    const [sfx, mus] = await this.ready;
    await resumed;
    if (await lim) this.installLimiter(ctx);
    else if (this.stats.limiter === 'none') this.stats.limiter = 'fallback';
    // M4: the granular Matter engine (falls back to looped beds without AudioWorklet)
    if (this.matter.mode === 'off' && this.matterBus) { this.matter.start(ctx, this.matterBus, await mat, tablesOnce()); this.stats.matterMode = this.matter.mode; }
    if (!this.sfx) {
      this.sfx = sfx;
      this.reverb.buffer = sfx.reverb;
      this.music = new Music(ctx, this.musicBus, mus);
      this.music.start(ctx.currentTime);
      this.music.setMode(this.mode, ctx.currentTime);
      this.amb = new Ambience(ctx, this.ambBus, (k) => sfx.get(k), () => this.panning, (env) => { this.reverb.buffer = sfx.irs[env] ?? sfx.reverb; });
      this.amb.setBase(Ambience.busGain(this.vol.sfx));
      this.amb.setMochi(this.mochiWanted);
      this.amb.setZones(this.zonesWanted); // beta (D127)
      this.amb.setEnvironment(this.envWanted[0], this.envWanted[1]);
      // keep the music scheduler fed even when rAF is throttled
      if (!this.injected) this.timer = setInterval(() => this.guard('music', () => { if (this.ctx && this.music) this.music.update(this.ctx.currentTime); }), 100);
    }
  }

  private installLimiter(ctx: BaseAudioContext): void {
    if (this.limiter) return;
    try {
      const node = createLimiter(ctx, (s) => {
        this.stats.limiterGrDb = s.gr;
        this.stats.limiterTpOut = s.tpOut;
        if (s.gr > this.stats.limiterMaxGrDb) this.stats.limiterMaxGrDb = s.gr;
        this.onLimiterStats?.(s);
      });
      this.limIn.disconnect();
      this.limIn.connect(node).connect(ctx.destination);
      this.limiter = node;
      this.stats.limiter = 'worklet';
    } catch (err) {
      console.warn('[audio] limiter worklet failed to start, keeping the fallback', err);
      try { this.limIn.disconnect(); } catch { /* not connected */ }
      this.limIn.connect(this.fallbackIn);
      this.stats.limiter = 'fallback';
    }
  }

  /** Switch the panner model for voices created from now on. */
  setPanning(model: PanningModelType): void { this.panning = model; }

  setListener(p: AudioListenerPose): void { this.tap?.setListener(p); this.guard('setListener', () => this.setListenerImpl(p)); }
  private setListenerImpl(p: AudioListenerPose): void {
    if (!finite3(p.pos) || !finite3(p.forward) || !finite3(p.up)) return;
    const o = this.listener.pos;
    if (Math.hypot(p.pos[0] - o[0], p.pos[1] - o[1], p.pos[2] - o[2]) > TELEPORT_M) this.listenerJumped = true;
    this.listener = { pos: [...p.pos], forward: [...p.forward], up: [...p.up] };
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.pos[0]; l.positionY.value = p.pos[1]; l.positionZ.value = p.pos[2];
      l.forwardX.value = p.forward[0]; l.forwardY.value = p.forward[1]; l.forwardZ.value = p.forward[2];
      l.upX.value = p.up[0]; l.upY.value = p.up[1]; l.upZ.value = p.up[2];
    } else {
      l.setPosition(p.pos[0], p.pos[1], p.pos[2]);
      l.setOrientation(p.forward[0], p.forward[1], p.forward[2], p.up[0], p.up[1], p.up[2]);
    }
  }

  onSimEvents(events: readonly SimEventLike[], partType: (id: number) => string | undefined): void { if (this.tap) { this.tap.onSimEvents(events, partType); return; } this.guard('onSimEvents', () => this.onSimEventsImpl(events, partType)); }
  private onSimEventsImpl(events: readonly SimEventLike[], partType: (id: number) => string | undefined): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !events.length) return;
    let minTick = Infinity, maxTick = -Infinity;
    for (const e of events) { if (e.tick < minTick) minTick = e.tick; if (e.tick > maxTick) maxTick = e.tick; }
    // a forward scrub hands over everything it jumped across: keep only the tail so a jump isn't a wall of noise
    if (maxTick - minTick > SCRUB_KEEP_TICKS) minTick = maxTick - SCRUB_KEEP_TICKS;
    // (beta, D127: a clip's offline context is suspended on the frame, so its events land exactly there, not 10 ms on)
    const base = ctx.currentTime + (this.clipSync ? 0 : 0.01);
    for (const e of events) {
      if (e.tick < minTick) { this.stats.scrubSkipped++; continue; }
      if (!finite3(e.pos)) continue;
      // keep the relative timing of events inside one batch (one frame can hold several sim ticks)
      const when = base + clamp((e.tick - minTick) / TICK_RATE, 0, 0.05);
      const type = partType(e.part);
      const var01 = hash01(e.part, e.tick, hashStr(e.kind));
      // critters first, then the M3 parts, then the M2 parts; unknown kinds fall through silently
      // M5: BUZZ, then the M5 parts (before pyro: the SINGULARITY's collapse may arrive as a Detonate)
      if (this.buzz.event(e, type, when)) continue;
      if (this.crit.event(e, type, when, (box, pos) => this.mech.trapped(box, pos, when, var01))) continue;
      if (this.m5.event(e, type, when, var01, partType)) continue;
      // M4: HENNY lays YOLKs (a yolk Spawn near her): the plop, then her egg song
      if ((e.kind === 'Spawn' || e.kind === 'Lay') && canonM4(type) === 'yolk') { this.m4.event(e, type, when, var01); this.crit.laid(e.other, e.pos, when); continue; }
      if (this.m4.event(e, type, when, var01)) continue;
      if (e.kind === 'Detonate' && canonType(type) !== 'skyshow' && canonType(type) !== 'popper') {
        this.pyro.detonate(e, type, when, var01, debrisFor(type, profile(type).debris));
        continue;
      }
      if (this.m3.event(e, type, when, var01, partType)) continue;
      if (this.mech.event(e, type, when, var01)) continue;
      switch (e.kind) {
        case 'Impact': this.impact(e, type, when, var01); break;
        case 'Signal':
          this.play('relay', var01, { family: 'mech', pos: e.pos, when, gain: 0.45, rate: 0.85 + 0.35 * hash01(hashStr(type ?? '?')) });
          this.heat += 0.02;
          break;
        case 'Powered':
          this.play('clunk', var01, { family: 'mech', pos: e.pos, when, gain: 0.5 });
          if (type === 'motor' || type === 'gale') this.play('spinup', 0, { family: 'mech', pos: e.pos, when, gain: 0.45 });
          break;
        case 'Unpowered':
          this.play('clunk', var01, { family: 'mech', pos: e.pos, when, gain: 0.4, rate: 0.9 });
          if (type === 'motor' || type === 'gale') this.play('spindown', 0, { family: 'mech', pos: e.pos, when, gain: 0.45 });
          break;
        case 'Ignite':
          if (type === 'wick') this.play('whoomph', var01, { family: 'fx', pos: e.pos, when, gain: 0.7 });
          else this.play('fuseIgnite', var01, { family: 'fx', pos: e.pos, when, gain: 0.7 });
          this.heat += 0.05;
          break;
        case 'Extinguish': this.play('puff', var01, { family: 'fx', pos: e.pos, when, gain: 0.6 }); break;
        case 'FuseLit': this.play('fuseIgnite', var01, { family: 'fx', pos: e.pos, when, gain: 0.55, rate: 1.1 }); break;
        case 'FuseEnd': this.play('fuseEnd', var01, { family: 'fx', pos: e.pos, when, gain: 0.55 }); break;
        case 'Pop':
          this.play('pop', var01, { family: 'fx', pos: e.pos, when, gain: 1, prio: 2 });
          this.heat += 0.1;
          break;
        case 'Cut':
          this.play('snap', var01, { family: 'fx', pos: e.pos, when, gain: 0.8 });
          this.heat += 0.05;
          break;
        case 'Press':
          if (type === 'stomp_pad') this.play('pad', var01, { family: 'mech', pos: e.pos, when, gain: 0.7 });
          else this.play('button', var01, { family: 'mech', pos: e.pos, when, gain: 0.8 });
          break;
        default:
      }
    }
  }

  loop(id: string, kind: LoopKind, pos: readonly [number, number, number], level: number, partType?: string): void { if (this.tap) { this.tap.loop(id, kind, pos, level, partType); return; } this.guard('loop', () => this.loopImpl(id, kind, pos, level, partType)); }
  private loopImpl(id: string, kind: LoopKind, pos: readonly [number, number, number], level: number, partType: string | undefined): void {
    this.loopEx(id, kind, pos, level, kind === 'roll' ? { variant: `roll/${ROLL_VARIANT[partType ?? ''] ?? 'heavy'}` } : undefined);
  }

  private loopEx(id: string, kind: LoopKind, pos: Vec3, level: number, o?: LoopOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !finite3(pos)) return;
    const now = ctx.currentTime;
    let L = this.loops.get(id);
    if (!L) {
      L = {
        id, kind, variant: o?.variant ?? kind, pos: [pos[0], pos[1], pos[2]], level: 0, aux: 1, seen: now, fam: LOOP_FAMILY[kind] ?? 'mech',
        motion: o?.doppler ? new Motion(pos) : null, doppler: 1, node: null, releaseAt: -1, ref: clamp(fin(o?.ref ?? REF_DIST, REF_DIST), 0.1, 50),
        sync: typeof o?.sync === 'string' && o.sync ? o.sync : null,
      };
      this.loops.set(id, L);
    }
    if (L.motion) {
      L.motion.update(pos, Math.max(0, now - L.seen));
      const l = this.listener.pos, dx = l[0] - pos[0], dy = l[1] - pos[1], dz = l[2] - pos[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      const vr = (L.motion.vel[0] * dx + L.motion.vel[1] * dy + L.motion.vel[2] * dz) / d; // + = approaching
      // a camera cut moves the listener metres in one frame: that's not motion, so no shift this frame
      L.doppler = this.listenerJumped ? 1 : clamp(DOPPLER_C / (DOPPLER_C - clamp(vr, -60, 60)), 0.6, 1.6);
    }
    L.pos[0] = pos[0]; L.pos[1] = pos[1]; L.pos[2] = pos[2];
    L.level = clamp(level, 0, 2);
    L.aux = clamp(fin(o?.aux ?? 1, 1), 0, 2);
    L.seen = now;
    if (L.node) this.applyLoop(L, now);
  }

  // ---- M2 hooks (main.ts) -----------------------------------------------------------------------

  /** Run playback state: loops fall silent while paused, slow-mo drops pitch, a playhead jump skips edge one-shots. */
  setPlayback(paused: boolean, speed: number, tick: number): void {
    // M5 (clips): a capture steps playback by tick itself: never paused, always 1x in clip time
    if (this.tap) { this.tap.setPlayback(false, 1, tick); return; }
    this.guard('setPlayback', () => this.setPlaybackImpl(paused, speed, tick));
  }
  private setPlaybackImpl(paused: boolean, speed: number, tick: number): void {
    speed = clamp(fin(speed, 1), 0.01, 16);
    tick = fin(tick, this.runTick);
    const step = this.frameDt * TICK_RATE * this.speed;
    const expected = this.runTick + (this.paused ? 0 : step);
    this.edges = Math.abs(tick - expected) < Math.max(30, step * 3);
    this.paused = paused;
    this.speed = speed;
    this.runTick = tick;
    // M3: infer the playhead's real rate (G3 may slow it locally for slow-mo, wall clock only)
    const now = this.ctx?.currentTime ?? 0;
    if (paused || !this.edges || this.mode !== 'running' || now - this.runStartedAt < 1) { this.rateHist = []; this.inferredScale = 1; return; }
    this.rateHist.push([now, tick]);
    while (this.rateHist.length > 2 && now - this.rateHist[0]![0] > 0.3) this.rateHist.shift();
    const a = this.rateHist[0]!, span = now - a[0];
    if (span < 0.2) return;
    // every frame in the window must have advanced: a stall (bake wait, hitstop) is not slow motion
    let moving = true;
    for (let i = 1; i < this.rateHist.length; i++) if (this.rateHist[i]![1] <= this.rateHist[i - 1]![1]) { moving = false; break; }
    const eff = (tick - a[1]) / (span * TICK_RATE);
    const target = moving && eff > 0.05 && eff < 0.9 * speed ? clamp(eff, 0.05, 1) : 1;
    this.inferredScale += (target - this.inferredScale) * 0.2;
  }

  /**
   * The room (AUDIO §9): 'studio' | 'kitchen' | 'tinker' (others fall back to the Studio's tone), and the world preset.
   * Beta (D127): `zones` is the world's `env.zones` (undefined or true = on): the Hangar's zero-g ring drones follow it.
   */
  setEnvironment(env: string, preset: string, air?: number, zones?: boolean): void { this.tap?.setEnvironment(env, preset, air, zones); this.guard('setEnvironment', () => this.setEnvironmentImpl(env, preset, air, zones)); }
  private setEnvironmentImpl(env: string, preset: string, air?: number, zones?: boolean): void {
    this.envWanted = [env, preset];
    this.zonesWanted = zones !== false;
    this.amb?.setZones(this.zonesWanted);
    this.amb?.setEnvironment(env, preset);
    this.m3.setEnvironment(env);
    // M5: the world's air (percent; MOON BASE defaults to 0 %). Without air there is no airborne sound
    if (air !== undefined && Number.isFinite(air)) {
      this.airWanted = clamp(air, 0, 300);
      const v = vacuumOf(this.airWanted);
      if (Math.abs(v - this.vac) > 1e-3 || !this.airApplied) { this.vac = v; this.applyAir(); }
    }
  }

  // ---- M5: air 0 % (environments.md §6.7, AUDIO §9) ----------------------------------------------
  // "Listening through a suit radio": impacts become low-passed (800 Hz) structure-borne thumps with a little
  // extra weight, everything else on the sfx bus is darkened (1.6 kHz), the reverb sends close (vacuum: no
  // room), and the far field drops away faster (sound only reaches you through what you're standing on). The
  // amount follows the air setting: 0 % is full vacuum, 20 % and up is normal, in between it cross-fades.

  private hush: GainNode | null = null;
  /** M5: everything (sfx, music, ambience, UI) drops to silence at `when` for `s` seconds, then snaps back. */
  private silence(when: number, s: number): void {
    const ctx = this.ctx, p = this.hush?.gain;
    if (!ctx || !p || !Number.isFinite(when) || !Number.isFinite(s)) return;
    const t = Math.max(fin(when, 0), ctx.currentTime), dur = clamp(s, 0, 1);
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0, t, 0.003);
    p.setTargetAtTime(1, t + dur, 0.004);
  }

  private airWanted = 100;
  /** 0 = normal air, 1 = vacuum. */
  private vac = 0;
  private airApplied = false;
  private impBus: GainNode | null = null;
  private impTone: BiquadFilterNode | null = null;
  private impShelf: BiquadFilterNode | null = null;
  private airTone: BiquadFilterNode | null = null;
  private ambSend: GainNode | null = null;
  /** The sfx reverb send's resting level (no send in vacuum). */
  private sendBase(): number { return SFX_SEND * (1 - this.vac); }

  private applyAir(): void {
    const ctx = this.ctx;
    if (!ctx || !this.impTone || !this.impShelf || !this.airTone || !this.ambSend) return;
    this.airApplied = true;
    const now = ctx.currentTime, v = this.vac, tau = 0.25;
    // exponential sweeps between 20 kHz and the vacuum corners
    this.impTone.frequency.setTargetAtTime(clamp(20000 * Math.pow(800 / 20000, v), 20, 20000), now, tau);
    this.impShelf.gain.setTargetAtTime(clamp(5 * v, 0, 12), now, tau);
    this.airTone.frequency.setTargetAtTime(clamp(20000 * Math.pow(1600 / 20000, v), 20, 20000), now, tau);
    this.sfxSend.gain.setTargetAtTime(this.sendBase(), now, tau);
    this.ambSend.gain.setTargetAtTime(AMB_SEND * (1 - v), now, tau);
    this.stats.vacuum = v;
  }

  /** Tinker Lab: the ambient MOCHI (and its purr) hides while the world holds a MOCHI part (environments.md §3.3). */
  setAmbientMochi(visible: boolean): void { this.tap?.setAmbientMochi(visible); this.guard('setAmbientMochi', () => { this.mochiWanted = visible; this.amb?.setMochi(visible); }); }

  /** World key for Tonebars and Ding (AUDIO §8; default C major). `root` is a pitch class (0 = C). */
  setWorldKey(root: number, scale: 'major' | 'minor' | 'pentatonic' = 'major'): void {
    this.tap?.setWorldKey(root, scale);
    this.guard('setWorldKey', () => { this.m3.key = { root: ((Math.round(fin(root, 0)) % 12) + 12) % 12, scale: SCALES[scale] ?? SCALES.major! }; });
  }

  // ---- M5: sound for captured clips (clip.ts) ----------------------------------------------------

  /** While a clip renders, the world hooks go to its offline director (clip.ts); null = the live mix. */
  private tap: GameAudio | null = null;
  private lastPaths: readonly AudioPath[] = [];

  /** A sound track for one offline clip (capture/offline.ts ClipAudioTrack). */
  clip(): ClipAudio {
    return new ClipAudio({
      makeOffline: (ctx) => this.makeOffline(ctx),
      setTap: (g) => { this.tap = g; },
    });
  }

  /** An offline director on `ctx`: the live banks, volumes (unmuted, default master), room, air, mode, paths, key, listener. */
  private async makeOffline(ctx: OfflineAudioContext): Promise<GameAudio> {
    const g = new GameAudio({ context: ctx, share: this, panning: this.panning });
    g.clipSync = true; // beta (D127): Matter on the frame clock (clipSettle)
    g.matter.sync = true;
    g.slowmoPitch = this.slowmoPitch;
    g.pyroMakeup = this.pyroMakeup;
    g.setVolumes({ master: 0.8, music: this.vol.music, sfx: this.vol.sfx, muted: false });
    g.setCritterNames(...this.crit.names());
    g.setMatterView(this.matterView);
    await g.unlock();
    g.setEnvironment(this.envWanted[0], this.envWanted[1], this.airWanted, this.zonesWanted);
    g.setAmbientMochi(this.mochiWanted);
    g.m3.key = this.m3.key;
    g.setMode(this.mode);
    if (this.lastPaths.length) g.setPaths(this.lastPaths);
    if (this.lastProps.length) g.setPartProps(this.lastProps); // beta (D127)
    g.setListener(this.listener);
    return g;
  }

  /** Gutter, tube and glidepath paths in metres, for the rolling layer (call when a run starts). */
  setPaths(paths: readonly AudioPath[]): void { this.tap?.setPaths(paths); this.guard('setPaths', () => { this.lastPaths = paths; this.mech.setPaths(paths); this.m3.setPaths(paths); }); }

  // ---- beta polish (D127) -------------------------------------------------------------------------

  private lastProps: readonly PartProps[] = [];
  /**
   * The static props of the parts whose sound depends on them (AUDIO_PROP_TYPES: GRAV WELL's Mode, FORCE WALL's width
   * and height, RIFT GATE's pair colour), as main.ts reads them from the document. Call when a run starts (props
   * can't change during a run). A clip's director gets the same list.
   */
  setPartProps(parts: readonly PartProps[]): void {
    this.tap?.setPartProps(parts);
    this.guard('setPartProps', () => { this.lastProps = Array.isArray(parts) ? parts.slice() : []; this.m5.setProps(this.lastProps); });
  }

  /** This director renders a clip (clip.ts): the Matter field is probed every frame and applied on its own frame. */
  private clipSync = false;
  /** The readback of this frame's Matter probe (clip mode). */
  private probeWait: Promise<void> | null = null;

  /**
   * Clip mode, after frame i's hooks ran (ClipAudio.advance, the offline context suspended at i / fps): wait for the
   * Matter probe this frame requested, apply it at this frame's time, post it to the granular worklet and wait for
   * the worklet to take it. Matter in clips is then a function of the frames, like every other sound (it used to land
   * 2–3 frames late: the live game's 30 Hz probe, its async readback and the worklet's async message port).
   */
  async clipSettle(): Promise<void> {
    if (!this.clipSync || !this.ctx) return;
    const w = this.probeWait;
    this.probeWait = null;
    if (w) await Promise.race([w, new Promise<void>((r) => setTimeout(r, 2000))]);
    this.guard('clipSettle', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const f = this.probe?.poll();
      if (f) this.matter.setField(f, now);
      if (this.probe) { this.stats.probes = this.probe.stats.results; this.stats.probeMs = this.probe.stats.lastMs; this.stats.probeStride = this.probe.stats.stride; }
      this.matter.update(now, this.frameDt, this.mode === 'running' && !this.paused, this.pitchScale());
      this.stats.matter = this.matter.active;
      this.stats.matterLevel = this.matter.level;
    });
    await this.matter.synced();
    this.stats.clipSettles++;
    this.stats.matterAcks = this.matter.stats.acks;
    this.stats.matterAckTimeouts = this.matter.stats.ackTimeouts;
  }

  // ---- M3 spectacle hooks (G3: wall clock only, never sim ticks) --------------------------------

  /**
   * A hitstop of `ms` (GAME_SPEC §13: 60–100 ms) at a big hit, `strength` 0..1 (the comfort setting). The boom
   * that caused it keeps ringing but its pitch sags; the rest of the sfx dips and darkens, the music ducks, and
   * everything springs back over ~150 ms.
   */
  hitstop(ms: number, strength = 1): void { if (this.tap) { this.tap.hitstop(ms, strength); return; } this.guard('hitstop', () => this.hitstopImpl(ms, strength)); }
  private hitstopImpl(ms: number, strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const s = clamp(fin(strength, 1), 0, 1), dur = clamp(fin(ms, 80), 0, 250) / 1000;
    if (s <= 0 || dur <= 0) return;
    const now = ctx.currentTime;
    this.hitUntil = now + dur; this.hitDepth = s;
    const end = now + dur;
    this.ramp(this.sfxTone.frequency, now, clamp(20000 - 18200 * s, 1200, 20000), 0.012, end, 20000, 0.07);
    this.ramp(this.spectGain.gain, now, Math.pow(10, -4.5 * s / 20), 0.01, end, 1, 0.06);
    this.ramp(this.musicSpect.gain, now, Math.pow(10, -8 * s / 20), 0.015, end + 0.1, 1, 0.15);
    // the boom itself: pitch sags across the freeze and recovers (a tape-stop feel), wall clock only
    for (const v of this.voices) {
      if (v.dead || (v.family !== 'pyro' && v.family !== 'tail' && v.family !== 'fx') || now - v.start > 0.4 || v.start > now + 0.06) continue;
      const p = v.src.playbackRate, r = clamp(v.rate, 0.05, 8);
      p.cancelScheduledValues(now);
      p.setValueAtTime(r, now);
      p.linearRampToValueAtTime(clamp(r * (1 - 0.2 * s), 0.05, 8), now + dur * 0.6);
      p.linearRampToValueAtTime(r, end + 0.12);
      v.end += dur * 0.15;
    }
  }

  /** Auto slow-mo (GAME_SPEC §13: 0.25× for 0.8 s): the playhead runs at `scale` for `seconds` of wall time. */
  slowmo(scale: number, seconds: number): void { if (this.tap) { this.tap.slowmo(scale, seconds); return; } this.guard('slowmo', () => this.slowmoImpl(scale, seconds)); }
  private slowmoImpl(scale: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const sc = clamp(fin(scale, 1), 0.05, 1), sec = clamp(fin(seconds, 0), 0, 10);
    if (sc >= 0.99 || sec <= 0) return;
    const now = ctx.currentTime, end = now + sec;
    this.slowUntil = end; this.slowScale = sc;
    const deep = 1 - sc; // 0.75 at 0.25×
    // darker, wetter sfx (time-stretched tails smear into the room), music pulled back and muffled
    this.ramp(this.sfxTone.frequency, now, clamp(20000 - 17000 * deep, 2500, 20000), 0.08, end, 20000, 0.25);
    this.ramp(this.sfxSend.gain, now, this.sendBase() * (1 + 1.4 * deep), 0.1, end, this.sendBase(), 0.4);
    this.ramp(this.musicTone.frequency, now, clamp(20000 - 19000 * deep, 900, 20000), 0.12, end, 20000, 0.3);
    this.ramp(this.musicSpect.gain, now, Math.pow(10, -5 * deep / 20), 0.1, end, 1, 0.3);
    // the "time snap" back: a reverse swell that lands on the end of the slow-mo
    if (sec >= 0.6) this.play('spect/return', 0, { family: 'ui', pos: null, when: end - 0.5, gain: 0.35 * deep, rate: 1 });
  }

  /** Param to `v1` now (tau1), then back to `v2` at `t2` (tau2). Guarded like every other param write. */
  private ramp(p: AudioParam, t1: number, v1: number, tau1: number, t2: number, v2: number, tau2: number): void {
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return;
    p.cancelScheduledValues(t1);
    p.setTargetAtTime(clamp(fin(v1, v2), p.minValue, p.maxValue), t1, tau1);
    p.setTargetAtTime(clamp(fin(v2, 1), p.minValue, p.maxValue), Math.max(t2, t1 + 0.001), tau2);
  }

  /** Nothing in the audio path may throw into the caller's frame loop: catch, count, log once per entry point. */
  private guard(where: string, fn: () => void): void {
    try { fn(); } catch (err) {
      this.stats.faults++;
      if (!this.faults.has(where)) { this.faults.add(where); console.error(`[audio] ${where} failed (further errors here are counted in stats.faults)`, err); }
    }
  }

  /** Override the critter clip/emote name tables (tests; normally read from parts-data CRITTER_CLIPS / CRITTER_EMOTES). */
  setCritterNames(clips: Parameters<Critters['setNames']>[0], emotes: Parameters<Critters['setNames']>[1]): void { this.crit.setNames(clips, emotes); }

  /** True for part types voiced by critters.ts. */
  isCritter(type: string): boolean { return CRITTER_TYPES.has(type); }

  /**
   * Per running part per frame: M2/M3 state loops from flags, meter and spin; critters get their 4 contract-3 bytes
   * (null until run.critters exists). `rot` is the rotation of the part's moving body (for ω), if any; `arm` its
   * position (M3: lift deck, ram rod, rack).
   */
  part(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: readonly [number, number, number, number] | null, critter: ArrayLike<number> | null = null, arm: Vec3 | null = null): void {
    if (this.tap) { this.tap.part(id, type, pos, flags, meter, rot, critter, arm); return; }
    this.guard('part', () => this.partImpl(id, type, pos, flags, meter, rot, critter, arm));
  }
  private partImpl(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: readonly [number, number, number, number] | null, critter: ArrayLike<number> | null, arm: Vec3 | null): void {
    if (!this.ctx || !this.sfx || this.mode !== 'running') return;
    const dt = this.paused ? 0 : this.frameDt;
    if (type === 'buzz') { this.buzz.update(id, pos, critter, meter, dt, this.edges, this.paused); return; } // M5
    if (CRITTER_TYPES.has(type)) { this.crit.update(id, type, pos, critter, dt, this.edges, this.paused, meter); return; }
    if (isM5(type)) { this.m5.part(id, type, pos, flags, meter, rot, arm, dt, this.edges && !this.paused); return; } // M5
    this.m3.observe(id, type, pos);
    if (isM4(type)) { this.m4.part(id, type, pos, flags, meter, rot, dt, this.edges && !this.paused); return; }
    // only types with per-frame state pay for it: 100k Topple Tiles cost a set lookup each
    if (MECH_PART_TYPES.has(type)) this.mech.part(id, type, pos, flags, meter, rot, dt, this.edges && !this.paused);
    else if (isM3(type)) this.m3.part(id, type, pos, flags, meter, rot, arm, dt, this.edges && !this.paused);
  }

  /** Rolling bodies: picks floor / gutter / tube / vortex / glidepath layers, and marble surfaces. */
  roller(id: string, type: string, pos: Vec3): void { if (this.tap) { this.tap.roller(id, type, pos); return; } this.guard('roller', () => this.rollerImpl(id, type, pos)); }
  private rollerImpl(id: string, type: string, pos: Vec3): void {
    if (!this.ctx || !this.sfx || this.paused) return;
    if (this.m4.roller(id, type, pos, this.frameDt)) return;
    if (this.m3.roller(id, type, pos, this.frameDt, (p) => this.mech.pathKind(p))) return;
    this.mech.roller(id, type, pos, this.frameDt, `roll/${ROLL_VARIANT[type] ?? 'heavy'}`);
  }

  /** Audition any bank cue by name (test page). */
  cue(name: string, o: { pos?: Vec3 | null; rate?: number; gain?: number } = {}): void { this.guard('cue', () => this.cueImpl(name, o)); }
  private cueImpl(name: string, o: { pos?: Vec3 | null; rate?: number; gain?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p: PlayOpts = { family: o.pos ? 'fx' : 'ui', pos: o.pos ?? null, when: ctx.currentTime + 0.005, gain: o.gain ?? 0.8, prio: 5, key: `cue:${name}` };
    if (o.rate !== undefined) p.rate = o.rate;
    this.play(name, hash01(hashStr(name), Math.floor(ctx.currentTime * 10)), p);
  }

  /** Music v2 counters (test page): sections, Kiloton drops, boom accents. */
  get musicStats(): { sections: number; drops: number; hits: number } | null { return this.music?.stats ?? null; }

  /** Every cue name in the bank (test page). */
  names(): string[] { return this.sfx?.keys() ?? []; }

  ui(name: string): void { this.guard('ui', () => this.uiImpl(name)); }
  private uiImpl(name: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const now = ctx.currentTime;
    let rate = 1;
    if (name === 'countdown') {
      if (now - this.lastCountdown > 1.6) this.countdownIdx = 0;
      rate = Math.pow(2, [0, 4, 7, 12][Math.min(this.countdownIdx, 3)]! / 12);
      this.countdownIdx++;
      this.lastCountdown = now;
    } else if (name === 'go' || name === 'stop') this.countdownIdx = 0;
    this.play(`ui/${name}`, 0, { family: 'ui', pos: null, when: now + 0.005, gain: 1, rate });
  }

  setMode(mode: 'build' | 'countdown' | 'running'): void { this.tap?.setMode(mode); this.guard('setMode', () => this.setModeImpl(mode)); }
  private setModeImpl(mode: 'build' | 'countdown' | 'running'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'countdown') { this.heat = 0; this.yields = []; }
    if (mode === 'running') { this.runStartedAt = this.ctx?.currentTime ?? 0; this.stats.limiterMaxGrDb = 0; }
    if (mode === 'build') {
      // stop everything still sounding from the run (loops will also go stale); ambience carries on
      for (const L of this.loops.values()) L.seen = -1;
      this.mech.reset();
      this.crit.reset();
      this.m3.reset();
      this.m4.reset();
      this.m5.reset(); // M5
      this.buzz.reset();
      this.matter.reset();
      this.pyro.reset();
      this.paused = false; this.speed = 1; this.runTick = 0;
      this.rateHist = []; this.inferredScale = 1; this.slowUntil = -1; this.hitUntil = -1;
    }
    if (this.ctx && this.music) this.music.setMode(mode, this.ctx.currentTime);
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number; muted?: boolean }): void { this.guard('setVolumes', () => this.setVolumesImpl(v)); }
  private setVolumesImpl(v: { master?: number; music?: number; sfx?: number; muted?: boolean }): void {
    if (v.master !== undefined) this.vol.master = clamp(v.master, 0, 1);
    if (v.music !== undefined) this.vol.music = clamp(v.music, 0, 1);
    if (v.sfx !== undefined) this.vol.sfx = clamp(v.sfx, 0, 1);
    const wasMuted = this.vol.muted;
    if (v.muted !== undefined) this.vol.muted = v.muted;
    const ctx = this.ctx;
    if (!ctx) return;
    this.applyVolumes(ctx.currentTime, 0.03);
    // a muted realtime context is suspended to save CPU; resumed on unmute
    if (ctx instanceof AudioContext && wasMuted !== this.vol.muted) {
      if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      if (this.vol.muted) this.suspendTimer = setTimeout(() => { if (this.vol.muted) void ctx.suspend(); }, 200);
      else void ctx.resume();
    }
  }

  frame(dt: number): void { if (this.tap) { this.tap.frame(dt); return; } this.guard('frame', () => this.frameImpl(dt)); }
  private frameImpl(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = performance.now();
    const now = ctx.currentTime;
    this.frameDt = clamp(fin(dt, 0), 0, 0.1);
    // voices
    this.voices = this.voices.filter((v) => !v.dead && v.end > now);
    this.stats.voices = this.voices.length;
    // M3: explosion merging, the barrage bed, fallback notes and shell bursts
    this.pyro.update(this.frameDt);
    this.m3.update();
    this.m4.update();
    this.m5.update(); // M5
    this.buzz.update2(now);
    // M4: Matter field (GPU probe, read back a frame or two late) → granular streams
    this.updateMatter(now);
    const density = this.pyro.density();
    // ambience, ducked by how busy the mix is
    if (this.amb) {
      let busy = 0;
      for (const v of this.voices) if (v.family !== 'ui' && v.family !== 'amb' && v.family !== 'step') busy++;
      this.amb.update({ mode: this.mode, paused: this.paused, action: clamp(0.3 * Math.min(1, this.heat) + busy / 16 + this.loopNodes / 30 + density + 1.5 * this.matter.level, 0, 1), listener: this.listener.pos });
      this.stats.ambience = this.amb.active;
    }
    // loops
    this.stats.timeScale = this.timeScale(now);
    this.updateLoops(now);
    this.listenerJumped = false;
    // music intensity: a leaky integrator of explosion/impact density
    this.heat = fin(this.heat, 0) * Math.exp(-this.frameDt / 5);
    while (this.yields.length && now - this.yields[0]![0] > 2) this.yields.shift();
    let ysum = 0;
    for (const [, y] of this.yields) ysum += y;
    if (this.music) {
      this.music.intensity = 1 - Math.exp(-this.heat);
      this.music.density = density;
      if (ysum > 10) this.music.whoa(now);
      this.music.update(now);
    }
    while (this.tileHits.length && now - this.tileHits[0]! > 0.1) this.tileHits.shift();
    this.stats.pyroLeads = this.pyro.stats.leads;
    this.stats.boomsMerged = this.pyro.stats.merged;
    this.stats.megas = this.pyro.stats.megas;
    this.stats.m5Cues = this.m5.stats.cues; this.stats.buzzCues = this.buzz.stats.cues; // M5
    this.stats.frameMs = this.stats.frameMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  /** M4: probe the Matter field around the listener (throttled), take the newest result, drive the streams. */
  private updateMatter(now: number): void {
    const running = this.mode === 'running' && !this.paused;
    if (this.clipSync) {
      // beta (D127), clips: probe this frame's particles on every frame; clipSettle() waits for the readback and drives
      // the streams at this frame's time
      if (running && this.matterView) {
        const v = this.matterView();
        if (v && v.device && v.pos && v.vel) {
          if (!this.probe || this.probe.device !== v.device) { this.probe?.destroy(); this.probe = new MatterProbe(v.device); }
          if (this.probe.ok && this.probe.request(v, this.listener.pos)) { this.probeAt = now; this.probeWait = this.probe.pending; }
        }
      }
      return;
    }
    if (running && this.matterView && now - this.probeAt >= PROBE_EVERY) {
      const v = this.matterView();
      if (v && v.device && v.pos && v.vel) {
        if (!this.probe || this.probe.device !== v.device) { this.probe?.destroy(); this.probe = new MatterProbe(v.device); }
        if (this.probe.ok && this.probe.request(v, this.listener.pos)) this.probeAt = now;
      }
    }
    const f = this.probe?.poll();
    if (f) this.matter.setField(f, now);
    if (this.probe) { this.stats.probes = this.probe.stats.results; this.stats.probeMs = this.probe.stats.lastMs; this.stats.probeStride = this.probe.stats.stride; }
    this.matter.update(now, this.frameDt, running, this.pitchScale());
    this.stats.matter = this.matter.active;
    this.stats.matterLevel = this.matter.level;
  }

  /**
   * M4: where the Matter particles live (the backend's `view()`, GPU only). Called once; the provider is asked at most
   * 30 times a second while a run plays and may return null (no Matter, CPU backend).
   */
  setMatterView(provider: (() => MatterViewLike | null | undefined) | null): void { this.guard('setMatterView', () => { this.matterView = provider; }); }

  /** M4: feed a Matter field directly (tests, or a CPU-side reduction when the particles aren't on the GPU). */
  matterField(f: MatterField): void { if (this.tap) { this.tap.matterField(f); return; } this.guard('matterField', () => { if (this.ctx) this.matter.setField(f, this.ctx.currentTime); }); }

  /** Stop timers and close the realtime context. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.amb?.dispose();
    this.matter.dispose();
    this.probe?.destroy();
    if (this.ctx instanceof AudioContext) void this.ctx.close();
    // M5 (clips): an offline director stops feeding its destination, so the rest of its buffer renders fast
    else if (this.ctx) { try { this.limIn.disconnect(); } catch { /* not connected */ } }
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------------------------

  private buildGraph(ctx: BaseAudioContext): void {
    this.masterIn = ctx.createGain();
    // M3: a gentler glue (was −16 dB, 3:1) so the true-peak limiter, not the glue's automatic make-up, sets the ceiling
    const glue = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 10, ratio: 2.5, attack: 0.01, release: 0.3 });
    // the gentler glue applies 1.36 dB less automatic make-up than M2's (Web Audio compressor make-up = (1 / full-range
    // gain)^0.6): this trim restores the M2 levels for everything below the glue threshold
    this.limIn = new GainNode(ctx, { gain: Math.pow(10, 1.36 / 20) });
    // fallback limiter (no AudioWorklet): fast compressor, then a smooth sample-peak ceiling at −1 dBFS
    const comp = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 0, ratio: 20, attack: 0.0015, release: 0.12 });
    const pre = new GainNode(ctx, { gain: 0.5 });
    const N = 4097, curve = new Float32Array(N), c = FALLBACK_CEIL, lin = c * 0.8;
    for (let i = 0; i < N; i++) {
      const y = (i / (N - 1) * 2 - 1) * 2, a = Math.abs(y);
      curve[i] = Math.sign(y) * (a < lin ? a : lin + (c - lin) * Math.tanh((a - lin) / (c - lin)));
    }
    const clip = new WaveShaperNode(ctx, { curve });
    comp.connect(pre).connect(clip).connect(ctx.destination);
    this.fallbackIn = comp;
    // M5: the SINGULARITY's collapse holds 150 ms of true silence (hush), ahead of the glue and the limiter
    this.hush = new GainNode(ctx, { gain: 1 });
    this.masterIn.connect(this.hush).connect(glue).connect(this.limIn).connect(comp);

    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.duck = ctx.createGain();
    this.reverb = ctx.createConvolver();
    const verbReturn = new GainNode(ctx, { gain: 1 });
    this.sfxSend = new GainNode(ctx, { gain: SFX_SEND });
    const musicSend = new GainNode(ctx, { gain: 0.32 });
    this.sfxTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.spectGain = new GainNode(ctx, { gain: 1 });
    this.musicTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.musicSpect = new GainNode(ctx, { gain: 1 });
    // M5: air 0 % darkens the sfx bus (airTone) and turns impacts into structure-borne thumps (impBus)
    this.airTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.6 });
    this.impBus = new GainNode(ctx, { gain: 1 });
    this.impTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.7 });
    this.impShelf = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 160, gain: 0 });
    this.impBus.connect(this.impTone).connect(this.impShelf).connect(this.sfxBus);
    this.sfxBus.connect(this.airTone).connect(this.sfxTone).connect(this.spectGain).connect(this.masterIn);
    this.sfxBus.connect(this.sfxSend).connect(this.reverb);
    this.uiBus.connect(this.masterIn);
    this.musicBus.connect(this.duck).connect(this.musicTone).connect(this.musicSpect).connect(this.masterIn);
    this.musicBus.connect(musicSend).connect(this.reverb);
    this.reverb.connect(verbReturn).connect(this.masterIn);
    this.ambBus = new GainNode(ctx, { gain: 0 });
    this.ambBus.connect(this.masterIn);
    // M4: Matter streams join the sfx bus (spectacle, reverb send, limiter)
    this.matterBus = new GainNode(ctx, { gain: MATTER_TRIM });
    this.matterBus.connect(this.impBus ?? this.sfxBus); // M5: grains are contact sounds (the vacuum's thump treatment)
    this.ambSend = new GainNode(ctx, { gain: AMB_SEND });
    this.ambBus.connect(this.ambSend).connect(this.reverb);
    this.applyVolumes(ctx.currentTime, 0);
    this.setListener(this.listener);
    if (this.vac > 0) this.applyAir();
  }

  private applyVolumes(now: number, tau: number): void {
    const v = this.vol;
    const set = (p: AudioParam, x: number) => { x = clamp(x, 0, 4); p.cancelScheduledValues(now); if (tau > 0) p.setTargetAtTime(x, now, tau); else p.value = x; };
    set(this.masterIn.gain, v.muted ? 0 : v.master);
    set(this.musicBus.gain, v.music * v.music * MUSIC_TRIM); // perceptual (squared) taper
    set(this.sfxBus.gain, v.sfx * v.sfx * SFX_MAKEUP);
    set(this.uiBus.gain, v.sfx * v.sfx * 0.9);
    this.amb?.setBase(Ambience.busGain(v.sfx));
  }

  private pickVariant(list: readonly AudioBuffer[], key: string, var01: number): AudioBuffer {
    // hashed choice with no immediate repeat (AUDIO.md §3 round-robin)
    let i = Math.floor(var01 * list.length) % list.length;
    if (!(i >= 0)) i = 0;
    const last = this.lastOfKind.get(`v:${key}`);
    if (list.length > 1 && last === i) i = (i + 1) % list.length;
    this.lastOfKind.set(`v:${key}`, i);
    return list[i]!;
  }

  /**
   * Time scale of what's on screen (≤ 1): the run speed, the playhead rate inferred from setPlayback (G3's local
   * slow-mo), or an explicit slowmo() call, whichever is slowest.
   */
  private timeScale(now: number): number {
    if (this.mode !== 'running') return 1;
    let ts = Math.min(this.speed, this.inferredScale);
    if (now < this.slowUntil) ts = Math.min(ts, this.slowScale);
    return clamp(ts, 0.01, 1);
  }

  /** Slow-motion pitch factor: 0.1× → ~0.78, 0.5× → ~0.88, ≥ 1× → 1; a hitstop sags it a little more. */
  private pitchScale(): number {
    if (!this.slowmoPitch || this.mode !== 'running') return 1;
    const now = this.ctx?.currentTime ?? 0;
    const ts = this.timeScale(now);
    let p = ts < 1 ? 0.75 + 0.25 * ts : 1;
    if (now < this.hitUntil) p *= 1 - 0.1 * this.hitDepth;
    return p;
  }

  private play(name: string, var01: number, o: PlayOpts): Voice | null {
    const ctx = this.ctx, bank = this.sfx;
    if (!ctx || !bank) return null;
    const list = bank.get(name);
    if (!list || !list.length) return null;
    if (o.pos && !finite3(o.pos)) { this.stats.culled++; return null; }
    if (!Number.isFinite(o.gain) || !Number.isFinite(o.when)) return null;
    const maxD = o.maxDist ?? MAX_DIST;
    const d = o.pos ? dist(o.pos, this.listener.pos) : 0;
    if (d > maxD) { this.stats.culled++; return null; }
    const now = ctx.currentTime;
    const key = o.key ?? name;
    const lastT = this.lastOfKind.get(key) ?? -10;
    const novelty = o.when - lastT > 0.5 ? 1.5 : 1;
    // M5: in vacuum big blasts don't carry (no far-field compensation) and the far field falls away faster
    const vac = this.vac;
    const g0 = (o.farComp && o.pos ? o.gain * (1 + (farComp(d) - 1) * (1 - vac)) : o.gain) * (o.pos ? vacFar(d, vac) : 1);
    const prio = BASE_PRIO[o.family] * (o.prio ?? 1) * g0 * attenuation(d) * novelty;
    if (!this.admit(o.family, prio, now)) { this.stats.culled++; return null; }
    this.lastOfKind.set(key, o.when);

    const buf = this.pickVariant(list, name, fin(var01, 0));
    const rate = clamp(fin(o.rate ?? 1, 1) * (o.family === 'ui' ? 1 : this.pitchScale()), 0.05, 8);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
    const gain = new GainNode(ctx, { gain: clamp(g0, 0, 40) }); // far-compensated pyro can exceed 4 before the panner's distance loss
    let panner: PannerNode | null = null;
    src.connect(gain);
    if (o.pos) {
      panner = new PannerNode(ctx, {
        panningModel: this.panning, distanceModel: 'inverse', refDistance: REF_DIST, rolloffFactor: ROLLOFF, maxDistance: maxD,
        positionX: o.pos[0], positionY: o.pos[1], positionZ: o.pos[2],
      });
      // M5: contact sounds go through the impact bus (the vacuum's structure-borne treatment)
      gain.connect(panner).connect(IMPACTISH.has(o.family) && this.impBus ? this.impBus : this.sfxBus);
    } else gain.connect(o.family === 'ui' ? this.uiBus : this.sfxBus);
    const when = Math.max(o.when, now);
    src.start(when);
    const v: Voice = { src, gain, panner, family: o.family, prio, start: when, end: when + buf.duration / rate + 0.05, g: g0, rate, key, pos: o.pos, dead: false };
    src.onended = () => { v.dead = true; gain.disconnect(); panner?.disconnect(); };
    this.voices.push(v);
    return v;
  }

  /** Enforce family and global caps; steals the lowest-priority voice when the newcomer outranks it. */
  private admit(family: Family, prio: number, now: number): boolean {
    const eff = (v: Voice) => v.prio * Math.exp(-Math.max(0, now - v.start) / AGE_TAU[v.family]);
    let famCount = 0, famWorst: Voice | null = null, famWorstP = Infinity, worst: Voice | null = null, worstP = Infinity, live = 0;
    for (const v of this.voices) {
      if (v.dead || v.end <= now) continue;
      live++;
      const p = eff(v);
      if (p < worstP) { worstP = p; worst = v; }
      if (v.family === family) { famCount++; if (p < famWorstP) { famWorstP = p; famWorst = v; } }
    }
    if (famCount >= FAMILY_LIMIT[family]) {
      if (!famWorst || famWorstP >= prio) return false;
      this.steal(famWorst, now);
      live--;
      if (worst === famWorst) worst = null;
    }
    if (live + this.loopNodes + (this.amb?.active ?? 0) + this.matter.active >= MAX_VOICES) {
      if (!worst || worstP >= prio) return false;
      this.steal(worst, now);
    }
    return true;
  }

  private steal(v: Voice, now: number): void {
    v.dead = true;
    this.stats.stolen++;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.008);
    try { v.src.stop(now + 0.05); } catch { /* not started yet */ }
  }

  // ---- impacts ----

  private impact(e: SimEventLike, type: string | undefined, when: number, var01: number): void {
    const P = profile(type);
    const J = Math.max(0, fin(e.mag, 0));
    const tier = J < 0.5 ? 0 : J < 5 ? 1 : 2;
    const k = 1.5 / Math.sqrt(Math.max(P.mass, 0.05));
    let g = clamp(Math.log10(1 + J * k), 0.04, 1);
    if (type === 'helio') g *= 0.5;
    this.heat += 0.015 * g;
    const pos = e.pos;

    // Topple Tiles cluster mode: ≥ 8 hits in 100 ms → one cascade layer instead of many voices
    if (P.mat === 'tile') {
      const now = this.ctx!.currentTime;
      this.tileHits.push(now);
      while (this.tileHits.length && now - this.tileHits[0]! > 0.1) this.tileHits.shift();
      if (this.tileHits.length >= 8) {
        if (now - this.lastCascade > 0.12) {
          this.lastCascade = now;
          this.play('cascade', var01, { family: 'impact', pos, when, gain: clamp(0.4 + this.tileHits.length * 0.02, 0.4, 0.8), prio: 2 });
        }
        this.stats.merged++;
        return;
      }
    }

    // merge with a same-material hit that just started nearby
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]!;
      if (v.dead || v.family !== 'impact' || v.key !== P.mat || !v.pos) continue;
      if (Math.abs(when - v.start) > IMPACT_MERGE_S) continue;
      if (dist(v.pos, pos) > IMPACT_MERGE_M) continue;
      const ng = clamp(Math.hypot(v.g, g), 0, 1.2);
      v.g = ng;
      v.gain.gain.setTargetAtTime(ng, Math.max(v.start, this.ctx!.currentTime), 0.004);
      this.stats.merged++;
      return;
    }

    // pitch: ±6 % by mass (lighter = higher) and ±2 % hashed from (part, tick)
    const rate = clamp(1 - 0.03 * Math.log2(P.mass), 0.94, 1.06) * (1 + (var01 - 0.5) * 0.04);
    const tierName = (['soft', 'med', 'hard'] as const)[tier];
    if (type === 'boing' && tier > 0) this.play('boing', var01, { family: 'impact', pos, when, gain: g, rate: rate * (1.1 - 0.1 * tier), key: P.mat });
    else this.play(`imp/${P.mat}/${tierName}`, var01, { family: 'impact', pos, when, gain: g, rate, key: P.mat });
    if (P.mass >= 3 && tier > 0) this.play('thump', var01, { family: 'impact', pos, when, gain: g * (tier === 2 ? 0.8 : 0.45), rate: clamp(1.25 - P.mass / 20, 0.8, 1.2), key: 'thump' });
  }

  private duckMusic(when: number): void {
    const p = this.duck.gain;
    const t = Math.max(fin(when, 0), this.ctx!.currentTime);
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.5, t, 0.02);  // −6 dB
    p.setTargetAtTime(1, t + 1.5, 0.35);
  }

  // ---- continuous sources ----

  private loopParams(L: LoopState): { gain: number; rate: number; cutoff: number } {
    const x = L.level;
    switch (L.kind) {
      case 'fuse': return { gain: 0.5 * (0.6 + 0.4 * Math.min(x, 1)), rate: 0.95 + 0.15 * Math.min(x, 1.5), cutoff: 12000 };
      case 'motor': return { gain: 0.45 * Math.pow(Math.min(x, 1.5), 0.7), rate: 0.4 + 0.8 * Math.min(x, 1.5), cutoff: 900 + 5000 * Math.min(x, 1) };
      case 'fan': return { gain: 0.5 * Math.min(x, 1.5), rate: 0.55 + 0.6 * Math.min(x, 1.5), cutoff: 600 + 6000 * Math.min(x, 1) };
      case 'flame': return { gain: 0.6 * (0.35 + 0.65 * Math.min(x, 1.5)), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 2500 + 6000 * Math.min(x, 1) };
      case 'roll': {
        const s = Math.min(x, 1.6);
        const tube = L.variant === 'roll/tube' ? 1.2 : 1; // the tube's hollow resonance carries a little more
        return { gain: 0.8 * tube * Math.pow(Math.min(1, s * 1.5), 1.2), rate: 0.6 + 0.7 * s, cutoff: 350 + 4000 * s };
      }
      // ---- M2 mechanisms (AUDIO §5): level = ω or supply factor, aux = load ----
      case 'dynamo': return { gain: 0.45 * (0.3 + 0.7 * Math.min(L.aux, 1)), rate: 0.4 + 0.8 * Math.min(x, 1.5), cutoff: 1200 + 4000 * Math.min(L.aux, 1) };
      case 'turbine': return { gain: 0.5 * Math.min(1, x * 1.3), rate: 0.5 + 0.7 * Math.min(x, 1.5), cutoff: 700 + 5000 * Math.min(x, 1) };
      case 'filament': return { gain: 0.08, rate: 1, cutoff: 6000 };
      case 'shimmer': return { gain: 0.12 * Math.min(x, 1), rate: 1, cutoff: 12000 };
      case 'cell': return { gain: 0.1, rate: 1, cutoff: 8000 };
      case 'sizzle': return { gain: 0.35 * Math.min(x, 1.2), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 12000 };
      case 'ringer': return { gain: 0.4, rate: x, cutoff: 12000 };
      case 'delay': return { gain: 0.3, rate: 1, cutoff: 8000 };
      case 'thrust': return { gain: 0.75, rate: 1, cutoff: 9000 };
      case 'crank': return { gain: 0.35, rate: 0.5 + 0.8 * Math.min(x, 1.6), cutoff: 9000 };
      case 'bubbles': return { gain: 0.2, rate: 1, cutoff: 6000 };
      case 'wheel': return { gain: 0.35 * Math.min(1, x * 1.5), rate: 0.4 + 0.8 * Math.min(x, 1.6), cutoff: 6000 };
      case 'chain': return { gain: 0.4 * Math.min(1, x * 1.5), rate: 0.4 + 0.8 * Math.min(x, 1.6), cutoff: 8000 };
      case 'spiral': {
        const s = Math.min(L.aux, 1.2);
        return { gain: 0.75 * Math.pow(Math.min(1, s * 1.5), 1.1), rate: 0.6 + 0.8 * Math.min(x, 1.6), cutoff: 800 + 4000 * s };
      }
      // ---- M2 critters (AUDIO §7) ----
      case 'purr': return { gain: 0.45, rate: 1, cutoff: 3000 };
      case 'snore': return { gain: 0.3 * L.aux, rate: L.aux < 1 ? 1.6 : 1, cutoff: 3000 };
      case 'patter': return { gain: 0.45, rate: clamp(x, 0.6, 2), cutoff: 9000 };
      case 'pedal': return { gain: 0.4, rate: clamp(x, 0.6, 2), cutoff: 9000 };
      // ---- M3 parts (m3.ts): level = intensity / speed, aux = variant tweak ----
      case 'lance': return { gain: 0.18 * Math.min(x, 1), rate: 1, cutoff: 12000 };
      case 'burn': return { gain: 0.4 * Math.min(x, 1.2), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 14000 };
      case 'prism': return { gain: 0.1 * Math.min(x, 1), rate: 1, cutoff: 14000 };
      case 'maghum': return { gain: 0.22 * Math.min(x, 1), rate: 1, cutoff: 4000 };
      case 'marble': {
        const s = Math.min(x, 1.6);
        return { gain: 0.7 * Math.pow(Math.min(1, s * 1.4), 1.1), rate: (0.6 + 0.7 * s) * L.aux, cutoff: 2000 + 8000 * Math.min(s, 1) };
      }
      case 'rail': {
        const s = Math.min(x, 1.6);
        return { gain: 0.7 * Math.pow(Math.min(1, s * 1.4), 1.1), rate: (0.55 + 0.7 * s) * (0.7 + 0.3 * L.aux), cutoff: 1500 + 9000 * Math.min(1, s) };
      }
      case 'spindeck': return { gain: 0.4 * Math.min(1, x * 1.5), rate: 0.45 + 0.8 * Math.min(x, 1.5), cutoff: 1500 + 5000 * Math.min(x, 1) };
      case 'liftmotor': return { gain: 0.4 * Math.min(1, x * 1.5), rate: 0.6 + 0.6 * Math.min(x, 1.2), cutoff: 6000 };
      case 'ratchet': return { gain: 0.35 * Math.min(1, x * 1.5), rate: clamp(x, 0.15, 4), cutoff: 9000 };
      case 'flamer': return { gain: 0.65 * (0.4 + 0.6 * Math.min(x, 1.2)), rate: 0.9 + 0.2 * Math.min(x, 1), cutoff: 4000 + 8000 * Math.min(x, 1) };
      case 'fizz': return { gain: 0.12, rate: 1, cutoff: 12000 };
      case 'cook': return { gain: 0.35 * Math.min(x, 1), rate: 1, cutoff: 6000 };
      case 'chaincreak': return { gain: 0.4 * Math.min(1, x), rate: 0.7 + 0.5 * Math.min(x, 1.2), cutoff: 7000 };
      case 'swingair': return { gain: 0.5 * Math.min(1, x), rate: 0.7 + 0.6 * Math.min(x, 1.2), cutoff: 800 + 3000 * Math.min(x, 1) };
      case 'fabhum': return { gain: 0.12, rate: 1, cutoff: 8000 };
      case 'zone': return { gain: 0.12 * Math.min(x, 1), rate: 1, cutoff: 3000 };
      case 'barrage': return { gain: 0.75 * Math.min(x, 1.3), rate: 1, cutoff: 600 + 2000 * Math.min(x, 1) };
      // ---- M4 parts, critters and Matter fallback beds (m4.ts) ----
      // M5 parts and BUZZ (m5.ts)
      default: return (M4_LOOPS as Partial<Record<LoopKind, (x: number, aux: number) => { gain: number; rate: number; cutoff: number }>>)[L.kind]?.(x, L.aux) ?? M5_LOOPS[L.kind as M5LoopKind]?.(x, L.aux) ?? { gain: 0, rate: 1, cutoff: 8000 };
    }
  }

  private applyLoop(L: LoopState, now: number): void {
    const n = L.node!;
    const p = this.loopParams(L);
    p.gain *= 1.3; // loop trim (+2.3 dB) so loops sit near -18 dB short-term under one-shots
    if (this.vac > 0) p.gain *= vacFar(dist(L.pos, this.listener.pos), this.vac); // M5: the vacuum far field
    // AudioParam writes throw on non-finite values: clamp everything (clamp maps NaN to the lower bound)
    p.gain = clamp(p.gain, 0, 2);
    p.cutoff = clamp(p.cutoff, 20, 20000);
    // Only touch params on meaningful change: automating a biquad's frequency makes Chrome recompute its
    // coefficients every sample, and a fresh automation event per frame per loop adds up.
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-3);
    if (!near(p.gain, n.last.gain, 0.02)) { n.gain.gain.setTargetAtTime(p.gain, now, 0.05); n.last.gain = p.gain; }
    p.rate = clamp(p.rate * fin(L.doppler, 1) * this.pitchScale(), 0.05, 8);
    if (!near(p.rate, n.last.rate, 0.004)) { n.src.playbackRate.setTargetAtTime(p.rate, now, 0.04); n.last.rate = p.rate; }
    if (!near(p.cutoff, n.last.cutoff, 0.04)) { n.filter.frequency.value = p.cutoff; n.last.cutoff = p.cutoff; }
    if (finite3(L.pos) && (!near(L.pos[0], n.last.x, 0.002) || !near(L.pos[1], n.last.y, 0.002) || !near(L.pos[2], n.last.z, 0.002))) {
      n.panner.positionX.value = n.last.x = L.pos[0]; n.panner.positionY.value = n.last.y = L.pos[1]; n.panner.positionZ.value = n.last.z = L.pos[2];
    }
  }

  private startLoop(L: LoopState, now: number): void {
    const ctx = this.ctx!;
    const buf = this.sfx!.get(`loop/${L.variant}`)?.[0];
    if (!buf) return;
    let src: AudioBufferSourceNode;
    if (L.sync) {
      // beta (D127): a synced group (a RIFT GATE pair) plays ONE source into each member's filter, gain and panner, so
      // its members share one LFO phase however late each comes into range; it starts at a phase hashed from the group
      const key = `${L.sync}|${L.variant}`;
      let sh = this.shared.get(key);
      if (!sh) {
        const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
        s.start(now, hash01(hashStr(key)) * buf.duration);
        sh = { src: s, refs: 0, retired: [] };
        this.shared.set(key, sh);
      }
      sh.refs++;
      src = sh.src;
    } else src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000, Q: 0.5 });
    const gain = new GainNode(ctx, { gain: 0 });
    const panner = new PannerNode(ctx, {
      panningModel: this.panning, distanceModel: 'inverse', refDistance: L.ref, rolloffFactor: ROLLOFF, maxDistance: Math.max(MAX_DIST, L.ref * 20),
      positionX: L.pos[0], positionY: L.pos[1], positionZ: L.pos[2],
    });
    src.connect(filter).connect(gain).connect(panner).connect(L.fam === 'roll' && this.impBus ? this.impBus : this.sfxBus); // M5: rolls are contact sounds
    // random-ish start offset (hashed from id) so identical loops don't phase
    if (!L.sync) src.start(now, hash01(hashStr(L.id)) * buf.duration);
    L.node = { src, filter, gain, panner, last: { gain: -1, rate: 1, cutoff: 4000, x: L.pos[0], y: L.pos[1], z: L.pos[2] } };
    L.releaseAt = -1;
    this.loopNodes++;
    this.applyLoop(L, now);
  }

  private stopLoop(L: LoopState, now: number): void {
    const n = L.node;
    if (!n) return;
    L.node = null;
    this.loopNodes--;
    n.gain.gain.cancelScheduledValues(now);
    n.gain.gain.setTargetAtTime(0, now, 0.06);
    const sh = L.sync ? this.shared.get(`${L.sync}|${L.variant}`) : undefined;
    if (sh && sh.src === n.src) {
      // beta (D127): a synced member fades out; its chain leaves the shared source 0.4 s later (updateLoops), and the
      // source stops with its last member
      sh.refs--;
      sh.retired.push({ src: n.src, filter: n.filter, gain: n.gain, panner: n.panner, at: now + 0.4 });
      if (sh.refs <= 0) {
        const list = sh.retired;
        sh.src.stop(now + 0.4);
        sh.src.onended = () => { for (const r of list) { r.panner.disconnect(); r.gain.disconnect(); r.filter.disconnect(); } };
        this.shared.delete(`${L.sync}|${L.variant}`);
      }
      return;
    }
    n.src.stop(now + 0.4);
    n.src.onended = () => { n.panner.disconnect(); n.gain.disconnect(); n.filter.disconnect(); };
  }

  /** Beta (D127): shared loop sources (synced groups), with their members' chains that are fading out. */
  private readonly shared = new Map<string, { src: AudioBufferSourceNode; refs: number; retired: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; panner: PannerNode; at: number }[] }>();

  /** Disconnect faded members of shared sources (their 0.4 s fade is over). */
  private sweepShared(now: number): void {
    for (const sh of this.shared.values()) {
      for (let i = sh.retired.length - 1; i >= 0; i--) {
        const r = sh.retired[i]!;
        if (now < r.at) continue;
        sh.retired.splice(i, 1);
        try { r.src.disconnect(r.filter); } catch { /* already gone */ }
        r.panner.disconnect(); r.gain.disconnect(); r.filter.disconnect();
      }
    }
  }

  private updateLoops(now: number): void {
    const fam: Record<LoopFam, { L: LoopState; p: number }[]> = { roll: [], mech: [], critter: [], matter: [] };
    for (const [id, L] of this.loops) {
      const stale = now - L.seen > LOOP_STALE_S;
      if (stale) {
        if (L.node) this.stopLoop(L, now);
        if (now - L.seen > 1) this.loops.delete(id);
        continue;
      }
      // paused run: every run loop falls silent (they're still refreshed, so they resume on play)
      if (this.paused && this.mode === 'running') { if (L.node) this.stopLoop(L, now); continue; }
      const d = dist(L.pos, this.listener.pos);
      const p = this.loopParams(L).gain * attenuation(d, L.ref);
      if (!(d <= Math.max(MAX_DIST, L.ref * 20)) || !(p >= 1e-3)) { if (L.node) this.stopLoop(L, now); continue; }
      fam[L.fam].push({ L, p });
    }
    for (const k of ['roll', 'mech', 'critter', 'matter'] as const) {
      const list = fam[k].sort((a, b) => b.p - a.p);
      const cap = LOOP_CAP[k];
      list.forEach(({ L }, i) => {
        if (i < cap) { if (!L.node) this.startLoop(L, now); }
        else if (L.node) this.stopLoop(L, now);
      });
    }
    this.stats.loops = this.loopNodes;
    if (this.shared.size) this.sweepShared(now);
  }
}
