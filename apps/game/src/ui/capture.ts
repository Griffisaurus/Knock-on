// C4 (M4): the Capture dialog (UI_UX §4.11): camera source, start / end, resolution, fps, format, estimated render
// time, then a progress bar with Cancel, then the result (preview, size, Save). Also shows the Share card. A modal
// glass surface (`#capture-dialog`, registered in glass.ts). Styles for the C4 surfaces live here (capture + photo),
// on the --surface* tokens only, so Reduce transparency and the solid fallback apply.

import { ICON, esc, h } from './icons.ts';
import { settings } from './settings.ts';

const CSS = `
:root[data-photo] #viewport > :not(canvas):not(#photo):not(#photo-orbit):not(#photo-grid):not(#toasts):not(#capture-dialog):not(#scrim),
:root[data-capturing] #viewport > :not(canvas):not(#capture-dialog):not(#toasts) { visibility: hidden !important; }
:root[data-capturing] #viewport { background: var(--kn-void); }
#capture-dialog { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100% - 32px)); max-height: calc(100% - 48px); overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; z-index: 32; scrollbar-color: rgb(255 255 255 / .18) transparent; background: var(--surface); -webkit-backdrop-filter: var(--surface-filter); backdrop-filter: var(--surface-filter); box-shadow: var(--surface-ring); border-radius: var(--r-panel); color: var(--kn-paper); scrollbar-width: thin; }
#capture-dialog.busy { top: auto; bottom: 24px; transform: translateX(-50%); width: min(520px, calc(100% - 32px)); }
#capture-dialog .cd-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
#capture-dialog .cd-head b { font: 900 20px var(--font-display); }
#capture-dialog .cd-body { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: var(--surface-well); }
#capture-dialog .cd-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 8px; font-size: 14px; }
#capture-dialog .cd-row > span { color: var(--text-2); font-size: 13px; }
#capture-dialog .cd-row .seg { flex-wrap: wrap; background: var(--kbd-bg); }
#capture-dialog .cd-row .seg button { font-family: var(--font-ui); }
#capture-dialog .cd-times { display: flex; align-items: center; gap: 8px; }
#capture-dialog .cd-times input { width: 90px; background: var(--kbd-bg); font-family: var(--font-mono); }
#capture-dialog .cd-note { color: var(--text-2); font-size: 12px; margin: 0; }
#capture-dialog .cd-note.warn { color: var(--kn-amber); }
#capture-dialog .cd-est { font: 700 13px var(--font-mono); color: var(--kn-paper); }
#capture-dialog .cd-acts { display: flex; justify-content: flex-end; gap: 8px; }
#capture-dialog .cd-acts button { height: 38px; padding: 0 16px; }
#capture-dialog .cd-go { min-width: 150px; }
#capture-dialog .cd-prog { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 12px; background: var(--surface-well); }
#capture-dialog .cd-phase { font-size: 14px; }
#capture-dialog .cd-bar { height: 10px; border-radius: 999px; background: var(--kbd-bg); overflow: hidden; }
#capture-dialog .cd-bar i { display: block; height: 100%; width: 0; background: var(--kn-ignition); border-radius: 999px; }
#capture-dialog .cd-stat { display: flex; justify-content: space-between; font: 700 12px var(--font-mono); color: var(--text-2); }
#capture-dialog .cd-result { display: flex; flex-direction: column; gap: 10px; align-items: stretch; padding: 12px; border-radius: 12px; background: var(--surface-well); }
#capture-dialog .cd-result video, #capture-dialog .cd-result img { width: 100%; max-height: 46vh; object-fit: contain; border-radius: 10px; background: #000; }
#capture-dialog .cd-meta { font: 700 12px var(--font-mono); color: var(--text-2); word-break: break-word; }
#photo { position: absolute; left: var(--m); top: var(--m); max-height: calc(100% - 2 * var(--m)); width: 300px; z-index: 12; display: flex; flex-direction: column; gap: 8px; padding: 12px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .18) transparent; }
#photo .ph-head { display: flex; align-items: center; justify-content: space-between; }
#photo .ph-head b { font: 900 18px var(--font-display); }
#photo .ph-sec { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; }
#photo .ph-sec > .sec { margin-bottom: 2px; }
#photo label.ph-sl { display: grid; grid-template-columns: 74px 1fr 58px; align-items: center; gap: 6px; font-size: 13px; }
#photo label.ph-sl em { font: normal 700 12px var(--font-mono); color: var(--kn-paper); text-align: right; }
#photo label.ph-sl span { color: var(--text-2); }
#photo input[type=range] { width: 100%; padding: 0; accent-color: var(--kn-beam); background: none; border: 0; }
#photo .seg { flex-wrap: wrap; background: var(--kbd-bg); }
#photo .seg button { height: 28px; padding: 0 8px; font-family: var(--font-ui); font-size: 12px; }
#photo .ph-tg { display: flex; gap: 6px; flex-wrap: wrap; }
#photo .ph-tg button { height: 30px; padding: 0 10px; border-radius: var(--r-ctl); background: var(--kbd-bg); font: 600 12px var(--font-ui); }
#photo .ph-tg button.on { background: var(--kn-select); color: #fff; }
#photo .ph-cap { height: 44px; width: 100%; }
#photo .ph-row { display: flex; gap: 6px; align-items: center; }
#photo .ph-row .ghost { flex: 1; justify-content: center; }
#photo small { color: var(--text-2); font-size: 12px; }
#photo .ph-last { font: 700 11px var(--font-mono); color: var(--text-2); word-break: break-all; }
#photo-orbit { position: absolute; inset: 0; z-index: 11; cursor: grab; touch-action: none; }
#photo-orbit.drag { cursor: grabbing; }
#photo-grid { position: absolute; z-index: 11; pointer-events: none; }
#photo-grid i { position: absolute; background: rgb(255 255 255 / .45); box-shadow: 0 0 0 1px rgb(0 0 0 / .25); }
:root[data-reduced-motion="1"] #photo, :root[data-reduced-motion="1"] #capture-dialog { transition: none !important; animation: none !important; }
`;

