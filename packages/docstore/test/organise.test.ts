// M2 stream D: groups, layers and modules through tryApply and the multiplayer DocStore.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, decodeWorld, encodeModule, encodeWorld, makeId, makeSmallId, moduleFromSelection, moduleIdCount,
  type LinkRecord, type Op, type PartRecord,
} from '@knockon/format';
import { DocStore, WorldDoc, tryApply } from '../src/index.ts';

const part = (slot: number, n: number, x = 0): PartRecord => ({ id: makeId(slot, n), type: 'thud', pos: [x, 0, 0], rot: { tag: 0 }, flags: 0 });

function snap(d: WorldDoc): unknown {
  const sort = <T extends { id: number }>(m: Map<number, T>): T[] => [...m.values()].sort((a, b) => a.id - b.id);
  // a cleared field and an absent one are the same thing
  const norm = (p: PartRecord): PartRecord => {
    const o: Record<string, unknown> = { ...p };
    for (const k of ['layer', 'group']) if (!o[k]) delete o[k];
    return o as unknown as PartRecord;
  };
  return { parts: sort(d.parts).map(norm), links: sort(d.links), groups: sort(d.groups), layers: sort(d.layers), modules: sort(d.modules) };
}

function moduleBlob(): { blob: Uint8Array; count: number } {
  const parts = new Map<number, PartRecord>([[makeId(9, 1), part(9, 1)], [makeId(9, 2), part(9, 2, 640)]]);
  const links = new Map<number, LinkRecord>([[makeId(9, 3), {
    id: makeId(9, 3), kind: 'line', from: { part: makeId(9, 1), port: 0 }, to: { part: makeId(9, 2), port: 0 }, via: [], points: [], length: 640,
  }]]);
  const def = moduleFromSelection(parts, links, [makeId(9, 1), makeId(9, 2)], { name: 'Pair', origin: [0, 0, 0] });
  return { blob: encodeModule(def), count: moduleIdCount(def) };
}

