// Glass Lab surfaces (D77, D80, UI_UX §2, §3, §8): the registry of every frosted-glass surface, the
// "at most 6 blurred at once" budget, and the solid Graphite fallback (Reduce transparency, the 4 GB
// tier, or UI frame time over budget). Components only use the --surface* tokens, so the fallback is
// one attribute on :root (`data-solid`). The pure parts (planGlass, FrameBudget) are unit-tested.

export type TextToken = '--kn-paper' | '--text-2';

export interface GlassSurface {
  readonly id: string;
  readonly label: string;
  /** CSS selector of the surface element. */
  readonly selector: string;
  /** Fill token: the D80 text tint (.64) or the chrome tint (.58, no small text). */
  readonly tint: '--glass-tint' | '--glass-tint-chrome';
  /** Text tokens drawn straight on the glass fill (≥ 14 px only, D77). */
  readonly onGlass: readonly TextToken[];
  /** Text tokens drawn on a raised well inside it (small text). */
  readonly onWell: readonly TextToken[];
  /** Higher keeps its blur first when more than 6 are visible. */
  readonly priority: number;
  /** A modal dims the viewport; the other surfaces turn to solid wells while it's open (§3). */
  readonly modal?: boolean;
}

const S = (id: string, label: string, selector: string, priority: number, extra: Partial<GlassSurface> = {}): GlassSurface =>
  ({ id, label, selector, tint: '--glass-tint', onGlass: ['--kn-paper'], onWell: ['--kn-paper', '--text-2'], priority, ...extra });

/** Every glass surface in the client. The contrast check (CI) measures each one over white. */
export const GLASS_SURFACES: readonly GlassSurface[] = [
  // Build HUD (6)
  S('worldcard', 'World card + Outliner', '#worldcard', 60),
  S('session', 'Session bar', '#sessionbar', 70),
  S('viewrail', 'View rail', '#viewrail', 40),
  S('inspector', 'Inspector', '#inspector', 80),
  S('transport', 'Transport pill', '#transport', 90),
  S('tray', 'Parts tray', '#tray', 85),
  // panels in the Inspector's place
  S('library', 'Library', '#library', 95),
  S('cascade', 'Cascade Report', '#cascade', 95),
  // transient but blurred
  S('radial', 'Radial menu', '#radial .rd-glass', 99, { onGlass: [] }),
  // modal
  S('palette', 'Command palette', '#palette', 100, { modal: true }),
  S('settings', 'Settings', '#settings', 100, { modal: true }),
  S('ask', 'Dialog', '.kn-ask form', 101, { modal: true }),
  // C4 (M4): photo mode's mini-panel (the HUD hides while it's open) and the capture dialog (ui/photo.ts, ui/capture.ts)
  S('photo', 'Photo mode', '#photo', 90),
  S('capture', 'Capture dialog', '#capture-dialog', 100, { modal: true }),
  // Run HUD (4)
  S('runpill', 'Partner / camera pill', '#runpill', 50),
  S('ko', 'K.O. counter', '#kocounter', 70),
  S('feed', 'Event feed', '#eventfeed', 60),
  S('runbar', 'Run bar', '#runbar', 90),
  // Lobby (4)
  S('lobby-id', 'Lobby identity pill', '#lobby .lb-id', 50),
  S('lobby-live', 'Lobby live session', '#lobby .lb-live', 70),
  S('lobby-worlds', 'Lobby worlds', '#lobby .lb-worlds', 80),
  S('lobby-new', 'Lobby new world', '#lobby .lb-new', 75),
];

export const MAX_GLASS = 6;

export interface GlassPlan { readonly blur: readonly string[]; readonly demote: readonly string[] }

/**
 * Which visible surfaces keep their blur: with a modal open only the top modal does; otherwise the
 * `max` highest-priority ones do and the rest are demoted to solid wells (UI_UX §3, §8).
 */
export function planGlass(visible: readonly string[], max = MAX_GLASS, surfaces: readonly GlassSurface[] = GLASS_SURFACES): GlassPlan {
  const byId = new Map(surfaces.map((s) => [s.id, s]));
  const known = visible.filter((id) => byId.has(id));
  const sorted = [...known].sort((a, b) => byId.get(b)!.priority - byId.get(a)!.priority || a.localeCompare(b));
  const modal = sorted.find((id) => byId.get(id)!.modal);
  const blur = modal ? [modal] : sorted.slice(0, max);
  return { blur, demote: sorted.filter((id) => !blur.includes(id)) };
}

/**
 * UI frame-time guard (§8): trips when the smoothed UI cost stays over `limitMs` for `holdMs`, and
 * stays tripped until reset (next launch or tier change).
 */
