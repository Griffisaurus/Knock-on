// M5 part definitions (stream A5 · Future Tech parts): the 10 non-Matter Ship = M5 rows of GAME_SPEC §12 (GOO VAT is
// X5's, held), built to their briefs (docs/art/briefs/{future,boom,drive,critters}.md) in engine space: Y-up, metres,
// front = +Z (Blender (x, y, z) → engine (x, z, −y)). Spread into PARTS by defs.ts, which this file only type-imports
// (like defs_m2.ts … defs_m4.ts). Collision is the blockout until each part's `.shapes.json` lands. Behaviours live in
// packages/sim/src/channels/m5*.ts.
//
// Also here: the geometry and tuning constants the sim reads (one block per part), the M5 Library cards (CARDS_M5) and
// the M5 demo machines (m5Demos, merged into DEMOS by demos.ts).
//
// Fields act on rigid bodies only (D102). Ports are static in the def schema: FORCE WALL's and STASIS FIELD's ports sit
// where they belong at the default size (docs/dev/M5_NOTES_A5.md).

import { dcos, dsin } from '@knockon/detmath';
import type { LinkKind } from '../../format/src/model.ts';
import { snappedEuler, type Rotation } from '../../format/src/quantize.ts';
import type { Card } from './cards.ts';
import type { PartDef, PortDef, Props, ShapeDef, V3, VisualDef } from './defs.ts';

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const bottom = (s: V3): PartDef['bounds'] => b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]);

// Palette (ART_BIBLE §3.1), as in defs.ts … defs_m4.ts.
const C = {
  ignition: '#FF5B2E', graphite: '#3A3E47', bone: '#E8E2D6', steel: '#A9AFB8', volt: '#C6F432', beam: '#2FD6FF',
  amber: '#FFB020', cobalt: '#2E5BFF', rubber: '#25272D', copper: '#B8742E', glass: '#CFE8F2', plasma: '#FF3DAE',
  chrome: '#D8DDE3', black: '#0B0C10',
};

const sig = (name: string, at: V3, dir: PortDef['dir'] = 'in'): PortDef => ({ name, channel: 'signal', dir, at });
const pow = (name: string, at: V3): PortDef => ({ name, channel: 'power', dir: 'in', at });
const rad = (deg: number): number => (deg * Math.PI) / 180;

// ---- shared geometry and tuning (the sim channels read these) ------------------------------------------------------

/** RIFT GATES pair colours (future.md skins, one per pair). Two gates of a colour form a pair (part order: 1st + 2nd, 3rd + 4th …). */
export const RIFT_PAIRS = ['Plasma', 'Beam', 'Amber', 'Volt', 'Cobalt', 'Ignition'] as const;
const PAIR_HEX = [C.plasma, C.beam, C.amber, C.volt, C.cobalt, C.ignition] as const;
/**
 * RIFT GATES (SIMULATION §5.12): aperture centre and radius (part space; the active face is +Z), the membrane plane (z),
 * the backplate's front face, the per-pair cooldown, the exit gap in front of the partner's membrane, the overflow bounce.
 * A body transits when its leading surface reaches the membrane within the next step (centre within r + |v|·dt of it):
 * the closed backplate would stop a centre-crossing for any Roller (docs/dev/M5_NOTES_A5.md). Bodies wider than the
 * aperture (half-extent > 0.155 m) never transit; they hit the ring.
 */
export const RIFT = { centre: [0, 0.205, 0] as V3, radius: 0.155, membrane: 0.004, back: -0.019, coolS: 0.25, exitGap: 0.02, bounce: 0.5 } as const;

/**
 * GRAV WELL (SIMULATION §5.12): radial F = s·f·m / max(r, 0.2)², attract or repel, radius 5 m, from the orb's powered
 * centre. s = 4 m³/s² (no spec value; chosen so a well pulls about 0.4 g at 1 m, 1 g at 0.63 m and 0.16 m/s² at its 5 m
 * edge), with at most 40 m/s² on any body (MAGLOCK's cap), so a marble isn't fired across the room.
 */
export const GRAV_WELL = { core: [0, 0.135, 0] as V3, s: 4, radius: 5, minR: 0.2, maxAccel: 40 } as const;

/**
 * TRACTOR BEAM (SIMULATION §5.12): lens (part space; the beam runs along +Z), beam radius (0.06 m at the lens, 0.09 m at
 * 3 m), pull speed 0.5 m/s, hold speed cap 1 m/s, the spring-damper (velocity gain 4/s toward the target, 10/s on the
 * velocity error: k = 40 /s², ζ ≈ 0.8), acceleration cap, and the max load: 2 kg in the beam at full supply (× f).
 * Gravity is cancelled for captured bodies (they float in the beam).
 */
export const TRACTOR = { lens: [0, 0.06, 0.155] as V3, r0: 0.06, r3: 0.09, pull: 0.5, holdSpeed: 1, kPos: 4, kVel: 10, maxAccel: 30, maxLoad: 2, dock: 0.03 } as const;

/**
 * HOVER PAD (SIMULATION §5.12): hover height above the placed position, the vertical spring (10,000 N/m: a 10 kg payload
 * sags 9.8 mm), its damping (critical for the empty pad, capped for stability at 60 Hz), the setpoint's rise speed and
 * easing distance, the rotation lock gain and the horizontal spring (per kg, critically damped). Its own weight is fed forward.
 */
export const HOVER = { height: 0.5, k: 10000, maxPayload: 10, rise: 0.5, ease: 0.1, angK: 20, hK: 40 } as const;

