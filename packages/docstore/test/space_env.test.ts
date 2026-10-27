// W5 (M5): switching to MOON BASE / ORBITAL HANGAR and toggling the Hangar's zero-g zones are ordinary EnvUpdate ops:
// both clients converge, and one undo puts each back.
import { describe, expect, it } from 'vitest';
import { EMPTY_WORLD, defaultEnvFor, envSwitchPatch, envZonesOn, type Op } from '@knockon/format';
import { DocStore, WorldDoc, tryApply } from '../src/index.ts';

describe('environment switch and zero-g zones in the doc', () => {
  it('switch to the Moon brings 16.5 % / 0 % air in one op, and one undo restores the Tinker Lab at Earth', () => {
    const doc = WorldDoc.fromSnapshot({ ...EMPTY_WORLD, env: defaultEnvFor('room') });
    const r = tryApply(doc, { k: 'EnvUpdate', patch: envSwitchPatch(doc.env, 'moon') });
    expect(r.ok).toBe(true);
    expect(doc.env).toMatchObject({ environment: 'moon', gravity: 16.5, air: 0 });
    if (!r.ok) return;
    expect(tryApply(doc, r.inverse).ok).toBe(true);
    expect(doc.env).toEqual(defaultEnvFor('room'));
  });

  it('zones toggle off and back on by undo; two stores converge', () => {
    const snap = { ...EMPTY_WORLD, env: defaultEnvFor('warehouse', 'hangar') };
    const a = new DocStore(1, WorldDoc.fromSnapshot(snap)), b = new DocStore(2, WorldDoc.fromSnapshot(snap));
    const off: Op = { k: 'EnvUpdate', patch: { zones: false } };
    const mine = a.applyLocal(off);
    expect(envZonesOn(a.doc.env)).toBe(false);
    if ('clientOpId' in mine) a.onAck(mine.clientOpId, 1);
    b.onRemote(1, 1, off);
    expect(b.doc.env).toEqual(a.doc.env);
    const r = tryApply(a.doc, off);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(tryApply(a.doc, r.inverse).ok).toBe(true); // back to false (the state before this op)
    const doc = WorldDoc.fromSnapshot(snap);
    const u = tryApply(doc, off);
    if (!u.ok) throw new Error(u.reason);
    expect(tryApply(doc, u.inverse).ok).toBe(true);
    expect(envZonesOn(doc.env)).toBe(true); // "never set" undoes to on
  });
});
