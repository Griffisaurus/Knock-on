// Property-fuzz scenes for the M3 parts (stream A3, PART_SYSTEM §8): each builds a small scene that exercises the
// part under test (props `p`). Parts with properties get 20 random sets × 2 seeds; the others run their scene once
// per seed (fuzz.test.ts). Scenes lean on the part: blasts nearby, signals, heavy balls, crowds of marbles.

import { makeId, metresToPos, snappedEuler } from '@knockon/format';
import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

let pathN = 0;
/** A path link (GLIDEPATH) through points in metres. */
export function path(b: Build, kind: 'glidepath', pts: readonly (readonly [number, number, number])[]): void {
  b.links.push({ id: makeId(2, ++pathN), kind, from: null, to: null, via: [], points: pts.map((q) => [metresToPos(q[0]), metresToPos(q[1]), metresToPos(q[2])] as const), length: 0 });
}

/** A THUD dropped on a BUTTON wired to `to`'s `port`: a signal ≈ 0.2 s in. */
function press(b: Build, to: number, port: string, x = -0.8, z = 0.6): void {
  const button = b.add('the_button', x, 0, z);
  b.add('thud', x, 0.2, z);
  b.link('cable_signal', button, 'out', to, port);
}

export const M3_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  glint: (b) => {
    b.add('slope', 0, 0, 0, { angle: 40 });
    for (let k = 0; k < 12; k++) b.add('glint', 0.1 + (k % 4) * 0.02, 0.4 + k * 0.03, (k % 3) * 0.02 - 0.02);
    b.add('bumper', -0.5, 0, 0);
  },
  bearing: (b) => {
    const mains = b.add('mains', -0.8, 0, -0.5);
    const mag = b.add('maglock', 0, 0, 0);
    for (let k = 0; k < 10; k++) b.add('bearing', (k % 5) * 0.03 - 0.06, 0.008 + Math.floor(k / 5) * 0.02, 0.2 + k * 0.02);
    b.link('cable_power', mains, 'out', mag, 'in');
  },
  glidepath_booster: (b) => {
    const mains = b.add('mains', -0.9, 0, -0.4);
    const motor = b.add('motor', -0.5, 0, -0.4, { direction: 1 });
    const boost = b.add('glidepath_booster', 0.1, 0.305, 0);
    path(b, 'glidepath', [[-0.6, 0.42, 0], [-0.3, 0.31, 0], [0.6, 0.3, 0], [0.9, 0.6, 0.3], [0.6, 0.9, 0.6]]);
    b.add('bearing', -0.598, 0.426, 0);
    b.add('glint', -0.598, 0.45, 0);
    b.add('bearing', 0, 0.33, 0);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', boost, 'drive');
  },
  spindeck: (b, p) => {
    const mains = b.add('mains', -0.8, 0, -0.4);
    const motor = b.add('motor', -0.5, 0, 0);
    const deck = b.add('spindeck', 0, 0, 0, p);
    b.add('boing', 0.05, 0.22, 0);
    b.add('thud', -0.1, 0.22, 0.05);
    for (let k = 0; k < 4; k++) b.add('stitch', 0.15 * Math.sign(k - 1.5), 0.14, (k % 2) * 0.1);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', deck, 'in');
  },
  lift: (b, p) => {
    const mains = b.add('mains', -0.6, 0, -0.5);
    const lift = b.add('lift', 0, 0, 0, p);
    b.add('boing', 0, 0.171, 0);
    b.add('thud', 0.05, 0.4, 0.05);
    b.add('pig_iron', -0.08, 0.2, -0.05);
    b.link('cable_power', mains, 'out', lift, 'in');
    press(b, lift, 'call');
    press(b, lift, 'call', 0.8, 0.6);
  },
  rack: (b, p) => {
    const mains = b.add('mains', -0.6, 0, -0.5);
    const motor = b.add('motor', -0.3, 0, -0.3);
    const rack = b.add('rack', 0, 0, 0, p);
    b.add('thud', 0, 0.3, 0.02);
    for (let k = 0; k < 4; k++) b.add('topple_tile', 1.1 + k * 0.1, 0.075, 0);
    b.add('brik', -1.1, 0.05, 0);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', rack, 'pinion');
  },
  ram: (b) => {
    const mains = b.add('mains', -0.5, 0, -0.4);
    const ram = b.add('ram', 0, 0, 0);
    b.add('thud', 0, 0.11, 0.37);
    b.add('boing', 0.2, 0.12, 0.4);
    b.link('cable_power', mains, 'out', ram, 'in');
    press(b, ram, 'fire');
    press(b, ram, 'fire', 0.8, -0.6);
  },
  lance: (b) => {
    const mains = b.add('mains', -0.6, 0, -0.3);
    const lance = b.add('lance', -0.4, 0, 0);
    b.add('burning_glass', -0.1, -0.198, 0, {}, snappedEuler(90, 0, 0));
    b.add('mirror', 0.3, 0, 0, {}, snappedEuler(-45, 0, 0));
    b.add('splitter', 0.3, -0.018, 0.4);
    const hook = b.add('anchor', 0.3, 0, 0.2);
    const h = b.add('helio', 0.3, 0.8, 0.2);
    b.add('fuzz', 0.25, 0.4, 0.1);
    b.link('cable_power', mains, 'out', lance, 'in');
    b.link('line', h, 'knot', hook, 'hook');
  },
  mirror: (b) => {
    const mains = b.add('mains', -0.8, 0, -0.3);
    const lance = b.add('lance', -0.4, 0, 0);
    b.add('mirror', 0, 0, 0, {}, snappedEuler(-45, 0, 0));
    b.add('mirror', 0, 0, 0.5, {}, snappedEuler(-135, 0, 0));
    b.add('mirror', -0.5, 0, 0.5, {}, snappedEuler(135, 0, 0));
    b.add('mirror', -0.5, 0, 0.2, {}, snappedEuler(45, 0, 0));
    b.add('stitch', 0, 0.3, 0.25);
    b.link('cable_power', mains, 'out', lance, 'in');
  },
  splitter: (b) => {
    const mains = b.add('mains', -0.8, 0, -0.3);
    const lance = b.add('lance', -0.4, 0, 0);
    b.add('splitter', -0.1, -0.018, 0);
    b.add('splitter', 0.4, -0.018, 0);
    b.add('splitter', 0.4, -0.018, 0.1);
    for (const z of [-0.3, 0, 0.3]) b.add('tripwire', 1.2, -0.003, z, { mode: 1 });
    b.add('suncell', 0.9, 0, 0.2);
    b.link('cable_power', mains, 'out', lance, 'in');
  },
  tripwire: (b, p) => {
    const mains = b.add('mains', -1.0, 0, -0.4);
    const lance = b.add('lance', -0.6, 0, -0.3);
    const trip = b.add('tripwire', 0.1545, -0.003, -0.3, p);
    for (let k = 0; k < 3; k++) b.add('stitch', -0.1 + k * 0.1, 0.4 + k * 0.2, -0.3);
    const flap = b.add('flap', 0.5, 0.3, 0);
    b.add('stitch', 0.5, 0.35, 0.13);
    b.link('cable_power', mains, 'out', lance, 'in');
    b.link('cable_signal', trip, 'out', flap, 'in');
  },
  ping: (b, p) => {
    const a = b.add('ping', -0.3, 0, 0, p);
    const r1 = b.add('ping', 0.3, 0, 0, { pair: p.pair ?? 0, mode: 1 });
    const r2 = b.add('ping', 0.3, 0, 0.3, { pair: ((p.pair ?? 0) + 1) % 6, mode: 1 });
    const t2 = b.add('ping', -0.3, 0, 0.3, { pair: p.pair ?? 0, mode: 0 });
    // a loop: Rx → Tx of the same pair (the cycle guard must stop it)
    b.link('cable_signal', r1, 'out', t2, 'in');
    const s1 = b.add('bangstick', 0.8, 0.039, 0);
    b.link('cable_signal', r2, 'out', s1, 'detonator');
    press(b, a, 'in');
  },
  maglock: (b) => {
    const mains = b.add('mains', -0.5, 0, -0.3);
    const mag = b.add('maglock', 0, 0.6, 0);
    const hook = b.add('anchor', 0, 1.2, 0);
    b.add('pig_iron', 0, 0.06, 0.1);
    b.add('wrecker', 0.3, 0.095, 0.3);
    b.add('bearing', 0.02, 0.4, 0.12);
    b.link('cable_power', mains, 'out', mag, 'in');
    b.link('line', mag, 'eye', hook, 'hook');
  },
  powder_keg: (b, p) => {
    b.add('powder_keg', 0, 0.15, 0, p);
    b.add('powder_keg', 0.5, 0.15, 0, p);
    const wick = b.add('wick', 0.15, 0, 0);
    b.add('wick', -0.3, 0, 0.3);
    const k3 = b.add('powder_keg', -0.3, 0.15, 0, p);
    b.link('fuse', wick, 'flame', k3, 'fuse');
    for (let row = 0; row < 3; row++) b.add('brik', 0.9, 0.05 + row * 0.1, 0);
    b.add('helio', 0.2, 0.6, 0.3);
    b.add('pane', -0.6, 0.2, 0);
  },
  jitterjuice: (b) => {
    b.add('jitterjuice', 0, 0.05, 0);
    b.add('jitterjuice', 0.3, 0.05, 0);
    b.add('jitterjuice', 0.7, 0.05, 0.2);
    b.add('stitch', 0, 0.5, 0);
    b.add('vase', -0.4, 0.075, 0);
    b.add('fuzz', 0.3, 0.13, 0);
  },
  skyshow: (b, p) => {
    const wick = b.add('wick', 0, 0, 0.22);
    const cake = b.add('skyshow', 0, 0, 0, p);
    b.link('fuse', wick, 'flame', cake, 'fuse');
    b.add('skyshow', 0.5, 0, 0, p);
    b.add('helio', 0.5, 1.5, 0);
  },
  flamer: (b, p) => {
    const mains = b.add('mains', -0.8, 0, -0.3);
    b.add('ledge', 0, 0.09, 0);
    const torch = b.add('flamer', 0, 0.14, 0, p);
    b.add('helio', 0.4, 0.33, 0);
    b.add('wick', 0.6, 0, 0, { lit: 0 });
    b.add('powder_keg', 0.4, 0.15, 0.3);
    b.add('plank', 0.5, 0.2, 0);
    const fan = b.add('gale', 0.9, 0.13, 0, {}, snappedEuler(-90, 0, 0));
    b.link('cable_power', mains, 'out', torch, 'in');
    b.link('cable_power', mains, 'out', fan, 'in');
    press(b, torch, 'on');
  },
  popper: (b) => {
    const pop = b.add('popper', 0, 0, 0);
    const h = b.add('helio', 0, 0.6, 0.3);
    b.add('fuzz', 0, 0.18, 0);
    b.add('glint', 0.02, 0.3, 0);
    b.add('helio', 0.05, 0.5, -0.05);
    b.link('line', h, 'knot', pop, 'string');
  },
  snaptrap: (b) => {
    b.add('snaptrap', 0, 0, 0);
    b.add('glint', -0.08, 0.036, 0);
    b.add('stitch', 0.04, 0.3, 0);
    b.add('snaptrap', 0.4, 0, 0);
    b.add('thud', 0.44, 0.5, 0);
  },
  bonker: (b) => {
    const bonk = b.add('bonker', 0, 0.05, 0);
    b.add('boing', 0, 0.12, 0.3);
    b.add('thud', 0.05, 0.11, 0.45);
    press(b, bonk, 'swing');
    press(b, bonk, 'swing', 0.8, -0.6);
  },
  flinger: (b, p) => {
    const fl = b.add('flinger', 0, 0, 0, p);
    b.add('stitch', -0.16, 0.095, 0);
    b.add('thud', -0.1, 0.5, 0);
    press(b, fl, 'release', -0.6, 0.5);
  },
  wrecker: (b) => {
    const hook = b.add('anchor', 0, 1.1, 0);
    const ball = b.add('wrecker', -0.9, 1.0, 0);
    for (let row = 0; row < 3; row++) for (const z of [-0.2, 0, 0.2]) b.add('brik', 0.15, 0.05 + row * 0.1, z, {}, snappedEuler(90, 0, 0));
    b.add('pane', 0.4, 0.2, 0);
    b.link('chain', ball, 'hook', hook, 'hook');
  },
  pinger: (b) => {
    const p = b.add('pinger', 0, 0, 0);
    b.add('stitch', 0, 0.0375, 0.2);
    b.add('glint', 0, 0.008, 0.18);
    press(b, p, 'fire');
  },
  paddle: (b) => {
    const p = b.add('paddle', 0, 0.06, 0);
    b.add('stitch', 0.18, 0.0375, -0.02);
    b.add('boing', 0.3, 0.12, -0.2);
    press(b, p, 'flip');
    press(b, p, 'flip', 0.8, -0.6);
  },
  bumper: (b) => {
    const bump = b.add('bumper', 0, 0, 0);
    b.add('bumper', 0.25, 0, 0.05);
    b.add('slope', 0.6, 0, 0, { angle: 25 });
    for (let k = 0; k < 4; k++) b.add('stitch', 0.8, 0.4 + k * 0.1, (k % 2) * 0.05);
    b.add('glint', 0.05, 0.12, 0.05);
    press(b, bump, 'kick');
  },
  pin: (b) => {
    b.add('slope', 0.4, 0, 0, {}, snappedEuler(180, 0, 0));
    b.add('thud', 0.26, 0.4, 0);
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) b.add('pin', 1.05 + row * 0.104, 0.055, (k - row / 2) * 0.12);
    b.add('bangstick', 1.6, 0.039, 0.5, { fuse: 1 });
  },
  stacker: (b) => {
    for (let layer = 0; layer < 8; layer++) {
      for (const o of [-0.1, 0, 0.1]) {
        const y = 0.015 + layer * 0.03;
        if (layer % 2) b.add('stacker', 0, y, o, {}, snappedEuler(90, 0, 0));
        else b.add('stacker', o, y, 0);
      }
    }
    b.add('thud', 0.02, 0.8, 0.01);
  },
  pane: (b) => {
    b.add('pane', 0, 0.2, 0);
    b.add('pane', 0.3, 0.2, 0, {}, snappedEuler(90, 0, 0));
    b.add('thud', 0.05, 0.8, 0);
    b.add('bangstick', 0.6, 0.039, 0.3, { fuse: 1 });
    const wick = b.add('wick', 0.9, 0, 0.3);
    b.add('wick', 0.9, 0, -0.3);
    void wick;
  },
  vase: (b) => {
    b.add('vase', 0, 0.6, 0);
    b.add('vase', 0.3, 0.075, 0);
    b.add('stitch', 0.3, 0.6, 0);
    b.add('jitterjuice', 0.7, 0.05, 0);
    b.add('stitch', 0.7, 0.5, 0);
  },
  tonebars: (b, p) => {
    for (let k = 0; k < 4; k++) b.add('tonebars', k * 0.12, 0, 0, { ...p, degree: (p.degree ?? 0) + k > 14 ? 14 : (p.degree ?? 0) + k });
    for (let k = 0; k < 6; k++) b.add('stitch', (k % 4) * 0.12, 0.3 + k * 0.1, 0.02);
    b.add('glint', 0.12, 0.5, 0);
  },
  ding: (b, p) => {
    b.add('ding', 0, 0.035, 0, p);
    b.add('ding', 0.3, 0.035, 0, p);
    b.add('stitch', 0, 0.4, 0);
    b.add('thud', 0.3, 0.6, 0);
    b.add('mochi', 0.8, 0, 0.5);
  },
  fabricator: (b, p) => {
    const fab = b.add('fabricator', 0, 0, 0, p);
    b.add('recycler', 0, 0, 1.0);
    press(b, fab, 'spawn');
    b.add('slope', 0.5, 0, 0.6);
  },
  recycler: (b, p) => {
    const r = b.add('recycler', 0, 0, 0, p);
    for (let k = 0; k < 5; k++) b.add('stitch', -0.04 + (k % 3) * 0.04, 0.4 + k * 0.2, 0.02 * (k - 2));
    b.add('boing', 0, 1.6, 0);
    b.add('pip', 0.02, 0.4, 0);
    const fab = b.add('fabricator', 0, 0.2, -0.4, { part: 1, count: 4, interval: 0.5, speed: 1.5 });
    void fab;
    const stick = b.add('bangstick', 0.6, 0.039, 0.3);
    b.link('cable_signal', r, 'count', stick, 'detonator');
  },
  zone: (b, p) => {
    b.add('zone', 0, 0, 0, p);
    b.add('boing', 0, 0.12, 0);
    b.add('thud', 0.1, 0.3, 0.1);
    b.add('helio', -0.1, 0.4, 0);
    b.add('wick', 0.2, 0, 0.2);
    b.add('glint', 0, 0.5, 0);
    b.add('mochi', 0.3, 0, 0.3);
  },
};
