// C4 (M4): capture glue for main.ts (GAME_SPEC §17.4, RENDERING §13, UI_UX §4.9 / §4.11): photo mode (F10), the
// capture dialog and offline clips, and the Cascade Report's share card. main.ts asks it each frame for the camera
// (`shot`), whether time is frozen (`frozen`), whether the build overlays should hide (`clean`), whether it owns the
// render quality (`ownsQuality`), and whether its own rAF frame should be skipped (`busy`, an offline render drives
// the frames itself).

import type { CascadeReport } from '../cascade.ts';
import type { V3 } from '../math.ts';
import { settings } from '../ui/settings.ts';
import { CaptureDialog, resFor, type CaptureSettings } from '../ui/capture.ts';
import { PhotoPanel, PHOTO_RES, type PhotoState } from '../ui/photo.ts';
import { installClock, realNow, uninstallClock } from './clock.ts'; // UIFIX (D122): realNow
import { chooseCodec } from './codecs.ts';
import { renderClip, renderStill, type ActiveCapture, type CaptureHost, type ClipOutcome } from './offline.ts';
import { clearCaptureFiles } from './video.ts';
import { calibrate, drawMs, frameMs, loadCost, saveCost, type CostFormat } from './estimate.ts'; // UIFIX (D122)
import { CameraPath, loadPath, savePath, type CamShot } from './path.ts';
import { CARD_H, CARD_W, composeCard, type CardInfo } from './sharecard.ts';

export type { CaptureHost } from './offline.ts';

const SENSOR_H = 24; // mm (full frame, vertical)
export const fovFromFocal = (mm: number): number => (2 * Math.atan(SENSOR_H / 2 / mm) * 180) / Math.PI;
export const focalFromFov = (deg: number): number => SENSOR_H / 2 / Math.tan((deg * Math.PI) / 360);

/**
 * Thin-lens circle of confusion for the look pass's photo DOF (px radius at 1080p per dioptre of defocus), the
 * hero shot's formula (gfx/look/hero.ts): (F/N) · F/(s − F) · s / 2 / sensor height × 1080, s the focus distance (mm).
 */
export function photoCoc(focalMm: number, fNumber: number, focusM: number): number {
  if (!fNumber) return 0;
  const s = Math.max(focusM * 1000, focalMm * 1.5);
  return ((focalMm / fNumber) * focalMm / (s - focalMm)) * s / 2 / SENSOR_H * 1080 / 1000;
}

export interface CaptureExtras {
  partName(id: number): string;
  runLabel(): string;
  report(): CascadeReport | null;
}

export class CaptureController {
  private readonly host: CaptureHost;
  private readonly extras: CaptureExtras;
  private readonly panel: PhotoPanel;
  private readonly dialog: CaptureDialog;
  private photoOn = false;
  private held = false;
  private ph: PhotoState = { yaw: 0, pitch: 0.5, dist: 4, focal: 50, aperture: 0, exposure: 0, lut: true, grid: false, res: '4K', format: 'png' };
  private target: V3 = [0, 0, 0];
  private active: ActiveCapture | null = null;
  private rendering = false;
  private abort: AbortController | null = null;
  private saved: { exposure: number; lut: boolean | undefined; dof: boolean | undefined; coc: number; focus: V3 | null } | null = null;
  private path: CameraPath;
  private pathWorld = '';
  private codecCache = new Map<string, Promise<string | null>>();
  /** The last finished capture (debug / automation: `__kn.capture.last`). */
  last: { blob: Blob; name: string; meta: string; outcome?: ClipOutcome } | null = null;

  constructor(host: CaptureHost, extras: CaptureExtras) {
    this.host = host;
    this.extras = extras;
    void clearCaptureFiles(); // clips left in OPFS by an earlier session
    this.path = loadPath(host.worldId());
    this.pathWorld = host.worldId();
    this.panel = new PhotoPanel(host.viewport, {
      state: () => this.ph,
      change: (p) => { this.ph = { ...this.ph, ...p }; this.applyLook(); },
      pan: (dx, dy) => this.pan(dx, dy),
      capture: () => void this.capturePhoto(),
      addKey: () => this.addKey(),
      clearKeys: () => { this.path = new CameraPath([]); savePath(this.worldKey(), this.path); },
      keyCount: () => this.currentPath().keys.length,
      recordClip: () => this.openDialog(),
      close: () => this.togglePhoto(false),
      maxDim: () => this.maxDim(),
    });
    this.dialog = new CaptureDialog(host.viewport, {
      runSeconds: () => this.runSeconds(),
      hasPath: () => this.currentPath().keys.length >= 2,
      pathKeys: () => this.currentPath().keys.length,
      maxDim: () => this.maxDim(),
      codecFor: (w, h, fps) => this.codecLabel(w, h, fps),
      estimateMs: (w, h, f) => this.estimateMs(w, h, f),
      start: (s) => void this.startClip(s),
      cancel: () => this.abort?.abort(),
      onClose: () => { document.documentElement.toggleAttribute('data-capture-open', false); },
    });
  }

