// Turns the document (build mode) or the running machine (run mode) into renderer instances, and
// draws links (cables, ropes, fuses, belts) and port markers as per-frame overlays.

import { posToMetres, type LinkRecord, type PartRecord } from '@knockon/format';
import { boundsOf, propValues, SPAWNABLE, type PartDef, type PortDef } from '@knockon/parts-data';
import { PartFlagBits, rotationToQuat, type BodyInfo } from '@knockon/sim';
import { CHANNEL_RGB, colorOf, MESH_ID, PLAYER_RGB, qmul, qrot, visualQuat, partDef, type Q4 } from './catalog.ts';
import type { InstanceData, Rgb, SceneItem } from './gfx/renderer.ts';
import { ARTICULATED, pieceLayout, RESIZE_REF, resizeNodes } from './gfx/resize.ts'; // R5 (M5): resizable and articulated art

export type V3 = [number, number, number];

export interface Pose { readonly pos: V3; readonly rot: Q4 }

/** G3 (M3): parts whose `piece` bodies are a pre-built pool (A3): drawn only while a slot is in play. */
export const POOL_PARTS: ReadonlySet<string> = new Set(['fabricator', 'skyshow', 'toast_cannon', 'henny']);
/** M4: pooled pieces drawn with another art's mesh (TOAST CANNON's flying slices, HENNY's eggs: YOLKs). */
const POOL_ART: Readonly<Record<string, string>> = { toast_cannon: 'toast_slice', henny: 'yolk' };

export function partPose(p: PartRecord): Pose {
  return { pos: [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])], rot: rotationToQuat(p.rot) as Q4 };
}

export function compose(pose: Pose, at: readonly number[] = [0, 0, 0], rot: Q4 = [0, 0, 0, 1]): Pose {
  const w = qrot(pose.rot, at);
  return { pos: [pose.pos[0] + w[0], pose.pos[1] + w[1], pose.pos[2] + w[2]], rot: qmul(pose.rot, rot) };
}

export interface LookOpts {
  readonly artMesh: (type: string) => number | null;
  readonly flags: number; // PartFlagBits (run mode) or build-mode stand-ins
  readonly meter?: number; // screen readout (Machine.partMeters), run mode
  /** R5 (M5): hide the part's state node (glbmesh.ts STATE_NODES: TOAST CANNON's loaded slices). */
  readonly stateHidden?: boolean;
}

/** R5 (M5): art state nodes by part type (the `<art>:<suffix>` meshes gfx/glbmesh.ts STATE_NODES registers). */
const STATE_MESH: Readonly<Record<string, string>> = { toast_cannon: 'slices' };

/**
 * R5 (M5, contract 6): TOAST CANNON's loaded slices show at rest and while toasting (`armed`), and hide once a launch
 * has put slices in play, until the next toast starts. `inPlay` = slice pieces of this toaster currently in play.
 */
export function toastSlicesHidden(flags: number, inPlay: boolean): boolean {
  return inPlay && (flags & PartFlagBits.armed) === 0;
}

