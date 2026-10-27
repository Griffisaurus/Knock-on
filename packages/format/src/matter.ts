// Matter in the world header (DATA_FORMATS §2.1): sim flags, the grain count and the tier a machine needs.

/** Sim flags (ARCHITECTURE §9): part of the run snapshot, so both clients run the same rules. */
export interface SimFlags {
  /** The Matter layer (sand, water, marbles) is gameplay. Off: Matter parts fall back to cosmetic effects. */
  readonly matterGameplay?: boolean;
  /** Reserved (collision lanes, SIMULATION §4.2). */
  readonly lanes?: boolean;
}

/** New worlds from M4 on run Matter as gameplay; a header without simFlags (made before M4) reads as off. */
export const DEFAULT_SIM_FLAGS: Required<SimFlags> = { matterGameplay: true, lanes: false };
export const LEGACY_SIM_FLAGS: Required<SimFlags> = { matterGameplay: false, lanes: false };

/**
 * D98: the Mega Kitchen's "Fill the sink" water, a fixed world-level amount (25 % of the 16 GB tier's 4M grains), the
 * same on every machine; such a world requires the 16 GB tier.
 */
export const SINK_FILL_PARTICLES = 1_000_000;
export const SINK_FILL_TIER = 16;

/** Is the sink filled in this environment (the toggle only acts in the Mega Kitchen)? */
export function sinkFilled(env: { readonly environment?: string; readonly sinkFill?: boolean } | undefined): boolean {
  return env?.environment === 'kitchen' && env.sinkFill === true;
}

/** requiredTier for a world: from its counts (SIMULATION §10.5), and at least 16 GB with the sink filled (D98). */
export function worldRequiredTier(parts: number, grains: number, env?: { readonly environment?: string; readonly sinkFill?: boolean }): number {
  const t = requiredTier(parts, grains);
  return t !== 0 && sinkFilled(env) ? Math.max(t, SINK_FILL_TIER) : t;
}

/** GAME_SPEC §15.2 capacity per tier (GB id): placed parts and Matter grains. */
export const TIER_CAPS: readonly { readonly tier: 4 | 8 | 12 | 16 | 32; readonly parts: number; readonly grains: number }[] = [
  { tier: 4, parts: 20_000, grains: 250_000 },
  { tier: 8, parts: 100_000, grains: 1_000_000 },
  { tier: 12, parts: 400_000, grains: 2_000_000 },
  { tier: 16, parts: 1_000_000, grains: 4_000_000 },
  { tier: 32, parts: 2_000_000, grains: 8_000_000 },
];

/** The smallest tier that holds `parts` placed parts and `grains` Matter grains (SIMULATION §10.5); 0 if none does. */
export function requiredTier(parts: number, grains: number): number {
  for (const t of TIER_CAPS) if (parts <= t.parts && grains <= t.grains) return t.tier;
  return 0;
}

/** Grain capacity of a tier (0 for an unknown tier id). */
export function tierGrains(tier: number): number {
  return TIER_CAPS.find((t) => t.tier === tier)?.grains ?? 0;
}

/** Reads `simFlags` from a decoded header (unknown keys dropped; absent = made before M4 = legacy). */
export function readSimFlags(v: unknown): Required<SimFlags> {
  if (typeof v !== 'object' || v === null) return LEGACY_SIM_FLAGS;
  const o = v as Record<string, unknown>;
  return { matterGameplay: o.matterGameplay === true, lanes: o.lanes === true };
}
