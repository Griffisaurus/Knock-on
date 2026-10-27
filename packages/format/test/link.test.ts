// S3: share links (DATA_FORMATS §7).

import { describe, expect, it } from 'vitest';
import { EMPTY_WORLD, INLINE_LINK_MAX, idLink, inlineLink, makeId, parseShareLink, worldHash, type PartRecord } from '../src/index.ts';

const h = (i: number, k: number): number => { let x = Math.imul(i ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
const parts = (n: number, jitter = false): PartRecord[] => Array.from({ length: n }, (_, i) => ({
  id: makeId(1, i + 1), type: i % 3 ? 'brik' : 'thud', pos: [i * 128 + (jitter ? h(i, 1) % 640 : 0), 32 + (jitter ? h(i, 2) % 640 : 0), (i % 10) * 64], rot: { tag: 0 }, flags: 0,
}));

describe('share links', () => {
  it('a small machine rides in the fragment and decodes to the same world (hash), with t and cam', () => {
    const w = { ...EMPTY_WORLD, title: 'Little', parts: parts(40), counters: { 1: 40 } };
    const frag = inlineLink(w, { t: 42.5, cam: 'director' })!;
    expect(frag.startsWith('m=1')).toBe(true);
    expect(frag.endsWith('&t=42.5&cam=director')).toBe(true);
    const ref = parseShareLink(`#${frag}`)!;
    expect(ref.kind).toBe('inline');
    if (ref.kind !== 'inline') return;
    expect(worldHash(ref.world)).toBe(worldHash(w));
    expect([ref.t, ref.cam]).toEqual([42.5, 'director']);
  });

  it('a big machine gets no inline link (it goes through the host); ids parse; junk is refused', () => {
    const big = { ...EMPTY_WORLD, parts: parts(20_000, true) };
    expect(inlineLink(big)).toBeNull();
    expect(INLINE_LINK_MAX).toBe(12 * 1024);
    expect(parseShareLink(`#${idLink('0123456789abcdef', { cam: 'ride' })}`)).toEqual({ kind: 'id', id: '0123456789abcdef', cam: 'ride' });
    expect(parseShareLink('#something=else')).toBeNull();
    expect(() => parseShareLink('#s=not-an-id')).toThrow();
    expect(() => parseShareLink('#m=2abc')).toThrow();
    expect(() => parseShareLink(`#m=1${'A'.repeat(70_000)}`)).toThrow(/64 KB/);
    expect(() => parseShareLink('#m=1!!!')).toThrow();
  });
});
