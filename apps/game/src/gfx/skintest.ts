// A small rigged test critter ("worm") built in memory as a real GLB: a tapered tube skinned to a
// 4-joint chain (root → spine_01 → spine_02 → head), a rigid eye bar parented to `head`, and three clips
// (`worm__idle`, `worm__run`, `worm__tumble`). It exercises the whole path (glb skin + animation parsing,
// skinnedFromGlb, Rig, GPU skinning) until stream E's critter glbs land. `?debug&skintest=N` shows N.

import { encodeGlb, parseGlb, type ParsedGlb } from '@knockon/assets';

export function makeWormGlb(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let off = 0;
  const acc = (a: Float32Array | Uint16Array | Uint8Array, type: string, componentType: number, count: number, extra: Record<string, unknown> = {}): number => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const pad = (4 - (b.byteLength % 4)) % 4;
    chunks.push(b, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength });
    off += b.byteLength + pad;
    accessors.push({ bufferView: views.length - 1, componentType, count, type, ...extra });
    return accessors.length - 1;
  };

  // tube: rings every 2.5 cm up to 0.4 m, tapering 6 → 3 cm, capped
  const SIDES = 14, RINGS = 17, H = 0.4;
  const pos: number[] = [], nrm: number[] = [], jn: number[] = [], wt: number[] = [], idx: number[] = [];
  const rad = (y: number): number => 0.06 - 0.03 * (y / H) + 0.012 * Math.sin((y / H) * Math.PI);
  const weightsAt = (y: number): [number, number, number, number] => {
    const s = Math.min(2.999, Math.max(0, y / 0.1 - 0.5));
    const k = Math.floor(s), f = s - k;
    return [k, k + 1, 1 - f, f];
  };
  for (let r = 0; r < RINGS; r++) {
    const y = (r / (RINGS - 1)) * H;
    const [ja, jb, wa, wb] = weightsAt(y);
    for (let s = 0; s <= SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2;
      pos.push(Math.cos(a) * rad(y), y, Math.sin(a) * rad(y));
      nrm.push(Math.cos(a), 0.1, Math.sin(a));
      jn.push(ja, jb, 0, 0); wt.push(wa, wb, 0, 0);
    }
  }
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SIDES; s++) {
      const a = r * (SIDES + 1) + s, b = a + SIDES + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  for (const [y, up] of [[0, -1], [H, 1]] as const) {
    const c = pos.length / 3;
    const [ja, jb, wa, wb] = weightsAt(y);
    pos.push(0, y, 0); nrm.push(0, up, 0); jn.push(ja, jb, 0, 0); wt.push(wa, wb, 0, 0);
    for (let s = 0; s <= SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2;
      pos.push(Math.cos(a) * rad(y), y, Math.sin(a) * rad(y)); nrm.push(0, up, 0); jn.push(ja, jb, 0, 0); wt.push(wa, wb, 0, 0);
    }
    for (let s = 0; s < SIDES; s++) { if (up > 0) idx.push(c, c + s + 2, c + s + 1); else idx.push(c, c + s + 1, c + s + 2); }
  }
  const nv = pos.length / 3;
  const aPos = acc(new Float32Array(pos), 'VEC3', 5126, nv, { min: [-0.07, 0, -0.07], max: [0.07, H, 0.07] });
  const aNrm = acc(new Float32Array(nrm.map((v, i) => { const b = i - (i % 3); const l = Math.hypot(nrm[b]!, nrm[b + 1]!, nrm[b + 2]!); return v / l; })), 'VEC3', 5126, nv);
  const aJ = acc(new Uint8Array(jn), 'VEC4', 5121, nv);
  const aW = acc(new Float32Array(wt), 'VEC4', 5126, nv);
  const aIdx = acc(new Uint16Array(idx), 'SCALAR', 5123, idx.length);
  // eye bar: an unskinned box under `head` (rides the joint rigidly)
  const ep: number[] = [], en: number[] = [], ei: number[] = [];
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void => {
    const faces: [number[], number[], number[]][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    for (const [f, u, w] of faces) {
      const b = ep.length / 3;
      for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ep.push(cx + 0.5 * sx * (f[0]! + p * u[0]! + q * w[0]!), cy + 0.5 * sy * (f[1]! + p * u[1]! + q * w[1]!), cz + 0.5 * sz * (f[2]! + p * u[2]! + q * w[2]!));
        en.push(f[0]!, f[1]!, f[2]!);
      }
      ei.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  box(0, 0.06, 0.035, 0.06, 0.018, 0.012); // local to `head` (head sits at y 0.3)
  const aEp = acc(new Float32Array(ep), 'VEC3', 5126, ep.length / 3, { min: [-0.03, 0.051, 0.029], max: [0.03, 0.069, 0.041] });
  const aEn = acc(new Float32Array(en), 'VEC3', 5126, en.length / 3);
  const aEi = acc(new Uint16Array(ei), 'SCALAR', 5123, ei.length);
  // inverse bind matrices: joint i sits at y = 0.1 i
  const ibm = new Float32Array(64);
  for (let j = 0; j < 4; j++) ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.1 * j, 0, 1], j * 16);
  const aIbm = acc(ibm, 'MAT4', 5126, 4);

  // clips
  const qz = (deg: number): number[] => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];
  const qx = (deg: number): number[] => [Math.sin((deg * Math.PI) / 360), 0, 0, Math.cos((deg * Math.PI) / 360)];
  const animations: Record<string, unknown>[] = [];
  const clip = (name: string, times: number[], tracks: { node: number; keys: number[][] }[]): void => {
    const tIn = acc(new Float32Array(times), 'SCALAR', 5126, times.length, { min: [times[0]], max: [times.at(-1)] });
    const samplers: Record<string, unknown>[] = [], channels: Record<string, unknown>[] = [];
    for (const tr of tracks) {
      const out = acc(new Float32Array(tr.keys.flat()), 'VEC4', 5126, tr.keys.length);
      samplers.push({ input: tIn, output: out, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: tr.node, path: 'rotation' } });
    }
    animations.push({ name, samplers, channels });
  };
  const N = 9;
  const ts = (dur: number): number[] => Array.from({ length: N }, (_, i) => (i / (N - 1)) * dur);
  clip('worm__idle', ts(2), [2, 3, 4].map((node, k) => ({ node, keys: ts(1).map((u) => qz(7 * Math.sin(u * Math.PI * 2 + k * 0.7))) })));
  clip('worm__run', ts(0.6), [2, 3, 4].map((node, k) => ({ node, keys: ts(1).map((u) => qx(24 * Math.sin(u * Math.PI * 2 + k * 1.2))) })));
  clip('worm__tumble', [0, 0.5, 1], [{ node: 1, keys: [qx(0), qx(50), qx(90)] }]);

  const json = {
    asset: { version: '2.0', generator: 'knock-on skintest' },
    scene: 0,
    scenes: [{ nodes: [0, 6] }],
    nodes: [
      { name: 'Armature', children: [1] },
      { name: 'root', children: [2] },
      { name: 'spine_01', translation: [0, 0.1, 0], children: [3] },
      { name: 'spine_02', translation: [0, 0.1, 0], children: [4] },
      { name: 'head', translation: [0, 0.1, 0], children: [5] },
      { name: 'eyes', mesh: 1 },
      { name: 'body', mesh: 0, skin: 0 },
    ],
    meshes: [
      { name: 'body', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: aIdx, material: 0 }] },
      { name: 'eyes', primitives: [{ attributes: { POSITION: aEp, NORMAL: aEn }, indices: aEi, material: 1 }] },
    ],
    materials: [
      { name: 'kn_fur_worm', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.42, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.75 } },
      { name: 'kn_eye', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.03, 1], metallicFactor: 0, roughnessFactor: 0.15 } },
    ],
    skins: [{ name: 'worm_rig', joints: [1, 2, 3, 4], inverseBindMatrices: aIbm, skeleton: 1 }],
    animations,
    buffers: [{ byteLength: off }],
    bufferViews: views,
    accessors,
  };
  const bin = new Uint8Array(off);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  return encodeGlb(json, bin);
}

export function wormGlb(): ParsedGlb { return parseGlb(makeWormGlb()); }
