// M5 critter (stream E5b): BUZZ's exported skinned glb against the rig standard (ASSET_PIPELINE §6, validator rule
// 11), its D78 texture set (§5.2, + the KTX2 / BC7 build, D97), the brief (critters.md BUZZ) and stream B5's sim data
// (packages/parts-data/src/critters.ts): ragdoll row, drone collision, clip names. BUZZ is a rigid robot critter
// (kn_robot, as DUSTY): root + body + pennant_01–02 + pivot-mirror bones (rotors, visor, winch, claw fingers), an LED
// visor face (faceTracks) instead of morph targets, and one RAG__body box.
// Skipped with a message when the build is missing (run `node tools/assets.mjs buzz --ktx2`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRITTER_CLIPS, CRITTER_SPECS } from '../../parts-data/src/critters.ts';
import { ART_CRITTERS } from '../../../apps/game/src/artlist.ts';
import { assemblePartAssets, lodStats, type PartAssets } from '../src/index.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');
const T = 'buzz';
const REQUIRED = ['idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped',
  'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused'];
const ROLE = ['takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow'];
// critters.md: Buzz's visor shares Dusty's icon set
const ICONS = ['neutral', 'blink', 'happy', 'smug', 'scared', 'angry', 'dizzy', 'sleepy', 'surprised', 'determined', 'scan', 'strain'];
const PIVOT_BONES = ['rotor_fl', 'rotor_fr', 'rotor_bl', 'rotor_br', 'visor', 'winch', 'claw_a', 'claw_b', 'claw_c'];
const EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;
const MM = 0.0011;

type V3 = readonly [number, number, number];
interface RagArt {
  bone: string; name: string; parent: string | null; shape: string; radius: number; halfHeight: number; a: V3; b: V3;
  rootPos: V3; mass: number; swing: number; twist: number; phys: string; halfExtents?: V3;
}
interface BuzzArt {
  bounds: { min: V3; max: V3 };
  massHint: number;
  rig: { deformBones: number; rootPos: V3; bones: { name: string; parent: string | null; deform: boolean; head: V3 }[] };
  ragdoll: RagArt[];
  clipFps: number;
  clipInfo: { name: string; action: string; frames: number; seconds: number; loop: boolean }[];
  roleClips: string[];
  robot?: boolean;
  faceTracks?: Record<string, [number, string][]>;
  faceIcons?: string[];
  pivotBones?: Record<string, string>;
  pivots: { name: string; pos: V3; axis: V3; min?: number; max?: number; parent?: string; motion?: string }[];
  sensors: { name: string; kind: string; pos: V3; points: V3[]; pivot?: string }[];
  emitters: { name: string; fx: string; pos: V3; dirVec: V3 }[];
  emitterBones: Record<string, string>;
  screens: { name: string; kind: string; pos: V3; size: V3 }[];
  ledGroups: { index: number; name: string }[];
  textures?: { albedo: string; normal: string; orm: string; size: number; set: string; slots: string[]; ktx2?: Record<string, string> };
}
interface GltfJson {
  nodes: { name?: string; mesh?: number }[];
  meshes: { name?: string; extras?: { targetNames?: string[] }; primitives: { attributes: Record<string, number>; material?: number; targets?: unknown[] }[] }[];
  materials: { name?: string; extras?: { texSet?: string } }[];
}

function load(): { assets: PartAssets; art: BuzzArt; json: GltfJson } | null {
  const base = join(BUILD, T, T);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const bytes = readFileSync(`${base}.glb`);
  const artRaw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as Record<string, unknown>;
  const assets = assemblePartAssets(T, bytes, artRaw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8')) as GltfJson;
  return { assets, art: artRaw as unknown as BuzzArt, json };
}

function pngInfo(path: string): { w: number; h: number; depth: number } {
  const b = readFileSync(path);
  expect(b.readUInt32BE(0)).toBe(0x89504e47);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24]! };
}

