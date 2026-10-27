// WGSL kernels for one matter tick (SIMULATION §8.2). Integer-only by construction: the test suite
// rejects any f32/f16 token. Positions/velocities are flat array<i32> with stride 3 (byte-identical to
// the CPU reference's Int32Arrays; array<vec3<i32>> would pad to 16 bytes).

import {
  DAMP_NUM, GRAIN_D, GRAIN_R, GRAVITY, SCENE, SPLIT_DY, VMAX,
} from './constants.ts';

export const WG = 256;
/** Elements per workgroup in the prefix-scan kernel (256 threads × 4). */
export const SCAN_CHUNK = 1024;

const S = SCENE;

const PRELUDE = /* wgsl */ `
const GRAIN_D: i32 = ${GRAIN_D};
const GRAIN_R: i32 = ${GRAIN_R};
const GRAVITY: i32 = ${GRAVITY};
const VMAX: i32 = ${VMAX};
const DAMP_NUM: i32 = ${DAMP_NUM};
const SPLIT_DY: i32 = ${SPLIT_DY};
const HALF_X: i32 = ${S.halfX};
const HALF_Z: i32 = ${S.halfZ};
const SPH_X: i32 = ${S.sphere.x};
const SPH_Y: i32 = ${S.sphere.y};
const SPH_Z: i32 = ${S.sphere.z};
const SPH_R: i32 = ${S.sphere.r};
const BOX_X0: i32 = ${S.box.x0};
const BOX_X1: i32 = ${S.box.x1};
const BOX_Y0: i32 = ${S.box.y0};
const BOX_Y1: i32 = ${S.box.y1};
const BOX_Z0: i32 = ${S.box.z0};
const BOX_Z1: i32 = ${S.box.z1};

struct Params { n: u32, shift: u32, blocks: u32, pad: u32 }
@group(0) @binding(0) var<uniform> P: Params;

// Truncating division, b = 0 -> 0 (SIMULATION §8.3).
fn idiv(a: i32, b: i32) -> i32 {
  if (b == 0) { return 0; }
  if (b == -1) { return -a; } // wrapping negate; avoids INT_MIN / -1, matching the CPU's (a / b) | 0
  return a / b;
}

fn isqrt(n: u32) -> u32 {
  var x = n;
  var r = 0u;
  var b = 0x40000000u;
  for (var k = 0u; k < 16u; k++) {
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
  let a = (abs(v) * DAMP_NUM) >> 8u;
  return select(a, -a, v < 0);
}

fn cellKey(x: i32, y: i32, z: i32) -> u32 {
  return (bitcast<u32>(x >> 8u) & 127u) | ((bitcast<u32>(z >> 8u) & 127u) << 7u) | ((bitcast<u32>(y >> 8u) & 255u) << 14u);
}

fn neighbourKey(k: u32, dx: i32, dy: i32, dz: i32) -> u32 {
  let kx = bitcast<u32>(i32(k & 127u) + dx) & 127u;
  let kz = bitcast<u32>(i32((k >> 7u) & 127u) + dz) & 127u;
  let ky = bitcast<u32>(i32((k >> 14u) & 255u) + dy) & 255u;
  return kx | (kz << 7u) | (ky << 14u);
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

// Static proxies then container clamp; floor contact halves tangential motion since tick start.
fn collideStatic(p0: vec3<i32>, ox: i32, oz: i32) -> vec3<i32> {
  var p = p0;
  let bx0 = BOX_X0 - GRAIN_R; let bx1 = BOX_X1 + GRAIN_R;
  let by0 = BOX_Y0 - GRAIN_R; let by1 = BOX_Y1 + GRAIN_R;
  let bz0 = BOX_Z0 - GRAIN_R; let bz1 = BOX_Z1 + GRAIN_R;
  if (p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1 && p.z > bz0 && p.z < bz1) {
    var best = p.x - bx0; var axis = 0u;
    if (bx1 - p.x < best) { best = bx1 - p.x; axis = 1u; }
    if (p.y - by0 < best) { best = p.y - by0; axis = 2u; }
    if (by1 - p.y < best) { best = by1 - p.y; axis = 3u; }
    if (p.z - bz0 < best) { best = p.z - bz0; axis = 4u; }
    if (bz1 - p.z < best) { axis = 5u; }
    switch (axis) {
      case 0u: { p.x = bx0; }
      case 1u: { p.x = bx1; }
      case 2u: { p.y = by0; }
      case 3u: { p.y = by1; }
      case 4u: { p.z = bz0; }
      default: { p.z = bz1; }
    }
  }
  let rr = SPH_R + GRAIN_R;
  let d = p - vec3<i32>(SPH_X, SPH_Y, SPH_Z);
  if (d.x < rr && d.x > -rr && d.y < rr && d.y > -rr && d.z < rr && d.z > -rr) {
    let d2 = d.x * d.x + d.y * d.y + d.z * d.z;
    if (d2 < rr * rr) {
      let len = i32(isqrt(bitcast<u32>(d2)));
      if (len == 0) {
        p.y = SPH_Y + rr;
      } else {
        let pen = rr - len;
        p = p + vec3<i32>(idiv(d.x * pen, len), idiv(d.y * pen, len), idiv(d.z * pen, len));
      }
    }
  }
  p.x = clamp(p.x, -HALF_X + GRAIN_R, HALF_X - GRAIN_R);
  p.z = clamp(p.z, -HALF_Z + GRAIN_R, HALF_Z - GRAIN_R);
  if (p.y < GRAIN_R) {
    p.y = GRAIN_R;
    p.x = ox + idiv(p.x - ox, 2);
    p.z = oz + idiv(p.z - oz, 2);
  }
  return p;
}
`;

