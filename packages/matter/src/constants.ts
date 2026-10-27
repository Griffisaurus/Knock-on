// Matter solver constants (SIMULATION §8, D34, D93; goo and world gravity: M5 stream X5, D104). Every value is an integer in units (1/65,536 m), units per
// substep, Q-format fractions or milligrams. The WGSL prelude is generated from this file, so the CPU reference and
// the GPU kernels can never disagree on a constant. Any change here changes every Matter golden.

import { KIND_COUNT } from './backend.ts';

/**
 * Substeps per 60 Hz Matter tick (M0 deviation kept, documented in M4_NOTES_MX): with one step per tick gravity
 * alone moves a resting grain g·dt² = 0.7 diameters per tick and stacks collapse; 4 substeps (240 Hz) keep piles.
 * Grain velocities are stored in units per substep.
 */
export const SUBSTEPS = 4;
/** Jacobi iterations per substep (SIMULATION §8.2 step 5). */
export const ITERATIONS = 3;
/** 9.81 m/s² / 240² × 65,536 = 11.16 → 11 units/substep² (g = 9.67 m/s² after rounding). */
export const GRAVITY = 11;
/**
 * World gravity (D104) in Q8 units/substep²: 100 % = GRAVITY × 256 = 2,816, so an Earth world keeps the M4 constant bit
 * for bit (the 1.4 % shortfall against 9.81 m/s² is the M4 calibration, kept). Other worlds: gravityQ8 below. The
 * fraction is spread over substeps exactly (Bresenham on the global substep index, prep.ts gravitySteps), so the mean is
 * exact and every particle sees the same integer each substep.
 */
export const GRAVITY_Q8 = GRAVITY * 256;
/** Largest gravity a step may ask for (Q8): 2^16 ≈ 23 × Earth. */
export const GRAVITY_Q8_MAX = 1 << 16;
/**
 * A world gravity percentage as Q8 gravity (D104; the sim's units.ts matterGravityQ8 is the same function). The damping
 * truncates toward zero, which takes a whole unit per substep from any slow grain (under 0.63 m/s) and about half a unit
 * from a fast one, whatever the gravity; the M4 Earth calibration includes that loss. So every world keeps ¾ of a unit
 * (192) and scales the rest: G = 192 + 2,624 × p. Earth is exactly GRAVITY_Q8, Moon 16.5 % → 625, Hangar 38 % → 1,189,
 * 0 % exactly 0. Measured: drop times over 5–50 cm are the Earth ones × 1/√p within 4 % (test/matter.test.ts).
 */
export function gravityQ8(percent: number): number {
  if (!(percent > 0)) return 0;
  return Math.min(GRAVITY_Q8_MAX, Math.round(192 + (2624 * percent) / 100));
}
/** Gravity zones per tick (zero-g zones, D104), and their largest radius / half extent in units (64 m). */
export const MAX_ZONES = 16;
export const ZONE_SIZE_MAX = 1 << 22;
/** Zone records in the packed tick: shape, centre xyz, size xyz, 0, then the zone's gravity for each substep. */
export const ZONE_STRIDE = 12;
/**
 * Velocity clamp per component, units per substep (CFL guard): 512 = 1.875 m/s ≈ 2 sand diameters per substep.
 * The M0 spike's 128 (0.47 m/s) made falls look like syrup; contact stability above this needs more substeps.
 */
export const VMAX = 512;
/** Per-iteration clamp on a particle's displacement since the substep start (keeps every product in range). */
export const DMAX = 1024;
/** Damping per substep, v × 1018 / 1024 (≈ SIMULATION's 250/256 per 60 Hz tick: 0.99414⁴ = 0.9768). */
export const DAMP_NUM = 1018;
export const DAMP_SHIFT = 10;

// ---- particle kinds (index = MatterKind) ---------------------------------------------------------------------

/**
 * Contact radius in units: sand ⌀ 4 mm (131 = 1.999 mm), water 6.2 mm (1 mL sphere), marble ⌀ 16 mm (524 = 7.996 mm),
 * goo 8 mm (524; its particles rest GOO_REST apart, closer than two radii, like water's).
 */
export const RADIUS: readonly number[] = [131, 406, 524, 524];
/**
 * Particle mass in mg: sand quartz grain 88.8 mg, water 1 mL = 1,000 mg, marble glass ⌀ 16 mm ≈ 5,362 mg, goo 1/470 L
 * of slime at 1,050 kg/m³ ≈ 2,234 mg (denser than water: goo sinks in it, slowly).
 */
