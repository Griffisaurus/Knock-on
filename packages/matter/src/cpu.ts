// CPU reference backend (MatterBackend + the synchronous twins MI asked for). The same integer algorithm as the
// WGSL kernels, written independently: a stable LSD radix sort instead of the GPU's atomic count sort + rank,
// per-particle gathers with direct adds instead of atomics, exact doubles instead of 64-bit split multiplies, and a
// sequential capacity count instead of the GPU's threshold search. GPU = CPU bit for bit is the determinism proof.

import {
  KIND_COUNT, type MatterBackendSync, type MatterConfig, type MatterStepIn, type MatterStepOut,
} from './backend.ts';
import {
  CELL, DMAX, FLUID, GOO_ADH, GOO_BAND, GOO_H, GOO_KC, GOO_REST, GOO_STICK, GOO_VISC, ITERATIONS, KEY_BASE, KEY_RB, KEY_XB, KILL_XZ, KILL_Y,
  MASS_MG, MU_K, MU_S, PEN_MAX, PROXY_STRIDE, RADIUS, SUBSTEPS, TABLE, VMAX, crossShare, INTAKE_INDEX_BITS,
} from './constants.ts';
import { cellTag, rowHash, clampI, damp, shrS, fmix32, grainHash, grainHash2, idiv, isqrt, normDist, ucell, add64, sar64 } from './imath.ts';
import { decodeMatr, encodeMatr, finishChecksum } from './payload.ts';
import {
  P_C, P_E, P_MAX, P_MIN, P_R, P_RAD, P_SHAPE, P_SLOT, P_V, P_W, SURF_WORDS, gravityAt, nearResult, pbucket, prepareTick, surfaceCell,
  surfaceResult, type TickPack,
} from './prep.ts';

const SHARE: number[] = [];
for (let a = 0; a < KIND_COUNT; a++) for (let b = 0; b < KIND_COUNT; b++) SHARE.push(crossShare(a, b));
const MAX_RUNS = 64;

/** Range kernels of one substep, in order (see MatterCpu.exec). */
export const PHASES = ['predict', 'permute', 'zero', 'sand', 'wdens', 'wsolve', 'marble', 'goo', 'apply', 'finish'] as const;
export type Phase = typeof PHASES[number];

export class MatterCpu implements MatterBackendSync {
  readonly kind = 'cpu' as const;
  capacity = 0;
  seed = 0;
  n = 0;
  tick = 0;
  pos = new Int32Array(0);
  vel = new Int32Array(0);
  mat = new Uint32Array(0);
  private pred = new Int32Array(0);
  private posB = new Int32Array(0);
  private velB = new Int32Array(0);
  private matB = new Uint32Array(0);
  private predB = new Int32Array(0);
  private key = new Uint32Array(0);
  private keyB = new Uint32Array(0);
  private tag = new Uint32Array(0);
  private tagB = new Uint32Array(0);
  private ord = new Uint32Array(0);
  private ordB = new Uint32Array(0);
  private acc = new Int32Array(0);
  private fdisp = new Int32Array(0);
  private dens = new Int32Array(0);
  /** Normal approach already booked as impulse this substep, per slot (a particle reaches the surface velocity once). */
  private appr = new Int32Array(0);
  private cellStart = new Uint32Array(0);
  private cellEnd = new Uint32Array(0);
  private cellStamp = new Uint32Array(0);
  private stamp = 0;
  private waterStart = 0;
  private marbleStart = 0;
  private gooStart = 0;
  private readonly runLo = new Int32Array(MAX_RUNS);
  private readonly runHi = new Int32Array(MAX_RUNS);
  private readonly runTag = new Uint32Array(MAX_RUNS);
  private readonly c = new Int32Array(3);
  private readonly nd = new Int32Array(4);
  private readonly hist = new Uint32Array(256);
  private imp = new Float64Array(0);
  /** Typed arrays live in SharedArrayBuffers (the Node worker driver, src/node/parallel.ts, shares them). */
  shared = false;
  /** Number of A/B swaps mod 2 (workers mirror it so they index the same arrays). */
  parity = 0;
  /**
   * Range-kernel executor. Default: run [s0, s1) here. The worker driver replaces it to split ranges across threads;
   * every phase is a pure function of shared state per slot (cross-kind adds use Atomics.add), so the split can't
   * change the result.
   */
  exec: (phase: Phase, s0: number, s1: number, sub: number, pk: TickPack) => void = (ph, a, b, sb, pk) => this.runPhase(ph, a, b, sb, pk, this.imp);

  // ---- MatterBackend (async wrappers) -------------------------------------------------------------------------
  async init(cfg: MatterConfig): Promise<void> { this.initSync(cfg); }
  async step(input: MatterStepIn): Promise<MatterStepOut> { return this.stepSync(input); }
  async snapshot(): Promise<Uint8Array> { return this.snapshotSync(); }
  async restore(bytes: Uint8Array): Promise<void> { this.restoreSync(bytes); }
  destroy(): void { this.capacity = 0; this.n = 0; }

  initSync(cfg: MatterConfig): void {
    const cap = cfg.capacity | 0;
    if (cap < 1 || cap > 1 << INTAKE_INDEX_BITS) throw new Error(`matter: capacity ${cfg.capacity} out of range`);
    this.capacity = cap;
    this.seed = cfg.seed >>> 0;
    this.n = 0;
    this.tick = 0;
    const I = (len: number): Int32Array => (this.shared ? new Int32Array(new SharedArrayBuffer(len * 4)) : new Int32Array(len));
    const Uu = (len: number): Uint32Array => (this.shared ? new Uint32Array(new SharedArrayBuffer(len * 4)) : new Uint32Array(len));
    this.pos = I(cap * 3); this.vel = I(cap * 3); this.mat = Uu(cap);
    this.pred = I(cap * 3);
    this.posB = I(cap * 3); this.velB = I(cap * 3); this.matB = Uu(cap);
    this.predB = I(cap * 3);
    this.key = Uu(cap); this.keyB = Uu(cap);
    this.tag = Uu(cap); this.tagB = Uu(cap);
    this.ord = Uu(cap); this.ordB = Uu(cap);
    this.acc = I(cap * 4);
    this.fdisp = I(cap * 3);
    this.dens = I(cap * 2);
    this.appr = I(cap);
    this.parity = 0;
    if (this.cellStart.length !== TABLE + 1 || this.shared) {
      this.cellStart = Uu(TABLE + 1);
      this.cellEnd = Uu(TABLE + 1);
      this.cellStamp = Uu(TABLE + 1);
    }
  }

  snapshotSync(): Uint8Array {
    const n = this.n;
    return encodeMatr({
      tick: this.tick, count: n, capacity: this.capacity, seed: this.seed,
      pos: this.pos.subarray(0, n * 3), vel: this.vel.subarray(0, n * 3), mat: this.mat.subarray(0, n),
    });
  }

