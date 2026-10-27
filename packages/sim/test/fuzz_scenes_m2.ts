// Property-fuzz scenes for the M2 parts (stream A, PART_SYSTEM §8): each builds a small scene that
// exercises the part under test (props `p`). Parts with properties get 20 random sets × 2 seeds; the
// others run their scene once per seed.

import { snappedEuler } from '@knockon/format';
import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

const down = snappedEuler(0, 0, -90);

export const M2_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  fuzz: (b) => {
    b.add('slope', 0, 0, 0, { angle: 45 });
    for (let k = 0; k < 4; k++) b.add('fuzz', 0.1 + k * 0.02, 0.5 + k * 0.1, k * 0.01);
    b.add('sprong', -0.7, 0, 0);
  },
  pig_iron: (b) => {
    b.add('slope', 0, 0, 0, { angle: 30 });
    b.add('pig_iron', 0.1, 0.5, 0);
    for (let row = 0; row < 3; row++) b.add('brik', -0.6, 0.05 + row * 0.1, 0);
    b.add('pig_iron', -0.6, 1.5, 0.02);
  },
  vortex: (b, p) => {
    b.add('vortex', 0, 0.5, 0, p);
    b.add('stitch', 0.15, 1.2, 0.05);
    b.add('fuzz', -0.1, 1.4, 0.1);
    b.add('boing', 0.05, 1.8, -0.1);
    b.add('thud', 0, 2.2, 0.02);
  },
  sprong: (b) => {
    b.add('sprong', 0, 0, 0);
    b.add('boing', 0, 2.5, 0);
    b.add('thud', 0.05, 1.5, 0);
    b.add('stitch', -0.05, 3, 0.02);
    b.add('helio', 0.1, 0.4, 0);
  },
  scoop: (b) => {
    const s = b.add('scoop', 0, 0, 0);
    const h1 = b.add('helio', 0, 0.62, 0);
    const h2 = b.add('helio', 0.05, 0.7, 0.05);
    b.link('line', h1, 'knot', s, 'bail');
    b.link('line', h2, 'knot', s, 'bail');
    b.add('stitch', 0, 1.5, 0);
    b.add('pig_iron', 0.3, 0.2, 0);
  },
  flap: (b, p) => {
    const flap = b.add('flap', 0, 0.5, -0.13, p);
    b.add('stitch', 0, 0.56, 0);
    b.add('thud', 0.02, 1.2, 0.05);
    const button = b.add('the_button', -0.5, 0, 0);
    b.add('boing', -0.5, 0.4, 0);
    b.link('cable_signal', button, 'out', flap, 'in');
  },
  dynamo: (b) => {
    const mains = b.add('mains', -0.9, 0, 0);
    const motor = b.add('motor', -0.5, 0, 0);
    const dyn = b.add('dynamo', 0, 0, 0.3);
    const lamp = b.add('lamp', 0.45, 0, 0.3);
    const m2 = b.add('motor', 0.45, 0, -0.3);
    b.add('cog', 0.9, 0.35, -0.3);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', dyn, 'in');
    b.link('cable_power', dyn, 'out', lamp, 'in');
    b.link('cable_power', dyn, 'out', m2, 'in');
  },
  turbine: (b) => {
    const mains = b.add('mains', -0.5, 0, -0.2);
    const fan = b.add('gale', 0, 0.13, 0);
    const t = b.add('turbine', 0, 0, 0.5, {}, snappedEuler(180, 0, 0));
    const dyn = b.add('dynamo', 0.5, 0, 0.5);
    const lamp = b.add('lamp', 0.9, 0, 0.5);
    b.link('cable_power', mains, 'out', fan, 'in');
    b.link('band', t, 'out', dyn, 'in');
    b.link('cable_power', dyn, 'out', lamp, 'in');
    b.add('boing', 0.03, 0.6, 0.5);
  },
  puffer: (b) => {
    b.add('puffer', 0, 0, 0);
    b.add('thud', -0.03, 0.8, 0);
    b.add('stitch', 0.3, 0.06, 0);
    b.add('wick', 0.6, 0, 0);
    b.add('turbine', 1.0, 0, 0, {}, snappedEuler(-90, 0, 0));
    b.add('boing', 0, 1.6, 0.02);
  },
  cell: (b, p) => {
    const cell = b.add('cell', 0, 0, 0, p);
    const lamp = b.add('lamp', 0.3, 0, 0);
    const motor = b.add('motor', -0.35, 0, 0);
    const motor2 = b.add('motor', -0.35, 0, 0.4);
    b.add('cog', 0.15, 0.35, 0.4);
    b.link('cable_power', cell, 'out', lamp, 'in');
    b.link('cable_power', cell, 'out', motor, 'in');
    b.link('cable_power', cell, 'out', motor2, 'in');
    b.add('boing', 0.02, 0.8, 0); // knocks the battery over
  },
  suncell: (b) => {
    const sun = b.add('suncell', 0, 0, 0);
    b.add('torch', -0.035, 0.5, 0, { on: 1 }, down);
    const motor = b.add('motor', 0.5, 0, 0);
    b.add('cog', 0.95, 0.35, 0);
    b.link('cable_power', sun, 'out', motor, 'in');
    b.add('stitch', 0, 1.0, 0.02); // drops through the beam onto the panel
  },
  lamp: (b) => {
    const mains = b.add('mains', -0.5, 0, 0);
    const lamp = b.add('lamp', 0, 0, 0);
    const sun = b.add('suncell', 0, 0, 0.25);
    const lamp2 = b.add('lamp', 0.4, 0, 0.25);
    b.link('cable_power', mains, 'out', lamp, 'in');
    b.link('cable_power', sun, 'out', lamp2, 'in');
    b.add('boing', 0, 0.8, 0.25);
  },
  torch: (b, p) => {
    const torch = b.add('torch', -0.035, 0.5, 0, p, down);
    const sun = b.add('suncell', 0, 0, 0);
    const lamp = b.add('lamp', 0.4, 0, 0);
    const button = b.add('the_button', -0.5, 0, 0);
    b.add('thud', -0.5, 0.4, 0);
    b.add('burning_glass', 0.3, 0, 0.3);
    b.link('cable_signal', button, 'out', torch, 'in');
    b.link('cable_power', sun, 'out', lamp, 'in');
  },
  burning_glass: (b, p) => {
    b.add('burning_glass', 0, 0, 0, p);
    b.add('torch', 0, 0.19, -0.3, { on: 1 }, snappedEuler(-90, 0, 0));
    const a = b.add('anchor', 0, 0, 0.425);
    const h = b.add('helio', 0, 0.245, 0.425);
    b.link('line', h, 'knot', a, 'hook');
    b.add('wick', 0, 0.05, 0.6, { lit: 0 });
    b.add('plank', 0.2, 0.25, 0.8);
  },
  toggle: (b, p) => {
    const mains = b.add('mains', -0.4, 0, 0);
    const tog = b.add('toggle', 0, 0, 0, p);
    const fan = b.add('gale', 0.4, 0, 0);
    const stick = b.add('bangstick', 0, 0.039, 0.8);
    b.add('stitch', -0.06, 0.5, 0);
    b.add('stitch', 0.06, 0.9, 0);
    b.link('cable_power', mains, 'out', tog, 'in');
    b.link('cable_power', tog, 'out_power', fan, 'in');
    b.link('cable_signal', tog, 'out_signal', stick, 'detonator');
  },
  ringer: (b, p) => {
    const ring = b.add('ringer', 0, 0, 0, p);
    const stick = b.add('bangstick', 0.6, 0.039, 0);
    const pl = b.add('punchline', -0.5, 0, 0.4);
    b.add('boing', -0.08, 0.12, 0.4);
    b.link('cable_signal', ring, 'out', stick, 'detonator');
    b.link('cable_signal', ring, 'out', pl, 'trigger');
  },
  delay: (b, p) => {
    const button = b.add('the_button', -0.4, 0, 0);
    b.add('thud', -0.4, 0.4, 0);
    const delay = b.add('delay', 0, 0, 0, p);
    const delay2 = b.add('delay', 0, 0, 0.3, p);
    const stick = b.add('bangstick', 0.6, 0.039, 0);
    const torch = b.add('torch', 0.6, 0, 0.4);
    b.link('cable_signal', button, 'out', delay, 'in');
    b.link('cable_signal', delay, 'out', stick, 'detonator');
    b.link('cable_signal', delay, 'out', delay2, 'in');
    b.link('cable_signal', delay2, 'out', torch, 'in');
  },
  t_plunger: (b) => {
    const tp = b.add('t_plunger', 0, 0, 0);
    b.add('thud', 0, 0.65, 0);
    for (let k = 0; k < 4; k++) b.link('cable_signal', tp, 'out', b.add('bangstick', -0.6 + k * 0.4, 0.039, 0.5), 'detonator');
    b.add('brik', 0, 0.05, 1.0);
  },
  skyrocket: (b, p) => {
    const wick = b.add('wick', 0.12, 0, 0.03);
    const r1 = b.add('skyrocket', 0, 0.12, 0, p);
    b.add('skyrocket', 0.4, 0.12, 0, p, snappedEuler(0, 0, 30));
    b.add('stitch', 0, 0.36, 0); // payload on the nose deck
    b.link('fuse', wick, 'flame', r1, 'fuse');
    b.add('helio', 0, 1.5, 0);
  },
  big_top: (b, p) => {
    const top = b.add('big_top', 0, 0, 0, p);
    b.add('boing', 0.1224, 0.216, 0);
    const wick = b.add('wick', -0.2, 0, 0.36);
    b.link('fuse', wick, 'flame', top, 'fuse');
    b.add('stitch', 0.25, 0.8, 0); // drops into the bell after the first shot
    b.add('bangstick', 0.6, 0.039, 0.4, { fuse: 0.5 });
  },
  cork_blaster: (b) => {
    b.add('ledge', 0, 0.25, 0);
    const cb = b.add('cork_blaster', 0, 0.3, 0);
    const button = b.add('the_button', -0.5, 0, 0);
    b.add('thud', -0.5, 0.4, 0);
    b.link('cable_signal', button, 'out', cb, 'fire');
    const cb2 = b.add('cork_blaster', 0, 0, 0.5);
    const balloon = b.add('helio', -0.13, 0.4, 0.5); // pulls the hook taut with ≈ 4.9 N: fires
    b.link('line', balloon, 'knot', cb2, 'pull');
    b.add('helio', 0.8, 0.36, 0);
    b.add('brik', 1.2, 0.05, 0.5);
  },
  punchline: (b) => {
    const pl = b.add('punchline', 0, 0, 0);
    const button = b.add('the_button', -0.5, 0, 0);
    b.add('thud', -0.5, 0.4, 0);
    b.add('thud', 0.45, 0.11, 0);
    b.add('brik', 0.66, 0.05, 0, {}, snappedEuler(90, 0, 0));
    b.link('cable_signal', button, 'out', pl, 'trigger');
  },
  gotcha_box: (b) => {
    const mains = b.add('mains', -0.8, 0, 0);
    const motor = b.add('motor', -0.4, 0, 0);
    const box = b.add('gotcha_box', 0, 0, 0);
    b.add('plank', 0, 0.5, 0.215, {}, snappedEuler(0, 90, 0));
    b.add('boing', 0, 0.5, 0); // sits on the lid when it pops
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', box, 'crank');
    b.add('gotcha_box', 0.6, 0, 0);
    b.add('thud', 0.6, 0.7, 0); // a whack pops the second one
  },
};
