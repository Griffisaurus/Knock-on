// Viewer settings (UI_UX §4.10, GAME_SPEC §20): one typed object, persisted per viewer in localStorage,
// with change events. Other streams read it directly, e.g. stream C reads `settings.comfort` for the
// director cut rate and camera shake:
//
//   import { settings, onSettingsChange } from './ui/settings.ts';
//   const shake = settings.comfort.shake;               // 0..1
//   onSettingsChange((s, path) => { if (path.startsWith('comfort.')) ... });
//
// The tabbed panel that edits it is ui/settingspanel.ts.

export type TierChoice = 'auto' | 4 | 8 | 12 | 16 | 32;
export type ColourPreset = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'high-contrast';

export interface Settings {
  graphics: {
    tier: TierChoice;
    /** Ignore the tier's part budget (warns; may run out of VRAM). */
    budgetOverride: boolean;
    renderScale: number; // 0.5..1.5
    particleCap: number; // max live particles
    unlimitedMayhem: boolean;
    /** Studio cyc: dark instead of light. */
    darkCyc: boolean;
    /**
     * Tilt-shift depth of field in Build and Run (D79, UI_UX §4.10). On by default; stream L3 reads it.
     * Use `dofEnabled()` for the effective value (reduced motion turns it off, UI_UX §7).
     */
    dof: boolean;
  };
  comfort: {
    reduceFlashing: boolean; // on by default (GAME_SPEC §20)
    shake: number; // 0..1, default 0.7
    hitstop: number; // 0..1
    slowmo: number; // 0..1 auto slow-mo strength
    directorCutRate: number; // 0..1 (0 = never cut, 1 = frantic)
    reducedMotion: boolean;
  };
  accessibility: {
    colourPreset: ColourPreset;
    uiScale: number; // 0.75..2
    /** Event captions and critter emote text (U4, ui/captions.ts). */
    captions: boolean;
    /** Keyboard building aids (U4, ui/keyboard.ts): keyboard cursor, Enter places / picks up / wires, sticky radial. */
    keyboardAids: boolean;
    /** Channel glyphs on the ports the 3D view shows (U4, ui/overlays.ts), so channels never rely on colour. */
    portGlyphs: boolean;
    /** Every glass surface becomes solid Graphite (D77). Also forced on the 4 GB tier and by the frame-budget fallback. */
    reduceTransparency: boolean;
  };
  controls: {
    /** Action → key (KeyboardEvent.key, lower-case for letters). Missing = default. */
    bindings: Record<string, string>;
    /** BUILDUX (D124): placing, dragging and pasting snap a port onto a compatible port within 5 cm (Alt = off for a move). */
    portSnap: boolean;
  };
  audio: { master: number; music: number; sfx: number; muted: boolean };
  multiplayer: { nickname: string; showPartnerLaser: boolean; pingSounds: boolean };
  /** U5 (M5): Settings › Performance. */
  performance: {
    /**
     * Physics (Jolt) worker threads (D99): 'auto' = hardwareConcurrency − 3, clamped 2–12 (the sim worker's default);
     * 0 = the single-threaded build. Read at boot (applies on reload, like the quality tier). Never changes results.
     */
    joltThreads: JoltThreadsChoice;
  };
}

export type JoltThreadsChoice = 'auto' | number;
/** The thread counts Settings › Performance offers (0 = single-threaded). */
export const JOLT_THREAD_CHOICES: readonly number[] = [0, 2, 3, 4, 6, 8, 10, 12, 16];

/** What 'auto' means on the test system (the sim worker's joltThreadsFor: hardwareConcurrency − 3, clamped 2–12). */
export function autoJoltThreads(cores: number = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4): number {
  return Math.max(2, Math.min(12, cores - 3));
}

/** The count to ask the sim worker for (undefined = its default), from the setting. */
export function joltThreadsSetting(s: Settings = settings): number | undefined {
  const v = s.performance.joltThreads;
  return v === 'auto' ? undefined : v;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: { tier: 'auto', budgetOverride: false, renderScale: 1, particleCap: 200_000, unlimitedMayhem: false, darkCyc: false, dof: true },
  comfort: { reduceFlashing: true, shake: 0.7, hitstop: 0.5, slowmo: 0.5, directorCutRate: 0.5, reducedMotion: false },
  accessibility: { colourPreset: 'default', uiScale: 1, captions: false, keyboardAids: true, portGlyphs: true, reduceTransparency: false },
  controls: { bindings: {}, portSnap: true }, // BUILDUX (D124)
  audio: { master: 0.8, music: 0.5, sfx: 0.9, muted: false },
  multiplayer: { nickname: '', showPartnerLaser: true, pingSounds: true },
  performance: { joltThreads: 'auto' },
};

