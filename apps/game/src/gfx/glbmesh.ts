// Art meshes from the pipeline (ASSET_PIPELINE §8) → mesh-library geometry: one Geometry per LOD,
// master-material factors baked per vertex. Textures arrive with the KTX2 step (deferred, M1+).
// Two masters are special: `kn_decal` texels sample the shared decal atlas at TEXCOORD_0, and `kn_screen`
// quads are drawn by the engine (cells and colour from the part's art.json `screens`, UV 0–1).
//
// Hinged parts (def.hinge) are two sim bodies that both start at the part origin. Their moving piece is
// exported under a `PIVOT__*` node sitting on the hinge axis; it is registered as `<type>:arm` (part space,
// rest pose) and left out of `<type>`, so scene.ts can draw it on the arm body. Pivots off the hinge axis
// (TREADWAY's idle drum) and pivots on parts with no hinge (button cap, MAINS lever) stay in `<type>`.
//
// Transmissive masters (kn_poly_*, kn_glass: the motor's shell, windows, bulbs, tinted blades) are split
// into `<mesh>:glass` meshes flagged for the renderer's sorted transmission pass (M2).

import { loadPartAssets, parseGlb, pivotOf, type ArtScreen, type GlbMesh, type ParsedGlb } from '@knockon/assets';
import { partDef, type HingeDef } from '@knockon/parts-data';
import { ART_BASE } from '../artlist.ts';
import { CHANNEL_RGB } from '../catalog.ts';
import { MAT_KIND, type Geometry } from './meshes.ts';
import { detailFor, EXEMPT, layerBytes, masterKind, texSetKind, type MaterialLook } from './look/materials.ts';
import { texSetsOf } from './look/textures.ts';
import { glbTangents, tangentCode } from './look/tangents.ts';
import { screenRgb, screenVm, type ScreenInfo } from './screens.ts'; // R5 (M5)
import { ARTICULATED, RESIZE_REF, resizeNodes } from './resize.ts'; // R5 (M5)
import type { Renderer } from './renderer.ts';

/** Transmissive masters: drawn by the glass pass, never opaque (they would hide the mechanism they show). */
export const GLASS_MASTER = /^kn_(poly_[a-z0-9_]+|glass|interior_glass)$/; // interior_glass: the cut faces of glass chunks

/**
 * R4 (M4): nodes the engine draws itself, never as part geometry: `CAVITY__*` volumes (the container fill pass,
 * gfx/matter/fill.ts) and the HOURGLASS sand stream (drawn by the fill pass only while it flows, matter.md).
 */
export const ENGINE_DRAWN = /^(CAVITY__|hourglass__stream(__L[1-3])?$|force_wall__field(__L[1-3])?$)/; // R5 (M5): + FORCE WALL's field (gfx/future draws it)

/** The art.json screen a `kn_screen` mesh draws (matched by name, else the part's first screen). */
function screenFor(m: GlbMesh, screens: readonly ArtScreen[]): ArtScreen | undefined {
  const bare = (n: string): string => n.replace(/^SCREEN__/, '');
  return screens.find((s) => m.nodeName.includes(bare(s.name)) || m.meshName.includes(bare(s.name))) ?? screens[0];
}

function screenColor(name: string | undefined): readonly number[] {
  return screenRgb(name); // R5 (M5): brand colours (beam, plasma…) as well as channels
}

