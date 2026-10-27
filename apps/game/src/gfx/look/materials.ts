// Master material → detail layer (RENDERING §6.1 DETAIL_LAYER, ASSET_PIPELINE §5.1 "Extras"), the
// texture-set flag per material (contract 1: `texSet` on the glb material extras; read from the raw glb
// JSON because the typed parser keeps only the PBR factors), and the vertex kind byte that carries both.

import type { GlbMesh } from '@knockon/assets';
import { DETAIL } from './wgsl.ts';

/** Masters that never take a texture set (ASSET_PIPELINE §5.2 "Exempt"). */
export const EXEMPT = /^kn_(poly_|glass|interior_glass|chrome|led|screen|decal|port|kit_)/;

/** Detail id for a master; `ext` = the primitive's local AABB extents (wood grain follows the long axis). */
export function detailFor(name: string, ext: readonly number[]): number {
  if (/^kn_(powder|env_.*(enamel|paint|metal))/.test(name)) return DETAIL.peel;
  if (/^kn_(wood|env_.*(oak|wood|floorboard|bench))/.test(name)) {
    const [x, y, z] = ext as [number, number, number];
    return x >= y && x >= z ? DETAIL.woodX : y >= z ? DETAIL.woodY : DETAIL.woodZ;
  }
  if (/^kn_iron_cast/.test(name)) return DETAIL.pitting;
  if (/^kn_(steel|anod|brass|copper)/.test(name)) return DETAIL.brushed;
  if (/^kn_(paper|cardboard|env_.*(paper|poster|chalkboard))/.test(name)) return DETAIL.paper;
  if (/^kn_rubber/.test(name)) return DETAIL.rubber;
  if (/^kn_(rope|fuse_cord)/.test(name)) return DETAIL.twist;
  if (/^kn_brick/.test(name)) return DETAIL.brick;
  if (/^kn_env_.*plaster/.test(name)) return DETAIL.plaster;
  return DETAIL.none;
}

/** Vertex `mats[3]` (kind) for a master with this detail, and for a textured master (layer in mats[0..1]). */
export const masterKind = (detail: number): number => (255 - detail) / 255;
export const texSetKind = (detail: number): number => (223 - detail) / 255;
export const layerBytes = (layer: number): [number, number] => [(layer & 255) / 255, ((layer >> 8) & 255) / 255];

/** Material names flagged `extras.texSet` in a glb's JSON chunk (null when the file has no such flags). */
export function texSetMaterials(glb: ArrayBuffer): Set<string> | null {
  try {
    const dv = new DataView(glb);
    if (dv.getUint32(0, true) !== 0x46546c67) return null;
    const len = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, len))) as { materials?: { name?: string; extras?: { texSet?: unknown } }[] };
    const out = new Set<string>();
    let any = false;
    for (const m of json.materials ?? []) {
      if (m.extras && 'texSet' in m.extras) { any = true; if (m.extras.texSet) out.add(m.name ?? ''); }
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

/** How glbLods encodes a primitive's material look (glbmesh.ts). */
export interface MaterialLook {
  /** Texture-set array layer for this material, or −1. */
  layer(name: string): number;
  /** glTF TANGENT per mesh and primitive (look/tangents.ts), when the file has them. */
  readonly tangents?: Map<GlbMesh, (Float32Array | null)[]>;
}
