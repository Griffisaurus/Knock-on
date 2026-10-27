// Glass Lab HUD (D77, D80, D84, UI_UX v1.1 §3–4, mockup board "Build HUD"). Six glass surfaces in Build:
//   world card (top left, with the Outliner below it) · session bar (top right) · view rail (left)
//   Inspector (docked right) · transport pill (centred above the tray) · parts tray (bottom)
// The Run HUD (ui/runbar.ts) takes over while a run plays; the Library and the Cascade Report take the
// Inspector's place; the palette, Settings and dialogs are modal. GlassManager (ui/glass.ts) keeps at most
// six surfaces blurred and swaps everything to solid Graphite for Reduce transparency, the 4 GB tier, or
// when the UI frame cost goes over budget.
//
// main.ts creates this with buildHud(net) (the same interface the M2 buildUi had) and calls attach()
// once its controllers exist.

import { SINK_FILL_PARTICLES, sinkFilled, terrainHeightAt, type PartRecord } from '@knockon/format';
import { TerrainBrushTool } from '../gfx/terrain.ts';
import { bindShare, currentShareLink, importFromHost, openShareLink, shareWorld, type OpenResult } from '../share.ts';
import type { ServerMsgs } from '@knockon/net';
import type { CameraRig, OrbitCam } from '../cameras.ts';
import { presetOf } from '@knockon/parts-data';
import { PALETTE, partDef } from '../catalog.ts';
import type { Renderer } from '../gfx/renderer.ts';
import { invert, transform, type V3 } from '../math.ts';
import type { NetClient } from '../net.ts';
import { SPEEDS, type RunController } from '../run.ts';
import { ask } from './ask.ts';
import type { BuildTools } from './buildtools.ts';
import { GlassManager } from './glass.ts';
import { Hotbar } from './hotbar.ts';
import { h, ICON } from './icons.ts';
import { Inspector } from './inspector.ts';
import { Lobby } from './lobby.ts';
import { cards, PartCard, UI_PARTS, type Command, type Library, type Palette, type Radial } from './panels.ts';
import type { RunBar } from './runbar.ts';
import { onSettingsChange, settings, tierLabel } from './settings.ts';
import { PartsTray } from './tray.ts';
import { terrainHit } from './terrainpick.ts';
// M4 stream U4: accessibility (announcer, focus, keyboard building, captions, port glyphs)
import { announce, arrowGroups, releaseMouseFocus, rovingFocus } from './a11y.ts';
import type { KeyboardBuild } from './keyboard.ts';
import { A11yOverlays } from './overlays.ts';
import { grainStatus, worldGrains } from './matter.ts'; // U4: Matter load vs the tier's grain budget

type Tool = 'place' | 'select' | 'wire' | 'path';
type Nav = 'orbit' | 'pan' | 'zoom';

/** main.ts's controllers, handed over once they exist. */
export interface HudLinks {
  run: RunController;
  tools: BuildTools;
  library: Library;
  palette: Palette;
  radial: Radial;
  runBar: RunBar;
  camRig: CameraRig;
  cam: OrbitCam;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  choosePart(type: string): void;
  setTool(t: Tool): void;
  tool(): Tool;
  selectedType(): string;
  hoverPart(): PartRecord | null;
  /** DRAG (D117): a part drag or gizmo handle owns the left button (left-drag navigation stands down). */
  holdsPointer?(): boolean;
  /** DRAG (D117): the gizmo's X / Y / Z letter chips (world points, axis colours). */
  gizmoLabels?(): readonly { at: readonly number[]; text: string; color: string }[];
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* session only */ } },
};

