// Sizing handles for volume parts (M5 stream U5; GAME_SPEC §12 FORCE WALL "1–10 × 1–10 × 0.5", STASIS FIELD
// "1–10³", and M3's ZONE): while one such part is selected in Build, a face handle sits on each side whose
// size is a property (`width` / `height` / `depth`, metres, as ZONE's def). Drag a handle along its axis: the
// opposite face stays put (the part moves by half the change when that axis is centred on its origin), sizes
// snap to the property's step (Alt: no snap) and clamp to its range, and the change goes out as ONE PartUpdate
// (props + pos) on release, so it's a single undo step and syncs like any edit. Keyboard: Shift+= / Shift+− grow or shrink every sized axis by one step (buildtools.ts),
// and the Inspector's number fields set each size exactly.
//
// The box and its handles are drawn in the part's own frame (rotated with it): edges always, while selected;
// handles Beam, the hovered one Amber.

import { metresToPos, posToMetres, type PartRecord } from '@knockon/format';
import { propSteps, propValues, type PartDef, type PropSpec } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qrot, type Q4 } from '../catalog.ts';
import type { SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import { announce } from './a11y.ts';
import { closestOnAxis, toScreen, type Ray } from './organise.ts';

/** Size properties per local axis (x, y, z). */
export const SIZE_KEYS = ['width', 'height', 'depth'] as const;
const AXIS_NAME = ['width', 'height', 'depth'] as const;

/** Local axes of a part type that have a size property (empty: not a volume part). */
export function sizeAxes(def: PartDef | undefined): (0 | 1 | 2)[] {
  if (!def || !def.boundsFor) return [];
  const out: (0 | 1 | 2)[] = [];
  SIZE_KEYS.forEach((k, i) => { const s = def.props[k]; if (s && s.type !== 'enum' && s.type !== 'bool') out.push(i as 0 | 1 | 2); });
  return out;
}

/** Snap a size to its property's step and range. */
export function snapSize(spec: PropSpec, v: number, free = false): number {
  const min = spec.min ?? 0, max = spec.max ?? 100, step = spec.step ?? 0.1;
  const q = free ? v : Math.round((v - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, q)).toFixed(6));
}

/**
 * New props and the local shift for a size change on one axis, keeping the face opposite `side` fixed:
 * `side` 1 = the max face moves, 0 = the min face moves. Pure (unit-tested).
 */
export function resizeAxis(def: PartDef, props: Readonly<Record<string, number>>, axis: 0 | 1 | 2, side: 0 | 1, size: number): { props: Record<string, number>; shift: V3 } {
  const key = SIZE_KEYS[axis];
  const next = { ...props, [key]: size };
  const b0 = def.boundsFor!(props), b1 = def.boundsFor!(next);
  const shift: V3 = [0, 0, 0];
  // keep the opposite face where it was: side 1 pins min, side 0 pins max
  shift[axis] = side ? b0.min[axis]! - b1.min[axis]! : b0.max[axis]! - b1.max[axis]!;
  return { props: next, shift };
}

export interface VolumeHost {
  doc(): { parts: ReadonlyMap<number, PartRecord> } | null;
  /** The single selected part id (the Inspector target), or null. */
  selected(): number | null;
  submit(op: { k: 'PartUpdate'; id: number; patch: { props?: [number, number][]; pos?: [number, number, number] } }): boolean;
  phase(): string;
  canEdit(p: PartRecord): boolean;
  /** DRAG (D117): false while the transform gizmo is on: its corner cubes resize instead (the edges still show). */
  handles?(): boolean;
}

const BEAM: readonly [number, number, number] = [0.03, 0.67, 1.0];
const HOT: readonly [number, number, number] = [1.0, 0.69, 0.13];
const HANDLE_PX = 16;

interface Drag { id: number; axis: 0 | 1 | 2; side: 0 | 1; origin: V3; dir: V3; start: number; startSize: number; size: number }

export class VolumeTool {
  private drag: Drag | null = null;
  private hot = -1;

  constructor(private readonly host: VolumeHost) {}

  get dragging(): boolean { return this.drag !== null; }

  /** The selected volume part, if it can be resized now. */
  private target(): { p: PartRecord; def: PartDef; axes: (0 | 1 | 2)[] } | null {
    if (this.host.phase() !== 'build') return null;
    const id = this.host.selected();
    const p = id !== null ? this.host.doc()?.parts.get(id) : undefined;
    const def = p ? partDef(p.type) : undefined;
    const axes = sizeAxes(def);
    if (!p || !def || !axes.length || !this.host.canEdit(p)) return null;
    return { p, def, axes };
  }

