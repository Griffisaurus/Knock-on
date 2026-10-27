// Drag-to-move (stream DRAG, D117) and the move preview the transform gizmo shares (ui/gizmo.ts).
//
// Select tool: press on a part and drag past DRAG_THRESHOLD_PX to pick it up (a plain click still selects). If the part
// is in the selection, the whole selection moves and keeps its offsets; otherwise that part is selected and moves alone.
// While dragging, the moved parts show as placement ghosts at the drop spot (the originals stay put until the drop):
// snapped to the grid (Ctrl = 2.5 cm, Alt = free), resting on whatever is under the cursor or on the work plane
// (Ctrl + wheel and PageUp / PageDown raise it, as when placing), and red with the reason when the drop would overlap a
// part (`overlapOf`, the test placement uses) or leave the world. Shift moves up and down only. R turns the moved parts
// 15° (one part: R / T / Y, as the keys do). Release drops: ONE op (a Batch of the same PartUpdates the keyboard move
// sends, plus LinkUpdates for waypoints), so one undo step and one co-op op. Esc or a right click cancels. Links whose
// two ends both move take their waypoints along; every link re-routes to the ghosts while dragging (main.ts's poseOf
// reads `pose()`). Nothing here touches the sim: it is UI plus document ops.
//
// main.ts owns the pointer and the per-frame pick; it calls `down` / `move` / `up` / `key` / `wheel` / `frame` and
// draws the ghosts from `session`.
//
// BUILDUX (D123–D124): `carry` runs the same follow-the-pointer gesture with no button held, for a paste ghost
// (ui/clipboard.ts): a click drops it through the caller's commit. Each frame the host may pull the preview onto a
// compatible port (`DragHost.snap`, ui/portsnap.ts; Alt = off).

import type { WorldDoc } from '@knockon/docstore';
import { metresToPos, posToMetres, snappedEuler, type LinkRecord, type Op, type PartRecord, type Rotation } from '@knockon/format';
import { boundsOf, propValues, type PartDef } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qmul, qrot, type Q4 } from '../catalog.ts';
import type { V3 } from '../math.ts';
import { compose, partPose, type Pose } from '../scene.ts';
import { closestOnAxis, type Ray } from './organise.ts';
import type { SnapInfo } from './portsnap.ts';

// ---- pure pieces (unit-tested in test/drag-gizmo.test.ts) ---------------------------------------------------------

/** A press that moves this far (screen px) becomes a drag; less is a click. */
export const DRAG_THRESHOLD_PX = 4;
export function pastThreshold(dx: number, dy: number, px = DRAG_THRESHOLD_PX): boolean { return dx * dx + dy * dy >= px * px; }

export interface Mods { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean }
export const NO_MODS: Mods = { shift: false, ctrl: false, alt: false };
export const modsOf = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean; altKey: boolean }): Mods => ({ shift: e.shiftKey, ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey });

/** The grid (GAME_SPEC §5.2): 10 cm, Ctrl = 2.5 cm, Alt = free (0). */
export const GRID_STEP = 0.1;
export const FINE_STEP = 0.025;
export function snapStep(m: { readonly ctrl: boolean; readonly alt: boolean }): number { return m.alt ? 0 : m.ctrl ? FINE_STEP : GRID_STEP; }
/** Grid snap shared by placement, drag-to-move and the gizmo (step 0 = free). */
export function snap(x: number, step: number): number { return step > 0 ? Math.round(x / step) * step : x; }

/**
 * What a drag that starts on `pressed` moves: the whole selection (its parts, plus its port-less path links) when the
 * pressed part is in it, else just that part (which then becomes the selection: `reselect`).
 */
export function dragSet(pressed: number, selected: readonly number[], isPart: (id: number) => boolean): { parts: number[]; links: number[]; reselect: boolean } {
  if (!selected.includes(pressed)) return { parts: [pressed], links: [], reselect: true };
  return { parts: selected.filter(isPart), links: selected.filter((id) => !isPart(id)), reselect: false };
}

export interface Box { readonly min: V3; readonly max: V3 }

/** World AABB of a part's rotated bounds. */
export function worldBox(def: PartDef, props: Readonly<Record<string, number>>, pose: Pose): Box {
  const b = boundsOf(def, props);
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const l = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]];
    const w = compose(pose, l).pos;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return { min, max };
}

