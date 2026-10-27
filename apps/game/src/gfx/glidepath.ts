// GLIDEPATH links (frame.md; A3's sim: channels/glidepath.ts; art: assets/build/parts/glidepath/
// glidepath.profile.json + glidepath.glb, stream E3a). Like GUTTER (gutter.ts): the profile's closed loops
// (two kn_chrome rails, the kn_anod_cobalt T-spine) are swept along the link path rounded exactly as the sim
// rounds it (roundPath(points, 0.1, 12)), and the kit is placed along it: ties every 0.1 m, clamps at most
// 0.5 m apart, posts plumb to the floor under raised runs, and a buffer at the run end. Until the art
// loads, a procedural twin rail (⌀8 mm at 14 mm centres on a spine) stands in. One mesh per path, cached.
//
// Frames: profile (x_lat, z) → world P + left·x_lat + up·z, left = up × tangent (the profile's frame).
// Kit pieces are authored on a straight demo run along engine +X, +Y up, x_lat along −Z, at `demo_pos`
// (Blender → engine (x, z, −y)).

import { parseGlb, type ParsedGlb } from '@knockon/assets';
import { posToMetres, type LinkRecord } from '@knockon/format';
import { roundPath } from '@knockon/sim';
import { MAT_KIND, type Geometry } from './meshes.ts';
import type { Renderer, SceneItem } from './renderer.ts';

type V3 = [number, number, number];

interface Loop { points: [number, number][]; master: string }
interface KitPiece { pos: number[]; nrm: number[]; col: number[]; mat: number[]; idx: number[] }
interface Art { loops: Loop[]; kit: Map<string, KitPiece>; masters: Map<string, { color: number[]; rough: number; metal: number }>; tie: number; clamp: number }

const BEND = 0.1; // A3 / the profile's min_bend_radius
const MASTERS = new Map([
  ['kn_chrome', { color: [0.92, 0.92, 0.94, 1], rough: 0.12, metal: 1 }],
  ['kn_anod_cobalt', { color: [0.03, 0.1, 0.75, 1], rough: 0.35, metal: 0.6 }],
  ['kn_powder_bone', { color: [0.81, 0.76, 0.67, 1], rough: 0.42, metal: 0 }],
  ['kn_rubber', { color: [0.04, 0.04, 0.045, 1], rough: 0.85, metal: 0 }],
]);

function circle(cx: number, cz: number, r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number]; });
}

/** Procedural stand-in: the frame.md section (rails ⌀8 mm at 14 mm centres, rail tops at z = 0, T-spine). */
const FALLBACK: Loop[] = [
  { points: circle(0.007, -0.004, 0.004, 12), master: 'kn_chrome' },
  { points: circle(-0.007, -0.004, 0.004, 12), master: 'kn_chrome' },
  { points: [[-0.003, -0.04], [0.003, -0.04], [0.003, -0.0115], [0.01, -0.0115], [0.01, -0.006], [-0.01, -0.006], [-0.01, -0.0115], [-0.003, -0.0115]], master: 'kn_anod_cobalt' },
];

export class GlidepathView {
  private readonly r: Renderer;
  private art: Art | null = null;
  private loading = false;
  private readonly meshes = new Map<string, number>();

  constructor(renderer: Renderer) { this.r = renderer; }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    void (async () => {
      try {
        const [pj, gb] = await Promise.all([fetch('/parts/glidepath/glidepath.profile.json'), fetch('/parts/glidepath/glidepath.glb')]);
        if (!pj.ok) return;
        const j = await pj.json() as ProfileJson;
        this.art = parseArt(j, gb.ok ? parseGlb(await gb.arrayBuffer()) : null);
        this.meshes.clear();
      } catch (e) {
        console.warn('glidepath art:', e);
      }
    })();
  }

  /** Appends the overlay item for one GLIDEPATH link (no-op for other kinds). */
  items(l: LinkRecord, out: SceneItem[]): void {
    if (l.kind !== 'glidepath') return;
    this.load();
    const pts = l.points.map((q) => q.map(posToMetres) as V3);
    if (pts.length < 2) return;
    const key = `${this.art ? 'a' : 'f'}:${pts.map((p) => p.map((x) => x.toFixed(4)).join(',')).join(';')}`;
    let mesh = this.meshes.get(key);
    if (mesh === undefined) {
      mesh = this.r.addMesh(`glidepath:${this.meshes.size}`, [glidepathGeometry(pts, this.art)]);
      this.meshes.set(key, mesh);
    }
    out.push({ pos: [0, 0, 0], size: [1, 1, 1], mesh, color: [1, 1, 1], rough: 0.3 });
  }
}

