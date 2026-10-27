// Backlot terrain in the renderer (environments.md §4.2; M3_PLAN contract 4: "a mesh in gfx"). The sim's u16
// heightfield (format terrain.ts) drawn as one grid mesh through the renderer's hook interface (RenderHook), with its
// own buffers so a sculpt stroke rewrites vertices in place: 1 m vertices on Arena (257² of the 513² samples),
// 2 m on Megastructure. Layers follow the brief's procedural rules, as vertex colours: rock where the slope is over
// 38° (8° blend), sand in basins more than 1 m under default ground, grass elsewhere. Lit by the frame's key light
// (with the shadow map), fill and sky. Also: TerrainBrushTool, which turns a drag on the terrain into the
// deterministic TerrainStroke ops the doc applies.
//
// Later (art pass): the clipmap with bicubic refinement and tiling detail textures, grass clumps, the disturbed mask.

import { TERRAIN_SPACING, terrainHeightAt, terrainMetres, type TerrainBrush, type TerrainRecord, type TerrainStroke } from '@knockon/format';
import type { RenderHook, Renderer } from './renderer.ts';
import { FRAME_WGSL } from './shaders.ts';

const STRIDE_BYTES = 28; // pos f32×3, normal snorm16×4 (8 B), colour unorm8×4, pad
const LAYER = { grass: [0.157, 0.319, 0.068], dirt: [0.27, 0.147, 0.068], sand: [0.672, 0.514, 0.271], rock: [0.258, 0.235, 0.216] } as const; // linear #6E9A48 #8E6B4A #D6BE8E #8B8580

const WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var shadowFarMap: texture_depth_2d; // RENDER (beta polish, D125): the far key-light cascade
struct VOut { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) color: vec3f };
@vertex
fn vs(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) col: vec4f) -> VOut {
  var o: VOut;
  let rel = pos - frame.eye.xyz;
  o.clip = frame.viewProj * vec4f(rel, 1.0);
  o.rel = rel;
  o.n = nrm.xyz;
  o.color = col.rgb * col.rgb; // stored as sqrt(linear)
  return o;
}
@vertex
fn vs_shadow(@location(0) pos: vec3f) -> @builtin(position) vec4f {
  return frame.shadowMat * vec4f(pos - frame.eye.xyz, 1.0);
}
fn shadowAt(rel: vec3f, n: vec3f) -> f32 {
  let p = frame.shadowMat * vec4f(rel + n * 0.05, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  let near = textureSampleCompareLevel(shadowMap, shadowSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), p.z - 0.002);
  let q = frame.shadowFar * vec4f(rel + n * max(0.05, frame.shadowFarP.w * 1.5), 1.0);
  let fuv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  var far = textureSampleCompareLevel(shadowFarMap, shadowSampler, clamp(fuv, vec2f(0.0), vec2f(1.0)), q.z - frame.nearP.y);
  if (frame.shadowFarP.x < 0.5 || any(fuv < vec2f(0.0)) || any(fuv > vec2f(1.0)) || q.z > 1.0) { far = 1.0; }
  far = mix(far, 1.0, smoothstep(frame.shadowFarP.y, frame.shadowFarP.z, length(rel)));
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || p.z > 1.0) { return far; }
  // RENDER (beta polish, D125): the near map inside its box, blending to the far cascade over its outer 6 %
  let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return mix(far, near, smoothstep(0.0, 0.06, e));
}
@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.n);
  let key = frame.key.xyz;
  let lit = max(dot(n, key), 0.0) * frame.key.w * frame.keyColor.rgb * shadowAt(in.rel, n) + max(dot(n, frame.fill.xyz), 0.0) * frame.fill.w;
  let sky = mix(frame.horizon.rgb, frame.skyTop.rgb, n.y * 0.5 + 0.5);
  return vec4f(in.color * (lit * 0.4 + sky * 0.5), 1.0);
}
`;

export class TerrainView implements RenderHook {
  private readonly r: Renderer;
  private readonly d: GPUDevice;
  private pipe: GPURenderPipeline | null = null;
  private shadowPipe: GPURenderPipeline | null = null;
  private bind: GPUBindGroup | null = null;
  private vbuf: GPUBuffer | null = null;
  private ibuf: GPUBuffer | null = null;
  private indexCount = 0;
  private t: TerrainRecord | null = null;
  private rev = -1;
  private step = 2;
  private n = 0;
  private verts: ArrayBuffer = new ArrayBuffer(0);
  /** Vertices rewritten on the last update (sculpting), for the perf HUD. */
  lastUpdateMs = 0;

  constructor(renderer: Renderer) {
    this.r = renderer;
    this.d = renderer.device;
    renderer.addHook(this);
    // M4 (V4): after a device loss: the new device, no GPU objects (rebuilt lazily), the hook again
    renderer.onRestore(() => {
      (this as unknown as { d: GPUDevice }).d = renderer.device;
      this.pipe = this.shadowPipe = null;
      this.bind = this.shadowBind = null;
      this.vbuf = this.ibuf = null;
      this.t = null;
      this.rev = -1;
      renderer.addHook(this);
    });
  }

  /** The terrain to draw (null: none) and its revision (WorldDoc.terrainRev); rebuilt or rewritten on change. */
  set(t: TerrainRecord | null, rev = 0): void {
    if (t === this.t && rev === this.rev) return;
    const t0 = performance.now();
    const sameGrid = !!t && !!this.t && t.nx === this.t.nx && t.nz === this.t.nz;
    this.t = t;
    this.rev = rev;
    if (!t) { this.indexCount = 0; return; }
    if (!sameGrid || !this.vbuf) this.build(t);
    this.fill(t);
    this.d.queue.writeBuffer(this.vbuf!, 0, this.verts);
    this.lastUpdateMs = performance.now() - t0;
  }

  get active(): boolean { return this.indexCount > 0; }

  private build(t: TerrainRecord): void {
    this.step = t.nx > 1025 ? 4 : 2;
    this.n = Math.floor((t.nx - 1) / this.step) + 1;
    const n = this.n;
    this.verts = new ArrayBuffer(n * n * STRIDE_BYTES);
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
      const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
      idx.set([a, c, b, b, c, d], k); k += 6;
    }
    this.indexCount = idx.length;
    this.vbuf?.destroy(); this.ibuf?.destroy();
    this.vbuf = this.d.createBuffer({ label: 'terrain.v', size: this.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.ibuf = this.d.createBuffer({ label: 'terrain.i', size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.d.queue.writeBuffer(this.ibuf, 0, idx);
  }

  /** Vertex positions, normals (central differences) and layer colours from the samples. */
  private fill(t: TerrainRecord): void {
    const n = this.n, s = this.step;
    const f = new Float32Array(this.verts), u8 = new Uint8Array(this.verts), i16 = new Int16Array(this.verts);
    const h = (x: number, z: number): number => terrainMetres(t, t.heights[Math.min(t.nz - 1, Math.max(0, z)) * t.nx + Math.min(t.nx - 1, Math.max(0, x))]!);
    const ground = t.preset === 'megastructure' ? 16 : 4;
    const span = s * TERRAIN_SPACING;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const sx = x * s, sz = z * s;
      const y = h(sx, sz);
      const nx = h(sx - s, sz) - h(sx + s, sz), nz = h(sx, sz - s) - h(sx, sz + s), ny = 2 * span;
      const l = Math.hypot(nx, ny, nz);
      const o = (z * n + x) * STRIDE_BYTES;
      f[o / 4] = t.origin[0] + sx * TERRAIN_SPACING; f[o / 4 + 1] = y; f[o / 4 + 2] = t.origin[1] + sz * TERRAIN_SPACING;
      i16[o / 2 + 6] = Math.round((nx / l) * 32767); i16[o / 2 + 7] = Math.round((ny / l) * 32767); i16[o / 2 + 8] = Math.round((nz / l) * 32767); i16[o / 2 + 9] = 0;
      const slope = Math.acos(Math.min(1, ny / l)) * (180 / Math.PI);
      const rock = Math.min(1, Math.max(0, (slope - 34) / 8));
      const sand = Math.min(1, Math.max(0, (ground - 1 - y) / 0.5));
      const base = LAYER.grass.map((g, i) => g + (LAYER.sand[i]! - g) * sand);
      const c = base.map((b, i) => b + (LAYER.rock[i]! - b) * rock);
      // linear colour as unorm8 (dark greens survive: these are ≥ 0.07)
      u8[o + 20] = Math.round(Math.sqrt(c[0]!) * 255); u8[o + 21] = Math.round(Math.sqrt(c[1]!) * 255); u8[o + 22] = Math.round(Math.sqrt(c[2]!) * 255); u8[o + 23] = 255;
    }
  }

  private ensurePipes(): void {
    if (this.pipe) return;
    const tg = this.r.spectacleTargets();
    const mod = this.d.createShaderModule({ label: 'terrain', code: WGSL });
    const layout = this.d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }, // RENDER (beta polish)
      ],
    });
    const vb: GPUVertexBufferLayout = {
      arrayStride: STRIDE_BYTES,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm16x4' }, { shaderLocation: 2, offset: 20, format: 'unorm8x4' }],
    };
    this.pipe = this.d.createRenderPipeline({
      label: 'terrain', layout: this.d.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: mod, entryPoint: 'vs', buffers: [vb] },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: tg.colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: tg.msaa },
    });
    const shadowLayout = this.d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
    this.shadowPipe = this.d.createRenderPipeline({
      label: 'terrain.shadow', layout: this.d.createPipelineLayout({ bindGroupLayouts: [shadowLayout] }),
      vertex: { module: mod, entryPoint: 'vs_shadow', buffers: [{ arrayStride: STRIDE_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 },
    });
    this.bind = this.d.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: tg.frameBuf } }, { binding: 1, resource: tg.shadowView }, { binding: 2, resource: tg.shadowSampler }, { binding: 3, resource: tg.shadowFarView }] });
    this.shadowBind = this.d.createBindGroup({ layout: shadowLayout, entries: [{ binding: 0, resource: { buffer: tg.frameBuf } }] });
  }
  private shadowBind: GPUBindGroup | null = null;

  drawShadow(pass: GPURenderPassEncoder): void {
    if (!this.indexCount) return;
    this.ensurePipes();
    pass.setPipeline(this.shadowPipe!);
    pass.setBindGroup(0, this.shadowBind!);
    pass.setVertexBuffer(0, this.vbuf!);
    pass.setIndexBuffer(this.ibuf!, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  drawOpaque(pass: GPURenderPassEncoder): void {
    if (!this.indexCount) return;
    this.ensurePipes();
    pass.setPipeline(this.pipe!);
    pass.setBindGroup(0, this.bind!);
    pass.setVertexBuffer(0, this.vbuf!);
    pass.setIndexBuffer(this.ibuf!, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  /** Terrain height under a point (placement, the camera): 0 without terrain. */
  heightAt(x: number, z: number): number { return this.t ? terrainHeightAt(this.t, x, z) : 0; }
}

/**
 * The minimal Backlot sculpt tool (GAME_SPEC §7.3: raise / lower / flatten / smooth): call `stroke()` with the
 * world points a drag crossed; it returns one TerrainStroke op per drag segment (stamps every half radius, ≤ 512
 * points), quantized to pos units, ready for `net.submit`. The doc applies it the same way on every client.
 */
export class TerrainBrushTool {
  brush: TerrainBrush = 0;
  radius = 3;      // metres
  strength = 500;  // ‰ per stamp
  private last: [number, number, number] | null = null;

  /** Start a drag. */
  begin(): void { this.last = null; }

  /** The drag reached `p` (world metres on the terrain): the op to submit, or null when it hasn't moved far enough. */
  stroke(p: readonly [number, number, number]): { k: 'TerrainStroke'; stroke: TerrainStroke } | null {
    const step = Math.max(0.25, this.radius / 2);
    const pts: [number, number, number][] = [];
    if (!this.last) pts.push([p[0], p[1], p[2]]);
    else {
      const d = Math.hypot(p[0] - this.last[0], p[2] - this.last[2]);
      if (d < step) return null;
      const n = Math.min(512, Math.floor(d / step));
      for (let i = 1; i <= n; i++) pts.push([this.last[0] + ((p[0] - this.last[0]) * i) / n, p[1], this.last[2] + ((p[2] - this.last[2]) * i) / n]);
    }
    this.last = pts.at(-1)!;
    const q = (m: number): number => Math.round(m * 640);
    return {
      k: 'TerrainStroke',
      stroke: { brush: this.brush, radius: Math.max(320, Math.min(25600, q(this.radius))), strength: Math.max(1, Math.min(1000, Math.round(this.strength))), points: pts.map((v) => [q(v[0]), q(v[1]), q(v[2])] as const) },
    };
  }
}
