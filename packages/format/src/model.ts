// World document records shared by docstore, net, sim and the host (ARCHITECTURE §4, DATA_FORMATS §2).

import type { Rotation } from './quantize.ts';

/** `slot × 2^32 + counter` (MULTIPLAYER §5.3). Safe-integer in JS. */
export type PartId = number;
export type PlayerSlot = 1 | 2;

export const ID_SLOT_BASE = 4294967296; // 2^32

export function makeId(slot: number, counter: number): PartId {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2047) throw new RangeError('bad slot');
  if (!Number.isInteger(counter) || counter < 1 || counter >= ID_SLOT_BASE) throw new RangeError('bad counter');
  return slot * ID_SLOT_BASE + counter;
}

export function idSlot(id: PartId): number {
  return Math.floor(id / ID_SLOT_BASE);
}

export const PartFlag = {
  MirrorX: 1 << 0,
  MirrorY: 1 << 1,
  MirrorZ: 1 << 2,
  Locked: 1 << 3,
  Hidden: 1 << 4,
  Anchored: 1 << 5,
  // B5 (M5, D105; append-only): BUZZ fetches tagged objects. Bit 9: bits 6–8 of the PART record's wire u16 are
  // HAS_SIZE / HAS_PROPS / HAS_SKIN (world.ts), so the tag takes the next free one. Set in Build (U5's toggle).
  Tagged: 1 << 9,
} as const;

/** Property values are stored as integer step counts (PART_SYSTEM §2). Sorted by property index. */
export type PropList = readonly (readonly [index: number, steps: number])[];

export interface PartRecord {
  readonly id: PartId;
  readonly type: string;
  readonly pos: readonly [number, number, number]; // i32, 1/64 cell
  readonly rot: Rotation;
  readonly flags: number;
  readonly size?: readonly [number, number, number]; // u16, 1/4 cell
  readonly props?: PropList;
  readonly layer?: number;
  readonly group?: number;
  readonly skin?: number;
}

export const LinkKinds = [
  'line', 'chain', 'bungee', 'band', 'band_crossed', 'fuse', 'tube', 'tube_slim', 'gutter', 'gutter_slim',
  'glidepath', 'cable_power', 'cable_signal', 'ping',
  'fill', // MI (M4): PART_SYSTEM §3 Air `fill` link (INFLATOR → HELIO knot); append-only
] as const;
export type LinkKind = (typeof LinkKinds)[number];

export interface LinkEnd {
  readonly part: PartId;
  readonly port: number; // port index in the part definition
}

export interface LinkRecord {
  readonly id: PartId;
  readonly kind: LinkKind;
  readonly from: LinkEnd | null;
  readonly to: LinkEnd | null;
  readonly via: readonly PartId[]; // sheaves / anchors
  readonly points: readonly (readonly [number, number, number])[]; // spline control points, 1/64 cell
  readonly length: number; // 1/64 cell units
  readonly props?: PropList;
}

export interface NoteRecord {
  readonly id: PartId;
  readonly pos: readonly [number, number, number];
  readonly text: string;
  readonly color: string;
}

export interface EnvSettings {
  readonly preset: 'desk' | 'room' | 'warehouse' | 'arena' | 'megastructure';
  readonly environment: string;
  readonly gravity: number; // percent
  readonly air: number; // percent
  readonly feel: 'real' | 'floaty' | 'snappy';
  /** MI (M4, D98): Mega Kitchen "Fill the sink": the run starts with SINK_FILL_PARTICLES of Matter water in the basin. */
  readonly sinkFill?: boolean;
  /**
   * W5 (M5): the environment's authored zero-g zones (ORBITAL HANGAR `ZONE__field__zerog_n`): absent or true = on,
   * false = off. Players can toggle them, never move them. A run input like gravity (DATA_FORMATS §2.1 `zones`).
   */
  readonly zones?: boolean;
  /**
   * W5 (M5, D26): global wind (DATA_FORMATS §2.1, SIMULATION §5.8, environments.md §4.5): mean speed 0–15 m/s, the
   * horizontal direction it blows toward (degrees: 0 = +X, 90 = −Z, i.e. Blender +Y), and a seeded gust profile.
   * Absent (worlds before M5) = no wind. A run input like gravity; scaled by `air` (none on the Moon).
   */
  readonly wind?: EnvWind;
  /** W5 (M5): MOON BASE's "Base lights" world toggle (environments.md §6.4: the lander floodlights); absent = off. Cosmetic. */
  readonly baseLights?: boolean;
  /**
   * U5 (M5): Settings › World › "Sand, water and marbles" (the M4_STATUS known limit): overrides the header's
   * `simFlags.matterGameplay` for this world; absent (or null from an undo of "never set") = the header's flag.
   * Changed with EnvUpdate, so it's undoable and synced; docstore's `WorldDoc.simFlags` applies it.
   */
  readonly matter?: boolean;
}

