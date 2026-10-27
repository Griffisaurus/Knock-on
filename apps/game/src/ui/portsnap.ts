// Port snapping (stream BUILDUX, D124; GAME_SPEC §7.2 rule 1, UI_UX §5.1 step 2).
//
// While a part is placed (the placement ghost), dragged (drag-to-move) or carried (a paste ghost), a port of the moved
// part that comes within PORT_SNAP_M (0.5 cells = 5 cm) of a COMPATIBLE port on a part that isn't moving pulls the
// whole move so the two ports meet. Compatible = the same channel; Signal and Power also need an output and an input
// (or a "both" port); neither port may be full (maxLinks). Compatible ports within PORT_GLOW_M glow in their channel
// colour, and the port it snapped to gets a bright marker. Alt (free placement) switches it off for that move, and so
// does Settings › Controls › "Snap to ports" (on by default).
//
// "Snap to align": most ports sit a few millimetres inside a face of their part (a socket, a hook), so two ports made to
// coincide would leave the parts overlapping. When the coincident snap overlaps the part it snapped to and that part's
// port is on a face, the move is pushed back along that face's normal until the two parts just touch (`matePush`): the
// ports line up across the contact, face to face. A snap is only taken when the result isn't blocked (unless the
// unsnapped drop already was). The grid stays the base; the snap is a nudge of at most a few cm on top of it. The
// gizmo's arrows and squares don't snap to ports (they are the precise, axis-locked tool).
//
// Pure pieces (PortIndex, findSnap, portsCompatible) are unit-tested in test/buildux.test.ts.

import type { WorldDoc } from '@knockon/docstore';
import type { LinkRecord, PartRecord } from '@knockon/format';
import { propValues, type Channel, type PartDef, type Props } from '@knockon/parts-data';
import { CHANNEL_RGB, partDef, qrot } from '../catalog.ts';
import type { SceneItem } from '../gfx/renderer.ts';
import type { V3 } from '../math.ts';
import { compose, partPose, type Pose } from '../scene.ts';
import { partBox, worldBox, type Box, type MoveSession, type MoveXf } from './dragmove.ts';
import { settings } from './settings.ts';

/** Magnetic radius: 0.5 cells (GAME_SPEC §7.2 rule 1). */
export const PORT_SNAP_M = 0.05;
/** Compatible ports this close to a moved port glow. */
export const PORT_GLOW_M = 0.3;
/** Moves of more parts than this don't port-snap (a big paste is placed by the grid). */
export const PORT_SNAP_MAX_PARTS = 64;

export interface SnapPort {
  readonly world: V3;
  readonly channel: Channel;
  readonly dir: 'in' | 'out' | 'both';
  readonly part: number;
  readonly index: number;
  /** Below its maxLinks. */
  readonly free: boolean;
  /** World normal of the face of its part the port sits on (null: a port deep inside the part). */
  readonly normal: V3 | null;
}

/** A port this close to a face of its part's bounds (m) is on that face. */
export const FACE_PORT_M = 0.012;

/** The local normal of the bounds face a port sits on (within FACE_PORT_M), or null. */
export function portFaceNormal(bounds: { readonly min: readonly number[]; readonly max: readonly number[] }, at: readonly number[]): V3 | null {
  let best = FACE_PORT_M + 1e-9, n: V3 | null = null;
  for (let i = 0; i < 3; i++) {
    const hi = bounds.max[i]! - at[i]!, lo = at[i]! - bounds.min[i]!;
    if (hi < best) { best = hi; n = [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]; }
    if (lo < best) { best = lo; n = [i === 0 ? -1 : 0, i === 1 ? -1 : 0, i === 2 ? -1 : 0]; }
  }
  return n;
}

/**
 * The extra move that takes `mover` out of `target` along the face normal `n` (its dominant world axis) so the two
 * boxes just touch, or null when they don't overlap on that axis.
 */
export function matePush(mover: { readonly min: V3; readonly max: V3 }, target: { readonly min: V3; readonly max: V3 }, n: V3): V3 | null {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]!) > Math.abs(n[k]!)) k = i;
  const push = n[k]! > 0 ? target.max[k]! - mover.min[k]! : target.min[k]! - mover.max[k]!;
  if (n[k]! > 0 ? push <= 0 : push >= 0) return null;
  const out: V3 = [0, 0, 0];
  out[k] = push;
  return out;
}