export const MASS_MG: readonly number[] = [89, 1000, 5362, 2234];
/**
 * Friction coefficients in Q8 (256 = 1.0): static / kinetic. Water is frictionless (the fluid solve handles it); so is
 * goo, whose shear is its viscosity (GOO_VISC) and whose grip on surfaces is the wall stick (GOO_STICK).
 */
export const MU_S: readonly number[] = [166, 0, 77, 0];
export const MU_K: readonly number[] = [128, 0, 51, 0];

/**
 * Neighbour grid per kind. Each kind has its own hashed grid with cell = the largest same-kind interaction range
 * (sand: contact distance 262; water: the fluid kernel radius WATER_H; marble: contact distance 1,048). Cross-kind
 * pairs are found by the larger kind searching the smaller kind's grid over (r_big + r_small), so 4M sand grains
 * never pay for a marble-sized cell (the cell-size strategy for mixed sizes, M4_NOTES_MX).
 * Cell coordinates are u = (x xor 2³¹) / CELL, i.e. offset-binary, so floor division never sees a negative number.
 * key = BASE + (ux mod 2^XB) | (rowHash(kind, ux >> XB, uy, uz) mod 2^RB) << XB: runs of 2^XB consecutive x cells keep
 * consecutive keys (one contiguous slot range per row segment, and warps of sorted particles share their rows), while
 * everything else is hashed, so aliasing is random at the table's load factor instead of periodic. A 32-bit tag of
 * (kind, ux >> XB, uy, uz) rejects aliased cells, so aliasing only ever costs time, never a wrong pair.
 */
export const CELL: readonly number[] = [262, 1048, 1048, 1140];
export const KEY_XB: readonly number[] = [4, 3, 3, 3];
export const KEY_RB: readonly number[] = [19, 17, 17, 17];
/** Goo (kind 3, M5) is appended after marble, so the sand, water and marble keys (and so their runs) are unchanged. */
export const KEY_BASE: readonly number[] = [0, 1 << 23, (1 << 23) + (1 << 20), (1 << 23) + (1 << 21)];
/** Keys in use; index TABLE is the end sentinel of the cell-start table (so cellStart has TABLE + 1 entries). */
export const TABLE = (1 << 23) + (1 << 21) + (1 << 20);

// ---- pair shares and contact model -------------------------------------------------------------------------------

/**
 * Share of a contact correction taken by the first particle of a pair, in 256ths. Same kind: mass scaling for
 * shock propagation — in a stacked pair (contact normal within 45° of vertical) the upper particle takes 3/4, the
 * lower 1/4, else 1/2. (A height-difference rule made same-layer neighbours on a slope count as stacked and drifted a
 * compressed bed upslope.) Cross kind: inverse-mass weighting, share_i = m_j / (m_i + m_j).
 */
export function crossShare(ki: number, kj: number): number {
  const mi = MASS_MG[ki]!, mj = MASS_MG[kj]!;
  return Math.floor((mj * 256 + ((mi + mj) >> 1)) / (mi + mj));
}

// ---- water: position-based fluid with a double-density constraint ------------------------------------------------

/** Rest spacing of 1 mL particles: 10 mm. */
export const WATER_SPACING = 655;
/** Fluid kernel radius h = 1.6 × spacing (≈ 16 mm). */
export const WATER_H = 1048;
/** Rest density in the kernel's Q12 units (Σ q², q = 1 − r/h, without self) on a 10 mm cubic lattice. */
export const WATER_RHO0 = 4116;
/** Pressure stiffness (Q8) for k·(ρ − ρ0) and near-pressure stiffness (Q8) for k_near·ρ_near. */
export const WATER_KP = 192;
export const WATER_KN = 128;
/** Pressure clamps (Q12): negative pressure (cohesion) balances the near-pressure at the free surface, so 1 L of particles fills ≈ 1.05 L. */
export const WATER_PMIN = -2048;
export const WATER_PMAX = 1 << 17;
/** Per-pair fluid displacement clamp in units. */
export const WATER_DCLAMP = 160;

