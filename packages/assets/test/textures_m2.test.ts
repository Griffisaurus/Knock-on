// M4 stream E4c: the M2 parts' texture pass (PRODUCTION §3, D78, D95; ASSET_PIPELINE §5.2, validator rule 13).
// Every one of the 29 M2 parts carries a unique set: `.art.json textures` names three 8-bit RGB PNGs next to the
// glb, square at the class size (PEDAL RIG, brief class XL, takes L's 2048²: the renderer's arrays are 1024² /
// 2048²); the covered masters carry extras.texSet and their primitives have TEXCOORD_0 in 0..1 and TANGENT on all
// four LODs; albedo stays in linear 0.03-0.85; every slot's mean albedo over the texels its LOD0 triangles cover is
// within ±4 % value of its master (independent of Blender: PNGs decoded with node:zlib, triangles rasterised from
// the glb); ORM metallic is 0 or 1; the normal map is tangent space. The texture pass must not drop what the M2
// parts already ship: shape keys (morph targets) on the six spring / iris parts, FISHBOWL's fracture chunks and
// GUTTER's sweep profile.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseArtJson, parseGlb, type ArtJson, type ParsedGlb } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const M2 = ['stitch', 'fuzz', 'pig_iron', 'gutter', 'vortex', 'sprong', 'trap_box', 'scoop', 'flap', 'dynamo',
  'hamster_drive', 'turbine', 'pedal_rig', 'puffer', 'cell', 'suncell', 'lamp', 'torch', 'burning_glass', 'toggle',
  'ringer', 'delay', 't_plunger', 'skyrocket', 'big_top', 'cork_blaster', 'punchline', 'gotcha_box', 'fishbowl'];
const EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;
const CLASS_SIZE: Record<string, number> = { S: 1024, M: 2048, L: 2048 };
const SIZE_OVERRIDE: Record<string, number> = { pedal_rig: 2048 };
const MORPHS: Record<string, string[]> = {
  sprong: ['sk_depress'], puffer: ['sk_squash', 'sk_spring'], big_top: ['sk_iris'], cork_blaster: ['sk_compress'],
  punchline: ['sk_compress'], gotcha_box: ['sk_stretch'],
};

interface Png { w: number; h: number; data: Uint8Array }

/** Minimal PNG decoder (8-bit RGB / RGBA, filters 0-4, no interlace). */
function decodePng(buf: Buffer): Png {
  let off = 8, w = 0, h = 0, ctype = 2;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const tag = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (tag === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ctype = body[9]!; }
    if (tag === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : 3;
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
  if (bpp === 3) return { w, h, data: out };
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set(out.subarray(i * 4, i * 4 + 3), i * 3);
  return { w, h, data: rgb };
}

const LUT = Float64Array.from({ length: 256 }, (_, v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });

function percentile(xs: Float64Array, q: number): number {
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** kn_tools textures.fit_range: the master swatch as the set must keep it (peak <= 0.85; rubber lifted to 0.045). */
function refPeak(c: readonly number[]): number {
  const m = Math.max(c[0]!, c[1]!, c[2]!);
  return m > 0.85 ? 0.85 : m < 0.045 ? 0.045 : m;
}

/** Texel indices whose centres lie inside the UV triangle (glTF UVs: row = v * size, top-first like the PNG). */
function raster(u: number[], v: number[], w: number, h: number, into: Set<number>): void {
  const x0 = Math.max(0, Math.floor(Math.min(...u) - 0.5)), x1 = Math.min(w - 1, Math.ceil(Math.max(...u) - 0.5));
  const y0 = Math.max(0, Math.floor(Math.min(...v) - 0.5)), y1 = Math.min(h - 1, Math.ceil(Math.max(...v) - 0.5));
  const e = (i: number, j: number, X: number, Y: number) => (u[j]! - u[i]!) * (Y - v[i]!) - (v[j]! - v[i]!) * (X - u[i]!);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const d1 = e(0, 1, X, Y), d2 = e(1, 2, X, Y), d3 = e(2, 0, X, Y);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) into.add(y * w + x);
    }
  }
}

