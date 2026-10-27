// Run HUD (UI_UX §4.8, mockup board "Run HUD"): four glass surfaces while a run plays.
//   partner / camera pill (top left) · K.O. counter (top centre) · event feed (top right) · run bar (bottom)
// The run bar has the timeline (event markers by channel, bake shading with "baked 8.5 s", playhead, drag
// to scrub) and the controls (back 1 s, play/pause, forward 1 s, speed, SIM badge, camera, Stop).
// No surface changes size during a run (§8): fixed widths, fixed feed height, fades only. The K.O.
// counter and the timeline update at 15 Hz. After 2 s without mouse movement the pill and feed fade out
// and the counter and run bar drop to 60 %.

import type { SimEvent } from '@knockon/sim';
import type { CamMode } from '../cameras.ts';
import { CHANNEL_HEX } from '../catalog.ts';
import type { NetClient } from '../net.ts';
import { SPEEDS, type RunController } from '../run.ts';
import { FeedModel, KoMeter, type FeedItem } from './feed.ts';
import { h, ICON, partIcon } from './icons.ts';

const EVENT_CHANNEL: Record<string, string> = {
  Detonate: CHANNEL_HEX.heat, Ignite: CHANNEL_HEX.heat, FuseLit: CHANNEL_HEX.heat, FuseEnd: CHANNEL_HEX.heat, Extinguish: CHANNEL_HEX.air,
  Signal: CHANNEL_HEX.signal, Press: CHANNEL_HEX.signal, Powered: CHANNEL_HEX.power, Brownout: '#FFB020', Jam: '#FFB020',
  Cut: CHANNEL_HEX.tension, Pop: '#FF3DAE', Break: CHANNEL_HEX.impact, Launch: CHANNEL_HEX.impact, Toggle: CHANNEL_HEX.signal, Ring: CHANNEL_HEX.signal,
};
const BIG = new Set(['Detonate', 'Break', 'Pop', 'Ignite']);
const CAMS: readonly [CamMode, string, keyof typeof ICON][] = [['director', 'Director', 'camera'], ['orbit', 'Orbit', 'orbit'], ['ride', 'Ride', 'ride'], ['overview', 'Overview', 'overview']];
const CAM_LABEL: Record<string, string> = { director: 'Director cam', orbit: 'Orbit cam', ride: 'Ride cam', overview: 'Overview' };

export interface RunHudLinks {
  net: NetClient;
  /** Part type of an id (3D icons in the feed). */
  partType(id: number): string;
  camMode(): CamMode;
  setCamMode(m: CamMode): void;
}

export class RunBar {
  readonly el: HTMLElement;
  readonly pill: HTMLElement;
  readonly ko: HTMLElement;
  readonly feed: HTMLElement;
  private readonly run: RunController;
  private readonly partName: (id: number) => string;
  private links: RunHudLinks | null = null;
  private readonly $: (s: string) => HTMLElement;
  private readonly meter = new KoMeter();
  private readonly feedModel = new FeedModel();
  private readonly feedRows = new Map<number, HTMLElement>();
  private markCount = 0;
  private scale = 10; // seconds the timeline spans
  private scrubbing = false;
  private lastPaint = 0;
  private lastMove = 0;
  private starter = 0;
  private shownKo = -1;
  private wasShown = false;
  private runId: string | null = null;
  /** Kept for callers that read it (the Cascade Report counts differently, see M2_NOTES_D §11). */
  get koCount(): number { return this.meter.count; }