  // ---- what main.ts reads each frame ---------------------------------------------------------------------

  /** An offline render is drawing the frames itself: skip main's own rAF frames (not while it waits for assets). */
  get busy(): boolean { return this.active !== null; }
  /** Photo mode: time stands still (dt = 0, particles held). */
  get frozen(): boolean { return this.photoOn && !this.rendering; }
  /** Hide build-only overlays (ghost, ports, cursor, hover, pings, trails). */
  get clean(): boolean { return this.photoOn || this.rendering; }
  /** The renderer's resolution / upscale belong to the capture right now. */
  get ownsQuality(): boolean { return this.rendering || this.stillBusy; }
  get photo(): boolean { return this.photoOn; }
  private stillBusy = false;

  /** The camera for this frame, or null for the camera rig. */
  shot(): CamShot | null {
    if (this.active) return this.active.shot();
    if (this.photoOn) return this.photoShot();
    return null;
  }

  /** Per frame (cheap): the grid overlay follows the canvas. */
  frame(): void { if (this.photoOn) this.panel.layoutGrid(this.host.canvas); }

  /** Keys: F10 photo mode, Esc leaves it, K adds a path key. Returns true when handled. */
  keydown(e: KeyboardEvent): boolean {
    if (this.rendering) { if (e.key === 'Escape') { this.abort?.abort(); e.preventDefault(); } return true; }
    if (this.dialog.open) { if (e.key === 'Escape') { this.dialog.close(); return true; } return false; } // focus inside: the dialog's own handler
    if (e.key === 'F10') { e.preventDefault(); if (e.shiftKey) this.openDialog(); else this.togglePhoto(); return true; }
    if (!this.photoOn) return false;
    if (e.key === 'Escape') { this.togglePhoto(false); e.preventDefault(); return true; }
    if (e.key === 'k' || e.key === 'K') { this.addKey(); this.panel.render(); return true; }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { void this.capturePhoto(); return true; }
    // photo mode swallows the build keys (tools, deleting, running)
    return !['Tab'].includes(e.key);
  }

  // ---- photo mode ----------------------------------------------------------------------------------------

