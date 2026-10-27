// Machine: the deterministic run (SIMULATION §2–6, §9–11), M1 slice.
//
// Builds a fresh Jolt world from a canonical snapshot (parts and links sorted by id), then runs the
// tick pipeline: inputs → timers → signal → power → heat → behaviours → physics → contacts →
// explosions → despawn → output. All gameplay state lives in `st`, which is plain data, so a
// checkpoint is Jolt SaveState + a structured clone of `st`.

import { Hasher, dcbrt, dcos, dpow, dsin, f32, toHex64 } from '@knockon/detmath';
import { posToMetres, type LinkRecord, type PartId, type PartRecord, type TerrainRecord } from '@knockon/format';
import { joltThreads, type JoltModule } from '@knockon/jolt';
import { ContactBuffer } from './contactbuf.ts'; // J4: contacts buffered from any Jolt thread, gathered canonically
import { KITCHEN, TINKER, cogSize, coveProfile, fracOf, partDef, propValues, studioCove, type PartDef, type PortDef, type Props, type ShapeDef } from '@knockon/parts-data';
import { BACKLOT, JOLT_BIG_WORLD, checkpointPlan, joltCapacity, presetOf } from '@knockon/parts-data'; // S3: preset floors, Jolt capacities, checkpoints, Backlot set
import { buildTerrain } from './terrain.ts'; // S3: Backlot heightfield
import { rotationToQuat } from './rotation.ts';
import { contactEstimate } from './capacity.ts'; // A3: contact buffers sized from the world
import { qmul, qrot, roundPath, segDist, vadd, vcross, vdot, vlen, vnorm, vscale, vsub, type Q, type Vec } from './vec.ts';
// critters (stream B): AI, locomotion, ragdolls and the critter-bound devices live in ./critters
import { CritterSystem, type CritterHost, type ExtraLure, type SoundIn } from './critters/system.ts';
import { emptyCritWorld, type CritWorld } from './critters/state.ts';
import type { BeaconHost } from './critters/m5.ts'; // B5 (M5): BUZZ reads A5's beacons
// M2 parts and channels (stream A): light, sound, lure, toggles, cells, dynamos, launchers… live in ./channels
import { PartChannels, createM2State, explosionDb, impactDb, IMPACT_SOUND_J, type Host as ChannelHost, type LureEmitter, type M2State, type Sound } from './channels/index.ts';
// MI (M4): the Matter layer (machine.matter, contract 2): coupling stages 7 and 13, checkpoints, hash
import { MatterHost, type MatterCp, type MatterMachine, type MatterOptions, type MatterSt, type SimFlags } from './matter/host.ts';
import { exportMatter, importMatter } from './matter/checkpoint.ts';
import { decodeCheckpoint, encodeCheckpoint } from '@knockon/format';
import { PartFlag } from '@knockon/format'; // B5 (M5): PartFlag.Tagged → PartFlagBits.tagged
// W5 (M5): ORBITAL HANGAR and MOON BASE: set colliders, the Moon's heightfield, the Hangar's zero-g zones (env.zones)
import { buildSpaceTerrain, globalWind, spaceSetPlan, windRun, zeroGZones, type WindRun } from './envsets.ts';
import type { EnvWind } from '@knockon/format';
import type { SpaceZone } from '@knockon/parts-data';

const L_STATIC = 0, L_MOVING = 1, L_GHOST = 2;
/**
 * S3: part types with no per-tick logic anywhere (no ports, power, heat, behaviour or channel hooks; BRIK's
 * mortar is its own list). The per-part stages skip them. Add a type only after checking channels/ and critters/.
 */
const INERT: ReadonlySet<string> = new Set(['topple_tile', 'brik', 'thud', 'boing', 'slope', 'ledge']);
/** S3: above this many parts a run gets a sized Jolt heap (parts-data joltHeapMB) and in-heap checkpoints. */
const BIG_WORLD = JOLT_BIG_WORLD;
const G = 9.81;

export type EventKind = 'Signal' | 'Powered' | 'Unpowered' | 'Ignite' | 'Extinguish' | 'FuseLit' | 'FuseEnd' | 'Detonate' | 'Pop' | 'Cut' | 'Impact' | 'Press' | 'Break' | 'Brownout' | 'Jam'
  // M2 parts (stream A, contract 1). Sound: mag = dB at 1 m. Lit / Unlit: light emitters and receivers.
  // Toggle: mag = new state (1 on). Ring: RINGER at zero. Launch: mag = launch speed (m/s), `other` = the
  // launched part. Spawn / Despawn: a pre-built piece (cork) enters / leaves play. Splash, Note: reserved.
  | 'Lit' | 'Unlit' | 'Sound' | 'Toggle' | 'Ring' | 'Launch' | 'Splash' | 'Spawn' | 'Despawn' | 'Note'
  // critters (stream B, contract 1)
  | 'CritterState' | 'Emote' | 'Ragdoll' | 'Getup' | 'Trapped'
  // M3 parts (stream A3, contract 6; full list in docs/dev/M3_NOTES_A3.md): Trip (TRIPWIRE fired), PingRx (a wireless
  // hop arrives: part = Rx, other = Tx), Attach / Release (MAGLOCK holds / lets go: other = the steel part), RailOn /
  // RailOff (a marble joins / leaves a GLIDEPATH), Boost (booster kick), Confetti (POPPER), Trigger (BONKER / PADDLE /
  // PINGER start, FLINGER release, BUMPER kick: mag 1, or the kick speed), Fire (PINGER strike, FLINGER at its stop:
  // mag = speed), Snap (SNAPTRAP sprung), Extend / Retract (RAM out / back; BONKER and PADDLE back), Burst (SKYSHOW shell,
  // after its Detonate: mag = pattern), PinsAllDown (a PINS rack: mag = pins), Goal (RECYCLER count), Cook (POWDER KEG
  // starts cooking), Jostle (JITTERJUICE near miss), Arrive (LIFT at an end: mag 1 top, 0 bottom)
  | 'Trip' | 'PingRx' | 'Attach' | 'Release' | 'RailOn' | 'RailOff' | 'Boost' | 'Confetti' | 'Trigger' | 'Fire' | 'Snap' | 'Extend' | 'Retract'
  | 'Burst' | 'PinsAllDown' | 'Goal' | 'Cook' | 'Jostle' | 'Arrive'
  // M4 critters (stream B4, docs/dev/M4_NOTES_B4.md): Bark (BISCUIT: mag = dB, the cause of its 70 dB Sound), Lay (HENNY
  // lays a YOLK from her pool: mag = egg number, pos = the vent), Splat (a laid YOLK breaks: part = HENNY, mag = J)
  | 'Bark' | 'Lay' | 'Splat'
  // M4 parts (stream A4; full list in docs/dev/M4_NOTES_A4.md): Valve (gate / valve / feed / INFLATOR valve: mag 1 open,
  // 0 closed), Empty (a container ran out; HOURGLASS's signal), Flip (HOURGLASS bulbs swap: mag = new direction), Squeak
  // (QUACK, cosmetic: mag 0–1), Arc (ARC TOWER strike: other = target, mag = distance), Overfill (INFLATOR past 100 %:
  // other = the HELIO), Squeeze (SPONGE: mag = mL held), Drive (ZIPPY: mag = direction 1 / −1 / 0). A placed YOLK uses
  // B4's Splat above (part = the YOLK, mag = J).
  | 'Valve' | 'Empty' | 'Flip' | 'Squeak' | 'Arc' | 'Overfill' | 'Squeeze' | 'Drive'
  // B5 (M5, docs/dev/M5_NOTES_B5.md): Fetch (BUZZ's claw closes on a tagged item: part = BUZZ, other = the item, mag =
  // its kg), Deliver (BUZZ lets the item go on its beacon's pad: part = BUZZ, other = the item, mag = seconds since the call)
  | 'Fetch' | 'Deliver'
  // A5 (M5 parts; full list in docs/dev/M5_NOTES_A5.md): Teleport (RIFT GATES: part = entry gate, other = the body's part,
  // mag = speed), Emerge (part = exit gate, cause = the Teleport), Bounce (a body hits a pair's membrane during its
  // cooldown), Barrier (FORCE WALL: mag 1 on, 0 off), Engage (STASIS FIELD on / off: mag 1 / 0; SINGULARITY armed: mag 1),
  // Freeze (STASIS: a body enters while engaged, other = it), Charged (COILGUN RING ready), Call (BUZZ BEACON: mag = call
  // number), Collapse (SINGULARITY at 6 s: mag = bodies swallowed)
  | 'Teleport' | 'Emerge' | 'Bounce' | 'Barrier' | 'Engage' | 'Freeze' | 'Charged' | 'Call' | 'Collapse';

export interface SimEvent {
  /** Per run, increasing in emit order (rollback re-emits the same ids). */
  readonly id: number;
  readonly tick: number;
  readonly kind: EventKind;
  readonly part: PartId;
  readonly pos: readonly [number, number, number];
  readonly mag: number;
  /** Id of the event that caused this one, −1 = none (SIMULATION §9). */
  readonly cause: number;
  /** The other part involved (contact partner, launched Roller), when there is one. */
  readonly other?: PartId;
}

export type { LureEmitter, Sound } from './channels/index.ts';

export interface Poke {
  readonly tick: number;
  readonly seq: number;
  readonly partId: PartId;
  readonly kind: 'impulse' | 'drag' | 'release';
  readonly data: readonly number[];
}

type SetPhys = 'powder' | 'wood' | 'ceramic' | 'steel' | 'glass' | 'rubber' | 'paper' | 'fabric' | 'concrete' | 'regolith'; // W5 (M5): + environment ground
type V3t = readonly [number, number, number];
interface SetBox { readonly center: V3t; readonly half: V3t; readonly phys: SetPhys }
interface SetSphere { readonly center: V3t; readonly radius: number; readonly phys: SetPhys }
/** W5 (M5): a static convex hull (E5c's `COL__hull` set pieces: shuttle, lander, boulders). */
interface SetHull { readonly points: readonly V3t[]; readonly phys: SetPhys }

export interface MachineOptions {
  readonly tickRate?: 60 | 120;
  readonly gravityPercent?: number;
  readonly airPercent?: number;
  readonly workerThreads?: number;
  /** Checkpoint every N ticks (SIMULATION §11: 60 = 0.5 s at 120 Hz). 0 disables. */
  readonly checkpointEvery?: number;
  readonly keepCheckpoints?: number;
  /** World preset: the Studio cove around it collides (environments.md §1.1). */
  readonly preset?: string;
  /** Environment set (EnvSettings.environment): 'studio' (default) or 'kitchen' (the Mega Kitchen's colliders). */
  readonly environment?: string;
  /** World seed (two u32 words, WorldDoc.seed): named PRNG streams such as `critter:<partId>` derive from it. */
  readonly seed?: readonly [number, number];
  /**
   * Tests and soaks only (critters): extra Lure emitters for this run. `part` makes a placed part a lure
   * (a small dynamic part with a `bandit` weight counts as shiny, so Bandit can steal it); `pos` is a
   * bodiless lure at a fixed point (seeds, a snack). A run input like the snapshot: same on every client.
   */
  readonly extraLures?: readonly ExtraLure[];
  /** S3: Backlot terrain (DATA_FORMATS TERR), a run input like the snapshot; null/absent = flat floor. */
  readonly terrain?: TerrainRecord | null;
  /** MI (M4): sim flags (DATA_FORMATS §2.1), a run input like the snapshot. `matterGameplay` turns the Matter layer on. */
  readonly simFlags?: SimFlags;
  /** MI (M4): the Matter backend or link and its settings (required when simFlags.matterGameplay is on). */
  readonly matter?: MatterOptions;
  /** W5 (M5): the environment's zero-g zones on (EnvSettings.zones; default true). A run input like gravity. */
  readonly zones?: boolean;
  /** W5 (M5, D26): global wind (EnvSettings.wind; absent = none). A run input like gravity; scaled by air. */
  readonly wind?: EnvWind | null;
  /**
   * SIMFIX (beta): `contactEstimate(world.parts)` when the caller already has it (the sim worker sizes the Jolt heap
   * with it), so a start computes it once (≈ 1.6 s at 1M parts). It sizes Jolt's contact buffers, so it must be
   * exactly that value; absent, the Machine computes it.
   */
  readonly contactEstimate?: number;
}

/** Per-part visual flags for the renderer (PART_SYSTEM §5, first slice). */
export const PartFlagBits = { lit: 1, powered: 2, pressed: 4, dead: 8, armed: 16, broken: 32, fault: 64,
  /** B5 (M5, D105): the part carries the format's PartFlag.Tagged (BUZZ fetches it): the run-mode tag glyph. Never on critters. */
  tagged: 128 } as const;

export interface BodyInfo {
  readonly part: PartId;
  readonly type: string;
  /** 'piece': a body the part spawns, pre-built dormant (CORK BLASTER cork, GOTCHA BOX head; contract 3). */
  readonly role: 'base' | 'arm' | 'chunk' | 'rag' | 'piece';
  /** Chunks: index of the fracture piece. */
  readonly chunk?: number;
  /** Critter ragdoll capsules (role 'rag'): the `RAG__<bone>` name (contract 3). */
  readonly bone?: string;
}

export type BodyRole = 'base' | 'arm' | 'chunk' | 'rag' | 'piece';
interface BodyRt { readonly part: number; readonly role: BodyRole; readonly body: JoltModule; readonly dynamic: boolean; readonly ghost: boolean; readonly chunk?: number; readonly bone?: string }
interface PartRt {
  readonly id: PartId;
  readonly def: PartDef;
  readonly props: Props;
  readonly pos: Vec;
  readonly rot: Q;
  base: number;
  arm: number;
  hinge: JoltModule | null;
  readonly portIndex: ReadonlyMap<string, number>;
  /** B5 (M5): the snapshot's PartFlag bits (critters read PartFlag.Tagged: BUZZ's fetch list). */
  readonly flags: number;
  /** Pre-built fracture pieces (dormant until the part breaks, so rollback never creates bodies). */
  readonly chunks: number[];
}
interface Mortar { readonly a: number; readonly b: number; readonly constraint: JoltModule; readonly strength: number }
interface StaticBox { readonly part: number; readonly c: Vec; readonly rot: Q; readonly half: Vec }
interface End { readonly part: number; readonly port: PortDef }
interface LineRt { readonly link: number; readonly a: End; readonly b: End; readonly constraint: JoltModule; readonly sheave: number }
interface FuseRt { readonly link: number; readonly a: End | null; readonly b: End | null; readonly length: number; readonly pa: Vec; readonly pb: Vec; readonly mid: readonly Vec[] }

/** Everything that changes during a run and isn't Jolt state. Plain data: checkpointed by clone. */
interface State {
  tick: number;
  alive: boolean[];
  lit: boolean[];          // wick flame / bangstick fuse burning
  armedAt: number[];       // bangstick: tick its stub was lit (−1 = no)
  exposure: number[];      // heat exposure (s) per part receiver
  pressed: number[];       // sensor: ticks left showing pressed
  cooldown: number[];      // sensor cooldown ticks
  padMassWas: boolean[];   // stomp pad over threshold last tick
  mainsOn: boolean[];
  supply: number[];        // supply factor per consumer
  cut: boolean[];          // per line
  lineHeat: number[];      // per line
  fuse: number[][];        // per fuse: burnt intervals [s0, e0, s1, e1, ...] in metres
  fuseEndsDone: number[];  // per fuse: bit0 end A delivered, bit1 end B delivered
  pulses: number[];        // queued signal pulses: [part, portIdx, cause] triples for next tick's stage 2
  booms: number[];         // queued detonations: [dueTick, queuedTick, part, cause]
  fireballs: number[];     // [x, y, z, r, untilTick]
  beltSpeed: number[];     // treadway surface speed (m/s) per part
  broken: boolean[];       // breakables: replaced by their chunks
  burnAt: number[];        // planks: tick they caught fire (−1 = no)
  mortar: boolean[];       // per mortar joint: broken
  bandCut: boolean[];      // per belt: snipped
  lowSupply: number[];     // consumers: ticks below f 0.5 (brownout)
  stall: number[];         // motors: ticks stalled at full torque (jam)
  fault: boolean[];        // brownout or jam showing
  crit: CritWorld;         // critters and critter-bound devices (critters/state.ts)
  // events and causes (contract 1, SIMULATION §9; stream A)
  evId: number;            // next event id
  lastEv: number[];        // per part: its last causing event (contacts pass it on), −1 = none
  litCause: number[];      // per part: the event that lit it (wick, plank, bangstick stub), −1 = lit at start
  fuseCause: number[];     // per fuse: the event that lit it
  powerCause: number;      // the last power-topology change (mains flip, toggle, cell running flat)
  m2: M2State;             // M2 channels and parts (channels/host.ts; stream A)
  matter: MatterSt | null; // MI (M4): Matter layer state (matter/host.ts), null while Matter is off
}

/** `jolt`: a StateRecorderImpl in the WASM heap (S3), or bytes (an imported partner checkpoint). MI: `matter`, the Matter record. */
interface Checkpoint { readonly tick: number; readonly jolt: Uint8Array | JoltModule; readonly st: State; readonly matter?: MatterCp | undefined }