/** LOD chain of the glb's opaque primitives, or (glass = true) of its transmissive ones. */
export function glbLods(glb: ParsedGlb, maxLods = 3, keep: (m: GlbMesh) => boolean = () => true, screens: readonly ArtScreen[] = [], glass = false, look?: MaterialLook): Geometry[] {
  const lods: Geometry[] = [];
  for (let lod = 0; lod < maxLods; lod++) {
    const meshes = glb.meshes.filter((m) => (m.lod === lod || (lod === 0 && m.lod === -1)) && keep(m) && !ENGINE_DRAWN.test(m.nodeName));
    if (!meshes.length) break;
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], mat: number[] = [], uv: number[] = [], idx: number[] = [];
    const tan: number[] = []; // L3 (M3): glTF tangent codes for textured primitives (look/tangents.ts)
    // shape keys (M2 part morphs, LOD0/LOD1): the union of the meshes' target names (PUFFER: pleats
    // sk_squash + spring sk_spring); rows only for moving vertices, zeros for keys their mesh lacks
    const names = [...new Set(meshes.flatMap((m) => m.targetNames))];
    const rowOf: number[] = [], table: number[] = [];
    for (const m of meshes) {
      for (const p of m.primitives) {
        const mt = glb.materials[p.material];
        if ((mt !== undefined && GLASS_MASTER.test(mt.name)) !== glass) continue;
        const base = pos.length / 3;
        const decal = mt?.name === 'kn_decal' && p.uvs !== null;
        const scr = mt?.name === 'kn_screen' && p.uvs !== null ? screenFor(m, screens) ?? { cells: 10, color: 'power' } as Partial<ArtScreen> : null;
        const c = scr ? [...screenColor(scr.color), 1] : decal ? [1, 1, 1, 1] : mt?.baseColorFactor ?? [1, 1, 1, 1];
        const e = mt && !scr ? Math.min(1, Math.max(...mt.emissiveFactor)) : 0;
        // R5 (M5): icon screens (RIFT GATE membrane, BUZZ BEACON) get the LED icon path (gfx/screens.ts)
        let vm = scr ? (scr.kind && scr.pos && scr.size ? screenVm(scr as ScreenInfo) : [Math.min(255, scr.cells ?? scr.digits ?? 10) / 255, 0, 0, MAT_KIND.screen])
          : [mt?.roughnessFactor ?? 0.5, mt?.metallicFactor ?? 0, e, decal ? MAT_KIND.decal : MAT_KIND.master];
        // L3 (M3, contract 1): masters carry their detail layer in the kind byte; textured ones their set's layer
        let texTan: Float32Array | null = null;
        if (!scr && !decal && mt) {
          const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (let k = 0; k < p.positions.length; k++) { lo[k % 3] = Math.min(lo[k % 3]!, p.positions[k]!); hi[k % 3] = Math.max(hi[k % 3]!, p.positions[k]!); }
          const detail = detailFor(mt.name, [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!]);
          // contract 1: the set covers the materials flagged extras.texSet (E3c; GlbMaterial.texSet)
          const layer = p.uvs && mt.texSet !== undefined && !EXEMPT.test(mt.name) ? look?.layer(mt.name) ?? -1 : -1;
          vm = layer >= 0 ? [...layerBytes(layer), e, texSetKind(detail)] : [vm[0]!, vm[1]!, e, masterKind(detail)];
          if (layer >= 0) texTan = look?.tangents?.get(m)?.[m.primitives.indexOf(p)] ?? null;
        }
        for (let i = 0; i < p.vertexCount; i++) {
          pos.push(p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
          if (p.normals) nrm.push(p.normals[i * 3]!, p.normals[i * 3 + 1]!, p.normals[i * 3 + 2]!);
          else nrm.push(0, 1, 0);
          col.push(c[0]!, c[1]!, c[2]!, c[3]!);
          mat.push(vm[0]!, vm[1]!, vm[2]!, vm[3]!);
          if (p.uvs) uv.push(p.uvs[i * 2]!, p.uvs[i * 2 + 1]!); else uv.push(0, 0);
          tan.push(texTan && p.normals ? tangentCode(p.normals.subarray(i * 3, i * 3 + 3), texTan.subarray(i * 4, i * 4 + 3), texTan[i * 4 + 3]!) : 0);
          let row = -1;
          if (names.length && p.targets.length && p.targets.length === m.targetNames.length) {
            let any = false;
            for (const tg of p.targets) for (let c = 0; c < 3 && !any; c++) if ((tg.positions?.[i * 3 + c] ?? 0) !== 0 || (tg.normals?.[i * 3 + c] ?? 0) !== 0) any = true;
            if (any) {
              row = table.length;
              for (const name of names) {
                const tg = p.targets[m.targetNames.indexOf(name)];
                for (const src of [tg?.positions, tg?.normals]) for (let c = 0; c < 3; c++) table.push(src?.[i * 3 + c] ?? 0);
              }
            }
          }
          rowOf.push(row);
        }
        for (const k of p.indices) idx.push(base + k);
      }
    }
    if (!idx.length) break;
    lods.push({
      positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx),
      colors: new Float32Array(col), mats: new Float32Array(mat), uvs: new Float32Array(uv),
      ...(tan.some((x) => x !== 0) ? { tangentCodes: new Float32Array(tan) } : {}),
      ...(names.length && table.length ? { morph: { names, rowOf: Int32Array.from(rowOf), table: new Float32Array(table) } } : {}),
    });
  }
  return lods;
}

