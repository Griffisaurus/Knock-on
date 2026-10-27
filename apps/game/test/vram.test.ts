// M4 (V4): the VRAM ledger, governor and texture sizes (gfx/vram.ts), and the KTX2 / BC7 build files (gfx/ktx2.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// WebGPU usage flags (not defined in Node)
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g['GPUTextureUsage'] ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  g['GPUBufferUsage'] ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
});

const { textureBytes, VramLedger, VramGovernor, RESERVE, MATTER_MEASURED_MB, TIER_BUDGET } = await import('../src/gfx/vram.ts');

// G5 (M5): the probe's Matter reservation covers what Matter allocates at each tier's grain budget (T5 / G5 measured
// the ledger's `matter` pool: backend + playback replica + the MatterRenderer's draw lists), with a small margin
describe('RESERVE.matter', () => {
  it('is the measured Matter pool plus a small margin on every tier, inside the tier budget', () => {
    for (const tier of [4, 8, 12, 16, 32] as const) {
      const reserved = RESERVE[tier].matter!, measured = MATTER_MEASURED_MB[tier] * 1024 ** 2;
      expect(reserved, `tier ${tier}`).toBeGreaterThanOrEqual(measured * 1.04);
      expect(reserved, `tier ${tier}`).toBeLessThanOrEqual(measured * 1.1);
      expect(reserved + RESERVE[tier].keyframes!, `tier ${tier}`).toBeLessThan(TIER_BUDGET[tier] * 0.5);
    }
  });
});
const { parseKtx2 } = await import('../src/gfx/ktx2.ts');

describe('textureBytes', () => {
  it('counts mips, layers, samples and compressed blocks', () => {
    expect(textureBytes({ size: [1024, 1024], format: 'rgba8unorm', usage: 0 })).toBe(4 << 20);
    // full mip chain of a 1024² rgba8 layer: 4/3 of level 0 (+ the 1×1 tail)
    const mips = textureBytes({ size: [1024, 1024, 1], format: 'rgba8unorm', mipLevelCount: 11, usage: 0 });
    expect(mips).toBe([...Array(11)].reduce((s, _, m) => s + (1024 >> m) ** 2 * 4, 0));
    // BC7: 1 byte per texel, mips under 4×4 still take one 16-byte block
    const bc = textureBytes({ size: [1024, 1024, 3], format: 'bc7-rgba-unorm', mipLevelCount: 11, usage: 0 });
    expect(bc).toBe(3 * [...Array(11)].reduce((s, _, m) => s + Math.max(4, 1024 >> m) ** 2, 0));
    expect(textureBytes({ size: [64, 64, 64], dimension: '3d', format: 'rgba16float', usage: 0 })).toBe(64 ** 3 * 8);
    expect(textureBytes({ size: { width: 100, height: 50 }, format: 'depth24plus', sampleCount: 4, usage: 0 })).toBe(100 * 50 * 4 * 4);
  });
});

/** A device stand-in: createBuffer / createTexture return objects with destroy(). */
function fakeDevice(): GPUDevice {
  const mk = (): { destroy(): void } => ({ destroy() { /* freed */ } });
  return { createBuffer: () => mk(), createTexture: () => mk() } as unknown as GPUDevice;
}

describe('VramLedger', () => {
  it('records allocations by pool (label, scope, render target) and releases on destroy', () => {
    const L = new VramLedger();
    const d = fakeDevice();
    L.attach(d);
    L.attach(d); // idempotent
    const a = d.createBuffer({ label: 'gi.scratch', size: 1000, usage: 0 });
    const b = L.scope('instances', () => d.createBuffer({ size: 500, usage: 0 }));
    const t = d.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const m = L.scope('look', () => d.createBuffer({ label: 'matter.pos', size: 64, usage: 0 })); // the label wins
    const s = d.createTexture({ label: 'set.albedo.2048', size: [8, 8], format: 'rgba8unorm', usage: 0 });
    expect(L.bytes('gi')).toBe(1000);
    expect(L.bytes('instances')).toBe(500);
    expect(L.bytes('targets')).toBe(16 * 16 * 4);
    expect(L.bytes('matter')).toBe(64);
    expect(L.bytes('textures')).toBe(256);
    expect(L.total).toBe(1000 + 500 + 1024 + 64 + 256);
    a.destroy();
    a.destroy(); // twice is fine
    b.destroy();
    expect(L.bytes('gi')).toBe(0);
    expect(L.total).toBe(1024 + 64 + 256);
    expect(L.peak).toBe(1000 + 500 + 1024 + 64 + 256);
    const id = L.register('keyframes', 'bake ring', 1 << 20);
    expect(L.bytes('keyframes')).toBe(1 << 20);
    L.release(id);
    expect(L.bytes('keyframes')).toBe(0);
    void t; void m; void s;
  });
});