export function buildHud(net: NetClient) {
  const root = document.documentElement;
  const viewport = $('#viewport');
  const toasts = $('#toasts');
  const chat = $('#chat');
  const lines = chat.querySelector('.lines') as HTMLElement;
  const input = chat.querySelector('input') as HTMLInputElement;
  const perf = $('#perf');
  const overlay = $('#overlay');
  const countdown = $('#countdown');
  const worldcard = $('#worldcard');
  const sessionbar = $('#sessionbar');
  const viewrail = $('#viewrail');
  const transport = $('#transport');
  const trayEl = $('#tray');
  const badge = $('#toolbadge');
  const marker = h('<div class="marker" aria-hidden="true"><div class="ring"></div><span></span></div>');
  marker.style.display = 'none';
  overlay.appendChild(marker);
  const listeners = {
    pick: [] as ((type: string) => void)[], tool: [] as ((t: Tool) => void)[], prop: [] as ((id: number, key: string, v: number) => void)[],
    unlink: [] as ((id: number) => void)[], del: [] as ((id: number) => void)[], rip: [] as (() => void)[],
  };
  let links: HudLinks | null = null;
  let kb: KeyboardBuild | null = null;
  // U4: arrow keys in every radio group / tab list / segment, and mouse clicks don't park focus on buttons
  arrowGroups(viewport);
  releaseMouseFocus(viewport);
  const overlays = new A11yOverlays(viewport, net);
  // U4: compact / tight layout from the effective viewport (window ÷ UI scale), so UI scale 75–200 % reflows
  const layout = (): void => {
    const sc = settings.accessibility.uiScale || 1, ew = innerWidth / sc, eh = innerHeight / sc;
    root.toggleAttribute('data-compact', ew < 1280 || eh < 760);
    root.toggleAttribute('data-tight', ew < 1000 || eh < 640);
    root.style.setProperty('--vw-z', `${ew.toFixed(1)}px`);
    root.style.setProperty('--vh-z', `${eh.toFixed(1)}px`);
  };
  layout();
  window.addEventListener('resize', layout);
  let netStatus: 'connecting' | 'online' | 'offline' | 'error' = 'connecting';
  let starter = 0;
  let lastRunId: string | null = null;

  // ---- glass ------------------------------------------------------------------------------------------
  const tierNow = (): number => (settings.graphics.tier !== 'auto' ? settings.graphics.tier : net.me?.tier ?? 16);
  const glass = new GlassManager({ reduceTransparency: () => settings.accessibility.reduceTransparency, tier: tierNow, toast: (t) => toast(t, 'warn') });
  onSettingsChange((_s, path) => {
    if (path === '*' || path.startsWith('accessibility') || path.startsWith('graphics')) glass.apply();
    // U4: glyph colours follow the colour preset; captions off clears the strip
    if (path === '*' || path === 'accessibility.colourPreset') { tray.render(); links?.library.refresh(); }
    if (path === 'accessibility.captions' && !settings.accessibility.captions) overlays.clear();
    if (path === '*' || path.startsWith('accessibility')) layout();
  });

  // ---- world card ---------------------------------------------------------------------------------------
  worldcard.innerHTML = `
    <div class="wc-head">
      <div class="wc-logo" aria-hidden="true">K<svg width="22" height="12" viewBox="0 0 22 12"><path d="M1 9 L15 6.4 L15.2 8.8 Z" fill="#FF5B2E"/><circle cx="16" cy="7.5" r="2.4" fill="#FFC870"/><path d="M18.4 5l1.6-1.8M19.2 7.8l1.6.3M18.1 10l1 1.4" stroke="#FF8A2A" stroke-width="1.1" stroke-linecap="round"/></svg></div>
      <div class="wc-main">
        <h1 class="wc-title" title="World title">…</h1>
        <div class="wc-meta well"><span class="wc-blurb"></span><span class="wc-save" role="status"><i></i><span>connecting…</span></span></div>
        <div class="wc-matter well" hidden><span class="wc-m-t mono"></span><span class="wc-m-bar" aria-hidden="true"><i></i></span></div>
      </div>
      <div class="wc-acts">
        <button class="icon-btn" data-a="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">${ICON.undo}</button>
        <button class="icon-btn" data-a="redo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)">${ICON.redo}</button>
      </div>
    </div>
    <button class="wc-env chip" title="Environment (shared with your partner): click to change"><span class="dot"></span><span class="nm">…</span><small class="mono"></small></button>
    <div class="wc-outliner"></div>`;
  const wcTitle = worldcard.querySelector('.wc-title') as HTMLElement;
  (worldcard.querySelector('[data-a=undo]') as HTMLElement).onclick = () => net.undo(false);
  (worldcard.querySelector('[data-a=redo]') as HTMLElement).onclick = () => net.undo(true);
  (worldcard.querySelector('.wc-env') as HTMLElement).onclick = () => links?.tools.settingsPanel.toggle(true, 'world');

  // ---- session bar ---------------------------------------------------------------------------------------
  sessionbar.innerHTML = `
    <div class="sb-partner" hidden><span class="av"></span><span class="sb-pn"><b></b><small class="mono"></small></span></div>
    <div class="sb-mode" role="group" aria-label="Mode"><button data-m="build" aria-pressed="true">BUILD</button><button data-m="run" aria-pressed="false">RUN</button></div>
    <button class="tile" data-a="save" title="Save on the host">${ICON.save}<span>Save</span></button>
    <button class="tile" data-a="share" title="Copy the session link">${ICON.share}<span>Share</span></button>
    <button class="tile" data-a="palette" title="Command palette (Ctrl K)" aria-label="Command palette (Ctrl K)">${ICON.search}<kbd>Ctrl K</kbd></button>
    <button class="tile" data-a="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Menu">${ICON.menu}<span>Menu</span></button>
    <div class="sb-menu well-pop" role="menu" hidden></div>
    <div class="sb-share well-pop" role="dialog" aria-label="Share" hidden>
      <b>Share the test system</b>
      <div class="sh-row"><input class="sh-link mono" readonly aria-label="Share link" value="Making a link…"/><button class="primary-blue sh-copy">Copy</button></div>
      <small class="sh-via"></small>
      <hr/>
      <b>Open a link</b>
      <div class="sh-row"><input class="sh-open" placeholder="Paste a KNOCK-ON link (this host or another)" aria-label="Link to open"/><button class="ghost sh-go">Open</button></div>
      <small class="sh-note">Worlds join this host's list (the host switches to them); modules go into this world's Library.</small>
    </div>`;
  const menu = sessionbar.querySelector('.sb-menu') as HTMLElement;
  const menuBtn = sessionbar.querySelector('[data-a=menu]') as HTMLElement;
  const MENU: readonly [keyof typeof ICON, string, () => void][] = [
    ['gear', 'Settings', () => links?.tools.settingsPanel.toggle(true)],
    ['worlds', 'Worlds & lobby', () => lobby.toggle(true)],
    ['library', 'Library', () => links?.library.toggle(true)],
    ['star', 'Cascade Report (last run)', () => links?.tools.showReport(true)],
    ['help', 'Keyboard shortcuts', () => links?.tools.settingsPanel.toggle(true, 'controls')],
    ['reset', 'Reset the hotbar', () => { hotbar.reset(); toast('Hotbar back to the first ten parts'); }],
    ['broom', 'Clear world…', () => void clearWorld()],
  ];
  for (const [icon, label, fn] of MENU) {
    const b = h<HTMLButtonElement>(`<button role="menuitem">${ICON[icon]}<span></span></button>`);
    (b.lastElementChild as HTMLElement).textContent = label;
    if (label.startsWith('Clear')) b.classList.add('danger');
    b.onclick = () => { toggleMenu(false); fn(); };
    menu.appendChild(b);
  }
  const toggleMenu = (show = menu.hidden): void => {
    menu.hidden = !show;
    menuBtn.setAttribute('aria-expanded', String(show));
    if (show) (menu.firstElementChild as HTMLElement | null)?.focus();
  };
  menuBtn.onclick = () => toggleMenu();
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { items[(i + 1) % items.length]!.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]!.focus(); e.preventDefault(); }
    if (e.key === 'Escape') { toggleMenu(false); menuBtn.focus(); }
    e.stopPropagation();
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !sessionbar.contains(e.target as Node)) toggleMenu(false); });
  (sessionbar.querySelector('[data-a=save]') as HTMLElement).onclick = () => {
    if (netStatus !== 'online') { toast('Offline: your changes are queued and save when the host is back', 'warn'); return; }
    net.send(['save', {}]);
    toast('Saved on the host');
  };
  // ---- share (S3 share links): the button makes a link, shows it with Copy, and opens pasted links ----------------
  bindShare(net);
  const sharePop = sessionbar.querySelector('.sb-share') as HTMLElement;
  const shareLink = sharePop.querySelector('.sh-link') as HTMLInputElement;
  const shareOpen = sharePop.querySelector('.sh-open') as HTMLInputElement;
  const toggleShare = (show = sharePop.hidden): void => {
    sharePop.hidden = !show;
    if (!show) return;
    toggleMenu(false);
    shareLink.value = 'Making a link…';
    (sharePop.querySelector('.sh-via') as HTMLElement).textContent = '';
    shareWorld().then((url) => {
      shareLink.value = url;
      (sharePop.querySelector('.sh-via') as HTMLElement).textContent = url.includes('#m=')
        ? 'The whole machine is in the link: nothing is stored, it opens on any KNOCK-ON host.'
        : 'Stored on this host: your partner opens it here, another host can import it by URL.';
      shareLink.select();
    }, (err: unknown) => { shareLink.value = ''; (sharePop.querySelector('.sh-via') as HTMLElement).textContent = (err as Error).message; });
  };
  (sessionbar.querySelector('[data-a=share]') as HTMLElement).onclick = () => toggleShare();
  (sharePop.querySelector('.sh-copy') as HTMLElement).onclick = () => {
    const url = shareLink.value;
    if (!url.startsWith('http')) return;
    void navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => { shareLink.select(); toast('Press Ctrl+C to copy the selected link'); });
  };
  const openLink = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text) return;
    try {
      const u = new URL(text, location.href);
      const ref = u.origin === location.origin ? currentShareLink(u.hash) : null;
      const res: OpenResult = ref ? await openShareLink(net, ref) : await importFromHost(net, u.href);
      if (res.kind === 'module') toast(`Module “${res.title}” is in the Library (Modules)`);
      else toast(net.me?.isHost ? `Opening “${res.title}”…` : `“${res.title}” is in the host's worlds: ask the host to open it`);
      toggleShare(false);
    } catch (err) {
      toast((err as Error).message || 'That isn’t a KNOCK-ON link', 'warn');
    }
  };
  (sharePop.querySelector('.sh-go') as HTMLElement).onclick = () => void openLink(shareOpen.value);
  shareOpen.onkeydown = (e) => { if (e.key === 'Enter') void openLink(shareOpen.value); if (e.key === 'Escape') toggleShare(false); e.stopPropagation(); };
  shareLink.onkeydown = (e) => { if (e.key === 'Escape') toggleShare(false); e.stopPropagation(); };
  document.addEventListener('pointerdown', (e) => { if (!sharePop.hidden && !sessionbar.contains(e.target as Node)) toggleShare(false); });
  // a share link in the URL (boot or hashchange): offer to open it once the session is up
  let linkOffered = '';
  const offerLink = async (): Promise<void> => {
    let ref;
    try { ref = currentShareLink(); } catch { toast('That share link is damaged', 'warn'); history.replaceState(null, '', location.pathname + location.search); return; }
    if (!ref || !net.store || linkOffered === location.hash) return;
    linkOffered = location.hash;
    const yes = await ask(viewport, { title: 'Open the shared machine from this link?', confirm: 'Open it', text: false });
    const href = location.href;
    history.replaceState(null, '', location.pathname + location.search);
    if (yes !== null) await openLink(href);
  };
  window.addEventListener('hashchange', () => void offerLink());
  (sessionbar.querySelector('[data-a=palette]') as HTMLElement).onclick = () => links?.palette.toggle(true);
  for (const b of sessionbar.querySelectorAll<HTMLElement>('.sb-mode button')) {
    b.onclick = () => {
      const r = links?.run;
      if (!r) return;
      if (b.dataset.m === 'run' && r.phase === 'build') r.primary();
      if (b.dataset.m === 'build' && r.phase !== 'build') r.stop();
    };
  }

  // ---- view rail -----------------------------------------------------------------------------------------
  let nav: Nav = store.get<Nav>('kn.nav', 'orbit');
  viewrail.innerHTML = `
    <div class="vr-nav" role="radiogroup" aria-label="Left-drag does">
      <button class="tile" role="radio" data-nav="orbit" title="Left-drag orbits (right-drag always orbits)">${ICON.orbit}<span>Orbit</span></button>
      <button class="tile" role="radio" data-nav="pan" title="Left-drag pans (middle-drag always pans)">${ICON.pan}<span>Pan</span></button>
      <button class="tile" role="radio" data-nav="zoom" title="Left-drag zooms (the wheel always zooms)">${ICON.zoom}<span>Zoom</span></button>
    </div>
    <hr/>
    <div class="vr-modes" role="radiogroup" aria-label="View mode">
      <button class="tile" role="radio" data-view="normal" title="Normal view">${ICON.cube}<span>Normal</span></button>
      <button class="tile" role="radio" data-view="xray" title="X-ray: click again for everything; hold Tab to peek">${ICON.xray}<span>X-ray</span></button>
      <button class="tile" role="radio" data-view="section" title="Section box: drag one out, then drag its handles">${ICON.section}<span>Section</span></button>
    </div>
    <hr/>
    <button class="tile" data-a="cutaway" aria-pressed="false" title="Cut away shells and walls facing the camera">${ICON.cutaway}<span>Cutaway</span></button>
    <button class="tile" data-a="outliner" aria-pressed="false" title="Outliner (Ctrl+\\)">${ICON.outliner}<span>Outliner</span></button>`;
  const paintRail = (): void => {
    for (const b of viewrail.querySelectorAll<HTMLElement>('[data-nav]')) { const on = b.dataset.nav === nav; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const t = links?.tools;
    const mode = t?.viewMode() ?? 'normal';
    for (const b of viewrail.querySelectorAll<HTMLElement>('[data-view]')) { const on = b.dataset.view === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const xb = viewrail.querySelector('[data-view=xray] span') as HTMLElement;
    xb.textContent = t?.xrayShown === 'all' ? 'X-ray: all' : 'X-ray';
    const sec = viewrail.querySelector('[data-view=section]') as HTMLElement;
    sec.classList.toggle('has', !!t?.section.box && mode !== 'section');
    const cut = viewrail.querySelector('[data-a=cutaway]') as HTMLElement;
    cut.classList.toggle('on', !!t?.cutaway); cut.setAttribute('aria-pressed', String(!!t?.cutaway));
    const ol = viewrail.querySelector('[data-a=outliner]') as HTMLElement;
    const open = !!t?.outliner.open;
    ol.classList.toggle('on', open); ol.setAttribute('aria-pressed', String(open));
    root.toggleAttribute('data-outliner', open);
    const env = net.store?.doc.env;
    (worldcard.querySelector('.wc-env .nm') as HTMLElement).textContent = t?.envLabel() ?? '…';
    (worldcard.querySelector('.wc-env small') as HTMLElement).textContent = `g ${env?.gravity ?? 100}% · air ${env?.air ?? 100}%`;
  };
  for (const b of viewrail.querySelectorAll<HTMLElement>('[data-nav]')) b.onclick = () => { nav = b.dataset.nav as Nav; store.set('kn.nav', nav); paintRail(); };
  rovingFocus(viewrail.querySelector('.vr-nav') as HTMLElement, { orientation: 'vertical', activateOnMove: true });
  rovingFocus(viewrail.querySelector('.vr-modes') as HTMLElement, { orientation: 'vertical' });
  for (const b of viewrail.querySelectorAll<HTMLElement>('[data-view]')) {
    b.onclick = () => {
      const t = links?.tools;
      if (!t) return;
      // the view modes replace each other (Normal, X-ray, Section, Cutaway): choosing one ends the others
      const v = b.dataset.view;
      if (v === 'normal') { if (t.section.editing) t.toggleSection(); t.setXray('off'); t.setCutaway(false); }
      else if (v === 'xray') { if (t.section.editing) t.toggleSection(); t.setCutaway(false); t.setXray(t.xray === 'links' ? 'all' : t.xray === 'all' ? 'off' : 'links'); }
      else if (v === 'section') { t.setXray('off'); t.setCutaway(false); t.toggleSection(); }
      paintRail();
    };
  }
  (viewrail.querySelector('[data-a=cutaway]') as HTMLElement).onclick = () => {
    const t = links?.tools;
    if (!t) return;
    if (t.section.editing) t.toggleSection();
    t.setXray('off');
    t.setCutaway(!t.cutaway);
    paintRail();
  };
  (viewrail.querySelector('[data-a=outliner]') as HTMLElement).onclick = () => { links?.tools.outliner.toggle(); paintRail(); };

  // ---- transport -----------------------------------------------------------------------------------------
  let simSpeed = store.get<number>('kn.simspeed', 1);
  if (!SPEEDS.includes(simSpeed as (typeof SPEEDS)[number])) simSpeed = 1;
  transport.innerHTML = `
    <button class="tp-reset" data-a="reset" aria-label="Reset (stop the run)" title="Reset: stop and go back to building (Backspace)">${ICON.reset}<span>Reset</span></button>
    <button class="tp-b" data-a="back" aria-label="Step back" title="Step back (,)">${ICON.stepBack}</button>
    <button id="rip" class="rip" data-a="rip" aria-label="Let it rip (Space)"><span class="rip-g">${ICON.play}</span><span class="rip-l">LET IT RIP</span><span class="rip-k">Space</span></button>
    <button class="tp-b" data-a="fwd" aria-label="Step forward" title="Step forward (.)">${ICON.stepFwd}</button>
    <span class="tp-sep" aria-hidden="true"></span>
    <div class="tp-speed well"><span id="tp-speed-l">Sim speed</span><div class="seg" role="radiogroup" aria-labelledby="tp-speed-l"></div></div>`;
  const rip = transport.querySelector('#rip') as HTMLButtonElement;
  rip.onclick = () => listeners.rip.forEach((fn) => fn());
  (transport.querySelector('[data-a=reset]') as HTMLElement).onclick = () => links?.run.stop();
  (transport.querySelector('[data-a=back]') as HTMLElement).onclick = () => links?.run.step(-1);
  (transport.querySelector('[data-a=fwd]') as HTMLElement).onclick = () => links?.run.step(1);
  const speedSeg = transport.querySelector('.tp-speed .seg') as HTMLElement;
  for (const s of SPEEDS) {
    const b = h<HTMLButtonElement>(`<button role="radio">${s === 1 ? '1×' : s}</button>`);
    b.onclick = () => { simSpeed = s; store.set('kn.simspeed', s); paintSpeed(); if (links?.run.phase === 'running') links.run.setPlay({ speed: s }); };
    speedSeg.appendChild(b);
  }
  const paintSpeed = (): void => [...speedSeg.children].forEach((b, i) => { const on = SPEEDS[i] === simSpeed; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  paintSpeed();

  // ---- tray, part card, hotbar -------------------------------------------------------------------------------
  // default slots: the mockup's ten (a starter kit from every family), topped up from the palette
  const kit = ['thud', 'boing', 'helio', 'brik', 'plank', 'slope', 'fulcrum', 'motor', 'cog', 'bangstick'].filter((t) => partDef(t));
  for (const p of PALETTE) if (kit.length < 10 && p.family !== 'critters' && !kit.includes(p.type)) kit.push(p.type);
  const hotbar = new Hotbar(kit, (t) => !!partDef(t));
  const card = new PartCard(viewport);
  card.hotbar = hotbar;
  let dragGhost: HTMLElement | null = null;
  /** Drag a part from the tray or the Library: onto a hotbar tile assigns it, onto the viewport places it. */
  const startDrag = (type: string, e: PointerEvent): void => {
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        dragging = true;
        card.hide();
        links?.choosePart(type);
        root.classList.add('dragging-part');
        dragGhost = h(`<div class="drag-ghost"></div>`);
        dragGhost.textContent = partDef(type)?.name ?? type;
        viewport.appendChild(dragGhost);
      }
      if (!dragging || !dragGhost) return;
      const r = viewport.getBoundingClientRect();
      dragGhost.style.left = `${ev.clientX - r.left}px`;
      dragGhost.style.top = `${ev.clientY - r.top}px`;
      tray.markDrop(tray.dropTarget(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) return;
      root.classList.remove('dragging-part');
      dragGhost?.remove(); dragGhost = null;
      tray.markDrop(-1);
      const slot = tray.dropTarget(ev.clientX, ev.clientY);
      if (slot >= 0) { hotbar.assign(slot, type); toast(`${partDef(type)?.name ?? type} on key ${Hotbar.keyOf(slot)}`); return; }
      const canvas = links?.canvas;
      if (canvas && document.elementFromPoint(ev.clientX, ev.clientY) === canvas) {
        // drop = a click at the drop point with the part armed (main.ts places it through its usual path)
        const opts: PointerEventInit = { clientX: ev.clientX, clientY: ev.clientY, button: 0, buttons: 1, pointerId: ev.pointerId, pointerType: ev.pointerType, isPrimary: true, bubbles: true };
        try {
          canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, buttons: 0 }));
          canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
          canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        } catch { /* placement stays armed: click to place */ }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // ---- camera framing for the big presets and the Backlot (S3 presets): once per world / preset / environment ----------
  // Desk and Room keep the Studio framing main.ts starts with; Warehouse, Arena, Megastructure and any Backlot world
  // start from the preset's camera, lifted onto the terrain so the eye isn't under the lot.
  let framedFor = '';
  const framePreset = (): void => {
    const l = links, doc = net.store?.doc;
    if (!l || !doc) return;
    const key = `${net.worldId}:${doc.env.preset}:${doc.env.environment}`;
    if (key === framedFor) return;
    framedFor = key;
    const terr = doc.activeTerrain();
    if (!terr && (doc.env.preset === 'desk' || doc.env.preset === 'room')) {
      // the Studio framing main.ts starts with (environments brief §1.2), so a switch back from a big world resets it
      l.cam.target = [0, 0.2, 0]; l.cam.dist = 3.2; l.cam.pitch = 0.52; l.cam.yaw = 0;
      return;
    }
    const c = presetOf(doc.env.preset).camera;
    const ground = terr ? terrainHeightAt(terr, c.target[0], c.target[2]) : 0;
    l.cam.target = [c.target[0], c.target[1] + ground, c.target[2]];
    l.cam.dist = c.distance;
    l.cam.pitch = (c.elevation * Math.PI) / 180;
    l.cam.yaw = 0;
  };

  // ---- Backlot sculpting (S3 TerrainBrushTool): the tray's Terrain tab arms a brush; drag on the ground --------------
  const brush = new TerrainBrushTool();
  let sculptArmed = false;
  let sculpting = false;
  const backlot = (): boolean => !!net.store?.doc.activeTerrain();
  const disarmSculpt = (): void => {
    if (!sculptArmed) return;
    sculptArmed = false; sculpting = false;
    badge.dataset.tool = 'place';
    links?.setTool('place');
    tray.syncTerrain();
  };
  const terrainUi = {
    available: backlot,
    armed: () => sculptArmed,
    brush: () => brush.brush as number,
    radius: () => brush.radius,
    strength: () => brush.strength,
    arm: (b: number) => {
      if (links?.run.phase !== 'build') { toast('Stop the run to sculpt'); return; }
      brush.brush = b as typeof brush.brush;
      sculptArmed = true;
      links?.setTool('select'); // no part ghost while sculpting
      paintSculptBadge();
    },
    setRadius: (m: number) => { brush.radius = m; paintSculptBadge(); },
    setStrength: (v: number) => { brush.strength = v; paintSculptBadge(); },
  };
  const paintSculptBadge = (): void => {
    if (!sculptArmed) return;
    badge.textContent = `Sculpt · ${['Raise', 'Lower', 'Flatten', 'Smooth'][brush.brush]} · ${brush.radius} m`;
    badge.dataset.tool = 'sculpt';
  };
  /** The ground point under the cursor: ray vs the active terrain from the camera (ui/terrainpick.ts). */
  const groundAt = (cx: number, cy: number): [number, number, number] | null => {
    const l = links, t = net.store?.doc.activeTerrain();
    if (!l || !t) return null;
    const r = l.canvas.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1, ny = 1 - ((cy - r.top) / r.height) * 2;
    const inv = invert(l.renderer.viewProj);
    const a = transform(inv, [nx, ny, 0]), b = transform(inv, [nx, ny, 1]);
    const o: V3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], f: V3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    return terrainHit(t, o, [f[0] - o[0], f[1] - o[1], f[2] - o[2]]);
  };
  const sculptAt = (e: PointerEvent): void => {
    const pt = groundAt(e.clientX, e.clientY);
    if (!pt) return;
    const op = brush.stroke(pt);
    if (op) net.submit(op);
  };
  viewport.addEventListener('pointerdown', (e) => {
    const l = links;
    if (!sculptArmed || !l || e.target !== l.canvas || e.button !== 0 || l.run.phase !== 'build') return;
    e.stopPropagation(); // main.ts doesn't place or select
    l.canvas.setPointerCapture(e.pointerId);
    sculpting = true;
    brush.begin();
    sculptAt(e);
  }, true);
  viewport.addEventListener('pointermove', (e) => { if (sculpting) sculptAt(e); }, true);
  viewport.addEventListener('pointerup', (e) => { if (sculpting) { sculpting = false; e.stopPropagation(); } }, true);

  const tray = new PartsTray(trayEl, hotbar, card, {
    terrain: terrainUi,
    pick: (t) => listeners.pick.forEach((fn) => fn(t)),
    startDrag,
    openLibrary: () => links?.library.toggle(true),
    modules: () => links?.library.modules() ?? [],
    placeModule: (id) => links?.library.onModule(id, 'place'),
  });

  // ---- inspector ---------------------------------------------------------------------------------------------
  const inspector = new Inspector($('#inspector'), net, {
    prop: (id, k, v) => listeners.prop.forEach((fn) => fn(id, k, v)),
    unlink: (id) => listeners.unlink.forEach((fn) => fn(id)),
    del: (id) => listeners.del.forEach((fn) => fn(id)),
    // U5 (M5): arming a world tool from the Inspector hands the keys to the 3D view, so the keyboard cursor (arrows,
    // Enter) works at once; Esc in the view then cancels the tool instead of only leaving the button
    zone: (id) => { links?.tools.zoneTool.start(id); links?.canvas.focus(); }, // U4: DUSTY's patrol zone
    tag: (id, on) => links?.tools.setTagged([id], on), // U5 (M5, D105): BUZZ's tag
    grabZone: (id, z) => { links?.tools.grab.start(id, z); links?.canvas.focus(); }, // U5 (M5): GRABBER's zones
  });
  inspector.onVisible = () => glass.refresh(true);

  // ---- lobby ---------------------------------------------------------------------------------------------------
  const lobby = new Lobby(viewport, { net, tier: tierNow, toast: (t, l) => toast(t, l), onToggle: (open) => { root.toggleAttribute('data-lobby', open); glass.refresh(true); } });

  // ---- toasts (under the session bar in Build, in the event feed during a run) ------------------------------------
  function toast(text: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    announce(text, level === 'info' ? 'polite' : 'assertive'); // U4: one rate-limited live region for every toast
    if (links?.run.phase === 'running') { links.runBar.toast(text); return; }
    const t = h(`<div class="toast ${level === 'info' ? '' : level}"></div>`);
    t.textContent = text;
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 3500);
    while (toasts.children.length > 3) toasts.firstChild?.remove();
  }

  // ---- chat ------------------------------------------------------------------------------------------------------
  function addLine(name: string, text: string, slot: number): void {
    const d = h('<div class="line"><b></b> <span></span></div>');
    (d.firstElementChild as HTMLElement).textContent = `${name}:`;
    (d.firstElementChild as HTMLElement).dataset.slot = String(slot);
    (d.lastElementChild as HTMLElement).textContent = text;
    lines.appendChild(d);
    setTimeout(() => d.classList.add('old'), 8000);
    while (lines.children.length > 8) lines.firstChild?.remove();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) net.send(['chat', { text }]);
      input.value = '';
      chat.classList.remove('open');
      input.blur();
    } else if (e.key === 'Escape') {
      chat.classList.remove('open');
      input.blur();
    }
    e.stopPropagation();
  });

  // ---- net -------------------------------------------------------------------------------------------------------
  net.on((e) => {
    switch (e.type) {
      case 'status':
        netStatus = e.status;
        if (e.status === 'online') glass.apply();
        if (e.status === 'error') showBlocker('Can’t join this session', e.message ?? '');
        break;
      case 'world': wcTitle.textContent = e.title; wcTitle.title = e.title; paintRail(); setTimeout(() => void offerLink(), 300); tray.syncTerrain(); framePreset(); break;
      case 'peers': paintPartner(); break;
      case 'chat': addLine(e.from?.name ?? 'someone', e.msg.text, e.msg.by); break;
      case 'toast': toast(e.text, e.level); break;
      case 'run': if (e.msg[0] === 'run.countdown') starter = e.msg[1].by; break;
      case 'doc': paintRail(); if (sculptArmed && !backlot()) disarmSculpt(); tray.syncTerrain(); framePreset(); matterDirty = true; break;
      default: break;
    }
  });
  function paintPartner(): void {
    const p = net.partner();
    const chip = sessionbar.querySelector('.sb-partner') as HTMLElement;
    chip.hidden = !p;
    if (!p) return;
    const av = chip.querySelector('.av') as HTMLElement;
    av.textContent = p.name.slice(0, 1).toUpperCase();
    av.dataset.slot = String(p.slot);
    (chip.querySelector('b') as HTMLElement).textContent = p.name;
    chip.title = `${p.name} · tier ${tierLabel(p.tier)}`;
  }

  async function clearWorld(): Promise<void> {
    const doc = net.store?.doc;
    if (!doc || !doc.parts.size && !doc.links.size) { toast('The world is already empty'); return; }
    if (links?.run.phase !== 'build') { toast('Stop the run first'); return; }
    const yes = await ask(viewport, { title: `Clear all ${doc.parts.size} parts and ${doc.links.size} links? Ctrl+Z brings them back.`, confirm: 'Clear world', danger: true, text: false });
    if (yes === null || !net.store) return;
    const d = net.store.doc;
    const free = [...d.links.values()].filter((l) => !l.from && !l.to).map((l) => l.id);
    const ops = [...(free.length ? [{ k: 'LinkRemove' as const, ids: free }] : []), ...(d.parts.size ? [{ k: 'PartRemove' as const, ids: [...d.parts.keys()] }] : [])];
    if (ops.length) net.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
  }

  // ---- left-drag navigation (view rail: Orbit / Pan / Zoom) -----------------------------------------------------------
  function bindNav(l: HudLinks): void {
    let down: { x: number; y: number; moved: boolean } | null = null;
    l.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.isTrusted) down = { x: e.clientX, y: e.clientY, moved: false }; });
    l.canvas.addEventListener('pointermove', (e) => {
      if (!down || !(e.buttons & 1)) { down = null; return; }
      if (l.holdsPointer?.()) return; // DRAG (D117): pressed on a part (drag-to-move) or a gizmo handle
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      down.moved = true;
      const cam = l.cam, dx = e.movementX, dy = e.movementY;
      if (nav === 'orbit') { cam.yaw -= dx * 0.006; cam.pitch = Math.min(1.5, Math.max(0.05, cam.pitch + dy * 0.006)); }
      else if (nav === 'zoom') cam.dist = Math.min(80, Math.max(0.3, cam.dist * Math.exp(dy * 0.005)));
      else {
        const s = cam.dist * 0.0015;
        const right: V3 = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)], fwd: V3 = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];
        cam.target = [cam.target[0] - right[0] * dx * s + fwd[0] * dy * s, cam.target[1], cam.target[2] - right[2] * dx * s + fwd[2] * dy * s];
      }
    });
    l.canvas.addEventListener('pointerup', () => { down = null; });
    // tool badge at the cursor (UI_UX §4.3: the mockups draw no tool switch)
    l.canvas.addEventListener('pointermove', (e) => {
      const r = viewport.getBoundingClientRect();
      badge.style.transform = `translate(${e.clientX - r.left + 16}px, ${e.clientY - r.top + 18}px)`;
    });
    l.canvas.addEventListener('pointerenter', () => badge.classList.add('in'));
    l.canvas.addEventListener('pointerleave', () => badge.classList.remove('in'));
  }

  // ---- palette extras: parts with 3D icons, parts in the scene, help ----------------------------------------------------
  const HELP: readonly [string, string][] = [
    ['How channels connect parts', 'Each port has a channel (Impact, Signal, Spin, Tension, Power, Heat, Air). Wire (E) an output to an input of the same channel.'],
    ['How to place and rotate', 'Press 1–0 or click a tray tile, then click to place. R / T / Y rotate 15° (Shift reverses). Esc stops placing.'],
    ['How to run, pause and stop', 'Space lets it rip and pauses; Backspace stops and resets. During a run, click THE BUTTON or Ctrl+click to shove a part.'],
    ['How to organise a big machine', 'Ctrl+\\ opens the Outliner: layers, groups (Ctrl+G), hide (H), lock (Ctrl+L). Save a gadget as a module from the palette.'],
    ['Why are the panels solid?', 'Reduce transparency, the 4 GB tier, or a busy frame turns the glass panels solid. Settings › Accessibility.'],
  ];
  function paletteExtra(l: HudLinks): Command[] {
    const out: Command[] = UI_PARTS.map((p) => {
      const slot = hotbar.slotOf(p.type);
      return { label: p.name, detail: p.tag, part: p.type, group: 'Parts' as const, keywords: `${p.family} ${cards()[p.type]?.does ?? ''}`, run: () => l.choosePart(p.type), ...(slot >= 0 ? { hint: Hotbar.keyOf(slot) } : {}) };
    });
    const doc = net.store?.doc;
    if (doc) {
      let n = 0;
      for (const p of doc.parts.values()) {
        if (n++ > 400) break;
        const d = partDef(p.type);
        if (!d) continue;
        const peers = new Set<string>();
        for (const lk of doc.links.values()) {
          const other = lk.from?.part === p.id ? lk.to?.part : lk.to?.part === p.id ? lk.from?.part : undefined;
          if (other !== undefined) peers.add(partDef(doc.parts.get(other)?.type ?? '')?.name ?? '?');
        }
        out.push({
          label: `${d.name} #${p.id % 4294967296}`, part: p.type, group: 'Parts in scene', keywords: `${d.tag} ${peers.size ? `connected to ${[...peers].join(' ')}` : ''}`,
          detail: peers.size ? `connected to ${[...peers].slice(0, 3).join(', ')}` : d.tag,
          run: () => { if (l.run.phase === 'build') { l.tools.clickSelect(p.id, { shiftKey: false, ctrlKey: false, metaKey: false }); l.camRig.frame(); } },
        });
      }
    }
    for (const [label, text] of HELP) out.push({ label, group: 'Help', run: () => toast(text) });
    // the mockup's connection actions (palette board): wire tool, X-ray, unlink the selection
    out.push({ label: 'Connect ports (Wire tool)', hint: 'E', group: 'Actions', icon: 'connect', keywords: 'wire link cable', run: () => l.setTool('wire') });
    out.push({ label: 'Show all connections', detail: 'X-ray', hint: 'hold Tab', group: 'Actions', icon: 'eye', run: () => l.tools.setXray('links') });
    out.push({
      label: 'Unlink all connections on the selection', group: 'Actions', icon: 'connect',
      run: () => {
        const d = net.store?.doc;
        const sel = new Set(l.tools.selection.ids());
        const ids = d ? [...d.links.values()].filter((lk) => (lk.from && sel.has(lk.from.part)) || (lk.to && sel.has(lk.to.part))).map((lk) => lk.id) : [];
        if (!ids.length) { toast('Nothing selected is connected'); return; }
        if (l.run.phase === 'build') net.submit({ k: 'LinkRemove', ids });
      },
    });
    out.push({ label: 'Worlds & lobby', group: 'Actions', icon: 'worlds', run: () => lobby.toggle(true) });
    out.push({ label: 'Reset the hotbar', group: 'Actions', icon: 'reset', run: () => hotbar.reset() });
    return out;
  }

  // ---- escape (D84): the topmost panel or menu first; main.ts then cancels the tool, then stops the run ---------------------
  function escape(): boolean {
    if (!menu.hidden) { toggleMenu(false); return true; }
    if (!sharePop.hidden) { toggleShare(false); return true; }
    if (sculptArmed) { disarmSculpt(); toast('Sculpting off'); return true; }
    if (lobby.open) { lobby.toggle(false); return true; }
    if (card.shownType) { card.hide(); return true; }
    if (links?.library.open) { links.library.toggle(false); return true; }
    // U4: Esc on a HUD control hands focus back to the 3D view (so build keys work again without a mouse)
    const a = document.activeElement as HTMLElement | null;
    if (a && links && a !== links.canvas && a !== document.body && viewport.contains(a) && !a.closest('[aria-modal="true"]')) { links.canvas.focus(); announce('Back to the 3D view'); return true; }
    return false;
  }

  let hudAt = 0, perfAt = 0, perfLine = '';
  // U4: the world card's Matter readout (grains at the start vs the session tier's budget; live during a run when available)
  let matterDirty = true, matterLine = '';
  const sessionTier = (): number => { const p = net.partner(); return p?.tier ? Math.min(tierNow(), p.tier) : tierNow(); };
  const paintMatter = (): void => {
    const doc = net.store?.doc;
    const live = (links?.run as unknown as { matterCounts?: ArrayLike<number> } | undefined)?.matterCounts;
    const running = links?.run.phase === 'running' && live && live.length;
    if (!running && !matterDirty) return;
    matterDirty = false;
    // U5 (M5): plus the Kitchen sink's water (D98), and "Matter off" when the world's switch is off
    const grains = running ? Array.from(live).reduce((a, b) => a + b, 0) : doc ? worldGrains(doc.parts.values()).total + (sinkFilled(doc.env) ? SINK_FILL_PARTICLES : 0) : 0;
    const st = grainStatus(grains, sessionTier(), doc?.parts.size ?? 0, !!doc && !doc.simFlags.matterGameplay);
    const el = worldcard.querySelector('.wc-matter') as HTMLElement;
    el.hidden = !st;
    if (!st) { matterLine = ''; return; }
    matterLine = st.text;
    el.dataset.level = st.level;
    el.title = st.title;
    el.setAttribute('aria-label', st.title);
    (el.querySelector('.wc-m-t') as HTMLElement).textContent = st.text;
    (el.querySelector('.wc-m-bar i') as HTMLElement).style.width = `${Math.min(100, st.fraction * 100).toFixed(1)}%`;
  };
  let badgeText = '';
  let lastPhase = '';
  let lastSide = '';

  return {
    toast,
    inspect: (p: PartRecord | null): void => { glass.measure(() => inspector.show(p)); },
    onRip: (fn: () => void) => { listeners.rip.push(fn); },
    onPick: (fn: (type: string) => void) => listeners.pick.push(fn),
    onTool: (fn: (t: Tool) => void) => listeners.tool.push(fn),
    onProp: (fn: (id: number, key: string, v: number) => void) => listeners.prop.push(fn),
    onUnlink: (fn: (id: number) => void) => listeners.unlink.push(fn),
    onDelete: (fn: (id: number) => void) => listeners.del.push(fn),
    /** Hotbar key index (0 = key 1 … 9 = key 0) → part type. */
    hotbar: (i: number): string | null => hotbar.typeAt(i),
    escape,
    glass,
    /** U4: main.ts hands over the keyboard-building controller (ui/keyboard.ts). */
    keyboard(k: KeyboardBuild): void { kb = k; },
    overlays,

    /** Wire main.ts's controllers in (called once, right after BuildTools is created). */
    attach(l: HudLinks): void {
      links = l;
      const lib = l.library;
      lib.hotbar = hotbar;
      lib.card = card;
      lib.startDrag = startDrag;
      // U5 (M5): the Library and the Cascade Report share the Inspector's place (UI_UX §3): opening one closes the other
      lib.onToggle = (open) => { card.hide(); if (open && l.tools.cascade.open) l.tools.cascade.hide(); glass.refresh(true); };
      hotbar.on(() => lib.refresh());
      l.palette.extra = () => paletteExtra(l);
      l.palette.onToggle = () => glass.refresh(true);
      l.radial.subject = () => { const p = l.hoverPart(); const d = p ? partDef(p.type) : undefined; return p && d ? { type: p.type, name: d.name } : null; };
      l.radial.onToggle = () => glass.refresh(true);
      l.runBar.bind({ net, partType: (id) => net.store?.doc.parts.get(id)?.type ?? '', camMode: () => l.camRig.mode, setCamMode: (m) => l.camRig.setMode(m) });
      const rbUpdate = l.runBar.update.bind(l.runBar);
      l.runBar.update = () => glass.measure(rbUpdate); // the run HUD counts toward the UI frame budget
      l.tools.solidReason = () => glass.reason;
      overlays.bind({
        renderer: l.renderer, run: l.run, tool: () => l.tool(), hoverPart: () => l.hoverPart(),
        selected: () => l.tools.selection.ids(), xray: () => l.tools.xrayShown, pickable: (p) => l.tools.pickable(p),
        zoneLabels: () => (l.run.phase === 'build' ? [...l.tools.grab.labels, ...(l.gizmoLabels?.() ?? [])] : []), // U5 (M5): GRABBER's A / B chips; DRAG (D117): gizmo X / Y / Z
      });
      l.tools.onView(paintRail);
      l.tools.cascade.onToggle = (open) => { if (open && lib.open) lib.toggle(false); glass.refresh(true); };
      inspector.selectionSize = () => Math.max(1, l.tools.selection.size);
      // arm hotbar slot 1 rather than the catalogue's first entry
      const first = hotbar.typeAt(0);
      if (first && hotbar.slotOf(l.selectedType()) < 0 && l.tool() === 'place') l.choosePart(first);
      bindNav(l);
      // modal and panel changes re-plan the glass at once (otherwise every 500 ms)
      const mo = new MutationObserver(() => glass.refresh(true));
      mo.observe(l.tools.settingsPanel.el, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
      mo.observe(viewport, { childList: true });
      paintRail();
      framePreset();
      if (new URLSearchParams(location.search).has('lobby')) lobby.toggle(true);
      if (new URLSearchParams(location.search).has('debug')) {
        (window as unknown as { __knHud: unknown }).__knHud = { glass, hotbar, inspector, lobby, tray, card, overlays, kb: () => kb };
        void import('./audit.ts').then((a) => { (window as unknown as { __knAudit: unknown }).__knAudit = a; }); // U4: WCAG audit helpers
      }
      // boot probe of the glass compositor cost (UI_UX §8), once the first frames are out
      setTimeout(() => void glass.probe(), 2500);
    },

    setTool(t: Tool, type: string): void {
      if (sculptArmed && t !== 'select') { sculptArmed = false; sculpting = false; tray.syncTerrain(); }
      tray.setActive(t === 'place' ? type : null);
      badgeText = t === 'place' ? `Place · ${partDef(type)?.name ?? type}` : t === 'select' ? 'Select' : t === 'wire' ? 'Wire · click a port' : 'Path · click points';
      badge.textContent = badgeText;
      delete badge.dataset.hint;
      // U4: tool changes are announced (the badge is decorative)
      announce(t === 'place' ? `Place tool, ${partDef(type)?.name ?? type}` : t === 'select' ? 'Select tool' : t === 'wire' ? 'Wire tool' : 'Path tool');
      badge.dataset.tool = t;
      paintSculptBadge();
    },

    setRunState(r: RunController, now: number): void {
      glass.measure(() => {
        if (r.phase !== lastPhase) {
          lastPhase = r.phase;
          root.dataset.phase = r.phase;
          const building = r.phase === 'build';
          for (const b of sessionbar.querySelectorAll<HTMLElement>('.sb-mode button')) {
            const on = (b.dataset.m === 'build') === building;
            b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
          }
          (transport.querySelector('[data-a=reset]') as HTMLButtonElement).disabled = building;
          for (const s of ['back', 'fwd']) (transport.querySelector(`[data-a=${s}]`) as HTMLButtonElement).disabled = r.phase !== 'running';
          rip.classList.toggle('cancel', r.phase === 'countdown');
          (rip.querySelector('.rip-l') as HTMLElement).textContent = r.phase === 'countdown' ? 'CANCEL' : 'LET IT RIP';
          (rip.querySelector('.rip-g') as HTMLElement).innerHTML = r.phase === 'countdown' ? ICON.close : ICON.play;
          rip.setAttribute('aria-label', r.phase === 'countdown' ? 'Cancel the countdown (Esc)' : 'Let it rip (Space)');
          if (r.phase === 'build') { card.hide(); countdown.hidden = true; }
          else disarmSculpt();
          // U4: screen readers hear the run start and stop
          announce(r.phase === 'countdown' ? 'Countdown. Escape cancels.' : r.phase === 'running' ? 'Running. Space pauses, Backspace stops.' : 'Stopped. Back to building.', 'assertive');
          if (r.phase !== 'running') overlays.clear();
          glass.refresh(true);
        }
        // the transport's sim speed applies to runs this player starts
        if (r.phase === 'running' && r.runId !== lastRunId) {
          lastRunId = r.runId;
          if (simSpeed !== 1 && (r.solo || starter === net.me?.slot)) r.setPlay({ speed: simSpeed });
        }
        const side = links?.tools.cascade.open ? 'cascade' : links?.library.open ? 'library' : '';
        if (side !== lastSide) { lastSide = side; if (side) root.dataset.side = side; else delete root.dataset.side; }
        if (r.phase === 'countdown') {
          const left = r.countdownLeft(now);
          countdown.hidden = false;
          const by = starter && starter !== net.me?.slot ? net.players.find((p) => p.slot === starter)?.name : '';
          const n = String(left || '');
          if (countdown.dataset.n !== n) {
            countdown.dataset.n = n;
            countdown.innerHTML = `<div class="cd-ring" aria-hidden="true"><span class="cd-n"></span></div><button class="cd-cancel">Cancel <kbd>Esc</kbd></button>${by ? '<small class="cd-by"></small>' : ''}`;
            if (n) announce(n, 'assertive');
            (countdown.querySelector('.cd-n') as HTMLElement).textContent = n;
            (countdown.querySelector('.cd-cancel') as HTMLElement).onclick = () => r.primary();
            const byEl = countdown.querySelector('.cd-by');
            if (byEl) byEl.textContent = `started by ${by}`;
          }
        } else countdown.hidden = true;
      });
    },

    chatOpen: () => document.activeElement === input,
    typing: () => document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox'
      || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement,
    openChat: () => { chat.classList.add('open'); input.focus(); },

    updateOverlay(rdr: Renderer, partner: ServerMsgs['presence'] | null, n: NetClient): void {
      glass.measure(() => {
        overlays.frame(performance.now()); // U4: captions, emote text, port glyphs
        if (kb?.active && links) {
          // U4: the tool badge follows the keyboard cursor and shows its keys
          badge.style.transform = `translate(${(kb.screen.x + 16).toFixed(0)}px, ${(kb.screen.y + 18).toFixed(0)}px)`;
          badge.classList.add('in');
          const hint = kb.hint();
          if (badge.dataset.hint !== hint) { badge.dataset.hint = hint; badge.dataset.kb = '1'; badge.textContent = `${badgeText} · ${hint}`; }
        } else if (badge.dataset.kb) { delete badge.dataset.kb; delete badge.dataset.hint; badge.textContent = badgeText; }
        const who = n.partner();
        if (!partner?.cursor || !who) { if (marker.style.display !== 'none') marker.style.display = 'none'; return; }
        const c = transform(rdr.viewProj, partner.cursor as V3);
        if (c[3] <= 0) { marker.style.display = 'none'; return; }
        const x = ((c[0] / c[3]) * 0.5 + 0.5) * rdr.canvas.clientWidth;
        const y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * rdr.canvas.clientHeight;
        marker.style.display = '';
        marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        marker.dataset.slot = String(who.slot);
        const label = marker.lastElementChild as HTMLElement;
        // DRAG (D117): while the partner drags a part, their tag says what they hold ("Sam · holding PLANK")
        // BUILDUX (D124): a held set (a selection or a paste) reads "holding 5 parts"
        const ghostCount = partner.ghost?.parts?.length ?? 0;
        const text = partner.ghost ? `${who.name} · holding ${ghostCount > 1 ? `${ghostCount} parts` : partDef(partner.ghost.type)?.name ?? partner.ghost.type.toUpperCase()}` : who.name;
        if (label.textContent !== text) label.textContent = text;
      });
    },

    setPerf(rdr: Renderer, rc: RunController): void {
      perfAt = performance.now();
      const passes = [...rdr.timer.ms].map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
      const threads = rc.joltThreadsLive === null ? '' : ` · jolt ${rc.joltThreadsLive > 0 ? `${rc.joltThreadsLive} threads` : 'single-threaded'}`; // U5 (M5, D99)
      const sim = rc.phase === 'running' ? ` · sim ${rc.baked} baked, ${Math.round(rc.baked - rc.tick)} ahead${rc.waiting ? ' (waiting)' : ''} · ${rc.bodies.length} bodies${threads}` : threads;
      perfLine = `GPU ${rdr.timer.total().toFixed(2)} ms (${passes}) · frame ${rdr.stats.frameMs.toFixed(1)} ms · instances ${rdr.stats.instances} + ${rdr.stats.overlay}${sim}` +
        `\n${rdr.vramLine()}`; // M4 (V4): VRAM ledger, governor, probe
    },

    setHud(hv: { point: V3 } | null, n: NetClient, rdr: Renderer): void {
      const now = performance.now();
      glass.measure(() => {
        if (now - hudAt < 250) return; // 4 Hz is plenty for the save state and the readout
        hudAt = now;
        const doc = n.store?.doc;
        const pending = n.store?.pendingCount ?? 0;
        const save = worldcard.querySelector('.wc-save') as HTMLElement;
        const state = netStatus === 'online' ? (pending ? 'saving' : 'saved') : netStatus === 'connecting' ? 'connecting' : 'offline';
        save.dataset.state = state;
        (save.lastElementChild as HTMLElement).textContent = state === 'saved' ? 'saved' : state === 'saving' ? 'saving…' : state === 'connecting' ? 'connecting…' : `offline · ${pending} change${pending === 1 ? '' : 's'} queued`;
        (worldcard.querySelector('.wc-blurb') as HTMLElement).textContent = `${cap(doc?.env.preset ?? 'room')} · ${doc?.parts.size ?? 0} parts`;
        paintMatter();
        const p = n.partner();
        if (p) (sessionbar.querySelector('.sb-partner small') as HTMLElement).textContent = n.clock.ready ? `${Math.round(n.clock.rtt)} ms` : '…';
        const showPerf = now - perfAt < 500 || new URLSearchParams(location.search).has('debug');
        perf.hidden = !showPerf;
        if (showPerf) {
          const rtt = n.clock.ready ? `${Math.round(n.clock.rtt)} ms` : '…';
          const gpu = rdr.timer.enabled ? ` · gpu ${rdr.timer.total().toFixed(1)} ms` : '';
          perf.textContent = `parts ${doc?.parts.size ?? 0} · links ${doc?.links.size ?? 0}${matterLine ? ` · ${matterLine}` : ''} · seq ${n.store?.confirmedSeq ?? 0} · rtt ${rtt}${gpu}` +
            (hv ? ` · ${hv.point.map((v) => v.toFixed(2)).join(', ')} m` : '') +
            `\nUI ${glass.uiEma.toFixed(2)} ms avg · ${glass.uiPeak1s.toFixed(2)} peak · glass ${root.dataset.glass ?? '?'} blurred, ${glass.glassCostMs.toFixed(2)} ms${glass.reason ? ` · solid (${glass.reason})` : ''}` +
            (now - perfAt < 500 ? `\n${perfLine}` : '');
        }
      });
      glass.frame(now);
    },
  };
}

const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);

function showBlocker(title: string, body: string): void {
  const d = h('<div class="fullscreen-msg"><div class="card glass"><h1></h1><p></p><p><a href="/check">Open /check</a></p></div></div>');
  d.querySelector('h1')!.textContent = title;
  d.querySelector('p')!.textContent = body;
  document.body.appendChild(d);
}

export type Hud = ReturnType<typeof buildHud>;
