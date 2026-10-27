// WGSL kernels for one Matter tick (SIMULATION §8.2), the GPU twin of cpu.ts. Integer only: the validator in
// test/matter.test.ts rejects any float type, float literal or float builtin. Positions/velocities are flat
// array<i32> with stride 3, byte-identical to the CPU's Int32Arrays.
//
// Determinism by construction: integer atomics are order-independent sums; the count sort's within-cell order is
// rebuilt by rank (count of smaller original indices), never taken from the atomic tickets; the intake capacity
// threshold is a binary search over counts; every other kernel is a pure per-element function.

import { KIND_COUNT } from './backend.ts';
import {
  CELL, DAMP_NUM, DAMP_SHIFT, DMAX, FLUID, GOO_ADH, GOO_BAND, GOO_H, GOO_KC, GOO_REST, GOO_STICK, GOO_VISC, INTAKE_INDEX_BITS, INTAKE_ROUNDS,
  KEY_BASE, KEY_RB, KEY_XB, KILL_XZ, KILL_Y, MASS_MG, MU_K, MU_S, PBUCKETS, PCELL_SHIFT, PEN_MAX, PROXY_STRIDE, RADIUS, SUBSTEPS,
  TABLE, VMAX, ZONE_STRIDE, crossShare,
} from './constants.ts';
import { P_C, P_E, P_MAX, P_MIN, P_R, P_RAD, P_SHAPE, P_SLOT, P_V, P_W, SURF_WORDS } from './prep.ts';

export const WG = 256;
/** Workgroup size of the neighbour-gather kernels (sand, marble, water): no cross-thread work, so any size gives the same bits. */
export const CWG = 256;
/** Elements per workgroup in the prefix-scan kernel (256 threads × 4). */
export const SCAN_CHUNK = 1024;

/** State buffer words (array<u32>): counts per kind (KIND_COUNT words) from S_COUNTS, bounds (6) from S_BOUNDS. */
export const S_N = 0, S_WATER = 1, S_MARBLE = 2, S_DEAD = 3, S_CAND = 4, S_C0 = 5, S_C1 = 6, S_COUNTS = 7, S_BOUNDS = 11, S_GOO = 17, S_WORDS = 20;
/** Indirect-args buffer: triples (x, 1, 1). */
export const A_ALL = 0, A_SAND = 3, A_WATER = 6, A_MARBLE = 9, A_CAND = 12, A_COMPACT = 15, A_GOO = 18, A_WORDS = 21;
/** Result buffer header words: n, c0, c1, counts (KIND_COUNT), bounds (6); absorbed counts follow. */
export const RES_HDR = 3 + KIND_COUNT + 6;

/** A per-kind constant table as a WGSL function (kind ids 0 … KIND_COUNT − 1; any other id reads kind 0's value). */
const selK = (name: string, v: readonly number[], ty = 'i32'): string => {
  let e = `${ty}(${v[0]})`;
  for (let k = 1; k < KIND_COUNT; k++) e = `select(${e}, ${ty}(${v[k]}), k == ${k}u)`;
  return `fn ${name}(k: u32) -> ${ty} { return ${e}; }`;
};

const shareTable: number[] = [];
for (let a = 0; a < KIND_COUNT; a++) for (let b = 0; b < KIND_COUNT; b++) shareTable.push(crossShare(a, b));

const PRELUDE = /* wgsl */ `
const VMAX: i32 = ${VMAX};
const DMAX: i32 = ${DMAX};
const DAMP_NUM: i32 = ${DAMP_NUM};
const DAMP_SHIFT: u32 = ${DAMP_SHIFT}u;
const PEN_MAX: i32 = ${PEN_MAX};
const SUBSTEPS: u32 = ${SUBSTEPS}u;
const PSTRIDE: u32 = ${PROXY_STRIDE}u;
const PBUCKETS: u32 = ${PBUCKETS}u;
const PCELL_SHIFT: u32 = ${PCELL_SHIFT}u;
const TABLE: u32 = ${TABLE}u;
const KILL_Y: i32 = ${KILL_Y};
const KILL_XZ: i32 = ${KILL_XZ};
const GOO_REST: i32 = ${GOO_REST};
const GOO_H: i32 = ${GOO_H};
const GOO_KC: i32 = ${GOO_KC};
const GOO_VISC: i32 = ${GOO_VISC};
const GOO_STICK: i32 = ${GOO_STICK};
const GOO_BAND: i32 = ${GOO_BAND};
const GOO_ADH: i32 = ${GOO_ADH};
const ZONE_STRIDE: u32 = ${ZONE_STRIDE}u;
const KINDS: u32 = ${KIND_COUNT}u;
const INTAKE_TOP: u32 = ${(1 << INTAKE_INDEX_BITS) + 1}u;
const INTAKE_ROUNDS: u32 = ${INTAKE_ROUNDS}u;
const S_N: u32 = ${S_N}u;
const S_WATER: u32 = ${S_WATER}u;
const S_MARBLE: u32 = ${S_MARBLE}u;
const S_DEAD: u32 = ${S_DEAD}u;
const S_CAND: u32 = ${S_CAND}u;
const S_C0: u32 = ${S_C0}u;
const S_C1: u32 = ${S_C1}u;
const S_COUNTS: u32 = ${S_COUNTS}u;
const S_BOUNDS: u32 = ${S_BOUNDS}u;
const S_GOO: u32 = ${S_GOO}u;
const A_GOO: u32 = ${A_GOO}u;
const RES_HDR: u32 = ${RES_HDR}u;
const A_ALL: u32 = ${A_ALL}u;
const A_SAND: u32 = ${A_SAND}u;
const A_WATER: u32 = ${A_WATER}u;
const A_MARBLE: u32 = ${A_MARBLE}u;
const A_CAND: u32 = ${A_CAND}u;
const A_COMPACT: u32 = ${A_COMPACT}u;
const WG: u32 = ${WG}u;
const CWG: u32 = ${CWG}u;
// proxy record fields
const P_SHAPE: u32 = ${P_SHAPE}u;
const P_SLOT: u32 = ${P_SLOT}u;
const P_RAD: u32 = ${P_RAD}u;
const P_C: u32 = ${P_C}u;
const P_R: u32 = ${P_R}u;
const P_E: u32 = ${P_E}u;
const P_V: u32 = ${P_V}u;
const P_W: u32 = ${P_W}u;
const P_MIN: u32 = ${P_MIN}u;
const P_MAX: u32 = ${P_MAX}u;

${selK('radiusOf', RADIUS)}
${selK('massOf', MASS_MG)}
${selK('muS', MU_S)}
${selK('muK', MU_K)}
${selK('cellOf', CELL, 'u32')}
${selK('keyXB', KEY_XB, 'u32')}
${selK('keyRB', KEY_RB, 'u32')}
${selK('keyBase', KEY_BASE, 'u32')}
fn crossShare(a: u32, b: u32) -> i32 {
  let k = a * KINDS + b;
  var v = ${shareTable[0]};
  ${shareTable.map((v, i) => (i === 0 ? '' : `if (k == ${i}u) { v = ${v}; }`)).join(' ')}
  return v;
}

struct Params {
  sub: u32, nProxies: u32, plistOff: u32, nIntakes: u32,
  nBlasts: u32, nEmit: u32, cap: u32, nDyn: u32,
  blastOff: u32, resAbs: u32, resImp: u32, nQueries: u32,
  queryOff: u32, resNear: u32, surfOff: u32, pad2: u32,
  nZones: u32, zoneOff: u32, grav: i32, pad3: u32,
}

// Truncating division, b = 0 -> 0 (SIMULATION §8.3); b = -1 is a wrapping negate (INT_MIN / -1 = INT_MIN).
fn idiv(a: i32, b: i32) -> i32 {
  if (b == 0) { return 0; }
  if (b == -1) { return -a; }
  return a / b;
}

// Exact floor square root, bit by bit from the highest set bit pair (the CPU uses Math.sqrt; both are exact).
fn isqrt(n: u32) -> u32 {
  if (n == 0u) { return 0u; }
  var x = n;
  var r = 0u;
  var b = 1u << ((31u - countLeadingZeros(n)) & 30u);
  loop {
    if (b == 0u) { break; }
    if (x >= r + b) {
      x = x - (r + b);
      r = (r >> 1u) + b;
    } else {
      r = r >> 1u;
    }
    b = b >> 2u;
  }
  return r;
}

fn damp(v: i32) -> i32 {
  let a = (abs(v) * DAMP_NUM) >> DAMP_SHIFT;
  return select(a, -a, v < 0);
}

fn fmix32(h0: u32) -> u32 {
  var h = h0;
  h = h ^ (h >> 16u);
  h = h * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = h * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return h;
}

fn mixK(h: u32, v: u32) -> u32 {
  var k = v * 0xcc9e2d51u;
  k = (k << 15u) | (k >> 17u);
  k = k * 0x1b873593u;
  var r = h ^ k;
  r = (r << 13u) | (r >> 19u);
  return r * 5u + 0xe6546b64u;
}

// a >> s truncated toward zero (cpu: shrS)
fn shrS(a: i32, s: u32) -> i32 { return select(a >> s, -((-a) >> s), a < 0); }
fn shrS3(a: vec3<i32>, s: u32) -> vec3<i32> { return vec3<i32>(shrS(a.x, s), shrS(a.y, s), shrS(a.z, s)); }

fn ucell(x: i32, c: u32) -> u32 { return (bitcast<u32>(x) ^ 0x80000000u) / c; }

fn rowHash(kind: u32, hx: u32, uy: u32, uz: u32) -> u32 {
  return fmix32((hx * 0x9e3779b1u) ^ (uy * 0x85ebca77u) ^ (uz * 0xc2b2ae3du) ^ ((kind + 1u) * 0x27d4eb2fu));
}
fn cellTag(kind: u32, hx: u32, uy: u32, uz: u32) -> u32 {
  return fmix32((hx * 0x7feb352du) ^ (uy * 0x846ca68bu) ^ (uz * 0x2c1b3c6du) ^ ((kind + 1u) * 0x297a2d39u));
}

fn pbucket(p: vec3<i32>) -> u32 {
  let c = vec3<u32>(bitcast<u32>(p.x >> PCELL_SHIFT), bitcast<u32>(p.y >> PCELL_SHIFT), bitcast<u32>(p.z >> PCELL_SHIFT));
  return fmix32((c.x * 0x9e3779b1u) ^ (c.y * 0x85ebca77u) ^ (c.z * 0xc2b2ae3du)) & (PBUCKETS - 1u);
}

// ---- 64-bit two's complement as vec2<u32>(lo, hi) (SIMULATION §8.3 split multiplies, §8.4 accumulation) ----
fn neg64(v: vec2<u32>) -> vec2<u32> {
  let lo = ~v.x + 1u;
  return vec2<u32>(lo, ~v.y + select(0u, 1u, lo == 0u));
}
fn mul64(a: i32, b: i32) -> vec2<u32> {
  let ua = bitcast<u32>(abs(a));
  let ub = bitcast<u32>(abs(b));
  let a0 = ua & 0xffffu; let a1 = ua >> 16u;
  let b0 = ub & 0xffffu; let b1 = ub >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  let r = vec2<u32>((p00 & 0xffffu) | (mid << 16u), p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u));
  if ((a < 0) != (b < 0)) { return neg64(r); }
  return r;
}
fn add64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  let lo = a.x + b.x;
  return vec2<u32>(lo, a.y + b.y + select(0u, 1u, lo < a.x));
}
fn i64of(a: i32) -> vec2<u32> { return vec2<u32>(bitcast<u32>(a), select(0u, 0xffffffffu, a < 0)); }
// floor(v / 2^s) truncated to i32, 1 <= s <= 31 (logical and arithmetic shifts agree on the kept bits)
fn sar64(v: vec2<u32>, s: u32) -> i32 { return bitcast<i32>((v.x >> s) | (v.y << (32u - s))); }
// floor((a0 b0 + a1 b1 + a2 b2) / 2^s)
fn dot64(a: vec3<i32>, b: vec3<i32>, s: u32) -> i32 {
  return sar64(add64(add64(mul64(a.x, b.x), mul64(a.y, b.y)), mul64(a.z, b.z)), s);
}

// Normalised direction (Q12) and length (units) of an integer vector, with a normalising shift (cpu: normDist).
fn normDist(q: vec3<i32>) -> vec4<i32> {
  let a = abs(q);
  let m = max(a.x, max(a.y, a.z));
  if (m == 0) { return vec4<i32>(0, 4096, 0, 0); }
  let bits = 32u - countLeadingZeros(bitcast<u32>(m));
  let s = select(0u, bits - 14u, bits > 14u);
  let qs = q >> vec3<u32>(s);
  let ds = i32(isqrt(bitcast<u32>(qs.x * qs.x + qs.y * qs.y + qs.z * qs.z)));
  return vec4<i32>(idiv(qs.x << 12u, ds), idiv(qs.y << 12u, ds), idiv(qs.z << 12u, ds), ds << s);
}

`;

