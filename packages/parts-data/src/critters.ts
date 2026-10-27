// Critters (GAME_SPEC §11, SIMULATION §7, art/briefs/critters.md), M2 cast: MOCHI, PIP, GOBY, BANDIT,
// plus the data the critter-bound devices need (HAMSTER DRIVE, PEDAL RIG, FISHBOWL, TRAP BOX; their
// part defs live in defs.ts with the other parts).
//
// Contract 3 (docs/dev/M2_PLAN.md): the critter part defs, their ragdolls as data (matching the briefs'
// `RAG__<bone>` capsules), and the clip / emote / FSM name tables that `Machine.critterState()` indexes.
// Engine space: Y-up, metres, the critter's nose toward +Z (brief root space (x, y, z) → engine (x, z, −y)).
//
// This module must not import runtime values from defs.ts (defs.ts spreads CRITTER_PARTS into PARTS):
// type-only imports keep the module graph acyclic.

import type { Card } from './cards.ts';
import type { PartDef, Quat, V3, VisualDef } from './defs.ts';

// ---- name tables (append-only: indices are wire values in critterState) ---------------------------

/**
 * Animation clips, indexed by critterState byte 0. The renderer plays `<type>__<clip>` from the critter's
 * glb (cross-faded on change). A species only uses the clips in its `CritterSpec.clips`.
 */
export const CRITTER_CLIPS = [
  // required by every critter (critters.md)
  'idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped', 'celebrate',
  'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused',
  // Mochi
  'pounce', 'arch_scared', 'groom', 'stalk', 'shove',
  // Pip
  'wheel_run', 'wheel_sprint', 'wheel_exit', 'stuff_cheeks', 'burrow_enter', 'burrow_exit',
  // Goby
  'swim', 'flop', 'bubble_rescue',
  // Bandit
  'pedal', 'pedal_mount', 'pedal_dismount', 'steal_grab', 'steal_carry', 'loot_admire', 'wash_hands',
  // ---- M4 (stream B4, append-only) ----
  // Biscuit ('bark_run', 'barge' and 'tail_wag' are additive layers over 'chase' / 'walk' in the art)
  'bark', 'bark_run', 'wake_startle', 'barge', 'tail_wag', 'shake_off',
  // Henny
  'flap', 'lay_egg', 'glide_down', 'peck', 'scratch', 'proud_puff',
  // Dusty
  'suck', 'bin_full', 'bump_turn',
  // ---- M5 (stream B5, append-only) ----
  // Buzz's role clips (critters.md BUZZ)
  'takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow',
] as const;
export type CritterClip = (typeof CRITTER_CLIPS)[number];
export const clipIndex = (c: CritterClip): number => CRITTER_CLIPS.indexOf(c);

/** Emote bubbles, indexed by critterState byte 2. 0 = none. */
export const CRITTER_EMOTES = [
  'none', '!', '?', 'zzz', 'stars', 'heart', 'angry', 'sweat',
  'eyes_pip', 'snack_heart', 'grumpy', 'steam', 'dog_alert',
  'seed', 'cat_alert', 'stopwatch',
  'bubbles', 'water_drop', 'food_flake', 'kiss',
  'sparkle', 'grin', 'pedal',
  // ---- M4 (stream B4, append-only): Biscuit, Henny, Dusty ----
  'bark', 'eyes_mochi', 'bone',
  'egg', '!!', 'feather',
  'sparkle_clean', 'bin_full',
  // ---- M5 (stream B5, append-only): Buzz ----
  'package', 'pin', 'check', 'clock',
] as const;
export type CritterEmote = (typeof CRITTER_EMOTES)[number];
export const emoteIndex = (e: CritterEmote): number => CRITTER_EMOTES.indexOf(e);

/** FSM states, indexed by critterState byte 3 (debugging) and the CritterState event's magnitude. */
export const CRITTER_FSM = [
  'idle', 'wander', 'nap', 'groom', 'stalk', 'chase', 'pounce', 'startled', 'flee', 'trapped',
  'ragdoll', 'getup', 'dizzy', 'indignant', 'celebrate', 'seek', 'eat', 'lost',
  'wheel_sleep', 'wheel_startled', 'wheel_sprint', 'wheel_coast',
  'swim', 'flop', 'bubble', 'home',
  'steal_grab', 'steal_carry', 'admire', 'goto_rig', 'pedal_mount', 'pedal', 'pedal_dismount',
  // ---- M4 (stream B4, append-only) ----
  // Biscuit (Dusty sleeps with 'sleep' too)
  'sleep', 'wake', 'bark', 'sniff', 'shake_off',
  // Henny
  'peck', 'scratch', 'flap', 'lay_egg', 'glide_down', 'proud_puff',
  // Dusty
  'patrol', 'bump_turn', 'beeline', 'vacuum', 'bin_full', 'scan',
  // ---- M5 (stream B5, append-only) ----
  // Buzz (it also uses 'sniff' for its tag scan)
  'docked', 'takeoff', 'fly', 'grab', 'carry', 'drop_off', 'deliver_bow', 'land', 'landed',
] as const;
export type CritterFsm = (typeof CRITTER_FSM)[number];
export const fsmIndex = (s: CritterFsm): number => CRITTER_FSM.indexOf(s);

/** critterState byte 1 bits (critters). Devices use the same byte; see DeviceFlagBits. */
export const CritterFlagBits = { ragdoll: 1, trapped: 2, asleep: 4, inDevice: 8, /* M4 (B4): Dusty's intake is running */ sucking: 16 } as const;
/**
 * M4 (B4): Dusty's bin fill in critterState byte 1, bits 5–7: `(flags >> CRITTER_BIN_SHIFT) & 7` is the number of
 * lit cells on the lid's 5-cell `SCREEN__bin` (0–5), also the bin-rattle level for audio.
 */
export const CRITTER_BIN_SHIFT = 5;
/**
 * M5 (B5): BUZZ uses byte 1 bit 4 (Dusty's `sucking`) as `rotors` (rotors spinning: flying, taking off, landing,
 * trapped), and bits 5–7 as its winch: `(flags >> CRITTER_WINCH_SHIFT) & 7` sevenths of `CRITTER_M5.buzz.winch` (0.60 m)
 * paid out below `PIVOT__winch`. A carried item's body (a ghost) hangs under the claw, so draw the tether to it.
 */
export const CRITTER_WINCH_SHIFT = 5;
export const BUZZ_ROTORS = 16;
/** critterState byte 1 bits for the critter-bound devices (byte 0 = whole seconds left on the run timer). */
export const DeviceFlagBits = { running: 1, caught: 2, lureSeen: 4, occupied: 8 } as const;

// ---- ragdolls ---------------------------------------------------------------------------------------

/**
 * One ragdoll capsule (`RAG__<bone>`), in the critter's root space in its rest (standing) pose.
 * The capsule runs from joint `a` (where it hangs on its parent) to `b`; `at`/`rot`/`halfHeight` are the
 * same capsule as a transform (Jolt capsules lie along local +Y).
 */
export interface RagBone {
  readonly bone: string;
  /** Index of the parent bone in the same list, −1 for the root (the heaviest, central capsule). */
  readonly parent: number;
  readonly a: V3;
  readonly b: V3;
  readonly radius: number;
  /** Half the length of the capsule's cylinder (a → b). */
  readonly halfHeight: number;
  /** Rest transform relative to the critter's root: capsule centre and rotation (local +Y along a → b). */
  readonly at: V3;
  readonly rot: Quat;
  /** Swing cone half-angle and twist half-range at the joint with the parent (degrees). */
  readonly swing: number;
  readonly twist: number;
  readonly mass: number;
  /**
   * M4 (B4): 'cylinder' for a robot's rigid tumble body (DUSTY's `RAG__body`): a Jolt cylinder from `a` to `b`
   * (`halfHeight` = half of a → b, `radius` its radius) instead of a capsule. Omitted = capsule.
   */
  readonly shape?: 'cylinder' | /* M5 (B5): BUZZ's rigid box hull, `halfExtents` (engine axes) centred on `at` */ 'box';
  /** M5 (B5): a 'box' bone's half extents (engine axes, unrotated: the box is axis-aligned in the rest pose). */
  readonly halfExtents?: V3;
}

