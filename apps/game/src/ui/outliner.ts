// Outliner (UI_UX §4.3, GAME_SPEC §7.4): a collapsible tree of layers → groups → parts, plus links.
// Search, select-on-click (Ctrl toggles, Shift ranges), eye/lock per row, inline rename of layers and
// groups (double-click), drag parts onto a layer or group, and layer management. Every edit is an op.

import type { WorldDoc } from '@knockon/docstore';
import { LayerFlag, PartFlag, type LinkRecord, type Op, type PartId, type PartRecord } from '@knockon/format';
import { DEFAULT_LAYER_NAME, flagOp, groupMembers, groupSubtree, layerOp, partEditable, type SmallIds } from './organise.ts';
import type { Selection } from './selection.ts';
import { ICON } from './icons.ts';

export interface OutlinerHost {
  doc(): WorldDoc | null;
  slot(): number;
  readonly selection: Selection;
  readonly ids: SmallIds;
  submit(op: Op): boolean;
  toast(text: string, level?: 'info' | 'warn'): void;
  partLabel(p: PartRecord): { name: string; color: string };
  linkLabel(l: LinkRecord): string;
  /** Select from the outliner (handles locked parts and syncing the 3D view). */
  select(ids: readonly number[], mode: 'replace' | 'toggle' | 'add'): void;
  /** Double-click a part row: frame it in the view. */
  focus(id: number): void;
  activeLayer: number;
  groupSelection(): void;
}

type Row =
  | { kind: 'layer'; id: number; name: string; flags: number; count: number }
  | { kind: 'group'; id: number; name: string; depth: number; count: number; layer: number }
  | { kind: 'part'; id: PartId; depth: number }
  | { kind: 'links'; count: number }
  | { kind: 'link'; id: PartId }
  | { kind: 'more'; hidden: number };

const MAX_ROWS = 5000;

export class Outliner {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly host: OutlinerHost;
  private readonly collapsed = new Set<string>(['links']);
  private rows: Row[] = [];
  private limit = MAX_ROWS;
  private queued = false;
  private renaming: string | null = null;

  constructor(parent: HTMLElement, host: OutlinerHost) {
    this.host = host;
    this.el = document.createElement('aside');
    this.el.id = 'outliner';
    this.el.className = 'kn-panel';
    this.el.setAttribute('aria-label', 'Outliner');
    this.el.innerHTML = `
      <div class="ol-head"><b>Outliner</b><button class="close" title="Fold away (Ctrl+\\)" aria-label="Fold the outliner away">«</button></div>
      <input class="ol-search" placeholder="Search parts, groups, layers" aria-label="Search the outliner"/>
      <div class="ol-list" role="tree" tabindex="0"></div>
      <div class="ol-foot">
        <button data-a="layer" title="New layer">+ Layer</button>
        <button data-a="group" title="Group the selection (Ctrl+G)">Group</button>
        <button data-a="showall" title="Show every hidden part and layer">Show all</button>
      </div>`;
    parent.appendChild(this.el);
    this.list = this.el.querySelector('.ol-list') as HTMLElement;
    this.search = this.el.querySelector('.ol-search') as HTMLInputElement;
    this.search.oninput = () => { this.limit = MAX_ROWS; this.render(); };
    this.search.onkeydown = (e) => { if (e.key === 'Escape') { this.search.value = ''; this.render(); this.search.blur(); } e.stopPropagation(); };
    (this.el.querySelector('.close') as HTMLElement).onclick = () => this.toggle(false);
    (this.el.querySelector('[data-a=layer]') as HTMLElement).onclick = () => this.newLayer();
    (this.el.querySelector('[data-a=group]') as HTMLElement).onclick = () => host.groupSelection();
    (this.el.querySelector('[data-a=showall]') as HTMLElement).onclick = () => this.showAll();
    this.list.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/kn-ids')) e.preventDefault(); });
    host.selection.on(() => this.paintSelection());
    // U4: the tree is one Tab stop; ↑ ↓ move, → ← expand / collapse, Enter / Space select (Ctrl adds), Home / End
    this.list.setAttribute('aria-label', 'World tree');
    this.list.addEventListener('keydown', (e) => this.treeKey(e));
    this.list.addEventListener('focus', () => this.paintCursor());
  }

