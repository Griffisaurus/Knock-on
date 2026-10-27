// World persistence (MULTIPLAYER §11): compacted world.knockon + append-only journal + backups.

import { appendFileSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pack, unpack } from 'msgpackr';
import { ByteReader, ByteWriter, EMPTY_WORLD, crc32, decodeWorld, defaultEnvFor, encodeWorld, opFromWire, type Op, type WorldSnapshot } from '@knockon/format';

export interface WorldMeta {
  id: string;
  title: string;
  preset: string;
  seq: number; // seq included in world.knockon
  modified: number;
  parts: number;
}

export interface LoadedWorld {
  meta: WorldMeta;
  snapshot: WorldSnapshot;
  journal: { seq: number; slot: number; op: Op }[];
  /** S3: world.knockon as read: the join snapshot itself while no op has landed since (no re-encode). */
  bytes: Uint8Array;
}

export class WorldStore {
  readonly root: string;
  private journalFd: number | null = null;
  private journalWorld: string | null = null;

  constructor(dataDir: string) {
    this.root = join(dataDir, 'worlds');
    mkdirSync(this.root, { recursive: true });
  }

  private dir(id: string): string {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('bad world id');
    return join(this.root, id);
  }

  list(): WorldMeta[] {
    return readdirSync(this.root)
      .filter((d) => existsSync(join(this.root, d, 'meta.json')))
      .map((d) => JSON.parse(readFileSync(join(this.root, d, 'meta.json'), 'utf8')) as WorldMeta)
      .sort((a, b) => b.modified - a.modified);
  }

  create(title: string, preset = 'room'): WorldMeta {
    const id = `${slug(title)}-${Date.now().toString(36)}`;
    mkdirSync(join(this.dir(id), 'backups'), { recursive: true });
    // S3: each preset's default environment (Tinker Lab for Desk/Room, Studio, Backlot for Megastructure)
    const snapshot: WorldSnapshot = { ...EMPTY_WORLD, title, env: defaultEnvFor(preset as WorldSnapshot['env']['preset']) };
    const meta: WorldMeta = { id, title, preset, seq: 0, modified: Date.now(), parts: 0 };
    this.writeCompacted(meta, snapshot);
    return meta;
  }

  load(id: string): LoadedWorld {
    const d = this.dir(id);
    const meta = JSON.parse(readFileSync(join(d, 'meta.json'), 'utf8')) as WorldMeta;
    const bytes = new Uint8Array(readFileSync(join(d, 'world.knockon')));
    const snapshot = decodeWorld(bytes);
    const journal = readJournal(join(d, 'journal.oplog')).filter((e) => e.seq > meta.seq);
    return { meta, snapshot, journal, bytes };
  }

  /** S3: imports a decoded world as a new world (share links, uploads); returns its meta. */
  importWorld(snapshot: WorldSnapshot, title: string): WorldMeta {
    const id = `${slug(title)}-${Date.now().toString(36)}`;
    mkdirSync(join(this.dir(id), 'backups'), { recursive: true });
    const meta: WorldMeta = { id, title, preset: snapshot.env.preset, seq: 0, modified: Date.now(), parts: snapshot.parts.length };
    this.writeCompacted(meta, { ...snapshot, title });
    return meta;
  }

  /** Append one confirmed op. Synced to disk by `flush()` (called every second by the session). */
  append(id: string, seq: number, slot: number, opWire: unknown): void {
    const d = this.dir(id);
    if (this.journalWorld !== id) {
      this.closeJournal();
      this.journalFd = openSync(join(d, 'journal.oplog'), 'a');
      this.journalWorld = id;
    }
    const body = pack([seq, slot, Math.floor(Date.now() / 1000), opWire]) as Uint8Array;
    const w = new ByteWriter(body.length + 16);
    w.varint(body.length).bytes(body).u32(crc32(body));
    appendFileSync(this.journalFd!, w.finish());
  }

  flush(): void {
    if (this.journalFd !== null) fsyncSync(this.journalFd);
  }

  /** Write world.knockon atomically, update meta, truncate the journal, rotate backups. */
  compact(meta: WorldMeta, snapshot: WorldSnapshot, keepBackups: number): Uint8Array {
    const d = this.dir(meta.id);
    if (existsSync(join(d, 'world.knockon'))) {
      mkdirSync(join(d, 'backups'), { recursive: true });
      copyFileSync(join(d, 'world.knockon'), join(d, 'backups', `world-${Date.now()}.knockon`));
      const backups = readdirSync(join(d, 'backups')).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - keepBackups))) rmSync(join(d, 'backups', old));
    }
    const bytes = this.writeCompacted(meta, snapshot);
    this.closeJournal();
    writeFileSync(join(d, 'journal.oplog'), new Uint8Array(0));
    return bytes;
  }

  private writeCompacted(meta: WorldMeta, snapshot: WorldSnapshot): Uint8Array {
    const d = this.dir(meta.id);
    mkdirSync(d, { recursive: true });
    const bytes = encodeWorld(snapshot);
    writeFileSync(join(d, 'world.knockon.tmp'), bytes);
    renameSync(join(d, 'world.knockon.tmp'), join(d, 'world.knockon'));
    writeFileSync(join(d, 'meta.json'), JSON.stringify({ ...meta, parts: snapshot.parts.length, modified: Date.now() }, null, 1));
    return bytes;
  }

  closeJournal(): void {
    if (this.journalFd !== null) {
      fsyncSync(this.journalFd);
      closeSync(this.journalFd);
    }
    this.journalFd = null;
    this.journalWorld = null;
  }
}

/** Reads journal records until the end or the first truncated/corrupt record (crash-safe). */
export function readJournal(path: string): { seq: number; slot: number; op: Op }[] {
  if (!existsSync(path)) return [];
  const bytes = readFileSync(path);
  const r = new ByteReader(bytes);
  const out: { seq: number; slot: number; op: Op }[] = [];
  while (r.remaining > 0) {
    try {
      const len = r.varint();
      const body = r.bytes(len);
      if (crc32(body) !== r.u32()) break;
      const [seq, slot, , opWire] = unpack(body) as [number, number, number, unknown];
      out.push({ seq, slot, op: opFromWire(opWire) });
    } catch {
      break; // torn write at the tail: stop here
    }
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'world';
}