interface ProfileJson {
  lods: Record<string, { loops: { name: string; master: string; points: [number, number][] }[] }>;
  path_rules?: { tie_spacing?: number; clamp_max_spacing?: number };
  kit?: Record<string, { demo_pos?: number[] }>;
}

function parseArt(j: ProfileJson, glb: ParsedGlb | null): Art {
  const lod = j.lods['LOD0'] ?? Object.values(j.lods)[0];
  const loops: Loop[] = lod ? lod.loops.map((l) => ({ points: l.points, master: l.master })) : FALLBACK;
  const masters = new Map(MASTERS);
  const kit = new Map<string, KitPiece>();
  if (glb) {
    for (const m of glb.materials) masters.set(m.name, { color: [...m.baseColorFactor], rough: m.roughnessFactor, metal: m.metallicFactor });
    for (const m of glb.meshes) {
      if (m.lod !== 0 || !/^glidepath__(tie|clamp|post|buffer)$/.test(m.nodeName)) continue;
      const name = m.nodeName.slice('glidepath__'.length);
      const d = j.kit?.[m.nodeName]?.demo_pos ?? [0, 0, 0];
      const a: V3 = [d[0] ?? 0, d[2] ?? 0, -(d[1] ?? 0)];
      const k: KitPiece = { pos: [], nrm: [], col: [], mat: [], idx: [] };
      for (const p of m.primitives) {
        const mt = glb.materials[p.material];
        if (mt?.name === 'kn_decal') continue;
        const base = k.pos.length / 3;
        for (let i = 0; i < p.vertexCount; i++) {
          k.pos.push(p.positions[i * 3]! - a[0], p.positions[i * 3 + 1]! - a[1], p.positions[i * 3 + 2]! - a[2]);
          if (p.normals) k.nrm.push(p.normals[i * 3]!, p.normals[i * 3 + 1]!, p.normals[i * 3 + 2]!); else k.nrm.push(0, 1, 0);
          k.col.push(...(mt?.baseColorFactor ?? [1, 1, 1, 1]));
          k.mat.push(mt?.roughnessFactor ?? 0.5, mt?.metallicFactor ?? 0, 0, MAT_KIND.master);
        }
        for (const x of p.indices) k.idx.push(base + x);
      }
      kit.set(name, k);
    }
  }
  return { loops, kit, masters, tie: j.path_rules?.tie_spacing ?? 0.1, clamp: j.path_rules?.clamp_max_spacing ?? 0.5 };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Tangent, left and up along the path, parallel-transported so loops and vertical runs don't flip. */
function frames(path: readonly V3[]): { t: V3; left: V3; up: V3 }[] {
  const out: { t: V3; left: V3; up: V3 }[] = [];
  let up: V3 = [0, 1, 0];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!;
    const t = nrm(sub(b, a));
    if (i === 0 && Math.abs(t[1]) > 0.99) up = [1, 0, 0];
    // remove the tangent component from the previous up (parallel transport)
    const d = up[0] * t[0] + up[1] * t[1] + up[2] * t[2];
    up = nrm(sub(up, scl(t, d)));
    const left = nrm(cross(up, t));
    out.push({ t, left, up });
  }
  return out;
}

