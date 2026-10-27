// M3 THE TINKER LAB (stream E3b, contract 2): the generated collider / zone / camera / light data
// (packages/parts-data/src/env_tinker.ts) against the exported set (assets/build/env/tinker/tinker.glb) and
// environments.md §0 / §3 (D82: real scale, key light from behind-right). Skips the glb checks with a message when
// the build is missing (`node tools/assets.mjs --env-tinker`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TINKER, type TinkerBox, type TinkerPreset } from '../../parts-data/src/env_tinker.ts';
import { lodStats, parseGlb, type ParsedGlb } from '../src/index.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'env', 'tinker');
const GLB = join(DIR, 'tinker.glb');
const glb: ParsedGlb | null = existsSync(GLB) ? parseGlb(readFileSync(GLB)) : null;
const presets: [string, TinkerPreset][] = Object.entries(TINKER.presets);
const PHYS = ['powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric'];

function overlaps(b: TinkerBox, min: readonly number[], max: readonly number[], eps = 1e-6): boolean {
  for (let i = 0; i < 3; i++) {
    if (b.center[i]! + b.half[i]! <= min[i]! + eps || b.center[i]! - b.half[i]! >= max[i]! - eps) return false;
  }
  return true;
}

const elevation = (pos: readonly number[], tgt: readonly number[]) => {
  const d = pos.map((c, i) => c - tgt[i]!);
  return Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180 / Math.PI;
};

