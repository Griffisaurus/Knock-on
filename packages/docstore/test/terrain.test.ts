// S3: Backlot sculpt strokes through the doc (both clients and the host apply the same ops).

import { describe, expect, it } from 'vitest';
import { EMPTY_WORLD, TerrainBrush, decodeWorld, defaultEnvFor, defaultTerrain, encodeWorld, terrainHeightAt, type Op } from '@knockon/format';
import { DocStore, WorldDoc, tryApply } from '../src/index.ts';

const raise: Op = { k: 'TerrainStroke', stroke: { brush: TerrainBrush.Raise, radius: 640 * 4, strength: 1000, points: [[0, 0, 0], [640, 0, 0]] } };

describe('terrain strokes in the doc', () => {
  it('only on the Backlot; the first stroke copies the default lot, undo restores it exactly', () => {
    const doc = WorldDoc.fromSnapshot({ ...EMPTY_WORLD, env: defaultEnvFor('arena') });
    expect(tryApply(doc, raise).ok).toBe(false); // Studio arena: no terrain tool
    doc.env = defaultEnvFor('megastructure');
    doc.env = { ...doc.env, preset: 'arena', environment: 'backlot' };
    expect(doc.activeTerrain()).toBe(defaultTerrain('arena'));
    const r = tryApply(doc, raise);
    expect(r.ok).toBe(true);
    expect(doc.terrain).not.toBe(defaultTerrain('arena'));
    expect(terrainHeightAt(doc.activeTerrain()!, 0, 0)).toBeGreaterThan(4.2);
    if (!r.ok) return;
    expect(tryApply(doc, r.inverse).ok).toBe(true);
    expect(doc.terrain!.heights).toEqual(defaultTerrain('arena')!.heights);
  });

  it('two stores applying the same ops in server order end bit-identical, and the terrain survives a save', () => {
    const snap = { ...EMPTY_WORLD, env: { ...defaultEnvFor('arena'), environment: 'backlot' } };
    const a = new DocStore(1, WorldDoc.fromSnapshot(snap)), b = new DocStore(2, WorldDoc.fromSnapshot(snap));
    const mine = a.applyLocal(raise);
    expect('clientOpId' in mine).toBe(true);
    const smooth: Op = { k: 'TerrainStroke', stroke: { brush: TerrainBrush.Smooth, radius: 640 * 6, strength: 600, points: [[320, 0, 320]] } };
    // b's stroke is sequenced first: a rewinds its pending raise, applies b's, replays its own
    a.onRemote(1, 2, smooth);
    b.applyLocal(smooth);
    if ('clientOpId' in mine) a.onAck(mine.clientOpId, 2);
    b.onAck('2:1', 1);
    b.onRemote(2, 1, raise);
    expect(a.doc.terrain!.heights).toEqual(b.doc.terrain!.heights);
    const saved = decodeWorld(encodeWorld(a.doc.toSnapshot({ title: 't', simVersion: 'x', tickRate: 120, seed: [1, 2], counters: {} })));
    expect(saved.terrain!.heights).toEqual(a.doc.terrain!.heights);
  });
});
