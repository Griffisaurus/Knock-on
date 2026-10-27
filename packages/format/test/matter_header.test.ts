// Matter in the format (DATA_FORMATS §2.1 and §6): header simFlags / requiredTier / counts.grains, and KNCP checkpoints
// with a MATR section.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, decodeCheckpoint, decodeContainer, decodeMatrSection, decodeWorld, encodeCheckpoint, encodeContainer, encodeMatrSection,
  encodeWorld, opFromWire, opToWire, requiredTier, worldRequiredTier, SINK_FILL_PARTICLES, type WorldSnapshot,
} from '../src/index.ts';

describe('world header: Matter', () => {
  it('writes simFlags, counts.grains and requiredTier, and reads them back', () => {
    const w: WorldSnapshot = { ...EMPTY_WORLD, grains: 1_500_000, simFlags: { matterGameplay: true } };
    const bytes = encodeWorld(w);
    const h = decodeContainer(bytes).header as { simFlags: unknown; requiredTier: number; counts: { grains: number } };
    expect(h.simFlags).toEqual({ matterGameplay: true, lanes: false });
    expect(h.counts.grains).toBe(1_500_000);
    expect(h.requiredTier).toBe(12); // 1.5M grains: more than 8 GB's 1M, within 12 GB's 2M (GAME_SPEC §15.2)
    const back = decodeWorld(bytes);
    expect(back.simFlags).toEqual({ matterGameplay: true, lanes: false });
    expect(back.grains).toBe(1_500_000);
  });

  it('new worlds run Matter; a file from before M4 (no simFlags) reads with Matter off', () => {
    expect(decodeWorld(encodeWorld(EMPTY_WORLD)).simFlags?.matterGameplay).toBe(true);
    const header = { simVersion: '0.0.0-dev', tickRate: 120, env: EMPTY_WORLD.env, seed: [1, 2], title: 'old', counts: { parts: 0, links: 0 } };
    const pre = encodeContainer({ magic: 'KNON', flags: 0, header, sections: [{ tag: 'TYPE', data: Uint8Array.of(0x90) }, { tag: 'PART', data: Uint8Array.of(0) }] });
    const old = decodeWorld(pre);
    expect(old.simFlags?.matterGameplay).toBe(false);
    expect(old.grains).toBe(0);
  });

  it('requiredTier follows GAME_SPEC §15.2 (parts and grains)', () => {
    expect(requiredTier(10, 0)).toBe(4);
    expect(requiredTier(10, 250_000)).toBe(4);
    expect(requiredTier(10, 250_001)).toBe(8);
    expect(requiredTier(10, 4_000_000)).toBe(16);
    expect(requiredTier(1_500_000, 0)).toBe(32);
    expect(requiredTier(10, 9_000_000)).toBe(0);
  });
});

describe('Fill the sink (D98)', () => {
  it('a Kitchen world with the sink on records 1M grains and requires the 16 GB tier', () => {
    const env = { ...EMPTY_WORLD.env, environment: 'kitchen', sinkFill: true };
    const bytes = encodeWorld({ ...EMPTY_WORLD, env, grains: SINK_FILL_PARTICLES });
    const h = decodeContainer(bytes).header as { requiredTier: number; counts: { grains: number }; env: { sinkFill: boolean } };
    expect(h.counts.grains).toBe(1_000_000);
    expect(h.requiredTier).toBe(16); // 1M alone would fit 8 GB: D98 sizes the sink for 16 GB
    expect(decodeWorld(bytes).env.sinkFill).toBe(true);
    expect(worldRequiredTier(10, SINK_FILL_PARTICLES, { environment: 'studio', sinkFill: true })).toBe(8);
  });

  it('EnvUpdate carries sinkFill (and an undo of "never set" reads as off)', () => {
    const op = opFromWire(opToWire({ k: 'EnvUpdate', patch: { sinkFill: true } }));
    expect(op).toEqual({ k: 'EnvUpdate', patch: { sinkFill: true } });
    expect(opFromWire([10, { sinkFill: null }])).toEqual({ k: 'EnvUpdate', patch: { sinkFill: false } });
  });
});

describe('KNCP checkpoints with MATR', () => {
  it('round-trip JOLT, ECS and MATR (and refuse a damaged MATR)', () => {
    const matr = encodeMatrSection({ tick: 480, snapshot: Uint8Array.of(9, 8, 7), results: [Int32Array.of(1, -2, 3)], proxies: [{ tick: 476, n: 1, rec: Int32Array.of(5, -6) }] });
    const blob = encodeCheckpoint({ tick: 480, jolt: Uint8Array.of(1, 2, 3, 4), state: new TextEncoder().encode('{"tick":480}'), matr });
    const cp = decodeCheckpoint(blob);
    expect(cp.tick).toBe(480);
    expect(Array.from(cp.jolt)).toEqual([1, 2, 3, 4]);
    expect(new TextDecoder().decode(cp.state)).toBe('{"tick":480}');
    const m = decodeMatrSection(cp.matr!);
    expect(m.tick).toBe(480);
    expect(Array.from(m.snapshot)).toEqual([9, 8, 7]);
    expect(Array.from(m.results[0]!)).toEqual([1, -2, 3]);
    expect(m.proxies[0]).toMatchObject({ tick: 476, n: 1 });
    expect(() => decodeMatrSection(matr.subarray(0, matr.length - 2))).toThrow();
    // without Matter there's no MATR section
    expect(decodeCheckpoint(encodeCheckpoint({ tick: 60, jolt: Uint8Array.of(1), state: Uint8Array.of(0x7b, 0x7d) })).matr).toBeUndefined();
  });
});