  constructor(parent: HTMLElement, run: RunController, partName: (id: number) => string) {
    this.run = run;
    this.partName = partName;
    this.pill = h(`<div id="runpill" class="glass run-surface" aria-live="polite">
      <span class="rp-av">?</span><span class="rp-who">The run is on</span><span class="rp-sep"></span>
      <span class="rp-cam"><i></i><span>Orbit cam</span></span></div>`);
    this.ko = h(`<div id="kocounter" class="glass run-surface" role="group" aria-label="K.O. count: knock-on steps" title="K.O.: knock-on steps, one part setting off another (the Cascade Report counts the same)">
      <span class="ko-l">K.O.</span><span class="ko-n">0</span>
      <span class="ko-side"><span class="ko-rate">+0 this second</span><span class="ko-t">at 0.0 s</span></span></div>`);
    this.feed = h(`<section id="eventfeed" class="glass run-surface" aria-live="off" aria-label="Events">
      <div class="ev-empty">Click THE BUTTON to press it · Ctrl+click shoves a part</div></section>`);
    this.el = h(`<section id="runbar" class="glass run-surface" aria-label="Run bar">
      <div class="rb-row">
        <span class="rb-time">0.00 s</span>
        <div class="rb-track" role="slider" aria-label="Timeline" tabindex="0" aria-valuemin="0">
          <div class="rb-rail"></div><div class="rb-bake"></div><div class="rb-played"></div><div class="rb-marks"></div>
          <div class="rb-bakehead"><span>baked 0.0 s</span></div><div class="rb-head"></div>
        </div>
        <span class="rb-total">10.0 s</span>
      </div>
      <div class="rb-row">
        <button class="rb-tb" data-a="back" aria-label="Back 1 second" title="Back 1 s">${ICON.back1}</button>
        <button class="rb-play" data-a="play" aria-label="Pause (Space)" title="Space">${ICON.pause}</button>
        <button class="rb-tb" data-a="fwd" aria-label="Forward 1 second" title="Forward 1 s">${ICON.fwd1}</button>
        <div class="seg rb-speeds" role="group" aria-label="Speed"></div>
        <div class="rb-simwrap" data-dilated="false">
          <span class="rb-sim mono" hidden>SIM 1.00×</span>
          <button class="rb-baw" role="switch" aria-checked="false" title="Bake & Watch: bake the whole run first, then play it back smoothly"><span class="switch"><i></i></span>Bake &amp; Watch</button>
        </div>
        <span class="rb-solo" hidden>SOLO PREVIEW</span>
        <span class="rb-fill"><span class="rb-bakeprog" hidden><span class="lbl">Baking</span><span class="bar"><i></i></span><span class="txt mono"></span><button class="rb-bakeskip" title="Stop baking and play what's baked">Play now</button></span></span>
        <div class="seg rb-cams" role="group" aria-label="Camera"></div>
        <button class="rb-stop" data-a="stop" title="Stop (Backspace)" aria-label="Stop (Backspace)"><i>${ICON.stop}</i>Stop<kbd>Backspace</kbd></button>
      </div></section>`);
    parent.append(this.pill, this.ko, this.feed, this.el);
    this.$ = (s: string): HTMLElement => this.el.querySelector(s) as HTMLElement;
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.textContent = s === 1 ? '1×' : String(s);
      b.setAttribute('aria-label', `Speed ${s}×`);
      b.onclick = () => run.setPlay({ speed: s });
      this.$('.rb-speeds').appendChild(b);
    }
    for (const [mode, label, icon] of CAMS) {
      const b = h<HTMLButtonElement>(`<button data-cam="${mode}">${ICON[icon]}<span>${label}</span></button>`);
      b.onclick = () => this.links?.setCamMode(mode);
      this.$('.rb-cams').appendChild(b);
    }
    this.$('[data-a=back]').onclick = () => run.jump(-1);
    this.$('[data-a=fwd]').onclick = () => run.jump(1);
    this.$('[data-a=play]').onclick = () => run.primary();
    this.$('[data-a=stop]').onclick = () => run.stop();
    // S3 Bake & Watch (GAME_SPEC §6.5): bake the run first, then play it back from the keyframes
    this.$('.rb-baw').onclick = () => { if (run.bakeProgress) run.cancelBake(); else run.bakeAndWatch(true); this.lastPaint = 0; };
    this.$('.rb-bakeskip').onclick = () => run.cancelBake();
    const track = this.$('.rb-track');
    const seek = (e: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      run.setPlay({ tick: f * this.scale * run.tickRate, paused: true });
    };
    track.addEventListener('pointerdown', (e) => { this.scrubbing = true; track.setPointerCapture(e.pointerId); seek(e); });
    track.addEventListener('pointermove', (e) => { if (this.scrubbing) seek(e); });
    track.addEventListener('pointerup', () => { this.scrubbing = false; });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { run.jump(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); e.stopPropagation(); }
      // U4: Home / End go to the start / the bake head (WAI-ARIA slider)
      if (e.key === 'Home' || e.key === 'End') { run.setPlay({ tick: e.key === 'Home' ? 0 : run.baked, paused: true }); e.preventDefault(); e.stopPropagation(); }
    });
    window.addEventListener('pointermove', () => { this.lastMove = performance.now(); }, { passive: true });
    run.onEvents((evs) => this.onEvents(evs));
  }

  /** Live links the HUD gets after main.ts builds the camera rig (ui/hud.ts attach). */
  bind(links: RunHudLinks): void {
    this.links = links;
    links.net.on((e) => {
      if (e.type === 'run' && (e.msg[0] === 'run.countdown')) this.starter = e.msg[1].by;
    });
  }

  /** A toast during a run lands in the event feed (UI_UX §3). */
  toast(text: string): void {
    const row = h(`<div class="ev ev-text"><span class="ev-l"></span></div>`);
    (row.firstElementChild as HTMLElement).textContent = text;
    this.feed.querySelector('.ev-empty')?.remove();
    this.feed.prepend(row);
    setTimeout(() => row.remove(), 3500);
    this.trimFeed();
  }

  private onEvents(evs: readonly SimEvent[]): void {
    const now = performance.now();
    for (const e of evs) {
      this.meter.add(e);
      const type = this.links?.partType(e.part) ?? '';
      const it = this.feedModel.push(e, type, now, `${(e.tick / this.run.tickRate).toFixed(1)} s`);
      if (it) this.paintFeed(it);
    }
  }

  private paintFeed(it: FeedItem): void {
    let row = this.feedRows.get(it.seq);
    if (!row) {
      row = h(`<div class="ev"><span class="ev-ic"></span><span class="ev-l"></span><small></small></div>`);
      const ic = row.querySelector('.ev-ic') as HTMLElement;
      if (it.type) ic.appendChild(partIcon(it.type, { size: 32 }));
      this.feedRows.set(it.seq, row);
    }
    const name = it.part ? this.partName(it.part) : '';
    (row.querySelector('.ev-l') as HTMLElement).textContent = it.label === 'BREAK' || it.label === 'BOOM' || it.label === 'POP' ? `${name} ${it.label}` : `${it.label} · ${name}`;
    (row.querySelector('small') as HTMLElement).textContent = it.n > 1 ? `×${it.n}` : it.detail;
    this.feed.querySelector('.ev-empty')?.remove();
    for (const r of this.feed.querySelectorAll('.ev.newest')) r.classList.remove('newest');
    row.classList.add('newest');
    this.feed.prepend(row);
    this.trimFeed();
  }

  private trimFeed(): void {
    const live = new Set(this.feedModel.items.map((i) => i.seq));
    for (const [seq, r] of this.feedRows) if (!live.has(seq)) { r.remove(); this.feedRows.delete(seq); }
    const rows = this.feed.querySelectorAll('.ev');
    for (let i = 3; i < rows.length; i++) rows[i]!.remove();
  }

  update(): void {
    const r = this.run;
    const show = r.phase === 'running';
    if (show !== this.wasShown) {
      this.wasShown = show;
      for (const el of [this.el, this.pill, this.ko, this.feed]) el.classList.toggle('on', show);
      if (!show) this.resetRun();
    }
    if (!show) return;
    if (r.runId !== this.runId) { this.resetRun(); this.runId = r.runId; }
    const now = performance.now();
    document.documentElement.classList.toggle('run-idle', now - this.lastMove > 2000 && !this.scrubbing);
    if (now - this.lastPaint < 66) return; // 15 Hz (UI_UX §8)
    this.lastPaint = now;
    if (this.feedModel.expire(now)) this.trimFeed();
    const sec = r.tick / r.tickRate;
    const scale = Math.max(this.scale, Math.ceil((r.baked / r.tickRate + 2) / 10) * 10);
    const rescale = scale !== this.scale;
    this.scale = scale;
    this.$('.rb-time').textContent = `${sec.toFixed(2)} s`;
    this.$('.rb-total').textContent = `${scale.toFixed(1)} s`;
    const play = this.$('[data-a=play]');
    const paused = r.paused;
    if (play.dataset.paused !== String(paused)) {
      play.dataset.paused = String(paused);
      play.innerHTML = paused ? ICON.play : ICON.pause;
      play.setAttribute('aria-label', paused ? 'Play (Space)' : 'Pause (Space)');
    }
    [...this.$('.rb-speeds').children].forEach((b, i) => { const on = SPEEDS[i] === r.speed; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const bakedSec = r.baked / r.tickRate;
    const bakeF = Math.min(1, bakedSec / scale), headF = Math.min(1, sec / scale);
    this.$('.rb-bake').style.width = `${bakeF * 100}%`;
    this.$('.rb-played').style.width = `${headF * 100}%`;
    this.$('.rb-head').style.left = `${headF * 100}%`;
    const bh = this.$('.rb-bakehead');
    bh.style.left = `${bakeF * 100}%`;
    (bh.firstElementChild as HTMLElement).textContent = `baked ${bakedSec.toFixed(1)} s`;
    const track = this.$('.rb-track');
    track.setAttribute('aria-valuenow', sec.toFixed(2));
    track.setAttribute('aria-valuemax', String(scale));
    track.setAttribute('aria-valuetext', `${sec.toFixed(1)} of ${scale.toFixed(0)} seconds, baked to ${(r.baked / r.tickRate).toFixed(1)}`);
    // time dilation: the sim runs slower than real time while playback waits on our bake head
    const slow = r.simRate < 0.95 && (r.waiting || r.dilated);
    const sim = this.$('.rb-sim');
    sim.hidden = !slow;
    if (slow) sim.textContent = `SIM ${r.simRate.toFixed(2)}×`;
    const bake = r.bakeProgress;
    const wrap = this.$('.rb-simwrap');
    wrap.dataset.dilated = String(slow && !bake);
    const baw = this.$('.rb-baw');
    baw.setAttribute('aria-checked', String(!!bake));
    baw.querySelector('.switch')!.setAttribute('aria-checked', String(!!bake));
    const prog = this.$('.rb-bakeprog');
    prog.hidden = !bake;
    if (bake) {
      const f = bake.target > 0 ? Math.min(1, bake.baked / bake.target) : 0;
      (prog.querySelector('.bar i') as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      const eta = r.bakeEtaS;
      (prog.querySelector('.txt') as HTMLElement).textContent = `${(bake.baked / r.tickRate).toFixed(1)} s · ${eta === null ? 'measuring' : `${Math.ceil(eta)} s left`}`;
      prog.title = `Baking ${(bake.baked / r.tickRate).toFixed(1)} of up to ${(bake.target / r.tickRate).toFixed(0)} s (stops early once the machine is still)${bake.rate ? ` · ${(bake.rate / r.tickRate).toFixed(2)}× real time` : ''} · ${bake.keyframeMB.toFixed(1)} MB of keyframes`;
    }
    this.$('.rb-solo').hidden = !r.solo;
    // K.O. counter
    const ko = this.meter.countAt(r.tick); // UIFIX (D122): knock-on steps at the playhead (as the Cascade Report counts)
    if (ko !== this.shownKo) {
      this.shownKo = ko;
      const n = this.ko.querySelector('.ko-n') as HTMLElement;
      n.textContent = String(ko);
      n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
    }
    (this.ko.querySelector('.ko-rate') as HTMLElement).textContent = `+${this.meter.lastSecond(r.tick, r.tickRate)} this second`;
    (this.ko.querySelector('.ko-t') as HTMLElement).textContent = `at ${sec.toFixed(2)} s`;
    // pill: who started it, live camera
    const net = this.links?.net;
    const by = this.starter;
    const who = r.solo ? 'Solo preview (only you)' : !by ? 'The run is on' : by === net?.me?.slot ? 'You started the run' : `${net?.players.find((p) => p.slot === by)?.name ?? 'Your partner'} started the run`;
    const av = this.pill.querySelector('.rp-av') as HTMLElement;
    const avName = r.solo || by === net?.me?.slot ? net?.me?.name : net?.players.find((p) => p.slot === by)?.name;
    av.textContent = (avName ?? '?').slice(0, 1).toUpperCase();
    av.dataset.slot = String(r.solo ? net?.me?.slot ?? 1 : by || 1);
    (this.pill.querySelector('.rp-who') as HTMLElement).textContent = who;
    const mode = this.links?.camMode() ?? 'orbit';
    (this.pill.querySelector('.rp-cam span') as HTMLElement).textContent = CAM_LABEL[mode] ?? mode;
    for (const b of this.$('.rb-cams').children) { const on = (b as HTMLElement).dataset.cam === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    // markers: one per notable event, coloured by channel
    const marks = this.$('.rb-marks');
    if (this.markCount > r.log.length) { marks.innerHTML = ''; this.markCount = 0; }
    for (; this.markCount < r.log.length; this.markCount++) {
      const e = r.log[this.markCount]!;
      const c = EVENT_CHANNEL[e.kind];
      if (!c) continue;
      const m = document.createElement('i');
      m.style.setProperty('--c', c);
      if (BIG.has(e.kind)) m.className = 'big';
      m.dataset.t = String(e.tick);
      m.style.left = `${(e.tick / r.tickRate / scale) * 100}%`;
      marks.appendChild(m);
    }
    if (rescale) for (const m of marks.children) (m as HTMLElement).style.left = `${(Number((m as HTMLElement).dataset.t) / r.tickRate / scale) * 100}%`;
    for (const m of marks.children) (m as HTMLElement).classList.toggle('ahead', Number((m as HTMLElement).dataset.t) > r.tick);
  }

  private resetRun(): void {
    this.$('.rb-marks').innerHTML = '';
    this.markCount = 0;
    this.meter.reset();
    this.feedModel.clear();
    for (const r of this.feedRows.values()) r.remove();
    this.feedRows.clear();
    this.feed.querySelectorAll('.ev').forEach((e) => e.remove());
    if (!this.feed.querySelector('.ev-empty')) this.feed.appendChild(h('<div class="ev-empty">Click THE BUTTON to press it · Ctrl+click shoves a part</div>'));
    this.scale = 10;
    this.shownKo = -1;
    document.documentElement.classList.remove('run-idle');
  }
}
