// Cascade Report v1 (UI_UX §4.9, GAME_SPEC §6.8): the run's causal graph, its longest knock-on chain,
// the stats grid and the Overreaction Score. Pure logic; the panel lives in ui/cascadepanel.ts.
//
// Causes: SimEvent gains `id`, `cause` (−1 = none) and `other` in M2 (M2_PLAN contract 1). Until the
// sim emits them, causes are inferred: the latest earlier event on another part that is linked to
// this one or close by, within a short window. The report says which mode it used (`causal`).

/** The fields the report reads. Unknown kinds are fine (they map to channel 'other'). */
export interface CascadeEvent {
  readonly tick: number;
  readonly kind: string;
  readonly part: number;
  readonly pos: readonly [number, number, number];
  readonly mag: number;
  readonly id?: number;
  readonly cause?: number;
  readonly other?: number;
}

export type CascadeChannel =
  | 'impact' | 'signal' | 'spin' | 'tension' | 'power' | 'light' | 'heat' | 'air' | 'fluid' | 'sound' | 'lure' | 'other';

/** Event kind → the channel that carried it (UI_UX §2 channel colours). */
export const KIND_CHANNEL: Readonly<Record<string, CascadeChannel>> = {
  Impact: 'impact', Break: 'impact', Launch: 'impact', Spawn: 'impact',
  Signal: 'signal', Press: 'signal', Toggle: 'signal',
  Jam: 'spin',
  Cut: 'tension',
  Powered: 'power', Unpowered: 'power', Brownout: 'power',
  Lit: 'light', Unlit: 'light',
  Ignite: 'heat', FuseLit: 'heat', FuseEnd: 'heat', Detonate: 'heat',
  Extinguish: 'air', Pop: 'air',
  Splash: 'fluid',
  Sound: 'sound', Ring: 'sound', Note: 'sound',
  CritterState: 'lure', Emote: 'lure', Ragdoll: 'lure', Getup: 'lure', Trapped: 'lure',
};

/** Kinds that never start or extend a chain (bookkeeping or too frequent to mean anything). */
const IGNORED = new Set(['Sound', 'Despawn', 'Emote', 'Unpowered', 'Unlit']);

/** UIFIX (D122): does this event take part in the cause graph (the report's chain and K.O. count, the run HUD's K.O.)? */
export const inCascade = (e: { readonly kind: string; readonly part: number }): boolean => !IGNORED.has(e.kind) && e.part !== 0;

export interface ChainStep {
  readonly part: number;
  /** The event that brought this part into the chain (the chip scrubs to its tick). */
  readonly kind: string;
  readonly tick: number;
  /** Channel of the arrow *into* this step (how the previous part got to it); null for the first chip. */
  readonly via: CascadeChannel | null;
}

export interface CascadeStats {
  readonly ko: number;
  readonly chainLength: number;
  readonly channels: readonly CascadeChannel[];
  readonly peak: number;
  readonly booms: readonly number[]; // Detonate magnitudes
}

export interface CascadeReport extends CascadeStats {
  readonly chain: readonly ChainStep[];
  readonly runTicks: number;
  readonly partsUsed: number;
  readonly partsTotal: number;
  readonly biggestBoom: { readonly part: number; readonly mag: number; readonly tick: number } | null;
  readonly score: number;
  readonly title: string;
  /** True when the sim supplied cause ids; false when causes were inferred. */
  readonly causal: boolean;
  readonly events: number;
}

export interface CascadeOptions {
  readonly tickRate: number;
  readonly partsTotal: number;
  /** Ticks the run lasted (defaults to the last event's tick). */
  readonly runTicks?: number;
  /** Are two parts joined by a link? Used by the inference fallback. */
  readonly linked?: (a: number, b: number) => boolean;
  /** Fallback inference: how far back (seconds) and how near (metres) a cause may be. */
  readonly window?: number;
  readonly radius?: number;
}

export const TITLE_TIERS: readonly (readonly [number, string])[] = [
  [0, 'Mild Kerfuffle'],
  [500, 'Minor Ruckus'],
  [1500, 'Proper Commotion'],
  [3500, 'Spectacular Overreaction'],
  [7000, 'Utter Pandemonium'],
  [12000, 'Absolute Catastrophe'],
];

export function titleFor(score: number): string {
  let t = TITLE_TIERS[0]![1];
  for (const [min, name] of TITLE_TIERS) if (score >= min) t = name;
  return t;
}

/**
 * The Overreaction Score: rewards long chains, many distinct knock-ons, variety of channels,
 * simultaneous chaos and big booms. Monotonic in every input.
 */
export function overreactionScore(s: CascadeStats): number {
  const boom = s.booms.reduce((sum, m) => sum + Math.cbrt(Math.max(0, m)), 0);
  return Math.round(100 * s.ko + 250 * Math.max(0, s.chainLength - 1) + 120 * s.channels.length + 15 * s.peak + 200 * boom);
}

interface Node {
  readonly e: CascadeEvent;
  readonly idx: number;
  parent: number; // node index, −1 = root
  steps: number; // distinct-part steps from the root
}

