// Stream DRAG (D117): the pure parts of drag-to-move and the transform gizmo: the drag threshold vs a click, what a drag
// moves, multi-selection offsets, grid snapping with Alt, vertical-only lifting, the blocked and bounds refusals, links
// following, one drag = one undo step, locked refusals, rotations through the R / T / Y maths; and for the gizmo: handle
// hit-testing, constant screen size, axis / plane / ring drag maths with snapping, corner-cube resize clamping and the
// axis colours under each colour preset.

import { describe, expect, it } from 'vitest';
import { DocStore, tryApply, WorldDoc } from '@knockon/docstore';
import { makeId, metresToPos, PartFlag, posToMetres, snappedEuler, type LinkRecord, type Op, type PartRecord } from '@knockon/format';
import { propValues } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qrot, type Q4 } from '../src/catalog.ts';
import {
  boxesOverlap, dragSet, DRAG_THRESHOLD_PX, eulerOf, floorClampY, liftBottom, moveRefusal, MoveSession, overlapOf, partBox, pastThreshold,
  quatToEuler, snap, snapStep, surfaceY, turned, axisQuat, type MoveXf,
} from '../src/ui/dragmove.ts';
import {
  axisDelta, boxCorners, cornerResize, GIZMO_AXIS_HEX, GZ, hitGizmo, metresPerPixel, planeDelta, ringDegrees, ringTangent, snapAngle,
  type GizmoGeom, type Project,
} from '../src/ui/gizmo.ts';
import { lockedReason } from '../src/ui/organise.ts';
import { closestPair, type Cvd } from '../src/ui/cvd.ts';
import type { V3 } from '../src/math.ts';

const id = (n: number): number => makeId(1, n);
const at = (m: V3): [number, number, number] => [metresToPos(m[0]), metresToPos(m[1]), metresToPos(m[2])];
const part = (n: number, type: string, pos: V3, extra: Partial<PartRecord> = {}): PartRecord => ({ id: id(n), type, pos: at(pos), rot: { tag: 0 }, flags: 0, ...extra });
function world(parts: PartRecord[], links: LinkRecord[] = []): WorldDoc {
  const d = new WorldDoc();
  for (const p of parts) expect(tryApply(d, { k: 'PartAdd', part: p }).ok).toBe(true);
  for (const l of links) expect(tryApply(d, { k: 'LinkAdd', link: l }).ok).toBe(true);
  return d;
}
const shift = (pivot: V3, t: V3): MoveXf => ({ pivot, t, q: null, rot: new Map() });
const metres = (p: PartRecord): V3 => [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];

describe('drag threshold vs click', () => {
  it('a press becomes a drag at 4 px, a smaller wobble stays a click', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    expect(pastThreshold(3, 0)).toBe(false);
    expect(pastThreshold(2, 2)).toBe(false);
    expect(pastThreshold(4, 0)).toBe(true);
    expect(pastThreshold(0, -4)).toBe(true);
    expect(pastThreshold(2.9, 2.9)).toBe(true);
  });
});

describe('what a drag moves', () => {
  it('the whole selection when the pressed part is in it, else that part alone (reselected)', () => {
    const isPart = (n: number): boolean => n < 100;
    expect(dragSet(2, [1, 2, 3, 150], isPart)).toEqual({ parts: [1, 2, 3], links: [150], reselect: false });
    expect(dragSet(7, [1, 2, 3], isPart)).toEqual({ parts: [7], links: [], reselect: true });
    expect(dragSet(7, [], isPart)).toEqual({ parts: [7], links: [], reselect: true });
  });
});

describe('grid snapping (the function placement, drag and gizmo share)', () => {
  it('10 cm, Ctrl = 2.5 cm, Alt = free', () => {
    expect(snapStep({ ctrl: false, alt: false })).toBe(0.1);
    expect(snapStep({ ctrl: true, alt: false })).toBe(0.025);
    expect(snapStep({ ctrl: true, alt: true })).toBe(0);
    expect(snap(0.123, 0.1)).toBeCloseTo(0.1, 9);
    expect(snap(0.123, 0.025)).toBeCloseTo(0.125, 9);
    expect(snap(0.123, 0)).toBe(0.123);
    expect(snap(-0.26, 0.1)).toBeCloseTo(-0.3, 9);
  });
});