describe('Tinker Lab data (env_tinker.ts)', () => {
  it('is the default-set shape: Desk + Room at the GAME_SPEC §5.3 sizes, real scale, Earth gravity', () => {
    expect(TINKER.env).toBe('tinker');
    expect(TINKER.scale).toBe(1);
    expect(TINKER.gravity).toBe('earth');
    const size = (p: TinkerPreset) => p.bounds.max.map((v, i) => +(v - p.bounds.min[i]!).toFixed(4));
    expect(size(TINKER.presets.desk)).toEqual([4, 3, 3]);
    expect(size(TINKER.presets.room)).toEqual([16, 8, 16]);
    expect(TINKER.presets.room.origin).toEqual([0, 0, 0]);
    // the Desk world origin is the cutting-mat top centre (set (0, 6.43, 0.904))
    expect(TINKER.presets.desk.origin).toEqual([0, 0.904, -6.43]);
  });

  for (const [name, p] of presets) {
    it(`${name}: colliders are valid boxes / spheres with known physics materials`, () => {
      expect(p.boxes.length).toBeGreaterThan(100);
      for (const b of p.boxes) {
        for (const h of b.half) expect(h).toBeGreaterThanOrEqual(0.0025); // nothing thinner than 5 mm (§0.6)
        expect(PHYS).toContain(b.phys);
      }
      for (const s of p.spheres) expect(PHYS).toContain(s.phys);
      expect(new Set(p.boxes.map((b) => b.name)).size).toBe(p.boxes.length);
      const floor = p.boxes.find((b) => b.name === 'floor')!;
      expect(floor.phys).toBe('wood');
      expect(floor.center[1] + floor.half[1]).toBeCloseTo(-p.origin[1], 6);
    });

    it(`${name}: the build zone is level, inside the bounds and free of colliders (§0.9, §0.10)`, () => {
      const z = p.neutral;
      expect(z.min[1]).toBeCloseTo(z.max[1], 6);
      expect(z.min[1]).toBeCloseTo(0, 6); // the zone is the preset floor
      if (name === 'room') {
        expect(z.max[0] - z.min[0]).toBeGreaterThanOrEqual(8);
        expect(z.max[2] - z.min[2]).toBeGreaterThanOrEqual(8);
      } else {
        expect(z.max[0] - z.min[0]).toBeCloseTo(2.3, 4); // the key-art cutting mat (D82)
        expect(z.max[2] - z.min[2]).toBeCloseTo(0.82, 4);
      }
      for (const i of [0, 2]) {
        expect(z.min[i]).toBeGreaterThanOrEqual(p.bounds.min[i]!);
        expect(z.max[i]).toBeLessThanOrEqual(p.bounds.max[i]!);
      }
      const vol = { min: [z.min[0], 0, z.min[2]], max: [z.max[0], p.bounds.max[1], z.max[2]] };
      expect(p.boxes.filter((b) => overlaps(b, vol.min, vol.max)).map((b) => b.name)).toEqual([]);
      expect(p.spheres.filter((s) => s.center.every((c, i) => c >= vol.min[i]! - s.radius && c <= vol.max[i]! + s.radius))
        .map((s) => s.name)).toEqual([]);
      // the ambient MOCHI sleeps off the zone
      const m = p.mochi.capsule;
      const r = m.radius + m.halfHeight;
      expect(m.center[0] + r <= z.min[0] || m.center[0] - r >= z.max[0] ||
        m.center[2] + r <= z.min[2] || m.center[2] - r >= z.max[2]).toBe(true);
    });

    it(`${name}: cameras, drones and the scale reference sit where the brief puts them`, () => {
      const inside = (v: readonly number[]) => v.every((c, i) => c >= p.bounds.min[i]! - 1e-6 && c <= p.bounds.max[i]! + 1e-6);
      expect(inside(p.target)).toBe(true);
      for (const d of p.drones) expect(d[1]).toBeGreaterThan(0), expect(d[2]).toBeGreaterThan(p.target[2]);
      expect(p.drones[0][0]).toBeLessThan(p.drones[1][0]);
      expect(Math.abs(elevation(p.camera, p.target) - (name === 'desk' ? 27 : 30))).toBeLessThan(1.5);
      expect(p.cameras.default.pos).toEqual(p.camera);
      const corner = [p.neutral.max[0], p.neutral.max[2]];
      expect(Math.hypot(p.scaleRef[0] - corner[0]!, p.scaleRef[2] - corner[1]!)).toBeLessThanOrEqual(6);
      const inZone = p.scaleRef[0] > p.neutral.min[0] && p.scaleRef[0] < p.neutral.max[0] &&
        p.scaleRef[2] > p.neutral.min[2] && p.scaleRef[2] < p.neutral.max[2];
      expect(inZone).toBe(false);
    });
  }

  it('the Desk hero camera is the key-art camera (render_tinker_lab.py hero view, 30 mm)', () => {
    const h = TINKER.presets.desk.cameras.hero;
    // key art (-0.45, -2.45, 1.78) -> set (+(-0.05, 6.45, 0)) -> Desk engine (x, z - 0.904, -(y - 6.43))
    expect(h.pos).toEqual([-0.5, 0.876, 2.43]);
    expect(h.target).toEqual([0.03, 0.176, -0.24]);
    expect(h.fovYDeg).toBeCloseTo(37.3, 1);
    expect(h.focusM).toBe(2.75);
    // the set is shared: the Room's hero camera is the same set point
    const r = TINKER.presets.room.cameras.hero, o = TINKER.presets.desk.origin;
    h.pos.forEach((c, i) => expect(c + o[i]!).toBeCloseTo(r.pos[i]!, 4));
  });

  it('the Room and Desk presets share one set (same colliders shifted by origin, own scale reference)', () => {
    const d = new Map(TINKER.presets.desk.boxes.filter((b) => !b.name.startsWith('scale_ref')).map((b) => [b.name, b]));
    const r = TINKER.presets.room.boxes.filter((b) => !b.name.startsWith('scale_ref'));
    expect(r.length).toBe(d.size);
    const o = TINKER.presets.desk.origin;
    for (const b of r) {
      const db = d.get(b.name)!;
      expect(db.half).toEqual(b.half);
      db.center.forEach((c, i) => expect(c + o[i]!).toBeCloseTo(b.center[i]!, 4));
    }
  });

  it('lights it from behind-right through the windows (D82): golden-hour sun, practicals, IBL + LUT names', () => {
    const [x, y, z] = TINKER.light.sunDir;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect(x).toBeLessThan(0); // travels toward -X: comes from the right
    expect(z).toBeGreaterThan(0); // travels toward the camera (+Z): comes from behind
    expect(y).toBeLessThan(0);
    expect(TINKER.light.sunElevationDeg).toBeGreaterThan(15);
    expect(TINKER.light.sunElevationDeg).toBeLessThan(30);
    expect(TINKER.light.sunKelvin).toBe(3500);
    expect(TINKER.ibl.name).toBe('ibl_tinker_lab');
    expect(TINKER.ibl.sh9).toHaveLength(9);
    expect(TINKER.ibl.sh9[0]!.every((c) => c > 0)).toBe(true);
    expect(TINKER.lut.name).toBe('lut_tinker_lab');
    expect(TINKER.presets.room.practicals.filter((l) => l.shadowed)).toHaveLength(1);
    for (const l of TINKER.presets.desk.practicals) {
      expect(l.kelvin).toBe(2700);
      expect(l.dir).toEqual([0, -1, 0]);
      expect(l.candela).toBeGreaterThan(100);
      expect(l.outerConeDeg).toBeGreaterThan(l.innerConeDeg);
    }
    // the three bench pendants at the key art's bulb positions (Desk engine coords)
    expect(TINKER.presets.desk.practicals.filter((l) => l.zone === 'bench').map((l) => l.pos)).toEqual(
      [[-0.4, 1.096, -0.07], [0.9, 1.146, -0.17], [2.55, 1.296, -0.62]]);
    expect(TINKER.presets.room.probes.length).toBeGreaterThanOrEqual(4);
  });
});

