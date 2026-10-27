// G5 (M5): GPU pass timing (gfx/gpu.ts). A timer slot that no pass wrote this frame must not count (it holds an
// earlier frame's stamps: the `look.spot` over-count with Matter on), names that stop running must drop out of
// total(), and the frame span is what the governors read.
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g['GPUBufferUsage'] ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
  g['GPUMapMode'] ??= { READ: 1, WRITE: 2 };
});

const { attributeFrame, PassTimes, GpuTimer, STALE_FRAMES } = await import('../src/gfx/gpu.ts');

const MS = 1_000_000n; // ns per ms

describe('attributeFrame', () => {
  it('drops pairs not newer than the region floor (a slot no pass wrote this frame)', () => {
    // frame stamps from 1000 ms; slot 1 still holds a 6 ms pass from an earlier frame (≤ the floor)
    const t = [1000n * MS, 1001n * MS, 400n * MS, 406n * MS, 1001n * MS, 1003n * MS].map(BigInt);
    const f = attributeFrame(['cull', 'look.spot', 'main'], t, 900n * MS);
    expect([...f.passes.keys()]).toEqual(['cull', 'main']);
    expect(f.passes.get('main')).toBeCloseTo(2, 9);
    expect(f.spanMs).toBeCloseTo(3, 9);
    expect(f.maxT).toBe(1003n * MS);
  });

  it('drops never-written (zero) slots, reversed pairs and pairs of 1 s or more, and sums repeated names', () => {
    const t = [10n * MS, 11n * MS, 0n, 0n, 12n * MS, 11n * MS, 12n * MS, 2000n * MS, 13n * MS, 14n * MS];
    const f = attributeFrame(['a', 'b', 'c', 'd', 'a'], t, 0n);
    expect([...f.passes.keys()]).toEqual(['a']);
    expect(f.passes.get('a')).toBeCloseTo(2, 9);
    expect(f.maxT).toBe(2000n * MS); // the floor covers every value in the region, valid or not
  });

  it('reports an empty frame when nothing is newer than the floor', () => {
    const f = attributeFrame(['a'], [5n, 6n], 10n);
    expect(f.passes.size).toBe(0);
    expect(f.spanMs).toBe(0);
    expect(f.maxT).toBe(10n);
  });
});

describe('PassTimes', () => {
  const frame = (passes: Record<string, number>, spanMs = Object.values(passes).reduce((a, b) => a + b, 0)) =>
    ({ passes: new Map(Object.entries(passes)), spanMs, maxT: 0n });

  it('total() sums only the last frame\'s passes; names unseen for STALE_FRAMES frames expire', () => {
    const p = new PassTimes();
    p.add(frame({ main: 10, 'look.spot': 6 }));
    expect(p.total()).toBeCloseTo(16, 9);
    p.add(frame({ main: 10 }));
    expect(p.total()).toBeCloseTo(10, 9); // look.spot stopped running: out of total() at once
    expect(p.ms.has('look.spot')).toBe(true); // still listed for a while (the HUD)
    for (let i = 0; i < STALE_FRAMES; i++) p.add(frame({ main: 10 }));
    expect(p.ms.has('look.spot')).toBe(false);
    expect([...p.ms.keys()]).toEqual(['main']);
    expect(p.live).toEqual(['main']);
  });

  it('smooths per pass and the frame span', () => {
    const p = new PassTimes();
    p.add(frame({ main: 10 }, 12));
    p.add(frame({ main: 20 }, 22));
    expect(p.ms.get('main')).toBeCloseTo(11, 9);
    expect(p.frameMs).toBeCloseTo(13, 9);
  });

  it('ignores frames with nothing attributable', () => {
    const p = new PassTimes();
    p.add(frame({ main: 10 }));
    p.add({ passes: new Map(), spanMs: 0, maxT: 0n });
    expect(p.live).toEqual(['main']);
    expect(p.frameMs).toBeCloseTo(10, 9);
  });
});

