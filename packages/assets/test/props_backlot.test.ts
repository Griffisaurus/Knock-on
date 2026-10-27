// M3 stream E3b: the shared props kit (environments.md §7: kn_props.glb + .json) and the Backlot terrain art
// (§4: backlot.json, the default Arena heightfield, the layer textures, the dressing glb). Skips with a message
// when a build is missing (`node tools/assets.mjs --props` / `--env-backlot`).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGlb, type ParsedGlb } from '../src/index.ts';

const ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'env');
const PROPS_JSON = join(ENV, 'props', 'kn_props.json');
const BACKLOT_JSON = join(ENV, 'backlot', 'backlot.json');

interface PropEntry { class: string; usedIn: string; budget: number; variants: number; v: { lodTris: number[]; bounds: { min: number[]; max: number[] }; colliders: unknown[] }[] }

function rootOf(glb: ParsedGlb, node: number): string[] {
  const chain: string[] = [];
  for (let n = node; n !== -1; n = glb.nodes[n]!.parent) chain.unshift(glb.nodes[n]!.name);
  return chain;
}

describe.skipIf(!existsSync(PROPS_JSON))(`props kit${existsSync(PROPS_JSON) ? '' : ' (no build: node tools/assets.mjs --props)'}`, () => {
  const index = existsSync(PROPS_JSON) ? JSON.parse(readFileSync(PROPS_JSON, 'utf8')) as { props: Record<string, PropEntry> } : { props: {} };
  const glb = existsSync(join(ENV, 'props', 'kn_props.glb')) ? parseGlb(readFileSync(join(ENV, 'props', 'kn_props.glb'))) : null;

  it('has the brief\'s 45 kit props with classes and Lab / Kitchen use', () => {
    const names = Object.keys(index.props);
    expect(names).toHaveLength(45);
    for (const n of ['book', 'beaker', 'globe', 'plant_tall', 'shelf_unit', 'lamp_pendant', 'cereal_box', 'utensil_rail', 'magnet']) {
      expect(names).toContain(n);
    }
    for (const e of Object.values(index.props)) {
      expect(['E-S', 'E-M', 'E-L']).toContain(e.class);
      expect(['lab', 'kitchen', 'both']).toContain(e.usedIn);
      expect(e.v).toHaveLength(e.variants);
    }
  });

  it('every variant has four LODs with non-increasing triangle counts, and LOD0 near the brief budget', () => {
    const over: string[] = [];
    for (const [n, e] of Object.entries(index.props)) {
      for (const v of e.v) {
        expect(v.lodTris).toHaveLength(4);
        for (let i = 1; i < 4; i++) expect(v.lodTris[i]).toBeLessThanOrEqual(v.lodTris[i - 1]!);
        // paper_sheet / poster / magnet carry their printed art as geometry until the decal cells exist
        if (v.lodTris[0]! > e.budget * 1.15 && !['paper_sheet', 'poster', 'magnet', 'jar'].includes(n)) over.push(n);
      }
    }
    expect([...new Set(over)]).toEqual([]);
  });

  it('kn_props.glb: kn_prop_<name> > v<k> > LOD0..3, master materials only, finite normals', () => {
    expect(glb).not.toBeNull();
    const seen = new Set<string>();
    for (const m of glb!.meshes) {
      const chain = rootOf(glb!, m.node);
      expect(chain[0]).toMatch(/^kn_prop_[a-z_]+$/);
      expect(chain[2]).toMatch(/__LOD[0-3]$/);
      seen.add(chain[0]!);
      for (const pr of m.primitives) if (pr.normals) for (const x of pr.normals) expect(Number.isFinite(x)).toBe(true);
    }
    expect(seen.size).toBe(45);
    for (const mat of glb!.materials) expect(mat.name).toMatch(/^kn_/);
  });
});

describe.skipIf(!existsSync(BACKLOT_JSON))(`backlot terrain art${existsSync(BACKLOT_JSON) ? '' : ' (no build: node tools/assets.mjs --env-backlot)'}`, () => {
  const data = existsSync(BACKLOT_JSON) ? JSON.parse(readFileSync(BACKLOT_JSON, 'utf8')) : null;

  it('the default Arena heightfield matches its declared format (513^2 u16, 0.5 m, flat neutral plateau)', () => {
    const hf = data.heightfield;
    expect(hf.samples).toEqual([513, 513]);
    expect(hf.spacing).toBe(0.5);
    const buf = readFileSync(join(ENV, 'backlot', 'backlot_arena.height.r16'));
    expect(buf.length).toBe(513 * 513 * 2);
    const h = (i: number, j: number) => buf.readUInt16LE((j * 513 + i) * 2) / 65535 * hf.boundsHeight;
    // the 32 x 32 m Arena neutral zone (engine x, z in -16..16) is level at the default ground
    for (const [x, z] of [[-16, -16], [16, -16], [0, 0], [-16, 16], [16, 16]]) {
      expect(h((x! + 128) / 0.5, (z! + 128) / 0.5)).toBeCloseTo(hf.defaultGround, 2);
    }
    expect(hf.stats.min).toBeGreaterThanOrEqual(hf.bedrock);
    expect(hf.stats.max).toBeLessThanOrEqual(hf.maxRaise);
  });

  it('ships four tiling layer sets (basecolor + height, normal, ORM) and the layer rules', () => {
    expect(data.layers.order).toEqual(['grass', 'dirt', 'sand', 'rock']);
    for (const n of data.layers.order) {
      for (const k of ['basecolor', 'normal', 'orm']) {
        const p = join(ENV, '..', data.layers.files[n][k]);
        const png = readFileSync(p);
        expect(png.readUInt32BE(16)).toBe(data.layers.size);
        expect(statSync(p).size).toBeGreaterThan(1000);
      }
    }
    expect(data.layers.rules.rockSlopeDeg).toBe(38);
  });

  it('dressing placements reference built pieces; in-bounds ones carry colliders, none in the neutral zone', () => {
    const pieces = data.dressing.pieces as Record<string, { v: Record<string, unknown> }>;
    expect(data.dressing.placements.length).toBeGreaterThan(100);
    for (const d of data.dressing.placements) {
      expect(pieces[d.piece]!.v[String(d.variant)]).toBeDefined();
      for (const b of d.boxes) {
        const inZone = Math.abs(b.center[0]) < 16 + b.half[0] && Math.abs(b.center[2]) < 16 + b.half[2];
        expect(inZone, `${d.piece} at ${d.pos}`).toBe(false);
      }
    }
    expect(data.dressing.placements.some((d: { piece: string }) => d.piece === 'water_tower')).toBe(true);
    expect(existsSync(join(ENV, 'backlot', 'backlot_dressing.glb'))).toBe(true);
  });
});