/** FORCE WALL (D103): the field's friction, restitution and thickness; the field spans the pylons' inner faces from z 0.04 to H − 0.015. */
export const FORCE_WALL = { friction: 0.3, restitution: 0.6, thick: 0.02 } as const;
/** The FORCE WALL field box for a size (part space). */
export function forceWallField(p: Props): ShapeDef & { readonly at: V3 } {
  const W = p.width ?? 0.6, H = p.height ?? 0.4;
  return { kind: 'box', size: [Math.max(0.01, W - 0.064), Math.max(0.01, H - 0.055), FORCE_WALL.thick], at: [0, (0.04 + H - 0.015) / 2, 0] };
}

/** COILGUN RING (SIMULATION §5.12): bore sensor (cylinder r 0.075 × 0.10 along Z, centre), Δv, recharge, steel only. */
export const COILGUN = { centre: [0, 0.1575, 0] as V3, bore: 0.075, half: 0.05, dv: 3, rechargeS: 0.5 } as const;

/** STASIS FIELD (SIMULATION §5.12, D103): engages at supply ≥ 0.75; the volume is the size props (origin bottom centre). */
export const STASIS = { needF: 0.75 } as const;

/** BUZZ BEACON pair colours (critters.md: Buzz ↔ beacon pair colour, default Ignition). B5's BUZZ uses the same list. */
export const BEACON_PAIRS = ['Plasma', 'Beam', 'Amber', 'Volt', 'Cobalt', 'Ignition'] as const;
/** BUZZ BEACON: `socket_dock` (the pad top; facing +Z, the port side) and the pad zone for `padItem` (r, height above the pad). */
export const BEACON = { dock: [0, 0.04, 0] as V3, padR: 0.1, padH: 0.25 } as const;

/**
 * SINGULARITY (SIMULATION §5.12, boom.md): a Grav Well with s = 40 and radius 20 m from the core for 6 s after the arm
 * Signal (strength ramps up over the first 0.5 s); bodies whose centre comes within 0.3 m of the core are despawned and
 * counted; critters there are spat out (up 4 m/s, out 3 m/s). Acceleration cap 60 m/s²; the swirl damping (2 /s on the
 * tangential velocity) makes bodies spiral in instead of orbiting.
 */
export const SINGULARITY = { core: [0, 0.115, 0] as V3, s: 40, radius: 20, durationS: 6, spinS: 0.5, coreR: 0.3, maxAccel: 60, swirl: 2, spitUp: 4, spitOut: 3 } as const;

/**
 * GRABBER (drive.md): shoulder (part space), link lengths (upper arm, forearm, wrist → finger tips), joint speed at full
 * supply, dwell at the grip and release, the lift above a zone, the catch box below the palm, the payload limit. Zones are
 * props: yaw about +Y from the front (+Z), reach from the yaw axis, height above the base. Pointing down, the tips reach
 * at most 0.32 m out at shoulder level.
 */
export const GRABBER = {
  shoulder: [0, 0.1, 0] as V3, L1: 0.17, L2: 0.15, L3: 0.075, speed: 3, dwellS: 0.15, lift: 0.12, maxKg: 1, palm: 0.03,
  limits: { sh: [rad(-15), rad(105)], el: [rad(-140), rad(140)], wp: [rad(-110), rad(110)] },
} as const;
/**
 * GRABBER link colliders (link frame: origin on the joint, the link along +Y): upper arm, forearm, gripper (the palm).
 * PARTSIM (beta, D120): the two fingers are their own kinematic bodies (`GRABBER_FINGER`), sliding along the gripper's
 * ±X so they really close on a payload; `p` is kept for the signature (the old gripper carried the fingers at `grip`).
 */
export function grabberLinks(_p: Props): readonly (readonly ShapeDef[])[] {
  return [
    [{ kind: 'capsule', size: [0.04, 0.17, 0.04], at: [0, 0.085, 0] }],
    [{ kind: 'capsule', size: [0.035, 0.15, 0.035], at: [0, 0.075, 0] }],
    [{ kind: 'box', size: [0.05, GRABBER.palm, 0.04], at: [0, GRABBER.palm / 2, 0] }],
  ];
}
/**
 * PARTSIM (D120): one GRABBER finger's collider, in its own frame (the gripper frame slid along ±X so the finger's inner
 * face sits at the opening): an 8 mm plate, 45 mm long from just under the palm, 30 mm wide. `inset` = half its thickness
 * (the body origin sits `opening + inset` out from the gripper axis). `speed`: how fast the fingers slide (m/s, × supply).
 */
export const GRABBER_FINGER = { shapes: [{ kind: 'box', size: [0.008, 0.045, 0.03], at: [0, 0.0525, 0] }] as readonly ShapeDef[], inset: 0.004, speed: 0.2 } as const;

// ---- blockout helpers --------------------------------------------------------------------------------------------

/** 8 box placements around a ring in the part's XY plane (RIFT GATES, COILGUN RING): centre y `cy`, midline radius `r` (box x = tangential). */
function ringBoxes(cy: number, r: number): { at: V3; tiltZ: number }[] {
  const out: { at: V3; tiltZ: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const th = 22.5 + 45 * k;
    out.push({ at: [r * dcos(rad(th)), cy + r * dsin(rad(th)), 0], tiltZ: th + 90 });
  }
  return out;
}
const RIFT_RING = ringBoxes(0.205, 0.175);
const COIL_RING = ringBoxes(0.1575, 0.111);

const stasisNodes = (p: Props): V3[] => {
  const W = p.width ?? 0.5, D = p.depth ?? 0.5;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): V3 => [x! * (W / 2 - 0.02), 0.03, z! * (D / 2 - 0.02)]);
};
const wallPylons = (p: Props): number[] => { const W = p.width ?? 0.6; return [-(W / 2 - 0.02), W / 2 - 0.02]; };

