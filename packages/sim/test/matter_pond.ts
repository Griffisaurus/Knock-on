// A still pond for the D101 buoyancy tests: a synthetic Matter backend whose only water is a flat pool (level and
// floor in metres over an x–z rectangle) that it reports through the water-surface map, with no particles to push
// anything. Bodies float on Jolt's buoyancy alone, against an exact level, so float depths can be checked tightly.
// `flow` (m/s) sets the water's velocity. Deterministic (integers), snapshots carry only the tick. Never shipped.

import type { MatterBackendSync, MatterStepIn, MatterStepOut } from '../src/matter/contract.ts';

const U = 65536;

export interface PondOptions { level: number; floor?: number; min: readonly [number, number]; max: readonly [number, number]; flow?: readonly [number, number, number] }

export class PondMatter implements MatterBackendSync {
  readonly kind = 'cpu' as const;
  private tick = 0;
  private readonly o: PondOptions;
  /** Surface requests seen (tests check the host asks for maps). */
  requests = 0;

  constructor(o: PondOptions) { this.o = o; }

  initSync(): void { this.tick = 0; }
  async init(): Promise<void> { this.initSync(); }

  stepSync(input: MatterStepIn): MatterStepOut {
    this.tick = input.tick;
    const o = this.o, floor = o.floor ?? 0;
    const out: MatterStepOut = {
      tick: input.tick,
      impulses: input.proxies.filter((p) => p.dynamic).map((p) => ({ id: p.id, lin: new Int32Array(3), ang: new Int32Array(3) })),
      absorbed: input.intakes.map((it) => ({ id: it.id, counts: new Int32Array(3) })),
      counts: Int32Array.of(0, 1, 0),
      checksum: [input.tick >>> 0, 0x504f4e44],
      bounds: Int32Array.of(Math.round(o.min[0] * U), Math.round(floor * U), Math.round(o.min[1] * U), Math.round(o.max[0] * U), Math.round(o.level * U), Math.round(o.max[1] * U)),
    };
    const r = input.surface;
    if (r) {
      this.requests++;
      const nc = r.nx * r.nz;
      const count = new Int32Array(nc), top = new Int32Array(nc).fill(-2147483648), bottom = new Int32Array(nc).fill(-2147483648), vel = new Int32Array(nc * 3);
      const cellM = r.cell / U;
      // a full column: the top particle centres half a spacing under the level, the lowest half a spacing over the floor
      const n = Math.round(((o.level - floor) * cellM * cellM) / 1.05e-6);
      for (let iz = 0; iz < r.nz; iz++) for (let ix = 0; ix < r.nx; ix++) {
        const cx = (r.x0 + (ix + 0.5) * r.cell) / U, cz = (r.z0 + (iz + 0.5) * r.cell) / U;
        if (cx < o.min[0] || cx > o.max[0] || cz < o.min[1] || cz > o.max[1]) continue;
        const c = iz * r.nx + ix;
        count[c] = n;
        top[c] = Math.round((o.level - 0.005) * U);
        bottom[c] = Math.round((floor + 0.005) * U);
        for (let a = 0; a < 3; a++) vel[c * 3 + a] = Math.round(((o.flow?.[a] ?? 0) * U) / 60);
      }
      out.surface = { ...r, count, top, bottom, vel };
    }
    return out;
  }

  async step(input: MatterStepIn): Promise<MatterStepOut> { return this.stepSync(input); }
  snapshotSync(): Uint8Array { return Uint8Array.of(this.tick & 255, (this.tick >> 8) & 255, (this.tick >> 16) & 255, 0); }
  async snapshot(): Promise<Uint8Array> { return this.snapshotSync(); }
  restoreSync(b: Uint8Array): void { this.tick = b[0]! | (b[1]! << 8) | (b[2]! << 16); }
  async restore(b: Uint8Array): Promise<void> { this.restoreSync(b); }
  destroy(): void { /* nothing */ }
}
