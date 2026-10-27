// Stream BUILDUX (D123–D124): the pure logic of box select (marquee hit-test and modes), copy / paste / duplicate (the
// clip, id and link remapping, pair re-pairing, one op = one undo step, duplicate landing clear), mirror (the M_a·R·M_b
// maths, a part's own mirror planes, port re-indexing, links, kept parts, refusals), the gizmo's local axes, port
// snapping (compatibility, the index search, face-to-face mating, Alt) and the partner ghost's presence encoding.

import { describe, expect, it } from 'vitest';
import { DocStore, tryApply, WorldDoc } from '@knockon/docstore';
import { makeId, metresToPos, PartFlag, posToMetres, snappedEuler, type LinkRecord, type Op, type PartRecord } from '@knockon/format';
import { propSteps, propValues } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qrot, type Q4 } from '../src/catalog.ts';
import type { V3 } from '../src/math.ts';
import { marqueeHits, marqueeMode, marqueeSelection, normRect, type MarqueeItem } from '../src/ui/boxselect.ts';
import { clipboard, ClipTool, copyClip, duplicateOffsets, pasteOp, remapClip, repairPairs, setClipboard, type ClipHost } from '../src/ui/clipboard.ts';
import { axisQuat, MoveSession, overlapOf, partBox, quatToEuler, unionBox, type MoveXf } from '../src/ui/dragmove.ts';
import { hitGizmo, localAxes, localAxisMove, localPlaneMove, metresPerPixel, type GizmoGeom, type Project } from '../src/ui/gizmo.ts';
import { pairsOf } from '../src/ui/m5tools.ts';
import { matToQuat, mirroredQuat, mirrorPlane, mirrorSelection, partSymmetry, quatToMat, reflect } from '../src/ui/mirror.ts';
import { findSnap, matePush, PortIndex, portFaceNormal, portsCompatible, snapSession, type SnapPort } from '../src/ui/portsnap.ts';
import { decodeGhost, encodeGhost } from '../src/ui/presenceghost.ts';

