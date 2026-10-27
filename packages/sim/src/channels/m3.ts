// M3 parts (stream A3 · sim parts): the build-time pieces and pools, the per-stage dispatch and the shared helpers
// for the 30 M3 catalogue rows. PartChannels (index.ts) owns one `M3Parts` and calls it from the same Machine hooks
// as the M2 parts, plus three M3 hooks (`demand`, `blastHit`, `stageSpawn`) and the GLIDEPATH link builder.
//
//   m3_motion.ts   SPINDECK, LIFT, RACK, RAM, PINGER, BONKER, PADDLE, SNAPTRAP, FLINGER, GLIDEPATH booster
//   m3_boom.ts     POWDER KEG, JITTERJUICE, SKYSHOW, FLAMER, POPPER
//   m3_field.ts    MAGLOCK, ZONE, BUMPER, PING
//   m3_fun.ts      PANE / VASE, TONEBARS, DING, PINS
//   m3_future.ts   FABRICATOR, RECYCLER
//   glidepath.ts   GLIDEPATH rails and riders
//   light.ts       LANCE, MIRROR, SPLITTER, TRIPWIRE (stage 4, with the M2 optics)
//
// Determinism (SIMULATION §10): part order everywhere, detmath only, all run state in `st.m2.m3` (and the per-part
// `st.m2` arrays). Every body a part may put in play is pre-built dormant with the world (D66) and never pushed while
// dormant (rule 8): `eachPushable` is the only way M3 forces find bodies.

import { f32, type Hasher } from '@knockon/detmath';
import { FABRICATOR, M3_TYPES, SKYSHOW, SPAWNABLE, partDef, type PartDef, type ShapeDef } from '@knockon/parts-data';
import type { JoltModule } from '@knockon/jolt';
import { qrot, vadd, type Vec } from '../vec.ts';
import { L_GHOST, L_MOVING, type HostBody } from './host.ts';
import type { PartChannels } from './index.ts';

export { M3_TYPES };

/** A pushable body found by `eachPushable`: its part, body index, the def it behaves as (null: a SKYSHOW shell), bounds. */
export interface Pushable { readonly part: number; readonly body: number; readonly def: PartDef | null; readonly half: number }

export class M3Parts {
  readonly c: PartChannels;
  /** True once any M3 part is in the machine: gates the M3 hash block. */
  active = false;
  /** Part → its pool slots (FABRICATOR parts, SKYSHOW shells). */
  readonly pools: number[][] = [];
  readonly slotBody: number[] = [];
  readonly slotPart: number[] = [];
  /** Slot → the part def it behaves as (FABRICATOR), null = the owner's piece (SKYSHOW shell). */
  readonly slotDef: (PartDef | null)[] = [];
  /** Slot → where it waits while dormant (well below the floor, out of sight). */
  readonly park: Vec[] = [];
  /** Part → its one M3 piece body (LIFT deck, RACK bar), −1. */
  readonly piece: number[] = [];
  /** Part → its M3 slider (RAM rod, PINGER striker, RACK bar). */
  readonly slider: (JoltModule | null)[] = [];
  /** PINS racks: pins within 0.2 m of each other at the start, part order. */
  racks: number[][] = [];
  /** Heat sources of this tick's stage 5 (the Machine's array, complete by the time `heatProbe` runs). */
  heatRef: number[] | null = null;
  /** World gravity (m/s², positive down), read once. */
  gravity = 9.81;
  /** Light beam segments of the last stage 4 for the renderer (8 floats each, Machine.lightBeams). */
  readonly beams: number[] = [];
  /**
   * PING: Rx parts already relayed this tick (cycle guard). Scratch for one tick, so it isn't checkpointed: afterRestore
   * empties it (SIMFIX, rule 14). Left as it was, a rollback that re-ran the tick a PING fired on skipped the relay.
   */
  wTick = -1;
  readonly wFired = new Set<number>();
  /** Stage-9 scratch (cleared every tick). */
  readonly deckMass = new Map<number, number>();
  readonly pedalMass = new Map<number, number>();
  readonly pedalCause = new Map<number, number>();
  readonly kicked = new Set<number>();

