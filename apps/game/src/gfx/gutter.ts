// GUTTER links (frame.md; art: assets/build/parts/gutter/gutter.profile.json + gutter.glb, stream E):
// the closed channel profile is swept along the link's rounded path (the same roundPath and bend radius
// as the sim's colliders, channels/gutter.ts), with per-edge master materials (Bone inside, Cobalt
// outside and lips). Kit pieces from the glb are placed along it: a stop at the start, a spout at the
// end, straps at most 0.5 m apart, and saddles (with posts down to the floor) under raised runs.
// `gutter_slim` uses its own profile and the kit scaled to its radius. One mesh per path shape, cached.
//
// Frames: profile (x_lat, z) → world P + left·x_lat + up·z, with left = up × tangent (the sim's side is
// tangent × up = −left). Kit pieces are authored on a straight demo run along engine +X with +Y up and
// x_lat along −Z, anchored at `demo_pos` (Blender coords → engine (x, z, −y)).

import { parseGlb, type ParsedGlb } from '@knockon/assets';
import { posToMetres, type LinkRecord } from '@knockon/format';
import { roundPath } from '@knockon/sim';
import { MAT_KIND, type Geometry } from './meshes.ts';
import { partTexLook } from './glbmesh.ts';
import { detailFor, EXEMPT, layerBytes, masterKind, texSetKind } from './look/materials.ts';
import type { Renderer, SceneItem } from './renderer.ts';

type V3 = [number, number, number];

interface Profile { points: [number, number][]; edgeMaster: string[]; radius: number }
interface KitPiece { pos: number[]; nrm: number[]; col: number[]; mat: number[]; idx: number[]; uv: number[] }
/** R5 (M5): one profile edge's texture-set UVs on the glb's demo channel: its two points at the start and the end of a
 * tile (`TILE` m), [uA0, vA0, uB0, vB0, uA1, vA1, uB1, vB1]. */
type EdgeUv = readonly number[];
interface GutterArt {
  profiles: Map<string, Profile>;
  kit: Map<string, KitPiece>;
  masters: Map<string, { color: number[]; rough: number; metal: number }>;
  rules: Map<string, { bend: number; strap: number }>;
  /** R5 (M5): the texture set's layer (−1: none, the flat masters) and the channel's per-edge tile UVs (full-size gutter). */
  layer: number;
  edgeUv: Map<string, (EdgeUv | null)[]>;
}

/** R5 (M5): the demo channel in gutter.glb is one 0.5 m tile of the trim; the sweep repeats it. */
const TILE = 0.5;

/** Sim bend radii (channels/gutter.ts) and the fallback half-pipe when the art isn't built. */
const SIM = { gutter: { r: 0.145, bend: 0.36 }, gutter_slim: { r: 0.056, bend: 0.15 } } as const;
const KIT_R = 0.145; // the kit is authored for the full-size gutter

export class GutterView {
  private readonly r: Renderer;
  private art: GutterArt | null = null;
  private loading = false;
  private readonly meshes = new Map<string, number>();

  constructor(renderer: Renderer) { this.r = renderer; }

  /** Starts loading the profile + kit (once); until then gutters use a plain half-pipe. */
  load(): void {
    if (this.loading) return;
    this.loading = true;
    void (async () => {
      try {
        const [pj, gb] = await Promise.all([fetch('/parts/gutter/gutter.profile.json'), fetch('/parts/gutter/gutter.glb')]);
        if (!pj.ok) return;
        const profile = await pj.json() as ProfileJson;
        const glb = gb.ok ? parseGlb(await gb.arrayBuffer()) : null;
        // R5 (M5, contract 6): the gutter's texture set (tiling trim on the channel, the kit's own UVs)
        const look = glb ? await partTexLook(this.r, 'gutter', glb) : undefined;
        this.art = parseArt(profile, glb, look?.layer('kn_powder_bone') ?? -1);
        this.meshes.clear(); // rebuild with the real profile
      } catch (e) {
        console.warn('gutter art:', e);
      }
    })();
  }

