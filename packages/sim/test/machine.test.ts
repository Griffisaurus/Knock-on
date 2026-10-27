import { describe, expect, it } from 'vitest';
import { makeId, metresToPos, snappedEuler, type LinkKind, type LinkRecord, type PartRecord, type Rotation } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { partDef, propSteps } from '@knockon/parts-data';
import { Machine, rotationToQuat, type SimEvent } from '../src/index.ts';

/** Tiny machine builder for tests (the PART_SYSTEM §8 harness). */
class Build {
  parts: PartRecord[] = [];
  links: LinkRecord[] = [];
  private n = 0;
  add(type: string, x: number, y: number, z: number, props: Record<string, number> = {}, rot: Rotation = snappedEuler(0, 0, 0), flags = 0): number {
    const def = partDef(type)!;
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v) as [number, number]).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot, flags, ...(list.length ? { props: list } : {}) });
    return id;
  }
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number {
    const port = (id: number, name: string): number => {
      const p = this.parts.find((q) => q.id === id)!;
      return partDef(p.type)!.ports.findIndex((x) => x.name === name);
    };
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: { part: from, port: port(from, fromPort) }, to: { part: to, port: port(to, toPort) }, via: [], points: [], length: 0 });
    return id;
  }
}

let J: JoltModule;
const jolt = async (): Promise<JoltModule> => (J ??= await loadJolt('single'));

function run(m: Machine, ticks: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); }
  return ev;
}

const bodyPos = (m: Machine, id: number, role: 'base' | 'arm' = 'base'): number[] => {
  const info = m.bodyInfo();
  const i = info.findIndex((b) => b.part === id && b.role === role);
  const t = m.transforms(new Float32Array(info.length * 7));
  return [t[i * 7]!, t[i * 7 + 1]!, t[i * 7 + 2]!, t[i * 7 + 3]!, t[i * 7 + 4]!, t[i * 7 + 5]!, t[i * 7 + 6]!];
};

