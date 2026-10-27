// Bake-ahead keyframe store (GAME_SPEC §6.5, SIMULATION §11, DATA_FORMATS §6.1): what the sim worker plays back from.
//
// M1 kept every body's full transform in every keyframe (28 B × bodies × 30 Hz): fine for a Room, 15 GB for three
// minutes of Domino Day. This store keeps a base frame plus, per keyframe, only the bodies that moved since the
// last one (Machine.changedTransforms: awake now or awake then), as f32 position + snorm16 quaternion (20 B), and
// per-part state arrays only when they changed. Playback walks a cursor frame forward through the deltas (or
// from a periodic full frame when scrubbing back) and interpolates just the bodies in the next delta.
// Over budget, the oldest keyframes fold into the base, so the history window shrinks instead of the tab dying.

export interface StateArrays {
  readonly f: Uint8Array;   // Machine.partFlags
  readonly m: Uint8Array;   // Machine.partMeters
  readonly l: Float32Array; // Machine.linkState
  readonly c: Uint8Array;   // Machine.critterState
  readonly k: Int32Array;   // Machine.critterCarry
  readonly b: Float32Array; // G3: Machine.lightBeams (8 floats per segment)
  readonly mf: Float32Array; // MI (M4): Machine.partFill per part (0–1, HELIO up to 1.1): container fill for R4's fill pass
  readonly mc: Int32Array;   // MI (M4): live Matter grains [sand, water, marble] (empty with Matter off), for U4's meter
  readonly g?: Int32Array;   // U5 (M5): Machine.critterTargets pairs [BUZZ index, item index] (the item BUZZ is after), for the tag glyph
  readonly gj?: Float32Array; // R5 (M5): Machine.grabberJoints, 8 floats per GRABBER (A5), for the finger pivots
}

export interface Frame extends StateArrays {
  readonly t: Float32Array; // 7 floats per body
}

interface Delta extends StateArrays {
  readonly idx: Int32Array;
  readonly pos: Float32Array; // 3 per entry
  readonly rot: Int16Array;   // 4 per entry (snorm16)
  readonly bytes: number;
}

