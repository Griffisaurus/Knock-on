// Desync detection bookkeeping (MULTIPLAYER §7.4, D59, M5 desync fix: docs/dev/M5_NOTES_DESYNC.md).
//
// A client hashes its state every `every` ticks while it bakes and reports the hash for tick T once its bake head
// reaches T + `delay` (D59). The game's sim worker bakes up to 480 ticks ahead of the playhead, so a poke scheduled
// just ahead of the playhead usually lands *behind* hashes the client has already reported: those reports describe a
// future without the poke. Whether a given report went out before or after the poke depends on how far each client
// had baked when the poke reached it (CPU load, Jolt threads, worker start-up), so the two clients could report
// different hashes for the same tick although their machines never diverged (the 2026-10-25 playtest's "desyncs").
//
// The fix has two halves:
// - every report carries `pk`, the number of pokes it was computed with (known pokes with tick < T: a poke at tick p is
//   applied in the step p → p + 1, so it first shows in the hash of tick p + 1). Pokes reach both clients in the same
//   server order, so two reports of tick T with the same `pk` were computed from the same inputs and must agree;
// - after a rollback (or a re-sync) the client reports the re-baked hashes again, so the stale report is replaced.
// The host compares a tick only once every player's report has the same `pk` (`comparable`).

export interface HashReport { tick: number; h: string; mc?: string; pk: number }

/** Client side: hashes by tick, the pokes they saw, and which ticks have been reported. */
export class HashReporter {
  readonly every: number;
  readonly delay: number;
  private readonly hashes = new Map<number, HashReport>();
  private readonly pokeTicks: number[] = [];
  /** The last tick reported (reports go out in tick order, `every` apart). */
  sent = 0;

  constructor(every = 60, delay = 120) {
    this.every = every;
    this.delay = delay;
  }

  /** A new run. */
  reset(): void {
    this.hashes.clear();
    this.pokeTicks.length = 0;
    this.sent = 0;
  }

  /** A poke this client now knows about (call alongside Machine.addPoke, before rolling back for it). */
  poke(tick: number): void { this.pokeTicks.push(tick); }

  /** Pokes known now that the state at `tick` depends on. */
  pokesBefore(tick: number): number {
    let n = 0;
    for (const t of this.pokeTicks) if (t < tick) n++;
    return n;
  }

  /** Is `tick` a hash tick? */
  due(tick: number): boolean { return tick % this.every === 0; }

  /** The state hash at `tick` (just stepped to), with the Matter checksum when Matter is on. */
  record(tick: number, h: string, mc?: string): void {
    this.hashes.set(tick, { tick, h, ...(mc ? { mc } : {}), pk: this.pokesBefore(tick) });
  }

  /**
   * The machine went back to `tick` (a poke's rollback, or adopting the partner's checkpoint): hashes after it are
   * re-baked, and reported again even if their tick was reported already.
   */
  rewind(tick: number): void {
    for (const k of [...this.hashes.keys()]) if (k > tick) this.hashes.delete(k);
    this.sent = Math.min(this.sent, tick - (tick % this.every));
  }

  /** Reports ready to send now that the bake head is at `bakeHead` (in tick order; each tick once per bake). */
  take(bakeHead: number): HashReport[] {
    const out: HashReport[] = [];
    for (let t = this.sent + this.every; t <= bakeHead - this.delay; t += this.every) {
      const r = this.hashes.get(t);
      if (r) out.push(r);
      this.hashes.delete(t);
      this.sent = t;
    }
    return out;
  }
}

/**
 * Host side: may these reports of one tick (one per player) be compared? Only if they were computed with the same
 * pokes; otherwise the one missing a poke is stale and its client sends a fresh one after rolling back. Reports
 * without `pk` (older clients, the soak harness) are compared as before.
 */
export function comparable(pks: readonly (number | undefined)[]): boolean {
  const known = pks.filter((x): x is number => typeof x === 'number');
  return known.length < pks.length || known.every((x) => x === known[0]);
}
