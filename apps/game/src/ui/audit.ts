// In-page WCAG 2.2 AA audit helpers (M4 stream U4, debug only: `?debug` exposes them as window.__knAudit).
// They measure the live DOM; the driver (a CDP script, method in docs/dev/M4_NOTES_U4.md) composites the
// layers over white and over the brightest pixel of the live 3D view behind each text, as in
// M3_D79_REVIEW §2.
//
//   texts()   every visible text run: its colour (with the opacity of its ancestors), the stack of
//             backgrounds under it up to the first glass surface (or the page), font size and weight;
//   targets() every visible pointer target with its box, and whether it meets 24 × 24 CSS px or the
//             WCAG 2.5.8 spacing exception;
//   reflow()  every HUD surface's box against the viewport and the other surfaces (UI scale checks).

import { contrast, parseColor, stack, type Rgb, type Rgba } from './contrast.ts';

export interface TextSample {
  readonly text: string;
  readonly where: string;
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly color: Rgba;
  /** Backgrounds bottom-up (nearest the backdrop first); gradients contribute their worst stop at run time. */
  readonly layers: readonly (readonly Rgba[])[];
  /** The stack reaches a glass surface (blurred backdrop) or the page itself (opaque backdrop). */
  readonly overGlass: boolean;
  readonly opaque: boolean;
  readonly size: number;
  readonly weight: number;
  readonly large: boolean;
}

const rgbaOf = (s: string): Rgba | null => { try { const c = parseColor(s); return c[3] > 0 ? c : null; } catch { return null; } };
const stopsOf = (img: string): Rgba[] => [...img.matchAll(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi)].map((m) => rgbaOf(m[0])).filter((c): c is Rgba => !!c);

