// Part definitions (PART_SYSTEM §1), M1 set. Values come from the audited briefs (docs/art/briefs)
// converted to engine space: Y-up, metres, front = +Z (Blender (x, y, z) → engine (x, z, −y)).
// Collision here is the blockout until each part's `.shapes.json` lands from the art pipeline.

import { dcos, dsin } from '@knockon/detmath';
// critters (stream B): MOCHI, PIP, GOBY, BANDIT live in critters.ts, which only type-imports this file
import { CRITTER_PARTS, type CritterSpec } from './critters.ts';
// M2 machine parts (stream A) live in defs_m2.ts, which only type-imports this file
import { PARTS_M2 } from './defs_m2.ts';
export { BIG_TOP, FLAP, GOTCHA, TURBINE, VORTEX_PROFILES, bigTopAxis, bigTopEnergy, bigTopTouchHole, lureOf, qAxis, qBasis, qMul, vortexProfile } from './defs_m2.ts';
// M3 parts (stream A3) live in defs_m3.ts, which only type-imports this file (index.ts re-exports its constants)
import { PARTS_M3, bindPartLookup } from './defs_m3.ts';
// M4 parts (stream A4) live in defs_m4.ts, which only type-imports this file (index.ts re-exports its constants)
import { PARTS_M4 } from './defs_m4.ts';
// M5 parts (stream A5) live in defs_m5.ts, which only type-imports this file (index.ts re-exports its constants)
import { PARTS_M5 } from './defs_m5.ts';
// X5 (M5): GOO VAT lives in defs_m5_matter.ts, which only type-imports this file (index.ts re-exports its constants)
import { PARTS_M5_MATTER } from './defs_m5_matter.ts';

export type V3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type Channel = 'impact' | 'signal' | 'spin' | 'tension' | 'power' | 'heat' | 'air';
export type Family = 'rollers' | 'frame' | 'drive' | 'air' | 'power' | 'boom' | 'contraptions' | 'fun' | 'future' | 'critters' | 'matter'; // 'matter': A4 (M4 Matter parts)

export interface ShapeDef {
  readonly kind: 'box' | 'sphere' | 'cylinder' | 'capsule';
  /** Full extents. sphere: x = diameter. cylinder/capsule: x = diameter, y = length along `axis`. */
  readonly size: V3;
  readonly at?: V3;
  readonly axis?: 'x' | 'y' | 'z';
  /** Rotation about Z (degrees), applied before `at` (slopes). */
  readonly tiltZ?: number;
  /** Which body of a multi-body part carries it ('piece': the part's pre-built spawned body, e.g. a cork). */
  readonly on?: 'base' | 'arm' | 'piece';
  /** Extra local rotation [x, y, z, w], applied after `axis` and `tiltZ` (M2: funnel staves, pitched blades). */
  readonly rot?: Quat;
}

export interface VisualDef {
  readonly mesh: 'box' | 'sphere' | 'cylinder';
  readonly size: V3;
  readonly at?: V3;
  readonly axis?: 'x' | 'y' | 'z';
  readonly tiltZ?: number;
  readonly color: string;
  readonly rough?: number;
  readonly metal?: number;
  readonly emissive?: number;
  readonly on?: 'base' | 'arm' | 'piece';
  /** Drawn only in this state (e.g. a lit wick's flame). */
  readonly when?: 'lit' | 'powered' | 'pressed';
}

export interface PortDef {
  readonly name: string;
  readonly channel: Channel;
  readonly dir: 'in' | 'out' | 'both';
  readonly at: V3;
  readonly maxLinks?: number;
  readonly kind?: 'axle' | 'hook';
  readonly on?: 'base' | 'arm';
  /** Signal output that may take up to 64 links (PART_SYSTEM §3: T-PLUNGER). */
  readonly broadcast?: boolean;
}

/** Physics material (SIMULATION §4.3). */
export type PhysMaterial = 'powder' | 'rubber' | 'steel' | 'wood' | 'glass' | 'paper' | 'brick' | 'latex' | 'fur' | 'ceramic' | 'fabric' | 'chrome' | 'brass';

/** Lure tag (SIMULATION §5.11, M2 contract 2): critter species → weight, within `radius` metres. */
export interface Lure {
  readonly species: Readonly<Record<string, number>>;
  readonly radius: number;
}

/** A body a part spawns during a run (cork, head): pre-built with the world, dormant until used (D66). */
export interface PieceDef {
  /** In part space, like arm shapes. */
  readonly shapes: readonly ShapeDef[];
  readonly mass: number;
  readonly friction: number;
  readonly restitution: number;
  /** Pops Helios on contact. */
  readonly sharp?: boolean;
  readonly ccd?: boolean;
  /** Moved by the part's behaviour (Jolt kinematic body) instead of simulated. */
  readonly kinematic?: boolean;
}

/** A linear actuator: the `on: 'arm'` shapes ride a slider along `axis` (SIMULATION §4.4, PUNCHLINE). */
export interface SliderDef {
  readonly at: V3;
  readonly axis: V3;
  readonly limits: readonly [number, number];
  readonly armMass: number;
}

export interface PropSpec {
  readonly type: 'seconds' | 'float' | 'metres' | 'angle' | 'percent' | 'kg' | 'enum' | 'bool' | 'int';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default: number;
  readonly values?: readonly string[];
  readonly label: string;
}

export interface HingeDef {
  readonly at: V3;
  readonly axis: V3;
  /** Degrees; omitted = free spin. */
  readonly limits?: readonly [number, number];
  readonly armMass: number;
  readonly armMassFor?: (props: Props) => number;
  /** Arm collides with nothing (drive rotors: shafts, drums). */
  readonly ghostArm?: boolean;
}