function bone(name: string, parent: number, a: V3, b: V3, radius: number, mass: number, swing: number, twist: number, shape?: 'cylinder' | 'box', halfExtents?: V3): RagBone {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  const u: V3 = len > 1e-9 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0];
  // shortest arc +Y → u
  let rot: Quat;
  if (u[1] < -0.999999) rot = [1, 0, 0, 0];
  else {
    const s = Math.sqrt((1 + u[1]) * 2);
    rot = [u[2] / s, 0, -u[0] / s, s / 2];
  }
  const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
  return {
    bone: `RAG__${name}`, parent, a, b, radius, mass, swing, twist,
    halfHeight: r6(Math.max(0.001, len / 2)),
    at: [r6((a[0] + b[0]) / 2), r6((a[1] + b[1]) / 2), r6((a[2] + b[2]) / 2)],
    rot: [r6(rot[0]), r6(rot[1]), r6(rot[2]), r6(rot[3])],
    ...(shape ? { shape } : {}),
    ...(halfExtents ? { halfExtents } : {}),
  };
}

// Brief root space (x, y, z), nose toward −Y → engine (x, z, −y), nose toward +Z.
const bl = (x: number, y: number, z: number): V3 => [x, z, y === 0 ? 0 : -y];

// MOCHI: 15 capsules, 4.0 kg (critters.md Rig).
const MOCHI_RAG: readonly RagBone[] = [
  bone('hips', -1, [0, 0.15, -0.16], [0, 0.15, -0.07], 0.07, 0.93, 20, 10),
  bone('spine_02', 0, [0, 0.15, -0.07], [0, 0.155, 0.01], 0.072, 0.70, 25, 15),
  bone('spine_03', 1, [0, 0.155, 0.01], [0, 0.16, 0.09], 0.07, 0.70, 25, 15),
  bone('neck_01', 2, [0, 0.16, 0.09], [0, 0.19, 0.13], 0.04, 0.15, 35, 25),
  bone('head', 3, [0, 0.19, 0.13], [0, 0.22, 0.2], 0.062, 0.50, 40, 30),
  bone('upperarm_l', 2, [0.05, 0.12, 0.08], [0.05, 0.06, 0.09], 0.022, 0.12, 70, 20),
  bone('upperarm_r', 2, [-0.05, 0.12, 0.08], [-0.05, 0.06, 0.09], 0.022, 0.12, 70, 20),
  bone('forearm_l', 5, [0.05, 0.06, 0.09], [0.05, 0.016, 0.1], 0.016, 0.06, 70, 10),
  bone('forearm_r', 6, [-0.05, 0.06, 0.09], [-0.05, 0.016, 0.1], 0.016, 0.06, 70, 10),
  bone('thigh_l', 0, [0.05, 0.12, -0.12], [0.05, 0.06, -0.1], 0.028, 0.20, 70, 20),
  bone('thigh_r', 0, [-0.05, 0.12, -0.12], [-0.05, 0.06, -0.1], 0.028, 0.20, 70, 20),
  bone('shin_l', 9, [0.05, 0.06, -0.1], [0.05, 0.018, -0.12], 0.018, 0.08, 70, 10),
  bone('shin_r', 10, [-0.05, 0.06, -0.1], [-0.05, 0.018, -0.12], 0.018, 0.08, 70, 10),
  bone('tail_01', 0, [0, 0.18, -0.18], [0, 0.27, -0.24], 0.017, 0.06, 60, 30),
  bone('tail_04', 13, [0, 0.27, -0.24], [0, 0.37, -0.25], 0.014, 0.04, 60, 30),
];

// PIP: 7 capsules, 0.12 kg; head 40°/30°, limbs 70°/20°, every capsule ≥ 5 mm thick.
const PIP_RAG: readonly RagBone[] = [
  bone('hips', -1, [0, 0.035, -0.05], [0, 0.035, -0.015], 0.03, 0.035, 20, 10),
  bone('spine_02', 0, [0, 0.035, -0.015], [0, 0.038, 0.015], 0.03, 0.035, 25, 15),
  bone('head', 1, [0, 0.04, 0.015], [0, 0.046, 0.044], 0.024, 0.03, 40, 30),
  bone('upperarm_l', 1, [0.022, 0.022, 0.018], [0.022, 0.006, 0.024], 0.0042, 0.005, 70, 20),
  bone('upperarm_r', 1, [-0.022, 0.022, 0.018], [-0.022, 0.006, 0.024], 0.0042, 0.005, 70, 20),
  bone('thigh_l', 0, [0.024, 0.022, -0.035], [0.024, 0.006, -0.04], 0.0045, 0.005, 70, 20),
  bone('thigh_r', 0, [-0.024, 0.022, -0.035], [-0.024, 0.006, -0.04], 0.0045, 0.005, 70, 20),
];

// GOBY: 4 capsules, 0.03 kg, swing 30°, twist 10°.
const GOBY_RAG: readonly RagBone[] = [
  bone('spine_02', -1, [0, 0.02, 0.004], [0, 0.02, 0.018], 0.016, 0.009, 30, 10),
  bone('head', 0, [0, 0.02, 0.018], [0, 0.021, 0.034], 0.013, 0.009, 30, 10),
  bone('spine_04', 0, [0, 0.02, 0.004], [0, 0.02, -0.012], 0.013, 0.008, 30, 10),
  bone('tail_c_01', 2, [0, 0.02, -0.012], [0, 0.021, -0.03], 0.007, 0.004, 30, 10),
];

// BANDIT: 14 capsules, 5.5 kg; spine 25°/15°, head 40°/30°, limbs 70°/20°, tail 60°/30°.
const BANDIT_RAG: readonly RagBone[] = [
  bone('hips', -1, [0, 0.17, -0.17], [0, 0.17, -0.08], 0.075, 1.5, 20, 10),
  bone('spine_02', 0, [0, 0.17, -0.08], [0, 0.175, 0], 0.078, 1.0, 25, 15),
  bone('spine_03', 1, [0, 0.175, 0], [0, 0.18, 0.08], 0.075, 0.94, 25, 15),
  bone('head', 2, [0, 0.19, 0.09], [0, 0.21, 0.18], 0.065, 0.7, 40, 30),
  bone('upperarm_l', 2, [0.06, 0.14, 0.07], [0.06, 0.075, 0.08], 0.025, 0.15, 70, 20),
  bone('upperarm_r', 2, [-0.06, 0.14, 0.07], [-0.06, 0.075, 0.08], 0.025, 0.15, 70, 20),
  bone('forearm_l', 4, [0.06, 0.075, 0.08], [0.06, 0.022, 0.09], 0.02, 0.08, 70, 20),
  bone('forearm_r', 5, [-0.06, 0.075, 0.08], [-0.06, 0.022, 0.09], 0.02, 0.08, 70, 20),
  bone('thigh_l', 0, [0.06, 0.14, -0.14], [0.06, 0.075, -0.12], 0.03, 0.25, 70, 20),
  bone('thigh_r', 0, [-0.06, 0.14, -0.14], [-0.06, 0.075, -0.12], 0.03, 0.25, 70, 20),
  bone('shin_l', 8, [0.06, 0.075, -0.12], [0.06, 0.024, -0.14], 0.022, 0.1, 70, 20),
  bone('shin_r', 9, [-0.06, 0.075, -0.12], [-0.06, 0.024, -0.14], 0.022, 0.1, 70, 20),
  bone('tail_01', 0, [0, 0.18, -0.2], [0, 0.17, -0.32], 0.03, 0.12, 60, 30),
  bone('tail_04', 12, [0, 0.17, -0.32], [0, 0.2, -0.43], 0.028, 0.08, 60, 30),
];

// ---- M4 (stream B4): BISCUIT, HENNY, DUSTY. Authored in engine space (Y-up, nose +Z, floor y = 0) from the
// briefs' proportions; E4b builds the `RAG__` capsules to these rows (as E2 did for the M2 cast).