/** A placed part's world AABB (null for an unknown type). */
export function partBox(p: PartRecord): Box | null {
  const def = partDef(p.type);
  return def ? worldBox(def, propValues(def, p.props), partPose(p)) : null;
}

/** Overlap with a 1 mm tolerance: touching (resting on, side by side) is fine. */
export function boxesOverlap(a: Box, b: Box, eps = 0.001): boolean {
  for (let i = 0; i < 3; i++) if (a.min[i]! >= b.max[i]! - eps || a.max[i]! <= b.min[i]! + eps) return false;
  return true;
}

/**
 * The first candidate whose box overlaps `box`, or null: THE "blocked" test. Placement (main.ts blockedBy), drag-to-move
 * and the gizmo all call this.
 */
export function overlapOf<T>(box: Box, candidates: Iterable<T>, boxOf: (c: T) => Box | null | undefined): T | null {
  for (const c of candidates) { const b = boxOf(c); if (b && boxesOverlap(box, b)) return c; }
  return null;
}

export function unionBox(boxes: Iterable<Box>): Box | null {
  let out: { min: V3; max: V3 } | null = null;
  for (const b of boxes) {
    if (!out) { out = { min: [...b.min] as V3, max: [...b.max] as V3 }; continue; }
    for (let i = 0; i < 3; i++) { out.min[i] = Math.min(out.min[i]!, b.min[i]!); out.max[i] = Math.max(out.max[i]!, b.max[i]!); }
  }
  return out;
}

/** The height a part comes to rest at under the cursor: a part's top face, the top of a part hit on its side, or the hit point (floor, terrain, work plane). */
export function surfaceY(hit: { readonly point: V3; readonly part: PartRecord | null; readonly normal: V3 }, partTop: (p: PartRecord) => number): number {
  if (!hit.part) return hit.point[1];
  return hit.normal[1] > 0.7 ? hit.point[1] : partTop(hit.part);
}

/** Vertical-only drag: the bottom height after lifting by `dy` (snapped to `step`, not below `floor`; null = no floor). */
export function liftBottom(bottom0: number, dy: number, step: number, floor: number | null): number {
  const b = snap(bottom0 + dy, step);
  return floor === null ? b : Math.max(floor, b);
}

/** Lowest allowed translation in y: the moved parts' lowest bottom stays on the floor (unless it already was below). */
export function floorClampY(dy: number, lowestBottom: number, floor: number | null): number {
  if (floor === null) return dy;
  return Math.max(dy, Math.min(0, floor - lowestBottom));
}

export interface Euler { yaw: number; pitch: number; roll: number }
/** Euler component turned by each world axis index's ring / key: X = pitch (T), Y = yaw (R), Z = roll (Y). */
export const EULER_KEY = ['pitch', 'yaw', 'roll'] as const;

/** Degrees of a stored rotation (tag 0 / 1); null for a smallest-three quaternion (tag 2). */
export function eulerOf(r: Rotation): Euler | null {
  if (r.tag === 0) return { yaw: 0, pitch: 0, roll: 0 };
  if (r.tag === 1) return { yaw: r.yaw / 2, pitch: r.pitch / 2, roll: r.roll / 2 };
  return null;
}

/** Yaw / pitch / roll (degrees) of q = qy · qx · qz (packages/sim rotationToQuat's order). */
export function quatToEuler(q: Q4): Euler {
  const [x, y, z, w] = q;
  const m02 = 2 * (x * z + w * y), m22 = 1 - 2 * (x * x + y * y);
  const m12 = 2 * (y * z - w * x), m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z);
  const D = 180 / Math.PI;
  return { yaw: Math.atan2(m02, m22) * D, pitch: Math.asin(Math.max(-1, Math.min(1, -m12))) * D, roll: Math.atan2(m10, m11) * D };
}

/** Rotation by `deg` about world axis 0 / 1 / 2. */
export function axisQuat(axis: 0 | 1 | 2, deg: number): Q4 {
  const h = (deg * Math.PI) / 360, s = Math.sin(h);
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(h)];
}

