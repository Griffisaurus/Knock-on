import { describe, expect, it } from 'vitest';
import { worldSeed } from '../src/run.ts';

describe('worldSeed', () => {
  it('is stable for a world id (both players derive the same run seed) and differs between worlds', () => {
    expect(worldSeed('w-abc123')).toEqual(worldSeed('w-abc123'));
    expect(worldSeed('w-abc123')).not.toEqual(worldSeed('w-abc124'));
    for (const v of worldSeed('')) expect(v).toBeGreaterThan(0);
  });
});