// BISCUIT: 15 capsules in Mochi's layout, 12 kg (hips 2.6, chest = spine_03 2.4, head 1.4); spine 25°/15°,
// neck 35°/25°, head 40°/30°, limbs 70°/20° (lower limbs 70°/10°), tail 60°/30°.
const BISCUIT_RAG: readonly RagBone[] = [
  bone('hips', -1, [0, 0.2, -0.17], [0, 0.2, -0.07], 0.1, 2.6, 20, 10),
  bone('spine_02', 0, [0, 0.2, -0.07], [0, 0.205, 0.03], 0.105, 2.25, 25, 15),
  bone('spine_03', 1, [0, 0.205, 0.03], [0, 0.21, 0.13], 0.11, 2.4, 25, 15),
  bone('neck_01', 2, [0, 0.21, 0.13], [0, 0.27, 0.19], 0.05, 0.5, 35, 25),
  bone('head', 3, [0, 0.27, 0.19], [0, 0.3, 0.29], 0.075, 1.4, 40, 30),
  // legs on E4b's built rig (assets/src/critters/biscuit.blend: elbow 0.10 m up at z 0.142, knee 0.118 m at z −0.125)
  bone('upperarm_l', 2, [0.065, 0.16, 0.14], [0.066, 0.1, 0.142], 0.03, 0.35, 70, 20),
  bone('upperarm_r', 2, [-0.065, 0.16, 0.14], [-0.066, 0.1, 0.142], 0.03, 0.35, 70, 20),
  bone('forearm_l', 5, [0.066, 0.1, 0.142], [0.066, 0.025, 0.15], 0.025, 0.2, 70, 10),
  bone('forearm_r', 6, [-0.066, 0.1, 0.142], [-0.066, 0.025, 0.15], 0.025, 0.2, 70, 10),
  bone('thigh_l', 0, [0.065, 0.18, -0.155], [0.07, 0.118, -0.125], 0.035, 0.5, 70, 20),
  bone('thigh_r', 0, [-0.065, 0.18, -0.155], [-0.07, 0.118, -0.125], 0.035, 0.5, 70, 20),
  bone('shin_l', 9, [0.07, 0.118, -0.125], [0.07, 0.025, -0.175], 0.025, 0.25, 70, 10),
  bone('shin_r', 10, [-0.07, 0.118, -0.125], [-0.07, 0.025, -0.175], 0.025, 0.25, 70, 10),
  bone('tail_01', 0, [0, 0.25, -0.22], [0, 0.33, -0.24], 0.03, 0.15, 60, 30),
  bone('tail_04', 13, [0, 0.33, -0.24], [0, 0.37, -0.16], 0.03, 0.1, 60, 30),
];

// HENNY: 10 capsules (hips, spine_02, neck_02, head, upper wings ×2, thighs ×2, shins ×2), 1.6 kg.
const HENNY_RAG: readonly RagBone[] = [
  bone('hips', -1, [0, 0.13, -0.11], [0, 0.135, -0.03], 0.075, 0.5, 20, 10),
  bone('spine_02', 0, [0, 0.135, -0.03], [0, 0.15, 0.04], 0.075, 0.48, 25, 15),
  bone('neck_02', 1, [0, 0.15, 0.04], [0, 0.21, 0.09], 0.03, 0.08, 35, 25),
  bone('head', 2, [0, 0.21, 0.09], [0, 0.255, 0.12], 0.04, 0.12, 40, 30),
  bone('upper_l', 1, [0.065, 0.17, 0.02], [0.07, 0.15, -0.07], 0.02, 0.08, 70, 20),
  bone('upper_r', 1, [-0.065, 0.17, 0.02], [-0.07, 0.15, -0.07], 0.02, 0.08, 70, 20),
  // legs on E4b's built rig (assets/src/critters/henny.blend: thigh 0.13 → 0.09 m up, shin + tarsus to the foot)
  bone('thigh_l', 0, [0.035, 0.13, -0.035], [0.04, 0.09, -0.012], 0.02, 0.08, 70, 20),
  bone('thigh_r', 0, [-0.035, 0.13, -0.035], [-0.04, 0.09, -0.012], 0.02, 0.08, 70, 20),
  bone('shin_l', 6, [0.04, 0.09, -0.012], [0.04, 0.012, -0.022], 0.012, 0.05, 70, 10),
  bone('shin_r', 7, [-0.04, 0.09, -0.012], [-0.04, 0.012, -0.022], 0.012, 0.05, 70, 10),
];

// DUSTY: `RAG__body`, one rigid cylinder (the COL__cylinder__0 disc, Ø 0.366 × 0.055 at y 0.008–0.063), 3.2 kg
// empty (the sim adds the bin's grains), swing 0°, twist 0°: a rigid tumble, no joints.
const DUSTY_RAG: readonly RagBone[] = [
  bone('body', -1, [0, 0.008, 0], [0, 0.063, 0], 0.183, 3.2, 0, 0, 'cylinder'),
];

// ---- M5 (stream B5): BUZZ. `RAG__body`, one rigid hull (critters.md: "single hull, rigid", 1.1 kg): E5b's box over the
// whole drone, 0.34 × 0.090 × 0.34 (duct outer edges; skids to the folded antenna), bottom at the floor, swing 0°,
// twist 0° (M5_NOTES_E5b: `shape: 'box'`, halfExtents [0.17, 0.045, 0.17], a / b = bottom / top centre).
const BUZZ_RAG: readonly RagBone[] = [
  bone('body', -1, [0, 0, 0], [0, 0.09, 0], 0.17, 1.1, 0, 0, 'box', [0.17, 0.045, 0.17]),
];

// ---- species specs ------------------------------------------------------------------------------------

export type Species = 'mochi' | 'pip' | 'goby' | 'bandit'
  // M4 (stream B4, append-only)
  | 'biscuit' | 'henny' | 'dusty'
  // M5 (stream B5, append-only)
  | 'buzz';

/**
 * What a species is drawn to (SIMULATION §5.11): lure kind → smell radius (m). Weight comes from the emitter.
 * M4: 'mochi' (Mochi → Biscuit, 10 m); 'grains' (Dusty's grain patches).
 */
export type LureKind = 'pip' | 'goby_flop' | 'snack' | 'seeds' | 'burrow' | 'shiny' | 'mochi' | 'grains';

export interface CritterSpec {
  readonly species: Species;
  readonly mass: number;
  /** Ragdoll on a hit or blast above this impulse (N·s, SIMULATION §7.4). */
  readonly ragdollJ: number;
  /** Vision cone (SIMULATION §7.2): range (m), 110° full angle, from the eyes (root space). */
  readonly vision: number;
  readonly eye: V3;
  /** Startle on Sound at or above this effective loudness (dB, SIMULATION §5.10). */
  readonly hearDb: number;
  /** Lure kinds it follows, with the smell radius for each. */
  readonly smells: Partial<Readonly<Record<LureKind, number>>>;
  /** Locomotion capsule (critters.md `COL__capsule__0`, along Z): radius, full length, centre in root space. */
  readonly capsule: { readonly radius: number; readonly length: number; readonly at: V3 };
  /** Leg block under the barrel so the capsule stands on its paws (low friction: steering owns the speed). */
  readonly legs?: { readonly size: V3; readonly at: V3 };
  /** Speeds (m/s), horizontal acceleration (m/s²), turn rate (rad/s). */
  readonly walk: number;
  readonly run: number;
  readonly accel: number;
  readonly turn: number;
  /** Wander radius around home (m). */
  readonly roam: number;
  /** Fur friction / restitution for the ragdoll capsules (critters.md overrides). */
  readonly friction: number;
  readonly restitution: number;
  readonly ragdoll: readonly RagBone[];
  /** Clips its glb provides (`<type>__<clip>`). */
  readonly clips: readonly CritterClip[];
  /** Emotes it uses. */
  readonly emotes: readonly CritterEmote[];
  /** Emote for "indignant" after a tumble or a lost chase. */
  readonly huff: CritterEmote;
  /** Critter-as-lure (SIMULATION §5.11): who it attracts, as a lure kind. */
  readonly lureAs?: LureKind;
  // ---- M4 (stream B4) ----
  /** Robots: the locomotion body is this upright disc (a Jolt cylinder, root space) instead of `capsule`. */
  readonly disc?: { readonly radius: number; readonly height: number; readonly at: V3 };
  /** Barges through: shoves dynamic bodies up to this mass (kg) aside while moving (BISCUIT). */
  readonly barge?: number;
  /** Where its voice pulses come from (root space): BISCUIT's `EMIT__bark__mouth`. */
  readonly mouth?: V3;
  /** HENNY's `EMIT__egg__vent` (root space): where a laid YOLK appears. */
  readonly vent?: V3;
  /** DUSTY's `SENSOR__intake__suction` box (root space) and bin capacity (kg of grains). */
  readonly intake?: { readonly min: V3; readonly max: V3; readonly bin: number };
  // ---- M5 (stream B5) ----
  /**
   * A flying robot's locomotion body (root space), instead of `capsule`: BUZZ's `COL__box__0` body, the four
   * `COL__cylinder__1..4` ducts (upright cylinders) and `COL__box__5` skids. `capsule` stays for heights and reach.
   */
  readonly drone?: {
    readonly body: { readonly size: V3; readonly at: V3 };
    readonly ducts: { readonly radius: number; readonly height: number; readonly at: readonly V3[] };
    readonly skids: { readonly size: V3; readonly at: V3 };
  };
}

const REQUIRED: readonly CritterClip[] = ['idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped', 'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused'];

