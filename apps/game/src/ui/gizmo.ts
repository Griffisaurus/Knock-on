// The transform gizmo (stream DRAG phase 2, D117; UI_UX §5.2, GAME_SPEC §7.2 rule 4).
//
// In the Select tool the selection gets a compact gizmo at its bounds' centre: three axis ARROWS (move along X / Y / Z),
// three PLANE squares (move in XY / XZ / YZ), three ROTATE rings (pitch / yaw / roll) and, on a single resizable part
// (ZONE, FORCE WALL, STASIS FIELD), eight CORNER cubes that resize it. Handles keep a constant screen size whatever the
// zoom, grow 1.2× and brighten under the pointer (the cursor changes per handle), are drawn on top of everything by the
// renderer (SceneItem.top), and carry X / Y / Z letter chips so colour is never the only cue (the axis colours have a
// palette per colour preset, checked under each deficiency in test/drag-gizmo.test.ts). A toggles it (G is the ping key).
//
// Moves snap to the grid with the function placement uses (`snap`: 10 cm, Ctrl = 2.5 cm, Alt = free), rings snap to 15°
// (Shift = 5°, Alt = free) and edit the same Euler angles R / T / Y do (a multi-selection turns about its centre), and
// corners reuse the sizing handles' maths and limits (ui/volumetool.ts `resizeAxis`, `snapSize`). A gesture previews as
// placement ghosts with links following (the MoveSession drag-to-move uses), shows a live readout in the tool badge, is
// refused with the reason when blocked, and lands as ONE op (one undo step, synced like any edit).
//
// BUILDUX (D123): X (palette "Gizmo: local axes") switches the arrows and squares between world axes (the default) and
// the primary part's own axes (`GizmoGeom.moveAxes`); in local mode the travel along a turned axis is what snaps.

import { metresToPos, type PartRecord, type PropList } from '@knockon/format';
import { propSteps, propValues, type PartDef } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { hexLin, partDef, qinv, qmul, qrot, type Q4 } from '../catalog.ts';
import type { Rgb, SceneItem } from '../gfx/renderer.ts';
import type { Geometry } from '../gfx/meshes.ts';
import { sweptTube } from '../gfx/meshes.ts';
import type { V3 } from '../math.ts';
import { partPose, type Pose } from '../scene.ts';
import { commitMove, eulerOf, GRID_STEP, pastThreshold, moveRefusal, MoveSession, NO_MODS, partBox, partName, quatToEuler, axisQuat, snap, snapStep, turned, unionBox, floorClampY, type Mods, type MoveHost } from './dragmove.ts';
import { closestOnAxis, rayAt, toScreen, type Ray } from './organise.ts';
import type { ColourPreset } from './settings.ts';
import { settings } from './settings.ts';
import { resizeAxis, sizeAxes, snapSize, SIZE_KEYS } from './volumetool.ts';

// ---- pure pieces (unit-tested) ------------------------------------------------------------------------------------

export type Handle =
  | { readonly kind: 'axis' | 'plane' | 'ring'; readonly axis: 0 | 1 | 2 }
  | { readonly kind: 'corner'; readonly corner: number };

/** Handle sizes in screen pixels (constant whatever the zoom). */
export const GZ = {
  shaft0: 18, shaft1: 80, tip: 102, shaftR: 3, tipR: 9,
  plane0: 28, plane1: 52, ring: 124, ringTube: 0.026, ringTubeHot: 0.034,
  corner: 8, hit: 11, ringHit: 10, cornerHit: 15, hover: 1.2,
} as const;

export type Pt = readonly [number, number];
export type Project = (p: readonly number[]) => Pt | null;