/** Pivot nodes whose origin lies on the hinge axis line (within 2 mm): those carry the arm body's mesh. */
export function armPivots(glb: ParsedGlb, hinge: Pick<HingeDef, 'at' | 'axis'>): Set<number> {
  const out = new Set<number>();
  const [ax, ay, az] = hinge.axis;
  const len = Math.hypot(ax, ay, az) || 1;
  const u = [ax / len, ay / len, az / len];
  glb.nodes.forEach((n, i) => {
    if (!n.name.startsWith('PIVOT__')) return;
    const d = [n.matrix[12]! - hinge.at[0], n.matrix[13]! - hinge.at[1], n.matrix[14]! - hinge.at[2]];
    const t = d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
    if (Math.hypot(d[0]! - t * u[0]!, d[1]! - t * u[1]!, d[2]! - t * u[2]!) <= 0.002) out.add(i);
  });
  return out;
}

export interface SplitPart { base: Geometry[]; arm: Geometry[]; baseGlass: Geometry[]; armGlass: Geometry[]; piece: Geometry[]; pieceGlass: Geometry[]; state?: Geometry[] }

/**
 * R5 (M5): art nodes drawn only in some part states, kept out of `<type>` and registered as `<type>:<suffix>`; scene.ts
 * shows or hides them (TOAST CANNON's loaded slices hide once a launch has flown them, until the next toast starts).
 */
export const STATE_NODES: Readonly<Record<string, { readonly re: RegExp; readonly suffix: string }>> = {
  toast_cannon: { re: /^toast_cannon__slices(__L[1-3])?$/, suffix: 'slices' },
};

/** A part's spawned piece in its art (CORK BLASTER's `__cork`; GOTCHA BOX's `PIVOT__spring` subtree: the head
 * and the spring, whose `sk_stretch` keeps its foot on the lean plate while the pivot rides up with the head). */
const PIECE_NODE = /^(PIVOT__(head|cork|piece|spring)|[a-z0-9_]+__(cork|head|piece))$/;

/** Whether a mesh belongs to the part's piece body (itself or an ancestor is a piece node). */
export function isPieceMesh(glb: ParsedGlb, m: GlbMesh): boolean {
  for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) if (PIECE_NODE.test(glb.nodes[p]!.name.replace(/__L[1-3]$/, ''))) return true;
  return false;
}

/**
 * Splits a part glb into `<type>` (static), `<type>:arm` (moving) and, when the def has a pre-built piece
 * body, `<type>:piece` LOD chains, each with its glass.
 */
export function splitPart(glb: ParsedGlb, hinge: Pick<HingeDef, 'at' | 'axis'> | undefined, screens: readonly ArtScreen[] = [], hasPiece = false, look?: MaterialLook, stateNode?: RegExp): SplitPart {
  const arm = hinge ? armPivots(glb, hinge) : new Set<number>();
  const isState = (m: GlbMesh): boolean => stateNode !== undefined && stateNode.test(m.nodeName); // R5 (M5)
  const isPiece = (m: GlbMesh): boolean => hasPiece && isPieceMesh(glb, m);
  const isArm = (m: GlbMesh): boolean => !isPiece(m) && !isState(m) && arm.has(pivotOf(glb, m));
  const isBase = (m: GlbMesh): boolean => !isPiece(m) && !isArm(m) && !isState(m);
  return {
    base: glbLods(glb, 3, isBase, screens, false, look), arm: hinge ? glbLods(glb, 3, isArm, screens, false, look) : [],
    baseGlass: glbLods(glb, 3, isBase, screens, true), armGlass: hinge ? glbLods(glb, 3, isArm, screens, true) : [],
    piece: glbLods(glb, 3, isPiece, screens, false, look), pieceGlass: glbLods(glb, 3, isPiece, screens, true),
    ...(stateNode ? { state: glbLods(glb, 3, isState, screens, false, look) } : {}),
  };
}

/**
 * L3 (M3, contract 1): the part's texture set, when its `.art.json` lists one: loads the maps into the
 * look's arrays and returns its layer for the materials that sample it (glbLods checks `extras.texSet`).
 * Undefined when the part has no set (it keeps its master materials).
 */
