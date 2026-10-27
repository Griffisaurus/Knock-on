// Lobby (UI_UX §4.2, mockup board "Lobby"): glass panels over the shallow-focus Tinker Lab render.
//   top left: wordmark + tagline · top right: identity pill (you, your tier, the host)
//   left: Live session (this world, the partner, JOIN) · centre: Your worlds (search, sort, open)
//   right: New world (size, tier-gated; environment, Tinker Lab by default for Desk and Room; title; CREATE)
// Opened from the session menu, the palette, or ?lobby. Switching or creating worlds is host-only
// (the host refuses it otherwise), so other players see why the buttons are off.

import { defaultEnvironment, envSwitchPatch } from '@knockon/format';
import type { WorldInfo } from '@knockon/net';
import { PRESET_IDS, PRESETS } from '@knockon/parts-data';
import lobbyBackdrop from '../../../../art/style-samples/tinker_lab_lobby.png';
import type { NetClient } from '../net.ts';
import { h, ICON } from './icons.ts';
import { trapFocus } from './a11y.ts';
import { ENVIRONMENTS } from './settingspanel.ts';
import { tierLabel } from './settings.ts';

interface SizeChoice { readonly id: string; readonly label: string; readonly dims: string; readonly minTier: number; readonly envs: readonly string[] }
/** Sizes, tier gates and the environments each hosts: S3's presets (parts-data presets.ts). */
const SIZES: readonly SizeChoice[] = PRESET_IDS.map((id) => {
  const p = PRESETS[id];
  return { id, label: p.name, dims: `${p.size[0]} × ${p.size[2]} m`, minTier: p.minTier, envs: p.environments };
});
const ENV_CHOICES = ENVIRONMENTS.map((e) => ({ id: e.id, label: e.label.replace(/^The /, '') }));
/** Tinker Lab for Desk and Room, the Studio for Warehouse and Arena, the Backlot for Megastructure (format). */
export const defaultEnvFor = (preset: string): string => defaultEnvironment(preset as Parameters<typeof defaultEnvironment>[0]);

export interface LobbyHost {
  net: NetClient;
  tier(): number;
  toast(text: string, level?: 'info' | 'warn'): void;
  onToggle(open: boolean): void;
}

export class Lobby {
  readonly el: HTMLElement;
  private size = 'room';
  private env = 'tinker';
  private envTouched = false;
  private sort: 'modified' | 'title' | 'parts' = 'modified';
  private pendingEnv: string | null = null;
  private readonly made: WorldInfo[] = [];

