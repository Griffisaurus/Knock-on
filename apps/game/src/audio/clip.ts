// F5 (M5): sound for captured clips (RENDERING §13; clips were silent in M4, C4's notes).
//
// The clip's audio is the game's own mix, rendered offline on the capture's frame clock:
//   - a second GameAudio runs on an OfflineAudioContext and shares the live director's synthesised banks (no
//     rebuild). For the length of the capture the live director forwards every world hook main.ts makes (events,
//     part state, rollers, loops, listener, playback, spectacle) to it: the same calls, from the same frames, so
//     the clip hears exactly what the game would have played. State setters (mode, room, paths, key) also stay
//     with the live director, so it is in step when the capture ends. UI sounds are left out of clips.
//   - the offline context is stepped one video frame at a time with suspend() / resume(): frame i's hooks run
//     while it is suspended at exactly i / fps (capture/offline.ts calls at(i) before the frame's sim seek, so the
//     events the seek delivers land at that time, and advance(i) after the draw). The rendered audio is therefore
//     a function of the frames alone, however long each frame took to draw: render the same clip twice and the
//     PCM is the same (`lastHash`; the offline check compares two renders).
//   - beta (D127): before rendering on, advance(i) lets the clip's director settle frame i (GameAudio.clipSettle):
//     the Matter probe that frame requested is read back and applied at i / fps, and the granular worklet confirms
//     it has the params. Matter was the one sound that lagged (2.75 frames); it now starts with the frame's events.
//   - at the end the clip's span [preroll, last frame) is cut out and encoded with WebCodecs AudioEncoder: AAC-LC
//     (192 kbps) where the browser has it, else Opus (160 kbps); capture/mp4.ts muxes it as the MP4's second track.
//
// Memory: the offline context holds its whole buffer (stereo float, 23 MB per minute), sized for the clip plus
// room for slow-mo / hitstop stretching (capture/offline.ts). A clip that outruns it goes silent from there on.

import type { EncodedAudioTrack, Mp4AudioConfig } from '../capture/mp4.ts';
import type { GameAudio } from './index';

// WebCodecs audio (Chrome 94+): TypeScript 5.6's DOM lib has the video half only, so the few members used here are
// declared locally (the globals exist at run time; every use is guarded by `typeof AudioEncoder`).
interface AudioEncoderConfig { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number; aac?: { format: 'aac' | 'adts' }; opus?: Record<string, unknown> }
interface EncodedAudioChunkLike { readonly byteLength: number; readonly timestamp: number; readonly duration: number | null; copyTo(dst: Uint8Array): void }
interface AudioEncoderLike extends EventTarget {
  readonly encodeQueueSize: number;
  configure(c: AudioEncoderConfig): void;
  encode(d: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
}
interface AudioDataLike { close(): void }
declare const AudioEncoder: {
  new (init: { output: (chunk: EncodedAudioChunkLike, meta?: { decoderConfig?: { description?: AllowSharedBufferSource } }) => void; error: (e: unknown) => void }): AudioEncoderLike;
  isConfigSupported(c: AudioEncoderConfig): Promise<{ supported?: boolean }>;
};
declare const AudioData: {
  new (init: { format: 'f32-planar'; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }): AudioDataLike;
};

export const CLIP_SR = 48000;
const QUANTUM = 128;

/** The audio encoder for clips: AAC-LC first (plays everywhere MP4 does), then Opus. Cached per page. */
let chosen: Promise<{ config: AudioEncoderConfig; codec: 'aac' | 'opus'; label: string; bitrate: number } | null> | null = null;
export function chooseAudioCodec(): Promise<{ config: AudioEncoderConfig; codec: 'aac' | 'opus'; label: string; bitrate: number } | null> {
  chosen ??= (async () => {
    if (typeof AudioEncoder === 'undefined') return null;
    const cands: { config: AudioEncoderConfig; codec: 'aac' | 'opus'; label: string; bitrate: number }[] = [
      { config: { codec: 'mp4a.40.2', sampleRate: CLIP_SR, numberOfChannels: 2, bitrate: 192000, aac: { format: 'aac' } } as AudioEncoderConfig, codec: 'aac', label: 'AAC-LC 192 kbps', bitrate: 192000 },
      { config: { codec: 'opus', sampleRate: CLIP_SR, numberOfChannels: 2, bitrate: 160000 }, codec: 'opus', label: 'Opus 160 kbps', bitrate: 160000 },
    ];
    for (const c of cands) {
      if (preferred && c.codec !== preferred) continue;
      try { if ((await AudioEncoder.isConfigSupported(c.config)).supported) return c; } catch { /* next */ }
    }
    return null;
  })();
  return chosen;
}
let preferred: 'aac' | 'opus' | null = null;
/** Tests: pin the clip codec ('aac' / 'opus'), or null for the default order. */
export function preferAudioCodec(c: 'aac' | 'opus' | null): void { preferred = c; chosen = null; }

const bytesOf = (d: AllowSharedBufferSource): Uint8Array => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength)));

