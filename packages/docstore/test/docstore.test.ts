import { describe, expect, it } from 'vitest';
import { makeId, type Op, type PartRecord } from '@knockon/format';
import { DocStore, WorldDoc, tryApply } from '../src/index.ts';

const part = (slot: number, n: number, x = 0): PartRecord => ({ id: makeId(slot, n), type: 'thud', pos: [x, 0, 0], rot: { tag: 0 }, flags: 0 });

function snapshot(d: WorldDoc): unknown {
  const sort = <T extends { id: number }>(m: Map<number, T>): T[] => [...m.values()].sort((a, b) => a.id - b.id);
  return { parts: sort(d.parts), links: sort(d.links), notes: sort(d.notes), env: d.env };
}

describe('tryApply', () => {
  it('applies and inverts every op kind', () => {
    const d = new WorldDoc();
    const before = snapshot(d);
    const a = part(1, 1), b = part(1, 2, 640);
    const ops: Op[] = [
      { k: 'PartAdd', part: a },
      { k: 'PartAdd', part: b },
      { k: 'PartUpdate', id: a.id, patch: { pos: [5, 5, 5], flags: 8, props: [[0, 3]] } },
      { k: 'LinkAdd', link: { id: makeId(1, 3), kind: 'line', from: { part: a.id, port: 0 }, to: { part: b.id, port: 0 }, via: [], points: [], length: 640 } },
      { k: 'EnvUpdate', patch: { gravity: 16 } },
      { k: 'NoteAdd', note: { id: makeId(1, 4), pos: [0, 0, 0], text: 'hi', color: 'beam' } },
      { k: 'NoteUpdate', id: makeId(1, 4), text: 'hello' },
      { k: 'PartRemove', ids: [b.id] }, // cascades the link
    ];
    const inverses: Op[] = [];
    for (const op of ops) {
      const r = tryApply(d, op);
      expect(r.ok).toBe(true);
      if (r.ok) inverses.push(r.inverse);
    }
    expect(d.links.size).toBe(0); // link removed with its endpoint
    for (const inv of inverses.reverse()) expect(tryApply(d, inv).ok).toBe(true);
    expect(snapshot(d)).toEqual(before);
  });

  it('is atomic: a failing batch changes nothing', () => {
    const d = new WorldDoc();
    tryApply(d, { k: 'PartAdd', part: part(1, 1) });
    const before = snapshot(d);
    const r = tryApply(d, { k: 'Batch', ops: [{ k: 'PartAdd', part: part(1, 2) }, { k: 'PartUpdate', id: 999, patch: { flags: 1 } }] });
    expect(r.ok).toBe(false);
    expect(snapshot(d)).toEqual(before);
  });

  it('enforces capacity and known types', () => {
    const d = new WorldDoc();
    expect(tryApply(d, { k: 'PartAdd', part: part(1, 1) }, { maxParts: 1 }).ok).toBe(true);
    const r = tryApply(d, { k: 'PartAdd', part: part(1, 2) }, { maxParts: 1 });
    expect(r).toEqual({ ok: false, reason: 'OVER_CAPACITY' });
    expect(tryApply(d, { k: 'PartAdd', part: { ...part(1, 3), type: 'nope' } }, { maxParts: 10, knownTypes: new Set(['thud']) }).ok).toBe(false);
  });
});

/** Minimal in-memory host: orders ops, validates, acks the sender, relays to the other. */
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