export const CRITTER_SPECS: Readonly<Record<Species, CritterSpec>> = {
  mochi: {
    species: 'mochi', mass: 4.0, ragdollJ: 3, vision: 8, eye: bl(0, -0.215, 0.255), hearDb: 65,
    smells: { pip: 8, goby_flop: 10, snack: 3 },
    capsule: { radius: 0.075, length: 0.42, at: bl(0, -0.02, 0.14) }, legs: { size: [0.1, 0.07, 0.26], at: [0, 0.036, 0.02] },
    walk: 0.5, run: 1.6, accel: 5, turn: 5, roam: 1.5, friction: 0.8, restitution: 0.1, ragdoll: MOCHI_RAG,
    clips: [...REQUIRED, 'pounce', 'arch_scared', 'groom', 'stalk', 'shove'],
    emotes: ['eyes_pip', 'snack_heart', 'grumpy', 'zzz', '!', 'stars', 'steam', '?', 'dog_alert'], huff: 'steam',
    lureAs: 'mochi', // M4 (B4): Mochi → Biscuit (10 m, SIMULATION §5.11); nothing else smells 'mochi'
  },
  pip: {
    species: 'pip', mass: 0.12, ragdollJ: 0.3, vision: 4, eye: bl(0, -0.05, 0.055), hearDb: 60,
    smells: { seeds: 4, burrow: 4 },
    capsule: { radius: 0.032, length: 0.11, at: bl(0, 0, 0.034) },
    walk: 0.25, run: 0.9, accel: 5, turn: 8, roam: 1.0, friction: 0.9, restitution: 0.15, ragdoll: PIP_RAG,
    clips: [...REQUIRED, 'wheel_run', 'wheel_sprint', 'wheel_exit', 'stuff_cheeks', 'burrow_enter', 'burrow_exit'],
    emotes: ['seed', 'cat_alert', 'sweat', 'zzz', 'stars', 'heart', 'stopwatch', '?'], huff: 'sweat', lureAs: 'pip',
  },
  goby: {
    species: 'goby', mass: 0.03, ragdollJ: 0.1, vision: 1, eye: bl(0, -0.04, 0.03), hearDb: 70,
    smells: {},
    capsule: { radius: 0.016, length: 0.07, at: bl(0, -0.005, 0.02) },
    walk: 0.06, run: 0.2, accel: 1, turn: 4, roam: 0, friction: 0.7, restitution: 0.3, ragdoll: GOBY_RAG,
    clips: [...REQUIRED, 'swim', 'flop', 'bubble_rescue'],
    emotes: ['bubbles', 'heart', '!', 'water_drop', 'stars', 'food_flake', 'kiss', 'zzz'], huff: 'bubbles', lureAs: 'goby_flop',
  },
  bandit: {
    species: 'bandit', mass: 5.5, ragdollJ: 4, vision: 6, eye: bl(0, -0.205, 0.235), hearDb: 65,
    smells: { shiny: 5 },
    capsule: { radius: 0.08, length: 0.42, at: bl(0, -0.02, 0.15) }, legs: { size: [0.12, 0.075, 0.26], at: [0, 0.038, 0.02] },
    walk: 0.45, run: 1.3, accel: 4, turn: 4.5, roam: 2.0, friction: 0.85, restitution: 0.1, ragdoll: BANDIT_RAG,
    clips: [...REQUIRED, 'pedal', 'pedal_mount', 'pedal_dismount', 'steal_grab', 'steal_carry', 'loot_admire', 'wash_hands'],
    emotes: ['sparkle', '!', 'grin', 'sweat', 'stars', 'zzz', 'angry', 'pedal', '?'], huff: 'angry',
  },
  // ---- M4 (stream B4) ----
  biscuit: {
    // critters.md BISCUIT: 12 kg, ragdoll > 10 N·s, wakes on Sound ≥ 55 dB, Mochi by vision 10 m / smell 10 m,
    // barges through bodies ≤ 6 kg; COL__capsule__0 r 0.11 × 0.56 at (0, −0.03, 0.20)
    species: 'biscuit', mass: 12, ragdollJ: 10, vision: 10, eye: bl(0, -0.27, 0.32), hearDb: 55,
    smells: { mochi: 10 },
    capsule: { radius: 0.11, length: 0.56, at: bl(0, -0.03, 0.2) }, legs: { size: [0.16, 0.1, 0.36], at: [0, 0.05, 0] },
    walk: 0.6, run: 1.7, accel: 3.5, turn: 4.5, roam: 1.5, friction: 0.8, restitution: 0.08, ragdoll: BISCUIT_RAG,
    clips: [...REQUIRED, 'bark', 'bark_run', 'wake_startle', 'barge', 'tail_wag', 'shake_off'],
    emotes: ['bark', 'eyes_mochi', 'zzz', '!', 'heart', 'bone', 'stars', '?'], huff: '?',
    barge: 6, mouth: bl(0, -0.33, 0.29),
  },
  henny: {
    // critters.md HENNY: 1.6 kg, ragdoll > 1.2 N·s, startles on Sound ≥ 50 dB or an impact within 1.5 m;
    // COL__capsule__0 r 0.08 × 0.24 at (0, 0.01, 0.13); the YOLK leaves EMIT__egg__vent (0, 0.10, 0.10)
    species: 'henny', mass: 1.6, ragdollJ: 1.2, vision: 4, eye: bl(0, -0.12, 0.26), hearDb: 50,
    smells: {},
    capsule: { radius: 0.08, length: 0.24, at: bl(0, 0.01, 0.13) }, legs: { size: [0.07, 0.06, 0.08], at: [0, 0.03, 0] },
    walk: 0.3, run: 0.9, accel: 4, turn: 6, roam: 1.2, friction: 0.8, restitution: 0.12, ragdoll: HENNY_RAG,
    clips: [...REQUIRED, 'flap', 'lay_egg', 'glide_down', 'peck', 'scratch', 'proud_puff'],
    emotes: ['egg', '!!', 'feather', 'heart', 'stars', 'zzz', 'angry', '?'], huff: 'angry',
    vent: bl(0, 0.1, 0.1),
  },
  dusty: {
    // critters.md DUSTY: 3.2 kg + up to 1.8 kg of grains, tumbles (rigid) on > 4 N·s or tipped > 60°, startles at
    // 70 dB; COL__cylinder__0 Ø 0.366 × 0.055 (z 0.008–0.063) on its wheels; SENSOR__intake__suction: the brief's
    // 0.20 × 0.012 box under the front, widened and reaching 7 cm past the bumper lip and 5 cm up, so the grains its
    // bumper pushes ahead (Matter contacts) are sucked in rather than shoved along
    species: 'dusty', mass: 3.2, ragdollJ: 4, vision: 1.5, eye: bl(0, -0.105, 0.061), hearDb: 70,
    smells: { grains: 1.5 },
    capsule: { radius: 0.0275, length: 0.366, at: [0, 0.0355, 0] }, disc: { radius: 0.183, height: 0.055, at: [0, 0.0355, 0] },
    legs: { size: [0.24, 0.016, 0.24], at: [0, 0.008, 0] },
    walk: 0.25, run: 0.35, accel: 1.5, turn: 2.5, roam: 1.0, friction: 0.6, restitution: 0.3, ragdoll: DUSTY_RAG,
    clips: [...REQUIRED, 'suck', 'bin_full', 'bump_turn'],
    emotes: ['sparkle_clean', '!', '?', 'bin_full', 'zzz', 'stars', 'angry', 'heart'], huff: 'angry',
    intake: { min: [-0.12, 0, 0.08], max: [0.12, 0.05, 0.26], bin: 1.8 },
  },
  // ---- M5 (stream B5) ----
  buzz: {
    // critters.md BUZZ: 1.1 kg, payload ≤ 2 kg, tumbles (rigid) on > 3 N·s; COL__box__0 body 0.14 × 0.12 × 0.06 at
    // z 0.055, COL__cylinder__1..4 ducts Ø 0.11 × 0.035 at (±0.115, ±0.115, 0.066), COL__box__5 skids (0.14 × 0.12
    // footprint, 0.012 tall); visor (EMIT__voice__visor) at (0, −0.062, 0.065). It flies (gravity off, PD steering,
    // D105); it never startles at a noise (a robot on a job), and it isn't a lure. `vision` is its tag-scan range.
    species: 'buzz', mass: 1.1, ragdollJ: 3, vision: 10, eye: bl(0, -0.062, 0.065), hearDb: 200,
    smells: {},
    capsule: { radius: 0.03, length: 0.34, at: [0, 0.055, 0] },
    drone: {
      body: { size: [0.14, 0.06, 0.12], at: [0, 0.055, 0] },
      ducts: { radius: 0.055, height: 0.035, at: [[0.115, 0.066, 0.115], [-0.115, 0.066, 0.115], [0.115, 0.066, -0.115], [-0.115, 0.066, -0.115]] },
      skids: { size: [0.128, 0.012, 0.13], at: [0, 0.006, 0] }, // E5b's COL__box__5
    },
    walk: 0.8, run: 1.6, accel: 3, turn: 4, roam: 0, friction: 0.6, restitution: 0.2, ragdoll: BUZZ_RAG,
    clips: [...REQUIRED, 'takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow'],
    emotes: ['package', 'pin', 'check', '!', '?', 'stars', 'zzz', 'clock'], huff: '!',
  },
};