export const PARTS_M5: readonly PartDef[] = [
  {
    // Paired single-sided portals: a body entering one gate's front membrane leaves its twin's front with the same momentum
    // (position, velocity and spin turned by B·A⁻¹, mirrored through the gate). One transit per 0.25 s per pair: bodies
    // arriving during the cooldown bounce off the membrane. Pairs are colour-coded (`pair`).
    type: 'rift_gate', family: 'future', name: 'RIFT GATES', tag: 'Paired portals', ship: 'M5', bounds: b([-0.195, 0, -0.025], [0.195, 0.4, 0.025]),
    body: { kind: 'static', mass: 4.5, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      ...RIFT_RING.map((s): ShapeDef => ({ kind: 'box', size: [0.155, 0.04, 0.05], at: s.at, tiltZ: s.tiltZ })),
      { kind: 'box', size: [0.2, 0.025, 0.05], at: [0, 0.0125, 0] },
      { kind: 'cylinder', size: [0.31, 0.006, 0.31], axis: 'z', at: [0, 0.205, -0.022] },
    ],
    visuals: (p) => {
      const pair = PAIR_HEX[Math.max(0, Math.min(5, p.pair ?? 0))]!;
      return [
        ...RIFT_RING.map((s): VisualDef => ({ mesh: 'box', size: [0.155, 0.04, 0.05], at: s.at, tiltZ: s.tiltZ, color: C.graphite, rough: 0.4 })),
        { mesh: 'box', size: [0.2, 0.025, 0.05], at: [0, 0.0125, 0], color: C.graphite, rough: 0.45 },
        { mesh: 'cylinder', size: [0.31, 0.006, 0.31], axis: 'z', at: [0, 0.205, -0.022], color: C.graphite, rough: 0.5 },
        { mesh: 'cylinder', size: [0.31, 0.002, 0.31], axis: 'z', at: [0, 0.205, 0.004], color: C.plasma, emissive: 0.6, rough: 0.2 },
        ...RIFT_RING.map((s): VisualDef => ({ mesh: 'box', size: [0.1, 0.006, 0.004], at: [s.at[0] * 1.05, 0.205 + (s.at[1] - 0.205) * 1.05, 0.026], tiltZ: s.tiltZ, color: pair, emissive: 0.9 })),
        { mesh: 'cylinder', size: [0.31, 0.003, 0.31], axis: 'z', at: [0, 0.205, 0.006], color: '#FFFFFF', emissive: 1, when: 'pressed' },
      ];
    },
    ports: [],
    props: { pair: { type: 'enum', values: [...RIFT_PAIRS], default: 0, label: 'Pair colour' } },
    art: 'rift_gate', behaviours: ['teleporter'],
  },
  {
    // Levitating-orb attractor/repulsor: powered (250 W), every body within 5 m of the orb feels F = s·f·m / max(r, 0.2)²
    // toward it (Attract) or away from it (Repel).
    type: 'grav_well', family: 'future', name: 'GRAV WELL', tag: 'Attractor / repulsor', ship: 'M5', bounds: bottom([0.2, 0.18, 0.2]),
    body: { kind: 'static', mass: 3, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.05, 0.2], at: [0, 0.025, 0] },
      ...[90, 210, 330].map((a): ShapeDef => ({ kind: 'box', size: [0.016, 0.04, 0.016], at: [0.06 * dcos(rad(a)), 0.07, -0.06 * dsin(rad(a))] })),
      { kind: 'sphere', size: [0.09, 0.09, 0.09], at: [0, 0.115, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.05, 0.2], at: [0, 0.025, 0], color: C.graphite, rough: 0.45 },
      ...[90, 210, 330].map((a): VisualDef => ({ mesh: 'box', size: [0.016, 0.04, 0.016], at: [0.06 * dcos(rad(a)), 0.07, -0.06 * dsin(rad(a))], color: C.graphite, rough: 0.4 })),
      ...[90, 210, 330].map((a): VisualDef => ({ mesh: 'sphere', size: [0.012, 0.012, 0.012], at: [0.06 * dcos(rad(a)), 0.092, -0.06 * dsin(rad(a))], color: C.plasma, emissive: 0.8, when: 'powered' })),
      { mesh: 'sphere', size: [0.09, 0.09, 0.09], at: [0, 0.115, 0], color: C.black, metal: 0.6, rough: 0.15 },
      { mesh: 'cylinder', size: [0.092, 0.006, 0.092], at: [0, 0.115, 0], color: C.plasma, emissive: 1, when: 'powered' },
      { mesh: 'cylinder', size: [0.12, 0.003, 0.12], at: [0, 0.0515, 0], color: C.plasma, emissive: 0.7, when: 'lit' },
    ],
    ports: [pow('in', [0.055, 0.025, 0.1])],
    props: { mode: { type: 'enum', values: ['Attract', 'Repel'], default: 0, label: 'Mode' } },
    art: 'grav_well', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 250 },
  },
  {
    // Pull-and-hold beam: powered (180 W), it reels bodies in its beam toward the lens at 0.5 m/s (Pull) or springs them to
    // a point `hold` m along the beam (Hold), up to `range` m, carrying at most 2 kg in all. Captured bodies float.
    type: 'tractor_beam', family: 'future', name: 'TRACTOR BEAM', tag: 'Pull / hold beam', ship: 'M5', bounds: b([-0.05, 0, -0.15], [0.05, 0.1, 0.15]),
    body: { kind: 'static', mass: 2, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.09, 0.08, 0.29], at: [0, 0.06, 0.005] },
      { kind: 'box', size: [0.09, 0.02, 0.03], at: [0, 0.01, -0.08] },
      { kind: 'box', size: [0.09, 0.02, 0.03], at: [0, 0.01, 0.08] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.08, 0.27], at: [0, 0.06, -0.015], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.09, 0.02, 0.03], at: [0, 0.01, -0.08], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.09, 0.02, 0.03], at: [0, 0.01, 0.08], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.08, 0.02, 0.08], axis: 'z', at: [0, 0.06, 0.135], color: C.plasma, rough: 0.3, metal: 0.4 },
      { mesh: 'cylinder', size: [0.05, 0.01, 0.05], axis: 'z', at: [0, 0.06, 0.15], color: C.plasma, emissive: 1, when: 'powered' },
      { mesh: 'sphere', size: [0.01, 0.01, 0.01], at: [0, 0.103, 0.02], color: C.plasma, emissive: 1, when: 'lit' },
    ],
    ports: [pow('in', [0, 0.1, -0.07])],
    props: {
      mode: { type: 'enum', values: ['Pull', 'Hold'], default: 0, label: 'Mode' },
      range: { type: 'metres', min: 0.5, max: 3, step: 0.1, default: 1.5, label: 'Range' },
      hold: { type: 'metres', min: 0.5, max: 3, step: 0.1, default: 0.5, label: 'Hold distance' },
    },
    art: 'tractor_beam', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 180 },
  },
  {
    // Levitating platform: powered (120 W), its rotation locks and a stiff spring-damper holds it 0.5 m above where it was
    // placed, carrying up to 10 kg (sag ≤ 1 cm). Unpowered, it falls with whatever is on it.
    type: 'hover_pad', family: 'future', name: 'HOVER PAD', tag: 'Levitating platform', ship: 'M5', bounds: bottom([0.3, 0.05, 0.3]),
    body: { kind: 'dynamic', mass: 2.5, friction: 0.9, restitution: 0.2, material: 'rubber' },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.04, 0.3], at: [0, 0.026, 0] },
      { kind: 'box', size: [0.26, 0.005, 0.26], at: [0, 0.0475, 0] },
      { kind: 'box', size: [0.25, 0.006, 0.25], at: [0, 0.003, 0] }, // the four thruster discs' footprint
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.04, 0.3], at: [0, 0.026, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.26, 0.005, 0.26], at: [0, 0.0475, 0], color: C.rubber, rough: 0.9 },
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): VisualDef => ({ mesh: 'cylinder', size: [0.07, 0.006, 0.07], at: [x! * 0.09, 0.003, z! * 0.09], color: C.plasma, rough: 0.3 })),
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): VisualDef => ({ mesh: 'cylinder', size: [0.05, 0.002, 0.05], at: [x! * 0.09, -0.001, z! * 0.09], color: C.plasma, emissive: 1, when: 'powered' })),
      { mesh: 'box', size: [0.302, 0.004, 0.302], at: [0, 0.02, 0], color: C.plasma, emissive: 0.8, when: 'powered' },
    ],
    ports: [pow('in', [0.1, 0.026, 0.15])],
    props: {}, art: 'hover_pad', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 120 },
  },
  {
    // Energy barrier between two pylons: each Signal on `toggle` switches the field on or off (`start` sets it at the start).
    // On, it's a solid static wall (friction 0.3, restitution 0.6); off, things pass through. Resizable 0.1–1 m each way.
    type: 'force_wall', family: 'future', name: 'FORCE WALL', tag: 'Energy barrier', ship: 'M5', bounds: b([-0.3, 0, -0.025], [0.3, 0.4, 0.025]),
    boundsFor: (p) => { const W = p.width ?? 0.6, H = p.height ?? 0.4; return b([-W / 2, 0, -0.025], [W / 2, H, 0.025]); },
    body: { kind: 'static', mass: 1.2, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: (p) => {
      const H = p.height ?? 0.4;
      return wallPylons(p).flatMap((x): ShapeDef[] => [
        { kind: 'box', size: [0.04, 0.04, 0.05], at: [x, 0.02, 0] },
        { kind: 'box', size: [0.024, Math.max(0.01, H - 0.055), 0.03], at: [x, 0.04 + Math.max(0.01, H - 0.055) / 2, 0] },
        { kind: 'box', size: [0.03, 0.015, 0.036], at: [x, H - 0.0075, 0] },
      ]);
    },
    visuals: (p) => {
      const H = p.height ?? 0.4, f = forceWallField(p);
      return [
        ...wallPylons(p).flatMap((x): VisualDef[] => [
          { mesh: 'box', size: [0.04, 0.04, 0.05], at: [x, 0.02, 0], color: C.graphite, rough: 0.45 },
          { mesh: 'box', size: [0.024, Math.max(0.01, H - 0.055), 0.03], at: [x, 0.04 + Math.max(0.01, H - 0.055) / 2, 0], color: C.graphite, rough: 0.4 },
          { mesh: 'box', size: [0.03, 0.015, 0.036], at: [x, H - 0.0075, 0], color: C.plasma, rough: 0.3 },
          { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [x, H + 0.002, 0], color: C.plasma, emissive: 1, when: 'lit' },
        ]),
        { mesh: 'box', size: f.size, at: f.at, color: C.plasma, emissive: 0.5, rough: 0.2, when: 'lit' },
      ];
    },
    ports: [sig('toggle', [-0.28, 0.022, 0.025])],
    props: {
      width: { type: 'metres', min: 0.1, max: 1, step: 0.1, default: 0.6, label: 'Width' },
      height: { type: 'metres', min: 0.1, max: 1, step: 0.1, default: 0.4, label: 'Height' },
      start: { type: 'bool', default: 1, label: 'On at start' },
    },
    art: 'force_wall', behaviours: ['field_emitter'],
  },
  {
    // Steel accelerator ring: powered (300 W), a steel body passing through the bore gets +3 m/s along the ring's axis
    // (`direction`), once per pass; then it recharges for 0.5 s. Anything else passes untouched.
    type: 'coilgun_ring', family: 'future', name: 'COILGUN RING', tag: 'Accelerator ring', ship: 'M5', bounds: b([-0.1425, 0, -0.05], [0.1425, 0.3, 0.05]),
    body: { kind: 'static', mass: 4, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      ...COIL_RING.map((s): ShapeDef => ({ kind: 'box', size: [0.11, 0.06, 0.08], at: s.at, tiltZ: s.tiltZ })),
      { kind: 'box', size: [0.16, 0.05, 0.1], at: [0, 0.025, 0] },
    ],
    visuals: () => [
      ...COIL_RING.map((s): VisualDef => ({ mesh: 'box', size: [0.11, 0.06, 0.06], at: s.at, tiltZ: s.tiltZ, color: C.plasma, rough: 0.1 })),
      ...COIL_RING.map((s): VisualDef => ({ mesh: 'box', size: [0.05, 0.03, 0.04], at: s.at, tiltZ: s.tiltZ, color: C.copper, metal: 0.8, rough: 0.35 })),
      ...[-0.044, 0.044].flatMap((z) => COIL_RING.map((s): VisualDef => ({ mesh: 'box', size: [0.11, 0.06, 0.008], at: [s.at[0], s.at[1], z], tiltZ: s.tiltZ, color: C.graphite, rough: 0.4 }))),
      { mesh: 'box', size: [0.16, 0.05, 0.1], at: [0, 0.025, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.07, 0.01, 0.002], at: [-0.045, 0.025, 0.051], color: C.volt, emissive: 1, when: 'lit' },
      { mesh: 'cylinder', size: [0.17, 0.004, 0.17], axis: 'z', at: [0, 0.1575, 0.046], color: C.plasma, emissive: 1, when: 'pressed' },
    ],
    ports: [pow('in', [0.05, 0.025, 0.05])],
    props: { direction: { type: 'enum', values: ['Forward', 'Back'], default: 0, label: 'Boost direction' } },
    art: 'coilgun_ring', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 300 },
  },
  {
    // Freeze volume framed by four corner nodes: powered at ≥ 75 % of its 220 W, every body whose centre is inside stops
    // dead and floats (its velocity is zeroed and gravity cancelled every tick, ZONE's stasis: D103). Resizable 0.1–1 m.
    type: 'stasis_field', family: 'future', name: 'STASIS FIELD', tag: 'Freeze volume', ship: 'M5', bounds: b([-0.25, 0, -0.25], [0.25, 0.5, 0.25]),
    boundsFor: (p) => { const W = p.width ?? 0.5, H = p.height ?? 0.5, D = p.depth ?? 0.5; return b([-W / 2, 0, -D / 2], [W / 2, H, D / 2]); },
    body: { kind: 'static', mass: 1.6, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: (p) => stasisNodes(p).map((at): ShapeDef => ({ kind: 'box', size: [0.04, 0.06, 0.04], at })),
    visuals: (p) => {
      const W = p.width ?? 0.5, H = p.height ?? 0.5, D = p.depth ?? 0.5;
      return [
        ...stasisNodes(p).flatMap((at): VisualDef[] => [
          { mesh: 'box', size: [0.04, 0.06, 0.04], at, color: C.graphite, rough: 0.45 },
          { mesh: 'sphere', size: [0.016, 0.016, 0.016], at: [at[0], 0.062, at[2]], color: C.plasma, emissive: 1, when: 'powered' },
        ]),
        { mesh: 'box', size: [W, 0.008, 0.012], at: [0, 0.004, -D / 2 + 0.02], color: C.graphite, rough: 0.45 },
        { mesh: 'box', size: [W, 0.008, 0.012], at: [0, 0.004, D / 2 - 0.02], color: C.graphite, rough: 0.45 },
        { mesh: 'box', size: [W, H, D], at: [0, H / 2, 0], color: C.plasma, emissive: 0.15, rough: 0.2, when: 'lit' },
      ];
    },
    ports: [pow('in', [-0.23, 0.03, 0.25])],
    props: {
      width: { type: 'metres', min: 0.1, max: 1, step: 0.1, default: 0.5, label: 'Width' },
      height: { type: 'metres', min: 0.1, max: 1, step: 0.1, default: 0.5, label: 'Height' },
      depth: { type: 'metres', min: 0.1, max: 1, step: 0.1, default: 0.5, label: 'Depth' },
    },
    art: 'stasis_field', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 220 },
  },
  {
    // BUZZ's dock and delivery pad: a Signal on `call` sends its paired BUZZ (B5) to fetch the nearest tagged object and
    // deliver it here. The beacon only counts calls and reports its dock pose (docs/dev/M5_NOTES_A5.md, contract 3).
    type: 'buzz_beacon', family: 'future', name: 'BUZZ BEACON', tag: 'Courier drone dock', ship: 'M5', bounds: b([-0.1, 0, -0.1], [0.1, 0.04, 0.1]),
    body: { kind: 'static', mass: 0.4, friction: 0.6, restitution: 0.2, material: 'powder' },
    shapes: () => [{ kind: 'cylinder', size: [0.2, 0.036, 0.2], at: [0, 0.022, 0] }],
    visuals: (p) => {
      const pair = PAIR_HEX[Math.max(0, Math.min(5, p.pair ?? 5))]!;
      return [
        { mesh: 'cylinder', size: [0.2, 0.036, 0.2], at: [0, 0.022, 0], color: C.graphite, rough: 0.45 },
        { mesh: 'cylinder', size: [0.17, 0.002, 0.17], at: [0, 0.041, 0], color: pair, emissive: 0.5 },
        { mesh: 'cylinder', size: [0.15, 0.003, 0.15], at: [0, 0.041, 0], color: C.graphite, rough: 0.5 },
        { mesh: 'cylinder', size: [0.06, 0.003, 0.06], at: [0, 0.042, 0], color: C.bone, rough: 0.5 },
        { mesh: 'cylinder', size: [0.172, 0.003, 0.172], at: [0, 0.0415, 0], color: pair, emissive: 1, when: 'pressed' },
      ];
    },
    ports: [sig('call', [0, 0.022, 0.1])],
    props: { pair: { type: 'enum', values: [...BEACON_PAIRS], default: 5, label: 'Pair colour' } },
    art: 'buzz_beacon', behaviours: ['beacon'],
  },
  {
    // Micro black hole (finale): a Signal on `arm` opens it for 6 s: everything within 20 m is pulled toward the core
    // (a Grav Well with s = 40) and any body whose centre comes within 0.3 m of it is gone (counted). Critters are spat back
    // out. It's immune to its own pull and to blasts, and it works once.
    type: 'singularity', family: 'boom', name: 'SINGULARITY', tag: 'Micro black hole', ship: 'M5', bounds: bottom([0.2, 0.2, 0.2]),
    body: { kind: 'static', mass: 7, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.05, 0.2], at: [0, 0.025, 0] },
      { kind: 'box', size: [0.2, 0.02, 0.04], at: [0, 0.19, -0.08] },
      { kind: 'box', size: [0.2, 0.02, 0.04], at: [0, 0.19, 0.08] },
      { kind: 'box', size: [0.04, 0.02, 0.12], at: [-0.08, 0.19, 0] },
      { kind: 'box', size: [0.04, 0.02, 0.12], at: [0.08, 0.19, 0] },
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): ShapeDef => ({ kind: 'cylinder', size: [0.02, 0.13, 0.02], at: [x! * 0.085, 0.115, z! * 0.085] })),
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.05, 0.2], at: [0, 0.025, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.2, 0.02, 0.04], at: [0, 0.19, -0.08], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.2, 0.02, 0.04], at: [0, 0.19, 0.08], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.04, 0.02, 0.12], at: [-0.08, 0.19, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.04, 0.02, 0.12], at: [0.08, 0.19, 0], color: C.graphite, rough: 0.45 },
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): VisualDef => ({ mesh: 'cylinder', size: [0.02, 0.13, 0.02], at: [x! * 0.085, 0.115, z! * 0.085], color: C.graphite, rough: 0.4 })),
      { mesh: 'cylinder', size: [0.12, 0.006, 0.12], at: [0, 0.115, 0], color: C.plasma, emissive: 0.4, rough: 0.3 },
      { mesh: 'cylinder', size: [0.1, 0.006, 0.1], axis: 'x', at: [0, 0.115, 0], color: C.plasma, emissive: 0.4, rough: 0.3 },
      { mesh: 'sphere', size: [0.03, 0.03, 0.03], at: [0, 0.115, 0], color: C.black, rough: 0.1 },
      { mesh: 'sphere', size: [0.05, 0.05, 0.05], at: [0, 0.115, 0], color: C.black, emissive: 0, when: 'lit' },
      { mesh: 'box', size: [0.04, 0.012, 0.002], at: [-0.045, 0.027, 0.101], color: C.plasma, emissive: 1, when: 'powered' },
    ],
    ports: [sig('arm', [0.06, 0.027, 0.101])],
    props: {}, art: 'singularity', behaviours: ['field_emitter', 'sink'],
  },
  {
    // Desktop robot arm: each Signal on `go` (or continuously with `loop`) it picks the body at zone A and places it at
    // zone B with deterministic IK playback of kinematic links; its speed scales with the supply factor (100 W). With
    // nothing at A it shrugs (`Jam`) and parks. Zones are props: yaw from the front, reach and height.
    type: 'grabber', family: 'drive', name: 'GRABBER', tag: 'Robot arm', ship: 'M5', bounds: bottom([0.2, 0.5, 0.2]),
    body: { kind: 'static', mass: 3.5, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.19, 0.06, 0.19], at: [0, 0.03, 0] },
      { kind: 'cylinder', size: [0.15, 0.03, 0.15], at: [0, 0.075, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.19, 0.06, 0.19], at: [0, 0.03, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.15, 0.03, 0.15], at: [0, 0.075, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'sphere', size: [0.012, 0.012, 0.012], at: [0, 0.092, 0.06], color: C.volt, emissive: 1, when: 'powered' },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [-0.03, 0.061, 0.07], color: C.amber, emissive: 1, when: 'lit' },
    ],
    ports: [pow('in', [-0.045, 0.032, 0.096]), sig('go', [0.05, 0.032, 0.096])],
    props: {
      aYaw: { type: 'angle', min: -180, max: 180, step: 15, default: -60, label: 'Zone A direction' },
      aReach: { type: 'metres', min: 0.12, max: 0.3, step: 0.01, default: 0.25, label: 'Zone A reach' },
      aHeight: { type: 'metres', min: 0, max: 0.2, step: 0.01, default: 0, label: 'Zone A height' },
      bYaw: { type: 'angle', min: -180, max: 180, step: 15, default: 60, label: 'Zone B direction' },
      bReach: { type: 'metres', min: 0.12, max: 0.3, step: 0.01, default: 0.25, label: 'Zone B reach' },
      bHeight: { type: 'metres', min: 0, max: 0.2, step: 0.01, default: 0, label: 'Zone B height' },
      grip: { type: 'metres', min: 0.02, max: 0.08, step: 0.01, default: 0.06, label: 'Grip width' },
      loop: { type: 'bool', default: 0, label: 'Repeat while powered' },
    },
    art: 'grabber', behaviours: ['ik_playback', 'power_consumer'], power: { consumer: 100 },
  },
];