  constructor(c: PartChannels) { this.c = c; }

  // ---- building (before `st` exists) --------------------------------------------------------------------------

  /** After the Machine built part `i` (base, hinge arm): its M3 pieces, sliders and pools. */
  onBuild(i: number): void {
    const h = this.c.h, p = h.parts[i]!, def = p.def;
    this.pools[i] = [];
    this.piece[i] = -1;
    this.slider[i] = null;
    if (!M3_TYPES.has(def.type)) return;
    this.active = true;
    switch (def.type) {
      case 'lift': {
        // the deck rides as the part's arm (kinematic, moved by its behaviour), so motion reads like other actuators
        const deck = def.shapes(p.props).filter((s) => s.on === 'arm').map((s): ShapeDef => ({ ...s, on: 'base' }));
        p.arm = this.body(i, 'lift:deck', deck, p.pos, p.rot, 'kinematic', 1.5, def.body.friction, def.body.restitution, false, undefined, 'arm');
        break;
      }
      case 'rack': buildRack(this, i); break;
      case 'ram': this.slider[i] = buildSlider(this, i, [0, 0.05, 0.2375], [0, 0, 1], [0, 0.25], 0.3, 0.9, 0.3, 'arm'); break;
      case 'pinger': this.slider[i] = buildSlider(this, i, [0, 0.055, 0.145], [0, 0, 1], [-0.06, 0.04], 0.5, 0.6, 0.3, 'arm'); break;
      case 'skyshow': {
        const pc = def.piece!;
        for (let k = 0; k < SKYSHOW.tubes.length; k++) this.slot(i, this.body(i, 'skyshow:shell', pc.shapes, this.parkAt(i, k), [0, 0, 0, 1], 'pooled', pc.mass, pc.friction, pc.restitution, pc.ccd ?? false, k), null);
        break;
      }
      case 'fabricator': {
        const t = SPAWNABLE[Math.max(0, Math.min(SPAWNABLE.length - 1, Math.round(p.props.part ?? 0)))]!;
        const sd = partDef(t)!;
        const n = Math.max(1, Math.min(FABRICATOR.max, Math.round(p.props.count ?? 5)));
        for (let k = 0; k < n; k++) {
          this.slot(i, this.body(i, `${t}:pool`, sd.shapes({}), this.parkAt(i, k), p.rot, 'pooled', sd.body.mass, sd.body.friction, sd.body.restitution, sd.body.ccd ?? false, k), sd);
        }
        break;
      }
      default:
    }
  }

  /** Where pool slot k of part i waits: 30 m under the part, spaced so dormant bodies never overlap. */
  private parkAt(i: number, k: number): Vec { const p = this.c.h.parts[i]!.pos; return [p[0], -30 - 0.5 * k, p[2]]; }

  private slot(i: number, body: number, def: PartDef | null): void {
    const s = this.slotBody.length;
    this.slotBody.push(body);
    this.slotPart.push(i);
    this.slotDef.push(def);
    const b = this.c.h.bodies[body]!.body;
    const pos = b.GetPosition();
    this.park.push([pos.GetX(), pos.GetY(), pos.GetZ()]);
    this.pools[i]!.push(s);
  }

