// A toy Matter backend for the Matter host's plumbing tests (latency, rollback, hashing, MATR): MX's conventions
// (backend.ts) with trivial physics: gravity, proxies push particles out (the bodies get the reaction), intakes,
// blasts, a kill floor. No particle–particle forces. Deterministic in Node (doubles, fixed order), never shipped.
// The real backends (MX's CPU and GPU) are bit-exact with each other; this one only has to agree with itself.

import type { MatterBackendSync, MatterStepIn, MatterStepOut } from '../src/matter/contract.ts';

const U = 65536;
const G = Math.round((9.81 * U) / 3600); // units per tick²
const MASS = [1.6 / 18000, 0.001, 0.0054]; // kg per particle
const SPACING = [262, 813, 1049];
const RADIUS = [131, 406, 524];
const LIN_NS = 0.9375e-6;

const fmix = (h0: number): number => {
  let h = h0 | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

export interface ToyLog { readonly tick: number; readonly proxies: number; readonly emits: number; readonly intakes: number; readonly blasts: number }

export class ToyMatter implements MatterBackendSync {
  readonly kind = 'cpu' as const;
  n = 0;
  tick = 0;
  cap = 20000;
  seed = 0;
  pos = new Int32Array(0);
  vel = new Int32Array(0);
  mat = new Uint8Array(0);
  /** Every step input seen (tests check latency and ordering). */
  readonly log: ToyLog[] = [];
  /** Inputs by Matter tick (the latest timeline). */
  readonly inputs = new Map<number, MatterStepIn>();

  initSync(cfg: { capacity: number; seed: number }): void {
    this.cap = cfg.capacity; this.seed = cfg.seed;
    this.pos = new Int32Array(this.cap * 3); this.vel = new Int32Array(this.cap * 3); this.mat = new Uint8Array(this.cap);
    this.n = 0; this.tick = 0;
  }
  async init(cfg: { capacity: number; seed: number }): Promise<void> { this.initSync(cfg); }

  stepSync(input: MatterStepIn): MatterStepOut {
    if (input.tick !== this.tick) throw new Error(`toy matter: step ${input.tick} but state is at ${this.tick} (backend ticks count from the first command)`);
    this.log.push({ tick: input.tick, proxies: input.proxies.length, emits: input.emits.length, intakes: input.intakes.length, blasts: input.blasts.length });
    this.inputs.set(input.tick, input);
    const { pos, vel, mat } = this;
    for (const b of input.blasts) {
      for (let i = 0; i < this.n; i++) {
        const dx = pos[i * 3]! - b.center[0]!, dy = pos[i * 3 + 1]! - b.center[1]!, dz = pos[i * 3 + 2]! - b.center[2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= b.radius || d < 1) continue;
        const k = (b.impulse * (1 - d / b.radius)) / d;
        vel[i * 3]! += Math.trunc(dx * k); vel[i * 3 + 1]! += Math.trunc(dy * k); vel[i * 3 + 2]! += Math.trunc(dz * k);
      }
    }
    for (const e of [...input.emits].sort((a, b) => a.seq - b.seq)) {
      const side = Math.ceil(Math.cbrt(e.count));
      const sp = SPACING[e.kind]!;
      for (let j = 0; j < e.count && this.n < this.cap; j++) {
        const i = this.n++;
        const h = fmix(e.seed ^ Math.imul(j + 1, 0x9e3779b1));
        const ix = j % side, iy = Math.floor(j / side) % side, iz = Math.floor(j / (side * side));
        pos[i * 3] = e.pos[0]! + (ix - (side - 1) / 2) * sp + (h & 15) - 8;
        pos[i * 3 + 1] = e.pos[1]! + (iy - (side - 1) / 2) * sp + ((h >>> 4) & 15) - 8;
        pos[i * 3 + 2] = e.pos[2]! + (iz - (side - 1) / 2) * sp + ((h >>> 8) & 15) - 8;
        const s = e.spread;
        const jit = (k: number): number => (s > 0 ? (fmix(h + k) % (2 * s + 1)) - s : 0);
        vel[i * 3] = e.vel[0]! + jit(1); vel[i * 3 + 1] = e.vel[1]! + jit(2); vel[i * 3 + 2] = e.vel[2]! + jit(3);
        mat[i] = e.kind;
      }
    }
    // integrate, then collide with every proxy (dynamic ones collect the reaction)
    const imp = new Map<number, number[]>();
    for (const p of input.proxies) if (p.dynamic) imp.set(p.id, [0, 0, 0, 0, 0, 0]);
    // bounding radius per proxy (planes: none) for a cheap reject
    const reach = input.proxies.map((p) => (p.shape === 3 ? Infinity : p.shape === 0 ? p.size[0]! : p.shape === 1 ? p.size[0]! + p.size[1]! : Math.hypot(p.size[0]!, p.size[1]!, p.size[2]!)));
    for (let i = 0; i < this.n; i++) {
      vel[i * 3 + 1]! -= G;
      pos[i * 3]! += vel[i * 3]!; pos[i * 3 + 1]! += vel[i * 3 + 1]!; pos[i * 3 + 2]! += vel[i * 3 + 2]!;
      const r = RADIUS[mat[i]!]!;
      for (let q = 0; q < input.proxies.length; q++) {
        const p = input.proxies[q]!;
        const R = reach[q]! + r;
        if (R !== Infinity && (Math.abs(pos[i * 3]! - p.pos[0]!) > R || Math.abs(pos[i * 3 + 1]! - p.pos[1]!) > R || Math.abs(pos[i * 3 + 2]! - p.pos[2]!) > R)) continue;
        const hit = collide(p, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, r);
        if (!hit) continue;
        const [nx, ny, nz, depth] = hit;
        pos[i * 3]! += Math.round(nx * depth); pos[i * 3 + 1]! += Math.round(ny * depth); pos[i * 3 + 2]! += Math.round(nz * depth);
        // remove the inward normal velocity relative to the proxy (simple: the proxy's own velocity at its centre)
        const rvx = vel[i * 3]! - p.vel[0]!, rvy = vel[i * 3 + 1]! - p.vel[1]!, rvz = vel[i * 3 + 2]! - p.vel[2]!;
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn >= 0) continue;
        const dvx = -vn * nx, dvy = -vn * ny, dvz = -vn * nz;
        vel[i * 3]! += Math.round(dvx); vel[i * 3 + 1]! += Math.round(dvy); vel[i * 3 + 2]! += Math.round(dvz);
        const acc = imp.get(p.id);
        if (!acc) continue;
        // the body gets −m·Δv (N·s → units), about the proxy's centre
        const k = (MASS[mat[i]!]! * 60) / U / LIN_NS;
        const jx = -dvx * k, jy = -dvy * k, jz = -dvz * k;
        acc[0]! += jx; acc[1]! += jy; acc[2]! += jz;
        const ax = (pos[i * 3]! - p.pos[0]!) / U, ay = (pos[i * 3 + 1]! - p.pos[1]!) / U, az = (pos[i * 3 + 2]! - p.pos[2]!) / U;
        acc[3]! += ay * jz - az * jy; acc[4]! += az * jx - ax * jz; acc[5]! += ax * jy - ay * jx;
      }
    }
    // intakes (first containing intake in input order, ≤ capacity each), the kill floor, stable compaction
    const absorbed = input.intakes.map((it) => ({ id: it.id, counts: new Int32Array(3), left: it.capacity, it }));
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      let gone = y < -10 * U;
      if (!gone) {
        for (const a of absorbed) {
          const it = a.it;
          if (!((it.kindMask >> mat[i]!) & 1) || a.left <= 0) continue;
          if (x >= it.min[0]! && x < it.max[0]! && y >= it.min[1]! && y < it.max[1]! && z >= it.min[2]! && z < it.max[2]!) { a.counts[mat[i]!]!++; a.left--; gone = true; break; }
        }
      }
      if (gone) continue;
      if (w !== i) {
        pos[w * 3] = x; pos[w * 3 + 1] = y; pos[w * 3 + 2] = z;
        vel[w * 3] = vel[i * 3]!; vel[w * 3 + 1] = vel[i * 3 + 1]!; vel[w * 3 + 2] = vel[i * 3 + 2]!;
        mat[w] = mat[i]!;
      }
      w++;
    }
    this.n = w;
    const counts = new Int32Array(3);
    let s0 = 0, s1 = 0;
    const bounds = new Int32Array(6);
    for (let i = 0; i < this.n; i++) {
      counts[mat[i]!]!++;
      s0 = (s0 + pos[i * 3]! + Math.imul(pos[i * 3 + 1]!, 3)) >>> 0;
      s1 = (s1 + fmix(pos[i * 3 + 2]! ^ vel[i * 3 + 1]! ^ i)) >>> 0;
      for (let k = 0; k < 3; k++) {
        if (i === 0 || pos[i * 3 + k]! < bounds[k]!) bounds[k] = pos[i * 3 + k]!;
        if (i === 0 || pos[i * 3 + k]! > bounds[k + 3]!) bounds[k + 3] = pos[i * 3 + k]!;
      }
    }
    const impulses: MatterStepOut['impulses'] = [];
    for (const p of input.proxies) {
      const a = imp.get(p.id);
      if (!a) continue;
      impulses.push({ id: p.id, lin: Int32Array.of(Math.trunc(a[0]!), Math.trunc(a[1]!), Math.trunc(a[2]!)), ang: Int32Array.of(Math.trunc(a[3]!), Math.trunc(a[4]!), Math.trunc(a[5]!)) });
    }
    // near queries: grains of the kinds within the radius, and their centroid (truncated means)
    const near = (input.queries ?? []).map((q) => {
      let n = 0, cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < this.n; i++) {
        if (!((q.kindMask >> mat[i]!) & 1)) continue;
        const dx = pos[i * 3]! - q.center[0]!, dy = pos[i * 3 + 1]! - q.center[1]!, dz = pos[i * 3 + 2]! - q.center[2]!;
        if (dx * dx + dy * dy + dz * dz > q.radius * q.radius) continue;
        n++; cx += pos[i * 3]!; cy += pos[i * 3 + 1]!; cz += pos[i * 3 + 2]!;
      }
      return { id: q.id, count: n, centroid: n ? Int32Array.of(Math.trunc(cx / n), Math.trunc(cy / n), Math.trunc(cz / n)) : new Int32Array(3) };
    });
    this.tick++;
    return { tick: input.tick, impulses, absorbed: absorbed.map((a) => ({ id: a.id, counts: a.counts })), counts, checksum: [s0, s1], bounds, ...(near.length ? { near } : {}) };
  }
  async step(input: MatterStepIn): Promise<MatterStepOut> { return this.stepSync(input); }

  snapshotSync(): Uint8Array {
    const out = new Uint8Array(16 + this.n * 25);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x3152544d, true); dv.setUint32(4, this.tick, true); dv.setUint32(8, this.n, true); dv.setUint32(12, this.cap, true);
    for (let i = 0; i < this.n * 3; i++) { dv.setInt32(16 + i * 4, this.pos[i]!, true); dv.setInt32(16 + this.n * 12 + i * 4, this.vel[i]!, true); }
    out.set(this.mat.subarray(0, this.n), 16 + this.n * 24);
    return out;
  }
  async snapshot(): Promise<Uint8Array> { return this.snapshotSync(); }

  restoreSync(bytes: Uint8Array): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.tick = dv.getUint32(4, true); this.n = dv.getUint32(8, true);
    for (let i = 0; i < this.n * 3; i++) { this.pos[i] = dv.getInt32(16 + i * 4, true); this.vel[i] = dv.getInt32(16 + this.n * 12 + i * 4, true); }
    this.mat.set(bytes.subarray(16 + this.n * 24, 16 + this.n * 25));
  }
  async restore(bytes: Uint8Array): Promise<void> { this.restoreSync(bytes); }

  destroy(): void { this.n = 0; }
}

