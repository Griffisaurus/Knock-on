// Keyboard building (M4 stream U4; GAME_SPEC §20 "Full keyboard building", UI_UX §7 "Keyboard building
// aids", Settings › Accessibility › Keyboard building aids, on by default).
//
// With the aids on, everything a mouse does in Build has a key:
//   • a keyboard cursor in the world: the arrow keys move it by the snap step (10 cm; Ctrl = 2.5 cm),
//     relative to the camera (↑ is "away from me"), PageUp / PageDown raise and lower the work plane;
//     main.ts aims its usual picking through the cursor, so the placement ghost, snapping, blocked tints
//     and port glows all work as with the mouse. Moving the mouse over the view hands control back.
//   • Enter places the armed part (Place), picks up / puts down the part under the cursor (Select: while
//     a part is picked up the arrows move it, PageUp / PageDown lift it), and starts / finishes a wire
//     (Wire, where [ / ] jump the cursor from port to port, nearest first).
//   • Shift + arrows orbit and tilt the camera, = / − zoom (in Build), F frames the selection.
//   • Hold-to-act keys become toggles: Q opens the radial menu (arrows choose, Enter confirms, Esc or Q
//     closes) instead of hold-and-point. UIFIX (D122): only while the keyboard cursor is on or the pointer
//     is off the view; with the mouse over the view Q is hold, point, let go at the pointer (a quick tap
//     still leaves it open for the arrows).
// Everything said on screen is also announced to screen readers (ui/a11y.ts).
//
// main.ts creates it after BuildTools and calls `keydown` first in its key handler and `frame` before
// its per-frame pick; the cursor works by steering main.ts's pointer to the cursor's screen position.

import { metresToPos } from '@knockon/format';
import type { V3 } from '../math.ts';
import { transform } from '../math.ts';
import { announce, focusIsWorld } from './a11y.ts';
import type { Radial } from './panels.ts';
import { settings } from './settings.ts';

export type BuildTool = 'place' | 'select' | 'wire' | 'path';
export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * World step for an arrow key, relative to a camera at `yaw` (main.ts's orbit: the eye sits at
 * target + dist·(sin yaw, ·, cos yaw)), snapped to the nearest world axis so the cursor stays on the grid.
 */
export function arrowStep(key: ArrowKey, yaw: number, step: number): V3 {
  // "away from the camera" on the ground, and "to the right"
  const fwd: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
  const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
  const v: [number, number] = key === 'ArrowUp' ? fwd : key === 'ArrowDown' ? [-fwd[0], -fwd[1]] : key === 'ArrowRight' ? right : [-right[0], -right[1]];
  return Math.abs(v[0]) >= Math.abs(v[1]) ? [Math.sign(v[0]) * step, 0, 0] : [0, 0, Math.sign(v[1]) * step];
}

/** Snap a world coordinate to the step grid. */
export const snapTo = (x: number, step: number): number => Math.round(x / step) * step;

export interface PortInfo { readonly part: number; readonly index: number; readonly world: V3; readonly channel: string; readonly dir: string; readonly label: string }

/** Ports ordered nearest-first from a point (port cycling in the Wire tool). */
export function portsByDistance(ports: readonly PortInfo[], from: V3): PortInfo[] {
  const d2 = (p: PortInfo): number => (p.world[0]! - from[0]!) ** 2 + (p.world[1]! - from[1]!) ** 2 + (p.world[2]! - from[2]!) ** 2;
  return [...ports].sort((a, b) => d2(a) - d2(b) || a.part - b.part || a.index - b.index);
}

