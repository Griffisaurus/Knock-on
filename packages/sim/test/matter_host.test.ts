// machine.matter (M4_PLAN contract 2, SIMULATION §8.5): fixed latency, proxies, rollback with Matter, the Matter
// checksum in the state hash, MATR round trips and the FISHBOWL water path. These tests drive the host with a toy
// backend (matter_toy.ts) so the plumbing is checked independently of MX's kernels; matter_cpu.test.ts runs the same
// worlds on MX's CPU backend.

import { describe, expect, it } from 'vitest';
import { decodeMatrSection, encodeMatrSection } from '@knockon/format';
import { Machine } from '../src/index.ts';
import type { MatterStepIn, MatterStepOut } from '../src/matter/contract.ts';
import { SyncBackendLink, type MatterLink, type MatterSnapRef } from '../src/matter/link.ts';
import { packIn, packOut, unpackIn, unpackOut } from '../src/matter/pack.ts';
import { MAX_SUB } from '../src/matter/proxies.ts';
import { Build, jolt } from './harness.ts';
import { ToyMatter } from './matter_toy.ts';

/** A link that records when (rigid tick) each Matter tick is submitted and taken. */
class SpyLink implements MatterLink {
  readonly kind = 'spy';
  readonly submits: { at: number; input: MatterStepIn }[] = [];
  readonly takes: { at: number; tick: number }[] = [];
  m: Machine | null = null;
  private readonly inner: MatterLink;
  constructor(inner: MatterLink) { this.inner = inner; }
  submit(input: MatterStepIn): void { this.submits.push({ at: this.m!.st.tick, input }); this.inner.submit(input); }
  take(tick: number): MatterStepOut { this.takes.push({ at: this.m!.st.tick, tick }); return this.inner.take(tick); }
  snapshot(): MatterSnapRef { return this.inner.snapshot(); }
  restore(ref: MatterSnapRef): void { this.inner.restore(ref); }
  bytes(ref: MatterSnapRef): Uint8Array { return this.inner.bytes(ref); }
  release(ref: MatterSnapRef): void { this.inner.release(ref); }
  destroy(): void { this.inner.destroy(); }
}

/** FISHBOWL hit by a THUD from 1 m (it breaks at ~0.45 s), a FUZZ on the floor nearby, a SCOOP under the splash. */
function bowlWorld(): { b: Build; bowl: number; thud: number; fuzz: number; scoop: number } {
  const b = new Build();
  const bowl = b.add('fishbowl', 0, 0, 0);
  const thud = b.add('thud', 0.02, 1.1, 0);
  const fuzz = b.add('fuzz', 0.35, 0.0325, 0);
  const scoop = b.add('scoop', -0.4, 0, 0);
  return { b, bowl, thud, fuzz, scoop };
}

async function machine(b: Build, opts: { link?: MatterLink; toy?: ToyMatter; matter?: boolean; every?: number } = {}): Promise<Machine> {
  const J = await jolt();
  const on = opts.matter ?? true;
  return new Machine(J, { parts: b.parts, links: b.links }, {
    ...(on ? { simFlags: { matterGameplay: true }, matter: { ...(opts.link ? { link: opts.link } : { backend: opts.toy ?? new ToyMatter() }), checkpointEvery: opts.every ?? 60 } } : {}),
  });
}