  constructor(parent: HTMLElement, private readonly host: LobbyHost) {
    this.el = h(`<div id="lobby" role="dialog" aria-modal="true" aria-label="Lobby" hidden>
      <img class="lb-bg" alt="" src="${lobbyBackdrop}"/><div class="lb-shade"></div>
      <div class="lb-mark"><div class="lb-word">KNOCK<svg width="58" height="34" viewBox="0 0 58 34" aria-hidden="true"><path d="M2 25 L40 18 L40.6 24.6 Z" fill="#FF5B2E"/><circle cx="42" cy="21" r="6" fill="#FFC870"/><circle cx="42" cy="21" r="3" fill="#FFF4E0"/><path d="M49 13l4-5M51 21l5 1M48 28l3 4" stroke="#FF8A2A" stroke-width="2.5" stroke-linecap="round"/></svg>ON</div>
        <div class="lb-tag">Every action has an overreaction.</div></div>
      <div class="lb-id glass"><span class="av"></span><b class="me"></b><span class="sub"></span><button class="icon-btn" data-a="close" aria-label="Close the lobby">${ICON.close}</button></div>
      <section class="lb-live glass" aria-label="Live session"></section>
      <section class="lb-worlds glass" aria-label="Your worlds">
        <div class="lb-row"><h2>Your worlds</h2>
          <label class="lb-search">${ICON.search}<input placeholder="Search worlds" aria-label="Search worlds"/></label>
          <select aria-label="Sort worlds"><option value="modified">Last modified</option><option value="title">Name</option><option value="parts">Parts</option></select></div>
        <div class="lb-grid" role="group" aria-label="Worlds"></div>
      </section>
      <section class="lb-new glass" aria-label="New world">
        <h2>New world</h2>
        <span class="sec">Size</span><div class="lb-sizes" role="radiogroup" aria-label="Size"></div>
        <span class="sec">Environment</span><div class="lb-envs" role="radiogroup" aria-label="Environment"></div>
        <label class="lb-title"><span class="sec">Title</span><input maxlength="80" placeholder="Untitled machine" aria-label="World title"/></label>
        <span class="sp"></span>
        <button class="lb-create primary-blue">CREATE WORLD</button>
        <small class="lb-note"></small>
      </section>
    </div>`);
    parent.appendChild(this.el);
    this.trap = trapFocus(this.el, () => this.open);
    (this.el.querySelector('[data-a=close]') as HTMLElement).onclick = () => this.toggle(false);
    const search = this.el.querySelector('.lb-search input') as HTMLInputElement;
    search.oninput = () => this.renderWorlds();
    search.onkeydown = (e) => e.stopPropagation();
    const sort = this.el.querySelector('.lb-worlds select') as HTMLSelectElement;
    sort.onchange = () => { this.sort = sort.value as typeof this.sort; this.renderWorlds(); };
    (this.el.querySelector('.lb-title input') as HTMLInputElement).onkeydown = (e) => { if (e.key === 'Enter') this.create(); e.stopPropagation(); };
    (this.el.querySelector('.lb-create') as HTMLElement).onclick = () => this.create();
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.toggle(false); e.stopPropagation(); } });
    host.net.on((e) => {
      if (e.type === 'world' && this.pendingEnv) {
        const env = this.pendingEnv;
        this.pendingEnv = null;
        // the new world opens with the format default; set the chosen set right away
        setTimeout(() => { const d = host.net.store?.doc; if (d && d.env.environment !== env) host.net.submit({ k: 'EnvUpdate', patch: envSwitchPatch(d.env, env) }); }, 0); // U5 (M5): with its gravity and air (W5)
      }
      if (this.open && (e.type === 'peers' || e.type === 'world' || e.type === 'status')) this.render();
    });
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(show = !this.open): void {
    if (show === this.open) return;
    if (show) this.trap.opened();
    this.el.hidden = !show;
    if (show) { this.render(); (this.el.querySelector('.lb-create') as HTMLElement).focus(); } else this.trap.closed();
    this.host.onToggle(show);
  }
  // U4: Tab stays inside the lobby while it's open; focus returns to the opener
  private trap!: { opened(): void; closed(): void };

  private isHost(): boolean { return this.host.net.me?.isHost ?? false; }

  private render(): void {
    const net = this.host.net;
    const me = net.me;
    const av = this.el.querySelector('.lb-id .av') as HTMLElement;
    av.textContent = (me?.name ?? '?').slice(0, 1).toUpperCase();
    av.dataset.slot = String(me?.slot ?? 1);
    (this.el.querySelector('.lb-id .me') as HTMLElement).textContent = me ? 'You' : 'Connecting…';
    (this.el.querySelector('.lb-id .sub') as HTMLElement).textContent = `${tierLabel(this.host.tier())} tier · ${location.hostname}`;
    this.renderLive();
    this.renderWorlds();
    this.renderNew();
  }

  private renderLive(): void {
    const net = this.host.net, doc = net.store?.doc, partner = net.partner();
    const box = this.el.querySelector('.lb-live') as HTMLElement;
    const envName = ENVIRONMENTS.find((e) => e.id === doc?.env.environment)?.label.replace(/^The /, '') ?? doc?.env.environment ?? '…';
    box.innerHTML = `
      <div class="lb-live-h"><span class="dot"></span><span class="sec">Live session</span></div>
      <div class="lb-thumb" data-env="${doc?.env.environment ?? ''}"><span class="lb-thumb-ic">${ICON.cube}</span></div>
      <div><b class="lb-wt"></b><small class="lb-wm"></small></div>
      <div class="lb-partner"><span class="av"></span><span class="nm"></span><small class="mono"></small></div>
      <button class="lb-join primary"></button>`;
    (box.querySelector('.lb-wt') as HTMLElement).textContent = (document.querySelector('#worldcard .wc-title') as HTMLElement | null)?.textContent ?? 'This world';
    (box.querySelector('.lb-wm') as HTMLElement).textContent = `${envName} · ${cap(doc?.env.preset ?? 'room')} · ${doc?.parts.size ?? 0} parts`;
    const pav = box.querySelector('.lb-partner .av') as HTMLElement;
    pav.textContent = (partner?.name ?? '·').slice(0, 1).toUpperCase();
    pav.dataset.slot = String(partner?.slot ?? 0);
    (box.querySelector('.lb-partner .nm') as HTMLElement).textContent = partner ? `${partner.name} is building` : 'Nobody else here yet';
    (box.querySelector('.lb-partner small') as HTMLElement).textContent = net.clock.ready ? `${Math.round(net.clock.rtt)} ms` : '';
    const join = box.querySelector('.lb-join') as HTMLButtonElement;
    join.textContent = partner ? `JOIN ${partner.name.toUpperCase()}` : 'BACK TO BUILDING';
    join.onclick = () => this.toggle(false);
  }

  private worlds(): WorldInfo[] {
    const seen = new Set<string>();
    return [...this.made, ...this.host.net.worlds].filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  }

  private renderWorlds(): void {
    const q = (this.el.querySelector('.lb-search input') as HTMLInputElement).value.trim().toLowerCase();
    const grid = this.el.querySelector('.lb-grid') as HTMLElement;
    grid.innerHTML = '';
    const list = this.worlds().filter((w) => !q || w.title.toLowerCase().includes(q));
    list.sort((a, b) => this.sort === 'title' ? a.title.localeCompare(b.title) : this.sort === 'parts' ? b.parts - a.parts : b.modified - a.modified);
    const current = this.host.net.worldId;
    for (const w of list) {
      const t = h<HTMLButtonElement>(`<button class="wc"><div class="th" data-preset="${w.preset}"><span>${ICON.cube}</span></div>
        <div class="wc-t"><b></b><small></small></div></button>`);
      (t.querySelector('b') as HTMLElement).textContent = w.title;
      (t.querySelector('small') as HTMLElement).textContent = `${cap(w.preset)} · ${w.parts} parts · ${when(w.modified)}`;
      if (w.id === current) { t.classList.add('cur'); t.title = 'You’re in this world'; }
      t.onclick = () => this.openWorld(w);
      grid.appendChild(t);
    }
    if (!list.length) grid.appendChild(h('<p class="lb-empty">No worlds match.</p>'));
  }

  private renderNew(): void {
    const tier = this.host.tier();
    const sizes = this.el.querySelector('.lb-sizes') as HTMLElement;
    sizes.innerHTML = '';
    for (const s of SIZES) {
      const locked = tier < s.minTier;
      const b = h<HTMLButtonElement>(`<button class="opt" role="radio" aria-checked="${s.id === this.size}"><span class="nm"></span><small></small></button>`);
      if (locked) b.querySelector('.nm')!.insertAdjacentHTML('beforebegin', ICON.lock);
      (b.querySelector('.nm') as HTMLElement).textContent = s.label;
      (b.querySelector('small') as HTMLElement).textContent = locked ? `needs ${tierLabel(s.minTier)}` : s.id === 'room' ? `${s.dims} · default` : s.dims;
      b.classList.toggle('on', s.id === this.size);
      b.disabled = locked;
      b.onclick = () => { this.size = s.id; if (!this.envTouched) this.env = defaultEnvFor(s.id); this.renderNew(); };
      sizes.appendChild(b);
    }
    const envs = this.el.querySelector('.lb-envs') as HTMLElement;
    envs.innerHTML = '';
    const hosts = SIZES.find((s) => s.id === this.size)?.envs ?? [];
    if (!hosts.includes(this.env)) this.env = defaultEnvFor(this.size);
    for (const e of ENV_CHOICES) {
      const off = !hosts.includes(e.id);
      const b = h<HTMLButtonElement>(`<button class="opt env" role="radio" aria-checked="${e.id === this.env}"><span class="nm"></span>${off ? '<small></small>' : ''}</button>`);
      (b.querySelector('.nm') as HTMLElement).textContent = e.label;
      if (off) {
        const fits = SIZES.filter((s) => s.envs.includes(e.id)).map((s) => s.label);
        (b.querySelector('small') as HTMLElement).textContent = fits.length ? `${fits.join(', ')} only` : 'not yet';
        b.disabled = true;
      }
      b.classList.toggle('on', e.id === this.env);
      b.onclick = () => { this.env = e.id; this.envTouched = true; this.renderNew(); };
      envs.appendChild(b);
    }
    const create = this.el.querySelector('.lb-create') as HTMLButtonElement;
    create.disabled = !this.isHost();
    (this.el.querySelector('.lb-note') as HTMLElement).textContent = this.isHost() ? '' : 'Only the host can create or switch worlds.';
  }

  private openWorld(w: WorldInfo): void {
    if (w.id === this.host.net.worldId) { this.toggle(false); return; }
    if (!this.isHost()) { this.host.toast('Only the host can switch worlds', 'warn'); return; }
    this.host.net.send(['join', { worldId: w.id }]);
    this.host.toast(`Opening “${w.title}”…`);
    this.toggle(false);
  }

  private create(): void {
    if (!this.isHost()) { this.host.toast('Only the host can create worlds', 'warn'); return; }
    const title = (this.el.querySelector('.lb-title input') as HTMLInputElement).value.trim() || 'Untitled machine';
    this.pendingEnv = this.env;
    this.host.net.send(['join', { newWorld: { name: title.slice(0, 80), preset: this.size } }]);
    this.made.unshift({ id: `pending-${Date.now()}`, title, preset: this.size, parts: 0, modified: Date.now() } as WorldInfo);
    this.host.toast(`Creating “${title}”…`);
    this.toggle(false);
  }
}

const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);
function when(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