/** A device whose query set keeps every slot's last value, like D3D12's query heap (unwritten slots stay stale). */
function fakeGpu() {
  const heap = new BigUint64Array(4096);
  let clock = 1_000n * MS;
  const buffers: { data: ArrayBuffer }[] = [];
  const device = {
    createQuerySet: () => ({ heap }),
    createBuffer: ({ size }: { size: number }) => {
      const b = { data: new ArrayBuffer(size), mapAsync: () => Promise.resolve(), getMappedRange: (o = 0, s?: number) => b.data.slice(o, s === undefined ? undefined : o + s), unmap: () => {} };
      buffers.push(b);
      return b;
    },
  };
  const enc = {
    resolveQuerySet: (_qs: unknown, first: number, count: number, dst: { data: ArrayBuffer }, off: number) => {
      new BigUint64Array(dst.data, off, count).set(heap.subarray(first, first + count));
    },
    copyBufferToBuffer: (src: { data: ArrayBuffer }, so: number, dst: { data: ArrayBuffer }, d0: number, size: number) => {
      new Uint8Array(dst.data, d0, size).set(new Uint8Array(src.data, so, size));
    },
  };
  /** A pass that runs: writes its begin / end stamps (`ms` long) into the heap. */
  const run = (ts: { beginningOfPassWriteIndex: number; endOfPassWriteIndex: number } | undefined, ms: number): void => {
    if (!ts) return;
    heap[ts.beginningOfPassWriteIndex] = clock;
    clock += BigInt(Math.round(ms * 1e6));
    heap[ts.endOfPassWriteIndex] = clock;
    clock += 10_000n; // 10 µs between passes
  };
  const gpu = { device, features: new Set(['timestamp-query']), adapter: {}, description: 'fake' };
  return { gpu: gpu as never, enc: enc as never, run, advance: (ms: number) => { clock += BigInt(ms) * MS; } };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('GpuTimer', () => {
  it('a requested but unused slot does not read the previous frame\'s pass (the look.spot over-count)', async () => {
    const f = fakeGpu();
    const timer = new GpuTimer(f.gpu, 8);
    // frame 1 (Matter off): cull, look.spot (runs: a shadowed lamp), main
    timer.begin();
    f.run(timer.compute('cull'), 0.1);
    f.run(timer.render('look.spot'), 1);
    f.run(timer.render('main'), 12);
    timer.resolve(f.enc);
    await flush();
    f.advance(5);
    // frame 2 (Matter on): matter.prep shifts the slots; look.spot asks for writes but its pass is skipped, so its
    // slot (frame 1's main slot) still holds frame 1's 12 ms
    timer.begin();
    f.run(timer.compute('cull'), 0.1);
    f.run(timer.compute('matter.prep'), 0.2);
    timer.render('look.spot');
    f.run(timer.render('main'), 12);
    timer.resolve(f.enc);
    await flush();
    expect(timer.live).toEqual(['cull', 'matter.prep', 'main']);
    expect(timer.total()).toBeCloseTo(0.1 + 0.2 + 12, 6);
    // spans: frame 1 13.12 ms (0.1 + 1 + 12 + 2 gaps), frame 2 12.32 ms (the stale pair, 17 ms older, would stretch it)
    expect(timer.frameMs).toBeCloseTo(13.12 * 0.9 + 12.32 * 0.1, 6);
  });

  it('drops a name from total() at once and from ms after STALE_FRAMES frames', async () => {
    const f = fakeGpu();
    const timer = new GpuTimer(f.gpu, 8);
    const frame = async (names: string[]): Promise<void> => {
      timer.begin();
      for (const n of names) f.run(timer.render(n), n === 'volume' ? 3 : 5);
      timer.resolve(f.enc);
      await flush();
    };
    await frame(['main', 'volume']);
    expect(timer.total()).toBeCloseTo(8, 6);
    await frame(['main']);
    expect(timer.total()).toBeCloseTo(5, 6);
    expect(timer.ms.has('volume')).toBe(true);
    for (let i = 0; i < STALE_FRAMES; i++) await frame(['main']);
    expect(timer.ms.has('volume')).toBe(false);
  });

  it('leaves a frame untimed when three are in flight, and each in-flight frame uses its own query region', async () => {
    const f = fakeGpu();
    const timer = new GpuTimer(f.gpu, 8);
    const idx: number[] = [];
    for (let i = 0; i < 3; i++) {
      timer.begin();
      const ts = timer.render('main');
      idx.push(ts!.beginningOfPassWriteIndex);
      f.run(ts, 4);
      timer.resolve(f.enc); // read back in a microtask: still busy during this loop
    }
    expect(idx).toEqual([0, 16, 32]);
    timer.begin();
    expect(timer.render('main')).toBeUndefined();
    timer.resolve(f.enc);
    await flush();
    timer.begin();
    expect(timer.render('main')).toBeDefined();
    expect(timer.total()).toBeCloseTo(4, 6);
  });
});
