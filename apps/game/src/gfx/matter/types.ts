// Matter rendering inputs (M4 contract 3, stream R4). The Matter backend's GPU buffers are drawn straight from
// the renderer's GPUDevice (D92): nothing is copied to the CPU.
//
// Layout R4 reads (MX's `view()`; any field can be overridden by the view when MX's layout differs):
// - `pos`: array<i32>, `posStride` words per grain (default 3: x, y, z), units of 1/65,536 m, engine axes (Y up);
// - `vel`: array<i32>, `velStride` words per grain (default 3), units per matter substep; `velScale` converts to
//   m/s (default 240 / 65,536: 60 Hz × 4 substeps, packages/matter SUBSTEPS);
// - `mat`: array<u32>, one word per grain: bits 0–7 the MatterKind (0 sand, 1 water, 2 marble, 3 goo (X5, M5); anything
//   else is a free slot and isn't drawn), bits 8–15 a variant (marble: 0 GLINT glass, 1 BEARING steel; sand: tint id).
// `count` is the number of slots to scan (live grains plus free slots).

import type { V3 } from '../../math.ts';

export const UNITS_PER_METRE = 65536;
export const KIND_SAND = 0;
export const KIND_WATER = 1;
export const KIND_MARBLE = 2;
/** X5 (M5): goo, drawn by the screen-space fluid surface with the kn_slime look. */
export const KIND_GOO = 3;

/** SIMULATION §8 sizes (matter.md): sand Ø 3.9 mm (GRAIN_D 256 units), water 1 mL (r 6.2 mm), marble Ø 16 mm, goo r 8 mm. */
export const RADIUS = { sand: 128 / UNITS_PER_METRE, water: 0.0062, marble: 0.008, goo: 0.008 } as const;

export interface MatterView {
  readonly device: GPUDevice;
  readonly pos: GPUBuffer;
  readonly vel: GPUBuffer;
  readonly mat: GPUBuffer;
  readonly count: number;
  readonly tick: number;
  readonly posStride?: number;
  readonly velStride?: number;
  readonly velScale?: number;
}

/** Anything with the backend's optional `view()` (MX's GPU backend, MI's browser host, the dev page's synthetic source). */
export interface MatterViewSource {
  view?(): MatterView | null | undefined;
}

/**
 * The browser's Matter source. MI's host (apps/game/src/matterhost.ts) registers its backend here when it runs on the
 * renderer's device; the renderer only reads it. Null = no Matter: the Matter passes record nothing.
 */
let current: MatterViewSource | null = null;
export function setMatterSource(src: MatterViewSource | null): void { current = src; }
export function matterSource(): MatterViewSource | null { return current; }

/** Container fill profile (matter.md fill pass): flat (liquids at rest), crater (granular draining), pile (granular receiving). */
export type FillProfile = 'flat' | 'crater' | 'pile';

/** One container to draw this frame (main.ts builds the list from the parts and `fill(part)` in keyframes). */
export interface FillItem {
  /** Part type (its `CAVITY__` meshes come from the part's art, or the built-in fallback shapes). */
  readonly type: string;
  readonly pos: V3;
  readonly rot: readonly [number, number, number, number];
  /** Stored quantity 0–1 (HOURGLASS: the share in `CAVITY__top`; the rest is in `CAVITY__bottom`). */
  readonly fill: number;
  readonly profile?: FillProfile;
  /** Contents override (`sand` | `water` | `marble` | `goo`); default the cavity's `matter`. */
  readonly matter?: string;
  /** Contents flowing out of the spout this frame (HOURGLASS stream, crater depth). */
  readonly flowing?: boolean;
  /** Pose of the part's pivot body, for cavities that ride a pivot (SPRINKLE CAN's tilting can). */
  readonly pivotPose?: { readonly pos: V3; readonly rot: readonly [number, number, number, number] };
}