export interface PortSnap { readonly from: SnapPort; readonly to: SnapPort; readonly delta: V3; readonly dist: number }

/** Can these two ports be joined (the Wire tool's rules: same channel, output to input for Signal and Power, not full)? */
export function portsCompatible(a: SnapPort, b: SnapPort): boolean {
  if (a.part === b.part || a.channel !== b.channel || !a.free || !b.free) return false;
  if (a.channel === 'signal' || a.channel === 'power') return a.dir === 'both' || b.dir === 'both' || a.dir !== b.dir;
  return true;
}

/** A uniform grid over port positions (cell = 10 cm), so a per-frame search stays cheap on big worlds. */
export class PortIndex {
  private readonly cells = new Map<string, SnapPort[]>();
  private n = 0;
  constructor(ports: Iterable<SnapPort>, readonly cell = 0.1) {
    for (const p of ports) {
      const k = this.key(Math.floor(p.world[0] / cell), Math.floor(p.world[1] / cell), Math.floor(p.world[2] / cell));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(p);
      this.n++;
    }
  }
  get size(): number { return this.n; }
  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  /** Ports within `r` of `p`. */
  near(p: V3, r: number, out: SnapPort[] = []): SnapPort[] {
    const c = this.cell;
    const x0 = Math.floor((p[0] - r) / c), x1 = Math.floor((p[0] + r) / c);
    const y0 = Math.floor((p[1] - r) / c), y1 = Math.floor((p[1] + r) / c);
    const z0 = Math.floor((p[2] - r) / c), z1 = Math.floor((p[2] + r) / c);
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const list = this.cells.get(this.key(x, y, z));
      if (!list) continue;
      for (const q of list) {
        const dx = q.world[0] - p[0], dy = q.world[1] - p[1], dz = q.world[2] - p[2];
        if (dx * dx + dy * dy + dz * dz <= r2) out.push(q);
      }
    }
    return out;
  }
}

/** The closest compatible pair (moved port → fixed port) within `radius`, or null. Ties go to the earlier moved port. */
export function findSnap(moving: readonly SnapPort[], index: PortIndex, radius = PORT_SNAP_M): PortSnap | null {
  let best: PortSnap | null = null;
  const tmp: SnapPort[] = [];
  for (const m of moving) {
    tmp.length = 0;
    for (const q of index.near(m.world, radius, tmp)) {
      if (!portsCompatible(m, q)) continue;
      const delta: V3 = [q.world[0] - m.world[0], q.world[1] - m.world[1], q.world[2] - m.world[2]];
      const dist = Math.hypot(delta[0], delta[1], delta[2]);
      if (!best || dist < best.dist - 1e-9) best = { from: m, to: q, delta, dist };
    }
  }
  return best;
}

/** How many links use each port (`part:port`). */
export function portUse(links: Iterable<LinkRecord>): Map<string, number> {
  const use = new Map<string, number>();
  const add = (e: LinkRecord['from']): void => { if (e) { const k = `${e.part}:${e.port}`; use.set(k, (use.get(k) ?? 0) + 1); } };
  for (const l of links) { add(l.from); add(l.to); }
  return use;
}

/** A part's ports in the world at `pose` (Build: an arm's ports ride the part's pose, as portWorld does in Build). */
export function partPorts(id: number, def: PartDef, pose: Pose, use: ReadonlyMap<string, number> | null, out: SnapPort[] = [], props?: Props): SnapPort[] {
  const b = def.boundsFor ? def.boundsFor(props ?? propValues(def)) : def.bounds;
  def.ports.forEach((port, index) => {
    const n = portFaceNormal(b, port.at);
    out.push({
      world: compose(pose, port.at).pos, channel: port.channel, dir: port.dir, part: id, index,
      free: (use?.get(`${id}:${index}`) ?? 0) < (port.maxLinks ?? 1), normal: n ? qrot(pose.rot, n) as V3 : null,
    });
  });
  return out;
}

