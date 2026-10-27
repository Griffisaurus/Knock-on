// M2 exit soak, critters (PRODUCTION §2 M2: "critters stay stable through 30-minute soak runs"); M4 (stream B4)
// adds BISCUIT, HENNY and DUSTY to every scenario; M5 (stream B5) adds BUZZ on its BUZZ BEACON, RINGERs calling it,
// tagged items to fetch (and a tagged THUD too heavy to lift), sometimes a wall in the way or a pair of RIFT GATES.
//
// Headless: builds machines with all seven critters (MOCHI, PIP in a HAMSTER DRIVE, GOBY in a FISHBOWL,
// BANDIT by a PEDAL RIG, plus a free PIP; BISCUIT, HENNY with a random egg count, sometimes on a high LEDGE or
// under the TRAP BOX; DUSTY in a random zone with grain patches, sometimes on a charge leash to a MAINS a RINGER
// switches), lures (critters lure critters), sounds and explosions
// (BANGSTICKs on timers, THE BUTTON drops), devices (TRAP BOX on a SNIPPER, wheels, rigs) and
// Hand-of-God pokes, all placed from a seeded PRNG. Each machine runs RUN seconds three times:
//   A  straight through,
//   B  straight through again (identical hash sequence required),
//   C  with one poke delivered late, so the machine rolls back to a checkpoint and re-simulates
//      (its hashes from the rollback point on must match A's).
// Every tick of A checks: finite positions for every body, nothing below the floor or outside the
// world, every Ragdoll answered by a Getup within 9 s, no critter left tumbling. Repeats with new seeds
// until the time budget runs out, then prints a summary and exits non-zero on any failure.
//
//   pnpm soak:critters -- --minutes 30
//   node --disable-warning=ExperimentalWarning apps/host/soak/critters.ts --minutes 2 --run 60 --seed 1
//   --matter N   every Nth scenario also runs the Matter layer on MX's CPU backend (sand and marbles emitted into
//                DUSTY's zone: it vacuums real grains through machine.matter)

import { makeId, metresToPos, snappedEuler, type LinkKind, type LinkRecord, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { CRITTER_EMOTES, CRITTER_FSM, partDef, propSteps } from '@knockon/parts-data';
import { Machine, type ExtraLure, type MachineOptions, type Poke, type SimEvent } from '@knockon/sim';
import { MatterCpu } from '../../../packages/matter/src/index.ts';

const args = process.argv.slice(2);
const arg = (name: string, d: number): number => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : d; };
const MINUTES = arg('minutes', 1);
const RUN_SECONDS = arg('run', 60);
const SEED = arg('seed', 1);
const MATTER_EVERY = arg('matter', 0);
const TICKS = RUN_SECONDS * 120;
const HASH_EVERY = 60;
const MAX_RAGDOLL_TICKS = 9 * 120; // 8 s forced recovery + slack
// The machines run in the Room preset: the cyclorama walls stand at x = ±8 m (z −3…13) and z = −7 m
// (x −4…4); the front (+Z) is open and the swept corners don't collide yet (D64). A critter may leave
// through those openings (a blast throws it 8 m/s), but never through a wall, and nothing falls through
// the floor or leaves the 400 m floor.
const FLOOR = 195;
const CRITTER_TYPES = new Set(['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty', /* M5 (B5) */ 'buzz']);
/** M5 (B5): PartFlag.Tagged (format model.ts): BUZZ fetches tagged items. */
const TAGGED = 512, ANCHORED = 32;

/** Small seeded PRNG for scenario placement (mulberry32): the soak itself needn't be detmath. */
class Prng {
  private a: number;
  constructor(seed: number) { this.a = (seed * 2654435761) >>> 0; }
  nextFloat(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextInt(n: number): number { return Math.floor(this.nextFloat() * n); }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.nextFloat(); }
}

// ---- machine builder ------------------------------------------------------------------------------------

class Build {
  readonly parts: PartRecord[] = [];
  readonly links: LinkRecord[] = [];
  private n = 0;
  add(type: string, x: number, y: number, z: number, props: Readonly<Record<string, number>> = {}, yaw = 0, flags = 0): number {
    const def = partDef(type);
    if (!def) throw new Error(`unknown part ${type}`);
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v)).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: snappedEuler(yaw, 0, 0), flags, ...(list.length ? { props: list } : {}) });
    return id;
  }
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number {
    const port = (id: number, name: string): number => partDef(this.parts.find((p) => p.id === id)!.type)!.ports.findIndex((x) => x.name === name);
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: { part: from, port: port(from, fromPort) }, to: { part: to, port: port(to, toPort) }, via: [], points: [], length: 0 });
    return id;
  }
}

interface Scenario {
  readonly world: { parts: PartRecord[]; links: LinkRecord[] }; readonly pokes: Poke[]; readonly critters: number[]; readonly lures: ExtraLure[];
  /** M4: Matter on (every --matter Nth scenario): sand and marbles emitted into Dusty's zone at the start. */
  readonly matter: { readonly anchor: number; readonly at: readonly [number, number, number]; readonly sand: number; readonly marbles: number } | null;
}

