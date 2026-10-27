// Skinned meshes (critters, GAME_SPEC §19.4): geometry with a separate joints/weights vertex stream,
// a CPU rig (glTF skin + animations) that evaluates clips with cross-fade or takes ragdoll bone
// overrides, and writes 3×4 bone matrices for GPU skinning (shaders.ts `vs_skin`).

import { sampleAnim, slerpInto, type GlbAnimation, type GlbMesh, type ParsedGlb } from '@knockon/assets';
import { MAT_KIND, packSnorm16, packUnorm, packUnorm16, type Geometry } from './meshes.ts';
import { hexLin } from '../catalog.ts';
/** Beam, the LED colour (ART_BIBLE palette; also the Matter family's tint). */
const LED_RGB = hexLin('#2FD6FF');
import { detailFor, EXEMPT, layerBytes, texSetKind, type MaterialLook } from './look/materials.ts';
import { nearestScreen, screenRgb, screenVm, type ScreenInfo } from './screens.ts'; // R5 (M5): LED icon faces
import { LED_MARK } from './leds.ts';

/** R5 (M5): a skinned critter's LED groups (leds.ts `glbLedGroups`) and the colour (linear) of each group 0–3. */
export interface SkinLeds { readonly groups: Map<GlbMesh, (Float32Array | null)[]>; readonly colors: readonly (readonly number[] | undefined)[] }

export interface SkinnedGeometry extends Geometry {
  /** 4 joint indices per vertex (into the rig's joints). */
  readonly joints: Uint16Array;
  /** 4 weights per vertex (sum 1). */
  readonly weights: Float32Array;
  /** Face shape keys (morph targets): per vertex a float offset into `table` (−1: no deltas), and per such
   * vertex `names.length` × (dpos xyz, dnormal xyz). */
  readonly morph?: { readonly names: readonly string[]; readonly rowOf: Int32Array; readonly table: Float32Array };
}

export interface SkinMesh {
  readonly name: string;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly baseVertex: number;
  readonly jointCount: number;
  /** Morph target (shape key) names, in weight order; empty when the mesh has none. */
  readonly targetNames: readonly string[];
}

/** pos/normal/colour/material/uv like MeshLibrary (32 B) + joints uint8×4 · weights unorm8×4 (8 B). */
export const SKIN_STRIDE = 8;

export class SkinLibrary {
  readonly meshes: SkinMesh[] = [];
  private readonly byName = new Map<string, number>();
  private verts: number[] = [];
  private skin: number[] = [];
  private idx: number[] = [];
  private morphRow: number[] = [];
  private morphTable: number[] = [];
  vertexBuffer: GPUBuffer | null = null;
  skinBuffer: GPUBuffer | null = null;
  /** Per vertex u32: float offset of the vertex's morph deltas in `morphBuffer` (0xffffffff: none). */
  morphIndexBuffer: GPUBuffer | null = null;
  /** Storage: morph deltas (f32). */
  morphBuffer: GPUBuffer | null = null;
  indexBuffer: GPUBuffer | null = null;
  private dirty = false;

