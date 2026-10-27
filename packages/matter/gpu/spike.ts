// M0 spike WebGPU host (legacy, see src/spike/index.ts). Lives outside src/ because it needs @webgpu/types, which only
// the browser app's tsconfig provides; src/ stays Node-runnable (CPU reference, WGSL, constants).

import { CELL_COUNT, JACOBI_ITERATIONS, RADIX_PASSES, SUBSTEPS } from '../src/spike/constants.ts';
import type { MatterState } from '../src/spike/init.ts';
import { MATTER_WGSL, SCAN_CHUNK, WG, type KernelName } from '../src/spike/wgsl.ts';

const STORAGE = GPUBufferUsage.STORAGE;
const KERNELS: readonly KernelName[] = [
  'predict', 'radixHist', 'radixScatter', 'scan', 'scanAdd', 'cellRange', 'contacts', 'apply', 'finish', 'checksum', 'bumpSlot',
];

interface Dispatch {
  readonly pipeline: GPUComputePipeline;
  readonly group: GPUBindGroup;
  readonly x: number;
}

/** Device limits the 1M+ grain buffers need; pass to requestDevice({ requiredLimits }). */
export function matterLimits(adapter: GPUAdapter): Record<string, number> {
  return {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
  };
}

async function compile(device: GPUDevice, name: KernelName): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({ label: `matter:${name}`, code: MATTER_WGSL[name] });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(`matter:${name}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  return device.createComputePipelineAsync({ label: `matter:${name}`, layout: 'auto', compute: { module, entryPoint: 'main' } });
}

export class MatterGpu {
  readonly device: GPUDevice;
  readonly n: number;
  readonly maxSamples: number;
  tick = 0;
  samplesTaken = 0;
  private readonly buffers: GPUBuffer[] = [];
  private readonly pos: GPUBuffer;
  private readonly vel: GPUBuffer;
  private readonly cellEnd: GPUBuffer;
  private readonly samples: GPUBuffer;
  private readonly slot: GPUBuffer;
  private readonly tickPlan: Dispatch[] = [];
  private readonly samplePlan: Dispatch[] = [];

  private constructor(device: GPUDevice, n: number, maxSamples: number, pipes: ReadonlyMap<KernelName, GPUComputePipeline>) {
    this.device = device;
    this.n = n;
    this.maxSamples = maxSamples;
    const pipe = (k: KernelName): GPUComputePipeline => pipes.get(k)!;
    const buf = (label: string, size: number, usage: number): GPUBuffer => {
      const b = device.createBuffer({ label: `matter:${label}`, size: Math.max(16, Math.ceil(size / 4) * 4), usage });
      this.buffers.push(b);
      return b;
    };
    const uni = (nn: number, shift: number, blocks: number): GPUBuffer => {
      const b = buf('params', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(b, 0, new Uint32Array([nn, shift, blocks, 0]));
      return b;
    };
    const group = (k: KernelName, entries: readonly GPUBuffer[], first = 0): GPUBindGroup => device.createBindGroup({
      layout: pipe(k).getBindGroupLayout(0),
      entries: entries.map((b, i) => ({ binding: i + first, resource: { buffer: b } })),
    });
    const io = STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

    const blocks = Math.ceil(n / WG);
    const groups = (count: number): number => Math.ceil(count / WG);
    this.pos = buf('pos', n * 12, io);
    this.vel = buf('vel', n * 12, io);
    const pred = buf('pred', n * 12, io);
    const keysA = buf('keysA', n * 4, io);
    const idxA = buf('idxA', n * 4, io);
    const keysB = buf('keysB', n * 4, io);
    const idxB = buf('idxB', n * 4, io);
    this.cellEnd = buf('cellEnd', CELL_COUNT * 4, io);
    const cellStart = buf('cellStart', CELL_COUNT * 4, io);
    const acc = buf('acc', n * 16, io);
    this.samples = buf('samples', maxSamples * 16, io);
    this.slot = buf('slot', 4, io);

    // Scan levels: hist (256 × blocks) → chunk totals → … → a single grand total.
    const sizes = [256 * blocks];
    while (sizes[sizes.length - 1]! > 1) sizes.push(Math.ceil(sizes[sizes.length - 1]! / SCAN_CHUNK));
    const levels = sizes.map((s, i) => (i === 0 ? buf('hist', s * 4, io) : buf(`scan${i}`, s * 4, io)));

    const pN = uni(n, 0, blocks);
    const plan = this.tickPlan;
    plan.push({ pipeline: pipe('predict'), group: group('predict', [pN, this.pos, this.vel, pred, keysA, idxA]), x: groups(n) });
    for (let pass = 0; pass < RADIX_PASSES; pass++) {
      const pP = uni(n, pass * 8, blocks);
      const [kIn, iIn, kOut, iOut] = pass % 2 === 0 ? [keysA, idxA, keysB, idxB] : [keysB, idxB, keysA, idxA];
      plan.push({ pipeline: pipe('radixHist'), group: group('radixHist', [pP, kIn, levels[0]!]), x: blocks });
      for (let l = 0; l + 1 < sizes.length; l++) {
        plan.push({ pipeline: pipe('scan'), group: group('scan', [uni(sizes[l]!, 0, 0), levels[l]!, levels[l + 1]!]), x: sizes[l + 1]! });
      }
      for (let l = sizes.length - 3; l >= 0; l--) {
        plan.push({ pipeline: pipe('scanAdd'), group: group('scanAdd', [uni(sizes[l]!, 0, 0), levels[l]!, levels[l + 1]!]), x: groups(sizes[l]!) });
      }
      plan.push({ pipeline: pipe('radixScatter'), group: group('radixScatter', [pP, kIn, iIn, levels[0]!, kOut, iOut]), x: blocks });
    }
    const [keysS, idxS] = RADIX_PASSES % 2 === 1 ? [keysB, idxB] : [keysA, idxA];
    plan.push({ pipeline: pipe('cellRange'), group: group('cellRange', [pN, keysS, cellStart, this.cellEnd]), x: groups(n) });
    const contactsG = group('contacts', [pN, keysS, idxS, cellStart, this.cellEnd, pred, acc]);
    const applyG = group('apply', [pN, this.pos, pred, acc]);
    for (let it = 0; it < JACOBI_ITERATIONS; it++) {
      plan.push({ pipeline: pipe('contacts'), group: contactsG, x: groups(n) });
      plan.push({ pipeline: pipe('apply'), group: applyG, x: groups(n) });
    }
    plan.push({ pipeline: pipe('finish'), group: group('finish', [pN, this.pos, this.vel, pred]), x: groups(n * 3) });
    this.samplePlan.push({ pipeline: pipe('checksum'), group: group('checksum', [pN, this.pos, this.vel, this.samples, this.slot]), x: groups(n) });
    this.samplePlan.push({ pipeline: pipe('bumpSlot'), group: group('bumpSlot', [this.slot], 1), x: 1 });
  }

  static async create(device: GPUDevice, init: MatterState, maxSamples = 1024): Promise<MatterGpu> {
    const pipes = new Map<KernelName, GPUComputePipeline>();
    const compiled = await Promise.all(KERNELS.map((k) => compile(device, k)));
    KERNELS.forEach((k, i) => pipes.set(k, compiled[i]!));
    const m = new MatterGpu(device, init.n, maxSamples, pipes);
    m.reset(init);
    return m;
  }

  /** Upload a state and clear the checksum log. Accumulators re-zero themselves every pass. */
  reset(st: MatterState): void {
    if (st.n !== this.n) throw new Error(`matter: state has ${st.n} grains, buffers hold ${this.n}`);
    const q = this.device.queue;
    q.writeBuffer(this.pos, 0, st.pos);
    q.writeBuffer(this.vel, 0, st.vel);
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.samples);
    enc.clearBuffer(this.slot);
    q.submit([enc.finish()]);
    this.tick = 0;
    this.samplesTaken = 0;
  }

  /**
   * Encode and submit `ticks` matter ticks (SUBSTEPS substeps each), `perSubmit` ticks per command buffer. A checksum is logged after
   * every tick that is a multiple of `sampleEvery` (0 = never). Await device.queue.onSubmittedWorkDone()
   * to know they finished.
   */
  step(ticks: number, sampleEvery = 0, perSubmit = 25): void {
    let left = ticks;
    while (left > 0) {
      const batch = Math.min(left, perSubmit);
      const enc = this.device.createCommandEncoder({ label: 'matter:ticks' });
      for (let t = 0; t < batch; t++) {
        this.tick++;
        const sample = sampleEvery > 0 && this.tick % sampleEvery === 0;
        if (sample && this.samplesTaken >= this.maxSamples) throw new Error('matter: checksum log full');
        for (let s = 0; s < SUBSTEPS; s++) {
          enc.clearBuffer(this.cellEnd); // empty cells read end = 0, so cellStart never needs clearing
          const pass = enc.beginComputePass();
          for (const d of this.tickPlan) {
            pass.setPipeline(d.pipeline);
            pass.setBindGroup(0, d.group);
            pass.dispatchWorkgroups(d.x);
          }
          if (sample && s === SUBSTEPS - 1) {
            for (const d of this.samplePlan) {
              pass.setPipeline(d.pipeline);
              pass.setBindGroup(0, d.group);
              pass.dispatchWorkgroups(d.x);
            }
            this.samplesTaken++;
          }
          pass.end();
        }
      }
      this.device.queue.submit([enc.finish()]);
      left -= batch;
    }
  }

  private async read(src: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
    const staging = this.device.createBuffer({ size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, staging, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ, 0, bytes);
    const out = staging.getMappedRange(0, bytes).slice(0);
    staging.destroy();
    return out;
  }

  /** Checksum log: 4 u32 per sample (Σx, Σy, Σz, Σ grainHash), in sample order. */
  async readSamples(): Promise<Uint32Array> {
    if (this.samplesTaken === 0) return new Uint32Array(0);
    return new Uint32Array(await this.read(this.samples, this.samplesTaken * 16));
  }

  async readState(): Promise<MatterState> {
    const pos = new Int32Array(await this.read(this.pos, this.n * 12));
    const vel = new Int32Array(await this.read(this.vel, this.n * 12));
    return { n: this.n, pos, vel };
  }

  destroy(): void {
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
  }
}
