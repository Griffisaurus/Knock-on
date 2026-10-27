// Matter test and benchmark scenes. Pure functions of their arguments (integer only), so the Node goldens, the
// browser harness (packages/matter/harness) and the vendor matrix (tools/vendor-matrix) all run identical inputs.

import { type MatterProxy, type MatterStepIn, type MatterEmit, type MatterIntake, type MatterBlast, Q14 } from './backend.ts';
import { gravityQ8 } from './constants.ts';
import { encodeMatr } from './payload.ts';
import { integrateQ, normQ, writeMatrix } from './prep.ts';
import { fmix32, idiv } from './imath.ts';

export interface MatterScene {
  name: string;
  capacity: number;
  seed: number;
  /** Initial MATR payload, or null to start empty. */
  init: Uint8Array | null;
  input(tick: number): MatterStepIn;
}

const U = 65536;
const mm = (v: number): number => Math.round((v * U) / 1000);
const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
const Q_ID = (): Int32Array => Int32Array.of(0, 0, 0, Q14);

function proxy(id: number, shape: 0 | 1 | 2 | 3, pos: Int32Array, size: Int32Array, rot = Q_ID(), dynamic = false, vel = v3(), ang = v3()): MatterProxy {
  return { id, shape, pos, rot, size, vel, ang, dynamic };
}

/** q1 ⊗ q2 (Q14, normalised). */
function qmul(a: Int32Array, b: Int32Array): Int32Array {
  const [ax, ay, az, aw] = [a[0]!, a[1]!, a[2]!, a[3]!];
  const [bx, by, bz, bw] = [b[0]!, b[1]!, b[2]!, b[3]!];
  const q = Int32Array.of(
    (aw * bx + ax * bw + ay * bz - az * by) >> 14,
    (aw * by - ax * bz + ay * bw + az * bx) >> 14,
    (aw * bz + ax * by - ay * bx + az * bw) >> 14,
    (aw * bw - ax * bx - ay * by - az * bz) >> 14,
  );
  normQ(q);
  return q;
}

/** Orientations of a body spinning about world Z at `omega` (rad per tick × 65,536), integrated per tick. */
function spinner(omega: number): (tick: number) => Int32Array {
  const memo: Int32Array[] = [Q_ID()];
  return (tick: number): Int32Array => {
    while (memo.length <= tick) {
      const q = memo[memo.length - 1]!.slice();
      // whole-tick rotation in 4 sub-rotations (half angle Q14 = ω / 2 / 4 per quarter tick)
      for (let k = 0; k < 4; k++) integrateQ(q, 0, 0, idiv(omega, 32));
      memo.push(q);
    }
    return memo[tick]!;
  };
}

/** Rotate local point (x, y, z) by q (via the integer matrix). */
function rotate(q: Int32Array, x: number, y: number, z: number): Int32Array {
  const m = new Int32Array(9);
  writeMatrix(m, 0, q);
  return Int32Array.of(
    Math.floor((m[0]! * x + m[1]! * y + m[2]! * z) / 16384),
    Math.floor((m[3]! * x + m[4]! * y + m[5]! * z) / 16384),
    Math.floor((m[6]! * x + m[7]! * y + m[8]! * z) / 16384),
  );
}

/**
 * "Mix": a 0.24 m box with sand, water and marble spouts, a spinning dynamic paddle (OBB), a bobbing dynamic sphere,
 * a dynamic capsule, a tilted static ramp, a capacity-limited intake and a blast. Exercises every input path.
 */