/** A random critter playground (all positions on a 6 × 6 m set around the origin). */
function scenario(seed: number): Scenario {
  const r = new Prng(seed + 1);
  const R = (lo: number, hi: number): number => Math.round(r.range(lo, hi) * 100) / 100;
  const b = new Build();
  const critters: number[] = [];
  // the cast
  const tx = R(-1, 1), tz = R(-1, 1);
  critters.push(r.nextFloat() < 0.5 ? b.add('mochi', tx, 0, tz, {}, R(-180, 180)) : b.add('mochi', R(-1.5, 1.5), 0, R(-1.5, 1.5), {}, R(-180, 180)));
  const pipFree = b.add('pip', R(-2, 2), 0, R(-2, 2), {}, R(-180, 180));
  critters.push(pipFree);
  // PIP in a HAMSTER DRIVE banded to a COG
  const dx = R(-2.4, -1.6), dz = R(-2.4, 2.4);
  const drive = b.add('hamster_drive', dx, 0, dz);
  critters.push(b.add('pip', dx, 0.042, dz - 0.005));
  const cog = b.add('cog', dx + 0.4, 0.3, dz);
  b.link('band', drive, 'out', cog, 'axle');
  // GOBY in a FISHBOWL
  const bx = R(1.6, 2.4), bz = R(-2.4, 2.4);
  b.add('fishbowl', bx, 0, bz);
  critters.push(b.add('goby', bx, 0.13, bz));
  // BANDIT near (or on) a PEDAL RIG
  const rx = R(-1, 1), rz = R(2.2, 2.8);
  const rig = b.add('pedal_rig', rx, 0, rz);
  critters.push(r.nextFloat() < 0.5 ? b.add('bandit', rx, 0.18, rz) : b.add('bandit', rx + R(-1.5, 1.5), 0, rz - R(0.8, 1.6), {}, R(-180, 180)));
  const cog2 = b.add('cog', rx - 0.13, 0.32, rz + 0.25);
  b.link('band', rig, 'out', cog2, 'axle');
  // a TRAP BOX on a SNIPPER-cut LINE, somewhere over the set, cut when a THUD drops on THE BUTTON
  const box = b.add('trap_box', tx, 0.6, tz);
  const hook = b.add('anchor', tx, 1.4, tz);
  b.link('line', box, 'hook', hook, 'hook');
  b.add('ledge', tx - 0.12, 1.2, tz);
  const snip = b.add('snipper', tx - 0.08, 1.25, tz);
  const button = b.add('the_button', tx + R(0.9, 1.4), 0, tz + R(-0.5, 0.5));
  const bp = b.parts.at(-1)!.pos;
  b.add('thud', bp[0] / 640, R(0.6, 4), bp[2] / 640); // falls at a random moment-ish (height)
  b.link('cable_signal', button, 'out', snip, 'close');
  // explosions on wick-lit fuses at random times (fuse length sets the delay), plus a few loose rollers
  for (let i = 0; i < 3; i++) {
    const x = R(-3, 3), z = R(-3, 3);
    const stick = b.add('bangstick', x, 0.039, z, { fuse: R(0.5, 5) });
    const wick = b.add('wick', x + R(0.4, 2.5), 0, z + R(-0.3, 0.3));
    b.link('fuse', wick, 'flame', stick, 'fuse');
  }
  for (let i = 0; i < 3; i++) b.add(r.nextFloat() < 0.5 ? 'boing' : 'thud', R(-2.5, 2.5), R(0.3, 3), R(-2.5, 2.5));
  for (let i = 0; i < 6; i++) b.add('topple_tile', R(-2.5, 2.5), 0.075, R(-2.5, 2.5), {}, R(-90, 90));
  b.add('slope', R(-2, 2), 0, R(-2, 2), { angle: 20 }, R(-180, 180));
  // extra lures (MachineOptions.extraLures; no M2 part is a small shiny body, seeds and snacks come later):
  // 1–2 STITCHes made shiny for Bandit, seeds for the free Pip, a snack for Mochi
  const lures: ExtraLure[] = [];
  const nShiny = 1 + r.nextInt(2);
  for (let i = 0; i < nShiny; i++) lures.push({ part: b.add('stitch', R(-2.5, 2.5), 0.04, R(-0.5, 2.5)), radius: 5, species: { bandit: 1 } });
  const pf = b.parts.find((p) => p.id === pipFree)!.pos;
  for (let i = 0; i < 2; i++) lures.push({ pos: [pf[0] / 640 + R(-1.5, 1.5), 0, pf[2] / 640 + R(-1.5, 1.5)], radius: 4, species: { pip: 1 } });
  if (r.nextFloat() < 0.5) lures.push({ pos: [R(-2, 2), 0, R(-2, 2)], radius: 3, species: { mochi: 1 } });
  // ---- M4 (stream B4): BISCUIT, HENNY, DUSTY ----
  // BISCUIT: asleep somewhere on the set, sometimes right by Mochi
  critters.push(r.nextFloat() < 0.4 ? b.add('biscuit', tx + R(-1.2, 1.2), 0, tz + R(1.0, 1.6), {}, R(-180, 180)) : b.add('biscuit', R(-2.5, 2.5), 0, R(-2.5, 2.5), {}, R(-180, 180)));
  // HENNY: 0–6 eggs; a quarter of the time on a high LEDGE (her eggs can splat), sometimes near the cage
  const eggs = r.nextInt(7);
  const hk = r.nextFloat();
  if (hk < 0.25) {
    const lx = R(-2, 2), lz = R(-2, 2), ly = R(0.8, 1.6);
    b.add('ledge', lx, ly, lz);
    critters.push(b.add('henny', lx + R(-0.15, 0.15), ly + 0.05, lz + R(-0.15, 0.15), { eggs }, R(-180, 180)));
  } else if (hk < 0.4) critters.push(b.add('henny', tx + R(-0.2, 0.2), 0, tz + R(-0.1, 0.1), { eggs }, R(-180, 180)));
  else critters.push(b.add('henny', R(-2.5, 2.5), 0, R(-2.5, 2.5), { eggs }, R(-180, 180)));
  // DUSTY: a random zone, 2–4 grain patches in it; a third of the time on a charge leash a RINGER switches
  const dx2 = R(-1.5, 1.5), dz2 = R(-2.5, -0.5);
  const zw = R(1, 3), zd = R(1, 3);
  const dusty = b.add('dusty', dx2, 0, dz2, { zone_w: zw, zone_d: zd }, R(-180, 180));
  critters.push(dusty);
  if (r.nextFloat() < 0.33) {
    const mains = b.add('mains', dx2 + R(-1.5, 1.5), 0, dz2 - R(1.2, 1.8), { on: r.nextFloat() < 0.5 ? 1 : 0 });
    b.link('cable_power', mains, 'out', dusty, 'charge');
    const ringer = b.add('ringer', R(-3, 3), 0, R(3, 4), { time: R(2, 25) });
    b.link('cable_signal', ringer, 'out', mains, 'in');
  }
  const nPatch = 2 + r.nextInt(3);
  for (let i = 0; i < nPatch; i++) lures.push({ pos: [dx2 + R(-zw / 2, zw / 2), 0, dz2 + R(-zd / 2, zd / 2)], radius: 1.5, species: { dusty: 1 } });
  // ---- M5 (stream B5): BUZZ ----
  // its BUZZ BEACON somewhere on the set; BUZZ docked on it (or, a quarter of the time, placed away so it flies home)
  const ex = R(-2.5, 2.5), ez = R(-2.5, 2.5), ey = R(-180, 180);
  const beacon = b.add('buzz_beacon', ex, 0, ez, {}, ey);
  critters.push(r.nextFloat() < 0.75 ? b.add('buzz', ex, 0.04, ez, {}, ey) : b.add('buzz', R(-2.5, 2.5), 0, R(-2.5, 2.5), {}, R(-180, 180)));
  // 1–3 RINGERs call it during the run (two calls can overlap a job: it serves them in turn)
  const nCalls = 1 + r.nextInt(3);
  for (let i = 0; i < nCalls; i++) {
    const ringer = b.add('ringer', R(-3, 3), 0, R(-3.5, -3), { time: R(1, Math.min(30, RUN_SECONDS - 5)) });
    b.link('cable_signal', ringer, 'out', beacon, 'call');
  }
  // 2–5 tagged items to fetch (balls, tiles, a SCOOP), and sometimes a tagged THUD (7 kg: too heavy, never fetched)
  const nItems = 2 + r.nextInt(4);
  const kinds = ['stitch', 'boing', 'topple_tile', 'scoop'] as const;
  for (let i = 0; i < nItems; i++) {
    const kind = kinds[r.nextInt(kinds.length)]!;
    const y = kind === 'stitch' ? 0.04 : kind === 'boing' ? 0.12 : kind === 'topple_tile' ? 0.075 : 0.05;
    b.add(kind, R(-2.8, 2.8), r.nextFloat() < 0.2 ? R(0.5, 1.5) : y, R(-2.8, 2.8), {}, R(-180, 180), TAGGED);
  }
  if (r.nextFloat() < 0.3) b.add('thud', R(-2.5, 2.5), 0.11, R(-2.5, 2.5), {}, 0, TAGGED);
  // a third of the time a wall of anchored PLANKs (up to 1.2 m tall) stands somewhere on the set
  if (r.nextFloat() < 0.33) {
    const wx = R(-2, 2), wz = R(-2, 2), wy = R(-180, 180), n = 3 + r.nextInt(10);
    for (let i = 0; i < n; i++) b.add('plank', wx, 0.05 + 0.1 * i, wz, {}, wy, ANCHORED);
  }
  // a quarter of the time a pair of RIFT GATES (BUZZ is wider than their aperture: it never passes)
  if (r.nextFloat() < 0.25) for (let i = 0; i < 2; i++) b.add('rift_gate', R(-2.5, 2.5), 0, R(-2.5, 2.5), {}, R(-180, 180));
  // B5 (M5 follow-up): half the time a portal lane: a second MOCHI 0.8–1.3 m in front of a RIFT GATE with a snack
  // a metre behind it, so she walks through to its partner (the animal critters transit; future.md)
  if (r.nextFloat() < 0.5) {
    const lx = R(-2.5, 2.5), lz = R(-2.5, 2.5), ly = R(-180, 180), d = R(0.8, 1.3);
    const fx = Math.sin((ly * Math.PI) / 180), fz = Math.cos((ly * Math.PI) / 180); // the gate's front (+Z yawed)
    b.add('rift_gate', lx, 0, lz, {}, ly);
    b.add('rift_gate', R(-3, 3), 0, R(-3, 3), {}, R(-180, 180));
    critters.push(b.add('mochi', lx + fx * d, 0, lz + fz * d, {}, ly + 180));
    lures.push({ pos: [lx - fx, 0, lz - fz], radius: 3, species: { mochi: 1 } });
  }
  // Hand-of-God pokes on critters and loose parts through the run
  const pokes: Poke[] = [];
  const targets = b.parts.filter((p) => partDef(p.type)!.body.kind === 'dynamic').map((p) => p.id);
  const nPokes = 4 + r.nextInt(8);
  for (let i = 0; i < nPokes; i++) {
    const strong = r.nextFloat() < 0.5;
    const target = r.nextFloat() < 0.6 ? critters[r.nextInt(critters.length)]! : targets[r.nextInt(targets.length)]!;
    // a poke is an impulse (N·s); keep loose parts under ~6 m/s like a hand flick would
    const mass = partDef(b.parts.find((p) => p.id === target)!.type)!.body.mass;
    const s = Math.min(strong ? R(2, 25) : R(0.05, 1), mass * 6);
    pokes.push({ tick: 120 + r.nextInt(TICKS - 240), seq: i + 1, partId: target, kind: 'impulse', data: [R(-1, 1) * s, R(0.2, 1) * s, R(-1, 1) * s] });
  }
  pokes.sort((a, c) => a.tick - c.tick || a.seq - c.seq);
  const anchor = b.add('anchor', 3.5, 0, -3.5);
  const matter = MATTER_EVERY > 0 && seed % MATTER_EVERY === 0
    // a few hundred to 1,500 grains: MX's CPU backend costs ~10 ms a tick at that size on the test system
    ? { anchor, at: [dx2 + R(-0.4, 0.4) - 3.5, 0.01, dz2 + R(-0.4, 0.4) + 3.5] as const, sand: 300 + r.nextInt(1200), marbles: r.nextInt(30) }
    : null;
  return { world: { parts: b.parts, links: b.links }, pokes, critters, lures, matter };
}