/**
 * The default environment per preset (GAME_SPEC §10.2, M3_PLAN contract 2): THE TINKER LAB for Desk and Room, the
 * Studio for Warehouse and Arena, the Backlot for Megastructure (the Studio stops at Arena).
 */
export function defaultEnvironment(preset: EnvSettings['preset']): string {
  return preset === 'desk' || preset === 'room' ? 'tinker' : preset === 'megastructure' ? 'backlot' : 'studio';
}

// ---- W5 (M5): per-environment physics defaults (environments.md §5, §6) ---------------------------------------
/** Gravity and air (percent) an environment starts with; environments not listed are Earth, 100 / 100. */
const ENV_PHYSICS: Readonly<Record<string, { readonly gravity: number; readonly air: number }>> = {
  hangar: { gravity: 38, air: 100 }, // ORBITAL HANGAR: spin gravity (the "Mars" preset), pressurised
  moon: { gravity: 16.5, air: 0 }, // MOON BASE: Moon gravity, vacuum
};

/** An environment's default gravity and air (percent). */
export function envPhysics(environment: string): { readonly gravity: number; readonly air: number } {
  return ENV_PHYSICS[environment] ?? { gravity: 100, air: 100 };
}

// ---- W5 (M5, D26): global wind (SIMULATION §5.8; the Backlot weather presets, environments.md §4.5) ------------------

export type WindGusts = 'none' | 'breezy' | 'gusty' | 'overcast';
export interface EnvWind {
  /** Mean speed, m/s (0–15, 0.1 steps). */
  readonly speed: number;
  /** Direction it blows toward, degrees (0 = +X, 90 = −Z): integer 0–359. */
  readonly dir: number;
  readonly gusts?: WindGusts;
}

/** The Backlot's weather presets (environments.md §4.5): mean wind, gust profile, direction (from −X, west, = toward +X). */
export const WIND_PRESETS: Readonly<Record<'calm' | 'breezy' | 'gusty' | 'overcast', EnvWind>> = {
  calm: { speed: 0, dir: 0, gusts: 'none' },
  breezy: { speed: 3, dir: 0, gusts: 'breezy' },
  gusty: { speed: 6, dir: 0, gusts: 'gusty' },
  overcast: { speed: 2, dir: 0, gusts: 'overcast' },
};

/** Gust profiles: amplitude (m/s) and period (s) of the seeded gusts; `up` = gusts only add (Gusty: 6 m/s, to 10). */
const GUSTS: Readonly<Record<WindGusts, { amp: number; period: number; up: boolean }>> = {
  none: { amp: 0, period: 1, up: false },
  breezy: { amp: 1, period: 9, up: false }, // ±1 m/s, 6–12 s
  gusty: { amp: 4, period: 5.5, up: true }, // to 10 m/s, 3–8 s
  overcast: { amp: 0.5, period: 8, up: false }, // ±0.5 m/s
};

