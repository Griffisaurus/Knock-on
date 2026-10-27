// Edit ops: the only way a world changes (ARCHITECTURE §4.2, DATA_FORMATS §3).
// Wire form is a MessagePack array; decoding validates shape and ranges strictly.

import { FormatError } from './bytes.ts';
import type { EnvSettings, LinkEnd, LinkKind, LinkRecord, ModuleTransform, NoteRecord, PartId, PartRecord, PropList } from './model.ts';
import { LinkKinds } from './model.ts';
import type { Rotation } from './quantize.ts';
import { patchFromWire, patchToWire, type TerrainPatch, type TerrainStroke } from './terrain.ts'; // S3: Backlot sculpting

export interface PartPatch {
  readonly pos?: PartRecord['pos'];
  readonly rot?: Rotation;
  readonly flags?: number;
  readonly size?: PartRecord['size'];
  readonly props?: PropList;
  readonly layer?: number;
  readonly group?: number;
  readonly skin?: number;
}

export interface LinkPatch {
  readonly from?: LinkEnd | null;
  readonly to?: LinkEnd | null;
  readonly via?: readonly PartId[];
  readonly points?: LinkRecord['points'];
  readonly length?: number;
  readonly props?: PropList;
}

export type Op =
  | { readonly k: 'PartAdd'; readonly part: PartRecord }
  | { readonly k: 'PartUpdate'; readonly id: PartId; readonly patch: PartPatch }
  | { readonly k: 'PartRemove'; readonly ids: readonly PartId[] }
  | { readonly k: 'LinkAdd'; readonly link: LinkRecord }
  | { readonly k: 'LinkUpdate'; readonly id: PartId; readonly patch: LinkPatch }
  | { readonly k: 'LinkRemove'; readonly ids: readonly PartId[] }
  | { readonly k: 'EnvUpdate'; readonly patch: Partial<EnvSettings> }
  | { readonly k: 'NoteAdd'; readonly note: NoteRecord }
  | { readonly k: 'NoteUpdate'; readonly id: PartId; readonly text?: string; readonly pos?: NoteRecord['pos']; readonly color?: string }
  | { readonly k: 'NoteRemove'; readonly ids: readonly PartId[] }
  /** Create/rename/reparent a group (name ≠ null) or remove it (name = null). `members` (if given) becomes the exact membership. */
  | { readonly k: 'GroupSet'; readonly id: number; readonly name: string | null; readonly parent: number; readonly members: readonly PartId[] | null }
  /** Create/update a layer (name ≠ null) or remove it (name = null; its parts move to the default layer). */
  | { readonly k: 'LayerSet'; readonly id: number; readonly name: string | null; readonly flags: number }
  /** Store a module's `.knockmod` bytes in the world (blob = null removes it). */
  | { readonly k: 'ModuleSave'; readonly id: number; readonly name: string; readonly blob: Uint8Array | null }
  /** Expand a stored module: ids `idBase + 1 .. idBase + count` in local id order (DATA_FORMATS §4). */
  | { readonly k: 'ModulePlace'; readonly moduleId: number; readonly transform: ModuleTransform; readonly idBase: number; readonly count: number; readonly layer: number }
  | { readonly k: 'Batch'; readonly ops: readonly Op[] }
  /** S3: a Backlot sculpt stroke (terrain.ts applyStroke); deterministic on every client. */
  | { readonly k: 'TerrainStroke'; readonly stroke: TerrainStroke }
  /** S3: restore a rectangle of terrain samples (a stroke's inverse; never sent by players except as undo). */
  | { readonly k: 'TerrainPatch'; readonly patch: TerrainPatch };

// ---- wire codes (DATA_FORMATS §3) -----------------------------------------------------------
const CODE = {
  PartAdd: 1, PartUpdate: 2, PartRemove: 3, LinkAdd: 4, LinkUpdate: 5, LinkRemove: 6, GroupSet: 7, ModuleSave: 8, ModulePlace: 9,
  EnvUpdate: 10, TerrainStroke: 11, NoteAdd: 12, NoteUpdate: 13, NoteRemove: 14, Batch: 15, LayerSet: 16, TerrainPatch: 17,
} as const;
const PATCH = { pos: 1, rot: 2, flags: 4, size: 8, props: 16, layer: 32, group: 64, skin: 128 } as const;