export function mixScene(scale = 1): MatterScene {
  const H = mm(120), T = mm(10), Y = mm(300);
  const statics: MatterProxy[] = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(H + T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(3, 2, v3(-H - T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(4, 2, v3(0, Y >> 1, H + T), v3(H + 2 * T, Y >> 1, T)),
    proxy(5, 2, v3(0, Y >> 1, -H - T), v3(H + 2 * T, Y >> 1, T)),
    proxy(6, 2, v3(mm(-60), mm(40), mm(-50)), v3(mm(50), mm(6), mm(40)), Int32Array.of(0, 0, 2845, 16135)), // ramp, 20° about z
  ];
  const omega = 3000; // ≈ 2.9 rad/s
  const spin = spinner(omega);
  const input = (tick: number): MatterStepIn => {
    const q = spin(tick);
    const tri = (period: number, amp: number): number => {
      const ph = tick % period;
      return ph < period / 2 ? idiv(amp * 4 * ph, period) - amp : amp * 3 - idiv(amp * 4 * ph, period);
    };
    const sy = mm(60) + tri(120, mm(30));
    const proxies: MatterProxy[] = [
      ...statics,
      proxy(10, 2, v3(mm(50), mm(45), 0), v3(mm(45), mm(8), mm(60)), q, true, v3(), v3(0, 0, omega)),
      proxy(11, 0, v3(mm(-40), sy, mm(60)), v3(mm(25)), Q_ID(), true, v3(0, tick % 120 < 60 ? mm(1) : -mm(1), 0)),
      proxy(12, 1, v3(mm(-70), mm(25), mm(70)), v3(mm(12), mm(30)), Int32Array.of(11585, 0, 0, 11585), true),
    ];
    const emits: MatterEmit[] = [];
    if (tick <= 120) emits.push({ seq: 1, kind: 0, count: 40 * scale, pos: v3(mm(20), mm(200), mm(10)), vel: v3(0, -mm(10), 0), spread: mm(1), seed: 11 });
    if (tick >= 30 && tick <= 150) emits.push({ seq: 2, kind: 1, count: 4 * scale, pos: v3(mm(-60), mm(220), mm(-40)), vel: v3(mm(5), 0, 0), spread: mm(2), seed: 12 });
    if (tick >= 60 && tick <= 90 && tick % 3 === 0) emits.push({ seq: 3, kind: 2, count: 2 * scale, pos: v3(mm(70), mm(240), mm(-60)), vel: v3(), spread: 0, seed: 13 });
    const intakes: MatterIntake[] = [{ id: 20, min: v3(mm(80), 0, mm(80)), max: v3(mm(120), mm(30), mm(120)), kindMask: 3, capacity: 5 }];
    const blasts: MatterBlast[] = tick === 200 ? [{ center: v3(0, mm(10), 0), radius: mm(80), impulse: mm(40) }] : [];
    const queries = [
      { id: 40, center: v3(0, mm(20), 0), radius: mm(60), kindMask: 7 },
      { id: 41, center: v3(mm(-40), mm(30), mm(-30)), radius: mm(90), kindMask: 2 },
    ];
    // a water-surface map (D101) over part of the box, off the box's own grid: cells straddle the walls and the edge
    const surface = { x0: -mm(130), z0: -mm(95), cell: mm(17), nx: 15, nz: 12 };
    return { tick, proxies, emits, intakes, blasts, queries, surface };
  };
  return { name: 'mix', capacity: 20000 * scale, seed: 7, init: null, input };
}

/**
 * "Pool" (D101): a 0.2 m box filled with 4,000 mL of water poured in over 20 ticks, a dynamic box pushed up and down
 * through the surface and a stream poured on one side, with a 2 cm water-surface map every tick (and a coarser,
 * shifted one every third tick). The CPU = GPU proof for the surface map: deep columns, splashes and moving water.
 */
export function poolScene(): MatterScene {
  const H = mm(100), T = mm(10), Y = mm(300);
  const statics: MatterProxy[] = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(H + T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(3, 2, v3(-H - T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(4, 2, v3(0, Y >> 1, H + T), v3(H + 2 * T, Y >> 1, T)),
    proxy(5, 2, v3(0, Y >> 1, -H - T), v3(H + 2 * T, Y >> 1, T)),
  ];
  const input = (tick: number): MatterStepIn => {
    const ph = tick % 90;
    const vy = ph < 45 ? -mm(2) : mm(2);
    const by = mm(150) + (ph < 45 ? -mm(2) * ph : mm(2) * (ph - 90));
    const proxies: MatterProxy[] = [...statics, proxy(10, 2, v3(mm(30), by, mm(-20)), v3(mm(30), mm(20), mm(25)), Q_ID(), true, v3(0, vy, 0))];
    const emits: MatterEmit[] = [];
    if (tick <= 20) emits.push({ seq: 1, kind: 1, count: 200, pos: v3(-mm(40), mm(120), mm(20)), vel: v3(0, -mm(20), 0), spread: mm(5), seed: 21 });
    if (tick >= 60 && tick <= 160) emits.push({ seq: 2, kind: 1, count: 3, pos: v3(-mm(80), mm(250), -mm(70)), vel: v3(mm(15), 0, 0), spread: mm(2), seed: 22 });
    const surface = tick % 3 === 0
      ? { x0: -mm(150), z0: -mm(60), cell: mm(45), nx: 6, nz: 3 }
      : { x0: -H, z0: -H, cell: mm(20), nx: 10, nz: 10 };
    return { tick, proxies, emits, intakes: [], blasts: [], surface };
  };
  return { name: 'pool', capacity: 5000, seed: 9, init: null, input };
}

/**
 * "Ballistic": a 200-particle water blob and a sand blob thrown at 1 m/s from 1 m up, no proxies (regression scene for
 * free flight: internal pressure must not bleed the blob's common velocity; MI's 2026-10-24 report).
 */
export function ballisticScene(): MatterScene {
  const v0 = Math.round(U / 60);
  return {
    name: 'ballistic', capacity: 1000, seed: 3, init: null,
    input: (tick) => ({
      tick, proxies: [], intakes: [], blasts: [],
      emits: tick === 1 ? [
        { seq: 0, kind: 1, count: 200, pos: v3(0, U, 0), vel: v3(v0, 0, 0), spread: 0, seed: 1 },
        { seq: 1, kind: 0, count: 200, pos: v3(0, U, mm(300)), vel: v3(v0, 0, 0), spread: 0, seed: 2 },
      ] : [],
    }),
  };
}

/**
 * "Goo" (M5, X5): a 0.24 m box with a goo nozzle pouring a rope (and short bursts of sand, water and marbles, so goo meets
 * every kind), a dynamic sphere rolling through the puddle (goo drag on a body), a dynamic lid the goo hangs from and
 * drips off (adhesion booked as impulse), a tilted static ramp it creeps down, a capacity-limited goo intake, a grain
 * query and a blast. The CPU = GPU proof for kind 3.
 */
export function gooScene(): MatterScene {
  const H = mm(120), T = mm(10), Y = mm(300);
  const statics: MatterProxy[] = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(H + T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(3, 2, v3(-H - T, Y >> 1, 0), v3(T, Y >> 1, H + 2 * T)),
    proxy(4, 2, v3(0, Y >> 1, H + T), v3(H + 2 * T, Y >> 1, T)),
    proxy(5, 2, v3(0, Y >> 1, -H - T), v3(H + 2 * T, Y >> 1, T)),
    proxy(6, 2, v3(mm(60), mm(50), mm(-60)), v3(mm(50), mm(6), mm(40)), Int32Array.of(0, 0, -2845, 16135)), // ramp, −20° about z
  ];
  const input = (tick: number): MatterStepIn => {
    // the ball rolls back and forth along x through the puddle at 0.6 m/s, spinning as it would roll
    const ph = tick % 160;
    const vx = ph < 80 ? mm(10) : -mm(10);
    const bx = ph < 80 ? -mm(80) + mm(10) * (ph >> 1) : mm(80) - mm(10) * ((ph - 80) >> 1);
    const proxies: MatterProxy[] = [
      ...statics,
      proxy(10, 0, v3(bx, mm(26), mm(40)), v3(mm(25)), Q_ID(), true, v3(vx, 0, 0), v3(0, 0, -Math.round((vx * 65536) / mm(25)))),
      // a lid hanging in the pour's path: goo lands on it, sticks under it and drips off its edges
      proxy(11, 2, v3(mm(-40), mm(150), mm(-40)), v3(mm(35), mm(5), mm(35)), Q_ID(), true),
    ];
    const emits: MatterEmit[] = [];
    if (tick <= 180) emits.push({ seq: 1, kind: 3, count: 3, pos: v3(mm(-40), mm(230), mm(-40)), vel: v3(0, -mm(8), 0), spread: mm(1), seed: 31 });
    if (tick >= 20 && tick <= 60) emits.push({ seq: 2, kind: 3, count: 4, pos: v3(mm(40), mm(120), mm(40)), vel: v3(-mm(6), 0, 0), spread: mm(2), seed: 32 });
    if (tick >= 40 && tick <= 70) emits.push({ seq: 3, kind: 0, count: 20, pos: v3(mm(0), mm(200), mm(60)), vel: v3(), spread: mm(1), seed: 33 });
    if (tick >= 50 && tick <= 80) emits.push({ seq: 4, kind: 1, count: 3, pos: v3(mm(-60), mm(200), mm(60)), vel: v3(), spread: mm(1), seed: 34 });
    if (tick >= 60 && tick <= 90 && tick % 5 === 0) emits.push({ seq: 5, kind: 2, count: 1, pos: v3(mm(60), mm(220), mm(0)), vel: v3(), spread: 0, seed: 35 });
    const intakes: MatterIntake[] = [{ id: 20, min: v3(mm(-110), 0, mm(-110)), max: v3(mm(-70), mm(20), mm(-70)), kindMask: 8, capacity: 3 }];
    const blasts: MatterBlast[] = tick === 220 ? [{ center: v3(0, mm(10), 0), radius: mm(60), impulse: mm(20) }] : [];
    const queries = [{ id: 40, center: v3(0, mm(20), 0), radius: mm(80), kindMask: 8 }];
    return { tick, proxies, emits, intakes, blasts, queries };
  };
  return { name: 'goo', capacity: 4000, seed: 13, init: null, input };
}

/**
 * "Low g" (D104): Moon gravity (16.5 %, gravityQ8) with sand, water and goo falling through a zero-g cylinder zone and a
 * half-gravity box zone, onto a floor and a tilted ramp, with a dynamic paddle sweeping through. Long enough for the
 * Bresenham gravity split to wrap (S mod 256) several times. The CPU = GPU proof for gravity and zones.
 */
export function lowGravityScene(): MatterScene {
  const g = gravityQ8(16.5);
  const statics: MatterProxy[] = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(mm(150), mm(60), 0), v3(mm(120), mm(6), mm(80)), Int32Array.of(0, 0, 2845, 16135)),
  ];
  const zones = [
    { shape: 0 as const, center: v3(mm(-100), mm(250), 0), size: v3(mm(80), mm(120), 0), gravity: 0 },
    { shape: 1 as const, center: v3(mm(150), mm(250), 0), size: v3(mm(60), mm(100), mm(60)), gravity: gravityQ8(8.25) },
  ];
  const omega = 2000;
  const spin = spinner(omega);
  const input = (tick: number): MatterStepIn => {
    const proxies: MatterProxy[] = [...statics, proxy(10, 2, v3(0, mm(40), 0), v3(mm(80), mm(6), mm(20)), spin(tick), true, v3(), v3(0, omega, 0))];
    const emits: MatterEmit[] = [];
    if (tick <= 100 && tick % 2 === 0) {
      emits.push({ seq: 1, kind: 0, count: 30, pos: v3(mm(-100), mm(400), 0), vel: v3(), spread: mm(2), seed: 41 });
      emits.push({ seq: 2, kind: 1, count: 4, pos: v3(mm(150), mm(400), 0), vel: v3(), spread: mm(2), seed: 42 });
    }
    if (tick <= 60 && tick % 6 === 0) emits.push({ seq: 3, kind: 3, count: 6, pos: v3(mm(20), mm(300), mm(40)), vel: v3(0, 0, -mm(4)), spread: mm(1), seed: 43 });
    return { tick, proxies, emits, intakes: [], blasts: [], gravity: g, zones };
  };
  return { name: 'lowg', capacity: 5000, seed: 17, init: null, input };
}

/** A box of `n` goo particles on their rest lattice (X5 perf runs: the goo gather per particle against sand's). */
export function gooBox(n: number): MatterScene {
  const sp = 860, j = 6;
  let side = 1;
  while (side * side * side < n) side++;
  const sx = Math.min(side * 2, 200), sz = sx;
  const pos = new Int32Array(n * 3), vel = new Int32Array(n * 3), mat = new Uint32Array(n).fill(3);
  const half = (sx * sp) >> 1;
  for (let i = 0; i < n; i++) {
    const ix = i % sx, iz = ((i / sx) | 0) % sz, iy = (i / (sx * sz)) | 0;
    const h = fmix32((i * 3 + 0x900d) >>> 0);
    pos[i * 3] = ix * sp - half + (h % (2 * j + 1)) - j;
    pos[i * 3 + 1] = mm(9) + iy * sp + ((h >>> 8) % (2 * j + 1)) - j;
    pos[i * 3 + 2] = iz * sp - half + ((h >>> 16) % (2 * j + 1)) - j;
  }
  const W = half + mm(10), T = mm(20), Y = mm(4000);
  const proxies = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(W + T, Y >> 1, 0), v3(T, Y >> 1, W + 2 * T)), proxy(3, 2, v3(-W - T, Y >> 1, 0), v3(T, Y >> 1, W + 2 * T)),
    proxy(4, 2, v3(0, Y >> 1, W + T), v3(W + 2 * T, Y >> 1, T)), proxy(5, 2, v3(0, Y >> 1, -W - T), v3(W + 2 * T, Y >> 1, T)),
  ];
  return {
    name: `goobox-${n}`, capacity: n, seed: 1,
    init: encodeMatr({ tick: 0, count: n, capacity: n, seed: 1, pos, vel, mat }),
    input: (tick) => ({ tick, proxies, emits: [], intakes: [], blasts: [] }),
  };
}