describe('organisation ops in tryApply', () => {
  it('apply and invert: layers, groups, modules, placement', () => {
    const d = new WorldDoc();
    for (const n of [1, 2, 3]) tryApply(d, { k: 'PartAdd', part: part(1, n, n * 64) });
    const before = snap(d);
    const L = makeSmallId(1, 1), G = makeSmallId(1, 2), G2 = makeSmallId(1, 3), M = makeSmallId(1, 4);
    const { blob, count } = moduleBlob();
    const ops: Op[] = [
      { k: 'LayerSet', id: L, name: 'Booms', flags: 0 },
      { k: 'PartUpdate', id: makeId(1, 1), patch: { layer: L } },
      { k: 'LayerSet', id: L, name: 'Big booms', flags: 3 },
      { k: 'GroupSet', id: G, name: 'Trap', parent: 0, members: [makeId(1, 1), makeId(1, 2)] },
      { k: 'GroupSet', id: G2, name: 'Inner', parent: G, members: [makeId(1, 2)] }, // moves part 2 from G to G2
      { k: 'GroupSet', id: G, name: 'Trap!', parent: 0, members: null }, // rename only
      { k: 'ModuleSave', id: M, name: 'Pair', blob },
      { k: 'ModulePlace', moduleId: M, transform: { pos: [6400, 0, 0], quarter: 2 }, idBase: makeId(1, 10), count, layer: L },
      { k: 'GroupSet', id: G, name: null, parent: 0, members: null }, // ungroup: clears part 1's group
      { k: 'LayerSet', id: L, name: null, flags: 0 }, // remove layer: its parts go to the default layer
      { k: 'ModuleSave', id: M, name: 'Pair', blob: null },
    ];
    const inverses: Op[] = [];
    for (const op of ops) {
      const r = tryApply(d, op);
      expect(r.ok, `${op.k}: ${r.ok ? '' : r.reason}`).toBe(true);
      if (r.ok) inverses.push(r.inverse);
      if (op.k === 'GroupSet' && op.id === G2) {
        expect(d.parts.get(makeId(1, 1))!.group).toBe(G);
        expect(d.parts.get(makeId(1, 2))!.group).toBe(G2);
      }
      if (op.k === 'ModulePlace') {
        expect(d.parts.get(makeId(1, 11))).toMatchObject({ type: 'thud', pos: [6400, 0, 0], layer: L });
        expect(d.parts.get(makeId(1, 12))).toMatchObject({ pos: [6400 - 640, 0, 0] }); // half turn
        expect(d.links.get(makeId(1, 13))).toMatchObject({ from: { part: makeId(1, 11), port: 0 }, to: { part: makeId(1, 12), port: 0 } });
      }
    }
    expect(d.groups.has(G)).toBe(false);
    expect(d.parts.get(makeId(1, 1))!.group ?? 0).toBe(0);
    expect(d.parts.get(makeId(1, 1))!.layer ?? 0).toBe(0);
    expect(d.parts.get(makeId(1, 11))!.layer ?? 0).toBe(0);
    for (const inv of inverses.reverse()) expect(tryApply(d, inv).ok).toBe(true);
    expect(snap(d)).toEqual(before);
  });

  it('rejects bad organisation ops atomically', () => {
    const d = new WorldDoc();
    tryApply(d, { k: 'PartAdd', part: part(1, 1) });
    const before = snap(d);
    const M = makeSmallId(1, 4);
    const bad: Op[] = [
      { k: 'GroupSet', id: makeSmallId(1, 1), name: 'x', parent: 0, members: [makeId(1, 99)] }, // missing member
      { k: 'GroupSet', id: makeSmallId(1, 1), name: 'x', parent: makeSmallId(1, 7), members: null }, // missing parent
      { k: 'GroupSet', id: makeSmallId(1, 1), name: null, parent: 0, members: null }, // remove missing
      { k: 'LayerSet', id: makeSmallId(1, 1), name: null, flags: 0 },
      { k: 'ModuleSave', id: M, name: 'junk', blob: new Uint8Array([1, 2, 3]) }, // not a .knockmod
      { k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, 0], quarter: 0 }, idBase: makeId(1, 10), count: 3, layer: 0 }, // no module
    ];
    for (const op of bad) expect(tryApply(d, op).ok, op.k).toBe(false);
    // a placement whose ids collide is rejected whole
    const { blob, count } = moduleBlob();
    expect(tryApply(d, { k: 'ModuleSave', id: M, name: 'Pair', blob }).ok).toBe(true);
    expect(tryApply(d, { k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, 0], quarter: 0 }, idBase: makeId(1, 10), count: count + 1, layer: 0 }).ok).toBe(false);
    const mid = snap(d);
    expect(tryApply(d, { k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, 0], quarter: 0 }, idBase: makeId(1, 1) - 1, count, layer: 0 }).ok).toBe(false); // id 1:1 exists
    expect(snap(d)).toEqual(mid);
    // group cycles
    const A = makeSmallId(1, 1), B = makeSmallId(1, 2);
    expect(tryApply(d, { k: 'GroupSet', id: A, name: 'A', parent: 0, members: null }).ok).toBe(true);
    expect(tryApply(d, { k: 'GroupSet', id: B, name: 'B', parent: A, members: null }).ok).toBe(true);
    expect(tryApply(d, { k: 'GroupSet', id: A, name: 'A', parent: B, members: null }).ok).toBe(false);
    void before;
  });

  it('organisation survives a save / load', () => {
    const d = new WorldDoc();
    tryApply(d, { k: 'PartAdd', part: part(1, 1) });
    tryApply(d, { k: 'LayerSet', id: makeSmallId(1, 1), name: 'Booms', flags: 1 });
    tryApply(d, { k: 'GroupSet', id: makeSmallId(1, 2), name: 'Trap', parent: 0, members: [makeId(1, 1)] });
    tryApply(d, { k: 'ModuleSave', id: makeSmallId(1, 3), name: 'Pair', blob: moduleBlob().blob });
    const back = WorldDoc.fromSnapshot(decodeWorld(encodeWorld(d.toSnapshot({ ...EMPTY_WORLD, counters: {} }))));
    expect(snap(back)).toEqual(snap(d));
    expect(back.moduleDef(makeSmallId(1, 3))!.parts).toHaveLength(2);
  });
});

