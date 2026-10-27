// M4 part definitions (stream A4 · M4 parts): the 15 Ship = M4 rows of GAME_SPEC §12, built to their briefs
// (docs/art/briefs/{matter,air,power_signal,contraptions,rollers,fun}.md) in engine space: Y-up, metres, front = +Z
// (Blender (x, y, z) → engine (x, z, −y)). Spread into PARTS by defs.ts, which this file only type-imports (like
// defs_m2.ts / defs_m3.ts). Collision is the blockout until each part's `.shapes.json` lands. Behaviours live in
// packages/sim/src/channels/m4*.ts.
//
// Also here: the geometry and tuning constants the sim reads (one block per part), the M4 Library cards (CARDS_M4)
// and the M4 demo machines (m4Demos, merged into DEMOS by demos.ts).
//
// Matter parts keep their contents as a quantity (particles, grains or marbles) in plain sim state; grains become
// Matter particles only at the spout (matter.md). Units: water 1 mL per particle, sand Ø 4 mm grains, marbles Ø 16 mm.

import { dcos, dsin } from '@knockon/detmath';
import type { LinkKind } from '../../format/src/model.ts';
import { snappedEuler, type Rotation } from '../../format/src/quantize.ts';
import type { Card } from './cards.ts';
import type { PartDef, PortDef, ShapeDef, V3, VisualDef } from './defs.ts';

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const bottom = (s: V3): PartDef['bounds'] => b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]);

// Palette (ART_BIBLE §3.1), as in defs.ts / defs_m2.ts / defs_m3.ts.
const C = {
  ignition: '#FF5B2E', graphite: '#3A3E47', bone: '#E8E2D6', steel: '#A9AFB8', volt: '#C6F432', beam: '#2FD6FF',
  amber: '#FFB020', cobalt: '#2E5BFF', rubber: '#25272D', copper: '#B8742E', glass: '#CFE8F2', brass: '#C9A23A',
  plasma: '#FF3DAE', chrome: '#D8DDE3', tan: '#D9C29A', sand: '#D8C08A', water: '#7FC8F0', toast: '#D9A35A', duck: '#FFB020',
};

const sig = (name: string, at: V3, dir: PortDef['dir'] = 'in'): PortDef => ({ name, channel: 'signal', dir, at });
const pow = (name: string, at: V3): PortDef => ({ name, channel: 'power', dir: 'in', at });

/** Matter material ids (M4_PLAN contract 1: MatterKind). */
export const MATTER_KIND = { sand: 0, water: 1, marble: 2 } as const;

// ---- shared geometry and tuning (the sim channels read these) ------------------------------------------------------

/** A box in part space (intake sensors). */
export interface LocalBox { readonly min: V3; readonly max: V3 }

/**
 * Matter containers (matter.md): spout (emit point, part space, ≤ 0.03 m past the outlet), spout direction, intake box,
 * the Matter kind, and the quantity units. `perSecond` props are converted to whole particles per second.
 */
export const GRIT_HOPPER = {
  spout: [0, 0.066, 0] as V3, dir: [0, -1, 0] as V3, speed: 0.3, spread: 0.012,
  intake: { min: [-0.13, 0.37, -0.13], max: [0.13, 0.4, 0.13] } as LocalBox, kind: MATTER_KIND.sand, low: 0.1,
} as const;
export const TANK = {
  spout: [0, 0.062, 0.178] as V3, dir: [0, -0.2588, 0.9659] as V3, pipeArea: 7.07e-4, minSpeed: 0.5, spread: 0.008,
  intake: { min: [-0.06, 0.37, -0.06], max: [0.06, 0.4, 0.06] } as LocalBox, kind: MATTER_KIND.water, capacity: 15000, low: 0.1,
} as const;
export const MARBLE_HOPPER = {
  spout: [0, 0.047, 0.172] as V3, dir: [0, -0.342, 0.9397] as V3, speed: 0.6, spread: 0.004,
  intake: { min: [-0.045, 0.385, -0.045], max: [0.045, 0.415, 0.045] } as LocalBox, kind: MATTER_KIND.marble, low: 0.1,
} as const;
/** SPRINKLE CAN: tilt hinge (dips the +X spout), detent, pour stop (45°: at the brief's 60° the rose would dig into the floor), rose (on the can, unrotated pose), rate, intake. */
export const SPRINKLE = {
  hinge: [-0.02, 0.07, 0] as V3, detent: 20, stop: 45, kickJ: 0.3, rose: [0.15, 0.15, 0] as V3, roseDir: [0.906, 0.423, 0] as V3,
  speed: 0.8, spread: 0.02, rate: 250, capacity: 2000, canMass: 0.5,
  intake: { min: [-0.12, 0.14, -0.05], max: [-0.06, 0.17, 0.05] } as LocalBox, kind: MATTER_KIND.water,
} as const;
/** SPONGE: dry mass, capacity (mL → +1 g each), squeeze thresholds, release rate, intake box (12 mm proud: a water particle's centre can't come within its 6.2 mm radius of the skin, so the brief's 5 mm never caught any). */
export const SPONGE = {
  dry: 0.05, capacity: 2000, squeezeKg: 5, squeezeJ: 2, rate: 1000, hitS: 0.25, quietS: 0.5,
  intake: { min: [-0.112, -0.062, -0.062], max: [0.112, 0.062, 0.062] } as LocalBox, kind: MATTER_KIND.water,
  ends: [[0.108, -0.02, 0], [-0.108, -0.02, 0]] as readonly V3[], speed: 0.6,
} as const;
/** WATERWHEEL: 5 L-section buckets (a tangential plate at r 0.145 and a radial lip), wheel mass, hub height. */
export const WATERWHEEL = { buckets: 5, rIn: 0.145, rOut: 0.195, width: 0.1, plate: 0.005, mass: 1.2 } as const;
/** HOURGLASS: flow pauses between 70° and 110° of tilt; past 110° the bulbs swap roles (matter.md). */
export const HOURGLASS = { pauseCos: 0.342, neck: [0, 0.1, 0] as V3 } as const;

