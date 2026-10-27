// Property-fuzz scenes for the M4 critters (stream B4, PART_SYSTEM §8): HENNY (`eggs`) and DUSTY (its zone) get 20
// random property sets × 2 seeds; BISCUIT (no properties) runs its scene once per seed (fuzz.test.ts). Each scene
// leans on the critter: frights, blasts, a ledge to fall from, light and heavy bodies in the way.

import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

export const B4_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  biscuit: (b) => {
    b.add('biscuit', 0, 0, 0);
    b.add('mochi', 0.3, 0, 1.2);
    b.add('thud', 0.45, 0.4, 0.1); // the wake-up thump
    b.add('boing', 0, 0.12, 0.6); // in his way: barged aside
    b.add('thud', -0.2, 0.11, 1.8);
    const stick = b.add('bangstick', 1.2, 0.039, 1.6, { fuse: 1.5 });
    const wick = b.add('wick', 1.6, 0, 1.6);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
  henny: (b, p) => {
    b.add('henny', 0, 0, 0, p);
    b.add('thud', 0.8, 0.35, 0); // a fright: flap, egg
    b.add('ledge', -0.9, 1.0, 0);
    b.add('henny', -0.85, 1.05, 0, p); // a second hen on a shelf: her eggs fall further
    b.add('thud', 0.5, 0.11, 0.6);
    const stick = b.add('bangstick', 0.4, 0.039, -0.7, { fuse: 1.8 });
    const wick = b.add('wick', 0.8, 0, -0.7);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
  dusty: (b, p) => {
    b.add('dusty', 0, 0, 0, p);
    b.add('ledge', 0.5, 0, 0.5); // a low step to bump
    b.add('ledge', -0.6, 0.25, -0.2); // a shelf to drive off (if the zone reaches it)
    b.add('stitch', 0.2, 0.0375, 0.3);
    b.add('thud', -0.4, 0.11, 0.5);
    const loud = b.add('thud', 0.6, 1.2, -0.6); // its landing startles Dusty (70 dB)
    void loud;
  },
};
