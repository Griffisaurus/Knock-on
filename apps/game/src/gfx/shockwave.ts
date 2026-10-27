// Shock rings and shockwaves (GAME_SPEC §13 "Shockwaves", RENDERING §8 "Shock ring"): per blast, an
// expanding ground ring decal (hot leading edge, a dust-darkened band behind it), a screen-space
// refraction shell (the TAA / present pass in taa.ts bends the image along it) and dust kicked up from the
// floor as the front passes (particles, plus a volumetric dust torus for big blasts). Hitstop, camera shake
// and the exposure flash are driven from fx.ts / main.ts. Cosmetic only.

import { FRAME_WGSL } from './shaders.ts';
import { Kind, type Particles } from './particles.ts';
import type { Volumes } from './volume.ts';

type V3 = readonly [number, number, number];

interface Wave { pos: V3; t: number; dur: number; ring: number; shell: number; strength: number; ground: number; emitted: number; seed: number; torus: boolean }

/** One screen-space refraction shell for the present pass: centre (uv), radius and width (fraction of the
 * screen height), strength. */
export interface Shell { readonly cx: number; readonly cy: number; readonly r: number; readonly w: number; readonly s: number }

const MAX_WAVES = 32;
export const MAX_SHELLS = 8;

const RING_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct W { pos: vec4f, p: vec4f }; // pos.xyz centre on the ground, w = radius now; p: x age 0..1, y strength, z band width
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> waves: array<W>;
struct VO { @builtin(position) clip: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) id: u32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var c = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(-1., -1.), vec2f(1., 1.), vec2f(-1., 1.));
  let w = waves[ii];
  let r = w.pos.w * 1.15 + w.p.z;
  let q = c[vi];
  let world = vec3f(w.pos.x + q.x * r, w.pos.y + 0.005, w.pos.z + q.y * r);
  var o: VO;
  o.clip = frame.viewProj * vec4f(world - frame.eye.xyz, 1.0);
  o.q = q * r;
  o.id = ii;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let w = waves[i.id];
  let d = length(i.q);
  let R = w.pos.w;
  let band = w.p.z;
  let x = (d - R) / band;          // 0 at the front, negative behind it
  let age = w.p.x;
  // hot leading edge (additive), fading with age
  let edge = exp(-x * x * 9.0) * (1.0 - smoothstep(0.35, 1.0, age)) * w.p.y;
  // dust band behind the front (darkens the floor a little: coverage)
  let dust = smoothstep(0.4, -0.5, x) * smoothstep(-3.0, -0.6, x) * (1.0 - smoothstep(0.25, 1.0, age)) * 0.35 * min(w.p.y, 1.0);
  let hot = mix(vec3f(1.0, 0.62, 0.22), vec3f(1.0, 0.94, 0.82), exp(-x * x * 30.0));
  let dustCol = frame.ground.rgb * 0.55 * frame.keyColor.rgb;
  return vec4f(hot * edge * 3.0 + dustCol * dust, dust);
}
`;

export class Shockwaves {
  private readonly device: GPUDevice;
  private readonly waves: Wave[] = [];
  private readonly buf: GPUBuffer;
  private readonly pipe: GPURenderPipeline;
  private readonly bind: GPUBindGroup;
  private readonly data = new Float32Array(MAX_WAVES * 8);
  floorY = 0;
  /** Refraction shells on; their strength scale (vfx §2.5: reduced motion caps refraction at 30 %). */
  shellsOn = true;
  shellScale = 1;
  private drawCount = 0;

  constructor(device: GPUDevice, frameBuf: GPUBuffer, colorFormat: GPUTextureFormat, msaa: number) {
    this.device = device;
    this.buf = device.createBuffer({ label: 'shock.waves', size: MAX_WAVES * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const mod = device.createShaderModule({ code: RING_WGSL, label: 'shock.ring' });
    this.pipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod, entryPoint: 'fs',
        targets: [{ format: colorFormat, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: msaa },
    });
    this.bind = device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: this.buf } }],
    });
  }

  /** A blast of yield Y at P. `torus`: big blasts also raise a volumetric dust torus. */
  spawn(p: V3, yieldY: number, torus = false): void {
    const s = Math.cbrt(Math.max(yieldY, 0.1));
    const big = yieldY >= 3;
    const ring = (big ? 2.6 : yieldY >= 1.5 ? 1.85 : 1.5) * Math.max(1, s * 0.8);
    const height = p[1] - this.floorY;
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({
      pos: p, t: 0, dur: big ? 0.9 : 0.6, ring, shell: ring * 1.4, strength: Math.min(2, 0.6 + 0.35 * s),
      ground: height < ring ? 1 - height / ring : 0, emitted: 0, seed: Math.random() * 6.28, torus,
    });
  }

  /** Advances the waves (dt already scaled by the playback warp), kicking up dust as the front passes. */
  frame(dt: number, particles: Particles, volumes: Volumes | null): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]!;
      w.t += dt;
      if (w.t > w.dur + 0.4) { this.waves.splice(i, 1); continue; }
      if (w.ground <= 0) continue;
      const r = this.radius(w);
      // dust: bursts spaced around the front, about one per 0.25 m of new circumference
      const target = Math.floor((r / w.ring) * 28 * w.ground * Math.min(1.5, w.strength));
      const g: V3 = [w.pos[0], this.floorY + 0.02, w.pos[2]];
      while (w.emitted < target) {
        const a = w.seed + w.emitted * 2.39996;
        const rr = r * (0.85 + 0.15 * Math.sin(a * 3.1));
        const at: V3 = [g[0] + Math.cos(a) * rr, g[1], g[2] + Math.sin(a) * rr];
        particles.emit({ pos: at, count: 6, kind: Kind.dust, dir: [Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6], spread: 0.25, speed: [0.4, 1.4 * w.strength], life: [0.9, 2.0], size: [0.07, 0.18], color: [0.62, 0.6, 0.56, 1], gravity: 0.05, drag: 2.2, jitter: 0.12 });
        w.emitted++;
      }
      if (w.torus && volumes && w.t - dt <= 0.12 && w.t > 0.12) {
        // a ring of dust sources on the floor: the front lifts a torus of dust
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          volumes.inject('dust', { pos: [w.pos[0] + Math.cos(a) * w.ring * 0.7, this.floorY + 0.15, w.pos[2] + Math.sin(a) * w.ring * 0.7], radius: w.ring * 0.35, density: 2.2, expand: 2.5, vel: [Math.cos(a) * 2, 1.2, Math.sin(a) * 2], burst: true }, w.ring * 2.6, 5, { cells: 128, lift: 0.08 });
        }
      }
    }
  }

  private radius(w: Wave): number {
    const u = Math.min(1, w.t / (w.dur * 0.7));
    return w.ring * (1 - (1 - u) ** 3);
  }

  /** Uploads this frame's ring decals; call before the late pass. */
  prepare(): void {
    let n = 0;
    for (const w of this.waves) {
      if (w.ground <= 0 || n >= MAX_WAVES) continue;
      this.data.set([w.pos[0], this.floorY, w.pos[2], this.radius(w), Math.min(1, w.t / w.dur), w.strength * w.ground, 0.12 + w.ring * 0.06, 0], n * 8);
      n++;
    }
    this.drawCount = n;
    if (n) this.device.queue.writeBuffer(this.buf, 0, this.data, 0, n * 8);
  }

  drawLate(pass: GPURenderPassEncoder): void {
    if (!this.drawCount) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    pass.draw(6, this.drawCount);
  }

  /** Screen-space refraction shells this frame (viewProj = absolute, aspect = width / height). */
  shells(viewProj: Float32Array, eye: V3, camRight: V3, camUp: V3): Shell[] {
    if (!this.shellsOn) return [];
    const out: Shell[] = [];
    const proj = (p: readonly number[]): [number, number, number] | null => {
      const m = viewProj;
      const x = m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!;
      const y = m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!;
      const w = m[3]! * p[0]! + m[7]! * p[1]! + m[11]! * p[2]! + m[15]!;
      if (w <= 0.05) return null;
      return [x / w * 0.5 + 0.5, 0.5 - y / w * 0.5, w];
    };
    for (const w of this.waves) {
      const u = w.t / (w.dur * 0.6);
      if (u >= 1) continue;
      const R = w.shell * (1 - (1 - u) ** 2.2);
      const c = proj(w.pos);
      if (!c) continue;
      const e = proj([w.pos[0] + camUp[0] * R, w.pos[1] + camUp[1] * R, w.pos[2] + camUp[2] * R]);
      if (!e) continue;
      const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      if (r < 0.004 || r > 3) continue;
      const dist = Math.hypot(eye[0] - w.pos[0], eye[1] - w.pos[1], eye[2] - w.pos[2]);
      out.push({ cx: c[0], cy: c[1], r, w: Math.max(0.01, r * 0.18), s: w.strength * (1 - u) * 0.035 * this.shellScale * Math.min(1, 6 / Math.max(dist, 1)) });
      void camRight;
    }
    return out.sort((a, b) => b.s - a.s).slice(0, MAX_SHELLS);
  }

  get active(): boolean { return this.waves.length > 0; }

  clear(): void { this.waves.length = 0; this.drawCount = 0; }
}
