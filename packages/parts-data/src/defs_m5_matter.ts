// M5 Matter part (stream X5 · Matter M5): GOO VAT, the one Ship = M5 part that touches grains (D102), built to its brief
// (docs/art/briefs/matter.md, GOO VAT) and E5a's art (assets/build/parts/goo_vat) in engine space: Y-up, metres, front =
// +Z. Spread into PARTS by defs.ts after PARTS_M5 (this file only type-imports defs.ts, like defs_m2.ts … defs_m5.ts).
//
// GOO VAT is a TANK for goo (Matter kind 3, SIMULATION §8.1): its contents are a quantity in plain sim state (st.m2.m4.q,
// goo particles), which become Matter goo only at the nozzle and come back through the lid hatch. Its behaviour is A4's
// dispenser (packages/sim/src/channels/m4_matter.ts), so it toggles, drains, refills, signals and shows its fill exactly
// as TANK does, with Matter off as well as on. Units: goo radius 8 mm, ≈ 2.13 mL, 470 per litre.
//
// Also here: the geometry and tuning the sim reads (GOO_VAT), its Library card and its demo machine.

import type { Card } from './cards.ts';
import type { PartDef, PortDef, Props, V3 } from './defs.ts';

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const C = { graphite: '#3A3E47', steel: '#A9AFB8', beam: '#2FD6FF', glass: '#CFE8F2', slime: '#7DFF7A', rubber: '#25272D' };
const sig = (name: string, at: V3): PortDef => ({ name, channel: 'signal', dir: 'in', at });

/** Goo particles per litre (SIMULATION §8.1) and the vat's capacity in litres. */
export const GOO_PER_LITRE = 470;

/**
 * GOO VAT (matter.md): spout (the EMIT__spout__nozzle point pushed 25 mm out along the nozzle's axis, so a lattice block
 * of goo clears the nozzle box: the brief's pass-through zone is ≤ 0.03 m), the nozzle axis (+Z tilted 30° down), the
 * duckbill lip area (40 × 12 mm: speed = flow / area, at least minSpeed), the emit jitter, the lid hatch intake
 * (SENSOR__intake__lid: r 0.035 at z −0.06, y 0.27–0.30, as a box) and the capacity (9 L of goo particles).
 */
export const GOO_VAT = {
  spout: [0, 0.0675, 0.1737] as V3, dir: [0, -0.5, 0.866025] as V3, lipArea: 4.8e-4, minSpeed: 0.3, spread: 0.01,
  intake: { min: [-0.035, 0.27, -0.095] as V3, max: [0.035, 0.3, -0.025] as V3 }, kind: 3, capacity: 9 * GOO_PER_LITRE, low: 0.1,
} as const;