describe('multi-selection offsets', () => {
  it('a shift moves every part by the same exact delta (offsets kept to the position unit)', () => {
    const ps = [part(1, 'thud', [0.1, 0, 0.2]), part(2, 'plank', [0.537, 0.3, -0.41]), part(3, 'anchor', [-1.03, 1.2, 0.77])];
    const d = world(ps);
    const s = new MoveSession(d, ps.map((p) => p.id), [], ps[1]!.id, null);
    expect(s.anchor.rec.id).toBe(ps[1]!.id);
    s.update(shift(s.anchor.from, [0.3, 0.1, -0.2]));
    const op = s.op(d)!;
    expect(op.k).toBe('Batch');
    const after = new Map<number, [number, number, number]>();
    for (const o of (op as Extract<Op, { k: 'Batch' }>).ops) if (o.k === 'PartUpdate' && o.patch.pos) after.set(o.id, [...o.patch.pos] as [number, number, number]);
    const delta = [metresToPos(0.3), metresToPos(0.1), metresToPos(-0.2)];
    for (const p of ps) expect(after.get(p.id)).toEqual([p.pos[0] + delta[0]!, p.pos[1] + delta[1]!, p.pos[2] + delta[2]!]);
  });
  it('R turns the selection about the grabbed part: offsets rotate and every part yaws by the same angle', () => {
    const ps = [part(1, 'thud', [0, 0, 0]), part(2, 'thud', [1, 0, 0])];
    const d = world(ps);
    const s = new MoveSession(d, ps.map((p) => p.id), [], ps[0]!.id, null);
    const rot = new Map(ps.map((p) => [p.id, turned(p.rot, 1, 90, 'world')]));
    s.update({ pivot: s.anchor.from, t: [0, 0, 0], q: axisQuat(1, 90), rot });
    const p2 = s.pose(ps[1]!.id)!;
    expect(p2.pos[0]).toBeCloseTo(0, 6);
    expect(p2.pos[2]).toBeCloseTo(-1, 6); // +X turned 90° about +Y (right-handed) is −Z
    expect(eulerOf(p2.rotation)).toEqual({ yaw: 90, pitch: 0, roll: 0 });
    expect(s.pose(ps[0]!.id)!.pos).toEqual([0, 0, 0]);
  });
});

describe('vertical-only drag and the floor', () => {
  it('lifts by the pointer travel, snapped, and never below the floor', () => {
    expect(liftBottom(0.5, 0.73, 0.1, 0)).toBeCloseTo(1.2, 9);
    expect(liftBottom(0.5, 0.73, 0, 0)).toBeCloseTo(1.23, 9); // Alt: free
    expect(liftBottom(0.5, -2, 0.1, 0)).toBe(0);
    expect(liftBottom(0.5, -2, 0.1, null)).toBeCloseTo(-1.5, 9); // terrain: no flat floor
    expect(floorClampY(-1, 0.4, 0)).toBeCloseTo(-0.4, 9);
    expect(floorClampY(-1, -0.2, 0)).toBe(0); // already below: may not sink further, may rise
    expect(floorClampY(0.5, 0.4, 0)).toBe(0.5);
  });
  it('rests on the hit surface: a part top, the top of a part hit on its side, or the floor / work plane', () => {
    const p = part(1, 'plank', [0, 0.05, 0]);
    expect(surfaceY({ point: [0, 0.1, 0], part: p, normal: [0, 1, 0] }, () => 0.1)).toBe(0.1);
    expect(surfaceY({ point: [0.05, 0.04, 0], part: p, normal: [1, 0, 0] }, () => 0.1)).toBe(0.1);
    expect(surfaceY({ point: [2, 2.5, 0], part: null, normal: [0, 1, 0] }, () => 0)).toBe(2.5); // a raised work plane counts
  });
});

