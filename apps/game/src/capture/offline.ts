// C4 (M4): offline rendering (GAME_SPEC §17.4, RENDERING §13): a baked run rendered along any camera path frame
// perfect, regardless of live performance.
//
// - Clock: frame index. Each frame seeks the sim worker's playback to an exact tick over the BakeStore
//   (run.captureSeek; the worker bakes ahead of the held playhead on its own), then advances the main thread's
//   virtual clock (clock.ts) by exactly 1/fps so every Spectacle system steps a fixed dt, then draws.
//   Hitstop and auto slow-mo still happen: they stretch clip time (fewer ticks per frame) instead of wall time.
// - Quality: forced to the tier's max: the live governor off and reset, native resolution with 4× MSAA (no TAA
//   upscale), whatever the frame costs.
// - Size: the canvas gets an exact-aspect CSS box and a resolution scale so the drawing buffer is exactly W×H; past
//   the device's maxTextureDimension2D it is downscaled to fit and the result says so (the renderer has no sub-
//   frustum hook for tiling).

import type { CameraRig, CamMode } from '../cameras.ts';
import type { Renderer } from '../gfx/renderer.ts';
import type { RunController } from '../run.ts';
import type { V3 } from '../math.ts';
import { advanceClock, installClock, realNow, uninstallClock } from './clock.ts';
import type { EncodedAudioTrack } from './mp4.ts';
import type { CameraPath, CamShot } from './path.ts';
import { GifSink, VideoSink, WebpSink, type ClipFormat, type ClipResult, type ClipSink } from './video.ts';

export type CamSource = 'current' | 'director' | 'ride' | 'path';

export interface CaptureHost {
  readonly renderer: Renderer;
  readonly run: RunController;
  readonly camRig: CameraRig;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: HTMLElement;
  /** Draws one frame now (main.ts's frame body, with the capture's camera). */
  renderFrame(): void;
  /** Drops live particles, volumes, debris and flashes so a clip starts clean. */
  clearSpectacle(): void;
  mute(on: boolean): void;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
  /** Starts a solo preview run (only the test system) when there's no run; false if it can't. */
  startSoloRun(): boolean;
  stopRun(): void;
  worldId(): string;
  worldTitle(): string;
  /** F5 (M5): a fresh offline sound track for an MP4 clip (audio/clip.ts), or null for a silent clip. */
  clipAudio?(): ClipAudioTrack | null;
}

/**
 * F5 (M5): the clip's sound, rendered offline on the capture's frame clock (audio/clip.ts). Frame `i` counts from
 * the first preroll frame. Per frame: `at(i)` before the seek (the frame's sim events land at exactly i / fps of
 * audio time), the frame's audio hooks run during the seek and draw, then `advance(i)` lets the render run on.
 */
export interface ClipAudioTrack {
  /** Starts the offline render (room for `maxSeconds` of audio). False: no sound for this clip. */
  begin(fps: number, maxSeconds: number): Promise<boolean>;
  at(i: number): Promise<void>;
  advance(i: number): void;
  /** Stops listening, finishes the render and returns [fromS, toS) encoded (AAC or Opus), or null. */
  finish(fromS: number, toS: number): Promise<EncodedAudioTrack | null>;
  abort(): void;
  /** Why the clip has no sound, or what was cut short (shown in the result note). */
  readonly note: string;
}

export interface ClipOptions {
  readonly source: CamSource;
  readonly path?: CameraPath | null;
  /** Clip start and end, seconds of run time. */
  readonly start: number;
  readonly end: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly format: ClipFormat;
  /** Seconds rendered before `start` (not kept) so effects already under way are in the first frame. */
  readonly preroll?: number;
}

export interface ClipProgress {
  readonly phase: 'starting' | 'preroll' | 'render' | 'encode';
  readonly frame: number;
  readonly frames: number;
  readonly elapsedMs: number;
  /** Seconds left, from the measured per-frame time. */
  readonly etaS: number | null;
  readonly msPerFrame: number;
}

export interface ClipOutcome extends ClipResult {
  readonly renderMs: number;
  readonly msPerFrame: number;
  readonly note: string;
  readonly source: CamSource;
  readonly fps: number;
}

export const MAX_CLIP_S = 300;
const TICK_RATE = 120;

