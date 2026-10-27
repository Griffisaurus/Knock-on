// W5 (M5): ORBITAL HANGAR and MOON BASE stand-ins (environments.md §5, §6). Until stream E5c's glbs land, each set is
// built procedurally from the brief's layout tables and W5's stand-in colliders (parts-data env_space.ts), in engine space
// (metres, Y-up, front +Z), per preset: the Hangar bays (deck, white panel walls with graphite ribs, the window onto black
// space with stars and Earth, ceiling light strips, the shuttle on amber clamps, gantry, airlocks, cargo, the zero-g floor
// rings) and the Moon (the regolith heightfield, the sintered apron, dome, lander, rover, solar arrays, antenna, boulders,
// the distant highlands, Earth low on the horizon and a star field on a black sky).
// Friendly toy-product language: rounded-ish blocks, chunky clamps, no grime (brief "Don'ts").

import { HANGAR_SET, MOON_CRATERS, MOON_SET, moonField, spacePreset, spaceTerrainHeight, type SpaceTerrain } from '@knockon/parts-data';
import { box as unitBox, cylinder as unitCyl, sphere as unitSphere, type Geometry } from '../meshes.ts';
import { DETAIL } from './wgsl.ts';

type V3 = readonly [number, number, number];

const lin = (h: string): [number, number, number] => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
};

interface Mat { readonly color: string; readonly rough?: number; readonly metal?: number; readonly emit?: number; readonly detail?: number }

/** Deterministic RNG (mulberry32): the same dressing every load. */
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

const BOX = unitBox();
const SPHERE = unitSphere(24, 16);
const LOWSPHERE = unitSphere(10, 7);
const CYL = unitCyl(32);

/** Engine-space set builder: unit primitives scaled, rotated (yaw, then pitch about x) and placed. */
class Builder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly mat: number[] = [];
  private readonly idx: number[] = [];

  private vertex(p: V3, n: V3, m: Mat, tint?: readonly number[]): void {
    const c = tint ?? lin(m.color);
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0]!, c[1]!, c[2]!, 1);
    this.mat.push(m.rough ?? 0.5, m.metal ?? 0, Math.min(1, (m.emit ?? 0) / 12), (255 - (m.detail ?? 0)) / 255);
  }

  add(g: Geometry, size: V3, at: V3, m: Mat, yawDeg = 0, pitchDeg = 0): void {
    const cy = Math.cos((yawDeg * Math.PI) / 180), sy = Math.sin((yawDeg * Math.PI) / 180);
    const cp = Math.cos((pitchDeg * Math.PI) / 180), sp = Math.sin((pitchDeg * Math.PI) / 180);
    const rot = (x: number, y: number, z: number): V3 => {
      const y1 = y * cp - z * sp, z1 = y * sp + z * cp; // pitch about x
      return [x * cy + z1 * sy, y1, -x * sy + z1 * cy]; // then yaw about y
    };
    const base = this.pos.length / 3;
    const n = g.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const p = rot(g.positions[i * 3]! * size[0], g.positions[i * 3 + 1]! * size[1], g.positions[i * 3 + 2]! * size[2]);
      let q = rot(g.normals[i * 3]! / size[0], g.normals[i * 3 + 1]! / size[1], g.normals[i * 3 + 2]! / size[2]);
      const l = Math.hypot(q[0], q[1], q[2]) || 1;
      q = [q[0] / l, q[1] / l, q[2] / l];
      this.vertex([p[0] + at[0], p[1] + at[1], p[2] + at[2]], q, m);
    }
    for (const k of g.indices) this.idx.push(base + k);
  }

  box(size: V3, at: V3, m: Mat, yaw = 0, pitch = 0): void { this.add(BOX, size, at, m, yaw, pitch); }
  /** Vertical cylinder: radius, height, base centre. */
  cyl(r: number, h: number, base: V3, m: Mat): void { this.add(CYL, [2 * r, h, 2 * r], [base[0], base[1] + h / 2, base[2]], m); }
  sphere(r: number, at: V3, m: Mat, squash: V3 = [1, 1, 1], low = false): void { this.add(low ? LOWSPHERE : SPHERE, [2 * r * squash[0], 2 * r * squash[1], 2 * r * squash[2]], at, m); }

  /** A flat ring (annulus) facing up at height y. */
  ring(c: V3, r0: number, r1: number, m: Mat, seg = 64): void {
    const base = this.pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
      this.vertex([c[0] + x * r0, c[1], c[2] + z * r0], [0, 1, 0], m);
      this.vertex([c[0] + x * r1, c[1], c[2] + z * r1], [0, 1, 0], m);
    }
    for (let s = 0; s < seg; s++) { const a = base + s * 2; this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }

  /** A heightfield as a grid (every `step` samples), coloured per vertex. */
  terrain(t: SpaceTerrain, step: number, m: Mat, color: (x: number, z: number, y: number, slope: number) => readonly number[]): void {
    const n = Math.floor((t.nx - 1) / step) + 1;
    const base = this.pos.length / 3;
    const h = (ix: number, iz: number): number => t.heights[Math.min(t.nz - 1, Math.max(0, iz)) * t.nx + Math.min(t.nx - 1, Math.max(0, ix))]! * t.maxHeight / 65535;
    const span = step * 0.5;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const sx = x * step, sz = z * step;
      const y = h(sx, sz);
      const nx = h(sx - step, sz) - h(sx + step, sz), nz = h(sx, sz - step) - h(sx, sz + step), ny = 2 * span;
      const l = Math.hypot(nx, ny, nz);
      const wx = t.origin[0] + sx * 0.5, wz = t.origin[1] + sz * 0.5;
      this.vertex([wx, y, wz], [nx / l, ny / l, nz / l], m, color(wx, wz, y, 1 - ny / l));
    }
    for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
      const a = base + z * n + x, b = a + 1, c = a + n, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
  }

  build(): Geometry {
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), indices: new Uint32Array(this.idx),
      colors: new Float32Array(this.col), mats: new Float32Array(this.mat), uvs: new Float32Array((this.pos.length / 3) * 2),
    };
  }
}

