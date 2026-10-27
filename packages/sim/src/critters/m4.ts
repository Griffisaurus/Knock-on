// M4 critters (stream B4): BISCUIT the dog, HENNY the chicken and DUSTY the robot vacuum (GAME_SPEC §11,
// SIMULATION §7.3, critters.md), plus MOCHI's flee(Biscuit). The CritterSystem (system.ts) owns the framework:
// bodies, perception, steering, ragdolls, the hooks; it hands M4 species to this module in think / act / finish.
//
// Everything here is plain state in `st.crit` (CritSt + M4St + the egg pool), so checkpoints, rollback and the hash
// cover it; this object holds build-time wiring only (pool bodies, zones, per-tick contact buffers).
//
//   BISCUIT  sleep → (Sound ≥ 55 dB, or a shove) wake → chase Mochi (a 70 dB bark every 1.5 s, a Sound pulse other
//            critters hear) → play tag (celebrate) or lose her → sniff her trail → lost → idle / wander → sleep.
//            A trapped or unreachable Mochi gets barked at. Barges through: shoves dynamic bodies ≤ 6 kg aside.
//   HENNY    peck / scratch / wander / nap; startled (Sound ≥ 50 dB, an Impact within 1.5 m, a 2 N·s touch) → flap
//            (rises 1.0 m) → lay_egg (a YOLK from her pre-built pool at the apex; 6 s cooldown, `eggs` per run) →
//            glide_down → proud_puff. Trapped: startled + feather puff, never a flap (D14, critters.md).
//   DUSTY    patrol its zone (part props) → bump_turn at the zone edge or on a bumper hit → beeline to grains →
//            vacuum (machine.matter intake: sand and marbles only, never parts or critters; the bin's grains add
//            mass and slow it) → bin_full → sleep. Idle stints end in a scan and a nap; unpowered on its charge
//            leash, it sleeps. Startles at 70 dB. Tumbles as one rigid body above 4 N·s, or when tipped over an
//            edge (centre unsupported) or falling.

import { datan2, dcos, dsin, f32 } from '@knockon/detmath';
import type { JoltModule } from '@knockon/jolt';
import {
  CRITTER_BIN_SHIFT, CRITTER_FSM, CRITTER_M4, CritterFlagBits, partDef,
  type CritterClip, type CritterFsm, type ShapeDef,
} from '@knockon/parts-data';
import { qrot, vadd, vlen, vsub, type Q, type Vec } from '../vec.ts';
import { emptyM4, type CritSt, type CritWorld, type M4St } from './state.ts';
import type { CritterSystem } from './system.ts';

/** What DUSTY uses of `machine.matter` (M4_PLAN contract 2; MI's MatterHost satisfies it structurally). */
export interface CritterMatter {
  readonly active: boolean;
  /** Registers `part`'s intake (part-space box, metres; bit per MatterKind; grains per Matter tick, 0 = closed). */
  intake(part: number, localBox: { readonly min: readonly number[]; readonly max: readonly number[] }, kindMask: number, capacity?: number): number;
  /** Grains the part's intakes took in at the last coupling tick, per MatterKind (sand, water, marble). */
  absorbed(part: number): readonly number[];
  /** Optional (requested from MI/MX): the nearest grains of these kinds within `radius` of `pos`, deterministic. */
  near?(pos: readonly number[], radius: number, kindMask: number): readonly number[] | null;
}

export const M4_SPECIES: ReadonlySet<string> = new Set(['biscuit', 'henny', 'dusty']);
export const isM4 = (species: string): boolean => M4_SPECIES.has(species);

const F = Object.fromEntries(CRITTER_FSM.map((s, i) => [s, i])) as Record<CritterFsm, number>;
const B = CRITTER_M4.biscuit, H = CRITTER_M4.henny, D = CRITTER_M4.dusty;

const G = 9.81;
/** Dusty's intake: grains per Matter tick while open (a suction rate cap; the bin's 1.8 kg is tracked here). */
const INTAKE_CAP = 500;
/** Full: less room than this many grains (at the bin's mean grain mass) is a full bin. */
const IN_FLIGHT = 3;
/** Egg pool parking: 30 m under the owner, 0.5 m apart (the A3 pool convention the renderer's poolInPlay knows). */
const PARK_Y = -30;

const yawOf = (q: readonly number[]): number => { const f = qrot(q, [0, 0, 1]); return datan2(f[0], f[2]); };
const yawQ = (y: number): Q => [0, dsin(y / 2), 0, dcos(y / 2)];
const wrapPi = (a: number): number => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const hlen = (v: readonly number[]): number => Math.sqrt(v[0]! * v[0]! + v[2]! * v[2]!);

/** A Dusty's patrol zone: centre (world x, z), yaw, half extents (part props zone_w/d/x/z, in the part's frame). */
interface Zone { readonly cx: number; readonly cz: number; readonly yaw: number; readonly hw: number; readonly hd: number }

export class M4Critters {
  readonly s: CritterSystem;
  /** Critter ordinals by species (part order). */
  dogs: number[] = [];
  hens: number[] = [];
  bots: number[] = [];
  /** Egg pool, global slots in part order: body index, owner critter ordinal, park spot. */
  readonly eggBody: number[] = [];
  readonly eggCrit: number[] = [];
  readonly eggPark: Vec[] = [];
  /** Per critter ordinal: its pool's slots (Hennies only). */
  readonly eggsOf: number[][] = [];
  /** Per critter ordinal: Dusty's zone. */
  readonly zones: (Zone | null)[] = [];
  /** Body index → egg slot (−1). */
  bodyEgg: Int32Array = new Int32Array(0);
  /** Dusty's base and tumble body: the mass properties they were built with (setMass scales from these). */
  private readonly massRef = new Map<number, { m0: number; inv: number[]; rot: number[] }>();
  // per-tick contact buffers (transient: rebuilt every tick, never checkpointed)
  tEgg = new Float64Array(0);
  tEggPart = new Int32Array(0);
  /** [critter ordinal, body index] pairs Biscuit touched this tick (sorted before use, so callback order is moot). */
  tBarge: number[] = [];
  tBump = new Float64Array(0);
  tBumpN = new Float64Array(0);

  constructor(sys: CritterSystem) { this.s = sys; }

  private get w(): CritWorld { return this.s.w; }
  x(k: number): M4St { return this.w.m4![k]!; }
  private sp(k: number): string { return this.s.crits[k]!.spec.species; }

  // ---- building ---------------------------------------------------------------------------------------------

  /** Pool size a critter part needs (HENNY: its `eggs` property). */
  poolSize(species: string, props: Readonly<Record<string, number>>): number {
    return species === 'henny' ? clamp(Math.round(props.eggs ?? H.eggs), 0, H.maxEggs) : 0;
  }

