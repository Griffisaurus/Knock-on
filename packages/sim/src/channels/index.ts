// M2 channels and parts (stream A · sim-parts). The Machine owns one `PartChannels` and calls its hooks
// from the tick pipeline (SIMULATION §2):
//   build      onBuild (pieces, sliders) · buildGutter · init
//   stage 1    stageTimers        RINGER, DELAY, FLAP auto-close, SKYROCKET / BIG TOP fuses
//   stage 2    onSignal           DELAY, TORCH, FLAP, PUNCHLINE, CORK BLASTER
//   stage 3    powerTopology · sourceWatts · afterPower      TOGGLE, CELL, DYNAMO, SUNCELL
//   stage 4    stageLight         TORCH, LAMP, BURNING GLASS, SUNCELL
//   stage 5    heatSources · heatProbe · ignite             focus spots, rocket exhaust, fuses
//   stage 6    swapSounds · behave · wind · afterBehaviours  devices, launchers, turbine, puffs, dynamo
//   stage 9    onContact · afterContacts                    SPRONG, TOGGLE, T-PLUNGER, PUFFER, GOTCHA BOX
//   rollback   afterRestore       object layers and gravity of held / dormant bodies
// All run state lives in `st.m2` (channels/host.ts), so checkpoints and rollback cover it.
//
// M3 parts (stream A3) ride the same hooks through `this.m3` (m3.ts and its m3_*.ts modules) plus three more:
//   stage 3    demand             LIFT draws only while moving, FLAMER only in Powered mode
//   stage 11   blastHit           glass inside a blast shatters (PANE, VASE)
//   stage 12   stageSpawn         FABRICATOR spawns, RECYCLER intake, SKYSHOW shell bursts
// and `buildGlidepath` for GLIDEPATH links (glidepath.ts).

import { f32, type Hasher } from '@knockon/detmath';
import type { LinkRecord } from '@knockon/format';
import type { JoltModule } from '@knockon/jolt';
import { vadd, qrot, type Vec } from '../vec.ts';
import { resolvePuffs, turbineWind } from './air.ts';
import { deviceAfterContacts, deviceBehave, deviceContact, deviceSignal, deviceTimers, initDevices } from './devices.ts';
import { buildGutter } from './gutter.ts';
import { L_GHOST, L_MOVING, type Host, type HostBody, type HostEnd } from './host.ts';
import { corkLayer, fireCork, holdLayer, launchBehave, launchHeat, launchHeatProbe, launchIgnite, launchTimers } from './launch.ts';
import { RayCaster, stageLight } from './light.ts';
import { afterPower, dynamoBrake, dynamoOutput, powerTopology, sourceWatts } from './power.ts';
import { lureEmitters, soundsThisTick, swapSounds, type LureEmitter, type Sound } from './sound.ts';
import { Glidepaths } from './glidepath.ts';
import { M3Parts, M3_TYPES } from './m3.ts';
import { boomBehave, boomContact, boomDemand, boomFlags, boomHeat, boomHeatProbe, boomIgnite, boomSignal, boomSpawn, boomTimers, flamerWind, popperPuffs } from './m3_boom.ts';
import { bumperContact, fieldFlags, fields, fieldSignal } from './m3_field.ts';
import { funAfterContacts, funBlastHit, funContact, funMeter } from './m3_fun.ts';
import { futureFlags, futureMeter, futureSignal, futureSpawn } from './m3_future.ts';
import { motionAfterContacts, motionBehave, motionContact, motionDemand, motionFlags, motionSignal } from './m3_motion.ts';
import { M4Parts, M4_TYPES } from './m4.ts'; // A4: the M4 parts (m4*.ts)
import { M5Parts, M5_TYPES } from './m5.ts'; // A5: the M5 parts (m5*.ts)

export { createM2State, type Host, type M2State } from './host.ts';
export type { LureEmitter, Sound } from './sound.ts';
export { explosionDb, impactDb, IMPACT_SOUND_J } from './sound.ts';

/** Part types with M2 channel behaviour (stream A). */
const M2_TYPES = new Set(['vortex', 'sprong', 'scoop', 'flap', 'dynamo', 'turbine', 'puffer', 'cell', 'suncell', 'lamp', 'torch', 'burning_glass',
  'toggle', 'ringer', 'delay', 't_plunger', 'skyrocket', 'big_top', 'cork_blaster', 'punchline', 'gotcha_box', 'fuzz', 'pig_iron']);