describe('blocked and outside the world', () => {
  it('overlap uses a 1 mm tolerance: touching is fine', () => {
    const a = { min: [0, 0, 0] as V3, max: [1, 1, 1] as V3 };
    expect(boxesOverlap(a, { min: [1, 0, 0], max: [2, 1, 1] })).toBe(false);
    expect(boxesOverlap(a, { min: [0.9, 0, 0], max: [2, 1, 1] })).toBe(true);
    expect(overlapOf(a, [{ min: [1, 0, 0] as V3, max: [2, 1, 1] as V3 }, { min: [0.5, 0.5, 0.5] as V3, max: [3, 3, 3] as V3 }], (b) => b)).toEqual({ min: [0.5, 0.5, 0.5], max: [3, 3, 3] });
  });
  it('a drop onto another part is refused with its name; a drop outside the preset is refused too', () => {
    const ps = [part(1, 'thud', [0, 0.11, 0]), part(2, 'plank', [1, 0.05, 0])];
    const d = world(ps);
    const s = new MoveSession(d, [ps[0]!.id], [], ps[0]!.id, { min: [-8, 0, -8], max: [8, 8, 8], label: 'Room (16 × 16 m)' });
    s.update(shift(s.anchor.from, [0.5, 0, 0]));
    expect(s.refusal()).toBeNull();
    s.update(shift(s.anchor.from, [1, 0, 0]));
    expect(s.refusal()).toBe('overlaps PLANK');
    s.update(shift(s.anchor.from, [9, 0, 0]));
    expect(s.refusal()).toBe('outside the Room (16 × 16 m)');
  });
  it('the moved parts never block each other', () => {
    const ps = [part(1, 'thud', [0, 0.11, 0]), part(2, 'thud', [0.15, 0.11, 0])];
    const d = world(ps);
    const s = new MoveSession(d, ps.map((p) => p.id), [], ps[0]!.id, null);
    s.update(shift(s.anchor.from, [0.05, 0, 0]));
    expect(s.blocked).toBeNull();
  });
});

describe('links follow', () => {
  it('waypoints move when both ends move; a link with one moving end keeps them; selected path links move', () => {
    const ps = [part(1, 'the_button', [0, 0, 0]), part(2, 'lamp', [1, 0, 0]), part(3, 'lamp', [3, 0, 0])];
    const both: LinkRecord = { id: id(10), kind: 'cable_signal', from: { part: ps[0]!.id, port: 0 }, to: { part: ps[1]!.id, port: 0 }, via: [], points: [at([0.5, 0.2, 0])], length: 0 };
    const one: LinkRecord = { id: id(11), kind: 'cable_signal', from: { part: ps[0]!.id, port: 0 }, to: { part: ps[2]!.id, port: 0 }, via: [], points: [at([1.5, 0.2, 0])], length: 0 };
    const tube: LinkRecord = { id: id(12), kind: 'tube', from: null, to: null, via: [], points: [at([0, 1, 0]), at([1, 1, 0])], length: 0 };
    const d = world(ps, [both, one, tube]);
    const s = new MoveSession(d, [ps[0]!.id, ps[1]!.id], [tube.id], ps[0]!.id, null);
    s.update(shift(s.anchor.from, [0, 0, 0.5]));
    const ops = (s.op(d) as Extract<Op, { k: 'Batch' }>).ops;
    const lu = new Map(ops.filter((o): o is Extract<Op, { k: 'LinkUpdate' }> => o.k === 'LinkUpdate').map((o) => [o.id, o.patch.points!]));
    expect(lu.get(both.id)).toEqual([[both.points[0]![0], both.points[0]![1], both.points[0]![2] + metresToPos(0.5)]]);
    expect(lu.has(one.id)).toBe(false);
    expect(lu.get(tube.id)!.map((q) => q[2])).toEqual([metresToPos(0.5), metresToPos(0.5)]);
  });
});

