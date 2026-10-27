// Fracture data (stream E1, `node tools/assets.mjs <type> --frac`): every generated packages/parts-data/src/
// frac_<type>.ts must describe exactly the chunks in assets/build/parts/<type>/<type>.frac.glb: same names in the
// same order, node translation = chunk centre, every hull point one of that chunk's vertices (part space), hulls
// within the 32-point cap, and mass shares that sum to 1.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = join(ROOT, 'packages', 'parts-data', 'src');
type V3 = readonly [number, number, number];
interface FracData {
  type: string; glb: string;
  chunks: readonly { name: string; centre: V3; volume: number; massShare: number; hull: readonly V3[] }[];
}

const modules = readdirSync(SRC).filter((f) => /^frac_[a-z0-9_]+\.ts$/.test(f));
const loaded: [string, FracData][] = [];
for (const f of modules) {
  const mod = await import(pathToFileURL(join(SRC, f)).href) as Record<string, FracData>;
  const data = Object.values(mod).find((v) => v && typeof v === 'object' && 'chunks' in v)!;
  loaded.push([data.type, data]);
}
const withGlb = loaded.filter(([t]) => existsSync(join(ROOT, 'assets', 'build', 'parts', t, `${t}.frac.glb`)));
if (withGlb.length < loaded.length) console.warn('[assets] frac checks skipped where <type>.frac.glb is not built');

describe.skipIf(!withGlb.length)('fracture chunks: parts-data hulls match <type>.frac.glb', () => {
  it('FISHBOWL ships its 21 chunks', () => {
    const fb = loaded.find(([t]) => t === 'fishbowl');
    expect(fb, 'frac_fishbowl.ts').toBeDefined();
    expect(fb![1].chunks).toHaveLength(21);
  });

  it.each(withGlb)('%s: names, order, centres, hull points and mass shares', (type, data) => {
    const glb = parseGlb(readFileSync(join(ROOT, 'assets', 'build', 'parts', type, `${type}.frac.glb`)));
    expect(data.glb).toBe(`parts/${type}/${type}.frac.glb`);
    const roots = glb.nodes.map((n, i) => [n, i] as const).filter(([n]) => n.parent === -1);
    expect(roots.map(([n]) => n.name)).toEqual(data.chunks.map((c) => c.name));
    let share = 0;
    data.chunks.forEach((c, k) => {
      expect(c.name).toBe(`FRAC__${String(k + 1).padStart(2, '0')}`);
      const [node, ni] = roots[k]!;
      for (let i = 0; i < 3; i++) expect(Math.abs(node.translation[i]! - c.centre[i]!), `${c.name} centre[${i}]`).toBeLessThan(2e-5);
      const meshes = glb.meshes.filter((m) => m.node === ni);
      expect(meshes, c.name).toHaveLength(1);
      const verts: number[][] = [];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of meshes[0]!.primitives) {
        for (let v = 0; v < p.vertexCount; v++) {
          const q = [p.positions[v * 3]!, p.positions[v * 3 + 1]!, p.positions[v * 3 + 2]!];
          verts.push(q);
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, q[i]!); hi[i] = Math.max(hi[i]!, q[i]!); }
        }
      }
      expect(c.hull.length).toBeGreaterThanOrEqual(4);
      expect(c.hull.length).toBeLessThanOrEqual(32);
      for (const h of c.hull) {
        const d = Math.min(...verts.map((q) => Math.hypot(q[0]! - h[0], q[1]! - h[1], q[2]! - h[2])));
        expect(d, `${c.name} hull point ${JSON.stringify(h)} is not a chunk vertex`).toBeLessThan(3e-5);
      }
      for (let i = 0; i < 3; i++) {
        expect(c.centre[i]!).toBeGreaterThanOrEqual(lo[i]! - 1e-6);
        expect(c.centre[i]!).toBeLessThanOrEqual(hi[i]! + 1e-6);
      }
      expect(c.volume).toBeGreaterThan(0);
      expect(c.massShare).toBeGreaterThan(0);
      share += c.massShare;
    });
    expect(share).toBeCloseTo(1, 4);
  });
});
