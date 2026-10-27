// M3 part definitions (stream A3 · sim parts): the 30 M3 rows of GAME_SPEC §12, built to their briefs
// (docs/art/briefs/*) in engine space: Y-up, metres, front = +Z (Blender (x, y, z) → engine (x, z, −y)).
// Spread into PARTS by defs.ts, which this file only type-imports (like defs_m2.ts). Collision is the
// blockout until each part's `.shapes.json` lands. Behaviours live in packages/sim/src/channels/.
//
// Also here: the M3 Library cards (CARDS_M3) and the M3 demo machines (m3Demos, merged into DEMOS by demos.ts).
// PANE and VASE break through the generated-fracture path (index.ts FRAC: E3a's frac_pane.ts / frac_vase.ts).

import { dcos, dsin } from '@knockon/detmath';
import type { LinkKind } from '../../format/src/model.ts';
import { snappedEuler, type Rotation } from '../../format/src/quantize.ts';
import type { Card } from './cards.ts';
import type { PartDef, PortDef, Props, ShapeDef, V3, VisualDef } from './defs.ts';
import { qAxis, qBasis } from './defs_m2.ts';

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const centred = (s: V3): PartDef['bounds'] => b([-s[0] / 2, -s[1] / 2, -s[2] / 2], [s[0] / 2, s[1] / 2, s[2] / 2]);
const bottom = (s: V3): PartDef['bounds'] => b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]);
const RAD = Math.PI / 180;

// Palette (ART_BIBLE §3.1), as in defs.ts / defs_m2.ts.
const C = {
  ignition: '#FF5B2E', graphite: '#3A3E47', bone: '#E8E2D6', red: '#D93A2B', steel: '#A9AFB8', volt: '#C6F432',
  beam: '#2FD6FF', amber: '#FFB020', cobalt: '#2E5BFF', rubber: '#25272D', flame: '#FFC870', copper: '#B8742E',
  glass: '#CFE8F2', walnut: '#6B4A2E', brass: '#C9A23A', oak: '#C8945A', plasma: '#FF3DAE', chrome: '#D8DDE3',
  paper: '#E9DFC7', tan: '#D9C29A',
};

/** Late-bound part lookup (defs.ts binds it), for parts whose visuals show another part (FABRICATOR's hologram). */
let lookup: (type: string) => PartDef | undefined = () => undefined;
export function bindPartLookup(f: (type: string) => PartDef | undefined): void { lookup = f; }

// ---- shared geometry (the sim channels read these) ----------------------------------------------------------

/** LANCE (power_signal.md): the beam leaves the aperture along +X. */
export const LANCE = { aperture: [0.1, 0.047, 0] as V3 } as const;
/** TRIPWIRE: the eye faces −X; `face` is the local x a ray must hit at or beyond to reach the eye. */
export const TRIPWIRE = { eye: [-0.0545, 0.05, 0] as V3, face: -0.04, threshold: 0.1, debounce: 2 } as const;
/** MIRROR plate (front face +Z) and SPLITTER cube (fan ±12° about the part's up axis). */
export const OPTICS = { plateY: 0.012, cubeY: 0.031, fanDeg: 12 } as const;
/** MAGLOCK: pole face (front, +Z) centre, field reach and radius, force constant, hold threshold. */
export const MAGLOCK = { face: [0, 0.1, 0.09] as V3, reach: 0.6, radius: 0.12, k: 0.245, hold: 0.75 } as const;
/** POWDER KEG: the fuse stub tip (heat lights it), the cook-off time and the keg's heat radius. */
export const KEG = { stub: [0.065, 0.165, 0.02] as V3, cook: 1.5, R: 0.095, H: 0.15, pad: 0.05 } as const;
/** JITTERJUICE: detonates on a contact ≥ 0.15 N·s, jostles from 0.08 N·s. */
export const JITTER = { boom: 0.15, jostle: 0.08 } as const;
/** FLAMER: nozzle (+X) and heat cone (0.6 m long, end radius 0.06 m). */
export const FLAMER = { nozzle: [0.15, 0.05, 0] as V3, length: 0.6, endR: 0.06, igniteS: 0.15 } as const;
/** POPPER: mouth (+Y), puff cone 1.0 m / 15°, 0.15 s, pull ≥ 4 N. */
export const POPPER = { mouth: [0, 0.145, 0] as V3, R: 1.0, halfDeg: 15, seconds: 0.15, pull: 4 } as const;
/** BUMPER: kick ring and speeds. */
export const BUMPER = { ringR: 0.13, e: 1.2, minKick: 1.5, maxKick: 8, signalKick: 2.5 } as const;
/** RAM: fixed length (ports are static in the def schema), stroke = D/2. */
export const RAM = { D: 0.5, stroke: 0.25, head: 0.025 } as const;
/** FLINGER: arm axle, cup radius on the arm, cocked angle from vertical (toward −X). */
export const FLINGER = { axle: [0.04, 0.12, 0] as V3, cupR: 0.2, cocked: 105 } as const;
/** SNAPTRAP: bar hinge, snap limit, pedal box (local x range, top y). */
export const SNAPTRAP = { hinge: [0, 0.022, 0] as V3, limit: 172, pedalX: [0.02, 0.06] as const, pedalY: 0.014, kg: 0.03, J: 0.03 } as const;
/** GLIDEPATH booster: sensor box over the rails (half extents), tyre radius and internal gearing. */
export const BOOSTER = { half: [0.15, 0.015, 0.015] as V3, sensorY: 0.015, tyreR: 0.015, gear: 10 } as const;
/** GLIDEPATH section (frame.md): ⌀8 mm rails at 14 mm centres on a T-spine; riders' centres sit `ride` over the rail tops (where a ⌀16 mm marble rests). */
export const GLIDEPATH = { rail: 0.004, gauge: 0.007, spineH: 0.03, spineW: 0.006, bend: 0.1, ride: 0.006, capture: 0.025 } as const;
/** RECYCLER intake: centre-of-mass box (part space). */
export const RECYCLER = { intakeMin: [-0.11, 0.13, -0.11] as V3, intakeMax: [0.11, 0.26, 0.11] as V3 } as const;
/** FABRICATOR: spawn point (mouth) and direction (+Z); big parts appear in front of the face. */
export const FABRICATOR = { mouth: [0, 0.07, 0.11] as V3, warp: [0, 0.15, 0.15] as V3, maxMouth: 0.1, max: 20 } as const;
/** Parts a FABRICATOR can make: plain single-body dynamic parts (the prop's enum, in order). */
export const SPAWNABLE = ['boing', 'stitch', 'fuzz', 'thud', 'pig_iron', 'glint', 'bearing', 'pin', 'stacker', 'topple_tile', 'wrecker'] as const;
/** TONEBARS: bar lengths per scale degree (fun.md two-octave set; each step × 2^(−1/14)). */
export const TONEBAR_L = [0.3, 0.286, 0.272, 0.259, 0.246, 0.234, 0.223, 0.212, 0.202, 0.192, 0.183, 0.174, 0.166, 0.158, 0.15] as const;
const TONE_COLOR = [C.ignition, C.copper, C.brass, C.volt, C.beam, C.cobalt, C.plasma];
/** ZONE modes (the `mode` prop). */
export const ZONE_MODES = ['Gravity', 'Antigrav', 'Wind', 'Stasis'] as const;
export const SKYSHOW_PATTERNS = ['Peony', 'Chrysanthemum', 'Willow', 'Ring', 'Palm', 'Crossette', 'Heart', 'Starburst', 'Glitter'] as const;

/** SKYSHOW tubes (boom.md): base on the tray top, splayed ±10° front/back and ±8° on the outer columns. */
export const SKYSHOW = (() => {
  const t8 = dsin(8 * RAD) / dcos(8 * RAD), t10 = dsin(10 * RAD) / dcos(10 * RAD);
  const bases: readonly (readonly [number, number])[] = [[-0.085, -0.065], [0, -0.065], [0.085, -0.065], [0.085, 0.065], [0, 0.065], [-0.085, 0.065]];
  const tubes = bases.map(([x, y]) => {
    const ax = Math.sign(x) * t8, ay = Math.sign(y) * t10;
    const n = Math.sqrt(ax * ax + ay * ay + 1);
    const axis: V3 = [ax / n, 1 / n, -ay / n]; // engine (x, z, −y)
    const base: V3 = [x, 0.04, -y];
    const len = 0.155 / axis[1];
    const top: V3 = [base[0] + axis[0] * len, base[1] + axis[1] * len, base[2] + axis[2] * len];
    return { base, top, axis };
  });
  return { tubes, stub: [0.03, 0.03, 0.165] as V3, hop: 0.6, shellY: 0.2 } as const;
})();

// ---- per-prop geometry ------------------------------------------------------------------------------------------

const liftTravel = (p: Props): number => p.travel ?? 1;
const rackLen = (p: Props): number => p.length ?? 1;
const zoneSize = (p: Props): V3 => [p.width ?? 1, p.height ?? 1, p.depth ?? 1];
const tonebarLen = (p: Props): number => TONEBAR_L[Math.max(0, Math.min(14, Math.round(p.degree ?? 0)))]!;

/** FLINGER arm + cup colliders/visuals in the cocked pose (arm 15° below horizontal, toward −X). */
function flingerArm(): { shapes: ShapeDef[]; visuals: VisualDef[] } {
  const th = -FLINGER.cocked * RAD;
  const d: V3 = [dsin(th), dcos(th), 0]; // arm direction (from vertical, negative toward −X)
  const nn: V3 = [d[1], -d[0], 0]; // the cup's opening: the arm's direction of travel when it fires
  const q = qBasis(d, nn, [0, 0, -1]);
  const A = FLINGER.axle;
  const at = (s: number, u: number): V3 => [A[0] + d[0] * s + nn[0] * u, A[1] + d[1] * s + nn[1] * u, 0];
  const cup = (along: number, up: number, z: number): V3 => { const p = at(FLINGER.cupR + along, up); return [p[0], p[1], z]; };
  const shapes: ShapeDef[] = [
    { kind: 'box', size: [0.17, 0.03, 0.04], at: at(0.075, -0.0145), rot: q, on: 'arm' },
    { kind: 'box', size: [0.09, 0.006, 0.09], at: cup(0, -0.0145, 0), rot: q, on: 'arm' },
    // rims 0.05 tall (the brief's cup is 0.035 deep): a shallower rim lets a STITCH roll out mid-swing
    { kind: 'box', size: [0.006, 0.05, 0.09], at: cup(-0.045, 0.0135, 0), rot: q, on: 'arm' },
    { kind: 'box', size: [0.006, 0.05, 0.09], at: cup(0.045, 0.0135, 0), rot: q, on: 'arm' },
    { kind: 'box', size: [0.09, 0.05, 0.006], at: cup(0, 0.0135, -0.045), rot: q, on: 'arm' },
    { kind: 'box', size: [0.09, 0.05, 0.006], at: cup(0, 0.0135, 0.045), rot: q, on: 'arm' },
  ];
  const tilt = 90 + FLINGER.cocked; // blockout visuals tilt about Z only: +X onto the arm, +Y onto the cup's opening
  const visuals: VisualDef[] = [
    { mesh: 'box', size: [0.17, 0.03, 0.04], at: at(0.075, -0.0145), tiltZ: tilt, color: C.oak, rough: 0.6, on: 'arm' },
    { mesh: 'cylinder', size: [0.09, 0.035, 0.09], at: cup(0, 0, 0), tiltZ: tilt, color: C.ignition, rough: 0.4, on: 'arm' },
  ];
  return { shapes, visuals };
}
const FLING = flingerArm();

/** PADDLE bat at rest (−15° about +Y from +X). */
function paddleBat(): { shapes: ShapeDef[]; visuals: VisualDef[] } {
  const q = qAxis([0, 1, 0], -15);
  const dir: V3 = [dcos(15 * RAD), 0, dsin(15 * RAD)];
  const L = 0.2475;
  const mid: V3 = [dir[0] * L / 2, 0.001, dir[2] * L / 2], tip: V3 = [dir[0] * L, 0.001, dir[2] * L];
  return {
    shapes: [
      { kind: 'cylinder', size: [0.06, 0.028, 0.06], at: [0, 0.001, 0], on: 'arm' },
      { kind: 'box', size: [L, 0.028, 0.04], at: mid, rot: q, on: 'arm' },
      { kind: 'cylinder', size: [0.025, 0.028, 0.025], at: tip, on: 'arm' },
    ],
    visuals: [
      { mesh: 'cylinder', size: [0.06, 0.03, 0.06], at: [0, 0, 0], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [L, 0.03, 0.04], at: mid, tiltZ: 0, color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'cylinder', size: [0.025, 0.03, 0.025], at: tip, color: C.rubber, rough: 0.8, on: 'arm' },
      { mesh: 'cylinder', size: [0.03, 0.01, 0.03], at: [0, 0.02, 0], color: C.chrome, metal: 1, rough: 0.2, on: 'arm' },
    ],
  };
}
const BAT = paddleBat();

