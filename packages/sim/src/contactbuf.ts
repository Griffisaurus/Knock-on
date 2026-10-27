// J4 (M4): the Machine's side of the buffered contact path (packages/jolt/src/contacts.ts has the callbacks).
//
// Before a step the Machine writes the per-body tables the callbacks read (belt surface velocities, who wants
// persisted contacts); during the step every Jolt thread appends records; after it `gather` puts them in canonical
// order — (lower body index, higher body index, added, place in the pair's callbacks, sub-shapes, then the record's
// own words) — so the sim sees the same contacts in the same order at any thread count, and in the single-threaded build too.

import { BF_CONVEYOR, BF_PERSIST, CONTACT_WORDS, CTL, CTL_WORDS, contactCallbacks, contactScriptUrl, joltIsThreaded, type JoltModule } from '@knockon/jolt';

/** Called for each added contact, in canonical order, before the Machine's contact stage (the critters' hook). */
export type AddedHook = (i1: number, i2: number, v1x: number, v1y: number, v1z: number, v2x: number, v2y: number, v2z: number,
  nx: number, ny: number, nz: number, inv1: number, inv2: number, J: number) => void;

export class ContactBuffer {
  /** The listener to hand to `PhysicsSystem.SetContactListener`. */
  readonly listener: JoltModule;
  private readonly J: JoltModule;
  private readonly ctl: number;
  private recs = 0;
  private cap = 0;
  private flags = 0;
  private surf = 0;
  private nTab = 0;
  private withSurf = false;
  /** Steps whose records passed the buffer (the extra records were lost); diagnostics, never fed to the sim. */
  overflows = 0;
  private order = new Uint32Array(0);

  /** Create before the `JoltInterface`: its job threads pick up the callbacks as they start. */
  constructor(J: JoltModule, capacity: number) {
    this.J = J;
    this.listener = new J.ContactListenerJS();
    this.ctl = J._webidl_malloc(CTL_WORDS * 4) as number;
    J.HEAP32.fill(0, this.ctl >> 2, (this.ctl >> 2) + CTL_WORDS);
    this.reserve(capacity);
    const params = { listener: J.getPointer(this.listener) as number, ctl: this.ctl };
    contactCallbacks(J, params);
    if (joltIsThreaded(J)) J.configureWorkerScripts(contactScriptUrl(), params);
  }

  private reserve(capacity: number): void {
    const J = this.J;
    if (this.recs) J._webidl_free(this.recs);
    this.cap = Math.max(256, Math.ceil(capacity));
    this.recs = J._webidl_malloc(this.cap * CONTACT_WORDS * 4) as number;
    const c = this.ctl >> 2;
    J.HEAP32[c + CTL.cap] = this.cap;
    J.HEAP32[c + CTL.recs] = this.recs;
  }

  /** The body tables cover indices below `n` (grown between steps only; new bodies start with no flags). */
  bodies(n: number, surfaces: boolean): void {
    if (n <= this.nTab && (!surfaces || this.withSurf)) return;
    const J = this.J, c = this.ctl >> 2;
    const size = Math.max(n, this.nTab, 64);
    const flags = J._webidl_malloc(size) as number;
    J.HEAPU8.fill(0, flags, flags + size);
    if (this.flags) { J.HEAPU8.copyWithin(flags, this.flags, this.flags + this.nTab); J._webidl_free(this.flags); }
    let surf = 0;
    if (surfaces || this.withSurf) {
      surf = J._webidl_malloc(size * 12) as number;
      J.HEAPF32.fill(0, surf >> 2, (surf >> 2) + size * 3);
      if (this.surf) { J.HEAPF32.copyWithin(surf >> 2, this.surf >> 2, (this.surf >> 2) + this.nTab * 3); J._webidl_free(this.surf); }
      this.withSurf = true;
    }
    this.flags = flags; this.surf = surf; this.nTab = size;
    J.HEAP32[c + CTL.flags] = flags;
    J.HEAP32[c + CTL.surf] = surf;
    J.HEAP32[c + CTL.nTab] = size;
  }

  /** Body `i` wants its persisted contacts (pressure parts, channel parts that ask). */
  persist(i: number): void { this.J.HEAPU8[this.flags + i] |= BF_PERSIST; }

  /** Body `i` is a belt moving at `x, y, z` (f32 values, world frame); `on` false stops it driving. */
  surface(i: number, on: boolean, x: number, y: number, z: number): void {
    const J = this.J;
    if (on) J.HEAPU8[this.flags + i] |= BF_CONVEYOR; else J.HEAPU8[this.flags + i] &= ~BF_CONVEYOR;
    const s = (this.surf >> 2) + i * 3;
    J.HEAPF32[s] = x; J.HEAPF32[s + 1] = y; J.HEAPF32[s + 2] = z;
  }

