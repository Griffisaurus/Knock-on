// Critter AI, locomotion and ragdolls (SIMULATION §7), and the critter-bound devices (HAMSTER DRIVE,
// PEDAL RIG, FISHBOWL, TRAP BOX). Stream B, M2.
//
// The Machine owns the tick pipeline and calls in through narrow hooks:
//   build      buildCritter(part) while parts are built (id order), init() once the world exists
//   stage 6    preStep(t): devices, then each critter acts every tick and thinks every 4 ticks,
//              staggered by partId mod 4 (SIMULATION §7.1)
//   stage 8    contact(...) from the contact listener: buffers hits on watched bodies (max per tick, so
//              callback order never matters)
//   stage 9+   postContacts(t): ragdoll triggers, bumps, breaks, ragdoll follow/recover, trap checks
//   stage 11   blast(...) per part inside a detonation (stage 6 also hears stream A's soundsThisTick)
//   restore    afterRestore(): object layers, gravity and joint enables (Jolt doesn't record them)
//
// Bodies are never created or destroyed during a run (D66): every critter owns a locomotion capsule
// (role 'base', an upright dynamic body: rotation locked about X and Z) and its ragdoll capsules (role
// 'rag', one per `RAG__` bone), created dormant on the ghost layer with the world. Ragdolling moves the
// capsules to the canonical rest pose around the critter, transfers its velocity, enables the
// swing-twist joints and puts them on the moving layer; recovery puts them back to sleep.
//
// All run state is plain data in `st.crit` (state.ts); this object only holds build-time wiring.
//
// M4 (stream B4): BISCUIT, HENNY and DUSTY live in m4.ts, which reaches into this class (its members are public
// for that reason only; nothing outside critters/ uses them): species dispatch in think/act/finish, HENNY's YOLK
// pool (pre-built dormant bodies, D66), DUSTY's disc body, rigid tumble and Matter intake, BISCUIT's barge.
//
// M5 (stream B5): BUZZ lives in m5.ts (M5Critters), dispatched the same way: its drone body (box + ducts + skids), its
// rigid box tumble, flight gravity in afterRestore, its carry under the claw, A5's beacons through `CritterHost.beacons`.

import { Rng, datan2, dcos, dlog, dpow, dsin, f32, stream } from '@knockon/detmath';
import type { JoltModule } from '@knockon/jolt';
import {
  BANDIT_PROP_R, CRITTER_CLIPS, CRITTER_EMOTES, CRITTER_FSM, CritterFlagBits, DEVICE_SPECS, DeviceFlagBits, RIFT, SHINY_MAX_KG, lureOf,
  type CritterClip, type CritterEmote, type CritterFsm, type CritterSpec, type PartDef, type Props, type ShapeDef,
} from '@knockon/parts-data';
import type { Hasher } from '@knockon/detmath';
import { qmul, qrot, vadd, vcross, vdot, vlen, vnorm, vscale, vsub, type Q, type Vec } from '../vec.ts';
import { hashCritWorld, type CritSt, type CritWorld, type DevSt } from './state.ts';
import { M4Critters, isM4, type CritterMatter } from './m4.ts';
import { M5Critters, isM5, type BeaconHost } from './m5.ts'; // M5 (B5): BUZZ

// ---- host interface (what the Machine lends the critter system) --------------------------------------

export interface CritterBodyRt { readonly part: number; readonly role: string; readonly body: JoltModule; readonly dynamic: boolean; readonly ghost: boolean; readonly bone?: string }
export interface CritterPartRt {
  readonly id: number;
  readonly def: PartDef;
  readonly props: Props;
  readonly pos: readonly number[];
  readonly rot: readonly number[];
  base: number;
  arm: number;
  readonly hinge: JoltModule | null;
  /** M5 (B5): the snapshot's PartFlag bits (BUZZ reads PartFlag.Tagged). */
  readonly flags?: number;
}
export interface CritterHostState {
  readonly tick: number;
  readonly alive: boolean[];
  readonly broken: boolean[];
  readonly pressed: number[];
  /** Power supply factor per part (stage 3): DUSTY on its charge leash. */
  readonly supply: number[];
  crit: CritWorld;
}
/** A Sound this tick: level (dB at 1 m), where, and the part that made it (−1 unknown). */
export interface SoundIn { readonly pos: readonly number[]; readonly dB: number; readonly part: number; readonly cause: number }
export interface LineIn { readonly a: number; readonly aPort: string; readonly b: number; readonly bPort: string; readonly cut: boolean }
export type CritterEventKind = 'CritterState' | 'Emote' | 'Ragdoll' | 'Getup' | 'Trapped' | 'Break' | 'Splash'
  // M4 (B4): Bark (BISCUIT: mag = dB; the cause of its Sound), Lay (HENNY lays a YOLK: mag = egg number), Splat (a laid
  // YOLK breaks: mag = J)
  | 'Bark' | 'Lay' | 'Splat'
  // M5 (B5): Fetch (BUZZ's claw closes on an item: mag = kg, other = the item), Deliver (BUZZ lets an item go on its
  // beacon's pad: mag = seconds since the call, other = the item)
  | 'Fetch' | 'Deliver';

/** A test/soak-only Lure (MachineOptions.extraLures): a placed part made a lure, or a bodiless one at `pos`. */
export interface ExtraLure {
  readonly part?: number;
  readonly pos?: readonly [number, number, number];
  readonly radius: number;
  readonly species: Readonly<Record<string, number>>;
}

export interface CritterHost {
  /** Extra lures for this run, with part indices (−1 = bodiless at `pos`). */
  extraLures(): readonly { readonly part: number; readonly pos: readonly number[] | null; readonly radius: number; readonly species: Readonly<Record<string, number>> }[];
  readonly J: JoltModule;
  readonly jolt: JoltModule;
  readonly system: JoltModule;
  readonly bi: JoltModule;
  readonly bodies: CritterBodyRt[];
  readonly parts: readonly CritterPartRt[];
  readonly tickRate: number;
  readonly seed: readonly [number, number];
  readonly layers: { readonly static: number; readonly moving: number; readonly ghost: number };
  st(): CritterHostState;
  /** Emits an event (part / other are part indices) and returns its id (contract 1). */
  emit(kind: CritterEventKind, part: number, pos: readonly number[], mag: number, other?: number, cause?: number): number;
  /** A part's last causing event id (SIMULATION §9), -1 none. */
  cause(part: number): number;
  /** Sounds made this tick (SIMULATION §5.10): level in dB at 1 m. */
  sounds(): readonly SoundIn[];
  lines(): readonly LineIn[];
  /** Re-applies a part's alive/broken body state (object layers, gravity). */
  applyAlive(part: number): void;
  /** Puts a breakable's pre-built fracture chunks into play (Machine.shatter); false if it has none. */
  shatter(part: number): boolean;
  // ---- M4 (B4) ----
  /** The Machine's shape builder (ShapeDef list → cached Jolt shape): HENNY's YOLK pool uses the YOLK def's shapes. */
  shapeFor(key: string, shapes: readonly ShapeDef[]): JoltModule;
  /** Sound channel (SIMULATION §5.10): BISCUIT's bark. Returns the Sound event id. */
  sound(pos: readonly number[], dB: number, part: number, cause: number): number;
  /** Is any power cable linked to this part (DUSTY's charge leash)? */
  powerLinked(part: number): boolean;
  /** `machine.matter` (M4_PLAN contract 2), or null before the Machine has one. */
  matter(): CritterMatter | null;
  // ---- M5 (B5) ----
  /** A5's BUZZ BEACON channel (M5_NOTES_A5 contract 3), or null before it exists. */
  beacons?(): BeaconHost | null;
  /** A RIFT GATE's partner gate (A5's pairing), −1 unpaired or not a gate: critters walk into a paired gate's aperture. */
  riftPartner?(part: number): number;
}

/**
 * M5 (B5): a critter that may be arriving at a RIFT GATE (A5's m5_rift.ts, stage 12). Free critters are tested by their
 * locomotion capsule, ragdolled ones by their root capsule: centre (world), velocity, unit axis, cylinder half-length,
 * radius. Robots (DUSTY's disc, BUZZ's drone) never appear: they're wider than the aperture and bounce off the frame.
 */
export interface RiftCritter {
  readonly k: number;
  readonly part: number;
  readonly at: Vec;
  readonly v: Vec;
  readonly axis: Vec;
  readonly halfLen: number;
  readonly radius: number;
}

// ---- tables -------------------------------------------------------------------------------------------

const F = Object.fromEntries(CRITTER_FSM.map((s, i) => [s, i])) as Record<CritterFsm, number>;
const CL = Object.fromEntries(CRITTER_CLIPS.map((s, i) => [s, i])) as Record<CritterClip, number>;
const EM = Object.fromEntries(CRITTER_EMOTES.map((s, i) => [s, i])) as Record<CritterEmote, number>;

type DeviceKind = keyof typeof DEVICE_SPECS;
const HD = DEVICE_SPECS.hamster_drive, PR = DEVICE_SPECS.pedal_rig, FB = DEVICE_SPECS.fishbowl, TB = DEVICE_SPECS.trap_box;

const THINK_EVERY = 4;
const RAG_STILL_SPEED = 0.1;   // m/s, mean root speed over 1 s that counts as settled (SIMULATION §7.4)
const RAG_FORCE_S = 8;         // a ragdoll that never settles (on a spinning wheel…) recovers anyway
const SAFE_LANDING = 4;        // m/s: closing speed against static geometry a critter lands without tumbling
const TOUCH_STARTLE = 2;       // N·s (SIMULATION §7.2)
const LEASH = 5;               // m: how far from home a critter flees, chases or hides loot
const MAX_DV = 8;              // m/s blast speed cap (D53)
const LN10 = 2.302585092994046;
const DOF_UPRIGHT_BITS = ['EAllowedDOFs_TranslationX', 'EAllowedDOFs_TranslationY', 'EAllowedDOFs_TranslationZ', 'EAllowedDOFs_RotationY'] as const;

interface CritRt {
  readonly part: number;
  readonly spec: CritterSpec;
  readonly base: number;
  readonly rags: readonly number[];
  readonly joints: readonly JoltModule[];
  readonly ignoreSelf: JoltModule;
}
interface DevRt { readonly part: number; readonly kind: DeviceKind }
interface LureRt { readonly part: number; readonly species: Readonly<Record<string, number>>; readonly radius: number; readonly shiny: boolean }

const yawOf = (q: readonly number[]): number => { const f = qrot(q, [0, 0, 1]); return datan2(f[0], f[2]); };
const yawQ = (y: number): Q => [0, dsin(y / 2), 0, dcos(y / 2)];
const wrapPi = (a: number): number => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const log10 = (x: number): number => dlog(x) / LN10;
const hlen = (v: readonly number[]): number => Math.sqrt(v[0]! * v[0]! + v[2]! * v[2]!);

export class CritterSystem {
  readonly h: CritterHost;
  readonly crits: CritRt[] = [];
  readonly devs: DevRt[] = [];
  lures: LureRt[] = [];
  /** Bodiless extra lures: lure key parts.length + n sits at fixed[n]. */
  fixed: Vec[] = [];
  critOfPart: Int32Array = new Int32Array(0);
  devOfPart: Int32Array = new Int32Array(0);
  bodyCrit: Int32Array = new Int32Array(0);
  bodyDev: Int32Array = new Int32Array(0);
  readonly shapeCache = new Map<string, JoltModule>();
  /**
   * Parts a carry has ever ghosted (never checkpointed, only grows): afterRestore un-ghosts those not
   * carried at the restored tick, since Jolt's state doesn't record object layers or gravity factors.
   */
  readonly everCarried = new Set<number>();
  // per-tick contact accumulators (transient: rebuilt every tick, never checkpointed)
  tHit = new Float64Array(0);
  tHitDir = new Float64Array(0);
  tTouch = new Float64Array(0);
  tPounce = new Int32Array(0);
  tHitPart = new Int32Array(0);
  dBump = new Float64Array(0);
  dBumpDir = new Float64Array(0);
  // reused Jolt scratch objects (Jolt copies arguments)
  v3a: JoltModule = null;
  v3b: JoltModule = null;
  r3: JoltModule = null;
  q4: JoltModule = null;
  ray: { settings: JoltModule; col: JoltModule; bp: JoltModule; all: JoltModule; statics: JoltModule; anyBody: JoltModule; shapes: JoltModule } | null = null;
  /** M4 (B4): BISCUIT, HENNY, DUSTY (m4.ts). */
  readonly m4: M4Critters;
  /** M5 (B5): BUZZ (m5.ts). */
  readonly m5: M5Critters;

  constructor(host: CritterHost) {
    this.h = host;
    this.m4 = new M4Critters(this);
    this.m5 = new M5Critters(this);
    const J = host.J;
    this.v3a = new J.Vec3(0, 0, 0);
    this.v3b = new J.Vec3(0, 0, 0);
    this.r3 = new J.RVec3(0, 0, 0);
    this.q4 = new J.Quat(0, 0, 0, 1);
  }

  get count(): number { return this.crits.length; }
  get st(): CritterHostState { return this.h.st(); }
  get w(): CritWorld { return this.h.st().crit; }

  /** Critter and device part types this system builds or drives. */
  static owns(def: PartDef): boolean { return !!def.critter; }

  // ---- building -----------------------------------------------------------------------------------------

  vec(x: number, y: number, z: number): JoltModule { this.v3a.Set(f32(x), f32(y), f32(z)); return this.v3a; }
  vec2(x: number, y: number, z: number): JoltModule { this.v3b.Set(f32(x), f32(y), f32(z)); return this.v3b; }
  rvec(p: readonly number[]): JoltModule { this.r3.Set(f32(p[0]!), f32(p[1]!), f32(p[2]!)); return this.r3; }
  quat(q: readonly number[]): JoltModule { this.q4.Set(f32(q[0]!), f32(q[1]!), f32(q[2]!), f32(q[3]!)); return this.q4; }

  shapeOf(key: string, make: () => JoltModule): JoltModule {
    let s = this.shapeCache.get(key);
    if (!s) { s = make(); this.shapeCache.set(key, s); }
    return s;
  }