// ---- palette (ART_BIBLE powders; environments.md §5.2, §6.2–6.3) -------------------------------------------------------
const M = {
  panel: { color: '#EEF1F6', rough: 0.55 },
  panelLine: { color: '#C8CDD6', rough: 0.6 },
  deck: { color: '#B9BEC6', rough: 0.7, detail: DETAIL.pitting },
  deckSeam: { color: '#8E949D', rough: 0.7 },
  graphite: { color: '#2B2E35', rough: 0.5 },
  cobalt: { color: '#2F5BD3', rough: 0.45 },
  bone: { color: '#E8E2D4', rough: 0.5 },
  ignition: { color: '#FF5B2E', rough: 0.45 },
  amber: { color: '#FFB000', rough: 0.45 },
  steel: { color: '#B8BCC2', rough: 0.3, metal: 1, detail: DETAIL.brushed },
  chrome: { color: '#E6E8EB', rough: 0.12, metal: 1 },
  hazard: { color: '#FFB000', rough: 0.5 },
  space: { color: '#000000', rough: 1 },
  star: { color: '#FFFFFF', emit: 10 },
  strip: { color: '#EAF2FF', emit: 12 },
  sconce: { color: '#FFC27A', emit: 9 },
  screen: { color: '#3FE0D0', emit: 5 },
  field: { color: '#FF3DAE', emit: 9 },
  cockpit: { color: '#1C3550', rough: 0.15, metal: 0.2 },
  ocean: { color: '#2E73C9', emit: 1.6, rough: 0.6 },
  land: { color: '#7DA35A', emit: 1.2, rough: 0.8 },
  cloud: { color: '#F2EEE6', emit: 2, rough: 0.9 },
  regolith: { color: '#8C8A85', rough: 0.95 },
  sintered: { color: '#9A968E', rough: 0.8 },
  rock: { color: '#6F6C67', rough: 0.9 },
  foil: { color: '#C9A227', rough: 0.25, metal: 1 },
  domeWin: { color: '#FFB45A', emit: 6 },
  cells: { color: '#1F3F9E', rough: 0.2, metal: 0.4 },
  rubber: { color: '#26282C', rough: 0.85, detail: DETAIL.rubber },
} as const;

