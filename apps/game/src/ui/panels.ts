// Build HUD panels (UI_UX §4.4–4.7, mockup boards "Library" and "Command palette + radial"):
//   Library (L): 780 px glass panel in the Inspector's place; part cards with 3D renders, hotbar number,
//     favourite star, channel glyphs in → out; tabs, channel filter chips, hover detail; Modules tab.
//   Command palette (Ctrl/⌘ K): centred 660 px glass dialog; grouped fuzzy results with highlighted
//     letters, 3D icons for parts, key hints; `>` actions, `@` parts in the scene, `?` help.
//   Radial menu (hold Q): 8 glass wedges around the cursor, the highlighted one in the selection blue,
//     Delete tinted red, a centre cancel zone, and a pill with the part's 3D icon.

import * as partsData from '@knockon/parts-data';
import { PALETTE, partDef } from '../catalog.ts';
import { rank, highlightRuns, type PaletteGroup } from './fuzzy.ts';
import { Hotbar } from './hotbar.ts';
import { esc, FAMILY_ICON, glyph, h, ICON, partIcon, type IconName } from './icons.ts';
import type { ModuleSummary } from './modules.ts';
import { announce } from './a11y.ts';

type Card = { needs: string; does: string; tips: string[] };
/** Library card text, when @knockon/parts-data provides CARDS (cards.ts). */
export const cards = (): Record<string, Card> => ((partsData as unknown as { CARDS?: Record<string, Card> }).CARDS ?? {});

export const FAMILY_LABEL: Record<string, string> = {
  rollers: 'Rollers', frame: 'Frame', drive: 'Drive', air: 'Air', power: 'Power', boom: 'Boom', contraptions: 'Contraptions', fun: 'Fun',
  future: 'Future', critters: 'Critters', matter: 'Matter', // M4 (U4): the Matter family (A4)
};
/** Label for a family tab; unknown families (a stream adding one) get their id capitalised, never a blank tab. */
export const familyLabel = (f: string): string => FAMILY_LABEL[f] ?? f.slice(0, 1).toUpperCase() + f.slice(1);
/** Family tabs (UI_UX §4.3), plus any family parts-data has that the spec's list doesn't (M3 Future, critters). */
export const FAMILY_TABS: readonly string[] = (() => {
  const base = ['rollers', 'frame', 'drive', 'air', 'power', 'boom', 'contraptions', 'fun'];
  // Matter right after the spec's families (M4), then the rest alphabetically, critters last
  const rank = (f: string): number => (f === 'matter' ? 0 : f === 'critters' ? 2 : 1);
  const extra = [...new Set(PALETTE.map((p) => p.family as string))].filter((f) => !base.includes(f))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [...base, ...extra];
})();
/** Parts in tab order (the catalogue's dock order puts unknown families first). */
export const UI_PARTS = [...PALETTE].sort((a, b) => FAMILY_TABS.indexOf(a.family) - FAMILY_TABS.indexOf(b.family));

export type ModuleAction = 'place' | 'export' | 'rename' | 'delete';

/** Channels a part takes in and gives out (glyph row "in → out"). */
export function channelsOf(type: string): { ins: string[]; outs: string[] } {
  const d = partDef(type);
  const ins = new Set<string>(), outs = new Set<string>();
  for (const p of d?.ports ?? []) {
    if (p.dir === 'in' || p.dir === 'both') ins.add(p.channel);
    if (p.dir === 'out' || p.dir === 'both') outs.add(p.channel);
  }
  return { ins: [...ins], outs: [...outs] };
}

export function glyphRow(type: string, size = 16): string {
  const { ins, outs } = channelsOf(type);
  const arrow = ins.length && outs.length ? `<svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="to"><path d="M4 12h15M14 7l5 5-5 5"/></svg>` : '';
  return ins.map((c) => glyph(c, size)).join('') + arrow + outs.map((c) => glyph(c, size)).join('');
}

/** Hover detail card shared by the tray and the Library (400 ms delay, a well, not a blurred surface). */
export class PartCard {
  readonly el: HTMLElement;
  private timer = 0;
  private type: string | null = null;
  hotbar: Hotbar | null = null;

