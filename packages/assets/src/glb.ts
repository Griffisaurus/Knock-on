// Dependency-free GLB (binary glTF 2.0) reader for the part pipeline's output (ASSET_PIPELINE §8).
// Scope is what kn_tools exports: triangle meshes, node hierarchies (LOD0..LOD3, pivots),
// metallic-roughness factors, and (M2, critters) skins (JOINTS_0 / WEIGHTS_0, inverse bind matrices)
// animations (TRS channels; morph-weight channels are kept raw) and morph targets (POSITION / NORMAL
// deltas, sparse accessors included; names from mesh.extras.targetNames). Anything else (Draco, meshopt,
// non-triangle modes) throws instead of loading partially (DATA_FORMATS: "never partially load").
//
// Skinned meshes follow glTF: their vertices stay in bind space (the mesh node's own transform is
// ignored; joint matrices place them), so a skinned GlbMesh has an identity `matrix`.

export class GlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlbError';
  }
}

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface GlbMaterial {
  name: string;
  baseColorFactor: Vec4;
  metallicFactor: number;
  roughnessFactor: number;
  emissiveFactor: Vec3;
  /** M3 (E3c): material extras.texSet — the part's texture set (`.art.json textures.set`) covers this slot. */
  texSet?: string;
}

export interface GlbPrimitive {
  /** xyz, already transformed by the node's world matrix (part-local, engine Y-up metres). */
  positions: Float32Array;
  /** xyz unit normals in the same space, or null when the file has none. */
  normals: Float32Array | null;
  /** uv pairs (TEXCOORD_0), or null. */
  uvs: Float32Array | null;
  /** JOINTS_0: 4 joint indices per vertex (indices into the skin's `joints`), or null. */
  joints: Uint16Array | null;
  /** WEIGHTS_0: 4 weights per vertex, renormalised to sum 1, or null. */
  weights: Float32Array | null;
  /** Morph targets (shape keys): per target, xyz deltas per vertex in the same space as `positions`. */
  targets: GlbMorphTarget[];
  indices: Uint16Array | Uint32Array;
  /** Index into ParsedGlb.materials, or -1. */
  material: number;
  vertexCount: number;
  triangleCount: number;
}

export interface GlbMorphTarget {
  positions: Float32Array | null;
  normals: Float32Array | null;
}

export interface GlbMesh {
  meshName: string;
  nodeName: string;
  /** Index into ParsedGlb.nodes (walk `parent` for pivots: kn_tools exports moving pieces under `PIVOT__*`). */
  node: number;
  /** 0..3 when the node sits under an `LOD<n>` node (kn_tools layout), else -1. */
  lod: number;
  /** The node's world matrix (column-major), already applied to the primitive data (identity when skinned). */
  matrix: Float32Array;
  /** Index into ParsedGlb.skins, or -1. */
  skin: number;
  /** Morph target names (mesh.extras.targetNames; `target_<i>` when absent) and default weights. */
  targetNames: string[];
  targetWeights: number[];
  primitives: GlbPrimitive[];
}

export interface GlbNode {
  name: string;
  parent: number;
  /** World (scene-root) matrix at rest, column-major. */
  matrix: Float32Array;
  /** Local rest transform (decomposed when the file gives a matrix). */
  translation: Vec3;
  rotation: Vec4;
  scale: Vec3;
  children: number[];
}

export interface GlbSkin {
  name: string;
  /** Node indices, in the order JOINTS_0 refers to them. */
  joints: number[];
  /** 16 floats (column-major) per joint; identity when the file has none. */
  inverseBindMatrices: Float32Array;
  /** The skeleton root node, or -1. */
  skeleton: number;
}

export type AnimPath = 'translation' | 'rotation' | 'scale' | 'weights';
export type AnimInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

export interface GlbSampler {
  /** Keyframe times (s), increasing. */
  input: Float32Array;
  /** Values: `stride` floats per key (3× that for CUBICSPLINE: in-tangent, value, out-tangent). */
  output: Float32Array;
  interpolation: AnimInterpolation;
  /** Floats per value: 3 (translation, scale), 4 (rotation) or the morph-target count (weights). */
  stride: number;
}

export interface GlbChannel {
  node: number;
  path: AnimPath;
  sampler: number;
}

export interface GlbAnimation {
  name: string;
  channels: GlbChannel[];
  samplers: GlbSampler[];
  /** Last keyframe time over all samplers (s). */
  duration: number;
}

export interface ParsedGlb {
  meshes: GlbMesh[];
  materials: GlbMaterial[];
  nodes: GlbNode[];
  skins: GlbSkin[];
  animations: GlbAnimation[];
}

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MODE_TRIANGLES = 4;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

interface Json {
  [key: string]: unknown;
}

function obj(v: unknown, what: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new GlbError(`${what}: expected an object`);
  return v as Json;
}

function arr(v: unknown, what: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new GlbError(`${what}: expected an array`);
  return v;
}

