// Radiance RGBE (.hdr) reader for the baked set IBLs (`ibl_<set>.hdr`, E3b: Cycles equirect bakes).
// Handles the new-style RLE scanlines and flat files; returns linear RGB floats (top row first).

export interface HdrImage { readonly width: number; readonly height: number; readonly data: Float32Array }

export function parseHdr(buf: ArrayBuffer): HdrImage {
  const b = new Uint8Array(buf);
  let p = 0;
  const line = (): string => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]!); p++; return s; };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('not a Radiance HDR file');
  for (;;) { const l = line(); if (l === '' || p >= b.length) break; }
  const res = /^-Y (\d+) \+X (\d+)/.exec(line());
  if (!res) throw new Error('unsupported HDR orientation');
  const h = Number(res[1]), w = Number(res[2]);
  const rgbe = new Uint8Array(w * h * 4);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 32768 && b[p] === 2 && b[p + 1] === 2 && ((b[p + 2]! << 8) | b[p + 3]!) === w) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = b[p++]!;
          if (n > 128) { n -= 128; const v = b[p++]!; for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = v; } else { for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = b[p++]!; }
        }
      }
      rgbe.set(scan, y * w * 4);
    } else {
      rgbe.set(b.subarray(p, p + w * 4), y * w * 4);
      p += w * 4;
    }
  }
  const data = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const e = rgbe[i * 4 + 3]!;
    const f = e ? 2 ** (e - 136) : 0;
    data[i * 3] = rgbe[i * 4]! * f; data[i * 3 + 1] = rgbe[i * 4 + 1]! * f; data[i * 3 + 2] = rgbe[i * 4 + 2]! * f;
  }
  return { width: w, height: h, data };
}

/** Uploads an HDR image as an rgba16float texture (half floats packed on the CPU). */
export function hdrTexture(d: GPUDevice, img: HdrImage): GPUTexture {
  const { width: w, height: h, data } = img;
  const half = new Uint16Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    half[i * 4] = toHalf(data[i * 3]!); half[i * 4 + 1] = toHalf(data[i * 3 + 1]!); half[i * 4 + 2] = toHalf(data[i * 3 + 2]!); half[i * 4 + 3] = 0x3c00;
  }
  const tex = d.createTexture({ label: 'ibl.equirect', size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  d.queue.writeTexture({ texture: tex }, half, { bytesPerRow: w * 8 }, [w, h]);
  return tex;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = Math.min(v, 65000);
  const x = u32[0]!;
  const s = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}