/** Every port of the doc's parts that `accept` lets through (not moving, visible…). */
export function docPortIndex(doc: WorldDoc, accept: (p: PartRecord) => boolean): PortIndex {
  const use = portUse(doc.links.values());
  const ports: SnapPort[] = [];
  for (const p of doc.parts.values()) {
    if (!accept(p)) continue;
    const def = partDef(p.type);
    if (def?.ports.length) partPorts(p.id, def, partPose(p), use, ports, propValues(def, p.props));
  }
  return new PortIndex(ports);
}

/** Is port snapping switched on (Settings › Controls › Snap to ports)? Alt still turns it off per move. */
export function portSnapOn(): boolean { return settings.controls.portSnap !== false; }

let alt = false, tracking = false;
/** Is Alt held (free placement: no grid, no port snap)? Tracks key and pointer events from the first call on. */
export function altDown(): boolean {
  if (!tracking && typeof window !== 'undefined') {
    tracking = true;
    const f = (e: KeyboardEvent | PointerEvent): void => {
      alt = e.altKey;
      // Alt alone would focus the browser's menu; not while typing in a field
      if (e instanceof KeyboardEvent && e.type === 'keydown' && e.key === 'Alt' && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) e.preventDefault();
    };
    for (const t of ['keydown', 'keyup', 'pointermove', 'pointerdown'] as const) window.addEventListener(t, f as EventListener, true);
    window.addEventListener('blur', () => { alt = false; });
  }
  return alt;
}

export interface SnapInfo { readonly snap: PortSnap | null; readonly near: readonly SnapPort[]; readonly moving: readonly SnapPort[] }

/** Compatible ports near any moved port (for the glow), capped. */
function nearby(moving: readonly SnapPort[], index: PortIndex, cap = 24): SnapPort[] {
  const out: SnapPort[] = [], seen = new Set<SnapPort>(), tmp: SnapPort[] = [];
  for (const m of moving) {
    tmp.length = 0;
    for (const q of index.near(m.world, PORT_GLOW_M, tmp)) if (!seen.has(q) && portsCompatible(m, q)) { seen.add(q); out.push(q); if (out.length >= cap) return out; }
  }
  return out;
}

// ---- drag-to-move and paste ghosts ---------------------------------------------------------------------------------

const sessionIndex = new WeakMap<MoveSession, PortIndex>();

/**
 * After a move session's preview has been updated to `xf`, pull it onto a compatible port within reach (unless Alt or
 * the setting says no, or the snapped drop would be blocked when the unsnapped one isn't). Sets `s.portSnap`.
 */
export function snapSession(s: MoveSession, xf: MoveXf, doc: WorldDoc, alt: boolean, accept: (p: PartRecord) => boolean): void {
  s.portSnap = null;
  if (alt || !portSnapOn() || s.parts.length > PORT_SNAP_MAX_PARTS) return;
  let index = sessionIndex.get(s);
  if (!index) { index = docPortIndex(doc, (p) => !s.has(p.id) && accept(p)); sessionIndex.set(s, index); }
  if (!index.size) return;
  const moving: SnapPort[] = [];
  for (const m of s.parts) { const pz = s.pose(m.rec.id); if (pz && m.def.ports.length) partPorts(m.rec.id, m.def, pz, null, moving, m.props); }
  if (!moving.length) return;
  const near = nearby(moving, index);
  let snap = findSnap(moving, index);
  if (snap) {
    const blockedBefore = s.refusal() !== null;
    const shifted = (d: V3): MoveXf => ({ ...xf, t: [xf.t[0] + d[0], xf.t[1] + d[1], xf.t[2] + d[2]] });
    s.update(shifted(snap.delta));
    const from = snap.from.part, m = s.parts.find((x) => x.rec.id === from);
    const target = doc.parts.get(snap.to.part);
    // face to face: out of the part it snapped to, along that port's face normal
    if (s.blocked?.by.id === snap.to.part && snap.to.normal && m && target) {
      const pz = s.pose(m.rec.id), tb = partBox(target);
      const push = pz && tb ? matePush(worldBox(m.def, m.props, pz), tb, snap.to.normal) : null;
      if (push) { snap = { ...snap, delta: [snap.delta[0] + push[0], snap.delta[1] + push[1], snap.delta[2] + push[2]] }; s.update(shifted(snap.delta)); }
    }
    if (s.refusal() !== null && !blockedBefore) { s.update(xf); s.portSnap = { snap: null, near, moving }; return; }
  }
  s.portSnap = { snap, near, moving };
}

