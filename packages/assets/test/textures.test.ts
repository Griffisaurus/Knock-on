// M3 stream E3c: per-part texture sets (ASSET_PIPELINE §5.2, D78) as the renderer (stream L3) consumes them.
// For every M1 part: `.art.json textures` names three PNGs next to the glb, all square at the class size; the
// glb materials of the covered masters carry extras.texSet and every primitive drawn with them has TEXCOORD_0
// in 0..1 on all four LODs; albedo stays inside linear 0.03-0.85, ORM metallic is 0 or 1, the normal map is a
// tangent-space map. Parts whose build is missing are skipped with a message.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AssetFormatError, parseArtJson, parseGlb, type ArtJson, type ParsedGlb } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const M1_TEXTURED = ['thud', 'boing', 'helio', 'brik', 'plank', 'slope', 'ledge', 'fulcrum', 'anchor', 'sheave',
  'treadway', 'cog_s', 'cog_m', 'cog_l', 'motor', 'gale', 'mains', 'stomp_pad', 'the_button', 'wick', 'bangstick',
  'snipper', 'topple_tile'];
const EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;
const CLASS_SIZE: Record<string, number> = { S: 1024, M: 2048, L: 2048 };
const INSTANCING = new Set(['brik', 'topple_tile']);

interface Png { w: number; h: number; depth: number; channels: number; data: Uint8Array }

/** Minimal PNG decoder (8/16-bit gray/RGB/RGBA, filters 0-4, no interlace). 16-bit keeps the high byte. */
function decodePng(buf: Buffer): Png {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 8, ctype = 2;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const tag = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (tag === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]!; ctype = body[9]!; if (body[12]) throw new Error('interlaced'); }
    if (tag === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ctype]!;
  const bpp = channels * depth / 8;
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c; const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = (raw[src + x]! + p) & 0xff;
    }
  }
  if (depth === 16) {
    const hi = new Uint8Array(w * h * channels);
    for (let i = 0; i < hi.length; i++) hi[i] = out[i * 2]!;
    return { w, h, depth, channels, data: hi };
  }
  return { w, h, depth, channels, data: out };
}

const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

function percentile(xs: Float64Array, q: number): number {
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

function load(type: string): { art: ArtJson; glb: ParsedGlb; dir: string } | null {
  const dir = join(BUILD, type);
  const base = join(dir, type);
  if (!existsSync(`${base}.glb`) || !existsSync(`${base}.art.json`)) return null;
  return { art: parseArtJson(JSON.parse(readFileSync(`${base}.art.json`, 'utf8'))), glb: parseGlb(readFileSync(`${base}.glb`)), dir };
}

const built = M1_TEXTURED.filter((t) => load(t)?.art.textures !== undefined);
const untextured = M1_TEXTURED.filter((t) => !built.includes(t));
if (untextured.length) console.warn(`[assets] no texture set for ${untextured.join(', ')} (node tools/assets.mjs <type> --tex)`);

describe('texture sets (M3 E3c, ASSET_PIPELINE §5.2)', () => {
  it('parseArtJson reads textures and rejects a non-array size', () => {
    const art = JSON.parse(readFileSync(join(BUILD, 'thud', 'thud.art.json'), 'utf8'));
    if (!art.textures) return;
    expect(parseArtJson(art).textures?.albedo).toBe('thud.tex.albedo.png');
    expect(() => parseArtJson({ ...art, textures: { ...art.textures, size: 1000 } })).toThrow(AssetFormatError);
  });

  it.each(built)('%s: three PNGs named <type>.tex.{albedo,normal,orm}.png, square, at the class size', (type) => {
    const { art, dir } = load(type)!;
    const tx = art.textures!;
    expect(tx.albedo).toBe(`${type}.tex.albedo.png`);
    expect(tx.normal).toBe(`${type}.tex.normal.png`);
    expect(tx.orm).toBe(`${type}.tex.orm.png`);
    expect(tx.size).toBe(INSTANCING.has(type) ? 1024 : CLASS_SIZE[art.class]);
    for (const f of [tx.albedo, tx.normal, tx.orm]) {
      const b = readFileSync(join(dir, f));
      expect(b.readUInt32BE(16), f).toBe(tx.size);
      expect(b.readUInt32BE(20), f).toBe(tx.size);
      expect(b[24], `${f} bit depth`).toBe(8);
      expect(b[25], `${f} colour type RGB`).toBe(2);
    }
    expect(tx.slots.length).toBeGreaterThan(0);
    for (const s of tx.slots) expect(s, 'exempt masters take no set').not.toMatch(EXEMPT);
  });

  it.each(built)('%s: covered masters carry extras.texSet; their primitives have TEXCOORD_0 in 0..1 on every LOD', (type) => {
    const { art, glb } = load(type)!;
    const slots = new Set(art.textures!.slots);
    for (const m of glb.materials) {
      if (slots.has(m.name)) expect(m.texSet, m.name).toBe(art.textures!.set);
      else expect(m.texSet, m.name).toBeUndefined();
    }
    const lods = new Set<number>();
    for (const mesh of glb.meshes) {
      for (const p of mesh.primitives) {
        if (glb.materials[p.material]?.texSet === undefined) continue;
        lods.add(mesh.lod);
        expect(p.uvs, `${mesh.nodeName}: textured primitive needs TEXCOORD_0`).not.toBeNull();
        let lo = Infinity, hi = -Infinity;
        for (const u of p.uvs!) { if (u < lo) lo = u; if (u > hi) hi = u; }
        expect(lo).toBeGreaterThanOrEqual(-1e-4);
        expect(hi).toBeLessThanOrEqual(1 + 1e-4);
      }
    }
    expect([...lods].sort()).toEqual([0, 1, 2, 3]);
  });

  it.each(built)('%s: albedo in linear 0.03-0.85, ORM metallic 0 or 1, normal map tangent-space', (type) => {
    const { art, dir } = load(type)!;
    const tx = art.textures!;
    const alb = decodePng(readFileSync(join(dir, tx.albedo)));
    const n = alb.w * alb.h;
    const peak = new Float64Array(n);
    for (let i = 0; i < n; i++) peak[i] = Math.max(lin(alb.data[i * 3]!), lin(alb.data[i * 3 + 1]!), lin(alb.data[i * 3 + 2]!));
    expect(percentile(peak, 0.99)).toBeLessThanOrEqual(0.855);
    expect(percentile(peak, 0.01)).toBeGreaterThanOrEqual(0.027);
    const orm = decodePng(readFileSync(join(dir, tx.orm)));
    let mid = 0;
    for (let i = 0; i < n; i++) { const m = orm.data[i * 3 + 2]!; if (m > 25 && m < 230) mid++; }
    expect(mid / n, 'metallic between 0 and 1').toBeLessThan(0.002);
    const nrm = decodePng(readFileSync(join(dir, tx.normal)));
    let r = 0, g = 0, b = 0, back = 0;
    for (let i = 0; i < n; i++) {
      r += nrm.data[i * 3]!; g += nrm.data[i * 3 + 1]!; b += nrm.data[i * 3 + 2]!;
      if (nrm.data[i * 3 + 2]! < 128) back++;
    }
    expect(Math.abs(r / n / 255 - 0.5)).toBeLessThan(0.06);
    expect(Math.abs(g / n / 255 - 0.5)).toBeLessThan(0.06);
    expect(b / n / 255).toBeGreaterThan(0.85);
    expect(back / n, 'normals pointing into the surface').toBeLessThan(0.001);
  });
});
