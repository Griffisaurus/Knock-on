// R5 (M5): resizable art (E5a: FORCE WALL and STASIS FIELD are built at a reference size, with their pieces as separate glb
// nodes "so the engine can lay them out at any size"; future.md). gfx/glbmesh.ts registers each piece as its own mesh
// `<type>:n:<node>` in part space at the reference layout and records its LOD0 centre here; scene.ts places every piece
// for the part's size props with `pieceLayout`. The field surfaces themselves are engine-drawn (gfx/future).

type V3 = [number, number, number];

/**
 * Articulated parts whose links are sim `piece` bodies (A5's GRABBER: upper arm, forearm, gripper = chunks 0–2, each body's
 * origin on its joint, upright at the park pose). glbmesh.ts splits the art by each mesh's deepest pivot: `<type>:runbase`
 * (no pivot: drawn on the base body in a run), `<type>:turret` (under the turret pivot only: turns with the yaw, main.ts
 * draws it per frame), `<type>:link:<k>` (under link pivot k: drawn on chunk k at −joints[k]), all in part space at park.
 */
export interface Articulated {
  readonly turret: string;
  readonly links: readonly string[];
  readonly joints: readonly (readonly [number, number, number])[];
  /**
   * Slide pivots under the last link, driven from Machine.grabberJoints' finger opening per side (`<type>:finger:<f>`,
   * drawn per frame on that link's body): each slides along its part-space `axis` by (opening − rest), clamped to the
   * art's range (E5a: 0.01–0.04 m, modelled at the 0.06 default grip, rest 0.03).
   */
  readonly fingers?: { readonly pivots: readonly { readonly pivot: string; readonly axis: V3 }[]; readonly link: number; readonly rest: number; readonly min: number; readonly max: number };
}

export const ARTICULATED: Readonly<Record<string, Articulated>> = {
  grabber: {
    turret: 'PIVOT__yaw', links: ['PIVOT__shoulder', 'PIVOT__elbow', 'PIVOT__wrist_pitch'], joints: [[0, 0.1, 0], [0, 0.27, 0], [0, 0.42, 0]],
    fingers: { pivots: [{ pivot: 'PIVOT__finger_l', axis: [-1, 0, 0] }, { pivot: 'PIVOT__finger_r', axis: [1, 0, 0] }], link: 2, rest: 0.03, min: 0.01, max: 0.04 },
  },
};

/** Floats per GRABBER in Machine.grabberJoints (A5): [part index, yaw, shoulder, elbow, wrist pitch, wrist roll, finger opening per side, held]. */
export const GRABBER_JOINT_FLOATS = 8;

/** Part index (partIds order) → [finger opening per side (m), held] from Machine.grabberJoints. */
export function gripOf(joints: ArrayLike<number>): Map<number, { readonly open: number; readonly held: boolean }> {
  const out = new Map<number, { open: number; held: boolean }>();
  for (let o = 0; o + GRABBER_JOINT_FLOATS <= joints.length; o += GRABBER_JOINT_FLOATS) out.set(joints[o]!, { open: joints[o + 6]!, held: joints[o + 7]! > 0.5 });
  return out;
}

/** Where finger `f` of an articulated part draws, relative to its link body (part-space mesh at park): −joint + the slide. */
export function fingerOffset(type: string, f: number, open: number): V3 {
  const a = ARTICULATED[type]!, fg = a.fingers!, j = a.joints[fg.link]!, ax = fg.pivots[f]!.axis;
  const s = Math.max(fg.min, Math.min(fg.max, open)) - fg.rest;
  return [-j[0] + ax[0] * s, -j[1] + ax[1] * s, -j[2] + ax[2] * s];
}

/** Types laid out per size, with the reference size the art was built at (the defs' defaults). */
export const RESIZE_REF: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  force_wall: { width: 0.6, height: 0.4 },
  stasis_field: { width: 0.5, height: 0.5, depth: 0.5 },
};

/** Piece node → its LOD0 centre at the reference layout (filled by glbmesh.ts when the art loads). */
export const resizeNodes = new Map<string, { node: string; center: V3 }[]>();

/** Where a piece goes for these props: a shift (part space), a scale about the part origin, and the pivot it scales about. */
export interface PieceXf { readonly shift: V3; readonly scale: V3 }

/**
 * FORCE WALL: pylons move to x = ±(W/2 − 0.02); columns stretch to H − 0.055 (from their foot at y 0.04); caps ride the
 * top. STASIS FIELD: corner nodes move to the corners of W × D; rails stretch along their length and move out.
 * Decals ride the piece they sit on.
 */
export function pieceLayout(type: string, node: string, c: readonly number[], props: Readonly<Record<string, number>>): PieceXf {
  const ref = RESIZE_REF[type]!;
  if (type === 'force_wall') {
    const W = props.width ?? ref.width!, H = props.height ?? ref.height!;
    const dx = Math.sign(c[0]!) * (W - ref.width!) / 2;
    const s = Math.max(0.05, (H - 0.055) / (ref.height! - 0.055)), foot = 0.04;
    const n = node.replace(/^force_wall__/, '');
    if (n.startsWith('column')) return { shift: [dx, foot * (1 - s), 0], scale: [1, s, 1] };
    if (n.startsWith('cap')) return { shift: [dx, H - ref.height!, 0], scale: [1, 1, 1] };
    if (n.startsWith('decal') && c[1]! > 0.045) return { shift: [dx, (c[1]! - foot) * (s - 1), 0], scale: [1, 1, 1] };
    return { shift: [dx, 0, 0], scale: [1, 1, 1] };
  }
  // stasis_field
  const W = props.width ?? ref.width!, D = props.depth ?? ref.depth!;
  const ex = (W - ref.width!) / 2, ez = (D - ref.depth!) / 2;
  const n = node.replace(/^stasis_field__/, '');
  if (n.startsWith('rail')) {
    const alongX = Math.abs(c[2]!) > Math.abs(c[0]!);
    if (alongX) return { shift: [0, 0, Math.sign(c[2]!) * ez], scale: [Math.max(0.05, (W - 0.076) / (ref.width! - 0.076)), 1, 1] };
    return { shift: [Math.sign(c[0]!) * ex, 0, 0], scale: [1, 1, Math.max(0.05, (D - 0.076) / (ref.depth! - 0.076))] };
  }
  return { shift: [Math.sign(c[0]!) * ex, 0, Math.sign(c[2]!) * ez], scale: [1, 1, 1] };
}