export class FrameBudget {
  private avg = 0;
  private overSince: number | null = null;
  tripped = false;
  peak = 0;
  constructor(readonly limitMs = 4, readonly holdMs = 2000, private readonly alpha = 0.1) {}

  /** Feed one frame's UI cost; returns true on the frame it trips. */
  sample(ms: number, now: number): boolean {
    this.avg = this.avg === 0 ? ms : this.avg + (ms - this.avg) * this.alpha;
    this.peak = Math.max(this.peak, ms);
    if (this.tripped) return false;
    if (this.avg > this.limitMs) {
      if (this.overSince === null) this.overSince = now;
      if (now - this.overSince >= this.holdMs) { this.tripped = true; return true; }
    } else this.overSince = null;
    return false;
  }

  get average(): number { return this.avg; }

  reset(): void { this.avg = 0; this.overSince = null; this.tripped = false; this.peak = 0; }
}

/**
 * The blur's compositor cost from an interleaved probe (M5): rounds alternate solid, glass, solid, glass…
 * Each glass round is compared with the solid rounds either side of it, and the median difference is the
 * cost, so a one-off hitch (texture streaming, shader compiles, a busy GPU) can't pass for the glass. The
 * probe is `noisy` when the solid rounds themselves disagree by more than 25 % (or 2 ms): the caller
 * retries later instead of trusting it. With no glass rounds it only answers "are frame times steady?".
 */
