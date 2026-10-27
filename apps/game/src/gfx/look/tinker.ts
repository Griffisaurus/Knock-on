// THE TINKER LAB stand-in (contract 2): until stream E3b's `assets/build/env/tinker/tinker.glb` lands, the
// set is built procedurally from the approved key art's own layout (`tools/blender/render_tinker_lab.py`:
// the room, windows and sky card, chalkboard, blueprint, posters, shelves, the workbench and cutting mat,
// the bench clutter and the pendant lamps), in the key art's real scale (D82). Coordinates below are the
// script's Blender ones (Z-up, front −Y) and are converted on emit; the mat top is world y = 0.
// Text on the chalkboard and posters uses a tiny 5 × 7 stroke font (no font files).

import { box as unitBox, cylinder as unitCyl, sphere as unitSphere, type Geometry } from '../meshes.ts';
import { DETAIL } from './wgsl.ts';
import { MAT_Z } from './sets.ts';

type B3 = readonly [number, number, number];

const lin = (h: string): [number, number, number] => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
};

interface Mat { readonly color: string; readonly rough?: number; readonly metal?: number; readonly emit?: number; readonly detail?: number }

/** Deterministic RNG (mulberry32) so the stand-in dressing is the same every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SetBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly mat: number[] = [];
  private readonly idx: number[] = [];

  /** Appends a unit primitive (engine space) scaled, rotated (Blender XYZ Euler, degrees) and placed in Blender space. */
  add(g: Geometry, size: B3, loc: B3, m: Mat, rotDeg: B3 = [0, 0, 0], taper = 1): void {
    const [rx, ry, rz] = rotDeg.map((a) => (a * Math.PI) / 180) as [number, number, number];
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rz · Ry · Rx (Blender 'XYZ')
    const R = [
      cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx,
    ];
    const rot = (v: number[]): number[] => [R[0]! * v[0]! + R[1]! * v[1]! + R[2]! * v[2]!, R[3]! * v[0]! + R[4]! * v[1]! + R[5]! * v[2]!, R[6]! * v[0]! + R[7]! * v[1]! + R[8]! * v[2]!];
    const c = lin(m.color);
    const kind = (255 - (m.detail ?? 0)) / 255;
    const e = Math.min(1, (m.emit ?? 0) / 12);
    const base = this.pos.length / 3;
    const n = g.positions.length / 3;
    for (let i = 0; i < n; i++) {
      // engine unit (x, y, z) → Blender unit (x, −z, y)
      const ex = g.positions[i * 3]!, ey = g.positions[i * 3 + 1]!, ez = g.positions[i * 3 + 2]!;
      const t = taper === 1 ? 1 : 1 + (taper - 1) * (ey + 0.5);
      const pb = rot([ex * size[0] * t, -ez * size[1] * t, ey * size[2]]);
      const nx = g.normals[i * 3]!, ny = g.normals[i * 3 + 1]!, nz = g.normals[i * 3 + 2]!;
      let nb = rot([nx / size[0], -nz / size[1], ny / size[2]]);
      const l = Math.hypot(nb[0]!, nb[1]!, nb[2]!) || 1;
      nb = nb.map((x) => x / l);
      // Blender (x, y, z) → engine (x, z − mat, −y)
      this.pos.push(pb[0]! + loc[0], pb[2]! + loc[2] - MAT_Z, -(pb[1]! + loc[1]));
      this.nrm.push(nb[0]!, nb[2]!, -nb[1]!);
      this.col.push(c[0], c[1], c[2], 1);
      this.mat.push(m.rough ?? 0.5, m.metal ?? 0, e, kind);
    }
    for (const k of g.indices) this.idx.push(base + k);
  }

  box(size: B3, loc: B3, m: Mat, rot: B3 = [0, 0, 0]): void { this.add(BOX, size, loc, m, rot); }
  /** Blender `cyl`: radius r (r2 at the top), height h, along local Z. */
  cyl(r: number, h: number, loc: B3, m: Mat, rot: B3 = [0, 0, 0], r2?: number, seg = 24): void {
    this.add(cylOf(seg), [2 * r, 2 * r, h], loc, m, rot, r2 !== undefined ? r2 / r : 1);
  }
  sphere(r: number, loc: B3, m: Mat, scale: B3 = [1, 1, 1], rot: B3 = [0, 0, 0]): void {
    this.add(SPHERE, [2 * r * scale[0], 2 * r * scale[1], 2 * r * scale[2]], loc, m, rot);
  }
  /** A polyline of thin boxes (chalk strokes, blueprint lines) lying in the XZ plane at depth y. */
  line(a: B3, b: B3, w: number, m: Mat): void {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    this.box([len + w, 0.002, w], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], m, [0, (-Math.atan2(dz, dx) * 180) / Math.PI, 0]);
  }
  /** Stroke text centred at (x, y, z), cap height ≈ 0.73 × size, facing −Y. */
  text(s: string, at: B3, size: number, m: Mat, align: 'center' | 'left' = 'center'): void {
    const px = (0.73 * size) / 7;
    const lines = s.split('\n');
    lines.forEach((ln, li) => {
      const w = ln.length * 6 * px - px;
      const x0 = align === 'center' ? at[0] - w / 2 : at[0];
      const z0 = at[2] + 3.5 * px - li * 10 * px;
      [...ln].forEach((ch, ci) => {
        const gl = FONT[ch] ?? FONT[ch.toUpperCase()];
        if (!gl) return;
        for (let r = 0; r < 7; r++) {
          // merge horizontal runs into one stroke box
          let c = 0;
          while (c < 5) {
            if (gl[r]![c] !== '#') { c++; continue; }
            let e = c;
            while (e < 5 && gl[r]![e] === '#') e++;
            const x = x0 + ci * 6 * px + ((c + e) / 2) * px;
            this.box([(e - c) * px * 0.98, 0.002, px * 0.95], [x, at[1], z0 - r * px], m);
            c = e;
          }
        }
      });
    });
  }

  build(): Geometry {
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), indices: new Uint32Array(this.idx),
      colors: new Float32Array(this.col), mats: new Float32Array(this.mat), uvs: new Float32Array((this.pos.length / 3) * 2),
    };
  }
}