// Neighbour search over grid g: every cell intersecting [p − reach, p + reach]; consecutive x cells with the same
// aliased high bits are one contiguous slot run [cellStart[kA], cellStart[kB + 1]). VISIT is the per-candidate body
// (it sees t, q = p − pred[t], and must 'continue' to skip).
function searchLoop(g: string, reach: string, visit: string): string {
  return /* wgsl */ `
  {
    let C = cellOf(${g}); let XB = keyXB(${g}); let base = keyBase(${g});
    let xm = (1u << XB) - 1u; let rm = (1u << keyRB(${g})) - 1u;
    let ux0 = ucell(p.x - ${reach}, C); let ux1 = ucell(p.x + ${reach}, C);
    let uy0 = ucell(p.y - ${reach}, C); let uy1 = ucell(p.y + ${reach}, C);
    let uz0 = ucell(p.z - ${reach}, C); let uz1 = ucell(p.z + ${reach}, C);
    for (var uz = uz0; uz <= uz1; uz++) {
      for (var uy = uy0; uy <= uy1; uy++) {
        var a = ux0;
        loop {
          if (a > ux1) { break; }
          let b = min(a | xm, ux1);
          let rowKey = base + ((rowHash(${g}, a >> XB, uy, uz) & rm) << XB);
          let lo = cellStart[rowKey + (a & xm)];
          let hi = cellStart[rowKey + (b & xm) + 1u];
          let tg = cellTag(${g}, a >> XB, uy, uz);
          for (var t = lo; t < hi; t++) {
            let pt = pp[t];
            if (bitcast<u32>(pt.w) != tg) { continue; }
            let q = p - pt.xyz;
            ${visit}
          }
          a = b + 1u;
        }
      }
    }
  }`;
}

// Contact correction for s against t (cpu: MatterCpu.contact). dS, dT: displacements since the substep start.
const CONTACT = /* wgsl */ `
fn disp(i: u32) -> vec3<i32> { return pp[i].xyz - p0[i].xyz; }
fn contact(s: u32, t: u32, ks: u32, kt: u32, q: vec3<i32>, d2: i32, dS: vec3<i32>, dT: vec3<i32>) -> vec3<i32> {
  let R = radiusOf(ks) + radiusOf(kt);
  var w = crossShare(ks, kt);
  if (ks == kt && q.y * q.y > q.x * q.x + q.z * q.z) { w = select(64, 192, q.y > 0); } else if (ks == kt) { w = 128; }
  let d = i32(isqrt(bitcast<u32>(d2)));
  if (d == 0) {
    // coincident: separate horizontally along a pair-hashed axis (never into a floor), lower slot negative
    let m = select(1, -1, s < t) * ((R * w) >> 8u);
    let zAxis = (fmix32(min(s, t) ^ (max(s, t) * 0x9e3779b1u)) & 1u) == 1u;
    return select(vec3<i32>(m, 0, 0), vec3<i32>(0, 0, m), zAxis);
  }
  let pen = R - d;
  let k = idiv((pen * w) << 8u, d);
  var c = shrS3(q * k, 16u);
  let mus = min(muS(ks), muS(kt));
  if (mus > 0) {
    let mk = min(muK(ks), muK(kt));
    let r = dS - dT;
    let inv = idiv(1 << 24u, d);
    let n = shrS3(q * inv, 12u);
    let rn = shrS(r.x * n.x + r.y * n.y + r.z * n.z, 12u);
    let tv = r - shrS3(n * rn, 12u);
    let lt = i32(isqrt(bitcast<u32>(tv.x * tv.x + tv.y * tv.y + tv.z * tv.z)));
    if (lt > 0) {
      var fv = tv;
      if (lt * 256 > mus * pen) {
        let kk = idiv(((mk * pen) >> 8u) << 12u, lt);
        fv = shrS3(tv * kk, 12u);
      }
      c = c - shrS3(fv * w, 8u);
    }
  }
  return c;
}
`;