describe('one drag = one undo step', () => {
  it('the drop is one op; Ctrl+Z restores every moved part and waypoint', () => {
    const ps = [part(1, 'the_button', [0, 0, 0]), part(2, 'lamp', [1, 0, 0]), part(3, 'thud', [2, 0.11, 0])];
    const l: LinkRecord = { id: id(10), kind: 'cable_signal', from: { part: ps[0]!.id, port: 0 }, to: { part: ps[1]!.id, port: 0 }, via: [], points: [at([0.5, 0.2, 0])], length: 0 };
    const store = new DocStore(1, world(ps, [l]));
    const before = JSON.stringify([...store.doc.parts.values(), ...store.doc.links.values()]);
    const s = new MoveSession(store.doc, ps.map((p) => p.id), [], ps[2]!.id, null);
    s.update(shift(s.anchor.from, [-0.4, 0.3, 1.1]));
    const r = store.applyLocal(s.op(store.doc)!);
    expect('error' in r).toBe(false);
    expect(metres(store.doc.parts.get(ps[2]!.id)!)[2]).toBeCloseTo(1.1, 2);
    expect(store.undo().ok).toBe(true);
    expect(JSON.stringify([...store.doc.parts.values(), ...store.doc.links.values()])).toBe(before);
    expect(store.undo().ok).toBe(false); // it was a single step
  });
  it('no movement, no op', () => {
    const ps = [part(1, 'thud', [0, 0.11, 0])];
    const d = world(ps);
    const s = new MoveSession(d, [ps[0]!.id], [], null, null);
    expect(s.changed()).toBe(false);
    expect(s.op(d)).toBeNull();
  });
});

describe('locked refusal', () => {
  it('locked parts, parts in locked layers and parts the partner holds can’t be moved; nothing moves during a run', () => {
    const ps = [part(1, 'thud', [0, 0.11, 0], { flags: PartFlag.Locked }), part(2, 'thud', [1, 0.11, 0], { layer: 5 }), part(3, 'plank', [2, 0.05, 0])];
    const d = world(ps);
    expect(tryApply(d, { k: 'LayerSet', id: 5, name: 'Rig', flags: 2 }).ok).toBe(true);
    let phase = 'build';
    const host = { doc: () => d, phase: () => phase, lockedReason: (p: PartRecord) => lockedReason(d, p), heldBy: (n: number) => (n === ps[2]!.id ? 'Sam' : null) };
    expect(moveRefusal(host, [ps[0]!.id])).toBe('That part is locked (unlock it in the Outliner)');
    expect(moveRefusal(host, [ps[1]!.id])).toBe('Layer “Rig” is locked');
    expect(moveRefusal(host, [ps[2]!.id])).toBe('Sam is holding PLANK');
    phase = 'running';
    expect(moveRefusal(host, [ps[2]!.id])).toBe('Stop the run to move parts');
  });
});

describe('rotations (the R / T / Y maths)', () => {
  it('quatToEuler reads back rotationToQuat (yaw · pitch · roll)', () => {
    for (const [y, p, r] of [[0, 0, 0], [30, 0, 0], [45, 15, -30], [-120, 60, 75], [90, -45, 10]] as const) {
      const e = quatToEuler(rotationToQuat(snappedEuler(y, p, r)) as Q4);
      expect(e.yaw).toBeCloseTo(y, 6); expect(e.pitch).toBeCloseTo(p, 6); expect(e.roll).toBeCloseTo(r, 6);
    }
  });
  it('gimbal turns edit one Euler angle, exactly like R / T / Y; a world yaw is the same as R', () => {
    const r0 = snappedEuler(30, 15, 0);
    expect(eulerOf(turned(r0, 1, 15, 'gimbal'))).toEqual({ yaw: 45, pitch: 15, roll: 0 });
    expect(eulerOf(turned(r0, 0, -15, 'gimbal'))).toEqual({ yaw: 30, pitch: 0, roll: 0 });
    expect(eulerOf(turned(r0, 2, 45, 'gimbal'))).toEqual({ yaw: 30, pitch: 15, roll: 45 });
    expect(turned(r0, 1, 45, 'world')).toEqual(turned(r0, 1, 45, 'gimbal'));
  });
  it('a world pitch of an unturned part is a pitch; of a yawed part, a real world-X turn', () => {
    expect(eulerOf(turned({ tag: 0 }, 0, 30, 'world'))).toEqual({ yaw: 0, pitch: 30, roll: 0 });
    const r = turned(snappedEuler(90, 0, 0), 0, 90, 'world');
    const q = rotationToQuat(r) as Q4;
    const z = qrot(q, [0, 0, 1]); // local +Z: yaw 90 sends it to +X; a world-X turn leaves +X where it is
    expect(z[0]).toBeCloseTo(1, 2);
    const x = qrot(q, [1, 0, 0]); // local +X: yaw 90 sends it to −Z; world X +90 turns −Z to +Y
    expect(x[1]).toBeCloseTo(1, 2);
  });
});