/** Types with M5 sim behaviour (packages/sim/src/channels/m5*.ts). */
export const M5_TYPES: ReadonlySet<string> = new Set(PARTS_M5.map((p) => p.type));

/** A GRABBER zone's world-independent pose: part-local point on the zone's surface (yaw from +Z about +Y, reach, height). */
export function grabberZone(p: Props, zone: 'a' | 'b'): V3 {
  const yaw = rad(zone === 'a' ? p.aYaw ?? -60 : p.bYaw ?? 60);
  const r = zone === 'a' ? p.aReach ?? 0.25 : p.bReach ?? 0.25;
  const h = zone === 'a' ? p.aHeight ?? 0 : p.bHeight ?? 0;
  return [r * dsin(yaw), h, r * dcos(yaw)];
}

// ---- Library cards (PART_SYSTEM §6) -------------------------------------------------------------------------------

export const CARDS_M5: Readonly<Record<string, Card>> = {
  rift_gate: { needs: 'Two gates of the same colour', does: 'A body rolled into one gate shoots out of its twin with the same speed', tips: ['One trip per pair every 0.25 s: others bounce.', 'The back is solid.'] },
  grav_well: { needs: 'Power (250 W)', does: 'Pulls everything within 5 m toward its orb, or pushes it away', tips: ['Switch Attract or Repel.', 'Strongest up close.'] },
  tractor_beam: { needs: 'Power (180 W)', does: 'Reels things in along its beam, or holds them floating at a set distance', tips: ['Carries up to 2 kg.', 'Set the range and hold distance from 0.5 to 3 m.'] },
  hover_pad: { needs: 'Power (120 W)', does: 'Rises 0.5 m and hovers there carrying up to 10 kg; drops when unpowered', tips: ['Cut its power to drop the load.'] },
  force_wall: { needs: 'A signal (each one switches it on or off)', does: 'A solid energy wall while on; things pass straight through when off', tips: ['Set whether it starts on.', 'Resize it from 0.1 to 1 m.'] },
  coilgun_ring: { needs: 'Power (300 W)', does: 'Gives steel balls passing through it a +3 m/s kick, then recharges', tips: ['Steel only: PIG IRON, BEARING, WRECKER.', 'Half a second to recharge.'] },
  stasis_field: { needs: 'Power (220 W, at 75 % or more)', does: 'Freezes everything inside it in mid-air until the power stops', tips: ['Things fall again when it switches off.'] },
  buzz_beacon: { needs: 'A BUZZ, and a signal', does: 'Sends BUZZ to fetch the nearest tagged object and bring it to this pad', tips: ['Tag objects in Build mode.', 'Match BUZZ’s pair colour.'] },
  singularity: { needs: 'A signal (it works once)', does: 'Opens a tiny black hole for 6 s that swallows everything within 20 m', tips: ['Critters get spat back out.', 'Up to 4 per world.'] },
  grabber: { needs: 'Power (100 W) and a signal', does: 'A robot arm: picks up what’s at zone A and puts it down at zone B', tips: ['Set the zones by direction, reach and height.', 'A weak supply slows it down.'] },
};

