// Matter hooks of the M2 parts MI owns (M4_PLAN: FISHBOWL, SCOOP; FUZZ floats on its own): containers and intakes on
// machine.matter. Everything here runs inside the Matter host's stage-13 step, before the command is built, and keeps
// its state in st.matter (the containers), so rollback needs nothing extra. With Matter off none of it runs and the
// parts keep their M2 behaviour (FISHBOWL: the cosmetic splash; SCOOP: an empty bucket).

import { dcos, dsin } from '@knockon/detmath';
import { KITCHEN } from '@knockon/parts-data';
import { qrot } from '../vec.ts';
import type { MatterHost, MatterMachine } from './host.ts';

/** contraptions.md FISHBOWL: 11.7 L of water (EMIT__burst__water), burst at 1.2 m/s, top intake, overflow lip. */
export const FISHBOWL = {
  capacityMl: 11700,
  burstSpeed: 1.2,
  /** The bowl's centre above its origin (the glass sphere is 0.3 m across, origin at the cradle's foot). */
  centre: [0, 0.15, 0] as const,
  /** Top intake: the mouth (water poured in from above), part space. */
  mouth: { min: [-0.07, 0.27, -0.07], max: [0.07, 0.34, 0.07] } as const,
  /** Overflow lip: just outside the rim. */
  lip: [0.12, 0.29, 0] as const,
  overflowPerTick: 400,
} as const;

/** SCOOP (frame.md): a 0.15 × 0.18 × 0.15 m bucket, ≈ 3.5 L; tipped past 70° it pours. */
export const SCOOP = {
  capacityMl: 3500,
  inside: { min: [-0.07, 0.014, -0.07], max: [0.07, 0.17, 0.07] } as const,
  rim: [0, 0.19, 0] as const,
  pourPerTick: 120,
  tippedUp: 0.34, // cos 70°
} as const;

const BURST_DIRS = 8;

/**
 * D98 "Fill the sink": the Mega Kitchen basin (its `sink_floor` collider: 4 × 2 m, 1.1 m deep) filled with water from
 * the start, as cubes of 12 × 12 × 12 particles on MX's water lattice (655 units ≈ 1 cm) tiled over the floor, layer by
 * layer, never above y 4.2 (environments.md §2.4), at most `blocksPerTick` blocks per even rigid tick (1M particles:
 * 579 blocks, 10 Matter ticks), identically on every machine. Returns the block list [x, y, z, count] … (metres).
 */
/** depth: the fill line (Z 4.2 m in set coordinates) above the basin floor (3.5 m): 0.7 m. */
export const SINK = { spacing: 655 / 65536, side: 12, margin: 0.02, depth: 0.7, blocksPerTick: 64 } as const;

export function sinkPlan(preset: string | undefined, total: number): number[] {
  const set = preset === 'warehouse' ? KITCHEN.presets.warehouse : KITCHEN.presets.room;
  const floor = set.boxes.find((b) => b.name === 'sink_floor');
  if (!floor || total <= 0) return [];
  const edge = SINK.side * SINK.spacing;
  const x0 = floor.center[0] - floor.half[0] + SINK.margin, x1 = floor.center[0] + floor.half[0] - SINK.margin;
  const z0 = floor.center[2] - floor.half[2] + SINK.margin, z1 = floor.center[2] + floor.half[2] - SINK.margin;
  const y0 = floor.center[1] + floor.half[1] + 0.006; // just above the steel
  const nx = Math.floor((x1 - x0) / edge), nz = Math.floor((z1 - z0) / edge);
  const px = (x1 - x0) / nx, pz = (z1 - z0) / nz; // spare room spread between the blocks
  const per = SINK.side ** 3;
  const out: number[] = [];
  let left = total;
  for (let layer = 0; left > 0; layer++) {
    const cy = y0 + edge * (layer + 0.5);
    if (cy + edge / 2 > y0 + SINK.depth) break; // never above the fill line
    for (let iz = 0; iz < nz && left > 0; iz++) for (let ix = 0; ix < nx && left > 0; ix++) {
      const n = Math.min(per, left);
      out.push(x0 + px * (ix + 0.5), cy, z0 + pz * (iz + 0.5), n);
      left -= n;
    }
  }
  return out;
}

export class MatterParts {
  private bowls: number[] = [];
  private sink: number[] = [];
  private scoops: number[] = [];

