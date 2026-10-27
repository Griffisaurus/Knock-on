// Per-part texture sets (contract 1, ASSET_PIPELINE §5.2, RENDERING §6.1 PART_SET) and the tiling detail
// layer (DETAIL_LAYER). Sets live in three 2D texture arrays (albedo sRGB, normal, ORM), one layer per
// part set, at the tier's size class; a set of another size is resampled on upload. The arrays grow by
// doubling (old layers are copied over), so the bind group is rebuilt whenever `version` changes.
//
// Index (contract 1): `.art.json` → `textures: { albedo, normal, orm, size }` (file names next to the glb;
// `.png` until the KTX2 transcoder lands; a `sets: [...]` list or `<map>` keys are accepted too).
//
// M4 (stream V4) — BC7 (D94):
// - When the adapter has `texture-compression-bc` (and `TexSets.ktx2` is on; `?ktx2=0` turns it off), the
//   arrays are BC7: albedo `bc7-rgba-unorm-srgb`, normal + ORM `bc7-rgba-unorm`, a quarter of rgba8.
// - Sets listed in `.art.json → textures.ktx2` upload the in-house encoder's levels as they are
//   (tools/blender/encode_ktx2.py). PNG-only sets are encoded to BC7 mode 6 on the GPU at load (`gpuBc7`),
//   so one scene can mix both. Without the feature everything stays rgba8 from the PNGs, as before.
// - The 'textures' VRAM knob (vram.ts) drops the 2048² class to 1024² (mips 1… copied down; layer codes
//   don't change because the shader samples by UV) and restores it by reloading that class's sets.
// - Device loss: `journal` lists every set in upload order; `replay` re-uploads them with the same codes.

import { bcLayout, fetchKtx2, type Ktx2 } from '../ktx2.ts';
import { generateMips } from '../mips.ts';
import { vramGovernor, type VramKnob } from '../vram.ts';
import { DETAIL_LAYERS } from './wgsl.ts';

export interface TexSetFiles {
  readonly albedo: string; readonly normal: string; readonly orm: string; readonly size?: number;
  /** M4 (V4): the same maps as BC7 KTX2 (`.art.json → textures.ktx2`). */
  readonly ktx2?: { readonly albedo: string; readonly normal: string; readonly orm: string };
}

const MAPS = ['albedo', 'normal', 'orm'] as const;
type MapName = typeof MAPS[number];

/** Reads the texture index of a part's `.art.json` (raw JSON: the typed parser drops unknown keys). */
export function texSetsOf(art: unknown): TexSetFiles[] {
  const t = (art as { textures?: unknown } | null)?.textures;
  if (!t || typeof t !== 'object') return [];
  const one = (o: Record<string, unknown>): TexSetFiles | null => {
    const pick = (...k: string[]): string | null => { for (const x of k) if (typeof o[x] === 'string') return o[x] as string; return null; };
    const albedo = pick('albedo', 'basecolor', 'baseColor'), normal = pick('normal'), orm = pick('orm', 'ORM');
    const k = o['ktx2'] as Record<string, unknown> | undefined;
    const ktx2 = k && typeof k === 'object' && typeof k['albedo'] === 'string' && typeof k['normal'] === 'string' && typeof k['orm'] === 'string'
      ? { ktx2: { albedo: k['albedo'], normal: k['normal'], orm: k['orm'] } } : {};
    return albedo && normal && orm ? { albedo, normal, orm, ...(typeof o['size'] === 'number' ? { size: o['size'] } : {}), ...ktx2 } : null;
  };
  const list = Array.isArray(t) ? t : Array.isArray((t as { sets?: unknown }).sets) ? (t as { sets: unknown[] }).sets : [t];
  return list.map((x) => (x && typeof x === 'object' ? one(x as Record<string, unknown>) : null)).filter((x): x is TexSetFiles => x !== null);
}

/** One size class: an albedo array (sRGB, layer i) and a normal + ORM array (linear, layers 2i and 2i + 1).
 * Two arrays instead of three keep the part shader within WebGPU's default 16 sampled textures per stage. */
