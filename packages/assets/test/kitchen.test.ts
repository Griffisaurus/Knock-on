// M2 Mega Kitchen (stream E2, contract 5): the generated collider / zone / spawn data
// (packages/parts-data/src/env_kitchen.ts) against the exported set (assets/build/env/kitchen/kitchen.glb) and
// environments.md §0 / §2. Skips with a message when the glb is missing (`node tools/assets.mjs --env kitchen`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KITCHEN, type KitchenBox, type KitchenPreset } from '../../parts-data/src/env_kitchen.ts';
import { lodStats, parseGlb, type ParsedGlb } from '../src/index.ts';

const GLB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'env', 'kitchen', 'kitchen.glb');
const glb: ParsedGlb | null = existsSync(GLB) ? parseGlb(readFileSync(GLB)) : null;
const presets: [string, KitchenPreset][] = Object.entries(KITCHEN.presets);

function overlaps(b: KitchenBox, min: readonly number[], max: readonly number[], eps = 1e-6): boolean {
  for (let i = 0; i < 3; i++) {
    if (b.center[i]! + b.half[i]! <= min[i]! + eps || b.center[i]! - b.half[i]! >= max[i]! - eps) return false;
  }
  return true;
}

describe('Mega Kitchen data (env_kitchen.ts)', () => {
  it('has the brief presets at the GAME_SPEC §5.3 sizes, Earth gravity, 5 : 1', () => {
    expect(KITCHEN.scale).toBe(5);
    expect(KITCHEN.gravity).toBe('earth');
    const size = (p: KitchenPreset) => p.bounds.max.map((v, i) => v - p.bounds.min[i]!);
    expect(size(KITCHEN.presets.room)).toEqual([16, 8, 16]);
    expect(size(KITCHEN.presets.warehouse)).toEqual([64, 24, 64]);
    expect(KITCHEN.presets.room.origin).toEqual([0, 0, -24]);
    expect(KITCHEN.presets.warehouse.origin).toEqual([0, 0, 0]);
  });

  for (const [name, p] of presets) {
    it(`${name}: colliders are valid boxes with known physics materials, floor top at y = 0`, () => {
      expect(p.boxes.length).toBeGreaterThan(100);
      for (const b of p.boxes) {
        for (const h of b.half) expect(h).toBeGreaterThanOrEqual(0.0025); // nothing thinner than 5 mm (§0.6)
        expect(['powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric']).toContain(b.phys);
      }
      const floor = p.boxes.find((b) => b.name === 'floor')!;
      expect(floor.phys).toBe('ceramic');
      expect(floor.center[1] + floor.half[1]).toBeCloseTo(0, 6);
      expect(new Set(p.boxes.map((b) => b.name)).size).toBe(p.boxes.length);
    });

    it(`${name}: the neutral zone is >= 8 x 8 m, inside the bounds and free of colliders (§0.9)`, () => {
      const z = p.neutral;
      expect(z.max[0] - z.min[0]).toBeGreaterThanOrEqual(8);
      expect(z.max[2] - z.min[2]).toBeGreaterThanOrEqual(8);
      for (const i of [0, 2]) {
        expect(z.min[i]).toBeGreaterThanOrEqual(p.bounds.min[i]!);
        expect(z.max[i]).toBeLessThanOrEqual(p.bounds.max[i]!);
      }
      const vol = { min: [z.min[0], 0, z.min[2]], max: [z.max[0], p.bounds.max[1], z.max[2]] };
      expect(p.boxes.filter((b) => overlaps(b, vol.min, vol.max)).map((b) => b.name)).toEqual([]);
      expect(p.spheres.filter((s) => s.center.every((c, i) => c >= vol.min[i]! - s.radius && c <= vol.max[i]! + s.radius))).toEqual([]);
    });

    it(`${name}: spawn target, drones and scale reference sit where the brief puts them`, () => {
      const inside = (v: readonly number[]) => v.every((c, i) => c >= p.bounds.min[i]! - 1e-6 && c <= p.bounds.max[i]! + 1e-6);
      expect(inside(p.target)).toBe(true);
      // drones start on the camera side, above the floor (the Room's sit just in front of its bounds)
      for (const d of p.drones) expect(d[1]).toBeGreaterThan(0), expect(d[2]).toBeGreaterThan(p.target[2]);
      expect(p.drones[0][0]).toBeLessThan(p.drones[1][0]); // P1 -X, P2 +X
      // camera: 30 deg elevation toward the target (environments.md §2.1)
      const d = p.camera.map((c, i) => c - p.target[i]!);
      const el = Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180 / Math.PI;
      expect(Math.abs(el - 30)).toBeLessThan(1.5);
      // scale reference within 6 m of the zone's front-right (+X, +Z) corner, outside the zone (§0.7)
      const corner = [p.neutral.max[0], p.neutral.max[2]];
      expect(Math.hypot(p.scaleRef[0] - corner[0]!, p.scaleRef[2] - corner[1]!)).toBeLessThanOrEqual(6);
      const inZone = p.scaleRef[0] > p.neutral.min[0] && p.scaleRef[0] < p.neutral.max[0] &&
        p.scaleRef[2] > p.neutral.min[2] && p.scaleRef[2] < p.neutral.max[2];
      expect(inZone).toBe(false);
    });
  }

  it('the Room preset is the Warehouse set shifted by its origin (same colliders, own scale reference)', () => {
    const w = new Map(KITCHEN.presets.warehouse.boxes.filter((b) => !b.name.startsWith('scale_ref')).map((b) => [b.name, b]));
    const r = KITCHEN.presets.room.boxes.filter((b) => !b.name.startsWith('scale_ref'));
    expect(r.length).toBe(w.size);
    const o = KITCHEN.presets.room.origin;
    for (const b of r) {
      const wb = w.get(b.name)!;
      expect(b.half).toEqual(wb.half);
      b.center.forEach((c, i) => expect(c + o[i]!).toBeCloseTo(wb.center[i]!, 4));
    }
  });
});

