// M5 parts (stream A5 · Future Tech parts): run state, build-time bodies and the per-stage dispatch for the 10 non-Matter
// Ship = M5 catalogue rows. PartChannels (index.ts) owns one `M5Parts` and calls it from the same Machine hooks as the
// M2–M4 parts:
//
//   m5_field.ts    GRAV WELL, TRACTOR BEAM, COILGUN RING, STASIS FIELD, SINGULARITY pull (stage 6, end)
//   m5_rift.ts     RIFT GATES (stage 12 transits, in part order, per-pair cooldown)
//   m5_misc.ts     FORCE WALL (layer switch), HOVER PAD (spring-damper), BUZZ BEACON (calls, dock pose),
//                  SINGULARITY lifecycle and despawns (stage 12)
//   m5_grabber.ts  GRABBER (deterministic IK playback of kinematic links)
//
// Fields act on rigid bodies only (D102), found through A3's `eachPushable` minus run-time ghosts (`eachLive`,
// m5_field.ts), so a dormant, hidden, carried, ghost or kinematic body is never pushed (rule 8).
//
// Determinism (SIMULATION §10): part order everywhere, detmath only, all run state in `st.m2.m5` (plain data:
// checkpoints, rollback and desync repair carry it). State Jolt doesn't save is re-derived from it in afterRestore (M5
// rule 14): FORCE WALL field layers and HOVER PAD rotation-lock enables. Every other mechanism (STASIS, the fields,
// transits, the GRABBER's kinematic links and held body) works through velocities and forces each tick, which Jolt's
// state does record.

import { type Hasher } from '@knockon/detmath';
import { M5_TYPES } from '@knockon/parts-data';
import type { JoltModule } from '@knockon/jolt';
import type { Host } from './host.ts';
import type { PartChannels } from './index.ts';
import { fieldFlags, fieldMeter, fields } from './m5_field.ts';
import { buildGrabber, grabberBehave, grabberFlags, grabberInit, grabberJoints, grabberSignal } from './m5_grabber.ts';
import { beaconView, buildHover, buildWall, hoverLock, miscBehave, miscFlags, miscMeter, miscSignal, miscSpawn, wallLayer, type BeaconView } from './m5_misc.ts';
import { riftFlags, riftInit, riftSpawn } from './m5_rift.ts';

export { M5_TYPES, type BeaconView };

/** GRABBER state stride in `M5State.arm` (m5_grabber.ts). */
export const ARM_STRIDE = 15; // PARTSIM (D120): + the finger opening, its target and zone A's surface

/** M5 run state (stream A5). Per-part arrays are in part order. */
export interface M5State {
  /** Per part: main state (FORCE WALL up; STASIS engaged; SINGULARITY 0 idle / 1 active / 2 spent; field active flags). */
  on: number[];
  /** Per part: a start tick (SINGULARITY armed; −1). */
  t0: number[];
  /** Per part: a value (HOVER PAD setpoint height above its base point; COILGUN RING charge 0–1). */
  val: number[];
  /** Per part: a second value (HOVER PAD load estimate kg; TRACTOR BEAM load kg). */
  val2: number[];
  /** Per part: a counter (SINGULARITY swallowed; GRABBER queued cycles; BUZZ BEACON calls). */
  n: number[];
  /** Per part: the event that set the current action going (−1). */
  cause: number[];
  /** Per part: BUZZ BEACON status written by BUZZ (0 none, 1 docked, 2 away); COILGUN RING overload flag. */
  aux: number[];
  /** Per part: RIFT GATES cooldown-until tick (shared by both gates of a pair); BUZZ BEACON latest call tick (−1). */
  cd: number[];
  /** Per part: body indices inside last tick (COILGUN bore passes, STASIS frozen set, TRACTOR captured set), ascending. */
  inside: number[][];
  /** GRABBER playback state, ARM_STRIDE numbers per GRABBER (list order). */
  arm: number[];
}

declare module './host.ts' {
  interface M2State {
    /** M5 parts (stream A5): created by M5Parts.init when the machine has an M5 part. */
    m5?: M5State;
  }
}

export class M5Parts {
  readonly c: PartChannels;
  /** True once any M5 part is in the machine: gates the M5 hash block and every hook. */
  active = false;
  /** FORCE WALL part → its field body (static, switched between the static and ghost layers), −1. */
  readonly wall: number[] = [];
  /** GRABBER part → its link bodies (kinematic: upper arm, forearm, gripper), and its slot in `arm` (−1). */
  readonly links: number[][] = [];
  readonly armSlot: number[] = [];
  /** HOVER PAD part → its rotation-lock constraint (enabled while powered). */
  readonly hoverC: (JoltModule | null)[] = [];
  /** RIFT GATE part → its partner gate (−1 unpaired). Pairs come from the `pair` props (static), so this isn't state. */
  readonly partner: number[] = [];
  /** Reused Jolt values (Jolt copies arguments). */
  readonly va: JoltModule;
  readonly vb: JoltModule;

  constructor(c: PartChannels) {
    this.c = c;
    const J = c.h.Jolt;
    this.va = new J.Vec3(0, 0, 0);
    this.vb = new J.Vec3(0, 0, 0);
  }

  get h(): Host { return this.c.h; }
  get st(): M5State { return this.c.h.st.m2.m5!; }

  // ---- building (before `st` exists) ------------------------------------------------------------------------------

