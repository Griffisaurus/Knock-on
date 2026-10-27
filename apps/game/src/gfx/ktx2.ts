// KTX 2.0 reader for the BC7 texture sets (tools/blender/encode_ktx2.py, kn_tools/ktx2.py; D94, M4 stream V4).
// Reads the header, level index and DFD transfer function; inflates ZLIB-supercompressed levels (scheme 3)
// with the browser's DecompressionStream. No third-party code.

export const VK_FORMAT_BC7_UNORM_BLOCK = 145;
export const VK_FORMAT_BC7_SRGB_BLOCK = 146;
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Ktx2 {
  readonly vkFormat: number;
  readonly width: number;
  readonly height: number;
  /** Level 0 (largest) first, uncompressed block data. */
  readonly levels: readonly Uint8Array[];
  readonly srgb: boolean;
  readonly kv: Readonly<Record<string, string>>;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate'); // RFC 1950 zlib streams, as KTX2 scheme 3 stores them
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Parses a KTX2 file (2D, one layer and face). Throws on anything else. */
export async function parseKtx2(buf: ArrayBuffer): Promise<Ktx2> {
  const u8 = new Uint8Array(buf);
  if (u8.length < 80 || IDENTIFIER.some((b, i) => u8[i] !== b)) throw new Error('not a KTX2 file');
  const dv = new DataView(buf);
  const u32 = (o: number): number => dv.getUint32(o, true);
  const u64 = (o: number): number => Number(dv.getBigUint64(o, true));
  const vkFormat = u32(12), width = u32(20), height = u32(24), depth = u32(28), layers = u32(32), faces = u32(36);
  const levelCount = Math.max(1, u32(40)), scheme = u32(44);
  if (depth > 1 || layers > 1 || faces !== 1) throw new Error('KTX2: only single 2D images are supported');
  if (scheme !== 0 && scheme !== 3) throw new Error(`KTX2: supercompression ${scheme} not supported`);
  const dfdOff = u32(48), kvdOff = u32(56), kvdLen = u32(60);
  const transfer = u8[dfdOff + 4 + 10]; // DFD total size, then the basic block: transferFunction at byte 10
  const kv: Record<string, string> = {};
  for (let p = kvdOff; p < kvdOff + kvdLen;) {
    const len = u32(p);
    const s = u8.subarray(p + 4, p + 4 + len);
    const z = s.indexOf(0);
    kv[new TextDecoder().decode(s.subarray(0, z))] = new TextDecoder().decode(s.subarray(z + 1)).replace(/\0+$/, '');
    p += 4 + len;
    p += (4 - (p % 4)) % 4;
  }
  const levels = await Promise.all(Array.from({ length: levelCount }, async (_, lv) => {
    const o = 80 + lv * 24;
    const off = u64(o), len = u64(o + 8), raw = u64(o + 16);
    const data = u8.subarray(off, off + len);
    const out = scheme === 3 ? await inflate(data) : data;
    if (out.length !== raw) throw new Error(`KTX2 level ${lv}: ${out.length} bytes, expected ${raw}`);
    return out;
  }));
  return { vkFormat, width, height, levels, srgb: transfer === 2, kv };
}

export async function fetchKtx2(url: string): Promise<{ ktx: Ktx2; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return { ktx: await parseKtx2(buf), bytes: buf.byteLength };
}

/** Bytes per row and rows of one BC level of a w × h image (4 × 4 blocks of 16 bytes). */
export function bcLayout(w: number, h: number): { bytesPerRow: number; rows: number; physW: number; physH: number } {
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
  return { bytesPerRow: bw * 16, rows: bh, physW: bw * 4, physH: bh * 4 };
}