describe.skipIf(!glb)(`tinker.glb${glb ? '' : ' (no build: run `node tools/assets.mjs --env-tinker`)'}`, () => {
  it('has LOD0..LOD3 within the Room budget, a backdrop, both scale references and the probes', () => {
    const t = [0, 1, 2, 3].map((l) => lodStats(glb!, l).triangles);
    expect(t[0]).toBeGreaterThan(100000);
    expect(t[0]).toBeLessThan(380000); // environments.md §3 Room ≈ 380k
    for (let i = 1; i < 4; i++) expect(t[i]).toBeLessThan(t[i - 1]!);
    const names = new Set(glb!.nodes.map((n) => n.name));
    for (const n of ['BACKDROP', 'REF__scale__desk', 'REF__scale__room', 'PROBES']) expect(names.has(n)).toBe(true);
    for (const m of glb!.materials) expect(m.name).toMatch(/^kn_/);
    for (const prefix of [...TINKER.noShadow, ...TINKER.shadowOnly]) {
      expect(glb!.meshes.some((m) => m.nodeName.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it('chalk and print text faces the room (front caps toward +Z, not culled; the D79 side-by-side bug)', () => {
    for (const name of ['env_tinker__chalk', 'env_tinker__blueprint_ink', 'env_tinker__poster_ink']) {
      const m = glb!.meshes.find((x) => x.nodeName === name)!;
      expect(m, name).toBeDefined();
      let front = 0, back = 0;
      for (const pr of m.primitives) {
        const p = pr.positions, ix = pr.indices;
        for (let t = 0; t < ix.length; t += 3) {
          const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
          const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!;
          const nz = ux * vy - uy * vx; // z of the CCW face normal (unnormalised)
          if (nz > 1e-9) front += nz; else if (nz < -1e-9) back -= nz;
        }
      }
      expect(front, name).toBeGreaterThan(0);
      expect(front / back, name).toBeGreaterThan(0.8); // welded glyph shells: as much front cap as back
    }
  });

  it('positions and normals are finite', () => {
    let bad = 0;
    for (const m of glb!.meshes) for (const pr of m.primitives) {
      for (const v of pr.positions) if (!Number.isFinite(v)) bad++;
      if (pr.normals) for (const v of pr.normals) if (!Number.isFinite(v)) bad++;
    }
    expect(bad).toBe(0);
  });

  for (const [name, p] of presets) {
    it(`${name}: every collider sits on visible LOD0 geometry (render vertices on or in the box)`, () => {
      const verts: number[] = [];
      for (const m of glb!.meshes) {
        let q = glb!.nodes[m.node]!.parent, top = m.node;
        while (q !== -1) { top = q; q = glb!.nodes[q]!.parent; }
        const root = glb!.nodes[top]!.name;
        if (root !== 'LOD0' && root !== `REF__scale__${name}`) continue;
        if (m.nodeName.includes('__shadowonly')) continue;
        for (const pr of m.primitives) for (let i = 0; i < pr.positions.length; i++) verts.push(pr.positions[i]!);
      }
      const o = p.origin;
      const missing: string[] = [];
      for (const b of p.boxes) {
        const c = b.center.map((v, i) => v + o[i]!);
        const pad = 0.03;
        let hit = 0;
        for (let v = 0; v < verts.length && hit < 3; v += 3) {
          let ok = true;
          for (let i = 0; i < 3 && ok; i++) ok = Math.abs(verts[v + i]! - c[i]!) <= b.half[i]! + pad;
          if (ok) hit++;
        }
        if (hit < 3) missing.push(b.name);
      }
      expect(missing).toEqual([]);
    });
  }

  it('ships the baked IBL and the grading LUT as files', () => {
    const hdr = readFileSync(join(DIR, 'ibl_tinker_lab.hdr'));
    expect(hdr.subarray(0, 10).toString('latin1')).toMatch(/^#\?(RADIANCE|RGBE)/);
    const png = readFileSync(join(DIR, 'lut_tinker_lab.png'));
    expect(png.readUInt32BE(16)).toBe(1024); // 32^3 strip
    expect(png.readUInt32BE(20)).toBe(32);
    expect(TINKER.ibl.size).toEqual([2048, 1024]);
  });
});
