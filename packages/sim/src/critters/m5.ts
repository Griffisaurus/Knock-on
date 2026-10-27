// M5 critter (stream B5): BUZZ the courier drone (GAME_SPEC §11, SIMULATION §7.3, critters.md BUZZ, D105). The
// CritterSystem (system.ts) owns the framework: bodies, ragdolls, contacts, the hooks; it hands BUZZ to this module in
// think / act / finish, like M4Critters (m4.ts).
//
//   docked (on its paired BUZZ BEACON, rotors off) → a call (the beacon's Signal: A5's `calls` runs ahead of BUZZ's
//   `served`) → takeoff → sniff (scan for the nearest tagged object ≤ 2 kg) → fly (cruise over whatever is below,
//   climbing over or side-stepping what's ahead) → grab (hover over it, pay the winch out until the claw touches its
//   top, close) → carry (the item rides as a ghost under the claw, like Bandit's loot) → drop_off (hover over the pad,
//   lower it until it touches, release) → deliver_bow → land on the pad (docked) if it's clear, else beside the beacon
//   (landed; it hops home once the pad clears). Nothing tagged: "?" and land. PARTSIM (D121): a big boom or a very loud
//   sound nearby startles it (0.6 s: a bob in the air or a blip off the ground, load kept), then it carries on; a carried
//   load sags its hover and slows its climb by its mass. A hit over 3 N·s: the shared rigid tumble
//   (one box), getup, dizzy, then it takes off again and finishes the job. Never recycled; it can't pass RIFT GATES
//   (its ducts span 0.34 m, the aperture is 0.31 m).
//
// Flight is a deterministic controller (D105): the locomotion body's gravity factor is 0 in every flying state and a
// PD on position (accel- and speed-limited) sets its velocity each tick. Gravity factors, object layers and the carried
// item's ghosting aren't in Jolt's saved state, so they are re-derived from plain state in afterRestore (rule 14).
//
// All run state is plain data in `st.crit` (CritSt + M5St), so checkpoints, rollback and the hash cover it; this object
// holds build-time wiring only (who is a BUZZ, the pairing, the tagged parts of the snapshot).

import { datan2, dcos, dsin, f32 } from '@knockon/detmath';
import { PartFlag } from '@knockon/format';
import { BUZZ_BEACON, BUZZ_PAIR_DEFAULT, BUZZ_ROTORS, CRITTER_FSM, CRITTER_M5, CRITTER_WINCH_SHIFT, type CritterClip, type CritterFsm } from '@knockon/parts-data';
import type { Hasher } from '@knockon/detmath';
import { qrot, vadd, vlen, vsub, type Q, type Vec } from '../vec.ts';
import { emptyM5, type CritSt, type CritWorld, type M5St } from './state.ts';
import type { CritterSystem } from './system.ts';

/** A5's view of one BUZZ BEACON (M5_NOTES_A5.md contract 3; `self.x.m5` in the Machine). */
export interface BeaconView {
  readonly part: number;
  readonly pair: number;
  /** World pose of `socket_dock` (the pad top), facing the beacon's +Z. */
  readonly dockPos: readonly number[];
  readonly dockRot: readonly number[];
  /** Signals received since the run started; the latest call's tick (−1 none) and its `Call` event id. */
  readonly calls: number;
  readonly callTick: number;
  readonly callCause: number;
}
/** What BUZZ uses of A5's beacon channel (structural, so either side can land first). */
export interface BeaconHost {
  beacons(): readonly number[];
  beacon(part: number): BeaconView | null;
  setBeaconStatus(part: number, s: number): void;
}

export const isM5 = (species: string): boolean => species === 'buzz';

const F = Object.fromEntries(CRITTER_FSM.map((s, i) => [s, i])) as Record<CritterFsm, number>;
const Z = CRITTER_M5.buzz;
const WINCH_Y = Z.winchAt[1];
/** States in which the rotors hold it up (gravity factor 0, PD flight). */
const FLYING: ReadonlySet<number> = new Set([F.takeoff, F.sniff, F.fly, F.grab, F.carry, F.drop_off, F.deliver_bow, F.land]);
/** Beacon status for A5's LED ring: 1 docked, 2 away. */
const DOCKED = 1, AWAY = 2;
/** PARTSIM (D121): states a loud sound can startle it out of (and back into): flying, or resting on the ground. */
const STARTLES: ReadonlySet<number> = new Set([...FLYING, F.docked, F.landed, F.idle]);

const yawOf = (q: readonly number[]): number => { const f = qrot(q, [0, 0, 1]); return datan2(f[0], f[2]); };
const yawQ = (y: number): Q => [0, dsin(y / 2), 0, dcos(y / 2)];
const wrapPi = (a: number): number => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const hdist = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

/** An item's world box (Jolt's world-space bounds): centre x / z, top, bottom, half extents x / z. */
interface ItemBox { readonly cx: number; readonly cz: number; readonly top: number; readonly bot: number; readonly hx: number; readonly hz: number }

export class M5Critters {
  readonly s: CritterSystem;
  /** BUZZ critter ordinals (part order). */
  readonly bots: number[] = [];
  /** Per critter ordinal: its paired beacon's part index (−1 none). Fixed at init (part order, deterministic). */
  pair: number[] = [];
  /** Tagged parts of the snapshot (part order; critters never count). */
  tagged: number[] = [];

  constructor(sys: CritterSystem) { this.s = sys; }

  private get w(): CritWorld { return this.s.w; }
  x(k: number): M5St { return this.w.m5![k]!; }
  private dt(): number { return 1 / this.s.h.tickRate; }
  private beaconHost(): BeaconHost | null { return this.s.h.beacons?.() ?? null; }

  // ---- building ---------------------------------------------------------------------------------------------

  onBuild(k: number, species: string): void { if (species === 'buzz') this.bots.push(k); }

