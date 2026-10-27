// M2 Tools/UI (stream D): Outliner, layers, groups, modules, section box, X-ray / cutaway toggles,
// tabbed Settings with the environment picker, and the Cascade Report, behind one object that main.ts
// creates and calls from a handful of hooks (pick filter, scene filter, select click, delete, keys,
// palette commands, the per-frame overlay).

import type { WorldDoc } from '@knockon/docstore';
import { envSwitchPatch, PartFlag, posToMetres, type PropList, type LinkRecord, type Op, type PartId, type PartRecord } from '@knockon/format';
import { PROTO } from '@knockon/net';
import type { ModuleDef } from '@knockon/format';
import { buildReport, type CascadeEvent } from '../cascade.ts';
import { FAMILY_HEX, PLAYER_RGB, partDef } from '../catalog.ts';
import { STUDIO_DARK, STUDIO_LIGHT, type Renderer, type Rgb, type SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import type { NetClient } from '../net.ts';
import type { RunController } from '../run.ts';
import { partPose } from '../scene.ts';
import { ask } from './ask.ts';
import { CascadePanel } from './cascadepanel.ts';
import { exportFile, ghostItems, importFiles, moduleForSelection, placeOp, placementAt, saveOp, summarise } from './modules.ts';
import { flagOp, groupMembers, layerOp, lockedReason, partEditable, partVisible, rayAt, SmallIds } from './organise.ts';
import { Outliner } from './outliner.ts';
import type { Command, Library } from './panels.ts';
import { SectionBox, type Box } from './sectionbox.ts';
import { Selection } from './selection.ts';
import { applyDocumentSettings, bindingOf, keyName, onSettingsChange, setSetting, settings } from './settings.ts';
import { ENVIRONMENTS, SettingsPanel } from './settingspanel.ts';
import { inspectorHooks, taggable } from './inspector.ts';
import { focusables, focusIsWorld } from './a11y.ts';
import { ZoneTool } from './zonetool.ts';
import { VolumeTool } from './volumetool.ts';
import { autoPair, GrabZoneTool, pairKind, pairOverlay, pairProps } from './m5tools.ts';
import { gizmoOn } from './gizmo.ts'; // DRAG (D117)

/** U5 (M5): per-world part caps (PART_SYSTEM §1 `caps.maxPerWorld`; A5: "SINGULARITY: up to 4 per world"). */
export const MAX_PER_WORLD: Readonly<Record<string, number>> = { singularity: 4 };

/** A Tab press shorter than this from the 3D view is a tap (focus the HUD); longer is an X-ray hold. */
const TAB_TAP_MS = 250;

/** Renderer calls from M2_PLAN contract 4 (stream C implements them; guarded until they exist). */
interface RendererM2 {
  setSectionBox?(box: { min: V3; max: V3 } | null): void;
  setCutaway?(on: boolean): void;
  setXray?(mode: XrayMode): void;
  setSelection?(instances: readonly number[], rgb: Rgb | null): void;
}
export type XrayMode = 'off' | 'links' | 'all';

/** Extra Inspector sections (ui/inspector.ts calls these for the part it shows). */
export { inspectorHooks };

export interface ToolsHost {
  readonly net: NetClient;
  readonly renderer: Renderer;
  readonly run: RunController;
  readonly viewport: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly library: Library;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
  /** main.ts's single selected part (the Inspector target). */
  selected(): number | null;
  /** Set main.ts's selected part (switches to the select tool and refreshes the Inspector). */
  setSelected(id: number | null): void;
  /** Switch main.ts to the Select tool (no part ghost while a module is being placed). */
  useSelectTool(): void;
  hover(): { point: V3; part: PartRecord | null } | null;
  instancesOf(): ReadonlyMap<number, readonly number[]>;
  /** Rebuild the build scene next frame. */
  markDirty(): void;
  workY(): number;
  camDist(): number;
  /** Point the camera at a world position. */
  lookAt(p: V3): void;
  artMesh(type: string): number | null;
}

export class BuildTools {
  readonly selection = new Selection();
  readonly outliner: Outliner;
  readonly section = new SectionBox();
  readonly settingsPanel: SettingsPanel;
  readonly cascade: CascadePanel;
  /** U4 (M4): DUSTY's patrol-zone tool (ui/zonetool.ts). */
  readonly zoneTool: ZoneTool;
  /** U5 (M5): sizing handles for FORCE WALL, STASIS FIELD and ZONE (ui/volumetool.ts). */
  readonly volume: VolumeTool;
  /** U5 (M5): GRABBER's zone A / B pointer (ui/m5tools.ts). */
  readonly grab: GrabZoneTool;
  private readonly host: ToolsHost;
  private readonly r2: RendererM2;
  private readonly ids = new SmallIds();
  activeLayer = 0;
  xray: XrayMode = 'off';
  private xrayHeld = false;
  /** U4: when Tab went down on the 3D view (tap = focus the HUD, hold = X-ray peek). */
  private tabDownAt: number | null = null;
  private tabTimer = 0;
  cutaway = false;
  private placing: { id: number; def: ModuleDef; quarter: 0 | 1 | 2 | 3 } | null = null;
  private down: { x: number; y: number; consumed: boolean } | null = null;
  /** View state listeners (the view rail and the world card's environment chip, ui/hud.ts). */
  private readonly viewListeners = new Set<() => void>();
  private lastOutlinerOpen: boolean | null = null;
  /** Why glass is forced solid, for Settings › Accessibility (set by the HUD). */
  solidReason: () => string | null = () => null;
  /** Runs this session, for the Cascade Report header. */
  private runCount = 0;
  private lastSelKey = '';
  private lastPhase: string;
  private reportShownFor: string | null = null;
  private lastRunId: string | null = null;

  constructor(host: ToolsHost) {
    this.host = host;
    this.r2 = host.renderer as unknown as RendererM2;
    const doc = (): WorldDoc | null => host.net.store?.doc ?? null;
    this.lastPhase = host.run.phase;

    // ---- outliner ----------------------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tools = this;
    // the Outliner opens below the world card, as part of the same glass surface (UI_UX §3)
    const outlinerParent = document.querySelector<HTMLElement>('#worldcard .wc-outliner') ?? host.viewport;
    this.outliner = new Outliner(outlinerParent, {
      doc, slot: () => host.net.me?.slot ?? 1, selection: this.selection, ids: this.ids,
      submit: (op) => this.submit(op), toast: (t, l) => host.toast(t, l),
      partLabel: (p) => ({ name: partDef(p.type)?.name ?? p.type.toUpperCase(), color: FAMILY_HEX[partDef(p.type)?.family ?? ''] ?? '#8A93A6' }),
      linkLabel: (l) => this.linkLabel(l),
      select: (ids, mode) => this.selectIds(ids, mode),
      focus: (id) => { const p = doc()?.parts.get(id); if (p) host.lookAt(partPose(p).pos); },
      get activeLayer() { return tools.activeLayer; },
      set activeLayer(v: number) { tools.activeLayer = v; },
      groupSelection: () => this.groupSelection(),
    });
    // compact mode (UI_UX §3): below 1280 px the outliner starts folded; otherwise as the viewer left it
    // (folded the first time, as on the Build HUD mockup)
    let wasOpen = false;
    try { wasOpen = localStorage.getItem('kn.outliner') === '1'; } catch { /* private mode */ }
    this.outliner.toggle(window.innerWidth >= 1280 && wasOpen, false);

    // ---- settings ----------------------------------------------------------------------------------
    this.settingsPanel = new SettingsPanel(host.viewport, {
      environment: () => doc()?.env.environment ?? 'studio',
      setEnvironment: (id) => this.setEnvironment(id),
      about: () => this.about(),
      diagnostics: () => this.diagnostics(),
      solidReason: () => this.solidReason(),
      // MI (M4, D98): Settings › World › Fill the sink (Mega Kitchen)
      sinkFill: () => doc()?.env.sinkFill === true,
      setSinkFill: (on) => { if (this.submit({ k: 'EnvUpdate', patch: { sinkFill: on } })) host.toast(on ? 'The sink fills with water when the machine runs' : 'The sink stays dry'); },
      // U5 (M5): Settings › World: size (for environments only some sizes host), the Hangar's zero-g zones, Matter
      preset: () => doc()?.env.preset ?? 'room',
      zones: () => doc()?.env.zones !== false,
      setZones: (on) => { if (this.submit({ k: 'EnvUpdate', patch: { zones: on } })) host.toast(on ? 'Zero-g zones on: things float inside the rings' : 'Zero-g zones off'); },
      // W5 (M5, D26): Settings › World › Weather (env.wind); no air (the Moon) means no wind
      wind: () => doc()?.env.wind ?? null,
      // W5 (M5): Settings › World › Base lights (MOON BASE, env.baseLights; cosmetic)
      baseLights: () => doc()?.env.baseLights === true,
      setBaseLights: (on) => { if (this.submit({ k: 'EnvUpdate', patch: { baseLights: on } })) host.toast(on ? 'Base lights on' : 'Base lights off'); },
      setWind: (w) => { if (this.submit({ k: 'EnvUpdate', patch: { wind: w } })) host.toast(w.speed > 0 || (w.gusts ?? 'none') !== 'none' ? `Wind ${w.speed} m/s${(doc()?.env.air ?? 100) === 0 ? ' (no air here: nothing moves)' : ''}` : 'Wind off'); },
      matter: () => doc()?.simFlags.matterGameplay ?? true,
      setMatter: (on) => { if (this.submit({ k: 'EnvUpdate', patch: { matter: on } })) { host.toast(on ? 'Sand, water and marbles on: containers pour real grains' : 'Sand, water and marbles off: containers empty without pouring'); this.paintBar(); } },
      // U5 (M5): Settings › Performance (physics threads)
      joltThreadsLive: () => host.run.joltThreadsLive,
      joltThreadsBoot: () => host.run.joltThreads,
    });
    applyDocumentSettings();
    if (settings.graphics.darkCyc) host.renderer.look = STUDIO_DARK;
    onSettingsChange((s, path) => {
      applyDocumentSettings(s);
      if (path === 'graphics.darkCyc' || path === '*' || path === 'graphics.*') host.renderer.look = s.graphics.darkCyc ? STUDIO_DARK : STUDIO_LIGHT;
    });

    // ---- cascade report ----------------------------------------------------------------------------
    this.cascade = new CascadePanel(host.viewport, {
      tickRate: host.run.tickRate,
      // the part number tells two BANGSTICKs apart (matches the Outliner's #n)
      partName: (id) => { const p = doc()?.parts.get(id); return `${p ? partDef(p.type)?.name ?? p.type : doc()?.links.has(id) ? 'LINK' : 'PART'} #${id % 4294967296}`; },
      partColor: (id) => FAMILY_HEX[partDef(doc()?.parts.get(id)?.type ?? '')?.family ?? ''] ?? '#8A93A6',
      partType: (id) => doc()?.parts.get(id)?.type ?? '',
      runLabel: () => { const p = host.net.partner(); return `run ${this.runCount}${p ? ` · with ${p.name}` : ''}`; },
      canScrub: () => host.run.phase === 'running',
      scrub: (tick) => this.scrubTo(tick), // UIFIX (D122): past the bake head, and after the run (replays to it)
      replay: () => { if (host.run.phase === 'running') host.run.setPlay({ tick: 0, paused: false }); else host.run.primary(); },
    });

    // ---- library: modules tab ------------------------------------------------------------------------
    host.library.modules = () => { const d = doc(); return d ? summarise(d) : []; };
    host.library.onSaveSelection = () => void this.saveModule();
    host.library.onImport = () => this.importModules();
    host.library.onModule = (id, action) => void this.moduleAction(id, action);

    // ---- inspector: layer / group / visibility section --------------------------------------------
    inspectorHooks.push((p, el) => this.inspectorSection(p, el));

    // ---- doc changes ---------------------------------------------------------------------------------
    host.net.on((e) => {
      if (e.type !== 'doc') return;
      const d = doc();
      // hidden or locked parts drop out of the selection too (a partner may have hidden their layer)
      if (d) this.selection.prune((id) => { const p = d.parts.get(id); return p ? partVisible(d, p) && partEditable(d, p) : d.links.has(id); }, (id) => d.parts.has(id));
      if (d && this.activeLayer && !d.layers.has(this.activeLayer)) this.activeLayer = 0;
      if (this.placing && d && !d.modules.has(this.placing.id)) this.placing = null;
      this.outliner.invalidate();
      host.library.refreshModules();
      this.paintBar();
    });
    this.selection.on(() => {
      if (host.selected() !== this.selection.primary) host.setSelected(this.selection.primary);
      host.markDirty();
      this.outliner.invalidate();
    });
    this.section.onChange = (box) => {
      this.r2.setSectionBox?.(box ? { min: [...box.min] as V3, max: [...box.max] as V3 } : null);
      host.markDirty();
      this.paintBar();
    };

    // ---- U4: DUSTY's patrol zone ----------------------------------------------------------------------
    this.zoneTool = new ZoneTool({
      doc: () => doc(), submit: (op) => this.submit(op), toast: (t, l) => host.toast(t, l),
      selected: () => this.selection.ids(), workY: () => host.workY(),
    });

    // ---- U5 (M5): volume sizing handles ------------------------------------------------------------------
    this.volume = new VolumeTool({
      doc: () => doc(), selected: () => (this.selection.size === 1 ? this.selection.primary : null),
      submit: (op) => this.submit(op), phase: () => host.run.phase,
      canEdit: (p) => { const d = doc(); return !!d && partEditable(d, p); },
      handles: () => !gizmoOn(), // DRAG (D117): the gizmo's corner cubes take over from the face handles while it's on
    });

    this.grab = new GrabZoneTool({
      doc: () => doc(), submit: (op) => this.submit(op), toast: (t) => host.toast(t), selected: () => this.selection.ids(),
    });

    // ---- pointer capture for the section box and module placement -------------------------------------
    const v = host.viewport, canvas = host.canvas;
    const local = (e: PointerEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const ground = (e: PointerEvent): V3 | null => {
      const [x, y] = local(e);
      const r = rayAt(host.renderer.viewProj, canvas, x, y), py = host.workY();
      if (r.d[1] >= 0 || r.o[1] <= py) return null;
      const t = (py - r.o[1]) / r.d[1];
      return [r.o[0] + r.d[0] * t, py, r.o[2] + r.d[2] * t];
    };
    v.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas || e.button !== 0 || host.run.phase !== 'build') return;
      if (this.zoneTool.editing !== null && this.zoneTool.down(ground(e))) { e.stopPropagation(); canvas.setPointerCapture(e.pointerId); this.down = { x: e.clientX, y: e.clientY, consumed: true }; return; }
      // U5: GRABBER zone pointer: the point under the cursor (a part's top, or the floor / work plane)
      if (this.grab.editing && this.grab.point(host.hover()?.point ?? ground(e), host.hover()?.part ?? null)) { // UIFIX (D122): the part too
        e.stopPropagation(); this.down = { x: e.clientX, y: e.clientY, consumed: true }; return; }
      const [x, y] = local(e);
      let consumed = false;
      // U5: a sizing handle of the selected volume part
      if (!this.section.editing && !this.placing && this.volume.down(rayAt(host.renderer.viewProj, canvas, x, y), x, y, host.renderer.viewProj, canvas)) consumed = true;
      else if (this.section.editing) consumed = this.section.down(rayAt(host.renderer.viewProj, canvas, x, y), x, y, host.renderer.viewProj, canvas, host.workY());
      else if (this.placing) consumed = true;
      this.down = { x: e.clientX, y: e.clientY, consumed };
      if (consumed) { e.stopPropagation(); canvas.setPointerCapture(e.pointerId); }
    }, true);
    v.addEventListener('pointermove', (e) => {
      if (e.target === canvas && this.zoneTool.editing !== null) { this.zoneTool.move(ground(e)); e.stopPropagation(); return; }
      if (e.target === canvas && host.run.phase === 'build' && !this.section.editing) {
        const [x, y] = local(e);
        if (this.volume.move(rayAt(host.renderer.viewProj, canvas, x, y), x, y, host.renderer.viewProj, canvas, e.altKey)) { e.stopPropagation(); return; }
      }
      if (e.target !== canvas || !this.section.editing) return;
      const [x, y] = local(e);
      const top = this.topOfParts();
      if (this.section.move(rayAt(host.renderer.viewProj, canvas, x, y), x, y, host.renderer.viewProj, canvas, host.workY(), top)) e.stopPropagation();
    }, true);
    v.addEventListener('pointerup', (e) => {
      if (e.target !== canvas || e.button !== 0) return;
      const d = this.down;
      this.down = null;
      if (!d?.consumed) return;
      e.stopPropagation();
      if (this.zoneTool.editing !== null) { this.zoneTool.up(ground(e)); return; }
      if (this.volume.dragging) { this.volume.up(); return; }
      if (this.section.editing) { this.section.up(); return; }
      if (this.placing && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) this.placeModule(e.shiftKey);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (keyName(e) !== bindingOf('xray')) return;
      // U4 (WCAG 2.1.1): a quick tap of Tab from the 3D view moves focus into the HUD instead of peeking
      const tap = this.tabDownAt !== null && performance.now() - this.tabDownAt < TAB_TAP_MS && !this.xrayHeld;
      this.tabDownAt = null;
      clearTimeout(this.tabTimer);
      if (tap && keyName(e) === 'tab') { const list = focusables(document.querySelector('#viewport') ?? document.body).filter((el) => !(el instanceof HTMLCanvasElement)); (e.shiftKey ? list.at(-1) : list[0])?.focus(); return; }
      // releasing whatever key is bound to X-ray ends the hold
      if (this.xrayHeld) { this.xrayHeld = false; this.applyXray(); }
    });
    window.addEventListener('blur', () => { if (this.xrayHeld) { this.xrayHeld = false; this.applyXray(); } });
    this.paintBar();
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __knTools: unknown }).__knTools = this;
  }

  // ---- hooks main.ts calls ---------------------------------------------------------------------------

  /** Can the 3D cursor hit this part? (build: visible, editable, inside the section box) */
  pickable(p: PartRecord): boolean {
    if (this.host.run.phase !== 'build') return true;
    const doc = this.host.net.store?.doc;
    if (!doc) return true;
    return partVisible(doc, p) && partEditable(doc, p) && this.insideSection(p);
  }

  /** Parts to draw in the build scene. */
  visibleParts(doc: WorldDoc): PartRecord[] {
    const out: PartRecord[] = [];
    for (const p of doc.parts.values()) if (partVisible(doc, p) && this.insideSection(p)) out.push(p);
    return out;
  }

  /** Outline colour for selected parts (until renderer.setSelection draws proper outlines). */
  outline(id: number): Rgb | null {
    return this.selection.has(id) ? PLAYER_RGB[this.host.net.me?.slot ?? 1]! : null;
  }

  /**
   * U5 (M5): a placement the editor refuses, with the reason for the toast, or null. PART_SYSTEM §1 `caps.maxPerWorld`:
   * SINGULARITY 4 per world (A5's defs don't carry caps, so the table is here). `adding` = how many of `type` would arrive.
   */
  placementRefusal(type: string, adding = 1): string | null {
    const max = MAX_PER_WORLD[type];
    const doc = this.host.net.store?.doc;
    if (max === undefined || !doc) return null;
    let n = 0;
    for (const p of doc.parts.values()) if (p.type === type) n++;
    return n + adding > max ? `Up to ${max} ${partDef(type)?.name ?? type}s per world (this one has ${n})` : null;
  }

  /**
   * Fields for a newly placed part: it goes on the active layer. U5 (M5): a RIFT GATE, BUZZ BEACON or BUZZ also gets
   * the pair colour that pairs it at once (ui/m5tools.ts autoPair).
   */
  newPartFields(type?: string): { layer?: number; props?: PropList } {
    const doc = this.host.net.store?.doc;
    const out: { layer?: number; props?: PropList } = this.activeLayer && doc?.layers.has(this.activeLayer) ? { layer: this.activeLayer } : {};
    const def = type ? partDef(type) : undefined;
    if (doc && def && pairKind(def.type) && 'pair' in def.props) {
      const c = autoPair(def.type, doc.parts.values());
      if (c !== null) out.props = pairProps(def, c);
    }
    return out;
  }

  /** Select tool click in the 3D view: Shift/Ctrl adds or removes, plain click replaces. */
  clickSelect(id: number | null, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (id === null) { if (!additive) this.selection.clear(); return; }
    this.selectIds([id], additive ? 'toggle' : 'replace');
  }

  /** Delete the whole selection as one op. Returns false when nothing is selected. */
  deleteSelection(): boolean {
    const doc = this.host.net.store?.doc;
    if (!doc || !this.selection.size) return false;
    const ids = this.selection.ids();
    const parts = ids.filter((id) => { const p = doc.parts.get(id); return p && partEditable(doc, p); });
    const partSet = new Set(parts);
    // links that go with a removed part are removed by PartRemove itself
    const links = ids.filter((id) => { const l = doc.links.get(id); return l && !(l.from && partSet.has(l.from.part)) && !(l.to && partSet.has(l.to.part)) && !l.via.some((v) => partSet.has(v)); });
    const ops: Op[] = [];
    if (links.length) ops.push({ k: 'LinkRemove', ids: links });
    if (parts.length) ops.push({ k: 'PartRemove', ids: parts });
    if (!ops.length) return false;
    this.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
    this.selection.clear();
    return true;
  }

  /** Keys handled here first (before main.ts's own). Returns true when consumed. */
  keydown(e: KeyboardEvent, mapped: string = e.key): boolean {
    if (mapped === '') return false; // a default key whose action was rebound elsewhere
    const k = keyName({ key: mapped });
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === '\\') { this.outliner.toggle(); e.preventDefault(); return true; }
    if (ctrl && k === 'g') { if (e.shiftKey) this.ungroupSelection(); else this.groupSelection(); e.preventDefault(); return true; }
    if (ctrl && k === 'l') { this.lockSelection(); e.preventDefault(); return true; }
    if (ctrl || e.altKey) return false;
    if (k === 'tab') {
      // U4: Tab only peeks (X-ray) when focus is on the 3D view; on a HUD control it moves focus as usual.
      // From the view, a quick tap moves focus into the HUD and a hold (≥ 250 ms) peeks. A key remapped
      // to X-ray (Settings › Controls) peeks at once.
      const physicalTab = e.key === 'Tab';
      if (physicalTab && !focusIsWorld()) return false;
      e.preventDefault();
      if (!physicalTab) { if (!e.repeat && !this.xrayHeld) { this.xrayHeld = true; this.applyXray(); } return true; }
      if (!e.repeat && this.tabDownAt === null && !this.xrayHeld) {
        this.tabDownAt = performance.now();
        this.tabTimer = window.setTimeout(() => { if (this.tabDownAt !== null && !this.xrayHeld) { this.xrayHeld = true; this.applyXray(); } }, TAB_TAP_MS);
      }
      return true;
    }
    if (this.placing) {
      if (k === 'r') { this.placing.quarter = ((this.placing.quarter + (e.shiftKey ? 3 : 1)) % 4) as 0 | 1 | 2 | 3; return true; }
      if (k === 'escape') { this.placing = null; this.host.toast('Module placement cancelled'); return true; }
    }
    if (this.section.editing && (k === 'escape' || k === 'enter')) { this.section.finish(); this.paintBar(); return true; }
    // U4: the patrol-zone tool: Esc cancels; Enter at the keyboard cursor sets a corner
    if (this.zoneTool.editing !== null && k === 'escape') { this.zoneTool.cancel(); return true; }
    if (this.zoneTool.editing !== null && k === 'enter') { const hv = this.host.hover(); if (hv) this.zoneTool.point([hv.point[0], this.host.workY(), hv.point[2]]); e.preventDefault(); return true; }
    // U5: Esc drops a sizing drag; Shift+= / Shift+− grow or shrink the selected volume part by one step
    if (k === 'escape' && this.volume.cancel()) return true;
    if (this.grab.editing && k === 'escape') { this.grab.cancel(); return true; }
    if (this.grab.editing && k === 'enter') { const hv = this.host.hover(); if (hv) this.grab.point([...hv.point] as V3, hv.part); e.preventDefault(); return true; } // UIFIX (D122): hv.part
    if (e.shiftKey && (k === '+' || k === '=' || k === '_' || k === '-') && focusIsWorld() && this.volume.nudge(k === '+' || k === '=' ? 1 : -1)) { e.preventDefault(); return true; }
    if (this.cascade.open && k === 'escape') { this.cascade.hide(); return true; }
    if (this.settingsPanel.open && k === 'escape') { this.settingsPanel.toggle(false); return true; }
    if (k === 'h' && this.host.run.phase === 'build' && this.selection.size) { this.hideSelection(); return true; }
    return false;
  }

  /** Palette commands (UI_UX §4.6). */
  commands(): Command[] {
    const sel = this.selection.size;
    const cmds: Command[] = [
      { label: this.outliner.open ? 'Outliner: fold away' : 'Outliner: show', hint: 'Ctrl+\\', run: () => this.outliner.toggle() },
      { label: 'X-ray: links and ports', hint: 'Hold Tab', run: () => this.setXray('links') },
      { label: 'X-ray: everything (hidden parts too)', run: () => this.setXray('all') },
      { label: 'X-ray: off', run: () => this.setXray('off') },
      { label: this.cutaway ? 'Cutaway: off' : 'Cutaway: on', run: () => this.setCutaway(!this.cutaway) },
      { label: this.section.box ? 'Section box: edit handles' : 'Section box: drag one out', run: () => { this.section.start(); this.paintBar(); this.host.toast(this.section.box ? 'Drag a handle · Enter or Esc to finish' : 'Drag on the work plane to draw a section box'); } },
      { label: 'Section box: clear', run: () => this.section.clear() },
      { label: 'Save selection as module', run: () => void this.saveModule() },
      { label: 'Library: Modules', run: () => this.host.library.showTab('modules') },
      { label: 'Import a .knockmod module', run: () => this.importModules() },
      { label: 'New layer', run: () => { this.outliner.toggle(true); this.outliner.newLayer(); } },
      { label: 'Move selection to the active layer', run: () => this.outliner.assignLayer(this.activeLayer) },
      { label: 'Group selection', hint: 'Ctrl+G', run: () => this.groupSelection() },
      { label: 'Ungroup selection', hint: 'Ctrl+Shift+G', run: () => this.ungroupSelection() },
      { label: 'Hide selection', hint: 'H', run: () => this.hideSelection() },
      { label: 'Lock selection', hint: 'Ctrl+L', run: () => this.lockSelection() },
      // U5 (M5, D105)
      { label: 'Tag selection for BUZZ', run: () => this.setTagged(this.selectedParts(), true) },
      { label: 'Untag selection (BUZZ)', run: () => this.setTagged(this.selectedParts(), false) },
      { label: 'Show everything (unhide all)', run: () => this.showAll() },
      { label: 'Select all', run: () => { const d = this.host.net.store?.doc; if (d) this.selectIds([...d.parts.keys()], 'replace'); } },
      { label: 'Settings', run: () => this.settingsPanel.toggle(true) },
      { label: settings.accessibility.reduceTransparency ? 'Settings: Reduce transparency off (glass panels)' : 'Settings: Reduce transparency on (solid panels)', run: () => setSetting('accessibility.reduceTransparency', !settings.accessibility.reduceTransparency) },
      { label: settings.graphics.dof ? 'Settings: Depth of field off' : 'Settings: Depth of field on', run: () => setSetting('graphics.dof', !settings.graphics.dof) },
      { label: 'Settings: Accessibility', run: () => this.settingsPanel.toggle(true, 'accessibility') },
      { label: 'Settings: Graphics', run: () => this.settingsPanel.toggle(true, 'graphics') },
      { label: 'Settings: Controls (remap keys)', run: () => this.settingsPanel.toggle(true, 'controls') },
      { label: 'Settings: Comfort', run: () => this.settingsPanel.toggle(true, 'comfort') },
      ...ENVIRONMENTS.map((env) => ({ label: `Environment: ${env.label}`, run: () => this.setEnvironment(env.id) })),
      { label: 'Cascade Report (last run)', run: () => this.showReport(true) },
    ];
    if (!sel) return cmds.filter((c) => !/selection/i.test(c.label) || c.label.startsWith('Save'));
    return cmds;
  }

  /** Per frame: sync selection with main.ts, renderer selection, overlays, end-of-run report. */
  frame(overlay: SceneItem[]): void {
    const h = this.host;
    // main.ts → selection (it may set or clear its selected part directly)
    const m = h.selected();
    if (m !== this.selection.primary) {
      if (m === null) this.selection.clear();
      else if (this.selection.has(m)) this.selection.primary = m;
      else this.selection.replace([m], m);
    }
    // selection → renderer outline (contract 4), when it changes
    const inst = h.instancesOf();
    const key = `${this.selection.ids().join(',')}:${inst.size}`;
    if (key !== this.lastSelKey) {
      this.lastSelKey = key;
      const list: number[] = [];
      for (const id of this.selection.ids()) for (const i of inst.get(id) ?? []) list.push(i);
      this.r2.setSelection?.(list, list.length ? PLAYER_RGB[h.net.me?.slot ?? 1]! : null);
    }
    // section box and module ghost
    if (h.run.phase === 'build') {
      this.section.overlay(overlay, h.camDist());
      this.zoneTool.overlay(overlay); // U4: DUSTY's patrol zone
      this.volume.overlay(overlay, h.camDist()); // U5: volume sizing handles
      this.grab.overlay(overlay); // U5: GRABBER's zones
      const d = h.net.store?.doc;
      if (d) pairOverlay(overlay, d.parts, this.selection.ids(), this.xrayShown !== 'off'); // U5: RIFT GATES / BUZZ pairs
      const hv = h.hover();
      if (this.placing && hv) {
        const pos = placementAt(hv.point, false);
        overlay.push(...ghostItems(this.placing.def, pos, this.placing.quarter, PLAYER_RGB[h.net.me?.slot ?? 1]!, (t) => h.artMesh(t)));
      }
    }
    if (this.lastOutlinerOpen !== this.outliner.open) { this.lastOutlinerOpen = this.outliner.open; this.paintBar(); } // folded from its own « button
    this.runWatch();
  }

  // ---- selection ---------------------------------------------------------------------------------------

  private selectIds(ids: readonly number[], mode: 'replace' | 'toggle' | 'add'): void {
    const doc = this.host.net.store?.doc;
    if (!doc || this.host.run.phase !== 'build') return;
    const isPart = (id: number): boolean => doc.parts.has(id);
    const ok: number[] = [];
    let refused: string | null = null;
    for (const id of ids) {
      const p = doc.parts.get(id);
      if (p) {
        const why = lockedReason(doc, p);
        if (why) { refused = why; continue; }
        if (!partVisible(doc, p)) { refused = 'That part is hidden (show it in the Outliner)'; continue; }
      } else if (!doc.links.has(id)) continue;
      ok.push(id);
    }
    if (!ok.length) { if (refused) this.host.toast(refused, 'warn'); if (mode === 'replace' && !refused) this.selection.clear(); return; }
    if (mode === 'replace') this.selection.replace(ok, undefined, isPart);
    else if (mode === 'add') this.selection.replace([...new Set([...this.selection.ids(), ...ok])], ok.find(isPart) ?? this.selection.primary, isPart);
    else this.selection.batch(() => { for (const id of ok) this.selection.toggle(id, isPart); });
  }

  private selectedParts(): PartId[] {
    const doc = this.host.net.store?.doc;
    return doc ? this.selection.ids().filter((id) => doc.parts.has(id)) : [];
  }

  private groupSelection(): void {
    const doc = this.host.net.store?.doc;
    const parts = this.selectedParts();
    if (!doc || !parts.length) { this.host.toast('Select some parts to group'); return; }
    const id = this.ids.next('group', this.host.net.me?.slot ?? 1, doc.groups.keys());
    const name = `Group ${doc.groups.size + 1}`;
    if (this.submit({ k: 'GroupSet', id, name, parent: 0, members: parts })) this.host.toast(`Grouped ${parts.length} parts as “${name}”`);
  }

  private ungroupSelection(): void {
    const doc = this.host.net.store?.doc;
    if (!doc) return;
    const groups = [...new Set(this.selectedParts().map((id) => doc.parts.get(id)!.group ?? 0).filter((g) => g && doc.groups.has(g)))];
    if (!groups.length) { this.host.toast('Nothing in the selection is grouped'); return; }
    const ops: Op[] = groups.map((g) => ({ k: 'GroupSet', id: g, name: null, parent: 0, members: null }));
    this.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
  }

  private hideSelection(): void {
    const doc = this.host.net.store?.doc;
    const parts = this.selectedParts();
    if (!doc || !parts.length) return;
    const op = flagOp(doc, parts, PartFlag.Hidden, true);
    if (op && this.submit(op)) { this.selection.clear(); this.host.toast(`Hid ${parts.length} part${parts.length === 1 ? '' : 's'} · Outliner › Show all brings them back`); }
  }

  /**
   * U5 (M5, D105): tag / untag parts for BUZZ (`PartFlag.Tagged`, one flag op, undoable). `ids` that are in a
   * multi-selection apply to the whole selection; critters and fixed parts are skipped.
   */
  setTagged(ids: readonly number[], on: boolean): void {
    const doc = this.host.net.store?.doc;
    if (!doc || !PartFlag.Tagged) return;
    const sel = ids.length === 1 && this.selection.has(ids[0]!) && this.selection.size > 1 ? this.selectedParts() : [...ids];
    const parts = sel.filter((id) => { const p = doc.parts.get(id); return p && partEditable(doc, p) && taggable(partDef(p.type)); });
    if (!parts.length) { this.host.toast(sel.length ? 'BUZZ can only fetch loose parts, not critters or fixed parts' : 'Select the parts to tag', 'warn'); return; }
    const op = flagOp(doc, parts, PartFlag.Tagged, on);
    if (op && this.submit(op)) {
      const name = parts.length === 1 ? partDef(doc.parts.get(parts[0]!)!.type)?.name ?? 'part' : `${parts.length} parts`;
      this.host.toast(on ? `Tagged ${name} for BUZZ` : `Untagged ${name}`);
      this.host.markDirty();
    }
  }

  private lockSelection(): void {
    const doc = this.host.net.store?.doc;
    const parts = this.selectedParts();
    if (!doc || !parts.length) { this.host.toast('Select some parts to lock'); return; }
    const op = flagOp(doc, parts, PartFlag.Locked, true);
    if (op && this.submit(op)) { this.selection.clear(); this.host.toast(`Locked ${parts.length} part${parts.length === 1 ? '' : 's'} · unlock them in the Outliner`); }
  }

  private showAll(): void {
    const doc = this.host.net.store?.doc;
    if (!doc) return;
    const ops: Op[] = [];
    for (const l of doc.layers.values()) if (l.flags & 1) ops.push({ k: 'LayerSet', id: l.id, name: l.name, flags: l.flags & ~1 });
    const op = flagOp(doc, [...doc.parts.keys()], PartFlag.Hidden, false);
    if (op) ops.push(...(op.k === 'Batch' ? op.ops : [op]));
    if (ops.length) this.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
  }

  // ---- view toggles --------------------------------------------------------------------------------------

  setXray(mode: XrayMode): void { this.xray = mode; this.applyXray(); }
  private cycleXray(): void { this.setXray(this.xray === 'off' ? 'links' : this.xray === 'links' ? 'all' : 'off'); }
  private applyXray(): void {
    const mode: XrayMode = this.xrayShown;
    if (!this.r2.setXray && mode !== 'off') this.noteRenderer('X-ray');
    this.r2.setXray?.(mode);
    this.paintBar();
  }
  setCutaway(on: boolean): void {
    this.cutaway = on;
    if (!this.r2.setCutaway && on) this.noteRenderer('Cutaway');
    this.r2.setCutaway?.(on);
    this.paintBar();
  }
  /** Section box: start editing, or finish when editing (view rail › Section). */
  toggleSection(): void {
    if (this.section.editing) { this.section.finish(); }
    else {
      this.section.start();
      this.host.toast(this.section.box ? 'Drag a handle to move a face · Enter or Esc finishes · palette › “Section box: clear” removes it' : 'Drag on the work plane to draw a section box');
    }
    this.paintBar();
  }
  private noted = new Set<string>();
  private noteRenderer(what: string): void {
    if (this.noted.has(what)) return;
    this.noted.add(what);
    this.host.toast(`${what}: the renderer doesn’t draw this yet (stream C)`, 'warn');
  }

  private paintBar(): void {
    for (const fn of this.viewListeners) fn();
  }

  /** Subscribe to view changes (X-ray, cutaway, section, outliner, environment). */
  onView(fn: () => void): () => void { this.viewListeners.add(fn); return () => this.viewListeners.delete(fn); }

  /** The X-ray mode on screen (a held Tab shows links). */
  get xrayShown(): XrayMode { return this.xrayHeld && this.xray === 'off' ? 'links' : this.xray; }

  /** View rail mode: Section while the box is being edited or exists, X-ray when on, else Normal. */
  viewMode(): 'normal' | 'xray' | 'section' {
    if (this.section.editing) return 'section';
    if (this.xrayShown !== 'off') return 'xray';
    return 'normal';
  }

  /** Environment label for the world card chip. */
  envLabel(): string {
    const env = this.host.net.store?.doc.env;
    return ENVIRONMENTS.find((e) => e.id === env?.environment)?.label.replace(/^The /, '') ?? env?.environment ?? '…';
  }

  private insideSection(p: PartRecord): boolean {
    // the renderer clips when it can; until then the build scene leaves outside parts out
    if (!this.section.box || this.r2.setSectionBox) return true;
    return this.section.contains([posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])]);
  }

  private topOfParts(): number {
    const doc = this.host.net.store?.doc;
    let top = 1;
    if (doc) for (const p of doc.parts.values()) top = Math.max(top, posToMetres(p.pos[1]) + 0.3);
    return Math.min(top, 20);
  }

  // ---- modules -----------------------------------------------------------------------------------------

  private async saveModule(): Promise<void> {
    const net = this.host.net;
    const parts = this.selectedParts();
    if (!net.store || !parts.length) { this.host.toast('Select the parts to save (Select tool, Shift+click adds)', 'warn'); return; }
    const name = (await ask(this.host.viewport, { title: `Save ${parts.length} part${parts.length === 1 ? '' : 's'} as a module`, value: `Gadget ${net.store.doc.modules.size + 1}`, confirm: 'Save module' }))?.trim();
    const doc = net.store?.doc;
    if (!name || !doc) return;
    try {
      const def = moduleForSelection(doc, parts, name.slice(0, 64), net.me?.name ?? '');
      const id = this.ids.next('module', net.me?.slot ?? 1, doc.modules.keys());
      if (this.submit(saveOp(id, def))) {
        this.host.toast(`Saved module “${def.meta.name}”: ${def.parts.length} parts, ${def.links.length} links${def.ports.length ? `, ${def.ports.length} exposed ports` : ''}`);
        this.host.library.refreshModules();
      }
    } catch (err) {
      this.host.toast(`Couldn’t save the module: ${(err as Error).message}`, 'error');
    }
  }

  private importModules(): void {
    importFiles((def, bytes) => {
      const doc = this.host.net.store?.doc;
      if (!doc) return;
      const id = this.ids.next('module', this.host.net.me?.slot ?? 1, doc.modules.keys());
      if (this.submit({ k: 'ModuleSave', id, name: def.meta.name.slice(0, 64), blob: bytes })) {
        this.host.toast(`Imported “${def.meta.name}” (${def.parts.length} parts)`);
        this.host.library.showTab('modules');
      }
    }, (msg) => this.host.toast(`Not a module: ${msg}`, 'error'));
  }

  private async moduleAction(id: number, action: 'place' | 'export' | 'rename' | 'delete'): Promise<void> {
    const doc = this.host.net.store?.doc;
    const rec = doc?.modules.get(id);
    if (!doc || !rec) return;
    if (action === 'delete') {
      const yes = await ask(this.host.viewport, { title: `Delete the module “${rec.name}” from this world? Parts already placed stay.`, confirm: 'Delete', danger: true, text: false });
      if (yes !== null && this.host.net.store?.doc.modules.has(id)) this.submit({ k: 'ModuleSave', id, name: rec.name, blob: null });
      return;
    }
    if (action === 'rename') {
      const name = (await ask(this.host.viewport, { title: 'Rename module', value: rec.name, confirm: 'Rename' }))?.trim();
      const cur = this.host.net.store?.doc.modules.get(id);
      if (name && cur && name !== cur.name) this.submit({ k: 'ModuleSave', id, name: name.slice(0, 64), blob: cur.blob });
      return;
    }
    let def: ModuleDef;
    try { def = doc.moduleDef(id)!; } catch (err) { this.host.toast(`That module is unreadable: ${(err as Error).message}`, 'error'); return; }
    if (action === 'export') { exportFile({ ...def, meta: { ...def.meta, name: rec.name } }, rec.blob); return; }
    if (this.host.run.phase !== 'build') { this.host.toast('Stop the run to place modules'); return; }
    this.section.finish();
    this.host.useSelectTool();
    this.host.setSelected(null);
    this.placing = { id, def, quarter: 0 };
    this.host.toast(`Placing “${rec.name}”: click to drop · R rotates 90° · Esc cancels`);
  }

  private placeModule(fine: boolean): void {
    const pl = this.placing;
    const hv = this.host.hover();
    const net = this.host.net;
    if (!pl || !hv || !net.store || !net.me) return;
    // U5 (M5): per-world caps (SINGULARITY) count the module's parts too
    for (const t of new Set(pl.def.parts.map((q) => q.type))) {
      const why = this.placementRefusal(t, pl.def.parts.filter((q) => q.type === t).length);
      if (why) { this.host.toast(why, 'warn'); return; }
    }
    const op = placeOp(pl.def, pl.id, placementAt(hv.point, fine), pl.quarter, this.newPartFields().layer ?? 0, () => net.nextId());
    if (this.submit(op) && op.k === 'ModulePlace') {
      // select what was just placed (Shift keeps placing)
      const ids = pl.def.parts.map((p) => op.idBase + p.id);
      if (!fine) this.placing = null;
      this.selectIds(ids, 'replace');
    }
  }

  // ---- environment, about, diagnostics -----------------------------------------------------------------

  private setEnvironment(id: string): void {
    const doc = this.host.net.store?.doc;
    if (!doc || doc.env.environment === id) return;
    if (this.host.run.phase !== 'build') { this.host.toast('Stop the run to change the environment'); return; }
    // U5 (M5): W5's envSwitchPatch also brings the environment's gravity and air (Moon 16.5 % / 0 %) when the world
    // still has the old environment's defaults: one op, one undo step
    const patch = envSwitchPatch(doc.env, id);
    const extra = patch.gravity !== undefined || patch.air !== undefined ? ` · gravity ${patch.gravity ?? doc.env.gravity} %, air ${patch.air ?? doc.env.air} %` : '';
    if (this.submit({ k: 'EnvUpdate', patch })) this.host.toast(`Environment: ${ENVIRONMENTS.find((e) => e.id === id)?.label ?? id}${extra}`);
    this.paintBar();
  }

  private about(): [string, string][] {
    const n = this.host.net, d = n.store?.doc, r = this.host.renderer;
    return [
      ['Build', __KN_BUILD__], ['Protocol', String(PROTO)], ['Sim tick rate', `${this.host.run.tickRate} Hz`],
      ['World', `${d?.parts.size ?? 0} parts · ${d?.links.size ?? 0} links · ${d?.layers.size ?? 0} layers · ${d?.groups.size ?? 0} groups · ${d?.modules.size ?? 0} modules`],
      ['Seq', String(n.store?.confirmedSeq ?? 0)], ['You', n.me ? `${n.me.name} (slot ${n.me.slot}, tier ${n.me.tier} GB)` : 'offline'],
      ['Renderer', `${r.stats.instances} instances · ${r.stats.frameMs.toFixed(1)} ms/frame`],
      ['Physics', (() => { const t = this.host.run.joltThreadsLive; return t === null ? `Jolt: ${this.host.run.joltThreads === undefined ? 'Auto' : this.host.run.joltThreads} threads asked (no run yet)` : t > 0 ? `Jolt: ${t} worker threads` : 'Jolt: single-threaded'; })()], // U5 (M5)
      ['Section box / X-ray / cutaway', `${this.r2.setSectionBox ? 'renderer' : 'fallback'} / ${this.r2.setXray ? 'renderer' : 'pending'} / ${this.r2.setCutaway ? 'renderer' : 'pending'}`],
    ];
  }

  private diagnostics(): unknown {
    const n = this.host.net, d = n.store?.doc, r = this.host.renderer;
    return {
      at: new Date().toISOString(), build: __KN_BUILD__, proto: PROTO, userAgent: navigator.userAgent,
      gpu: { tier: n.me?.tier, stats: r.stats }, settings,
      world: d ? { parts: d.parts.size, links: d.links.size, layers: d.layers.size, groups: d.groups.size, modules: d.modules.size, env: d.env } : null,
      session: { seq: n.store?.confirmedSeq, pending: n.store?.pendingCount, players: n.players.map((p) => ({ slot: p.slot, tier: p.tier })) },
      run: { phase: this.host.run.phase, desyncs: this.host.run.desyncs, resyncs: this.host.run.resyncs },
    };
  }

  // ---- cascade report --------------------------------------------------------------------------------

  private report(): ReturnType<typeof buildReport> {
    const doc = this.host.net.store?.doc;
    const linked = (a: number, b: number): boolean => {
      if (!doc) return false;
      for (const l of doc.links.values()) {
        const ends = [l.from?.part, l.to?.part, ...l.via];
        if (ends.includes(a) && ends.includes(b)) return true;
      }
      return false;
    };
    return buildReport(this.host.run.log as readonly CascadeEvent[], { tickRate: this.host.run.tickRate, partsTotal: doc?.parts.size ?? 0, linked });
  }

  showReport(force = false): void {
    const run = this.host.run;
    // UIFIX (D122): during a replay the log only reaches the playhead: "last run" is the finished report
    if (force && run.phase !== 'build' && this.reportShownFor !== run.runId && this.cascade.report) { this.cascade.show(this.cascade.report); return; }
    if (!run.log.length && !force) return;
    this.cascade.show(this.report());
  }

  /** UIFIX (D122): a chain step's tick to scrub to (once the run is running: after the run, REPLAY starts first). */
  private pendingScrub: number | null = null;
  /** UIFIX (D122): the next run is a replay started from the report (the report stays open over it). */
  private replayFromReport = false;
  private scrubAsked = 0;

  /** UIFIX (D122): the Cascade Report's chain step: scrub there (past the bake head too); after the run, replay to it. */
  private scrubTo(tick: number): void {
    const run = this.host.run;
    this.pendingScrub = tick;
    if (run.phase === 'build') { this.replayFromReport = true; this.scrubAsked = performance.now(); run.primary(); }
    this.flushScrub();
  }

  private flushScrub(): void {
    const run = this.host.run, t = this.pendingScrub;
    if (t === null || run.phase !== 'running' || !run.runId) return;
    this.pendingScrub = null;
    run.setPlay({ tick: t, paused: true }, true);
  }

  /** End of run: the cascade has gone quiet for 3 s of sim time, or the run stopped. */
  private runWatch(): void {
    const run = this.host.run;
    if (run.runId && run.runId !== this.lastRunId) {
      this.lastRunId = run.runId; this.runCount++;
      if (this.cascade.open && !this.replayFromReport) this.cascade.hide();
      this.replayFromReport = false; // UIFIX (D122)
    }
    if (this.pendingScrub !== null) { // UIFIX (D122): a replay that never started (refused) drops the scrub after 15 s
      if (run.phase === 'build' && (!this.replayFromReport || performance.now() - this.scrubAsked > 15000)) { this.pendingScrub = null; this.replayFromReport = false; } else this.flushScrub();
    }
    if (run.phase !== this.lastPhase) {
      const was = this.lastPhase;
      this.lastPhase = run.phase;
      if (was === 'running' && run.phase === 'build') {
        if (this.reportShownFor !== this.lastRunId && run.log.length >= 2) { this.reportShownFor = this.lastRunId; this.showReport(); }
        else this.cascade.refresh();
      }
      this.host.markDirty();
      this.paintBar();
    }
    if (run.phase !== 'running' || run.paused || this.reportShownFor === run.runId) return;
    let last = -1, notable = 0;
    for (let i = run.log.length - 1; i >= 0; i--) {
      const e = run.log[i]!;
      const quietKind = e.kind === 'Impact' ? e.mag < 5 : (e.kind as string) === 'Sound';
      if (quietKind) continue;
      if (last < 0) last = e.tick;
      notable++;
      if (notable >= 3) break;
    }
    if (notable >= 3 && run.tick - last > 3 * run.tickRate && run.baked - last > 3 * run.tickRate) {
      this.reportShownFor = run.runId;
      this.showReport();
    }
  }

  // ---- inspector -------------------------------------------------------------------------------------------

  private inspectorSection(p: PartRecord, el: HTMLElement): void {
    const doc = this.host.net.store?.doc;
    if (!doc) return;
    const parts = this.selection.has(p.id) && this.selection.size > 1 ? this.selectedParts() : [p.id];
    const box = document.createElement('div');
    box.className = 'ins-org';
    if (parts.length > 1) {
      const n = document.createElement('small');
      n.className = 'ins-multi';
      n.textContent = `${parts.length} parts selected: layer, group and visibility apply to all`;
      box.appendChild(n);
    }
    const sel = (label: string, options: [number, string][], value: number, onChange: (v: number) => void): void => {
      const row = document.createElement('label');
      row.className = 'ins-row';
      row.innerHTML = '<span></span>';
      (row.firstChild as HTMLElement).textContent = label;
      const s = document.createElement('select');
      for (const [v, text] of options) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = text;
        if (v === value) o.selected = true;
        s.appendChild(o);
      }
      s.onchange = () => onChange(Number(s.value));
      row.appendChild(s);
      box.appendChild(row);
    };
    const layer = parts.every((id) => (doc.parts.get(id)?.layer ?? 0) === (p.layer ?? 0)) ? p.layer ?? 0 : -1;
    sel('Layer', [...(layer < 0 ? [[-1, '—'] as [number, string]] : []), [0, 'Default'], ...[...doc.layers.values()].map((l) => [l.id, l.name] as [number, string])], layer, (v) => {
      if (v < 0) return;
      const op = layerOp(doc, parts, v);
      if (op) this.submit(op);
    });
    const group = parts.every((id) => (doc.parts.get(id)?.group ?? 0) === (p.group ?? 0)) ? p.group ?? 0 : -1;
    sel('Group', [...(group < 0 ? [[-1, '—'] as [number, string]] : []), [0, 'None'], ...[...doc.groups.values()].map((g) => [g.id, g.name] as [number, string]), [-2, '+ New group']], group, (v) => {
      if (v === -1) return;
      if (v === -2) { this.groupSelectionOf(parts); return; }
      const ops: Op[] = [];
      if (v === 0) {
        for (const g of new Set(parts.map((id) => doc.parts.get(id)?.group ?? 0))) {
          const rec = doc.groups.get(g);
          if (rec) ops.push({ k: 'GroupSet', id: g, name: rec.name, parent: rec.parent, members: groupMembers(doc, g).filter((m) => !parts.includes(m)) });
        }
      } else {
        const rec = doc.groups.get(v)!;
        ops.push({ k: 'GroupSet', id: v, name: rec.name, parent: rec.parent, members: [...new Set([...groupMembers(doc, v), ...parts])].sort((a, b) => a - b) });
      }
      if (ops.length) this.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
    });
    const tg = document.createElement('div');
    tg.className = 'ins-tg';
    for (const [label, bit] of [['Hide', PartFlag.Hidden], ['Lock', PartFlag.Locked]] as const) {
      const b = document.createElement('button');
      b.className = 'ghost small';
      b.textContent = label;
      b.title = bit === PartFlag.Hidden ? 'Hide (H). The Outliner shows it again.' : 'Lock (Ctrl+L). Unlock in the Outliner.';
      b.onclick = () => { const op = flagOp(doc, parts, bit, true); if (op && this.submit(op)) this.selection.clear(); };
      tg.appendChild(b);
    }
    box.appendChild(tg);
    el.appendChild(box);
  }

  private groupSelectionOf(parts: PartId[]): void {
    const doc = this.host.net.store?.doc;
    if (!doc) return;
    const id = this.ids.next('group', this.host.net.me?.slot ?? 1, doc.groups.keys());
    this.submit({ k: 'GroupSet', id, name: `Group ${doc.groups.size + 1}`, parent: 0, members: parts });
  }

  // ---- plumbing ------------------------------------------------------------------------------------------

  private submit(op: Op): boolean {
    if (this.host.run.phase !== 'build') { this.host.toast('Stop the run to edit'); return false; }
    return this.host.net.submit(op);
  }

  private linkLabel(l: LinkRecord): string {
    const doc = this.host.net.store?.doc;
    const nm = (id: number | undefined): string => (id === undefined ? '·' : partDef(doc?.parts.get(id)?.type ?? '')?.name ?? '?');
    const kind = l.kind.replace(/_/g, ' ');
    return l.from || l.to ? `${kind}: ${nm(l.from?.part)} → ${nm(l.to?.part)}` : `${kind} (${l.points.length} points)`;
  }
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export type { Box };
