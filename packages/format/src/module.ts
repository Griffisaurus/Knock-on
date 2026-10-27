// Modules (prefabs): `.knockmod` encode/decode, building one from a selection, and deterministic
// placement with id remapping (DATA_FORMATS §4, MULTIPLAYER §5.1 ModuleSave / ModulePlace).

import { pack, unpack } from 'msgpackr';
import { FormatError } from './bytes.ts';
import { Codec, decodeContainer, encodeContainer, section, type Container } from './container.ts';
import type { LinkEnd, LinkRecord, ModuleTransform, PartId, PartRecord } from './model.ts';
import { PartFlag } from './model.ts';
import { opFromWire, opToWire } from './ops.ts';
import { freeRotation, type Rotation } from './quantize.ts';
import { decodeParts, encodeParts } from './world.ts';

/** An exposed external port: where the module plugs into the rest of a machine. */
export interface ModulePort {
  readonly localPartId: number;
  readonly port: number;
  readonly label: string;
}

export interface ModuleMeta {
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly tags: readonly string[];
}

/** A decoded `.knockmod`: local ids 1..P for parts, P+1..P+L for links; positions relative to the origin. */
export interface ModuleDef {
  readonly meta: ModuleMeta;
  readonly parts: readonly PartRecord[];
  readonly links: readonly LinkRecord[];
  readonly ports: readonly ModulePort[];
}

export const MAX_MODULE_BYTES = 1024 * 1024;
const MAX_MODULE_ITEMS = 20_000;
const MAX_NAME = 64;
const MAX_DESC = 280;

/** Number of ids a placement consumes (parts + links). */
export function moduleIdCount(def: ModuleDef): number {
  return def.parts.length + def.links.length;
}

export function encodeModule(def: ModuleDef, codec: Codec = Codec.Deflate): Uint8Array {
  checkLocalIds(def);
  const { types, data } = encodeParts(def.parts);
  const links = [...def.links].sort((a, b) => a.id - b.id).map((l) => opToWire({ k: 'LinkAdd', link: l }));
  const meta = { name: def.meta.name, author: def.meta.author, description: def.meta.description, tags: [...def.meta.tags] };
  const c: Container = {
    magic: 'KNMD', flags: 0,
    header: { name: def.meta.name, counts: { parts: def.parts.length, links: def.links.length, ports: def.ports.length } },
    sections: [
      { tag: 'TYPE', data: pack(types) as Uint8Array },
      { tag: 'PART', data },
      { tag: 'LINK', data: pack(links) as Uint8Array },
      { tag: 'PORT', data: pack(def.ports.map((p) => [p.localPartId, p.port, p.label])) as Uint8Array },
      { tag: 'META', data: pack(meta) as Uint8Array },
    ],
  };
  return encodeContainer(c, codec);
}

export function decodeModule(bytes: Uint8Array): ModuleDef {
  if (!(bytes instanceof Uint8Array)) throw new FormatError('module: expected bytes');
  if (bytes.length > MAX_MODULE_BYTES) throw new FormatError('module too large');
  try {
    return decodeModuleInner(bytes);
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError(`module: ${(err as Error).message}`);
  }
}

function decodeModuleInner(bytes: Uint8Array): ModuleDef {
  const c = decodeContainer(bytes);
  if (c.magic !== 'KNMD') throw new FormatError('not a module file');
  const typeBytes = section(c, 'TYPE');
  const partBytes = section(c, 'PART');
  if (!typeBytes || !partBytes) throw new FormatError('module: missing TYPE/PART');
  const types = unpack(typeBytes) as unknown;
  if (!Array.isArray(types) || !types.every((t) => typeof t === 'string')) throw new FormatError('module TYPE');
  const parts = decodeParts(types as string[], partBytes);
  const linkList = list(section(c, 'LINK'));
  const links = linkList.map((w) => {
    const op = opFromWire(w);
    if (op.k !== 'LinkAdd') throw new FormatError('module LINK');
    return op.link;
  });
  const ports = list(section(c, 'PORT')).map((w): ModulePort => {
    if (!Array.isArray(w) || w.length !== 3) throw new FormatError('module PORT');
    const [lp, port, label] = w as unknown[];
    if (!Number.isInteger(lp) || !Number.isInteger(port) || (port as number) < 0 || (port as number) > 63) throw new FormatError('module PORT');
    if (typeof label !== 'string' || label.length > MAX_NAME) throw new FormatError('module PORT label');
    return { localPartId: lp as number, port: port as number, label };
  });
  const m = section(c, 'META') ? (unpack(section(c, 'META')!) as Record<string, unknown>) : {};
  if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new FormatError('module META');
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const meta: ModuleMeta = {
    name: str(m.name, MAX_NAME) || str(c.header.name, MAX_NAME) || 'Module',
    author: str(m.author, MAX_NAME),
    description: str(m.description, MAX_DESC),
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string').slice(0, 16).map((t) => t.slice(0, 32)) : [],
  };
  const def: ModuleDef = { meta, parts, links, ports };
  checkLocalIds(def);
  for (const p of ports) if (!parts.some((x) => x.id === p.localPartId)) throw new FormatError('module PORT part');
  return def;
}

