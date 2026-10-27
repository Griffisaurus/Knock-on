// M5 critter (stream B5): BUZZ the courier drone (GAME_SPEC §11, SIMULATION §7.3, critters.md BUZZ, D105) and the
// `PartFlag.Tagged` format flag. Contract data (tables appended, the spec, the box tumble hull, the pair colours), the
// golden demo and a full fetch with behaviour assertions, each behaviour (the scan picks the nearest tagged item ≤ 2 kg,
// "?" and land, the pad clear / not clear landings, flying home, obstacles, RIFT GATES, the TRAP BOX, the tumble and
// resume, two calls → two fetches), and replay / rollback across takeoff, grab, carry and tumble (rule 14: flight
// gravity and the ghost carry are re-derived after a restore). Goldens' final hashes are pinned; re-pin with
// `vitest -u` only for a change that explains them.

import { describe, expect, it } from 'vitest';
import { EMPTY_WORLD, PartFlag, decodeWorld, encodeWorld, makeId, moduleFromSelection, opFromWire, opToWire, snappedEuler, type PartId, type PartRecord } from '@knockon/format';
import {
  BEACON_PAIRS, BUZZ_BEACON, BUZZ_PAIRS, BUZZ_ROTORS, CRITTER_CLIPS, CRITTER_EMOTES, CRITTER_FSM, CRITTER_M5, CRITTER_SPECS,
  CRITTER_WINCH_SHIFT, CritterFlagBits, RIFT, partDef, type CritterFsm,
} from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { Machine, PartFlagBits, type EventKind, type MachineOptions, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose, trace } from './harness.ts';

const Z = CRITTER_M5.buzz;
const TPS = 120;
const fsm = (s: CritterFsm): number => CRITTER_FSM.indexOf(s);
const states = (ev: readonly SimEvent[], part: PartId): string[] => ev.filter((e) => e.kind === 'CritterState' && e.part === part).map((e) => CRITTER_FSM[e.mag]!);
const of = (ev: readonly SimEvent[], kind: EventKind, part?: PartId): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const emotes = (ev: readonly SimEvent[], part: PartId): string[] => of(ev, 'Emote', part).map((e) => CRITTER_EMOTES[e.mag]!);
const idx = (m: Machine, id: PartId): number => m.parts.findIndex((p) => p.id === id);
const cstate = (m: Machine, id: PartId): { clip: string; flags: number; emote: string; fsm: string } => {
  const b = m.critterState(new Uint8Array(m.parts.length * 4));
  const o = idx(m, id) * 4;
  return { clip: CRITTER_CLIPS[b[o]!]!, flags: b[o + 1]!, emote: CRITTER_EMOTES[b[o + 2]!]!, fsm: CRITTER_FSM[b[o + 3]!]! };
};
const finite = (m: Machine): boolean => m.transforms(new Float32Array(m.bodies.length * 7)).every((v) => Number.isFinite(v));
const baseBody = (m: Machine, id: PartId): ReturnType<Machine['bodies'][number]['body']['GetID']> => m.bodies[m.parts[idx(m, id)]!.base]!.body;
const gravityOf = (m: Machine, id: PartId): number => baseBody(m, id).GetMotionProperties().GetGravityFactor();
const layerOf = (m: Machine, id: PartId): number => baseBody(m, id).GetObjectLayer();
const hdist = (a: readonly number[], b: readonly number[]): number => Math.sqrt((a[0]! - b[0]!) ** 2 + (a[2]! - b[2]!) ** 2);

/** Sets PartFlag.Tagged on a part of a Build. */
function tag(b: Build, id: PartId): void {
  const i = b.parts.findIndex((p) => p.id === id);
  b.parts[i] = { ...b.parts[i]!, flags: b.parts[i]!.flags | PartFlag.Tagged } as PartRecord;
}

/** Anchors a part (PartFlag.Anchored: static). */
function anchor(b: Build, id: PartId): void {
  const i = b.parts.findIndex((p) => p.id === id);
  b.parts[i] = { ...b.parts[i]!, flags: b.parts[i]!.flags | PartFlag.Anchored } as PartRecord;
}

/** A beacon at the origin with BUZZ docked on it, and RINGERs calling it at `calls` seconds. */
function base(calls: readonly number[], o: { buzzAt?: readonly [number, number, number]; pair?: number } = {}): { b: Build; beacon: PartId; buzz: PartId } {
  const b = new Build();
  const beacon = b.add('buzz_beacon', 0, 0, 0, o.pair !== undefined ? { pair: o.pair } : {});
  const at = o.buzzAt ?? BUZZ_BEACON.dock;
  const buzz = b.add('buzz', at[0], at[1], at[2], o.pair !== undefined ? { pair: o.pair } : {});
  calls.forEach((s, i) => { const r = b.add('ringer', -1.2 - 0.2 * i, 0, -1.2, { time: s }); b.link('cable_signal', r, 'out', beacon, 'call'); });
  return { b, beacon, buzz };
}