  /**
   * After buildCritter made critter `k`'s base and ragdoll (part order): HENNY's YOLK pool (dormant ghost bodies
   * in her collision group, so a fresh egg never hits her) and DUSTY's zone.
   */
  onBuild(k: number, part: number, group: JoltModule, nb: number): void {
    const s = this.s, h = s.h;
    const p = h.parts[part]!;
    const spec = p.def.critter!;
    this.eggsOf[k] = [];
    this.zones[k] = null;
    if (spec.species === 'biscuit') this.dogs.push(k);
    if (spec.species === 'dusty') {
      this.bots.push(k);
      const yaw = yawOf(p.rot);
      const off = qrot(yawQ(yaw), [p.props.zone_x ?? 0, 0, p.props.zone_z ?? 0]);
      this.zones[k] = { cx: p.pos[0]! + off[0], cz: p.pos[2]! + off[2], yaw, hw: Math.max(0.2, (p.props.zone_w ?? 2) / 2), hd: Math.max(0.2, (p.props.zone_d ?? 2) / 2) };
    }
    if (spec.species !== 'henny') return;
    this.hens.push(k);
    const n = this.poolSize('henny', p.props);
    const yd = partDef('yolk');
    const Y = H.yolk;
    const shapes: readonly ShapeDef[] = yd ? yd.shapes({}) : [{ kind: 'capsule', size: [Y.size[0], Y.size[1], Y.size[2]], axis: 'y' }];
    const shape = h.shapeFor('yolk:pool', shapes);
    for (let e = 0; e < n; e++) {
      const park: Vec = [p.pos[0]!, PARK_Y - 0.5 * e, p.pos[2]!];
      const bi = s.createBody(shape, park, [0, 0, 0, 1], {
        part, role: 'piece', layer: h.layers.ghost, mass: yd?.body.mass ?? Y.mass, friction: yd?.body.friction ?? Y.friction,
        restitution: yd?.body.restitution ?? Y.restitution, gravity: 0, ccd: true, group, groupId: part, sub: nb + 1 + e, activate: false,
      });
      this.eggsOf[k]!.push(this.eggBody.length);
      this.eggBody.push(bi);
      this.eggCrit.push(k);
      this.eggPark.push(park);
    }
  }

  /** Once st exists (CritterSystem.init, after the generic seeding): M4 state, starting states, Dusty's intake. */
  init(world: CritWorld): void {
    const s = this.s, h = s.h;
    const any = s.crits.some((c) => isM4(c.spec.species));
    world.m4 = any ? s.crits.map(() => emptyM4()) : [];
    world.egg = this.eggBody.map(() => 0);
    const nb = h.bodies.length;
    this.bodyEgg = new Int32Array(nb).fill(-1);
    this.eggBody.forEach((bi, e) => { this.bodyEgg[bi] = e; });
    this.tEgg = new Float64Array(this.eggBody.length);
    this.tEggPart = new Int32Array(this.eggBody.length).fill(-1);
    this.tBump = new Float64Array(s.crits.length);
    this.tBumpN = new Float64Array(s.crits.length * 2);
    if (!any) return;
    for (const k of this.bots) { this.captureMass(s.crits[k]!.base); this.captureMass(s.crits[k]!.rags[0]!); } // as built
    s.crits.forEach((cr, k) => {
      const sp = cr.spec.species;
      const x = world.m4![k]!;
      if (sp === 'biscuit') { s.setFsm(k, 'sleep', -1, false); x.hd = s.ticks(s.rand(world.c[k]!, B.settle[0], B.settle[1])); }
      if (sp === 'dusty') {
        const z = this.zones[k]!;
        const c = world.c[k]!;
        c.homeX = z.cx; c.homeZ = z.cz;
        x.hd = yawOf(h.parts[cr.part]!.rot);
        x.cd = s.ticks(s.rand(c, D.stint[0], D.stint[1]));
        s.setFsm(k, 'patrol', -1, false); // its intake opens with its first act (stage 6 of tick 0)
      }
    });
  }

  // ---- hooks from the CritterSystem ---------------------------------------------------------------------------

  /** Contact listener (stage 8): eggs (max J per egg), Biscuit's barge contacts, Dusty's bumper. */
  contactEgg(i1: number, i2: number, J: number): void {
    if (!this.eggBody.length) return;
    for (const [a, b] of [[i1, i2], [i2, i1]] as const) {
      const e = this.bodyEgg[a] ?? -1;
      if (e < 0) continue;
      if (J > this.tEgg[e]!) { this.tEgg[e] = J; this.tEggPart[e] = this.s.h.bodies[b]?.part ?? -1; }
    }
  }

  /** A critter body touched another body (contact listener, critter side): barge and bumper bookkeeping. */
  touch(k: number, other: number, nxs: number, nzs: number, invO: number, dynamic: boolean, J: number): void {
    const cr = this.s.crits[k]!;
    const sp = cr.spec.species;
    if (sp === 'biscuit' && dynamic && invO > 0 && 1 / invO <= (cr.spec.barge ?? 0)) {
      const ob = this.s.h.bodies[other];
      if (ob && (this.s.bodyCrit[other] ?? -1) < 0 && ob.role !== 'rag') this.tBarge.push(k, other);
    } else if (sp === 'dusty') {
      // the bumper: a horizontal push; the arc test runs after the step, on the settled heading
      const hn = Math.sqrt(nxs * nxs + nzs * nzs);
      if (hn > 0.5 && J > this.tBump[k]!) { this.tBump[k] = J; this.tBumpN[k * 2] = nxs / hn; this.tBumpN[k * 2 + 1] = nzs / hn; }
    }
  }

  /** The Machine saw an Impact (J ≥ 0.3 N·s) at `pos` between parts `a` and `b`: Hennies within 1.5 m notice. */
  impact(pos: readonly number[], J: number, a: number, b: number): void {
    if (!this.hens.length || !this.w.m4?.length) return;
    for (const k of this.hens) {
      const cr = this.s.crits[k]!;
      if (a === cr.part || b === cr.part) continue; // her own landing, her own eggs
      const c = this.w.c[k]!;
      if (c.flags & CritterFlagBits.ragdoll) continue;
      const me = this.s.comOf(cr.base);
      if (vlen(vsub(pos, me)) > H.impactR) continue;
      const x = this.x(k);
      if (J > x.imp) { x.imp = J; x.ix = pos[0]!; x.iz = pos[2]!; }
    }
  }

  /** After the contact stage: egg splats, barge shoves, bumper hits, then the per-tick buffers reset. */
  postContacts(t: number): void {
    const s = this.s, w = this.w;
    // eggs: a laid YOLK breaks on a contact of ≥ 0.3 N·s (rollers.md), or quietly leaves play if it falls out of the world
    for (let e = 0; e < this.eggBody.length; e++) {
      if (w.egg![e] !== 1) continue;
      const at = s.comOf(this.eggBody[e]!);
      if (this.tEgg[e]! >= H.yolk.breakJ) this.splat(e, this.tEgg[e]!, s.h.cause(this.tEggPart[e]!));
      else if (!Number.isFinite(at[0] + at[1] + at[2]) || at[1] < -2) { w.egg![e] = 2; this.park(e); }
    }
    if (this.tBarge.length) this.barge();
    for (const k of this.bots) this.bumper(k);
    // Dusty's intake: each Matter result is applied at stage 7 of an even tick and stays readable until the next
    // one, so it's counted on even ticks only (once per result)
    if (t % 2 === 0) for (const k of this.bots) this.absorb(k);
    this.tEgg.fill(0); this.tEggPart.fill(-1); this.tBarge.length = 0; this.tBump.fill(0); this.tBumpN.fill(0);
  }

  /** A detonation (Machine.blast, once per blast): laid eggs inside its radius splat. */
  blast(P: readonly number[], R: number, cause: number): void {
    const w = this.w;
    for (let e = 0; e < this.eggBody.length; e++) {
      if (w.egg![e] !== 1) continue;
      const at = this.s.comOf(this.eggBody[e]!);
      if (vlen(vsub(at, P)) <= R) this.splat(e, 0, cause);
    }
  }

