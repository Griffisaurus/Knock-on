// Property-fuzz scene for BUZZ (stream B5, PART_SYSTEM §8): its `pair` colour gets 20 random sets × 2 seeds. The scene
// leans on it: a beacon of the same colour and one of another (only the first is its home), a call right away, tagged
// items (one on a ledge, one too heavy), a wall in the way and a blast during the flight.

import { PartFlag, type PartId, type PartRecord } from '@knockon/format';
import type { Props } from '@knockon/parts-data';
import type { Build } from './harness.ts';

const flag = (b: Build, id: PartId, f: number): void => {
  const i = b.parts.findIndex((p) => p.id === id);
  b.parts[i] = { ...b.parts[i]!, flags: b.parts[i]!.flags | f } as PartRecord;
};

export const B5_SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  buzz: (b, p) => {
    const pair = p.pair ?? 5;
    const beacon = b.add('buzz_beacon', 0, 0, 0, { pair });
    b.add('buzz_beacon', -1.2, 0, 0.6, { pair: (pair + 1) % 6 });
    b.add('buzz', 0, 0.04, 0, p);
    const button = b.add('the_button', -0.35, 0, 0.25);
    b.add('thud', -0.35, 0.2, 0.25); // the call
    b.link('cable_signal', button, 'out', beacon, 'call');
    flag(b, b.add('boing', 0.9, 0.12, 0.4), PartFlag.Tagged);
    b.add('ledge', -0.6, 0.6, -0.6);
    flag(b, b.add('stitch', -0.6, 0.69, -0.6), PartFlag.Tagged);
    flag(b, b.add('thud', 0.5, 0.11, -0.8), PartFlag.Tagged); // 7 kg: too heavy
    for (let i = 0; i < 6; i++) flag(b, b.add('plank', 0.45, 0.05 + 0.1 * i, 0.2), PartFlag.Anchored);
    const stick = b.add('bangstick', 0.7, 0.039, 0.9, { fuse: 1.6 });
    const wick = b.add('wick', 1.1, 0, 0.9);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
};
