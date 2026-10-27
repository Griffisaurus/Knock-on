// Skins and animations in the GLB reader (stream C, M2): JOINTS_0 / WEIGHTS_0, inverse bind matrices,
// local TRS, animation channels and samplers, and the encodeGlb writer the tests build files with.
import { describe, expect, it } from 'vitest';
import { GlbError, decomposeTrs, encodeGlb, parseGlb, sampleAnim, slerpInto } from '../src/index.ts';

/** Two-bone strip: 4 vertices, root at the origin, `tip` 1 m up. Bottom verts on joint 0, top on joint 1. */
function skinned(opts: { weightsType?: 5126 | 5121; jointsType?: 5121 | 5123; extra?: (json: Record<string, unknown>) => void; ibm?: boolean } = {}): Uint8Array {
  const wt = opts.weightsType ?? 5126, jt = opts.jointsType ?? 5121;
  const chunks: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  let off = 0;
  const add = (a: ArrayBufferView): number => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const pad = (4 - (b.byteLength % 4)) % 4;
    chunks.push(b, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength });
    off += b.byteLength + pad;
    return views.length - 1;
  };
  const pos = add(new Float32Array([-0.1, 0, 0, 0.1, 0, 0, -0.1, 1, 0, 0.1, 1, 0]));
  const idx = add(new Uint16Array([0, 1, 2, 2, 1, 3]));
  const jv = jt === 5121 ? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) : new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const joints = add(jv);
  // weights deliberately not normalised on vertex 1 (the reader renormalises)
  const wv = wt === 5126 ? new Float32Array([1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]) : new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 128, 127, 0, 0]);
  const weights = add(wv);
  // inverse bind: joint 0 at origin (identity), joint 1 at y = 1 (translate −1)
  const ibm = add(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]));
  const times = add(new Float32Array([0, 0.5, 1]));
  const rots = add(new Float32Array([0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0, 1, 0]));
  const trans = add(new Float32Array([0, 1, 0, 0, 1.5, 0]));
  const t2 = add(new Float32Array([0, 2]));
  const json: Record<string, unknown> = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0, 3] }],
    nodes: [
      { name: 'Armature', children: [1], translation: [0, 0, 0] },
      { name: 'root', children: [2] },
      { name: 'tip', translation: [0, 1, 0] },
      { name: 'body', mesh: 0, skin: 0, translation: [5, 5, 5] }, // ignored: skinned
    ],
    meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1 }] }],
    skins: [{ name: 'rig', joints: [1, 2], skeleton: 1, ...(opts.ibm === false ? {} : { inverseBindMatrices: 4 }) }],
    animations: [{
      name: 'worm__wave',
      channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }, { sampler: 1, target: { node: 2, path: 'translation' } }],
      samplers: [{ input: 5, output: 6 }, { input: 8, output: 7, interpolation: 'STEP' }],
    }],
    buffers: [{ byteLength: off }],
    bufferViews: views,
    accessors: [
      { bufferView: pos, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: idx, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: joints, componentType: jt, count: 4, type: 'VEC4' },
      { bufferView: weights, componentType: wt, count: 4, type: 'VEC4', ...(wt === 5121 ? { normalized: true } : {}) },
      { bufferView: ibm, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: times, componentType: 5126, count: 3, type: 'SCALAR' },
      { bufferView: rots, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: trans, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: t2, componentType: 5126, count: 2, type: 'SCALAR' },
    ],
  };
  opts.extra?.(json);
  const bin = new Uint8Array(off);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  return encodeGlb(json, bin);
}