  /** A critter just went ragdoll: Dusty's rigid tumble carries its bin and spins. */
  onRagdoll(k: number, dv: readonly number[]): void {
    const cr = this.s.crits[k]!;
    if (cr.spec.species !== 'dusty') return;
    const ri = cr.rags[0]!;
    this.setMass(ri, cr.spec.mass + this.x(k).bin);
    const m = Math.min(3, Math.sqrt(dv[0]! * dv[0]! + dv[2]! * dv[2]!));
    const l = Math.max(1e-6, Math.sqrt(dv[0]! * dv[0]! + dv[2]! * dv[2]!));
    // tip about the horizontal axis across the hit (a disc flips over its far edge)
    this.s.h.bi.SetAngularVelocity(this.s.id(ri), this.s.vec((dv[2]! / l) * m * 4, 0, (-dv[0]! / l) * m * 4));
    this.closeIntake(k);
  }

  /** After a checkpoint restore: egg layers and gravity, Dusty's mass (none of it is in Jolt's saved state). */
  afterRestore(): void {
    const s = this.s, w = this.w;
    const bi = s.h.bi, L = s.h.layers;
    for (let e = 0; e < this.eggBody.length; e++) {
      const live = w.egg?.[e] === 1;
      const id = s.id(this.eggBody[e]!);
      bi.SetObjectLayer(id, live ? L.moving : L.ghost);
      bi.SetGravityFactor(id, f32(live ? 1 : 0));
    }
    for (const k of this.bots) this.applyMass(k);
  }

  /** Clears and returns Henny's Impact stimulus since the last think (0 for everyone else). */
  takeImpact(k: number): number {
    const m = this.w.m4;
    if (!m?.length) return 0;
    const x = m[k]!;
    const v = x.imp;
    x.imp = 0;
    return v;
  }

  // ---- MOCHI: flee(Biscuit) ----------------------------------------------------------------------------------

  /**
   * The Biscuit Mochi flees (SIMULATION §7.3 flee(Biscuit)): an awake one inside 2.5 m in any direction, or one
   * chasing or barking inside her 8 m vision cone. Null at once in worlds without a dog (M2 runs are unchanged).
   */
  dogThreat(k: number): { at: Vec; d: number } | null {
    if (!this.dogs.length) return null;
    const s = this.s;
    const me = s.comOf(s.crits[k]!.base);
    let best: { at: Vec; d: number } | null = null;
    for (const dk of this.dogs) {
      const dc = this.w.c[dk]!;
      if ((dc.flags & CritterFlagBits.ragdoll) || dc.trap >= 0 || s.is(dc, 'sleep', 'wake', 'getup', 'dizzy', 'shake_off')) continue;
      const at = s.comOf(s.crits[dk]!.base);
      const d = vlen(vsub(at, me));
      const hunting = s.is(dc, 'chase', 'bark');
      if (d > 2.5 && !(hunting && d <= s.crits[k]!.spec.vision && s.canSee(k, at))) continue;
      if (!best || d < best.d) best = { at, d };
    }
    return best;
  }

  // ---- think (every 4 ticks) ---------------------------------------------------------------------------------

  think(k: number, heard: number, touched: boolean, imp: number, from: Vec, cause: number): void {
    switch (this.sp(k)) {
      case 'biscuit': this.thinkBiscuit(k, heard, touched, from, cause); break;
      case 'henny': this.thinkHenny(k, heard, touched, imp, from, cause); break;
      case 'dusty': this.thinkDusty(k, heard, touched, from, cause); break;
      default:
    }
  }

  private thinkBiscuit(k: number, heard: number, touched: boolean, from: Vec, cause: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    if (c.trap >= 0 || s.is(c, 'wake', 'shake_off')) return;
    if (c.speed > 0.05) this.avoidBarge(k); else c.avoid = 0;
    const loud = heard >= cr.spec.hearDb;
    if (c.fsm === F.sleep) { if (loud || touched) this.wake(k, from, cause); return; }
    // Mochi, by smell (10 m) — she is a 'mochi' lure; vision reaches the same distance
    const prey = s.bestLure(k);
    if (prey && (s.critOfPart[prey.part] ?? -1) >= 0) {
      const mk = s.critOfPart[prey.part]!;
      const mc = this.w.c[mk]!;
      const at = s.partCom(prey.part);
      x.mx = at[0]; x.mz = at[2]; x.mt = s.ticks(B.sniff); x.idle = 0;
      c.target = prey.part;
      if (c.fsm === F.bark) return; // already barking at her (act ends it)
      const stuck = c.fsm === F.chase && c.stuck > s.ticks(1) && prey.d < 1.5;
      if (mc.trap >= 0 || stuck) {
        // she's in a cage or out of reach: stand and bark at her
        c.speed = 0; x.cd = 0;
        s.setFsm(k, 'bark', B.barkAt);
        return;
      }
      if (prey.d <= B.tag + cr.spec.capsule.length / 2) {
        // tag, you're it: chases end in play, never a bite (critters.md)
        c.speed = 0; c.target = -1; c.chaseT = 0;
        c.ignore = prey.part; c.ignoreT = s.ticks(10);
        s.setFsm(k, 'celebrate', 1.5);
        s.setEmote(k, 'heart', 1.5);
        return;
      }
      if (c.chaseT > s.ticks(B.chaseMax)) {
        c.ignore = prey.part; c.ignoreT = s.ticks(8); c.target = -1; c.chaseT = 0; c.speed = 0;
        s.setFsm(k, 'lost', 1); s.setEmote(k, '?', 1);
        return;
      }
      c.gx = at[0]; c.gz = at[2];
      c.speed = cr.spec.run;
      if (c.fsm !== F.chase) { c.chaseT = 0; x.cd = 0; s.setFsm(k, 'chase', -1, true, cause); s.setEmote(k, 'eyes_mochi', 1.5); }
      return;
    }
    if (c.fsm === F.chase || c.fsm === F.bark) {
      // lost her: follow the trail to where she was last
      c.target = -1; c.chaseT = 0;
      if (x.mt > 0) this.sniffTo(k, x.mx, x.mz); else { c.speed = 0; s.setFsm(k, 'lost', 1); s.setEmote(k, '?', 1); }
      return;
    }
    if (loud && c.fsm !== F.sniff) { this.sniffTo(k, from[0]!, from[2]!); s.setEmote(k, '?', 1); x.idle = 0; return; }
    if (c.fsm === F.sniff) {
      const p = s.posOf(cr.base);
      if (hlen([c.gx - p[0], 0, c.gz - p[2]]) < 0.25 || c.stuck > s.ticks(1.5)) { c.speed = 0; s.setFsm(k, 'lost', 0.8); s.setEmote(k, '?', 1); }
      return;
    }
    s.routine(k);
  }

  private wake(k: number, from: Vec, cause: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    c.speed = 0; c.target = -1;
    x.mx = from[0]!; x.mz = from[2]!; x.mt = s.ticks(B.sniff); x.idle = 0;
    x.hd = s.ticks(s.rand(c, B.settle[0], B.settle[1]));
    s.setFsm(k, 'wake', B.wake, true, cause);
    s.setEmote(k, '!', 1);
  }

  private sniffTo(k: number, gx: number, gz: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    c.gx = gx; c.gz = gz; c.target = -1;
    c.speed = cr.spec.walk * 0.8;
    s.setFsm(k, 'sniff', B.sniff);
  }