function int(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new GlbError(`${what}: expected a non-negative integer`);
  return v;
}

function nums(v: unknown, n: number, fallback: number[], what: string): number[] {
  if (v === undefined) return fallback.slice();
  if (!Array.isArray(v) || v.length !== n || v.some((x) => typeof x !== 'number')) {
    throw new GlbError(`${what}: expected ${n} numbers`);
  }
  return v as number[];
}

/** UTF-8 decode without TextDecoder, so the package has no DOM or Node typing requirements. */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 < 0xe0) cp = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    else if (b0 < 0xf0) cp = ((b0 & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else cp = ((b0 & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

// ---------------------------------------------------------------- matrices (column-major, like glTF)

function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function fromTrs(t: number[], q: number[], s: number[]): Float32Array {
  const [x, y, z, w] = q as [number, number, number, number];
  const [sx, sy, sz] = s as [number, number, number];
  const m = new Float32Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * sx;
  m[1] = 2 * (x * y + z * w) * sx;
  m[2] = 2 * (x * z - y * w) * sx;
  m[4] = 2 * (x * y - z * w) * sy;
  m[5] = (1 - 2 * (x * x + z * z)) * sy;
  m[6] = 2 * (y * z + x * w) * sy;
  m[8] = 2 * (x * z + y * w) * sz;
  m[9] = 2 * (y * z - x * w) * sz;
  m[10] = (1 - 2 * (x * x + y * y)) * sz;
  m[12] = t[0]!;
  m[13] = t[1]!;
  m[14] = t[2]!;
  m[15] = 1;
  return m;
}

/** Inverse-transpose of the upper 3x3, row-major 9 floats; keeps normals correct under non-uniform scale. */
function normalMatrix(m: Float32Array): number[] {
  const a = m[0]!, b = m[4]!, c = m[8]!;
  const d = m[1]!, e = m[5]!, f = m[9]!;
  const g = m[2]!, h = m[6]!, i = m[10]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = det === 0 ? 0 : 1 / det;
  // cofactor matrix / det == (M^-1)^T
  return [
    A * inv, B * inv, C * inv,
    -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv,
    (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv,
  ];
}

/** Matrix → TRS (no shear). Rotation from the scale-normalised basis (Shepperd's method). */
export function decomposeTrs(m: Float32Array): { t: Vec3; r: Vec4; s: Vec3 } {
  const sx0 = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  const sx = det < 0 ? -sx0 : sx0;
  const r00 = m[0]! / (sx || 1), r10 = m[1]! / (sx || 1), r20 = m[2]! / (sx || 1);
  const r01 = m[4]! / (sy || 1), r11 = m[5]! / (sy || 1), r21 = m[6]! / (sy || 1);
  const r02 = m[8]! / (sz || 1), r12 = m[9]! / (sz || 1), r22 = m[10]! / (sz || 1);
  const tr = r00 + r11 + r22;
  let q: Vec4;
  if (tr > 0) {
    const k = Math.sqrt(tr + 1) * 2;
    q = [(r21 - r12) / k, (r02 - r20) / k, (r10 - r01) / k, k / 4];
  } else if (r00 > r11 && r00 > r22) {
    const k = Math.sqrt(1 + r00 - r11 - r22) * 2;
    q = [k / 4, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k];
  } else if (r11 > r22) {
    const k = Math.sqrt(1 + r11 - r00 - r22) * 2;
    q = [(r01 + r10) / k, k / 4, (r12 + r21) / k, (r02 - r20) / k];
  } else {
    const k = Math.sqrt(1 + r22 - r00 - r11) * 2;
    q = [(r02 + r20) / k, (r12 + r21) / k, k / 4, (r10 - r01) / k];
  }
  return { t: [m[12]!, m[13]!, m[14]!], r: q, s: [sx, sy, sz] };
}

// ---------------------------------------------------------------- parsing

export function parseGlb(input: ArrayBuffer | Uint8Array): ParsedGlb {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) throw new GlbError('file too short for a GLB header');
  if (view.getUint32(0, true) !== MAGIC) throw new GlbError('bad magic: not a GLB file');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new GlbError(`unsupported glTF version ${version}`);
  const length = view.getUint32(8, true);
  if (length > bytes.byteLength) throw new GlbError(`header length ${length} exceeds file size ${bytes.byteLength}`);

  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  let off = 12;
  while (off + 8 <= length) {
    const chunkLen = view.getUint32(off, true);
    const chunkType = view.getUint32(off + 4, true);
    const start = off + 8;
    if (start + chunkLen > length) throw new GlbError('chunk overruns file');
    const data = bytes.subarray(start, start + chunkLen);
    if (chunkType === CHUNK_JSON && json === null) {
      json = obj(JSON.parse(decodeUtf8(data)), 'glTF JSON');
    } else if (chunkType === CHUNK_BIN && bin === null) {
      bin = data;
    }
    off = start + chunkLen + ((4 - (chunkLen % 4)) % 4);
  }
  if (json === null) throw new GlbError('missing JSON chunk');
  return buildScene(json, bin);
}

function buildScene(json: Json, bin: Uint8Array | null): ParsedGlb {
  const asset = obj(json['asset'], 'asset');
  if (typeof asset['version'] !== 'string' || !asset['version'].startsWith('2.')) {
    throw new GlbError('asset.version must be 2.x');
  }
  const required = arr(json['extensionsRequired'], 'extensionsRequired');
  if (required.length) throw new GlbError(`required extensions not supported: ${required.join(', ')}`);

  const buffers = arr(json['buffers'], 'buffers').map((b, i) => obj(b, `buffers[${i}]`));
  const views = arr(json['bufferViews'], 'bufferViews').map((v, i) => obj(v, `bufferViews[${i}]`));
  const accessors = arr(json['accessors'], 'accessors').map((a, i) => obj(a, `accessors[${i}]`));
  for (let i = 0; i < buffers.length; i++) {
    if (buffers[i]!['uri'] !== undefined) throw new GlbError(`buffers[${i}]: external buffers are not supported`);
  }

  /** Reads `count` elements of `size` components from a bufferView (tightly packed unless it has a stride). */
  const readView = (out: Float64Array, viewIndex: number, byteOffset: number, count: number, size: number, ctype: number, normalized: boolean, what: string, indices?: Float64Array): void => {
    const cbytes = COMPONENT_BYTES[ctype];
    if (!cbytes) throw new GlbError(`${what}: unsupported component type ${ctype}`);
    const bv = views[viewIndex];
    if (!bv) throw new GlbError(`${what}: bufferView out of range`);
    if (int(bv['buffer'], 'bufferView.buffer') !== 0 || bin === null) throw new GlbError(`${what}: data must live in the GLB BIN chunk`);
    const base = (typeof bv['byteOffset'] === 'number' ? bv['byteOffset'] : 0) + byteOffset;
    const stride = typeof bv['byteStride'] === 'number' ? bv['byteStride'] : size * cbytes;
    const viewEnd = (typeof bv['byteOffset'] === 'number' ? bv['byteOffset'] : 0) + int(bv['byteLength'], 'byteLength');
    if (count > 0 && base + stride * (count - 1) + size * cbytes > viewEnd) throw new GlbError(`${what}: accessor overruns its bufferView`);
    if (viewEnd > bin.byteLength) throw new GlbError(`${what}: bufferView overruns the BIN chunk`);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < count; i++) {
      const row = indices ? indices[i]! : i;
      for (let c = 0; c < size; c++) {
        const q = base + i * stride + c * cbytes;
        let v: number;
        switch (ctype) {
          case 5126: v = dv.getFloat32(q, true); break;
          case 5125: v = dv.getUint32(q, true); break;
          case 5123: v = dv.getUint16(q, true); if (normalized) v /= 65535; break;
          case 5122: v = dv.getInt16(q, true); if (normalized) v = Math.max(v / 32767, -1); break;
          case 5121: v = dv.getUint8(q); if (normalized) v /= 255; break;
          default: v = dv.getInt8(q); if (normalized) v = Math.max(v / 127, -1); break;
        }
        out[row * size + c] = v;
      }
    }
  };

  const readAccessor = (index: number, what: string): { data: Float64Array; count: number; size: number; type: number } => {
    const acc = accessors[index];
    if (!acc) throw new GlbError(`${what}: accessor ${index} out of range`);
    const count = int(acc['count'], `${what}.count`);
    const size = COMPONENTS[String(acc['type'])];
    const ctype = int(acc['componentType'], `${what}.componentType`);
    const cbytes = COMPONENT_BYTES[ctype];
    if (!size || !cbytes) throw new GlbError(`${what}: unsupported accessor type ${String(acc['type'])}/${ctype}`);
    const normalized = acc['normalized'] === true;
    const out = new Float64Array(count * size); // no bufferView: all zeros per spec
    if (acc['bufferView'] !== undefined) {
      readView(out, int(acc['bufferView'], `${what}.bufferView`), typeof acc['byteOffset'] === 'number' ? acc['byteOffset'] : 0, count, size, ctype, normalized, what);
    }
    if (acc['sparse'] !== undefined) {
      // sparse substitution (morph targets): `count` (index, value) pairs over the base data
      const sp = obj(acc['sparse'], `${what}.sparse`);
      const n = int(sp['count'], `${what}.sparse.count`);
      const ind = obj(sp['indices'], `${what}.sparse.indices`), val = obj(sp['values'], `${what}.sparse.values`);
      const itype = int(ind['componentType'], `${what}.sparse.indices.componentType`);
      if (itype !== 5121 && itype !== 5123 && itype !== 5125) throw new GlbError(`${what}: sparse indices must be unsigned`);
      const idx = new Float64Array(n);
      readView(idx, int(ind['bufferView'], `${what}.sparse.indices.bufferView`), typeof ind['byteOffset'] === 'number' ? ind['byteOffset'] : 0, n, 1, itype, false, `${what}.sparse.indices`);
      for (let i = 0; i < n; i++) {
        if (idx[i]! >= count) throw new GlbError(`${what}: sparse index ${idx[i]} out of range (${count})`);
        if (i > 0 && idx[i]! <= idx[i - 1]!) throw new GlbError(`${what}: sparse indices must increase`);
      }
      readView(out, int(val['bufferView'], `${what}.sparse.values.bufferView`), typeof val['byteOffset'] === 'number' ? val['byteOffset'] : 0, n, size, ctype, normalized, `${what}.sparse.values`, idx);
    }
    return { data: out, count, size, type: ctype };
  };

  const materials: GlbMaterial[] = arr(json['materials'], 'materials').map((m, i) => {
    const mat = obj(m, `materials[${i}]`);
    const pbr = mat['pbrMetallicRoughness'] === undefined ? {} : obj(mat['pbrMetallicRoughness'], 'pbrMetallicRoughness');
    const name = typeof mat['name'] === 'string' ? mat['name'] : `material_${i}`;
    let emissive = nums(mat['emissiveFactor'], 3, [0, 0, 0], `${name}.emissiveFactor`) as Vec3;
    const ext = mat['extensions'] === undefined ? {} : obj(mat['extensions'], 'extensions');
    const strength = ext['KHR_materials_emissive_strength'];
    if (strength !== undefined) {
      const s = obj(strength, 'KHR_materials_emissive_strength')['emissiveStrength'];
      if (typeof s === 'number') emissive = [emissive[0] * s, emissive[1] * s, emissive[2] * s];
    }
    const out: GlbMaterial = {
      name,
      baseColorFactor: nums(pbr['baseColorFactor'], 4, [1, 1, 1, 1], `${name}.baseColorFactor`) as Vec4,
      metallicFactor: typeof pbr['metallicFactor'] === 'number' ? pbr['metallicFactor'] : 1,
      roughnessFactor: typeof pbr['roughnessFactor'] === 'number' ? pbr['roughnessFactor'] : 1,
      emissiveFactor: emissive,
    };
    const mx = mat['extras'];
    if (mx !== null && typeof mx === 'object' && typeof (mx as Json)['texSet'] === 'string') out.texSet = (mx as Json)['texSet'] as string;
    return out;
  });

  const meshDefs = arr(json['meshes'], 'meshes').map((m, i) => obj(m, `meshes[${i}]`));
  const nodeDefs = arr(json['nodes'], 'nodes').map((n, i) => obj(n, `nodes[${i}]`));
  const parents = new Int32Array(nodeDefs.length).fill(-1);
  nodeDefs.forEach((n, i) => {
    for (const c of arr(n['children'], `nodes[${i}].children`)) {
      const ci = int(c, `nodes[${i}].children`);
      if (ci >= nodeDefs.length) throw new GlbError(`nodes[${i}]: child ${ci} out of range`);
      if (parents[ci] !== -1) throw new GlbError(`node ${ci} has two parents`);
      parents[ci] = i;
    }
  });

  const trs = nodeDefs.map((n, i) => {
    if (n['matrix'] !== undefined) {
      const mat = new Float32Array(nums(n['matrix'], 16, [], `nodes[${i}].matrix`));
      const d = decomposeTrs(mat);
      return { mat, t: d.t, r: d.r, s: d.s };
    }
    const t = nums(n['translation'], 3, [0, 0, 0], `nodes[${i}].translation`) as Vec3;
    const r = nums(n['rotation'], 4, [0, 0, 0, 1], `nodes[${i}].rotation`) as Vec4;
    const sc = nums(n['scale'], 3, [1, 1, 1], `nodes[${i}].scale`) as Vec3;
    return { mat: fromTrs(t, r, sc), t, r, s: sc };
  });
  const local = trs.map((x) => x.mat);
  const world: (Float32Array | null)[] = nodeDefs.map(() => null);
  const worldOf = (i: number, depth = 0): Float32Array => {
    if (depth > nodeDefs.length) throw new GlbError('node hierarchy has a cycle');
    const cached = world[i];
    if (cached) return cached;
    const p = parents[i]!;
    const m = p === -1 ? local[i]! : multiply(worldOf(p, depth + 1), local[i]!);
    world[i] = m;
    return m;
  };
  const names = nodeDefs.map((n, i) => (typeof n['name'] === 'string' ? n['name'] : `node_${i}`));
  const lodOf = (i: number): number => {
    for (let p = i; p !== -1; p = parents[p]!) {
      const m = /^LOD([0-3])$/.exec(names[p]!);
      if (m) return Number(m[1]);
    }
    return -1;
  };

  const children: number[][] = nodeDefs.map(() => []);
  parents.forEach((p, i) => { if (p !== -1) children[p]!.push(i); });
  const nodes: GlbNode[] = nodeDefs.map((_, i) => ({
    name: names[i]!, parent: parents[i]!, matrix: worldOf(i),
    translation: [...trs[i]!.t] as Vec3, rotation: [...trs[i]!.r] as Vec4, scale: [...trs[i]!.s] as Vec3, children: children[i]!,
  }));
  const skins = parseSkins(json, nodeDefs.length, readAccessor);
  const meshes: GlbMesh[] = [];
  nodeDefs.forEach((n, i) => {
    if (n['mesh'] === undefined) return;
    const mi = int(n['mesh'], `nodes[${i}].mesh`);
    const def = meshDefs[mi];
    if (!def) throw new GlbError(`nodes[${i}]: mesh ${mi} out of range`);
    const skin = n['skin'] === undefined ? -1 : int(n['skin'], `nodes[${i}].skin`);
    if (skin >= skins.length) throw new GlbError(`nodes[${i}]: skin ${skin} out of range`);
    // glTF: a skinned mesh's own node transform is ignored; vertices stay in bind space
    const m = skin >= 0 ? identity() : worldOf(i);
    const nm = normalMatrix(m);
    const meshName = typeof def['name'] === 'string' ? def['name'] : `mesh_${mi}`;
    const primitives = arr(def['primitives'], `${meshName}.primitives`).map((pr, pi) => {
      const prim = obj(pr, `${meshName}.primitives[${pi}]`);
      const what = `${meshName}.primitives[${pi}]`;
      const mode = prim['mode'] === undefined ? MODE_TRIANGLES : prim['mode'];
      if (mode !== MODE_TRIANGLES) throw new GlbError(`${what}: only triangle lists are supported (mode ${String(mode)})`);
      if (prim['extensions'] !== undefined && Object.keys(obj(prim['extensions'], 'extensions')).length) {
        throw new GlbError(`${what}: compressed primitives are not supported`);
      }
      const attrs = obj(prim['attributes'], `${what}.attributes`);
      if (attrs['POSITION'] === undefined) throw new GlbError(`${what}: no POSITION`);
      const pos = readAccessor(int(attrs['POSITION'], 'POSITION'), `${what}.POSITION`);
      if (pos.size !== 3) throw new GlbError(`${what}: POSITION must be VEC3`);
      const vcount = pos.count;
      const positions = new Float32Array(vcount * 3);
      for (let v = 0; v < vcount; v++) {
        const x = pos.data[v * 3]!, y = pos.data[v * 3 + 1]!, z = pos.data[v * 3 + 2]!;
        positions[v * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        positions[v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        positions[v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      }
      let normals: Float32Array | null = null;
      if (attrs['NORMAL'] !== undefined) {
        const nrm = readAccessor(int(attrs['NORMAL'], 'NORMAL'), `${what}.NORMAL`);
        if (nrm.count !== vcount || nrm.size !== 3) throw new GlbError(`${what}: NORMAL must be VEC3 x ${vcount}`);
        normals = new Float32Array(vcount * 3);
        for (let v = 0; v < vcount; v++) {
          const x = nrm.data[v * 3]!, y = nrm.data[v * 3 + 1]!, z = nrm.data[v * 3 + 2]!;
          const nx = nm[0]! * x + nm[1]! * y + nm[2]! * z;
          const ny = nm[3]! * x + nm[4]! * y + nm[5]! * z;
          const nz = nm[6]! * x + nm[7]! * y + nm[8]! * z;
          const len = Math.hypot(nx, ny, nz) || 1;
          normals[v * 3] = nx / len;
          normals[v * 3 + 1] = ny / len;
          normals[v * 3 + 2] = nz / len;
        }
      }
      let uvs: Float32Array | null = null;
      if (attrs['TEXCOORD_0'] !== undefined) {
        const uv = readAccessor(int(attrs['TEXCOORD_0'], 'TEXCOORD_0'), `${what}.TEXCOORD_0`);
        if (uv.count !== vcount || uv.size !== 2) throw new GlbError(`${what}: TEXCOORD_0 must be VEC2 x ${vcount}`);
        uvs = Float32Array.from(uv.data);
      }
      let joints: Uint16Array | null = null;
      let weights: Float32Array | null = null;
      if (attrs['JOINTS_0'] !== undefined || attrs['WEIGHTS_0'] !== undefined) {
        if (attrs['JOINTS_0'] === undefined || attrs['WEIGHTS_0'] === undefined) throw new GlbError(`${what}: JOINTS_0 and WEIGHTS_0 come together`);
        if (skin < 0) throw new GlbError(`${what}: JOINTS_0 on a mesh node without a skin`);
        const ja = readAccessor(int(attrs['JOINTS_0'], 'JOINTS_0'), `${what}.JOINTS_0`);
        const wa = readAccessor(int(attrs['WEIGHTS_0'], 'WEIGHTS_0'), `${what}.WEIGHTS_0`);
        if (ja.count !== vcount || ja.size !== 4) throw new GlbError(`${what}: JOINTS_0 must be VEC4 x ${vcount}`);
        if (wa.count !== vcount || wa.size !== 4) throw new GlbError(`${what}: WEIGHTS_0 must be VEC4 x ${vcount}`);
        if (ja.type !== 5121 && ja.type !== 5123) throw new GlbError(`${what}: JOINTS_0 must be unsigned byte or short`);
        const nj = skins[skin]!.joints.length;
        joints = new Uint16Array(vcount * 4);
        weights = new Float32Array(vcount * 4);
        for (let v = 0; v < vcount; v++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) sum += Math.max(0, wa.data[v * 4 + k]!);
          for (let k = 0; k < 4; k++) {
            const w = sum > 0 ? Math.max(0, wa.data[v * 4 + k]!) / sum : k === 0 ? 1 : 0;
            const j = ja.data[v * 4 + k]!;
            if (w > 0 && j >= nj) throw new GlbError(`${what}: joint ${j} out of range (${nj} joints)`);
            joints[v * 4 + k] = w > 0 ? j : 0;
            weights[v * 4 + k] = w;
          }
        }
      }
      const targets: GlbMorphTarget[] = arr(prim['targets'], `${what}.targets`).map((tg, ti) => {
        const ta = obj(tg, `${what}.targets[${ti}]`);
        const delta = (key: string, normal: boolean): Float32Array | null => {
          if (ta[key] === undefined) return null;
          const d = readAccessor(int(ta[key], key), `${what}.targets[${ti}].${key}`);
          if (d.count !== vcount || d.size !== 3) throw new GlbError(`${what}: target ${key} must be VEC3 x ${vcount}`);
          const o = new Float32Array(vcount * 3);
          for (let v = 0; v < vcount; v++) {
            const x = d.data[v * 3]!, y = d.data[v * 3 + 1]!, z = d.data[v * 3 + 2]!;
            // deltas are directions: the node's linear part (inverse-transpose for normals), no translation
            if (normal) { o[v * 3] = nm[0]! * x + nm[1]! * y + nm[2]! * z; o[v * 3 + 1] = nm[3]! * x + nm[4]! * y + nm[5]! * z; o[v * 3 + 2] = nm[6]! * x + nm[7]! * y + nm[8]! * z; }
            else { o[v * 3] = m[0]! * x + m[4]! * y + m[8]! * z; o[v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z; o[v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z; }
          }
          return o;
        };
        return { positions: delta('POSITION', false), normals: delta('NORMAL', true) };
      });
      let indices: Uint16Array | Uint32Array;
      if (prim['indices'] !== undefined) {
        const idx = readAccessor(int(prim['indices'], 'indices'), `${what}.indices`);
        if (idx.size !== 1) throw new GlbError(`${what}: indices must be SCALAR`);
        indices = idx.type === 5125 ? new Uint32Array(idx.count) : new Uint16Array(idx.count);
        for (let k = 0; k < idx.count; k++) {
          const v = idx.data[k]!;
          if (v >= vcount) throw new GlbError(`${what}: index ${v} out of range (${vcount} vertices)`);
          indices[k] = v;
        }
      } else {
        indices = vcount > 0xffff ? new Uint32Array(vcount) : new Uint16Array(vcount);
        for (let k = 0; k < vcount; k++) indices[k] = k;
      }
      if (indices.length % 3 !== 0) throw new GlbError(`${what}: index count ${indices.length} is not a multiple of 3`);
      const material = prim['material'] === undefined ? -1 : int(prim['material'], `${what}.material`);
      if (material >= materials.length) throw new GlbError(`${what}: material ${material} out of range`);
      return { positions, normals, uvs, joints, weights, targets, indices, material, vertexCount: vcount, triangleCount: indices.length / 3 };
    });
    const nt = Math.max(0, ...primitives.map((q) => q.targets.length));
    if (primitives.some((q) => q.targets.length !== nt)) throw new GlbError(`${meshName}: every primitive needs the same number of morph targets`);
    const extras = def['extras'] === undefined ? {} : obj(def['extras'], `${meshName}.extras`);
    const tn = Array.isArray(extras['targetNames']) ? (extras['targetNames'] as unknown[]).map(String) : [];
    const targetNames = Array.from({ length: nt }, (_, k) => tn[k] ?? `target_${k}`);
    const targetWeights = def['weights'] === undefined ? new Array<number>(nt).fill(0) : nums(def['weights'], nt, [], `${meshName}.weights`);
    meshes.push({ meshName, nodeName: names[i]!, node: i, lod: lodOf(i), matrix: m, skin, targetNames, targetWeights, primitives });
  });
  const animations = parseAnimations(json, nodeDefs.length, readAccessor);
  return { meshes, materials, nodes, skins, animations };
}

type ReadAccessor = (index: number, what: string) => { data: Float64Array; count: number; size: number; type: number };

function parseSkins(json: Json, nodeCount: number, read: ReadAccessor): GlbSkin[] {
  return arr(json['skins'], 'skins').map((sk, i) => {
    const s = obj(sk, `skins[${i}]`);
    const name = typeof s['name'] === 'string' ? s['name'] : `skin_${i}`;
    const joints = arr(s['joints'], `${name}.joints`).map((j) => {
      const n = int(j, `${name}.joints`);
      if (n >= nodeCount) throw new GlbError(`${name}: joint node ${n} out of range`);
      return n;
    });
    if (!joints.length) throw new GlbError(`${name}: a skin needs at least one joint`);
    const ibm = new Float32Array(joints.length * 16);
    if (s['inverseBindMatrices'] !== undefined) {
      const a = read(int(s['inverseBindMatrices'], `${name}.inverseBindMatrices`), `${name}.inverseBindMatrices`);
      if (a.size !== 16 || a.count !== joints.length) throw new GlbError(`${name}: inverseBindMatrices must be MAT4 x ${joints.length}`);
      ibm.set(a.data);
    } else {
      for (let k = 0; k < joints.length; k++) ibm.set(identity(), k * 16);
    }
    const skeleton = s['skeleton'] === undefined ? -1 : int(s['skeleton'], `${name}.skeleton`);
    if (skeleton >= nodeCount) throw new GlbError(`${name}: skeleton node out of range`);
    return { name, joints, inverseBindMatrices: ibm, skeleton };
  });
}

const PATH_STRIDE: Record<string, number> = { translation: 3, rotation: 4, scale: 3 };

function parseAnimations(json: Json, nodeCount: number, read: ReadAccessor): GlbAnimation[] {
  return arr(json['animations'], 'animations').map((an, i) => {
    const a = obj(an, `animations[${i}]`);
    const name = typeof a['name'] === 'string' ? a['name'] : `animation_${i}`;
    const rawSamplers = arr(a['samplers'], `${name}.samplers`).map((x, k) => obj(x, `${name}.samplers[${k}]`));
    const channels: GlbChannel[] = [];
    const strideOf = new Map<number, number>();
    arr(a['channels'], `${name}.channels`).forEach((c, k) => {
      const ch = obj(c, `${name}.channels[${k}]`);
      const target = obj(ch['target'], `${name}.channels[${k}].target`);
      const path = target['path'];
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale' && path !== 'weights') throw new GlbError(`${name}: unsupported channel path ${String(path)}`);
      const sampler = int(ch['sampler'], `${name}.channels[${k}].sampler`);
      if (sampler >= rawSamplers.length) throw new GlbError(`${name}: channel sampler ${sampler} out of range`);
      if (path !== 'weights') strideOf.set(sampler, PATH_STRIDE[path]!);
      if (target['node'] === undefined) return; // allowed by the spec (extension targets): nothing to animate
      const node = int(target['node'], `${name}.channels[${k}].node`);
      if (node >= nodeCount) throw new GlbError(`${name}: channel node ${node} out of range`);
      channels.push({ node, path, sampler });
    });
    let duration = 0;
    const samplers: GlbSampler[] = rawSamplers.map((s, k) => {
      const interp = s['interpolation'] === undefined ? 'LINEAR' : s['interpolation'];
      if (interp !== 'LINEAR' && interp !== 'STEP' && interp !== 'CUBICSPLINE') throw new GlbError(`${name}: unsupported interpolation ${String(interp)}`);
      const inp = read(int(s['input'], `${name}.samplers[${k}].input`), `${name}.samplers[${k}].input`);
      const out = read(int(s['output'], `${name}.samplers[${k}].output`), `${name}.samplers[${k}].output`);
      if (inp.size !== 1) throw new GlbError(`${name}: sampler input must be SCALAR`);
      const input = Float32Array.from(inp.data);
      for (let t = 1; t < input.length; t++) if (input[t]! < input[t - 1]!) throw new GlbError(`${name}: sampler ${k} times must increase`);
      const keys = inp.count * (interp === 'CUBICSPLINE' ? 3 : 1);
      const floats = out.count * out.size;
      const stride = strideOf.get(k) ?? (keys > 0 ? floats / keys : 0);
      if (!Number.isInteger(stride) || stride * keys !== floats) throw new GlbError(`${name}: sampler ${k} has ${floats} values for ${inp.count} keys`);
      if (input.length) duration = Math.max(duration, input[input.length - 1]!);
      return { input, output: Float32Array.from(out.data), interpolation: interp, stride };
    });
    return { name, channels, samplers, duration };
  });
}

/** Samples one sampler at time t (clamped to its key range) into `out` (`stride` floats).
 * Rotations (`rotation` true, stride 4) are slerped for LINEAR and renormalised. */
export function sampleAnim(s: GlbSampler, t: number, out: Float32Array | number[], rotation: boolean): void {
  const n = s.input.length, w = s.stride;
  if (n === 0) return;
  const cubic = s.interpolation === 'CUBICSPLINE';
  const val = (k: number, c: number): number => s.output[(cubic ? k * 3 + 1 : k) * w + c]!;
  if (n === 1 || t <= s.input[0]!) { for (let c = 0; c < w; c++) out[c] = val(0, c); return; }
  if (t >= s.input[n - 1]!) { for (let c = 0; c < w; c++) out[c] = val(n - 1, c); return; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s.input[mid]! <= t) lo = mid; else hi = mid; }
  const t0 = s.input[lo]!, dt = s.input[hi]! - t0;
  const u = dt > 0 ? (t - t0) / dt : 0;
  if (s.interpolation === 'STEP') { for (let c = 0; c < w; c++) out[c] = val(lo, c); return; }
  if (!cubic && rotation && w === 4) {
    slerpInto(out, [val(lo, 0), val(lo, 1), val(lo, 2), val(lo, 3)], [val(hi, 0), val(hi, 1), val(hi, 2), val(hi, 3)], u);
    return;
  }
  if (cubic) {
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let c = 0; c < w; c++) {
      const outTan = s.output[(lo * 3 + 2) * w + c]!, inTan = s.output[hi * 3 * w + c]!;
      out[c] = h00 * val(lo, c) + h10 * dt * outTan + h01 * val(hi, c) + h11 * dt * inTan;
    }
  } else {
    for (let c = 0; c < w; c++) out[c] = val(lo, c) + (val(hi, c) - val(lo, c)) * u;
  }
  if (rotation && w === 4) {
    const l = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!) || 1;
    for (let c = 0; c < 4; c++) out[c] = out[c]! / l;
  }
}

/** Shortest-path quaternion slerp (nlerp when nearly parallel). */
export function slerpInto(out: Float32Array | number[], a: ArrayLike<number>, b: ArrayLike<number>, u: number): void {
  let d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sg = d < 0 ? -1 : 1;
  d *= sg;
  let ka: number, kb: number;
  if (d > 0.9995) { ka = 1 - u; kb = u * sg; } else {
    const th = Math.acos(d), sn = Math.sin(th);
    ka = Math.sin((1 - u) * th) / sn; kb = (Math.sin(u * th) / sn) * sg;
  }
  const x = a[0]! * ka + b[0]! * kb, y = a[1]! * ka + b[1]! * kb, z = a[2]! * ka + b[2]! * kb, w = a[3]! * ka + b[3]! * kb;
  const l = Math.hypot(x, y, z, w) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l; out[3] = w / l;
}

// ---------------------------------------------------------------- writing (tests, tools)

/** Packs a glTF JSON object and a BIN chunk into GLB bytes (JSON padded with spaces, BIN with zeros). */
export function encodeGlb(json: unknown, bin: Uint8Array | null = null): Uint8Array {
  const text = JSON.stringify(json);
  const utf8: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) utf8.push(cp);
    else if (cp < 0x800) utf8.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) utf8.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else utf8.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  while (utf8.length % 4) utf8.push(0x20);
  const binLen = bin ? (bin.byteLength + 3) & ~3 : 0;
  const total = 12 + 8 + utf8.length + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, utf8.length, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.set(utf8, 20);
  if (bin) {
    const o = 20 + utf8.length;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

// ---------------------------------------------------------------- queries

/** The `PIVOT__*` node a mesh hangs under (nearest ancestor), or -1 for static pieces. */
export function pivotOf(glb: ParsedGlb, mesh: GlbMesh): number {
  for (let p = glb.nodes[mesh.node]?.parent ?? -1; p !== -1; p = glb.nodes[p]!.parent) {
    if (glb.nodes[p]!.name.startsWith('PIVOT__')) return p;
  }
  return -1;
}

export interface LodStats {
  triangles: number;
  vertices: number;
  min: Vec3;
  max: Vec3;
  /** Smallest sphere centred on the part origin that contains every vertex. */
  originRadius: number;
}

export function lodStats(glb: ParsedGlb, lod: number): LodStats {
  let triangles = 0;
  let vertices = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let r2 = 0;
  for (const mesh of glb.meshes) {
    if (mesh.lod !== lod) continue;
    for (const p of mesh.primitives) {
      triangles += p.triangleCount;
      vertices += p.vertexCount;
      for (let v = 0; v < p.vertexCount; v++) {
        const x = p.positions[v * 3]!, y = p.positions[v * 3 + 1]!, z = p.positions[v * 3 + 2]!;
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
        r2 = Math.max(r2, x * x + y * y + z * z);
      }
    }
  }
  return { triangles, vertices, min, max, originRadius: Math.sqrt(r2) };
}