let styled = false;
export function ensureCaptureStyles(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'kn-capture-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export type DialogFormat = 'mp4' | 'gif' | 'webp';
export type DialogSource = 'current' | 'director' | 'ride' | 'path';

export interface CaptureSettings {
  source: DialogSource;
  start: number;
  end: number;
  res: string;
  fps: number;
  format: DialogFormat;
}

export interface DialogHost {
  /** Run length known so far (seconds) and the suggested end. */
  runSeconds(): number;
  hasPath(): boolean;
  pathKeys(): number;
  /** Max texture size (8K needs ≥ 7680). */
  maxDim(): number;
  /** "AV1 (hardware)" for a size/fps, or null. */
  codecFor(w: number, h: number, fps: number): Promise<string | null>;
  /** Estimated ms per frame at w×h (from the live GPU time; measured once rendering starts). */
  estimateMs(w: number, h: number, format: DialogFormat): number;
  start(s: CaptureSettings): void;
  cancel(): void;
  onClose(): void;
}

export const VIDEO_RES: Record<string, [number, number]> = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4K': [3840, 2160], '8K': [7680, 4320] };
export const SMALL_RES: Record<string, [number, number]> = { '320p': [568, 320], '360p': [640, 360], '480p': [854, 480], '540p': [960, 540] };
const FPS_VIDEO = [24, 30, 50, 60];
const FPS_GIF = [10, 20, 25, 50];
const FPS_WEBP = [10, 20, 25, 30, 50, 60];

export function resFor(s: Pick<CaptureSettings, 'res' | 'format'>): [number, number] {
  return (s.format === 'mp4' ? VIDEO_RES[s.res] : SMALL_RES[s.res]) ?? (s.format === 'mp4' ? VIDEO_RES['1080p']! : SMALL_RES['360p']!);
}

const fmtTime = (s: number): string => (s < 60 ? `${Math.max(0, Math.round(s))} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
const fmtBytes = (n: number): string => (n < 1e6 ? `${(n / 1e3).toFixed(0)} KB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`);

/** GIF memory guard: 2 bytes per pixel per frame are held until the palette is known (≤ 256 MB). */
export const gifMaxSeconds = (w: number, h: number, fps: number): number => Math.floor((256 * 1048576) / (w * h * 2) / fps);

export class CaptureDialog {
  readonly el: HTMLElement;
  private readonly host: DialogHost;
  private s: CaptureSettings = { source: 'director', start: 0, end: 10, res: '1080p', fps: 60, format: 'mp4' };
  private mode: 'form' | 'busy' | 'result' = 'form';
  private resultUrl: string | null = null;

  constructor(parent: HTMLElement, host: DialogHost) {
    ensureCaptureStyles();
    this.host = host;
    this.el = h('<section id="capture-dialog" role="dialog" aria-modal="true" aria-label="Record clip" hidden></section>');
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (this.mode === 'busy') this.host.cancel(); else this.close(); }
    });
    parent.appendChild(this.el);
  }

  get open(): boolean { return !this.el.hidden; }
  get busy(): boolean { return this.mode === 'busy'; }

  show(preset: Partial<CaptureSettings> = {}): void {
    const run = this.host.runSeconds();
    this.s = { ...this.s, start: 0, end: Math.max(1, Math.min(300, Math.round(run * 10) / 10 || 10)), ...preset };
    if (this.s.source === 'path' && !this.host.hasPath()) this.s.source = 'director';
    this.mode = 'form';
    this.el.hidden = false;
    this.el.classList.remove('busy');
    this.renderForm();
    (this.el.querySelector('.cd-go') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (this.mode === 'busy') return;
    this.el.hidden = true;
    if (this.resultUrl) { URL.revokeObjectURL(this.resultUrl); this.resultUrl = null; }
    this.host.onClose();
  }

  private renderForm(): void {
    const s = this.s;
    const maxDim = this.host.maxDim();
    const resList = s.format === 'mp4' ? Object.keys(VIDEO_RES) : Object.keys(SMALL_RES);
    if (!resList.includes(s.res)) s.res = s.format === 'mp4' ? '1080p' : '360p';
    const fpsList = s.format === 'mp4' ? FPS_VIDEO : s.format === 'gif' ? FPS_GIF : FPS_WEBP;
    if (!fpsList.includes(s.fps)) s.fps = s.format === 'gif' ? 25 : s.format === 'webp' ? 30 : 60;
    const seg = (name: string, items: readonly (string | number)[], cur: string | number, label: (v: string | number) => string = String, disabled: (v: string | number) => boolean = () => false): string =>
      `<div class="seg" role="radiogroup" data-k="${name}">${items.map((v) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-v="${v}"${disabled(v) ? ' disabled' : ''}>${esc(label(v))}</button>`).join('')}</div>`;
    const srcLabel: Record<string, string> = { current: 'Current view', director: 'Director', ride: 'Ride', path: `Saved path${this.host.pathKeys() ? ` (${this.host.pathKeys()})` : ''}` };
    this.el.innerHTML = `
      <header class="cd-head"><b>Record clip</b><button class="icon-btn" data-a="close" aria-label="Close">${ICON.close}</button></header>
      <div class="cd-body">
        <div class="cd-row"><span>Camera</span>${seg('source', ['current', 'director', 'ride', 'path'], s.source, (v) => srcLabel[v as string]!, (v) => v === 'path' && !this.host.hasPath())}</div>
        <div class="cd-row"><span>Start / end</span><div class="cd-times">
          <input type="number" min="0" max="300" step="0.1" data-k="start" aria-label="Start (seconds)" value="${s.start}"> –
          <input type="number" min="0.1" max="300" step="0.1" data-k="end" aria-label="End (seconds)" value="${s.end}"> <small class="cd-note">s of run</small></div></div>
        <div class="cd-row"><span>Format</span>${seg('format', ['mp4', 'gif', 'webp'], s.format, (v) => ({ mp4: 'MP4 video', gif: 'GIF', webp: 'WebP (animated)' })[v as string]!)}</div>
        <div class="cd-row"><span>Resolution</span>${seg('res', resList, s.res, String, (v) => { const r = (s.format === 'mp4' ? VIDEO_RES : SMALL_RES)[v as string]!; return Math.max(r[0], r[1]) > Math.max(maxDim, 16384); })}</div>
        <div class="cd-row"><span>Frame rate</span>${seg('fps', fpsList, s.fps, (v) => `${v} fps`)}</div>
        <p class="cd-note cd-codec"></p>
        <div class="cd-row"><span>Estimated time</span><span class="cd-est"></span></div>
        <p class="cd-note cd-warn warn" hidden></p>
      </div>
      <footer class="cd-acts"><button class="ghost" data-a="close">Cancel</button><button class="primary cd-go" data-a="go">${s.format === 'mp4' ? 'Render video' : 'Render ' + s.format.toUpperCase()}</button></footer>`;
    this.el.querySelectorAll<HTMLElement>('[data-a=close]').forEach((b) => (b.onclick = () => this.close()));
    (this.el.querySelector('[data-a=go]') as HTMLElement).onclick = () => this.go();
    this.el.querySelectorAll<HTMLElement>('.seg').forEach((g) => {
      g.onclick = (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b || (b as HTMLButtonElement).disabled) return;
        const k = g.dataset.k as keyof CaptureSettings, v = b.dataset.v!;
        (this.s as unknown as Record<string, unknown>)[k] = k === 'fps' ? Number(v) : v;
        this.renderForm();
      };
    });
    this.el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      inp.onchange = () => {
        const v = Math.max(0, Math.min(300, Number(inp.value) || 0));
        if (inp.dataset.k === 'start') this.s.start = v; else this.s.end = Math.max(0.1, v);
        this.update();
      };
    });
    this.update();
  }

  private update(): void {
    const s = this.s;
    const [w, h] = resFor(s);
    const dur = Math.max(0, Math.min(300, s.end) - s.start);
    const frames = Math.ceil(dur * s.fps);
    const ms = this.host.estimateMs(w, h, s.format);
    (this.el.querySelector('.cd-est') as HTMLElement).textContent = `≈ ${fmtTime((frames * ms) / 1000)} for ${frames} frames (${w}×${h})`;
    const warn = this.el.querySelector('.cd-warn') as HTMLElement;
    const msgs: string[] = [];
    if (s.end <= s.start) msgs.push('End must be after start.');
    if (s.end > 300) msgs.push('Clips are at most 5 minutes.');
    if (s.format === 'gif' && dur > gifMaxSeconds(w, h, s.fps)) msgs.push(`GIF at ${w}×${h}, ${s.fps} fps holds up to ${gifMaxSeconds(w, h, s.fps)} s. Use MP4 or WebP for longer clips.`);
    if (s.format === 'mp4' && Math.max(w, h) > this.host.maxDim()) msgs.push(`This GPU's texture limit is ${this.host.maxDim()} px: it will be downscaled to fit.`);
    warn.hidden = !msgs.length;
    warn.textContent = msgs.join(' ');
    (this.el.querySelector('[data-a=go]') as HTMLButtonElement).disabled = s.end <= s.start || (s.format === 'gif' && dur > gifMaxSeconds(w, h, s.fps));
    const codec = this.el.querySelector('.cd-codec') as HTMLElement;
    if (s.format === 'mp4') {
      codec.textContent = 'Encoder: checking…';
      void this.host.codecFor(w, h, s.fps).then((c) => { if (this.mode === 'form') codec.textContent = c ? `Encoder: ${c}, MP4 written in-house.` : 'No video encoder for this size in this browser: try a smaller resolution or GIF / WebP.'; });
    } else codec.textContent = s.format === 'gif' ? `GIF: one 255-colour palette for the clip, ${100 / s.fps} cs per frame. Rendered at 2× and downscaled.` : 'WebP: lossy frames, only the changed area stored. Rendered at 2× and downscaled.';
  }

  private go(): void {
    this.mode = 'busy';
    this.el.classList.add('busy');
    this.el.innerHTML = `
      <header class="cd-head"><b>Recording</b><span class="cd-est cd-phase"></span></header>
      <div class="cd-prog"><div class="cd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        <div class="cd-stat"><span class="cd-frames">starting…</span><span class="cd-eta"></span></div></div>
      <footer class="cd-acts"><button class="ghost danger" data-a="cancel">Cancel (Esc)</button></footer>`;
    (this.el.querySelector('[data-a=cancel]') as HTMLElement).onclick = () => this.host.cancel();
    (this.el.querySelector('[data-a=cancel]') as HTMLElement).focus();
    this.host.start({ ...this.s, end: Math.min(this.s.end, this.s.start + 300) });
  }

  progress(p: { phase: string; frame: number; frames: number; etaS: number | null; msPerFrame: number; elapsedMs: number }): void {
    if (this.mode !== 'busy') return;
    const u = p.frames ? p.frame / p.frames : 0;
    const bar = this.el.querySelector('.cd-bar') as HTMLElement;
    (bar.firstElementChild as HTMLElement).style.width = `${(u * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(u * 100)));
    const phase: Record<string, string> = { starting: 'starting the run', preroll: 'warming up effects', render: 'rendering', encode: 'finishing the file' };
    (this.el.querySelector('.cd-phase') as HTMLElement).textContent = phase[p.phase] ?? p.phase;
    (this.el.querySelector('.cd-frames') as HTMLElement).textContent = p.frames ? `frame ${p.frame} / ${p.frames}${p.msPerFrame ? ` · ${p.msPerFrame.toFixed(0)} ms each` : ''}` : 'starting…';
    (this.el.querySelector('.cd-eta') as HTMLElement).textContent = `${fmtTime(p.elapsedMs / 1000)} elapsed${p.etaS !== null ? ` · ${fmtTime(p.etaS)} left` : ''}`;
  }

  /** The finished file (or the share card): preview, details, Save. */
  result(r: { title: string; blob: Blob; name: string; meta: string; note?: string; copy?: boolean }): void {
    this.mode = 'result';
    this.el.hidden = false;
    this.el.classList.remove('busy');
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    const url = (this.resultUrl = URL.createObjectURL(r.blob));
    const video = r.blob.type.startsWith('video/');
    this.el.innerHTML = `
      <header class="cd-head"><b></b><button class="icon-btn" data-a="close" aria-label="Close">${ICON.close}</button></header>
      <div class="cd-result">${video ? '<video controls loop playsinline aria-label="Clip preview"></video>' : '<img alt="">'}
        <div class="cd-meta"></div><p class="cd-note warn" hidden></p></div>
      <footer class="cd-acts">${r.copy ? '<button class="ghost" data-a="copy">Copy image</button>' : ''}<button class="ghost" data-a="close">Done</button><a class="primary-blue cd-save" role="button" style="display:inline-flex;align-items:center;text-decoration:none" download="">Save</a></footer>`;
    (this.el.querySelector('.cd-head b') as HTMLElement).textContent = r.title;
    const media = this.el.querySelector(video ? 'video' : 'img') as HTMLVideoElement | HTMLImageElement;
    media.src = url;
    // U5 (M5): clips have sound now (F5): the preview plays with it, at the game's master volume and mute; it autoplays
    // unless Reduced motion is on, and if the browser refuses sound without a fresh click it starts muted (controls unmute)
    if (media instanceof HTMLVideoElement) {
      const a = settings.audio;
      media.volume = Math.max(0, Math.min(1, a.master));
      media.muted = a.muted;
      if (document.documentElement.dataset.reducedMotion !== '1') media.play().catch(() => { media.muted = true; void media.play().catch(() => {}); });
    }
    (this.el.querySelector('.cd-meta') as HTMLElement).textContent = `${r.name} · ${fmtBytes(r.blob.size)} · ${r.meta}`;
    if (r.note) { const n = this.el.querySelector('.cd-note') as HTMLElement; n.hidden = false; n.textContent = r.note; }
    const save = this.el.querySelector('.cd-save') as HTMLAnchorElement;
    save.href = url;
    save.download = r.name;
    this.el.querySelectorAll<HTMLElement>('[data-a=close]').forEach((b) => (b.onclick = () => this.close()));
    const copy = this.el.querySelector('[data-a=copy]') as HTMLElement | null;
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ [r.blob.type]: r.blob })]); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
    };
    save.focus();
  }

  failed(message: string): void {
    this.mode = 'form';
    this.el.classList.remove('busy');
    this.renderForm();
    const warn = this.el.querySelector('.cd-warn') as HTMLElement;
    warn.hidden = false;
    warn.textContent = message;
  }
}