class SetArray {
  albedo!: GPUTexture;
  nrmOrm!: GPUTexture;
  cap = 0;
  count = 0;
  /** Current texel size and mip count (the 'textures' knob shrinks the 2048² class to 1024²). */
  size: number;
  mips: number;
  /** M4 (V4): BC7 arrays (no render attachment: uploads are block data or GPU-encoded). */
  readonly bc: boolean;
  constructor(private readonly d: GPUDevice, size: number, private readonly bump: () => void, bc = false) {
    this.size = size;
    this.mips = Math.floor(Math.log2(size)) + 1;
    this.bc = bc;
    this.grow(1);
  }
  get formats(): [GPUTextureFormat, GPUTextureFormat] {
    return this.bc ? ['bc7-rgba-unorm-srgb', 'bc7-rgba-unorm'] : ['rgba8unorm-srgb', 'rgba8unorm'];
  }
  /** Blank arrays of `size` and `cap` layers in this class's formats. */
  make(size: number, cap: number): { albedo: GPUTexture; nrmOrm: GPUTexture } {
    const mips = Math.floor(Math.log2(size)) + 1;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | (this.bc ? 0 : GPUTextureUsage.RENDER_ATTACHMENT);
    const mk = (fmt: GPUTextureFormat, label: string, layers: number): GPUTexture => this.d.createTexture({
      label: `${label}.${size}`, size: [size, size, layers], format: fmt, mipLevelCount: mips, dimension: '2d', usage,
    });
    const [fa, fn] = this.formats;
    return { albedo: mk(fa, 'set.albedo', cap), nrmOrm: mk(fn, 'set.nrmorm', cap * 2) };
  }
  /** Copies `layers` layers' mips from `src` (starting at mip `skip`) into `dst` (from mip 0). */
  private copy(enc: GPUCommandEncoder, src: GPUTexture, dst: GPUTexture, layers: number, skip: number): void {
    for (let mip = 0; mip < dst.mipLevelCount && mip + skip < src.mipLevelCount; mip++) {
      let s = Math.max(1, dst.width >> mip);
      if (this.bc) s = Math.max(4, s); // a BC mip under 4 × 4 is still one physical block
      enc.copyTextureToTexture({ texture: src, mipLevel: mip + skip }, { texture: dst, mipLevel: mip }, [s, s, layers]);
    }
  }
  grow(want: number): void {
    const cap = Math.max(1, want);
    const next = this.make(this.size, cap);
    if (this.cap && this.count) {
      const enc = this.d.createCommandEncoder();
      this.copy(enc, this.albedo, next.albedo, this.count, 0);
      this.copy(enc, this.nrmOrm, next.nrmOrm, this.count * 2, 0);
      this.d.queue.submit([enc.finish()]);
    }
    if (this.cap) { this.albedo.destroy(); this.nrmOrm.destroy(); }
    Object.assign(this, next);
    this.cap = cap;
    this.bump();
  }
  /** Shrinks to `size` (< the current size): the arrays are rebuilt from the old mips 1, 2, … */
  shrinkTo(size: number): void {
    if (size >= this.size) return;
    const next = this.make(size, this.cap);
    const skip = Math.round(Math.log2(this.size / size));
    if (this.count) {
      const enc = this.d.createCommandEncoder();
      this.copy(enc, this.albedo, next.albedo, this.count, skip);
      this.copy(enc, this.nrmOrm, next.nrmOrm, this.count * 2, skip);
      this.d.queue.submit([enc.finish()]);
    }
    this.albedo.destroy();
    this.nrmOrm.destroy();
    this.adopt(next, size);
  }
  /** Swaps in arrays the caller filled (a restore to a larger size). */
  adopt(next: { albedo: GPUTexture; nrmOrm: GPUTexture }, size: number): void {
    if (next.albedo !== this.albedo) { this.albedo?.destroy(); this.nrmOrm?.destroy(); }
    Object.assign(this, next);
    this.size = size;
    this.mips = next.albedo.mipLevelCount;
    this.bump();
  }
  /** Bytes of both arrays (allocated capacity). */
  get bytes(): number {
    let b = 0;
    for (let m = 0; m < this.mips; m++) { const s = Math.max(this.bc ? 4 : 1, this.size >> m); b += s * s; }
    return b * this.cap * 3 * (this.bc ? 1 : 4);
  }
}

type SetImage = ImageBitmap | ImageData | HTMLCanvasElement | OffscreenCanvas;
interface SetSource { readonly type: string; readonly files: TexSetFiles; readonly base: string }
interface JournalEntry extends SetSource { readonly key: string; readonly code: number; readonly size: number }
/** Where an upload goes: a class's arrays (or the restore's replacements). */
interface SetDst { readonly albedo: GPUTexture; readonly nrmOrm: GPUTexture; readonly size: number; readonly bc: boolean }

/** Layer codes carry the size class in bit 15 (0 = the 1024² arrays, 1 = the 2048² arrays). */
export const LAYER_CLASS_BIT = 0x8000;

