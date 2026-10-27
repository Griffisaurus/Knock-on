// Electric arcs (vfx §4.1 `fx/arc_bolt`, M4 VFX, stream R4): ARC TOWER strikes, motor overloads, MAINS shorts.
// Each bolt is a main polyline plus 2–5 branches by tier, made by midpoint displacement and re-randomised at
// 30 Hz, drawn as camera-facing additive ribbons: a plasma-white core (#F4F8FF) inside a Beam glow (#2FD6FF).
// One point light per bolt at its midpoint (fx.ts); under Reduce flashing the light is smoothed to ≤ 3 Hz at ±15 %
// while the geometry keeps flickering. Crackle sprites and arc sparks at the contacts come from the particles.
// Deviation from RENDERING §8 ("a compute pass generates the polylines"): ≤ 32 bolts × ≤ 256 segments are built on
// the CPU (a few µs) and uploaded; the draw is one instanced-free triangle list.

import type { V3 } from '../../math.ts';
import { FRAME_WGSL } from '../shaders.ts';

const WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
struct VIn { @location(0) pos: vec3f, @location(1) side: vec3f, @location(2) k: vec2f };
struct VOut { @builtin(position) clip: vec4f, @location(0) k: vec2f };
@vertex fn vs(i: VIn) -> VOut {
  // camera-relative, widened across the view direction (the side vector is the segment direction)
  let rel = i.pos - frame.eye.xyz;
  var w = normalize(cross(i.side, normalize(rel)));
  if (any(w != w)) { w = vec3f(0.0, 1.0, 0.0); }
  var o: VOut;
  o.clip = frame.viewProj * vec4f(rel + w * i.k.x, 1.0);
  o.k = vec2f(sign(i.k.x), i.k.y);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let x = abs(i.k.x);
  let core = smoothstep(0.22, 0.0, x);
  let glow = pow(1.0 - x, 2.0);
  let c = vec3f(0.95, 0.97, 1.0) * core * 6.0 + vec3f(0.03, 0.58, 1.0) * glow * 3.2;
  return vec4f(c * i.k.y, 0.0);
}
`;

interface Bolt { a: V3; b: V3; until: number; seed: number; strength: number; pts: V3[][]; next: number }

export class Arcs {
  /** Segments per main bolt and branch count, by tier (vfx §4.1: 64 / 128 / 192 / 256, branches 2 / 3 / 4 / 5). */
  segments = 128;
  branches = 3;
  maxBolts = 8;
  private readonly d: GPUDevice;
  private readonly pipe: GPURenderPipeline;
  private readonly bind: GPUBindGroup;
  private vbuf: GPUBuffer | null = null;
  private vcap = 0;
  private verts = 0;
  private bolts: Bolt[] = [];
  private t = 0;

  constructor(device: GPUDevice, frameBuf: GPUBuffer, format: GPUTextureFormat, msaa: number) {
    this.d = device;
    const mod = device.createShaderModule({ label: 'arcs', code: WGSL });
    const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    this.pipe = device.createRenderPipeline({
      label: 'arcs', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module: mod, entryPoint: 'vs',
        buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }],
      },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: msaa },
    });
    this.bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  }

  get active(): boolean { return this.bolts.length > 0; }

  /** Live bolts this frame: midpoint (for the light) and strength. */
  lights(): { pos: V3; strength: number }[] {
    return this.bolts.map((b) => ({ pos: [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2, (b.a[2] + b.b[2]) / 2] as V3, strength: b.strength }));
  }

  /** Whether a bolt between these ends is live (a continuous discharge). */
  has(a: V3, b: V3): boolean { return this.find(a, b) !== undefined; }

  private find(a: V3, b: V3): Bolt | undefined {
    return this.bolts.find((x) => Math.hypot(x.a[0] - a[0], x.a[1] - a[1], x.a[2] - a[2]) < 0.01 && Math.hypot(x.b[0] - b[0], x.b[1] - b[1], x.b[2] - b[2]) < 0.05);
  }

  /** A strike from a to b lasting `dur` seconds (a continuous discharge re-calls it every frame with the same ends). */
  strike(a: V3, b: V3, dur: number, strength = 1): void {
    const now = this.t;
    const same = this.find(a, b);
    if (same) { same.until = Math.max(same.until, now + dur); same.b = b; same.strength = strength; return; }
    if (this.bolts.length >= this.maxBolts) this.bolts.shift();
    this.bolts.push({ a, b, until: now + dur, seed: (Math.random() * 1e9) | 0, strength, pts: [], next: 0 });
  }

  clear(): void { this.bolts = []; this.verts = 0; }

  /** Advances time (dt already scaled by the Spectacle time scale) and rebuilds the ribbons at 30 Hz. */
  update(dt: number, eye: V3): void {
    this.t += dt;
    this.bolts = this.bolts.filter((b) => b.until > this.t);
    if (!this.bolts.length) { this.verts = 0; return; }
    const out: number[] = [];
    for (const b of this.bolts) {
      if (this.t >= b.next) {
        b.next = this.t + 1 / 30;
        b.seed = (b.seed * 1664525 + 1013904223) >>> 0;
        b.pts = this.build(b);
      }
      const dist = Math.hypot((b.a[0] + b.b[0]) / 2 - eye[0], (b.a[1] + b.b[1]) / 2 - eye[1], (b.a[2] + b.b[2]) / 2 - eye[2]);
      // ribbon half-width: ~4 mm glow up close, never thinner than ~1.5 px-ish at distance
      const w = Math.max(0.006, dist * 0.003) * (0.7 + 0.3 * b.strength);
      const fade = Math.min(1, (b.until - this.t) / 0.08);
      b.pts.forEach((line, li) => {
        const lw = li === 0 ? w : w * 0.55;
        const k = (li === 0 ? 1 : 0.6) * fade * b.strength;
        for (let i = 0; i + 1 < line.length; i++) {
          const p = line[i]!, q = line[i + 1]!;
          const s = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
          const v = (x: V3, side: number): number[] => [x[0], x[1], x[2], s[0]!, s[1]!, s[2]!, side * lw, k];
          out.push(...v(p, -1), ...v(p, 1), ...v(q, 1), ...v(p, -1), ...v(q, 1), ...v(q, -1));
        }
      });
    }
    const data = new Float32Array(out);
    if (!this.vbuf || data.byteLength > this.vcap) {
      this.vbuf?.destroy();
      this.vcap = Math.max(1 << 16, data.byteLength * 2);
      this.vbuf = this.d.createBuffer({ label: 'arcs.v', size: this.vcap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    this.d.queue.writeBuffer(this.vbuf, 0, data);
    this.verts = data.length / 8;
  }

  /** Main bolt + branches by midpoint displacement (5 levels on the main bolt, fewer on branches). */
  private build(b: Bolt): V3[][] {
    let s = b.seed;
    const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    const len = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]);
    const levels = Math.max(3, Math.min(8, Math.round(Math.log2(this.segments))));
    const subdivide = (a: V3, c: V3, lv: number, amp: number): V3[] => {
      let pts: V3[] = [a, c];
      for (let l = 0; l < lv; l++) {
        const next: V3[] = [pts[0]!];
        for (let i = 0; i + 1 < pts.length; i++) {
          const p = pts[i]!, q = pts[i + 1]!;
          const m: V3 = [(p[0] + q[0]) / 2 + rnd() * amp, (p[1] + q[1]) / 2 + rnd() * amp, (p[2] + q[2]) / 2 + rnd() * amp];
          next.push(m, q);
        }
        pts = next;
        amp *= 0.55;
      }
      return pts;
    };
    const main = subdivide(b.a, b.b, levels, len * 0.22);
    const lines: V3[][] = [main];
    for (let k = 0; k < this.branches; k++) {
      const i = Math.floor((0.2 + 0.6 * (rnd() + 0.5)) * (main.length - 1));
      const p = main[i]!;
      const bl = len * (0.15 + 0.25 * (rnd() + 0.5));
      const dir: V3 = [b.b[0] - b.a[0] + rnd() * len * 1.4, b.b[1] - b.a[1] + rnd() * len * 1.4, b.b[2] - b.a[2] + rnd() * len * 1.4];
      const dl = Math.hypot(...dir) || 1;
      lines.push(subdivide(p, [p[0] + (dir[0] / dl) * bl, p[1] + (dir[1] / dl) * bl, p[2] + (dir[2] / dl) * bl], Math.max(2, levels - 2), bl * 0.3));
    }
    return lines;
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.verts || !this.vbuf) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.vbuf);
    pass.draw(this.verts);
  }
}