/** Local ids must be exactly 1..P (parts) then P+1..P+L (links), and links may only reference module parts. */
function checkLocalIds(def: ModuleDef): void {
  const P = def.parts.length, L = def.links.length;
  if (P + L > MAX_MODULE_ITEMS) throw new FormatError('module has too many parts');
  if (P === 0) throw new FormatError('module is empty');
  const pids = [...def.parts].map((p) => p.id).sort((a, b) => a - b);
  pids.forEach((id, i) => { if (id !== i + 1) throw new FormatError('module part ids must be 1..n'); });
  const lids = [...def.links].map((l) => l.id).sort((a, b) => a - b);
  lids.forEach((id, i) => { if (id !== P + i + 1) throw new FormatError('module link ids must follow the parts'); });
  for (const l of def.links) {
    for (const e of [l.from, l.to]) if (e && (e.part < 1 || e.part > P)) throw new FormatError('module link end outside the module');
    for (const v of l.via) if (v < 1 || v > P) throw new FormatError('module link via outside the module');
  }
}

function list(b: Uint8Array | undefined): unknown[] {
  if (!b) return [];
  const v = unpack(b) as unknown;
  if (!Array.isArray(v)) throw new FormatError('expected list');
  return v;
}

// ---- building a module from a selection -------------------------------------------------------------

export interface ModuleFromSelection {
  readonly name: string;
  readonly author?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  /** Module origin in world units (1/64 cell); positions are stored relative to it. */
  readonly origin: readonly [number, number, number];
  /** Port label for exposed ports (default `type#port`). */
  readonly portLabel?: (part: PartRecord, port: number) => string;
}

/**
 * Build a module from selected parts (and links). Links come along when every end and via is
 * selected; links that cross the selection boundary are cut and their inside ends become exposed
 * ports. Local ids follow world id order, so the same selection always yields the same bytes.
 */
export function moduleFromSelection(
  parts: ReadonlyMap<PartId, PartRecord>, links: ReadonlyMap<PartId, LinkRecord>, selected: Iterable<PartId>, opts: ModuleFromSelection,
): ModuleDef {
  const sel = new Set(selected);
  const chosen = [...parts.values()].filter((p) => sel.has(p.id)).sort((a, b) => a.id - b.id);
  if (!chosen.length) throw new FormatError('select at least one part');
  const local = new Map<PartId, number>(chosen.map((p, i) => [p.id, i + 1]));
  const [ox, oy, oz] = opts.origin;
  const keepFlags = PartFlag.MirrorX | PartFlag.MirrorY | PartFlag.MirrorZ | PartFlag.Anchored | PartFlag.Tagged; // B5 (M5): the tag is gameplay
  const outParts: PartRecord[] = chosen.map((p) => {
    const { layer: _l, group: _g, ...rest } = p;
    return { ...rest, id: local.get(p.id)!, pos: [p.pos[0] - ox, p.pos[1] - oy, p.pos[2] - oz], flags: p.flags & keepFlags };
  });
  const inside = (e: LinkEnd | null): boolean => e === null || local.has(e.part);
  const exposed: ModulePort[] = [];
  const seenPort = new Set<string>();
  const expose = (e: LinkEnd | null): void => {
    if (!e || !local.has(e.part)) return;
    const key = `${e.part}:${e.port}`;
    if (seenPort.has(key)) return;
    seenPort.add(key);
    const part = parts.get(e.part)!;
    exposed.push({ localPartId: local.get(e.part)!, port: e.port, label: (opts.portLabel ?? ((p, i) => `${p.type}#${i}`))(part, e.port).slice(0, MAX_NAME) });
  };
  const keptLinks: LinkRecord[] = [];
  for (const l of [...links.values()].sort((a, b) => a.id - b.id)) {
    const touches = (l.from && local.has(l.from.part)) || (l.to && local.has(l.to.part)) || l.via.some((v) => local.has(v));
    const free = !l.from && !l.to; // tubes and other free paths come along only when selected
    if (free ? !sel.has(l.id) : !touches) continue;
    if (inside(l.from) && inside(l.to) && l.via.every((v) => local.has(v))) keptLinks.push(l);
    else { expose(l.from); expose(l.to); }
  }
  const P = outParts.length;
  const mapEnd = (e: LinkEnd | null): LinkEnd | null => (e ? { part: local.get(e.part)!, port: e.port } : null);
  const outLinks: LinkRecord[] = keptLinks.map((l, i) => ({
    ...l, id: P + i + 1, from: mapEnd(l.from), to: mapEnd(l.to), via: l.via.map((v) => local.get(v)!),
    points: l.points.map((q) => [q[0] - ox, q[1] - oy, q[2] - oz] as [number, number, number]),
  }));
  exposed.sort((a, b) => a.localPartId - b.localPartId || a.port - b.port);
  return {
    meta: { name: opts.name.slice(0, MAX_NAME) || 'Module', author: (opts.author ?? '').slice(0, MAX_NAME), description: (opts.description ?? '').slice(0, MAX_DESC), tags: [...(opts.tags ?? [])] },
    parts: outParts, links: outLinks, ports: exposed,
  };
}

