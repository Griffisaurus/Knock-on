// The Matter backend interface (M4_PLAN contract 1). MX owns this file; MI, A4, B4, R4 and F4 code against it.
// Changing an existing member needs the orchestrator; optional members may be added (listed in M4_NOTES_MX).
//
// Conventions (all integers, SIMULATION §1 / §8):
// - Positions: units, 1 unit = 1/65,536 m (UNITS_PER_METRE). Engine axes (Y up).
// - Proxy `vel`: units per Matter tick (60 Hz). Proxy `ang`: rad per Matter tick × 65,536 (ANG_SCALE).
// - Proxy `rot`: unit quaternion in Q14 (x, y, z, w), 16,384 = 1.0.
// - Proxy `size`: sphere [r, 0, 0]; capsule [r, halfLength, 0] with its axis along local +Y (segment ± halfLength,
//   so the total length is 2 × (halfLength + r)); obb [hx, hy, hz] half extents; plane: unused, the plane passes
//   through `pos` with its normal = local +Y of `rot` and the solid side below it (a half-space).
// - Proxy `id`: opaque to the backend (MI packs body and sub-shape into it). Impulses are reported in input order
//   for the dynamic proxies only, with `ang` taken about the proxy's `pos`.
// - Impulse units: IMPULSE_LIN_NS N·s per `lin` unit and IMPULSE_ANG_NMS N·m·s per `ang` unit. The impulse is the
//   reaction the proxy's body receives from the particles during this Matter tick (summed over substeps with
//   64-bit carry, then arithmetic-shifted and truncated to i32).
// - Emit: `count` particles of `kind` on a cubic lattice centred on `pos` (spacing EMIT_SPACING[kind]), each with
//   integer hash jitter of up to EMIT_JITTER[kind] units, velocity `vel` (units per Matter tick) plus a per-particle
//   hash jitter of ±`spread` units per Matter tick per axis. `seed` and `seq` feed the jitter hash. Emits are
//   applied in `seq` order (MI: part order, then index); particles beyond `capacity` are dropped (the per-kind
//   counts show it). Capacity must be a property of the machine, never of the device (GAME_SPEC §6.3 rule 5).
// - Intake: an axis-aligned box [min, max) in world units. After the tick's substeps each live particle picks the
//   first intake in input order whose `kindMask` has its kind (bit k = kind k), whose `capacity` > 0 and whose box
//   contains it; each intake absorbs at most `capacity` of the particles that picked it this tick (lowest particle
//   index first; the rest stay). Absorbed particles are removed by stable compaction; `absorbed` reports per intake,
//   per kind, in input order.
// - Blast: radial velocity change at the start of the tick: Δv = `impulse` × (1 − d / radius) units per Matter tick
//   along (particle − center), for d < radius. radius ≤ 2^19 units (8 m), |impulse| ≤ 2^17.
// - Particles below KILL_Y or beyond ±KILL_XZ are removed (no intake reports them).
// - Gravity (D104, M5): `gravity` is the world's gravity in Q8 units per substep² (GRAVITY_Q8 = 2,816 = Earth, the
//   default when absent, which is exactly the M4 constant). Each substep every particle gets the same whole number of
//   units: g_s = ((G mod 256) × (S mod 256) mod 256 + G) >> 8 with S = tick × SUBSTEPS + substep (exact mean G / 256).
//   A particle whose substep-start position is inside a `zones` entry (first match in input order) gets that zone's
//   gravity instead (zero-g zones: 0). Zones: shape 0 = vertical cylinder (`size` = [radius, halfHeight, 0], centre at
//   mid-height), 1 = box (`size` = half extents); boundaries inclusive; the cylinder's radial test is on positions
//   >> 8 (3.9 mm), |size| ≤ ZONE_SIZE_MAX, ≤ MAX_ZONES per tick.
// - Goo (kind 3, M5): cohesive, viscous, sticky (constants.ts GOO_*): the drag it puts on proxies is ordinary reported
//   impulse.
// - Order inside a tick: blasts, emits, SUBSTEPS × (predict, sort, Jacobi solve + proxy collision, velocity),
//   intakes + kill + compaction, outputs (checksum, counts, bounds, grain queries, water surface).