/** Steps and collects events, with an optional hook every tick. */
function run(m: Machine, ticks: number, each?: (t: number) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) { m.step(); ev.push(...m.drainEvents()); each?.(t); }
  return ev;
}

// ---- contract data ------------------------------------------------------------------------------------------------

describe('BUZZ data (M5, append-only tables)', () => {
  it('tables: the M2 / M4 entries keep their indices; BUZZ’s entries are appended', () => {
    expect(CRITTER_FSM.indexOf('scan')).toBe(49);
    expect(CRITTER_CLIPS.indexOf('bump_turn')).toBe(52);
    expect(CRITTER_EMOTES.indexOf('bin_full')).toBe(30);
    expect(CRITTER_FSM.slice(50)).toEqual(['docked', 'takeoff', 'fly', 'grab', 'carry', 'drop_off', 'deliver_bow', 'land', 'landed']);
    expect(CRITTER_CLIPS.slice(53)).toEqual(['takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow']);
    expect(CRITTER_EMOTES.slice(31)).toEqual(['package', 'pin', 'check', 'clock']);
  });

  it('spec: 1.1 kg, tumbles over 3 N·s, payload 2 kg, winch 0–0.60 m; drone collider from critters.md; one rigid box hull', () => {
    const s = CRITTER_SPECS.buzz;
    expect([s.mass, s.ragdollJ, Z.payload, Z.winch]).toEqual([1.1, 3, 2, 0.6]);
    expect(s.drone!.ducts.at).toHaveLength(4);
    for (const at of s.drone!.ducts.at) expect([Math.abs(at[0]), at[1], Math.abs(at[2])]).toEqual([0.115, 0.066, 0.115]);
    expect(2 * s.drone!.ducts.radius).toBeCloseTo(0.11, 9);
    expect(s.ragdoll).toHaveLength(1);
    const r = s.ragdoll[0]!;
    expect([r.bone, r.shape, r.parent, r.swing, r.twist, r.mass]).toEqual(['RAG__body', 'box', -1, 0, 0, 1.1]);
    expect(r.halfExtents).toEqual([0.17, 0.045, 0.17]);
    expect(r.at).toEqual([0, 0.045, 0]);
    // its span is wider than a RIFT GATE's aperture, so it can never pass one (A5: wider bodies never transit)
    const span = s.drone!.ducts.at[0]![0] + s.drone!.ducts.radius;
    expect(span).toBeGreaterThan(RIFT.radius);
    for (const c of ['takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow', 'sleep', 'tumble'] as const) expect(s.clips).toContain(c);
  });

  it('part: ship M5, no ports, a pair colour prop over A5’s BEACON_PAIRS (default Ignition, as the beacon)', () => {
    const d = partDef('buzz')!;
    expect(d.ship).toBe('M5');
    expect(d.ports).toEqual([]);
    expect([...BUZZ_PAIRS]).toEqual([...BEACON_PAIRS]);
    expect(d.props.pair!.default).toBe(partDef('buzz_beacon')!.props.pair!.default);
    expect(BUZZ_PAIRS[d.props.pair!.default]).toBe('Ignition');
    expect(partDef('buzz_beacon')!.ports.map((p) => [p.name, p.channel, p.dir, p.at])).toEqual([['call', 'signal', 'in', BUZZ_BEACON.port]]);
  });

  it('PartFlag.Tagged is bit 9, survives the world file (and leaves the HAS_* wire bits alone)', () => {
    expect(PartFlag.Tagged).toBe(512);
    const parts: PartRecord[] = [
      { id: makeId(1, 1), type: 'stitch', pos: [0, 0, 0], rot: { tag: 0 }, flags: PartFlag.Tagged },
      { id: makeId(1, 2), type: 'boing', pos: [64, 0, 0], rot: { tag: 0 }, flags: PartFlag.Tagged | PartFlag.Locked, props: [[0, 1]] },
      { id: makeId(1, 3), type: 'thud', pos: [128, 0, 0], rot: { tag: 0 }, flags: PartFlag.Anchored, size: [4, 4, 4] },
    ];
    const back = decodeWorld(encodeWorld({ ...EMPTY_WORLD, parts }));
    expect(back.parts.map((p) => p.flags)).toEqual([PartFlag.Tagged, PartFlag.Tagged | PartFlag.Locked, PartFlag.Anchored]);
    expect(back.parts[1]!.props).toEqual([[0, 1]]);
    expect(back.parts[2]!.size).toEqual([4, 4, 4]);
    // the op that sets it (U5's toggle: PartUpdate flags), and a saved module keeps it (Locked doesn't travel)
    const op = { k: 'PartUpdate', id: parts[0]!.id, patch: { flags: PartFlag.Tagged | PartFlag.Hidden } } as const;
    expect(opFromWire(JSON.parse(JSON.stringify(opToWire(op))))).toEqual(op);
    const mod = moduleFromSelection(new Map(parts.map((p) => [p.id, p])), new Map(), [parts[1]!.id], { name: 'tagged', origin: [0, 0, 0] });
    expect(mod.parts[0]!.flags).toBe(PartFlag.Tagged);
  });

  it('run output: PartFlagBits.tagged on tagged parts (inert ones too), never on a critter; critterTargets names BUZZ’s item', async () => {
    const { b, buzz } = base([1]);
    const ball = b.add('boing', 1.2, 0.12, 0.6); tag(b, ball);
    const plain = b.add('stitch', -1, 0.0375, 0.5);
    tag(b, buzz);
    const m = new Machine(await jolt(), b);
    const f = m.partFlags(new Uint8Array(m.parts.length));
    expect(f[idx(m, ball)]! & PartFlagBits.tagged).toBe(PartFlagBits.tagged);
    expect(f[idx(m, plain)]! & PartFlagBits.tagged).toBe(0);
    expect(f[idx(m, buzz)]! & PartFlagBits.tagged).toBe(0);
    let seen = false;
    run(m, 8 * TPS, () => { const t = m.critterTargets(); if (t.length) { seen = true; expect([m.parts[t[0]!]!.id, m.parts[t[1]!]!.id]).toEqual([buzz, ball]); } });
    expect(seen).toBe(true);
    m.destroy();
  }, 30_000);
});

