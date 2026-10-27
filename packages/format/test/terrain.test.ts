// S3 (M3 scale): the TERR section, sculpt strokes, the default Backlot lot, and the per-preset default environment.

import { describe, expect, it } from 'vitest';
import { pack } from 'msgpackr';
import {
  DEFAULT_ENV, EMPTY_WORLD, TerrainBrush, applyStroke, cloneTerrain, decodeTerrain, decodeWorld, defaultEnvFor, defaultTerrain, encodeContainer,
  encodeTerrain, encodeWorld, opFromWire, opToWire, terrainHeightAt, terrainMetres, worldHash, writePatch, Codec, type Op, type TerrainStroke,
} from '../src/index.ts';

describe('default environments (M3_PLAN contract 2)', () => {
  it('new worlds: Tinker Lab on Desk and Room, Studio on Warehouse and Arena, Backlot on Megastructure', () => {
    expect(DEFAULT_ENV.environment).toBe('tinker');
    expect(EMPTY_WORLD.env.environment).toBe('tinker');
    expect(defaultEnvFor('desk').environment).toBe('tinker');
    expect(defaultEnvFor('warehouse').environment).toBe('studio');
    expect(defaultEnvFor('arena').environment).toBe('studio');
    expect(defaultEnvFor('megastructure').environment).toBe('backlot');
  });

  it('old saves load as they were: an explicit environment is kept, a missing one was the Studio', () => {
    const studio = decodeWorld(encodeWorld({ ...EMPTY_WORLD, env: { ...EMPTY_WORLD.env, environment: 'studio' } }));
    expect(studio.env.environment).toBe('studio');
    // a pre-M3 header with no environment field at all
    const header = { simVersion: '0.0.0-dev', tickRate: 120, env: { preset: 'room', gravity: 100, air: 100, feel: 'real' }, seed: [1, 2], title: 'old' };
    const legacy = encodeContainer({ magic: 'KNON', flags: 0, header, sections: [
      { tag: 'TYPE', data: pack([]) as Uint8Array }, { tag: 'PART', data: new Uint8Array([0]) }, { tag: 'CNTR', data: pack({}) as Uint8Array },
    ] }, Codec.None);
    expect(decodeWorld(legacy).env.environment).toBe('studio');
  });
});

describe('Backlot terrain (TERR)', () => {
  it('the default Arena lot: 513² samples over the bounds, a level 4 m plateau at the centre, the bedrock floor kept', () => {
    const t = defaultTerrain('arena')!;
    expect([t.nx, t.nz, t.maxHeight, t.origin]).toEqual([513, 513, 64, [-128, -128]]);
    expect(terrainHeightAt(t, 0, 0)).toBeCloseTo(4, 2);
    expect(terrainHeightAt(t, 20, -10)).toBeCloseTo(4, 2);
    let min = Infinity;
    for (const h of t.heights) min = Math.min(min, terrainMetres(t, h));
    expect(min).toBeGreaterThanOrEqual(0.5 - 1e-3);
    expect(defaultTerrain('arena')).toBe(t); // cached
    expect(defaultTerrain('room')).toBeNull();
    const mega = defaultTerrain('megastructure')!;
    expect([mega.nx, mega.nz]).toEqual([2049, 2049]);
    expect(terrainHeightAt(mega, 0, 0)).toBeCloseTo(16, 1);
    expect(terrainHeightAt(mega, 260, -330)).toBeCloseTo(4, 1); // the quarry floor
  });

  it('round-trips through TERR bytes exactly, and the section is part of the world hash', () => {
    const t = cloneTerrain(defaultTerrain('arena')!);
    const back = decodeTerrain(encodeTerrain(t));
    expect(back.heights).toEqual(t.heights);
    expect([back.nx, back.nz, back.maxHeight, back.origin, back.preset]).toEqual([t.nx, t.nz, t.maxHeight, t.origin, t.preset]);
    const w = { ...EMPTY_WORLD, env: defaultEnvFor('arena'), terrain: t };
    const dec = decodeWorld(encodeWorld(w));
    expect(dec.terrain!.heights).toEqual(t.heights);
    const plain = worldHash({ ...EMPTY_WORLD });
    expect(worldHash(w)).not.toBe(plain);
    expect(worldHash({ ...EMPTY_WORLD, terrain: null })).toBe(plain); // no terrain: the M2 hash, unchanged
  });

  it('strokes are deterministic, clamp to bedrock and ceiling, and their undo patch restores the samples exactly', () => {
    const base = defaultTerrain('arena')!;
    const stroke: TerrainStroke = { brush: TerrainBrush.Raise, radius: 640 * 6, strength: 800, points: [[0, 0, 0], [640 * 2, 0, 640], [640 * 4, 0, 640 * 3]] };
    const a = cloneTerrain(base), b = cloneTerrain(base);
    const undo = applyStroke(a, stroke)!;
    applyStroke(b, stroke);
    expect(a.heights).toEqual(b.heights);
    expect(terrainHeightAt(a, 0, 0)).toBeGreaterThan(4.1);
    writePatch(a, undo);
    expect(a.heights).toEqual(base.heights);
    // lower far past bedrock: clamped at 0.5 m
    const c = cloneTerrain(base);
    for (let i = 0; i < 60; i++) applyStroke(c, { brush: TerrainBrush.Lower, radius: 640 * 3, strength: 1000, points: [[0, 0, 0]] });
    expect(terrainHeightAt(c, 0, 0)).toBeCloseTo(0.5, 2);
    // flatten pulls toward the first point's height; smooth stays finite and bounded
    applyStroke(c, { brush: TerrainBrush.Flatten, radius: 640 * 3, strength: 1000, points: [[0, 640 * 3, 0]] });
    expect(terrainHeightAt(c, 0, 0)).toBeGreaterThan(2.9);
    applyStroke(c, { brush: TerrainBrush.Smooth, radius: 640 * 4, strength: 500, points: [[0, 0, 0]] });
    expect(Number.isFinite(terrainHeightAt(c, 1, 1))).toBe(true);
  });

  it('TerrainStroke and TerrainPatch ops round-trip through the wire form', () => {
    const op: Op = { k: 'TerrainStroke', stroke: { brush: TerrainBrush.Smooth, radius: 1280, strength: 250, points: [[1, 2, 3], [4, 5, 6]] } };
    expect(opFromWire(opToWire(op))).toEqual(op);
    const t = cloneTerrain(defaultTerrain('arena')!);
    const patch = applyStroke(t, { brush: TerrainBrush.Raise, radius: 1280, strength: 100, points: [[0, 0, 0]] })!;
    const back = opFromWire(opToWire({ k: 'TerrainPatch', patch }));
    expect(back.k).toBe('TerrainPatch');
    if (back.k === 'TerrainPatch') expect(back.patch.heights).toEqual(patch.heights);
    expect(() => opFromWire([11, 0, 1, 500, [[0, 0, 0]]])).toThrow(); // radius under 0.5 m
  });
});
