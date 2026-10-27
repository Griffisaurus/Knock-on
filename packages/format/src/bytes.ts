// Little-endian byte writer/reader with LEB128 varints and zigzag (DATA_FORMATS §1–2).
// Varints use arithmetic (not 32-bit bit ops) so values up to 2^53 round-trip exactly.

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private n = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number { return this.n; }

  private ensure(extra: number): void {
    if (this.n + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + extra));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this { this.ensure(1); this.buf[this.n++] = v & 0xff; return this; }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.n, v, true); this.n += 2; return this; }
  i16(v: number): this { this.ensure(2); this.view.setInt16(this.n, v, true); this.n += 2; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.n, v >>> 0, true); this.n += 4; return this; }
  i32(v: number): this { this.ensure(4); this.view.setInt32(this.n, v, true); this.n += 4; return this; }
  bytes(b: Uint8Array): this { this.ensure(b.length); this.buf.set(b, this.n); this.n += b.length; return this; }
  ascii(s: string): this { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; }

  /** Unsigned LEB128 varint, 0 ≤ v ≤ 2^53 − 1. */
  varint(v: number): this {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint out of range: ${v}`);
    while (v >= 128) {
      this.u8((v % 128) | 128);
      v = Math.floor(v / 128);
    }
    return this.u8(v);
  }

  /** Signed varint via zigzag (arithmetic form, safe to ±2^52). */
  svarint(v: number): this {
    if (!Number.isSafeInteger(v)) throw new RangeError(`svarint out of range: ${v}`);
    return this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  patchU32(at: number, v: number): void { this.view.setUint32(at, v >>> 0, true); }

  finish(): Uint8Array { return this.buf.slice(0, this.n); }
}

export class ByteReader {
  private readonly buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number { return this.buf.length - this.pos; }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new FormatError('unexpected end of data');
  }

  u8(): number { this.need(1); return this.buf[this.pos++]!; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16(): number { this.need(2); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  bytes(n: number): Uint8Array { this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  ascii(n: number): string { return String.fromCharCode(...this.bytes(n)); }

  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      result += (b & 127) * mul;
      if (b < 128) {
        if (!Number.isSafeInteger(result)) throw new FormatError('varint overflow');
        return result;
      }
      mul *= 128;
    }
    throw new FormatError('varint too long');
  }

  svarint(): number {
    const z = this.varint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
}

export class FormatError extends Error {
  override name = 'FormatError';
}
