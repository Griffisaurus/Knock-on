// "Sandstorm" (GAME_SPEC §13, M4 exit): sand avalanching through a WATERWHEEL valley, as a full rigid + Matter world.
// A pure function of its arguments, like the bench scenes, so the Node proof, the bench harness and the in-game demo
// run identical machines. MX's Matter-only Sandstorm scene (the D91 vendor matrix) is separate.
//
// Layout (metres, +Y up): a row of WATERWHEELs across a valley floor walled by 35° SLOPEs; over each wheel a GRIT HOPPER,
// open at start, pours onto the buckets' descending side, so they fill and the wheel turns, and the heaps building up
// underneath avalanche back off the walls. Each wheel drives a COG by a BAND so the turning reads from far away. Full
// scale is 4 hoppers × 1M grains (the 16 GB tier's 4M); the Node proof runs one hopper with a few thousand.

import { makeId, metresToPos, snappedEuler, type LinkRecord, type PartRecord, type Rotation } from '@knockon/format';
import { partDef, propSteps } from '@knockon/parts-data';

export interface SandstormOptions {
  /** GRIT HOPPERs (and wheels) across the valley. Full scale: 4. */
  readonly hoppers?: number;
  /** Grains per hopper (its capacity × start; 50k–1M in steps of 50k, then `start` % of it). Full scale: 1,000,000. */
  readonly capacity?: number;
  /** Percent full at start (steps of 5). Full scale: 100. */
  readonly start?: number;
  /** Pour rate, grains per second per hopper (1k–50k). Full scale: 50,000. */
  readonly rate?: number;
}

export interface SandstormWorld {
  readonly parts: PartRecord[];
  readonly links: LinkRecord[];
  /** Part ids of the wheels (tests watch them turn) and hoppers. */
  readonly wheels: number[];
  readonly hoppers: number[];
  /** The Matter-active region (MatterOptions.region): the whole valley. */
  readonly region: { readonly min: readonly number[]; readonly max: readonly number[] };
  /** Grains in the world (counts.grains). */
  readonly grains: number;
}

export function sandstorm(o: SandstormOptions = {}): SandstormWorld {
  const n = o.hoppers ?? 4, capacity = o.capacity ?? 1_000_000, start = o.start ?? 100, rate = o.rate ?? 50_000;
  const parts: PartRecord[] = [], links: LinkRecord[] = [];
  let k = 0;
  const add = (type: string, x: number, y: number, z: number, rot: Rotation = { tag: 0 }, props: Readonly<Record<string, number>> = {}): number => {
    const def = partDef(type);
    if (!def) throw new Error(`sandstorm: unknown part ${type}`);
    const id = makeId(1, ++k);
    const list = Object.entries(props).map(([key, v]) => propSteps(def, key, v)).sort((a, b) => a[0] - b[0]);
    parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot, flags: 0, ...(list.length ? { props: list } : {}) });
    return id;
  };
  const link = (kind: LinkRecord['kind'], from: number, fromPort: string, to: number, toPort: string): void => {
    const port = (id: number, name: string): number => partDef(parts.find((p) => p.id === id)!.type)!.ports.findIndex((x) => x.name === name);
    links.push({ id: makeId(1, ++k), kind, from: { part: from, port: port(from, fromPort) }, to: { part: to, port: port(to, toPort) }, via: [], points: [], length: 0 });
  };
  const wheels: number[] = [], hoppers: number[] = [];
  const pitch = 0.5; // m between lanes (z)
  // the wheels stand on 0.3 m plinths' worth of air: with their hubs at 0.2 m the buckets swept the floor, and the
  // heap building up under them jammed them (measured with MX's kernels of 2026-10-24 23:29)
  const HUB = 0.5;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * pitch;
    // the wheel: hub HUB up, buckets reach HUB + 0.195
    const wheel = add('waterwheel', 0, HUB, z);
    wheels.push(wheel);
    // the hopper pours onto the wheel's descending (+X) side from 0.2 m above the buckets (measured: a 0.2 m-wide SLOPE
    // chute spilled most of the stream over its sides before it reached the wheel, so the sand falls straight in)
    hoppers.push(add('grit_hopper', 0.1, HUB + 0.35, z, { tag: 0 }, { capacity, start, rate, open: 1 }));
    // a COG on a BAND from the wheel's axle, so its turning reads from across the valley
    const cog = add('cog', 0, HUB, z + 0.16);
    link('band', wheel, 'axle', cog, 'axle');
  }
  const half = (n * pitch) / 2;
  // the valley: 35° SLOPE walls along both sides (yawed to face the lanes), so the heaps that build up under the wheels
  // avalanche back into the lanes
  for (const side of [-1, 1]) {
    for (let x = -0.6; x <= 0.61; x += 0.2) add('slope', x, 0, side * (half + 0.3), snappedEuler(side > 0 ? 90 : -90, 0, 0), { angle: 35 });
  }
  const grains = n * Math.round(capacity * (start / 100));
  return {
    parts, links, wheels, hoppers, grains,
    region: { min: [-0.9, -0.1, -half - 0.6], max: [0.9, 1.1, half + 0.6] },
  };
}