// ---- running and checking ---------------------------------------------------------------------------------

interface RunStats {
  hashes: string[];
  ragdolls: number; getups: number; maxRagTicks: number; traps: number; breaks: number; sprints: number; pedals: number; pounces: number; startles: number;
  floops: number; steals: number; eats: number; fsmVisits: Set<number>; forced: number; forcedBy: string[];
  /** M4 (B4) */
  barks: number; lays: number; splats: number; vacuums: number; binFulls: number; bumpTurns: number; dogFlees: number; trappedStartles: number; grains: number;
  /** M5 (B5): BUZZ's grabs and deliveries, its tumbles, calls it answered (takeoffs on a job), landings beside the beacon. */
  fetches: number; deliveries: number; buzzTumbles: number; buzzCalls: number; besides: number;
  /** PARTSIM (D121): BUZZ startles (a big boom nearby). */
  buzzStartles: number;
  /** B5 (M5 follow-up): critters through a RIFT GATE pair, and critters bounced off one in its cooldown. */
  critterTransits: number; critterBounces: number;
  failures: string[];
}

function newStats(): RunStats {
  return {
    hashes: [], ragdolls: 0, getups: 0, maxRagTicks: 0, traps: 0, breaks: 0, sprints: 0, pedals: 0, pounces: 0, startles: 0, floops: 0, steals: 0, eats: 0, fsmVisits: new Set(), forced: 0, forcedBy: [],
    barks: 0, lays: 0, splats: 0, vacuums: 0, binFulls: 0, bumpTurns: 0, dogFlees: 0, trappedStartles: 0, grains: 0,
    fetches: 0, deliveries: 0, buzzTumbles: 0, buzzCalls: 0, besides: 0, buzzStartles: 0, critterTransits: 0, critterBounces: 0, failures: [],
  };
}

