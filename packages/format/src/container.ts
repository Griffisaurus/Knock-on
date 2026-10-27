// `.knockon` container (DATA_FORMATS §2): magic, version, MessagePack header, section table,
// sections each followed by a CRC-32 of the uncompressed payload.

import { deflateSync, inflateSync } from 'fflate';
import { pack, unpack } from 'msgpackr';
import { ByteReader, ByteWriter, FormatError } from './bytes.ts';
import { crc32 } from './crc32.ts';

export const FORMAT_VERSION = 1;

export const Codec = { None: 0, Zstd: 1, Deflate: 2 } as const;
export type Codec = (typeof Codec)[keyof typeof Codec];

export interface Section {
  readonly tag: string; // exactly 4 ASCII chars
  readonly data: Uint8Array; // uncompressed payload
}

export interface Container {
  readonly magic: 'KNON' | 'KNMD' | 'KNCP';
  readonly flags: number; // bit0 canonical run snapshot
  readonly header: Record<string, unknown>;
  readonly sections: readonly Section[];
}

const MAX_SECTIONS = 64;
const MAX_SECTION_BYTES = 512 * 1024 * 1024;

export function encodeContainer(c: Container, codec: Codec = Codec.Deflate): Uint8Array {
  const w = new ByteWriter(1024);
  const header = pack(c.header) as Uint8Array;
  w.ascii(c.magic).u16(FORMAT_VERSION).u16(c.flags).u32(header.length).bytes(header);
  if (c.sections.length > MAX_SECTIONS) throw new FormatError('too many sections');
  w.u16(c.sections.length);
  const tableAt = w.length;
  for (let i = 0; i < c.sections.length; i++) w.bytes(new Uint8Array(20)); // patched below
  const entries: { off: number; len: number; raw: number }[] = [];
  for (const s of c.sections) {
    if (s.tag.length !== 4) throw new FormatError(`bad section tag ${s.tag}`);
    const payload = codec === Codec.Deflate ? deflateSync(s.data, { level: 6 }) : s.data;
    const off = w.length;
    w.bytes(payload).u32(crc32(s.data));
    entries.push({ off, len: payload.length, raw: s.data.length });
  }
  const out = w.finish();
  const view = new DataView(out.buffer);
  c.sections.forEach((s, i) => {
    const at = tableAt + i * 20;
    for (let k = 0; k < 4; k++) out[at + k] = s.tag.charCodeAt(k);
    const e = entries[i]!;
    view.setUint32(at + 4, e.off, true);
    view.setUint32(at + 8, e.len, true);
    view.setUint32(at + 12, e.raw, true);
    out[at + 16] = codec;
  });
  return out;
}

export function decodeContainer(bytes: Uint8Array): Container {
  const r = new ByteReader(bytes);
  const magic = r.ascii(4);
  if (magic !== 'KNON' && magic !== 'KNMD' && magic !== 'KNCP') throw new FormatError(`bad magic ${magic}`);
  const version = r.u16();
  if (version !== FORMAT_VERSION) throw new FormatError(`unsupported format version ${version}`);
  const flags = r.u16();
  const hlen = r.u32();
  if (hlen > 1024 * 1024) throw new FormatError('header too large');
  let header: unknown;
  try { header = unpack(r.bytes(hlen)); } catch (err) { throw new FormatError(`header: ${(err as Error).message}`); }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) throw new FormatError('header is not a map');
  const n = r.u16();
  if (n > MAX_SECTIONS) throw new FormatError('too many sections');
  const table: { tag: string; off: number; len: number; raw: number; codec: number }[] = [];
  for (let i = 0; i < n; i++) {
    const tag = r.ascii(4);
    const off = r.u32();
    const len = r.u32();
    const raw = r.u32();
    const codec = r.u8();
    r.bytes(3);
    if (raw > MAX_SECTION_BYTES || len > MAX_SECTION_BYTES) throw new FormatError(`section ${tag} too large`);
    table.push({ tag, off, len, raw, codec });
  }
  const sections: Section[] = table.map((e) => {
    if (e.off + e.len + 4 > bytes.length) throw new FormatError(`section ${e.tag} out of bounds`);
    const payload = bytes.subarray(e.off, e.off + e.len);
    let data: Uint8Array;
    if (e.codec === Codec.None) data = payload.slice();
    else if (e.codec === Codec.Deflate) {
      try { data = inflateSync(payload, { out: new Uint8Array(e.raw) }); } catch (err) { throw new FormatError(`section ${e.tag}: ${(err as Error).message}`); }
    }
    else throw new FormatError(`codec ${e.codec} not supported in this build`);
    if (data.length !== e.raw) throw new FormatError(`section ${e.tag} size mismatch`);
    const expected = new DataView(bytes.buffer, bytes.byteOffset + e.off + e.len, 4).getUint32(0, true);
    if (crc32(data) !== expected) throw new FormatError(`section ${e.tag} CRC mismatch`);
    return { tag: e.tag, data };
  });
  return { magic, flags, header: header as Record<string, unknown>, sections };
}

export function section(c: Container, tag: string): Uint8Array | undefined {
  return c.sections.find((s) => s.tag === tag)?.data;
}
