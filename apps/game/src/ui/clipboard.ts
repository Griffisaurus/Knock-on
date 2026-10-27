// Copy / paste / duplicate (stream BUILDUX, D123; GAME_SPEC §7.3, HOW_TO_PLAY §3.3).
//
// Ctrl+C copies the selected parts with the links among them (a link comes along when every end and via is copied; a
// port-less path such as a TUBE run when it is selected). Relative positions, turns and props are kept; layers and
// groups aren't (pasted parts go on the active layer, ungrouped); the Anchored and Tagged-for-BUZZ flags are kept, Locked
// and Hidden aren't. The clipboard lives for the browser session (sessionStorage), so it carries across worlds.
//
// Ctrl+V pastes as a carried ghost (ui/dragmove.ts `DragMove.carry`): it follows the cursor like a dragged part (grid,
// resting surface, work plane, R turns, red when blocked) and a click drops it; Esc or a right click cancels.
// Ctrl+D duplicates the selection: the copy is offset one grid step (10 cm) along +X, pushed on in grid steps (then
// along +Z, −X, −Z) until it overlaps nothing, and is selected, ready to drag. When there's no clear spot nearby it
// becomes a paste ghost instead.
//
// Every paste is ONE op (a Batch of PartAdds then LinkAdds): one undo step, synced in co-op like any edit. New ids come
// from net.nextId(). RIFT GATE, BUZZ ↔ BUZZ BEACON and PING pairs are re-paired: a pair copied whole becomes a NEW pair
// (a colour nobody uses yet, when there is one), a lone RIFT GATE / BUZZ / BEACON pairs as if just placed (ui/m5tools.ts
// autoPair), and a lone PING keeps its colour (a copied sender talks to the same receivers).

import type { WorldDoc } from '@knockon/docstore';
import { PartFlag, type LinkRecord, type Op, type PartRecord } from '@knockon/format';
import { propValues } from '@knockon/parts-data';
import { partDef } from '../catalog.ts';
import type { V3 } from '../math.ts';
import { portWorld, type LinkDraw } from '../scene.ts';
import { moveUnits, MoveSession, partBox, partName, unionBox, type DragMove, type WorldBounds } from './dragmove.ts';
import { autoPair, pairKind, pairsOf } from './m5tools.ts';
import { propsWith } from './mirror.ts';

// ---- pure pieces (unit-tested in test/buildux.test.ts) -------------------------------------------------------------

export interface Clip {
  /** Copied parts with their source ids; layer and group stripped, flags filtered. */
  readonly parts: readonly PartRecord[];
  /** Links among them (source ids). */
  readonly links: readonly LinkRecord[];
  /** RIFT / BUZZ pairs whose two parts were both copied (source ids). */
  readonly pairs: readonly (readonly [number, number])[];
  /** The world it came from (a paste into another world is fine). */
  readonly source: string;
}

/** Flags a copy keeps: mirror bits, Anchored and Tagged (gameplay); never Locked / Hidden. */
export const COPY_FLAGS = PartFlag.MirrorX | PartFlag.MirrorY | PartFlag.MirrorZ | PartFlag.Anchored | PartFlag.Tagged;

/** Copy the selected parts and the links among them. Null when no part is selected. */
export function copyClip(doc: Pick<WorldDoc, 'parts' | 'links'>, ids: readonly number[], source = ''): Clip | null {
  const sel = new Set(ids);
  const chosen = [...sel].map((id) => doc.parts.get(id)).filter((p): p is PartRecord => !!p).sort((a, b) => a.id - b.id);
  if (!chosen.length) return null;
  const set = new Set(chosen.map((p) => p.id));
  const parts = chosen.map((p) => { const { layer: _l, group: _g, ...rest } = p; return { ...rest, flags: p.flags & COPY_FLAGS }; });
  const links = [...doc.links.values()].filter((l) => {
    if (!l.from && !l.to) return sel.has(l.id) && l.points.length >= 2;
    return (!l.from || set.has(l.from.part)) && (!l.to || set.has(l.to.part)) && l.via.every((v) => set.has(v));
  }).sort((a, b) => a.id - b.id);
  const pairs = pairsOf(doc.parts.values()).links.filter((l) => set.has(l.a) && set.has(l.b)).map((l) => [l.a, l.b] as const);
  return { parts, links, pairs, source };
}