// pp: sorted predicted positions with the cell tag in w; p0: sorted substep-start positions (w = mat).
const BINDINGS_GRAINS = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> pp: array<vec4<i32>>;
@group(0) @binding(2) var<storage, read> p0: array<vec4<i32>>;
@group(0) @binding(3) var<storage, read> cellStart: array<u32>;
@group(0) @binding(4) var<storage, read_write> acc: array<atomic<i32>>;
`;

// Cross search: big particle s (kind K) against smaller kind G; own sums in (ax..cnt), partner's atomically into acc.
// X5: a kind with no particles this substep is skipped (its sorted range is empty): the same pairs, without walking
// ~200 empty fine-grid cells per particle (goo or marbles in a world without sand).
const KIND_PRESENT: Readonly<Record<string, string>> = { '0u': 'st[S_WATER] > 0u', '1u': 'st[S_MARBLE] > st[S_WATER]', '2u': 'st[S_GOO] > st[S_MARBLE]' };
function crossBlock(K: string, G: string): string {
  return `if (${KIND_PRESENT[G]!}) ` + searchLoop(G, `(radiusOf(${K}) + radiusOf(${G}))`, /* wgsl */ `
            let RR = radiusOf(${K}) + radiusOf(${G});
            if (q.x >= RR || q.x <= -RR || q.y >= RR || q.y <= -RR || q.z >= RR || q.z <= -RR) { continue; }
            let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
            if (d2 >= RR * RR) { continue; }
            let dT = disp(t);
            let c1 = contact(s, t, ${K}, ${G}, q, d2, dS, dT);
            own += c1; cnt += 1;
            let c2 = contact(t, s, ${G}, ${K}, -q, d2, dT, dS);
            atomicAdd(&acc[t * 4u], c2.x);
            atomicAdd(&acc[t * 4u + 1u], c2.y);
            atomicAdd(&acc[t * 4u + 2u], c2.z);
            atomicAdd(&acc[t * 4u + 3u], 1);`);
}

function grainsKernel(kind: number): string {
  const K = `${kind}u`;
  const range = kind === 0 ? 'let s0 = 0u; let s1 = st[S_WATER];' : 'let s0 = st[S_MARBLE]; let s1 = st[S_GOO];';
  const extra = kind === 2 ? crossBlock(K, '0u') + crossBlock(K, '1u') : '';
  return BINDINGS_GRAINS + CONTACT + /* wgsl */ `