  constructor(parent: HTMLElement) {
    this.el = h('<div id="partcard" class="well-pop" role="tooltip" hidden></div>');
    parent.appendChild(this.el);
  }

  /** Show after 400 ms next to `anchor` (side: where to put the card; `edge`: keep clear of this panel). */
  hover(type: string, anchor: HTMLElement, side: 'above' | 'left', edge?: HTMLElement): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(type, anchor, side, edge), this.el.hidden ? 400 : 60);
  }

  leave(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 120);
  }

  hide(): void { clearTimeout(this.timer); this.el.hidden = true; this.type = null; }

  get shownType(): string | null { return this.el.hidden ? null : this.type; }

  private show(type: string, anchor: HTMLElement, side: 'above' | 'left', edge?: HTMLElement): void {
    const d = partDef(type);
    if (!d) return;
    this.type = type;
    const c = cards()[type];
    const slot = this.hotbar?.slotOf(type) ?? -1;
    this.el.innerHTML = `
      <div class="pc-hero"><span class="pc-glow"></span></div>
      <div class="pc-body">
        <div class="pc-title"><div><b></b><small></small></div><span class="pc-glyphs">${glyphRow(type, 18)}</span></div>
        ${c ? `<dl class="pc-nd"><dt>Needs</dt><dd class="n"></dd><dt>Does</dt><dd class="d"></dd></dl>` : ''}
        ${c?.tips.length ? `<ul class="pc-tips">${c.tips.slice(0, 2).map(() => '<li></li>').join('')}</ul>` : ''}
        <div class="pc-slots"><span>Assign to slot</span>${Array.from({ length: 10 }, (_, i) => `<kbd data-i="${i}" class="${i === slot ? 'on' : ''}">${Hotbar.keyOf(i)}</kbd>`).join('')}</div>
      </div>`;
    this.el.querySelector('.pc-hero')!.appendChild(partIcon(type, { size: 150 }));
    (this.el.querySelector('.pc-title b') as HTMLElement).textContent = d.name;
    (this.el.querySelector('.pc-title small') as HTMLElement).textContent = `${d.tag} · ${familyLabel(d.family)}`;
    if (c) {
      (this.el.querySelector('.pc-nd .n') as HTMLElement).textContent = c.needs;
      (this.el.querySelector('.pc-nd .d') as HTMLElement).textContent = c.does;
      this.el.querySelectorAll('.pc-tips li').forEach((li, i) => { li.textContent = c.tips[i] ?? ''; });
    }
    for (const k of this.el.querySelectorAll<HTMLElement>('.pc-slots kbd')) k.onclick = () => { this.hotbar?.assign(Number(k.dataset.i), type); this.show(type, anchor, side, edge); };
    this.el.onpointerenter = () => clearTimeout(this.timer);
    this.el.onpointerleave = () => this.leave();
    this.el.hidden = false;
    const a = anchor.getBoundingClientRect();
    const host = (this.el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const w = this.el.offsetWidth, ht = this.el.offsetHeight;
    let x: number, y: number;
    if (side === 'above') { x = a.left + a.width / 2 - w / 2; y = a.top - ht - 12; }
    else { x = (edge?.getBoundingClientRect().left ?? a.left) - w - 14; y = a.top + a.height / 2 - ht / 2; }
    x = Math.max(16, Math.min(host.width - w - 16, x - host.left));
    y = Math.max(16, Math.min(host.height - ht - 16, y - host.top));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}

/** Library: every part as a card, by family, with search and channel chips; click to arm placement. Modules tab: saved prefabs. */
export class Library {
  readonly el: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly chips: HTMLElement;
  private family = 'all';
  private readonly channels = new Set<string>();
  private hovered: string | null = null;
  onPick: (type: string) => void = () => {};
  /** Modules tab (M2 stream D): the world's stored modules and what to do with them. */
  modules: () => ModuleSummary[] = () => [];
  onModule: (id: number, action: ModuleAction) => void = () => {};
  onSaveSelection: () => void = () => {};
  onImport: () => void = () => {};
  /** Set by the HUD: hotbar slots, the shared hover card, drag-to-place, open/close notifications. */
  hotbar: Hotbar | null = null;
  card: PartCard | null = null;
  startDrag: (type: string, e: PointerEvent) => void = () => {};
  onToggle: (open: boolean) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = h(`<section id="library" class="glass side-panel" aria-label="Library" hidden>
      <header class="lib-head">
        <h2>Library</h2><span class="lib-count mono"></span>
        <label class="lib-search">${ICON.search}<input placeholder="Search by name, channel or what it does" aria-label="Search parts"/></label>
        <button class="icon-btn close" aria-label="Close the Library (L)" title="Close (L)">${ICON.close}</button>
      </header>
      <div class="tabs lib-tabs" role="tablist" aria-label="Library sections"></div>
      <div class="lib-chips" role="group" aria-label="Filter by channel"></div>
      <div class="lib-grid" role="group" aria-label="Parts"></div>
      <footer class="lib-foot"><span>Click to arm placement · drag into the world</span><span class="sp"></span>
        <span><kbd>1</kbd>–<kbd>0</kbd> assign to slot</span><span><kbd>F</kbd> favourite</span><span><kbd>L</kbd> close</span></footer>
    </section>`);
    parent.appendChild(this.el);
    this.grid = this.el.querySelector('.lib-grid') as HTMLElement;
    this.search = this.el.querySelector('input') as HTMLInputElement;
    this.chips = this.el.querySelector('.lib-chips') as HTMLElement;
    this.search.oninput = () => this.render();
    this.search.onkeydown = (e) => { if (e.key === 'Escape') { if (this.search.value) { this.search.value = ''; this.render(); } else this.toggle(false); } e.stopPropagation(); };
    (this.el.querySelector('.close') as HTMLElement).onclick = () => this.toggle(false);
    const tabs = this.el.querySelector('.lib-tabs') as HTMLElement;
    const tab = (id: string, label: string): void => {
      const b = h<HTMLButtonElement>(`<button class="tab" role="tab" data-family="${id}"></button>`);
      b.textContent = label;
      b.onclick = () => { this.family = id; this.paintTabs(); this.render(); };
      tabs.appendChild(b);
    };
    tab('all', 'All');
    for (const f of FAMILY_TABS) tab(f, familyLabel(f));
    tabs.appendChild(h('<span class="tab-sep" aria-hidden="true"></span>'));
    tab('modules', 'Modules');
    tab('favourites', 'Favourites');
    for (const ch of ['impact', 'signal', 'spin', 'tension', 'power', 'heat', 'air']) {
      const b = h<HTMLButtonElement>(`<button class="chip" aria-pressed="false" data-ch="${ch}">${glyph(ch, 16)}<span>${ch[0]!.toUpperCase() + ch.slice(1)}</span></button>`);
      b.onclick = () => { if (this.channels.has(ch)) this.channels.delete(ch); else this.channels.add(ch); b.setAttribute('aria-pressed', String(this.channels.has(ch))); this.render(); };
      this.chips.appendChild(b);
    }
    // 1–0 assign the hovered card, F favourites it (before main.ts's own keys; the search box keeps its typing)
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
      const t = this.hovered;
      if (!t || !this.hotbar) return;
      const i = Hotbar.indexOfKey(e.key);
      if (i >= 0) { this.hotbar.assign(i, t); this.render(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === 'f' || e.key === 'F') { this.hotbar.toggleFavourite(t); this.render(); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    this.paintTabs();
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(show = !this.open): void {
    if (show === this.open) { if (show) this.render(); return; }
    this.el.hidden = !show;
    if (show) this.render(); else { this.card?.hide(); this.hovered = null; }
    this.onToggle(show);
  }

  /** Open on a tab ('modules', a family, 'favourites' or 'all'). */
  showTab(family: string): void {
    this.family = family;
    this.paintTabs();
    this.toggle(true);
    this.render();
  }

  /** Re-render if the Modules tab is showing (the world's modules changed). */
  refreshModules(): void {
    if (this.open && this.family === 'modules') this.render();
  }

  /** Re-render if open (hotbar or favourites changed). */
  refresh(): void { if (this.open) this.render(); }

  private paintTabs(): void {
    for (const b of this.el.querySelectorAll<HTMLElement>('.lib-tabs .tab')) {
      const on = b.dataset.family === this.family;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    this.chips.hidden = this.family === 'modules';
  }

  private renderModules(q: string): void {
    const bar = h(`<div class="mod-bar"><button class="primary-blue" data-a="save">Save selection as module</button><button class="ghost" data-a="import">Import .knockmod…</button>
      <small>Modules live in this world, so your partner can place them too.</small></div>`);
    (bar.querySelector('[data-a=save]') as HTMLElement).onclick = () => this.onSaveSelection();
    (bar.querySelector('[data-a=import]') as HTMLElement).onclick = () => this.onImport();
    this.grid.appendChild(bar);
    const list = this.modules().filter((m) => !q || `${m.name} ${m.types.join(' ')} ${m.author}`.toLowerCase().includes(q));
    if (!list.length) {
      const e = document.createElement('p');
      e.className = 'mod-empty';
      e.textContent = q ? 'No module matches.' : 'No modules yet. Select a gadget you’re proud of, then “Save selection as module”.';
      this.grid.appendChild(e);
    }
    for (const m of list) {
      const el = h(`<div class="card mod-card" role="group"><div class="well-glow"><span class="mod-icons"></span></div>
        <div class="card-txt"><b></b><small class="tag"></small><p class="does"></p><p class="needs"></p></div><div class="mod-acts"></div></div>`);
      const icons = el.querySelector('.mod-icons') as HTMLElement;
      for (const t of [...new Set(m.types)].slice(0, 3)) icons.appendChild(partIcon(t, { size: 56 }));
      if (!m.types.length) icons.innerHTML = ICON.modules;
      (el.querySelector('b') as HTMLElement).textContent = m.name;
      (el.querySelector('.tag') as HTMLElement).textContent = m.bad ? 'Unreadable module' : `${m.parts} part${m.parts === 1 ? '' : 's'} · ${m.links} link${m.links === 1 ? '' : 's'}${m.author ? ` · ${m.author}` : ''}`;
      (el.querySelector('.does') as HTMLElement).textContent = m.bad ?? m.types.map((t) => partDef(t)?.name ?? t).join(', ');
      (el.querySelector('.needs') as HTMLElement).textContent = m.ports.length ? `Ports: ${m.ports.join(', ')}` : 'Self-contained';
      const acts = el.querySelector('.mod-acts') as HTMLElement;
      for (const [a, label] of [['place', 'Place'], ['export', 'Export'], ['rename', 'Rename'], ['delete', 'Delete']] as const) {
        if (m.bad && (a === 'place' || a === 'export')) continue;
        const b = document.createElement('button');
        b.textContent = label;
        b.className = a === 'place' ? 'primary-blue' : a === 'delete' ? 'ghost danger' : 'ghost';
        b.onclick = (e) => { e.stopPropagation(); this.onModule(m.id, a); if (a === 'place') this.toggle(false); };
        acts.appendChild(b);
      }
      this.grid.appendChild(el);
    }
  }

  private render(): void {
    const q = this.search.value.trim().toLowerCase();
    this.grid.innerHTML = '';
    const mods = this.modules().length;
    (this.el.querySelector('.lib-count') as HTMLElement).textContent = `${PALETTE.length} parts · ${mods} module${mods === 1 ? '' : 's'}`;
    if (this.family === 'modules') { this.renderModules(q); return; }
    let shown = 0;
    for (const p of UI_PARTS) {
      if (this.family === 'favourites' ? !this.hotbar?.favourites.has(p.type) : this.family !== 'all' && p.family !== this.family) continue;
      const card = cards()[p.type];
      const { ins, outs } = channelsOf(p.type);
      const chans = [...new Set([...ins, ...outs])];
      if (this.channels.size && !chans.some((c) => this.channels.has(c))) continue;
      const hay = `${p.name} ${p.tag} ${p.family} ${chans.join(' ')} ${card?.does ?? ''} ${card?.needs ?? ''}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      shown++;
      const slot = this.hotbar?.slotOf(p.type) ?? -1;
      const fav = this.hotbar?.favourites.has(p.type) ?? false;
      const el = h<HTMLButtonElement>(`<button class="card" data-type="${p.type}">
        <div class="well-glow"></div>
        ${slot >= 0 ? `<kbd class="card-slot">${Hotbar.keyOf(slot)}</kbd>` : ''}${fav ? `<i class="card-fav" aria-label="Favourite">${ICON.star}</i>` : ''}
        <div class="card-txt"><b></b><small class="tag"></small></div>
        <div class="card-glyphs">${glyphRow(p.type)}</div></button>`);
      el.querySelector('.well-glow')!.appendChild(partIcon(p.type, { size: 112 }));
      (el.querySelector('b') as HTMLElement).textContent = p.name;
      (el.querySelector('.tag') as HTMLElement).textContent = p.tag;
      el.setAttribute('aria-label', `${p.name}, ${p.tag}${slot >= 0 ? `, slot ${Hotbar.keyOf(slot)}` : ''}${fav ? ', favourite' : ''}`);
      el.onclick = () => { this.onPick(p.type); this.search.value = ''; this.toggle(false); }; // U5 (M5): a pick clears the search, so the next one starts fresh (playtest 2026-10-25)
      el.onpointerenter = () => { this.hovered = p.type; this.card?.hover(p.type, el, 'left', this.el); };
      el.onpointerleave = () => { if (this.hovered === p.type) this.hovered = null; this.card?.leave(); };
      el.onpointerdown = (e) => { if (e.button === 0) this.startDrag(p.type, e); };
      el.onfocus = () => { this.hovered = p.type; if (el.matches(':focus-visible')) this.card?.hover(p.type, el, 'left', this.el); };
      el.onblur = () => { if (this.hovered === p.type) this.hovered = null; this.card?.leave(); };
      el.setAttribute('aria-describedby', 'partcard');
      this.grid.appendChild(el);
    }
    if (!shown) {
      const e = document.createElement('p');
      e.className = 'mod-empty';
      e.textContent = this.family === 'favourites' && !q ? 'No favourites yet. Hover a part and press F.' : 'Nothing matches. Try a channel, like “heat”, or what it does.';
      this.grid.appendChild(e);
    }
  }
}

export interface Command {
  readonly label: string;
  readonly hint?: string;
  readonly run: () => void;
  readonly group?: PaletteGroup;
  /** Line icon for actions. */
  readonly icon?: IconName;
  /** Part type: shows its 3D icon. */
  readonly part?: string;
  /** Small text after the label ("connected to MAINS, COG"). */
  readonly detail?: string;
  /** Extra search words. */
  readonly keywords?: string;
}

type Grouped = Command & { readonly group: PaletteGroup };

const ACTION_ICON: readonly [RegExp, IconName][] = [
  [/^let it rip|solo preview/i, 'play'], [/^stop/i, 'stop'], [/^undo/i, 'undo'], [/^redo/i, 'redo'], [/wire|connect/i, 'connect'],
  [/x-ray/i, 'xray'], [/section/i, 'section'], [/cutaway/i, 'cutaway'], [/outliner|layer/i, 'outliner'], [/module/i, 'modules'],
  [/library/i, 'library'], [/settings/i, 'gear'], [/environment/i, 'worlds'], [/group/i, 'group'], [/lock/i, 'lock'],
  [/hide|show/i, 'eye'], [/ping/i, 'ping'], [/cascade/i, 'star'], [/select/i, 'grid'], [/path|tube/i, 'connect'], [/place/i, 'plus'],
  [/studio|cyc/i, 'cube'], [/camera/i, 'camera'], [/world|lobby/i, 'worlds'], [/save/i, 'save'], [/share/i, 'share'],
];

/** Command palette: grouped fuzzy search over actions, parts, settings and help (UI_UX §4.6). */
export class Palette {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private sel = 0;
  private shown: Command[] = [];
  commands: () => Command[] = () => [];
  /** Extra entries from the HUD (parts with 3D icons, parts in the scene, help). Replaces main.ts's "Part:" rows. */
  extra: () => Command[] = () => [];
  onToggle: (open: boolean) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = h(`<section id="palette" class="glass" role="dialog" aria-modal="true" aria-label="Command palette" hidden>
      <div class="pal-in">${ICON.search}<input placeholder="Type a command, a part or a question…" aria-label="Command" role="combobox" aria-controls="pal-list" aria-expanded="true"/>
        <span class="pal-pre"><kbd>&gt;</kbd> actions <kbd>@</kbd> parts <kbd>?</kbd> help</span></div>
      <div class="pal-list" id="pal-list" role="listbox" aria-label="Results"></div>
      <footer class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></footer>
    </section>`);
    parent.appendChild(this.el);
    this.input = this.el.querySelector('input') as HTMLInputElement;
    this.list = this.el.querySelector('.pal-list') as HTMLElement;
    this.input.oninput = () => { this.sel = 0; this.render(); };
    this.input.onkeydown = (e) => {
      if (e.key === 'Escape') this.toggle(false);
      else if (e.key === 'ArrowDown') { this.sel = Math.min(this.shown.length - 1, this.sel + 1); this.paintSel(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.sel = Math.max(0, this.sel - 1); this.paintSel(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = this.shown[this.sel]; if (c) this.exec(c); }
      e.stopPropagation();
    };
    this.el.addEventListener('focusout', (e) => { if (this.open && !this.el.contains(e.relatedTarget as Node | null)) this.toggle(false); });
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(show = !this.open): void {
    if (show === this.open) return;
    if (show) { const a = document.activeElement as HTMLElement | null; this.opener = a && a !== document.body ? a : null; }
    const hadFocus = this.el.contains(document.activeElement);
    this.el.hidden = !show;
    if (show) { this.input.value = ''; this.sel = 0; this.render(); this.input.focus(); }
    else if (hadFocus && this.opener?.isConnected) this.opener.focus(); // U4: focus goes back to the opener
    if (!show) this.opener = null;
    this.onToggle(show);
  }
  private opener: HTMLElement | null = null;

  private exec(c: Command): void {
    this.toggle(false);
    remember(c.label);
    // after the key event: a command that opens a dialog must not receive this Enter (implicit submit)
    setTimeout(() => c.run(), 0);
  }

  private all(): Grouped[] {
    const extra = this.extra();
    const hasParts = extra.some((c) => c.group === 'Parts');
    const base = this.commands().filter((c) => !(hasParts && c.label.startsWith('Part: ')));
    const tag = (c: Command): Grouped => ({ ...c, group: c.group ?? (/^settings/i.test(c.label) ? 'Settings' : 'Actions') });
    return [...base.map(tag), ...extra.map(tag)];
  }

  private render(): void {
    const cmds = this.all();
    const recent = recentLabels();
    const q = this.input.value;
    // recent commands show in their own group (first) while the query is empty or they match
    const tagged: Grouped[] = cmds.map((c) => (recent.includes(c.label) && c.group !== 'Parts in scene' ? { ...c, group: 'Recent' as const } : c));
    const ranked = rank(tagged, q, 14);
    if (!q.trim()) ranked.sort((a, b) => (a.item.group === 'Recent' ? recent.indexOf(a.item.label) : 99) - (b.item.group === 'Recent' ? recent.indexOf(b.item.label) : 99));
    this.shown = ranked.map((r) => r.item);
    this.list.innerHTML = '';
    let group = '';
    ranked.forEach(({ item: c, match }, i) => {
      if (c.group !== group) {
        group = c.group!;
        this.list.appendChild(h(`<div class="pal-grp" role="presentation">${esc(group)}</div>`));
      }
      const d = h(`<div class="pal-it" role="option" id="pal-${i}"><span class="pal-ic"></span><span class="pal-l"></span><span class="pal-k"></span></div>`);
      const ic = d.querySelector('.pal-ic') as HTMLElement;
      if (c.part) ic.appendChild(partIcon(c.part, { size: 30 }));
      else ic.innerHTML = ICON[c.icon ?? ACTION_ICON.find(([re]) => re.test(c.label))?.[1] ?? (c.group === 'Help' ? 'help' : 'cube')];
      const l = d.querySelector('.pal-l') as HTMLElement;
      for (const r of highlightRuns(c.label, match.hits)) {
        if (r.hit) { const b = document.createElement('b'); b.textContent = r.text; l.appendChild(b); } else l.append(r.text);
      }
      if (c.detail) { const s = document.createElement('small'); s.textContent = ` ${c.detail}`; l.appendChild(s); }
      const k = d.querySelector('.pal-k') as HTMLElement;
      const hint = c.hint ?? (c.group === 'Parts in scene' ? '@' : c.group === 'Help' ? '?' : '');
      if (hint) { const kb = document.createElement('kbd'); kb.textContent = hint; k.appendChild(kb); }
      d.onpointerdown = (e) => e.preventDefault(); // keep focus in the input
      d.onclick = () => this.exec(c);
      d.onpointermove = () => { if (this.sel !== i) { this.sel = i; this.paintSel(); } };
      this.list.appendChild(d);
    });
    if (!ranked.length) this.list.appendChild(h('<p class="pal-empty">No match. Try “wire”, “@motor” or “? channels”.</p>'));
    this.paintSel();
  }

  private paintSel(): void {
    this.list.querySelectorAll('.pal-it').forEach((el, i) => {
      el.classList.toggle('sel', i === this.sel);
      el.setAttribute('aria-selected', String(i === this.sel));
      if (i === this.sel) { (el as HTMLElement).scrollIntoView({ block: 'nearest' }); this.input.setAttribute('aria-activedescendant', el.id); }
    });
  }
}

const RECENT_KEY = 'kn.recent';
function recentLabels(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 4) : []; } catch { return []; }
}
function remember(label: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([label, ...recentLabels().filter((l) => l !== label)].slice(0, 4))); } catch { /* session only */ }
}

export interface RadialSlot { readonly label: string; readonly run: () => void; readonly enabled?: () => boolean }

const RADIAL_ICON: Record<string, IconName> = {
  'Mirror X': 'mirror', Rotate: 'rotate', Duplicate: 'duplicate', Connect: 'connect', Isolate: 'isolate', Lock: 'lock', Group: 'group',
  Delete: 'trash', Anchor: 'anchor', Inspect: 'inspect', Library: 'library',
};

/** Radial menu: hold Q, point, release (UI_UX §4.7). 8 glass wedges, centre cancels. */
/** UIFIX (D122): a Q press shorter than this is a tap (the menu stays open for the arrows and Enter). */
export const RADIAL_TAP_MS = 300;

/**
 * UIFIX (D122): what Q's key-up does to a menu opened by holding Q (hold, point, let go). A chosen wedge runs; a
 * quick tap with nothing chosen keeps the menu open (sticky: arrows choose, Enter confirms, Esc or Q closes); a
 * longer hold let go over the centre cancels.
 */
export function radialKeyUp(heldMs: number, pick: number): 'run' | 'sticky' | 'cancel' {
  if (pick >= 0) return 'run';
  return heldMs < RADIAL_TAP_MS ? 'sticky' : 'cancel';
}

export class Radial {
  readonly el: HTMLElement;
  /** UIFIX (D122): when the menu opened (Q's hold time on key-up). */
  private openedAt = 0;
  private slots: RadialSlot[] = [];
  private cx = 0;
  private cy = 0;
  private pick = -1;
  /** Opened from the keyboard (U4): stays open on Q's key-up; arrows choose, Enter confirms. */
  sticky = false;
  /** Set by the HUD: the part under the cursor (the pill shows its 3D icon and name). */
  subject: () => { type: string; name: string } | null = () => null;
  onToggle: (open: boolean) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = h('<div id="radial" role="menu" aria-label="Radial menu" hidden></div>');
    parent.appendChild(this.el);
  }

  get open(): boolean { return !this.el.hidden; }

  show(x: number, y: number, slots: RadialSlot[]): void {
    this.slots = slots;
    this.sticky = false;
    this.openedAt = performance.now(); // UIFIX (D122)
    this.cx = x; this.cy = y; this.pick = -1;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    const n = slots.length, R = 150, r = 54, gap = 0.035;
    const pt = (a: number, rad: number): string => `${(160 + Math.cos(a) * rad).toFixed(1)} ${(160 + Math.sin(a) * rad).toFixed(1)}`;
    const wedges = slots.map((s, i) => {
      const mid = (i / n) * Math.PI * 2 - Math.PI / 2, half = Math.PI / n - gap;
      const a0 = mid - half, a1 = mid + half;
      const cls = `${s.label === 'Delete' ? 'del' : ''} ${s.enabled && !s.enabled() ? 'off' : ''}`;
      return `<path data-i="${i}" class="${cls}" d="M${pt(a0, R)}A${R} ${R} 0 0 1 ${pt(a1, R)}L${pt(a1, r)}A${r} ${r} 0 0 0 ${pt(a0, r)}Z"/>`;
    }).join('');
    this.el.innerHTML = `<div class="rd-glass"></div>
      <svg class="rd-svg" width="320" height="320" viewBox="0 0 320 320" aria-hidden="true">
        <defs><linearGradient id="rd-sel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3373D0"/><stop offset="1" stop-color="#2A66C4"/></linearGradient></defs>
        <g class="rd-w">${wedges}</g><circle class="rd-c" cx="160" cy="160" r="44"/></svg>
      <div class="rd-cancel">cancel</div>`;
    slots.forEach((s, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const l = h(`<div class="rd-l${s.enabled && !s.enabled() ? ' off' : ''}${s.label === 'Delete' ? ' del' : ''}" role="menuitem" id="rd-${i}" aria-disabled="${!!(s.enabled && !s.enabled())}" data-i="${i}">${ICON[RADIAL_ICON[s.label] ?? 'cube']}<span></span></div>`);
      (l.lastElementChild as HTMLElement).textContent = s.label;
      l.style.left = `${160 + Math.cos(a) * 102}px`;
      l.style.top = `${160 + Math.sin(a) * 102}px`;
      this.el.appendChild(l);
    });
    const sub = this.subject();
    if (sub) {
      const pill = h(`<div class="rd-pill"><span class="nm"></span><kbd>hold Q</kbd></div>`);
      pill.prepend(partIcon(sub.type, { size: 26 }));
      (pill.querySelector('.nm') as HTMLElement).textContent = sub.name;
      this.el.appendChild(pill);
    }
    this.el.hidden = false;
    this.onToggle(true);
  }

  move(x: number, y: number): void {
    const dx = x - this.cx, dy = y - this.cy;
    const n = this.slots.length;
    this.pick = Math.hypot(dx, dy) < 44 ? -1 : Math.round(((Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2 / n)) % n;
    this.el.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('sel', Number((el as HTMLElement).dataset.i) === this.pick));
    this.el.classList.toggle('cancel', this.pick < 0);
  }

  release(): void {
    this.el.hidden = true;
    this.sticky = false;
    this.onToggle(false);
    const s = this.slots[this.pick];
    if (s && (!s.enabled || s.enabled())) s.run();
  }

  /** UIFIX (D122): Q let go while a held menu is open (main.ts's key-up). Returns what happened. */
  keyUp(now = performance.now()): 'run' | 'sticky' | 'cancel' | 'none' {
    if (!this.open || this.sticky) return 'none';
    const a = radialKeyUp(now - this.openedAt, this.pick);
    if (a === 'sticky') {
      this.sticky = true;
      this.step(0);
      announce('Radial menu: arrows choose, Enter confirms, Escape closes.');
    } else this.release();
    return a;
  }

  /** Close without running anything (Esc). */
  cancel(): void {
    this.pick = -1;
    this.release();
  }

  /**
   * Keyboard (U4, keyboard building aids): move the highlight to the next / previous enabled wedge
   * (0 = highlight the first enabled one). The highlighted wedge is announced.
   */
  step(dir: number): void {
    const n = this.slots.length;
    if (!n) return;
    let i = this.pick < 0 ? (dir < 0 ? 0 : -1) : this.pick;
    for (let k = 0; k < n; k++) {
      i = (i + (dir < 0 ? -1 : 1) + n) % n;
      const s = this.slots[i]!;
      if (!s.enabled || s.enabled()) break;
    }
    this.pick = i;
    this.el.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('sel', Number((el as HTMLElement).dataset.i) === this.pick));
    this.el.classList.remove('cancel');
    this.el.setAttribute('aria-activedescendant', `rd-${this.pick}`);
    announce(this.slots[this.pick]!.label);
  }
}

export { FAMILY_ICON };