export class TexSets {
  /** M4 (V4): use BC7 arrays and the KTX2 files when the adapter can (`?ktx2=0` forces the rgba8 / PNG path). */
  static ktx2 = !/[?&]ktx2=0(&|$)/.test(globalThis.location?.search ?? '');
  private readonly d: GPUDevice;
  /** Bumped whenever an array is recreated (the look bind group must be rebuilt). */
  version = 0;
  /** Size classes (RENDERING §1, ASSET_PIPELINE §5.3): [1024²] on 4/8 GB, [1024², 2048²] from 12 GB. */
  readonly classes: SetArray[];
  detail!: GPUTexture;
  private readonly byKey = new Map<string, number>();
  /** M4 (V4): the arrays are BC7. */
  readonly bc: boolean;
  /** M4 (V4): every set in upload order (device-loss replay, the knob's restore). */
  readonly journal: JournalEntry[] = [];
  /** Loads in flight. */
  readonly pending = new Set<Promise<number>>();
  private readonly inflight = new Map<string, Promise<number>>();
  /** M4 (V4): what loaded how (debug readout, measurements). */
  readonly stats = { ktx2: 0, png: 0, gpuBc7: 0, failed: 0, bytes: 0, ms: 0 };
  private readonly maxSize: number;
  private readonly knob: VramKnob;
  private restoring: { cancelled: boolean } | null = null;

  constructor(device: GPUDevice, maxSize: number) {
    this.d = device;
    this.maxSize = maxSize;
    this.bc = TexSets.ktx2 && device.features.has('texture-compression-bc');
    const bump = (): void => { this.version++; };
    this.classes = [new SetArray(device, 1024, bump, this.bc)];
    if (maxSize >= 2048) this.classes.push(new SetArray(device, 2048, bump, this.bc));
    this.detail = makeDetail(device);
    this.knob = {
      name: 'textures', levels: ['full', '1k'], level: 0,
      set: (l) => { this.knob.level = l; this.setClassLevel(l); },
      saves: (l) => (l > 0 && this.classes[1] ? this.classes[1].bytes * (this.classes[1].size > 1024 ? 0.75 : 0) : 0),
    };
    vramGovernor.register(this.knob);
  }

  /** Bytes of every set array (capacity). */
  get bytes(): number { return this.classes.reduce((b, c) => b + c.bytes, 0); }

  /** 'textures' knob: level 1 shrinks the 2048² class to 1024²; level 0 reloads it at full size. */
  private setClassLevel(level: number): void {
    const c = this.classes[1];
    if (!c) return;
    if (level > 0) {
      if (this.restoring) this.restoring.cancelled = true;
      this.restoring = null;
      c.shrinkTo(1024);
      return;
    }
    if (c.size >= this.maxSize || this.restoring) return;
    // build the full-size arrays off to the side, refill them from the class's sets, then swap
    const job = { cancelled: false };
    this.restoring = job;
    const next = c.make(this.maxSize, c.cap);
    const done = new Set<number>();
    const fill = async (): Promise<void> => {
      for (;;) {
        const todo = this.journal.filter((e) => (e.code & LAYER_CLASS_BIT) !== 0 && !done.has(e.code));
        if (!todo.length) break;
        await Promise.all(todo.map(async (e) => {
          done.add(e.code);
          await this.loadInto(e, { albedo: next.albedo, nrmOrm: next.nrmOrm, size: this.maxSize, bc: c.bc });
        }));
      }
    };
    void fill().then(() => {
      if (job.cancelled || next.albedo.width < c.size) { next.albedo.destroy(); next.nrmOrm.destroy(); return; }
      if (c.cap !== next.albedo.depthOrArrayLayers) { // the class grew while restoring: start over at the new size
        next.albedo.destroy(); next.nrmOrm.destroy(); this.restoring = null; this.setClassLevel(0); return;
      }
      c.adopt(next, this.maxSize);
      this.restoring = null;
    });
  }

  /** Sets in use (all classes). */
  get layers(): number { return this.classes.reduce((n, c) => n + c.count, 0); }
  /** Arrays of class k (the second class falls back to the first when the tier has one). */
  cls(k: 0 | 1): SetArray { return this.classes[k] ?? this.classes[0]!; }

  /** Layer code for a set already uploaded under `key`, or -1. */
  layerOf(key: string): number { return this.byKey.get(key) ?? -1; }

