// NTP-style clock offset estimation (MULTIPLAYER §7.2): median offset of the lowest-RTT samples.

export interface ClockSample { readonly offset: number; readonly rtt: number }

export class ClockSync {
  private readonly samples: ClockSample[] = [];
  private readonly keep: number;

  constructor(keep = 8) {
    this.keep = keep;
  }

  /** t0 = local send time, serverTime = server clock at receipt, t1 = local receive time (ms). */
  add(t0: number, serverTime: number, t1: number): void {
    const rtt = t1 - t0;
    if (rtt < 0) return;
    this.samples.push({ offset: serverTime - (t0 + t1) / 2, rtt });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get ready(): boolean { return this.samples.length >= 3; }

  /** serverTime ≈ localTime + offset. */
  get offset(): number {
    if (!this.samples.length) return 0;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(3, Math.ceil(this.samples.length / 2)));
    const offs = best.map((s) => s.offset).sort((a, b) => a - b);
    return offs[Math.floor(offs.length / 2)]!;
  }

  get rtt(): number {
    if (!this.samples.length) return 0;
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)]!;
  }

  /** Poke input delay in ticks from RTT (MULTIPLAYER §7.3): 12 ticks direct, up to 36 relayed. */
  inputDelayTicks(tickRate = 120): number {
    const ticks = Math.ceil(((this.rtt / 2) + 40) / (1000 / tickRate));
    return Math.min(36, Math.max(12, ticks));
  }
}
