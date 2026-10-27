// C4 (M4): clip sinks for the offline render (RENDERING §13): MP4 through WebCodecs VideoEncoder and our muxer
// worker, GIF through our encoder worker, animated WebP through the browser's still encoder and our RIFF writer.
// Each takes the canvas right after a frame was drawn (same task: the WebGPU canvas texture is still current).

import { chooseCodec, type CodecChoice } from './codecs.ts';
import type { EncodedAudioTrack, VideoCodecKind } from './mp4.ts';
import type { FromMp4Worker, ToMp4Worker } from './mp4.worker.ts';
import type { FromGifWorker, ToGifWorker } from './gif.worker.ts';
import { buildAnimatedWebp, stillToFrame, webpDurations, type AnimFrame } from './webp.ts';

export type ClipFormat = 'mp4' | 'gif' | 'webp';

export interface ClipResult {
  readonly blob: Blob;
  readonly mime: string;
  readonly ext: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly bytes: number;
  /** "AV1 (hardware)", "GIF (255 colours)", "WebP (lossy frames)". */
  readonly codec: string;
  /** 'opfs' when the MP4 streamed to the origin-private file system. */
  readonly storage?: 'opfs' | 'memory';
  /** F5 (M5): the sound track's codec ("AAC-LC 192 kbps"), when the clip has one. */
  readonly audio?: string;
}

export interface ClipSink {
  readonly label: string;
  /** Takes the frame now on `canvas` (call right after drawing it). */
  add(canvas: HTMLCanvasElement, index: number): void;
  /** F5 (M5): the clip's encoded sound track, muxed in by `finish` (MP4 only; GIF / WebP have none). */
  setAudio?(a: EncodedAudioTrack): void;
  /** Resolves when the sink can take another frame (encoder backpressure). */
  ready(): Promise<void>;
  finish(onProgress?: (f: number) => void): Promise<ClipResult>;
  abort(): void;
}

/**
 * Removes earlier clips from the origin-private file system (the MP4 worker streams each clip there; a 5-minute 720p
 * clip measured 77 MB). Called at boot and before each new clip, so only the latest one is kept.
 */
export async function clearCaptureFiles(keep?: string): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('captures', { create: true });
    const names: string[] = [];
    for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) if (name !== keep) names.push(name);
    for (const n of names) { try { await dir.removeEntry(n); } catch { /* still open */ } }
    return names.length;
  } catch { return 0; }
}

/** A VideoFrame of the canvas; WebGPU canvases that can't be wrapped directly go through a 2D copy. */
function frameOf(canvas: HTMLCanvasElement, timestamp: number, duration: number, scratch: { c: OffscreenCanvas | null }): VideoFrame {
  try {
    return new VideoFrame(canvas, { timestamp, duration, alpha: 'discard' });
  } catch {
    const c = (scratch.c ??= new OffscreenCanvas(canvas.width, canvas.height));
    if (c.width !== canvas.width || c.height !== canvas.height) { c.width = canvas.width; c.height = canvas.height; }
    c.getContext('2d')!.drawImage(canvas, 0, 0);
    return new VideoFrame(c, { timestamp, duration, alpha: 'discard' });
  }
}

export class VideoSink implements ClipSink {
  readonly label: string;
  private readonly enc: VideoEncoder;
  private readonly worker: Worker;
  private readonly us: number;
  private readonly keyEvery: number;
  private inited = false;
  private failed: Error | null = null;
  private frames = 0;
  private readonly scratch = { c: null as OffscreenCanvas | null };
  private done: ((m: Extract<FromMp4Worker, { type: 'done' }>) => void) | null = null;
  private fail: ((e: Error) => void) | null = null;
  private readonly waiters: (() => void)[] = [];

  /** `only` pins one codec (tests, the notes' per-codec checks); otherwise AV1 → HEVC → H.264, hardware first. */
  static async create(w: number, h: number, fps: number, name: string, only?: VideoCodecKind): Promise<VideoSink> {
    const c = await chooseCodec(w, h, fps, only);
    if (!c) throw new Error(`No video encoder for ${w}×${h} at ${fps} fps in this browser (tried AV1, HEVC and H.264)`);
    return new VideoSink(c, w, h, fps, name);
  }

