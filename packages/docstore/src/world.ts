// WorldDoc + atomic, validated op application (ARCHITECTURE §4). Shared by clients and the
// Host Server, so both sides accept and reject exactly the same ops.

import {
  DEFAULT_ENV, decodeModule, expandModule, moduleIdCount,
  type EnvSettings, type GroupRecord, type LayerRecord, type LinkRecord, type ModuleDef, type ModuleRecord, type NoteRecord, type Op,
  type PartId, type PartRecord, type WorldSnapshot,
} from '@knockon/format';
import { applyStroke, cloneTerrain, defaultTerrain, readPatch, writePatch, type TerrainRecord } from '@knockon/format'; // S3
import { DEFAULT_SIM_FLAGS, LEGACY_SIM_FLAGS, type SimFlags } from '@knockon/format'; // MI (M4)

export interface Caps {
  /** Max placed parts (session tier, GAME_SPEC §15.2). */
  readonly maxParts: number;
  /** Known part types; undefined = accept any well-formed type id (dev / tests). */
  readonly knownTypes?: ReadonlySet<string>;
}

export const DEFAULT_CAPS: Caps = { maxParts: 20_000 };

export class WorldDoc {
  readonly parts = new Map<PartId, PartRecord>();
  readonly links = new Map<PartId, LinkRecord>();
  readonly notes = new Map<PartId, NoteRecord>();
  /** Organisation (GAME_SPEC §7.4): groups, layers and stored modules. Editor state; the sim ignores it. */
  readonly groups = new Map<number, GroupRecord>();
  readonly layers = new Map<number, LayerRecord>();
  readonly modules = new Map<number, ModuleRecord>();
  env: EnvSettings = DEFAULT_ENV;
  /** S3: sculpted Backlot terrain (edited in place by strokes), null = the preset's default lot. */
  terrain: TerrainRecord | null = null;
  /** S3: bumps on every terrain change (the renderer and runs re-read it). */
  terrainRev = 0;
  /** MI (M4): sim flags (DATA_FORMATS §2.1): new worlds run Matter; files from before M4 load with it off. */
  private headerFlags: Required<SimFlags> = DEFAULT_SIM_FLAGS;
  /**
   * U5 (M5): the effective flags: the header's, with `env.matter` (Settings › World, an EnvUpdate) overriding
   * `matterGameplay` when set. Runs, `DocStore.confirmed()` and the header writer all read this.
   */
  get simFlags(): Required<SimFlags> {
    const m = this.env.matter;
    return typeof m !== 'boolean' || m === this.headerFlags.matterGameplay ? this.headerFlags : { ...this.headerFlags, matterGameplay: m };
  }
  set simFlags(f: Required<SimFlags>) { this.headerFlags = f; }
  /**
   * MI (M4): counts a world's Matter grains (sim matter/budget.ts matterGrains) for the header's counts.grains and
   * requiredTier. Set once by the app (the game and the host); docstore itself doesn't know the part types.
   */
  static countGrains: ((parts: readonly PartRecord[], env: EnvSettings) => number) | null = null;

  /** S3: the terrain a run or the renderer uses: the sculpted one for this preset, else the Backlot default (null off the Backlot). */
  activeTerrain(): TerrainRecord | null {
    if (this.env.environment !== 'backlot') return null;
    if (this.terrain && this.terrain.preset === this.env.preset) return this.terrain;
    return defaultTerrain(this.env.preset);
  }

  static fromSnapshot(s: WorldSnapshot): WorldDoc {
    const d = new WorldDoc();
    if (s.terrain) d.terrain = cloneTerrain(s.terrain);
    for (const p of s.parts) d.parts.set(p.id, p);
    for (const l of s.links) d.links.set(l.id, l);
    for (const n of s.notes) d.notes.set(n.id, n);
    for (const g of s.groups ?? []) d.groups.set(g.id, g);
    for (const l of s.layers ?? []) d.layers.set(l.id, l);
    for (const m of s.modules ?? []) d.modules.set(m.id, m);
    d.env = s.env;
    d.simFlags = { ...LEGACY_SIM_FLAGS, ...(s.simFlags ?? {}) }; // MI (M4)
    return d;
  }

  toSnapshot(base: Omit<WorldSnapshot, 'parts' | 'links' | 'notes' | 'env'>): WorldSnapshot {
    return {
      ...base, env: this.env, parts: [...this.parts.values()], links: [...this.links.values()], notes: [...this.notes.values()],
      groups: [...this.groups.values()], layers: [...this.layers.values()], modules: [...this.modules.values()],
      ...(this.terrain ? { terrain: this.terrain } : {}),
      simFlags: this.simFlags, // MI (M4)
      // U5 (M5): a world with Matter switched off spawns no grains, so its header doesn't ask for a bigger tier
      ...(WorldDoc.countGrains ? { grains: this.simFlags.matterGameplay ? WorldDoc.countGrains([...this.parts.values()], this.env) : 0 } : {}),
    };
  }

