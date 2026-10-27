// C4 (M4): our own animated WebP writer (RIFF / VP8X / ANIM / ANMF, per the WebP container spec; D94: no libraries)
// and a parser for tests and verification. Frame bitstreams come from the browser's still-image encoder
// (canvas.toBlob / OffscreenCanvas.convertToBlob 'image/webp'): this module lifts the VP8 / VP8L (+ ALPH) chunks
// out of each still and wraps them as animation frames, so only the container is ours, as with VideoEncoder + MP4.

import { ByteWriter, fourcc } from './bytes.ts';

export interface RiffChunk { readonly id: string; readonly offset: number; readonly size: number; readonly data: Uint8Array }

/** The top-level chunks of a RIFF WEBP file (throws on a bad header or an overrun). */
export function parseRiff(b: Uint8Array): RiffChunk[] {
  if (b.length < 12 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') throw new Error('webp: not a RIFF WEBP file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffSize = dv.getUint32(4, true);
  if (riffSize + 8 !== b.length) throw new Error(`webp: RIFF size ${riffSize + 8} ≠ file size ${b.length}`);
  return chunksIn(b, 12, b.length);
}

function chunksIn(b: Uint8Array, start: number, end: number): RiffChunk[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: RiffChunk[] = [];
  let p = start;
  while (p + 8 <= end) {
    const id = fourcc(b, p), size = dv.getUint32(p + 4, true);
    if (p + 8 + size > end) throw new Error(`webp: chunk ${id} at ${p} overruns`);
    out.push({ id, offset: p, size, data: b.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  if (p !== end) throw new Error(`webp: ${end - p} trailing bytes`);
  return out;
}

/** Width and height of a VP8 (lossy) or VP8L (lossless) bitstream. */
export function bitstreamSize(id: string, d: Uint8Array): [number, number] {
  if (id === 'VP8 ') {
    if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new Error('webp: bad VP8 start code');
    return [(d[6]! | (d[7]! << 8)) & 0x3fff, (d[8]! | (d[9]! << 8)) & 0x3fff];
  }
  if (id === 'VP8L') {
    if (d[0] !== 0x2f) throw new Error('webp: bad VP8L signature');
    const v = d[1]! | (d[2]! << 8) | (d[3]! << 16) | (d[4]! << 24);
    return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1];
  }
  throw new Error(`webp: ${id} is not a bitstream chunk`);
}

export interface WebpFrameData {
  /** The frame's image chunks, each with its 8-byte header and padding (ALPH first when present, then VP8 / VP8L). */
  readonly chunks: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
}

/** Lifts the image chunks out of a still WebP (simple or VP8X) for an ANMF frame. */
export function stillToFrame(still: Uint8Array): WebpFrameData {
  const cs = parseRiff(still);
  const img = cs.find((c) => c.id === 'VP8 ' || c.id === 'VP8L');
  if (!img) throw new Error('webp: still has no image data');
  const alph = cs.find((c) => c.id === 'ALPH');
  const [width, height] = bitstreamSize(img.id, img.data);
  const w = new ByteWriter(img.size + (alph?.size ?? 0) + 32);
  for (const c of alph && img.id === 'VP8 ' ? [alph, img] : [img]) {
    w.ascii(c.id).u32le(c.size).bytes(c.data);
    if (c.size & 1) w.u8(0);
  }
  return { chunks: w.finish(), width, height, alpha: img.id === 'VP8L' || (alph !== undefined && img.id === 'VP8 ') };
}

export interface AnimFrame {
  readonly data: WebpFrameData;
  /** Offset on the canvas (even). */
  readonly x: number;
  readonly y: number;
  readonly durationMs: number;
  /** Alpha-blend over the previous canvas (else replace the rectangle). */
  readonly blend?: boolean;
  /** Dispose the rectangle to the background colour after showing it. */
  readonly dispose?: boolean;
}

/** An animated WebP: VP8X (animation flag), ANIM (background, loop count), one ANMF per frame. */
export function buildAnimatedWebp(width: number, height: number, frames: readonly AnimFrame[], loop = 0, background = 0x00000000): Uint8Array {
  const w = new ByteWriter(64 + frames.reduce((n, f) => n + f.data.chunks.length + 24, 0));
  w.ascii('RIFF').u32le(0).ascii('WEBP');
  const alpha = frames.some((f) => f.data.alpha);
  w.ascii('VP8X').u32le(10).u8((alpha ? 0x10 : 0) | 0x02).u24le(0).u24le(width - 1).u24le(height - 1);
  w.ascii('ANIM').u32le(6).u32le(background).u16le(loop);
  for (const f of frames) {
    if (f.x & 1 || f.y & 1) throw new Error('webp: frame offsets must be even');
    if (f.x + f.data.width > width || f.y + f.data.height > height) throw new Error('webp: frame outside the canvas');
    const size = 16 + f.data.chunks.length;
    w.ascii('ANMF').u32le(size);
    w.u24le(f.x / 2).u24le(f.y / 2).u24le(f.data.width - 1).u24le(f.data.height - 1).u24le(Math.max(0, Math.min(0xffffff, Math.round(f.durationMs))));
    w.u8((f.blend ? 0 : 0x02) | (f.dispose ? 0x01 : 0));
    w.bytes(f.data.chunks);
    if (size & 1) w.u8(0);
  }
  w.setU32le(4, w.length - 8);
  return w.finish();
}

/** Per-frame durations (ms) that keep the clip's clock under cumulative rounding. */
export function webpDurations(frames: number, fps: number): number[] {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < frames; i++) { const want = Math.round(((i + 1) * 1000) / fps); out.push(want - t); t = want; }
  return out;
}

export interface ParsedAnim {
  width: number;
  height: number;
  loop: number;
  background: number;
  alpha: boolean;
  frames: { x: number; y: number; w: number; h: number; durationMs: number; blend: boolean; dispose: boolean; chunks: string[] }[];
}

/** Parses an animated WebP back (VP8X + ANIM + ANMF), checking every frame's bitstream size against its header. */
export function parseAnimatedWebp(b: Uint8Array): ParsedAnim {
  const cs = parseRiff(b);
  const vp8x = cs[0];
  if (!vp8x || vp8x.id !== 'VP8X' || vp8x.size !== 10) throw new Error('webp: first chunk must be VP8X');
  const fl = vp8x.data[0]!;
  if (!(fl & 0x02)) throw new Error('webp: animation flag not set');
  const u24 = (d: Uint8Array, o: number): number => d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16);
  const out: ParsedAnim = { width: u24(vp8x.data, 4) + 1, height: u24(vp8x.data, 7) + 1, loop: 0, background: 0, alpha: (fl & 0x10) !== 0, frames: [] };
  const anim = cs.find((c) => c.id === 'ANIM');
  if (!anim || anim.size !== 6) throw new Error('webp: no ANIM chunk');
  const adv = new DataView(anim.data.buffer, anim.data.byteOffset, 6);
  out.background = adv.getUint32(0, true);
  out.loop = adv.getUint16(4, true);
  for (const c of cs) {
    if (c.id !== 'ANMF') continue;
    const d = c.data;
    const fr = { x: u24(d, 0) * 2, y: u24(d, 3) * 2, w: u24(d, 6) + 1, h: u24(d, 9) + 1, durationMs: u24(d, 12), blend: (d[15]! & 0x02) === 0, dispose: (d[15]! & 0x01) !== 0, chunks: [] as string[] };
    const sub = chunksIn(b, c.offset + 8 + 16, c.offset + 8 + c.size);
    for (const s of sub) {
      fr.chunks.push(s.id);
      if (s.id === 'VP8 ' || s.id === 'VP8L') {
        const [bw, bh] = bitstreamSize(s.id, s.data);
        if (bw !== fr.w || bh !== fr.h) throw new Error(`webp: frame ${out.frames.length} is ${fr.w}×${fr.h} but its bitstream is ${bw}×${bh}`);
      }
    }
    if (fr.x + fr.w > out.width || fr.y + fr.h > out.height) throw new Error('webp: frame outside the canvas');
    out.frames.push(fr);
  }
  return out;
}
