// Octahedral impostors for far parts (GAME_SPEC §14, RENDERING §5; M3_PLAN contract 4: "via the cull pass's LOD 4").
//
// In Arena and Megastructure worlds a part whose projected size drops under ~24 px is drawn as one camera-facing
// quad instead of its mesh. Each art mesh gets an 8 × 8 octahedral atlas (64 views over the sphere, 64 px each, in
// one layer of two 2D-array textures: linear albedo + coverage, and the mesh-space normal), baked on the GPU the
// first time an impostor-enabled scene uses it. The cull pass picks the impostor as the mesh's extra LOD bucket
// (after LOD0–3), so it costs nothing on the CPU and the instance lists stay GPU-driven; this module draws those
// buckets with one indirect draw each, choosing the view nearest the camera direction in the part's own frame
// (run mode: its body's rotation) and lighting the stored normal with the frame's key light and sky.
//
// What's left for later: blending between neighbouring views, impostor shadows (the shadow pass keeps its
// fixed LOD, and far parts are past the shadow map anyway), and blockout primitives (they're instance-scaled
// and coloured, so only art meshes get atlases).

import { FRAME_WGSL, INST_WGSL } from './shaders.ts';
import { VERTEX_STRIDE, type MeshLibrary } from './meshes.ts';

/** Views per atlas side (8 × 8 = 64 directions) and pixels per view. */
const GRID = 8;
const VIEW_PX = 64;
const SIDE = GRID * VIEW_PX;
/** Most meshes with atlases at once (2 × 1 MB per layer). */
const MAX_LAYERS = 96;
/** Impostor table row: center xyz, radius, layer, pad (32 B). */
const ROW = 8;