const F = (s: (typeof CRITTER_FSM)[number]): number => CRITTER_FSM.indexOf(s);
const EMOTE_DOG_ALERT = CRITTER_EMOTES.indexOf('dog_alert');
const EMOTE_FEATHER = CRITTER_EMOTES.indexOf('feather');

/**
 * Tunnelling probe: a ray against static geometry only (walls, cove, floor, static parts) between a
 * body's centre of mass on consecutive ticks. A centre never legally crosses a static surface (a body
 * resting on or sliding along one keeps its centre a radius away), so a segment that hits a surface
 * both ways, starting and ending outside all static geometry, passed through it. Penetrating and being
 * pushed back out (a ragdoll that starts overlapping a part) is not counted.
 */
class StaticRay {
  private readonly J: JoltModule;
  private readonly sys: JoltModule;
  private readonly settings: JoltModule;
  private readonly col: JoltModule;
  private readonly bp: JoltModule;
  private readonly obj: JoltModule;
  private readonly body: JoltModule;
  private readonly shape: JoltModule;
  private readonly o: JoltModule;
  private readonly d: JoltModule;
  private readonly pt: JoltModule;
  constructor(J: JoltModule, m: Machine) {
    const inner = m as unknown as { system: JoltModule; jolt: JoltModule };
    this.J = J;
    this.sys = inner.system;
    this.settings = new J.RayCastSettings();
    // rays starting inside a shape (a capsule pushed into a part, then depenetrating) see nothing of it:
    // only a centre that goes in one side and out the other is a pass-through
    this.settings.mTreatConvexAsSolid = false;
    this.col = new J.CastRayClosestHitCollisionCollector();
    this.bp = new J.DefaultBroadPhaseLayerFilter(inner.jolt.GetObjectVsBroadPhaseLayerFilter(), 1);
    this.obj = new J.SpecifiedObjectLayerFilter(0); // the static layer
    this.body = new J.BodyFilter();
    this.shape = new J.ShapeFilter();
    this.o = new J.RVec3(0, 0, 0);
    this.d = new J.Vec3(0, 0, 0);
    this.pt = new J.CollidePointAnyHitCollisionCollector();
  }
  /** Is the point inside static geometry (a capsule spawned or pushed into a part)? */
  private inside(a: readonly number[]): boolean {
    this.o.Set(a[0]!, a[1]!, a[2]!);
    this.pt.Reset();
    this.sys.GetNarrowPhaseQuery().CollidePoint(this.o, this.pt, this.bp, this.obj, this.body, this.shape);
    return this.pt.HadHit();
  }
  private frac(a: readonly number[], b: readonly number[]): number {
    this.o.Set(a[0]!, a[1]!, a[2]!);
    this.d.Set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    const ray = new this.J.RRayCast(this.o, this.d);
    this.col.Reset();
    this.sys.GetNarrowPhaseQuery().CastRay(ray, this.settings, this.col, this.bp, this.obj, this.body, this.shape);
    const f = this.col.HadHit() ? this.col.mHit.mFraction : 1;
    this.J.destroy(ray);
    return f;
  }
  crosses(a: readonly number[], b: readonly number[]): boolean {
    const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
    if (dx * dx + dy * dy + dz * dz < 1e-8) return false;
    return this.frac(a, b) < 1 && this.frac(b, a) < 1 && !this.inside(a) && !this.inside(b);
  }
}

