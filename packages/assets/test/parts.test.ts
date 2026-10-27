// Cross-checks every part the game loads art for (apps/game/src/artlist.ts) against its gameplay definition
// in @knockon/parts-data: same origin and scale (LOD0 inside the def bounds), the same ports at the same
// places, and for hinged parts a PIVOT__ node on the hinge axis carrying the moving piece in every LOD.
// Parts whose build is missing are skipped with a message (run `node tools/assets.mjs <type>`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_BASE, ART_PARTS } from '../../../apps/game/src/artlist.ts';
import { boundsOf, partDef, type PartDef } from '../../parts-data/src/index.ts';
import { assemblePartAssets, lodStats, pivotOf, type ParsedGlb, type PartAssets } from '../src/index.ts';
import { poseAtZero, type RawPivot, type RawPort } from './pivot_pose.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const ATLAS = join(BUILD, '..', 'kit', 'decals_atlas.json');
interface AtlasJson { size: number; slots: Record<string, { rect: [number, number, number, number] }> }
const atlas: AtlasJson | null = existsSync(ATLAS) ? JSON.parse(readFileSync(ATLAS, 'utf8')) as AtlasJson : null;
const TOL = 0.012; // tape proud of the bundle, rounded rims, port bosses
// Moving pieces allowed past the def bounds: the MAINS lever sweeps 0.07 m in front of the housing.
const HOUSING_ONLY = new Set(['mains']);
const COG_SIZE: Record<string, number> = { cog_s: 0, cog_m: 1, cog_l: 2 };

function load(type: string): PartAssets | null {
  const base = join(BUILD, type, type);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  return assemblePartAssets(type, readFileSync(`${base}.glb`), JSON.parse(readFileSync(`${base}.art.json`, 'utf8')),
    JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
}

function lod0Bounds(glb: ParsedGlb, skipPivots: boolean): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of glb.meshes) {
    if (m.lod !== 0 || (skipPivots && pivotOf(glb, m) !== -1)) continue;
    for (const p of m.primitives) {
      for (let v = 0; v < p.vertexCount; v++) {
        for (let i = 0; i < 3; i++) {
          const x = p.positions[v * 3 + i]!;
          if (x < min[i]!) min[i] = x;
          if (x > max[i]!) max[i] = x;
        }
      }
    }
  }
  return { min, max };
}

function onAxis(pos: readonly number[], def: PartDef): boolean {
  const h = def.hinge!;
  const len = Math.hypot(...h.axis);
  const u = h.axis.map((a) => a / len);
  const d = pos.map((p, i) => p - h.at[i]!);
  const t = d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
  return Math.hypot(...d.map((x, i) => x - t * u[i]!)) <= 0.002;
}

const builtAll = ART_PARTS.filter((t) => load(t) !== null);
const missing = ART_PARTS.filter((t) => !builtAll.includes(t));
if (missing.length) console.warn(`[assets] skipping part checks for ${missing.join(', ')}: not built (node tools/assets.mjs <type>)`);
// M2: art can land before its parts-data def; def comparisons wait for the def (m2_parts.test.ts pins the brief).
const built = builtAll.filter((t) => partDef(ART_BASE[t] ?? t) !== undefined);
const undef = builtAll.filter((t) => !built.includes(t));
if (undef.length) console.warn(`[assets] no parts-data def yet for ${undef.join(', ')}: def checks skipped`);