  /** After the Machine built part `i` (base) and the M3 / M4 builders: FORCE WALL field, GRABBER links. */
  onBuild(i: number): void {
    const def = this.h.parts[i]!.def;
    this.wall[i] = -1;
    this.links[i] = [];
    this.armSlot[i] = -1;
    this.partner[i] = -1;
    this.hoverC[i] = null;
    if (!M5_TYPES.has(def.type)) return;
    this.active = true;
    if (def.type === 'force_wall') this.wall[i] = buildWall(this, i);
    if (def.type === 'hover_pad' && this.h.bodies[this.h.parts[i]!.base]!.dynamic) buildHover(this, i);
    if (def.type === 'grabber') buildGrabber(this, i);
  }

  // ---- run state ----------------------------------------------------------------------------------------------

  /** After `st` exists: M5 state, rift pairs, wall layers, grabber poses. */
  init(): void {
    if (!this.active) return;
    const h = this.h, n = h.parts.length;
    const z = (): number[] => new Array<number>(n).fill(0), neg = (): number[] => new Array<number>(n).fill(-1);
    h.st.m2.m5 = { on: z(), t0: neg(), val: z(), val2: z(), n: z(), cause: neg(), aux: z(), cd: neg(), inside: Array.from({ length: n }, () => []), arm: [] };
    for (const i of this.c.list('force_wall')) { this.st.on[i] = (h.parts[i]!.props.start ?? 1) === 1 ? 1 : 0; wallLayer(this, i); }
    riftInit(this);
    grabberInit(this);
  }

  // ---- stages ---------------------------------------------------------------------------------------------------

  /** Stage 2: a Signal reached part `i`. Returns true if it was an M5 part. */
  signal(i: number, port: string, cause: number): boolean {
    if (!this.active || !M5_TYPES.has(this.h.parts[i]!.def.type)) return false;
    miscSignal(this, i, port, cause) || grabberSignal(this, i, port, cause);
    return true;
  }

  /** Stage 6 for part `i` (HOVER PAD, GRABBER, COILGUN RING charge, SINGULARITY clock). Returns true if it was an M5 part. */
  behave(i: number): boolean {
    if (!this.active || !M5_TYPES.has(this.h.parts[i]!.def.type)) return false;
    miscBehave(this, i) || grabberBehave(this, i);
    return true;
  }

  /** End of stage 6, after the M3 fields: the M5 fields. */
  fields(): void { if (this.active) fields(this); }

  /** Stage 12: SINGULARITY despawns, then RIFT GATES transits (SIMULATION §2: removals, then teleports). */
  spawn(t: number): void {
    if (!this.active) return;
    miscSpawn(this, t);
    riftSpawn(this, t);
  }

  /** After a checkpoint restore: FORCE WALL field layers, HOVER PAD lock enables (Jolt's saved state records neither). */
  afterRestore(): void {
    if (!this.active) return;
    for (const i of this.c.list('force_wall')) wallLayer(this, i);
    for (const i of this.c.list('hover_pad')) hoverLock(this, i, false); // PARTSIM: no wake on restore (SIMFIX audit)
  }

  hash(hs: Hasher): void {
    if (!this.active) return;
    const s = this.st;
    hs.u32(0x4d35).u32(s.on.length);
    for (let i = 0; i < s.on.length; i++) {
      hs.i32(s.on[i]!).i32(s.t0[i]!).q(s.val[i]!, 1e-5).q(s.val2[i]!, 1e-4).i32(s.n[i]!).i32(s.aux[i]!).i32(s.cd[i]!);
      const inside = s.inside[i]!;
      hs.u32(inside.length);
      for (const k of inside) hs.i32(k);
    }
    hs.u32(s.arm.length);
    for (const x of s.arm) hs.q(x, 1e-6);
  }

  /** Renderer / audio flags (PartFlagBits) for M5 parts. */
  flags(i: number): number {
    if (!this.active || !M5_TYPES.has(this.h.parts[i]!.def.type)) return 0;
    return fieldFlags(this, i) | miscFlags(this, i) | riftFlags(this, i) | grabberFlags(this, i);
  }

  /** Screen readouts (Machine.partMeters): COILGUN RING charge, HOVER PAD load, TRACTOR BEAM load, SINGULARITY countdown. */
  meter(i: number): number {
    if (!this.active || !M5_TYPES.has(this.h.parts[i]!.def.type)) return 0;
    return fieldMeter(this, i) || miscMeter(this, i);
  }

  // ---- read-only outputs and the BUZZ interface (contract 3, docs/dev/M5_NOTES_A5.md) ----------------------------

  /** BUZZ BEACON part indices, part order. */
  beacons(): readonly number[] { return this.c.list('buzz_beacon'); }
  /** A beacon's dock pose, calls and pad state for BUZZ (B5), or null if `i` isn't a live beacon. */
  beacon(i: number): BeaconView | null { return this.active ? beaconView(this, i) : null; }
  /** BUZZ (B5) reports its state each tick: 1 docked, 2 away (0 none). Plain state: rollback-safe. Drives the beacon's flags. */
  setBeaconStatus(i: number, s: number): void {
    if (!this.active || this.h.parts[i]?.def.type !== 'buzz_beacon') return;
    this.st.aux[i] = s;
  }

  /**
   * GRABBER joint angles for the renderer (PIVOT__yaw, shoulder, elbow, wrist_pitch, wrist_roll, finger_l/r): 8 floats per
   * GRABBER, part order: [part index, yaw, shoulder, elbow, wrist pitch, wrist roll (rad), finger opening (m, each side), held 0/1].
   */
  joints(): Float32Array { return this.active ? grabberJoints(this) : new Float32Array(0); }

}