/** BLOWOUT (air.md, SIMULATION §5.8): nozzle, +X axis, 2 m / 10° wind and heat cone, heater warm-up. */
export const BLOWOUT = { nozzle: [0.1, 0.15, 0] as V3, R: 2, halfDeg: 10, strength: 9, warmS: 0.5 } as const;
/** VAC: mouth, +Z axis, 1.5 m / 20° inverted cone, hold reach and mass limit. */
export const VAC = { mouth: [0, 0.052, 0.15] as V3, R: 1.5, halfDeg: 20, strength: 9, holdKg: 0.5, reach: 0.02 } as const;
/** INFLATOR: filler nozzle (a Helio's knot seats here), valve time, fill rate, pop threshold, seat capture distance. */
export const INFLATOR = { nozzle: [0.08, 0.285, 0.02] as V3, valveS: 2, rate: 0.5, popAt: 1.1, seat: 0.06, overAt: 1.0 } as const;
/** ARC TOWER (SIMULATION §5.7): toroid centre, breakout spike, charge, strike period, range, strike heat. */
export const ARC_TOWER = { toroid: [0, 0.42, 0] as V3, spike: [0, 0.5, 0] as V3, chargeS: 0.5, everyS: 0.25, range: 2, heatR: 0.03, heatS: 0.1, dB: 85, needF: 0.75 } as const;
/** TOAST CANNON: slot exits (slice centres at launch), launch speed, toast time, pool size, power threshold. */
export const TOAST = { slots: [[0, 0.216, 0.022], [0, 0.216, -0.022]] as readonly V3[], speed: 3, toastS: 3, pool: 6, needF: 0.75 } as const;
/** YOLK (rollers.md): break impulse; also the pooled egg HENNY lays (B4 reserves a pool through `yolkPool`). */
export const YOLK = {
  breakJ: 0.3, mass: 0.055, friction: 0.5, restitution: 0.15,
  /** Egg profile: blunt end up (+Y) and pointed end down, origin at the centre of mass (2 mm toward the blunt end). */
  shapes: [
    { kind: 'sphere', size: [0.045, 0.045, 0.045], at: [0, 0.0055, 0] },
    { kind: 'sphere', size: [0.034, 0.034, 0.034], at: [0, -0.015, 0] },
  ] as readonly ShapeDef[],
} as const;
/** ZIPPY (fun.md): wheels (part space, at rest), suspension, engine and drive tuning, front bumper sensor. */
export const ZIPPY = {
  wheels: [[0.065, -0.005, -0.0375], [0.065, -0.005, 0.0375], [-0.065, -0.005, -0.0375], [-0.065, -0.005, 0.0375]] as readonly V3[],
  wheelR: 0.03, wheelW: 0.022, suspMin: 0.004, suspMax: 0.016, springHz: 4, damping: 0.6,
  bumperX: 0.06, bumpJ: 0.1, stallS: 0.5, maxTorque: 0.6, brake: 0.2,
} as const;
/** QUACK: squeeze thresholds (impact or sustained load), cooldown. */
export const QUACK = { squeakJ: 0.06, squeakKg: 0.3, coolS: 0.15 } as const;

// ---- blockout helpers --------------------------------------------------------------------------------------------

/** WATERWHEEL bucket k: a tangential floor plate at r 0.145 and a radial lip on its descending (+X when on top) side. */
function bucketShapes(): { shapes: ShapeDef[]; visuals: VisualDef[] } {
  const W = WATERWHEEL, shapes: ShapeDef[] = [], visuals: VisualDef[] = [];
  const half = 18; // half the bucket's arc, degrees
  for (let k = 0; k < W.buckets; k++) {
    const th = 90 + (360 / W.buckets) * k;
    const t = (th * Math.PI) / 180;
    const chord = 2 * W.rIn * dsin((half * Math.PI) / 180);
    // floor: tangential at the inner radius, centred on the bucket's angle
    const fl: V3 = [W.rIn * dcos(t), W.rIn * dsin(t), 0];
    shapes.push({ kind: 'box', size: [chord, W.plate, W.width], at: fl, tiltZ: th - 90, on: 'arm' });
    visuals.push({ mesh: 'box', size: [chord, W.plate, W.width], at: fl, tiltZ: th - 90, color: C.glass, rough: 0.1, on: 'arm' });
    // lip: radial at the bucket's clockwise edge, from r 0.145 to 0.195
    const tl = ((th - half) * Math.PI) / 180, rm = (W.rIn + W.rOut) / 2;
    const lp: V3 = [rm * dcos(tl), rm * dsin(tl), 0];
    shapes.push({ kind: 'box', size: [W.plate, W.rOut - W.rIn, W.width], at: lp, tiltZ: th - half - 90, on: 'arm' });
    visuals.push({ mesh: 'box', size: [W.plate, W.rOut - W.rIn, W.width], at: lp, tiltZ: th - half - 90, color: C.glass, rough: 0.1, on: 'arm' });
  }
  return { shapes, visuals };
}
const BUCKETS = bucketShapes();

const legs = (y0: number, y1: number, at: number, s: number): VisualDef[] => [-1, 1].flatMap((x) => [-1, 1].map((z): VisualDef => (
  { mesh: 'box', size: [s, y1 - y0, s], at: [x * at, (y0 + y1) / 2, z * at], color: C.graphite, rough: 0.45 })));

