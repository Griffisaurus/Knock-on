// WebGPU Matter backend (MatterBackend), the GPU twin of src/cpu.ts. It runs on a GPUDevice passed in (D92: the
// renderer's device) and keeps the particle count GPU-resident: every per-particle dispatch is indirect, sized by the
// plan kernels after each emit / sort / compaction, so ticks can be queued back to back without readbacks.
// Lives outside src/ because it needs @webgpu/types, which only the browser app's tsconfig provides.
//
// Default WebGPU limits suffice up to 8M particles (largest binding: acc = 16 B × capacity = 128 MiB at 8M), so the
// renderer's device needs no special limits.

import {
  KIND_COUNT, MAX_QUERIES, MAX_SURFACE_CELLS, type MatterBackend, type MatterConfig, type MatterStepIn, type MatterStepOut, type MatterView,
} from '../src/backend.ts';
import { MAX_INTAKES, MAX_PROXIES, MAX_ZONES, INTAKE_ROUNDS, SUBSTEPS, ITERATIONS, TABLE, ZONE_STRIDE } from '../src/constants.ts';
import { decodeMatr, encodeMatr, finishChecksum } from '../src/payload.ts';
import { SURF_WORDS, nearResult, prepareTick, surfaceResult, type TickPack } from '../src/prep.ts';
import {
  A_ALL, A_CAND, A_COMPACT, A_GOO, A_MARBLE, A_SAND, A_WATER, A_WORDS, MATTER_WGSL, RES_HDR, SCAN_CHUNK, S_N, S_WORDS, WG, type KernelName,
} from '../src/wgsl.ts';

const MAX_BLASTS = 64;
const KERNELS = Object.keys(MATTER_WGSL) as KernelName[];
const ST = GPUBufferUsage.STORAGE;
const IO = ST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
const RES_WORDS = RES_HDR + MAX_INTAKES * KIND_COUNT + MAX_PROXIES * 6 + MAX_QUERIES * 8;
const IBS_ABS = MAX_INTAKES * 4;
const TIN_BLAST = MAX_INTAKES * 8;
const TIN_QUERY = TIN_BLAST + 64 * 8;
const TIN_SURF = TIN_QUERY + MAX_QUERIES * 8;
/** D104 gravity zones in tin: MAX_ZONES records of ZONE_STRIDE words. */
const TIN_ZONE = TIN_SURF + 8;
const TIN_WORDS = TIN_ZONE + MAX_ZONES * ZONE_STRIDE;
/** Params uniform: 20 u32 (wgsl.ts Params). */
const PARAM_BYTES = 80;

if (SUBSTEPS % 2 !== 0) throw new Error('matter/gpu: SUBSTEPS must be even (the A/B ping-pong ends each tick in A)');

type Step = { pipe: GPUComputePipeline; group: GPUBindGroup; x?: number; ind?: number };