function load(type: string): { art: ArtJson; glb: ParsedGlb; json: { meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[] }; dir: string } | null {
  const dir = join(BUILD, type);
  const base = join(dir, type);
  if (!existsSync(`${base}.glb`) || !existsSync(`${base}.art.json`)) return null;
  const buf = readFileSync(`${base}.glb`);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return { art: parseArtJson(JSON.parse(readFileSync(`${base}.art.json`, 'utf8'))), glb: parseGlb(buf), json, dir };
}

const present = M2.filter((t) => load(t) !== null);
if (present.length < M2.length) console.warn(`[assets] M2 builds missing: ${M2.filter((t) => !present.includes(t)).join(', ')}`);

describe('M2 texture pass (M4 E4c, ASSET_PIPELINE §5.2)', () => {
  it('every M2 part carries a texture set', () => {
    expect(present.filter((t) => !load(t)!.art.textures)).toEqual([]);
  });

  it.each(present)('%s: three 8-bit RGB PNGs named <type>.tex.{albedo,normal,orm}.png, square, at the class size', (type) => {
    const { art, dir } = load(type)!;
    const tx = art.textures!;
    expect(tx, 'texture set').toBeDefined();
    expect([tx.albedo, tx.normal, tx.orm]).toEqual([`${type}.tex.albedo.png`, `${type}.tex.normal.png`, `${type}.tex.orm.png`]);
    expect(tx.size).toBe(SIZE_OVERRIDE[type] ?? CLASS_SIZE[art.class]);
    expect(tx.set).toBe('body');
    for (const f of [tx.albedo, tx.normal, tx.orm]) {
      const b = readFileSync(join(dir, f));
      expect([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]], f).toEqual([tx.size, tx.size, 8, 2]);
    }
    expect(tx.slots.length).toBeGreaterThan(0);
    for (const s of tx.slots) expect(s, 'exempt masters take no set').not.toMatch(EXEMPT);
  });

  it.each(present)('%s: covered masters carry texSet; their primitives have TEXCOORD_0 in 0..1 and TANGENT on every LOD', (type) => {
    const { art, glb, json } = load(type)!;
    const slots = new Set(art.textures!.slots);
    for (const m of glb.materials) {
      if (slots.has(m.name)) expect(m.texSet, m.name).toBe('body');
      else expect(m.texSet, m.name).toBeUndefined();
    }
    const lods = new Set<number>();
    for (const mesh of glb.meshes) {
      for (const p of mesh.primitives) {
        if (glb.materials[p.material]?.texSet === undefined) continue;
        lods.add(mesh.lod);
        expect(p.uvs, `${mesh.nodeName}: TEXCOORD_0`).not.toBeNull();
        let lo = Infinity, hi = -Infinity;
        for (const u of p.uvs!) { if (u < lo) lo = u; if (u > hi) hi = u; }
        expect(lo).toBeGreaterThanOrEqual(-1e-4);
        expect(hi).toBeLessThanOrEqual(1 + 1e-4);
      }
    }
    expect([...lods].sort()).toEqual([0, 1, 2, 3]);
    // TANGENT (MikkTSpace, the frame the bake used) on every glTF primitive that samples the set
    let textured = 0;
    for (const jm of json.meshes) {
      for (const p of jm.primitives) {
        if (p.material === undefined || !glb.materials[p.material]?.texSet) continue;
        textured++;
        expect(p.attributes.TANGENT, 'TANGENT on a textured primitive').toBeDefined();
      }
    }
    expect(textured).toBeGreaterThan(0);
  });

  it.each(present)('%s: albedo in linear 0.03-0.85, slot means within ±4 % of the master, ORM metallic 0 or 1, normal map tangent-space', (type) => {
    const { art, glb, dir } = load(type)!;
    const tx = art.textures!;
    const alb = decodePng(readFileSync(join(dir, tx.albedo)));
    const n = alb.w * alb.h;
    const peak = new Float64Array(n);
    for (let i = 0; i < n; i++) peak[i] = Math.max(LUT[alb.data[i * 3]!]!, LUT[alb.data[i * 3 + 1]!]!, LUT[alb.data[i * 3 + 2]!]!);
    expect(percentile(peak, 0.99)).toBeLessThanOrEqual(0.855);
    expect(percentile(peak, 0.01)).toBeGreaterThanOrEqual(0.027);
    // per slot: mean over the texels whose centres fall inside the slot's visible LOD0 triangles (validator rule 13's
    // measure). Interior faces live in 4-texel strip cells along the top (`textures.hiddenRows`, raw .art.json):
    // like rule 13, the mean leaves them out
    const hiddenRows = (JSON.parse(readFileSync(join(dir, `${type}.art.json`), 'utf8')).textures?.hiddenRows ?? 0) as number;
    const texels = new Map<number, Set<number>>();
    for (const mesh of glb.meshes) {
      if (mesh.lod !== 0) continue;
      for (const p of mesh.primitives) {
        if (!glb.materials[p.material]?.texSet || !p.uvs) continue;
        const set = texels.get(p.material) ?? new Set<number>();
        texels.set(p.material, set);
        for (let t = 0; t < p.indices.length; t += 3) {
          const ids = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!];
          const vs = ids.map((i) => p.uvs![i * 2 + 1]! * alb.h);
          if (Math.max(...vs) <= hiddenRows) continue; // an interior face's strip cell
          raster(ids.map((i) => p.uvs![i * 2]! * alb.w), vs, alb.w, alb.h, set);
        }
      }
    }
    expect(texels.size).toBe(tx.slots.length);
    for (const [mi, set] of texels) {
      const m = glb.materials[mi]!;
      let r = 0, g = 0, b = 0;
      for (const i of set) { r += LUT[alb.data[i * 3]!]!; g += LUT[alb.data[i * 3 + 1]!]!; b += LUT[alb.data[i * 3 + 2]!]!; }
      const k = Math.max(set.size, 1);
      const dv = Math.max(r / k, g / k, b / k) / refPeak(m.baseColorFactor) - 1;
      expect(Math.abs(dv), `${m.name} slot mean value ${(dv * 100).toFixed(1)} % from the master`).toBeLessThanOrEqual(0.04);
    }
    const orm = decodePng(readFileSync(join(dir, tx.orm)));
    let mid = 0;
    for (let i = 0; i < n; i++) { const v = orm.data[i * 3 + 2]!; if (v > 25 && v < 230) mid++; }
    expect(mid / n, 'metallic between 0 and 1').toBeLessThan(0.002);
    const nrm = decodePng(readFileSync(join(dir, tx.normal)));
    let sr = 0, sg = 0, sb = 0, back = 0;
    for (let i = 0; i < n; i++) {
      sr += nrm.data[i * 3]!; sg += nrm.data[i * 3 + 1]!; sb += nrm.data[i * 3 + 2]!;
      if (nrm.data[i * 3 + 2]! < 128) back++;
    }
    expect(Math.abs(sr / n / 255 - 0.5)).toBeLessThan(0.06);
    expect(Math.abs(sg / n / 255 - 0.5)).toBeLessThan(0.06);
    expect(sb / n / 255).toBeGreaterThan(0.85);
    expect(back / n, 'normals pointing into the surface').toBeLessThan(0.001);
  });

  it.each(present)('%s: island gaps and the interior strip carry no normal-map noise (clean mips and BC7 blocks)', (type) => {
    // V4 (BC7) found per-texel noise in the gaps of baked normal maps. Gap texels (centre outside every visible
    // triangle of every LOD) are push-pulled from the islands, so neighbouring gap texels stay close; the interior
    // strip (hiddenRows) is flat
    const { art, glb, dir } = load(type)!;
    const tx = art.textures!;
    const hiddenRows = (JSON.parse(readFileSync(join(dir, `${type}.art.json`), 'utf8')).textures?.hiddenRows ?? 0) as number;
    const nrm = decodePng(readFileSync(join(dir, tx.normal)));
    const { w, h } = nrm;
    const inside = new Set<number>();
    for (const mesh of glb.meshes) {
      for (const p of mesh.primitives) {
        if (!glb.materials[p.material]?.texSet || !p.uvs) continue;
        for (let t = 0; t < p.indices.length; t += 3) {
          const ids = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!];
          const vs = ids.map((i) => p.uvs![i * 2 + 1]! * h);
          if (Math.max(...vs) <= hiddenRows) continue;
          raster(ids.map((i) => p.uvs![i * 2]! * w), vs, w, h, inside);
        }
      }
    }
    const vec = (i: number): [number, number, number] => {
      const x = nrm.data[i * 3]! / 127.5 - 1, y = nrm.data[i * 3 + 1]! / 127.5 - 1, z = nrm.data[i * 3 + 2]! / 127.5 - 1;
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    // noise = a gap texel more than 30° off all four of its neighbours (push-pull fill meets in soft steps where
    // two islands' fills touch; those are edges, not noise). Counted in the gutters proper: texels with no island
    // texel among their 8 neighbours (a texel hugging a sliver island takes that island's tilt; PEDAL RIG and PUFFER
    // have one such texel each)
    const cos30 = Math.cos(Math.PI / 6);
    let gap = 0, noisy = 0;
    for (let y = Math.max(hiddenRows, 1); y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (inside.has(i)) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (inside.has(i + dy * w + dx)) { touches = true; break; }
        if (touches) continue;
        gap++;
        const a = vec(i);
        let off = 0;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          const b = vec(j);
          if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < cos30) off++;
        }
        if (off === 4) noisy++;
      }
    }
    expect(gap).toBeGreaterThan(0);
    expect(noisy, `${noisy} of ${gap} gap texels are lone outliers`).toBe(0);
    let flat = 0;
    for (let i = 0; i < hiddenRows * w; i++) if (Math.abs(nrm.data[i * 3]! - 128) <= 1 && Math.abs(nrm.data[i * 3 + 1]! - 128) <= 1 && nrm.data[i * 3 + 2]! === 255) flat++;
    expect(flat, 'interior strip normals are flat').toBe(hiddenRows * w);
  });

  it.each(Object.keys(MORPHS).filter((t) => present.includes(t)))('%s: shape keys survive the texture pass (morph targets on LOD0 and LOD1)', (type) => {
    const { glb } = load(type)!;
    for (const lod of [0, 1]) {
      const names = new Set(glb.meshes.filter((m) => m.lod === lod).flatMap((m) => m.targetNames));
      for (const k of MORPHS[type]!) expect(names.has(k), `LOD${lod} ${k}`).toBe(true);
    }
    for (const m of glb.meshes) {
      if (!m.targetNames.length) continue;
      for (const p of m.primitives) {
        expect(p.targets.length).toBe(m.targetNames.length);
        for (const t of p.targets) {
          expect(t.positions!.length).toBe(p.positions.length);
          let mx = 0;
          for (const d of t.positions!) mx = Math.max(mx, Math.abs(d));
          expect(Number.isFinite(mx)).toBe(true);
        }
      }
      expect(m.primitives.some((p) => p.targets.some((t) => t.positions!.some((d) => Math.abs(d) > 1e-4))), `${m.nodeName} moves`).toBe(true);
    }
  });

  it('fishbowl keeps its fracture set; gutter keeps its sweep profile', () => {
    if (present.includes('fishbowl')) {
      const frac = parseGlb(readFileSync(join(BUILD, 'fishbowl', 'fishbowl.frac.glb')));
      expect(new Set(frac.meshes.map((m) => m.nodeName).filter((n) => /^FRAC__/.test(n))).size).toBe(21);
      for (const m of frac.materials) expect(m.texSet, 'fracture chunks are untextured (glass + interior)').toBeUndefined();
    }
    if (present.includes('gutter')) {
      const prof = JSON.parse(readFileSync(join(BUILD, 'gutter', 'gutter.profile.json'), 'utf8'));
      expect(Object.keys(prof.profiles).sort()).toEqual(['gutter', 'gutter_slim']);
    }
  });
});