export class PartChannels {
  readonly h: Host;
  /** Part index → its pre-built piece body (cork, head), −1 = none. */
  readonly pieceOf: number[] = [];
  /** Part index → its slider constraint (PUNCHLINE). */
  readonly sliders: (JoltModule | null)[] = [];
  /** Heat spots from light this tick ([x, y, z, r, cause] …): written in stage 4, read in stage 5. */
  readonly focus: number[] = [];
  /** Stage-9 scratch (cleared every tick). */
  readonly handleMass = new Map<number, number>();
  readonly handleCause = new Map<number, number>();
  readonly bounced = new Set<number>();
  /**
   * SIMFIX (rule 14): Rollers a BIG TOP has ever held (only grows, never checkpointed). A hold makes the Roller a gravity-
   * free ghost, which Jolt's state doesn't record, so afterRestore hands back those not held at the restored tick.
   */
  readonly everHeld = new Set<number>();
  /** Reused Jolt values (Jolt copies arguments). */
  readonly rv: JoltModule;
  readonly qq: JoltModule;
  readonly zero: JoltModule;
  private readonly byType = new Map<string, number[]>();
  private rayCaster: RayCaster | null = null;
  /** True once any M2 part is in the machine: gates the extra hash content, so M1 golden hashes stand. */
  active = false;
  /** M3 parts (stream A3): pieces, pools, scratch (m3.ts). */
  readonly m3: M3Parts;
  /** GLIDEPATH rails and their riders (glidepath.ts). */
  readonly glide: Glidepaths;
  /** A4: M4 parts (m4.ts and its m4_*.ts modules). */
  readonly m4: M4Parts;
  /** A5: M5 parts (m5.ts and its m5_*.ts modules). */
  readonly m5: M5Parts;

  constructor(host: Host) {
    this.h = host;
    const J = host.Jolt;
    this.rv = new J.RVec3(0, 0, 0);
    this.qq = new J.Quat(0, 0, 0, 1);
    this.zero = new J.Vec3(0, 0, 0);
    this.m3 = new M3Parts(this);
    this.glide = new Glidepaths(this);
    this.m4 = new M4Parts(this); // A4
    this.m5 = new M5Parts(this); // A5
  }

  /** Part indices of a type, ascending (part order). */
  list(type: string): readonly number[] { return this.byType.get(type) ?? []; }
  rays(): RayCaster { return (this.rayCaster ??= new RayCaster(this.h)); }
  hingeOf(i: number): JoltModule | null { return this.h.parts[i]?.hinge ?? null; }
  isHeld(k: number): boolean { for (const i of this.list('big_top')) if (this.h.st.m2.held[i] === k) return true; return false; }

  // ---- build ---------------------------------------------------------------------------------------------

  /** After the Machine built part `i`'s base (and hinge arm): its piece body and slider. */
  onBuild(i: number): void {
    const h = this.h, p = h.parts[i]!, def = p.def;
    this.pieceOf[i] = -1;
    this.sliders[i] = null;
    this.m3.onBuild(i); // M3: pieces, sliders, pools (no-op for other types)
    this.m4.onBuild(i); // A4: M4 pools (TOAST CANNON slices) and vehicles (ZIPPY); no-op for other types
    this.m5.onBuild(i); // A5: FORCE WALL field, GRABBER links; no-op for other types
    const m3 = M3_TYPES.has(def.type) || M4_TYPES.has(def.type) || M5_TYPES.has(def.type); // A4: M4 types register like M3 ones; A5: M5 too
    if (!M2_TYPES.has(def.type) && !m3) return;
    this.active = true;
    const list = this.byType.get(def.type) ?? [];
    list.push(i);
    this.byType.set(def.type, list);
    if (m3) return;
    if (def.piece) this.pieceOf[i] = this.buildPiece(i);
    if (def.slider) this.buildSlider(i);
    if (def.type === 'cork_blaster') this.buildString(i);
  }

