// Mesh library (RENDERING §4.1): every mesh LOD is a range in one global vertex + index buffer, so
// culling can bucket instances per (mesh, LOD) and draw each bucket with one indirect call.
// Vertex: position f32×3 + normal f32×3 + colour unorm8×4 + material unorm8×4 (32 B). Procedural
// unit meshes fit a 1 m cube centred on the origin and instances scale them to the part's size;
// art meshes (glb) are in metres and carry their master materials per vertex.

export interface Geometry {
  readonly positions: Float32Array; // xyz
  readonly normals: Float32Array; // xyz
  readonly indices: Uint32Array;
  /** Per-vertex linear RGBA (default white: the instance colour applies). */
  readonly colors?: Float32Array;
  /** Per-vertex [roughness, metallic, emissive, kind] (default: the instance material applies). `kind` is a
   * MAT_KIND value: the master material, a decal texel (atlas at `uvs`) or an engine-drawn screen. */
  readonly mats?: Float32Array;
  /** Per-vertex uv (TEXCOORD_0): decal atlas coordinates, or 0–1 across a screen quad. */
  readonly uvs?: Float32Array;
  /** L3 (M3): per-vertex glTF tangent as one code (look/tangents.ts tangentCode; 0 = none), in the normal's w. */
  readonly tangentCodes?: Float32Array;
  /** Shape keys (glTF morph targets): per vertex a float offset into `table` (−1: no deltas); each such row
   * holds `names.length` × (dpos xyz, dnormal xyz). At most MAX_PART_MORPHS keys are used on part meshes. */
  readonly morph?: { readonly names: readonly string[]; readonly rowOf: Int32Array; readonly table: Float32Array };
}

/** Shape keys per part mesh the instanced path animates (the morph row word packs the count in 3 bits). */
export const MAX_PART_MORPHS = 7;
/** Weights per morph slot in the renderer's per-instance weight table. */
export const MORPH_SLOT = 8;
/** Morph row word for vertices without deltas. */
export const NO_MORPH = 0xffffffff;

/** `mats[3]` values (stored as unorm8): 0 = instance material, else per-vertex master material of this kind.
 * Screens keep their cell count in `mats[0]` (cells / 255). */
export const MAT_KIND = { instance: 0, decal: 64 / 255, screen: 128 / 255, master: 1 } as const;

export interface MeshLod {
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly baseVertex: number;
}

export interface MeshInfo {
  readonly name: string;
  readonly lods: readonly MeshLod[];
  /** Projected-size thresholds (radius / distance × projScale, i.e. screen fraction) to drop to LOD i+1. */
  readonly lodSwitch: readonly number[];
  /** Transmissive (kn_poly_*, kn_glass): drawn in the sorted glass pass, never in the opaque or shadow passes. */
  readonly glass: boolean;
  /** LOD0 bounding sphere in mesh space (glass sorting). */
  readonly center: readonly [number, number, number];
  readonly radius: number;
  /** LOD0 axis-aligned half extents in mesh space, around `center` (G3: global SDF stamping). */
  readonly half?: readonly [number, number, number];
  /**
   * R5 (M5): how round the LOD0 hull is, 0–1: the largest corner radius (× min(half)) of a rounded box around
   * `center` / `half` that still holds every vertex (a sphere → 1, a box → 0). The global SDF stamps that rounded
   * box instead of the full box, so round parts no longer sit inside their own SDF corners (the M4 "dark patches
   * at a non-1 scale": the SDF soft shadow's first step stayed inside the box once the corner gap outgrew it).
   */
  readonly round?: number;
  /** Shape-key names (morph weights order); empty when the mesh has none. */
  readonly targetNames: readonly string[];
}

export interface MeshOptions { readonly glass?: boolean }

/** pos f32×3 · normal snorm16×4 · colour unorm8×4 · material unorm8×4 · uv unorm16×2 = 32 bytes. */
export const VERTEX_STRIDE = 32;