export const PARTS_M4: readonly PartDef[] = [
  // ---- Matter -----------------------------------------------------------------------------------------------------
  {
    // Sand dispenser: a clear square bin on legs, funnelling to a slide-gate. Each Signal on `open` toggles the gate; open,
    // it pours its stored grains as Matter sand at `rate`. Grains landing in the top grille are absorbed back (refill).
    type: 'grit_hopper', family: 'matter', name: 'GRIT HOPPER', tag: 'Sand dispenser', ship: 'M4', bounds: bottom([0.3, 0.4, 0.3]),
    body: { kind: 'static', mass: 4, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      ...[-1, 1].flatMap((x) => [-1, 1].map((z): ShapeDef => ({ kind: 'box', size: [0.025, 0.196, 0.025], at: [x * 0.125, 0.102, z * 0.125] }))),
      { kind: 'box', size: [0.28, 0.25, 0.28], at: [0, 0.245, 0] }, // bin (its top is the grille, under the intake)
      { kind: 'box', size: [0.28, 0.03, 0.01], at: [0, 0.385, 0.135] },
      { kind: 'box', size: [0.28, 0.03, 0.01], at: [0, 0.385, -0.135] },
      { kind: 'box', size: [0.01, 0.03, 0.26], at: [0.135, 0.385, 0] },
      { kind: 'box', size: [0.01, 0.03, 0.26], at: [-0.135, 0.385, 0] },
      { kind: 'box', size: [0.05, 0.04, 0.05], at: [0, 0.1, 0] }, // funnel neck
      { kind: 'box', size: [0.09, 0.06, 0.03], at: [0, 0.11, 0.031] }, // gate housing
    ],
    visuals: () => [
      ...legs(0.004, 0.2, 0.125, 0.025),
      { mesh: 'box', size: [0.28, 0.185, 0.28], at: [0, 0.2925, 0], color: C.glass, rough: 0.08 },
      { mesh: 'box', size: [0.29, 0.015, 0.29], at: [0, 0.3925, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.2, 0.08, 0.2], at: [0, 0.16, 0], color: C.glass, rough: 0.08 },
      { mesh: 'box', size: [0.05, 0.04, 0.05], at: [0, 0.1, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.09, 0.06, 0.03], at: [0, 0.11, 0.031], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.26, 0.12, 0.26], at: [0, 0.25, 0], color: C.sand, rough: 0.9 },
      { mesh: 'cylinder', size: [0.016, 0.006, 0.016], at: [0.03, 0.143, 0.031], color: C.beam, emissive: 1, when: 'lit' },
    ],
    ports: [sig('open', [0, 0.11, 0.046])],
    props: {
      capacity: { type: 'float', min: 50000, max: 1000000, step: 50000, default: 200000, label: 'Capacity (grains)' },
      rate: { type: 'float', min: 1000, max: 50000, step: 1000, default: 20000, label: 'Rate (grains/s)' },
      start: { type: 'percent', min: 0, max: 100, step: 5, default: 100, label: 'Full at start (%)' },
      open: { type: 'bool', default: 0, label: 'Open at start' },
    },
    art: 'grit_hopper', behaviours: ['matter_emitter'],
  },
  {
    // Sand timer: a fill-pass display, not Matter grains (D93). The top bulb drains over `duration`; when it empties it
    // pulses `out`. Tipped 70–110° the flow pauses; past 110° the bulbs swap roles and the remaining time carries over.
    type: 'hourglass', family: 'matter', name: 'HOURGLASS', tag: 'Sand timer', ship: 'M4', bounds: bottom([0.1, 0.2, 0.1]),
    body: { kind: 'dynamic', mass: 0.5, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.1, 0.022, 0.1], at: [0, 0.011, 0] },
      { kind: 'box', size: [0.1, 0.022, 0.1], at: [0, 0.189, 0] },
      { kind: 'cylinder', size: [0.075, 0.156, 0.075], at: [0, 0.1, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.1, 0.018, 0.1], at: [0, 0.013, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.1, 0.018, 0.1], at: [0, 0.187, 0], color: C.bone, rough: 0.5 },
      { mesh: 'sphere', size: [0.075, 0.078, 0.075], at: [0, 0.061, 0], color: C.glass, rough: 0.05 },
      { mesh: 'sphere', size: [0.075, 0.078, 0.075], at: [0, 0.139, 0], color: C.glass, rough: 0.05 },
      ...[90, 210, 330].map((a): VisualDef => ({ mesh: 'cylinder', size: [0.01, 0.156, 0.01], at: [0.044 * dcos((a * Math.PI) / 180), 0.1, -0.044 * dsin((a * Math.PI) / 180)], color: C.beam, rough: 0.3 })),
      { mesh: 'cylinder', size: [0.016, 0.01, 0.016], at: [0, 0.1, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.0015, 0.07, 0.0015], at: [0, 0.065, 0], color: C.sand, rough: 0.9, when: 'lit' },
    ],
    ports: [sig('out', [0, 0.1, 0.032], 'out')],
    props: { duration: { type: 'seconds', min: 1, max: 120, step: 1, default: 10, label: 'Duration' } },
    art: 'hourglass', behaviours: ['rigid_basic', 'timer'],
  },
  {
    // Water tank and valve: each Signal on `open` toggles the valve; open, it pours its stored water (15 L at most) as
    // Matter water at `flow` L/s from the spout. Water poured into the funnel at the top is absorbed back, up to full.
    type: 'tank', family: 'matter', name: 'TANK', tag: 'Water tank', ship: 'M4', bounds: b([-0.15, 0, -0.15], [0.15, 0.4, 0.17]),
    body: { kind: 'static', mass: 5, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'cylinder', size: [0.28, 0.054, 0.28], at: [0, 0.027, 0] },
      { kind: 'cylinder', size: [0.26, 0.316, 0.26], at: [0, 0.212, 0] }, // the tank (its cap rim is below, the funnel opening above)
      { kind: 'box', size: [0.26, 0.03, 0.07], at: [0, 0.385, 0.095] },
      { kind: 'box', size: [0.26, 0.03, 0.07], at: [0, 0.385, -0.095] },
      { kind: 'box', size: [0.07, 0.03, 0.12], at: [0.095, 0.385, 0] },
      { kind: 'box', size: [0.07, 0.03, 0.12], at: [-0.095, 0.385, 0] },
      { kind: 'box', size: [0.04, 0.05, 0.03], at: [0, 0.08, 0.14] }, // valve body
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.28, 0.05, 0.28], at: [0, 0.029, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.26, 0.316, 0.26], at: [0, 0.212, 0], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.25, 0.2, 0.25], at: [0, 0.16, 0], color: C.water, rough: 0.05 },
      { mesh: 'cylinder', size: [0.264, 0.012, 0.264], at: [0, 0.12, 0], color: C.beam, rough: 0.35 },
      { mesh: 'cylinder', size: [0.264, 0.012, 0.264], at: [0, 0.29, 0], color: C.beam, rough: 0.35 },
      { mesh: 'cylinder', size: [0.26, 0.03, 0.26], at: [0, 0.385, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.04, 0.05, 0.03], at: [0, 0.08, 0.14], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.03, 0.03, 0.03], axis: 'z', at: [0, 0.065, 0.152], color: C.beam, rough: 0.35 },
      { mesh: 'cylinder', size: [0.06, 0.008, 0.06], at: [0, 0.109, 0.14], color: C.beam, metal: 0.6, rough: 0.3 },
      { mesh: 'cylinder', size: [0.014, 0.006, 0.014], at: [-0.035, 0.11, 0.155], color: C.beam, emissive: 1, when: 'lit' },
    ],
    ports: [sig('open', [0.04, 0.029, 0.122])],
    props: {
      flow: { type: 'float', min: 0.1, max: 2, step: 0.1, default: 0.5, label: 'Flow (L/s)' },
      start: { type: 'percent', min: 0, max: 100, step: 5, default: 100, label: 'Full at start (%)' },
      open: { type: 'bool', default: 0, label: 'Open at start' },
    },
    art: 'tank', behaviours: ['matter_emitter'],
  },
  {
    // Tipping watering can on a cradle: a knock (0.3 N·s) or a push past 20° tips it onto its 45° pour stop, where it
    // latches and sprinkles its stored water (2 L) from the rose at 0.25 L/s while the level reaches the spout.
    type: 'sprinkle_can', family: 'matter', name: 'SPRINKLE CAN', tag: 'Watering can', ship: 'M4', bounds: b([-0.15, 0, -0.1], [0.165, 0.2, 0.1]),
    body: { kind: 'static', mass: 0.8, friction: 0.5, restitution: 0.2, material: 'powder' },
    hinge: { at: SPRINKLE.hinge, axis: [0, 0, -1], limits: [0, SPRINKLE.stop], armMass: SPRINKLE.canMass },
    shapes: () => [
      // the cradle collides as two rails under the yokes (a full plate would stop the can's front edge as it tips)
      { kind: 'box', size: [0.16, 0.02, 0.014], at: [0, 0.01, 0.088] },
      { kind: 'box', size: [0.16, 0.02, 0.014], at: [0, 0.01, -0.088] },
      { kind: 'box', size: [0.04, 0.05, 0.007], at: [-0.02, 0.045, 0.0885] },
      { kind: 'box', size: [0.04, 0.05, 0.007], at: [-0.02, 0.045, -0.0885] },
      { kind: 'box', size: [0.16, 0.12, 0.14], at: [-0.06, 0.085, 0], on: 'arm' },
      { kind: 'box', size: [0.14, 0.02, 0.02], at: [0.08, 0.12, 0], tiltZ: 25, on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.16, 0.02, 0.18], at: [0, 0.01, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.04, 0.05, 0.007], at: [-0.02, 0.045, 0.0885], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.04, 0.05, 0.007], at: [-0.02, 0.045, -0.0885], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.16, 0.12, 0.14], at: [-0.06, 0.085, 0], color: C.glass, rough: 0.05, on: 'arm' },
      { mesh: 'box', size: [0.15, 0.07, 0.13], at: [-0.06, 0.065, 0], color: C.water, rough: 0.05, on: 'arm' },
      { mesh: 'box', size: [0.14, 0.02, 0.02], at: [0.08, 0.12, 0], tiltZ: 25, color: C.beam, rough: 0.35, on: 'arm' },
      { mesh: 'cylinder', size: [0.04, 0.01, 0.04], axis: 'x', at: [0.145, 0.15, 0], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
      { mesh: 'box', size: [0.1, 0.01, 0.012], at: [-0.06, 0.19, 0], color: C.beam, rough: 0.35, on: 'arm' },
    ],
    ports: [],
    props: { start: { type: 'percent', min: 0, max: 100, step: 5, default: 100, label: 'Full at start (%)' } },
    art: 'sprinkle_can', behaviours: ['hinged', 'matter_emitter'],
  },
  {
    // Bucket wheel: 5 clear L-section buckets on a free axle. Matter water poured over it fills the buckets on one side
    // and turns it (the particles push the bucket plates; nothing here computes a force). The axle drives `axle` (BAND).
    type: 'waterwheel', family: 'matter', name: 'WATERWHEEL', tag: 'Bucket wheel', ship: 'M4', bounds: b([-0.2, -0.2, -0.1], [0.2, 0.2, 0.1]),
    body: { kind: 'static', mass: 2.5, friction: 0.5, restitution: 0.2, material: 'powder' },
    hinge: { at: [0, 0, 0], axis: [0, 0, 1], armMass: WATERWHEEL.mass },
    shapes: () => [
      { kind: 'box', size: [0.3, 0.2, 0.012], at: [0, -0.1, 0.091] },
      { kind: 'box', size: [0.3, 0.2, 0.012], at: [0, -0.1, -0.091] },
      ...BUCKETS.shapes,
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.02, 0.012], at: [0, -0.19, 0.091], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.3, 0.02, 0.012], at: [0, -0.19, -0.091], color: C.bone, rough: 0.5 },
      ...[-1, 1].flatMap((s) => [0.091, -0.091].map((z): VisualDef => ({ mesh: 'box', size: [0.024, 0.25, 0.012], at: [s * 0.075, -0.1, z], tiltZ: s * 36.87, color: C.bone, rough: 0.5 }))),
      { mesh: 'cylinder', size: [0.016, 0.2, 0.016], axis: 'z', color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.06, 0.12, 0.06], axis: 'z', color: C.bone, rough: 0.5, on: 'arm' },
      { mesh: 'cylinder', size: [0.36, 0.006, 0.36], axis: 'z', at: [0, 0, 0.05], color: C.beam, rough: 0.35, on: 'arm' },
      { mesh: 'cylinder', size: [0.36, 0.006, 0.36], axis: 'z', at: [0, 0, -0.05], color: C.beam, rough: 0.35, on: 'arm' },
      ...BUCKETS.visuals,
    ],
    ports: [{ name: 'axle', channel: 'spin', dir: 'out', at: [0, 0, 0.1], kind: 'axle' }],
    props: {}, art: 'waterwheel', behaviours: ['rotator_driven'],
  },
  {
    // Foam block: soaks up Matter water through its skin (mass = 0.05 kg dry + 1 g per mL, up to 2 kg of water) and
    // releases it at 1 L/s when squashed (≥ 5 kg resting on it, or a ≥ 2 N·s hit).
    type: 'sponge', family: 'matter', name: 'SPONGE', tag: 'Absorbing foam', ship: 'M4', bounds: b([-0.1, -0.05, -0.05], [0.1, 0.05, 0.05]),
    body: { kind: 'dynamic', mass: SPONGE.dry, friction: 0.9, restitution: 0.05, material: 'rubber' },
    shapes: () => [{ kind: 'box', size: [0.2, 0.1, 0.1] }],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.085, 0.1], at: [0, -0.0075, 0], color: '#F1E6C4', rough: 0.9 },
      { mesh: 'box', size: [0.2, 0.015, 0.1], at: [0, 0.0425, 0], color: C.beam, rough: 0.9 },
      { mesh: 'box', size: [0.202, 0.06, 0.102], at: [0, -0.02, 0], color: '#B9A77C', rough: 0.6, when: 'lit' },
    ],
    ports: [],
    props: { start: { type: 'percent', min: 0, max: 100, step: 5, default: 0, label: 'Soaked at start (%)' } },
    art: 'sponge', behaviours: ['rigid_basic', 'matter_emitter'],
  },
  {
    // Gumball-style marble dispenser: each Signal on `open` toggles dispensing; open, it pours its stored marbles (up to
    // 100k) as Matter marbles at `rate` per second from the chute. Marbles dropped into the lid hatch are absorbed back.
    type: 'marble_hopper', family: 'matter', name: 'MARBLE HOPPER', tag: 'Marble dispenser', ship: 'M4', bounds: bottom([0.3, 0.4, 0.3]),
    body: { kind: 'static', mass: 6, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.26, 0.15, 0.26], at: [0, 0.075, 0] },
      { kind: 'sphere', size: [0.26, 0.26, 0.26], at: [0, 0.27, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.26, 0.15, 0.26], at: [0, 0.075, 0], color: C.bone, rough: 0.5 },
      { mesh: 'sphere', size: [0.26, 0.26, 0.26], at: [0, 0.27, 0], color: C.glass, rough: 0.05 },
      { mesh: 'sphere', size: [0.22, 0.16, 0.22], at: [0, 0.23, 0], color: C.chrome, rough: 0.15, metal: 0.6 },
      { mesh: 'cylinder', size: [0.12, 0.012, 0.12], at: [0, 0.145, 0], color: C.beam, rough: 0.35 },
      { mesh: 'cylinder', size: [0.1, 0.02, 0.1], at: [0, 0.395, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.05, 0.03, 0.06], at: [0, 0.055, 0.135], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.064, 0.02, 0.004], at: [0, 0.135, 0.131], color: '#101318', rough: 0.3 },
      { mesh: 'cylinder', size: [0.014, 0.006, 0.014], at: [0.05, 0.135, 0.131], axis: 'z', color: C.beam, emissive: 1, when: 'lit' },
    ],
    ports: [sig('open', [0.07, 0.075, 0.115])],
    props: {
      capacity: { type: 'float', min: 100, max: 100000, step: 100, default: 2000, label: 'Capacity (marbles)' },
      rate: { type: 'float', min: 10, max: 1000, step: 10, default: 400, label: 'Rate (marbles/s)' },
      start: { type: 'percent', min: 0, max: 100, step: 5, default: 100, label: 'Full at start (%)' },
      open: { type: 'bool', default: 0, label: 'Open at start' },
    },
    art: 'marble_hopper', behaviours: ['matter_emitter'],
  },
  // ---- Air --------------------------------------------------------------------------------------------------------
  {
    // Hot-air blower: powered (80 W), a 2 m / 10° wind cone along +X pushes light things, and after 0.5 s of warm-up the
    // same cone is hot: it pops balloons, lights fuses and wicks, and burns ropes.
    type: 'blowout', family: 'air', name: 'BLOWOUT', tag: 'Hot-air blower', ship: 'M4', bounds: bottom([0.2, 0.2, 0.1]),
    body: { kind: 'static', mass: 0.9, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.12, 0.045, 0.09], at: [0, 0.0225, 0] },
      { kind: 'box', size: [0.035, 0.09, 0.04], at: [-0.02, 0.09, 0], tiltZ: 10 },
      { kind: 'cylinder', size: [0.085, 0.135, 0.085], axis: 'x', at: [-0.0225, 0.15, 0] },
      { kind: 'box', size: [0.055, 0.03, 0.07], at: [0.0725, 0.15, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.12, 0.045, 0.09], at: [0, 0.0225, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.035, 0.09, 0.04], at: [-0.02, 0.09, 0], tiltZ: 10, color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.085, 0.135, 0.085], axis: 'x', at: [-0.0225, 0.15, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.055, 0.03, 0.07], at: [0.0725, 0.15, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.04, 0.02, 0.087], at: [-0.02, 0.15, 0], color: C.amber, rough: 0.2, emissive: 0.2 },
      { mesh: 'box', size: [0.036, 0.016, 0.088], at: [-0.02, 0.15, 0], color: C.copper, emissive: 1, when: 'lit' },
      { mesh: 'cylinder', size: [0.012, 0.004, 0.012], at: [-0.03, 0.137, 0], color: C.volt, emissive: 0.8, when: 'powered' },
    ],
    ports: [pow('in', [0, 0.027, 0.046])],
    props: {}, art: 'blowout', behaviours: ['air_emitter', 'power_consumer'], power: { consumer: 80 },
  },
  {
    // Suction nozzle: powered (90 W), a 1.5 m / 20° inverted cone pulls light things toward its mouth (+Z); anything up
    // to 0.5 kg that reaches the mouth is held on the grille until the power stops.
    type: 'vac', family: 'air', name: 'VAC', tag: 'Suction nozzle', ship: 'M4', bounds: bottom([0.1, 0.1, 0.3]),
    body: { kind: 'static', mass: 1.1, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'cylinder', size: [0.08, 0.265, 0.08], axis: 'z', at: [0, 0.052, -0.0175] },
      { kind: 'cylinder', size: [0.094, 0.035, 0.094], axis: 'z', at: [0, 0.052, 0.1325] },
      { kind: 'box', size: [0.07, 0.014, 0.22], at: [0, 0.007, -0.03] },
      { kind: 'box', size: [0.03, 0.01, 0.03], at: [0, 0.095, -0.08] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.08, 0.18, 0.08], axis: 'z', at: [0, 0.052, -0.06], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.078, 0.06, 0.078], axis: 'z', at: [0, 0.052, 0.08], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.094, 0.035, 0.094], axis: 'z', at: [0, 0.052, 0.1325], color: C.beam, rough: 0.35 },
      { mesh: 'cylinder', size: [0.07, 0.004, 0.07], axis: 'z', at: [0, 0.052, 0.137], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.07, 0.014, 0.22], at: [0, 0.007, -0.03], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.084, 0.004, 0.084], axis: 'z', at: [0, 0.052, 0.147], color: C.beam, emissive: 1, when: 'powered' },
    ],
    ports: [{ name: 'in', channel: 'power', dir: 'in', at: [0, 0.095, -0.08] }],
    props: {}, art: 'vac', behaviours: ['air_emitter', 'power_consumer'], power: { consumer: 90 },
  },
  {
    // Toy helium tank: a Helio whose knot sits on the filler nozzle (or joined by a `fill` link) starts empty. Each Signal
    // opens the valve for 2 s, filling it at 50 %/s (its lift follows the fill); past 110 % it pops.
    type: 'inflator', family: 'air', name: 'INFLATOR', tag: 'Helium tank', ship: 'M4', bounds: bottom([0.2, 0.3, 0.2]),
    body: { kind: 'static', mass: 2.4, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [
      { kind: 'cylinder', size: [0.17, 0.036, 0.17], at: [0, 0.018, 0] },
      { kind: 'cylinder', size: [0.13, 0.225, 0.13], at: [0, 0.1325, 0] },
      { kind: 'box', size: [0.04, 0.025, 0.04], at: [0, 0.2575, 0] },
      { kind: 'box', size: [0.03, 0.02, 0.02], at: [0.07, 0.27, 0.02] },
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.17, 0.036, 0.17], at: [0, 0.018, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.13, 0.225, 0.13], at: [0, 0.1325, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.134, 0.025, 0.134], at: [0, 0.2025, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.04, 0.025, 0.04], at: [0, 0.2575, 0], color: C.brass, metal: 0.8, rough: 0.3 },
      { mesh: 'cylinder', size: [0.012, 0.03, 0.012], at: [0.08, 0.27, 0.02], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.04, 0.01, 0.04], axis: 'z', at: [0, 0.2, 0.067], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.008, 0.004, 0.008], axis: 'z', at: [0, 0.26, 0.022], color: C.beam, emissive: 1, when: 'lit' },
      { mesh: 'cylinder', size: [0.008, 0.004, 0.008], axis: 'z', at: [0.015, 0.26, 0.022], color: C.amber, emissive: 1, when: 'pressed' },
    ],
    ports: [sig('in', [0, 0.019, 0.086]), { name: 'fill', channel: 'air', dir: 'out', at: [...INFLATOR.nozzle] as unknown as V3 }],
    props: {}, art: 'inflator', behaviours: ['inflator'],
  },
  // ---- Power and signal -------------------------------------------------------------------------------------------
  {
    // Tesla coil: powered at ≥ 75 % of its 400 W, it charges for 0.5 s, then strikes the nearest steel part within 2 m of
    // its toroid every 0.25 s: each strike is a brief heat spot on the target and an 85 dB crack. No push.
    type: 'arc_tower', family: 'power', name: 'ARC TOWER', tag: 'Tesla coil', ship: 'M4', bounds: bottom([0.2, 0.5, 0.2]),
    body: { kind: 'static', mass: 6, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.095, 0.2], at: [0, 0.0525, 0] },
      { kind: 'cylinder', size: [0.07, 0.286, 0.07], at: [0, 0.247, 0] },
      { kind: 'cylinder', size: [0.2, 0.06, 0.2], at: [0, 0.42, 0] },
      { kind: 'capsule', size: [0.02, 0.06, 0.02], at: [0, 0.47, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.095, 0.2], at: [0, 0.0525, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.202, 0.014, 0.202], at: [0, 0.084, 0], color: C.amber, rough: 0.5 },
      { mesh: 'cylinder', size: [0.16, 0.004, 0.16], at: [0, 0.102, 0], color: C.copper, metal: 0.8, rough: 0.35 },
      { mesh: 'cylinder', size: [0.07, 0.286, 0.07], at: [0, 0.247, 0], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.05, 0.27, 0.05], at: [0, 0.247, 0], color: C.copper, metal: 0.8, rough: 0.4 },
      { mesh: 'cylinder', size: [0.2, 0.06, 0.2], at: [0, 0.42, 0], color: C.steel, metal: 1, rough: 0.25 },
      { mesh: 'cylinder', size: [0.02, 0.06, 0.02], at: [0, 0.47, 0], color: C.chrome, metal: 1, rough: 0.1 },
      { mesh: 'cylinder', size: [0.075, 0.01, 0.075], at: [0, 0.11, 0], color: C.volt, emissive: 0.8, when: 'powered' },
      { mesh: 'sphere', size: [0.03, 0.03, 0.03], at: [0, 0.5, 0], color: '#F4F0FF', emissive: 1, when: 'lit' },
    ],
    ports: [pow('in', [0, 0.045, 0.101])],
    props: {}, art: 'arc_tower', behaviours: ['power_consumer', 'heat_source'], power: { consumer: 400 },
  },
  // ---- Contraptions -----------------------------------------------------------------------------------------------
  {
    // Launching toaster: each rising power edge (≥ 75 % of its 200 W) starts a toast (3 s by default: the browning dial); then it pops two slices up at
    // 3 m/s with a ding. Slices are a pre-built pool of 6 (D66): a fourth cycle reuses the oldest two.
    type: 'toast_cannon', family: 'contraptions', name: 'TOAST CANNON', tag: 'Launching toaster', ship: 'M4', bounds: b([-0.1, 0, -0.05], [0.1, 0.184, 0.07]), // z to 0.07: the lever knob (E4a's build) stands proud of the 0.05 front
    body: { kind: 'static', mass: 1.5, friction: 0.5, restitution: 0.25, material: 'powder' },
    piece: { shapes: [{ kind: 'box', size: [0.09, 0.1, 0.012] }], mass: 0.03, friction: 0.6, restitution: 0.1 },
    shapes: () => [{ kind: 'box', size: [0.19, 0.16, 0.095], at: [0, 0.084, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.19, 0.16, 0.095], at: [0, 0.084, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.06, 0.07, 0.004], at: [0.015, 0.095, 0.048], color: C.amber, rough: 0.2, emissive: 0.15 },
      { mesh: 'box', size: [0.03, 0.015, 0.02], at: [0.075, 0.13, 0.052], color: C.ignition, rough: 0.4 },
      { mesh: 'cylinder', size: [0.02, 0.01, 0.02], axis: 'z', at: [-0.06, 0.1, 0.05], color: C.ignition, rough: 0.4 },
      { mesh: 'box', size: [0.09, 0.02, 0.012], at: [0, 0.174, 0.022], color: C.toast, rough: 0.8 },
      { mesh: 'box', size: [0.09, 0.02, 0.012], at: [0, 0.174, -0.022], color: C.toast, rough: 0.8 },
      { mesh: 'box', size: [0.05, 0.06, 0.003], at: [0.015, 0.095, 0.049], color: C.copper, emissive: 1, when: 'lit' },
      { mesh: 'box', size: [0.09, 0.1, 0.012], color: C.toast, rough: 0.8, on: 'piece' },
    ],
    ports: [pow('in', [-0.06, 0.045, 0.048])],
    props: { toast: { type: 'seconds', min: 1, max: 5, step: 0.5, default: TOAST.toastS, label: 'Toast time (browning dial)' } },
    art: 'toast_cannon', behaviours: ['power_consumer', 'launcher'], power: { consumer: 200 },
  },
  // ---- Rollers ----------------------------------------------------------------------------------------------------
  {
    // Egg: a fragile Roller. Any single contact of 0.3 N·s or more splats it (it leaves play; the splat decal and shell
    // bits are Spectacle). HENNY lays these from a pre-built pool (YOLK, yolkPool).
    type: 'yolk', family: 'rollers', name: 'YOLK', tag: 'Egg', ship: 'M4', bounds: b([-0.0225, -0.032, -0.0225], [0.0225, 0.028, 0.0225]),
    body: { kind: 'dynamic', mass: YOLK.mass, friction: YOLK.friction, restitution: YOLK.restitution, material: 'ceramic' },
    shapes: () => YOLK.shapes,
    visuals: () => [
      { mesh: 'sphere', size: [0.045, 0.045, 0.045], at: [0, 0.0055, 0], color: C.tan, rough: 0.6 },
      { mesh: 'sphere', size: [0.036, 0.04, 0.036], at: [0, -0.012, 0], color: C.tan, rough: 0.6 },
    ],
    ports: [], props: {}, art: 'yolk', behaviours: ['rigid_basic', 'breakable'],
  },
  // ---- Fun --------------------------------------------------------------------------------------------------------
  {
    // RC buggy: a Signal on `go` starts it driving forward (+X) at `speed`; another stops it. A bump on its nose
    // (≥ 0.1 N·s) stops it, reverses it, or is ignored (`bump`). Its rear hook tows a LINE. A Jolt wheeled vehicle.
    type: 'zippy', family: 'fun', name: 'ZIPPY', tag: 'RC buggy', ship: 'M4', bounds: b([-0.1, -0.035, -0.05], [0.1, 0.065, 0.05]),
    body: { kind: 'dynamic', mass: 0.8, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.18, 0.04, 0.07], at: [0, 0.005, 0] },
      { kind: 'box', size: [0.14, 0.03, 0.075], at: [0, 0.03, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.18, 0.04, 0.07], at: [0, 0.005, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.14, 0.03, 0.075], at: [0, 0.03, 0], color: C.ignition, rough: 0.35 },
      ...ZIPPY.wheels.map((w): VisualDef => ({ mesh: 'cylinder', size: [0.06, 0.022, 0.06], axis: 'z', at: w, color: C.rubber, rough: 0.8 })),
      { mesh: 'cylinder', size: [0.0015, 0.05, 0.0015], at: [-0.06, 0.04, -0.025], color: C.graphite, rough: 0.4 },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [-0.06, 0.062, -0.025], color: C.ignition, rough: 0.35 },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [0.098, 0.012, 0.025], color: '#FFF6D8', emissive: 1, when: 'lit' },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [0.098, 0.012, -0.025], color: '#FFF6D8', emissive: 1, when: 'lit' },
    ],
    ports: [sig('go', [0.01, 0.046, 0]), { name: 'tow', channel: 'tension', dir: 'both', at: [-0.1, 0, 0], kind: 'hook' }],
    props: {
      speed: { type: 'float', min: 0.2, max: 3, step: 0.1, default: 1, label: 'Top speed (m/s)' },
      bump: { type: 'enum', values: ['Stop', 'Reverse', 'Ignore'], default: 0, label: 'On a bump' },
      start: { type: 'bool', default: 0, label: 'Drive at start' },
    },
    art: 'zippy', behaviours: ['vehicle'],
  },
  {
    // Rubber duck: floats upright in Matter water by its own buoyancy (the particles do it) and squeaks when squeezed,
    // landed on or bonked. The squeak is cosmetic: no Sound event, so it never startles critters.
    type: 'quack', family: 'fun', name: 'QUACK', tag: 'Rubber duck', ship: 'M4', bounds: b([-0.041, -0.028, -0.05], [0.041, 0.065, 0.064]),
    // X5 (M5): a weighted keel (body.com): the centre of mass sits 10 mm below the shapes' own (at y −6 mm), toward the
    // hull's bottom, so QUACK floats upright and rights itself from any landing (the D101 session found it floating inverted)
    body: { kind: 'dynamic', mass: 0.04, friction: 0.7, restitution: 0.55, material: 'latex', com: [0, -0.01, 0] },
    shapes: () => [
      { kind: 'box', size: [0.082, 0.052, 0.094], at: [0, -0.002, -0.002] },
      { kind: 'sphere', size: [0.05, 0.05, 0.05], at: [0, 0.04, 0.02] },
    ],
    visuals: () => [
      { mesh: 'sphere', size: [0.082, 0.052, 0.098], at: [0, -0.002, -0.002], color: C.duck, rough: 0.25 },
      { mesh: 'sphere', size: [0.05, 0.05, 0.05], at: [0, 0.04, 0.02], color: C.duck, rough: 0.25 },
      { mesh: 'box', size: [0.03, 0.008, 0.022], at: [0, 0.034, 0.052], color: C.ignition, rough: 0.3 },
      { mesh: 'sphere', size: [0.012, 0.012, 0.012], at: [0.018, 0.05, 0.04], color: C.graphite, rough: 0.2 },
      { mesh: 'sphere', size: [0.012, 0.012, 0.012], at: [-0.018, 0.05, 0.04], color: C.graphite, rough: 0.2 },
    ],
    ports: [], props: {}, art: 'quack', behaviours: ['rigid_basic', 'buoyant'],
  },
];

