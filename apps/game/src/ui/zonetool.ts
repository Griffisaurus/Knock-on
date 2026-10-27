// DUSTY's patrol zone (M4 stream U4 with stream B4; GAME_SPEC §11 "Roams a bounded zone"): a Build tool to draw
// the zone on the floor, and its outline in the world.
//
// B4's sim reads the zone from the part's props (packages/sim/src/critters/m4.ts `onBuild`): `zone_w` / `zone_d`
// (full size, metres) and `zone_x` / `zone_z` (the centre's offset in the part's own frame, so the zone turns with
// the part). Inspector › Patrol zone › Draw zone arms this tool: drag a rectangle on the work plane (or, with the
// keyboard cursor, Enter at one corner and Enter at the other); the corners are taken into DUSTY's frame and the
// four props go out as one PartUpdate (undoable). Esc cancels. While a part with a zone is selected, or the tool
// is armed, the zone is drawn as a mint outline on the floor (the Lure / Air family colour, plus its own dashes).

import { posToMetres, type PartRecord } from '@knockon/format';
import { propSteps, propValues, type PartDef } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qrot, type Q4 } from '../catalog.ts';
import type { SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import { announce } from './a11y.ts';

export const ZONE_KEYS = ['zone_x', 'zone_z', 'zone_w', 'zone_d'] as const;

/** Does this part type have a patrol zone (B4 defines the props)? */
export const hasZone = (def: PartDef | undefined): boolean => !!def && 'zone_w' in def.props && 'zone_d' in def.props;

/** The part's heading as the sim reads it (critters/m4.ts yawOf: its forward axis, atan2(x, z)). */
const yawOf = (p: PartRecord): number => { const f = qrot(rotationToQuat(p.rot) as Q4, [0, 0, 1]); return Math.atan2(f[0], f[2]); };

/** World → the part's frame (x, z), and back (yaw about +Y, as the sim's `yawQ`). */
export function toLocal(p: { pos: readonly number[] }, yaw: number, w: readonly number[]): [number, number] {
  const dx = w[0]! - p.pos[0]!, dz = w[2]! - p.pos[2]!;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c * dx - s * dz, s * dx + c * dz];
}
export function toWorld(p: { pos: readonly number[] }, yaw: number, l: readonly [number, number]): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [p.pos[0]! + c * l[0] + s * l[1], p.pos[2]! - s * l[0] + c * l[1]];
}

/** Zone props from two world corners (metres), in the part's frame; sizes at least `min`. */
export function zoneFromCorners(partPos: readonly number[], yaw: number, a: readonly number[], b: readonly number[], min = 0.4): Record<(typeof ZONE_KEYS)[number], number> {
  const la = toLocal({ pos: partPos }, yaw, a), lb = toLocal({ pos: partPos }, yaw, b);
  return {
    zone_x: (la[0] + lb[0]) / 2, zone_z: (la[1] + lb[1]) / 2,
    zone_w: Math.max(min, Math.abs(la[0] - lb[0])), zone_d: Math.max(min, Math.abs(la[1] - lb[1])),
  };
}

export interface ZoneHost {
  doc(): { parts: ReadonlyMap<number, PartRecord> } | null;
  submit(op: { k: 'PartUpdate'; id: number; patch: { props: [number, number][] } }): void;
  toast(text: string, level?: 'info' | 'warn'): void;
  selected(): readonly number[];
  workY(): number;
}

const MINT: readonly [number, number, number] = [0.33, 0.78, 0.68];

export class ZoneTool {
  /** The part whose zone is being drawn, or null. */
  editing: number | null = null;
  private a: V3 | null = null;
  private b: V3 | null = null;
  private dragging = false;

  constructor(private readonly host: ZoneHost) {}

  start(id: number): void {
    const p = this.host.doc()?.parts.get(id);
    if (!p || !hasZone(partDef(p.type))) return;
    this.editing = id; this.a = null; this.b = null; this.dragging = false;
    const name = partDef(p.type)?.name ?? 'DUSTY';
    this.host.toast(`Drag on the floor to draw ${name}’s patrol zone (or Enter at two corners) · Esc cancels`);
  }

  cancel(): void {
    if (this.editing === null) return;
    this.editing = null; this.a = null; this.b = null; this.dragging = false;
    announce('Patrol zone unchanged');
  }

