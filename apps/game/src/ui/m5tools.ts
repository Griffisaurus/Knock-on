// M5 Build tools (stream U5): pairing for RIFT GATES and BUZZ ↔ BUZZ BEACON, and GRABBER's zones A and B.
//
// Pairs (stream A5's defs, docs/dev/M5_NOTES_A5.md): every RIFT GATE has a `pair` colour (A5's RIFT_PAIRS); two
// gates of a colour form a pair in part order (1st + 2nd, 3rd + 4th …). A BUZZ pairs with the first free BUZZ
// BEACON (part order) of its own `pair` colour (BEACON_PAIRS). The Inspector shows the colours as named chips with
// how many parts use each, says when a gate has no twin, and Build draws a dashed line between partners (dashes
// and the colour's name, never colour alone). A newly placed gate joins a colour that has an odd count, so two
// placed in a row pair up; a new beacon takes the first free colour, and a new BUZZ the colour of a beacon that has
// no BUZZ yet.
//
// GRABBER (drive.md, A5's def): zones A and B are props in the part's frame: `aYaw` (degrees about +Y from the
// front, +Z), `aReach` (metres from the yaw axis), `aHeight` (above the base), and the same for B. Inspector ›
// Zones › "Point zone A" arms a one-click tool: click (or Enter at the keyboard cursor) where the arm should pick
// from; the point is turned into the three props (snapped to their steps, clamped to reach) and goes out as one
// PartUpdate. UIFIX (D122): clicking a loose part points at where it rests (its centre, its contact height), not its top. Both zones are drawn on the floor (rings with A / B chips) while a GRABBER is selected.