export async function partTexLook(r: Renderer, type: string, glb?: ParsedGlb): Promise<MaterialLook | undefined> {
  const lp = r.lookPass;
  if (!lp) return undefined;
  try {
    const res = await fetch(`/parts/${type}/${type}.art.json`);
    if (!res.ok) return undefined;
    const sets = texSetsOf(await res.json());
    if (!sets.length) return undefined;
    const layer = await lp.tex.load(type, sets[0]!);
    if (layer < 0) return undefined;
    // E3c exports MikkTSpace TANGENT for textured parts (the bake's frame): read them from the raw file
    let tangents: Map<GlbMesh, (Float32Array | null)[]> | undefined;
    if (glb) {
      const gr = await fetch(`/parts/${type}/${type}.glb`);
      if (gr.ok) tangents = glbTangents(await gr.arrayBuffer(), glb);
    }
    return { layer: () => layer, ...(tangents ? { tangents } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * R5 (M5): each piece node of a resizable part (gfx/resize.ts) as its own mesh `<type>:n:<node>` (+ `:glass`), in part space
 * at the reference layout, with its LOD0 centre recorded for the layout.
 */
function registerPieces(r: Renderer, type: string, glb: ParsedGlb, screens: readonly ArtScreen[], look?: MaterialLook): void {
  const base = (n: string): string => n.replace(/__L[1-3]$/, '');
  const nodes = [...new Set(glb.meshes.filter((m) => m.lod <= 0 && m.nodeName.startsWith(`${type}__`) && !ENGINE_DRAWN.test(m.nodeName)).map((m) => base(m.nodeName)))];
  const list: { node: string; center: [number, number, number] }[] = [];
  for (const node of nodes) {
    const mine = (m: GlbMesh): boolean => base(m.nodeName) === node;
    const opaque = glbLods(glb, 3, mine, screens, false, look), glass = glbLods(glb, 3, mine, screens, true);
    const p0 = opaque[0]?.positions ?? glass[0]?.positions;
    if (!p0) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < p0.length; k++) { lo[k % 3] = Math.min(lo[k % 3]!, p0[k]!); hi[k % 3] = Math.max(hi[k % 3]!, p0[k]!); }
    if (opaque.length) r.addMesh(`${type}:n:${node}`, opaque, [0.05, 0.012]);
    if (glass.length) r.addMesh(`${type}:n:${node}:glass`, glass, [0.05, 0.012], { glass: true });
    list.push({ node, center: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] });
  }
  resizeNodes.set(type, list);
}

/** R5 (M5): the split for articulated parts (gfx/resize.ts ARTICULATED: GRABBER). */
function registerLinks(r: Renderer, type: string, glb: ParsedGlb, screens: readonly ArtScreen[], look?: MaterialLook): void {
  const a = ARTICULATED[type]!;
  const strip = (n: string): string => n.replace(/__L[1-3]$/, '');
  // −1 = no pivot (base), 0 = turret only, 1 + k = link k
  const group = (m: GlbMesh): number => {
    let best = -1;
    for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) {
      const n = strip(glb.nodes[p]!.name);
      const k = a.links.indexOf(n);
      if (k >= 0) best = Math.max(best, k + 1);
      else if (n === a.turret) best = Math.max(best, 0);
    }
    return best;
  };
  const add = (name: string, keep: (m: GlbMesh) => boolean): void => {
    const opaque = glbLods(glb, 3, keep, screens, false, look), glass = glbLods(glb, 3, keep, screens, true);
    if (opaque.length) r.addMesh(name, opaque, [0.05, 0.012]);
    if (glass.length) r.addMesh(`${name}:glass`, glass, [0.05, 0.012], { glass: true });
  };
  // the finger slide pivots (under the last link) are their own meshes, drawn per frame from Machine.grabberJoints
  const finger = (m: GlbMesh): number => {
    for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) {
      const f = a.fingers?.pivots.findIndex((x) => x.pivot === strip(glb.nodes[p]!.name)) ?? -1;
      if (f >= 0) return f;
    }
    return -1;
  };
  add(`${type}:runbase`, (m) => group(m) === -1);
  add(`${type}:turret`, (m) => group(m) === 0);
  a.links.forEach((_, k) => add(`${type}:link:${k}`, (m) => group(m) === k + 1 && finger(m) < 0));
  a.fingers?.pivots.forEach((_, f) => add(`${type}:finger:${f}`, (m) => finger(m) === f));
}

/** Parts with pre-fractured art (`<type>.frac.glb`): one chunk per sim `role: 'chunk'` body, in chunk order. */
export const FRACTURE_PARTS: readonly string[] = ['fishbowl'];

/**
 * The chunk index of every LOD0 mesh in a `.frac.glb`: by a `chunk_<n>` / `<n>` suffix on the chunk node
 * (itself or an ancestor), else by the order of the top-level chunk nodes.
 */
