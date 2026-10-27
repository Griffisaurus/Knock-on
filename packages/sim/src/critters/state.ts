// Critter run state (SIMULATION §7.1): plain data inside the Machine's `st`, so checkpoints clone it,
// rollback restores it and the state hash covers it. Everything a critter or a critter-bound device
// remembers between ticks lives here; the CritterSystem object itself only holds build-time wiring.

import type { Hasher } from '@knockon/detmath';

/** One critter (`CritterState {fsmState, target, timers, rngStream, mood}`, flattened). */
export interface CritSt {
  /** FSM state (CRITTER_FSM index), ticks in it, its duration (−1 = open-ended). */
  fsm: number;
  t: number;
  dur: number;
  /** Visual hints for the renderer: clip (CRITTER_CLIPS), emote (CRITTER_EMOTES) and its ticks left. */
  clip: number;
  emote: number;
  emoteT: number;
  /** CritterFlagBits. */
  flags: number;
  /** xoshiro128** words of the critter's stream (`critter:<partId>`): idle variety only. */
  r0: number; r1: number; r2: number; r3: number;
  /** Steering goal (world x, z; y for Goby's swim point in bowl space), target part, desired speed, avoidance bias. */
  gx: number; gy: number; gz: number;
  target: number;
  speed: number;
  avoid: number;
  /** Loudest effective Sound (dB) since the last think and where it came from. */
  heard: number; hx: number; hy: number; hz: number;
  /** Its Sound event id (the cause of a startle). */
  hc: number;
  /** Strongest touch since the last think (N·s). */
  touch: number;
  /** Ragdoll: where the root was when its current still window began. */
  ax: number; ay: number; az: number;
  /** Ragdoll: ticks its root has been still, ticks ragdolled. */
  still: number;
  ragT: number;
  /** The Ragdoll event id (the cause of the Getup). */
  rid: number;
  /** Bound device (part index, −1 none), carried part (−1), trap box holding it (−1). */
  dev: number;
  carry: number;
  trap: number;
  /** A part it ignores (stolen, eaten, lost) until `ignoreT` ticks run out. */
  ignore: number;
  ignoreT: number;
  /** Home point (wander centre; Goby's rescue spot). */
  homeX: number; homeY: number; homeZ: number;
  /** Bowl-space swim position (Goby). */
  lx: number; ly: number; lz: number;
  /** Ticks without progress toward the goal, ticks chasing, Goby's flop ticks left, a per-state scratch value. */
  stuck: number;
  chaseT: number;
  flopT: number;
  aux: number;
}

/** One critter-bound device (HAMSTER DRIVE, PEDAL RIG, FISHBOWL, TRAP BOX). */
export interface DevSt {
  /** Device phase (per kind), ticks left on its timer. */
  phase: number;
  timer: number;
  /** Occupant critter ordinal (−1 none). */
  occ: number;
  /** Bump / stimulus seen this tick (N·s or dB), cooldown ticks. */
  bump: number;
  cool: number;
  /** DeviceFlagBits. */
  flags: number;
  /** Loudest Sound at the device this tick (dB, effective), and whether a lure was in range last tick. */
  heard: number;
  lure: number;
  /** Fishbowl: where it broke (Goby's rescue spot). */
  ax: number; ay: number; az: number;
}

/**
 * M4 (stream B4): what BISCUIT, HENNY and DUSTY remember beyond CritSt. One per critter (same order as `c`),
 * present only in worlds with an M4 critter, so M2 worlds keep their hashes.
 */
export interface M4St {
  /** Ticks to the next action: Biscuit's next bark, Henny's egg cooldown, Dusty's patrol stint. */
  cd: number;
  /** Overlay clip ticks left and which (1 bark_run, 2 barge, 3 suck pulse). */
  ov: number;
  ovk: number;
  /** Henny: eggs laid. Dusty: grains taken in (all kinds). */
  n: number;
  /** Ticks awake with nothing to do (Biscuit back to sleep). */
  idle: number;
  /** A remembered spot (Biscuit: where Mochi or a noise was; Dusty: grains) and ticks it stays fresh. */
  mx: number; mz: number;
  mt: number;
  /** Dusty: kg of grains in the bin. */
  bin: number;
  /** Dusty: patrol heading (rad). Henny: the height her flap started from. */
  hd: number;
  /** Henny: an Impact within 1.5 m since the last think (N·s, 0 none) and where. */
  imp: number; ix: number; iz: number;
  /** Henny: whether this flap laid an egg (1) — proud_puff vs a flustered landing. */
  laid: number;
  /** Dusty: intake capacities (grains) of the last two Matter commands, whose results are still to come. */
  q1: number; q2: number;
}

/**
 * M5 (stream B5): what BUZZ remembers beyond CritSt. One per critter (same order as `c`), present only in worlds with
 * a BUZZ, so earlier worlds keep their hashes. Its goal point is CritSt gx/gy/gz, its fetch target CritSt target.
 */