/** The clip with fresh ids (parts in id order, then links): records ready to add, and the old → new map. */
export function remapClip(clip: Clip, nextId: () => number): { parts: PartRecord[]; links: LinkRecord[]; pairs: [number, number][]; idMap: Map<number, number> } {
  const idMap = new Map<number, number>();
  const parts = clip.parts.map((p) => { const id = nextId(); idMap.set(p.id, id); return { ...p, id }; });
  const m = (id: number): number => idMap.get(id)!;
  const links = clip.links
    .filter((l) => (!l.from || idMap.has(l.from.part)) && (!l.to || idMap.has(l.to.part)) && l.via.every((v) => idMap.has(v)))
    .map((l) => { const id = nextId(); idMap.set(l.id, id); return { ...l, id, from: l.from ? { part: m(l.from.part), port: l.from.port } : null, to: l.to ? { part: m(l.to.part), port: l.to.port } : null, via: l.via.map(m) }; });
  const pairs = clip.pairs.filter(([a, b]) => idMap.has(a) && idMap.has(b)).map(([a, b]) => [m(a), m(b)] as [number, number]);
  return { parts, links, pairs, idMap };
}

const pairPropOf = (p: PartRecord): number => { const d = partDef(p.type); return d && 'pair' in d.props ? Math.round(propValues(d, p.props).pair ?? 0) : -1; };
const withPair = (p: PartRecord, c: number): PartRecord => { const d = partDef(p.type)!; return { ...p, props: propsWith(d, p.props, { pair: c }) }; };
const pairNames = (type: string): readonly string[] => (type === 'ping' ? (partDef('ping')?.props.pair?.values ?? []) : pairKind(type)?.names ?? []);

/**
 * Re-pair the pasted parts against the world they land in (see the header): whole pairs (`pairs`, new ids) and groups of
 * same-colour PINGs get unused colours; lone gates, beacons and BUZZes pair like a newly placed part. Returns new records.
 */
export function repairPairs(parts: readonly PartRecord[], pairs: readonly (readonly [number, number])[], world: Iterable<PartRecord>): PartRecord[] {
  const out = new Map(parts.map((p) => [p.id, p]));
  const acc: PartRecord[] = [...world];
  const used = (types: readonly string[], c: number): boolean => acc.some((p) => types.includes(p.type) && pairPropOf(p) === c);
  const fresh = (types: readonly string[], names: readonly string[]): number | null => { for (let c = 0; c < names.length; c++) if (!used(types, c)) return c; return null; };
  const done = new Set<number>();
  // whole RIFT / BUZZ pairs → a new pair in an unused colour
  for (const [a, b] of pairs) {
    const pa = out.get(a), pb = out.get(b);
    if (!pa || !pb || done.has(a) || done.has(b)) continue;
    const types = pa.type === 'rift_gate' ? ['rift_gate'] : ['buzz', 'buzz_beacon'];
    const c = fresh(types, pairNames(pa.type));
    const na = c === null ? pa : withPair(pa, c), nb = c === null ? pb : withPair(pb, c);
    out.set(a, na); out.set(b, nb); acc.push(na, nb); done.add(a); done.add(b);
  }
  // PINGs: the pasted pings of one colour form a new group in an unused colour; a lone ping keeps its colour
  const pings = new Map<number, PartRecord[]>();
  for (const p of parts) if (p.type === 'ping') { const c = pairPropOf(p); pings.set(c, [...(pings.get(c) ?? []), p]); }
  for (const group of pings.values()) {
    for (const p of group) done.add(p.id);
    if (group.length < 2) { acc.push(...group); continue; }
    const c = fresh(['ping'], pairNames('ping'));
    for (const p of group) { const n = c === null ? p : withPair(p, c); out.set(p.id, n); acc.push(n); }
  }
  // lone RIFT GATES, BUZZ BEACONS and BUZZes pair as if just placed
  for (const p of parts) {
    if (done.has(p.id) || !pairKind(p.type)) continue;
    const c = autoPair(p.type, acc);
    const n = c === null ? p : withPair(p, c);
    out.set(p.id, n); acc.push(n);
  }
  return parts.map((p) => out.get(p.id)!);
}