export interface PartDef {
  readonly type: string;
  readonly family: Family;
  readonly name: string;
  readonly tag: string;
  readonly ship: 'M1' | 'M2' | 'M3' | 'M4' | 'M5'; // 'M4': the M4 parts (A4) and critters (B4); 'M5': A5's parts and BUZZ (B5)
  /** Local bounds around the origin (placement, picking, overlap checks). */
  readonly bounds: { readonly min: V3; readonly max: V3 };
  /** Bounds that depend on properties (resizable parts, cog sizes). */
  readonly boundsFor?: (props: Props) => { readonly min: V3; readonly max: V3 };
  readonly body: {
    readonly kind: 'static' | 'dynamic';
    readonly mass: number;
    readonly friction: number;
    readonly restitution: number;
    readonly ccd?: boolean;
    readonly gravityFactor?: number;
    /** Any collider is tagged sharp (pops Helios: Cog teeth, Snipper blades). */
    readonly sharp?: boolean;
    readonly material?: PhysMaterial;
    /** Field parts act on it (PIG IRON). */
    readonly magnetic?: boolean;
    /**
     * X5 (M5): moves the base body's centre of mass by this offset (part space, m) from the shapes' own (uniform density),
     * like a weighted keel: QUACK's, so it floats upright and rights itself.
     */
    readonly com?: V3;
  };
  readonly hinge?: HingeDef;
  readonly slider?: SliderDef;
  readonly piece?: PieceDef;
  /** Critter attractor (contract 2); shiny small bodies get one computed by `lureOf`. */
  readonly lure?: Lure;
  readonly shapes: (props: Props) => readonly ShapeDef[];
  readonly visuals: (props: Props) => readonly VisualDef[];
  readonly ports: readonly PortDef[];
  readonly props: Readonly<Record<string, PropSpec>>;
  /** Behaviour ids (PART_SYSTEM §4.3), run in this order. */
  readonly behaviours: readonly string[];
  readonly explosive?: { readonly yield: number };
  readonly flammable?: { readonly igniteTime: number };
  readonly power?: { readonly source?: number; readonly consumer?: number };
  /** Pipeline art mesh replaces the blockout visuals when built (ASSET_PIPELINE §8). */
  readonly art?: string;
  /** Per-prop art mesh (COG: one mesh per size); overrides `art`. */
  readonly artFor?: (props: Props) => string;
  /** Part-space placement of the art mesh when a prop moves it (SLOPE: authored flat, tilted to `angle`). */
  readonly artAt?: (props: Props) => { readonly at: V3; readonly tiltZ: number };
  /** Critters only (family 'critters'): AI numbers, locomotion capsule and ragdoll (critters.ts, contract 3). */
  readonly critter?: CritterSpec;
}

export type Props = Readonly<Record<string, number>>;

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const centred = (s: V3): PartDef['bounds'] => b([-s[0] / 2, -s[1] / 2, -s[2] / 2], [s[0] / 2, s[1] / 2, s[2] / 2]);
const bottom = (s: V3): PartDef['bounds'] => b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]);
const none = (): readonly ShapeDef[] => [];

// Palette (ART_BIBLE §3.1 powders, look-dev).
const C = {
  ignition: '#FF5B2E', graphite: '#3A3E47', bone: '#E8E2D6', brick: '#B5553B', oak: '#C8945A', red: '#D93A2B',
  steel: '#A9AFB8', volt: '#C6F432', beam: '#2FD6FF', plasma: '#FF3DAE', amber: '#FFB020', cobalt: '#2E5BFF',
  rubber: '#25272D', cord: '#4A3524', wax: '#C9302C', flame: '#FFC870', tan: '#D9C29A',
};

const COG_SIZES = [
  { teeth: 20, pitch: 0.1, tip: 0.11, mass: 0.25 },
  { teeth: 40, pitch: 0.2, tip: 0.21, mass: 0.9 },
  { teeth: 60, pitch: 0.3, tip: 0.31, mass: 2.0 },
] as const;
export const cogSize = (p: Props): (typeof COG_SIZES)[number] => COG_SIZES[Math.max(0, Math.min(2, p.size ?? 1))]!;

// SLOPE is authored flat (origin bottom centre) and tilted about its low edge (x = −L/2, y = 0) by `angle`.
// Colliders follow the art: the deck box, plus the knife-edge nose (frame.md: 0.08 m long, top tapering
// 0.05 → 0.006 m at the low end) as a thin box whose top face lies on the taper.
const SLOPE_NOSE = { len: 0.08, tip: 0.006, deg: 28.81 /* atan(0.044 / 0.08) */, t: 0.02 };
const slopeParts = (p: Props): { at: V3; tilt: number; size: V3 }[] => {
  const L = p.length ?? 0.6, W = p.width ?? 0.2, deg = p.angle ?? 20, a = (deg * Math.PI) / 180;
  const tf = (x: number, y: number): V3 => [-L / 2 + (x + L / 2) * dcos(a) - y * dsin(a), (x + L / 2) * dsin(a) + y * dcos(a), 0];
  const n = SLOPE_NOSE, b = (n.deg * Math.PI) / 180;
  const nose = { cx: -L / 2 + n.len / 2 + (n.t / 2) * dsin(b), cy: (n.tip + 0.05) / 2 - (n.t / 2) * dcos(b) };
  return [
    { at: tf(n.len / 2, 0.025), tilt: deg, size: [L - n.len, 0.05, W] },
    { at: tf(nose.cx, nose.cy), tilt: deg + n.deg, size: [n.len / dcos(b), n.t, W] },
  ];
};