const fabricatorPiece = (p: Props): VisualDef[] => {
  const t = SPAWNABLE[Math.max(0, Math.min(SPAWNABLE.length - 1, Math.round(p.part ?? 0)))]!;
  const d = lookup(t);
  return d ? d.visuals({}).filter((v) => (v.on ?? 'base') === 'base').map((v): VisualDef => ({ ...v, on: 'piece' })) : [];
};

const sig = (name: string, at: V3, dir: PortDef['dir'] = 'in', maxLinks?: number): PortDef => ({ name, channel: 'signal', dir, at, ...(maxLinks ? { maxLinks } : {}) });
const pow = (name: string, at: V3): PortDef => ({ name, channel: 'power', dir: 'in', at });

export const PARTS_M3: readonly PartDef[] = [
  // ---- Rollers --------------------------------------------------------------------------------------
  {
    // Glass marble (rollers.md `marble`, variant glint): rattles down runs, rides GLIDEPATH; Bandit's favourite bait.
    type: 'glint', family: 'rollers', name: 'GLINT', tag: 'Glass marble', ship: 'M3', bounds: centred([0.016, 0.016, 0.016]),
    // friction: the brief's 0.30 holds a ⌀16 mm Jolt sphere still on a slope (it gets no rolling torque), so marbles glide
    body: { kind: 'dynamic', mass: 0.0054, friction: 0.02, restitution: 0.6, ccd: true, material: 'glass' },
    lure: { species: { bandit: 1.5 }, radius: 5 },
    shapes: () => [{ kind: 'sphere', size: [0.016, 0.016, 0.016] }],
    visuals: () => [{ mesh: 'sphere', size: [0.016, 0.016, 0.016], color: C.beam, rough: 0.1 }],
    ports: [], props: {}, art: 'marble', behaviours: ['rigid_basic'],
  },
  {
    // Steel ball bearing (variant bearing): magnetic, so MAGLOCK grabs it; shiny bait for Bandit too.
    type: 'bearing', family: 'rollers', name: 'BEARING', tag: 'Steel marble', ship: 'M3', bounds: centred([0.016, 0.016, 0.016]),
    body: { kind: 'dynamic', mass: 0.0167, friction: 0.02, restitution: 0.65, ccd: true, material: 'steel', magnetic: true },
    lure: { species: { bandit: 1.2 }, radius: 5 },
    shapes: () => [{ kind: 'sphere', size: [0.016, 0.016, 0.016] }],
    visuals: () => [{ mesh: 'sphere', size: [0.016, 0.016, 0.016], color: C.chrome, rough: 0.12, metal: 1 }],
    ports: [], props: {}, art: 'marble', behaviours: ['rigid_basic'],
  },
  // ---- Frame ----------------------------------------------------------------------------------------
  {
    // GLIDEPATH booster segment (frame.md): spun on its drive port, it kicks marbles over its 0.30 m along ±X at
    // tyre speed (input ω × 10 gearing × 0.015 m). Origin on the rail-top centreline, mid-length.
    type: 'glidepath_booster', family: 'frame', name: 'BOOSTER', tag: 'Glidepath booster', ship: 'M3', bounds: b([-0.15, -0.09, -0.025], [0.15, 0.03, 0.025]),
    body: { kind: 'static', mass: 0.6, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: [0, -0.055, 0], axis: [0, 0, 1], armMass: 0.1, ghostArm: true },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.075, 0.05], at: [0, -0.0475, 0] },
      { kind: 'cylinder', size: [0.03, 0.02, 0.03], axis: 'z', at: [0, -0.055, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.075, 0.05], at: [0, -0.0475, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.2, 0.004, 0.03], at: [0, -0.008, 0], color: C.glass, rough: 0.1 },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [-0.05, -0.004, 0.02], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [-0.05, -0.004, -0.02], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [0.05, -0.004, 0.02], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [0.05, -0.004, -0.02], color: C.rubber, rough: 0.8 },
      { mesh: 'box', size: [0.006, 0.02, 0.012], axis: 'z', at: [0, -0.055, 0.026], color: C.cobalt, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.2, 0.004, 0.02], at: [0, 0.002, 0], color: C.volt, emissive: 0.6, when: 'powered' },
    ],
    ports: [{ name: 'drive', channel: 'spin', dir: 'in', at: [0, -0.055, 0.025], kind: 'axle' }],
    props: {}, art: 'glidepath_booster', behaviours: ['rotator_driven'],
  },
  {
    // Turntable: a 1.2 kg platter on a free vertical hinge; a BAND turns it 1:1 and its grippy mat carries
    // whatever sits on it. `Brake` locks it (high hinge friction).
    type: 'spindeck', family: 'frame', name: 'SPINDECK', tag: 'Turntable', ship: 'M3', bounds: b([-0.2, 0, -0.2], [0.2, 0.1, 0.2]),
    body: { kind: 'static', mass: 2.0, friction: 0.9, restitution: 0.3, material: 'rubber' },
    hinge: { at: [0, 0, 0], axis: [0, 1, 0], armMass: 1.2 },
    shapes: () => [
      { kind: 'cylinder', size: [0.36, 0.06, 0.36], at: [0, 0.035, 0] },
      { kind: 'cylinder', size: [0.4, 0.03, 0.4], at: [0, 0.085, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.36, 0.06, 0.36], at: [0, 0.035, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.4, 0.02, 0.4], at: [0, 0.08, 0], color: C.cobalt, rough: 0.35, on: 'arm' },
      { mesh: 'cylinder', size: [0.36, 0.008, 0.36], at: [0, 0.094, 0], color: C.rubber, rough: 0.9, on: 'arm' },
      { mesh: 'box', size: [0.03, 0.01, 0.02], at: [0.18, 0.095, 0], color: C.bone, rough: 0.5, on: 'arm' },
      { mesh: 'cylinder', size: [0.05, 0.008, 0.05], at: [0, 0.1, 0], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
    ],
    ports: [{ name: 'in', channel: 'spin', dir: 'in', at: [0.035, 0.035, 0.166], kind: 'axle' }],
    props: { brake: { type: 'bool', default: 0, label: 'Brake' } },
    art: 'spindeck', behaviours: ['rotator_driven'],
  },
  {
    // Elevator: a Signal on `call` sends the deck (kinematic) to the other end at `speed` × supply; it draws
    // 150 W while moving, pulses `arrive` at each end and stalls (fault) over 15 kg.
    type: 'lift', family: 'frame', name: 'LIFT', tag: 'Elevator platform', ship: 'M3', bounds: b([-0.15, 0, -0.3], [0.15, 1.12, 0.15]),
    boundsFor: (p) => b([-0.15, 0, -0.3], [0.15, liftTravel(p) + 0.12, 0.15]),
    body: { kind: 'static', mass: 3.0, friction: 0.9, restitution: 0.2, material: 'powder' },
    // the deck (with its lips) is the arm: a kinematic body the behaviour moves up and down the mast
    shapes: (p) => {
      const h = liftTravel(p) + 0.12;
      return [
        { kind: 'box', size: [0.3, 0.15, 0.1], at: [0, 0.08, -0.25] },
        { kind: 'box', size: [0.16, h, 0.02], at: [0, h / 2, -0.19] },
        { kind: 'box', size: [0.3, 0.05, 0.3], at: [0, 0.025, 0], on: 'arm' },
        { kind: 'box', size: [0.01, 0.03, 0.3], at: [-0.145, 0.065, 0], on: 'arm' },
        { kind: 'box', size: [0.01, 0.03, 0.3], at: [0.145, 0.065, 0], on: 'arm' },
        { kind: 'box', size: [0.28, 0.03, 0.01], at: [0, 0.065, -0.145], on: 'arm' },
      ];
    },
    visuals: (p) => {
      const h = liftTravel(p) + 0.12;
      return [
        { mesh: 'box', size: [0.3, 0.15, 0.1], at: [0, 0.08, -0.25], color: C.bone, rough: 0.5 },
        { mesh: 'box', size: [0.02, h, 0.02], at: [-0.07, h / 2, -0.19], color: C.cobalt, rough: 0.35 },
        { mesh: 'box', size: [0.02, h, 0.02], at: [0.07, h / 2, -0.19], color: C.cobalt, rough: 0.35 },
        { mesh: 'box', size: [0.03, h - 0.04, 0.006], at: [0, h / 2, -0.185], color: C.rubber, rough: 0.8 },
        { mesh: 'box', size: [0.16, 0.04, 0.04], at: [0, h - 0.02, -0.19], color: C.bone, rough: 0.5 },
        { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [-0.11, 0.155, -0.25], color: C.volt, emissive: 0.9, when: 'powered' },
        { mesh: 'box', size: [0.3, 0.05, 0.3], at: [0, 0.025, 0], color: C.bone, rough: 0.5, on: 'arm' },
        { mesh: 'box', size: [0.26, 0.004, 0.26], at: [0, 0.052, 0], color: C.rubber, rough: 0.9, on: 'arm' },
        { mesh: 'box', size: [0.01, 0.03, 0.3], at: [-0.145, 0.065, 0], color: C.cobalt, rough: 0.35, on: 'arm' },
        { mesh: 'box', size: [0.01, 0.03, 0.3], at: [0.145, 0.065, 0], color: C.cobalt, rough: 0.35, on: 'arm' },
        { mesh: 'box', size: [0.28, 0.03, 0.01], at: [0, 0.065, -0.145], color: C.cobalt, rough: 0.35, on: 'arm' },
      ];
    },
    ports: [pow('in', [-0.11, 0.08, -0.2]), sig('call', [0.11, 0.08, -0.2]), sig('arrive', [0.11, 0.155, -0.25], 'out', 8)],
    props: {
      travel: { type: 'metres', min: 0.1, max: 4, step: 0.1, default: 1, label: 'Travel' },
      speed: { type: 'float', min: 0.05, max: 1, step: 0.05, default: 0.25, label: 'Speed (m/s)' },
    },
    art: 'lift', behaviours: ['slider_actuator', 'power_consumer'], power: { consumer: 150 },
  },
  // ---- Drive ----------------------------------------------------------------------------------------
  {
    // Rack and pinion: the pinion (a ghost rotor on `pinion`) drives the toothed bar along X through a
    // rack-and-pinion coupling (40 rad per metre: pitch Ø 0.05), between its end stops.
    type: 'rack', family: 'drive', name: 'RACK', tag: 'Rack and pinion', ship: 'M3', bounds: b([-0.5, 0, -0.05], [0.5, 0.11, 0.05]),
    boundsFor: (p) => b([-rackLen(p) / 2, 0, -0.05], [rackLen(p) / 2, 0.11, 0.05]),
    body: { kind: 'static', mass: 0.7, friction: 0.5, restitution: 0.3, material: 'powder' },
    hinge: { at: [0, 0.075, 0], axis: [0, 0, 1], armMass: 0.15, ghostArm: true },
    shapes: (p) => {
      const L = rackLen(p);
      return [
        { kind: 'box', size: [0.1, 0.05, 0.1], at: [0, 0.085, 0] },
        { kind: 'cylinder', size: [0.05, 0.02, 0.05], axis: 'z', at: [0, 0.075, 0], on: 'arm' },
        { kind: 'box', size: [L - 0.03, 0.028, 0.03], at: [0, 0.03, 0], on: 'piece' },
        { kind: 'box', size: [L - 0.03, 0.011, 0.03], at: [0, 0.0495, 0], on: 'piece' },
        { kind: 'box', size: [0.015, 0.04, 0.04], at: [-L / 2 + 0.0075, 0.03, 0], on: 'piece' },
        { kind: 'box', size: [0.015, 0.04, 0.04], at: [L / 2 - 0.0075, 0.03, 0], on: 'piece' },
      ];
    },
    visuals: (p) => {
      const L = rackLen(p);
      return [
        { mesh: 'box', size: [0.1, 0.05, 0.1], at: [0, 0.085, 0], color: C.graphite, rough: 0.4 },
        { mesh: 'box', size: [0.1, 0.012, 0.1], at: [0, 0.006, 0], color: C.graphite, rough: 0.4 },
        { mesh: 'box', size: [0.06, 0.004, 0.05], at: [0, 0.111, 0], color: C.glass, rough: 0.1 },
        { mesh: 'cylinder', size: [0.05, 0.02, 0.05], axis: 'z', at: [0, 0.075, 0], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
        { mesh: 'box', size: [0.006, 0.05, 0.022], at: [0, 0.075, 0], color: C.graphite, rough: 0.4, on: 'arm' },
        { mesh: 'box', size: [L - 0.03, 0.028, 0.03], at: [0, 0.03, 0], color: C.ignition, rough: 0.4, on: 'piece' },
        { mesh: 'box', size: [L - 0.03, 0.011, 0.024], at: [0, 0.0495, 0], color: C.ignition, rough: 0.5, on: 'piece' },
        { mesh: 'box', size: [0.015, 0.04, 0.04], at: [-L / 2 + 0.0075, 0.03, 0], color: C.rubber, rough: 0.8, on: 'piece' },
        { mesh: 'box', size: [0.015, 0.04, 0.04], at: [L / 2 - 0.0075, 0.03, 0], color: C.rubber, rough: 0.8, on: 'piece' },
      ];
    },
    ports: [{ name: 'pinion', channel: 'spin', dir: 'both', at: [0, 0.075, 0.051], kind: 'axle' }],
    props: { length: { type: 'metres', min: 0.2, max: 2, step: 0.1, default: 1, label: 'Length' } },
    art: 'rack', behaviours: ['rack_pinion'],
  },
  {
    // Piston (fixed 0.5 m long in M3: ports are static in the def schema): a Signal on `fire` drives the
    // head out 0.25 m in 0.08 s (needs power: 100 W, force × supply), holds 0.3 s, retracts in 0.4 s.
    type: 'ram', family: 'drive', name: 'RAM', tag: 'Piston', ship: 'M3', bounds: b([-0.05, 0, -0.25], [0.05, 0.1, 0.25]),
    body: { kind: 'static', mass: 1.1, friction: 0.9, restitution: 0.3, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.1, 0.1, 0.474], at: [0, 0.05, -0.013] },
      { kind: 'cylinder', size: [0.08, 0.025, 0.08], axis: 'z', at: [0, 0.05, 0.2375], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.1, 0.42], at: [0, 0.05, 0.005], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.1, 0.1, 0.05], at: [0, 0.05, -0.225], color: C.ignition, rough: 0.4 },
      { mesh: 'box', size: [0.102, 0.03, 0.3], at: [0, 0.05, 0], color: C.glass, rough: 0.1 },
      { mesh: 'cylinder', size: [0.08, 0.025, 0.08], axis: 'z', at: [0, 0.05, 0.2375], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'cylinder', size: [0.024, 0.25, 0.024], axis: 'z', at: [0, 0.05, 0.1], color: C.chrome, metal: 1, rough: 0.15, on: 'arm' },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0.02, 0.1, 0.2], color: C.volt, emissive: 0.9, when: 'powered' },
    ],
    ports: [pow('in', [0, 0.1, -0.22]), sig('fire', [0, 0.1, -0.175])],
    props: {}, art: 'ram', behaviours: ['slider_actuator', 'power_consumer'], power: { consumer: 100 },
  },
  // ---- Power and signal: optics -----------------------------------------------------------------------
  {
    // Benchtop laser: one hard ray along +X from the aperture while powered (30 W). Through a BURNING GLASS
    // it becomes a cutting beam: its converged ray heats (and so burns through) whatever it crosses.
    type: 'lance', family: 'power', name: 'LANCE', tag: 'Laser', ship: 'M3', bounds: bottom([0.2, 0.1, 0.08]),
    body: { kind: 'static', mass: 0.9, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.16, 0.07, 0.08], at: [-0.02, 0.047, 0] },
      { kind: 'cylinder', size: [0.04, 0.04, 0.04], axis: 'x', at: [0.08, 0.047, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.16, 0.07, 0.07], at: [-0.02, 0.047, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.09, 0.004, 0.05], at: [-0.02, 0.083, 0], color: C.glass, rough: 0.1 },
      { mesh: 'cylinder', size: [0.016, 0.08, 0.016], axis: 'x', at: [-0.02, 0.07, 0], color: C.beam, emissive: 0.8, when: 'powered' },
      { mesh: 'cylinder', size: [0.04, 0.04, 0.04], axis: 'x', at: [0.08, 0.047, 0], color: C.beam, rough: 0.3, metal: 0.6 },
      { mesh: 'cylinder', size: [0.008, 0.004, 0.008], axis: 'x', at: [0.1, 0.047, 0], color: C.beam, emissive: 1, when: 'powered' },
    ],
    ports: [pow('in', [-0.07, 0.047, 0.041])],
    props: {}, art: 'lance', behaviours: ['light_emitter', 'power_consumer'], power: { consumer: 30 },
  },
  {
    // Mirror: a beam hitting its chrome face (front, +Z) reflects about the face normal; the back is opaque.
    type: 'mirror', family: 'power', name: 'MIRROR', tag: 'Mirror', ship: 'M3', bounds: bottom([0.1, 0.2, 0.036]),
    body: { kind: 'static', mass: 0.3, friction: 0.3, restitution: 0.2, material: 'glass' },
    shapes: () => [
      { kind: 'box', size: [0.1, 0.185, 0.02], at: [0, 0.1045, 0] },
      { kind: 'box', size: [0.1, 0.012, 0.036], at: [0, 0.006, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.185, 0.02], at: [0, 0.1045, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.084, 0.17, 0.002], at: [0, 0.1045, 0.0105], color: C.chrome, rough: 0.02, metal: 1 },
      { mesh: 'box', size: [0.1, 0.012, 0.036], at: [0, 0.006, 0], color: C.graphite, rough: 0.45 },
    ],
    ports: [], props: {}, art: 'mirror', behaviours: ['light_optic'],
  },
  {
    // Prism: a beam entering the cube leaves as three rays (straight on and ±12° about the part's up axis),
    // each at 1/3 intensity.
    type: 'splitter', family: 'power', name: 'SPLITTER', tag: 'Prism', ship: 'M3', bounds: bottom([0.1, 0.1, 0.1]),
    body: { kind: 'static', mass: 0.5, friction: 0.3, restitution: 0.2, material: 'glass' },
    shapes: () => [
      { kind: 'box', size: [0.1, 0.025, 0.1], at: [0, 0.0125, 0] },
      { kind: 'box', size: [0.068, 0.068, 0.068], at: [0, 0.065, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.025, 0.1], at: [0, 0.0125, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.068, 0.068, 0.068], at: [0, 0.065, 0], color: C.glass, rough: 0.05 },
      { mesh: 'box', size: [0.004, 0.07, 0.004], at: [0.036, 0.065, 0.036], color: C.beam, rough: 0.3 },
      { mesh: 'box', size: [0.004, 0.07, 0.004], at: [-0.036, 0.065, 0.036], color: C.beam, rough: 0.3 },
      { mesh: 'box', size: [0.004, 0.07, 0.004], at: [0.036, 0.065, -0.036], color: C.beam, rough: 0.3 },
      { mesh: 'box', size: [0.004, 0.07, 0.004], at: [-0.036, 0.065, -0.036], color: C.beam, rough: 0.3 },
    ],
    ports: [], props: {}, art: 'splitter', behaviours: ['light_optic'],
  },
  {
    // Beam sensor: light on its −X eye (≥ 0.1, 2-tick debounce) arms it; Break mode pulses when the beam is
    // broken, Lit mode when light arrives.
    type: 'tripwire', family: 'power', name: 'TRIPWIRE', tag: 'Beam sensor', ship: 'M3', bounds: b([-0.0545, 0, -0.045], [0.0425, 0.1, 0.045]),
    body: { kind: 'static', mass: 0.3, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.085, 0.09, 0.085], at: [0, 0.045, 0] },
      { kind: 'cylinder', size: [0.044, 0.012, 0.044], axis: 'x', at: [-0.0485, 0.05, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.085, 0.09, 0.085], at: [0, 0.045, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.044, 0.012, 0.044], axis: 'x', at: [-0.0485, 0.05, 0], color: C.beam, rough: 0.35, metal: 0.6 },
      { mesh: 'cylinder', size: [0.03, 0.004, 0.03], axis: 'x', at: [-0.0545, 0.05, 0], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.034, 0.003, 0.034], axis: 'x', at: [-0.0555, 0.05, 0], color: C.beam, emissive: 1, when: 'lit' },
      { mesh: 'box', size: [0.012, 0.008, 0.02], at: [0, 0.094, 0], color: C.volt, rough: 0.35 },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0.02, 0.091, 0.03], color: C.amber, emissive: 1, when: 'pressed' },
    ],
    ports: [sig('out', [0.015, 0.045, 0.046], 'out', 8)],
    props: { mode: { type: 'enum', values: ['Break', 'Lit'], default: 0, label: 'Trigger' } },
    art: 'tripwire', behaviours: ['light_receiver', 'sensor_pulse'],
  },
  // ---- Power and signal: wireless and field -------------------------------------------------------------
  {
    // Wireless pair: a Tx's input reaches every Rx of the same colour in the same tick, as a wire would.
    type: 'ping', family: 'power', name: 'PING', tag: 'Wireless pair', ship: 'M3', bounds: b([-0.05, 0, -0.045], [0.05, 0.098, 0.045]),
    body: { kind: 'static', mass: 0.25, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.09, 0.05, 0.09], at: [0, 0.025, 0] },
      { kind: 'capsule', size: [0.006, 0.045, 0.006], at: [0, 0.0725, 0] },
    ],
    visuals: (p) => {
      const tip = [C.ignition, C.volt, C.beam, C.cobalt, C.plasma, C.graphite][Math.max(0, Math.min(5, p.pair ?? 0))]!;
      return [
        { mesh: 'box', size: [0.09, 0.05, 0.09], at: [0, 0.025, 0], color: C.graphite, rough: 0.4 },
        { mesh: 'sphere', size: [0.06, 0.04, 0.06], at: [0, 0.05, 0], color: C.glass, rough: 0.05 },
        { mesh: 'cylinder', size: [0.003, 0.04, 0.003], at: [0, 0.07, 0], color: C.chrome, metal: 1, rough: 0.2 },
        { mesh: 'sphere', size: [0.016, 0.016, 0.016], at: [0, 0.09, 0], color: tip, rough: 0.3, metal: 0.6 },
        { mesh: 'sphere', size: [0.02, 0.02, 0.02], at: [0, 0.056, 0], color: C.amber, emissive: 1, when: 'pressed' },
      ];
    },
    ports: [sig('in', [-0.046, 0.025, 0]), sig('out', [0.046, 0.025, 0], 'out', 8)],
    props: {
      pair: { type: 'enum', values: ['Ignition', 'Volt', 'Beam', 'Cobalt', 'Plasma', 'Graphite'], default: 0, label: 'Pair colour' },
      mode: { type: 'enum', values: ['Tx', 'Rx'], default: 0, label: 'Mode' },
    },
    art: 'ping', behaviours: ['wireless_pair'],
  },
  {
    // Electromagnet: powered (150 W), it pulls steel within 0.6 m of its front pole face, F = k / max(d, 0.05)²,
    // and holds steel in contact while the supply factor is ≥ 0.75. Dynamic, so it can hang from a LINE.
    type: 'maglock', family: 'power', name: 'MAGLOCK', tag: 'Electromagnet', ship: 'M3', bounds: bottom([0.2, 0.2, 0.18]),
    body: { kind: 'dynamic', mass: 3.0, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'cylinder', size: [0.16, 0.18, 0.16], axis: 'z', at: [0, 0.1, 0] },
      { kind: 'box', size: [0.18, 0.016, 0.18], at: [0, 0.008, 0] },
      { kind: 'box', size: [0.014, 0.09, 0.05], at: [-0.093, 0.061, 0] },
      { kind: 'box', size: [0.014, 0.09, 0.05], at: [0.093, 0.061, 0] },
      { kind: 'cylinder', size: [0.024, 0.02, 0.024], at: [0, 0.188, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.16, 0.12, 0.16], axis: 'z', at: [0, 0.1, -0.03], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.15, 0.05, 0.15], axis: 'z', at: [0, 0.1, 0.035], color: C.copper, rough: 0.35, metal: 0.8 },
      { mesh: 'cylinder', size: [0.16, 0.012, 0.16], axis: 'z', at: [0, 0.1, 0.084], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.06, 0.014, 0.06], axis: 'z', at: [0, 0.1, 0.085], color: C.chrome, metal: 1, rough: 0.15 },
      { mesh: 'cylinder', size: [0.1, 0.004, 0.1], axis: 'z', at: [0, 0.1, 0.09], color: C.plasma, emissive: 1, when: 'powered' },
      { mesh: 'box', size: [0.18, 0.016, 0.18], at: [0, 0.008, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.014, 0.09, 0.05], at: [-0.093, 0.061, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.014, 0.09, 0.05], at: [0.093, 0.061, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.024, 0.02, 0.024], at: [0, 0.188, 0], color: C.steel, metal: 1, rough: 0.3 },
    ],
    ports: [pow('in', [0.101, 0.055, 0]), { name: 'eye', channel: 'tension', dir: 'both', at: [0, 0.183, 0], kind: 'hook' }],
    props: {}, art: 'maglock', behaviours: ['field_emitter', 'power_consumer'], power: { consumer: 150 },
  },
  // ---- Fire and boom --------------------------------------------------------------------------------
  {
    // Big oak barrel charge: yield 3. Detonates on its fuse stub (lit by a FUSE or a flame at the stub, then
    // `fuse` seconds), a Signal on `detonator`, a sympathetic blast, or 1.5 s of continuous heat (cook-off).
    // bounds: the fuse stub tip rises to 0.165 (boom.md), above the 0.15 lid
    type: 'powder_keg', family: 'boom', name: 'POWDER KEG', tag: 'Big barrel', ship: 'M3', bounds: b([-0.1, -0.15, -0.1], [0.1, 0.17, 0.1]),
    body: { kind: 'dynamic', mass: 6.0, friction: 0.6, restitution: 0.15, material: 'wood' },
    shapes: () => [{ kind: 'cylinder', size: [0.19, 0.3, 0.19] }],
    visuals: () => [
      { mesh: 'cylinder', size: [0.19, 0.3, 0.19], color: C.oak, rough: 0.6 },
      { mesh: 'cylinder', size: [0.2, 0.14, 0.2], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.196, 0.02, 0.196], at: [0, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.196, 0.02, 0.196], at: [0, -0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.012, 0.03, 0.012], at: [0.045, 0.155, 0], color: C.brass, rough: 0.3, metal: 0.8 },
      { mesh: 'cylinder', size: [0.004, 0.03, 0.004], at: [0.055, 0.16, 0.01], tiltZ: -40, color: C.rubber, rough: 0.8 },
      { mesh: 'sphere', size: [0.014, 0.014, 0.014], at: KEG.stub, color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [{ name: 'fuse', channel: 'heat', dir: 'in', at: [0.045, 0.142, 0] }, sig('detonator', [-0.045, 0.142, 0])],
    props: { fuse: { type: 'seconds', min: 0.5, max: 5, step: 0.1, default: 2, label: 'Fuse' } },
    art: 'powder_keg', behaviours: ['rigid_basic', 'flammable', 'explosive'], explosive: { yield: 3 }, flammable: { igniteTime: 1.5 },
  },
  {
    // Nitro flask: any single contact ≥ 0.15 N·s sets it off (yield 1.5); 0.08–0.15 N·s jostles it. Heat
    // doesn't ignite it, but a blast within 0.6 R does (sympathetic).
    type: 'jitterjuice', family: 'boom', name: 'JITTERJUICE', tag: 'Nitro flask', ship: 'M3', bounds: b([-0.05, -0.05, -0.05], [0.05, 0.1, 0.05]),
    body: { kind: 'dynamic', mass: 0.4, friction: 0.4, restitution: 0.3, material: 'glass' },
    shapes: () => [
      { kind: 'sphere', size: [0.085, 0.085, 0.085], at: [0, -0.005, 0] },
      { kind: 'cylinder', size: [0.032, 0.06, 0.032], at: [0, 0.065, 0] },
      { kind: 'cylinder', size: [0.1, 0.02, 0.1], at: [0, -0.04, 0] },
    ],
    visuals: () => [
      { mesh: 'sphere', size: [0.085, 0.085, 0.085], at: [0, -0.005, 0], color: C.amber, rough: 0.05, emissive: 0.3 },
      { mesh: 'cylinder', size: [0.032, 0.06, 0.032], at: [0, 0.065, 0], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.034, 0.03, 0.034], at: [0, 0.05, 0], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.026, 0.012, 0.026], at: [0, 0.1, 0], color: C.tan, rough: 0.8 },
      { mesh: 'cylinder', size: [0.1, 0.02, 0.1], at: [0, -0.04, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'sphere', size: [0.05, 0.05, 0.05], at: [0, -0.005, 0], color: C.amber, emissive: 1, when: 'pressed' },
    ],
    ports: [], props: {}, art: 'jitterjuice', behaviours: ['rigid_basic', 'explosive'], explosive: { yield: 1.5 },
  },
  {
    // Six-shot firework cake: heat at its fuse lights a quick-match that fires tube 1…6 at 0.6 s hops. Each
    // shell (a pre-built body) flies up its tube's axis and bursts at `altitude` as a yield-0.2 blast.
    // bounds: the fuse stub reaches z 0.165 in front of the tray (boom.md)
    type: 'skyshow', family: 'boom', name: 'SKYSHOW', tag: 'Firework cake', ship: 'M3', bounds: b([-0.15, 0, -0.16], [0.15, 0.2, 0.17]),
    body: { kind: 'dynamic', mass: 1.6, friction: 0.6, restitution: 0.1, material: 'paper' },
    piece: { shapes: [{ kind: 'sphere', size: [0.04, 0.04, 0.04] }], mass: 0.05, friction: 0.5, restitution: 0.2, ccd: true },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.036, 0.3], at: [0, 0.022, 0] },
      { kind: 'box', size: [0.26, 0.155, 0.22], at: [0, 0.1175, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.036, 0.3], at: [0, 0.022, 0], color: C.graphite, rough: 0.45 },
      ...SKYSHOW.tubes.map((t): VisualDef => ({ mesh: 'cylinder', size: [0.075, 0.155, 0.075], at: [(t.base[0] + t.top[0]) / 2, (t.base[1] + t.top[1]) / 2, (t.base[2] + t.top[2]) / 2], color: C.red, rough: 0.6 })),
      ...SKYSHOW.tubes.map((t): VisualDef => ({ mesh: 'cylinder', size: [0.07, 0.006, 0.07], at: t.top, color: C.tan, rough: 0.7 })),
      { mesh: 'sphere', size: [0.014, 0.014, 0.014], at: SKYSHOW.stub, color: C.flame, emissive: 1, when: 'lit' },
      { mesh: 'sphere', size: [0.04, 0.04, 0.04], color: C.amber, emissive: 0.8, on: 'piece' },
    ],
    ports: [{ name: 'fuse', channel: 'heat', dir: 'in', at: [0, 0.022, 0.151] }],
    props: {
      altitude: { type: 'metres', min: 2, max: 12, step: 0.5, default: 6, label: 'Burst altitude' },
      pattern: { type: 'enum', values: [...SKYSHOW_PATTERNS], default: 0, label: 'Pattern' },
    },
    art: 'skyshow', behaviours: ['flammable', 'launcher'], flammable: { igniteTime: 0.05 },
  },
  {
    // Blowtorch: a 0.6 m heat cone along +X. Gas mode (default): a Signal toggles the valve, no power. Powered
    // mode: on while supplied, drawing 80 W. Wind > 4 m/s at the nozzle douses it until the next on.
    type: 'flamer', family: 'boom', name: 'FLAMER', tag: 'Blowtorch', ship: 'M3', bounds: bottom([0.3, 0.1, 0.1]),
    body: { kind: 'static', mass: 1.2, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.035, 0.08], at: [0, 0.0175, 0] },
      { kind: 'cylinder', size: [0.065, 0.14, 0.065], axis: 'x', at: [-0.07, 0.05, 0] },
      { kind: 'capsule', size: [0.024, 0.11, 0.024], axis: 'x', at: [0.095, 0.05, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.035, 0.08], at: [0, 0.0175, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.065, 0.14, 0.065], axis: 'x', at: [-0.07, 0.05, 0], color: C.amber, rough: 0.4 },
      { mesh: 'box', size: [0.04, 0.05, 0.05], at: [0.02, 0.05, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.014, 0.08, 0.014], axis: 'x', at: [0.08, 0.05, 0], color: C.brass, rough: 0.3, metal: 0.8 },
      { mesh: 'cylinder', size: [0.024, 0.03, 0.024], axis: 'x', at: [0.135, 0.05, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.05, 0.5, 0.05], axis: 'x', at: [0.4, 0.05, 0], color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [sig('on', [-0.07, 0.019, 0.041]), pow('in', [-0.03, 0.019, 0.041])],
    props: {
      mode: { type: 'enum', values: ['Gas', 'Powered'], default: 0, label: 'Mode' },
      on: { type: 'bool', default: 0, label: 'Open at start' },
    },
    art: 'flamer', behaviours: ['flammable', 'power_consumer'], power: { consumer: 80 },
  },
  {
    // Party popper: ≥ 4 N on its string pops it: a 0.15 s air puff up its cone (1.0 m / 15°) that pushes
    // light bodies, plus confetti. Not an explosive (no yield, no heat).
    // bounds: the pull tab hangs 0.07 in front of the cup (boom.md)
    type: 'popper', family: 'boom', name: 'POPPER', tag: 'Party popper', ship: 'M3', bounds: b([-0.05, 0, -0.05], [0.05, 0.15, 0.07]),
    body: { kind: 'dynamic', mass: 0.12, friction: 0.6, restitution: 0.1, material: 'paper' },
    shapes: () => [
      { kind: 'cylinder', size: [0.08, 0.045, 0.08], at: [0, 0.0225, 0] },
      { kind: 'cylinder', size: [0.045, 0.1, 0.045], at: [0, 0.095, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.08, 0.045, 0.08], at: [0, 0.0225, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.045, 0.1, 0.045], at: [0, 0.095, 0], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.06, 0.006, 0.06], at: [0, 0.145, 0], color: C.tan, rough: 0.7 },
      { mesh: 'box', size: [0.02, 0.012, 0.004], at: [0, 0.022, 0.048], color: C.bone, rough: 0.5 },
      { mesh: 'sphere', size: [0.05, 0.03, 0.05], at: [0, 0.16, 0], color: C.plasma, emissive: 0.8, when: 'pressed' },
    ],
    ports: [{ name: 'string', channel: 'tension', dir: 'in', at: [0, 0.022, 0.041], kind: 'hook' }],
    props: {}, art: 'popper', behaviours: ['air_emitter'],
  },
  // ---- Contraptions ---------------------------------------------------------------------------------
  {
    // Fling trap: a touch on the pedal (0.03 N·s, or 0.03 kg resting) snaps the bar 172° over the board,
    // flinging whatever sits in its cup. The light board hops.
    type: 'snaptrap', family: 'contraptions', name: 'SNAPTRAP', tag: 'Fling trap', ship: 'M3', bounds: bottom([0.2, 0.05, 0.1]),
    body: { kind: 'dynamic', mass: 0.15, friction: 0.5, restitution: 0.25, material: 'wood' },
    hinge: { at: SNAPTRAP.hinge, axis: [0, 0, -1], limits: [0, SNAPTRAP.limit], armMass: 0.03 },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.012, 0.1], at: [0, 0.009, 0] },
      { kind: 'box', size: [0.03, 0.003, 0.05], at: [0.04, 0.0165, 0] },
      { kind: 'box', size: [0.08, 0.004, 0.06], at: [-0.042, 0.022, 0], on: 'arm' },
      { kind: 'box', size: [0.03, 0.003, 0.03], at: [-0.08, 0.0255, 0], on: 'arm' },
      { kind: 'box', size: [0.003, 0.008, 0.03], at: [-0.0935, 0.031, 0], on: 'arm' },
      { kind: 'box', size: [0.003, 0.008, 0.03], at: [-0.0665, 0.031, 0], on: 'arm' },
      { kind: 'box', size: [0.03, 0.008, 0.003], at: [-0.08, 0.031, -0.0135], on: 'arm' },
      { kind: 'box', size: [0.03, 0.008, 0.003], at: [-0.08, 0.031, 0.0135], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.012, 0.1], at: [0, 0.009, 0], color: C.oak, rough: 0.6 },
      { mesh: 'box', size: [0.03, 0.003, 0.05], at: [0.04, 0.0165, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.012, 0.012, 0.012], axis: 'z', at: [0, 0.022, 0.035], color: C.chrome, metal: 1, rough: 0.2 },
      { mesh: 'cylinder', size: [0.012, 0.012, 0.012], axis: 'z', at: [0, 0.022, -0.035], color: C.chrome, metal: 1, rough: 0.2 },
      { mesh: 'box', size: [0.08, 0.004, 0.06], at: [-0.042, 0.022, 0], color: C.chrome, metal: 1, rough: 0.2, on: 'arm' },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [-0.08, 0.03, 0], color: C.ignition, rough: 0.4, on: 'arm' },
    ],
    ports: [], props: {}, art: 'snaptrap', behaviours: ['hinge_triggered', 'launcher'],
  },
  {
    // Hinged mallet: a Signal swings the head forward (+Z) through 100° at ≈ 5 m/s, holds 0.2 s, returns in 0.5 s.
    type: 'bonker', family: 'contraptions', name: 'BONKER', tag: 'Hinged mallet', ship: 'M3', bounds: b([-0.05, -0.05, -0.05], [0.05, 0.35, 0.05]),
    body: { kind: 'static', mass: 1.0, friction: 0.5, restitution: 0.3, material: 'powder' },
    hinge: { at: [0, 0, 0], axis: [1, 0, 0], limits: [0, 100], armMass: 0.6 },
    shapes: () => [
      { kind: 'box', size: [0.1, 0.07, 0.1], at: [0, -0.015, 0] },
      { kind: 'capsule', size: [0.022, 0.23, 0.022], at: [0, 0.145, 0], on: 'arm' },
      { kind: 'cylinder', size: [0.08, 0.1, 0.08], axis: 'z', at: [0, 0.31, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.07, 0.1], at: [0, -0.015, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.012, 0.11, 0.012], axis: 'x', at: [0, 0, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.022, 0.25, 0.022], at: [0, 0.145, 0], color: C.oak, rough: 0.6, on: 'arm' },
      { mesh: 'cylinder', size: [0.08, 0.1, 0.08], axis: 'z', at: [0, 0.31, 0], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [0, 0.022, -0.03], color: C.volt, emissive: 0.9, when: 'lit' },
    ],
    ports: [sig('swing', [0, -0.015, 0.051])],
    props: {}, art: 'bonker', behaviours: ['hinge_triggered'],
  },
  {
    // Torsion catapult: a Signal on `release` (or ≥ 4 N on the `trigger` LINE) whips the arm from cocked up to
    // the stop bar; the payload leaves the cup at `angle` above horizontal along +X.
    type: 'flinger', family: 'contraptions', name: 'FLINGER', tag: 'Catapult', ship: 'M3', bounds: bottom([0.4, 0.3, 0.3]),
    body: { kind: 'static', mass: 5, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: FLINGER.axle, axis: [0, 0, -1], limits: [0, 75], armMass: 0.5 },
    shapes: () => [
      { kind: 'box', size: [0.4, 0.045, 0.03], at: [0, 0.0225, -0.13] },
      { kind: 'box', size: [0.4, 0.045, 0.03], at: [0, 0.0225, 0.13] },
      { kind: 'box', size: [0.3, 0.245, 0.015], at: [0, 0.1675, -0.13] },
      { kind: 'box', size: [0.3, 0.245, 0.015], at: [0, 0.1675, 0.13] },
      ...FLING.shapes,
    ],
    visuals: (p) => {
      const a = (90 - (p.angle ?? 45)) * RAD, r = 0.12;
      return [
        { mesh: 'box', size: [0.4, 0.045, 0.03], at: [0, 0.0225, -0.13], color: C.bone, rough: 0.5 },
        { mesh: 'box', size: [0.4, 0.045, 0.03], at: [0, 0.0225, 0.13], color: C.bone, rough: 0.5 },
        { mesh: 'box', size: [0.3, 0.245, 0.015], at: [0, 0.1675, -0.13], color: C.bone, rough: 0.5 },
        { mesh: 'box', size: [0.3, 0.245, 0.015], at: [0, 0.1675, 0.13], color: C.bone, rough: 0.5 },
        { mesh: 'cylinder', size: [0.06, 0.2, 0.06], axis: 'z', at: FLINGER.axle, color: C.chrome, metal: 1, rough: 0.2 },
        { mesh: 'cylinder', size: [0.03, 0.27, 0.03], axis: 'z', at: [FLINGER.axle[0] - dsin(a) * r, FLINGER.axle[1] + dcos(a) * r, 0], color: C.ignition, rough: 0.4 },
        { mesh: 'sphere', size: [0.01, 0.01, 0.01], at: [0, 0.29, 0.138], color: C.volt, emissive: 0.9, when: 'lit' },
        ...FLING.visuals,
      ];
    },
    ports: [sig('release', [-0.12, 0.07, 0.138]), { name: 'trigger', channel: 'tension', dir: 'in', at: [-0.04, 0.07, 0.138], kind: 'hook' }],
    props: { angle: { type: 'angle', min: 30, max: 70, step: 5, default: 45, label: 'Launch angle' } },
    art: 'flinger', behaviours: ['hinge_triggered', 'launcher'],
  },
  {
    // Wrecking ball: 20 kg of steel on a CHAIN (or LINE). Magnetic enough for a MAGLOCK crane.
    type: 'wrecker', family: 'contraptions', name: 'WRECKER', tag: 'Wrecking ball', ship: 'M3', bounds: b([-0.095, -0.095, -0.095], [0.095, 0.115, 0.095]),
    body: { kind: 'dynamic', mass: 20, friction: 0.5, restitution: 0.1, ccd: true, material: 'steel', magnetic: true },
    shapes: () => [{ kind: 'sphere', size: [0.19, 0.19, 0.19] }],
    visuals: () => [
      { mesh: 'sphere', size: [0.19, 0.19, 0.19], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.192, 0.04, 0.192], color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.07, 0.01, 0.07], at: [0, 0.092, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'box', size: [0.008, 0.02, 0.03], at: [0, 0.105, 0], color: C.chrome, metal: 1, rough: 0.2 },
    ],
    ports: [{ name: 'hook', channel: 'tension', dir: 'both', at: [0, 0.097, 0], kind: 'hook' }],
    props: {}, art: 'wrecker', behaviours: ['rigid_basic'],
  },
  {
    // Spring plunger: a Signal draws the striker back 0.06 m over 0.18 s, then fires it forward (+Z) at 4 m/s.
    type: 'pinger', family: 'contraptions', name: 'PINGER', tag: 'Spring plunger', ship: 'M3', bounds: b([-0.05, 0, -0.15], [0.05, 0.1, 0.16]),
    body: { kind: 'static', mass: 0.9, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.08, 0.02, 0.26], at: [0, 0.014, 0] },
      { kind: 'box', size: [0.08, 0.08, 0.03], at: [0, 0.055, -0.115] },
      { kind: 'box', size: [0.08, 0.02, 0.036], at: [0, 0.025, 0.138] },
      { kind: 'cylinder', size: [0.035, 0.03, 0.035], axis: 'z', at: [0, 0.055, 0.145], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.08, 0.02, 0.26], at: [0, 0.014, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.08, 0.08, 0.03], at: [0, 0.055, -0.115], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.08, 0.08, 0.036], at: [0, 0.055, 0.138], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.05, 0.22, 0.05], axis: 'z', at: [0, 0.055, 0.01], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.04, 0.2, 0.04], axis: 'z', at: [0, 0.055, 0.01], color: C.chrome, metal: 1, rough: 0.2 },
      { mesh: 'cylinder', size: [0.035, 0.03, 0.035], axis: 'z', at: [0, 0.055, 0.145], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'cylinder', size: [0.04, 0.03, 0.04], axis: 'z', at: [0, 0.055, -0.145], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [0.02, 0.097, -0.115], color: C.volt, emissive: 0.9, when: 'lit' },
    ],
    ports: [sig('fire', [0, 0.095, 0.138])],
    props: {}, art: 'pinger', behaviours: ['slider_actuator'],
  },
  {
    // Pinball flipper: a Signal flips the bat from −15° to +30° about its hub in 0.05 s, holds 0.3 s, returns.
    type: 'paddle', family: 'contraptions', name: 'PADDLE', tag: 'Flipper', ship: 'M3', bounds: b([-0.035, -0.06, -0.035], [0.252, 0.025, 0.077]),
    body: { kind: 'static', mass: 0.8, friction: 0.5, restitution: 0.7, material: 'powder' },
    hinge: { at: [0, 0, 0], axis: [0, 1, 0], limits: [0, 45], armMass: 0.3 },
    shapes: () => [{ kind: 'cylinder', size: [0.07, 0.045, 0.07], at: [0, -0.0375, 0] }, ...BAT.shapes],
    visuals: () => [{ mesh: 'cylinder', size: [0.07, 0.045, 0.07], at: [0, -0.0375, 0], color: C.bone, rough: 0.5 }, ...BAT.visuals],
    ports: [sig('flip', [0, -0.037, 0.036])],
    props: {}, art: 'paddle', behaviours: ['hinge_triggered'],
  },
  {
    // Pop bumper: anything that hits its band leaves at 1.2 × its arrival speed (at least 1.5, at most 8 m/s),
    // straight out from the centre; a Signal on `kick` kicks whatever touches it.
    type: 'bumper', family: 'contraptions', name: 'BUMPER', tag: 'Pop bumper', ship: 'M3', bounds: bottom([0.15, 0.1, 0.15]),
    body: { kind: 'static', mass: 0.6, friction: 0.6, restitution: 0.9, material: 'rubber' },
    shapes: () => [
      { kind: 'cylinder', size: [0.15, 0.032, 0.15], at: [0, 0.016, 0] },
      { kind: 'cylinder', size: [0.12, 0.04, 0.12], at: [0, 0.05, 0] },
      { kind: 'cylinder', size: [0.09, 0.03, 0.09], at: [0, 0.085, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.15, 0.032, 0.15], at: [0, 0.016, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.12, 0.04, 0.12], at: [0, 0.05, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.124, 0.008, 0.124], at: [0, 0.05, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.09, 0.03, 0.09], at: [0, 0.085, 0], color: C.glass, rough: 0.05 },
      { mesh: 'sphere', size: [0.04, 0.02, 0.04], at: [0, 0.085, 0], color: C.amber, emissive: 1, when: 'pressed' },
    ],
    ports: [sig('kick', [0, 0.019, 0.076])],
    props: {}, art: 'bumper', behaviours: ['sensor_pulse'],
  },
  // ---- Fun ------------------------------------------------------------------------------------------
  {
    // Bowling pin (placed singly or racked in tens): when every pin of a rack (pins within 0.2 m of each other at
    // the start) is more than 45° from upright, the rack's first pin emits a `Strike`.
    type: 'pin', family: 'fun', name: 'PINS', tag: 'Bowling pin', ship: 'M3', bounds: b([-0.025, -0.055, -0.025], [0.025, 0.095, 0.025]),
    body: { kind: 'dynamic', mass: 0.1, friction: 0.4, restitution: 0.35, material: 'wood' },
    shapes: () => [
      { kind: 'cylinder', size: [0.022, 0.012, 0.022], at: [0, -0.049, 0] },
      { kind: 'sphere', size: [0.048, 0.048, 0.048], at: [0, -0.01, 0] },
      { kind: 'capsule', size: [0.02, 0.06, 0.02], at: [0, 0.04, 0] },
      { kind: 'sphere', size: [0.026, 0.026, 0.026], at: [0, 0.071, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.022, 0.012, 0.022], at: [0, -0.049, 0], color: C.bone, rough: 0.4 },
      { mesh: 'sphere', size: [0.048, 0.06, 0.048], at: [0, -0.01, 0], color: C.bone, rough: 0.4 },
      { mesh: 'cylinder', size: [0.02, 0.06, 0.02], at: [0, 0.04, 0], color: C.bone, rough: 0.4 },
      { mesh: 'cylinder', size: [0.0215, 0.004, 0.0215], at: [0, 0.04, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.0195, 0.004, 0.0195], at: [0, 0.05, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'sphere', size: [0.026, 0.026, 0.026], at: [0, 0.071, 0], color: C.bone, rough: 0.4 },
    ],
    ports: [], props: {}, art: 'pin', behaviours: ['rigid_basic'],
  },
  {
    // Hardwood block for wobbly towers (crossed in threes).
    type: 'stacker', family: 'fun', name: 'STACKERS', tag: 'Block tower', ship: 'M3', bounds: centred([0.1, 0.03, 0.3]),
    body: { kind: 'dynamic', mass: 0.6, friction: 0.55, restitution: 0.1, material: 'wood' },
    shapes: () => [{ kind: 'box', size: [0.1, 0.03, 0.3] }],
    visuals: () => [{ mesh: 'box', size: [0.1, 0.03, 0.3], color: C.oak, rough: 0.55 }],
    ports: [], props: {}, art: 'stacker', behaviours: ['rigid_basic'],
  },
  {
    // Glass sheet: a hit ≥ 0.8 N·s, or any blast that reaches it, shatters it into its pre-built shards.
    type: 'pane', family: 'fun', name: 'PANE', tag: 'Glass pane', ship: 'M3', bounds: b([-0.05, -0.2, -0.009], [0.05, 0.2, 0.009]),
    body: { kind: 'dynamic', mass: 1.0, friction: 0.4, restitution: 0.2, material: 'glass' },
    shapes: () => [{ kind: 'box', size: [0.1, 0.4, 0.014] }],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.376, 0.01], color: C.glass, rough: 0.03 },
      { mesh: 'box', size: [0.1, 0.012, 0.018], at: [0, 0.194, 0], color: C.plasma, rough: 0.4 },
      { mesh: 'box', size: [0.1, 0.012, 0.018], at: [0, -0.194, 0], color: C.plasma, rough: 0.4 },
    ],
    ports: [], props: {}, art: 'pane', behaviours: ['breakable'],
  },
  {
    // Ceramic vase: a hit ≥ 0.6 N·s, or any blast that reaches it, shatters it (the foot ring survives).
    type: 'vase', family: 'fun', name: 'VASE', tag: 'Vase', ship: 'M3', bounds: b([-0.05, -0.075, -0.05], [0.05, 0.125, 0.05]),
    body: { kind: 'dynamic', mass: 0.45, friction: 0.4, restitution: 0.2, material: 'ceramic' },
    shapes: () => [
      { kind: 'cylinder', size: [0.06, 0.012, 0.06], at: [0, -0.069, 0] },
      { kind: 'cylinder', size: [0.075, 0.01, 0.075], at: [0, -0.059, 0] },
      { kind: 'cylinder', size: [0.1, 0.1, 0.1], at: [0, -0.005, 0] },
      { kind: 'cylinder', size: [0.05, 0.07, 0.05], at: [0, 0.08, 0] },
      { kind: 'cylinder', size: [0.06, 0.012, 0.06], at: [0, 0.119, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.06, 0.012, 0.06], at: [0, -0.069, 0], color: C.plasma, rough: 0.2 },
      { mesh: 'sphere', size: [0.1, 0.13, 0.1], at: [0, -0.005, 0], color: C.plasma, rough: 0.15 },
      { mesh: 'cylinder', size: [0.05, 0.07, 0.05], at: [0, 0.08, 0], color: C.plasma, rough: 0.15 },
      { mesh: 'cylinder', size: [0.06, 0.012, 0.06], at: [0, 0.119, 0], color: C.bone, rough: 0.3 },
    ],
    ports: [], props: {}, art: 'vase', behaviours: ['breakable'],
  },
  {
    // Tuned bar: a hit on the bar (≥ 0.02 N·s, 0.06 s cooldown) plays its scale degree: a `Note` event
    // (mag = degree + volume) and a quiet Sound. The audio side maps degrees into the world key.
    type: 'tonebars', family: 'fun', name: 'TONEBARS', tag: 'Tuned bar', ship: 'M3', bounds: b([-0.05, 0, -0.15], [0.05, 0.058, 0.15]),
    body: { kind: 'static', mass: 1.2, friction: 0.4, restitution: 0.45, material: 'steel' },
    shapes: (p) => [
      { kind: 'box', size: [0.085, 0.014, tonebarLen(p)], at: [0, 0.043, 0] },
      { kind: 'box', size: [0.07, 0.02, 0.3], at: [0, 0.014, 0] },
    ],
    visuals: (p) => {
      const deg = Math.max(0, Math.min(14, Math.round(p.degree ?? 0))), L = tonebarLen(p), n = 0.276 * L;
      const bar = (p.wood ?? 0) ? C.walnut : TONE_COLOR[deg % 7]!;
      return [
        { mesh: 'box', size: [0.085, 0.014, L], at: [0, 0.043, 0], color: bar, rough: 0.3, metal: (p.wood ?? 0) ? 0 : 0.8 },
        { mesh: 'box', size: [0.07, 0.02, 0.3], at: [0, 0.014, 0], color: C.graphite, rough: 0.4 },
        { mesh: 'cylinder', size: [0.012, 0.012, 0.012], at: [0, 0.03, n], color: C.graphite, rough: 0.4 },
        { mesh: 'cylinder', size: [0.012, 0.012, 0.012], at: [0, 0.03, -n], color: C.graphite, rough: 0.4 },
        { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [-0.02, 0.014, 0.15], color: C.plasma, emissive: 1, when: 'pressed' },
      ];
    },
    ports: [],
    props: {
      degree: { type: 'int', min: 0, max: 14, default: 0, label: 'Scale degree' },
      wood: { type: 'bool', default: 0, label: 'Wooden bar' },
    },
    art: 'tonebars', behaviours: ['music_note'],
  },
  {
    // Desk bell: a hit on the plunger (≥ 0.04 N·s) or the dome (≥ 0.10 N·s) rings it: a `Note` and a 77 dB
    // Sound, so every critter within 4 m startles. Its brass dome makes it shiny bait for Bandit.
    type: 'ding', family: 'fun', name: 'DING', tag: 'Desk bell', ship: 'M3', bounds: b([-0.05, -0.035, -0.05], [0.05, 0.065, 0.05]),
    body: { kind: 'dynamic', mass: 0.45, friction: 0.5, restitution: 0.3, material: 'brass' },
    shapes: () => [
      { kind: 'cylinder', size: [0.09, 0.02, 0.09], at: [0, -0.025, 0] },
      { kind: 'sphere', size: [0.084, 0.084, 0.084], at: [0, -0.01, 0] },
      { kind: 'cylinder', size: [0.006, 0.02, 0.006], at: [0, 0.043, 0] },
      { kind: 'cylinder', size: [0.03, 0.012, 0.03], at: [0, 0.059, 0] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.09, 0.02, 0.09], at: [0, -0.025, 0], color: C.bone, rough: 0.5 },
      { mesh: 'sphere', size: [0.084, 0.096, 0.084], at: [0, -0.003, 0], color: C.brass, rough: 0.2, metal: 0.9 },
      { mesh: 'cylinder', size: [0.006, 0.02, 0.006], at: [0, 0.043, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.03, 0.012, 0.03], at: [0, 0.059, 0], color: C.ignition, rough: 0.25 },
      { mesh: 'cylinder', size: [0.092, 0.003, 0.092], at: [0, -0.015, 0], color: C.plasma, emissive: 1, when: 'pressed' },
    ],
    ports: [],
    props: { degree: { type: 'int', min: 0, max: 14, default: 0, label: 'Scale degree' } },
    art: 'ding', behaviours: ['music_note'],
  },
  // ---- Future tech ----------------------------------------------------------------------------------
  {
    // Spawner: a Signal on `spawn` (or every `interval` seconds) pops the next of its `count` parts out of the
    // mouth at `speed`. The parts are a finite pre-built pool, dormant until spawned (D66).
    type: 'fabricator', family: 'future', name: 'FABRICATOR', tag: 'Part spawner', ship: 'M3', bounds: bottom([0.3, 0.3, 0.3]),
    body: { kind: 'static', mass: 9, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.155, 0.3], at: [0, 0.2225, 0] },
      { kind: 'box', size: [0.08, 0.129, 0.3], at: [-0.11, 0.0805, 0] },
      { kind: 'box', size: [0.08, 0.129, 0.3], at: [0.11, 0.0805, 0] },
      { kind: 'box', size: [0.14, 0.11, 0.2], at: [0, 0.09, -0.05] },
      { kind: 'box', size: [0.14, 0.019, 0.1], at: [0, 0.0255, 0.1] },
      { kind: 'box', size: [0.28, 0.016, 0.28], at: [0, 0.008, 0] },
    ],
    visuals: (p) => [
      { mesh: 'box', size: [0.3, 0.155, 0.3], at: [0, 0.2225, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.08, 0.129, 0.3], at: [-0.11, 0.0805, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.08, 0.129, 0.3], at: [0.11, 0.0805, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.14, 0.11, 0.2], at: [0, 0.09, -0.05], color: '#101318', rough: 0.4 },
      { mesh: 'box', size: [0.15, 0.085, 0.004], at: [0, 0.235, 0.151], color: C.plasma, rough: 0.1, emissive: 0.3 },
      { mesh: 'box', size: [0.28, 0.016, 0.28], at: [0, 0.008, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.18, 0.008, 0.008], at: [0, 0.301, 0], color: C.plasma, emissive: 1, when: 'powered' },
      ...fabricatorPiece(p),
    ],
    ports: [sig('spawn', [-0.105, 0.09, 0.15])],
    props: {
      part: { type: 'enum', values: SPAWNABLE.map((t) => t.toUpperCase().replace('_', ' ')), default: 0, label: 'Part' },
      count: { type: 'int', min: 1, max: FABRICATOR.max, default: 5, label: 'Count' },
      interval: { type: 'seconds', min: 0, max: 10, step: 0.5, default: 0, label: 'Every (0 = on Signal)' },
      speed: { type: 'float', min: 0, max: 3, step: 0.1, default: 1, label: 'Launch speed (m/s)' },
    },
    art: 'fabricator', behaviours: ['spawner'],
  },
  {
    // Sink: whatever's centre enters the funnel mouth is despawned (critters are refused and popped back out);
    // FABRICATOR parts go back to their pool. It pulses `count` at `target` (once, or every `target`).
    type: 'recycler', family: 'future', name: 'RECYCLER', tag: 'Despawning sink', ship: 'M3', bounds: bottom([0.3, 0.2, 0.3]),
    body: { kind: 'static', mass: 6, friction: 0.4, restitution: 0.2, material: 'powder' },
    shapes: () => {
      const a = 53.13; // funnel walls: from the 0.22 opening at y 0.20 down to the Ø 0.10 core at y 0.12
      return [
        { kind: 'box', size: [0.3, 0.12, 0.3], at: [0, 0.06, 0] },
        { kind: 'box', size: [0.04, 0.08, 0.3], at: [-0.13, 0.16, 0] },
        { kind: 'box', size: [0.04, 0.08, 0.3], at: [0.13, 0.16, 0] },
        { kind: 'box', size: [0.22, 0.08, 0.04], at: [0, 0.16, -0.13] },
        { kind: 'box', size: [0.22, 0.08, 0.04], at: [0, 0.16, 0.13] },
        { kind: 'box', size: [0.1, 0.006, 0.22], at: [-0.08, 0.16, 0], tiltZ: -a },
        { kind: 'box', size: [0.1, 0.006, 0.22], at: [0.08, 0.16, 0], tiltZ: a },
        { kind: 'box', size: [0.22, 0.006, 0.1], at: [0, 0.16, -0.08], rot: qAxis([1, 0, 0], a) },
        { kind: 'box', size: [0.22, 0.006, 0.1], at: [0, 0.16, 0.08], rot: qAxis([1, 0, 0], -a) },
      ];
    },
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.12, 0.3], at: [0, 0.06, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.04, 0.08, 0.3], at: [-0.13, 0.16, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.04, 0.08, 0.3], at: [0.13, 0.16, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.22, 0.08, 0.04], at: [0, 0.16, -0.13], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.22, 0.08, 0.04], at: [0, 0.16, 0.13], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.22, 0.004, 0.22], at: [0, 0.18, 0], color: C.plasma, rough: 0.35, metal: 0.6 },
      { mesh: 'cylinder', size: [0.1, 0.004, 0.1], at: [0, 0.121, 0], color: '#101318', rough: 0.2, emissive: 0.2 },
      { mesh: 'box', size: [0.23, 0.006, 0.23], at: [0, 0.201, 0], color: C.plasma, emissive: 1, when: 'pressed' },
    ],
    ports: [sig('count', [-0.095, 0.1, 0.15], 'out', 8)],
    props: {
      target: { type: 'int', min: 1, max: 99, default: 3, label: 'Goal' },
      mode: { type: 'enum', values: ['At goal', 'Every goal'], default: 0, label: 'Signal' },
    },
    art: 'recycler', behaviours: ['sink'],
  },
  {
    // Field volume: always on, invisible in a run. Gravity (× strength), Antigrav (net strength g upward), Wind
    // (strength m/s along +X; douses flames over 4 m/s) or Stasis (bodies inside freeze). Critters are exempt.
    type: 'zone', family: 'future', name: 'ZONE', tag: 'Field volume', ship: 'M3', bounds: b([-0.5, 0, -0.5], [0.5, 1, 0.5]),
    boundsFor: (p) => { const s = zoneSize(p); return b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]); },
    body: { kind: 'static', mass: 0, friction: 0.5, restitution: 0.2 },
    shapes: () => [],
    visuals: (p) => {
      const s = zoneSize(p), col = ['#3355FF', '#FF3DAE', '#9BE7D8', '#2FD6FF'][Math.max(0, Math.min(3, p.mode ?? 0))]!;
      const out: VisualDef[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const at: V3 = [x * (s[0] / 2 - 0.015), 0.025, z * (s[2] / 2 - 0.015)];
        out.push({ mesh: 'box', size: [0.03, 0.05, 0.03], at, color: C.graphite, rough: 0.45 });
        out.push({ mesh: 'cylinder', size: [0.01, 0.006, 0.01], at: [at[0], 0.053, at[2]], color: col, emissive: 1 });
      }
      return out;
    },
    ports: [],
    props: {
      mode: { type: 'enum', values: [...ZONE_MODES], default: 1, label: 'Mode' },
      width: { type: 'metres', min: 0.1, max: 10, step: 0.1, default: 1, label: 'Width' },
      height: { type: 'metres', min: 0.1, max: 10, step: 0.1, default: 1, label: 'Height' },
      depth: { type: 'metres', min: 0.1, max: 10, step: 0.1, default: 1, label: 'Depth' },
      strength: { type: 'float', min: 0, max: 15, step: 0.1, default: 1, label: 'Strength (g, or m/s for wind)' },
    },
    art: 'zone', behaviours: ['field_emitter'],
  },
];