/** One op for the whole paste: parts first, then the links that need them. One undo step. */
export function pasteOp(parts: readonly PartRecord[], links: readonly LinkRecord[]): Op | null {
  const ops: Op[] = [...parts.map((part) => ({ k: 'PartAdd', part }) as Op), ...links.map((link) => ({ k: 'LinkAdd', link }) as Op)];
  return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { k: 'Batch', ops };
}

/** Grid-step offsets for a duplicate, nearest first per direction: +X, then +Z, −X, −Z (k = 1 … max). */
export function duplicateOffsets(maxSteps: number, step = 0.1): V3[] {
  const out: V3[] = [];
  for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) for (let k = 1; k <= maxSteps; k++) out.push([d[0] * k * step, 0, d[1] * k * step]);
  return out;
}

// ---- the clipboard (per browser session) ---------------------------------------------------------------------------

const STORE = 'kn.clip';
let current: Clip | null = ((): Clip | null => {
  try { const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORE) : null; return raw ? (JSON.parse(raw) as Clip) : null; } catch { return null; }
})();
export function clipboard(): Clip | null { return current; }
export function setClipboard(c: Clip | null): void {
  current = c;
  try { if (c) sessionStorage.setItem(STORE, JSON.stringify(c)); else sessionStorage.removeItem(STORE); } catch { /* too big or private mode: this tab still has it */ }
}

// ---- a doc view with extra (not yet added) records, for the paste ghost's MoveSession ----------------------------------

class Merged<V> {
  constructor(private readonly a: ReadonlyMap<number, V>, private readonly b: ReadonlyMap<number, V>) {}
  get size(): number { return this.a.size + this.b.size; }
  get(k: number): V | undefined { return this.b.get(k) ?? this.a.get(k); }
  has(k: number): boolean { return this.b.has(k) || this.a.has(k); }
  *values(): IterableIterator<V> { yield* this.a.values(); yield* this.b.values(); }
  *keys(): IterableIterator<number> { yield* this.a.keys(); yield* this.b.keys(); }
}
/** The doc plus the ghost's records: the session's obstacles are the real parts, its movers the ghost's. */
function withGhost(doc: WorldDoc, parts: readonly PartRecord[], links: readonly LinkRecord[]): WorldDoc {
  return { parts: new Merged(doc.parts, new Map(parts.map((p) => [p.id, p]))), links: new Merged(doc.links, new Map(links.map((l) => [l.id, l]))) } as unknown as WorldDoc;
}

// ---- the controller (main.ts wires Ctrl+C / V / D and the palette) ---------------------------------------------------

export interface ClipHost {
  doc(): WorldDoc | null;
  phase(): string;
  worldId(): string;
  /** Selected ids (parts and links). */
  selection(): readonly number[];
  select(ids: readonly number[]): void;
  nextId(): number;
  submit(op: Op): boolean;
  /** Active layer for new parts (0 = default). */
  layer(): number;
  /** Per-world caps (SINGULARITY): the refusal for adding `n` of `type`, or null. */
  refusal(type: string, n: number): string | null;
  world(): WorldBounds | null;
  toast(text: string, level?: 'info' | 'warn' | 'error'): void;
  announce(text: string, level?: 'polite' | 'assertive'): void;
  sound(kind: 'place' | 'error' | 'rotate'): void;
  readonly mover: DragMove;
}

