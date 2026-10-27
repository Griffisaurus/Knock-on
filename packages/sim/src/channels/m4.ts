// M4 parts (stream A4 · M4 parts): run state, build-time pools and constraints, and the per-stage dispatch for the 15
// Ship = M4 catalogue rows. PartChannels (index.ts) owns one `M4Parts` and calls it from the same Machine hooks as the
// M2 / M3 parts:
//
//   m4_matter.ts   GRIT HOPPER, TANK, MARBLE HOPPER, SPRINKLE CAN, SPONGE (stored quantities, spouts, intakes), HOURGLASS
//   m4_air.ts      BLOWOUT (wind + heat cone), VAC (inverted cone + hold), INFLATOR (valve → seated HELIO fill)
//   m4_misc.ts     ARC TOWER (strikes), TOAST CANNON (pooled slices), YOLK (splat), QUACK (squeak)
//   m4_vehicle.ts  ZIPPY (a Jolt WheeledVehicleController)
//   (WATERWHEEL has no code: Matter water pushes its bucket plates; QUACK floats the same way)
//
// Determinism (SIMULATION §10): part order everywhere, detmath only, all run state in `st.m2.m4` (plain data, so
// checkpoints, rollback and desync repair carry it). Every body a part may put in play is pre-built dormant with the
// world (D66): TOAST CANNON slices join A3's pool slots (m3.ts `M3Parts`), so spawn / despawn / layers
// / rollback / blasts / RECYCLER all treat them like FABRICATOR parts, and dormant ones are never pushed (rule 8).
// State Jolt doesn't save (body masses set from stored water, seat-constraint enables) is re-applied in afterRestore.

import { f32, type Hasher } from '@knockon/detmath';
import { M4_CONTAINERS as M4_CONTAINERS_BASE, M4_TYPES as M4_TYPES_BASE, M5_MATTER_CONTAINERS, M5_MATTER_TYPES, type PartDef, type ShapeDef } from '@knockon/parts-data';
import type { JoltModule } from '@knockon/jolt';
import type { Vec } from '../vec.ts';
import type { Host, HostBody } from './host.ts';
import type { PartChannels } from './index.ts';
import { airBehave, airFlags, airSignal, blowoutHeat, buildSeats, inflatorRestore, inflatorSeated } from './m4_air.ts';
import { matterAfterContacts, matterBehave, matterContact, matterFill, matterFlags, matterInit, matterMeter, matterRestore, matterSignal, sprinkleRestore } from './m4_matter.ts';
import { arcHeat, miscBehave, miscContact, miscFlags, miscAfterContacts, miscSpawn } from './m4_misc.ts';
import { buildVehicle, vehicleBehave, vehicleContact, vehicleFlags, vehicleSignal } from './m4_vehicle.ts';

/**
 * Types run by M4Parts: the M4 rows, plus X5's GOO VAT (M5), which is A4's dispenser with goo (m4_matter.ts). A world
 * without either never activates M4Parts, so its hash is unchanged.
 */
export const M4_TYPES: ReadonlySet<string> = new Set([...M4_TYPES_BASE, ...M5_MATTER_TYPES]);
const M4_CONTAINERS: ReadonlySet<string> = new Set([...M4_CONTAINERS_BASE, ...M5_MATTER_CONTAINERS]);

/** M4 run state (stream A4). Per-part arrays are in part order. */
export interface M4State {
  /** Per part: stored quantity (water particles = mL, sand grains, marbles); HOURGLASS: ticks of sand left in its local-top bulb. */
  q: number[];
  /** Per part: emission remainder (whole particles per second × ticks, mod tickRate). */
  acc: number[];
  /** Per part: open / on state (valve, gate, feed, latch, drive direction −1 / 0 / 1, INFLATOR valve-closes tick, hourglass flow dir). */
  open: number[];
  /** Per part: phase (0 idle …) and the tick it started. */
  ph: number[];
  t0: number[];
  /** Per part: a counter (toast ticks, inflation ticks, charge ticks, squeeze-until tick, stall ticks). */
  n: number[];
  /** Per part: the event that set the current action going (−1). */
  cause: number[];
  /** Per part: the part it holds (VAC) or last struck (ARC TOWER), −1. */
  hold: number[];
  /** Per part: TOAST CANNON next pool slot; HOURGLASS done flag; SPONGE squeezing flag. */
  aux: number[];
  /** ARC TOWER strike heat spots: [x, y, z, untilTick, cause] … */
  heat: number[];
  /**
   * SIMFIX (rule 14): the exact Jolt mass properties of each body whose mass follows its contents (M4Parts.massBody
   * order): [inverse mass, inverse inertia diagonal x, y, z] each, as Jolt holds them (f32). Not hashed. Jolt's saved state
   * doesn't hold mass, and setMass's ScaleToMass is relative, so re-deriving inertia from `q` after a restore rounded
   * differently from the straight run (the BUZZ / DUSTY soak lesson); afterRestore writes these back instead.
   */
  mp?: number[];
}