  private constructor(readonly choice: CodecChoice, readonly width: number, readonly height: number, readonly fps: number, name: string) {
    this.label = choice.label;
    this.us = 1e6 / fps;
    this.keyEvery = Math.max(1, Math.round(fps * 2));
    this.worker = new Worker(new URL('./mp4.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromMp4Worker>) => {
      const m = ev.data;
      if (m.type === 'error') this.setFailed(new Error(`MP4 muxer: ${m.message}`));
      else if (m.type === 'done') this.done?.(m);
    };
    this.enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (!this.inited) {
          const d = meta?.decoderConfig?.description;
          const description = d ? (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength))) : undefined;
          this.post({ type: 'init', name, cfg: { codec: choice.kind, codecString: choice.codec, width: this.width, height: this.height, fps, ...(description ? { description } : {}) } });
          this.inited = true;
        }
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        this.post({ type: 'sample', data: buf, key: chunk.type === 'key', pts: chunk.timestamp, dur: chunk.duration ?? this.us }, [buf]);
      },
      error: (e) => this.setFailed(e instanceof Error ? e : new Error(String(e))),
    });
    this.enc.addEventListener('dequeue', () => { while (this.waiters.length && this.enc.encodeQueueSize < 3) this.waiters.shift()!(); });
    this.enc.configure(choice.config);
  }

  private post(m: ToMp4Worker, t: Transferable[] = []): void { this.worker.postMessage(m, t); }

  private setFailed(e: Error): void {
    if (this.failed) return;
    this.failed = e;
    this.fail?.(e);
    while (this.waiters.length) this.waiters.shift()!();
  }

  add(canvas: HTMLCanvasElement, index: number): void {
    if (this.failed) throw this.failed;
    const f = frameOf(canvas, Math.round(index * this.us), Math.round(this.us), this.scratch);
    try { this.enc.encode(f, { keyFrame: index % this.keyEvery === 0 }); } finally { f.close(); }
    this.frames++;
  }

  ready(): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.enc.encodeQueueSize < 3) return Promise.resolve();
    return new Promise<void>((res) => this.waiters.push(res)).then(() => { if (this.failed) throw this.failed; });
  }

  /** F5 (M5): the sound track to mux in at `finish`. */
  private audio: EncodedAudioTrack | null = null;
  setAudio(a: EncodedAudioTrack): void { this.audio = a; }

  async finish(): Promise<ClipResult> {
    if (this.failed) throw this.failed;
    await this.enc.flush();
    if (this.failed) throw this.failed;
    this.enc.close();
    // F5 (M5): the sound track goes after the last video sample (its own chunks in mdat, its own trak in moov)
    const a = this.audio;
    if (a && a.samples.length) {
      this.post({ type: 'audio', cfg: a.cfg });
      for (const s of a.samples) {
        const buf = s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength) as ArrayBuffer;
        this.post({ type: 'asample', data: buf, pts: s.pts, dur: s.dur }, [buf]);
      }
    }
    const m = await new Promise<Extract<FromMp4Worker, { type: 'done' }>>((res, rej) => { this.done = res; this.fail = rej; this.post({ type: 'finish' }); });
    this.worker.terminate();
    const withAudio = a && (m.audioSamples ?? 0) > 0;
    return {
      blob: m.file.type ? m.file : new Blob([m.file], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', width: this.width, height: this.height, frames: m.samples, bytes: m.bytes,
      codec: withAudio ? `${this.label} + ${a.label}` : this.label, storage: m.storage, ...(withAudio ? { audio: a.label } : {}),
    };
  }

  abort(): void {
    try { if (this.enc.state !== 'closed') this.enc.close(); } catch { /* closed */ }
    this.post({ type: 'abort' });
    setTimeout(() => this.worker.terminate(), 2000);
  }
}

/** Draws the (supersampled) canvas into a w×h 2D canvas and returns its pixels. */
class Downscaler {
  private readonly c: OffscreenCanvas;
  private readonly g: OffscreenCanvasRenderingContext2D;
  constructor(readonly w: number, readonly h: number) {
    this.c = new OffscreenCanvas(w, h);
    this.g = this.c.getContext('2d', { willReadFrequently: true, alpha: false })!;
    this.g.imageSmoothingEnabled = true;
    this.g.imageSmoothingQuality = 'high';
  }
  pixels(src: HTMLCanvasElement): ImageData {
    this.g.drawImage(src, 0, 0, this.w, this.h);
    return this.g.getImageData(0, 0, this.w, this.h);
  }
}

export class GifSink implements ClipSink {
  readonly label = 'GIF (255 colours, ordered dither)';
  private readonly worker: Worker;
  private readonly down: Downscaler;
  private frames = 0;
  private failed: Error | null = null;

