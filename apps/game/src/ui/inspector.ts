// Inspector (UI_UX §4.5, mockup board "Build HUD"): a 340 px glass panel docked right under the session
// bar. It slides in on selection and out when nothing is selected, and isn't shown in a run.
// Header: the part's 3D render, name, tag ("Ramp · Frame"), pin, delete. Tabs: Properties · Skin.
// Collapsible sections (open state remembered per part type): Properties (sliders with a numeric field
// and a plain hint, toggles, segmented choices) · Transform (position in cells, rotation, snap to grid,
// anchored) · Connections (ports, linked part, unlink) · Layer / Group (from BuildTools), then Lock part
// and a one-line plain-English note. Small text sits on wells (D77).

import { metresToPos, PartFlag, posToMetres, snappedEuler, type PartRecord, type Rotation } from '@knockon/format';
import { propValues, type PropSpec } from '@knockon/parts-data';
import { partDef } from '../catalog.ts';
import type { NetClient } from '../net.ts';
import { flagOp } from './organise.ts';
import { cards, familyLabel } from './panels.ts';
import { esc, glyph, h, ICON, partIcon } from './icons.ts';
import { hasZone, ZONE_KEYS } from './zonetool.ts';
import { hasPickPlace, PAIR_HEX, pairKind, pairsOf, partnersOf, ZONE_PROPS } from './m5tools.ts';
import { sizeAxes } from './volumetool.ts';

/** Extra Inspector sections (BuildTools adds Layer / Group). Called with the part and the section body. */
export const inspectorHooks: ((p: PartRecord, body: HTMLElement) => void)[] = [];

export interface InspectorEvents {
  prop(id: number, key: string, value: number): void;
  unlink(id: number): void;
  del(id: number): void;
  /** U4: arm the patrol-zone tool for this part (DUSTY). */
  zone?(id: number): void;
  /** U5 (M5, D105): tag or untag this part (and the rest of the selection) for BUZZ. */
  tag?(id: number, on: boolean): void;
  /** U5 (M5): arm GRABBER's zone A / B pointer (ui/m5tools.ts). */
  grabZone?(id: number, zone: 'a' | 'b'): void;
}

/** U5 (M5, D105): parts BUZZ can be sent for: anything dynamic that isn't a critter (the sim ignores the bit on critters). */
export const taggable = (def: { readonly family: string; readonly critter?: unknown; readonly body: { readonly kind: string } } | undefined): boolean =>
  !!def && def.family !== 'critters' && !def.critter && def.body.kind === 'dynamic';
/** BUZZ carries up to 2 kg (GAME_SPEC §11). */
export const BUZZ_MAX_KG = 2;

const UNIT: Record<string, string> = { seconds: 's', kg: 'kg', angle: '°', metres: 'm', percent: '%', float: '', int: '' };
/** Plain hints under sliders ("steeper is faster"). Keyed by property name. */
const HINT: Record<string, string> = {
  angle: 'steeper is faster', fuse: 'longer waits before the bang', weight: 'heavier needs a harder press', mortar: 'higher holds together longer',
  speed: 'faster belt, faster parts', power: 'more push', zone_w: 'side to side', zone_d: 'front to back', zone_x: 'offset to its right', zone_z: 'offset forwards', delay: 'how long before it passes the signal on', strength: 'stronger pushes further',
  length: 'longer reaches further', air: 'more air, more lift', duration: 'how long it stays on', volume: 'louder carries further',
  // M4 parts (A4)
  capacity: 'how much it holds', rate: 'how fast it pours', start: 'how full it starts', flow: 'faster flow empties sooner',
  // M5 parts (A5): TRACTOR BEAM, the volumes, GRABBER
  range: 'how far the beam reaches', hold: 'where along the beam it holds things', width: 'side to side', height: 'how tall', depth: 'front to back',
  aYaw: 'which way it reaches, from its front', bYaw: 'which way it reaches, from its front', aReach: 'how far out it picks up', bReach: 'how far out it puts down',
  aHeight: 'how high above its base', bHeight: 'how high above its base', grip: 'wider grabs bigger things',
};
const SECTIONS = ['props', 'zone', 'transform', 'ports', 'org'] as const;
type Section = (typeof SECTIONS)[number];

const CELL_UNITS = 64; // pos units per 10 cm cell