const predict = /* wgsl */ `
@group(0) @binding(1) var<storage, read> pos: array<i32>;
@group(0) @binding(2) var<storage, read> vel: array<i32>;
@group(0) @binding(3) var<storage, read_write> pred: array<i32>;
@group(0) @binding(4) var<storage, read_write> keys: array<u32>;
@group(0) @binding(5) var<storage, read_write> idx: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = i * 3u;
  let x = pos[b] + vel[b];
  let y = pos[b + 1u] + vel[b + 1u] - GRAVITY;
  let z = pos[b + 2u] + vel[b + 2u];
  pred[b] = x; pred[b + 1u] = y; pred[b + 2u] = z;
  keys[i] = cellKey(x, y, z);
  idx[i] = i;
}
`;

// Per-block digit histogram, stored digit-major (hist[d * blocks + block]) so one exclusive scan
// over it yields every (digit, block) scatter base.
const radixHist = /* wgsl */ `
@group(0) @binding(1) var<storage, read> keysIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> hist: array<u32>;
var<workgroup> counts: array<atomic<u32>, 256>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  atomicStore(&counts[t], 0u);
  workgroupBarrier();
  let s = wg.x * ${WG}u + t;
  if (s < P.n) { atomicAdd(&counts[(keysIn[s] >> P.shift) & 255u], 1u); }
  workgroupBarrier();
  hist[t * P.blocks + wg.x] = atomicLoad(&counts[t]);
}
`;

// Stable scatter: rank = number of earlier elements in the block with the same digit. A counted rank
// (not an atomic ticket) is what makes the order independent of thread scheduling.
const radixScatter = /* wgsl */ `
@group(0) @binding(1) var<storage, read> keysIn: array<u32>;
@group(0) @binding(2) var<storage, read> idxIn: array<u32>;
@group(0) @binding(3) var<storage, read> hist: array<u32>;
@group(0) @binding(4) var<storage, read_write> keysOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> idxOut: array<u32>;
var<workgroup> digits: array<u32, 256>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let s = wg.x * ${WG}u + t;
  var k = 0u;
  var d = 256u;
  if (s < P.n) { k = keysIn[s]; d = (k >> P.shift) & 255u; }
  digits[t] = d;
  workgroupBarrier();
  if (s < P.n) {
    var rank = 0u;
    for (var u = 0u; u < t; u++) { rank += select(0u, 1u, digits[u] == d); }
    let dst = hist[d * P.blocks + wg.x] + rank;
    keysOut[dst] = k;
    idxOut[dst] = idxIn[s];
  }
}
`;