  /**
   * A body of part `i` (role 'piece', or 'arm' for sliders). 'pooled' bodies start dormant: a gravity-free ghost,
   * asleep at their park position (D66). 'kinematic' bodies are moved by their behaviour (LIFT deck).
   */
  body(i: number, key: string, shapes: readonly ShapeDef[], pos: readonly number[], rot: readonly number[], kind: 'dynamic' | 'kinematic' | 'pooled',
    mass: number, friction: number, restitution: number, ccd: boolean, chunk?: number, role: 'piece' | 'arm' = 'piece'): number {
    const h = this.c.h, J = h.Jolt;
    const shape = h.shapeFor(key, shapes);
    const kin = kind === 'kinematic', pooled = kind === 'pooled';
    const cs = new J.BodyCreationSettings(shape, new J.RVec3(f32(pos[0]!), f32(pos[1]!), f32(pos[2]!)), new J.Quat(f32(rot[0]!), f32(rot[1]!), f32(rot[2]!), f32(rot[3]!)),
      kin ? J.EMotionType_Kinematic : J.EMotionType_Dynamic, pooled ? L_GHOST : L_MOVING);
    cs.mFriction = f32(friction);
    cs.mRestitution = f32(restitution);
    cs.mGravityFactor = f32(pooled ? 0 : 1);
    const index = h.bodies.length;
    cs.mUserData = index;
    if (!kin) {
      cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      cs.mMassPropertiesOverride.mMass = f32(mass);
      if (ccd) cs.mMotionQuality = J.EMotionQuality_LinearCast;
    }
    const body = h.bi.CreateBody(cs);
    J.destroy(cs);
    h.bi.AddBody(body.GetID(), pooled || kin ? J.EActivation_DontActivate : J.EActivation_Activate);
    const rec: HostBody = { part: i, role, body, dynamic: !kin, ghost: false, ...(chunk !== undefined ? { chunk } : {}) };
    h.bodies.push(rec);
    return index;
  }

  // ---- run state -------------------------------------------------------------------------------------------

  /** After `st` exists: pool slot state, PINS racks, the world's gravity. */
  init(): void {
    const h = this.c.h, m3 = h.st.m2.m3;
    for (let s = 0; s < this.slotBody.length; s++) { m3.live.push(0); m3.born.push(-1); m3.y0.push(0); m3.why.push(-1); }
    const g = h.system.GetGravity();
    this.gravity = -g.GetY();
    // PINS racks: union-find of pins within 0.2 m of each other at the start
    const pins = this.c.list('pin');
    const uf = pins.map((_, k) => k);
    const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]!]!; x = uf[x]!; } return x; };
    for (let a = 0; a < pins.length; a++) {
      for (let b2 = a + 1; b2 < pins.length; b2++) {
        const pa = h.parts[pins[a]!]!.pos, pb = h.parts[pins[b2]!]!.pos;
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
        if (dx * dx + dy * dy + dz * dz <= 0.04) uf[find(a)] = find(b2);
      }
    }
    const groups = new Map<number, number[]>();
    pins.forEach((i, k) => { const r = find(k); const g2 = groups.get(r) ?? []; g2.push(i); groups.set(r, g2); });
    this.racks = [...groups.values()].filter((g2) => g2.length >= 2).sort((x, y) => x[0]! - y[0]!);
    for (let r = 0; r < this.racks.length; r++) m3.strike.push(0);
  }

  /** Is pool slot `s` in play? */
  live(s: number): boolean { return this.c.h.st.m2.m3.live[s] === 1; }

  /** Puts pool slot `s` in play at `pos` with velocity `vel` (FABRICATOR spawn, SKYSHOW launch). */
  spawn(s: number, pos: readonly number[], rot: readonly number[], vel: readonly number[]): void {
    const h = this.c.h, J = h.Jolt, m3 = h.st.m2.m3;
    const b = h.bodies[this.slotBody[s]!]!.body, id = b.GetID();
    m3.live[s] = 1;
    m3.born[s] = h.st.tick;
    m3.y0[s] = pos[1]!;
    this.layer(s);
    h.bi.SetPositionRotationAndVelocity(id, new J.RVec3(f32(pos[0]!), f32(pos[1]!), f32(pos[2]!)), new J.Quat(f32(rot[0]!), f32(rot[1]!), f32(rot[2]!), f32(rot[3]!)),
      h.v3(vel[0]!, vel[1]!, vel[2]!), this.c.zero);
    h.bi.ActivateBody(id);
  }

  /** Returns pool slot `s` to its pool: dormant, parked, still (RECYCLER, SKYSHOW burst). */
  despawn(s: number): void {
    const h = this.c.h, J = h.Jolt, m3 = h.st.m2.m3;
    const b = h.bodies[this.slotBody[s]!]!.body, id = b.GetID();
    m3.live[s] = 0;
    this.layer(s);
    const q = this.park[s]!;
    h.bi.SetPositionRotationAndVelocity(id, new J.RVec3(f32(q[0]), f32(q[1]), f32(q[2])), new J.Quat(0, 0, 0, 1), this.c.zero, this.c.zero);
    h.bi.DeactivateBody(id);
  }

  /** Object layer and gravity of a pool slot from its state (Jolt's state doesn't record them: re-applied on restore). */
  layer(s: number): void {
    const h = this.c.h, id = h.bodies[this.slotBody[s]!]!.body.GetID();
    const on = this.live(s) && h.st.alive[this.slotPart[s]!]!;
    h.bi.SetObjectLayer(id, on ? L_MOVING : L_GHOST);
    h.bi.SetGravityFactor(id, f32(on ? (this.slotDef[s]?.body.gravityFactor ?? 1) : 0));
  }

  /** Body indices of part `i`'s M3 bodies that are in play and pushable (live pool slots, the RACK bar). */
  livePieces(i: number): number[] {
    const out: number[] = [];
    for (const s of this.pools[i] ?? []) if (this.live(s)) out.push(this.slotBody[s]!);
    const pc = this.piece[i] ?? -1;
    if (pc >= 0 && this.c.h.bodies[pc]!.dynamic) out.push(pc);
    return out;
  }

  /**
   * After a checkpoint restore: pool layers and gravity (rails re-enable their riders in glidepath.ts). SIMFIX: and PING's
   * relay guard is emptied, as it is at every tick boundary (checkpoints sit between ticks).
   */
  afterRestore(): void {
    for (let s = 0; s < this.slotBody.length; s++) this.layer(s);
    this.wTick = -1;
    this.wFired.clear();
  }

  hash(hs: Hasher): void {
    if (!this.active) return;
    const m3 = this.c.h.st.m2.m3;
    hs.u32(m3.live.length);
    for (let s = 0; s < m3.live.length; s++) hs.i32(m3.live[s]!).i32(m3.born[s]!);
    for (let i = 0; i < m3.n.length; i++) hs.i32(m3.n[i]!).i32(m3.heatAt[i]!).q(m3.cook[i]!, 1e-4).i32(m3.hold[i]!);
    hs.u32(m3.ride.length);
    for (let r = 0; r < m3.ride.length; r++) hs.i32(m3.ride[r]!).i32(m3.rideCd[r]!).q(m3.rideS[r]!, 1e-5);
    m3.strike.forEach((x) => hs.i32(x));
  }
}