/** A box of sand with `n` grains on a lattice (spacing `sp`, hash jitter `j`), for perf runs. */
export function sandBox(n: number): MatterScene {
  const sp = 300, j = 8;
  let side = 1;
  while (side * side * side < n) side++;
  const sx = Math.min(side * 2, 600), sz = sx;
  const pos = new Int32Array(n * 3), vel = new Int32Array(n * 3), mat = new Uint32Array(n);
  const half = (sx * sp) >> 1;
  for (let i = 0; i < n; i++) {
    const ix = i % sx, iz = ((i / sx) | 0) % sz, iy = (i / (sx * sz)) | 0;
    const h = fmix32((i * 3 + 0x51ed) >>> 0);
    pos[i * 3] = ix * sp - half + (h & 15) - j;
    pos[i * 3 + 1] = mm(5) + iy * sp + ((h >>> 4) & 15) - j;
    pos[i * 3 + 2] = iz * sp - half + ((h >>> 8) & 15) - j;
  }
  const W = half + mm(10), T = mm(20), Y = mm(2000);
  const proxies = [
    proxy(1, 3, v3(), v3()),
    proxy(2, 2, v3(W + T, Y >> 1, 0), v3(T, Y >> 1, W + 2 * T)), proxy(3, 2, v3(-W - T, Y >> 1, 0), v3(T, Y >> 1, W + 2 * T)),
    proxy(4, 2, v3(0, Y >> 1, W + T), v3(W + 2 * T, Y >> 1, T)), proxy(5, 2, v3(0, Y >> 1, -W - T), v3(W + 2 * T, Y >> 1, T)),
  ];
  return {
    name: `sandbox-${n}`, capacity: n, seed: 1,
    init: encodeMatr({ tick: 0, count: n, capacity: n, seed: 1, pos, vel, mat }),
    input: (tick) => ({ tick, proxies, emits: [], intakes: [], blasts: [] }),
  };
}