export const PARTS: readonly PartDef[] = [
  // ---- Rollers --------------------------------------------------------------------------------------
  {
    type: 'thud', family: 'rollers', name: 'THUD', tag: 'Heavy ball', ship: 'M1', bounds: centred([0.22, 0.22, 0.22]),
    body: { kind: 'dynamic', mass: 7.0, friction: 0.3, restitution: 0.12 },
    shapes: () => [{ kind: 'sphere', size: [0.22, 0.22, 0.22] }],
    visuals: () => [{ mesh: 'sphere', size: [0.22, 0.22, 0.22], color: C.graphite, rough: 0.32 }],
    ports: [], props: {}, behaviours: ['rigid_basic'], art: 'thud',
  },
  {
    type: 'boing', family: 'rollers', name: 'BOING', tag: 'Bouncy ball', ship: 'M1', bounds: centred([0.24, 0.24, 0.24]),
    body: { kind: 'dynamic', mass: 0.6, friction: 0.6, restitution: 0.82 },
    shapes: () => [{ kind: 'sphere', size: [0.24, 0.24, 0.24] }],
    visuals: () => [{ mesh: 'sphere', size: [0.24, 0.24, 0.24], color: C.ignition, rough: 0.55 }],
    ports: [], props: {}, behaviours: ['rigid_basic'], art: 'boing',
  },
  {
    type: 'stitch', family: 'rollers', name: 'STITCH', tag: 'Hard ball', ship: 'M2', bounds: centred([0.075, 0.075, 0.075]),
    body: { kind: 'dynamic', mass: 0.15, friction: 0.45, restitution: 0.5, ccd: true },
    shapes: () => [{ kind: 'sphere', size: [0.075, 0.075, 0.075] }],
    visuals: () => [{ mesh: 'sphere', size: [0.075, 0.075, 0.075], color: C.bone, rough: 0.45 }],
    ports: [], props: {}, art: 'stitch', behaviours: ['rigid_basic'],
  },
  {
    // Toy helium (SIMULATION §5.1): constant 4.9 N × air% lift, quadratic drag, pops on sharp/hot/fast.
    // The rigid mass is an effective mass (latex + entrained air) so the solver stays stable; its
    // weight is scaled back to the real 4 g with the gravity factor (DECISIONS D52).
    type: 'helio', family: 'rollers', name: 'HELIO', tag: 'Balloon', ship: 'M1', bounds: b([-0.125, -0.175, -0.125], [0.125, 0.155, 0.125]),
    body: { kind: 'dynamic', mass: 0.08, friction: 0.6, restitution: 0.4, gravityFactor: 0.05 },
    shapes: () => [{ kind: 'sphere', size: [0.25, 0.25, 0.25] }],
    visuals: () => [
      { mesh: 'sphere', size: [0.25, 0.28, 0.25], color: C.plasma, rough: 0.25 },
      { mesh: 'cylinder', size: [0.02, 0.025, 0.02], at: [0, -0.155, 0], color: C.plasma, rough: 0.4 },
    ],
    ports: [{ name: 'knot', channel: 'tension', dir: 'both', at: [0, -0.172, 0.006], kind: 'hook' }],
    props: {}, behaviours: ['rigid_basic', 'helio'], art: 'helio',
  },
  // ---- Frame ----------------------------------------------------------------------------------------
  {
    type: 'brik', family: 'frame', name: 'BRIK', tag: 'Brick', ship: 'M1', bounds: centred([0.2, 0.1, 0.1]),
    body: { kind: 'dynamic', mass: 3.6, friction: 0.7, restitution: 0.05 },
    shapes: () => [{ kind: 'box', size: [0.2, 0.1, 0.1] }],
    visuals: () => [{ mesh: 'box', size: [0.2, 0.1, 0.1], color: C.brick, rough: 0.85 }],
    ports: [],
    // kn_mortar_break: fixed joints to face-touching neighbours break above this impulse (frame.md)
    props: { mortar: { type: 'float', min: 4, max: 40, step: 1, default: 12, label: 'Mortar (N·s)' } },
    behaviours: ['rigid_basic', 'breakable'], art: 'brik',
  },
  {
    type: 'plank', family: 'frame', name: 'PLANK', tag: 'Board', ship: 'M1', bounds: centred([0.1, 0.1, 1.0]),
    body: { kind: 'dynamic', mass: 6.0, friction: 0.55, restitution: 0.2 },
    shapes: () => [{ kind: 'box', size: [0.1, 0.1, 1.0] }],
    visuals: () => [{ mesh: 'box', size: [0.1, 0.1, 1.0], color: C.oak, rough: 0.65 }],
    ports: [], props: {}, behaviours: ['rigid_basic', 'breakable', 'flammable'], flammable: { igniteTime: 4.0 }, art: 'plank',
  },
  {
    type: 'slope', family: 'frame', name: 'SLOPE', tag: 'Ramp', ship: 'M1', bounds: b([-0.3, 0, -0.1], [0.3, 0.25, 0.1]),
    body: { kind: 'static', mass: 0, friction: 0.5, restitution: 0.3 },
    shapes: (p) => slopeParts(p).map((d) => ({ kind: 'box' as const, size: d.size, at: d.at, tiltZ: d.tilt })),
    visuals: (p) => slopeParts(p).map((d) => ({ mesh: 'box' as const, size: d.size, at: d.at, tiltZ: d.tilt, color: C.amber, rough: 0.5 })),
    ports: [],
    props: { angle: { type: 'angle', min: 5, max: 60, step: 5, default: 20, label: 'Angle' } },
    behaviours: ['rigid_basic'], art: 'slope',
    // the art is authored flat (origin bottom centre); tilt it about the low edge (x = −L/2, y = 0) like the deck
    artAt: (p) => {
      const L = p.length ?? 0.6, a = ((p.angle ?? 20) * Math.PI) / 180;
      return { at: [-L / 2 + (L / 2) * dcos(a), (L / 2) * dsin(a), 0], tiltZ: p.angle ?? 20 };
    },
  },
  {
    type: 'ledge', family: 'frame', name: 'LEDGE', tag: 'Shelf', ship: 'M1', bounds: bottom([0.4, 0.05, 0.4]),
    body: { kind: 'static', mass: 0, friction: 0.5, restitution: 0.3 },
    shapes: () => [{ kind: 'box', size: [0.4, 0.05, 0.4], at: [0, 0.025, 0] }],
    visuals: () => [{ mesh: 'box', size: [0.4, 0.05, 0.4], at: [0, 0.025, 0], color: C.bone, rough: 0.5 }],
    ports: [], props: {}, behaviours: ['rigid_basic'], art: 'ledge',
  },
  {
    // Origin on the hinge pin, 0.065 m above the floor; the beam rests on its ±12° stops.
    type: 'fulcrum', family: 'frame', name: 'FULCRUM', tag: 'Seesaw', ship: 'M1', bounds: b([-0.3, -0.065, -0.1], [0.3, 0.045, 0.1]),
    body: { kind: 'static', mass: 2.5, friction: 0.5, restitution: 0.25 },
    hinge: { at: [0, 0, 0], axis: [0, 0, 1], limits: [-12, 12], armMass: 1.0 },
    shapes: () => [
      { kind: 'box', size: [0.06, 0.05, 0.16], at: [0, -0.04, 0] },
      { kind: 'box', size: [0.56, 0.025, 0.1], at: [0, 0.022, 0], on: 'arm' },
      { kind: 'box', size: [0.04, 0.04, 0.1], at: [-0.28, 0.022, 0], on: 'arm' },
      { kind: 'box', size: [0.04, 0.04, 0.1], at: [0.28, 0.022, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.08, 0.065, 0.16], at: [0, -0.0325, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.02, 0.18, 0.02], axis: 'z', color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.56, 0.025, 0.1], at: [0, 0.022, 0], color: C.oak, rough: 0.6, on: 'arm' },
      { mesh: 'box', size: [0.04, 0.04, 0.1], at: [-0.28, 0.022, 0], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.04, 0.04, 0.1], at: [0.28, 0.022, 0], color: C.ignition, rough: 0.4, on: 'arm' },
    ],
    ports: [
      { name: 'end_l', channel: 'tension', dir: 'both', at: [-0.28, 0.022, 0.05], kind: 'hook', on: 'arm' },
      { name: 'end_r', channel: 'tension', dir: 'both', at: [0.28, 0.022, 0.05], kind: 'hook', on: 'arm' },
    ],
    props: {}, behaviours: ['hinge_passive'], art: 'fulcrum',
  },
  {
    type: 'anchor', family: 'frame', name: 'ANCHOR', tag: 'Hook point', ship: 'M1', bounds: bottom([0.05, 0.05, 0.05]),
    body: { kind: 'static', mass: 0, friction: 0.5, restitution: 0.25 },
    shapes: () => [{ kind: 'cylinder', size: [0.052, 0.014, 0.052], at: [0, 0.007, 0] }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.052, 0.014, 0.052], at: [0, 0.007, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.024, 0.03, 0.006], at: [0, 0.03, 0], axis: 'z', color: C.steel, metal: 1, rough: 0.3 },
    ],
    ports: [{ name: 'hook', channel: 'tension', dir: 'both', at: [0, 0.014, 0], kind: 'hook', maxLinks: 4 }],
    props: {}, behaviours: ['rigid_basic'], art: 'anchor',
  },
  {
    // Origin at the axle centre; ropes route over it (PulleyConstraint, SIMULATION §5.4).
    type: 'sheave', family: 'frame', name: 'SHEAVE', tag: 'Pulley', ship: 'M1', bounds: b([-0.05, -0.05, -0.025], [0.05, 0.1, 0.025]),
    body: { kind: 'static', mass: 0.35, friction: 0.3, restitution: 0.2 },
    shapes: () => [{ kind: 'cylinder', size: [0.1, 0.022, 0.1], axis: 'z' }, { kind: 'box', size: [0.07, 0.1, 0.046], at: [0, 0.03, 0] }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.1, 0.022, 0.1], axis: 'z', color: C.steel, metal: 1, rough: 0.25 },
      { mesh: 'box', size: [0.07, 0.07, 0.046], at: [0, 0.05, 0], color: C.graphite, rough: 0.4 },
    ],
    ports: [
      { name: 'axle', channel: 'tension', dir: 'both', at: [0, 0, 0.023], kind: 'axle', maxLinks: 2 },
      { name: 'mount', channel: 'tension', dir: 'both', at: [0, 0.088, 0], kind: 'hook' },
    ],
    props: {}, behaviours: ['rigid_basic'], art: 'sheave',
  },
  // ---- Drive ----------------------------------------------------------------------------------------
  {
    // Belt surface speed = ω·r of its drum (r 0.034 m), driven through a BAND (SIMULATION §4.5).
    type: 'treadway', family: 'drive', name: 'TREADWAY', tag: 'Conveyor', ship: 'M1', bounds: bottom([0.6, 0.1, 0.2]),
    body: { kind: 'static', mass: 2.3, friction: 1.0, restitution: 0.2 },
    hinge: { at: [-0.25, 0.058, 0], axis: [0, 0, 1], armMass: 0.3, ghostArm: true },
    shapes: () => [
      { kind: 'box', size: [0.6, 0.08, 0.2], at: [0, 0.04, 0] },
      { kind: 'box', size: [0.58, 0.012, 0.16], at: [0, 0.086, 0] },
      { kind: 'cylinder', size: [0.06, 0.16, 0.06], axis: 'z', at: [-0.25, 0.058, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.6, 0.075, 0.2], at: [0, 0.0375, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.58, 0.014, 0.16], at: [0, 0.086, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.06, 0.17, 0.06], axis: 'z', at: [-0.25, 0.058, 0], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
    ],
    ports: [
      { name: 'drive_l', channel: 'spin', dir: 'both', at: [-0.25, 0.058, 0.101], kind: 'axle' },
      { name: 'drive_r', channel: 'spin', dir: 'both', at: [0.25, 0.058, 0.101], kind: 'axle' },
    ],
    props: {}, behaviours: ['conveyor'], art: 'treadway',
  },
  {
    // Spur gear on a free axle. Meshing is automatic: parallel axes, centre distance = sum of pitch radii.
    type: 'cog', family: 'drive', name: 'COG', tag: 'Gear', ship: 'M1', bounds: centred([0.21, 0.21, 0.055]),
    body: { kind: 'static', mass: 0, friction: 0.4, restitution: 0.2, sharp: true },
    hinge: { at: [0, 0, 0], axis: [0, 0, 1], armMass: 0.9, armMassFor: (p) => cogSize(p).mass },
    boundsFor: (p) => { const r = cogSize(p).tip / 2; return b([-r, -r, -0.03], [r, r, 0.025]); },
    shapes: (p) => {
      const g = cogSize(p);
      // collide on the pitch circle less a hair so meshing partners never touch (gear constraint does the work)
      return [{ kind: 'cylinder', size: [g.pitch - 0.008, 0.025, g.pitch - 0.008], axis: 'z', on: 'arm' }];
    },
    visuals: (p) => {
      const g = cogSize(p);
      return [
        { mesh: 'cylinder', size: [0.034, 0.03, 0.034], at: [0, 0, -0.01], axis: 'z', color: C.graphite, rough: 0.4 },
        { mesh: 'cylinder', size: [g.tip, 0.025, g.tip], axis: 'z', color: C.cobalt, rough: 0.35, metal: 0.6, on: 'arm' },
        { mesh: 'box', size: [g.tip * 0.98, 0.012, 0.027], color: C.volt, rough: 0.4, on: 'arm' },
        { mesh: 'cylinder', size: [0.012, 0.045, 0.012], axis: 'z', color: C.steel, metal: 1, rough: 0.25, on: 'arm' },
      ];
    },
    ports: [{ name: 'axle', channel: 'spin', dir: 'both', at: [0, 0, 0.0205], kind: 'axle' }],
    props: { size: { type: 'enum', values: ['S', 'M', 'L'], default: 1, label: 'Size' } },
    behaviours: ['rotator_driven'], art: 'cog_m', artFor: (p) => ['cog_s', 'cog_m', 'cog_l'][p.size ?? 1]!,
  },
  {
    // 120 W at 60 % efficiency: no-load 9.42 rad/s, stall 30 N·m, both × supply factor (SIMULATION §5.3).
    type: 'motor', family: 'drive', name: 'MOTOR', tag: 'Electric motor', ship: 'M1', bounds: bottom([0.2, 0.2, 0.19]),
    body: { kind: 'static', mass: 1.6, friction: 0.5, restitution: 0.25 },
    // the armature (Ø 0.12, 0.6 kg) gives the drive train a sane inertia next to a 2 kg COG L
    hinge: { at: [0.101, 0.1, 0], axis: [1, 0, 0], armMass: 0.6, ghostArm: true },
    // the armature's collider sits on the shaft axis so the rotor spins in place (it collides with nothing)
    shapes: () => [{ kind: 'box', size: [0.2, 0.19, 0.19], at: [0, 0.1, 0] }, { kind: 'cylinder', size: [0.12, 0.03, 0.12], axis: 'x', at: [0.101, 0.1, 0], on: 'arm' }],
    visuals: () => [
      { mesh: 'box', size: [0.05, 0.19, 0.19], at: [-0.075, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.05, 0.19, 0.19], at: [0.075, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.15, 0.1, 0.15], at: [0, 0.1, 0], axis: 'x', color: '#B8742E', rough: 0.35, metal: 0.8 },
      { mesh: 'box', size: [0.008, 0.06, 0.06], at: [0.008, 0.1, 0], color: C.steel, rough: 0.3, metal: 1, on: 'arm' },
      { mesh: 'cylinder', size: [0.016, 0.03, 0.016], axis: 'x', at: [0.101, 0.1, 0], color: C.steel, rough: 0.25, metal: 1, on: 'arm' },
      { mesh: 'cylinder', size: [0.022, 0.006, 0.022], at: [-0.075, 0.16, 0.096], axis: 'z', color: C.volt, emissive: 0.6, when: 'powered' },
    ],
    ports: [
      { name: 'in', channel: 'power', dir: 'in', at: [-0.075, 0.1, 0.096] },
      { name: 'out', channel: 'spin', dir: 'out', at: [0.101, 0.1, 0], kind: 'axle' },
    ],
    props: { direction: { type: 'enum', values: ['CW', 'CCW'], default: 0, label: 'Direction' } },
    behaviours: ['rotator_source', 'power_consumer'], power: { consumer: 120 }, art: 'motor',
  },
  // ---- Air ------------------------------------------------------------------------------------------
  {
    type: 'gale', family: 'air', name: 'GALE', tag: 'Fan', ship: 'M1', bounds: bottom([0.2, 0.2, 0.1]),
    body: { kind: 'static', mass: 0.9, friction: 0.5, restitution: 0.25 },
    shapes: () => [{ kind: 'cylinder', size: [0.095, 0.03, 0.095], at: [0, 0.015, 0] }, { kind: 'cylinder', size: [0.15, 0.035, 0.15], at: [0, 0.122, 0.005], axis: 'z' }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.095, 0.03, 0.095], at: [0, 0.015, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.012, 0.09, 0.012], at: [0, 0.075, -0.022], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.15, 0.03, 0.15], at: [0, 0.122, 0.005], axis: 'z', color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.125, 0.034, 0.125], at: [0, 0.122, 0.006], axis: 'z', color: C.tan, rough: 0.5 },
      { mesh: 'cylinder', size: [0.022, 0.006, 0.022], at: [0.03, 0.019, 0.045], axis: 'z', color: C.volt, emissive: 0.6, when: 'powered' },
    ],
    ports: [{ name: 'in', channel: 'power', dir: 'in', at: [0, 0.019, 0.048] }],
    props: {}, behaviours: ['air_emitter', 'power_consumer'], power: { consumer: 60 }, art: 'gale',
  },
  // ---- Power and signal -----------------------------------------------------------------------------
  {
    type: 'mains', family: 'power', name: 'MAINS', tag: 'Power block', ship: 'M1', bounds: bottom([0.2, 0.2, 0.1]),
    body: { kind: 'static', mass: 1.8, friction: 0.5, restitution: 0.25 },
    shapes: () => [{ kind: 'box', size: [0.2, 0.19, 0.1], at: [0, 0.1, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.19, 0.1], at: [0, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.17, 0.15, 0.01], at: [0, 0.1, 0.05], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.02, 0.07, 0.03], at: [-0.045, 0.13, 0.07], color: C.ignition, rough: 0.35 },
      { mesh: 'cylinder', size: [0.026, 0.008, 0.026], at: [0.05, 0.15, 0.056], axis: 'z', color: C.volt, emissive: 0.8, when: 'powered' },
    ],
    ports: [
      { name: 'out', channel: 'power', dir: 'out', at: [0.101, 0.1, 0], maxLinks: 6 },
      { name: 'in', channel: 'signal', dir: 'in', at: [-0.101, 0.1, 0] },
    ],
    props: { on: { type: 'bool', default: 1, label: 'On at start' } },
    behaviours: ['power_source'], power: { source: 500 }, art: 'mains',
  },
  {
    type: 'stomp_pad', family: 'power', name: 'STOMP PAD', tag: 'Pressure plate', ship: 'M1', bounds: bottom([0.2, 0.03, 0.2]),
    body: { kind: 'static', mass: 1.2, friction: 1.0, restitution: 0.2 },
    shapes: () => [{ kind: 'box', size: [0.2, 0.03, 0.2], at: [0, 0.015, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.027, 0.2], at: [0, 0.0135, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.14, 0.006, 0.14], at: [-0.01, 0.027, -0.01], color: C.ignition, rough: 0.7 },
      { mesh: 'box', size: [0.14, 0.006, 0.14], at: [-0.01, 0.0275, -0.01], color: C.volt, emissive: 0.5, when: 'pressed' },
    ],
    ports: [{ name: 'out', channel: 'signal', dir: 'out', at: [0.08, 0.03, 0.08], maxLinks: 8 }],
    props: { weight: { type: 'kg', min: 0.05, max: 20, step: 0.05, default: 0.5, label: 'Trigger weight' } },
    behaviours: ['sensor_pulse'], art: 'stomp_pad',
  },
  {
    type: 'the_button', family: 'power', name: 'THE BUTTON', tag: 'Big red button', ship: 'M1', bounds: bottom([0.1, 0.084, 0.1]),
    body: { kind: 'static', mass: 0.6, friction: 0.5, restitution: 0.4 },
    shapes: () => [{ kind: 'cylinder', size: [0.1, 0.05, 0.1], at: [0, 0.025, 0] }, { kind: 'cylinder', size: [0.076, 0.03, 0.076], at: [0, 0.065, 0] }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.1, 0.05, 0.1], at: [0, 0.025, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.094, 0.012, 0.094], at: [0, 0.055, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'sphere', size: [0.076, 0.042, 0.076], at: [0, 0.063, 0], color: C.ignition, rough: 0.25 },
      { mesh: 'sphere', size: [0.078, 0.04, 0.078], at: [0, 0.06, 0], color: C.ignition, emissive: 0.7, when: 'pressed' },
    ],
    ports: [{ name: 'out', channel: 'signal', dir: 'out', at: [0, 0.026, 0.0467], maxLinks: 8 }],
    props: {}, behaviours: ['sensor_pulse'], art: 'the_button',
  },
  // ---- Fire and boom --------------------------------------------------------------------------------
  {
    // Lit at the start; knocked over it stays lit; wind > 4 m/s douses it (SIMULATION §5.7).
    type: 'wick', family: 'boom', name: 'WICK', tag: 'Candle', ship: 'M1', bounds: bottom([0.1, 0.2, 0.1]),
    body: { kind: 'dynamic', mass: 0.35, friction: 0.7, restitution: 0.2 },
    shapes: () => [{ kind: 'cylinder', size: [0.1, 0.035, 0.1], at: [0, 0.0175, 0] }, { kind: 'cylinder', size: [0.045, 0.13, 0.045], at: [0, 0.1, 0] }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.1, 0.035, 0.1], at: [0, 0.0175, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.045, 0.13, 0.045], at: [0, 0.1, 0], color: C.wax, rough: 0.6 },
      { mesh: 'cylinder', size: [0.004, 0.014, 0.004], at: [0, 0.172, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'sphere', size: [0.016, 0.034, 0.016], at: [0, 0.198, 0], color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [{ name: 'flame', channel: 'heat', dir: 'both', at: [0, 0.019, 0.047] }],
    props: { lit: { type: 'bool', default: 1, label: 'Lit at start' } },
    behaviours: ['heat_source'], art: 'wick',
  },
  {
    // Origin = centre of mass, 0.039 m above the floor (boom.md, D31). Detonates on fuse burn-out,
    // a detonator Signal or a sympathetic blast.
    type: 'bangstick', family: 'boom', name: 'BANGSTICK', tag: 'Dynamite', ship: 'M1', bounds: b([-0.143, -0.039, -0.05], [0.16, 0.061, 0.05]),
    body: { kind: 'dynamic', mass: 0.8, friction: 0.6, restitution: 0.2 },
    shapes: () => [
      { kind: 'capsule', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, -0.014, 0.025] },
      { kind: 'capsule', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, -0.014, -0.025] },
      { kind: 'capsule', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, 0.029, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, -0.014, 0.025], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, -0.014, -0.025], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.05, 0.28, 0.05], axis: 'x', at: [0, 0.029, 0], color: C.red, rough: 0.6 },
      { mesh: 'box', size: [0.021, 0.1, 0.104], at: [-0.07, 0.006, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.021, 0.1, 0.104], at: [0.07, 0.006, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.075, 0.027, 0.004], at: [0, 0.012, 0.051], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.006, 0.03, 0.006], axis: 'x', at: [0.155, 0.045, 0], color: C.cord, rough: 0.8 },
    ],
    ports: [
      { name: 'detonator', channel: 'signal', dir: 'in', at: [-0.14, 0, 0] },
      { name: 'fuse', channel: 'heat', dir: 'in', at: [0.14, 0.029, 0] },
    ],
    props: { fuse: { type: 'seconds', min: 0.5, max: 5, step: 0.1, default: 2.0, label: 'Fuse' } },
    behaviours: ['rigid_basic', 'explosive'], explosive: { yield: 1 }, flammable: { igniteTime: 0.05 }, art: 'bangstick',
  },
  // ---- Contraptions ---------------------------------------------------------------------------------
  {
    type: 'snipper', family: 'contraptions', name: 'SNIPPER', tag: 'Scissors', ship: 'M1', bounds: bottom([0.3, 0.1, 0.2]),
    body: { kind: 'static', mass: 1.4, friction: 0.5, restitution: 0.2, sharp: true },
    shapes: () => [{ kind: 'box', size: [0.24, 0.036, 0.18], at: [0, 0.018, 0] }, { kind: 'box', size: [0.024, 0.05, 0.024], at: [0.02, 0.05, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.24, 0.036, 0.18], at: [0, 0.018, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.024, 0.05, 0.024], at: [0.02, 0.05, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.14, 0.008, 0.02], at: [0.08, 0.068, 0.012], tiltZ: 10, color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'box', size: [0.14, 0.008, 0.02], at: [0.08, 0.052, -0.012], tiltZ: -10, color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'box', size: [0.07, 0.02, 0.05], at: [-0.06, 0.06, 0], color: C.ignition, rough: 0.4 },
    ],
    ports: [{ name: 'close', channel: 'signal', dir: 'in', at: [-0.06, 0.02, 0.091] }],
    props: {}, behaviours: ['cutter'], art: 'snipper',
  },
  // ---- Fun ------------------------------------------------------------------------------------------
  {
    type: 'topple_tile', family: 'fun', name: 'TOPPLE TILES', tag: 'Domino', ship: 'M1', bounds: centred([0.03, 0.15, 0.075]),
    body: { kind: 'dynamic', mass: 0.2, friction: 0.45, restitution: 0.15 },
    shapes: () => [{ kind: 'box', size: [0.03, 0.15, 0.075] }],
    visuals: () => [{ mesh: 'box', size: [0.03, 0.15, 0.075], color: C.bone, rough: 0.4 }],
    ports: [], props: {}, behaviours: ['rigid_basic'], art: 'topple_tile',
  },
  // ---- M2 machine parts (stream A): defs_m2.ts --------------------------------------------------------
  ...PARTS_M2,
  // ---- M3 parts (stream A3): defs_m3.ts ----------------------------------------------------------------
  ...PARTS_M3,
  // ---- M4 parts (stream A4): defs_m4.ts ----------------------------------------------------------------
  ...PARTS_M4,
  // ---- M5 parts (stream A5): defs_m5.ts ----------------------------------------------------------------
  ...PARTS_M5,
  // ---- M5 Matter part (stream X5): defs_m5_matter.ts (GOO VAT) -------------------------------------------
  ...PARTS_M5_MATTER,
  // ---- Critter-bound devices (stream B; behaviour in packages/sim/src/critters, data in critters.ts) ----
  {
    // drive.md: Pip's wheel. Spin source only while Pip sprints (5 rad/s, 40 N·m stall, 6 s, then a 1 s coast).
    type: 'hamster_drive', family: 'drive', name: 'HAMSTER DRIVE', tag: 'Hamster wheel motor', ship: 'M2', bounds: bottom([0.3, 0.3, 0.2]),
    body: { kind: 'static', mass: 3.2, friction: 0.5, restitution: 0.25 },
    hinge: { at: [0, 0.162, -0.005], axis: [0, 0, 1], armMass: 0.6 },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.02, 0.2], at: [0, 0.01, 0] },
      { kind: 'box', size: [0.05, 0.15, 0.03], at: [0, 0.095, -0.075] },
      { kind: 'box', size: [0.05, 0.058, 0.052], at: [0.125, 0.065, -0.084] },
      { kind: 'cylinder', size: [0.25, 0.1, 0.25], axis: 'z', at: [0, 0.162, -0.005], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.02, 0.2], at: [0, 0.01, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.05, 0.15, 0.03], at: [0, 0.095, -0.075], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.05, 0.058, 0.052], at: [0.125, 0.065, -0.084], color: C.tan, rough: 0.3 },
      { mesh: 'cylinder', size: [0.25, 0.006, 0.25], axis: 'z', at: [0, 0.162, -0.052], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.24, 0.006, 0.1], at: [0, 0.162, -0.005], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
      { mesh: 'box', size: [0.006, 0.24, 0.1], at: [0, 0.162, -0.005], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
      { mesh: 'box', size: [0.1, 0.006, 0.006], at: [0, 0.014, 0.1], color: C.volt, emissive: 0.8, when: 'pressed' },
    ],
    ports: [{ name: 'out', channel: 'spin', dir: 'out', at: [0.151, 0.065, -0.084], kind: 'axle' }],
    props: {}, art: 'hamster_drive', behaviours: ['rotator_source', 'critter_device'],
  },
  {
    // drive.md: Bandit's exercise bike. Spin source while he pedals (8 s per lure or fright; flywheel 3 rev/s, 25 N·m).
    type: 'pedal_rig', family: 'drive', name: 'PEDAL RIG', tag: 'Raccoon pedal drive', ship: 'M2', bounds: bottom([0.4, 0.4, 0.2]),
    body: { kind: 'static', mass: 5.0, friction: 0.5, restitution: 0.25 },
    hinge: { at: [-0.13, 0.08, 0.055], axis: [0, 0, 1], armMass: 0.8, ghostArm: true },
    shapes: () => [
      { kind: 'box', size: [0.4, 0.02, 0.2], at: [0, 0.01, 0] },
      { kind: 'box', size: [0.05, 0.13, 0.04], at: [0.01, 0.085, 0] },
      { kind: 'box', size: [0.16, 0.03, 0.03], at: [-0.06, 0.08, 0] },
      { kind: 'box', size: [0.1, 0.03, 0.08], at: [0, 0.165, 0] },
      { kind: 'box', size: [0.03, 0.24, 0.03], at: [0.12, 0.27, 0] },
      { kind: 'capsule', size: [0.024, 0.16, 0.024], axis: 'z', at: [0.13, 0.39, 0] },
      { kind: 'cylinder', size: [0.12, 0.03, 0.12], axis: 'z', at: [-0.13, 0.08, 0.055], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.4, 0.02, 0.2], at: [0, 0.01, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.05, 0.13, 0.04], at: [0.01, 0.085, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.16, 0.03, 0.03], at: [-0.06, 0.08, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.1, 0.03, 0.08], at: [0, 0.165, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'box', size: [0.03, 0.24, 0.03], at: [0.12, 0.27, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.024, 0.16, 0.024], axis: 'z', at: [0.13, 0.39, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.09, 0.01, 0.09], axis: 'z', at: [0.03, 0.07, 0.03], color: C.ignition, rough: 0.35 },
      { mesh: 'cylinder', size: [0.008, 0.2, 0.008], axis: 'x', at: [0.12, 0.395, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.12, 0.03, 0.12], axis: 'z', at: [-0.13, 0.08, 0.055], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.11, 0.008, 0.032], at: [-0.13, 0.08, 0.055], color: C.bone, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.05, 0.012, 0.03], at: [0.13, 0.36, 0], color: C.volt, emissive: 0.8, when: 'pressed' },
    ],
    ports: [
      { name: 'out', channel: 'spin', dir: 'out', at: [-0.13, 0.08, 0.076], kind: 'axle' },
      { name: 'bait', channel: 'tension', dir: 'both', at: [0.195, 0.385, 0], kind: 'hook' },
    ],
    props: {}, art: 'pedal_rig', behaviours: ['rotator_source', 'critter_device'],
  },
  {
    // contraptions.md: Goby's bowl, 15 kg with water. Breaks on a 1.5 N·s hit or any blast (cosmetic splash until M4).
    type: 'fishbowl', family: 'contraptions', name: 'FISHBOWL', tag: 'Goby’s bowl', ship: 'M2', bounds: bottom([0.3, 0.3, 0.3]),
    body: { kind: 'dynamic', mass: 15.0, friction: 0.2, restitution: 0.1, material: 'glass' },
    shapes: () => [
      { kind: 'sphere', size: [0.3, 0.3, 0.3], at: [0, 0.15, 0] },
      { kind: 'cylinder', size: [0.18, 0.025, 0.18], at: [0, 0.0125, 0] },
    ],
    visuals: () => [
      { mesh: 'sphere', size: [0.3, 0.3, 0.3], at: [0, 0.15, 0], color: '#BDEBFA', rough: 0.05 },
      { mesh: 'cylinder', size: [0.2, 0.016, 0.2], at: [0, 0.032, 0], color: C.ignition, rough: 0.7 },
      { mesh: 'cylinder', size: [0.18, 0.025, 0.18], at: [0, 0.0125, 0], color: C.bone, rough: 0.5 },
    ],
    ports: [], props: {}, art: 'fishbowl', behaviours: ['breakable', 'critter_device'],
  },
  {
    // frame.md: drop cage. Falls when its LINE lets go and traps any critter under it (interior 0.66 × 0.46 × 0.46 m).
    type: 'trap_box', family: 'frame', name: 'TRAP BOX', tag: 'Drop cage', ship: 'M2', bounds: bottom([0.7, 0.5, 0.5]),
    body: { kind: 'dynamic', mass: 5.2, friction: 0.3, restitution: 0.1, material: 'steel' },
    shapes: () => [
      { kind: 'box', size: [0.7, 0.48, 0.014], at: [0, 0.24, 0.24] },
      { kind: 'box', size: [0.7, 0.48, 0.014], at: [0, 0.24, -0.24] },
      { kind: 'box', size: [0.014, 0.48, 0.5], at: [-0.34, 0.24, 0] },
      { kind: 'box', size: [0.014, 0.48, 0.5], at: [0.34, 0.24, 0] },
      { kind: 'box', size: [0.7, 0.02, 0.5], at: [0, 0.47, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.66, 0.012, 0.46], at: [0, 0.474, 0], color: C.bone, rough: 0.5 },
      ...[-0.24, 0.24].flatMap((z) => [
        { mesh: 'box' as const, size: [0.7, 0.02, 0.02] as V3, at: [0, 0.47, z] as V3, color: C.cobalt, rough: 0.4 },
        { mesh: 'box' as const, size: [0.7, 0.025, 0.02] as V3, at: [0, 0.0125, z] as V3, color: C.cobalt, rough: 0.4 },
        ...[-0.26, -0.13, 0, 0.13, 0.26].map((x) => ({ mesh: 'cylinder' as const, size: [0.01, 0.44, 0.01] as V3, at: [x, 0.245, z] as V3, color: C.steel, metal: 1, rough: 0.2 })),
      ]),
      ...[-0.34, 0.34].flatMap((x) => [
        { mesh: 'box' as const, size: [0.02, 0.02, 0.5] as V3, at: [x, 0.47, 0] as V3, color: C.cobalt, rough: 0.4 },
        { mesh: 'box' as const, size: [0.02, 0.025, 0.5] as V3, at: [x, 0.0125, 0] as V3, color: C.cobalt, rough: 0.4 },
        ...[-0.24, 0.24].map((z) => ({ mesh: 'cylinder' as const, size: [0.02, 0.48, 0.02] as V3, at: [x, 0.24, z] as V3, color: C.cobalt, rough: 0.4 })),
        ...[-0.12, 0, 0.12].map((z) => ({ mesh: 'cylinder' as const, size: [0.01, 0.44, 0.01] as V3, at: [x, 0.245, z] as V3, color: C.steel, metal: 1, rough: 0.2 })),
      ]),
      { mesh: 'box', size: [0.008, 0.06, 0.04], at: [0.25, 0.51, 0], color: C.bone, rough: 0.5, when: 'pressed' },
    ],
    ports: [{ name: 'hook', channel: 'tension', dir: 'both', at: [0, 0.492, 0], kind: 'hook' }],
    props: {}, art: 'trap_box', behaviours: ['rigid_basic', 'critter_device'],
  },
  ...CRITTER_PARTS,
];

