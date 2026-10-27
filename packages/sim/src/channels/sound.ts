// Sound and Lure channels (SIMULATION §5.10–5.11), M2 contract 2: stream A emits, stream B (critters)
// perceives.
//
// Sound. Anything loud calls `Machine.sound(pos, dB, part, cause)`: it emits a `Sound` event (mag =
// dB at 1 m) and queues the sound. At the start of stage 6 the queue swaps into `soundsThisTick`, so
// critter perception in stage 6 sees every sound from the previous tick's stage 6 through this tick's
// stage 5 exactly once. Sounds made during stage 6 itself (barks) are heard next tick.
//
// Lure. `Machine.lureEmitters()` lists every live part whose def carries a `lure` tag, or that
// `lureOf` computes as shiny (steel / chrome / brass / glass, dynamic, ≤ 0.5 kg → Bandit, 5 m), with
// its position, in part order. Critter-to-critter lures (Pip → Mochi …) are stream B's.

import { dlog } from '@knockon/detmath';
import type { PartId } from '@knockon/format';
import { lureOf } from '@knockon/parts-data';
import type { Vec } from '../vec.ts';
import type { Host } from './host.ts';

export interface Sound {
  /** World point, metres. */
  readonly pos: readonly [number, number, number];
  /** Loudness at 1 m (dB). Effective level at distance d: dB − 20·log10(max(d, 1 m)), −12 dB if occluded. */
  readonly dB: number;
  /** The part that made it. */
  readonly part: PartId;
  /** Id of its `Sound` event: use it as the cause of whatever the sound sets off (startles). */
  readonly cause: number;
}

export interface LureEmitter {
  readonly part: PartId;
  /** Part index (Machine.parts order). */
  readonly index: number;
  readonly pos: Vec;
  readonly radius: number;
  /** Species id → weight (critter AI picks the best weight / (1 + distance) it can perceive). */
  readonly species: Readonly<Record<string, number>>;
}

/** Loudness levels at 1 m (SIMULATION §5.10; impacts and launchers are stream A's tuning). */
export const DB = { ringer: 80, bigTop: 105, cork: 90, rocket: 85, gotcha: 75 } as const;
const LOG10 = dlog(10);
export const log10 = (x: number): number => dlog(x) / LOG10;
/** An explosion of yield Y: 120 + 10·log10(Y) dB. */
export const explosionDb = (Y: number): number => 120 + 10 * log10(Math.max(Y, 1e-3));
/** Hard impacts (J ≥ 2 N·s) are sounds: 60 + 20·log10(J) dB, at most 110. */
export const IMPACT_SOUND_J = 2;
export const impactDb = (J: number): number => Math.min(110, 60 + 20 * log10(J));

export function queueSound(h: Host, pos: readonly number[], dB: number, part: number, cause: number): void {
  h.st.m2.snd.push(pos[0]!, pos[1]!, pos[2]!, dB, part, cause);
}

/** Stage 6 start: last window's sounds become perceivable. */
export function swapSounds(h: Host): void {
  const m2 = h.st.m2;
  m2.sndNow = m2.snd;
  m2.snd = [];
}

export function soundsThisTick(h: Host): Sound[] {
  const s = h.st.m2.sndNow, out: Sound[] = [];
  for (let k = 0; k < s.length; k += 6) out.push({ pos: [s[k]!, s[k + 1]!, s[k + 2]!], dB: s[k + 3]!, part: h.parts[s[k + 4]!]?.id ?? 0, cause: s[k + 5]! });
  return out;
}

export function lureEmitters(h: Host): LureEmitter[] {
  const out: LureEmitter[] = [];
  for (let i = 0; i < h.parts.length; i++) {
    if (!h.st.alive[i]) continue;
    const p = h.parts[i]!;
    const lure = lureOf(p.def);
    if (!lure) continue;
    out.push({ part: p.id, index: i, pos: h.com(i), radius: lure.radius, species: lure.species });
  }
  return out;
}