/** Instances for one part, relative to `pose` (build: world pose; run: identity + body index). */
export function partItems(def: PartDef, p: PartRecord, pose: Pose, o: LookOpts, role: 'base' | 'arm' | 'piece' | 'all', body: number, outline: Rgb | null): SceneItem[] {
  const props = propValues(def, p.props);
  // a broken part is drawn by its chunks instead
  const dead = (o.flags & PartFlagBits.dead) !== 0 || (o.flags & PartFlagBits.broken) !== 0;
  const name = def.artFor ? def.artFor(props) : def.art;
  const art = name ? o.artMesh(name) : null;
  if (art !== null) {
    // C (M2): a part's pre-built piece body (cork, pop-up head) draws its `<art>:piece` mesh, or the def's
    // `on: 'piece'` visuals when the art has none; build mode shows it at rest with the rest of the part
    const piece = def.piece ? o.artMesh(`${name}:piece`) : null;
    const pieceGlass = piece !== null ? o.artMesh(`${name}:piece:glass`) : null;
    const pieceItems = (): SceneItem[] => (piece !== null
      ? [piece, pieceGlass].filter((m): m is number => m !== null).map((mesh) => ({ pos: pose.pos, rot: pose.rot, size: [1, 1, 1] as const, mesh, color: [1, 1, 1] as const, body, outline, hidden: dead }))
      : blockout(def, props, pose, o, 'piece', body, outline, dead, true));
    if (role === 'piece') return pieceItems();
    // art meshes are authored in part space; a hinged part's moving piece is a separate `<art>:arm` mesh
    const arm = def.hinge ? o.artMesh(`${name}:arm`) : null;
    const out: SceneItem[] = role === 'all' && piece !== null ? pieceItems() : [];
    const ap = def.artAt ? def.artAt(props) : null;
    const at = ap ? compose(pose, ap.at, visualQuat({ tiltZ: ap.tiltZ })) : pose;
    // R5 (M5): resizable art (FORCE WALL, STASIS FIELD) is drawn piece by piece, laid out for its size props (gfx/resize.ts)
    const pieces = RESIZE_REF[def.type] && name ? resizeNodes.get(name) : undefined;
    if (pieces?.length && role !== 'arm') {
      for (const pc of pieces) {
        const xf = pieceLayout(def.type, pc.node, pc.center, props);
        const w = compose(at, xf.shift);
        for (const suffix of ['', ':glass']) {
          const mesh = o.artMesh(`${name}:n:${pc.node}${suffix}`);
          if (mesh !== null) out.push({ pos: w.pos, rot: w.rot, size: xf.scale, mesh, color: [1, 1, 1], body, outline, hidden: dead });
        }
      }
      return out;
    }
    if (role !== 'arm') out.push({ pos: at.pos, rot: at.rot, size: [1, 1, 1], mesh: art, color: [1, 1, 1], body, outline, hidden: dead, screen: o.meter ?? 0 });
    const sm = role !== 'arm' && STATE_MESH[def.type] ? o.artMesh(`${name}:${STATE_MESH[def.type]}`) : null; // R5 (M5)
    if (sm !== null) out.push({ pos: at.pos, rot: at.rot, size: [1, 1, 1], mesh: sm, color: [1, 1, 1], body, outline, hidden: dead || o.stateHidden === true });
    if (arm !== null && role !== 'base') out.push({ pos: pose.pos, rot: pose.rot, size: [1, 1, 1], mesh: arm, color: [1, 1, 1], body, outline, hidden: dead });
    // C (M2): transmissive pieces (kn_poly_*, kn_glass) are separate `<mesh>:glass` meshes for the glass pass
    const glass = o.artMesh(`${name}:glass`), armGlass = arm !== null ? o.artMesh(`${name}:arm:glass`) : null;
    if (glass !== null && role !== 'arm') out.push({ pos: at.pos, rot: at.rot, size: [1, 1, 1], mesh: glass, color: [1, 1, 1], body, outline, hidden: dead });
    if (armGlass !== null && role !== 'base') out.push({ pos: pose.pos, rot: pose.rot, size: [1, 1, 1], mesh: armGlass, color: [1, 1, 1], body, outline, hidden: dead });
    if (arm !== null || !def.hinge) return out;
    // hinged part without arm art: art for the base, blockout for the moving piece
    return [...out, ...blockout(def, props, pose, o, role === 'all' ? 'arm' : role, body, outline, dead, true).filter((it) => it !== null)];
  }
  return blockout(def, props, pose, o, role, body, outline, dead, false);
}

function blockout(def: PartDef, props: ReturnType<typeof propValues>, pose: Pose, o: LookOpts, role: 'base' | 'arm' | 'piece' | 'all', body: number, outline: Rgb | null, dead: boolean, hasArt: boolean): SceneItem[] {
  if (role === 'base' && hasArt) return [];
  const out: SceneItem[] = [];
  for (const v of def.visuals(props)) {
    if (role !== 'all' && (v.on ?? 'base') !== role) continue;
    if (v.when === 'lit' && !(o.flags & PartFlagBits.lit)) continue;
    if (v.when === 'powered' && !(o.flags & PartFlagBits.powered)) continue;
    if (v.when === 'pressed' && !(o.flags & PartFlagBits.pressed)) continue;
    const w = compose(pose, v.at ?? [0, 0, 0], visualQuat(v));
    out.push({
      pos: w.pos, rot: w.rot, size: v.size, mesh: MESH_ID[v.mesh], color: colorOf(v.color), rough: v.rough ?? 0.5, metal: v.metal ?? 0,
      emissive: v.emissive ?? 0, bevel: v.mesh === 'box', body, outline: v.when ? null : outline, hidden: dead,
    });
  }
  return out;
}