// Links (LINE, BAND, FUSE, cables) are connectors, not parts: their kinds live in @knockon/format.

const byType = new Map(PARTS.map((d) => [d.type, d]));
bindPartLookup((t) => byType.get(t)); // M3: FABRICATOR's hologram shows its part's visuals

export function partDef(type: string): PartDef | undefined {
  return byType.get(type);
}

export function boundsOf(def: PartDef, props: Props): { readonly min: V3; readonly max: V3 } {
  return def.boundsFor ? def.boundsFor(props) : def.bounds;
}

/** Property values from a part's stored step list (PART_SYSTEM §2), falling back to defaults. */
export function propValues(def: PartDef, stored?: readonly (readonly [number, number])[]): Props {
  const keys = Object.keys(def.props);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = def.props[k]!.default;
  for (const [i, steps] of stored ?? []) {
    const k = keys[i];
    if (!k) continue;
    const spec = def.props[k]!;
    const step = spec.step ?? 1;
    const v = spec.type === 'enum' || spec.type === 'bool' || spec.type === 'int' ? steps : steps * step;
    out[k] = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v));
  }
  return out;
}

/** Inverse of propValues for one property: the integer step count stored in the doc. */
export function propSteps(def: PartDef, key: string, value: number): [number, number] {
  const keys = Object.keys(def.props);
  const spec = def.props[key]!;
  const step = spec.step ?? 1;
  const steps = spec.type === 'enum' || spec.type === 'bool' || spec.type === 'int' ? Math.round(value) : Math.round(value / step);
  return [keys.indexOf(key), steps];
}

export const LINK_FOR_CHANNEL: Readonly<Record<Channel, string | null>> = {
  signal: 'cable_signal', power: 'cable_power', heat: 'fuse', tension: 'line', spin: 'band', impact: null, air: null,
};