  add(name: string, g: SkinnedGeometry, jointCount: number): number {
    if (jointCount > 256) throw new Error(`${name}: ${jointCount} joints (max 256)`);
    const baseVertex = this.verts.length / 8;
    const n = g.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const c = g.colors ? [g.colors[i * 4]!, g.colors[i * 4 + 1]!, g.colors[i * 4 + 2]!, g.colors[i * 4 + 3]!] : [1, 1, 1, 1];
      const m = g.mats ? [g.mats[i * 4]!, g.mats[i * 4 + 1]!, g.mats[i * 4 + 2]!, g.mats[i * 4 + 3]!] : [0.5, 0, 0, MAT_KIND.master];
      const u = g.uvs ? [g.uvs[i * 2]!, g.uvs[i * 2 + 1]!] : [0, 0];
      this.verts.push(
        g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!,
        packSnorm16(g.normals[i * 3]!, g.normals[i * 3 + 1]!), packSnorm16(g.normals[i * 3 + 2]!, 0),
        packUnorm(c, true), packUnorm(m, false), packUnorm16(u[0]!, u[1]!),
      );
      const j = (k: number): number => g.joints[i * 4 + k]! & 255;
      this.skin.push((j(0) | (j(1) << 8) | (j(2) << 16) | (j(3) << 24)) >>> 0);
      this.skin.push(packUnorm([g.weights[i * 4]!, g.weights[i * 4 + 1]!, g.weights[i * 4 + 2]!, g.weights[i * 4 + 3]!], false));
      const r = g.morph ? g.morph.rowOf[i]! : -1;
      this.morphRow.push(r < 0 ? 0xffffffff : this.morphTable.length + r);
    }
    if (g.morph) for (const v of g.morph.table) this.morphTable.push(v);
    const firstIndex = this.idx.length;
    for (const v of g.indices) this.idx.push(v);
    this.meshes.push({ name, firstIndex, indexCount: g.indices.length, baseVertex, jointCount, targetNames: g.morph?.names ?? [] });
    this.byName.set(name, this.meshes.length - 1);
    this.dirty = true;
    return this.meshes.length - 1;
  }

  has(name: string): boolean { return this.byName.has(name); }
  id(name: string): number { return this.byName.get(name) ?? -1; }

  upload(device: GPUDevice): boolean {
    if (!this.dirty) return false;
    for (const b of [this.vertexBuffer, this.skinBuffer, this.indexBuffer, this.morphIndexBuffer, this.morphBuffer]) b?.destroy();
    const v = new Float32Array(this.verts.length);
    const vu = new Uint32Array(v.buffer);
    this.verts.forEach((x, i) => { if (i % 8 >= 3) vu[i] = x; else v[i] = x; });
    const mk = (data: ArrayBufferView, usage: number): GPUBuffer => {
      const b = device.createBuffer({ size: Math.max(16, (data.byteLength + 3) & ~3), usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
      return b;
    };
    this.vertexBuffer = mk(v, GPUBufferUsage.VERTEX);
    this.skinBuffer = mk(new Uint32Array(this.skin), GPUBufferUsage.VERTEX);
    this.indexBuffer = mk(new Uint32Array(this.idx), GPUBufferUsage.INDEX);
    this.morphIndexBuffer = mk(new Uint32Array(this.morphRow), GPUBufferUsage.VERTEX);
    this.morphBuffer = mk(new Float32Array(this.morphTable.length ? this.morphTable : [0]), GPUBufferUsage.STORAGE);
    this.dirty = false;
    return true;
  }
}

// ---- geometry from a glb -------------------------------------------------------------------------------

/** LOD0 skinned geometry from every mesh of the glb. Unskinned meshes under a joint (eyes, tags) ride that
 * joint rigidly; anything else rides the first joint. Master materials are baked per vertex. */
/**
 * `look` (M4): the critter's texture set (gfx/glbmesh.ts `partTexLook`); materials flagged `extras.texSet` sample it
 * with the screen-derivative tangent frame (no tangent code: skinning would invalidate the bind-pose one).
 * `kn_screen` primitives (DUSTY's LED face and bin gauge) are drawn as lit panels in the beam colour.
 * R5 (M5): with the `.art.json` `screens`, each screen vertex takes its nearest screen: `icon` screens (DUSTY's eyes,
 * BUZZ's visor) become LED icon faces (shaders.ts `screenIcon`, the icon from the instance), `bar` screens bar meters.
 */
export function skinnedFromGlb(glb: ParsedGlb, skinIndex = 0, look?: MaterialLook, screens: readonly ScreenInfo[] = [], leds?: SkinLeds): SkinnedGeometry | null {
  const skin = glb.skins[skinIndex];
  if (!skin) return null;
  const jointOf = new Map<number, number>();
  skin.joints.forEach((n, j) => jointOf.set(n, j));
  const rigidJoint = (m: GlbMesh): number => {
    for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) { const j = jointOf.get(p); if (j !== undefined) return j; }
    return 0;
  };
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], mat: number[] = [], uv: number[] = [], jn: number[] = [], wt: number[] = [], idx: number[] = [];
  // shape keys: the first LOD0 mesh with targets names them; vertices without any delta get no row
  const named = glb.meshes.find((m) => m.lod <= 0 && m.targetNames.length > 0);
  const names = named?.targetNames ?? [];
  const T = names.length;
  const rowOf: number[] = [], table: number[] = [];
  for (const m of glb.meshes) {
    if (m.lod > 0 || (m.skin !== -1 && m.skin !== skinIndex)) continue;
    const rj = m.skin === -1 ? rigidJoint(m) : 0;
    for (const [pi, p] of m.primitives.entries()) {
      const mt = glb.materials[p.material];
      const base = pos.length / 3;
      const led = mt?.name === 'kn_screen';
      const ledGroups = leds?.groups.get(m)?.[pi] ?? null; // R5 (M5): kn_led vertices by LED group
      const c = led ? [...LED_RGB, 1] : mt?.baseColorFactor ?? [1, 1, 1, 1];
      const e = led ? 1 : mt ? Math.min(1, Math.max(...mt.emissiveFactor)) : 0;
      let vm: number[] = [mt?.roughnessFactor ?? 0.6, mt?.metallicFactor ?? 0, e, MAT_KIND.master];
      const layer = look && mt && !led && p.uvs && mt.texSet !== undefined && !EXEMPT.test(mt.name) ? look.layer(mt.name) : -1;
      if (layer >= 0) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < p.positions.length; k++) { lo[k % 3] = Math.min(lo[k % 3]!, p.positions[k]!); hi[k % 3] = Math.max(hi[k % 3]!, p.positions[k]!); }
        vm = [...layerBytes(layer), e, texSetKind(detailFor(mt!.name, [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!]))];
      }
      for (let i = 0; i < p.vertexCount; i++) {
        pos.push(p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
        if (p.normals) nrm.push(p.normals[i * 3]!, p.normals[i * 3 + 1]!, p.normals[i * 3 + 2]!); else nrm.push(0, 1, 0);
        if (led && screens.length && p.uvs) {
          // R5 (M5): the nearest art.json screen decides what this vertex draws
          const s = nearestScreen(screens, p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
          const sc = screenRgb(s.color);
          col.push(sc[0]!, sc[1]!, sc[2]!, 1);
          mat.push(...screenVm(s));
        } else if (ledGroups && leds && leds.colors[ledGroups[i * 2]!]) {
          // R5 (M5): an LED of group g: its colour, lit by the instance's level for g (leds.ts, shaders.ts ledLevel)
          const g = ledGroups[i * 2]!, lc = leds.colors[g]!;
          col.push(lc[0]!, lc[1]!, lc[2]!, 1);
          mat.push(0.3, 0, (LED_MARK + g) / 255, MAT_KIND.master);
        } else {
          col.push(c[0]!, c[1]!, c[2]!, c[3]!);
          mat.push(vm[0]!, vm[1]!, vm[2]!, vm[3]!);
        }
        if (p.uvs) uv.push(p.uvs[i * 2]!, p.uvs[i * 2 + 1]!); else uv.push(0, 0);
        let row = -1;
        if (T > 0 && p.targets.length === T && m.targetNames.join() === names.join()) {
          let any = false;
          for (const tg of p.targets) for (let c = 0; c < 3 && !any; c++) if ((tg.positions?.[i * 3 + c] ?? 0) !== 0 || (tg.normals?.[i * 3 + c] ?? 0) !== 0) any = true;
          if (any) {
            row = table.length;
            for (const tg of p.targets) for (const src of [tg.positions, tg.normals]) for (let c = 0; c < 3; c++) table.push(src?.[i * 3 + c] ?? 0);
          }
        }
        rowOf.push(row);
        if (p.joints && p.weights) {
          for (let k = 0; k < 4; k++) { jn.push(p.joints[i * 4 + k]!); wt.push(p.weights[i * 4 + k]!); }
        } else {
          jn.push(rj, 0, 0, 0); wt.push(1, 0, 0, 0);
        }
      }
      for (const k of p.indices) idx.push(base + k);
    }
  }
  if (!idx.length) return null;
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx),
    colors: new Float32Array(col), mats: new Float32Array(mat), uvs: new Float32Array(uv),
    joints: new Uint16Array(jn), weights: new Float32Array(wt),
    ...(T > 0 && table.length ? { morph: { names, rowOf: Int32Array.from(rowOf), table: new Float32Array(table) } } : {}),
  };
}