/**
 * Every body M3 forces may push this tick, part order: live parts' dynamic bases, arms and (broken) chunks, fired
 * corks, live pool slots and the RACK bar. Never a dormant or hidden body (rule 8), a ghost, a kinematic body, a
 * critter or a Roller held in a BIG TOP.
 */
export function eachPushable(c: PartChannels, fn: (p: Pushable) => void): void {
  const h = c.h, st = h.st, m3 = c.m3;
  for (let k = 0; k < h.parts.length; k++) {
    if (!st.alive[k]) continue;
    const p = h.parts[k]!, def = p.def;
    if (def.critter) continue;
    const half = halfOf(def);
    for (const bi of [p.base, p.arm, ...p.chunks]) {
      if (bi < 0) continue;
      const b = h.bodies[bi]!;
      if (!b.dynamic || b.ghost || h.hiddenBody(k, b.role)) continue;
      if (b.role === 'base' && c.isHeld(k)) continue;
      fn({ part: k, body: bi, def, half });
    }
    for (const bi of c.livePieces(k)) {
      const s = m3.slotBody.indexOf(bi);
      const sd = s >= 0 ? m3.slotDef[s]! : def;
      fn({ part: k, body: bi, def: sd, half: sd ? halfOf(sd) : 0.02 });
    }
  }
}

/** A part's rough radius (half its largest bounds extent). */
export function halfOf(def: PartDef): number {
  const b = def.bounds;
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
}

/** Projected area (m²) for wind from a part's bounds (the GALE's rule). */
export function areaOf(def: PartDef | null): number {
  if (!def) return 0.0013;
  const e = [def.bounds.max[0] - def.bounds.min[0], def.bounds.max[1] - def.bounds.min[1], def.bounds.max[2] - def.bounds.min[2]];
  return (e[0]! * e[1]! + e[1]! * e[2]! + e[0]! * e[2]!) / 3;
}

