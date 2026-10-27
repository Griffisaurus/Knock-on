// World snapshot ↔ `.knockon` container (DATA_FORMATS §2). The PART section is columnar,
// delta + varint encoded; sections are deterministic so a doc state always yields identical bytes.

import { pack, unpack } from 'msgpackr';
import { xxh64 } from '@knockon/detmath';
import { ByteReader, ByteWriter, FormatError } from './bytes.ts';
import { type Container, Codec, decodeContainer, encodeContainer, section } from './container.ts';
import type { EnvSettings, GroupRecord, LayerRecord, LinkRecord, ModuleRecord, NoteRecord, PartRecord } from './model.ts';
import { DEFAULT_ENV, LEGACY_ENVIRONMENT } from './model.ts';
import { DEFAULT_SIM_FLAGS, readSimFlags, worldRequiredTier, type SimFlags } from './matter.ts'; // MI (M4)
import { opFromWire, opToWire, rotFromWire, rotToWire } from './ops.ts';
import type { Rotation } from './quantize.ts';
import { decodeTerrain, encodeTerrain, type TerrainRecord } from './terrain.ts'; // S3: TERR

export interface WorldSnapshot {
  readonly title: string;
  readonly simVersion: string;
  readonly tickRate: 60 | 120;
  readonly env: EnvSettings;
  readonly seed: readonly [number, number]; // two u32 words
  readonly parts: readonly PartRecord[];
  readonly links: readonly LinkRecord[];
  readonly notes: readonly NoteRecord[];
  readonly counters: Readonly<Record<string, number>>; // slot → next counter
  /** Organisation (GRUP) and stored modules (MODL). Editor-only: never part of the world hash. */
  readonly groups?: readonly GroupRecord[];
  readonly layers?: readonly LayerRecord[];
  readonly modules?: readonly ModuleRecord[];
  /** S3: sculpted Backlot terrain (TERR). Absent = the preset's default lot (terrain.ts defaultTerrain). */
  readonly terrain?: TerrainRecord | null;
  /** MI (M4): sim flags (header `simFlags`); absent = DEFAULT_SIM_FLAGS when writing, legacy (off) when a file lacks them. */
  readonly simFlags?: SimFlags;
  /** MI (M4): grains the world can ever have alive (header `counts.grains`, sim matter/budget.ts); sets `requiredTier`. */
  readonly grains?: number;
}

export const EMPTY_WORLD: WorldSnapshot = {
  title: 'Untitled machine', simVersion: '0.0.0-dev', tickRate: 120, env: DEFAULT_ENV,
  seed: [0x9e3779b9, 0x7f4a7c15], parts: [], links: [], notes: [], counters: {}, simFlags: DEFAULT_SIM_FLAGS, // MI (M4): new worlds run Matter
};

const HAS_SIZE = 1 << 6;
const HAS_PROPS = 1 << 7;
const HAS_SKIN = 1 << 8;
const FLAG_MASK = 0x3f | (1 << 9); // B5 (M5): + PartFlag.Tagged (bit 9; bits 6–8 are the HAS_* bits above)
const MAX_PARTS = 2_000_000;

function writeRot(w: ByteWriter, r: Rotation): void {
  w.u8(r.tag);
  if (r.tag === 1) w.i16(r.yaw).i16(r.pitch).i16(r.roll);
  else if (r.tag === 2) w.u8(r.index).i16(r.a).i16(r.b).i16(r.c);
}

function readRot(r: ByteReader): Rotation {
  const tag = r.u8();
  if (tag === 0) return { tag: 0 };
  if (tag === 1) return { tag: 1, yaw: r.i16(), pitch: r.i16(), roll: r.i16() };
  if (tag === 2) {
    const index = r.u8();
    if (index > 3) throw new FormatError('rot index');
    return { tag: 2, index: index as 0 | 1 | 2 | 3, a: r.i16(), b: r.i16(), c: r.i16() };
  }
  throw new FormatError('rot tag');
}