export const AXES: readonly [V3, V3, V3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const AXIS_LETTER = ['X', 'Y', 'Z'] as const;
export const RING_NAME = ['Pitch', 'Yaw', 'Roll'] as const;

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const addS = (a: readonly number[], b: readonly number[], s: number): V3 => [a[0]! + b[0]! * s, a[1]! + b[1]! * s, a[2]! + b[2]! * s];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const norm = (a: readonly number[]): V3 => { const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };

/** The camera's right vector for a camera at `eye` looking at `c` (world up +Y). */
export function cameraRight(eye: V3, c: V3): V3 {
  const r = cross(sub(c, eye), [0, 1, 0]);
  return Math.hypot(...r) < 1e-9 ? [1, 0, 0] : norm(r);
}

/** Metres per screen pixel at `c`: the constant-screen-size scale (0 if `c` is behind the camera). */
export function metresPerPixel(project: Project, c: V3, right: V3): number {
  const a = project(c), b = project(addS(c, right, 1));
  if (!a || !b) return 0;
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return px > 1e-9 ? 1 / px : 0;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const polyArea = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  return Math.abs(s / 2);
};

export interface GizmoGeom {
  readonly c: V3;
  /** Metres per pixel at the centre. */
  readonly mpp: number;
  /** World directions the X / Y / Z rings turn about (gimbal axes for one part, world axes for several). */
  readonly ringAxes: readonly [V3, V3, V3];
  /** Quadrant of the plane squares, toward the eye (±1 per axis). */
  readonly planeSign: readonly [number, number, number];
  /** Resize cubes (world), single resizable part only. */
  readonly corners: readonly V3[] | null;
  /** Unit view direction (eye → centre): a ring seen edge-on is neither drawn solid nor hit. */
  readonly view: V3;
  /**
   * BUILDUX (D123): the directions the arrows and plane squares move along. Absent = the world axes; "Gizmo: local
   * axes" (X) sets them to the part's own axes (`axesQ` is that rotation, for drawing the squares).
   */
  readonly moveAxes?: readonly [V3, V3, V3];
  readonly axesQ?: Q4;
}

/** The arrows' and squares' axes: world, or the part's own (local mode). */
export const moveAxesOf = (g: GizmoGeom): readonly [V3, V3, V3] => g.moveAxes ?? AXES;

/** BUILDUX (D123): the local frame's axes for a rotation (columns of its matrix). */
export function localAxes(q: Q4): [V3, V3, V3] {
  return [qrot(q, [1, 0, 0]) as V3, qrot(q, [0, 1, 0]) as V3, qrot(q, [0, 0, 1]) as V3];
}

/**
 * BUILDUX (D123): a move along a (possibly turned) axis. The travel itself is snapped (10 cm, Ctrl 2.5 cm, Alt free),
 * not the world coordinate, so a turned part moves in whole steps along its own axis.
 */
export function localAxisMove(dd: number, axis: V3, step: number): V3 {
  const s = snap(dd, step);
  return [axis[0] * s, axis[1] * s, axis[2] * s];
}

/** BUILDUX (D123): a move in a (possibly turned) plane spanned by `u` and `v`, each component snapped. */
export function localPlaneMove(d: V3, u: V3, v: V3, step: number): V3 {
  const a = snap(dot(d, u), step), b = snap(dot(d, v), step);
  return [u[0] * a + v[0] * b, u[1] * a + v[1] * b, u[2] * a + v[2] * b];
}

/** A ring nearly edge-on to the camera is a line through the centre: it would swallow presses on the part itself. */
export const RING_EDGE_ON = 0.22;
export const ringFacing = (g: GizmoGeom, axis: 0 | 1 | 2): number => Math.abs(dot(g.ringAxes[axis], g.view));

/** An arrow's span (world): shaft start to tip. */
export function arrowSpan(g: GizmoGeom, axis: 0 | 1 | 2): [V3, V3] {
  const a = moveAxesOf(g)[axis];
  return [addS(g.c, a, GZ.shaft0 * g.mpp), addS(g.c, a, GZ.tip * g.mpp)];
}

/** A plane square's corners (world): in the two axes other than `axis`, toward the eye. */
export function planeQuad(g: GizmoGeom, axis: 0 | 1 | 2): V3[] {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const su = g.planeSign[u]!, sv = g.planeSign[v]!;
  const ax = moveAxesOf(g);
  const at = (a: number, b: number): V3 => addS(addS(g.c, ax[u]!, su * a * g.mpp), ax[v]!, sv * b * g.mpp);
  return [at(GZ.plane0, GZ.plane0), at(GZ.plane1, GZ.plane0), at(GZ.plane1, GZ.plane1), at(GZ.plane0, GZ.plane1)];
}

/** Two unit vectors spanning the plane perpendicular to `a`. */
export function perpBasis(a: V3): [V3, V3] {
  const ref: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, a));
  return [u, cross(a, u)];
}

export function ringPoints(g: GizmoGeom, axis: 0 | 1 | 2, n = 64): V3[] {
  const a = g.ringAxes[axis];
  const [u, w] = perpBasis(a);
  const r = GZ.ring * g.mpp;
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(addS(addS(g.c, u, Math.cos(t) * r), w, Math.sin(t) * r));
  }
  return out;
}

/** The handle under a screen point, or null. Corners win over arrows, arrows over planes, planes over rings. */
export function hitGizmo(g: GizmoGeom, project: Project, m: Pt): Handle | null {
  let best: Handle | null = null, score = Infinity;
  const take = (h: Handle, d: number, tol: number, bias: number): void => { if (d <= tol && d - bias < score) { score = d - bias; best = h; } };
  g.corners?.forEach((w, i) => { const s = project(w); if (s) take({ kind: 'corner', corner: i }, Math.hypot(m[0] - s[0], m[1] - s[1]), GZ.cornerHit, 8); });
  for (const axis of [0, 1, 2] as const) {
    const [a, b] = arrowSpan(g, axis);
    const sa = project(a), sb = project(b);
    if (sa && sb && Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) > 14) take({ kind: 'axis', axis }, distToSegment(m, sa, sb), GZ.hit, 4);
    const quad = planeQuad(g, axis).map(project);
    if (quad.every((q) => q !== null)) {
      const q2 = quad as Pt[];
      if (polyArea(q2) > 40 && insidePolygon(m, q2)) take({ kind: 'plane', axis }, 0, 1, 2);
    }
    if (ringFacing(g, axis) < RING_EDGE_ON) continue;
    const ring = ringPoints(g, axis).map(project);
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if (p && q) d = Math.min(d, distToSegment(m, p, q));
    }
    take({ kind: 'ring', axis }, d, GZ.ringHit, 0);
  }
  return best;
}

