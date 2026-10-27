// Section box (GAME_SPEC §7.5, HOW_TO_PLAY §3.5): drag out an axis-aligned box on the work plane, then
// drag its six face handles. The renderer clips to it (renderer.setSectionBox, M2_PLAN contract 4);
// until stream C lands that, parts outside the box are left out of the build scene and picking instead.

import type { SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import { closestOnAxis, rayPlaneY, toScreen, type Ray } from './organise.ts';

export interface Box { min: V3; max: V3 }

const BEAM: readonly [number, number, number] = [0.03, 0.67, 1.0];
const HOT: readonly [number, number, number] = [1.0, 0.72, 0.13];
const MIN_SIZE = 0.05;
const SNAP = 0.05;

type Drag =
  | { kind: 'new'; a: V3; b: V3 }
  | { kind: 'face'; axis: 0 | 1 | 2; side: 0 | 1; origin: V3; start: number; startValue: number };

export class SectionBox {
  box: Box | null = null;
  /** Editing: handles shown and pointer input captured. */
  editing = false;
  private drag: Drag | null = null;
  private hot = -1;
  /** Called whenever the box changes (renderer + scene refresh). */
  onChange: (box: Box | null) => void = () => {};

  /** Handle positions: index = axis * 2 + side. */
  handles(): V3[] {
    const b = this.box;
    if (!b) return [];
    const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const out: V3[] = [];
    for (const axis of [0, 1, 2] as const) for (const side of [0, 1] as const) {
      const p: V3 = [c[0], c[1], c[2]];
      p[axis] = side ? b.max[axis] : b.min[axis];
      out.push(p);
    }
    return out;
  }

  /** Does a point lie inside the box (or is there no box)? */
  contains(p: readonly number[]): boolean {
    const b = this.box;
    if (!b) return true;
    return p[0]! >= b.min[0] && p[0]! <= b.max[0] && p[1]! >= b.min[1] && p[1]! <= b.max[1] && p[2]! >= b.min[2] && p[2]! <= b.max[2];
  }

  start(): void { this.editing = true; }
  finish(): void { this.editing = false; this.drag = null; this.hot = -1; }
  clear(): void { this.box = null; this.finish(); this.onChange(null); }

  /** Pointer down while editing. Returns true when the event was consumed. */
  down(ray: Ray, px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement, workY: number): boolean {
    const h = this.pickHandle(px, py, viewProj, canvas);
    if (h >= 0) {
      const axis = Math.floor(h / 2) as 0 | 1 | 2, side = (h % 2) as 0 | 1;
      const origin = this.handles()[h]!;
      const dir: V3 = [0, 0, 0];
      dir[axis] = 1;
      this.drag = { kind: 'face', axis, side, origin, start: closestOnAxis(ray, origin, dir), startValue: origin[axis] };
      return true;
    }
    const p = rayPlaneY(ray, workY);
    if (!p) return false;
    this.drag = { kind: 'new', a: snap3(p), b: snap3(p) };
    return true;
  }

  move(ray: Ray, px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement, workY: number, defaultHeight: number): boolean {
    const d = this.drag;
    if (!d) { this.hot = this.editing ? this.pickHandle(px, py, viewProj, canvas) : -1; return false; }
    if (d.kind === 'new') {
      const p = rayPlaneY(ray, workY);
      if (p) d.b = snap3(p);
      const min: V3 = [Math.min(d.a[0], d.b[0]), workY, Math.min(d.a[2], d.b[2])];
      const max: V3 = [Math.max(d.a[0], d.b[0]), workY + defaultHeight, Math.max(d.a[2], d.b[2])];
      if (max[0] - min[0] >= MIN_SIZE && max[2] - min[2] >= MIN_SIZE) { this.box = { min, max }; this.onChange(this.box); }
      return true;
    }
    const dir: V3 = [0, 0, 0];
    dir[d.axis] = 1;
    const s = closestOnAxis(ray, d.origin, dir);
    const b = this.box!;
    let v = snap(d.startValue + (s - d.start));
    if (d.side) v = Math.max(v, b.min[d.axis] + MIN_SIZE); else v = Math.min(v, b.max[d.axis] - MIN_SIZE);
    if (d.side) b.max[d.axis] = v; else b.min[d.axis] = v;
    this.onChange(b);
    return true;
  }

  up(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    return true;
  }

  get dragging(): boolean { return this.drag !== null; }

  private pickHandle(px: number, py: number, viewProj: Float32Array, canvas: HTMLCanvasElement): number {
    let best = 16 * 16, found = -1;
    this.handles().forEach((h, i) => {
      const s = toScreen(viewProj, canvas, h);
      if (!s) return;
      const d2 = (s[0] - px) ** 2 + (s[1] - py) ** 2;
      if (d2 < best) { best = d2; found = i; }
    });
    return found;
  }

  /** Wireframe edges (always, while a box exists) and handles (while editing). */
  overlay(out: SceneItem[], camDist: number): void {
    const b = this.box;
    if (!b) return;
    const t = Math.max(0.002, camDist * 0.0018);
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const em = this.editing ? 0.9 : 0.5;
    for (const y of [y0, y1]) for (const z of [z0, z1]) out.push({ pos: [cx, y, z], size: [x1 - x0, t, t], mesh: 0, color: BEAM, emissive: em });
    for (const x of [x0, x1]) for (const z of [z0, z1]) out.push({ pos: [x, cy, z], size: [t, y1 - y0, t], mesh: 0, color: BEAM, emissive: em });
    for (const x of [x0, x1]) for (const y of [y0, y1]) out.push({ pos: [x, y, cz], size: [t, t, z1 - z0], mesh: 0, color: BEAM, emissive: em });
    if (this.editing) {
      out.push({ pos: [cx, cy, cz], size: [x1 - x0, y1 - y0, z1 - z0], mesh: 0, color: BEAM, alpha: 0.05 });
      const r = Math.max(0.025, camDist * 0.012);
      this.handles().forEach((h, i) => out.push({ pos: h, size: [r, r, r], mesh: 1, color: i === this.hot ? HOT : BEAM, emissive: 1 }));
    }
  }
}

const snap = (v: number): number => Math.round(v / SNAP) * SNAP;
const snap3 = (p: V3): V3 => [snap(p[0]), p[1], snap(p[2])];
