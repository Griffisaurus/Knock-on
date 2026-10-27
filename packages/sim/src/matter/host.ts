// machine.matter (M4_PLAN contract 2): the Matter layer as the Machine sees it. Part behaviours and critters use
// this API only; nothing else talks to a backend.
//
// Timing (SIMULATION §8.5, fixed latency, so results never depend on GPU speed):
//   stage 13 of rigid tick 2N   capture the proxy snapshot S(2N); submit Matter tick N, built from S(2N − 4), the
//                               emits and blasts queued since the last command, and the live intakes
//   (Matter tick N runs between rigid ticks 2N and 2N + 1)
//   stage 7 of rigid tick 2N+4  take Matter tick N's result (the link blocks while it's late: time dilation) and
//                               apply its body impulses and absorbed counts
// Matter stays dormant (no commands at all) until the first emit, so a world with the flag on and no Matter costs
// nothing; the first command's tick is plain state (st.matter.first), and the backend numbers its ticks from it
// (backend tick = N − first), so it always starts from its initial state at tick 0.
//
// Rollback: everything gameplay-visible is plain data in st.matter (cloned with st). A checkpoint every
// `checkpointEvery` rigid ticks also holds a Matter record: the backend snapshot (after Matter tick T/2 − 1), the
// two results computed but not yet applied (Matter ticks T/2 − 2 and T/2 − 1), and the proxy snapshots the next
// commands and those results refer to. Checkpoints without a record can't be restored while Matter is active.

import { f32, type Hasher } from '@knockon/detmath';
import type { SimFlags } from '@knockon/format';
import type { JoltModule } from '@knockon/jolt';
import type { PartDef, Props, ShapeDef } from '@knockon/parts-data';
import { qrot, vcross, type Q, type Vec } from '../vec.ts';
import { isSyncBackend, type MatterBackend, type MatterBlast, type MatterEmit, type MatterIntake, type MatterKind, type MatterProxy, type MatterQuery, type MatterStepIn, type MatterStepOut, type MatterZone } from './contract.ts';
import { SyncBackendLink, type MatterLink, type MatterSnapRef } from './link.ts';
import { MatterParts } from './parts.ts';
import { MAX_SUB, PROXY_STRIDE, SHAPE_OBB, SHAPE_PLANE, SHAPE_SPHERE, STATIC_ID_BASE, localProxies, proxyWorld, toProxies, writeProxy, type LocalProxy } from './proxies.ts';
import { DEFAULT_IMPULSE_SCALE, MATTER_KINDS, PARTICLE_KG, PER_LITRE, mToU, matterGravityQ8, mpsToU } from './units.ts';
import { spaceSetPlan } from '../envsets.ts';
import { moonTiles, type TerrainTiles } from './terrain.ts';
import { ANGULAR_DRAG, LINEAR_DRAG, WATER_DAMP, WATER_RHO, sampleWater, surfaceIndex, surfaceRequest, surfaceState, type WaterSample } from './buoyancy.ts';

export type { SimFlags };

/**
 * What the host needs of the world doc (Machine passes its options): the environment and preset (the Kitchen sink, the
 * space sets), and for D104 the world gravity % (format env.gravity; absent = 100) and env.zones (absent = on).
 */
export interface MatterEnv {
  readonly environment?: string | undefined;
  readonly preset?: string | undefined;
  readonly gravityPercent?: number | undefined;
  readonly zones?: boolean | undefined;
}

export interface MatterOptions {
  /** The backend (Node: MX's CPU backend with its synchronous twins). Ignored when `link` is given. */
  readonly backend?: MatterBackend;
  /** A ready link (browser: the sim worker's MatterWorkerLink to the GPU host). */
  readonly link?: MatterLink;
  /** Grain capacity (tier, GAME_SPEC §15.2). Default 20,000 (the Node budget). */
  readonly capacity?: number;
  /** Rigid ticks between Matter snapshots (SIMULATION §11: 2 s = 240). Must be a multiple of the checkpoint interval. */
  readonly checkpointEvery?: number;
  /** Matter snapshots kept (older checkpoints lose theirs and can't be restored with Matter on). Default 8. */
  readonly keepSnapshots?: number;
  /** An explicit Matter-active region in metres (big scenes: the Sandstorm valley). */
  readonly region?: { readonly min: readonly number[]; readonly max: readonly number[] };
  /** Backend impulse units → N·s and N·m·s (units.ts DEFAULT_IMPULSE_SCALE until MX publishes it). */
  readonly impulseScale?: { readonly lin: number; readonly ang: number };
  /** Dynamic proxies per command (SIMULATION §8.5: 4,096). */
  readonly maxProxies?: number;
  /**
   * D98 "Fill the sink": water particles to fill the Mega Kitchen's basin with at the start of the run (the app passes
   * SINK_FILL_PARTICLES when the world's env.sinkFill is on; tests pass less). Ignored outside the Kitchen.
   */
  readonly sinkFill?: number;
  /** D101 water buoyancy and the Δv limiter (default on): off is the M4 behaviour (floating on the particle contacts alone). */
  readonly buoyancy?: boolean;
  /** Tests: accumulate per-body impulse diagnostics in MatterHost.diag (never read by the sim). */
  readonly diagnostics?: boolean;
}

/** Per-body impulse totals (N·s) since the diagnostics were reset: Jolt buoyancy (+ drag) and the particle contacts. */
export interface MatterDiag { buoy: Map<number, [number, number, number]>; contact: Map<number, [number, number, number]>; limited: number }

/** Plain, JSON-safe Matter state (inside the Machine's `st`). */
export interface MatterSt {
  /** First Matter tick that was submitted (−1: dormant, nothing emitted yet). */
  first: number;
  /** Last applied Matter tick (−1 none). */
  applied: number;
  /** Next emit sequence number. */
  seq: number;
  /** Queued emits for the next command: [part, kind, count, px, py, pz (units), vx, vy, vz, spread (units per matter tick), seq] … */
  emits: number[];
  /** Queued blasts: [cx, cy, cz, radius (units), impulse (units per matter tick)] … */
  blasts: number[];
  /** Intake sensors: [part, minx, miny, minz, maxx, maxy, maxz (part space, metres), kindMask, capacity, last tick opened (−1 persistent), 0] … */
  intakes: number[];
  /** Per intake × 4 kinds (sand, water, marble, goo): grains absorbed at the last coupling tick (until the next stage 7). */
  absorbed: number[];
  /**
   * Containers, CONT numbers each: [part, capacity (mL), stored sand, stored water, stored marbles (grains), starting load
   * (mL), stored goo (grains; X5, appended so the M4 fields keep their places)] …
   */
  cont: number[];
  /** Live grains per kind and the checksum, from the last applied result. */
  counts: number[];
  sum: number[];
  /** Live-particle bounds from the last result (units, min then max), or [] when the backend doesn't report them. */
  bounds: number[];
  /** Fallback region (units) grown from every emit point, or [] (no emit yet). */
  emitBox: number[];
  /** D98 Kitchen sink fill: blocks emitted so far (parts.ts). */
  sink: number;
  /** near(): queries for the next command [cx, cy, cz, radius (units), kindMask] …, the ones in flight by Matter tick
   * [N, n, …n queries], and the live answers [cx, cy, cz, radius, kindMask, count, ax, ay, az, Matter tick] …. */
  queries: number[];
  qflight: number[][];
  answers: number[];
  /** D101: the water-surface map of the last applied result (buoyancy.ts layout), [] for none. */
  surf: number[];
}

/** A checkpoint's Matter record. `ref` is null once released (that checkpoint can't restore Matter any more). */
export interface MatterCp {
  readonly tick: number;
  ref: MatterSnapRef | null;
  readonly early: readonly MatterStepOut[];
  readonly snaps: readonly Snap[];
}

interface Snap { readonly tick: number; readonly rec: Int32Array; readonly n: number }

/** What the host reads of the Machine (machine.ts passes itself; these names must match its members). */
export interface MatterMachine {
  readonly Jolt: JoltModule;
  readonly bi: JoltModule;
  readonly system: JoltModule;
  readonly tickRate: number;
  readonly seed: readonly [number, number];
  readonly bodies: readonly { readonly part: number; readonly role: string; readonly body: JoltModule; readonly dynamic: boolean; readonly ghost: boolean }[];
  readonly parts: readonly { readonly id: number; readonly def: PartDef; readonly props: Props; readonly pos: Vec; readonly rot: Q; base: number; arm: number }[];
  readonly st: { tick: number; alive: boolean[]; broken: boolean[]; matter: MatterSt | null };
  /** Environment set colliders (Machine.buildSet), world space. */
  readonly envBoxes: readonly { readonly center: readonly number[]; readonly half: readonly number[] }[];
  readonly envSpheres: readonly { readonly center: readonly number[]; readonly radius: number }[];
  hiddenBody(i: number, role: string): boolean;
  v3(x: number, y: number, z: number): JoltModule;
}