/** Types with M3 sim behaviour (packages/sim/src/channels: m3.ts and friends). */
export const M3_TYPES: ReadonlySet<string> = new Set(PARTS_M3.map((p) => p.type));

// ---- Library cards (PART_SYSTEM §6) -------------------------------------------------------------------------

export const CARDS_M3: Readonly<Record<string, Card>> = {
  glint: { needs: 'Nothing: drop it, roll it, ride a GLIDEPATH', does: 'A tiny glass marble that rattles down runs; Bandit can’t resist it', tips: ['It fits TUBE SLIM and GUTTER SLIM.', 'Leave one out as bait for Bandit.'] },
  bearing: { needs: 'Nothing: drop it, roll it, ride a GLIDEPATH', does: 'A tiny steel marble: fast, lively, and a MAGLOCK can grab it', tips: ['Start it at either end of a GLIDEPATH to ride the rails.'] },
  glidepath_booster: { needs: 'A spin input (BAND from a MOTOR) on a GLIDEPATH', does: 'Kicks marbles along the rails at its tyre speed', tips: ['Set it on the track; the spin direction picks the way it kicks.'] },
  spindeck: { needs: 'A spin input (BAND from a MOTOR), or a push', does: 'A turntable: its grippy platter carries whatever sits on it round', tips: ['Things near the rim get flung off.', 'Turn on Brake to lock it.'] },
  lift: { needs: 'Power, and a signal on its call input', does: 'An elevator deck: each signal sends it to the other end, then it signals', tips: ['Set the travel from 0.1 to 4 m.', 'Over 15 kg on the deck and it stalls.'] },
  rack: { needs: 'A spin input on the pinion (BAND from a MOTOR)', does: 'Turns spin into a straight push: the toothed bar slides end to end', tips: ['Reverse the motor to pull the bar back.'] },
  ram: { needs: 'Power, and a signal on its fire input', does: 'A piston: punches its head 0.25 m forward, holds, then pulls back', tips: ['It punches along its front: rotate it to aim.'] },
  lance: { needs: 'Power (30 W)', does: 'A laser: one straight beam from its nozzle; through a BURNING GLASS it cuts', tips: ['Bounce it with a MIRROR, fan it with a SPLITTER.', 'A focused beam burns a LINE through.'] },
  mirror: { needs: 'A beam on its silver face', does: 'Bounces a TORCH or LANCE beam off its face', tips: ['Turn it in 5° steps to aim the bounce.'] },
  splitter: { needs: 'A beam into the glass cube', does: 'Fans one beam into three (straight and 12° either side), each a third as bright', tips: ['Light three SUNCELLS or TRIPWIREs at once.'] },
  tripwire: { needs: 'A beam (TORCH or LANCE) on its eye', does: 'Sends a signal when its beam is broken (Break) or when light arrives (Lit)', tips: ['It only receives: aim a beam at the eye on its left side.'] },
  ping: { needs: 'A pair: one set to Tx, one to Rx, same colour', does: 'A wireless cable: a signal into a Tx comes out of every Rx of its colour', tips: ['Six pair colours: pick one per link.'] },
  maglock: { needs: 'Power (150 W)', does: 'An electromagnet: pulls steel up to 0.6 m in front of its face and holds it', tips: ['Hang it from a LINE for a crane magnet.', 'Cut the power to drop what it holds.'] },
  powder_keg: { needs: 'Fire on its fuse, a signal, a blast, or 1.5 s of heat', does: 'A big barrel charge: a yield-3 blast that throws everything near it', tips: ['A flame on its side cooks it off in 1.5 s.', 'Kegs set each other off.'] },
  jitterjuice: { needs: 'Any knock (0.15 N·s) or a nearby blast', does: 'A nitro flask: the slightest hit sets off a yield-1.5 blast', tips: ['A CORK BLASTER cork always sets it off.', 'Fire alone won’t: it needs a knock.'] },
  skyshow: { needs: 'Fire on its fuse', does: 'A firework cake: fires six shells in turn that burst high overhead', tips: ['Set the burst altitude from 2 to 12 m.', 'Each burst is a small blast: it pops balloons.'] },
  flamer: { needs: 'A signal to open the gas (or power, in Powered mode)', does: 'A blowtorch: a 0.6 m flame that lights fuses, burns ropes, pops balloons', tips: ['A GALE or PUFFER blows it out.', 'Powered mode draws 80 W.'] },
  popper: { needs: 'A hard tug (4 N) on its string', does: 'A party popper: a puff of air and confetti that pushes light things', tips: ['Not an explosive: it never lights or breaks anything.'] },
  snaptrap: { needs: 'A touch on its pedal', does: 'A fling trap: the bar snaps over and flings whatever sits in its cup', tips: ['Put a marble in the cup.'] },
  bonker: { needs: 'A signal on its input', does: 'A mallet that swings forward and bonks what’s in front of it', tips: ['Its strike zone is 0.25–0.35 m in front.'] },
  flinger: { needs: 'A signal, or a hard pull on its trigger hook', does: 'A catapult: flings the payload in its cup up and away along +X', tips: ['Set the launch angle from 30° to 70°.', 'Up to 3 kg in the cup.'] },
  wrecker: { needs: 'A CHAIN or LINE to swing it from', does: 'A 20 kg wrecking ball that smashes through walls', tips: ['Pull it back with a HELIO or a FULCRUM, then cut the rope.'] },
  pinger: { needs: 'A signal on its input', does: 'A pinball plunger: pulls back, then fires its striker forward at 4 m/s', tips: ['Line a ball up with the striker.'] },
  paddle: { needs: 'A signal on its input', does: 'A pinball flipper: flips its bat 45° to smack a ball, then drops back', tips: ['Each signal holds it up for 0.3 s.'] },
  bumper: { needs: 'Nothing: hit it (or signal it to kick)', does: 'A pop bumper: kicks anything that hits it back out faster than it came', tips: ['Ring a few together for a pinball cascade.'] },
  pin: { needs: 'Nothing: rack ten, then roll a ball', does: 'A bowling pin that wobbles and clatters; knock a whole rack for a STRIKE', tips: ['A THUD down a SLOPE makes a good bowler.'] },
  stacker: { needs: 'Nothing: stack them three to a layer', does: 'A hardwood block for wobbly towers you can nudge, punch or blast apart', tips: ['Cross each layer over the one below.'] },
  pane: { needs: 'Nothing: knock it, hit it, or blast it', does: 'A tall glass sheet that shatters into shards on a hard hit', tips: ['It topples easily, on purpose.'] },
  vase: { needs: 'Nothing: knock it off something', does: 'A ceramic vase that smashes on a hard hit (the foot survives)', tips: ['Park it on a LEDGE edge.'] },
  tonebars: { needs: 'A ball to hit the bar', does: 'A tuned bar: each hit plays its note in the world’s key', tips: ['Lay a row as a scale and roll a ball across.', 'Scale degree 0 is the key note.'] },
  ding: { needs: 'A hit on the button or the bell', does: 'A desk bell: DING! It startles every critter within 4 m', tips: ['Bandit loves shiny brass.'] },
  fabricator: { needs: 'A signal, or a repeat time', does: 'A part spawner: pops out the next of its parts, until its count runs out', tips: ['Up to 20 of a part.', 'A RECYCLER puts its parts back in the pool.'] },
  recycler: { needs: 'Things dropped into its funnel', does: 'A sink: whatever falls in disappears and counts; it signals at the goal', tips: ['Critters are never recycled: they pop back out.'] },
  zone: { needs: 'Nothing: it’s always on', does: 'An invisible volume: heavy or low gravity, wind, or stasis inside', tips: ['Size it from 0.1 to 10 m on each side.', 'Wind over 4 m/s blows flames out.'] },
  glidepath: { needs: 'A path: draw it like a TUBE', does: 'A twin rail: marbles that start at an end ride it, loops and all', tips: ['Add a BOOSTER to speed them up.', 'Marbles dropped mid-track roll on the rails.'] },
};