const MAX_BATCH = 100_000;
const MAX_IDS = 100_000;
const MAX_POINTS = 4096;
const MAX_TEXT = 280;
const MAX_NAME = 64;
const MAX_BLOB = 1024 * 1024;
const MAX_MODULE_IDS = 20_000;

type Wire = unknown[];

export function rotToWire(r: Rotation): Wire {
  if (r.tag === 0) return [0];
  if (r.tag === 1) return [1, r.yaw, r.pitch, r.roll];
  return [2, r.index, r.a, r.b, r.c];
}

export function rotFromWire(w: unknown): Rotation {
  const a = arr(w, 'rot');
  const tag = a[0];
  if (tag === 0) return { tag: 0 };
  if (tag === 1) return { tag: 1, yaw: i16(a[1]), pitch: i16(a[2]), roll: i16(a[3]) };
  if (tag === 2) {
    const index = a[1];
    if (index !== 0 && index !== 1 && index !== 2 && index !== 3) throw new FormatError('rot index');
    return { tag: 2, index, a: i16(a[2]), b: i16(a[3]), c: i16(a[4]) };
  }
  throw new FormatError('rot tag');
}

function partToWire(p: PartRecord): Wire {
  return [CODE.PartAdd, p.id, p.type, [...p.pos], rotToWire(p.rot), p.flags, p.size ? [...p.size] : null,
    p.props ? p.props.map((x) => [...x]) : null, p.layer ?? 0, p.group ?? 0, p.skin ?? 0];
}

export function opToWire(op: Op): Wire {
  switch (op.k) {
    case 'PartAdd': return partToWire(op.part);
    case 'PartUpdate': {
      const p = op.patch;
      let mask = 0;
      const fields: unknown[] = [];
      if (p.pos) { mask |= PATCH.pos; fields.push([...p.pos]); }
      if (p.rot) { mask |= PATCH.rot; fields.push(rotToWire(p.rot)); }
      if (p.flags !== undefined) { mask |= PATCH.flags; fields.push(p.flags); }
      if (p.size) { mask |= PATCH.size; fields.push([...p.size]); }
      if (p.props) { mask |= PATCH.props; fields.push(p.props.map((x) => [...x])); }
      if (p.layer !== undefined) { mask |= PATCH.layer; fields.push(p.layer); }
      if (p.group !== undefined) { mask |= PATCH.group; fields.push(p.group); }
      if (p.skin !== undefined) { mask |= PATCH.skin; fields.push(p.skin); }
      return [CODE.PartUpdate, op.id, mask, ...fields];
    }
    case 'PartRemove': return [CODE.PartRemove, [...op.ids]];
    case 'LinkAdd': return [CODE.LinkAdd, linkToWire(op.link)];
    case 'LinkUpdate': return [CODE.LinkUpdate, op.id, { ...op.patch }];
    case 'LinkRemove': return [CODE.LinkRemove, [...op.ids]];
    case 'EnvUpdate': return [CODE.EnvUpdate, { ...op.patch }];
    case 'NoteAdd': return [CODE.NoteAdd, op.note.id, [...op.note.pos], op.note.text, op.note.color];
    case 'NoteUpdate': return [CODE.NoteUpdate, op.id, { text: op.text, pos: op.pos, color: op.color }];
    case 'NoteRemove': return [CODE.NoteRemove, [...op.ids]];
    case 'GroupSet': return [CODE.GroupSet, op.id, op.name, op.parent, op.members ? [...op.members] : null];
    case 'LayerSet': return [CODE.LayerSet, op.id, op.name, op.flags];
    case 'ModuleSave': return [CODE.ModuleSave, op.id, op.name, op.blob];
    case 'ModulePlace': return [CODE.ModulePlace, op.moduleId, [...op.transform.pos, op.transform.quarter], op.idBase, op.count, op.layer];
    case 'Batch': return [CODE.Batch, op.ops.map(opToWire)];
    case 'TerrainStroke': return [CODE.TerrainStroke, op.stroke.brush, op.stroke.radius, op.stroke.strength, op.stroke.points.map((p) => [...p])];
    case 'TerrainPatch': return [CODE.TerrainPatch, ...patchToWire(op.patch)];
  }
}