declare module './host.ts' {
  interface M2State {
    /** M4 parts (stream A4): created by M4Parts.init when the machine has an M4 part. */
    m4?: M4State;
  }
}

/** What the M4 modules reach on the Machine beyond `Host` (private there; the Host cast reaches them). */
export interface M4Host extends Host {
  pop(i: number, cause?: number): void;
  readonly matter?: unknown;
}

export class M4Parts {
  readonly c: PartChannels;
  /** True once any M4 part is in the machine: gates the M4 hash block and every hook. */
  active = false;
  /** Part → its Jolt vehicle constraint and controller (ZIPPY). */
  readonly vehicle: ({ constraint: JoltModule; controller: JoltModule } | null)[] = [];
  /** INFLATOR part → its seated HELIO part (−1) and the seat constraint. */
  readonly seatOf: number[] = [];
  readonly seatC: (JoltModule | null)[] = [];
  /** HELIO part → the INFLATOR it sits on (−1). */
  readonly seatedOn: number[] = [];
  /** Stage-9 scratch (cleared every tick): mass resting on SPONGEs / QUACKs, their causes. */
  readonly load = new Map<number, number>();
  readonly loadCause = new Map<number, number>();
  /** SIMFIX: bodies whose mass setMass changes (SPONGE bases, SPRINKLE CAN cans; part order) → their record in st.mp. */
  readonly massBody: number[] = [];
  private readonly massSlot = new Map<number, number>();

  constructor(c: PartChannels) { this.c = c; }

  get h(): M4Host { return this.c.h as M4Host; }
  get st(): M4State { return this.c.h.st.m2.m4!; }

  // ---- building (before `st` exists) ------------------------------------------------------------------------------

  /** After the Machine built part `i` (base, hinge arm) and M3Parts.onBuild(i): M4 pools and vehicles. */
  onBuild(i: number): void {
    const h = this.c.h, p = h.parts[i]!, def = p.def;
    this.vehicle[i] = null;
    if (!M4_TYPES.has(def.type)) return;
    this.active = true;
    switch (def.type) {
      case 'toast_cannon': {
        const pc = def.piece!;
        for (let k = 0; k < 6; k++) this.poolSlot(i, `toast_cannon:slice`, pc.shapes, pc.mass, pc.friction, pc.restitution, false, null);
        break;
      }
      case 'zippy': buildVehicle(this, i); break;
      default:
    }
  }

  /**
   * A dormant pool body for part `i` (D66), registered as one of A3's pool slots (M3Parts), so spawn / despawn, object
   * layers, rollback, the M3 hash, blasts and RECYCLER treat it like a FABRICATOR part. Returns the slot index.
   */
  poolSlot(i: number, key: string, shapes: readonly ShapeDef[], mass: number, friction: number, restitution: number, ccd: boolean, def: PartDef | null): number {
    const m3 = this.c.m3, h = this.c.h;
    m3.active = true; // pool slots live in the M3 block (hash, restore, livePieces)
    m3.pools[i] ??= [];
    const k = m3.pools[i]!.length;
    const p = h.parts[i]!.pos;
    const park: Vec = [p[0] + 0.25, -32 - 0.5 * k, p[2]]; // beside A3's parks (x + 0.25), so dormant bodies never overlap them
    const body = m3.body(i, key, shapes, park, [0, 0, 0, 1], 'pooled', mass, friction, restitution, ccd, k);
    const s = m3.slotBody.length;
    m3.slotBody.push(body);
    m3.slotPart.push(i);
    m3.slotDef.push(def);
    m3.park.push(park);
    m3.pools[i]!.push(s);
    return s;
  }

