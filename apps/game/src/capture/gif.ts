// C4 (M4): our own animated GIF encoder (GIF89a; D94: no libraries) and a decoder for tests and verification.
//
// One global palette for the whole clip (no palette flicker between frames): every frame's pixels go through a 4×4
// ordered dither (temporally stable, unlike error diffusion) into a 15-bit colour bin and are kept as one u16 per
// pixel; the undithered bins feed a histogram. At the end, median cut picks 255 colours from the histogram, a
// 32768-entry lookup maps bins to palette entries, and each frame is written as the rectangle that changed since
// the previous one, unchanged pixels transparent (index 255, disposal "leave in place"). LZW is the standard
// variable-width GIF flavour (8-bit minimum code size, clear at 4096 codes).

import { ByteWriter } from './bytes.ts';

export const TRANSPARENT = 255;
const BINS = 32768;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const binOf = (r: number, g: number, b: number): number => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * RGBA → dithered 15-bit bins (one u16 per pixel), adding the undithered bins to `hist`. `dither` 0…1 scales the
 * ordered-dither amplitude (1 = one bin step).
 */
export function toBins(rgba: ArrayLike<number>, w: number, h: number, hist: Uint32Array | null, dither = 1): Uint16Array {
  const out = new Uint16Array(w * h);
  const amp = 8 * dither;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!;
      if (hist) hist[binOf(r, g, b)]!++;
      const d = ((BAYER4[((y & 3) << 2) | (x & 3)]! + 0.5) / 16 - 0.5) * amp;
      const c = (v: number): number => { const q = v + d; return q < 0 ? 0 : q > 255 ? 255 : q | 0; };
      out[i] = binOf(c(r), c(g), c(b));
    }
  }
  return out;
}

interface VBox { lo: [number, number, number]; hi: [number, number, number]; count: number }

/** Median cut over the 15-bit histogram: up to `n` colours (RGB triples), each the weighted mean of its box. */
export function medianCut(hist: Uint32Array, n = 255): Uint8Array {
  const at = (r: number, g: number, b: number): number => hist[(r << 10) | (g << 5) | b]!;
  const shrink = (bx: VBox): VBox | null => {
    const lo: [number, number, number] = [31, 31, 31], hi: [number, number, number] = [0, 0, 0];
    let count = 0;
    for (let r = bx.lo[0]; r <= bx.hi[0]; r++) for (let g = bx.lo[1]; g <= bx.hi[1]; g++) for (let b = bx.lo[2]; b <= bx.hi[2]; b++) {
      const c = at(r, g, b);
      if (!c) continue;
      count += c;
      if (r < lo[0]) lo[0] = r; if (g < lo[1]) lo[1] = g; if (b < lo[2]) lo[2] = b;
      if (r > hi[0]) hi[0] = r; if (g > hi[1]) hi[1] = g; if (b > hi[2]) hi[2] = b;
    }
    return count ? { lo, hi, count } : null;
  };
  const first = shrink({ lo: [0, 0, 0], hi: [31, 31, 31], count: 0 });
  if (!first) return new Uint8Array(3);
  const boxes: VBox[] = [first];
  while (boxes.length < n) {
    // split the box with the most weight × extent along its longest side, at the weighted median
    let best = -1, score = 0;
    boxes.forEach((bx, i) => {
      const ext = Math.max(bx.hi[0] - bx.lo[0], bx.hi[1] - bx.lo[1], bx.hi[2] - bx.lo[2]);
      const s = ext > 0 ? bx.count * (ext + 1) : 0;
      if (s > score) { score = s; best = i; }
    });
    if (best < 0) break;
    const bx = boxes[best]!;
    const ext = [0, 1, 2].map((a) => bx.hi[a]! - bx.lo[a]!);
    const axis = ext.indexOf(Math.max(...ext));
    const plane = new Float64Array(32);
    for (let r = bx.lo[0]; r <= bx.hi[0]; r++) for (let g = bx.lo[1]; g <= bx.hi[1]; g++) for (let b = bx.lo[2]; b <= bx.hi[2]; b++) {
      plane[[r, g, b][axis]!]! += at(r, g, b);
    }
    let acc = 0, cut = bx.lo[axis]!;
    for (let v = bx.lo[axis]!; v < bx.hi[axis]!; v++) { acc += plane[v]!; cut = v; if (acc >= bx.count / 2) break; }
    const aHi: [number, number, number] = [...bx.hi]; aHi[axis] = cut;
    const bLo: [number, number, number] = [...bx.lo]; bLo[axis] = cut + 1;
    const a = shrink({ lo: [...bx.lo], hi: aHi, count: 0 }), b2 = shrink({ lo: bLo, hi: [...bx.hi], count: 0 });
    boxes.splice(best, 1, ...[a, b2].filter((x): x is VBox => x !== null));
  }
  const pal = new Uint8Array(boxes.length * 3);
  boxes.forEach((bx, i) => {
    let sr = 0, sg = 0, sb = 0;
    for (let r = bx.lo[0]; r <= bx.hi[0]; r++) for (let g = bx.lo[1]; g <= bx.hi[1]; g++) for (let b = bx.lo[2]; b <= bx.hi[2]; b++) {
      const c = at(r, g, b);
      sr += c * r; sg += c * g; sb += c * b;
    }
    // bin centre: (v << 3) | 4
    pal[i * 3] = Math.min(255, Math.round((sr / bx.count) * 8 + 4));
    pal[i * 3 + 1] = Math.min(255, Math.round((sg / bx.count) * 8 + 4));
    pal[i * 3 + 2] = Math.min(255, Math.round((sb / bx.count) * 8 + 4));
  });
  return pal;
}