/** Push-out direction and depth (units) of a sphere of radius r at (x, y, z) against a proxy, or null. */
function collide(p: MatterStepIn['proxies'][number], x: number, y: number, z: number, r: number): [number, number, number, number] | null {
  const q = [p.rot[0]! / 16384, p.rot[1]! / 16384, p.rot[2]! / 16384, p.rot[3]! / 16384];
  const inv = (v: number[]): number[] => rotate([-q[0]!, -q[1]!, -q[2]!, q[3]!], v);
  const l = inv([x - p.pos[0]!, y - p.pos[1]!, z - p.pos[2]!]);
  let n: number[], d: number;
  switch (p.shape) {
    case 3: { // plane: normal local +Y, solid below
      if (l[1]! >= r) return null;
      n = [0, 1, 0]; d = r - l[1]!; break;
    }
    case 0: { const len = Math.hypot(l[0]!, l[1]!, l[2]!); const rr = p.size[0]! + r; if (len >= rr || len < 1e-9) return null; n = [l[0]! / len, l[1]! / len, l[2]! / len]; d = rr - len; break; }
    case 1: {
      const h = p.size[1]!, cy = Math.max(-h, Math.min(h, l[1]!));
      const v = [l[0]!, l[1]! - cy, l[2]!], len = Math.hypot(v[0]!, v[1]!, v[2]!), rr = p.size[0]! + r;
      if (len >= rr || len < 1e-9) return null;
      n = [v[0]! / len, v[1]! / len, v[2]! / len]; d = rr - len; break;
    }
    default: {
      const e = [p.size[0]! + r, p.size[1]! + r, p.size[2]! + r];
      const pen = [e[0]! - Math.abs(l[0]!), e[1]! - Math.abs(l[1]!), e[2]! - Math.abs(l[2]!)];
      if (pen[0]! <= 0 || pen[1]! <= 0 || pen[2]! <= 0) return null;
      const ax = pen[0]! < pen[1]! ? (pen[0]! < pen[2]! ? 0 : 2) : (pen[1]! < pen[2]! ? 1 : 2);
      n = [0, 0, 0]; n[ax] = l[ax]! < 0 ? -1 : 1; d = pen[ax]!;
    }
  }
  const w = rotate(q, n);
  return [w[0]!, w[1]!, w[2]!, d];
}

function rotate(q: number[], v: number[]): number[] {
  const [x, y, z, w] = q as [number, number, number, number];
  const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
  return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
}