/** Ray ∩ plane through `p` with normal `n` (forward hits only). */
export function rayPlane(r: Ray, p: V3, n: V3): V3 | null {
  const den = dot(r.d, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(p, r.o), n) / den;
  return t > 0 ? addS(r.o, r.d, t) : null;
}

/** Travel along an axis through `c` between two pointer rays (metres). */
export function axisDelta(r0: Ray, r: Ray, c: V3, a: V3): number { return closestOnAxis(r, c, a) - closestOnAxis(r0, c, a); }

/** Travel in the plane through `c` with normal `n` between two pointer rays, or null when a ray misses it. */
export function planeDelta(r0: Ray, r: Ray, c: V3, n: V3): V3 | null {
  const a = rayPlane(r0, c, n), b = rayPlane(r, c, n);
  return a && b ? sub(b, a) : null;
}

/** Screen direction a point at `at` on a ring about `axis` (through `c`) moves for a positive (right-handed) turn. */
export function ringTangent(project: Project, c: V3, axis: V3, at: V3): Pt | null {
  const t = norm(cross(axis, sub(at, c)));
  const r = Math.hypot(...sub(at, c));
  const a = project(at), b = project(addS(at, t, r * 0.05));
  if (!a || !b) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : null;
}

/** Ring turn (degrees) from dragging the pointer along the ring's screen tangent (`radiusPx` = the ring's radius). */
export function ringDegrees(start: Pt, now: Pt, tangent: Pt, radiusPx: number): number {
  const along = (now[0] - start[0]) * tangent[0] + (now[1] - start[1]) * tangent[1];
  return (along / radiusPx) * (180 / Math.PI);
}

/** Rotation snap (GAME_SPEC §7.2 rule 4): 15°, Shift = 5°, Alt = free. */
export function snapAngle(deg: number, m: Pick<Mods, 'shift' | 'alt'>): number {
  if (m.alt) return Math.round(deg * 2) / 2; // the format stores half degrees
  const step = m.shift ? 5 : 15;
  return Math.round(deg / step) * step;
}

/** A resizable part's eight bound corners (part space) with their signs. */
export function boxCorners(def: PartDef, props: Readonly<Record<string, number>>): { local: V3; signs: V3 }[] {
  const b = def.boundsFor ? def.boundsFor(props) : def.bounds;
  const out: { local: V3; signs: V3 }[] = [];
  for (let c = 0; c < 8; c++) {
    out.push({
      local: [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]],
      signs: [c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1],
    });
  }
  return out;
}

/**
 * Corner-cube resize: the corner moved by `dLocal` (part space). Every sized axis except `dropAxis` (the one facing
 * the camera, which a screen drag can't reach) takes the move on that corner's side, snapped and clamped like the
 * sizing handles (`snapSize`); the opposite faces stay put (`resizeAxis`). Returns the new props and the part-space shift.
 */
export function cornerResize(def: PartDef, props0: Readonly<Record<string, number>>, signs: V3, dLocal: V3, dropAxis: number, free = false): { props: Record<string, number>; shift: V3 } {
  let props: Record<string, number> = { ...props0 };
  const shift: V3 = [0, 0, 0];
  for (const axis of sizeAxes(def)) {
    if (axis === dropAxis) continue;
    const key = SIZE_KEYS[axis];
    const spec = def.props[key]!;
    const size = snapSize(spec, props0[key]! + signs[axis]! * dLocal[axis]!, free);
    const r = resizeAxis(def, props, axis, signs[axis]! > 0 ? 1 : 0, size);
    props = r.props;
    shift[axis] += r.shift[axis];
  }
  return { props, shift };
}

/** Axis colours (sRGB) per colour preset: X / Y / Z. Kept apart under each deficiency; the letters carry it too. */
export const GIZMO_AXIS_HEX: Readonly<Record<ColourPreset, readonly [string, string, string]>> = {
  default: ['#FF4F5A', '#7CE34A', '#3F8CFF'],
  protanopia: ['#FF9A1F', '#F4F4F4', '#3F8CFF'],
  deuteranopia: ['#FF9A1F', '#F4F4F4', '#3F8CFF'],
  tritanopia: ['#FF4F5A', '#F4F4F4', '#16C7C0'],
  'high-contrast': ['#FF7A82', '#B6FF8C', '#8AB4FF'],
};

// ---- meshes (registered once on the renderer) --------------------------------------------------------------------

/** A unit cone (radius 0.5, y −0.5 … 0.5, apex up), like the built-in cylinder. */
export function cone(seg = 24): Geometry {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  const k = 0.5 / Math.hypot(0.5, 1); // the side normal's y over its length
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    p.push(x * 0.5, -0.5, z * 0.5, 0, 0.5, 0);
    const l = Math.hypot(1, k);
    n.push(x / l, k / l, z / l, x / l, k / l, z / l);
  }
  for (let s = 0; s < seg; s++) { const a = s * 2; idx.push(a, a + 1, a + 2); }
  const c = p.length / 3;
  p.push(0, -0.5, 0); n.push(0, -1, 0);
  for (let s = 0; s <= seg; s++) { const a = (s / seg) * Math.PI * 2; p.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5); n.push(0, -1, 0); }
  for (let s = 0; s < seg; s++) idx.push(c, c + s + 1, c + s + 2);
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(idx) };
}