/** Nearest palette entry for every 15-bit bin (luma-weighted squared distance). */
export function binLut(pal: Uint8Array): Uint8Array {
  const n = pal.length / 3;
  const lut = new Uint8Array(BINS);
  for (let k = 0; k < BINS; k++) {
    const r = ((k >> 10) << 3) | 4, g = (((k >> 5) & 31) << 3) | 4, b = ((k & 31) << 3) | 4;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = r - pal[i * 3]!, dg = g - pal[i * 3 + 1]!, db = b - pal[i * 3 + 2]!;
      const d = 3 * dr * dr + 6 * dg * dg + db * db;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    lut[k] = best;
  }
  return lut;
}

let lzwTable: Int32Array | null = null;
let lzwGen = 0;

/** GIF LZW: the code stream (LSB-first bits) for `indices` at `minCode` bits, without the sub-block framing. */
export function lzwEncode(indices: Uint8Array, minCode = 8): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = new ByteWriter(indices.length / 2 + 64);
  let acc = 0, nbits = 0;
  let size = minCode + 1;
  const emit = (code: number): void => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) { out.u8(acc & 0xff); acc >>>= 8; nbits -= 8; }
  };
  // dictionary: (prefix << 8 | k) → code, tagged with a generation so a clear is O(1) (shared across calls)
  const table = (lzwTable ??= new Int32Array(4096 << 8));
  const newGen = (): number => { if (++lzwGen >= 1 << 20) { table.fill(0); lzwGen = 1; } return lzwGen; };
  let gen = newGen();
  let next = eoi + 1;
  emit(clear);
  if (!indices.length) { emit(eoi); if (nbits > 0) out.u8(acc & 0xff); return out.finish(); }
  let cur = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (cur << 8) | k;
    const e = table[key]!;
    if (e >>> 12 === gen) { cur = e & 4095; continue; }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCode + 1;
      gen = newGen();
    } else {
      if (next >= 1 << size) size++;
      table[key] = (gen << 12) | next++;
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (nbits > 0) out.u8(acc & 0xff);
  return out.finish();
}

export interface GifFrameSpec { x: number; y: number; w: number; h: number; indices: Uint8Array; delayCs: number; transparent: boolean }