interface Ghost { parts: PartRecord[]; links: LinkRecord[]; pairs: [number, number][]; anchor: number; centre: V3 }

const plural = (n: number): string => `${n} part${n === 1 ? '' : 's'}`;

/** A carried paste ghost's port-to-port links, drawn to its parts' preview poses. */
export function ghostLinkDraws(s: MoveSession, links: readonly LinkRecord[]): LinkDraw[] {
  const out: LinkDraw[] = [];
  if (!links.length) return out;
  const byId = new Map(s.parts.map((m) => [m.rec.id, m]));
  const poseOf = (id: number) => s.pose(id) ?? null;
  const end = (e: LinkRecord['from']): V3 | null => {
    const m = e ? byId.get(e.part) : undefined;
    const port = m?.def.ports[e!.port];
    return m && port ? portWorld(m.def, port, poseOf, m.rec.id) : null;
  };
  for (const l of links) { const a = end(l.from), b = end(l.to); if (a && b) out.push({ link: l, a, b, state: null }); }
  return out;
}

export class ClipTool {
  /** The paste ghost being carried (its links are drawn by main.ts through `ghostLinks`). */
  private live: { s: MoveSession; g: Ghost } | null = null;
  constructor(private readonly host: ClipHost) {}

  /** The port-to-port links of the paste ghost this session carries (none for other sessions). */
  ghostLinks(s: MoveSession): readonly LinkRecord[] { return this.live?.s === s ? this.live.g.links.filter((l) => l.from && l.to) : []; }

  /** Ctrl+C. */
  copy(): boolean {
    const doc = this.host.doc();
    if (!doc) return false;
    const clip = copyClip(doc, this.host.selection(), this.host.worldId());
    if (!clip) { this.host.toast('Select the parts to copy (V, then click or drag a box)'); return false; }
    setClipboard(clip);
    const extra = clip.links.length ? ` and ${clip.links.length} link${clip.links.length === 1 ? '' : 's'}` : '';
    this.host.toast(`Copied ${plural(clip.parts.length)}${extra} · Ctrl+V pastes`);
    this.host.announce(`Copied ${plural(clip.parts.length)}${extra}`);
    return true;
  }

  /** Ctrl+V: the clipboard as a carried ghost under the cursor. */
  paste(): boolean {
    const clip = clipboard();
    if (!clip) { this.host.toast('Nothing copied yet: select parts and press Ctrl+C'); return false; }
    return this.carry(clip, `Paste ${clip.parts.length === 1 ? partName(clip.parts[0]!.type) : plural(clip.parts.length)}`);
  }

