// M2 critters (stream E2): the exported skinned glbs (tools/blender/make_<critter>.py) against the rig standard
// (ASSET_PIPELINE §6 / validator rule 11) and against stream B's sim data (packages/parts-data/src/critters.ts,
// contract 3): ragdoll capsules, locomotion capsule and clip names must agree.
// Critters whose build is missing are skipped with a message (run `node tools/assets.mjs <critter>`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRITTER_SPECS, type Species } from '../../parts-data/src/critters.ts';
import { assemblePartAssets, lodStats, parseGlb, type PartAssets } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const CRITTERS: Species[] = ['mochi', 'pip', 'goby', 'bandit'];
const REQUIRED = ['idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped',
  'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused'];
const FACE = ['sk_blink_l', 'sk_blink_r', 'sk_happy', 'sk_smug', 'sk_scared', 'sk_angry', 'sk_dizzy', 'sk_sleepy',
  'sk_surprised', 'sk_determined', 'sk_vis_a', 'sk_vis_o', 'sk_vis_e'];
const MM = 0.0011; // 1 mm (art.json rounds to 0.01 mm)

type V3 = readonly [number, number, number];
interface RagArt {
  bone: string; name: string; parent: string | null; radius: number; halfHeight: number; a: V3; b: V3; rootPos: V3;
  mass: number; swing: number; twist: number; phys: string; friction?: number; restitution?: number;
}
interface CritterArt {
  rig: { deformBones: number; root: string; rootPos: V3; bones: { name: string; parent: string | null; deform: boolean }[] };
  ragdoll: RagArt[];
  clipFps: number;
  clipInfo: { name: string; action: string; frames: number; seconds: number; loop: boolean }[];
  shapeKeys: string[];
  roleClips: string[];
}
interface GltfJson {
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes: { name?: string; extras?: { targetNames?: string[] }; primitives: { attributes: Record<string, number>; targets?: unknown[] }[] }[];
  animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
  skins: { joints: number[] }[];
}

