// A tiny synchronous stand-in for MX's Matter backend (M4_PLAN contract 1), for critter tests only: grains drop
// straight to the floor where they're emitted (jittered over `spread`), sit still, and leave through any intake whose
// box holds them (kindMask, up to the per-command capacity). No contacts, no impulses. Integer state, so snapshots,
// restores and checksums are exact. Stream B4 uses it to drive DUSTY's vacuum through the real `machine.matter`.

import type { MatterBackendSync, MatterStepIn, MatterStepOut } from '../src/matter/contract.ts';

const GRAIN_Y = 128; // units: a 4 mm grain resting on the floor

export class FakeMatter implements MatterBackendSync {
  readonly kind = 'cpu' as const;
  /** x, y, z (units), kind per grain. */
  private g: number[] = [];
  private tick = -1;

  initSync(): void { this.g = []; }
  async init(): Promise<void> { this.initSync(); }

  stepSync(input: MatterStepIn): MatterStepOut {
    this.tick = input.tick;
    for (const e of input.emits) {
      for (let n = 0; n < e.count; n++) {
        // deterministic jitter from the emit's seed and the grain's index
        let h = (e.seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
        const jx = ((h & 0xffff) / 0xffff - 0.5) * 2 * e.spread;
        const jz = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 2 * e.spread;
        this.g.push(Math.round(e.pos[0]! + jx), GRAIN_Y, Math.round(e.pos[2]! + jz), e.kind);
      }
    }
    const absorbed: { id: number; counts: Int32Array }[] = [];
    for (const it of [...input.intakes].sort((a, b) => a.id - b.id)) {
      const counts = new Int32Array(3);
      let left = it.capacity;
      const keep: number[] = [];
      for (let i = 0; i < this.g.length; i += 4) {
        const [x, y, z, k] = [this.g[i]!, this.g[i + 1]!, this.g[i + 2]!, this.g[i + 3]!];
        const inside = left > 0 && (it.kindMask >> k) & 1 && x >= it.min[0]! && x <= it.max[0]! && y >= it.min[1]! && y <= it.max[1]! && z >= it.min[2]! && z <= it.max[2]!;
        if (inside) { counts[k]!++; left--; } else keep.push(x, y, z, k);
      }
      this.g = keep;
      absorbed.push({ id: it.id, counts });
    }
    const counts = new Int32Array(3);
    let sx = 0, sz = 0;
    for (let i = 0; i < this.g.length; i += 4) { counts[this.g[i + 3]!]!++; sx = (sx + this.g[i]!) | 0; sz = (sz + this.g[i + 2]!) | 0; }
    return { tick: input.tick, impulses: [], absorbed, counts, checksum: [sx >>> 0, sz >>> 0] };
  }
  async step(input: MatterStepIn): Promise<MatterStepOut> { return this.stepSync(input); }

  snapshotSync(): Uint8Array { return new Uint8Array(Int32Array.from([this.tick, ...this.g]).buffer.slice(0)); }
  async snapshot(): Promise<Uint8Array> { return this.snapshotSync(); }
  restoreSync(bytes: Uint8Array): void {
    const a = new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    this.tick = a[0]!;
    this.g = Array.from(a.subarray(1));
  }
  async restore(bytes: Uint8Array): Promise<void> { this.restoreSync(bytes); }
  destroy(): void { this.g = []; }
}