describe.skipIf(!glb)(`kitchen.glb${glb ? '' : ' (no build: run `node tools/assets.mjs --env kitchen`)'}`, () => {
  it('has LOD0..LOD3 with falling triangle counts, a backdrop and both scale references', () => {
    const t = [0, 1, 2, 3].map((l) => lodStats(glb!, l).triangles);
    expect(t[0]).toBeGreaterThan(50000);
    expect(t[0]).toBeLessThan(420000); // environments.md §2 Warehouse budget
    for (let i = 1; i < 4; i++) expect(t[i]).toBeLessThan(t[i - 1]!);
    const names = new Set(glb!.nodes.map((n) => n.name));
    for (const n of ['BACKDROP', 'REF__scale__room', 'REF__scale__warehouse']) expect(names.has(n)).toBe(true);
    for (const m of glb!.materials) expect(m.name).toMatch(/^kn_/);
  });

  it('every Warehouse collider matches visible LOD0 geometry (render vertices on or in the box)', () => {
    const verts: number[] = [];
    for (const m of glb!.meshes) {
      let p = glb!.nodes[m.node]!.parent, top = m.node;
      while (p !== -1) { top = p; p = glb!.nodes[p]!.parent; }
      const root = glb!.nodes[top]!.name;
      if (root !== 'LOD0' && root !== 'REF__scale__warehouse') continue;
      for (const pr of m.primitives) for (let i = 0; i < pr.positions.length; i++) verts.push(pr.positions[i]!);
    }
    const missing: string[] = [];
    for (const b of KITCHEN.presets.warehouse.boxes) {
      const pad = 0.03;
      let hit = 0;
      for (let v = 0; v < verts.length && hit < 3; v += 3) {
        let ok = true;
        for (let i = 0; i < 3 && ok; i++) ok = Math.abs(verts[v + i]! - b.center[i]!) <= b.half[i]! + pad;
        if (ok) hit++;
      }
      if (hit < 3) missing.push(b.name);
    }
    expect(missing).toEqual([]);
  });
});