@compute @workgroup_size(${CWG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  ${range}
  let s = s0 + gid.x;
  if (s >= s1) { return; }
  let p = pp[s].xyz;
  let dS = p - p0[s].xyz;
  var own = vec3<i32>(0);
  var cnt = 0;
  let R = radiusOf(${K}) * 2;
  ${searchLoop(K, 'R', /* wgsl */ `
            if (t == s) { continue; }
            if (q.x >= R || q.x <= -R || q.y >= R || q.y <= -R || q.z >= R || q.z <= -R) { continue; }
            let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
            if (d2 >= R * R) { continue; }
            own += contact(s, t, ${K}, ${K}, q, d2, dS, disp(t));
            cnt += 1;`)}
  ${extra}
  atomicAdd(&acc[s * 4u], own.x);
  atomicAdd(&acc[s * 4u + 1u], own.y);
  atomicAdd(&acc[s * 4u + 2u], own.z);
  atomicAdd(&acc[s * 4u + 3u], cnt);
}
`;
}

// Goo pair correction (cpu: MatterCpu.gooPair): spring around GOO_REST (push below, tent cohesion above, 0 at GOO_H) taking
// half, minus GOO_VISC / 512 of the pair's relative displacement since the substep start.
const GOO_PAIR = /* wgsl */ `
fn gooPair(s: u32, t: u32, q: vec3<i32>, d2: i32, dS: vec3<i32>, dT: vec3<i32>) -> vec3<i32> {
  let d = i32(isqrt(bitcast<u32>(d2)));
  var c = vec3<i32>(0);
  if (d == 0) {
    let m = select(1, -1, s < t) * ((GOO_REST * 128) >> 8u);
    let zAxis = (fmix32(min(s, t) ^ (max(s, t) * 0x9e3779b1u)) & 1u) == 1u;
    c = select(vec3<i32>(m, 0, 0), vec3<i32>(0, 0, m), zAxis);
  } else {
    var f = 0;
    if (d < GOO_REST) { f = (GOO_REST - d) * 128; } else { f = -(((GOO_KC * min(d - GOO_REST, GOO_H - d)) >> 8u) * 128); }
    c = shrS3(q * idiv(f << 8u, d), 16u);
  }
  return c - shrS3((dS - dT) * GOO_VISC, 9u);
}
`;

// Goo: goo pairs over the goo grid, then contacts with sand, water and marbles (goo is the last, so it searches them all).
const gooKernel = BINDINGS_GRAINS + CONTACT + GOO_PAIR + /* wgsl */ `
@compute @workgroup_size(${CWG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = st[S_GOO] + gid.x;
  if (s >= st[S_N]) { return; }
  let p = pp[s].xyz;
  let dS = p - p0[s].xyz;
  var own = vec3<i32>(0);
  var cnt = 0;
  let H = GOO_H;
  ${searchLoop('3u', 'H', /* wgsl */ `
            if (t == s) { continue; }
            if (q.x >= H || q.x <= -H || q.y >= H || q.y <= -H || q.z >= H || q.z <= -H) { continue; }
            let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
            if (d2 >= H * H) { continue; }
            own += gooPair(s, t, q, d2, dS, disp(t));
            cnt += 1;`)}
  ${crossBlock('3u', '0u')}
  ${crossBlock('3u', '1u')}
  ${crossBlock('3u', '2u')}
  atomicAdd(&acc[s * 4u], own.x);
  atomicAdd(&acc[s * 4u + 1u], own.y);
  atomicAdd(&acc[s * 4u + 2u], own.z);
  atomicAdd(&acc[s * 4u + 3u], cnt);
}
`;

// Fluid kernels (cpu: MatterCpu.fluidDensity / fluidSolve): water (kind 1), its constants (constants.ts FLUID) inlined.
const fluidRange = (k: number): string => (k === 1 ? 'let s0 = st[S_WATER]; let s1 = st[S_MARBLE];' : 'let s0 = st[S_GOO]; let s1 = st[S_N];');

function fluidDensityKernel(k: number): string {
  const F = FLUID[k]!;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> pp: array<vec4<i32>>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read_write> dens: array<i32>;

@compute @workgroup_size(${CWG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  ${fluidRange(k)}
  let s = s0 + gid.x;
  if (s >= s1) { return; }
  let p = pp[s].xyz;
  var rho = 0;
  var rhoN = 0;
  let H = ${F.h};
  ${searchLoop(`${k}u`, 'H', /* wgsl */ `
            if (t == s) { continue; }
            if (q.x >= H || q.x <= -H || q.y >= H || q.y <= -H || q.z >= H || q.z <= -H) { continue; }
            let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
            if (d2 >= H * H) { continue; }
            let q12 = idiv((H - i32(isqrt(bitcast<u32>(d2)))) << 12u, H);
            let q2 = (q12 * q12) >> 12u;
            rho += q2;
            rhoN += (q2 * q12) >> 12u;`)}
  dens[s * 2u] = clamp(((rho - ${F.rho0}) * ${F.kp}) >> 8u, ${F.pmin}, ${F.pmax});
  dens[s * 2u + 1u] = clamp((rhoN * ${F.kn}) >> 8u, 0, ${F.pmax});
}
`;
}

function fluidSolveKernel(k: number): string {
  const F = FLUID[k]!;
  const visc = F.visc ? /* wgsl */ `
            f += shrS3(shrS3((disp(t) - dS) * q12, 12u) * ${F.visc}, 9u);` : '';
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> pp: array<vec4<i32>>;
@group(0) @binding(2) var<storage, read> p0: array<vec4<i32>>;
@group(0) @binding(3) var<storage, read> cellStart: array<u32>;
@group(0) @binding(4) var<storage, read_write> acc: array<atomic<i32>>;
@group(0) @binding(5) var<storage, read> dens: array<i32>;
@group(0) @binding(6) var<storage, read_write> fdisp: array<i32>;
${CONTACT}
@compute @workgroup_size(${CWG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  ${fluidRange(k)}
  let s = s0 + gid.x;
  if (s >= s1) { return; }
  let p = pp[s].xyz;
  let dS = p - p0[s].xyz;
  let P0 = dens[s * 2u];
  let Pn0 = dens[s * 2u + 1u];
  var f = vec3<i32>(0);
  let H = ${F.h};
  ${searchLoop(`${k}u`, 'H', /* wgsl */ `
            if (t == s) { continue; }
            if (q.x >= H || q.x <= -H || q.y >= H || q.y <= -H || q.z >= H || q.z <= -H) { continue; }
            let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
            if (d2 >= H * H) { continue; }
            let d = i32(isqrt(bitcast<u32>(d2)));
            let q12 = idiv((H - d) << 12u, H);
            let q2 = (q12 * q12) >> 12u;${visc}
            var D = ((((P0 + dens[t * 2u]) >> 1u) * q12) >> 12u) + ((((Pn0 + dens[t * 2u + 1u]) >> 1u) * q2) >> 12u);
            D = clamp((clamp(D, -65536, 65536) * H) >> 13u, -${F.dclamp}, ${F.dclamp});
            if (d == 0) {
              let zAxis = (fmix32(min(s, t) ^ (max(s, t) * 0x9e3779b1u)) & 1u) == 1u;
              let m = select(D, -D, s < t);
              f += select(vec3<i32>(m, 0, 0), vec3<i32>(0, 0, m), zAxis);
              continue;
            }
            f += shrS3(shrS3(q * idiv(1 << 24u, d), 12u) * D, 12u);`)}
  fdisp[s * 3u] = f.x; fdisp[s * 3u + 1u] = f.y; fdisp[s * 3u + 2u] = f.z;
  var own = vec3<i32>(0);
  var cnt = 0;
  ${F.smaller.map((g) => crossBlock(`${k}u`, `${g}u`)).join('\n')}
  atomicAdd(&acc[s * 4u], own.x);
  atomicAdd(&acc[s * 4u + 1u], own.y);
  atomicAdd(&acc[s * 4u + 2u], own.z);
  atomicAdd(&acc[s * 4u + 3u], cnt);
}
`;
}

// D104: the gravity of a particle at substep-start position x0 (cpu: prep.ts gravityAt): the first zone holding it, else
// the world's. Zones live in tin from P.zoneOff: shape, centre, size, 0, gravity per substep.
const predict = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read_write> pred: array<vec4<i32>>; // xyz, w = cell tag
@group(0) @binding(6) var<storage, read_write> kt: array<u32>; // per particle: key, ticket, (unused), dest
@group(0) @binding(7) var<storage, read_write> cellCount: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read> tin: array<i32>;

fn gravityAt(x0: vec3<i32>) -> i32 {
  for (var z = 0u; z < P.nZones; z++) {
    let o = P.zoneOff + z * ZONE_STRIDE;
    let d = x0 - vec3<i32>(tin[o + 1u], tin[o + 2u], tin[o + 3u]);
    let sz = vec3<i32>(tin[o + 4u], tin[o + 5u], tin[o + 6u]);
    if (d.y > sz.y || d.y < -sz.y) { continue; }
    if (tin[o] == 1) {
      if (d.x > sz.x || d.x < -sz.x || d.z > sz.z || d.z < -sz.z) { continue; }
    } else {
      if (d.x > sz.x || d.x < -sz.x || d.z > sz.x || d.z < -sz.x) { continue; }
      let ax = d.x >> 8u; let az = d.z >> 8u; let r = sz.x >> 8u;
      if (ax * ax + az * az > r * r) { continue; }
    }
    return tin[o + 8u + P.sub];
  }
  return P.grav;
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let b = i * 3u;
  let x0 = vec3<i32>(pos[b], pos[b + 1u], pos[b + 2u]);
  let p = vec3<i32>(x0.x + vel[b], x0.y + vel[b + 1u] - gravityAt(x0), x0.z + vel[b + 2u]);
  let k = mat[i] & 0xffu;
  let C = cellOf(k); let XB = keyXB(k);
  let ux = ucell(p.x, C); let uy = ucell(p.y, C); let uz = ucell(p.z, C);
  let key = keyBase(k) + ((ux & ((1u << XB) - 1u)) | ((rowHash(k, ux >> XB, uy, uz) & ((1u << keyRB(k)) - 1u)) << XB));
  kt[i * 4u] = key;
  kt[i * 4u + 1u] = atomicAdd(&cellCount[key], 1u);
  pred[i] = vec4<i32>(p, bitcast<i32>(cellTag(k, ux >> XB, uy, uz)));
}
`;

const scatter = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> kt: array<u32>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read_write> tmpIdx: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  tmpIdx[cellStart[kt[i * 4u]] + kt[i * 4u + 1u]] = i;
}
`;

// Within-cell order = original index order: rank = members of the cell with a smaller index (tickets ignored).
const rank = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> kt: array<u32>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> tmpIdx: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let k = kt[i * 4u];
  let lo = cellStart[k];
  let hi = cellStart[k + 1u];
  var r = 0u;
  for (var t = lo; t < hi; t++) { r += select(0u, 1u, tmpIdx[t] < i); }
  kt[i * 4u + 3u] = lo + r;
}
`;

const permute1 = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> kt: array<u32>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read_write> posB: array<i32>;
@group(0) @binding(6) var<storage, read_write> velB: array<i32>;
@group(0) @binding(7) var<storage, read_write> matB: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let d = kt[i * 4u + 3u];
  posB[d * 3u] = pos[i * 3u]; posB[d * 3u + 1u] = pos[i * 3u + 1u]; posB[d * 3u + 2u] = pos[i * 3u + 2u];
  velB[d * 3u] = vel[i * 3u]; velB[d * 3u + 1u] = vel[i * 3u + 1u]; velB[d * 3u + 2u] = vel[i * 3u + 2u];
  matB[d] = mat[i];
}
`;

const permute2 = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> kt: array<u32>;
@group(0) @binding(2) var<storage, read> pred: array<vec4<i32>>;
@group(0) @binding(3) var<storage, read_write> predB: array<vec4<i32>>;
@group(0) @binding(4) var<storage, read> pos: array<i32>;
@group(0) @binding(5) var<storage, read_write> p0: array<vec4<i32>>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let d = kt[i * 4u + 3u];
  predB[d] = pred[i];
  p0[d] = vec4<i32>(pos[i * 3u], pos[i * 3u + 1u], pos[i * 3u + 2u], 0); // w: impulse approach budget (apply)
}
`;

const ranges = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> st: array<u32>;
@group(0) @binding(1) var<storage, read> cellStart: array<u32>;
@group(0) @binding(2) var<storage, read_write> args: array<u32>;

@compute @workgroup_size(1)
fn main() {
  let n = st[S_N];
  let w = cellStart[${KEY_BASE[1]}u];
  let m = cellStart[${KEY_BASE[2]}u];
  let g = cellStart[${KEY_BASE[3]}u];
  st[S_WATER] = w;
  st[S_MARBLE] = m;
  st[S_GOO] = g;
  args[A_SAND] = (w + CWG - 1u) / CWG;
  args[A_WATER] = (m - w + CWG - 1u) / CWG;
  args[A_MARBLE] = (g - m + CWG - 1u) / CWG;
  args[A_GOO] = (n - g + CWG - 1u) / CWG;
}
`;

// Apply corrections, clamp, proxies (Gauss–Seidel over the bucket list in index order), impulses.
const apply = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read_write> pred: array<vec4<i32>>;
@group(0) @binding(3) var<storage, read_write> p0: array<vec4<i32>>;
@group(0) @binding(4) var<storage, read_write> acc: array<atomic<i32>>;
@group(0) @binding(5) var<storage, read> fdisp: array<i32>;
@group(0) @binding(6) var<storage, read> pd: array<i32>;
@group(0) @binding(7) var<storage, read_write> imp: array<atomic<u32>>;

fn atomAdd64(w: u32, v: vec2<u32>) {
  let old = atomicAdd(&imp[w], v.x);
  atomicAdd(&imp[w + 1u], v.y + select(0u, 1u, old + v.x < old));
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  let n = st[S_N];
  if (s >= n) { return; }
  let k = select(select(select(0u, 1u, s >= st[S_WATER]), 2u, s >= st[S_MARBLE]), 3u, s >= st[S_GOO]);
  let b = s * 3u;
  let cnt = atomicLoad(&acc[s * 4u + 3u]);
  let pw = pred[s];
  var p = pw.xyz;
  if (cnt > 0) {
    p += vec3<i32>(idiv(atomicLoad(&acc[s * 4u]), cnt), idiv(atomicLoad(&acc[s * 4u + 1u]), cnt), idiv(atomicLoad(&acc[s * 4u + 2u]), cnt));
  }
  atomicStore(&acc[s * 4u], 0); atomicStore(&acc[s * 4u + 1u], 0); atomicStore(&acc[s * 4u + 2u], 0); atomicStore(&acc[s * 4u + 3u], 0);
  if (k == 1u) { p += vec3<i32>(fdisp[b], fdisp[b + 1u], fdisp[b + 2u]); }
  let x0w = p0[s];
  let x0 = x0w.xyz;
  var booked = x0w.w;
  p = x0 + clamp(p - x0, vec3<i32>(-DMAX), vec3<i32>(DMAX));
  if (P.nProxies > 0u) {
    let rk = radiusOf(k); let mus = muS(k); let muk = muK(k); let m = massOf(k);
    let goo = k == 3u;
    let floorPen = select(0, -GOO_BAND, goo);
    let bk = P.plistOff + pbucket(p);
    let e1 = P.plistOff + u32(pd[bk + 1u]);
    for (var e = P.plistOff + u32(pd[bk]); e < e1; e++) {
      let o = (u32(pd[e]) * SUBSTEPS + P.sub) * PSTRIDE;
      if (p.x < pd[o + P_MIN] || p.x > pd[o + P_MAX] || p.y < pd[o + P_MIN + 1u] || p.y > pd[o + P_MAX + 1u]
        || p.z < pd[o + P_MIN + 2u] || p.z > pd[o + P_MAX + 2u]) { continue; }
      let shape = pd[o + P_SHAPE];
      let c = vec3<i32>(pd[o + P_C], pd[o + P_C + 1u], pd[o + P_C + 2u]);
      let dd = p - c;
      var pen = 0;
      var nrm = vec3<i32>(0);
      let R = o + P_R;
      if (shape == 0) {
        let nd = normDist(dd);
        pen = pd[o + P_RAD] + rk - nd.w;
        nrm = nd.xyz;
      } else if (shape == 3) {
        let ny = vec3<i32>(pd[R + 1u], pd[R + 4u], pd[R + 7u]);
        pen = rk - dot64(ny, dd, 14u);
        nrm = ny >> vec3<u32>(2u);
      } else {
        var l = vec3<i32>(dot64(vec3<i32>(pd[R], pd[R + 3u], pd[R + 6u]), dd, 14u),
                          dot64(vec3<i32>(pd[R + 1u], pd[R + 4u], pd[R + 7u]), dd, 14u),
                          dot64(vec3<i32>(pd[R + 2u], pd[R + 5u], pd[R + 8u]), dd, 14u));
        var ln = vec3<i32>(0);
        if (shape == 1) {
          let hl = pd[o + P_E + 1u];
          l.y = l.y - clamp(l.y, -hl, hl);
          let nd = normDist(l);
          pen = pd[o + P_RAD] + rk - nd.w;
          ln = nd.xyz;
        } else {
          let ex = vec3<i32>(pd[o + P_E], pd[o + P_E + 1u], pd[o + P_E + 2u]);
          let qv = l - clamp(l, -ex, ex);
          if (qv.x != 0 || qv.y != 0 || qv.z != 0) {
            let nd = normDist(qv);
            pen = rk - nd.w;
            ln = nd.xyz;
          } else {
            let al = abs(l);
            var dep = ex.x - al.x;
            var axis = 0u;
            if (ex.y - al.y < dep) { dep = ex.y - al.y; axis = 1u; }
            if (ex.z - al.z < dep) { dep = ex.z - al.z; axis = 2u; }
            pen = dep + rk;
            if (axis == 0u) { ln.x = select(-4096, 4096, l.x >= 0); }
            else if (axis == 1u) { ln.y = select(-4096, 4096, l.y >= 0); }
            else { ln.z = select(-4096, 4096, l.z >= 0); }
          }
        }
        nrm = vec3<i32>(
          (pd[R] * ln.x + pd[R + 1u] * ln.y + pd[R + 2u] * ln.z) >> 14u,
          (pd[R + 3u] * ln.x + pd[R + 4u] * ln.y + pd[R + 5u] * ln.z) >> 14u,
          (pd[R + 6u] * ln.x + pd[R + 7u] * ln.y + pd[R + 8u] * ln.z) >> 14u);
      }
      // goo also sticks within GOO_BAND of the surface; everything else needs a real overlap
      if (pen <= floorPen) { continue; }
      pen = min(pen, PEN_MAX);
      // surface displacement over the substep at the contact (v + ω × r) and the particle's motion relative to it;
      // only the normal approach (capped at the penetration, once per substep) is booked as impulse (cpu: apply)
      let r0 = p - c;
      let w = vec3<i32>(pd[o + P_W], pd[o + P_W + 1u], pd[o + P_W + 2u]);
      let sv = vec3<i32>(pd[o + P_V], pd[o + P_V + 1u], pd[o + P_V + 2u]) + vec3<i32>(
        sar64(add64(mul64(w.y, r0.z), neg64(mul64(w.z, r0.y))), 16u),
        sar64(add64(mul64(w.z, r0.x), neg64(mul64(w.x, r0.z))), 16u),
        sar64(add64(mul64(w.x, r0.y), neg64(mul64(w.y, r0.x))), 16u));
      let e = p - x0 - sv;
      let ec = clamp(e, vec3<i32>(-16384), vec3<i32>(16384));
      var ap = 0;
      var u = vec3<i32>(0);
      if (pen > 0) {
        let an = clamp(-((ec.x * nrm.x + ec.y * nrm.y + ec.z * nrm.z) >> 12u), 0, pen);
        let dyn = pd[o + P_SLOT] >= 0;
        ap = select(0, max(an - booked, 0), dyn);
        if (dyn) { booked = max(booked, an); }
        u = shrS3(nrm * pen, 12u);
        p += u;
      }
      var fv = vec3<i32>(0);
      if (mus > 0) {
        let qv = clamp(e + u, vec3<i32>(-16384), vec3<i32>(16384));
        let rn = (qv.x * nrm.x + qv.y * nrm.y + qv.z * nrm.z) >> 12u;
        let tv = qv - ((nrm * rn) >> vec3<u32>(12u));
        let lt = i32(isqrt(bitcast<u32>(tv.x * tv.x) + bitcast<u32>(tv.y * tv.y) + bitcast<u32>(tv.z * tv.z)));
        if (lt > 0) {
          fv = tv;
          if (lt * 256 > mus * pen) {
            let kk = (muk * pen) >> 8u;
            if (kk < lt) { fv = vec3<i32>(idiv(tv.x * kk, lt), idiv(tv.y * kk, lt), idiv(tv.z * kk, lt)); }
          }
          p -= fv;
        }
      } else if (goo) {
        // goo sticks (cpu: apply): GOO_STICK / 256 of the tangential motion relative to the surface, and the separating
        // normal motion held back up to GOO_ADH (adhesion with a yield); booked like friction
        let qv = clamp(e + u, vec3<i32>(-16384), vec3<i32>(16384));
        let rn = (qv.x * nrm.x + qv.y * nrm.y + qv.z * nrm.z) >> 12u;
        let hold = clamp(rn, 0, GOO_ADH);
        let tv = qv - ((nrm * rn) >> vec3<u32>(12u));
        fv = shrS3(tv * GOO_STICK, 8u) + ((nrm * hold) >> vec3<u32>(12u));
        p -= fv;
      }
      let slot = pd[o + P_SLOT];
      if (slot >= 0) {
        let j = -m * (((nrm * ap) >> vec3<u32>(12u)) - fv);
        let r = p - c;
        let wi = u32(slot) * 12u;
        atomAdd64(wi, i64of(j.x)); atomAdd64(wi + 2u, i64of(j.y)); atomAdd64(wi + 4u, i64of(j.z));
        atomAdd64(wi + 6u, add64(mul64(r.y, j.z), neg64(mul64(r.z, j.y))));
        atomAdd64(wi + 8u, add64(mul64(r.z, j.x), neg64(mul64(r.x, j.z))));
        atomAdd64(wi + 10u, add64(mul64(r.x, j.y), neg64(mul64(r.y, j.x))));
      }
    }
  }
  p0[s].w = booked;
  pred[s] = vec4<i32>(p, pw.w);
}
`;

const finish = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> pos: array<i32>;
@group(0) @binding(2) var<storage, read_write> vel: array<i32>;
@group(0) @binding(3) var<storage, read> pred: array<vec4<i32>>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let p = pred[i];
  for (var a = 0u; a < 3u; a++) {
    let j = i * 3u + a;
    vel[j] = clamp(damp(p[a] - pos[j]), -VMAX, VMAX);
    pos[j] = p[a];
  }
}
`;

const blast = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read_write> vel: array<i32>;
@group(0) @binding(4) var<storage, read> tin: array<i32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let p = vec3<i32>(pos[i * 3u], pos[i * 3u + 1u], pos[i * 3u + 2u]);
  var v = vec3<i32>(vel[i * 3u], vel[i * 3u + 1u], vel[i * 3u + 2u]);
  for (var bl = 0u; bl < P.nBlasts; bl++) {
    let o = P.blastOff + bl * 8u;
    let R = tin[o + 3u];
    let imp = tin[o + 4u];
    if (R <= 0) { continue; }
    let q = p - vec3<i32>(tin[o], tin[o + 1u], tin[o + 2u]);
    if (q.x >= R || q.x <= -R || q.y >= R || q.y <= -R || q.z >= R || q.z <= -R) { continue; }
    let nd = normDist(q);
    if (nd.w >= R) { continue; }
    let frac = idiv((R - nd.w) << 11u, R);
    let f = (imp * frac) >> 11u;
    v = clamp(v + ((nd.xyz * f) >> vec3<u32>(12u)), vec3<i32>(-VMAX), vec3<i32>(VMAX));
  }
  vel[i * 3u] = v.x; vel[i * 3u + 1u] = v.y; vel[i * 3u + 2u] = v.z;
}
`;