/**
 * Bandit carries stolen items at his right palm, root space: the `prop_r` socket bone's pose in his
 * `steal_carry` clip (bipedal waddle hugging the item), sampled from E2's rig in assets/src/critters/
 * bandit.blend: mean over the 48-frame loop, which stays within ±6 mm. The renderer draws the item at the
 * animated bone, so the sim's ghost item and the drawn item line up.
 */
export const BANDIT_PROP_R: V3 = [-0.071, 0.369, 0.089];
/** Bandit steals shiny parts up to this mass (kg, critters.md). */
export const SHINY_MAX_KG = 0.5;

/**
 * M4 (stream B4) behaviour numbers for BISCUIT, HENNY and DUSTY (GAME_SPEC §11, SIMULATION §5.10 / §7.3,
 * critters.md, rollers.md YOLK, SIMULATION §8.1 particle sizes). Seconds, metres, kg, N·s, dB.
 */
export const CRITTER_M4 = {
  biscuit: {
    /** A bark every 1.5 s while chasing: a 70 dB Sound pulse at `EMIT__bark__mouth`. */
    barkEvery: 1.5, barkDb: 70,
    /** wake_startle clip length; play-tag distance that ends a chase; give-up time; sniff-trail time. */
    wake: 0.5, tag: 0.5, chaseMax: 15, sniff: 5,
    /** Awake with nothing to do for this long (random range) → back to sleep. */
    settle: [10, 18] as const,
    /** A Mochi in a trap or out of reach: he stands and barks at her this long. */
    barkAt: 6,
  },
  henny: {
    /** Flap rise (m) and its time (s); lay_egg clip, the YOLK appears this far into it; glide speed cap (m/s). */
    flap: 1.0, flapTime: 0.6, layTime: 0.8, layAt: 0.6, glide: 1.2,
    /** Seconds between eggs; an Impact this close (m) startles her. */
    eggCooldown: 6, impactR: 1.5,
    /** Eggs per run: the `eggs` property (pool size, D66). */
    eggs: 3, maxEggs: 6,
    /** YOLK (rollers.md): 0.055 kg, egg 0.045 × 0.060 (long axis Z), restitution 0.15, friction 0.5, breaks ≥ 0.3 N·s. */
    yolk: { mass: 0.055, size: [0.045, 0.06, 0.045] as const, restitution: 0.15, friction: 0.5, breakJ: 0.3 },
  },
  dusty: {
    /** Grain masses (kg): sand ⌀ 4 mm ≈ 18,000 per litre of 1.6 kg; marbles are GLINT (rollers.md). */
    grainKg: [0.000089, 0, 0.0054] as const,
    /** Matter kinds it takes (bit per MatterKind): sand (0) and marble (2), never water. */
    kindMask: 0b101,
    /** Bumper sensor threshold (N·s); tumble when tipped past this (degrees); speed at a full bin (fraction). */
    bumpJ: 0.05, tipDeg: 60, fullSpeed: 0.6,
    /** Patrol stint before an idle nap (random range, s) and the nap. */
    stint: [25, 45] as const, nap: [6, 12] as const,
    /** Vacuuming a stand-in grain patch (no Matter): intake rate (kg/s) and how long a patch lasts (s). */
    patchRate: 0.12, patchTime: 3,
  },
} as const;

/**
 * M5 (stream B5) behaviour numbers for BUZZ (GAME_SPEC §11, SIMULATION §7.3, critters.md BUZZ, D105). Seconds, metres,
 * kg, m/s.
 */
export const CRITTER_M5 = {
  buzz: {
    /** Heaviest item it fetches (kg); winch reach below `PIVOT__winch` (m, 0–0.60) and its root-space pivot. */
    payload: 2, winch: 0.6, winchAt: bl(0, 0, 0.022),
    /** Winch speeds (m/s): paying out, reeling in (empty; loaded it reels in slower, by the payload fraction). */
    winchOut: 0.6, winchIn: 0.45,
    /** Claw clearance above an item's top when it starts winching (m); the winch left out while carrying (m). */
    hover: 0.3, carryWinch: 0.08,
    /** Cruise height over whatever is below (m), a carried item's clearance over it (m), and the most it climbs (m). */
    cruise: 0.7, clear: 0.15, ceiling: 3,
    /** Takeoff rise (m); sniff scan (s, a ±25° sweep); deliver_bow (s); delivered within this of the call: 'clock'. */
    takeoff: 0.35, sniff: 0.8, bow: 1.0, onTime: 15,
    /** Landing descent (m/s) and timeout (s); a fetch or homeward leg gives up after (s). */
    land: 0.35, landTime: 6, legTime: 25,
    /** Flight PD: position gain (1/s²), damping (1/s), max climb / descent (m/s). Loaded, speed drops by `sag` × payload fraction. */
    kp: 6, kd: 4.9, climb: 0.8, sag: 0.3,
    /** A paired BUZZ placed elsewhere waits this long (s) before flying home; landing spots beside the beacon (m out). */
    homeDelay: 1.5, beside: 0.38,
    /**
     * PARTSIM (beta, D121): a sound this loud where BUZZ is (dB after distance and occlusion: a yield-1 boom within 10 m, a
     * BIG TOP within 1.8 m, the hardest impacts within 3 m) startles it for `startle` s: a bob of `hop` m in the air, a
     * blip off the ground. A carried load physically weighs on the hover: it sags `sagM` m × the payload fraction (5 cm at
     * 2 kg) and climbs `climbLoad` × that fraction slower.
     */
    startleDb: 100, startle: 0.6, hop: 0.12, sagM: 0.05, climbLoad: 0.45,
  },
} as const;

/**
 * M5 (stream B5 ⇄ A5, contract 3): the BUZZ BEACON's dock, in the beacon's part space (engine Y-up). BUZZ's `root` (its
 * skids) docks at `dock` facing the beacon's +Z (critters.md: `socket_dock` (0, 0, 0.040) with +X pointing −Y, so
 * Buzz faces the port side). The pad is Ø 0.20 (`padRadius`); `port` is `PORT__signal__call` (brief (0, −0.100,
 * 0.022)); a BUZZ placed within `bindRadius` of the dock starts docked. A5's `buzz_beacon` def owns the body and port.
 */
export const BUZZ_BEACON = { dock: bl(0, 0, 0.04), padRadius: 0.1, port: bl(0, -0.1, 0.022), bindRadius: 0.2 } as const;
/**
 * M5 (B5): BUZZ's `pair` colours: the same list as A5's BEACON_PAIRS (defs_m5.ts; this module can't import it, so a
 * test keeps the two equal). Default 5 = Ignition, the beacon's default too.
 */
export const BUZZ_PAIRS = ['Plasma', 'Beam', 'Amber', 'Volt', 'Cobalt', 'Ignition'] as const;
export const BUZZ_PAIR_DEFAULT = 5;

// ---- critter-bound devices (data the sim reads; the part defs are in defs.ts) -------------------------

export const DEVICE_SPECS = {
  /** drive.md HAMSTER DRIVE: socket_pip (Pip's root in the wheel, +X forward), 6 s sprint at 5 rad/s / 40 N·m, 1 s coast. */
  hamster_drive: { socket: bl(0, 0.005, 0.042), facing: [1, 0, 0] as V3, exit: bl(-0.1, -0.08, 0.024), sprint: 6, coast: 1, omega: 5, torque: 40, bumpJ: 0.05, bumpCooldown: 0.5, knockJ: 2, bindRadius: 0.12 },
  /**
   * drive.md PEDAL RIG: socket_seat (saddle top, Bandit faces +X), socket_mount (approach point, moved
   * 0.07 m further out than the brief's so his capsule and ragdoll clear the base plate), 8 s per
   * stimulus, flywheel 3 rev/s / 25 N·m.
   */
  pedal_rig: { seat: bl(0, 0, 0.18), facing: [1, 0, 0] as V3, mount: bl(-0.25, -0.22, 0), range: 1.5, ear: bl(0, 0, 0.18), run: 8, maxRun: 16, omega: 6 * Math.PI, torque: 25, coast: 1.5, bindRadius: 0.2, call: 3.5 },
  /** contraptions.md FISHBOWL: jBreak 1.5 N·s, any blast breaks it; swim volume (centre, half extents less the 0.05 m margin), cosmetic burst 1.2 m/s. */
  fishbowl: { jBreak: 1.5, swimAt: bl(0, 0, 0.15), swimHalf: [0.05, 0.025, 0.05] as V3, burst: 1.2, flop: 8, rescue: 1.2, bindRadius: 0.16 },
  /** frame.md TRAP BOX: catch volume (box local, from the rim), settle speed. */
  trap_box: { catchMin: [-0.32, 0.01, -0.22] as V3, catchMax: [0.32, 0.45, 0.22] as V3, settle: 0.2 },
} as const;

