// Run HUD models (UI_UX §4.8): the K.O. counter (knock-on steps, as the Cascade Report) and its "+N this second", and the event feed, where
// repeats collapse into a count and at most three toasts show, newest first. Pure (sim-time based).

import type { SimEvent } from '@knockon/sim';
import { inCascade } from '../cascade.ts'; // UIFIX (D122): the K.O. counter counts what the Cascade Report counts

/** Feed entries for the notable kinds; the label is shown in Unbounded caps beside the part's 3D icon. */
export const FEED_LABEL: Readonly<Record<string, string>> = {
  Detonate: 'BOOM', Break: 'BREAK', Pop: 'POP', Cut: 'SNIP', Jam: 'JAM', Brownout: 'BROWNOUT', Ignite: 'IGNITED', FuseLit: 'FUSE LIT',
  Press: 'PRESSED', Powered: 'POWERED',
};

/**
 * The live K.O. counter (UIFIX, D122): GAME_SPEC §8's K.O. Count, "the number of distinct knock-on steps", counted the
 * way the Cascade Report counts it (cascade.ts): one per distinct part A → part B edge of the cause graph (an event on
 * B whose `cause` is an event on A). It used to count booms, breaks, pops and cuts, so the HUD said 57 where the report
 * said 256 for the same run. A step counts from the tick it first happened, so a scrub back shows the count at the
 * playhead, and events replayed after a scrub or a rollback (same ids) are not counted twice.
 */
export class KoMeter {
  /** Part of each counted event, by event id (a later event's `cause`). */
  private partOf = new Map<number, number>();
  private edges = new Set<string>();
  /** First tick of each edge, ascending. */
  private ticks: number[] = [];

  /** Adds one event; true when it is a new knock-on step. */
  add(e: Pick<SimEvent, 'kind' | 'tick' | 'part'> & { readonly id?: number; readonly cause?: number }): boolean {
    if (!inCascade(e)) return false;
    if (typeof e.id === 'number' && e.id >= 0) this.partOf.set(e.id, e.part);
    const a = typeof e.cause === 'number' && e.cause >= 0 ? this.partOf.get(e.cause) : undefined;
    if (a === undefined || a === e.part) return false;
    const key = `${a}>${e.part}`;
    if (this.edges.has(key)) return false;
    this.edges.add(key);
    let i = this.ticks.length;
    while (i > 0 && this.ticks[i - 1]! > e.tick) i--;
    this.ticks.splice(i, 0, e.tick);
    return true;
  }

  /** Every knock-on step seen this run. */
  get count(): number { return this.edges.size; }

  /** Knock-on steps at or before `tick` (the counter at the playhead). */
  countAt(tick: number): number {
    let lo = 0, hi = this.ticks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.ticks[m]! <= tick) lo = m + 1; else hi = m; }
    return lo;
  }

  /** Knock-on steps in the last second of sim time up to `tick`. */
  lastSecond(tick: number, tickRate: number): number { return this.countAt(tick) - this.countAt(tick - tickRate); }

  reset(): void { this.partOf.clear(); this.edges.clear(); this.ticks = []; }
}

export interface FeedItem { readonly key: string; label: string; part: number; type: string; n: number; at: number; detail: string; readonly seq: number }

/** Collapses repeats of the same event on the same part type within `windowMs`; keeps `max` items, newest first. */
export class FeedModel {
  items: FeedItem[] = [];
  private seq = 0;
  constructor(readonly max = 3, readonly windowMs = 2500, readonly lifeMs = 4000) {}

  push(e: Pick<SimEvent, 'kind' | 'part'>, type: string, now: number, detail = ''): FeedItem | null {
    const label = FEED_LABEL[e.kind];
    if (!label) return null;
    const key = `${e.kind}:${type}`;
    const hit = this.items.find((i) => i.key === key && now - i.at < this.windowMs);
    if (hit) {
      hit.n++; hit.at = now; hit.part = e.part;
      this.items = [hit, ...this.items.filter((i) => i !== hit)];
      return hit;
    }
    const item: FeedItem = { key, label, part: e.part, type, n: 1, at: now, detail, seq: ++this.seq };
    this.items = [item, ...this.items].slice(0, this.max);
    return item;
  }

  /** Drop expired items; returns true if anything changed. */
  expire(now: number): boolean {
    const before = this.items.length;
    this.items = this.items.filter((i) => now - i.at < this.lifeMs);
    return this.items.length !== before;
  }

  clear(): void { this.items = []; }
}