  /** Appends the overlay item for one GUTTER link (no-op for other kinds). */
  items(l: LinkRecord, out: SceneItem[]): void {
    if (l.kind !== 'gutter' && l.kind !== 'gutter_slim') return;
    this.load();
    const pts = l.points.map((q) => q.map(posToMetres) as V3);
    if (pts.length < 2) return;
    const key = `${l.kind}:${this.art ? 'a' : 'f'}:${pts.map((p) => p.map((x) => x.toFixed(3)).join(',')).join(';')}`;
    let mesh = this.meshes.get(key);
    if (mesh === undefined) {
      mesh = this.r.addMesh(`gutter:${this.meshes.size}:${l.kind}`, [gutterGeometry(pts, l.kind, this.art)]);
      this.meshes.set(key, mesh);
    }
    out.push({ pos: [0, 0, 0], size: [1, 1, 1], mesh, color: [1, 1, 1], rough: 0.42 });
  }
}

// ---- art parsing -----------------------------------------------------------------------------------

interface ProfileJson {
  profiles: Record<string, { inner_radius: number; lods: Record<string, { points: [number, number][]; edge_master: string[] }> }>;
  path_rules?: Record<string, { min_bend_radius?: number; strap_max_spacing?: number }>;
  kit?: Record<string, { demo_pos?: number[] }>;
}

/** R5 (M5): vertex material bytes for a master with the set (`layer` ≥ 0 and the material flagged texSet), else the master. */
function vmOf(name: string, rough: number, metal: number, layer: number, textured: boolean, ext: readonly number[]): [number, number, number, number] {
  const detail = detailFor(name, ext);
  if (layer >= 0 && textured && !EXEMPT.test(name)) return [...layerBytes(layer), 0, texSetKind(detail)];
  return [rough, metal, 0, masterKind(detail)];
}

/**
 * R5 (M5): per profile edge, the UVs of its two points at both ends of the glb's demo channel (x = 0 and x = TILE), read
 * from the channel's triangles of that edge's master. Profile (x_lat, z) ↔ glb (x, y = z, z = −x_lat). Null where the
 * channel has no matching quad (the edge then keeps its flat master).
 */
function channelUvs(glb: ParsedGlb, prof: Profile): (EdgeUv | null)[] {
  const ch = glb.meshes.find((m) => m.lod <= 0 && m.nodeName === 'gutter__channel');
  const pp = prof.points;
  if (!ch) return pp.map(() => null);
  const eps = 2e-4;
  return pp.map((a, e) => {
    const b = pp[(e + 1) % pp.length]!;
    const want = prof.edgeMaster[e];
    const roles: (number[] | null)[] = [null, null, null, null]; // a0, b0, a1, b1
    for (const p of ch.primitives) {
      if (glb.materials[p.material]?.name !== want || !p.uvs) continue;
      const roleOf = (i: number): number => {
        const x = p.positions[i * 3]!, y = p.positions[i * 3 + 1]!, z = p.positions[i * 3 + 2]!;
        const end = Math.abs(x) < eps ? 0 : Math.abs(x - TILE) < eps ? 1 : -1;
        if (end < 0) return -1;
        if (Math.abs(y - a[1]) < eps && Math.abs(z + a[0]) < eps) return end * 2;
        if (Math.abs(y - b[1]) < eps && Math.abs(z + b[0]) < eps) return end * 2 + 1;
        return -1;
      };
      for (let t = 0; t + 2 < p.indices.length; t += 3) {
        const vs = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!];
        const rs = vs.map(roleOf);
        if (rs.some((r) => r < 0) || !(rs.some((r) => r % 2 === 0) && rs.some((r) => r % 2 === 1))) continue;
        vs.forEach((v, k) => { roles[rs[k]!] ??= [p.uvs![v * 2]!, p.uvs![v * 2 + 1]!]; });
      }
      if (roles.every((r) => r)) break;
    }
    return roles.every((r) => r) ? roles.flatMap((r) => r!) : null;
  });
}