  createBody(shape: JoltModule, pos: readonly number[], rot: readonly number[], o: {
    part: number; role: 'base' | 'rag' | 'piece'; bone?: string; layer: number; mass: number; friction: number; restitution: number;
    gravity: number; ccd: boolean; group: JoltModule; groupId: number; sub: number; activate: boolean; upright?: boolean;
    /** M4 (B4): linear and angular damping (DUSTY's rigid tumble, so a disc rolling on its rim settles). */
    damping?: readonly [number, number];
  }): number {
    const J = this.h.J;
    // Jolt copies value arguments, so the scratch vectors are reused (nothing leaks per body)
    const cs = new J.BodyCreationSettings(shape, this.rvec(pos), this.quat(rot), J.EMotionType_Dynamic, o.layer);
    cs.mFriction = f32(o.friction);
    cs.mRestitution = f32(o.restitution);
    cs.mGravityFactor = f32(o.gravity);
    cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    cs.mMassPropertiesOverride.mMass = f32(o.mass);
    if (o.upright) cs.mAllowedDOFs = DOF_UPRIGHT_BITS.reduce((m, k) => m | (J[k] as number), 0);
    if (o.ccd) cs.mMotionQuality = J.EMotionQuality_LinearCast;
    if (o.damping) { cs.mLinearDamping = f32(o.damping[0]); cs.mAngularDamping = f32(o.damping[1]); }
    const group = new J.CollisionGroup(o.group, o.groupId, o.sub);
    cs.mCollisionGroup = group; // copied (the filter is ref-counted, so the body keeps it alive)
    J.destroy(group);
    const index = this.h.bodies.length;
    cs.mUserData = index;
    const body = this.h.bi.CreateBody(cs);
    J.destroy(cs);
    this.h.bi.AddBody(body.GetID(), o.activate ? J.EActivation_Activate : J.EActivation_DontActivate);
    this.h.bodies.push({ part: o.part, role: o.role, body, dynamic: true, ghost: false, ...(o.bone ? { bone: o.bone } : {}) });
    return index;
  }

  /**
   * Builds a critter's bodies (called by the Machine from buildPart, in part order): the upright
   * locomotion capsule (role 'base') and its dormant ragdoll capsules (role 'rag') with disabled joints.
   */
  buildCritter(partIndex: number): void {
    const J = this.h.J, L = this.h.layers;
    const p = this.h.parts[partIndex]!;
    const spec = p.def.critter!;
    const yaw = yawOf(p.rot);
    const yq = yawQ(yaw);
    const nb = spec.ragdoll.length;
    // M4 (B4): HENNY's YOLK pool joins her group (subs nb + 1 …): a fresh egg never hits her, eggs still hit each other
    const pool = this.m4.poolSize(spec.species, p.props);
    // one collision group per critter: its capsules never collide with each other
    const group = new J.GroupFilterTable(nb + 1 + pool);
    for (let a = 0; a <= nb; a++) for (let b = a + 1; b <= nb + pool; b++) group.DisableCollision(a, b);
    const groupId = partIndex;
    const cap = spec.capsule;
    const shape = this.shapeOf(`critter:${spec.species}`, () => {
      const cs = new J.StaticCompoundShapeSettings();
      const h = Math.SQRT1_2;
      const disc = spec.disc;
      const drone = spec.drone;
      if (drone) {
        // M5 (B5): BUZZ's COL__box__0 body, COL__cylinder__1..4 ducts (upright), COL__box__5 skids
        const box = (size: readonly number[], at: readonly number[]): void => {
          cs.AddShape(new J.Vec3(f32(at[0]!), f32(at[1]!), f32(at[2]!)), new J.Quat(0, 0, 0, 1),
            new J.BoxShapeSettings(new J.Vec3(f32(size[0]! / 2), f32(size[1]! / 2), f32(size[2]! / 2)), f32(0.004)), 0);
        };
        box(drone.body.size, drone.body.at);
        for (const at of drone.ducts.at) {
          cs.AddShape(new J.Vec3(f32(at[0]), f32(at[1]), f32(at[2])), new J.Quat(0, 0, 0, 1),
            new J.CylinderShapeSettings(f32(drone.ducts.height / 2), f32(drone.ducts.radius), f32(0.004)), 0);
        }
        box(drone.skids.size, drone.skids.at);
      } else if (disc) {
        // M4 (B4): a robot's upright disc (DUSTY's COL__cylinder__0)
        cs.AddShape(new J.Vec3(f32(disc.at[0]), f32(disc.at[1]), f32(disc.at[2])), new J.Quat(0, 0, 0, 1),
          new J.CylinderShapeSettings(f32(disc.height / 2), f32(disc.radius), f32(0.004)), 0);
      } else {
        cs.AddShape(new J.Vec3(f32(cap.at[0]), f32(cap.at[1]), f32(cap.at[2])), new J.Quat(f32(h), 0, 0, f32(h)),
          new J.CapsuleShapeSettings(f32(Math.max(0.001, cap.length / 2 - cap.radius)), f32(cap.radius)), 0);
      }
      if (spec.legs) {
        const s = spec.legs.size;
        cs.AddShape(new J.Vec3(f32(spec.legs.at[0]), f32(spec.legs.at[1]), f32(spec.legs.at[2])), new J.Quat(0, 0, 0, 1),
          new J.BoxShapeSettings(new J.Vec3(f32(s[0] / 2), f32(s[1] / 2), f32(s[2] / 2)), f32(0.004)), 1);
      }
      return cs.Create().Get();
    });
    const base = this.createBody(shape, p.pos, yq, {
      part: partIndex, role: 'base', layer: L.moving, mass: spec.mass, friction: p.def.body.friction, restitution: p.def.body.restitution,
      gravity: 1, ccd: p.def.body.ccd ?? false, group, groupId, sub: nb, activate: true, upright: true,
    });
    p.base = base;
    const rags: number[] = [];
    spec.ragdoll.forEach((bone, i) => {
      const he = bone.halfExtents ?? [bone.radius, bone.halfHeight, bone.radius];
      const s = this.shapeOf(`rag:${spec.species}:${i}`, () => (bone.shape === 'cylinder'
        ? new J.CylinderShapeSettings(f32(bone.halfHeight), f32(bone.radius), f32(0.004)) // M4: DUSTY's rigid RAG__body
        : bone.shape === 'box'
          ? new J.BoxShapeSettings(new J.Vec3(f32(he[0]), f32(he[1]), f32(he[2])), f32(0.004)) // M5: BUZZ's rigid RAG__body
          : new J.CapsuleShapeSettings(f32(bone.halfHeight), f32(bone.radius))).Create().Get());
      rags.push(this.createBody(s, vadd(p.pos, qrot(yq, bone.at)), qmul(yq, bone.rot), {
        part: partIndex, role: 'rag', bone: bone.bone, layer: L.ghost, mass: bone.mass, friction: spec.friction, restitution: spec.restitution,
        // every capsule is CCD (LinearCast): a blast throws them at up to 8 m/s, and thin colliders (a
        // SLOPE's 20 mm nose, the drive's plinth) must still stop a limb
        gravity: 0, ccd: true, group, groupId, sub: i, activate: false,
        ...(bone.shape === 'cylinder' || bone.shape === 'box' ? { damping: [0.3, 2.0] as const } : {}),
      }));
    });
    const joints: JoltModule[] = [];
    spec.ragdoll.forEach((bone, i) => {
      if (bone.parent < 0) return;
      const at = vadd(p.pos, qrot(yq, bone.a));
      const dir = vnorm(qrot(yq, vsub(bone.b, bone.a)));
      const perp = vnorm(Math.abs(dir[1]) < 0.9 ? vcross(dir, [0, 1, 0]) : vcross(dir, [1, 0, 0]));
      const s = new J.SwingTwistConstraintSettings();
      s.mSpace = J.EConstraintSpace_WorldSpace;
      s.mPosition1 = this.rvec(at); s.mPosition2 = this.rvec(at);
      s.mTwistAxis1 = this.vec(dir[0], dir[1], dir[2]); s.mTwistAxis2 = this.vec(dir[0], dir[1], dir[2]);
      s.mPlaneAxis1 = this.vec(perp[0], perp[1], perp[2]); s.mPlaneAxis2 = this.vec(perp[0], perp[1], perp[2]);
      s.mNormalHalfConeAngle = f32((bone.swing * Math.PI) / 180);
      s.mPlaneHalfConeAngle = f32((bone.swing * Math.PI) / 180);
      s.mTwistMinAngle = f32((-bone.twist * Math.PI) / 180);
      s.mTwistMaxAngle = f32((bone.twist * Math.PI) / 180);
      s.mMaxFrictionTorque = f32(0.05 * bone.mass);
      const c = s.Create(this.h.bodies[rags[bone.parent]!]!.body, this.h.bodies[rags[i]!]!.body);
      J.destroy(s);
      this.h.system.AddConstraint(c);
      c.SetEnabled(false);
      joints.push(c);
    });
    const ignoreSelf = new J.IgnoreSingleBodyFilter(this.h.bodies[base]!.body.GetID());
    this.crits.push({ part: partIndex, spec, base, rags, joints, ignoreSelf });
    this.m4.onBuild(this.crits.length - 1, partIndex, group, nb); // M4 (B4): egg pool, Dusty's zone
    this.m5.onBuild(this.crits.length - 1, spec.species); // M5 (B5): BUZZ
  }

  /** Wires devices, binds critters placed in them, seeds state. Call once all bodies, links and `st` exist. */
  init(): void {
    const J = this.h.J;
    const parts = this.h.parts;
    const st = this.st;
    this.critOfPart = new Int32Array(parts.length).fill(-1);
    this.devOfPart = new Int32Array(parts.length).fill(-1);
    this.crits.forEach((c, k) => { this.critOfPart[c.part] = k; });
    parts.forEach((p, i) => {
      const kind = p.def.type as DeviceKind;
      if (kind in DEVICE_SPECS) { this.devOfPart[i] = this.devs.length; this.devs.push({ part: i, kind }); }
    });
    const nb = this.h.bodies.length;
    this.bodyCrit = new Int32Array(nb).fill(-1);
    this.bodyDev = new Int32Array(nb).fill(-1);
    this.crits.forEach((c, k) => { this.bodyCrit[c.base] = k; });
    this.devs.forEach((d, k) => {
      const p = parts[d.part]!;
      if (p.base >= 0) this.bodyDev[p.base] = k;
      if (p.arm >= 0) this.bodyDev[p.arm] = k;
    });
    const n = this.crits.length, m = this.devs.length;
    this.tHit = new Float64Array(n); this.tHitDir = new Float64Array(n * 3); this.tHitPart = new Int32Array(n).fill(-1); this.tTouch = new Float64Array(n); this.tPounce = new Int32Array(n);
    this.dBump = new Float64Array(m); this.dBumpDir = new Float64Array(m * 3);
    // lures (SIMULATION §5.11): tagged parts, computed shiny bodies; critter lures are added in perception
    this.lures = [];
    parts.forEach((p, i) => {
      if (p.def.critter) return;
      const l = lureOf(p.def);
      if (l) this.lures.push({ part: i, species: l.species, radius: l.radius, shiny: (l.species.bandit ?? 0) > 0 && p.def.body.kind === 'dynamic' && p.def.body.mass <= SHINY_MAX_KG });
    });
    // test/soak-only extra lures (MachineOptions.extraLures): a part made a lure (replacing its own tag),
    // or a bodiless lure at a point, keyed after the parts
    this.fixed = [];
    for (const x of this.h.extraLures()) {
      if (x.part >= 0) {
        const p = parts[x.part]!;
        this.lures = this.lures.filter((l) => l.part !== x.part);
        this.lures.push({ part: x.part, species: x.species, radius: x.radius, shiny: (x.species.bandit ?? 0) > 0 && p.def.body.kind === 'dynamic' && p.def.body.mass <= SHINY_MAX_KG });
      } else if (x.pos) {
        this.lures.push({ part: parts.length + this.fixed.length, species: x.species, radius: x.radius, shiny: false });
        this.fixed.push([x.pos[0]!, x.pos[1]!, x.pos[2]!]);
      }
    }
    this.lures.sort((a, b) => a.part - b.part);
    // raycasts (vision, hearing occlusion, avoidance, ground)
    this.ray = {
      settings: new J.RayCastSettings(), col: new J.CastRayClosestHitCollisionCollector(),
      bp: new J.DefaultBroadPhaseLayerFilter(this.h.jolt.GetObjectVsBroadPhaseLayerFilter(), this.h.layers.moving),
      all: new J.DefaultObjectLayerFilter(this.h.jolt.GetObjectLayerPairFilter(), this.h.layers.moving),
      statics: new J.SpecifiedObjectLayerFilter(this.h.layers.static),
      anyBody: new J.BodyFilter(), shapes: new J.ShapeFilter(),
    };
    const world: CritWorld = {
      c: this.crits.map((c) => {
        const p = parts[c.part]!;
        const r = stream(this.h.seed[0], this.h.seed[1], `critter:${p.id}`).state();
        return {
          fsm: F.idle, t: 0, dur: -1, clip: CL.idle, emote: 0, emoteT: 0, flags: 0, r0: r.s0, r1: r.s1, r2: r.s2, r3: r.s3,
          gx: p.pos[0]!, gy: p.pos[1]!, gz: p.pos[2]!, target: -1, speed: 0, avoid: 0, heard: 0, hx: 0, hy: 0, hz: 0,
          touch: 0, ax: 0, ay: 0, az: 0, still: 0, ragT: 0, dev: -1, carry: -1, trap: -1, ignore: -1, ignoreT: 0,
          homeX: p.pos[0]!, homeY: p.pos[1]!, homeZ: p.pos[2]!, lx: 0, ly: 0, lz: 0, stuck: 0, chaseT: 0, flopT: 0, aux: 0, hc: -1, rid: -1,
        };
      }),
      d: this.devs.map(() => ({ phase: 0, timer: 0, occ: -1, bump: 0, cool: 0, flags: 0, heard: 0, lure: 0, ax: 0, ay: 0, az: 0 })),
    };
    st.crit = world;
    // critters placed in their devices start there (critters.md: Pip straight into a HAMSTER DRIVE, Goby in his bowl)
    this.crits.forEach((cr, k) => {
      const c = world.c[k]!;
      const p = parts[cr.part]!;
      const sp = cr.spec.species;
      const want: DeviceKind | null = sp === 'pip' ? 'hamster_drive' : sp === 'goby' ? 'fishbowl' : sp === 'bandit' ? 'pedal_rig' : null;
      let bound = -1;
      if (want) {
        this.devs.forEach((d, j) => {
          if (bound >= 0 || d.kind !== want || world.d[j]!.occ >= 0) return;
          const spot = this.socketWorld(j);
          const r = want === 'hamster_drive' ? HD.bindRadius : want === 'fishbowl' ? FB.bindRadius : PR.bindRadius;
          const at = want === 'fishbowl' ? vadd(p.pos, [0, cr.spec.capsule.at[1], 0]) : p.pos;
          if (vlen(vsub(at, spot.p)) <= r) bound = j;
        });
      }
      c.dur = Math.round(this.rand(c, 0.4, 1.2) * this.h.tickRate);
      if (bound >= 0) {
        this.bind(k, bound);
        if (sp === 'pip') this.setFsm(k, 'wheel_sleep', -1, false);
        else if (sp === 'goby') this.setFsm(k, 'swim', 2, false);
      } else if (sp === 'goby') {
        // a goldfish placed on dry land flops, then the bubble takes him home (his spawn spot)
        c.flopT = Math.round(FB.flop * this.h.tickRate);
        this.setFsm(k, 'flop', -1, false);
      }
    });
    this.devs.forEach((d, j) => {
      const p = parts[d.part]!;
      if ((d.kind === 'hamster_drive' || d.kind === 'pedal_rig') && p.hinge) p.hinge.SetMotorState(J.EMotorState_Off);
    });
    this.m4.init(world); // M4 (B4): extra state, starting states (Biscuit asleep, Dusty patrolling)
    this.m5.init(world); // M5 (B5): BUZZ's state, its beacon pairing, the tagged parts
  }

