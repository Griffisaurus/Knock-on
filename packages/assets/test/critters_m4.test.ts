// M4 critters (stream E4b): BISCUIT, HENNY and DUSTY's exported skinned glbs against the rig standard (ASSET_PIPELINE
// §6, validator rule 11), their D78 texture sets (§5.2) and stream B4's sim data (packages/parts-data/src/critters.ts):
// ragdoll rows, locomotion shape and clip names must agree. DUSTY is a rigid robot critter (kn_robot): root + body +
// pivot-mirror bones, an LED face (faceTracks) instead of morph targets, and one RAG__body cylinder.
// Critters whose build is missing are skipped with a message (run `node tools/assets.mjs <critter>`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRITTER_CLIPS, CRITTER_SPECS, type Species } from '../../parts-data/src/critters.ts';
import { ART_CRITTERS } from '../../../apps/game/src/artlist.ts';
import { assemblePartAssets, lodStats, parseGlb, type PartAssets } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const M4: Species[] = ['biscuit', 'henny', 'dusty'];
const ROBOT = new Set<string>(['dusty']);
const REQUIRED = ['idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped',
  'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused'];
const ROLE: Record<string, string[]> = {
  biscuit: ['bark', 'bark_run', 'wake_startle', 'barge', 'tail_wag', 'shake_off'],
  henny: ['flap', 'lay_egg', 'glide_down', 'peck', 'scratch', 'proud_puff'],
  dusty: ['suck', 'bin_full', 'bump_turn'],
};
const EXTRA_KEYS: Record<string, string[]> = {
  biscuit: ['sk_tongue_out', 'sk_jowl_puff', 'sk_nose_wrinkle'],
  henny: ['sk_beak_wide', 'sk_feather_fluff', 'sk_comb_flop'],
};
const FACE = ['sk_blink_l', 'sk_blink_r', 'sk_happy', 'sk_smug', 'sk_scared', 'sk_angry', 'sk_dizzy', 'sk_sleepy',
  'sk_surprised', 'sk_determined', 'sk_vis_a', 'sk_vis_o', 'sk_vis_e'];
const TEX_SIZE: Record<string, number> = { biscuit: 4096, henny: 4096, dusty: 2048 };
const EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;
const MM = 0.0011;

type V3 = readonly [number, number, number];
interface RagArt {
  bone: string; name: string; parent: string | null; shape: string; radius: number; halfHeight: number; a: V3; b: V3;
  rootPos: V3; mass: number; swing: number; twist: number; phys: string;
}
interface CritterArt {
  rig: { deformBones: number; root: string; rootPos: V3; bones: { name: string; parent: string | null; deform: boolean }[] };
  ragdoll: RagArt[];
  clipFps: number;
  clipInfo: { name: string; action: string; frames: number; seconds: number; loop: boolean }[];
  shapeKeys: string[];
  roleClips: string[];
  robot?: boolean;
  faceTracks?: Record<string, [number, string][]>;
  faceIcons?: string[];
  pivotBones?: Record<string, string>;
  textures?: { albedo: string; normal: string; orm: string; size: number; set: string; slots: string[] };
  pivots?: { name: string }[];
  screens?: { name: string; kind: string }[];
}
interface GltfJson {
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes: { name?: string; extras?: { targetNames?: string[] }; primitives: { attributes: Record<string, number>; material?: number; targets?: unknown[] }[] }[];
  materials: { name?: string; extras?: { texSet?: string } }[];
}

function load(t: string): { assets: PartAssets; art: CritterArt; json: GltfJson } | null {
  const base = join(BUILD, t, t);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const bytes = readFileSync(`${base}.glb`);
  const artRaw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as Record<string, unknown>;
  const assets = assemblePartAssets(t, bytes, artRaw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8')) as GltfJson;
  return { assets, art: artRaw as unknown as CritterArt, json };
}

/** PNG IHDR: width, height, bit depth, colour type. */
function pngInfo(path: string): { w: number; h: number; depth: number; ctype: number } {
  const b = readFileSync(path);
  expect(b.readUInt32BE(0)).toBe(0x89504e47);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24]!, ctype: b[25]! };
}

const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((x, i) => Math.abs(x - b[i]!) <= tol);