export type MatterKind = 0 | 1 | 2 | 3; // sand, water, marble, goo (M5, appended: kind ids never move)

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
/** Grain query (orchestrator-approved addition for DUSTY): particles of `kindMask` with |p − center| < radius. */
export interface MatterQuery { id: number; center: Int32Array; radius: number; kindMask: number }
/**
 * Water-surface request (D101, optional): a 2D grid over x–z, cell (ix, iz) = [x0 + ix·cell, x0 + (ix + 1)·cell) ×
 * [z0 + iz·cell, …), row-major (index iz × nx + ix). SURFACE_CELL_MIN ≤ cell ≤ SURFACE_CELL_MAX, nx, nz ≥ 1,
 * nx × nz ≤ MAX_SURFACE_CELLS.
 */
export interface MatterSurfaceReq { x0: number; z0: number; cell: number; nx: number; nz: number }
/**
 * The water columns of a MatterSurfaceReq on the state after the tick (water particles only, by centre). Per cell:
 * `count` particles; `top` / `bottom` their highest / lowest centre y (units; SURFACE_EMPTY when count is 0); `vel`
 * x, y, z their mean velocity in units per Matter tick (64-bit sums of the per-substep velocities × SUBSTEPS ÷ count,
 * truncated toward zero; zeros when empty).
 */
export interface MatterSurface extends MatterSurfaceReq { count: Int32Array; top: Int32Array; bottom: Int32Array; vel: Int32Array }
/** A gravity zone (D104; the Hangar's zero-g zones): see the gravity rules above. `gravity` in Q8 units/substep². */
export interface MatterZone { shape: 0 | 1; center: Int32Array; size: Int32Array; gravity: number }
export interface MatterStepIn {
  tick: number; proxies: MatterProxy[]; emits: MatterEmit[]; intakes: MatterIntake[]; blasts: MatterBlast[];
  /** Optional, ≤ MAX_QUERIES per tick, evaluated on the state after the tick (radius ≤ 2^20 units = 16 m). */
  queries?: MatterQuery[];
  /** Optional water-surface map (D101): absent → no `surface` in the output and nothing else changes. */
  surface?: MatterSurfaceReq;
  /** World gravity in Q8 units/substep² (D104); absent → GRAVITY_Q8 (Earth, the M4 constant). 0 … GRAVITY_Q8_MAX. */
  gravity?: number;
  /** Gravity zones (D104), first match wins; absent or empty → none. */
  zones?: MatterZone[];
}
export interface MatterStepOut {
  tick: number;
  impulses: { id: number; lin: Int32Array; ang: Int32Array }[]; // dynamic proxies, input order
  absorbed: { id: number; counts: Int32Array }[]; // per intake (input order), per kind
  counts: Int32Array; // live particles per kind after the tick
  checksum: [number, number];
  /** MI request 2: live-particle bounds after the tick, min xyz then max xyz (units); all zero when empty. */
  bounds?: Int32Array;
  /**
   * One entry per input query (input order, present when `queries` was given): the count, and the centroid of those
   * particles (positions summed with 64-bit carry, divided truncating toward zero; zeros when count is 0).
   */
  near?: { id: number; count: number; centroid: Int32Array }[];
  /** Present when the input had `surface` (D101). */
  surface?: MatterSurface;
}

export interface MatterConfig { capacity: number; seed: number }