export const PARTS_M5_MATTER: readonly PartDef[] = [
  {
    // Slime dispenser: each Signal on `open` toggles the valve; open, it drools its stored goo (9 L at most) as Matter goo
    // at `flow` L/s from the duckbill nozzle. Goo dropped into the lid hatch is absorbed back, up to full.
    type: 'goo_vat', family: 'matter', name: 'GOO VAT', tag: 'Slime dispenser', ship: 'M5', bounds: b([-0.141, 0, -0.147], [0.141, 0.3, 0.155]),
    body: { kind: 'static', mass: 6, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.28, 0.06, 0.28], at: [0, 0.03, 0] }, // plinth
      { kind: 'cylinder', size: [0.26, 0.23, 0.26], at: [0, 0.175, 0] }, // vat and lid ring
      { kind: 'box', size: [0.04, 0.044, 0.026], at: [0, 0.09, 0.138] }, // valve block and nozzle
    ],
    visuals: () => [
      { mesh: 'box', size: [0.28, 0.056, 0.28], at: [0, 0.032, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.26, 0.2, 0.26], at: [0, 0.16, 0], color: C.glass, rough: 0.05 },
      { mesh: 'cylinder', size: [0.245, 0.17, 0.245], at: [0, 0.148, 0], color: C.slime, rough: 0.15 },
      { mesh: 'cylinder', size: [0.26, 0.03, 0.26], at: [0, 0.275, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.06, 0.012, 0.06], at: [0, 0.294, 0], color: C.beam, rough: 0.35 },
      { mesh: 'box', size: [0.04, 0.044, 0.026], at: [0, 0.09, 0.138], color: C.beam, metal: 0.6, rough: 0.3 },
      { mesh: 'box', size: [0.04, 0.012, 0.02], at: [0, 0.075, 0.152], color: C.beam, metal: 0.6, rough: 0.3 },
      { mesh: 'cylinder', size: [0.012, 0.006, 0.012], at: [0.05, 0.276, 0.13], axis: 'z', color: C.beam, emissive: 1, when: 'lit' },
    ],
    ports: [sig('open', [0.075, 0.032, 0.14])],
    props: {
      flow: { type: 'float', min: 0.1, max: 1, step: 0.1, default: 0.3, label: 'Flow (L/s)' },
      start: { type: 'percent', min: 0, max: 100, step: 5, default: 100, label: 'Full at start (%)' },
      open: { type: 'bool', default: 0, label: 'Open at start' },
    },
    art: 'goo_vat', behaviours: ['matter_emitter'],
    // the world's Matter budget (packages/sim/src/matter/budget.ts): what it holds at the start, as goo particles
    matterGrains: (p: Props) => Math.round((GOO_VAT.capacity * (p.start ?? 100)) / 100),
  } as PartDef & { matterGrains: (p: Props) => number },
];

/** Types with X5 Matter behaviour (GOO VAT, through A4's dispenser in channels/m4_matter.ts). */
export const M5_MATTER_TYPES: ReadonlySet<string> = new Set(PARTS_M5_MATTER.map((p) => p.type));
/** Matter containers among them: their stored quantity is `fill` (0–1) in Machine.partFill (the fill pass). */
export const M5_MATTER_CONTAINERS: ReadonlySet<string> = new Set(['goo_vat']);

// ---- Library card (PART_SYSTEM §6) --------------------------------------------------------------------------------

export const CARDS_M5_MATTER: Readonly<Record<string, Card>> = {
  goo_vat: {
    needs: 'A signal on its valve (each one opens or closes it)',
    does: 'Drools sticky green goo from its nozzle; goo dropped in the lid refills it',
    tips: ['9 L when full. Set the flow from 0.1 to 1 L/s.', 'Goo sticks to what it touches and slows rolling balls.'],
  },
};

// ---- demo machine (PART_SYSTEM §6; the per-part golden) -------------------------------------------------------------

export interface DemoBuilderM5Matter<M> {
  add(type: string, at: V3, props?: Readonly<Record<string, number>>): number;
  link(kind: 'cable_signal', from: number, fromPort: string, to: number, toPort: string): number;
  done(ticks: number, cam?: Partial<{ target: readonly [number, number, number]; dist: number; yaw: number; pitch: number }>): M;
}

/** GOO VAT's demo machine (≤ 30 parts, ≤ 3 s), merged into DEMOS by demos.ts. */
export function m5MatterDemos<M>(make: () => DemoBuilderM5Matter<M>): Record<string, M> {
  const D: Record<string, M> = {};
  {
    // GOO VAT: open from the start, it drools a rope of goo into a puddle in front of its nozzle; a STITCH rolling down
    // the slope across the puddle is caught and slowed by the goo
    const d = make();
    d.add('goo_vat', [0, 0, 0], { flow: 1, start: 20, open: 1 });
    d.add('slope', [0.5, 0, 0.3], { angle: 20 });
    d.add('stitch', [0.7, 0.22, 0.3]);
    D.goo_vat = d.done(360, { target: [0.15, 0.1, 0.25], dist: 1.6 });
  }
  return D;
}