  /** A stored module, decoded (cached per blob). Throws FormatError if the blob is invalid. */
  moduleDef(id: number): ModuleDef | undefined {
    const m = this.modules.get(id);
    return m ? decodeCached(m.blob) : undefined;
  }

  /** Links attached to a part (as an endpoint or routed via it), in id order. */
  linksTouching(id: PartId): LinkRecord[] {
    const out: LinkRecord[] = [];
    for (const l of this.links.values()) {
      if (l.from?.part === id || l.to?.part === id || l.via.includes(id)) out.push(l);
    }
    return out.sort((a, b) => a.id - b.id);
  }
}

export type ApplyResult =
  | { readonly ok: true; readonly inverse: Op; readonly touched: readonly PartId[] }
  | { readonly ok: false; readonly reason: string };

class Reject extends Error {}

/**
 * Validate and apply `op` atomically. On success returns the inverse op (valid against the
 * post-apply state) and the ids it touched. On failure the doc is left unchanged.
 */
export function tryApply(doc: WorldDoc, op: Op, caps: Caps = DEFAULT_CAPS): ApplyResult {
  const undo: Op[] = [];
  const touched: PartId[] = [];
  try {
    applyInner(doc, op, caps, undo, touched);
  } catch (err) {
    if (!(err instanceof Reject)) throw err;
    for (let i = undo.length - 1; i >= 0; i--) applyInner(doc, undo[i]!, { maxParts: Infinity }, [], []);
    return { ok: false, reason: err.message };
  }
  const inverse: Op = undo.length === 1 ? undo[0]! : { k: 'Batch', ops: [...undo].reverse() };
  return { ok: true, inverse, touched };
}

