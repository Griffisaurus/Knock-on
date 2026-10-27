// The world's Matter budget (DATA_FORMATS §2.1 counts.grains, SIMULATION §8.1 / §10.5): grains are conserved (they only
// leave a store at a spout and go back into one through an intake), so the most that can ever be alive is what every
// Matter part holds at the start. It's computed from the doc alone, so every client gets the same number: it sizes the
// backend (a property of the machine, never of the device: backend.ts) and sets `requiredTier`.

import { SINK_FILL_PARTICLES, sinkFilled, type PartRecord } from '@knockon/format';
import { partDef, propValues, type Props } from '@knockon/parts-data';
import { FISHBOWL } from './parts.ts';

/** Starting grains of a part (0 for parts that aren't Matter stores). A def may carry its own `matterGrains(props)`. */
export function partGrains(type: string, props: Props): number {
  const def = partDef(type) as (ReturnType<typeof partDef> & { matterGrains?: (p: Props) => number }) | undefined;
  if (def?.matterGrains) return Math.max(0, Math.floor(def.matterGrains(props)));
  const start = (props.start ?? 100) / 100;
  switch (type) {
    case 'fishbowl': return FISHBOWL.capacityMl;
    // A4's stores (defs_m4.ts), until their defs carry matterGrains
    case 'grit_hopper': return Math.round((props.capacity ?? 200000) * start);
    case 'tank': return Math.round(15000 * start);
    case 'marble_hopper': return Math.round((props.capacity ?? 2000) * start);
    case 'sprinkle_can': return Math.round(2000 * start);
    case 'sponge': return Math.round(2000 * ((props.start ?? 0) / 100));
    default: return 0;
  }
}

/** Grains a world can ever have alive: every store's starting load, plus the environment's own water (D98's Kitchen sink). */
export function matterGrains(parts: readonly PartRecord[], env?: { readonly environment?: string; readonly sinkFill?: boolean }): number {
  let n = 0;
  for (const p of parts) {
    const def = partDef(p.type);
    if (!def) continue;
    const g = partGrains(p.type, p.props?.length ? propValues(def, p.props) : propValues(def, undefined));
    n += g;
  }
  return n + (sinkFilled(env) ? SINK_FILL_PARTICLES : 0);
}

/** The backend's particle capacity for a budget: a little headroom, rounded up to 4,096. */
export function matterCapacity(grains: number): number {
  return Math.max(4096, Math.ceil((grains + 1024) / 4096) * 4096);
}