/** Even W×H that fit the device's texture limit, keeping the aspect (and a note when it had to shrink). */
export function fitToDevice(w: number, h: number, maxDim: number): { w: number; h: number; note: string } {
  const s = Math.min(1, maxDim / w, maxDim / h);
  if (s >= 1) return { w: w & ~1, h: h & ~1, note: '' };
  const fw = Math.floor((w * s) / 2) * 2, fh = Math.floor((h * s) / 2) * 2;
  return { w: fw, h: fh, note: `Rendered at ${fw}×${fh}: this GPU's texture limit is ${maxDim} px (asked for ${w}×${h}).` };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Holds the renderer at an exact W×H at full quality, and puts everything back afterwards. */
export class RenderTarget {
  private readonly saved: { style: string; upscale: number; scale: number; gov: boolean };
  constructor(private readonly host: CaptureHost, readonly width: number, readonly height: number) {
    const { canvas, renderer } = host;
    this.saved = { style: canvas.getAttribute('style') ?? '', upscale: renderer.upscale, scale: renderer.resolutionScale, gov: renderer.lookPass.governor.enabled };
    // an exact-aspect CSS box inside the viewport (whole aspect units, so W/H divide exactly), centred: the live preview
    const g = gcd(width, height);
    let aw = width / g, ah = height / g;
    if (aw > 64) { aw = width / 8; ah = height / 8; } // odd ratios: 1/8 steps still divide exactly
    const vr = host.viewport.getBoundingClientRect();
    const m = Math.max(1, Math.floor(Math.min((vr.width - 32) / aw, (vr.height - 32) / ah)));
    const cw = aw * m, ch = ah * m;
    canvas.style.cssText = `${this.saved.style};position:absolute;left:50%;top:50%;width:${cw}px;height:${ch}px;transform:translate(-50%,-50%);`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resolutionScale = (width / (cw * dpr)) * (1 + 1e-9);
    renderer.upscale = 1; // native, 4× MSAA
    renderer.lookPass.governor.enabled = false;
    renderer.lookPass.governor.reset();
    renderer.resize();
    if (canvas.width !== width || canvas.height !== height) {
      // layout rounding on this display: nudge the scale by the measured ratio once
      renderer.resolutionScale *= (width / canvas.width) * (1 + 1e-9);
      renderer.resize();
    }
  }

  get exact(): boolean { return this.host.canvas.width === this.width && this.host.canvas.height === this.height; }

  restore(): void {
    const { canvas, renderer } = this.host;
    canvas.setAttribute('style', this.saved.style);
    if (!this.saved.style) canvas.removeAttribute('style');
    renderer.resolutionScale = this.saved.scale;
    renderer.upscale = this.saved.upscale;
    renderer.lookPass.governor.enabled = this.saved.gov;
    renderer.resize();
  }
}

/** What the capture controller exposes to main.ts while a clip renders. */
export interface ActiveCapture {
  /** The camera for this frame, or null to let the camera rig (director / ride) pick it. */
  shot(): CamShot | null;
}

/** Texture sets still streaming in (they'd render as untextured blockouts for the first frames). */
const texturesPending = (r: Renderer): number => (r.lookPass as unknown as { tex?: { pending?: Set<unknown> } }).tex?.pending?.size ?? 0;

/** Waits (the live loop still drawing) until no texture set is loading, up to `ms`. */
export async function settleAssets(r: Renderer, ms = 20000): Promise<boolean> {
  return waitFor(() => texturesPending(r) === 0, ms);
}

const waitFor = async (cond: () => boolean, ms: number): Promise<boolean> => {
  const t0 = realNow();
  while (!cond()) { if (realNow() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 30)); }
  return true;
};

/**
 * Renders a clip. `setActive` hands main.ts the per-frame camera while it runs (null afterwards). Throws on failure
 * or when `signal` aborts (an AbortError).
 */
