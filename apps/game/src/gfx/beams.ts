// Light beams (vfx §4.2 "Laser beam and dust motes", GAME_SPEC §13 "volumetric laser beams with dust"):
// LANCE rays, its cutting beam through a BURNING GLASS, TRIPWIRE, MIRROR / SPLITTER bounces and TORCH rays,
// from Machine.lightBeams() (A3: [x0, y0, z0, x1, y1, z1, intensity, kind] per segment; kind 0 TORCH ray,
// 1 LANCE ray, 2 LANCE cutting beam). Purely visual.
//
// Each segment is a camera-facing ribbon drawn additively in the late pass: a white core (1.5 mm, never
// thinner than ~1.2 px so it reads at any distance) inside a soft Light-channel glow (#FFF1A8, Ø 12 mm), and
// a faint wide shaft for the "volumetric" read. The cutting beam glows Heat (#FF5B2E) and throws sparks and
// smoke wisps at its hit point. Dust motes are spawned in a capsule around each beam (GPU particles) and
// glint as they drift through it. A TORCH ray draws only its faint shaft and motes ("Torch cones: motes only").

import { FRAME_WGSL } from './shaders.ts';
import { Kind, type Particles } from './particles.ts';

const MAX_SEG = 256;

const BEAM_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct Seg { a: vec4f, b: vec4f, col: vec4f }; // a.w = core width (m), b.w = glow width (m), col.rgb glow colour, col.a intensity
struct BU { pxWorld: f32, time: f32, _a: f32, _b: f32 };   // pxWorld: metres per pixel at 1 m distance
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> segs: array<Seg>;
@group(0) @binding(2) var<uniform> bu: BU;
struct VO { @builtin(position) clip: vec4f, @location(0) x: f32, @location(1) @interpolate(flat) id: u32, @location(2) @interpolate(flat) w: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var cs = array<vec2f, 6>(vec2f(0., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(0., -1.), vec2f(1., 1.), vec2f(0., 1.));
  let c = cs[vi];
  let s = segs[ii];
  let a = s.a.xyz - frame.eye.xyz;
  let b = s.b.xyz - frame.eye.xyz;
  let p = mix(a, b, c.x);
  let axis = normalize(b - a + vec3f(1e-6));
  var side = cross(axis, normalize(p));
  side = select(vec3f(0.0, 1.0, 0.0), normalize(side), length(side) > 1e-5);
  // the shaft is 6× the glow; nothing thinner than ~1.2 px at this distance
  let px = bu.pxWorld * max(length(p), 0.05);
  let shaft = max(s.b.w * 6.0, px * 6.0);
  let core = max(s.a.w, px * 1.2);
  let glow = max(s.b.w, px * 3.0);
  var o: VO;
  o.clip = frame.viewProj * vec4f(p + side * c.y * shaft * 0.5, 1.0);
  o.x = c.y;
  o.id = ii;
  o.w = vec2f(core / shaft, glow / shaft);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let s = segs[i.id];
  let d = abs(i.x);
  let core = 1.0 - smoothstep(i.w.x * 0.5, i.w.x, d);
  let g = exp(-pow(d / max(i.w.y, 1e-4), 2.0) * 2.2);
  let shaft = exp(-d * d * 4.0) * 0.06;
  let flick = 0.92 + 0.08 * sin(bu.time * 37.0 + f32(i.id) * 1.7);
  let k = s.col.a;
  let c = vec3f(1.0, 0.98, 0.94) * core * 6.0 * k + s.col.rgb * (g * 2.2 + shaft) * k * flick;
  return vec4f(c, 0.0);
}
`;

const lin = (h: string): [number, number, number] => [1, 3, 5].map((i) => ((parseInt(h.slice(i, i + 2), 16) / 255) ** 2.2)) as [number, number, number];
const LIGHT = lin('#FFF1A8');
const HEAT = lin('#FF5B2E');

export class Beams {
  private readonly device: GPUDevice;
  private readonly buf: GPUBuffer;
  private readonly ubuf: GPUBuffer;
  private readonly pipe: GPURenderPipeline;
  private readonly bind: GPUBindGroup;
  private readonly data = new Float32Array(MAX_SEG * 12);
  private count = 0;
  private motesAcc = 0;
  /** Motes per beam (vfx §4.2: 100 / 250 / 500 / 1,000 by tier; 2,000 on 32 GB). */
  motesPerBeam = 500;
  stats = { segments: 0 };

  constructor(device: GPUDevice, frameBuf: GPUBuffer, colorFormat: GPUTextureFormat, msaa: number) {
    this.device = device;
    this.buf = device.createBuffer({ label: 'beams', size: MAX_SEG * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const mod = device.createShaderModule({ code: BEAM_WGSL, label: 'beams' });
    this.pipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: colorFormat, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: msaa },
    });
    this.bind = device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: this.buf } }, { binding: 2, resource: { buffer: this.ubuf } }],
    });
  }

  /**
   * This frame's beams (run.beams; empty in Build). `dt` is the Spectacle (playback-scaled) step for the motes
   * and the cutting sparks; `pxWorld` = metres per pixel at 1 m (2 tan(fov/2) / render height).
   */
  set(beams: Float32Array, dt: number, time: number, pxWorld: number, particles: Particles): void {
    const n = Math.min(MAX_SEG, Math.floor(beams.length / 8));
    const d = this.data;
    let k = 0;
    this.motesAcc += dt;
    const emitMotes = this.motesAcc > 0.05;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const a: [number, number, number] = [beams[o]!, beams[o + 1]!, beams[o + 2]!];
      const b: [number, number, number] = [beams[o + 3]!, beams[o + 4]!, beams[o + 5]!];
      const I = Math.max(0.05, Math.min(1.5, beams[o + 6]!)), kind = beams[o + 7]! | 0;
      const cut = kind === 2, torch = kind === 0;
      const col = cut ? HEAT : LIGHT;
      // LANCE: core 1.5 mm, glow Ø 12 mm; TRIPWIRE-strength rays (weak) read thinner; TORCH: shaft and motes only
      const core = torch ? 0 : cut ? 0.002 : 0.0015 * Math.min(1, I + 0.3);
      const glow = torch ? 0.02 : cut ? 0.016 : 0.012;
      d.set([a[0], a[1], a[2], core, b[0], b[1], b[2], glow, col[0], col[1], col[2], torch ? 0.25 * I : I], k * 12);
      k++;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (emitMotes && len > 0.02) {
        // dust motes drifting in a capsule around the beam, recycled every 4–8 s
        const per = Math.max(1, Math.round((this.motesPerBeam / 6) * this.motesAcc * Math.min(3, len)));
        for (let m = 0; m < Math.min(per, 12); m++) {
          const u = Math.random();
          const p: [number, number, number] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
          particles.emit({ pos: p, count: Math.max(1, Math.round(per / 12)), kind: Kind.ember, dir: [0, 1, 0], spread: 1, speed: [0.005, 0.03], life: [4, 8], size: [0.002, 0.004], color: [col[0], col[1], col[2], 1.6 * Math.min(1, I)], gravity: -0.002, drag: 0.5, jitter: torch ? 0.04 : 0.012 });
        }
      }
      if (cut && dt > 0) {
        // the hot spot: sparks and a smoke wisp at the hit point
        const n2 = Math.round(200 * dt);
        if (n2 > 0) particles.emit({ pos: b, count: n2, kind: Kind.spark, dir: [0, 1, 0], spread: 0.8, speed: [0.5, 2.0], life: [0.1, 0.3], size: [0.003, 0.006], color: [1, 0.78, 0.44, 9], color2: [1, 0.36, 0.18, 6], gravity: 0.8, drag: 0.6 });
        if (Math.random() < dt * 5) particles.emit({ pos: b, count: 1, kind: Kind.smoke, dir: [0, 1, 0], spread: 0.2, speed: [0.1, 0.3], life: [1, 1.8], size: [0.02, 0.05], color: [0.105, 0.122, 0.162, 1], gravity: 0, drag: 1 });
      }
    }
    if (emitMotes) this.motesAcc = 0;
    this.count = k;
    this.stats.segments = k;
    if (k) {
      this.device.queue.writeBuffer(this.buf, 0, d, 0, k * 12);
      this.device.queue.writeBuffer(this.ubuf, 0, new Float32Array([pxWorld, time % 1000, 0, 0]));
    }
  }

  drawLate(pass: GPURenderPassEncoder): void {
    if (!this.count) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    pass.draw(6, this.count);
  }

  clear(): void { this.count = 0; }
}