// ---- demo machines (PART_SYSTEM §6; the per-part goldens) ---------------------------------------------------------

export interface DemoBuilderM5<M> {
  /** `flags`: PartRecord flags (32 = anchored). */
  add(type: string, at: V3, props?: Readonly<Record<string, number>>, rot?: Rotation, flags?: number): number;
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number;
  done(ticks: number, cam?: Partial<{ target: readonly [number, number, number]; dist: number; yaw: number; pitch: number }>): M;
}

/** The M5 parts' demo machines (≤ 30 parts, ≤ 3 s), merged into DEMOS by demos.ts. */
export function m5Demos<M>(make: () => DemoBuilderM5<M>): Record<string, M> {
  const D: Record<string, M> = {};
  {
    // RIFT GATES: a STITCH falls into a gate lying face up and shoots out of its upright twin into a row of tiles
    const d = make();
    d.add('rift_gate', [0, 0.025, 0.205], { pair: 0 }, snappedEuler(0, -90, 0));
    d.add('rift_gate', [0.6, 0, 0], { pair: 0 }, snappedEuler(90, 0, 0));
    d.add('stitch', [0, 0.8, 0]);
    for (let k = 0; k < 4; k++) d.add('topple_tile', [1.3 + 0.1 * k, 0.075, 0]);
    D.rift_gate = d.done(300, { target: [0.7, 0.2, 0], dist: 2.2 });
  }
  {
    // GRAV WELL: switched on, it pulls the three balls lying around it in to its orb
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.5]);
    const well = d.add('grav_well', [0, 0, 0]);
    d.link('cable_power', mains, 'out', well, 'in');
    d.add('stitch', [0.5, 0.0375, 0]);
    d.add('stitch', [-0.35, 0.0375, 0.35]);
    d.add('glint', [0.1, 0.008, 0.6]);
    D.grav_well = d.done(300, { target: [0, 0.1, 0], dist: 1.8 });
  }
  {
    // TRACTOR BEAM: switched on in Pull mode, it lifts the STITCH a metre down its beam and reels it in to the lens
    const d = make();
    const mains = d.add('mains', [-0.4, 0, -0.3]);
    const beam = d.add('tractor_beam', [0, 0, 0], { mode: 0, range: 1.5 });
    d.link('cable_power', mains, 'out', beam, 'in');
    d.add('stitch', [0, 0.0375, 1.0]);
    D.tractor_beam = d.done(360, { target: [0, 0.1, 0.5], dist: 1.8 });
  }
  {
    // HOVER PAD: powered, it rises 0.5 m with a THUD on its deck; at 2 s the RINGER switches the MAINS off and it drops
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.4]);
    const pad = d.add('hover_pad', [0, 0, 0]);
    d.add('thud', [0, 0.161, 0]);
    const ringer = d.add('ringer', [-0.5, 0, 0.3], { time: 2 });
    d.link('cable_power', mains, 'out', pad, 'in');
    d.link('cable_signal', ringer, 'out', mains, 'in');
    D.hover_pad = d.done(360, { target: [0, 0.4, 0], dist: 1.8 });
  }
  {
    // FORCE WALL: a STITCH rolls down the slope and is stopped by the wall standing across it; at 1 s the RINGER switches
    // the wall off and the STITCH rolls on through
    const d = make();
    const wall = d.add('force_wall', [0.2, 0, 0], { width: 0.4, height: 0.3, start: 1 }, snappedEuler(90, 0, 0));
    d.add('slope', [0.35, 0, 0], { angle: 20 });
    d.add('stitch', [0.55, 0.22, 0]);
    const ringer = d.add('ringer', [0.3, 0, -0.4], { time: 1 });
    d.link('cable_signal', ringer, 'out', wall, 'toggle');
    D.force_wall = d.done(360, { target: [0, 0.15, 0], dist: 1.6 });
  }
  {
    // COILGUN RING: a PIG IRON rolls down the slope, along the shelf and off its end through the ring, which kicks it on
    // at +3 m/s into the tiles
    const d = make();
    const mains = d.add('mains', [-0.4, 0, -0.4]);
    const ring = d.add('coilgun_ring', [-0.36, 0, 0], {}, snappedEuler(-90, 0, 0));
    d.link('cable_power', mains, 'out', ring, 'in');
    d.add('ledge', [-0.1, 0.05, 0]);
    d.add('slope', [0.4, 0.1, 0], { angle: 20 });
    d.add('pig_iron', [0.6, 0.33, 0]);
    for (let k = 0; k < 3; k++) d.add('topple_tile', [-1.3 - 0.1 * k, 0.075, 0]);
    D.coilgun_ring = d.done(360, { target: [-0.4, 0.15, 0], dist: 2 });
  }
  {
    // STASIS FIELD: powered, it freezes the BOINGs falling through it in mid-air; at 2 s the RINGER cuts the power and they drop
    const d = make();
    const mains = d.add('mains', [-0.6, 0, -0.4]);
    const field = d.add('stasis_field', [0, 0, 0], { width: 0.6, height: 0.6, depth: 0.6 });
    const ringer = d.add('ringer', [-0.6, 0, 0.3], { time: 2 });
    d.link('cable_power', mains, 'out', field, 'in');
    d.link('cable_signal', ringer, 'out', mains, 'in');
    d.add('boing', [0, 1.0, 0]);
    d.add('stitch', [0.15, 0.8, 0.1]);
    D.stasis_field = d.done(360, { target: [0, 0.4, 0], dist: 2 });
  }
  {
    // BUZZ BEACON: a THUD on THE BUTTON calls BUZZ (the beacon counts the call; BUZZ's own demo shows the flight)
    const d = make();
    const beacon = d.add('buzz_beacon', [0, 0, 0]);
    const button = d.add('the_button', [-0.3, 0, 0.2]);
    d.add('thud', [-0.3, 0.2, 0.2]);
    d.link('cable_signal', button, 'out', beacon, 'call');
    D.buzz_beacon = d.done(120, { target: [-0.1, 0.05, 0.1], dist: 1 });
  }
  {
    // SINGULARITY: a THUD on THE BUTTON arms it; the balls and bricks around it are pulled in and swallowed
    const d = make();
    const sing = d.add('singularity', [0, 0, 0]);
    const button = d.add('the_button', [-0.6, 0, 0.6]);
    d.add('thud', [-0.6, 0.2, 0.6]);
    d.link('cable_signal', button, 'out', sing, 'arm');
    d.add('stitch', [1.2, 0.0375, 0]);
    d.add('boing', [-1.5, 0.12, -0.4]);
    d.add('brik', [0, 0.05, 1.6]);
    d.add('pig_iron', [0.9, 0.06, -1.4]);
    for (let k = 0; k < 3; k++) d.add('topple_tile', [-0.8 - 0.1 * k, 0.075, 1.0]);
    D.singularity = d.done(360, { target: [0, 0.1, 0], dist: 2.2 });
  }
  {
    // GRABBER: powered and set to repeat, it picks up the STITCH at zone A and puts it down at zone B
    const d = make();
    const mains = d.add('mains', [-0.4, 0, -0.4]);
    const arm = d.add('grabber', [0, 0, 0], { loop: 1, grip: 0.08 });
    d.link('cable_power', mains, 'out', arm, 'in');
    const a = grabberZone({}, 'a');
    d.add('stitch', [a[0], 0.0375, a[2]]);
    D.grabber = d.done(360, { target: [0, 0.2, 0.1], dist: 1.4 });
  }
  return D;
}