  /** Handles: world position, axis, side and the world direction of its axis. */
  private handles(t: { p: PartRecord; def: PartDef; axes: (0 | 1 | 2)[] }, props = propValues(t.def, t.p.props)): { at: V3; axis: 0 | 1 | 2; side: 0 | 1; dir: V3 }[] {
    const q = rotationToQuat(t.p.rot) as Q4;
    const pos: V3 = [posToMetres(t.p.pos[0]), posToMetres(t.p.pos[1]), posToMetres(t.p.pos[2])];
    const b = t.def.boundsFor!(props);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const out: { at: V3; axis: 0 | 1 | 2; side: 0 | 1; dir: V3 }[] = [];
    for (const axis of t.axes) for (const side of [0, 1] as const) {
      const l = [...c];
      l[axis] = side ? b.max[axis]! : b.min[axis]!;
      const w = qrot(q, l);
      const a: [number, number, number] = [0, 0, 0];
      a[axis] = 1;
      out.push({ at: [pos[0] + w[0], pos[1] + w[1], pos[2] + w[2]], axis, side, dir: qrot(q, a) as V3 });
    }
    return out;
  }

  private pick(px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement): number {
    const t = this.target();
    if (!t || this.host.handles?.() === false) return -1;
    let best = HANDLE_PX * HANDLE_PX, found = -1;
    this.handles(t).forEach((h, i) => {
      const s = toScreen(viewProj, canvas, h.at);
      if (!s) return;
      const d2 = (s[0] - px) ** 2 + (s[1] - py) ** 2;
      if (d2 < best) { best = d2; found = i; }
    });
    return found;
  }

  /** Pointer down on the canvas: starts a handle drag. True when consumed. */
  down(ray: Ray, px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement): boolean {
    const i = this.pick(px, py, viewProj, canvas);
    const t = this.target();
    if (i < 0 || !t) return false;
    const h = this.handles(t)[i]!;
    const props = propValues(t.def, t.p.props);
    const size = props[SIZE_KEYS[h.axis]]!;
    this.drag = { id: t.p.id, axis: h.axis, side: h.side, origin: h.at, dir: h.dir, start: closestOnAxis(ray, h.at, h.dir), startSize: size, size };
    return true;
  }

  /** Pointer move: drag (true) or hover highlight (false). */
  move(ray: Ray, px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement, free = false): boolean {
    const d = this.drag;
    if (!d) { this.hot = this.pick(px, py, viewProj, canvas); return false; }
    const t = this.target();
    if (!t || t.p.id !== d.id) { this.drag = null; return false; }
    const spec = t.def.props[SIZE_KEYS[d.axis]]!;
    const delta = closestOnAxis(ray, d.origin, d.dir) - d.start;
    d.size = snapSize(spec, d.startSize + (d.side ? delta : -delta), free);
    return true;
  }

  /** Pointer up: one PartUpdate with the new size (and the shift that keeps the opposite face put). */
  up(): boolean {
    const d = this.drag;
    this.drag = null;
    if (!d) return false;
    if (Math.abs(d.size - d.startSize) < 1e-6) return true;
    this.apply(d.id, [[d.axis, d.side, d.size]]);
    return true;
  }

  cancel(): boolean { if (!this.drag) return false; this.drag = null; announce('Size unchanged'); return true; }

  /** Keyboard: grow (+1) or shrink (−1) every sized axis by one step, keeping the part's base and centre. */
  nudge(dir: 1 | -1): boolean {
    const t = this.target();
    if (!t) return false;
    const props = propValues(t.def, t.p.props);
    const changes: [0 | 1 | 2, 0 | 1, number][] = [];
    for (const axis of t.axes) {
      const spec = t.def.props[SIZE_KEYS[axis]]!;
      const v = snapSize(spec, props[SIZE_KEYS[axis]]! + dir * (spec.step ?? 0.1));
      if (v !== props[SIZE_KEYS[axis]]) changes.push([axis, 1, v]);
    }
    if (!changes.length) { announce(dir > 0 ? 'Already at its largest' : 'Already at its smallest'); return true; }
    this.apply(t.p.id, changes, true);
    return true;
  }