/** Encodes planar stereo PCM at 48 kHz. Timestamps start at 0. */
export async function encodeAudio(chs: readonly Float32Array[], sampleRate = CLIP_SR): Promise<EncodedAudioTrack | null> {
  const c = await chooseAudioCodec();
  if (!c || !chs.length) return null;
  const n = chs[0]!.length, nch = Math.min(2, chs.length);
  const samples: { data: Uint8Array; pts: number; dur: number }[] = [];
  let description: Uint8Array | undefined;
  let failed: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      samples.push({ data: b, pts: chunk.timestamp, dur: chunk.duration ?? Math.round((c.codec === 'aac' ? 1024 : 960) * 1e6 / sampleRate) });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = bytesOf(d);
    },
    error: (e) => { failed = e; },
  });
  enc.configure({ ...c.config, sampleRate, numberOfChannels: nch });
  const F = 4800; // 100 ms blocks
  for (let o = 0; o < n && !failed; o += F) {
    const k = Math.min(F, n - o);
    const data = new Float32Array(k * nch);
    for (let ch = 0; ch < nch; ch++) data.set(chs[ch]!.subarray(o, o + k), ch * k);
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: k, numberOfChannels: nch, timestamp: Math.round((o * 1e6) / sampleRate), data });
    enc.encode(ad);
    ad.close();
    // backpressure: keep the encoder queue short (a 5-minute clip is 3,000 blocks)
    if (enc.encodeQueueSize > 32) await new Promise<void>((r) => { const f = (): void => { if (enc.encodeQueueSize <= 8) { enc.removeEventListener('dequeue', f); r(); } }; enc.addEventListener('dequeue', f); });
  }
  if (!failed) await enc.flush().catch((e) => { failed = e; });
  try { enc.close(); } catch { /* closed */ }
  if (failed || !samples.length) { console.warn('[audio] clip sound track encode failed', failed); return null; }
  // Opus: the OpusHead's pre-skip is trimmed by the MP4's edit list (and dOps); Chrome's AAC encoder adds no delay
  // that its decoders don't remove (measured: a click comes back at the same sample, M5_NOTES_F5.md)
  const pre = c.codec === 'opus' && description && description.length >= 12 && String.fromCharCode(...description.subarray(0, 8)) === 'OpusHead' ? description[10]! | (description[11]! << 8) : 0;
  const cfg: Mp4AudioConfig = {
    codec: c.codec, codecString: c.codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, channels: nch, bitrate: c.bitrate, priming: pre, frames: n,
    ...(description ? { description } : {}),
  };
  return { cfg, samples, label: c.label };
}