describe.skipIf(!builtAll.length)('part art matches parts-data (assets/build/parts)', () => {
  it.each(builtAll)('%s: LODs present, ratios hold, materials are masters', (type) => {
    const { glb, art } = load(type)!;
    expect(art.lods).toHaveLength(4);
    const t0 = lodStats(glb, 0).triangles;
    for (const [lod, target] of [[1, 0.5], [2, 0.25], [3, 0.08]] as const) {
      const t = lodStats(glb, lod).triangles;
      expect(t).toBeGreaterThan(0);
      if (t > 20) expect(Math.abs(t / t0 / target - 1)).toBeLessThanOrEqual(0.1);
    }
    for (const m of glb.materials) expect(m.name).toMatch(/^kn_[a-z0-9_]+$/);
  });

  it.each(built)('%s: same origin and scale as the sim body (LOD0 inside the def bounds)', (type) => {
    const { glb } = load(type)!;
    const def = partDef(ART_BASE[type] ?? type)!;
    expect(def, `no part def for ${type}`).toBeDefined();
    const b = boundsOf(def, type in COG_SIZE ? { size: COG_SIZE[type]! } : {});
    const got = lod0Bounds(glb, HOUSING_ONLY.has(type));
    for (let i = 0; i < 3; i++) {
      expect(got.min[i]!, `${type} min[${i}]`).toBeGreaterThanOrEqual(b.min[i]! - TOL);
      expect(got.max[i]!, `${type} max[${i}]`).toBeLessThanOrEqual(b.max[i]! + TOL);
    }
  });

  it.each(built)('%s: ports match the def (name, channel, dir, place, links)', (type) => {
    const { art } = load(type)!;
    const def = partDef(ART_BASE[type] ?? type)!;
    expect(art.ports.map((p) => p.name).sort()).toEqual(def.ports.map((p) => p.name).sort());
    // M2: a port riding a pivot (SCOOP bail) is exported at the pivot's rest; defs hold it at pivot value 0.
    const raw = JSON.parse(readFileSync(join(BUILD, type, `${type}.art.json`), 'utf8')) as { ports: RawPort[]; pivots: RawPivot[] };
    for (const p of def.ports) {
      const a = art.ports.find((x) => x.name === p.name)!;
      expect(a.channel).toBe(p.channel);
      expect(a.dir).toBe(p.dir);
      const pos = poseAtZero(raw.ports.find((x) => x.name === p.name)!, raw.pivots).pos;
      for (let i = 0; i < 3; i++) expect(Math.abs(pos[i]! - p.at[i]!), `${type}.${p.name} pos[${i}]`).toBeLessThanOrEqual(0.0015);
      expect(a.maxLinks ?? 1).toBe(p.maxLinks ?? 1);
      if (p.kind) expect(a.kind).toBe(p.kind);
    }
  });

  it.each(built.filter((t) => partDef(ART_BASE[t] ?? t)?.hinge))('%s: the moving piece hangs under a pivot on the hinge axis in every LOD', (type) => {
    const { glb, art } = load(type)!;
    const def = partDef(ART_BASE[type] ?? type)!;
    expect(art.pivots.some((p) => onAxis(p.pos, def))).toBe(true);
    for (let lod = 0; lod < 4; lod++) {
      const meshes = glb.meshes.filter((m) => m.lod === lod);
      const arm = meshes.filter((m) => {
        const p = pivotOf(glb, m);
        return p !== -1 && onAxis(Array.from(glb.nodes[p]!.matrix.slice(12, 15)), def);
      });
      expect(arm.length, `${type} LOD${lod} arm`).toBeGreaterThan(0);
      expect(arm.length, `${type} LOD${lod} base`).toBeLessThan(meshes.length);
    }
  });

  it.each(builtAll)('%s: collision is authored with physics materials', (type) => {
    const { shapes, art } = load(type)!;
    expect(shapes.shapes.length).toBeGreaterThan(0);
    for (const s of shapes.shapes) expect(s.phys).toMatch(/^[a-z]+$/);
    expect(art.massHint).toBeGreaterThan(0);
  });

  it.skipIf(!atlas).each(builtAll)('%s: every kn_decal UV lies inside one decals_atlas.json slot; decals ride LOD0/1 only', (type) => {
    const { glb } = load(type)!;
    const rects = Object.entries(atlas!.slots).map(([id, s]) => [id, s.rect] as const);
    const S = atlas!.size;
    for (const m of glb.meshes) {
      for (const p of m.primitives) {
        if (glb.materials[p.material]?.name !== 'kn_decal') continue;
        expect(m.lod, `${type} ${m.nodeName}: decals are LOD0/LOD1 only`).toBeLessThanOrEqual(1);
        expect(p.uvs, `${type} ${m.nodeName}: kn_decal needs TEXCOORD_0`).not.toBeNull();
        for (let t = 0; t < p.indices.length; t += 3) {
          const uv = [0, 1, 2].map((k) => [p.uvs![p.indices[t + k]! * 2]! * S, p.uvs![p.indices[t + k]! * 2 + 1]! * S]);
          const hit = rects.find(([, [x, y, w, h]]) => uv.every(([u, v]) => u! >= x - 0.5 && u! <= x + w + 0.5 && v! >= y - 0.5 && v! <= y + h + 0.5));
          expect(hit, `${type} ${m.nodeName}: triangle UVs ${JSON.stringify(uv)} outside every atlas slot`).toBeDefined();
        }
      }
    }
  });

  it.each(builtAll)('%s: kn_screen quads carry 0-1 UVs and match an art.json screen', (type) => {
    const { glb, art } = load(type)!;
    const quads = glb.meshes.filter((m) => m.primitives.some((p) => glb.materials[p.material]?.name === 'kn_screen'));
    if (!quads.length) return;
    expect(art.screens.length).toBeGreaterThan(0);
    for (const m of quads) {
      for (const p of m.primitives) {
        if (glb.materials[p.material]?.name !== 'kn_screen') continue;
        expect(p.uvs).not.toBeNull();
        const us = Array.from(p.uvs!);
        expect(Math.min(...us)).toBeCloseTo(0, 5);
        expect(Math.max(...us)).toBeCloseTo(1, 5);
        const c = [0, 1, 2].map((i) => { let a = 0; for (let v = 0; v < p.vertexCount; v++) a += p.positions[v * 3 + i]!; return a / p.vertexCount; });
        expect(art.screens.some((sc) => sc.pos.every((x, i) => Math.abs(x - c[i]!) < 0.001)), `${type} ${m.nodeName}`).toBe(true);
      }
    }
  });
});