describe('Machine', () => {
  it('quaternions from snapped Euler are unit length', () => {
    for (const r of [snappedEuler(90, 0, 0), snappedEuler(15, 30, -45), snappedEuler(0, 0, 0)]) {
      expect(Math.hypot(...rotationToQuat(r))).toBeCloseTo(1, 12);
    }
  });

  it('is deterministic: same snapshot in any order → same hashes; things move', async () => {
    const b = new Build();
    b.add('ledge', 0, 0.55, 0);
    b.add('thud', 0.1, 0.72, 0);
    for (let i = 0; i < 20; i++) b.add('topple_tile', 0.4 + i * 0.1, 0.075, 0);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 6; i++) b.add('brik', 2.6 + (row % 2) * 0.1, 0.05 + row * 0.1, -0.25 + i * 0.1, {}, snappedEuler(0, 90, 0));
    b.add('boing', 0.4, 1.4, 0.02);
    const Jm = await jolt();
    const hashes = (parts: PartRecord[]): string[] => {
      const m = new Machine(Jm, { parts });
      const out: string[] = [];
      const y0 = bodyPos(m, b.parts.at(-1)!.id)[1]!;
      for (let t = 1; t <= 600; t++) { m.step(); if (t % 60 === 0) out.push(m.hash()); }
      expect(bodyPos(m, b.parts.at(-1)!.id)[1]!).toBeLessThan(y0 - 0.5);
      m.destroy();
      return out;
    };
    const a = hashes(b.parts);
    expect(hashes([...b.parts].reverse())).toEqual(a);
    expect(a.at(-1)).toMatchInlineSnapshot(`"fafa5fb910601679"`);
  }, 60_000);

  it('THE BUTTON → signal cable → BANGSTICK detonator, blast throws a brick', async () => {
    const b = new Build();
    const button = b.add('the_button', 0, 0, 0);
    b.add('thud', 0, 0.4, 0);
    const stick = b.add('bangstick', 1, 0.039, 0);
    const brick = b.add('brik', 1.4, 0.05, 0);
    b.link('cable_signal', button, 'out', stick, 'detonator');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    const kinds = ev.map((e) => e.kind);
    expect(kinds).toContain('Press');
    expect(kinds).toContain('Signal');
    const boom = ev.find((e) => e.kind === 'Detonate')!;
    expect(boom.part).toBe(stick);
    expect(boom.tick).toBeLessThan(120);
    const p = bodyPos(m, brick);
    expect(p[0]!).toBeGreaterThan(1.6); // thrown away from the blast
    m.destroy();
  }, 30_000);

  it('WICK lights a FUSE that burns at 0.2 m/s into a BANGSTICK, which goes off after its fuse time', async () => {
    const b = new Build();
    const wick = b.add('wick', 0, 0, 0);
    const stick = b.add('bangstick', 0.6, 0.039, 0, { fuse: 1.0 });
    b.link('fuse', wick, 'flame', stick, 'fuse');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 120 * 6);
    const lit = ev.find((e) => e.kind === 'Ignite' && e.part === stick)!;
    const boom = ev.find((e) => e.kind === 'Detonate')!;
    // fuse runs port to port: wick front (0, 0.019, 0.047) → stick fuse port (0.74, 0.068, 0)
    const len = Math.hypot(0.74, 0.049, 0.047);
    expect(lit.tick).toBeGreaterThanOrEqual(Math.floor((len / 0.2) * 120) - 2);
    expect(lit.tick).toBeLessThanOrEqual(Math.ceil((len / 0.2) * 120) + 2);
    expect(boom.tick - lit.tick).toBeGreaterThanOrEqual(119);
    expect(boom.tick - lit.tick).toBeLessThanOrEqual(122);
    m.destroy();
  }, 30_000);

  it('sympathetic detonation chains through nearby explosives', async () => {
    const b = new Build();
    const button = b.add('the_button', -1, 0, 0);
    b.add('thud', -1, 0.4, 0);
    const s1 = b.add('bangstick', 0, 0.039, 0);
    const s2 = b.add('bangstick', 0.4, 0.039, 0);
    const s3 = b.add('bangstick', 0.8, 0.039, 0);
    b.link('cable_signal', button, 'out', s1, 'detonator');
    const m = new Machine(await jolt(), b);
    const booms = run(m, 240).filter((e) => e.kind === 'Detonate');
    expect(booms.map((e) => e.part)).toEqual([s1, s2, s3]);
    expect(booms[1]!.tick - booms[0]!.tick).toBeGreaterThanOrEqual(2);
    m.destroy();
  }, 30_000);

  it('MAINS → power cable → MOTOR → BAND → COG spins at the no-load speed; a meshed COG counter-rotates', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, 0);
    const motor = b.add('motor', 0, 0, 0);
    const cog1 = b.add('cog', 0.6, 0.4, 0, { size: 1 });
    const cog2 = b.add('cog', 0.8, 0.4, 0, { size: 1 }); // pitch radii 0.1 + 0.1 = 0.2 m apart: meshes
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', cog1, 'axle');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    expect(ev.some((e) => e.kind === 'Powered')).toBe(true);
    const ang = (id: number): number => {
      const q = bodyPos(m, id, 'arm');
      return 2 * Math.atan2(q[5]!, q[6]!); // rotation about z
    };
    // integrate per-tick angle changes (each well under π) over 0.1 s
    const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    let p1 = ang(cog1), p2 = ang(cog2), s1 = 0, s2 = 0;
    for (let t = 0; t < 12; t++) {
      m.step();
      const q1 = ang(cog1), q2 = ang(cog2);
      s1 += wrap(q1 - p1); s2 += wrap(q2 - p2);
      p1 = q1; p2 = q2;
    }
    const w1 = s1 / 0.1, w2 = s2 / 0.1;
    expect(Math.abs(w1)).toBeGreaterThan(6);
    expect(Math.sign(w1)).toBe(-Math.sign(w2));
    m.destroy();
  }, 30_000);

  it('SNIPPER cuts a LINE through its jaws: the tethered HELIO floats away', async () => {
    const b = new Build();
    const snip = b.add('snipper', 0.3, 0, 0);
    const hook = b.add('anchor', 0.4, 0.036, 0); // on the plinth, under the blades
    const helio = b.add('helio', 0.4, 0.7, 0);
    const button = b.add('the_button', -1, 0, 0);
    b.add('thud', -1, 0.4, 0);
    b.link('line', helio, 'knot', hook, 'hook');
    b.link('cable_signal', button, 'out', snip, 'close');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 360);
    const cut = ev.find((e) => e.kind === 'Cut')!;
    expect(cut.tick).toBeLessThan(60); // the THUD lands on the button ≈ 0.2 s in
    expect(bodyPos(m, helio)[1]!).toBeGreaterThan(1.5); // free: tethered it couldn't pass ≈ 0.7 m
    m.destroy();
  }, 30_000);

  it('HELIO rises on toy helium and pops on a sharp COG', async () => {
    const b = new Build();
    const h = b.add('helio', 0, 0.3, 0);
    const h2 = b.add('helio', 2, 0.3, 0);
    b.add('cog', 2, 0.6, 0, { size: 2 });
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    expect(bodyPos(m, h)[1]!).toBeGreaterThan(1.0);
    expect(ev.some((e) => e.kind === 'Pop' && e.part === h2)).toBe(true);
    m.destroy();
  }, 30_000);

  it('GALE blows a BOING and douses a WICK', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, 0);
    const fan = b.add('gale', 0, 0, 0);
    const ball = b.add('boing', 0, 0.12, 0.6);
    const wick = b.add('wick', 0.0, 0, 1.2);
    b.link('cable_power', mains, 'out', fan, 'in');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    expect(bodyPos(m, ball)[2]!).toBeGreaterThan(0.8);
    expect(ev.some((e) => e.kind === 'Extinguish' && e.part === wick)).toBe(true);
    m.destroy();
  }, 30_000);

  it('rollback: restoring a checkpoint and re-simulating reproduces the same future, pokes included', async () => {
    const b = new Build();
    b.add('thud', 0, 0.5, 0);
    for (let i = 0; i < 10; i++) b.add('topple_tile', 0.3 + i * 0.1, 0.075, 0);
    const ball = b.add('boing', -0.5, 0.12, 0);
    const Jm = await jolt();
    const poke = { tick: 150, seq: 1, partId: ball, kind: 'impulse' as const, data: [3, 0.5, 0] };
    const a = new Machine(Jm, b);
    a.addPoke(poke);
    for (let t = 0; t < 300; t++) a.step();
    const ha = a.hash();
    const c = new Machine(Jm, b);
    for (let t = 0; t < 200; t++) c.step();
    c.addPoke(poke); // arrives late: the sim already passed tick 150
    const back = c.restore(150);
    expect(back).toBeLessThanOrEqual(150);
    while (c.tick < 300) c.step();
    expect(c.hash()).toBe(ha);
    a.destroy(); c.destroy();
  }, 30_000);

  it('rollback: a poke late inside the first checkpoint interval rolls back to the start state', async () => {
    const b = new Build();
    const ball = b.add('boing', -0.5, 0.12, 0);
    b.add('thud', 0.5, 0.11, 0);
    const Jm = await jolt();
    const poke = { tick: 21, seq: 1, partId: ball, kind: 'impulse' as const, data: [3, 0.5, 0] };
    const a = new Machine(Jm, b);
    a.addPoke(poke);
    for (let t = 0; t < 240; t++) a.step();
    const c = new Machine(Jm, b);
    for (let t = 0; t < 35; t++) c.step();
    c.addPoke(poke); // the soak's case: tick 21 arriving at tick 35, before the first periodic checkpoint
    expect(c.restore(21)).toBe(0);
    while (c.tick < 240) c.step();
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 30_000);

  it('MAINS meter: demand against supply, overload past 500 W, dark when off', async () => {
    const b = new Build();
    const mains = b.add('mains', 0, 0, 0);
    const motors = [0, 1, 2, 3, 4].map((k) => b.add('motor', 0.4 + k * 0.3, 0, 0));
    const spare = b.add('mains', 0, 0, 1, { on: 0 });
    b.link('cable_power', mains, 'out', motors[0]!, 'in');
    const m = new Machine(await jolt(), b);
    run(m, 2);
    const meters = (): Uint8Array => m.partMeters(new Uint8Array(m.parts.length));
    const at = (id: number): number => meters()[m.parts.findIndex((p) => p.id === id)]!;
    expect(at(mains)).toBe(1 + Math.round((20 * 120) / 500)); // one 120 W motor on 500 W
    expect(at(spare)).toBe(0);
    expect(at(motors[1]!)).toBe(0);
    m.destroy();
    for (const mo of motors.slice(1)) b.link('cable_power', mains, 'out', mo, 'in');
    const m2 = new Machine(await jolt(), b);
    run(m2, 2);
    expect(m2.partMeters(new Uint8Array(m2.parts.length))[m2.parts.findIndex((p) => p.id === mains)]).toBe(31); // 600 W > 500 W
    m2.destroy();
  }, 30_000);

  it('a THUD on a STOMP PAD sends a signal', async () => {
    const b = new Build();
    const pad = b.add('stomp_pad', 0, 0, 0);
    b.add('thud', 0, 0.4, 0);
    const stick = b.add('bangstick', 1, 0.039, 0);
    b.link('cable_signal', pad, 'out', stick, 'detonator');
    const m = new Machine(await jolt(), b);
    expect(run(m, 240).some((e) => e.kind === 'Detonate')).toBe(true);
    m.destroy();
  }, 30_000);

  it('M1 exit golden: a 42-part, 5-link machine (every M1 channel) replays bit-identically', async () => {
    // the demo machine from the browser test: signal → boom → wall, wick → fuse → boom → dominoes,
    // mains → motor → band → three meshed cogs, a tethered balloon
    const b = new Build();
    const button = b.add('the_button', -1.5, 0, 0);
    b.add('thud', -1.5, 0.6, 0);
    const stickA = b.add('bangstick', 0, 0.039, 0);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) b.add('brik', 1.2 + (r % 2) * 0.1, 0.05 + r * 0.1, -0.2 + i * 0.1);
    const wick = b.add('wick', -1.0, 0, 1.6);
    const stickC = b.add('bangstick', 0.6, 0.039, 1.6, { fuse: 1 });
    for (let i = 0; i < 10; i++) b.add('topple_tile', 1.6 + i * 0.1, 0.075, 1.6);
    const mains = b.add('mains', -1.4, 0, -1.6);
    const motor = b.add('motor', -0.8, 0, -1.6);
    const cog1 = b.add('cog', -0.3, 0.35, -1.6);
    b.add('cog', -0.1, 0.35, -1.6);
    b.add('cog', 0.15, 0.35, -1.6, { size: 2 });
    const helio = b.add('helio', 1.0, 0.3, -1.4);
    const anchor = b.add('anchor', 1.0, 0, -1.4);
    b.link('cable_signal', button, 'out', stickA, 'detonator');
    b.link('fuse', wick, 'flame', stickC, 'fuse');
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', cog1, 'axle');
    b.link('line', helio, 'knot', anchor, 'hook');
    const Jm = await jolt();
    const replay = (): { hashes: string[]; booms: number[] } => {
      const m = new Machine(Jm, b);
      const hashes: string[] = [];
      const booms: number[] = [];
      for (let t = 1; t <= 1800; t++) {
        m.step();
        for (const e of m.drainEvents()) if (e.kind === 'Detonate') booms.push(e.tick);
        if (t % 60 === 0) hashes.push(m.hash());
      }
      m.destroy();
      return { hashes, booms };
    };
    const a = replay();
    expect(replay()).toEqual(a);
    expect(a.booms.length).toBe(2);
    expect(a.hashes.at(-1)).toMatchInlineSnapshot(`"102ef0dd2eaa19ab"`);
  }, 60_000);

  it('desync repair: a diverged machine adopts its partner checkpoint and converges', async () => {
    const b = new Build();
    b.add('thud', 0, 0.5, 0);
    for (let i = 0; i < 10; i++) b.add('topple_tile', 0.3 + i * 0.1, 0.075, 0);
    const ball = b.add('boing', -0.5, 0.12, 0);
    const Jm = await jolt();
    const a = new Machine(Jm, b), c = new Machine(Jm, b);
    c.addPoke({ tick: 30, seq: 1, partId: ball, kind: 'impulse', data: [2, 1, 0] }); // c diverges
    for (let t = 0; t < 200; t++) { a.step(); c.step(); }
    expect(c.hash()).not.toBe(a.hash());
    const cp = a.exportCheckpoint(190)!;
    expect(cp.tick).toBe(180);
    expect(c.importCheckpoint(cp.blob)).toBe(180);
    while (c.tick < 400) c.step();
    while (a.tick < 400) a.step();
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 30_000);
});