const id = (n: number): number => makeId(1, n);
const at = (m: V3): [number, number, number] => [metresToPos(m[0]), metresToPos(m[1]), metresToPos(m[2])];
const part = (n: number, type: string, pos: V3, extra: Partial<PartRecord> = {}): PartRecord => ({ id: id(n), type, pos: at(pos), rot: { tag: 0 }, flags: 0, ...extra });
const metres = (p: PartRecord): V3 => [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
function world(parts: PartRecord[], links: LinkRecord[] = []): WorldDoc {
  const d = new WorldDoc();
  for (const p of parts) expect(tryApply(d, { k: 'PartAdd', part: p }).ok).toBe(true);
  for (const l of links) expect(tryApply(d, { k: 'LinkAdd', link: l }).ok).toBe(true);
  return d;
}
const cable = (n: number, a: number, ap: number, b: number, bp: number): LinkRecord => ({ id: id(n), kind: 'cable_signal', from: { part: id(a), port: ap }, to: { part: id(b), port: bp }, via: [], points: [], length: 0 });
const tube = (n: number, pts: V3[]): LinkRecord => ({ id: id(n), kind: 'tube', from: null, to: null, via: [], points: pts.map(at), length: 0 });
const pairOf = (p: PartRecord): number => Math.round(propValues(partDef(p.type)!, p.props).pair ?? -1);
const withPair = (p: PartRecord, c: number): PartRecord => ({ ...p, props: [propSteps(partDef(p.type)!, 'pair', c)] });
const counter = (slot: number, from = 1): (() => number) => { let n = from; return () => makeId(slot, n++); };
const yaw = (deg: number) => snappedEuler(deg, 0, 0);

// ---- box select -----------------------------------------------------------------------------------------------------

describe('box select: marquee hit-test', () => {
  // a simple orthographic camera: x → right, y → up, 100 px per metre; z ≥ 10 is "behind the camera"
  const project = (p: V3): [number, number] | null => (p[2] >= 10 ? null : [500 + p[0] * 100, 500 - p[1] * 100]);
  const items: MarqueeItem[] = [
    { id: 1, pts: [[0, 0, 0]] }, { id: 2, pts: [[1, 1, 0]] }, { id: 3, pts: [[3, 0, 0]] }, { id: 4, pts: [[0.5, 0.2, 20]] },
    { id: 5, pts: [[0, 0.5, 0], [1.2, 0.5, 0]] }, // a TUBE run: all its points inside
    { id: 6, pts: [[0, 0.5, 0], [4, 0.5, 0]] }, // a TUBE run sticking out
  ];
  it('normalises any drag direction', () => {
    expect(normRect(600, 300, 400, 520)).toEqual({ x0: 400, y0: 300, x1: 600, y1: 520 });
  });
  it('selects what is inside; points behind the camera and paths that stick out do not count', () => {
    const r = normRect(450, 380, 650, 520); // x −0.5 … 1.5 m, y −0.2 … 1.2 m
    expect(marqueeHits(r, items, project)).toEqual([1, 2, 5]);
    expect(marqueeHits(normRect(0, 0, 10, 10), items, project)).toEqual([]);
  });
  it('plain replaces, Shift adds, Ctrl toggles', () => {
    expect(marqueeMode({ shift: false, ctrl: false })).toBe('replace');
    expect(marqueeMode({ shift: true, ctrl: false })).toBe('add');
    expect(marqueeMode({ shift: false, ctrl: true })).toBe('toggle');
    expect(marqueeMode({ shift: true, ctrl: true })).toBe('toggle');
    expect(marqueeSelection([7, 1], [1, 2], 'replace').sort()).toEqual([1, 2]);
    expect(marqueeSelection([7, 1], [1, 2], 'add').sort()).toEqual([1, 2, 7]);
    expect(marqueeSelection([7, 1], [1, 2], 'toggle').sort()).toEqual([2, 7]);
    expect(marqueeSelection([7], [], 'replace')).toEqual([]);
  });
});

// ---- copy / paste / duplicate ---------------------------------------------------------------------------------------

describe('copy: the clip', () => {
  const ps = [
    part(1, 'ping', [0, 0, 0], { flags: PartFlag.Tagged | PartFlag.Locked | PartFlag.Anchored, group: makeId(1, 9), layer: 3 }),
    part(2, 'ping', [0.3, 0, 0]), part(3, 'ping', [0.6, 0, 0]),
  ];
  const ls = [cable(10, 1, 1, 2, 0), cable(11, 2, 1, 3, 0), tube(12, [[0, 0.3, 0], [0.5, 0.3, 0]]), tube(13, [[0, 0.6, 0], [0.5, 0.6, 0]])];
  const d = world(ps, ls);
  it('keeps the parts and the links among them (a path only when selected); strips layer, group, Locked, Hidden', () => {
    const c = copyClip(d, [id(1), id(2), id(12)], 'w1')!;
    expect(c.parts.map((p) => p.id)).toEqual([id(1), id(2)]);
    expect(c.links.map((l) => l.id)).toEqual([id(10), id(12)]); // 11 leaves the clip (part 3), 13 isn't selected
    expect(c.parts[0]!.flags).toBe(PartFlag.Tagged | PartFlag.Anchored);
    expect(c.parts[0]!.layer).toBeUndefined();
    expect(c.parts[0]!.group).toBeUndefined();
    expect(c.source).toBe('w1');
    expect(copyClip(d, [id(12)])).toBeNull(); // no part
  });
  it('remaps every id and link end, keeping relative positions and props', () => {
    const c = copyClip(d, [id(1), id(2), id(12)])!;
    const r = remapClip(c, counter(2, 50));
    expect(r.parts.map((p) => p.id)).toEqual([makeId(2, 50), makeId(2, 51)]);
    const cab = r.links.find((l) => l.kind === 'cable_signal')!;
    expect(cab.from).toEqual({ part: makeId(2, 50), port: 1 });
    expect(cab.to).toEqual({ part: makeId(2, 51), port: 0 });
    expect(r.links.map((l) => l.id)).toEqual([makeId(2, 52), makeId(2, 53)]);
    expect(r.parts[1]!.pos).toEqual(ps[1]!.pos);
    expect(r.idMap.get(id(12))).toBe(makeId(2, 53));
  });
  it('the clipboard carries across worlds in the session', () => {
    const c = copyClip(d, [id(1)], 'world-A')!;
    setClipboard(c);
    expect(clipboard()?.source).toBe('world-A');
    const other = world([part(1, 'thud', [2, 0.11, 2])]);
    const r = remapClip(clipboard()!, counter(1, 900));
    expect(tryApply(other, pasteOp(r.parts, r.links)!).ok).toBe(true);
    expect(other.parts.size).toBe(2);
  });
});

describe('paste: pairs are re-paired', () => {
  it('a copied RIFT pair becomes a new pair in an unused colour; a lone gate pairs with the lonely one', () => {
    const gates = [withPair(part(1, 'rift_gate', [0, 0, 0]), 0), withPair(part(2, 'rift_gate', [1, 0, 0]), 0), withPair(part(3, 'rift_gate', [2, 0, 0]), 3)];
    const d = world(gates);
    const c = copyClip(d, [id(1), id(2)])!;
    expect(c.pairs).toEqual([[id(1), id(2)]]);
    const r = remapClip(c, counter(1, 100));
    const out = repairPairs(r.parts, r.pairs, d.parts.values());
    expect(out.map(pairOf)).toEqual([1, 1]); // Plasma (0) and Volt (3) are taken: Beam
    const after = pairsOf([...d.parts.values(), ...out]);
    expect(after.links.some((l) => l.a === out[0]!.id && l.b === out[1]!.id)).toBe(true);
    // the lone Volt gate, copied, pairs with its original
    const lone = remapClip(copyClip(d, [id(3)])!, counter(1, 200));
    const out2 = repairPairs(lone.parts, lone.pairs, d.parts.values());
    expect(out2.map(pairOf)).toEqual([3]);
    expect(pairsOf([...d.parts.values(), ...out2]).lonely.size).toBe(0);
  });
  it('a BUZZ with its beacon becomes a new pair; same-colour PINGs become a new group; a lone PING keeps its colour', () => {
    const d = world([
      withPair(part(1, 'buzz_beacon', [0, 0, 0]), 5), withPair(part(2, 'buzz', [0, 0.1, 0]), 5),
      withPair(part(3, 'ping', [1, 0, 0]), 0), withPair(part(4, 'ping', [1.3, 0, 0]), 0), withPair(part(5, 'ping', [1.6, 0, 0]), 2),
    ]);
    const c = copyClip(d, [id(1), id(2), id(3), id(4), id(5)])!;
    const r = remapClip(c, counter(1, 100));
    const out = repairPairs(r.parts, r.pairs, d.parts.values());
    const byType = (t: string) => out.filter((p) => p.type === t).map(pairOf);
    expect(byType('buzz_beacon')).toEqual([0]);
    expect(byType('buzz')).toEqual([0]);
    expect(byType('ping')).toEqual([1, 1, 2]); // the 0-pair → 1 (unused); the lone colour-2 ping keeps 2
  });
});

describe('paste and duplicate: one op, one undo step', () => {
  it('a paste lands as one Batch (parts then links) that one undo removes', () => {
    const store = new DocStore(1, world([part(1, 'ping', [0, 0, 0]), part(2, 'ping', [0.3, 0, 0])], [cable(10, 1, 1, 2, 0)]));
    const r = remapClip(copyClip(store.doc, [id(1), id(2)])!, counter(1, 500));
    const op = pasteOp(r.parts, r.links)!;
    expect(op.k).toBe('Batch');
    expect((op as Extract<Op, { k: 'Batch' }>).ops.map((o) => o.k)).toEqual(['PartAdd', 'PartAdd', 'LinkAdd']);
    expect('error' in store.applyLocal(op)).toBe(false);
    expect(store.doc.parts.size).toBe(4);
    expect(store.doc.links.size).toBe(2);
    expect(store.undo().ok).toBe(true);
    expect(store.doc.parts.size).toBe(2);
    expect(store.doc.links.size).toBe(1);
  });
  it('duplicate: offsets one grid step at a time until clear, selects the copy, one undo', () => {
    // a 10 cm wide PLANK: one grid step along +X just touches it (fine), but an ANCHOR sits there, so the copy goes one step further
    const store = new DocStore(1, world([part(1, 'plank', [0, 0.05, 0]), part(2, 'anchor', [0.1, 0, 0.3])]));
    const before = store.doc.parts.size;
    let selected: readonly number[] = [];
    const ids = counter(1, 1000);
    const host: ClipHost = {
      doc: () => store.doc, phase: () => 'build', worldId: () => 'w', selection: () => [id(1)], select: (s) => { selected = s; },
      nextId: ids, submit: (op) => !('error' in store.applyLocal(op)), layer: () => 0, refusal: () => null, world: () => null,
      toast: () => {}, announce: () => {}, sound: () => {}, mover: null as never,
    };
    expect(new ClipTool(host).duplicate()).toBe(true);
    expect(store.doc.parts.size).toBe(before + 1);
    const copy = store.doc.parts.get(selected[0]!)!;
    expect(copy.type).toBe('plank');
    const orig = store.doc.parts.get(id(1))!;
    const dx = posToMetres(copy.pos[0] - orig.pos[0]);
    expect(dx).toBeGreaterThan(0);
    expect(Math.abs(dx / 0.1 - Math.round(dx / 0.1))).toBeLessThan(1e-6); // whole grid steps
    expect(copy.pos[1]).toBe(orig.pos[1]);
    expect(copy.pos[2]).toBe(orig.pos[2]);
    // clear of everything: step 1 is blocked by the ANCHOR, step 2 is free
    expect(overlapOf(partBox(copy)!, [...store.doc.parts.values()].filter((p) => p.id !== copy.id), partBox)).toBeNull();
    expect(dx).toBeCloseTo(0.2, 6);
    expect(store.undo().ok).toBe(true);
    expect(store.doc.parts.size).toBe(before);
  });
  it('duplicate offsets run +X, then +Z, −X, −Z', () => {
    const o = duplicateOffsets(2);
    expect(o.map((v) => v.map((x) => Math.round(x * 10) / 10))).toEqual([[0.1, 0, 0], [0.2, 0, 0], [0, 0, 0.1], [0, 0, 0.2], [-0.1, 0, 0], [-0.2, 0, 0], [0, 0, -0.1], [0, 0, -0.2]]);
  });
});

// ---- mirror ---------------------------------------------------------------------------------------------------------

describe('mirror: the maths', () => {
  const qs: Q4[] = [[0, 0, 0, 1], rotationToQuat(snappedEuler(30, 0, 0)) as Q4, rotationToQuat(snappedEuler(-45, 30, 15)) as Q4, rotationToQuat(snappedEuler(120, -60, 90)) as Q4];
  it('quaternion ↔ matrix round-trips', () => {
    for (const q of qs) { const r = matToQuat(quatToMat(q)); const s = Math.sign(r[3] * q[3] || 1); for (let i = 0; i < 4; i++) expect(r[i]! * s).toBeCloseTo(q[i]!, 9); }
  });
  it('M_a · R · M_b turns a part with mirror plane b into the mirror image of R across world plane a', () => {
    for (const q of qs) for (const a of [0, 1, 2] as const) for (const b of [0, 1, 2] as const) {
      const q2 = mirroredQuat(q, a, b);
      expect(Math.hypot(...q2)).toBeCloseTo(1, 9); // a proper rotation
      for (const x of [[0.3, 0.1, -0.2], [0, 0.5, 0.1]] as V3[]) {
        const want = reflect(qrot(q, x), a); // the mirror image of the point
        const got = qrot(q2, reflect(x, b)); // where the turned part has that point's mirror twin
        for (let i = 0; i < 3; i++) expect(got[i]!).toBeCloseTo(want[i]!, 9);
      }
    }
  });
  it('a yaw mirrors to minus the yaw across X (through the part\'s own x = 0 plane)', () => {
    const e = quatToEuler(mirroredQuat(rotationToQuat(yaw(30)) as Q4, 0, 0));
    expect(e.yaw).toBeCloseTo(-30, 6);
    expect(e.pitch).toBeCloseTo(0, 6);
  });
});

describe('mirror: a part\'s own mirror planes', () => {
  it('a centred block mirrors through all three; PING (out on one side) only through z = 0, ports staying put', () => {
    const plank = partDef('plank')!, ping = partDef('ping')!;
    expect(partSymmetry(plank, propValues(plank)).planes).toEqual([0, 1, 2]);
    const s = partSymmetry(ping, propValues(ping));
    expect(s.planes).toEqual([2]);
    expect(s.perm[2]).toEqual([0, 1]);
  });
  it('directional parts only use x = 0 (front and top kept); handed parts have none', () => {
    const gale = partDef('gale')!, motor = partDef('motor')!;
    expect(partSymmetry(gale, propValues(gale)).planes.every((b) => b === 0)).toBe(true);
    expect(partSymmetry(motor, propValues(motor)).planes).toEqual([]); // the power socket and the shaft sit on different sides
  });
  it('picks the usable plane closest to the world axis', () => {
    const plank = partDef('plank')!;
    const s = partSymmetry(plank, propValues(plank));
    expect(mirrorPlane([0, 0, 0, 1], 0, s)).toBe(0);
    expect(mirrorPlane(rotationToQuat(yaw(90)) as Q4, 0, s)).toBe(2); // turned 90°: its z axis lies along world X
  });
});

describe('mirror: the selection', () => {
  it('mirrors positions across the centre plane and yaws to their mirror image; one op, one undo', () => {
    const store = new DocStore(1, world([part(1, 'plank', [0.2, 0.05, 0], { rot: yaw(30) }), part(2, 'thud', [1.0, 0.11, 0.5])]));
    const u = unionBox([partBox(store.doc.parts.get(id(1))!)!, partBox(store.doc.parts.get(id(2))!)!])!;
    const c = Math.round(((u.min[0] + u.max[0]) / 2) / 0.05) * 0.05; // the centre plane, on half a grid step
    const r = mirrorSelection(store.doc, [id(1), id(2)], 0);
    expect(r.refusal).toBeNull();
    expect(r.kept).toEqual([]);
    expect(r.mirrored).toBe(2);
    const before = JSON.stringify([...store.doc.parts.values()]);
    expect('error' in store.applyLocal(r.op!)).toBe(false);
    const a = store.doc.parts.get(id(1))!, b = store.doc.parts.get(id(2))!;
    expect(metres(a)[0]).toBeCloseTo(2 * c - 0.2, 6);
    expect(metres(b)[0]).toBeCloseTo(2 * c - 1.0, 6);
    expect(metres(b)[2]).toBeCloseTo(0.5, 9);
    expect(quatToEuler(rotationToQuat(a.rot) as Q4).yaw).toBeCloseTo(-30, 3);
    expect(store.undo().ok).toBe(true);
    expect(JSON.stringify([...store.doc.parts.values()])).toBe(before);
  });
  it('PING turns 180° (its only mirror plane is z = 0) and the cable between two PINGs stays on its ports', () => {
    const d = world([part(1, 'ping', [0, 0, 0]), part(2, 'ping', [0.3, 0, 0])], [cable(10, 1, 1, 2, 0)]);
    const r = mirrorSelection(d, [id(1), id(2)], 0);
    expect(r.refusal).toBeNull();
    expect(tryApply(d, r.op!).ok).toBe(true);
    const a = d.parts.get(id(1))!, b = d.parts.get(id(2))!;
    expect(metres(a)[0]).toBeCloseTo(0.3, 6);
    expect(metres(b)[0]).toBeCloseTo(0, 6);
    expect(Math.abs(quatToEuler(rotationToQuat(a.rot) as Q4).yaw)).toBeCloseTo(180, 3);
    // the out port of A now faces B again: A's out (port 1) is on its −x side in the world
    const out = qrot(rotationToQuat(a.rot) as Q4, partDef('ping')!.ports[1]!.at);
    expect(metres(a)[0] + out[0]).toBeLessThan(metres(a)[0]);
    expect(d.links.get(id(10))!.from).toEqual({ part: id(1), port: 1 });
  });
  it('a part with no mirror image keeps its turn (only its origin mirrors) and is reported; waypoints mirror', () => {
    const d = world([part(1, 'motor', [0, 0, 0], { rot: yaw(30) }), part(2, 'thud', [0.6, 0.11, 0])], [tube(5, [[0.0, 0.4, 0], [0.6, 0.4, 0]])]);
    const r = mirrorSelection(d, [id(1), id(2), id(5)], 0);
    expect(r.kept.map((p) => p.type)).toEqual(['motor']);
    expect(tryApply(d, r.op!).ok).toBe(true);
    expect(d.parts.get(id(1))!.rot).toEqual(yaw(30));
    const pts = d.links.get(id(5))!.points.map((q) => posToMetres(q[0]));
    const c2 = metres(d.parts.get(id(1))!)[0] + 0; // motor's new x = 2c − 0
    expect(pts[0]).toBeCloseTo(c2, 6);
    expect(pts[1]).toBeCloseTo(c2 - 0.6, 6);
  });
  it('is refused when the mirror image would overlap a part outside the selection', () => {
    // a THUD at z 0 and an ANCHOR at z 1.0 mirror across Z about z 0.45: the ANCHOR lands at z −0.1, on the blocker
    const d = world([part(1, 'thud', [0, 0.11, 0]), part(2, 'anchor', [0.5, 0, 1.0]), part(3, 'thud', [0.5, 0.11, -0.15])]);
    const r = mirrorSelection(d, [id(1), id(2)], 2);
    expect(r.refusal).toBe('ANCHOR would overlap THUD');
    expect(mirrorSelection(d, [id(1), id(2), id(3)], 2).refusal).toBeNull(); // with the blocker in the selection it mirrors too
  });
});

// ---- gizmo local axes ------------------------------------------------------------------------------------------------

describe('gizmo: local axes', () => {
  const q = rotationToQuat(yaw(30)) as Q4;
  const ax = localAxes(q);
  it('the local frame is the part\'s turned axes', () => {
    expect(ax[0][0]).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(ax[0][2]).toBeCloseTo(-Math.sin(Math.PI / 6), 9);
    expect(ax[1]).toEqual([0, 1, 0].map((v, i) => expect.closeTo(v, 9) as unknown as number) as unknown as V3);
  });
  it('moves snap the travel along the turned axis (10 cm, Ctrl 2.5 cm, Alt free)', () => {
    const m = localAxisMove(0.234, ax[0], 0.1);
    expect(Math.hypot(...m)).toBeCloseTo(0.2, 9);
    expect(m[0] / 0.2).toBeCloseTo(ax[0][0], 9);
    expect(Math.hypot(...localAxisMove(0.234, ax[0], 0.025))).toBeCloseTo(0.225, 9);
    expect(Math.hypot(...localAxisMove(0.234, ax[0], 0))).toBeCloseTo(0.234, 9);
    const p = localPlaneMove([ax[0][0] * 0.31 + ax[2][0] * 0.17, 0, ax[0][2] * 0.31 + ax[2][2] * 0.17], ax[0], ax[2], 0.1);
    expect(p[0]).toBeCloseTo(ax[0][0] * 0.3 + ax[2][0] * 0.2, 9);
    expect(p[2]).toBeCloseTo(ax[0][2] * 0.3 + ax[2][2] * 0.2, 9);
  });
  it('the arrows are hit where they point in local mode', () => {
    const F = 800, W = 1000, H = 800;
    const pinhole: Project = (p) => (p[2]! >= 0 ? null : [W / 2 + (F * p[0]!) / -p[2]!, H / 2 - (F * p[1]!) / -p[2]!]);
    const c: V3 = [0, 0, -5];
    const turned = localAxes(rotationToQuat(snappedEuler(0, 0, 90)) as Q4); // roll 90°: local X points up the screen
    const g: GizmoGeom = { c, mpp: metresPerPixel(pinhole, c, [1, 0, 0]), ringAxes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], planeSign: [1, 1, 1], corners: null, view: [0, 0, -1], moveAxes: turned };
    const s = pinhole(c)!;
    expect(hitGizmo(g, pinhole, [s[0] + 2, s[1] - 70])).toEqual({ kind: 'axis', axis: 0 });
    expect(hitGizmo({ ...g, moveAxes: undefined } as GizmoGeom, pinhole, [s[0] + 2, s[1] - 70])).toEqual({ kind: 'axis', axis: 1 });
  });
});