  togglePhoto(on = !this.photoOn): void {
    if (on === this.photoOn || this.rendering) return;
    const r = this.host.renderer, lp = r.lookPass;
    if (on) {
      // start from the current view
      const eye = r.eye, tgt = r.target;
      const d: V3 = [eye[0] - tgt[0], eye[1] - tgt[1], eye[2] - tgt[2]];
      const dist = Math.max(0.06, Math.hypot(d[0], d[1], d[2]));
      this.target = [tgt[0], tgt[1], tgt[2]];
      this.ph = { ...this.ph, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / dist))), dist, focal: Math.round(focalFromFov(r.fovDeg)), aperture: 0, exposure: 0, lut: lp.force.lut !== false };
      this.saved = { exposure: r.exposureBoost, lut: lp.force.lut, dof: lp.force.dof, coc: lp.photoCoc, focus: lp.focusPoint };
      // the run holds still on the test system only (the partner's playback carries on)
      this.held = this.host.run.phase === 'running' && this.host.run.captureBegin();
      this.photoOn = true;
      document.documentElement.toggleAttribute('data-photo', true);
      this.panel.show();
      this.applyLook();
      this.host.toast(this.held ? "Photo mode: the run holds still here (your partner's carries on). Esc or F10 leaves." : 'Photo mode: Esc or F10 leaves.');
    } else {
      this.photoOn = false;
      this.panel.hide();
      document.documentElement.toggleAttribute('data-photo', false);
      const s = this.saved;
      if (s) {
        r.exposureBoost = s.exposure;
        if (s.lut === undefined) delete lp.force.lut; else lp.force.lut = s.lut;
        if (s.dof === undefined) delete lp.force.dof; else lp.force.dof = s.dof;
        lp.photoCoc = s.coc;
        lp.focusPoint = s.focus;
      }
      this.saved = null;
      if (this.held) this.host.run.captureEnd();
      this.held = false;
    }
  }

  private photoShot(): CamShot {
    const p = this.ph, t = this.target;
    const eye: V3 = [t[0] + p.dist * Math.cos(p.pitch) * Math.sin(p.yaw), t[1] + p.dist * Math.sin(p.pitch), t[2] + p.dist * Math.cos(p.pitch) * Math.cos(p.yaw)];
    return { eye, target: [...t] as V3, fov: fovFromFocal(p.focal) };
  }

  private pan(dx: number, dy: number): void {
    const p = this.ph, s = p.dist * 0.0015;
    const right: V3 = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    const fwd: V3 = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
    this.target = [this.target[0] - right[0] * dx * s + fwd[0] * dy * s, this.target[1], this.target[2] - right[2] * dx * s + fwd[2] * dy * s];
  }

  /** Exposure, LUT and the thin-lens DOF focused on the orbit centre. */
  private applyLook(): void {
    if (!this.photoOn) return;
    const r = this.host.renderer, lp = r.lookPass, p = this.ph;
    r.exposureBoost = p.exposure;
    if (p.lut) delete lp.force.lut; else lp.force.lut = false;
    if (p.aperture > 0) {
      lp.focusPoint = [...this.target] as V3;
      lp.photoCoc = photoCoc(p.focal, p.aperture, p.dist);
      delete lp.force.dof;
    } else {
      lp.photoCoc = 0;
      lp.focusPoint = null;
      lp.force.dof = false;
    }
  }

  private async capturePhoto(): Promise<void> {
    if (this.stillBusy) return;
    const res = PHOTO_RES[this.ph.res] ?? null;
    const c = this.host.canvas;
    const [w, h] = res ?? [c.width & ~1, c.height & ~1];
    const type = this.ph.format === 'webp' ? 'image/webp' : 'image/png';
    this.stillBusy = true;
    this.panel.setLast(`Rendering ${w}×${h}…`);
    try {
      installClock(); // frozen: the still is exactly this moment
      const out = await renderStill(this.host, w, h, type);
      const name = `knockon-photo-${stamp()}.${this.ph.format}`;
      const meta = `${out.width}×${out.height} ${this.ph.format.toUpperCase()}`;
      this.last = { blob: out.blob, name, meta };
      this.panel.setLast(`${name} · ${out.width}×${out.height} · ${(out.blob.size / 1e6).toFixed(1)} MB`);
      this.dialog.result({ title: 'Photo', blob: out.blob, name, meta, ...(out.note ? { note: out.note } : {}), copy: typeof ClipboardItem !== 'undefined' && type === 'image/png' });
    } catch (err) {
      this.panel.setLast(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      uninstallClock();
      this.stillBusy = false;
    }
  }

  private worldKey(): string { return this.host.worldId(); }
  private currentPath(): CameraPath {
    if (this.pathWorld !== this.host.worldId()) { this.pathWorld = this.host.worldId(); this.path = loadPath(this.pathWorld); }
    return this.path;
  }

  private addKey(): void {
    const p = this.currentPath();
    const s = this.photoShot();
    const t = p.keys.length ? p.keys.at(-1)!.t + 2 : 0;
    this.path = new CameraPath([...p.keys, { t, eye: s.eye, target: s.target, fov: s.fov }]);
    savePath(this.worldKey(), this.path);
    this.host.toast(`Camera key ${this.path.keys.length} added`);
  }

  // ---- clips ---------------------------------------------------------------------------------------------

  /** Opens the capture dialog (Cascade Report › Record clip, photo mode, Shift+F10). */
  openDialog(preset: Partial<CaptureSettings> = {}): void {
    if (this.rendering) return;
    if (this.photoOn) this.togglePhoto(false);
    document.documentElement.toggleAttribute('data-capture-open', true);
    this.dialog.show(preset);
  }

  private runSeconds(): number {
    const run = this.host.run;
    const lastEv = run.log.length ? run.log.at(-1)!.tick : 0;
    // through the last event plus a beat, else what's baked, else 10 s
    const t = lastEv ? lastEv / run.tickRate + 1.5 : run.baked / run.tickRate;
    return t > 0.5 ? Math.min(300, t) : 10;
  }

  private maxDim(): number { return this.host.renderer.device?.limits.maxTextureDimension2D ?? 8192; }

  private codecLabel(w: number, h: number, fps: number): Promise<string | null> {
    const k = `${w}x${h}@${fps}`;
    let p = this.codecCache.get(k);
    if (!p) { p = chooseCodec(w, h, fps).then((c) => c?.label ?? null); this.codecCache.set(k, p); }
    return p;
  }

  /**
   * ms per frame: the live GPU frame time scaled by pixel count, plus the per-frame residual measured on earlier
   * renders (UIFIX, D122: capture/estimate.ts; the old fixed 14 ms made "≈ 29 s" of a 79 s render).
   */
  private estimateMs(w: number, h: number, format: string): number {
    return frameMs(loadCost(), this.liveGpuMs(), w, h, this.host.canvas.width * this.host.canvas.height, format as CostFormat);
  }

  private liveGpuMs(): number {
    const r = this.host.renderer;
    let gpu = r.timer.frameMs; // G5 (M5): the GPU frame time (the per-pass map can hold names that stopped running)
    if (!(gpu > 0)) gpu = r.stats.frameMs || 16;
    return gpu;
  }

  private async startClip(s: CaptureSettings): Promise<void> {
    const [w, h] = resFor(s);
    const wall0 = realNow(); // UIFIX (D122): the whole wait, start to file (real time: the clip runs on a virtual clock), calibrates the next estimate
    const draw = drawMs(this.liveGpuMs(), w, h, this.host.canvas.width * this.host.canvas.height, s.format);
    this.abort = new AbortController();
    this.rendering = true;
    this.last = null;
    await clearCaptureFiles(); // the previous clip's OPFS file
    document.documentElement.toggleAttribute('data-capturing', true);
    try {
      const out = await renderClip(this.host, {
        source: s.source, path: this.currentPath(), start: s.start, end: s.end, width: w, height: h, fps: s.fps, format: s.format, preroll: s.start > 0 ? 1 : 0,
      }, (a) => { this.active = a; }, (p) => this.dialog.progress(p), this.abort.signal);
      const name = `knockon-clip-${stamp()}.${out.ext}`;
      const meta = `${out.width}×${out.height} · ${out.frames} frames at ${out.fps} fps · ${out.codec} · rendered in ${(out.renderMs / 1000).toFixed(1)} s (${out.msPerFrame.toFixed(0)} ms/frame)`;
      this.last = { blob: out.blob, name, meta, outcome: out };
      saveCost(calibrate(loadCost(), s.format, realNow() - wall0, out.frames, draw)); // UIFIX (D122)
      this.rendering = false;
      document.documentElement.toggleAttribute('data-capturing', false);
      this.dialog.result({ title: 'Clip ready', blob: out.blob, name, meta, ...(out.note ? { note: out.note } : {}) });
    } catch (err) {
      this.rendering = false;
      document.documentElement.toggleAttribute('data-capturing', false);
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      if (cancelled) { this.dialog.failed('Cancelled. Nothing was saved.'); this.host.toast('Capture cancelled'); }
      else { this.dialog.failed(`Capture failed: ${err instanceof Error ? err.message : String(err)}`); console.error(err); }
    } finally {
      this.rendering = false;
      this.active = null;
      this.abort = null;
      document.documentElement.toggleAttribute('data-capturing', false);
    }
  }

  // ---- the Cascade Report's share card ------------------------------------------------------------------

  async shareCard(r: CascadeReport | null = this.extras.report()): Promise<void> {
    if (!r || this.rendering || this.stillBusy) return;
    this.stillBusy = true;
    const heldHere = !this.photoOn && this.host.run.phase === 'running' && this.host.run.captureBegin();
    try {
      installClock();
      const still = await renderStill(this.host, CARD_W, CARD_H, 'image/png');
      const info: CardInfo = { partName: (id) => this.extras.partName(id), worldTitle: this.host.worldTitle(), runLabel: this.extras.runLabel(), tickRate: this.host.run.tickRate };
      const card = await composeCard(still.blob, r, info);
      const name = `knockon-card-${stamp()}.png`;
      this.last = { blob: card, name, meta: `${CARD_W}×${CARD_H} PNG` };
      document.documentElement.toggleAttribute('data-capture-open', true);
      this.dialog.result({ title: 'Share card', blob: card, name, meta: `${CARD_W}×${CARD_H} PNG · score ${r.score.toLocaleString()} · ${r.title}`, copy: typeof ClipboardItem !== 'undefined' });
    } catch (err) {
      this.host.toast(`Share card failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      uninstallClock();
      if (heldHere) this.host.run.captureEnd();
      this.stillBusy = false;
    }
  }

  /** Reduce motion (UI_UX §7): no camera easing exists here; the panels follow the global reduced-motion rules. */
  get reducedMotion(): boolean { return settings.comfort.reducedMotion; }
}

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

