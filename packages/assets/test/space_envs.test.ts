// M5 ORBITAL HANGAR and MOON BASE (stream E5c, contract 4): the generated set data (packages/parts-data/src/
// env_hangar.ts, env_moon.ts) against environments.md §0, §5, §6 and the exported glbs (assets/build/env/{hangar,moon}).
// The glb checks skip with a message when the builds are missing (`node tools/assets.mjs --env-hangar --env-moon`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HANGAR, type HangarPreset } from '../../parts-data/src/env_hangar.ts';
import { heightsFnv1a, MOON, moonTerrain, type MoonPreset } from '../../parts-data/src/env_moon.ts';
import { lodStats, parseGlb, type ParsedGlb } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build');
const load = (p: string): ParsedGlb | null => (existsSync(join(BUILD, p)) ? parseGlb(readFileSync(join(BUILD, p))) : null);
const PHYS = ['powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric', 'concrete', 'regolith'];
type V3 = readonly number[];
type AnyPreset = HangarPreset | MoonPreset;
interface Box { readonly name: string; readonly center: V3; readonly half: V3 }

const size = (p: AnyPreset) => p.bounds.max.map((v, i) => +(v - p.bounds.min[i]!).toFixed(4));
const elevation = (pos: V3, tgt: V3) => {
  const d = pos.map((c, i) => c - tgt[i]!);
  return (Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180) / Math.PI;
};
function overlaps(b: Box, min: V3, max: V3, eps = 1e-6): boolean {
  for (let i = 0; i < 3; i++) if (b.center[i]! + b.half[i]! <= min[i]! + eps || b.center[i]! - b.half[i]! >= max[i]! - eps) return false;
  return true;
}

function presetChecks(name: string, p: AnyPreset, elev: number): void {
  it(`${name}: colliders are valid boxes / spheres / hulls with known physics materials`, () => {
    expect(p.boxes.length).toBeGreaterThan(10);
    for (const b of p.boxes) {
      for (const h of b.half) expect(h).toBeGreaterThanOrEqual(0.0025); // nothing thinner than 5 mm (§0.6)
      expect(PHYS).toContain(b.phys);
    }
    for (const s of p.spheres) expect(PHYS).toContain(s.phys), expect(s.radius).toBeGreaterThan(0);
    for (const h of p.hulls) {
      expect(PHYS).toContain(h.phys);
      expect(h.points.length).toBeGreaterThanOrEqual(4);
      expect(h.points.length).toBeLessThanOrEqual(32);
      for (const q of h.points) q.forEach((c, i) => {
        expect(c).toBeGreaterThanOrEqual(h.aabb.min[i]! - 1e-4);
        expect(c).toBeLessThanOrEqual(h.aabb.max[i]! + 1e-4);
      });
    }
    const names = [...p.boxes.map((b) => b.name), ...p.spheres.map((s) => s.name), ...p.hulls.map((h) => h.name)];
    expect(new Set(p.boxes.map((b) => b.name)).size).toBe(p.boxes.length);
    expect(names.length).toBeGreaterThan(0);
  });

  it(`${name}: the neutral zone is level at y = 0, ≥ 8 × 8 m, inside the bounds and free of colliders (§0.9)`, () => {
    const z = p.neutral;
    expect(z.min[1]).toBe(0);
    expect(z.max[1]).toBe(0);
    expect(z.max[0] - z.min[0]).toBeGreaterThanOrEqual(8);
    expect(z.max[2] - z.min[2]).toBeGreaterThanOrEqual(8);
    for (const i of [0, 2]) {
      expect(z.min[i]).toBeGreaterThanOrEqual(p.bounds.min[i]!);
      expect(z.max[i]).toBeLessThanOrEqual(p.bounds.max[i]!);
    }
    const vmin = [z.min[0], 0, z.min[2]], vmax = [z.max[0], p.bounds.max[1], z.max[2]];
    expect(p.boxes.filter((b) => overlaps(b, vmin, vmax)).map((b) => b.name)).toEqual([]);
    expect(p.hulls.filter((h) => overlaps({ name: h.name, center: h.aabb.min.map((v, i) => (v + h.aabb.max[i]!) / 2),
      half: h.aabb.min.map((v, i) => (h.aabb.max[i]! - v) / 2) }, vmin, vmax)).map((h) => h.name)).toEqual([]);
    expect(p.spheres.filter((s) => overlaps({ name: s.name, center: s.center, half: [s.radius, s.radius, s.radius] }, vmin, vmax))
      .map((s) => s.name)).toEqual([]);
  });

  it(`${name}: spawn camera at the brief's elevation, drones, scale reference beside the zone (§0.7)`, () => {
    expect(Math.abs(elevation(p.camera, p.target) - elev)).toBeLessThan(1.5);
    expect(p.cameras.default.pos).toEqual(p.camera);
    for (const c of [p.cameras.hero, p.cameras.wide, p.cameras.lobby]) {
      expect(c.fovYDeg).toBeGreaterThan(10);
      expect(c.focusM).toBeGreaterThan(0);
    }
    expect(p.drones[0][0]).toBeLessThan(p.drones[1][0]);
    const corner = [p.neutral.max[0], p.neutral.max[2]];
    expect(Math.hypot(p.scaleRef[0] - corner[0]!, p.scaleRef[2] - corner[1]!)).toBeLessThanOrEqual(6);
    const inZone = p.scaleRef[0] > p.neutral.min[0] && p.scaleRef[0] < p.neutral.max[0] &&
      p.scaleRef[2] > p.neutral.min[2] && p.scaleRef[2] < p.neutral.max[2];
    expect(inZone).toBe(false);
    expect(p.ibl.sh9).toHaveLength(9);
    expect(p.ibl.sh9[0]!.every((c) => c > 0)).toBe(true);
    expect(p.ibl.bakeSunStrength).toBeGreaterThan(0);
  });
}