  restoreSync(bytes: Uint8Array): void {
    const s = decodeMatr(bytes);
    if (this.capacity === 0) this.initSync({ capacity: s.capacity, seed: s.seed });
    if (s.count > this.capacity) throw new Error(`matter: snapshot has ${s.count} particles, capacity ${this.capacity}`);
    this.n = s.count;
    this.tick = s.tick;
    this.seed = s.seed;
    this.pos.set(s.pos); this.vel.set(s.vel); this.mat.set(s.mat);
  }

  stepSync(input: MatterStepIn): MatterStepOut {
    if (this.capacity === 0) throw new Error('matter: step before init');
    const pk = prepareTick(input);
    this.imp = new Float64Array(pk.dynIds.length * 12);
    this.blasts(pk);
    this.emits(pk);
    for (let s = 0; s < SUBSTEPS; s++) this.substep(pk, s);
    const absorbed = this.despawn(pk);
    this.tick = input.tick;
    return this.outputs(pk, absorbed);
  }

  // ---- tick stages ------------------------------------------------------------------------------------------

  private blasts(pk: TickPack): void {
    const { pos, vel, nd } = this;
    for (let b = 0; b < pk.nBlasts; b++) {
      const o = b * 8;
      const cx = pk.blasts[o]!, cy = pk.blasts[o + 1]!, cz = pk.blasts[o + 2]!, R = pk.blasts[o + 3]!, imp = pk.blasts[o + 4]!;
      if (R <= 0) continue;
      for (let i = 0; i < this.n; i++) {
        const qx = (pos[i * 3]! - cx) | 0, qy = (pos[i * 3 + 1]! - cy) | 0, qz = (pos[i * 3 + 2]! - cz) | 0;
        if (qx >= R || qx <= -R || qy >= R || qy <= -R || qz >= R || qz <= -R) continue;
        normDist(nd, qx, qy, qz);
        const d = nd[3]!;
        if (d >= R) continue;
        const frac = idiv((R - d) << 11, R);
        const f = (imp * frac) >> 11;
        for (let a = 0; a < 3; a++) vel[i * 3 + a] = clampI((vel[i * 3 + a]! + ((nd[a]! * f) >> 12)) | 0, -VMAX, VMAX);
      }
    }
  }

  private emits(pk: TickPack): void {
    const room = this.capacity - this.n;
    const k = pk.nEmit < room ? pk.nEmit : room;
    for (let e = 0; e < k; e++) {
      const i = this.n + e, o = e * 7;
      this.pos[i * 3] = pk.emit[o]!; this.pos[i * 3 + 1] = pk.emit[o + 1]!; this.pos[i * 3 + 2] = pk.emit[o + 2]!;
      this.vel[i * 3] = pk.emit[o + 3]!; this.vel[i * 3 + 1] = pk.emit[o + 4]!; this.vel[i * 3 + 2] = pk.emit[o + 5]!;
      this.mat[i] = pk.emit[o + 6]!;
    }
    this.n += k;
  }

  private substep(pk: TickPack, sub: number): void {
    const n = this.n;
    const X = this.exec;
    X('predict', 0, n, sub, pk);
    this.radix();
    X('permute', 0, n, sub, pk);
    this.swap();
    this.cells();
    // class ranges: keys are grouped by kind (KEY_BASE), so the sorted order is sand, water, marble, goo
    let w = 0;
    while (w < n && this.key[w]! < KEY_BASE[1]!) w++;
    let m = w;
    while (m < n && this.key[m]! < KEY_BASE[2]!) m++;
    let g = m;
    while (g < n && this.key[g]! < KEY_BASE[3]!) g++;
    this.waterStart = w;
    this.marbleStart = m;
    this.gooStart = g;
    for (let it = 0; it < ITERATIONS; it++) {
      this.itFirst = it === 0;
      X('zero', 0, n, sub, pk);
      X('sand', 0, w, sub, pk);
      X('wdens', w, m, sub, pk);
      X('wsolve', w, m, sub, pk);
      X('marble', m, g, sub, pk);
      X('goo', g, n, sub, pk);
      X('apply', 0, n, sub, pk);
    }
    X('finish', 0, n, sub, pk);
  }

  /** The shared arrays, in a fixed order (worker driver: adopt() them in each thread). */
  arrays(): (Int32Array | Uint32Array)[] {
    return [this.pos, this.vel, this.mat, this.pred, this.posB, this.velB, this.matB, this.predB, this.key, this.keyB,
      this.tag, this.tagB, this.ord, this.ordB, this.acc, this.fdisp, this.dens, this.appr, this.cellStart, this.cellEnd, this.cellStamp];
  }

  /** Adopt another instance's shared arrays (parity 0 order) and per-substep scalars. */
  adopt(a: (Int32Array | Uint32Array)[], capacity: number): void {
    const i = (k: number): Int32Array => a[k] as Int32Array, u = (k: number): Uint32Array => a[k] as Uint32Array;
    [this.pos, this.vel, this.mat, this.pred, this.posB, this.velB, this.matB, this.predB] = [i(0), i(1), u(2), i(3), i(4), i(5), u(6), i(7)];
    [this.key, this.keyB, this.tag, this.tagB, this.ord, this.ordB] = [u(8), u(9), u(10), u(11), u(12), u(13)];
    [this.acc, this.fdisp, this.dens, this.appr, this.cellStart, this.cellEnd, this.cellStamp] = [i(14), i(15), i(16), i(17), u(18), u(19), u(20)];
    this.capacity = capacity;
    this.parity = 0;
  }

  /** Per-substep scalars a worker needs before running a phase. */
  sync(n: number, parity: number, stamp: number, waterStart: number, marbleStart: number, itFirst: boolean, gooStart: number): void {
    this.n = n;
    if (this.parity !== parity) this.swap();
    this.stamp = stamp; this.waterStart = waterStart; this.marbleStart = marbleStart; this.itFirst = itFirst; this.gooStart = gooStart;
  }

  /** This tick's impulse accumulators (hi, lo per component; the worker driver merges thread partials into it). */
  impulseBuffer(): Float64Array { return this.imp; }

  /** Scalars the driver forwards to workers. */
  scalars(): [number, number, number, number, number, boolean, number] {
    return [this.n, this.parity, this.stamp, this.waterStart, this.marbleStart, this.itFirst, this.gooStart];
  }

  /** One range kernel (the worker driver calls this in each thread with its own impulse partial `imp`). */
  runPhase(ph: Phase, s0: number, s1: number, sub: number, pk: TickPack, imp: Float64Array): void {
    switch (ph) {
      case 'predict': this.predict(s0, s1, sub, pk); break;
      case 'permute': this.permute(s0, s1); break;
      case 'zero': this.acc.fill(0, s0 * 4, s1 * 4); if (this.itFirst) this.appr.fill(0, s0, s1); break;
      case 'sand': this.solveGrains(s0, s1, 0, []); break;
      case 'wdens': this.fluidDensity(s0, s1, 1); break;
      case 'wsolve': this.fluidSolve(s0, s1, 1); break;
      case 'marble': this.solveGrains(s0, s1, 2, [0, 1]); break;
      case 'goo': this.solveGoo(s0, s1); break;
      case 'apply': this.apply(pk, sub, s0, s1, imp); break;
      case 'finish': this.finish(s0, s1); break;
    }
  }