/** Integer hash → [0, 1). */
function windHash(k: number, seed: number): number {
  let h = (Math.imul(k, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Wind speed (m/s) at simulation time `t` (s) for a world seed: the mean plus the profile's seeded gusts, a smooth value
 * noise with one knot per period (integer hash + IEEE + − × ÷ only: identical on every machine), clamped to 0–15.
 */
export function windSpeedAt(w: EnvWind | null | undefined, t: number, seed: number): number {
  if (!w || !(w.speed > 0 || (w.gusts && w.gusts !== 'none'))) return 0;
  const g = GUSTS[w.gusts ?? 'none'];
  if (g.amp === 0) return Math.min(15, Math.max(0, w.speed));
  const x = t / g.period, k = Math.floor(x), u = x - k, s = u * u * (3 - 2 * u);
  const a = windHash(k, seed), b = windHash(k + 1, seed);
  const n = a + (b - a) * s; // 0..1
  return Math.min(15, Math.max(0, w.speed + g.amp * (g.up ? n : n * 2 - 1)));
}

/** Does this environment author zero-g zones (`env.zones` applies)? */
export function envHasZones(environment: string): boolean { return environment === 'hangar'; }

/** Are the world's zero-g zones on (the environment has them and `env.zones` isn't false)? */
export function envZonesOn(env: { readonly environment?: string; readonly zones?: boolean } | undefined): boolean {
  return !!env && envHasZones(env.environment ?? '') && env.zones !== false;
}

/**
 * The EnvUpdate patch that switches a world to environment `id`: the environment, plus its gravity and air when the
 * world still has the old environment's defaults (a world with custom gravity keeps it). One op, one undo step.
 */
export function envSwitchPatch(cur: EnvSettings, id: string): Partial<EnvSettings> {
  const was = envPhysics(cur.environment), next = envPhysics(id);
  const out: { -readonly [K in keyof EnvSettings]?: EnvSettings[K] } = { environment: id };
  if (cur.gravity === was.gravity && next.gravity !== cur.gravity) out.gravity = next.gravity;
  if (cur.air === was.air && next.air !== cur.air) out.air = next.air;
  return out;
}

/**
 * New worlds' settings for a preset, in its default environment or in `environment` (W5: with that environment's
 * gravity and air, e.g. the Moon's 16.5 % and 0 %). Saved worlds keep the values they were saved with.
 */
export function defaultEnvFor(preset: EnvSettings['preset'], environment?: string): EnvSettings {
  const id = environment ?? defaultEnvironment(preset);
  const ph = envPhysics(id);
  return { preset, environment: id, gravity: ph.gravity, air: ph.air, feel: 'real' };
}

export const DEFAULT_ENV: EnvSettings = defaultEnvFor('room');

/** Saves from before M3 that name no environment were made in the Studio: they load as they were. */
export const LEGACY_ENVIRONMENT = 'studio';

// ---- organisation: groups, layers, modules (GAME_SPEC §7.4, DATA_FORMATS §2.2 GRUP / MODL) -------------

/**
 * Group, layer and module ids are "small ids": `slot × 2^24 + n` (n ≥ 1), so they fit the u32
 * `PartRecord.layer` / `group` fields and the two players never collide. 0 means "none".
 */
export const SMALL_ID_SLOT_BASE = 16777216; // 2^24

export function makeSmallId(slot: number, n: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot > 255) throw new RangeError('bad slot');
  if (!Number.isInteger(n) || n < 1 || n >= SMALL_ID_SLOT_BASE) throw new RangeError('bad small id');
  return slot * SMALL_ID_SLOT_BASE + n;
}

export function smallIdSlot(id: number): number {
  return Math.floor(id / SMALL_ID_SLOT_BASE);
}

/** Next free small id for `slot` given the ids in use (monotonic past `floor`). */
export function nextSmallId(slot: number, inUse: Iterable<number>, floor = 0): number {
  let n = Math.max(0, floor - slot * SMALL_ID_SLOT_BASE);
  for (const id of inUse) if (smallIdSlot(id) === slot) n = Math.max(n, id - slot * SMALL_ID_SLOT_BASE);
  return makeSmallId(slot, n + 1);
}

/** A named group of parts. Membership lives on `PartRecord.group` (one group per part). */
export interface GroupRecord {
  readonly id: number;
  readonly name: string;
  readonly parent: number; // 0 = top level
}

export const LayerFlag = { Hidden: 1 << 0, Locked: 1 << 1 } as const;

/** A layer: parts reference it through `PartRecord.layer`. Layer 0 is the implicit default layer. */
export interface LayerRecord {
  readonly id: number;
  readonly name: string;
  readonly flags: number; // LayerFlag bits
}

/** A module (prefab) stored in the world: its `.knockmod` bytes (DATA_FORMATS §4). */
export interface ModuleRecord {
  readonly id: number;
  readonly name: string;
  readonly blob: Uint8Array;
}

/** Where a module lands: an offset (1/64 cell) and a yaw in quarter turns (exact, deterministic). */
export interface ModuleTransform {
  readonly pos: readonly [number, number, number];
  readonly quarter: 0 | 1 | 2 | 3;
}