/** GIF89a writer: global palette (padded to 256), NETSCAPE loop, frames. */
export class GifWriter {
  private readonly w = new ByteWriter(1 << 16);
  constructor(width: number, height: number, palette: Uint8Array, loop = 0) {
    const w = this.w;
    w.ascii('GIF89a').u16le(width).u16le(height);
    w.u8(0x80 | (7 << 4) | 7).u8(0).u8(0); // global table of 256, 8-bit colour resolution
    const pal = new Uint8Array(768);
    pal.set(palette.subarray(0, Math.min(palette.length, 765)));
    w.bytes(pal);
    w.u8(0x21).u8(0xff).u8(11).ascii('NETSCAPE2.0').u8(3).u8(1).u16le(loop).u8(0);
  }

  frame(f: GifFrameSpec): void {
    const w = this.w;
    // graphic control: disposal 1 (leave in place), transparency flag
    w.u8(0x21).u8(0xf9).u8(4).u8((1 << 2) | (f.transparent ? 1 : 0)).u16le(f.delayCs).u8(TRANSPARENT).u8(0);
    w.u8(0x2c).u16le(f.x).u16le(f.y).u16le(f.w).u16le(f.h).u8(0);
    w.u8(8);
    const data = lzwEncode(f.indices, 8);
    for (let p = 0; p < data.length; p += 255) {
      const n = Math.min(255, data.length - p);
      w.u8(n).bytes(data.subarray(p, p + n));
    }
    w.u8(0);
  }

  finish(): Uint8Array { this.w.u8(0x3b); return this.w.finish(); }
}

/** Per-frame delays (centiseconds) that keep the clip's clock: cumulative rounding, never under 2 cs. */
export function gifDelays(frames: number, fps: number): number[] {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < frames; i++) {
    const want = Math.round(((i + 1) * 100) / fps);
    const d = Math.max(2, want - t);
    out.push(d);
    t += d;
  }
  return out;
}

/** GIF frame rates that play back true (100 / fps must be a whole number of centiseconds ≥ 2). */
export const GIF_FPS = [10, 20, 25, 50] as const;

/**
 * Encodes binned frames (toBins) with one palette from `hist`: the first frame whole, then the changed rectangle
 * of each later frame with unchanged pixels transparent. `tolerance` (RGB distance, 0 = exact) also leaves a pixel
 * as shown when its new colour is that close to the one on screen, so dither shimmer and film grain don't rewrite
 * the whole frame. `onProgress(i)` after each frame.
 */
export function encodeGif(width: number, height: number, frames: readonly Uint16Array[], delays: readonly number[], hist: Uint32Array, onProgress?: (i: number) => void, tolerance = 0): Uint8Array {
  const pal = medianCut(hist, 255);
  const lut = binLut(pal);
  const n = pal.length / 3;
  // palette distance table (squared), for the tolerance test
  const tol2 = tolerance * tolerance;
  const near = tolerance > 0 ? new Uint8Array(n * n) : null;
  if (near) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const dr = pal[a * 3]! - pal[b * 3]!, dg = pal[a * 3 + 1]! - pal[b * 3 + 1]!, db = pal[a * 3 + 2]! - pal[b * 3 + 2]!;
    near[a * n + b] = dr * dr + dg * dg + db * db <= tol2 ? 1 : 0;
  }
  const gw = new GifWriter(width, height, pal, 0);
  const shown = new Int16Array(width * height).fill(-1);
  const keep = new Uint8Array(width * height);
  frames.forEach((bins, fi) => {
    const idx = new Uint8Array(width * height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = lut[bins[i]!]!;
      idx[i] = v;
      const sh = shown[i]!;
      const same = sh === v || (near !== null && sh >= 0 && near[sh * n + v] === 1);
      keep[i] = same ? 1 : 0;
      if (!same) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; } // nothing changed: a 1-pixel transparent frame keeps the timing
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const sub = new Uint8Array(rw * rh);
    const first = fi === 0;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = (y + y0) * width + x + x0;
      if (!first && keep[i]) sub[y * rw + x] = TRANSPARENT;
      else { const v = idx[i]!; sub[y * rw + x] = v; shown[i] = v; }
    }
    gw.frame({ x: x0, y: y0, w: rw, h: rh, indices: sub, delayCs: delays[fi] ?? 4, transparent: !first });
    onProgress?.(fi);
  });
  return gw.finish();
}