export class Machine {
  readonly tickRate: number;
  readonly bodies: BodyRt[] = [];
  readonly parts: PartRt[] = [];
  readonly links: readonly LinkRecord[];
  st: State;
  private readonly Jolt: JoltModule;
  private readonly jolt: JoltModule;
  private readonly system: JoltModule;
  private readonly bi: JoltModule;
  private readonly air: number;
  private readonly dt: number;
  private readonly byId = new Map<PartId, number>();
  private readonly lines: LineRt[] = [];
  private readonly fuses: FuseRt[] = [];
  private readonly signalOut = new Map<string, End[]>(); // `${part}:${port}` → receivers
  private readonly powerComp: number[] = [];               // part → component root
  private readonly gears: JoltModule[] = [];
  private readonly mortars: Mortar[] = [];
  private readonly bands: { readonly link: number; readonly a: End; readonly b: End; readonly constraint: JoltModule }[] = [];
  private readonly statics: StaticBox[] = [];
  private readonly shapeCache = new Map<string, JoltModule>();
  private readonly contacts: number[] = [];                // gathered after each step (10 numbers each)
  /** J4: the contact records Jolt's threads write during a step, and the body tables they read. */
  private readonly cbuf: ContactBuffer;
  private cbufBodies = 0;
  private readonly belts: number[] = [];                   // J4: TREADWAY base bodies (surface velocity each step)
  private readonly pokes = new Map<number, Poke[]>();
  private events: SimEvent[] = [];
  private readonly checkpoints: Checkpoint[] = [];
  /** S3: part indices the per-part stages visit (not INERT), parts with power, stomp pads; ascending. */
  private readonly busy: number[] = [];
  private readonly powerParts: number[] = [];
  private readonly pads: number[] = [];
  /** S3: any part that reads persisted contacts (TREADWAY, STOMP PAD, channel parts that ask)? */
  private persistAny = false;
  private readonly checkpointEvery: number;
  private readonly keepCheckpoints: number;
  private destroyed = false;
  private scratch: JoltModule = null;
  private readonly critters: CritterSystem;
  private readonly seed: readonly [number, number];
  /** M2 channels (stream A). They reach Machine internals through `ChannelHost` (channels/host.ts): keep those names in sync. */
  private readonly x: PartChannels;
  /** A3: Jolt's contact-constraint buffer and the most contact callbacks one step has made (diagnostics only). */
  private readonly maxContacts: number;
  private contactsThisStep = 0;
  private contactMax = 0;
  /** MI (M4): the Matter layer (contract 2). Part behaviours and critters use only this API. */
  readonly matter: MatterHost;
  /** MI (M4): environment set colliders as built (world space), for Matter's static proxies. */
  private readonly envBoxes: { readonly center: readonly number[]; readonly half: readonly number[] }[] = [];
  private readonly envSpheres: { readonly center: readonly number[]; readonly radius: number }[] = [];
  /** W5 (M5): the Hangar's zero-g zones while env.zones is on (else empty), the world's gravity (m/s²), and whether
   *  the hash carries the zones flag (only in environments that have zones, so no older golden moves). */
  private zeroG: readonly SpaceZone[] = [];
  private gWorld = G;
  private zonesHash: -1 | 0 | 1 = -1;
  /** W5 (M5, D26): the run's global wind (null = none, the hash then doesn't carry it) and its last speed (m/s). */
  private wind: WindRun | null = null;
  windNow = 0;

  /**
   * A3: the busiest step's contact count against Jolt's contact buffer. Near or over 1 the buffer may have
   * overflowed, and Jolt drops contacts in an order SaveState doesn't record, so rollback can't be guaranteed exact
   * (buffers are sized at 1.5× the start-state estimate, so this takes a world denser than it began, past 2^20).
   */
  get contactPeak(): { count: number; capacity: number } { return { count: this.contactMax, capacity: this.maxContacts }; }

  /** A reused Jolt Vec3 (Jolt copies arguments, so reuse is safe and leaks nothing per call). */
  private v3(x: number, y: number, z: number): JoltModule {
    this.scratch.Set(f32(x), f32(y), f32(z));
    return this.scratch;
  }

