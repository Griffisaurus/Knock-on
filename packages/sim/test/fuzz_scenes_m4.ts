// Property-fuzz scenes for the M4 parts (stream A4, PART_SYSTEM §8): each builds a small scene that exercises the part
// under test (props `p`). Parts with properties get 20 random sets × 2 seeds; the others run their scene once per seed
// (fuzz.test.ts). Scenes lean on the part: signals on and off, blasts nearby, heavy balls, crowds. They run with Matter
// gameplay off (m4_matter.test.ts runs a Matter-on property sweep with MX's CPU backend).

import { snappedEuler } from '@knockon/format';
import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

/** A THUD dropped from `h` on a BUTTON wired to `to`'s `port`: a signal at ≈ √(2h/g) s. */
function press(b: Build, to: number, port: string, x = -0.8, z = 0.6, h = 0.2): void {
  const button = b.add('the_button', x, 0, z);
  b.add('thud', x, h, z);
  b.link('cable_signal', button, 'out', to, port);
}

/** A BANGSTICK with a short fuse lit by a WICK: a yield-1 blast at ≈ 0.6 s. */
function blast(b: Build, x: number, z: number): void {
  const stick = b.add('bangstick', x, 0.039, z, { fuse: 0.5 });
  const wick = b.add('wick', x + 0.3, 0, z + 0.1);
  b.link('fuse', wick, 'flame', stick, 'fuse');
}

