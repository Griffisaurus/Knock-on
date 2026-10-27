// Stream C: part art → renderer geometry for the M2 extras: shape keys (morph rows) and pre-fractured
// chunks (.frac.glb chunk order).
import { encodeGlb, parseGlb } from '@knockon/assets';
import { describe, expect, it } from 'vitest';
import { fracChunks, glbLods } from '../src/gfx/glbmesh.ts';

/** A glb from a list of meshes (each: name, positions, optional POSITION target deltas), under LOD0. */
function glbOf(meshes: { node: string; pos: number[]; targets?: number[][]; names?: string[] }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let off = 0;
  const acc = (a: Float32Array | Uint16Array, type: string, ct: number, count: number): number => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const pad = (4 - (b.byteLength % 4)) % 4;
    parts.push(b, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength });
    off += b.byteLength + pad;
    accessors.push({ bufferView: views.length - 1, componentType: ct, count, type });
    return accessors.length - 1;
  };
  const nodes: Record<string, unknown>[] = [{ name: 'LOD0', children: meshes.map((_, i) => i + 1) }];
  const jmeshes = meshes.map((m, i) => {
    const n = m.pos.length / 3;
    const p = acc(new Float32Array(m.pos), 'VEC3', 5126, n);
    const idx = acc(new Uint16Array([0, 1, 2]), 'SCALAR', 5123, 3);
    const targets = (m.targets ?? []).map((t) => ({ POSITION: acc(new Float32Array(t), 'VEC3', 5126, n) }));
    nodes.push({ name: m.node, mesh: i });
    return { name: m.node, ...(m.names ? { extras: { targetNames: m.names } } : {}), primitives: [{ attributes: { POSITION: p }, indices: idx, ...(targets.length ? { targets } : {}) }] };
  });
  const bin = new Uint8Array(off);
  let o = 0;
  for (const c of parts) { bin.set(c, o); o += c.byteLength; }
  return encodeGlb({ asset: { version: '2.0' }, nodes, meshes: jmeshes, buffers: [{ byteLength: off }], bufferViews: views, accessors }, bin);
}

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

describe('glbLods shape keys', () => {
  it('keeps a delta row only for vertices that move, in target-name order', () => {
    const glb = parseGlb(glbOf([{ node: 'sprong__mat', pos: TRI, names: ['sk_depress'], targets: [[0, 0, 0, 0, -0.03, 0, 0, -0.02, 0]] }]));
    const g = glbLods(glb, 1)[0]!;
    expect(g.morph?.names).toEqual(['sk_depress']);
    expect(Array.from(g.morph!.rowOf)).toEqual([-1, 0, 6]);
    expect(Array.from(g.morph!.table).map((v) => +v.toFixed(3))).toEqual([0, -0.03, 0, 0, 0, 0, 0, -0.02, 0, 0, 0, 0]);
  });

  it('unions keys across meshes (PUFFER pleats + spring), zero-filling keys a mesh lacks', () => {
    const glb = parseGlb(glbOf([
      { node: 'puffer__pleats', pos: TRI, names: ['sk_squash'], targets: [[0, 0, 0, 0, 0, 0, 0, -0.1, 0]] },
      { node: 'puffer__spring', pos: TRI, names: ['sk_spring'], targets: [[0, 0.2, 0, 0, 0, 0, 0, 0, 0]] },
    ]));
    const g = glbLods(glb, 1)[0]!;
    expect(g.morph?.names).toEqual(['sk_squash', 'sk_spring']);
    // pleats vertex 2 (row 0): squash delta, zero spring; spring vertex 0 (row 12): zero squash, spring delta
    expect(Array.from(g.morph!.rowOf)).toEqual([-1, -1, 0, 12, -1, -1]);
    expect(+g.morph!.table[1]!.toFixed(2)).toBe(-0.1);
    expect(g.morph!.table[6 + 1]).toBe(0);
    expect(g.morph!.table[12 + 1]).toBe(0);
    expect(+g.morph!.table[12 + 6 + 1]!.toFixed(2)).toBe(0.2);
  });

  it('meshes without targets have no morph data', () => {
    expect(glbLods(parseGlb(glbOf([{ node: 'plain', pos: TRI }])), 1)[0]!.morph).toBeUndefined();
  });
});

describe('fracChunks', () => {
  it('orders chunks by the number on their node, else by node order', () => {
    const glb = parseGlb(glbOf([{ node: 'fishbowl__chunk_02', pos: TRI }, { node: 'fishbowl__chunk_00', pos: TRI }, { node: 'fishbowl__chunk_01', pos: TRI }]));
    const m = fracChunks(glb);
    expect(glb.meshes.map((x) => m.get(x))).toEqual([2, 0, 1]);
    const plain = parseGlb(glbOf([{ node: 'shard_a', pos: TRI }, { node: 'shard_b', pos: TRI }]));
    const mp = fracChunks(plain);
    expect(plain.meshes.map((x) => mp.get(x))).toEqual([0, 1]);
  });
});