  // ---- run state ----------------------------------------------------------------------------------------------

  /** After `st` exists (and M3Parts.init made the slot state): M4 state, INFLATOR seats, stored quantities. */
  init(): void {
    if (!this.active) return;
    const h = this.c.h, n = h.parts.length;
    const z = (): number[] => new Array<number>(n).fill(0), neg = (): number[] => new Array<number>(n).fill(-1);
    h.st.m2.m4 = { q: z(), acc: z(), open: z(), ph: z(), t0: neg(), n: z(), cause: neg(), hold: neg(), aux: z(), heat: [] };
    for (let i = 0; i < n; i++) { this.seatOf[i] = -1; this.seatC[i] = null; this.seatedOn[i] = -1; }
    buildSeats(this);
    // SIMFIX: the bodies whose mass follows their contents, with their mass properties as built (matterInit sets them)
    const owners = [...this.c.list('sponge'), ...this.c.list('sprinkle_can')].sort((a, b) => a - b);
    for (const i of owners) {
      const p = h.parts[i]!, b = p.def.type === 'sponge' ? p.base : p.arm;
      if (b < 0 || !h.bodies[b]!.dynamic || this.massSlot.has(b)) continue;
      this.massSlot.set(b, this.massBody.length);
      this.massBody.push(b);
    }
    if (this.massBody.length) {
      this.st.mp = new Array<number>(4 * this.massBody.length).fill(0);
      for (const b of this.massBody) this.recordMass(b);
    }
    matterInit(this);
    for (const i of this.c.list('zippy')) if ((h.parts[i]!.props.start ?? 0) === 1) this.st.open[i] = 1;
  }

  // ---- stages ---------------------------------------------------------------------------------------------------

  /** Stage 2: a Signal reached part `i`. Returns true if it was an M4 part. */
  signal(i: number, port: string, cause: number): boolean {
    if (!this.active || !M4_TYPES.has(this.c.h.parts[i]!.def.type)) return false;
    matterSignal(this, i, port, cause) || airSignal(this, i, port, cause) || vehicleSignal(this, i, port, cause);
    return true;
  }

  /** Stage 5: heat sources (stride 5): BLOWOUT cones once warm, ARC TOWER strike spots. */
  heat(out: number[]): void {
    if (!this.active) return;
    blowoutHeat(this, out);
    arcHeat(this, out);
  }

  /** Stage 6 for part `i`. Returns true if it was an M4 part. */
  behave(i: number): boolean {
    if (!this.active || !M4_TYPES.has(this.c.h.parts[i]!.def.type)) return false;
    matterBehave(this, i) || airBehave(this, i) || miscBehave(this, i) || vehicleBehave(this, i);
    return true;
  }

  /** Stage 9: a contact on part `pi`'s body `mb`. Returns true if an M4 rule took it. */
  contact(pi: number, mb: HostBody, ob: HostBody | undefined, J: number, pos: Vec, added: boolean, cause: number): boolean {
    if (!this.active) return false;
    const t = this.c.h.parts[pi]!.def.type;
    if (!M4_TYPES.has(t)) return false;
    return matterContact(this, pi, mb, ob, J, pos, added, cause) || miscContact(this, pi, mb, ob, J, pos, added, cause) || vehicleContact(this, pi, mb, ob, J, pos, added, cause);
  }

  /** End of stage 9: resting loads (SPONGE squeeze, QUACK squeak). */
  afterContacts(): void {
    if (!this.active) return;
    matterAfterContacts(this);
    miscAfterContacts(this);
    this.load.clear();
    this.loadCause.clear();
  }

  /** Stage 12: TOAST CANNON launches. */
  spawn(t: number): void { if (this.active) miscSpawn(this, t); }

  wantsPersisted(type: string): boolean { return type === 'sponge' || type === 'quack'; }