export function glassCostFrom(solid: readonly number[], glass: readonly number[]): { cost: number; noisy: boolean } {
  const diffs: number[] = [];
  for (let i = 0; i < glass.length; i++) {
    const before = solid[i], after = solid[i + 1];
    const base = before !== undefined && after !== undefined ? (before + after) / 2 : (before ?? after);
    if (base !== undefined) diffs.push(glass[i]! - base);
  }
  const lo = Math.min(...solid), hi = Math.max(...solid);
  const noisy = !solid.length || hi - lo > Math.max(2, lo * 0.25);
  if (!diffs.length) return { cost: 0, noisy }; // no glass rounds: just "are frame times steady?"
  const sorted = [...diffs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { cost: Math.max(0, median), noisy };
}

export type SolidReason = 'setting' | 'tier' | 'budget' | null;

export interface GlassHost {
  /** Reduce transparency (Settings › Accessibility). */
  reduceTransparency(): boolean;
  /** Effective VRAM tier (settings override, else the host's view of us). */
  tier(): number;
  toast(text: string): void;
}

/** DOM side: applies `data-solid`, enforces the budget, measures the UI frame cost. */
export class GlassManager {
  readonly budget = new FrameBudget();
  /** Compositor cost of the blur, from the boot probe (ms per frame, ≥ 0). */
  glassCostMs = 0;
  probeResult: { solidMs: number; glassMs: number; frames: number } | null = null;
  visible: string[] = [];
  private budgetSolid = false;
  private lastTier = -1;
  private frameUi = 0;
  private uiSum = 0;
  private uiFrames = 0;
  private uiPeak = 0;
  private refreshAt = 0;
  private probing = false;
  /** The budget tripped on the glass estimate once and the glass was re-measured (M5). */
  private reverified = false;
  /** Running UI cost for the perf readout (EMA) and the peak over the last second. */
  uiEma = 0;
  uiPeak1s = 0;
  private peakAt = 0;

  constructor(private readonly host: GlassHost, private readonly root: HTMLElement = document.documentElement) {
    this.apply();
  }

  get reason(): SolidReason {
    if (this.host.reduceTransparency()) return 'setting';
    if (this.host.tier() === 4) return 'tier';
    if (this.budgetSolid) return 'budget';
    return null;
  }

  /** Re-apply after a settings or tier change. A tier change re-probes and clears the budget fallback. */
  apply(): void {
    const tier = this.host.tier();
    if (tier !== this.lastTier) {
      const first = this.lastTier < 0;
      this.lastTier = tier;
      this.budgetSolid = false;
      this.reverified = false;
      this.budget.reset();
      if (!first) void this.probe();
    }
    const solid = this.reason !== null;
    if (solid) this.root.dataset.solid = this.reason!; else delete this.root.dataset.solid;
    this.refresh(true);
  }

  /** Re-plan which surfaces blur (cheap; also runs every 500 ms from `frame`). */
  refresh(force = false): void {
    const now = performance.now();
    if (!force && now - this.refreshAt < 500) return;
    this.refreshAt = now;
    const els = new Map<string, Element>();
    for (const s of GLASS_SURFACES) {
      for (const el of document.querySelectorAll(s.selector)) {
        if (isShown(el)) { els.set(s.id, el); break; }
      }
    }
    this.visible = [...els.keys()];
    const plan = planGlass(this.visible);
    for (const s of GLASS_SURFACES) for (const el of document.querySelectorAll(s.selector)) el.classList.toggle('glass-demoted', plan.demote.includes(s.id));
    this.root.dataset.glass = String(this.reason ? 0 : plan.blur.length);
    this.root.toggleAttribute('data-modal', plan.blur.some((id) => GLASS_SURFACES.find((s) => s.id === id)?.modal));
  }

  /** Time a slice of UI work (main-thread) for this frame. */
  measure<T>(fn: () => T): T {
    const t = performance.now();
    try { return fn(); } finally { this.frameUi += performance.now() - t; }
  }

  /** End of frame: UI work + glass compositor cost against the 4 ms budget. */
  frame(now: number): void {
    const ui = this.frameUi;
    this.frameUi = 0;
    this.uiSum += ui; this.uiFrames++; this.uiPeak = Math.max(this.uiPeak, ui);
    this.uiEma = this.uiEma ? this.uiEma + (ui - this.uiEma) * 0.05 : ui;
    if (now - this.peakAt > 1000) { this.peakAt = now; this.uiPeak1s = ui; } else this.uiPeak1s = Math.max(this.uiPeak1s, ui);
    const glass = this.reason ? 0 : this.glassCostMs;
    if (!this.probing && this.budget.sample(ui + glass, now)) {
      // M5: when the probe's glass estimate is what tips it (the UI work alone is under budget), measure the
      // glass again once before giving it up: a boot probe taken while textures streamed in overestimated it
      if (!this.reverified && this.budget.average - glass < this.budget.limitMs) {
        this.reverified = true;
        this.budget.reset();
        void this.probe();
      } else {
        this.budgetSolid = true;
        this.apply();
        this.host.toast('Switched to solid panels to keep the frame rate');
      }
    }
    this.refresh();
  }

  /** Average and peak main-thread UI ms since the last call (for the perf readout and notes). */
  takeStats(): { avg: number; peak: number; frames: number } {
    const r = { avg: this.uiFrames ? this.uiSum / this.uiFrames : 0, peak: this.uiPeak, frames: this.uiFrames };
    this.uiSum = 0; this.uiFrames = 0; this.uiPeak = 0;
    return r;
  }

  /**
   * Boot / tier-change probe (§8): solid, glass, solid rounds of `frames` frames, compared by frame interval
   * (`glassCostFrom`): the difference is the compositor cost of the blur on the test system (0 when it hides in
   * vsync). M5: it first waits, without changing anything on screen, until frame times are steady (the boot's
   * texture streaming, shader compiles or a busy GPU used to pass for glass cost and switch the UI to solid);
   * it checks every 3 s, up to `tries` times. A probe that is still noisy keeps the smallest estimate, since
   * load only ever inflates it.
   */
  async probe(frames = 20, tries = 10): Promise<void> {
    if (this.probing || typeof requestAnimationFrame === 'undefined') return;
    this.probing = true;
    const prev = this.root.dataset.solid;
    const run = async (solid: boolean | null): Promise<number> => {
      if (solid === true) this.root.dataset.solid = 'probe'; else if (solid === false) delete this.root.dataset.solid;
      await nextFrame(); await nextFrame();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) await nextFrame();
      return (performance.now() - t0) / frames;
    };
    try {
      let best = Infinity;
      for (let attempt = 0; attempt < tries; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 3000));
        const last = attempt === tries - 1;
        // steady? (as the panels are now: nothing visible changes)
        const quiet = [await run(null), await run(null), await run(null)];
        if (glassCostFrom(quiet, []).noisy && !last) continue;
        const solid = [await run(true)], glass = [await run(false)];
        solid.push(await run(true));
        if (prev) this.root.dataset.solid = prev; else delete this.root.dataset.solid;
        const est = glassCostFrom(solid, glass);
        best = Math.min(best, est.cost);
        this.probeResult = { solidMs: (solid[0]! + solid[1]!) / 2, glassMs: glass[0]!, frames: frames * 3 };
        if (!est.noisy) { best = est.cost; break; }
      }
      if (Number.isFinite(best)) this.glassCostMs = best;
    } finally {
      if (prev) this.root.dataset.solid = prev; else delete this.root.dataset.solid;
      this.probing = false;
      this.apply();
    }
  }
}

function isShown(el: Element): boolean {
  const e = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (e.checkVisibility) return e.checkVisibility({ visibilityProperty: true, opacityProperty: false });
  return e.offsetParent !== null;
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