/** Earth: a sphere with oceans, a few land masses and cloud bands (stylised, emissive enough to read against space). */
function earth(b: Builder, c: V3, r: number): void {
  b.sphere(r, c, M.ocean);
  const R = rng(42);
  for (let i = 0; i < 9; i++) {
    const th = R() * Math.PI * 2, ph = (R() - 0.5) * 2.2;
    const d: V3 = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)];
    b.sphere(r * (0.22 + 0.2 * R()), [c[0] + d[0] * r * 0.86, c[1] + d[1] * r * 0.86, c[2] + d[2] * r * 0.86], M.land, [1, 0.5, 1], true);
  }
  b.sphere(r * 1.015, c, { ...M.cloud, emit: 0.6 }, [1, 0.12, 1]);
}

/** Stars on a far shell (none below `minY`). */
function stars(b: Builder, n: number, r: number, size: number, minY: number, seed: number): void {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d: V3 = [s * Math.cos(th), u, s * Math.sin(th)];
    if (d[1] * r < minY) continue;
    const k = size * (0.5 + R());
    b.box([k, k, k], [d[0] * r, d[1] * r, d[2] * r], { ...M.star, emit: 6 + 6 * R() });
  }
}

// ---- ORBITAL HANGAR ------------------------------------------------------------------------------------------------------