/** FNV-1a over the float bits (the determinism check: two renders of one clip must match exactly). */
export function pcmHash(chs: readonly Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const x of chs) {
    const u = new Uint32Array(x.buffer, x.byteOffset, x.length);
    for (let i = 0; i < u.length; i++) { h ^= u[i]!; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** What the live director lends a clip: the offline director to forward to, and how to build it. */
export interface ClipHost {
  /** A GameAudio on `ctx` sharing the live banks, set up with the live state (mode, room, air, paths, key, listener). */
  makeOffline(ctx: OfflineAudioContext): Promise<GameAudio>;
  /** Forward world hooks to `g` (null: back to the live mix). */
  setTap(g: GameAudio | null): void;
}

/**
 * One clip's sound track (capture/offline.ts ClipAudioTrack): begin → per frame at(i) / advance(i) → finish.
 */
export class ClipAudio {
  private ctx: OfflineAudioContext | null = null;
  private g: GameAudio | null = null;
  private fps = 60;
  private started = false;
  private rendering: Promise<AudioBuffer> | null = null;
  private next: Promise<void> | null = null;
  private nextIdx = -1;
  private overrun = false;
  private done = false;
  note = '';
  /** Diagnostics: the PCM hash of the last finished clip, render time (ms) and frames stepped. */
  static last: { hash: string; tailMs: number; encodeMs: number; frames: number; seconds: number; codec: string; peak: number; probes: number; matterAcks: number; matterAckTimeouts: number } | null = null;
  /** Wall time (a capture swaps `performance.now` for its frame clock, so diagnostics use Date). */
  private static wall = (): number => Date.now();
  /** Tests: keep the PCM handed to the encoder (lastPcm). */
  static keepPcm = false;
  static lastPcm: Float32Array[] | null = null;
  private frames = 0;

  constructor(private readonly host: ClipHost) {}

  async begin(fps: number, maxSeconds: number): Promise<boolean> {
    try {
      if (typeof OfflineAudioContext === 'undefined') { this.note = 'This browser has no offline audio: the clip is silent.'; return false; }
      if (!(await chooseAudioCodec())) { this.note = 'This browser has no AAC or Opus audio encoder: the clip is silent.'; return false; }
      this.fps = Number.isFinite(fps) && fps > 0 ? fps : 60;
      const len = Math.max(QUANTUM * 4, Math.ceil(Math.min(Math.max(1, maxSeconds), 330) * CLIP_SR));
      this.ctx = new OfflineAudioContext(2, len, CLIP_SR);
      this.g = await this.host.makeOffline(this.ctx);
      this.host.setTap(this.g);
        return true;
    } catch (err) {
      console.warn('[audio] clip sound track could not start', err);
      this.note = 'The clip is silent: offline audio failed to start.';
      this.host.setTap(null);
      return false;
    }
  }

  /** Resolves once the offline render has reached frame `i` (suspended at i / fps). */
  at(i: number): Promise<void> {
    if (this.done || this.overrun || !this.next || this.nextIdx !== i) return Promise.resolve();
    return this.next;
  }

  /** Frame `i`'s hooks have run: render on to frame i + 1. */
  advance(i: number): void {
    const ctx = this.ctx;
    if (!ctx || this.done || this.overrun) return;
    this.frames = i + 1;
    const t = (i + 1) / this.fps;
    if (Math.ceil(t * CLIP_SR / QUANTUM) * QUANTUM >= ctx.length - QUANTUM) {
      // out of room: render to the end; the rest of the clip is silent
      this.overrun = true;
      this.note = `The sound track stops at ${(ctx.length / CLIP_SR).toFixed(1)} s (slow-mo stretched the clip past the room it had).`;
      this.host.setTap(null);
      this.next = null;
      this.go();
      return;
    }
    // beta (D127): first let the clip's director settle this frame (the Matter probe it requested is read back and
    // applied at i / fps, and the granular worklet has it), then render on to frame i + 1
    const g = this.g;
    this.next = (g ? g.clipSettle().catch(() => { /* counted in its stats */ }) : Promise.resolve()).then(() => {
      if (this.ctx !== ctx) return undefined;
      const p = ctx.suspend(t);
      this.go();
      return p;
    });
    this.nextIdx = i + 1;
  }

  private go(): void {
    const ctx = this.ctx!;
    // resume() on a running offline context is allowed; checking `state` first races the suspend promise
    if (!this.started) { this.started = true; this.rendering = ctx.startRendering(); }
    else ctx.resume().catch(() => { /* finished */ });
  }

  async finish(fromS: number, toS: number): Promise<EncodedAudioTrack | null> {
    const ctx = this.ctx;
    this.host.setTap(null);
    if (!ctx || this.done) return null;
    this.done = true;
    // let the render reach the last frame (its pending suspend), then cut the director off so the rest of the buffer
    // renders as silence, fast, and run it out
    const f0 = ClipAudio.wall();
    if (this.next) await this.next;
    this.next = null;
    const st = this.g?.stats; // beta (D127): the Matter sync diagnostics, before the director goes
    const sync = { probes: st?.probes ?? 0, matterAcks: st?.matterAcks ?? 0, matterAckTimeouts: st?.matterAckTimeouts ?? 0 };
    this.g?.dispose();
    this.go();
    const buf = await this.rendering!;
    const tailMs = ClipAudio.wall() - f0; // the last frame's render plus running out the (silent) rest of the buffer
    const a = Math.max(0, Math.min(buf.length, Math.round(fromS * CLIP_SR)));
    const b = Math.max(a, Math.min(buf.length, Math.round(toS * CLIP_SR)));
    const want = Math.max(0, Math.round((toS - fromS) * CLIP_SR));
    const chs = [0, 1].map((c) => { const x = new Float32Array(want); x.set(buf.getChannelData(c).subarray(a, b)); return x; });
    let peak = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]!); if (v > peak) peak = v; }
    if (ClipAudio.keepPcm) ClipAudio.lastPcm = chs;
    const e0 = ClipAudio.wall();
    const enc = await encodeAudio(chs);
    ClipAudio.last = { hash: pcmHash(chs), tailMs, encodeMs: ClipAudio.wall() - e0, frames: this.frames, seconds: want / CLIP_SR, codec: enc?.label ?? 'none', peak, ...sync };
    this.ctx = null; this.g = null;
    if (!enc) this.note = 'The clip is silent: the audio encoder failed.';
    return enc;
  }

  abort(): void {
    this.host.setTap(null);
    if (this.done) return;
    this.done = true;
    this.g?.dispose();
    const ctx = this.ctx, next = this.next;
    // run the render out in the background (a suspend still pending has to be reached first) and drop it
    if (ctx && this.started) void (async () => { if (next) await next.catch(() => {}); ctx.resume().catch(() => { /* finished */ }); })();
    this.ctx = null; this.g = null; this.next = null;
  }
}