const BOX = unitBox();
const SPHERE = unitSphere(16, 10);
const CYLS = new Map<number, Geometry>();
const cylOf = (seg: number): Geometry => { let g = CYLS.get(seg); if (!g) CYLS.set(seg, (g = unitCyl(seg))); return g; };

// ---- the key art's set (render_tinker_lab.py build_room / build_shelves / build_bench / build_lamps) -------

const BENCH_Z = 0.90;
const WALL_Y = 1.95;
const W = DETAIL;

const M = {
  floor: { color: '#7A5236', rough: 0.5, detail: W.woodX },
  plaster: { color: '#E9DCC3', rough: 0.85, detail: W.plaster },
  wainscot: { color: '#4F6F5E', rough: 0.55, detail: W.peel },
  trim: { color: '#9A6A42', rough: 0.5, detail: W.woodX },
  trimV: { color: '#9A6A42', rough: 0.5, detail: W.woodZ },
  slate: { color: '#26392F', rough: 0.92, detail: W.paper },
  chalk: { color: '#F1EEE4', rough: 0.95, emit: 0.15 },
  chalkY: { color: '#F2D46B', rough: 0.95, emit: 0.12 },
  blueprint: { color: '#21508F', rough: 0.85, detail: W.paper },
  bpInk: { color: '#DCE9F7', rough: 0.9, emit: 0.1 },
  poster: { color: '#E8D9B5', rough: 0.85, detail: W.paper },
  ceiling: { color: '#D8CBB2', rough: 0.9, detail: W.plaster },
  sky: { color: '#FFE2B0', rough: 1, emit: 5.5 },
  tree: { color: '#7FA65A', rough: 1, emit: 1.4 },
  cork: { color: '#B88A5A', rough: 0.95, detail: W.paper },
  oak: { color: '#B8834E', rough: 0.45, detail: W.woodX },
  leg: { color: '#7A5236', rough: 0.5, detail: W.woodZ },
  mat: { color: '#2E5E52', rough: 0.7, detail: W.rubber },
  matLine: { color: '#8FB8A8', rough: 0.7 },
  glass: { color: '#D8E2E6', rough: 0.05 },
  brass: { color: '#E3B261', rough: 0.3, metal: 1, detail: W.brushed },
  enamelDark: { color: '#3A3E47', rough: 0.4, detail: W.peel },
  ceramic: { color: '#C2643E', rough: 0.4 },
  mug: { color: '#E8E2D6', rough: 0.2 },
  shade: { color: '#2F6B57', rough: 0.4, detail: W.peel },
  shadeIn: { color: '#FFF4E0', rough: 0.5 },
  bulb: { color: '#FFE7B8', rough: 0.2, emit: 40 },
  cord: { color: '#1C1E22', rough: 0.6 },
  steel: { color: '#C9CDD3', rough: 0.25, metal: 1, detail: W.brushed },
} satisfies Record<string, Mat>;