const IMPOSTOR_WGSL = /* wgsl */ `
${FRAME_WGSL}
${INST_WGSL}
struct Imp { center: vec3f, radius: f32, layer: u32, p0: u32, p1: u32, p2: u32 };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(0) @binding(2) var<storage, read> xf: array<f32>;
@group(0) @binding(3) var<storage, read> visible: array<u32>;
@group(0) @binding(4) var albedo: texture_2d_array<f32>;
@group(0) @binding(5) var normals: texture_2d_array<f32>;
@group(0) @binding(6) var samp: sampler;
@group(0) @binding(7) var<storage, read> table: array<Imp>;
@group(1) @binding(0) var<uniform> bucket: vec4u;

const GRID: f32 = ${GRID}.0;

// octahedral map: unit direction → [0, 1]² and back (full sphere)
fn octEncode(d: vec3f) -> vec2f {
  var n = d / (abs(d.x) + abs(d.y) + abs(d.z));
  if (n.y < 0.0) {
    let s = vec2f(select(-1.0, 1.0, n.x >= 0.0), select(-1.0, 1.0, n.z >= 0.0));
    n = vec3f((1.0 - abs(n.z)) * s.x, n.y, (1.0 - abs(n.x)) * s.y);
  }
  return n.xz * 0.5 + 0.5;
}
fn octDecode(uv: vec2f) -> vec3f {
  let f = uv * 2.0 - 1.0;
  var n = vec3f(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
  if (n.y < 0.0) {
    let s = vec2f(select(-1.0, 1.0, n.x >= 0.0), select(-1.0, 1.0, n.z >= 0.0));
    n = vec3f((1.0 - abs(n.z)) * s.x, n.y, (1.0 - abs(n.x)) * s.y);
  }
  return normalize(n);
}
/** The baked camera basis for view direction d (mesh space; d points from the mesh toward the camera). */
fn viewBasis(d: vec3f) -> mat3x3f {
  let up0 = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(d.y) > 0.99);
  let right = normalize(cross(up0, d));
  let up = cross(d, right);
  return mat3x3f(right, up, d);
}
fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) layer: u32,
  @location(2) @interpolate(flat) rot: vec4f,
  @location(3) @interpolate(flat) color: vec4f,
};

@vertex
fn vs(@location(0) pos: vec3f, @builtin(instance_index) ii: u32) -> VOut {
  let inst = insts[visible[bucket.x + ii]];
  var p = inst.pos;
  var r = inst.rot;
  if (frame.params.y > 0.5 && inst.body >= 0) {
    let b = u32(inst.body) * 7u;
    let br = vec4f(xf[b + 3u], xf[b + 4u], xf[b + 5u], xf[b + 6u]);
    p = vec3f(xf[b], xf[b + 1u], xf[b + 2u]) + qrot(br, inst.pos);
    r = qmul(br, inst.rot);
  }
  let m = table[inst.mesh];
  let s = max(inst.size.x, max(inst.size.y, inst.size.z));
  let c = p + qrot(r, m.center * inst.size);
  let toEye = normalize(frame.eye.xyz - c);
  // nearest baked view, in the part's own frame
  let dl = qrot(qconj(r), toEye);
  let cell = clamp(floor(octEncode(dl) * GRID), vec2f(0.0), vec2f(GRID - 1.0));
  let dv = octDecode((cell + 0.5) / GRID);
  let B = viewBasis(dv);
  let right = qrot(r, B[0]);
  let up = qrot(r, B[1]);
  let rad = m.radius * s;
  let world = c + (right * pos.x + up * pos.y) * 2.0 * rad;
  var o: VOut;
  o.clip = frame.viewProj * vec4f(world - frame.eye.xyz, 1.0);
  // quad corner (−0.5…0.5) → that view's cell; v grows down in the texture
  o.uv = (cell + vec2f(pos.x + 0.5, 0.5 - pos.y)) / GRID;
  o.layer = m.layer;
  o.rot = r;
  o.color = unpackColor(inst.color);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let a = textureSampleLevel(albedo, samp, in.uv, i32(in.layer), 0.0);
  if (a.a < 0.5) { discard; }
  let nl = textureSampleLevel(normals, samp, in.uv, i32(in.layer), 0.0).xyz * 2.0 - 1.0;
  let n = normalize(qrot(in.rot, nl));
  let key = frame.key.xyz;
  let diffuse = max(dot(n, key), 0.0) * frame.key.w * frame.keyColor.rgb + max(dot(n, frame.fill.xyz), 0.0) * frame.fill.w;
  let sky = mix(frame.horizon.rgb, frame.skyTop.rgb, n.y * 0.5 + 0.5) * 0.35;
  let base = a.rgb * in.color.rgb;
  // matched by eye to the mesh look at 10 m (Kiloton walls); RENDER (beta polish, D125): × 1.65 once textured parts bake their
  // set's albedo (measured against the meshes at the switch: STITCH, PIN, BRIK came out ≈ 0.6 × in linear)
  return vec4f(base * (diffuse * 0.42 + sky * 1.35) * 1.65, 1.0);
}
`;

// RENDER (beta polish, D125): textured materials (kind byte 192-223, look/materials.ts) take their texture set's albedo
// (a small mip: a 64 px view is far below the set's size). Before, they baked their glTF base colour, a placeholder for
// most textured parts, so their impostors came out dark (a STITCH or BRIK turned brown at the switch).
const BAKE_WGSL = /* wgsl */ `
struct View { vp: mat4x4f, center: vec4f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var setAlbedo: texture_2d_array<f32>;
@group(0) @binding(2) var setAlbedo2k: texture_2d_array<f32>;
@group(0) @binding(3) var setSamp: sampler;
struct VOut { @builtin(position) clip: vec4f, @location(0) color: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) @interpolate(flat) tset: u32 };
@vertex
fn vs(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) col: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f) -> VOut {
  var o: VOut;
  o.clip = view.vp * vec4f(pos - view.center.xyz, 1.0);
  o.color = pow(col.rgb, vec3f(2.2));
  o.n = nrm.xyz;
  o.uv = uv;
  let kb = u32(round(vmat.w * 255.0));
  o.tset = 0u;
  if (kb >= 192u && kb < 224u) { o.tset = u32(round(vmat.x * 255.0)) + u32(round(vmat.y * 255.0)) * 256u + 1u; }
  return o;
}
struct FOut { @location(0) albedo: vec4f, @location(1) normal: vec4f };
@fragment
fn fs(in: VOut) -> FOut {
  var o: FOut;
  var c = in.color;
  if (in.tset > 0u) {
    let code = in.tset - 1u;
    let L = i32(code & 0x7fffu);
    if ((code & 0x8000u) != 0u) {
      c = textureSampleLevel(setAlbedo2k, setSamp, in.uv, L, max(f32(textureNumLevels(setAlbedo2k)) - 6.0, 0.0)).rgb;
    } else {
      c = textureSampleLevel(setAlbedo, setSamp, in.uv, L, max(f32(textureNumLevels(setAlbedo)) - 6.0, 0.0)).rgb;
    }
  }
  o.albedo = vec4f(c, 1.0);
  o.normal = vec4f(normalize(in.n) * 0.5 + 0.5, 1.0);
  return o;
}
`;