function parseArt(j: ProfileJson, glb: ParsedGlb | null, layer = -1): GutterArt {
  const profiles = new Map<string, Profile>();
  for (const [kind, p] of Object.entries(j.profiles)) {
    const lod = p.lods['LOD0'] ?? Object.values(p.lods)[0];
    if (lod) profiles.set(kind, { points: lod.points, edgeMaster: lod.edge_master, radius: p.inner_radius });
  }
  const rules = new Map<string, { bend: number; strap: number }>();
  for (const [kind, r] of Object.entries(j.path_rules ?? {})) rules.set(kind, { bend: r.min_bend_radius ?? 0.3, strap: r.strap_max_spacing ?? 0.5 });
  const masters = new Map<string, { color: number[]; rough: number; metal: number }>();
  const kit = new Map<string, KitPiece>();
  if (glb) {
    for (const m of glb.materials) masters.set(m.name, { color: [...m.baseColorFactor], rough: m.roughnessFactor, metal: m.metallicFactor });
    for (const m of glb.meshes) {
      if (m.lod !== 0 || !/^gutter__(stop|strap|spout|saddle)$/.test(m.nodeName)) continue;
      const name = m.nodeName.slice('gutter__'.length);
      // anchor: demo_pos (Blender) → engine (x, z, −y)
      const d = j.kit?.[m.nodeName]?.demo_pos ?? [0, 0, 0];
      const a: V3 = [d[0] ?? 0, d[2] ?? 0, -(d[1] ?? 0)];
      const k: KitPiece = { pos: [], nrm: [], col: [], mat: [], idx: [], uv: [] };
      for (const p of m.primitives) {
        const mt = glb.materials[p.material];
        if (mt?.name === 'kn_decal') continue;
        const base = k.pos.length / 3;
        // R5 (M5): the kit keeps its own UVs and samples the gutter's texture set
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let q = 0; q < p.positions.length; q++) { lo[q % 3] = Math.min(lo[q % 3]!, p.positions[q]!); hi[q % 3] = Math.max(hi[q % 3]!, p.positions[q]!); }
        const vm = mt ? vmOf(mt.name, mt.roughnessFactor, mt.metallicFactor, p.uvs ? layer : -1, mt.texSet !== undefined, [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!]) : [0.5, 0, 0, MAT_KIND.master];
        for (let i = 0; i < p.vertexCount; i++) {
          k.pos.push(p.positions[i * 3]! - a[0], p.positions[i * 3 + 1]! - a[1], p.positions[i * 3 + 2]! - a[2]);
          if (p.normals) k.nrm.push(p.normals[i * 3]!, p.normals[i * 3 + 1]!, p.normals[i * 3 + 2]!); else k.nrm.push(0, 1, 0);
          k.col.push(...(mt?.baseColorFactor ?? [1, 1, 1, 1]));
          k.mat.push(...vm);
          k.uv.push(p.uvs ? p.uvs[i * 2]! : 0, p.uvs ? p.uvs[i * 2 + 1]! : 0);
        }
        for (const x of p.indices) k.idx.push(base + x);
      }
      kit.set(name, k);
    }
  }
  // R5 (M5): the full-size channel's tile UVs (the slim gutter has no channel in the glb: it keeps its masters)
  const edgeUv = new Map<string, (EdgeUv | null)[]>();
  const full = profiles.get('gutter');
  if (glb && full && layer >= 0) edgeUv.set('gutter', channelUvs(glb, full));
  return { profiles, kit, masters, rules, layer, edgeUv };
}

// ---- geometry ----------------------------------------------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Tangent, left and up at a path sample (the sim's frame: up from world Y, any horizontal when vertical). */
function frameAt(path: readonly V3[], i: number): { t: V3; left: V3; up: V3 } {
  const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!;
  const t = nrm(sub(b, a));
  let side = cross(t, [0, 1, 0]);
  if (len(side) < 1e-3) side = [1, 0, 0];
  side = nrm(side);
  const up = nrm(cross(side, t));
  return { t, left: scl(side, -1), up };
}

/** Fallback section (no art yet): a 24-segment half-pipe with lips, Bone inside, Cobalt outside. */
function fallbackProfile(r: number): Profile {
  const pts: [number, number][] = [], em: string[] = [];
  const w = r * 0.035;
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([Math.sin(a) * r, r - Math.cos(a) * r]); em.push('kn_powder_bone'); }
  for (let i = 12; i >= 0; i--) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([Math.sin(a) * (r + w), r - Math.cos(a) * (r + w)]); em.push('kn_powder_cobalt'); }
  return { points: pts, edgeMaster: em, radius: r };
}

const FALLBACK_MASTERS = new Map([
  ['kn_powder_bone', { color: [0.81, 0.76, 0.67, 1], rough: 0.42, metal: 0 }],
  ['kn_powder_cobalt', { color: [0.03, 0.08, 0.85, 1], rough: 0.42, metal: 0 }],
]);