export function encodeParts(parts: readonly PartRecord[]): { types: string[]; data: Uint8Array } {
  const sorted = [...parts].sort((a, b) => a.id - b.id);
  const typeIndex = new Map<string, number>();
  const types: string[] = [];
  const w = new ByteWriter(64 + sorted.length * 20);
  w.varint(sorted.length);
  let prevId = 0;
  let prev: readonly [number, number, number] = [0, 0, 0];
  for (const p of sorted) {
    let ti = typeIndex.get(p.type);
    if (ti === undefined) { ti = types.length; types.push(p.type); typeIndex.set(p.type, ti); }
    let flags = p.flags & FLAG_MASK;
    if (p.size) flags |= HAS_SIZE;
    if (p.props && p.props.length) flags |= HAS_PROPS;
    if (p.skin) flags |= HAS_SKIN;
    w.varint(p.id - prevId).varint(ti);
    w.svarint(p.pos[0] - prev[0]).svarint(p.pos[1] - prev[1]).svarint(p.pos[2] - prev[2]);
    writeRot(w, p.rot);
    w.u16(flags);
    if (p.size) w.varint(p.size[0]).varint(p.size[1]).varint(p.size[2]);
    w.varint(p.layer ?? 0).varint(p.group ?? 0);
    if (p.skin) w.varint(p.skin);
    if (p.props && p.props.length) {
      w.varint(p.props.length);
      for (const [i, v] of p.props) w.varint(i).svarint(v);
    }
    prevId = p.id;
    prev = p.pos;
  }
  return { types, data: w.finish() };
}

export function decodeParts(types: readonly string[], data: Uint8Array): PartRecord[] {
  const r = new ByteReader(data);
  const n = r.varint();
  if (n > MAX_PARTS) throw new FormatError('too many parts');
  const out: PartRecord[] = [];
  let id = 0;
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const dId = r.varint();
    if (dId <= 0) throw new FormatError('part ids not ascending');
    id += dId;
    const ti = r.varint();
    const type = types[ti];
    if (type === undefined) throw new FormatError('bad type index');
    px += r.svarint(); py += r.svarint(); pz += r.svarint();
    const rot = readRot(r);
    const flagsAll = r.u16();
    const size = flagsAll & HAS_SIZE ? ([r.varint(), r.varint(), r.varint()] as const) : undefined;
    const layer = r.varint();
    const group = r.varint();
    const skin = flagsAll & HAS_SKIN ? r.varint() : 0;
    let props: (readonly [number, number])[] | undefined;
    if (flagsAll & HAS_PROPS) {
      const np = r.varint();
      if (np > 64) throw new FormatError('too many props');
      props = [];
      for (let k = 0; k < np; k++) props.push([r.varint(), r.svarint()]);
    }
    out.push({
      id, type, pos: [px, py, pz], rot, flags: flagsAll & FLAG_MASK,
      ...(size ? { size } : {}), ...(props ? { props } : {}),
      ...(layer ? { layer } : {}), ...(group ? { group } : {}), ...(skin ? { skin } : {}),
    });
  }
  if (r.remaining !== 0) throw new FormatError('trailing bytes in PART');
  return out;
}

function packSorted<T extends { id: number }>(items: readonly T[], toWire: (t: T) => unknown): Uint8Array {
  return pack([...items].sort((a, b) => a.id - b.id).map(toWire)) as Uint8Array;
}