  private readonly host: MatterHost;
  private readonly m: MatterMachine;
  constructor(host: MatterHost, m: MatterMachine) { this.host = host; this.m = m; }

  init(): void {
    const { host, m } = this;
    this.sink = sinkPlan(host.env.preset, host.sinkFill);
    m.parts.forEach((p, i) => {
      if (p.def.type === 'fishbowl' && p.base >= 0 && m.bodies[p.base]!.dynamic) {
        host.container(i, FISHBOWL.capacityMl, 1, FISHBOWL.capacityMl);
        host.intake(i, FISHBOWL.mouth, 0b1111, -1, true); // every kind, goo too (X5)
        this.bowls.push(i);
      } else if (p.def.type === 'scoop' && p.base >= 0) {
        host.container(i, SCOOP.capacityMl, 1, 0);
        host.intake(i, SCOOP.inside, 0b1111, 0, true);
        this.scoops.push(i);
      }
    });
  }

  /** Every tick, before the Matter command: bowl bursts and overflow, scoops pouring. */
  step(t: number): void {
    const { host, m } = this;
    // the Kitchen sink fills over the first even ticks (st.matter.sink = blocks emitted, so rollback replays it exactly)
    const st = m.st.matter!;
    if (st.sink * 4 < this.sink.length && t % 2 === 0) {
      for (let k = 0; k < SINK.blocksPerTick && st.sink * 4 < this.sink.length; k++, st.sink++) {
        const o = st.sink * 4;
        host.emitWorld(-1, 1, this.sink[o + 3]!, [this.sink[o]!, this.sink[o + 1]!, this.sink[o + 2]!], [0, 0, 0], 0);
      }
    }
    for (const i of this.bowls) {
      if (!m.st.alive[i]) continue;
      if (m.st.broken[i]) { if (host.stored(i) > 0) this.burst(i); continue; }
      // full bowl: what the mouth took in beyond 11.7 L spills over the lip
      const over = Math.floor(host.stored(i) - host.capacityMl(i));
      if (over > 0) {
        const n = host.take(i, 1, Math.min(over, FISHBOWL.overflowPerTick));
        const a = (t % 16) * (Math.PI / 8);
        const lip = [FISHBOWL.lip[0] * dcos(a), FISHBOWL.lip[1], FISHBOWL.lip[0] * dsin(a)];
        if (n > 0) host.emit(i, 1, n, lip, [0.25 * dcos(a), 0, 0.25 * dsin(a)], 0.05);
      }
    }
    for (const i of this.scoops) {
      if (!m.st.alive[i] || host.stored(i) <= 0) continue;
      const b = m.bodies[m.parts[i]!.base]!.body;
      const r = b.GetRotation();
      const up = qrot([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], [0, 1, 0]);
      if (up[1] > SCOOP.tippedUp) continue;
      // tipped: pour out of the rim, kinds in order, a few per tick
      let left = SCOOP.pourPerTick;
      for (const kind of [1, 0, 2, 3] as const) {
        if (left <= 0) break;
        const n = host.take(i, kind, Math.min(left, host.stored(i, kind)));
        if (n > 0) host.emit(i, kind, n, SCOOP.rim, [0, 0.3, 0], 0.08);
        left -= n;
      }
    }
  }

  /** EMIT__burst__water: everything in the bowl, in eight blocks flying out at 1.2 m/s (and a little up). */
  private burst(i: number): void {
    const { host } = this;
    for (const kind of [1, 0, 2, 3] as const) {
      const total = host.take(i, kind, host.stored(i, kind));
      if (total <= 0) continue;
      for (let k = 0; k < BURST_DIRS; k++) {
        const n = Math.floor(total / BURST_DIRS) + (k < total % BURST_DIRS ? 1 : 0);
        if (n <= 0) continue;
        const a = (k * 2 * Math.PI) / BURST_DIRS;
        const c = dcos(a), sn = dsin(a);
        const at = [FISHBOWL.centre[0] + 0.09 * c, FISHBOWL.centre[1], FISHBOWL.centre[2] + 0.09 * sn];
        host.emit(i, kind, n, at, [FISHBOWL.burstSpeed * c, 0.4, FISHBOWL.burstSpeed * sn], 0.25);
      }
    }
  }
}