  /** Reserves the next layer of the class for `size` and records the set; null when the class is full. */
  private reserve(key: string, size: number, src: SetSource | null): { code: number; cls: SetArray; layer: number; entry: JournalEntry | null } | null {
    const k = size > 1024 && this.classes.length > 1 ? 1 : 0;
    const c = this.classes[k]!;
    const layer = c.count;
    if (layer >= c.cap) c.grow(Math.min(c.cap * 2 || 1, Math.floor(this.d.limits.maxTextureArrayLayers / 2)));
    if (layer >= c.cap) return null;
    c.count++;
    const code = layer | (k ? LAYER_CLASS_BIT : 0);
    this.byKey.set(key, code);
    const entry = src ? { type: src.type, files: src.files, base: src.base, key, code, size } : null;
    if (entry) this.journal.push(entry);
    return { code, cls: c, layer, entry };
  }

  /** Uploads a set from three images into the smallest class that holds its size; returns the layer code. */
  async add(key: string, imgs: Record<MapName, SetImage>, size = 1024): Promise<number> {
    const have = this.byKey.get(key);
    if (have !== undefined) return have;
    const r = this.reserve(key, size, null);
    if (!r) return -1;
    await this.uploadImages(r.layer, imgs, { albedo: r.cls.albedo, nrmOrm: r.cls.nrmOrm, size: r.cls.size, bc: r.cls.bc });
    return r.code;
  }

  /** Images → one layer of `dst` (rgba8: copy + mips; BC7: encoded on the GPU). */
  private async uploadImages(layer: number, imgs: Record<MapName, SetImage>, dst: SetDst): Promise<void> {
    for (const m of MAPS) {
      const bmp = await createImageBitmap(imgs[m] as ImageBitmapSource, { resizeWidth: dst.size, resizeHeight: dst.size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const tex = m === 'albedo' ? dst.albedo : dst.nrmOrm;
      const z = m === 'albedo' ? layer : layer * 2 + (m === 'orm' ? 1 : 0);
      if (dst.bc) {
        gpuBc7(this.d, bmp, m === 'albedo', tex, z);
        this.stats.gpuBc7++;
      } else {
        this.d.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex, origin: [0, 0, z] }, [dst.size, dst.size]);
        generateMipsLayer(this.d, tex, z);
      }
      bmp.close();
    }
  }

  /** KTX2 levels → one layer of `dst` (BC7 only; levels above the class size are skipped). False if unusable. */
  private uploadKtx(layer: number, maps: Record<MapName, Ktx2>, dst: SetDst): boolean {
    for (const m of MAPS) {
      const k = maps[m];
      const skip = Math.round(Math.log2(k.width / dst.size));
      const mips = dst.albedo.mipLevelCount;
      if (k.width !== k.height || skip < 0 || k.width !== dst.size << skip || k.levels.length < skip + mips) return false;
      if (k.vkFormat !== (m === 'albedo' ? 146 : 145)) return false;
    }
    for (const m of MAPS) {
      const k = maps[m];
      const skip = Math.round(Math.log2(k.width / dst.size));
      const tex = m === 'albedo' ? dst.albedo : dst.nrmOrm;
      const z = m === 'albedo' ? layer : layer * 2 + (m === 'orm' ? 1 : 0);
      for (let mip = 0; mip < tex.mipLevelCount; mip++) {
        const s = Math.max(1, dst.size >> mip);
        const l = bcLayout(s, s);
        this.d.queue.writeTexture({ texture: tex, mipLevel: mip, origin: [0, 0, z] }, k.levels[mip + skip]!, { bytesPerRow: l.bytesPerRow, rowsPerImage: l.rows }, [l.physW, l.physH, 1]);
      }
    }
    return true;
  }

  /** Fetches a set (KTX2 when the arrays are BC7 and it has them, else the PNGs) into `dst` at the code's layer. */
  private async loadInto(e: JournalEntry, dst: SetDst): Promise<void> {
    const layer = e.code & 0x7fff;
    const t0 = performance.now();
    const k = e.files.ktx2;
    if (dst.bc && k) {
      try {
        const got = await Promise.all([k.albedo, k.normal, k.orm].map((f) => fetchKtx2(e.base + f)));
        if (this.uploadKtx(layer, { albedo: got[0]!.ktx, normal: got[1]!.ktx, orm: got[2]!.ktx }, dst)) {
          this.stats.ktx2++;
          this.stats.bytes += got.reduce((s, g) => s + g.bytes, 0);
          this.stats.ms += performance.now() - t0;
          return;
        }
        console.warn(`texture set ${e.type}: KTX2 doesn't fit the ${dst.size}² arrays, using the PNGs`);
      } catch (err) {
        console.warn(`texture set ${e.type}: KTX2 failed, using the PNGs`, err);
      }
    }
    const imgs = await Promise.all([e.files.albedo, e.files.normal, e.files.orm].map(async (f) => {
      const res = await fetch(e.base + f);
      if (!res.ok) throw new Error(`${e.base}${f}: ${res.status}`);
      const blob = await res.blob();
      this.stats.bytes += blob.size;
      return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    }));
    await this.uploadImages(layer, { albedo: imgs[0]!, normal: imgs[1]!, orm: imgs[2]! }, dst);
    for (const b of imgs) b.close();
    this.stats.png++;
    this.stats.ms += performance.now() - t0;
  }

