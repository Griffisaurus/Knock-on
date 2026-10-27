// What the M2 channel modules see of the Machine (stream A). The Machine passes itself as a `Host`
// (machine.ts: `this as unknown as Host`), so these names must match its members: renaming one there
// means renaming it here. Everything gameplay-relevant the modules keep is in `st.m2` (plain data,
// checkpointed with the rest of `st`).

import type { LinkRecord, PartId } from '@knockon/format';
import type { JoltModule } from '@knockon/jolt';
import type { PartDef, PortDef, Props, ShapeDef } from '@knockon/parts-data';
import type { Q, Vec } from '../vec.ts';
import type { EventKind } from '../machine.ts';

export const L_STATIC = 0, L_MOVING = 1, L_GHOST = 2;

export interface HostBody { readonly part: number; readonly role: string; readonly body: JoltModule; readonly dynamic: boolean; readonly ghost: boolean; readonly chunk?: number }
export interface HostPart {
  readonly id: PartId;
  readonly def: PartDef;
  readonly props: Props;
  readonly pos: Vec;
  readonly rot: Q;
  base: number;
  arm: number;
  hinge: JoltModule | null;
  readonly portIndex: ReadonlyMap<string, number>;
  readonly chunks: number[];
}
export interface HostEnd { readonly part: number; readonly port: PortDef }

/** The M2 channel state (SIMULATION §5.5–5.11): per-part arrays in part order, plus queues. */
export interface M2State {
  /** Per part: the part's main on/off state (torch lit, toggle on, flap open, ringer armed, fired, popped, loaded…). */
  on: number[];
  /** Per part: tick its current phase started (−1 = none). */
  t0: number[];
  /** Per part: state-machine phase (flap, punchline, skyrocket, big top). */
  phase: number[];
  /** Per part: a value (cell charge J, dynamo available W, suncell light, crank angle). */
  val: number[];
  /** Per part: a second value (dynamo drawn W). */
  val2: number[];
  /** Per part: the event that set the current action going (causeId, −1 = none). */
  cause: number[];
  /** Per part (BIG TOP): index of the held Roller, −1 = empty. */
  held: number[];
  /** Pending DELAY pulses: [dueTick, part, cause] … */
  delays: number[];
  /** Queued PUFFER puffs for the next stage 6: [part, impulse N·s, cause] … */
  puffs: number[];
  /** Sounds emitted since the last stage-6 swap: [x, y, z, dB, part, cause] … */
  snd: number[];
  /** Sounds perceivable during this tick's stage 6 (contract 2): same layout. */
  sndNow: number[];
  /** M3 parts (stream A3): pools, rails, field holds… (m3.ts). */
  m3: M3State;
}

/** M3 run state (stream A3). Per-part arrays are in part order; slot arrays index the pre-built pools (m3.ts). */
export interface M3State {
  /** Per pool slot: 1 in play, 0 dormant (parked, ghost, no gravity, never pushed: rule 8). */
  live: number[];
  /** Per pool slot: tick it entered play (−1). */
  born: number[];
  /** Per pool slot: the y it was launched from (SKYSHOW shell altitude). */
  y0: number[];
  /** Per pool slot: the event that put it in play (Spawn / Launch), −1. */
  why: number[];
  /** Per part: a counter (FABRICATOR pending spawns, RECYCLER intake, TRIPWIRE debounce, PADDLE hold-until tick). */
  n: number[];
  /** Per part: tick of the last heat seen (POWDER KEG cook-off continuity), −1. */
  heatAt: number[];
  /** Per part: POWDER KEG cook-off exposure (s). */
  cook: number[];
  /** Per part (MAGLOCK): the part it holds, −1. */
  hold: number[];
  /** Per rider slot (GLIDEPATH; one per marble): rail index + 1 while riding, 0 = off. Pushed as rails are built. */
  ride: number[];
  /** Per rider slot: arc length along its rail's riders' line (m). */
  rideS: number[];
  /** Per rider slot: the unit tangent it was given last tick (3 numbers each). */
  rideT: number[];
  /** Per rider slot: the first tick it may be captured again. */
  rideCd: number[];
  /** Per PINS rack: 1 once its PinsAllDown is out. */
  strike: number[];
}

export function createM2State(n: number): M2State {
  return {
    on: new Array<number>(n).fill(0), t0: new Array<number>(n).fill(-1), phase: new Array<number>(n).fill(0),
    val: new Array<number>(n).fill(0), val2: new Array<number>(n).fill(0), cause: new Array<number>(n).fill(-1),
    held: new Array<number>(n).fill(-1), delays: [], puffs: [], snd: [], sndNow: [],
    m3: {
      live: [], born: [], y0: [], why: [], n: new Array<number>(n).fill(0), heatAt: new Array<number>(n).fill(-1),
      cook: new Array<number>(n).fill(0), hold: new Array<number>(n).fill(-1), ride: [], rideS: [], rideT: [], rideCd: [], strike: [],
    },
  };
}