/**
 * A rotation turned by `deg` about axis 0 / 1 / 2. 'gimbal' edits that Euler component (exactly what R / T / Y do);
 * 'world' turns about the world axis (a group turn): for yaw that is the same thing, for pitch and roll the result is
 * re-read as Euler angles (stored to the format's 0.5° step).
 */
export function turned(r: Rotation, axis: 0 | 1 | 2, deg: number, frame: 'gimbal' | 'world'): Rotation {
  if (deg === 0) return r;
  const e0 = eulerOf(r);
  if (e0 && (frame === 'gimbal' || axis === 1)) {
    const e = { ...e0 };
    e[EULER_KEY[axis]] += deg;
    return snappedEuler(e.yaw, e.pitch, e.roll);
  }
  const q0 = rotationToQuat(r) as Q4;
  const e = quatToEuler(frame === 'world' ? qmul(axisQuat(axis, deg), q0) : qmul(q0, axisQuat(axis, deg)));
  return snappedEuler(e.yaw, e.pitch, e.roll);
}

export function sameRotation(a: Rotation, b: Rotation): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === 0) return true;
  if (a.tag === 1 && b.tag === 1) return a.yaw === b.yaw && a.pitch === b.pitch && a.roll === b.roll;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A rigid move: positions turn by `q` about `pivot`, then shift by `t`; `rot` holds the parts' new rotations. */
export interface MoveXf { readonly pivot: V3; readonly t: V3; readonly q: Q4 | null; readonly rot: ReadonlyMap<number, Rotation> }
export const stillXf = (pivot: V3): MoveXf => ({ pivot, t: [0, 0, 0], q: null, rot: new Map() });

export function movePoint(p: readonly number[], xf: MoveXf): V3 {
  let o: readonly number[] = [p[0]! - xf.pivot[0], p[1]! - xf.pivot[1], p[2]! - xf.pivot[2]];
  if (xf.q) o = qrot(xf.q, o);
  return [xf.pivot[0] + o[0]! + xf.t[0], xf.pivot[1] + o[1]! + xf.t[1], xf.pivot[2] + o[2]! + xf.t[2]];
}

/** The same move in format position units. A pure shift adds one rounded delta to every point, so offsets stay exact. */
export function moveUnits(u: readonly number[], xf: MoveXf): [number, number, number] {
  if (!xf.q) return [u[0]! + metresToPos(xf.t[0]), u[1]! + metresToPos(xf.t[1]), u[2]! + metresToPos(xf.t[2])];
  const m = movePoint([posToMetres(u[0]!), posToMetres(u[1]!), posToMetres(u[2]!)], xf);
  return [metresToPos(m[0]), metresToPos(m[1]), metresToPos(m[2])];
}

export const partName = (type: string): string => partDef(type)?.name ?? type.toUpperCase();

// ---- the move session: a set of parts, their preview poses, the blocked test and the op -------------------------------

export interface WorldBounds { readonly min: V3; readonly max: V3; readonly label: string }
export interface MovePart { readonly rec: PartRecord; readonly def: PartDef; readonly props: Readonly<Record<string, number>>; readonly from: V3 }
export interface MovePose { readonly pos: V3; readonly rot: Q4; readonly rotation: Rotation }

/** True when a part origin lies outside the world's bounds (1 mm slack). */
export function outsideWorld(p: V3, b: { readonly min: V3; readonly max: V3 }): boolean {
  const e = 0.001;
  return p[0] < b.min[0] - e || p[0] > b.max[0] + e || p[2] < b.min[2] - e || p[2] > b.max[2] + e || p[1] > b.max[1] + e;
}

export class MoveSession {
  readonly parts: MovePart[] = [];
  readonly anchor: MovePart;
  /** Lowest bottom of the moved parts where they started (the floor clamp). */
  readonly bottom0: number;
  /** Links whose waypoints move: both ends on moved parts, or selected port-less path links. */
  readonly links: LinkRecord[] = [];
  private readonly idSet = new Set<number>();
  private obstacles: { p: PartRecord; box: Box }[] = [];
  xf: MoveXf;
  readonly poses = new Map<number, MovePose>();
  /** The first moved part that would overlap a part that isn't moving, and that part. */
  blocked: { mover: MovePart; by: PartRecord } | null = null;
  outside = false;
  /** BUILDUX (D124): the port snap the last update took (ui/portsnap.ts snapSession), for the glow and the readout. */
  portSnap: SnapInfo | null = null;