  /** A pre-built piece body (D66): dynamic pieces start as gravity-free ghosts, kinematic ones parked. */
  private buildPiece(i: number): number {
    const h = this.h, J = h.Jolt, p = h.parts[i]!, pc = p.def.piece!;
    const shape = h.shapeFor(`${p.def.type}:piece`, pc.shapes);
    const kin = pc.kinematic ?? false;
    const cs = new J.BodyCreationSettings(shape, new J.RVec3(f32(p.pos[0]), f32(p.pos[1]), f32(p.pos[2])), new J.Quat(f32(p.rot[0]), f32(p.rot[1]), f32(p.rot[2]), f32(p.rot[3])),
      kin ? J.EMotionType_Kinematic : J.EMotionType_Dynamic, kin ? L_MOVING : L_GHOST);
    cs.mFriction = f32(pc.friction);
    cs.mRestitution = f32(pc.restitution);
    cs.mGravityFactor = f32(kin ? 1 : 0);
    const index = h.bodies.length;
    cs.mUserData = index;
    if (!kin) {
      cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      cs.mMassPropertiesOverride.mMass = f32(pc.mass);
      if (pc.ccd) cs.mMotionQuality = J.EMotionQuality_LinearCast;
    }
    const body = h.bi.CreateBody(cs);
    J.destroy(cs);
    h.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
    h.bodies.push({ part: i, role: 'piece', body, dynamic: !kin, ghost: false });
    return index;
  }

