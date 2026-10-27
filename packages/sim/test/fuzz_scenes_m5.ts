// Property-fuzz scenes for the M5 parts (stream A5, PART_SYSTEM §8): each builds a small scene that leans on the part under
// test (props `p`): crowds of bodies, steel and non-steel, heavy and tiny, switches on and off, blasts nearby. Parts with
// properties get 20 random sets × 2 seeds; HOVER PAD and SINGULARITY (no properties) run their scene once per seed
// (fuzz.test.ts).

import { snappedEuler } from '@knockon/format';
import { grabberZone, type Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

/** A BANGSTICK with a short fuse lit by a WICK: a yield-1 blast at ≈ 0.6 s. */
function blast(b: Build, x: number, z: number): void {
  const stick = b.add('bangstick', x, 0.039, z, { fuse: 0.5 });
  const wick = b.add('wick', x + 0.3, 0, z + 0.1);
  b.link('fuse', wick, 'flame', stick, 'fuse');
}

/** A MAINS wired to every part listed. */
function power(b: Build, ...parts: number[]): number {
  const mains = b.add('mains', -1.5, 0, -1.5);
  for (const p of parts) b.link('cable_power', mains, 'out', p, 'in');
  return mains;
}

export const M5_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  rift_gate: (b, p) => {
    b.add('rift_gate', 0, 0.025, 0.205, p, snappedEuler(0, -90, 0));
    b.add('rift_gate', 0.8, 0, 0, p, snappedEuler(90, 0, 0));
    b.add('rift_gate', -0.8, 0, 0, p); // a third of the colour: unpaired
    b.add('stitch', 0, 0.6, 0);
    b.add('pig_iron', 0.01, 0.9, 0.01);
    b.add('glint', -0.02, 1.1, 0);
    b.add('boing', 0, 1.6, 0); // wider than the aperture: lands on the ring
    b.add('thud', 0.02, 2.2, 0.02);
    blast(b, 0.4, -0.5);
  },
  grav_well: (b, p) => {
    const w1 = b.add('grav_well', 0, 0, 0, p);
    const w2 = b.add('grav_well', 0.7, 0, 0.3, { mode: 1 - (p.mode ?? 0) });
    power(b, w1, w2);
    for (let k = 0; k < 4; k++) b.add('glint', 0.25 + 0.05 * k, 0.008, -0.2);
    b.add('stitch', -0.3, 0.0375, 0.2);
    b.add('pig_iron', 0.4, 0.06, -0.5);
    b.add('boing', -0.5, 0.5, -0.3);
    b.add('helio', 0.2, 0.4, 0.4);
    blast(b, -0.8, 0.6);
  },
  tractor_beam: (b, p) => {
    const beam = b.add('tractor_beam', 0, 0, 0, p);
    power(b, beam);
    b.add('stitch', 0, 0.0375, 0.5);
    b.add('glint', 0.02, 0.008, 1.0);
    b.add('maglock', 0, 0, 1.6);
    b.add('fuzz', 0, 0.4, 2.2);
    b.add('boing', 0.03, 0.9, 0.8);
    blast(b, 0.6, 1.2);
  },
  hover_pad: (b) => {
    const pad = b.add('hover_pad', 0, 0, 0), pad2 = b.add('hover_pad', 0.6, 0, 0);
    const mains = power(b, pad, pad2);
    const r = b.add('ringer', -1, 0, 0.5, { time: 1.5 });
    b.link('cable_signal', r, 'out', mains, 'in');
    b.add('thud', 0, 0.161, 0);
    b.add('wrecker', 0.6, 1.0, 0); // 20 kg dropped on the second one
    b.add('glint', 0.05, 0.06, 0.1);
    blast(b, 0.3, -0.6);
  },
  force_wall: (b, p) => {
    const wall = b.add('force_wall', 0.2, 0, 0, p, snappedEuler(90, 0, 0));
    b.add('slope', 0.5, 0, 0, { angle: 30 });
    b.add('stitch', 0.7, 0.35, 0);
    b.add('pig_iron', 0.75, 0.45, 0.05);
    b.add('stitch', 0.2, 0.1, 0.05); // inside the field when it switches on
    b.add('boing', 0.21, 0.9, 0);
    const r1 = b.add('ringer', -0.5, 0, 0.5, { time: 1 }), r2 = b.add('ringer', -0.5, 0, -0.5, { time: 1.5 });
    b.link('cable_signal', r1, 'out', wall, 'toggle');
    b.link('cable_signal', r2, 'out', wall, 'toggle');
    blast(b, -0.4, 0.3);
  },
  coilgun_ring: (b, p) => {
    const ring = b.add('coilgun_ring', 0, 0.6, 0, p, snappedEuler(0, -90, 0));
    const ring2 = b.add('coilgun_ring', 0.6, 0, 0, p);
    power(b, ring, ring2);
    for (let k = 0; k < 5; k++) b.add('bearing', 0.01 * k, 1.4 + 0.15 * k, -0.1575);
    b.add('pig_iron', 0, 2.4, -0.1575);
    b.add('stitch', 0, 2.8, -0.15);
    b.add('wrecker', 0.6, 0.6, 0.4);
    b.add('boing', 0.62, 0.5, -0.3);
  },
  stasis_field: (b, p) => {
    const field = b.add('stasis_field', 0, 0, 0, p);
    const mains = power(b, field);
    const r = b.add('ringer', -1, 0, 0.6, { time: 1.5 });
    b.link('cable_signal', r, 'out', mains, 'in');
    b.add('boing', 0, 1.2, 0);
    b.add('stitch', 0.05, 0.9, 0.05);
    b.add('glint', -0.03, 0.7, 0);
    b.add('thud', 0.02, 1.6, -0.02);
    blast(b, 0.1, 0.1);
  },
  buzz_beacon: (b, p) => {
    const beacon = b.add('buzz_beacon', 0, 0, 0, p);
    const b1 = b.add('the_button', -0.4, 0, 0.3), b2 = b.add('the_button', 0.4, 0, 0.3);
    b.add('thud', -0.4, 0.2, 0.3);
    b.add('thud', 0.4, 0.8, 0.3);
    b.link('cable_signal', b1, 'out', beacon, 'call');
    b.link('cable_signal', b2, 'out', beacon, 'call');
    b.add('stitch', 0, 0.08, 0);
    b.add('boing', 0.02, 0.8, 0);
    blast(b, -0.5, -0.4);
  },
  singularity: (b) => {
    const s = b.add('singularity', 0, 0, 0);
    const button = b.add('the_button', -0.8, 0, 0.8);
    b.add('thud', -0.8, 0.2, 0.8);
    b.link('cable_signal', button, 'out', s, 'arm');
    const fab = b.add('fabricator', 1.5, 0, 0, { count: 5, interval: 0.3 });
    void fab;
    b.add('wrecker', -1.5, 0.1, 0);
    for (let k = 0; k < 6; k++) b.add('glint', 0.5 + 0.1 * k, 0.008, -0.6);
    b.add('brik', 0, 0.05, 1.2);
    b.add('plank', 0.8, 0.05, 0.8);
    b.add('helio', -0.4, 0.5, -0.4);
    b.add('pip', 0.9, 0.05, -0.2);
    blast(b, 0.4, 0.4);
  },
  grabber: (b, p) => {
    const arm = b.add('grabber', 0, 0, 0, p);
    power(b, arm);
    const a = grabberZone(p, 'a'), z = grabberZone(p, 'b');
    b.add('stitch', a[0], a[1] + 0.0375, a[2]);
    b.add('glint', z[0], z[1] + 0.008, z[2]);
    b.add('thud', 0.35, 0.11, 0.35);
    const button = b.add('the_button', -0.5, 0, 0.5);
    b.add('thud', -0.5, 0.2, 0.5);
    b.link('cable_signal', button, 'out', arm, 'go');
    blast(b, -0.6, -0.6);
  },
};