  constructor(doc: WorldDoc, partIds: readonly number[], freeLinkIds: readonly number[], anchorId: number | null, private readonly world: WorldBounds | null) {
    for (const id of partIds) {
      const rec = doc.parts.get(id);
      const def = rec ? partDef(rec.type) : undefined;
      if (!rec || !def || this.idSet.has(id)) continue;
      this.idSet.add(id);
      this.parts.push({ rec, def, props: propValues(def, rec.props), from: partPose(rec).pos });
    }
    if (!this.parts.length) throw new Error('nothing to move');
    this.anchor = this.parts.find((m) => m.rec.id === anchorId) ?? this.parts[0]!;
    const free = new Set(freeLinkIds);
    for (const l of doc.links.values()) {
      if (!l.points.length) continue;
      const both = l.from && l.to && this.idSet.has(l.from.part) && this.idSet.has(l.to.part);
      if (both || (!l.from && !l.to && free.has(l.id))) this.links.push(l);
    }
    let low = Infinity;
    for (const m of this.parts) low = Math.min(low, worldBox(m.def, m.props, partPose(m.rec)).min[1]);
    this.bottom0 = low;
    this.xf = stillXf(this.anchor.from);
    this.revalidate(doc);
  }

  has(id: number): boolean { return this.idSet.has(id); }
  get label(): string { return this.parts.length === 1 ? partName(this.anchor.rec.type) : `${this.parts.length} parts`; }

  /** Lowest y of a moved part's bounds at its origin, for a rotation (where its bottom sits relative to it). */
  localMinY(m: MovePart, rot: Rotation): number { return worldBox(m.def, m.props, { pos: [0, 0, 0], rot: rotationToQuat(rot) as Q4 }).min[1]; }

  /** Re-reads what the moved parts could bump into (at the start, and again at the drop, in case a partner added parts). */
  revalidate(doc: WorldDoc): void {
    this.obstacles = [];
    for (const p of doc.parts.values()) {
      if (this.idSet.has(p.id)) continue;
      const box = partBox(p);
      if (box) this.obstacles.push({ p, box });
    }
    this.update(this.xf);
  }

  /** Recompute the preview poses, the blocked test and the bounds test for a move. Per frame; no document change. */
  update(xf: MoveXf): void {
    this.xf = xf;
    this.poses.clear();
    const boxes: Box[] = [];
    let out = false;
    for (const m of this.parts) {
      const pos = movePoint(m.from, xf);
      const rotation = xf.rot.get(m.rec.id) ?? m.rec.rot;
      const rot = rotationToQuat(rotation) as Q4;
      this.poses.set(m.rec.id, { pos, rot, rotation });
      boxes.push(worldBox(m.def, m.props, { pos, rot }));
      if (this.world && outsideWorld(pos, this.world)) out = true;
    }
    this.outside = out;
    // broad phase: only parts that touch the moved parts' union can block one of them
    const u = unionBox(boxes)!;
    const near = this.obstacles.filter((o) => boxesOverlap(u, o.box));
    this.blocked = null;
    if (near.length) {
      for (let i = 0; i < this.parts.length && !this.blocked; i++) {
        const hit = overlapOf(boxes[i]!, near, (o) => o.box);
        if (hit) this.blocked = { mover: this.parts[i]!, by: hit.p };
      }
    }
  }

  pose(id: number): MovePose | undefined { return this.poses.get(id); }

  /** Why the drop is refused, or null. */
  refusal(): string | null {
    if (this.outside) return `outside the ${this.world?.label ?? 'world'}`;
    if (this.blocked) return `overlaps ${partName(this.blocked.by.type)}`;
    return null;
  }

  changed(): boolean {
    for (const m of this.parts) {
      const p = this.poses.get(m.rec.id);
      if (!p) continue;
      if (!sameRotation(p.rotation, m.rec.rot)) return true;
      const u = moveUnits(m.rec.pos, this.xf);
      if (u[0] !== m.rec.pos[0] || u[1] !== m.rec.pos[1] || u[2] !== m.rec.pos[2]) return true;
    }
    return false;
  }