/** Render-vertex hash (2 m cells) of the meshes under the given roots. */
function vertexGrid(glb: ParsedGlb, roots: (root: string) => boolean): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  for (const m of glb.meshes) {
    let q = glb.nodes[m.node]!.parent, top = m.node;
    while (q !== -1) { top = q; q = glb.nodes[q]!.parent; }
    if (!roots(glb.nodes[top]!.name)) continue;
    for (const pr of m.primitives) {
      for (let i = 0; i < pr.positions.length; i += 3) {
        const x = pr.positions[i]!, y = pr.positions[i + 1]!, z = pr.positions[i + 2]!;
        const k = `${Math.floor(x / 2)},${Math.floor(y / 2)},${Math.floor(z / 2)}`;
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(x, y, z);
      }
    }
  }
  return grid;
}

/** At least `need` render vertices inside the box (padded). */
function hits(grid: Map<string, number[]>, c: V3, h: V3, pad: number, need = 3): boolean {
  let n = 0;
  const lo = c.map((v, i) => Math.floor((v - h[i]! - pad) / 2)), hi = c.map((v, i) => Math.floor((v + h[i]! + pad) / 2));
  for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) {
    const a = grid.get(`${x},${y},${z}`);
    if (!a) continue;
    for (let i = 0; i < a.length; i += 3) {
      if (Math.abs(a[i]! - c[0]!) <= h[0]! + pad && Math.abs(a[i + 1]! - c[1]!) <= h[1]! + pad && Math.abs(a[i + 2]! - c[2]!) <= h[2]! + pad) {
        if (++n >= need) return true;
      }
    }
  }
  return false;
}