// ---- the placement ghost -----------------------------------------------------------------------------------------

let placeIndex: { doc: WorldDoc; rev: number; index: PortIndex } | null = null;
let placeRev = 0;
/** The doc changed: the placement index is rebuilt on next use. */
export function invalidatePortIndex(): void { placeRev++; }

/**
 * The placement ghost's pose pulled onto a compatible port within reach, or the pose unchanged. `blocked` is the
 * placement test; a snap that would make an unblocked ghost blocked is dropped.
 */
export function snapPlacement(def: PartDef, pose: Pose, doc: WorldDoc, alt: boolean, accept: (p: PartRecord) => boolean, blocked: (pose: Pose) => boolean): { pose: Pose; info: SnapInfo | null } {
  if (alt || !portSnapOn() || !def.ports.length) return { pose, info: null };
  if (!placeIndex || placeIndex.doc !== doc || placeIndex.rev !== placeRev) placeIndex = { doc, rev: placeRev, index: docPortIndex(doc, accept) };
  const index = placeIndex.index;
  if (!index.size) return { pose, info: null };
  const props = propValues(def);
  const moving = partPorts(0, def, pose, null, [], props);
  const near = nearby(moving, index);
  let snap = findSnap(moving, index);
  if (!snap) return { pose, info: { snap: null, near, moving } };
  const at = (d: V3): Pose => ({ pos: [pose.pos[0] + d[0], pose.pos[1] + d[1], pose.pos[2] + d[2]], rot: pose.rot });
  let moved = at(snap.delta);
  // face to face (see the header): out of the snapped-to part along its port's face normal
  const target = doc.parts.get(snap.to.part), tb: Box | null = target ? partBox(target) : null;
  const push = snap.to.normal && tb ? matePush(worldBox(def, props, moved), tb, snap.to.normal) : null;
  if (push) { snap = { ...snap, delta: [snap.delta[0] + push[0], snap.delta[1] + push[1], snap.delta[2] + push[2]] }; moved = at(snap.delta); }
  if (blocked(moved) && !blocked(pose)) return { pose, info: { snap: null, near, moving } };
  return { pose: moved, info: { snap, near, moving } };
}

// ---- drawing ---------------------------------------------------------------------------------------------------

/** Glows on the compatible ports in range and a bright marker on the joined pair. */
export function portSnapItems(out: SceneItem[], info: SnapInfo | null, now: number): void {
  if (!info) return;
  for (const q of info.near) {
    if (info.snap && q === info.snap.to) continue;
    out.push({ pos: q.world, size: [0.024, 0.024, 0.024], mesh: 1, color: CHANNEL_RGB[q.channel], emissive: 0.9, alpha: 0.85, rough: 0.3 });
  }
  const s = info.snap;
  if (!s) return;
  const pulse = 1 + 0.25 * Math.sin(now / 90);
  const c = CHANNEL_RGB[s.to.channel];
  out.push({ pos: s.to.world, size: [0.04 * pulse, 0.04 * pulse, 0.04 * pulse], mesh: 1, color: c, emissive: 1, alpha: 0.55, rough: 0.2, top: true });
  out.push({ pos: s.to.world, size: [0.02, 0.02, 0.02], mesh: 1, color: c, emissive: 1, rough: 0.2, top: true });
}

/** Readout text for a snapped move ("joined to LAMP's in port"). */
export function snapLabel(info: SnapInfo | null, doc: WorldDoc | null): string | null {
  const s = info?.snap;
  if (!s || !doc) return null;
  const p = doc.parts.get(s.to.part);
  const def = p ? partDef(p.type) : undefined;
  return def ? `snaps to ${def.name} ${def.ports[s.to.index]?.name ?? ''}`.trim() : null;
}