function load(t: string): { assets: PartAssets; art: CritterArt; json: GltfJson; bytes: Uint8Array } | null {
  const base = join(BUILD, t, t);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const bytes = readFileSync(`${base}.glb`);
  const artRaw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as Record<string, unknown>;
  const assets = assemblePartAssets(t, bytes, artRaw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8')) as GltfJson;
  return { assets, art: artRaw as unknown as CritterArt, json, bytes: new Uint8Array(bytes) };
}

const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((x, i) => Math.abs(x - b[i]!) <= tol);

for (const t of CRITTERS) {
  const c = load(t);
  describe.skipIf(!c)(`critter ${t}${c ? '' : ' (no build: run `node tools/assets.mjs ' + t + '`)'}`, () => {
    const { assets, art, json } = c!;
    const spec = CRITTER_SPECS[t];
    const glb = assets.glb;

    it('is a critter part with LOD0..3 at 50 / 25 / 8 % and an XL budget', () => {
      expect(assets.art.family).toBe('critters');
      expect(assets.art.origin).toBe('com');
      const t0 = assets.art.lods[0]!.tris;
      expect(t0).toBeGreaterThanOrEqual(25000);
      expect(t0).toBeLessThanOrEqual(60000);
      [0.5, 0.25, 0.08].forEach((r, i) => expect(Math.abs(assets.art.lods[i + 1]!.tris / t0 / r - 1)).toBeLessThanOrEqual(0.1));
      for (let l = 0; l < 4; l++) expect(lodStats(glb, l).triangles).toBe(assets.art.lods[l]!.tris);
    });

    it('rig: one skin, <= 80 deform bones, root on the floor under the COM, the standard bones', () => {
      expect(glb.skins.length).toBe(1);
      expect(art.rig.deformBones).toBeLessThanOrEqual(80);
      const names = art.rig.bones.map((b) => b.name);
      for (const b of ['root', 'head', 'spine_01', 'spine_02', 'spine_03']) expect(names).toContain(b);
      expect(art.rig.bones.filter((b) => b.parent === null).map((b) => b.name)).toEqual(['root']);
      expect(names.filter((n) => /^tail_\d\d$/.test(n)).length).toBeLessThanOrEqual(8);
      // the skin's joints are the rig's bones (prop sockets included), by name
      const joints = glb.skins[0]!.joints.map((j) => glb.nodes[j]!.name);
      expect(new Set(joints)).toEqual(new Set(names));
      const root = art.rig.rootPos;
      expect(Math.abs(root[0])).toBeLessThan(1e-4);
      const lo = lodStats(glb, 0).min;
      expect(root[1]).toBeLessThan(0);
      expect(Math.abs(root[1] - lo[1])).toBeLessThan(0.015); // floor contact (Goby: the belly line)
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

    it('carries every clip the sim plays, as <type>__<clip> at 30 fps with no root motion', () => {
      const anims = new Map(glb.animations.map((a) => [a.name, a]));
      const want = new Set([...REQUIRED, ...spec.clips, ...art.roleClips]);
      for (const clip of want) expect(anims.has(`${t}__${clip}`), `${t}__${clip}`).toBe(true);
      expect(new Set(assets.art.clips)).toEqual(new Set([...want]));
      expect(art.clipFps).toBe(30);
      const rootNode = glb.nodes.findIndex((n) => n.name === 'root');
      for (const info of art.clipInfo) {
        const a = anims.get(info.action)!;
        expect(a, info.action).toBeDefined();
        for (const ch of a.channels) {
          const s = a.samplers[ch.sampler]!;
          const times = s.input;
          // sampled every frame (or reduced to 2 keys for a constant channel)
          if (times.length > 2) {
            expect(times.length).toBe(info.frames + 1);
            expect(Math.abs(times[1]! - times[0]! - 1 / 30)).toBeLessThan(1e-4);
          }
          expect(Math.abs(times[times.length - 1]! - info.seconds)).toBeLessThan(1e-3);
          if (ch.node === rootNode) {
            const w = s.output.length / times.length;
            for (let k = 1; k < times.length; k++) {
              for (let i = 0; i < w; i++) expect(Math.abs(s.output[k * w + i]! - s.output[i]!)).toBeLessThan(1e-5);
            }
          }
          if (ch.path === 'scale') for (const v of s.output) expect(v).toBeGreaterThan(0.5), expect(v).toBeLessThan(2);
        }
      }
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

    it('has the ART_BIBLE §8 face shape keys as morph targets on LOD0', () => {
      const lod0 = json.nodes.find((n) => n.name === `${t}__body`)!;
      const mesh = json.meshes[lod0.mesh!]!;
      for (const k of FACE) expect(mesh.extras?.targetNames).toContain(k);
      expect(mesh.primitives.every((p) => (p.targets?.length ?? 0) === mesh.extras!.targetNames!.length)).toBe(true);
      expect(art.shapeKeys).toEqual(mesh.extras!.targetNames);
    });

    it('ragdoll capsules agree with parts-data (contract 3)', () => {
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
        expect(r!.parent).toBe(b.parent < 0 ? null : sim[b.parent]!.bone.replace(/^RAG__/, ''));
        expect(r!.mass).toBeCloseTo(b.mass, 6);
        expect(r!.swing).toBe(b.swing);
        expect(r!.twist).toBe(b.twist);
        expect(Math.abs(r!.radius - b.radius), `${b.bone} radius`).toBeLessThan(MM);
        expect(Math.abs(r!.halfHeight - b.halfHeight), `${b.bone} halfHeight`).toBeLessThan(MM);
        expect(near(r!.a, b.a, MM), `${b.bone} a ${r!.a} vs ${b.a}`).toBe(true);
        expect(near(r!.b, b.b, MM), `${b.bone} b ${r!.b} vs ${b.b}`).toBe(true);
        expect(near(r!.rootPos, b.at, MM), `${b.bone} at`).toBe(true);
        expect(r!.phys).toBe('fur');
        expect(art.rig.bones.find((x) => x.name === name)?.deform).toBe(true);
      }
    });

    it('locomotion capsule (COL__capsule__0) agrees with parts-data', () => {
      const col = assets.shapes.shapes.filter((s) => s.kind === 'capsule');
      expect(col.length).toBe(1);
      const s = col[0]! as { radius: number; halfHeight: number; pos: [number, number, number]; phys: string };
      expect(s.phys).toBe('fur');
      expect(Math.abs(s.radius - spec.capsule.radius)).toBeLessThan(MM);
      expect(Math.abs(2 * (s.halfHeight + s.radius) - spec.capsule.length)).toBeLessThan(0.002);
      const root = art.rig.rootPos;
      const rootSpace = [s.pos[0] - root[0], s.pos[1] - root[1], s.pos[2] - root[2]];
      expect(near(rootSpace, spec.capsule.at, 0.002), `capsule at ${rootSpace} vs ${spec.capsule.at}`).toBe(true);
    });
  });
}

describe('critter glbs parse with the shared reader', () => {
  it('parseGlb accepts every built critter (sparse morph targets are not read)', () => {
    let n = 0;
    for (const t of CRITTERS) {
      const p = join(BUILD, t, `${t}.glb`);
      if (!existsSync(p)) continue;
      const g = parseGlb(readFileSync(p));
      expect(g.animations.length).toBeGreaterThanOrEqual(20);
      n++;
    }
    if (!n) console.warn('no critter builds: run `node tools/assets.mjs mochi pip goby bandit`');
  });
});