const L_GHOST = 2;
const PAD = 1.0;          // m: SIMULATION §8.5 region padding
const FALLBACK_PAD = 3.0; // m: emit-point region padding when the backend reports no bounds
const RING = 6;           // proxy snapshots kept (S(t − 10) … S(t))
const KINDS = MATTER_KINDS; // sand, water, marble, goo (X5)
/** Numbers per container in st.matter.cont. */
const CONT = 7;
/** Where kind k's stored grains sit in a container record (goo was appended after the starting load). */
const STORE = [2, 3, 4, 6] as const;
/** MX constants.ts GRAVITY_Q8: Earth, the M4 constant (commands omit `gravity` then, so Earth worlds send what M4 sent). */
const EARTH_Q8 = 2816;
/** Static proxy ids of the Moon's terrain tiles: TERRAIN_ID_BASE + sample cell index (never get impulses). */
const TERRAIN_ID_BASE = STATIC_ID_BASE + 0x8000000;
/** MX backend.ts MAX_QUERIES: near() queries per Matter command (later ones that tick are dropped, deterministically). */
const MAX_QUERIES = 16;
/** Matter ticks an answer stays usable (0.5 s). */
const ANSWER_TTL = 30;
/** D101 Δv limiter (MX's recommendation for light bodies under the fixed latency): a Matter impulse may change a body's
 * velocity by at most its speed relative to the water plus DV_SLACK, and its spin by at most its spin plus DW_SLACK. */
const DV_SLACK = 1.0; // m/s
const DW_SLACK = 20; // rad/s