// ---- demo machines (PART_SYSTEM §6; the per-part goldens) ------------------------------------------------------

export interface DemoBuilderM3<M> {
  /** `flags`: PartRecord flags (32 = anchored). */
  add(type: string, at: V3, props?: Readonly<Record<string, number>>, rot?: Rotation, flags?: number): number;
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number;
  path(kind: LinkKind, pts: readonly V3[]): number;
  done(ticks: number, cam?: Partial<{ target: readonly [number, number, number]; dist: number; yaw: number; pitch: number }>): M;
}

/** The M3 parts' demo machines (≤ 30 parts, ≤ 3 s), merged into DEMOS by demos.ts. */
export function m3Demos<M>(make: () => DemoBuilderM3<M>): Record<string, M> {
  const D: Record<string, M> = {};
  // ---- Rollers
  {
    // GLINT: a glass marble rolls down a SLOPE and away
    const d = make();
    d.add('slope', [0, 0, 0]);
    d.add('glint', [0.2, 0.3, 0]);
    D.glint = d.done(300, { target: [-0.3, 0.2, 0] });
  }
  {
    // BEARING: a steel marble rolls down a SLOPE and clicks into a second one
    const d = make();
    d.add('slope', [0, 0, 0]);
    d.add('bearing', [0.2, 0.3, 0]);
    d.add('bearing', [-0.5, 0.008, 0]);
    D.bearing = d.done(300, { target: [-0.3, 0.2, 0] });
  }
  // ---- Frame
  {
    // GLIDEPATH: a BEARING set at the start of a rail rides it down, round a bend and off the end
    const d = make();
    d.path('glidepath', [[-0.6, 0.6, 0], [-0.2, 0.35, 0], [0.2, 0.25, 0.2], [0.5, 0.3, 0.3]]);
    d.add('bearing', [-0.6, 0.615, 0]);
    D.glidepath = d.done(300, { target: [0, 0.35, 0.1], dist: 1.8 });
  }
  {
    // BOOSTER: MAINS → MOTOR → BAND spins a booster under a GLIDEPATH; the BEARING riding it speeds up and shoots off the end
    const d = make();
    const mains = d.add('mains', [-0.9, 0, -0.4]);
    const motor = d.add('motor', [-0.5, 0, -0.4], { direction: 1 });
    const boost = d.add('glidepath_booster', [0.1, 0.305, 0]);
    d.path('glidepath', [[-0.6, 0.36, 0], [-0.3, 0.31, 0], [0.6, 0.3, 0]]);
    d.add('bearing', [-0.599, 0.366, 0]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', boost, 'drive');
    D.glidepath_booster = d.done(300, { target: [0, 0.3, 0], dist: 1.8 });
  }
  {
    // SPINDECK: MAINS → MOTOR → BAND turns the platter; a STITCH near the rim rides round and flies off
    const d = make();
    const mains = d.add('mains', [-0.8, 0, -0.4]);
    const motor = d.add('motor', [-0.5, 0, 0]);
    const deck = d.add('spindeck', [0, 0, 0]);
    d.add('stitch', [0.15, 0.14, 0]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', deck, 'in');
    D.spindeck = d.done(360);
  }
  {
    // LIFT: a THUD on THE BUTTON calls the powered lift; it carries a BOING up 0.6 m and signals on arrival
    const d = make();
    const mains = d.add('mains', [-0.6, 0, -0.5]);
    const lift = d.add('lift', [0, 0, 0], { travel: 0.6, speed: 0.5 });
    d.add('boing', [0, 0.171, 0]);
    const button = d.add('the_button', [0.5, 0, 0.3]);
    d.add('thud', [0.5, 0.2, 0.3]);
    d.link('cable_power', mains, 'out', lift, 'in');
    d.link('cable_signal', button, 'out', lift, 'call');
    D.lift = d.done(360, { target: [0, 0.6, 0], dist: 2.6 });
  }
  // ---- Drive
  {
    // RACK: MAINS → MOTOR → BAND turns the pinion; the bar slides out and topples a row of TOPPLE TILES
    const d = make();
    const mains = d.add('mains', [-0.6, 0, -0.5]);
    const motor = d.add('motor', [-0.3, 0, -0.3], { direction: 1 });
    const rack = d.add('rack', [0, 0, 0], { length: 0.6 });
    for (let i = 0; i < 5; i++) d.add('topple_tile', [0.33 + i * 0.1, 0.075, 0]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', rack, 'pinion');
    D.rack = d.done(360);
  }
  {
    // RAM: a THUD on THE BUTTON fires the powered piston, which punches a BOING away along +Z
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.4]);
    const ram = d.add('ram', [0, 0, 0]);
    d.add('boing', [0, 0.12, 0.38]);
    const button = d.add('the_button', [-0.4, 0, 0.2]);
    d.add('thud', [-0.4, 0.2, 0.2]);
    d.link('cable_power', mains, 'out', ram, 'in');
    d.link('cable_signal', button, 'out', ram, 'fire');
    D.ram = d.done(300);
  }
  // ---- Power and signal: optics
  {
    // LANCE: the laser shines through a BURNING GLASS; the focused cutting beam burns through a HELIO's LINE
    const d = make();
    const mains = d.add('mains', [-0.6, 0, -0.3]);
    const lance = d.add('lance', [-0.4, 0.5, 0]);
    d.add('ledge', [-0.4, 0.45, 0]);
    d.add('burning_glass', [-0.1, 0.302, 0], {}, snappedEuler(90, 0, 0));
    const hook = d.add('anchor', [0.12, 0, 0]);
    const h = d.add('helio', [0.12, 0.9, 0]);
    d.link('cable_power', mains, 'out', lance, 'in');
    d.link('line', h, 'knot', hook, 'hook');
    D.lance = d.done(360, { target: [-0.1, 0.5, 0], dist: 2.0 });
  }
  {
    // MIRROR: the LANCE beam bounces off a mirror turned 45° onto a SUNCELL, which runs a MOTOR
    const d = make();
    const mains = d.add('mains', [-0.8, 0, -0.3]);
    const lance = d.add('lance', [-0.4, 0, 0]);
    d.add('mirror', [0, 0, 0], {}, snappedEuler(-45, 0, 0));
    const sun = d.add('suncell', [0, 0.047, 0.5], {}, snappedEuler(0, -90, 0));
    const motor = d.add('motor', [0.5, 0, 0.4]);
    d.link('cable_power', mains, 'out', lance, 'in');
    d.link('cable_power', sun, 'out', motor, 'in');
    D.mirror = d.done(240);
  }
  {
    // SPLITTER: one LANCE beam fans into three, and each lights a TRIPWIRE (Lit mode)
    const d = make();
    const mains = d.add('mains', [-0.8, 0, -0.3]);
    const lance = d.add('lance', [-0.4, 0, 0]);
    d.add('splitter', [-0.1, -0.018, 0]);
    for (const z of [-0.2, 0, 0.2]) d.add('tripwire', [0.85, -0.003, z], { mode: 1 });
    d.link('cable_power', mains, 'out', lance, 'in');
    D.splitter = d.done(120);
  }
  {
    // TRIPWIRE: a STITCH rolling down a SLOPE breaks the LANCE beam; the tripwire's signal sets off a BANGSTICK
    const d = make();
    const mains = d.add('mains', [-1.0, 0, -0.4]);
    const lance = d.add('lance', [-0.6, 0, -0.3]);
    const trip = d.add('tripwire', [-0.6 + 0.1 + 0.0545 + 0.6, -0.003, -0.3]);
    d.add('slope', [-0.1, 0, 0.15], { angle: 15 }, snappedEuler(-90, 0, 0));
    d.add('stitch', [-0.1, 0.27, 0.4]);
    const stick = d.add('bangstick', [0.6, 0.039, 0.5]);
    d.link('cable_power', mains, 'out', lance, 'in');
    d.link('cable_signal', trip, 'out', stick, 'detonator');
    D.tripwire = d.done(360);
  }
  // ---- Power and signal: wireless and field
  {
    // PING: THE BUTTON feeds a Tx; the Rx of the same colour sets off its BANGSTICK, the other colour's doesn't
    const d = make();
    const button = d.add('the_button', [-0.6, 0, 0]);
    d.add('thud', [-0.6, 0.2, 0]);
    const tx = d.add('ping', [-0.3, 0, 0], { pair: 2, mode: 0 });
    const rx = d.add('ping', [0.4, 0, -0.4], { pair: 2, mode: 1 });
    const other = d.add('ping', [0.4, 0, 0.4], { pair: 4, mode: 1 });
    const s1 = d.add('bangstick', [0.8, 0.039, -0.4]);
    const s2 = d.add('bangstick', [0.8, 0.039, 0.4]);
    d.link('cable_signal', button, 'out', tx, 'in');
    d.link('cable_signal', rx, 'out', s1, 'detonator');
    d.link('cable_signal', other, 'out', s2, 'detonator');
    D.ping = d.done(240);
  }
  {
    // MAGLOCK: powered, it pulls a PIG IRON and a BEARING onto its face; the STITCH (not steel) stays put
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.3]);
    const mag = d.add('maglock', [0, 0, 0]);
    d.add('pig_iron', [0, 0.06, 0.25]);
    d.add('bearing', [0.06, 0.008, 0.3]);
    d.add('stitch', [-0.06, 0.0375, 0.25]);
    d.link('cable_power', mains, 'out', mag, 'in');
    D.maglock = d.done(240);
  }
  // ---- Fire and boom
  {
    // POWDER KEG: a lit WICK against its side cooks it off after 1.5 s; the yield-3 blast flattens a BRIK wall
    const d = make();
    d.add('powder_keg', [0, 0.15, 0]);
    d.add('wick', [0.15, 0, 0]);
    for (let row = 0; row < 3; row++) for (const z of [-0.2, 0, 0.2]) d.add('brik', [0.7, 0.05 + row * 0.1, z + (row % 2) * 0.1], {}, snappedEuler(90, 0, 0));
    D.powder_keg = d.done(300, { dist: 2.4 });
  }
  {
    // JITTERJUICE: THE BUTTON fires a CORK BLASTER; the cork's knock sets the flask off
    const d = make();
    const button = d.add('the_button', [-0.6, 0, 0.3]);
    d.add('thud', [-0.6, 0.2, 0.3]);
    const gun = d.add('cork_blaster', [-0.5, 0, 0]);
    d.add('jitterjuice', [0.1, 0.05, 0]);
    d.link('cable_signal', button, 'out', gun, 'fire');
    D.jitterjuice = d.done(240);
  }
  {
    // SKYSHOW: a WICK lights the fuse; the cake fires its shells one by one and they burst overhead
    const d = make();
    const wick = d.add('wick', [0, 0, 0.22]);
    const cake = d.add('skyshow', [0, 0, 0], { altitude: 2 });
    d.link('fuse', wick, 'flame', cake, 'fuse');
    D.skyshow = d.done(360, { target: [0, 1.2, 0], dist: 4.0 });
  }
  {
    // FLAMER: THE BUTTON opens the gas; the 0.6 m flame pops a HELIO and lights a WICK
    const d = make();
    const button = d.add('the_button', [-0.5, 0, 0.3]);
    d.add('thud', [-0.5, 0.2, 0.3]);
    d.add('ledge', [0, 0.09, 0]);
    const torch = d.add('flamer', [0, 0.14, 0]);
    const hook = d.add('anchor', [0.4, 0, 0]);
    const h = d.add('helio', [0.4, 0.33, 0]);
    d.add('wick', [0.6, 0, 0], { lit: 0 });
    d.link('cable_signal', button, 'out', torch, 'on');
    d.link('line', h, 'knot', hook, 'hook');
    D.flamer = d.done(240);
  }
  {
    // POPPER (anchored): a HELIO tugs the string; the popper pops and its puff throws a FUZZ resting on top
    const d = make();
    const pop = d.add('popper', [0, 0, 0], {}, snappedEuler(0, 0, 0), 32);
    const h = d.add('helio', [0, 0.6, 0.3]);
    d.add('fuzz', [0, 0.18, 0]);
    d.link('line', h, 'knot', pop, 'string');
    D.popper = d.done(240, { target: [0, 0.4, 0] });
  }
  // ---- Contraptions
  {
    // SNAPTRAP: a STITCH drops on the pedal; the bar snaps over and flings the GLINT in its cup
    const d = make();
    d.add('snaptrap', [0, 0, 0]);
    d.add('glint', [-0.08, 0.036, 0]);
    d.add('stitch', [0.04, 0.3, 0]);
    D.snaptrap = d.done(240, { target: [0, 0.2, 0], dist: 1.4 });
  }
  {
    // BONKER: a THUD on THE BUTTON swings the mallet; it bonks a second BUTTON in its strike zone, which sets off a BANGSTICK
    const d = make();
    const button = d.add('the_button', [-0.4, 0, 0]);
    d.add('thud', [-0.4, 0.2, 0]);
    const bonk = d.add('bonker', [0, 0.05, 0]);
    const target = d.add('the_button', [0, 0, 0.3]);
    const stick = d.add('bangstick', [0.6, 0.039, 0.6]);
    d.link('cable_signal', button, 'out', bonk, 'swing');
    d.link('cable_signal', target, 'out', stick, 'detonator');
    D.bonker = d.done(240);
  }
  {
    // FLINGER: a THUD on THE BUTTON releases the catapult; the STITCH in its cup flies off along +X
    const d = make();
    const button = d.add('the_button', [-0.4, 0, 0.4]);
    d.add('thud', [-0.4, 0.2, 0.4]);
    const fl = d.add('flinger', [0, 0, 0]);
    d.add('stitch', [-0.16, 0.095, 0]);
    d.link('cable_signal', button, 'out', fl, 'release');
    D.flinger = d.done(300, { target: [0.6, 0.4, 0], dist: 2.6 });
  }
  {
    // WRECKER: a wrecking ball on a CHAIN swings down from the side and smashes a BRIK wall
    const d = make();
    const hook = d.add('anchor', [0, 1.1, 0]);
    const ball = d.add('wrecker', [-0.9, 1.0, 0]);
    for (let row = 0; row < 3; row++) for (const z of [-0.2, 0, 0.2]) d.add('brik', [0.15, 0.05 + row * 0.1, z + (row % 2) * 0.1], {}, snappedEuler(90, 0, 0));
    d.link('chain', ball, 'hook', hook, 'hook');
    D.wrecker = d.done(300, { target: [0, 0.6, 0], dist: 2.8 });
  }
  {
    // PINGER: a THUD on THE BUTTON fires the plunger; it whacks a STITCH away along +Z
    const d = make();
    const button = d.add('the_button', [-0.4, 0, 0]);
    d.add('thud', [-0.4, 0.2, 0]);
    const p = d.add('pinger', [0, 0, 0]);
    d.add('stitch', [0, 0.0375, 0.2]);
    d.link('cable_signal', button, 'out', p, 'fire');
    D.pinger = d.done(240);
  }
  {
    // PADDLE: a THUD on THE BUTTON flips the bat; it smacks a STITCH resting against it
    const d = make();
    const button = d.add('the_button', [-0.4, 0, -0.3]);
    d.add('thud', [-0.4, 0.2, -0.3]);
    const p = d.add('paddle', [0, 0.06, 0]);
    d.add('stitch', [0.18, 0.0375, -0.02]);
    d.link('cable_signal', button, 'out', p, 'flip');
    D.paddle = d.done(240);
  }
  {
    // BUMPER: a STITCH rolls down a SLOPE into the bumper and is kicked back out faster
    const d = make();
    d.add('slope', [0.1, 0, 0], { angle: 15 });
    d.add('stitch', [0.35, 0.26, 0]);
    d.add('bumper', [-0.7, 0, 0]);
    D.bumper = d.done(240);
  }
  // ---- Fun
  {
    // PINS: a THUD rolls off a SLOPE into a rack of ten
    const d = make();
    d.add('slope', [0.4, 0, 0], {}, snappedEuler(180, 0, 0));
    d.add('thud', [0.26, 0.4, 0]);
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) d.add('pin', [1.05 + row * 0.104, 0.055, (k - row / 2) * 0.12]);
    D.pin = d.done(360, { target: [1.0, 0.2, 0], dist: 2.2 });
  }
  {
    // STACKERS: a THUD rolls off a steep SLOPE into a tower of 18 blocks
    const d = make();
    d.add('slope', [0, 0, 0], { angle: 35 }, snappedEuler(180, 0, 0));
    d.add('thud', [-0.1, 0.5, 0]);
    for (let layer = 0; layer < 6; layer++) {
      for (const o of [-0.1, 0, 0.1]) {
        const y = 0.015 + layer * 0.03;
        if (layer % 2) d.add('stacker', [0.85, y, o], {}, snappedEuler(90, 0, 0));
        else d.add('stacker', [0.85 + o, y, 0]);
      }
    }
    D.stacker = d.done(360);
  }
  {
    // PANE: a THUD rolls off a SLOPE into a standing glass pane, which shatters
    const d = make();
    d.add('slope', [0, 0, 0], {}, snappedEuler(180, 0, 0));
    d.add('thud', [-0.15, 0.4, 0]);
    d.add('pane', [0.5, 0.2, 0], {}, snappedEuler(90, 0, 0));
    D.pane = d.done(300);
  }
  {
    // VASE: a vase dropped from 0.5 m smashes on the floor (its foot survives)
    const d = make();
    d.add('vase', [0, 0.6, 0]);
    D.vase = d.done(180, { target: [0, 0.3, 0], dist: 1.4 });
  }
  {
    // TONEBARS: three STITCHes drop on bars tuned to degrees 0, 2 and 4: a chord
    const d = make();
    for (const [k, deg] of [[0, 0], [1, 2], [2, 4]] as const) {
      d.add('tonebars', [k * 0.12, 0, 0], { degree: deg });
      d.add('stitch', [k * 0.12, 0.3 + k * 0.15, 0]);
    }
    D.tonebars = d.done(240, { target: [0.12, 0.2, 0], dist: 1.4 });
  }
  {
    // DING: a STITCH drops on the bell's button: DING!
    const d = make();
    d.add('ding', [0, 0.035, 0]);
    d.add('stitch', [0, 0.4, 0]);
    D.ding = d.done(180, { target: [0, 0.15, 0], dist: 1.2 });
  }
  // ---- Future tech
  {
    // FABRICATOR: every 0.5 s it pops out a BOING, five in all
    const d = make();
    d.add('fabricator', [0, 0, 0], { part: 0, count: 5, interval: 0.5, speed: 1.5 });
    D.fabricator = d.done(360, { target: [0, 0.2, 0.5], dist: 2.4 });
  }
  {
    // RECYCLER: three STITCHes drop into the funnel and vanish; at its goal of 3 it sets off a BANGSTICK
    const d = make();
    const r = d.add('recycler', [0, 0, 0], { target: 3 });
    for (let k = 0; k < 3; k++) d.add('stitch', [-0.04 + k * 0.04, 0.4 + k * 0.2, 0.02 * (k - 1)]);
    const stick = d.add('bangstick', [0.6, 0.039, 0.3]);
    d.link('cable_signal', r, 'count', stick, 'detonator');
    D.recycler = d.done(300);
  }
  {
    // ZONE: a BOING inside an antigrav zone floats up; its twin outside stays on the floor
    const d = make();
    d.add('zone', [0, 0, 0], { mode: 1, width: 0.6, height: 1.2, depth: 0.6, strength: 0.5 });
    d.add('boing', [0, 0.12, 0]);
    d.add('boing', [0.6, 0.12, 0]);
    D.zone = d.done(240, { target: [0.3, 0.6, 0], dist: 2.4 });
  }
  return D;
}