  constructor(Jolt: JoltModule, world: { readonly parts: readonly PartRecord[]; readonly links?: readonly LinkRecord[] }, opts: MachineOptions = {}) {
    this.Jolt = Jolt;
    this.tickRate = opts.tickRate ?? 120;
    this.dt = 1 / this.tickRate;
    this.air = (opts.airPercent ?? 100) / 100;
    // S3: big worlds checkpoint every 2 s and keep fewer (each holds every body: ~134 B per body), so the rollback
    // window stays ≥ 6 s while checkpoint memory stays under ~0.5 GB; worlds under 20k parts are unchanged
    const plan = checkpointPlan(world.parts.length);
    this.checkpointEvery = opts.checkpointEvery ?? plan.every;
    this.keepCheckpoints = opts.keepCheckpoints ?? plan.keep;
    const settings = new Jolt.JoltSettings();
    // S3 (M3 scale): capacities grow with the world (Domino Day's 100k tiles, 1M-part worlds); ≥ the M2 values
    // A3: the contact buffers cover the world's start-state contact estimate (capacity.ts): overflowing them made
    // rollback diverge on big brick stacks (S3 M3 finding 1)
    const cap = joltCapacity(world.parts.length, world.parts.length * 2 + 64, opts.contactEstimate ?? contactEstimate(world.parts)); // SIMFIX: once per start
    this.maxContacts = cap.maxContacts;
    settings.mMaxBodies = cap.maxBodies;
    settings.mMaxBodyPairs = cap.maxBodyPairs;
    settings.mMaxContactConstraints = cap.maxContacts;
    // Jolt takes the contact buffer (≈ 496 B per contact) from its temp allocator every step; JoltJS sizes that
    // at 10 MB through a JoltSettings field its IDL doesn't bind (mTempAllocatorSize, offset 12, after the three
    // capacities: checked against the struct's defaults). Above 16k contacts, write it directly.
    if (cap.tempBytes > 10485760) Jolt.HEAPU32[(Jolt.getPointer(settings) + 12) >> 2] = cap.tempBytes;
    // J4 (M4): Jolt's job threads (the threaded build's module says how many unless the options do), and the
    // buffered contact path they need, made before the JoltInterface starts them (contactbuf.ts)
    const threads = opts.workerThreads ?? joltThreads(Jolt);
    if (threads !== undefined) settings.mMaxWorkerThreads = threads;
    this.cbuf = new ContactBuffer(Jolt, cap.maxContacts + 1024);
    const pairs = new Jolt.ObjectLayerPairFilterTable(3);
    pairs.EnableCollision(L_STATIC, L_MOVING);
    pairs.EnableCollision(L_MOVING, L_MOVING);
    const bpi = new Jolt.BroadPhaseLayerInterfaceTable(3, 2);
    bpi.MapObjectToBroadPhaseLayer(L_STATIC, new Jolt.BroadPhaseLayer(0));
    bpi.MapObjectToBroadPhaseLayer(L_MOVING, new Jolt.BroadPhaseLayer(1));
    bpi.MapObjectToBroadPhaseLayer(L_GHOST, new Jolt.BroadPhaseLayer(1));
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = bpi;
    settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairs, 3);
    this.jolt = new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);
    this.system = this.jolt.GetPhysicsSystem();
    this.system.SetGravity(new Jolt.Vec3(0, f32(-G * (opts.gravityPercent ?? 100) / 100), 0));
    this.bi = this.system.GetBodyInterface();
    this.scratch = new Jolt.Vec3(0, 0, 0);
    this.installContactListener();
    this.seed = opts.seed ?? [0x9e3779b9, 0x7f4a7c15];
    this.critters = new CritterSystem(this.critterHost(opts.extraLures ?? []));
    this.wind = windRun(opts.wind, this.air, this.seed); // W5 (M5, D26)
    this.gWorld = f32((G * (opts.gravityPercent ?? 100)) / 100); // W5 (M5): Jolt's own (f32) gravity (zones, wind wake-ups)
    this.x = new PartChannels(this as unknown as ChannelHost);
    // MI (M4); X5 (D104): grains follow the world's gravity % and its zero-g zones
    this.matter = new MatterHost(this as unknown as MatterMachine, opts.simFlags, opts.matter, { environment: opts.environment, preset: opts.preset, gravityPercent: opts.gravityPercent, zones: opts.zones });

    // Floor: the Studio ground plane (environment collision arrives with environments). S3: sized by the
    // preset (Megastructure is 1 km across); presets that fit the M2 400 m floor keep it exactly.
    const fh = Math.max(200, presetOf(opts.preset).floorHalf);
    // W5 (M5): ORBITAL HANGAR / MOON BASE: the catch-all floor drops below the set (the deck or regolith is the surface)
    const space = spaceSetPlan(opts.environment, opts.preset);
    const floorTop = space ? space.floorTop : 0;
    this.addBody(new Jolt.BoxShape(new Jolt.Vec3(fh, 0.5, fh), 0.05, null), [0, floorTop - 0.5, 0], [0, 0, 0, 1], false, false, 0.7, 0.1, 0, false, 1, -1);
    // S3: Backlot terrain (a deterministic HeightFieldShape per 32 m chunk, terrain.ts) above the floor
    if (opts.terrain) buildTerrain(Jolt, this.bi, opts.terrain, L_STATIC);
    if (opts.environment === 'kitchen') this.buildKitchen(opts.preset ?? 'room');
    else if (opts.environment === 'tinker') this.buildTinker(opts.preset ?? 'room', world.parts.some((p) => p.type === 'mochi'));
    // S3: THE BACKLOT: no cove; its dressing colliders on the Arena lot (E3b's placements, env_backlot.ts)
    // J4 (M4): and on the Megastructure lot (the same placements seated on its ground, env_backlot.ts)
    else if (opts.environment === 'backlot') { if (opts.preset === 'arena') this.buildSet(BACKLOT.arena); else if (opts.preset === 'megastructure') this.buildSet(BACKLOT.megastructure); }
    else if (space) {
      // W5 (M5): the set (deck, walls, shuttles / apron, lander, dome), the Moon's regolith heightfield, the zero-g zones
      this.buildSet(space.set);
      if (space.field) buildSpaceTerrain(Jolt, this.bi, space.field, space.holes, L_STATIC);
      this.gWorld = f32((G * (opts.gravityPercent ?? 100)) / 100); // Jolt's own (f32) gravity, so the zones cancel it exactly
      if (space.zones.length) { this.zonesHash = opts.zones === false ? 0 : 1; if (opts.zones !== false) this.zeroG = space.zones; }
    }
    else if (opts.preset) this.buildCove(opts.preset);

    // Canonical order: ascending id (SIMULATION §3).
    const sorted = [...world.parts].sort((a, b) => a.id - b.id);
    this.bigBuild = sorted.length > BIG_WORLD;
    for (const p of sorted) {
      const def = partDef(p.type);
      if (!def) continue; // unknown types are inert placeholders
      this.buildPart(p, def);
    }
    this.bigBuild = false;
    for (const m of this.bcsCache.values()) for (const cs of m.values()) Jolt.destroy(cs);
    this.bcsCache.clear();
    this.links = [...(world.links ?? [])].sort((a, b) => a.id - b.id);
    const n = this.parts.length;
    // S3: per-part stage loops skip inert parts (plain rigid bodies with no ports or behaviour): Domino Day's
    // 100k tiles and a 1M-part world cost the per-tick stages nothing. Ascending order is kept.
    this.parts.forEach((p, i) => {
      if (!INERT.has(p.def.type)) this.busy.push(i);
      if (p.def.power) this.powerParts.push(i);
      if (p.def.type === 'stomp_pad') this.pads.push(i);
      if (p.def.type === 'treadway' || p.def.type === 'stomp_pad' || this.x.wantsPersisted(p.def.type)) this.persistAny = true;
    });
    this.st = {
      tick: 0, alive: new Array<boolean>(n).fill(true), lit: this.parts.map((p) => p.def.type === 'wick' && (p.props.lit ?? 1) === 1),
      armedAt: new Array<number>(n).fill(-1), exposure: new Array<number>(n).fill(0), pressed: new Array<number>(n).fill(0),
      cooldown: new Array<number>(n).fill(0), padMassWas: new Array<boolean>(n).fill(false),
      mainsOn: this.parts.map((p) => p.def.type === 'mains' && (p.props.on ?? 1) === 1), supply: new Array<number>(n).fill(0),
      cut: [], lineHeat: [], fuse: [], fuseEndsDone: [], pulses: [], booms: [], fireballs: [], beltSpeed: new Array<number>(n).fill(0),
      broken: new Array<boolean>(n).fill(false), burnAt: new Array<number>(n).fill(-1), mortar: [], bandCut: [],
      lowSupply: new Array<number>(n).fill(0), stall: new Array<number>(n).fill(0), fault: new Array<boolean>(n).fill(false),
      crit: emptyCritWorld(),
      evId: 0, lastEv: new Array<number>(n).fill(-1), litCause: new Array<number>(n).fill(-1), fuseCause: [], powerCause: -1, m2: createM2State(n),
      matter: null, // MI (M4): filled by matter.init()
    };
    this.matter.init(); // MI (M4): st.matter (before critters and channels register containers and intakes)
    this.buildLinks();
    this.buildGearMeshes();
    this.buildMortar();
    this.buildStatics();
    this.critters.init(); // critters: bind to devices, seed state (needs parts, links and st)
    this.x.init(); // M2 channels: cell charge, timers, toggle topology
    this.system.OptimizeBroadPhase();
    // the start state is a checkpoint too, so a poke late inside the first half-second can roll back
    if (this.checkpointEvery > 0) this.checkpoint();
  }

  // ---- building ------------------------------------------------------------------------------------

  /** The Studio cyclorama's walls: each straight wall's quarter-circle cove and vertical part as boxes. */
  private buildCove(preset: string): void {
    const cove = studioCove(preset);
    if (!cove) return;
    const J = this.Jolt;
    const cs = new J.StaticCompoundShapeSettings();
    const prof = coveProfile(cove.radius, 6);
    prof.push([0, cove.height]);
    let k = 0;
    for (const w of cove.walls) {
      const t = vnorm(vsub(w.b, w.a));
      const len = vlen(vsub(w.b, w.a));
      const mid = vscale(vadd(w.a, w.b), 0.5);
      for (let i = 1; i < prof.length; i++) {
        const [d0, h0] = prof[i - 1]!, [d1, h1] = prof[i]!;
        const p0 = vadd(vadd(mid, vscale(w.n, d0)), [0, h0, 0]);
        const p1 = vadd(vadd(mid, vscale(w.n, d1)), [0, h1, 0]);
        const along = vnorm(vsub(p1, p0));
        const up = vcross(t, along); // surface normal, facing the set (walls run so this points inward)
        const thick = 0.2;
        const c = vadd(vscale(vadd(p0, p1), 0.5), vscale(up, -thick / 2));
        const q = quatFromBasis(t, up, vscale(along, -1)); // right-handed: z = x × y
        cs.AddShape(new J.Vec3(f32(c[0]), f32(c[1]), f32(c[2])), new J.Quat(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])),
          new J.BoxShapeSettings(new J.Vec3(f32(len / 2 + 0.05), f32(thick / 2), f32(vlen(vsub(p1, p0)) / 2 + 0.01)), f32(0.01)), k++);
      }
    }
    const shape = cs.Create().Get();
    const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, L_STATIC);
    bcs.mFriction = f32(0.7);
    bcs.mRestitution = f32(0.1);
    bcs.mUserData = 0x7fffffff;
    const body = this.bi.CreateBody(bcs);
    J.destroy(bcs);
    this.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
  }

  /**
   * The Mega Kitchen set (environments.md §2): its generated static boxes and spheres (parts-data env_kitchen.ts),
   * one static compound body per physics material so each keeps its friction and restitution. Presets other
   * than the two the set is built for use the Room layout.
   */
  private buildKitchen(preset: string): void {
    this.buildSet(preset === 'warehouse' ? KITCHEN.presets.warehouse : KITCHEN.presets.room);
  }

  /**
   * THE TINKER LAB (environments.md §3, D78/D82): its generated colliders for the Desk or Room preset (others use
   * the Room layout). The ambient sleeping MOCHI's capsule collides only while the world has no MOCHI part
   * (it's a display copy, hidden when a real one exists).
   */
  private buildTinker(preset: string, hasMochi: boolean): void {
    const set = preset === 'desk' ? TINKER.presets.desk : TINKER.presets.room;
    const m = set.mochi;
    const extra = hasMochi ? [] : [{ name: 'ambient_mochi', center: m.capsule.center, radius: m.capsule.radius, phys: m.phys }];
    this.buildSet({ boxes: set.boxes, spheres: [...set.spheres, ...extra] });
  }

  /** A static set: boxes and spheres grouped into one static compound body per physics material (D75). */
  private buildSet(set: { readonly boxes: readonly SetBox[]; readonly spheres: readonly SetSphere[]; readonly hulls?: readonly SetHull[] }): void {
    const J = this.Jolt;
    const mats: readonly SetPhys[] = ['powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric', 'concrete', 'regolith'];
    const surface: Record<SetPhys, readonly [number, number]> = {
      powder: [0.5, 0.3], wood: [0.5, 0.35], ceramic: [0.4, 0.2], steel: [0.4, 0.2],
      glass: [0.3, 0.2], rubber: [0.9, 0.6], paper: [0.6, 0.1], fabric: [0.8, 0.1],
      concrete: [0.75, 0.1], regolith: [0.8, 0.05], // W5 (M5): environment ground (SIMULATION §4.3)
    };
    for (const b of set.boxes) this.envBoxes.push({ center: b.center, half: b.half }); // MI (M4): Matter static proxies
    for (const s of set.spheres) this.envSpheres.push({ center: s.center, radius: s.radius });
    for (const m of mats) {
      const boxes = set.boxes.filter((b) => b.phys === m), spheres = set.spheres.filter((s) => s.phys === m);
      const hulls = (set.hulls ?? []).filter((c) => c.phys === m); // W5 (M5)
      if (!boxes.length && !spheres.length && !hulls.length) continue;
      const cs = new J.StaticCompoundShapeSettings();
      let k = 0;
      for (const b of boxes) {
        const r = Math.min(0.01, b.half[0] * 0.5, b.half[1] * 0.5, b.half[2] * 0.5);
        cs.AddShape(new J.Vec3(f32(b.center[0]), f32(b.center[1]), f32(b.center[2])), new J.Quat(0, 0, 0, 1),
          new J.BoxShapeSettings(new J.Vec3(f32(b.half[0]), f32(b.half[1]), f32(b.half[2])), f32(r)), k++);
      }
      for (const s of spheres) {
        cs.AddShape(new J.Vec3(f32(s.center[0]), f32(s.center[1]), f32(s.center[2])), new J.Quat(0, 0, 0, 1), new J.SphereShapeSettings(f32(s.radius)), k++);
      }
      for (const hl of hulls) { // W5 (M5): world-space points, in the order the data lists them
        const hs = new J.ConvexHullShapeSettings();
        for (const q of hl.points) hs.mPoints.push_back(new J.Vec3(f32(q[0]), f32(q[1]), f32(q[2])));
        hs.mMaxConvexRadius = f32(0.01);
        cs.AddShape(new J.Vec3(0, 0, 0), new J.Quat(0, 0, 0, 1), hs, k++);
      }
      const shape = cs.Create().Get();
      const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, L_STATIC);
      bcs.mFriction = f32(surface[m][0]);
      bcs.mRestitution = f32(surface[m][1]);
      bcs.mUserData = 0x7fffffff;
      const body = this.bi.CreateBody(bcs);
      J.destroy(bcs);
      this.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
    }
  }

  private buildPart(p: PartRecord, def: PartDef): void {
    const props = this.propsOf(p, def);
    const pos: Vec = [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
    const rot = rotationToQuat(p.rot) as Q;
    const idx = this.parts.length;
    // S3: one port map per type (read-only), not one per part
    let portIndex = this.portMaps.get(def);
    if (!portIndex) { portIndex = new Map(def.ports.map((pt, i) => [pt.name, i])); this.portMaps.set(def, portIndex); }
    const rt: PartRt = { id: p.id, def, props, pos, rot, base: -1, arm: -1, hinge: null, portIndex, chunks: [], flags: p.flags }; // B5 (M5): flags
    this.parts.push(rt);
    this.byId.set(p.id, idx);
    if (def.critter) { this.critters.buildCritter(idx); return; } // capsule + dormant ragdoll (critters/)
    const shapes = def.shapes(props);
    const baseShapes = shapes.filter((s) => (s.on ?? 'base') === 'base');
    const armShapes = shapes.filter((s) => s.on === 'arm');
    const anchored = (p.flags & 32) !== 0;
    const dynamic = def.body.kind === 'dynamic' && !anchored;
    // S3: parts with default props share one key string per type (JSON per part was a measurable slice of a 1M build)
    let key = p.props?.length ? undefined : this.defaultKey.get(def);
    if (key === undefined) {
      key = `${def.type}:${JSON.stringify(props)}`;
      if (!p.props?.length) this.defaultKey.set(def, key);
    }
    if (baseShapes.length) {
      // X5 (M5): body.com moves the centre of mass (QUACK's keel)
      const baseShape = def.body.com ? this.comShape(`${key}:base`, this.shapeFor(`${key}:base`, baseShapes), def.body.com) : this.shapeFor(`${key}:base`, baseShapes);
      rt.base = this.addBody(baseShape, pos, rot, dynamic, false, def.body.friction, def.body.restitution,
        def.body.mass, def.body.ccd ?? false, def.body.gravityFactor ?? 1, idx, 'base', def.type === 'topple_tile');
    } else {
      // a hinge needs something to hang on: an invisible static pin
      rt.base = this.addBody(this.shapeFor('pin', [{ kind: 'sphere', size: [0.002, 0.002, 0.002] }]), pos, rot, false, true, 0.5, 0, 0, false, 1, idx, 'base');
    }
    if (def.hinge) {
      const h = def.hinge;
      const armMass = h.armMassFor ? h.armMassFor(props) : h.armMass;
      const armShape = armShapes.length ? armShapes : [{ kind: 'sphere' as const, size: [0.02, 0.02, 0.02] as const }];
      rt.arm = this.addBody(this.shapeFor(`${key}:arm`, armShape), pos, rot, true, h.ghostArm ?? false, def.body.friction, def.body.restitution,
        armMass, false, 1, idx, 'arm');
      const J = this.Jolt;
      const s = new J.HingeConstraintSettings();
      const at = vadd(pos, qrot(rot, h.at));
      const axis = vnorm(qrot(rot, h.axis));
      const normal = vnorm(qrot(rot, Math.abs(h.axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      s.mPoint1 = s.mPoint2 = new J.RVec3(f32(at[0]), f32(at[1]), f32(at[2]));
      s.mHingeAxis1 = s.mHingeAxis2 = new J.Vec3(f32(axis[0]), f32(axis[1]), f32(axis[2]));
      s.mNormalAxis1 = s.mNormalAxis2 = new J.Vec3(f32(normal[0]), f32(normal[1]), f32(normal[2]));
      if (h.limits) { s.mLimitsMin = f32((h.limits[0] * Math.PI) / 180); s.mLimitsMax = f32((h.limits[1] * Math.PI) / 180); }
      if (def.type === 'motor') {
        const m = s.mMotorSettings;
        m.mMinTorqueLimit = f32(-30); m.mMaxTorqueLimit = f32(30);
      }
      if (def.type === 'cog' || def.type === 'treadway') s.mMaxFrictionTorque = f32(0.02);
      const c = s.Create(this.bodies[rt.base]!.body, this.bodies[rt.arm]!.body);
      J.destroy(s);
      this.system.AddConstraint(c);
      rt.hinge = J.castObject(c, J.HingeConstraint);
      if (def.type === 'motor') rt.hinge.SetMotorState(J.EMotorState_Velocity);
    }
    this.x.onBuild(idx); // M2: pre-built pieces (cork, head), sliders (punchline)
    // PLANK breaks in two (burn-through or a hard hit): both halves exist from the start, dormant
    // generated fracture chunks (FISHBOWL; ASSET_PIPELINE §7): convex hulls in part space, all dormant from the start (D66).
    // Each body sits at the part pose, so its part-space mesh draws at the body's transform; Jolt finds the hull's COM.
    const frac = fracOf(def.type);
    if (frac && dynamic) {
      const J = this.Jolt;
      frac.chunks.forEach((c, k) => {
        const s = new J.ConvexHullShapeSettings();
        for (const h of c.hull) s.mPoints.push_back(new J.Vec3(f32(h[0]), f32(h[1]), f32(h[2])));
        s.mMaxConvexRadius = f32(0.002);
        const shape = s.Create().Get();
        J.destroy(s);
        rt.chunks.push(this.addBody(shape, pos, rot, true, true, def.body.friction, def.body.restitution,
          Math.max(0.01, frac.mass * c.massShare), false, 0, idx, 'chunk', true, k));
      });
    }
    if (def.type === 'plank' && dynamic) {
      const box = shapes[0]!;
      const half: [number, number, number] = [box.size[0], box.size[1], box.size[2] / 2];
      for (const k of [0, 1]) {
        const at = qrot(rot, [0, 0, (k === 0 ? -1 : 1) * half[2] / 2]);
        rt.chunks.push(this.addBody(this.shapeFor(`plank-half:${half.join(',')}`, [{ kind: 'box', size: half }]), vadd(pos, at), rot, true, true,
          def.body.friction, def.body.restitution, def.body.mass / 2, false, 0, idx, 'chunk', true, k));
      }
    }
  }

  /**
   * X5 (M5): `inner` with its centre of mass moved by `com` (PartDef body.com), cached like shapeFor's. Held with an
   * extra reference so it outlives any one body (shapeFor's shapes are held by their leaked settings' results).
   */
  private comShape(key: string, inner: JoltModule, com: readonly number[]): JoltModule {
    const k = `${key}:com`;
    const hit = this.shapeCache.get(k);
    if (hit) return hit;
    const J = this.Jolt;
    const shape = new J.OffsetCenterOfMassShape(inner, new J.Vec3(f32(com[0]!), f32(com[1]!), f32(com[2]!)));
    shape.AddRef();
    this.shapeCache.set(k, shape);
    return shape;
  }

  private shapeFor(key: string, shapes: readonly ShapeDef[]): JoltModule {
    const hit = this.shapeCache.get(key);
    if (hit) return hit;
    const J = this.Jolt;
    const one = (s: ShapeDef): JoltModule => {
      const cr = (min: number): number => f32(Math.min(0.004, min * 0.2));
      switch (s.kind) {
        case 'sphere': return new J.SphereShapeSettings(f32(s.size[0] / 2));
        case 'box': return new J.BoxShapeSettings(new J.Vec3(f32(s.size[0] / 2), f32(s.size[1] / 2), f32(s.size[2] / 2)), cr(Math.min(s.size[0], s.size[1], s.size[2]) / 2));
        case 'cylinder': return new J.CylinderShapeSettings(f32(s.size[1] / 2), f32(s.size[0] / 2), cr(Math.min(s.size[0], s.size[1]) / 2));
        case 'capsule': return new J.CapsuleShapeSettings(f32(Math.max(0.001, (s.size[1] - s.size[0]) / 2)), f32(s.size[0] / 2));
      }
    };
    const local = (s: ShapeDef): Q => {
      let q: Q = [0, 0, 0, 1];
      const h = Math.SQRT1_2;
      if (s.axis === 'x') q = [0, 0, -h, h]; // Y → X
      if (s.axis === 'z') q = [h, 0, 0, h]; // Y → Z
      if (s.tiltZ) q = qmul(tiltQuat(s.tiltZ), q);
      if (s.rot) q = qmul(s.rot, q); // M2: arbitrary rotations (funnel staves, pitched blades)
      return q;
    };
    let shape: JoltModule;
    const s0 = shapes[0]!;
    if (shapes.length === 1 && !s0.at && !s0.axis && !s0.tiltZ && !s0.rot) {
      shape = one(s0).Create().Get();
    } else {
      const cs = new J.StaticCompoundShapeSettings();
      shapes.forEach((s, i) => {
        const at = s.at ?? [0, 0, 0];
        const q = local(s);
        cs.AddShape(new J.Vec3(f32(at[0]), f32(at[1]), f32(at[2])), new J.Quat(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])), one(s), i);
      });
      shape = cs.Create().Get();
    }
    this.shapeCache.set(key, shape);
    return shape;
  }

  private addBody(shape: JoltModule, p: readonly number[], q: readonly number[], dynamic: boolean, ghost: boolean, friction: number, restitution: number,
    mass: number, ccd: boolean, gravityFactor: number, part: number, role: BodyRole = 'base', asleep = false, chunk?: number): number {
    const J = this.Jolt;
    const layer = ghost ? L_GHOST : dynamic ? L_MOVING : L_STATIC;
    // S3: reused position/rotation (BodyCreationSettings copies them; a fresh pair per body leaked 32 B each into
    // the Jolt heap, 64 MB on a 1M-part world)
    this.bcsPos ??= new J.RVec3(0, 0, 0);
    this.bcsRot ??= new J.Quat(0, 0, 0, 1);
    this.bcsPos.Set(f32(p[0]!), f32(p[1]!), f32(p[2]!));
    this.bcsRot.Set(f32(q[0]!), f32(q[1]!), f32(q[2]!), f32(q[3]!));
    // S3: big worlds reuse one settings object per (shape, motion, layer), every field set below each time, instead
    // of a fresh one per body (half the JS↔WASM object churn of a 1M-part build); small worlds as before
    let cs: JoltModule;
    let reused = false;
    if (this.bigBuild && part >= 0) {
      let byShape = this.bcsCache.get(shape);
      if (!byShape) { byShape = new Map(); this.bcsCache.set(shape, byShape); }
      const k = layer * 2 + (dynamic ? 1 : 0);
      cs = byShape.get(k);
      if (!cs) { cs = new J.BodyCreationSettings(shape, this.bcsPos, this.bcsRot, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, layer); byShape.set(k, cs); }
      else { cs.mPosition = this.bcsPos; cs.mRotation = this.bcsRot; }
      cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateMassAndInertia;
      cs.mMotionQuality = J.EMotionQuality_Discrete;
      reused = true;
    } else cs = new J.BodyCreationSettings(shape, this.bcsPos, this.bcsRot, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, layer);
    cs.mFriction = f32(friction);
    cs.mRestitution = f32(restitution);
    cs.mGravityFactor = f32(gravityFactor);
    const index = this.bodies.length;
    cs.mUserData = part >= 0 ? index : 0x7fffffff; // the floor has no BodyRt
    if (dynamic) {
      if (mass > 0) {
        cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
        cs.mMassPropertiesOverride.mMass = f32(mass);
      }
      if (ccd) cs.mMotionQuality = J.EMotionQuality_LinearCast;
    }
    const body = this.bi.CreateBody(cs);
    if (!reused) J.destroy(cs);
    this.bi.AddBody(body.GetID(), dynamic && !asleep ? J.EActivation_Activate : J.EActivation_DontActivate);
    if (part >= 0) this.bodies.push({ part, role, body, dynamic, ghost: ghost && role !== 'chunk', ...(chunk !== undefined ? { chunk } : {}) });
    else this.floor = body;
    return part >= 0 ? index : -1;
  }
  private floor: JoltModule = null;
  private readonly defaultKey = new Map<PartDef, string>();
  private bcsPos: JoltModule = null;
  private bcsRot: JoltModule = null;
  /** S3: set while a big world builds its parts (addBody reuses creation settings); emptied after. */
  private bigBuild = false;
  private readonly bcsCache = new Map<JoltModule, Map<number, JoltModule>>();

  private end(link: LinkRecord, which: 'from' | 'to'): End | null {
    const e = link[which];
    if (!e) return null;
    const part = this.byId.get(e.part);
    if (part === undefined) return null;
    const port = this.parts[part]!.def.ports[e.port];
    return port ? { part, port } : null;
  }

  /** World position of a port, from its body's current pose. */
  portWorld(e: End): Vec {
    const p = this.parts[e.part]!;
    const bi = e.port.on === 'arm' && p.arm >= 0 ? p.arm : p.base;
    const b = this.bodies[bi]!.body;
    const pos = b.GetPosition(), r = b.GetRotation();
    return vadd([pos.GetX(), pos.GetY(), pos.GetZ()], qrot([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], e.port.at));
  }

  private bodyOf(e: End): JoltModule {
    const p = this.parts[e.part]!;
    return this.bodies[e.port.on === 'arm' && p.arm >= 0 ? p.arm : p.base]!.body;
  }

  private buildLinks(): void {
    const J = this.Jolt;
    const uf = this.parts.map((_, i) => i);
    const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]!]!; x = uf[x]!; } return x; };
    const sheaveHalf = new Map<string, { link: number; other: End | null; sheave: number }>();
    this.links.forEach((l, li) => {
      const a = this.end(l, 'from'), b = this.end(l, 'to');
      switch (l.kind) {
        case 'cable_signal': {
          if (!a || !b) return;
          // orient source → receiver regardless of which end the player clicked first
          const [src, dst] = a.port.dir === 'in' ? [b, a] : [a, b];
          const k = `${src.part}:${src.port.name}`;
          const list = this.signalOut.get(k) ?? [];
          list.push(dst);
          this.signalOut.set(k, list);
          return;
        }
        case 'cable_power': {
          if (!a || !b) return;
          uf[find(a.part)] = find(b.part);
          return;
        }
        case 'fuse': {
          // a fuse runs port → waypoints → port; a free end is its first/last waypoint
          const pts = l.points.map((q) => q.map(posToMetres) as Vec);
          const pa = a ? this.portWorld(a) : pts.shift() ?? [0, 0, 0];
          const pb = b ? this.portWorld(b) : pts.pop() ?? pa;
          const path = [pa, ...pts, pb];
          let len = 0;
          for (let k = 1; k < path.length; k++) len += vlen(vsub(path[k]!, path[k - 1]!));
          const length = Math.max(0.05, l.length > 0 ? posToMetres(l.length) : len);
          this.fuses.push({ link: li, a, b, length, pa, pb, mid: pts });
          this.st.fuse.push([]);
          this.st.fuseEndsDone.push(0);
          this.st.fuseCause.push(-1);
          return;
        }
        case 'line': case 'chain': case 'bungee': {
          if (!a || !b) return;
          // a line touching a sheave's axle pairs up with the sheave's other line into one pulley rope
          const aSheave = a.port.name === 'axle' && this.parts[a.part]!.def.type === 'sheave';
          const bSheave = b.port.name === 'axle' && this.parts[b.part]!.def.type === 'sheave';
          if (aSheave !== bSheave) {
            const sh = aSheave ? a : b, other = aSheave ? b : a;
            const key = `${sh.part}`;
            const half = sheaveHalf.get(key);
            if (!half) { sheaveHalf.set(key, { link: li, other, sheave: sh.part }); return; }
            sheaveHalf.delete(key);
            this.addPulley(half.link, half.other!, other, sh);
            return;
          }
          this.addLine(li, a, b);
          return;
        }
        case 'tube': case 'tube_slim': this.buildTube(l); return;
        case 'gutter': case 'gutter_slim': this.x.buildGutter(l); return; // M2 (channels/gutter.ts)
        case 'glidepath': this.x.buildGlidepath(l); return; // M3 (channels/glidepath.ts)
        case 'band': case 'band_crossed': {
          if (!a || !b) return;
          const ha = this.parts[a.part]!.hinge, hb = this.parts[b.part]!.hinge;
          if (!ha || !hb) return;
          // pulleys on both axles are the same size: 1:1, same way round (crossed: reversed)
          const c = this.addGear(a.part, b.part, 1, l.kind !== 'band_crossed');
          this.bands.push({ link: li, a, b, constraint: c });
          this.st.bandCut.push(false);
          return;
        }
        default:
      }
    });
    // a sheave with only one line: treat it as a fixed hook at the axle
    for (const half of sheaveHalf.values()) if (half.other) this.addLine(half.link, half.other, { part: half.sheave, port: this.parts[half.sheave]!.def.ports[0]! });
    this.parts.forEach((_, i) => { this.powerComp[i] = find(i); });
    void J;
  }

  /** Current fuse path: its ends follow their ports; waypoints are fixed in the world. */
  private fusePath(f: FuseRt): Vec[] {
    return [f.a ? this.portWorld(f.a) : f.pa, ...f.mid, f.b ? this.portWorld(f.b) : f.pb];
  }

  /**
   * TUBE (frame.md): a static clear tube swept along the link's path. Collision is a ring of 12
   * staves per segment around the bore (diameter 0.288 m, slim 0.110 m); segments overlap a little
   * so balls roll smoothly through bends.
   */
  private buildTube(l: LinkRecord): void {
    const J = this.Jolt;
    const pts = roundPath(l.points.map((q) => q.map(posToMetres) as Vec), l.kind === 'tube_slim' ? 0.12 : 0.3);
    if (pts.length < 2) return;
    const slim = l.kind === 'tube_slim';
    const rBore = slim ? 0.055 : 0.144, wall = slim ? 0.005 : 0.006, n = 12;
    const cs = new J.StaticCompoundShapeSettings();
    let count = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!, b = pts[k]!;
      const d = vsub(b, a);
      const len = vlen(d);
      if (len < 1e-4) continue;
      const qy = fromTo([0, 1, 0], vscale(d, 1 / len));
      const mid = vscale(vadd(a, b), 0.5);
      const staveW = ((2 * Math.PI * (rBore + wall / 2)) / n) * 1.08;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const q = qmul(qy, [0, dsin(ang / 2), 0, dcos(ang / 2)]);
        const at = vadd(mid, qrot(q, [0, 0, rBore + wall / 2]));
        cs.AddShape(new J.Vec3(f32(at[0]), f32(at[1]), f32(at[2])), new J.Quat(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])),
          new J.BoxShapeSettings(new J.Vec3(f32(staveW / 2), f32(len / 2 + 0.02), f32(wall / 2)), f32(0.001)), count++);
      }
    }
    if (!count) return;
    const shape = cs.Create().Get();
    const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, L_STATIC);
    bcs.mFriction = f32(0.25);
    bcs.mRestitution = f32(0.4);
    bcs.mUserData = 0x7fffffff;
    const body = this.bi.CreateBody(bcs);
    J.destroy(bcs);
    this.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
  }

  /**
   * BRIK mortar (frame.md): every pair of bricks laid face to face gets a fixed joint that breaks
   * above the weaker brick's mortar impulse (default 12 N·s). Bricks are built in id order, so
   * joints are too.
   */
  private buildMortar(): void {
    const J = this.Jolt;
    const bricks = this.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.def.type === 'brik');
    const boxes = bricks.map(({ i }) => this.boxOf(i));
    // S3: candidates from a uniform grid (cell ≥ the largest brick box, so touching boxes are in neighbouring
    // cells) instead of every pair: O(n) for a 1M-part world's bricks. Each x still tests its y > x in ascending
    // order, so the joints and their creation order are exactly the all-pairs ones.
    let cell = 0.05;
    for (const b of boxes) for (let k = 0; k < 3; k++) cell = Math.max(cell, b.max[k]! - b.min[k]! + 0.01);
    const grid = new Map<number, number[]>();
    const cellOf = (b: { min: Vec; max: Vec }, k: number): number => Math.floor((b.min[k]! + b.max[k]!) / 2 / cell);
    const keyOf = (x: number, y: number, z: number): number => ((x + 10000) * 20000 + (y + 10000)) * 20000 + (z + 10000);
    boxes.forEach((b, i) => {
      const key = keyOf(cellOf(b, 0), cellOf(b, 1), cellOf(b, 2));
      const list = grid.get(key);
      if (list) list.push(i); else grid.set(key, [i]);
    });
    for (let x = 0; x < bricks.length; x++) {
      const cand: number[] = [];
      const cx = cellOf(boxes[x]!, 0), cy = cellOf(boxes[x]!, 1), cz = cellOf(boxes[x]!, 2);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const y of grid.get(keyOf(cx + dx, cy + dy, cz + dz)) ?? []) if (y > x) cand.push(y);
      }
      cand.sort((a, b) => a - b);
      for (const y of cand) {
        const A = boxes[x]!, B = boxes[y]!;
        let touch = -1, ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const gap = Math.max(A.min[k]! - B.max[k]!, B.min[k]! - A.max[k]!);
          if (gap > 0.004) ok = false;
          else if (gap > -0.004) { if (touch >= 0) ok = false; else touch = k; }
          else if (Math.min(A.max[k]!, B.max[k]!) - Math.max(A.min[k]!, B.min[k]!) < 0.02) ok = false; // need real face overlap
        }
        if (!ok || touch < 0) continue;
        const pa = bricks[x]!.p, pb = bricks[y]!.p;
        const ba = this.bodies[pa.base]!, bb = this.bodies[pb.base]!;
        if (!ba.dynamic && !bb.dynamic) continue;
        // a fully locked six-DOF joint: the JS bindings expose its lambdas, which the break test reads
        const s = new J.SixDOFConstraintSettings();
        s.mSpace = J.EConstraintSpace_WorldSpace;
        const mid = vscale(vadd(pa.pos, pb.pos), 0.5);
        s.mPosition1 = s.mPosition2 = new J.RVec3(f32(mid[0]), f32(mid[1]), f32(mid[2]));
        for (const ax of [J.SixDOFConstraintSettings_EAxis_TranslationX, J.SixDOFConstraintSettings_EAxis_TranslationY, J.SixDOFConstraintSettings_EAxis_TranslationZ,
          J.SixDOFConstraintSettings_EAxis_RotationX, J.SixDOFConstraintSettings_EAxis_RotationY, J.SixDOFConstraintSettings_EAxis_RotationZ]) s.MakeFixedAxis(ax);
        const c = s.Create(ba.body, bb.body);
        J.destroy(s);
        this.system.AddConstraint(c);
        this.mortars.push({ a: bricks[x]!.i, b: bricks[y]!.i, constraint: J.castObject(c, J.SixDOFConstraint), strength: Math.min(pa.props.mortar ?? 12, pb.props.mortar ?? 12) });
        this.st.mortar.push(false);
      }
    }
  }

  /** World AABB of a part from its pose and bounds (8 corners; the arithmetic is the M1 mortar code's, unchanged). */
  private static worldBox(def: PartDef, props: Props, pos: Vec, rot: Q): { min: Vec; max: Vec } {
    const b = def.boundsFor ? def.boundsFor(props) : def.bounds;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const w = vadd(pos, qrot(rot, [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]]));
      x0 = Math.min(x0, w[0]); y0 = Math.min(y0, w[1]); z0 = Math.min(z0, w[2]);
      x1 = Math.max(x1, w[0]); y1 = Math.max(y1, w[1]); z1 = Math.max(z1, w[2]);
    }
    return { min: [x0, y0, z0], max: [x1, y1, z1] };
  }

  /** World AABB of part `i` at its build pose. Cached: BRIK mortar and the resting test share it. */
  private boxOf(i: number): { min: Vec; max: Vec } {
    const hit = this.boxCache[i];
    if (hit) return hit;
    const p = this.parts[i]!;
    const box = Machine.worldBox(p.def, p.props, p.pos, p.rot);
    this.boxCache[i] = box;
    return box;
  }
  private readonly boxCache: ({ min: Vec; max: Vec } | undefined)[] = [];

  /** S3: a part's property values; parts with none stored share one object per type (read-only). */
  private propsOf(p: PartRecord, def: PartDef): Props {
    if (p.props?.length) return propValues(def, p.props);
    let v = this.defaultProps.get(def);
    if (!v) { v = propValues(def, p.props); this.defaultProps.set(def, v); }
    return v;
  }
  private readonly defaultProps = new Map<PartDef, Props>();
  private readonly portMaps = new Map<PartDef, ReadonlyMap<string, number>>();

  /** Static parts as oriented boxes, for explosion exposure rays (SIMULATION §6.1). */
  private buildStatics(): void {
    this.parts.forEach((p, i) => {
      if (this.bodies[p.base]!.dynamic || this.bodies[p.base]!.ghost) return;
      const b = p.def.boundsFor ? p.def.boundsFor(p.props) : p.def.bounds;
      const cl = vscale(vadd(b.min, b.max), 0.5);
      this.statics.push({ part: i, c: vadd(p.pos, qrot(p.rot, cl)), rot: p.rot, half: vscale(vsub(b.max, b.min), 0.5) });
    });
  }

  /** Fraction of 9 rays (centre + 8 bound corners) from P to a part not blocked by static parts. */
  private exposure(P: Vec, k: number, src: number): number {
    const p = this.parts[k]!;
    const c = this.com(k);
    const b = p.def.boundsFor ? p.def.boundsFor(p.props) : p.def.bounds;
    const rb = this.bodies[p.base]!.body.GetRotation();
    const r: Q = [rb.GetX(), rb.GetY(), rb.GetZ(), rb.GetW()];
    const centre = vscale(vadd(b.min, b.max), 0.5);
    const targets: Vec[] = [c];
    for (let i = 0; i < 8; i++) {
      const l: Vec = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
      // corners pulled in 10 % so a part resting on a static surface isn't shadowed by it
      targets.push(vadd(c, qrot(r, vscale(vsub(l, centre), 0.9))));
    }
    let clear = 0;
    for (const t of targets) {
      let blocked = false;
      for (const s of this.statics) {
        if (s.part === k || s.part === src) continue;
        if (segmentHitsBox(P, t, s)) { blocked = true; break; }
      }
      if (!blocked) clear++;
    }
    return clear / 9;
  }

  private addLine(li: number, a: End, b: End): void {
    const J = this.Jolt;
    const pa = this.portWorld(a), pb = this.portWorld(b);
    const len = vlen(vsub(pb, pa));
    const l = this.links[li]!;
    const rest = l.length > 0 ? posToMetres(l.length) : len;
    const s = new J.DistanceConstraintSettings();
    s.mPoint1 = new J.RVec3(f32(pa[0]), f32(pa[1]), f32(pa[2]));
    s.mPoint2 = new J.RVec3(f32(pb[0]), f32(pb[1]), f32(pb[2]));
    s.mMinDistance = f32(0);
    s.mMaxDistance = f32(Math.max(rest, 0.01));
    if (l.kind === 'bungee') { s.mLimitsSpringSettings.mFrequency = f32(2); s.mLimitsSpringSettings.mDamping = f32(0.3); }
    const c = s.Create(this.bodyOf(a), this.bodyOf(b));
    J.destroy(s);
    this.system.AddConstraint(c);
    this.lines.push({ link: li, a, b, constraint: c, sheave: -1 });
    this.st.cut.push(false);
    this.st.lineHeat.push(0);
  }

  private addPulley(li: number, a: End, b: End, sheave: End): void {
    const J = this.Jolt;
    const pa = this.portWorld(a), pb = this.portWorld(b);
    const top = this.portWorld(sheave);
    const len = vlen(vsub(pa, top)) + vlen(vsub(pb, top));
    const s = new J.PulleyConstraintSettings();
    s.mBodyPoint1 = new J.RVec3(f32(pa[0]), f32(pa[1]), f32(pa[2]));
    s.mBodyPoint2 = new J.RVec3(f32(pb[0]), f32(pb[1]), f32(pb[2]));
    s.mFixedPoint1 = s.mFixedPoint2 = new J.RVec3(f32(top[0]), f32(top[1]), f32(top[2]));
    s.mMinLength = f32(0);
    s.mMaxLength = f32(len);
    const c = s.Create(this.bodyOf(a), this.bodyOf(b));
    J.destroy(s);
    this.system.AddConstraint(c);
    this.lines.push({ link: li, a, b, constraint: c, sheave: sheave.part });
    this.st.cut.push(false);
    this.st.lineHeat.push(0);
  }

  /** Gear mesh or belt between two hinged parts (SIMULATION §4.4). belt = same direction. */
  /**
   * Gear mesh or belt between two hinged parts (SIMULATION §4.4). Jolt's gear constraint holds
   * ω₁ = −ratio·ω₂ about the two hinge axes. Its ratio must stay positive (a negative one runs away),
   * so a belt, which turns both pulleys the same way, flips the second axis instead. Meshed gears
   * counter-rotate (ratio = N₂/N₁); a crossed belt reverses (no flip).
   */
  private addGear(pa: number, pb: number, ratio: number, sameWay = false): JoltModule {
    const J = this.Jolt;
    const A = this.parts[pa]!, B = this.parts[pb]!;
    const ax = vnorm(qrot(A.rot, A.def.hinge!.axis)), bx = vnorm(qrot(B.rot, B.def.hinge!.axis));
    const s = new J.GearConstraintSettings();
    s.mHingeAxis1 = new J.Vec3(f32(ax[0]), f32(ax[1]), f32(ax[2]));
    const k = sameWay ? -1 : 1;
    s.mHingeAxis2 = new J.Vec3(f32(bx[0] * k), f32(bx[1] * k), f32(bx[2] * k));
    s.mRatio = f32(ratio);
    // drive trains are stiff chains with big inertia ratios: give them extra solver iterations
    s.mNumVelocityStepsOverride = 24;
    s.mNumPositionStepsOverride = 6;
    const c = s.Create(this.bodies[A.arm]!.body, this.bodies[B.arm]!.body);
    J.destroy(s);
    // No SetConstraints: Jolt's drift correction combines the two hinges' angles, which wrap at ±π,
    // so any non-integer ratio (M↔S, M↔L) gets a 2π/ratio error jump each turn and explodes.
    // Velocity-only coupling keeps the ratio exact; the tiny phase drift is invisible (no tooth contact).
    this.system.AddConstraint(c);
    for (const h of [A.hinge, B.hinge]) { h.SetNumVelocityStepsOverride(24); h.SetNumPositionStepsOverride(6); }
    this.gears.push(c);
    return c;
  }

  /** Cogs mesh automatically: parallel axes, coplanar, centre distance = sum of pitch radii. */
  private buildGearMeshes(): void {
    const cogs = this.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.def.type === 'cog');
    for (let x = 0; x < cogs.length; x++) {
      for (let y = x + 1; y < cogs.length; y++) {
        const A = cogs[x]!.p, B = cogs[y]!.p;
        const ax = vnorm(qrot(A.rot, [0, 0, 1])), bx = vnorm(qrot(B.rot, [0, 0, 1]));
        if (Math.abs(vdot(ax, bx)) < 0.999) continue;
        const d = vsub(B.pos, A.pos);
        if (Math.abs(vdot(d, ax)) > 0.02) continue;
        const ga = cogSize(A.props), gb = cogSize(B.props);
        if (Math.abs(vlen(d) - (ga.pitch + gb.pitch) / 2) > 0.012) continue;
        // the smaller gear goes first so the ratio is ≥ 1 (Jolt's solver blows up on ratio < 1 chains)
        if (ga.teeth <= gb.teeth) this.addGear(cogs[x]!.i, cogs[y]!.i, gb.teeth / ga.teeth);
        else this.addGear(cogs[y]!.i, cogs[x]!.i, ga.teeth / gb.teeth);
      }
    }
  }

  // ---- contacts --------------------------------------------------------------------------------------

  // J4 (M4): the listener's callbacks live in packages/jolt/src/contacts.ts and run on whichever Jolt thread finds
  // the contact; they only append records. The conveyor and persisted-contact rules they apply come from per-body
  // tables written here before each step; the records come back in canonical order after it (gatherContacts).
  private installContactListener(): void {
    this.system.SetContactListener(this.cbuf.listener);
  }

  /** J4: body tables for the contact callbacks: new bodies' persisted-contact flag, and every belt's surface. */
  private syncContactTables(): void {
    const n = this.bodies.length;
    if (n > this.cbufBodies) {
      for (let i = this.cbufBodies; i < n; i++) {
        const b = this.bodies[i]!, type = this.parts[b.part]!.def.type;
        if (type === 'treadway' && b.role === 'base') this.belts.push(i);
      }
      this.cbuf.bodies(n, this.belts.length > 0);
      for (let i = this.cbufBodies; i < n; i++) if (this.wantsPersisted(i)) this.cbuf.persist(i);
      this.cbufBodies = n;
    }
    this.cbuf.persistAny = this.persistAny;
    for (const i of this.belts) {
      const pi = this.bodies[i]!.part;
      const v = this.st.beltSpeed[pi]!;
      const dir = qrot(this.parts[pi]!.rot, [1, 0, 0]);
      // as M1's listener: the callback sets f32(dir × v × sign), and f32(−x) = −f32(x), so body 1 negates this
      this.cbuf.surface(i, v !== 0, f32(dir[0] * v), f32(dir[1] * v), f32(dir[2] * v));
    }
  }

  /** J4: the step's contacts in canonical order: critters first (their hook), then the contact stage's list. */
  private gatherContacts(): void {
    const cr = this.critters;
    this.cbuf.gather(this.contacts, (i1, i2, v1x, v1y, v1z, v2x, v2y, v2z, nx, ny, nz, inv1, inv2, J) =>
      cr.contact(i1, i2, v1x, v1y, v1z, v2x, v2y, v2z, nx, ny, nz, inv1, inv2, J));
  }

  /** Persisted contacts are only needed for pressure plates, conveyors and the channel parts that ask. */
  private wantsPersisted(i: number): boolean {
    const b = this.bodies[i];
    return !!b && (this.parts[b.part]!.def.type === 'stomp_pad' || this.x.wantsPersisted(this.parts[b.part]!.def.type));
  }

  // ---- the tick ---------------------------------------------------------------------------------------

  addPoke(p: Poke): void {
    const list = this.pokes.get(p.tick) ?? [];
    list.push(p);
    list.sort((a, b) => a.seq - b.seq);
    this.pokes.set(p.tick, list);
  }

  step(): void {
    if (this.destroyed) return;
    const st = this.st;
    const t = st.tick;
    this.stageInputs(t);
    this.stageTimers(t);
    this.stageSignal(t);
    this.stagePower(t);
    this.x.stageLight(); // stage 4: light (M2: torch, lamp, burning glass, suncell)
    this.stageHeat(t);
    this.stageBehaviours();
    this.matter.stage7(t); // MI (M4): stage 7, Matter coupling (impulses and absorbed counts of Matter tick (t − 4) / 2)
    this.contacts.length = 0;
    this.syncContactTables(); // J4
    this.cbuf.begin();
    this.jolt.Step(this.dt, 1);
    this.contactsThisStep = this.cbuf.calls;
    if (this.contactsThisStep > this.contactMax) this.contactMax = this.contactsThisStep;
    this.gatherContacts(); // J4: canonical order, at any thread count
    this.x.afterPhysics(); // M2: dynamo output from the step just taken
    this.stageContacts(t);
    this.critters.postContacts(t); // ragdoll triggers, bumps, ragdoll recovery, traps
    this.stageConstraints(t);
    this.stageExplosions(t);
    this.x.stageSpawn(t); // stage 12 (M3): FABRICATOR spawns, RECYCLER intake, SKYSHOW shell bursts
    this.matter.stage13(t); // MI (M4): stage 13, Matter command (even ticks: proxy snapshot + Matter tick t / 2)
    st.tick = t + 1;
    if (this.checkpointEvery > 0 && st.tick % this.checkpointEvery === 0) this.checkpoint();
  }

  /**
   * Emits an event and returns its id (contract 1). `part` and `other` are part indices (−1 = none).
   * The event becomes its part's last causing event, which contacts pass on (SIMULATION §9).
   */
  private emit(kind: EventKind, part: number, pos: readonly number[], mag = 0, cause = -1, other = -1): number {
    const st = this.st;
    const id = st.evId++;
    const o = other >= 0 ? this.parts[other]?.id : undefined;
    this.events.push({ id, tick: st.tick, kind, part: this.parts[part]?.id ?? 0, pos: [pos[0]!, pos[1]!, pos[2]!], mag, cause, ...(o !== undefined ? { other: o } : {}) });
    if (part >= 0 && part < st.lastEv.length) st.lastEv[part] = id;
    return id;
  }

  /** A Cut event (its subject is a link, not a part). */
  private emitCut(link: number, at: readonly number[], cause: number): number {
    const id = this.st.evId++;
    this.events.push({ id, tick: this.st.tick, kind: 'Cut', part: this.links[link]!.id, pos: [at[0]!, at[1]!, at[2]!], mag: 0, cause });
    return id;
  }

  /**
   * Sound channel (SIMULATION §5.10, contract 2): a `Sound` event (mag = dB at 1 m) plus an entry in
   * the queue that becomes `soundsThisTick` at the next stage 6. `part` is a part index. Returns the id.
   */
  sound(pos: readonly number[], dB: number, part: number, cause = -1): number {
    const prev = this.st.lastEv[part] ?? -1;
    const id = this.emit('Sound', part, pos, dB, cause);
    if (part >= 0) this.st.lastEv[part] = prev; // a sound doesn't replace its maker's cause chain
    this.st.m2.snd.push(pos[0]!, pos[1]!, pos[2]!, dB, part, id);
    return id;
  }

  /** Sounds critters can perceive during this tick's stage 6 (each sound appears in exactly one tick). */
  get soundsThisTick(): Sound[] { return this.x.soundsThisTick(); }

  /** Live Lure emitters (tagged parts and shiny small bodies), part order (contract 2). */
  lureEmitters(): LureEmitter[] { return this.x.lureEmitters(); }

  /**
   * M3 (stream A3): the beam segments light traced in the last stage 4, for the renderer: 8 floats each
   * [x0, y0, z0, x1, y1, z1, intensity, kind] (kind 0 TORCH ray, 1 LANCE ray, 2 LANCE cutting beam). Read-only.
   */
  lightBeams(): Float32Array { return this.x.beams(); }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private com(part: number): Vec {
    const p = this.parts[part]!;
    const b = this.bodies[p.arm >= 0 && this.bodies[p.base]!.ghost ? p.arm : p.base]!.body;
    const c = b.GetCenterOfMassPosition();
    return [c.GetX(), c.GetY(), c.GetZ()];
  }

  private local(part: number, at: readonly number[], role: 'base' | 'arm' = 'base'): Vec {
    const p = this.parts[part]!;
    const b = this.bodies[role === 'arm' && p.arm >= 0 ? p.arm : p.base]!.body;
    const pos = b.GetPosition(), r = b.GetRotation();
    return vadd([pos.GetX(), pos.GetY(), pos.GetZ()], qrot([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], at));
  }

  // stage 0: pokes (Hand-of-God) for this tick, in server order
  private stageInputs(t: number): void {
    const list = this.pokes.get(t);
    if (!list) return;
    const J = this.Jolt;
    for (const pk of list) {
      const i = this.byId.get(pk.partId);
      if (i === undefined || !this.st.alive[i]) continue;
      const p = this.parts[i]!;
      if (p.def.type === 'the_button') { this.press(i); continue; }
      if (pk.kind === 'impulse' && pk.data.length >= 3 && this.critters.poke(i, pk.data)) continue; // critters may tumble
      if (pk.kind === 'impulse' && pk.data.length >= 3) {
        const b = this.bodies[p.base]!;
        if (!b.dynamic || this.hiddenBody(i, b.role)) continue;
        this.bi.AddImpulse(b.body.GetID(), this.v3(pk.data[0]!, pk.data[1]!, pk.data[2]!));
      }
    }
  }

  private press(i: number, cause = -1, other = -1): void {
    const st = this.st;
    if (st.cooldown[i]! > 0) return;
    st.cooldown[i] = Math.round(0.25 * this.tickRate);
    st.pressed[i] = Math.round(0.3 * this.tickRate);
    const id = this.emit('Press', i, this.local(i, [0, 0.07, 0]), 0, cause, other);
    this.pulse(i, 'out', id);
  }

  /** Queues a signal pulse out of a port for the next stage 2; `cause` is the event that fired it. */
  private pulse(part: number, port: string, cause = -1): void {
    this.st.pulses.push(part, this.parts[part]!.portIndex.get(port) ?? 0, cause);
  }

  // stage 1: timers (fuse stubs, cooldowns, fireballs)
  private stageTimers(t: number): void {
    const st = this.st;
    for (const i of this.busy) { // S3: inert parts never have timers
      if (st.cooldown[i]! > 0) st.cooldown[i]!--;
      if (st.pressed[i]! > 0) st.pressed[i]!--;
      if (st.armedAt[i]! >= 0 && st.alive[i]) {
        const fuseTicks = Math.round((this.parts[i]!.props.fuse ?? 2) * this.tickRate);
        if (t - st.armedAt[i]! >= fuseTicks) this.queueBoom(i, t, t, st.litCause[i]!);
      }
    }
    for (let k = st.fireballs.length - 6; k >= 0; k -= 6) if (st.fireballs[k + 4]! <= t) st.fireballs.splice(k, 6);
    this.x.stageTimers(t); // M2: ringer, delay, flap auto-close, rocket and cannon fuses
  }

  // stage 2: signal pulses from last tick's sensors, BFS over the wire graph (each node once per tick)
  private stageSignal(_t: number): void {
    const st = this.st;
    if (!st.pulses.length) return;
    const queue = st.pulses;
    st.pulses = [];
    const fired = new Set<string>();
    for (let k = 0; k < queue.length; k += 3) {
      const part = queue[k]!, portIdx = queue[k + 1]!, cause = queue[k + 2]!;
      const port = this.parts[part]!.def.ports[portIdx];
      if (!port) continue;
      const key = `${part}:${port.name}`;
      if (fired.has(key)) continue;
      fired.add(key);
      for (const dst of this.signalOut.get(key) ?? []) this.receive(dst.part, dst.port.name, cause);
    }
  }

  private receive(i: number, port: string, cause = -1): void {
    const st = this.st;
    if (!st.alive[i]) return;
    const p = this.parts[i]!;
    const id = this.emit('Signal', i, this.local(i, p.def.ports[p.portIndex.get(port) ?? 0]?.at ?? [0, 0, 0]), 0, cause);
    switch (p.def.type) {
      case 'bangstick': if (port === 'detonator') this.queueBoom(i, st.tick, st.tick, id); return;
      case 'mains': st.mainsOn[i] = !st.mainsOn[i]; st.powerCause = id; return;
      case 'snipper': this.snip(i, id); return;
      default: this.x.onSignal(i, port, id); // M2 receivers (delay, torch, flap, punchline, cork blaster)
    }
  }

  // stage 3: power (union-find components; supply factor f = min(1, S / D))
  /** Watts a source offers this tick: MAINS while on; M2 sources (cell, dynamo, suncell) from channels/power.ts. */
  private sourceWatts(i: number): number {
    const p = this.parts[i]!;
    if (p.def.type === 'mains') return this.st.mainsOn[i] ? p.def.power!.source! : 0;
    return this.x.sourceWatts(i);
  }

  private stagePower(_t: number): void {
    const st = this.st;
    this.x.powerTopology(); // M2: toggles split / join components
    const S = new Map<number, number>(), D = new Map<number, number>();
    for (const i of this.powerParts) { // S3: only parts with a power port
      if (!st.alive[i]) continue;
      const pw = this.parts[i]!.def.power;
      if (!pw) continue;
      const c = this.powerComp[i]!;
      if (pw.source) { const w = this.sourceWatts(i); if (w > 0) S.set(c, (S.get(c) ?? 0) + w); }
      if (pw.consumer) D.set(c, (D.get(c) ?? 0) + this.x.demand(i, pw.consumer)); // M3: LIFT while moving, FLAMER powered mode
    }
    for (const i of this.powerParts) {
      const pw = this.parts[i]!.def.power;
      if (!pw?.consumer) continue;
      const c = this.powerComp[i]!;
      const s = S.get(c) ?? 0, d = D.get(c) ?? 0;
      const f = st.alive[i] ? (d === 0 ? 1 : Math.min(1, s / d)) : 0;
      const was = st.supply[i]!;
      st.supply[i] = s > 0 ? f : 0;
      if ((was > 0) !== (st.supply[i]! > 0)) this.emit(st.supply[i]! > 0 ? 'Powered' : 'Unpowered', i, this.com(i), 0, st.powerCause);
    }
    this.x.afterPower(S, D); // M2: cells drain, dynamos note their load
  }

  // stage 5: heat (sources → exposure → ignite, burn, pop, cut) and fuse burning
  private stageHeat(t: number): void {
    const st = this.st;
    const dt = this.dt;
    const sources: number[] = []; // x, y, z, r, cause (the event behind the heat: SIMULATION §9)
    for (const i of this.busy) { // S3: inert parts are never lit
      if (!st.alive[i] || !st.lit[i]) continue;
      const d = this.parts[i]!.def.type;
      if (d === 'wick') sources.push(...this.local(i, [0, 0.19, 0]), 0.02, st.litCause[i]!);
      if (d === 'plank' && !st.broken[i]) for (const z of [-0.35, 0, 0.35]) sources.push(...this.local(i, [0, 0.05, z]), 0.06, st.litCause[i]!);
    }
    for (let k = 0; k < st.fireballs.length; k += 6) sources.push(st.fireballs[k]!, st.fireballs[k + 1]!, st.fireballs[k + 2]!, st.fireballs[k + 3]!, st.fireballs[k + 5]!);
    this.x.heatSources(sources); // M2: light focus spots, rocket exhaust
    // fuses: ends attached to a lit flame start burning; fronts advance 0.2 m/s both ways
    this.fuses.forEach((f, fi) => {
      const iv = st.fuse[fi]!;
      const hotEnd = (e: End | null): boolean => !!e && e.port.channel === 'heat' && this.parts[e.part]!.def.type === 'wick' && !!st.lit[e.part] && !!st.alive[e.part];
      // the end that lit it doesn't get its own heat back
      if (hotEnd(f.a) && !covers(iv, 0)) { iv.push(0, 0); st.fuseEndsDone[fi]! |= 1; st.fuseCause[fi] = this.emit('FuseLit', f.a!.part, this.portWorld(f.a!), 0, st.litCause[f.a!.part]!); }
      if (hotEnd(f.b) && !covers(iv, f.length)) { iv.push(f.length, f.length); st.fuseEndsDone[fi]! |= 2; st.fuseCause[fi] = this.emit('FuseLit', f.b!.part, this.portWorld(f.b!), 0, st.litCause[f.b!.part]!); }
      // heat touching the cord anywhere lights it there
      if (sources.length) {
        const path = this.fusePath(f);
        for (let s = 0; s <= f.length; s += 0.05) {
          const p = pointAlong(path, s / f.length);
          if (covers(iv, s)) continue;
          for (let k = 0; k < sources.length; k += 5) {
            if (vlen(vsub(p, [sources[k]!, sources[k + 1]!, sources[k + 2]!])) < sources[k + 3]! + 0.01) {
              iv.push(s, s);
              if (st.fuseCause[fi]! < 0) st.fuseCause[fi] = sources[k + 4]!;
              break;
            }
          }
        }
      }
      const step = 0.2 * dt;
      for (let k = 0; k < iv.length; k += 2) { iv[k] = Math.max(0, iv[k]! - step); iv[k + 1] = Math.min(f.length, iv[k + 1]! + step); }
      mergeIntervals(iv);
      // reaching an end delivers heat to that port
      if (iv.length && iv[0]! <= 0 && !(st.fuseEndsDone[fi]! & 1)) { st.fuseEndsDone[fi]! |= 1; if (f.a) this.heatPort(f.a, t, st.fuseCause[fi]!); }
      if (iv.length && iv[iv.length - 1]! >= f.length && !(st.fuseEndsDone[fi]! & 2)) { st.fuseEndsDone[fi]! |= 2; if (f.b) this.heatPort(f.b, t, st.fuseCause[fi]!); }
    });
    // burning fuse fronts are heat sources too (spark heads)
    this.fuses.forEach((f, fi) => {
      const iv = st.fuse[fi]!;
      const path = this.fusePath(f);
      for (let k = 0; k < iv.length; k++) {
        const s = iv[k]!;
        if (s <= 0 || s >= f.length) continue;
        sources.push(...pointAlong(path, s / f.length), 0.015, st.fuseCause[fi]!);
      }
    });
    if (!sources.length) { for (const i of this.busy) st.exposure[i] = Math.max(0, st.exposure[i]! - 2 * dt); return; } // S3: inert exposure stays 0
    /** The cause of the first source within reach of p, or −2 when nothing is. */
    const near = (p: readonly number[], pad: number): number => {
      for (let k = 0; k < sources.length; k += 5) if (vlen(vsub(p, [sources[k]!, sources[k + 1]!, sources[k + 2]!])) < sources[k + 3]! + pad) return sources[k + 4]!;
      return -2;
    };
    for (const i of this.busy) { // S3: inert parts have no ignition point
      if (!st.alive[i]) continue;
      const p = this.parts[i]!;
      let hot = -2, igniteTime = 0;
      switch (p.def.type) {
        case 'bangstick': if (st.armedAt[i]! < 0) { hot = near(this.local(i, [0.155, 0.045, 0]), 0.015); igniteTime = 0.05; } break;
        case 'wick': if (!st.lit[i]) { hot = near(this.local(i, [0, 0.19, 0]), 0.01); igniteTime = 0.2; } break;
        case 'helio': { const c = near(this.com(i), 0.125); if (c > -2) { this.pop(i, c); continue; } break; }
        case 'plank':
          if (!st.lit[i] && !st.broken[i]) {
            hot = near(this.local(i, [0, 0, -0.35]), 0.06);
            if (hot === -2) hot = near(this.local(i, [0, 0, 0]), 0.06);
            if (hot === -2) hot = near(this.local(i, [0, 0, 0.35]), 0.06);
            igniteTime = 4.0;
          }
          break;
        default: {
          // M2 flammables (skyrocket stub, cannon touch-hole)
          const probe = this.x.heatProbe(i);
          if (probe) { hot = near(this.local(i, probe.at), 0.015); igniteTime = probe.time; }
        }
      }
      if (!igniteTime) continue;
      st.exposure[i] = hot > -2 ? st.exposure[i]! + dt : Math.max(0, st.exposure[i]! - 2 * dt);
      if (st.exposure[i]! >= igniteTime - 1e-9) {
        st.exposure[i] = 0;
        this.ignite(i, t, hot > -2 ? hot : -1);
      }
    }
    // lines burn through after 1.5 s of heat (chains are fireproof)
    this.lines.forEach((l, li) => {
      if (st.cut[li] || this.links[l.link]!.kind === 'chain') return;
      const a = this.portWorld(l.a), b = this.portWorld(l.b);
      let hot = -2;
      for (let k = 0; k < sources.length && hot === -2; k += 5) if (segDist([sources[k]!, sources[k + 1]!, sources[k + 2]!], a, b) < sources[k + 3]! + 0.006) hot = sources[k + 4]!;
      st.lineHeat[li] = hot > -2 ? st.lineHeat[li]! + dt : Math.max(0, st.lineHeat[li]! - 2 * dt);
      if (st.lineHeat[li]! >= 1.5) this.cutLine(li, vscale(vadd(a, b), 0.5), true, hot > -2 ? hot : -1);
    });
  }

  private heatPort(e: End, t: number, cause = -1): void {
    const p = this.parts[e.part]!;
    if (!this.st.alive[e.part]) return;
    const id = this.emit('FuseEnd', e.part, this.portWorld(e), 0, cause);
    if (p.def.type === 'bangstick' || p.def.type === 'wick') this.ignite(e.part, t, id);
    else if (e.port.channel === 'heat') this.x.ignite(e.part, id); // M2: skyrocket, big top
  }

  private ignite(i: number, t: number, cause = -1): void {
    const st = this.st;
    const p = this.parts[i]!;
    if (p.def.type === 'bangstick') {
      if (st.armedAt[i]! >= 0) return;
      st.armedAt[i] = t;
      st.lit[i] = true;
    } else if (p.def.type === 'wick') {
      if (st.lit[i]) return;
      st.lit[i] = true;
    } else if (p.def.type === 'plank') {
      if (st.lit[i] || st.broken[i]) return;
      st.lit[i] = true;
      st.burnAt[i] = t;
    } else { this.x.ignite(i, cause); return; } // M2 flammables emit their own Ignite
    st.litCause[i] = this.emit('Ignite', i, this.com(i), 0, cause);
  }

  private pop(i: number, cause = -1): void {
    if (!this.st.alive[i]) return;
    this.emit('Pop', i, this.com(i), 0, cause);
    this.kill(i);
    // a popped balloon releases its lines
    this.lines.forEach((l, li) => { if (!this.st.cut[li] && (l.a.part === i || l.b.part === i)) this.cutLine(li, this.com(i), false); });
  }

  private cutLine(li: number, at: readonly number[], event = true, cause = -1): void {
    if (this.st.cut[li]) return;
    this.st.cut[li] = true;
    this.lines[li]!.constraint.SetEnabled(false);
    // wake both ends so whatever hung from the rope falls immediately
    this.bi.ActivateBody(this.bodyOf(this.lines[li]!.a).GetID());
    this.bi.ActivateBody(this.bodyOf(this.lines[li]!.b).GetID());
    if (event) {
      const id = this.emitCut(this.lines[li]!.link, at, cause);
      // what hung from the rope moves because of the cut
      this.st.lastEv[this.lines[li]!.a.part] = id;
      this.st.lastEv[this.lines[li]!.b.part] = id;
    }
  }

  /** SNIPPER: cut every rope crossing the jaw volume, pop any balloon in it. */
  private snip(i: number, cause = -1): void {
    const p = this.parts[i]!;
    const lo = this.local(i, [0.02, 0.06, 0]), hi = this.local(i, [0.15, 0.06, 0]);
    this.st.pressed[i] = Math.round(0.4 * this.tickRate);
    this.lines.forEach((l, li) => {
      if (this.st.cut[li]) return;
      const a = this.portWorld(l.a), b = this.portWorld(l.b);
      // closest approach between the rope segment and the blade segment
      for (let s = 0; s <= 1; s += 0.05) {
        const q = vadd(a, vscale(vsub(b, a), s));
        if (segDist(q, lo, hi) < 0.03) { this.cutLine(li, q, true, cause); break; }
      }
    });
    this.bands.forEach((bd, bi) => {
      if (this.st.bandCut[bi]) return;
      const a = this.portWorld(bd.a), b = this.portWorld(bd.b);
      for (let s = 0; s <= 1; s += 0.05) {
        const q = vadd(a, vscale(vsub(b, a), s));
        if (segDist(q, lo, hi) < 0.03) {
          this.st.bandCut[bi] = true;
          bd.constraint.SetEnabled(false);
          this.emitCut(bd.link, q, cause);
          break;
        }
      }
    });
    for (let k = 0; k < this.parts.length; k++) {
      if (this.parts[k]!.def.type === 'helio' && this.st.alive[k] && segDist(this.com(k), lo, hi) < 0.14) this.pop(k, cause);
    }
    void p;
  }

  // stage 6: behaviours (motors, conveyors, fans, balloons)
  private stageBehaviours(): void {
    const st = this.st;
    const J = this.Jolt;
    this.x.swapSounds(); // contract 2: last window's sounds become `soundsThisTick` for critter perception
    for (const i of this.busy) { // S3: inert parts have no behaviour
      if (!st.alive[i]) continue;
      const p = this.parts[i]!;
      switch (p.def.type) {
        case 'motor': {
          const f = st.supply[i]!;
          // looking at the shaft end (+X), CCW is positive about +X
          const dir = (p.props.direction ?? 0) === 1 ? 1 : -1;
          // Linear DC torque–speed curve (SIMULATION §5.3): τ = τs·(1 − ω/ω0), τs = 30 N·m × f, ω0 = 9.42 rad/s × f,
          // so peak shaft power is ≈ 71 W (× f²) and a dynamo can't feed its own motor (no free energy).
          // Evaluating τ from ω explicitly is unstable on these tiny rotor inertias, so the hinge's rigid
          // velocity motor (limited to stall torque) holds the curve's speed for the torque it delivered last
          // step, ω = ω0·(1 − τ/τs), relaxed by half each tick; the target lives in st.m2.val (motors only).
          const tauS = 30 * f, w0 = 9.42 * f;
          const tau = tauS > 0 ? Math.min(1, Math.max(0, (p.hinge!.GetTotalLambdaMotor() * this.tickRate * dir) / tauS)) : 0;
          const target = st.m2.val[i]! + 0.5 * (w0 * (1 - tau) - st.m2.val[i]!);
          st.m2.val[i] = target;
          p.hinge!.SetTargetAngularVelocity(f32(target * dir));
          const m = p.hinge!.GetMotorSettings();
          m.mMinTorqueLimit = f32(-tauS); m.mMaxTorqueLimit = f32(tauS);
          if (f > 0) this.bi.ActivateBody(this.bodies[p.arm]!.body.GetID());
          break;
        }
        case 'treadway': {
          const arm = this.bodies[p.arm]!.body;
          const w = arm.GetAngularVelocity();
          const axis = qrot(p.rot, [0, 0, 1]);
          // drum ω about its axis × r 0.034; positive spin moves the belt toward +X
          st.beltSpeed[i] = -vdot([w.GetX(), w.GetY(), w.GetZ()], axis) * 0.034;
          break;
        }
        case 'helio': {
          const b = this.bodies[p.base]!.body;
          const v = b.GetLinearVelocity();
          const vv: Vec = [v.GetX(), v.GetY(), v.GetZ()];
          const sp = vlen(vv);
          const drag = vscale(vv, -3.4 * sp);
          this.bi.AddForce(b.GetID(), this.v3(drag[0], 4.9 * this.air + drag[1], drag[2]), J.EActivation_Activate);
          break;
        }
        case 'gale': this.blow(i, st.supply[i]!); break;
        default: this.x.behave(i); // M2 parts (channels/)
      }
    }
    this.x.afterBehaviours(); // M2: puffs
    zeroGZones(this.x, this.zeroG, this.gWorld); // W5 (M5): the Hangar's zero-g zones (no-op elsewhere)
    if (this.wind) this.windNow = globalWind(this.x, this.wind, st.tick, this.gWorld); // W5 (M5, D26): global wind
    this.critters.preStep(st.tick); // critter think (staggered) + act, critter-bound devices
  }

  /** GALE: cone 6 m / 15° along its front, F = ρ·C·s·A·(1 − d/R)² (SIMULATION §5.8); douses flames. */
  private blow(i: number, f: number): void {
    if (f <= 0) return;
    const J = this.Jolt;
    const st = this.st;
    const nozzle = this.local(i, [0, 0.122, 0.04]);
    const axis = vnorm(qrot(this.parts[i]!.rot, [0, 0, 1]));
    const R = 6, cosHalf = 0.9659; // cos 15°
    for (let k = 0; k < this.parts.length; k++) {
      if (k === i || !st.alive[k]) continue;
      if (this.x.wind(k, nozzle, axis, R, cosHalf, f)) continue; // M2: turbine rotors
      const p = this.parts[k]!;
      const target = p.def.type === 'wick' ? this.local(k, [0, 0.19, 0]) : this.com(k);
      const d = vsub(target, nozzle);
      const dist = vlen(d);
      if (dist > R || dist < 1e-6 || vdot(d, axis) / dist < cosHalf) continue;
      const fall = (1 - dist / R) * (1 - dist / R);
      if (p.def.type === 'wick' && st.lit[k] && 6 * f * (1 - dist / R) > 4) { st.lit[k] = false; this.emit('Extinguish', k, target, 0, st.lastEv[i]!); }
      const b = this.bodies[p.base]!;
      if (!b.dynamic) continue;
      const ext = vsub(p.def.bounds.max, p.def.bounds.min);
      const area = (ext[0]! * ext[1]! + ext[1]! * ext[2]! + ext[0]! * ext[2]!) / 3;
      const F = 1.225 * this.air * 9 * f * area * fall;
      this.bi.AddForce(b.body.GetID(), this.v3(axis[0] * F, axis[1] * F, axis[2] * F), J.EActivation_Activate);
    }
  }

  // stage 9: contacts, sorted canonically, then sensors and pops
  private stageContacts(_t: number): void {
    const c = this.contacts;
    const n = c.length / 10;
    if (!n) { this.padsIdle(); return; }
    const order = Array.from({ length: n }, (_, k) => k);
    const key = (k: number): [number, number] => {
      const a = c[k * 10]!, b = c[k * 10 + 1]!;
      return a < b ? [a, b] : [b, a];
    };
    order.sort((x, y) => { const [a1, b1] = key(x), [a2, b2] = key(y); return a1 - a2 || b1 - b2 || c[x * 10 + 8]! - c[y * 10 + 8]!; });
    const st = this.st;
    const padMass = new Map<number, number>();
    const padCause = new Map<number, number>();
    for (const k of order) {
      const o = k * 10;
      const i1 = c[o]!, i2 = c[o + 1]!, J = c[o + 2]!, vrel = c[o + 3]!, added = c[o + 8] === 1;
      const pos: Vec = [c[o + 4]!, c[o + 5]!, c[o + 6]!];
      for (const [me, other] of [[i1, i2], [i2, i1]] as const) {
        const mb = this.bodies[me], ob = this.bodies[other];
        if (!mb) continue;
        const pi = mb.part;
        const p = this.parts[pi]!;
        if (!st.alive[pi]) continue;
        // causeId through contacts (SIMULATION §9): the other body's last causing event
        const cause = ob ? st.lastEv[ob.part]! : -1;
        switch (p.def.type) {
          case 'mains': {
            if (!added || J < 0.03 || !ob?.dynamic || st.cooldown[pi]! > 0) break;
            const lever = this.local(pi, [-0.045, 0.13, 0.07]);
            if (vlen(vsub(pos, lever)) > 0.06) break;
            st.mainsOn[pi] = !st.mainsOn[pi];
            st.cooldown[pi] = Math.round(0.2 * this.tickRate);
            st.powerCause = this.emit('Press', pi, lever, 0, cause, ob.part);
            break;
          }
          case 'the_button':
            if (added && J >= 0.02 && ob?.dynamic) this.press(pi, cause, ob.part);
            break;
          case 'stomp_pad':
            if (ob?.dynamic) {
              const inv = ob.body.GetMotionProperties().GetInverseMass();
              padMass.set(pi, (padMass.get(pi) ?? 0) + (inv > 0 ? 1 / inv : 0));
              padCause.set(pi, Math.max(padCause.get(pi) ?? -1, cause));
            }
            break;
          case 'helio':
            if (added && (vrel > 6 || (ob && (ob.role === 'piece' ? this.x.sharpPiece(ob) : this.parts[ob.part]!.def.body.sharp)))) this.pop(pi, cause);
            break;
          case 'plank': {
            // kn_break_impulse 18 N·s, halved once the char passes 0.6 (frame.md)
            if (!added || st.broken[pi] || mb.role !== 'base') break;
            const char = st.burnAt[pi]! >= 0 ? (this.st.tick - st.burnAt[pi]!) / (6 * this.tickRate) : 0;
            if (J >= (char >= 0.6 ? 9 : 18)) this.breakPart(pi, pos, cause);
            break;
          }
          default: this.x.onContact(pi, mb, ob, J, vrel, pos, added, cause); // M2 sensors and pads
        }
      }
      if (added && J >= 0.3) {
        const b = this.bodies[i1] ?? this.bodies[i2];
        if (b) {
          // the impact carries on whichever chain reached it last; both bodies now belong to it
          const ob = this.bodies[b === this.bodies[i1] ? i2 : i1];
          const cause = Math.max(st.lastEv[b.part]!, ob ? st.lastEv[ob.part]! : -1);
          const id = this.emit('Impact', b.part, pos, J, cause, ob ? ob.part : -1);
          if (ob) st.lastEv[ob.part] = id;
          if (J >= IMPACT_SOUND_J) this.sound(pos, impactDb(J), b.part, id); // hard hits are Sounds (§5.10)
          this.critters.impact(pos, J, b.part, ob ? ob.part : -1); // B4 (M4): HENNY startles at an Impact within 1.5 m
        }
      }
    }
    this.x.afterContacts(); // M2: t-plunger handle weight
    for (const i of this.pads) { // S3: stomp pads only
      if (this.parts[i]!.def.type !== 'stomp_pad' || !st.alive[i]) continue;
      const over = (padMass.get(i) ?? 0) >= (this.parts[i]!.props.weight ?? 0.5) - 1e-9;
      if (over && !st.padMassWas[i] && st.cooldown[i]! === 0) {
        st.cooldown[i] = Math.round(0.1 * this.tickRate);
        this.pulse(i, 'out', this.emit('Press', i, this.local(i, [0, 0.03, 0]), 0, padCause.get(i) ?? -1));
      }
      if (over) st.pressed[i] = 2;
      st.padMassWas[i] = over;
    }
  }

  private padsIdle(): void {
    for (const i of this.pads) this.st.padMassWas[i] = false; // S3: stomp pads only
  }

  // stage 11: explosions (SIMULATION §6.1), ≤ 32 per tick, ordered by (queued tick, part id)
  private queueBoom(i: number, t: number, due: number, cause = -1): void {
    const st = this.st;
    for (let k = 0; k < st.booms.length; k += 4) if (st.booms[k + 2] === i) return;
    st.booms.push(due, t, i, cause);
  }

  private stageExplosions(t: number): void {
    const st = this.st;
    const due: [number, number, number][] = [];
    const keep: number[] = [];
    for (let k = 0; k < st.booms.length; k += 4) {
      if (st.booms[k]! <= t) due.push([st.booms[k + 1]!, st.booms[k + 2]!, st.booms[k + 3]!]);
      else keep.push(st.booms[k]!, st.booms[k + 1]!, st.booms[k + 2]!, st.booms[k + 3]!);
    }
    if (!due.length) return;
    due.sort((a, b) => a[0] - b[0] || this.parts[a[1]]!.id - this.parts[b[1]]!.id);
    for (const [, i, cause] of due.slice(32)) keep.push(t + 1, t, i, cause);
    st.booms = keep;
    for (const [, i, cause] of due.slice(0, 32)) this.detonate(i, t, cause);
  }

  private detonate(i: number, t: number, cause = -1): void {
    if (!this.st.alive[i]) return;
    this.blast(this.com(i), this.parts[i]!.def.explosive?.yield ?? 1, i, t, cause, true);
  }

  /**
   * A blast of yield Y at P from part `i` (SIMULATION §6.1): Detonate event and Sound, fireball, impulses, pops,
   * ignitions, sympathetic queueing, cracked mortar, snapped lines. `kill` removes part `i` (a detonated explosive);
   * M3 SKYSHOW shells burst without killing their cake (channels/m3_boom.ts). Returns the Detonate event id.
   */
  blast(P: Vec, Y: number, i: number, t: number, cause = -1, kill = false): number {
    const st = this.st;
    const J = this.Jolt;
    const R = 1.2 * dcbrt(Y) * dpow(Math.max(this.air, 1e-6), 0.25);
    const boom = this.emit('Detonate', i, P, Y, cause);
    this.sound(P, explosionDb(Y), i, boom); // §5.10: 120 + 10·log10(Y) dB
    if (kill) this.kill(i);
    st.fireballs.push(P[0], P[1], P[2], R * 0.4, t + Math.round(0.3 * this.tickRate), boom);
    this.matter.blast(P, R, Math.min(8, 8 * Y)); // MI (M4): Matter gets a radial kick (SIMULATION §6.1), capped at 8 m/s like bodies (D53)
    for (let k = 0; k < this.parts.length; k++) {
      if (k === i || !st.alive[k]) continue;
      const p = this.parts[k]!;
      const c = this.com(k);
      const d = vsub(c, P);
      const r = vlen(d);
      if (r > R) continue;
      st.lastEv[k] = boom; // whatever the blast reaches is now part of its chain
      if (p.def.type === 'helio') { this.pop(k, boom); continue; }
      if (p.def.explosive && r <= 0.6 * R) this.queueBoom(k, t, t + 2 + Math.floor((4 * r) / R), boom);
      if (p.def.type === 'wick' && r <= 0.4 * R) this.ignite(k, t, boom);
      if (p.def.type === 'plank' && r <= 0.4 * R) this.ignite(k, t, boom);
      if (r <= 0.4 * R) this.x.blastIgnite(k, boom); // M2 flammables (skyrocket, big top)
      this.x.blastHit(k, boom); // M3: glass inside R shatters (PANE, VASE)
      // impulse J = K·Y·e / max(r, 0.15)^1.5 with a 15 % upward bias; e = exposure past static parts
      const e = this.exposure(P, k, i);
      // critters ragdoll (a critter's own device doesn't shield it), the fishbowl breaks
      if (this.critters.blast(k, P, Y, e, r, i)) continue;
      if (e <= 0) continue;
      for (const bi of [p.base, p.arm, ...p.chunks, ...this.x.livePieces(k)]) { // M2: fired corks too
        if (bi < 0) continue;
        const b = this.bodies[bi]!;
        if (!b.dynamic || b.ghost || this.hiddenBody(k, b.role)) continue;
        const inv = b.body.GetMotionProperties().GetInverseMass();
        if (inv <= 0) continue;
        let Jmag = (18 * Y * e) / dpow(Math.max(r, 0.15), 1.5);
        // readability cap (D53): no body leaves a blast faster than 8 m/s, so light parts tumble
        // across the set instead of vanishing in one frame
        Jmag = Math.min(Jmag, 8 / inv);
        const dir = r > 1e-6 ? vscale(d, 1 / r) : [0, 1, 0];
        const imp = vadd(vscale(dir, Jmag), [0, 0.15 * Jmag, 0]);
        this.bi.AddImpulse(b.body.GetID(), this.v3(imp[0]!, imp[1]!, imp[2]!));
        this.bi.ActivateBody(b.body.GetID());
      }
    }
    this.critters.blastPieces(P, R, boom); // B4 (M4): HENNY's laid YOLKs inside R splat
    // mortar inside R/2 cracks (damage D = 60·Y·e/r² far exceeds any mortar there)
    this.mortars.forEach((m, mi) => {
      if (st.mortar[mi]) return;
      if (vlen(vsub(this.com(m.a), P)) < R / 2 || vlen(vsub(this.com(m.b), P)) < R / 2) this.crack(mi, boom);
    });
    // lines inside R/2 snap
    this.lines.forEach((l, li) => {
      if (st.cut[li]) return;
      const a = this.portWorld(l.a), b = this.portWorld(l.b);
      if (segDist(P, a, b) < R / 2) this.cutLine(li, vscale(vadd(a, b), 0.5), true, boom);
    });
    return boom;
  }

  /** Removes a part from play (detonated, popped): it collides with nothing and stops simulating. */
  private kill(i: number): void {
    this.st.alive[i] = false;
    this.st.lit[i] = false;
    this.applyAlive(i);
  }

  /**
   * A body out of play: a broken part's base and arm, or an unbroken part's chunks. Nothing may push one.
   * `applyAlive` zeroes their velocity on restore, so an impulse kept in a straight run would desync the
   * rolled-back one (found by the critter soak on a broken PLANK and FISHBOWL).
   */
  private hiddenBody(i: number, role: string): boolean {
    const broken = this.st.broken[i]!;
    return role === 'chunk' ? !broken : (role === 'base' || role === 'arm') && broken;
  }

  private applyAlive(i: number): void {
    const p = this.parts[i]!;
    const broken = this.st.broken[i]!;
    for (const bi of [p.base, p.arm, ...p.chunks]) {
      if (bi < 0) continue;
      const b = this.bodies[bi]!;
      const id = b.body.GetID();
      const on = this.st.alive[i]! && (b.role === 'chunk' ? broken : !broken);
      this.bi.SetObjectLayer(id, on ? (b.ghost ? L_GHOST : b.dynamic ? L_MOVING : L_STATIC) : L_GHOST);
      if (b.dynamic) {
        this.bi.SetGravityFactor(id, f32(on ? (b.role === 'base' ? p.def.body.gravityFactor ?? 1 : 1) : 0));
        if (!on) { this.bi.SetLinearVelocity(id, this.v3(0, 0, 0)); this.bi.SetAngularVelocity(id, this.v3(0, 0, 0)); }
      }
    }
  }

  /**
   * Breakage (SIMULATION §6.2): the part's body leaves play and its pre-built chunks take over at
   * the matching pose and velocity, pushed apart by 0.5 m/s × h, where h ∈ [0.5, 1] is a hash of
   * (part id, chunk index): varied but not random.
   */
  private breakPart(i: number, at: readonly number[], cause = -1): void {
    if (!this.shatter(i)) return;
    this.emit('Break', i, at, 0, cause);
  }

  /**
   * Puts a part's pre-built chunks into play in place of its body (no event; callers emit their own Break).
   * PLANK halves sit at ±L/4 along the board; generated fracture chunks (fracOf) sit at the part pose with
   * their hulls in part space and fly out from the part's centre. Returns false if already broken or chunkless.
   */
  shatter(i: number): boolean {
    const st = this.st;
    const p = this.parts[i]!;
    if (st.broken[i] || !p.chunks.length) return false;
    const frac = fracOf(p.def.type);
    const main = this.bodies[p.base]!.body;
    const pos = main.GetPosition(), rot = main.GetRotation();
    const P: Vec = [pos.GetX(), pos.GetY(), pos.GetZ()], Rq: Q = [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()];
    const lv = main.GetLinearVelocity();
    const v: Vec = [lv.GetX(), lv.GetY(), lv.GetZ()];
    const av = main.GetAngularVelocity();
    const w: Vec = [av.GetX(), av.GetY(), av.GetZ()];
    const L = frac ? 0 : p.def.shapes(p.props)[0]!.size[2];
    const mid = frac ? vscale(vadd(p.def.bounds.min, p.def.bounds.max), 0.5) : [0, 0, 0]; // the part's centre (part space)
    st.broken[i] = true;
    st.lit[i] = false;
    this.applyAlive(i);
    p.chunks.forEach((bi, k) => {
      const local: Vec = frac ? frac.chunks[k]!.centre as Vec : [0, 0, (k === 0 ? -1 : 1) * L / 4];
      const off = qrot(Rq, local);
      const cp = frac ? P : vadd(P, off); // fracture bodies keep the part pose (hull in part space)
      const out = frac ? qrot(Rq, vsub(local, mid as Vec)) : off;
      const h = 0.5 + 0.5 * (((p.id % 4294967296) * 2654435761 + k * 40503) % 1000) / 1000;
      const vel = vadd(vadd(v, vcross(w, off)), vscale(vnorm(out), 0.5 * h));
      const id = this.bodies[bi]!.body.GetID();
      this.bi.SetPositionRotationAndVelocity(id, new this.Jolt.RVec3(f32(cp[0]), f32(cp[1]), f32(cp[2])), new this.Jolt.Quat(f32(Rq[0]), f32(Rq[1]), f32(Rq[2]), f32(Rq[3])),
        this.v3(vel[0], vel[1], vel[2]), new this.Jolt.Vec3(f32(w[0]), f32(w[1]), f32(w[2])));
      this.bi.ActivateBody(id);
    });
    return true;
  }

  private crack(mi: number, cause = -1): void {
    const m = this.mortars[mi]!;
    if (this.st.mortar[mi]) return;
    this.st.mortar[mi] = true;
    m.constraint.SetEnabled(false);
    this.bi.ActivateBody(this.bodies[this.parts[m.a]!.base]!.body.GetID());
    this.bi.ActivateBody(this.bodies[this.parts[m.b]!.base]!.body.GetID());
    const id = this.emit('Break', m.a, vscale(vadd(this.com(m.a), this.com(m.b)), 0.5), 0, cause >= 0 ? cause : Math.max(this.st.lastEv[m.a]!, this.st.lastEv[m.b]!), m.b);
    this.st.lastEv[m.b] = id;
  }

  // stage 10: constraints (mortar breaks, plank burn-through), plus faults (brownout, jam)
  private stageConstraints(t: number): void {
    const st = this.st;
    this.mortars.forEach((m, mi) => {
      if (st.mortar[mi]) return;
      if (!st.alive[m.a] || !st.alive[m.b]) { this.crack(mi); return; }
      const l = m.constraint.GetTotalLambdaPosition();
      const lx = l.GetX(), ly = l.GetY(), lz = l.GetZ();
      if (Math.sqrt(lx * lx + ly * ly + lz * lz) > m.strength) this.crack(mi);
    });
    for (const i of this.busy) { // S3: planks, consumers and motors are never inert
      if (!st.alive[i]) continue;
      const p = this.parts[i]!;
      if (p.def.type === 'plank' && st.lit[i] && st.burnAt[i]! >= 0 && t - st.burnAt[i]! >= 6 * this.tickRate) this.breakPart(i, this.com(i), st.litCause[i]!);
      if (p.def.power?.consumer) {
        // Brownout: supply factor below 0.5 for a second (SIMULATION §5.5)
        const f = st.supply[i]!;
        st.lowSupply[i] = f > 0 && f < 0.5 ? st.lowSupply[i]! + 1 : 0;
        if (st.lowSupply[i] === this.tickRate) { st.fault[i] = true; this.emit('Brownout', i, this.com(i)); }
        if (f >= 0.5 && st.fault[i] && p.def.type !== 'motor') st.fault[i] = false;
      }
      if (p.def.type === 'motor' && p.hinge) {
        // Jam: powered but held below 5 % of its target speed at full torque for 30 ticks (SIMULATION §5.3)
        const f = st.supply[i]!;
        const w = this.bodies[p.arm]!.body.GetAngularVelocity();
        const axis = qrot(p.rot, p.def.hinge!.axis);
        const speed = Math.abs(w.GetX() * axis[0] + w.GetY() * axis[1] + w.GetZ() * axis[2]);
        const stalled = f > 0 && speed < 0.05 * 9.42 * f;
        st.stall[i] = stalled ? st.stall[i]! + 1 : Math.max(0, st.stall[i]! - 1);
        if (st.stall[i] === 30 && !st.fault[i]) { st.fault[i] = true; this.emit('Jam', i, this.local(i, [0.101, 0.1, 0])); }
        if (st.stall[i] === 0 && st.fault[i] && st.lowSupply[i] === 0) st.fault[i] = false;
      }
    }
  }

  // ---- checkpoints and rollback (SIMULATION §11) ------------------------------------------------------

  /** Jolt's full state as bytes (StateRecorderJS: Jolt streams into JS, so checkpoints live in JS memory). */
  private saveJolt(): Uint8Array {
    const J = this.Jolt;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const rec = new J.StateRecorderJS();
    rec.WriteBytes = (ptr: number, n: number) => { chunks.push(J.HEAPU8.slice(ptr, ptr + n)); total += n; };
    rec.ReadBytes = () => {};
    rec.IsEOF = () => false;
    rec.IsFailed = () => false;
    this.system.SaveState(rec, J.EStateRecorderState_All);
    J.destroy(rec);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  private loadJolt(bytes: Uint8Array): boolean {
    const J = this.Jolt;
    let off = 0, failed = false;
    const rec = new J.StateRecorderJS();
    rec.ReadBytes = (ptr: number, n: number) => {
      if (off + n > bytes.length) { failed = true; return; }
      J.HEAPU8.set(bytes.subarray(off, off + n), ptr);
      off += n;
    };
    rec.WriteBytes = () => {};
    rec.IsEOF = () => off >= bytes.length;
    rec.IsFailed = () => failed;
    const ok = this.system.RestoreState(rec);
    J.destroy(rec);
    return ok && !failed;
  }

  checkpoint(): void {
    if (this.checkpoints.length >= this.keepCheckpoints) this.dropCheckpoint(this.checkpoints.shift()!);
    // S3: big worlds keep Jolt state in the (sized) WASM heap; small ones keep bytes in JS as before, so the many
    // short-lived machines of tests and soaks sharing one 128 MB heap never fill it
    // MI (M4): plus the Matter record (backend snapshot, pending results, proxy ring) every matter checkpoint interval
    // SIMFIX: `st` is copied by clonePlain (plain arrays sliced), ≈ 5× faster than structuredClone on big worlds
    this.checkpoints.push({ tick: this.st.tick, jolt: this.parts.length > BIG_WORLD ? this.saveJoltRec() : this.saveJolt(), st: clonePlain(this.st), matter: this.matter.checkpoint(this.st.tick) });
  }

  /**
   * S3: Jolt state kept inside the WASM heap (StateRecorderImpl): the same SaveState bytes, ~5× faster to save than
   * streaming them into JS a few bytes per callback (100k bodies: 30 ms vs 150 ms plus GC), and restored without
   * copying. Bytes leave the heap only for desync repair (exportCheckpoint).
   */
  private saveJoltRec(): JoltModule {
    const rec = new this.Jolt.StateRecorderImpl();
    this.system.SaveState(rec, this.Jolt.EStateRecorderState_All);
    return rec;
  }

  private dropCheckpoint(cp: Checkpoint): void {
    if (!(cp.jolt instanceof Uint8Array)) this.Jolt.destroy(cp.jolt);
    this.matter.release(cp.matter); // MI (M4)
  }

  /** S3: restores a checkpoint's Jolt state from either form. */
  private loadJoltAny(j: Uint8Array | JoltModule): boolean {
    if (j instanceof Uint8Array) return this.loadJolt(j);
    j.Rewind();
    return this.system.RestoreState(j);
  }

  /** S3: a checkpoint's Jolt bytes (restores it into the system, reads it out, then puts the live state back). */
  private joltBytes(j: Uint8Array | JoltModule): Uint8Array {
    if (j instanceof Uint8Array) return j;
    const live = this.saveJoltRec();
    try {
      this.loadJoltAny(j);
      return this.saveJolt();
    } finally {
      this.loadJoltAny(live);
      this.Jolt.destroy(live);
    }
  }

  /** Earliest tick we can roll back to. MI (M4): with Matter on, only checkpoints holding a Matter snapshot count. */
  get oldestCheckpoint(): number { return this.checkpoints.find((c) => this.matter.usable(c.matter))?.tick ?? Infinity; }

  /** Restores the newest checkpoint at or before `tick`. Returns the restored tick, or −1. */
  restore(tick: number): number {
    let cp: Checkpoint | undefined;
    for (const c of this.checkpoints) if (c.tick <= tick && this.matter.usable(c.matter)) cp = c; // MI (M4): Matter snapshots every 2 s
    if (!cp) return -1;
    this.applyCheckpoint(cp);
    // drop newer checkpoints: they describe a future that no longer happens
    while (this.checkpoints.length && this.checkpoints.at(-1)!.tick > cp.tick) this.dropCheckpoint(this.checkpoints.pop()!);
    return cp.tick;
  }

  private applyCheckpoint(cp: Checkpoint): void {
    if (!this.loadJoltAny(cp.jolt)) throw new Error(`checkpoint at tick ${cp.tick} failed to restore`);
    const was = this.st;
    this.st = clonePlain(cp.st); // SIMFIX: as checkpoint()
    // state Jolt doesn't record: object layers, gravity factors, rope and mortar enable flags. S3: layers and
    // gravity follow (alive, broken) and nothing else touches them, so only parts whose pair changed need it
    for (let i = 0; i < this.parts.length; i++) if (was.alive[i] !== this.st.alive[i] || was.broken[i] !== this.st.broken[i]) this.applyAlive(i);
    this.lines.forEach((l, li) => l.constraint.SetEnabled(!this.st.cut[li]));
    this.mortars.forEach((m, mi) => m.constraint.SetEnabled(!this.st.mortar[mi]));
    this.bands.forEach((b, bi) => b.constraint.SetEnabled(!this.st.bandCut[bi]));
    this.critters.afterRestore(); // ragdoll layers, joint enables, ghost bases
    this.x.afterRestore(); // M2: seated corks, held cannon balls, toggle topology
    this.matter.afterRestore(cp.matter); // MI (M4): backend snapshot, pending results, proxy ring
    this.allDirty = true; // S3: every pose may differ now (changedTransforms)
  }

  /**
   * Desync repair (MULTIPLAYER §7.4): the newest checkpoint at or before `tick` as one blob, for the sync authority to
   * send to its partner. MI (M4): a KNCP container (DATA_FORMATS §6: JOLT, ECS = the JSON state, MATR with Matter on).
   */
  exportCheckpoint(tick: number): { tick: number; blob: Uint8Array } | null {
    let cp: Checkpoint | undefined;
    for (const c of this.checkpoints) if (c.tick <= tick && this.matter.usable(c.matter)) cp = c;
    if (!cp) return null;
    const state = new TextEncoder().encode(JSON.stringify(cp.st));
    const jolt = this.joltBytes(cp.jolt);
    const blob = encodeCheckpoint({ tick: cp.tick, jolt, state, ...(cp.matter ? { matr: exportMatter(this.matter, cp.matter) } : {}) });
    return { tick: cp.tick, blob };
  }

  /** Adopts a partner's checkpoint: the test system continues from exactly their state. */
  importCheckpoint(blob: Uint8Array): number {
    const k = decodeCheckpoint(blob); // MI (M4): KNCP
    const st = JSON.parse(new TextDecoder().decode(k.state)) as State;
    const cp: Checkpoint = { tick: st.tick, jolt: k.jolt.slice(), st, matter: k.matr ? importMatter(this.matter, k.matr) : undefined };
    this.applyCheckpoint(cp);
    while (this.checkpoints.length && this.checkpoints.at(-1)!.tick >= cp.tick) this.dropCheckpoint(this.checkpoints.pop()!);
    this.checkpoints.push(cp);
    return cp.tick;
  }

  // ---- output -------------------------------------------------------------------------------------------

  get tick(): number { return this.st.tick; }

  /** S3: rigid bodies Jolt is simulating this tick (awake), for the perf HUD, time dilation and the bench. */
  awakeBodies(): number { return this.destroyed ? 0 : this.system.GetNumActiveBodies(this.Jolt.EBodyType_RigidBody); }

  bodyInfo(): BodyInfo[] {
    return this.bodies.map((b) => ({ part: this.parts[b.part]!.id, type: this.parts[b.part]!.def.type, role: b.role, ...(b.chunk !== undefined ? { chunk: b.chunk } : {}), ...(b.bone !== undefined ? { bone: b.bone } : {}) }));
  }

  /**
   * Critter state per keyframe (contract 3): 4 bytes per part, part order. Critters: [clip
   * (CRITTER_CLIPS), flags (CritterFlagBits), emote (CRITTER_EMOTES, 0 none), fsm (CRITTER_FSM)].
   * Critter-bound devices: [seconds left on the run timer, DeviceFlagBits, 0, phase]. Others: 0.
   */
  critterState(out: Uint8Array): Uint8Array { return this.critters.critterState(out); }

  /**
   * Carried items (Bandit's loot): pairs [critter part index, carried part index], part order, one pair per
   * critter carrying something; usually empty. The item's body is a ghost at the critter's `prop_r`.
   */
  critterCarry(): Int32Array { return this.critters.critterCarry(); }

  /**
   * B5 (M5): what BUZZ is after (the run-mode tag glyph over its target, U5): pairs [BUZZ part index, item part index], part
   * order, while it flies to or winches up a tagged item; usually empty. Derived from `st.crit`, so rollback covers it.
   */
  critterTargets(): Int32Array { return this.critters.critterTargets(); }

  /** What the critter system may touch (critters/system.ts). */
  private critterHost(extra: readonly ExtraLure[]): CritterHost {
    const self = this;
    return {
      // resolved when the critter system initialises, once parts exist (unknown part ids are dropped)
      extraLures: () => extra.flatMap((l) => {
        const part = l.part !== undefined ? self.byId.get(l.part) ?? -2 : -1;
        return part === -2 ? [] : [{ part, pos: l.pos ?? null, radius: l.radius, species: l.species }];
      }),
      J: this.Jolt, jolt: this.jolt, system: this.system, bi: this.bi, bodies: this.bodies, parts: this.parts,
      tickRate: this.tickRate, seed: this.seed, layers: { static: L_STATIC, moving: L_MOVING, ghost: L_GHOST },
      st: () => self.st,
      emit: (kind, part, pos, mag, other, cause) => self.emit(kind as EventKind, part, pos, mag, cause ?? -1, other ?? -1),
      cause: (part) => (part >= 0 ? self.st.lastEv[part] ?? -1 : -1),
      sounds: () => self.tickSounds(),
      lines: () => self.lines.map((l, li) => ({ a: l.a.part, aPort: l.a.port.name, b: l.b.part, bPort: l.b.port.name, cut: self.st.cut[li]! })),
      applyAlive: (i) => self.applyAlive(i),
      shatter: (i) => self.shatter(i),
      // B4 (M4): HENNY's YOLK pool shapes, BISCUIT's bark, DUSTY's charge leash and Matter intake
      shapeFor: (key, shapes) => self.shapeFor(key, shapes),
      sound: (pos, dB, part, cause) => self.sound(pos, dB, part, cause),
      powerLinked: (part) => self.links.some((l) => l.kind === 'cable_power' && ((l.from && self.byId.get(l.from.part) === part) || (l.to && self.byId.get(l.to.part) === part))),
      matter: () => self.matter ?? null,
      // B5 (M5): A5's BUZZ BEACON channel (M5_NOTES_A5 contract 3), read structurally so either stream can land first
      beacons: () => (self.x as unknown as { m5?: BeaconHost }).m5 ?? null,
      // B5 (M5): A5's RIFT GATE pairing, so critters walk into a paired gate's aperture (m5_rift.ts moves them through)
      riftPartner: (part) => (self.x as unknown as { m5?: { partner: readonly number[] } }).m5?.partner[part] ?? -1,
    };
  }

  /** Stream A's `soundsThisTick` (valid in stage 6) with part indices, for critter hearing. */
  private tickSounds(): SoundIn[] {
    return this.soundsThisTick.map((s) => ({ pos: s.pos, dB: s.dB, part: this.byId.get(s.part) ?? -1, cause: s.cause }));
  }

  // ---- S3: sparse output for big worlds (bake keyframes only store what moved) ---------------------------

  /** Jolt body index → our body index (−1: not a part body). Built on first use, after every body exists. */
  private joltToBody: Int32Array | null = null;
  /** Bodies active at the previous changedTransforms call (their final, at-rest pose must be stored too). */
  private wasActive = new Set<number>();
  private allDirty = true;
  private activeVec: JoltModule = null;
  private readonly alwaysReport: number[] = [];

  /**
   * Bodies whose pose may have changed since the previous call (awake now or awake then, which catches a body's
   * last pose as it falls asleep), with their [x, y, z, qx, qy, qz, qw]. Everything after construction and after
   * any restore. O(awake bodies): Domino Day's 100k tiles cost what its few thousand awake ones do.
   */
  changedTransforms(): { idx: Int32Array; xf: Float32Array } {
    const J = this.Jolt;
    if (!this.joltToBody) {
      let max = 0;
      for (const b of this.bodies) max = Math.max(max, b.body.GetID().GetIndex());
      this.joltToBody = new Int32Array(max + 1).fill(-1);
      this.bodies.forEach((b, i) => { this.joltToBody![b.body.GetID().GetIndex()] = i; if (b.role === 'rag' || b.role === 'piece') this.alwaysReport.push(i); });
      this.activeVec = new J.BodyIDVector();
    }
    const now = new Set<number>();
    this.activeVec.clear();
    this.system.GetActiveBodies(J.EBodyType_RigidBody, this.activeVec);
    for (let k = 0, n = this.activeVec.size(); k < n; k++) {
      const ji = this.activeVec.at(k).GetIndex();
      const bi = ji < this.joltToBody.length ? this.joltToBody[ji]! : -1;
      if (bi >= 0) now.add(bi);
    }
    let list: number[];
    if (this.allDirty) { list = this.bodies.map((_, i) => i); this.allDirty = false; }
    else {
      const u = new Set(now);
      for (const b of this.wasActive) u.add(b);
      // ragdoll capsules and spawned pieces can be placed while dormant: always report them (there are few)
      for (const i of this.alwaysReport) u.add(i);
      list = [...u].sort((a, b) => a - b);
    }
    this.wasActive = now;
    const idx = Int32Array.from(list);
    const xf = new Float32Array(idx.length * 7);
    for (let k = 0; k < idx.length; k++) {
      const b = this.bodies[idx[k]!]!.body;
      const p = b.GetPosition();
      const q = b.GetRotation();
      const o = k * 7;
      xf[o] = p.GetX(); xf[o + 1] = p.GetY(); xf[o + 2] = p.GetZ();
      xf[o + 3] = q.GetX(); xf[o + 4] = q.GetY(); xf[o + 5] = q.GetZ(); xf[o + 6] = q.GetW();
    }
    return { idx, xf };
  }

  private inertBits: Uint8Array | null = null;
  /** S3: 1 for INERT parts, part order. */
  private inertMask(): Uint8Array {
    if (!this.inertBits) {
      this.inertBits = new Uint8Array(this.parts.length).fill(1);
      for (const i of this.busy) this.inertBits[i] = 0;
    }
    return this.inertBits;
  }

  /** B5 (M5): PartFlagBits.tagged per part (the snapshot's PartFlag.Tagged, critters excepted), built on first use. */
  private taggedBitsCache: Uint8Array | null = null;
  private taggedBits(): Uint8Array {
    if (!this.taggedBitsCache) {
      this.taggedBitsCache = new Uint8Array(this.parts.length);
      this.parts.forEach((p, i) => { if ((p.flags & PartFlag.Tagged) !== 0 && !p.def.critter) this.taggedBitsCache![i] = PartFlagBits.tagged; });
    }
    return this.taggedBitsCache;
  }

  /** S3: no body awake (with the per-part state that can still fire later, a run is "settled" once this holds a while). */
  get asleep(): boolean { return this.awakeBodies() === 0 && this.st.booms.length === 0; }

  /** Writes [x, y, z, qx, qy, qz, qw] per body into `out`. */
  transforms(out: Float32Array): Float32Array {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!.body;
      const p = b.GetPosition();
      const q = b.GetRotation();
      const o = i * 7;
      out[o] = p.GetX(); out[o + 1] = p.GetY(); out[o + 2] = p.GetZ();
      out[o + 3] = q.GetX(); out[o + 4] = q.GetY(); out[o + 5] = q.GetZ(); out[o + 6] = q.GetW();
    }
    return out;
  }

  /** Visual flags per part (PartFlagBits), part order. */
  partFlags(out: Uint8Array): Uint8Array {
    const st = this.st;
    const inert = this.inertMask();
    const tg = this.taggedBits(); // B5 (M5): PartFlagBits.tagged from the snapshot
    for (let i = 0; i < this.parts.length; i++) {
      if (inert[i]) { out[i] = (st.alive[i] ? 0 : PartFlagBits.dead) | tg[i]!; continue; } // S3: nothing else can be set on them
      let f = tg[i]!;
      if (st.lit[i]) f |= PartFlagBits.lit;
      if (st.supply[i]! > 0 || st.mainsOn[i]) f |= PartFlagBits.powered;
      if (st.pressed[i]! > 0) f |= PartFlagBits.pressed;
      if (!st.alive[i]) f |= PartFlagBits.dead;
      if (st.broken[i]) f |= PartFlagBits.broken;
      if (st.fault[i]) f |= PartFlagBits.fault;
      if (st.armedAt[i]! >= 0) f |= PartFlagBits.armed;
      if (st.alive[i]) f |= this.x.flags(i); // M2 parts (channels/index.ts)
      out[i] = f;
    }
    return out;
  }

  /**
   * Screen readouts per part (part order), for engine-drawn screens: 0 = dark; MAINS shows its network's
   * demand against supply as 1–21 (level (n − 1) / 20) and 31 when demand exceeds supply. Read-only.
   */
  partMeters(out: Uint8Array): Uint8Array {
    out.fill(0);
    const st = this.st;
    const S = new Map<number, number>(), D = new Map<number, number>();
    for (const i of this.powerParts) { // S3: only parts with power
      const pw = this.parts[i]!.def.power;
      if (!pw || !st.alive[i]) continue;
      const c = this.powerComp[i]!;
      if (pw.source) { const w = this.sourceWatts(i); if (w > 0) S.set(c, (S.get(c) ?? 0) + w); }
      if (pw.consumer) D.set(c, (D.get(c) ?? 0) + this.x.demand(i, pw.consumer));
    }
    for (const i of this.busy) { // S3: inert parts have no screen
      if (st.alive[i] && this.parts[i]!.def.type !== 'mains') { const m = this.x.meter(i); if (m) out[i] = m; continue; } // M2 screens
      if (this.parts[i]!.def.type !== 'mains' || !st.mainsOn[i] || !st.alive[i]) continue;
      const c = this.powerComp[i]!;
      const s = S.get(c) ?? 0, d = D.get(c) ?? 0;
      out[i] = d > s ? 31 : 1 + Math.round((20 * d) / Math.max(s, 1));
    }
    return out;
  }

  /**
   * A4: fill per part (part order), 0–1, for R4's container fill pass and keyframes: Matter containers' stored quantity
   * over capacity (GRIT HOPPER, TANK, SPRINKLE CAN, SPONGE, MARBLE HOPPER), HOURGLASS's local-top bulb, and a HELIO
   * seated on an INFLATOR (its inflation, `sk_inflate`, up to 1.1), plus MI's Matter containers (FISHBOWL, SCOOP:
   * `matterFill`). Every other part reads 0. One array for every container, so R4 reads this one. Read-only.
   */
  /**
   * A4: ZIPPY wheels for the renderer, 9 floats per ZIPPY (part order): [part index, wheel rotation angle (rad) × 4,
   * suspension length (m) × 4], wheels FL, FR, RL, RR (Jolt's vehicle state). Read-only.
   */
  vehicleWheels(): Float32Array { return this.x.m4.wheels(); }

  /**
   * A5: GRABBER joints for the renderer (PIVOT__yaw / shoulder / elbow / wrist_pitch / wrist_roll / finger_l / finger_r),
   * 8 floats per GRABBER (part order): [part index, yaw, shoulder, elbow, wrist pitch, wrist roll (rad), finger opening
   * per side (m), held 0 / 1]. Its link bodies are also in bodyInfo (role 'piece', chunk 0–2). Read-only.
   */
  grabberJoints(): Float32Array { return this.x.m5.joints(); }

  partFill(out: Float32Array): Float32Array {
    this.matter.fills(out); // MI's containers (0 for the rest)
    for (const i of this.busy) if (this.st.alive[i]) { const f = this.x.fill(i); if (f > 0 || out[i] === 0) out[i] = f; }
    return out;
  }

  /** Link state per link (link order): 4 floats [cut, burnA, burnB, burning] for ropes and fuses. */
  linkState(out: Float32Array): Float32Array {
    out.fill(0);
    this.lines.forEach((l, li) => { out[l.link * 4] = this.st.cut[li] ? 1 : 0; });
    this.fuses.forEach((f, fi) => {
      const iv = this.st.fuse[fi]!;
      if (!iv.length) return;
      // first and last burnt extents as fractions (the renderer draws the burnt cord and the sparks)
      out[f.link * 4 + 1] = iv[0]! / f.length;
      out[f.link * 4 + 2] = iv[iv.length - 1]! / f.length;
      out[f.link * 4 + 3] = iv.some((x) => x > 0 && x < f.length) ? 1 : 0;
    });
    return out;
  }

  /** SIMULATION §10.4: quantized bodies (alive ones) + gameplay state, id order. */
  hash(): string {
    const h = new Hasher();
    const st = this.st;
    h.u32(st.tick);
    for (const ref of this.bodies) {
      const part = this.parts[ref.part]!;
      if (!st.alive[ref.part]) continue;
      const p = ref.body.GetPosition();
      const q = ref.body.GetRotation();
      h.u32(part.id % 4294967296).u32(Math.floor(part.id / 4294967296)).u32(ref.role === 'arm' ? 1 : 0);
      h.q(p.GetX(), 1e-5).q(p.GetY(), 1e-5).q(p.GetZ(), 1e-5);
      h.q(q.GetX(), 1 / 32767).q(q.GetY(), 1 / 32767).q(q.GetZ(), 1 / 32767).q(q.GetW(), 1 / 32767);
    }
    for (let i = 0; i < this.parts.length; i++) {
      h.bool(st.alive[i]!).bool(st.lit[i]!).i32(st.armedAt[i]!).bool(st.mainsOn[i]!).q(st.supply[i]!, 1e-4);
    }
    st.cut.forEach((c) => h.bool(c));
    st.mortar.forEach((c) => h.bool(c));
    st.broken.forEach((c) => h.bool(c));
    st.fuse.forEach((iv) => { h.u32(iv.length); iv.forEach((x) => h.q(x, 1e-5)); });
    this.critters.hash(h); // critter FSMs, timers, RNG streams, device states
    this.x.hash(h); // M2 channel state (only when the machine has M2 parts)
    this.matter.hash(h); // MI (M4): the Matter checksum, counts, container contents (only with Matter on)
    if (this.zonesHash >= 0) h.u32(0x7a6f6e65).bool(this.zonesHash === 1); // W5 (M5): env.zones, in worlds with zero-g zones only
    if (this.wind) { const w = this.wind.setting; h.u32(0x77696e64).u32(Math.round(w.speed * 10)).u32(w.dir).u32(['none', 'breezy', 'gusty', 'overcast'].indexOf(w.gusts ?? 'none')); } // W5 (M5, D26): wind, when there is any
    return toHex64(h.digest());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cp of this.checkpoints) this.dropCheckpoint(cp); // S3: recorders live in the WASM heap
    this.checkpoints.length = 0;
    this.Jolt.destroy(this.jolt);
    this.cbuf.destroy(); // J4
    this.matter.destroy(); // MI (M4): the backend (or link)
  }

  /** MI (M4): Matter fill per part (0–1; containers only, part order) for keyframes and R4's fill pass. */
  matterFill(out: Float32Array): Float32Array { return this.matter.fills(out); }
}