  /** A link's waypoints after the move (metres), for the preview. */
  linkPoints(l: LinkRecord): V3[] { return l.points.map((q) => movePoint([posToMetres(q[0]), posToMetres(q[1]), posToMetres(q[2])], this.xf)); }

  /** The drop as ONE op (one undo step): PartUpdates (pos, and rot when it turned) and LinkUpdates for waypoints. */
  op(doc: WorldDoc): Op | null {
    const ops: Op[] = [];
    for (const m of this.parts) {
      const cur = doc.parts.get(m.rec.id);
      const p = this.poses.get(m.rec.id);
      if (!cur || !p) continue;
      const pos = moveUnits(m.rec.pos, this.xf);
      const posChanged = pos[0] !== cur.pos[0] || pos[1] !== cur.pos[1] || pos[2] !== cur.pos[2];
      const rotChanged = !sameRotation(p.rotation, cur.rot);
      if (!posChanged && !rotChanged) continue;
      ops.push({ k: 'PartUpdate', id: m.rec.id, patch: { ...(posChanged ? { pos } : {}), ...(rotChanged ? { rot: p.rotation } : {}) } });
    }
    for (const l of this.links) {
      if (!doc.links.has(l.id)) continue;
      const points = l.points.map((q) => moveUnits(q, this.xf));
      if (points.some((q, i) => q.some((v, k) => v !== l.points[i]![k]))) ops.push({ k: 'LinkUpdate', id: l.id, patch: { points } });
    }
    return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { k: 'Batch', ops };
  }
}

// ---- the host both controllers talk to (main.ts) -----------------------------------------------------------------

export interface MoveHost {
  doc(): WorldDoc | null;
  phase(): string;
  /** Selected ids (parts and links). */
  selection(): readonly number[];
  /** Replace the selection with one part (it opens in the Inspector). */
  selectOnly(id: number): void;
  /** Why a part can't be edited (locked part or layer), or null. */
  lockedReason(p: PartRecord): string | null;
  /** The partner's name when they hold this part (soft lock), else null. */
  heldBy(id: number): string | null;
  world(): WorldBounds | null;
  /** The floor height the moved parts stay above (null on terrain, where only the heightfield is under them). */
  floor(): number | null;
  submit(op: Op): boolean;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
  announce(text: string, level?: 'polite' | 'assertive'): void;
  sound(kind: 'place' | 'error' | 'rotate'): void;
  /** Soft-lock the moved parts for the gesture (the partner sees them held; MULTIPLAYER §5.4). */
  lock(ids: readonly number[]): void;
  unlock(ids: readonly number[]): void;
}

/** Can these parts be moved now? The refusal to show, or null. */
export function moveRefusal(host: Pick<MoveHost, 'doc' | 'phase' | 'lockedReason' | 'heldBy'>, ids: readonly number[]): string | null {
  if (host.phase() !== 'build') return 'Stop the run to move parts';
  const doc = host.doc();
  if (!doc) return 'Not connected';
  for (const id of ids) {
    const p = doc.parts.get(id);
    if (!p) continue;
    const locked = host.lockedReason(p);
    if (locked) return locked;
    const who = host.heldBy(id);
    if (who) return `${who} is holding ${partName(p.type)}`;
  }
  return null;
}

/** The drop shared by drag-to-move and the gizmo: refuse with the reason, or submit the one op. */
export function commitMove(host: MoveHost, s: MoveSession, verb = 'Moved'): boolean {
  const doc = host.doc();
  if (!doc || host.phase() !== 'build') { host.toast('Stop the run to move parts', 'warn'); return false; }
  s.revalidate(doc);
  if (!s.changed()) return false;
  const why = s.refusal();
  if (why) {
    host.toast(`Can't drop here: ${why}`, 'warn');
    host.announce(`Can't drop here: ${why}`, 'assertive');
    host.sound('error');
    return false;
  }
  const op = s.op(doc);
  if (!op || !host.submit(op)) return false;
  host.announce(`${verb} ${s.label}`);
  host.sound('place');
  return true;
}

// ---- drag-to-move -------------------------------------------------------------------------------------------------

export interface DragHit { readonly point: V3; readonly part: PartRecord | null; readonly normal: V3 }