function linkToWire(l: LinkRecord): Wire {
  return [l.id, l.kind, l.from ? [l.from.part, l.from.port] : null, l.to ? [l.to.part, l.to.port] : null,
    [...l.via], l.points.map((p) => [...p]), l.length, l.props ? l.props.map((x) => [...x]) : null];
}

export function opFromWire(w: unknown, depth = 0): Op {
  const a = arr(w, 'op');
  switch (a[0]) {
    case CODE.PartAdd: {
      const part: PartRecord = {
        id: id(a[1]), type: typeId(a[2]), pos: v3i32(a[3]), rot: rotFromWire(a[4]), flags: u16(a[5]),
        ...(a[6] != null ? { size: v3u16(a[6]) } : {}),
        ...(a[7] != null ? { props: props(a[7]) } : {}),
        ...(u32(a[8] ?? 0) ? { layer: u32(a[8]) } : {}),
        ...(u32(a[9] ?? 0) ? { group: u32(a[9]) } : {}),
        ...(u32(a[10] ?? 0) ? { skin: u32(a[10]) } : {}),
      };
      return { k: 'PartAdd', part };
    }
    case CODE.PartUpdate: {
      const mask = u16(a[2]);
      let i = 3;
      const next = (): unknown => a[i++];
      const patch: { -readonly [K in keyof PartPatch]: PartPatch[K] } = {};
      if (mask & PATCH.pos) patch.pos = v3i32(next());
      if (mask & PATCH.rot) patch.rot = rotFromWire(next());
      if (mask & PATCH.flags) patch.flags = u16(next());
      if (mask & PATCH.size) patch.size = v3u16(next());
      if (mask & PATCH.props) patch.props = props(next());
      if (mask & PATCH.layer) patch.layer = u32(next());
      if (mask & PATCH.group) patch.group = u32(next());
      if (mask & PATCH.skin) patch.skin = u32(next());
      return { k: 'PartUpdate', id: id(a[1]), patch };
    }
    case CODE.PartRemove: return { k: 'PartRemove', ids: ids(a[1]) };
    case CODE.LinkAdd: return { k: 'LinkAdd', link: linkFromWire(a[1]) };
    case CODE.LinkUpdate: {
      const o = obj(a[2], 'link patch');
      const patch: { -readonly [K in keyof LinkPatch]: LinkPatch[K] } = {};
      if ('from' in o) patch.from = end(o.from);
      if ('to' in o) patch.to = end(o.to);
      if ('via' in o) patch.via = ids(o.via);
      if ('points' in o) patch.points = points(o.points);
      if ('length' in o) patch.length = u32(o.length);
      if ('props' in o) patch.props = props(o.props);
      return { k: 'LinkUpdate', id: id(a[1]), patch };
    }
    case CODE.LinkRemove: return { k: 'LinkRemove', ids: ids(a[1]) };
    case CODE.EnvUpdate: return { k: 'EnvUpdate', patch: envPatch(a[1]) };
    case CODE.NoteAdd: return { k: 'NoteAdd', note: { id: id(a[1]), pos: v3i32(a[2]), text: text(a[3]), color: color(a[4]) } };
    case CODE.NoteUpdate: {
      const o = obj(a[2], 'note patch');
      return {
        k: 'NoteUpdate', id: id(a[1]),
        ...(o.text != null ? { text: text(o.text) } : {}),
        ...(o.pos != null ? { pos: v3i32(o.pos) } : {}),
        ...(o.color != null ? { color: color(o.color) } : {}),
      };
    }
    case CODE.NoteRemove: return { k: 'NoteRemove', ids: ids(a[1]) };
    case CODE.GroupSet: {
      const name = a[2] === null ? null : nameStr(a[2]);
      return { k: 'GroupSet', id: smallId(a[1]), name, parent: u32(a[3] ?? 0), members: a[4] == null ? null : ids(a[4]) };
    }
    case CODE.LayerSet: {
      const name = a[2] === null ? null : nameStr(a[2]);
      return { k: 'LayerSet', id: smallId(a[1]), name, flags: int(a[3] ?? 0, 0, 3, 'layer flags') };
    }
    case CODE.ModuleSave: {
      const blob = a[3];
      if (blob != null && !(blob instanceof Uint8Array)) throw new FormatError('module blob');
      if (blob instanceof Uint8Array && blob.length > MAX_BLOB) throw new FormatError('module too large');
      // a plain Uint8Array copy (Node's msgpackr hands back a Buffer view into the message)
      return { k: 'ModuleSave', id: smallId(a[1]), name: nameStr(a[2]), blob: blob instanceof Uint8Array ? new Uint8Array(blob) : null };
    }
    case CODE.ModulePlace: {
      const t = arr(a[2], 'module transform');
      if (t.length !== 4) throw new FormatError('module transform length');
      const quarter = int(t[3], 0, 3, 'quarter');
      const count = int(a[4], 1, MAX_MODULE_IDS, 'module id count');
      const idBase = int(a[3], 0, Number.MAX_SAFE_INTEGER - MAX_MODULE_IDS, 'idBase');
      return {
        k: 'ModulePlace', moduleId: smallId(a[1]), transform: { pos: [i32(t[0]), i32(t[1]), i32(t[2])], quarter: quarter as 0 | 1 | 2 | 3 },
        idBase, count, layer: u32(a[5] ?? 0),
      };
    }
    case CODE.Batch: {
      if (depth > 0) throw new FormatError('nested batch');
      const list = arr(a[1], 'batch');
      if (list.length > MAX_BATCH) throw new FormatError('batch too large');
      return { k: 'Batch', ops: list.map((x) => opFromWire(x, depth + 1)) };
    }
    case CODE.TerrainStroke: {
      const brush = int(a[1], 0, 3, 'brush') as TerrainStroke['brush'];
      const pts = arr(a[4], 'stroke points');
      if (pts.length < 1 || pts.length > 512) throw new FormatError('stroke points');
      // radius 0.5–40 m (pos units), strength 1–1000 ‰
      return { k: 'TerrainStroke', stroke: { brush, radius: int(a[2], 320, 25600, 'radius'), strength: int(a[3], 1, 1000, 'strength'), points: pts.map(v3i32) } };
    }
    case CODE.TerrainPatch: {
      const p = patchFromWire(a.slice(1));
      if (p.w * p.h > 1 << 20) throw new FormatError('terrain patch too large');
      return { k: 'TerrainPatch', patch: p };
    }
    default: throw new FormatError(`unknown op ${String(a[0])}`);
  }
}

