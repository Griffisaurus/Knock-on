// The D79 look per GPU tier (RENDERING §7 and §9 tables, D81 win-backs, D85 tier 32).
// One record per tier; the live governor (governor.ts) switches features off at run time on top of this.

export type LookTierId = 4 | 8 | 12 | 16 | 32;

export interface LookTier {
  /** Texture-set array size class (px): albedo, normal and ORM layers. */
  readonly texSize: 1024 | 2048;
  /** Tiling detail layer (wood grain, orange peel, pitting) and the procedural wood albedo. */
  readonly detail: boolean;
  /** Screen-space AO: 'ssao' (4 GB) or 'gtao' with this many slice directions × steps per side. */
  readonly ao: 'ssao' | 'gtao';
  readonly aoSlices: number;
  readonly aoSteps: number;
  /** Screen-space contact shadows for the key light (until G3's global SDF lands). */
  readonly contact: boolean;
  /** Froxel fog: 'haze' (uniform, no shafts) or 'shafts' (shadowed sun per froxel). */
  readonly fog: 'haze' | 'shafts';
  /** Froxel tile size in output pixels (D81 win-back 3: shafts at half resolution = 2 × the tile). */
  readonly froxelPx: number;
  readonly froxelZ: number;
  /** Tilt-shift DOF in Build and Run; gather resolution divisor (2 = half, 4 = quarter, D81 win-back 4). */
  readonly dof: boolean;
  readonly dofDiv: 2 | 4;
  /** Set IBL cube face size (prefiltered specular). */
  readonly iblSize: number;
  /** Static set shadow map (far cascade + froxel shafts); cached until the set changes (D81 win-back 2). */
  readonly setShadow: number;
}

export const LOOK_TIERS: Readonly<Record<LookTierId, LookTier>> = {
  4: { texSize: 1024, detail: true, ao: 'ssao', aoSlices: 1, aoSteps: 6, contact: false, fog: 'haze', froxelPx: 32, froxelZ: 32, dof: false, dofDiv: 4, iblSize: 64, setShadow: 1024 },
  8: { texSize: 1024, detail: true, ao: 'gtao', aoSlices: 2, aoSteps: 4, contact: false, fog: 'haze', froxelPx: 32, froxelZ: 32, dof: true, dofDiv: 4, iblSize: 128, setShadow: 2048 },
  12: { texSize: 2048, detail: true, ao: 'gtao', aoSlices: 2, aoSteps: 6, contact: true, fog: 'shafts', froxelPx: 32, froxelZ: 64, dof: true, dofDiv: 4, iblSize: 128, setShadow: 2048 },
  // D81: the 16 GB tier holds 16.6 ms at 4K with the full look; shafts at half resolution and DOF at quarter
  16: { texSize: 2048, detail: true, ao: 'gtao', aoSlices: 3, aoSteps: 6, contact: true, fog: 'shafts', froxelPx: 32, froxelZ: 64, dof: true, dofDiv: 4, iblSize: 256, setShadow: 4096 },
  // D85: tier 32 (RTX 5090 class) runs the full look at full resolution: shafts full-res, DOF half-res
  32: { texSize: 2048, detail: true, ao: 'gtao', aoSlices: 4, aoSteps: 8, contact: true, fog: 'shafts', froxelPx: 16, froxelZ: 128, dof: true, dofDiv: 2, iblSize: 256, setShadow: 4096 },
};

export function lookTier(t: number): LookTier {
  return LOOK_TIERS[(t >= 32 ? 32 : t >= 16 ? 16 : t >= 12 ? 12 : t >= 8 ? 8 : 4) as LookTierId];
}