/**
 * SIMFIX: a deep copy of plain, JSON-safe data (the run state `st`): arrays of primitives are sliced, nested arrays and
 * plain objects copied member by member (insertion order), typed arrays sliced. The same result as structuredClone for
 * such data except that shared references aren't kept shared (as after a JSON round trip, which desync repair already
 * relies on), at a fraction of the cost: a 77k-part world's `st` in ≈ 5 ms instead of ≈ 22 ms.
 */
export function clonePlain<T>(x: T): T {
  if (Array.isArray(x)) {
    const n = x.length;
    let flat = true;
    for (let i = 0; i < n; i++) { const v: unknown = x[i]; if (v !== null && typeof v === 'object') { flat = false; break; } }
    if (flat) return x.slice() as T;
    const out = new Array<unknown>(n);
    for (let i = 0; i < n; i++) out[i] = clonePlain(x[i]);
    return out as T;
  }
  if (x !== null && typeof x === 'object') {
    if (ArrayBuffer.isView(x)) return (x as unknown as { slice(): T }).slice();
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x)) out[k] = clonePlain((x as Record<string, unknown>)[k]);
    return out as T;
  }
  return x;
}

function tiltQuat(deg: number): Q {
  const half = (deg * Math.PI) / 360;
  return [0, 0, dsin(half), dcos(half)];
}