// ---- rig: rest pose, clips, cross-fade, ragdoll overrides ---------------------------------------------------

type M4 = Float32Array;

function trsMatrix(o: M4, t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): M4 {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  o[0] = (1 - 2 * (y * y + z * z)) * s[0]!; o[1] = 2 * (x * y + z * w) * s[0]!; o[2] = 2 * (x * z - y * w) * s[0]!; o[3] = 0;
  o[4] = 2 * (x * y - z * w) * s[1]!; o[5] = (1 - 2 * (x * x + z * z)) * s[1]!; o[6] = 2 * (y * z + x * w) * s[1]!; o[7] = 0;
  o[8] = 2 * (x * z + y * w) * s[2]!; o[9] = 2 * (y * z - x * w) * s[2]!; o[10] = (1 - 2 * (x * x + y * y)) * s[2]!; o[11] = 0;
  o[12] = t[0]!; o[13] = t[1]!; o[14] = t[2]!; o[15] = 1;
  return o;
}

function mul4(o: M4, a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[ao + r]! * b[bo + c * 4]! + a[ao + 4 + r]! * b[bo + c * 4 + 1]! + a[ao + 8 + r]! * b[bo + c * 4 + 2]! + a[ao + 12 + r]! * b[bo + c * 4 + 3]!;
    }
  }
}