// ---- part defs ----------------------------------------------------------------------------------------

const C = {
  cream: '#EEE4D2', ginger: '#D99252', cobalt: '#2E5BFF', biscuit: '#DDB98F', espresso: '#5B4337', beam: '#2FD6FF',
  tangerine: '#F47C2C', peach: '#FFB07A', plasma: '#FF3DAE', ash: '#8E8C93', charcoal: '#33333A', amber: '#FFB020', bone: '#E8E2D6',
  // M4 (B4): critters.md swatches
  toast: '#C98C50', creamDog: '#F2E3C9', earDog: '#7A4F2F', ignition: '#FF5B2E', buff: '#D9A65E', comb: '#D6453B',
  caramel: '#A86F37', yolk: '#D9C29A', graphite: '#3A3E47',
};

/** Blockout capsule visual (cylinder + two spheres along Z) until the skinned art lands. */
function capsuleVis(r: number, len: number, at: V3, color: string, rough = 0.85): VisualDef[] {
  const cyl = Math.max(0.001, len - 2 * r);
  return [
    { mesh: 'cylinder', size: [2 * r, cyl, 2 * r], axis: 'z', at, color, rough },
    { mesh: 'sphere', size: [2 * r, 2 * r, 2 * r], at: [at[0], at[1], at[2] + cyl / 2], color, rough },
    { mesh: 'sphere', size: [2 * r, 2 * r, 2 * r], at: [at[0], at[1], at[2] - cyl / 2], color, rough },
  ];
}

function critterDef(type: Species, name: string, tag: string, bounds: { min: V3; max: V3 }, visuals: readonly VisualDef[],
  m4?: Pick<PartDef, 'props' | 'ports' | 'power'>): PartDef {
  const s = CRITTER_SPECS[type];
  return {
    type, family: 'critters', name, tag, ship: type === 'buzz' ? 'M5' /* B5 */ : type === 'biscuit' || type === 'henny' || type === 'dusty' ? 'M4' : 'M2', bounds,
    // locomotion body (SIMULATION §7.4): upright (rotation locked about X and Z), low friction because
    // steering sets (and brakes) its horizontal velocity, so it has no friction of its own; the ragdoll
    // capsules carry the fur friction
    body: { kind: 'dynamic', mass: s.mass, friction: 0, restitution: 0.05, ccd: s.mass < 0.5 },
    shapes: () => s.drone ? [
      // M5 (B5): BUZZ's body, ducts and skids
      { kind: 'box' as const, size: s.drone.body.size, at: s.drone.body.at },
      ...s.drone.ducts.at.map((at) => ({ kind: 'cylinder' as const, size: [2 * s.drone!.ducts.radius, s.drone!.ducts.height, 2 * s.drone!.ducts.radius] as V3, at })),
      { kind: 'box' as const, size: s.drone.skids.size, at: s.drone.skids.at },
    ] : [
      s.disc
        ? { kind: 'cylinder' as const, size: [2 * s.disc.radius, s.disc.height, 2 * s.disc.radius], at: s.disc.at }
        : { kind: 'capsule' as const, size: [2 * s.capsule.radius, s.capsule.length, 2 * s.capsule.radius], axis: 'z' as const, at: s.capsule.at },
      ...(s.legs ? [{ kind: 'box' as const, size: s.legs.size, at: s.legs.at }] : []),
    ],
    visuals: () => visuals,
    ports: m4?.ports ?? [], props: m4?.props ?? {}, behaviours: ['critter_ai'], critter: s,
    ...(m4?.power ? { power: m4.power } : {}),
  };
}