const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((x, i) => Math.abs(x - b[i]!) <= tol);
// brief root space (x, y, z), front −Y → engine (x, z, −y)
const bl = (x: number, y: number, z: number): V3 => [x, z, y === 0 ? 0 : -y];

const c = load();
describe.skipIf(!c)(`M5 critter buzz${c ? '' : ' (no build: run `node tools/assets.mjs buzz --ktx2`)'}`, () => {
  const { assets, art, json } = c!;
  const glb = assets.glb;
  const spec = (CRITTER_SPECS as Record<string, (typeof CRITTER_SPECS)[keyof typeof CRITTER_SPECS] | undefined>)[T];
  const root = (): V3 => art.rig.rootPos;
  const rootSpace = (p: V3): V3 => [p[0] - root()[0], p[1] - root()[1], p[2] - root()[2]];

  it('is a robot critter with LOD0..3 at 50 / 25 / 8 % within the robot-critter budget (≈ 22k)', () => {
    expect(assets.art.family).toBe('critters');
    expect(assets.art.origin).toBe('com');
    const t0 = assets.art.lods[0]!.tris;
    expect(t0).toBeGreaterThanOrEqual(20000);
    expect(t0).toBeLessThanOrEqual(23000);
    [0.5, 0.25, 0.08].forEach((r, i) => expect(Math.abs(assets.art.lods[i + 1]!.tris / t0 / r - 1)).toBeLessThanOrEqual(0.1));
    for (let l = 0; l < 4; l++) expect(lodStats(glb, l).triangles).toBe(assets.art.lods[l]!.tris);
    expect(art.massHint).toBeCloseTo(1.1, 6);
  });

  it('matches the brief size: 0.34 m span, skids on the floor, body top 0.085, antenna tip 0.145', () => {
    const lo = art.bounds.min, hi = art.bounds.max;
    expect(Math.abs(hi[0] - lo[0] - 0.34)).toBeLessThan(0.003);
    expect(Math.abs(hi[2] - lo[2] - 0.34)).toBeLessThan(0.006); // + the nav domes on the front ducts
    expect(Math.abs(lo[1] - root()[1])).toBeLessThan(0.001); // skids at z 0
    expect(Math.abs(hi[1] - root()[1] - 0.147)).toBeLessThan(0.003); // the whip's tip ball
    const st = lodStats(glb, 0);
    expect(Math.abs(st.min[1] - root()[1])).toBeLessThan(0.001);
  });

  it('rig: one skin, root + body + pennant_01–02 + the nine pivot-mirror bones, root under the COM', () => {
    expect(glb.skins.length).toBe(1);
    const names = art.rig.bones.map((b) => b.name);
    expect(new Set(names)).toEqual(new Set(['root', 'body', 'pennant_01', 'pennant_02', ...PIVOT_BONES]));
    expect(art.rig.deformBones).toBe(13);
    expect(art.rig.bones.filter((b) => b.parent === null).map((b) => b.name)).toEqual(['root']);
    const parent = Object.fromEntries(art.rig.bones.map((b) => [b.name, b.parent]));
    expect(parent['body']).toBe('root');
    for (const b of ['rotor_fl', 'rotor_fr', 'rotor_bl', 'rotor_br', 'visor', 'winch', 'pennant_01']) expect(parent[b], b).toBe('body');
    for (const b of ['claw_a', 'claw_b', 'claw_c']) expect(parent[b], b).toBe('winch');
    expect(parent['pennant_02']).toBe('pennant_01');
    const joints = glb.skins[0]!.joints.map((j) => glb.nodes[j]!.name);
    expect(new Set(joints)).toEqual(new Set(names));
    expect(Math.abs(root()[0])).toBeLessThan(1e-4);
    expect(root()[1]).toBeCloseTo(-0.055, 4);
  });

  it('every LOD mesh is skinned with <= 4 normalised influences', () => {
    const meshes = glb.meshes.filter((m) => m.lod >= 0);
    expect(new Set(meshes.map((m) => m.lod))).toEqual(new Set([0, 1, 2, 3]));
    for (const m of meshes) {
      expect(m.skin).toBe(0);
      for (const p of m.primitives) {
        for (let v = 0; v < p.vertexCount; v++) {
          const s = p.weights![v * 4]! + p.weights![v * 4 + 1]! + p.weights![v * 4 + 2]! + p.weights![v * 4 + 3]!;
          expect(Math.abs(s - 1)).toBeLessThan(0.01);
        }
      }
    }
    for (const mesh of json.meshes) for (const p of mesh.primitives) expect(p.attributes['JOINTS_1']).toBeUndefined();
  });

  it('carries the 17 required + 6 role clips, every one in CRITTER_CLIPS and the sim spec, at 30 fps, no root motion', () => {
    const anims = new Map(glb.animations.map((a) => [a.name, a]));
    for (const clip of [...REQUIRED, ...ROLE, ...(spec?.clips ?? [])]) expect(anims.has(`${T}__${clip}`), clip).toBe(true);
    expect(new Set(art.roleClips)).toEqual(new Set(ROLE));
    for (const clip of assets.art.clips) expect((CRITTER_CLIPS as readonly string[]).includes(clip), clip).toBe(true);
    expect(art.clipFps).toBe(30);
    const rootNode = glb.nodes.findIndex((n) => n.name === 'root');
    for (const info of art.clipInfo) {
      const a = anims.get(info.action)!;
      for (const ch of a.channels) {
        const s = a.samplers[ch.sampler]!;
        if (s.input.length > 2) expect(s.input.length).toBe(info.frames + 1); // constant channels keep 2 keys
        expect(Math.abs(s.input[s.input.length - 1]! - info.seconds)).toBeLessThan(1e-3);
        if (ch.node === rootNode) {
          const w = s.output.length / s.input.length;
          for (let k = 1; k < s.input.length; k++) for (let i = 0; i < w; i++) expect(Math.abs(s.output[k * w + i]! - s.output[i]!)).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('loops are seamless; one-shots end at rest height (altitude is the sim\'s)', () => {
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
    const body = glb.nodes.findIndex((n) => n.name === 'body');
    const bodyRest = art.rig.bones.find((b) => b.name === 'body')!;
    expect(bodyRest).toBeDefined();
    for (const info of art.clipInfo.filter((i) => !i.loop)) {
      const a = glb.animations.find((x) => x.name === info.action)!;
      const ch = a.channels.find((x) => x.node === body && x.path === 'translation');
      if (!ch) continue;
      const s = a.samplers[ch.sampler]!;
      const n = s.input.length;
      const first = [s.output[0]!, s.output[1]!, s.output[2]!];
      const last = [s.output[(n - 1) * 3]!, s.output[(n - 1) * 3 + 1]!, s.output[(n - 1) * 3 + 2]!];
      if (info.name !== 'getup') expect(near(first, last, 0.002), `${info.name} ends where it starts`).toBe(true);
    }
  });

  it('robot: an LED visor track on every clip with Dusty\'s icon set, pivots name their bones, no morph targets', () => {
    expect(art.robot).toBe(true);
    expect(new Set(art.faceIcons)).toEqual(new Set(ICONS));
    for (const info of art.clipInfo) {
      const tr = art.faceTracks?.[info.name];
      expect(tr, info.name).toBeDefined();
      expect(tr![0]![0]).toBe(0);
      for (const [f, icon] of tr!) {
        expect(ICONS).toContain(icon);
        expect(f).toBeLessThanOrEqual(info.frames);
      }
    }
    const bones = new Set(art.rig.bones.map((b) => b.name));
    for (const b of PIVOT_BONES) {
      expect(art.pivotBones![`PIVOT__${b}`], b).toBe(b);
      expect(bones.has(b)).toBe(true);
    }
    for (const n of json.nodes.filter((x) => x.mesh !== undefined)) expect(json.meshes[n.mesh!]!.extras?.targetNames ?? []).toEqual([]);
    expect(art.screens.map((s) => [s.name, s.kind])).toEqual([['face', 'icon']]);
    const face = art.screens[0]!;
    expect(near(rootSpace(face.pos), bl(0, -0.0679, 0.068), 0.001)).toBe(true);
    expect(near([face.size[0], face.size[1]], [0.07, 0.025], 0.0005)).toBe(true);
    expect(art.ledGroups.map((g) => g.name)).toEqual(['nav', 'ducts', 'cargo', 'strobe']);
  });

  it('pivots: four vertical rotors on the duct centres, the visor nod, the 0.60 m winch and three claw hinges under it', () => {
    const piv = new Map(art.pivots.map((p) => [p.name, p]));
    for (const [k, x, y] of [['fl', 0.115, -0.115], ['fr', -0.115, -0.115], ['bl', 0.115, 0.115], ['br', -0.115, 0.115]] as const) {
      const p = piv.get(`rotor_${k}`)!;
      expect(near(rootSpace(p.pos), bl(x, y, 0.066), 0.0005), k).toBe(true);
      expect(Math.abs(p.axis[1])).toBeCloseTo(1, 5);
    }
    const visor = piv.get('visor')!;
    expect(near(rootSpace(visor.pos), bl(0, -0.055, 0.075), 0.0005)).toBe(true);
    expect([visor.min, visor.max]).toEqual([-12, 12]);
    const winch = piv.get('winch')!;
    expect(near(rootSpace(winch.pos), bl(0, 0, 0.022), 0.0005)).toBe(true);
    expect([winch.min, winch.max, winch.motion]).toEqual([-0.6, 0, 'slide']);
    for (const k of ['claw_a', 'claw_b', 'claw_c']) {
      const p = piv.get(k)!;
      expect(p.parent).toBe('winch');
      expect([p.min, p.max]).toEqual([0, 40]);
      expect(Math.abs(p.axis[1])).toBeLessThan(1e-4); // a horizontal tangent hinge
    }
  });

  it('claw: SENSOR__catch__claw (sphere Ø 0.06) rides the winch; EMIT__carry__claw on the winch bone', () => {
    const s = art.sensors.find((x) => x.name === 'claw')!;
    expect(s.kind).toBe('catch');
    expect(s.pivot).toBe('winch');
    const r = Math.max(...s.points.map((p) => Math.hypot(p[0], p[1], p[2])));
    expect(r).toBeCloseTo(0.03, 3);
    expect(near(rootSpace(s.pos), bl(0, 0, 0.008), 0.001)).toBe(true);
    expect(art.emitterBones['EMIT__carry__claw']).toBe('winch');
    expect(art.emitterBones['EMIT__voice__visor']).toBe('visor');
    for (const k of ['fl', 'fr', 'bl', 'br']) expect(art.emitters.some((e) => e.name === `rotor_${k}` && e.fx === 'downwash' && e.dirVec[1] < -0.99), k).toBe(true);
    for (const e of ['spark', 'emote']) expect(art.emitters.some((x) => x.fx === e), e).toBe(true);
  });

  it('collision agrees with the brief and B5\'s drone body: body box, four rubber duct cylinders, skid box', () => {
    const shapes = assets.shapes.shapes as unknown as { kind: string; name: string; pos: V3; size?: V3; radius?: number; halfHeight?: number; phys?: string }[];
    const boxes = shapes.filter((s) => s.kind === 'box');
    const cyls = shapes.filter((s) => s.kind === 'cylinder');
    expect(boxes.length).toBe(2);
    expect(cyls.length).toBe(4);
    for (const cy of cyls) {
      expect(cy.radius).toBeCloseTo(0.055, 4);
      expect(2 * cy.halfHeight!).toBeCloseTo(0.035, 4);
      expect(cy.phys).toBe('rubber');
      const p = rootSpace(cy.pos);
      expect(Math.abs(Math.abs(p[0]) - 0.115) + Math.abs(Math.abs(p[2]) - 0.115) + Math.abs(p[1] - 0.066)).toBeLessThan(0.001);
    }
    const drone = (spec as unknown as { drone?: { body: { size: V3; at: V3 }; skids: { size: V3; at: V3 }; ducts: { at: readonly V3[] } } } | undefined)?.drone;
    if (drone) {
      for (const want of [drone.body, drone.skids]) {
        expect(boxes.some((b) => near(rootSpace(b.pos), want.at, 0.001)), `box at ${want.at}`).toBe(true);
      }
      for (const at of drone.ducts.at) expect(cyls.some((cy) => near(rootSpace(cy.pos), at, 0.001)), `duct ${at}`).toBe(true);
    }
  });

  it('ragdoll: one rigid RAG__body box over the drone, agreeing with parts-data (B5)', () => {
    expect(art.ragdoll.length).toBe(1);
    const r = art.ragdoll[0]!;
    expect([r.name, r.shape, r.parent, r.swing, r.twist, r.phys]).toEqual(['RAG__body', 'box', null, 0, 0, 'powder']);
    expect(r.mass).toBeCloseTo(1.1, 6);
    expect(near(r.halfExtents!, [0.17, 0.045, 0.17], 1e-4)).toBe(true);
    expect(near(r.a, [0, 0, 0], MM) && near(r.b, [0, 0.09, 0], MM)).toBe(true);
    if (!spec) return;
    const sim = spec.ragdoll;
    expect(sim.length).toBe(1);
    const b = sim[0]! as (typeof sim)[number] & { halfExtents?: V3 };
    expect(b.bone).toBe('RAG__body');
    expect(r.shape).toBe(b.shape ?? 'capsule');
    expect(r.mass).toBeCloseTo(b.mass, 6);
    expect([r.swing, r.twist]).toEqual([b.swing, b.twist]);
    expect(Math.abs(r.radius - b.radius)).toBeLessThan(MM);
    expect(Math.abs(r.halfHeight - b.halfHeight)).toBeLessThan(MM);
    expect(near(r.a, b.a, MM) && near(r.b, b.b, MM) && near(r.rootPos, b.at, MM)).toBe(true);
    if (b.halfExtents) expect(near(r.halfExtents!, b.halfExtents, MM)).toBe(true);
    expect(spec.mass).toBeCloseTo(1.1, 6);
  });

  it('carries its D78 texture set at 2048² (robot critter) on every non-exempt slot, with the KTX2 / BC7 build', () => {
    const tx = art.textures!;
    expect(tx, 'textures').toBeDefined();
    expect(tx.size).toBe(2048);
    for (const [k, png] of [['albedo', tx.albedo], ['normal', tx.normal], ['orm', tx.orm]] as const) {
      const p = join(BUILD, T, png);
      expect(existsSync(p), p).toBe(true);
      const info = pngInfo(p);
      expect([info.w, info.h], k).toEqual([2048, 2048]);
      expect(info.depth).toBe(8);
    }
    const ktx = tx.ktx2 ?? {};
    for (const k of ['albedo', 'normal', 'orm']) {
      const f = ktx[k];
      expect(f, `ktx2 ${k}`).toBeDefined();
      const b = readFileSync(join(BUILD, T, f!));
      expect(b.subarray(1, 7).toString('latin1')).toBe('KTX 20');
    }
    const textured = json.materials.filter((m) => m.name && !EXEMPT.test(m.name));
    expect(new Set(textured.map((m) => m.name))).toEqual(new Set(['kn_powder_bone', 'kn_powder_graphite', 'kn_fabric_ignition', 'kn_rubber', 'kn_powder_graphite_gloss']));
    for (const m of textured) expect(m.extras?.texSet, m.name).toBe(tx.set);
    for (const mesh of json.meshes) for (const p of mesh.primitives) {
      const mat = json.materials[p.material!];
      if (!mat?.name || EXEMPT.test(mat.name)) continue;
      expect(p.attributes['TEXCOORD_0'], mesh.name).toBeDefined();
      expect(p.attributes['TANGENT'], mesh.name).toBeDefined();
    }
  });

  it('is registered for the renderer (artlist ART_CRITTERS)', () => {
    expect(ART_CRITTERS).toContain(T);
  });
});