/** Rigid inverse (rotation + translation, with scale handled via the general 3×3 inverse). */
export function invert4(o: M4, m: ArrayLike<number>): void {
  const a = m[0]!, b = m[4]!, c = m[8]!, d = m[1]!, e = m[5]!, f = m[9]!, g = m[2]!, h = m[6]!, k = m[10]!;
  const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  const i00 = A / det, i01 = -(b * k - c * h) / det, i02 = (b * f - c * e) / det;
  const i10 = B / det, i11 = (a * k - c * g) / det, i12 = -(a * f - c * d) / det;
  const i20 = C / det, i21 = -(a * h - b * g) / det, i22 = (a * e - b * d) / det;
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  o[0] = i00; o[1] = i10; o[2] = i20; o[3] = 0;
  o[4] = i01; o[5] = i11; o[6] = i21; o[7] = 0;
  o[8] = i02; o[9] = i12; o[10] = i22; o[11] = 0;
  o[12] = -(i00 * tx + i01 * ty + i02 * tz); o[13] = -(i10 * tx + i11 * ty + i12 * tz); o[14] = -(i20 * tx + i21 * ty + i22 * tz); o[15] = 1;
}

interface ClipChannel { slot: number; path: 0 | 1 | 2; sampler: number }
export interface RigClip { readonly name: string; readonly duration: number; readonly channels: readonly ClipChannel[]; readonly anim: GlbAnimation }

/** Pose blend input: one or two clips (cross-fade from `from` to `clip` by `w`, 0 → all `from`). */
export interface PoseInput {
  clip: RigClip | null;
  t: number;
  from?: RigClip | null;
  fromT?: number;
  w?: number;
  /** R5 (M5): edits the sampled local TRS (10 floats per slot: t, r, s) before the globals (BUZZ's rotors and winch). */
  adjust?: (local: Float32Array) => void;
}

export class Rig {
  /** Nodes that matter (joints and their ancestors), parents first. */
  readonly order: number[];
  readonly parentSlot: Int32Array;
  readonly jointSlot: Int32Array;
  readonly names: string[];
  readonly jointCount: number;
  readonly clips = new Map<string, RigClip>();
  /** Rest local TRS per slot: t(3) r(4) s(3). */
  readonly rest: Float32Array;
  /** Rest global (model space) per slot, 16 floats each. */
  readonly restGlobal: Float32Array;
  private readonly ibm: Float32Array;
  private readonly local: Float32Array;
  private readonly localB: Float32Array;
  private readonly global: Float32Array;
  private readonly tmp = new Float32Array(16);
  private readonly tmp2 = new Float32Array(16);
  private readonly val = new Float32Array(4);
  private readonly slotOfName = new Map<string, number>();

  /** `sockets`: non-deform nodes to track too (e.g. BANDIT's `prop_r`), found by name. */
  constructor(glb: ParsedGlb, skinIndex = 0, sockets: readonly string[] = []) {
    const skin = glb.skins[skinIndex]!;
    const need = new Set<number>();
    const extra = glb.nodes.flatMap((n, i) => (sockets.includes(n.name) ? [i] : []));
    for (const j of [...skin.joints, ...extra]) for (let p = j; p !== -1; p = glb.nodes[p]!.parent) need.add(p);
    const depth = (n: number): number => { let d = 0; for (let p = glb.nodes[n]!.parent; p !== -1; p = glb.nodes[p]!.parent) d++; return d; };
    this.order = [...need].sort((a, b) => depth(a) - depth(b) || a - b);
    const slot = new Map(this.order.map((n, i) => [n, i]));
    const S = this.order.length;
    this.parentSlot = new Int32Array(S);
    this.names = this.order.map((n) => glb.nodes[n]!.name);
    this.rest = new Float32Array(S * 10);
    this.order.forEach((n, i) => {
      const nd = glb.nodes[n]!;
      this.parentSlot[i] = nd.parent === -1 ? -1 : slot.get(nd.parent) ?? -1;
      this.rest.set(nd.translation, i * 10); this.rest.set(nd.rotation, i * 10 + 3); this.rest.set(nd.scale, i * 10 + 7);
      this.slotOfName.set(nd.name, i);
    });
    this.jointCount = skin.joints.length;
    this.jointSlot = Int32Array.from(skin.joints, (n) => slot.get(n)!);
    this.ibm = skin.inverseBindMatrices;
    this.local = new Float32Array(S * 10);
    this.localB = new Float32Array(S * 10);
    this.global = new Float32Array(S * 16);
    this.restGlobal = new Float32Array(S * 16);
    this.globals(this.rest, this.restGlobal, null);
    for (const a of glb.animations) {
      const channels: ClipChannel[] = [];
      for (const c of a.channels) {
        const s = slot.get(c.node);
        if (s === undefined || c.path === 'weights') continue;
        channels.push({ slot: s, path: c.path === 'translation' ? 0 : c.path === 'rotation' ? 1 : 2, sampler: c.sampler });
      }
      this.clips.set(a.name, { name: a.name, duration: a.duration, channels, anim: a });
    }
  }