const emit = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read> em: array<i32>;
@group(0) @binding(3) var<storage, read_write> pos: array<i32>;
@group(0) @binding(4) var<storage, read_write> vel: array<i32>;
@group(0) @binding(5) var<storage, read_write> mat: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x;
  let n = st[S_N];
  if (e >= P.nEmit || e >= P.cap - n) { return; }
  let i = n + e;
  let o = e * 7u;
  pos[i * 3u] = em[o]; pos[i * 3u + 1u] = em[o + 1u]; pos[i * 3u + 2u] = em[o + 2u];
  vel[i * 3u] = em[o + 3u]; vel[i * 3u + 1u] = em[o + 4u]; vel[i * 3u + 2u] = em[o + 5u];
  mat[i] = bitcast<u32>(em[o + 6u]);
}
`;

const emitCommit = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> st: array<u32>;
@group(0) @binding(2) var<storage, read_write> args: array<u32>;

@compute @workgroup_size(1)
fn main() {
  let n = min(st[S_N] + P.nEmit, P.cap);
  st[S_N] = n;
  args[A_ALL] = (n + WG - 1u) / WG;
  // per-tick counters
  st[S_DEAD] = 0u; st[S_CAND] = 0u; st[S_C0] = 0u; st[S_C1] = 0u;
  for (var k = 0u; k < KINDS; k++) { st[S_COUNTS + k] = 0u; }
  st[S_BOUNDS] = 0xffffffffu; st[S_BOUNDS + 1u] = 0xffffffffu; st[S_BOUNDS + 2u] = 0xffffffffu;
  st[S_BOUNDS + 3u] = 0u; st[S_BOUNDS + 4u] = 0u; st[S_BOUNDS + 5u] = 0u;
}
`;