function applyInner(doc: WorldDoc, op: Op, caps: Caps, undo: Op[], touched: PartId[]): void {
  switch (op.k) {
    case 'PartAdd': {
      const p = op.part;
      if (doc.parts.has(p.id) || doc.links.has(p.id) || doc.notes.has(p.id)) throw new Reject(`id ${p.id} exists`);
      if (caps.knownTypes && !caps.knownTypes.has(p.type)) throw new Reject(`unknown part type ${p.type}`);
      if (doc.parts.size >= caps.maxParts) throw new Reject('OVER_CAPACITY');
      doc.parts.set(p.id, p);
      undo.push({ k: 'PartRemove', ids: [p.id] });
      touched.push(p.id);
      return;
    }
    case 'PartUpdate': {
      const cur = doc.parts.get(op.id);
      if (!cur) throw new Reject(`no part ${op.id}`);
      const prev: Record<string, unknown> = {};
      const next: Record<string, unknown> = { ...cur };
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === undefined) continue;
        prev[key] = (cur as unknown as Record<string, unknown>)[key] ?? defaultFor(key);
        next[key] = value;
      }
      doc.parts.set(op.id, next as unknown as PartRecord);
      undo.push({ k: 'PartUpdate', id: op.id, patch: prev });
      touched.push(op.id);
      return;
    }
    case 'PartRemove': {
      const ids = [...new Set(op.ids)].sort((a, b) => a - b);
      for (const id of ids) if (!doc.parts.has(id)) throw new Reject(`no part ${id}`);
      const restore: Op[] = [];
      const linkIds = new Set<PartId>();
      for (const id of ids) for (const l of doc.linksTouching(id)) linkIds.add(l.id);
      for (const id of ids) { restore.push({ k: 'PartAdd', part: doc.parts.get(id)! }); doc.parts.delete(id); touched.push(id); }
      for (const lid of [...linkIds].sort((a, b) => a - b)) { restore.push({ k: 'LinkAdd', link: doc.links.get(lid)! }); doc.links.delete(lid); touched.push(lid); }
      undo.push(restore.length === 1 ? restore[0]! : { k: 'Batch', ops: restore });
      return;
    }
    case 'LinkAdd': {
      const l = op.link;
      if (doc.links.has(l.id) || doc.parts.has(l.id) || doc.notes.has(l.id)) throw new Reject(`id ${l.id} exists`);
      for (const end of [l.from, l.to]) if (end && !doc.parts.has(end.part)) throw new Reject(`link end ${end.part} missing`);
      for (const v of l.via) if (!doc.parts.has(v)) throw new Reject(`via ${v} missing`);
      if (l.points.length < 2 && !(l.from && l.to)) throw new Reject('link needs two ends or two points');
      doc.links.set(l.id, l);
      undo.push({ k: 'LinkRemove', ids: [l.id] });
      touched.push(l.id);
      return;
    }
    case 'LinkUpdate': {
      const cur = doc.links.get(op.id);
      if (!cur) throw new Reject(`no link ${op.id}`);
      const prev: Record<string, unknown> = {};
      const next: Record<string, unknown> = { ...cur };
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === undefined) continue;
        prev[key] = (cur as unknown as Record<string, unknown>)[key] ?? defaultFor(key);
        next[key] = value;
      }
      const nl = next as unknown as LinkRecord;
      for (const end of [nl.from, nl.to]) if (end && !doc.parts.has(end.part)) throw new Reject(`link end ${end.part} missing`);
      doc.links.set(op.id, nl);
      undo.push({ k: 'LinkUpdate', id: op.id, patch: prev });
      touched.push(op.id);
      return;
    }
    case 'LinkRemove': {
      const ids = [...new Set(op.ids)].sort((a, b) => a - b);
      for (const id of ids) if (!doc.links.has(id)) throw new Reject(`no link ${id}`);
      const restore: Op[] = ids.map((id) => ({ k: 'LinkAdd', link: doc.links.get(id)! }));
      for (const id of ids) { doc.links.delete(id); touched.push(id); }
      undo.push(restore.length === 1 ? restore[0]! : { k: 'Batch', ops: restore });
      return;
    }
    case 'EnvUpdate': {
      const prev: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) prev[key] = (doc.env as unknown as Record<string, unknown>)[key];
      doc.env = { ...doc.env, ...op.patch };
      undo.push({ k: 'EnvUpdate', patch: prev });
      return;
    }
    case 'NoteAdd': {
      const n = op.note;
      if (doc.notes.has(n.id) || doc.parts.has(n.id) || doc.links.has(n.id)) throw new Reject(`id ${n.id} exists`);
      doc.notes.set(n.id, n);
      undo.push({ k: 'NoteRemove', ids: [n.id] });
      touched.push(n.id);
      return;
    }
    case 'NoteUpdate': {
      const cur = doc.notes.get(op.id);
      if (!cur) throw new Reject(`no note ${op.id}`);
      doc.notes.set(op.id, {
        ...cur, ...(op.text !== undefined ? { text: op.text } : {}), ...(op.pos ? { pos: op.pos } : {}), ...(op.color ? { color: op.color } : {}),
      });
      undo.push({ k: 'NoteUpdate', id: op.id, text: cur.text, pos: cur.pos, color: cur.color });
      touched.push(op.id);
      return;
    }
    case 'NoteRemove': {
      const ids = [...new Set(op.ids)].sort((a, b) => a - b);
      for (const id of ids) if (!doc.notes.has(id)) throw new Reject(`no note ${id}`);
      const restore: Op[] = ids.map((id) => ({ k: 'NoteAdd', note: doc.notes.get(id)! }));
      for (const id of ids) { doc.notes.delete(id); touched.push(id); }
      undo.push(restore.length === 1 ? restore[0]! : { k: 'Batch', ops: restore });
      return;
    }
    case 'GroupSet': {
      const cur = doc.groups.get(op.id);
      if (op.name === null) {
        if (!cur) throw new Reject(`no group ${op.id}`);
        doc.groups.delete(op.id);
        undo.push({ k: 'GroupSet', id: cur.id, name: cur.name, parent: cur.parent, members: null });
        for (const p of [...doc.parts.values()].sort((a, b) => a.id - b.id)) if (p.group === op.id) setField(doc, p, 'group', 0, undo, touched);
        return;
      }
      if (op.parent !== 0) {
        if (op.parent === op.id || !doc.groups.has(op.parent)) throw new Reject(`bad group parent ${op.parent}`);
        for (let g = doc.groups.get(op.parent), n = 0; g && g.parent !== 0; g = doc.groups.get(g.parent), n++) {
          if (g.parent === op.id || n > 256) throw new Reject('group cycle');
        }
      }
      if (op.members) for (const m of op.members) if (!doc.parts.has(m)) throw new Reject(`no part ${m}`);
      doc.groups.set(op.id, { id: op.id, name: op.name, parent: op.parent });
      undo.push(cur ? { k: 'GroupSet', id: cur.id, name: cur.name, parent: cur.parent, members: null } : { k: 'GroupSet', id: op.id, name: null, parent: 0, members: null });
      if (op.members) {
        const want = new Set(op.members);
        for (const p of [...doc.parts.values()].sort((a, b) => a.id - b.id)) {
          if (want.has(p.id) && p.group !== op.id) setField(doc, p, 'group', op.id, undo, touched);
          else if (!want.has(p.id) && p.group === op.id) setField(doc, p, 'group', 0, undo, touched);
        }
      }
      return;
    }
    case 'LayerSet': {
      const cur = doc.layers.get(op.id);
      if (op.name === null) {
        if (!cur) throw new Reject(`no layer ${op.id}`);
        doc.layers.delete(op.id);
        undo.push({ k: 'LayerSet', id: cur.id, name: cur.name, flags: cur.flags });
        for (const p of [...doc.parts.values()].sort((a, b) => a.id - b.id)) if (p.layer === op.id) setField(doc, p, 'layer', 0, undo, touched);
        return;
      }
      doc.layers.set(op.id, { id: op.id, name: op.name, flags: op.flags });
      undo.push(cur ? { k: 'LayerSet', id: cur.id, name: cur.name, flags: cur.flags } : { k: 'LayerSet', id: op.id, name: null, flags: 0 });
      return;
    }
    case 'ModuleSave': {
      const cur = doc.modules.get(op.id);
      if (op.blob === null) {
        if (!cur) throw new Reject(`no module ${op.id}`);
        doc.modules.delete(op.id);
        undo.push({ k: 'ModuleSave', id: cur.id, name: cur.name, blob: cur.blob });
        return;
      }
      try { decodeCached(op.blob); } catch (err) { throw new Reject(`bad module: ${(err as Error).message}`); }
      doc.modules.set(op.id, { id: op.id, name: op.name, blob: op.blob });
      undo.push(cur ? { k: 'ModuleSave', id: cur.id, name: cur.name, blob: cur.blob } : { k: 'ModuleSave', id: op.id, name: op.name, blob: null });
      return;
    }
    case 'ModulePlace': {
      let def: ModuleDef | undefined;
      try { def = doc.moduleDef(op.moduleId); } catch (err) { throw new Reject(`bad module: ${(err as Error).message}`); }
      if (!def) throw new Reject(`no module ${op.moduleId}`);
      if (moduleIdCount(def) !== op.count) throw new Reject('module id count mismatch');
      const { parts, links } = expandModule(def, op.transform, op.idBase, op.layer);
      for (const part of parts) applyInner(doc, { k: 'PartAdd', part }, caps, undo, touched);
      for (const link of links) applyInner(doc, { k: 'LinkAdd', link }, caps, undo, touched);
      return;
    }
    case 'Batch': {
      for (const sub of op.ops) applyInner(doc, sub, caps, undo, touched);
      return;
    }
    // S3: Backlot sculpting (format terrain.ts): the first stroke copies the default lot into the doc
    case 'TerrainStroke': {
      if (doc.env.environment !== 'backlot') throw new Reject('the terrain tool works on the Backlot only');
      const t = editableTerrain(doc);
      if (!t) throw new Reject('this preset has no Backlot terrain');
      const before = applyStroke(t, op.stroke);
      if (!before) throw new Reject('stroke misses the terrain');
      doc.terrainRev++;
      undo.push({ k: 'TerrainPatch', patch: before });
      return;
    }
    case 'TerrainPatch': {
      const t = editableTerrain(doc);
      if (!t) throw new Reject('no terrain');
      const p = op.patch;
      if (p.x0 + p.w > t.nx || p.z0 + p.h > t.nz) throw new Reject('terrain patch out of range');
      const prev = readPatch(t, p.x0, p.z0, p.w, p.h);
      writePatch(t, p);
      doc.terrainRev++;
      undo.push({ k: 'TerrainPatch', patch: prev });
      return;
    }
  }
}