  /** Model-space matrix of a slot from the last `evaluate` (a view: copy it before the next call). */
  globalOf(slot: number): Float32Array { return this.global.subarray(slot * 16, slot * 16 + 16); }

  /** Slot of a node by name (bone names, `RAG__` prefix stripped), or -1. */
  slotOf(name: string): number { return this.slotOfName.get(name.replace(/^RAG__/, '')) ?? -1; }

  private sampleInto(dst: Float32Array, clip: RigClip, t: number): void {
    for (const ch of clip.channels) {
      const s = clip.anim.samplers[ch.sampler]!;
      sampleAnim(s, t, this.val, ch.path === 1);
      const o = ch.slot * 10 + (ch.path === 0 ? 0 : ch.path === 1 ? 3 : 7);
      dst[o] = this.val[0]!; dst[o + 1] = this.val[1]!; dst[o + 2] = this.val[2]!;
      if (ch.path === 1) dst[o + 3] = this.val[3]!;
    }
  }

  private globals(local: Float32Array, out: Float32Array, override: ((slot: number, out: Float32Array) => boolean) | null): void {
    const S = this.order.length;
    for (let i = 0; i < S; i++) {
      const o = i * 10;
      if (override && override(i, this.tmp)) { out.set(this.tmp, i * 16); continue; }
      trsMatrix(this.tmp, local.subarray(o, o + 3), local.subarray(o + 3, o + 7), local.subarray(o + 7, o + 10));
      const p = this.parentSlot[i]!;
      if (p < 0) out.set(this.tmp, i * 16);
      else { mul4(this.tmp2, out, this.tmp, p * 16, 0); out.set(this.tmp2, i * 16); }
    }
  }

  /**
   * Evaluates the pose and writes 12 floats (3×4 rows) per joint into `bones` at `offset` (in joints).
   * `override(slot, out)` may supply a slot's global matrix (ragdoll bones); other slots follow their
   * parent with their rest (or animated) local transform.
   */
  evaluate(input: PoseInput, bones: Float32Array, offset: number, override: ((slot: number, out: Float32Array) => boolean) | null = null): void {
    this.local.set(this.rest);
    if (input.clip) this.sampleInto(this.local, input.clip, input.t);
    const w = input.from && input.w !== undefined ? Math.max(0, Math.min(1, input.w)) : 1;
    if (input.from && w < 1) {
      this.localB.set(this.rest);
      this.sampleInto(this.localB, input.from, input.fromT ?? 0);
      // blend from → clip: lerp t/s, slerp r
      const S = this.order.length;
      const q = this.val;
      for (let i = 0; i < S; i++) {
        const o = i * 10;
        for (const k of [0, 1, 2, 7, 8, 9]) this.local[o + k] = this.localB[o + k]! + (this.local[o + k]! - this.localB[o + k]!) * w;
        slerpInto(q, this.localB.subarray(o + 3, o + 7), this.local.subarray(o + 3, o + 7), w);
        this.local.set(q, o + 3);
      }
    }
    input.adjust?.(this.local); // R5 (M5)
    this.globals(this.local, this.global, override);
    const g = this.global, m = this.tmp;
    for (let j = 0; j < this.jointCount; j++) {
      mul4(m, g, this.ibm, this.jointSlot[j]! * 16, j * 16);
      const o = (offset + j) * 12;
      bones[o] = m[0]!; bones[o + 1] = m[4]!; bones[o + 2] = m[8]!; bones[o + 3] = m[12]!;
      bones[o + 4] = m[1]!; bones[o + 5] = m[5]!; bones[o + 6] = m[9]!; bones[o + 7] = m[13]!;
      bones[o + 8] = m[2]!; bones[o + 9] = m[6]!; bones[o + 10] = m[10]!; bones[o + 11] = m[14]!;
    }
  }
}

/** Column-major matrix from a position + quaternion (sim body transforms). */
export function poseMatrix(o: Float32Array, p: ArrayLike<number>, q: ArrayLike<number>): Float32Array {
  return trsMatrix(o, p, q, [1, 1, 1]);
}

export { mul4 };