// ---- despawn: kill box, intake candidates, capacity threshold search, compaction ----------------------------
const mark = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> st: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> mat: array<u32>;
@group(0) @binding(4) var<storage, read> tin: array<i32>;
@group(0) @binding(5) var<storage, read_write> flags: array<u32>;
@group(0) @binding(6) var<storage, read_write> cand: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= atomicLoad(&st[S_N])) { return; }
  let p = vec3<i32>(pos[i * 3u], pos[i * 3u + 1u], pos[i * 3u + 2u]);
  if (p.y < KILL_Y || p.x > KILL_XZ || p.x < -KILL_XZ || p.z > KILL_XZ || p.z < -KILL_XZ) {
    flags[i] = 1u;
    atomicAdd(&st[S_DEAD], 1u);
    return;
  }
  var f = 0u;
  let k = mat[i] & 0xffu;
  for (var t = 0u; t < P.nIntakes; t++) {
    let o = t * 8u;
    if (((tin[o + 6u] >> k) & 1) == 0 || tin[o + 7u] <= 0) { continue; }
    if (p.x < tin[o] || p.x >= tin[o + 3u] || p.y < tin[o + 1u] || p.y >= tin[o + 4u] || p.z < tin[o + 2u] || p.z >= tin[o + 5u]) { continue; }
    f = 2u + t;
    cand[atomicAdd(&st[S_CAND], 1u)] = i;
    break;
  }
  flags[i] = f;
}
`;

const candPlan = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;
@compute @workgroup_size(1)
fn main() { args[A_CAND] = (st[S_CAND] + WG - 1u) / WG; }
`;

// ibs per intake t: [lo, hi, cnt] at t * 4, absorbed counts at P.resAbs-relative offset 4 * MAX + t * 3 + kind.
const bsInit = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> ibs: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= P.nIntakes) { return; }
  ibs[t * 4u] = 0u; ibs[t * 4u + 1u] = INTAKE_TOP; ibs[t * 4u + 2u] = 0u; ibs[t * 4u + 3u] = 0u;
  for (var k = 0u; k < KINDS; k++) { ibs[P.resAbs + t * KINDS + k] = 0u; }
}
`;

const bsCount = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> ibs: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
@group(0) @binding(3) var<storage, read> cand: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= st[S_CAND]) { return; }
  let i = cand[c];
  let t = flags[i] - 2u;
  let lo = atomicLoad(&ibs[t * 4u]);
  let hi = atomicLoad(&ibs[t * 4u + 1u]);
  if (hi - lo <= 1u) { return; }
  if (i < ((lo + hi) >> 1u)) { atomicAdd(&ibs[t * 4u + 2u], 1u); }
}
`;

const bsUpdate = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> ibs: array<u32>;
@group(0) @binding(2) var<storage, read> tin: array<i32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= P.nIntakes) { return; }
  let lo = ibs[t * 4u];
  let hi = ibs[t * 4u + 1u];
  if (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (ibs[t * 4u + 2u] <= u32(max(tin[t * 8u + 7u], 0))) { ibs[t * 4u] = mid; } else { ibs[t * 4u + 1u] = mid; }
  }
  ibs[t * 4u + 2u] = 0u;
}
`;

const absorb = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> st: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> ibs: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> flags: array<u32>;
@group(0) @binding(4) var<storage, read> cand: array<u32>;
@group(0) @binding(5) var<storage, read> mat: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= atomicLoad(&st[S_CAND])) { return; }
  let i = cand[c];
  let t = flags[i] - 2u;
  if (i < atomicLoad(&ibs[t * 4u])) {
    flags[i] = 1u;
    atomicAdd(&ibs[P.resAbs + t * KINDS + (mat[i] & 0xffu)], 1u);
    atomicAdd(&st[S_DEAD], 1u);
  }
}
`;