export class Inspector {
  readonly el: HTMLElement;
  private part: PartRecord | null = null;
  private pinned: number | null = null;
  private tab: 'props' | 'skin' = 'props';
  private openState: Record<string, Partial<Record<Section, boolean>>> = load('kn.ins.open', {});
  private deferred = false;
  /** Selection size, for the "+n more selected" line (set by the HUD). */
  selectionSize: () => number = () => 1;
  onVisible: (shown: boolean) => void = () => {};

  constructor(el: HTMLElement, private readonly net: NetClient, private readonly ev: InspectorEvents) {
    this.el = el;
    el.addEventListener('focusout', () => { if (this.deferred) { this.deferred = false; setTimeout(() => this.render(), 0); } });
    el.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement) e.stopPropagation(); });
  }

  get shown(): boolean { return this.el.classList.contains('open'); }
  get current(): PartRecord | null { return this.part; }

  /** Show a part (or null: slide out unless pinned). */
  show(p: PartRecord | null): void {
    if (!p && this.pinned !== null) p = this.net.store?.doc.parts.get(this.pinned) ?? null;
    if (!p) this.pinned = null;
    const same = p && this.part && p.id === this.part.id;
    this.part = p;
    if (same && this.el.contains(document.activeElement) && document.activeElement !== this.el) { this.deferred = true; return; }
    this.render();
  }

  private render(): void {
    const p = this.part;
    const def = p ? partDef(p.type) : undefined;
    const was = this.shown;
    this.el.classList.toggle('open', !!def);
    this.el.setAttribute('aria-hidden', String(!def));
    if (was !== !!def) this.onVisible(!!def);
    if (!p || !def) return;
    const props = propValues(def, p.props);
    const fam = familyLabel(def.family);
    const more = this.selectionSize() - 1;
    this.el.innerHTML = `
      <header class="ins-head">
        <span class="ins-icon well"></span>
        <div class="ins-name"><b></b><small></small></div>
        <button class="icon-btn${this.pinned === p.id ? ' on' : ''}" data-a="pin" aria-pressed="${this.pinned === p.id}" aria-label="Pin the Inspector to this part" title="Pin">${ICON.pin}</button>
        <button class="icon-btn danger" data-a="del" aria-label="Delete part (Del)" title="Delete (Del)">${ICON.trash}</button>
      </header>
      <div class="seg tabs2" role="tablist" aria-label="Inspector sections"><button role="tab" data-tab="props">Properties</button><button role="tab" data-tab="skin">Skin</button></div>
      <div class="ins-body"></div>`;
    this.el.querySelector('.ins-icon')!.appendChild(partIcon(p.type, { size: 44, props }));
    (this.el.querySelector('.ins-name b') as HTMLElement).textContent = def.name;
    (this.el.querySelector('.ins-name small') as HTMLElement).textContent = `${def.tag} · ${fam}${more > 0 ? ` · +${more} more selected` : ''}`;
    (this.el.querySelector('[data-a=pin]') as HTMLElement).onclick = () => { this.pinned = this.pinned === p.id ? null : p.id; this.render(); };
    (this.el.querySelector('[data-a=del]') as HTMLElement).onclick = () => { this.pinned = null; this.ev.del(p.id); };
    for (const b of this.el.querySelectorAll<HTMLElement>('.tabs2 button')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.onclick = () => { this.tab = b.dataset.tab as 'props' | 'skin'; this.render(); };
    }
    const body = this.el.querySelector('.ins-body') as HTMLElement;
    if (this.tab === 'skin') { this.skin(body, p); return; }
    // U4 (M4): a part with a patrol zone (DUSTY, stream B4) gets its own section: Draw zone, then the zone's numbers
    const zoned = hasZone(def);
    // U5 (M5): GRABBER's zone props get their own section with the pointer tool
    const pick = hasPickPlace(def) ? [...ZONE_PROPS[def.type]!.a, ...ZONE_PROPS[def.type]!.b] : [];
    const plain = zoned || pick.length ? Object.fromEntries(Object.entries(def.props).filter(([k]) => !(ZONE_KEYS as readonly string[]).includes(k) && !pick.includes(k))) : def.props;
    if (Object.keys(plain).length) this.section(body, 'props', 'Properties', p, (b) => this.propRows(b, p, plain, props));
    if (zoned) this.section(body, 'zone', 'Patrol zone', p, (b) => {
      const btn = h<HTMLButtonElement>(`<button class="primary-blue zone-draw">${ICON.section}<span>Draw the zone on the floor</span></button>`);
      btn.title = 'Drag a rectangle on the floor (or Enter at two corners with the keyboard cursor). Esc cancels.';
      btn.onclick = () => this.ev.zone?.(p.id);
      b.appendChild(btn);
      const zp = Object.fromEntries(Object.entries(def.props).filter(([k]) => (ZONE_KEYS as readonly string[]).includes(k)));
      this.propRows(b, p, zp, props);
    });
    if (pick.length) this.section(body, 'zone', 'Zones A and B', p, (b) => {
      for (const z of ['a', 'b'] as const) {
        const btn = h<HTMLButtonElement>(`<button class="primary-blue zone-draw grab-${z}">${ICON.ping}<span></span></button>`);
        (btn.lastElementChild as HTMLElement).textContent = z === 'a' ? 'Point zone A (pick up from)' : 'Point zone B (put down at)';
        btn.title = 'Click the spot in the world (or press Enter at the keyboard cursor). Esc cancels.';
        btn.onclick = () => this.ev.grabZone?.(p.id, z);
        b.appendChild(btn);
        const keys = ZONE_PROPS[def.type]![z];
        this.propRows(b, p, Object.fromEntries(keys.map((k) => [k, def.props[k]!])), props);
      }
    });
    // U5 (M5): sizing handles hint for volume parts (FORCE WALL, STASIS FIELD, ZONE)
    if (sizeAxes(def).length) {
      const n = h('<p class="ins-sub ins-size-hint"></p>');
      n.innerHTML = `${ICON.resize}<span>Drag the blue handles in the world to resize, or Shift+= / Shift+− for a step.</span>`;
      body.querySelector('.ins-sec .ins-sec-b')?.appendChild(n);
    }
    this.section(body, 'transform', 'Transform', p, (b) => this.transform(b, p, def.body.kind === 'dynamic'));
    if (def.ports.length) this.section(body, 'ports', `Connections · ${def.ports.length}`, p, (b) => this.ports(b, p));
    this.section(body, 'org', 'Layer / Group', p, (b) => { for (const fn of inspectorHooks) fn(p, b); });
    // Lock part + note
    const tail = h('<div class="ins-tail"></div>');
    tail.appendChild(this.switchRow('Lock part', (p.flags & PartFlag.Locked) !== 0, (on) => {
      const doc = this.net.store?.doc;
      const op = doc ? flagOp(doc, [p.id], PartFlag.Locked, on) : null;
      if (op) this.net.submit(op);
    }, 'Locked parts can’t be picked or edited. Unlock in the Outliner.'));
    // U5 (M5, D105): BUZZ fetches the nearest tagged object when its BUZZ BEACON gets a signal
    if (taggable(def) && PartFlag.Tagged) {
      const on = (p.flags & PartFlag.Tagged) !== 0;
      const row = this.switchRow('Tagged for BUZZ', on, (v) => this.ev.tag?.(p.id, v), 'BUZZ fetches the nearest tagged object (up to 2 kg) when its BUZZ BEACON gets a signal, and drops it on the beacon.');
      row.classList.add('ins-tag');
      row.firstElementChild!.insertAdjacentHTML('afterbegin', `<i class="tag-ic" aria-hidden="true">${ICON.tag}</i>`);
      tail.appendChild(row);
      if (def.body.mass > BUZZ_MAX_KG) {
        const w = h('<p class="ins-sub warn"></p>');
        w.textContent = `Too heavy for BUZZ: ${def.body.mass} kg (BUZZ carries up to ${BUZZ_MAX_KG} kg), so it stays put.`;
        tail.appendChild(w);
      }
    }
    const c = cards()[p.type];
    const note = h(`<p class="ins-note well">${def.ports.length ? '' : glyph('impact', 18)}<span></span></p>`);
    (note.lastElementChild as HTMLElement).textContent = `${def.ports.length ? `${def.ports.length} port${def.ports.length === 1 ? '' : 's'}.` : 'No ports.'} ${c?.does ?? ''}`.trim();
    tail.appendChild(note);
    body.appendChild(tail);
  }

  private section(body: HTMLElement, id: Section, title: string, p: PartRecord, fill: (b: HTMLElement) => void): void {
    const open = this.openState[p.type]?.[id] ?? true;
    const s = h(`<section class="ins-sec${open ? ' open' : ''}"><button class="ins-sec-h" aria-expanded="${open}"><span></span>${ICON.chevron}</button><div class="ins-sec-b well"></div></section>`);
    (s.querySelector('.ins-sec-h span') as HTMLElement).textContent = title;
    (s.querySelector('.ins-sec-h') as HTMLElement).onclick = () => {
      const next = !s.classList.contains('open');
      s.classList.toggle('open', next);
      s.querySelector('.ins-sec-h')!.setAttribute('aria-expanded', String(next));
      (this.openState[p.type] ??= {})[id] = next;
      save('kn.ins.open', this.openState);
    };
    fill(s.querySelector('.ins-sec-b') as HTMLElement);
    body.appendChild(s);
  }

  private propRows(b: HTMLElement, p: PartRecord, specs: Readonly<Record<string, PropSpec>>, vals: Record<string, number>): void {
    for (const [key, spec] of Object.entries(specs)) {
      const v = vals[key]!;
      if (key === 'pair' && pairKind(p.type)) { this.pairRow(b, p, spec, v); continue; } // U5 (M5)
      if (spec.type === 'enum') {
        const row = h(`<div class="ins-row"><span class="lbl"></span><div class="seg" role="radiogroup"></div></div>`);
        (row.firstElementChild as HTMLElement).textContent = spec.label;
        row.querySelector('.seg')!.setAttribute('aria-label', spec.label);
        spec.values!.forEach((name, i) => {
          const btn = h<HTMLButtonElement>(`<button role="radio" aria-checked="${i === v}" class="${i === v ? 'on' : ''}"></button>`);
          btn.textContent = name;
          btn.onclick = () => this.ev.prop(p.id, key, i);
          row.querySelector('.seg')!.appendChild(btn);
        });
        b.appendChild(row);
      } else if (spec.type === 'bool') {
        b.appendChild(this.switchRow(spec.label, v === 1, (on) => this.ev.prop(p.id, key, on ? 1 : 0)));
      } else {
        const unit = UNIT[spec.type] ?? '';
        const min = spec.min ?? 0, max = spec.max ?? 1, step = spec.step ?? 1;
        const dp = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
        const fmt = (x: number): string => `${Math.abs(x) >= 10000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(dp)}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`;
        const row = h(`<div class="ins-row slider">
          <div class="ins-row-top"><label class="lbl"></label><input class="num mono" inputmode="decimal" aria-label=""/></div>
          <input type="range" class="range" min="${min}" max="${max}" step="${step}" aria-label="${esc(spec.label)}"/>
          <div class="ins-range-foot mono"><span>${esc(fmt(min))}</span><span class="hint"></span><span>${esc(fmt(max))}</span></div></div>`);
        (row.querySelector('.lbl') as HTMLElement).textContent = spec.label;
        (row.querySelector('.hint') as HTMLElement).textContent = HINT[key] ?? '';
        const num = row.querySelector('.num') as HTMLInputElement;
        const range = row.querySelector('.range') as HTMLInputElement;
        num.setAttribute('aria-label', spec.label);
        num.value = fmt(v);
        range.value = String(v);
        range.style.setProperty('--f', String((v - min) / (max - min || 1)));
        range.setAttribute('aria-valuetext', fmt(v));
        range.oninput = () => { num.value = fmt(Number(range.value)); range.setAttribute('aria-valuetext', num.value); range.style.setProperty('--f', String((Number(range.value) - min) / (max - min || 1))); };
        range.onchange = () => this.ev.prop(p.id, key, Number(range.value));
        num.onfocus = () => num.select();
        num.onchange = () => {
          const x = parseFloat(num.value.replace(/[,\s]/g, ''));
          if (!Number.isFinite(x)) { num.value = fmt(v); return; }
          const q = Math.min(max, Math.max(min, Math.round((x - min) / step) * step + min));
          this.ev.prop(p.id, key, Number(q.toFixed(6)));
        };
        num.onkeydown = (e) => { if (e.key === 'Enter') num.blur(); if (e.key === 'Escape') { num.value = fmt(v); num.blur(); } };
        b.appendChild(row);
      }
    }
  }

  /**
   * U5 (M5): RIFT GATES / BUZZ BEACON / BUZZ pair colour: named chips (a swatch plus the name; never colour alone)
   * with how many of this part type use each colour, and what this part is paired with.
   */
  private pairRow(b: HTMLElement, p: PartRecord, spec: PropSpec, v: number): void {
    const k = pairKind(p.type)!;
    const doc = this.net.store?.doc;
    const parts = doc ? [...doc.parts.values()] : [];
    const { links, lonely } = pairsOf(parts);
    const pairVal = (q: PartRecord): number => (q.id === p.id ? v : Math.round(propValues(partDef(q.type)!, q.props).pair ?? -1));
    const row = h(`<div class="ins-row pair-row"><span class="lbl"></span><div class="seg pair-seg" role="radiogroup"></div><p class="ins-sub pair-state"></p></div>`);
    (row.firstElementChild as HTMLElement).textContent = spec.label;
    const seg = row.querySelector('.pair-seg') as HTMLElement;
    seg.setAttribute('aria-label', spec.label);
    k.names.forEach((name, i) => {
      const n = parts.filter((q) => q.type === p.type && pairVal(q) === i).length;
      const btn = h<HTMLButtonElement>(`<button role="radio" aria-checked="${i === v}" class="pair-chip${i === v ? ' on' : ''}"><i class="sw"></i><span></span><small></small></button>`);
      (btn.querySelector('.sw') as HTMLElement).style.background = PAIR_HEX[name] ?? '#888';
      (btn.querySelector('span') as HTMLElement).textContent = name;
      (btn.querySelector('small') as HTMLElement).textContent = n ? String(n) : '';
      btn.setAttribute('aria-label', `${name}${n ? `, ${n} ${p.type === 'rift_gate' ? 'gate' : partDef(p.type)?.name ?? ''}${n === 1 ? '' : 's'}` : ''}`);
      btn.onclick = () => this.ev.prop(p.id, 'pair', i);
      seg.appendChild(btn);
    });
    const partner = partnersOf(p.id, links)[0];
    const pn = partner !== undefined ? doc?.parts.get(partner) : undefined;
    const name = k.names[v] ?? '?';
    const st = row.querySelector('.pair-state') as HTMLElement;
    if (p.type === 'rift_gate') {
      // A5: gates of a colour pair in part order, 1st + 2nd, 3rd + 4th …: say where this one falls when there are more than two
      const same = parts.filter((q) => q.type === 'rift_gate' && pairVal(q) === v).sort((x, y) => x.id - y.id);
      const nth = same.findIndex((q) => q.id === p.id) + 1;
      const order = same.length > 2 ? ` ${name} gate ${nth} of ${same.length}: gates of a colour pair in the order they were placed (1st + 2nd, 3rd + 4th…).` : '';
      st.textContent = pn ? `Paired with the other ${name} gate (#${pn.id % 4294967296}).${order}` : lonely.has(p.id) ? `No twin yet: place another ${name} gate (or pick a colour that has one).${order}` : order;
    }
    else if (p.type === 'buzz') st.textContent = pn ? `Docks on the ${name} BUZZ BEACON (#${pn.id % 4294967296}).` : `No ${name} BUZZ BEACON free: place one, or pick its colour.`;
    else st.textContent = pn ? `${name} BUZZ docks here (#${pn.id % 4294967296}).` : `No BUZZ on ${name} yet: a BUZZ with this colour docks here.`;
    st.classList.toggle('warn', !pn);
    b.appendChild(row);
  }

  private transform(b: HTMLElement, p: PartRecord, dynamic: boolean): void {
    const snap = load<boolean>('kn.snap', true);
    const grid = h(`<div class="ins-xyz"></div>`);
    (['X', 'Y', 'Z'] as const).forEach((ax, i) => {
      const cell = h(`<label class="xyz ax-${ax.toLowerCase()}"><span>${ax}</span><input class="num mono" inputmode="decimal" aria-label="${ax} position in cells"/></label>`);
      const input = cell.querySelector('input') as HTMLInputElement;
      const cells = p.pos[i]! / CELL_UNITS;
      input.value = fmtCells(cells);
      input.title = `${posToMetres(p.pos[i]!).toFixed(3)} m`;
      input.onfocus = () => input.select();
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
      input.onchange = () => {
        const x = parseFloat(input.value);
        if (!Number.isFinite(x)) { input.value = fmtCells(cells); return; }
        const units = snap ? Math.round(x) * CELL_UNITS : Math.round(x * CELL_UNITS);
        const pos = [...p.pos] as [number, number, number];
        pos[i] = Math.max(i === 1 ? 0 : -metresToPos(500), Math.min(metresToPos(500), units));
        this.net.submit({ k: 'PartUpdate', id: p.id, patch: { pos } });
      };
      grid.appendChild(cell);
    });
    b.appendChild(grid);
    const e = eulerOf(p.rot);
    const rot = h(`<div class="ins-row inline"><span class="lbl">Rotation</span><div class="stepper">
      <button aria-label="Rotate −15°">−</button><input class="num mono" aria-label="Yaw in degrees"/><button aria-label="Rotate +15°">+</button></div></div>`);
    const ri = rot.querySelector('input') as HTMLInputElement;
    ri.value = `${Math.round(e.yaw)}°`;
    const setYaw = (yaw: number): void => { this.net.submit({ k: 'PartUpdate', id: p.id, patch: { rot: snappedEuler(snap ? Math.round(yaw / 15) * 15 : yaw, e.pitch, e.roll) } }); };
    const [minus, plus] = rot.querySelectorAll('button');
    minus!.onclick = () => setYaw(e.yaw - 15);
    plus!.onclick = () => setYaw(e.yaw + 15);
    ri.onfocus = () => ri.select();
    ri.onkeydown = (ev) => { if (ev.key === 'Enter') ri.blur(); };
    ri.onchange = () => { const x = parseFloat(ri.value); if (Number.isFinite(x)) setYaw(x); else ri.value = `${Math.round(e.yaw)}°`; };
    b.appendChild(rot);
    if (e.pitch || e.roll) {
      const pr = h('<p class="ins-sub mono"></p>');
      pr.textContent = `pitch ${Math.round(e.pitch)}° · roll ${Math.round(e.roll)}° (T / Y)`;
      b.appendChild(pr);
    }
    b.appendChild(this.switchRow('Snap to grid', snap, (on) => { save('kn.snap', on); this.render(); }, 'Position edits land on whole 10 cm cells; rotation on 15° steps.'));
    if (dynamic) b.appendChild(this.switchRow('Anchored', (p.flags & 32) !== 0, (on) => this.ev.prop(p.id, '__anchored', on ? 1 : 0), 'Pinned in place: it won’t fall or get knocked away.'));
  }

  private ports(b: HTMLElement, p: PartRecord): void {
    const def = partDef(p.type)!;
    const doc = this.net.store?.doc;
    def.ports.forEach((port, i) => {
      const links = doc ? [...doc.links.values()].filter((l) => (l.from?.part === p.id && l.from.port === i) || (l.to?.part === p.id && l.to.port === i)) : [];
      const row = h(`<div class="ins-port">${glyph(port.channel, 16)}<span class="pn"></span><small></small><span class="pl"></span></div>`);
      (row.querySelector('.pn') as HTMLElement).textContent = port.name;
      (row.querySelector('small') as HTMLElement).textContent = port.dir === port.name || port.dir === 'both' ? '' : port.dir;
      const pl = row.querySelector('.pl') as HTMLElement;
      if (!links.length) pl.textContent = '—';
      for (const l of links) {
        const other = l.from?.part === p.id ? l.to : l.from;
        const op = other && doc ? doc.parts.get(other.part) : undefined;
        const chip = h<HTMLButtonElement>(`<button class="link-chip" title="Unlink"><span></span>${ICON.close}</button>`);
        (chip.firstElementChild as HTMLElement).textContent = op ? partDef(op.type)?.name ?? op.type : '…';
        chip.setAttribute('aria-label', `Unlink from ${chip.textContent}`);
        chip.onclick = () => this.ev.unlink(l.id);
        pl.appendChild(chip);
      }
      b.appendChild(row);
    });
  }

  private skin(body: HTMLElement, p: PartRecord): void {
    const s = h(`<section class="ins-sec open"><div class="ins-sec-b well">
      <div class="skin-sw"><span class="sw on"></span><div><b>Factory finish</b><small>Every part ships in its kit colours.</small></div></div>
      <p class="ins-sub">Skins arrive with the textured part pass (D78). The world remembers the choice per part.</p></div></section>`);
    void p;
    body.appendChild(s);
  }

  private switchRow(label: string, on: boolean, change: (on: boolean) => void, help?: string): HTMLElement {
    const row = h(`<div class="ins-row inline"><span class="lbl"></span><button class="switch" role="switch" aria-checked="${on}"><i></i></button></div>`);
    (row.firstElementChild as HTMLElement).textContent = label;
    const sw = row.querySelector('.switch') as HTMLButtonElement;
    sw.setAttribute('aria-label', label);
    if (help) sw.title = help;
    sw.onclick = () => change(sw.getAttribute('aria-checked') !== 'true');
    return row;
  }
}

function eulerOf(r: Rotation): { yaw: number; pitch: number; roll: number } {
  if (r.tag === 1) return { yaw: r.yaw / 2, pitch: r.pitch / 2, roll: r.roll / 2 };
  return { yaw: 0, pitch: 0, roll: 0 };
}

const fmtCells = (c: number): string => (Number.isInteger(c) ? String(c) : c.toFixed(2));

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* session only */ }
}
