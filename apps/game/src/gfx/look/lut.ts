// Per-environment warm grading LUT (RENDERING §9: 32³, applied after the PBR Neutral tonemap in display
// space). Generated from a few grade parameters (the Studio's is neutral), or loaded from a `.cube` file
// (`lut_<set>.cube`, E3b) when the set ships one.

export const LUT_SIZE = 32;

export interface Grade {
  /** Blender-style lift / gamma / gain (per channel; lift 1 = none). */
  readonly lift: readonly [number, number, number];
  readonly gamma: readonly [number, number, number];
  readonly gain: readonly [number, number, number];
  /** Highlight warmth and shadow teal (0..1), saturation (1 = none), S-curve contrast (0 = none). */
  readonly warm: number; readonly teal: number; readonly sat: number; readonly contrast: number;
}

export const NEUTRAL_GRADE: Grade = { lift: [1, 1, 1], gamma: [1, 1, 1], gain: [1, 1, 1], warm: 0, teal: 0, sat: 1, contrast: 0 };

export function gradeColor(g: Grade, c: readonly number[]): [number, number, number] {
  let o = [0, 1, 2].map((i) => {
    const x = c[i]!;
    const lg = Math.max(0, g.gain[i]! * (x + (g.lift[i]! - 1) * (1 - x)));
    return lg ** (1 / g.gamma[i]!);
  });
  const lum = 0.2126 * o[0]! + 0.7152 * o[1]! + 0.0722 * o[2]!;
  const ss = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hi = ss(0.45, 1.0, lum) * g.warm, lo = (1 - ss(0.0, 0.4, lum)) * g.teal;
  o = [o[0]! + hi * 0.06 - lo * 0.025, o[1]! + hi * 0.02 + lo * 0.01, o[2]! - hi * 0.05 + lo * 0.02];
  const l2 = 0.2126 * o[0]! + 0.7152 * o[1]! + 0.0722 * o[2]!;
  o = o.map((x) => l2 + (x - l2) * g.sat);
  if (g.contrast) o = o.map((x) => { const t = Math.min(1, Math.max(0, x)); const s = t * t * (3 - 2 * t); return t + (s - t) * g.contrast; });
  return o.map((x) => Math.min(1, Math.max(0, x))) as [number, number, number];
}

/** 32³ RGBA8 texels (r fastest, then g, then b). */
export function gradeTable(g: Grade): Uint8Array {
  const n = LUT_SIZE, out = new Uint8Array(n * n * n * 4);
  for (let b = 0; b < n; b++) for (let gg = 0; gg < n; gg++) for (let r = 0; r < n; r++) {
    const c = gradeColor(g, [r / (n - 1), gg / (n - 1), b / (n - 1)]);
    const o = ((b * n + gg) * n + r) * 4;
    out[o] = Math.round(c[0] * 255); out[o + 1] = Math.round(c[1] * 255); out[o + 2] = Math.round(c[2] * 255); out[o + 3] = 255;
  }
  return out;
}

/** Parses an Adobe/Resolve `.cube` 3D LUT and resamples it to 32³. */
export function parseCube(text: string): Uint8Array | null {
  let size = 0;
  const vals: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(t);
    if (m) { size = Number(m[1]); continue; }
    if (/^[A-Z_]/i.test(t)) continue;
    const p = t.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) vals.push(p[0]!, p[1]!, p[2]!);
  }
  if (!size || vals.length < size * size * size * 3) return null;
  const n = LUT_SIZE, out = new Uint8Array(n * n * n * 4);
  const at = (r: number, g: number, b: number, k: number): number => vals[((b * size + g) * size + r) * 3 + k]!;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const f = (i: number): [number, number, number] => { const x = (i / (n - 1)) * (size - 1); const i0 = Math.min(size - 2, Math.floor(x)); return [i0, i0 + 1, x - i0]; };
    const [r0, r1, fr] = f(r), [g0, g1, fg] = f(g), [b0, b1, fb] = f(b);
    const o = ((b * n + g) * n + r) * 4;
    for (let k = 0; k < 3; k++) {
      const c00 = at(r0, g0, b0, k) * (1 - fr) + at(r1, g0, b0, k) * fr, c10 = at(r0, g1, b0, k) * (1 - fr) + at(r1, g1, b0, k) * fr;
      const c01 = at(r0, g0, b1, k) * (1 - fr) + at(r1, g0, b1, k) * fr, c11 = at(r0, g1, b1, k) * (1 - fr) + at(r1, g1, b1, k) * fr;
      const v = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
      out[o + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    out[o + 3] = 255;
  }
  return out;
}

export function lutTexture(d: GPUDevice, table: Uint8Array): GPUTexture {
  const n = LUT_SIZE;
  const tex = d.createTexture({ label: 'lut', size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  d.queue.writeTexture({ texture: tex }, table, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
  return tex;
}

/** A 32 × 32³ PNG strip LUT (`lut_<set>.png`, E3b): x = r + 32·b, y = g. Returns the 32³ RGBA8 table. */
export async function loadLutStrip(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('html')) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const n = LUT_SIZE;
    if (bmp.width !== n * n || bmp.height !== n) return null;
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = new Uint8Array(n * n * n * 4);
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const s = (g * n * n + b * n + r) * 4, o = ((b * n + g) * n + r) * 4;
      out[o] = px[s]!; out[o + 1] = px[s + 1]!; out[o + 2] = px[s + 2]!; out[o + 3] = 255;
    }
    return out;
  } catch {
    return null;
  }
}