export function gutterGeometry(points: readonly V3[], kind: 'gutter' | 'gutter_slim', art: GutterArt | null): Geometry {
  const sim = SIM[kind];
  const rule = art?.rules.get(kind) ?? { bend: sim.bend, strap: 0.5 };
  const profile = art?.profiles.get(kind) ?? fallbackProfile(sim.r);
  const masters = art?.masters.size ? art.masters : FALLBACK_MASTERS;
  const path = roundPath(points as [number, number, number][], rule.bend, 12) as V3[];
  const P: number[] = [], N: number[] = [], C: number[] = [], M: number[] = [], I: number[] = [];
  const frames = path.map((_, i) => frameAt(path, i));

  // profile winding: outward edge normal is (dz, −dx) for a counter-clockwise polygon
  const pp = profile.points;
  let area = 0;
  for (let i = 0; i < pp.length; i++) { const a = pp[i]!, b = pp[(i + 1) % pp.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0 ? 1 : -1;
  const edgeN = pp.map((a, i) => {
    const b = pp[(i + 1) % pp.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [(dz / l) * ccw, (-dx / l) * ccw] as [number, number];
  });
  // smooth normals across an edge joint when the master continues and the turn is gentle (< 40°)
  const endN = (e: number, end: 0 | 1): [number, number] => {
    const o = end === 0 ? (e - 1 + pp.length) % pp.length : (e + 1) % pp.length;
    const a = edgeN[e]!, b = edgeN[o]!;
    if (profile.edgeMaster[o] !== profile.edgeMaster[e] || a[0] * b[0] + a[1] * b[1] < 0.77) return a;
    const s = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(s[0]!, s[1]!) || 1;
    return [s[0]! / l, s[1]! / l];
  };
  // R5 (M5, contract 6): with the texture set, each profile edge takes its UVs from the demo channel's tile and repeats
  // it every TILE metres of arc length: stations are inserted at the tile seams, so every quad lies inside one tile
  const U: number[] = [];
  const euv = art && art.layer >= 0 ? art.edgeUv.get(kind) : undefined;
  const st: { p: V3; f: ReturnType<typeof frameAt>; s: number }[] = [{ p: path[0]!, f: frames[0]!, s: 0 }];
  for (let i = 1; i < path.length; i++) {
    const s0 = st.at(-1)!.s, seg = len(sub(path[i]!, path[i - 1]!));
    if (euv) for (let k = Math.floor(s0 / TILE) + 1; k * TILE < s0 + seg - 1e-6; k++) {
      const t = (k * TILE - s0) / Math.max(seg, 1e-9);
      if (t > 1e-6) st.push({ p: add(path[i - 1]!, scl(sub(path[i]!, path[i - 1]!), t)), f: frames[t < 0.5 ? i - 1 : i]!, s: k * TILE });
    }
    st.push({ p: path[i]!, f: frames[i]!, s: s0 + seg });
  }
  for (let e = 0; e < pp.length; e++) {
    const name = profile.edgeMaster[e] ?? '';
    const m = masters.get(name) ?? FALLBACK_MASTERS.get('kn_powder_bone')!;
    const a = pp[e]!, b = pp[(e + 1) % pp.length]!;
    const na = endN(e, 0), nb = endN(e, 1);
    const uv = euv?.[e] ?? null;
    const vm = uv ? vmOf(name, m.rough, m.metal, art!.layer, true, [1, 0.1, 0.1]) : [m.rough, m.metal, 0, MAT_KIND.master];
    for (let j = 0; j + 1 < st.length; j++) {
      const tile = Math.floor((st[j]!.s + st[j + 1]!.s) / 2 / TILE);
      const base = P.length / 3;
      for (const sj of [st[j]!, st[j + 1]!]) {
        const tt = 0.008 + 0.984 * (sj.s / TILE - tile); // (inset: the tile's ends never sample the neighbouring island)
        ([[a, na, 0], [b, nb, 1]] as const).forEach(([q, n, which]) => {
          const w = add(sj.p, add(scl(sj.f.left, q[0]), scl(sj.f.up, q[1])));
          const wn = nrm(add(scl(sj.f.left, n[0]), scl(sj.f.up, n[1])));
          P.push(...w); N.push(...wn); C.push(...m.color); M.push(...vm);
          if (uv) U.push(uv[which * 2]! + (uv[4 + which * 2]! - uv[which * 2]!) * tt, uv[which * 2 + 1]! + (uv[5 + which * 2]! - uv[which * 2 + 1]!) * tt);
          else U.push(0, 0);
        });
      }
      const v0 = base, v1 = base + 1, v2 = base + 2, v3 = base + 3;
      // choose the winding whose face normal agrees with the vertex normal
      const p0: V3 = [P[v0 * 3]!, P[v0 * 3 + 1]!, P[v0 * 3 + 2]!], p1: V3 = [P[v1 * 3]!, P[v1 * 3 + 1]!, P[v1 * 3 + 2]!], p2: V3 = [P[v2 * 3]!, P[v2 * 3 + 1]!, P[v2 * 3 + 2]!];
      const fn = cross(sub(p1, p0), sub(p2, p0));
      const vn: V3 = [N[v0 * 3]!, N[v0 * 3 + 1]!, N[v0 * 3 + 2]!];
      if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] >= 0) I.push(v0, v1, v2, v1, v3, v2);
      else I.push(v0, v2, v1, v1, v2, v3);
    }
  }

  // kit pieces along the path (arc length s)
  if (art?.kit.size) {
    const sc = sim.r / KIT_R;
    const s: number[] = [0];
    for (let i = 1; i < path.length; i++) s.push(s[i - 1]! + len(sub(path[i]!, path[i - 1]!)));
    const L = s.at(-1)!;
    const at = (d: number): { p: V3; f: ReturnType<typeof frameAt> } => {
      let i = 1;
      while (i < path.length - 1 && s[i]! < d) i++;
      const t = (d - s[i - 1]!) / Math.max(1e-6, s[i]! - s[i - 1]!);
      return { p: add(path[i - 1]!, scl(sub(path[i]!, path[i - 1]!), Math.max(0, Math.min(1, t)))), f: frameAt(path, t < 0.5 ? i - 1 : i) };
    };
    const place = (name: string, d: number): void => {
      const k = art.kit.get(name);
      if (!k) return;
      const { p, f } = at(d);
      // kit local (+X tangent, +Y up, −Z left) → world
      const map = (x: number, y: number, z: number): V3 => add(p, add(scl(f.t, x * sc), add(scl(f.up, y * sc), scl(f.left, -z * sc))));
      const mapN = (x: number, y: number, z: number): V3 => nrm(add(scl(f.t, x), add(scl(f.up, y), scl(f.left, -z))));
      const base = P.length / 3;
      for (let i = 0; i < k.pos.length / 3; i++) {
        P.push(...map(k.pos[i * 3]!, k.pos[i * 3 + 1]!, k.pos[i * 3 + 2]!));
        N.push(...mapN(k.nrm[i * 3]!, k.nrm[i * 3 + 1]!, k.nrm[i * 3 + 2]!));
      }
      C.push(...k.col); M.push(...k.mat); U.push(...k.uv);
      for (const x of k.idx) I.push(base + x);
    };
    place('stop', 0);
    place('spout', L);
    const n = Math.max(1, Math.ceil(L / rule.strap));
    for (let i = 1; i < n; i++) place('strap', (L * i) / n);
    // saddles under raised, gently sloped runs, mid-span between straps; a post reaches the floor
    for (let i = 0; i < n; i++) {
      const d = (L * (i + 0.5)) / n;
      const { p, f } = at(d);
      if (Math.abs(f.t[1]) > 0.7 || p[1] < 0.131 * sc) continue;
      place('saddle', d);
      const foot = p[1] - 0.131 * sc;
      if (foot > 0.005) {
        post(P, N, C, M, I, [p[0], 0, p[2]], foot, 0.01 * sc, masters.get('kn_powder_cobalt')?.color ?? [0.03, 0.08, 0.85, 1]);
        while (U.length < (P.length / 3) * 2) U.push(0, 0);
      }
    }
  }
  return {
    positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I),
    colors: new Float32Array(C), mats: new Float32Array(M), uvs: new Float32Array(U), // R5 (M5): texture-set UVs
  };
}

/** A vertical post (12-sided, uncapped) from the floor point `p` up to height `h`. */
function post(P: number[], N: number[], C: number[], M: number[], I: number[], p: V3, h: number, r: number, color: number[]): void {
  const base = P.length / 3, sides = 12;
  for (let k = 0; k <= sides; k++) {
    const a = (k / sides) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    for (const y of [0, h]) { P.push(p[0] + x * r, y, p[2] + z * r); N.push(x, 0, z); C.push(...color); M.push(0.42, 0, 0, MAT_KIND.master); }
  }
  for (let k = 0; k < sides; k++) { const a = base + k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
