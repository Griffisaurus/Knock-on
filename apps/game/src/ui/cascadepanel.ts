// Cascade Report panel (UI_UX §4.9, mockup board "Cascade Report"): a 584 px glass panel that slides in
// from the right at the end of a run, over the run bar (which dims). Header (run number, partner, close);
// the Overreaction Score card with its title tier and progress to the next tier; the longest chain as
// part chips (3D icon + name + time) joined by channel-coloured arrows (click a chip to scrub there);
// the stats grid; REPLAY (Ignition), Share card and Record clip. Logic: ../cascade.ts.
// UIFIX (D122): the header and the action row stay put and only the body between them scrolls, so REPLAY, Share card and
// Record clip are always on screen (a 17-link chain pushed them below the fold at 1080p).

import { CASCADE_CHANNEL_HEX, TITLE_TIERS, type CascadeReport } from '../cascade.ts';
import { glyph, h, ICON, partIcon } from './icons.ts';

export interface CascadeHost {
  partName(id: number): string;
  partColor(id: number): string;
  /** Part type of an id ('' for links and unknown ids): the chip's 3D icon. */
  partType?(id: number): string;
  /** "run 7 · with Sam". */
  runLabel?(): string;
  /** Is there a run to scrub (the chips' wording: jump there, or replay to there)? */
  canScrub(): boolean;
  /** UIFIX (D122): scrub to a chain step's tick; after the run it replays the machine to that tick. */
  scrub(tick: number): void;
  replay(): void;
  tickRate: number;
}

export class CascadePanel {
  readonly el: HTMLElement;
  private readonly host: CascadeHost;
  report: CascadeReport | null = null;
  onToggle: (open: boolean) => void = () => {};
  /** C4 (M4): Share card (image) and Record clip go live when main.ts sets these (capture/index.ts). */
  onShare: ((r: CascadeReport) => void) | null = null;
  onClip: (() => void) | null = null;

