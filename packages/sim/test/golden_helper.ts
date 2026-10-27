// Golden-machine runner shared by the M2 part goldens (stream A): runs a Library demo twice (asserting
// identical hash sequences) and offers event, path, spin and cause-chain queries on the first run.

import { expect } from 'vitest';
import type { PartId } from '@knockon/format';
import { DEMOS, type DemoMachine } from '../../parts-data/src/demos.ts';
import { Machine, type EventKind, type SimEvent } from '../src/index.ts';
import { angleAbout, jolt, pose, rotate, trace, type Trace } from './harness.ts';

/** Hinged parts whose arm spin is tracked, and the axis (0 X, 2 Z) it turns about. */
const SPIN_AXIS: Readonly<Record<string, 0 | 2>> = { cog: 2, fulcrum: 2, motor: 0, treadway: 2, dynamo: 0, turbine: 2, flap: 0, toggle: 2, gotcha_box: 2 };

export interface Golden {
  readonly demo: DemoMachine;
  readonly tr: Trace;
  readonly hash: string;
  ids(type: string): PartId[];
  id(type: string, n?: number): PartId;
  events(kind: EventKind, part?: PartId): SimEvent[];
  start(id: PartId): readonly [number, number, number];
  now(id: PartId): readonly [number, number, number];
  path(id: PartId): readonly (readonly [number, number, number])[];
  moved(id: PartId): number;
  maxY(id: PartId): number;
  spin(id: PartId): number;
  armAngle(id: PartId, axis: 0 | 2): number;
  up(id: PartId, axis: readonly [number, number, number]): [number, number, number];
  /** Kinds along an event's cause chain, newest first (the event itself included). */
  chain(e: SimEvent): EventKind[];
  /** Per-tick snapshots taken by `each` (part order), when the run asked for them. */
  readonly samples: readonly number[][];
}

export async function golden(key: string, each?: (m: Machine) => number[]): Promise<Golden> {
  const demo = DEMOS[key]!;
  const J = await jolt();
  const ids = (type: string): PartId[] => demo.parts.filter((p) => p.type === type).map((p) => p.id);
  const all = demo.parts.map((p) => p.id);
  const spins = demo.parts.filter((p) => SPIN_AXIS[p.type] !== undefined).map((p) => [p.id, SPIN_AXIS[p.type]!] as const);
  const samples: number[][] = [];
  const once = (record: boolean): { m: Machine; tr: Trace } => {
    const m = new Machine(J, demo);
    return { m, tr: trace(m, demo.ticks, { track: all, spin: spins, ...(record && each ? { each: (mm: Machine) => samples.push(each(mm)) } : {}) }) };
  };
  const a = once(true);
  const b = once(false);
  expect(b.tr.hashes).toEqual(a.tr.hashes);
  expect(b.tr.events.map((e) => `${e.id}:${e.kind}:${e.cause}`)).toEqual(a.tr.events.map((e) => `${e.id}:${e.kind}:${e.cause}`));
  b.m.destroy();
  const { m, tr } = a;
  const base = new Map(all.map((id) => [id, pose(m, id).q]));
  const arm = new Map(spins.map(([id]) => [id, pose(m, id, 'arm').q]));
  m.destroy();
  const byId = new Map(tr.events.map((e) => [e.id, e]));
  return {
    demo, tr, hash: tr.hashes.at(-1)!, ids, samples,
    id: (type, n = 0) => ids(type)[n]!,
    events: (kind, part) => tr.events.filter((e) => e.kind === kind && (part === undefined || e.part === part)),
    start: (id) => tr.path.get(id)![0]!,
    now: (id) => tr.path.get(id)!.at(-1)!,
    path: (id) => tr.path.get(id)!,
    moved: (id) => { const s = tr.path.get(id)![0]!, e = tr.path.get(id)!.at(-1)!; return Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]); },
    maxY: (id) => Math.max(...tr.path.get(id)!.map((p) => p[1])),
    spin: (id) => tr.spin.get(id)!,
    armAngle: (id, axis) => angleAbout(arm.get(id)!, axis),
    up: (id, axis) => rotate(base.get(id)!, axis),
    chain: (e) => {
      const out: EventKind[] = [];
      for (let x: SimEvent | undefined = e; x && out.length < 64; x = byId.get(x.cause)) out.push(x.kind);
      return out;
    },
  };
}

export const before = (a: SimEvent | undefined, b: SimEvent | undefined): void => {
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(a!.tick).toBeLessThanOrEqual(b!.tick);
};