/** The slice of the Machine's run state the channels read and write. */
export interface HostState {
  tick: number;
  alive: boolean[];
  lit: boolean[];
  supply: number[];
  pressed: number[];
  cooldown: number[];
  fault: boolean[];
  lastEv: number[];
  powerCause: number;
  m2: M2State;
  // M3: fuse stubs (POWDER KEG uses the Machine's bangstick countdown), breakables
  armedAt: number[];
  litCause: number[];
  broken: boolean[];
  /** SIMFIX: the critters' plain state (critters/state.ts), read-only here: who carries what (BIG TOP's restore). */
  readonly crit?: { readonly c: readonly { readonly carry: number }[] };
}

export interface HostLine { readonly link: number; readonly a: HostEnd; readonly b: HostEnd; readonly constraint: JoltModule; readonly sheave: number }
export interface HostBand { readonly link: number; readonly a: HostEnd; readonly b: HostEnd; readonly constraint: JoltModule }

export interface Host {
  readonly Jolt: JoltModule;
  readonly jolt: JoltModule;
  readonly system: JoltModule;
  readonly bi: JoltModule;
  readonly tickRate: number;
  readonly dt: number;
  readonly air: number;
  readonly bodies: HostBody[];
  readonly parts: HostPart[];
  readonly links: readonly LinkRecord[];
  readonly byId: ReadonlyMap<PartId, number>;
  readonly lines: readonly HostLine[];
  readonly bands: readonly HostBand[];
  readonly powerComp: number[];
  st: HostState;
  /** Emits an event (SimEvent) and returns its id. `part` and `other` are part indices (−1 = none). */
  emit(kind: EventKind, part: number, pos: readonly number[], mag?: number, cause?: number, other?: number): number;
  local(part: number, at: readonly number[], role?: 'base' | 'arm'): Vec;
  com(part: number): Vec;
  pulse(part: number, port: string, cause?: number): void;
  v3(x: number, y: number, z: number): JoltModule;
  shapeFor(key: string, shapes: readonly ShapeDef[]): JoltModule;
  addBody(shape: JoltModule, p: readonly number[], q: readonly number[], dynamic: boolean, ghost: boolean, friction: number, restitution: number,
    mass: number, ccd: boolean, gravityFactor: number, part: number, role?: string, asleep?: boolean, chunk?: number): number;
  portWorld(e: HostEnd): Vec;
  sound(pos: readonly number[], dB: number, part: number, cause?: number): number;
  // M3 (stream A3): Machine members the M3 parts need (private there; the Host cast reaches them)
  /** Signal receivers by source key `${part}:${port}` (PING relays its Rx outputs within the tick). */
  readonly signalOut: ReadonlyMap<string, HostEnd[]>;
  /** A signal reaching part `i`'s port now (Signal event, then the receiver's action). */
  receive(i: number, port: string, cause?: number): void;
  /** Queues part `i`'s detonation for stage 11 of tick `due`. */
  queueBoom(i: number, t: number, due: number, cause?: number): void;
  /** A blast of yield Y at P from part `i` (Machine.blast). */
  blast(P: Vec, Y: number, i: number, t: number, cause?: number, kill?: boolean): number;
  /** Takes a part out of play (RECYCLER). */
  kill(i: number): void;
  cutLine(li: number, at: readonly number[], event?: boolean, cause?: number): void;
  /** Puts a part's pre-built chunks into play (PANE, VASE). */
  shatter(i: number): boolean;
  /** Bodies out of play: broken parts' bases and arms, unbroken parts' chunks (rule 8). */
  hiddenBody(i: number, role: string): boolean;
}

/** Body pose helpers (Jolt value getters share one temporary: read components before the next call). */
export function bodyPos(b: JoltModule): Vec { const p = b.GetPosition(); return [p.GetX(), p.GetY(), p.GetZ()]; }
export function bodyRot(b: JoltModule): Q { const r = b.GetRotation(); return [r.GetX(), r.GetY(), r.GetZ(), r.GetW()]; }
export function bodyVel(b: JoltModule): Vec { const v = b.GetLinearVelocity(); return [v.GetX(), v.GetY(), v.GetZ()]; }
export function bodyAngVel(b: JoltModule): Vec { const v = b.GetAngularVelocity(); return [v.GetX(), v.GetY(), v.GetZ()]; }