function room(b: SetBuilder, R: () => number): void {
  b.box([9, 7, 0.1], [0, 0, -0.05], M.floor);
  b.box([9, 7, 0.1], [0, 0, 3.25], M.ceiling);
  const wy = WALL_Y + 0.075;
  const win: [number, number][] = [[1.75, 2.75], [3.05, 4.05]];
  const sill = 1.0, head = 2.85;
  const xs = [-4.5, ...win.flat(), 4.5];
  for (let i = 0; i < xs.length; i += 2) { const a = xs[i]!, c = xs[i + 1]!; b.box([c - a, 0.15, 3.2], [(a + c) / 2, wy, 1.6], M.plaster); }
  for (const [a, c] of win) {
    b.box([c - a, 0.15, sill], [(a + c) / 2, wy, sill / 2], M.plaster);
    b.box([c - a, 0.15, 3.2 - head], [(a + c) / 2, wy, (head + 3.2) / 2], M.plaster);
    b.box([c - a + 0.16, 0.24, 0.05], [(a + c) / 2, WALL_Y - 0.04, sill], M.trim);
    for (const x of [a, c]) b.box([0.06, 0.18, head - sill], [x, WALL_Y + 0.02, (sill + head) / 2], M.trimV);
    b.box([c - a + 0.12, 0.18, 0.08], [(a + c) / 2, WALL_Y + 0.02, head], M.trim);
    b.box([0.035, 0.06, head - sill], [(a + c) / 2, WALL_Y + 0.07, (sill + head) / 2], M.trimV);
    for (const z of [sill + (head - sill) / 3, sill + (2 * (head - sill)) / 3]) b.box([c - a, 0.06, 0.035], [(a + c) / 2, WALL_Y + 0.07, z], M.trim);
  }
  // outside: the warm sky card and soft tree blobs
  b.box([14, 0.05, 7], [2.5, 6.5, 2.0], M.sky);
  for (let i = 0; i < 14; i++) {
    const r = 0.7 + R() * 0.7;
    b.sphere(r, [0.8 + R() * 5.2, 4 + R() * 2, 0.6 + R() * 1.8], M.tree, [1, 0.6, 0.9]);
  }
  b.box([9, 0.03, 0.95], [0, WALL_Y - 0.015, 0.475], M.wainscot);
  b.box([9, 0.05, 0.05], [0, WALL_Y - 0.03, 0.97], M.trim);
  b.box([0.15, 7, 3.2], [-3.9, 0, 1.6], M.plaster);
  b.box([0.15, 7, 3.2], [4.5, 0, 1.6], M.plaster);
  // front wall behind the camera (closes the room for the IBL bake; the camera sits inside it)
  b.box([9, 0.15, 3.2], [0, -3.5, 1.6], M.plaster);

  // chalkboard, its writing and the ramp-and-dominoes diagram
  const cx = 0.45, cz = 1.85, cw = 2.3, ch = 1.15;
  b.box([cw + 0.1, 0.05, ch + 0.1], [cx, WALL_Y - 0.03, cz], M.trim);
  b.box([cw, 0.03, ch], [cx, WALL_Y - 0.05, cz], M.slate);
  b.box([cw + 0.1, 0.07, 0.025], [cx, WALL_Y - 0.09, cz - ch / 2 - 0.03], M.trim);
  const fy = WALL_Y - 0.067;
  b.text('EVERY ACTION HAS AN', [cx - 0.15, fy, cz + 0.12], 0.08, M.chalk);
  b.text('OVERREACTION!', [cx - 0.15, fy, cz - 0.02], 0.1, M.chalkY);
  b.text('F = m · a  →  KABOOM', [cx - 0.45, fy, cz - 0.2], 0.055, M.chalk);
  b.text('Δt ≈ 0.42 s', [cx - 0.55, fy, cz - 0.31], 0.045, M.chalk);
  const bx = cx + 0.55;
  b.line([bx - 0.05, fy, cz + 0.02], [bx + 0.35, fy, cz - 0.2], 0.008, M.chalk);
  b.line([bx + 0.35, fy, cz - 0.2], [bx + 0.55, fy, cz - 0.2], 0.008, M.chalk);
  for (let i = 0; i < 6; i++) { const x = bx + 0.6 + i * 0.05, lean = Math.min(i, 3) * 0.012; b.line([x, fy, cz - 0.2], [x + lean, fy, cz - 0.1], 0.008, M.chalk); }
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
    b.line([bx + 0.05 + 0.05 * Math.cos(a0), fy, cz + 0.07 + 0.05 * Math.sin(a0)], [bx + 0.05 + 0.05 * Math.cos(a1), fy, cz + 0.07 + 0.05 * Math.sin(a1)], 0.008, M.chalk);
  }
  b.line([bx + 0.12, fy, cz + 0.12], [bx + 0.3, fy, cz + 0.02], 0.006, M.chalkY);
  b.line([bx + 0.3, fy, cz + 0.02], [bx + 0.27, fy, cz + 0.06], 0.006, M.chalkY);

  // blueprint poster with a cog diagram
  const px = -1.5, pz = 1.9, by = WALL_Y - 0.03;
  b.box([1.0, 0.012, 1.3], [px, WALL_Y - 0.02, pz], M.blueprint);
  b.text('BUILD  RUN  REWIND', [px, by, pz + 0.5], 0.06, M.bpInk);
  for (let i = 0; i < 7; i++) b.line([px - 0.45, by, pz - 0.55 + i * 0.15], [px + 0.45, by, pz - 0.55 + i * 0.15], 0.0024, M.bpInk);
  for (let i = 0; i < 7; i++) b.line([px - 0.45 + i * 0.15, by, pz - 0.55], [px - 0.45 + i * 0.15, by, pz + 0.38], 0.0024, M.bpInk);
  for (const r of [0.26, 0.18, 0.06]) for (let i = 0; i < 32; i++) {
    const a0 = (i / 32) * Math.PI * 2, a1 = ((i + 1) / 32) * Math.PI * 2;
    b.line([px + r * Math.cos(a0), by - 0.001, pz - 0.08 + r * Math.sin(a0)], [px + r * Math.cos(a1), by - 0.001, pz - 0.08 + r * Math.sin(a1)], 0.006, M.bpInk);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.line([px + 0.26 * Math.cos(a), by - 0.001, pz - 0.08 + 0.26 * Math.sin(a)], [px + 0.32 * Math.cos(a), by - 0.001, pz - 0.08 + 0.32 * Math.sin(a)], 0.012, M.bpInk);
  }
  b.text('COG · L  ⌀ 310', [px, by, pz - 0.5], 0.04, M.bpInk);

  // small posters and the cork board with notes
  b.box([0.42, 0.01, 0.58], [-2.55, WALL_Y - 0.015, 2.0], M.poster);
  b.text('SAFETY\nFIRST*', [-2.55, WALL_Y - 0.022, 2.12], 0.07, { color: '#C7442E', rough: 0.8 });
  b.box([0.9, 0.03, 0.6], [-2.6, WALL_Y - 0.02, 1.35], M.cork);
  const notes = ['#F2E6B8', '#F7C5C0', '#C9E4F2', '#D9F2C2', '#FFFFFF'];
  for (let i = 0; i < 7; i++) {
    const x = -2.95 + (i % 4) * 0.22 + (R() - 0.5) * 0.06, z = 1.5 - Math.floor(i / 4) * 0.27 + (R() - 0.5) * 0.06;
    b.box([0.15, 0.004, 0.15], [x, WALL_Y - 0.04, z], { color: notes[Math.floor(R() * notes.length)]!, rough: 0.85, detail: W.paper }, [0, (R() - 0.5) * 16, 0]);
    b.sphere(0.008, [x, WALL_Y - 0.045, z + 0.06], { color: ['#FF5B2E', '#2FD6FF', '#FFB020'][Math.floor(R() * 3)]!, rough: 0.3 });
  }
}