const compactPlan = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;
@compute @workgroup_size(1)
fn main() { args[A_COMPACT] = select(0u, (st[S_N] + WG - 1u) / WG, st[S_DEAD] > 0u); }
`;

// Plain shared-memory tree reduction (D3D11's FXC rejects workgroup atomics).
const blockCount = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> flags: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;
var<workgroup> tmp: array<u32, ${WG}>;
@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let i = wg.x * WG + t;
  tmp[t] = select(0u, 1u, i < st[S_N] && flags[i] != 1u);
  workgroupBarrier();
  for (var off = ${WG / 2}u; off > 0u; off = off >> 1u) {
    if (t < off) { tmp[t] = tmp[t] + tmp[t + off]; }
    workgroupBarrier();
  }
  if (t == 0u) { blockSums[wg.x] = tmp[0]; }
}
`;

// dst = scanned block offset + exclusive prefix of keep flags inside the block.
const compactDest = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> flags: array<u32>;
@group(0) @binding(2) var<storage, read> blockSums: array<u32>;
@group(0) @binding(3) var<storage, read_write> kt: array<u32>;
var<workgroup> tmp: array<u32, ${WG}>;
@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let i = wg.x * WG + t;
  let n = st[S_N];
  var keep = 0u;
  if (i < n && flags[i] != 1u) { keep = 1u; }
  tmp[t] = keep;
  workgroupBarrier();
  for (var off = 1u; off < WG; off = off << 1u) {
    var add = 0u;
    if (t >= off) { add = tmp[t - off]; }
    workgroupBarrier();
    tmp[t] += add;
    workgroupBarrier();
  }
  if (i < n) { kt[i * 4u + 3u] = select(0xffffffffu, blockSums[wg.x] + tmp[t] - 1u, keep == 1u); }
}
`;

const compactMove = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> kt: array<u32>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read_write> posB: array<i32>;
@group(0) @binding(6) var<storage, read_write> velB: array<i32>;
@group(0) @binding(7) var<storage, read_write> matB: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N]) { return; }
  let d = kt[i * 4u + 3u];
  if (d == 0xffffffffu) { return; }
  posB[d * 3u] = pos[i * 3u]; posB[d * 3u + 1u] = pos[i * 3u + 1u]; posB[d * 3u + 2u] = pos[i * 3u + 2u];
  velB[d * 3u] = vel[i * 3u]; velB[d * 3u + 1u] = vel[i * 3u + 1u]; velB[d * 3u + 2u] = vel[i * 3u + 2u];
  matB[d] = mat[i];
}
`;

const compactBack = /* wgsl */ `
@group(0) @binding(0) var<storage, read> st: array<u32>;
@group(0) @binding(1) var<storage, read> posB: array<i32>;
@group(0) @binding(2) var<storage, read> velB: array<i32>;
@group(0) @binding(3) var<storage, read> matB: array<u32>;
@group(0) @binding(4) var<storage, read_write> pos: array<i32>;
@group(0) @binding(5) var<storage, read_write> vel: array<i32>;
@group(0) @binding(6) var<storage, read_write> mat: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N] - st[S_DEAD]) { return; }
  pos[i * 3u] = posB[i * 3u]; pos[i * 3u + 1u] = posB[i * 3u + 1u]; pos[i * 3u + 2u] = posB[i * 3u + 2u];
  vel[i * 3u] = velB[i * 3u]; vel[i * 3u + 1u] = velB[i * 3u + 1u]; vel[i * 3u + 2u] = velB[i * 3u + 2u];
  mat[i] = matB[i];
}
`;

const compactCommit = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> st: array<u32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;
@compute @workgroup_size(1)
fn main() {
  let n = st[S_N] - st[S_DEAD];
  st[S_N] = n;
  args[A_ALL] = (n + WG - 1u) / WG;
}
`;

// ---- outputs -------------------------------------------------------------------------------------------------
// Checksum sums, per-kind counts, bounds and the grain queries (cpu: outputs), reduced per workgroup in shared memory
// (plain tree reductions: D3D11's FXC rejects workgroup atomics), then one set of global atomics per workgroup.
const reduce = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> st: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read> tin: array<i32>;
@group(0) @binding(6) var<storage, read_write> qacc: array<atomic<u32>>;
var<workgroup> ra: array<vec4<u32>, ${WG}>;
var<workgroup> rb: array<vec4<u32>, ${WG}>;
fn gadd64(w: u32, v: vec2<u32>) {
  let old = atomicAdd(&qacc[w], v.x);
  atomicAdd(&qacc[w + 1u], v.y + select(0u, 1u, old + v.x < old));
}
fn add64w(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  let lo = a.x + b.x;
  return vec2<u32>(lo, a.y + b.y + select(0u, 1u, lo < a.x));
}
@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let live = i < atomicLoad(&st[S_N]);
  var p = vec3<i32>(0);
  var k = 0u;
  var h1 = 0u; var h2 = 0u;
  var mn = vec3<u32>(0xffffffffu); var mx = vec3<u32>(0u);
  var cnt = vec4<u32>(0u);
  if (live) {
    let b = i * 3u;
    let x = bitcast<u32>(pos[b]); let y = bitcast<u32>(pos[b + 1u]); let z = bitcast<u32>(pos[b + 2u]);
    let vx = bitcast<u32>(vel[b]); let vy = bitcast<u32>(vel[b + 1u]); let vz = bitcast<u32>(vel[b + 2u]);
    let m = mat[i];
    k = m & 0xffu;
    p = vec3<i32>(pos[b], pos[b + 1u], pos[b + 2u]);
    h1 = fmix32(mixK(mixK(mixK(mixK(mixK(mixK(mixK(i, x), y), z), vx), vy), vz), m));
    h2 = fmix32(mixK(mixK(mixK(mixK(mixK(mixK(0x2545f491u, z), vx), x), vy), y ^ i), vz));
    cnt[min(k, 3u)] = 1u;
    mn = vec3<u32>(x, y, z) ^ vec3<u32>(0x80000000u);
    mx = mn;
  }
  // pass 1: hashes + counts (wrapping sums)
  ra[t] = vec4<u32>(h1, h2, cnt.x, cnt.y);
  rb[t] = vec4<u32>(cnt.z, cnt.w, 0u, 0u);
  workgroupBarrier();
  for (var off = ${WG / 2}u; off > 0u; off = off >> 1u) {
    if (t < off) { ra[t] = ra[t] + ra[t + off]; rb[t] = rb[t] + rb[t + off]; }
    workgroupBarrier();
  }
  if (t == 0u) {
    atomicAdd(&st[S_C0], ra[0].x);
    atomicAdd(&st[S_C1], ra[0].y);
    atomicAdd(&st[S_COUNTS], ra[0].z);
    atomicAdd(&st[S_COUNTS + 1u], ra[0].w);
    atomicAdd(&st[S_COUNTS + 2u], rb[0].x);
    atomicAdd(&st[S_COUNTS + 3u], rb[0].y);
  }
  workgroupBarrier();
  // pass 2: bounds (offset-binary min / max)
  ra[t] = vec4<u32>(mn, 0u);
  rb[t] = vec4<u32>(mx, 0u);
  workgroupBarrier();
  for (var off = ${WG / 2}u; off > 0u; off = off >> 1u) {
    if (t < off) { ra[t] = min(ra[t], ra[t + off]); rb[t] = max(rb[t], rb[t + off]); }
    workgroupBarrier();
  }
  if (t == 0u) {
    for (var a = 0u; a < 3u; a++) {
      atomicMin(&st[S_BOUNDS + a], ra[0][a]);
      atomicMax(&st[S_BOUNDS + 3u + a], rb[0][a]);
    }
  }
  // grain queries: count + 64-bit position sums per query
  for (var qn = 0u; qn < P.nQueries; qn++) {
    var c = 0u;
    if (live) {
      let o = P.queryOff + qn * 8u;
      let r = tin[o + 3u];
      let dv = p - vec3<i32>(tin[o], tin[o + 1u], tin[o + 2u]);
      if (((tin[o + 4u] >> k) & 1) != 0 && dv.x < r && dv.x > -r && dv.y < r && dv.y > -r && dv.z < r && dv.z > -r) {
        let d2 = add64(add64(mul64(dv.x, dv.x), mul64(dv.y, dv.y)), mul64(dv.z, dv.z));
        let r2 = mul64(r, r);
        if (d2.y < r2.y || (d2.y == r2.y && d2.x < r2.x)) { c = 1u; }
      }
    }
    let sx = select(vec2<u32>(0u), i64of(p.x), c == 1u);
    let sy = select(vec2<u32>(0u), i64of(p.y), c == 1u);
    let sz = select(vec2<u32>(0u), i64of(p.z), c == 1u);
    workgroupBarrier();
    ra[t] = vec4<u32>(c, sx, 0u);
    rb[t] = vec4<u32>(sy, sz);
    workgroupBarrier();
    for (var off = ${WG / 2}u; off > 0u; off = off >> 1u) {
      if (t < off) {
        let A = ra[t]; let B = ra[t + off]; let C = rb[t]; let D = rb[t + off];
        ra[t] = vec4<u32>(A.x + B.x, add64w(A.yz, B.yz), 0u);
        rb[t] = vec4<u32>(add64w(C.xy, D.xy), add64w(C.zw, D.zw));
      }
      workgroupBarrier();
    }
    if (t == 0u && ra[0].x > 0u) {
      let w = qn * 8u;
      atomicAdd(&qacc[w], ra[0].x);
      gadd64(w + 1u, ra[0].yz);
      gadd64(w + 3u, rb[0].xy);
      gadd64(w + 5u, rb[0].zw);
    }
  }
}
`;

