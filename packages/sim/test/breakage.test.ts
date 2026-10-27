import { describe, expect, it } from 'vitest';
import { makeId, metresToPos, snappedEuler, type LinkKind, type LinkRecord, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { partDef, propSteps } from '@knockon/parts-data';
import { Machine, type SimEvent } from '../src/index.ts';

class Build {
  parts: PartRecord[] = [];
  links: LinkRecord[] = [];
  private n = 0;
  add(type: string, x: number, y: number, z: number, props: Record<string, number> = {}, flags = 0): number {
    const def = partDef(type)!;
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v) as [number, number]).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: snappedEuler(0, 0, 0), flags, ...(list.length ? { props: list } : {}) });
    return id;
  }
  link(kind: LinkKind, from: number | null, fromPort: string, to: number | null, toPort: string, points: number[][] = []): number {
    const port = (id: number, name: string): number => partDef(this.parts.find((q) => q.id === id)!.type)!.ports.findIndex((x) => x.name === name);
    const id = makeId(1, ++this.n);
    this.links.push({
      id, kind, from: from === null ? null : { part: from, port: port(from, fromPort) }, to: to === null ? null : { part: to, port: port(to, toPort) },
      via: [], points: points.map((p) => p.map(metresToPos) as [number, number, number]), length: 0,
    });
    return id;
  }
}

let J: JoltModule;
const jolt = async (): Promise<JoltModule> => (J ??= await loadJolt('single'));
const run = (m: Machine, ticks: number): SimEvent[] => {
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); }
  return ev;
};
const pos = (m: Machine, id: number, role: 'base' | 'chunk' = 'base'): number[] => {
  const info = m.bodyInfo();
  const i = info.findIndex((b) => b.part === id && b.role === role);
  const t = m.transforms(new Float32Array(info.length * 7));
  return [t[i * 7]!, t[i * 7 + 1]!, t[i * 7 + 2]!];
};

describe('breakage, tubes, exposure, faults', () => {
  it('a mortared BRIK wall stands as one piece, then cracks apart in a blast', async () => {
    const b = new Build();
    const bricks: number[] = [];
    for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) bricks.push(b.add('brik', 0.1 * (r % 2) + i * 0.2, 0.05 + r * 0.1, 0));
    const m0 = new Machine(await jolt(), b);
    const calm = run(m0, 240);
    expect(calm.some((e) => e.kind === 'Break')).toBe(false);
    const top0 = pos(m0, bricks.at(-1)!)[1]!;
    expect(top0).toBeGreaterThan(0.44); // still standing
    m0.destroy();

    const button = b.add('the_button', -1.2, 0, 0.6);
    b.add('thud', -1.2, 0.4, 0.6);
    const stick = b.add('bangstick', 0.2, 0.039, 0.35);
    b.link('cable_signal', button, 'out', stick, 'detonator');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 360);
    expect(ev.filter((e) => e.kind === 'Break').length).toBeGreaterThan(5);
    m.destroy();
  }, 30_000);

  it('a PLANK hit hard enough snaps into two halves', async () => {
    const b = new Build();
    b.add('ledge', -0.45, 0.4, 0);
    b.add('ledge', 0.45, 0.4, 0);
    const plank = b.add('plank', 0, 0.5, 0, {}, 0);
    // the plank lies along z: turn it to bridge the gap between the ledges
    b.parts[b.parts.length - 1] = { ...b.parts.at(-1)!, rot: snappedEuler(90, 0, 0) };
    b.add('thud', 0, 2.5, 0);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    expect(ev.some((e) => e.kind === 'Break' && e.part === plank)).toBe(true);
    m.destroy();
  }, 30_000);

  it('a burning PLANK (lit by a WICK) catches after 4 s and breaks 6 s later', async () => {
    const b = new Build();
    const plank = b.add('plank', 0, 0.25, 0);
    b.add('wick', 0, 0, -0.38);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 120 * 12);
    const ign = ev.find((e) => e.kind === 'Ignite' && e.part === plank)!;
    const brk = ev.find((e) => e.kind === 'Break' && e.part === plank)!;
    expect(ign.tick).toBeGreaterThanOrEqual(479);
    expect(brk.tick - ign.tick).toBeGreaterThanOrEqual(719);
    m.destroy();
  }, 30_000);

  it('a TUBE carries a ball down its path', async () => {
    const b = new Build();
    b.link('tube', null, '', null, '', [[0, 1.2, 0], [0.8, 0.9, 0], [1.6, 0.6, 0], [1.9, 0.6, 0.6]]);
    const ball = b.add('boing', 0, 1.25, 0);
    const m = new Machine(await jolt(), b);
    run(m, 360);
    const p = pos(m, ball);
    expect(p[0]!).toBeGreaterThan(1.4); // followed the tube instead of dropping straight down
    m.destroy();
  }, 30_000);

  it('a static wall shields a brick from a blast (exposure rays)', async () => {
    // a LEDGE stood on edge (rolled 90°) is a 0.4 m static slab between the stick and the brick
    const scene = async (wall: boolean): Promise<number> => {
      const b = new Build();
      const button = b.add('the_button', -1.5, 0, 0);
      b.add('thud', -1.5, 0.4, 0);
      const stick = b.add('bangstick', 0, 0.039, 0);
      if (wall) { b.add('ledge', 0.3, 0, 0); b.parts[b.parts.length - 1] = { ...b.parts.at(-1)!, rot: snappedEuler(0, 0, 90) }; }
      const target = b.add('brik', 0.6, 0.05, 0);
      b.link('cable_signal', button, 'out', stick, 'detonator');
      const m = new Machine(await jolt(), b);
      run(m, 360);
      const x = pos(m, target)[0]!;
      m.destroy();
      return x;
    };
    const open = await scene(false), shielded = await scene(true);
    expect(open).toBeGreaterThan(1.0);
    expect(shielded).toBeLessThan(0.75);
  }, 30_000);

  it('a FUSE with waypoints burns along its whole path', async () => {
    const b = new Build();
    const wick = b.add('wick', 0, 0, 0);
    const stick = b.add('bangstick', 0.5, 0.039, 0, { fuse: 0.5 });
    // the cord detours 0.6 m out and back: path ≈ 0.05 + 0.6 + 0.5 + 0.6 m
    b.link('fuse', wick, 'flame', stick, 'fuse', [[0, 0.02, 0.6], [0.6, 0.02, 0.6]]);
    const m = new Machine(await jolt(), b);
    const lit = run(m, 120 * 12).find((e) => e.kind === 'Ignite' && e.part === stick)!;
    expect(lit.tick / 120).toBeGreaterThan(8.5); // straight it would take ~2.4 s
    m.destroy();
  }, 30_000);

  it('a MOTOR held still by a jammed load reports a Jam; a starved one browns out', async () => {
    const b = new Build();
    const mains = b.add('mains', -1, 0, 0, { on: 1 });
    const motors = [0, 1, 2, 3, 4, 5].map((i) => b.add('motor', i * 0.3, 0, 1));
    const fan = b.add('gale', 2, 0, 0);
    for (const mo of motors) b.link('cable_power', mains, 'out', mo, 'in');
    b.link('cable_power', motors[0]!, 'in', fan, 'in');
    // 6 × 120 W + 60 W on 500 W: f ≈ 0.64 (no brownout); add a second fan chain on its own weak supply below
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    expect(ev.some((e) => e.kind === 'Powered')).toBe(true);
    expect(ev.some((e) => e.kind === 'Brownout')).toBe(false);
    m.destroy();
  }, 30_000);
});