/** Remappable single-key actions (Controls tab). Modifier shortcuts are listed but fixed in v1. */
export interface ActionDef { readonly id: string; readonly label: string; readonly key: string; readonly group: string; readonly fixed?: boolean }
export const ACTIONS: readonly ActionDef[] = [
  { id: 'run', label: 'Let it rip / pause', key: ' ', group: 'Run' },
  { id: 'stop', label: 'Stop the run', key: 'backspace', group: 'Run' },
  { id: 'stepFwd', label: 'Step forward', key: '.', group: 'Run' },
  { id: 'stepBack', label: 'Step back', key: ',', group: 'Run' },
  { id: 'faster', label: 'Faster', key: '=', group: 'Run' },
  { id: 'slower', label: 'Slower', key: '-', group: 'Run' },
  { id: 'select', label: 'Select tool', key: 'v', group: 'Build' },
  { id: 'wire', label: 'Wire tool', key: 'e', group: 'Build' },
  { id: 'path', label: 'Path tool', key: 'p', group: 'Build' },
  { id: 'library', label: 'Library', key: 'l', group: 'Build' },
  { id: 'yaw', label: 'Rotate (yaw)', key: 'r', group: 'Build' },
  { id: 'pitch', label: 'Rotate (pitch)', key: 't', group: 'Build' },
  { id: 'roll', label: 'Rotate (roll)', key: 'y', group: 'Build' },
  { id: 'delete', label: 'Delete', key: 'delete', group: 'Build' },
  { id: 'radial', label: 'Radial menu (hold)', key: 'q', group: 'Build' },
  { id: 'hide', label: 'Hide selection', key: 'h', group: 'Build' },
  { id: 'gizmo', label: 'Gizmo on / off', key: 'a', group: 'Build' }, // DRAG (D117): G is the ping key
  { id: 'gizmoAxes', label: 'Gizmo: local / world axes', key: 'x', group: 'Build' }, // BUILDUX (D123)
  { id: 'xray', label: 'X-ray (hold)', key: 'tab', group: 'View' },
  { id: 'frame', label: 'Frame selection', key: 'f', group: 'View' },
  { id: 'camera', label: 'Cycle camera', key: 'c', group: 'View' },
  { id: 'ping', label: 'Ping', key: 'g', group: 'Together' },
  { id: 'chat', label: 'Chat', key: '/', group: 'Together' },
  { id: 'palette', label: 'Command palette', key: 'ctrl+k', group: 'Fixed', fixed: true },
  { id: 'undo', label: 'Undo / redo', key: 'ctrl+z', group: 'Fixed', fixed: true },
  { id: 'outliner', label: 'Outliner', key: 'ctrl+\\', group: 'Fixed', fixed: true },
  { id: 'group', label: 'Group selection', key: 'ctrl+g', group: 'Fixed', fixed: true },
  { id: 'lock', label: 'Lock selection', key: 'ctrl+l', group: 'Fixed', fixed: true },
  { id: 'solo', label: 'Solo preview', key: 'shift+ ', group: 'Fixed', fixed: true },
  // BUILDUX (D123): copy / paste / duplicate and mirror
  { id: 'copy', label: 'Copy selection', key: 'ctrl+c', group: 'Fixed', fixed: true },
  { id: 'paste', label: 'Paste (click to drop)', key: 'ctrl+v', group: 'Fixed', fixed: true },
  { id: 'duplicate', label: 'Duplicate selection', key: 'ctrl+d', group: 'Fixed', fixed: true },
  { id: 'mirrorX', label: 'Mirror selection across X', key: 'alt+x', group: 'Fixed', fixed: true },
  { id: 'mirrorY', label: 'Mirror selection across Y', key: 'alt+y', group: 'Fixed', fixed: true },
  { id: 'mirrorZ', label: 'Mirror selection across Z', key: 'alt+z', group: 'Fixed', fixed: true },
];

const STORAGE_KEY = 'kn.settings.v2';
const LEGACY_KEY = 'kn.settings'; // M1: { master, music, sfx, muted, dark }

/** The live settings object. Mutate only through `setSetting` / `resetSettings` so listeners fire. */
export const settings: Settings = load();

type Listener = (s: Settings, path: string) => void;
const listeners = new Set<Listener>();

/** Subscribe to changes; `path` is the dotted key that changed ('*' after a reset). Returns an unsubscribe. */
export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set one value by dotted path, e.g. `setSetting('comfort.shake', 0.4)`. Persists and notifies. */
export function setSetting(path: string, value: unknown): void {
  const keys = path.split('.');
  let o = settings as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  const last = keys.at(-1)!;
  if (o[last] === value) return;
  o[last] = value;
  save();
  for (const fn of listeners) fn(settings, path);
}

export function getSetting(path: string): unknown {
  let o: unknown = settings;
  for (const k of path.split('.')) o = (o as Record<string, unknown>)?.[k];
  return o;
}

export function resetSettings(section?: keyof Settings): void {
  const fresh = clone(DEFAULT_SETTINGS);
  if (section) (settings as unknown as Record<string, unknown>)[section] = fresh[section];
  else Object.assign(settings, fresh);
  save();
  for (const fn of listeners) fn(settings, section ? `${section}.*` : '*');
}

// ---- key bindings -------------------------------------------------------------------------------------

