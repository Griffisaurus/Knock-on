// Mirror (stream BUILDUX, D123; GAME_SPEC §7.2 rule 4 "Alt+X/Y/Z mirror").
//
// Alt+X / Alt+Y / Alt+Z mirror the selection across its centre plane (the plane through the middle of the selection's
// bounds, at a right angle to world X, Y or Z, snapped to half a grid step so grid-placed parts stay on the grid).
//
// There are no mirrored part variants (PartFlag.MirrorX/Y/Z are reserved, and neither the sim nor the renderer reads
// them), so a part can only become its own mirror image when its shape has a mirror plane of its own. If part-local plane
// b (x = 0, y = 0 or z = 0) is one, the mirror image of the part is the SAME part turned by R' = M_a · R · M_b (M = the
// reflection matrices; R' is a proper rotation because two reflections make one), placed at the mirrored origin. That's
// exact: its colliders, joints, ports and blockout look are where the mirror image's would be.
//
// A part's mirror planes are found from its definition (`partSymmetry`): every collider and blockout visual, its hinge
// or slider (axis and limits), its centre of mass and its ports must map onto themselves. Planes y = 0 and z = 0 are only
// used for parts whose behaviour has no front or top (rigid bodies, sensors, timers…): a fan, a beam or a critter
// mirrored through its own front would face backwards. Ports that swap places are re-indexed so links stay on the
// mirrored spot; MOTOR's CW / CCW flips when its spin sense does; GRABBER's zone yaws and DUSTY's patrol offset mirror.
//
// A part with no usable mirror plane (an asymmetric part: no mirrored variant) keeps its rotation, only its origin is
// mirrored, and the readout names it ("GRABBER kept its turn"). Links whose two ends are mirrored take their waypoints
// along. The result is checked like a drop (blocked by a part outside the selection = refused) and lands as ONE op.

import type { WorldDoc } from '@knockon/docstore';
import { metresToPos, posToMetres, snappedEuler, type LinkEnd, type LinkRecord, type Op, type PartRecord, type PropList } from '@knockon/format';
import { propSteps, propValues, type PartDef, type Props, type ShapeDef, type VisualDef } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qmul, qrot, type Q4 } from '../catalog.ts';
import type { V3 } from '../math.ts';
import { boxesOverlap, overlapOf, partBox, partName, quatToEuler, unionBox, worldBox, type Box } from './dragmove.ts';

export type Axis = 0 | 1 | 2;
export const AXIS_NAME = ['X', 'Y', 'Z'] as const;

// ---- 3 × 3 maths (row-major) -----------------------------------------------------------------------------------------

export function quatToMat(q: Q4): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

export function matToQuat(m: readonly number[]): Q4 {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m as [number, number, number, number, number, number, number, number, number];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  return w < 0 ? [-x / l, -y / l, -z / l, -w / l] : [x / l, y / l, z / l, w / l];
}

/** M_a · R · M_b as a quaternion: the turn that makes a part with mirror plane b (local) the mirror image across world plane a. */
export function mirroredQuat(q: Q4, a: Axis, b: Axis): Q4 {
  const r = quatToMat(q);
  const out = r.map((v, k) => v * (Math.floor(k / 3) === a ? -1 : 1) * (k % 3 === b ? -1 : 1));
  return matToQuat(out);
}

/** A point reflected through local plane b (x = 0 / y = 0 / z = 0). */
export const reflect = (p: readonly number[], b: Axis): V3 => [b === 0 ? -p[0]! : p[0]!, b === 1 ? -p[1]! : p[1]!, b === 2 ? -p[2]! : p[2]!];

// ---- a part's own mirror planes ---------------------------------------------------------------------------------------

/** A collider, visual or joint as a point plus unsigned directions with their extents, for the symmetry test. */
interface Feature { readonly key: string; readonly c: V3; readonly dirs: readonly { readonly v: V3; readonly len: number }[] }

const H = Math.SQRT1_2;
/** A shape's local turn, as the sim builds it (machine.ts shapeFor): axis (Y → X / Z), then tiltZ, then rot. */
function shapeQuat(s: { readonly axis?: 'x' | 'y' | 'z'; readonly tiltZ?: number; readonly rot?: readonly number[] }): Q4 {
  let q: Q4 = s.axis === 'x' ? [0, 0, -H, H] : s.axis === 'z' ? [H, 0, 0, H] : [0, 0, 0, 1];
  if (s.tiltZ) { const h = (s.tiltZ * Math.PI) / 360; q = qmul([0, 0, Math.sin(h), Math.cos(h)], q); }
  if (s.rot) q = qmul(s.rot as unknown as Q4, q);
  return q;
}