import { posToMetres, type PartRecord, type PropList } from '@knockon/format';
import { BEACON_PAIRS, boundsOf, propSteps, propValues, RIFT_PAIRS, type PartDef } from '@knockon/parts-data';
import { rotationToQuat } from '@knockon/sim';
import { partDef, qinv, qrot, type Q4 } from '../catalog.ts';
import type { SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import { announce } from './a11y.ts';

// ---- pairs -----------------------------------------------------------------------------------------------------

/** Colour per pair name (ART_BIBLE §3.1 tokens, as A5's PAIR_HEX). */
export const PAIR_HEX: Readonly<Record<string, string>> = {
  Plasma: '#FF3DAE', Beam: '#2FD6FF', Amber: '#FFB020', Volt: '#C6F432', Cobalt: '#2E5BFF', Ignition: '#FF5B2E',
};
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export type PairKind = 'rift' | 'buzz';
/** Which pairing a part type takes part in, and the colour names its `pair` prop indexes. */
export function pairKind(type: string): { kind: PairKind; names: readonly string[] } | null {
  if (type === 'rift_gate') return { kind: 'rift', names: RIFT_PAIRS };
  if (type === 'buzz_beacon' || type === 'buzz') return { kind: 'buzz', names: BEACON_PAIRS };
  return null;
}

const pairOf = (p: PartRecord): number => { const d = partDef(p.type); return d && 'pair' in d.props ? Math.round(propValues(d, p.props).pair ?? 0) : -1; };

export interface PairLink { readonly a: number; readonly b: number; readonly colour: number; readonly kind: PairKind }

/** Every pair in the world (rift twins; BUZZ → its beacon), as the sim pairs them (part order = id order). */
export function pairsOf(parts: Iterable<PartRecord>): { links: PairLink[]; lonely: Set<number>; count: Map<string, number> } {
  const byId = [...parts].filter((p) => pairKind(p.type)).sort((a, b) => a.id - b.id);
  const links: PairLink[] = [];
  const lonely = new Set<number>();
  const count = new Map<string, number>();
  for (const p of byId) { const k = `${p.type}:${pairOf(p)}`; count.set(k, (count.get(k) ?? 0) + 1); }
  // rift: 1st + 2nd, 3rd + 4th … per colour
  const open = new Map<number, number>();
  for (const p of byId) {
    if (p.type !== 'rift_gate') continue;
    const c = pairOf(p);
    const o = open.get(c);
    if (o === undefined) open.set(c, p.id);
    else { links.push({ a: o, b: p.id, colour: c, kind: 'rift' }); open.delete(c); }
  }
  for (const id of open.values()) lonely.add(id);
  // BUZZ: the first free beacon of its colour
  const taken = new Set<number>();
  const beacons = byId.filter((p) => p.type === 'buzz_beacon');
  for (const z of byId) {
    if (z.type !== 'buzz') continue;
    const c = pairOf(z);
    const bcn = beacons.find((b) => !taken.has(b.id) && pairOf(b) === c);
    if (bcn) { taken.add(bcn.id); links.push({ a: z.id, b: bcn.id, colour: c, kind: 'buzz' }); } else lonely.add(z.id);
  }
  return { links, lonely, count };
}

/** The `pair` a newly placed part should take so it pairs up at once (see the header), or null to keep the default. */
export function autoPair(type: string, parts: Iterable<PartRecord>): number | null {
  const k = pairKind(type);
  if (!k) return null;
  const list = [...parts];
  const n = (t: string, c: number): number => list.filter((p) => p.type === t && pairOf(p) === c).length;
  const order = [...k.names.keys()];
  if (type === 'rift_gate') {
    const odd = order.find((c) => n('rift_gate', c) % 2 === 1);
    return odd ?? order.find((c) => n('rift_gate', c) === 0) ?? 0;
  }
  if (type === 'buzz_beacon') {
    // the default (Ignition) first, then the others in order
    const def = BEACON_PAIRS.indexOf('Ignition');
    return [def, ...order.filter((c) => c !== def)].find((c) => n('buzz_beacon', c) === 0) ?? def;
  }
  // BUZZ: a beacon colour with fewer BUZZes than beacons
  const want = order.find((c) => n('buzz_beacon', c) > n('buzz', c));
  return want ?? null;
}

/** PropList for a new part with only `pair` set. */
export function pairProps(def: PartDef, pair: number): PropList {
  return [propSteps(def, 'pair', pair) as [number, number]];
}

/** Partner ids of a part (empty when lonely). */
export function partnersOf(id: number, links: readonly PairLink[]): number[] {
  return links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
}

/** Dashed lines between the partners of the selected parts (or all pairs, while `all`). */
export function pairOverlay(out: SceneItem[], parts: ReadonlyMap<number, PartRecord>, selected: readonly number[], all: boolean): void {
  const sel = new Set(selected);
  const any = all || [...sel].some((id) => { const p = parts.get(id); return p && pairKind(p.type); });
  if (!any) return;
  const { links } = pairsOf(parts.values());
  for (const l of links) {
    if (!all && !sel.has(l.a) && !sel.has(l.b)) continue;
    const pa = parts.get(l.a), pb = parts.get(l.b);
    if (!pa || !pb) continue;
    const names = l.kind === 'rift' ? RIFT_PAIRS : BEACON_PAIRS;
    const rgb = hexRgb(PAIR_HEX[names[l.colour] ?? ''] ?? '#EEF1F6');
    dashed(out, anchor(pa), anchor(pb), rgb);
  }
}

/** Where a pair line ends: the gate's aperture centre, the beacon's pad, BUZZ's body. */
function anchor(p: PartRecord): V3 {
  const at = p.type === 'rift_gate' ? [0, 0.205, 0] : p.type === 'buzz_beacon' ? [0, 0.04, 0] : [0, 0.06, 0];
  const w = qrot(rotationToQuat(p.rot) as Q4, at);
  return [posToMetres(p.pos[0]) + w[0], posToMetres(p.pos[1]) + w[1], posToMetres(p.pos[2]) + w[2]];
}

function dashed(out: SceneItem[], a: V3, b: V3, rgb: readonly [number, number, number]): void {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-3) return;
  const n = Math.max(2, Math.round(len / 0.06));
  // a quaternion turning +Z onto d
  const z: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const ax: V3 = [-z[1], z[0], 0];
  const s = Math.hypot(ax[0], ax[1]);
  const ang = Math.acos(Math.max(-1, Math.min(1, z[2])));
  const q: [number, number, number, number] = s < 1e-6 ? (z[2] > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0]) : [ax[0] / s * Math.sin(ang / 2), ax[1] / s * Math.sin(ang / 2), 0, Math.cos(ang / 2)];
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    out.push({ pos: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], rot: q, size: [0.008, 0.008, (len / n) * 0.55], mesh: 0, color: rgb, emissive: 0.9, alpha: 0.95 });
  }
}