  /**
   * After a checkpoint restore: body masses, INFLATOR seat constraints, SPRINKLE CAN latch motors. SIMFIX: masses are
   * written back exactly from st.mp (re-scaling from `q` rounded differently from the straight run).
   */
  afterRestore(): void {
    if (!this.active) return;
    const mp = this.st.mp;
    if (mp && mp.length === 4 * this.massBody.length) {
      const J = this.c.h.Jolt;
      this.massBody.forEach((b, k) => {
        const props = this.c.h.bodies[b]!.body.GetMotionProperties();
        props.SetInverseMass(mp[4 * k]!);
        const rot = props.GetInertiaRotation();
        const q = new J.Quat(rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW());
        props.SetInverseInertia(this.c.h.v3(mp[4 * k + 1]!, mp[4 * k + 2]!, mp[4 * k + 3]!), q);
        J.destroy(q);
      });
    } else matterRestore(this);
    inflatorRestore(this);
    sprinkleRestore(this);
  }

  /** SIMFIX: copies body `b`'s current mass properties into st.mp (a body setMass manages; no-op for others). */
  recordMass(b: number): void {
    const k = this.massSlot.get(b), mp = this.st.mp;
    if (k === undefined || !mp) return;
    const props = this.c.h.bodies[b]!.body.GetMotionProperties();
    mp[4 * k] = props.GetInverseMass();
    const d = props.GetInverseInertiaDiagonal();
    mp[4 * k + 1] = d.GetX(); mp[4 * k + 2] = d.GetY(); mp[4 * k + 3] = d.GetZ();
  }

  hash(hs: Hasher): void {
    if (!this.active) return;
    const s = this.st;
    hs.u32(s.q.length);
    for (let i = 0; i < s.q.length; i++) hs.i32(s.q[i]!).i32(s.acc[i]!).i32(s.open[i]!).i32(s.ph[i]!).i32(s.t0[i]!).i32(s.n[i]!).i32(s.hold[i]!).i32(s.aux[i]!);
    hs.u32(s.heat.length);
  }

  /** Renderer / audio flags (PartFlagBits) for M4 parts. */
  flags(i: number): number {
    if (!this.active || !M4_TYPES.has(this.c.h.parts[i]!.def.type)) return 0;
    return matterFlags(this, i) | airFlags(this, i) | miscFlags(this, i) | vehicleFlags(this, i);
  }

  /** Screen readouts (Machine.partMeters): container fill bars as 1–21. */
  meter(i: number): number { return this.active && M4_TYPES.has(this.c.h.parts[i]!.def.type) ? matterMeter(this, i) : 0; }

  /**
   * Fill fraction for R4's container fill pass and keyframes (0–1): Matter containers' stored quantity over capacity,
   * HOURGLASS's local-top bulb, and a HELIO seated on an INFLATOR (its inflation, `sk_inflate`; up to 1.1 before it
   * pops). Anything else reads 0.
   */
  fill(i: number): number {
    if (!this.active) return 0;
    const t = this.c.h.parts[i]!.def.type;
    if (M4_CONTAINERS.has(t)) return matterFill(this, i);
    if (t === 'helio') return inflatorSeated(this, i);
    return 0;
  }

  /**
   * ZIPPY wheels for the renderer (PIVOT__wheel_* spin, suspension): 9 floats per ZIPPY with a vehicle, part order:
   * [part index, rotation angle (rad) × 4, suspension length (m) × 4], wheels front-left, front-right, rear-left, rear-right.
   */
  wheels(): Float32Array {
    const out: number[] = [];
    if (!this.active) return new Float32Array(0);
    for (const i of this.c.list('zippy')) {
      const v = this.vehicle[i];
      if (!v || !this.c.h.st.alive[i]) continue;
      out.push(i);
      for (let k = 0; k < 4; k++) out.push(v.constraint.GetWheel(k).GetRotationAngle());
      for (let k = 0; k < 4; k++) out.push(v.constraint.GetWheel(k).GetSuspensionLength());
    }
    return Float32Array.from(out);
  }

  /** Sets a dynamic body's mass (SPONGE water, SPRINKLE CAN contents): Jolt's state doesn't record it (afterRestore). */
  setMass(body: number, kg: number): void {
    const b = this.c.h.bodies[body]!.body;
    const mp = b.GetMotionProperties();
    const inv = mp.GetInverseMass();
    if (inv > 0 && Math.abs(1 / inv - kg) < 1e-6) return;
    mp.ScaleToMass(f32(kg));
    this.recordMass(body); // SIMFIX: the exact result, for afterRestore
  }
}
