// C4 (M4): Photo mode's left glass mini-panel (UI_UX §4.11, F10): camera orbit, focal length, aperture, exposure,
// LUT, grid overlay and Capture (resolution presets up to 8K, PNG or WebP), plus camera-path keys for the capture
// dialog's "Saved path". The HUD hides while it's open; the panel is the `photo` glass surface (glass.ts). The
// viewport behind it takes orbit input on its own layer (#photo-orbit) so building never sees those clicks.

import { ensureCaptureStyles } from './capture.ts';
import { ICON, h } from './icons.ts';

export interface PhotoState {
  yaw: number;
  pitch: number;
  dist: number;
  /** Focal length, mm (36 × 24 mm frame). */
  focal: number;
  /** f-number; 0 = no depth of field. */
  aperture: number;
  /** Exposure compensation, stops. */
  exposure: number;
  lut: boolean;
  grid: boolean;
  res: string;
  format: 'png' | 'webp';
}

export interface PhotoHost {
  state(): PhotoState;
  change(patch: Partial<PhotoState>): void;
  pan(dx: number, dy: number): void;
  capture(): void;
  addKey(): void;
  clearKeys(): void;
  keyCount(): number;
  recordClip(): void;
  close(): void;
  maxDim(): number;
}

export const PHOTO_RES: Record<string, [number, number] | null> = { Screen: null, '1080p': [1920, 1080], '1440p': [2560, 1440], '4K': [3840, 2160], '8K': [7680, 4320] };
const APERTURES = [0, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16];

export class PhotoPanel {
  readonly el: HTMLElement;
  readonly orbit: HTMLElement;
  readonly grid: HTMLElement;
  private readonly host: PhotoHost;

  constructor(parent: HTMLElement, host: PhotoHost) {
    ensureCaptureStyles();
    this.host = host;
    this.orbit = h('<div id="photo-orbit" hidden aria-hidden="true"></div>');
    this.grid = h('<div id="photo-grid" hidden aria-hidden="true"><i></i><i></i><i></i><i></i></div>');
    this.el = h('<aside id="photo" class="glass" role="dialog" aria-label="Photo mode" hidden></aside>');
    parent.append(this.orbit, this.grid, this.el);
    this.bindOrbit();
  }

  get open(): boolean { return !this.el.hidden; }

  show(): void {
    this.el.hidden = false;
    this.orbit.hidden = false;
    this.render();
    (this.el.querySelector('.ph-cap') as HTMLElement | null)?.focus();
  }

  hide(): void {
    this.el.hidden = true;
    this.orbit.hidden = true;
    this.grid.hidden = true;
  }

