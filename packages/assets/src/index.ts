// @knockon/assets: readers for the art pipeline's outputs (assets/build/parts/<type>/, ASSET_PIPELINE §8).
import { parseArtJson, parseShapesJson } from './art.ts';
import type { ArtJson, ShapesJson } from './art.ts';
import { parseGlb } from './glb.ts';
import type { ParsedGlb } from './glb.ts';

export * from './art.ts';
export * from './glb.ts';

/** Minimal fetch shape so this package needs neither DOM nor Node typings. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface PartAssets {
  type: string;
  glb: ParsedGlb;
  art: ArtJson;
  shapes: ShapesJson;
}

export function partAssetUrls(baseUrl: string, type: string): { glb: string; art: string; shapes: string } {
  const base = `${baseUrl.replace(/\/+$/, '')}/parts/${type}/${type}`;
  return { glb: `${base}.glb`, art: `${base}.art.json`, shapes: `${base}.shapes.json` };
}

/** Loads all three files and cross-checks them; any failure rejects (never partially load). */
export async function loadPartAssets(type: string, opts: { baseUrl: string; fetch: FetchLike }): Promise<PartAssets> {
  const urls = partAssetUrls(opts.baseUrl, type);
  const get = async (url: string) => {
    const res = await opts.fetch(url);
    if (!res.ok) throw new Error(`asset fetch failed: ${url} (${res.status})`);
    return res;
  };
  const [glbRes, artRes, shapesRes] = await Promise.all([get(urls.glb), get(urls.art), get(urls.shapes)]);
  const [glbBytes, artText, shapesText] = await Promise.all([glbRes.arrayBuffer(), artRes.text(), shapesRes.text()]);
  return assemblePartAssets(type, glbBytes, JSON.parse(artText), JSON.parse(shapesText));
}

export function assemblePartAssets(type: string, glbBytes: ArrayBuffer | Uint8Array, artJson: unknown, shapesJson: unknown): PartAssets {
  const art = parseArtJson(artJson);
  const shapes = parseShapesJson(shapesJson);
  if (art.type !== type || shapes.type !== type) {
    throw new Error(`asset type mismatch: wanted ${type}, art says ${art.type}, shapes says ${shapes.type}`);
  }
  const glb = parseGlb(glbBytes);
  for (let lod = 0; lod < art.lods.length; lod++) {
    const tris = glb.meshes.filter((m) => m.lod === lod).reduce((s, m) => s + m.primitives.reduce((t, p) => t + p.triangleCount, 0), 0);
    if (tris !== art.lods[lod]!.tris) {
      throw new Error(`${type}: LOD${lod} has ${tris} triangles in the glb but ${art.lods[lod]!.tris} in .art.json`);
    }
  }
  return { type, glb, art, shapes };
}
