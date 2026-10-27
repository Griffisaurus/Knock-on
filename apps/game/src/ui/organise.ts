// Organisation rules shared by the Outliner, layers, Inspector and picking (GAME_SPEC §7.4):
// visibility and editability from part flags + layers, small-id allocation, and op builders.

import type { WorldDoc } from '@knockon/docstore';
import { LayerFlag, PartFlag, nextSmallId, type LayerRecord, type Op, type PartId, type PartRecord } from '@knockon/format';
import { invert, transform, type V3 } from '../math.ts';

export const DEFAULT_LAYER_NAME = 'Default';

export function layerOf(doc: WorldDoc, p: PartRecord): LayerRecord | undefined {
  return p.layer ? doc.layers.get(p.layer) : undefined;
}

/** Drawn and pickable in build mode: the part isn't hidden and neither is its layer. */
export function partVisible(doc: WorldDoc, p: PartRecord): boolean {
  if (p.flags & PartFlag.Hidden) return false;
  const l = layerOf(doc, p);
  return !l || !(l.flags & LayerFlag.Hidden);
}

/** Editable: the part isn't locked and neither is its layer. */
export function partEditable(doc: WorldDoc, p: PartRecord): boolean {
  if (p.flags & PartFlag.Locked) return false;
  const l = layerOf(doc, p);
  return !l || !(l.flags & LayerFlag.Locked);
}

/** Why a part can't be edited, for a toast; null when it can. */
export function lockedReason(doc: WorldDoc, p: PartRecord): string | null {
  if (p.flags & PartFlag.Locked) return 'That part is locked (unlock it in the Outliner)';
  const l = layerOf(doc, p);
  if (l && l.flags & LayerFlag.Locked) return `Layer “${l.name}” is locked`;
  return null;
}

/** Monotonic small-id allocator per map, so undo/redo never reuses an id we handed out this session. */
export class SmallIds {
  private readonly high = new Map<string, number>();
  next(kind: 'layer' | 'group' | 'module', slot: number, inUse: Iterable<number>): number {
    const id = nextSmallId(slot, inUse, this.high.get(kind) ?? 0);
    this.high.set(kind, id);
    return id;
  }
}

/** Toggle a flag bit on many parts as one undoable op. */
export function flagOp(doc: WorldDoc, ids: readonly PartId[], bit: number, on: boolean): Op | null {
  const ops: Op[] = [];
  for (const id of ids) {
    const p = doc.parts.get(id);
    if (!p) continue;
    const flags = on ? p.flags | bit : p.flags & ~bit;
    if (flags !== p.flags) ops.push({ k: 'PartUpdate', id, patch: { flags } });
  }
  return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { k: 'Batch', ops };
}

/** Move parts to a layer (0 = default) as one undoable op. */
export function layerOp(doc: WorldDoc, ids: readonly PartId[], layer: number): Op | null {
  const ops: Op[] = [];
  for (const id of ids) {
    const p = doc.parts.get(id);
    if (p && (p.layer ?? 0) !== layer) ops.push({ k: 'PartUpdate', id, patch: { layer } });
  }
  return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { k: 'Batch', ops };
}

/** Members of a group (parts whose `group` is it), in id order. */
export function groupMembers(doc: WorldDoc, group: number): PartId[] {
  const out: PartId[] = [];
  for (const p of doc.parts.values()) if (p.group === group) out.push(p.id);
  return out.sort((a, b) => a - b);
}

/** All descendant groups of `group` (inclusive). */
export function groupSubtree(doc: WorldDoc, group: number): Set<number> {
  const out = new Set([group]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of doc.groups.values()) if (!out.has(g.id) && out.has(g.parent)) { out.add(g.id); grew = true; }
  }
  return out;
}

// ---- screen-space helpers -----------------------------------------------------------------------------

export interface Ray { readonly o: V3; readonly d: V3 }

/** World-space ray through a canvas pixel (same maths as main.ts picking). */
export function rayAt(viewProj: Float32Array, canvas: HTMLCanvasElement, x: number, y: number): Ray {
  const ndcX = (x / canvas.clientWidth) * 2 - 1;
  const ndcY = 1 - (y / canvas.clientHeight) * 2;
  const inv = invert(viewProj);
  const a = transform(inv, [ndcX, ndcY, 0]);
  const b = transform(inv, [ndcX, ndcY, 1]);
  const o: V3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
  const f: V3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  return { o, d: [f[0] - o[0], f[1] - o[1], f[2] - o[2]] };
}

/** Canvas pixel of a world point, or null behind the camera. */
export function toScreen(viewProj: Float32Array, canvas: HTMLCanvasElement, p: V3): [number, number] | null {
  const c = transform(viewProj, p);
  if (c[3] <= 0) return null;
  return [((c[0] / c[3]) * 0.5 + 0.5) * canvas.clientWidth, (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * canvas.clientHeight];
}

/** Ray ∩ horizontal plane y = h (forward hits only). */
export function rayPlaneY(r: Ray, h: number): V3 | null {
  if (Math.abs(r.d[1]) < 1e-9) return null;
  const t = (h - r.o[1]) / r.d[1];
  if (t <= 0) return null;
  return [r.o[0] + r.d[0] * t, h, r.o[2] + r.d[2] * t];
}

/** Parameter along the line p + s·axis closest to the ray (for dragging a handle along an axis). */
export function closestOnAxis(r: Ray, p: V3, axis: V3): number {
  // minimise |(p + s·a) − (o + t·d)|
  const w: V3 = [p[0] - r.o[0], p[1] - r.o[1], p[2] - r.o[2]];
  const a = axis, d = r.d;
  const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const ad = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  const aw = a[0] * w[0] + a[1] * w[1] + a[2] * w[2];
  const dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
  const den = aa * dd - ad * ad;
  if (Math.abs(den) < 1e-12) return 0;
  return (ad * dw - dd * aw) / den;
}