export function fracChunks(glb: ParsedGlb): Map<GlbMesh, number> {
  const out = new Map<GlbMesh, number>();
  const isLodNode = (i: number): boolean => /^LOD[0-3]$/.test(glb.nodes[i]!.name);
  // chunk roots: the highest non-LOD ancestor of each mesh
  const rootOf = (m: GlbMesh): number => {
    let r = m.node;
    for (let p = glb.nodes[m.node]!.parent; p !== -1 && !isLodNode(p); p = glb.nodes[p]!.parent) r = p;
    return r;
  };
  const meshes = glb.meshes.filter((m) => m.lod <= 0);
  const roots = [...new Set(meshes.map(rootOf))];
  const numbered = roots.map((r) => /(?:chunk[_-]?)?(\d+)(?:__L\d)?$/i.exec(glb.nodes[r]!.name));
  const byNumber = numbered.every((x) => x !== null) && new Set(numbered.map((x) => x![1])).size === roots.length;
  const sorted = byNumber ? [...roots].sort((a, b) => Number(numbered[roots.indexOf(a)]![1]) - Number(numbered[roots.indexOf(b)]![1])) : roots;
  for (const m of meshes) out.set(m, sorted.indexOf(rootOf(m)));
  return out;
}

/** Loads `/parts/<type>/<type>.frac.glb` and registers `<type>:chunk:<k>` (+ `:glass`) per chunk; false when absent. */
export async function loadFracMesh(r: Renderer, type: string): Promise<number> {
  try {
    const res = await fetch(`/parts/${type}/${type}.frac.glb`);
    if (!res.ok) return 0;
    const glb = parseGlb(await res.arrayBuffer());
    const chunks = fracChunks(glb);
    const n = Math.max(-1, ...chunks.values()) + 1;
    for (let k = 0; k < n; k++) {
      const mine = (m: GlbMesh): boolean => chunks.get(m) === k;
      const opaque = glbLods(glb, 1, mine), glass = glbLods(glb, 1, mine, [], true);
      // chunk meshes stay in part space: each chunk body starts at the part's pose (collider in part space)
      if (opaque.length) r.addMesh(`${type}:chunk:${k}`, opaque);
      if (glass.length) r.addMesh(`${type}:chunk:${k}:glass`, glass, [], { glass: true });
    }
    return n;
  } catch (e) {
    console.warn(`${type}.frac.glb:`, e);
    return 0;
  }
}

/** Loads `/parts/<type>/` and registers mesh `<type>` (+ `<type>:arm` for hinged parts); false when not built. */
export async function loadPartMesh(r: Renderer, type: string): Promise<boolean> {
  try {
    const a = await loadPartAssets(type, { baseUrl: '', fetch: (u) => fetch(u) });
    const def = partDef(ART_BASE[type] ?? type);
    const look = await partTexLook(r, type, a.glb); // L3 (M3): the part's texture set (+ tangents), if it has one
    const sn = STATE_NODES[type]; // R5 (M5)
    const { base, arm, baseGlass, armGlass, piece, pieceGlass, state } = splitPart(a.glb, def?.hinge, a.art.screens, def?.piece !== undefined, look, sn?.re);
    if (!base.length) return false;
    r.addMesh(type, base, [0.05, 0.012]);
    if (sn && state?.length) r.addMesh(`${type}:${sn.suffix}`, state, [0.05, 0.012]);
    if (RESIZE_REF[type]) registerPieces(r, type, a.glb, a.art.screens, look); // R5 (M5): FORCE WALL / STASIS FIELD at any size
    if (ARTICULATED[type]) registerLinks(r, type, a.glb, a.art.screens, look); // R5 (M5): GRABBER's links on their bodies
    if (arm.length) r.addMesh(`${type}:arm`, arm, [0.05, 0.012]);
    // scene.ts draws `<mesh>:glass` next to `<mesh>` (glass pass, LOD0 only)
    if (baseGlass.length) r.addMesh(`${type}:glass`, baseGlass, [0.05, 0.012], { glass: true });
    if (armGlass.length) r.addMesh(`${type}:arm:glass`, armGlass, [0.05, 0.012], { glass: true });
    // the pre-built piece body (cork, pop-up head): drawn on the piece body in a run, at rest in build mode
    if (piece.length) r.addMesh(`${type}:piece`, piece, [0.05, 0.012]);
    if (pieceGlass.length) r.addMesh(`${type}:piece:glass`, pieceGlass, [0.05, 0.012], { glass: true });
    // pre-fractured parts: one mesh per chunk body (scene.ts draws them while the part is broken)
    if (FRACTURE_PARTS.includes(type)) await loadFracMesh(r, type);
    return true;
  } catch {
    return false;
  }
}
