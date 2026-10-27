// Writes stream S3's default Backlot heightfield (packages/format/src/terrain.ts defaultTerrain, the sim's own
// deterministic default) as raw u16 so the art pipeline dresses exactly the ground the sim builds.
//   node tools/blender/props/export_default_lot.ts [arena|megastructure] [out.r16]
// Layout: little-endian u16, row-major, z rows of nx samples from origin (-half, -half), 0.5 m spacing,
// metres = v * maxHeight / 65535 (the TerrainRecord layout). A JSON sidecar records origin / nx / maxHeight.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultTerrain } from '../../../packages/format/src/terrain.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const preset = process.argv[2] ?? 'arena';
const out = process.argv[3] ?? join(root, 'assets', 'build', 'env', 'backlot', `backlot_${preset}.sim.r16`);
const t = defaultTerrain(preset);
if (!t) {
  console.error(`no Backlot lot for preset ${preset}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
const buf = Buffer.alloc(t.heights.length * 2);
for (let i = 0; i < t.heights.length; i++) buf.writeUInt16LE(t.heights[i]!, i * 2);
writeFileSync(out, buf);
writeFileSync(out.replace(/\.r16$/, '.json'), JSON.stringify({ preset: t.preset, origin: t.origin, nx: t.nx, nz: t.nz, maxHeight: t.maxHeight, spacing: 0.5 }, null, 1) + '\n');
console.log(`default ${preset} lot: ${t.nx} x ${t.nz} -> ${out}`);
