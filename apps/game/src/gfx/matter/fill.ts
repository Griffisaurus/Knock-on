// Container fill pass (matter.md "Contents rendering", ASSET_PIPELINE §3.10; M4 contract 3; stream R4).
//
// Stored contents are a quantity (`fill(part)` in keyframes, 0–1), never particles. Each container's closed
// `CAVITY__<name>` mesh is clipped by a WORLD-SPACE level plane, so the contents stay level when the part tilts:
// - the level is solved on the CPU by bisection on the exact volume of the cavity below a horizontal plane
//   (each triangle clipped to the half-space; tetrahedra to a point on the plane, so the cap adds no volume);
//   this replaces the art's 64-entry LUT, which only holds for an upright part (the LUT is still read when present
//   and used for upright parts);
// - the free surface is the plane ∩ cavity cross-section (a CPU-built loop, fanned into rings), displaced by the
//   profile: flat (liquids), crater (granular draining, centre lower) or pile (granular receiving, centre higher);
// - the cavity's walls are drawn front faces only, discarding fragments above the surface.
// Sand and marbles shade like the free Matter (part shader `shade()`, per-grain colour from a 4 mm world lattice,
// packed-sphere relief for marbles); water goes into the screen-space fluid targets (depth + signed thickness) so
// the water composite draws it exactly like free water; `fill` liquids (JITTERJUICE amber) are a glossy colour.
// HOURGLASS draws its sand stream (Ø 1.5 mm) from the neck to the bottom pile while it flows.
//
// Cavity meshes come from the part glb (`CAVITY__*` nodes) when E4a exports them; until then the built-in shapes
// below follow the briefs' dimensions (FISHBOWL / JITTERJUICE: a radial profile measured from their glass shell).

import { parseGlb, type ParsedGlb } from '@knockon/assets';
import { VERTEX_STRIDE } from '../meshes.ts';
import type { Renderer } from '../renderer.ts';
import { MATTER_SHADE_WGSL } from './wgsl.ts';
import { FRAME_WGSL } from '../shaders.ts';
import type { FillItem, FillProfile } from './types.ts';

type V3 = [number, number, number];
type Q = readonly [number, number, number, number];

/** One cavity: local (part-space, engine axes) closed mesh. */
export interface CavityGeo {
  readonly name: string;
  readonly matter: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Optional art LUT: 64 heights (part-local y) by fill fraction 0…1 (upright only). */
  readonly lut?: readonly number[];
  /** The cavity rides this pivot (SPRINKLE CAN): drawn at the item's `pivotPose` when given. */
  readonly pivot?: string;
  firstIndex?: number;
  baseVertex?: number;
}

// ---- geometry helpers -----------------------------------------------------------------------------------

const qrot = (q: Q, v: readonly number[]): V3 => {
  const tx = 2 * (q[1] * v[2]! - q[2] * v[1]!), ty = 2 * (q[2] * v[0]! - q[0] * v[2]!), tz = 2 * (q[0] * v[1]! - q[1] * v[0]!);
  return [v[0]! + q[3] * tx + (q[1] * tz - q[2] * ty), v[1]! + q[3] * ty + (q[2] * tx - q[0] * tz), v[2]! + q[3] * tz + (q[0] * ty - q[1] * tx)];
};

/** A section of a loft: centre (x, z) at height y, half extents rx / rz, square or round. */
interface Section { y: number; rx: number; rz: number; cx?: number; cz?: number }

/** Closed loft through the sections (bottom to top), capped at both ends, outward normals. */
export function loft(sections: readonly Section[], square = false, seg = 32): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const P: number[] = [], I: number[] = [];
  const ring = (s: Section): void => {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      let x = Math.cos(a), z = Math.sin(a);
      if (square) { const m = Math.max(Math.abs(x), Math.abs(z)); x /= m; z /= m; }
      P.push((s.cx ?? 0) + x * s.rx, s.y, (s.cz ?? 0) + z * s.rz);
    }
  };
  sections.forEach(ring);
  for (let j = 0; j + 1 < sections.length; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k, b = j * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
      I.push(a, c, b, b, c, d);
    }
  }
  // caps (fans round the centre of the end rings)
  const cap = (j: number, up: boolean): void => {
    const s = sections[j]!;
    const ci = P.length / 3;
    P.push(s.cx ?? 0, s.y, s.cz ?? 0);
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k, b = j * seg + ((k + 1) % seg);
      if (up) I.push(ci, b, a); else I.push(ci, a, b);
    }
  };
  cap(0, false);
  cap(sections.length - 1, true);
  const positions = new Float32Array(P);
  const indices = new Uint32Array(I);
  // orient outward: the signed volume must be positive
  if (meshVolume(positions, indices, Infinity, null) < 0) for (let t = 0; t < indices.length; t += 3) { const x = indices[t + 1]!; indices[t + 1] = indices[t + 2]!; indices[t + 2] = x; }
  return { positions, normals: vertexNormals(positions, indices), indices };
}

function vertexNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v]! += nx; n[v + 1]! += ny; n[v + 2]! += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1; n[i]! /= l; n[i + 1]! /= l; n[i + 2]! /= l; }
  return n;
}

/**
 * Volume of a closed mesh below the world plane y = L (positions already in world/rel space when `xf` is null,
 * else transformed by it). Each triangle is clipped to y ≤ L and summed as tetrahedra to a point on the plane,
 * so the (implicit) cap contributes nothing.
 */
export function meshVolume(pos: Float32Array, idx: Uint32Array, L: number, xf: ((i: number) => V3) | null): number {
  if (xf) {
    const n = pos.length / 3, w = new Float32Array(pos.length);
    for (let i = 0; i < n; i++) { const p = xf(i); w[i * 3] = p[0]; w[i * 3 + 1] = p[1]; w[i * 3 + 2] = p[2]; }
    pos = w;
  }
  const oy = Number.isFinite(L) ? L : 0;
  const all = !Number.isFinite(L);
  let v = 0;
  // scalar, allocation-free (called ~20× per container per changed frame)
  const tet = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number => {
    ay -= oy; by -= oy; cy -= oy;
    return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  };
  for (let t = 0; t < idx.length; t += 3) {
    let i0 = idx[t]! * 3, i1 = idx[t + 1]! * 3, i2 = idx[t + 2]! * 3;
    const y0 = pos[i0 + 1]!, y1 = pos[i1 + 1]!, y2 = pos[i2 + 1]!;
    const in0 = all || y0 <= L, in1 = all || y1 <= L, in2 = all || y2 <= L;
    const n = (in0 ? 1 : 0) + (in1 ? 1 : 0) + (in2 ? 1 : 0);
    if (n === 0) continue;
    if (n === 3) { v += tet(pos[i0]!, y0, pos[i0 + 2]!, pos[i1]!, y1, pos[i1 + 2]!, pos[i2]!, y2, pos[i2 + 2]!); continue; }
    // rotate (keeping the winding) so the odd vertex is first
    const odd = n === 1 ? (in0 ? 0 : in1 ? 1 : 2) : (!in0 ? 0 : !in1 ? 1 : 2);
    if (odd === 1) { const k = i0; i0 = i1; i1 = i2; i2 = k; } else if (odd === 2) { const k = i2; i2 = i1; i1 = i0; i0 = k; }
    const ax = pos[i0]!, ay = pos[i0 + 1]!, az = pos[i0 + 2]!, bx = pos[i1]!, by = pos[i1 + 1]!, bz = pos[i1 + 2]!, cx = pos[i2]!, cy = pos[i2 + 1]!, cz = pos[i2 + 2]!;
    const sb = (L - ay) / (by - ay), sc = (L - ay) / (cy - ay);
    const abx = ax + (bx - ax) * sb, abz = az + (bz - az) * sb, acx = ax + (cx - ax) * sc, acz = az + (cz - az) * sc;
    if (n === 1) v += tet(ax, ay, az, abx, L, abz, acx, L, acz);
    else { v += tet(abx, L, abz, bx, by, bz, cx, cy, cz); v += tet(abx, L, abz, cx, cy, cz, acx, L, acz); }
  }
  return v / 6;
}

