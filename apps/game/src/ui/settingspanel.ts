// Settings panel (UI_UX §4.10): Graphics · Comfort · Accessibility · Controls · Audio · Multiplayer ·
// World · About. Edits the per-viewer `settings` object (ui/settings.ts); the World tab is shared state
// and goes out as an EnvUpdate op instead.

import {
  ACTIONS, autoJoltThreads, bindingOf, conflicts, getSetting, JOLT_THREAD_CHOICES, keyLabel, keyName, onSettingsChange, resetSettings, setSetting, settings,
  type Settings,
} from './settings.ts';
import { announce, rovingFocus, trapFocus } from './a11y.ts';
import { presetOf } from '@knockon/parts-data';
import { envHasZones } from '@knockon/format';
import { WIND_PRESETS, type EnvWind } from '@knockon/format'; // W5 (M5, D26): Settings › World › Weather

export interface EnvChoice { readonly id: string; readonly label: string; readonly note: string }
export const ENVIRONMENTS: readonly EnvChoice[] = [
  { id: 'tinker', label: 'The Tinker Lab', note: 'A warm science-classroom workbench (default for Desk and Room)' },
  { id: 'studio', label: 'The Studio', note: 'Neutral cyclorama, built for clarity' },
  { id: 'kitchen', label: 'Mega Kitchen', note: 'A giant kitchen counter (art streams in as it lands)' },
  { id: 'backlot', label: 'The Backlot', note: 'An outdoor lot with sculptable terrain (Arena and Megastructure)' },
  // U5 (M5, W5's environments): ORBITAL HANGAR and MOON BASE (GAME_SPEC §10.2)
  { id: 'hangar', label: 'Orbital Hangar', note: 'A space-station hangar at 38 % gravity, with zero-g zones (Warehouse and Arena)' },
  { id: 'moon', label: 'Moon Base', note: '16.5 % gravity and no air: HELIOs sink, GALEs do nothing (Room to Arena)' },
];

/** U5 (M5): which presets host an environment, for "not in this size" notes (parts-data presets.ts `environments`). */
export function envPresets(id: string): string[] {
  return PRESET_IDS.filter((p) => presetOf(p)?.environments.includes(id));
}
const PRESET_IDS = ['desk', 'room', 'warehouse', 'arena', 'megastructure'] as const;
const PRESET_NAME: Record<string, string> = { desk: 'Desk', room: 'Room', warehouse: 'Warehouse', arena: 'Arena', megastructure: 'Megastructure' };

export interface SettingsHost {
  /** Current shared environment id (doc.env.environment). */
  environment(): string;
  /** Send an EnvUpdate op. */
  setEnvironment(id: string): void;
  /** Lines for the About tab. */
  about(): readonly (readonly [string, string])[];
  /** Diagnostics blob for "Export diagnostics". */
  diagnostics(): unknown;
  /** Why glass is forced solid ('tier' = 4 GB, 'budget' = frame-time fallback), or null (D77). */
  solidReason?(): string | null;
  /** MI (M4, D98): the Mega Kitchen's "Fill the sink" (doc.env.sinkFill), and an EnvUpdate op to change it. */
  sinkFill?(): boolean;
  setSinkFill?(on: boolean): void;
  /** U5 (M5): the world's size preset (doc.env.preset), for environments that only some sizes host. */
  preset?(): string;
  /** U5 (M5, W5): the Hangar's zero-g zones (doc.env.zones, absent = on), and an EnvUpdate op to change them. */
  zones?(): boolean;
  setZones?(on: boolean): void;
  /** W5 (M5, D26): global wind (doc.env.wind, absent = none), and an EnvUpdate op to change it. */
  wind?(): EnvWind | null;
  setWind?(w: EnvWind): void;
  /** W5 (M5): MOON BASE's "Base lights" (doc.env.baseLights, absent = off), and an EnvUpdate op to change it. */
  baseLights?(): boolean;
  setBaseLights?(on: boolean): void;
  /** U5 (M5): the world's Matter switch (effective simFlags.matterGameplay), and an EnvUpdate op (`env.matter`). */
  matter?(): boolean;
  setMatter?(on: boolean): void;
  /** U5 (M5): Jolt worker threads the sim worker reported at the last run start (null = no run yet this session). */
  joltThreadsLive?(): number | null;
  /** U5 (M5): the threads this session asked for at boot (undefined = Auto). */
  joltThreadsBoot?(): number | undefined;
}