const fmix = (h0: number): number => {
  let h = h0 | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

/** The backend seed for a world seed (every client and every link derives it the same way). */
export function matterSeed(seed: readonly [number, number]): number {
  return fmix(seed[0] ^ Math.imul(seed[1], 0x9e3779b1));
}

/** Default Matter seed when MachineOptions.seed is absent (Machine's default world seed). */
export const DEFAULT_WORLD_SEED: readonly [number, number] = [0x9e3779b9, 0x7f4a7c15];

export class MatterHost {
  readonly active: boolean;
  private readonly m: MatterMachine;
  private readonly link: MatterLink | null = null;
  private readonly every: number;
  private readonly keep: number;
  private readonly maxProxies: number;
  private readonly scale: { readonly lin: number; readonly ang: number };
  private readonly region: { readonly min: readonly number[]; readonly max: readonly number[] } | null;
  private gravity = -9.81;
  /** Results taken from the link before their coupling tick (checkpoints), by Matter tick. */
  private early = new Map<number, MatterStepOut>();
  private ring: Snap[] = [];
  /** Live checkpoint records, oldest first (for the snapshot budget). */
  private live: MatterCp[] = [];
  /** Per body: its local proxies (null: use the Jolt world bounds), built on first use. */
  private local: (LocalProxy[] | null | undefined)[] = [];
  private statics: { rec: Int32Array; n: number; box: Float64Array } | null = null;
  private scratch = new Int32Array(0);
  /** Part index → container slot in st.matter.cont (static after init). */
  private contOf = new Map<number, number>();
  private destroyed = false;
  private hooks: MatterParts | null = null;
  private readonly buoyant: boolean;
  /** The surface map's dense index, for the st.matter.surf array it was built from. */
  private surfIdx: { ref: number[]; idx: Int32Array } | null = null;
  /** x–z box (metres) of the bodies the last capture put in the command (the next surface request). */
  private bodyBox = [Infinity, Infinity, -Infinity, -Infinity];
  /** Diagnostics (tests only; MatterOptions.diagnostics). */
  readonly diag: MatterDiag | null;
  /** D104: the world's gravity for grains (Q8 units/substep²) and the gravity zones (the Hangar's zero-g zones), units. */
  private g8 = EARTH_Q8;
  private zones: MatterZone[] = [];
  /** The catch-all floor's top under the space sets (metres; 0 elsewhere): the Matter floor plane matches it. */
  private floorTop = 0;
  /** The Moon's regolith as Matter proxies (tiles over the active region, cached per sample cell); null elsewhere. */
  private terrain: TerrainTiles | null = null;
  /** Jolt vectors for ApplyBuoyancyImpulse (made on first use). */
  private jv: { p: JoltModule; n: JoltModule; f: JoltModule; g: JoltModule } | null = null;

  /** The run's environment and preset (the Kitchen sink's basin), and the sink fill amount. */
  readonly env: MatterEnv;
  readonly sinkFill: number;

  constructor(m: MatterMachine, flags: SimFlags | undefined, opts: MatterOptions | undefined, env: MatterEnv = {}) {
    this.m = m;
    this.env = env;
    this.sinkFill = env.environment === 'kitchen' ? Math.max(0, Math.floor(opts?.sinkFill ?? 0)) : 0;
    this.active = !!flags?.matterGameplay;
    this.every = opts?.checkpointEvery ?? 240;
    this.keep = Math.max(2, opts?.keepSnapshots ?? 8);
    this.maxProxies = opts?.maxProxies ?? 4096;
    this.scale = opts?.impulseScale ?? DEFAULT_IMPULSE_SCALE;
    this.region = opts?.region ?? null;
    this.buoyant = opts?.buoyancy ?? true;
    this.diag = opts?.diagnostics ? { buoy: new Map(), contact: new Map(), limited: 0 } : null;
    if (!this.active) return;
    if (opts?.link) this.link = opts.link;
    else if (opts?.backend && isSyncBackend(opts.backend)) {
      const cfg = { capacity: opts.capacity ?? 20000, seed: matterSeed(m.seed) };
      opts.backend.initSync(cfg);
      this.link = new SyncBackendLink(opts.backend);
    } else {
      // every client must run Matter when the flag is on, or their runs differ: refuse rather than diverge
      throw new Error('matterGameplay is on but no synchronous Matter backend or link was given (MachineOptions.matter)');
    }
  }

  /** Called once st exists (Machine constructor). */
  init(): void {
    const st = this.m.st;
    st.matter = this.active ? {
      first: -1, applied: -1, seq: 0, emits: [], blasts: [], intakes: [], absorbed: [], cont: [],
      counts: [0, 0, 0, 0], sum: [0, 0], bounds: [], emitBox: [], sink: 0, queries: [], qflight: [], answers: [], surf: [],
    } : null;
    if (!this.active) return;
    const g = this.m.system.GetGravity();
    this.gravity = g.GetY();
    this.initWorld();
    this.hooks = new MatterParts(this, this.m);
    this.hooks.init();
  }

  /**
   * D104: grains follow the world. Its gravity % (format env.gravity) becomes the backend's Q8 gravity, and the space
   * sets' zero-g zones (while env.zones is on) gravity zones at their own % of it; the Matter floor plane sits on the sim's
   * catch-all floor; on the Moon the regolith heightfield becomes static terrain tiles (terrain.ts). All of it is static
   * per run (gravity and zones are run inputs: changing them rebuilds the Machine).
   */
  private initWorld(): void {
    const pct = this.env.gravityPercent ?? 100;
    this.g8 = matterGravityQ8(pct);
    const space = spaceSetPlan(this.env.environment, this.env.preset);
    if (!space) return;
    this.floorTop = space.floorTop;
    if (this.env.zones !== false) {
      this.zones = space.zones.slice(0, 16).map((z): MatterZone => {
        const gz = matterGravityQ8((pct * z.gravityPercent) / 100);
        if (z.shape === 'box') {
          const b = z.box;
          return {
            shape: 1, gravity: gz,
            center: Int32Array.of(mToU((b.min[0] + b.max[0]) / 2), mToU((b.min[1] + b.max[1]) / 2), mToU((b.min[2] + b.max[2]) / 2)),
            size: Int32Array.of(mToU((b.max[0] - b.min[0]) / 2), mToU((b.max[1] - b.min[1]) / 2), mToU((b.max[2] - b.min[2]) / 2)),
          };
        }
        return { shape: 0, gravity: gz, center: Int32Array.of(mToU(z.center[0]), mToU(z.center[1]), mToU(z.center[2])), size: Int32Array.of(mToU(z.radius), mToU(z.halfHeight), 0) };
      });
    }
    if (space.field) this.terrain = moonTiles(space.field, space.holes);
  }

  private get s(): MatterSt { return this.m.st.matter!; }

  // ---- contract 2: the API part behaviours and critters use ------------------------------------------------

  /**
   * Queues `count` grains of `kind` for the next Matter tick, as a lattice block centred on `localPos` (part space,
   * metres; the spout, within 0.03 m of it) moving at `localVel` (part space, m/s) with up to ±`spread` m/s of jitter
   * per axis (backend.ts emit rules). Part order is call order: behaviours run in part order. `part` is a part index.
   * No-op while Matter is off.
   */
  emit(part: number, kind: MatterKind, count: number, localPos: readonly number[], localVel: readonly number[], spread = 0.05): void {
    if (!this.active || count <= 0) return;
    const { pos, rot } = this.pose(part);
    const p = qrot(rot, localPos), v = qrot(rot, localVel);
    this.emitWorld(part, kind, count, [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2]], v, spread);
  }

  /** `emit` in world space (metres, m/s); `part` −1 for the environment's own water (D98's Kitchen sink). */
  emitWorld(part: number, kind: MatterKind, count: number, w: readonly number[], v: readonly number[], spread = 0.05): void {
    if (!this.active || count <= 0) return;
    const s = this.s;
    s.emits.push(part, kind, Math.floor(count), mToU(w[0]!), mToU(w[1]!), mToU(w[2]!), mpsToU(v[0]!), mpsToU(v[1]!), mpsToU(v[2]!), mpsToU(spread), s.seq++);
    // the fallback region grows over every emit point (used only when the backend reports no bounds)
    const e = s.emitBox, u = [mToU(w[0]!), mToU(w[1]!), mToU(w[2]!)];
    if (!e.length) e.push(u[0]!, u[1]!, u[2]!, u[0]!, u[1]!, u[2]!);
    else for (let k = 0; k < 3; k++) { e[k] = Math.min(e[k]!, u[k]!); e[k + 3] = Math.max(e[k + 3]!, u[k]!); }
  }

  /**
   * Opens an intake sensor on `part` (a part-space box, metres) for the kinds in `kindMask` (bit per kind), taking up
   * to `capacity` grains per Matter tick. Two ways to use it:
   *  - per tick (A4's containers): call it in stage 6 of every rigid tick the sensor should be live, with the room left
   *    as `capacity` (0 = closed); a sensor not called since the last command is closed;
   *  - `persistent` (MI's containers, registered at init): live while the part is alive and unbroken; `capacity` 0 =
   *    as many as fit the part's container, −1 = no limit (the container overflows itself).
   * The same part and box always map to the same intake (calling again updates capacity and mask). Returns its index.
   */
  intake(part: number, localBox: { readonly min: readonly number[]; readonly max: readonly number[] }, kindMask: number, capacity = 0, persistent = false): number {
    if (!this.active) return -1;
    const s = this.s;
    const until = persistent ? -1 : this.m.st.tick;
    for (let k = 0; k < s.intakes.length; k += 11) {
      if (s.intakes[k] === part && s.intakes[k + 1] === localBox.min[0] && s.intakes[k + 2] === localBox.min[1] && s.intakes[k + 3] === localBox.min[2]
        && s.intakes[k + 4] === localBox.max[0] && s.intakes[k + 5] === localBox.max[1] && s.intakes[k + 6] === localBox.max[2]) {
        s.intakes[k + 7] = kindMask; s.intakes[k + 8] = capacity; s.intakes[k + 9] = until;
        return k / 11;
      }
    }
    s.intakes.push(part, localBox.min[0]!, localBox.min[1]!, localBox.min[2]!, localBox.max[0]!, localBox.max[1]!, localBox.max[2]!, kindMask, capacity, until, 0);
    for (let j = 0; j < KINDS; j++) s.absorbed.push(0);
    return s.intakes.length / 11 - 1;
  }

  /** Grains `part`'s intakes took in at the last coupling tick, per kind (until the next stage 7). */
  absorbed(part: number): [number, number, number, number] {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    if (!this.active) return out;
    const s = this.s;
    for (let k = 0, i = 0; k < s.intakes.length; k += 11, i++) {
      if (s.intakes[k] !== part) continue;
      for (let j = 0; j < KINDS; j++) out[j] = out[j]! + s.absorbed[i * KINDS + j]!;
    }
    return out;
  }

  /**
   * A radial impulse on Matter (SIMULATION §6.1: detonations): centre and radius in metres, `dv` the peak speed kick
   * (m/s) at the centre (falls off over the radius in the kernel). Applied with the next command.
   */
  blast(center: readonly number[], radius: number, dv: number): void {
    if (!this.active || this.s.first < 0) return; // nothing to push yet
    // backend limits: radius ≤ 2^19 units (8 m), |impulse| ≤ 2^17
    this.s.blasts.push(mToU(center[0]!), mToU(center[1]!), mToU(center[2]!), Math.min(1 << 19, mToU(radius)), Math.max(-(1 << 17), Math.min(1 << 17, mpsToU(dv))));
  }

  /** Live grains of `kind` (as of the last applied result). */
  count(kind: MatterKind): number { return this.active ? this.s.counts[kind] ?? 0 : 0; }

  /**
   * Makes `part` a container of `capacityMl` millilitres holding `initial` grains of `kind` (stored contents are plain
   * quantities: they become particles only through emit). Call during init (part hooks).
   */
  container(part: number, capacityMl: number, kind: MatterKind = 1, initial = 0): void {
    if (!this.active || this.contOf.has(part)) return;
    const s = this.s;
    const slot = s.cont.length / CONT;
    const st: [number, number, number, number] = [0, 0, 0, 0];
    st[kind] = Math.max(0, Math.floor(initial));
    s.cont.push(part, capacityMl, st[0], st[1], st[2], volumeMl(st[0], st[1], st[2], st[3]), st[3]);
    this.contOf.set(part, slot);
  }

  /** Is `part` a container? */
  isContainer(part: number): boolean { return this.active && this.contOf.has(part); }

  /** Stored grains of `kind` in a container (−1 kind: the stored volume in mL). */
  stored(part: number, kind: MatterKind | -1 = -1): number {
    const slot = this.contOf.get(part);
    if (!this.active || slot === undefined) return 0;
    const c = this.s.cont, o = slot * CONT;
    return kind === -1 ? volumeMl(c[o + 2]!, c[o + 3]!, c[o + 4]!, c[o + 6]!) : c[o + STORE[kind]]!;
  }

  /** A container's capacity (mL), 0 for anything else. */
  capacityMl(part: number): number {
    const slot = this.contOf.get(part);
    return !this.active || slot === undefined ? 0 : this.s.cont[slot * CONT + 1]!;
  }

  /** Takes up to `n` grains of `kind` out of a container (they're about to be emitted). Returns how many. */
  take(part: number, kind: MatterKind, n: number): number {
    const slot = this.contOf.get(part);
    if (!this.active || slot === undefined) return 0;
    const c = this.s.cont, o = slot * CONT + STORE[kind];
    const got = Math.max(0, Math.min(Math.floor(n), c[o]!));
    c[o]! -= got;
    return got;
  }

  /** A container's fill, 0–1 (keyframes for R4's fill pass). 0 for anything that isn't one. */
  fill(part: number): number {
    const cap = this.capacityMl(part);
    return cap > 0 ? Math.min(1, this.stored(part) / cap) : 0;
  }

  /**
   * The nearest live, unbroken container holding at least `minMl` of water within `radius` metres of `p` (GOBY's
   * rescue bubble, SIMULATION §7.3), as its part index and mouth position; null if none. Stored water is the only
   * water the sim can see: loose particles live on the backend.
   */
  waterNear(p: readonly number[], radius: number, minMl = 2000): { part: number; at: Vec } | null {
    if (!this.active) return null;
    let best: { part: number; at: Vec } | null = null, bestD = radius;
    for (const [part, slot] of this.contOf) {
      if (!this.m.st.alive[part] || this.m.st.broken[part] || this.s.cont[slot * CONT + 3]! < minMl) continue;
      const pr = this.m.parts[part]!;
      const b = pr.def.boundsFor ? pr.def.boundsFor(pr.props) : pr.def.bounds;
      const { pos, rot } = this.pose(part);
      const top = qrot(rot, [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2]);
      const at: Vec = [pos[0] + top[0], pos[1] + top[1], pos[2] + top[2]];
      const d = Math.sqrt((at[0] - p[0]!) ** 2 + (at[1] - p[1]!) ** 2 + (at[2] - p[2]!) ** 2);
      if (d <= bestD) { bestD = d; best = { part, at }; }
    }
    return best;
  }

  /**
   * The grains of `kindMask` within `radius` metres of `at` (a world point, or a part index: its centre of mass), as
   * [centroid x, y, z (world, metres), count], or null when none (or the backend can't answer: MX's optional
   * `queries`). Asking registers the query for the next Matter command; the answer arrives with the fixed latency
   * (2N + 4), so this returns the newest answer to a query of the same radius and kinds centred within
   * max(0.25 m, radius / 2) of `at`, nearest first. Answers are plain state (rollback-safe, hashed). DUSTY uses it.
   */
  near(at: number | readonly number[], radius: number, kindMask: number): number[] | null {
    if (!this.active || radius <= 0) return null;
    const p = typeof at === 'number' ? this.pose(at).pos : at;
    const s = this.s;
    const c = [mToU(p[0]!), mToU(p[1]!), mToU(p[2]!)], r = Math.min(1 << 20, mToU(radius)); // backend limit: 16 m
    // one query per (cell of 5 cm, radius, kinds) per command
    const q5 = (v: number): number => Math.floor(v / 3277);
    let dup = false;
    for (let k = 0; k < s.queries.length && !dup; k += 5) {
      dup = q5(s.queries[k]!) === q5(c[0]!) && q5(s.queries[k + 1]!) === q5(c[1]!) && q5(s.queries[k + 2]!) === q5(c[2]!) && s.queries[k + 3] === r && s.queries[k + 4] === kindMask;
    }
    if (!dup && s.queries.length < 5 * MAX_QUERIES) s.queries.push(c[0]!, c[1]!, c[2]!, r, kindMask);
    const reach = Math.max(mToU(0.25), r / 2);
    let best = -1, bestD = Infinity;
    for (let k = 0; k < s.answers.length; k += 10) {
      if (s.answers[k + 3] !== r || s.answers[k + 4] !== kindMask || s.answers[k + 5]! <= 0) continue;
      const dx = s.answers[k]! - c[0]!, dy = s.answers[k + 1]! - c[1]!, dz = s.answers[k + 2]! - c[2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= reach && d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) return null;
    const U = 1 / 65536;
    return [s.answers[best + 6]! * U, s.answers[best + 7]! * U, s.answers[best + 8]! * U, s.answers[best + 5]!];
  }

  /** The Matter checksum of the last applied result, as hex (the multiplayer hash message carries it). */
  checksumHex(): string {
    if (!this.active) return '';
    const s = this.s.sum;
    return ((s[0]! >>> 0).toString(16).padStart(8, '0')) + ((s[1]! >>> 0).toString(16).padStart(8, '0'));
  }

  /** Is the layer running yet (an emit has happened)? */
  get started(): boolean { return this.active && this.s.first >= 0; }

  // ---- the tick ---------------------------------------------------------------------------------------------

  /** Stage 7: the result of Matter tick N = (t − 4) / 2 lands on even ticks; container weights every tick. */
  stage7(t: number): void {
    if (!this.active) return;
    const s = this.s;
    // absorbed counts are this rigid tick's: they're visible from the coupling stage until the next one
    if (s.absorbed.length) s.absorbed.fill(0);
    if (t % 2 === 0 && t >= 4 && s.first >= 0 && (t - 4) / 2 >= s.first) {
      const N = (t - 4) / 2;
      let out = this.early.get(N);
      if (out) this.early.delete(N); else out = this.link!.take(N - s.first);
      this.apply(N, out);
    }
    this.weights();
    this.buoyancy();
  }

  /** Stage 13: on even ticks, capture S(t) and submit Matter tick t / 2. */
  stage13(t: number): void {
    if (!this.active) return;
    this.hooks?.step(t); // FISHBOWL bursts and overflow, SCOOP pours (parts.ts)
    if (t % 2 !== 0) return;
    const s = this.s;
    if (s.first < 0) {
      if (!s.emits.length) return; // dormant
      s.first = t / 2;
      this.link!.meta?.(s.first);
    }
    this.capture(t);
    const input = this.command(t / 2, t);
    this.link!.submit(input);
  }

  private apply(N: number, out: MatterStepOut): void {
    const s = this.s;
    // the newest water-surface map (D101): buoyancy and the Δv limiter read it from here until the next result
    if (this.buoyant) s.surf = surfaceState(out);
    const snap = this.snapAt(2 * N - 4);
    // canonical order: Jolt accumulates impulses into velocities in float, so the order must not depend on the backend
    const imps = [...out.impulses].sort((a, b) => a.id - b.id);
    const J = this.m;
    // summed per body first (proxy-id order, so the float sums are canonical), then applied once per body
    let cur = -1, level = -Infinity;
    const acc: number[] = [0, 0, 0, 0, 0, 0];
    const flush = (): void => {
      if (cur >= 0) this.push(cur, acc);
      acc.fill(0);
    };
    for (const im of imps) {
      if (im.id >= STATIC_ID_BASE) continue;
      const lx = im.lin[0]!, ly = im.lin[1]!, lz = im.lin[2]!, ax = im.ang[0]!, ay = im.ang[1]!, az = im.ang[2]!;
      if (lx === 0 && ly === 0 && lz === 0 && ax === 0 && ay === 0 && az === 0) continue; // MX reports every dynamic proxy
      const bi = Math.floor(im.id / MAX_SUB);
      const b = J.bodies[bi];
      if (!b || !this.pushable(bi)) continue;
      if (bi !== cur) { flush(); cur = bi; level = this.waterLevel(bi); }
      const lin: Vec = [lx * this.scale.lin, ly * this.scale.lin, lz * this.scale.lin];
      let ang: Vec = [ax * this.scale.ang, ay * this.scale.ang, az * this.scale.ang];
      // the impulse acts at the proxy's centre: lever arm from the body's centre of mass, on today's pose
      const o = snap ? findRec(snap, im.id) : -1;
      let wet = level > -Infinity;
      let arm: Vec | null = null;
      if (o >= 0) {
        const pos = b.body.GetPosition(), px = pos.GetX(), py = pos.GetY(), pz = pos.GetZ();
        const r = b.body.GetRotation();
        const c = qrot([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], [snap!.rec[o + 19]! / 65536, snap!.rec[o + 20]! / 65536, snap!.rec[o + 21]! / 65536]);
        const com = b.body.GetCenterOfMassPosition();
        arm = [px + c[0] - com.GetX(), py + c[1] - com.GetY(), pz + c[2] - com.GetZ()];
        // this sub-shape is in the water when its lowest point is under the level beside the body
        wet = wet && py + c[1] - proxyHalfHeight(snap!.rec, o) < level;
      }
      // D101: in water, buoyancy carries the body; the particles' upward push and their torque are that same support
      // (weak, noisy and two ticks late each way, so a light body rocks), so they're dropped for the sub-shapes that
      // are in the water. Downward pushes (water poured on it) and sideways flow stay; dry sub-shapes (a WATERWHEEL's
      // buckets over a puddle) keep everything.
      if (wet) { if (lin[1] > 0) lin[1] = 0; ang = [0, 0, 0]; }
      if (arm) {
        const t = vcross(arm, lin);
        ang = [ang[0] + t[0], ang[1] + t[1], ang[2] + t[2]];
      }
      acc[0]! += lin[0]; acc[1]! += lin[1]; acc[2]! += lin[2]; acc[3]! += ang[0]; acc[4]! += ang[1]; acc[5]! += ang[2];
    }
    flush();
    // absorbed grains: the intake's count for this tick, and its part's stored quantity
    const abs = [...out.absorbed].sort((a, b) => a.id - b.id);
    for (const ab of abs) {
      const k = ab.id * 11;
      if (ab.id < 0 || k >= s.intakes.length) continue;
      const part = s.intakes[k]!;
      const slot = this.contOf.get(part);
      for (let j = 0; j < KINDS; j++) {
        const n = ab.counts[j] ?? 0;
        s.absorbed[ab.id * KINDS + j]! += n;
        if (slot !== undefined) s.cont[slot * CONT + STORE[j]!]! += n;
      }
    }
    for (let j = 0; j < KINDS; j++) s.counts[j] = out.counts[j] ?? 0;
    s.sum[0] = out.checksum[0] >>> 0; s.sum[1] = out.checksum[1] >>> 0;
    // bounds are all zero when nothing is alive
    s.bounds = out.bounds && (s.counts[0]! + s.counts[1]! + s.counts[2]! + (s.counts[3] ?? 0) > 0) ? Array.from(out.bounds) : [];
    // near() answers: pair the backend's ids with the queries sent with Matter tick N
    // (an answer stays until a newer one to the same query replaces it, or for ANSWER_TTL Matter ticks: critters ask
    // every few ticks, not every Matter tick)
    const fi = s.qflight.findIndex((q) => q[0] === N);
    const keep: number[] = [];
    for (let k = 0; k < s.answers.length; k += 10) if (s.answers[k + 9]! > N - ANSWER_TTL) keep.push(...s.answers.slice(k, k + 10));
    s.answers = keep;
    if (fi >= 0) {
      const q = s.qflight[fi]!;
      const near = [...(out.near ?? [])].sort((a, b) => a.id - b.id);
      for (const a of near) {
        if (a.id < 0 || a.id >= q[1]!) continue;
        const o = 2 + a.id * 5;
        for (let k = s.answers.length - 10; k >= 0; k -= 10) {
          if (s.answers[k] === q[o] && s.answers[k + 1] === q[o + 1] && s.answers[k + 2] === q[o + 2] && s.answers[k + 3] === q[o + 3] && s.answers[k + 4] === q[o + 4]) s.answers.splice(k, 10);
        }
        s.answers.push(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!, q[o + 4]!, a.count, a.centroid[0]!, a.centroid[1]!, a.centroid[2]!, N);
      }
    }
    s.qflight = s.qflight.filter((q) => q[0]! > N);
    s.applied = N;
  }

  /**
   * One body's summed Matter impulse (never zero: those are skipped). Only bodies particles actually touched are pushed:
   * MX reports every dynamic proxy, zeros included, and `BodyInterface::AddImpulse` wakes a sleeping body, so applying
   * the zeros woke every resting body near Matter each time it fell asleep, which re-added its contacts and replayed
   * their Impact / Press events (A4's finding: a THUD resting on THE BUTTON pressed it again every 62 ticks). A real
   * push always wakes: a threshold here (Jolt's 0.03 m/s) kept a WATERWHEEL asleep under a slowly filling bucket.
   */
  private push(bi: number, a: readonly number[]): void {
    const J = this.m;
    const body = J.bodies[bi]!.body;
    const id = body.GetID();
    // Δv limiter: with the fixed two-tick latency each way a light body can be handed impulses for motion it no longer
    // has (QUACK landing in water: several m/s for 40 g). A Matter impulse may at most stop the body relative to the
    // water around it plus DV_SLACK (and its spin plus DW_SLACK); linear and angular scale together (same line of action).
    const mp = body.GetMotionProperties();
    const im = mp.GetInverseMass();
    let k = 1;
    if (this.buoyant && im > 0) {
      const lv = body.GetLinearVelocity(), lx = lv.GetX(), ly = lv.GetY(), lz = lv.GetZ();
      const w = this.waterFor(bi);
      const rx = lx - (w ? w.vel[0] : 0), ry = ly - (w ? w.vel[1] : 0), rz = lz - (w ? w.vel[2] : 0);
      const dv = Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!) * im;
      const cap = Math.sqrt(rx * rx + ry * ry + rz * rz) + DV_SLACK;
      if (dv > cap) k = cap / dv;
      if (a[3] !== 0 || a[4] !== 0 || a[5] !== 0) {
        const dw = mp.MultiplyWorldSpaceInverseInertiaByVector(body.GetRotation(), J.v3(a[3]!, a[4]!, a[5]!));
        const av = body.GetAngularVelocity();
        const dwl = Math.sqrt(dw.GetX() * dw.GetX() + dw.GetY() * dw.GetY() + dw.GetZ() * dw.GetZ()) * k;
        const capw = Math.sqrt(av.GetX() * av.GetX() + av.GetY() * av.GetY() + av.GetZ() * av.GetZ()) + DW_SLACK;
        if (dwl > capw) k *= capw / dwl;
      }
      if (k < 1 && this.diag) this.diag.limited++;
    }
    if (this.diag) addDiag(this.diag.contact, bi, a[0]! * k, a[1]! * k, a[2]! * k);
    if (a[0] !== 0 || a[1] !== 0 || a[2] !== 0) J.bi.AddImpulse(id, J.v3(a[0]! * k, a[1]! * k, a[2]! * k));
    if (a[3] !== 0 || a[4] !== 0 || a[5] !== 0) J.bi.AddAngularImpulse(id, J.v3(a[3]! * k, a[4]! * k, a[5]! * k));
  }

  /** World bounds of body `bi`: min xyz, max xyz (metres). */
  private boundsOf(bi: number): number[] {
    const bb = this.m.bodies[bi]!.body.GetWorldSpaceBounds();
    const lo = bb.mMin, hi = bb.mMax;
    return [lo.GetX(), lo.GetY(), lo.GetZ(), hi.GetX(), hi.GetY(), hi.GetZ()];
  }

  /** The water around body `bi` from the current surface map (null: no map, or no water beside it). */
  private waterFor(bi: number): WaterSample | null {
    const s = this.s;
    if (!s.surf || s.surf.length < 5) return null;
    return sampleWater(s.surf, this.surfaceIdx(), this.boundsOf(bi));
  }

  /** The water level beside body `bi` when it's in the water (the level above its bottom), else −Infinity. */
  private waterLevel(bi: number): number {
    const s = this.s;
    if (!this.buoyant || !s.surf || s.surf.length < 5) return -Infinity;
    const b = this.boundsOf(bi);
    const w = sampleWater(s.surf, this.surfaceIdx(), b);
    return w && w.level > b[1]! ? w.level : -Infinity;
  }

  private surfaceIdx(): Int32Array {
    const surf = this.s.surf;
    if (this.surfIdx?.ref !== surf) this.surfIdx = { ref: surf, idx: surfaceIndex(surf) };
    return this.surfIdx.idx;
  }

  /**
   * D101: every rigid tick, Jolt's exact buoyancy for each awake body beside water, on its current pose, against the
   * local level from the newest surface map, at ρ = 1,000 kg/m³ (Jolt's buoyancy factor is ρ_water · V / m; the
   * submerged volume comes from the shape). Drag is relative to the water's mean velocity there. Sleeping bodies are
   * left alone (a particle push wakes them); hidden, dormant and ghost bodies never get any (pushable()).
   */
  private buoyancy(): void {
    const s = this.s, J = this.m;
    if (!this.buoyant || !s.surf || s.surf.length < 5) return;
    const U = 1 / 65536;
    const x0 = s.surf[0]! * U, z0 = s.surf[1]! * U;
    const x1 = x0 + s.surf[2]! * s.surf[3]! * U, z1 = z0 + s.surf[2]! * s.surf[4]! * U;
    const idx = this.surfaceIdx();
    const dt = 1 / J.tickRate;
    for (let bi = 0; bi < J.bodies.length; bi++) {
      const body = J.bodies[bi]!.body;
      if (!J.bodies[bi]!.dynamic || !body.IsActive() || !this.pushable(bi)) continue;
      const b = this.boundsOf(bi);
      if (b[3]! < x0 || b[0]! > x1 || b[5]! < z0 || b[2]! > z1) continue;
      const w = sampleWater(s.surf, idx, b);
      if (!w || w.level <= b[1]!) continue;
      const im = body.GetMotionProperties().GetInverseMass();
      const vol = body.GetShape().GetVolume();
      if (!(im > 0) || !(vol > 0)) continue;
      // the velocity before this tick's buoyancy: the damping below must not damp the lift itself
      const v0 = body.GetLinearVelocity(), vx = v0.GetX(), vy = v0.GetY(), vz = v0.GetZ();
      // own Jolt vectors: Machine.v3 is one shared scratch, and this call takes four
      const v = this.jv ??= { p: new J.Jolt.RVec3(0, 0, 0), n: new J.Jolt.Vec3(0, 1, 0), f: new J.Jolt.Vec3(0, 0, 0), g: new J.Jolt.Vec3(0, 0, 0) };
      v.p.Set(f32((b[0]! + b[3]!) / 2), f32(w.level), f32((b[2]! + b[5]!) / 2));
      v.f.Set(f32(w.vel[0]), f32(w.vel[1]), f32(w.vel[2]));
      v.g.Set(0, f32(this.gravity), 0);
      J.bi.ApplyBuoyancyImpulse(body.GetID(), v.p, v.n, f32(WATER_RHO * vol * im), LINEAR_DRAG, ANGULAR_DRAG, v.f, v.g, f32(dt));
      if (this.diag) {
        const v1 = body.GetLinearVelocity();
        addDiag(this.diag.buoy, bi, (v1.GetX() - vx) / im, (v1.GetY() - vy) / im, (v1.GetZ() - vz) / im);
      }
      // linear damping relative to the water, by the submerged share of the body's height (never reverses the motion)
      const sub = Math.min(1, (w.level - b[1]!) / Math.max(1e-6, b[4]! - b[1]!));
      const k = Math.min(1, WATER_DAMP * sub * dt) / im;
      v.f.Set(f32(-(vx - w.vel[0]) * k), f32(-(vy - w.vel[1]) * k), f32(-(vz - w.vel[2]) * k));
      J.bi.AddImpulse(body.GetID(), v.f);
    }
  }

  /** The water level and flow beside part `part`'s base body (null: no map, or dry around it). Tests and diagnostics. */
  waterAt(part: number): WaterSample | null {
    if (!this.active || !this.buoyant) return null;
    const bi = this.m.parts[part]?.base ?? -1;
    return bi >= 0 ? this.waterFor(bi) : null;
  }

  /** Grains taken in beyond a container's starting load weigh on its body (a constant force each tick). */
  private weights(): void {
    const s = this.s, J = this.m;
    for (let k = 0; k < s.cont.length; k += CONT) {
      const part = s.cont[k]!;
      if (!J.st.alive[part]) continue;
      let kg = 0;
      for (let j = 0; j < KINDS; j++) kg += s.cont[k + STORE[j]!]! * PARTICLE_KG[j]!;
      const vol = volumeMl(s.cont[k + 2]!, s.cont[k + 3]!, s.cont[k + 4]!, s.cont[k + 6]!);
      if (vol <= s.cont[k + 5]!) continue;
      kg *= (vol - s.cont[k + 5]!) / vol; // only the load above the starting one (the part's def mass includes that)
      const bi = J.parts[part]!.base;
      if (bi < 0 || !this.pushable(bi)) continue;
      J.bi.AddForce(J.bodies[bi]!.body.GetID(), J.v3(0, kg * this.gravity, 0), J.Jolt.EActivation_Activate);
    }
  }

  /** A body Matter may push: dynamic, its part alive, not hidden, dormant or ghosted (rule 8). */
  private pushable(bi: number): boolean {
    const b = this.m.bodies[bi]!;
    if (!b.dynamic || b.ghost || !this.m.st.alive[b.part]) return false;
    if (this.m.hiddenBody(b.part, b.role)) return false;
    return b.body.GetObjectLayer() !== L_GHOST;
  }

  private pose(part: number): { pos: Vec; rot: Q } {
    const p = this.m.parts[part]!;
    if (p.base < 0) return { pos: p.pos, rot: p.rot };
    const b = this.m.bodies[p.base]!.body;
    const x = b.GetPosition(), px = x.GetX(), py = x.GetY(), pz = x.GetZ();
    const r = b.GetRotation();
    return { pos: [px, py, pz], rot: [r.GetX(), r.GetY(), r.GetZ(), r.GetW()] };
  }

  // ---- region and proxies ----------------------------------------------------------------------------------

  /** The Matter-active region (metres): live-particle bounds (or emit points), containers and intakes, padded. */
  private activeRegion(): Float64Array | null {
    const s = this.s;
    const r = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    const grow = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad: number): void => {
      r[0] = Math.min(r[0]!, x0 - pad); r[1] = Math.min(r[1]!, y0 - pad); r[2] = Math.min(r[2]!, z0 - pad);
      r[3] = Math.max(r[3]!, x1 + pad); r[4] = Math.max(r[4]!, y1 + pad); r[5] = Math.max(r[5]!, z1 + pad);
    };
    const U = 1 / 65536;
    if (s.bounds.length === 6) grow(s.bounds[0]! * U, s.bounds[1]! * U, s.bounds[2]! * U, s.bounds[3]! * U, s.bounds[4]! * U, s.bounds[5]! * U, PAD);
    else if (s.emitBox.length === 6) {
      // no bounds from the backend: everything the grains could have reached, down to the floor
      const e = s.emitBox;
      grow(e[0]! * U, Math.min(e[1]! * U, 0), e[2]! * U, e[3]! * U, e[4]! * U, e[5]! * U, FALLBACK_PAD);
    }
    for (let k = 0; k < s.cont.length; k += CONT) this.growPart(s.cont[k]!, grow);
    for (let k = 0; k < s.intakes.length; k += 11) this.growPart(s.intakes[k]!, grow);
    if (this.region) grow(this.region.min[0]!, this.region.min[1]!, this.region.min[2]!, this.region.max[0]!, this.region.max[1]!, this.region.max[2]!, 0);
    return r[0]! <= r[3]! ? r : null;
  }

  private growPart(part: number, grow: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad: number) => void): void {
    if (!this.m.st.alive[part]) return;
    const p = this.m.parts[part]!;
    const { pos } = this.pose(part);
    const b = p.def.boundsFor ? p.def.boundsFor(p.props) : p.def.bounds;
    const rad = Math.sqrt(Math.max(b.min[0] ** 2, b.max[0] ** 2) + Math.max(b.min[1] ** 2, b.max[1] ** 2) + Math.max(b.min[2] ** 2, b.max[2] ** 2));
    grow(pos[0], pos[1], pos[2], pos[0], pos[1], pos[2], rad + PAD);
  }

  /** Local proxies for body `bi` from its part's shapes (null: no shape list for that role). */
  private localFor(bi: number): LocalProxy[] | null {
    const hit = this.local[bi];
    if (hit !== undefined) return hit;
    const b = this.m.bodies[bi]!;
    const p = this.m.parts[b.part]!;
    let list: LocalProxy[] | null = null;
    if ((b.role === 'base' || b.role === 'arm') && !p.def.critter) {
      const shapes = p.def.shapes(p.props).filter((s: ShapeDef) => (b.role === 'arm' ? s.on === 'arm' : (s.on ?? 'base') === 'base'));
      if (shapes.length) list = localProxies(shapes).slice(0, MAX_SUB);
    }
    this.local[bi] = list;
    return list;
  }

  /** Captures the dynamic-proxy snapshot S(t) into the ring. */
  private capture(t: number): void {
    const J = this.m;
    const region = this.activeRegion();
    const max = this.maxProxies;
    if (this.scratch.length < max * PROXY_STRIDE) this.scratch = new Int32Array(max * PROXY_STRIDE);
    const rec = this.scratch;
    let n = 0;
    const box = this.bodyBox;
    box[0] = Infinity; box[1] = Infinity; box[2] = -Infinity; box[3] = -Infinity;
    if (region) {
      for (let bi = 0; bi < J.bodies.length && n < max; bi++) {
        if (!this.pushable(bi)) continue;
        const b = J.bodies[bi]!.body;
        const x = b.GetPosition(), px = x.GetX(), py = x.GetY(), pz = x.GetZ();
        // cheap reject on the body origin plus its part's bounding radius
        const p = J.parts[J.bodies[bi]!.part]!;
        const bd = p.def.boundsFor ? p.def.boundsFor(p.props) : p.def.bounds;
        const rad = Math.max(Math.abs(bd.min[0]), Math.abs(bd.max[0]), Math.abs(bd.min[1]), Math.abs(bd.max[1]), Math.abs(bd.min[2]), Math.abs(bd.max[2])) * 1.8 + 0.05;
        if (px + rad < region[0]! || px - rad > region[3]! || py + rad < region[1]! || py - rad > region[4]! || pz + rad < region[2]! || pz - rad > region[5]!) continue;
        const r = b.GetRotation();
        const rot: Q = [r.GetX(), r.GetY(), r.GetZ(), r.GetW()];
        if (this.buoyant) {
          const wb = this.boundsOf(bi);
          box[0] = Math.min(box[0]!, wb[0]!); box[1] = Math.min(box[1]!, wb[2]!);
          box[2] = Math.max(box[2]!, wb[3]!); box[3] = Math.max(box[3]!, wb[5]!);
        }
        const lv = b.GetLinearVelocity(), v0: Vec = [lv.GetX(), lv.GetY(), lv.GetZ()];
        const av = b.GetAngularVelocity(), w: Vec = [av.GetX(), av.GetY(), av.GetZ()];
        const cm = b.GetCenterOfMassPosition(), com: Vec = [cm.GetX(), cm.GetY(), cm.GetZ()];
        const pos: Vec = [px, py, pz];
        const list = this.localFor(bi);
        const velAt = (c: Vec): Vec => { const rr = vcross(w, [c[0] - com[0], c[1] - com[1], c[2] - com[2]]); return [v0[0] + rr[0], v0[1] + rr[1], v0[2] + rr[2]]; };
        if (list) {
          for (let k = 0; k < list.length && n < max; k++) {
            const lp = list[k]!;
            const { c, q } = proxyWorld(pos, rot, lp);
            writeProxy(rec, n * PROXY_STRIDE, bi * MAX_SUB + k, lp.shape, true, c, q, lp.size, velAt(c), w, lp.at);
            n++;
          }
        } else {
          // critters, chunks, pieces: an axis-aligned box on the Jolt world bounds
          const bb = b.GetWorldSpaceBounds();
          const cc = bb.GetCenter(), c: Vec = [cc.GetX(), cc.GetY(), cc.GetZ()];
          const ee = bb.GetExtent(), e: Vec = [ee.GetX(), ee.GetY(), ee.GetZ()];
          const inv: Q = [-rot[0], -rot[1], -rot[2], rot[3]];
          const local = qrot(inv, [c[0] - px, c[1] - py, c[2] - pz]);
          writeProxy(rec, n * PROXY_STRIDE, bi * MAX_SUB, SHAPE_OBB, true, c, [0, 0, 0, 1], e, velAt(c), w, local);
          n++;
        }
      }
    }
    this.ring.push({ tick: t, rec: rec.slice(0, n * PROXY_STRIDE), n });
    while (this.ring.length > RING) this.ring.shift();
  }

  /** The newest snapshot at or before tick `t`, else the oldest held (the first commands after Matter starts). */
  private snapAt(t: number): Snap | null {
    let best: Snap | null = null;
    for (const s of this.ring) if (s.tick <= t) best = s;
    return best ?? this.ring[0] ?? null;
  }

  /** Static proxies: the floor plane, environment boxes and spheres, and static parts' shapes (built once). */
  private staticList(): { rec: Int32Array; n: number; box: Float64Array } {
    if (this.statics) return this.statics;
    const J = this.m;
    const items: { shape: number; c: Vec; q: Q; size: Vec; box: number[] }[] = [];
    for (const e of J.envBoxes) {
      const c: Vec = [e.center[0]!, e.center[1]!, e.center[2]!], h: Vec = [e.half[0]!, e.half[1]!, e.half[2]!];
      items.push({ shape: SHAPE_OBB, c, q: [0, 0, 0, 1], size: h, box: [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]] });
    }
    for (const e of J.envSpheres) {
      const c: Vec = [e.center[0]!, e.center[1]!, e.center[2]!], r = e.radius;
      items.push({ shape: SHAPE_SPHERE, c, q: [0, 0, 0, 1], size: [r, 0, 0], box: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r] });
    }
    J.parts.forEach((p, i) => {
      if (p.base < 0 || p.def.critter) return;
      const b = J.bodies[p.base]!;
      if (b.dynamic || b.ghost) return;
      const list = this.localFor(p.base);
      if (!list) return;
      for (const lp of list) {
        const { c, q } = proxyWorld(p.pos, p.rot, lp);
        const rr = Math.sqrt(lp.size[0] ** 2 + lp.size[1] ** 2 + lp.size[2] ** 2) + (lp.shape === 1 ? lp.size[0] : 0);
        items.push({ shape: lp.shape, c, q, size: lp.size, box: [c[0] - rr, c[1] - rr, c[2] - rr, c[0] + rr, c[1] + rr, c[2] + rr, i] });
      }
    });
    const rec = new Int32Array((items.length + 1) * PROXY_STRIDE);
    const box = new Float64Array((items.length + 1) * 7);
    // the floor plane first (always in): the sim's catch-all floor (y = 0; below the Hangar's deck and the Moon's
    // regolith, which are their own proxies), normal +Y
    writeProxy(rec, 0, STATIC_ID_BASE, SHAPE_PLANE, false, [0, this.floorTop, 0], [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]);
    box.set([-Infinity, -Infinity, -Infinity, Infinity, this.floorTop, Infinity, -1], 0);
    items.forEach((it, k) => {
      writeProxy(rec, (k + 1) * PROXY_STRIDE, STATIC_ID_BASE + k + 1, it.shape, false, it.c, it.q, it.size, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
      box.set([it.box[0]!, it.box[1]!, it.box[2]!, it.box[3]!, it.box[4]!, it.box[5]!, it.box[6] ?? -1], (k + 1) * 7);
    });
    this.statics = { rec, n: items.length + 1, box };
    return this.statics;
  }

  private command(N: number, t: number): MatterStepIn {
    const s = this.s, J = this.m;
    const snap = this.snapAt(t - 4);
    const dyn = snap ? toProxies(snap.rec, snap.n) : [];
    // statics inside the region (alive static parts only); ≤ maxProxies of them, floor first
    const st = this.staticList();
    const region = this.activeRegion();
    const statics: number[] = [];
    for (let k = 0; k < st.n && statics.length < this.maxProxies; k++) {
      const b = st.box.subarray(k * 7, k * 7 + 7);
      const part = b[6]!;
      if (part >= 0 && !J.st.alive[part]) continue;
      if (k > 0 && (!region || b[3]! < region[0]! || b[0]! > region[3]! || b[4]! < region[1]! || b[1]! > region[4]! || b[5]! < region[2]! || b[2]! > region[5]!)) continue;
      statics.push(k);
    }
    const sp = toProxies(st.rec, st.n);
    // the Moon's regolith under the active region (static tiles, cell order; after the set's own statics)
    const tiles: MatterProxy[] = this.terrain && region ? this.terrain.cover(region, Math.max(0, this.maxProxies - dyn.length - statics.length), TERRAIN_ID_BASE) : [];
    const proxies = [...dyn, ...statics.map((k) => sp[k]!), ...tiles];
    const emits: MatterEmit[] = [];
    for (let k = 0; k < s.emits.length; k += 11) {
      const e = s.emits;
      const seq = e[k + 10]!;
      emits.push({
        seq, kind: e[k + 1]! as MatterKind, count: e[k + 2]!, pos: Int32Array.of(e[k + 3]!, e[k + 4]!, e[k + 5]!), vel: Int32Array.of(e[k + 6]!, e[k + 7]!, e[k + 8]!),
        spread: e[k + 9]!, seed: fmix(J.seed[0] ^ fmix(seq + Math.imul(J.seed[1], 0x27d4eb2d))),
      });
    }
    s.emits = [];
    const intakes: MatterIntake[] = [];
    for (let k = 0, i = 0; k < s.intakes.length; k += 11, i++) {
      const part = s.intakes[k]!;
      if (!J.st.alive[part] || J.st.broken[part]) continue;
      const until = s.intakes[k + 9]!;
      if (until >= 0 && until < t - 1) continue; // a per-tick sensor nobody opened since the last command
      const slot = this.contOf.get(part);
      let cap = s.intakes[k + 8]!;
      const mask = s.intakes[k + 7]!;
      if (cap < 0) cap = 1 << 30; // the container handles its own overflow
      else if (slot !== undefined) {
        // room in mL -> grains of the most compact kind the intake takes (it can't take more than fits)
        let perMl = 0;
        for (let j = 0; j < KINDS; j++) if ((mask >> j) & 1) perMl = Math.max(perMl, PER_LITRE[j]! / 1000);
        const room = Math.floor(Math.max(0, s.cont[slot * 6 + 1]! - this.stored(part)) * perMl);
        cap = cap > 0 ? Math.min(cap, room) : room;
      }
      if (cap <= 0) continue;
      const { pos, rot } = this.pose(part);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 8; c++) {
        const l = [s.intakes[k + 1 + (c & 1 ? 3 : 0)]!, s.intakes[k + 2 + (c & 2 ? 3 : 0)]!, s.intakes[k + 3 + (c & 4 ? 3 : 0)]!];
        const w = qrot(rot, l);
        for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j]!, pos[j]! + w[j]!); hi[j] = Math.max(hi[j]!, pos[j]! + w[j]!); }
      }
      intakes.push({ id: i, min: Int32Array.of(mToU(lo[0]!), mToU(lo[1]!), mToU(lo[2]!)), max: Int32Array.of(mToU(hi[0]!), mToU(hi[1]!), mToU(hi[2]!)), kindMask: mask, capacity: cap });
    }
    // near() queries go out with this command; their parameters wait in st until the answer lands (rollback-safe)
    const queries: MatterQuery[] = [];
    for (let k = 0; k < s.queries.length; k += 5) queries.push({ id: k / 5, center: Int32Array.of(s.queries[k]!, s.queries[k + 1]!, s.queries[k + 2]!), radius: s.queries[k + 3]!, kindMask: s.queries[k + 4]! });
    if (queries.length) s.qflight.push([N, queries.length, ...s.queries]);
    s.queries = [];
    const blasts: MatterBlast[] = [];
    for (let k = 0; k < s.blasts.length; k += 5) blasts.push({ center: Int32Array.of(s.blasts[k]!, s.blasts[k + 1]!, s.blasts[k + 2]!), radius: s.blasts[k + 3]!, impulse: s.blasts[k + 4]! });
    s.blasts = [];
    // D101: the water-surface map around the bodies in this command, while there's water (or water on its way)
    const surface = this.buoyant && (s.counts[1]! > 0 || emits.some((e) => e.kind === 1)) ? surfaceRequest(this.bodyBox) : null;
    // the backend counts Matter ticks from the first command (it never saw the dormant ones)
    // D104: the world's gravity and its zones (an Earth world without zones sends exactly what M4 sent)
    return {
      tick: N - s.first, proxies, emits, intakes, blasts, ...(queries.length ? { queries } : {}), ...(surface ? { surface } : {}),
      ...(this.g8 !== EARTH_Q8 ? { gravity: this.g8 } : {}), ...(this.zones.length ? { zones: this.zones } : {}),
    };
  }

  // ---- checkpoints, rollback, hashing -------------------------------------------------------------------------

  /**
   * The Matter record for a checkpoint at rigid tick T (after Machine.step finished tick T − 1), or undefined when
   * this checkpoint gets none. Records are taken every `checkpointEvery` ticks while Matter is active.
   */
  checkpoint(T: number): MatterCp | undefined {
    if (!this.active || T % this.every !== 0) return undefined;
    const s = this.s;
    const early: MatterStepOut[] = [];
    if (s.first >= 0) {
      // the results computed but not applied yet must travel with the snapshot (they can't be recomputed after it)
      for (const N of [T / 2 - 2, T / 2 - 1]) {
        if (N < s.first || N <= s.applied) continue;
        let out = this.early.get(N);
        if (!out) { out = this.link!.take(N - s.first); this.early.set(N, out); }
        early.push(out);
      }
    }
    const cp: MatterCp = { tick: T, ref: this.link!.snapshot(), early, snaps: this.ring.slice() };
    this.live.push(cp);
    while (this.live.length > this.keep) this.release(this.live.shift());
    return cp;
  }

  /** Can a checkpoint with this record be restored? (Always, while Matter is off.) */
  usable(cp: MatterCp | undefined): boolean {
    return !this.active || (!!cp && cp.ref !== null);
  }

  /** Forgets a record's snapshot (its checkpoint was dropped, or it fell out of the snapshot budget). */
  release(cp: MatterCp | undefined): void {
    if (!cp || !cp.ref) return;
    this.link?.release(cp.ref);
    cp.ref = null;
    const i = this.live.indexOf(cp);
    if (i >= 0) this.live.splice(i, 1);
  }

  /** After the Machine restored a checkpoint (st already replaced): the backend, pending results and proxy ring. */
  afterRestore(cp: MatterCp | undefined): void {
    if (!this.active) return;
    if (!cp || !cp.ref) throw new Error('matter: restoring a checkpoint without a Matter snapshot');
    this.link!.meta?.(this.s.first);
    this.link!.restore(cp.ref);
    this.early = new Map(cp.early.map((o) => [o.tick + this.s.first, o])); // backend ticks count from the first command
    this.ring = cp.snaps.slice();
    // records newer than the restored checkpoint describe a future that no longer happens
    for (const r of [...this.live]) if (r.tick > cp.tick) this.release(r);
  }

  /** SIMULATION §10.4: the Matter checksum, live counts and container contents. */
  hash(h: Hasher): void {
    if (!this.active) return;
    const s = this.s;
    h.u32(s.sum[0]! >>> 0).u32(s.sum[1]! >>> 0);
    for (let j = 0; j < 3; j++) h.u32(s.counts[j]! >>> 0);
    // X5: goo joins the hash only where there is goo, so Matter worlds without it hash as in M4
    if (s.counts[3]) h.u32(0x676f6f).u32(s.counts[3] >>> 0);
    for (let k = 0; k < s.cont.length; k += CONT) {
      h.u32(s.cont[k + 2]!).u32(s.cont[k + 3]!).u32(s.cont[k + 4]!);
      if (s.cont[k + 6]) h.u32(0x676f6f).u32(s.cont[k + 6]!);
    }
    h.i32(s.first);
    for (const v of s.answers) h.i32(v);
    // D101: the surface map (only once there is one, so Matter worlds without water hash as before)
    if (s.surf?.length) { h.u32(s.surf.length); for (const v of s.surf) h.i32(v); }
  }

  /** Fill per part (part order) for keyframes; parts that aren't containers read 0. */
  fills(out: Float32Array): Float32Array {
    out.fill(0);
    if (!this.active) return out;
    for (const [part] of this.contOf) out[part] = f32(this.fill(part));
    return out;
  }

  /** The record's snapshot bytes (desync export). */
  snapshotBytes(cp: MatterCp): Uint8Array {
    if (!cp.ref) throw new Error('matter: that checkpoint has no Matter snapshot');
    return this.link!.bytes(cp.ref);
  }

  /** A record from adopted bytes (desync import). */
  adopt(tick: number, bytes: Uint8Array, early: readonly MatterStepOut[], snaps: readonly Snap[]): MatterCp {
    const cp: MatterCp = { tick, ref: { id: -1, bytes }, early, snaps };
    this.live.push(cp);
    return cp;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const r of [...this.live]) this.release(r);
    this.link?.destroy();
    if (this.jv) { for (const v of Object.values(this.jv)) this.m.Jolt.destroy(v); this.jv = null; }
  }
}

