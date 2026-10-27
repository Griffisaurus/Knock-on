// The Matter host's view of a backend (D92): a synchronous link, so the Machine's tick stays synchronous everywhere.
//
//   Node:     SyncBackendLink calls the CPU backend's synchronous twins inline (MI request 1).
//   Browser:  the sim worker's link (apps/game/src/matterhost.ts, MatterWorkerLink) posts each command to the main
//             thread, where the GPU backend runs on the renderer's device, and blocks in Atomics.wait only when the
//             sim reaches the rigid tick that needs a result that isn't back yet (time dilation, never a skip).
//
// Order is the link's job: commands, snapshots and restores are executed in the order the host issues them, and a
// restore discards every result of the timeline it replaces.

import type { MatterBackendSync, MatterStepIn, MatterStepOut } from './contract.ts';

/** A Matter snapshot: the bytes (CPU) or a slot the link keeps on the other side (GPU host). */
export interface MatterSnapRef {
  readonly id: number;
  readonly bytes?: Uint8Array;
}

export interface MatterLink {
  readonly kind: string;
  /** Queues Matter tick `input.tick` (strictly increasing within a timeline). */
  submit(input: MatterStepIn): void;
  /** The result of a submitted Matter tick; blocks (dilates) until it's back. */
  take(tick: number): MatterStepOut;
  /** Snapshot of the state after the last submitted tick. */
  snapshot(): MatterSnapRef;
  /** Starts a new timeline from a snapshot (or adopted bytes); results of the old one are dropped. */
  restore(ref: MatterSnapRef): void;
  /** A snapshot's bytes (desync repair export); may block on a remote link. */
  bytes(ref: MatterSnapRef): Uint8Array;
  /** Forgets a snapshot (its checkpoint was dropped). */
  release(ref: MatterSnapRef): void;
  destroy(): void;
  /** Optional: told the absolute Matter tick of backend tick 0 (−1 while dormant) when it changes (playback mirrors). */
  meta?(first: number): void;
}

/** The backend tick a snapshot was taken at, from MX's MATR header ('MTR1', version, tick …), or −1. */
export function snapshotTick(bytes: Uint8Array): number {
  if (bytes.length < 12) return -1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(0, true) === 0x3152544d ? dv.getUint32(8, true) : -1;
}

/** Node: the CPU backend's synchronous methods, inline. */
export class SyncBackendLink implements MatterLink {
  readonly kind = 'cpu-sync';
  private readonly out = new Map<number, MatterStepOut>();
  private nextId = 1;

  private readonly be: MatterBackendSync;
  // (no parameter properties: the host and soaks run this file with Node's type stripping)
  constructor(be: MatterBackendSync) { this.be = be; }

  submit(input: MatterStepIn): void {
    this.out.set(input.tick, this.be.stepSync(input));
  }

  take(tick: number): MatterStepOut {
    const r = this.out.get(tick);
    if (!r) throw new Error(`matter: no result for matter tick ${tick} (never submitted)`);
    this.out.delete(tick);
    return r;
  }

  snapshot(): MatterSnapRef { return { id: this.nextId++, bytes: this.be.snapshotSync() }; }

  restore(ref: MatterSnapRef): void {
    if (!ref.bytes) throw new Error('matter: a CPU snapshot has no bytes');
    this.out.clear();
    this.be.restoreSync(ref.bytes);
  }

  bytes(ref: MatterSnapRef): Uint8Array {
    if (!ref.bytes) throw new Error('matter: a CPU snapshot has no bytes');
    return ref.bytes;
  }

  release(_ref: MatterSnapRef): void { /* bytes are garbage collected with the checkpoint */ }

  destroy(): void { this.be.destroy(); this.out.clear(); }
}