export function bindingOf(id: string): string {
  return settings.controls.bindings[id] ?? ACTIONS.find((a) => a.id === id)?.key ?? '';
}

/** Normalised key name for a keyboard event (lower-case; ' ' for space). */
export function keyName(e: { key: string }): string {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}

/** Actions sharing a key (Controls tab highlights them). */
export function conflicts(): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const a of ACTIONS) {
    const k = bindingOf(a.id);
    byKey.set(k, [...(byKey.get(k) ?? []), a.id]);
  }
  return new Map([...byKey].filter(([, ids]) => ids.length > 1));
}

/**
 * Translate a key press through the player's remapping: returns the *default* key of the action the
 * pressed key is bound to, so handlers written against default keys keep working. Returns '' for a
 * default key whose action was moved elsewhere. Modifier combos pass through unchanged.
 */
export function remapKey(e: KeyboardEvent): string {
  if (e.ctrlKey || e.metaKey || e.altKey) return e.key;
  const b = settings.controls.bindings;
  if (!Object.keys(b).length) return e.key;
  const k = keyName(e);
  const upper = e.key.length === 1 && e.key !== e.key.toLowerCase();
  const restore = (def: string): string => {
    const d = def === 'backspace' ? 'Backspace' : def === 'delete' ? 'Delete' : def === 'tab' ? 'Tab' : def;
    return upper ? d.toUpperCase() : d;
  };
  for (const a of ACTIONS) if (!a.fixed && b[a.id] === k && a.key !== k) return restore(a.key);
  for (const a of ACTIONS) if (!a.fixed && a.key === k && b[a.id] !== undefined && b[a.id] !== k) return '';
  return e.key;
}

/** Display label for a key name. */
export function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  if (k === 'shift+ ') return 'Shift+Space';
  if (k.length === 1) return k.toUpperCase();
  return k.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join('+');
}

// ---- persistence ----------------------------------------------------------------------------------------

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

/** Merge saved values over defaults, keeping only known keys of the right type. */
function merge<T>(def: T, saved: unknown): T {
  if (typeof def !== 'object' || def === null) return (typeof saved === typeof def ? saved : def) as T;
  if (typeof saved !== 'object' || saved === null) return clone(def);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def as Record<string, unknown>)) {
    const s = (saved as Record<string, unknown>)[k];
    if (k === 'bindings') out[k] = typeof s === 'object' && s ? Object.fromEntries(Object.entries(s).filter(([, x]) => typeof x === 'string')) : {};
    else if (k === 'tier') out[k] = s === 'auto' || s === 4 || s === 8 || s === 12 || s === 16 || s === 32 ? s : v;
    else if (k === 'joltThreads') out[k] = s === 'auto' || (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 16) ? s : v; // U5
    else out[k] = merge(v, s);
  }
  return out as T;
}

function load(): Settings {
  const base = clone(DEFAULT_SETTINGS);
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return merge(base, JSON.parse(raw));
    const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_KEY) : null;
    if (legacy) {
      const l = JSON.parse(legacy) as Partial<{ master: number; music: number; sfx: number; muted: boolean; dark: boolean }>;
      const s = merge(base, { audio: { master: l.master, music: l.music, sfx: l.sfx, muted: l.muted }, graphics: { darkCyc: l.dark } });
      s.multiplayer.nickname = localStorage.getItem('kn.nick') ?? '';
      return s;
    }
    base.multiplayer.nickname = typeof localStorage !== 'undefined' ? localStorage.getItem('kn.nick') ?? '' : '';
    // first launch: the OS "reduce transparency" preference turns the setting on (UI_UX §2)
    base.accessibility.reduceTransparency = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-transparency: reduce)').matches;
    // U4: and the OS "reduce motion" preference turns on Reduced motion (UI_UX §7)
    base.comfort.reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* private mode or corrupt: defaults */ }
  return base;
}

/** Effective depth of field: the Graphics toggle, off with reduced motion (UI_UX §7). Stream L3 reads this. */
export function dofEnabled(s: Settings = settings): boolean {
  return s.graphics.dof && !s.comfort.reducedMotion;
}

/** Tier ids shown in the UI (D85 adds 32, "Max"). */
export const TIER_LABEL: Readonly<Record<number, string>> = { 4: '4 GB', 8: '8 GB', 12: '12 GB', 16: '16 GB', 32: '32 GB' };
export const tierLabel = (t: number | undefined): string => (t ? TIER_LABEL[t] ?? `${t} GB` : '…');

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // the M1 boot path reads the nickname from kn.nick
    if (settings.multiplayer.nickname) localStorage.setItem('kn.nick', settings.multiplayer.nickname);
    else localStorage.removeItem('kn.nick');
  } catch { /* settings last this session */ }
}

/** Apply the DOM-side settings (UI scale, reduced motion, colour preset) to the document root. */
export function applyDocumentSettings(s: Settings = settings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s.accessibility.uiScale));
  root.dataset.reducedMotion = s.comfort.reducedMotion ? '1' : '';
  root.dataset.colours = s.accessibility.colourPreset;
}