  /** Once st exists (CritterSystem.init): the tagged set, M5 state, pairing, and the starting states. */
  init(world: CritWorld): void {
    const s = this.s, h = s.h;
    this.tagged = [];
    h.parts.forEach((p, i) => { if ((((p.flags ?? 0) & PartFlag.Tagged) !== 0) && !p.def.critter) this.tagged.push(i); });
    this.pair = s.crits.map(() => -1);
    world.m5 = this.bots.length ? s.crits.map(() => emptyM5()) : [];
    if (!this.bots.length) return;
    // pairing (M5_NOTES_B5 §contract 3): BUZZes in part order take the first beacon of their pair colour nobody took.
    // Read from the snapshot (type and `pair` prop), not A5's runtime view: critters initialise before the channels.
    const beacons: number[] = [];
    h.parts.forEach((p, i) => { if (p.def.type === 'buzz_beacon') beacons.push(i); });
    const taken = new Set<number>();
    for (const k of this.bots) {
      const want = h.parts[s.crits[k]!.part]!.props.pair ?? BUZZ_PAIR_DEFAULT;
      for (const b of beacons) {
        if (taken.has(b)) continue;
        if ((h.parts[b]!.props.pair ?? BUZZ_PAIR_DEFAULT) === want) { taken.add(b); this.pair[k] = b; break; }
      }
    }
    for (const k of this.bots) {
      const c = world.c[k]!, x = world.m5[k]!, cr = s.crits[k]!;
      const at = s.posOf(cr.base);
      const d = this.dock(k);
      if (d && vlen(vsub(at, d.p)) <= BUZZ_BEACON.bindRadius) {
        s.placeBase(k, [d.p[0], d.p[1] + 0.002, d.p[2]], d.yaw);
        x.dock = 1;
        s.setFsm(k, 'docked', -1, false);
      } else {
        s.setFsm(k, 'landed', -1, false);
      }
      const home = d ? d.p : at;
      c.homeX = home[0]; c.homeY = home[1]; c.homeZ = home[2];
      c.gx = at[0]; c.gy = at[1]; c.gz = at[2];
    }
  }

  // ---- the beacon --------------------------------------------------------------------------------------------

  /** Its beacon's dock: the pad-top point and BUZZ's facing there. Null without a (live) paired beacon. */
  dock(k: number): { p: Vec; yaw: number } | null {
    const b = this.pair[k]!;
    if (b < 0 || !this.s.st.alive[b]) return null;
    // the beacon body's pose and BUZZ_BEACON.dock: the same point as A5's `dockPos` (A5's BEACON.dock), computed here so it
    // also works while the critters initialise, before the channels have their state
    const p = this.s.h.parts[b]!;
    const pos = p.base >= 0 ? this.s.posOf(p.base) : [p.pos[0]!, p.pos[1]!, p.pos[2]!];
    const rot = p.base >= 0 ? this.s.rotOf(p.base) : p.rot;
    return { p: vadd(pos, qrot(rot, BUZZ_BEACON.dock)), yaw: yawOf(rot) };
  }

  private calls(k: number): number {
    const b = this.pair[k]!;
    if (b < 0) return 0;
    return this.beaconHost()?.beacon(b)?.calls ?? 0;
  }

  private pending(k: number): boolean { return this.pair[k]! >= 0 && this.calls(k) > this.x(k).served; }