  /** Persisted contacts reach the callbacks at all (S3: none unless some part reads them). */
  set persistAny(on: boolean) { this.J.HEAP32[(this.ctl >> 2) + CTL.persistAny] = on ? 1 : 0; }

  /** Clears the counters before a step. */
  begin(): void {
    const I = this.J.HEAP32 as Int32Array, c = this.ctl >> 2;
    I[c + CTL.count] = 0;
    I[c + CTL.calls] = 0;
    I[c + CTL.step] = (I[c + CTL.step]! + 1) | 0;
  }

  /** Callbacks made during the last step (A3's buffer-saturation diagnostic). */
  get calls(): number { return this.J.HEAP32[(this.ctl >> 2) + CTL.calls] as number; }

  /**
   * The last step's records in canonical order: added ones go to `added` (critters), and every record is appended
   * to `out` as the Machine's 10-number contact (body 1, body 2, impulse estimate, closing speed, point, normal y,
   * added, 0), exactly as the M1–M3 listener computed them.
   */
  gather(out: number[], added: AddedHook): void {
    const J = this.J;
    const I = J.HEAP32 as Int32Array, F = J.HEAPF32 as Float32Array, c = this.ctl >> 2;
    const written = I[c + CTL.count]!;
    const n = Math.min(written, this.cap);
    if (n) this.emit(I, F, n, out, added);
    // over capacity: the extra records are lost (in the threaded build, which ones depends on timing). Later steps
    // get room; the count is a diagnostic like contactPeak (it takes a step past Jolt's own contact buffer)
    if (written > this.cap) { this.overflows++; this.reserve(written * 1.5); }
  }

  private emit(I: Int32Array, F: Float32Array, n: number, out: number[], added: AddedHook): void {
    if (this.order.length < n) this.order = new Uint32Array(Math.max(n, this.order.length * 2));
    const order = this.order;
    for (let k = 0; k < n; k++) order[k] = k;
    const W = CONTACT_WORDS;
    const b0 = this.recs >> 2;
    const cmp = (x: number, y: number): number => {
      const ox = b0 + x * W, oy = b0 + y * W;
      const ax = I[ox]!, bx = I[ox + 1]!, ay = I[oy]!, by = I[oy + 1]!;
      const lx = ax < bx ? ax : bx, ly = ay < by ? ay : by;
      if (lx !== ly) return lx - ly;
      const hx = ax < bx ? bx : ax, hy = ay < by ? by : ay;
      if (hx !== hy) return hx - hy;
      if (I[ox + 2] !== I[oy + 2]) return I[ox + 2]! - I[oy + 2]!;
      if (I[ox + 19] !== I[oy + 19]) return I[ox + 19]! - I[oy + 19]!;
      for (let w = 3; w < 5; w++) { const u = I[ox + w]! >>> 0, v = I[oy + w]! >>> 0; if (u !== v) return u < v ? -1 : 1; }
      if (ax !== ay) return ax - ay;
      for (let w = 5; w < 19; w++) { const u = I[ox + w]!, v = I[oy + w]!; if (u !== v) return u < v ? -1 : 1; }
      return 0;
    };
    const ord = order.subarray(0, n).sort(cmp);
    for (let k = 0; k < n; k++) {
      const o = b0 + ord[k]! * W;
      const i1 = I[o]!, i2 = I[o + 1]!, isAdded = I[o + 2] === 1;
      const v1x = F[o + 5]!, v1y = F[o + 6]!, v1z = F[o + 7]!, v2x = F[o + 8]!, v2y = F[o + 9]!, v2z = F[o + 10]!;
      const nx = F[o + 11]!, ny = F[o + 12]!, nz = F[o + 13]!, inv1 = F[o + 14]!, inv2 = F[o + 15]!;
      // impulse estimate: reduced mass × closing speed along the normal (the M1 listener's arithmetic, in order)
      const vn = (v1x - v2x) * nx + (v1y - v2y) * ny + (v1z - v2z) * nz;
      const mred = inv1 + inv2 > 0 ? 1 / (inv1 + inv2) : 0;
      if (isAdded) added(i1, i2, v1x, v1y, v1z, v2x, v2y, v2z, nx, ny, nz, inv1, inv2, mred * Math.abs(vn));
      out.push(i1, i2, isAdded ? mred * Math.abs(vn) : 0, Math.abs(vn), F[o + 16]!, F[o + 17]!, F[o + 18]!, ny, isAdded ? 1 : 0, 0);
    }
  }

  destroy(): void {
    const J = this.J;
    for (const p of [this.recs, this.flags, this.surf, this.ctl]) if (p) J._webidl_free(p);
    this.recs = this.flags = this.surf = 0;
    J.destroy(this.listener);
  }
}