/** Plane ∩ mesh: the cross-section's boundary points (unordered segment ends), world/rel space. */
function crossSection(world: Float32Array, idx: Uint32Array, L: number): V3[] {
  const out: V3[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]! * 3, b = idx[t + ((e + 1) % 3)]! * 3;
      const ay = world[a + 1]!, by = world[b + 1]!;
      if ((ay <= L) === (by <= L)) continue;
      // each crossing edge is shared by two triangles: keep it once (from the lower-index end)
      if (a > b) continue;
      const s = (L - ay) / (by - ay);
      out.push([world[a]! + (world[b]! - world[a]!) * s, L, world[a + 2]! + (world[b + 2]! - world[a + 2]!) * s]);
    }
  }
  return out;
}

// ---- built-in cavities (briefs' dimensions, engine Y-up; Blender z → engine y) ----------------------------

const INSET = 0.004;
const bulb = (y0: number, y1: number, r: number, neckAtTop: boolean): Section[] => {
  const S: Section[] = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    // a bulb: round at the wide end, pinched to the neck at one end
    const shape = Math.sin(Math.PI * (neckAtTop ? 0.5 + 0.5 * u : 0.5 * u) + (neckAtTop ? 0 : 0));
    const prof = neckAtTop ? Math.sin(Math.PI * Math.min(1, u * 1.0)) : Math.sin(Math.PI * u);
    void shape;
    S.push({ y: y0 + (y1 - y0) * u, rx: Math.max(0.0025, r * prof), rz: Math.max(0.0025, r * prof) });
  }
  return S;
};

export function builtinCavities(type: string): Omit<CavityGeo, 'firstIndex' | 'baseVertex'>[] {
  switch (type) {
    case 'grit_hopper': {
      const h = 0.14 - INSET;
      return [{ name: 'sand', matter: 'sand', ...loft([{ y: 0.124, rx: 0.021, rz: 0.021 }, { y: 0.2, rx: h, rz: h }, { y: 0.381, rx: h, rz: h }], true, 32) }];
    }
    case 'hourglass': {
      const r = 0.0375 - INSET;
      return [
        { name: 'bottom', matter: 'sand', ...loft(bulb(0.026, 0.0985, r, true)) },
        { name: 'top', matter: 'sand', ...loft(bulb(0.1015, 0.174, r, false)) },
      ];
    }
    case 'tank': {
      const r = 0.126 - INSET;
      return [{ name: 'water', matter: 'water', ...loft([{ y: 0.058, rx: r, rz: r }, { y: 0.366, rx: r, rz: r }], false, 48) }];
    }
    case 'sprinkle_can': {
      const s = { cx: -0.06, rx: 0.08 - INSET, rz: 0.07 - INSET };
      return [{ name: 'water', matter: 'water', ...loft([{ y: 0.029, ...s }, { y: 0.141, ...s }], false, 40) }];
    }
    case 'goo_vat': {
      // X5 (M5): matter.md CAVITY__goo, the vat's inset cylinder (the art's own cavity mesh wins when it loads)
      const r = 0.1225;
      return [{ name: 'goo', matter: 'goo', ...loft([{ y: 0.0635, rx: r, rz: r }, { y: 0.2565, rx: r, rz: r }], false, 48) }];
    }
    case 'marble_hopper': {
      const R = 0.13 - INSET, cy = 0.27, S: Section[] = [];
      for (let y = 0.152; y <= cy + R - 0.002; y += 0.01) { const rr = Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)); S.push({ y, rx: rr, rz: rr }); }
      return [{ name: 'marbles', matter: 'marble', ...loft(S, false, 40) }];
    }
    default: return [];
  }
}

/** The art's cavity record (E4a: `.art.json → cavities`): fill LUT (64 heights by fill fraction), volume (L), bounds. */
interface ArtCav { name: string; matter: string; lut?: number[]; volume?: number; min?: number[]; max?: number[]; mesh?: { vertices: number[]; indices: number[] }; pivot?: string }

/** E4a's exported cavity mesh (`.art.json → cavities[].mesh`, part space, engine axes). */
export function cavityFromArtMesh(c: ArtCav): Omit<CavityGeo, 'firstIndex' | 'baseVertex'> | null {
  if (!c.mesh || c.mesh.vertices.length < 12 || c.mesh.indices.length < 12) return null;
  const positions = new Float32Array(c.mesh.vertices);
  const indices = new Uint32Array(c.mesh.indices);
  if (meshVolume(positions, indices, Infinity, null) < 0) for (let t = 0; t < indices.length; t += 3) { const x = indices[t + 1]!; indices[t + 1] = indices[t + 2]!; indices[t + 2] = x; }
  return { name: c.name, matter: c.matter === 'fill' ? 'liquid' : c.matter, positions, normals: vertexNormals(positions, indices), indices, ...(c.lut ? { lut: c.lut } : {}), ...(c.pivot ? { pivot: c.pivot } : {}) };
}

/** Parts whose cavities are square in plan (the rest are round or elliptical). */
const SQUARE = new Set(['grit_hopper']);

/**
 * A cavity rebuilt from the art's fill LUT: the cross-section area at each height is dV/dh (so the volume matches the
 * art's exactly), as an ellipse (or a square) with the bounds' aspect, centred on the bounds. Used while the glb has
 * no `CAVITY__` mesh (E4a exports the LUT and bounds, not the mesh).
 */