/** A unit ring (radius 1 about +Y) with the given tube radius. */
export function ringMesh(tube: number, seg = 96): Geometry {
  const pts: number[][] = [];
  for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; pts.push([Math.cos(t), 0, Math.sin(t)]); }
  return sweptTube(pts, tube, 10);
}

/** Rotation taking +Y to the unit vector `v`. */
export function yTo(v: V3): Q4 {
  if (v[1] < -0.9999) return [1, 0, 0, 0];
  const s = Math.sqrt((1 + v[1]) * 2);
  return [v[2] / s, 0, -v[0] / s, s / 2];
}

// ---- the toggle (per viewer) ---------------------------------------------------------------------------------------

let enabled = ((): boolean => { try { return typeof localStorage === 'undefined' || localStorage.getItem('kn.gizmo') !== '0'; } catch { return true; } })();
/** Is the gizmo switched on (A, palette "Gizmo")? On by default. The sizing face handles give way to its corners. */
export function gizmoOn(): boolean { return enabled; }
export function setGizmoOn(on: boolean): void { enabled = on; try { localStorage.setItem('kn.gizmo', on ? '1' : '0'); } catch { /* private mode */ } }

// BUILDUX (D123): world (default) or local axes for the arrows and squares, per viewer
let localMode = ((): boolean => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('kn.gizmoAxes') === 'local'; } catch { return false; } })();
/** Do the gizmo's arrows and squares follow the part's own axes (palette "Gizmo: local axes", X)? World by default. */
export function gizmoLocal(): boolean { return localMode; }
export function setGizmoLocal(on: boolean): void { localMode = on; try { localStorage.setItem('kn.gizmoAxes', on ? 'local' : 'world'); } catch { /* private mode */ } }

// ---- the controller ------------------------------------------------------------------------------------------------

export interface GizmoHost extends MoveHost {
  readonly canvas: HTMLCanvasElement;
  viewProj(): Float32Array;
  eye(): V3;
  tool(): string;
  primary(): number | null;
  /** Drag-to-move (or another tool) owns the pointer: no gizmo. */
  busy(): boolean;
  pointer(): { readonly x: number; readonly y: number; readonly inside: boolean };
  /** A part is under the pointer: rings give way to it (press a part to drag it, even where a ring crosses it). */
  overPart(): boolean;
  addMesh(name: string, g: Geometry): number;
}

interface Resize { rec: PartRecord; def: PartDef; props0: Record<string, number>; q: Q4; pos0: V3; signs: V3; corner: V3; n: V3; drop: number; start: V3; props: Record<string, number>; shift: V3 }
interface GDrag { h: Handle; s: MoveSession | null; r: Resize | null; x0: number; y0: number; ray0: Ray; g0: GizmoGeom; tangent: Pt | null; readout: string; locks: number[] }

const FOG: Rgb = [0.25, 0.28, 0.33];

export class GizmoTool {
  private hot: Handle | null = null;
  private drag: GDrag | null = null;
  private geom: GizmoGeom | null = null;
  private cache: { key: string; box: { min: V3; max: V3 } | null } = { key: '', box: null };
  private held: string | null = null;
  private cursor = '';
  /** A drag from a handle was refused (or ended): its button-up is not a click. */
  private pressed = false;
  /** A press on a handle that hasn't moved past the drag threshold yet. */
  private pending: { h: Handle; x: number; y: number; g: GizmoGeom } | null = null;
  private readonly mesh: { cone: number; ring: number; ringHot: number };
  mods: Mods = NO_MODS;

  constructor(private readonly host: GizmoHost) {
    this.mesh = { cone: host.addMesh('gizmo:cone', cone()), ring: host.addMesh('gizmo:ring', ringMesh(GZ.ringTube)), ringHot: host.addMesh('gizmo:ring:hot', ringMesh(GZ.ringTubeHot)) };
  }

  get on(): boolean { return gizmoOn(); }
  /** A handle drag is in progress (camera navigation and part drags stand down). */
  get holding(): boolean { return this.drag !== null || this.pending !== null || this.pressed; }
  get session(): MoveSession | null { return this.drag?.s ?? null; }
  /** The doc changed: re-measure the selection's bounds. */
  invalidate(): void { this.cache.key = ''; }

  get local(): boolean { return gizmoLocal(); }

  /** BUILDUX (D123): world ↔ local axes for the arrows and squares (X, palette "Gizmo: local axes"). */
  toggleAxes(local = !gizmoLocal()): void {
    this.cancel(true);
    setGizmoLocal(local);
    this.invalidate();
    this.host.announce(local ? 'Gizmo: local axes. The arrows follow the part’s own turn' : 'Gizmo: world axes');
    this.host.toast(local ? 'Gizmo: local axes · X switches back to world' : 'Gizmo: world axes · X switches to local');
  }

  toggle(on = !gizmoOn()): void {
    if (!on) this.cancel(true);
    setGizmoOn(on);
    this.host.announce(on ? 'Gizmo on: drag its arrows, squares and rings' : 'Gizmo off');
    this.host.toast(on ? 'Gizmo on · A hides it' : 'Gizmo off · A shows it');
  }

  private project: Project = (p) => toScreen(this.host.viewProj(), this.host.canvas, p as V3);