  /** Keyboard row cursor of the tree (aria-activedescendant). */
  private cursor = 0;

  private paintCursor(): void {
    const rows = this.list.querySelectorAll<HTMLElement>('.ol-row');
    if (!rows.length) { this.list.removeAttribute('aria-activedescendant'); return; }
    this.cursor = Math.max(0, Math.min(rows.length - 1, this.cursor));
    rows.forEach((r, i) => r.classList.toggle('kb', i === this.cursor && document.activeElement === this.list));
    this.list.setAttribute('aria-activedescendant', rows[this.cursor]!.id);
  }

  private treeKey(e: KeyboardEvent): void {
    if (e.target !== this.list) return;
    const rows = [...this.list.querySelectorAll<HTMLElement>('.ol-row')];
    if (!rows.length) return;
    const row = rows[this.cursor];
    const caret = row?.querySelector<HTMLElement>('.ol-caret');
    const expanded = row?.getAttribute('aria-expanded');
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': this.cursor = Math.min(rows.length - 1, this.cursor + 1); break;
      case 'ArrowUp': this.cursor = Math.max(0, this.cursor - 1); break;
      case 'Home': this.cursor = 0; break;
      case 'End': this.cursor = rows.length - 1; break;
      case 'ArrowRight': if (caret && expanded === 'false') caret.click(); else this.cursor = Math.min(rows.length - 1, this.cursor + 1); break;
      case 'ArrowLeft': if (caret && expanded === 'true') caret.click(); break;
      case 'Enter': case ' ': row?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })); break;
      case 'h': case 'H': [...(row?.querySelectorAll<HTMLElement>('button[aria-label^="Show"], button[aria-label^="Hide"]') ?? [])][0]?.click(); break;
      case 'l': case 'L': [...(row?.querySelectorAll<HTMLElement>('button[aria-label^="Lock"], button[aria-label^="Unlock"]') ?? [])][0]?.click(); break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    this.paintCursor();
    this.list.querySelector<HTMLElement>(`#ol-r-${this.cursor}`)?.scrollIntoView({ block: 'nearest' });
  }

  get open(): boolean { return !this.el.classList.contains('folded'); }

  toggle(show = !this.open, remember = true): void {
    if (remember) { try { localStorage.setItem('kn.outliner', show ? '1' : '0'); } catch { /* session only */ } }
    this.el.classList.toggle('folded', !show);
    this.el.parentElement?.classList.toggle('outliner-open', show);
    if (show) this.render();
  }

  /** Re-render on the next frame (doc changed). */
  invalidate(): void {
    if (this.queued || !this.open) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.render(); });
  }

  // ---- model → rows --------------------------------------------------------------------------------
  private build(doc: WorldDoc): Row[] {
    const q = this.search.value.trim().toLowerCase();
    const rows: Row[] = [];
    const parts = [...doc.parts.values()].sort((a, b) => a.id - b.id);
    if (q) {
      // flat results: parts whose name, group, layer or id matches
      for (const p of parts) {
        const g = p.group ? doc.groups.get(p.group)?.name ?? '' : '';
        const l = p.layer ? doc.layers.get(p.layer)?.name ?? '' : DEFAULT_LAYER_NAME;
        const hay = `${this.host.partLabel(p).name} ${p.type} ${g} ${l} ${p.id % 4294967296}`.toLowerCase();
        if (hay.includes(q)) rows.push({ kind: 'part', id: p.id, depth: 0 });
      }
      for (const l of [...doc.links.values()].sort((a, b) => a.id - b.id)) {
        if (this.host.linkLabel(l).toLowerCase().includes(q)) rows.push({ kind: 'link', id: l.id });
      }
      return rows;
    }
    const layerIds = [0, ...[...doc.layers.keys()].sort((a, b) => a - b)];
    const byLayer = new Map<number, PartRecord[]>(layerIds.map((id) => [id, []]));
    for (const p of parts) {
      const l = p.layer && doc.layers.has(p.layer) ? p.layer : 0;
      byLayer.get(l)!.push(p);
    }
    for (const lid of layerIds) {
      const rec = doc.layers.get(lid);
      const lp = byLayer.get(lid)!;
      rows.push({ kind: 'layer', id: lid, name: rec?.name ?? DEFAULT_LAYER_NAME, flags: rec?.flags ?? 0, count: lp.length });
      if (this.collapsed.has(`L:${lid}`)) continue;
      // groups present on this layer (and their ancestors); empty groups live on the default layer
      const present = new Set<number>();
      for (const p of lp) for (let g = p.group ?? 0, n = 0; g && doc.groups.has(g) && n < 64; g = doc.groups.get(g)!.parent, n++) present.add(g);
      if (lid === 0) for (const g of doc.groups.values()) if (!groupMembers(doc, g.id).length) present.add(g.id);
      const members = new Map<number, PartRecord[]>();
      const loose: PartRecord[] = [];
      for (const p of lp) {
        if (p.group && present.has(p.group)) members.set(p.group, [...(members.get(p.group) ?? []), p]);
        else loose.push(p);
      }
      const walk = (parent: number, depth: number): void => {
        const kids = [...present].map((id) => doc.groups.get(id)!).filter((g) => (doc.groups.has(g.parent) ? g.parent : 0) === parent).sort((a, b) => a.id - b.id);
        for (const g of kids) {
          const count = [...groupSubtree(doc, g.id)].reduce((n, id) => n + (members.get(id)?.length ?? 0), 0);
          rows.push({ kind: 'group', id: g.id, name: g.name, depth, count, layer: lid });
          if (this.collapsed.has(`G:${lid}:${g.id}`)) continue;
          walk(g.id, depth + 1);
          for (const p of members.get(g.id) ?? []) rows.push({ kind: 'part', id: p.id, depth: depth + 1 });
        }
      };
      walk(0, 1);
      for (const p of loose) rows.push({ kind: 'part', id: p.id, depth: 1 });
    }
    if (doc.links.size) {
      rows.push({ kind: 'links', count: doc.links.size });
      if (!this.collapsed.has('links')) for (const l of [...doc.links.values()].sort((a, b) => a.id - b.id)) rows.push({ kind: 'link', id: l.id });
    }
    return rows;
  }

  render(): void {
    const doc = this.host.doc();
    if (!doc || !this.open) return;
    if (this.renaming) return; // don't yank the input away mid-rename
    const all = this.build(doc);
    this.rows = all.length > this.limit ? [...all.slice(0, this.limit), { kind: 'more', hidden: all.length - this.limit }] : all;
    const frag = document.createDocumentFragment();
    this.rows.forEach((r, i) => {
      const el = this.rowEl(doc, r);
      el.id = `ol-r-${i}`;
      // the row's own buttons are reached from the tree's keys (H, L), so the tree stays one Tab stop
      for (const b of el.querySelectorAll('button')) b.tabIndex = -1;
      frag.appendChild(el);
    });
    this.list.replaceChildren(frag);
    this.paintCursor();
    if (!this.rows.length) {
      const e = document.createElement('div');
      e.className = 'ol-empty';
      e.textContent = this.search.value ? 'Nothing matches.' : 'Nothing here yet. Place a part!';
      this.list.appendChild(e);
    }
    this.paintSelection();
  }

  private paintSelection(): void {
    const sel = this.host.selection;
    for (const el of this.list.querySelectorAll<HTMLElement>('[data-id]')) {
      const on = sel.has(Number(el.dataset.id));
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', String(on));
    }
    if (sel.primary !== null) this.list.querySelector<HTMLElement>(`[data-id="${sel.primary}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private rowEl(doc: WorldDoc, r: Row): HTMLElement {
    const el = document.createElement('div');
    el.className = `ol-row ol-${r.kind}`;
    el.setAttribute('role', 'treeitem');
    switch (r.kind) {
      case 'layer': {
        const key = `L:${r.id}`;
        el.style.paddingLeft = '4px';
        el.setAttribute('aria-expanded', String(!this.collapsed.has(key)));
        el.append(
          this.caret(key),
          this.iconBtn(r.flags & LayerFlag.Hidden ? '◌' : '👁', r.flags & LayerFlag.Hidden ? 'Show layer' : 'Hide layer', () => this.layerFlag(r.id, LayerFlag.Hidden), (r.flags & LayerFlag.Hidden) !== 0),
          this.iconBtn(r.flags & LayerFlag.Locked ? '🔒' : '🔓', r.flags & LayerFlag.Locked ? 'Unlock layer' : 'Lock layer', () => this.layerFlag(r.id, LayerFlag.Locked), (r.flags & LayerFlag.Locked) !== 0),
          this.name(`layer:${r.id}`, r.name, r.id !== 0 ? (v) => this.renameLayer(r.id, v) : null),
        );
        const active = document.createElement('button');
        active.className = 'ol-active' + (this.host.activeLayer === r.id ? ' on' : '');
        active.title = this.host.activeLayer === r.id ? 'New parts go on this layer' : 'Make this the active layer (new parts go here)';
        active.setAttribute('aria-pressed', String(this.host.activeLayer === r.id));
        active.textContent = '●';
        active.onclick = (e) => { e.stopPropagation(); this.host.activeLayer = r.id; this.render(); };
        const count = document.createElement('small');
        count.textContent = String(r.count);
        const assign = this.iconBtn('⇠', 'Move the selection to this layer', () => this.assignLayer(r.id));
        el.append(count, active, assign);
        if (r.id !== 0) el.append(this.iconBtn('✕', 'Delete layer (its parts move to Default)', () => this.deleteLayer(r.id)));
        this.dropTarget(el, (ids) => this.assignLayer(r.id, ids));
        el.onclick = () => this.host.select(this.partsOnLayer(doc, r.id), 'replace');
        break;
      }
      case 'group': {
        const key = `G:${r.layer}:${r.id}`;
        el.style.paddingLeft = `${r.depth * 14}px`;
        el.setAttribute('aria-expanded', String(!this.collapsed.has(key)));
        const ids = this.groupParts(doc, r.id);
        const hidden = ids.length > 0 && ids.every((id) => (doc.parts.get(id)!.flags & PartFlag.Hidden) !== 0);
        const locked = ids.length > 0 && ids.every((id) => (doc.parts.get(id)!.flags & PartFlag.Locked) !== 0);
        el.append(
          this.caret(key),
          this.iconBtn(hidden ? '◌' : '👁', hidden ? 'Show group' : 'Hide group', () => this.submitOrNote(flagOp(doc, ids, PartFlag.Hidden, !hidden)), hidden),
          this.iconBtn(locked ? '🔒' : '🔓', locked ? 'Unlock group' : 'Lock group', () => this.submitOrNote(flagOp(doc, ids, PartFlag.Locked, !locked)), locked),
          this.name(`group:${r.id}`, `▣ ${r.name}`, (v) => this.renameGroup(r.id, v)),
        );
        const count = document.createElement('small');
        count.textContent = String(r.count);
        el.append(count, this.iconBtn('✕', 'Ungroup', () => this.host.submit({ k: 'GroupSet', id: r.id, name: null, parent: 0, members: null })));
        this.dropTarget(el, (dropped) => this.addToGroup(r.id, dropped));
        el.onclick = (e) => this.host.select(ids, e.ctrlKey || e.metaKey ? 'add' : 'replace');
        break;
      }
      case 'part': {
        const p = doc.parts.get(r.id)!;
        const { name, color } = this.host.partLabel(p);
        el.dataset.id = String(p.id);
        el.style.paddingLeft = `${r.depth * 14 + 18}px`;
        el.draggable = true;
        const hidden = (p.flags & PartFlag.Hidden) !== 0, locked = (p.flags & PartFlag.Locked) !== 0;
        el.append(
          this.iconBtn(hidden ? '◌' : '👁', hidden ? 'Show' : 'Hide', () => this.submitOrNote(flagOp(doc, [p.id], PartFlag.Hidden, !hidden)), hidden),
          this.iconBtn(locked ? '🔒' : '🔓', locked ? 'Unlock' : 'Lock', () => this.submitOrNote(flagOp(doc, [p.id], PartFlag.Locked, !locked)), locked),
        );
        const n = document.createElement('span');
        n.className = 'ol-name';
        n.innerHTML = `<i style="background:${color}"></i>`;
        n.append(`${name} `);
        const idn = document.createElement('small');
        idn.textContent = `#${p.id % 4294967296}${Math.floor(p.id / 4294967296) === 2 ? '·2' : ''}`;
        n.appendChild(idn);
        // U5 (M5, D105): tagged for BUZZ (the glyph, plus words for screen readers)
        if (PartFlag.Tagged && p.flags & PartFlag.Tagged) n.insertAdjacentHTML('beforeend', ` <span class="ol-tag" title="Tagged for BUZZ">${ICON.tag}<span class="sr-only">tagged for BUZZ</span></span>`);
        if (!partEditable(doc, p)) n.classList.add('locked');
        el.appendChild(n);
        el.onclick = (e) => this.clickItem(p.id, e);
        el.ondblclick = () => this.host.focus(p.id);
        el.ondragstart = (e) => {
          const ids = this.host.selection.has(p.id) ? this.host.selection.ids().filter((id) => doc.parts.has(id)) : [p.id];
          e.dataTransfer?.setData('text/kn-ids', JSON.stringify(ids));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        };
        break;
      }
      case 'links': {
        el.style.paddingLeft = '4px';
        el.append(this.caret('links'));
        const n = document.createElement('span');
        n.className = 'ol-name';
        n.textContent = 'Links';
        const c = document.createElement('small');
        c.textContent = String(r.count);
        el.append(n, c);
        break;
      }
      case 'link': {
        const l = doc.links.get(r.id)!;
        el.dataset.id = String(l.id);
        el.style.paddingLeft = '32px';
        const n = document.createElement('span');
        n.className = 'ol-name';
        n.textContent = this.host.linkLabel(l);
        el.appendChild(n);
        el.onclick = (e) => this.clickItem(l.id, e);
        break;
      }
      case 'more': {
        const b = document.createElement('button');
        b.textContent = `Show ${Math.min(MAX_ROWS, r.hidden)} more (${r.hidden} hidden)`;
        b.onclick = () => { this.limit += MAX_ROWS; this.render(); };
        el.appendChild(b);
        break;
      }
    }
    return el;
  }

  private clickItem(id: number, e: MouseEvent): void {
    if (e.shiftKey && this.host.selection.anchor !== null) {
      const order = this.rows.filter((r): r is Extract<Row, { id: number }> & { kind: 'part' | 'link' } => r.kind === 'part' || r.kind === 'link').map((r) => r.id);
      const a = order.indexOf(this.host.selection.anchor), b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.host.select(order.slice(lo, hi + 1), e.ctrlKey || e.metaKey ? 'add' : 'replace');
        return;
      }
    }
    this.host.select([id], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
  }

  // ---- widgets ---------------------------------------------------------------------------------------
  private caret(key: string): HTMLElement {
    const b = document.createElement('button');
    b.className = 'ol-caret';
    const shut = this.collapsed.has(key);
    b.textContent = shut ? '▸' : '▾';
    b.setAttribute('aria-label', shut ? 'Expand' : 'Collapse');
    b.onclick = (e) => { e.stopPropagation(); if (shut) this.collapsed.delete(key); else this.collapsed.add(key); this.render(); };
    return b;
  }

  private iconBtn(text: string, title: string, fn: () => void, on = false): HTMLElement {
    const b = document.createElement('button');
    b.className = 'ol-icon' + (on ? ' on' : '');
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  private name(key: string, text: string, rename: ((v: string) => void) | null): HTMLElement {
    const n = document.createElement('span');
    n.className = 'ol-name';
    n.textContent = text;
    if (rename) {
      n.title = 'Double-click to rename';
      n.ondblclick = (e) => {
        e.stopPropagation();
        this.renaming = key;
        const input = document.createElement('input');
        input.className = 'ol-rename';
        input.maxLength = 64;
        input.value = text.replace(/^▣ /, '');
        const done = (commit: boolean): void => {
          if (this.renaming !== key) return;
          this.renaming = null;
          const v = input.value.trim();
          if (commit && v && v !== text) rename(v.slice(0, 64));
          this.render();
        };
        input.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
        input.onblur = () => done(true);
        input.onclick = (ev) => ev.stopPropagation();
        n.replaceWith(input);
        input.focus();
        input.select();
      };
    }
    return n;
  }

  private dropTarget(el: HTMLElement, onDrop: (ids: PartId[]) => void): void {
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/kn-ids')) { e.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop');
      const raw = e.dataTransfer?.getData('text/kn-ids');
      if (!raw) return;
      e.preventDefault();
      try { onDrop((JSON.parse(raw) as unknown[]).map(Number).filter(Number.isFinite)); } catch { /* foreign drag */ }
    });
  }

  // ---- actions -----------------------------------------------------------------------------------------
  private submitOrNote(op: Op | null): void { if (op) this.host.submit(op); }

  private partsOnLayer(doc: WorldDoc, layer: number): PartId[] {
    return [...doc.parts.values()].filter((p) => (p.layer && doc.layers.has(p.layer) ? p.layer : 0) === layer).map((p) => p.id).sort((a, b) => a - b);
  }

  private groupParts(doc: WorldDoc, group: number): PartId[] {
    const tree = groupSubtree(doc, group);
    return [...doc.parts.values()].filter((p) => p.group && tree.has(p.group)).map((p) => p.id).sort((a, b) => a - b);
  }

  newLayer(name?: string): number | null {
    const doc = this.host.doc();
    if (!doc) return null;
    const id = this.host.ids.next('layer', this.host.slot(), doc.layers.keys());
    const n = name ?? `Layer ${doc.layers.size + 1}`;
    if (!this.host.submit({ k: 'LayerSet', id, name: n, flags: 0 })) return null;
    this.host.activeLayer = id;
    this.render();
    return id;
  }

  private layerFlag(id: number, bit: number): void {
    const doc = this.host.doc();
    if (!doc) return;
    if (id === 0) {
      // the default layer has no record: apply the flag to its parts instead
      const ids = this.partsOnLayer(doc, 0);
      const partBit = bit === LayerFlag.Hidden ? PartFlag.Hidden : PartFlag.Locked;
      const allOn = ids.length > 0 && ids.every((p) => (doc.parts.get(p)!.flags & partBit) !== 0);
      this.submitOrNote(flagOp(doc, ids, partBit, !allOn));
      return;
    }
    const l = doc.layers.get(id);
    if (l) this.host.submit({ k: 'LayerSet', id, name: l.name, flags: l.flags ^ bit });
  }

  private renameLayer(id: number, name: string): void {
    const l = this.host.doc()?.layers.get(id);
    if (l) this.host.submit({ k: 'LayerSet', id, name, flags: l.flags });
  }

  private deleteLayer(id: number): void {
    if (this.host.activeLayer === id) this.host.activeLayer = 0;
    this.host.submit({ k: 'LayerSet', id, name: null, flags: 0 });
  }

  assignLayer(layer: number, ids?: readonly PartId[]): void {
    const doc = this.host.doc();
    if (!doc) return;
    const list = (ids ?? this.host.selection.ids()).filter((id) => doc.parts.has(id));
    if (!list.length) { this.host.toast('Select some parts first'); return; }
    const op = layerOp(doc, list, layer);
    if (op && this.host.submit(op)) this.host.toast(`Moved ${list.length} part${list.length === 1 ? '' : 's'} to ${layer ? doc.layers.get(layer)?.name : DEFAULT_LAYER_NAME}`);
  }

  private renameGroup(id: number, name: string): void {
    const g = this.host.doc()?.groups.get(id);
    if (g) this.host.submit({ k: 'GroupSet', id, name, parent: g.parent, members: null });
  }

  private addToGroup(group: number, ids: readonly PartId[]): void {
    const doc = this.host.doc();
    const g = doc?.groups.get(group);
    if (!doc || !g) return;
    const members = [...new Set([...groupMembers(doc, group), ...ids.filter((id) => doc.parts.has(id))])].sort((a, b) => a - b);
    this.host.submit({ k: 'GroupSet', id: group, name: g.name, parent: g.parent, members });
  }

  private showAll(): void {
    const doc = this.host.doc();
    if (!doc) return;
    const ops: Op[] = [];
    for (const l of doc.layers.values()) if (l.flags & LayerFlag.Hidden) ops.push({ k: 'LayerSet', id: l.id, name: l.name, flags: l.flags & ~LayerFlag.Hidden });
    const hide = flagOp(doc, [...doc.parts.keys()], PartFlag.Hidden, false);
    if (hide) ops.push(...(hide.k === 'Batch' ? hide.ops : [hide]));
    if (ops.length) this.host.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
  }
}