// ---- Sandstorm (GAME_SPEC §13 perf scene, M4 exit) ----------------------------------------------------------------

/** Paddle base orientations: k × 45° about Z (half-angle sin/cos in Q14). */
const PADDLE_Q: readonly (readonly [number, number])[] = [
  [0, 16384], [6270, 15137], [11585, 11585], [15137, 6270], [16384, 0], [15137, -6270], [11585, -11585], [6270, -15137],
];

/** Valley slope options: half-angle sin/cos (Q14) for the plane's quaternion, tan and cos (Q16). */
const SLOPES: Readonly<Record<number, readonly [number, number, number, number]>> = {
  22: [3126, 16083, 26478, 60764], 28: [3964, 15897, 34846, 57865], 30: [4240, 15826, 37837, 56756],
  32: [4516, 15749, 40951, 55578], 34: [4790, 15668, 44205, 54332], 36: [5063, 15582, 47615, 53020],
  38: [5334, 15491, 51202, 51643],
};

export interface SandstormOptions { grains?: number; slope?: number }

/**
 * "Sandstorm": a 0.1 m deep, 1.16 m wide slab of sand (4,000,000 grains by default) let go 0.2 m above a 36° valley slope.
 * The slope is steeper than the sand's friction angle, so the whole layer avalanches down onto a flat run, through a
 * WATERWHEEL turning at 0.5 rev/s (8 scripted OBB paddles + a capsule hub, all dynamic proxies so their impulses are
 * reported) set over the slope, past a static boulder (sphere), onto a flat run-out. Fixed seed, integer geometry.
 */