  /** Selected parts the gizmo acts on, or null when it shouldn't show. */
  private targets(): PartRecord[] | null {
    const h = this.host;
    if (!gizmoOn() || h.phase() !== 'build' || h.tool() !== 'select' || h.busy()) return null;
    const doc = h.doc();
    if (!doc) return null;
    const out: PartRecord[] = [];
    for (const id of h.selection()) { const p = doc.parts.get(id); if (p && !h.lockedReason(p)) out.push(p); }
    return out.length ? out : null;
  }

  /** Per frame: lay the gizmo out, find the hovered handle, draw it (on top). */
  frame(overlay: SceneItem[]): void {
    const d = this.drag;
    const parts = d ? null : this.targets();
    if (!d && !parts) { this.geom = null; this.hot = null; this.setCursor(''); return; }
    if (d) {
      // the gizmo rides along with a move; rings and corners stay where the gesture began
      const s = d.s;
      const c = s && (d.h.kind === 'axis' || d.h.kind === 'plane') ? addS(d.g0.c, s.xf.t, 1) : d.g0.c;
      this.geom = { ...d.g0, c };
    } else {
      this.geom = this.layout(parts!);
      if (!this.geom) return;
      const m = this.host.pointer();
      this.hot = this.pending?.h ?? (m.inside ? this.handleAt(this.geom, m.x, m.y) : null);
      this.held = null;
      for (const p of parts!) { const who = this.host.heldBy(p.id); if (who) { this.held = `${who} is holding ${partName(p.type)}`; break; } }
    }
    this.setCursor(d ? (d.h.kind === 'ring' ? 'grabbing' : d.h.kind === 'corner' ? 'nwse-resize' : 'move') : !this.hot ? '' : this.hot.kind === 'ring' ? 'grab' : this.hot.kind === 'corner' ? 'nwse-resize' : 'move');
    this.draw(overlay, this.geom, d?.h ?? this.hot);
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.host.canvas.style.cursor = c;
  }

  private layout(parts: PartRecord[]): GizmoGeom | null {
    const key = parts.map((p) => p.id).join(',');
    if (key !== this.cache.key) {
      const boxes = parts.map(partBox).filter((b): b is NonNullable<typeof b> => !!b);
      this.cache = { key, box: unionBox(boxes) };
    }
    const box = this.cache.box;
    if (!box) return null;
    const c: V3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    const eye = this.host.eye();
    const mpp = metresPerPixel(this.project, c, cameraRight(eye, c));
    if (mpp <= 0) return null;
    let ringAxes: [V3, V3, V3] = [AXES[0], AXES[1], AXES[2]];
    let corners: V3[] | null = null;
    // BUILDUX (D123): local mode: the arrows and squares take the primary part's own axes
    let moveAxes: [V3, V3, V3] | undefined, axesQ: Q4 | undefined;
    if (gizmoLocal()) {
      const prim = parts.find((p) => p.id === this.host.primary()) ?? parts[0]!;
      axesQ = rotationToQuat(prim.rot) as Q4;
      moveAxes = localAxes(axesQ);
    }
    if (parts.length === 1) {
      const p = parts[0]!;
      const e = eulerOf(p.rot) ?? quatToEuler(rotationToQuat(p.rot) as Q4);
      const qy = axisQuat(1, e.yaw), qyx: Q4 = qmul(qy, axisQuat(0, e.pitch));
      ringAxes = [qrot(qy, [1, 0, 0]) as V3, [0, 1, 0], qrot(qyx, [0, 0, 1]) as V3];
      const def = partDef(p.type);
      if (def && sizeAxes(def).length) {
        const pose = partPose(p);
        corners = boxCorners(def, propValues(def, p.props)).map((k) => addS(pose.pos, qrot(pose.rot, k.local), 1));
      }
    }
    const toEye = sub(eye, c), ax = moveAxes ?? AXES;
    const planeSign: [number, number, number] = [dot(toEye, ax[0]) >= 0 ? 1 : -1, dot(toEye, ax[1]) >= 0 ? 1 : -1, dot(toEye, ax[2]) >= 0 ? 1 : -1];
    return { c, mpp, ringAxes, planeSign, corners, view: norm(sub(c, eye)), ...(moveAxes && axesQ ? { moveAxes, axesQ } : {}) };
  }

  private colors(): readonly [Rgb, Rgb, Rgb] {
    const hex = GIZMO_AXIS_HEX[settings.accessibility.colourPreset] ?? GIZMO_AXIS_HEX.default;
    return [hexLin(hex[0]), hexLin(hex[1]), hexLin(hex[2])];
  }

