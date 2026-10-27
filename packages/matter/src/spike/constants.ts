// Matter layer constants (SIMULATION §1, §8). Every value is an integer in matter units
// (1 unit = 1/65,536 m) or units per 60 Hz matter tick; the WGSL prelude is generated from these,
// so the CPU reference and the GPU kernels can never disagree on a constant.

export const UNITS_PER_METRE = 65536;
export const MATTER_HZ = 60;

/** Sand grain diameter: 256 units = 3.906 mm (the 4 mm grain rounded to a power of two so cell = x >> 8). */
export const GRAIN_D = 256;
export const GRAIN_R = GRAIN_D >> 1;
export const CELL_SHIFT = 8;

/**
 * Substeps per 60 Hz matter tick. One step per tick moves a resting column g·dt² = 0.7 grain
 * diameters into the floor, and 3 Jacobi passes can only push that back through ~3 layers, so piles
 * collapse into one overlapping layer. 4 substeps (g·dt² = 0.04 D) keep piles standing.
 * Velocities are stored in units per substep.
 */
export const SUBSTEPS = 4;
/** 9.81 m/s² / 240² × 65,536 = 11.2 units/substep². */
export const GRAVITY = 11;
/**
 * Per-component velocity clamp (CFL guard): half a grain diameter per substep (0.47 m/s). Faster
 * grains would tunnel through a neighbour layer; real speeds need more substeps (spike finding).
 */
export const VMAX = GRAIN_D >> 1;
/** Damping per substep v = v × 254 / 256, sign-symmetric (truncating) so small velocities decay to 0 both ways. */
export const DAMP_NUM = 254;
/**
 * Mass scaling (shock propagation): when one grain of a pair sits more than R/2 above the other,
 * it takes 3/4 of the correction and the lower one 1/4, so load reaches the floor in fewer passes.
 */
export const SPLIT_DY = GRAIN_R >> 1;
export const JACOBI_ITERATIONS = 3;

/**
 * Hashed grid of 2²² cells: key = (cx mod 128) | (cz mod 128) << 7 | (cy mod 256) << 14.
 * A modular hash never aliases two cells of one 3×3×3 neighbourhood, so neighbour keys are always
 * distinct; aliased far-away cells only add candidates that the distance test rejects.
 */
export const KEY_BITS = 22;
export const CELL_COUNT = 1 << KEY_BITS;
/** 8-bit LSD passes needed to cover KEY_BITS (a 4th pass over all-zero digits would be the identity). */
export const RADIX_PASSES = Math.ceil(KEY_BITS / 8);

/** Static scene for the spike: floor y = 0, walls at ±HALF_X / ±HALF_Z, one sphere and one box proxy. */
export const SCENE = {
  halfX: 16384, // 0.25 m
  halfZ: 16384,
  sphere: { x: -3277, y: 0, z: 2621, r: 5243 }, // dome of radius 0.08 m on the floor
  box: { x0: 5243, x1: 11796, y0: 0, y1: 3932, z0: -11796, z1: -5243 }, // 0.1 × 0.06 × 0.1 m block
} as const;

/** Initial lattice: spacing - 2 × jitter ≥ GRAIN_D, so no grains overlap at tick 0. */
export const LATTICE_SPACING = 320;
export const LATTICE_JITTER = 32;
export const LATTICE_Y0 = 6656; // just above the sphere top (5243 + R + jitter)

/*
 * Ranges the kernels rely on (all products stay below 2³¹, so no 16-bit split multiplies are needed):
 * - Positions are clamped to the container every iteration: |x|, |z| ≤ 16,256; 0 < y < 2¹⁶ for any
 *   lattice that fits the 1 m y-period of the key.
 * - Grain contacts are only evaluated when every |Δ| < GRAIN_D, so d² < 3 × 256² and Δ × pen × w < 2¹⁸.
 * - Sphere pushes are only evaluated when every |Δ| < r + R = 5,371: d² < 8.7e7 and Δ × pen < 2.9e7.
 * - |v| ≤ VMAX + container size, so v × DAMP_NUM < 2²⁴.
 * - Checksums are wrapping u32 sums / murmur mixes: overflow is the defined behaviour.
 */