/** Types with M4 sim behaviour (packages/sim/src/channels/m4*.ts). */
export const M4_TYPES: ReadonlySet<string> = new Set(PARTS_M4.map((p) => p.type));
/** Matter containers: their stored quantity is `fill` (0–1) in Machine.partFill (R4's fill pass). */
export const M4_CONTAINERS: ReadonlySet<string> = new Set(['grit_hopper', 'tank', 'sprinkle_can', 'sponge', 'marble_hopper', 'hourglass']);

// ---- Library cards (PART_SYSTEM §6) -------------------------------------------------------------------------------

export const CARDS_M4: Readonly<Record<string, Card>> = {
  grit_hopper: { needs: 'A signal on its gate (each one opens or closes it)', does: 'Pours a stream of sand from its bin; sand dropped in the top refills it', tips: ['Set the capacity from 50k to 1M grains.', 'Big pours need a bigger graphics tier.'] },
  hourglass: { needs: 'Nothing: it starts running at once', does: 'A sand timer: signals when the top bulb runs out; flip it to run again', tips: ['Set the time from 1 to 120 s.', 'Lay it on its side to pause it.'] },
  tank: { needs: 'A signal on its valve (each one opens or closes it)', does: 'Pours water from its spout; water poured in the top refills it', tips: ['15 L when full.', 'Set the flow from 0.1 to 2 L/s.'] },
  sprinkle_can: { needs: 'A knock on its back, or a push', does: 'Tips onto its stop and sprinkles water from the rose until it’s empty', tips: ['Aim the rose: it pours along +X.', 'Refill it through the hole at the back.'] },
  waterwheel: { needs: 'Water poured over its buckets', does: 'Turns as its buckets fill on one side; its axle drives a BAND', tips: ['Pour just past the top, on the side you want it to turn.'] },
  sponge: { needs: 'Water to soak up', does: 'Soaks up water and gets heavy (up to 2 kg); squash it and it gushes out', tips: ['Drop a THUD on it to squeeze it.'] },
  marble_hopper: { needs: 'A signal on its feed (each one starts or stops it)', does: 'Rattles marbles out of its chute; marbles dropped in the lid refill it', tips: ['Up to 100k marbles.', 'Set the rate from 10 to 1,000 a second.'] },
  blowout: { needs: 'Power (80 W)', does: 'A hot-air blower: pushes light things and pops, lights or burns what’s in its jet', tips: ['Its hot air reaches 2 m.', 'It takes half a second to heat up.'] },
  vac: { needs: 'Power (90 W)', does: 'Sucks light things toward its mouth and holds them there until unplugged', tips: ['It holds up to 0.5 kg.', 'Cut the power to drop what it holds.'] },
  inflator: { needs: 'A HELIO on its nozzle, and a signal', does: 'Each signal fills the balloon on its nozzle; one too many and it pops', tips: ['One signal fills an empty HELIO.', 'Signal again once it’s full and it pops.'] },
  arc_tower: { needs: 'Power (400 W, at 75 % or more)', does: 'A Tesla coil: zaps the nearest steel within 2 m with hot sparks', tips: ['Each zap is loud enough to startle critters.', 'Sparks light fuses touching the steel.'] },
  toast_cannon: { needs: 'Power (200 W): each time it switches on', does: 'Toasts for 3 s, then pops two slices up into the air', tips: ['Switch it off and on for another round.'] },
  yolk: { needs: 'Nothing: just don’t drop it', does: 'An egg: a hard knock (0.3 N·s) splats it', tips: ['HENNY lays these.'] },
  zippy: { needs: 'A signal on its roof (start and stop)', does: 'A toy RC car: drives straight along +X and tows a LINE from its hook', tips: ['Set what a bump does: stop, reverse or ignore.', 'Pair it with a PING Rx for wireless driving.'] },
  quack: { needs: 'Nothing: drop it in water', does: 'A rubber duck: floats upright and squeaks when squeezed', tips: ['Its squeak never startles critters.'] },
};