/** What R4 draws from (GPU backend only). Buffers are the canonical state after `tick`; see MatterGpu.view(). */
export interface MatterView {
  device: GPUDevice;
  /** array<i32>, stride 3: x, y, z in units. */
  pos: GPUBuffer;
  /** array<i32>, stride 3: velocity in units per SUBSTEP (× SUBSTEPS for units per Matter tick). */
  vel: GPUBuffer;
  /** array<u32>: bits 0–7 kind (MatterKind: 0 sand, 1 water, 2 marble, 3 goo), bits 8–31 reserved (0). */
  mat: GPUBuffer;
  /** Live particles = the first `count` entries; GPU-resident, so this is the count after the last completed step. */
  count: number;
  tick: number;
  /** array<u32>: [0] = live count of the newest submitted tick (GPU-resident; use for indirect draws). */
  state: GPUBuffer;
}

export interface MatterBackend {
  readonly kind: 'gpu' | 'cpu';
  init(cfg: MatterConfig): Promise<void>;
  step(input: MatterStepIn): Promise<MatterStepOut>; // results are consumed with the fixed latency (SIMULATION §8.5)
  /** The MATR payload (MATR_* below) of the state after every step issued before the call (later steps never leak in). */
  snapshot(): Promise<Uint8Array>;
  /** Takes effect for every step issued after the call; results of steps issued before it are unaffected. */
  restore(bytes: Uint8Array): Promise<void>;
  view?(): MatterView; // GPU only, for R4
  destroy(): void;
}

/** MI request 1: the CPU backend's synchronous twins (Node goldens, fuzz, soaks, headless hosts). */
export interface MatterBackendSync extends MatterBackend {
  initSync(cfg: MatterConfig): void;
  stepSync(input: MatterStepIn): MatterStepOut;
  snapshotSync(): Uint8Array;
  restoreSync(bytes: Uint8Array): void;
}

// Structural stand-ins so this file typechecks in Node (no @webgpu/types there). In the browser build these merge
// with @webgpu/types' real declarations.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface GPUDevice {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface GPUBuffer {}
}

// ---- units and per-kind constants -------------------------------------------------------------------------------

export const UNITS_PER_METRE = 65536;
export const MATTER_HZ = 60;
export const Q14 = 16384;
export const ANG_SCALE = 65536;
export const KIND_SAND = 0;
export const KIND_WATER = 1;
export const KIND_MARBLE = 2;
export const KIND_GOO = 3;
export const KIND_COUNT = 4;
/** Max grain queries per tick. */
export const MAX_QUERIES = 16;
/** Water-surface map limits (D101): cells per map, and the cell edge range in units (4 mm … 16 m). */
export const MAX_SURFACE_CELLS = 16384;
export const SURFACE_CELL_MIN = 256;
export const SURFACE_CELL_MAX = 1 << 20;
/** `top` / `bottom` of an empty surface cell. */
export const SURFACE_EMPTY = -2147483648;

/** N·s per impulse `lin` unit: (mass mg) × (units per substep) summed, >> 8 → 240 × 256 / 65,536 × 1e-6. */
export const IMPULSE_LIN_NS = 0.9375e-6;
/** N·m·s per impulse `ang` unit (lever arm in units, >> 24). */
export const IMPULSE_ANG_NMS = 0.9375e-6;

// ---- MATR payload (DATA_FORMATS §6 checkpoint section `MATR`) ----------------------------------------------------
// Little-endian. Header 32 bytes:
//   u32 magic 'MTR1' (0x3152544d) · u32 version (1) · u32 tick (Matter ticks stepped) · u32 count (live particles)
//   u32 capacity · u32 seed · u32 flags (0) · u32 reserved (0)
// then count × 3 i32 pos, count × 3 i32 vel (units per substep), count × u32 mat. Particle order is part of the state
// (it is the solver's sorted order), so a restore reproduces the run bit for bit. CPU and GPU snapshots of the same
// state are byte-identical.
export const MATR_MAGIC = 0x3152544d;
export const MATR_VERSION = 1;
export const MATR_HEADER_BYTES = 32;
