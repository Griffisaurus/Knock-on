// Matter fixed point (SIMULATION §1, §8): 1 unit = 1/65,536 m, velocities in units per 60 Hz matter tick.
// Every metres ↔ units conversion the sim does goes through here, so the convention lives in one place.

export const UNITS_PER_METRE = 65536;
export const MATTER_HZ = 60;
/** Q14 quaternion components. */
export const Q14 = 16384;
/** Angular velocity in rad per matter tick × 65,536 (MI's assumption, see M4_NOTES_MI request 3). */
export const ANG_SCALE = 65536;

/**
 * Particle mass per kind (kg): sand grain ⌀ 4 mm at 1.6 g/cm³ bulk (≈ 18,000 / L), water 1 mL, marble ⌀ 16 mm glass,
 * goo 1/470 L of slime at 1,050 kg/m³ (MX constants.ts MASS_MG: 2,234 mg).
 */
export const PARTICLE_KG: readonly [number, number, number, number] = [1 / 18000 * 1.6, 0.001, 0.0054, 0.002234];
/** Particles per litre (SIMULATION §8.1): sand ≈ 18,000, water 1,000, marble ≈ 290, goo ≈ 470. */
export const PER_LITRE: readonly [number, number, number, number] = [18000, 1000, 290, 470];
/** Matter kinds (MX backend.ts KIND_COUNT): sand, water, marble, goo. */
export const MATTER_KINDS = 4;

/**
 * D104: a world gravity percentage as the backend's Q8 gravity (MX constants.ts gravityQ8, the same function: Earth =
 * 2,816 = 11 units per substep², the M4 constant, bit for bit). The solver's damping truncates toward zero, which takes a
 * whole unit per substep from a slow grain and about half from a fast one whatever the gravity (the M4 Earth calibration
 * includes it); so every world keeps ¾ of a unit and scales the rest, G = 192 + 2,624 × p (Moon 16.5 % → 625, Hangar
 * 38 % → 1,189): drop times are Earth's × 1/√p within 4 %. 0 % is exactly 0 (zero-g: nothing drifts).
 */
export function matterGravityQ8(percent: number): number {
  if (!(percent > 0)) return 0;
  return Math.min(1 << 16, Math.round(192 + (2624 * percent) / 100));
}

const clampI32 = (v: number): number => (v > 2147483647 ? 2147483647 : v < -2147483648 ? -2147483648 : v);

/** Metres → units (round half away from zero, then clamp to i32). */
export function mToU(m: number): number {
  const v = m * UNITS_PER_METRE;
  return clampI32(v < 0 ? -Math.round(-v) : Math.round(v));
}

export function uToM(u: number): number { return u / UNITS_PER_METRE; }

/** m/s → units per matter tick. */
export function mpsToU(v: number): number { return mToU(v / MATTER_HZ); }

/** rad/s → rad per matter tick × ANG_SCALE. */
export function radpsToU(w: number): number {
  const v = (w / MATTER_HZ) * ANG_SCALE;
  return clampI32(v < 0 ? -Math.round(-v) : Math.round(v));
}

/** Unit quaternion component → Q14. */
export function qToQ14(c: number): number { return c < 0 ? -Math.round(-c * Q14) : Math.round(c * Q14); }

/** Backend impulse units → N·s and N·m·s (MX backend.ts IMPULSE_LIN_NS / IMPULSE_ANG_NMS). */
export const DEFAULT_IMPULSE_SCALE = { lin: 0.9375e-6, ang: 0.9375e-6 } as const;