/** R5 (M5): MeshInfo.round by bisection (≤ 20k vertices sampled; a vertex may stick out by 1 % of min(half)). */
export function roundness(p: ArrayLike<number>, c: readonly number[], h: readonly number[]): number {
  const m = Math.min(h[0]!, h[1]!, h[2]!);
  const n = Math.floor(p.length / 3);
  if (!(m > 1e-5) || n < 4) return 0;
  const stride = Math.max(1, Math.floor(n / 20000));
  const tol = m * 0.01 + 1e-5;
  const fits = (f: number): boolean => {
    const r = f * m, bx = h[0]! - r, by = h[1]! - r, bz = h[2]! - r;
    for (let i = 0; i < n; i += stride) {
      const qx = Math.abs(p[i * 3]! - c[0]!) - bx, qy = Math.abs(p[i * 3 + 1]! - c[1]!) - by, qz = Math.abs(p[i * 3 + 2]! - c[2]!) - bz;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
      if (d > tol) return false;
    }
    return true;
  };
  let a = 0, b = 1;
  if (fits(1)) return 1;
  for (let k = 0; k < 12; k++) { const mid = (a + b) / 2; if (fits(mid)) a = mid; else b = mid; }
  return a;
}

export class MeshLibrary {
  readonly meshes: MeshInfo[] = [];
  private readonly byName = new Map<string, number>();
  private verts: number[] = []; // 8 words per vertex: 3 floats, then 5 packed words
  private idx: number[] = [];
  private morphRow: number[] = [];
  private morphTable: number[] = [];
  vertexBuffer: GPUBuffer | null = null;
  /** Per vertex u32: (float offset of its deltas << 3) | key count, or NO_MORPH (second vertex stream). */
  morphIndexBuffer: GPUBuffer | null = null;
  /** Storage: shape-key deltas (f32), rows of key count × (dpos, dnormal). */
  morphTableBuffer: GPUBuffer | null = null;
  indexBuffer: GPUBuffer | null = null;
  private dirty = true;