// Exclusive scan of SCAN_CHUNK-element chunks in place; chunk totals go to sums[] for the next level.
const scan = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> data: array<u32>;
@group(0) @binding(2) var<storage, read_write> sums: array<u32>;
var<workgroup> tmp: array<u32, 256>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let base = wg.x * ${SCAN_CHUNK}u + t * 4u;
  var pre: array<u32, 4>;
  var acc = 0u;
  for (var k = 0u; k < 4u; k++) {
    var v = 0u;
    if (base + k < P.n) { v = data[base + k]; }
    pre[k] = acc;
    acc += v;
  }
  tmp[t] = acc;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off << 1u) {
    var add = 0u;
    if (t >= off) { add = tmp[t - off]; }
    workgroupBarrier();
    tmp[t] += add;
    workgroupBarrier();
  }
  let excl = tmp[t] - acc;
  for (var k = 0u; k < 4u; k++) {
    if (base + k < P.n) { data[base + k] = excl + pre[k]; }
  }
  if (t == 255u) { sums[wg.x] = tmp[255]; }
}
`;

const scanAdd = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> data: array<u32>;
@group(0) @binding(2) var<storage, read> sums: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  data[i] += sums[i / ${SCAN_CHUNK}u];
}
`;

const cellRange = /* wgsl */ `
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellEnd: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= P.n) { return; }
  let k = keys[s];
  if (s == 0u || keys[s - 1u] != k) { cellStart[k] = s; }
  if (s == P.n - 1u || keys[s + 1u] != k) { cellEnd[k] = s + 1u; }
}
`;

// One Jacobi pass: each pair (i < j) is evaluated once and scatters both grains' corrections with
// atomicAdd. Integer sums are order-independent, so scheduling can't change the result.
const contacts = /* wgsl */ `
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read> idx: array<u32>;
@group(0) @binding(3) var<storage, read> cellStart: array<u32>;
@group(0) @binding(4) var<storage, read> cellEnd: array<u32>;
@group(0) @binding(5) var<storage, read> pred: array<i32>;
@group(0) @binding(6) var<storage, read_write> acc: array<atomic<i32>>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.x;
  if (s >= P.n) { return; }
  let i = idx[s];
  let k = keys[s];
  let pi = vec3<i32>(pred[i * 3u], pred[i * 3u + 1u], pred[i * 3u + 2u]);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let nk = neighbourKey(k, dx, dy, dz);
        let e = cellEnd[nk];
        for (var t = cellStart[nk]; t < e; t++) {
          let j = idx[t];
          if (j <= i) { continue; }
          let q = pi - vec3<i32>(pred[j * 3u], pred[j * 3u + 1u], pred[j * 3u + 2u]);
          if (q.x >= GRAIN_D || q.x <= -GRAIN_D || q.y >= GRAIN_D || q.y <= -GRAIN_D || q.z >= GRAIN_D || q.z <= -GRAIN_D) { continue; }
          let d2 = q.x * q.x + q.y * q.y + q.z * q.z;
          if (d2 >= GRAIN_D * GRAIN_D) { continue; }
          let d = i32(isqrt(bitcast<u32>(d2)));
          var ci = vec3<i32>(0, -GRAIN_R, 0);
          var cj = vec3<i32>(0, GRAIN_R, 0);
          if (d != 0) {
            // Shares in quarters: the upper grain of a stacked pair takes 3, the lower 1, else 2 each.
            var w = 2;
            if (q.y > SPLIT_DY) { w = 3; } else if (q.y < -SPLIT_DY) { w = 1; }
            let den = d << 2u;
            let peni = (GRAIN_D - d) * w;
            let penj = (GRAIN_D - d) * (4 - w);
            ci = vec3<i32>(idiv(q.x * peni, den), idiv(q.y * peni, den), idiv(q.z * peni, den));
            cj = vec3<i32>(idiv(-q.x * penj, den), idiv(-q.y * penj, den), idiv(-q.z * penj, den));
          }
          atomicAdd(&acc[i * 4u], ci.x);
          atomicAdd(&acc[i * 4u + 1u], ci.y);
          atomicAdd(&acc[i * 4u + 2u], ci.z);
          atomicAdd(&acc[i * 4u + 3u], 1);
          atomicAdd(&acc[j * 4u], cj.x);
          atomicAdd(&acc[j * 4u + 1u], cj.y);
          atomicAdd(&acc[j * 4u + 2u], cj.z);
          atomicAdd(&acc[j * 4u + 3u], 1);
        }
      }
    }
  }
}
`;