  /** PUNCHLINE: the glove body on a slider along the def's axis, with a motor. */
  private buildSlider(i: number): void {
    const h = this.h, J = h.Jolt, p = h.parts[i]!, def = p.def, sd = def.slider!;
    const armShapes = def.shapes(p.props).filter((s) => s.on === 'arm');
    p.arm = h.addBody(h.shapeFor(`${def.type}:slider-arm`, armShapes), p.pos, p.rot, true, false, def.body.friction, def.body.restitution, sd.armMass, true, 1, i, 'arm');
    const at = vadd(p.pos, qrot(p.rot, sd.at));
    const axis = qrot(p.rot, sd.axis);
    const normal = qrot(p.rot, Math.abs(sd.axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const s = new J.SliderConstraintSettings();
    s.mPoint1 = s.mPoint2 = new J.RVec3(f32(at[0]), f32(at[1]), f32(at[2]));
    s.mSliderAxis1 = s.mSliderAxis2 = new J.Vec3(f32(axis[0]), f32(axis[1]), f32(axis[2]));
    s.mNormalAxis1 = s.mNormalAxis2 = new J.Vec3(f32(normal[0]), f32(normal[1]), f32(normal[2]));
    s.mLimitsMin = f32(sd.limits[0]);
    s.mLimitsMax = f32(sd.limits[1]);
    const m = s.mMotorSettings;
    m.mMinForceLimit = f32(-300); m.mMaxForceLimit = f32(300);
    m.mSpringSettings.mFrequency = f32(20);
    m.mSpringSettings.mDamping = f32(1);
    const c = s.Create(h.bodies[p.base]!.body, h.bodies[p.arm]!.body);
    J.destroy(s);
    h.system.AddConstraint(c);
    const slider = J.castObject(c, J.SliderConstraint);
    slider.SetMotorState(J.EMotorState_Position);
    slider.SetTargetPosition(0);
    this.sliders[i] = slider;
  }

  /** CORK BLASTER: the cork's 1.5 m string, from the eyelet to the cork (always on; slack while seated). */
  private buildString(i: number): void {
    const h = this.h, J = h.Jolt, p = h.parts[i]!, piece = this.pieceOf[i]!;
    if (piece < 0) return;
    const eye = vadd(p.pos, qrot(p.rot, [0.12, 0.03, 0]));
    const cork = vadd(p.pos, qrot(p.rot, [0.13, 0.06, 0]));
    const s = new J.DistanceConstraintSettings();
    s.mPoint1 = new J.RVec3(f32(eye[0]), f32(eye[1]), f32(eye[2]));
    s.mPoint2 = new J.RVec3(f32(cork[0]), f32(cork[1]), f32(cork[2]));
    s.mMinDistance = f32(0);
    s.mMaxDistance = f32(1.5);
    const c = s.Create(h.bodies[p.base]!.body, h.bodies[piece]!.body);
    J.destroy(s);
    h.system.AddConstraint(c);
  }

  buildGutter(l: LinkRecord): void { buildGutter(this.h, l); }
  /** M3: a GLIDEPATH link (rails, rider path, pre-built rider constraints). */
  buildGlidepath(l: LinkRecord): void { this.glide.build(l); if (this.m3.active) this.active = true; }

  /** After the world is built and `st` exists: initial channel states. */
  init(): void {
    const h = this.h, m2 = h.st.m2;
    for (const i of this.list('cell')) m2.val[i] = 200 * (h.parts[i]!.props.capacity ?? 30);
    initDevices(this);
    powerTopology(this);
    this.m3.init(); // M3: pool slots, PINS racks
    this.m4.init(); // A4: M4 state, INFLATOR seats, stored quantities (after the pool slots exist)
    this.m5.init(); // A5: M5 state, RIFT pairs, FORCE WALL layers, GRABBER poses
    for (const i of this.list('flamer')) m2.on[i] = (h.parts[i]!.props.mode ?? 0) === 0 ? h.parts[i]!.props.on ?? 0 : 0;
  }

  // ---- stages --------------------------------------------------------------------------------------------

  stageTimers(t: number): void {
    if (!this.active) return;
    deviceTimers(this, t);
    launchTimers(this, t);
    boomTimers(this, t); // M3: SKYSHOW quick-match
  }

  /** A Signal pulse reached part `i` (after its Signal event). Returns true if handled. */
  onSignal(i: number, port: string, cause: number): boolean {
    if (deviceSignal(this, i, port, cause)) return true;
    if (this.h.parts[i]!.def.type === 'cork_blaster') { if (port === 'fire') fireCork(this, i, cause); return true; }
    return motionSignal(this, i, port, cause) || boomSignal(this, i, port, cause) || fieldSignal(this, i, port, cause) || futureSignal(this, i, port)
      || this.m4.signal(i, port, cause) // A4
      || this.m5.signal(i, port, cause); // A5
  }

  powerTopology(): void { powerTopology(this); }
  sourceWatts(i: number): number { return sourceWatts(this, i); }
  afterPower(S: ReadonlyMap<number, number>, D: ReadonlyMap<number, number>): void { if (this.active) afterPower(this, S, D); }

  stageLight(): void { if (this.active) stageLight(this); }

  /** Watts a consumer draws this tick (stage 3): its rating, except M3's LIFT (only while moving) and FLAMER (Powered mode only). */
  demand(i: number, w: number): number {
    if (!this.m3.active) return w;
    return boomDemand(this, i, motionDemand(this, i, w));
  }

  /** Inside a blast's radius (stage 11): M3 glass shatters. */
  blastHit(k: number, cause: number): void { if (this.m3.active) funBlastHit(this, k, cause); }

  /** Stage 12 (M3): SKYSHOW shell bursts, FABRICATOR spawns, RECYCLER intake. */
  stageSpawn(t: number): void {
    this.m4.spawn(t); // A4: TOAST CANNON launches
    if (this.m3.active) { // A5: was an early return; M5 runs after it either way
      boomSpawn(this, t);
      futureSpawn(this, t);
    }
    this.m5.spawn(t); // A5: SINGULARITY despawns, then RIFT GATES transits
  }

  /** Light beam segments of the last stage 4 (Machine.lightBeams). */
  beams(): Float32Array { return Float32Array.from(this.m3.beams); }

  /** Extra heat sources this tick (stride 5: x, y, z, r, cause): light focus spots, rocket exhaust. */
  heatSources(out: number[]): void {
    if (!this.active) return;
    for (let k = 0; k < this.focus.length; k++) out.push(this.focus[k]!);
    launchHeat(this, out);
    boomHeat(this, out); // M3: FLAMER cones
    this.m4.heat(out); // A4: BLOWOUT hot-air cones, ARC TOWER strike spots
    this.m3.heatRef = out; // M3: the POWDER KEG reads the complete list in its heat probe
  }

  /** Exposure ignition point of an M2 flammable (part-local) and its ignite time, or null. */
  heatProbe(i: number): { at: Vec; time: number } | null { return this.active ? launchHeatProbe(this, i) ?? boomHeatProbe(this, i) : null; }

  /** Heat reached a heat port (fuse end) or exposure ignited part `i`. Returns true if it was an M2 part. */
  ignite(i: number, cause: number): boolean { return launchIgnite(this, i, cause) || boomIgnite(this, i, cause); }

  /** Inside 0.4 R of a blast: M2 flammables catch (SIMULATION §6.1). */
  blastIgnite(i: number, cause: number): void {
    const t = this.h.parts[i]!.def.type;
    if (t === 'skyrocket' || t === 'big_top') launchIgnite(this, i, cause);
    if (t === 'skyshow') boomIgnite(this, i, cause); // M3
  }

  swapSounds(): void { swapSounds(this.h); }

  /** Stage 6 for one part (M1 parts are handled by the Machine). */
  behave(i: number): void {
    if (deviceBehave(this, i) || launchBehave(this, i)) return;
    if (this.h.parts[i]!.def.type === 'dynamo') { dynamoBrake(this, i); return; }
    if (this.m4.behave(i)) return; // A4
    if (this.m5.behave(i)) return; // A5
    if (this.m3.active && !motionBehave(this, i)) boomBehave(this, i); // M3
  }

  /** Right after the physics step (before contacts): dynamo output for the next tick. */
  afterPhysics(): void { for (const i of this.list('dynamo')) dynamoOutput(this, i); }

  /** End of stage 6: queued puffs. */
  afterBehaviours(): void {
    if (!this.active) return;
    resolvePuffs(this);
    if (this.m3.active) { // A5: was an early return; the M5 fields run after the M3 ones either way
      popperPuffs(this); // M3: popper puffs, fields, rail riders
      fields(this);
      this.glide.update();
    }
    this.m5.fields(); // A5: GRAV WELL, SINGULARITY pull, TRACTOR BEAM, COILGUN RING, STASIS FIELD
  }

  /** Wind from an emitter on part `k`. Returns true if the channels handled it (turbine). */
  wind(k: number, nozzle: Vec, axis: Vec, R: number, cosHalf: number, f: number): boolean {
    if (this.h.parts[k]!.def.type === 'flamer') { flamerWind(this, k, nozzle, axis, R, cosHalf, f, this.h.st.lastEv[k] ?? -1); return false; } // M3: a GALE douses it
    if (this.h.parts[k]!.def.type !== 'turbine') return false;
    turbineWind(this, k, nozzle, axis, R, cosHalf, f);
    return true;
  }

  onContact(pi: number, mb: HostBody, ob: HostBody | undefined, J: number, vrel: number, pos: Vec, added: boolean, cause: number): void {
    deviceContact(this, pi, mb, ob, J, vrel, pos, added, cause);
    if (this.m4.contact(pi, mb, ob, J, pos, added, cause)) return; // A4: YOLK splats, SPONGE / QUACK loads, ZIPPY bumper
    if (!this.m3.active) return;
    const other = ob ? ob.part : -1;
    if (motionContact(this, pi, mb, ob, J, pos, added, cause)) return;
    if (boomContact(this, pi, mb, J, pos, added, cause, other)) return;
    if (bumperContact(this, pi, mb, ob, J, vrel, pos, added, cause)) return;
    funContact(this, pi, mb, J, pos, added, cause, other);
  }
  afterContacts(): void {
    if (!this.active) return;
    deviceAfterContacts(this);
    this.m4.afterContacts(); // A4: SPONGE squeeze, QUACK load squeak
    if (!this.m3.active) return;
    motionAfterContacts(this); // M3: lift deck and snaptrap pedal weight, pins
    funAfterContacts(this);
    this.m3.kicked.clear();
  }
  wantsPersisted(type: string): boolean { return type === 't_plunger' || type === 'lift' || type === 'snaptrap' || type === 'glint' || type === 'bearing' || this.m4.wantsPersisted(type); } // A4: SPONGE, QUACK loads

  /** Body indices of part `i`'s live pieces (fired corks), for blast impulses. */
  livePieces(i: number): number[] {
    const b = this.pieceOf[i] ?? -1;
    const out = b >= 0 && this.h.parts[i]!.def.type === 'cork_blaster' && this.h.st.m2.on[i] ? [b] : [];
    return this.m3.active ? [...out, ...this.m3.livePieces(i)] : out;
  }

  /** Does contact with this body pop a Helio? (cork pieces are tagged sharp) */
  sharpPiece(b: HostBody | undefined): boolean {
    return !!b && b.role === 'piece' && !!this.h.parts[b.part]!.def.piece?.sharp;
  }

  /** After a checkpoint restore: state Jolt doesn't record (object layers, gravity factors). */
  afterRestore(): void {
    if (!this.active) return;
    const m2 = this.h.st.m2;
    for (const i of this.list('cork_blaster')) corkLayer(this, i, m2.on[i] === 1);
    // SIMFIX (rule 14): a Roller caught after the checkpoint is still a ghost in Jolt: hand it back to the world first
    // (part order), unless it's out of play or in a critter's hands (critters.afterRestore, which runs first, owns those)
    if (this.everHeld.size) {
      const st = this.h.st, carried = new Set((st.crit?.c ?? []).map((x) => x.carry));
      for (const k of [...this.everHeld].sort((a, b) => a - b)) if (st.alive[k] && !st.broken[k] && !this.isHeld(k) && !carried.has(k)) holdLayer(this, k, false);
    }
    for (const i of this.list('big_top')) if (m2.held[i]! >= 0) holdLayer(this, m2.held[i]!, true);
    powerTopology(this);
    this.m3.afterRestore(); // M3: pool layers, rail riders
    this.glide.afterRestore();
    this.m4.afterRestore(); // A4: body masses from stored water, INFLATOR seats
    this.m5.afterRestore(); // A5: FORCE WALL field layers
  }

  hash(hs: Hasher): void {
    if (!this.active) return;
    const m2 = this.h.st.m2;
    for (let i = 0; i < m2.on.length; i++) hs.i32(m2.on[i]!).i32(m2.phase[i]!).i32(m2.held[i]!).i32(m2.t0[i]!).q(m2.val[i]!, 1e-3);
    hs.u32(m2.delays.length);
    m2.delays.forEach((x) => hs.i32(x));
    hs.u32(m2.puffs.length);
    this.m3.hash(hs); // M3 (only when the machine has M3 parts or rails)
    this.m4.hash(hs); // A4 (only when the machine has M4 parts or a YOLK pool)
    this.m5.hash(hs); // A5 (only when the machine has M5 parts)
  }

  /**
   * Renderer / audio flags for M2 parts (PartFlagBits: lit 1, powered 2, pressed 4, armed 16):
   * armed while RINGER, DELAY, SKYROCKET stub and BIG TOP touch-hole count down; lit while a SKYROCKET
   * thrusts (st.lit) and for light parts, toggles and open flaps; powered while a GOTCHA BOX is cranked.
   */
  flags(i: number): number {
    const h = this.h, m2 = h.st.m2, p = h.parts[i]!;
    switch (p.def.type) {
      case 'torch': case 'lamp': case 'suncell': case 'burning_glass': case 'flap': case 'toggle':
        return m2.on[i] ? 1 : 0;
      case 'ringer': case 'delay': return m2.on[i] ? 1 | 16 : 0;
      case 'cell': case 'dynamo': return m2.val[i]! > 0 ? 2 : 0;
      case 't_plunger': return m2.on[i] ? 4 : 1;
      case 'cork_blaster': return m2.on[i] ? 0 : 1;
      case 'gotcha_box': return m2.on[i] ? 4 : m2.val2[i]! > 0.5 ? 2 : 0;
      case 'skyrocket': return m2.phase[i] === 1 ? 16 : 0;
      case 'big_top': return (m2.phase[i] === 1 ? 16 : 0) | (m2.held[i]! >= 0 ? 4 : 0);
      case 'tripwire': return m2.on[i] ? 1 : 0;
      case 'lance': return (m2.on[i] ? 1 : 0) | (m2.val2[i]! > 0 ? 16 : 0); // lit = beam on, armed = cutting beam
      default: return (this.m3.active ? motionFlags(this, i) | boomFlags(this, i) | fieldFlags(this, i) | futureFlags(this, i) : 0) | this.m4.flags(i) | this.m5.flags(i); // A4, A5
    }
  }

  /** Screen readouts (Machine.partMeters): CELL charge, DYNAMO / SUNCELL output as 1–21, RINGER seconds left. */
  meter(i: number): number {
    const h = this.h, m2 = h.st.m2, p = h.parts[i]!;
    switch (p.def.type) {
      case 'cell': return 1 + Math.round((20 * m2.val[i]!) / (200 * (p.props.capacity ?? 30)));
      case 'dynamo': return m2.val[i]! > 0 ? 1 + Math.round((20 * m2.val[i]!) / 300) : 0;
      case 'suncell': return m2.val[i]! > 0 ? 1 + Math.round(20 * m2.val[i]!) : 0;
      case 'ringer': return m2.on[i] ? Math.min(31, Math.max(1, Math.ceil((m2.val[i]! - h.st.tick) / h.tickRate))) : 0;
      default: return (this.m3.active ? funMeter(this, i) || futureMeter(this, i) : 0) || this.m4.meter(i) || this.m5.meter(i); // A4: container fill bars; A5: charge, load, countdown
    }
  }

  /** A4: container fill 0–1 (Machine.partFill; R4's fill pass): Matter containers, HOURGLASS top bulb, a HELIO on an INFLATOR. */
  fill(i: number): number { return this.m4.fill(i); }

  soundsThisTick(): Sound[] { return soundsThisTick(this.h); }
  lureEmitters(): LureEmitter[] { return lureEmitters(this.h); }
}

export type { HostEnd };