// ---- decoding (tests; the browser's ImageDecoder checks real playback) ---------------------------------------

export interface DecodedGif {
  width: number;
  height: number;
  palette: Uint8Array;
  loop: number | null;
  frames: { x: number; y: number; w: number; h: number; delayCs: number; transparent: number | null; disposal: number; indices: Uint8Array }[];
}

export function lzwDecode(data: Uint8Array, minCode: number, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let size = minCode + 1, next = eoi + 1, prev = -1, op = 0;
  let acc = 0, nbits = 0, p = 0;
  const put = (code: number): void => {
    const n = len[code]!;
    let c = code;
    for (let k = n - 1; k >= 0; k--) { if (op + k < expected) out[op + k] = suffix[c]!; c = prefix[c]!; }
    op += n;
  };
  for (;;) {
    while (nbits < size && p < data.length) { acc |= data[p++]! << nbits; nbits += 8; }
    if (nbits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>>= size; nbits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev < 0) { put(code); prev = code; continue; }
    let k: number;
    if (code < next) k = first[code]!;
    else if (code === next) k = first[prev]!;
    else throw new Error(`gif: bad code ${code} (next ${next})`);
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = k; first[next] = first[prev]!; len[next] = len[prev]! + 1;
      next++;
      if (next >= 1 << size && size < 12) size++;
    }
    put(code);
    prev = code;
  }
  if (op < expected) throw new Error(`gif: ${op} of ${expected} pixels`);
  return out;
}

export function decodeGif(b: Uint8Array): DecodedGif {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('gif: bad signature');
  const width = dv.getUint16(6, true), height = dv.getUint16(8, true), flags = b[10]!;
  let p = 13;
  let palette = new Uint8Array(0);
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); palette = b.slice(p, p + n); p += n; }
  const out: DecodedGif = { width, height, palette, loop: null, frames: [] };
  let gce = { delay: 0, transparent: null as number | null, disposal: 0 };
  const blocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) { const n = b[p++]!; if (!n) break; for (let i = 0; i < n; i++) parts.push(b[p + i]!); p += n; }
    return Uint8Array.from(parts);
  };
  while (p < b.length) {
    const t = b[p++]!;
    if (t === 0x3b) return out;
    if (t === 0x21) {
      const label = b[p++]!;
      if (label === 0xf9) {
        const f = b[p + 1]!;
        gce = { delay: dv.getUint16(p + 2, true), transparent: f & 1 ? b[p + 4]! : null, disposal: (f >> 2) & 7 };
        p += 6;
      } else if (label === 0xff) {
        const app = String.fromCharCode(...b.subarray(p + 1, p + 12));
        p += 12;
        const d = blocks();
        if (app === 'NETSCAPE2.0' && d[0] === 1) out.loop = d[1]! | (d[2]! << 8);
      } else blocks();
      continue;
    }
    if (t === 0x2c) {
      const x = dv.getUint16(p, true), y = dv.getUint16(p + 2, true), w = dv.getUint16(p + 4, true), h = dv.getUint16(p + 6, true), lf = b[p + 8]!;
      p += 9;
      if (lf & 0x80) p += 3 << ((lf & 7) + 1);
      const minCode = b[p++]!;
      const indices = lzwDecode(blocks(), minCode, w * h);
      out.frames.push({ x, y, w, h, delayCs: gce.delay, transparent: gce.transparent, disposal: gce.disposal, indices });
      gce = { delay: 0, transparent: null, disposal: 0 };
      continue;
    }
    throw new Error(`gif: unknown block 0x${t.toString(16)} at ${p - 1}`);
  }
  throw new Error('gif: no trailer');
}

/** Composites decoded frames (disposal 0/1) into full palette-index canvases. */
export function compositeGif(g: DecodedGif): Uint8Array[] {
  const canvas = new Uint8Array(g.width * g.height);
  return g.frames.map((f) => {
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const v = f.indices[y * f.w + x]!;
      if (v !== f.transparent) canvas[(y + f.y) * g.width + x + f.x] = v;
    }
    return canvas.slice();
  });
}