interface Ctx {
  ray: StaticRay;
  /** Critter bodies: [body index, critter part index, 0 base / 1 rag]. */
  /** 0 base, 1 ragdoll capsule, 2 pooled piece (HENNY's YOLKs: checked while laid, never across a spawn or despawn). */
  bodies: (readonly [number, number, 0 | 1 | 2])[];
  /** Last tick's centres of mass and whether each was simulated (base free / rag tumbling). */
  prev: Float64Array;
  was: Uint8Array;
  /** M5 (B5): BUZZ part ids, and each one's paired beacon state for the checks. */
  buzz: Set<number>;
  /** B5 (M5 follow-up): critters that went through a RIFT GATE this tick (their bodies jump; skip the pass-through ray). */
  jumped: Set<number>;
}

function check(m: Machine, s: RunStats, sc: Scenario, open: Map<number, number>, t: number, events: readonly SimEvent[], ctx: Ctx): void {
  const fail = (msg: string): void => { if (s.failures.length < 20) s.failures.push(`tick ${t}: ${msg}`); };
  for (const e of events) {
    switch (e.kind) {
      case 'Ragdoll':
        s.ragdolls++; if (open.has(e.part)) fail(`second Ragdoll for ${e.part} before a Getup`); open.set(e.part, e.tick);
        if (ctx.buzz.has(e.part)) s.buzzTumbles++;
        break;
      // M5 (B5): BUZZ
      case 'Fetch': {
        s.fetches++;
        const item = sc.world.parts.find((p) => p.id === e.other);
        if (!item || !(item.flags & TAGGED) || partDef(item.type)!.body.mass > 2 + 1e-9) fail(`BUZZ fetched an untagged or heavy part (${item?.type})`);
        break;
      }
      case 'Deliver': s.deliveries++; break;
      case 'Teleport': case 'Bounce': {
        const ty = sc.world.parts.find((p) => p.id === e.other)?.type ?? '';
        if (!CRITTER_TYPES.has(ty)) break;
        if (ty === 'dusty' || ty === 'buzz') fail(`${ty} went through a RIFT GATE`);
        if (e.kind === 'Teleport') { s.critterTransits++; ctx.jumped.add(e.other!); } else s.critterBounces++;
        break;
      }
      case 'Emote':
        if (e.mag === EMOTE_FEATHER && (sc.world.parts.find((p) => p.id === e.part)?.type === 'henny')) {
          const pi = m.parts.findIndex((p) => p.id === e.part);
          if ((m.critterState(new Uint8Array(m.parts.length * 4))[pi * 4 + 1]! & 2) !== 0) s.trappedStartles++;
        }
        if (e.mag === EMOTE_DOG_ALERT) s.dogFlees++;
        break;
      case 'Getup': {
        s.getups++;
        const at = open.get(e.part);
        if (at === undefined) fail(`Getup without Ragdoll for ${e.part}`);
        else {
          s.maxRagTicks = Math.max(s.maxRagTicks, e.tick - at);
          if (e.tick - at >= 8 * 120 - 1) { s.forced++; s.forcedBy.push(sc.world.parts.find((p) => p.id === e.part)?.type ?? '?'); }
          open.delete(e.part);
        }
        break;
      }
      case 'Trapped': s.traps++; break;
      case 'Splash': s.breaks++; break;
      case 'Bark': s.barks++; break;
      case 'Lay': s.lays++; break;
      case 'Splat': s.splats++; break;
      case 'CritterState':
        s.fsmVisits.add(e.mag);
        if (e.mag === F('wheel_sprint')) s.sprints++;
        if (e.mag === F('pedal')) s.pedals++;
        if (e.mag === F('pounce')) s.pounces++;
        if (e.mag === F('startled')) { s.startles++; if (ctx.buzz.has(e.part)) s.buzzStartles++; } // PARTSIM: + BUZZ's
        if (e.mag === F('flop')) s.floops++;
        if (e.mag === F('steal_carry')) s.steals++;
        if (e.mag === F('eat')) s.eats++;
        if (e.mag === F('vacuum')) s.vacuums++;
        if (e.mag === F('bin_full')) s.binFulls++;
        if (e.mag === F('bump_turn')) s.bumpTurns++;
        if (ctx.buzz.has(e.part) && e.mag === F('landed')) s.besides++;
        break;
      default:
    }
  }
  for (const [part, at] of open) if (t - at > MAX_RAGDOLL_TICKS) { fail(`critter ${part} still tumbling after ${((t - at) / 120).toFixed(1)} s`); open.delete(part); }
  const tr = m.transforms(new Float32Array(m.bodies.length * 7));
  const info = m.bodyInfo();
  // critter bodies every tick: a simulated body's centre never passes through static geometry
  const cs = m.critterState(new Uint8Array(m.parts.length * 4));
  ctx.bodies.forEach(([bi, pi, rag], n) => {
    const flags = cs[pi * 4 + 1]!, fsm = cs[pi * 4 + 3]!;
    const ghostBase = (flags & (1 | 8)) !== 0 || fsm === F('bubble') || fsm === F('home');
    const c = m.bodies[bi]!.body.GetCenterOfMassPosition();
    const at = [c.GetX(), c.GetY(), c.GetZ()] as const;
    const live = rag === 2 ? at[1] > -20 : rag ? (flags & 1) !== 0 : !ghostBase;
    const o = n * 3;
    if (live && ctx.was[n] && !ctx.jumped.has(info[bi]!.part) && ctx.ray.crosses([ctx.prev[o]!, ctx.prev[o + 1]!, ctx.prev[o + 2]!], at)) {
      fail(`body ${bi} (${info[bi]!.type} ${info[bi]!.role}${info[bi]!.bone ? ' ' + info[bi]!.bone : ''}) passed through static geometry at (${at[0].toFixed(2)}, ${at[1].toFixed(2)}, ${at[2].toFixed(2)})`);
    }
    // M5 (B5): BUZZ's body never jumps (a RIFT GATE transit or a bad placement) and never flies above its ceiling
    if (info[bi]!.type === 'buzz' && rag === 0 && live && ctx.was[n]) {
      const dx = at[0] - ctx.prev[o]!, dy = at[1] - ctx.prev[o + 1]!, dz = at[2] - ctx.prev[o + 2]!;
      if (dx * dx + dy * dy + dz * dz > 0.25 * 0.25) fail(`BUZZ jumped ${Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(2)} m in a tick at (${at[0].toFixed(2)}, ${at[1].toFixed(2)}, ${at[2].toFixed(2)})`);
      if (at[1] > 4.5) fail(`BUZZ flew to ${at[1].toFixed(2)} m`);
    }
    ctx.prev[o] = at[0]; ctx.prev[o + 1] = at[1]; ctx.prev[o + 2] = at[2];
    ctx.was[n] = live ? 1 : 0;
  });
  ctx.jumped.clear(); // B5 (M5 follow-up)
  if (t % 30 !== 0) return;
  for (let i = 0; i < info.length; i++) {
    const x = tr[i * 7]!, y = tr[i * 7 + 1]!, z = tr[i * 7 + 2]!;
    if (!Number.isFinite(x + y + z + tr[i * 7 + 3]! + tr[i * 7 + 6]!)) { fail(`body ${i} (${info[i]!.type} ${info[i]!.role}) not finite`); continue; }
    const out = Math.abs(x) > FLOOR || Math.abs(z) > FLOOR;
    // M4: HENNY's dormant YOLKs park 30 m under her (pool convention); a laid one is checked like any body
    if (info[i]!.role === 'piece' && y < -20) continue;
    // fracture chunks keep the part's origin (hull in part space): a flipped shard's origin may sit below the floor
    if ((y < -0.25 && info[i]!.role !== 'chunk') || out) fail(`body ${i} (${info[i]!.type} ${info[i]!.role}${info[i]!.bone ? ' ' + info[i]!.bone : ''}) left the world at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
  }
  void sc;
}

/** Runs a scenario; `late` delivers that poke only once the sim is 90 ticks past it (rollback). */
function run(J: JoltModule, sc: Scenario, opts: { checks: boolean; late?: Poke }): RunStats {
  const mo: MachineOptions = sc.matter ? { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 20000, checkpointEvery: 60 } } : {};
  const m = new Machine(J, sc.world, { checkpointEvery: 60, keepCheckpoints: 16, preset: 'room', extraLures: sc.lures, ...mo });
  if (sc.matter) {
    const ai = m.parts.findIndex((p) => p.id === sc.matter!.anchor);
    m.matter.emit(ai, 0, sc.matter.sand, sc.matter.at, [0, 0, 0], 0.15);
    if (sc.matter.marbles) m.matter.emit(ai, 2, sc.matter.marbles, sc.matter.at, [0, 0, 0], 0.15);
  }
  const s = newStats();
  for (const p of sc.pokes) if (p !== opts.late) m.addPoke(p);
  const open = new Map<number, number>();
  const crit = m.bodyInfo().map((b, i) => [i, m.parts.findIndex((p) => p.id === b.part), b.role === 'rag' ? 1 : b.role === 'piece' ? 2 : 0, b.type] as const).filter((x) => CRITTER_TYPES.has(x[3]));
  const ctx: Ctx = {
    ray: new StaticRay(J, m), bodies: crit.map(([i, pi, r]) => [i, pi, r] as const), prev: new Float64Array(crit.length * 3), was: new Uint8Array(crit.length),
    buzz: new Set(sc.world.parts.filter((p) => p.type === 'buzz').map((p) => p.id)), // M5 (B5)
    jumped: new Set(),
  };
  let lateDone = !opts.late;
  for (let t = 1; t <= TICKS; t++) {
    m.step();
    const ev = m.drainEvents();
    if (opts.checks) check(m, s, sc, open, t, ev, ctx);
    if (!lateDone && m.tick >= opts.late!.tick + 90) {
      lateDone = true;
      const was = m.tick;
      m.addPoke(opts.late!);
      const back = m.restore(opts.late!.tick);
      if (back < 0) s.failures.push(`rollback to ${opts.late!.tick} failed`);
      // hashes after the rollback point are recomputed
      s.hashes.length = Math.floor(back / HASH_EVERY);
      while (m.tick < was) { m.step(); m.drainEvents(); if (m.tick % HASH_EVERY === 0) s.hashes.push(m.hash()); }
      t = m.tick;
      continue;
    }
    if (m.tick % HASH_EVERY === 0) s.hashes.push(m.hash());
  }
  if (opts.checks) for (const [part, at] of open) if (TICKS - at > MAX_RAGDOLL_TICKS) s.failures.push(`end: critter ${part} never got up (since tick ${at})`);
  if (opts.checks) {
    // M4: no laid egg or dormant pool body went missing; Dusty's bin never exceeds its 1.8 kg
    for (const x of m.st.crit.m4 ?? []) { if (x.bin > 1.8 + 1e-9 || x.bin < 0) s.failures.push(`end: a bin holds ${x.bin} kg`); s.grains += x.n; }
    // M5 (B5): BUZZ answered calls (jobs taken = served); a carried item is a ghost hanging under it
    for (const x of m.st.crit.m5 ?? []) s.buzzCalls += x.served;
    const carry = m.critterCarry();
    for (let i = 0; i < carry.length; i += 2) {
      if (m.parts[carry[i]!]!.def.type !== 'buzz') continue;
      const body = m.bodies[m.parts[carry[i + 1]!]!.base]!.body;
      if (body.GetObjectLayer() !== 2) s.failures.push(`end: BUZZ's load isn't a ghost`);
    }
  }
  m.destroy();
  return s;
}

async function main(): Promise<void> {
  let J = await loadJolt('single');
  const t0 = Date.now();
  const budget = MINUTES * 60_000;
  const total = newStats();
  let runs = 0, ticks = 0, hashChecks = 0, desyncs = 0, rollbacks = 0, matterRuns = 0;
  const failures: string[] = [];
  let seed = SEED;
  console.log(`critter soak: ${MINUTES} min, ${RUN_SECONDS} s machines, seed ${SEED}`);
  while (Date.now() - t0 < budget) {
    // a fresh Jolt instance every 50 runs (150 machines): each Machine leaves ~30 KB in the WASM heap
    // (M1 Machine and shape settings), harmless for one run per Stop but not for thousands in a row
    if (runs > 0 && runs % 50 === 0) J = await loadJolt('single');
    const sc = scenario(seed);
    const a = run(J, sc, { checks: true });
    const b = run(J, sc, { checks: false });
    const late = sc.pokes[Math.floor(sc.pokes.length / 2)];
    const c = late ? run(J, sc, { checks: false, late }) : b;
    if (late) rollbacks++;
    runs++;
    ticks += TICKS * (late ? 3 : 2);
    hashChecks += a.hashes.length * 2;
    const same = (x: string[], y: string[]): boolean => x.length === y.length && x.every((h, i) => h === y[i]);
    if (!same(a.hashes, b.hashes)) { desyncs++; failures.push(`seed ${seed}: replay B diverged at hash #${a.hashes.findIndex((h, i) => h !== b.hashes[i])}`); }
    if (!same(a.hashes, c.hashes)) { desyncs++; failures.push(`seed ${seed}: rollback run C diverged at hash #${a.hashes.findIndex((h, i) => h !== c.hashes[i])} (late poke at tick ${late?.tick})`); }
    for (const f of a.failures) failures.push(`seed ${seed}: ${f}`);
    for (const k of ['ragdolls', 'getups', 'traps', 'breaks', 'sprints', 'pedals', 'pounces', 'startles', 'floops', 'steals', 'eats', 'forced',
      'barks', 'lays', 'splats', 'vacuums', 'binFulls', 'bumpTurns', 'dogFlees', 'trappedStartles', 'grains',
      'fetches', 'deliveries', 'buzzTumbles', 'buzzCalls', 'besides', 'buzzStartles', 'critterTransits', 'critterBounces'] as const) total[k] += a[k];
    if (sc.matter) matterRuns++;
    total.forcedBy.push(...a.forcedBy);
    total.maxRagTicks = Math.max(total.maxRagTicks, a.maxRagTicks);
    for (const v of a.fsmVisits) total.fsmVisits.add(v);
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`  run ${runs} seed ${seed}${sc.matter ? ' (matter)' : ''}: ${a.ragdolls} ragdolls / ${a.getups} getups, ${a.traps} traps, ${a.pedals} pedal runs, ${a.sprints} sprints, ${a.barks} barks, ${a.lays} eggs (${a.splats} splat), ${a.vacuums} vacuums, ${a.fetches} fetches / ${a.deliveries} deliveries, ${a.critterTransits} rift transits, ${a.failures.length ? a.failures.length + ' FAIL' : 'ok'} · ${el.toFixed(0)} s\n`);
    seed++;
  }
  const secs = (Date.now() - t0) / 1000;
  const summary = {
    minutes: +(secs / 60).toFixed(2), runs, machineSeconds: runs * RUN_SECONDS, ticks, ticksPerSecond: Math.round(ticks / secs), hashChecks, desyncs, rollbacks,
    ragdolls: total.ragdolls, getups: total.getups, maxRagdollSeconds: +(total.maxRagTicks / 120).toFixed(2),
    forcedRecoveries: total.forced, forcedBy: Object.fromEntries([...new Set(total.forcedBy)].map((t) => [t, total.forcedBy.filter((x) => x === t).length])), traps: total.traps, bowlBreaks: total.breaks,
    wheelSprints: total.sprints, pedalRuns: total.pedals, pounces: total.pounces, startles: total.startles, flops: total.floops, steals: total.steals, eats: total.eats,
    m4: {
      barks: total.barks, eggsLaid: total.lays, splats: total.splats, vacuums: total.vacuums, binFulls: total.binFulls, bumpTurns: total.bumpTurns,
      mochiFleesBiscuit: total.dogFlees, hennyTrappedStartles: total.trappedStartles, grainsTaken: total.grains, matterRuns,
    },
    m5: { buzzCallsAnswered: total.buzzCalls, fetches: total.fetches, deliveries: total.deliveries, buzzTumbles: total.buzzTumbles, landedBeside: total.besides, buzzStartles: total.buzzStartles, critterRiftTransits: total.critterTransits, critterRiftBounces: total.critterBounces },
    statesVisited: `${total.fsmVisits.size} / ${CRITTER_FSM.length}`,
    statesMissing: CRITTER_FSM.filter((_, i) => !total.fsmVisits.has(i)),
    failures: failures.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) { console.log(failures.slice(0, 40).join('\n')); process.exit(1); }
  console.log('critter soak: PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