export interface KeyboardHost {
  readonly canvas: HTMLCanvasElement;
  /** main.ts's pointer: the cursor steers it while active. */
  readonly pointer: { x: number; y: number; inside: boolean };
  readonly cam: { yaw: number; pitch: number; dist: number; target: V3 };
  readonly radial: Radial;
  viewProj(): Float32Array;
  phase(): string;
  tool(): BuildTool;
  /** Ghost / selection label under the cursor, for the announcer ("PLANK", "the floor"). */
  hoverLabel(): string;
  workY(): number;
  setWorkY(y: number): void;
  /** Selected part ids (editable ones). */
  selection(): number[];
  /** A part's position in metres. */
  partPos(id: number): V3 | null;
  /** Move parts by a world offset (metres); main.ts submits the PartUpdates. */
  nudge(ids: readonly number[], d: V3): void;
  /** A left click at the cursor, through main.ts's usual click path. */
  click(): void;
  /** Parts in the world (to tell whether a placement happened). */
  partCount(): number;
  /** Name of the armed part ("THUD"). */
  placingLabel(): string;
  /** Clear the selection (Select tool: put down). */
  deselect(): void;
  /** Every port in the build, with its world position (Wire tool cycling). */
  ports(): PortInfo[];
  /** Every editable part with its position and name (Select tool cycling). */
  parts(): { id: number; world: V3; label: string }[];
  /** Select one part (Select tool). */
  select(id: number): void;
  /** Open the radial menu at a screen point in the canvas (main.ts's slots for the part under the cursor). */
  openRadial(x: number, y: number): void;
  frameSelection(): void;
  toast(text: string): void;
}

export class KeyboardBuild {
  /** The cursor in world space (metres), or null when the mouse has control. */
  cursor: V3 | null = null;
  private portCycle: { list: PortInfo[]; i: number } | null = null;
  private lastLabel = '';
  private lastMouse = { x: 0, y: 0 };

  constructor(private readonly host: KeyboardHost) {
    // the mouse takes over again as soon as it moves over the view
    host.canvas.addEventListener('pointermove', (e) => {
      if (!this.cursor) return;
      if (Math.hypot(e.clientX - this.lastMouse.x, e.clientY - this.lastMouse.y) < 3) return;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.release('mouse');
    });
    host.canvas.addEventListener('pointerdown', () => { if (this.cursor) this.release('mouse'); });
  }

  get active(): boolean { return this.cursor !== null; }
  /** The cursor's screen position in the canvas (valid while active). */
  get screen(): { readonly x: number; readonly y: number } { return this.host.pointer; }
  private get on(): boolean { return settings.accessibility.keyboardAids; }

  /** Hint for the tool badge while the cursor is active. */
  hint(): string {
    if (!this.cursor) return '';
    const t = this.host.tool();
    if (t === 'wire') return '[ ] next port · Enter connect';
    if (t === 'select') return this.host.selection().length ? 'arrows move · Enter put down' : '[ ] next part · Enter pick up';
    if (t === 'path') return 'Enter add point';
    return 'arrows move · Enter place · R rotate';
  }

  private release(_why: 'mouse' | 'tool'): void {
    this.cursor = null;
    this.portCycle = null;
    this.lastLabel = '';
  }

  /** Before main.ts's per-frame pick: aim its pointer at the cursor's screen position. */
  frame(): void {
    if (!this.cursor) return;
    if (this.host.phase() !== 'build') { this.release('tool'); return; }
    const c = transform(this.host.viewProj(), this.cursor);
    if (c[3] <= 0) return;
    const w = this.host.canvas.clientWidth, h = this.host.canvas.clientHeight;
    const x = ((c[0] / c[3]) * 0.5 + 0.5) * w, y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * h;
    this.host.pointer.x = Math.max(0, Math.min(w - 1, x));
    this.host.pointer.y = Math.max(0, Math.min(h - 1, y));
    this.host.pointer.inside = true;
    const label = this.host.hoverLabel();
    if (label !== this.lastLabel) { this.lastLabel = label; if (label) announce(label); }
  }

  /** Screen point of the cursor in the canvas (radial menu), or the canvas centre. */
  private screenPoint(): [number, number] {
    if (this.cursor) return [this.host.pointer.x, this.host.pointer.y];
    return [this.host.canvas.clientWidth / 2, this.host.canvas.clientHeight / 2];
  }

