// Box select (stream BUILDUX, D123; GAME_SPEC §7.3 "Select / Move: … box select").
//
// In the Select tool, a left press on EMPTY space that moves past the drag threshold draws a marquee; on release every
// part whose middle is inside it is selected (a selected port-less path such as a TUBE run counts when all its points
// are inside). Plain = replace the selection, Shift = add, Ctrl = toggle. Locked and hidden parts (and parts outside
// the section box) are skipped, because they aren't pickable. A press on a part is still drag-to-move, a press on a
// gizmo handle is still the gizmo, and the camera keeps right-drag (orbit), middle-drag (pan) and the wheel; in the
// other tools left-drag on empty space still orbits (view rail). The live count shows in the tool badge, and the
// result is announced and toasted ("5 parts selected").

import type { V3 } from '../math.ts';
import { DRAG_THRESHOLD_PX, pastThreshold, type Mods } from './dragmove.ts';

export interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
export type Project = (p: V3) => readonly [number, number] | null;
export type MarqueeMode = 'replace' | 'add' | 'toggle';

/** The rectangle between two screen points (any drag direction). */
export function normRect(ax: number, ay: number, bx: number, by: number): Rect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

export const insideRect = (r: Rect, p: readonly [number, number]): boolean => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;

/** A selectable thing for the marquee: a part (one point, its bounds' middle) or a path link (all its points). */
export interface MarqueeItem { readonly id: number; readonly pts: readonly V3[] }

/** Ids whose points all project inside the rectangle (points behind the camera don't count). */
export function marqueeHits(r: Rect, items: Iterable<MarqueeItem>, project: Project): number[] {
  const out: number[] = [];
  for (const it of items) {
    if (!it.pts.length) continue;
    let ok = true;
    for (const p of it.pts) { const s = project(p); if (!s || !insideRect(r, s)) { ok = false; break; } }
    if (ok) out.push(it.id);
  }
  return out;
}

/** The selection after a marquee: replace, add (Shift) or toggle (Ctrl). */
export function marqueeSelection(current: readonly number[], hits: readonly number[], mode: MarqueeMode): number[] {
  if (mode === 'replace') return [...new Set(hits)];
  const set = new Set(current);
  if (mode === 'add') { for (const id of hits) set.add(id); return [...set]; }
  for (const id of new Set(hits)) { if (set.has(id)) set.delete(id); else set.add(id); }
  return [...set];
}

export const marqueeMode = (m: Pick<Mods, 'shift' | 'ctrl'>): MarqueeMode => (m.ctrl ? 'toggle' : m.shift ? 'add' : 'replace');

const plural = (n: number): string => `${n} part${n === 1 ? '' : 's'}`;

// ---- the controller (main.ts wires the pointer) ------------------------------------------------------------------------

export interface BoxHost {
  readonly viewport: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  project: Project;
  /** Everything a marquee may select (pickable parts and path links). */
  items(): Iterable<MarqueeItem>;
  /** Ids currently selected. */
  selected(): readonly number[];
  /** Replace the selection (empty = clear). */
  apply(ids: readonly number[]): void;
  /** Is this id a part (path links aren't counted as parts in the readout)? */
  isPart(id: number): boolean;
  announce(text: string): void;
  toast(text: string): void;
  /** Player colour for the marquee (CSS). */
  colour(): string;
}

export class BoxSelect {
  private press: { x: number; y: number; mode: MarqueeMode } | null = null;
  private rect: Rect | null = null;
  private el: HTMLDivElement | null = null;
  private count = 0;
  private lastAt = 0;

  constructor(private readonly host: BoxHost) {}

  /** A press is pending or a marquee is being drawn: left-drag camera navigation stands down. */
  get holding(): boolean { return this.press !== null; }
  get active(): boolean { return this.rect !== null; }

  /** Left button down on empty space in the Select tool (main.ts checks the tool, the gizmo and the part pick). */
  down(x: number, y: number, mods: Mods): void { this.press = { x, y, mode: marqueeMode(mods) }; this.rect = null; }

  move(x: number, y: number, buttons: number, mods: Mods): void {
    const p = this.press;
    if (!p) return;
    if (!(buttons & 1) || buttons & 2) { this.cancel(); return; } // released outside, or a right click cancels
    if (!this.rect && !pastThreshold(x - p.x, y - p.y, DRAG_THRESHOLD_PX)) return;
    p.mode = marqueeMode(mods); // Shift / Ctrl may be pressed mid-drag
    this.rect = normRect(p.x, p.y, x, y);
    this.draw();
    const now = performance.now();
    if (now - this.lastAt > 60) { this.lastAt = now; this.count = this.hits().filter((id) => this.host.isPart(id)).length; }
  }

  /** Button up: true when it was a marquee (main.ts then skips its click). */
  up(): boolean {
    const p = this.press, r = this.rect;
    this.press = null;
    this.rect = null;
    this.hide();
    if (!p || !r) return false;
    const hits = this.hits(r);
    const next = marqueeSelection(this.host.selected(), hits, p.mode);
    this.host.apply(next);
    const parts = next.filter((id) => this.host.isPart(id)).length;
    const msg = parts || next.length ? `${plural(parts)} selected` : 'Nothing selected';
    this.host.announce(msg);
    this.host.toast(msg);
    return true;
  }

  cancel(): void { this.press = null; this.rect = null; this.hide(); }

  private hits(r: Rect | null = this.rect): number[] { return r ? marqueeHits(r, this.host.items(), this.host.project) : []; }

  /** Live readout for the tool badge while dragging. */
  badge(): { text: string; blocked: boolean } | null {
    if (!this.rect || !this.press) return null;
    const verb = this.press.mode === 'add' ? 'Add' : this.press.mode === 'toggle' ? 'Toggle' : 'Select';
    return { text: `${verb} · ${plural(this.count)}`, blocked: false };
  }

  private draw(): void {
    const r = this.rect;
    if (!r) return;
    if (!this.el) {
      const el = document.createElement('div');
      el.className = 'kn-marquee';
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', zIndex: '5', borderRadius: '2px', boxSizing: 'border-box' });
      this.host.viewport.appendChild(el);
      this.el = el;
    }
    const c = this.host.colour();
    const cr = this.host.canvas.getBoundingClientRect(), vr = this.host.viewport.getBoundingClientRect();
    Object.assign(this.el.style, {
      display: 'block', left: `${cr.left - vr.left + r.x0}px`, top: `${cr.top - vr.top + r.y0}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px`,
      border: `1.5px dashed ${c}`, background: `color-mix(in srgb, ${c} 14%, transparent)`,
    });
  }

  private hide(): void { if (this.el) this.el.style.display = 'none'; }
}