// ---- demo machines (PART_SYSTEM §6; the per-part goldens) ---------------------------------------------------------

export interface DemoBuilderM4<M> {
  /** `flags`: PartRecord flags (32 = anchored). */
  add(type: string, at: V3, props?: Readonly<Record<string, number>>, rot?: Rotation, flags?: number): number;
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number;
  path(kind: LinkKind, pts: readonly V3[]): number;
  done(ticks: number, cam?: Partial<{ target: readonly [number, number, number]; dist: number; yaw: number; pitch: number }>): M;
}

/** A HELIO seated on an INFLATOR at `at` (its knot on the filler nozzle). */
export function helioOnInflator(at: V3): V3 {
  return [at[0] + INFLATOR.nozzle[0], at[1] + INFLATOR.nozzle[1] + 0.172, at[2] + INFLATOR.nozzle[2] - 0.006];
}

/** The M4 parts' demo machines (≤ 30 parts, ≤ 3 s), merged into DEMOS by demos.ts. */
export function m4Demos<M>(make: () => DemoBuilderM4<M>): Record<string, M> {
  const D: Record<string, M> = {};
  // ---- Matter
  {
    // GRIT HOPPER: a THUD on THE BUTTON opens the gate; sand pours from the outlet into a pile under the bin
    const d = make();
    const hop = d.add('grit_hopper', [0, 0, 0], { capacity: 50000, rate: 5000, start: 5 });
    const button = d.add('the_button', [-0.4, 0, 0.3]);
    d.add('thud', [-0.4, 0.2, 0.3]);
    d.link('cable_signal', button, 'out', hop, 'open');
    D.grit_hopper = d.done(360, { target: [0, 0.2, 0], dist: 1.6 });
  }
  {
    // HOURGLASS: a 2 s timer runs out and sets off a BANGSTICK
    const d = make();
    const hg = d.add('hourglass', [0, 0, 0], { duration: 2 });
    const stick = d.add('bangstick', [0.5, 0.039, 0.3]);
    d.link('cable_signal', hg, 'out', stick, 'detonator');
    D.hourglass = d.done(360, { target: [0.2, 0.1, 0.1], dist: 1.4 });
  }
  {
    // TANK: a THUD on THE BUTTON opens the valve; water pours from the spout across the floor
    const d = make();
    const tank = d.add('tank', [0, 0, 0], { flow: 1, start: 20 });
    const button = d.add('the_button', [-0.4, 0, 0.3]);
    d.add('thud', [-0.4, 0.2, 0.3]);
    d.link('cable_signal', button, 'out', tank, 'open');
    D.tank = d.done(360, { target: [0, 0.2, 0.2], dist: 1.6 });
  }
  {
    // SPRINKLE CAN: a STITCH drops on its back; the knock tips it onto its stop and it sprinkles
    const d = make();
    d.add('sprinkle_can', [0, 0, 0], { start: 50 });
    d.add('stitch', [-0.1, 0.6, 0]);
    D.sprinkle_can = d.done(360, { target: [0, 0.15, 0], dist: 1.6 });
  }
  {
    // WATERWHEEL: a TANK on a LEDGE pours over its top buckets and turns it
    const d = make();
    const tank = d.add('tank', [0.06, 0.38, -0.3], { flow: 1, start: 10 });
    d.add('ledge', [0.06, 0.33, -0.3]);
    d.add('waterwheel', [0, 0.2, 0]);
    const button = d.add('the_button', [-0.5, 0, 0.3]);
    d.add('thud', [-0.5, 0.2, 0.3]);
    d.link('cable_signal', button, 'out', tank, 'open');
    D.waterwheel = d.done(360, { target: [0, 0.3, 0], dist: 1.8 });
  }
  {
    // SPONGE: a soaked sponge is squashed by a falling THUD and gushes water
    const d = make();
    d.add('sponge', [0, 0.05, 0], { start: 100 });
    d.add('thud', [0, 0.5, 0]);
    D.sponge = d.done(300, { target: [0, 0.1, 0], dist: 1.2 });
  }
  {
    // MARBLE HOPPER: a THUD on THE BUTTON starts the feed; marbles rattle out of the chute
    const d = make();
    const hop = d.add('marble_hopper', [0, 0, 0], { capacity: 2000, rate: 400, start: 25 });
    const button = d.add('the_button', [-0.4, 0, 0.3]);
    d.add('thud', [-0.4, 0.2, 0.3]);
    d.link('cable_signal', button, 'out', hop, 'open');
    D.marble_hopper = d.done(360, { target: [0, 0.2, 0.3], dist: 1.6 });
  }
  // ---- Air
  {
    // BLOWOUT: powered, its jet pushes a tethered HELIO downwind, then the hot air pops it
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.3]);
    const dryer = d.add('blowout', [0, 0, 0]);
    const hook = d.add('anchor', [0.6, 0, 0]);
    const h = d.add('helio', [0.6, 0.18, 0]);
    d.link('cable_power', mains, 'out', dryer, 'in');
    d.link('line', h, 'knot', hook, 'hook');
    D.blowout = d.done(300, { target: [0.3, 0.15, 0], dist: 1.6 });
  }
  {
    // VAC: powered, it sucks a FUZZ in from the floor and holds it on its mouth
    const d = make();
    const mains = d.add('mains', [-0.4, 0, -0.4]);
    const vac = d.add('vac', [0, 0, 0]);
    d.add('fuzz', [0, 0.0325, 0.35]);
    d.link('cable_power', mains, 'out', vac, 'in');
    D.vac = d.done(300, { target: [0, 0.05, 0.2], dist: 1.2 });
  }
  {
    // INFLATOR: THE BUTTON opens the valve and the empty HELIO on the nozzle fills; a second press over-fills it: pop
    const d = make();
    const inf = d.add('inflator', [0, 0, 0]);
    d.add('helio', helioOnInflator([0, 0, 0]));
    const b1 = d.add('the_button', [-0.4, 0, 0.3]);
    d.add('thud', [-0.4, 0.2, 0.3]);
    const b2 = d.add('the_button', [-0.4, 0, -0.3]);
    d.add('thud', [-0.4, 3.0, -0.3]);
    d.link('cable_signal', b1, 'out', inf, 'in');
    d.link('cable_signal', b2, 'out', inf, 'in');
    D.inflator = d.done(360, { target: [0, 0.4, 0], dist: 1.6 });
  }
  // ---- Power and signal
  {
    // ARC TOWER: powered, it zaps the PIG IRON (not the nearer STITCH); the sparks pop a HELIO tethered by the ball
    const d = make();
    const mains = d.add('mains', [-0.5, 0, -0.3]);
    const tower = d.add('arc_tower', [0, 0, 0]);
    d.add('pig_iron', [0.45, 0.06, 0]);
    d.add('stitch', [-0.3, 0.0375, 0.1]);
    const hook = d.add('anchor', [0.306, 0, 0.006]);
    const h = d.add('helio', [0.306, 0.196, 0]);
    d.link('cable_power', mains, 'out', tower, 'in');
    d.link('line', h, 'knot', hook, 'hook');
    D.arc_tower = d.done(240, { target: [0.2, 0.3, 0], dist: 1.8 });
  }
  // ---- Contraptions
  {
    // TOAST CANNON: MAINS on, 1.5 s of toasting (the browning dial), then two slices pop up
    const d = make();
    const mains = d.add('mains', [-0.4, 0, -0.2]);
    const toaster = d.add('toast_cannon', [0, 0, 0], { toast: 1.5 });
    d.link('cable_power', mains, 'out', toaster, 'in');
    D.toast_cannon = d.done(360, { target: [0, 0.3, 0], dist: 1.4 });
  }
  // ---- Rollers
  {
    // YOLK: an egg dropped from 2 m splats on the floor; the one resting beside it stays whole
    const d = make();
    d.add('yolk', [0, 2.0, 0]);
    d.add('yolk', [0.3, 0.032, 0]);
    D.yolk = d.done(240, { target: [0.15, 0.6, 0], dist: 2.4 });
  }
  // ---- Fun
  {
    // ZIPPY: THE BUTTON sends it off; it tows a SCOOP on a LINE and stops when it bumps a BRIK
    const d = make();
    const car = d.add('zippy', [0, 0.036, 0], { speed: 1 });
    const button = d.add('the_button', [-0.3, 0, 0.3]);
    d.add('thud', [-0.3, 0.2, 0.3]);
    const scoop = d.add('scoop', [-0.45, 0, 0]);
    d.add('brik', [1.2, 0.05, 0], {}, snappedEuler(90, 0, 0));
    d.link('cable_signal', button, 'out', car, 'go');
    d.link('line', car, 'tow', scoop, 'bail');
    D.zippy = d.done(360, { target: [0.5, 0.1, 0], dist: 2 });
  }
  {
    // QUACK: a duck dropped on the floor squeaks, then a STITCH bonks it and it squeaks again (X5, M5: the STITCH starts at
    // 1.2 m, was 0.8: with QUACK's keel its bounce changed and the bonk fell inside the 0.15 s squeak cooldown)
    const d = make();
    d.add('quack', [0, 0.3, 0]);
    d.add('stitch', [0.01, 1.2, 0]);
    D.quack = d.done(240, { target: [0, 0.1, 0], dist: 1 });
  }
  return D;
}