  /** True during the first iteration of a substep: its 'zero' phase also resets the per-substep impulse budget. */
  itFirst = false;

  private predict(s0: number, s1: number, sub: number, pk: TickPack): void {
    const { pos, vel, mat, pred, key, tag } = this;
    const g0 = pk.grav[sub]!, zoned = pk.nZones > 0;
    for (let i = s0; i < s1; i++) {
      const b = i * 3;
      // D104: the world's gravity this substep, or the gravity of the first zone holding the substep-start position
      const g = zoned ? gravityAt(pk, sub, pos[b]!, pos[b + 1]!, pos[b + 2]!) : g0;
      const x = (pos[b]! + vel[b]!) | 0, y = (pos[b + 1]! + vel[b + 1]! - g) | 0, z = (pos[b + 2]! + vel[b + 2]!) | 0;
      pred[b] = x; pred[b + 1] = y; pred[b + 2] = z;
      const k = mat[i]! & 0xff;
      const C = CELL[k]!, XB = KEY_XB[k]!;
      const ux = ucell(x, C), uy = ucell(y, C), uz = ucell(z, C);
      key[i] = KEY_BASE[k]! + ((ux & ((1 << XB) - 1)) | ((rowHash(k, ux >>> XB, uy, uz) & ((1 << KEY_RB[k]!) - 1)) << XB));
      tag[i] = cellTag(k, ux >>> XB, uy, uz);
    }
  }

  /** Stable LSD radix sort of slot indices by key (24 bits, 3 passes); the order ends in this.ordB. */
  private radix(): void {
    const n = this.n, key = this.key;
    let src = this.ord, dst = this.ordB;
    for (let i = 0; i < n; i++) src[i] = i;
    const hist = this.hist;
    for (let pass = 0; pass < 3; pass++) {
      const sh = pass * 8;
      hist.fill(0);
      for (let i = 0; i < n; i++) hist[(key[src[i]!]! >>> sh) & 255]!++;
      let sum = 0;
      for (let d = 0; d < 256; d++) { const c = hist[d]!; hist[d] = sum; sum += c; }
      for (let i = 0; i < n; i++) { const j = src[i]!; dst[hist[(key[j]! >>> sh) & 255]!++] = j; }
      const t = src; src = dst; dst = t;
    }
    // 3 (odd) passes: the result is always in ordB, which permute reads (array references never move, so the worker
    // threads of the parallel driver index the same buffers)
    if (src !== this.ordB) throw new Error('matter: radix pass count must be odd');
  }

  /** Gather every per-particle array into sorted order (into the B arrays). */
  private permute(s0: number, s1: number): void {
    const { pos, vel, mat, pred, key, tag, ordB: ord, posB, velB, matB, predB, keyB, tagB } = this;
    for (let s = s0; s < s1; s++) {
      const i = ord[s]!;
      posB[s * 3] = pos[i * 3]!; posB[s * 3 + 1] = pos[i * 3 + 1]!; posB[s * 3 + 2] = pos[i * 3 + 2]!;
      velB[s * 3] = vel[i * 3]!; velB[s * 3 + 1] = vel[i * 3 + 1]!; velB[s * 3 + 2] = vel[i * 3 + 2]!;
      predB[s * 3] = pred[i * 3]!; predB[s * 3 + 1] = pred[i * 3 + 1]!; predB[s * 3 + 2] = pred[i * 3 + 2]!;
      matB[s] = mat[i]!; keyB[s] = key[i]!; tagB[s] = tag[i]!;
    }
  }

  /** Swap the A/B arrays (after permute). Workers call it too, to follow the parity. */
  swap(): void {
    [this.pos, this.posB] = [this.posB, this.pos];
    [this.vel, this.velB] = [this.velB, this.vel];
    [this.pred, this.predB] = [this.predB, this.pred];
    [this.mat, this.matB] = [this.matB, this.mat];
    [this.key, this.keyB] = [this.keyB, this.key];
    [this.tag, this.tagB] = [this.tagB, this.tag];
    this.parity ^= 1;
  }