/** CPU twin of the shader's octDecode + viewBasis (the bake must match the draw exactly). */
function octDecode(u: number, v: number): [number, number, number] {
  const fx = u * 2 - 1, fz = v * 2 - 1;
  let x = fx, y = 1 - Math.abs(fx) - Math.abs(fz), z = fz;
  if (y < 0) { const sx = x >= 0 ? 1 : -1, sz = z >= 0 ? 1 : -1; const nx = (1 - Math.abs(z)) * sx, nz = (1 - Math.abs(x)) * sz; x = nx; z = nz; }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const normalize = (a: number[]): number[] => { const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };

/** Ortho view-projection looking along −d at the origin, fitting radius r (WebGPU depth 0..1). */
function bakeMatrix(d: number[], r: number): Float32Array {
  const up0 = Math.abs(d[1]!) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(up0, d)), up = cross(d, right);
  // rows: x = right·p / r, y = up·p / r, z = (r − d·p) / 2r (camera on +d at distance r: near 0, far 1)
  const m = new Float32Array(16);
  m[0] = right[0]! / r; m[4] = right[1]! / r; m[8] = right[2]! / r;
  m[1] = up[0]! / r; m[5] = up[1]! / r; m[9] = up[2]! / r;
  m[2] = -d[0]! / (2 * r); m[6] = -d[1]! / (2 * r); m[10] = -d[2]! / (2 * r); m[14] = 0.5;
  m[15] = 1;
  return m;
}

export interface ImpostorBucket { readonly bucket: number; readonly mesh: number }

export class Impostors {
  /** Projected diameter (px) below which a part draws as an impostor; 0 = off (Desk, Room, Warehouse). */
  thresholdPx = 0;
  private readonly d: GPUDevice;
  private readonly lib: MeshLibrary;
  private readonly albedo: GPUTexture;
  private readonly normals: GPUTexture;
  private table: GPUBuffer;
  private readonly tableCpu = new Float32Array(MAX_LAYERS * ROW * 4);
  private readonly layerOfMesh = new Map<number, number>();
  private readonly pipe: GPURenderPipeline;
  private readonly bakePipe: GPURenderPipeline;
  private readonly bakeLayout: GPUBindGroupLayout;
  private readonly layout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private bakeDepth: GPUTexture;
  private tableRows = 64;
  private bind: GPUBindGroup | null = null;
  private bindKey: unknown[] = [];
  /** Meshes baked since the renderer last rebuilt its buckets (it must add their impostor buckets). */
  dirty = false;

