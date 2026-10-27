// Parts tray (UI_UX §4.3, D77, mockup board "Build HUD"): the bottom glass surface that replaces the dock.
// Top row: family tabs (All parts · Rollers · Frame · Drive · Air · Power · Boom · Contraptions · Fun ·
// Modules · Favourites), search, L (Library). Icon row: large 3D part icons that scroll sideways; in
// "All parts" the first ten tiles are the hotbar 1–0 (drag a tile onto one to assign it, right-click
// clears). Click arms placement, drag into the viewport places, hover opens the part card.

import { partDef } from '../catalog.ts';
import { Hotbar } from './hotbar.ts';
import { FAMILY_ICON, h, ICON, partIcon } from './icons.ts';
import type { ModuleSummary } from './modules.ts';
import { cards, familyLabel, FAMILY_TABS, UI_PARTS, type PartCard } from './panels.ts';
import { rovingFocus } from './a11y.ts';

/** Backlot sculpting (S3 TerrainBrushTool): the tray's Terrain tab, shown only on the Backlot. */
export interface TerrainUi {
  available(): boolean;
  armed(): boolean;
  brush(): number;
  radius(): number;
  strength(): number;
  arm(brush: number): void;
  setRadius(m: number): void;
  setStrength(s: number): void;
}

export const BRUSHES: readonly [number, string, string][] = [
  [0, 'Raise', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19c4 0 5-9 10-9s6 9 10 9"/><path d="M12 7V2M9.5 4.5 12 2l2.5 2.5"/></svg>'],
  [1, 'Lower', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10c4 0 5 9 10 9s6-9 10-9"/><path d="M12 2v6M9.5 5.5 12 8l2.5-2.5"/></svg>'],
  [2, 'Flatten', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18c3 0 4-4 6-4h8c2 0 3 4 6 4"/><path d="M6 9h12"/></svg>'],
  [3, 'Smooth', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16c3-3 5 2 8-1s4-4 6-2 4 3 6 1"/><path d="M4 8c3-2 6 1 9-1s5-1 7 0" stroke-dasharray="2 3"/></svg>'],
];
const RADII = [1, 3, 8, 20];
const STRENGTHS: readonly [number, string][] = [[200, 'Soft'], [500, 'Normal'], [1000, 'Strong']];

export interface TrayHost {
  terrain?: TerrainUi;
  pick(type: string): void;
  startDrag(type: string, e: PointerEvent): void;
  openLibrary(): void;
  modules(): ModuleSummary[];
  placeModule(id: number): void;
}

export class PartsTray {
  readonly el: HTMLElement;
  private readonly row: HTMLElement;
  private readonly search: HTMLInputElement;
  private tab = 'all';
  private active: string | null = null;
  private dragOver = -1;

  constructor(el: HTMLElement, private readonly hotbar: Hotbar, private readonly card: PartCard, private readonly host: TrayHost) {
    this.el = el;
    el.innerHTML = `
      <div class="tray-top">
        <div class="tabs tray-tabs" role="tablist" aria-label="Part families"></div>
        <label class="tray-search">${ICON.search}<input placeholder="Search parts…" aria-label="Search parts"/><button class="kbd-btn" type="button" title="Open the Library (L)" aria-label="Open the Library (L)"><kbd>L</kbd></button></label>
      </div>
      <div class="tray-row" role="listbox" aria-label="Parts" aria-orientation="horizontal"></div>`;
    this.row = el.querySelector('.tray-row') as HTMLElement;
    this.search = el.querySelector('input') as HTMLInputElement;
    this.search.oninput = () => this.render();
    this.search.onkeydown = (e) => {
      if (e.key === 'Escape') { this.search.value = ''; this.render(); this.search.blur(); }
      if (e.key === 'Enter') { const first = this.row.querySelector<HTMLElement>('.pt[data-type]'); if (first) host.pick(first.dataset.type!); this.search.blur(); }
      e.stopPropagation();
    };
    (el.querySelector('.tray-search .kbd-btn') as HTMLElement).onclick = () => host.openLibrary();
    const tabs = el.querySelector('.tray-tabs') as HTMLElement;
    const tab = (id: string, label: string, icon: string): void => {
      const b = h<HTMLButtonElement>(`<button class="tab" role="tab" data-tab="${id}">${icon}<span></span></button>`);
      (b.lastElementChild as HTMLElement).textContent = label;
      b.onclick = () => { this.tab = id; this.render(); };
      tabs.appendChild(b);
    };
    tab('all', 'All parts', ICON.grid);
    for (const f of FAMILY_TABS) tab(f, familyLabel(f), FAMILY_ICON[f] ?? ICON.cube);
    tabs.appendChild(h('<span class="tab-sep" aria-hidden="true"></span>'));
    tab('modules', 'Modules', ICON.modules);
    tab('favourites', 'Favourites', ICON.starLine);
    if (host.terrain) {
      tab('terrain', 'Terrain', BRUSHES[0]![2]);
      (tabs.lastElementChild as HTMLElement).classList.add('tab-terrain');
    }
    // U4: one Tab stop each for the family tabs and the icon row; arrows move, Enter / Space pick
    rovingFocus(tabs, { selector: '.tab:not([hidden])', activateOnMove: true });
    rovingFocus(this.row, { selector: '.pt' });
    // horizontal wheel scrolling on the icon row
    this.row.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.row.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    hotbar.on(() => this.render());
    this.render();
  }

  /** The armed part (outlined in Beam), or null when another tool is active. */
  setActive(type: string | null): void {
    if (type === this.active) return;
    this.active = type;
    for (const t of this.row.querySelectorAll<HTMLElement>('.pt')) { const on = !!type && t.dataset.type === type; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }
    this.row.querySelector<HTMLElement>('.pt.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** While dragging a part over the tray: which hotbar tile it would land on (-1 = none). */
  dropTarget(x: number, y: number): number {
    if (this.tab !== 'all') return -1;
    for (const t of this.row.querySelectorAll<HTMLElement>('.pt[data-slot]')) {
      const r = t.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(t.dataset.slot);
    }
    return -1;
  }

  markDrop(i: number): void {
    if (i === this.dragOver) return;
    this.dragOver = i;
    for (const t of this.row.querySelectorAll<HTMLElement>('.pt[data-slot]')) t.classList.toggle('drop', Number(t.dataset.slot) === i);
  }

  render(): void {
    for (const b of this.el.querySelectorAll<HTMLElement>('.tray-tabs .tab')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const terr = this.host.terrain;
    const terrOk = !!terr?.available();
    (this.el.querySelector('.tab-terrain') as HTMLElement | null)?.toggleAttribute('hidden', !terrOk);
    if (this.tab === 'terrain' && !terrOk) this.tab = 'all';
    const q = this.search.value.trim().toLowerCase();
    this.row.innerHTML = '';
    if (this.tab === 'modules') { this.renderModules(q); return; }
    if (this.tab === 'terrain' && terr) { this.renderTerrain(terr); return; }
    const match = (type: string): boolean => {
      if (!q) return true;
      const d = partDef(type);
      return !!d && `${d.name} ${d.tag} ${d.family} ${cards()[type]?.does ?? ''}`.toLowerCase().includes(q);
    };
    let list: { type: string | null; slot: number }[];
    if (this.tab === 'all' && !q) {
      // the hotbar first (empty slots stay as drop targets), then everything else
      const bar = this.hotbar.slots.map((t, i) => ({ type: t, slot: i }));
      const rest = UI_PARTS.filter((p) => this.hotbar.slotOf(p.type) < 0).map((p) => ({ type: p.type, slot: -1 }));
      list = [...bar, ...rest];
    } else {
      list = UI_PARTS.filter((p) => (this.tab === 'all' || (this.tab === 'favourites' ? this.hotbar.favourites.has(p.type) : p.family === this.tab)) && match(p.type))
        .map((p) => ({ type: p.type, slot: this.hotbar.slotOf(p.type) }));
    }
    for (const { type, slot } of list) this.row.appendChild(this.tile(type, slot, this.tab === 'all' && !q));
    if (!list.length) {
      const e = document.createElement('p');
      e.className = 'tray-empty';
      e.textContent = this.tab === 'favourites' && !q ? 'No favourites yet: hover a part in the Library and press F.' : 'Nothing matches.';
      this.row.appendChild(e);
    }
  }

  private tile(type: string | null, slot: number, isBar: boolean): HTMLElement {
    const d = type ? partDef(type) : undefined;
    const t = h<HTMLButtonElement>(`<button class="pt" role="option"></button>`);
    if (slot >= 0) { const k = document.createElement('i'); k.textContent = Hotbar.keyOf(slot); t.appendChild(k); }
    if (isBar && slot >= 0) t.dataset.slot = String(slot);
    if (!type || !d) {
      t.classList.add('empty');
      t.innerHTML += `<span class="picon line">${ICON.plus}</span><b>Empty</b>`;
      t.setAttribute('aria-selected', 'false');
      t.title = `Slot ${Hotbar.keyOf(slot)}: drag a part here`;
      t.setAttribute('aria-label', t.title);
      return t;
    }
    t.dataset.type = type;
    t.appendChild(partIcon(type, { size: 72 }));
    const b = document.createElement('b');
    b.textContent = d.name;
    t.appendChild(b);
    t.setAttribute('aria-label', `${d.name}, ${d.tag}${slot >= 0 ? `, key ${Hotbar.keyOf(slot)}` : ''}`);
    if (type === this.active) t.classList.add('on');
    t.setAttribute('aria-selected', String(type === this.active));
    t.onclick = () => this.host.pick(type);
    t.onpointerdown = (e) => { if (e.button === 0) this.host.startDrag(type, e); };
    t.onpointerenter = () => this.card.hover(type, t, 'above');
    t.onpointerleave = () => this.card.leave();
    // U4: keyboard focus shows the same part card (Needs / Does) as hover
    t.onfocus = () => { if (t.matches(':focus-visible')) this.card.hover(type, t, 'above'); };
    t.onblur = () => this.card.leave();
    t.setAttribute('aria-describedby', 'partcard');
    t.oncontextmenu = (e) => { e.preventDefault(); if (isBar && slot >= 0) this.hotbar.clear(slot); };
    return t;
  }

  /** Show the Terrain tab (the Backlot) when it becomes available, and repaint the brush state. */
  syncTerrain(): void {
    const ok = !!this.host.terrain?.available();
    const t = this.el.querySelector('.tab-terrain') as HTMLElement | null;
    if (t && t.hidden === ok) this.render();
    else if (this.tab === 'terrain') this.render();
  }

  /** Terrain tab: the four brushes as tiles, then radius and strength (S3 TerrainBrushTool). */
  private renderTerrain(t: TerrainUi): void {
    for (const [id, label, icon] of BRUSHES) {
      const tile = h<HTMLButtonElement>(`<button class="pt brush" role="option" aria-selected="${t.armed() && t.brush() === id}"><span class="picon line">${icon}</span><b></b></button>`);
      (tile.querySelector('b') as HTMLElement).textContent = label;
      tile.classList.toggle('on', t.armed() && t.brush() === id);
      tile.title = `${label}: drag on the ground to sculpt (Esc stops)`;
      tile.onclick = () => { t.arm(id); this.render(); };
      this.row.appendChild(tile);
    }
    const opts = h(`<div class="brush-opts well"><span class="sec">Radius</span><div class="seg r"></div><span class="sec">Strength</span><div class="seg s"></div></div>`);
    for (const m of RADII) {
      const b = h<HTMLButtonElement>(`<button aria-label="Radius ${m} metres">${m} m</button>`);
      b.classList.toggle('on', Math.abs(t.radius() - m) < 0.01);
      b.setAttribute('aria-pressed', String(Math.abs(t.radius() - m) < 0.01));
      b.onclick = () => { t.setRadius(m); this.render(); };
      opts.querySelector('.seg.r')!.appendChild(b);
    }
    for (const [v, label] of STRENGTHS) {
      const b = h<HTMLButtonElement>(`<button aria-label="Strength ${label}">${label}</button>`);
      b.classList.toggle('on', t.strength() === v);
      b.setAttribute('aria-pressed', String(t.strength() === v));
      b.onclick = () => { t.setStrength(v); this.render(); };
      opts.querySelector('.seg.s')!.appendChild(b);
    }
    this.row.appendChild(opts);
  }

  private renderModules(q: string): void {
    const mods = this.host.modules().filter((m) => !m.bad && (!q || m.name.toLowerCase().includes(q)));
    for (const m of mods) {
      const t = h<HTMLButtonElement>(`<button class="pt mod" role="option" aria-selected="false"><span class="picon line">${ICON.modules}</span><b></b></button>`);
      (t.querySelector('b') as HTMLElement).textContent = m.name;
      const first = m.types[0];
      if (first) t.querySelector('.picon')!.replaceWith(partIcon(first, { size: 72 }));
      t.title = `${m.name}: ${m.parts} parts · click to place`;
      t.onclick = () => this.host.placeModule(m.id);
      this.row.appendChild(t);
    }
    if (!mods.length) {
      const e = document.createElement('p');
      e.className = 'tray-empty';
      e.textContent = 'No modules yet. Select a gadget, then palette › “Save selection as module”.';
      this.row.appendChild(e);
    }
  }
}