/** Minimal in-memory host (as in docstore.test.ts). */
class FakeHost {
  doc = new WorldDoc();
  seq = 0;
  clients = new Map<number, DocStore>();
  inbox: { from: number; clientOpId: string; op: Op }[] = [];
  send(from: number, clientOpId: string, op: Op): void { this.inbox.push({ from, clientOpId, op }); }
  deliverAll(): void {
    while (this.inbox.length) {
      const m = this.inbox.shift()!;
      const r = tryApply(this.doc, m.op);
      const sender = this.clients.get(m.from)!;
      if (!r.ok) { sender.onReject(m.clientOpId, r.reason); continue; }
      this.seq++;
      sender.onAck(m.clientOpId, this.seq);
      for (const [slot, c] of this.clients) if (slot !== m.from) c.onRemote(this.seq, m.from, m.op);
    }
  }
}

describe('organisation in multiplayer', () => {
  it('both players converge: layers, groups, a shared module placed by each', () => {
    const host = new FakeHost();
    const a = new DocStore(1), b = new DocStore(2);
    host.clients.set(1, a); host.clients.set(2, b);
    const submit = (s: DocStore, op: Op): void => {
      const r = s.applyLocal(op);
      if ('error' in r) throw new Error(r.error);
      host.send(s.slot, r.clientOpId, op);
    };
    const M = makeSmallId(1, 1);
    const { blob, count } = moduleBlob();
    submit(a, { k: 'PartAdd', part: part(1, 1) });
    submit(a, { k: 'ModuleSave', id: M, name: 'Pair', blob });
    submit(b, { k: 'LayerSet', id: makeSmallId(2, 1), name: 'Jo', flags: 0 });
    host.deliverAll();
    // both place the shared module at the same time, each in its own id namespace
    submit(a, { k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, 640], quarter: 1 }, idBase: makeId(1, 1), count, layer: 0 });
    submit(b, { k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, -640], quarter: 3 }, idBase: makeId(2, 1) - 1, count, layer: makeSmallId(2, 1) });
    submit(b, { k: 'GroupSet', id: makeSmallId(2, 2), name: 'Mine', parent: 0, members: [makeId(2, 1), makeId(2, 2)] });
    // a hides Jo's layer (layer state is shared)
    submit(a, { k: 'LayerSet', id: makeSmallId(2, 1), name: 'Jo', flags: 1 });
    host.deliverAll();
    expect(snap(a.doc)).toEqual(snap(host.doc));
    expect(snap(b.doc)).toEqual(snap(host.doc));
    expect(host.doc.parts.size).toBe(1 + 2 * 2);
    expect(host.doc.links.size).toBe(2);
    expect(host.doc.layers.get(makeSmallId(2, 1))!.flags).toBe(1);
    // per-player undo of a placement removes exactly that placement
    const u = a.undo();
    expect(u.ok).toBe(true);
    if (u.ok) host.send(1, u.clientOpId, u.op);
    host.deliverAll();
    expect(a.doc.parts.size).toBe(1 + 2 * 2); // a's last op was the layer flag change
    const u2 = a.undo();
    if (u2.ok) host.send(1, u2.clientOpId, u2.op);
    host.deliverAll();
    expect(host.doc.parts.has(makeId(1, 2))).toBe(false);
    expect(host.doc.parts.has(makeId(2, 1))).toBe(true);
    expect(snap(b.doc)).toEqual(snap(host.doc));
  });
});