  constructor(device: GPUDevice, lib: MeshLibrary, colorFormat: GPUTextureFormat, msaa: number, bucketLayout: GPUBindGroupLayout) {
    this.d = device;
    this.lib = lib;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    this.albedo = device.createTexture({ label: 'impostor.albedo', size: [SIDE, SIDE, MAX_LAYERS], format: 'rgba8unorm', usage });
    this.normals = device.createTexture({ label: 'impostor.normal', size: [SIDE, SIDE, MAX_LAYERS], format: 'rgba8unorm', usage });
    this.bakeDepth = device.createTexture({ size: [SIDE, SIDE], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.table = device.createBuffer({ label: 'impostor.table', size: this.tableRows * ROW * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const ro = { type: 'read-only-storage' as const };
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } }, { binding: 1, visibility: V, buffer: ro }, { binding: 2, visibility: V, buffer: ro },
        { binding: 3, visibility: V, buffer: ro }, { binding: 4, visibility: F, texture: { viewDimension: '2d-array' } },
        { binding: 5, visibility: F, texture: { viewDimension: '2d-array' } }, { binding: 6, visibility: F, sampler: {} }, { binding: 7, visibility: V, buffer: ro },
      ],
    });
    const mod = device.createShaderModule({ label: 'impostor', code: IMPOSTOR_WGSL });
    this.pipe = device.createRenderPipeline({
      label: 'impostor',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout, bucketLayout] }),
      vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: msaa },
    });
    this.bakeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: F, texture: { viewDimension: '2d-array' } }, { binding: 2, visibility: F, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: F, sampler: {} },
      ],
    });
    const bakeMod = device.createShaderModule({ label: 'impostor.bake', code: BAKE_WGSL });
    this.bakePipe = device.createRenderPipeline({
      label: 'impostor.bake',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bakeLayout] }),
      vertex: {
        module: bakeMod, entryPoint: 'vs',
        buffers: [{ arrayStride: VERTEX_STRIDE, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm16x4' }, { shaderLocation: 2, offset: 20, format: 'unorm8x4' },
          { shaderLocation: 3, offset: 24, format: 'unorm8x4' }, { shaderLocation: 4, offset: 28, format: 'unorm16x2' }, // RENDER (beta polish): material, uv
        ] }],
      },
      fragment: { module: bakeMod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
  }

  /** RENDER (beta polish, D125): the texture-set albedo arrays the bake samples, and the version it last baked with. */
  private sets: { a1k: GPUTexture; a2k: GPUTexture; version: number } | null = null;
  private bakedVersion = -1;

  /** The atlas layer of a mesh, or −1 (not baked: no impostor bucket). */
  layerOf(mesh: number): number { return this.layerOfMesh.get(mesh) ?? -1; }

  get enabled(): boolean { return this.thresholdPx > 0; }

  /**
   * Bakes atlases for the scene's art meshes that don't have one yet (the meshes with instances, art only: the
   * built-in primitives are instance-scaled). Needs the library uploaded. Marks `dirty` when it baked any.
   */
  ensure(meshCounts: readonly (number | undefined)[], sets?: { a1k: GPUTexture; a2k: GPUTexture; version: number }): void {
    if (!this.enabled || !this.lib.vertexBuffer || !this.lib.indexBuffer) return;
    // RENDER (beta polish, D125): the bake samples the look's albedo arrays; when their version changed since the last
    // bake (sets streamed in or were reloaded), every atlas is baked again
    if (sets) this.sets = sets;
    if (this.sets && this.sets.version !== this.bakedVersion && this.layerOfMesh.size) { this.layerOfMesh.clear(); this.dirty = true; }
    this.bakedVersion = this.sets?.version ?? -1;
    const todo: number[] = [];
    meshCounts.forEach((n, id) => {
      const m = this.lib.meshes[id];
      if (!n || !m || id < 3 || m.glass || m.radius <= 0 || this.layerOfMesh.has(id) || m.name.startsWith('cove:') || m.name.startsWith('impostor:')) return;
      if (this.layerOfMesh.size + todo.length >= MAX_LAYERS) return;
      todo.push(id);
    });
    if (!todo.length) return;
    const views = GRID * GRID;
    const ubo = this.d.createBuffer({ size: todo.length * views * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new Float32Array(todo.length * views * 64);
    todo.forEach((id, k) => {
      const m = this.lib.meshes[id]!;
      for (let v = 0; v < views; v++) {
        const cx = v % GRID, cy = Math.floor(v / GRID);
        const dir = octDecode((cx + 0.5) / GRID, (cy + 0.5) / GRID);
        const o = (k * views + v) * 64;
        data.set(bakeMatrix(dir, m.radius * 1.0), o);
        data.set([m.center[0], m.center[1], m.center[2], 0], o + 16);
      }
    });
    this.d.queue.writeBuffer(ubo, 0, data);
    const dummy = this.sets ? null : this.d.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
    const bind = this.d.createBindGroup({
      layout: this.bakeLayout,
      entries: [
        { binding: 0, resource: { buffer: ubo, size: 80 } },
        { binding: 1, resource: (this.sets?.a1k ?? dummy!).createView({ dimension: '2d-array' }) },
        { binding: 2, resource: (this.sets?.a2k ?? dummy!).createView({ dimension: '2d-array' }) },
        { binding: 3, resource: this.sampler },
      ],
    });
    const enc = this.d.createCommandEncoder({ label: 'impostor.bake' });
    todo.forEach((id, k) => {
      const layer = this.layerOfMesh.size;
      this.layerOfMesh.set(id, layer);
      const m = this.lib.meshes[id]!;
      const lod = m.lods[Math.min(1, m.lods.length - 1)]!; // LOD1: plenty of detail for 64 px
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: this.albedo.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          { view: this.normals.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0.5, b: 1, a: 0 } },
        ],
        depthStencilAttachment: { view: this.bakeDepth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setPipeline(this.bakePipe);
      pass.setVertexBuffer(0, this.lib.vertexBuffer!);
      pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
      for (let v = 0; v < views; v++) {
        // the shader's v grows down: cell row cy is texture rows cy·VIEW_PX…
        pass.setViewport((v % GRID) * VIEW_PX, Math.floor(v / GRID) * VIEW_PX, VIEW_PX, VIEW_PX, 0, 1);
        pass.setBindGroup(0, bind, [(k * views + v) * 256]);
        pass.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, 0);
      }
      pass.end();
      const row = layer * ROW;
      this.tableCpu.set([m.center[0], m.center[1], m.center[2], m.radius], row);
      new Uint32Array(this.tableCpu.buffer, (row + 4) * 4, 1)[0] = layer;
    });
    this.d.queue.submit([enc.finish()]);
    ubo.destroy();
    dummy?.destroy();
    this.dirty = true;
  }

  /** Per-mesh table rows (indexed by mesh id) for the shader: written by the renderer after setScene. */
  writeTable(meshCount: number): void {
    if (meshCount > this.tableRows) {
      this.tableRows = Math.max(meshCount, this.tableRows * 2);
      this.table.destroy();
      this.table = this.d.createBuffer({ label: 'impostor.table', size: this.tableRows * ROW * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.bind = null;
    }
    const t = new Float32Array(this.tableRows * ROW);
    const u = new Uint32Array(t.buffer);
    for (const [mesh, layer] of this.layerOfMesh) {
      if (mesh >= this.tableRows) continue;
      t.set(this.tableCpu.subarray(layer * ROW, layer * ROW + 4), mesh * ROW);
      u[mesh * ROW + 4] = layer;
    }
    this.d.queue.writeBuffer(this.table, 0, t);
  }

  /** Draws the impostor buckets of a view (the cull pass's args and visible lists). Call inside the main pass. */
  draw(pass: GPURenderPassEncoder, buckets: readonly ImpostorBucket[], args: GPUBuffer, res: { frame: GPUBuffer; insts: GPUBuffer; xf: GPUBuffer; visible: GPUBuffer; bucketBind: GPUBindGroup; bucketStride: number; quad: { firstIndex: number; baseVertex: number } }): void {
    if (!buckets.length || !this.lib.vertexBuffer) return;
    const key = [res.frame, res.insts, res.xf, res.visible, this.table];
    if (!this.bind || key.some((k, i) => k !== this.bindKey[i])) {
      this.bindKey = key;
      this.bind = this.d.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: res.frame } }, { binding: 1, resource: { buffer: res.insts } }, { binding: 2, resource: { buffer: res.xf } },
          { binding: 3, resource: { buffer: res.visible } }, { binding: 4, resource: this.albedo.createView({ dimension: '2d-array' }) },
          { binding: 5, resource: this.normals.createView({ dimension: '2d-array' }) }, { binding: 6, resource: this.sampler }, { binding: 7, resource: { buffer: this.table } },
        ],
      });
    }
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.lib.vertexBuffer);
    pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
    for (const b of buckets) {
      pass.setBindGroup(1, res.bucketBind, [b.bucket * res.bucketStride]);
      pass.drawIndexedIndirect(args, b.bucket * 20);
    }
  }
}

/** A unit quad (±0.5 in x/y) for the impostor buckets' indirect draws (registered in the mesh library). */
export function impostorQuad(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  return {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}
