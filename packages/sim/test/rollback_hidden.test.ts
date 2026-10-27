// A broken part's hidden bodies must never be pushed: restore zeroes their velocity, so a push kept in the
// straight run would desync the rolled-back one (found by the M2 critter soak; Machine.hiddenBody).
import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { Machine } from '../src/index.ts';
import { Build, jolt } from './harness.ts';

describe('rollback across a broken part', () => {
  it('a poke on a broken PLANK, delivered late, rolls back to the straight run', async () => {
    const b = new Build();
    b.add('ledge', -0.45, 0.4, 0);
    b.add('ledge', 0.45, 0.4, 0);
    const plank = b.add('plank', 0, 0.5, 0);
    b.parts[b.parts.length - 1] = { ...b.parts.at(-1)!, rot: snappedEuler(90, 0, 0) };
    b.add('thud', 0, 2.5, 0);
    // the plank breaks around tick 130; poke 1 pushes its hidden body before the tick-240 checkpoint, and
    // poke 2 arrives late, so the rollback restores that checkpoint with the hidden body mid-push
    const thud = b.parts.find((p) => p.type === 'thud')!.id;
    const early = { tick: 200, seq: 1, partId: plank, kind: 'impulse' as const, data: [2, 3, 0] };
    const late = { tick: 250, seq: 2, partId: thud, kind: 'impulse' as const, data: [5, 2, 0] };
    const J = await jolt();
    const a = new Machine(J, b);
    a.addPoke(early); a.addPoke(late);
    for (let t = 0; t < 360; t++) a.step();
    expect(a.drainEvents().some((e) => e.kind === 'Break' && e.part === plank)).toBe(true);
    const c = new Machine(J, b);
    c.addPoke(early);
    for (let t = 0; t < 290; t++) c.step();
    c.addPoke(late);
    expect(c.restore(250)).toBe(240);
    while (c.tick < 360) c.step();
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 60_000);
});