export interface DragHost extends MoveHost {
  /** The current pick under the pointer (main.ts leaves the moved parts out of it while dragging). */
  hit(): DragHit | null;
  ray(): Ray | null;
  /** Top of a part's bounds (resting on a part hit on its side). */
  partTop(p: PartRecord): number;
  workY(): number;
  setWorkY(y: number): void;
  /** BUILDUX (D124): pull the preview onto a compatible port (ui/portsnap.ts); may call `s.update` again. */
  snap?(s: MoveSession, xf: MoveXf, mods: Mods): void;
}

interface Press { x: number; y: number; id: number | null; point: V3 | null; locked: string | null; dead: boolean }
interface Active {
  s: MoveSession;
  grab: [number, number];
  target: V3;
  rots: Map<number, Rotation>;
  eulers: Map<number, Euler>;
  yaw: number;
  vert: { s0: number; bottom0: number; x: number; z: number } | null;
  locks: number[];
  /** BUILDUX (D123): a carried gesture (a paste ghost): no button held, a click drops it through `commit`. */
  carry: { commit: (s: MoveSession) => boolean; label: string } | null;
}

export class DragMove {
  private press: Press | null = null;
  private act: Active | null = null;
  /** BUILDUX: the button-up after a click that dropped a carried paste is not a click. */
  private swallowUp = false;
  mods: Mods = NO_MODS;

  constructor(private readonly host: DragHost) {
    if (typeof window === 'undefined') return;
    // modifiers pressed or released without moving the mouse still switch Shift (vertical), Ctrl (fine) and Alt (free)
    const sync = (e: KeyboardEvent): void => {
      if (!this.act) return;
      this.mods = modsOf(e);
      if (e.key === 'Alt') e.preventDefault(); // Alt alone would focus the browser's menu
    };
    window.addEventListener('keydown', sync, true);
    window.addEventListener('keyup', sync, true);
  }

  /** A press on a part (or a locked part) is pending or dragging: left-drag camera navigation stands down. */
  get holding(): boolean { return this.press !== null; }
  get active(): boolean { return this.act !== null; }
  get session(): MoveSession | null { return this.act?.s ?? null; }
  /** BUILDUX (D123): a paste ghost follows the pointer until a click drops it. */
  get carrying(): boolean { return this.act?.carry != null; }
  /** Parts the per-frame pick leaves out (the ones being dragged). */
  excludes(id: number): boolean { return this.act?.s.has(id) ?? false; }
  pose(id: number): MovePose | undefined { return this.act?.s.pose(id); }

  /** Left button down in the Select tool: `hit` = the pick, `locked` = the reason when a locked part is the nearest thing under the pointer. */
  down(x: number, y: number, hit: DragHit | null, locked: string | null, mods: Mods): void {
    this.press = null;
    if (this.host.phase() !== 'build') return;
    if (!locked && !hit?.part) return; // empty space: the camera keeps left-drag
    this.mods = mods;
    this.press = { x, y, id: hit?.part?.id ?? null, point: hit ? [...hit.point] as V3 : null, locked, dead: false };
  }

  move(x: number, y: number, buttons: number, mods: Mods): void {
    const p = this.press;
    if (!p) return;
    this.mods = mods;
    if (!(buttons & 1)) { this.cancel(true); this.press = null; return; } // released outside the canvas
    if (this.act) { if (buttons & 2) this.cancel(); return; } // a right click cancels
    if (p.dead || !pastThreshold(x - p.x, y - p.y)) return;
    this.start(p);
  }

  /** Button up: true when the press was a drag (main.ts then skips its click). */
  up(): boolean {
    if (this.swallowUp) { this.swallowUp = false; this.press = null; return true; }
    const p = this.press;
    this.press = null;
    if (!p) return false;
    if (this.act) { this.drop(); return true; }
    return p.dead;
  }

