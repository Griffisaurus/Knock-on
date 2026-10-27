// Which parts the fill pass draws this frame, and how (M4 contract 3, stream R4). main.ts calls `items()` once per
// frame with the world's parts, their poses and `fill(part)` from the keyframes (run.ts `fill`, × 255 in partIds
// order, empty while Matter is off). The profile follows the quantity: granular contents that are draining show a
// crater, ones that are filling a pile (matter.md); the HOURGLASS stream shows while its fill moves.

import type { V3 } from '../../math.ts';
import { DEFAULT_FILL } from './fill.ts';
import type { FillItem, FillProfile } from './types.ts';

/** Parts with `CAVITY__` contents (ASSET_PIPELINE §3.10's list, minus SCOOP: its contents are parts); GOO VAT from M5 (X5). */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set(['grit_hopper', 'hourglass', 'tank', 'sprinkle_can', 'marble_hopper', 'fishbowl', 'jitterjuice', 'goo_vat']);
const GRANULAR: ReadonlySet<string> = new Set(['grit_hopper', 'hourglass', 'marble_hopper']);

type Pose = { pos: V3; rot: readonly [number, number, number, number] };

interface Track { fill: number; trend: number; at: number }

export class ContainerFills {
  private readonly track = new Map<number, Track>();

  /**
   * @param parts   the world's parts (id, type, props)
   * @param poseOf  part pose (run: the base body; build: the doc) and the pivot body ('arm') when it has one
   * @param fillOf  the stored quantity 0–1 from the keyframes, or null when the sim doesn't report one (build mode)
   * @param broken  true when the part is broken (FISHBOWL shattered: no contents)
   */
  items(parts: Iterable<{ id: number; type: string; props?: Readonly<Record<string, unknown>> }>, poseOf: (id: number, role: 'base' | 'arm') => Pose | null,
    fillOf: (id: number) => number | null, broken: (id: number) => boolean, now = performance.now()): FillItem[] {
    const out: FillItem[] = [];
    const seen = new Set<number>();
    for (const p of parts) {
      if (!CONTAINER_TYPES.has(p.type) || broken(p.id)) continue;
      const pose = poseOf(p.id, 'base');
      if (!pose) continue;
      seen.add(p.id);
      const sim = fillOf(p.id);
      const prop = typeof p.props?.['fill'] === 'number' ? (p.props['fill'] as number) : null;
      const fill = Math.max(0, Math.min(1, sim ?? prop ?? DEFAULT_FILL[p.type] ?? 1));
      // trend: a moving average of the fill's direction, held for 0.6 s after it stops
      let t = this.track.get(p.id);
      if (!t) { t = { fill, trend: 0, at: now }; this.track.set(p.id, t); }
      const d = fill - t.fill;
      if (Math.abs(d) > 1e-5) { t.trend = Math.sign(d); t.at = now; }
      else if (now - t.at > 600) t.trend = 0;
      t.fill = fill;
      let profile: FillProfile = 'flat';
      if (GRANULAR.has(p.type) && p.type !== 'hourglass') profile = t.trend < 0 ? 'crater' : t.trend > 0 ? 'pile' : 'flat';
      if (p.type === 'hourglass') profile = 'flat'; // two cavities: top drains, bottom fills (FillPass gives each its own)
      const arm = poseOf(p.id, 'arm');
      out.push({
        type: p.type, pos: pose.pos, rot: pose.rot, fill, profile,
        flowing: p.type === 'hourglass' ? t.trend !== 0 : t.trend < 0,
        ...(arm ? { pivotPose: arm } : {}),
      });
    }
    for (const id of this.track.keys()) if (!seen.has(id)) this.track.delete(id);
    return out;
  }
}