  /** The rule-of-thirds overlay over the drawn frame (never captured: it's DOM). */
  layoutGrid(canvas: HTMLCanvasElement): void {
    const s = this.host.state();
    this.grid.hidden = !this.open || !s.grid;
    if (this.grid.hidden) return;
    const vr = (this.grid.parentElement as HTMLElement).getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    Object.assign(this.grid.style, { left: `${cr.left - vr.left}px`, top: `${cr.top - vr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
    const [a, b, c, d] = [...this.grid.children] as HTMLElement[];
    Object.assign(a!.style, { left: '33.333%', top: '0', width: '1px', height: '100%' });
    Object.assign(b!.style, { left: '66.666%', top: '0', width: '1px', height: '100%' });
    Object.assign(c!.style, { top: '33.333%', left: '0', height: '1px', width: '100%' });
    Object.assign(d!.style, { top: '66.666%', left: '0', height: '1px', width: '100%' });
  }

  render(): void {
    const s = this.host.state();
    const deg = (r: number): string => `${Math.round((r * 180) / Math.PI)}°`;
    const maxDim = this.host.maxDim();
    this.el.innerHTML = `
      <header class="ph-head"><b>Photo mode</b><button class="icon-btn" data-a="close" aria-label="Leave photo mode (Esc)">${ICON.close}</button></header>
      <section class="ph-sec well"><span class="sec">Camera</span>
        <label class="ph-sl"><span>Orbit</span><input type="range" data-k="yaw" min="-180" max="180" step="1" value="${Math.round((s.yaw * 180) / Math.PI)}"><em>${deg(s.yaw)}</em></label>
        <label class="ph-sl"><span>Height</span><input type="range" data-k="pitch" min="-10" max="89" step="1" value="${Math.round((s.pitch * 180) / Math.PI)}"><em>${deg(s.pitch)}</em></label>
        <label class="ph-sl"><span>Distance</span><input type="range" data-k="dist" min="-1.2" max="2.6" step="0.01" value="${Math.log10(s.dist).toFixed(2)}"><em>${s.dist < 10 ? s.dist.toFixed(2) : s.dist.toFixed(0)} m</em></label>
        <label class="ph-sl"><span>Focal</span><input type="range" data-k="focal" min="14" max="200" step="1" value="${Math.round(s.focal)}"><em>${Math.round(s.focal)} mm</em></label>
      </section>
      <section class="ph-sec well"><span class="sec">Exposure and look</span>
        <label class="ph-sl"><span>Aperture</span><input type="range" data-k="aperture" min="0" max="${APERTURES.length - 1}" step="1" value="${Math.max(0, APERTURES.indexOf(s.aperture))}"><em>${s.aperture ? `f/${s.aperture}` : 'off'}</em></label>
        <label class="ph-sl"><span>Exposure</span><input type="range" data-k="exposure" min="-3" max="3" step="0.1" value="${s.exposure}"><em>${s.exposure > 0 ? '+' : ''}${s.exposure.toFixed(1)} EV</em></label>
        <div class="ph-tg"><button data-t="lut" class="${s.lut ? 'on' : ''}" aria-pressed="${s.lut}">LUT ${s.lut ? 'on' : 'off'}</button><button data-t="grid" class="${s.grid ? 'on' : ''}" aria-pressed="${s.grid}">Grid ${s.grid ? 'on' : 'off'}</button></div>
        <small>Focus is the orbit centre. Drag to orbit, right-drag to pan, wheel to dolly.</small>
      </section>
      <section class="ph-sec well"><span class="sec">Capture</span>
        <div class="seg" data-k="res">${Object.keys(PHOTO_RES).map((k) => { const r = PHOTO_RES[k]; const big = r && Math.max(...r) > maxDim; return `<button data-v="${k}" class="${k === s.res ? 'on' : ''}" title="${big ? `downscaled to fit the ${maxDim} px limit` : ''}">${k}</button>`; }).join('')}</div>
        <div class="seg" data-k="format"><button data-v="png" class="${s.format === 'png' ? 'on' : ''}">PNG</button><button data-v="webp" class="${s.format === 'webp' ? 'on' : ''}">WebP</button></div>
        <button class="primary ph-cap" data-a="capture">Capture</button>
        <div class="ph-last" aria-live="polite"></div>
      </section>
      <section class="ph-sec well"><span class="sec">Camera path</span>
        <div class="ph-row"><button class="ghost" data-a="key">Add key (K)</button><button class="ghost" data-a="clear"${this.host.keyCount() ? '' : ' disabled'}>Clear</button></div>
        <small>${this.host.keyCount()} key${this.host.keyCount() === 1 ? '' : 's'}: Record clip › Saved path flies through them.</small>
        <button class="ghost" data-a="clip">Record clip…</button>
      </section>`;
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.oninput = () => {
        const v = Number(inp.value), k = inp.dataset.k!;
        const patch: Partial<PhotoState> =
          k === 'yaw' ? { yaw: (v * Math.PI) / 180 } : k === 'pitch' ? { pitch: (v * Math.PI) / 180 } : k === 'dist' ? { dist: 10 ** v }
          : k === 'focal' ? { focal: v } : k === 'aperture' ? { aperture: APERTURES[v] ?? 0 } : { exposure: v };
        this.host.change(patch);
        this.refreshValues();
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => (b.onclick = () => { const k = b.dataset.t as 'lut' | 'grid'; this.host.change({ [k]: !this.host.state()[k] }); this.render(); }));
    this.el.querySelectorAll<HTMLElement>('.seg').forEach((g) => (g.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.host.change({ [g.dataset.k!]: b.dataset.v } as Partial<PhotoState>);
      this.render();
    }));
    const act: Record<string, () => void> = { close: () => this.host.close(), capture: () => this.host.capture(), key: () => { this.host.addKey(); this.render(); }, clear: () => { this.host.clearKeys(); this.render(); }, clip: () => this.host.recordClip() };
    this.el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => (b.onclick = () => act[b.dataset.a!]?.()));
  }

  /** Slider readouts after a drag (without rebuilding the panel under the pointer). */
  refreshValues(): void {
    const s = this.host.state();
    const set = (k: string, v: number, txt: string): void => {
      const inp = this.el.querySelector<HTMLInputElement>(`input[data-k=${k}]`);
      if (!inp) return;
      if (document.activeElement !== inp) inp.value = String(v);
      (inp.nextElementSibling as HTMLElement).textContent = txt;
    };
    set('yaw', Math.round((s.yaw * 180) / Math.PI), `${Math.round((s.yaw * 180) / Math.PI)}°`);
    set('pitch', Math.round((s.pitch * 180) / Math.PI), `${Math.round((s.pitch * 180) / Math.PI)}°`);
    set('dist', Number(Math.log10(s.dist).toFixed(2)), `${s.dist < 10 ? s.dist.toFixed(2) : s.dist.toFixed(0)} m`);
    set('focal', Math.round(s.focal), `${Math.round(s.focal)} mm`);
    set('aperture', Math.max(0, APERTURES.indexOf(s.aperture)), s.aperture ? `f/${s.aperture}` : 'off');
    set('exposure', s.exposure, `${s.exposure > 0 ? '+' : ''}${s.exposure.toFixed(1)} EV`);
  }

  setLast(text: string): void { const el = this.el.querySelector('.ph-last'); if (el) el.textContent = text; }

  private bindOrbit(): void {
    let drag: { x: number; y: number; button: number } | null = null;
    const o = this.orbit;
    o.addEventListener('contextmenu', (e) => e.preventDefault());
    o.addEventListener('pointerdown', (e) => { o.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, button: e.shiftKey ? 2 : e.button }; o.classList.add('drag'); });
    o.addEventListener('pointerup', () => { drag = null; o.classList.remove('drag'); });
    o.addEventListener('pointercancel', () => { drag = null; o.classList.remove('drag'); });
    o.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.button === 0) {
        const s = this.host.state();
        this.host.change({ yaw: s.yaw - dx * 0.006, pitch: Math.max(-0.17, Math.min(1.55, s.pitch + dy * 0.006)) });
      } else this.host.pan(dx, dy);
      this.refreshValues();
    });
    o.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = this.host.state();
      this.host.change({ dist: Math.min(400, Math.max(0.06, s.dist * Math.exp(e.deltaY * 0.001))) });
      this.refreshValues();
    }, { passive: false });
  }
}