/** Build the report from a run's events (any order; ties keep input order). */
export function buildReport(events: readonly CascadeEvent[], opts: CascadeOptions): CascadeReport {
  const list = events.filter(inCascade);
  const causal = list.some((e) => typeof e.cause === 'number' && e.cause >= 0);
  // causal mode orders by event id (causes always precede effects); inference orders by tick
  const order = list.map((e, i) => ({ e, i })).sort((a, b) =>
    causal ? (a.e.id ?? a.i) - (b.e.id ?? b.i) || a.i - b.i : a.e.tick - b.e.tick || a.i - b.i);
  const nodes: Node[] = order.map(({ e }, idx) => ({ e, idx, parent: -1, steps: 1 }));
  if (causal) {
    const byId = new Map<number, number>();
    nodes.forEach((n) => { if (typeof n.e.id === 'number') byId.set(n.e.id, n.idx); });
    for (const n of nodes) {
      const p = typeof n.e.cause === 'number' && n.e.cause >= 0 ? byId.get(n.e.cause) : undefined;
      if (p !== undefined && p < n.idx) n.parent = p;
    }
  } else {
    inferCauses(nodes, opts);
  }
  for (const n of nodes) {
    if (n.parent < 0) continue;
    const p = nodes[n.parent]!;
    n.steps = p.steps + (p.e.part !== n.e.part ? 1 : 0);
  }
  // the longest chain ends at the node with the most steps (earliest wins a tie)
  let end = -1;
  for (const n of nodes) if (end < 0 || n.steps > nodes[end]!.steps) end = n.idx;
  const path: Node[] = [];
  for (let i = end; i >= 0; i = nodes[i]!.parent) path.push(nodes[i]!);
  path.reverse();
  const chain: ChainStep[] = [];
  let prev: Node | null = null;
  for (const n of path) {
    if (chain.length && chain.at(-1)!.part === n.e.part) { prev = n; continue; }
    chain.push({ part: n.e.part, kind: n.e.kind, tick: n.e.tick, via: prev ? KIND_CHANNEL[prev.e.kind] ?? 'other' : null });
    prev = n;
  }
  // K.O. count: distinct knock-on steps (part A → part B edges in the cause graph)
  const edges = new Set<string>();
  for (const n of nodes) {
    if (n.parent < 0) continue;
    const a = nodes[n.parent]!.e.part;
    if (a !== n.e.part) edges.add(`${a}>${n.e.part}`);
  }
  const channels = [...new Set(list.map((e) => KIND_CHANNEL[e.kind] ?? 'other'))].filter((c) => c !== 'other').sort(byChannelOrder);
  const booms = list.filter((e) => e.kind === 'Detonate');
  let biggest: CascadeReport['biggestBoom'] = null;
  for (const b of booms) if (!biggest || b.mag > biggest.mag) biggest = { part: b.part, mag: b.mag, tick: b.tick };
  const stats: CascadeStats = {
    ko: edges.size, chainLength: chain.length, channels, peak: peakSimultaneous(list, Math.max(1, Math.round(opts.tickRate / 20))),
    booms: booms.map((b) => b.mag),
  };
  const score = overreactionScore(stats);
  return {
    ...stats, chain, score, title: titleFor(score), causal, events: list.length,
    runTicks: opts.runTicks ?? list.reduce((m, e) => Math.max(m, e.tick), 0),
    partsUsed: new Set(list.map((e) => e.part)).size, partsTotal: opts.partsTotal, biggestBoom: biggest,
  };
}

/** Fallback when the sim has no cause ids: nearest-in-time event on a linked or nearby other part. */
function inferCauses(nodes: Node[], opts: CascadeOptions): void {
  const windowTicks = Math.round((opts.window ?? 1.5) * opts.tickRate);
  const r2 = (opts.radius ?? 0.6) ** 2;
  const LOOKBACK = 400;
  for (const n of nodes) {
    let same = -1;
    for (let j = n.idx - 1; j >= 0 && j >= n.idx - LOOKBACK; j--) {
      const p = nodes[j]!;
      if (n.e.tick - p.e.tick > windowTicks) break;
      if (p.e.part === n.e.part) { if (same < 0) same = j; continue; }
      const near = (p.e.pos[0] - n.e.pos[0]) ** 2 + (p.e.pos[1] - n.e.pos[1]) ** 2 + (p.e.pos[2] - n.e.pos[2]) ** 2 <= r2;
      if (near || n.e.other === p.e.part || opts.linked?.(p.e.part, n.e.part)) { n.parent = j; break; }
    }
    if (n.parent < 0 && same >= 0) n.parent = same; // the same part carrying on (no new step)
  }
}

/** Most events inside any window of `w` ticks. */
export function peakSimultaneous(events: readonly { tick: number }[], w: number): number {
  const ticks = events.map((e) => e.tick).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < ticks.length; i++) {
    while (ticks[i]! - ticks[j]! >= w) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

const CHANNEL_ORDER: readonly CascadeChannel[] = ['impact', 'signal', 'spin', 'tension', 'power', 'light', 'heat', 'air', 'fluid', 'sound', 'lure', 'other'];
function byChannelOrder(a: CascadeChannel, b: CascadeChannel): number {
  return CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b);
}

/** Channel colours and glyphs (UI_UX §2; colour is never the only signal). */
export const CASCADE_CHANNEL_HEX: Readonly<Record<CascadeChannel, string>> = {
  impact: '#F2F4F8', signal: '#FFC21A', spin: '#A78BFA', tension: '#E0A96D', power: '#C6FF3A', light: '#FFF1A8', heat: '#FF5B2E',
  air: '#9BE7D8', fluid: '#4C8DFF', sound: '#F472B6', lure: '#34D399', other: '#8A93A6',
};
export const CASCADE_CHANNEL_GLYPH: Readonly<Record<CascadeChannel, string>> = {
  impact: '✸', signal: '◆', spin: '⟳', tension: '∿', power: '⚡', light: '☀', heat: '🔥', air: '≋', fluid: '💧', sound: '♪', lure: '♥', other: '•',
};