function hangar(preset: string): Geometry {
  const p = spacePreset(HANGAR_SET, preset) ?? HANGAR_SET.presets.warehouse!;
  const big = preset === 'arena';
  const w = big ? 128 : 32, ceil = big ? 68 : 26;
  const win = big ? { half: 110, y0: 6, y1: 56, cols: 8, rows: 3 } : { half: 28, y0: 3, y1: 21, cols: 4, rows: 2 };
  const b = new Builder();
  // deck: light grey anti-slip tiles (4 m), seams, hazard stripes at the walls
  b.box([2 * w + 2, 0.1, 2 * w + 2], [0, -0.05, 0], M.deck);
  for (let x = -w; x <= w; x += 4) b.box([0.06, 0.012, 2 * w], [x, 0.004, 0], M.deckSeam);
  for (let z = -w; z <= w; z += 4) b.box([2 * w, 0.012, 0.06], [0, 0.004, z], M.deckSeam);
  // walls: white 4 m panels with graphite ribs every 8 m and a cobalt accent band
  const wall = (len: number, at: V3, yaw: number): void => {
    b.box([len, ceil, 0.4], at, M.panel, yaw);
    for (let s = -len / 2; s <= len / 2 + 0.01; s += 8) {
      const ox = Math.cos((yaw * Math.PI) / 180) * s, oz = -Math.sin((yaw * Math.PI) / 180) * s;
      b.box([0.9, ceil, 0.7], [at[0] + ox, ceil / 2, at[2] + oz], M.graphite, yaw);
    }
    for (let y = 4; y < ceil; y += 4) b.box([len, 0.05, 0.42], [at[0], y, at[2]], M.panelLine, yaw);
    b.box([len, 0.5, 0.45], [at[0], 2.2, at[2]], M.cobalt, yaw);
  };
  wall(2 * w + 2, [-w - 0.7, ceil / 2, 0], 90);
  wall(2 * w + 2, [w + 0.7, ceil / 2, 0], 90);
  // back wall around the window (+Y in Blender = engine −Z) and the window frame, 4 × 2 (8 × 3) mullions
  const bz = -w - 0.7;
  b.box([2 * w + 2, win.y0, 0.4], [0, win.y0 / 2, bz], M.panel);
  b.box([2 * w + 2, ceil - win.y1, 0.4], [0, (win.y1 + ceil) / 2, bz], M.panel);
  const side = (w + 1 - win.half);
  b.box([side, win.y1 - win.y0, 0.4], [-(w + 1 + win.half) / 2, (win.y0 + win.y1) / 2, bz], M.panel);
  b.box([side, win.y1 - win.y0, 0.4], [(w + 1 + win.half) / 2, (win.y0 + win.y1) / 2, bz], M.panel);
  for (let i = 0; i <= win.cols; i++) b.box([0.6, win.y1 - win.y0, 0.8], [-win.half + (2 * win.half * i) / win.cols, (win.y0 + win.y1) / 2, bz], M.graphite);
  for (let j = 0; j <= win.rows; j++) b.box([2 * win.half, 0.6, 0.8], [0, win.y0 + ((win.y1 - win.y0) * j) / win.rows, bz], M.graphite);
  // outside: black space, a sparse star field, Earth filling the lower 40 % of the window. Laid out just behind the glass,
  // then pushed away from the default camera ×k (same view, far outside the sun's shadow range, so nothing blocks the sun)
  const cam = p.camera, k = big ? 3 : 4;
  const far = (q: V3): V3 => [cam[0] + (q[0] - cam[0]) * k, cam[1] + (q[1] - cam[1]) * k, cam[2] + (q[2] - cam[2]) * k];
  const out = bz - (big ? 260 : 90);
  b.box([win.half * 8 * k, (win.y1 - win.y0) * 6 * k, 1], far([0, (win.y0 + win.y1) / 2, out - 40]), M.space);
  const R = rng(big ? 11 : 7);
  for (let i = 0; i < (big ? 260 : 120); i++) {
    const x = (R() * 2 - 1) * win.half * 3, y = win.y0 - 20 + R() * (win.y1 - win.y0 + 60);
    const sz = (big ? 0.5 : 0.18) * (0.6 + R()) * k;
    b.box([sz, sz, sz], far([x, y, out - 38]), { ...M.star, emit: 5 + 6 * R() });
  }
  const er = (win.y1 - win.y0) * 1.6;
  earth(b, far([win.half * 0.25, win.y0 + (win.y1 - win.y0) * 0.4 - er, out + er * 0.2]), er * k);
  // ceiling: panels with clustered 8 m light strips
  b.box([2 * w + 2, 0.5, 2 * w + 2], [0, ceil + 0.25, 0], M.panel);
  for (let x = -w + 4; x < w; x += 8) for (let z = -w + 6; z < w; z += 12) b.box([0.5, 0.15, 8], [x, ceil - 0.08, z], M.strip);
  // airlocks (left, right; Arena: one per wall) with amber / graphite hazard frames, status screens and warm sconces
  const airlock = (at: V3, yaw: number): void => {
    b.box([5.6, 6.6, 0.5], [at[0], 3.3, at[2]], M.graphite, yaw);
    b.box([4.6, 5.8, 0.6], [at[0], 2.9, at[2]], M.steel, yaw);
    for (let k = 0; k < 6; k++) b.box([0.5, 0.5, 0.62], [at[0] + Math.cos((yaw * Math.PI) / 180) * (-2.6 + k * 1.04), 6.4, at[2] - Math.sin((yaw * Math.PI) / 180) * (-2.6 + k * 1.04)], k % 2 ? M.graphite : M.hazard, yaw);
    b.box([1, 0.6, 0.65], [at[0] + Math.cos((yaw * Math.PI) / 180) * 3.6, 3.2, at[2] - Math.sin((yaw * Math.PI) / 180) * 3.6], M.screen, yaw);
    b.box([0.5, 0.5, 0.7], [at[0] + Math.cos((yaw * Math.PI) / 180) * -3.6, 5.2, at[2] - Math.sin((yaw * Math.PI) / 180) * -3.6], M.sconce, yaw);
  };
  if (big) { airlock([-w, 0, 0], 90); airlock([w, 0, 0], 90); airlock([60, 0, -w], 0); } else { airlock([-w, 0, 10], 90); airlock([w, 0, 10], 90); }
  // wall screens ×6
  for (let i = 0; i < 6; i++) b.box([0.3, 1.2 * (big ? 2 : 1), 2 * (big ? 2 : 1)], [(i % 2 ? 1 : -1) * (w + 0.4), big ? 12 : 5, -w * 0.6 + i * w * 0.25], M.screen);
  // gantry crane rail(s) with a hook
  for (const z of big ? [0, -60] : [-6]) {
    const y = big ? 62 : 22;
    b.box([2 * w, big ? 1.2 : 0.8, big ? 1.2 : 0.8], [0, y, z], M.cobalt);
    b.box([big ? 6 : 3, big ? 2 : 1.2, big ? 3 : 1.6], [big ? -20 : 6, y - 1, z], M.cobalt);
    b.box([0.08, big ? 14 : 6, 0.08], [big ? -20 : 6, y - (big ? 8 : 4), z], M.chrome);
    b.sphere(big ? 1 : 0.45, [big ? -20 : 6, y - (big ? 15 : 7.2), z], M.amber);
  }
  // shuttles on their docking clamps (nose toward +Z), and cargo containers, tool cart: from the colliders
  for (const bx of p.boxes) {
    const n = bx.name;
    const size: V3 = [bx.half[0] * 2, bx.half[1] * 2, bx.half[2] * 2];
    if (/_fuselage$/.test(n)) {
      b.add(CYL, [size[0], size[2], size[1]], bx.center, M.bone, 0, 90);
      b.box([size[0] * 0.25, size[1] * 0.12, size[2] * 1.001], [bx.center[0], bx.center[1] + bx.half[1] * 0.25, bx.center[2]], M.ignition);
      b.add(CYL, [size[0] * 0.35, 1.4 * (size[1] / 3.2), size[1] * 0.35], [bx.center[0] - bx.half[0] * 0.45, bx.center[1] - bx.half[1] * 0.2, bx.center[2] - bx.half[2] - 0.5], M.graphite, 0, 90);
      b.add(CYL, [size[0] * 0.35, 1.4 * (size[1] / 3.2), size[1] * 0.35], [bx.center[0] + bx.half[0] * 0.45, bx.center[1] - bx.half[1] * 0.2, bx.center[2] - bx.half[2] - 0.5], M.graphite, 0, 90);
    } else if (/_nose$/.test(n)) {
      b.sphere(bx.half[0], bx.center, M.bone, [1, bx.half[1] / bx.half[0], 1.4]);
      b.sphere(bx.half[0] * 0.75, [bx.center[0], bx.center[1] + bx.half[1] * 0.5, bx.center[2] - bx.half[2] * 0.6], M.cockpit, [1, 0.5, 1.2]);
    } else if (/_wings$/.test(n)) b.box(size, bx.center, M.bone);
    else if (/_fin$/.test(n)) b.box(size, bx.center, M.ignition);
    else if (/_clamp_/.test(n)) { b.box(size, bx.center, M.amber); b.box([size[0] * 0.5, 0.15, size[2] * 1.1], [bx.center[0], bx.center[1] + bx.half[1] + 0.06, bx.center[2]], M.steel); }
    else if (/^cargo_/.test(n)) {
      const k = (Math.round(bx.center[0] * 7 + bx.center[1] * 3 + bx.center[2]) % 3 + 3) % 3;
      b.box([size[0] * 0.98, size[1] * 0.98, size[2] * 0.98], bx.center, [M.bone, M.cobalt, M.ignition][k]!);
      for (const dz of [-0.5, 0.5]) b.box([size[0], size[1] * 0.06, 0.08], [bx.center[0], bx.center[1] + bx.half[1] * 0.7, bx.center[2] + dz * size[2] * 0.96], M.graphite);
    } else if (n === 'tool_cart') { b.box(size, bx.center, M.graphite); for (const dx of [-0.45, 0.45]) b.cyl(0.12, 0.08, [bx.center[0] + dx, 0, bx.center[2]], M.rubber); }
    else if (n === 'scale_plinth') { b.box(size, bx.center, M.graphite); b.box([size[0] * 0.9, 0.01, size[2] * 0.9], [bx.center[0], bx.center[1] + bx.half[1], bx.center[2]], M.bone); }
    else if (n === 'scale_stick') {
      for (let k = 0; k < 10; k++) b.box([size[0], 0.1, size[2]], [bx.center[0], bx.center[1] - bx.half[1] + 0.05 + k * 0.1, bx.center[2]], k === 4 ? M.ignition : k % 2 ? M.graphite : M.bone);
    } else if (n === 'scale_foot') b.box(size, bx.center, M.graphite);
  }
  for (const s of p.spheres) if (s.name === 'scale_thud') b.sphere(s.radius, s.center, M.graphite);
  // the zero-g floor rings: a brushed collar and the Field-colour LED ring, a clear cover, hazard stripes around them
  for (const z of p.zones ?? []) {
    const c: V3 = [z.center[0], 0.012, z.center[2]];
    b.ring(c, z.radius - 0.6, z.radius + 0.25, M.steel);
    b.ring([c[0], 0.02, c[2]], z.radius - 0.35, z.radius, M.field);
    b.ring([c[0], 0.016, c[2]], z.radius + 0.6, z.radius + 1.2, M.hazard, 48);
    // the warm sconce pairs at the docking clamps and airlocks are lamps in the look; here, small emissive housings
  }
  return b.build();
}