const r4 = (v: number): string => (Math.round(v * 1e4) / 1e4).toFixed(4);

function feature(kind: string, size: readonly number[], at: readonly number[] | undefined, q: Q4, extra: string): Feature {
  const c: V3 = [at?.[0] ?? 0, at?.[1] ?? 0, at?.[2] ?? 0];
  if (kind === 'sphere') return { key: `sphere:${r4(size[0]!)}:${extra}`, c, dirs: [] };
  if (kind === 'cylinder' || kind === 'capsule') return { key: `${kind}:${r4(size[0]!)}:${r4(size[1]!)}:${extra}`, c, dirs: [{ v: qrot(q, [0, 1, 0]) as V3, len: size[1]! }] };
  return { key: `box:${extra}`, c, dirs: [0, 1, 2].map((i) => ({ v: qrot(q, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]) as V3, len: size[i]! })) };
}

const near3 = (a: readonly number[], b: readonly number[], eps = 1e-4): boolean => Math.abs(a[0]! - b[0]!) < eps && Math.abs(a[1]! - b[1]!) < eps && Math.abs(a[2]! - b[2]!) < eps;
const parallel = (a: readonly number[], b: readonly number[]): boolean => Math.abs(Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) - 1) < 1e-4;

/** Does every feature reflected through plane b land on a feature of the set? */
function setSymmetric(fs: readonly Feature[], b: Axis): boolean {
  for (const f of fs) {
    const c = reflect(f.c, b);
    const dirs = f.dirs.map((d) => ({ v: reflect(d.v, b), len: d.len }));
    const ok = fs.some((g) => {
      if (g.key !== f.key || !near3(g.c, c) || g.dirs.length !== dirs.length) return false;
      const used = new Set<number>();
      return dirs.every((d) => {
        const j = g.dirs.findIndex((e, k) => !used.has(k) && Math.abs(e.len - d.len) < 1e-4 && parallel(e.v, d.v));
        if (j < 0) return false;
        used.add(j);
        return true;
      });
    });
    if (!ok) return false;
  }
  return true;
}

/**
 * Behaviours with no front or top beyond their geometry: such a part may also mirror through its own y = 0 or z = 0
 * plane. Everything else (fans, beams, launchers, fields, critters…) only through x = 0, which keeps its front and top.
 */
const FRONTLESS = new Set([
  'rigid_basic', 'helio', 'breakable', 'flammable', 'explosive', 'container', 'sensor_pulse', 'power_source', 'power_switch', 'heat_source',
  'timer', 'wireless_pair', 'music_note', 'sink', 'buoyant', 'hinge_passive', 'rotator_driven', 'power_consumer',
]);
export const frontless = (def: PartDef): boolean => def.behaviours.every((b) => FRONTLESS.has(b));

export interface Symmetry {
  /** Local planes (0 = x, 1 = y, 2 = z) the part is its own mirror image through, in the order they may be used. */
  readonly planes: readonly Axis[];
  /** Port index permutation per plane: port i lands where port perm[b][i] is. */
  readonly perm: Readonly<Partial<Record<Axis, readonly number[]>>>;
  /** Does the hinge's spin sense flip under plane b (MOTOR's CW / CCW)? */
  readonly spinFlip: Readonly<Partial<Record<Axis, boolean>>>;
}

/** Parts whose part-frame props the mirror rewrites (only planes they can use): b → the props to negate. */
const PROP_MIRROR: Readonly<Record<string, Partial<Record<Axis, readonly string[]>>>> = {
  grabber: { 0: ['aYaw', 'bYaw'] }, // zone yaw: degrees about +Y from the front (+Z)
  dusty: { 0: ['zone_x'], 2: ['zone_z'] }, // patrol-zone centre, in the part's frame
};

const symCache = new Map<string, Symmetry>();