// ---- goldens ------------------------------------------------------------------------------------------------------

describe('golden machines (BUZZ)', () => {
  it('demo: a THUD on THE BUTTON calls BUZZ off its beacon: takeoff → sniff → fly toward the tagged STITCH', async () => {
    const demo = DEMOS.buzz!;
    const J = await jolt();
    const buzz = demo.parts.find((p) => p.type === 'buzz')!.id;
    const go = (): { m: Machine; ev: SimEvent[]; hashes: string[] } => { const m = new Machine(J, demo); const tr = trace(m, demo.ticks); return { m, ev: tr.events, hashes: tr.hashes }; };
    const a = go(), b = go();
    expect(b.hashes).toEqual(a.hashes);
    b.m.destroy();
    expect(states(a.ev, buzz).slice(0, 3)).toEqual(['takeoff', 'sniff', 'fly']);
    expect(emotes(a.ev, buzz)).toContain('package');
    const p = pose(a.m, buzz).p;
    expect(p[1]).toBeGreaterThan(0.3); // flying
    expect(p[0]).toBeGreaterThan(0.1); // toward the STITCH (+X, +Z)
    expect(gravityOf(a.m, buzz)).toBe(0);
    expect(finite(a.m)).toBe(true);
    expect(a.hashes.at(-1)).toMatchInlineSnapshot(`"dea90d0d968cad3f"`);
    a.m.destroy();
  }, 30_000);

  it('full fetch: docked → takeoff → sniff → fly → grab → carry → drop_off → deliver_bow → land beside (the item stays on the pad)', async () => {
    const { b, buzz } = base([1]);
    const item = b.add('boing', 1.5, 0.12, 1.0);
    tag(b, item);
    const J = await jolt();
    const m = new Machine(J, b);
    let carried = 0, winchMax = 0, ghost = -1;
    const ev = run(m, 22 * TPS, () => {
      const k = m.critterCarry();
      if (k.length) { carried++; expect(m.parts[k[1]!]!.id).toBe(item); ghost = layerOf(m, item); }
      winchMax = Math.max(winchMax, (cstate(m, buzz).flags >> CRITTER_WINCH_SHIFT) & 7);
    });
    expect(states(ev, buzz)).toEqual(['takeoff', 'sniff', 'fly', 'grab', 'carry', 'drop_off', 'deliver_bow', 'land', 'landed']);
    // the cascade chains RINGER → Signal → the beacon's Call (A5) → BUZZ's takeoff
    const call = of(ev, 'Call');
    expect(call).toHaveLength(1);
    expect(ev.find((e) => e.kind === 'CritterState' && e.part === buzz && e.mag === fsm('takeoff'))!.cause).toBe(call[0]!.id);
    const fetch = of(ev, 'Fetch', buzz), del = of(ev, 'Deliver', buzz);
    expect(fetch).toHaveLength(1);
    expect(fetch[0]!.other).toBe(item);
    expect(fetch[0]!.mag).toBeCloseTo(partDef('boing')!.body.mass, 5);
    expect(del).toHaveLength(1);
    expect(del[0]!.other).toBe(item);
    expect(del[0]!.mag).toBeLessThanOrEqual(Z.onTime);
    expect(emotes(ev, buzz)).toEqual(expect.arrayContaining(['!', 'package', 'pin', 'clock']));
    expect(carried).toBeGreaterThan(2 * TPS);
    expect(ghost).toBe(2); // the carried item rides on the ghost layer
    expect(winchMax).toBeGreaterThanOrEqual(3);
    // the item rests on the pad; BUZZ rests on the floor beside the beacon, rotors off
    const ip = pose(m, item).p, bp = pose(m, buzz).p;
    expect(hdist(ip, [0, 0, 0])).toBeLessThan(0.05);
    expect(ip[1]).toBeCloseTo(0.04 + 0.12, 2);
    expect(hdist(bp, [0, 0, 0])).toBeCloseTo(Z.beside, 1);
    expect(bp[1]).toBeLessThan(0.01);
    expect(cstate(m, buzz)).toMatchObject({ fsm: 'landed', clip: 'sleep' });
    expect(cstate(m, buzz).flags & BUZZ_ROTORS).toBe(0);
    expect(gravityOf(m, buzz)).toBe(1);
    expect(layerOf(m, item)).toBe(1);
    expect(m.hash()).toMatchInlineSnapshot(`"aaeb509178d19772"`);
    m.destroy();
  }, 60_000);
});

