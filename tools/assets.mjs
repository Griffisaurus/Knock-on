#!/usr/bin/env node
// Art pipeline driver: Blender source -> engine assets with no manual steps (PRODUCTION §2, M0 art gate).
//
//   node tools/assets.mjs [type ...] [--render] [--selftest] [--force-libs] [--kit] [--kit-only] [--sheet]
//
// For each part (default: every part with tools/blender/make_<type>.py or a source .blend):
//   libs     assets/src/lib/materials.blend + port_ring.blend (built if missing)
//   kit      assets/build/kit/decals_atlas.png + .json (shared_kit §6; built if missing, or with --kit / --kit-only)
//   make     tools/blender/make_<type>.py -> assets/src/<family>/<type>.blend (procedural parts only)
//   validate tools/blender/validate_part.py (validator v1, CI-blocking)
//   export   tools/blender/export_part.py -> assets/build/parts/<type>/<type>.glb/.art.json/.shapes.json
//   post     gltf-transform / KTX2 / SDF / impostor / thumbnails: hook points, deferred in M0
//   render   (--render) look-dev PNG of the exported glb -> art/style-samples/<type>_export.png
//   sheet    (--sheet) contact sheet of every exported part -> art/style-samples/m1_parts.png
//   tex      (--tex, or automatically once assets/src/<family>/tex/<type>__body__basecolor.png exists; M3 E3c)
//            tools/blender/texture_part.py: UV1 atlas + Cycles bake of the D78 tactile set (albedo / normal / ORM);
//            export then writes <type>.tex.{albedo,normal,orm}.png + .art.json textures + glb extras.texSet
//   sheet-tex (--sheet-tex [type ...]) M1 texture pass before | after -> art/style-samples/m3_textured_m1.png
//   ktx2     (--ktx2, or --ktx2-only [type ...] without rebuilding; M4 V4) <type>.tex.{albedo,normal,orm}.ktx2:
//            BC7 + mips (in-house encoder, D94) next to the PNGs, listed in .art.json textures.ktx2
// Blender: env BLENDER, else the default Windows / macOS / Linux install locations.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'tools', 'blender');
const SRC = join(ROOT, 'assets', 'src');
const BUILD = join(ROOT, 'assets', 'build');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const wanted = args.filter((a) => !a.startsWith('--'));

function findBlender() {
  const candidates = [
    process.env.BLENDER,
    'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 4.4/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/usr/bin/blender',
    '/usr/local/bin/blender',
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    console.error('Blender not found. Set BLENDER=/path/to/blender (4.4+).');
    process.exit(2);
  }
  return hit;
}