  /** Biscuit's 3 forward avoidance rays (SIMULATION §7.4), but light dynamic bodies don't count: he barges them. */
  private avoidBarge(k: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const pos = s.posOf(cr.base);
    const want = datan2(c.gx - pos[0], c.gz - pos[2]);
    const hgt = cr.spec.capsule.at[1];
    const len = Math.min(0.3 + c.speed * 0.6, hlen([c.gx - pos[0], 0, c.gz - pos[2]]));
    const nose = cr.spec.capsule.length / 2;
    const max = cr.spec.barge ?? 0;
    let portal = false; // M5 (B5): the middle ray ends in a paired RIFT GATE's aperture he fits through
    const blocked = [-0.5, 0, 0.5].map((off) => {
      const a = want + off;
      const dir: Vec = [dsin(a), 0, dcos(a)];
      const o = vadd(pos, [dir[0] * nose * 0.5, hgt, dir[2] * nose * 0.5]);
      const hit = s.castHit(o, vadd(o, [dir[0] * (len + nose * 0.5), 0, dir[2] * (len + nose * 0.5)]), cr.ignoreSelf);
      if (hit.f >= 1) return false;
      if (off === 0 && s.riftOpen(k, hit.body, vadd(o, [dir[0] * (len + nose * 0.5) * hit.f, 0, dir[2] * (len + nose * 0.5) * hit.f]))) portal = true;
      const b = s.h.bodies[hit.body];
      if (b && b.dynamic && (s.bodyCrit[hit.body] ?? -1) < 0 && b.role !== 'rag') {
        const inv = b.body.GetMotionProperties().GetInverseMass();
        if (inv > 0 && 1 / inv <= max) return false; // he'll shove it aside
      }
      return true;
    });
    if (portal) { c.avoid = 0; return; } // M5 (B5): straight in, the gate takes him to its partner
    const [l, m, r] = blocked as [boolean, boolean, boolean];
    if (!l && !m && !r) { c.avoid = 0; return; }
    if (m && l && r) { c.avoid = c.avoid !== 0 ? c.avoid : (s.rand(c) < 0.5 ? -1.4 : 1.4); return; }
    if (r && !l) c.avoid = -0.9;
    else if (l && !r) c.avoid = 0.9;
    else c.avoid = c.avoid !== 0 ? c.avoid : (s.rand(c) < 0.5 ? -0.9 : 0.9);
  }

  private thinkHenny(k: number, heard: number, touched: boolean, imp: number, from: Vec, cause: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!, x = this.x(k);
    if (s.is(c, 'flap', 'lay_egg', 'glide_down', 'proud_puff')) return;
    const fright = heard >= cr.spec.hearDb || touched || imp > 0;
    if (fright) {
      c.speed = 0; c.target = -1;
      if (c.trap >= 0) {
        // the cage leaves no room for a flap (D14): a startle and a feather puff instead
        s.setFsm(k, 'startled', 0.5, true, cause);
        s.setEmote(k, 'feather', 1.2);
        return;
      }
      const src: Vec = imp > 0 && heard < cr.spec.hearDb && !touched ? [x.ix, 0, x.iz] : from;
      const me = s.posOf(cr.base);
      const away = s.leash(k, [me[0] - src[0]!, 0, me[2] - src[2]!]);
      c.gx = away[0]; c.gz = away[2]; // the drift direction while she flaps
      s.setFsm(k, 'startled', 0.2, true, cause);
      s.setEmote(k, '!!', 1.2);
      return;
    }
    if (c.trap >= 0) return;
    if (c.speed > 0.05) s.avoidRays(k); else c.avoid = 0;
    s.routine(k);
  }

  private thinkDusty(k: number, heard: number, touched: boolean, from: Vec, cause: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!, x = this.x(k), h = s.h;
    c.avoid = 0; // a robot vacuum feels its way with its bumper
    if (c.trap >= 0 || s.is(c, 'bin_full', 'startled', 'flee')) return;
    if (heard >= cr.spec.hearDb || touched) { this.startleDusty(k, from, cause); return; }
    // unpowered on its charge leash: asleep until power comes back
    const leashed = h.powerLinked(cr.part);
    if (leashed && !(h.st().supply[cr.part]! > 0)) {
      if (c.fsm !== F.sleep || c.dur >= 0) { c.speed = 0; c.target = -1; s.setFsm(k, 'sleep', -1); s.setEmote(k, 'zzz', 2); }
      return;
    }
    if (c.fsm === F.sleep) {
      if (c.dur < 0 && !this.full(k)) { x.cd = s.ticks(s.rand(c, D.stint[0], D.stint[1])); s.setFsm(k, 'patrol', -1); }
      return;
    }
    if (s.is(c, 'bump_turn', 'scan')) return;
    // tipped: falling, or its centre has run off an edge (> 60° once it rolls over it): a rigid tumble
    const pos = s.posOf(cr.base), v = s.velOf(cr.base);
    if (v[1] < -1.5) { this.tumble(k, v); return; }
    if (Math.abs(v[1]) < 0.15 && s.cast([pos[0], pos[1] + 0.03, pos[2]], [pos[0], pos[1] - 0.05, pos[2]], false, cr.ignoreSelf) >= 1) { this.tumble(k, v); return; }
    // pushed out of its zone: head home
    if (!this.inZone(k, pos, 0.05)) {
      const z = this.zones[k]!;
      x.hd = datan2(z.cx - pos[0], z.cz - pos[2]);
      if (!s.is(c, 'patrol')) { c.target = -1; s.setFsm(k, 'patrol', -1); }
      return;
    }
    // grains in reach: beeline, then vacuum
    if (!this.full(k) && c.fsm !== F.vacuum) {
      const g = this.grains(k);
      if (g) {
        c.gx = g.at[0]; c.gz = g.at[2]; c.target = g.part;
        const d = hlen([g.at[0] - pos[0], 0, g.at[2] - pos[2]]);
        if (d < 0.1) { this.startVacuum(k, g.part); return; }
        if (c.fsm !== F.beeline) { s.setFsm(k, 'beeline', 10); s.setEmote(k, '!', 0.8); }
        return;
      }
      if (c.fsm === F.beeline) { c.target = -1; s.setFsm(k, 'patrol', -1); return; }
    }
    if (c.fsm !== F.patrol) return;
    // the zone edge ahead: turn back in
    const fwd: Vec = [dsin(x.hd), 0, dcos(x.hd)];
    const ahead: Vec = [pos[0] + fwd[0] * (cr.spec.disc!.radius + 0.12), 0, pos[2] + fwd[2] * (cr.spec.disc!.radius + 0.12)];
    if (!this.inZone(k, ahead, 0)) {
      const z = this.zones[k]!;
      const to: Vec = [z.cx - pos[0], 0, z.cz - pos[2]];
      const side = fwd[0] * to[2] - fwd[2] * to[0]; // > 0: the centre is to the right of the heading (yaw grows to the left)
      this.bumpTurn(k, side > 0 ? -1 : 1);
    }
  }