  /** Cell ranges (stamped, so the table is never cleared). */
  private cells(): void {
    const n = this.n;
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.cellStamp.fill(0); this.stamp = 1; }
    const st = this.stamp, ks = this.key;
    for (let s = 0; s < n; s++) {
      const k = ks[s]!;
      if (this.cellStamp[k] !== st) { this.cellStamp[k] = st; this.cellStart[k] = s; }
      this.cellEnd[k] = s + 1;
    }
  }

  private finish(s0: number, s1: number): void {
    const { pos, vel, pred } = this;
    for (let i = s0 * 3; i < s1 * 3; i++) {
      vel[i] = clampI(damp((pred[i]! - pos[i]!) | 0), -VMAX, VMAX);
      pos[i] = pred[i]!;
    }
  }


  /**
   * Slot runs covering every cell of grid `g` that intersects [p − reach, p + reach] per axis. Consecutive x cells
   * with the same aliased high bits have consecutive keys, so each (y, z) row is one or two contiguous slot runs.
   */
  private runs(g: number, x: number, y: number, z: number, reach: number): number {
    const C = CELL[g]!, XB = KEY_XB[g]!, base = KEY_BASE[g]!;
    const xm = (1 << XB) - 1, rm = (1 << KEY_RB[g]!) - 1;
    const ux0 = ucell((x - reach) | 0, C), ux1 = ucell((x + reach) | 0, C);
    const uy0 = ucell((y - reach) | 0, C), uy1 = ucell((y + reach) | 0, C);
    const uz0 = ucell((z - reach) | 0, C), uz1 = ucell((z + reach) | 0, C);
    const { cellStart, cellEnd, cellStamp, stamp } = this;
    let nr = 0;
    for (let uz = uz0; uz <= uz1; uz++) {
      for (let uy = uy0; uy <= uy1; uy++) {
        let a = ux0;
        while (a <= ux1) {
          const blockEnd = (a | xm) >>> 0;
          const b = blockEnd < ux1 ? blockEnd : ux1;
          const rowKey = base + ((rowHash(g, a >>> XB, uy, uz) & rm) << XB);
          let lo = -1, hi = -1;
          for (let ux = a; ux <= b; ux++) {
            const k = rowKey + (ux & xm);
            if (cellStamp[k] !== stamp) continue;
            if (lo < 0) lo = cellStart[k]!;
            hi = cellEnd[k]!;
          }
          if (lo >= 0) {
            this.runLo[nr] = lo; this.runHi[nr] = hi;
            this.runTag[nr] = cellTag(g, a >>> XB, uy, uz);
            nr++;
          }
          a = b + 1;
        }
      }
    }
    return nr;
  }

  /**
   * Contact correction for particle s (kind ks) against t (kind kt), Δ = p_s − p_t, d² < (r_s + r_t)²; result in
   * this.c. Normal push by the pair share, then Coulomb friction on the relative tangential displacement.
   */
  private contact(s: number, t: number, ks: number, kt: number, qx: number, qy: number, qz: number, d2: number): void {
    const c = this.c;
    const R = RADIUS[ks]! + RADIUS[kt]!;
    // stacked pair (normal within 45° of vertical): the upper particle takes 3/4 (shock propagation)
    const w = ks === kt ? (qy * qy > qx * qx + qz * qz ? (qy > 0 ? 192 : 64) : 128) : SHARE[ks * KIND_COUNT + kt]!;
    const d = isqrt(d2);
    if (d === 0) {
      // coincident: separate horizontally along a pair-hashed axis (never into a floor), lower slot negative
      const m = (s < t ? -1 : 1) * ((R * w) >> 8);
      const zAxis = (fmix32(((s < t ? s : t) ^ Math.imul(s < t ? t : s, 0x9e3779b1)) >>> 0) & 1) === 1;
      c[0] = zAxis ? 0 : m; c[1] = 0; c[2] = zAxis ? m : 0;
      return;
    }
    const pen = R - d;
    // one division per contact: k = pen·w·256 / d, then c = q·k / 2^16 (|q_i| ≤ d keeps every product < 2^27)
    const k = idiv((pen * w) << 8, d);
    let cx = shrS(qx * k, 16), cy = shrS(qy * k, 16), cz = shrS(qz * k, 16);
    const mus = MU_S[ks]! < MU_S[kt]! ? MU_S[ks]! : MU_S[kt]!;
    if (mus > 0) {
      const mk = MU_K[ks]! < MU_K[kt]! ? MU_K[ks]! : MU_K[kt]!;
      const { pred, pos } = this;
      const rx = (pred[s * 3]! - pos[s * 3]!) - (pred[t * 3]! - pos[t * 3]!);
      const ry = (pred[s * 3 + 1]! - pos[s * 3 + 1]!) - (pred[t * 3 + 1]! - pos[t * 3 + 1]!);
      const rz = (pred[s * 3 + 2]! - pos[s * 3 + 2]!) - (pred[t * 3 + 2]! - pos[t * 3 + 2]!);
      const inv = idiv(1 << 24, d);
      const nx = shrS(qx * inv, 12), ny = shrS(qy * inv, 12), nz = shrS(qz * inv, 12);
      const rn = shrS(rx * nx + ry * ny + rz * nz, 12);
      const tx = rx - shrS(nx * rn, 12), ty = ry - shrS(ny * rn, 12), tz = rz - shrS(nz * rn, 12);
      const lt = isqrt(tx * tx + ty * ty + tz * tz);
      if (lt > 0) {
        let fx = tx, fy = ty, fz = tz;
        if (lt * 256 > mus * pen) {
          const kk = idiv(((mk * pen) >> 8) << 12, lt);
          fx = shrS(tx * kk, 12); fy = shrS(ty * kk, 12); fz = shrS(tz * kk, 12);
        }
        cx -= shrS(fx * w, 8); cy -= shrS(fy * w, 8); cz -= shrS(fz * w, 8);
      }
    }
    c[0] = cx; c[1] = cy; c[2] = cz;
  }

  /** Same-kind gather for slots [s0, s1) of kind k; also searches smaller kinds in `smaller` and scatters to them. */
  private solveGrains(s0: number, s1: number, k: number, smaller: readonly number[]): void {
    const { pred, acc, tag, c, runLo, runHi, runTag } = this;
    const R = RADIUS[k]! * 2, R2 = R * R;
    for (let s = s0; s < s1; s++) {
      const px = pred[s * 3]!, py = pred[s * 3 + 1]!, pz = pred[s * 3 + 2]!;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      const nr = this.runs(k, px, py, pz, R);
      for (let r = 0; r < nr; r++) {
        const tg = runTag[r]!;
        for (let t = runLo[r]!; t < runHi[r]!; t++) {
          if (t === s || tag[t] !== tg) continue;
          const qx = (px - pred[t * 3]!) | 0, qy = (py - pred[t * 3 + 1]!) | 0, qz = (pz - pred[t * 3 + 2]!) | 0;
          if (qx >= R || qx <= -R || qy >= R || qy <= -R || qz >= R || qz <= -R) continue;
          const d2 = qx * qx + qy * qy + qz * qz;
          if (d2 >= R2) continue;
          this.contact(s, t, k, k, qx, qy, qz, d2);
          ax += c[0]!; ay += c[1]!; az += c[2]!; cnt++;
        }
      }
      for (const g of smaller) this.crossSearch(s, k, g, px, py, pz, (v0, v1, v2) => { ax += v0; ay += v1; az += v2; cnt++; });
      acc[s * 4] = (acc[s * 4]! + ax) | 0; acc[s * 4 + 1] = (acc[s * 4 + 1]! + ay) | 0;
      acc[s * 4 + 2] = (acc[s * 4 + 2]! + az) | 0; acc[s * 4 + 3] = (acc[s * 4 + 3]! + cnt) | 0;
    }
  }

  /** Big particle s (kind k) against the smaller kind g: own corrections via `own`, partner's added to acc[t]. */
  private crossSearch(s: number, k: number, g: number, px: number, py: number, pz: number, own: (x: number, y: number, z: number) => void): void {
    const { pred, acc, tag, c } = this;
    // a kind with no particles this substep has nothing to find (X5: skips the walk over its empty grid)
    const lo = g === 0 ? 0 : g === 1 ? this.waterStart : this.marbleStart, hi = g === 0 ? this.waterStart : g === 1 ? this.marbleStart : this.gooStart;
    if (hi <= lo) return;
    const R = RADIUS[k]! + RADIUS[g]!, R2 = R * R;
    const nr = this.runs(g, px, py, pz, R);
    for (let r = 0; r < nr; r++) {
      const tg = this.runTag[r]!, hi = this.runHi[r]!;
      for (let t = this.runLo[r]!; t < hi; t++) {
        if (tag[t] !== tg) continue;
        const qx = (px - pred[t * 3]!) | 0, qy = (py - pred[t * 3 + 1]!) | 0, qz = (pz - pred[t * 3 + 2]!) | 0;
        if (qx >= R || qx <= -R || qy >= R || qy <= -R || qz >= R || qz <= -R) continue;
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 >= R2) continue;
        this.contact(s, t, k, g, qx, qy, qz, d2);
        own(c[0]!, c[1]!, c[2]!);
        this.contact(t, s, g, k, -qx | 0, -qy | 0, -qz | 0, d2);
        Atomics.add(acc, t * 4, c[0]!); Atomics.add(acc, t * 4 + 1, c[1]!);
        Atomics.add(acc, t * 4 + 2, c[2]!); Atomics.add(acc, t * 4 + 3, 1);
      }
    }
  }


  /**
   * Goo pair correction for s against t (both goo), Δ = p_s − p_t, d² < GOO_H²; result in this.c (constants.ts, goo):
   * a spring around GOO_REST taking half (push below it; above it a tent-shaped cohesion pull that fades to 0 at GOO_H),
   * minus GOO_VISC / 512 of the pair's relative displacement since the substep start (viscosity).
   */
  private gooPair(s: number, t: number, qx: number, qy: number, qz: number, d2: number): void {
    const c = this.c, { pred, pos } = this;
    const d = isqrt(d2);
    let cx = 0, cy = 0, cz = 0;
    if (d === 0) {
      // coincident: separate horizontally along a pair-hashed axis, lower slot negative (as grains do)
      const m = (s < t ? -1 : 1) * ((GOO_REST * 128) >> 8);
      const zAxis = (fmix32(((s < t ? s : t) ^ Math.imul(s < t ? t : s, 0x9e3779b1)) >>> 0) & 1) === 1;
      cx = zAxis ? 0 : m; cz = zAxis ? m : 0;
    } else {
      let f: number;
      if (d < GOO_REST) f = (GOO_REST - d) * 128;
      else {
        const e = d - GOO_REST, r = GOO_H - d;
        f = -(((GOO_KC * (e < r ? e : r)) >> 8) * 128);
      }
      const k = idiv(f << 8, d);
      cx = shrS(qx * k, 16); cy = shrS(qy * k, 16); cz = shrS(qz * k, 16);
    }
    const rx = (pred[s * 3]! - pos[s * 3]!) - (pred[t * 3]! - pos[t * 3]!);
    const ry = (pred[s * 3 + 1]! - pos[s * 3 + 1]!) - (pred[t * 3 + 1]! - pos[t * 3 + 1]!);
    const rz = (pred[s * 3 + 2]! - pos[s * 3 + 2]!) - (pred[t * 3 + 2]! - pos[t * 3 + 2]!);
    c[0] = cx - shrS(rx * GOO_VISC, 9); c[1] = cy - shrS(ry * GOO_VISC, 9); c[2] = cz - shrS(rz * GOO_VISC, 9);
  }

  /** Goo gather for slots [s0, s1): goo pairs, then contacts with every smaller-or-equal kind (sand, water, marble). */
  private solveGoo(s0: number, s1: number): void {
    const { pred, acc, tag, c, runLo, runHi, runTag } = this;
    const H = GOO_H, H2 = H * H;
    for (let s = s0; s < s1; s++) {
      const px = pred[s * 3]!, py = pred[s * 3 + 1]!, pz = pred[s * 3 + 2]!;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      const nr = this.runs(3, px, py, pz, H);
      for (let r = 0; r < nr; r++) {
        const tg = runTag[r]!;
        for (let t = runLo[r]!; t < runHi[r]!; t++) {
          if (t === s || tag[t] !== tg) continue;
          const qx = (px - pred[t * 3]!) | 0, qy = (py - pred[t * 3 + 1]!) | 0, qz = (pz - pred[t * 3 + 2]!) | 0;
          if (qx >= H || qx <= -H || qy >= H || qy <= -H || qz >= H || qz <= -H) continue;
          const d2 = qx * qx + qy * qy + qz * qz;
          if (d2 >= H2) continue;
          this.gooPair(s, t, qx, qy, qz, d2);
          ax += c[0]!; ay += c[1]!; az += c[2]!; cnt++;
        }
      }
      for (let g = 0; g < 3; g++) this.crossSearch(s, 3, g, px, py, pz, (v0, v1, v2) => { ax += v0; ay += v1; az += v2; cnt++; });
      acc[s * 4] = (acc[s * 4]! + ax) | 0; acc[s * 4 + 1] = (acc[s * 4 + 1]! + ay) | 0;
      acc[s * 4 + 2] = (acc[s * 4 + 2]! + az) | 0; acc[s * 4 + 3] = (acc[s * 4 + 3]! + cnt) | 0;
    }
  }

  /**
   * Fluid pass 1 (water, kind 1; FLUID[k] holds its constants, so another double-density kind could reuse it):
   * density → pressure and near-pressure per particle.
   */
  private fluidDensity(s0: number, s1: number, k: number): void {
    const { pred, tag, dens, runLo, runHi, runTag } = this;
    const F = FLUID[k]!;
    const H = F.h, H2 = H * H;
    for (let s = s0; s < s1; s++) {
      const px = pred[s * 3]!, py = pred[s * 3 + 1]!, pz = pred[s * 3 + 2]!;
      let rho = 0, rhoN = 0;
      const nr = this.runs(k, px, py, pz, H);
      for (let r = 0; r < nr; r++) {
        const tg = runTag[r]!;
        for (let t = runLo[r]!; t < runHi[r]!; t++) {
          if (t === s || tag[t] !== tg) continue;
          const qx = (px - pred[t * 3]!) | 0, qy = (py - pred[t * 3 + 1]!) | 0, qz = (pz - pred[t * 3 + 2]!) | 0;
          if (qx >= H || qx <= -H || qy >= H || qy <= -H || qz >= H || qz <= -H) continue;
          const d2 = qx * qx + qy * qy + qz * qz;
          if (d2 >= H2) continue;
          const q12 = idiv((H - isqrt(d2)) << 12, H);
          const q2 = (q12 * q12) >> 12;
          rho += q2;
          rhoN += (q2 * q12) >> 12;
        }
      }
      dens[s * 2] = clampI(((rho - F.rho0) * F.kp) >> 8, F.pmin, F.pmax);
      dens[s * 2 + 1] = clampI((rhoN * F.kn) >> 8, 0, F.pmax);
    }
  }

  /**
   * Fluid pass 2: the fluid displacement (plus an optional kernel-weighted viscosity, FLUID[k].visc; water has none),
   * then contacts with the smaller kinds (water: sand).
   */
  private fluidSolve(s0: number, s1: number, k: number): void {
    const { pred, pos, tag, dens, fdisp, runLo, runHi, runTag, acc } = this;
    const F = FLUID[k]!;
    const H = F.h, H2 = H * H, V = F.visc;
    for (let s = s0; s < s1; s++) {
      const px = pred[s * 3]!, py = pred[s * 3 + 1]!, pz = pred[s * 3 + 2]!;
      const sx = (px - pos[s * 3]!) | 0, sy = (py - pos[s * 3 + 1]!) | 0, sz = (pz - pos[s * 3 + 2]!) | 0;
      const P = dens[s * 2]!, Pn = dens[s * 2 + 1]!;
      let fx = 0, fy = 0, fz = 0;
      const nr = this.runs(k, px, py, pz, H);
      for (let r = 0; r < nr; r++) {
        const tg = runTag[r]!;
        for (let t = runLo[r]!; t < runHi[r]!; t++) {
          if (t === s || tag[t] !== tg) continue;
          const qx = (px - pred[t * 3]!) | 0, qy = (py - pred[t * 3 + 1]!) | 0, qz = (pz - pred[t * 3 + 2]!) | 0;
          if (qx >= H || qx <= -H || qy >= H || qy <= -H || qz >= H || qz <= -H) continue;
          const d2 = qx * qx + qy * qy + qz * qz;
          if (d2 >= H2) continue;
          const d = isqrt(d2);
          const q12 = idiv((H - d) << 12, H);
          const q2 = (q12 * q12) >> 12;
          if (V) {
            // viscosity: V / 512 of the neighbour's displacement relative to ours, weighted by q
            const rx = ((pred[t * 3]! - pos[t * 3]!) - sx) | 0, ry = ((pred[t * 3 + 1]! - pos[t * 3 + 1]!) - sy) | 0, rz = ((pred[t * 3 + 2]! - pos[t * 3 + 2]!) - sz) | 0;
            fx += shrS(shrS(rx * q12, 12) * V, 9); fy += shrS(shrS(ry * q12, 12) * V, 9); fz += shrS(shrS(rz * q12, 12) * V, 9);
          }
          let D = ((((P + dens[t * 2]!) >> 1) * q12) >> 12) + ((((Pn + dens[t * 2 + 1]!) >> 1) * q2) >> 12);
          D = clampI((clampI(D, -65536, 65536) * H) >> 13, -F.dclamp, F.dclamp);
          if (d === 0) {
            const zAxis = (fmix32(((s < t ? s : t) ^ Math.imul(s < t ? t : s, 0x9e3779b1)) >>> 0) & 1) === 1;
            if (zAxis) fz += s < t ? -D : D; else fx += s < t ? -D : D;
            continue;
          }
          const inv = idiv(1 << 24, d);
          fx += shrS(shrS(qx * inv, 12) * D, 12); fy += shrS(shrS(qy * inv, 12) * D, 12); fz += shrS(shrS(qz * inv, 12) * D, 12);
        }
      }
      fdisp[s * 3] = fx; fdisp[s * 3 + 1] = fy; fdisp[s * 3 + 2] = fz;
    }
    for (let s = s0; s < s1; s++) {
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (const g of F.smaller) this.crossSearch(s, k, g, pred[s * 3]!, pred[s * 3 + 1]!, pred[s * 3 + 2]!, (v0, v1, v2) => { ax += v0; ay += v1; az += v2; cnt++; });
      acc[s * 4] = (acc[s * 4]! + ax) | 0; acc[s * 4 + 1] = (acc[s * 4 + 1]! + ay) | 0;
      acc[s * 4 + 2] = (acc[s * 4 + 2]! + az) | 0; acc[s * 4 + 3] = (acc[s * 4 + 3]! + cnt) | 0;
    }
  }

  /** Apply the averaged corrections (+ fluid displacement), clamp, collide with proxies, accumulate impulses. */
  private apply(pk: TickPack, sub: number, s0: number, s1: number, imp: Float64Array): void {
    const { pred, pos, acc, fdisp, nd } = this;
    const pr = pk.proxies, pl = pk.plist;
    for (let s = s0; s < s1; s++) {
      const k = s < this.waterStart ? 0 : s < this.marbleStart ? 1 : s < this.gooStart ? 2 : 3;
      const b = s * 3;
      const cnt = acc[s * 4 + 3]!;
      let px = pred[b]!, py = pred[b + 1]!, pz = pred[b + 2]!;
      if (cnt > 0) { px += idiv(acc[s * 4]!, cnt); py += idiv(acc[s * 4 + 1]!, cnt); pz += idiv(acc[s * 4 + 2]!, cnt); }
      if (k === 1) { px += fdisp[b]!; py += fdisp[b + 1]!; pz += fdisp[b + 2]!; }
      const x0 = pos[b]!, y0 = pos[b + 1]!, z0 = pos[b + 2]!;
      px = (x0 + clampI((px - x0) | 0, -DMAX, DMAX)) | 0;
      py = (y0 + clampI((py - y0) | 0, -DMAX, DMAX)) | 0;
      pz = (z0 + clampI((pz - z0) | 0, -DMAX, DMAX)) | 0;
      if (pk.nProxies > 0) {
        const rk = RADIUS[k]!, mus = MU_S[k]!, muk = MU_K[k]!, m = MASS_MG[k]!;
        const goo = k === 3, floorPen = goo ? -GOO_BAND : 0;
        const bk = pbucket(px, py, pz);
        for (let e = pl[bk]!; e < pl[bk + 1]!; e++) {
          const o = (pl[e]! * SUBSTEPS + sub) * PROXY_STRIDE;
          if (px < pr[o + P_MIN]! || px > pr[o + P_MAX]! || py < pr[o + P_MIN + 1]! || py > pr[o + P_MAX + 1]!
            || pz < pr[o + P_MIN + 2]! || pz > pr[o + P_MAX + 2]!) continue;
          const shape = pr[o + P_SHAPE]!;
          const cx = pr[o + P_C]!, cy = pr[o + P_C + 1]!, cz = pr[o + P_C + 2]!;
          const dx = (px - cx) | 0, dy = (py - cy) | 0, dz = (pz - cz) | 0;
          let pen = 0, nx = 0, ny = 0, nz = 0;
          if (shape === 0) {
            normDist(nd, dx, dy, dz);
            pen = pr[o + P_RAD]! + rk - nd[3]!;
            nx = nd[0]!; ny = nd[1]!; nz = nd[2]!;
          } else if (shape === 3) {
            const R = o + P_R;
            const dist = Math.floor((pr[R + 1]! * dx + pr[R + 4]! * dy + pr[R + 7]! * dz) / 16384);
            pen = rk - dist;
            nx = pr[R + 1]! >> 2; ny = pr[R + 4]! >> 2; nz = pr[R + 7]! >> 2;
          } else {
            const R = o + P_R;
            // local = Rᵀ d (exact doubles; the GPU uses 64-bit split products)
            const lx = Math.floor((pr[R]! * dx + pr[R + 3]! * dy + pr[R + 6]! * dz) / 16384);
            let ly = Math.floor((pr[R + 1]! * dx + pr[R + 4]! * dy + pr[R + 7]! * dz) / 16384);
            const lz = Math.floor((pr[R + 2]! * dx + pr[R + 5]! * dy + pr[R + 8]! * dz) / 16384);
            let lnx = 0, lny = 0, lnz = 0;
            if (shape === 1) {
              const hl = pr[o + P_E + 1]!;
              ly -= clampI(ly, -hl, hl);
              normDist(nd, lx, ly, lz);
              pen = pr[o + P_RAD]! + rk - nd[3]!;
              lnx = nd[0]!; lny = nd[1]!; lnz = nd[2]!;
            } else {
              const ex = pr[o + P_E]!, ey = pr[o + P_E + 1]!, ez = pr[o + P_E + 2]!;
              const qx = lx - clampI(lx, -ex, ex), qy = ly - clampI(ly, -ey, ey), qz = lz - clampI(lz, -ez, ez);
              if (qx !== 0 || qy !== 0 || qz !== 0) {
                normDist(nd, qx, qy, qz);
                pen = rk - nd[3]!;
                lnx = nd[0]!; lny = nd[1]!; lnz = nd[2]!;
              } else {
                const ax = lx < 0 ? -lx : lx, ay = ly < 0 ? -ly : ly, az = lz < 0 ? -lz : lz;
                let dep = ex - ax, axis = 0;
                if (ey - ay < dep) { dep = ey - ay; axis = 1; }
                if (ez - az < dep) { dep = ez - az; axis = 2; }
                pen = dep + rk;
                if (axis === 0) lnx = lx >= 0 ? 4096 : -4096;
                else if (axis === 1) lny = ly >= 0 ? 4096 : -4096;
                else lnz = lz >= 0 ? 4096 : -4096;
              }
            }
            nx = (pr[R]! * lnx + pr[R + 1]! * lny + pr[R + 2]! * lnz) >> 14;
            ny = (pr[R + 3]! * lnx + pr[R + 4]! * lny + pr[R + 5]! * lnz) >> 14;
            nz = (pr[R + 6]! * lnx + pr[R + 7]! * lny + pr[R + 8]! * lnz) >> 14;
          }
          // goo also sticks within GOO_BAND of the surface (pen > −GOO_BAND); everything else needs a real overlap
          if (pen <= floorPen) continue;
          if (pen > PEN_MAX) pen = PEN_MAX;
          // the surface's displacement over the substep at the contact (v + ω × r) and the particle's motion relative
          // to it; only the approach along the normal (capped at the penetration) is momentum the body receives —
          // pushing a particle out of a deep or trapped overlap is position repair, not impulse (QUACK fling, A4)
          const r0x = (px - cx) | 0, r0y = (py - cy) | 0, r0z = (pz - cz) | 0;
          const wx = pr[o + P_W]!, wy = pr[o + P_W + 1]!, wz = pr[o + P_W + 2]!;
          const sx = pr[o + P_V]! + Math.floor((wy * r0z - wz * r0y) / 65536);
          const sy = pr[o + P_V + 1]! + Math.floor((wz * r0x - wx * r0z) / 65536);
          const sz = pr[o + P_V + 2]! + Math.floor((wx * r0y - wy * r0x) / 65536);
          const ex = (px - x0 - sx) | 0, ey = (py - y0 - sy) | 0, ez = (pz - z0 - sz) | 0;
          let ap = 0, ux = 0, uy = 0, uz = 0;
          if (pen > 0) {
            const an = clampI(-((clampI(ex, -16384, 16384) * nx + clampI(ey, -16384, 16384) * ny + clampI(ez, -16384, 16384) * nz) >> 12), 0, pen);
            const done = this.appr[s]!;
            const dyn = pr[o + P_SLOT]! >= 0;
            ap = dyn && an > done ? an - done : 0;
            if (dyn && an > done) this.appr[s] = an;
            // sign-symmetric (X5): a floor shift pushed every resting grain 1 unit toward the downhill side of a tilted
            // surface per iteration, which at low gravity (pen ≈ 2 units, kinetic friction rounding to 0) slid piles
            // off gentle slopes like ice (a 2.3° ramp at Moon gravity: 1.1 m in 4 s; now 0)
            ux = shrS(nx * pen, 12); uy = shrS(ny * pen, 12); uz = shrS(nz * pen, 12);
            px = (px + ux) | 0; py = (py + uy) | 0; pz = (pz + uz) | 0;
          }
          let fx = 0, fy = 0, fz = 0;
          if (mus > 0) {
            const qx = clampI((ex + ux) | 0, -16384, 16384), qy = clampI((ey + uy) | 0, -16384, 16384), qz = clampI((ez + uz) | 0, -16384, 16384);
            const rn = (qx * nx + qy * ny + qz * nz) >> 12;
            const tx = qx - ((nx * rn) >> 12), ty = qy - ((ny * rn) >> 12), tz = qz - ((nz * rn) >> 12);
            const lt = isqrt(tx * tx + ty * ty + tz * tz);
            if (lt > 0) {
              fx = tx; fy = ty; fz = tz;
              if (lt * 256 > mus * pen) {
                const kk = (muk * pen) >> 8;
                if (kk < lt) { fx = idiv(tx * kk, lt); fy = idiv(ty * kk, lt); fz = idiv(tz * kk, lt); }
              }
              px = (px - fx) | 0; py = (py - fy) | 0; pz = (pz - fz) | 0;
            }
          } else if (goo) {
            // goo sticks (motion relative to the surface, since the substep start): GOO_STICK / 256 of the tangential part
            // goes (viscous drag), and the separating normal part is held back up to GOO_ADH units (adhesion with a
            // yield: a heavy hanging drop pulls free and drips). Approach is the push above. Booked like friction.
            const qx = clampI((ex + ux) | 0, -16384, 16384), qy = clampI((ey + uy) | 0, -16384, 16384), qz = clampI((ez + uz) | 0, -16384, 16384);
            const rn = (qx * nx + qy * ny + qz * nz) >> 12;
            const hold = rn > GOO_ADH ? GOO_ADH : rn > 0 ? rn : 0;
            const tx = qx - ((nx * rn) >> 12), ty = qy - ((ny * rn) >> 12), tz = qz - ((nz * rn) >> 12);
            fx = shrS(tx * GOO_STICK, 8) + ((nx * hold) >> 12); fy = shrS(ty * GOO_STICK, 8) + ((ny * hold) >> 12); fz = shrS(tz * GOO_STICK, 8) + ((nz * hold) >> 12);
            px = (px - fx) | 0; py = (py - fy) | 0; pz = (pz - fz) | 0;
          }
          const slot = pr[o + P_SLOT]!;
          if (slot >= 0) {
            const jx = -m * ((((nx * ap) >> 12) - fx) | 0), jy = -m * ((((ny * ap) >> 12) - fy) | 0), jz = -m * ((((nz * ap) >> 12) - fz) | 0);
            const rx = (px - cx) | 0, ry = (py - cy) | 0, rz = (pz - cz) | 0;
            add64(imp, slot * 6, jx); add64(imp, slot * 6 + 1, jy); add64(imp, slot * 6 + 2, jz);
            add64(imp, slot * 6 + 3, ry * jz - rz * jy);
            add64(imp, slot * 6 + 4, rz * jx - rx * jz);
            add64(imp, slot * 6 + 5, rx * jy - ry * jx);
          }
        }
      }
      pred[b] = px; pred[b + 1] = py; pred[b + 2] = pz;
    }
  }

  /** Intakes (capacity in index order), kill box, stable compaction. Returns absorbed counts (intake × kind). */
  private despawn(pk: TickPack): Int32Array {
    const absorbed = new Int32Array(pk.nIntakes * KIND_COUNT);
    const used = new Int32Array(pk.nIntakes);
    const { pos, vel, mat } = this;
    const it = pk.intakes;
    let w = 0;
    for (let s = 0; s < this.n; s++) {
      const x = pos[s * 3]!, y = pos[s * 3 + 1]!, z = pos[s * 3 + 2]!;
      const k = mat[s]! & 0xff;
      let dead = y < KILL_Y || x > KILL_XZ || x < -KILL_XZ || z > KILL_XZ || z < -KILL_XZ;
      if (!dead) {
        for (let t = 0; t < pk.nIntakes; t++) {
          const o = t * 8;
          if (!((it[o + 6]! >> k) & 1) || it[o + 7]! <= 0) continue;
          if (x < it[o]! || x >= it[o + 3]! || y < it[o + 1]! || y >= it[o + 4]! || z < it[o + 2]! || z >= it[o + 5]!) continue;
          if (used[t]! < it[o + 7]!) { used[t]!++; absorbed[t * KIND_COUNT + k]!++; dead = true; }
          break;
        }
      }
      if (dead) continue;
      if (w !== s) {
        pos[w * 3] = x; pos[w * 3 + 1] = y; pos[w * 3 + 2] = z;
        vel[w * 3] = vel[s * 3]!; vel[w * 3 + 1] = vel[s * 3 + 1]!; vel[w * 3 + 2] = vel[s * 3 + 2]!;
        mat[w] = mat[s]!;
      }
      w++;
    }
    this.n = w;
    return absorbed;
  }

  private outputs(pk: TickPack, absorbed: Int32Array): MatterStepOut {
    const { pos, vel, mat } = this;
    const counts = new Int32Array(KIND_COUNT);
    let c0 = 0, c1 = 0;
    const bounds = new Int32Array(6);
    for (let i = 0; i < this.n; i++) {
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!, vx = vel[i * 3]!, vy = vel[i * 3 + 1]!, vz = vel[i * 3 + 2]!;
      const m = mat[i]!;
      counts[m & 0xff]!++;
      c0 = (c0 + grainHash(i, x, y, z, vx, vy, vz, m)) >>> 0;
      c1 = (c1 + grainHash2(i, x, y, z, vx, vy, vz)) >>> 0;
      if (i === 0) { bounds[0] = bounds[3] = x; bounds[1] = bounds[4] = y; bounds[2] = bounds[5] = z; } else {
        if (x < bounds[0]!) bounds[0] = x; if (y < bounds[1]!) bounds[1] = y; if (z < bounds[2]!) bounds[2] = z;
        if (x > bounds[3]!) bounds[3] = x; if (y > bounds[4]!) bounds[4] = y; if (z > bounds[5]!) bounds[5] = z;
      }
    }
    // grain queries: exact 64-bit sums (hi, lo) per query and axis
    const nq = pk.nQueries;
    const qcnt = new Int32Array(nq), qsum = new Float64Array(nq * 6);
    if (nq) {
      const qa = pk.queries;
      for (let i = 0; i < this.n; i++) {
        const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!, k = mat[i]! & 0xff;
        for (let qn = 0; qn < nq; qn++) {
          const o = qn * 8;
          if (!((qa[o + 4]! >> k) & 1)) continue;
          const r = qa[o + 3]!;
          const dx = (x - qa[o]!) | 0, dy = (y - qa[o + 1]!) | 0, dz = (z - qa[o + 2]!) | 0;
          if (dx >= r || dx <= -r || dy >= r || dy <= -r || dz >= r || dz <= -r) continue;
          if (dx * dx + dy * dy + dz * dz >= r * r) continue;
          qcnt[qn]!++;
          add64(qsum, qn * 3, x); add64(qsum, qn * 3 + 1, y); add64(qsum, qn * 3 + 2, z);
        }
      }
    }
    // water surface (D101): per column max / min centre y, count, exact velocity sums, in the raw layout the GPU fills
    const sv = pk.surface;
    let surface: MatterStepOut['surface'];
    if (sv) {
      const nc = sv[3]! * sv[4]!;
      const raw = new Uint32Array(nc * SURF_WORDS);
      const vs = new Float64Array(nc * 3);
      for (let i = 0; i < this.n; i++) {
        if ((mat[i]! & 0xff) !== 1) continue;
        const c = surfaceCell(sv, pos[i * 3]!, pos[i * 3 + 2]!);
        if (c < 0) continue;
        const o = c * SURF_WORDS, y = pos[i * 3 + 1]!;
        const yt = (y ^ 0x80000000) >>> 0, yb = (~(y ^ 0x80000000)) >>> 0;
        if (raw[o + 2] === 0 || yt > raw[o]!) raw[o] = yt;
        if (raw[o + 2] === 0 || yb > raw[o + 1]!) raw[o + 1] = yb;
        raw[o + 2]!++;
        vs[c * 3] = vs[c * 3]! + vel[i * 3]!; vs[c * 3 + 1] = vs[c * 3 + 1]! + vel[i * 3 + 1]!; vs[c * 3 + 2] = vs[c * 3 + 2]! + vel[i * 3 + 2]!;
      }
      for (let k = 0; k < nc * 3; k++) {
        // exact integer sums (|sum| < 2^53) → two's-complement 64-bit (lo, hi)
        const v = vs[k]!, hi = Math.floor(v / 4294967296);
        raw[Math.floor(k / 3) * SURF_WORDS + 3 + (k % 3) * 2] = (v - hi * 4294967296) >>> 0;
        raw[Math.floor(k / 3) * SURF_WORDS + 4 + (k % 3) * 2] = hi >>> 0;
      }
      surface = surfaceResult(sv, raw);
    }
    const impulses = pk.dynIds.map((id, slot) => ({
      id,
      lin: Int32Array.of(sar64(this.imp, slot * 6, 8), sar64(this.imp, slot * 6 + 1, 8), sar64(this.imp, slot * 6 + 2, 8)),
      ang: Int32Array.of(sar64(this.imp, slot * 6 + 3, 24), sar64(this.imp, slot * 6 + 4, 24), sar64(this.imp, slot * 6 + 5, 24)),
    }));
    return {
      tick: pk.tick,
      impulses,
      absorbed: pk.intakeIds.map((id, t) => ({ id, counts: absorbed.slice(t * KIND_COUNT, t * KIND_COUNT + KIND_COUNT) })),
      counts,
      checksum: finishChecksum(c0, c1, this.n),
      bounds,
      ...(pk.queryIds ? { near: pk.queryIds.map((id, qn) => nearResult(id, qcnt[qn]!, Array.from(qsum.subarray(qn * 6, qn * 6 + 6)))) } : {}),
      ...(surface ? { surface } : {}),
    };
  }
}

/** Hex form of a checksum pair, for logs and goldens. */
export function checksumHex(c: readonly [number, number]): string {
  return (c[0] >>> 0).toString(16).padStart(8, '0') + (c[1] >>> 0).toString(16).padStart(8, '0');
}