describe('VramGovernor', () => {
  const knob = (name: string, n: number): { name: string; levels: string[]; level: number; set(l: number): void; sets: number[] } => {
    const k = { name, levels: [...Array(n)].map((_, i) => String(i)), level: 0, sets: [] as number[], set(l: number) { k.level = l; k.sets.push(l); } };
    return k;
  };
  const unthrottle = (g: InstanceType<typeof VramGovernor>): void => { (g as unknown as { lastStep: number; lastUp: number }).lastStep = -1e9; (g as unknown as { lastUp: number }).lastUp = -1e9; };

  it('steps down the schedule on pressure (volumes, gi, textures, …) and never past the end', () => {
    const g = new VramGovernor();
    const vol = knob('volumes', 4), gi = knob('gi', 3), tex = knob('textures', 2);
    g.register(vol); g.register(gi); g.register(tex);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      unthrottle(g);
      g.pressure('oom');
      seen.push(`${vol.level}${gi.level}${tex.level}`);
    }
    expect(seen).toEqual(['100', '110', '111', '211', '221', '321', '321', '321']);
    expect(g.counts.oom).toBe(8);
  });

  it('skips schedule entries without a knob, and a knob registered late takes the current level', () => {
    const g = new VramGovernor();
    const tex = knob('textures', 2);
    g.register(tex);
    unthrottle(g);
    g.pressure('spikes');
    expect(tex.level).toBe(1); // volumes and gi aren't registered: the first step reaches textures
    expect(g.level).toBe(3);
    const vol = knob('volumes', 4);
    g.register(vol);
    expect(vol.level).toBe(1);
  });

  it('rate-limits pressure to one step a second, except device loss', () => {
    const g = new VramGovernor();
    const vol = knob('volumes', 4);
    g.register(vol);
    unthrottle(g);
    g.pressure('oom');
    g.pressure('oom'); // within a second: counted, no step
    expect(vol.level).toBe(1);
    g.pressure('lost');
    expect(vol.level).toBe(2);
  });

  it('steps on a sustained slowdown only when the GPU time grew with it (paging), not on a throttled interval', () => {
    for (const gpuSlow of [60, 1]) {
      const g = new VramGovernor();
      const vol = knob('volumes', 4);
      g.register(vol);
      (g as unknown as { holdUntil: number }).holdUntil = 0;
      let now = 1e6;
      g.frame(now, 1);
      for (let i = 0; i < 120; i++) g.frame((now += 17), 1); // healthy: 17 ms frames, 1 ms of GPU work
      for (let i = 0; i < 60; i++) g.frame((now += 80), gpuSlow); // 80 ms frames for 4.8 s
      expect(vol.level, `gpu ${gpuSlow} ms`).toBe(gpuSlow > 1 ? 1 : 0);
      expect(g.counts.slow > 0).toBe(gpuSlow > 1);
    }
  });

  it('pre-steps from a short probe until the knobs free the deficit', () => {
    const g = new VramGovernor();
    const vol = Object.assign(knob('volumes', 4), { saves: (l: number) => [0, 800, 1200, 1600][l]! });
    const gi = Object.assign(knob('gi', 3), { saves: (l: number) => [0, 300, 340][l]! });
    g.register(vol); g.register(gi);
    g.applyProbe({ target: 2000, fitted: 1000, ok: false, reason: 'paging', steps: [], ms: 5 });
    // 1000 short: volumes ½ (800) isn't enough, + gi ½ (1100) is
    expect([vol.level, gi.level]).toEqual([1, 1]);
    expect(g.counts.probe).toBe(1);
  });
});

describe('KTX2 / BC7 build files', () => {
  const PARTS = resolve(__dirname, '../../../assets/build/parts');
  const listed = existsSync(PARTS) ? readdirSync(PARTS).flatMap((t) => {
    const p = join(PARTS, t, `${t}.art.json`);
    if (!existsSync(p)) return [];
    const k = (JSON.parse(readFileSync(p, 'utf8')) as { textures?: { size?: number; ktx2?: Record<string, string> } }).textures;
    return k?.ktx2 ? [{ t, size: k.size ?? 0, k: k.ktx2 }] : [];
  }) : [];

  it.skipIf(!listed.length)('every KTX2 an art.json lists is a full BC7 chain of the set size', async () => {
    for (const { t, size, k } of listed) {
      for (const m of ['albedo', 'normal', 'orm'] as const) {
        const buf = readFileSync(join(PARTS, t, k[m]!));
        const x = await parseKtx2(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
        expect(x.vkFormat, `${t} ${m}`).toBe(m === 'albedo' ? 146 : 145);
        expect(x.srgb, `${t} ${m}`).toBe(m === 'albedo');
        expect([x.width, x.height]).toEqual([size, size]);
        expect(x.levels.length).toBe(Math.log2(size) + 1);
        x.levels.forEach((l, i) => expect(l.length).toBe(Math.max(1, (size >> i) / 4) ** 2 * 16));
      }
    }
  }, 120_000); // inflates ~250 MB of levels
});
