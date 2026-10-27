// End-to-end check of the M0 art gate: the THUD exported by `node tools/assets.mjs thud`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blockout } from '../../parts-data/src/index.ts';
import { assemblePartAssets, lodStats } from '../src/index.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts', 'thud');
const GLB = join(DIR, 'thud.glb');
const present = existsSync(GLB) && existsSync(join(DIR, 'thud.art.json')) && existsSync(join(DIR, 'thud.shapes.json'));
if (!present) {
  console.warn(`[assets] skipping THUD export tests: ${GLB} not found. Run \`node tools/assets.mjs thud\` (needs Blender 4.4+).`);
}

// docs/art/briefs/rollers.md, THUD: LOD0 <= 2,400 tris, 3 master slots, ⌀ 0.22 m, band <= 1.5 mm proud.
const LOD0_BUDGET = 2400;
const MASTERS = ['kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed'];

describe.skipIf(!present)('THUD export (assets/build/parts/thud)', () => {
  const load = () => assemblePartAssets('thud', readFileSync(GLB), JSON.parse(readFileSync(join(DIR, 'thud.art.json'), 'utf8')),
    JSON.parse(readFileSync(join(DIR, 'thud.shapes.json'), 'utf8')));

  it('glb, .art.json and .shapes.json agree (tri counts cross-checked on load)', () => {
    const part = load();
    expect(part.art.type).toBe('thud');
    expect(part.art.lods).toHaveLength(4);
    expect(part.glb.meshes.map((m) => m.lod).sort()).toEqual([0, 1, 2, 3]);
  });

  it('LOD0 is within the brief budget and LODs follow 50/25/8 %', () => {
    const glb = load().glb;
    const lod0 = lodStats(glb, 0);
    expect(lod0.triangles).toBeGreaterThanOrEqual(300);
    expect(lod0.triangles).toBeLessThanOrEqual(LOD0_BUDGET);
    expect(lod0.vertices).toBeGreaterThan(0);
    expect(lod0.vertices).toBeLessThanOrEqual(lod0.triangles * 3);
    for (const [lod, target] of [[1, 0.5], [2, 0.25], [3, 0.08]] as const) {
      const ratio = lodStats(glb, lod).triangles / lod0.triangles;
      expect(Math.abs(ratio / target - 1)).toBeLessThanOrEqual(0.1);
    }
  });

  it('is a 0.22 m ball centred on its origin (centre of mass)', () => {
    const glb = load().glb;
    for (const lod of [0, 1, 2, 3]) {
      const s = lodStats(glb, lod);
      // Shell radius 0.110 + band <= 1.5 mm proud; coarse LODs sit a little inside the true sphere.
      expect(s.originRadius * 2).toBeGreaterThan(0.215);
      expect(s.originRadius * 2).toBeLessThanOrEqual(0.2231);
      for (let i = 0; i < 3; i++) expect(Math.abs(s.min[i]! + s.max[i]!)).toBeLessThan(0.004);
    }
  });

  it('uses only the three master slots, with graphite as the dark majority', () => {
    const { glb, art } = load();
    expect(art.materials).toEqual(MASTERS);
    expect(glb.materials.map((m) => m.name).sort()).toEqual([...MASTERS].sort());
    const graphite = glb.materials.find((m) => m.name === 'kn_powder_graphite')!;
    expect(Math.max(...graphite.baseColorFactor.slice(0, 3))).toBeLessThan(0.1);
    expect(graphite.metallicFactor).toBe(0);
    expect(graphite.roughnessFactor).toBeCloseTo(0.42);
    const steel = glb.materials.find((m) => m.name === 'kn_steel_brushed')!;
    expect(steel.metallicFactor).toBe(1);
  });

  it('collider matches the gameplay blockout (sphere r 0.110, friction 0.30, restitution 0.12)', () => {
    const { shapes, art } = load();
    const def = blockout('thud')!;
    expect(shapes.shapes).toHaveLength(1);
    const s = shapes.shapes[0]!;
    expect(s.kind).toBe('sphere');
    if (s.kind !== 'sphere') return;
    expect(s.radius * 2).toBeCloseTo(def.size[0], 4);
    expect(s.pos).toEqual([0, 0, 0]);
    expect(s.phys).toBe('powder');
    expect(s.friction).toBeCloseTo(def.friction);
    expect(s.restitution).toBeCloseTo(def.restitution);
    expect(art.massHint).toBe(def.mass);
    expect(art.footprint).toEqual([2.2, 2.2, 2.2]);
    expect(art.ports).toEqual([]);
  });
});