// ---- MOON BASE -----------------------------------------------------------------------------------------------------------

/** Regolith colour with a little large-scale variation, the sintered apron inside 24 m, and darker crater floors. */
function regolithColor(x: number, z: number, y: number, slope: number): readonly number[] {
  const r = Math.hypot(x, z);
  const base = lin(r <= 24 ? M.sintered.color : M.regolith.color);
  const n = 0.92 + 0.08 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06 - x * 0.02);
  let k = n * (1 - 0.12 * Math.min(1, slope * 3));
  for (const c of MOON_CRATERS) if (Math.hypot(x - c.x, z - c.z) < c.r * 0.7) k *= 0.9;
  if (r <= 24 && (Math.abs((x % 2 + 2) % 2 - 1) > 0.985 || Math.abs((z % 2 + 2) % 2 - 1) > 0.985)) k *= 0.85; // 2 m tile seams
  void y;
  return base.map((v) => v * k);
}

function moon(preset: string): Geometry {
  const p = spacePreset(MOON_SET, preset) ?? MOON_SET.presets.room!;
  const b = new Builder();
  // the regolith: the whole 256 m Arena field for every preset (Room and Warehouse use its central window in the sim),
  // 1 m vertices; a far regolith plain out to the highlands; the apron's tie-down rings every 8 m
  const field = moonField('arena')!;
  b.terrain(field, 2, M.regolith, regolithColor);
  b.ring([0, -0.05, 0], 127, 1500, M.regolith, 128); // under the field's corners, the plain beyond its edges
  for (let x = -16; x <= 16; x += 8) for (let z = -16; z <= 16; z += 8) if (Math.hypot(x, z) < 22 && (x || z)) b.ring([x, 0.006, z], 0.18, 0.3, M.graphite, 16);
  const g = (x: number, z: number): number => spaceTerrainHeight(field, x, z);
  // habitat dome (0, −40): white segments, a band of warm windows, graphite base ring
  b.sphere(15, [0, g(0, -40), -40], M.panel, [1, 1, 1]);
  b.cyl(15.3, 0.8, [0, g(0, -40) - 0.2, -40], M.graphite);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box([2.2, 1.2, 0.3], [Math.cos(a) * 13.6, g(0, -40) + 5.5, -40 + Math.sin(a) * 13.6], M.domeWin, (-a * 180) / Math.PI + 90);
  }
  // lander (−22, −18): gold-foil descent stage, bone ascent stage, steel legs and pads
  const lg = g(-22, -18);
  b.box([5.2, 2.8, 5.2], [-22, lg + 4.6, -18], M.foil);
  b.box([3.6, 3.6, 3.6], [-22, lg + 7.8, -18], M.bone);
  b.box([1.4, 1, 0.2], [-22, lg + 8.6, -16.2], M.cockpit);
  b.add(CYL, [1.6, 1.6, 1.6], [-22, lg + 2.8, -18], M.graphite);
  for (const [dx, dz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]] as const) {
    b.box([0.4, 4.4, 0.4], [-22 + dx, lg + 2, -18 + dz], M.steel);
    b.cyl(0.6, 0.15, [-22 + dx, lg, -18 + dz], M.steel);
  }
  // rover (20, −6) on the apron: bone body, ignition fenders, six wheels, a mast camera
  b.box([2.6, 0.9, 4.2], [20, 1.15, -6], M.bone);
  b.box([2.8, 0.15, 4.4], [20, 1.62, -6], M.ignition);
  for (const dz of [-1.5, 0, 1.5]) for (const dx of [-1.45, 1.45]) b.add(CYL, [0.8, 0.35, 0.8], [20 + dx, 0.4, -6 + dz], M.rubber, 90, 90); // axle along x
  b.box([0.12, 1.4, 0.12], [20.8, 2.2, -7.6], M.graphite);
  b.box([0.5, 0.3, 0.3], [20.8, 2.95, -7.6], M.graphite);
  // supply crates
  b.box([1.2, 1.2, 1.2], [-16.5, 0.6, -12.5], M.bone);
  b.box([0.8, 0.8, 0.8], [-15.4, 0.4, -13.2], M.graphite);
  // solar arrays ×3, antenna mast with the amber beacon, the KNOCK-ON pennant
  for (const x of [40, 55, 70]) {
    const y = g(x, -40);
    b.box([10, 0.16, 5], [x, y + 4.2, -40], M.cells, 0, -20);
    b.box([10.3, 0.1, 0.2], [x, y + 4.2, -42.5], M.steel, 0, -20);
    b.box([0.3, 4.4, 0.3], [x, y + 2, -40], M.steel);
  }
  const ay = g(-60, -60);
  b.box([0.8, 27, 0.8], [-60, ay + 13.5, -60], M.bone);
  b.sphere(0.7, [-60, ay + 27.4, -60], { ...M.amber, emit: 8 });
  b.box([0.06, 3, 0.06], [6, 1.5, -21], M.graphite);
  b.box([1.2, 0.7, 0.03], [6.6, 2.6, -21], M.ignition);
  // the scale reference
  for (const bx of p.boxes) {
    const size: V3 = [bx.half[0] * 2, bx.half[1] * 2, bx.half[2] * 2];
    if (bx.name === 'scale_plinth' || bx.name === 'scale_foot') b.box(size, bx.center, M.graphite);
    else if (bx.name === 'scale_stick') for (let k = 0; k < 10; k++) b.box([size[0], 0.1, size[2]], [bx.center[0], bx.center[1] - bx.half[1] + 0.05 + k * 0.1, bx.center[2]], k === 4 ? M.ignition : k % 2 ? M.graphite : M.bone);
  }
  for (const s of p.spheres) if (s.name === 'scale_thud') b.sphere(s.radius, s.center, M.graphite);
  // boulders (4 shapes × 3 sizes), never on the apron or the neutral zones
  const R = rng(3);
  for (let i = 0; i < 420; i++) {
    const x = (R() * 2 - 1) * 126, z = (R() * 2 - 1) * 126;
    if (Math.hypot(x, z) < 34 || (Math.abs(x) < 26 && z > -22 && z < 30)) { R(); R(); continue; }
    const s = [0.4, 1.2, 3][R() < 0.7 ? 0 : R() < 0.8 ? 1 : 2]! * (0.7 + 0.6 * R());
    b.sphere(s / 2, [x, g(x, z) + s * 0.15, z], M.rock, [1 + R() * 0.4, 0.6 + R() * 0.3, 1 + R() * 0.3], true);
  }
  // distant highlands (crisp, no haze), Earth 12° up and 25° right of the default view, stars on the black sky
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + R() * 0.1, d = 1350 + R() * 350, h = 40 + R() * 90;
    b.add(LOWSPHERE, [200 + R() * 200, h * 2, 150 + R() * 150], [Math.cos(a) * d, -h * 0.3, Math.sin(a) * d], M.rock, (-a * 180) / Math.PI);
  }
  const ed = 1500, er = ed * Math.tan(Math.PI / 180); // apparent Ø 2°
  const dir: V3 = [Math.sin((25 * Math.PI) / 180) * Math.cos((12 * Math.PI) / 180), Math.sin((12 * Math.PI) / 180), -Math.cos((25 * Math.PI) / 180) * Math.cos((12 * Math.PI) / 180)];
  earth(b, [dir[0] * ed, dir[1] * ed + 30, dir[2] * ed], er);
  stars(b, 900, 1700, 3.2, 40, 9);
  return b.build();
}

/** The stand-in set for an environment and preset (engine space; drawn at offset 0). */
export function spaceStandIn(id: 'hangar' | 'moon', preset: string): Geometry {
  return id === 'hangar' ? hangar(preset) : moon(preset);
}