describe('parseGlb skins', () => {
  it('reads joints, inverse bind matrices and per-vertex joints/weights', () => {
    const glb = parseGlb(skinned());
    expect(glb.skins).toHaveLength(1);
    const s = glb.skins[0]!;
    expect(s.name).toBe('rig');
    expect(s.joints).toEqual([1, 2]);
    expect(s.skeleton).toBe(1);
    expect(s.inverseBindMatrices).toHaveLength(32);
    expect(s.inverseBindMatrices[16 + 13]).toBeCloseTo(-1);
    const m = glb.meshes[0]!;
    expect(m.skin).toBe(0);
    const p = m.primitives[0]!;
    expect(Array.from(p.joints!)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(Array.from(p.weights!.subarray(4, 8))).toEqual([1, 0, 0, 0]); // renormalised from 2
    expect(p.weights![12]).toBeCloseTo(0.5);
    expect(p.weights![13]).toBeCloseTo(0.5);
  });

  it('leaves skinned vertices in bind space (the mesh node transform is ignored)', () => {
    const m = parseGlb(skinned()).meshes[0]!;
    expect(Array.from(m.primitives[0]!.positions.subarray(0, 3))).toEqual([Math.fround(-0.1), 0, 0]);
    expect(Array.from(m.matrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('accepts normalised unsigned-byte weights and unsigned-short joints', () => {
    const p = parseGlb(skinned({ weightsType: 5121, jointsType: 5123 })).meshes[0]!.primitives[0]!;
    expect(p.weights![0]).toBeCloseTo(1);
    expect(p.weights![12]! + p.weights![13]!).toBeCloseTo(1);
    expect(p.joints![8]).toBe(1);
  });

  it('defaults inverse bind matrices to identity', () => {
    const s = parseGlb(skinned({ ibm: false })).skins[0]!;
    expect(Array.from(s.inverseBindMatrices.subarray(16, 32))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('exposes local TRS and children for every node', () => {
    const glb = parseGlb(skinned());
    expect(glb.nodes[2]!.translation).toEqual([0, 1, 0]);
    expect(glb.nodes[2]!.rotation).toEqual([0, 0, 0, 1]);
    expect(glb.nodes[1]!.children).toEqual([2]);
    expect(glb.nodes[2]!.matrix[13]).toBe(1);
  });

  it('rejects joints beyond the skin and JOINTS_0 without a skin', () => {
    expect(() => parseGlb(skinned({ extra: (j) => { (j['skins'] as { joints: number[] }[])[0]!.joints = [1]; (j['accessors'] as Record<string, unknown>[])[4]!['count'] = 1; } }))).toThrow(GlbError);
    expect(() => parseGlb(skinned({ extra: (j) => { delete (j['nodes'] as Record<string, unknown>[])[3]!['skin']; } }))).toThrow(/without a skin/);
    expect(() => parseGlb(skinned({ extra: (j) => { (j['skins'] as { joints: number[] }[])[0]!.joints = [1, 9]; } }))).toThrow(/out of range/);
  });
});

describe('parseGlb animations', () => {
  it('reads channels, samplers, strides and duration', () => {
    const a = parseGlb(skinned()).animations;
    expect(a).toHaveLength(1);
    expect(a[0]!.name).toBe('worm__wave');
    expect(a[0]!.duration).toBe(2);
    expect(a[0]!.channels).toEqual([{ node: 2, path: 'rotation', sampler: 0 }, { node: 2, path: 'translation', sampler: 1 }]);
    expect(a[0]!.samplers[0]!.stride).toBe(4);
    expect(a[0]!.samplers[0]!.interpolation).toBe('LINEAR');
    expect(a[0]!.samplers[1]!.stride).toBe(3);
    expect(a[0]!.samplers[1]!.interpolation).toBe('STEP');
  });

  it('samples LINEAR rotations with slerp and STEP translations', () => {
    const a = parseGlb(skinned()).animations[0]!;
    const q = [0, 0, 0, 0];
    sampleAnim(a.samplers[0]!, 0.25, q, true); // halfway to 90° about Z → 45°
    expect(q[2]).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(q[3]).toBeCloseTo(Math.cos(Math.PI / 8));
    sampleAnim(a.samplers[0]!, 5, q, true); // clamped to the last key
    expect(q[2]).toBeCloseTo(1);
    const t = [0, 0, 0];
    sampleAnim(a.samplers[1]!, 1.9, t, false);
    expect(t[1]).toBe(1);
    sampleAnim(a.samplers[1]!, 2, t, false);
    expect(t[1]).toBe(1.5);
  });

  it('rejects mismatched sampler output counts and decreasing times', () => {
    expect(() => parseGlb(skinned({ extra: (j) => { (j['accessors'] as Record<string, unknown>[])[6]!['count'] = 2; } }))).toThrow(/values for 3 keys/);
    expect(() => parseGlb(skinned({ extra: (j) => { (j['animations'] as { samplers: { interpolation?: string }[] }[])[0]!.samplers[0]!.interpolation = 'BEZIER'; } }))).toThrow(GlbError);
  });

  it('files without skins or animations parse to empty lists', () => {
    const glb = parseGlb(encodeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'a' }] }));
    expect(glb.skins).toEqual([]);
    expect(glb.animations).toEqual([]);
    expect(glb.nodes[0]!.scale).toEqual([1, 1, 1]);
  });
});

describe('helpers', () => {
  it('decomposeTrs inverts a TRS matrix', () => {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    // rotation 0.6 rad about Y, scale (2, 3, 4), translation (1, 2, 3)
    const m = new Float32Array([Math.cos(0.6) * 2, 0, -Math.sin(0.6) * 2, 0, 0, 3, 0, 0, Math.sin(0.6) * 4, 0, Math.cos(0.6) * 4, 0, 1, 2, 3, 1]);
    const d = decomposeTrs(m);
    expect(d.t).toEqual([1, 2, 3]);
    expect(d.s[0]).toBeCloseTo(2); expect(d.s[1]).toBeCloseTo(3); expect(d.s[2]).toBeCloseTo(4);
    expect(d.r[1]).toBeCloseTo(s); expect(d.r[3]).toBeCloseTo(c);
  });

  it('slerpInto takes the short way round', () => {
    const o = [0, 0, 0, 0];
    slerpInto(o, [0, 0, 0, 1], [0, 0, 0, -1], 0.5);
    expect(Math.abs(o[3]!)).toBeCloseTo(1);
  });

  it('encodeGlb round-trips non-ASCII names', () => {
    const glb = parseGlb(encodeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'Möchi·ü' }] }));
    expect(glb.nodes[0]!.name).toBe('Möchi·ü');
  });
});