  private start(p: Press): void {
    const h = this.host;
    const refuse = (why: string): void => { p.dead = true; h.toast(why, 'warn'); h.announce(why, 'assertive'); h.sound('error'); };
    if (p.locked) { refuse(p.locked); return; }
    const doc = h.doc();
    if (!doc || p.id === null) { p.dead = true; return; }
    const set = dragSet(p.id, h.selection(), (id) => doc.parts.has(id));
    const why = moveRefusal(h, set.parts);
    if (why) { refuse(why); return; }
    if (set.reselect) h.selectOnly(p.id);
    let s: MoveSession;
    try { s = new MoveSession(doc, set.parts, set.links, p.id, h.world()); } catch { p.dead = true; return; }
    const a = s.anchor;
    const eulers = new Map<number, Euler>();
    for (const m of s.parts) eulers.set(m.rec.id, eulerOf(m.rec.rot) ?? quatToEuler(rotationToQuat(m.rec.rot) as Q4));
    const ids = s.parts.map((m) => m.rec.id);
    this.act = {
      s, grab: p.point ? [a.from[0] - p.point[0], a.from[2] - p.point[2]] : [0, 0], target: [...a.from] as V3,
      rots: new Map(), eulers, yaw: 0, vert: null, locks: ids, carry: null,
    };
    h.lock(ids);
    h.announce(`Picked up ${s.label}. Shift moves up and down, Escape cancels.`);
  }

  /** Per frame, after main.ts's pick: follow the pointer and refresh the preview. */
  frame(): void {
    const a = this.act;
    if (!a) return;
    if (this.host.phase() !== 'build') { this.cancel(); return; }
    const s = a.s, an = s.anchor, h = this.host;
    const step = snapStep(this.mods);
    const lmin = s.localMinY(an, a.rots.get(an.rec.id) ?? an.rec.rot);
    let target = a.target;
    if (this.mods.shift) {
      const r = h.ray();
      if (r) {
        if (!a.vert) a.vert = { s0: closestOnAxis(r, [a.target[0], 0, a.target[2]], [0, 1, 0]), bottom0: a.target[1] + lmin, x: a.target[0], z: a.target[2] };
        const dy = closestOnAxis(r, [a.vert.x, 0, a.vert.z], [0, 1, 0]) - a.vert.s0;
        target = [a.vert.x, liftBottom(a.vert.bottom0, dy, step, null) - lmin, a.vert.z];
      }
    } else {
      a.vert = null;
      const hit = h.hit();
      if (hit) target = [snap(hit.point[0] + a.grab[0], step), surfaceY(hit, (p) => h.partTop(p)) - lmin, snap(hit.point[2] + a.grab[1], step)];
    }
    const t: V3 = [target[0] - an.from[0], floorClampY(target[1] - an.from[1], s.bottom0, h.floor()), target[2] - an.from[2]];
    a.target = [an.from[0] + t[0], an.from[1] + t[1], an.from[2] + t[2]];
    const xf: MoveXf = { pivot: an.from, t, q: a.yaw ? axisQuat(1, a.yaw) : null, rot: a.rots };
    s.update(xf);
    h.snap?.(s, xf, this.mods); // BUILDUX (D124): port snapping (Alt = off)
  }

  /**
   * BUILDUX (D123): carry a session that isn't tied to a press (a paste ghost): it follows the pointer exactly like a
   * drag (grid, resting surface, work plane, R turns, Shift vertical, red when blocked) until a left click drops it
   * through `commit` (false = refused: the ghost stays), or Esc / a right click / the tool changing cancels it.
   * `centre` is the point the cursor holds (the clip's middle).
   */
  carry(s: MoveSession, commit: (s: MoveSession) => boolean, label: string, centre: V3): void {
    this.cancel(true);
    this.press = null;
    const a = s.anchor;
    const eulers = new Map<number, Euler>();
    for (const m of s.parts) eulers.set(m.rec.id, eulerOf(m.rec.rot) ?? quatToEuler(rotationToQuat(m.rec.rot) as Q4));
    this.act = {
      s, grab: [a.from[0] - centre[0], a.from[2] - centre[2]], target: [...a.from] as V3,
      rots: new Map(), eulers, yaw: 0, vert: null, locks: [], carry: { commit, label },
    };
    this.host.announce(`${label}: click to drop it. R turns it, Escape cancels.`);
  }

  /** BUILDUX: a button pressed while carrying: left drops (when the drop is allowed), right cancels. True = consumed. */
  pressWhileCarrying(button: number): boolean {
    const a = this.act;
    if (!a?.carry) return false;
    this.swallowUp = true;
    if (button === 2) { this.cancel(); return true; }
    if (button !== 0) return true;
    if (a.carry.commit(a.s)) this.act = null;
    return true;
  }