export function cavityFromLut(c: ArtCav, square: boolean): Omit<CavityGeo, 'firstIndex' | 'baseVertex'> | null {
  const lut = c.lut, min = c.min, max = c.max;
  if (!lut || lut.length < 4 || !min || !max || !(c.volume! > 0)) return null;
  const V = c.volume! / 1000; // litres → m³
  const cx = (min[0]! + max[0]!) / 2, cz = (min[2]! + max[2]!) / 2;
  const ex = (max[0]! - min[0]!) / 2, ez = (max[2]! - min[2]!) / 2;
  const n = lut.length - 1;
  const S: Section[] = [];
  const area = (i: number): number => {
    const dh = Math.max(1e-5, lut[Math.min(n, i + 1)]! - lut[Math.max(0, i)]!);
    return (V / n) / dh;
  };
  for (let i = 0; i <= n; i += 4) {
    const a = (area(Math.max(0, i - 1)) + area(Math.min(n - 1, i))) / 2;
    // ellipse area π·rx·rz with rx/rz = ex/ez; square side² = 4·hx·hz
    const k = square ? Math.sqrt(a / (4 * ex * ez)) : Math.sqrt(a / (Math.PI * ex * ez));
    const f = Math.min(1, k);
    S.push({ y: lut[i]!, rx: Math.max(0.002, ex * f), rz: Math.max(0.002, ez * f), cx, cz });
  }
  if (S[S.length - 1]!.y < max[1]! - 1e-4) S.push({ ...S[S.length - 1]!, y: max[1]! });
  return { name: c.name, matter: c.matter === 'fill' ? 'liquid' : c.matter, ...loft(S, square, square ? 24 : 32), lut };
}

/** Radial cavity measured from a glass shell (inner radius per height, inset), for M2/M3 containers without art cavities. */
function radialFromGlass(glb: ParsedGlb, name: string, matter: string, topFrac = 0.82): Omit<CavityGeo, 'firstIndex' | 'baseVertex'> | null {
  const pts: number[] = [];
  for (const m of glb.meshes) {
    if (m.lod > 0) continue;
    for (const p of m.primitives) {
      const mt = glb.materials[p.material]?.name ?? '';
      if (!/^kn_(glass|poly_)/.test(mt)) continue;
      for (let i = 0; i < p.positions.length; i += 3) {
        const v = [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!];
        const M = m.matrix;
        pts.push(M[0]! * v[0]! + M[4]! * v[1]! + M[8]! * v[2]! + M[12]!, M[1]! * v[0]! + M[5]! * v[1]! + M[9]! * v[2]! + M[13]!, M[2]! * v[0]! + M[6]! * v[1]! + M[10]! * v[2]! + M[14]!);
      }
    }
  }
  if (pts.length < 30) return null;
  let y0 = Infinity, y1 = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i += 3) { y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!); cx += pts[i]!; cz += pts[i + 2]!; }
  cx /= pts.length / 3; cz /= pts.length / 3;
  const bins = 16, rIn = new Array<number>(bins).fill(Infinity), rOut = new Array<number>(bins).fill(0);
  for (let i = 0; i < pts.length; i += 3) {
    const b = Math.min(bins - 1, Math.floor(((pts[i + 1]! - y0) / (y1 - y0)) * bins));
    const r = Math.hypot(pts[i]! - cx, pts[i + 2]! - cz);
    rIn[b] = Math.min(rIn[b]!, r); rOut[b] = Math.max(rOut[b]!, r);
  }
  const S: Section[] = [];
  const top = y0 + (y1 - y0) * topFrac;
  for (let b = 0; b < bins; b++) {
    const y = y0 + ((b + 0.5) / bins) * (y1 - y0);
    if (y > top) break;
    // a thin shell's inner radius ≈ its outer radius − wall: use the outer one less the wall and inset
    const r = Math.max(0.004, (Number.isFinite(rIn[b]!) && rOut[b]! - rIn[b]! < 0.012 ? rIn[b]! : rOut[b]! - 0.004) - INSET);
    S.push({ y: b === 0 ? y0 + INSET : y, rx: r, rz: r, cx, cz });
  }
  if (S.length < 2) return null;
  return { name, matter, ...loft(S, false, 40) };
}

// ---- WGSL --------------------------------------------------------------------------------------------------

const FILL_WGSL = /* wgsl */ `
struct FillInst {
  pos: vec4f,   // part position (camera-relative), w = level plane (camera-relative y)
  rot: vec4f,   // part rotation
  prof: vec4f,  // xy = profile centre (camera-relative x, z), z = radius, w = signed depth (+ pile, − crater)
  misc: vec4u,  // x contents (0 sand, 1 water, 2 marble, 3 liquid colour), y variant, z flags (1 no clip), w seed
  color: vec4f, // liquid colour (linear), w emissive
};
@group(1) @binding(6) var<storage, read> fills: array<FillInst>;

struct FOut {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) id: u32,
};

fn fSurf(f: FillInst, xz: vec2f) -> f32 {
  let d = length(xz - f.prof.xy);
  return f.pos.w + f.prof.w * max(0.0, 1.0 - d / max(f.prof.z, 1e-4));
}
fn fSurfN(f: FillInst, xz: vec2f) -> vec3f {
  let v = xz - f.prof.xy;
  let d = length(v);
  if (d >= f.prof.z || d < 1e-5) { return vec3f(0.0, 1.0, 0.0); }
  let g = -f.prof.w / f.prof.z * v / d;
  return normalize(vec3f(-g.x, 1.0, -g.y));
}
fn fClipped(f: FillInst, p: vec3f) -> bool { return (f.misc.z & 1u) == 0u && p.y > fSurf(f, p.xz); }

fn fillVert(p: vec3f, n: vec4f, ii: u32) -> FOut {
  let f = fills[ii];
  var lp = p;
  // the HOURGLASS stream: a unit cylinder scaled to its radius (prof.x) and length (prof.y)
  if ((f.misc.z & 2u) != 0u) { lp = vec3f(p.x * f.prof.x, p.y * f.prof.y, p.z * f.prof.x); }
  var o: FOut;
  o.rel = f.pos.xyz + qrot(f.rot, lp);
  o.n = qrot(f.rot, n.xyz);
  o.clip = frame.viewProj * vec4f(o.rel, 1.0);
  o.id = ii;
  return o;
}
/// Free-surface vertices are already camera-relative (CPU-built), displaced by the profile here.
fn fillSurfVert(p: vec3f, n: vec4f, ii: u32) -> FOut {
  let f = fills[ii];
  var o: FOut;
  o.rel = vec3f(p.x, fSurf(f, p.xz), p.z);
  o.n = fSurfN(f, p.xz);
  o.clip = frame.viewProj * vec4f(o.rel, 1.0);
  o.id = ii;
  return o;
}
@vertex fn vs_fill(@location(0) p: vec3f, @location(1) n: vec4f, @builtin(instance_index) ii: u32) -> FOut { return fillVert(p, n, ii); }
@vertex fn vs_fill_surf(@location(0) p: vec3f, @location(1) n: vec4f, @builtin(instance_index) ii: u32) -> FOut { return fillSurfVert(p, n, ii); }
@vertex fn vs_fill_shadow(@location(0) p: vec3f, @location(1) n: vec4f, @builtin(instance_index) ii: u32) -> FOut {
  var o = fillVert(p, n, ii);
  o.clip = frame.shadowMat * vec4f(o.rel, 1.0);
  return o;
}
@vertex fn vs_fill_surf_shadow(@location(0) p: vec3f, @location(1) n: vec4f, @builtin(instance_index) ii: u32) -> FOut {
  var o = fillSurfVert(p, n, ii);
  o.clip = frame.shadowMat * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs_fill_clip(i: FOut) {
  if (fClipped(fills[i.id], i.rel)) { discard; }
}
`;