  private startleDusty(k: number, from: Vec, cause: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const v = s.velOf(cr.base);
    // a 2 cm hop (critters.md `startled`), O O eyes
    if (Math.abs(v[1]) < 0.3) { s.h.bi.SetLinearVelocity(s.id(cr.base), s.vec(v[0] * 0.3, Math.sqrt(2 * G * 0.02), v[2] * 0.3)); s.h.bi.ActivateBody(s.id(cr.base)); }
    const me = s.posOf(cr.base);
    c.gx = me[0] - from[0]!; c.gz = me[2] - from[2]!; // flee: away from the noise
    c.speed = 0; c.target = -1;
    s.setFsm(k, 'startled', 0.5, true, cause);
    s.setEmote(k, '!', 1.2);
  }

  private tumble(k: number, v: Vec): void {
    const s = this.s, cr = s.crits[k]!;
    const yaw = yawOf(s.rotOf(cr.base));
    // it rolls off forward (the way it was driving), then flips over the edge
    // (the ragdoll keeps the body's own velocity, `v`, and adds this)
    s.ragdoll(k, [dsin(yaw) * 0.4, 0, dcos(yaw) * 0.4], 0, s.h.cause(cr.part));
    void v;
  }

  /** Grains for Dusty: `machine.matter.near` when the Matter host offers it, else stand-in grain patches (lures). */
  private grains(k: number): { at: Vec; part: number } | null {
    const s = this.s, cr = s.crits[k]!;
    const m = s.h.matter();
    const me = s.comOf(cr.base);
    if (m?.active && m.near) {
      const g = m.near(me, cr.spec.vision, D.kindMask);
      if (g && this.inZone(k, g, 0.25)) return { at: [g[0]!, g[1]!, g[2]!], part: -1 };
    }
    const l = s.bestLure(k);
    if (l && l.part >= s.h.parts.length) {
      const at = s.partCom(l.part);
      if (this.inZone(k, at, 0.25)) return { at: [at[0]!, at[1]!, at[2]!], part: l.part };
    }
    // fresh grains it just ran over (Matter): go back for them
    const x = this.x(k);
    if (x.mt > 0 && x.n > 0) return { at: [x.mx, 0, x.mz], part: -1 };
    return null;
  }

  private startVacuum(k: number, part: number): void {
    const s = this.s, c = this.w.c[k]!;
    c.target = part; c.speed = 0;
    s.setFsm(k, 'vacuum', part >= 0 ? D.patchTime : 3);
    s.setEmote(k, 'sparkle_clean', 1.5);
  }

  private bumpTurn(k: number, sign: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const a = s.rand(c, Math.PI / 6, (5 * Math.PI) / 6); // 30–150° (critters.md bump_turn)
    const yaw = yawOf(s.rotOf(cr.base));
    x.hd = wrapPi(yaw + sign * a);
    c.speed = 0; c.target = -1;
    s.setFsm(k, 'bump_turn', 0.25 + a / cr.spec.turn);
  }

  /** The bumper (SENSOR__trigger__bumper: front 180° arc, ≥ 0.05 N·s) → bump_turn away from the hit. */
  private bumper(k: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const J = this.tBump[k]!;
    if (J < D.bumpJ || !s.is(c, 'patrol', 'beeline', 'vacuum') || s.baseMode(c) !== 'free') return;
    const yaw = yawOf(s.rotOf(cr.base));
    const fwd: Vec = [dsin(yaw), 0, dcos(yaw)];
    const nx = this.tBumpN[k * 2]!, nz = this.tBumpN[k * 2 + 1]!; // from the obstacle into Dusty
    if (nx * fwd[0] + nz * fwd[2] > -0.05) return; // behind the bumper's arc
    const side = fwd[0] * -nz - fwd[2] * -nx; // obstacle to the right (> 0) or left
    const sign = side > 0.05 ? 1 : side < -0.05 ? -1 : (s.rand(c) < 0.5 ? -1 : 1);
    if (c.fsm === F.vacuum && c.target >= 0) { c.ignore = c.target; c.ignoreT = s.ticks(10); }
    this.bumpTurn(k, sign);
  }

  // ---- act (every tick) ------------------------------------------------------------------------------------

  act(k: number): void {
    const x = this.x(k);
    if (x.ov > 0 && --x.ov === 0) x.ovk = 0;
    if (x.mt > 0) x.mt--;
    switch (this.sp(k)) {
      case 'biscuit': this.actBiscuit(k); break;
      case 'henny': this.actHenny(k); break;
      case 'dusty': this.actDusty(k); break;
      default:
    }
  }

  /** The timed states every M4 critter shares (getup → dizzy → its huff); true if it handled the state. */
  private commonTimed(k: number): boolean {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    switch (c.fsm) {
      case F.getup: s.setFsm(k, 'dizzy', 2); s.setEmote(k, 'stars', 2); return true;
      case F.dizzy:
        if (cr.spec.species === 'biscuit') { s.setFsm(k, 'shake_off', 1.0); return true; }
        s.setFsm(k, 'indignant', 1); s.setEmote(k, cr.spec.huff, 1.2); return true;
      case F.wander: c.speed = 0; s.setFsm(k, 'idle', 1); return true;
      case F.trapped: return true;
      default: return false;
    }
  }

  private actBiscuit(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    if (x.cd > 0) x.cd--;
    if (s.timeUp(c) && !this.commonTimed(k)) {
      switch (c.fsm) {
        case F.wake:
          if (x.mt > 0) this.sniffTo(k, x.mx, x.mz); else { c.speed = 0; s.setFsm(k, 'idle', 1); }
          break;
        case F.sniff: c.speed = 0; s.setFsm(k, 'lost', 0.8); s.setEmote(k, '?', 1); break;
        case F.bark:
          // she's not coming out: he gives it up (longer than his settle time, so he naps meanwhile)
          if (c.target >= 0) { c.ignore = c.target; c.ignoreT = s.ticks(20); }
          c.target = -1; c.speed = 0; s.setFsm(k, 'lost', 1); s.setEmote(k, '?', 1);
          break;
        case F.shake_off: case F.indignant: case F.lost: case F.celebrate: case F.idle: this.idleNext(k); break;
        default:
      }
    }
    switch (c.fsm) {
      case F.chase: c.chaseT++; if (x.cd === 0) this.bark(k); break;
      case F.bark: if (x.cd === 0) this.bark(k); break;
      case F.idle: case F.wander: case F.lost:
        // nothing going on: back to sleep in the end
        if (++x.idle >= x.hd && x.hd > 0) { c.speed = 0; c.target = -1; s.setFsm(k, 'sleep', -1); s.setEmote(k, 'zzz', 2); }
        break;
      default:
    }
    if (c.fsm === F.trapped) { s.faceTrap(k); return; }
    s.steer(k);
    if (c.fsm === F.wake) this.face(k, x.mx, x.mz);
  }

  private bark(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const at = vadd(s.posOf(cr.base), qrot(yawQ(yawOf(s.rotOf(cr.base))), cr.spec.mouth ?? cr.spec.eye));
    const id = s.h.emit('Bark', cr.part, at, B.barkDb, -1, s.h.cause(cr.part));
    s.h.sound(at, B.barkDb, cr.part, id);
    x.cd = s.ticks(B.barkEvery);
    x.ov = s.ticks(0.6); x.ovk = 1;
    s.setEmote(k, 'bark', 0.8);
    void c;
  }