export const CRITTER_PARTS: readonly PartDef[] = [
  critterDef('mochi', 'MOCHI', 'House cat', { min: [-0.08, 0, -0.22], max: [0.08, 0.37, 0.26] }, [
    ...capsuleVis(0.075, 0.36, [0, 0.14, -0.03], C.cream),
    { mesh: 'sphere', size: [0.14, 0.13, 0.13], at: [0, 0.22, 0.17], color: C.cream, rough: 0.85 },
    { mesh: 'box', size: [0.035, 0.05, 0.02], at: [0.035, 0.3, 0.17], color: C.ginger, rough: 0.8 },
    { mesh: 'box', size: [0.035, 0.05, 0.02], at: [-0.035, 0.3, 0.17], color: C.ginger, rough: 0.8 },
    { mesh: 'cylinder', size: [0.12, 0.014, 0.12], at: [0, 0.18, 0.11], axis: 'z', color: C.cobalt, rough: 0.6 },
    { mesh: 'cylinder', size: [0.03, 0.26, 0.03], at: [0, 0.27, -0.21], color: C.ginger, rough: 0.8 },
    { mesh: 'box', size: [0.1, 0.07, 0.26], at: [0, 0.036, 0.02], color: C.cream, rough: 0.9 },
  ]),
  critterDef('pip', 'PIP', 'Hamster', { min: [-0.038, 0, -0.065], max: [0.038, 0.085, 0.065] }, [
    ...capsuleVis(0.032, 0.11, [0, 0.034, 0], C.biscuit),
    { mesh: 'box', size: [0.008, 0.004, 0.09], at: [0, 0.067, -0.005], color: C.espresso, rough: 0.8 },
    { mesh: 'cylinder', size: [0.05, 0.006, 0.05], at: [0, 0.062, 0.04], color: C.beam, rough: 0.6 },
    { mesh: 'sphere', size: [0.018, 0.018, 0.008], at: [0.018, 0.075, 0.03], color: C.biscuit, rough: 0.8 },
    { mesh: 'sphere', size: [0.018, 0.018, 0.008], at: [-0.018, 0.075, 0.03], color: C.biscuit, rough: 0.8 },
  ]),
  critterDef('goby', 'GOBY', 'Goldfish', { min: [-0.015, 0, -0.05], max: [0.015, 0.055, 0.045] }, [
    ...capsuleVis(0.016, 0.065, [0, 0.02, 0.008], C.tangerine, 0.5),
    { mesh: 'box', size: [0.004, 0.04, 0.03], at: [0, 0.022, -0.035], color: C.peach, rough: 0.6 },
    { mesh: 'box', size: [0.004, 0.02, 0.025], at: [0, 0.042, 0.0], color: C.peach, rough: 0.6 },
    { mesh: 'box', size: [0.012, 0.008, 0.006], at: [0, 0.052, 0.005], color: C.plasma, rough: 0.6 },
  ]),
  critterDef('bandit', 'BANDIT', 'Raccoon', { min: [-0.09, 0, -0.45], max: [0.09, 0.3, 0.26] }, [
    ...capsuleVis(0.08, 0.36, [0, 0.15, -0.03], C.ash),
    { mesh: 'sphere', size: [0.15, 0.12, 0.13], at: [0, 0.21, 0.17], color: C.ash, rough: 0.85 },
    { mesh: 'box', size: [0.13, 0.03, 0.02], at: [0, 0.23, 0.235], color: C.charcoal, rough: 0.8 },
    { mesh: 'cylinder', size: [0.06, 0.24, 0.06], at: [0, 0.18, -0.33], axis: 'z', color: C.charcoal, rough: 0.85 },
    { mesh: 'box', size: [0.03, 0.07, 0.09], at: [0.085, 0.13, 0.0], color: C.amber, rough: 0.6 },
    { mesh: 'box', size: [0.12, 0.075, 0.26], at: [0, 0.038, 0.02], color: C.ash, rough: 0.9 },
  ]),
  // ---- M4 (stream B4) ----
  critterDef('biscuit', 'BISCUIT', 'Dog', { min: [-0.11, 0, -0.28], max: [0.11, 0.41, 0.36] }, [
    ...capsuleVis(0.105, 0.42, [0, 0.2, -0.04], C.toast),
    { mesh: 'sphere', size: [0.17, 0.15, 0.16], at: [0, 0.3, 0.24], color: C.toast, rough: 0.85 },
    { mesh: 'box', size: [0.08, 0.06, 0.07], at: [0, 0.27, 0.32], color: C.creamDog, rough: 0.85 },
    { mesh: 'box', size: [0.12, 0.08, 0.02], at: [0, 0.2, 0.235], color: C.ignition, rough: 0.7 },
    { mesh: 'box', size: [0.03, 0.06, 0.02], at: [0.075, 0.34, 0.22], color: C.earDog, rough: 0.8 },
    { mesh: 'box', size: [0.03, 0.06, 0.02], at: [-0.075, 0.34, 0.22], color: C.earDog, rough: 0.8 },
    { mesh: 'cylinder', size: [0.05, 0.16, 0.05], at: [0, 0.32, -0.22], color: C.toast, rough: 0.85 },
    { mesh: 'box', size: [0.16, 0.1, 0.36], at: [0, 0.05, 0], color: C.creamDog, rough: 0.9 },
  ]),
  critterDef('henny', 'HENNY', 'Chicken', { min: [-0.09, 0, -0.2], max: [0.09, 0.32, 0.16] }, [
    { mesh: 'sphere', size: [0.18, 0.17, 0.24], at: [0, 0.135, -0.03], color: C.buff, rough: 0.85 },
    { mesh: 'sphere', size: [0.08, 0.09, 0.08], at: [0, 0.245, 0.11], color: C.buff, rough: 0.85 },
    { mesh: 'box', size: [0.012, 0.04, 0.05], at: [0, 0.3, 0.1], color: C.comb, rough: 0.7 },
    { mesh: 'box', size: [0.02, 0.012, 0.03], at: [0, 0.24, 0.16], color: C.amber, rough: 0.5 },
    { mesh: 'box', size: [0.1, 0.08, 0.02], at: [0, 0.2, -0.17], color: C.caramel, rough: 0.8 },
    { mesh: 'box', size: [0.07, 0.06, 0.08], at: [0, 0.03, 0], color: C.amber, rough: 0.7 },
    // her pre-built YOLK pool (role 'piece', parked 30 m under her until laid): the egg's blockout
    { mesh: 'sphere', size: [0.045, 0.045, 0.06], color: C.yolk, rough: 0.6, on: 'piece' },
  ], {
    props: { eggs: { type: 'int', min: 0, max: CRITTER_M4.henny.maxEggs, default: CRITTER_M4.henny.eggs, label: 'Eggs per run' } },
    ports: [],
  }),
  critterDef('dusty', 'DUSTY', 'Robot vacuum', { min: [-0.183, 0, -0.183], max: [0.183, 0.07, 0.183] }, [
    { mesh: 'cylinder', size: [0.34, 0.052, 0.34], at: [0, 0.034, 0], color: C.bone, rough: 0.6 },
    { mesh: 'cylinder', size: [0.366, 0.024, 0.366], at: [0, 0.03, 0], color: C.charcoal, rough: 0.8 },
    { mesh: 'cylinder', size: [0.25, 0.008, 0.25], at: [0, 0.061, -0.012], color: C.graphite, rough: 0.5 },
    { mesh: 'box', size: [0.026, 0.006, 0.012], at: [0.036, 0.062, 0.105], color: C.beam, rough: 0.3, emissive: 1 },
    { mesh: 'box', size: [0.026, 0.006, 0.012], at: [-0.036, 0.062, 0.105], color: C.beam, rough: 0.3, emissive: 1 },
    { mesh: 'cylinder', size: [0.044, 0.006, 0.044], at: [0.12, 0.006, 0.08], color: C.ignition, rough: 0.6 },
  ], {
    props: {
      zone_w: { type: 'metres', min: 0.4, max: 8, step: 0.1, default: 2, label: 'Zone width' },
      zone_d: { type: 'metres', min: 0.4, max: 8, step: 0.1, default: 2, label: 'Zone depth' },
      zone_x: { type: 'metres', min: -4, max: 4, step: 0.1, default: 0, label: 'Zone offset X' },
      zone_z: { type: 'metres', min: -4, max: 4, step: 0.1, default: 0, label: 'Zone offset Z' },
    },
    // PORT__power__charge (approved look-dev): linked, Dusty roams only while powered; unlinked, its battery
    ports: [{ name: 'charge', channel: 'power', dir: 'in', at: bl(0, 0.1, 0.064), maxLinks: 1 }],
    power: { consumer: 30 },
  }),
  // ---- M5 (stream B5) ----
  // BUZZ: no ports (its Signal input is the paired BUZZ BEACON's `call`); blockout until E5b's art lands
  critterDef('buzz', 'BUZZ', 'Courier drone', { min: [-0.17, 0, -0.17], max: [0.17, 0.145, 0.17] }, [
    { mesh: 'sphere', size: [0.14, 0.06, 0.12], at: [0, 0.055, 0], color: C.bone, rough: 0.55 },
    ...([[0.115, 0.115], [-0.115, 0.115], [0.115, -0.115], [-0.115, -0.115]] as const).map(([x, z]) =>
      ({ mesh: 'cylinder' as const, size: [0.11, 0.035, 0.11] as V3, at: [x, 0.066, z] as V3, color: C.graphite, rough: 0.6 })),
    { mesh: 'box', size: [0.07, 0.025, 0.006], at: [0, 0.068, 0.061], color: C.beam, rough: 0.3, emissive: 1 },
    { mesh: 'box', size: [0.14, 0.012, 0.12], at: [0, 0.006, 0], color: C.graphite, rough: 0.7 },
    { mesh: 'cylinder', size: [0.004, 0.06, 0.004], at: [0, 0.115, -0.05], color: C.graphite, rough: 0.6 },
    { mesh: 'box', size: [0.003, 0.03, 0.05], at: [0, 0.13, -0.075], color: C.ignition, rough: 0.8 },
  ], {
    // M5_NOTES_A5 contract 3: it pairs with the first free BUZZ BEACON (part order) of the same pair colour (an index into
    // A5's BEACON_PAIRS; 5 = Ignition, the default on both)
    props: { pair: { type: 'enum', values: [...BUZZ_PAIRS], default: BUZZ_PAIR_DEFAULT, label: 'Pair colour' } },
    ports: [],
  }),
];

// ---- Library cards ------------------------------------------------------------------------------------

/** Library cards (PART_SYSTEM §6) for the critters and the critter-bound devices; cards.ts spreads them into CARDS. */
export const CRITTER_CARDS: Readonly<Record<string, Card>> = {
  mochi: {
    needs: 'Nothing: she naps until something interests her',
    does: 'Naps, stalks and chases Pip or a flopping Goby; a loud bang makes her jump',
    tips: ['Drop a TRAP BOX on her while she naps.', 'A big hit tumbles her; she gets up dizzy and grumpy.'],
  },
  pip: {
    needs: 'Nothing, or an empty HAMSTER DRIVE to live in',
    does: 'Wanders and runs from Mochi; in a HAMSTER DRIVE he sprints when it’s bumped',
    tips: ['Place him straight into a HAMSTER DRIVE.', 'Light and easily tumbled, but he always pops back up.'],
  },
  goby: {
    needs: 'A FISHBOWL to live in',
    does: 'Swims in the bowl; if it breaks he flops for 8 s, then a bubble rescues him',
    tips: ['A flopping Goby draws Mochi from 10 m away.'],
  },
  bandit: {
    needs: 'Nothing; a PEDAL RIG gives him a job',
    does: 'Steals small shiny parts; a shiny or a loud noise near a PEDAL RIG sends him to pedal',
    tips: ['Sit him on a PEDAL RIG and make a loud noise nearby.', 'Hang a shiny part from the rig’s bait hook.'],
  },
  hamster_drive: {
    needs: 'Pip inside, and a bump',
    does: 'Pip sleeps until it’s bumped, then sprints 6 s: spin out at 5 rad/s',
    tips: ['Band its spin output to a COG or a TREADWAY.', 'Without Pip it never spins on its own.'],
  },
  pedal_rig: {
    needs: 'Bandit nearby, and a shiny part or a loud noise',
    does: 'Bandit pedals 8 s per lure or fright: spin out at 3 rev/s',
    tips: ['Tie a shiny part to the bait hook with a LINE.', 'Band its spin output to whatever needs turning.'],
  },
  fishbowl: {
    needs: 'A hard hit (1.5 N·s) or any blast to break it',
    does: 'Holds Goby; breaking it splashes water and sends Goby flopping',
    tips: ['A flopping Goby lures Mochi.'],
  },
  // ---- M4 (stream B4) ----
  biscuit: {
    needs: 'Nothing: he sleeps until something goes bang',
    does: 'Wakes on a loud noise, chases Mochi barking every 1.5 s and barges light parts aside',
    tips: ['His bark is a Sound: it startles Mochi and Henny nearby.', 'At 12 kg he only tumbles from a really big hit.'],
  },
  henny: {
    needs: 'A fright: a noise or a bump close by',
    does: 'Startled, she flaps a metre up and lays a YOLK at the top (one every 6 s)',
    tips: ['Set how many eggs she has with Eggs per run.', 'Under a TRAP BOX she can’t flap, so no eggs.'],
  },
  dusty: {
    needs: 'Nothing; on a POWER leash it works only while powered',
    does: 'Patrols its zone, bumps and turns, and vacuums up sand and marbles, getting heavier',
    tips: ['Drag its zone’s corners in Build mode.', 'A full bin (1.8 kg) and it naps. It never sucks up parts or critters.'],
  },
  // ---- M5 (stream B5) ----
  buzz: {
    needs: 'A BUZZ BEACON, a Signal into it, and tagged objects',
    does: 'Flies to the nearest tagged object (up to 2 kg) and winches it back to its beacon',
    tips: ['Tag objects in Build mode for Buzz to fetch.', 'Hit it hard and it tumbles, rights itself and finishes the job.'],
  },
  trap_box: {
    needs: 'A LINE holding it up, then cut or burnt',
    does: 'Drops when its LINE lets go and traps any critter under it',
    tips: ['Hang it over a napping Mochi.', 'Every critter fits inside, from Pip to Bandit.'],
  },
};