function linkFromWire(w: unknown): LinkRecord {
  const a = arr(w, 'link');
  const kind = a[1];
  if (typeof kind !== 'string' || !(LinkKinds as readonly string[]).includes(kind)) throw new FormatError('link kind');
  return {
    id: id(a[0]), kind: kind as LinkKind, from: end(a[2]), to: end(a[3]), via: ids(a[4]),
    points: points(a[5]), length: u32(a[6]), ...(a[7] != null ? { props: props(a[7]) } : {}),
  };
}

// ---- validators ------------------------------------------------------------------------------
function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new FormatError(`${what}: expected array`);
  return v;
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FormatError(`${what}: expected map`);
  return v as Record<string, unknown>;
}
function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new FormatError(`${what} out of range`);
  return v;
}
const i16 = (v: unknown): number => int(v, -32768, 32767, 'i16');
const u16 = (v: unknown): number => int(v, 0, 65535, 'u16');
const u32 = (v: unknown): number => int(v, 0, 4294967295, 'u32');
const i32 = (v: unknown): number => int(v, -2147483648, 2147483647, 'i32');
const id = (v: unknown): PartId => int(v, 1, Number.MAX_SAFE_INTEGER, 'id');
function typeId(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(v)) throw new FormatError('type id');
  return v;
}
function v3i32(v: unknown): [number, number, number] {
  const a = arr(v, 'vec3');
  if (a.length !== 3) throw new FormatError('vec3 length');
  return [i32(a[0]), i32(a[1]), i32(a[2])];
}
function v3u16(v: unknown): [number, number, number] {
  const a = arr(v, 'size');
  if (a.length !== 3) throw new FormatError('size length');
  return [u16(a[0]), u16(a[1]), u16(a[2])];
}
function ids(v: unknown): PartId[] {
  const a = arr(v, 'ids');
  if (a.length > MAX_IDS) throw new FormatError('too many ids');
  return a.map(id);
}
function props(v: unknown): PropList {
  const a = arr(v, 'props');
  if (a.length > 64) throw new FormatError('too many props');
  const out = a.map((x) => {
    const p = arr(x, 'prop');
    return [int(p[0], 0, 63, 'prop index'), int(p[1], -2147483648, 2147483647, 'prop value')] as const;
  });
  for (let i = 1; i < out.length; i++) if (out[i]![0] <= out[i - 1]![0]) throw new FormatError('props not sorted');
  return out;
}
function end(v: unknown): LinkEnd | null {
  if (v == null) return null;
  const a = arr(v, 'link end');
  return { part: id(a[0]), port: int(a[1], 0, 63, 'port') };
}
function points(v: unknown): [number, number, number][] {
  const a = arr(v, 'points');
  if (a.length > MAX_POINTS) throw new FormatError('too many points');
  return a.map(v3i32);
}
function text(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_TEXT) throw new FormatError('text');
  return v;
}
const smallId = (v: unknown): number => int(v, 1, 4294967295, 'small id');
function nameStr(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(v)) throw new FormatError('name');
  return v;
}
function color(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-z]{1,16}$/.test(v)) throw new FormatError('color');
  return v;
}
/** W5 (M5): `env.wind` on the wire: speed 0–15 m/s in 0.1 steps, direction 0–359°, a gust profile; null / absent = none. */
function windSetting(v: unknown): EnvSettings['wind'] | undefined {
  if (v === null || v === undefined) return undefined;
  const w = obj(v, 'wind');
  const speed = int(typeof w.speed === 'number' ? Math.round(w.speed * 10) : w.speed, 0, 150, 'wind speed') / 10;
  const dir = int(w.dir ?? 0, 0, 359, 'wind dir');
  const g = w.gusts ?? 'none';
  if (g !== 'none' && g !== 'breezy' && g !== 'gusty' && g !== 'overcast') throw new FormatError('wind gusts');
  return { speed, dir, gusts: g };
}
function envPatch(v: unknown): Partial<EnvSettings> {
  const o = obj(v, 'env');
  const out: { -readonly [K in keyof EnvSettings]?: EnvSettings[K] } = {};
  if ('gravity' in o) out.gravity = int(typeof o.gravity === 'number' ? o.gravity * 2 : o.gravity, 0, 600, 'gravity') / 2; // W5 (M5): 0.5 % steps (Moon 16.5 %)
  if ('air' in o) out.air = int(o.air, 0, 300, 'air');
  if ('feel' in o) {
    if (o.feel !== 'real' && o.feel !== 'floaty' && o.feel !== 'snappy') throw new FormatError('feel');
    out.feel = o.feel;
  }
  if ('environment' in o) out.environment = typeId(o.environment);
  if ('sinkFill' in o) out.sinkFill = o.sinkFill === true; // MI (M4, D98); an undo of "never set" sends null = off
  // U5 (M5): the world's Matter switch; an undo of "never set" sends null = back to the header's simFlags
  if ('matter' in o) (out as { matter?: boolean | undefined }).matter = o.matter === true ? true : o.matter === false ? false : undefined;
  if ('zones' in o) out.zones = o.zones !== false; // W5 (M5): zero-g zones; an undo of "never set" sends null = on
  if ('wind' in o) (out as { wind?: EnvSettings['wind'] | undefined }).wind = windSetting(o.wind); // W5 (M5, D26): global wind; null = none
  if ('baseLights' in o) out.baseLights = o.baseLights === true; // W5 (M5): the Moon's "Base lights"; an undo of "never set" sends null = off
  if ('preset' in o) {
    const p = o.preset;
    if (p !== 'desk' && p !== 'room' && p !== 'warehouse' && p !== 'arena' && p !== 'megastructure') throw new FormatError('preset');
    out.preset = p;
  }
  return out;
}
