// Modules in the client (HOW_TO_PLAY §3.6): save a selection as a module (ModuleSave), place one with
// deterministic id remapping (ModulePlace), and import/export `.knockmod` files (DATA_FORMATS §4).

import type { WorldDoc } from '@knockon/docstore';
import {
  decodeModule, encodeModule, expandModule, metresToPos, moduleFromSelection, moduleIdCount, posToMetres,
  type ModuleDef, type Op, type PartId, type PartRecord,
} from '@knockon/format';
import { propValues } from '@knockon/parts-data';
import { partDef } from '../catalog.ts';
import type { SceneItem } from '../gfx/renderer.ts';
import { boundsOf, compose, partItems, partPose, type Pose } from '../scene.ts';

export interface ModuleSummary {
  readonly id: number;
  readonly name: string;
  readonly parts: number;
  readonly links: number;
  readonly ports: readonly string[];
  readonly author: string;
  readonly types: readonly string[];
  readonly bad?: string;
}

export function summarise(doc: WorldDoc): ModuleSummary[] {
  return [...doc.modules.values()].sort((a, b) => a.id - b.id).map((m) => {
    try {
      const d = doc.moduleDef(m.id)!;
      return {
        id: m.id, name: m.name, parts: d.parts.length, links: d.links.length, ports: d.ports.map((p) => p.label), author: d.meta.author,
        types: [...new Set(d.parts.map((p) => p.type))],
      };
    } catch (err) {
      return { id: m.id, name: m.name, parts: 0, links: 0, ports: [], author: '', types: [], bad: (err as Error).message };
    }
  });
}

/** World AABB (metres) of some parts, from their definitions' bounds. */
export function partsBox(parts: readonly PartRecord[]): { min: [number, number, number]; max: [number, number, number] } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const def = partDef(p.type);
    const pose = partPose(p);
    const b = def ? boundsOf(def, propValues(def, p.props)) : { min: [-0.05, -0.05, -0.05], max: [0.05, 0.05, 0.05] };
    for (let c = 0; c < 8; c++) {
      const w = compose(pose, [c & 1 ? b.max[0]! : b.min[0]!, c & 2 ? b.max[1]! : b.min[1]!, c & 4 ? b.max[2]! : b.min[2]!]).pos;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * Build the module for a selection. The origin is the centre of the selection's footprint at its
 * lowest point, snapped to whole cells, so a placed module sits on whatever surface it's dropped on.
 */
export function moduleForSelection(doc: WorldDoc, ids: readonly PartId[], name: string, author: string): ModuleDef {
  const parts = ids.map((id) => doc.parts.get(id)).filter((p): p is PartRecord => !!p);
  const box = partsBox(parts);
  if (!box) throw new Error('Select at least one part');
  const cell = (m: number): number => Math.round(metresToPos(m) / 64) * 64;
  const origin: [number, number, number] = [cell((box.min[0] + box.max[0]) / 2), metresToPos(box.min[1]), cell((box.min[2] + box.max[2]) / 2)];
  return moduleFromSelection(doc.parts, doc.links, ids, {
    name, author, origin,
    portLabel: (p, i) => `${partDef(p.type)?.name ?? p.type} ${partDef(p.type)?.ports[i]?.name ?? `#${i}`}`,
  });
}

export function saveOp(id: number, def: ModuleDef): Op {
  return { k: 'ModuleSave', id, name: def.meta.name, blob: encodeModule(def) };
}

/** Where a module lands: snapped to the 10 cm grid in x/z, its base on the surface under the cursor. */
export function placementAt(point: readonly number[], fine: boolean): [number, number, number] {
  const step = fine ? 0.025 : 0.1;
  const s = (x: number): number => Math.round(x / step) * step;
  return [metresToPos(s(point[0]!)), metresToPos(point[1]!), metresToPos(s(point[2]!))];
}

/** The ModulePlace op: reserves `count` ids from the placing player's counter, in local id order. */
export function placeOp(def: ModuleDef, moduleId: number, pos: readonly [number, number, number], quarter: 0 | 1 | 2 | 3, layer: number, nextId: () => PartId): Op {
  const count = moduleIdCount(def);
  const first = nextId();
  for (let i = 1; i < count; i++) nextId();
  return { k: 'ModulePlace', moduleId, transform: { pos: [pos[0], pos[1], pos[2]], quarter }, idBase: first - 1, count, layer };
}

/** Translucent ghost of a module at a placement (the same expansion the op will do). */
export function ghostItems(def: ModuleDef, pos: readonly [number, number, number], quarter: 0 | 1 | 2 | 3, tint: readonly [number, number, number], artMesh: (t: string) => number | null): SceneItem[] {
  const { parts } = expandModule(def, { pos: [pos[0], pos[1], pos[2]], quarter }, 0);
  const out: SceneItem[] = [];
  for (const p of parts) {
    const d = partDef(p.type);
    if (!d) continue;
    const pose: Pose = partPose(p);
    for (const it of partItems(d, p, pose, { artMesh, flags: 0 }, 'all', -1, null)) out.push({ ...it, color: tint, alpha: 0.35, emissive: 0, outline: null });
  }
  return out;
}

export function exportFile(def: ModuleDef, blob: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${def.meta.name.replace(/[^\w .-]+/g, '_').trim() || 'module'}.knockmod`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick `.knockmod` files and decode them (validated; never partially loaded). */
export function importFiles(onModule: (def: ModuleDef, bytes: Uint8Array, file: string) => void, onError: (msg: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.knockmod,application/octet-stream';
  input.multiple = true;
  input.onchange = async () => {
    for (const f of [...(input.files ?? [])]) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        onModule(decodeModule(bytes), bytes, f.name);
      } catch (err) {
        onError(`${f.name}: ${(err as Error).message}`);
      }
    }
  };
  input.click();
}

export { posToMetres };