describe('machine.matter: latency (SIMULATION §8.5)', () => {
  it('submits Matter tick N at rigid tick 2N from the snapshot of 2N − 4, and applies it at 2N + 4', async () => {
    const { b, fuzz } = bowlWorld();
    const toy = new ToyMatter();
    toy.initSync({ capacity: 20000, seed: 1 });
    const spy = new SpyLink(new SyncBackendLink(toy));
    const m = await machine(b, { link: spy });
    spy.m = m;
    const fuzzBody = m.bodyInfo().findIndex((x) => x.part === fuzz && x.role === 'base');
    const posAfter = new Map<number, [number, number, number]>(); // FUZZ position at the end of each rigid tick
    const at = (): [number, number, number] => { const t = m.transforms(new Float32Array(m.bodies.length * 7)); return [t[fuzzBody * 7]!, t[fuzzBody * 7 + 1]!, t[fuzzBody * 7 + 2]!]; };
    posAfter.set(-1, at());
    const applied: number[] = [];
    for (let t = 0; t < 360; t++) { m.step(); posAfter.set(t, at()); applied.push(m.st.matter!.applied); }
    expect(m.matter.started).toBe(true);
    // the backend counts from the first command (backend tick = N − first): Matter tick N = first + backend tick
    const first = m.st.matter!.first;
    expect(first).toBeGreaterThan(0);
    // every Matter tick from the first emit on, submitted at rigid tick 2N, in order
    spy.submits.forEach((s, k) => { expect(s.input.tick).toBe(k); expect(s.at).toBe(2 * (first + k)); });
    // results are fetched in order, never skipped, no later than rigid tick 2N + 4 (a Matter checkpoint fetches the two
    // pending ones early, after their tick ran), and applied exactly at rigid tick 2N + 4
    expect(spy.takes.length).toBeGreaterThan(100);
    spy.takes.forEach((x, k) => { expect(x.tick).toBe(k); expect(x.at).toBeLessThanOrEqual(2 * (first + k) + 4); expect(x.at).toBeGreaterThan(2 * (first + k)); });
    applied.forEach((a, t) => { expect(a).toBe(t >= 2 * first + 4 ? Math.floor((t - 4) / 2) : -1); });
    // the FUZZ's proxy in Matter tick N sits where the FUZZ was after rigid tick 2N − 4 (from the third command on;
    // the first two use the first snapshot)
    let checked = 0;
    for (const s of spy.submits.slice(2)) {
      const p = s.input.proxies.find((x) => x.id === fuzzBody * MAX_SUB);
      if (!p) continue;
      const want = posAfter.get(2 * (first + s.input.tick) - 4)!;
      for (let k = 0; k < 3; k++) expect(p.pos[k]).toBe(Math.round(want[k]! * 65536));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    m.destroy();
  });

  it('stays dormant (no commands) until something emits', async () => {
    const b = new Build();
    b.add('fishbowl', 0, 0, 0);
    b.add('fuzz', 0.4, 0.0325, 0);
    const toy = new ToyMatter();
    toy.initSync({ capacity: 1000, seed: 1 });
    const spy = new SpyLink(new SyncBackendLink(toy));
    const m = await machine(b, { link: spy });
    spy.m = m;
    for (let t = 0; t < 240; t++) m.step();
    expect(spy.submits.length).toBe(0);
    expect(m.matter.started).toBe(false);
    expect(m.matter.fill(0)).toBe(1); // the bowl is full of (stored) water
    m.destroy();
  });
});

describe('machine.matter: FISHBOWL water (contraptions.md, D33)', () => {
  it('a broken bowl bursts its 11.7 L as Matter water; the Splash event still plays', async () => {
    const { b, bowl } = bowlWorld();
    const toy = new ToyMatter();
    const m = await machine(b, { toy });
    const bi = b.parts.findIndex((p) => p.id === bowl);
    let splash = 0, broke = -1;
    for (let t = 0; t < 300; t++) {
      m.step();
      for (const e of m.drainEvents()) { if (e.kind === 'Splash') splash++; if (e.kind === 'Break' && e.part === bowl) broke = e.tick; }
    }
    expect(broke).toBeGreaterThan(0);
    expect(splash).toBe(1);
    expect(m.matter.stored(bi)).toBe(0);
    // every litre left the bowl as particles (some may already sit in the SCOOP)
    const total = m.matter.count(1) + m.matter.stored(b.parts.findIndex((p) => p.type === 'scoop'), 1);
    expect(total).toBeGreaterThan(11000);
    expect(toy.inputs.get(0)!.emits.reduce((n, e) => n + e.count, 0)).toBe(11700);
    m.destroy();
  });

  it('with Matter off the bowl keeps its M2 behaviour (cosmetic splash, no Matter state)', async () => {
    const { b } = bowlWorld();
    const m = await machine(b, { matter: false });
    let splash = 0;
    for (let t = 0; t < 300; t++) { m.step(); splash += m.drainEvents().filter((e) => e.kind === 'Splash').length; }
    expect(splash).toBe(1);
    expect(m.st.matter).toBeNull();
    expect(m.matter.active).toBe(false);
    m.destroy();
  });

  it('a SCOOP under the splash takes water in', async () => {
    const b = new Build();
    b.add('fishbowl', 0, 0.5, 0);
    b.add('ledge', 0, 0.45, 0);
    b.add('thud', 0.02, 1.6, 0);
    const scoop = b.add('scoop', 0, 0, 0);
    const m = await machine(b);
    const si = b.parts.findIndex((p) => p.id === scoop);
    for (let t = 0; t < 420; t++) m.step();
    expect(m.matter.stored(si, 1)).toBeGreaterThan(0);
    expect(m.matter.fill(si)).toBeGreaterThan(0);
    m.destroy();
  });
});

describe('machine.matter: near() (DUSTY grain finder)', () => {
  it('answers with the fixed latency, finds the water, and survives a rollback', async () => {
    const { b } = bowlWorld();
    const toy = new ToyMatter();
    const m = await machine(b, { toy });
    const ask = (): number[] | null => m.matter.near([0, 0.05, 0], 1.0, 0b010);
    let firstAnswer = -1;
    for (let t = 0; t < 300; t++) {
      const r = ask(); // a critter asks every tick (its stage 6)
      if (r && firstAnswer < 0) firstAnswer = m.tick;
      m.step();
    }
    const r = ask()!;
    expect(firstAnswer).toBeGreaterThan(2 * m.st.matter!.first + 4 - 1); // never before the first answer could land
    expect(r[3]).toBeGreaterThan(1000); // water around the broken bowl
    expect(Math.hypot(r[0]!, r[2]!)).toBeLessThan(1.0);
    expect(m.matter.near([30, 0, 30], 0.5, 0b010)).toBeNull(); // nothing asked there yet, nothing there
    // rollback: the answers are plain state, so a re-simulation gives the same ones and the same hash
    const h = m.hash();
    expect(m.restore(250)).toBe(240);
    while (m.tick < 300) { ask(); m.step(); }
    expect(m.hash()).toBe(h);
    expect(ask()).toEqual(r);
    m.destroy();
  });
});

describe('machine.matter: resting bodies stay asleep', () => {
  it('a THUD resting on THE BUTTON presses it once, not every time it falls asleep (A4 finding)', async () => {
    const b = new Build();
    b.add('fishbowl', 0, 0, 0);
    b.add('thud', 0.02, 1.1, 0);
    const button = b.add('the_button', -0.6, 0, 0.3);
    b.add('thud', -0.6, 0.2, 0.3);
    const m = await machine(b);
    const presses: number[] = [];
    for (let t = 0; t < 600; t++) { m.step(); for (const e of m.drainEvents()) if (e.kind === 'Press' && e.part === button) presses.push(e.tick); }
    expect(m.matter.started).toBe(true);
    expect(presses.length).toBe(1);
    m.destroy();
  });
});

describe('machine.matter: determinism, hash, rollback', () => {
  it('two runs give the same hash sequence, and the hash covers the Matter checksum', async () => {
    const run = async (): Promise<string[]> => {
      const { b } = bowlWorld();
      const m = await machine(b);
      const out: string[] = [];
      for (let t = 1; t <= 480; t++) { m.step(); if (t % 30 === 0) out.push(`${m.hash()}:${m.matter.checksumHex()}`); }
      m.destroy();
      return out;
    };
    const a = await run(), c = await run();
    expect(c).toEqual(a);
    expect(new Set(a.map((x) => x.split(':')[1])).size).toBeGreaterThan(4); // Matter really moves
    const { b } = bowlWorld();
    const m = await machine(b);
    for (let t = 0; t < 300; t++) m.step();
    const h = m.hash();
    m.st.matter!.sum[0] = (m.st.matter!.sum[0]! + 1) >>> 0;
    expect(m.hash()).not.toBe(h);
    m.destroy();
  });

  it('a late poke rolls back to a Matter checkpoint and matches the straight run', async () => {
    const poke = (fuzz: number) => ({ tick: 400, seq: 1, partId: fuzz, kind: 'impulse' as const, data: [0.02, 0.05, 0] });
    const w1 = bowlWorld();
    const straight = await machine(w1.b);
    straight.addPoke(poke(w1.fuzz));
    const want: string[] = [];
    for (let t = 1; t <= 720; t++) { straight.step(); if (t % 60 === 0) want.push(straight.hash()); }
    const w2 = bowlWorld();
    const late = await machine(w2.b);
    const got: string[] = [];
    for (let t = 1; t <= 600; t++) { late.step(); if (t % 60 === 0) got.push(late.hash()); }
    late.addPoke(poke(w2.fuzz));
    const back = late.restore(400);
    expect(back).toBe(360); // the newest Matter checkpoint at or before 400 (every 60 ticks here)
    got.length = back / 60;
    while (late.tick < 720) { late.step(); if (late.tick % 60 === 0) got.push(late.hash()); }
    expect(got).toEqual(want);
    straight.destroy(); late.destroy();
  });

  it('only checkpoints with a Matter snapshot can be restored while Matter runs', async () => {
    const { b } = bowlWorld();
    const J = await jolt();
    const m = new Machine(J, { parts: b.parts, links: b.links }, { simFlags: { matterGameplay: true }, matter: { backend: new ToyMatter(), checkpointEvery: 240 } });
    for (let t = 0; t < 500; t++) m.step();
    expect(m.restore(470)).toBe(240);
    m.destroy();
  });

  it('desync repair carries Matter (KNCP with MATR) and the partner continues identically', async () => {
    const wa = bowlWorld();
    const a = await machine(wa.b);
    for (let t = 0; t < 420; t++) a.step();
    const cp = a.exportCheckpoint(420)!;
    expect(cp.tick).toBe(420);
    const wc = bowlWorld();
    const c = await machine(wc.b);
    for (let t = 0; t < 100; t++) c.step(); // somewhere else entirely
    expect(c.importCheckpoint(cp.blob)).toBe(420);
    for (let t = 0; t < 180; t++) { a.step(); c.step(); }
    expect(c.hash()).toBe(a.hash());
    expect(c.matter.checksumHex()).toBe(a.matter.checksumHex());
    a.destroy(); c.destroy();
  });
});

describe('MATR and the pack codecs', () => {
  it('round-trip step inputs, outputs and the MATR payload', () => {
    const input: MatterStepIn = {
      tick: 7,
      proxies: [{ id: 64, shape: 2, dynamic: true, pos: Int32Array.of(1, -2, 3), rot: Int32Array.of(0, 0, 0, 16384), size: Int32Array.of(5, 6, 7), vel: Int32Array.of(-1, 0, 1), ang: Int32Array.of(9, 8, 7) }],
      emits: [{ seq: 3, kind: 1, count: 100, pos: Int32Array.of(1, 2, 3), vel: Int32Array.of(4, 5, 6), spread: 7, seed: 0xdeadbeef }],
      intakes: [{ id: 0, min: Int32Array.of(-1, -1, -1), max: Int32Array.of(1, 1, 1), kindMask: 2, capacity: 50 }],
      blasts: [{ center: Int32Array.of(0, 9, 0), radius: 1000, impulse: -20 }],
    };
    const back = unpackIn(packIn(input));
    expect(JSON.stringify(back, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Int32Array) : v))).toBe(JSON.stringify(input, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Int32Array) : v)));
    const out: MatterStepOut = { tick: 7, impulses: [{ id: 64, lin: Int32Array.of(1, 2, 3), ang: Int32Array.of(-4, -5, -6) }], absorbed: [{ id: 0, counts: Int32Array.of(0, 12, 0) }], counts: Int32Array.of(0, 88, 0), checksum: [0xffffffff, 1], bounds: Int32Array.of(-5, -6, -7, 5, 6, 7) };
    const o2 = unpackOut(packOut(out));
    expect(o2.checksum).toEqual([0xffffffff, 1]);
    expect(Array.from(o2.bounds!)).toEqual([-5, -6, -7, 5, 6, 7]);
    expect(Array.from(o2.impulses[0]!.ang)).toEqual([-4, -5, -6]);
    const matr = { tick: 240, snapshot: Uint8Array.of(1, 2, 3, 250), results: [packOut(out)], proxies: [{ tick: 236, n: 1, rec: Int32Array.of(-1, 2, -3) }] };
    const m2 = decodeMatrSection(encodeMatrSection(matr));
    expect(m2.tick).toBe(240);
    expect(Array.from(m2.snapshot)).toEqual([1, 2, 3, 250]);
    expect(Array.from(m2.results[0]!)).toEqual(Array.from(packOut(out)));
    expect(m2.proxies[0]!.tick).toBe(236);
    expect(Array.from(m2.proxies[0]!.rec)).toEqual([-1, 2, -3]);
  });
});
