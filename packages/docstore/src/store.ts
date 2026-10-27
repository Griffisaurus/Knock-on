// Client-side DocStore (ARCHITECTURE §6.1–6.2, MULTIPLAYER §5): optimistic local ops,
// rebasing on remote ops, ack/reject handling, and per-player undo with conflict skipping.

import { cloneTerrain, type EnvSettings, type LinkRecord, type Op, type PartId, type PartRecord, type TerrainRecord } from '@knockon/format';
import type { SimFlags } from '@knockon/format'; // MI (M4)
import { type Caps, DEFAULT_CAPS, WorldDoc, tryApply } from './world.ts';

interface Pending {
  readonly clientOpId: string;
  readonly op: Op;
  inverse: Op;
  touched: readonly PartId[];
}

interface UndoEntry {
  readonly op: Op; // the op as originally applied
  readonly inverse: Op;
  readonly touched: readonly PartId[];
  seq: number | null; // server seq once confirmed
}

export type DocEvent =
  | { readonly kind: 'applied'; readonly op: Op; readonly origin: 'local' | 'remote' }
  | { readonly kind: 'dropped'; readonly clientOpId: string; readonly reason: string };

export type UndoResult =
  | { readonly ok: true; readonly op: Op; readonly clientOpId: string }
  | { readonly ok: false; readonly reason: string };

export class DocStore {
  readonly doc: WorldDoc;
  private seq: number;
  private readonly pending: Pending[] = [];
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  /** Last writer per id: drives undo conflict detection. */
  private readonly lastTouch = new Map<PartId, { seq: number; slot: number }>();
  private nextLocal = 1;
  private readonly listeners = new Set<(e: DocEvent) => void>();

  readonly slot: number;
  private readonly caps: Caps;

  constructor(slot: number, doc: WorldDoc = new WorldDoc(), seq = 0, caps: Caps = DEFAULT_CAPS) {
    this.slot = slot;
    this.doc = doc;
    this.seq = seq;
    this.caps = caps;
  }

  get confirmedSeq(): number { return this.seq; }
  get pendingCount(): number { return this.pending.length; }

  on(fn: (e: DocEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: DocEvent): void { for (const fn of this.listeners) fn(e); }

  /** Apply a local edit optimistically. Returns the clientOpId to send, or null if invalid locally. */
  applyLocal(op: Op, opts: { recordUndo?: boolean } = {}): { clientOpId: string } | { error: string } {
    const r = tryApply(this.doc, op, this.caps);
    if (!r.ok) return { error: r.reason };
    const clientOpId = `${this.slot}:${this.nextLocal++}`;
    this.pending.push({ clientOpId, op, inverse: r.inverse, touched: r.touched });
    if (opts.recordUndo !== false) {
      this.undoStack.push({ op, inverse: r.inverse, touched: r.touched, seq: null });
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.emit({ kind: 'applied', op, origin: 'local' });
    return { clientOpId };
  }

  /** Server confirmed our oldest pending op at `seq` (acks arrive in send order). */
  onAck(clientOpId: string, seq: number): void {
    const p = this.pending[0];
    if (!p || p.clientOpId !== clientOpId) throw new Error(`ack out of order: ${clientOpId}`);
    this.pending.shift();
    this.seq = seq;
    for (const id of p.touched) this.lastTouch.set(id, { seq, slot: this.slot });
    const u = this.undoStack.find((e) => e.op === p.op && e.seq === null);
    if (u) u.seq = seq;
  }

  /** Server rejected one of our pending ops: drop it and rebase the rest. */
  onReject(clientOpId: string, reason: string): void {
    const idx = this.pending.findIndex((p) => p.clientOpId === clientOpId);
    if (idx < 0) return;
    const rejected = this.pending[idx]!;
    this.rewindPending();
    this.pending.splice(idx, 1);
    const ui = this.undoStack.findIndex((e) => e.op === rejected.op);
    if (ui >= 0) this.undoStack.splice(ui, 1);
    this.emit({ kind: 'dropped', clientOpId, reason });
    this.replayPending();
  }

  /** A confirmed op from the other player (or a server-issued op). */
  onRemote(seq: number, slot: number, op: Op): void {
    this.rewindPending();
    const r = tryApply(this.doc, op, { maxParts: Infinity });
    if (!r.ok) throw new Error(`remote op ${seq} failed to apply: ${r.reason} (desync)`);
    this.seq = seq;
    for (const id of r.touched) this.lastTouch.set(id, { seq, slot });
    this.emit({ kind: 'applied', op, origin: 'remote' });
    this.replayPending();
  }

  /**
   * The world exactly as the server has confirmed it, without our pending local ops. A run starts from
   * this (run.start's worldSeq): an edit still in flight would otherwise be in our machine and not in
   * our partner's.
   */
  confirmed(): { parts: PartRecord[]; links: LinkRecord[]; env: EnvSettings; terrain: TerrainRecord | null; simFlags: Required<SimFlags> } { // MI (M4): simFlags
    // S3: the Backlot terrain is run input too; a sculpted one is copied (strokes edit it in place)
    const terrain = (): TerrainRecord | null => { const t = this.doc.activeTerrain(); return t && t === this.doc.terrain ? cloneTerrain(t) : t; };
    if (!this.pending.length) return { parts: [...this.doc.parts.values()], links: [...this.doc.links.values()], env: this.doc.env, terrain: terrain(), simFlags: this.doc.simFlags };
    this.rewindPending();
    try {
      return { parts: [...this.doc.parts.values()], links: [...this.doc.links.values()], env: this.doc.env, terrain: terrain(), simFlags: this.doc.simFlags };
    } finally {
      this.replayPending();
    }
  }

  /** Undo the local player's most recent op. Skips (with a reason) if the partner changed it since. */
  undo(): UndoResult {
    const e = this.undoStack.at(-1);
    if (!e) return { ok: false, reason: 'Nothing to undo' };
    this.undoStack.pop();
    if (this.conflicts(e)) return { ok: false, reason: 'Your partner changed that since. Skipped.' };
    const res = this.applyLocal(e.inverse, { recordUndo: false });
    if ('error' in res) return { ok: false, reason: res.error };
    this.redoStack.push(e);
    return { ok: true, op: e.inverse, clientOpId: res.clientOpId };
  }

  redo(): UndoResult {
    const e = this.redoStack.pop();
    if (!e) return { ok: false, reason: 'Nothing to redo' };
    const res = this.applyLocal(e.op, { recordUndo: false });
    if ('error' in res) return { ok: false, reason: res.error };
    this.undoStack.push({ ...e, seq: null });
    return { ok: true, op: e.op, clientOpId: res.clientOpId };
  }

  private conflicts(e: UndoEntry): boolean {
    for (const id of e.touched) {
      const t = this.lastTouch.get(id);
      if (t && t.slot !== this.slot && (e.seq === null || t.seq > e.seq)) return true;
    }
    return false;
  }

  private rewindPending(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const r = tryApply(this.doc, this.pending[i]!.inverse, { maxParts: Infinity });
      if (!r.ok) throw new Error(`pending rewind failed: ${r.reason}`);
    }
  }

  private replayPending(): void {
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i]!;
      const r = tryApply(this.doc, p.op, this.caps);
      if (r.ok) {
        p.inverse = r.inverse;
        p.touched = r.touched;
      } else {
        // The remote op made this pending op impossible; the server will reject it too.
        this.pending.splice(i, 1);
        i--;
        this.emit({ kind: 'dropped', clientOpId: p.clientOpId, reason: r.reason });
      }
    }
  }
}
