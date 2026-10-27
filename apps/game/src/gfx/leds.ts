// R5 (M5): LED groups on art meshes (ASSET_PIPELINE §3.6: `kn_led` faces carry the vertex colour attribute `led`,
// R = group index / 255, G = default brightness). The typed glb parser doesn't read vertex colours, so this reads them
// from the raw file for the `kn_led` primitives (same mesh and primitive order as the ParsedGlb), like look/tangents.ts.
//
// A skinned critter that gives LED colours (BUZZ: nav, ducts, cargo, strobe) bakes each `kn_led` vertex as a master
// whose emissive byte is 251 + group (skin.ts); the part shader lights it in that colour at the level its instance
// asks for (SceneItem.leds: 2 bits per group, shaders.ts `ledLevel`).

import type { GlbMesh, ParsedGlb } from '@knockon/assets';

type Json = Record<string, unknown>;

/** Per GlbMesh, per primitive: [group, brightness] per vertex for `kn_led` primitives, else null. */
export function glbLedGroups(bytes: ArrayBuffer, glb: ParsedGlb): Map<GlbMesh, (Float32Array | null)[]> {
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
  const mats = (json['materials'] ?? []) as Json[];
  const read = (ai: number): Float32Array | null => {
    const a = accessors[ai];
    if (!a || a['bufferView'] === undefined) return null;
    const ct = a['componentType'] as number, n = a['type'] === 'VEC4' ? 4 : a['type'] === 'VEC3' ? 3 : 0;
    const cs = ct === 5126 ? 4 : ct === 5123 ? 2 : ct === 5121 ? 1 : 0;
    if (!n || !cs) return null;
    const v = views[a['bufferView'] as number]!;
    const count = a['count'] as number;
    const stride = (v['byteStride'] as number | undefined) ?? cs * n;
    const base = binStart + ((v['byteOffset'] as number | undefined) ?? 0) + ((a['byteOffset'] as number | undefined) ?? 0);
    const o = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 2; c++) {
        const p = base + i * stride + c * cs;
        o[i * 2 + c] = cs === 4 ? dv.getFloat32(p, true) : cs === 2 ? dv.getUint16(p, true) / 65535 : dv.getUint8(p) / 255;
      }
    }
    return o;
  };
  for (const m of glb.meshes) {
    const mi = nodes[m.node]?.['mesh'];
    if (typeof mi !== 'number') continue;
    const prims = (meshes[mi]?.['primitives'] ?? []) as Json[];
    out.set(m, prims.map((p) => {
      if (mats[p['material'] as number]?.['name'] !== 'kn_led') return null;
      const attrs = (p['attributes'] ?? {}) as Json;
      // the `led` attribute: the colour set whose R values are all group indices (≤ 15 / 255) and not plain white
      for (const k of ['COLOR_1', 'COLOR_0', 'COLOR_2']) {
        const ai = attrs[k];
        if (typeof ai !== 'number') continue;
        const c = read(ai);
        if (!c) continue;
        let ok = true;
        for (let i = 0; i < c.length; i += 2) if (c[i]! > 15.5 / 255) { ok = false; break; }
        if (ok) { for (let i = 0; i < c.length; i += 2) c[i] = Math.round(c[i]! * 255); return c; }
      }
      return null;
    }));
  }
  return out;
}

/** The emissive byte that marks an LED vertex of group g (0–3) in a skinned critter (skin.ts, shaders.ts). */
export const LED_MARK = 251;

/** SceneItem.leds from four group levels (0 off, 1 dim 8 %, 2 half, 3 full). */
export function ledCode(levels: readonly number[]): number {
  let c = 0;
  for (let g = 0; g < 4; g++) c |= (Math.max(0, Math.min(3, levels[g] ?? 0)) & 3) << (g * 2);
  return c;
}