function addDiag(m: Map<number, [number, number, number]>, bi: number, x: number, y: number, z: number): void {
  const a = m.get(bi) ?? [0, 0, 0];
  a[0] += x; a[1] += y; a[2] += z;
  m.set(bi, a);
}

/** Stored volume in mL (SIMULATION §8.1 particle sizes: sand ≈ 18,000 / L, water 1,000 / L, marbles ≈ 290 / L, goo ≈ 470 / L). */
export function volumeMl(sand: number, water: number, marbles: number, goo = 0): number {
  return (sand * 1000) / PER_LITRE[0] + water + (marbles * 1000) / PER_LITRE[2] + (goo ? (goo * 1000) / PER_LITRE[3] : 0);
}

/** Offset of proxy `id`'s record in a snapshot (records are in ascending id order), or −1. */
function findRec(s: Snap, id: number): number {
  let lo = 0, hi = s.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = s.rec[mid * PROXY_STRIDE]!;
    if (v === id) return mid * PROXY_STRIDE;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/** Half the vertical extent (metres) of the proxy record at `o`, on its snapshot orientation. */
function proxyHalfHeight(rec: Int32Array, o: number): number {
  const U = 1 / 65536, Q = 1 / 16384;
  const x = rec[o + 6]! * Q, y = rec[o + 7]! * Q, z = rec[o + 8]! * Q, w = rec[o + 9]! * Q;
  // row Y of the rotation matrix: how much of each local axis points up
  const r0 = Math.abs(2 * (x * y + z * w)), r1 = Math.abs(1 - 2 * (x * x + z * z)), r2 = Math.abs(2 * (y * z - x * w));
  const a = rec[o + 10]! * U, b = rec[o + 11]! * U, c = rec[o + 12]! * U;
  const shape = rec[o + 1]!;
  if (shape === SHAPE_SPHERE) return a;
  if (shape === SHAPE_OBB) return r0 * a + r1 * b + r2 * c;
  return a + r1 * b; // capsule: radius, half length along local Y
}

export type { Snap as MatterSnap };