// ---- placement ---------------------------------------------------------------------------------------

/** Rotate a local position by `quarter` turns about +Y (right-handed: +X → −Z). Exact integers. */
export function rotateQuarter(v: readonly [number, number, number], quarter: number): [number, number, number] {
  const [x, y, z] = v;
  switch (quarter & 3) {
    case 1: return [z, y, -x];
    case 2: return [-x, y, -z];
    case 3: return [-z, y, x];
    default: return [x, y, z];
  }
}

const ST_SCALE = 32767 / 0.7071067811865476;

/** Pre-multiply a rotation by a quarter-turn yaw. Snapped Euler stays exact (yaw is applied first). */
export function yawRotation(r: Rotation, quarter: number): Rotation {
  const q = quarter & 3;
  if (q === 0) return r;
  if (r.tag === 0) return { tag: 1, yaw: wrapHalfDeg(180 * q), pitch: 0, roll: 0 };
  if (r.tag === 1) {
    const yaw = wrapHalfDeg(r.yaw + 180 * q);
    return yaw === 0 && r.pitch === 0 && r.roll === 0 ? { tag: 0 } : { tag: 1, yaw, pitch: r.pitch, roll: r.roll };
  }
  // free rotation: decode smallest-three, multiply by the yaw quaternion, re-quantize (plain IEEE math)
  const rest = [r.a / ST_SCALE, r.b / ST_SCALE, r.c / ST_SCALE];
  const largest = Math.sqrt(Math.max(0, 1 - rest[0]! * rest[0]! - rest[1]! * rest[1]! - rest[2]! * rest[2]!));
  const c: number[] = [];
  let k = 0;
  for (let i = 0; i < 4; i++) c.push(i === r.index ? largest : rest[k++]!);
  const [bx, by, bz, bw] = c as [number, number, number, number];
  const S = [0, 0.7071067811865476, 1, 0.7071067811865476][q]!;
  const C = [1, 0.7071067811865476, 0, -0.7071067811865476][q]!;
  // (0, S, 0, C) * (bx, by, bz, bw)
  return freeRotation([C * bx + S * bz, C * by + S * bw, C * bz - S * bx, C * bw - S * by]);
}

function wrapHalfDeg(v: number): number {
  let x = v % 720;
  if (x > 360) x -= 720;
  if (x <= -360) x += 720;
  return x;
}

/**
 * Expand a module into world records: local id i becomes `idBase + i` (local id order, so both
 * clients and the host produce identical ids), positions are rotated then offset. `layer` and
 * `group` are applied to every placed part.
 */
export function expandModule(def: ModuleDef, t: ModuleTransform, idBase: number, layer = 0): { parts: PartRecord[]; links: LinkRecord[] } {
  const mapId = (local: number): PartId => idBase + local;
  const place = (v: readonly [number, number, number]): [number, number, number] => {
    const r = rotateQuarter(v, t.quarter);
    return [r[0] + t.pos[0], r[1] + t.pos[1], r[2] + t.pos[2]];
  };
  const parts = [...def.parts].sort((a, b) => a.id - b.id).map((p): PartRecord => {
    const { layer: _l, group: _g, ...rest } = p;
    return { ...rest, id: mapId(p.id), pos: place(p.pos), rot: yawRotation(p.rot, t.quarter), ...(layer ? { layer } : {}) };
  });
  const mapEnd = (e: LinkEnd | null): LinkEnd | null => (e ? { part: mapId(e.part), port: e.port } : null);
  const links = [...def.links].sort((a, b) => a.id - b.id).map((l): LinkRecord => ({
    ...l, id: mapId(l.id), from: mapEnd(l.from), to: mapEnd(l.to), via: l.via.map(mapId), points: l.points.map(place),
  }));
  return { parts, links };
}