export function glidepathGeometry(points: readonly V3[], art: Art | null): Geometry {
  const loops = art?.loops ?? FALLBACK;
  const masters = art?.masters ?? MASTERS;
  const path = roundPath(points as [number, number, number][], BEND, 12) as V3[];
  const F = frames(path);
  const P: number[] = [], N: number[] = [], C: number[] = [], M: number[] = [], I: number[] = [];
  for (const loop of loops) {
    const pp = loop.points;
    const m = masters.get(loop.master) ?? MASTERS.get('kn_chrome')!;
    let area = 0;
    for (let i = 0; i < pp.length; i++) { const a = pp[i]!, b = pp[(i + 1) % pp.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    const ccw = area > 0 ? 1 : -1;
    // round rails get smooth normals (from the loop centre), the spine gets flat edges
    const round = loop.master === 'kn_chrome';
    const cx = pp.reduce((s, q) => s + q[0], 0) / pp.length, cz = pp.reduce((s, q) => s + q[1], 0) / pp.length;
    for (let e = 0; e < pp.length; e++) {
      const a = pp[e]!, b = pp[(e + 1) % pp.length]!;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const en: [number, number] = [(dz / l) * ccw, (-dx / l) * ccw];
      const nOf = (q: [number, number]): [number, number] => {
        if (!round) return en;
        const v = [q[0] - cx, q[1] - cz], vl = Math.hypot(v[0]!, v[1]!) || 1;
        return [v[0]! / vl, v[1]! / vl];
      };
      const base = P.length / 3;
      path.forEach((p, i) => {
        const f = F[i]!;
        for (const q of [a, b]) {
          const n = nOf(q);
          P.push(...add(p, add(scl(f.left, q[0]), scl(f.up, q[1]))));
          N.push(...nrm(add(scl(f.left, n[0]), scl(f.up, n[1]))));
          C.push(...m.color); M.push(m.rough, m.metal, 0, MAT_KIND.master);
        }
      });
      for (let i = 0; i < path.length - 1; i++) {
        const v0 = base + i * 2, v1 = v0 + 1, v2 = v0 + 2, v3 = v0 + 3;
        const p0: V3 = [P[v0 * 3]!, P[v0 * 3 + 1]!, P[v0 * 3 + 2]!], p1: V3 = [P[v1 * 3]!, P[v1 * 3 + 1]!, P[v1 * 3 + 2]!], p2: V3 = [P[v2 * 3]!, P[v2 * 3 + 1]!, P[v2 * 3 + 2]!];
        const fn = cross(sub(p1, p0), sub(p2, p0));
        const vn: V3 = [N[v0 * 3]!, N[v0 * 3 + 1]!, N[v0 * 3 + 2]!];
        if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] >= 0) I.push(v0, v1, v2, v1, v3, v2);
        else I.push(v0, v2, v1, v1, v2, v3);
      }
    }
  }
  // kit along arc length
  const s: number[] = [0];
  for (let i = 1; i < path.length; i++) s.push(s[i - 1]! + len(sub(path[i]!, path[i - 1]!)));
  const L = s.at(-1)!;
  const at = (d: number): { p: V3; f: { t: V3; left: V3; up: V3 } } => {
    let i = 1;
    while (i < path.length - 1 && s[i]! < d) i++;
    const u = Math.max(0, Math.min(1, (d - s[i - 1]!) / Math.max(1e-6, s[i]! - s[i - 1]!)));
    return { p: add(path[i - 1]!, scl(sub(path[i]!, path[i - 1]!), u)), f: F[u < 0.5 ? i - 1 : i]! };
  };
  const place = (name: string, d: number): boolean => {
    const k = art?.kit.get(name);
    if (!k) return false;
    const { p, f } = at(d);
    const base = P.length / 3;
    for (let i = 0; i < k.pos.length / 3; i++) {
      const x = k.pos[i * 3]!, y = k.pos[i * 3 + 1]!, z = k.pos[i * 3 + 2]!;
      P.push(...add(p, add(scl(f.t, x), add(scl(f.up, y), scl(f.left, -z)))));
      N.push(...nrm(add(scl(f.t, k.nrm[i * 3]!), add(scl(f.up, k.nrm[i * 3 + 1]!), scl(f.left, -k.nrm[i * 3 + 2]!)))));
    }
    C.push(...k.col); M.push(...k.mat);
    for (const x of k.idx) I.push(base + x);
    return true;
  };
  const tie = art?.tie ?? 0.1, clampMax = art?.clamp ?? 0.5;
  for (let d = tie / 2; d < L; d += tie) place('tie', d);
  const nc = Math.max(1, Math.ceil(L / clampMax));
  for (let i = 0; i <= nc; i++) {
    const d = (L * i) / nc;
    place('clamp', d);
    // posts plumb to the floor under clamps on upright, raised runs
    const { p, f } = at(d);
    if (f.up[1] < 0.7) continue;
    const top = p[1] - 0.04;
    if (top > 0.01) post(P, N, C, M, I, [p[0], 0, p[2]], top, 0.008, (masters.get('kn_powder_bone') ?? MASTERS.get('kn_powder_bone')!).color);
  }
  place('buffer', L);
  return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I), colors: new Float32Array(C), mats: new Float32Array(M) };
}

function post(P: number[], N: number[], C: number[], M: number[], I: number[], p: V3, h: number, r: number, color: number[]): void {
  const base = P.length / 3, sides = 10;
  for (let k = 0; k <= sides; k++) {
    const a = (k / sides) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    for (const y of [0, h]) { P.push(p[0] + x * r, y, p[2] + z * r); N.push(x, 0, z); C.push(...color); M.push(0.42, 0, 0, MAT_KIND.master); }
  }
  for (let k = 0; k < sides; k++) { const a = base + k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
