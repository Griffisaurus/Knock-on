// Matter indicators (M4 stream U4; GAME_SPEC §5 "Capacity never changes outcomes", §15.2 grains per tier).
// In Build, the world card shows how many Matter particles the machine will hold (every container's
// capacity × how full it starts, as the sim's matterInit does: stream A4, packages/sim/src/channels/m4_matter.ts)
// against the session tier's grain budget (format TIER_CAPS / tierGrains, stream MI). Over budget it says
// which tier the machine needs, the same words as the run refusal. During a run the live count is used
// when the run controller carries one (`matterCounts`, per kind: sand, water, marble).

import { requiredTier, tierGrains, type PartRecord } from '@knockon/format';
import { propValues, SPONGE, SPRINKLE, TANK } from '@knockon/parts-data';
import { partDef } from '../catalog.ts';

export interface GrainLoad { sand: number; water: number; marble: number; total: number }

/** Matter particles a world starts with (grains, mL of water, marbles), from its containers' props. */
export function worldGrains(parts: Iterable<PartRecord>): GrainLoad {
  const out: GrainLoad = { sand: 0, water: 0, marble: 0, total: 0 };
  for (const p of parts) {
    const t = p.type;
    if (t !== 'grit_hopper' && t !== 'marble_hopper' && t !== 'tank' && t !== 'sprinkle_can' && t !== 'sponge') continue;
    const d = partDef(t);
    if (!d) continue;
    const v = propValues(d, p.props) as Record<string, number>;
    const start = (v.start ?? (t === 'sponge' ? 0 : 100)) / 100;
    if (t === 'grit_hopper') out.sand += Math.round((v.capacity ?? 200_000) * start);
    else if (t === 'marble_hopper') out.marble += Math.round((v.capacity ?? 2000) * start);
    else if (t === 'tank') out.water += Math.round(TANK.capacity * start);
    else if (t === 'sprinkle_can') out.water += Math.round(SPRINKLE.capacity * start);
    else out.water += Math.round(SPONGE.capacity * start);
  }
  out.total = out.sand + out.water + out.marble;
  return out;
}

/** Compact count: 950, 12.5k, 230k, 1.2M. */
export function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${n < 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '')}M`;
}

export interface GrainStatus { readonly text: string; readonly level: 'ok' | 'warn' | 'over' | 'off'; readonly fraction: number; readonly title: string }

/**
 * The world-card readout for `grains` against a tier's budget (null when the world has no Matter). `off`: the
 * world's Matter switch is off (U5: Settings › World, `env.matter` / header simFlags), so nothing is spawned.
 */
export function grainStatus(grains: number, tier: number, parts = 0, off = false): GrainStatus | null {
  if (grains <= 0) return null;
  if (off) return { text: 'Matter off', level: 'off', fraction: 0, title: `Sand, water and marbles are off in this world (Settings › World): containers still open, empty and signal on time, but no grains pour. ${fmtCount(grains)} would pour with it on.` };
  const cap = tierGrains(tier);
  const fraction = cap ? grains / cap : 1;
  const need = requiredTier(parts, grains);
  const level = fraction > 1 ? 'over' : fraction > 0.8 ? 'warn' : 'ok';
  const text = `${fmtCount(grains)} / ${fmtCount(cap)} grains`;
  const title = level === 'over'
    ? (need ? `Too much Matter for the ${tier} GB tier: needs the ${need} GB tier (${fmtCount(tierGrains(need))} grains). It won’t run here.` : 'More Matter than any tier can hold.')
    : `Matter particles at the start: ${grains.toLocaleString('en-US')} of the ${tier} GB tier’s ${cap.toLocaleString('en-US')}.`;
  return { text: level === 'over' && need ? `${text} · needs ${need} GB` : text, level, fraction, title };
}