  add(name: string, lods: readonly Geometry[], lodSwitch: readonly number[] = [], opts: MeshOptions = {}): number {
    const out: MeshLod[] = [];
    let targetNames: readonly string[] = [];
    for (const g of lods) {
      const mo = g.morph && g.morph.names.length <= MAX_PART_MORPHS ? g.morph : undefined;
      if (mo) targetNames = mo.names;
      const tableBase = this.morphTable.length;
      if (mo) for (const v of mo.table) this.morphTable.push(v);
      const baseVertex = this.verts.length / 8;
      for (let i = 0; i < g.positions.length / 3; i++) {
        const c = g.colors ? [g.colors[i * 4]!, g.colors[i * 4 + 1]!, g.colors[i * 4 + 2]!, g.colors[i * 4 + 3]!] : [1, 1, 1, 1];
        const m = g.mats ? [g.mats[i * 4]!, g.mats[i * 4 + 1]!, g.mats[i * 4 + 2]!, g.mats[i * 4 + 3]!] : [0, 0, 0, 0];
        const u = g.uvs ? [g.uvs[i * 2]!, g.uvs[i * 2 + 1]!] : [0, 0];
        this.verts.push(
          g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!,
          packSnorm16(g.normals[i * 3]!, g.normals[i * 3 + 1]!), packSnorm16(g.normals[i * 3 + 2]!, g.tangentCodes?.[i] ?? 0),
          packUnorm(c, true), packUnorm(m, false), packUnorm16(u[0]!, u[1]!),
        );
        const r = mo ? mo.rowOf[i]! : -1;
        this.morphRow.push(r < 0 ? NO_MORPH : (((tableBase + r) << 3) | mo!.names.length) >>> 0);
      }
      const firstIndex = this.idx.length;
      for (const v of g.indices) this.idx.push(v);
      out.push({ firstIndex, indexCount: g.indices.length, baseVertex });
    }
    const p0 = lods[0]?.positions ?? new Float32Array(3);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p0.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, p0[i]!); hi[i % 3] = Math.max(hi[i % 3]!, p0[i]!); }
    const center = [0, 1, 2].map((k) => (Number.isFinite(lo[k]!) ? (lo[k]! + hi[k]!) / 2 : 0)) as [number, number, number];
    const radius = Number.isFinite(lo[0]!) ? 0.5 * Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) : 0;
    const half = [0, 1, 2].map((k) => (Number.isFinite(lo[k]!) ? (hi[k]! - lo[k]!) / 2 : 0)) as [number, number, number];
    const round = roundness(p0, center, half); // R5 (M5)
    this.meshes.push({ name, lods: out, lodSwitch, glass: opts.glass ?? false, center, radius, half, round, targetNames });
    this.byName.set(name, this.meshes.length - 1);
    this.dirty = true;
    return this.meshes.length - 1;
  }

  id(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`unknown mesh ${name}`);
    return i;
  }

  has(name: string): boolean { return this.byName.has(name); }

  /** (Re)uploads when meshes were added. Returns true if the buffers changed. */
  upload(device: GPUDevice): boolean {
    if (!this.dirty) return false;
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.morphIndexBuffer?.destroy();
    this.morphTableBuffer?.destroy();
    const v = new Float32Array(this.verts.length);
    const vu = new Uint32Array(v.buffer);
    this.verts.forEach((x, i) => { if (i % 8 >= 3) vu[i] = x; else v[i] = x; });
    const i = new Uint32Array(this.idx);
    this.vertexBuffer = device.createBuffer({ size: Math.max(16, v.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.vertexBuffer, 0, v);
    this.indexBuffer = device.createBuffer({ size: Math.max(16, i.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.indexBuffer, 0, i);
    const mr = new Uint32Array(this.morphRow);
    this.morphIndexBuffer = device.createBuffer({ size: Math.max(16, mr.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.morphIndexBuffer, 0, mr);
    const mt = new Float32Array(this.morphTable.length ? this.morphTable : [0, 0, 0, 0]);
    this.morphTableBuffer = device.createBuffer({ size: Math.max(16, mt.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.morphTableBuffer, 0, mt);
    this.dirty = false;
    return true;
  }
}

const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
/** Colours are stored sRGB-encoded (decoded in the shader) so 8 bits keep dark tones. */
export function packSnorm16(a: number, b: number): number {
  const q = (x: number): number => Math.max(-32767, Math.min(32767, Math.round(x * 32767))) & 0xffff;
  return (q(a) | (q(b) << 16)) >>> 0;
}

export function packUnorm16(a: number, b: number): number {
  const q = (x: number): number => Math.max(0, Math.min(65535, Math.round(x * 65535)));
  return (q(a) | (q(b) << 16)) >>> 0;
}

export function packUnorm(v: readonly number[], srgb: boolean): number {
  const q = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
  const e = (x: number, i: number): number => (srgb && i < 3 ? toSrgb(x) : x);
  return (q(e(v[0]!, 0)) | (q(e(v[1]!, 1)) << 8) | (q(e(v[2]!, 2)) << 16) | (q(e(v[3]!, 3)) << 24)) >>> 0;
}

// ---- procedural primitives ------------------------------------------------------------------------

export function box(): Geometry {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [f, u, w] of faces) {
    const base = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      p.push(0.5 * (f[0]! + a * u[0]! + b * w[0]!), 0.5 * (f[1]! + a * u[1]! + b * w[1]!), 0.5 * (f[2]! + a * u[2]! + b * w[2]!));
      n.push(f[0]!, f[1]!, f[2]!);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(idx) };
}

export function sphere(seg: number, rings: number): Geometry {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const ph = (s / seg) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      p.push(x * 0.5, y * 0.5, z * 0.5);
      n.push(x, y, z);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(idx) };
}

/** Cylinder along Y, radius 0.5, height 1, capped. */
export function cylinder(seg: number): Geometry {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    p.push(x * 0.5, -0.5, z * 0.5, x * 0.5, 0.5, z * 0.5);
    n.push(x, 0, z, x, 0, z);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (const y of [-0.5, 0.5]) {
    const c = p.length / 3;
    p.push(0, y, 0); n.push(0, Math.sign(y), 0);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      p.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5); n.push(0, Math.sign(y), 0);
    }
    for (let s = 0; s < seg; s++) {
      if (y > 0) idx.push(c, c + s + 2, c + s + 1);
      else idx.push(c, c + s + 1, c + s + 2);
    }
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(idx) };
}

/** The built-in primitives every scene can use. Mesh ids are stable: box 0, sphere 1, cylinder 2. */
export function standardLibrary(): MeshLibrary {
  const lib = new MeshLibrary();
  lib.add('box', [box()]);
  lib.add('sphere', [sphere(40, 24), sphere(20, 12), sphere(10, 6)], [0.06, 0.015]);
  lib.add('cylinder', [cylinder(32), cylinder(12)], [0.03]);
  return lib;
}

/** THE STUDIO cyclorama: the cove profile swept along the walls and round the back corners. */
export function coveMesh(cove: { radius: number; height: number; corner: number; walls: readonly { a: readonly number[]; b: readonly number[]; n: readonly number[] }[] }, prof: readonly [number, number][]): Geometry {
  // path samples with inward normals: wall, corner arc, wall, corner arc, wall
  const path: { p: number[]; n: number[] }[] = [];
  const walls = cove.walls;
  walls.forEach((w, i) => {
    path.push({ p: [...w.a], n: [...w.n] }, { p: [...w.b], n: [...w.n] });
    const next = walls[i + 1];
    if (!next) return;
    // quarter arc round the corner: centre C = end + n·corner; points C − n(t)·corner as n turns
    const steps = 10;
    const C = [w.b[0]! + w.n[0]! * cove.corner, 0, w.b[2]! + w.n[2]! * cove.corner];
    const a0 = Math.atan2(w.n[2]!, w.n[0]!);
    let da = Math.atan2(next.n[2]!, next.n[0]!) - a0;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    for (let k = 1; k < steps; k++) {
      const ang = a0 + (da * k) / steps;
      const n = [Math.cos(ang), 0, Math.sin(ang)];
      path.push({ p: [C[0]! - n[0]! * cove.corner, 0, C[2]! - n[2]! * cove.corner], n });
    }
  });
  const rows = [...prof, [0, cove.height] as [number, number]];
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const s of path) {
    for (const [d, h] of rows) pos.push(s.p[0]! + s.n[0]! * d, h, s.p[2]! + s.n[2]! * d);
  }
  const R = rows.length;
  // normals from neighbouring samples (smooth over the sweep)
  const P = (i: number, j: number): number[] => pos.slice((i * R + j) * 3, (i * R + j) * 3 + 3);
  for (let i = 0; i < path.length; i++) {
    for (let j = 0; j < R; j++) {
      const a = P(Math.min(i + 1, path.length - 1), j), b = P(Math.max(i - 1, 0), j);
      const c = P(i, Math.min(j + 1, R - 1)), d = P(i, Math.max(j - 1, 0));
      const u = [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!], v = [c[0]! - d[0]!, c[1]! - d[1]!, c[2]! - d[2]!];
      let n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const s = path[i]!.n;
      if (n[0]! * s[0]! + n[1]! + n[2]! * s[2]! < 0) n = n.map((x) => -x);
      const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      nrm.push(n[0]! / l, n[1]! / l, n[2]! / l);
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = (i + 1) * R + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 1, b, a + 1, b + 1, b); // both faces: the set sees the inside
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/** A swept tube surface along a path (parallel-transport frames), one ring of `sides` per point. */
export function sweptTube(path: readonly (readonly number[])[], radius: number, sides = 20): Geometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  let prevN: number[] | null = null;
  const norm = (v: number[]): number[] => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return v.map((x) => x / l); };
  const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!;
    const t = norm([b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]);
    // carry the previous normal along so the rings don't twist through bends
    let n: number[] = prevN ?? (Math.abs(t[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const d = n[0]! * t[0]! + n[1]! * t[1]! + n[2]! * t[2]!;
    n = norm([n[0]! - t[0]! * d, n[1]! - t[1]! * d, n[2]! - t[2]! * d]);
    prevN = n;
    const bn = cross(t, n);
    for (let k = 0; k <= sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const dir = [n[0]! * c + bn[0]! * s, n[1]! * c + bn[1]! * s, n[2]! * c + bn[2]! * s];
      pos.push(path[i]![0]! + dir[0]! * radius, path[i]![1]! + dir[1]! * radius, path[i]![2]! + dir[2]! * radius);
      nrm.push(dir[0]!, dir[1]!, dir[2]!);
    }
  }
  const R = sides + 1;
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * R + k, b = (i + 1) * R + k;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from outside (M2: glass needs true facing)
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}