  private draw(out: SceneItem[], g: GizmoGeom, hot: Handle | null): void {
    const col = this.held ? [FOG, FOG, FOG] as const : this.colors();
    const s = g.mpp;
    const isHot = (h: Handle): boolean => !!hot && hot.kind === h.kind && (h.kind === 'corner' ? hot.kind === 'corner' && hot.corner === h.corner : (hot as { axis: number }).axis === (h as { axis: number }).axis);
    const items: SceneItem[] = [], hotItems: SceneItem[] = [];
    const push = (h: Handle, it: SceneItem): void => { (isHot(h) ? hotItems : items).push({ ...it, top: true }); };
    const dragging = !!this.drag;
    for (const axis of [0, 1, 2] as const) {
      const h: Handle = { kind: 'ring', axis };
      const k = isHot(h) ? GZ.hover : 1;
      const edgeOn = ringFacing(g, axis) < RING_EDGE_ON;
      push(h, { pos: g.c, rot: yTo(g.ringAxes[axis]), size: [GZ.ring * s, GZ.ring * s * k, GZ.ring * s], mesh: isHot(h) ? this.mesh.ringHot : this.mesh.ring, color: col[axis], alpha: (dragging && !isHot(h)) || edgeOn ? 0.3 : 0.9, emissive: isHot(h) ? 1 : 0 });
    }
    for (const axis of [0, 1, 2] as const) {
      const h: Handle = { kind: 'plane', axis };
      const k = isHot(h) ? GZ.hover : 1;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const mid = (GZ.plane0 + GZ.plane1) / 2, side = (GZ.plane1 - GZ.plane0) * k;
      const size: V3 = [0, 0, 0];
      size[u] = side * s; size[v] = side * s; size[axis] = 1.5 * s;
      const ax = moveAxesOf(g); // BUILDUX (D123): local axes turn the squares with the part
      push(h, { pos: addS(addS(g.c, ax[u]!, g.planeSign[u]! * mid * s), ax[v]!, g.planeSign[v]! * mid * s), ...(g.axesQ ? { rot: g.axesQ } : {}), size, mesh: 0, color: col[axis], alpha: dragging && !isHot(h) ? 0.25 : isHot(h) ? 0.85 : 0.55, emissive: isHot(h) ? 1 : 0 });
    }
    for (const axis of [0, 1, 2] as const) {
      const h: Handle = { kind: 'axis', axis };
      const k = isHot(h) ? GZ.hover : 1;
      const a = moveAxesOf(g)[axis], q = yTo(a);
      const alpha = dragging && !isHot(h) ? 0.4 : 1;
      push(h, { pos: addS(g.c, a, ((GZ.shaft0 + GZ.shaft1) / 2) * s), rot: q, size: [GZ.shaftR * 2 * k * s, (GZ.shaft1 - GZ.shaft0) * s, GZ.shaftR * 2 * k * s], mesh: 2, color: col[axis], alpha, emissive: isHot(h) ? 1 : 0 });
      push(h, { pos: addS(g.c, a, ((GZ.shaft1 + GZ.tip) / 2) * s), rot: q, size: [GZ.tipR * 2 * k * s, (GZ.tip - GZ.shaft1) * k * s, GZ.tipR * 2 * k * s], mesh: this.mesh.cone, color: col[axis], alpha, emissive: isHot(h) ? 1 : 0 });
    }
    items.push({ pos: g.c, size: [7 * s, 7 * s, 7 * s], mesh: 1, color: [0.9, 0.92, 0.95], alpha: 0.9, top: true });
    g.corners?.forEach((w, i) => {
      const h: Handle = { kind: 'corner', corner: i };
      const k = isHot(h) ? GZ.hover : 1;
      push(h, { pos: w, size: [GZ.corner * 2 * k * s, GZ.corner * 2 * k * s, GZ.corner * 2 * k * s], mesh: 0, color: isHot(h) ? [1, 0.69, 0.13] : [0.03, 0.67, 1], alpha: 1, emissive: isHot(h) ? 1 : 0.3 });
    });
    out.push(...items, ...hotItems);
  }

  /** X / Y / Z letter chips at the arrow tips (ui/overlays.ts draws them), in the axis colours. */
  labels(): { at: readonly number[]; text: string; color: string }[] {
    const g = this.geom;
    if (!g) return [];
    const hex = this.held ? ['#5A6170', '#5A6170', '#5A6170'] : GIZMO_AXIS_HEX[settings.accessibility.colourPreset] ?? GIZMO_AXIS_HEX.default;
    return ([0, 1, 2] as const).map((axis) => ({ at: addS(g.c, moveAxesOf(g)[axis], (GZ.tip + 16) * g.mpp), text: AXIS_LETTER[axis], color: hex[axis]! }));
  }

  /**
   * Left button down: true when the press landed on a handle (no part drag, no camera). The gesture starts once the
   * pointer moves DRAG_THRESHOLD_PX; a press released before that is still a plain click (Shift+click on a part under
   * a ring keeps adding to the selection).
   */
  down(x: number, y: number, mods: Mods): boolean {
    this.mods = mods;
    const g = this.geom;
    if (!g || this.drag || this.host.busy()) return false;
    const h = this.handleAt(g, x, y);
    if (!h || !this.targets()) return false;
    this.pending = { h, x, y, g };
    return true;
  }

  /** The handle under a screen point; a ring over a part gives way to the part. */
  private handleAt(g: GizmoGeom, x: number, y: number): Handle | null {
    const h = hitGizmo(g, this.project, [x, y]);
    return h && h.kind === 'ring' && this.host.overPart() ? null : h;
  }