  // ---- small helpers ------------------------------------------------------------------------------------

  rand(c: CritSt, lo = 0, hi = 1): number {
    const r = Rng.fromState({ s0: c.r0, s1: c.r1, s2: c.r2, s3: c.r3 });
    const v = r.nextFloat();
    const s = r.state();
    c.r0 = s.s0; c.r1 = s.s1; c.r2 = s.s2; c.r3 = s.s3;
    return lo + (hi - lo) * v;
  }

  ticks(seconds: number): number { return Math.round(seconds * this.h.tickRate); }

  body(i: number): JoltModule { return this.h.bodies[i]!.body; }
  id(i: number): JoltModule { return this.h.bodies[i]!.body.GetID(); }

  posOf(bodyIndex: number): Vec { const p = this.body(bodyIndex).GetPosition(); return [p.GetX(), p.GetY(), p.GetZ()]; }
  comOf(bodyIndex: number): Vec { const p = this.body(bodyIndex).GetCenterOfMassPosition(); return [p.GetX(), p.GetY(), p.GetZ()]; }
  rotOf(bodyIndex: number): Q { const q = this.body(bodyIndex).GetRotation(); return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]; }
  velOf(bodyIndex: number): Vec { const v = this.body(bodyIndex).GetLinearVelocity(); return [v.GetX(), v.GetY(), v.GetZ()]; }

  /** Centre of a part's main body (lure and target positions). */
  /** Parts can die (detonate, pop); bodiless extra lures never do. */
  aliveKey(i: number): boolean { return i >= this.h.parts.length ? i < this.h.parts.length + this.fixed.length : !!this.st.alive[i]; }

  partCom(i: number): Vec {
    if (i >= this.h.parts.length) return this.fixed[i - this.h.parts.length]!; // a bodiless extra lure
    const p = this.h.parts[i]!;
    return this.comOf(p.base);
  }

  /** World pose of a device's critter socket (and its facing yaw). */
  socketWorld(j: number): { p: Vec; yaw: number } {
    const d = this.devs[j]!;
    const p = this.h.parts[d.part]!;
    const pos = this.posOf(p.base), rot = this.rotOf(p.base);
    const yaw = yawOf(rot);
    switch (d.kind) {
      case 'hamster_drive': return { p: vadd(pos, qrot(rot, HD.socket)), yaw: yaw + datan2(HD.facing[0], HD.facing[2]) };
      case 'pedal_rig': return { p: vadd(pos, qrot(rot, PR.seat)), yaw: yaw + datan2(PR.facing[0], PR.facing[2]) };
      case 'fishbowl': return { p: vadd(pos, qrot(rot, FB.swimAt)), yaw };
      case 'trap_box': return { p: pos, yaw };
    }
  }

  setFsm(k: number, s: CritterFsm, seconds: number, event = true, cause = -1): void {
    const c = this.w.c[k]!;
    const was = c.fsm;
    c.fsm = F[s];
    c.t = 0;
    c.dur = seconds < 0 ? -1 : this.ticks(seconds);
    if (event && was !== c.fsm) this.h.emit('CritterState', this.crits[k]!.part, this.posOf(this.crits[k]!.base), c.fsm, -1, cause);
  }

  setEmote(k: number, e: CritterEmote, seconds: number): void {
    const cr = this.crits[k]!;
    if (e !== 'none' && !cr.spec.emotes.includes(e) && !['!', '?', 'zzz', 'stars'].includes(e)) return;
    const c = this.w.c[k]!;
    const was = c.emote;
    c.emote = EM[e];
    c.emoteT = this.ticks(seconds);
    if (c.emote !== 0 && c.emote !== was) this.h.emit('Emote', cr.part, this.posOf(cr.base), c.emote);
  }

  is(c: CritSt, ...s: CritterFsm[]): boolean { for (const x of s) if (c.fsm === F[x]) return true; return false; }

  /** Ray from a to b: fraction to the first hit (1 = clear). `staticOnly` sees only static geometry. */
  cast(a: readonly number[], b: readonly number[], staticOnly: boolean, ignore: JoltModule | null): number {
    const R = this.ray!;
    const J = this.h.J;
    const d = vsub(b, a);
    if (vlen(d) < 1e-6) return 1;
    this.r3.Set(f32(a[0]!), f32(a[1]!), f32(a[2]!));
    this.v3a.Set(f32(d[0]), f32(d[1]), f32(d[2]));
    const ray = new J.RRayCast(this.r3, this.v3a);
    R.col.Reset();
    this.h.system.GetNarrowPhaseQuery().CastRay(ray, R.settings, R.col, R.bp, staticOnly ? R.statics : R.all, ignore ?? R.anyBody, R.shapes);
    const f = R.col.HadHit() ? R.col.mHit.mFraction : 1;
    J.destroy(ray);
    return f;
  }

  /** M4 (B4): like `cast` (all layers), also naming the body it hit (-1: none, or not one of ours). */
  castHit(a: readonly number[], b: readonly number[], ignore: JoltModule | null): { f: number; body: number } {
    const R = this.ray!;
    const J = this.h.J;
    const d = vsub(b, a);
    if (vlen(d) < 1e-6) return { f: 1, body: -1 };
    this.r3.Set(f32(a[0]!), f32(a[1]!), f32(a[2]!));
    this.v3a.Set(f32(d[0]), f32(d[1]), f32(d[2]));
    const ray = new J.RRayCast(this.r3, this.v3a);
    R.col.Reset();
    this.h.system.GetNarrowPhaseQuery().CastRay(ray, R.settings, R.col, R.bp, R.all, ignore ?? R.anyBody, R.shapes);
    const hit = R.col.HadHit();
    const f = hit ? R.col.mHit.mFraction : 1;
    const ud = hit ? Number(this.h.bi.GetUserData(R.col.mHit.mBodyID)) : -1;
    J.destroy(ray);
    return { f, body: Number.isInteger(ud) && ud >= 0 && ud < this.h.bodies.length ? ud : -1 };
  }

  // ---- base body modes ----------------------------------------------------------------------------------

  /** The locomotion capsule collides and falls (free) or is a weightless ghost the sim places (bound, ragdolled, rescued). */
  setBaseFree(k: number, free: boolean): void {
    const cr = this.crits[k]!;
    const id = this.id(cr.base);
    const L = this.h.layers;
    this.h.bi.SetObjectLayer(id, free ? L.moving : L.ghost);
    this.h.bi.SetGravityFactor(id, f32(free ? 1 : 0));
    this.h.bi.SetLinearVelocity(id, this.vec(0, 0, 0));
    this.h.bi.SetAngularVelocity(id, this.vec(0, 0, 0));
    if (free) this.h.bi.ActivateBody(id);
  }

  /** Places a ghost base at a pose (no velocity). */
  placeBase(k: number, p: readonly number[], yaw: number): void {
    const cr = this.crits[k]!;
    this.h.bi.SetPositionRotationAndVelocity(this.id(cr.base), this.rvec(p), this.quat(yawQ(yaw)), this.vec(0, 0, 0), this.vec2(0, 0, 0));
  }

  baseMode(c: CritSt): 'rag' | 'bound' | 'ghost' | 'free' {
    if (c.flags & CritterFlagBits.ragdoll) return 'rag';
    if (c.dev >= 0) return 'bound';
    if (c.fsm === F.bubble || c.fsm === F.home) return 'ghost';
    return 'free';
  }

  bind(k: number, j: number): void {
    const c = this.w.c[k]!, d = this.w.d[j]!;
    c.dev = j;
    d.occ = k;
    c.flags |= CritterFlagBits.inDevice;
    c.lx = 0; c.ly = 0; c.lz = 0;
    this.setBaseFree(k, false);
    this.followDevice(k);
  }

  unbind(k: number): void {
    const c = this.w.c[k]!;
    if (c.dev < 0) return;
    const d = this.w.d[c.dev]!;
    if (d.occ === k) d.occ = -1;
    const kind = this.devs[c.dev]!.kind;
    if (kind === 'hamster_drive' || kind === 'pedal_rig') { d.phase = 0; d.timer = 0; }
    c.dev = -1;
    c.flags &= ~CritterFlagBits.inDevice;
  }

  /** A bound critter sits at its device's socket (Goby: at his swim point in the bowl). */
  followDevice(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const s = this.socketWorld(c.dev);
    if (this.devs[c.dev]!.kind === 'fishbowl') {
      const bowl = this.h.parts[this.devs[c.dev]!.part]!;
      const rot = this.rotOf(bowl.base);
      const at = vadd(s.p, qrot(rot, [c.lx, c.ly, c.lz]));
      this.placeBase(k, vsub(at, [0, cr.spec.capsule.at[1], 0]), s.yaw + c.avoid);
      return;
    }
    this.placeBase(k, s.p, s.yaw);
  }

  // ---- ragdoll ------------------------------------------------------------------------------------------

  /**
   * Switches a critter to its ragdoll (SIMULATION §7.4): capsules at the canonical rest pose around the
   * critter, the critter's velocity plus `dv` on every capsule, joints on.
   */
  ragdoll(k: number, dv: readonly number[], J: number, cause = -1): void {
    const c = this.w.c[k]!;
    if (c.flags & CritterFlagBits.ragdoll) {
      // already tumbling: the extra kick goes to every capsule
      for (const ri of this.crits[k]!.rags) {
        const v = this.velOf(ri);
        this.h.bi.SetLinearVelocity(this.id(ri), this.vec(v[0] + dv[0]!, v[1] + dv[1]!, v[2] + dv[2]!));
        this.h.bi.ActivateBody(this.id(ri));
      }
      return;
    }
    const cr = this.crits[k]!;
    const Jm = this.h.J, L = this.h.layers, bi = this.h.bi;
    if (c.carry >= 0) this.drop(k);
    const bound = c.dev >= 0;
    // thrown out of a device: the tumble starts at its exit point (drive.md socket_pip_exit, the rig's
    // approach point), not inside the wheel or over the handlebars where the capsules would overlap it
    const exit = bound ? this.exitPose(c.dev) : null;
    const root = exit ? exit.p : this.posOf(cr.base);
    const yaw = exit ? exit.yaw : yawOf(this.rotOf(cr.base));
    const v0: Vec = bound ? [0, 0, 0] : this.velOf(cr.base);
    if (bound) this.unbind(k);
    if (c.trap >= 0) { c.trap = -1; c.flags &= ~CritterFlagBits.trapped; }
    const yq = yawQ(yaw);
    cr.spec.ragdoll.forEach((bone, i) => {
      const ri = cr.rags[i]!;
      const id = this.id(ri);
      const p = vadd(root, qrot(yq, bone.at));
      bi.SetPositionRotationAndVelocity(id, this.rvec(p), this.quat(qmul(yq, bone.rot)), this.vec(v0[0] + dv[0]!, v0[1] + dv[1]!, v0[2] + dv[2]!), this.vec2(0, 0, 0));
      bi.SetObjectLayer(id, L.moving);
      bi.SetGravityFactor(id, f32(1));
      bi.ActivateBody(id);
    });
    for (const j of cr.joints) j.SetEnabled(true);
    this.setBaseFree(k, false);
    c.flags |= CritterFlagBits.ragdoll;
    c.flags &= ~CritterFlagBits.asleep;
    c.still = 0;
    c.ragT = 0;
    c.speed = 0;
    c.target = -1;
    c.rid = this.h.emit('Ragdoll', cr.part, root, J, -1, cause);
    this.setFsm(k, 'ragdoll', -1, true, c.rid);
    if (isM4(cr.spec.species)) this.m4.onRagdoll(k, dv); // DUSTY: its bin's mass, a tumbling spin
    if (isM5(cr.spec.species)) this.m5.onRagdoll(k, dv); // BUZZ: the winch stops, a flip
    void Jm;
  }

  /** Ragdoll → upright capsule at the ragdoll root (ground found by a ray), then getup → dizzy. */
  recover(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const bi = this.h.bi, L = this.h.layers;
    const rootBody = cr.rags[0]!;
    let p = this.posOf(rootBody);
    const q = this.rotOf(rootBody);
    // heading: the root capsule's axis now vs at rest
    const bone0 = cr.spec.ragdoll[0]!;
    const dirNow = qrot(q, [0, 1, 0]), dirRest = qrot(bone0.rot, [0, 1, 0]);
    let yaw = datan2(dirNow[0], dirNow[2]) - datan2(dirRest[0], dirRest[2]);
    if (hlen(dirNow) < 0.2) yaw = 0;
    for (const j of cr.joints) j.SetEnabled(false);
    for (const ri of cr.rags) {
      const id = this.id(ri);
      bi.SetObjectLayer(id, L.ghost);
      bi.SetGravityFactor(id, f32(0));
      bi.SetLinearVelocity(id, this.vec(0, 0, 0));
      bi.SetAngularVelocity(id, this.vec(0, 0, 0));
      bi.DeactivateBody(id);
    }
    const bad = !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2]) || p[1] < -2;
    if (bad) p = [c.homeX, c.homeY + 0.3, c.homeZ];
    // stand on whatever is under the root
    const f = this.cast([p[0], p[1] + 0.3, p[2]], [p[0], p[1] - 1.5, p[2]], false, null);
    const y = f < 1 ? p[1] + 0.3 - 1.8 * f + 0.004 : Math.max(0, p[1] - bone0.at[1]);
    c.flags &= ~CritterFlagBits.ragdoll;
    this.placeBase(k, [p[0], y, p[2]], wrapPi(yaw));
    if (cr.spec.species === 'goby' && (c.fsm === F.ragdoll) && c.aux !== 2) {
      // a goldfish on the floor goes back to flopping (and the bubble comes when the flop time runs out)
      this.setBaseFree(k, true);
      if (c.flopT <= 0) c.flopT = this.ticks(FB.flop);
      this.setFsm(k, 'flop', -1);
    } else {
      this.setBaseFree(k, true);
      this.setFsm(k, 'getup', 1.0);
    }
    this.h.emit('Getup', cr.part, [p[0], y, p[2]], c.ragT / this.h.tickRate, -1, c.rid);
  }

  // ---- hooks ---------------------------------------------------------------------------------------------

  /** Contact listener hook (stage 8): bodies by index, velocities, normal (from 1 to 2), inverse masses, J estimate. */
  contact(i1: number, i2: number, v1x: number, v1y: number, v1z: number, v2x: number, v2y: number, v2z: number,
    nx: number, ny: number, nz: number, inv1: number, inv2: number, J: number): void {
    this.m4.contactEgg(i1, i2, J); // M4 (B4): laid YOLKs (max J per egg this tick)
    const c1 = this.bodyCrit[i1] ?? -1, c2 = this.bodyCrit[i2] ?? -1;
    const d1 = this.bodyDev[i1] ?? -1, d2 = this.bodyDev[i2] ?? -1;
    if (c1 < 0 && c2 < 0 && d1 < 0 && d2 < 0) return;
    const sides: [number, number, number, number, number][] = [[c1, d1, i2, 1, inv2], [c2, d2, i1, -1, inv1]];
    for (const [ck, dk, other, sign, invO] of sides) {
      // n points from body 1 to body 2: the normal from the other body into this one is +n for body 2
      const nxs = -sign * nx, nys = -sign * ny, nzs = -sign * nz;
      const vo = sign > 0 ? [v2x, v2y, v2z] : [v1x, v1y, v1z];
      const vc = sign > 0 ? [v1x, v1y, v1z] : [v2x, v2y, v2z];
      const invC = sign > 0 ? inv1 : inv2;
      const closing = (vo[0]! - vc[0]!) * nxs + (vo[1]! - vc[1]!) * nys + (vo[2]! - vc[2]!) * nzs;
      if (ck >= 0) {
        const ob = this.h.bodies[other];
        const st = this.w.c[ck]!;
        let hit = 0;
        if (isM4(this.crits[ck]!.spec.species)) this.m4.touch(ck, other, nxs, nzs, invO, !!ob?.dynamic, J); // barge, bumper
        if (ob && ob.dynamic && invO > 0) {
          // a carried item, or a cage dropping round it, never tumbles a critter
          if (ob.part === st.carry || this.h.parts[ob.part]?.def.type === 'trap_box') continue;
          const towards = vo[0]! * nxs + vo[1]! * nys + vo[2]! * nzs;
          const mred = 1 / (invO + invC);
          hit = mred * Math.min(Math.max(0, closing), Math.max(0, towards));
          if (J > this.tTouch[ck]!) this.tTouch[ck] = J;
          const ok = this.critOfPart[ob.part] ?? -1;
          if (ok >= 0 && ob.role === 'base') {
            const me = this.w.c[ck]!;
            if (me.fsm === F.pounce && me.target === ob.part) this.tPounce[ck] = 1;
          }
        } else if (invC > 0) {
          hit = Math.max(0, closing - SAFE_LANDING) / invC;
        }
        if (hit > this.tHit[ck]!) {
          this.tHit[ck] = hit;
          this.tHitPart[ck] = ob ? ob.part : -1;
          this.tHitDir[ck * 3] = nxs * hit; this.tHitDir[ck * 3 + 1] = nys * hit; this.tHitDir[ck * 3 + 2] = nzs * hit;
        }
      }
      if (dk >= 0) {
        const ob = this.h.bodies[other];
        if (!ob || !ob.dynamic) {
          // the bowl hitting the floor: its own momentum above a gentle set-down speed
          if (this.devs[dk]!.kind === 'fishbowl' && invC > 0) {
            const hit = Math.max(0, closing - 0.5) / invC;
            if (hit > this.dBump[dk]!) this.dBump[dk] = hit;
          }
          continue;
        }
        if ((this.bodyDev[other] ?? -1) === dk) continue;
        if (J > this.dBump[dk]!) {
          this.dBump[dk] = J;
          this.dBumpDir[dk * 3] = nxs; this.dBumpDir[dk * 3 + 1] = nys; this.dBumpDir[dk * 3 + 2] = nzs;
        }
      }
    }
  }

  /** A detonation reaches part `k` (stage 11). Returns true when the critter system handled its impulse. */
  blast(k: number, P: readonly number[], Y: number, e: number, r: number, src = -1): boolean {
    const ck = this.critOfPart[k] ?? -1;
    if (ck >= 0) {
      const c = this.w.c[ck]!;
      if (c.fsm === F.bubble || c.fsm === F.home) return true; // the rescue bubble shrugs it off
      // a critter's own wheel, rig or bowl doesn't shield it (they are open); walls still do
      const ee = c.dev >= 0 ? Math.max(e, 0.5) : e;
      if (ee <= 0) return true;
      const cr = this.crits[ck]!;
      const at = this.comOf(cr.base);
      const d = vsub(at, P);
      const dist = vlen(d);
      const dir = dist > 1e-6 ? vscale(d, 1 / dist) : [0, 1, 0];
      const Jmag = (18 * Y * ee) / dpow(Math.max(r, 0.15), 1.5);
      const dvm = Math.min(Jmag / cr.spec.mass, MAX_DV);
      // critters inside R always ragdoll (SIMULATION §6.1)
      this.ragdoll(ck, [dir[0]! * dvm, dir[1]! * dvm + 0.15 * dvm, dir[2]! * dvm], Jmag, this.h.cause(src));
      return true;
    }
    const dk = this.devOfPart[k] ?? -1;
    if (dk >= 0 && this.devs[dk]!.kind === 'fishbowl' && e > 0) {
      this.breakBowl(dk, this.h.cause(src));
      return true;
    }
    return false;
  }

  /** Hand-of-God impulse on a critter (stage 0). Returns true when handled. */
  poke(k: number, imp: readonly number[]): boolean {
    const ck = this.critOfPart[k] ?? -1;
    const dk = this.devOfPart[k] ?? -1;
    // a broken bowl's hidden body takes no pokes (restore would zero its drift and desync a rollback)
    if (dk >= 0 && this.devs[dk]!.kind === 'fishbowl' && this.w.d[dk]!.phase !== 0) return true;
    if (ck < 0) return false;
    const cr = this.crits[ck]!;
    const c = this.w.c[ck]!;
    if (c.fsm === F.bubble || c.fsm === F.home) return true;
    const J = vlen(imp);
    const s = Math.min(1, MAX_DV / Math.max(1e-9, J / cr.spec.mass)) / cr.spec.mass;
    if (J >= cr.spec.ragdollJ || (c.flags & CritterFlagBits.ragdoll) || c.dev >= 0) { this.ragdoll(ck, vscale(imp, s), J); return true; }
    this.h.bi.AddImpulse(this.id(cr.base), this.vec(imp[0]!, imp[1]!, imp[2]!));
    return true;
  }

  /** Stage 6: devices, then every critter acts; one in four think this tick. */
  preStep(t: number): void {
    const w = this.w;
    this.hear();
    for (let j = 0; j < this.devs.length; j++) this.deviceAct(j, t);
    for (let k = 0; k < this.crits.length; k++) {
      const c = w.c[k]!;
      const id = this.h.parts[this.crits[k]!.part]!.id;
      c.t++;
      if (c.emoteT > 0 && --c.emoteT === 0) c.emote = 0;
      if (c.ignoreT > 0 && --c.ignoreT === 0) c.ignore = -1;
      if (t % THINK_EVERY === id % THINK_EVERY) this.think(k);
      this.act(k);
    }
  }

  /** After the contact stage: ragdoll triggers, bumps, ragdoll follow and recovery, traps, carried items. */
  postContacts(_t: number): void {
    const w = this.w;
    for (let j = 0; j < this.devs.length; j++) {
      const b = this.dBump[j]!;
      if (b <= 0) continue;
      const d = w.d[j]!;
      const kind = this.devs[j]!.kind;
      if (kind === 'fishbowl' && d.phase === 0 && b >= FB.jBreak) this.breakBowl(j);
      if (kind === 'hamster_drive') {
        d.bump = Math.max(d.bump, b);
        if (b >= HD.knockJ && d.occ >= 0) {
          // a hard knock throws Pip out of the wheel
          const k = d.occ;
          const dir = vnorm([this.dBumpDir[j * 3]!, 0, this.dBumpDir[j * 3 + 2]!]);
          this.ragdoll(k, [dir[0] * 0.8, 1.5, dir[2] * 0.8], b);
        }
      }
    }
    for (let k = 0; k < this.crits.length; k++) {
      const c = w.c[k]!;
      const cr = this.crits[k]!;
      if (this.tTouch[k]! > c.touch) c.touch = this.tTouch[k]!;
      const hit = this.tHit[k]!;
      if (hit >= cr.spec.ragdollJ && !(c.flags & CritterFlagBits.ragdoll) && this.baseMode(c) === 'free') {
        const dv = Math.min(hit / cr.spec.mass, MAX_DV) / Math.max(hit, 1e-9);
        this.ragdoll(k, [this.tHitDir[k * 3]! * dv, this.tHitDir[k * 3 + 1]! * dv + 0.5, this.tHitDir[k * 3 + 2]! * dv], hit, this.h.cause(this.tHitPart[k]!));
      }
      if (this.tPounce[k]) c.aux = 1; // the pounce landed on its target
      if (c.flags & CritterFlagBits.ragdoll) this.ragFollow(k);
    }
    this.trapCheck();
    for (let k = 0; k < this.crits.length; k++) if (w.c[k]!.carry >= 0) this.carryFollow(k);
    this.m4.postContacts(_t); // M4 (B4): egg splats, Biscuit's barge, Dusty's bumper and intake
    this.tHit.fill(0); this.tHitDir.fill(0); this.tTouch.fill(0); this.tPounce.fill(0); this.tHitPart.fill(-1);
    this.dBump.fill(0); this.dBumpDir.fill(0);
  }

  /**
   * Start of stage 6: critters and devices hear the Sounds made since last stage 6 (SIMULATION §5.10,
   * stream A's soundsThisTick). Effective loudness = dB − 20·log10(max(d, 1 m)); occlusion (−12 dB) is
   * tested once per think, on the loudest.
   */
  hear(): void {
    const sounds = this.h.sounds();
    if (!sounds.length) return;
    const w = this.w;
    for (let k = 0; k < this.crits.length; k++) {
      const c = w.c[k]!;
      if (c.flags & CritterFlagBits.ragdoll) continue;
      const cr = this.crits[k]!;
      const ear = vadd(this.posOf(cr.base), qrot(yawQ(yawOf(this.rotOf(cr.base))), cr.spec.eye));
      const me = this.comOf(cr.base);
      const own = cr.spec.capsule.length / 2 + 0.12;
      for (const s of sounds) {
        // its own noise (a landing, a pounce) never startles it: that would loop
        if (s.part === cr.part || vlen(vsub(s.pos, me)) < own) continue;
        const eff = s.dB - 20 * log10(Math.max(vlen(vsub(s.pos, ear)), 1));
        if (eff > c.heard) { c.heard = eff; c.hx = s.pos[0]!; c.hy = s.pos[1]!; c.hz = s.pos[2]!; c.hc = s.cause; }
      }
    }
    for (let j = 0; j < this.devs.length; j++) {
      const kind = this.devs[j]!.kind;
      if (kind !== 'pedal_rig' && kind !== 'hamster_drive') continue;
      const p = this.h.parts[this.devs[j]!.part]!;
      const ear = vadd(this.posOf(p.base), qrot(this.rotOf(p.base), kind === 'pedal_rig' ? PR.ear : HD.socket));
      const d = w.d[j]!;
      for (const s of sounds) d.heard = Math.max(d.heard, s.dB - 20 * log10(Math.max(vlen(vsub(s.pos, ear)), 1)));
    }
  }

  /** After a checkpoint restore: state Jolt doesn't record (layers, gravity, joint enables, carried items). */
  afterRestore(): void {
    const w = this.w;
    const bi = this.h.bi, L = this.h.layers;
    // an item grabbed after the checkpoint is still a ghost in Jolt: hand it back to the world first
    // (part order, so the Jolt calls run in the same order on every peer)
    for (const part of [...this.everCarried].sort((a, b) => a - b)) {
      if (this.st.alive[part] && !this.carried(part)) this.ghostItem(part, false);
    }
    this.crits.forEach((cr, k) => {
      const c = w.c[k]!;
      const rag = (c.flags & CritterFlagBits.ragdoll) !== 0;
      for (const ri of cr.rags) {
        const id = this.id(ri);
        bi.SetObjectLayer(id, rag ? L.moving : L.ghost);
        bi.SetGravityFactor(id, f32(rag ? 1 : 0));
      }
      for (const j of cr.joints) j.SetEnabled(rag);
      const free = this.baseMode(c) === 'free';
      const id = this.id(cr.base);
      bi.SetObjectLayer(id, free ? L.moving : L.ghost);
      bi.SetGravityFactor(id, f32(free ? 1 : 0));
      if (c.carry >= 0) this.ghostItem(c.carry, true);
    });
    this.m4.afterRestore(); // M4 (B4): egg layers, Dusty's mass
    this.m5.afterRestore(); // M5 (B5): BUZZ's flight gravity (0 while its rotors hold it up)
  }

  /** M4 (B4) hook: the Machine emitted an Impact (J >= 0.3 N·s) between parts a and b (HENNY startles within 1.5 m). */
  impact(pos: readonly number[], J: number, a: number, b: number): void { this.m4.impact(pos, J, a, b); }

  /** M4 (B4) hook: once per blast (Machine.blast), after the per-part loop: laid YOLKs within R splat. */
  blastPieces(P: readonly number[], R: number, cause: number): void { this.m4.blast(P, R, cause); }

  /**
   * Who carries what (stolen items, Bandit): pairs [critter part index, carried part index], part order,
   * one pair per critter that is carrying. Usually empty. Derived from `st.crit`, so rollback covers it.
   */
  critterCarry(): Int32Array {
    const w = this.w;
    const out: number[] = [];
    this.crits.forEach((cr, k) => { const c = w.c[k]!.carry; if (c >= 0) out.push(cr.part, c); });
    return Int32Array.from(out);
  }

  // ---- M5 (B5): RIFT GATES (A5's m5_rift.ts calls these in stage 12, gates in part order) -------------------------

  /** Critters that may transit a gate this tick, part order (see RiftCritter). */
  riftCandidates(): RiftCritter[] {
    const out: RiftCritter[] = [];
    this.crits.forEach((cr, k) => {
      const c = this.w.c[k]!;
      if (cr.spec.disc || cr.spec.drone || c.trap >= 0) return;
      const mode = this.baseMode(c);
      if (mode === 'free') {
        const q = this.rotOf(cr.base);
        const cap = cr.spec.capsule;
        out.push({ k, part: cr.part, at: vadd(this.posOf(cr.base), qrot(q, cap.at)), v: this.velOf(cr.base), axis: qrot(q, [0, 0, 1]),
          halfLen: Math.max(0, cap.length / 2 - cap.radius), radius: cap.radius });
      } else if (mode === 'rag') {
        const ri = cr.rags[0]!, bone = cr.spec.ragdoll[0]!;
        if (bone.shape) return; // a robot's rigid hull (never reached: robots are filtered above)
        out.push({ k, part: cr.part, at: this.comOf(ri), v: this.velOf(ri), axis: qrot(this.rotOf(ri), [0, 1, 0]), halfLen: bone.halfHeight, radius: bone.radius });
      }
    });
    return out;
  }

  /** The pair's cooldown is on: the critter bounces off the membrane (front normal `n`), its inward speed × −e. */
  riftBounce(k: number, n: readonly number[], e: number): void {
    const cr = this.crits[k]!, c = this.w.c[k]!;
    const ids = (c.flags & CritterFlagBits.ragdoll) ? cr.rags : [cr.base];
    for (const bi of ids) {
      const v = this.velOf(bi);
      const vn = vdot(v, n);
      if (vn >= 0) continue;
      this.h.bi.SetLinearVelocity(this.id(bi), this.vec(v[0] - (1 + e) * vn * n[0]!, v[1] - (1 + e) * vn * n[1]!, v[2] - (1 + e) * vn * n[2]!));
    }
  }

  /**
   * Moves a critter through a gate pair: points p → c1 + R·(p − c0), velocities and spins by R (A5's B·R·A⁻¹). A free
   * critter keeps its locomotion body upright (yaw only; its capsule centre lands on c1); a ragdoll moves rigidly, every
   * capsule, and its ghost base comes along. Its goal and still-window point move too, so the AI carries on from the far
   * side. Arriving fast it shows dizzy stars (no harm, future.md). Returns the arrival speed. Rollback: Jolt's state
   * records the poses; the rest is plain `st.crit`.
   */
  riftMove(k: number, c0: readonly number[], c1: readonly number[], R: readonly number[]): number {
    const cr = this.crits[k]!, c = this.w.c[k]!, bi = this.h.bi;
    const map = (p: readonly number[]): Vec => vadd(c1, qrot(R, vsub(p, c0)));
    let speed = 0;
    if (c.flags & CritterFlagBits.ragdoll) {
      for (const ri of cr.rags) {
        const p1 = map(this.posOf(ri)), q1 = qmul(R, this.rotOf(ri));
        const v1 = qrot(R, this.velOf(ri)), w0 = this.body(ri).GetAngularVelocity(), w1 = qrot(R, [w0.GetX(), w0.GetY(), w0.GetZ()]);
        if (ri === cr.rags[0]) speed = vlen(v1);
        bi.SetPositionRotationAndVelocity(this.id(ri), this.rvec(p1), this.quat(q1), this.vec(v1[0], v1[1], v1[2]), this.vec2(w1[0], w1[1], w1[2]));
        bi.ActivateBody(this.id(ri));
      }
      const pb = map(this.posOf(cr.base));
      this.placeBase(k, pb, yawOf(qmul(R, this.rotOf(cr.base))));
      const a = map([c.ax, c.ay, c.az]); c.ax = a[0]; c.ay = a[1]; c.az = a[2];
    } else {
      const q0 = this.rotOf(cr.base);
      const v1 = qrot(R, this.velOf(cr.base));
      speed = vlen(v1);
      const f = qrot(R, qrot(q0, [0, 0, 1]));
      const yaw = hlen(f) > 0.2 ? datan2(f[0], f[2]) : hlen(v1) > 0.05 ? datan2(v1[0], v1[2]) : yawOf(q0);
      const q1 = yawQ(yaw);
      const root = vsub(c1, qrot(q1, cr.spec.capsule.at));
      const w0 = this.body(cr.base).GetAngularVelocity();
      bi.SetPositionRotationAndVelocity(this.id(cr.base), this.rvec(root), this.quat(q1), this.vec(v1[0], v1[1], v1[2]), this.vec2(0, w0.GetY(), 0));
      bi.ActivateBody(this.id(cr.base));
    }
    const g = map([c.gx, c0[1]!, c.gz]); c.gx = g[0]; c.gz = g[2];
    if (speed > 1.5) this.setEmote(k, 'stars', 1.5);
    return speed;
  }

  /**
   * Does a ray that hit body `hit` at `at` end in an open, paired RIFT GATE aperture this critter fits through? Then the
   * avoidance rays treat it as clear, so critters walk (or chase) into portals instead of round them.
   */
  riftOpen(k: number, hit: number, at: readonly number[]): boolean {
    const cr = this.crits[k]!;
    if (hit < 0 || cr.spec.disc || cr.spec.drone || !this.h.riftPartner) return false;
    const part = this.h.bodies[hit]?.part ?? -1;
    if (part < 0 || this.h.parts[part]!.def.type !== 'rift_gate' || this.h.riftPartner(part) < 0) return false;
    const g = this.h.parts[part]!;
    const l = qrot([-g.rot[0]!, -g.rot[1]!, -g.rot[2]!, g.rot[3]!], vsub(at, g.pos));
    const dx = l[0] - RIFT.centre[0], dy = l[1] - RIFT.centre[1], lim = RIFT.radius - cr.spec.capsule.radius;
    return lim > 0 && dx * dx + dy * dy <= lim * lim;
  }

  /** M5 (B5): BUZZ's current fetch target: pairs [BUZZ part index, item part index], part order (Machine.critterTargets). */
  critterTargets(): Int32Array { return this.m5.targets(); }

  hash(h: Hasher): void {
    hashCritWorld(h, this.w);
    this.m5.hash(h); // M5 (B5): the snapshot's tagged parts (none: no change)
    // extra lures are run inputs; hashing them keeps runs with different ones apart (none: no change)
    if (this.fixed.length) { h.u32(this.fixed.length); for (const f of this.fixed) h.q(f[0], 1e-4).q(f[1], 1e-4).q(f[2], 1e-4); }
  }

  /**
   * 4 bytes per part, part order (contract 3). Critters: [clip, flags, emote, fsm]. Critter-bound
   * devices: [whole seconds left on the run timer, DeviceFlagBits, 0, phase]. Other parts: zeros.
   */
  critterState(out: Uint8Array): Uint8Array {
    out.fill(0);
    const w = this.w;
    this.crits.forEach((cr, k) => {
      const c = w.c[k]!;
      const o = cr.part * 4;
      out[o] = c.clip; out[o + 1] = c.flags; out[o + 2] = c.emote; out[o + 3] = c.fsm;
    });
    this.devs.forEach((d, j) => {
      const s = w.d[j]!;
      const o = d.part * 4;
      out[o] = Math.min(255, Math.ceil(s.timer / this.h.tickRate)); out[o + 1] = s.flags; out[o + 3] = s.phase;
    });
    return out;
  }

  // ---- devices -------------------------------------------------------------------------------------------

  motor(j: number, omega: number, torque: number): void {
    const J = this.h.J;
    const p = this.h.parts[this.devs[j]!.part]!;
    const hg = p.hinge;
    if (!hg) return;
    if (torque <= 0) { hg.SetMotorState(J.EMotorState_Off); return; }
    hg.SetMotorState(J.EMotorState_Velocity);
    hg.SetTargetAngularVelocity(f32(omega));
    const m = hg.GetMotorSettings();
    m.mMinTorqueLimit = f32(-torque); m.mMaxTorqueLimit = f32(torque);
    this.h.bi.ActivateBody(this.id(p.arm));
  }

  deviceAct(j: number, t: number): void {
    const d = this.w.d[j]!;
    const dev = this.devs[j]!;
    const st = this.st;
    if (d.cool > 0) d.cool--;
    switch (dev.kind) {
      case 'hamster_drive': {
        // drive.md: Pip sleeps (the wheel never spins) → bumped → startled → 6 s sprint (Spin source) → 1 s coast → sleep
        const k = d.occ;
        const poked = (d.bump >= HD.bumpJ || d.heard >= (this.crits[k]?.spec.hearDb ?? 999)) && d.cool === 0;
        if (k < 0) { this.motor(j, 0, 0); d.phase = 0; d.timer = 0; break; }
        if (d.phase === 0 && poked) {
          d.phase = 1; d.timer = this.ticks(0.5); d.cool = this.ticks(HD.bumpCooldown);
          this.setFsm(k, 'wheel_startled', 0.5);
          this.setEmote(k, '!', 1);
        } else if (d.timer > 0 && --d.timer === 0) {
          if (d.phase === 1) { d.phase = 2; d.timer = this.ticks(HD.sprint); this.setFsm(k, 'wheel_sprint', HD.sprint); this.setEmote(k, 'stopwatch', 2); }
          else if (d.phase === 2) { d.phase = 3; d.timer = this.ticks(HD.coast); this.setFsm(k, 'wheel_coast', HD.coast); this.setEmote(k, 'sweat', 1); }
          else { d.phase = 0; this.setFsm(k, 'wheel_sleep', -1); }
        }
        if (d.phase === 2) { this.motor(j, HD.omega, HD.torque); st.pressed[dev.part] = 2; }
        else if (d.phase === 3) this.motor(j, 0, 0);
        else this.motor(j, 0, 2); // asleep or startled: the wheel holds still
        d.flags = (d.phase === 2 ? DeviceFlagBits.running : 0) | DeviceFlagBits.occupied;
        break;
      }
      case 'pedal_rig': {
        // drive.md: a shiny lure in range (or on the bait hook) or a startling Sound sends Bandit to pedal 8 s per stimulus
        const rigId = this.h.parts[dev.part]!.id;
        if (t % THINK_EVERY === rigId % THINK_EVERY) d.lure = this.rigLure(j) ? 1 : 0;
        const fresh = d.lure === 1 && !(d.flags & DeviceFlagBits.lureSeen);
        const loud = d.heard >= 65;
        const stim = (fresh || loud) && d.cool === 0;
        d.flags = (d.flags & ~DeviceFlagBits.lureSeen) | (d.lure ? DeviceFlagBits.lureSeen : 0);
        if (stim) {
          d.cool = this.ticks(0.5);
          const k = d.occ;
          if (k >= 0 && d.phase === 1) d.timer = Math.min(d.timer + this.ticks(PR.run), this.ticks(PR.maxRun));
          else if (k >= 0 && this.w.c[k]!.fsm !== F.pedal_dismount && this.w.c[k]!.fsm !== F.pedal_mount) this.startPedal(j);
          else if (k < 0) this.callBandit(j);
        }
        if (d.phase === 1) {
          if (--d.timer <= 0) {
            if (d.lure) d.timer = this.ticks(PR.run); // the carrot is still dangling: keep going
            else { d.phase = 0; d.timer = 0; if (d.occ >= 0) this.setFsm(d.occ, 'pedal_dismount', 0.6); }
          }
        }
        if (d.phase === 1) { this.motor(j, PR.omega, PR.torque); st.pressed[dev.part] = 2; }
        else this.motor(j, 0, 0);
        d.flags = (d.flags & DeviceFlagBits.lureSeen) | (d.phase === 1 ? DeviceFlagBits.running : 0) | (d.occ >= 0 ? DeviceFlagBits.occupied : 0);
        break;
      }
      case 'fishbowl':
        d.flags = d.occ >= 0 ? DeviceFlagBits.occupied : 0;
        break;
      case 'trap_box':
        if (d.phase === 1) st.pressed[dev.part] = 2; // the flag is up
        d.flags = d.phase === 1 ? DeviceFlagBits.caught : 0;
        break;
    }
    d.bump = 0;
    d.heard = 0;
  }

  startPedal(j: number): void {
    const d = this.w.d[j]!;
    d.phase = 1;
    d.timer = this.ticks(PR.run);
    if (d.occ >= 0) { this.setFsm(d.occ, 'pedal', -1); this.setEmote(d.occ, 'pedal', 1.5); }
  }

  /** The nearest free Bandit within call range heads for the rig. */
  callBandit(j: number): void {
    const rig = this.socketWorld(j).p;
    let best = -1, bestD: number = PR.call;
    this.crits.forEach((cr, k) => {
      if (cr.spec.species !== 'bandit') return;
      const c = this.w.c[k]!;
      if (this.baseMode(c) !== 'free' || c.trap >= 0 || c.dev >= 0) return;
      if (this.is(c, 'getup', 'dizzy', 'steal_grab', 'goto_rig', 'pedal_mount')) return;
      const dd = vlen(vsub(this.posOf(cr.base), rig));
      if (dd < bestD) { bestD = dd; best = k; }
    });
    if (best < 0) return;
    const c = this.w.c[best]!;
    if (c.carry >= 0) this.drop(best);
    const m = this.mountPoint(j);
    c.gx = m[0]; c.gz = m[2]; c.target = this.devs[j]!.part; c.aux = j;
    c.speed = this.crits[best]!.spec.run;
    this.setFsm(best, 'goto_rig', 6);
    this.setEmote(best, 'sparkle', 1.5);
  }

  /** Where a critter thrown out of device j starts its ragdoll (and faces). */
  exitPose(j: number): { p: Vec; yaw: number } {
    const d = this.devs[j]!;
    const s = this.socketWorld(j);
    if (d.kind === 'hamster_drive' || d.kind === 'pedal_rig') {
      const p = this.h.parts[d.part]!;
      return { p: vadd(this.posOf(p.base), qrot(this.rotOf(p.base), d.kind === 'hamster_drive' ? HD.exit : PR.mount)), yaw: s.yaw };
    }
    return { p: this.posOf(this.crits[this.w.d[j]!.occ]!.base), yaw: s.yaw };
  }

  mountPoint(j: number): Vec {
    const p = this.h.parts[this.devs[j]!.part]!;
    return vadd(this.posOf(p.base), qrot(this.rotOf(p.base), PR.mount));
  }

  /** Is a shiny Lure within the rig's 1.5 m range of the saddle, or tied to its bait hook? */
  rigLure(j: number): boolean {
    const seat = this.socketWorld(j).p;
    const st = this.st;
    const rigPart = this.devs[j]!.part;
    for (const l of this.h.lines()) {
      if (l.cut) continue;
      const other = l.a === rigPart && l.aPort === 'bait' ? l.b : l.b === rigPart && l.bPort === 'bait' ? l.a : -1;
      if (other >= 0 && st.alive[other] && this.lures.some((x) => x.part === other && x.shiny)) return true;
    }
    for (const l of this.lures) {
      if (!l.shiny || !this.aliveKey(l.part) || this.carried(l.part)) continue;
      if (vlen(vsub(this.partCom(l.part), seat)) <= PR.range) return true;
    }
    return false;
  }

  carried(part: number): boolean { return this.w.c.some((c) => c.carry === part); }

  breakBowl(j: number, cause = -1): void {
    const d = this.w.d[j]!;
    if (d.phase !== 0) return;
    const part = this.devs[j]!.part;
    const st = this.st;
    const bowl = this.h.parts[part]!;
    const pos = this.posOf(bowl.base);
    const v = this.velOf(bowl.base);
    d.phase = 1;
    d.ax = pos[0]; d.ay = pos[1]; d.az = pos[2];
    // the glass shatters into its 21 pre-built chunks (frac_fishbowl.ts); a chunkless bowl just leaves play
    if (!this.h.shatter(part)) { st.broken[part] = true; this.h.applyAlive(part); }
    const at = vadd(pos, [0, 0.14, 0]);
    const brk = this.h.emit('Break', part, at, 0, -1, cause);
    // no Matter water before M4: a cosmetic splash (contraptions.md EMIT__burst__water)
    this.h.emit('Splash', part, at, 11.7, -1, brk);
    const k = d.occ;
    if (k >= 0) {
      const c = this.w.c[k]!;
      c.homeX = d.ax; c.homeY = d.ay + 0.03; c.homeZ = d.az;
      const a = this.rand(c, 0, 2 * Math.PI);
      this.ragdoll(k, [v[0] + dsin(a) * FB.burst, v[1] + 1.0, v[2] + dcos(a) * FB.burst], FB.jBreak, brk);
      c.flopT = this.ticks(FB.flop);
    }
  }

  /** TRAP BOX (frame.md): a resting, upright cage holds every critter whose centre is inside its catch volume. */
  trapCheck(): void {
    const w = this.w;
    this.devs.forEach((dev, j) => {
      if (dev.kind !== 'trap_box') return;
      const d = w.d[j]!;
      const p = this.h.parts[dev.part]!;
      if (!this.st.alive[dev.part]) return;
      const pos = this.posOf(p.base), rot = this.rotOf(p.base);
      const v = this.velOf(p.base);
      const up = qrot(rot, [0, 1, 0]);
      const resting = vlen(v) < TB.settle && up[1] > 0.9;
      const inv: Q = [-rot[0], -rot[1], -rot[2], rot[3]];
      let any = false;
      this.crits.forEach((cr, k) => {
        const c = w.c[k]!;
        const mode = this.baseMode(c);
        if (mode === 'rag' || mode === 'ghost' || mode === 'bound') { if (c.trap === j && mode !== 'rag') { c.trap = -1; c.flags &= ~CritterFlagBits.trapped; } return; }
        const l = qrot(inv, vsub(this.comOf(cr.base), pos));
        const m = c.trap === j ? 0.03 : 0;
        const inside = l[0] >= TB.catchMin[0] - m && l[0] <= TB.catchMax[0] + m && l[1] >= TB.catchMin[1] - m && l[1] <= TB.catchMax[1] + m && l[2] >= TB.catchMin[2] - m && l[2] <= TB.catchMax[2] + m;
        if (c.trap === j) {
          if (!inside || up[1] < 0.7) {
            c.trap = -1; c.flags &= ~CritterFlagBits.trapped;
            if (c.fsm === F.trapped) this.setFsm(k, 'idle', 1);
          } else any = true;
        } else if (c.trap < 0 && inside && resting) {
          c.trap = j; c.flags |= CritterFlagBits.trapped;
          if (c.carry >= 0) this.drop(k);
          c.target = -1; c.speed = 0;
          this.setFsm(k, 'trapped', -1);
          this.setEmote(k, cr.spec.huff, 2);
          this.h.emit('Trapped', cr.part, this.comOf(cr.base), 0, dev.part, this.h.cause(dev.part));
          any = true;
        }
      });
      d.phase = any ? 1 : 0;
    });
  }

  // ---- carrying (Bandit) ---------------------------------------------------------------------------------

  ghostItem(part: number, ghost: boolean): void {
    if (ghost) this.everCarried.add(part);
    const p = this.h.parts[part]!;
    const id = this.id(p.base);
    const L = this.h.layers;
    this.h.bi.SetObjectLayer(id, ghost ? L.ghost : L.moving);
    this.h.bi.SetGravityFactor(id, f32(ghost ? 0 : p.def.body.gravityFactor ?? 1));
  }

  carryFollow(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    if (isM5(cr.spec.species)) { this.m5.carryFollow(k); return; } // M5 (B5): BUZZ's load hangs under its claw
    if (!this.st.alive[c.carry]) { c.carry = -1; return; }
    const yaw = yawOf(this.rotOf(cr.base));
    const at = vadd(this.posOf(cr.base), qrot(yawQ(yaw), BANDIT_PROP_R));
    const item = this.h.parts[c.carry]!;
    this.h.bi.SetPositionRotationAndVelocity(this.id(item.base), this.rvec(at), this.quat(yawQ(yaw)), this.vec(0, 0, 0), this.vec2(0, 0, 0));
  }

  drop(k: number): void {
    const c = this.w.c[k]!;
    const part = c.carry;
    c.carry = -1;
    if (part < 0 || !this.st.alive[part]) return;
    this.ghostItem(part, false);
    const v = this.velOf(this.crits[k]!.base);
    const id = this.id(this.h.parts[part]!.base);
    this.h.bi.SetLinearVelocity(id, this.vec(v[0], 0, v[2]));
    this.h.bi.ActivateBody(id);
    if (isM5(this.crits[k]!.spec.species)) return; // M5 (B5): BUZZ goes back for what it dropped (it finishes the job)
    c.ignore = part;
    c.ignoreT = this.ticks(30);
  }

  /** Can Bandit take this part? Small, shiny, loose (no uncut line), not in someone's hands. */
  stealable(part: number): boolean {
    const st = this.st;
    if (part >= this.h.parts.length) return false; // bodiless lures can't be carried
    if (!st.alive[part] || this.carried(part)) return false;
    const p = this.h.parts[part]!;
    if (p.arm >= 0 || p.def.body.kind !== 'dynamic' || p.def.body.mass > SHINY_MAX_KG) return false;
    for (const l of this.h.lines()) if (!l.cut && (l.a === part || l.b === part)) return false;
    return true;
  }

  // ---- ragdoll follow and recovery ---------------------------------------------------------------------

  ragFollow(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    c.ragT++;
    const root = cr.rags[0]!;
    const p = this.posOf(root);
    const bad = !Number.isFinite(p[0] + p[1] + p[2]) || p[1] < -2;
    // settled = the root moved less than 0.1 m over the last second (mean speed < 0.1 m/s, SIMULATION
    // §7.4), so a tiny ragdoll's contact jitter doesn't keep it tumbling
    if (c.still === 0 || vlen(vsub(p, [c.ax, c.ay, c.az])) > RAG_STILL_SPEED) { c.ax = p[0]; c.ay = p[1]; c.az = p[2]; c.still = 0; }
    c.still++;
    // the ghost capsule rides along with the root (camera, picking, hashes)
    if (!bad) this.placeBase(k, [p[0], Math.max(p[1] - cr.spec.ragdoll[0]!.at[1], p[1] - 0.5), p[2]], yawOf(this.rotOf(cr.base)));
    if (bad || c.still >= this.h.tickRate || c.ragT >= this.ticks(RAG_FORCE_S)) this.recover(k);
  }

  // ---- think (every 4 ticks) ------------------------------------------------------------------------------

  canSee(k: number, target: readonly number[]): boolean {
    const cr = this.crits[k]!;
    const yaw = yawOf(this.rotOf(cr.base));
    const eye = vadd(this.posOf(cr.base), qrot(yawQ(yaw), cr.spec.eye));
    const d = vsub(target, eye);
    const dist = vlen(d);
    if (dist > cr.spec.vision) return false;
    const fwd: Vec = [dsin(yaw), 0, dcos(yaw)];
    if (dist > 1e-6 && vdot(d, fwd) / dist < 0.5736) return false; // cos 55°: a 110° cone
    return this.cast(eye, target, true, null) >= 0.98;
  }

  /**
   * The best lure target for critter k (SIMULATION §5.11: highest weight / (1 + distance) it can
   * perceive). Smell needs no line of sight; vision reaches further inside the cone (≤ 4 rays per think).
   */
  bestLure(k: number): { part: number; d: number } | null {
    const cr = this.crits[k]!;
    const c = this.w.c[k]!;
    const sp = cr.spec.species;
    const me = this.comOf(cr.base);
    const st = this.st;
    const cand: { part: number; w: number; d: number; smell: boolean }[] = [];
    for (const l of this.lures) {
      const wgt = l.species[sp] ?? 0;
      if (wgt <= 0 || !this.aliveKey(l.part) || l.part === c.ignore || this.carried(l.part)) continue;
      if (sp === 'bandit' && !this.stealable(l.part)) continue;
      const d = vlen(vsub(this.partCom(l.part), me));
      const radius = sp === 'bandit' ? Math.min(l.radius, cr.spec.smells.shiny ?? l.radius) : l.radius;
      if (d <= radius) cand.push({ part: l.part, w: wgt, d, smell: true });
      else if (d <= cr.spec.vision) cand.push({ part: l.part, w: wgt, d, smell: false });
    }
    // critters as lures: Pip → Mochi (8 m), a flopping Goby → Mochi (10 m)
    this.crits.forEach((o, ok) => {
      if (ok === k || !o.spec.lureAs) return;
      const radius = cr.spec.smells[o.spec.lureAs];
      if (!radius) return;
      const oc = this.w.c[ok]!;
      if (o.part === c.ignore) return;
      if (o.spec.lureAs === 'goby_flop' && oc.fsm !== F.flop) return;
      if (oc.fsm === F.bubble || oc.fsm === F.home || oc.dev >= 0 || (oc.flags & CritterFlagBits.ragdoll)) return;
      const d = vlen(vsub(this.comOf(o.base), me));
      if (d <= radius) cand.push({ part: o.part, w: o.spec.lureAs === 'goby_flop' ? 1.5 : 1, d, smell: true });
    });
    let best: { part: number; d: number; s: number } | null = null;
    cand.sort((a, b) => a.d - b.d || a.part - b.part);
    let rays = 0;
    for (const x of cand) {
      if (!x.smell) { if (rays >= 4) continue; rays++; if (!this.canSee(k, this.partCom(x.part))) continue; }
      const s = x.w / (1 + x.d);
      if (!best || s > best.s) best = { part: x.part, d: x.d, s };
    }
    return best ? { part: best.part, d: best.d } : null;
  }

  /** Nearest Mochi Pip notices: seen in his 4 m cone, or anywhere inside 2.5 m (SIMULATION §7.3). */
  threat(k: number): { at: Vec; d: number } | null {
    const me = this.comOf(this.crits[k]!.base);
    let best: { at: Vec; d: number } | null = null;
    this.crits.forEach((o, ok) => {
      if (o.spec.species !== 'mochi' || ok === k) return;
      const oc = this.w.c[ok]!;
      if (oc.flags & CritterFlagBits.ragdoll || oc.trap >= 0) return;
      const at = this.comOf(o.base);
      const d = vlen(vsub(at, me));
      if (d > 2.5 && !(d <= 4 && this.canSee(k, at))) return;
      if (!best || d < best.d) best = { at, d };
    });
    return best;
  }

  loudest(k: number): number {
    const c = this.w.c[k]!;
    if (c.heard <= 0) return 0;
    const cr = this.crits[k]!;
    const ear = vadd(this.posOf(cr.base), qrot(yawQ(yawOf(this.rotOf(cr.base))), cr.spec.eye));
    const blocked = this.cast(ear, [c.hx, c.hy + 0.05, c.hz], true, null) < 0.95;
    return c.heard - (blocked ? 12 : 0);
  }

  /**
   * A direction (horizontal, unit) bent back toward home once the critter is more than LEASH − 2 m out:
   * critters live on the set, and the M1 Studio's swept corners don't collide yet (D64).
   */
  leash(k: number, dir: readonly number[]): Vec {
    const c = this.w.c[k]!;
    const me = this.posOf(this.crits[k]!.base);
    const d = vnorm([dir[0]!, 0, dir[2]!]);
    const home: Vec = [c.homeX - me[0], 0, c.homeZ - me[2]];
    const far = hlen(home);
    const pull = clamp((far - (LEASH - 2)) / 2, 0, 1.5);
    if (pull <= 0) return d;
    const h = vscale(home, 1 / far);
    const out = vnorm([d[0] + h[0] * pull, 0, d[2] + h[2] * pull]);
    return out[0] === 0 && out[2] === 0 ? h : out;
  }

  wanderGoal(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const a = this.rand(c, 0, 2 * Math.PI), r = this.rand(c, 0.3, 1) * cr.spec.roam;
    c.gx = c.homeX + dsin(a) * r;
    c.gz = c.homeZ + dcos(a) * r;
    c.speed = cr.spec.walk;
    c.target = -1;
  }

  idleNext(k: number): void {
    const c = this.w.c[k]!;
    const sp = this.crits[k]!.spec.species;
    const r = this.rand(c);
    if (sp === 'goby') { this.setFsm(k, 'swim', this.rand(c, 2, 4)); return; }
    const napP = sp === 'mochi' ? 0.3 : sp === 'bandit' ? 0.12 : 0.15;
    if (r < napP) { this.setFsm(k, 'nap', this.rand(c, 6, 14)); c.speed = 0; this.setEmote(k, 'zzz', 2); return; }
    if (sp === 'mochi' && r < napP + 0.2) { this.setFsm(k, 'groom', 3); c.speed = 0; return; }
    if (r < 0.75) { this.wanderGoal(k); this.setFsm(k, 'wander', 8); return; }
    c.speed = 0;
    c.aux = this.rand(c) < 0.35 ? 1 : 0; // idle_alt
    this.setFsm(k, 'idle', this.rand(c, 1.5, 4));
  }

  startle(k: number, from: readonly number[], cause = -1): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const me = this.posOf(cr.base);
    const away = this.leash(k, [me[0] - from[0]!, 0, me[2] - from[2]!]);
    const id = this.id(cr.base);
    const v = this.velOf(cr.base);
    // Mochi's arched-back hop is 0.5 m up (SIMULATION §7.3); the others jump in place
    const up = cr.spec.species === 'mochi' ? Math.sqrt(2 * 9.81 * 0.5) : cr.spec.species === 'goby' ? 0.5 : 1.2;
    if (Math.abs(v[1]) < 0.6) {
      this.h.bi.SetLinearVelocity(id, this.vec(v[0] + away[0] * 0.6, up, v[2] + away[2] * 0.6));
      this.h.bi.ActivateBody(id);
    }
    c.gx = me[0] + away[0] * 2.5; c.gz = me[2] + away[2] * 2.5;
    c.speed = 0;
    c.target = -1;
    if (c.carry >= 0) this.drop(k);
    this.setFsm(k, 'startled', cr.spec.species === 'mochi' ? 0.8 : 0.5, true, cause);
    this.setEmote(k, '!', 1.2);
  }

  think(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const sp = cr.spec.species;
    const mode = this.baseMode(c);
    const heard = this.loudest(k);
    const touched = c.touch >= TOUCH_STARTLE;
    const from: Vec = touched && heard < cr.spec.hearDb ? vadd(this.posOf(cr.base), [0, 0, -1]) : [c.hx, c.hy, c.hz];
    const cause = heard >= cr.spec.hearDb ? c.hc : -1;
    const heardCause = c.hc; // PARTSIM (D121): BUZZ's startle has its own threshold (CRITTER_M5.buzz.startleDb)
    c.heard = 0;
    c.hc = -1;
    c.touch = 0;
    const imp = this.m4.takeImpact(k); // M4 (B4): HENNY's Impact-within-1.5 m stimulus
    if (mode === 'rag' || mode === 'ghost') return;
    if (this.is(c, 'getup', 'dizzy', 'indignant', 'startled', 'pounce', 'celebrate', 'steal_grab', 'pedal_mount', 'pedal_dismount', 'eat', 'lost')) return;
    if (mode === 'bound') {
      if (sp === 'goby' && c.fsm === F.swim && heard >= cr.spec.hearDb) { this.setFsm(k, 'flee', 0.6); this.setEmote(k, '!', 1); }
      return; // devices drive Pip in the wheel and Bandit on the rig
    }
    if (isM4(sp)) { this.m4.think(k, heard, touched, imp, from, cause); return; } // M4 (B4), trap included
    if (isM5(sp)) { this.m5.think(k, heard, heardCause, from); return; } // M5 (B5): BUZZ (touches don't startle it; PARTSIM: a big boom does)
    if (c.trap >= 0) return;
    if (sp === 'goby') return; // flopping on dry land: act() handles it
    // avoidance rays (SIMULATION §7.4: 3 forward rays)
    if (c.speed > 0.05) this.avoidRays(k); else c.avoid = 0;
    // fright beats everything
    const napping = c.fsm === F.nap;
    if ((heard >= cr.spec.hearDb || touched) && c.fsm !== F.goto_rig) { this.startle(k, from, cause); return; }
    if (napping && heard >= 45) { this.setFsm(k, 'idle', 1); this.setEmote(k, '?', 1); return; }
    if (sp === 'pip') { this.thinkPip(k); return; }
    if (sp === 'mochi') { this.thinkMochi(k, napping); return; }
    if (sp === 'bandit') this.thinkBandit(k, napping);
  }

  avoidRays(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const pos = this.posOf(cr.base);
    const yaw = yawOf(this.rotOf(cr.base));
    const want = datan2(c.gx - pos[0], c.gz - pos[2]);
    const h = cr.spec.capsule.at[1];
    // look ahead with speed, but never past the goal (a goal next to a device must stay reachable)
    const len = Math.min(0.3 + c.speed * 0.6, hlen([c.gx - pos[0], 0, c.gz - pos[2]]));
    const nose = cr.spec.capsule.length / 2;
    let portal = false; // M5 (B5): the middle ray ends in a paired RIFT GATE's aperture it fits through
    const blocked = [-0.5, 0, 0.5].map((off) => {
      const a = want + off;
      const dir: Vec = [dsin(a), 0, dcos(a)];
      const o = vadd(pos, [dir[0] * nose * 0.5, h, dir[2] * nose * 0.5]);
      const ray = vscale(dir, len + nose * 0.5);
      const hit = this.castHit(o, vadd(o, ray), cr.ignoreSelf);
      if (off === 0 && hit.f < 1 && this.riftOpen(k, hit.body, vadd(o, vscale(ray, hit.f)))) portal = true;
      return hit.f < 1;
    });
    void yaw;
    if (portal) { c.avoid = 0; return; } // straight in: the gate takes it to its partner
    const [l, m, r] = blocked as [boolean, boolean, boolean];
    if (!l && !m && !r) { c.avoid = 0; return; }
    if (m && l && r) { c.avoid = c.avoid !== 0 ? c.avoid : (this.rand(c) < 0.5 ? -1.4 : 1.4); return; }
    if (r && !l) c.avoid = -0.9;
    else if (l && !r) c.avoid = 0.9;
    else c.avoid = c.avoid !== 0 ? c.avoid : (this.rand(c) < 0.5 ? -0.9 : 0.9);
  }

  thinkMochi(k: number, napping: boolean): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    // M4 (B4): flee(Biscuit); nothing changes in worlds without a dog
    const dog = this.m4.dogThreat(k);
    if (dog) {
      const me = this.posOf(cr.base);
      const away = this.leash(k, [me[0] - dog.at[0], 0, me[2] - dog.at[2]]);
      c.gx = me[0] + away[0] * 2; c.gz = me[2] + away[2] * 2;
      c.speed = cr.spec.run;
      c.target = -1;
      if (c.fsm !== F.flee) this.setFsm(k, 'flee', 2); else c.dur = c.t + this.ticks(2);
      if (c.emote !== EM.dog_alert) this.setEmote(k, 'dog_alert', 1.5);
      return;
    }
    const prey = this.bestLure(k);
    if (prey && napping && prey.d > 4) return; // dozing: only something close wakes her
    if (prey) {
      // she won't chase off her patch (LEASH m from home)
      const at = this.partCom(prey.part);
      if (hlen([at[0] - c.homeX, 0, at[2] - c.homeZ]) > LEASH + 1) { if (c.fsm === F.chase || c.fsm === F.stalk) { c.target = -1; c.speed = 0; this.setFsm(k, 'lost', 1); this.setEmote(k, '?', 1); } return; }
    }
    if (prey) {
      if (c.target !== prey.part) { c.chaseT = 0; this.setEmote(k, this.critOfPart[prey.part]! >= 0 && this.crits[this.critOfPart[prey.part]!]!.spec.species === 'pip' ? 'eyes_pip' : 'snack_heart', 1.5); }
      c.target = prey.part;
      const at = this.partCom(prey.part);
      c.gx = at[0]; c.gz = at[2];
      if (c.chaseT > this.ticks(10)) {
        // she gives up, grumpy
        c.ignore = prey.part; c.ignoreT = this.ticks(8); c.target = -1; c.chaseT = 0;
        this.setFsm(k, 'indignant', 1.2); this.setEmote(k, 'grumpy', 1.5);
        return;
      }
      if (prey.d < 0.85 && (c.fsm === F.chase || c.fsm === F.stalk)) { c.speed = 0; c.aux = 0; this.setFsm(k, 'pounce', 1.1); return; }
      if (prey.d > 2.2 && c.fsm !== F.chase) { c.speed = 0.35; if (c.fsm !== F.stalk) this.setFsm(k, 'stalk', -1); return; }
      c.speed = cr.spec.run;
      if (c.fsm !== F.chase) this.setFsm(k, 'chase', -1);
      return;
    }
    if (c.fsm === F.stalk || c.fsm === F.chase) { c.target = -1; c.speed = 0; this.setFsm(k, 'lost', 1); this.setEmote(k, '?', 1); return; }
    this.routine(k);
  }

  thinkPip(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const th = this.threat(k);
    if (th) {
      const me = this.posOf(cr.base);
      const away = this.leash(k, [me[0] - th.at[0], 0, me[2] - th.at[2]]);
      c.gx = me[0] + away[0] * 2; c.gz = me[2] + away[2] * 2;
      c.speed = cr.spec.run;
      c.target = -1;
      if (c.fsm !== F.flee) { this.setFsm(k, 'flee', 2); this.setEmote(k, 'cat_alert', 1.5); }
      else c.dur = c.t + this.ticks(2);
      return;
    }
    if (c.fsm === F.flee) return;
    const food = this.bestLure(k);
    if (food) {
      const at = this.partCom(food.part);
      c.target = food.part; c.gx = at[0]; c.gz = at[2];
      if (food.d < 0.15) { c.speed = 0; this.setFsm(k, 'eat', 1.2); this.setEmote(k, 'seed', 1.5); c.ignore = food.part; c.ignoreT = this.ticks(20); return; }
      c.speed = cr.spec.run * 0.7;
      if (c.fsm !== F.seek) this.setFsm(k, 'seek', 10);
      return;
    }
    if (c.fsm === F.seek) { c.target = -1; this.setFsm(k, 'lost', 0.8); this.setEmote(k, '?', 1); return; }
    this.routine(k);
  }

  thinkBandit(k: number, napping: boolean): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    if (this.is(c, 'goto_rig', 'steal_carry', 'admire', 'flee')) return;
    const loot = napping ? null : this.bestLure(k);
    if (loot) {
      const at = this.partCom(loot.part);
      if (c.target !== loot.part) this.setEmote(k, 'sparkle', 1.5);
      c.target = loot.part; c.gx = at[0]; c.gz = at[2];
      if (loot.d < 0.4) { c.speed = 0; this.setFsm(k, 'steal_grab', 0.7); this.setEmote(k, 'grin', 1); return; }
      c.speed = cr.spec.walk * 1.3;
      if (c.fsm !== F.seek) this.setFsm(k, 'seek', 12);
      return;
    }
    if (c.fsm === F.seek) { c.target = -1; this.setFsm(k, 'lost', 0.8); this.setEmote(k, '?', 1); return; }
    this.routine(k);
  }

  /** Idle / wander / nap / groom cycling, plus giving up on unreachable goals. */
  routine(k: number): void {
    const c = this.w.c[k]!;
    if (c.fsm === F.wander) {
      const p = this.posOf(this.crits[k]!.base);
      if (hlen([c.gx - p[0], 0, c.gz - p[2]]) < 0.15 || c.stuck > this.ticks(1.5)) { c.speed = 0; c.stuck = 0; this.setFsm(k, 'idle', this.rand(c, 1, 3)); }
      return;
    }
    if (c.fsm === F.lost || c.fsm === F.trapped) { this.setFsm(k, 'idle', 1); return; }
  }

  // ---- act (every tick) --------------------------------------------------------------------------------

  timeUp(c: CritSt): boolean { return c.dur >= 0 && c.t >= c.dur; }

  act(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const sp = cr.spec.species;
    const mode = this.baseMode(c);
    if (mode === 'rag') { this.finish(k); return; }
    if (mode === 'bound') { this.actBound(k); this.finish(k); return; }
    if (mode === 'ghost') { this.actGhost(k); this.finish(k); return; }
    if (isM4(sp)) { this.m4.act(k); this.finish(k); return; } // M4 (B4): BISCUIT, HENNY, DUSTY
    if (isM5(sp)) { this.m5.act(k); this.finish(k); return; } // M5 (B5): BUZZ
    // timed states
    if (this.timeUp(c)) {
      switch (c.fsm) {
        case F.getup: this.setFsm(k, 'dizzy', 2); this.setEmote(k, 'stars', 2); break;
        case F.dizzy: this.setFsm(k, 'indignant', 1); this.setEmote(k, cr.spec.huff, 1.2); break;
        case F.indignant: case F.lost: case F.celebrate: case F.eat: case F.admire: case F.groom: case F.nap: case F.idle:
          if (sp === 'goby') break;
          this.idleNext(k); break;
        case F.wander: c.speed = 0; this.setFsm(k, 'idle', 1); break;
        case F.startled: c.speed = cr.spec.run; this.setFsm(k, 'flee', 2); break;
        case F.flee: case F.seek: c.speed = 0; c.target = -1; this.setFsm(k, 'idle', 1); break;
        case F.pounce:
          if (c.aux === 1) {
            this.setFsm(k, 'celebrate', 1.5); this.setEmote(k, 'snack_heart', 1.5);
            // a pounce on Goby calls the rescue bubble early (critters.md gag)
            const ok = this.critOfPart[c.target] ?? -1;
            if (ok >= 0 && this.crits[ok]!.spec.species === 'goby' && this.w.c[ok]!.fsm === F.flop) this.w.c[ok]!.flopT = 1;
          } else { this.setFsm(k, 'lost', 1); this.setEmote(k, '?', 1); }
          c.target = -1; c.aux = 0;
          break;
        case F.steal_grab: {
          // the item snaps to the right palm (critters.md steal_grab frame 12)
          if (c.target >= 0 && this.stealable(c.target) && vlen(vsub(this.partCom(c.target), this.comOf(cr.base))) < 0.7) {
            c.carry = c.target;
            this.ghostItem(c.carry, true);
            const me = this.posOf(cr.base);
            const a = this.rand(c, -0.6, 0.6) + datan2(me[0] - c.homeX, me[2] - c.homeZ + 1e-6);
            const hide = this.leash(k, [dsin(a), 0, dcos(a)]);
            c.gx = me[0] + hide[0] * 2.5; c.gz = me[2] + hide[2] * 2.5;
            c.speed = 0.6;
            this.setFsm(k, 'steal_carry', 8);
          } else { c.target = -1; this.setFsm(k, 'lost', 0.8); }
          break;
        }
        case F.steal_carry:
          if (c.carry >= 0) this.drop(k);
          c.speed = 0; c.target = -1;
          this.setFsm(k, 'admire', 2); this.setEmote(k, 'sparkle', 2);
          break;
        case F.goto_rig: c.speed = 0; c.target = -1; this.setFsm(k, 'idle', 1); break;
        case F.pedal_mount: {
          const j = c.aux;
          if (j >= 0 && this.w.d[j]!.occ < 0) { this.bind(k, j); this.startPedal(j); }
          else this.setFsm(k, 'idle', 1);
          break;
        }
        case F.trapped: break;
        default: break;
      }
    }
    // state behaviour
    switch (c.fsm) {
      case F.steal_carry: {
        const p = this.posOf(cr.base);
        if (hlen([c.gx - p[0], 0, c.gz - p[2]]) < 0.2 || c.stuck > this.ticks(1.5)) c.dur = c.t; // arrived at the hideout
        break;
      }
      case F.goto_rig: {
        const p = this.posOf(cr.base);
        const m = this.mountPoint(c.aux);
        c.gx = m[0]; c.gz = m[2];
        if (hlen([m[0] - p[0], 0, m[2] - p[2]]) < 0.3) {
          c.speed = 0;
          if (this.w.d[c.aux]!.occ < 0) this.setFsm(k, 'pedal_mount', 0.6); else this.setFsm(k, 'idle', 1);
        }
        break;
      }
      case F.pounce:
        if (c.t === this.ticks(0.4)) {
          // butt-wiggle over: leap (critters.md pounce: 0.9 m on a ballistic arc)
          const p = this.posOf(cr.base);
          const d = vnorm([c.gx - p[0], 0, c.gz - p[2]]);
          this.h.bi.SetLinearVelocity(this.id(cr.base), this.vec(d[0] * 2.4, 2.2, d[2] * 2.4));
          this.h.bi.ActivateBody(this.id(cr.base));
        }
        break;
      case F.flop: this.actFlop(k); break;
      default: break;
    }
    const steering = c.fsm !== F.pounce && c.fsm !== F.startled && c.fsm !== F.flop && c.fsm !== F.trapped;
    if (steering) this.steer(k);
    else if (c.fsm === F.trapped) this.faceTrap(k);
    else if (c.t > this.ticks(c.fsm === F.pounce ? 0.5 : 0.1)) this.brake(k, 2 * cr.spec.accel); // landed from a leap or hop
    this.finish(k);
  }

  /** The capsule has no friction: on the ground, take horizontal speed off at `decel` m/s². */
  brake(k: number, decel: number): void {
    const cr = this.crits[k]!;
    const v = this.velOf(cr.base);
    if (Math.abs(v[1]) > 0.3) return;
    const hs = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    if (hs < 1e-4) return;
    const s = Math.max(0, hs - decel / this.h.tickRate) / hs;
    this.h.bi.SetLinearVelocity(this.id(cr.base), this.vec(v[0] * s, v[1], v[2] * s));
  }

  /** Horizontal velocity toward the goal with max acceleration, turning toward travel (SIMULATION §7.4). */
  steer(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const id = this.id(cr.base);
    const pos = this.posOf(cr.base);
    const v = this.velOf(cr.base);
    const yaw = yawOf(this.rotOf(cr.base));
    const dt = 1 / this.h.tickRate;
    const toGoal: Vec = [c.gx - pos[0], 0, c.gz - pos[2]];
    const dist = hlen(toGoal);
    const moving = c.speed > 0 && dist > 0.05;
    let want = yaw;
    let vx = 0, vz = 0;
    if (moving) {
      want = datan2(toGoal[0], toGoal[2]) + c.avoid;
      const s = Math.min(c.speed, dist * 3);
      vx = dsin(want) * s; vz = dcos(want) * s;
    } else if (c.target >= 0 && this.aliveKey(c.target)) {
      const at = this.partCom(c.target);
      want = datan2(at[0] - pos[0], at[2] - pos[2]);
    }
    const grounded = Math.abs(v[1]) < 0.6;
    if (grounded) {
      let dx = vx - v[0], dz = vz - v[2];
      const dl = Math.sqrt(dx * dx + dz * dz), maxD = cr.spec.accel * dt;
      if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
      if (dl > 1e-5 || moving) {
        this.h.bi.SetLinearVelocity(id, this.vec(v[0] + dx, v[1], v[2] + dz));
        if (moving) this.h.bi.ActivateBody(id);
      }
    }
    const turn = clamp(wrapPi(want - yaw) * 8, -cr.spec.turn, cr.spec.turn);
    if (Math.abs(turn) > 1e-3 || moving) this.h.bi.SetAngularVelocity(id, this.vec(0, turn, 0));
    // stuck: asked to move but barely moving
    const hs = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    c.stuck = moving && hs < 0.25 * c.speed ? c.stuck + 1 : Math.max(0, c.stuck - 2);
    if (c.stuck > this.ticks(3) && c.fsm !== F.wander) { c.stuck = 0; c.avoid = -c.avoid || 1.2; }
  }

  faceTrap(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const id = this.id(cr.base);
    const box = this.h.parts[this.devs[c.trap]!.part]!;
    const by = yawOf(this.rotOf(box.base)) + Math.PI / 2;
    const yaw = yawOf(this.rotOf(cr.base));
    // the long X axis either way round, whichever is nearer (frame.md: turned over 0.2 s)
    let e = wrapPi(by - yaw);
    if (Math.abs(e) > Math.PI / 2) e = wrapPi(e + Math.PI);
    const v = this.velOf(cr.base);
    this.h.bi.SetLinearVelocity(id, this.vec(v[0] * 0.8, v[1], v[2] * 0.8));
    this.h.bi.SetAngularVelocity(id, this.vec(0, clamp(e * 10, -8, 8), 0));
  }

  /** GOBY on dry land: comic hops every 0.5 s for 8 s (a Lure for Mochi), then the rescue bubble. */
  actFlop(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    if (c.flopT > 0) c.flopT--;
    if (c.flopT <= 0) {
      const p = this.posOf(cr.base);
      c.gx = p[0]; c.gy = p[1]; c.gz = p[2];
      // MI (M4): with Matter on, the bubble carries him to water deep enough to swim in within 3 m (a container holding
      // ≥ 2 L: TANK, another FISHBOWL, a filled SCOOP; SIMULATION §7.3); otherwise home is the empty cradle as before
      const wet = (this.h.matter() as { waterNear?(p: readonly number[], r: number): { at: readonly number[] } | null } | null)?.waterNear?.(p, 3);
      if (wet) { c.homeX = wet.at[0]!; c.homeY = wet.at[1]! - 0.05; c.homeZ = wet.at[2]!; }
      this.setBaseFree(k, false);
      this.setFsm(k, 'bubble', FB.rescue);
      this.setEmote(k, 'kiss', 1.2);
      return;
    }
    if (c.t % this.ticks(0.5) === 0) {
      const v = this.velOf(cr.base);
      if (Math.abs(v[1]) < 0.3) {
        const a = this.rand(c, 0, 2 * Math.PI);
        const s = this.rand(c, 0.05, 0.2);
        const id = this.id(cr.base);
        this.h.bi.SetLinearVelocity(id, this.vec(dsin(a) * s, 0.77, dcos(a) * s));
        this.h.bi.SetAngularVelocity(id, this.vec(0, this.rand(c, -6, 6), 0));
        this.h.bi.ActivateBody(id);
      }
      if (c.t % this.ticks(2) === 0) this.setEmote(k, 'water_drop', 1);
    }
  }

  actBound(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const kind = this.devs[c.dev]!.kind;
    if (kind === 'fishbowl') {
      // GOBY swims inside the bowl's swim volume (contraptions.md SENSOR__catch__swim, ≥ 0.05 m inside)
      if (this.timeUp(c)) {
        if (c.fsm === F.swim || c.fsm === F.flee) {
          const r = this.rand(c);
          if (r < 0.2) { c.aux = 1; this.setFsm(k, 'idle', this.rand(c, 1, 2.5)); }
          else if (r < 0.28) { this.setFsm(k, 'nap', this.rand(c, 3, 6)); this.setEmote(k, 'zzz', 2); }
          else {
            this.setFsm(k, 'swim', this.rand(c, 2, 4));
            c.gx = this.rand(c, -1, 1) * FB.swimHalf[0]; c.gy = this.rand(c, -1, 1) * FB.swimHalf[1]; c.gz = this.rand(c, -1, 1) * FB.swimHalf[2];
          }
        } else { this.setFsm(k, 'swim', this.rand(c, 2, 4)); c.aux = 0; }
      }
      if (c.fsm === F.swim || c.fsm === F.flee) {
        const sp = (c.fsm === F.flee ? cr.spec.run : cr.spec.walk) / this.h.tickRate;
        const d: Vec = [c.gx - c.lx, c.gy - c.ly, c.gz - c.lz];
        const l = vlen(d);
        if (l > 1e-4) {
          const s = Math.min(sp, l) / l;
          c.lx += d[0] * s; c.ly += d[1] * s; c.lz += d[2] * s;
          if (Math.abs(d[0]) + Math.abs(d[2]) > 1e-4) c.avoid = datan2(d[0], d[2]);
        }
        const hx = FB.swimHalf;
        c.lx = clamp(c.lx, -hx[0], hx[0]); c.ly = clamp(c.ly, -hx[1], hx[1]); c.lz = clamp(c.lz, -hx[2], hx[2]);
      }
    } else if (kind === 'pedal_rig') {
      if (c.fsm === F.pedal_dismount && this.timeUp(c)) {
        const j = c.dev;
        const m = this.mountPoint(j);
        this.unbind(k);
        this.placeBase(k, m, this.socketWorld(j).yaw);
        this.setBaseFree(k, true);
        c.speed = 0;
        this.setFsm(k, 'idle', 1.5);
        return;
      }
      if (c.fsm !== F.pedal && c.fsm !== F.pedal_dismount && c.fsm !== F.idle) this.setFsm(k, 'idle', -1);
    }
    if (c.dev >= 0) this.followDevice(k);
  }

  actGhost(k: number): void {
    const c = this.w.c[k]!;
    if (c.fsm === F.bubble) {
      // the rescue bubble floats Goby home (no Matter water before M4: home is the empty cradle)
      const u = Math.min(1, c.t / Math.max(1, c.dur));
      const lift = 0.25 * dsin(u * Math.PI);
      const p: Vec = [c.gx + (c.homeX - c.gx) * u, c.gy + (c.homeY - c.gy) * u + lift, c.gz + (c.homeZ - c.gz) * u];
      this.placeBase(k, p, yawOf(this.rotOf(this.crits[k]!.base)));
      if (this.timeUp(c)) { c.aux = 2; this.setFsm(k, 'home', -1); this.setEmote(k, 'heart', 1.5); }
    } else if (c.fsm === F.home) {
      this.placeBase(k, [c.homeX, c.homeY, c.homeZ], yawOf(this.rotOf(this.crits[k]!.base)));
    }
  }

  /** Clip (visual hint) and flags for the renderer. */
  finish(k: number): void {
    const c = this.w.c[k]!;
    const cr = this.crits[k]!;
    const sp = cr.spec.species;
    let clip: CritterClip = 'idle';
    switch (c.fsm) {
      case F.idle: clip = c.dev >= 0 && sp === 'goby' ? (c.aux === 1 ? 'idle_alt' : 'idle') : c.aux === 1 ? (sp === 'bandit' ? 'wash_hands' : 'idle_alt') : 'idle'; break;
      case F.wander: clip = 'walk'; break;
      case F.nap: clip = 'sleep'; break;
      case F.groom: clip = 'groom'; break;
      case F.stalk: clip = 'stalk'; break;
      case F.chase: clip = 'chase'; break;
      case F.pounce: clip = 'pounce'; break;
      case F.startled: clip = sp === 'mochi' ? 'arch_scared' : 'startled'; break;
      case F.flee: clip = 'flee'; break;
      case F.trapped: clip = 'trapped'; break;
      case F.ragdoll: clip = 'tumble'; break;
      case F.getup: clip = 'getup'; break;
      case F.dizzy: clip = 'dizzy'; break;
      case F.indignant: clip = 'emote_angry'; break;
      case F.celebrate: clip = 'celebrate'; break;
      case F.seek: clip = c.speed > cr.spec.walk * 1.2 ? 'run' : 'walk'; break;
      case F.eat: clip = sp === 'pip' ? 'stuff_cheeks' : 'sniff'; break;
      case F.lost: clip = 'emote_confused'; break;
      case F.wheel_sleep: clip = 'sleep'; break;
      case F.wheel_startled: clip = 'startled'; break;
      case F.wheel_sprint: clip = 'wheel_sprint'; break;
      case F.wheel_coast: clip = 'idle'; break;
      case F.swim: clip = 'swim'; break;
      case F.flop: clip = 'flop'; break;
      case F.bubble: clip = 'bubble_rescue'; break;
      case F.home: clip = 'idle'; break;
      case F.steal_grab: clip = 'steal_grab'; break;
      case F.steal_carry: clip = 'steal_carry'; break;
      case F.admire: clip = 'loot_admire'; break;
      case F.goto_rig: clip = 'run'; break;
      case F.pedal_mount: clip = 'pedal_mount'; break;
      case F.pedal: clip = 'pedal'; break;
      case F.pedal_dismount: clip = 'pedal_dismount'; break;
      default: clip = 'idle';
    }
    const m4 = isM4(sp), m5 = isM5(sp);
    if (m4) clip = this.m4.clip(k) ?? clip; // M4 (B4)
    if (m5) clip = this.m5.clip(k) ?? clip; // M5 (B5)
    if (!cr.spec.clips.includes(clip)) clip = 'idle';
    c.clip = CL[clip];
    const asleep = c.fsm === F.nap || c.fsm === F.wheel_sleep || (m4 && this.m4.asleep(c)) || (m5 && this.m5.asleep(c));
    c.flags = (c.flags & (CritterFlagBits.ragdoll | CritterFlagBits.trapped)) | (asleep ? CritterFlagBits.asleep : 0) | (c.dev >= 0 ? CritterFlagBits.inDevice : 0)
      | (m4 ? this.m4.flags(k) : 0) | (m5 ? this.m5.flags(k) : 0);
    if (asleep && c.emote === 0 && c.t % this.ticks(3) === 0) this.setEmote(k, 'zzz', 2);
  }
}