function plant(b: SetBuilder, R: () => number, base: B3, r: number, h: number, n = 11): void {
  b.cyl(r, r * 1.6, [base[0], base[1], base[2] + r * 0.8], M.ceramic, [180, 0, 0], r * 0.78);
  const leaf = { color: ['#3E7D3A', '#4F8F3C', '#5E9E45'][Math.floor(R() * 3)]!, rough: 0.45 };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.4;
    const tilt = 0.3 + R() * 0.7;
    const L = h * (0.5 + R() * 0.5);
    b.sphere(1, [base[0] + Math.cos(a) * L * 0.4 * Math.sin(tilt), base[1] + Math.sin(a) * L * 0.4 * Math.sin(tilt), base[2] + r * 1.5 + L * 0.35 * Math.cos(tilt)], leaf,
      [L * 0.5, L * 0.14, 0.012], [0, (-tilt * 180) / Math.PI, (a * 180) / Math.PI]);
  }
}

function fillShelf(b: SetBuilder, R: () => number, x0: number, x1: number, z: number, y: number, plants: boolean): void {
  let x = x0;
  const books = ['#8E3B2F', '#2F5D7E', '#C9A04A', '#3E6B4B', '#6B4A7A', '#D8C9A6', '#B8562E', '#2E3A55'];
  const fills = ['#E8B04A', '#7FBF6A', '#C95A3A', '#5A8FD8', '#F2E6B8'];
  while (x < x1) {
    const k = R();
    if (plants && k > 0.93) { plant(b, R, [x + 0.07, y, z], 0.06, 0.24, 8); x += 0.18; } else if (k < 0.62) {
      const run = 3 + Math.floor(R() * 6);
      for (let i = 0; i < run; i++) {
        const w = 0.025 + R() * 0.03, h = 0.18 + R() * 0.12;
        const lean = R() < 0.2 ? 5 : 0;
        b.box([w, 0.18, h], [x + w / 2, y, z + h / 2], { color: books[Math.floor(R() * books.length)]!, rough: 0.7, detail: W.paper }, [0, lean, 0]);
        x += w + 0.003;
      }
      x += 0.04;
    } else if (k < 0.86) {
      const r = 0.04 + R() * 0.025, h = 0.12 + R() * 0.08;
      b.cyl(r, h, [x + r, y, z + h / 2], M.glass);
      b.cyl(r * 0.9, h * 0.55, [x + r, y, z + 0.005 + h * 0.275], { color: fills[Math.floor(R() * fills.length)]!, rough: 0.4 });
      b.cyl(r * 1.02, 0.02, [x + r, y, z + 0.01 + h], M.brass);
      x += 2 * r + 0.03;
    } else {
      const r = 0.045, h = 0.1 + R() * 0.06;
      b.cyl(r, h, [x + r, y, z + h / 2], M.glass, [0, 0, 0], R() < 0.5 ? r : r * 0.45);
      x += 2 * r + 0.03;
    }
  }
}