/** A part's mirror planes (and port re-indexing) for its props. Cached per type + props. */
export function partSymmetry(def: PartDef, props: Props): Symmetry {
  const key = `${def.type}:${JSON.stringify(props)}`;
  const hit = symCache.get(key);
  if (hit) return hit;
  const fs: Feature[] = [];
  const addShape = (s: ShapeDef, tag: string): void => { fs.push(feature(s.kind, s.size, s.at, shapeQuat(s), `${tag}:${s.on ?? 'base'}`)); };
  for (const s of def.shapes(props)) addShape(s, 'col');
  for (const s of def.piece?.shapes ?? []) addShape(s, 'piece');
  for (const v of def.visuals(props) as readonly VisualDef[]) fs.push(feature(v.mesh, v.size, v.at, shapeQuat(v), `vis:${v.color}:${v.when ?? ''}:${v.on ?? 'base'}:${v.emissive ?? 0}`));
  const planes: Axis[] = [];
  const perm: Partial<Record<Axis, number[]>> = {};
  const spinFlip: Partial<Record<Axis, boolean>> = {};
  const allowed: Axis[] = frontless(def) ? [0, 1, 2] : [0];
  for (const b of allowed) {
    if (!setSymmetric(fs, b)) continue;
    if (def.body.com && !near3(reflect(def.body.com, b), def.body.com)) continue;
    // joints: the pivot stays put and the axis stays on its line; a sense that flips needs symmetric limits
    let flip = false, ok = true;
    for (const j of [def.hinge, def.slider]) {
      if (!j) continue;
      const l = Math.hypot(j.axis[0], j.axis[1], j.axis[2]) || 1;
      const ax: V3 = [j.axis[0] / l, j.axis[1] / l, j.axis[2] / l];
      if (!near3(reflect(j.at, b), j.at) || !parallel(reflect(ax, b), ax)) { ok = false; break; }
      const along = Math.abs(ax[b]) > 1 - 1e-4, inPlane = Math.abs(ax[b]) < 1e-4;
      if (!along && !inPlane) { ok = false; break; }
      // a hinge turns the other way when its axis lies in the mirror plane; a slider runs the other way when it's along the normal
      const reversed = j === def.hinge ? inPlane : along;
      const lim = j.limits;
      if (reversed && lim && Math.abs(lim[0] + lim[1]) > 1e-6) { ok = false; break; }
      if (j === def.hinge && reversed) flip = true;
    }
    if (!ok) continue;
    // ports map onto ports of the same kind
    const pm: number[] = [];
    for (const port of def.ports) {
      const at = reflect(port.at, b);
      const j = def.ports.findIndex((q) => q.channel === port.channel && q.dir === port.dir && (q.kind ?? '') === (port.kind ?? '') && (q.on ?? 'base') === (port.on ?? 'base')
        && (q.maxLinks ?? 1) === (port.maxLinks ?? 1) && !!q.broadcast === !!port.broadcast && near3(q.at, at));
      if (j < 0) { ok = false; break; }
      pm.push(j);
    }
    if (!ok) continue;
    planes.push(b);
    perm[b] = pm;
    spinFlip[b] = flip;
  }
  const sym: Symmetry = { planes, perm, spinFlip };
  symCache.set(key, sym);
  return sym;
}

/** The local plane to mirror through for world plane `a`: the usable plane whose axis lies closest to world axis a (x first on ties). */
export function mirrorPlane(q: Q4, a: Axis, sym: Symmetry): Axis | null {
  let best: Axis | null = null, score = -1;
  for (const b of sym.planes) {
    const e = qrot(q, [b === 0 ? 1 : 0, b === 1 ? 1 : 0, b === 2 ? 1 : 0]);
    const s = Math.abs(e[a]!);
    if (s > score + 1e-6) { score = s; best = b; }
  }
  return best;
}

/** Stored props with some values replaced (others untouched). */
export function propsWith(def: PartDef, stored: PropList | undefined, values: Readonly<Record<string, number>>): PropList {
  const m = new Map<number, number>((stored ?? []).map(([i, s]) => [i, s]));
  for (const [k, v] of Object.entries(values)) { const [i, s] = propSteps(def, k, v); m.set(i, s); }
  return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([i, s]) => [i, s] as [number, number]);
}

/** The props a part takes when mirrored through local plane b (MOTOR's direction, GRABBER's yaws, DUSTY's zone), or null. */
export function mirroredProps(def: PartDef, props: Props, b: Axis, sym: Symmetry): Record<string, number> | null {
  const out: Record<string, number> = {};
  if (sym.spinFlip[b] && def.props.direction?.values?.length === 2 && def.props.direction.values.includes('CW')) out.direction = 1 - Math.round(props.direction ?? 0);
  for (const k of PROP_MIRROR[def.type]?.[b] ?? []) if (k in def.props) out[k] = -(props[k] ?? 0);
  return Object.keys(out).length ? out : null;
}

// ---- the selection --------------------------------------------------------------------------------------------------

export interface MirrorResult {
  readonly op: Op | null;
  /** Parts turned into their mirror image. */
  readonly mirrored: number;
  /** Parts with no mirror image: only their origin moved. */
  readonly kept: readonly PartRecord[];
  /** Why the mirror is refused (it would overlap a part outside the selection, or leave the floor), or null. */
  readonly refusal: string | null;
}

/** Half a grid step in position units: the mirror plane snaps to it, so parts on the grid land on the grid. */
const PLANE_STEP = metresToPos(0.05);