// ---- GRABBER zones ----------------------------------------------------------------------------------------------

/** Pick-and-place zone props per part type: [yaw, reach, height] for zone A and B. */
export const ZONE_PROPS: Readonly<Record<string, { readonly a: readonly [string, string, string]; readonly b: readonly [string, string, string] }>> = {
  grabber: { a: ['aYaw', 'aReach', 'aHeight'], b: ['bYaw', 'bReach', 'bHeight'] },
};
export const hasPickPlace = (def: PartDef | undefined): boolean => !!def && !!ZONE_PROPS[def.type] && ZONE_PROPS[def.type]!.a.every((k) => k in def.props);

/** A zone's point in the part's frame (metres) from its props. */
export function zoneLocal(v: Readonly<Record<string, number>>, keys: readonly [string, string, string]): V3 {
  const yaw = ((v[keys[0]] ?? 0) * Math.PI) / 180, r = v[keys[1]] ?? 0.2, y = v[keys[2]] ?? 0;
  return [Math.sin(yaw) * r, y, Math.cos(yaw) * r];
}

/** Props for a zone at a part-frame point: yaw snapped to its step, reach and height clamped to their ranges. Pure. */
export function zoneFromLocal(def: PartDef, keys: readonly [string, string, string], l: readonly number[]): Record<string, number> {
  const [ky, kr, kh] = keys;
  const sy = def.props[ky]!, sr = def.props[kr]!, sh = def.props[kh]!;
  const snap = (spec: { min?: number; max?: number; step?: number }, x: number): number => {
    const min = spec.min ?? 0, max = spec.max ?? 1, step = spec.step ?? 0.01;
    return Number(Math.min(max, Math.max(min, Math.round((x - min) / step) * step + min)).toFixed(6));
  };
  let yaw = (Math.atan2(l[0]!, l[2]!) * 180) / Math.PI;
  yaw = snap(sy, yaw);
  if (yaw === -180 && (sy.max ?? 180) >= 180) yaw = 180;
  return { [ky]: yaw, [kr]: snap(sr, Math.hypot(l[0]!, l[2]!)), [kh]: snap(sh, l[1]!) };
}

/**
 * UIFIX (D122): the world point a zone click means. Clicking a loose (dynamic) part means "pick it up from where it
 * lies": its centre across the floor and its contact point (the bottom of its box, where it rests) for the height, so
 * a STITCH or a BOING is grippable. The surface hit point (a ball's top) put zone A above the ball and the arm closed
 * on air. Anything else (a LEDGE, the floor) is a surface to pick from or put down on: the hit point as it is. Pure.
 */
export function zoneTarget(hit: V3, part: PartRecord | null): V3 {
  const def = part ? partDef(part.type) : undefined;
  if (!part || !def || def.body.kind !== 'dynamic') return hit;
  const b = boundsOf(def, propValues(def, part.props));
  const q = rotationToQuat(part.rot) as Q4;
  const pos: V3 = [posToMetres(part.pos[0]), posToMetres(part.pos[1]), posToMetres(part.pos[2])];
  let minY = Infinity;
  for (let c = 0; c < 8; c++) {
    const w = qrot(q, [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]]);
    minY = Math.min(minY, pos[1] + w[1]);
  }
  const mid = qrot(q, [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2]);
  return [pos[0] + mid[0], minY, pos[2] + mid[2]];
}

export interface GrabHost {
  doc(): { parts: ReadonlyMap<number, PartRecord> } | null;
  submit(op: { k: 'PartUpdate'; id: number; patch: { props: [number, number][] } }): void;
  toast(text: string): void;
  selected(): readonly number[];
}

const BEAM: readonly [number, number, number] = [0.03, 0.67, 1.0];
const AMBER: readonly [number, number, number] = [1.0, 0.69, 0.13];

export class GrabZoneTool {
  /** The part and zone being pointed, or null. */
  editing: { id: number; zone: 'a' | 'b' } | null = null;
  /** Screen labels for the zones drawn this frame (overlays.ts paints the A / B chips). */
  labels: { at: V3; text: string }[] = [];

  constructor(private readonly host: GrabHost) {}

