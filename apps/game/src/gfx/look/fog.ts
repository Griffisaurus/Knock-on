// Froxel fog with sun light shafts (RENDERING §3 pass 18, §9, environments.md §3.4): a camera-aligned
// froxel grid (screen tiles × exponential depth slices) is lit by the shadowed sun (the renderer's near
// shadow map × the static set shadow, so the windows throw shafts) plus a dim ambient term, then
// integrated front to back into (in-scatter, transmittance). Post applies it per pixel at the scene depth
// (post.ts). Tiers without shafts get an analytic uniform haze in post instead (no volume at all).

import { FRAME_WGSL } from '../shaders.ts';

export const FOG_NEAR = 0.1;
export const FOG_FAR = 80;

const FOG_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct FogU {
  setShadowMat: mat4x4f, // camera-relative → set shadow clip
  dims: vec4u,           // froxels x, y, z, set shadow on
  fog: vec4f,            // x density (1/m), y height falloff (1/m), z base height (world y), w anisotropy g
  amb: vec4f,            // ambient in-scatter colour (rgb), w sun scale
  range: vec4f,          // x near, y far, z jitter, w unused
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> u: FogU;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var setShadow: texture_depth_2d;
@group(0) @binding(4) var cmp: sampler_comparison;
@group(0) @binding(5) var lightTex: texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var lightRead: texture_3d<f32>;
@group(0) @binding(7) var outTex: texture_storage_3d<rgba16float, write>;

fn sliceZ(s: f32) -> f32 { return u.range.x * pow(u.range.y / u.range.x, s / f32(u.dims.z)); }

fn vis(map: texture_depth_2d, m: mat4x4f, rel: vec3f) -> f32 {
  let p = m * vec4f(rel, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || p.z > 1.0 || p.z < 0.0) { return 1.0; }
  return textureSampleCompareLevel(map, cmp, uv, p.z - 0.001);
}

@compute @workgroup_size(4, 4, 4)
fn inject(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid >= u.dims.xyz)) { return; }
  let j = fract(52.9829189 * fract(dot(vec2f(gid.xy) + f32(gid.z) * 7.0, vec2f(0.06711056, 0.00583715))));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(u.dims.xy);
  let z = sliceZ(f32(gid.z) + mix(0.5, j, u.range.z));
  // view ray through the froxel centre, at view depth z
  let t = frame.cluster.x;
  let vv = vec3f((uv.x * 2.0 - 1.0) * t * frame.cluster.y * z, (1.0 - uv.y * 2.0) * t * z, -z);
  // camera-relative world: inverse of the (orthonormal) view rotation
  let rel = vec3f(dot(vv, frame.view[0].xyz), dot(vv, frame.view[1].xyz), dot(vv, frame.view[2].xyz));
  let wy = rel.y + frame.eye.y;
  let dens = u.fog.x * exp(-max(wy - u.fog.z, 0.0) * u.fog.y);
  var v = vis(shadowMap, frame.shadowMat, rel);
  if (u.dims.w != 0u) { v *= vis(setShadow, u.setShadowMat, rel); }
  let viewDir = normalize(rel);
  let g = u.fog.w;
  let cosT = dot(viewDir, frame.key.xyz);
  let hg = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
  let sun = frame.keyColor.rgb * frame.key.w * u.amb.w * hg * 4.0 * 3.14159;
  let L = (sun * v + u.amb.rgb) * dens;
  textureStore(lightTex, gid, vec4f(L, dens));
}