  private dstOf(code: number): SetDst {
    // live: a class may grow (new arrays) while the set's files are still downloading
    const c = this.cls((code & LAYER_CLASS_BIT) ? 1 : 0);
    return { get albedo() { return c.albedo; }, get nrmOrm() { return c.nrmOrm; }, get size() { return c.size; }, bc: c.bc };
  }

  /** Loads `/parts/<type>/<file>` maps listed in the art.json; the set's layer or -1. */
  load(type: string, files: TexSetFiles, base = `/parts/${type}/`): Promise<number> {
    const key = `${type}:${files.albedo}`;
    const have = this.byKey.get(key);
    if (have !== undefined) return Promise.resolve(have);
    const busy = this.inflight.get(key);
    if (busy) return busy;
    const p = (async (): Promise<number> => {
      try {
        // the set's size: from the index, else from the first map (a KTX2 header or the albedo PNG)
        let size = files.size;
        if (size === undefined) {
          const res = await fetch(base + files.albedo);
          if (!res.ok) throw new Error(`${base}${files.albedo}: ${res.status}`);
          size = (await createImageBitmap(await res.blob())).width;
        }
        const r = this.reserve(key, size, { type, files, base });
        if (!r) return -1;
        await this.loadInto(r.entry!, this.dstOf(r.code));
        return r.code;
      } catch (e) {
        this.stats.failed++;
        console.warn(`texture set ${type}:`, e);
        return -1;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    return p;
  }

  /** Device loss: re-uploads another TexSets' journal (same order, same layer codes) into these arrays. */
  replay(journal: readonly JournalEntry[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const e of journal) {
      const r = this.reserve(e.key, e.size, e);
      if (!r || r.code !== e.code) { console.warn(`texture set ${e.type}: replay gave layer ${r?.code} for ${e.code}`); continue; }
      jobs.push(this.loadInto(e, this.dstOf(r.code)).catch((err) => { this.stats.failed++; console.warn(`texture set ${e.type}:`, err); }));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** Stops answering the VRAM governor (a replaced TexSets after device loss). */
  dispose(): void { vramGovernor.unregister(this.knob); }
}

/** Mips for one array layer (mips.ts works on whole 2D textures: blit through a temporary). */
function generateMipsLayer(d: GPUDevice, tex: GPUTexture, layer: number): void {
  const tmp = d.createTexture({
    size: [tex.width, tex.height], format: tex.format, mipLevelCount: tex.mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const enc = d.createCommandEncoder();
  enc.copyTextureToTexture({ texture: tex, origin: [0, 0, layer] }, { texture: tmp }, [tex.width, tex.height]);
  d.queue.submit([enc.finish()]);
  generateMips(d, tmp);
  const enc2 = d.createCommandEncoder();
  for (let m = 1; m < tex.mipLevelCount; m++) {
    const s = Math.max(1, tex.width >> m);
    enc2.copyTextureToTexture({ texture: tmp, mipLevel: m }, { texture: tex, mipLevel: m, origin: [0, 0, layer] }, [s, s]);
  }
  d.queue.submit([enc2.finish()]);
  tmp.destroy();
}

// ---- M4 (V4): BC7 mode 6 on the GPU, for PNG-only sets in BC7 arrays ---------------------------------------
// One thread per 4 × 4 block: principal axis of the block (power iteration on the covariance), endpoints at
// the projection extremes, quantised to 7 bits + p-bit 1 (opaque: alpha 255 needs both p-bits set), the best
// of the 16 palette entries per texel, one least-squares refit, the anchor fix-up, then the 128 bits. The
// offline encoder (kn_tools/bc7.py: modes 1/3/5/6 with a search) is better; this keeps a scene that mixes
// KTX2 and PNG sets in one compressed format (quality measured in M4_NOTES_V4).

const BC7_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outb: array<vec4u>;
@group(0) @binding(2) var<uniform> P: vec4u; // blocks x, blocks y, row stride (vec4u), 0
var<private> W4: array<f32, 16> = array<f32, 16>(0., 4., 9., 13., 17., 21., 26., 30., 34., 38., 43., 47., 51., 55., 60., 64.);

fn quant(e: vec3f) -> vec3u { return vec3u(clamp(round((e - 1.0) * 0.5), vec3f(0.0), vec3f(127.0))); }
fn deq(q: vec3u) -> vec3f { return vec3f(q * 2u + 1u); }

struct Fit { q0: vec3u, q1: vec3u, err: f32, idx: array<u32, 16> };

fn assign(px: ptr<function, array<vec3f, 16>>, q0: vec3u, q1: vec3u) -> Fit {
  var f: Fit;
  f.q0 = q0; f.q1 = q1; f.err = 0.0;
  let a = deq(q0); let b = deq(q1);
  var pal: array<vec3f, 16>;
  for (var j = 0u; j < 16u; j++) { pal[j] = floor(((64.0 - W4[j]) * a + W4[j] * b + 32.0) / 64.0); }
  for (var i = 0u; i < 16u; i++) {
    var best = 1e30; var bi = 0u;
    for (var j = 0u; j < 16u; j++) {
      let d = (*px)[i] - pal[j];
      let e = dot(d, d);
      if (e < best) { best = e; bi = j; }
    }
    f.idx[i] = bi; f.err += best;
  }
  return f;
}

fn put(w: ptr<function, vec4u>, off: ptr<function, u32>, v: u32, n: u32) {
  let o = *off; let i = o >> 5u; let s = o & 31u;
  (*w)[i] |= v << s;
  if (s + n > 32u) { (*w)[i + 1u] |= v >> (32u - s); }
  *off = o + n;
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.x || g.y >= P.y) { return; }
  let dim = vec2i(textureDimensions(src, 0));
  var px: array<vec3f, 16>;
  var mean = vec3f(0.0);
  for (var i = 0u; i < 16u; i++) {
    let c = min(vec2i(i32(g.x * 4u + (i & 3u)), i32(g.y * 4u + (i >> 2u))), dim - 1);
    px[i] = round(textureLoad(src, c, 0).rgb * 255.0);
    mean += px[i];
  }
  mean /= 16.0;
  var cxx = 0.0; var cxy = 0.0; var cxz = 0.0; var cyy = 0.0; var cyz = 0.0; var czz = 0.0;
  for (var i = 0u; i < 16u; i++) {
    let d = px[i] - mean;
    cxx += d.x * d.x; cxy += d.x * d.y; cxz += d.x * d.z; cyy += d.y * d.y; cyz += d.y * d.z; czz += d.z * d.z;
  }
  var v = select(select(vec3f(cxz, cyz, czz), vec3f(cxy, cyy, cyz), cyy >= czz), vec3f(cxx, cxy, cxz), cxx >= cyy && cxx >= czz);
  for (var k = 0; k < 8; k++) {
    let nv = vec3f(cxx * v.x + cxy * v.y + cxz * v.z, cxy * v.x + cyy * v.y + cyz * v.z, cxz * v.x + cyz * v.y + czz * v.z);
    let m = max(max(abs(nv.x), abs(nv.y)), abs(nv.z));
    if (m > 1e-9) { v = nv / m; }
  }
  if (dot(v, v) < 1e-12) { v = vec3f(0.57735); } else { v = normalize(v); }
  var tmin = 1e30; var tmax = -1e30;
  for (var i = 0u; i < 16u; i++) { let t = dot(px[i] - mean, v); tmin = min(tmin, t); tmax = max(tmax, t); }
  var fit = assign(&px, quant(clamp(mean + v * tmin, vec3f(0.0), vec3f(255.0))), quant(clamp(mean + v * tmax, vec3f(0.0), vec3f(255.0))));
  // one least-squares refit of the endpoints for the chosen indices
  var a00 = 0.0; var a01 = 0.0; var a11 = 0.0; var b0 = vec3f(0.0); var b1 = vec3f(0.0);
  for (var i = 0u; i < 16u; i++) {
    let t = W4[fit.idx[i]] / 64.0; let s = 1.0 - t;
    a00 += s * s; a01 += s * t; a11 += t * t; b0 += s * px[i]; b1 += t * px[i];
  }
  let det = a00 * a11 - a01 * a01;
  if (det > 1e-6) {
    let e0 = clamp((a11 * b0 - a01 * b1) / det, vec3f(0.0), vec3f(255.0));
    let e1 = clamp((a00 * b1 - a01 * b0) / det, vec3f(0.0), vec3f(255.0));
    let f2 = assign(&px, quant(e0), quant(e1));
    if (f2.err < fit.err) { fit = f2; }
  }
  // anchor fix-up: texel 0's index keeps a 0 MSB
  var q0 = fit.q0; var q1 = fit.q1;
  var idx = fit.idx;
  if (idx[0] >= 8u) {
    q0 = fit.q1; q1 = fit.q0;
    for (var i = 0u; i < 16u; i++) { idx[i] = 15u - idx[i]; }
  }
  var w = vec4u(0u); var off = 0u;
  put(&w, &off, 64u, 7u); // mode 6
  put(&w, &off, q0.x, 7u); put(&w, &off, q1.x, 7u);
  put(&w, &off, q0.y, 7u); put(&w, &off, q1.y, 7u);
  put(&w, &off, q0.z, 7u); put(&w, &off, q1.z, 7u);
  put(&w, &off, 127u, 7u); put(&w, &off, 127u, 7u); // alpha 255 with the p-bits
  put(&w, &off, 1u, 1u); put(&w, &off, 1u, 1u);
  put(&w, &off, idx[0], 3u);
  for (var i = 1u; i < 16u; i++) { put(&w, &off, idx[i], 4u); }
  outb[g.y * P.z + g.x] = w;
}
`;

const bc7Pipes = new WeakMap<GPUDevice, GPUComputePipeline>();

/** Encodes an image (already at the array's size) and its mip chain into layer `z` of a BC7 array texture. */
export function gpuBc7(d: GPUDevice, img: ImageBitmap | OffscreenCanvas | HTMLCanvasElement, srgb: boolean, dst: GPUTexture, z: number): void {
  let pipe = bc7Pipes.get(d);
  if (!pipe) {
    pipe = d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: BC7_WGSL, label: 'bc7.encode' }), entryPoint: 'main' } });
    bc7Pipes.set(d, pipe);
  }
  const size = dst.width;
  const fmt: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
  // the mips are filtered in the source's colour space (linear light for sRGB albedo); the encoder reads raw bytes
  const tmp = d.createTexture({
    label: 'bc7.src', size: [size, size], format: fmt, mipLevelCount: dst.mipLevelCount, viewFormats: srgb ? ['rgba8unorm'] : [],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  d.queue.copyExternalImageToTexture({ source: img }, { texture: tmp }, [size, size]);
  generateMips(d, tmp);
  const enc = d.createCommandEncoder({ label: 'bc7.encode' });
  const bufs: GPUBuffer[] = [];
  for (let mip = 0; mip < dst.mipLevelCount; mip++) {
    const s = Math.max(1, size >> mip);
    const l = bcLayout(s, s);
    const stride = Math.ceil(l.bytesPerRow / 256) * 256;
    const out = d.createBuffer({ label: 'bc7.blocks', size: stride * l.rows, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const uni = d.createBuffer({ label: 'bc7.params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(uni, 0, new Uint32Array([l.bytesPerRow / 16, l.rows, stride / 16, 0]));
    bufs.push(out, uni);
    const bind = d.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tmp.createView({ format: 'rgba8unorm', baseMipLevel: mip, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: out } }, { binding: 2, resource: { buffer: uni } },
      ],
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(l.bytesPerRow / 16 / 8), Math.ceil(l.rows / 8));
    pass.end();
    enc.copyBufferToTexture({ buffer: out, bytesPerRow: stride, rowsPerImage: l.rows }, { texture: dst, mipLevel: mip, origin: [0, 0, z] }, [l.physW, l.physH, 1]);
  }
  d.queue.submit([enc.finish()]);
  tmp.destroy();
  for (const b of bufs) b.destroy();
}

// ---- detail layer: procedural, tileable, generated once at init (kn_detail_* stand-ins) -------------------

const DETAIL_SIZE = 512;

const DETAIL_WGSL = /* wgsl */ `
struct FsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> FsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: FsOut;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
@group(0) @binding(0) var<uniform> layer: vec4u;

fn hash2(p: vec2i, per: vec2i) -> f32 {
  let q = ((p % per) + per) % per;
  var h = (u32(q.x) * 1597334677u) ^ (u32(q.y) * 3812015801u) ^ (layer.x * 2654435769u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}
/// Tileable value noise: period 'per' cells across the unit square.
fn vnoise(uv: vec2f, per: vec2i) -> f32 {
  let p = uv * vec2f(per);
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i, per); let b = hash2(i + vec2i(1, 0), per);
  let c = hash2(i + vec2i(0, 1), per); let d = hash2(i + vec2i(1, 1), per);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(uv: vec2f, per: vec2i, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var p = per;
  for (var k = 0; k < oct; k++) { s += a * vnoise(uv, p); p *= 2; a *= 0.5; }
  return s;
}
/// Height field of each detail kind (0..1) and its albedo variation.
fn height(uv: vec2f) -> vec2f {
  switch (layer.x) {
    case 1u, 2u, 3u: {
      // wood: long, fine, nearly straight streaks along u, as the key art's Cycles wood (_tactile.py: bands
      // in coordinates stretched 14x across the grain). The streaks wobble at most ~1.5 cm across a 0.5 m tile;
      // the first pass's ring warp of ~15 cm read as cartoon waves in the D79 side-by-side (M3 close-out).
      let warp = fbm(uv, vec2i(2, 6), 3) * 0.03 + fbm(uv, vec2i(1, 12), 2) * 0.012;
      let g = fbm(vec2f(uv.x, uv.y + warp), vec2i(2, 96), 3);
      let streak = sin((uv.y + warp) * 6.2831 * 22.0) * 0.5 + 0.5;
      let band = pow(streak, 3.0) * 0.45 + g * 0.6;
      return vec2f(g * 0.6 + streak * 0.12, band);
    }
    case 4u: { return vec2f(fbm(uv, vec2i(24, 24), 3), 0.5); } // orange peel
    case 5u: {
      // pitting: sparse round dimples
      let n = fbm(uv, vec2i(32, 32), 2);
      return vec2f(1.0 - smoothstep(0.62, 0.78, n) * 0.9 + fbm(uv, vec2i(64, 64), 2) * 0.1, 0.5 - smoothstep(0.62, 0.8, n) * 0.08);
    }
    case 6u: { return vec2f(fbm(vec2f(uv.x, uv.y), vec2i(2, 256), 2), 0.5); } // brushed
    case 7u: { return vec2f(fbm(uv, vec2i(48, 48), 4), 0.5 + (fbm(uv, vec2i(16, 16), 3) - 0.5) * 0.08); } // paper tooth
    case 8u: { return vec2f(fbm(uv, vec2i(64, 64), 2), 0.5); } // rubber stipple
    case 9u: { return vec2f(sin((uv.x + uv.y) * 6.2831 * 8.0) * 0.5 + 0.5, 0.5); } // twist
    case 10u: { return vec2f(fbm(uv, vec2i(8, 8), 5), 0.5 + (fbm(uv, vec2i(4, 4), 4) - 0.5) * 0.12); } // plaster
    case 11u: { return vec2f(fbm(uv, vec2i(20, 20), 4), 0.5 + (fbm(uv, vec2i(6, 6), 3) - 0.5) * 0.25); } // brick
    default: { return vec2f(0.5, 0.5); }
  }
}
@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  if (layer.x == 0u) { return vec4f(0.5, 0.5, 0.5, 0.5); }
  let e = 1.0 / ${DETAIL_SIZE}.0;
  let h = height(i.uv);
  let hx = height(i.uv + vec2f(e, 0.0)).x - height(i.uv - vec2f(e, 0.0)).x;
  let hy = height(i.uv + vec2f(0.0, e)).x - height(i.uv - vec2f(0.0, e)).x;
  var amp = 1.0;
  switch (layer.x) {
    case 1u, 2u, 3u: { amp = 2.5; }
    case 4u: { amp = 1.6; }
    case 5u: { amp = 6.0; }
    case 6u: { amp = 1.2; }
    case 7u: { amp = 1.5; }
    case 9u: { amp = 3.0; }
    default: { amp = 2.0; }
  }
  let n = clamp(vec2f(-hx, -hy) * amp * 6.0, vec2f(-1.0), vec2f(1.0));
  // roughness offset: valleys rougher (pits, grain), ridges a touch glossier
  let r = 0.5 + (0.5 - h.x) * 0.35;
  return vec4f(n * 0.5 + 0.5, r, h.y);
}
`;

function makeDetail(d: GPUDevice): GPUTexture {
  const mips = Math.floor(Math.log2(DETAIL_SIZE)) + 1;
  const tex = d.createTexture({
    label: 'detail', size: [DETAIL_SIZE, DETAIL_SIZE, DETAIL_LAYERS], format: 'rgba8unorm', mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
  const mod = d.createShaderModule({ code: DETAIL_WGSL, label: 'detail' });
  const pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  for (let l = 0; l < DETAIL_LAYERS; l++) {
    const ub = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ub, 0, new Uint32Array([l, 0, 0, 0]));
    const bind = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ dimension: '2d', baseArrayLayer: l, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 } }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
    generateMipsLayer(d, tex, l);
    ub.destroy();
  }
  return tex;
}