const Q = 32767;

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export class BakeStore {
  readonly kf: number;
  /** Ticks of the oldest and newest keyframes held. */
  baseTick = 0;
  headTick = 0;
  /** Bytes held (deltas, full frames, base). */
  bytes = 0;
  private readonly bodies: number;
  private readonly budget: number;
  private base: Float32Array;
  private baseState: StateArrays;
  private readonly deltas = new Map<number, Delta>();
  private readonly fulls = new Map<number, Float32Array>();
  private readonly fullEvery: number;
  private last: StateArrays;
  /** The full frame at headTick (full frames for scrubbing are copies of it). */
  private head: Float32Array;
  // playback cursor: the full frame at keyframe `curK`
  private cur: Float32Array;
  private curK = 0;
  private curState: StateArrays;

  /** Longest history held (ticks); older keyframes fold into the base. */
  private readonly maxSpan: number;

  constructor(kf: number, first: { t: Float32Array } & StateArrays, budgetBytes = 768 * 1048576, maxSpanTicks = 5400 * 4) {
    this.kf = kf;
    this.maxSpan = maxSpanTicks;
    this.bodies = first.t.length / 7;
    this.budget = budgetBytes;
    this.base = first.t.slice();
    this.cur = first.t.slice();
    this.head = first.t.slice();
    this.baseState = first;
    this.curState = first;
    this.last = first;
    // full frames for scrubbing back: together ≤ 1/8 of the budget across the 3-minute window, ≥ 1 s apart
    const fullBytes = this.bodies * 28;
    this.fullEvery = Math.max(30, Math.ceil(5400 / Math.max(1, Math.floor(budgetBytes / 8 / Math.max(1, fullBytes))))) * kf;
    this.bytes = fullBytes * 3;
  }

  get oldest(): number { return this.baseTick; }

  /** Stores keyframe `tick` (= head + kf) from the bodies that moved and the current state arrays. */
  put(tick: number, moved: { idx: Int32Array; xf: Float32Array }, s: StateArrays): void {
    const n = moved.idx.length;
    const pos = new Float32Array(n * 3), rot = new Int16Array(n * 4);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = moved.xf[k * 7]!; pos[k * 3 + 1] = moved.xf[k * 7 + 1]!; pos[k * 3 + 2] = moved.xf[k * 7 + 2]!;
      for (let j = 0; j < 4; j++) rot[k * 4 + j] = Math.round(moved.xf[k * 7 + 3 + j]! * Q);
    }
    // share the per-part arrays with the previous keyframe while they're unchanged (most keyframes)
    const keep = <T extends ArrayLike<number>>(a: T, b: T): T => (same(a, b) ? b : a);
    const st: StateArrays = { f: keep(s.f, this.last.f), m: keep(s.m, this.last.m), l: keep(s.l, this.last.l), c: keep(s.c, this.last.c), k: keep(s.k, this.last.k), b: keep(s.b, this.last.b), mf: keep(s.mf, this.last.mf), mc: keep(s.mc, this.last.mc),
      ...(s.g ? { g: this.last.g ? keep(s.g, this.last.g) : s.g } : {}), // U5 (M5): g
      ...(s.gj ? { gj: this.last.gj ? keep(s.gj, this.last.gj) : s.gj } : {}) }; // R5 (M5): gj
    let bytes = n * 24 + 64;
    for (const key of ['f', 'm', 'l', 'c', 'k', 'b', 'mf', 'mc'] as const) if (st[key] !== this.last[key]) bytes += st[key].byteLength;
    if (st.g && st.g !== this.last.g) bytes += st.g.byteLength; // U5 (M5)
    if (st.gj && st.gj !== this.last.gj) bytes += st.gj.byteLength; // R5 (M5)
    this.last = st;
    const d: Delta = { idx: moved.idx, pos, rot, bytes, ...st };
    this.deltas.set(tick, d);
    this.headTick = tick;
    this.bytes += bytes;
    this.apply(this.head, d);
    if (tick % this.fullEvery === 0) {
      this.fulls.set(tick, this.head.slice());
      this.bytes += this.head.byteLength;
    }
    while ((this.bytes > this.budget && this.baseTick < this.headTick - this.kf * 60) || this.headTick - this.baseTick > this.maxSpan) this.foldOldest();
  }

  /** Forgets everything after `tick` (a rollback re-bakes it). */
  truncate(tick: number): void {
    for (const k of [...this.deltas.keys()]) if (k > tick) { this.bytes -= this.deltas.get(k)!.bytes; this.deltas.delete(k); }
    for (const k of [...this.fulls.keys()]) if (k > tick) { this.bytes -= this.fulls.get(k)!.byteLength; this.fulls.delete(k); }
    this.headTick = Math.min(this.headTick, Math.max(this.baseTick, tick - (tick % this.kf)));
    this.last = this.headTick > this.baseTick ? this.deltas.get(this.headTick)! : this.baseState;
    if (this.curK > this.headTick) this.loadAt(this.nearestFull(this.headTick));
    // rebuild the head frame: the newest full frame at or before it, then the deltas
    const b = this.nearestFull(this.headTick);
    this.head.set(b === this.baseTick ? this.base : this.fulls.get(b)!);
    for (let k = b + this.kf; k <= this.headTick; k += this.kf) { const d = this.deltas.get(k); if (d) this.apply(this.head, d); }
  }

  /** The frame at fractional tick `t` (clamped to the held range): body transforms interpolated between keyframes. */
  frame(t: number, withTransforms = true): Frame {
    const tc = Math.max(this.baseTick, Math.min(this.headTick, t));
    const K = Math.floor(tc / this.kf) * this.kf;
    this.seek(K);
    const out = withTransforms ? this.cur.slice() : new Float32Array(0);
    const next = this.deltas.get(K + this.kf);
    const u = (tc - K) / this.kf;
    if (next && u > 0 && withTransforms) {
      const { idx, pos, rot } = next;
      for (let k = 0; k < idx.length; k++) {
        const o = idx[k]! * 7;
        for (let j = 0; j < 3; j++) out[o + j] = out[o + j]! + (pos[k * 3 + j]! - out[o + j]!) * u;
        let d = 0;
        for (let j = 0; j < 4; j++) d += out[o + 3 + j]! * rot[k * 4 + j]!;
        const s = d < 0 ? -1 : 1;
        let len = 0;
        for (let j = 0; j < 4; j++) { const v = out[o + 3 + j]! + ((rot[k * 4 + j]! / Q) * s - out[o + 3 + j]!) * u; out[o + 3 + j] = v; len += v * v; }
        len = Math.sqrt(len) || 1;
        for (let j = 0; j < 4; j++) out[o + 3 + j] = out[o + 3 + j]! / len;
      }
    }
    const st = u >= 0.5 && next ? next : this.curState;
    return { t: out, f: st.f, m: st.m, l: st.l, c: st.c, k: st.k, b: st.b, mf: st.mf, mc: st.mc, ...(st.g ? { g: st.g } : {}), ...(st.gj ? { gj: st.gj } : {}) }; // MI (M4): mf, mc; U5 (M5): g; R5 (M5): gj
  }

  /** Did keyframe K or K+kf change any body (so a frame at a tick inside them can differ from the last one)? */
  moving(t: number): boolean {
    const K = Math.floor(t / this.kf) * this.kf;
    return (this.deltas.get(K + this.kf)?.idx.length ?? 0) > 0;
  }

  // ---- cursor ----------------------------------------------------------------------------------------------

  private resetCursor(): void { this.loadAt(this.baseTick); }

  /** Newest full frame at or before K (the base when there's none). */
  private nearestFull(K: number): number {
    let best = this.baseTick;
    for (const f of this.fulls.keys()) if (f <= K && f > best) best = f;
    return best;
  }

  private loadAt(b: number): void {
    if (b <= this.baseTick) { this.cur.set(this.base); this.curK = this.baseTick; this.curState = this.baseState; return; }
    this.cur.set(this.fulls.get(b)!);
    this.curK = b;
    this.curState = this.deltas.get(b) ?? this.curState;
  }

  private seek(K: number): void {
    if (K < this.curK) this.loadAt(this.nearestFull(K));
    else if (K - this.curK > this.fullEvery) { const b = this.nearestFull(K); if (b > this.curK) this.loadAt(b); }
    while (this.curK < K) {
      const d = this.deltas.get(this.curK + this.kf);
      if (!d) break;
      this.apply(this.cur, d);
      this.curK += this.kf;
      this.curState = d;
    }
  }

  private apply(to: Float32Array, d: Delta): void {
    const { idx, pos, rot } = d;
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k]! * 7;
      to[o] = pos[k * 3]!; to[o + 1] = pos[k * 3 + 1]!; to[o + 2] = pos[k * 3 + 2]!;
      for (let j = 0; j < 4; j++) to[o + 3 + j] = rot[k * 4 + j]! / Q;
    }
  }

  /** Over budget: the oldest keyframe becomes part of the base. */
  private foldOldest(): void {
    const k = this.baseTick + this.kf;
    const d = this.deltas.get(k);
    if (!d) { this.baseTick = k; return; }
    this.apply(this.base, d);
    this.baseState = d;
    this.baseTick = k;
    this.bytes -= d.bytes;
    this.deltas.delete(k);
    const f = this.fulls.get(k);
    if (f) { this.bytes -= f.byteLength; this.fulls.delete(k); }
    if (this.curK < this.baseTick) this.resetCursor();
  }
}