  /** Ctrl+D: a copy next to the selection (first clear grid step), selected. */
  duplicate(): boolean {
    const h = this.host, doc = h.doc();
    if (!doc || h.phase() !== 'build') return false;
    const clip = copyClip(doc, h.selection(), h.worldId());
    if (!clip) { h.toast('Select the parts to duplicate'); return false; }
    const g = this.ghost(clip);
    if (!g) return false;
    const s = this.session(doc, g);
    if (!s) return false;
    const u = unionBox(g.parts.map(partBox).filter((b): b is NonNullable<typeof b> => !!b))!;
    const span = Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2]);
    for (const t of duplicateOffsets(Math.min(200, Math.ceil(span / 0.1) + 3))) {
      s.update({ pivot: s.anchor.from, t, q: null, rot: new Map() });
      if (!s.refusal()) return this.commit(s, g, 'Duplicated');
    }
    h.toast('No clear spot next to it: place the copy with a click');
    return this.carry(clip, `Duplicate ${plural(clip.parts.length)}`, 'Duplicated');
  }

  private carry(clip: Clip, label: string, verb = 'Pasted'): boolean {
    const h = this.host, doc = h.doc();
    if (!doc || h.phase() !== 'build') { h.toast('Stop the run to paste'); return false; }
    const g = this.ghost(clip);
    if (!g) return false;
    const s = this.session(doc, g);
    if (!s) return false;
    h.mover.carry(s, (ss) => this.commit(ss, g, verb), label, g.centre);
    this.live = { s, g };
    return true;
  }

  /** The clip with fresh ids, its lowest part as the anchor (it rests on the surface), and its middle (under the cursor). */
  private ghost(clip: Clip): Ghost | null {
    const known = { ...clip, parts: clip.parts.filter((p) => partDef(p.type)) };
    if (!known.parts.length) { this.host.toast('Those parts aren’t in this version of the game', 'warn'); return null; }
    const r = remapClip(known, () => this.host.nextId());
    const boxes = r.parts.map((p) => ({ p, b: partBox(p)! }));
    const u = unionBox(boxes.map((x) => x.b))!;
    const centre: V3 = [(u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2];
    let anchor = boxes[0]!;
    for (const x of boxes) {
      const d = (q: typeof x): number => Math.hypot((q.b.min[0] + q.b.max[0]) / 2 - centre[0], (q.b.min[2] + q.b.max[2]) / 2 - centre[2]);
      if (x.b.min[1] < anchor.b.min[1] - 1e-6 || (Math.abs(x.b.min[1] - anchor.b.min[1]) < 1e-6 && d(x) < d(anchor))) anchor = x;
    }
    return { parts: r.parts, links: r.links, pairs: r.pairs, anchor: anchor.p.id, centre };
  }

  private session(doc: WorldDoc, g: Ghost): MoveSession | null {
    const free = g.links.filter((l) => !l.from && !l.to).map((l) => l.id);
    try { return new MoveSession(withGhost(doc, g.parts, g.links), g.parts.map((p) => p.id), free, g.anchor, this.host.world()); } catch { return null; }
  }

  /** Drop the ghost where the session has it: refuse with the reason, or submit ONE op and select the new parts. */
  private commit(s: MoveSession, g: Ghost, verb: string): boolean {
    const h = this.host, doc = h.doc();
    if (!doc || h.phase() !== 'build') { h.toast('Stop the run to paste', 'warn'); return false; }
    s.revalidate(withGhost(doc, g.parts, g.links));
    const why = s.refusal();
    const refuse = (msg: string): false => { h.toast(msg, 'warn'); h.announce(msg, 'assertive'); h.sound('error'); return false; };
    if (why) return refuse(`Can't drop here: ${why}`);
    const count = new Map<string, number>();
    for (const m of s.parts) count.set(m.rec.type, (count.get(m.rec.type) ?? 0) + 1);
    for (const [t, n] of count) { const cap = h.refusal(t, n); if (cap) return refuse(cap); }
    const layer = h.layer();
    let parts: PartRecord[] = s.parts.map((m) => {
      const pose = s.pose(m.rec.id)!;
      const { layer: _l, group: _g, ...rest } = m.rec;
      return { ...rest, pos: moveUnits(m.rec.pos, s.xf), rot: pose.rotation, ...(layer ? { layer } : {}) };
    });
    parts = repairPairs(parts, g.pairs, doc.parts.values());
    const have = new Set(parts.map((p) => p.id));
    const links = g.links
      .filter((l) => (!l.from || have.has(l.from.part)) && (!l.to || have.has(l.to.part)) && l.via.every((v) => have.has(v)))
      .map((l) => ({ ...l, points: l.points.map((q) => moveUnits(q, s.xf)) }));
    const op = pasteOp(parts, links);
    if (!op || !h.submit(op)) return false;
    h.select([...parts.map((p) => p.id), ...links.filter((l) => !l.from && !l.to).map((l) => l.id)]);
    h.announce(`${verb} ${plural(parts.length)}`);
    h.toast(`${verb} ${plural(parts.length)}${links.length ? ` with ${links.length} link${links.length === 1 ? '' : 's'}` : ''} · Ctrl+Z undoes`);
    h.sound('place');
    return true;
  }
}