// x* += delta / count (truncating), re-zero the accumulators for the next pass, collide statics.
const apply = /* wgsl */ `
@group(0) @binding(1) var<storage, read> pos: array<i32>;
@group(0) @binding(2) var<storage, read_write> pred: array<i32>;
@group(0) @binding(3) var<storage, read_write> acc: array<atomic<i32>>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let b = i * 3u;
  var p = vec3<i32>(pred[b], pred[b + 1u], pred[b + 2u]);
  let cnt = atomicLoad(&acc[i * 4u + 3u]);
  if (cnt > 0) {
    p = p + vec3<i32>(idiv(atomicLoad(&acc[i * 4u]), cnt), idiv(atomicLoad(&acc[i * 4u + 1u]), cnt), idiv(atomicLoad(&acc[i * 4u + 2u]), cnt));
  }
  atomicStore(&acc[i * 4u], 0);
  atomicStore(&acc[i * 4u + 1u], 0);
  atomicStore(&acc[i * 4u + 2u], 0);
  atomicStore(&acc[i * 4u + 3u], 0);
  p = collideStatic(p, pos[b], pos[b + 2u]);
  pred[b] = p.x; pred[b + 1u] = p.y; pred[b + 2u] = p.z;
}
`;

const finish = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> pos: array<i32>;
@group(0) @binding(2) var<storage, read_write> vel: array<i32>;
@group(0) @binding(3) var<storage, read> pred: array<i32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n * 3u) { return; }
  vel[i] = clamp(damp(pred[i] - pos[i]), -VMAX, VMAX);
  pos[i] = pred[i];
}
`;

// Wrapping u32 sums of x, y, z and the per-grain hash into samples[slot]. Workgroup partials first so
// the global atomics see one add per workgroup instead of one per grain.
const checksum = /* wgsl */ `
@group(0) @binding(1) var<storage, read> pos: array<i32>;
@group(0) @binding(2) var<storage, read> vel: array<i32>;
@group(0) @binding(3) var<storage, read_write> samples: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> slot: array<u32>;
var<workgroup> part: array<atomic<u32>, 4>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_index) t: u32, @builtin(global_invocation_id) gid: vec3<u32>) {
  if (t < 4u) { atomicStore(&part[t], 0u); }
  workgroupBarrier();
  let i = gid.x;
  if (i < P.n) {
    let b = i * 3u;
    let x = bitcast<u32>(pos[b]);
    let y = bitcast<u32>(pos[b + 1u]);
    let z = bitcast<u32>(pos[b + 2u]);
    atomicAdd(&part[0], x);
    atomicAdd(&part[1], y);
    atomicAdd(&part[2], z);
    let h = fmix32(mixK(mixK(mixK(mixK(mixK(mixK(i, x), y), z), bitcast<u32>(vel[b])), bitcast<u32>(vel[b + 1u])), bitcast<u32>(vel[b + 2u])));
    atomicAdd(&part[3], h);
  }
  workgroupBarrier();
  if (t < 4u) { atomicAdd(&samples[slot[0] * 4u + t], atomicLoad(&part[t])); }
}
`;

const bumpSlot = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> slot: array<u32>;

@compute @workgroup_size(1)
fn main() { slot[0] = slot[0] + 1u; }
`;

export type KernelName =
  | 'predict' | 'radixHist' | 'radixScatter' | 'scan' | 'scanAdd' | 'cellRange'
  | 'contacts' | 'apply' | 'finish' | 'checksum' | 'bumpSlot';

/** Complete WGSL source per kernel (prelude + body), entry point `main`. */
export const MATTER_WGSL: Readonly<Record<KernelName, string>> = {
  predict: PRELUDE + predict,
  radixHist: PRELUDE + radixHist,
  radixScatter: PRELUDE + radixScatter,
  scan: PRELUDE + scan,
  scanAdd: PRELUDE + scanAdd,
  cellRange: PRELUDE + cellRange,
  contacts: PRELUDE + contacts,
  apply: PRELUDE + apply,
  finish: PRELUDE + finish,
  checksum: PRELUDE + checksum,
  bumpSlot: PRELUDE + bumpSlot,
};