// ---- goo: cohesive, viscous, sticky slime (kind 3, M5 stream X5) ---------------------------------------------------
// A goo pair (centres d apart) is a spring around the rest spacing plus a viscous coupling, position-based like the
// grain contacts (each side takes half, averaged with the particle's other corrections, which keeps it unconditionally
// stable; water's double-density solver with a strong cohesion clamp overshot and blew small blobs apart):
//   d < GOO_REST              push apart by (GOO_REST − d) / 2 (no friction: viscosity does the shear)
//   GOO_REST ≤ d < GOO_H      cohesion: pull together by GOO_KC × min(d − GOO_REST, GOO_H − d) / 512, a tent that peaks
//                             halfway and fades to 0 at GOO_H, so a stretched strand thins, holds, then lets go (drips).
//                             GOO_KC stays small next to the push: under averaging, pulls from the cohesion shell must
//                             not outweigh pushes from the core, or a blob has no resistance to being squashed
//   d < GOO_H                 viscosity: remove GOO_VISC / 512 of the pair's relative displacement this substep
// Against proxies goo sticks (apply): within GOO_BAND of a surface (or touching it) a goo particle loses GOO_STICK / 256
// of its tangential motion relative to the surface per iteration, and up to GOO_ADH units of its separating motion; the
// body gets that momentum back (drag on a rolling body, the weight of goo hanging under a lid). Approach is still the
// normal push, booked as before.

/** Rest spacing of goo particles: 845 units = 12.9 mm, the cube of 1/470 L (SIMULATION §8.1: ≈ 470 per litre). */
export const GOO_REST = 845;
/** Cohesion range (and the goo grid's cell): 1,140 units = 17.4 mm = 1.35 × the rest spacing. */
export const GOO_H = 1140;
/** Cohesion stiffness (Q8) of the tent pull. */
export const GOO_KC = 80;
/** Viscosity (Q9 of the pair's relative displacement per iteration, each side). */
export const GOO_VISC = 128;
/** The double-density fluid's constants per kind (water; null for the others). */
export interface FluidConsts {
  readonly h: number; readonly rho0: number; readonly kp: number; readonly kn: number; readonly pmin: number; readonly pmax: number;
  readonly dclamp: number; readonly visc: number;
  /** The smaller kinds whose contacts this fluid's solve pass handles (the larger kind searches the smaller's grid). */
  readonly smaller: readonly number[];
}
export const FLUID: readonly (FluidConsts | null)[] = [
  null,
  { h: WATER_H, rho0: WATER_RHO0, kp: WATER_KP, kn: WATER_KN, pmin: WATER_PMIN, pmax: WATER_PMAX, dclamp: WATER_DCLAMP, visc: 0, smaller: [0] },
  null,
  null,
];
/** Wall stick (Q8 of the relative tangential / separating displacement removed per iteration). */
export const GOO_STICK = 24;
/** Adhesion band beyond contact: 262 units = 4 mm. */
export const GOO_BAND = 262;
/**
 * Adhesion yield: units per iteration of separating motion a surface holds back from a goo particle in its band (3 per
 * substep: 18 units against Earth gravity's 11), so one layer hangs under a lid, and a drop heavy enough to pull harder
 * slides free (drips). The motion it holds is booked as impulse, so hanging goo weighs on what it hangs from.
 */
export const GOO_ADH = 12;

// ---- emit -------------------------------------------------------------------------------------------------------

/**
 * Emit lattice spacing and jitter per kind: spacing − 2 × jitter ≥ the contact distance, so emits never overlap (goo:
 * its rest spacing, 870 − 24 = 846 ≥ 845).
 */
export const EMIT_SPACING: readonly number[] = [294, 655, 1100, 870];
export const EMIT_JITTER: readonly number[] = [15, 20, 24, 12];

// ---- proxies ----------------------------------------------------------------------------------------------------

/** Proxy record: 32 i32 per (proxy, substep). */
export const PROXY_STRIDE = 32;
/** Coarse proxy grid: cell 2^15 units (0.5 m), hashed into PBUCKETS lists. */
export const PCELL_SHIFT = 15;
export const PBUCKETS = 4096;
/** A proxy covering more coarse cells than this goes on every list (with the planes). */
export const PMAX_CELLS = 512;
/** Max proxies per tick (SIMULATION §8.5) and max intakes per tick. */
export const MAX_PROXIES = 4096;
export const MAX_INTAKES = 1024;
/** Deep-penetration clamp for proxy pushes (units). */
export const PEN_MAX = 1 << 17;

// ---- despawn ----------------------------------------------------------------------------------------------------

export const KILL_Y = -(1 << 22); // 64 m below the origin
export const KILL_XZ = 1 << 29; // 8 km

/** Binary-search rounds for the intake capacity threshold (particle index < 2^24). */
export const INTAKE_ROUNDS = 25;
export const INTAKE_INDEX_BITS = 24;

export const KINDS = KIND_COUNT;