function covers(iv: readonly number[], s: number): boolean {
  for (let k = 0; k < iv.length; k += 2) if (s >= iv[k]! - 1e-9 && s <= iv[k + 1]! + 1e-9) return true;
  return false;
}

function mergeIntervals(iv: number[]): void {
  if (iv.length <= 2) return;
  const pairs: [number, number][] = [];
  for (let k = 0; k < iv.length; k += 2) pairs.push([iv[k]!, iv[k + 1]!]);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const p of pairs) {
    const last = out.at(-1);
    if (last && p[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], p[1]);
    else out.push([p[0], p[1]]);
  }
  iv.length = 0;
  for (const [a, b] of out) iv.push(a, b);
}

/** Point at fraction t of a polyline's length. */
function pointAlong(path: readonly Vec[], t: number): Vec {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += vlen(vsub(path[k]!, path[k - 1]!));
  let want = t * total;
  for (let k = 1; k < path.length; k++) {
    const seg = vlen(vsub(path[k]!, path[k - 1]!));
    if (want <= seg || k === path.length - 1) return vadd(path[k - 1]!, vscale(vsub(path[k]!, path[k - 1]!), seg > 0 ? Math.min(1, want / seg) : 0));
    want -= seg;
  }
  return path[0]!;
}

/** Shortest-arc rotation taking unit vector a to unit vector b. */
function fromTo(a: Vec, b: Vec): Q {
  const d = vdot(a, b);
  if (d < -0.999999) return [1, 0, 0, 0];
  const c = vcross(a, b);
  const s = Math.sqrt((1 + d) * 2);
  return [c[0] / s, c[1] / s, c[2] / s, s / 2];
}

/** Does segment p→q pass through an oriented box (ignoring the last millimetre at each end)? */
function segmentHitsBox(p: Vec, q: Vec, box: StaticBox): boolean {
  const inv: Q = [-box.rot[0], -box.rot[1], -box.rot[2], box.rot[3]];
  const o = qrot(inv, vsub(p, box.c));
  const d = qrot(inv, vsub(q, p));
  let t0 = 0.001, t1 = 0.999;
  for (let i = 0; i < 3; i++) {
    const h = box.half[i]!;
    if (Math.abs(d[i]!) < 1e-12) { if (Math.abs(o[i]!) > h) return false; continue; }
    let a = (-h - o[i]!) / d[i]!, b = (h - o[i]!) / d[i]!;
    if (a > b) { const x = a; a = b; b = x; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Unit quaternion from an orthonormal basis (columns x, y, z). */
function quatFromBasis(x: Vec, y: Vec, z: Vec): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}