export interface M5St {
  /** 1 while it serves a call (fetching, carrying, or resuming after a tumble), 0 otherwise. */
  job: number;
  /** Tick the call came in (the delivery's seconds, the 'clock' emote). */
  t0: number;
  /** Sub-phase of grab / drop_off / land (0 winch out or descend, 1 reel in), and its ticks. */
  ph: number;
  /** Winch paid out below PIVOT__winch (m). */
  win: number;
  /** Cruise height target (world y), refreshed every think from the ground below; extra climb from avoidance (m). */
  cy: number;
  climb: number;
  /** Avoidance: side step direction (−1, 0, +1) and the heading offset it gives (rad). */
  side: number;
  /** Ticks without progress on a leg (the stuck check), ticks on the current leg. */
  slow: number;
  leg: number;
  /** 1: landing on the dock, 0: beside the beacon (or where it is, unpaired). */
  dock: number;
  /** Calls served: its beacon's call count (A5's `calls`) runs ahead of this while a call is pending. */
  served: number;
  /** PARTSIM (D121): the state a startle interrupted (CRITTER_FSM index; −1 none), resumed when it ends. */
  pre: number;
}

export interface CritWorld {
  c: CritSt[];
  d: DevSt[];
  /** M4 (B4): per-critter extras (empty without an M4 critter). */
  m4?: M4St[];
  /** M4 (B4): HENNY's YOLK pool slots, all Hennies in part order: 0 dormant, 1 laid (in play), 2 splatted. */
  egg?: number[];
  /** M5 (B5): per-critter BUZZ extras (empty without a BUZZ). */
  m5?: M5St[];
}

export const emptyM5 = (): M5St => ({ job: 0, t0: 0, ph: 0, win: 0, cy: 0, climb: 0, side: 0, slow: 0, leg: 0, dock: 0, served: 0, pre: -1 });

export const emptyCritWorld = (): CritWorld => ({ c: [], d: [] });

export const emptyM4 = (): M4St => ({ cd: 0, ov: 0, ovk: 0, n: 0, idle: 0, mx: 0, mz: 0, mt: 0, bin: 0, hd: 0, imp: 0, ix: 0, iz: 0, laid: 0, q1: 0, q2: 0 });

const INT_C: readonly (keyof CritSt)[] = ['fsm', 't', 'dur', 'clip', 'emote', 'emoteT', 'flags', 'target', 'still', 'ragT', 'dev', 'carry', 'trap', 'ignore', 'ignoreT', 'stuck', 'chaseT', 'flopT', 'aux', 'hc', 'rid'];
const U32_C: readonly (keyof CritSt)[] = ['r0', 'r1', 'r2', 'r3'];
const F_C: readonly (keyof CritSt)[] = ['gx', 'gy', 'gz', 'speed', 'avoid', 'heard', 'hx', 'hy', 'hz', 'touch', 'ax', 'ay', 'az', 'homeX', 'homeY', 'homeZ', 'lx', 'ly', 'lz'];
const INT_D: readonly (keyof DevSt)[] = ['phase', 'timer', 'occ', 'cool', 'flags', 'lure'];
const F_D: readonly (keyof DevSt)[] = ['bump', 'heard', 'ax', 'ay', 'az'];

/** Appends the critter world to the state hash (SIMULATION §10.4), in critter / device order. */
export function hashCritWorld(h: Hasher, w: CritWorld): void {
  if (!w.c.length && !w.d.length) return; // machines without critters keep their M1 hashes
  h.u32(w.c.length).u32(w.d.length);
  for (const c of w.c) {
    for (const k of INT_C) h.i32(c[k] | 0);
    for (const k of U32_C) h.u32(c[k]);
    for (const k of F_C) h.q(c[k], 1e-4);
  }
  for (const d of w.d) {
    for (const k of INT_D) h.i32(d[k] | 0);
    for (const k of F_D) h.q(d[k], 1e-4);
  }
  // M4 (B4): only worlds with an M4 critter carry these, so M2 hashes are unchanged
  if (w.m4?.length) {
    h.u32(w.m4.length);
    for (const x of w.m4) {
      for (const k of INT_M4) h.i32(x[k] | 0);
      for (const k of F_M4) h.q(x[k], 1e-4);
    }
  }
  if (w.egg?.length) { h.u32(w.egg.length); for (const e of w.egg) h.i32(e); }
  // M5 (B5): only worlds with a BUZZ carry these
  if (w.m5?.length) {
    h.u32(w.m5.length);
    for (const x of w.m5) {
      for (const k of INT_M5) h.i32(x[k] | 0);
      for (const k of F_M5) h.q(x[k], 1e-4);
    }
  }
}

const INT_M5: readonly (keyof M5St)[] = ['job', 't0', 'ph', 'side', 'slow', 'leg', 'dock', 'served', 'pre']; // PARTSIM: + pre
const F_M5: readonly (keyof M5St)[] = ['win', 'cy', 'climb'];

const INT_M4: readonly (keyof M4St)[] = ['cd', 'ov', 'ovk', 'n', 'idle', 'mt', 'laid', 'q1', 'q2'];
const F_M4: readonly (keyof M4St)[] = ['mx', 'mz', 'bin', 'hd', 'imp', 'ix', 'iz'];
