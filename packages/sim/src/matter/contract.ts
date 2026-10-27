// The Matter backend interface (M4_PLAN contract 1), as the sim sees it. MX publishes the canonical copy in
// `packages/matter/src/backend.ts` (conventions and units are documented there); the sim package doesn't depend on
// `@knockon/matter` (the backend is injected through MachineOptions.matter), so these types are kept structurally
// identical to it. If backend.ts changes, change this file to match (apps/game and the sim tests pass MX's
// backends in, so the TypeScript check catches drift).

export type MatterKind = 0 | 1 | 2 | 3; // sand, water, marble, goo (M5, X5)

/** All fixed point: positions in units (1/65,536 m), velocities in units per matter tick. */
export interface MatterProxy {
  id: number;
  shape: 0 | 1 | 2 | 3; // sphere, capsule, obb, plane
  pos: Int32Array;
  rot: Int32Array; // Q14 quaternion (x, y, z, w)
  size: Int32Array;
  vel: Int32Array;
  ang: Int32Array;
  dynamic: boolean;
}
export interface MatterEmit { seq: number; kind: MatterKind; count: number; pos: Int32Array; vel: Int32Array; spread: number; seed: number }
export interface MatterIntake { id: number; min: Int32Array; max: Int32Array; kindMask: number; capacity: number }
export interface MatterBlast { center: Int32Array; radius: number; impulse: number }
/** Requested from MX (optional): live grains of `kindMask` within `radius` (units) of `center`, answered in `near`. */
export interface MatterQuery { id: number; center: Int32Array; radius: number; kindMask: number }
/** D101: a water-surface map over an x–z grid (units; row-major iz × nx + ix), answered in `surface`. */
export interface MatterSurfaceReq { x0: number; z0: number; cell: number; nx: number; nz: number }
/** Per cell: water particles, highest / lowest centre y (SURFACE_EMPTY when none), mean velocity (units per matter tick). */
export interface MatterSurface extends MatterSurfaceReq { count: Int32Array; top: Int32Array; bottom: Int32Array; vel: Int32Array }
/** D104: a gravity zone (shape 0 vertical cylinder [radius, halfHeight, 0] about its mid-height centre, 1 box half
 * extents; units), `gravity` in Q8 units/substep² (the zero-g zones: 0). */
export interface MatterZone { shape: 0 | 1; center: Int32Array; size: Int32Array; gravity: number }
export interface MatterStepIn {
  tick: number; proxies: MatterProxy[]; emits: MatterEmit[]; intakes: MatterIntake[]; blasts: MatterBlast[]; queries?: MatterQuery[];
  surface?: MatterSurfaceReq;
  /** D104: the world's gravity in Q8 units/substep² (absent: Earth, 2,816, the M4 constant). */
  gravity?: number;
  /** D104: gravity zones, first match wins (the Hangar's zero-g zones). */
  zones?: MatterZone[];
}
export interface MatterStepOut {
  tick: number;
  impulses: { id: number; lin: Int32Array; ang: Int32Array }[];
  absorbed: { id: number; counts: Int32Array }[];
  counts: Int32Array;
  checksum: [number, number];
  /** MI request 2: live-particle bounds after the tick, min xyz then max xyz (units); all zero when empty. */
  bounds?: Int32Array;
  /** Answers to `queries` (optional, requested from MX): grains found and their centroid (units). */
  near?: { id: number; count: number; centroid: Int32Array }[];
  /** D101: the water-surface map, present when the input asked for one. */
  surface?: MatterSurface;
}

/** MX backend.ts: `top` / `bottom` of an empty surface cell, and the cells per map. */
export const SURFACE_EMPTY = -2147483648;
export const MAX_SURFACE_CELLS = 16384;

export interface MatterBackend {
  readonly kind: 'gpu' | 'cpu';
  init(cfg: { capacity: number; seed: number }): Promise<void>;
  step(input: MatterStepIn): Promise<MatterStepOut>;
  snapshot(): Promise<Uint8Array>;
  restore(bytes: Uint8Array): Promise<void>;
  view?(): unknown;
  destroy(): void;
}

/** MI request 1: the CPU backend's synchronous twins (Node: goldens, fuzz, soaks). */
export interface MatterBackendSync extends MatterBackend {
  initSync(cfg: { capacity: number; seed: number }): void;
  stepSync(input: MatterStepIn): MatterStepOut;
  snapshotSync(): Uint8Array;
  restoreSync(bytes: Uint8Array): void;
}

export function isSyncBackend(b: MatterBackend): b is MatterBackendSync {
  return typeof (b as Partial<MatterBackendSync>).stepSync === 'function'
    && typeof (b as Partial<MatterBackendSync>).snapshotSync === 'function'
    && typeof (b as Partial<MatterBackendSync>).restoreSync === 'function';
}