// results: [0] n, [1] c0, [2] c1, [3..3+KINDS) counts, then 6 bounds (i32), then absorbed (RES_HDR), impulses (resImp).
const finalize = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read> ibs: array<u32>;
@group(0) @binding(3) var<storage, read> imp: array<u32>;
@group(0) @binding(4) var<storage, read_write> res: array<u32>;
@group(0) @binding(5) var<storage, read> qacc: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let g = gid.x;
  if (g < P.nQueries * 8u) { res[P.resNear + g] = qacc[g]; }
  if (g == 0u) {
    let n = st[S_N];
    res[0] = n; res[1] = st[S_C0]; res[2] = st[S_C1];
    for (var k = 0u; k < KINDS; k++) { res[3u + k] = st[S_COUNTS + k]; }
    for (var a = 0u; a < 6u; a++) { res[3u + KINDS + a] = select(0u, st[S_BOUNDS + a] ^ 0x80000000u, n > 0u); }
  }
  if (g < P.nIntakes * KINDS) { res[RES_HDR + g] = ibs[P.resAbs + g]; }
  if (g < P.nDyn * 6u) {
    let w = g * 2u;
    res[P.resImp + g] = bitcast<u32>(sar64(vec2<u32>(imp[w], imp[w + 1u]), select(24u, 8u, (g % 6u) < 3u)));
  }
}
`;

// Water-surface map (D101; cpu: outputs): per x–z column of the requested grid, the max and min water centre y
// (offset-binary atomicMax, the min as the max of the complement), the count and 64-bit velocity sums (carry adds).
// Every update is an order-independent integer atomic, so the map is exact. tin[surfOff..] = x0, z0, cell, nx, nz.
const surface = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> st: array<u32>;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read> tin: array<i32>;
@group(0) @binding(6) var<storage, read_write> sacc: array<atomic<u32>>;
fn sadd64(w: u32, v: i32) {
  let lo = bitcast<u32>(v);
  let old = atomicAdd(&sacc[w], lo);
  atomicAdd(&sacc[w + 1u], select(0u, 0xffffffffu, v < 0) + select(0u, 1u, old + lo < old));
}
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= st[S_N] || (mat[i] & 0xffu) != 1u) { return; }
  let o = P.surfOff;
  let b = i * 3u;
  let dx = pos[b] - tin[o];
  let dz = pos[b + 2u] - tin[o + 1u];
  if (dx < 0 || dz < 0) { return; }
  let ix = idiv(dx, tin[o + 2u]);
  let iz = idiv(dz, tin[o + 2u]);
  if (ix >= tin[o + 3u] || iz >= tin[o + 4u]) { return; }
  let c = bitcast<u32>(iz * tin[o + 3u] + ix) * ${SURF_WORDS}u;
  let y = bitcast<u32>(pos[b + 1u]) ^ 0x80000000u;
  atomicMax(&sacc[c], y);
  atomicMax(&sacc[c + 1u], ~y);
  atomicAdd(&sacc[c + 2u], 1u);
  sadd64(c + 3u, vel[b]);
  sadd64(c + 5u, vel[b + 1u]);
  sadd64(c + 7u, vel[b + 2u]);
}
`;

// Exclusive scan of SCAN_CHUNK-element chunks in place; chunk totals go to sums[] for the next level.
const scan = /* wgsl */ `
struct ScanP { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> SP: ScanP;
@group(0) @binding(1) var<storage, read_write> data: array<u32>;
@group(0) @binding(2) var<storage, read_write> sums: array<u32>;
var<workgroup> tmp: array<u32, ${WG}>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let base = wg.x * ${SCAN_CHUNK}u + t * 4u;
  var pre: array<u32, 4>;
  var acc = 0u;
  for (var k = 0u; k < 4u; k++) {
    var v = 0u;
    if (base + k < SP.n) { v = data[base + k]; }
    pre[k] = acc;
    acc += v;
  }
  tmp[t] = acc;
  workgroupBarrier();
  for (var off = 1u; off < ${WG}u; off = off << 1u) {
    var add = 0u;
    if (t >= off) { add = tmp[t - off]; }
    workgroupBarrier();
    tmp[t] += add;
    workgroupBarrier();
  }
  let excl = tmp[t] - acc;
  for (var k = 0u; k < 4u; k++) {
    if (base + k < SP.n) { data[base + k] = excl + pre[k]; }
  }
  if (t == ${WG - 1}u) { sums[wg.x] = tmp[${WG - 1}]; }
}
`;

const scanAdd = /* wgsl */ `
struct ScanP { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> SP: ScanP;
@group(0) @binding(1) var<storage, read_write> data: array<u32>;
@group(0) @binding(2) var<storage, read> sums: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= SP.n) { return; }
  data[i] += sums[i / ${SCAN_CHUNK}u];
}
`;

export type KernelName =
  | 'predict' | 'scatter' | 'rank' | 'permute1' | 'permute2' | 'ranges' | 'sand' | 'waterDensity' | 'waterSolve'
  | 'marble' | 'apply' | 'finish' | 'blast' | 'emit' | 'emitCommit' | 'mark' | 'candPlan' | 'bsInit' | 'bsCount'
  | 'bsUpdate' | 'absorb' | 'compactPlan' | 'blockCount' | 'compactDest' | 'compactMove' | 'compactBack'
  | 'compactCommit' | 'reduce' | 'finalize' | 'scan' | 'scanAdd' | 'surface' | 'goo';

/** Complete WGSL source per kernel (prelude + body), entry point `main`. */
export const MATTER_WGSL: Readonly<Record<KernelName, string>> = {
  predict: PRELUDE + predict,
  scatter: PRELUDE + scatter,
  rank: PRELUDE + rank,
  permute1: PRELUDE + permute1,
  permute2: PRELUDE + permute2,
  ranges: PRELUDE + ranges,
  sand: PRELUDE + grainsKernel(0),
  waterDensity: PRELUDE + fluidDensityKernel(1),
  waterSolve: PRELUDE + fluidSolveKernel(1),
  marble: PRELUDE + grainsKernel(2),
  apply: PRELUDE + apply,
  finish: PRELUDE + finish,
  blast: PRELUDE + blast,
  emit: PRELUDE + emit,
  emitCommit: PRELUDE + emitCommit,
  mark: PRELUDE + mark,
  candPlan: PRELUDE + candPlan,
  bsInit: PRELUDE + bsInit,
  bsCount: PRELUDE + bsCount,
  bsUpdate: PRELUDE + bsUpdate,
  absorb: PRELUDE + absorb,
  compactPlan: PRELUDE + compactPlan,
  blockCount: PRELUDE + blockCount,
  compactDest: PRELUDE + compactDest,
  compactMove: PRELUDE + compactMove,
  compactBack: PRELUDE + compactBack,
  compactCommit: PRELUDE + compactCommit,
  reduce: PRELUDE + reduce,
  finalize: PRELUDE + finalize,
  scan: PRELUDE + scan,
  scanAdd: PRELUDE + scanAdd,
  surface: PRELUDE + surface,
  goo: PRELUDE + gooKernel,
};