  /** Is the pad clear? Five short rays down onto it (BUZZ itself and ghosts — a carried item — don't count). */
  padClear(k: number): boolean {
    const d = this.dock(k);
    if (!d) return false;
    const s = this.s, cr = s.crits[k]!;
    const r = BUZZ_BEACON.padRadius * 0.6;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]] as const) {
      const a: Vec = [d.p[0] + ox, d.p[1] + 0.6, d.p[2] + oz];
      if (s.cast(a, [a[0], d.p[1] + 0.004, a[2]], false, cr.ignoreSelf) < 1) return false;
    }
    return true;
  }

  private atDock(k: number): boolean {
    const d = this.dock(k);
    if (!d) return false;
    const p = this.s.posOf(this.s.crits[k]!.base);
    return hdist(p[0], p[2], d.p[0], d.p[2]) < 0.08 && Math.abs(p[1] - d.p[1]) < 0.04;
  }

  // ---- tagged items ------------------------------------------------------------------------------------------

  /** Can BUZZ lift this part? Tagged parts only: alive, a loose dynamic body (no hinge, no uncut LINE), ≤ 2 kg, free. */
  private fetchable(part: number, lines: readonly { readonly a: number; readonly b: number; readonly cut: boolean }[]): boolean {
    const s = this.s, h = s.h, st = s.st;
    if (!st.alive[part] || st.broken[part]) return false;
    const p = h.parts[part]!;
    if (p.def.critter || p.base < 0 || p.arm >= 0) return false;
    const b = h.bodies[p.base]!;
    if (!b.dynamic || b.ghost || b.body.GetObjectLayer() === h.layers.ghost) return false;
    if (s.carried(part)) return false;
    const inv = b.body.GetMotionProperties().GetInverseMass();
    if (!(inv > 0) || 1 / inv > Z.payload + 1e-6) return false;
    for (const l of lines) if (!l.cut && (l.a === part || l.b === part)) return false;
    return true;
  }

  private box(part: number): ItemBox {
    const bb = this.s.body(this.s.h.parts[part]!.base).GetWorldSpaceBounds();
    const lo = bb.mMin, hi = bb.mMax;
    return { cx: (lo.GetX() + hi.GetX()) / 2, cz: (lo.GetZ() + hi.GetZ()) / 2, top: hi.GetY(), bot: lo.GetY(), hx: (hi.GetX() - lo.GetX()) / 2, hz: (hi.GetZ() - lo.GetZ()) / 2 };
  }

  private kgOf(part: number): number {
    const inv = this.s.body(this.s.h.parts[part]!.base).GetMotionProperties().GetInverseMass();
    return inv > 0 ? 1 / inv : Z.payload;
  }

  /** An item resting on its own pad has been delivered: not fetched again. */
  private onPad(k: number, it: ItemBox): boolean {
    const d = this.dock(k);
    return !!d && hdist(it.cx, it.cz, d.p[0], d.p[2]) <= BUZZ_BEACON.padRadius + 0.05 && it.bot >= d.p[1] - 0.03 && it.bot <= d.p[1] + 0.15;
  }

  /** The nearest tagged item it can fetch within its scan range (ties: part order). */
  private nearest(k: number): number {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    if (!this.tagged.length) return -1;
    const lines = s.h.lines();
    const me = s.comOf(cr.base);
    let best = -1, bestD = cr.spec.vision;
    for (const part of this.tagged) {
      if (part === c.ignore || !this.fetchable(part, lines)) continue;
      const it = this.box(part);
      if (this.onPad(k, it)) continue;
      const d = vlen(vsub([it.cx, (it.top + it.bot) / 2, it.cz], me));
      if (d < bestD) { bestD = d; best = part; }
    }
    return best;
  }

  /** Carried item's geometry from its def (it hangs upright, yawed with BUZZ): top and bottom offsets from its origin. */
  private hang(part: number): { top: number; bot: number; hx: number; hz: number } {
    const b = this.s.h.parts[part]!.def.bounds;
    return { top: b.max[1], bot: b.min[1], hx: (b.max[0] - b.min[0]) / 2, hz: (b.max[2] - b.min[2]) / 2 };
  }

  /** Where the carried item's origin is: its top at the claw. */
  private itemAt(k: number): { p: Vec; yaw: number } {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!, x = this.x(k);
    const yaw = yawOf(s.rotOf(cr.base));
    const claw = vadd(s.posOf(cr.base), qrot(yawQ(yaw), Z.winchAt));
    return { p: [claw[0], claw[1] - x.win - this.hang(c.carry).top, claw[2]], yaw };
  }

  /** Carry follow (postContacts, after the step): the ghost item hangs under the claw. */
  carryFollow(k: number): void {
    const s = this.s, c = this.w.c[k]!;
    if (!s.st.alive[c.carry]) { c.carry = -1; return; }
    const a = this.itemAt(k);
    s.h.bi.SetPositionRotationAndVelocity(s.id(s.h.parts[c.carry]!.base), s.rvec(a.p), s.quat(yawQ(a.yaw)), s.vec(0, 0, 0), s.vec2(0, 0, 0));
  }

  // ---- hooks -------------------------------------------------------------------------------------------------

  /** Gravity factor of a free BUZZ's body: 0 while the rotors hold it up, 1 landed (rule 14: a pure function of state). */
  applyGravity(k: number): void {
    const s = this.s, c = this.w.c[k]!;
    if (s.baseMode(c) !== 'free') return;
    s.h.bi.SetGravityFactor(s.id(s.crits[k]!.base), f32(this.flying(k) ? 0 : 1));
  }

  /** Rotors holding it up: a flying state, or a startle that interrupted one (PARTSIM). */
  private flying(k: number): boolean {
    const c = this.w.c[k]!;
    return FLYING.has(c.fsm) || (c.fsm === F.startled && FLYING.has(this.x(k).pre));
  }

  /** PARTSIM (D121): the carried load as a fraction of its 2 kg payload (0 empty). */
  private loadFrac(k: number): number {
    const c = this.w.c[k]!;
    return c.carry >= 0 ? clamp(this.kgOf(c.carry) / Z.payload, 0, 1) : 0;
  }

  /** After a checkpoint restore: the flight gravity (the carried item's ghosting is the shared carry code's). */
  afterRestore(): void { for (const k of this.bots) this.applyGravity(k); }

  /** It just went into its rigid tumble (the shared ragdoll already dropped any item): the winch stops, a flip spin. */
  onRagdoll(k: number, dv: readonly number[]): void {
    const s = this.s, x = this.x(k), cr = s.crits[k]!;
    x.ph = 0; x.climb = 0; x.side = 0;
    const l = Math.max(1e-6, Math.sqrt(dv[0]! * dv[0]! + dv[2]! * dv[2]!));
    const m = Math.min(2, l);
    s.h.bi.SetAngularVelocity(s.id(cr.rags[0]!), s.vec((dv[2]! / l) * m * 3, 2, (-dv[0]! / l) * m * 3));
  }

  /** The items BUZZes are after (flying to one, or winching it up): pairs [BUZZ part, item part], part order. */
  targets(): Int32Array {
    const out: number[] = [];
    for (const k of this.bots) {
      const c = this.w.c[k]!;
      if (c.target >= 0 && (c.fsm === F.fly || c.fsm === F.grab)) out.push(this.s.crits[k]!.part, c.target);
    }
    return Int32Array.from(out);
  }

  /** Extra hash input: the snapshot's tagged parts (a run input; none = no change). */
  hash(h: Hasher): void {
    if (!this.tagged.length) return;
    h.u32(this.tagged.length);
    for (const t of this.tagged) h.u32(t);
  }

  // ---- think (every 4 ticks) ---------------------------------------------------------------------------------

  think(k: number, heard = 0, cause = -1, from: readonly number[] = [0, 0, 0]): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    if (c.trap >= 0) return;
    // PARTSIM (D121): a big boom or a very loud sound nearby startles it (touches still don't: it's a robot on a job)
    if (heard >= Z.startleDb && STARTLES.has(c.fsm)) { this.startle(k, cause, from); return; }
    // a pending call starts a job whenever BUZZ is free to take it
    if (!x.job && this.pending(k) && (s.is(c, 'docked', 'landed', 'idle', 'takeoff', 'land') || (c.fsm === F.fly && c.target < 0))) { this.startJob(k); return; }
    switch (c.fsm) {
      case F.landed:
        // paired but away from its pad: hop home once the pad is clear
        if (!x.job && this.pair[k]! >= 0 && c.t >= s.ticks(Z.homeDelay) && !this.atDock(k) && this.padClear(k)) this.takeoff(k);
        return;
      case F.fly: case F.carry: this.thinkLeg(k); return;
      case F.grab:
        if (c.target >= 0 && !this.fetchable(c.target, s.h.lines())) this.lostTarget(k);
        return;
      case F.land:
        if (x.dock && !this.padClear(k)) this.beginLand(k, false); // something landed on the pad first
        return;
      default:
    }
  }

  /** Every think on a leg (to an item, or home with or without one): cruise height, obstacles, progress, the target. */
  private thinkLeg(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const p = s.posOf(cr.base), v = s.velOf(cr.base);
    if (c.fsm === F.fly && c.target >= 0) {
      if (!this.fetchable(c.target, s.h.lines())) { this.lostTarget(k); return; }
    }
    const goal = this.legGoal(k);
    if (!goal) { this.beginLand(k, false); return; }
    const hd = hdist(goal[0], goal[2], p[0], p[2]);
    // the item must be reachable from above: the first thing straight down from BUZZ near it must be the item itself
    if (c.fsm === F.fly && c.target >= 0 && hd < 0.35) {
      const it = this.box(c.target);
      const hit = s.castHit([p[0], p[1], p[2]], [it.cx, it.top - 0.02, it.cz], cr.ignoreSelf);
      const hb = hit.body >= 0 ? s.h.bodies[hit.body] : undefined;
      if (hit.f < 1 && hb && hb.part !== c.target && (s.critOfPart[hb.part] ?? -1) < 0) { c.ignore = c.target; c.ignoreT = s.ticks(20); this.lostTarget(k); return; }
    }
    // cruise: over whatever is below, a carried item clear of it, under any roof, never above the ceiling height
    const hang = c.carry >= 0 ? x.win - WINCH_Y + (this.hang(c.carry).top - this.hang(c.carry).bot) + Z.clear : 0;
    const gf = s.cast([p[0], p[1] + 0.02, p[2]], [p[0], p[1] - 5, p[2]], false, cr.ignoreSelf);
    const ground = gf < 1 ? p[1] + 0.02 - 5.02 * gf : p[1] - Z.cruise;
    // obstacles ahead (3 parallel rays at the duct tips and the middle, plus one through a carried item)
    if (hd > 0.3) {
      const dir: Vec = [(goal[0] - p[0]) / hd, 0, (goal[2] - p[2]) / hd];
      const len = Math.min(0.35 + 0.8 * Math.sqrt(v[0] * v[0] + v[2] * v[2]), hd);
      const bl = this.blocked(k, p, dir, len);
      if (bl.any) {
        x.climb = Math.min(Z.ceiling, x.climb + 0.25);
        if (x.climb >= 1 || bl.roof) x.side = bl.left && !bl.right ? -1 : bl.right && !bl.left ? 1 : x.side || (s.rand(c) < 0.5 ? -1 : 1);
      } else {
        x.climb = Math.max(0, x.climb - 0.05);
        if (x.climb === 0) x.side = 0;
      }
      // stuck: asked to move but barely moving → climb more and swap sides
      const hs = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
      x.slow = hs < 0.12 ? x.slow + 4 : Math.max(0, x.slow - 8);
      if (x.slow > s.ticks(1)) { x.slow = 0; x.climb = Math.min(Z.ceiling, x.climb + 0.4); x.side = x.side ? -x.side : (s.rand(c) < 0.5 ? -1 : 1); }
    }
    let cy = ground + Z.cruise + hang + x.climb;
    const rf = s.cast([p[0], p[1] + 0.09, p[2]], [p[0], p[1] + 4, p[2]], false, cr.ignoreSelf);
    if (rf < 1) cy = Math.min(cy, p[1] + 0.09 + 3.91 * rf - 0.25);
    x.cy = Math.min(cy, ground + Z.ceiling + hang);
    // a leg that takes too long: give the item up (or put the load down here) and go home
    if (x.leg > s.ticks(Z.legTime)) {
      if (c.fsm === F.fly && c.target >= 0) { c.ignore = c.target; c.ignoreT = s.ticks(20); this.lostTarget(k); }
      else if (c.carry >= 0) { this.putDown(k); x.job = 0; x.leg = 0; c.target = -1; s.setFsm(k, 'fly', -1); s.setEmote(k, '?', 1.5); }
      else this.beginLand(k, false);
    }
  }

  /** Forward rays along `dir` from the ducts and body (and through a hanging item); `roof`: no room to climb. */
  private blocked(k: number, p: Vec, dir: Vec, len: number): { any: boolean; left: boolean; right: boolean; roof: boolean } {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!, x = this.x(k);
    const perp: Vec = [dir[2], 0, -dir[0]]; // to the left of travel
    const ys = [p[1] + 0.055];
    if (c.carry >= 0) { const hg = this.hang(c.carry); ys.push(p[1] + WINCH_Y - x.win - (hg.top - hg.bot) / 2); }
    let left = false, mid = false, right = false;
    for (const y of ys) {
      for (const side of [1, 0, -1] as const) {
        const o: Vec = [p[0] + perp[0] * 0.17 * side, y, p[2] + perp[2] * 0.17 * side];
        if (s.cast(o, [o[0] + dir[0] * len, y, o[2] + dir[2] * len], false, cr.ignoreSelf) < 1) {
          if (side === 1) left = true; else if (side === 0) mid = true; else right = true;
        }
      }
    }
    const roof = s.cast([p[0], p[1] + 0.09, p[2]], [p[0], p[1] + 0.5, p[2]], false, cr.ignoreSelf) < 1;
    return { any: left || mid || right, left, right, roof };
  }

  /** The leg's horizontal goal: the target item, or the dock (null: no dock to go to). */
  private legGoal(k: number): Vec | null {
    const c = this.w.c[k]!;
    if (c.fsm === F.fly && c.target >= 0) { const it = this.box(c.target); return [it.cx, it.top, it.cz]; }
    const d = this.dock(k);
    return d ? d.p : null;
  }

  // ---- state changes -----------------------------------------------------------------------------------------

  private startJob(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const v = this.beaconHost()?.beacon(this.pair[k]!);
    x.served++;
    x.job = 1;
    x.t0 = s.st.tick;
    s.setEmote(k, '!', 1);
    const cause = v?.callCause ?? -1;
    if (s.is(c, 'docked', 'landed', 'idle')) this.takeoff(k, cause);
    else this.sniff(k, cause);
  }

  private takeoff(k: number, cause = -1): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const p = s.posOf(s.crits[k]!.base);
    c.gx = p[0]; c.gy = p[1] + Z.takeoff; c.gz = p[2];
    x.leg = 0; x.climb = 0; x.side = 0; x.dock = 0;
    s.setFsm(k, 'takeoff', 1.5, true, cause);
    this.applyGravity(k);
  }

  private sniff(k: number, cause = -1): void {
    const s = this.s, c = this.w.c[k]!;
    const p = s.posOf(s.crits[k]!.base);
    c.gx = p[0]; c.gy = p[1]; c.gz = p[2];
    c.target = -1;
    s.setFsm(k, 'sniff', Z.sniff, true, cause);
    this.applyGravity(k);
  }

  /** End of the scan: the nearest tagged item, or "?" and land (at home if it's away). */
  private pick(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const t = this.nearest(k);
    x.leg = 0; x.climb = 0; x.side = 0; x.slow = 0;
    if (t >= 0) { c.target = t; s.setEmote(k, 'package', 1.5); s.setFsm(k, 'fly', -1); return; }
    s.setEmote(k, '?', 1.5);
    x.job = 0;
    c.target = -1;
    this.goHome(k);
  }

  /** Home: fly to the dock (land there or beside it), or land where it is with no beacon. */
  private goHome(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const d = this.dock(k);
    const p = s.posOf(s.crits[k]!.base);
    c.target = -1; x.leg = 0;
    if (!d) { this.beginLand(k, false); return; }
    if (hdist(p[0], p[2], d.p[0], d.p[2]) < 0.1) { this.beginLand(k, this.padClear(k)); return; }
    s.setFsm(k, 'fly', -1);
  }

  private lostTarget(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    c.target = -1; x.ph = 0;
    if (x.job) this.sniff(k); else this.goHome(k);
    void s;
  }

  /** Starts a landing: on the dock (`dock`), or on clear floor beside the beacon (or straight down with no beacon). */
  private beginLand(k: number, dock: boolean): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const d = this.dock(k);
    const p = s.posOf(cr.base);
    let spot: Vec | null = null;
    if (dock && d) spot = d.p;
    else if (d) spot = this.beside(k, d);
    if (!spot) {
      const f = s.cast([p[0], p[1] + 0.02, p[2]], [p[0], p[1] - 5, p[2]], false, cr.ignoreSelf);
      spot = [p[0], f < 1 ? p[1] + 0.02 - 5.02 * f : p[1] - 0.5, p[2]];
    }
    c.gx = spot[0]; c.gy = spot[1]; c.gz = spot[2];
    x.dock = dock && d ? 1 : 0;
    x.ph = 0;
    c.target = -1;
    s.setFsm(k, 'land', Z.landTime);
  }

  /** A clear, level landing spot beside the beacon: its left, right, back, then front, `beside` m out. */
  private beside(k: number, d: { p: Vec; yaw: number }): Vec | null {
    const s = this.s, cr = s.crits[k]!;
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const yaw = d.yaw + a;
      const cx = d.p[0] + dsin(yaw) * Z.beside, cz = d.p[2] + dcos(yaw) * Z.beside;
      const top = d.p[1] + 1;
      let lo = Infinity, hi = -Infinity;
      for (const [ox, oz] of [[0, 0], [0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]] as const) {
        const f = s.cast([cx + ox, top, cz + oz], [cx + ox, top - 2, cz + oz], false, cr.ignoreSelf);
        const y = f < 1 ? top - 2 * f : -Infinity;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      if (Number.isFinite(lo) && hi - lo < 0.03 && hi < d.p[1] + 0.3) return [cx, hi, cz];
    }
    return null;
  }

  /** Back on the ground: rotors off, gravity on, docked on its pad or landed. */
  private touchdown(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const id = s.id(cr.base);
    const v = s.velOf(cr.base);
    s.h.bi.SetLinearVelocity(id, s.vec(0, Math.min(0, v[1]), 0));
    s.h.bi.SetAngularVelocity(id, s.vec(0, 0, 0));
    const docked = x.dock === 1 && this.atDock(k);
    x.ph = 0; x.climb = 0; x.side = 0;
    s.setFsm(k, docked ? 'docked' : 'landed', -1);
    if (docked) s.setEmote(k, 'zzz', 2);
    this.applyGravity(k);
    void c;
  }

  /** After a tumble (or a TRAP BOX letting go): finish the job, or go home, or stay put with no beacon. */
  private resume(k: number): void {
    const s = this.s, x = this.x(k);
    if (x.job || (this.pair[k]! >= 0 && this.dock(k) && !this.atDock(k))) { this.takeoff(k); s.setEmote(k, '!', 1); return; }
    s.setFsm(k, this.atDock(k) ? 'docked' : 'landed', -1);
  }

  /** The claw closes on the item: it becomes a ghost under the claw (Bandit's carry; rollback re-derives it). */
  private clawGrab(k: number, it: ItemBox): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const part = c.target;
    c.carry = part;
    c.target = -1;
    s.ghostItem(part, true);
    // it hangs upright, yawed with BUZZ, its bottom where it was (so a tipped item doesn't drop through the floor)
    const hg = this.hang(part);
    const clawY = it.bot - hg.bot + hg.top;
    const p = s.posOf(cr.base);
    c.gx = p[0]; c.gz = p[2]; // it holds here while it reels in
    x.win = clamp(p[1] + WINCH_Y - clawY, Z.carryWinch, Z.winch);
    this.carryFollow(k);
    const at = vadd(p, [0, WINCH_Y - x.win, 0]);
    s.h.emit('Fetch', cr.part, at, this.kgOf(part), part, s.h.cause(part));
    s.setEmote(k, 'pin', 1.5);
    x.ph = 1;
  }

  /**
   * PARTSIM (D121): the surface height a hanging item has sunk into by more than 3 cm (one ray from the claw down through
   * the item's height, BUZZ and ghosts ignored), or null. 3 cm of slack: a grabbed item hangs with its bottom where it lay.
   */
  private sunk(k: number): number | null {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!, x = this.x(k);
    const a = this.itemAt(k), hg = this.hang(c.carry);
    const clawY = a.p[1] + hg.top + x.win, bot = a.p[1] + hg.bot;
    if (clawY - bot < 1e-3) return null;
    const f = s.cast([a.p[0], clawY, a.p[2]], [a.p[0], bot, a.p[2]], false, cr.ignoreSelf);
    if (f >= 1) return null;
    const surface = clawY - (clawY - bot) * f;
    return surface > bot + 0.03 ? surface : null;
  }

  /** PARTSIM (D121): lets go of the item, setting it upright on the surface at height `y` under where it hangs. */
  private setDownOn(k: number, y: number): void {
    const s = this.s, c = this.w.c[k]!;
    const part = c.carry;
    const a = this.itemAt(k);
    c.carry = -1;
    if (!s.st.alive[part]) return;
    s.ghostItem(part, false);
    const id = s.id(s.h.parts[part]!.base);
    s.h.bi.SetPositionRotationAndVelocity(id, s.rvec([a.p[0], y - this.hang(part).bot + 0.002, a.p[2]]), s.quat(yawQ(a.yaw)), s.vec(0, 0, 0), s.vec2(0, 0, 0));
    s.h.bi.ActivateBody(id);
    c.ignore = part; c.ignoreT = s.ticks(2);
  }

  /** Lets go of the item where it hangs (a delivery, or a load put down on a leg that took too long). */
  private putDown(k: number): number {
    const s = this.s, c = this.w.c[k]!;
    const part = c.carry;
    if (part < 0) return -1;
    const a = this.itemAt(k);
    c.carry = -1;
    if (!s.st.alive[part]) return -1;
    s.ghostItem(part, false);
    const id = s.id(s.h.parts[part]!.base);
    s.h.bi.SetPositionRotationAndVelocity(id, s.rvec(a.p), s.quat(yawQ(a.yaw)), s.vec(0, 0, 0), s.vec2(0, 0, 0));
    s.h.bi.ActivateBody(id);
    c.ignore = part; c.ignoreT = s.ticks(2);
    return part;
  }

  private deliver(k: number): void {
    const s = this.s, x = this.x(k), cr = s.crits[k]!;
    const a = this.itemAt(k);
    const part = this.putDown(k);
    if (part < 0) return;
    const secs = (s.st.tick - x.t0) / s.h.tickRate;
    s.h.emit('Deliver', cr.part, vadd(a.p, [0, this.hang(part).top, 0]), secs, part, s.h.cause(cr.part));
    s.setEmote(k, secs <= Z.onTime ? 'clock' : 'check', 2);
    x.job = 0;
  }

  /** Distance from the hanging item's bottom down to whatever is under it (rays over its footprint), ∞ if nothing. */
  private gapBelow(k: number): number {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const a = this.itemAt(k);
    const hg = this.hang(c.carry);
    const y0 = a.p[1] + hg.bot + 0.002;
    const q = yawQ(a.yaw);
    let gap = Infinity;
    for (const [ox, oz] of [[0, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) {
      const o = qrot(q, [ox * hg.hx, 0, oz * hg.hz]);
      const f = s.cast([a.p[0] + o[0], y0, a.p[2] + o[2]], [a.p[0] + o[0], y0 - 0.3, a.p[2] + o[2]], false, cr.ignoreSelf);
      if (f < 1) gap = Math.min(gap, 0.3 * f - 0.002);
    }
    return gap;
  }

  // ---- act (every tick) ----------------------------------------------------------------------------------------

  act(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const dt = this.dt();
    x.leg++;
    if (x.pre >= 0 && c.fsm !== F.startled) x.pre = -1; // PARTSIM: a startle cut short (a tumble, a TRAP BOX) resumes nothing
    if (s.timeUp(c)) {
      switch (c.fsm) {
        case F.takeoff: this.afterTakeoff(k); break;
        case F.sniff: this.pick(k); break;
        case F.deliver_bow: this.beginLand(k, this.padClear(k)); break;
        case F.land: this.touchdown(k); break; // landing timeout: rotors off where it is
        case F.getup: s.setFsm(k, 'dizzy', 1.5); s.setEmote(k, 'stars', 1.5); break;
        case F.dizzy: case F.idle: case F.indignant: this.resume(k); break;
        case F.startled: this.endStartle(k); break; // PARTSIM (D121)
        default:
      }
    }
    this.applyGravity(k);
    const p = s.posOf(cr.base);
    switch (c.fsm) {
      case F.takeoff:
        this.pd(k, c.gx, c.gy, c.gz, 0.3, -1);
        if (Math.abs(p[1] - c.gy) < 0.03 && c.t > 2) this.afterTakeoff(k);
        break;
      case F.sniff: {
        // hover in place, sweeping ±25° (critters.md sniff)
        this.pd(k, c.gx, c.gy, c.gz, 0.3, -1, false);
        s.h.bi.SetAngularVelocity(s.id(cr.base), s.vec(0, 0.9 * dcos((c.t / s.h.tickRate) * 4.2), 0));
        break;
      }
      case F.fly: this.actFly(k, p); break;
      case F.grab: this.actGrab(k, p, dt); break;
      case F.carry: this.actCarry(k, p); break;
      case F.drop_off: this.actDrop(k, dt); break;
      case F.deliver_bow: { const d = this.dock(k); this.pd(k, d ? d.p[0] : c.gx, c.gy, d ? d.p[2] : c.gz, 0.3, -1); break; }
      case F.land: this.actLand(k, p); break;
      case F.startled:
        if (FLYING.has(x.pre)) {
          // PARTSIM (D121): a bob up and a wobble, the load still on the winch
          this.pd(k, c.gx, c.gy, c.gz, 0.6, -1, false);
          s.h.bi.SetAngularVelocity(s.id(cr.base), s.vec(0, 2.5 * dsin((c.t / s.h.tickRate) * 25), 0));
          break;
        }
        s.brake(k, 4); // the blip off the ground: it falls back onto its skids
        s.h.bi.SetAngularVelocity(s.id(cr.base), s.vec(0, 0, 0));
        break;
      default:
        // on the ground (docked, landed, getup, dizzy, idle, trapped): no friction of its own, so brake; hold its heading
        s.brake(k, 4);
        if (c.fsm !== F.getup) s.h.bi.SetAngularVelocity(s.id(cr.base), s.vec(0, 0, 0));
    }
    // PARTSIM (D121): pushed down with a load (a HENNY landing on its back) until the hanging item would sink into what's
    // under it: it sets the item down on that surface and looks again (the ghost carry never goes through the floor)
    if (c.carry >= 0 && c.fsm !== F.drop_off && c.fsm !== F.startled) {
      const at = this.sunk(k);
      if (at !== null) { this.setDownOn(k, at); if (x.job) this.sniff(k); else this.goHome(k); }
    }
    // the winch reels in whenever it isn't paying out (to the carry length with a load)
    if (c.fsm !== F.grab && c.fsm !== F.drop_off) {
      const want = c.carry >= 0 ? Z.carryWinch : 0;
      x.win = x.win > want ? Math.max(want, x.win - Z.winchIn * dt) : want > x.win ? Math.min(want, x.win + Z.winchIn * dt) : x.win;
    }
    // A5's beacon LED: docked or away
    const b = this.pair[k]!;
    if (b >= 0) this.beaconHost()?.setBeaconStatus(b, c.fsm === F.docked ? DOCKED : AWAY);
  }

  /**
   * PARTSIM (D121): startled for `Z.startle` s. In the air it bobs `Z.hop` m up and wobbles (the load stays on the winch);
   * on the ground its rotors blip it off the floor. It remembers the state it was in and carries on from there (`endStartle`).
   */
  private startle(k: number, cause: number, from: readonly number[]): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const p = s.posOf(cr.base);
    x.pre = c.fsm;
    const air = FLYING.has(c.fsm);
    // bob away from the noise a little (horizontal), and up
    const dx = p[0] - from[0]!, dz = p[2] - from[2]!, d = Math.sqrt(dx * dx + dz * dz);
    const ox = d > 1e-6 ? (dx / d) * 0.08 : 0, oz = d > 1e-6 ? (dz / d) * 0.08 : 0;
    c.gx = p[0] + ox; c.gy = p[1] + (air ? Z.hop : 0); c.gz = p[2] + oz;
    s.setFsm(k, 'startled', Z.startle, true, cause);
    s.setEmote(k, '!', 1.2);
    if (!air) {
      const id = s.id(cr.base);
      s.h.bi.SetLinearVelocity(id, s.vec(0, 0.9, 0));
      s.h.bi.ActivateBody(id);
    }
    this.applyGravity(k);
  }

  /** PARTSIM (D121): the startle is over: back to what it was doing (a timed state starts again from where it is). */
  private endStartle(k: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const pre = x.pre;
    x.pre = -1;
    switch (pre) {
      case F.takeoff: this.afterTakeoff(k); break;
      case F.sniff: this.sniff(k); break;
      case F.deliver_bow: this.beginLand(k, this.padClear(k)); break;
      case F.land: this.beginLand(k, x.dock === 1 && this.padClear(k)); break;
      case F.fly: case F.grab: case F.carry: case F.drop_off: {
        if (pre !== F.fly) {
          // back down from the bob: the grab / drop-off hover (and the reel-in hold point) is where it was before it
          const p = s.posOf(s.crits[k]!.base);
          c.gx = p[0]; c.gz = p[2]; c.gy = p[1] - Z.hop;
        }
        s.setFsm(k, CRITTER_FSM[pre]!, -1);
        break;
      }
      default: s.setFsm(k, pre === F.docked ? 'docked' : pre === F.idle ? 'idle' : 'landed', pre === F.idle ? 1 : -1);
    }
    this.applyGravity(k);
  }

  private afterTakeoff(k: number): void {
    const x = this.x(k);
    if (x.job) this.sniff(k);
    else this.goHome(k);
  }

  /**
   * The flight controller (D105): a PD on position — a = kp·(goal − p) + kd·(v_goal − v), the horizontal part capped at the
   * species' accel, then the speed capped at `vmax` (vertical at `climb`). `face`: yaw to turn to (−1 = travel, or hold).
   */
  private pd(k: number, gx: number, gy: number, gz: number, vmax: number, face: number, turn = true, down: number = Z.climb, fvx = 0, fvz = 0): void {
    const s = this.s, cr = s.crits[k]!;
    const id = s.id(cr.base);
    const p = s.posOf(cr.base), v = s.velOf(cr.base);
    const dt = this.dt();
    // (fvx, fvz): the goal's own velocity (a rolling item), so it keeps station over it without lagging behind
    let ax = Z.kp * (gx - p[0]) + Z.kd * (fvx - v[0]);
    let az = Z.kp * (gz - p[2]) + Z.kd * (fvz - v[2]);
    const ah = Math.sqrt(ax * ax + az * az), amax = cr.spec.accel;
    if (ah > amax) { ax *= amax / ah; az *= amax / ah; }
    // PARTSIM (D121): a carried load weighs on the rotors: a steady sag of `sagM` × the payload fraction under the goal
    // (the PD's own offset against the extra weight) and a climb `climbLoad` × that fraction slower
    const lf = this.loadFrac(k);
    const ay = clamp(Z.kp * (gy - p[1]) - Z.kd * v[1] - Z.kp * Z.sagM * lf, -4, 4 * (1 - Z.climbLoad * lf));
    let nx = v[0] + ax * dt, nz = v[2] + az * dt;
    const hs = Math.sqrt(nx * nx + nz * nz);
    if (hs > vmax) { nx *= vmax / hs; nz *= vmax / hs; }
    const ny = clamp(v[1] + ay * dt, -down, Z.climb * (1 - Z.climbLoad * lf));
    s.h.bi.SetLinearVelocity(id, s.vec(nx, ny, nz));
    s.h.bi.ActivateBody(id);
    if (!turn) return;
    const yaw = yawOf(s.rotOf(cr.base));
    const want = face >= 0 ? face : hs > 0.15 ? datan2(nx, nz) : yaw;
    s.h.bi.SetAngularVelocity(id, s.vec(0, clamp(wrapPi(want - yaw) * 6, -cr.spec.turn, cr.spec.turn), 0));
  }

  /** Aim point on a leg: straight at the goal, or side-stepping (±0.9 rad) round an obstacle while far from it. */
  private aim(k: number, p: Vec, gx: number, gz: number, hd: number): [number, number] {
    const x = this.x(k);
    if (x.side === 0 || hd < 0.6) return [gx, gz];
    const a = datan2(gx - p[0], gz - p[2]) + x.side * 0.9;
    return [p[0] + dsin(a), p[2] + dcos(a)];
  }

  private actFly(k: number, p: Vec): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    const v = s.velOf(cr.base);
    if (c.target >= 0) {
      if (!s.st.alive[c.target]) { this.lostTarget(k); return; }
      const it = this.box(c.target);
      const iv = s.velOf(s.h.parts[c.target]!.base);
      const hoverY = it.top + Z.hover - WINCH_Y;
      const hd = hdist(it.cx, it.cz, p[0], p[2]);
      const near = hd < 0.5;
      const [ax, az] = this.aim(k, p, it.cx, it.cz, hd);
      this.pd(k, ax, near ? hoverY : Math.max(x.cy, hoverY), az, hd > 2 ? cr.spec.run : cr.spec.walk, -1, true, Z.climb, near ? iv[0] : 0, near ? iv[2] : 0);
      const rx = v[0] - iv[0], rz = v[2] - iv[2];
      const rel = Math.sqrt(rx * rx + v[1] * v[1] + rz * rz);
      if (hd < 0.06 && Math.abs(p[1] - hoverY) < 0.04 && rel < 0.2) { c.gy = hoverY; x.ph = 0; s.setFsm(k, 'grab', -1); }
      return;
    }
    // homeward
    const d = this.dock(k);
    if (!d) { this.beginLand(k, false); return; }
    const hd = hdist(d.p[0], d.p[2], p[0], p[2]);
    const [ax, az] = this.aim(k, p, d.p[0], d.p[2], hd);
    this.pd(k, ax, Math.max(x.cy, d.p[1] + Z.takeoff), az, hd > 2 ? cr.spec.run : cr.spec.walk, -1);
    if (hd < 0.08) this.beginLand(k, this.padClear(k));
  }

  private actGrab(k: number, p: Vec, dt: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    if (x.ph === 0) {
      if (c.target < 0 || !s.st.alive[c.target]) { this.lostTarget(k); return; }
      const it = this.box(c.target);
      const iv = s.velOf(s.h.parts[c.target]!.base);
      this.pd(k, it.cx, c.gy, it.cz, 0.6, -1, false, Z.climb, iv[0], iv[2]);
      const hd = hdist(it.cx, it.cz, p[0], p[2]);
      if (hd > 0.12) { x.ph = 0; s.setFsm(k, 'fly', -1); return; } // it moved off: follow it (the winch reels in)
      x.win = Math.min(Z.winch, x.win + Z.winchOut * dt);
      const claw = p[1] + WINCH_Y - x.win;
      if (claw <= it.top + 0.004 && hd <= Math.max(it.hx, it.hz) + 0.03) { this.clawGrab(k, it); return; }
      if (x.win >= Z.winch) {
        // out of reach (it sank below the winch): give it up for a while and look again
        c.ignore = c.target; c.ignoreT = s.ticks(20);
        this.lostTarget(k);
      }
      return;
    }
    // reeling in with the load (slower when heavy)
    this.pd(k, c.gx, c.gy, c.gz, 0.3, -1, false);
    if (c.carry < 0) { x.ph = 0; this.lostTarget(k); return; }
    const kg = this.kgOf(c.carry);
    x.win = Math.max(Z.carryWinch, x.win - Z.winchIn * (1 - 0.5 * clamp(kg / Z.payload, 0, 1)) * dt);
    if (x.win <= Z.carryWinch + 1e-9) { x.ph = 0; x.leg = 0; x.climb = 0; x.side = 0; x.slow = 0; s.setFsm(k, 'carry', -1); }
  }

  private actCarry(k: number, p: Vec): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k), cr = s.crits[k]!;
    if (c.carry < 0) { this.goHome(k); return; } // dropped (a TRAP BOX, a tumble): the shared code let go
    const d = this.dock(k);
    if (!d) { this.putDown(k); x.job = 0; this.beginLand(k, false); return; }
    const hg = this.hang(c.carry);
    const dropY = d.p[1] + 0.1 + (hg.top - hg.bot) + x.win - WINCH_Y;
    const hd = hdist(d.p[0], d.p[2], p[0], p[2]);
    const v = s.velOf(cr.base);
    const sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const load = 1 - Z.sag * clamp(this.kgOf(c.carry) / Z.payload, 0, 1); // loaded hover sags with mass
    const [ax, az] = this.aim(k, p, d.p[0], d.p[2], hd);
    this.pd(k, ax, hd < 0.5 ? dropY : Math.max(x.cy, dropY), az, (hd > 2 ? cr.spec.run : cr.spec.walk) * load, -1);
    const sag = Z.sagM * this.loadFrac(k); // PARTSIM: it hovers that much under the goal while loaded
    if (hd < 0.04 && Math.abs(p[1] + sag - dropY) < 0.04 && sp < 0.2) { c.gx = d.p[0]; c.gy = dropY; c.gz = d.p[2]; x.ph = 0; s.setFsm(k, 'drop_off', -1); }
  }

  private actDrop(k: number, dt: number): void {
    const s = this.s, c = this.w.c[k]!, x = this.x(k);
    const d = this.dock(k);
    this.pd(k, d ? d.p[0] : c.gx, c.gy, d ? d.p[2] : c.gz, 0.3, -1, false);
    if (x.ph === 0) {
      if (c.carry < 0) { x.ph = 1; return; }
      // lower it until it touches the pad (or whatever is on it), then let go
      x.win = Math.min(Z.winch, x.win + 0.3 * dt);
      if (this.gapBelow(k) <= 0.006 || x.win >= Z.winch) { this.deliver(k); x.ph = 1; }
      return;
    }
    x.win = Math.max(0, x.win - Z.winchIn * dt);
    if (x.win <= 0) { x.ph = 0; s.setFsm(k, 'deliver_bow', Z.bow); }
  }

  private actLand(k: number, p: Vec): void {
    const s = this.s, c = this.w.c[k]!, cr = s.crits[k]!;
    const hd = hdist(c.gx, c.gz, p[0], p[2]);
    // over the spot first, then straight down (slowly near the end)
    const gy = hd > 0.06 ? Math.max(p[1], c.gy + 0.15) : c.gy;
    this.pd(k, c.gx, gy, c.gz, cr.spec.walk * 0.6, -1, true, Math.min(Z.land, Math.max(0.08, (p[1] - c.gy) * 3)));
    const v = s.velOf(cr.base);
    const touching = s.cast([p[0], p[1] + 0.02, p[2]], [p[0], p[1] - 0.012, p[2]], false, cr.ignoreSelf) < 1;
    if (hd < 0.08 && c.t > 4 && (p[1] - c.gy < 0.006 || (touching && v[1] > -0.06))) this.touchdown(k);
  }

  // ---- finish: clips and flags -----------------------------------------------------------------------------------

  clip(k: number): CritterClip | null {
    const s = this.s, c = this.w.c[k]!;
    switch (c.fsm) {
      case F.docked: case F.landed: return 'sleep';
      case F.takeoff: return 'takeoff';
      case F.sniff: return 'sniff';
      case F.fly: { const v = s.velOf(s.crits[k]!.base); return v[0] * v[0] + v[2] * v[2] > 1 ? 'run' : 'walk'; }
      case F.grab: return 'grab';
      case F.carry: return 'carry';
      case F.drop_off: return 'drop_off';
      case F.deliver_bow: return 'deliver_bow';
      case F.land: return 'land';
      case F.idle: return 'idle';
      default: return null;
    }
  }

  /** critterState byte 1 extras: the rotors bit and the winch (sevenths of 0.60 m in bits 5–7). */
  flags(k: number): number {
    const c = this.w.c[k]!, x = this.x(k);
    const rotors = FLYING.has(c.fsm) || c.fsm === F.trapped || c.fsm === F.startled; // PARTSIM: a startle blips them
    return (rotors ? BUZZ_ROTORS : 0) | (Math.round(clamp(x.win / Z.winch, 0, 1) * 7) << CRITTER_WINCH_SHIFT);
  }

  asleep(c: CritSt): boolean { return c.fsm === F.docked; }
}