  constructor(readonly width: number, readonly height: number, readonly fps: number) {
    this.down = new Downscaler(width, height);
    this.worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromGifWorker>) => { if (ev.data.type === 'error') this.failed = new Error(`GIF encoder: ${ev.data.message}`); };
    this.post({ type: 'init', width, height });
  }

  private post(m: ToGifWorker, t: Transferable[] = []): void { this.worker.postMessage(m, t); }

  add(canvas: HTMLCanvasElement): void {
    if (this.failed) throw this.failed;
    const px = this.down.pixels(canvas);
    this.post({ type: 'frame', rgba: px.data.buffer }, [px.data.buffer]);
    this.frames++;
  }

  ready(): Promise<void> { return this.failed ? Promise.reject(this.failed) : Promise.resolve(); }

  finish(onProgress?: (f: number) => void): Promise<ClipResult> {
    return new Promise((res, rej) => {
      this.worker.onmessage = (ev: MessageEvent<FromGifWorker>) => {
        const m = ev.data;
        if (m.type === 'progress') onProgress?.(m.frame / Math.max(1, this.frames));
        else if (m.type === 'error') rej(new Error(`GIF encoder: ${m.message}`));
        else if (m.type === 'done') {
          this.worker.terminate();
          const blob = new Blob([m.bytes], { type: 'image/gif' });
          res({ blob, mime: 'image/gif', ext: 'gif', width: this.width, height: this.height, frames: this.frames, bytes: m.bytes.byteLength, codec: `GIF (${m.colours} colours, ordered dither)` });
        }
      };
      this.post({ type: 'finish', fps: this.fps });
    });
  }

  abort(): void { this.worker.terminate(); }
}

export class WebpSink implements ClipSink {
  readonly label = 'Animated WebP (lossy frames, changed rectangles)';
  private readonly down: Downscaler;
  private prev: Uint8ClampedArray | null = null;
  private readonly frames: { x: number; y: number; data: Promise<Uint8Array>; ticks: number }[] = [];
  private count = 0;
  private pending = 0;

  constructor(readonly width: number, readonly height: number, readonly fps: number, readonly quality = 0.85) {
    this.down = new Downscaler(width, height);
  }

  add(canvas: HTMLCanvasElement): void {
    const px = this.down.pixels(canvas);
    const cur = px.data;
    this.count++;
    let x0 = 0, y0 = 0, x1 = this.width - 1, y1 = this.height - 1;
    if (this.prev) {
      x0 = this.width; y0 = this.height; x1 = -1; y1 = -1;
      const W = this.width, p = this.prev;
      for (let y = 0; y < this.height; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (Math.abs(cur[o]! - p[o]!) > 6 || Math.abs(cur[o + 1]! - p[o + 1]!) > 6 || Math.abs(cur[o + 2]! - p[o + 2]!) > 6) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) { this.frames.at(-1)!.ticks++; return; } // unchanged: the previous frame shows one frame longer
      x0 &= ~1; y0 &= ~1; // ANMF offsets are even
    }
    // keep the changed rectangle as what's now on screen
    this.prev = cur;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const crop = new OffscreenCanvas(w, h);
    crop.getContext('2d')!.putImageData(px, -x0, -y0, x0, y0, w, h);
    this.pending++;
    const data = crop.convertToBlob({ type: 'image/webp', quality: this.quality }).then(async (b) => {
      this.pending--;
      if (b.type !== 'image/webp') throw new Error('This browser cannot encode WebP');
      return new Uint8Array(await b.arrayBuffer());
    });
    this.frames.push({ x: x0, y: y0, data, ticks: 1 });
  }

  async ready(): Promise<void> {
    // bound the in-flight still encodes
    while (this.pending > 8) await this.frames[this.frames.length - this.pending]!.data.catch(() => undefined);
  }

  async finish(onProgress?: (f: number) => void): Promise<ClipResult> {
    const durs = webpDurations(this.count, this.fps);
    const anim: AnimFrame[] = [];
    let k = 0;
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i]!;
      let ms = 0;
      for (let j = 0; j < f.ticks; j++) ms += durs[k++]!;
      anim.push({ data: stillToFrame(await f.data), x: f.x, y: f.y, durationMs: ms });
      onProgress?.(i / this.frames.length);
    }
    const bytes = buildAnimatedWebp(this.width, this.height, anim, 0, 0xff000000);
    return { blob: new Blob([bytes], { type: 'image/webp' }), mime: 'image/webp', ext: 'webp', width: this.width, height: this.height, frames: this.count, bytes: bytes.length, codec: `${this.label}, ${anim.length} stored` };
  }

  abort(): void { this.frames.length = 0; }
}