@compute @workgroup_size(8, 8, 1)
fn integrate(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= u.dims.xy)) { return; }
  var T = 1.0;
  var S = vec3f(0.0);
  var z0 = 0.0;
  for (var s = 0u; s < u.dims.z; s++) {
    let z1 = sliceZ(f32(s) + 1.0);
    let c = textureLoad(lightRead, vec3u(gid.xy, s), 0);
    let dz = z1 - z0;
    let sig = max(c.a, 1e-7);
    let tr = exp(-sig * dz);
    S += T * c.rgb / sig * (1.0 - tr);
    T *= tr;
    textureStore(outTex, vec3u(gid.xy, s), vec4f(S, T));
    z0 = z1;
  }
}
`;

export interface FogParams {
  /** Extinction (1/m), height falloff (1/m) above `base` (world y), HG anisotropy. */
  readonly density: number; readonly falloff: number; readonly base: number; readonly g: number;
  /** Ambient in-scatter colour and the sun's scale in the fog. */
  readonly ambient: readonly [number, number, number]; readonly sunScale: number;
  /** Uniform haze (tiers without shafts): extinction and colour. */
  readonly haze: number; readonly hazeColor: readonly [number, number, number];
}

export class FogPass {
  private readonly d: GPUDevice;
  private readonly pipe: { inject: GPUComputePipeline; integrate: GPUComputePipeline };
  private readonly u: GPUBuffer;
  private light!: GPUTexture;
  volume!: GPUTexture;
  dims: [number, number, number] = [0, 0, 0];
  private bind: { inject: GPUBindGroup; integrate: GPUBindGroup } | null = null;
  private bindKey = '';
  version = 0;

  constructor(device: GPUDevice) {
    this.d = device;
    const mod = device.createShaderModule({ code: FOG_WGSL, label: 'look.fog' });
    // 'auto' layouts: the inject and integrate passes see only the bindings they use (the light volume is
    // written by one and read by the other, which can't share a bind group)
    this.pipe = {
      inject: device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'inject' } }),
      integrate: device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'integrate' } }),
    };
    this.u = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.resize(1, 1, 1);
  }

  resize(x: number, y: number, z: number): void {
    if (x === this.dims[0] && y === this.dims[1] && z === this.dims[2]) return;
    this.dims = [x, y, z];
    this.light?.destroy();
    this.volume?.destroy();
    const mk = (label: string): GPUTexture => this.d.createTexture({ label, size: [x, y, z], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    this.light = mk('fog.light');
    this.volume = mk('fog.volume');
    this.bind = null;
    this.version++;
  }

  run(enc: GPUCommandEncoder, frameBuf: GPUBuffer, shadowMap: GPUTexture, setShadow: GPUTexture, cmp: GPUSampler, setShadowMat: Float32Array, setOn: boolean, p: FogParams, ts?: GPUComputePassTimestampWrites): void {
    const key = `${shadowMap.label}|${setShadow.label}|${this.version}`;
    if (!this.bind || key !== this.bindKey) {
      this.bindKey = key;
      this.bind = {
        inject: this.d.createBindGroup({
          layout: this.pipe.inject.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: this.u } },
            { binding: 2, resource: shadowMap.createView() }, { binding: 3, resource: setShadow.createView() },
            { binding: 4, resource: cmp }, { binding: 5, resource: this.light.createView() },
          ],
        }),
        integrate: this.d.createBindGroup({
          layout: this.pipe.integrate.getBindGroupLayout(0),
          entries: [{ binding: 1, resource: { buffer: this.u } }, { binding: 6, resource: this.light.createView() }, { binding: 7, resource: this.volume.createView() }],
        }),
      };
    }
    const b = new ArrayBuffer(128);
    const f = new Float32Array(b), u = new Uint32Array(b);
    f.set(setShadowMat, 0);
    u.set([this.dims[0], this.dims[1], this.dims[2], setOn ? 1 : 0], 16);
    f.set([p.density, p.falloff, p.base, p.g], 20);
    f.set([...p.ambient, p.sunScale], 24);
    f.set([FOG_NEAR, FOG_FAR, 0, 0], 28); // no slice jitter without TAA (it would read as noise)
    this.d.queue.writeBuffer(this.u, 0, b);
    const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
    pass.setPipeline(this.pipe.inject);
    pass.setBindGroup(0, this.bind.inject);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 4), Math.ceil(this.dims[1] / 4), Math.ceil(this.dims[2] / 4));
    pass.setPipeline(this.pipe.integrate);
    pass.setBindGroup(0, this.bind.integrate);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 8), Math.ceil(this.dims[1] / 8), 1);
    pass.end();
  }
}