  /** The press became a drag: refuse with the reason, or build the gesture. */
  private begin(pn: { h: Handle; x: number; y: number; g: GizmoGeom }): void {
    const { h, x, y, g } = pn;
    const host = this.host, doc = host.doc();
    const parts = this.targets();
    if (!doc || !parts) return;
    this.pressed = true; // from here on, the button-up is not a click
    const ids = parts.map((p) => p.id);
    const why = moveRefusal(host, ids);
    if (why) { host.toast(why, 'warn'); host.announce(why, 'assertive'); host.sound('error'); return; }
    const ray0 = rayAt(host.viewProj(), host.canvas, x, y);
    let s: MoveSession | null = null, r: Resize | null = null, tangent: Pt | null = null;
    if (h.kind === 'corner') {
      const p = parts[0]!, def = partDef(p.type)!;
      const pose = partPose(p);
      const k = boxCorners(def, propValues(def, p.props))[h.corner]!;
      const corner = addS(pose.pos, qrot(pose.rot, k.local), 1);
      // drag on the plane through the corner facing the camera; the part axis along the view is left alone
      const view = norm(sub(corner, host.eye()));
      let drop = 0, best = -1;
      for (let i = 0; i < 3; i++) { const a = Math.abs(dot(qrot(pose.rot, AXES[i]!), view)); if (a > best) { best = a; drop = i; } }
      const n = qrot(pose.rot, AXES[drop]!) as V3;
      const start = rayPlane(ray0, corner, n);
      if (!start) return;
      const props0 = { ...propValues(def, p.props) };
      r = { rec: p, def, props0, q: pose.rot, pos0: pose.pos, signs: k.signs, corner, n, drop, start, props: props0, shift: [0, 0, 0] };
    } else {
      const selected = host.selection();
      try { s = new MoveSession(doc, ids, selected.filter((id) => doc.links.has(id)), host.primary(), host.world()); } catch { return; }
      if (h.kind === 'ring') {
        const pts = ringPoints(g, h.axis);
        let at = pts[0]!, bd = Infinity;
        for (const q of pts) { const sp = this.project(q); if (sp) { const dd = Math.hypot(sp[0] - x, sp[1] - y); if (dd < bd) { bd = dd; at = q; } } }
        tangent = ringTangent(this.project, g.c, g.ringAxes[h.axis], at);
      }
    }
    this.drag = { h, s, r, x0: x, y0: y, ray0, g0: g, tangent, readout: '', locks: ids };
    host.lock(ids);
    host.announce(h.kind === 'axis' ? `Moving along ${AXIS_LETTER[h.axis]}` : h.kind === 'plane' ? `Moving in the ${AXIS_LETTER[(h.axis + 1) % 3]}${AXIS_LETTER[(h.axis + 2) % 3]} plane` : h.kind === 'ring' ? `Turning: ${RING_NAME[h.axis].toLowerCase()}` : 'Resizing');
  }

  move(x: number, y: number, buttons: number, mods: Mods): void {
    const pn = this.pending;
    if (pn && !this.drag) {
      if (!(buttons & 1)) { this.pending = null; return; }
      if (!pastThreshold(x - pn.x, y - pn.y)) return;
      this.pending = null;
      this.begin(pn);
    }
    const d = this.drag;
    if (!d) return;
    this.mods = mods;
    if (!(buttons & 1)) { this.cancel(true); return; }
    if (buttons & 2) { this.cancel(); return; }
    const host = this.host;
    const ray = rayAt(host.viewProj(), host.canvas, x, y);
    const step = snapStep(mods);
    if (d.r) { this.resize(d.r, ray, mods); d.readout = this.sizeText(d.r); return; }
    const s = d.s!;
    const an = s.anchor;
    const t: V3 = [0, 0, 0];
    const lx = d.g0.moveAxes; // BUILDUX (D123): local axes (the part's own); else world, as before
    if ((d.h.kind === 'axis' || d.h.kind === 'plane') && lx) {
      let m: V3;
      if (d.h.kind === 'axis') {
        const i = d.h.axis, dd = axisDelta(d.ray0, ray, d.g0.c, lx[i]);
        m = localAxisMove(dd, lx[i], step);
        d.readout = `local ${AXIS_LETTER[i]} ${signed(snap(dd, step), step)} m`;
      } else {
        const dd = planeDelta(d.ray0, ray, d.g0.c, lx[d.h.axis]);
        if (!dd) return;
        const u = (d.h.axis + 1) % 3, v = (d.h.axis + 2) % 3;
        m = localPlaneMove(dd, lx[u]!, lx[v]!, step);
        d.readout = 'local ' + [Math.min(u, v), Math.max(u, v)].map((i) => `${AXIS_LETTER[i]} ${signed(snap(dot(dd, lx[i]!), step), step)}`).join(' · ') + ' m';
      }
      t[0] = m[0]; t[1] = floorClampY(m[1], s.bottom0, host.floor()); t[2] = m[2];
      s.update({ pivot: an.from, t, q: null, rot: new Map() });
    } else if (d.h.kind === 'axis') {
      const i = d.h.axis;
      const dd = axisDelta(d.ray0, ray, d.g0.c, AXES[i]);
      t[i] = snap(an.from[i]! + dd, step) - an.from[i]!;
      if (i === 1) t[1] = floorClampY(t[1], s.bottom0, host.floor());
      d.readout = `${AXIS_LETTER[i]} ${signed(t[i]!, step)} m`;
      s.update({ pivot: an.from, t, q: null, rot: new Map() });
    } else if (d.h.kind === 'plane') {
      const dd = planeDelta(d.ray0, ray, d.g0.c, AXES[d.h.axis]);
      if (!dd) return;
      const u = (d.h.axis + 1) % 3, v = (d.h.axis + 2) % 3;
      for (const i of [u, v]) t[i] = snap(an.from[i]! + dd[i]!, step) - an.from[i]!;
      t[1] = floorClampY(t[1], s.bottom0, host.floor());
      d.readout = [Math.min(u, v), Math.max(u, v)].map((i) => `${AXIS_LETTER[i]} ${signed(t[i]!, step)}`).join(' · ') + ' m';
      s.update({ pivot: an.from, t, q: null, rot: new Map() });
    } else if (d.h.kind === 'ring') {
      const axis = d.h.axis;
      const raw = d.tangent ? ringDegrees([d.x0, d.y0], [x, y], d.tangent, GZ.ring) : 0;
      const deg = snapAngle(raw, mods);
      const single = s.parts.length === 1;
      const rot = new Map<number, ReturnType<typeof turned>>();
      for (const m of s.parts) rot.set(m.rec.id, turned(m.rec.rot, axis, deg, single ? 'gimbal' : 'world'));
      d.readout = `${RING_NAME[axis]} ${deg > 0 ? '+' : ''}${deg}°`;
      s.update({ pivot: d.g0.c, t: [0, 0, 0], q: single || !deg ? null : axisQuat(axis, deg), rot });
    }
  }