/** Encode a world. `canonical` = run snapshot (no META/THMB), DATA_FORMATS §2.5. */
export function encodeWorld(wd: WorldSnapshot, opts: { canonical?: boolean; codec?: Codec } = {}): Uint8Array {
  const { types, data } = encodeParts(wd.parts);
  const linkBytes = packSorted(wd.links, (l) => opToWire({ k: 'LinkAdd', link: l }));
  const noteBytes = packSorted(wd.notes, (n) => opToWire({ k: 'NoteAdd', note: n }));
  const sections = [
    { tag: 'TYPE', data: pack(types) as Uint8Array },
    { tag: 'PART', data },
    { tag: 'LINK', data: linkBytes },
    { tag: 'NOTE', data: noteBytes },
    { tag: 'CNTR', data: pack(Object.fromEntries(Object.entries(wd.counters).sort())) as Uint8Array },
  ];
  // GRUP / MODL are editor state: kept in saves, left out of canonical run snapshots (DATA_FORMATS §2.5)
  if (!opts.canonical && (wd.groups?.length || wd.layers?.length)) sections.push({ tag: 'GRUP', data: encodeGroups(wd) });
  if (!opts.canonical && wd.modules?.length) {
    sections.push({ tag: 'MODL', data: pack([...wd.modules].sort((a, b) => a.id - b.id).map((m) => [m.id, m.name, m.blob])) as Uint8Array });
  }
  // S3: TERR is sim state (DATA_FORMATS §2.5): in saves and canonical snapshots, and in the world hash when present
  const terr = wd.terrain ? encodeTerrain(wd.terrain) : null;
  if (terr) sections.push({ tag: 'TERR', data: terr });
  const worldHash = xxh64(concat(terr ? [data, linkBytes, terr] : [data, linkBytes])).toString(16).padStart(16, '0');
  const header = {
    simVersion: wd.simVersion, tickRate: wd.tickRate, env: wd.env, seed: [...wd.seed],
    counts: { parts: wd.parts.length, links: wd.links.length, grains: wd.grains ?? 0 },
    // MI (M4): DATA_FORMATS §2.1 simFlags and requiredTier (the smallest GAME_SPEC §15.2 tier that holds the counts)
    simFlags: { ...DEFAULT_SIM_FLAGS, ...(wd.simFlags ?? {}) }, requiredTier: worldRequiredTier(wd.parts.length, wd.grains ?? 0, wd.env),
    title: wd.title, worldHash,
  };
  const container: Container = { magic: 'KNON', flags: opts.canonical ? 1 : 0, header, sections };
  return encodeContainer(container, opts.codec ?? Codec.Deflate);
}

export function decodeWorld(bytes: Uint8Array): WorldSnapshot {
  try {
    return decodeWorldInner(bytes);
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError(`world: ${(err as Error).message}`);
  }
}

function decodeWorldInner(bytes: Uint8Array): WorldSnapshot {
  const c = decodeContainer(bytes);
  if (c.magic !== 'KNON') throw new FormatError('not a world file');
  const typesRaw = unpack(req(c, 'TYPE')) as unknown;
  if (!Array.isArray(typesRaw) || !typesRaw.every((t) => typeof t === 'string')) throw new FormatError('TYPE');
  const parts = decodeParts(typesRaw as string[], req(c, 'PART'));
  const links = listOf(section(c, 'LINK')).map((w) => {
    const op = opFromWire(w);
    if (op.k !== 'LinkAdd') throw new FormatError('LINK');
    return op.link;
  });
  const notes = listOf(section(c, 'NOTE')).map((w) => {
    const op = opFromWire(w);
    if (op.k !== 'NoteAdd') throw new FormatError('NOTE');
    return op.note;
  });
  const h = c.header;
  const counters = (section(c, 'CNTR') ? unpack(section(c, 'CNTR')!) : {}) as Record<string, number>;
  const tickRate = h.tickRate === 60 ? 60 : 120;
  const seed = Array.isArray(h.seed) && h.seed.length === 2 ? [Number(h.seed[0]) >>> 0, Number(h.seed[1]) >>> 0] as const : EMPTY_WORLD.seed;
  const grup = section(c, 'GRUP') ? decodeGroups(section(c, 'GRUP')!) : { groups: [], layers: [] };
  const modules = listOf(section(c, 'MODL')).map((w): ModuleRecord => {
    const op = opFromWire([8, ...(Array.isArray(w) ? w : [])]);
    if (op.k !== 'ModuleSave' || !op.blob) throw new FormatError('MODL');
    return { id: op.id, name: op.name, blob: op.blob };
  });
  const terr = section(c, 'TERR');
  return {
    ...(terr ? { terrain: decodeTerrain(terr) } : {}),
    ...(grup.groups.length ? { groups: grup.groups } : {}),
    ...(grup.layers.length ? { layers: grup.layers } : {}),
    ...(modules.length ? { modules } : {}),
    title: typeof h.title === 'string' ? h.title.slice(0, 120) : EMPTY_WORLD.title,
    simVersion: typeof h.simVersion === 'string' ? h.simVersion : EMPTY_WORLD.simVersion,
    // a header without an environment predates the M3 defaults (Tinker Lab): it was a Studio world
    tickRate, env: { ...DEFAULT_ENV, environment: LEGACY_ENVIRONMENT, ...(typeof h.env === 'object' && h.env ? (h.env as Partial<EnvSettings>) : {}) },
    seed, parts, links, notes, counters,
    // MI (M4): a file from before M4 has no simFlags: Matter stays off for it (its machines keep their M2 behaviour)
    simFlags: readSimFlags(h.simFlags), grains: readGrains(h.counts),
  };
}