/** One triangle with two morph targets: a dense POSITION target and a sparse one (no base view). */
function morphGlb(opts: { names?: boolean; scale?: number; badIndex?: boolean; withBase?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  let off = 0;
  const add = (a: ArrayBufferView): number => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const pad = (4 - (b.byteLength % 4)) % 4;
    parts.push(b, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength });
    off += b.byteLength + pad;
    return views.length - 1;
  };
  const pos = add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const dense = add(new Float32Array([0, 0.1, 0, 0, 0.2, 0, 0, 0.3, 0]));
  const spIdx = add(new Uint16Array([opts.badIndex ? 7 : 2]));
  const spVal = add(new Float32Array([0, 0, 0.5]));
  const base = add(new Float32Array([0.01, 0, 0, 0.01, 0, 0, 0.01, 0, 0]));
  const json = {
    asset: { version: '2.0' },
    nodes: [{ name: 'face', mesh: 0, scale: [opts.scale ?? 1, opts.scale ?? 1, opts.scale ?? 1] }],
    meshes: [{
      name: 'face', weights: [0.25, 0],
      ...(opts.names === false ? {} : { extras: { targetNames: ['sk_happy', 'sk_blink_l'] } }),
      primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }, { POSITION: 2 }] }],
    }],
    buffers: [{ byteLength: off }],
    bufferViews: views,
    accessors: [
      { bufferView: pos, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: dense, componentType: 5126, count: 3, type: 'VEC3' },
      {
        ...(opts.withBase ? { bufferView: base } : {}), componentType: 5126, count: 3, type: 'VEC3',
        sparse: { count: 1, indices: { bufferView: spIdx, componentType: 5123 }, values: { bufferView: spVal } },
      },
    ],
  };
  const bin = new Uint8Array(off);
  let o = 0;
  for (const c of parts) { bin.set(c, o); o += c.byteLength; }
  return encodeGlb(json, bin);
}

describe('parseGlb morph targets', () => {
  it('reads dense and sparse POSITION targets, names and default weights', () => {
    const m = parseGlb(morphGlb()).meshes[0]!;
    expect(m.targetNames).toEqual(['sk_happy', 'sk_blink_l']);
    expect(m.targetWeights).toEqual([0.25, 0]);
    const t = m.primitives[0]!.targets;
    expect(t).toHaveLength(2);
    expect(Array.from(t[0]!.positions!).map((v) => +v.toFixed(3))).toEqual([0, 0.1, 0, 0, 0.2, 0, 0, 0.3, 0]);
    expect(Array.from(t[1]!.positions!)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0.5]); // sparse over zeros
    expect(t[1]!.normals).toBeNull();
  });

  it('applies sparse values over a base bufferView', () => {
    const t = parseGlb(morphGlb({ withBase: true })).meshes[0]!.primitives[0]!.targets[1]!;
    expect(Array.from(t.positions!).map((v) => +v.toFixed(3))).toEqual([0.01, 0, 0, 0.01, 0, 0, 0, 0, 0.5]);
  });

  it('scales deltas by the node transform (no translation) and names unnamed targets', () => {
    const m = parseGlb(morphGlb({ scale: 2, names: false })).meshes[0]!;
    expect(m.targetNames).toEqual(['target_0', 'target_1']);
    expect(m.primitives[0]!.targets[1]!.positions![8]).toBeCloseTo(1);
  });

  it('rejects sparse indices out of range', () => {
    expect(() => parseGlb(morphGlb({ badIndex: true }))).toThrow(/sparse index/);
  });

  it('meshes without targets report none', () => {
    const m = parseGlb(skinned()).meshes[0]!;
    expect(m.targetNames).toEqual([]);
    expect(m.primitives[0]!.targets).toEqual([]);
  });
});