type Tab = 'graphics' | 'performance' | 'comfort' | 'accessibility' | 'controls' | 'audio' | 'multiplayer' | 'world' | 'about';
const TABS: readonly (readonly [Tab, string])[] = [
  ['graphics', 'Graphics'], ['performance', 'Performance'], ['comfort', 'Comfort'], ['accessibility', 'Accessibility'], ['controls', 'Controls'],
  ['audio', 'Audio'], ['multiplayer', 'Multiplayer'], ['world', 'World'], ['about', 'About'],
];

export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private tab: Tab = 'graphics';
  private capturing: string | null = null;
  private readonly host: SettingsHost;
  private readonly trap: { opened(): void; closed(): void };

  constructor(parent: HTMLElement, host: SettingsHost) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.id = 'settings';
    this.el.className = 'kn-panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Settings');
    this.el.style.display = 'none';
    this.el.setAttribute('aria-modal', 'true');
    this.el.innerHTML = '<div class="set-head"><b id="set-title">Settings</b><button class="close" aria-label="Close settings (Esc)">✕</button></div><div class="set-tabs" role="tablist" aria-label="Settings sections"></div><div class="set-body" role="tabpanel" tabindex="-1"></div>';
    this.el.removeAttribute('aria-label');
    this.el.setAttribute('aria-labelledby', 'set-title');
    parent.appendChild(this.el);
    this.tabs = this.el.querySelector('.set-tabs') as HTMLElement;
    this.body = this.el.querySelector('.set-body') as HTMLElement;
    (this.el.querySelector('.close') as HTMLElement).onclick = () => this.toggle(false);
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('role', 'tab');
      b.id = `set-tab-${id}`;
      b.setAttribute('aria-controls', 'set-body');
      b.dataset.tab = id;
      b.onclick = () => { this.tab = id; this.render(); };
      this.tabs.appendChild(b);
    }
    this.el.addEventListener('keydown', (e) => {
      if (this.capturing) return; // handled by the capture listener
      if (e.key === 'Escape') { this.toggle(false); e.stopPropagation(); }
      // keep build shortcuts from firing while the panel has focus
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => this.capture(e), true);
    // U4: tabs move with the arrow keys (activation follows focus); Tab stays inside the dialog; focus goes
    // back to whatever opened it
    this.body.id = 'set-body';
    rovingFocus(this.tabs, { activateOnMove: true });
    this.trap = trapFocus(this.el, () => this.open);
    onSettingsChange(() => { if (this.open && !this.capturing) this.render(); });
  }

  get open(): boolean { return this.el.style.display !== 'none'; }

  toggle(show = !this.open, tab?: Tab): void {
    if (tab) this.tab = tab;
    const was = this.open;
    if (show && !was) this.trap.opened();
    this.el.style.display = show ? '' : 'none';
    if (show) { this.render(); (this.tabs.querySelector(`[data-tab=${this.tab}]`) as HTMLElement | null)?.focus(); }
    else if (was) this.trap.closed();
  }

  /** Controls tab: the next key press becomes the binding. */
  private capture(e: KeyboardEvent): void {
    if (!this.capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = this.capturing;
    this.capturing = null;
    if (e.key === 'Escape') { this.render(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || ['shift', 'control', 'alt', 'meta'].includes(keyName(e))) { this.render(); return; }
    const k = keyName(e);
    const def = ACTIONS.find((a) => a.id === id)!;
    const next = { ...settings.controls.bindings };
    if (k === def.key) delete next[id]; else next[id] = k;
    setSetting('controls.bindings', next);
  }

  private render(): void {
    for (const b of this.tabs.children) {
      const on = (b as HTMLElement).dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      (b as HTMLElement).tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `set-tab-${this.tab}`);
    this.body.innerHTML = '';
    const s = settings;
    switch (this.tab) {
      case 'graphics':
        this.select('graphics.tier', 'Quality tier', [['auto', 'Auto (from /check)'], [4, '4 GB'], [8, '8 GB'], [12, '12 GB'], [16, '16 GB'], [32, '32 GB (Max)']]);
        // U5 (M5, beta honesty): Budget override, Particle cap and Unlimited Mayhem have no consumer in the renderer or
        // the effects yet (docs/dev/M5_NOTES_U5.md), so they stay hidden until one reads them (the settings keys remain)
        this.slider('graphics.renderScale', 'Render scale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)} %`);
        this.toggleRow('graphics.dof', 'Depth of field', s.comfort.reducedMotion
          ? 'Off while Reduced motion is on (Comfort).' : 'Gentle tilt-shift focus on the selection in Build and on the action in Run.');
        this.toggleRow('graphics.darkCyc', 'Dark cyc (Studio)');
        break;
      case 'performance': this.performance(); break;
      case 'comfort':
        this.toggleRow('comfort.reduceFlashing', 'Reduce flashing', 'At most 3 large flashes per second (on by default).');
        this.slider('comfort.shake', 'Camera shake', 0, 1, 0.05, pct);
        this.slider('comfort.hitstop', 'Hitstop', 0, 1, 0.05, pct);
        this.slider('comfort.slowmo', 'Auto slow-mo', 0, 1, 0.05, pct);
        this.slider('comfort.directorCutRate', 'Director cut rate', 0, 1, 0.05, (v) => (v === 0 ? 'never' : v < 0.34 ? 'calm' : v < 0.67 ? 'normal' : 'frantic'));
        this.toggleRow('comfort.reducedMotion', 'Reduced motion', 'No springs, auto camera cuts or slow-mo; panels appear instantly.');
        break;
      case 'accessibility':
        this.select('accessibility.colourPreset', 'Colour preset', [['default', 'Default'], ['deuteranopia', 'Deuteranopia (red–green, green-weak)'], ['protanopia', 'Protanopia (red–green, red-weak)'], ['tritanopia', 'Tritanopia (blue–yellow)'], ['high-contrast', 'High contrast']],
          'Channel colours, player colours and warnings switch to a palette that stays distinct for this colour vision. Every channel also has its own glyph shape.');
        this.slider('accessibility.uiScale', 'UI scale', 0.75, 2, 0.05, (v) => `${Math.round(v * 100)} %`);
        this.toggleRow('accessibility.captions', 'Captions', 'Sounds and big moments as text above the run bar (“[BOOM] POWDER KEG ×6”, “[Biscuit barks]”), with an arrow towards where it happened, and critter emotes in words. Screen readers hear them too.');
        this.toggleRow('accessibility.keyboardAids', 'Keyboard building aids', 'Arrows move a cursor in the world (Ctrl = fine, PageUp/PageDown = height) · Enter places, picks up or wires · [ ] cycle parts, or ports in the Wire tool · Shift+arrows orbit, = / − zoom · Q opens a radial menu you can steer with arrows.');
        this.toggleRow('accessibility.portGlyphs', 'Port glyphs', 'Show each port’s channel glyph in the 3D view while wiring, in X-ray and on the hovered part, so channels never rely on colour alone.');
        this.transparencyRow();
        break;
      case 'controls': this.controls(); break;
      case 'audio':
        this.slider('audio.master', 'Master volume', 0, 1, 0.05, pct);
        this.slider('audio.music', 'Music', 0, 1, 0.05, pct);
        this.slider('audio.sfx', 'Effects', 0, 1, 0.05, pct);
        this.toggleRow('audio.muted', 'Mute');
        break;
      case 'multiplayer':
        this.text('multiplayer.nickname', 'Nickname', 'Shown to the other player. Applies on reconnect.', 24);
        // U5 (M5): the partner laser isn't drawn yet (HOW_TO_PLAY §13), so its switch stays hidden until it is
        this.toggleRow('multiplayer.pingSounds', 'Ping sounds', 'A blip when your partner pings (G).');
        break;
      case 'world': this.world(); break;
      case 'about': this.about(); break;
    }
    if (this.tab !== 'about' && this.tab !== 'world') {
      const foot = document.createElement('div');
      foot.className = 'set-foot';
      const reset = document.createElement('button');
      reset.textContent = 'Reset this tab';
      reset.onclick = () => resetSettings(this.tab as keyof Settings);
      foot.appendChild(reset);
      this.body.appendChild(foot);
    }
  }

  private row(label: string, help?: string, cls = ''): HTMLElement {
    const r = document.createElement('label');
    r.className = `set-row ${cls}`;
    r.innerHTML = '<span class="lbl"></span>';
    (r.firstChild as HTMLElement).textContent = label;
    if (help) {
      const h = document.createElement('small');
      h.textContent = help;
      r.appendChild(h);
    }
    this.body.appendChild(r);
    return r;
  }

  private slider(path: string, label: string, min: number, max: number, step: number, fmt: (v: number) => string): void {
    const r = this.row(label);
    const v = Number(getSetting(path));
    const out = document.createElement('em');
    out.textContent = fmt(v);
    (r.firstChild as HTMLElement).append(' ', out);
    const i = document.createElement('input');
    i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(v);
    i.oninput = () => { out.textContent = fmt(Number(i.value)); };
    i.onchange = () => setSetting(path, Number(i.value));
    // live for audio sliders (hear it as you drag)
    if (path.startsWith('audio.')) i.oninput = () => { out.textContent = fmt(Number(i.value)); setSetting(path, Number(i.value)); };
    r.appendChild(i);
  }

  private toggleRow(path: string, label: string, help?: string, cls = ''): void {
    const r = this.row(label, help, `tg ${cls}`);
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = getSetting(path) === true;
    c.onchange = () => setSetting(path, c.checked);
    r.prepend(c);
  }

  /** Reduce transparency: shows "On (automatic)" when the 4 GB tier or the frame-time fallback forces it. */
  private transparencyRow(): void {
    const why = this.host.solidReason?.() ?? null;
    const auto = why === 'tier' || why === 'budget';
    const help = auto
      ? `On (automatic): ${why === 'tier' ? 'the 4 GB tier always uses solid panels' : 'switched to solid panels to keep the frame rate (until the next launch or tier change)'}.`
      : 'Frosted-glass panels become solid Graphite, with the same layout and contrast.';
    this.toggleRow('accessibility.reduceTransparency', auto ? 'Reduce transparency: On (automatic)' : 'Reduce transparency', help);
    if (auto) {
      const c = this.body.lastElementChild?.querySelector('input') as HTMLInputElement | null;
      if (c) { c.checked = true; c.disabled = true; }
    }
  }

  private select(path: string, label: string, options: readonly (readonly [string | number, string])[], help?: string): void {
    const r = this.row(label, help);
    const sel = document.createElement('select');
    const cur = getSetting(path);
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = text;
      if (v === cur) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      const opt = options[sel.selectedIndex]!;
      setSetting(path, opt[0]);
    };
    r.appendChild(sel);
  }

  private text(path: string, label: string, help: string, max: number): void {
    const r = this.row(label, help);
    const i = document.createElement('input');
    i.maxLength = max;
    i.value = String(getSetting(path) ?? '');
    i.onchange = () => setSetting(path, i.value.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, max));
    r.insertBefore(i, r.children[1] ?? null);
  }

  private controls(): void {
    // BUILDUX (D124): port snapping (GAME_SPEC §7.2 rule 1)
    this.toggleRow('controls.portSnap', 'Snap to ports', 'Placing, dragging or pasting a part pulls a port onto a matching port within 5 cm (the ports glow). Hold Alt to place freely.');
    const dup = conflicts();
    const dupIds = new Set([...dup.values()].flat());
    const table = document.createElement('table');
    table.className = 'set-keys';
    table.innerHTML = '<thead><tr><th>Action</th><th>Key</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    let group = '';
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const g = document.createElement('tr');
        g.className = 'grp';
        g.innerHTML = `<td colspan="3"></td>`;
        (g.firstChild as HTMLElement).textContent = group === 'Fixed' ? 'Fixed shortcuts' : group;
        tb.appendChild(g);
      }
      const tr = document.createElement('tr');
      if (dupIds.has(a.id)) tr.className = 'conflict';
      const k = bindingOf(a.id);
      tr.innerHTML = '<td></td><td></td><td></td>';
      (tr.children[0] as HTMLElement).textContent = a.label;
      const keyCell = tr.children[1] as HTMLElement;
      if (a.fixed) keyCell.innerHTML = `<kbd>${escape(keyLabel(k))}</kbd>`;
      else {
        const b = document.createElement('button');
        b.className = 'keybtn';
        b.textContent = this.capturing === a.id ? 'Press a key…' : keyLabel(k);
        b.title = 'Click, then press the new key (Esc cancels)';
        b.setAttribute('aria-label', `${a.label}: ${keyLabel(k)}. Press Enter, then the new key`);
        b.onclick = (e) => { e.preventDefault(); this.capturing = a.id; b.textContent = 'Press a key…'; announce(`Press the new key for ${a.label}, or Escape to cancel`); };
        keyCell.appendChild(b);
        if (settings.controls.bindings[a.id] !== undefined) {
          const reset = document.createElement('button');
          reset.className = 'mini';
          reset.textContent = '↺';
          reset.title = `Back to ${keyLabel(a.key)}`;
          reset.onclick = () => { const n = { ...settings.controls.bindings }; delete n[a.id]; setSetting('controls.bindings', n); };
          tr.children[2]!.appendChild(reset);
        }
      }
      if (dupIds.has(a.id)) {
        const w = document.createElement('small');
        w.className = 'warn';
        w.textContent = ' conflict';
        keyCell.appendChild(w);
      }
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    this.body.appendChild(table);
    if (dup.size) {
      const n = document.createElement('p');
      n.className = 'set-note warn';
      n.textContent = 'Two actions share a key: the first one listed wins. Rebind one of them.';
      this.body.appendChild(n);
    }
  }

  /** U5 (M5): Settings › Performance › Physics threads (D99; applies on reload, like the quality tier). */
  private performance(): void {
    const cores = navigator.hardwareConcurrency || 4;
    const auto = autoJoltThreads(cores);
    const cur = settings.performance.joltThreads;
    const counts = JOLT_THREAD_CHOICES.filter((n) => n === 0 || n <= Math.max(cores, 2) || n === cur);
    this.select('performance.joltThreads', 'Physics threads', [
      ['auto', `Auto (${auto} threads on this PC)`],
      ...counts.map((n) => [n, n === 0 ? 'Off (single-threaded)' : `${n} threads`] as const),
    ], `Applies when you reload the page. Big machines (thousands of parts, huge blasts) stay in real time with more threads; small ones don’t notice. Machines play out exactly the same at any setting, so you and your partner can choose differently. Auto leaves 3 of your ${cores} cores for the game and the browser.`);
    const live = this.host.joltThreadsLive?.() ?? null;
    const boot = this.host.joltThreadsBoot?.();
    const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    const note = document.createElement('p');
    note.className = 'set-note';
    note.id = 'set-threads-now';
    const asked = boot === undefined ? `Auto (${auto})` : boot === 0 ? 'single-threaded' : `${boot}`;
    note.textContent = !isolated
      ? 'This page isn’t cross-origin isolated, so physics runs single-threaded whatever you choose (open /check to see why).'
      : live === null ? `This session asked for ${asked}; the count in use shows here after the first run.`
        : `This session: ${live > 0 ? `${live} physics worker threads` : 'single-threaded physics'}${live === 0 && boot !== 0 ? ' (the threads didn’t start, so it fell back)' : ''}. The perf readout (F9) shows it too.`;
    const want = cur === 'auto' ? undefined : cur;
    if (want !== boot) note.textContent += ' Reload to use the new setting.';
    this.body.appendChild(note);
  }

  private world(): void {
    const note = document.createElement('p');
    note.className = 'set-note';
    note.textContent = 'Shared with your partner: changing the environment updates the world for both of you.';
    this.body.appendChild(note);
    const cur = this.host.environment();
    const preset = this.host.preset?.() ?? '';
    const list = document.createElement('div');
    list.className = 'env-pick';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Environment');
    for (const env of ENVIRONMENTS) {
      const b = document.createElement('button');
      // U5 (M5): an environment this world's size doesn't host is shown, but can't be picked (it says which sizes do)
      const hosts = envPresets(env.id);
      const fits = !preset || hosts.includes(preset) || env.id === cur;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(env.id === cur));
      b.className = env.id === cur ? 'on' : '';
      b.innerHTML = '<b></b><small></small>';
      (b.firstChild as HTMLElement).textContent = env.label;
      (b.lastChild as HTMLElement).textContent = fits ? env.note : `Not for ${PRESET_NAME[preset] ?? preset} worlds: ${hosts.length ? hosts.map((p) => PRESET_NAME[p]).join(', ') : 'coming with its art'}`;
      if (!fits) { b.setAttribute('aria-disabled', 'true'); b.classList.add('off'); }
      b.onclick = () => { if (!fits) { announce(`${env.label} isn’t available for this size`); return; } if (env.id !== this.host.environment()) this.host.setEnvironment(env.id); setTimeout(() => this.render(), 50); };
      list.appendChild(b);
    }
    this.body.appendChild(list);
    // U5 (M5, W5): the Orbital Hangar's zero-g zones (all toggle together; they can't be moved)
    if (envHasZones(cur) && this.host.zones && this.host.setZones) {
      const r = this.row('Zero-g zones', 'The glowing floor rings float anything inside them. Turn them off for a plain low-gravity hangar. Shared with your partner.', 'tg');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = this.host.zones();
      c.onchange = () => { this.host.setZones?.(c.checked); setTimeout(() => this.render(), 50); };
      r.prepend(c);
    }
    // W5 (M5): MOON BASE's "Base lights" (env.baseLights): the lander floodlights, off by default (shared, undoable)
    if (cur === 'moon' && this.host.baseLights && this.host.setBaseLights) {
      const r = this.row('Base lights', 'Switches on the lander’s two floodlights. Shared with your partner.', 'tg');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = this.host.baseLights();
      c.onchange = () => { this.host.setBaseLights?.(c.checked); setTimeout(() => this.render(), 50); };
      r.prepend(c);
    }
    // W5 (M5, D26): global wind (env.wind): a weather preset, speed and direction (shared, undoable; no air = no wind)
    if (this.host.wind && this.host.setWind) {
      const w = this.host.wind() ?? { speed: 0, dir: 0, gusts: 'none' as const };
      const send = (next: { speed: number; dir: number; gusts?: 'none' | 'breezy' | 'gusty' | 'overcast' }): void => { this.host.setWind?.(next); setTimeout(() => this.render(), 50); };
      const pr = this.row('Weather', 'Wind pushes light and large parts and leans HELIOs; over 4 m/s it blows out flames. Gusts are seeded, so runs replay the same. Shared with your partner.');
      const sel = document.createElement('select');
      const presets = [['calm', 'Calm (no wind)'], ['breezy', 'Breezy · 3 m/s'], ['gusty', 'Gusty · 6–10 m/s'], ['overcast', 'Overcast · 2 m/s'], ['custom', 'Custom']] as const;
      const curP = w.speed === 0 && (w.gusts ?? 'none') === 'none' ? 'calm' : presets.find(([id]) => id !== 'custom' && id !== 'calm' && w.gusts === id && w.speed === WIND_PRESETS[id].speed)?.[0] ?? 'custom';
      for (const [id, text] of presets) { const o = document.createElement('option'); o.value = id; o.textContent = text; o.selected = id === curP; sel.appendChild(o); }
      sel.onchange = () => { const id = sel.value as keyof typeof WIND_PRESETS | 'custom'; if (id !== 'custom') send({ ...WIND_PRESETS[id], dir: w.dir }); };
      pr.appendChild(sel);
      const sr = this.row('Wind speed');
      const out = document.createElement('em');
      out.textContent = `${w.speed.toFixed(1)} m/s`;
      (sr.firstChild as HTMLElement).append(' ', out);
      const sp = document.createElement('input');
      sp.type = 'range'; sp.min = '0'; sp.max = '15'; sp.step = '0.5'; sp.value = String(w.speed);
      sp.setAttribute('aria-label', 'Wind speed, metres per second');
      sp.oninput = () => { out.textContent = `${Number(sp.value).toFixed(1)} m/s`; };
      sp.onchange = () => send({ ...w, speed: Number(sp.value) });
      sr.appendChild(sp);
      const dr = this.row('Wind blows toward');
      const ds = document.createElement('select');
      for (const [deg, text] of [[0, 'Right (+X)'], [45, 'Back right'], [90, 'Back (away from the camera)'], [135, 'Back left'], [180, 'Left (−X)'], [225, 'Front left'], [270, 'Front (toward the camera)'], [315, 'Front right']] as const) {
        const o = document.createElement('option'); o.value = String(deg); o.textContent = text; o.selected = deg === w.dir; ds.appendChild(o);
      }
      ds.onchange = () => send({ ...w, dir: Number(ds.value) });
      dr.appendChild(ds);
    }
    // U5 (M5): the world's Matter switch (M4_STATUS: there was no in-game matterGameplay toggle)
    if (this.host.matter && this.host.setMatter) {
      const r = this.row('Sand, water and marbles', 'Real Matter grains: hoppers pour sand and marbles, tanks pour water, FISHBOWL splashes. Off: containers still open, empty and signal on time, but nothing pours (lighter on the GPU; worlds saved before M4 start off). Shared with your partner.', 'tg');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = this.host.matter();
      c.onchange = () => { this.host.setMatter?.(c.checked); setTimeout(() => this.render(), 50); };
      r.prepend(c);
    }
    // MI (M4, D98): the Kitchen sink's Matter water (1M particles, needs the 16 GB tier; shared, undoable)
    if (cur === 'kitchen' && this.host.sinkFill && this.host.setSinkFill) {
      const r = this.row('Fill the sink', 'Runs start with the sink full of Matter water: 1 million particles (needs the 16 GB tier). Shared with your partner.', 'tg');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = this.host.sinkFill();
      c.onchange = () => { this.host.setSinkFill?.(c.checked); setTimeout(() => this.render(), 50); };
      r.prepend(c);
    }
  }

  private about(): void {
    const dl = document.createElement('dl');
    dl.className = 'set-about';
    for (const [k, v] of this.host.about()) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    this.body.appendChild(dl);
    const b = document.createElement('button');
    b.textContent = 'Export diagnostics';
    b.onclick = () => {
      const blob = new Blob([JSON.stringify(this.host.diagnostics(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `knockon-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    this.body.appendChild(b);
  }
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