/** Hash of the canonical PART + LINK payloads (DATA_FORMATS §2.5). */
export function worldHash(wd: WorldSnapshot): string {
  const { data } = encodeParts(wd.parts);
  const linkBytes = packSorted(wd.links, (l) => opToWire({ k: 'LinkAdd', link: l }));
  const terr = wd.terrain ? encodeTerrain(wd.terrain) : null;
  return xxh64(concat(terr ? [data, linkBytes, terr] : [data, linkBytes])).toString(16).padStart(16, '0');
}

/** GRUP: `{groups: [id, name, parent, memberIds[], layer][], layers: [id, name, flags][]}` (memberIds from PART.group). */
function encodeGroups(wd: WorldSnapshot): Uint8Array {
  const members = new Map<number, number[]>();
  for (const p of [...wd.parts].sort((a, b) => a.id - b.id)) {
    if (!p.group) continue;
    const list = members.get(p.group) ?? [];
    list.push(p.id);
    members.set(p.group, list);
  }
  const groups = [...(wd.groups ?? [])].sort((a, b) => a.id - b.id).map((g) => [g.id, g.name, g.parent, members.get(g.id) ?? [], 0]);
  const layers = [...(wd.layers ?? [])].sort((a, b) => a.id - b.id).map((l) => [l.id, l.name, l.flags]);
  return pack({ groups, layers }) as Uint8Array;
}

function decodeGroups(b: Uint8Array): { groups: GroupRecord[]; layers: LayerRecord[] } {
  const v = unpack(b) as { groups?: unknown; layers?: unknown };
  if (typeof v !== 'object' || v === null) throw new FormatError('GRUP');
  const groups = (Array.isArray(v.groups) ? v.groups : []).map((g): GroupRecord => {
    const op = opFromWire([7, ...(Array.isArray(g) ? g.slice(0, 3) : []), null]);
    if (op.k !== 'GroupSet' || op.name === null) throw new FormatError('GRUP group');
    return { id: op.id, name: op.name, parent: op.parent };
  });
  const layers = (Array.isArray(v.layers) ? v.layers : []).map((l): LayerRecord => {
    const op = opFromWire([16, ...(Array.isArray(l) ? l : [])]);
    if (op.k !== 'LayerSet' || op.name === null) throw new FormatError('GRUP layer');
    return { id: op.id, name: op.name, flags: op.flags };
  });
  return { groups, layers };
}

/** MI (M4): counts.grains from a header (0 when absent or malformed). */
function readGrains(counts: unknown): number {
  const g = typeof counts === 'object' && counts !== null ? (counts as Record<string, unknown>).grains : 0;
  return typeof g === 'number' && Number.isSafeInteger(g) && g >= 0 ? g : 0;
}

function req(c: Container, tag: string): Uint8Array {
  const s = section(c, tag);
  if (!s) throw new FormatError(`missing section ${tag}`);
  return s;
}

function listOf(b: Uint8Array | undefined): unknown[] {
  if (!b) return [];
  const v = unpack(b) as unknown;
  if (!Array.isArray(v)) throw new FormatError('expected list');
  return v;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export { rotFromWire, rotToWire };
