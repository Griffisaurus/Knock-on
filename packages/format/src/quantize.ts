// Quantization rules (DATA_FORMATS §1). These are part of the save format and the sim input:
// change them only with a formatVersion bump.

export const CELL_M = 0.1;
/** Position unit: 1/64 cell = 1.5625 mm. */
export const POS_UNITS_PER_M = 640;
/** Size unit for resizable parts: 1/4 cell = 2.5 cm. */
export const SIZE_UNITS_PER_CELL = 4;
/** Snapped Euler angles are stored in half-degree steps. */
export const EULER_UNITS_PER_DEG = 2;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // x, y, z, w

export function metresToPos(m: number): number {
  const v = Math.round(m * POS_UNITS_PER_M);
  if (v > 2147483647 || v < -2147483648) throw new RangeError('position out of range');
  return v;
}

export function posToMetres(p: number): number {
  return p / POS_UNITS_PER_M;
}

export function cellsToSize(cells: number): number {
  const v = Math.round(cells * SIZE_UNITS_PER_CELL);
  if (v < 0 || v > 65535) throw new RangeError('size out of range');
  return v;
}

export function sizeToCells(s: number): number {
  return s / SIZE_UNITS_PER_CELL;
}

/**
 * Rotation encoding (DATA_FORMATS §1).
 *  tag 0: identity
 *  tag 1: snapped Euler yaw/pitch/roll, i16 each in half degrees (exact for 15°/5° snaps)
 *  tag 2: free smallest-three quaternion, 3 × i16 + largest-component index
 */
export type Rotation =
  | { readonly tag: 0 }
  | { readonly tag: 1; readonly yaw: number; readonly pitch: number; readonly roll: number } // half-degree units
  | { readonly tag: 2; readonly index: 0 | 1 | 2 | 3; readonly a: number; readonly b: number; readonly c: number };

export const IDENTITY: Rotation = { tag: 0 };

export function snappedEuler(yawDeg: number, pitchDeg: number, rollDeg: number): Rotation {
  const q = (d: number): number => {
    let v = Math.round(d * EULER_UNITS_PER_DEG) % 720;
    if (v > 360) v -= 720;
    if (v <= -360) v += 720;
    return v;
  };
  const yaw = q(yawDeg), pitch = q(pitchDeg), roll = q(rollDeg);
  if (yaw === 0 && pitch === 0 && roll === 0) return IDENTITY;
  return { tag: 1, yaw, pitch, roll };
}

const SQRT1_2 = 0.7071067811865476;
const ST_SCALE = 32767 / SQRT1_2;

/** Quantize an arbitrary unit quaternion with smallest-three. */
export function freeRotation(q: Quat): Rotation {
  let [x, y, z, w] = q;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  x /= len; y /= len; z /= len; w /= len;
  const comps = [x, y, z, w];
  let index: 0 | 1 | 2 | 3 = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(comps[i]!) > Math.abs(comps[index]!)) index = i as 0 | 1 | 2 | 3;
  const sign = comps[index]! < 0 ? -1 : 1;
  const rest = comps.filter((_, i) => i !== index).map((c) => Math.round(c * sign * ST_SCALE));
  return { tag: 2, index, a: rest[0]!, b: rest[1]!, c: rest[2]! };
}