  private drop(): void {
    const a = this.act!;
    this.act = null;
    if (!commitMove(this.host, a.s) && !a.s.changed()) this.host.announce('Put back');
    this.host.unlock(a.locks);
  }

  /** Esc, a right click, the run starting or the tool changing: nothing moves. */
  cancel(silent = false): boolean {
    const a = this.act;
    if (this.press) this.press.dead = true;
    if (!a) return false;
    this.act = null;
    this.host.unlock(a.locks);
    if (!silent) this.host.announce('Move cancelled');
    return true;
  }

  /** Keys while dragging (main.ts asks first). */
  key(e: KeyboardEvent, k: string): boolean {
    const a = this.act;
    if (!a) return false;
    const low = k.length === 1 ? k.toLowerCase() : k;
    if (k === 'Escape') { this.cancel(); e.preventDefault(); return true; }
    if (k === 'PageUp' || k === 'PageDown') { this.lift(k === 'PageUp' ? 1 : -1, e.ctrlKey ? FINE_STEP : GRID_STEP); e.preventDefault(); return true; }
    if ((low === 'r' || low === 't' || low === 'y') && !e.ctrlKey && !e.metaKey && !e.altKey) { this.rotate(low === 'r' ? 1 : low === 't' ? 0 : 2, e.shiftKey ? -1 : 1); e.preventDefault(); return true; }
    if (k === 'Shift' || k === 'Control' || k === 'Alt') return true;
    return false;
  }

  /** Ctrl + wheel while dragging: the work plane (no toast; the badge shows the height). */
  wheel(deltaY: number): boolean {
    if (!this.act) return false;
    this.lift(deltaY < 0 ? 1 : -1, GRID_STEP);
    return true;
  }

  private lift(dir: number, step: number): void {
    const y = Math.max(0, Math.min(20, Math.round((this.host.workY() + dir * step) * 1000) / 1000));
    this.host.setWorkY(y);
  }

  private rotate(axis: 0 | 1 | 2, dir: number): void {
    const a = this.act!;
    const s = a.s;
    if (s.parts.length > 1 && axis !== 1) { this.host.toast('T and Y tilt one part at a time; R turns the whole selection'); return; }
    const deg = 15 * dir;
    if (s.parts.length > 1) a.yaw += deg;
    for (const m of s.parts) {
      const e = a.eulers.get(m.rec.id)!;
      e[EULER_KEY[axis]] += deg;
      a.rots.set(m.rec.id, snappedEuler(e.yaw, e.pitch, e.roll));
    }
    this.host.sound('rotate');
  }

  /** Readout for the tool badge: name and height, or the refusal. */
  badge(): { text: string; blocked: boolean } | null {
    const a = this.act;
    if (!a) return null;
    const why = a.s.refusal();
    if (why) return { text: `Can't drop here: ${why}`, blocked: true };
    const an = a.s.anchor;
    const bottom = a.target[1] + a.s.localMinY(an, a.rots.get(an.rec.id) ?? an.rec.rot);
    const fine = this.mods.alt || this.mods.ctrl;
    const snapped = a.s.portSnap?.snap ? ' · port ⦿' : ''; // BUILDUX (D124)
    return { text: `${a.carry?.label ?? a.s.label} · ${a.vert ? '↕ ' : ''}${Math.max(0, bottom).toFixed(fine ? 2 : 1)} m${snapped}`, blocked: false };
  }

}

/** The tool badge (#toolbadge) during a drag or gizmo gesture: text and the red "blocked" style; restores itself after. */
export class BadgeOverride {
  private saved: string | null = null;
  constructor(private readonly el: HTMLElement | null) {}
  show(b: { text: string; blocked: boolean } | null): void {
    const el = this.el;
    if (!el) return;
    if (!b) {
      if (this.saved !== null) { el.textContent = this.saved; this.saved = null; delete el.dataset.drag; }
      return;
    }
    if (this.saved === null) this.saved = el.textContent ?? '';
    if (el.textContent !== b.text) el.textContent = b.text;
    const state = b.blocked ? 'blocked' : 'ok';
    if (el.dataset.drag !== state) el.dataset.drag = state;
  }
}