// ---- demo machines ------------------------------------------------------------------------------------

/** The slice of demos.ts's builder that the critter demos use (injected, so no runtime import cycle). */
export interface DemoBuilder<M> {
  /** M5 (B5): `flags` are PartRecord flags (BUZZ's demo tags its item: PartFlag.Tagged, 512). */
  add(type: string, at: V3, props?: Readonly<Record<string, number>>, rot?: never, flags?: number): number;
  link(kind: 'line' | 'band' | 'fuse' | 'cable_signal' | 'cable_power', from: number, fromPort: string, to: number, toPort: string): number;
  done(ticks: number, cam?: Partial<{ target: readonly [number, number, number]; dist: number; yaw: number; pitch: number }>): M;
}

/**
 * Demo machines (≤ 30 parts, ≤ 3 s) for the critters and their devices. demos.ts merges them into DEMOS;
 * they are also the critter goldens (packages/sim/test/critters.test.ts).
 */
export function critterDemos<M>(make: () => DemoBuilder<M>): Record<string, M> {
  const D: Record<string, M> = {};
  {
    // MOCHI smells Pip 1.8 m ahead and gives chase; Pip runs; she pounces.
    const d = make();
    d.add('mochi', [0, 0, -0.6]);
    d.add('pip', [0, 0, 1.2]);
    D.mochi = d.done(360, { dist: 2.6 });
  }
  {
    // PIP: Mochi is inside 2.5 m, so he flees.
    const d = make();
    d.add('pip', [0, 0, 0.3]);
    d.add('mochi', [0, 0, -0.9]);
    D.pip = d.done(360, { dist: 2.4 });
  }
  {
    // GOBY swims in his bowl until a THUD lands on it: the bowl breaks and Goby tumbles out to flop.
    const d = make();
    d.add('fishbowl', [0, 0, 0]);
    d.add('goby', [0, 0.13, 0]);
    d.add('thud', [0.02, 1.1, 0]);
    D.goby = d.done(360, { dist: 1.6 });
  }
  {
    // BANDIT: a BANGSTICK goes off 2.5 m away (a THUD on THE BUTTON); the noise reaches his PEDAL RIG and he runs over to pedal.
    const d = make();
    d.add('pedal_rig', [0, 0, 0]);
    d.add('bandit', [-0.6, 0, 0.9]);
    const button = d.add('the_button', [2.2, 0, 0.6]);
    d.add('thud', [2.2, 0.4, 0.6]);
    const stick = d.add('bangstick', [2.5, 0.039, 0]);
    d.link('cable_signal', button, 'out', stick, 'detonator');
    D.bandit = d.done(360, { dist: 3.2, target: [0.8, 0.2, 0.3] });
  }
  {
    // HAMSTER DRIVE: a BOING drops onto the wheel, Pip wakes and sprints, and the drive turns a COG.
    const d = make();
    const drive = d.add('hamster_drive', [0, 0, 0]);
    d.add('pip', [0, 0.042, -0.005]);
    d.add('boing', [-0.08, 0.8, -0.05]);
    const cog = d.add('cog', [0.35, 0.3, 0]);
    d.link('band', drive, 'out', cog, 'axle');
    D.hamster_drive = d.done(360, { dist: 1.6 });
  }
  {
    // PEDAL RIG: Bandit lounges on the saddle; a BANGSTICK blast 2.5 m away startles him into pedalling and the rig turns a COG.
    const d = make();
    const rig = d.add('pedal_rig', [0, 0, 0]);
    d.add('bandit', [0, 0.18, 0]);
    const button = d.add('the_button', [2.2, 0, 0.6]);
    d.add('thud', [2.2, 0.4, 0.6]);
    const stick = d.add('bangstick', [2.5, 0.039, 0]);
    d.link('cable_signal', button, 'out', stick, 'detonator');
    const cog = d.add('cog', [-0.13, 0.32, 0.25]);
    d.link('band', rig, 'out', cog, 'axle');
    D.pedal_rig = d.done(360, { dist: 3.2, target: [1.0, 0.2, 0.2] });
  }
  {
    // FISHBOWL: a THUD rolls down a SLOPE into the bowl and breaks it; Goby flops on the floor.
    const d = make();
    d.add('fishbowl', [0, 0, 0]);
    d.add('goby', [0, 0.13, 0]);
    d.add('slope', [0.62, 0, 0], { angle: 20 });
    d.add('thud', [0.78, 0.36, 0]);
    D.fishbowl = d.done(360, { dist: 2.0 });
  }
  {
    // TRAP BOX hangs over Mochi from a LINE; a THUD on THE BUTTON closes a SNIPPER on the line and the cage drops on her.
    const d = make();
    const box = d.add('trap_box', [0, 0.6, 0]);
    const hook = d.add('anchor', [0, 1.4, 0]);
    d.link('line', box, 'hook', hook, 'hook');
    d.add('ledge', [-0.12, 1.2, 0]);
    const snip = d.add('snipper', [-0.08, 1.25, 0]);
    const button = d.add('the_button', [0.9, 0, 0.6]);
    d.add('thud', [0.9, 0.4, 0.6]);
    d.link('cable_signal', button, 'out', snip, 'close');
    d.add('mochi', [0, 0, 0]);
    D.trap_box = d.done(360, { dist: 2.4, target: [0, 0.5, 0] });
  }
  // ---- M4 (stream B4) ----
  {
    // BISCUIT sleeps; a THUD thumps down beside him and he wakes, spots Mochi and chases her, barking; she flees.
    const d = make();
    d.add('biscuit', [0, 0, 0]);
    d.add('thud', [0.45, 0.4, 0.1]);
    d.add('mochi', [0, 0, 2.2]);
    D.biscuit = d.done(360, { dist: 3.2, target: [0, 0.2, 1.1] });
  }
  {
    // HENNY: a THUD lands 0.8 m away; she startles, flaps up a metre and lays a YOLK at the top, then glides down.
    const d = make();
    d.add('henny', [0, 0, 0]);
    d.add('thud', [0.8, 0.35, 0]);
    D.henny = d.done(360, { dist: 2.2, target: [0, 0.5, 0] });
  }
  {
    // DUSTY patrols toward a LEDGE lying on the floor, bumps it and turns away, nudging a STITCH on the way.
    const d = make();
    d.add('dusty', [0, 0, -0.3]);
    d.add('stitch', [0.02, 0.0375, 0.0]);
    d.add('ledge', [0, 0, 0.45]);
    D.dusty = d.done(360, { dist: 1.8, target: [0, 0, 0.1] });
  }
  // ---- M5 (stream B5) ----
  {
    // BUZZ sleeps on its BUZZ BEACON; a THUD on THE BUTTON calls it: takeoff, a scan, and off to the tagged STITCH.
    const d = make();
    const beacon = d.add('buzz_beacon', [0, 0, 0]);
    d.add('buzz', BUZZ_BEACON.dock);
    const button = d.add('the_button', [-0.35, 0, 0.25]);
    d.add('thud', [-0.35, 0.2, 0.25]);
    d.link('cable_signal', button, 'out', beacon, 'call');
    d.add('stitch', [0.55, 0.0375, 0.35], {}, undefined, 512 /* PartFlag.Tagged */);
    D.buzz = d.done(360, { dist: 1.8, target: [0.25, 0.2, 0.15] });
  }
  return D;
}
