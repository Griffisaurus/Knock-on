// M2 stream D: organisation ops (GroupSet, LayerSet, ModuleSave, ModulePlace), GRUP/MODL sections, `.knockmod`.

import { describe, expect, it } from 'vitest';
import { pack, unpack } from 'msgpackr';
import {
  EMPTY_WORLD, FormatError, decodeModule, decodeWorld, encodeModule, encodeWorld, expandModule, makeId, makeSmallId, moduleFromSelection,
  moduleIdCount, nextSmallId, opFromWire, opToWire, rotateQuarter, snappedEuler, freeRotation, worldHash, yawRotation,
  type LinkRecord, type Op, type PartRecord, type Rotation, type WorldSnapshot,
} from '../src/index.ts';

const P = (n: number, type: string, pos: [number, number, number], extra: Partial<PartRecord> = {}): PartRecord => ({
  id: makeId(1, n), type, pos, rot: { tag: 0 }, flags: 0, ...extra,
});

const parts = new Map<number, PartRecord>([
  [makeId(1, 1), P(1, 'thud', [640, 64, 0], { layer: makeSmallId(1, 1), group: makeSmallId(1, 2), flags: 8 | 32 })],
  [makeId(1, 2), P(2, 'the_button', [700, 0, 64], { rot: snappedEuler(90, 0, 0) })],
  [makeId(1, 3), P(3, 'bangstick', [800, 32, -64], { props: [[0, 4]] })],
  [makeId(2, 1), { ...P(1, 'plank', [5000, 0, 0]), id: makeId(2, 1) }], // outside the selection
]);
const links = new Map<number, LinkRecord>([
  // inside: button → bangstick
  [makeId(1, 9), { id: makeId(1, 9), kind: 'cable_signal', from: { part: makeId(1, 2), port: 0 }, to: { part: makeId(1, 3), port: 1 }, via: [], points: [[700, 10, 64], [800, 10, -64]], length: 0 }],
  // crossing: thud → plank (outside): cut, exposes thud port 0
  [makeId(1, 8), { id: makeId(1, 8), kind: 'line', from: { part: makeId(1, 1), port: 0 }, to: { part: makeId(2, 1), port: 0 }, via: [], points: [], length: 640 }],
  // a free tube that wasn't selected: left behind
  [makeId(1, 7), { id: makeId(1, 7), kind: 'tube', from: null, to: null, via: [], points: [[0, 0, 0], [64, 0, 0]], length: 0 }],
]);

describe('organisation ops', () => {
  const ops: Op[] = [
    { k: 'GroupSet', id: makeSmallId(1, 3), name: 'Trap', parent: 0, members: [makeId(1, 1), makeId(1, 2)] },
    { k: 'GroupSet', id: makeSmallId(2, 1), name: null, parent: 0, members: null },
    { k: 'LayerSet', id: makeSmallId(1, 1), name: 'Booms', flags: 3 },
    { k: 'LayerSet', id: makeSmallId(2, 4), name: null, flags: 0 },
    { k: 'ModuleSave', id: makeSmallId(1, 5), name: 'Mousetrap', blob: new Uint8Array([1, 2, 3]) },
    { k: 'ModuleSave', id: makeSmallId(1, 5), name: 'Mousetrap', blob: null },
    { k: 'ModulePlace', moduleId: makeSmallId(1, 5), transform: { pos: [64, 0, -128], quarter: 3 }, idBase: makeId(2, 40), count: 4, layer: makeSmallId(2, 1) },
  ];
  it('round-trip through msgpack', () => {
    for (const op of ops) {
      const back = opFromWire(unpack(pack(opToWire(op))));
      expect(back).toEqual(op);
    }
  });
  it('reject malformed input', () => {
    const bad: unknown[] = [
      [7, 0, 'x', 0, null], // id 0
      [7, 5, 'x'.repeat(65), 0, null], // name too long
      [7, 5, 'a\u0007b', 0, null], // control char
      [16, 5, 'L', 4], // unknown layer flag
      [8, 5, 'M', 'not bytes'],
      [9, 5, [0, 0, 0, 4], 0, 1, 0], // quarter out of range
      [9, 5, [0, 0, 0, 1], 0, 0, 0], // count 0
      [9, 5, [0, 0, 0], 0, 1, 0], // transform length
    ];
    for (const w of bad) expect(() => opFromWire(w), JSON.stringify(w)).toThrow(FormatError);
  });
  it('small ids are slot-namespaced and fit u32', () => {
    expect(makeSmallId(2, 1)).toBe(2 * 2 ** 24 + 1);
    expect(nextSmallId(1, [makeSmallId(1, 4), makeSmallId(2, 9)])).toBe(makeSmallId(1, 5));
    expect(nextSmallId(2, [], makeSmallId(2, 7))).toBe(makeSmallId(2, 8));
    expect(() => makeSmallId(1, 2 ** 24)).toThrow();
  });
});

