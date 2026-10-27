// glTF TANGENT for textured parts (E3c exports MikkTSpace tangents, the frame its bake used; contract 1).
// The typed glb parser doesn't read TANGENT, so this reads the accessors from the raw file for the primitives
// of a ParsedGlb (same node and primitive order), transformed by each node's world matrix.
//
// The 32-byte vertex has one free 16-bit slot (the normal's snorm16 w), so a tangent is stored there as one
// number: its angle around the normal against a basis derived from the normal, plus the handedness in the
// sign. 0 = no tangent (the shader falls back to a derivative frame). `tangentBasis` must match the WGSL.

import type { GlbMesh, ParsedGlb } from '@knockon/assets';

type Json = Record<string, unknown>;

/** Per GlbMesh, per primitive: xyzw tangents (w = ±1 handedness), or null where the primitive has none. */
export function glbTangents(bytes: ArrayBuffer, glb: ParsedGlb): Map<GlbMesh, (Float32Array | null)[]> {
  const out = new Map<GlbMesh, (Float32Array | null)[]>();
  const dv = new DataView(bytes);
  if (dv.getUint32(0, true) !== 0x46546c67) return out;
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jlen))) as Json;
  const binStart = 20 + jlen + 8;
  const accessors = (json['accessors'] ?? []) as Json[];
  const views = (json['bufferViews'] ?? []) as Json[];
  const nodes = (json['nodes'] ?? []) as Json[];
  const meshes = (json['meshes'] ?? []) as Json[];
  const read = (ai: number): Float32Array | null => {
    const a = accessors[ai];
    if (!a || a['componentType'] !== 5126 || a['type'] !== 'VEC4' || a['bufferView'] === undefined) return null;
    const v = views[a['bufferView'] as number]!;
    const count = a['count'] as number;
    const stride = (v['byteStride'] as number | undefined) ?? 16;
    const base = binStart + ((v['byteOffset'] as number | undefined) ?? 0) + ((a['byteOffset'] as number | undefined) ?? 0);
    const o = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) o[i * 4 + c] = dv.getFloat32(base + i * stride + c * 4, true);
    return o;
  };
  for (const m of glb.meshes) {
    const mi = nodes[m.node]?.['mesh'];
    if (typeof mi !== 'number') continue;
    const prims = (meshes[mi]?.['primitives'] ?? []) as Json[];
    const M = m.matrix;
    out.set(m, prims.map((p) => {
      const ti = (p['attributes'] as Json | undefined)?.['TANGENT'];
      const t = typeof ti === 'number' ? read(ti) : null;
      if (!t) return null;
      for (let i = 0; i < t.length; i += 4) {
        const x = t[i]!, y = t[i + 1]!, z = t[i + 2]!;
        const tx = M[0]! * x + M[4]! * y + M[8]! * z, ty = M[1]! * x + M[5]! * y + M[9]! * z, tz = M[2]! * x + M[6]! * y + M[10]! * z;
        const l = Math.hypot(tx, ty, tz) || 1;
        t[i] = tx / l; t[i + 1] = ty / l; t[i + 2] = tz / l;
      }
      return t;
    }));
  }
  return out;
}

/** The reference axes around a normal (WGSL `tangentBasis` in look/wgsl.ts is the same). */
export function tangentBasis(n: ArrayLike<number>): [number[], number[]] {
  const up = Math.abs(n[1]!) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  let b0 = [up[1]! * n[2]! - up[2]! * n[1]!, up[2]! * n[0]! - up[0]! * n[2]!, up[0]! * n[1]! - up[1]! * n[0]!];
  const l = Math.hypot(b0[0]!, b0[1]!, b0[2]!) || 1;
  b0 = b0.map((x) => x / l);
  const b1 = [n[1]! * b0[2]! - n[2]! * b0[1]!, n[2]! * b0[0]! - n[0]! * b0[2]!, n[0]! * b0[1]! - n[1]! * b0[0]!];
  return [b0, b1];
}

/** One-number tangent code in (−1, −0.01] ∪ [0.01, 1): angle around n, sign = handedness. */
export function tangentCode(n: ArrayLike<number>, t: ArrayLike<number>, w: number): number {
  const [b0, b1] = tangentBasis(n);
  const a = Math.atan2(t[0]! * b1[0]! + t[1]! * b1[1]! + t[2]! * b1[2]!, t[0]! * b0[0]! + t[1]! * b0[1]! + t[2]! * b0[2]!);
  const v = (a / Math.PI + 1) / 2; // 0..1
  return (w < 0 ? -1 : 1) * (0.01 + 0.98 * v);
}
