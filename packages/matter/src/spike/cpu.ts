// CPU reference for the Matter kernels: the same integer algorithm as wgsl.ts, written independently
// (per-grain gather instead of the GPU's atomic pair scatter) so a bit-identical match is real evidence.

import { CELL_COUNT, GRAIN_D, GRAVITY, JACOBI_ITERATIONS, RADIX_PASSES, SUBSTEPS, VMAX } from './constants.ts';
import { cellKey, clampI, collideStatic, contact, damp, grainHash, idiv, neighbourKey } from './imath.ts';
import type { MatterState } from './init.ts';

/** Wrapping u32 sums of x, y, z and of the per-grain hash. */
export type Checksum = readonly [number, number, number, number];

export function checksumHex(c: ArrayLike<number>): string {
  let s = '';
  for (let k = 0; k < 4; k++) s += ((c[k] ?? 0) >>> 0).toString(16).padStart(8, '0');
  return s;
}

export function checksumOf(st: MatterState): Checksum {
  let sx = 0, sy = 0, sz = 0, sh = 0;
  const { pos, vel } = st;
  for (let i = 0; i < st.n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    sx = (sx + x) >>> 0;
    sy = (sy + y) >>> 0;
    sz = (sz + z) >>> 0;
    sh = (sh + grainHash(i, x, y, z, vel[i * 3]!, vel[i * 3 + 1]!, vel[i * 3 + 2]!)) >>> 0;
  }
  return [sx, sy, sz, sh];
}

export class MatterCpu {
  readonly n: number;
  readonly pos: Int32Array;
  readonly vel: Int32Array;
  tick = 0;
  private stamp = 1;
  private readonly pred: Int32Array;
  private readonly sortedPred: Int32Array;
  private readonly delta: Int32Array;
  private readonly count: Int32Array;
  private readonly key: Uint32Array;
  private readonly sortedKey: Uint32Array;
  private readonly sortedIdx: Uint32Array;
  private readonly tmpKey: Uint32Array;
  private readonly tmpIdx: Uint32Array;
  // Cell ranges over 2²² cells; a per-substep stamp marks valid entries so nothing is cleared per tick.
  private readonly cellStart: Uint32Array;
  private readonly cellEnd: Uint32Array;
  private readonly cellStamp: Uint32Array;
  private readonly c = new Int32Array(3);

  constructor(init: MatterState) {
    this.n = init.n;
    this.pos = init.pos.slice();
    this.vel = init.vel.slice();
    this.pred = new Int32Array(this.n * 3);
    this.sortedPred = new Int32Array(this.n * 3);
    this.delta = new Int32Array(this.n * 3);
    this.count = new Int32Array(this.n);
    this.key = new Uint32Array(this.n);
    this.sortedKey = new Uint32Array(this.n);
    this.sortedIdx = new Uint32Array(this.n);
    this.tmpKey = new Uint32Array(this.n);
    this.tmpIdx = new Uint32Array(this.n);
    this.cellStart = new Uint32Array(CELL_COUNT);
    this.cellEnd = new Uint32Array(CELL_COUNT);
    this.cellStamp = new Uint32Array(CELL_COUNT);
  }

  state(): MatterState {
    return { n: this.n, pos: this.pos, vel: this.vel };
  }

  checksum(): Checksum {
    return checksumOf(this.state());
  }

  /** One 60 Hz matter tick. */
  step(): void {
    for (let s = 0; s < SUBSTEPS; s++) this.substep();
    this.tick++;
  }

  private substep(): void {
    const { n, pos, vel, pred, key } = this;
    for (let i = 0; i < n; i++) {
      const b = i * 3;
      pred[b] = (pos[b]! + vel[b]!) | 0;
      pred[b + 1] = (pos[b + 1]! + vel[b + 1]! - GRAVITY) | 0;
      pred[b + 2] = (pos[b + 2]! + vel[b + 2]!) | 0;
      key[i] = cellKey(pred[b]!, pred[b + 1]!, pred[b + 2]!);
    }
    this.sort();
    this.buildCells();
    for (let it = 0; it < JACOBI_ITERATIONS; it++) {
      this.solve();
      this.apply();
    }
    for (let i = 0; i < n * 3; i++) {
      vel[i] = clampI(damp((pred[i]! - pos[i]!) | 0), -VMAX, VMAX);
      pos[i] = pred[i]!;
    }
    this.stamp++;
  }