// ---- behaviours -----------------------------------------------------------------------------------------------------

describe('BUZZ', () => {
  it('scans for the nearest tagged item ≤ 2 kg: untagged, too heavy, tied and critter parts are skipped', async () => {
    const { b, buzz } = base([1]);
    const near = b.add('stitch', 0.9, 0.0375, 0.3);          // untagged: ignored
    const heavy = b.add('thud', 0.6, 0.11, -0.5); tag(b, heavy); // 7 kg: too heavy
    const mochi = b.add('mochi', -1.5, 0, 1.5); tag(b, mochi); // critters can't be tagged
    const far = b.add('stitch', -1.6, 0.0375, -0.9); tag(b, far);
    const mid = b.add('boing', 1.1, 0.12, 1.2); tag(b, mid);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 16 * TPS);
    const f = of(ev, 'Fetch', buzz);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]!.other).toBe(mid);
    for (const e of f) expect([near, heavy, mochi]).not.toContain(e.other);
    m.destroy();
  }, 60_000);

  it('nothing tagged: "?" and it lands back on its dock', async () => {
    const { b, buzz } = base([1]);
    b.add('stitch', 0.8, 0.0375, 0.3); // not tagged
    const m = new Machine(await jolt(), b);
    const ev = run(m, 8 * TPS);
    expect(states(ev, buzz)).toEqual(['takeoff', 'sniff', 'land', 'docked']);
    expect(emotes(ev, buzz)).toContain('?');
    expect(of(ev, 'Fetch')).toHaveLength(0);
    const p = pose(m, buzz).p;
    expect(hdist(p, [0, 0, 0])).toBeLessThan(0.05);
    expect(p[1]).toBeCloseTo(0.04, 2);
    expect(cstate(m, buzz).flags & CritterFlagBits.asleep).toBe(CritterFlagBits.asleep);
    m.destroy();
  }, 30_000);

  it('a delivered ball that rolls off the pad: BUZZ docks; one that stays: BUZZ lands beside and hops home once it’s taken away', async () => {
    const J = await jolt();
    // stays: a STITCH on the flat pad stays put → landed beside; then a poke knocks it off and BUZZ flies home and docks
    const s = base([1]);
    const item = s.b.add('stitch', 1.2, 0.0375, 0.6);
    tag(s.b, item);
    const m = new Machine(J, s.b);
    const ev = run(m, 20 * TPS);
    expect(states(ev, s.buzz).at(-1)).toBe('landed');
    m.addPoke({ tick: m.tick + 1, seq: 1, partId: item, kind: 'impulse', data: [0.25, 0.05, 0] });
    const ev2 = run(m, 10 * TPS);
    expect(states(ev2, s.buzz)).toEqual(['takeoff', 'fly', 'land', 'docked']);
    expect(hdist(pose(m, s.buzz).p, [0, 0, 0])).toBeLessThan(0.05);
    m.destroy();
  }, 60_000);

  it('placed away from its beacon it flies home and docks; with no beacon of its pair colour it stays landed', async () => {
    const J = await jolt();
    const a = base([], { buzzAt: [1.4, 0, -0.8] });
    const m = new Machine(J, a.b);
    expect(cstate(m, a.buzz).fsm).toBe('landed');
    const ev = run(m, 12 * TPS);
    expect(states(ev, a.buzz)).toEqual(['takeoff', 'fly', 'land', 'docked']);
    expect(hdist(pose(m, a.buzz).p, [0, 0, 0])).toBeLessThan(0.05);
    m.destroy();
    // pair colours: two beacons, two BUZZes; each docks on its own colour, and a third BUZZ has none left
    const b = new Build();
    const amber = b.add('buzz_beacon', -1, 0, 0, { pair: 2 });
    const cobalt = b.add('buzz_beacon', 1, 0, 0, { pair: 4 });
    const bz1 = b.add('buzz', 0.4, 0, 1, { pair: 4 });
    const bz2 = b.add('buzz', -0.4, 0, 1, { pair: 2 });
    const bz3 = b.add('buzz', 0, 0, -1.2, { pair: 2 });
    const m2 = new Machine(J, b);
    run(m2, 12 * TPS);
    expect(hdist(pose(m2, bz1).p, [1, 0, 0])).toBeLessThan(0.05);
    expect(hdist(pose(m2, bz2).p, [-1, 0, 0])).toBeLessThan(0.05);
    expect(cstate(m2, bz3).fsm).toBe('landed');
    expect(hdist(pose(m2, bz3).p, [0, 0, -1.2])).toBeLessThan(0.02);
    void amber; void cobalt;
    m2.destroy();
  }, 60_000);

  it('obstacle-safe: climbs over a wall across its path (taller than its cruise height), never tumbling', async () => {
    const { b, buzz } = base([1]);
    // a wall of anchored PLANKs, 1 m wide and 1.0 m tall, square across the path 0.9 m out
    const dir = [1.6 / Math.sqrt(1.6 ** 2 + 1.2 ** 2), 1.2 / Math.sqrt(1.6 ** 2 + 1.2 ** 2)] as const;
    const yaw = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI + 90;
    for (let i = 0; i < 10; i++) anchor(b, b.add('plank', 0.9 * dir[0], 0.05 + 0.1 * i, 0.9 * dir[1], {}, snappedEuler(yaw, 0, 0)));
    const item = b.add('stitch', 1.6, 0.0375, 1.2);
    tag(b, item);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 24 * TPS);
    expect(of(ev, 'Fetch', buzz)).toHaveLength(1);
    expect(of(ev, 'Deliver', buzz)).toHaveLength(1);
    expect(of(ev, 'Ragdoll', buzz)).toHaveLength(0);
    m.destroy();
  }, 60_000);

  it('tumbles (one rigid body) on a 4 N·s hit mid-carry, drops the item, gets up and finishes the job', async () => {
    const { b, buzz } = base([1]);
    const item = b.add('boing', 1.6, 0.12, 0.9);
    tag(b, item);
    const m = new Machine(await jolt(), b);
    let hit = -1;
    const ev = run(m, 40 * TPS, () => {
      if (hit < 0 && m.critterCarry().length && cstate(m, buzz).fsm === 'carry') {
        hit = m.tick;
        m.addPoke({ tick: m.tick + 1, seq: 1, partId: buzz, kind: 'impulse', data: [0, 1.5, 4] });
      }
    });
    expect(hit).toBeGreaterThan(0);
    const rag = of(ev, 'Ragdoll', buzz), up = of(ev, 'Getup', buzz);
    expect(rag).toHaveLength(1);
    expect(up).toHaveLength(1);
    expect(up[0]!.tick - rag[0]!.tick).toBeLessThanOrEqual(8 * TPS);
    const seq = states(ev, buzz);
    const after = seq.slice(seq.indexOf('ragdoll'));
    expect(after.slice(0, 4)).toEqual(['ragdoll', 'getup', 'dizzy', 'takeoff']);
    expect(after).toContain('grab');
    expect(of(ev, 'Fetch', buzz)).toHaveLength(2); // grabbed again
    expect(of(ev, 'Deliver', buzz)).toHaveLength(1);
    expect(hdist(pose(m, item).p, [0, 0, 0])).toBeLessThan(0.06);
    m.destroy();
  }, 60_000);

  it('two calls, two fetches (a call during a job waits its turn)', async () => {
    const { b, buzz } = base([1, 3]);
    const i1 = b.add('stitch', 1.0, 0.0375, 0.8); tag(b, i1);
    const i2 = b.add('stitch', -1.1, 0.0375, 0.9); tag(b, i2);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 40 * TPS);
    const d = of(ev, 'Deliver', buzz);
    expect(d.map((e) => e.other)).toEqual([i1, i2]);
    m.destroy();
  }, 90_000);

  it('a TRAP BOX dropped on it while landed holds it (trapped flag); it never leaves', async () => {
    const { b, buzz } = base([], { buzzAt: [1.0, 0, 0] });
    b.add('trap_box', 1.0, 0.02, 0);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 4 * TPS);
    expect(of(ev, 'Trapped', buzz).length).toBeGreaterThan(0);
    expect(cstate(m, buzz).flags & CritterFlagBits.trapped).toBe(CritterFlagBits.trapped);
    expect(hdist(pose(m, buzz).p, [1, 0, 0])).toBeLessThan(0.05);
    m.destroy();
  }, 30_000);

  it('never passes a RIFT GATE: a gate standing on its path doesn’t teleport it', async () => {
    const { b, buzz } = base([1]);
    const g1 = b.add('rift_gate', 0.8, 0, 0.5);
    b.add('rift_gate', -2.5, 0, -2.5);
    const item = b.add('stitch', 1.6, 0.0375, 1.0);
    tag(b, item);
    const m = new Machine(await jolt(), b);
    let last = pose(m, buzz).p, jump = 0;
    const ev = run(m, 24 * TPS, () => { const p = pose(m, buzz).p; jump = Math.max(jump, Math.sqrt((p[0] - last[0]) ** 2 + (p[1] - last[1]) ** 2 + (p[2] - last[2]) ** 2)); last = p; });
    expect(jump).toBeLessThan(0.1);
    expect(of(ev, 'Deliver', buzz)).toHaveLength(1);
    void g1;
    m.destroy();
  }, 60_000);
});

