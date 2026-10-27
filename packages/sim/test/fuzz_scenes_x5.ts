// Property-fuzz scene for X5's GOO VAT (PART_SYSTEM §8): opened by a THUD on THE BUTTON, with a ball rolled past its
// nozzle, a body dropped on its lid and a blast beside it. 20 random property sets × 2 seeds (fuzz.test.ts). The fuzz
// runs with Matter off, like every part's; GOO VAT's Matter-on behaviour is in matter_goo.test.ts.

import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

export const X5_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  goo_vat: (b, p) => {
    const vat = b.add('goo_vat', 0, 0, 0, p);
    const button = b.add('the_button', -0.8, 0, 0.6);
    b.add('thud', -0.8, 0.2, 0.6);
    b.link('cable_signal', button, 'out', vat, 'open');
    b.add('stitch', 0.4, 0.04, 0.3);
    b.add('thud', 0.02, 0.8, 0.01);
    const stick = b.add('bangstick', -0.6, 0.039, -0.4, { fuse: 0.5 });
    const wick = b.add('wick', -0.3, 0, -0.3);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
};