export async function renderClip(host: CaptureHost, opts: ClipOptions, setActive: (a: ActiveCapture | null) => void, onProgress: (p: ClipProgress) => void, signal: AbortSignal): Promise<ClipOutcome> {
  const { run, renderer, camRig } = host;
  const t0 = realNow();
  const prog = (p: Omit<ClipProgress, 'elapsedMs'>): void => onProgress({ ...p, elapsedMs: realNow() - t0 });
  prog({ phase: 'starting', frame: 0, frames: 0, etaS: null, msPerFrame: 0 });
  // a run to film: the current one, or a solo preview that only the test system sees
  let startedRun = false;
  if (run.phase === 'build') {
    if (!host.startSoloRun()) throw new Error('Could not start a run to record.');
    startedRun = true;
  }
  if (!(await waitFor(() => run.phase === 'running' && run.bodies.length > 0, 20000))) {
    if (startedRun) host.stopRun();
    throw new Error('The run did not start (still in the countdown?).');
  }
  if (!(await settleAssets(renderer))) host.toast('Some textures are still loading: the clip may start with plain parts.', 'warn');
  const maxDim = renderer.device.limits.maxTextureDimension2D;
  // GIF / WebP: rendered at 2× (up to the video size) and downscaled, so small clips are supersampled
  const ss = opts.format === 'mp4' ? 1 : Math.max(1, Math.min(2, Math.floor(3840 / opts.width)));
  const fit = fitToDevice(opts.width * ss, opts.height * ss, maxDim);
  const outW = opts.format === 'mp4' ? fit.w : opts.width, outH = opts.format === 'mp4' ? fit.h : opts.height;
  const fps = opts.fps;
  const startTick = Math.max(0, opts.start * TICK_RATE);
  const endTick = Math.max(startTick + 1, Math.min(opts.end, opts.start + MAX_CLIP_S) * TICK_RATE);
  const preTick = Math.max(0, startTick - (opts.preroll ?? 1) * TICK_RATE);
  const estFrames = Math.ceil(((endTick - startTick) / TICK_RATE) * fps);

  // warps (hitstop, slow-mo) in clip time
  let warp = { factor: 1, until: -1 };
  let clipT = 0;
  if (!run.captureBegin({ warp: (factor, seconds) => { if (factor < warp.factor || clipT >= warp.until) warp = { factor, until: clipT + seconds }; else warp.until = Math.max(warp.until, clipT + seconds); } })) {
    if (startedRun) host.stopRun();
    throw new Error(run.bakeProgress ? 'Finish or cancel Bake & Watch first.' : 'There is no run to record.');
  }
  let target: RenderTarget | null = null;
  let sink: ClipSink | null = null;
  let track: ClipAudioTrack | null = null; // F5 (M5)
  const modeBefore: CamMode = camRig.mode;
  const fixedShot: CamShot = { eye: [...renderer.eye] as V3, target: [...renderer.target] as V3, fov: renderer.fovDeg };
  let ok = false;
  try {
    installClock();
    host.mute(true);
    target = new RenderTarget(host, fit.w, fit.h);
    const name = `knockon-${Date.now().toString(36)}.${opts.format}`;
    sink = opts.format === 'mp4' ? await VideoSink.create(outW, outH, fps, name) : opts.format === 'gif' ? new GifSink(outW, outH, fps) : new WebpSink(outW, outH, fps);
    if (opts.source === 'director' || opts.source === 'ride') {
      camRig.setMode(opts.source);
      // UIFIX (D122): the render rewinds the run to the clip start. Start the auto camera afresh there, given the
      // events before it (the worker replays only those after its first seek), so it cuts exactly as live does.
      camRig.restart(run.log.filter((e) => e.tick <= preTick));
    }
    const path = opts.source === 'path' && opts.path && opts.path.keys.length ? opts.path : null;
    const clipDur = (endTick - startTick) / TICK_RATE;
    const shotAt = (t: number): CamShot | null => {
      if (path) return path.at(path.keys[0]!.t + (clipDur > 0 ? (t / clipDur) * path.duration : 0));
      if (opts.source === 'current') return fixedShot;
      return null;
    };
    let curShot: CamShot | null = shotAt(0);
    setActive({ shot: () => curShot });
    host.clearSpectacle();
    const dt = 1000 / fps;
    const seek = async (tick: number): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), 30000); });
      const r = await Promise.race([run.captureSeek(tick), timeout]);
      clearTimeout(timer);
      if (r === 'late') throw new Error(`The simulation did not reach ${(tick / TICK_RATE).toFixed(2)} s within 30 s.`);
      if (!r) throw new Error('The run ended during the capture.');
      await run.matter?.playbackTo(tick); // M4: Matter on the exact frame (the replica steps asynchronously)
    };
    // preroll: effects that started before the clip are under way in its first frame
    const preFrames = Math.round(((startTick - preTick) / TICK_RATE) * fps);
    // F5 (M5): the sound track, rendered offline on this frame clock (MP4 only). Room for slow-mo and hitstop to
    // stretch the clip to twice its length; past that the rest of the clip is silent (and the note says so).
    if (opts.format === 'mp4' && host.clipAudio) {
      const t = host.clipAudio();
      const room = preFrames / fps + Math.min(MAX_CLIP_S, clipDur * 2 + 2) + 0.5;
      if (t && (await t.begin(fps, room))) track = t;
      else if (t?.note) host.toast(t.note, 'warn');
    }
    for (let i = 0; i < preFrames; i++) {
      if (signal.aborted) throw new DOMException('Capture cancelled', 'AbortError');
      await track?.at(i);
      await seek(preTick + ((startTick - preTick) * i) / preFrames);
      advanceClock(dt);
      host.renderFrame();
      track?.advance(i);
      if (i % 10 === 0) prog({ phase: 'preroll', frame: i, frames: preFrames, etaS: null, msPerFrame: 0 });
      await renderer.device.queue.onSubmittedWorkDone();
    }
    // the clip
    let tick = startTick, frame = 0;
    const r0 = realNow();
    const maxFrames = MAX_CLIP_S * fps;
    while (tick < endTick && frame < maxFrames) {
      if (signal.aborted) throw new DOMException('Capture cancelled', 'AbortError');
      clipT = frame / fps;
      await track?.at(preFrames + frame); // F5 (M5): the frame's events land at its audio time
      await seek(tick);
      curShot = shotAt((tick - startTick) / TICK_RATE);
      advanceClock(dt);
      host.renderFrame();
      track?.advance(preFrames + frame);
      sink.add(host.canvas, frame); // same task as the draw: the canvas texture is still current
      await sink.ready();
      await renderer.device.queue.onSubmittedWorkDone();
      frame++;
      const f = clipT < warp.until ? warp.factor : 1;
      tick += (TICK_RATE / fps) * Math.max(0.05, f);
      const ms = (realNow() - r0) / frame;
      const left = Math.max(0, Math.ceil(((endTick - tick) / TICK_RATE) * fps));
      if (frame % 2 === 0 || tick >= endTick) prog({ phase: 'render', frame, frames: frame + left, etaS: (left * ms) / 1000, msPerFrame: ms });
    }
    const renderMs = realNow() - r0;
    prog({ phase: 'encode', frame, frames: frame, etaS: null, msPerFrame: renderMs / Math.max(1, frame) });
    // F5 (M5): finish the offline audio (the clip's span, preroll dropped), encode it, hand it to the muxer
    if (track) {
      const a = await track.finish(preFrames / fps, (preFrames + frame) / fps);
      if (a) sink.setAudio?.(a);
    }
    const res = await sink.finish((u) => prog({ phase: 'encode', frame: Math.round(u * frame), frames: frame, etaS: null, msPerFrame: renderMs / Math.max(1, frame) }));
    ok = true;
    const notes = [fit.note, target.exact ? '' : `The drawing buffer came out ${host.canvas.width}×${host.canvas.height}.`, track?.note ?? ''].filter(Boolean);
    if (frame >= maxFrames && tick < endTick) notes.push('Clips stop at 5 minutes.');
    if (frame > estFrames + 1) notes.push(`Slow-mo and hitstop stretched it to ${(frame / fps).toFixed(1)} s.`);
    return { ...res, renderMs, msPerFrame: renderMs / Math.max(1, frame), note: notes.join(' '), source: opts.source, fps };
  } finally {
    setActive(null);
    if (!ok) { sink?.abort(); track?.abort(); } // F5 (M5): track
    else track?.abort(); // a no-op once finished; makes sure the live mix gets its hooks back
    target?.restore();
    if (camRig.mode !== modeBefore) camRig.setMode(modeBefore);
    uninstallClock();
    host.mute(false);
    run.captureEnd();
    host.clearSpectacle();
    if (startedRun) host.stopRun();
  }
}

/**
 * Renders the current view as a still at W×H (photo mode, the share card): exact size, full quality, one frame at
 * the frozen virtual time. Returns the blob (PNG or WebP).
 */
export async function renderStill(host: CaptureHost, width: number, height: number, type: 'image/png' | 'image/webp', quality = 0.92): Promise<{ blob: Blob; width: number; height: number; note: string }> {
  await settleAssets(host.renderer, 10000);
  const fit = fitToDevice(width, height, host.renderer.device.limits.maxTextureDimension2D);
  const target = new RenderTarget(host, fit.w, fit.h);
  try {
    // two frames: the first after a resize builds the new targets (and the look pass's per-size state)
    host.renderFrame();
    await host.renderer.device.queue.onSubmittedWorkDone();
    host.renderFrame();
    const blob = await new Promise<Blob | null>((res) => host.canvas.toBlob(res, type, quality));
    if (!blob) throw new Error('The canvas could not be encoded.');
    return { blob, width: host.canvas.width, height: host.canvas.height, note: fit.note };
  } finally {
    target.restore();
  }
}