const FILL_SHADE_WGSL = /* wgsl */ `
fn fHash3(c: vec3i) -> vec3f {
  let s = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u);
  return vec3f(mHash(s), mHash(s ^ 0x68e3u), mHash(s ^ 0xb5a1u));
}

/// Contents surface: sand speckle on a 4 mm world lattice, packed marbles on a 16 mm lattice, or a liquid colour.
fn fShade(f: FillInst, rel: vec3f, n0: vec3f) -> vec3f {
  let wp = rel + frame.eye.xyz;
  let kind = f.misc.x;
  if (kind == 2u) {
    let q = wp / 0.016;
    let c = floor(q);
    let l = q - c - 0.5;
    let h = fHash3(vec3i(c));
    let rr = length(l);
    var n = normalize(mix(n0, l / max(rr, 1e-4), 0.75 * (1.0 - smoothstep(0.42, 0.5, rr))));
    let variant = select(f.misc.y, 1u, f.misc.y == 2u && h.y < 0.3);
    let gm = mGrainMat(2u, variant, u32(h.x * 4095.0));
    let gap = smoothstep(0.38, 0.52, rr);
    return shade(rel, n, gm.albedo * (1.0 - 0.7 * gap), gm.rough + gap * 0.5, gm.metal * (1.0 - gap), n0) * (1.0 - 0.55 * gap);
  }
  if (kind == 3u) {
    return shade(rel, n0, f.color.rgb, 0.08, 0.0, n0) + f.color.rgb * f.color.w;
  }
  if (kind == 4u) {
    // goo (X5, M5): glossy kn_slime with a subsurface glow (light wrapped round and the room's light let back out)
    let wrap = clamp((dot(n0, frame.key.xyz) + 0.6) / 1.6, 0.0, 1.0);
    let sss = f.color.rgb * (frame.keyColor.rgb * frame.key.w * wrap * 0.25 + skyColor(n0) * 0.3) * mu.goo.z;
    return shade(rel, n0, f.color.rgb, 0.16, 0.0, n0) + sss;
  }
  // grains fade into their mean colour once a grain is under ~2 px (no salt-and-pepper shimmer at distance)
  let px = length(rel) / mu.px.x;
  let k = clamp(0.0039 / max(px, 1e-6) * 0.5 - 0.5, 0.0, 1.0);
  let q = wp / 0.0039;
  let c = vec3i(floor(q));
  let h = mix(vec3f(0.5), fHash3(c), k);
  // each 3.9 mm cell is a round grain: a bump normal toward the cell centre and a darker gap between grains
  let l = fract(q) - 0.5 + (h - 0.5) * 0.2;
  let rr = length(l);
  let n = normalize(mix(n0, l / max(rr, 1e-4), 0.45 * k) + (h - 0.5) * 0.25 * k);
  let gap = smoothstep(0.38, 0.55, rr) * k;
  let gm = mGrainMat(0u, 0u, select(0u, u32(h.x * 4095.0) ^ u32(h.z * 65535.0), k > 0.5));
  let albedo = mix(mu.sand.rgb, gm.albedo, k * 0.6) * (1.0 - 0.3 * gap);
  return shade(rel, n, albedo, gm.rough, 0.0, n0) * (1.0 - 0.25 * gap);
}

@fragment fn fs_fill(i: FOut) -> @location(0) vec4f {
  let f = fills[i.id];
  if (fClipped(f, i.rel)) { discard; }
  return vec4f(xrayDim(fShade(f, i.rel, normalize(i.n))), cutCoverage(i.rel));
}
@fragment fn fs_fill_surf(i: FOut) -> @location(0) vec4f {
  let f = fills[i.id];
  return vec4f(xrayDim(fShade(f, i.rel, normalize(i.n))), cutCoverage(i.rel));
}
`;