/** S3: the doc's own terrain for its preset, copied from the default lot on first edit. */
function editableTerrain(doc: WorldDoc): TerrainRecord | null {
  if (doc.terrain && doc.terrain.preset === doc.env.preset) return doc.terrain;
  const base = defaultTerrain(doc.env.preset);
  if (!base) return null;
  doc.terrain = cloneTerrain(base);
  return doc.terrain;
}

/** Set one organisation field on a part, recording the inverse. */
function setField(doc: WorldDoc, p: PartRecord, key: 'group' | 'layer', value: number, undo: Op[], touched: PartId[]): void {
  const next: Record<string, unknown> = { ...p };
  if (value) next[key] = value; else delete next[key];
  doc.parts.set(p.id, next as unknown as PartRecord);
  undo.push({ k: 'PartUpdate', id: p.id, patch: { [key]: p[key] ?? 0 } });
  touched.push(p.id);
}

const moduleCache = new WeakMap<Uint8Array, ModuleDef>();
function decodeCached(blob: Uint8Array): ModuleDef {
  let d = moduleCache.get(blob);
  if (!d) {
    d = decodeModule(blob);
    moduleCache.set(blob, d);
  }
  return d;
}

function defaultFor(key: string): unknown {
  switch (key) {
    case 'flags': case 'layer': case 'group': case 'skin': return 0;
    case 'props': return [];
    default: return undefined;
  }
}