  /** Pointer on the ground (world point on the work plane) while armed. Returns true when it consumed the event. */
  down(pt: V3 | null): boolean {
    if (this.editing === null || !pt) return false;
    this.a = pt; this.b = pt; this.dragging = true;
    return true;
  }
  move(pt: V3 | null): void { if (this.dragging && pt) this.b = pt; }
  up(pt: V3 | null): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (pt) this.b = pt;
    if (this.a && this.b && Math.hypot(this.a[0] - this.b[0], this.a[2] - this.b[2]) > 0.05) this.commit(this.a, this.b);
  }

  /** Keyboard: Enter at the cursor sets the first corner, then the second (and commits). */
  point(pt: V3): void {
    if (this.editing === null) return;
    if (!this.a) { this.a = pt; this.b = pt; announce('First corner set. Move the cursor and press Enter at the opposite corner.'); return; }
    this.commit(this.a, pt);
  }

  private commit(a: V3, b: V3): void {
    const id = this.editing;
    const p = id !== null ? this.host.doc()?.parts.get(id) : undefined;
    const def = p ? partDef(p.type) : undefined;
    this.editing = null; this.a = null; this.b = null;
    if (!p || !def) return;
    const pos = [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
    const z = zoneFromCorners(pos, yawOf(p), a, b);
    const cur: Record<string, number> = { ...propValues(def, p.props) };
    for (const k of ZONE_KEYS) {
      const spec = def.props[k];
      if (!spec) continue;
      cur[k] = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, z[k]));
    }
    const list = Object.keys(def.props).map((k) => propSteps(def, k, cur[k]!) as [number, number]);
    this.host.submit({ k: 'PartUpdate', id: p.id, patch: { props: list } });
    const text = `Patrol zone ${cur.zone_w!.toFixed(1)} × ${cur.zone_d!.toFixed(1)} m`;
    this.host.toast(text);
  }

  /** World corners of a part's zone (metres, on the floor). */
  corners(p: PartRecord): [number, number][] | null {
    const def = partDef(p.type);
    if (!hasZone(def)) return null;
    const v = propValues(def!, p.props) as Record<string, number>;
    const pos = [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
    const yaw = yawOf(p);
    const hw = Math.max(0.2, (v.zone_w ?? 2) / 2), hd = Math.max(0.2, (v.zone_d ?? 2) / 2), cx = v.zone_x ?? 0, cz = v.zone_z ?? 0;
    return [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]].map((l) => toWorld({ pos }, yaw, l as [number, number]));
  }

  /** Outline the zones of the selected zone parts (all of them while drawing) and the rectangle being dragged. */
  overlay(out: SceneItem[]): void {
    const doc = this.host.doc();
    if (!doc) return;
    const ids = this.editing !== null ? [...doc.parts.keys()] : this.host.selected();
    const y = 0.004;
    for (const id of ids) {
      const p = doc.parts.get(id);
      if (!p || (this.editing !== null && id !== this.editing && !hasZone(partDef(p.type)))) continue;
      const c = this.corners(p);
      if (!c) continue;
      const py = posToMetres(p.pos[1]);
      this.outline(out, c, Math.max(this.host.workY(), Math.min(py, 0.05)) + y, id === this.editing ? 0.35 : 0.6);
    }
    if (this.a && this.b && this.editing !== null) {
      const p = doc.parts.get(this.editing);
      if (p) {
        const pos = [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
        const yaw = yawOf(p);
        const la = toLocal({ pos }, yaw, this.a), lb = toLocal({ pos }, yaw, this.b);
        const quad = [[la[0], la[1]], [lb[0], la[1]], [lb[0], lb[1]], [la[0], lb[1]]].map((l) => toWorld({ pos }, yaw, l as [number, number]));
        this.outline(out, quad, this.a[1] + y + 0.002, 0.95);
      }
    }
  }

  private outline(out: SceneItem[], c: [number, number][], y: number, alpha: number): void {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i]!, [x1, z1] = c[(i + 1) % 4]!;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-3) continue;
      // dashes, so the outline doesn't rely on colour alone
      const n = Math.max(1, Math.round(len / 0.12));
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const q: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.25) / n, t2 = (k + 0.75) / n;
        const mx = x0 + (x1 - x0) * (t + t2) / 2, mz = z0 + (z1 - z0) * (t + t2) / 2;
        out.push({ pos: [mx, y, mz], rot: q, size: [0.012, 0.004, (len / n) * 0.55], mesh: 0, color: MINT, emissive: 0.6, alpha });
      }
    }
  }
}