// ---- port snapping -----------------------------------------------------------------------------------------------------

describe('port snapping', () => {
  const P = (part: number, channel: SnapPort['channel'], dir: SnapPort['dir'], world: V3, free = true): SnapPort => ({ part, index: 0, channel, dir, world, free, normal: null });
  it('compatible = same channel, output to input for Signal and Power, neither full, different parts', () => {
    expect(portsCompatible(P(1, 'signal', 'out', [0, 0, 0]), P(2, 'signal', 'in', [0, 0, 0]))).toBe(true);
    expect(portsCompatible(P(1, 'signal', 'out', [0, 0, 0]), P(2, 'signal', 'out', [0, 0, 0]))).toBe(false);
    expect(portsCompatible(P(1, 'power', 'in', [0, 0, 0]), P(2, 'power', 'in', [0, 0, 0]))).toBe(false);
    expect(portsCompatible(P(1, 'tension', 'both', [0, 0, 0]), P(2, 'tension', 'both', [0, 0, 0]))).toBe(true);
    expect(portsCompatible(P(1, 'tension', 'both', [0, 0, 0]), P(2, 'spin', 'both', [0, 0, 0]))).toBe(false);
    expect(portsCompatible(P(1, 'signal', 'out', [0, 0, 0]), P(2, 'signal', 'in', [0, 0, 0], false))).toBe(false);
    expect(portsCompatible(P(1, 'signal', 'out', [0, 0, 0]), P(1, 'signal', 'in', [0, 0, 0]))).toBe(false);
  });
  it('finds the nearest compatible port within 0.5 cells (5 cm), and nothing beyond', () => {
    const idx = new PortIndex([P(2, 'signal', 'in', [0.04, 0, 0]), P(3, 'signal', 'in', [0, 0.03, 0]), P(4, 'signal', 'out', [0.01, 0, 0]), P(5, 'signal', 'in', [0.3, 0, 0])]);
    expect(idx.near([0, 0, 0], 0.05).length).toBe(3);
    const s = findSnap([P(1, 'signal', 'out', [0, 0, 0])], idx)!;
    expect(s.to.part).toBe(3);
    expect(s.delta[1]).toBeCloseTo(0.03, 9);
    expect(findSnap([P(1, 'signal', 'out', [0.24, 0, 0])], idx)).toBeNull(); // 6 cm from the nearest input
  });
  it('a port\'s face normal, and the push that brings two parts face to face', () => {
    const lamp = partDef('lamp')!;
    expect(portFaceNormal(lamp.bounds, lamp.ports[0]!.at)).toEqual([0, 0, 1]);
    expect(portFaceNormal({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, [0, 0, 0])).toBeNull(); // deep inside
    expect(matePush({ min: [-0.05, 0, 0.04], max: [0.05, 0.2, 0.14] }, { min: [-0.05, 0, -0.05], max: [0.05, 0.2, 0.05] }, [0, 0, 1])).toEqual([0, 0, expect.closeTo(0.01, 9)]);
    expect(matePush({ min: [-0.05, 0, 0.06], max: [0.05, 0.2, 0.16] }, { min: [-0.05, 0, -0.05], max: [0.05, 0.2, 0.05] }, [0, 0, 1])).toBeNull();
  });
  it('a dragged LAMP snaps its power input onto a CELL\'s output, face to face; Alt turns it off', () => {
    const cell = part(1, 'cell', [0, 0, 0]);
    const lamp = part(2, 'lamp', [0.02, 0.12, 0.11], { rot: yaw(180) });
    const d = world([cell, lamp]);
    const s = new MoveSession(d, [id(2)], [], id(2), null);
    const still: MoveXf = { pivot: s.anchor.from, t: [0, 0, 0], q: null, rot: new Map() };
    s.update(still);
    snapSession(s, still, d, false, () => true);
    expect(s.portSnap?.snap?.to.part).toBe(id(1));
    expect(s.refusal()).toBeNull();
    const pz = s.pose(id(2))!;
    const cellOut = qrot([0, 0, 0, 1], partDef('cell')!.ports[0]!.at);
    const lampIn = qrot(pz.rot, partDef('lamp')!.ports[0]!.at);
    expect(pz.pos[0] + lampIn[0]).toBeCloseTo(cellOut[0], 6); // lined up across the contact
    expect(pz.pos[1] + lampIn[1]).toBeCloseTo(cellOut[1], 6);
    expect(pz.pos[2] - 0.05).toBeCloseTo(0.05, 6); // the LAMP's back face on the CELL's front face
    const s2 = new MoveSession(d, [id(2)], [], id(2), null);
    s2.update(still);
    snapSession(s2, still, d, true, () => true);
    expect(s2.portSnap).toBeNull();
    expect(s2.pose(id(2))!.pos[0]).toBeCloseTo(metres(lamp)[0], 9);
  });
});

// ---- the partner ghost --------------------------------------------------------------------------------------------------

describe('partner ghost: presence encoding', () => {
  it('round-trips the held parts with their turns (mm and 1e-4)', () => {
    const q = rotationToQuat(snappedEuler(30, 15, 0)) as Q4;
    const held = [{ type: 'plank', pos: [0.5, 0.05, 0.2] as V3, rot: q }, { type: 'lamp', pos: [0.8, 0, -0.1] as V3, rot: axisQuat(1, 90) }];
    const g = encodeGhost(held)!;
    expect(g.type).toBe('plank');
    expect(g.parts).toHaveLength(2);
    expect(g.parts![1]!.slice(1, 4)).toEqual([300, -50, -300]);
    const back = decodeGhost(JSON.parse(JSON.stringify(g)));
    expect(back.map((p) => p.type)).toEqual(['plank', 'lamp']);
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 3; k++) expect(Math.abs(back[i]!.pos[k]! - held[i]!.pos[k]!)).toBeLessThan(0.0011);
      const a = back[i]!.rot, b = held[i]!.rot;
      expect(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])).toBeGreaterThan(0.9999);
    }
  });
  it('caps the list at 32, reads an old client\'s ghost as one unturned part, and drops junk', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'thud', pos: [i * 0.3, 0.11, 0] as V3, rot: [0, 0, 0, 1] as Q4 }));
    expect(encodeGhost(many)!.parts).toHaveLength(32);
    expect(decodeGhost({ type: 'plank', pos: [1, 2, 3] })).toEqual([{ type: 'plank', pos: [1, 2, 3], rot: [0, 0, 0, 1] }]);
    expect(decodeGhost({ type: 'plank', pos: [1, Number.NaN, 3] })).toEqual([]);
    expect(decodeGhost(undefined)).toEqual([]);
    expect(encodeGhost([])).toBeNull();
  });
});