function glbChecks(label: string, glb: ParsedGlb, p: AnyPreset, preset: string, budget: number): void {
  it(`${label}: LOD0..LOD3 within budget, chunked, roots, master materials, finite`, () => {
    const t = [0, 1, 2, 3].map((l) => lodStats(glb, l).triangles);
    expect(t[0]).toBeGreaterThan(50000);
    expect(t[0]).toBeLessThan(budget);
    for (let i = 1; i < 4; i++) expect(t[i]).toBeLessThan(t[i - 1]!);
    const names = new Set(glb.nodes.map((n) => n.name));
    for (const n of ['BACKDROP', `REF__scale__${preset}`, 'PROBES']) expect(names.has(n), n).toBe(true);
    expect([...names].some((n) => /^CHUNK__-?\d+_-?\d+$/.test(n))).toBe(true);
    expect([...names].some((n) => /^HLOD__-?\d+_-?\d+$/.test(n))).toBe(true);
    for (const m of glb.materials) expect(m.name).toMatch(/^kn_/);
    let bad = 0;
    for (const m of glb.meshes) for (const pr of m.primitives) {
      for (const v of pr.positions) if (!Number.isFinite(v)) bad++;
      if (pr.normals) for (const v of pr.normals) if (!Number.isFinite(v)) bad++;
    }
    expect(bad).toBe(0);
    // the renderer's far plane is 2 km (gfx/renderer.ts): nothing in the glb may sit beyond it (Earth, stars, highlands)
    let far = 0;
    for (const m of glb.meshes) for (const pr of m.primitives) for (let i = 0; i < pr.positions.length; i += 3) {
      far = Math.max(far, Math.hypot(pr.positions[i]!, pr.positions[i + 1]!, pr.positions[i + 2]!));
    }
    expect(far).toBeLessThan(1990);
  });

  it(`${label}: every box and hull collider sits on visible LOD0 geometry`, () => {
    const grid = vertexGrid(glb, (r) => r === 'LOD0' || r === `REF__scale__${preset}` || r.startsWith('ZONE__'));
    const missing: string[] = [];
    for (const b of p.boxes) if (!hits(grid, b.center, b.half, 0.05)) missing.push(b.name);
    for (const h of p.hulls) {
      const c = h.aabb.min.map((v, i) => (v + h.aabb.max[i]!) / 2), hh = h.aabb.min.map((v, i) => (h.aabb.max[i]! - v) / 2);
      if (!hits(grid, c, hh, 0.05)) missing.push(h.name);
    }
    expect(missing).toEqual([]);
  });
}

// ---------------------------------------------------------------- ORBITAL HANGAR

describe('Orbital Hangar data (env_hangar.ts)', () => {
  it('two bays at the GAME_SPEC §5.3 sizes, Mars 38 % gravity, pressurised, real scale', () => {
    expect(HANGAR.env).toBe('hangar');
    expect(HANGAR.scale).toBe(1);
    expect(HANGAR.gravityPercent).toBe(38);
    expect(HANGAR.air).toBe(1);
    expect(size(HANGAR.presets.warehouse)).toEqual([64, 24, 64]);
    expect(size(HANGAR.presets.arena)).toEqual([256, 64, 256]);
    expect(HANGAR.presets.warehouse.glb).not.toBe(HANGAR.presets.arena.glb); // each preset is its own bay
    expect(HANGAR.presets.warehouse.title).toBe('Bay 2');
    expect(HANGAR.presets.arena.title).toBe('Main Hall');
  });

  for (const [name, p] of Object.entries(HANGAR.presets)) {
    presetChecks(`hangar ${name}`, p, 30);

    it(`hangar ${name}: one steel deck box with its top at y = 0; window glass; shuttle hulls`, () => {
      const deck = p.boxes.filter((b) => b.name === 'deck');
      expect(deck).toHaveLength(1);
      expect(deck[0]!.phys).toBe('steel');
      expect(deck[0]!.center[1] + deck[0]!.half[1]).toBeCloseTo(0, 6);
      expect(p.boxes.some((b) => b.name === 'window_glass' && b.phys === 'glass')).toBe(true);
      expect(p.hulls.filter((h) => h.name.startsWith('shuttle')).length).toBeGreaterThanOrEqual(10 * (name === 'arena' ? 2 : 1));
    });

    it(`hangar ${name}: zero-g zones (§5.1): Antigrav 0 % cylinders standing on the deck, clear of the build zone`, () => {
      const want = name === 'warehouse' ? { n: 2, r: 6, h: 20 } : { n: 4, r: 12, h: 50 };
      expect(p.zones).toHaveLength(want.n);
      for (const z of p.zones) {
        expect(z.field).toBe('antigrav');
        expect(z.gravityPercent).toBe(0);
        expect(z.radius).toBe(want.r);
        expect(z.halfHeight * 2).toBe(want.h);
        expect(z.center[1]).toBeCloseTo(z.halfHeight, 6);
        expect(z.box.min[1]).toBe(0);
        expect(z.ring.center[1]).toBe(0);
        expect(z.ring.innerRadius).toBeLessThan(z.radius);
        expect(z.ring.outerRadius).toBeGreaterThan(z.radius);
        const nz = p.neutral;
        const apart = z.box.max[0] <= nz.min[0] || z.box.min[0] >= nz.max[0] || z.box.max[2] <= nz.min[2] || z.box.min[2] >= nz.max[2];
        expect(apart).toBe(true);
        for (const i of [0, 2]) {
          expect(z.box.min[i]).toBeGreaterThanOrEqual(p.bounds.min[i]!);
          expect(z.box.max[i]).toBeLessThanOrEqual(p.bounds.max[i]!);
        }
      }
    });

    it(`hangar ${name}: the light rig as data (strips, 4 shadowed zone panels, warm sconces) + ≤ 8 renderer spots`, () => {
      expect(p.practicals.length).toBeLessThanOrEqual(8);
      expect(p.practicals.findIndex((l) => l.shadowed)).toBe(0);
      for (const l of [...p.practicals, ...p.lights]) {
        expect(l.cyclesWatts).toBeGreaterThan(0);
        expect(l.bulbRadiusM).toBeGreaterThan(0);
        expect(l.outerConeDeg).toBeGreaterThan(l.innerConeDeg);
        expect(Math.hypot(...l.dir)).toBeCloseTo(1, 2);
      }
      const kinds = (k: string) => p.lights.filter((l) => l.kind === k);
      expect(kinds('strip')).toHaveLength(name === 'warehouse' ? 48 : 220);
      expect(kinds('area').filter((l) => l.shadowed)).toHaveLength(4);
      expect(kinds('sconce')).toHaveLength(name === 'warehouse' ? 16 : 48);
      for (const l of kinds('strip')) expect(l.kelvin).toBe(6500), expect(l.lengthM).toBeGreaterThan(7);
      for (const l of kinds('sconce')) expect(l.kelvin).toBe(2700);
    });
  }

  it('lights it from the window (+Y set = -Z engine) at 30 deg, 5,800 K; Earthlight from below the window line', () => {
    const [x, y, z] = HANGAR.light.sunDir;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect(y).toBeLessThan(0);
    expect(z).toBeGreaterThan(0); // travels toward the camera: comes in through the back-wall window
    expect(HANGAR.light.sunElevationDeg).toBeCloseTo(30, 1);
    expect(HANGAR.light.sunKelvin).toBe(5800);
    expect(HANGAR.light.earthDir[1]).toBeGreaterThan(0); // from below
    expect(HANGAR.light.ev100).toBe(11);
    expect(HANGAR.lut.name).toBe('lut_hangar');
    expect(HANGAR.cutaway).toEqual(['env_hangar__front_wall']);
  });
});