  /** Turns a critter on the spot toward a point (wake: the noise). */
  private face(k: number, gx: number, gz: number): void {
    const s = this.s, cr = s.crits[k]!;
    const p = s.posOf(cr.base);
    if (hlen([gx - p[0], 0, gz - p[2]]) < 0.05) return;
    const e = wrapPi(datan2(gx - p[0], gz - p[2]) - yawOf(s.rotOf(cr.base)));
    s.h.bi.SetAngularVelocity(s.id(cr.base), s.vec(0, clamp(e * 8, -cr.spec.turn, cr.spec.turn), 0));
  }

  /** Shoves the light bodies Biscuit ran into aside (critters.md: barges through bodies ≤ 6 kg). */
  private barge(): void {
    const s = this.s, h = s.h, L = h.layers;
    const pairs: [number, number][] = [];
    for (let i = 0; i < this.tBarge.length; i += 2) pairs.push([this.tBarge[i]!, this.tBarge[i + 1]!]);
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let last = '';
    for (const [k, bi] of pairs) {
      const key = `${k}:${bi}`;
      if (key === last) continue;
      last = key;
      const c = this.w.c[k]!, cr = s.crits[k]!;
      if (s.baseMode(c) !== 'free' || !s.is(c, 'chase', 'sniff', 'wander')) continue;
      const v = s.velOf(cr.base);
      const sp = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
      if (sp < 0.3) continue;
      const b = h.bodies[bi]!;
      if (!b.dynamic || b.ghost || !h.st().alive[b.part] || b.body.GetObjectLayer() === L.ghost) continue; // rule 8
      const inv = b.body.GetMotionProperties().GetInverseMass();
      if (inv <= 0) continue;
      const fwd: Vec = [v[0] / sp, 0, v[2] / sp];
      const rel = vsub(s.comOf(bi), s.comOf(cr.base));
      const side = fwd[0] * rel[2] - fwd[2] * rel[0] > 0 ? 1 : -1; // which side of his line it sits
      const aside: Vec = [fwd[2] * side * -1, 0, fwd[0] * side];
      const dv = Math.min(8, sp);
      const imp: Vec = [(aside[0] * 0.9 + fwd[0] * 0.4) * dv / inv, 0.15 * dv / inv, (aside[2] * 0.9 + fwd[2] * 0.4) * dv / inv];
      h.bi.AddImpulse(b.body.GetID(), s.vec(imp[0], imp[1], imp[2]));
      h.bi.ActivateBody(b.body.GetID());
      const x = this.x(k);
      if (x.ovk !== 1) { x.ov = s.ticks(0.4); x.ovk = 2; }
    }
  }

