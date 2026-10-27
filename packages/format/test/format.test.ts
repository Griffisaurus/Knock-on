import { describe, expect, it } from 'vitest';
import { pack, unpack } from 'msgpackr';
import {
  ByteReader, ByteWriter, EMPTY_WORLD, FormatError, crc32, decodeContainer, decodeWorld, encodeContainer, encodeWorld,
  freeRotation, makeId, metresToPos, opFromWire, opToWire, posToMetres, snappedEuler, worldHash,
  type Op, type PartRecord, type WorldSnapshot,
} from '../src/index.ts';

describe('bytes', () => {
  it('varint and svarint round-trip across the safe range', () => {
    const vals = [0, 1, 127, 128, 300, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER];
    const svals = [0, -1, 1, -64, 63, -(2 ** 40), 2 ** 40 + 7];
    const w = new ByteWriter();
    vals.forEach((v) => w.varint(v));
    svals.forEach((v) => w.svarint(v));
    const r = new ByteReader(w.finish());
    expect(vals.map(() => r.varint())).toEqual(vals);
    expect(svals.map(() => r.svarint())).toEqual(svals);
    expect(r.remaining).toBe(0);
  });
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
});

describe('quantize', () => {
  it('positions round to 1/64 cell', () => {
    expect(metresToPos(0.1)).toBe(64);
    expect(posToMetres(metresToPos(1.2345))).toBeCloseTo(1.2345, 3);
  });
  it('snapped Euler is exact and identity collapses', () => {
    expect(snappedEuler(0, 0, 0)).toEqual({ tag: 0 });
    expect(snappedEuler(15, -30, 365)).toEqual({ tag: 1, yaw: 30, pitch: -60, roll: 10 });
  });
  it('free rotation uses smallest-three', () => {
    const r = freeRotation([0, 0.7071067811865476, 0, 0.7071067811865476]);
    expect(r.tag).toBe(2);
  });
});

const sampleParts: PartRecord[] = [
  { id: makeId(1, 1), type: 'thud', pos: [0, 70, 0], rot: { tag: 0 }, flags: 0 },
  { id: makeId(1, 2), type: 'slope', pos: [640, 0, -320], rot: snappedEuler(0, 15, 0), flags: 1, size: [16, 4, 8] },
  { id: makeId(2, 1), type: 'bangstick', pos: [-9000, 32, 1000], rot: freeRotation([0.1, 0.2, 0.3, 0.9]), flags: 8, props: [[0, 20]], skin: 2 },
];

describe('ops', () => {
  const ops: Op[] = [
    { k: 'PartAdd', part: sampleParts[2]! },
    { k: 'PartUpdate', id: sampleParts[0]!.id, patch: { pos: [1, 2, 3], flags: 4, props: [[1, -5], [3, 9]] } },
    { k: 'PartRemove', ids: [sampleParts[1]!.id] },
    { k: 'LinkAdd', link: { id: makeId(1, 9), kind: 'line', from: { part: sampleParts[0]!.id, port: 0 }, to: null, via: [], points: [[0, 0, 0], [64, 128, 0]], length: 400 } },
    { k: 'EnvUpdate', patch: { gravity: 38, feel: 'floaty' } },
    { k: 'NoteAdd', note: { id: makeId(2, 7), pos: [0, 0, 0], text: 'Here kitty', color: 'amber' } },
    { k: 'Batch', ops: [{ k: 'PartRemove', ids: [5] }, { k: 'NoteRemove', ids: [6] }] },
  ];
  it('round-trips through msgpack', () => {
    for (const op of ops) {
      const back = opFromWire(unpack(pack(opToWire(op))));
      expect(back).toEqual(op);
    }
  });
  it('rejects malformed input', () => {
    expect(() => opFromWire([99])).toThrow(FormatError);
    expect(() => opFromWire([1, 0, 'thud', [0, 0, 0], [0], 0])).toThrow(FormatError); // id 0
    expect(() => opFromWire([1, 5, 'Bad Type!', [0, 0, 0], [0], 0])).toThrow(FormatError);
    expect(() => opFromWire([15, [[15, []]]])).toThrow(FormatError); // nested batch
    expect(() => opFromWire([10, { gravity: 9000 }])).toThrow(FormatError);
  });
});

describe('world container', () => {
  const world: WorldSnapshot = {
    ...EMPTY_WORLD,
    title: 'Cat-o-Matic',
    parts: sampleParts,
    links: [{ id: makeId(1, 9), kind: 'fuse', from: null, to: { part: sampleParts[2]!.id, port: 0 }, via: [], points: [[0, 0, 0], [10, 0, 10]], length: 20 }],
    notes: [{ id: makeId(1, 10), pos: [5, 5, 5], text: 'hi', color: 'beam' }],
    counters: { '1': 11, '2': 2 },
  };
  it('round-trips and is deterministic', () => {
    const a = encodeWorld(world, { canonical: true });
    const b = encodeWorld({ ...world, parts: [...world.parts].reverse() }, { canonical: true });
    expect(a).toEqual(b); // canonical: input order doesn't matter
    const back = decodeWorld(a);
    expect(back.parts).toEqual([...world.parts].sort((x, y) => x.id - y.id));
    expect(back.links).toEqual(world.links);
    expect(back.notes).toEqual(world.notes);
    expect(back.title).toBe('Cat-o-Matic');
    expect(worldHash(back)).toBe(worldHash(world));
  });
  it('detects corruption', () => {
    const a = encodeWorld(world);
    const bad = a.slice();
    bad[bad.length - 6] = bad[bad.length - 6]! ^ 0xff;
    expect(() => decodeWorld(bad)).toThrow(FormatError);
    expect(() => decodeContainer(new TextEncoder().encode('NOPE'))).toThrow(FormatError);
  });
  it('compresses brush-like runs well', () => {
    const tiles: PartRecord[] = Array.from({ length: 5000 }, (_, i) => ({
      id: makeId(1, i + 1), type: 'topple_tile', pos: [i * 58, 0, 0], rot: snappedEuler(0, 0, 0), flags: 0,
    }));
    const bytes = encodeWorld({ ...EMPTY_WORLD, parts: tiles });
    expect(bytes.length).toBeLessThan(5000 * 3);
    expect(decodeWorld(bytes).parts.length).toBe(5000);
  });
  it('raw container keeps sections', () => {
    const bytes = encodeContainer({ magic: 'KNCP', flags: 0, header: { tick: 60 }, sections: [{ tag: 'JOLT', data: new Uint8Array([1, 2, 3]) }] });
    const c = decodeContainer(bytes);
    expect(c.header).toEqual({ tick: 60 });
    expect(c.sections[0]!.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});