/** Build-mode flags: what the part looks like at the start of a run. */
export function buildFlags(def: PartDef, p: PartRecord): number {
  const props = propValues(def, p.props);
  let f = 0;
  if (def.type === 'wick' && (props.lit ?? 1) === 1) f |= PartFlagBits.lit;
  if (def.type === 'mains' && (props.on ?? 1) === 1) f |= PartFlagBits.powered;
  return f;
}

export interface SceneBuild {
  /** Instance indices per part id (hover highlight uses the first). */
  readonly instances: Map<number, number[]>;
}

/** Critter types drawn GPU-skinned by gfx/critters.ts (stream C): the instance fills skip them. */
export const skinnedParts = new Set<string>();

export function fillBuildScene(data: InstanceData, parts: readonly PartRecord[], o: Omit<LookOpts, 'flags'>, outlineOf: (id: number) => Rgb | null): SceneBuild {
  const items: SceneItem[] = [];
  const instances = new Map<number, number[]>();
  for (const p of [...parts].sort((a, b) => a.id - b.id)) {
    const def = partDef(p.type);
    if (!def || skinnedParts.has(p.type)) continue;
    const list = partItems(def, p, partPose(p), { ...o, flags: buildFlags(def, p) }, 'all', -1, outlineOf(p.id));
    instances.set(p.id, list.map((_, k) => items.length + k));
    items.push(...list);
  }
  data.reset(items.length);
  items.forEach((it, i) => data.set(i, it));
  return { instances };
}