function shelves(b: SetBuilder, R: () => number): void {
  const sx = -3.15, sw = 1.3;
  [0.35, 0.85, 1.35, 1.85, 2.35].forEach((z, i) => {
    b.box([sw, 0.32, 0.03], [sx, WALL_Y - 0.17, z], M.trim);
    if (i < 4) fillShelf(b, R, sx - sw / 2 + 0.05, sx + sw / 2 - 0.12, z + 0.015, WALL_Y - 0.2, false);
  });
  b.box([3.9, 0.24, 0.03], [-0.35, WALL_Y - 0.13, 1.06], M.trim);
  for (const x of [-2.1, -0.35, 1.4]) b.box([0.03, 0.2, 0.12], [x, WALL_Y - 0.12, 0.99], M.enamelDark);
  fillShelf(b, R, -2.25, 1.5, 1.075, WALL_Y - 0.14, true);
  for (const x of [2.0, 2.45, 3.35, 3.8]) plant(b, R, [x, WALL_Y - 0.05, 1.025], 0.06 + R() * 0.02, 0.22 + R() * 0.14);
  const gx = sx + 0.35, gz = 2.37;
  b.cyl(0.07, 0.03, [gx, WALL_Y - 0.18, gz + 0.015], { color: '#5E3F2A', rough: 0.4, detail: W.woodZ });
  b.cyl(0.008, 0.08, [gx, WALL_Y - 0.18, gz + 0.07], M.brass);
  b.sphere(0.13, [gx, WALL_Y - 0.18, gz + 0.24], { color: '#5C8FB0', rough: 0.5, detail: W.paper });
  plant(b, R, [sx - 0.35, WALL_Y - 0.18, 2.365], 0.08, 0.35);
}