for (const t of M4) {
  const c = load(t);
  describe.skipIf(!c)(`M4 critter ${t}${c ? '' : ' (no build: run `node tools/assets.mjs ' + t + '`)'}`, () => {
    const { assets, art, json } = c!;
    const spec = CRITTER_SPECS[t];
    const glb = assets.glb;
    const robot = ROBOT.has(t);

    it('is a critter part with LOD0..3 at 50 / 25 / 8 % within its class budget', () => {
      expect(assets.art.family).toBe('critters');
      expect(assets.art.origin).toBe('com');
      const t0 = assets.art.lods[0]!.tris;
      // XL critters 25k-60k; robot critters 15k-25k (ASSET_PIPELINE §4)
      expect(t0).toBeGreaterThanOrEqual(robot ? 15000 : 25000);
      expect(t0).toBeLessThanOrEqual(robot ? 25000 : 60000);
      [0.5, 0.25, 0.08].forEach((r, i) => expect(Math.abs(assets.art.lods[i + 1]!.tris / t0 / r - 1)).toBeLessThanOrEqual(0.1));
      for (let l = 0; l < 4; l++) expect(lodStats(glb, l).triangles).toBe(assets.art.lods[l]!.tris);
    });

    it('rig: one skin, <= 80 deform bones, root on the floor under the COM, the standard bones', () => {
      expect(glb.skins.length).toBe(1);
      expect(art.rig.deformBones).toBeLessThanOrEqual(80);
      const names = art.rig.bones.map((b) => b.name);
      for (const b of robot ? ['root', 'body'] : ['root', 'head', 'spine_01', 'spine_02', 'spine_03']) expect(names).toContain(b);
      expect(art.rig.bones.filter((b) => b.parent === null).map((b) => b.name)).toEqual(['root']);
      expect(names.filter((n) => /^tail_\d\d$/.test(n)).length).toBeLessThanOrEqual(8);
      const joints = glb.skins[0]!.joints.map((j) => glb.nodes[j]!.name);
      expect(new Set(joints)).toEqual(new Set(names));
      const root = art.rig.rootPos;
      expect(Math.abs(root[0])).toBeLessThan(1e-4);
      expect(root[1]).toBeLessThan(0);
      expect(Math.abs(root[1] - lodStats(glb, 0).min[1])).toBeLessThan(0.006); // feet / wheels on the floor
      if (!robot) expect(art.rig.deformBones).toBeGreaterThanOrEqual(40);
    });

    it('every LOD mesh is skinned with <= 4 normalised influences (JOINTS_0 / WEIGHTS_0 only)', () => {
      const meshes = glb.meshes.filter((m) => m.lod >= 0);
      expect(new Set(meshes.map((m) => m.lod))).toEqual(new Set([0, 1, 2, 3]));
      for (const m of meshes) {
        expect(m.skin).toBe(0);
        for (const p of m.primitives) {
          expect(p.joints).not.toBeNull();
          expect(p.weights).not.toBeNull();
          for (let v = 0; v < p.vertexCount; v++) {
            const s = p.weights![v * 4]! + p.weights![v * 4 + 1]! + p.weights![v * 4 + 2]! + p.weights![v * 4 + 3]!;
            expect(Math.abs(s - 1)).toBeLessThan(0.01);
          }
        }
      }
      for (const mesh of json.meshes) for (const p of mesh.primitives) expect(p.attributes['JOINTS_1']).toBeUndefined();
    });

    it('carries the brief clips and every clip the sim plays, at 30 fps with no root motion', () => {
      const anims = new Map(glb.animations.map((a) => [a.name, a]));
      const want = new Set([...REQUIRED, ...ROLE[t]!, ...(spec?.clips ?? [])]);
      for (const clip of want) expect(anims.has(`${t}__${clip}`), `${t}__${clip}`).toBe(true);
      expect(new Set(art.roleClips)).toEqual(new Set(ROLE[t]));
      for (const clip of assets.art.clips) expect((CRITTER_CLIPS as readonly string[]).includes(clip), clip).toBe(true);
      expect(art.clipFps).toBe(30);
      const rootNode = glb.nodes.findIndex((n) => n.name === 'root');
      for (const info of art.clipInfo) {
        const a = anims.get(info.action)!;
        expect(a, info.action).toBeDefined();
        for (const ch of a.channels) {
          const s = a.samplers[ch.sampler]!;
          const times = s.input;
          if (times.length > 2) {
            expect(times.length).toBe(info.frames + 1);
            expect(Math.abs(times[1]! - times[0]! - 1 / 30)).toBeLessThan(1e-4);
          }
          expect(Math.abs(times[times.length - 1]! - info.seconds)).toBeLessThan(1e-3);
          if (ch.node === rootNode) {
            const w = s.output.length / times.length;
            for (let k = 1; k < times.length; k++) for (let i = 0; i < w; i++) expect(Math.abs(s.output[k * w + i]! - s.output[i]!)).toBeLessThan(1e-5);
          }
          if (ch.path === 'scale') for (const v of s.output) expect(v).toBeGreaterThan(0.5), expect(v).toBeLessThan(2);
        }
      }
    });

    it('brief timings: BISCUIT bark 0.6 s, wake_startle 0.5 s, shake_off 1 s; HENNY flap 0.6 s, lay_egg 0.8 s; DUSTY suck 0.3 s', () => {
      const secs = Object.fromEntries(art.clipInfo.map((i) => [i.name, i.seconds]));
      const want: Record<string, Record<string, number>> = {
        biscuit: { bark: 0.6, wake_startle: 0.5, shake_off: 1.0 },
        henny: { flap: 0.6, lay_egg: 0.8 },
        dusty: { suck: 0.3 },
      };
      for (const [clip, s] of Object.entries(want[t]!)) expect(secs[clip], clip).toBeCloseTo(s, 3);
    });

    it('loops are seamless (first frame == last frame)', () => {
      for (const info of art.clipInfo.filter((i) => i.loop)) {
        const a = glb.animations.find((x) => x.name === info.action)!;
        for (const ch of a.channels) {
          const s = a.samplers[ch.sampler]!;
          const n = s.input.length, w = s.output.length / n;
          let d = 0;
          for (let i = 0; i < w; i++) d = Math.max(d, Math.abs(Math.abs(s.output[(n - 1) * w + i]!) - Math.abs(s.output[i]!)));
          expect(d, `${info.action} ${ch.path}`).toBeLessThan(1e-3);
        }
      }
    });

    it.skipIf(robot)('has the ART_BIBLE §8 face shape keys plus the brief extras as morph targets on LOD0', () => {
      const lod0 = json.nodes.find((n) => n.name === `${t}__body`)!;
      const mesh = json.meshes[lod0.mesh!]!;
      for (const k of [...FACE, ...EXTRA_KEYS[t]!]) expect(mesh.extras?.targetNames).toContain(k);
      expect(mesh.primitives.every((p) => (p.targets?.length ?? 0) === mesh.extras!.targetNames!.length)).toBe(true);
      expect(art.shapeKeys).toEqual(mesh.extras!.targetNames);
    });

    it.skipIf(!robot)('robot: an LED face track on every clip, pivots name their bones, eye and bin screens', () => {
      expect(art.robot).toBe(true);
      const icons = new Set(art.faceIcons);
      expect(icons.size).toBe(12);
      for (const info of art.clipInfo) {
        const tr = art.faceTracks?.[info.name];
        expect(tr, info.name).toBeDefined();
        expect(tr![0]![0]).toBe(0);
        for (const [f, icon] of tr!) {
          expect(icons.has(icon), `${info.name} ${icon}`).toBe(true);
          expect(f).toBeLessThanOrEqual(info.frames);
        }
      }
      const bones = new Set(art.rig.bones.map((b) => b.name));
      const piv = art.pivotBones!;
      for (const p of ['PIVOT__wheel_l', 'PIVOT__wheel_r', 'PIVOT__brush', 'PIVOT__bumper', 'PIVOT__lid', 'PIVOT__caster']) {
        expect(piv[p], p).toBeDefined();
        expect(bones.has(piv[p]!)).toBe(true);
      }
      expect(art.rig.bones.filter((b) => b.deform).length).toBe(8);
      const lod0 = json.nodes.find((n) => n.name === `${t}__body`)!;
      expect(json.meshes[lod0.mesh!]!.extras?.targetNames ?? []).toEqual([]);
    });

    it.skipIf(!spec)('ragdoll agrees with parts-data (B4, contract 3)', () => {
      const sim = spec.ragdoll;
      const byBone = new Map(art.ragdoll.map((r) => [r.bone, r]));
      expect(art.ragdoll.length).toBe(sim.length);
      const total = art.ragdoll.reduce((s, r) => s + r.mass, 0);
      expect(Math.abs(total - spec.mass)).toBeLessThan(1e-6);
      for (const b of sim) {
        const name = b.bone.replace(/^RAG__/, '');
        const r = byBone.get(name);
        expect(r, b.bone).toBeDefined();
        expect(r!.name).toBe(b.bone);
        expect(r!.shape).toBe(b.shape ?? 'capsule');
        expect(r!.parent).toBe(b.parent < 0 ? null : sim[b.parent]!.bone.replace(/^RAG__/, ''));
        expect(r!.mass).toBeCloseTo(b.mass, 6);
        expect(r!.swing).toBe(b.swing);
        expect(r!.twist).toBe(b.twist);
        expect(Math.abs(r!.radius - b.radius), `${b.bone} radius`).toBeLessThan(MM);
        expect(Math.abs(r!.halfHeight - b.halfHeight), `${b.bone} halfHeight`).toBeLessThan(MM);
        expect(near(r!.a, b.a, MM), `${b.bone} a ${r!.a} vs ${b.a}`).toBe(true);
        expect(near(r!.b, b.b, MM), `${b.bone} b ${r!.b} vs ${b.b}`).toBe(true);
        expect(near(r!.rootPos, b.at, MM), `${b.bone} at`).toBe(true);
        expect(art.rig.bones.find((x) => x.name === name)?.deform).toBe(true);
      }
    });

    it.skipIf(!spec)('locomotion shape agrees with parts-data', () => {
      const root = art.rig.rootPos;
      if (robot) {
        const col = assets.shapes.shapes.filter((s) => s.kind === 'cylinder');
        expect(col.length).toBe(1);
        const s = col[0]! as { radius: number; halfHeight: number; pos: [number, number, number] };
        const disc = spec.disc!;
        expect(Math.abs(s.radius - disc.radius)).toBeLessThan(MM);
        expect(Math.abs(2 * s.halfHeight - disc.height)).toBeLessThan(0.002);
        expect(near([s.pos[0] - root[0], s.pos[1] - root[1], s.pos[2] - root[2]], disc.at, 0.002)).toBe(true);
        return;
      }
      const col = assets.shapes.shapes.filter((s) => s.kind === 'capsule');
      expect(col.length).toBe(1);
      const s = col[0]! as { radius: number; halfHeight: number; pos: [number, number, number]; phys: string };
      expect(s.phys).toBe('fur');
      expect(Math.abs(s.radius - spec.capsule.radius)).toBeLessThan(MM);
      expect(Math.abs(2 * (s.halfHeight + s.radius) - spec.capsule.length)).toBeLessThan(0.002);
      const rootSpace = [s.pos[0] - root[0], s.pos[1] - root[1], s.pos[2] - root[2]];
      expect(near(rootSpace, spec.capsule.at, 0.002), `capsule at ${rootSpace} vs ${spec.capsule.at}`).toBe(true);
    });

    it('carries its D78 texture set (4096², robot critters 2048²) bound on every non-exempt slot', () => {
      const tx = art.textures!;
      expect(tx, 'textures').toBeDefined();
      expect(tx.size).toBe(TEX_SIZE[t]);
      for (const [k, png] of [['albedo', tx.albedo], ['normal', tx.normal], ['orm', tx.orm]] as const) {
        const p = join(BUILD, t, png);
        expect(existsSync(p), p).toBe(true);
        const info = pngInfo(p);
        expect([info.w, info.h], k).toEqual([TEX_SIZE[t], TEX_SIZE[t]]);
        expect(info.depth).toBe(8);
      }
      const textured = json.materials.filter((m) => m.name && !EXEMPT.test(m.name));
      expect(textured.length).toBeGreaterThan(0);
      for (const m of textured) expect(m.extras?.texSet, m.name).toBe(tx.set);
      for (const m of json.materials.filter((x) => x.name && EXEMPT.test(x.name))) expect(m.extras?.texSet).toBeUndefined();
      for (const mesh of json.meshes) for (const p of mesh.primitives) {
        const mat = json.materials[p.material!];
        if (!mat?.name || EXEMPT.test(mat.name)) continue;
        expect(p.attributes['TEXCOORD_0'], mesh.name).toBeDefined();
        expect(p.attributes['TANGENT'], mesh.name).toBeDefined();
      }
    });

    it('is registered for the renderer (artlist ART_CRITTERS)', () => {
      expect(ART_CRITTERS).toContain(t);
    });
  });
}

describe('M4 critter glbs parse with the shared reader', () => {
  it('parseGlb accepts every built M4 critter', () => {
    let n = 0;
    for (const t of M4) {
      const p = join(BUILD, t, `${t}.glb`);
      if (!existsSync(p)) continue;
      const g = parseGlb(readFileSync(p));
      expect(g.animations.length).toBeGreaterThanOrEqual(20);
      n++;
    }
    if (!n) console.warn('no M4 critter builds: run `node tools/assets.mjs biscuit henny dusty`');
  });
});