describe('modules', () => {
  const sel = [makeId(1, 1), makeId(1, 2), makeId(1, 3)];
  const def = moduleFromSelection(parts, links, sel, {
    name: 'Mousetrap', author: 'sam', origin: [640, 0, 0], portLabel: (p, i) => `${p.type}:${i}`,
  });

  it('builds local ids, relative positions, internal links and exposed ports', () => {
    expect(def.parts.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(def.parts[0]).toEqual({ id: 1, type: 'thud', pos: [0, 64, 0], rot: { tag: 0 }, flags: 32 }); // layer/group/locked dropped
    expect(def.links).toHaveLength(1);
    expect(def.links[0]).toMatchObject({ id: 4, from: { part: 2, port: 0 }, to: { part: 3, port: 1 }, points: [[60, 10, 64], [160, 10, -64]] });
    expect(def.ports).toEqual([{ localPartId: 1, port: 0, label: 'thud:0' }]);
    expect(moduleIdCount(def)).toBe(4);
  });

  it('round-trips through .knockmod deterministically', () => {
    const a = encodeModule(def);
    const b = encodeModule(moduleFromSelection(parts, links, [...sel].reverse(), { name: 'Mousetrap', author: 'sam', origin: [640, 0, 0], portLabel: (p, i) => `${p.type}:${i}` }));
    expect(a).toEqual(b);
    expect(String.fromCharCode(...a.subarray(0, 4))).toBe('KNMD');
    const back = decodeModule(a);
    expect(back.parts).toEqual(def.parts);
    expect(back.links).toEqual(def.links);
    expect(back.ports).toEqual(def.ports);
    expect(back.meta).toEqual({ name: 'Mousetrap', author: 'sam', description: '', tags: [] });
  });

  it('refuses worlds, corrupt bytes, and bad local ids', () => {
    expect(() => decodeModule(encodeWorld(EMPTY_WORLD))).toThrow(FormatError);
    const bytes = encodeModule(def);
    const bad = bytes.slice();
    bad[bad.length - 6]! ^= 0xff;
    expect(() => decodeModule(bad)).toThrow(FormatError);
    expect(() => encodeModule({ ...def, parts: def.parts.map((p) => ({ ...p, id: p.id + 1 })) })).toThrow(FormatError);
    expect(() => moduleFromSelection(parts, links, [], { name: 'x', origin: [0, 0, 0] })).toThrow(FormatError);
  });

  it('expands with deterministic id remapping, rotation and offset', () => {
    const base = makeId(2, 99);
    const out = expandModule(def, { pos: [1000, 0, 2000], quarter: 1 }, base, makeSmallId(2, 1));
    expect(out.parts.map((p) => p.id)).toEqual([base + 1, base + 2, base + 3]);
    expect(out.links.map((l) => l.id)).toEqual([base + 4]);
    expect(out.links[0]!.from).toEqual({ part: base + 2, port: 0 });
    // +90° yaw: (x, z) → (z, −x)
    expect(out.parts[0]!.pos).toEqual([1000 + 0, 64, 2000 - 0]);
    expect(out.parts[1]!.pos).toEqual([1000 + 64, 0, 2000 - 60]);
    expect(out.parts[0]!.rot).toEqual({ tag: 1, yaw: 180, pitch: 0, roll: 0 });
    expect(out.parts[1]!.rot).toEqual({ tag: 1, yaw: 360, pitch: 0, roll: 0 });
    expect(out.parts.every((p) => p.layer === makeSmallId(2, 1))).toBe(true);
    expect(out.links[0]!.points[0]).toEqual([1000 + 64, 10, 2000 - 60]);
    // same inputs → same records
    expect(expandModule(def, { pos: [1000, 0, 2000], quarter: 1 }, base, makeSmallId(2, 1))).toEqual(out);
  });

  it('quarter turns agree with the sim rotation convention (yaw about +Y applied first)', () => {
    const quat = (r: Rotation): number[] => {
      if (r.tag === 0) return [0, 0, 0, 1];
      if (r.tag === 1) {
        const h = (u: number): number => (u * Math.PI) / 720;
        const y = [0, Math.sin(h(r.yaw)), 0, Math.cos(h(r.yaw))], x = [Math.sin(h(r.pitch)), 0, 0, Math.cos(h(r.pitch))], z = [0, 0, Math.sin(h(r.roll)), Math.cos(h(r.roll))];
        return mul(mul(y, x), z);
      }
      const s = 32767 / Math.SQRT1_2, rest = [r.a / s, r.b / s, r.c / s];
      const big = Math.sqrt(1 - rest[0]! ** 2 - rest[1]! ** 2 - rest[2]! ** 2);
      const q: number[] = []; let k = 0;
      for (let i = 0; i < 4; i++) q.push(i === r.index ? big : rest[k++]!);
      return q;
    };
    const rot = (q: number[], v: number[]): number[] => mul(mul(q, [...v, 0]), [-q[0]!, -q[1]!, -q[2]!, q[3]!]).slice(0, 3);
    for (const quarter of [1, 2, 3]) {
      const yq = quat({ tag: 1, yaw: 180 * quarter, pitch: 0, roll: 0 });
      const v = rot(yq, [3, 5, 7]);
      expect(rotateQuarter([3, 5, 7], quarter).map((x, i) => x - v[i]!).every((d) => Math.abs(d) < 1e-9)).toBe(true);
      for (const r of [snappedEuler(30, 15, -45), freeRotation([0.1, 0.2, 0.3, 0.9])]) {
        const want = mul(yq, quat(r));
        const got = quat(yawRotation(r, quarter));
        const dot = Math.abs(want.reduce((s, x, i) => s + x * got[i]!, 0));
        expect(dot).toBeGreaterThan(0.99999);
      }
    }
  });
});

describe('world GRUP / MODL', () => {
  const blob = encodeModule(moduleFromSelection(parts, links, [makeId(1, 2)], { name: 'Button', origin: [0, 0, 0] }));
  const wd: WorldSnapshot = {
    ...EMPTY_WORLD, parts: [...parts.values()], links: [],
    groups: [{ id: makeSmallId(1, 2), name: 'Trap', parent: 0 }],
    layers: [{ id: makeSmallId(1, 1), name: 'Booms', flags: 1 }],
    modules: [{ id: makeSmallId(1, 5), name: 'Button', blob }],
  };
  it('round-trips groups, layers and modules', () => {
    const back = decodeWorld(encodeWorld(wd));
    expect(back.groups).toEqual(wd.groups);
    expect(back.layers).toEqual(wd.layers);
    expect(back.modules).toEqual(wd.modules);
    expect(back.parts.find((p) => p.id === makeId(1, 1))).toMatchObject({ layer: makeSmallId(1, 1), group: makeSmallId(1, 2) });
  });
  it('canonical snapshots and the world hash leave organisation out', () => {
    const canon = decodeWorld(encodeWorld(wd, { canonical: true }));
    expect(canon.groups).toBeUndefined();
    expect(canon.modules).toBeUndefined();
    expect(worldHash(wd)).toBe(worldHash({ ...wd, groups: [], layers: [], modules: [] }));
  });
  it('older worlds without the sections still load', () => {
    const back = decodeWorld(encodeWorld({ ...EMPTY_WORLD }));
    expect(back.groups).toBeUndefined();
    expect(back.layers).toBeUndefined();
  });
});

function mul(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}