// M4 (stream V4): `--ktx2` also encodes each built part's texture set to KTX2 / BC7 (in-house encoder,
// D94: tools/blender/encode_ktx2.py, kn_tools/bc7.py + ktx2.py) next to the PNGs and records them in
// `.art.json -> textures.ktx2`; `--ktx2-only [type ...]` does just that for parts already built (no Blender
// step). The encoder runs in Blender's bundled Python (numpy, pinned with Blender), else `python` on PATH.
function ktx2Python(blender) {
  const dir = dirname(blender);
  try {
    for (const v of readdirSync(dir).filter((f) => /^\d+\.\d+$/.test(f)).sort().reverse()) {
      for (const exe of [join(dir, v, 'python', 'bin', 'python.exe'), join(dir, v, 'python', 'bin', 'python3.11'), join(dir, v, 'python', 'bin', 'python3')]) {
        if (existsSync(exe)) return exe;
      }
    }
  } catch { /* not a Windows-style install */ }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function encodeKtx2(types) {
  const py = ktx2Python(BLENDER);
  const t0 = Date.now();
  const r = spawnSync(py, [join(TOOLS, 'encode_ktx2.py'), ...types, '--check'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  console.log(`[ktx2 ${types.length ? types.join(' ') : 'all sets'}] ${ok ? 'ok' : 'FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${py})`);
  for (const l of `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/)) if (l.trim()) console.log(`    ${l}`);
  if (!ok) process.exit(1);
}

const BLENDER = findBlender();
if (flags.has('--ktx2-only')) {
  encodeKtx2(wanted);
  process.exit(0);
}

// Blender prints a lot; keep our scripts' lines unless the step fails.
const NOISE = /^(Blender \d|Read blend|Info:|INFO |\d\d:\d\d:\d\d \||Fra:|Blender quit|\s*$|Draco|.*addon_utils)/;

function blender(label, blend, script, scriptArgs = [], { expectFail = false } = {}) {
  const argv = ['-b'];
  if (blend) argv.push(blend);
  argv.push('--factory-startup', '--python-exit-code', '1', '-P', join(TOOLS, script), '--', ...scriptArgs);
  const t0 = Date.now();
  const r = spawnSync(BLENDER, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = expectFail ? ok : !ok;
  console.log(`[${label}] ${failed ? 'FAILED' : 'ok'} (${secs}s${expectFail ? `, exit ${r.status} as expected` : ''})`);
  const lines = out.split(/\r?\n/);
  const shown = failed ? lines : lines.filter((l) => !NOISE.test(l));
  for (const l of shown) if (l.trim()) console.log(`    ${l}`);
  if (failed) {
    if (r.error) console.error(r.error);
    process.exit(1);
  }
  return r.status;
}

function discoverParts() {
  const types = new Map(); // type -> { make?: string, family?: string }
  for (const f of readdirSync(TOOLS)) {
    const m = /^make_([a-z0-9_]+)\.py$/.exec(f);
    if (m) types.set(m[1], { make: f });
  }
  for (const family of readdirSync(SRC)) {
    const dir = join(SRC, family);
    if (family === 'lib' || family === 'style-samples' || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      const m = /^([a-z0-9_]+)\.blend$/.exec(f);
      if (m) types.set(m[1], { ...(types.get(m[1]) ?? {}), family });
    }
  }
  return types;
}

function sourceBlend(type) {
  for (const family of readdirSync(SRC)) {
    const p = join(SRC, family, `${type}.blend`);
    if (existsSync(p)) return p;
  }
  return null;
}

// Node-side post-process (ASSET_PIPELINE §8). Each step is a named hook; M0 only records the size report.
function postprocess(type) {
  const dir = join(BUILD, 'parts', type);
  const glb = join(dir, `${type}.glb`);
  const report = JSON.parse(readFileSync(join(dir, `${type}.report.json`), 'utf8'));
  const deferred = [
    'gltf-transform dedupe -> prune -> meshopt (needs @gltf-transform/cli pinned in package.json)',
    report.bytes?.tex
      ? (flags.has('--ktx2') ? `KTX2 texture encode: BC7 by the in-house encoder after the build (M4 V4); ${type}.tex.*.png stay as the fallback`
        : `KTX2 texture encode: pass --ktx2 for BC7 (in-house encoder, M4 V4); the set ships as ${type}.tex.*.png (M3 E3c)`)
      : 'KTX2 texture encode (toktx / gltf-transform etc1s|uastc): no texture set on this part yet',
    'SDF bake -> .sdf.ktx2 (tools/bake, Node + Dawn)',
    'impostor bake -> .impostor.ktx2 (tools/bake)',
    'thumbnails -> .thumb.webp / .thumb_128.webp (tools/bake, in-engine)',
  ];
  console.log(`[post ${type}] glb ${statSync(glb).size} bytes · LOD tris ${report.lods.map((l) => l.tris).join(' / ')}`);
  for (const d of deferred) console.log(`    deferred (M0): ${d}`);
  return report;
}

// M3 (stream E3c): a part is in the texture pass once its source set exists (assets/src/<family>/tex/
// <type>__body__basecolor.png); every rebuild then re-bakes it. `--tex` puts a part in (or forces a re-bake).
function hasTexSet(type) {
  const blend = sourceBlend(type);
  return !!blend && existsSync(join(dirname(blend), 'tex', `${type}__body__basecolor.png`));
}

function runPart(type, info) {
  const texture = flags.has('--tex') || hasTexSet(type);
  if (info.make) blender(`make ${type}`, null, info.make);
  const blend = sourceBlend(type);
  if (!blend) {
    console.error(`no source .blend for ${type} under assets/src/<family>/`);
    process.exit(1);
  }
  // M3 (E3c): UV1 atlas + Cycles bake -> assets/src/<family>/tex/<type>__body__{basecolor,normal,orm}.png
  if (texture && info.family !== 'critters') blender(`tex ${type}`, blend, 'texture_part.py');
  blender(`validate ${type}`, blend, 'validate_part.py');
  blender(`export ${type}`, blend, 'export_part.py', ['--no-validate']);
  const report = postprocess(type);
  // M2 (E1): `--frac` exports FRAC__<n> chunks -> <type>.frac.glb + packages/parts-data/src/frac_<type>.ts
  if (flags.has('--frac')) blender(`frac ${type}`, blend, 'export_frac.py');
  if (flags.has('--render')) {
    const png = join(ROOT, 'art', 'style-samples', `${type}_export.png`);
    blender(`render ${type}`, null, 'render_lookdev.py', [join(BUILD, 'parts', type, `${type}.glb`), png]);
  }
  return report;
}

function selftest() {
  const scratch = join(BUILD, 'selftest');
  mkdirSync(scratch, { recursive: true });
  blender('selftest', null, 'selftest.py', [scratch]);
  blender('selftest cli (broken copy must fail)', join(scratch, 'broken_scale', 'thud.blend'), 'validate_part.py', [],
    { expectFail: true });
  // M4 (V4): the in-house BC7 encoder and KTX2 writer (synthetic images; deterministic digest)
  const r = spawnSync(ktx2Python(BLENDER), [join(TOOLS, 'encode_ktx2.py'), '--selftest'], { cwd: ROOT, encoding: 'utf8' });
  console.log(`[selftest bc7/ktx2] ${r.status === 0 ? 'ok' : 'FAILED'}`);
  for (const l of `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/)) if (l.trim()) console.log(`    ${l}`);
  if (r.status !== 0) process.exit(1);
}

const t0 = Date.now();
console.log(`Blender: ${BLENDER}`);
blender('libs', null, 'build_libs.py', flags.has('--force-libs') ? ['--force'] : []);
const ATLAS = join(BUILD, 'kit', 'decals_atlas.png');
if (flags.has('--kit') || flags.has('--kit-only') || !existsSync(ATLAS)) blender('kit decals_atlas', null, 'build_decals.py');
if (flags.has('--kit-only')) process.exit(0);
const parts = discoverParts();
// `--sheet-m2` alone only renders the sheet (no rebuild of every part).
// M2 (stream E2): `--env-kitchen` / `--sheet-critters` alone likewise skip the part rebuild.
const onlyExtras = flags.has('--sheet-m2') || flags.has('--env-kitchen') || flags.has('--sheet-critters') ||
  flags.has('--sheet-tex') ||
  // M3 (stream E3b): the environment / props-kit flags likewise skip the part rebuild
  flags.has('--env-tinker') || flags.has('--props') || flags.has('--sheet-props') || flags.has('--env-backlot') ||
  flags.has('--kitchen-pass') ||
  flags.has('--sheet-m3') || // M3 (stream E3a)
  flags.has('--env-hangar') || flags.has('--env-moon'); // M5 (stream E5c)
const types = wanted.length ? wanted : onlyExtras ? [] : [...parts.keys()].sort();
for (const t of types) {
  if (!parts.has(t)) {
    console.error(`unknown part ${t}; known: ${[...parts.keys()].join(', ') || '(none)'}`);
    process.exit(1);
  }
}
const done = types.map((t) => [t, runPart(t, parts.get(t))]);
if (flags.has('--ktx2') && types.length) encodeKtx2(types); // M4 (V4): KTX2 / BC7 next to the built PNGs
if (flags.has('--selftest')) selftest();
if (flags.has('--sheet')) blender('sheet', null, 'render_contact.py', [join(ROOT, 'art', 'style-samples', 'm1_parts.png')]);
// M2 (stream E1): `--sheet-m2` renders the M2 parts only -> art/style-samples/m2_parts.png
const M2_PARTS = ['stitch', 'fuzz', 'pig_iron', 'gutter', 'vortex', 'sprong', 'trap_box', 'scoop', 'flap', 'dynamo',
  'hamster_drive', 'turbine', 'pedal_rig', 'puffer', 'cell', 'suncell', 'lamp', 'torch', 'burning_glass', 'toggle',
  'ringer', 'delay', 't_plunger', 'skyrocket', 'big_top', 'cork_blaster', 'punchline', 'gotcha_box', 'fishbowl'];
// M3 (stream E3c): `--sheet-tex` renders the M1 texture pass before | after -> art/style-samples/m3_textured_m1.png
if (flags.has('--sheet-tex')) {
  blender('sheet tex', null, 'render_textured.py', [join(ROOT, 'art', 'style-samples', 'm3_textured_m1.png'), ...wanted]);
}
if (flags.has('--sheet-m2')) {
  blender('sheet m2', null, 'render_contact.py', [join(ROOT, 'art', 'style-samples', 'm2_parts.png'), ...M2_PARTS, '--cols', '6', '--res', '2400x2000']);
}
// M3 (stream E3a): `--sheet-m3` renders the M3 parts only -> art/style-samples/m3_parts.png
const M3_PARTS = ['lance', 'mirror', 'splitter', 'tripwire', 'ping', 'maglock', 'marble', 'glidepath', 'glidepath_booster',
  'spindeck', 'lift', 'rack', 'ram', 'powder_keg', 'jitterjuice', 'skyshow', 'flamer', 'popper', 'snaptrap', 'bonker',
  'flinger', 'wrecker', 'pinger', 'paddle', 'bumper', 'pin', 'stacker', 'pane', 'vase', 'tonebars', 'ding', 'fabricator',
  'recycler', 'zone'];
if (flags.has('--sheet-m3')) {
  blender('sheet m3', null, 'render_contact.py', [join(ROOT, 'art', 'style-samples', 'm3_parts.png'), ...M3_PARTS, '--cols', '7', '--res', '2800x2000']);
}
// M2 (stream E2): critters and the Mega Kitchen.
//   --env-kitchen     tools/blender/env_kitchen.py -> assets/build/env/kitchen/kitchen.glb + .env.json,
//                     packages/parts-data/src/env_kitchen.ts; with --render also art/style-samples/m2_kitchen.png
//   --sheet-critters  art/style-samples/m2_critters.png (render_critters.py, from the exported glbs)
//   --selftest        also runs the rule 11 critter self-test when a critter source exists
if (flags.has('--env-kitchen')) {
  blender('env kitchen', null, 'env_kitchen.py');
  if (flags.has('--render')) {
    blender('render kitchen', null, 'render_kitchen.py', [join(ROOT, 'art', 'style-samples', 'm2_kitchen.png'), '--both']);
  }
}
if (flags.has('--sheet-critters')) {
  blender('sheet critters', null, 'render_critters.py', [join(ROOT, 'art', 'style-samples', 'm2_critters.png'),
    '--samples', '32', '--res', '2000x1700', '--el', '38']);
}
// M3 (stream E3b): the shared props kit, THE TINKER LAB, the Kitchen maximalism pass and the Backlot terrain art.
//   --props          tools/blender/props/build_props.py -> assets/src/env/_shared/props/kn_prop_<name>.blend,
//                    assets/build/env/props/kn_props.glb + .json (45 props); --sheet-props renders m3_props.png
//   --env-tinker     tools/blender/env_tinker.py -> assets/build/env/tinker/tinker.glb, .env.json, ibl_tinker_lab.hdr
//                    (+ .json), lut_tinker_lab.png and packages/parts-data/src/env_tinker.ts; with --render also
//                    art/style-samples/m3_tinker_lab.png (hero with the key-art machine + the Room view, value check)
//   --kitchen-pass   art/style-samples/m3_kitchen_pass.png from the exported kitchen.glb (run --env-kitchen first;
//                    env_kitchen.py now carries the pass)
//   --env-backlot    tools/blender/props/env_backlot.py -> assets/build/env/backlot/** (terrain layers, default Arena
//                    heightfield, dressing glb, backlot.json); with --render also art/style-samples/m3_backlot.png
const STYLE = join(ROOT, 'art', 'style-samples');
if (flags.has('--props')) blender('props kit', null, join('props', 'build_props.py'));
if (flags.has('--sheet-props') || (flags.has('--props') && flags.has('--render'))) {
  blender('sheet props', null, join('props', 'render_props.py'), [join(STYLE, 'm3_props.png')]);
}
if (flags.has('--env-tinker')) {
  blender('env tinker', null, 'env_tinker.py');
  if (flags.has('--render')) blender('render tinker', null, join('props', 'render_tinker.py'), [join(STYLE, 'm3_tinker_lab.png'), '--both']);
}
if (flags.has('--kitchen-pass') || (flags.has('--env-kitchen') && flags.has('--render'))) {
  blender('render kitchen pass', null, join('props', 'render_kitchen_pass.py'), [join(STYLE, 'm3_kitchen_pass.png'), '--both']);
}
if (flags.has('--env-backlot')) {
  // dress the sim's own default lot (S3, packages/format defaultTerrain), exported as raw u16 first
  const lot = join(BUILD, 'env', 'backlot', 'backlot_arena.sim.r16');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(TOOLS, 'props', 'export_default_lot.ts'), 'arena', lot],
    { cwd: ROOT, encoding: 'utf8' });
  console.log(`[default lot] ${r.status === 0 ? 'ok' : 'FAILED (art fallback heightfield)'} ${(r.stdout ?? '').trim()}`);
  blender('env backlot', null, join('props', 'env_backlot.py'),
    ['--sim-lot', lot, ...(flags.has('--render') ? ['--render', join(STYLE, 'm3_backlot.png')] : [])]);
}
// M5 (stream E5c): ORBITAL HANGAR and MOON BASE (environments.md §5, §6).
//   --env-hangar  tools/blender/env_hangar.py -> assets/build/env/hangar/hangar_{warehouse,arena}.glb, ibl_hangar_*.hdr
//                 (+ .json), lut_hangar.png, hangar.env.json and packages/parts-data/src/env_hangar.ts; with --render
//                 also art/style-samples/m5_hangar.png (Bay 2) and m5_hangar_arena.png (Main Hall)
//   --env-moon    tools/blender/env_moon.py -> assets/build/env/moon/moon.glb, the authored heightfield (r16 + png),
//                 terrain textures, ibl_moon.hdr (+ .json), lut_moon.png, moon.env.json and
//                 packages/parts-data/src/env_moon.ts; with --render also art/style-samples/m5_moon.png, m5_moon_room.png
if (flags.has('--env-hangar')) {
  blender('env hangar', null, 'env_hangar.py');
  if (flags.has('--render')) blender('render hangar', null, 'env_hangar.py', ['--render', join(STYLE, 'm5_hangar.png')]);
}
if (flags.has('--env-moon')) {
  blender('env moon', null, 'env_moon.py');
  if (flags.has('--render')) blender('render moon', null, 'env_moon.py', ['--render', join(STYLE, 'm5_moon.png')]);
}
const CRITTER_SRC = join(SRC, 'critters', 'pip.blend');
if (flags.has('--selftest') && existsSync(CRITTER_SRC)) blender('selftest critter (rule 11)', CRITTER_SRC, 'selftest_critter.py');
console.log(`\nassets: ${done.length} part(s) built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const [t, r] of done) console.log(`  ${t}: ${Object.values(r.outputs).map((p) => p.replace(ROOT, '.')).join(', ')}`);