// ---- determinism ----------------------------------------------------------------------------------------------------

describe('BUZZ: replay, rollback, hashes', () => {
  /** A fetch with a tumble poke; late versions of its pokes roll back across takeoff, grab, carry and the tumble. */
  const world = (): { b: Build; buzz: PartId; item: PartId; i2: PartId; pokes: { tick: number; part: PartId; data: number[] }[] } => {
    const { b, buzz } = base([1, 9]);
    const item = b.add('boing', 1.4, 0.12, 0.9); tag(b, item);
    const i2 = b.add('stitch', -1.2, 0.0375, 0.7); tag(b, i2);
    b.add('mochi', 1.8, 0, -1.2);
    const pokes = [
      { tick: 150, part: item, data: [0, 0.2, 0] },        // during takeoff
      { tick: 700, part: item, data: [0.1, 0.1, 0] },      // around the grab
      { tick: 1000, part: buzz, data: [0, 1.5, 4.5] },     // mid-carry: a tumble
      { tick: 1900, part: i2, data: [0.05, 0.1, 0] },
    ];
    return { b, buzz, item, i2, pokes }; // BUZZ fetches the nearer STITCH (i2) first, then the BOING on the second call
  };

  it('replays identically and survives late-poke rollbacks across takeoff, grab, carry and a tumble', async () => {
    const J = await jolt();
    const { b, pokes, buzz } = world();
    const opts: MachineOptions = { checkpointEvery: 60, keepCheckpoints: 16 };
    const go = (late: number): string[] => {
      const m = new Machine(J, b, opts);
      pokes.forEach((p, i) => { if (i !== late) m.addPoke({ tick: p.tick, seq: i + 1, partId: p.part, kind: 'impulse', data: p.data }); });
      const h: string[] = [];
      const lp = late >= 0 ? pokes[late]! : null;
      while (m.tick < 3600) {
        m.step(); m.drainEvents();
        if (lp && m.tick === lp.tick + 90) {
          m.addPoke({ tick: lp.tick, seq: late + 1, partId: lp.part, kind: 'impulse', data: lp.data });
          const was = m.tick;
          const back = m.restore(lp.tick);
          expect(back).toBeGreaterThan(0);
          h.length = back / 60;
          while (m.tick < was) { m.step(); m.drainEvents(); if (m.tick % 60 === 0) h.push(m.hash()); }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      m.destroy();
      return h;
    };
    const a = go(-1);
    expect(go(-1)).toEqual(a);
    // the straight run has every BUZZ mechanism in it
    const m = new Machine(J, b, opts);
    pokes.forEach((p, i) => m.addPoke({ tick: p.tick, seq: i + 1, partId: p.part, kind: 'impulse', data: p.data }));
    const ev = run(m, 3600);
    m.destroy();
    for (const k of ['Fetch', 'Deliver', 'Ragdoll', 'Getup'] as const) expect(of(ev, k, buzz).length, k).toBeGreaterThan(0);
    for (const s of ['takeoff', 'grab', 'carry', 'drop_off'] as const) expect(ev.some((e) => e.kind === 'CritterState' && e.mag === fsm(s)), s).toBe(true);
    for (let late = 0; late < pokes.length; late++) expect(go(late), `late poke ${late}`).toEqual(a);
  }, 180_000);

  it('a restore re-derives flight gravity and the ghost carry (rule 14): back to docked, mid-carry, and mid-tumble', async () => {
    const J = await jolt();
    const { b, buzz, i2, pokes } = world();
    const m = new Machine(J, b, { checkpointEvery: 60, keepCheckpoints: 60 });
    m.addPoke({ tick: pokes[2]!.tick, seq: 1, partId: buzz, kind: 'impulse', data: pokes[2]!.data });
    const seen = new Map<number, { fsm: string; g: number; carry: boolean; layer: number }>();
    run(m, 1500, () => { if (m.tick % 60 === 0) seen.set(m.tick, { fsm: cstate(m, buzz).fsm, g: gravityOf(m, buzz), carry: m.critterCarry().length > 0, layer: layerOf(m, i2) }); });
    const pick = (f: (s: { fsm: string; carry: boolean }) => boolean): number => [...seen.entries()].find(([, s]) => f(s))![0];
    const tDock = 60, tCarry = pick((s) => s.fsm === 'carry' && s.carry), tRag = pick((s) => s.fsm === 'ragdoll');
    for (const t of [tCarry, tRag, tDock].sort((a, b) => b - a)) { // newest first: a restore drops the newer checkpoints
      expect(m.restore(t)).toBe(t);
      const want = seen.get(t)!;
      expect({ fsm: cstate(m, buzz).fsm, g: gravityOf(m, buzz), carry: m.critterCarry().length > 0, layer: layerOf(m, i2) }, `restored at ${t}`).toEqual(want);
    }
    expect(seen.get(tCarry)!.g).toBe(0);
    expect(seen.get(tCarry)!.layer).toBe(2);
    expect(seen.get(tDock)!.g).toBe(1);
    m.destroy();
  }, 60_000);

  it('the hash covers the tagged set (even with no BUZZ); part order doesn’t matter; a checkpoint transfers mid-carry', async () => {
    const J = await jolt();
    const h = (bb: Build, parts = bb.parts): string => { const m = new Machine(J, { parts, links: bb.links }); const out = trace(m, 240, { hashEvery: 120 }).hashes.at(-1)!; m.destroy(); return out; };
    const plain = new Build();
    const s1 = plain.add('stitch', 0.5, 0.0375, 0);
    const tagged = new Build();
    tagged.add('stitch', 0.5, 0.0375, 0); tag(tagged, tagged.parts[0]!.id);
    expect(h(tagged)).not.toBe(h(plain));
    void s1;
    const { b } = world();
    expect(h(b, [...b.parts].reverse())).toBe(h(b));
    const a = new Machine(J, b);
    run(a, 900);
    expect(a.critterCarry().length).toBe(2); // carrying
    const cp = a.exportCheckpoint(a.tick)!;
    const c = new Machine(J, b);
    c.importCheckpoint(cp.blob);
    while (c.tick < a.tick) { c.step(); c.drainEvents(); }
    for (let t = 0; t < 900; t++) { a.step(); a.drainEvents(); c.step(); c.drainEvents(); }
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 60_000);
});

// ---- RIFT GATES and the animal critters (future.md: the Ø 0.31 aperture passes MOCHI, PIP, GOBY, BANDIT, HENNY, BISCUIT) ----

describe('RIFT GATES and critters (B5 hook in A5’s m5_rift.ts)', () => {
  /** Gate A at the origin facing +Z, its partner at (2.5, 0, 2) facing +X. */
  const gates = (b: Build): [PartId, PartId] => [b.add('rift_gate', 0, 0, 0), b.add('rift_gate', 2.5, 0, 2.0, {}, snappedEuler(90, 0, 0))];
  const teleports = (ev: readonly SimEvent[], part: PartId): SimEvent[] => of(ev, 'Teleport').filter((e) => e.other === part);

  it('MOCHI chasing PIP walks into gate A and comes out of gate B, upright, still after him (PIP is too low to pass)', async () => {
    const b = new Build();
    const [ga, gb] = gates(b);
    const mochi = b.add('mochi', 0, 0, 1.4, {}, snappedEuler(180, 0, 0));
    const pip = b.add('pip', 0, 0, -1.2);
    const m = new Machine(await jolt(), b);
    let before: readonly number[] = [], after: readonly number[] = [];
    const ev = run(m, 8 * TPS, () => { const p = pose(m, mochi).p; if (!after.length && before.length && Math.abs(p[0] - before[0]!) > 1) after = p; if (!after.length) before = p; });
    const tp = teleports(ev, mochi);
    expect(tp).toHaveLength(1);
    expect(tp[0]!.part).toBe(ga);
    expect(of(ev, 'Emerge').find((e) => e.other === mochi)!.part).toBe(gb);
    expect(teleports(ev, pip)).toHaveLength(0);
    // she arrives in front of gate B (its front faces +X), just out of the ring
    expect(after[0]!).toBeGreaterThan(2.55);
    expect(Math.abs(after[2]! - 2.0)).toBeLessThan(0.1);
    const q = pose(m, mochi).q;
    expect(Math.abs(q[0]) + Math.abs(q[2])).toBeLessThan(1e-3); // still upright
    expect(states(ev, mochi).filter((s) => s === 'stalk' || s === 'chase').length).toBeGreaterThan(0);
    expect(of(ev, 'Ragdoll', mochi)).toHaveLength(0);
    m.destroy();
  }, 30_000);

  it('a tumbling HENNY thrown into gate A comes out of gate B as one ragdoll (every capsule), then gets up there', async () => {
    const b = new Build();
    const [, gb] = gates(b);
    const henny = b.add('henny', 0, 0, 0.9, {}, snappedEuler(180, 0, 0));
    const rags = (m: Machine): number[] => m.bodyInfo().flatMap((x, i) => (x.part === henny && x.role === 'rag' ? [i] : []));
    let spread = 0;
    const m2 = new Machine(await jolt(), b);
    m2.addPoke({ tick: 10, seq: 1, partId: henny, kind: 'impulse', data: [0, 0.48, -6.4] });
    const ev2 = run(m2, 6 * TPS, () => {
      const at = rags(m2).map((ri) => { const p = m2.bodies[ri]!.body.GetPosition(); return [p.GetX(), p.GetY(), p.GetZ()]; });
      for (const a of at) for (const c of at) spread = Math.max(spread, Math.sqrt((a[0]! - c[0]!) ** 2 + (a[1]! - c[1]!) ** 2 + (a[2]! - c[2]!) ** 2));
    });
    const rag = of(ev2, 'Ragdoll', henny), tp = teleports(ev2, henny), up = of(ev2, 'Getup', henny);
    expect(rag).toHaveLength(1);
    expect(tp).toHaveLength(1);
    expect(tp[0]!.tick).toBeGreaterThan(rag[0]!.tick);
    expect(up).toHaveLength(1);
    expect(up[0]!.tick).toBeGreaterThan(tp[0]!.tick);
    expect(spread).toBeLessThan(0.6); // the capsules stayed together through the transit
    expect(hdist(up[0]!.pos, pose(m2, gb).p)).toBeLessThan(1.5);
    expect(hdist(pose(m2, henny).p, [0, 0, 0])).toBeGreaterThan(1.5);
    m2.destroy();
  }, 30_000);

  it('robots never transit: DUSTY’s disc and BUZZ’s ducts are wider than the aperture', () => {
    expect(CRITTER_SPECS.dusty.disc!.radius).toBeGreaterThan(RIFT.radius);
    for (const sp of ['mochi', 'pip', 'goby', 'bandit', 'henny', 'biscuit'] as const) expect(CRITTER_SPECS[sp].capsule.radius * 2, sp).toBeLessThanOrEqual(0.22 + 1e-9);
  });

  it('BISCUIT chasing MOCHI through the pair replays and survives a late-poke rollback across the transit', async () => {
    const J = await jolt();
    const b = new Build();
    gates(b);
    const biscuit = b.add('biscuit', 0, 0, 1.2, {}, snappedEuler(180, 0, 0));
    const mochi = b.add('mochi', 0, 0, -1.0);
    b.add('thud', 0.4, 0.4, 1.2); // wakes him
    const ball = b.add('boing', 1.5, 0.12, -1.5);
    const opts: MachineOptions = { checkpointEvery: 60, keepCheckpoints: 16 };
    const poke = { tick: 120, part: ball, data: [0.2, 0.1, 0] };
    const go = (late: boolean): { h: string[]; ev: SimEvent[] } => {
      const m = new Machine(J, b, opts);
      if (!late) m.addPoke({ tick: poke.tick, seq: 1, partId: poke.part, kind: 'impulse', data: poke.data });
      const h: string[] = [], ev: SimEvent[] = [];
      let done = !late;
      while (m.tick < 6 * TPS) {
        m.step(); ev.push(...m.drainEvents());
        if (!done && m.tick === 300) { // after the transit (≈ tick 190): roll back across it
          done = true;
          m.addPoke({ tick: poke.tick, seq: 1, partId: poke.part, kind: 'impulse', data: poke.data });
          const was = m.tick, back = m.restore(poke.tick);
          expect(back).toBeLessThanOrEqual(poke.tick);
          h.length = back / 60;
          while (m.tick < was) { m.step(); m.drainEvents(); if (m.tick % 60 === 0) h.push(m.hash()); }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      m.destroy();
      return { h, ev };
    };
    const a = go(false);
    expect(go(false).h).toEqual(a.h);
    const tp = teleports(a.ev, biscuit);
    expect(tp.length).toBeGreaterThan(0);
    expect(tp[0]!.tick).toBeGreaterThan(poke.tick);
    expect(tp[0]!.tick).toBeLessThan(300);
    void mochi;
    expect(go(true).h).toEqual(a.h);
  }, 60_000);
});