/** Run mode: instances are local to their bodies; the GPU composes them with the sim transforms. */
export function fillRunScene(data: InstanceData, bodies: readonly BodyInfo[], parts: ReadonlyMap<number, PartRecord>, partIndex: ReadonlyMap<number, number>,
  flags: Uint8Array, o: Omit<LookOpts, 'flags'>, meters: Uint8Array = new Uint8Array(0), inPlay?: (body: number) => boolean): void {
  const items: SceneItem[] = [];
  const identity: Pose = { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
  // R5 (M5): parts with a state node whose pieces are in play (TOAST CANNON: launched slices)
  const piecesLive = new Set<number>();
  if (inPlay) bodies.forEach((b, bi) => { if (b.role === 'piece' && STATE_MESH[b.type] && inPlay(bi)) piecesLive.add(b.part); });
  bodies.forEach((b, bi) => {
    const p = parts.get(b.part);
    const def = p ? partDef(p.type) : undefined;
    if (!p || !def) return;
    const f = flags[partIndex.get(b.part) ?? -1] ?? 0;
    const meter = meters[partIndex.get(b.part) ?? -1] ?? 0;
    if (b.role === 'chunk') {
      const show = (f & PartFlagBits.broken) !== 0 && (f & PartFlagBits.dead) === 0;
      // C (M2): pre-fractured art (FISHBOWL's .frac.glb): chunk k's part-space mesh on chunk body k
      const fr = def.art ? [o.artMesh(`${def.art}:chunk:${b.chunk ?? 0}`), o.artMesh(`${def.art}:chunk:${b.chunk ?? 0}:glass`)].filter((m): m is number => m !== null) : [];
      if (fr.length) {
        for (const mesh of fr) items.push({ pos: [0, 0, 0], size: [1, 1, 1], mesh, color: [1, 1, 1], body: bi, hidden: !show });
        return;
      }
      // fracture half: the part's main visual cut in two along its length, charred if it burnt
      const v = def.visuals(propValues(def, p.props))[0]!;
      items.push({ pos: [0, 0, 0], size: [v.size[0], v.size[1], v.size[2] / 2], mesh: MESH_ID[v.mesh], color: colorOf(v.color), rough: v.rough ?? 0.6, bevel: true, body: bi, hidden: !show });
      return;
    }
    // critters (contract 3): skinned critters and every ragdoll bone are drawn by gfx/critters.ts
    if (b.role !== 'base' && b.role !== 'arm' && b.role !== 'piece') return;
    // M4 (orchestrator): TOAST CANNON slices and HENNY's eggs (her `piece` pool, B4) draw the slice / YOLK art
    // while in play; checked before the skinned early-out below, which would hide a skinned critter's pieces
    const poolArt = b.role === 'piece' ? POOL_ART[p.type] : undefined;
    if (poolArt) {
      const live = inPlay ? inPlay(bi) : true;
      const mesh = o.artMesh(poolArt);
      const sd = partDef(poolArt);
      const its = mesh !== null
        ? [{ pos: [0, 0, 0] as V3, size: [1, 1, 1] as const, mesh, color: [1, 1, 1] as const, body: bi }]
        : sd ? partItems(sd, { id: p.id, type: poolArt, pos: p.pos, rot: p.rot, flags: 0 }, identity, { ...o, flags: 0, meter: 0 }, 'base', bi, null)
        : partItems(def, p, identity, { ...o, flags: f, meter }, 'piece', bi, null);
      for (const it of its) items.push(live ? it : { ...it, hidden: true });
      return;
    }
    if (skinnedParts.has(p.type)) return;
    // G3 (M3): pool pieces (FABRICATOR parts, SKYSHOW shells, A3) are drawn only while in play (dormant
    // slots wait parked 30 m under their part); a FABRICATOR slot draws the spawned part type's own mesh
    if (b.role === 'piece' && POOL_PARTS.has(p.type)) {
      const live = inPlay ? inPlay(bi) : true;
      const spawn = p.type === 'fabricator' ? SPAWNABLE[propValues(def, p.props)['part'] ?? 0] : undefined;
      const sd = spawn ? partDef(spawn) : undefined;
      const its = sd && spawn
        ? partItems(sd, { id: p.id, type: spawn, pos: p.pos, rot: p.rot, flags: 0 }, identity, { ...o, flags: 0, meter: 0 }, 'base', bi, null)
        : partItems(def, p, identity, { ...o, flags: f, meter }, 'piece', bi, null);
      for (const it of its) items.push(live ? it : { ...it, hidden: true });
      return;
    }
    // R5 (M5): GRABBER's links ride their own bodies (chunk k at −joint k); its base body draws only the base
    const ar = ARTICULATED[p.type];
    if (ar && def.art) {
      const dead = (f & (PartFlagBits.dead | PartFlagBits.broken)) !== 0;
      const k = b.chunk ?? 0;
      if (b.role === 'piece' && k >= ar.links.length) return; // PARTSIM (D120): GRABBER finger bodies (chunks 3, 4): the finger meshes ride link 2 (main.ts)
      const names = b.role === 'piece' ? (k < ar.links.length ? [`${def.art}:link:${k}`] : []) : b.role === 'base' ? [`${def.art}:runbase`] : [];
      const at: V3 = b.role === 'piece' ? [-ar.joints[k]![0], -ar.joints[k]![1], -ar.joints[k]![2]] : [0, 0, 0];
      const meshes = names.flatMap((n) => [o.artMesh(n), o.artMesh(`${n}:glass`)]).filter((m): m is number => m !== null);
      if (meshes.length) { for (const mesh of meshes) items.push({ pos: at, size: [1, 1, 1], mesh, color: [1, 1, 1], body: bi, hidden: dead }); return; }
    }
    const stateHidden = STATE_MESH[p.type] ? toastSlicesHidden(f, piecesLive.has(b.part)) : false; // R5 (M5)
    items.push(...partItems(def, p, identity, { ...o, flags: f, meter, stateHidden }, b.role, bi, null));
  });
  data.reset(items.length);
  items.forEach((it, i) => data.set(i, it));
}

// ---- ports and links -------------------------------------------------------------------------------

export type PoseOf = (partId: number, role: 'base' | 'arm') => Pose | null;

export function portWorld(def: PartDef, port: PortDef, poseOf: PoseOf, partId: number): V3 | null {
  const pose = poseOf(partId, port.on === 'arm' && def.hinge ? 'arm' : 'base');
  if (!pose) return null;
  return compose(pose, port.at).pos;
}

const CORD = colorOf('#4A3524'), BURNT = colorOf('#151515'), ROPE = colorOf('#C9A27A'), CABLE = colorOf('#2A2D34'), BAND = colorOf('#25272D');

function segment(a: V3, b: V3, thick: number, color: Rgb, emissive = 0): SceneItem | null {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return null;
  const y: V3 = [d[0] / len, d[1] / len, d[2] / len];
  // rotation taking +Y to y
  const dot = y[1];
  let q: Q4;
  if (dot < -0.9999) q = [1, 0, 0, 0];
  else {
    const c: V3 = [y[2], 0, -y[0]]; // (0,1,0) × y
    const s = Math.sqrt((1 + dot) * 2);
    q = [c[0] / s, c[1] / s, c[2] / s, s / 2];
  }
  return { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: q, size: [thick, len, thick], mesh: 2, color, rough: 0.7, emissive };
}

/** A drooping cable between two points (cosmetic catenary-ish sag). */
function cable(a: V3, b: V3, thick: number, color: Rgb, sag: number, out: SceneItem[], n = 10): void {
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    const s = segment(prev, p, thick, color);
    if (s) out.push(s);
    prev = p;
  }
}