/** Mirror the selected parts (and their links) across the plane through their bounds' middle, normal to world axis `a`. */
export function mirrorSelection(doc: WorldDoc, ids: readonly number[], a: Axis, floor: number | null = 0): MirrorResult {
  const sel = new Set(ids);
  const parts = ids.map((id) => doc.parts.get(id)).filter((p): p is PartRecord => !!p && !!partDef(p.type));
  if (!parts.length) return { op: null, mirrored: 0, kept: [], refusal: null };
  const boxes0 = parts.map((p) => partBox(p)!);
  const u0 = unionBox(boxes0)!;
  const mid = metresToPos((u0.min[a] + u0.max[a]) / 2);
  const plane2 = 2 * Math.round(mid / PLANE_STEP) * PLANE_STEP; // 2c in position units
  const ops: Op[] = [];
  const kept: PartRecord[] = [];
  const portMap = new Map<number, readonly number[]>();
  const newBoxes: { p: PartRecord; box: Box }[] = [];
  let mirrored = 0;
  for (const p of parts) {
    const def = partDef(p.type)!;
    const props = propValues(def, p.props);
    const q = rotationToQuat(p.rot) as Q4;
    const sym = partSymmetry(def, props);
    const b = mirrorPlane(q, a, sym);
    const pos: [number, number, number] = [p.pos[0], p.pos[1], p.pos[2]];
    pos[a] = plane2 - p.pos[a];
    const patch: { pos: [number, number, number]; rot?: PartRecord['rot']; props?: PropList } = { pos };
    let nq = q, nprops = props;
    if (b === null) kept.push(p);
    else {
      mirrored++;
      nq = mirroredQuat(q, a, b);
      const e = quatToEuler(nq);
      patch.rot = snappedEuler(e.yaw, e.pitch, e.roll);
      nq = rotationToQuat(patch.rot) as Q4;
      const mp = mirroredProps(def, props, b, sym);
      if (mp) { patch.props = propsWith(def, p.props, mp); nprops = { ...props, ...mp }; }
      const perm = sym.perm[b];
      if (perm && perm.some((j, i) => j !== i)) portMap.set(p.id, perm);
    }
    ops.push({ k: 'PartUpdate', id: p.id, patch });
    newBoxes.push({ p, box: worldBox(def, nprops, { pos: [posToMetres(pos[0]), posToMetres(pos[1]), posToMetres(pos[2])], rot: nq }) });
  }
  // links: waypoints of links inside the selection mirror; ends on re-indexed ports follow the port
  const end = (e: LinkEnd | null): LinkEnd | null => (e && portMap.has(e.part) ? { part: e.part, port: portMap.get(e.part)![e.port] ?? e.port } : e);
  for (const l of doc.links.values()) {
    const touches = (l.from && sel.has(l.from.part)) || (l.to && sel.has(l.to.part));
    const inside = l.from || l.to
      ? (!l.from || sel.has(l.from.part)) && (!l.to || sel.has(l.to.part)) && l.via.every((v) => sel.has(v))
      : sel.has(l.id);
    if (!touches && !inside) continue;
    const patch: { from?: LinkEnd | null; to?: LinkEnd | null; points?: LinkRecord['points'] } = {};
    const f = end(l.from), t = end(l.to);
    if (f !== l.from) patch.from = f;
    if (t !== l.to) patch.to = t;
    if (inside && l.points.length) patch.points = l.points.map((q) => { const n: [number, number, number] = [q[0], q[1], q[2]]; n[a] = plane2 - q[a]; return n; });
    if (Object.keys(patch).length) ops.push({ k: 'LinkUpdate', id: l.id, patch });
  }
  // checked like a drop: no overlap with parts outside the selection, not through the floor
  let refusal: string | null = null;
  const low0 = boxes0.reduce((m, x) => Math.min(m, x.min[1]), Infinity);
  if (floor !== null && newBoxes.some((n) => n.box.min[1] < Math.min(low0, floor) - 0.001)) refusal = 'it would go through the floor';
  if (!refusal) {
    const u = unionBox(newBoxes.map((n) => n.box))!;
    const others: { p: PartRecord; box: Box }[] = [];
    for (const o of doc.parts.values()) { if (sel.has(o.id)) continue; const bx = partBox(o); if (bx && boxesOverlap(u, bx)) others.push({ p: o, box: bx }); }
    for (const n of newBoxes) { const hit = overlapOf(n.box, others, (o) => o.box); if (hit) { refusal = `${partName(n.p.type)} would overlap ${partName(hit.p.type)}`; break; } }
  }
  return { op: ops.length === 1 ? ops[0]! : { k: 'Batch', ops }, mirrored, kept, refusal };
}