export const M4_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  grit_hopper: (b, p) => {
    const hop = b.add('grit_hopper', 0, 0, 0, p);
    press(b, hop, 'open');
    press(b, hop, 'open', 0.8, 0.6, 1.2); // closes it again
    b.add('boing', 0.05, 0.6, 0.02);
    blast(b, 0.6, -0.4);
  },
  hourglass: (b, p) => {
    const hg = b.add('hourglass', 0, 0, 0, p);
    const stick = b.add('bangstick', 0.5, 0.039, 0.3);
    b.link('cable_signal', hg, 'out', stick, 'detonator');
    b.add('hourglass', 0.2, 0.05, -0.2, p, snappedEuler(0, 90, 0)); // on its side: paused
    b.add('hourglass', -0.3, 0, 0.2, p, snappedEuler(0, 180, 0)); // upside down: flipped from the start
    b.add('thud', 0.02, 0.6, 0.01); // knocks the first one over
  },
  tank: (b, p) => {
    const tank = b.add('tank', 0, 0, 0, p);
    press(b, tank, 'open');
    b.add('thud', 0.02, 0.8, 0.01);
    b.add('stitch', 0, 0.3, 0.4);
    blast(b, -0.6, -0.4);
  },
  sprinkle_can: (b, p) => {
    b.add('sprinkle_can', 0, 0, 0, p);
    b.add('stitch', -0.1, 0.6, 0);
    b.add('thud', -0.05, 0.9, 0.01);
    b.add('boing', 0.2, 0.5, 0);
  },
  waterwheel: (b) => {
    const mains = b.add('mains', -0.8, 0, -0.4);
    const motor = b.add('motor', -0.5, 0, 0.4);
    b.add('waterwheel', 0, 0.2, 0);
    b.add('stitch', 0.05, 0.6, 0);
    b.add('thud', -0.1, 0.9, 0.02);
    b.link('cable_power', mains, 'out', motor, 'in');
  },
  sponge: (b, p) => {
    b.add('sponge', 0, 0.05, 0, p);
    b.add('thud', 0, 0.5, 0);
    b.add('sponge', 0.3, 0.05, 0, p);
    b.add('stitch', 0.3, 0.6, 0);
    blast(b, 0.7, 0.4);
  },
  marble_hopper: (b, p) => {
    const hop = b.add('marble_hopper', 0, 0, 0, p);
    press(b, hop, 'open');
    b.add('thud', 0, 0.8, 0);
    blast(b, 0.6, -0.4);
  },
  blowout: (b) => {
    const mains = b.add('mains', -0.5, 0, -0.3);
    const dryer = b.add('blowout', 0, 0, 0);
    for (let k = 0; k < 6; k++) b.add('glint', 0.2 + k * 0.03, 0.15, 0);
    b.add('helio', 0.6, 0.2, 0);
    b.add('fuzz', 0.3, 0.0325, 0);
    const wick = b.add('wick', 0.5, 0, 0.3, { lit: 0 });
    const turbine = b.add('turbine', 1.0, 0, 0, {}, snappedEuler(90, 0, 0));
    void wick; void turbine;
    b.link('cable_power', mains, 'out', dryer, 'in');
  },
  vac: (b) => {
    const mains = b.add('mains', -0.4, 0, -0.4);
    const vac = b.add('vac', 0, 0, 0);
    for (let k = 0; k < 5; k++) b.add('glint', -0.04 + k * 0.02, 0.008, 0.3 + k * 0.03);
    b.add('fuzz', 0, 0.0325, 0.4);
    b.add('thud', 0, 0.11, 0.6);
    press(b, mains, 'in', 0.6, -0.4, 1.0); // power off at ≈ 0.45 s: everything held drops
    b.link('cable_power', mains, 'out', vac, 'in');
  },
  inflator: (b) => {
    const inf = b.add('inflator', 0, 0, 0);
    b.add('helio', 0.08, 0.285 + 0.172, 0.02 - 0.006);
    press(b, inf, 'in');
    press(b, inf, 'in', -0.8, -0.6, 0.8);
    const inf2 = b.add('inflator', 0.6, 0, 0); // no balloon: the valve just hisses
    press(b, inf2, 'in', 0.6, 0.6);
    blast(b, -0.6, 0.0);
  },
  arc_tower: (b) => {
    const mains = b.add('mains', -0.5, 0, -0.3);
    const tower = b.add('arc_tower', 0, 0, 0);
    b.add('pig_iron', 0.45, 0.06, 0);
    for (let k = 0; k < 4; k++) b.add('bearing', -0.3 + k * 0.02, 0.008, 0.3);
    b.add('helio', 0.3, 0.3, 0.3);
    const stick = b.add('bangstick', 0.6, 0.039, 0.3);
    void stick;
    b.link('cable_power', mains, 'out', tower, 'in');
  },
  toast_cannon: (b, p) => {
    const mains = b.add('mains', -0.4, 0, -0.2);
    const toaster = b.add('toast_cannon', 0, 0, 0, p);
    b.link('cable_power', mains, 'out', toaster, 'in');
    press(b, mains, 'in', -0.8, 0.6, 0.6); // off and on again: another cycle
    press(b, mains, 'in', 0.8, 0.6, 1.4);
    b.add('ledge', 0, 0.5, 0); // slices hit the shelf
  },
  yolk: (b) => {
    for (let k = 0; k < 6; k++) b.add('yolk', (k % 3) * 0.06, 0.04 + Math.floor(k / 3) * 0.7, 0);
    b.add('thud', 0.06, 1.2, 0.01);
    blast(b, 0.5, 0.3);
  },
  zippy: (b, p) => {
    const car = b.add('zippy', 0, 0.036, 0, p);
    press(b, car, 'go');
    press(b, car, 'go', -0.8, -0.6, 1.0);
    const scoop = b.add('scoop', -0.45, 0, 0);
    b.add('brik', 0.6, 0.05, 0, {}, snappedEuler(90, 0, 0));
    b.add('zippy', 0.3, 0.2, 0.3, p); // dropped: lands, maybe flipped
    b.link('line', car, 'tow', scoop, 'bail');
  },
  quack: (b) => {
    for (let k = 0; k < 4; k++) b.add('quack', k * 0.1, 0.2 + k * 0.15, 0);
    b.add('thud', 0.1, 0.9, 0.01);
    b.add('stitch', 0.2, 1.2, 0);
    blast(b, 0.6, 0.4);
  },
};
