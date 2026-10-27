import { describe, expect, it } from 'vitest';
import { GlbError, decodeUtf8, lodStats, parseGlb } from '../src/index.ts';

// Builds a tiny GLB: one triangle under LOD0 -> child node translated +1 X and scaled 2 on Y.
function makeGlb(opts: { indexType?: 5123 | 5125; extraJson?: Record<string, unknown> } = {}): Uint8Array {
  const indexType = opts.indexType ?? 5123;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = indexType === 5123 ? new Uint16Array([0, 1, 2, 0]) : new Uint32Array([0, 1, 2]);
  const idxBytes = indexType === 5123 ? 6 : 12;
  const bin = new Uint8Array(36 + 36 + 12);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(normals.buffer), 36);
  bin.set(new Uint8Array(indices.buffer).subarray(0, idxBytes), 72);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'LOD0', children: [1] },
      { name: 'tri', mesh: 0, translation: [1, 0, 0], scale: [1, 2, 1] },
    ],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'kn_powder_ignition', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.1, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.42 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: idxBytes },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: indexType, count: 3, type: 'SCALAR' },
    ],
    ...opts.extraJson,
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) jsonBytes[i] = text.charCodeAt(i);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.length;
  dv.setUint32(binHeader, bin.byteLength, true);
  dv.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(bin, binHeader + 8);
  return out;
}

describe('parseGlb (synthetic)', () => {
  it('resolves node transforms, materials and LOD membership', () => {
    const glb = parseGlb(makeGlb());
    expect(glb.meshes).toHaveLength(1);
    const mesh = glb.meshes[0]!;
    expect(mesh.lod).toBe(0);
    expect(mesh.nodeName).toBe('tri');
    const p = mesh.primitives[0]!;
    expect(p.indices).toBeInstanceOf(Uint16Array);
    expect(p.triangleCount).toBe(1);
    expect(Array.from(p.positions)).toEqual([1, 0, 0, 2, 0, 0, 1, 2, 0]);
    expect(Array.from(p.normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(p.uvs).toBeNull();
    expect(glb.materials[p.material]).toMatchObject({ name: 'kn_powder_ignition', metallicFactor: 0, roughnessFactor: 0.42 });
    expect(glb.materials[0]!.baseColorFactor[0]).toBeCloseTo(0.8);
  });

  it('keeps 32-bit indices as Uint32Array', () => {
    const p = parseGlb(makeGlb({ indexType: 5125 })).meshes[0]!.primitives[0]!;
    expect(p.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(p.indices)).toEqual([0, 1, 2]);
  });

  it('rejects what it cannot load completely', () => {
    expect(() => parseGlb(new Uint8Array(8))).toThrow(GlbError);
    const bad = makeGlb();
    new DataView(bad.buffer).setUint32(0, 0x12345678, true);
    expect(() => parseGlb(bad)).toThrow(/magic/);
    expect(() => parseGlb(makeGlb({ extraJson: { extensionsRequired: ['EXT_meshopt_compression'] } }))).toThrow(/extensions/);
  });

  it('decodes multi-byte UTF-8', () => {
    expect(decodeUtf8(new Uint8Array([0x4b, 0xc3, 0xb8, 0xe2, 0x86, 0x92, 0xf0, 0x9f, 0x8e, 0xb1]))).toBe('Kø→\u{1f3b1}');
  });

  it('computes LOD stats', () => {
    const s = lodStats(parseGlb(makeGlb()), 0);
    expect(s.triangles).toBe(1);
    expect(s.vertices).toBe(3);
    expect(s.max).toEqual([2, 2, 0]);
    expect(s.originRadius).toBeCloseTo(Math.hypot(1, 2));
  });
});