function label(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  for (let i = 0; e && i < 4; i++, e = e.parentElement) parts.unshift(e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}${e.classList[0] ? `.${e.classList[0]}` : ''}`);
  return parts.join(' > ');
}

function visible(el: Element): boolean {
  const e = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (e.checkVisibility && !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)) return false;
  // U5 (M5): scrolled out of a clipping ancestor (the Inspector's body, the Library grid) isn't visible either
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const q = a.getBoundingClientRect();
    if (Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) < 2 || Math.min(r.right, q.right) - Math.max(r.left, q.left) < 2) return false;
  }
  return true;
}

/** Every visible text run under `root` with what it sits on. */
export function texts(root: ParentNode = document.body): TextSample[] {
  const out: TextSample[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent?.trim()) continue;
    // inactive controls are exempt (WCAG 1.4.3); the perf readout is a debug overlay
    if (el.closest('.sr-only, [aria-hidden="true"]:not(#captions):not(#emotetags):not(#portglyphs), script, style, svg, #perf, canvas, :disabled, [aria-disabled="true"]')) continue;
    seen.add(el);
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    let col = rgbaOf(cs.color) ?? [255, 255, 255, 1];
    let alpha = col[3];
    const layers: Rgba[][] = [];
    let overGlass = false, opaque = false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      alpha *= Number(s.opacity);
      const bg = rgbaOf(s.backgroundColor);
      const stops = s.backgroundImage !== 'none' ? stopsOf(s.backgroundImage) : [];
      if (stops.length) layers.unshift(stops);
      else if (bg) layers.unshift([bg]);
      if (bg && bg[3] >= 0.999 && !stops.length) { opaque = true; break; }
      if (s.backdropFilter && s.backdropFilter !== 'none') { overGlass = true; break; }
      if (a.id === 'lobby') { opaque = true; break; } // the lobby backdrop is an opaque photo: measured as the photo pixels
    }
    col = [col[0], col[1], col[2], Math.max(0, Math.min(1, alpha))];
    const r = el.getBoundingClientRect();
    let zoom = 1;
    for (let a: Element | null = el; a; a = a.parentElement) zoom *= Number(getComputedStyle(a).zoom) || 1;
    const size = parseFloat(cs.fontSize) * zoom;
    const weight = Number(cs.fontWeight) || 400;
    out.push({
      text: n.textContent.trim().slice(0, 40), where: label(el), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, color: col, layers, overGlass, opaque,
      size, weight, large: size >= 24 || (size >= 18.66 && weight >= 700),
    });
  }
  return out;
}

/** Worst-case contrast of a sample over an opaque backdrop colour (gradients: every stop is tried). */
export function worstContrast(s: Pick<TextSample, 'color' | 'layers'>, backdrop: Rgb): number {
  let combos: Rgba[][] = [[]];
  for (const l of s.layers) combos = combos.flatMap((c) => l.map((stop) => [...c, stop]));
  let worst = Infinity;
  for (const c of combos.slice(0, 64)) {
    const bg = stack(backdrop, c);
    worst = Math.min(worst, contrast(s.color, bg));
  }
  return worst;
}

export interface TargetSample { readonly where: string; readonly name: string; readonly w: number; readonly h: number; readonly ok: boolean; readonly why: string }

/** Pointer targets: 24 × 24 CSS px, or the 2.5.8 spacing exception (a 24 px circle that touches nothing). */
export function targets(root: ParentNode = document.body): TargetSample[] {
  const els = [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=slider], [role=switch], [role=tab], [role=option], [role=treeitem], [tabindex]:not([tabindex="-1"]), label.set-row')]
    .filter((e) => visible(e) && !e.closest('[aria-hidden="true"]') && !(e as HTMLButtonElement).disabled && !(e instanceof HTMLCanvasElement));
  // a control inside a label (settings checkbox) is part of the label's target
  const boxes = els.map((e) => ({ e, r: (e.closest('label.set-row') && e !== e.closest('label.set-row') ? e.closest('label.set-row')! : e).getBoundingClientRect() }));
  const out: TargetSample[] = [];
  for (const { e, r } of boxes) {
    const w = r.width, h = r.height;
    const name = (e.getAttribute('aria-label') ?? e.textContent ?? e.getAttribute('title') ?? '').trim().slice(0, 30);
    if (w >= 24 && h >= 24) { out.push({ where: label(e), name, w, h, ok: true, why: 'size' }); continue; }
    const cx = r.x + w / 2, cy = r.y + h / 2;
    const hit = boxes.find((o) => {
      if (o.e === e || o.e.contains(e) || e.contains(o.e)) return false;
      const nx = Math.max(o.r.left, Math.min(cx, o.r.right)), ny = Math.max(o.r.top, Math.min(cy, o.r.bottom));
      if (Math.hypot(nx - cx, ny - cy) < 12) return true;
      if (o.r.width < 24 || o.r.height < 24) { const ox = o.r.x + o.r.width / 2, oy = o.r.y + o.r.height / 2; if (Math.hypot(ox - cx, oy - cy) < 24) return true; }
      return false;
    });
    out.push({ where: label(e), name, w, h, ok: !hit, why: hit ? `undersized, near ${label(hit.e)}` : 'spacing' });
  }
  return out;
}

/** HUD surfaces: off-screen, clipped, or overlapping each other (UI scale reflow check). */
export function reflow(): { id: string; out: boolean; overlaps: string[]; scrollW: boolean }[] {
  const ids = ['#worldcard', '#sessionbar', '#viewrail', '#inspector', '#transport', '#tray', '#library', '#cascade', '#palette', '#settings', '#runpill', '#kocounter', '#eventfeed', '#runbar', '#captions'];
  const shown = ids.map((id) => document.querySelector<HTMLElement>(id)).filter((e): e is HTMLElement => !!e && visible(e));
  return shown.map((e) => {
    const r = e.getBoundingClientRect();
    const out = r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    // modal dialogs sit over everything on purpose (under a scrim); they only have to fit on screen
    const modal = (x: HTMLElement): boolean => x.id === 'settings' || x.id === 'palette';
    const overlaps = shown.filter((o) => o !== e && !o.contains(e) && !e.contains(o) && !modal(o) && !modal(e)).filter((o) => {
      const q = o.getBoundingClientRect();
      return Math.min(r.right, q.right) - Math.max(r.left, q.left) > 2 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 2;
    }).map((o) => `#${o.id}`);
    return { id: `#${e.id}`, out, overlaps, scrollW: e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' };
  });
}

/** Interactive elements with no accessible name (approximation of the accname algorithm: aria-label(ledby), text, title, alt, <label>). */
export function unnamed(root: ParentNode = document.body): string[] {
  const els = [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=slider], [role=switch], [role=tab], [role=option], [role=radio], [role=menuitem], [role=treeitem], [role=dialog], [role=listbox], [role=tree], [role=radiogroup], [role=tablist], [role=toolbar]')]
    .filter((e) => visible(e) && !e.closest('[aria-hidden="true"]'));
  const named = (e: HTMLElement): boolean => {
    if (e.getAttribute('aria-label')?.trim()) return true;
    const lb = e.getAttribute('aria-labelledby');
    if (lb && lb.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
    if ((e as HTMLInputElement).labels?.length) return true;
    if (e.closest('label')) return true;
    if (e.title?.trim()) return true;
    const t = (e.innerText ?? e.textContent ?? '').trim();
    if (t) return true;
    if (e.querySelector('img[alt]:not([alt=""]), svg[aria-label], [role=img][aria-label]')) return true;
    return false;
  };
  return els.filter((e) => !named(e)).map((e) => `${label(e)} [${e.getAttribute('role') ?? e.tagName.toLowerCase()}]`);
}