async function compile(device: GPUDevice, name: KernelName, code = MATTER_WGSL[name]): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({ label: `matter.${name}`, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(`matter:${name}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  return device.createComputePipelineAsync({ label: `matter.${name}`, layout: 'auto', compute: { module, entryPoint: 'main' } });
}

/** Scan levels for an exclusive scan of `n` u32 in place: [n, ceil(n/1024), …, 1]. */
function scanSizes(n: number): number[] {
  const s = [n];
  while (s[s.length - 1]! > 1) s.push(Math.ceil(s[s.length - 1]! / SCAN_CHUNK));
  return s;
}

export class MatterGpu implements MatterBackend {
  readonly kind = 'gpu' as const;
  readonly device: GPUDevice;
  capacity = 0;
  seed = 0;
  /** Matter tick of the newest submitted step, and the live count after the newest completed one. */
  tick = 0;
  count = 0;
  private pipes = new Map<KernelName, GPUComputePipeline>();
  private bufs: GPUBuffer[] = [];
  private b!: Record<string, GPUBuffer>;
  private pos: GPUBuffer[] = [];
  private vel: GPUBuffer[] = [];
  private mat: GPUBuffer[] = [];
  private pred: GPUBuffer[] = [];
  private params: GPUBuffer[] = [];
  private tableScan: Step[] = [];
  private blockScan: Step[] = [];
  private pdataWords = 0;
  private emitWords = 0;
  private groupsDyn: { apply: GPUBindGroup[][]; emit: GPUBindGroup } | null = null;
  /** predict bind groups per parity and substep (the substep's Params carries its gravity). */
  private predictGroups: GPUBindGroup[][] = [];
  private fixed!: Record<string, GPUBindGroup>;
  private parity!: Record<string, GPUBindGroup[]>;
  private staging: GPUBuffer[] = [];
  private surfStaging: GPUBuffer[] = [];
  private destroyed = false;
  /** Encoded passes per tick, for diagnostics. */
  dispatchesPerTick = 0;
  /**
   * Profiling (needs the 'timestamp-query' feature): every dispatch gets its own timed pass, and `profile` accumulates
   * GPU nanoseconds per kernel name. Slower than normal runs (one pass per dispatch); results are identical.
   */
  profiling = false;
  profile = new Map<string, number>();
  /** Resolves when the newest tick's timestamps are folded into `profile` (await it before the next profiled step). */
  profileDone: Promise<void> = Promise.resolve();
  private qset: GPUQuerySet | null = null;
  private qbuf: GPUBuffer | null = null;
  private qread: GPUBuffer | null = null;

  /** `wgsl` overrides kernel sources (timing experiments only: results then differ from the CPU reference). */
  constructor(device: GPUDevice, private readonly opts: { wgsl?: Partial<Record<KernelName, string>> } = {}) { this.device = device; }

  async init(cfg: MatterConfig): Promise<void> {
    const cap = cfg.capacity | 0;
    if (cap < 1 || cap > 65535 * WG) throw new Error(`matter: capacity ${cfg.capacity} out of range for the GPU backend`);
    this.release();
    this.destroyed = false;
    this.capacity = cap;
    this.seed = cfg.seed >>> 0;
    this.tick = 0;
    this.count = 0;
    if (this.pipes.size === 0) {
      const compiled = await Promise.all(KERNELS.map((k) => compile(this.device, k, this.opts.wgsl?.[k] ?? MATTER_WGSL[k])));
      KERNELS.forEach((k, i) => this.pipes.set(k, compiled[i]!));
    }
    const d = this.device;
    const buf = (label: string, bytes: number, usage = IO): GPUBuffer => {
      const g = d.createBuffer({ label: `matter.${label}`, size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
      this.bufs.push(g);
      return g;
    };
    for (const ab of ['A', 'B']) {
      this.pos.push(buf(`pos${ab}`, cap * 12));
      this.vel.push(buf(`vel${ab}`, cap * 12));
      this.mat.push(buf(`mat${ab}`, cap * 4));
      this.pred.push(buf(`pred${ab}`, cap * 16));
    }
    const tsz = scanSizes(TABLE + 1);
    const bsz = scanSizes(Math.ceil(cap / WG));
    this.b = {
      kt: buf('kt', cap * 16), tmpIdx: buf('tmpIdx', cap * 4), p0: buf('p0', cap * 16),
      acc: buf('acc', cap * 16), dens: buf('dens', cap * 8), fdisp: buf('fdisp', cap * 12),
      flags: buf('flags', cap * 4), cand: buf('cand', cap * 4),
      st: buf('state', S_WORDS * 4), args: buf('args', A_WORDS * 4, IO | GPUBufferUsage.INDIRECT),
      tin: buf('tin', TIN_WORDS * 4), qacc: buf('qacc', MAX_QUERIES * 32), ibs: buf('ibs', (IBS_ABS + MAX_INTAKES * KIND_COUNT) * 4),
      imp: buf('imp', MAX_PROXIES * 48), res: buf('res', RES_WORDS * 4), surf: buf('surface', MAX_SURFACE_CELLS * SURF_WORDS * 4),
    };
    const tl = tsz.map((s, i) => buf(`tscan${i}`, s * 4));
    const bl = bsz.map((s, i) => buf(`bscan${i}`, s * 4));
    this.b.cellStart = tl[0]!;
    this.b.blockSums = bl[0]!;
    for (let s = 0; s < SUBSTEPS; s++) this.params.push(buf(`params${s}`, PARAM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    this.tableScan = this.scanPlan(tsz, tl);
    this.blockScan = this.scanPlan(bsz, bl);
    this.pdataWords = 0;
    this.emitWords = 0;
    this.ensureDynamic(1 << 16, 1 << 12);
    this.buildGroups();
    d.queue.writeBuffer(this.b.st!, 0, new Uint32Array(S_WORDS));
    d.queue.writeBuffer(this.b.args!, 0, this.argsFor(0));
  }

  private argsFor(n: number): Uint32Array {
    const a = new Uint32Array(A_WORDS);
    for (let k = 0; k < A_WORDS; k += 3) { a[k + 1] = 1; a[k + 2] = 1; }
    a[A_ALL] = Math.ceil(n / WG);
    return a;
  }

  private scanPlan(sizes: number[], levels: GPUBuffer[]): Step[] {
    const d = this.device;
    const uni = (n: number): GPUBuffer => {
      const g = d.createBuffer({ label: 'matter.scanParams', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.bufs.push(g);
      d.queue.writeBuffer(g, 0, new Uint32Array([n, 0, 0, 0]));
      return g;
    };
    const steps: Step[] = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      steps.push({ pipe: this.pipe('scan'), group: this.group('scan', [uni(sizes[l]!), levels[l]!, levels[l + 1]!]), x: sizes[l + 1]! });
    }
    for (let l = sizes.length - 3; l >= 0; l--) {
      steps.push({ pipe: this.pipe('scanAdd'), group: this.group('scanAdd', [uni(sizes[l]!), levels[l]!, levels[l + 1]!]), x: Math.ceil(sizes[l]! / WG) });
    }
    return steps;
  }

  private pipe(k: KernelName): GPUComputePipeline { return this.pipes.get(k)!; }

  private group(k: KernelName, entries: readonly GPUBuffer[]): GPUBindGroup {
    return this.device.createBindGroup({
      label: `matter.${k}`,
      layout: this.pipe(k).getBindGroupLayout(0),
      entries: entries.map((b, i) => ({ binding: i, resource: { buffer: b } })),
    });
  }

  /** (Re)allocates the per-tick proxy and emit buffers when a tick needs more room; rebuilds their bind groups. */
  private ensureDynamic(pdWords: number, emWords: number): void {
    if (pdWords <= this.pdataWords && emWords <= this.emitWords && this.groupsDyn) return;
    const d = this.device;
    if (pdWords > this.pdataWords) {
      this.b.pdata?.destroy();
      this.pdataWords = Math.max(pdWords, this.pdataWords * 2);
      this.b.pdata = d.createBuffer({ label: 'matter.pdata', size: this.pdataWords * 4, usage: ST | GPUBufferUsage.COPY_DST });
    }
    if (emWords > this.emitWords) {
      this.b.emit?.destroy();
      this.emitWords = Math.max(emWords, this.emitWords * 2);
      this.b.emit = d.createBuffer({ label: 'matter.emit', size: this.emitWords * 4, usage: ST | GPUBufferUsage.COPY_DST });
    }
    const b = this.b;
    const apply: GPUBindGroup[][] = [[], []];
    for (let par = 0; par < 2; par++) {
      const dst = 1 - par;
      for (let s = 0; s < SUBSTEPS; s++) {
        apply[par]!.push(this.group('apply', [this.params[s]!, b.st!, this.pred[dst]!, b.p0!, b.acc!, b.fdisp!, b.pdata!, b.imp!]));
      }
    }
    this.groupsDyn = { apply, emit: this.group('emit', [this.params[0]!, b.st!, b.emit!, this.pos[0]!, this.vel[0]!, this.mat[0]!]) };
  }

  private buildGroups(): void {
    const b = this.b, P0 = this.params[0]!;
    const [pA, pB] = this.pos as [GPUBuffer, GPUBuffer];
    const [vA, vB] = this.vel as [GPUBuffer, GPUBuffer];
    const [mA, mB] = this.mat as [GPUBuffer, GPUBuffer];
    this.fixed = {
      scatter: this.group('scatter', [b.st!, b.kt!, b.cellStart!, b.tmpIdx!]),
      rank: this.group('rank', [b.st!, b.kt!, b.cellStart!, b.tmpIdx!]),
      ranges: this.group('ranges', [b.st!, b.cellStart!, b.args!]),
      blast: this.group('blast', [P0, b.st!, pA, vA, b.tin!]),
      emitCommit: this.group('emitCommit', [P0, b.st!, b.args!]),
      mark: this.group('mark', [P0, b.st!, pA, mA, b.tin!, b.flags!, b.cand!]),
      candPlan: this.group('candPlan', [b.st!, b.args!]),
      bsInit: this.group('bsInit', [P0, b.ibs!]),
      bsCount: this.group('bsCount', [b.st!, b.ibs!, b.flags!, b.cand!]),
      bsUpdate: this.group('bsUpdate', [P0, b.ibs!, b.tin!]),
      absorb: this.group('absorb', [P0, b.st!, b.ibs!, b.flags!, b.cand!, mA]),
      compactPlan: this.group('compactPlan', [b.st!, b.args!]),
      blockCount: this.group('blockCount', [b.st!, b.flags!, b.blockSums!]),
      compactDest: this.group('compactDest', [b.st!, b.flags!, b.blockSums!, b.kt!]),
      compactMove: this.group('compactMove', [b.st!, b.kt!, pA, vA, mA, pB, vB, mB]),
      compactBack: this.group('compactBack', [b.st!, pB, vB, mB, pA, vA, mA]),
      compactCommit: this.group('compactCommit', [b.st!, b.args!]),
      reduce: this.group('reduce', [P0, b.st!, pA, vA, mA, b.tin!, b.qacc!]),
      finalize: this.group('finalize', [P0, b.st!, b.ibs!, b.imp!, b.res!, b.qacc!]),
      surface: this.group('surface', [P0, b.st!, pA, vA, mA, b.tin!, b.surf!]),
    };
    const par = (f: (src: number, dst: number) => GPUBindGroup): GPUBindGroup[] => [f(0, 1), f(1, 0)];
    this.predictGroups = [0, 1].map((s) => this.params.map((pu) => this.group('predict', [pu, b.st!, this.pos[s]!, this.vel[s]!, this.mat[s]!, this.pred[s]!, b.kt!, b.cellStart!, b.tin!])));
    this.parity = {
      permute1: par((s, t) => this.group('permute1', [b.st!, b.kt!, this.pos[s]!, this.vel[s]!, this.mat[s]!, this.pos[t]!, this.vel[t]!, this.mat[t]!])),
      permute2: par((s, t) => this.group('permute2', [b.st!, b.kt!, this.pred[s]!, this.pred[t]!, this.pos[s]!, b.p0!])),
      sand: par((_s, t) => this.group('sand', [b.st!, this.pred[t]!, b.p0!, b.cellStart!, b.acc!])),
      marble: par((_s, t) => this.group('marble', [b.st!, this.pred[t]!, b.p0!, b.cellStart!, b.acc!])),
      goo: par((_s, t) => this.group('goo', [b.st!, this.pred[t]!, b.p0!, b.cellStart!, b.acc!])),
      waterDensity: par((_s, t) => this.group('waterDensity', [b.st!, this.pred[t]!, b.cellStart!, b.dens!])),
      waterSolve: par((_s, t) => this.group('waterSolve', [b.st!, this.pred[t]!, b.p0!, b.cellStart!, b.acc!, b.dens!, b.fdisp!])),
      finish: par((_s, t) => this.group('finish', [b.st!, this.pos[t]!, this.vel[t]!, this.pred[t]!])),
    };
  }

  step(input: MatterStepIn): Promise<MatterStepOut> {
    if (!this.capacity || this.destroyed) return Promise.reject(new Error('matter: step before init'));
    const pk = prepareTick(input);
    return this.stepPacked(pk);
  }

  /** Step with an already prepared tick (the harness reuses one TickPack per tick across backends). */
  stepPacked(pk: TickPack): Promise<MatterStepOut> {
    const d = this.device, q = d.queue, b = this.b;
    if (pk.nBlasts > MAX_BLASTS) throw new Error(`matter: ${pk.nBlasts} blasts (max ${MAX_BLASTS})`);
    const plistOff = pk.proxies.length;
    this.ensureDynamic(plistOff + pk.plist.length, pk.nEmit * 7);
    const pd = new Int32Array(plistOff + pk.plist.length);
    pd.set(pk.proxies);
    pd.set(pk.plist, plistOff);
    q.writeBuffer(b.pdata!, 0, pd);
    if (pk.nEmit) q.writeBuffer(b.emit!, 0, pk.emit);
    if (pk.nZones > MAX_ZONES) throw new Error(`matter: ${pk.nZones} gravity zones (max ${MAX_ZONES})`);
    const tin = new Int32Array(pk.nZones ? TIN_ZONE + pk.nZones * ZONE_STRIDE : pk.surface ? TIN_SURF + 8 : TIN_QUERY + pk.nQueries * 8);
    tin.set(pk.intakes);
    tin.set(pk.blasts, TIN_BLAST);
    tin.set(pk.queries, TIN_QUERY);
    if (pk.surface) tin.set(pk.surface, TIN_SURF);
    if (pk.nZones) tin.set(pk.zones, TIN_ZONE);
    q.writeBuffer(b.tin!, 0, tin);
    const resImp = RES_HDR + pk.nIntakes * KIND_COUNT;
    const resNear = resImp + pk.dynIds.length * 6;
    for (let s = 0; s < SUBSTEPS; s++) {
      q.writeBuffer(this.params[s]!, 0, new Uint32Array([
        s, pk.nProxies, plistOff, pk.nIntakes, pk.nBlasts, pk.nEmit, this.capacity, pk.dynIds.length,
        TIN_BLAST, IBS_ABS, resImp, pk.nQueries,
        TIN_QUERY, resNear, TIN_SURF, 0,
        pk.nZones, TIN_ZONE, pk.grav[s]! >>> 0, 0,
      ]));
    }

    const enc = d.createCommandEncoder({ label: `matter.tick${pk.tick}` });
    const args = b.args!;
    let count = 0;
    const prof = this.profiling && this.device.features.has('timestamp-query');
    const labels: string[] = [];
    if (prof && !this.qset) {
      this.qset = d.createQuerySet({ label: 'matter.profile', type: 'timestamp', count: 4096 });
      this.qbuf = d.createBuffer({ label: 'matter.profile', size: 4096 * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.qread = d.createBuffer({ label: 'matter.profile', size: 4096 * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
    const run = (pass: GPUComputePassEncoder, st: Step): void => {
      let p = pass;
      if (prof) {
        const i = labels.length * 2;
        labels.push(st.pipe.label.replace('matter.', ''));
        p = enc.beginComputePass({ timestampWrites: { querySet: this.qset!, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 } });
      }
      p.setPipeline(st.pipe);
      p.setBindGroup(0, st.group);
      if (st.ind !== undefined) p.dispatchWorkgroupsIndirect(args, st.ind * 4);
      else p.dispatchWorkgroups(Math.max(1, st.x ?? 1));
      if (prof) p.end();
      count++;
    };
    const begin = (): GPUComputePassEncoder => (prof ? (null as unknown as GPUComputePassEncoder) : enc.beginComputePass());
    const end = (p: GPUComputePassEncoder): void => { if (!prof) p.end(); };
    const F = this.fixed, Pp = this.parity, P = (k: KernelName): GPUComputePipeline => this.pipe(k);
    enc.clearBuffer(b.imp!, 0, Math.max(16, pk.dynIds.length * 48));
    if (pk.nQueries) enc.clearBuffer(b.qacc!);
    const surfBytes = pk.surface ? pk.surface[3]! * pk.surface[4]! * SURF_WORDS * 4 : 0;
    if (surfBytes) enc.clearBuffer(b.surf!, 0, surfBytes);
    let pass = begin();
    if (pk.nBlasts) run(pass, { pipe: P('blast'), group: F.blast!, ind: A_ALL });
    if (pk.nEmit) run(pass, { pipe: P('emit'), group: this.groupsDyn!.emit, x: Math.ceil(pk.nEmit / WG) });
    run(pass, { pipe: P('emitCommit'), group: F.emitCommit!, x: 1 });
    end(pass);
    for (let s = 0; s < SUBSTEPS; s++) {
      const par = s & 1;
      enc.clearBuffer(b.cellStart!);
      pass = begin();
      run(pass, { pipe: P('predict'), group: this.predictGroups[par]![s]!, ind: A_ALL });
      for (const st of this.tableScan) run(pass, st);
      run(pass, { pipe: P('scatter'), group: F.scatter!, ind: A_ALL });
      run(pass, { pipe: P('rank'), group: F.rank!, ind: A_ALL });
      run(pass, { pipe: P('permute1'), group: Pp.permute1![par]!, ind: A_ALL });
      run(pass, { pipe: P('permute2'), group: Pp.permute2![par]!, ind: A_ALL });
      run(pass, { pipe: P('ranges'), group: F.ranges!, x: 1 });
      for (let it = 0; it < ITERATIONS; it++) {
        run(pass, { pipe: P('sand'), group: Pp.sand![par]!, ind: A_SAND });
        run(pass, { pipe: P('waterDensity'), group: Pp.waterDensity![par]!, ind: A_WATER });
        run(pass, { pipe: P('waterSolve'), group: Pp.waterSolve![par]!, ind: A_WATER });
        run(pass, { pipe: P('marble'), group: Pp.marble![par]!, ind: A_MARBLE });
        run(pass, { pipe: P('goo'), group: Pp.goo![par]!, ind: A_GOO });
        run(pass, { pipe: P('apply'), group: this.groupsDyn!.apply[par]![s]!, ind: A_ALL });
      }
      run(pass, { pipe: P('finish'), group: Pp.finish![par]!, ind: A_ALL });
      end(pass);
    }
    pass = begin();
    run(pass, { pipe: P('mark'), group: F.mark!, ind: A_ALL });
    if (pk.nIntakes) {
      const xi = Math.ceil(pk.nIntakes / WG);
      run(pass, { pipe: P('candPlan'), group: F.candPlan!, x: 1 });
      run(pass, { pipe: P('bsInit'), group: F.bsInit!, x: xi });
      for (let r = 0; r < INTAKE_ROUNDS; r++) {
        run(pass, { pipe: P('bsCount'), group: F.bsCount!, ind: A_CAND });
        run(pass, { pipe: P('bsUpdate'), group: F.bsUpdate!, x: xi });
      }
      run(pass, { pipe: P('absorb'), group: F.absorb!, ind: A_CAND });
    }
    run(pass, { pipe: P('compactPlan'), group: F.compactPlan!, x: 1 });
    run(pass, { pipe: P('blockCount'), group: F.blockCount!, ind: A_COMPACT });
    for (const st of this.blockScan) run(pass, st);
    run(pass, { pipe: P('compactDest'), group: F.compactDest!, ind: A_COMPACT });
    run(pass, { pipe: P('compactMove'), group: F.compactMove!, ind: A_COMPACT });
    run(pass, { pipe: P('compactBack'), group: F.compactBack!, ind: A_COMPACT });
    run(pass, { pipe: P('compactCommit'), group: F.compactCommit!, x: 1 });
    run(pass, { pipe: P('reduce'), group: F.reduce!, ind: A_ALL });
    if (surfBytes) run(pass, { pipe: P('surface'), group: F.surface!, ind: A_ALL });
    run(pass, { pipe: P('finalize'), group: F.finalize!, x: Math.ceil(Math.max(1, pk.nIntakes * KIND_COUNT, pk.dynIds.length * 6, pk.nQueries * 8) / WG) });
    end(pass);
    if (prof) enc.resolveQuerySet(this.qset!, 0, labels.length * 2, this.qbuf!, 0);
    const words = resNear + pk.nQueries * 8;
    const staging = this.staging.pop() ?? d.createBuffer({ label: 'matter.staging', size: RES_WORDS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(b.res!, 0, staging, 0, words * 4);
    const sst = surfBytes ? this.surfStaging.pop() ?? d.createBuffer({ label: 'matter.surfaceStaging', size: MAX_SURFACE_CELLS * SURF_WORDS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
    if (sst) enc.copyBufferToBuffer(b.surf!, 0, sst, 0, surfBytes);
    if (prof) enc.copyBufferToBuffer(this.qbuf!, 0, this.qread!, 0, labels.length * 16);
    q.submit([enc.finish()]);
    this.dispatchesPerTick = count;
    if (prof) {
      const qr = this.qread!;
      this.profileDone = qr.mapAsync(GPUMapMode.READ, 0, labels.length * 16).then(() => {
        const t = new BigInt64Array(qr.getMappedRange(0, labels.length * 16).slice(0));
        qr.unmap();
        labels.forEach((l, i) => this.profile.set(l, (this.profile.get(l) ?? 0) + Number(t[i * 2 + 1]! - t[i * 2]!)));
      });
    }
    this.tick = pk.tick;
    const surfRaw = sst ? sst.mapAsync(GPUMapMode.READ, 0, surfBytes).then(() => {
      const r = new Uint32Array(sst.getMappedRange(0, surfBytes).slice(0));
      sst.unmap();
      if (!this.destroyed) this.surfStaging.push(sst); else sst.destroy();
      return r;
    }) : Promise.resolve(null);
    return Promise.all([staging.mapAsync(GPUMapMode.READ, 0, words * 4), surfRaw]).then(([, sr]) => {
      const r = new Uint32Array(staging.getMappedRange(0, words * 4).slice(0));
      staging.unmap();
      if (!this.destroyed) this.staging.push(staging); else staging.destroy();
      const n = r[0]!;
      this.count = n;
      const ri = new Int32Array(r.buffer);
      return {
        tick: pk.tick,
        impulses: pk.dynIds.map((id, s) => ({ id, lin: ri.slice(resImp + s * 6, resImp + s * 6 + 3), ang: ri.slice(resImp + s * 6 + 3, resImp + s * 6 + 6) })),
        absorbed: pk.intakeIds.map((id, t) => ({ id, counts: ri.slice(RES_HDR + t * KIND_COUNT, RES_HDR + t * KIND_COUNT + KIND_COUNT) })),
        counts: ri.slice(3, 3 + KIND_COUNT),
        checksum: finishChecksum(r[1]!, r[2]!, n),
        bounds: ri.slice(3 + KIND_COUNT, 3 + KIND_COUNT + 6),
        ...(pk.queryIds ? { near: pk.queryIds.map((id, k) => nearResult(id, r[resNear + k * 8]!, Array.from(r.subarray(resNear + k * 8 + 1, resNear + k * 8 + 7)))) } : {}),
        ...(pk.surface && sr ? { surface: surfaceResult(pk.surface, sr) } : {}),
      };
    });
  }

  /**
   * The MATR payload of the state after every step issued before this call; steps issued after it (even before the
   * promise resolves) don't affect it: the copies are enqueued synchronously, here. Byte-identical to MatterCpu's.
   */
  snapshot(): Promise<Uint8Array> {
    const d = this.device, cap = this.capacity;
    const tick = this.tick, capacity = this.capacity, seed = this.seed;
    const mk = (bytes: number): GPUBuffer => d.createBuffer({ label: 'matter.snapshot', size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const sSt = mk(16), sPos = mk(cap * 12), sVel = mk(cap * 12), sMat = mk(cap * 4);
    const enc = d.createCommandEncoder({ label: 'matter.snapshot' });
    enc.copyBufferToBuffer(this.b.st!, 0, sSt, 0, 16);
    enc.copyBufferToBuffer(this.pos[0]!, 0, sPos, 0, cap * 12);
    enc.copyBufferToBuffer(this.vel[0]!, 0, sVel, 0, cap * 12);
    enc.copyBufferToBuffer(this.mat[0]!, 0, sMat, 0, cap * 4);
    d.queue.submit([enc.finish()]);
    const read = async (g: GPUBuffer, bytes: number): Promise<ArrayBuffer> => {
      if (bytes === 0) { g.destroy(); return new ArrayBuffer(0); }
      await g.mapAsync(GPUMapMode.READ, 0, Math.ceil(bytes / 4) * 4);
      const out = g.getMappedRange(0, Math.ceil(bytes / 4) * 4).slice(0, bytes);
      g.destroy();
      return out;
    };
    return (async () => {
      const n = new Uint32Array(await read(sSt, 16))[S_N]!;
      const [pos, vel, mat] = await Promise.all([read(sPos, n * 12), read(sVel, n * 12), read(sMat, n * 4)]);
      return encodeMatr({ tick, count: n, capacity, seed, pos: new Int32Array(pos), vel: new Int32Array(vel), mat: new Uint32Array(mat) });
    })();
  }

  async restore(bytes: Uint8Array): Promise<void> {
    const s = decodeMatr(bytes);
    if (!this.capacity) await this.init({ capacity: s.capacity, seed: s.seed });
    if (s.count > this.capacity) throw new Error(`matter: snapshot has ${s.count} particles, capacity ${this.capacity}`);
    const q = this.device.queue;
    if (s.count) {
      q.writeBuffer(this.pos[0]!, 0, s.pos);
      q.writeBuffer(this.vel[0]!, 0, s.vel);
      q.writeBuffer(this.mat[0]!, 0, s.mat);
    }
    const st = new Uint32Array(S_WORDS);
    st[S_N] = s.count;
    q.writeBuffer(this.b.st!, 0, st);
    q.writeBuffer(this.b.args!, 0, this.argsFor(s.count));
    this.tick = s.tick;
    this.seed = s.seed;
    this.count = s.count;
  }

  view(): MatterView {
    return { device: this.device, pos: this.pos[0]!, vel: this.vel[0]!, mat: this.mat[0]!, count: this.count, tick: this.tick, state: this.b.st! };
  }

  private release(): void {
    for (const g of this.bufs) g.destroy();
    for (const g of this.staging) g.destroy();
    for (const g of this.surfStaging) g.destroy();
    this.b?.pdata?.destroy();
    this.b?.emit?.destroy();
    this.qset?.destroy(); this.qbuf?.destroy(); this.qread?.destroy();
    this.qset = null; this.qbuf = null; this.qread = null;
    this.bufs = []; this.staging = []; this.surfStaging = []; this.pos = []; this.vel = []; this.mat = []; this.pred = []; this.params = [];
    this.groupsDyn = null;
    this.predictGroups = [];
  }

  /**
   * Frees every GPU resource. Device loss / renderer restore: make a new MatterGpu on the new device, init() and
   * restore() it from the MATR CPU copy; an instance is never moved between devices.
   */
  destroy(): void {
    this.destroyed = true;
    this.release();
    this.capacity = 0;
  }
}