  start(id: number, zone: 'a' | 'b'): void {
    const p = this.host.doc()?.parts.get(id);
    if (!p || !hasPickPlace(partDef(p.type))) return;
    this.editing = { id, zone };
    this.host.toast(`Click where ${partDef(p.type)!.name} should ${zone === 'a' ? 'pick up from (zone A)' : 'put things down (zone B)'} · Enter at the keyboard cursor · Esc cancels`);
  }

  cancel(): boolean { if (!this.editing) return false; this.editing = null; announce('Zone unchanged'); return true; }

  /**
   * A click (or Enter) at a world point while armed. Returns true when it consumed it. UIFIX (D122): `hit` is the part
   * under the cursor, if any (a loose part is pointed at by its contact point, zoneTarget).
   */
  point(w0: V3 | null, hit: PartRecord | null = null): boolean {
    const e = this.editing;
    if (!e || !w0) return false;
    const w = hit && hit.id !== e.id ? zoneTarget(w0, hit) : w0; // UIFIX (D122)
    this.editing = null;
    const p = this.host.doc()?.parts.get(e.id);
    const def = p ? partDef(p.type) : undefined;
    if (!p || !def) return true;
    const keys = ZONE_PROPS[def.type]![e.zone];
    const q = rotationToQuat(p.rot) as Q4;
    const rel = [w[0] - posToMetres(p.pos[0]), w[1] - posToMetres(p.pos[1]), w[2] - posToMetres(p.pos[2])];
    const l = qrot(qinv(q), rel);
    const z = zoneFromLocal(def, keys, l);
    const cur: Record<string, number> = { ...propValues(def, p.props), ...z };
    const list = Object.keys(def.props).map((k) => propSteps(def, k, cur[k]!) as [number, number]);
    this.host.submit({ k: 'PartUpdate', id: p.id, patch: { props: list } });
    const far = Math.hypot(l[0]!, l[2]!) > (def.props[keys[1]]!.max ?? 1) + 0.005;
    this.host.toast(`Zone ${e.zone.toUpperCase()}: ${Math.round(z[keys[0]]!)}°, ${(z[keys[1]]! * 100).toFixed(0)} cm out, ${(z[keys[2]]! * 100).toFixed(0)} cm up${far ? ' (as far as the arm reaches)' : ''}`);
    return true;
  }

  /** Zone rings (and a line from the base) for the selected GRABBERs, or the one being pointed. */
  overlay(out: SceneItem[]): void {
    this.labels = [];
    const doc = this.host.doc();
    if (!doc) return;
    const ids = this.editing ? [this.editing.id] : this.host.selected();
    for (const id of ids) {
      const p = doc.parts.get(id);
      const def = p ? partDef(p.type) : undefined;
      if (!p || !def || !hasPickPlace(def)) continue;
      const v = propValues(def, p.props);
      const q = rotationToQuat(p.rot) as Q4;
      const pos: V3 = [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])];
      for (const zone of ['a', 'b'] as const) {
        const l = zoneLocal(v, ZONE_PROPS[def.type]![zone]);
        const w = qrot(q, l);
        const c: V3 = [pos[0] + w[0], pos[1] + w[1] + 0.003, pos[2] + w[2]];
        const rgb = zone === 'a' ? BEAM : AMBER;
        const hot = this.editing?.zone === zone;
        ring(out, c, Math.max(0.03, (v.grip ?? 0.06) * 0.75), rgb, hot ? 1 : 0.85);
        dashed(out, [pos[0], pos[1] + 0.004, pos[2]], [c[0], c[1], c[2]], rgb);
        this.labels.push({ at: [c[0], c[1] + 0.02, c[2]], text: zone.toUpperCase() });
      }
    }
  }
}

function ring(out: SceneItem[], c: V3, r: number, rgb: readonly [number, number, number], alpha: number): void {
  const n = 16;
  for (let k = 0; k < n; k++) {
    if (k % 2) continue; // dashed
    const a = ((k + 0.5) / n) * Math.PI * 2;
    const q: [number, number, number, number] = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
    out.push({ pos: [c[0] + Math.sin(a) * r, c[1], c[2] + Math.cos(a) * r], rot: q, size: [(2 * Math.PI * r) / n, 0.004, 0.006], mesh: 0, color: rgb, emissive: 0.9, alpha });
  }
}
