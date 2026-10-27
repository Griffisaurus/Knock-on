// Deterministic transcendental functions (SIMULATION §10.1).
// Built only from IEEE-754 + − × ÷ (exactly rounded in every JS engine), Math.round/floor/abs
// (exact) and bit manipulation, so results are bit-identical across browsers and CPUs.
// Algorithms and coefficients follow fdlibm (Sun Microsystems, freely redistributable).

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
// Little-endian is universal on our targets; check once.
const LO = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
const HI = 1 - LO;

/** Exact x · 2^k for integer k (builds 2^k from its bit pattern, so no Math.pow). */
export function ldexp(x: number, k: number): number {
  while (k > 1023) { x *= 8.98846567431158e307; k -= 1023; } // 2^1023
  while (k < -1022) { x *= 2.2250738585072014e-308; k += 1022; } // 2^-1022
  U32[LO] = 0;
  U32[HI] = ((k + 1023) << 20) >>> 0;
  return x * F64[0]!;
}

// ---- sin / cos ----------------------------------------------------------------------------
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;

function kSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

/** Cody–Waite reduction: x = k·π/2 + r, |r| ≤ π/4. Accurate for |x| < 2^20·π/2 (ample for gameplay angles). */
function reduce(x: number): { k: number; r: number } {
  const k = Math.round(x * INV_PIO2);
  const r = ((x - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
  return { k, r };
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kSin(x);
  const { k, r } = reduce(x);
  switch (((k % 4) + 4) % 4) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kCos(x);
  const { k, r } = reduce(x);
  switch (((k % 4) + 4) % 4) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

// ---- atan / atan2 --------------------------------------------------------------------------
const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
] as const;

export function datan(x0: number): number {
  if (Number.isNaN(x0)) return NaN;
  const sign = x0 < 0 ? -1 : 1;
  let x = Math.abs(x0);
  if (x >= 7.378697629483821e19) return sign * (ATAN_HI[3]! + ATAN_LO[3]!); // 2^66
  let id: number;
  if (x < 0.4375) {
    if (x < 3.725290298461914e-9) return x0; // 2^-28
    id = -1;
  } else if (x < 1.1875) {
    if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
  } else if (x < 2.4375) {
    id = 2; x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3; x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return sign * (x - x * (s1 + s2));
  const r = ATAN_HI[id]! - ((x * (s1 + s2) - ATAN_LO[id]!) - x);
  return sign * r;
}

const PI = 3.141592653589793;
const PI_2 = 1.5707963267948966;

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) {
    if (y > 0) return PI_2;
    if (y < 0) return -PI_2;
    return 0;
  }
  const a = datan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

// ---- exp / log / pow -----------------------------------------------------------------------
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return ldexp(y, k);
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;
const SQRT2 = 1.4142135623730951;

export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; } // subnormal: scale by 2^54
  F64[0] = x;
  const hi = U32[HI]!;
  k += ((hi >>> 20) & 0x7ff) - 1023;
  U32[HI] = (hi & 0x000fffff) | 0x3ff00000; // mantissa in [1, 2)
  let m = F64[0]!;
  if (m > SQRT2) { m *= 0.5; k += 1; }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

/** x^y. Exact repeated squaring for integer y; exp(y·log x) otherwise (x > 0). */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isInteger(y) && Math.abs(y) <= 1024) {
    let base = y < 0 ? 1 / x : x;
    let n = Math.abs(y);
    let acc = 1;
    while (n > 0) {
      if (n % 2 === 1) acc *= base;
      base *= base;
      n = Math.floor(n / 2);
    }
    return acc;
  }
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return dexp(y * dlog(x));
}

export const dsqrt = Math.sqrt; // correctly rounded per IEEE-754 in every engine

export function dcbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const s = x < 0 ? -1 : 1;
  let y = dexp(dlog(Math.abs(x)) / 3);
  // two Newton steps polish the result deterministically
  const a = Math.abs(x);
  y = y - (y * y * y - a) / (3 * y * y);
  y = y - (y * y * y - a) / (3 * y * y);
  return s * y;
}

/** Math.fround at the boundary to Jolt (float32). */
export const f32 = Math.fround;