  /** Stable LSD radix sort of (key, index), 8 bits per pass; equals a stable sort by key. */
  private sort(): void {
    const n = this.n;
    let srcK = this.tmpKey, srcI = this.tmpIdx, dstK = this.sortedKey, dstI = this.sortedIdx;
    for (let i = 0; i < n; i++) { srcK[i] = this.key[i]!; srcI[i] = i; }
    // Arrange the ping-pong so the last pass lands in sortedKey/sortedIdx.
    if (RADIX_PASSES % 2 === 0) {
      dstK.set(srcK); dstI.set(srcI);
      [srcK, dstK] = [dstK, srcK];
      [srcI, dstI] = [dstI, srcI];
    }
    const offs = new Uint32Array(256);
    for (let pass = 0; pass < RADIX_PASSES; pass++) {
      const shift = pass * 8;
      offs.fill(0);
      for (let i = 0; i < n; i++) offs[(srcK[i]! >>> shift) & 255]!++;
      let sum = 0;
      for (let d = 0; d < 256; d++) { const c = offs[d]!; offs[d] = sum; sum += c; }
      for (let i = 0; i < n; i++) {
        const k = srcK[i]!;
        const o = offs[(k >>> shift) & 255]!++;
        dstK[o] = k;
        dstI[o] = srcI[i]!;
      }
      [srcK, dstK] = [dstK, srcK];
      [srcI, dstI] = [dstI, srcI];
    }
  }

  private buildCells(): void {
    const stamp = this.stamp;
    const keys = this.sortedKey;
    for (let s = 0; s < this.n; s++) {
      const k = keys[s]!;
      if (this.cellStamp[k] !== stamp) {
        this.cellStamp[k] = stamp;
        this.cellStart[k] = s;
      }
      this.cellEnd[k] = s + 1;
    }
  }

  private solve(): void {
    const { n, pred, delta, count, sortedKey, sortedIdx, sortedPred: sp, cellStart, cellEnd, cellStamp, c } = this;
    const stamp = this.stamp;
    const D2 = GRAIN_D * GRAIN_D;
    // Gather in sorted order from a sorted copy of the positions: neighbours are then contiguous.
    for (let s = 0; s < n; s++) {
      const j = sortedIdx[s]! * 3;
      sp[s * 3] = pred[j]!; sp[s * 3 + 1] = pred[j + 1]!; sp[s * 3 + 2] = pred[j + 2]!;
    }
    for (let s = 0; s < n; s++) {
      const i = sortedIdx[s]!;
      const px = sp[s * 3]!, py = sp[s * 3 + 1]!, pz = sp[s * 3 + 2]!;
      const k = sortedKey[s]!;
      const kx = k & 127;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          // Cells x-1, x, x+1 have consecutive keys (unless x wraps), so their sorted ranges are
          // adjacent: scan them as one run. Same pair set as the GPU's 27 separate cells.
          const k0 = neighbourKey(k, 0, dy, dz);
          const interior = kx > 0 && kx < 127;
          for (let r = interior ? 1 : 0; r < (interior ? 2 : 3); r++) {
            let lo = 0, hi = 0;
            if (interior) {
              for (let e = k0 - 1; e <= k0 + 1; e++) {
                if (cellStamp[e] !== stamp) continue;
                if (hi === 0) lo = cellStart[e]!;
                hi = cellEnd[e]!;
              }
            } else {
              const nk = neighbourKey(k0, r - 1, 0, 0);
              if (cellStamp[nk] !== stamp) continue;
              lo = cellStart[nk]!;
              hi = cellEnd[nk]!;
            }
            for (let t = lo, o = lo * 3; t < hi; t++, o += 3) {
              const qx = px - sp[o]!, qy = py - sp[o + 1]!, qz = pz - sp[o + 2]!;
              // Exact in doubles, so no per-axis pre-check is needed (the GPU has one to avoid i32 overflow).
              const d2 = qx * qx + qy * qy + qz * qz;
              if (d2 >= D2 || t === s) continue;
              contact(c, qx, qy, qz, d2, i < sortedIdx[t]!);
              ax += c[0]!; ay += c[1]!; az += c[2]!; cnt++;
            }
          }
        }
      }
      delta[i * 3] = ax; delta[i * 3 + 1] = ay; delta[i * 3 + 2] = az;
      count[i] = cnt;
    }
  }

  private apply(): void {
    const { n, pred, delta, count, pos } = this;
    for (let i = 0; i < n; i++) {
      const b = i * 3;
      const cnt = count[i]!;
      if (cnt > 0) {
        pred[b] = pred[b]! + idiv(delta[b]!, cnt);
        pred[b + 1] = pred[b + 1]! + idiv(delta[b + 1]!, cnt);
        pred[b + 2] = pred[b + 2]! + idiv(delta[b + 2]!, cnt);
      }
      collideStatic(pred, b, pos[b]!, pos[b + 2]!);
    }
  }
}