  private resize(r: Resize, ray: Ray, mods: Mods): void {
    const p = rayPlane(ray, r.corner, r.n);
    if (!p) return;
    const dl = qrot(qinv(r.q), sub(p, r.start)) as V3;
    const res = cornerResize(r.def, r.props0, r.signs, dl, r.drop, mods.alt);
    r.props = res.props;
    r.shift = res.shift;
  }

  private sizeText(r: Resize): string {
    const names = ['width', 'height', 'depth'];
    return sizeAxes(r.def).map((a) => `${names[a]} ${r.props[SIZE_KEYS[a]]!.toFixed(this.mods.alt ? 2 : 1)}`).join(' × ') + ' m';
  }

  /** The resize being dragged, as a ghost to draw (part with its new size and position). */
  resizePreview(): { rec: PartRecord; def: PartDef; pose: Pose } | null {
    const r = this.drag?.r;
    if (!r) return null;
    const w = qrot(r.q, r.shift);
    return { rec: { ...r.rec, props: propList(r.def, r.props) }, def: r.def, pose: { pos: addS(r.pos0, w, 1), rot: r.q } };
  }

  /** Button up: true when a handle gesture ends (main.ts skips its click). */
  up(): boolean {
    const d = this.drag, was = this.pressed;
    this.pressed = false;
    this.pending = null; // a press that never moved is a click
    if (!d) return was;
    this.drag = null;
    const host = this.host;
    if (d.s) {
      const verb = d.h.kind === 'ring' ? 'Turned' : 'Moved';
      commitMove(host, d.s, verb);
    } else if (d.r) {
      const r = d.r;
      const changed = Object.keys(r.props).some((k) => Math.abs(r.props[k]! - r.props0[k]!) > 1e-9);
      if (changed && host.phase() === 'build') {
        const w = qrot(r.q, r.shift);
        const pos: [number, number, number] = [r.rec.pos[0] + metresToPos(w[0]!), Math.max(0, r.rec.pos[1] + metresToPos(w[1]!)), r.rec.pos[2] + metresToPos(w[2]!)];
        const moved = pos.some((v, i) => v !== r.rec.pos[i]);
        if (host.submit({ k: 'PartUpdate', id: r.rec.id, patch: { props: propList(r.def, r.props) as [number, number][], ...(moved ? { pos } : {}) } })) {
          host.announce(`${r.def.name}: ${this.sizeText(r)}`);
          host.sound('place');
        }
      }
    }
    host.unlock(d.locks);
    this.invalidate();
    return true;
  }

  cancel(silent = false): boolean {
    this.pending = null;
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    this.host.unlock(d.locks);
    if (!silent) this.host.announce('Gizmo move cancelled');
    return true;
  }

  key(e: KeyboardEvent, k: string): boolean {
    if (!this.drag) return false;
    if (k === 'Escape') { this.cancel(); e.preventDefault(); return true; }
    if (k === 'Shift' || k === 'Control' || k === 'Alt') { this.mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }; return true; }
    return true; // nothing else mid-gesture
  }

  /** Readout for the tool badge while a handle is dragged. */
  badge(): { text: string; blocked: boolean } | null {
    const d = this.drag;
    if (!d) return null;
    const why = d.s?.refusal() ?? null;
    if (why && d.s?.changed()) return { text: `Can't drop here: ${why}`, blocked: true };
    return { text: d.readout || (d.h.kind === 'ring' ? `${RING_NAME[d.h.axis]} 0°` : d.h.kind === 'corner' && d.r ? this.sizeText(d.r) : 'Drag to move'), blocked: false };
  }
}

const signed = (v: number, step: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(step > 0 && step < GRID_STEP ? 3 : step === 0 ? 3 : 2)}`;

const propList = (def: PartDef, props: Readonly<Record<string, number>>): PropList => Object.keys(def.props).map((k) => propSteps(def, k, props[k]!) as [number, number]);

