// C4 (M4): a growable big/little-endian byte writer shared by the in-house MP4, GIF and WebP writers (D94: no
// third-party encoders or muxers).

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  /** Bytes written. */
  length = 0;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
    this.view = new DataView(b.buffer);
  }

  u8(v: number): this { this.ensure(1); this.buf[this.length++] = v & 0xff; return this; }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.length, v); this.length += 2; return this; }
  u16le(v: number): this { this.ensure(2); this.view.setUint16(this.length, v, true); this.length += 2; return this; }
  u24(v: number): this { this.ensure(3); this.buf[this.length++] = (v >>> 16) & 0xff; this.buf[this.length++] = (v >>> 8) & 0xff; this.buf[this.length++] = v & 0xff; return this; }
  u24le(v: number): this { this.ensure(3); this.buf[this.length++] = v & 0xff; this.buf[this.length++] = (v >>> 8) & 0xff; this.buf[this.length++] = (v >>> 16) & 0xff; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; return this; }
  u32le(v: number): this { this.ensure(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; return this; }
  i32(v: number): this { this.ensure(4); this.view.setInt32(this.length, v | 0); this.length += 4; return this; }
  /** 64-bit unsigned from a JS number (exact up to 2^53). */
  u64(v: number): this { this.u32(Math.floor(v / 4294967296)); return this.u32(v % 4294967296); }
  bytes(b: ArrayLike<number>): this { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  ascii(s: string): this { this.ensure(s.length); for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i) & 0x7f; return this; }
  zeros(n: number): this { this.ensure(n); this.buf.fill(0, this.length, this.length + n); this.length += n; return this; }

  /** Overwrites a big-endian u32 at `at` (box sizes written after their contents). */
  setU32(at: number, v: number): void { this.view.setUint32(at, v >>> 0); }
  setU32le(at: number, v: number): void { this.view.setUint32(at, v >>> 0, true); }

  /** A copy of the bytes written. */
  finish(): Uint8Array { return this.buf.slice(0, this.length); }
  /** A view of the bytes written (valid until the next write). */
  view8(): Uint8Array { return this.buf.subarray(0, this.length); }
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
