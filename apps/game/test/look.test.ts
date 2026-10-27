// L3 (M3): the D79 look's CPU-side logic (no GPU): governor drop order, texture-set index, grade, materials, HDR.
import { describe, expect, it } from 'vitest';
import { Governor } from '../src/gfx/look/governor.ts';
import { gradeColor, gradeTable, LUT_SIZE, NEUTRAL_GRADE, parseCube } from '../src/gfx/look/lut.ts';
import { detailFor, layerBytes, masterKind, texSetKind } from '../src/gfx/look/materials.ts';
import { parseHdr } from '../src/gfx/look/hdr.ts';
import { texSetsOf } from '../src/gfx/look/textures.ts';
import { lookTier } from '../src/gfx/look/tiers.ts';
import { DETAIL } from '../src/gfx/look/wgsl.ts';

describe('governor (RENDERING §11, D81)', () => {
  it('drops shafts, then DOF, then GI, then resolution, and restores one step at a time', () => {
    const g = new Governor();
    const seq: string[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      if (g.update(25, 1 / 60)) { const s = g.state; seq.push(`${+s.shafts}${+s.dof}${+s.gi}@${s.scale}`); }
    }
    expect(seq.slice(0, 4)).toEqual(['011@1', '001@1', '000@1', '000@0.9']);
    expect(g.state.scale).toBe(0.6);
    let restored = 0;
    for (let i = 0; i < 60 * 6; i++) if (g.update(8, 1 / 60)) restored++;
    expect(restored).toBe(1);
  });
});

describe('texture sets (contract 1)', () => {
  it('reads the .art.json textures index (E3c layout)', () => {
    const sets = texSetsOf({ textures: { albedo: 'a.png', normal: 'n.png', orm: 'o.png', size: 2048, slots: ['kn_powder_cobalt'] } });
    expect(sets).toEqual([{ albedo: 'a.png', normal: 'n.png', orm: 'o.png', size: 2048 }]);
    expect(texSetsOf({})).toEqual([]);
  });
  it('encodes master and textured kinds in the 192–255 range, layer in two bytes', () => {
    expect(Math.round(masterKind(0) * 255)).toBe(255);
    expect(Math.round(masterKind(DETAIL.peel) * 255)).toBe(251);
    expect(Math.round(texSetKind(DETAIL.woodX) * 255)).toBe(222);
    expect(layerBytes(0x8003).map((b) => Math.round(b * 255))).toEqual([3, 128]);
  });
  it('picks the detail layer from the master and the wood grain from the long axis', () => {
    expect(detailFor('kn_powder_ignition', [1, 1, 1])).toBe(DETAIL.peel);
    expect(detailFor('kn_wood_oak', [0.1, 0.1, 1])).toBe(DETAIL.woodZ);
    expect(detailFor('kn_env_bench_oak', [3, 0.07, 1])).toBe(DETAIL.woodX);
    expect(detailFor('kn_iron_cast', [1, 1, 1])).toBe(DETAIL.pitting);
    expect(detailFor('kn_glass', [1, 1, 1])).toBe(DETAIL.none);
  });
});

describe('grade LUT (RENDERING §9)', () => {
  it('the neutral grade is the identity', () => {
    for (const c of [[0, 0, 0], [0.25, 0.5, 0.75], [1, 1, 1]]) expect(gradeColor(NEUTRAL_GRADE, c).map((x) => +x.toFixed(4))).toEqual(c);
    expect(gradeTable(NEUTRAL_GRADE).length).toBe(LUT_SIZE ** 3 * 4);
  });
  it('parses a .cube file', () => {
    const lines = ['LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
    const t = parseCube(lines.join('\n'))!;
    const at = (r: number, g: number, b: number): number[] => { const o = ((b * LUT_SIZE + g) * LUT_SIZE + r) * 4; return [t[o]!, t[o + 1]!, t[o + 2]!]; };
    expect(at(31, 0, 0)).toEqual([255, 0, 0]);
    expect(at(16, 16, 16)[0]).toBeCloseTo(132, -1);
  });
});

describe('tiers (D79, D81, D85)', () => {
  it('maps tier ids, 32 = full-res shafts and half-res DOF', () => {
    expect(lookTier(32).froxelPx).toBe(16);
    expect(lookTier(32).dofDiv).toBe(2);
    expect(lookTier(16).dofDiv).toBe(4);
    expect(lookTier(4).ao).toBe('ssao');
    expect(lookTier(8).fog).toBe('haze');
  });
});

describe('Radiance HDR reader', () => {
  it('decodes flat RGBE scanlines', () => {
    const head = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n');
    const px = new Uint8Array([128, 64, 32, 129, 0, 0, 0, 0]); // (1, 0.5, 0.25) × 2^(129−136+8)/… and black
    const buf = new Uint8Array(head.length + px.length);
    buf.set(head); buf.set(px, head.length);
    const img = parseHdr(buf.buffer);
    expect([img.width, img.height]).toEqual([2, 1]);
    expect(img.data[0]).toBeCloseTo(128 * 2 ** (129 - 136), 6);
    expect(img.data[3]).toBe(0);
  });
});

describe('packed tangents (E3c MikkTSpace TANGENT in the normal w)', () => {
  it('round-trips angle and handedness through the one-number code', async () => {
    const { tangentBasis, tangentCode } = await import('../src/gfx/look/tangents.ts');
    const n = [0.3, 0.8, -0.52].map((x, _, a) => x / Math.hypot(...a));
    const [b0, b1] = tangentBasis(n);
    for (const [ang, w] of [[0.3, 1], [-2.5, -1], [3.1, 1]] as const) {
      const t = [0, 1, 2].map((k) => b0[k]! * Math.cos(ang) + b1[k]! * Math.sin(ang));
      const c = tangentCode(n, t, w);
      const q = Math.round(c * 32767) / 32767; // snorm16 storage
      const a = ((Math.abs(q) - 0.01) / 0.98 * 2 - 1) * Math.PI;
      expect(Math.sign(q)).toBe(w);
      expect(Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)))).toBeLessThan(1e-3);
    }
  });
});
