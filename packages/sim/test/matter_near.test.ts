// machine.matter.near() with MX's grain queries (backend.ts MatterStepIn.queries → MatterStepOut.near): DUSTY finds a
// sand pile off to its side on the CPU backend and beelines to it (B4's critters/m4.ts asks near() when it can).

import { describe, expect, it } from 'vitest';
import { CRITTER_FSM } from '@knockon/parts-data';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

describe('near() on the CPU backend', () => {
  it('DUSTY beelines to a sand pile it can only know about through near()', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, 0, { zone_w: 3, zone_d: 3 });
    const anchor = b.add('ledge', 2.5, 0, 2.5);
    const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 8192, checkpointEvery: 60 } });
    const ai = m.parts.findIndex((p) => p.id === anchor);
    const pile = [-0.9, 0.01, 0.5] as const; // off to Dusty's side, 1 m away
    m.matter.emit(ai, 0, 1500, [pile[0] - 2.5, pile[1], pile[2] - 2.5], [0, 0, 0], 0.08);
    const ev: SimEvent[] = [];
    let answered = -1, minD = Infinity;
    for (let t = 0; t < 6 * 120; t++) {
      m.step();
      ev.push(...m.drainEvents());
      if (answered < 0 && m.st.matter!.answers.length) answered = m.tick;
      const p = pose(m, dusty).p;
      minD = Math.min(minD, Math.hypot(p[0] - pile[0], p[2] - pile[2]));
    }
    expect(answered).toBeGreaterThan(0); // MX answered Dusty's queries
    const seq = ev.filter((e) => e.kind === 'CritterState' && e.part === dusty).map((e) => CRITTER_FSM[e.mag]);
    expect(seq[0]).toBe('beeline'); // straight off its patrol, toward grains it can't see any other way
    expect(seq).toContain('vacuum');
    expect(minD).toBeLessThan(0.6); // from 1.03 m away to the pile's edge
    expect(m.matter.count(0)).toBeLessThan(1500); // and it ate some
    m.destroy();
  }, 300000);
});