  private start(): V3 {
    if (!this.cursor) {
      const t = this.host.cam.target;
      this.cursor = [snapTo(t[0], 0.1), this.host.workY(), snapTo(t[2], 0.1)];
      announce('Keyboard cursor on. Arrows move it; Enter acts; move the mouse to hand back.');
    }
    return this.cursor;
  }

  /**
   * Keys first (main.ts calls this before its own). `k` is the remapped key (default names). Returns true
   * when it consumed the key.
   */
  keydown(e: KeyboardEvent, k: string): boolean {
    const r = this.host.radial;
    // sticky radial (works whenever it was opened from the keyboard)
    if (r.open && r.sticky) {
      if (k === 'ArrowRight' || k === 'ArrowDown') { r.step(1); e.preventDefault(); return true; }
      if (k === 'ArrowLeft' || k === 'ArrowUp') { r.step(-1); e.preventDefault(); return true; }
      if (k === 'Enter' || k === ' ') { r.release(); e.preventDefault(); return true; }
      if (k === 'Escape' || k === 'q' || k === 'Q') { r.cancel(); e.preventDefault(); return true; }
      return true; // nothing else while the menu is up
    }
    if (!this.on || this.host.phase() !== 'build' || !focusIsWorld() || e.altKey || e.metaKey) return false;
    const tool = this.host.tool();
    const isArrow = k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';
    // camera: Shift + arrows orbit / tilt, = and − zoom
    if (isArrow && e.shiftKey) {
      const cam = this.host.cam;
      if (k === 'ArrowLeft' || k === 'ArrowRight') cam.yaw += (k === 'ArrowLeft' ? 1 : -1) * (Math.PI / 12);
      else cam.pitch = Math.min(1.5, Math.max(0.05, cam.pitch + (k === 'ArrowUp' ? 0.087 : -0.087)));
      e.preventDefault();
      return true;
    }
    if ((k === '=' || k === '+' || k === '-') && !e.ctrlKey) {
      const cam = this.host.cam;
      cam.dist = Math.min(400, Math.max(0.3, cam.dist * (k === '-' ? 1.15 : 1 / 1.15)));
      e.preventDefault();
      return true;
    }
    if ((k === 'q' || k === 'Q') && !e.repeat && !e.ctrlKey) {
      // UIFIX (D122): the mouse is in use (no keyboard cursor, pointer over the view): hold Q, point, let go, at the
      // pointer. main.ts's key-up runs the wedge, or keeps the menu open after a quick tap (Radial.keyUp).
      if (!this.cursor && this.host.pointer.inside) {
        this.host.openRadial(this.host.pointer.x, this.host.pointer.y);
        e.preventDefault();
        return true;
      }
      const [x, y] = this.screenPoint();
      this.host.openRadial(x, y);
      if (r.open) { r.sticky = true; r.step(0); announce('Radial menu: arrows choose, Enter confirms, Escape closes.'); }
      e.preventDefault();
      return true;
    }
    const step = e.ctrlKey ? 0.025 : 0.1;
    const sel = tool === 'select' ? this.host.selection() : [];
    if (isArrow) {
      const d = arrowStep(k as ArrowKey, this.host.cam.yaw, step);
      if (sel.length) {
        this.host.nudge(sel, d);
        const p = this.host.partPos(sel[0]!);
        if (p) this.cursor = [p[0] + d[0], p[1], p[2] + d[2]];
      } else {
        const c = this.start();
        this.cursor = [snapTo(c[0] + d[0], step), c[1], snapTo(c[2] + d[2], step)];
        this.portCycle = null;
        this.partCycle = null;
      }
      e.preventDefault();
      return true;
    }
    if (k === 'PageUp' || k === 'PageDown') {
      const dy = (k === 'PageUp' ? 1 : -1) * step;
      if (sel.length) this.host.nudge(sel, [0, dy, 0]);
      else {
        const y = Math.max(0, Math.min(20, Math.round((this.host.workY() + dy) * 1000) / 1000));
        this.host.setWorkY(y);
        const c = this.start();
        this.cursor = [c[0], y, c[2]];
        announce(`Work plane ${y.toFixed(2)} m`);
      }
      e.preventDefault();
      return true;
    }
    if (tool === 'wire' && (k === '[' || k === ']')) {
      this.cyclePort(k === ']' ? 1 : -1);
      e.preventDefault();
      return true;
    }
    if (tool === 'select' && (k === '[' || k === ']')) {
      this.cyclePart(k === ']' ? 1 : -1);
      e.preventDefault();
      return true;
    }
    if (k === 'Enter' && tool !== 'path') {
      if (!this.cursor) {
        // Enter without a cursor: turn it on where the camera looks (nothing is placed blind)
        this.start();
        e.preventDefault();
        return true;
      }
      if (tool === 'select' && sel.length) { this.host.deselect(); this.partCycle = null; announce('Put down'); e.preventDefault(); return true; }
      const before = this.host.partCount();
      this.host.click();
      if (tool === 'place' && this.host.partCount() > before) announce(`Placed ${this.host.placingLabel()}`);
      if (tool === 'select') { const s = this.host.selection(); announce(s.length ? `Picked up ${this.host.hoverLabel()}. Arrows move it, Enter puts it down.` : 'Nothing to pick up here'); }
      e.preventDefault();
      return true;
    }
    if (k === 'Enter' && tool === 'path' && this.cursor && !e.repeat) {
      // add a point at the cursor; main.ts's Enter (no cursor move since the last point) finishes the path
      if (this.lastPathPoint && this.lastPathPoint.every((v, i) => Math.abs(v - this.cursor![i]!) < 1e-6)) { this.lastPathPoint = null; return false; }
      this.lastPathPoint = [...this.cursor] as V3;
      this.host.click();
      announce('Point added. Move and press Enter for the next; Enter again in place to finish.');
      e.preventDefault();
      return true;
    }
    if ((k === 'f' || k === 'F') && !e.ctrlKey) { this.host.frameSelection(); return true; }
    return false;
  }
  private lastPathPoint: V3 | null = null;