  constructor(parent: HTMLElement, host: CascadeHost) {
    this.host = host;
    this.el = h('<section id="cascade" class="glass side-panel" role="dialog" aria-label="Cascade Report" aria-hidden="true"></section>');
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.hide(); e.stopPropagation(); } });
    parent.appendChild(this.el);
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  hide(): void {
    if (!this.open) return;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.onToggle(false);
  }

  show(r: CascadeReport): void {
    this.report = r;
    const hst = this.host;
    const secs = (t: number): string => `${(t / hst.tickRate).toFixed(1)} s`;
    const tierIdx = TITLE_TIERS.reduce((i, [min], k) => (r.score >= min ? k : i), 0);
    const tier = TITLE_TIERS[tierIdx]!, next = TITLE_TIERS[tierIdx + 1];
    const progress = next ? Math.max(0, Math.min(1, (r.score - tier[0]) / (next[0] - tier[0]))) : 1;
    this.el.innerHTML = `
      <header class="cr-head"><h2>Cascade Report</h2><span class="cr-run mono"></span>
        <button class="icon-btn close" aria-label="Close the report">${ICON.close}</button></header>
      <div class="cr-body">
      <div class="cr-score" aria-live="polite">
        <div class="sec">Overreaction Score</div>
        <div class="cr-num mono">${r.score.toLocaleString()}</div>
        <div class="cr-title tier-${tierIdx}"></div>
        <div class="cr-prog"><div class="bar"><i style="width:${(progress * 100).toFixed(1)}%"></i></div><span></span></div>
      </div>
      <div class="cr-chain-h"><span class="sec">Longest chain${r.chain.length ? ` · ${r.chain.length} link${r.chain.length === 1 ? '' : 's'}` : ''}</span><small></small></div>
      <div class="cr-chain" role="group" aria-label="Longest chain, in order"></div>
      <div class="cr-stats"></div>
      </div>
      <footer class="cr-actions">
        <button class="cr-replay primary" data-a="replay">${ICON.reset}REPLAY</button>
        ${this.onShare ? `<button class="ghost" data-a="share" title="A 1600 × 900 image of this view with the score and the chain">${ICON.share}Share card <small>image</small></button>` : `<button class="ghost" data-a="share" disabled title="Share card: coming in a later milestone">${ICON.share}Share card <small>(soon)</small></button>`}
        ${this.onClip ? '<button class="ghost" data-a="clip" title="Render the run as MP4, GIF or WebP (Shift+F10)"><span class="rec"></span>Record clip <small>MP4 · GIF · WebP</small></button>' : '<button class="ghost" data-a="clip" disabled title="Record clip: coming in a later milestone"><span class="rec"></span>Record clip <small>(soon)</small></button>'}
      </footer>`;
    (this.el.querySelector('.cr-run') as HTMLElement).textContent = hst.runLabel?.() ?? '';
    (this.el.querySelector('.cr-title') as HTMLElement).textContent = r.title;
    (this.el.querySelector('.cr-prog span') as HTMLElement).textContent = next ? `${(next[0] - r.score).toLocaleString()} to ${next[1]}` : 'Top tier. Nothing left standing.';
    (this.el.querySelector('.cr-chain-h small') as HTMLElement).textContent = r.chain.length
      ? `${r.causal ? '' : 'causes estimated · '}${hst.canScrub() ? 'click a part to jump there' : 'click a part to replay to it'}` : ''; // UIFIX (D122)
    const chain = this.el.querySelector('.cr-chain') as HTMLElement;
    if (!r.chain.length) chain.innerHTML = '<p class="cr-empty">Nothing knocked on anything. Yet.</p>';
    r.chain.forEach((s, i) => {
      if (s.via) {
        const col = CASCADE_CHANNEL_HEX[s.via];
        const a = h(`<span class="cr-arrow" role="img" aria-label="via ${s.via}" title="${s.via}"><svg width="30" height="16" viewBox="0 0 30 16"><path d="M2 8h19" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/><path d="M19 4l5 4-5 4" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`);
        a.style.animationDelay = `${i * 90}ms`;
        chain.appendChild(a);
      }
      const chip = h<HTMLButtonElement>('<button class="cr-chip"><b></b><small class="mono"></small></button>'); // U4: a button can't be a listitem
      chip.style.animationDelay = `${i * 90}ms`;
      chip.style.setProperty('--c', hst.partColor(s.part));
      const type = hst.partType?.(s.part) ?? '';
      if (type) chip.prepend(partIcon(type, { size: 28 }));
      (chip.querySelector('b') as HTMLElement).textContent = hst.partName(s.part);
      (chip.querySelector('small') as HTMLElement).textContent = secs(s.tick);
      // UIFIX (D122): always live: during a run it jumps there (past the bake head too); after it, it replays to there
      chip.title = `${s.kind} at ${secs(s.tick)}${hst.canScrub() ? ': jump there' : ': replay to here'}`;
      chip.onclick = () => hst.scrub(s.tick);
      chain.appendChild(chip);
    });
    const grid = this.el.querySelector('.cr-stats') as HTMLElement;
    const stat = (k: string, v: string | HTMLElement): void => {
      const d = h('<div class="st"><span></span><b class="mono"></b></div>');
      (d.firstElementChild as HTMLElement).textContent = k;
      const b = d.lastElementChild as HTMLElement;
      if (typeof v === 'string') b.textContent = v; else { b.classList.remove('mono'); b.appendChild(v); }
      grid.appendChild(d);
    };
    stat('K.O.', String(r.ko));
    (grid.lastElementChild as HTMLElement).title = 'Knock-on steps: one part setting off another (the run HUD counts the same)'; // UIFIX (D122)
    stat('Run time', secs(r.runTicks));
    stat('Parts used', `${r.partsUsed} / ${r.partsTotal}`);
    if (r.biggestBoom) {
      const bb = h('<span class="cr-boom"><span class="nm"></span></span>');
      const t = hst.partType?.(r.biggestBoom.part) ?? '';
      if (t) bb.prepend(partIcon(t, { size: 30 }));
      (bb.querySelector('.nm') as HTMLElement).textContent = hst.partName(r.biggestBoom.part);
      bb.title = `yield ${r.biggestBoom.mag.toFixed(1)}`;
      stat('Biggest boom', bb);
    } else stat('Biggest boom', '—');
    stat('Peak events', `${r.peak} at once`);
    const ch = h('<span class="cr-glyphs"></span>');
    ch.innerHTML = r.channels.length ? r.channels.map((c) => glyph(c, 20)).join('') : '—';
    stat('Channels', ch);
    (this.el.querySelector('.close') as HTMLElement).onclick = () => this.hide();
    (this.el.querySelector('[data-a=replay]') as HTMLElement).onclick = () => { this.hide(); hst.replay(); };
    if (this.onShare) (this.el.querySelector('[data-a=share]') as HTMLElement).onclick = () => this.onShare?.(r); // C4
    if (this.onClip) (this.el.querySelector('[data-a=clip]') as HTMLElement).onclick = () => this.onClip?.(); // C4
    const was = this.open;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    if (!was) this.onToggle(true);
  }

  /** Refresh chip state when the run ends or restarts under an open report. */
  refresh(): void {
    if (this.open && this.report) this.show(this.report);
  }
}