export function sandstorm(opts: SandstormOptions = {}): MatterScene {
  const n = opts.grains ?? 4_000_000;
  const deg = opts.slope ?? 36;
  const sl = SLOPES[deg];
  if (!sl) throw new Error(`sandstorm: slope ${deg}° not in the table`);
  const S = 272, J = 4; // lattice spacing 4.15 mm, ±4 units jitter (S − 2J ≥ the 262 contact distance)
  const nz = 280, ny = Math.min(24, Math.max(1, Math.ceil(n / (nz * 40))));
  // slope plane: through (0.6 m, 0, 0), descending toward +x: y = (0.6 − x) · tan(slope)
  const slopeQ = Int32Array.of(0, 0, -sl[0], sl[1]);
  const slopeX = mm(600);
  const tanS = sl[2];
  const slopeY = (x: number): number => Math.floor(((slopeX - x) * tanS) / 65536);
  const x0 = mm(-2500), z0 = -((nz - 1) * S) >> 1;
  // the slab starts 0.2 m above the slope (a cornice letting go): it lands moving, and a moving bed stays in kinetic
  // friction; a bed started at rest on the slope jams (M4_NOTES_MX, solver limitations)
  const DROP = mm(200);
  const pos = new Int32Array(n * 3), vel = new Int32Array(n * 3), mat = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const iz = i % nz, iy = ((i / nz) | 0) % ny, ix = (i / (nz * ny)) | 0;
    const h = fmix32((Math.imul(i, 0x9e3779b1) + 0x5a4d) >>> 0);
    // odd layers sit half a spacing over (x and z): no vertical columns, so shear is transmitted between layers
    const st = (iy & 1) * (S >> 1);
    const x = x0 + ix * S + st + (h % (2 * J + 1)) - J;
    pos[i * 3] = x;
    pos[i * 3 + 1] = slopeY(x0 + ix * S + st) + DROP + iy * S + ((h >>> 8) % (2 * J + 1)) - J;
    pos[i * 3 + 2] = z0 + iz * S + st + ((h >>> 16) % (2 * J + 1)) - J;
  }
  const topY = slopeY(mm(-2600));
  const halfW = mm(600), wallT = mm(30), wallH = topY + mm(800);
  const statics: MatterProxy[] = [
    proxy(1, 3, v3(), v3()), // floor
    proxy(2, 3, v3(slopeX, 0, 0), v3(), slopeQ), // slope
    proxy(3, 2, v3(mm(-150), wallH >> 1, halfW + wallT), v3(mm(2500), wallH >> 1, wallT)), // side walls
    proxy(4, 2, v3(mm(-150), wallH >> 1, -halfW - wallT), v3(mm(2500), wallH >> 1, wallT)),
    proxy(5, 2, v3(mm(-2580), wallH >> 1, 0), v3(wallT, wallH >> 1, halfW + 2 * wallT)), // back wall
    proxy(6, 2, v3(mm(2230), wallH >> 1, 0), v3(wallT, wallH >> 1, halfW + 2 * wallT)), // end wall
    proxy(7, 0, v3(mm(-800), slopeY(mm(-800)) + mm(20), mm(-140)), v3(mm(70))), // boulder on the slope
  ];
  const omega = -3431; // −0.5 rev/s about +Z: the bottom paddle moves downstream (+X)
  const spin = spinner(omega);
  // on the slope: the paddle circle (r 0.25 m) grazes the slope surface, so every paddle scoops the avalanche
  const hub = v3(mm(250), slopeY(mm(250)) + Math.floor((mm(240) * 65536) / sl[3]), 0);
  const rArm = mm(150);
  const input = (tick: number): MatterStepIn => {
    const q = spin(tick);
    const proxies: MatterProxy[] = [...statics];
    proxies.push(proxy(20, 1, hub.slice(), v3(mm(30), mm(580)), Int32Array.of(11585, 0, 0, 11585), true, v3(), v3(0, 0, omega)));
    for (let k = 0; k < 8; k++) {
      const qk = qmul(q, Int32Array.of(0, 0, PADDLE_Q[k]![0], PADDLE_Q[k]![1]));
      const arm = rotate(qk, rArm, 0, 0);
      const c = v3(hub[0]! + arm[0]!, hub[1]! + arm[1]!, hub[2]! + arm[2]!);
      // linear velocity of the paddle centre: ω × r (per tick)
      const vx = Math.floor((-omega * arm[1]!) / 65536), vy = Math.floor((omega * arm[0]!) / 65536);
      proxies.push(proxy(30 + k, 2, c, v3(mm(100), mm(12), mm(580)), qk, true, v3(vx, vy, 0), v3(0, 0, omega)));
    }
    return { tick, proxies, emits: [], intakes: [], blasts: [] };
  };
  return {
    name: `sandstorm-${n}${deg === 36 ? '' : `-${deg}deg`}`, capacity: n, seed: 0x5a4d,
    init: encodeMatr({ tick: 0, count: n, capacity: n, seed: 0x5a4d, pos, vel, mat }),
    input,
  };
}