  private apply(id: number, changes: readonly (readonly [0 | 1 | 2, 0 | 1, number])[], keepCentre = false): void {
    const p = this.host.doc()?.parts.get(id);
    const def = p ? partDef(p.type) : undefined;
    if (!p || !def) return;
    let props: Record<string, number> = { ...propValues(def, p.props) };
    const shift: V3 = [0, 0, 0];
    for (const [axis, side, size] of changes) {
      const r = resizeAxis(def, props, axis, side, size);
      props = r.props;
      // keyboard: grow about the origin (the base stays on the floor; the bounds' own anchoring decides)
      if (!keepCentre) shift[axis] += r.shift[axis];
    }
    const w = qrot(rotationToQuat(p.rot) as Q4, shift);
    const list = Object.keys(def.props).map((k) => propSteps(def, k, props[k]!) as [number, number]);
    const pos: [number, number, number] = [p.pos[0] + metresToPos(w[0]), Math.max(0, p.pos[1] + metresToPos(w[1])), p.pos[2] + metresToPos(w[2])];
    const moved = pos.some((v, i) => v !== p.pos[i]);
    if (this.host.submit({ k: 'PartUpdate', id, patch: { props: list, ...(moved ? { pos } : {}) } })) {
      const dims = sizeAxes(def).map((a) => `${AXIS_NAME[a]} ${props[SIZE_KEYS[a]]!.toFixed(1)} m`).join(', ');
      announce(`${def.name}: ${dims}`);
    }
  }

  /** Box edges (selected volume part) and handles; the dragged size previews before release. */
  overlay(out: SceneItem[], camDist: number): void {
    const t = this.target();
    if (!t) return;
    const props = { ...propValues(t.def, t.p.props) };
    const d = this.drag && this.drag.id === t.p.id ? this.drag : null;
    let shift: V3 = [0, 0, 0];
    if (d) { const r = resizeAxis(t.def, props, d.axis, d.side, d.size); Object.assign(props, r.props); shift = r.shift; }
    const q = rotationToQuat(t.p.rot) as Q4;
    const base: V3 = [posToMetres(t.p.pos[0]), posToMetres(t.p.pos[1]), posToMetres(t.p.pos[2])];
    const ws = qrot(q, shift);
    const pos: V3 = [base[0] + ws[0], base[1] + ws[1], base[2] + ws[2]];
    const b = t.def.boundsFor!(props);
    const lw = Math.max(0.003, camDist * 0.0016);
    const edge = (a: number[], c: number[]): void => {
      const mid = [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2, (a[2]! + c[2]!) / 2];
      const len = [Math.abs(c[0]! - a[0]!), Math.abs(c[1]! - a[1]!), Math.abs(c[2]! - a[2]!)];
      const w = qrot(q, mid);
      out.push({ pos: [pos[0] + w[0], pos[1] + w[1], pos[2] + w[2]], rot: q, size: [Math.max(lw, len[0]!), Math.max(lw, len[1]!), Math.max(lw, len[2]!)], mesh: 0, color: d ? HOT : BEAM, emissive: 0.7, alpha: 0.9 });
    };
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    for (const y of [y0, y1]) for (const z of [z0, z1]) edge([x0, y, z], [x1, y, z]);
    for (const x of [x0, x1]) for (const z of [z0, z1]) edge([x, y0, z], [x, y1, z]);
    for (const x of [x0, x1]) for (const y of [y0, y1]) edge([x, y, z0], [x, y, z1]);
    if (this.host.handles?.() === false && !d) return;
    const r = Math.max(0.02, camDist * 0.011);
    const hs = this.handles({ ...t, p: { ...t.p, pos: [t.p.pos[0] + metresToPos(ws[0]), t.p.pos[1] + metresToPos(ws[1]), t.p.pos[2] + metresToPos(ws[2])] } }, props);
    hs.forEach((h, i) => {
      const on = d ? d.axis === h.axis && d.side === h.side : i === this.hot;
      out.push({ pos: h.at, size: [r, r, r], mesh: 1, color: on ? HOT : BEAM, emissive: 1 });
    });
  }

  /** Readout for the drag (the tool badge / announcer). */
  label(): string | null {
    const d = this.drag;
    return d ? `${AXIS_NAME[d.axis]} ${d.size.toFixed(2)} m` : null;
  }
}