  private idleNext(k: number): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const r = s.rand(c);
    c.target = -1;
    if (cr.spec.species === 'henny') {
      if (r < 0.08) { c.speed = 0; s.setFsm(k, 'nap', s.rand(c, 5, 10)); s.setEmote(k, 'zzz', 2); return; }
      if (r < 0.38) { c.speed = 0; s.setFsm(k, 'peck', s.rand(c, 1.5, 3)); return; }
      if (r < 0.55) { c.speed = 0; s.setFsm(k, 'scratch', s.rand(c, 1, 2)); return; }
      if (r < 0.85) { s.wanderGoal(k); s.setFsm(k, 'wander', 8); return; }
    } else if (cr.spec.species === 'biscuit') {
      if (r < 0.45) { s.wanderGoal(k); s.setFsm(k, 'wander', 8); return; }
      if (r < 0.6) {
        const p = s.posOf(cr.base);
        const a = s.rand(c, 0, 2 * Math.PI);
        this.sniffTo(k, p[0] + dsin(a), p[2] + dcos(a));
        return;
      }
    }
    c.speed = 0;
    c.aux = s.rand(c) < 0.35 ? 1 : 0; // idle_alt
    s.setFsm(k, 'idle', s.rand(c, 1.5, 4));
  }

  private actHenny(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    if (x.cd > 0) x.cd--;
    if (s.timeUp(c) && !this.commonTimed(k)) {
      switch (c.fsm) {
        case F.startled:
          if (c.trap >= 0) s.setFsm(k, 'trapped', -1);
          else { x.hd = s.posOf(cr.base)[1]; x.laid = 0; s.setFsm(k, 'flap', H.flapTime); }
          break;
        case F.flap: {
          const eggs = this.eggsOf[k]!;
          const free = eggs.some((e) => this.w.egg![e] === 0);
          if (free && x.cd === 0) { c.gy = s.posOf(cr.base)[1]; s.setFsm(k, 'lay_egg', H.layTime); }
          else s.setFsm(k, 'glide_down', -1);
          break;
        }
        case F.lay_egg: s.setFsm(k, 'glide_down', -1); break;
        case F.indignant: case F.lost: case F.celebrate: case F.idle: case F.proud_puff: case F.peck: case F.scratch: case F.nap:
          this.idleNext(k); break;
        default:
      }
    }
    const id = s.id(cr.base);
    const v = s.velOf(cr.base);
    const p = s.posOf(cr.base);
    const dt = 1 / s.h.tickRate;
    switch (c.fsm) {
      case F.flap: {
        // the engine lifts her 1.0 m over the 0.6 s flap (ease-out), drifting away from the fright
        const T = Math.max(1, c.dur);
        const u = Math.min(1, (c.t + 1) / T);
        const want = x.hd + H.flap * (1 - (1 - u) * (1 - u));
        const vy = clamp((want - p[1]) / dt, -2, 6) + G * dt;
        s.h.bi.SetLinearVelocity(id, s.vec(c.gx * 0.3, vy, c.gz * 0.3));
        s.h.bi.ActivateBody(id);
        return;
      }
      case F.lay_egg: {
        // hovering at the apex; the YOLK drops out at frame 18 (critters.md lay_egg)
        const vy = clamp((c.gy - p[1]) * 10, -1, 1) + G * dt;
        s.h.bi.SetLinearVelocity(id, s.vec(v[0] * 0.9, vy, v[2] * 0.9));
        s.h.bi.ActivateBody(id);
        if (c.t === s.ticks(H.layAt)) this.layEgg(k);
        return;
      }
      case F.glide_down: {
        const grounded = c.t > 2 && Math.abs(v[1]) < 0.3 && s.cast([p[0], p[1] + 0.02, p[2]], [p[0], p[1] - 0.03, p[2]], false, cr.ignoreSelf) < 1;
        if (grounded || c.t > s.ticks(4)) {
          c.speed = 0;
          s.setFsm(k, 'proud_puff', 1.2);
          s.setEmote(k, x.laid ? 'egg' : 'feather', 1.5);
          break;
        }
        s.h.bi.SetLinearVelocity(id, s.vec(v[0] * 0.98, Math.max(v[1], -H.glide), v[2] * 0.98));
        return;
      }
      default:
    }
    if (c.fsm === F.trapped) { s.faceTrap(k); return; }
    if (c.fsm === F.startled) { s.brake(k, 2 * cr.spec.accel); return; }
    s.steer(k);
  }

  private layEgg(k: number): void {
    const s = this.s, w = this.w, x = this.x(k), cr = s.crits[k]!;
    const e = this.eggsOf[k]!.find((slot) => w.egg![slot] === 0);
    if (e === undefined) return;
    const yaw = yawOf(s.rotOf(cr.base));
    const at = vadd(s.posOf(cr.base), qrot(yawQ(yaw), cr.spec.vent ?? [0, 0.1, -0.1]));
    const v = s.velOf(cr.base);
    // EMIT__egg__vent: the YOLK leaves with the body's velocity + 0.2 m/s downward
    const id = s.id(this.eggBody[e]!);
    w.egg![e] = 1;
    s.h.bi.SetObjectLayer(id, s.h.layers.moving);
    s.h.bi.SetGravityFactor(id, f32(1));
    s.h.bi.SetPositionRotationAndVelocity(id, s.rvec(at), s.quat(yawQ(yaw)), s.vec(v[0], v[1] - 0.2, v[2]), s.vec2(0, 0, 0));
    s.h.bi.ActivateBody(id);
    x.n++;
    x.cd = s.ticks(H.eggCooldown);
    x.laid = 1;
    s.h.emit('Lay', cr.part, at, x.n, -1, s.h.cause(cr.part));
    s.setEmote(k, 'egg', 1.5);
  }

  private splat(e: number, J: number, cause: number): void {
    const s = this.s, w = this.w;
    const at = s.comOf(this.eggBody[e]!);
    w.egg![e] = 2;
    s.h.emit('Splat', s.crits[this.eggCrit[e]!]!.part, at, J, -1, cause);
    this.park(e);
  }

  /** A spent egg goes back to its parking spot as a dormant ghost (never pushed again: rule 8). */
  private park(e: number): void {
    const s = this.s, bi = s.h.bi;
    const id = s.id(this.eggBody[e]!);
    bi.SetObjectLayer(id, s.h.layers.ghost);
    bi.SetGravityFactor(id, f32(0));
    bi.SetPositionRotationAndVelocity(id, s.rvec(this.eggPark[e]!), s.quat([0, 0, 0, 1]), s.vec(0, 0, 0), s.vec2(0, 0, 0));
    bi.DeactivateBody(id);
  }

  private actDusty(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    c.avoid = 0;
    // machine.matter's per-tick intake (MI): called in stage 6 of every tick, open (500 grains per Matter tick) or
    // closed (0) — closed while full, asleep, tumbling, trapped or startled, so a full bin takes nothing
    this.intakeTick(k);
    if (s.timeUp(c) && !this.commonTimed(k)) {
      switch (c.fsm) {
        case F.indignant: case F.celebrate: case F.lost: case F.idle: s.setFsm(k, 'patrol', -1); break;
        case F.startled: {
          // reverse and spin away (critters.md flee)
          const l = Math.max(1e-6, hlen([c.gx, 0, c.gz]));
          c.gx /= l; c.gz /= l;
          s.setFsm(k, 'flee', 1.0);
          break;
        }
        case F.flee: case F.bump_turn: case F.beeline: s.setFsm(k, 'patrol', -1); break;
        case F.vacuum:
          if (c.target >= 0) { c.ignore = c.target; c.ignoreT = s.ticks(30); }
          c.target = -1; s.setFsm(k, 'patrol', -1);
          break;
        case F.bin_full: c.speed = 0; s.setFsm(k, 'sleep', -1); s.setEmote(k, 'zzz', 2); break;
        case F.scan: c.speed = 0; s.setFsm(k, 'sleep', s.rand(c, D.nap[0], D.nap[1])); s.setEmote(k, 'zzz', 2); break;
        case F.sleep:
          if (!this.full(k)) { x.cd = s.ticks(s.rand(c, D.stint[0], D.stint[1])); s.setFsm(k, 'patrol', -1); }
          else c.dur = -1;
          break;
        default:
      }
    }
    const full = this.full(k);
    if (full && s.is(c, 'patrol', 'beeline', 'vacuum', 'bump_turn')) {
      c.speed = 0; c.target = -1;
      s.setFsm(k, 'bin_full', 2);
      s.setEmote(k, 'bin_full', 2);
      this.closeIntake(k);
    }
    const slow = 1 - (1 - D.fullSpeed) * clamp(x.bin / this.binCap(k), 0, 1); // the bin's weight slows it
    const pos = s.posOf(cr.base);
    const id = s.id(cr.base);
    switch (c.fsm) {
      case F.patrol: {
        if (x.cd > 0) x.cd--;
        if (x.cd === 0) { c.speed = 0; s.setFsm(k, 'scan', 1.5); s.setEmote(k, '?', 1); break; }
        c.speed = cr.spec.walk * slow;
        c.gx = pos[0] + dsin(x.hd) * 0.5; c.gz = pos[2] + dcos(x.hd) * 0.5;
        if (c.stuck > s.ticks(1)) { c.stuck = 0; this.bumpTurn(k, s.rand(c) < 0.5 ? -1 : 1); }
        break;
      }
      case F.beeline: c.speed = cr.spec.run * slow; break;
      case F.vacuum: {
        if (c.target >= 0) {
          // a stand-in grain patch (no Matter): circle over it, filling the bin
          const at = s.partCom(c.target);
          c.gx = at[0]!; c.gz = at[2]!; c.speed = 0.08;
          this.addGrains(k, D.patchRate / s.h.tickRate, Math.round(D.patchRate / s.h.tickRate / D.grainKg[0]));
        } else {
          // Matter: creeping forward into the grains with a gentle weave while the intake keeps taking them
          x.hd = wrapPi(x.hd + 0.9 * dcos((c.t / s.h.tickRate) * 2.2) / s.h.tickRate);
          c.gx = pos[0] + dsin(x.hd) * 0.3; c.gz = pos[2] + dcos(x.hd) * 0.3; c.speed = 0.12 * slow;
          if (x.mt > 0) c.dur = Math.max(c.dur, c.t + s.ticks(1)); // still sucking: keep at it
        }
        if (s.h.tickRate > 0 && c.t % s.ticks(0.3) === 0) { x.ov = s.ticks(0.3); x.ovk = 3; }
        break;
      }
      case F.flee: {
        // reverse, spinning away from the noise
        const v = s.velOf(cr.base);
        s.h.bi.SetLinearVelocity(id, s.vec(c.gx * 0.2, v[1], c.gz * 0.2));
        s.h.bi.SetAngularVelocity(id, s.vec(0, 3, 0));
        s.h.bi.ActivateBody(id);
        return;
      }
      case F.bump_turn: {
        s.brake(k, 2 * cr.spec.accel);
        this.face(k, pos[0] + dsin(x.hd), pos[2] + dcos(x.hd));
        return;
      }
      case F.scan: {
        // stops and sweeps ±25° (critters.md sniff)
        s.brake(k, 2 * cr.spec.accel);
        s.h.bi.SetAngularVelocity(id, s.vec(0, 0.9 * dcos((c.t / s.h.tickRate) * 4.2), 0));
        return;
      }
      default:
    }
    if (c.fsm === F.trapped) { s.brake(k, 2 * cr.spec.accel); return; } // bumps in place without turning
    if (s.is(c, 'startled', 'sleep', 'bin_full', 'getup', 'dizzy', 'indignant')) { c.speed = 0; }
    s.steer(k);
  }

  /** Dusty's Matter intake: grains → bin (kg), heavier and slower; a remembered spot to come back to. */
  private absorb(k: number): void {
    const s = this.s, cr = s.crits[k]!;
    const m = s.h.matter();
    if (!m?.active) return;
    const a = m.absorbed(cr.part);
    let kg = 0, n = 0;
    for (let j = 0; j < 3; j++) { const v = a[j] ?? 0; n += v; kg += v * D.grainKg[j]!; }
    if (n <= 0) return;
    this.addGrains(k, kg, n);
    const c = this.w.c[k]!, x = this.x(k);
    const p = s.posOf(cr.base);
    x.mx = p[0]; x.mz = p[2]; x.mt = s.ticks(1.5);
    if (s.is(c, 'patrol', 'beeline')) this.startVacuum(k, -1);
  }

  private addGrains(k: number, kg: number, n: number): void {
    const x = this.x(k);
    x.bin = Math.min(this.binCap(k), x.bin + kg);
    x.n += n;
    this.applyMass(k);
  }

  /** The bin's grains are part of Dusty's mass (re-applied after a restore: mass isn't in Jolt's saved state). */
  applyMass(k: number): void {
    const s = this.s, cr = s.crits[k]!;
    const x = this.w.m4?.[k];
    if (!x) return;
    this.setMass(cr.base, cr.spec.mass + x.bin);
    if (this.w.c[k]!.flags & CritterFlagBits.ragdoll) this.setMass(cr.rags[0]!, cr.spec.mass + x.bin);
  }

  /**
   * Sets a body's mass as a pure function of `kg`, from the mass properties it was built with: inverse mass 1/kg,
   * inverse inertia scaled by built mass / kg. (Jolt's ScaleToMass is relative, so chains of it round differently
   * after a restore than in the straight run: the critter soak caught that as a late desync.)
   */
  private captureMass(bi: number): { m0: number; inv: number[]; rot: number[] } {
    const mp = this.s.body(bi).GetMotionProperties();
    const d = mp.GetInverseInertiaDiagonal();
    const inv = [d.GetX(), d.GetY(), d.GetZ()];
    const q = mp.GetInertiaRotation();
    const ref = { m0: 1 / mp.GetInverseMass(), inv, rot: [q.GetX(), q.GetY(), q.GetZ(), q.GetW()] };
    this.massRef.set(bi, ref);
    return ref;
  }

  private setMass(bi: number, kg: number): void {
    const s = this.s;
    const mp = s.body(bi).GetMotionProperties();
    const ref = this.massRef.get(bi) ?? this.captureMass(bi);
    const r = ref.m0 / kg;
    mp.SetInverseMass(f32(1 / kg));
    mp.SetInverseInertia(s.vec(ref.inv[0]! * r, ref.inv[1]! * r, ref.inv[2]! * r), s.quat(ref.rot));
  }

  private binCap(k: number): number { return this.s.crits[k]!.spec.intake?.bin ?? 1.8; }

  /** Mean mass of the grains in the bin (sand until it has taken any): sizes the intake near the brim. */
  private grainMass(k: number): number {
    const x = this.x(k);
    return x.n > 0 ? Math.max(D.grainKg[0], x.bin / x.n) : D.grainKg[0];
  }

  /** Full: less room left than one grain per Matter command in flight, so the intake closes before it could overflow. */
  private full(k: number): boolean {
    return this.binCap(k) - this.x(k).bin < IN_FLIGHT * this.grainMass(k);
  }

  /** Is the intake running in this state? (not while full, asleep, tumbling, trapped, startled or turning over). */
  private intakeOpen(k: number): boolean {
    const s = this.s, c = this.w.c[k]!;
    return !this.full(k) && s.baseMode(c) === 'free' && s.is(c, 'patrol', 'beeline', 'vacuum', 'bump_turn', 'scan');
  }

  /** This tick's intake call to machine.matter (a per-tick sensor), once per tick from act: open, or closed (0). */
  private intakeTick(k: number): void {
    const s = this.s, cr = s.crits[k]!;
    const m = s.h.matter();
    if (!m?.active || !cr.spec.intake) return;
    const open = this.intakeOpen(k);
    // A Matter command goes out at stage 13 of every even tick and its result lands 4 ticks later (SIMULATION §8.5),
    // so at stage 6 of an even tick two earlier commands are still to land. This one asks only for the room they
    // leave (in grains at the bin's mean grain mass), so whatever arrives fits the bin.
    const x = this.x(k);
    if (s.h.st().tick % 2 === 0) {
      const roomG = Math.floor((this.binCap(k) - x.bin) / this.grainMass(k));
      const cap = open ? clamp(roomG - x.q1 - x.q2, 0, INTAKE_CAP) : 0;
      x.q2 = x.q1; x.q1 = cap;
    }
    m.intake(cr.part, { min: cr.spec.intake.min, max: cr.spec.intake.max }, D.kindMask, open ? x.q1 : 0);
  }

  /** Closes the intake for this tick's command (a tumble or a full bin after this tick's intakeTick). */
  private closeIntake(k: number): void {
    const s = this.s, cr = s.crits[k]!;
    const m = s.h.matter();
    if (!m?.active || !cr.spec.intake) return;
    if (s.h.st().tick % 2 === 0) this.x(k).q1 = 0; // this tick's command now asks for nothing
    m.intake(cr.part, { min: cr.spec.intake.min, max: cr.spec.intake.max }, D.kindMask, 0);
  }

  private inZone(k: number, p: readonly number[], margin: number): boolean {
    const z = this.zones[k];
    if (!z) return true;
    const dx = p[0]! - z.cx, dz = p[2]! - z.cz;
    const c = dcos(z.yaw), sn = dsin(z.yaw);
    // into the zone's frame (yaw about +Y: local x = c·dx − s·dz, local z = s·dx + c·dz)
    const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
    return Math.abs(lx) <= z.hw + margin && Math.abs(lz) <= z.hd + margin;
  }

  // ---- finish: clips and flags ----------------------------------------------------------------------------------

  /** The clip (visual hint) for an M4 critter's state, null to use the shared mapping. */
  clip(k: number): CritterClip | null {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const sp = cr.spec.species;
    switch (c.fsm) {
      case F.sleep: return 'sleep';
      case F.wake: return 'wake_startle';
      case F.bark: return 'bark';
      case F.sniff: return 'sniff';
      case F.shake_off: return 'shake_off';
      case F.chase: return x.ovk === 1 ? 'bark_run' : x.ovk === 2 ? 'barge' : 'chase';
      case F.peck: return 'peck';
      case F.scratch: return 'scratch';
      case F.flap: return 'flap';
      case F.lay_egg: return 'lay_egg';
      case F.glide_down: return 'glide_down';
      case F.proud_puff: return 'proud_puff';
      case F.patrol: return c.speed > cr.spec.walk * 1.05 ? 'run' : 'walk';
      case F.bump_turn: return 'bump_turn';
      case F.beeline: return 'chase';
      case F.vacuum: return 'suck';
      case F.bin_full: return 'bin_full';
      case F.scan: return 'sniff';
      case F.wander: return sp === 'biscuit' && x.ovk === 2 ? 'barge' : 'walk';
      case F.idle: return c.aux === 1 ? (sp === 'biscuit' ? 'tail_wag' : 'idle_alt') : 'idle';
      default: return null;
    }
  }

  /** Extra critterState flag bits: DUSTY's intake running, and its bin's lit cells (bits 5–7). */
  flags(k: number): number {
    const cr = this.s.crits[k]!;
    if (cr.spec.species !== 'dusty') return 0;
    const x = this.x(k);
    const cells = Math.round(clamp(x.bin / this.binCap(k), 0, 1) * 5);
    return (this.intakeOpen(k) ? CritterFlagBits.sucking : 0) | (cells << CRITTER_BIN_SHIFT);
  }

  /** M4 states that count as asleep (the asleep flag, periodic zzz). */
  asleep(c: CritSt): boolean { return c.fsm === F.sleep; }
}