for (const bay of ['warehouse', 'arena'] as const) {
  const glb = load(`env/hangar/hangar_${bay}.glb`);
  describe.skipIf(!glb)(`hangar_${bay}.glb${glb ? '' : ' (no build: run `node tools/assets.mjs --env-hangar`)'}`, () => {
    glbChecks(`hangar ${bay}`, glb!, HANGAR.presets[bay], bay, bay === 'warehouse' ? 380000 : 850000);

    it(`hangar ${bay}: zero-g ring roots with separately recolourable LED pieces; noShadow / cutaway meshes exist`, () => {
      const p = HANGAR.presets[bay];
      for (const [i, z] of p.zones.entries()) {
        expect(glb!.nodes.some((n) => n.name === `ZONE__field__zerog_${i}`)).toBe(true);
        for (const s of ['_led', '_led_dash', '_glyph', '_collar']) {
          expect(glb!.meshes.some((m) => m.nodeName === `${z.ring.mesh}${s}`), `${z.ring.mesh}${s}`).toBe(true);
        }
      }
      for (const prefix of HANGAR.noShadow.filter((n) => n.startsWith('env_hangar__bd_') || n.includes('window_glass'))) {
        expect(glb!.meshes.some((m) => m.nodeName.startsWith(prefix)), prefix).toBe(true);
      }
      if (bay === 'warehouse') {
        // the cutaway front wall is single-sided and faces into the bay (engine -Z), so the spawn camera sees through it
        const walls = glb!.meshes.filter((m) => m.nodeName.startsWith('env_hangar__front_wall'));
        expect(walls.length).toBeGreaterThan(0);
        let into = 0, out = 0;
        for (const m of walls) for (const pr of m.primitives) if (pr.normals) for (let i = 2; i < pr.normals.length; i += 3) (pr.normals[i]! < 0 ? into++ : out++);
        expect(into).toBeGreaterThan(0);
        expect(out).toBe(0);
      }
    });

    it(`hangar ${bay}: ships the baked IBL and the LUT`, () => {
      const hdr = readFileSync(join(BUILD, 'env', 'hangar', `ibl_hangar_${bay}.hdr`));
      expect(hdr.subarray(0, 10).toString('latin1')).toMatch(/^#\?(RADIANCE|RGBE)/);
      const png = readFileSync(join(BUILD, 'env', 'hangar', 'lut_hangar.png'));
      expect(png.readUInt32BE(16)).toBe(1024);
      expect(png.readUInt32BE(20)).toBe(32);
    });
  });
}

// ---------------------------------------------------------------- MOON BASE

describe('Moon Base data (env_moon.ts)', () => {
  it('three presets sharing one set and origin, Moon 16.5 % gravity, no air', () => {
    expect(MOON.env).toBe('moon');
    expect(MOON.gravityPercent).toBe(16.5);
    expect(MOON.air).toBe(0);
    expect(size(MOON.presets.room)).toEqual([16, 8, 16]);
    expect(size(MOON.presets.warehouse)).toEqual([64, 24, 64]);
    expect(size(MOON.presets.arena)).toEqual([256, 64, 256]);
    for (const p of Object.values(MOON.presets)) expect(p.origin).toEqual([0, 0, 0]), expect(p.glb).toBe(MOON.glb);
  });

  for (const [name, p] of Object.entries(MOON.presets)) {
    presetChecks(`moon ${name}`, p, 30);

    it(`moon ${name}: the authored heightfield decodes losslessly in the TerrainRecord layout`, () => {
      const t = moonTerrain(name as 'room' | 'warehouse' | 'arena');
      const half = name === 'arena' ? 128 : 32;
      expect(t.nx).toBe(2 * half * 2 + 1);
      expect(t.nz).toBe(t.nx);
      expect(t.origin).toEqual([-half, -half]);
      expect(t.maxHeight).toBe(p.bounds.max[1]);
      expect(t.heights.length).toBe(t.nx * t.nz);
      expect(heightsFnv1a(t.heights)).toBe(p.terrain.fnv1a);
      let max = 0, flat = 0;
      for (const v of t.heights) { max = Math.max(max, v); if (v === 0) flat++; }
      expect(flat).toBe(p.terrain.flatSamples);
      expect((max * t.maxHeight) / 65535).toBeCloseTo(p.terrain.maxM, 2);
      expect(p.terrain.phys).toBe('regolith');
    });

    it(`moon ${name}: the ground is flat at 0 under every neutral zone and the apron (u16 0)`, () => {
      const t = moonTerrain(name as 'room' | 'warehouse' | 'arena');
      const at = (x: number, z: number) => t.heights[Math.round((z - t.origin[1]) / 0.5) * t.nx + Math.round((x - t.origin[0]) / 0.5)]!;
      for (const q of Object.values(MOON.presets)) {
        const z = q.neutral;
        for (let x = z.min[0]; x <= z.max[0]; x += 0.5) for (let zz = z.min[2]; zz <= z.max[2]; zz += 0.5) {
          if (Math.abs(x) <= -t.origin[0] && Math.abs(zz) <= -t.origin[1]) expect(at(x, zz)).toBe(0);
        }
      }
      for (let a = 0; a < 64; a++) {
        const r = 23.5 * Math.sqrt((a % 8) / 8), th = (a / 64) * 2 * Math.PI * 7;
        expect(at(r * Math.cos(th), r * Math.sin(th))).toBe(0);
      }
    });

    it(`moon ${name}: concrete apron strips (top y = 0), the dome's hemisphere, regolith boulders`, () => {
      const apron = p.boxes.filter((b) => b.name.startsWith('apron'));
      expect(apron.length).toBeGreaterThanOrEqual(8);
      for (const b of apron) {
        expect(b.phys).toBe('concrete');
        expect(b.center[1] + b.half[1]).toBeCloseTo(0, 6);
        expect(Math.hypot(Math.abs(b.center[0]) + b.half[0], Math.abs(b.center[2]) + b.half[2])).toBeLessThanOrEqual(24.01);
      }
      const dome = p.spheres.find((s) => s.name === 'dome')!;
      expect(dome.radius).toBe(15);
      expect(dome.center).toEqual([0, 0, -40]);
      expect(p.hulls.some((h) => h.name.startsWith('lander_leg'))).toBe(true);
      expect(p.spheres.filter((s) => s.name.startsWith('boulder')).every((s) => s.phys === 'regolith')).toBe(true);
    });
  }

  it('lights it raking from the front-left at 18 deg, 5,900 K, black sky, fixed exposure, never fog', () => {
    const [x, y, z] = MOON.light.sunDir;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect(x).toBeGreaterThan(0); // travels toward +X: comes from the left
    expect(z).toBeLessThan(0); // travels away from the camera: comes from the front
    expect(MOON.light.sunElevationDeg).toBe(18);
    expect(MOON.light.sky).toBe('#000000');
    expect(MOON.light.autoExposureEv).toBe(0);
    expect(MOON.light.fogDensity).toBe(0);
    expect(MOON.lut.name).toBe('lut_moon');
    const floods = MOON.presets.arena.practicals.filter((l) => l.kind === 'flood');
    expect(floods).toHaveLength(2);
    for (const f of floods) {
      expect(f.toggle).toBe('baseLights');
      expect(f.shadowed).toBe(true);
      expect(f.dir[1]).toBeLessThan(-0.2); // aimed down onto the apron, not at the sky
    }
    expect(MOON.presets.arena.practicals.find((l) => l.kind === 'beacon')!.blinkHz).toBe(0.5);
    expect(MOON.presets.arena.practicals.length).toBeLessThanOrEqual(8);
    const g = MOON.lightGroups.baseLights;
    expect(g.defaultOn).toBe(false);
    expect(g.practicals.map((i) => MOON.presets.arena.practicals[i]!.kind)).toEqual(['flood', 'flood']);
    expect(MOON.boulders.tiers['16']).toBe(8000);
  });
});

const moon = load('env/moon/moon.glb');
describe.skipIf(!moon)(`moon.glb${moon ? '' : ' (no build: run `node tools/assets.mjs --env-moon`)'}`, () => {
  glbChecks('moon arena', moon!, MOON.presets.arena, 'arena', 700000);

  it('the terrain render mesh sits exactly on the sim heightfield (outside the apron)', () => {
    const t = moonTerrain('arena');
    let checked = 0, worst = 0;
    for (const m of moon!.meshes) {
      if (!m.nodeName.startsWith('env_moon__terrain') || m.lod !== 0) continue;
      for (const pr of m.primitives) for (let i = 0; i < pr.positions.length; i += 3 * 97) {
        const x = pr.positions[i]!, y = pr.positions[i + 1]!, z = pr.positions[i + 2]!;
        if (Math.hypot(x, z) < 25) continue;
        const ix = Math.round((x - t.origin[0]) / 0.5), iz = Math.round((z - t.origin[1]) / 0.5);
        const h = (t.heights[iz * t.nx + ix]! * t.maxHeight) / 65535;
        worst = Math.max(worst, Math.abs(h - y));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(0.002);
  });

  it('ships the tier boulders, the IBL, the LUT, the terrain layers and the height files', () => {
    const b = load('env/moon/moon_boulders.glb')!;
    for (const n of ['TIER8', 'TIER12', 'TIER16']) expect(b.nodes.some((x) => x.name === n), n).toBe(true);
    const hdr = readFileSync(join(BUILD, 'env', 'moon', 'ibl_moon.hdr'));
    expect(hdr.subarray(0, 10).toString('latin1')).toMatch(/^#\?(RADIANCE|RGBE)/);
    for (const f of [MOON.lut.file, MOON.terrainLayers.regolith.basecolor, MOON.terrainLayers.regolith.normal,
      MOON.terrainLayers.regolith.orm, MOON.terrainLayers.regolith.detailNormal, MOON.terrainLayers.sintered.basecolor]) {
      expect(existsSync(join(BUILD, f)), f).toBe(true);
    }
    const r16 = readFileSync(join(BUILD, 'env', 'moon', 'moon_arena.height.r16'));
    const t = moonTerrain('arena');
    expect(r16.length).toBe(t.heights.length * 2);
    expect(r16.readUInt16LE(2 * (300 * t.nx + 200))).toBe(t.heights[300 * t.nx + 200]);
  });
});