  /** Select tool: pick up the next / previous part, nearest first from where the cycle began. */
  private cyclePart(dir: number): void {
    if (!this.partCycle) {
      const from = this.cursor ?? this.host.cam.target;
      const list = portsByDistance(this.host.parts().map((p) => ({ part: p.id, index: 0, world: p.world, channel: '', dir: '', label: p.label })), from);
      if (!list.length) { this.host.toast('Nothing to select yet'); return; }
      this.partCycle = { list, i: dir > 0 ? -1 : 0 };
    }
    const c = this.partCycle;
    c.i = (c.i + dir + c.list.length) % c.list.length;
    const p = c.list[c.i]!;
    this.cursor = [...p.world] as V3;
    this.host.select(p.part);
    announce(`Picked up ${p.label} (${c.i + 1} of ${c.list.length}). Arrows move it, Enter puts it down.`);
  }
  private partCycle: { list: PortInfo[]; i: number } | null = null;

  /** Wire tool: jump the cursor to the next / previous port, nearest first from where the cycle began. */
  private cyclePort(dir: number): void {
    if (!this.portCycle) {
      const from = this.cursor ?? this.host.cam.target;
      const list = portsByDistance(this.host.ports(), from);
      if (!list.length) { this.host.toast('No ports to connect yet'); return; }
      this.portCycle = { list, i: dir > 0 ? -1 : 0 };
    }
    const c = this.portCycle;
    c.i = (c.i + dir + c.list.length) % c.list.length;
    const p = c.list[c.i]!;
    this.cursor = [...p.world] as V3;
    announce(`${p.label} (${c.i + 1} of ${c.list.length})`);
  }
}

/** Metres → format position units, for main.ts's nudge. */
export const toPos = (m: number): number => metresToPos(m);