// ---- gizmo ---------------------------------------------------------------------------------------------------------

/** A camera at the origin looking down −Z (pinhole, focal length F px, 1000 × 800 canvas). */
const F = 800, W = 1000, H = 800;
const pinhole: Project = (p) => (p[2]! >= 0 ? null : [W / 2 + (F * p[0]!) / -p[2]!, H / 2 - (F * p[1]!) / -p[2]!]);
const rayThrough = (sx: number, sy: number): { o: V3; d: V3 } => ({ o: [0, 0, 0], d: [(sx - W / 2) / F, -(sy - H / 2) / F, -1] });
const geom = (c: V3, extra: Partial<GizmoGeom> = {}): GizmoGeom => ({
  c, mpp: metresPerPixel(pinhole, c, [1, 0, 0]), ringAxes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], planeSign: [1, 1, 1], corners: null, view: [0, 0, -1], ...extra,
});

describe('gizmo: constant screen size', () => {
  it('metres per pixel grows with distance so handles keep their pixel size', () => {
    for (const z of [-2, -5, -40]) {
      const g = geom([0.3, -0.2, z]);
      expect(g.mpp).toBeCloseTo(-z / F, 9);
      const c = pinhole(g.c)!, tip = pinhole([g.c[0] + GZ.tip * g.mpp, g.c[1], g.c[2]])!;
      expect(tip[0] - c[0]).toBeCloseTo(GZ.tip, 6);
    }
    expect(metresPerPixel(pinhole, [0, 0, 1], [1, 0, 0])).toBe(0); // behind the camera
  });
});

describe('gizmo: handle hit-testing', () => {
  const g = geom([0, 0, -5]);
  const c = pinhole(g.c)!;
  it('arrows, plane squares and rings under the pointer', () => {
    expect(hitGizmo(g, pinhole, [c[0] + 60, c[1] + 3])).toEqual({ kind: 'axis', axis: 0 });
    expect(hitGizmo(g, pinhole, [c[0] - 4, c[1] - 70])).toEqual({ kind: 'axis', axis: 1 });
    expect(hitGizmo(g, pinhole, [c[0] + 40, c[1] - 40])).toEqual({ kind: 'plane', axis: 2 }); // the XY square (normal Z)
    const r = GZ.ring;
    expect(hitGizmo(g, pinhole, [c[0] + r * Math.SQRT1_2, c[1] - r * Math.SQRT1_2 + 4])).toEqual({ kind: 'ring', axis: 2 });
    expect(hitGizmo(g, pinhole, [c[0] - 200, c[1] + 200])).toBeNull();
    expect(hitGizmo(g, pinhole, [c[0] + 60, c[1] + 20])).toBeNull(); // beyond the arrow's 11 px
    // the X and Y rings are edge-on from this camera (lines through the centre): they don't take presses on the part
    expect(hitGizmo(g, pinhole, [c[0] + 1, c[1] + 4])).toBeNull();
  });
  it('corner cubes win over the other handles near them', () => {
    const corner: V3 = [g.c[0] + 60 * g.mpp, g.c[1], g.c[2]]; // right on the X arrow
    expect(hitGizmo({ ...g, corners: [corner] }, pinhole, [c[0] + 61, c[1]])).toEqual({ kind: 'corner', corner: 0 });
  });
});

