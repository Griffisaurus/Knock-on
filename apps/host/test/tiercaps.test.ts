// The host's part caps come from the format's one tier table, so the 32 GB tier (D85) is capped at 2M parts,
// not the 4 GB tier's 20,000 (M5 close-out: the host kept its own copy without a 32 entry).
import { describe, expect, it } from 'vitest';
import { TIER_CAPS as FORMAT_TIER_CAPS } from '@knockon/format';
import { TIER_CAPS } from '../src/session.ts';

describe('host part caps per GPU tier', () => {
  it('match the format table for every tier, including 32 GB', () => {
    for (const t of FORMAT_TIER_CAPS) expect(TIER_CAPS[t.tier]).toBe(t.parts);
    expect(TIER_CAPS[32]).toBe(2_000_000);
  });
});