/** Shadow casters: the part bind group holds the shadow map itself, so these use a frame-only group 0. */
const FILL_SHADOW_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
${FILL_WGSL}
`;

/** Water contents into the screen-space fluid targets: depth (nearest) and signed linear thickness (+back, −front). */
const FILL_WATER_WGSL = /* wgsl */ `
@group(1) @binding(7) var fillSceneDepth: texture_depth_multisampled_2d;
fn fSceneZ(frag: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(fillSceneDepth));
  return textureLoad(fillSceneDepth, vec2i(clamp(frag / mu.water2.z, vec2f(0.0), dims - 1.0)), 0);
}
@fragment fn fs_fill_wdepth(i: FOut) {
  if (fClipped(fills[i.id], i.rel)) { discard; }
  if (i.clip.z >= fSceneZ(i.clip.xy)) { discard; }
}
@fragment fn fs_fill_wsurf_depth(i: FOut) {
  if (i.clip.z >= fSceneZ(i.clip.xy)) { discard; }
}
fn fLin(rel: vec3f) -> f32 { return -(frame.view * vec4f(rel, 1.0)).z; }
@fragment fn fs_fill_wthick(i: FOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  if (fClipped(fills[i.id], i.rel)) { discard; }
  // thickness target pixels → full-resolution scene depth pixels
  let full = i.clip.xy * 2.0 / mu.water2.z;
  let dims = vec2f(textureDimensions(fillSceneDepth));
  let s = textureLoad(fillSceneDepth, vec2i(clamp(full, vec2f(0.0), dims - 1.0)), 0);
  var z = fLin(i.rel);
  if (i.clip.z >= s) {
    // the wall is behind the opaque scene: the water ends at the scene
    if (ff) { discard; }
    let ndc = vec2f(full.x / dims.x * 2.0 - 1.0, 1.0 - full.y / dims.y * 2.0);
    let w = frame.invViewProj * vec4f(ndc, s, 1.0);
    z = fLin(w.xyz / w.w);
  }
  return vec4f(select(z, -z, ff), 0.0, 0.0, 0.0);
}
@fragment fn fs_fill_wsurf_thick(i: FOut) -> @location(0) vec4f {
  if (i.clip.z >= fSceneZ(i.clip.xy * 2.0)) { discard; }
  return vec4f(-fLin(i.rel), 0.0, 0.0, 0.0);
}
`;

// ---- the pass ------------------------------------------------------------------------------------------

const FILL_BYTES = 80;
/** Contents kinds in the fill shader: 0 sand, 1 water, 2 marbles, 3 a `fill` liquid colour, 4 goo (X5, M5: kn_slime). */
const KIND_OF: Record<string, number> = { sand: 0, water: 1, marble: 2, marbles: 2, goo: 4 };
/** `fill` liquids by part type (linear colour, emissive): JITTERJUICE glows amber (kn_poly_amber); goo is kn_slime #7DFF7A. */
const LIQUID: Record<string, [number, number, number, number]> = { jitterjuice: [1.0, 0.42, 0.04, 0.35], goo_vat: [0.205, 1.0, 0.195, 0] };
/** Contents shown in build mode when the sim doesn't say (`fill` has no keyframe yet): matter.md "full" states. */
export const DEFAULT_FILL: Record<string, number> = { grit_hopper: 0.85, hourglass: 1, tank: 0.8, sprinkle_can: 0.7, marble_hopper: 0.8, fishbowl: 0.82, jitterjuice: 0.75, goo_vat: 0.85 };

interface Draw { cav: CavityGeo; inst: number; surfFirst: number; surfCount: number; water: boolean }

export class FillPass {
  /** True when this frame has water contents (the fluid passes run for them). */
  hasWater = false;
  /** True when there are containers to draw this frame. */
  get any(): boolean { return this.items.length > 0; }
  private readonly r: Renderer;
  private readonly d: GPUDevice;
  private readonly partCode: string;
  private items: readonly FillItem[] = [];
  private readonly cavities = new Map<string, CavityGeo[] | 'loading'>();
  private geoDirty = false;
  private vbuf: GPUBuffer | null = null;
  private ibuf: GPUBuffer | null = null;
  private sbuf: GPUBuffer | null = null;
  private sbufCap = 0;
  private fbuf: GPUBuffer | null = null;
  private fbufCap = 0;
  private draws: Draw[] = [];
  private readonly layout: GPUBindGroupLayout;
  private readonly waterLayout: GPUBindGroupLayout;
  private bind: GPUBindGroup | null = null;
  private waterBind: GPUBindGroup | null = null;
  private waterDepthTex: GPUTexture | null = null;
  private pipes: Record<'wall' | 'surf' | 'wallShadow' | 'surfShadow' | 'wallPre' | 'surfPre' | 'wDepth' | 'wSurfDepth' | 'wThick' | 'wSurfThick', GPURenderPipeline> | null = null;
  private building = false;
  private off = false;
  private readonly tables = new Map<string, { v: Float64Array; total: number; y0: number; y1: number }>();
  private mu: GPUBuffer | null = null;
  private shadowFrameLayout: GPUBindGroupLayout | null = null;
  private shadowGroup: GPUBindGroup | null = null;

  /** `prev`: the pass from before a device-loss recovery; its CPU data (cavities, items, level tables) carries over. */
  constructor(r: Renderer, partCode: string, prev?: FillPass) {
    this.r = r;
    this.d = r.device;
    this.partCode = partCode;
    if (prev) {
      for (const [k, v] of prev.cavities) if (v !== 'loading') this.cavities.set(k, v.map((c) => { const { firstIndex: _f, baseVertex: _b, ...geo } = c; return geo; }));
      this.items = prev.items;
      this.geoDirty = true;
    }
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.layout = this.d.createBindGroupLayout({
      label: 'matter.fill',
      entries: [{ binding: 3, visibility: V | F, buffer: { type: 'uniform' } }, { binding: 6, visibility: V | F, buffer: { type: 'read-only-storage' } }],
    });
    this.waterLayout = this.d.createBindGroupLayout({
      label: 'matter.fill.water',
      entries: [
        { binding: 3, visibility: V | F, buffer: { type: 'uniform' } }, { binding: 6, visibility: V | F, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: F, texture: { sampleType: 'depth', multisampled: true } },
      ],
    });
  }

  /** The Matter uniform (index.ts) for the shared shading constants. */
  useUniform(mu: GPUBuffer): void { if (this.mu !== mu) { this.mu = mu; this.bind = this.waterBind = null; } }

  set(items: readonly FillItem[]): void {
    if (this.off) return;
    this.items = items;
    for (const it of items) if (!this.cavities.has(it.type)) void this.load(it.type);
  }

  /** Registers cavities for a type directly (tests, the dev page, or art loaded elsewhere). */
  define(type: string, cavs: Omit<CavityGeo, 'firstIndex' | 'baseVertex'>[]): void {
    this.cavities.set(type, cavs.map((c) => ({ ...c })));
    this.geoDirty = true;
  }

  private async load(type: string): Promise<void> {
    this.cavities.set(type, 'loading');
    let cavs: Omit<CavityGeo, 'firstIndex' | 'baseVertex'>[] = [];
    try {
      const [gr, ar] = await Promise.all([fetch(`/parts/${type}/${type}.glb`), fetch(`/parts/${type}/${type}.art.json`)]);
      const art = ar.ok ? await ar.json() as { cavities?: ArtCav[] } : {};
      const glb = gr.ok ? parseGlb(await gr.arrayBuffer()) : null;
      if (glb) cavs = cavitiesFromGlb(glb, art.cavities ?? []);
      if (!cavs.length) cavs = (art.cavities ?? []).map((c) => cavityFromArtMesh(c)).filter((c): c is NonNullable<typeof c> => c !== null);
      if (!cavs.length) cavs = (art.cavities ?? []).map((c) => cavityFromLut(c, SQUARE.has(type))).filter((c): c is NonNullable<typeof c> => c !== null);
      if (!cavs.length) cavs = builtinCavities(type);
      if (!cavs.length && glb) {
        const c = art.cavities?.[0];
        const g = c ? radialFromGlass(glb, c.name, c.matter === 'fill' ? 'liquid' : c.matter) : null;
        if (g) cavs = [g];
      }
    } catch {
      cavs = builtinCavities(type);
    }
    this.define(type, cavs);
  }

  private upload(): void {
    this.geoDirty = false;
    const all: CavityGeo[] = [];
    for (const v of this.cavities.values()) if (v !== 'loading') all.push(...v);
    let nv = 0, ni = 0;
    for (const c of all) { nv += c.positions.length / 3; ni += c.indices.length; }
    const V = new Float32Array(Math.max(1, nv) * 8), I = new Uint32Array(Math.max(1, ni));
    let bv = 0, fi = 0;
    for (const c of all) {
      const n = c.positions.length / 3;
      for (let i = 0; i < n; i++) {
        V.set([c.positions[i * 3]!, c.positions[i * 3 + 1]!, c.positions[i * 3 + 2]!, c.normals[i * 3]!, c.normals[i * 3 + 1]!, c.normals[i * 3 + 2]!, 0, 0], (bv + i) * 8);
      }
      I.set(c.indices, fi);
      c.baseVertex = bv; c.firstIndex = fi;
      bv += n; fi += c.indices.length;
    }
    this.vbuf?.destroy(); this.ibuf?.destroy();
    this.vbuf = this.d.createBuffer({ label: 'matter.fill.v', size: V.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.ibuf = this.d.createBuffer({ label: 'matter.fill.i', size: I.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.d.queue.writeBuffer(this.vbuf, 0, V);
    this.d.queue.writeBuffer(this.ibuf, 0, I);
  }

  /** Per frame (before the shadow pass): levels, free surfaces and instance data for this frame's items. */
  frame(): void {
    this.draws = [];
    this.hasWater = false;
    if (!this.items.length) return;
    if (this.geoDirty) this.upload();
    const eye = this.r.eye;
    const insts: number[] = [];
    const surf: number[] = [];
    for (const it of this.items) {
      const cavs = this.cavities.get(it.type);
      if (!cavs || cavs === 'loading' || !cavs.length || !this.vbuf) continue;
      const rel: V3 = [it.pos[0] - eye[0], it.pos[1] - eye[1], it.pos[2] - eye[2]];
      const hour = it.type === 'hourglass';
      let pileTop = rel[1] + 0.03;
      for (const cav of cavs) {
        if (cav.firstIndex === undefined) continue;
        const pose = cav.pivot && it.pivotPose ? it.pivotPose : it;
        const prel: V3 = [pose.pos[0] - eye[0], pose.pos[1] - eye[1], pose.pos[2] - eye[2]];
        const matter = it.matter ?? cav.matter;
        // HOURGLASS: `fill` is the share in CAVITY__top; the rest sits in CAVITY__bottom
        const f = Math.max(0, Math.min(1, hour ? (cav.name === 'top' ? it.fill : 1 - it.fill) : it.fill));
        if (f <= 0.002) continue;
        const n = cav.positions.length / 3;
        const world = new Float32Array(n * 3);
        let y0 = Infinity, y1 = -Infinity, cx = 0, cz = 0;
        for (let i = 0; i < n; i++) {
          const w = qrot(pose.rot, [cav.positions[i * 3]!, cav.positions[i * 3 + 1]!, cav.positions[i * 3 + 2]!]);
          world[i * 3] = w[0] + prel[0]; world[i * 3 + 1] = w[1] + prel[1]; world[i * 3 + 2] = w[2] + prel[2];
          y0 = Math.min(y0, world[i * 3 + 1]!); y1 = Math.max(y1, world[i * 3 + 1]!);
          cx += world[i * 3]!; cz += world[i * 3 + 2]!;
        }
        cx /= n; cz /= n;
        const L = this.level(`${it.type}:${cav.name}:${pose.rot.map((x) => x.toFixed(3)).join(',')}`, cav, world, f, y0, y1, pose.pos[1] - eye[1]);
        // the cross-section and the profile
        const pts = crossSection(world, cav.indices, L);
        let R = 0;
        let sx = 0, sz = 0;
        for (const p of pts) { sx += p[0]; sz += p[2]; }
        if (pts.length) { sx /= pts.length; sz /= pts.length; } else { sx = cx; sz = cz; }
        for (const p of pts) R = Math.max(R, Math.hypot(p[0] - sx, p[2] - sz));
        // HOURGLASS: the top bulb craters and the bottom one piles while the sand runs
        const prof: FillProfile = hour ? (it.flowing ? (cav.name === 'top' ? 'crater' : 'pile') : 'flat') : it.profile ?? 'flat';
        const depth = prof === 'flat' ? 0 : prof === 'crater' ? -Math.min(0.35 * R, (L - y0) * 0.8) : Math.min(0.3 * R, (y1 - L) * 0.8);
        const instIdx = insts.length / (FILL_BYTES / 4);
        const kind = KIND_OF[matter] ?? 3;
        const liq = LIQUID[it.type] ?? [0.3, 0.75, 0.25, 0];
        insts.push(prel[0], prel[1], prel[2], L, pose.rot[0], pose.rot[1], pose.rot[2], pose.rot[3], sx, sz, Math.max(R, 1e-3), depth, kind, matter === 'marble' ? 2 : 0, 0, 0, ...liq);
        // free surface: rings from the centre to the boundary (sorted by angle round the centroid)
        const sf = surf.length / 8;
        if (pts.length >= 3 && f < 0.999) {
          const ring = pts.map((p) => ({ p, a: Math.atan2(p[2] - sz, p[0] - sx) })).sort((a, b) => a.a - b.a).map((x) => x.p);
          const rings = 5;
          for (let k = 0; k < ring.length; k++) {
            const a = ring[k]!, b = ring[(k + 1) % ring.length]!;
            for (let j = 0; j < rings; j++) {
              const s0 = j / rings, s1 = (j + 1) / rings;
              const P = (p: V3, s: number): number[] => [sx + (p[0] - sx) * s, L, sz + (p[2] - sz) * s, 0, 1, 0, 0, 0];
              surf.push(...P(a, s0), ...P(a, s1), ...P(b, s1));
              if (j > 0) surf.push(...P(a, s0), ...P(b, s1), ...P(b, s0));
            }
          }
        }
        if (cav.name === 'bottom') pileTop = L + Math.max(0, depth);
        const water = kind === 1;
        if (water) this.hasWater = true;
        this.draws.push({ cav, inst: instIdx, surfFirst: sf, surfCount: surf.length / 8 - sf, water });
      }
      // HOURGLASS stream (Ø 1.5 mm) from the neck to the bottom pile while it flows
      if (hour && it.flowing && it.fill > 0.002 && it.fill < 0.998) {
        const neck = qrot(it.rot, [0, 0.1, 0]);
        const up = qrot(it.rot, [0, 1, 0]);
        if (up[1] > 0.34) { // paused between 70° and 110° tilt (and flipped beyond: the sim swaps roles)
          const top = rel[1] + neck[1];
          const len = Math.max(0.002, top - pileTop);
          this.stream(insts, surf, [rel[0] + neck[0], top, rel[2] + neck[2]], len);
        }
      }
    }
    if (!this.draws.length) return;
    // instances
    const fdata = new Float32Array(insts);
    const u = new Uint32Array(fdata.buffer);
    for (let k = 0; k < fdata.length / 20; k++) for (let w = 12; w < 16; w++) u[k * 20 + w] = insts[k * 20 + w]!;
    if (!this.fbuf || fdata.byteLength > this.fbufCap) {
      this.fbuf?.destroy();
      this.fbufCap = Math.max(4096, fdata.byteLength * 2);
      this.fbuf = this.d.createBuffer({ label: 'matter.fill.inst', size: this.fbufCap, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.bind = this.waterBind = null;
    }
    this.d.queue.writeBuffer(this.fbuf, 0, fdata);
    const sdata = new Float32Array(surf.length ? surf : [0, 0, 0, 0, 0, 0, 0, 0]);
    if (!this.sbuf || sdata.byteLength > this.sbufCap) {
      this.sbuf?.destroy();
      this.sbufCap = Math.max(1 << 16, sdata.byteLength * 2);
      this.sbuf = this.d.createBuffer({ label: 'matter.fill.surf', size: this.sbufCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    this.d.queue.writeBuffer(this.sbuf, 0, sdata);
  }

  /** A thin vertical sand stream as a no-clip box instance (drawn with the cavity pipelines through a unit box cavity). */
  private stream(insts: number[], _surf: number[], topRel: V3, len: number): void {
    const key = '__stream';
    if (!this.cavities.has(key)) { this.define(key, [{ name: 'stream', matter: 'sand', ...loft([{ y: 0, rx: 1, rz: 1 }, { y: 1, rx: 1, rz: 1 }], false, 8) }]); return; }
    const cav = this.cavities.get(key);
    if (!cav || cav === 'loading' || cav[0]!.firstIndex === undefined) return;
    const idx = insts.length / 20;
    // radius and length in prof (flags: 1 no clip, 2 scaled unit cylinder)
    insts.push(topRel[0], topRel[1] - len, topRel[2], 1e9, 0, 0, 0, 1, 0.00075, len, 1, 0, 0, 0, 1 | 2, 0, 0, 0, 0, 0);
    this.draws.push({ cav: cav[0]!, inst: idx, surfFirst: 0, surfCount: 0, water: false });
  }

  /**
   * World level (camera-relative y) holding `f` of the cavity's volume. Per orientation the cavity's volume-by-height
   * table (33 heights) is cached; a fill change then costs a table lookup and 6 refining bisection steps.
   */
  private level(key: string, cav: CavityGeo, world: Float32Array, f: number, y0: number, y1: number, baseY: number): number {
    let tab = this.tables.get(key);
    if (!tab) {
      const total = meshVolume(world, cav.indices, Infinity, null);
      const v = new Float64Array(33);
      for (let i = 0; i <= 32; i++) v[i] = i === 0 ? 0 : i === 32 ? total : meshVolume(world, cav.indices, y0 + ((y1 - y0) * i) / 32, null);
      tab = { v, total, y0: y0 - baseY, y1: y1 - baseY };
      if (this.tables.size > 2048) this.tables.clear();
      this.tables.set(key, tab);
    }
    const want = f * tab.total;
    let i = 0;
    while (i < 31 && tab.v[i + 1]! < want) i++;
    const ya = tab.y0 + ((tab.y1 - tab.y0) * i) / 32 + baseY, yb = tab.y0 + ((tab.y1 - tab.y0) * (i + 1)) / 32 + baseY;
    let lo = ya, hi = yb;
    for (let k = 0; k < 6; k++) {
      const m = (lo + hi) / 2;
      if (meshVolume(world, cav.indices, m, null) < want) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  // ---- draws ---------------------------------------------------------------------------------------------

  /** Pipelines, built asynchronously on first use (null until ready; a failure turns the fill pass off). */
  private ensure(): NonNullable<FillPass['pipes']> | null {
    if (this.pipes) return this.pipes;
    if (this.building) return null;
    this.building = true;
    const d = this.d;
    const mt = this.r.matterTargets();
    const mod = d.createShaderModule({ label: 'matter.fill', code: `${this.partCode}\n${MATTER_SHADE_WGSL}\n${FILL_WGSL}\n${FILL_SHADE_WGSL}\n${FILL_WATER_WGSL}` });
    const pl = d.createPipelineLayout({ bindGroupLayouts: [mt.partLayout, this.layout, mt.lookLayout, mt.giLayout] });
    const shadowMod = d.createShaderModule({ label: 'matter.fill.shadow', code: FILL_SHADOW_WGSL });
    this.shadowFrameLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const spl = d.createPipelineLayout({ bindGroupLayouts: [this.shadowFrameLayout, this.layout] });
    const wpl = d.createPipelineLayout({ bindGroupLayouts: [mt.partLayout, this.waterLayout, mt.lookLayout, mt.giLayout] });
    const vb: GPUVertexBufferLayout[] = [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x4' }] }];
    const msaa = { count: 4, alphaToCoverageEnabled: true };
    const depth24: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const depth32 = (bias: boolean): GPUDepthStencilState => ({ format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', ...(bias ? { depthBias: 2, depthBiasSlopeScale: 2 } : {}) });
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const mk = (label: string, layout: GPUPipelineLayout, vs: string, fs: string, cull: GPUCullMode, ds: GPUDepthStencilState | undefined, targets: GPUColorTargetState[], ms?: GPUMultisampleState, m = mod): Promise<GPURenderPipeline> => d.createRenderPipelineAsync({
      label: `matter.fill.${label}`, layout,
      vertex: { module: m, entryPoint: vs, buffers: vb },
      fragment: { module: m, entryPoint: fs, targets },
      primitive: { topology: 'triangle-list', cullMode: cull, frontFace: 'ccw' },
      ...(ds ? { depthStencil: ds } : {}),
      ...(ms ? { multisample: ms } : {}),
    });
    const hdr: GPUColorTargetState[] = [{ format: 'rgba16float' }];
    const P = {
      wall: mk('wall', pl, 'vs_fill', 'fs_fill', 'back', depth24, hdr, msaa),
      surf: mk('surf', pl, 'vs_fill_surf', 'fs_fill_surf', 'none', depth24, hdr, msaa),
      wallShadow: mk('wallShadow', spl, 'vs_fill_shadow', 'fs_fill_clip', 'none', depth32(true), [], undefined, shadowMod),
      surfShadow: mk('surfShadow', spl, 'vs_fill_surf_shadow', 'fs_fill_clip', 'none', depth32(true), [], undefined, shadowMod),
      wallPre: mk('wallPre', pl, 'vs_fill', 'fs_fill_clip', 'back', { format: mt.prepassFormat, depthWriteEnabled: true, depthCompare: 'less' }, []),
      surfPre: mk('surfPre', pl, 'vs_fill_surf', 'fs_fill_clip', 'none', { format: mt.prepassFormat, depthWriteEnabled: true, depthCompare: 'less' }, []),
      wDepth: mk('wDepth', wpl, 'vs_fill', 'fs_fill_wdepth', 'back', depth32(false), []),
      wSurfDepth: mk('wSurfDepth', wpl, 'vs_fill_surf', 'fs_fill_wsurf_depth', 'none', depth32(false), []),
      wThick: mk('wThick', wpl, 'vs_fill', 'fs_fill_wthick', 'none', undefined, [{ format: 'rgba16float', blend: add }]), // X5: the fluid thickness target is rgba (goo)
      wSurfThick: mk('wSurfThick', wpl, 'vs_fill_surf', 'fs_fill_wsurf_thick', 'none', undefined, [{ format: 'rgba16float', blend: add }]),
    };
    const keys = Object.keys(P) as (keyof typeof P)[];
    void Promise.all(keys.map((k) => P[k])).then((vals) => {
      const o: Record<string, GPURenderPipeline> = {};
      keys.forEach((k, i) => { o[k] = vals[i]!; });
      this.pipes = o as NonNullable<FillPass['pipes']>;
    }).catch((e: unknown) => { console.error('matter: fill pipelines failed; container contents are off', e); this.items = []; this.off = true; });
    return null;
  }

  private groups(pass: GPURenderPassEncoder, water: boolean): boolean {
    if (!this.draws.length || !this.fbuf || !this.vbuf || !this.ibuf || !this.mu) return false;
    const mt = this.r.matterTargets();
    if (water) {
      if (!this.waterBind || !this.waterDepthTex) return false;
    } else {
      this.bind ??= this.d.createBindGroup({ layout: this.layout, entries: [{ binding: 3, resource: { buffer: this.mu } }, { binding: 6, resource: { buffer: this.fbuf } }] });
    }
    pass.setBindGroup(0, mt.group0);
    pass.setBindGroup(1, water ? this.waterBind! : this.bind!);
    pass.setBindGroup(2, mt.look);
    pass.setBindGroup(3, mt.gi);
    return true;
  }

  private drawSet(pass: GPURenderPassEncoder, wall: GPURenderPipeline, surf: GPURenderPipeline, filter: (d: Draw) => boolean): void {
    pass.setPipeline(wall);
    pass.setVertexBuffer(0, this.vbuf!);
    pass.setIndexBuffer(this.ibuf!, 'uint32');
    for (const dr of this.draws) if (filter(dr)) pass.drawIndexed(dr.cav.indices.length, 1, dr.cav.firstIndex!, dr.cav.baseVertex!, dr.inst);
    if (!this.sbuf) return;
    pass.setPipeline(surf);
    pass.setVertexBuffer(0, this.sbuf);
    for (const dr of this.draws) if (filter(dr) && dr.surfCount) pass.draw(dr.surfCount, 1, dr.surfFirst, dr.inst);
  }

  drawOpaque(pass: GPURenderPassEncoder): void {
    if (!this.draws.some((d) => !d.water)) return;
    const p = this.ensure();
    if (!p) return;
    if (!this.groups(pass, false)) return;
    this.drawSet(pass, p.wall, p.surf, (d) => !d.water);
  }

  drawShadow(pass: GPURenderPassEncoder): void {
    if (!this.draws.some((d) => !d.water)) return;
    const p = this.ensure();
    if (!p) return;
    if (!this.fbuf || !this.vbuf || !this.ibuf || !this.mu) return;
    this.bind ??= this.d.createBindGroup({ layout: this.layout, entries: [{ binding: 3, resource: { buffer: this.mu } }, { binding: 6, resource: { buffer: this.fbuf } }] });
    this.shadowGroup ??= this.d.createBindGroup({ layout: this.shadowFrameLayout!, entries: [{ binding: 0, resource: { buffer: this.r.spectacleTargets().frameBuf } }] });
    pass.setBindGroup(0, this.shadowGroup);
    pass.setBindGroup(1, this.bind!);
    this.drawSet(pass, p.wallShadow, p.surfShadow, (d) => !d.water);
  }

  drawPrepass(pass: GPURenderPassEncoder): void {
    if (!this.draws.some((d) => !d.water)) return;
    const p = this.ensure();
    if (!p) return;
    if (!this.groups(pass, false)) return;
    this.drawSet(pass, p.wallPre, p.surfPre, (d) => !d.water);
  }

  /** Called by index.ts before the water passes with the frame's opaque depth. */
  prepareWater(sceneDepth: GPUTexture): void {
    if (!this.hasWater || !this.fbuf || !this.mu) return;
    if (this.waterBind && this.waterDepthTex === sceneDepth) return;
    this.waterDepthTex = sceneDepth;
    this.waterBind = this.d.createBindGroup({
      layout: this.waterLayout,
      entries: [{ binding: 3, resource: { buffer: this.mu } }, { binding: 6, resource: { buffer: this.fbuf } }, { binding: 7, resource: sceneDepth.createView() }],
    });
  }

  drawWaterDepth(pass: GPURenderPassEncoder): void {
    if (!this.hasWater) return;
    const p = this.ensure();
    if (!p) return;
    if (!this.groups(pass, true)) return;
    this.drawSet(pass, p.wDepth, p.wSurfDepth, (d) => d.water);
  }

  drawWaterThick(pass: GPURenderPassEncoder): void {
    if (!this.hasWater) return;
    const p = this.ensure();
    if (!p) return;
    if (!this.groups(pass, true)) return;
    this.drawSet(pass, p.wThick, p.wSurfThick, (d) => d.water);
  }
}

/** `CAVITY__<name>` meshes of a part glb (any LOD node or none), with the art.json's matter and LUT by name. */
export function cavitiesFromGlb(glb: ParsedGlb, art: readonly { name: string; matter: string; lut?: number[] }[]): Omit<CavityGeo, 'firstIndex' | 'baseVertex'>[] {
  const out: Omit<CavityGeo, 'firstIndex' | 'baseVertex'>[] = [];
  for (const m of glb.meshes) {
    const match = /^CAVITY__([a-z0-9_]+)/.exec(m.nodeName);
    if (!match) continue;
    const name = match[1]!;
    const P: number[] = [], I: number[] = [];
    for (const p of m.primitives) {
      const base = P.length / 3;
      const M = m.matrix;
      for (let i = 0; i < p.positions.length; i += 3) {
        const v = [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!];
        P.push(M[0]! * v[0]! + M[4]! * v[1]! + M[8]! * v[2]! + M[12]!, M[1]! * v[0]! + M[5]! * v[1]! + M[9]! * v[2]! + M[13]!, M[2]! * v[0]! + M[6]! * v[1]! + M[10]! * v[2]! + M[14]!);
      }
      for (const i of p.indices) I.push(base + i);
    }
    const positions = new Float32Array(P), indices = new Uint32Array(I);
    const a = art.find((c) => c.name === name);
    out.push({ name, matter: a?.matter === 'fill' ? 'liquid' : a?.matter ?? 'sand', positions, normals: vertexNormals(positions, indices), indices, ...(a?.lut ? { lut: a.lut } : {}) });
  }
  return out;
}

export { VERTEX_STRIDE };