describe('gizmo: drag maths', () => {
  it('a ray pair projected onto an axis gives the travel along it', () => {
    const c: V3 = [0, -1, -5];
    const s0 = pinhole(c)!, s1 = pinhole([0.5, -1, -5])!;
    expect(axisDelta(rayThrough(s0[0], s0[1]), rayThrough(s1[0], s1[1]), c, [1, 0, 0])).toBeCloseTo(0.5, 6);
    // a pointer that wanders off the axis mostly counts its travel along it (the closest point to a skew ray)
    const s2 = pinhole([0.5, -0.7, -5])!;
    expect(axisDelta(rayThrough(s0[0], s0[1]), rayThrough(s2[0], s2[1]), c, [1, 0, 0])).toBeCloseTo(0.5, 1);
  });
  it('a ray pair on a plane gives the in-plane travel', () => {
    const c: V3 = [0, -1, -5];
    const s0 = pinhole(c)!, s1 = pinhole([0.3, -1, -5.4])!;
    const d = planeDelta(rayThrough(s0[0], s0[1]), rayThrough(s1[0], s1[1]), c, [0, 1, 0])!;
    expect(d[0]).toBeCloseTo(0.3, 6); expect(d[1]).toBeCloseTo(0, 9); expect(d[2]).toBeCloseTo(-0.4, 6);
  });
  it('ring angle from the pointer along the ring, with 15° / Shift 5° / Alt free snapping', () => {
    expect(ringDegrees([0, 0], [GZ.ring * Math.PI / 4, 30], [1, 0], GZ.ring)).toBeCloseTo(45, 6);
    expect(snapAngle(47, { shift: false, alt: false })).toBe(45);
    expect(snapAngle(53, { shift: false, alt: false })).toBe(60);
    expect(snapAngle(52, { shift: true, alt: false })).toBe(50);
    expect(snapAngle(47.3, { shift: false, alt: true })).toBe(47.5);
    // a positive (right-handed) turn about +Z moves the ring's +X point up the screen
    const g = geom([0, 0, -5]);
    const t = ringTangent(pinhole, g.c, [0, 0, 1], [g.c[0] + 0.5, g.c[1], g.c[2]])!;
    expect(t[0]).toBeCloseTo(0, 6); expect(t[1]).toBeCloseTo(-1, 6);
  });
  it('corner resize: snapped, clamped to the property range, the opposite faces stay put', () => {
    const def = partDef('force_wall')!;
    const props = propValues(def);
    const corners = boxCorners(def, props);
    const k = corners.find((c) => c.signs[0] > 0 && c.signs[1] > 0)!; // +X +Y corner
    const r = cornerResize(def, props, k.signs, [0.23, 0.12, 0], 2);
    expect(r.props.width).toBeCloseTo(0.8, 9); // 0.6 + 0.23 → 0.8 (0.1 steps)
    expect(r.props.height).toBeCloseTo(0.5, 9);
    expect(r.shift[0]).toBeCloseTo(0.1, 9); // centred in x: the −X face stays where it was
    expect(r.shift[1]).toBeCloseTo(0, 9); // based at y 0: the bottom stays
    const big = cornerResize(def, props, k.signs, [5, 5, 0], 2);
    expect(big.props.width).toBe(1); expect(big.props.height).toBe(1); // the spec's max
    const small = cornerResize(def, props, k.signs, [-5, -5, 0], 2);
    expect(small.props.width).toBe(0.1); expect(small.props.height).toBe(0.1);
    expect(cornerResize(def, props, k.signs, [0.23, 0.12, 0], 2, true).props.width).toBeCloseTo(0.83, 9); // Alt: free
    const box = partBox({ id: 1, type: 'force_wall', pos: [0, 0, 0], rot: { tag: 0 }, flags: 0 })!;
    expect(box.max[0] - box.min[0]).toBeCloseTo(0.6, 6);
  });
});

describe('gizmo: axis colours per colour preset', () => {
  it('stay apart as seen with the preset’s deficiency (letters X / Y / Z carry the axis too)', () => {
    const pal = (h: readonly string[]): Record<string, string> => ({ X: h[0]!, Y: h[1]!, Z: h[2]! });
    expect(closestPair(pal(GIZMO_AXIS_HEX.default), null).d).toBeGreaterThan(40);
    expect(closestPair(pal(GIZMO_AXIS_HEX['high-contrast']), null).d).toBeGreaterThan(40);
    for (const cvd of ['protanopia', 'deuteranopia', 'tritanopia'] as Cvd[]) expect(closestPair(pal(GIZMO_AXIS_HEX[cvd]), cvd).d).toBeGreaterThan(30);
  });
});