/** RACK: the toothed bar on a slider along X, coupled to the pinion rotor by a rack-and-pinion constraint. */
function buildRack(m: M3Parts, i: number): void {
  const h = m.c.h, J = h.Jolt, p = h.parts[i]!;
  const L = p.props.length ?? 1;
  const shapes = p.def.shapes(p.props).filter((s) => s.on === 'piece').map((s): ShapeDef => ({ ...s, on: 'base' }));
  const bar = m.body(i, `rack:bar:${L}`, shapes, p.pos, p.rot, 'dynamic', 1.2 * L, 0.5, 0.3, false);
  m.piece[i] = bar;
  m.slider[i] = slider(m, i, bar, [0, 0.03, 0], [1, 0, 0], [-(L - 0.1) / 2, (L - 0.1) / 2], 2);
  if (!p.hinge || p.arm < 0) return;
  const s = new J.RackAndPinionConstraintSettings();
  const ax = qrot(p.rot, p.def.hinge!.axis), sx = qrot(p.rot, [1, 0, 0]);
  s.mHingeAxis = new J.Vec3(f32(ax[0]), f32(ax[1]), f32(ax[2]));
  s.mSliderAxis = new J.Vec3(f32(sx[0]), f32(sx[1]), f32(sx[2]));
  s.mRatio = f32(40); // rad per metre: the 10-tooth pinion's pitch radius is 0.025 m
  s.mNumVelocityStepsOverride = 24;
  s.mNumPositionStepsOverride = 6;
  const c = s.Create(h.bodies[p.arm]!.body, h.bodies[bar]!.body);
  J.destroy(s);
  // velocity coupling only, like the gears (D61): the slider's limits are the end stops
  h.system.AddConstraint(c);
}

/** A slider body (`role`) for part `i` from its `on: 'arm'` shapes, on a motorised slider along `axis`. */
function buildSlider(m: M3Parts, i: number, at: readonly number[], axis: readonly [number, number, number], limits: readonly [number, number], mass: number,
  friction: number, restitution: number, role: 'arm'): JoltModule {
  const h = m.c.h, p = h.parts[i]!;
  const shapes = p.def.shapes(p.props).filter((s) => s.on === 'arm').map((s): ShapeDef => ({ ...s, on: 'base' }));
  const arm = m.body(i, `${p.def.type}:slider-arm`, shapes, p.pos, p.rot, 'dynamic', mass, friction, restitution, true, undefined, role);
  p.arm = arm;
  return slider(m, i, arm, at, axis, limits, 400);
}

function slider(m: M3Parts, i: number, body: number, at: readonly number[], axis: readonly [number, number, number], limits: readonly [number, number], force: number): JoltModule {
  const h = m.c.h, J = h.Jolt, p = h.parts[i]!;
  const w = vadd(p.pos, qrot(p.rot, at));
  const ax = qrot(p.rot, axis);
  const normal = qrot(p.rot, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const s = new J.SliderConstraintSettings();
  s.mPoint1 = s.mPoint2 = new J.RVec3(f32(w[0]), f32(w[1]), f32(w[2]));
  s.mSliderAxis1 = s.mSliderAxis2 = new J.Vec3(f32(ax[0]), f32(ax[1]), f32(ax[2]));
  s.mNormalAxis1 = s.mNormalAxis2 = new J.Vec3(f32(normal[0]), f32(normal[1]), f32(normal[2]));
  s.mLimitsMin = f32(limits[0]);
  s.mLimitsMax = f32(limits[1]);
  s.mMaxFrictionForce = f32(0.5);
  const mo = s.mMotorSettings;
  mo.mMinForceLimit = f32(-force); mo.mMaxForceLimit = f32(force);
  mo.mSpringSettings.mFrequency = f32(20);
  mo.mSpringSettings.mDamping = f32(1);
  const c = s.Create(h.bodies[p.base]!.body, h.bodies[body]!.body);
  J.destroy(s);
  h.system.AddConstraint(c);
  const sl = J.castObject(c, J.SliderConstraint);
  if (force > 10) { sl.SetMotorState(J.EMotorState_Position); sl.SetTargetPosition(0); }
  return sl;
}
