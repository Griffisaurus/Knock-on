// Practical lamps (environments.md §3.4, E3b's `tinker.env.json → presets.<p>.practicals`): downward spot
// lights under the enamel shades, with an inner/outer cone so the back wall gets its warm pools, and one
// shadowed lamp (the centre bench pendant) on 12 GB and up.
//
// Intensity follows the key art (D82) rather than photometric lux: the Cycles rig lights the bench with 70 W
// point lights against a strength-9 sun, so one lamp is cyclesWatts / 4π W/sr scaled into engine units by
// keyI / 9 (the same conversion as the baked IBL). The photometric candela is kept in the data.
//
// The shadowed lamp's map is a perspective depth map: the static set casters are rendered once into a cache
// (when the set or the lamp changes) and copied in each frame, then the parts inside the cone are drawn on top.

import type { Mat4, V3 } from '../../math.ts';
import { lookAt, mul, perspective } from '../../math.ts';
import type { MeshLibrary } from '../meshes.ts';
import { VERTEX_STRIDE } from '../meshes.ts';
import type { SetMesh } from './setbake.ts';

export const MAX_SPOTS = 8;

/** One practical as E3b's data gives it (preset world coordinates). */
export interface Practical {
  readonly pos: readonly number[]; readonly dir: readonly number[]; readonly color: readonly number[];
  readonly innerConeDeg: number; readonly outerConeDeg: number; readonly rangeM: number; readonly bulbRadiusM: number;
  readonly cyclesWatts?: number; readonly candela?: number; readonly shadowed?: boolean;
}

const CASTER_WGSL = /* wgsl */ `
struct U { vp: mat4x4f, offset: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) pos: vec3f) -> @builtin(position) vec4f { return u.vp * vec4f(pos + u.offset.xyz, 1.0); }
`;

export class Practicals {
  private readonly d: GPUDevice;
  readonly size: number;
  /** The shadowed lamp's depth map (null below 12 GB). */
  readonly map: GPUTexture;
  private readonly cache: GPUTexture | null;
  private cacheKey = '';
  private readonly pipe: GPURenderPipeline;
  private readonly uBuf: GPUBuffer;
  private readonly bind: GPUBindGroup;
  list: Practical[] = [];
  /** World → shadowed-lamp clip (multiply by T(eye) for camera-relative use). */
  vp: Mat4 = new Float32Array(16);
  shadowIndex = -1;
  /** Engine radiant intensity per Cycles watt (keyI / 9 / 4π); set from the light rig. */
  wattScale = 4.2 / 9 / (4 * Math.PI);

  constructor(device: GPUDevice, shadows: boolean) {
    this.d = device;
    this.size = shadows ? 1024 : 1;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    this.map = device.createTexture({ label: 'spot.shadow', size: [this.size, this.size], format: 'depth32float', usage });
    this.cache = shadows ? device.createTexture({ label: 'spot.shadow.static', size: [this.size, this.size], format: 'depth32float', usage }) : null;
    const mod = device.createShaderModule({ code: CASTER_WGSL, label: 'spot.casters' });
    this.pipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 },
    });
    this.uBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bind = device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uBuf } }] });
  }

  get shadows(): boolean { return this.cache !== null; }

  set(list: readonly Practical[]): void {
    this.list = list.slice(0, MAX_SPOTS);
    this.shadowIndex = this.shadows ? this.list.findIndex((p) => p.shadowed) : -1;
    const s = this.list[this.shadowIndex];
    if (s) {
      const p = s.pos as V3, dir = s.dir;
      const up: V3 = Math.abs(dir[1]!) > 0.99 ? [0, 0, 1] : [0, 1, 0];
      // the cone's full angle, a little wider so the PCF footprint stays inside the map
      const fov = Math.min(170, 2 * s.outerConeDeg + 6) * Math.PI / 180;
      this.vp = mul(perspective(fov, 1, 0.05, s.rangeM), lookAt(p, [p[0] + dir[0]!, p[1] + dir[1]!, p[2] + dir[2]!], up));
    }
    this.cacheKey = '';
  }

  /** Writes the spot table into the look uniform (floats from `base`: 16 per spot) and returns the count. */
  write(u: Float32Array, base: number): number {
    this.list.forEach((p, i) => {
      const o = base + i * 16;
      const w = (p.cyclesWatts ?? 70) * this.wattScale;
      u.set([p.pos[0]!, p.pos[1]!, p.pos[2]!, p.rangeM], o);
      u.set([p.dir[0]!, p.dir[1]!, p.dir[2]!, Math.cos((p.outerConeDeg * Math.PI) / 180)], o + 4);
      u.set([p.color[0]! * w, p.color[1]! * w, p.color[2]! * w, Math.cos((p.innerConeDeg * Math.PI) / 180)], o + 8);
      u.set([i === this.shadowIndex ? 1 : 0, Math.max(p.bulbRadiusM, 0.05), 0, 0], o + 12);
    });
    return this.list.length;
  }

  /**
   * Records the shadowed lamp's map: the static set casters from the cache (re-rendered when `setKey` changes),
   * then `drawParts` adds this frame's parts. No-op without a shadowed lamp. `timestamps` is asked only when the
   * pass is encoded (G5, M5: an unused timer slot read a previous frame's pass).
   */
  render(enc: GPUCommandEncoder, lib: MeshLibrary, casters: readonly SetMesh[], setKey: string, drawParts: (pass: GPURenderPassEncoder, vp: Mat4) => void, timestamps?: () => GPURenderPassTimestampWrites | undefined): void {
    if (this.shadowIndex < 0 || !this.cache) return;
    const key = `${setKey}|${this.vp.join(',')}`;
    if (key !== this.cacheKey && lib.vertexBuffer) {
      this.cacheKey = key;
      const a = new ArrayBuffer(80);
      new Float32Array(a).set(this.vp, 0);
      new Float32Array(a).set([...(casters[0]?.offset ?? [0, 0, 0]), 0], 16);
      this.d.queue.writeBuffer(this.uBuf, 0, a);
      const e2 = this.d.createCommandEncoder({ label: 'spot.static' });
      const p = e2.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.cache.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.pipe);
      p.setBindGroup(0, this.bind);
      p.setVertexBuffer(0, lib.vertexBuffer);
      p.setIndexBuffer(lib.indexBuffer!, 'uint32');
      for (const c of casters) {
        if (c.shadow === false) continue;
        const lod = lib.meshes[c.mesh]?.lods[0];
        if (lod) p.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, 0);
      }
      p.end();
      this.d.queue.submit([e2.finish()]);
    }
    enc.copyTextureToTexture({ texture: this.cache }, { texture: this.map }, [this.size, this.size]);
    const ts = timestamps?.();
    const pass = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: this.map.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
      ...(ts ? { timestampWrites: ts } : {}),
    });
    drawParts(pass, this.vp);
    pass.end();
  }
}
