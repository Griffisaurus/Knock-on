// Headless sim harness for part tests (PART_SYSTEM §8): load Jolt once, run a machine, read bodies.

import { makeId, metresToPos, snappedEuler, type LinkKind, type LinkRecord, type PartRecord, type Rotation } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { partDef, propSteps } from '@knockon/parts-data';
import { Machine, type SimEvent } from '../src/index.ts';

/** Tiny machine builder (positions in metres, props as values). */
export class Build {
  readonly parts: PartRecord[] = [];
  readonly links: LinkRecord[] = [];
  private n = 0;
  add(type: string, x: number, y: number, z: number, props: Readonly<Record<string, number>> = {}, rot: Rotation = snappedEuler(0, 0, 0)): number {
    const def = partDef(type)!;
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v)).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot, flags: 0, ...(list.length ? { props: list } : {}) });
    return id;
  }
  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number {
    const port = (id: number, name: string): number => partDef(this.parts.find((p) => p.id === id)!.type)!.ports.findIndex((x) => x.name === name);
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: { part: from, port: port(from, fromPort) }, to: { part: to, port: port(to, toPort) }, via: [], points: [], length: 0 });
    return id;
  }
}

let J: JoltModule;
// (J4: KNOCKON_JOLT_THREADS=N makes this the multithreaded build with N workers; packages/jolt load.ts)
export const jolt = async (): Promise<JoltModule> => (J ??= await loadJolt('single'));

export interface Pose { readonly p: readonly [number, number, number]; readonly q: readonly [number, number, number, number] }

/** Pose of one body of a part (`role` 'arm' for hinged parts' moving body). */
export function pose(m: Machine, id: number, role: 'base' | 'arm' = 'base'): Pose {
  const info = m.bodyInfo();
  const i = info.findIndex((b) => b.part === id && b.role === role);
  if (i < 0) throw new Error(`no ${role} body for part ${id}`);
  const t = m.transforms(new Float32Array(info.length * 7));
  const o = i * 7;
  return { p: [t[o]!, t[o + 1]!, t[o + 2]!], q: [t[o + 3]!, t[o + 4]!, t[o + 5]!, t[o + 6]!] };
}

/** Rotates a vector by a unit quaternion [x, y, z, w]. */
export function rotate(q: Pose['q'], v: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Signed rotation (radians) of a quaternion about a principal axis, for single-axis hinges. */
export function angleAbout(q: Pose['q'], axis: 0 | 1 | 2): number {
  return 2 * Math.atan2(q[axis], q[3]);
}

const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export interface Trace {
  readonly events: SimEvent[];
  /** Hash every `hashEvery` ticks (and at the end). */
  readonly hashes: string[];
  /** Per tracked part: position each tick. */
  readonly path: Map<number, [number, number, number][]>;
  /** Per tracked hinged part: accumulated arm rotation about its axis (radians, unwrapped). */
  readonly spin: Map<number, number>;
}

export interface RunOptions {
  readonly hashEvery?: number;
  /** Parts whose base body position is recorded each tick. */
  readonly track?: readonly number[];
  /** Hinged parts whose arm rotation about `axis` is accumulated: [partId, axis]. */
  readonly spin?: readonly (readonly [number, 0 | 1 | 2])[];
  /** Called after every tick. */
  readonly each?: (m: Machine) => void;
}

/** Steps `ticks` times, collecting events, periodic hashes and the requested traces. */
export function trace(m: Machine, ticks: number, o: RunOptions = {}): Trace {
  const every = o.hashEvery ?? 30;
  const events: SimEvent[] = [], hashes: string[] = [];
  const path = new Map<number, [number, number, number][]>();
  const spin = new Map<number, number>();
  const last = new Map<number, number>();
  for (const id of o.track ?? []) path.set(id, [[...pose(m, id).p]]);
  for (const [id, ax] of o.spin ?? []) { spin.set(id, 0); last.set(id, angleAbout(pose(m, id, 'arm').q, ax)); }
  for (let t = 1; t <= ticks; t++) {
    m.step();
    events.push(...m.drainEvents());
    for (const id of o.track ?? []) path.get(id)!.push([...pose(m, id).p]);
    for (const [id, ax] of o.spin ?? []) {
      const a = angleAbout(pose(m, id, 'arm').q, ax);
      spin.set(id, spin.get(id)! + wrap(a - last.get(id)!));
      last.set(id, a);
    }
    o.each?.(m);
    if (t % every === 0 || t === ticks) hashes.push(m.hash());
  }
  return { events, hashes, path, spin };
}