function bench(b: SetBuilder, R: () => number): void {
  b.box([3.0, 1.0, 0.07], [0, 0, BENCH_Z - 0.035], M.oak);
  for (const x of [-1.35, 1.35]) for (const y of [-0.4, 0.4]) b.box([0.08, 0.08, BENCH_Z - 0.07], [x, y, (BENCH_Z - 0.07) / 2], M.leg);
  b.box([2.7, 0.05, 0.08], [0, 0.4, 0.2], M.leg);
  b.box([2.7, 0.8, 0.03], [0, 0, 0.18], M.oak);
  // the cutting mat (the build zone) and its printed 10 cm grid
  const mx = 0.05, my = -0.02, mw = 2.3, md = 0.82, top = BENCH_Z + 0.004;
  b.box([mw, md, 0.004], [mx, my, BENCH_Z + 0.002], M.mat);
  for (let x = mx - mw / 2 + 0.05; x < mx + mw / 2; x += 0.1) b.box([0.006, md, 0.0006], [x, my, top + 0.0003], M.matLine);
  for (let y = my - md / 2 + 0.06; y < my + md / 2; y += 0.1) b.box([mw, 0.006, 0.0006], [mx, y, top + 0.0003], M.matLine);
  // bench clutter: mug, pencil cup, books, ruler, screws, a plant
  b.cyl(0.045, 0.1, [1.38, -0.02, BENCH_Z + 0.05], M.mug, [0, 0, 0], undefined, 32);
  b.cyl(0.04, 0.005, [1.38, -0.02, BENCH_Z + 0.092], { color: '#3B2416', rough: 0.15 });
  b.cyl(0.035, 0.11, [1.3, 0.32, BENCH_Z + 0.055], { color: '#3355FF', rough: 0.4, detail: W.peel });
  for (let i = 0; i < 5; i++) {
    b.cyl(0.004, 0.18, [1.3 + (R() - 0.5) * 0.03, 0.32 + (R() - 0.5) * 0.03, BENCH_Z + 0.14], { color: ['#FFB020', '#FF5B2E', '#2FD6FF', '#C6FF3A'][Math.floor(R() * 4)]!, rough: 0.5 }, [(R() - 0.5) * 28, (R() - 0.5) * 28, 0], undefined, 6);
  }
  let zz = BENCH_Z + 0.02;
  for (const [c, h] of [['#8E3B2F', 0.035], ['#2F5D7E', 0.03], ['#C9A04A', 0.04]] as const) {
    b.box([0.24, 0.17, h], [1.3, -0.34, zz + h / 2], { color: c, rough: 0.7, detail: W.paper }, [0, 0, (R() - 0.5) * 24]);
    zz += h;
  }
  b.box([0.5, 0.035, 0.004], [0.2, -0.47, BENCH_Z + 0.002], { color: '#D7A86E', rough: 0.4, detail: W.woodX }, [0, 0, 4]);
  for (let i = 0; i < 6; i++) b.cyl(0.004, 0.02, [-0.95 + (R() - 0.5) * 0.2, -0.45 + (R() - 0.5) * 0.06, BENCH_Z + 0.004], M.steel, [90, 0, R() * 170], undefined, 8);
  plant(b, R, [-1.3, 0.35, BENCH_Z], 0.07, 0.3);
}

/** Pendant lamp positions (Blender) — the practicals in sets.ts sit just below the bulbs. */
export const TINKER_LAMPS: readonly B3[] = [[-0.35, 0.05, 2.0], [0.95, 0.15, 2.05], [2.6, 0.6, 2.2]];

function lamps(b: SetBuilder): void {
  for (const [x, y, z] of TINKER_LAMPS) {
    b.cyl(0.004, 3.25 - z, [x, y, (3.25 + z) / 2 + 0.12], M.cord, [0, 0, 0], undefined, 8);
    // the shade's wide rim hangs down (Blender cone: radius1 at the bottom)
    b.cyl(0.2, 0.18, [x, y, z], M.shade, [0, 0, 0], 0.05, 48);
    b.cyl(0.195, 0.17, [x, y, z - 0.004], M.shadeIn, [0, 0, 0], 0.045, 48);
    b.sphere(0.045, [x, y, z - 0.07], M.bulb);
  }
}

/** The procedural stand-in set: one opaque mesh (engine metres, the mat top at y = 0). */
export function tinkerStandIn(): Geometry {
  const b = new SetBuilder();
  const R = rng(7);
  room(b, R);
  shelves(b, R);
  bench(b, R);
  lamps(b);
  return b.build();
}

// ---- 5 × 7 stroke font ----------------------------------------------------------------------------------
const FONT: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'], K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'], M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'], O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'], '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'], '·': ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'],
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'], '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '≈': ['.....', '.##.#', '#.##.', '.....', '.##.#', '#.##.', '.....'], 'Δ': ['.....', '..#..', '.#.#.', '.#.#.', '#...#', '#...#', '#####'],
  '⌀': ['.....', '.###.', '#..##', '#.#.#', '##..#', '.###.', '.....'],
};