describe('DocStore multiplayer reconciliation', () => {
  it('two players converge on the same world', () => {
    const host = new FakeHost();
    const p1 = new DocStore(1), p2 = new DocStore(2);
    host.clients.set(1, p1).set(2, p2);
    const local = (s: DocStore, op: Op): void => {
      const r = s.applyLocal(op);
      if ('clientOpId' in r) host.send(s.slot, r.clientOpId, op);
    };
    local(p1, { k: 'PartAdd', part: part(1, 1) });
    local(p2, { k: 'PartAdd', part: part(2, 1, 64) });
    local(p1, { k: 'PartUpdate', id: makeId(1, 1), patch: { pos: [10, 0, 0] } });
    local(p2, { k: 'PartUpdate', id: makeId(1, 1), patch: { pos: [20, 0, 0] } }); // fails locally: p2 hasn't seen it yet
    host.deliverAll();
    local(p2, { k: 'PartUpdate', id: makeId(1, 1), patch: { pos: [20, 0, 0] } });
    host.deliverAll();
    expect(snapshot(p1.doc)).toEqual(snapshot(host.doc));
    expect(snapshot(p2.doc)).toEqual(snapshot(host.doc));
    expect(host.doc.parts.get(makeId(1, 1))!.pos).toEqual([20, 0, 0]);
    expect(p1.pendingCount + p2.pendingCount).toBe(0);
  });

  it('rejected ops roll back cleanly', () => {
    const host = new FakeHost();
    const p1 = new DocStore(1), p2 = new DocStore(2);
    host.clients.set(1, p1).set(2, p2);
    const r1 = p1.applyLocal({ k: 'PartAdd', part: part(1, 1) });
    host.send(1, (r1 as { clientOpId: string }).clientOpId, { k: 'PartAdd', part: part(1, 1) });
    host.deliverAll();
    // both remove the same part concurrently; the second is rejected by the host
    const a = p1.applyLocal({ k: 'PartRemove', ids: [makeId(1, 1)] });
    const b = p2.applyLocal({ k: 'PartRemove', ids: [makeId(1, 1)] });
    host.send(1, (a as { clientOpId: string }).clientOpId, { k: 'PartRemove', ids: [makeId(1, 1)] });
    host.send(2, (b as { clientOpId: string }).clientOpId, { k: 'PartRemove', ids: [makeId(1, 1)] });
    host.deliverAll();
    expect(snapshot(p1.doc)).toEqual(snapshot(host.doc));
    expect(snapshot(p2.doc)).toEqual(snapshot(host.doc));
  });

  it('undo only touches your own ops and skips conflicts', () => {
    const host = new FakeHost();
    const p1 = new DocStore(1), p2 = new DocStore(2);
    host.clients.set(1, p1).set(2, p2);
    const send = (s: DocStore, r: { clientOpId: string } | { error: string }, op: Op): void => {
      if ('clientOpId' in r) host.send(s.slot, r.clientOpId, op);
    };
    const add: Op = { k: 'PartAdd', part: part(1, 1) };
    send(p1, p1.applyLocal(add), add);
    host.deliverAll();
    const mv: Op = { k: 'PartUpdate', id: makeId(1, 1), patch: { pos: [99, 0, 0] } };
    send(p1, p1.applyLocal(mv), mv);
    host.deliverAll();
    const mv2: Op = { k: 'PartUpdate', id: makeId(1, 1), patch: { pos: [5, 5, 5] } };
    send(p2, p2.applyLocal(mv2), mv2);
    host.deliverAll();
    const u = p1.undo(); // p1's last op (the move) was overwritten by p2
    expect(u.ok).toBe(false);
    const u2 = p2.undo(); // p2 can undo its own move
    expect(u2.ok).toBe(true);
    if (u2.ok) host.send(2, u2.clientOpId, u2.op);
    host.deliverAll();
    expect(host.doc.parts.get(makeId(1, 1))!.pos).toEqual([99, 0, 0]);
    expect(snapshot(p1.doc)).toEqual(snapshot(host.doc));
  });
});

describe('DocStore.confirmed', () => {
  it('is the server-confirmed world: pending local ops are left out, and stay applied', () => {
    const s = new DocStore(1);
    const a = part(1, 1), b = part(1, 2, 640);
    const ra = s.applyLocal({ k: 'PartAdd', part: a });
    if ('error' in ra) throw new Error(ra.error);
    s.onAck(ra.clientOpId, 1);
    s.onRemote(2, 2, { k: 'PartAdd', part: part(2, 1, 1280) });
    s.applyLocal({ k: 'PartAdd', part: b }); // in flight when the run starts
    s.applyLocal({ k: 'PartUpdate', id: a.id, patch: { pos: [9, 9, 9] } });
    const c = s.confirmed();
    expect(c.parts.map((p) => p.id).sort()).toEqual([a.id, makeId(2, 1)].sort());
    expect(c.parts.find((p) => p.id === a.id)!.pos).toEqual([0, 0, 0]);
    expect(s.doc.parts.has(b.id)).toBe(true);
    expect(s.doc.parts.get(a.id)!.pos).toEqual([9, 9, 9]);
    expect(s.pendingCount).toBe(2);
  });
});