export interface LinkDraw {
  readonly link: LinkRecord;
  readonly a: V3;
  readonly b: V3;
  /** Run state: [cut, burnA, burnB, burning]. */
  readonly state: readonly number[] | null;
}

/** Link geometry as overlay items, plus burning fuse fronts (for sparks). */
export function linkItems(links: readonly LinkDraw[], out: SceneItem[], fronts: V3[]): void {
  const start = out.length;
  linkItemsInner(links, out, fronts);
  // the x-ray view (renderer.setXray) shows links through geometry
  for (let k = start; k < out.length; k++) out[k] = { ...out[k]!, xray: true };
}

function linkItemsInner(links: readonly LinkDraw[], out: SceneItem[], fronts: V3[]): void {
  for (const { link, a, b, state } of links) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    switch (link.kind) {
      case 'cable_signal': cable(a, b, 0.005, mix(CABLE, CHANNEL_RGB.signal, 0.55), Math.min(0.15, len * 0.18), out); break;
      case 'cable_power': cable(a, b, 0.009, mix(CABLE, CHANNEL_RGB.power, 0.35), Math.min(0.15, len * 0.18), out); break;
      case 'band': case 'band_crossed': { const s = segment(a, b, 0.012, BAND); if (s) out.push(s); break; }
      case 'line': case 'chain': case 'bungee': {
        if (state && state[0]! > 0) break; // cut: the loose ends arrive with rope verlet (RENDERING §8)
        const s = segment(a, b, link.kind === 'chain' ? 0.014 : 0.01, ROPE);
        if (s) out.push(s);
        break;
      }
      case 'fuse': {
        // burnt from A up to burnA and from burnB to B; the rest is fresh cord
        const s0 = state ? state[1]! : 0, s1 = state ? state[2]! : 0;
        const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const burning = state && state[3]! > 0;
        if (!state || (s0 === 0 && s1 === 0)) { const s = segment(a, b, 0.006, CORD); if (s) out.push(s); break; }
        // one burnt interval [s0, s1] (fronts at both ends when lit mid-cord)
        const pieces: [number, number, Rgb][] = [[0, s0, CORD], [s0, s1, BURNT], [s1, 1, CORD]];
        for (const [x, y, c] of pieces) { if (y - x > 1e-3) { const s = segment(at(x), at(y), 0.006, c); if (s) out.push(s); } }
        if (burning) {
          if (s0 > 0) fronts.push(at(s0));
          if (s1 < 1) fronts.push(at(s1));
        }
        break;
      }
      default: { const s = segment(a, b, 0.006, CABLE); if (s) out.push(s); }
    }
  }
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Port markers: small glowing studs in channel colour (port rings arrive with final art). */
export function portItems(def: PartDef, partId: number, poseOf: PoseOf, out: SceneItem[], highlight: string | null, slot: number): void {
  for (const port of def.ports) {
    const w = portWorld(def, port, poseOf, partId);
    if (!w) continue;
    const hot = highlight === port.name;
    out.push({
      pos: w, size: hot ? [0.026, 0.026, 0.026] : [0.018, 0.018, 0.018], mesh: 1,
      color: hot ? PLAYER_RGB[slot]! : CHANNEL_RGB[port.channel], emissive: hot ? 0.8 : 0.5, rough: 0.3, xray: true,
    });
  }
}

export { boundsOf };
