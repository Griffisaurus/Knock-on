// M2 part definitions (stream A · sim-parts): the non-critter M2 parts from GAME_SPEC §12, built to
// their briefs (docs/art/briefs/*) in engine space: Y-up, metres, front = +Z (Blender (x, y, z) →
// engine (x, z, −y)). Spread into PARTS by defs.ts. Collision is the blockout until each part's
// `.shapes.json` lands. Behaviours live in packages/sim/src/channels/.

import { dcos, dsin } from '@knockon/detmath';
import type { Lure, PartDef, Props, Quat, ShapeDef, V3, VisualDef } from './defs.ts';

const b = (min: V3, max: V3): PartDef['bounds'] => ({ min, max });
const centred = (s: V3): PartDef['bounds'] => b([-s[0] / 2, -s[1] / 2, -s[2] / 2], [s[0] / 2, s[1] / 2, s[2] / 2]);
const bottom = (s: V3): PartDef['bounds'] => b([-s[0] / 2, 0, -s[2] / 2], [s[0] / 2, s[1], s[2] / 2]);
const RAD = Math.PI / 180;

// Palette (ART_BIBLE §3.1), as in defs.ts.
const C = {
  ignition: '#FF5B2E', graphite: '#3A3E47', bone: '#E8E2D6', red: '#D93A2B', steel: '#A9AFB8', volt: '#C6F432',
  beam: '#2FD6FF', amber: '#FFB020', cobalt: '#2E5BFF', rubber: '#25272D', flame: '#FFC870', copper: '#B8742E',
  glass: '#CFE8F2', walnut: '#6B4A2E', brass: '#C9A23A', cork: '#B98A5A',
};

// ---- small quaternion helpers (detmath only) ---------------------------------------------------------

/** Rotation of `deg` degrees about a unit axis. */
export function qAxis(axis: V3, deg: number): Quat {
  const h = (deg * RAD) / 2, s = dsin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, dcos(h)];
}
export function qMul(a: Quat, c: Quat): Quat {
  return [
    a[3] * c[0] + a[0] * c[3] + a[1] * c[2] - a[2] * c[1],
    a[3] * c[1] - a[0] * c[2] + a[1] * c[3] + a[2] * c[0],
    a[3] * c[2] + a[0] * c[1] - a[1] * c[0] + a[2] * c[3],
    a[3] * c[3] - a[0] * c[0] - a[1] * c[1] - a[2] * c[2],
  ];
}
const cross = (a: V3, c: V3): V3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
/** Unit quaternion from an orthonormal basis (the images of local x, y, z). */
export function qBasis(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}
const rotV = (q: Quat, v: V3): V3 => {
  const u: V3 = [q[0], q[1], q[2]];
  const t = cross(u, v).map((x) => x * 2) as unknown as V3;
  const c2 = cross(u, t);
  return [v[0] + t[0] * q[3] + c2[0], v[1] + t[1] * q[3] + c2[1], v[2] + t[2] * q[3] + c2[2]];
};

// ---- VORTEX: funnel profiles (frame.md), (r, y) from the rim down to the throat -----------------------

export const VORTEX_PROFILES = [
  { rim: 0.4, height: 0.45, n: 24, bore: 0.144, pts: [[0.395, 0.445], [0.32, 0.41], [0.25, 0.35], [0.2, 0.27], [0.165, 0.19], [0.144, 0.08]] },
  { rim: 0.2, height: 0.25, n: 16, bore: 0.055, pts: [[0.195, 0.245], [0.15, 0.225], [0.11, 0.195], [0.08, 0.155], [0.065, 0.11], [0.055, 0.05]] },
] as const;
export const vortexProfile = (p: Props): (typeof VORTEX_PROFILES)[number] => VORTEX_PROFILES[(p.size ?? 0) === 1 ? 1 : 0]!;

/** Bowl staves: for each profile segment a ring of thin boxes whose inner faces lie on the profile, plus the bore. */
function vortexShapes(p: Props): ShapeDef[] {
  const v = vortexProfile(p);
  const out: ShapeDef[] = [];
  const t = 0.01; // wall
  const ring = (r0: number, y0: number, r1: number, y1: number, n: number): void => {
    const dr = r0 - r1, dy = y0 - y1, len = Math.sqrt(dr * dr + dy * dy);
    const mr = dr / len, my = dy / len; // meridian, inner-lower → outer-upper
    const nr = -my, ny = mr; // interior normal (toward the axis and up)
    const rc = (r0 + r1) / 2 - nr * (t / 2), yc = (y0 + y1) / 2 - ny * (t / 2);
    const w = ((2 * Math.PI * Math.max(r0, r1)) / n) * 1.12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI, c = dcos(a), s = dsin(a);
      const er: V3 = [c, 0, s];
      const ly: V3 = [mr * er[0], my, mr * er[2]];
      const lz: V3 = [nr * er[0], ny, nr * er[2]];
      const lx = cross(ly, lz);
      out.push({ kind: 'box', size: [w, len + 0.012, t], at: [rc * c, yc, rc * s], rot: qBasis(lx, ly, lz) });
    }
  };
  for (let i = 1; i < v.pts.length; i++) ring(v.pts[i - 1]![0], v.pts[i - 1]![1], v.pts[i]![0], v.pts[i]![1], v.n);
  // straight bore from the throat to the outlet (12 staves)
  const throat = v.pts[v.pts.length - 1]![1];
  ring(v.bore, throat, v.bore, 0, 12);
  return out;
}

// ---- TURBINE: three pitched blades on the rotor (drive.md) -----------------------------------------------

export const TURBINE = { hub: [0, 0.25, 0.03] as V3, tip: 0.145, bladeLen: 0.115, chord: 0.04, pitch: 25, angles: [90, 210, 330] } as const;
function turbineBlades(): { at: V3; rot: Quat; radial: V3; deg: number }[] {
  const T = TURBINE;
  const rc = T.tip - T.bladeLen / 2;
  return T.angles.map((deg) => {
    const radial: V3 = [dcos(deg * RAD), dsin(deg * RAD), 0];
    // blade box: local x radial, local y chord (in the rotor plane, then pitched about the radial axis)
    const tang: V3 = cross([0, 0, 1], radial);
    const base = qBasis(radial, tang, [0, 0, 1]);
    return { at: [T.hub[0] + radial[0] * rc, T.hub[1] + radial[1] * rc, T.hub[2]], rot: qMul(qAxis(radial, T.pitch), base), radial, deg };
  });
}

// ---- SKYROCKET fins -------------------------------------------------------------------------------------
const FIN_DEG = [90, 210, 330]; // Blender angles: 90° is the back; rotation about +Y by the same angle maps +X onto the fin

// ---- BIG TOP barrel frame (boom.md) ------------------------------------------------------------------------
export const BIG_TOP = { trunnion: [0.06, 0.18, 0] as V3, boreR: 0.135, back: -0.05, muzzle: 0.16, barrelR: 0.15 } as const;
/** Barrel axis (unit) and its upward normal for an elevation (degrees). */
export function bigTopAxis(elev: number): { dir: V3; up: V3 } {
  const a = elev * RAD;
  return { dir: [dcos(a), dsin(a), 0], up: [-dsin(a), dcos(a), 0] };
}
const bigTopAt = (elev: number, along: number, up = 0): V3 => {
  const { dir, up: u } = bigTopAxis(elev), T = BIG_TOP.trunnion;
  return [T[0] + dir[0] * along + u[0] * up, T[1] + dir[1] * along + u[1] * up, T[2]];
};
/** The touch-hole stub tip (heat ignites it there), riding the elevation. */
export const bigTopTouchHole = (elev: number): V3 => bigTopAt(elev, -0.02, 0.165);
/** Launch energy (J) for the power property (1–5 → 4–40 J). */
export const bigTopEnergy = (p: Props): number => 4 + 9 * ((p.power ?? 3) - 1);

// ---- GOTCHA BOX head path (contraptions.md) --------------------------------------------------------------
export const GOTCHA = { rest: [0, 0.11, 0] as V3, rise: 0.3, pivot: [0, 0.17, 0] as V3, lean: 35, riseS: 0.12, leanS: 0.15 } as const;

// ---- FLAP (frame.md): fixed 0.30 × 0.30 in M2 ---------------------------------------------------------------
export const FLAP = { w: 0.3, d: 0.3, panel: 0.256, mass: 4 * 0.256 * 0.256 } as const;

/** Physics materials whose small bodies are "shiny" Lures for Bandit (SIMULATION §5.11). */
const SHINY = new Set(['steel', 'chrome', 'brass', 'glass']);

/**
 * The Lure a part emits (contract 2, SIMULATION §5.11): its own `lure` tag, or a computed shiny Lure
 * (Bandit, 5 m) for dynamic bodies of a shiny physics material at ≤ 0.5 kg. Null when it lures nothing.
 */
export function lureOf(def: PartDef): Lure | null {
  if (def.lure) return def.lure;
  const m = def.body.material;
  if (def.body.kind === 'dynamic' && m && SHINY.has(m) && def.body.mass <= 0.5) return { species: { bandit: 1 }, radius: 5 };
  return null;
}

const lever = (on: number): { at: V3; tilt: number; knob: V3 } => {
  const tilt = on ? -25 : 25, a = tilt * RAD;
  return { at: [-dsin(a) * 0.055, 0.08 + dcos(a) * 0.055, 0], tilt, knob: [-dsin(a) * 0.11, 0.08 + dcos(a) * 0.11, 0] };
};

export const PARTS_M2: readonly PartDef[] = [
  // ---- Rollers --------------------------------------------------------------------------------------
  {
    // Felt ball: high friction, soft bounce; floats in Matter water (M4).
    type: 'fuzz', family: 'rollers', name: 'FUZZ', tag: 'Fuzzy ball', ship: 'M2', bounds: centred([0.065, 0.065, 0.065]),
    body: { kind: 'dynamic', mass: 0.058, friction: 1.2, restitution: 0.7, ccd: true, material: 'fabric' },
    shapes: () => [{ kind: 'sphere', size: [0.065, 0.065, 0.065] }],
    visuals: () => [{ mesh: 'sphere', size: [0.065, 0.065, 0.065], color: C.amber, rough: 0.9 }],
    ports: [], props: {}, art: 'fuzz', behaviours: ['rigid_basic'],
  },
  {
    // Cast-iron ball, 6.5 kg, magnetic (Field parts land in M3).
    type: 'pig_iron', family: 'rollers', name: 'PIG IRON', tag: 'Iron ball', ship: 'M2', bounds: centred([0.12, 0.12, 0.12]),
    body: { kind: 'dynamic', mass: 6.5, friction: 0.4, restitution: 0.1, ccd: true, material: 'steel', magnetic: true },
    shapes: () => [{ kind: 'sphere', size: [0.12, 0.12, 0.12] }],
    visuals: () => [
      { mesh: 'sphere', size: [0.12, 0.12, 0.12], color: C.graphite, rough: 0.35, metal: 0.8 },
      { mesh: 'cylinder', size: [0.122, 0.012, 0.122], color: C.steel, rough: 0.25, metal: 1 },
    ],
    ports: [], props: {}, art: 'pig_iron', behaviours: ['rigid_basic'],
  },
  // ---- Frame ----------------------------------------------------------------------------------------
  {
    // Funnel: balls roll and spiral down the low-friction bowl and drop through the outlet bore.
    // Origin = bottom centre of the outlet spigot.
    type: 'vortex', family: 'frame', name: 'VORTEX', tag: 'Funnel', ship: 'M2', bounds: bottom([0.8, 0.45, 0.8]),
    boundsFor: (p) => { const v = vortexProfile(p); return bottom([v.rim * 2, v.height, v.rim * 2]); },
    body: { kind: 'static', mass: 0, friction: 0.15, restitution: 0.3, material: 'powder' },
    shapes: vortexShapes,
    visuals: (p) => {
      const v = vortexProfile(p);
      const pts = v.pts;
      const out: VisualDef[] = [];
      // blockout bowl: thin rings at each profile point (art replaces it)
      for (const [r, y] of pts) out.push({ mesh: 'cylinder', size: [r * 2 + 0.012, 0.012, r * 2 + 0.012], at: [0, y, 0], color: C.cobalt, rough: 0.45 });
      out.push({ mesh: 'cylinder', size: [v.bore * 2 + 0.03, pts[pts.length - 1]![1], v.bore * 2 + 0.03], at: [0, pts[pts.length - 1]![1] / 2, 0], color: C.cobalt, rough: 0.45 });
      return out;
    },
    ports: [],
    props: { size: { type: 'enum', values: ['Wide', 'Slim'], default: 0, label: 'Size' } },
    art: 'vortex', behaviours: ['rigid_basic'],
  },
  {
    // Trampoline: whatever lands on the mat leaves at 1.15 × its arrival speed, capped at 8 m/s.
    type: 'sprong', family: 'frame', name: 'SPRONG', tag: 'Trampoline', ship: 'M2', bounds: bottom([0.3, 0.05, 0.3]),
    body: { kind: 'static', mass: 1.8, friction: 0.6, restitution: 0.3, material: 'rubber' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.01, 0.2], at: [0, 0.03, 0] },
      { kind: 'box', size: [0.3, 0.03, 0.025], at: [0, 0.02, -0.1375] },
      { kind: 'box', size: [0.3, 0.03, 0.025], at: [0, 0.02, 0.1375] },
      { kind: 'box', size: [0.025, 0.03, 0.25], at: [-0.1375, 0.02, 0] },
      { kind: 'box', size: [0.025, 0.03, 0.25], at: [0.1375, 0.02, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.22, 0.008, 0.22], at: [0, 0.031, 0], color: C.graphite, rough: 0.85 },
      { mesh: 'box', size: [0.3, 0.03, 0.025], at: [0, 0.02, -0.1375], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.3, 0.03, 0.025], at: [0, 0.02, 0.1375], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.025, 0.03, 0.25], at: [-0.1375, 0.02, 0], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.025, 0.03, 0.25], at: [0.1375, 0.02, 0], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.2, 0.004, 0.2], at: [0, 0.034, 0], color: C.volt, emissive: 0.4, when: 'pressed' },
    ],
    ports: [], props: {}, art: 'sprong', behaviours: ['sprong'],
  },
  {
    // Bucket on a LINE: an open box of 8 staves. The bail is drawn upright; its hook is the port.
    type: 'scoop', family: 'frame', name: 'SCOOP', tag: 'Bucket', ship: 'M2', bounds: bottom([0.2, 0.2, 0.2]),
    body: { kind: 'dynamic', mass: 0.45, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => {
      const out: ShapeDef[] = [{ kind: 'box', size: [0.15, 0.012, 0.15], at: [0, 0.006, 0] }];
      for (let k = 0; k < 8; k++) {
        const deg = k * 45, a = deg * RAD;
        out.push({ kind: 'box', size: [0.075, 0.18, 0.006], at: [dsin(a) * 0.087, 0.09, dcos(a) * 0.087], rot: qAxis([0, 1, 0], deg) });
      }
      return out;
    },
    visuals: () => [
      { mesh: 'box', size: [0.16, 0.012, 0.16], at: [0, 0.006, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.18, 0.18, 0.006], at: [0, 0.09, -0.087], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.18, 0.18, 0.006], at: [0, 0.09, 0.087], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.006, 0.18, 0.18], at: [-0.087, 0.09, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.006, 0.18, 0.18], at: [0.087, 0.09, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.19, 0.014, 0.19], at: [0, 0.175, 0], color: C.cobalt, rough: 0.4 },
      { mesh: 'cylinder', size: [0.006, 0.2, 0.006], at: [0, 0.185, 0], axis: 'x', color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.006, 0.085, 0.006], at: [-0.1, 0.22, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.006, 0.085, 0.006], at: [0.1, 0.22, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.2, 0.006, 0.006], at: [0, 0.262, 0], color: C.steel, metal: 1, rough: 0.3 },
    ],
    ports: [{ name: 'bail', channel: 'tension', dir: 'both', at: [0, 0.265, 0], kind: 'hook' }],
    props: {}, art: 'scoop', behaviours: ['rigid_basic', 'container'],
  },
  {
    // Trapdoor (fixed 0.30 × 0.30 in M2). Origin on the hinge axis at the panel's back edge; the panel
    // swings down about +X (0° closed … 90° open). Signal mode: latched until a pulse; passive: a
    // one-way gate whose spring holds it shut against up to 0.15 N·m of load.
    type: 'flap', family: 'frame', name: 'FLAP', tag: 'Trapdoor', ship: 'M2', bounds: b([-0.15, -0.0375, -0.02], [0.15, 0.0125, 0.28]),
    body: { kind: 'static', mass: 0.6, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: [0, 0, 0], axis: [1, 0, 0], limits: [0, 90], armMass: FLAP.mass },
    shapes: () => [
      // back rail collider: only its rear 6 mm, so the panel (whose underside becomes its back face,
      // 12.5 mm behind the hinge axis, when it hangs open) swings past it
      { kind: 'box', size: [0.3, 0.05, 0.006], at: [0, -0.0125, -0.017] },
      { kind: 'box', size: [0.3, 0.05, 0.02], at: [0, -0.0125, 0.27] },
      { kind: 'box', size: [0.02, 0.05, 0.26], at: [-0.14, -0.0125, 0.13] },
      { kind: 'box', size: [0.02, 0.05, 0.26], at: [0.14, -0.0125, 0.13] },
      { kind: 'box', size: [FLAP.panel, 0.025, FLAP.panel], at: [0, 0, 0.002 + FLAP.panel / 2], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.05, 0.02], at: [0, -0.0125, -0.01], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.3, 0.05, 0.02], at: [0, -0.0125, 0.27], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.02, 0.05, 0.26], at: [-0.14, -0.0125, 0.13], color: C.cobalt, rough: 0.4 },
      { mesh: 'box', size: [0.02, 0.05, 0.26], at: [0.14, -0.0125, 0.13], color: C.cobalt, rough: 0.4 },
      { mesh: 'cylinder', size: [0.014, 0.28, 0.014], axis: 'x', color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [FLAP.panel, 0.025, FLAP.panel], at: [0, 0, 0.002 + FLAP.panel / 2], color: C.bone, rough: 0.5, on: 'arm' },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0.11, 0.0125, 0.27], color: C.volt, emissive: 0.8, when: 'lit' },
    ],
    ports: [{ name: 'in', channel: 'signal', dir: 'in', at: [0.11, -0.0125, 0.28] }],
    props: {
      mode: { type: 'enum', values: ['Signal', 'Passive'], default: 0, label: 'Mode' },
      close: { type: 'seconds', min: 0, max: 30, step: 0.5, default: 0, label: 'Auto-close (0 = next pulse)' },
    },
    art: 'flap', behaviours: ['hinge_triggered'],
  },
  // ---- Drive ----------------------------------------------------------------------------------------
  {
    // Spin → Power: W = min(300, 40·|ω|, 0.6 · shaft power in); the power drawn brakes the rotor
    // (SIMULATION §5.5). The rotor spins in place (on-axis ghost flywheel, D62).
    type: 'dynamo', family: 'drive', name: 'DYNAMO', tag: 'Generator', ship: 'M2', bounds: b([-0.15, 0, -0.095], [0.15, 0.2, 0.095]),
    body: { kind: 'static', mass: 4.5, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: [0, 0.1, 0], axis: [1, 0, 0], armMass: 1.0, ghostArm: true },
    shapes: () => [
      { kind: 'box', size: [0.274, 0.19, 0.19], at: [0.013, 0.1, 0] },
      { kind: 'cylinder', size: [0.17, 0.024, 0.17], axis: 'x', at: [-0.136, 0.1, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.04, 0.19, 0.19], at: [-0.104, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.16, 0.15, 0.16], axis: 'x', at: [-0.009, 0.1, 0], color: C.copper, rough: 0.35, metal: 0.8 },
      { mesh: 'box', size: [0.084, 0.19, 0.19], at: [0.108, 0.1, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.17, 0.024, 0.17], axis: 'x', at: [-0.136, 0.1, 0], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.006, 0.12, 0.03], at: [-0.136, 0.1, 0], color: C.graphite, rough: 0.4, on: 'arm' },
      { mesh: 'box', size: [0.084, 0.004, 0.021], at: [0.108, 0.198, 0], color: C.volt, emissive: 0.7, when: 'powered' },
    ],
    ports: [
      { name: 'in', channel: 'spin', dir: 'in', at: [-0.151, 0.1, 0], kind: 'axle' },
      { name: 'out', channel: 'power', dir: 'out', at: [0.108, 0.1, 0.096], maxLinks: 4 },
    ],
    props: {}, art: 'dynamo', behaviours: ['rotator_driven', 'power_source'], power: { source: 300 },
  },
  {
    // Air → Spin: each pitched blade turns 0.38 × the axial wind force on it into a tangential force
    // (SIMULATION §5.8). The rotor faces +Z (front), so wind from the front drives it.
    // Bounds at rest (art E1): three blades at 120° span 0.26 m; 0.395 m tall with one blade straight up.
    type: 'turbine', family: 'drive', name: 'TURBINE', tag: 'Wind turbine', ship: 'M2', bounds: b([-0.13, 0, -0.05], [0.13, 0.395, 0.05]),
    body: { kind: 'static', mass: 1.4, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: TURBINE.hub, axis: [0, 0, 1], armMass: 0.15 },
    shapes: () => [
      { kind: 'box', size: [0.14, 0.06, 0.1], at: [0, 0.03, 0] },
      { kind: 'cylinder', size: [0.03, 0.19, 0.03], at: [0, 0.155, -0.01] },
      { kind: 'box', size: [0.04, 0.04, 0.05], at: [0, 0.25, -0.02] },
      ...turbineBlades().map((d): ShapeDef => ({ kind: 'box', size: [TURBINE.bladeLen, TURBINE.chord, 0.006], at: d.at, rot: d.rot, on: 'arm' })),
    ],
    visuals: () => [
      { mesh: 'box', size: [0.14, 0.06, 0.1], at: [0, 0.03, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.03, 0.19, 0.03], at: [0, 0.155, -0.01], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.04, 0.04, 0.05], at: [0, 0.25, -0.02], color: C.graphite, rough: 0.4 },
      { mesh: 'sphere', size: [0.04, 0.04, 0.04], at: TURBINE.hub, color: C.steel, metal: 1, rough: 0.2, on: 'arm' },
      // blockout blades drawn flat in the rotor plane (the colliders carry the 25° pitch)
      ...turbineBlades().map((d): VisualDef => ({ mesh: 'box', size: [TURBINE.bladeLen, TURBINE.chord, 0.006], at: d.at, tiltZ: d.deg, color: C.ignition, rough: 0.4, on: 'arm' })),
    ],
    ports: [{ name: 'out', channel: 'spin', dir: 'out', at: [0, 0.034, 0.051], kind: 'axle' }],
    props: {}, art: 'turbine', behaviours: ['rotator_driven'],
  },
  // ---- Air ------------------------------------------------------------------------------------------
  {
    // Bellows: a hit on the pad (≥ 0.02 N·s, 0.15 s cooldown) puffs a 1.5 m / 20° cone from the
    // nozzle (+X), its impulse ∝ the hit (SIMULATION §5.8).
    type: 'puffer', family: 'air', name: 'PUFFER', tag: 'Bellows', ship: 'M2', bounds: bottom([0.3, 0.2, 0.2]),
    body: { kind: 'static', mass: 1.6, friction: 0.7, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.24, 0.022, 0.18], at: [-0.02, 0.015, 0] },
      { kind: 'box', size: [0.2, 0.06, 0.16], at: [-0.03, 0.056, 0] },
      { kind: 'box', size: [0.24, 0.02, 0.18], at: [-0.011, 0.1366, 0], tiltZ: -18 },
      { kind: 'box', size: [0.05, 0.05, 0.06], at: [0.125, 0.055, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.24, 0.022, 0.18], at: [-0.02, 0.015, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.2, 0.06, 0.16], at: [-0.03, 0.056, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'box', size: [0.24, 0.02, 0.18], at: [-0.011, 0.1366, 0], tiltZ: -18, color: C.beam, rough: 0.4 },
      { mesh: 'box', size: [0.12, 0.004, 0.12], at: [-0.03, 0.15, 0], tiltZ: -18, color: C.rubber, rough: 0.9 },
      { mesh: 'box', size: [0.05, 0.05, 0.06], at: [0.125, 0.055, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.02, 0.03, 0.02], at: [0.155, 0.055, 0], axis: 'x', color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'cylinder', size: [0.03, 0.006, 0.03], at: [0.14, 0.055, 0], axis: 'x', color: C.beam, emissive: 0.8, when: 'pressed' },
    ],
    ports: [], props: {}, art: 'puffer', behaviours: ['air_emitter'],
  },
  // ---- Power and signal -----------------------------------------------------------------------------
  {
    // Battery: 200 W while charged; the drawn power drains it (SIMULATION §5.5).
    type: 'cell', family: 'power', name: 'CELL', tag: 'Battery', ship: 'M2', bounds: bottom([0.1, 0.2, 0.1]),
    body: { kind: 'dynamic', mass: 0.6, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [{ kind: 'box', size: [0.09, 0.17, 0.09], at: [0, 0.085, 0] }, { kind: 'cylinder', size: [0.06, 0.014, 0.06], at: [0, 0.177, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.17, 0.09], at: [0, 0.085, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.06, 0.014, 0.06], at: [0, 0.177, 0], color: C.volt, rough: 0.35, metal: 0.6 },
      { mesh: 'cylinder', size: [0.02, 0.01, 0.02], at: [0, 0.189, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'box', size: [0.014, 0.03, 0.004], at: [0, 0.11, 0.046], color: C.volt, emissive: 0.8, when: 'powered' },
    ],
    ports: [{ name: 'out', channel: 'power', dir: 'out', at: [0, 0.152, 0.046], maxLinks: 4 }],
    props: { capacity: { type: 'seconds', min: 5, max: 120, step: 5, default: 30, label: 'Capacity (s at 200 W)' } },
    art: 'cell', behaviours: ['rigid_basic', 'power_source'], power: { source: 200 },
  },
  {
    // Solar panel: 150 W × normalised incident light (SIMULATION §5.5–5.6).
    type: 'suncell', family: 'power', name: 'SUNCELL', tag: 'Solar panel', ship: 'M2', bounds: bottom([0.3, 0.021, 0.2]),
    body: { kind: 'static', mass: 0.7, friction: 0.5, restitution: 0.2, material: 'glass' },
    shapes: () => [{ kind: 'box', size: [0.3, 0.018, 0.2], at: [0, 0.012, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.3, 0.018, 0.2], at: [0, 0.012, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.24, 0.002, 0.16], at: [-0.02, 0.0215, 0], color: '#1C2230', rough: 0.1, metal: 0.3 },
      { mesh: 'box', size: [0.3, 0.004, 0.006], at: [0, 0.02, 0.097], color: C.beam, rough: 0.35 },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0.125, 0.021, -0.05], color: C.volt, emissive: 0.9, when: 'lit' },
    ],
    ports: [{ name: 'out', channel: 'power', dir: 'out', at: [0.125, 0.019, 0.075], maxLinks: 4 }],
    props: {}, art: 'suncell', behaviours: ['light_receiver', 'power_source'], power: { source: 150 },
  },
  {
    // Bulb: 40 W consumer, omni light to 6 m (receivers get f × (1 − d/6)², SIMULATION §5.6).
    type: 'lamp', family: 'power', name: 'LAMP', tag: 'Light bulb', ship: 'M2', bounds: bottom([0.1, 0.2, 0.1]),
    body: { kind: 'static', mass: 0.5, friction: 0.5, restitution: 0.2, material: 'glass' },
    shapes: () => [{ kind: 'box', size: [0.09, 0.07, 0.09], at: [0, 0.035, 0] }, { kind: 'sphere', size: [0.088, 0.088, 0.088], at: [0, 0.148, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.07, 0.09], at: [0, 0.035, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.042, 0.024, 0.042], at: [0, 0.082, 0], color: C.steel, metal: 1, rough: 0.3 },
      { mesh: 'sphere', size: [0.088, 0.088, 0.088], at: [0, 0.148, 0], color: C.glass, rough: 0.05 },
      { mesh: 'sphere', size: [0.03, 0.03, 0.03], at: [0, 0.148, 0], color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [{ name: 'in', channel: 'power', dir: 'in', at: [0, 0.036, 0.046] }],
    props: {}, art: 'lamp', behaviours: ['light_emitter', 'power_consumer'], power: { consumer: 40 },
  },
  {
    // Flashlight: a Signal toggles its 20° cone (9 rays) along +X.
    type: 'torch', family: 'power', name: 'TORCH', tag: 'Flashlight', ship: 'M2', bounds: bottom([0.2, 0.1, 0.1]),
    body: { kind: 'static', mass: 0.4, friction: 0.5, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.16, 0.065, 0.065], at: [-0.02, 0.055, 0] },
      { kind: 'cylinder', size: [0.088, 0.04, 0.088], axis: 'x', at: [0.08, 0.055, 0] },
      { kind: 'box', size: [0.14, 0.02, 0.07], at: [-0.015, 0.01, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.16, 0.065, 0.065], at: [-0.02, 0.055, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.088, 0.04, 0.088], axis: 'x', at: [0.08, 0.055, 0], color: C.beam, rough: 0.3, metal: 0.6 },
      { mesh: 'box', size: [0.14, 0.02, 0.07], at: [-0.015, 0.01, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'cylinder', size: [0.022, 0.01, 0.022], at: [-0.03, 0.09, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.075, 0.004, 0.075], axis: 'x', at: [0.1, 0.055, 0], color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [{ name: 'in', channel: 'signal', dir: 'in', at: [-0.015, 0.055, 0.0335] }],
    props: {
      on: { type: 'bool', default: 0, label: 'On at start' },
      mode: { type: 'enum', values: ['Toggle', 'On', 'Off'], default: 0, label: 'Signal' },
    },
    art: 'torch', behaviours: ['light_emitter'],
  },
  {
    // Magnifier: light through its lens converges to a focus `focal` metres beyond it; a surface the
    // beam hits within ±0.03 m of the focus gets a 0.02 m heat spot (SIMULATION §5.6–5.7).
    type: 'burning_glass', family: 'power', name: 'BURNING GLASS', tag: 'Magnifier', ship: 'M2', bounds: bottom([0.1, 0.3, 0.1]),
    body: { kind: 'static', mass: 0.6, friction: 0.5, restitution: 0.2, material: 'glass' },
    shapes: () => [
      { kind: 'box', size: [0.09, 0.03, 0.09], at: [0, 0.015, 0] },
      { kind: 'cylinder', size: [0.02, 0.156, 0.02], at: [0, 0.112, 0] },
      { kind: 'cylinder', size: [0.098, 0.014, 0.098], axis: 'z', at: [0, 0.245, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.03, 0.09], at: [0, 0.015, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.02, 0.156, 0.02], at: [0, 0.112, 0], color: C.walnut, rough: 0.6 },
      { mesh: 'cylinder', size: [0.098, 0.01, 0.098], axis: 'z', at: [0, 0.245, 0], color: C.beam, rough: 0.3, metal: 0.6 },
      { mesh: 'cylinder', size: [0.084, 0.014, 0.084], axis: 'z', at: [0, 0.245, 0], color: C.glass, rough: 0.05 },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0, 0.02, 0.046], color: C.ignition, emissive: 1, when: 'lit' },
    ],
    ports: [],
    props: { focal: { type: 'metres', min: 0.1, max: 1, step: 0.01, default: 0.3, label: 'Focal length' } },
    art: 'burning_glass', behaviours: ['light_optic'],
  },
  {
    // Lever switch: a knob hit (≥ 0.03 N·s, 0.2 s cooldown) flips it; each flip pulses `out_signal`,
    // and while on it joins the power components on `in` and `out_power` (SIMULATION §5.5).
    type: 'toggle', family: 'power', name: 'TOGGLE', tag: 'Lever switch', ship: 'M2', bounds: bottom([0.1, 0.19, 0.1]),
    body: { kind: 'static', mass: 0.4, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: [0, 0.08, 0], axis: [0, 0, 1], limits: [-25, 25], armMass: 0.05 },
    shapes: (p) => {
      const l = lever(p.on ?? 0);
      return [
        { kind: 'box', size: [0.09, 0.075, 0.09], at: [0, 0.0375, 0] },
        { kind: 'capsule', size: [0.01, 0.11, 0.01], at: l.at, tiltZ: l.tilt, on: 'arm' },
        { kind: 'sphere', size: [0.026, 0.026, 0.026], at: l.knob, on: 'arm' },
      ];
    },
    visuals: (p) => {
      const l = lever(p.on ?? 0);
      return [
        { mesh: 'box', size: [0.09, 0.075, 0.09], at: [0, 0.0375, 0], color: C.graphite, rough: 0.4 },
        { mesh: 'box', size: [0.08, 0.004, 0.08], at: [0, 0.077, 0], color: C.bone, rough: 0.5 },
        { mesh: 'cylinder', size: [0.008, 0.11, 0.008], at: l.at, tiltZ: l.tilt, color: C.steel, metal: 1, rough: 0.2, on: 'arm' },
        { mesh: 'sphere', size: [0.039, 0.039, 0.039], at: l.knob, color: C.volt, rough: 0.35, on: 'arm' },
        { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0.025, 0.08, 0.03], color: C.volt, emissive: 0.9, when: 'lit' },
      ];
    },
    ports: [
      { name: 'in', channel: 'power', dir: 'in', at: [-0.046, 0.042, 0] },
      // art names (E1): out_power faces +X, out_signal faces the front
      { name: 'out_power', channel: 'power', dir: 'out', at: [0.046, 0.042, 0] },
      { name: 'out_signal', channel: 'signal', dir: 'out', at: [0, 0.042, 0.046], maxLinks: 8 },
    ],
    props: { on: { type: 'bool', default: 0, label: 'On at start' } },
    art: 'toggle', behaviours: ['sensor_pulse', 'power_switch'],
  },
  {
    // Alarm-clock timer: counts down from the run start; at zero it rings for 2 s: a Signal pulse,
    // a `Ring` event and an 80 dB Sound (SIMULATION §5.10).
    type: 'ringer', family: 'power', name: 'RINGER', tag: 'Alarm timer', ship: 'M2', bounds: bottom([0.1, 0.1, 0.08]),
    body: { kind: 'static', mass: 0.5, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [{ kind: 'box', size: [0.09, 0.062, 0.06], at: [0, 0.049, 0] }, { kind: 'box', size: [0.086, 0.017, 0.034], at: [0, 0.0905, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.062, 0.06], at: [0, 0.049, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'box', size: [0.044, 0.02, 0.003], at: [0, 0.05, 0.031], color: '#101318', rough: 0.2 },
      { mesh: 'sphere', size: [0.034, 0.02, 0.034], at: [-0.026, 0.09, 0], color: C.amber, rough: 0.35, metal: 0.4 },
      { mesh: 'sphere', size: [0.034, 0.02, 0.034], at: [0.026, 0.09, 0], color: C.amber, rough: 0.35, metal: 0.4 },
      { mesh: 'box', size: [0.006, 0.018, 0.006], at: [-0.03, 0.009, 0], color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'box', size: [0.006, 0.018, 0.006], at: [0.03, 0.009, 0], color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [0, 0.08, 0.025], color: C.beam, emissive: 0.9, when: 'lit' },
    ],
    ports: [{ name: 'out', channel: 'signal', dir: 'out', at: [0.046, 0.05, 0], maxLinks: 8 }],
    props: { time: { type: 'seconds', min: 1, max: 30, step: 0.5, default: 5, label: 'Time' } },
    art: 'ringer', behaviours: ['timer'],
  },
  {
    // Signal delay: every pulse in leaves `out` round(delay × tick rate) ticks later (SIMULATION §5.2).
    type: 'delay', family: 'power', name: 'DELAY', tag: 'Signal delay', ship: 'M2', bounds: bottom([0.1, 0.1, 0.09]),
    body: { kind: 'static', mass: 0.35, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: () => [{ kind: 'box', size: [0.09, 0.08, 0.09], at: [0, 0.042, 0] }],
    visuals: () => [
      { mesh: 'box', size: [0.09, 0.08, 0.09], at: [0, 0.042, 0], color: C.graphite, rough: 0.4 },
      { mesh: 'cylinder', size: [0.034, 0.014, 0.034], at: [0, 0.089, 0], color: C.volt, rough: 0.35, metal: 0.6 },
      { mesh: 'box', size: [0.034, 0.02, 0.003], at: [0, 0.062, 0.046], color: '#101318', rough: 0.2 },
      { mesh: 'box', size: [0.05, 0.025, 0.003], at: [0, 0.028, 0.046], color: C.brass, rough: 0.3, metal: 0.8 },
      { mesh: 'sphere', size: [0.006, 0.006, 0.006], at: [-0.03, 0.08, 0.046], color: C.beam, emissive: 0.9, when: 'lit' },
    ],
    ports: [
      { name: 'in', channel: 'signal', dir: 'in', at: [-0.046, 0.045, 0], maxLinks: 4 },
      { name: 'out', channel: 'signal', dir: 'out', at: [0.046, 0.045, 0], maxLinks: 8 },
    ],
    props: { delay: { type: 'seconds', min: 0.1, max: 30, step: 0.1, default: 1, label: 'Delay' } },
    art: 'delay', behaviours: ['timer'],
  },
  // ---- Fire and boom --------------------------------------------------------------------------------
  {
    // Detonator: a hit on the handle (≥ 0.3 N·s) or ≥ 1 kg resting on it fires once: a pulse to
    // every linked explosive (broadcast port, up to 64 links).
    type: 't_plunger', family: 'boom', name: 'T-PLUNGER', tag: 'Detonator', ship: 'M2', bounds: bottom([0.2, 0.3, 0.2]),
    body: { kind: 'static', mass: 2.5, friction: 0.6, restitution: 0.2, material: 'powder' },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.024, 0.2], at: [0, 0.012, 0] },
      { kind: 'box', size: [0.18, 0.135, 0.18], at: [0, 0.0915, 0] },
      { kind: 'cylinder', size: [0.016, 0.126, 0.016], at: [0, 0.222, 0] },
      { kind: 'box', size: [0.16, 0.035, 0.035], at: [0, 0.2825, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.024, 0.2], at: [0, 0.012, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'box', size: [0.18, 0.135, 0.18], at: [0, 0.0915, 0], color: C.red, rough: 0.6 },
      { mesh: 'box', size: [0.06, 0.08, 0.004], at: [-0.05, 0.075, 0.091], color: C.amber, rough: 0.2 },
      { mesh: 'cylinder', size: [0.016, 0.126, 0.016], at: [0, 0.222, 0], color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'box', size: [0.16, 0.035, 0.035], at: [0, 0.2825, 0], color: C.graphite, rough: 0.45 },
      { mesh: 'sphere', size: [0.012, 0.008, 0.012], at: [0.06, 0.16, 0.07], color: C.amber, emissive: 0.9, when: 'lit' },
    ],
    ports: [{ name: 'out', channel: 'signal', dir: 'out', at: [0.055, 0.075, 0.091], maxLinks: 64, broadcast: true }],
    props: {}, art: 't_plunger', behaviours: ['sensor_pulse'],
  },
  {
    // Rocket: heat on its fuse lights a short stub, then 2.0 s of thrust along its axis (+Y), then it
    // coasts as a body. The exhaust plume is a heat source while thrusting (SIMULATION §5.7).
    type: 'skyrocket', family: 'boom', name: 'SKYROCKET', tag: 'Rocket', ship: 'M2', bounds: b([-0.05, -0.12, -0.05], [0.05, 0.18, 0.05]),
    body: { kind: 'dynamic', mass: 0.3, friction: 0.5, restitution: 0.25, material: 'paper' },
    shapes: () => [
      { kind: 'capsule', size: [0.06, 0.27, 0.06], at: [0, 0.035, 0] },
      ...FIN_DEG.map((deg): ShapeDef => {
        const a = deg * RAD;
        return { kind: 'box', size: [0.03, 0.07, 0.004], at: [dcos(a) * 0.04, -0.085, -dsin(a) * 0.04], rot: qAxis([0, 1, 0], deg) };
      }),
    ],
    visuals: () => [
      { mesh: 'cylinder', size: [0.05, 0.18, 0.05], at: [0, 0, 0], color: C.red, rough: 0.6 },
      { mesh: 'cylinder', size: [0.04, 0.075, 0.04], at: [0, 0.128, 0], color: C.amber, rough: 0.45 },
      { mesh: 'cylinder', size: [0.03, 0.015, 0.03], at: [0, 0.172, 0], color: C.rubber, rough: 0.8 },
      { mesh: 'cylinder', size: [0.036, 0.03, 0.036], at: [0, -0.105, 0], color: C.graphite, rough: 0.45 },
      ...FIN_DEG.map((deg): VisualDef => {
        const a = deg * RAD;
        return { mesh: 'box', size: deg === 90 ? [0.004, 0.07, 0.03] : [0.03, 0.07, 0.004], at: [dcos(a) * 0.04, -0.085, -dsin(a) * 0.04], color: C.graphite, rough: 0.45 };
      }),
      { mesh: 'sphere', size: [0.05, 0.12, 0.05], at: [0, -0.17, 0], color: C.flame, emissive: 1, when: 'lit' },
    ],
    ports: [{ name: 'fuse', channel: 'heat', dir: 'in', at: [0, -0.045, 0.032] }],
    props: { fuse: { type: 'seconds', min: 0.2, max: 5, step: 0.1, default: 0.5, label: 'Fuse' } },
    art: 'skyrocket', behaviours: ['rigid_basic', 'flammable', 'launcher'], flammable: { igniteTime: 0.05 },
  },
  {
    // Circus cannon: a Roller that drops into the bell is caught and held on the bore axis; heat on
    // the touch-hole (or a FUSE to its port) fires it at v = clamp(√(2E/m), 2, 14) m/s.
    type: 'big_top', family: 'boom', name: 'BIG TOP', tag: 'Circus cannon', ship: 'M2', bounds: b([-0.3, 0, -0.205], [0.29, 0.416, 0.205]),
    body: { kind: 'static', mass: 18, friction: 0.5, restitution: 0.25, material: 'powder' },
    shapes: (p) => {
      const e = p.elevation ?? 30;
      return [
        { kind: 'box', size: [0.36, 0.16, 0.016], at: [-0.06, 0.14, -0.178] },
        { kind: 'box', size: [0.36, 0.16, 0.016], at: [-0.06, 0.14, 0.178] },
        { kind: 'cylinder', size: [0.18, 0.016, 0.18], axis: 'z', at: [0.02, 0.09, -0.197] },
        { kind: 'cylinder', size: [0.18, 0.016, 0.18], axis: 'z', at: [0.02, 0.09, 0.197] },
        { kind: 'box', size: [0.2, 0.04, 0.1], at: [-0.2, 0.02, 0] },
        { kind: 'cylinder', size: [BIG_TOP.barrelR * 2, 0.22, BIG_TOP.barrelR * 2], axis: 'x', tiltZ: e, at: bigTopAt(e, 0.05) },
      ];
    },
    visuals: (p) => {
      const e = p.elevation ?? 30;
      return [
        { mesh: 'box', size: [0.36, 0.16, 0.016], at: [-0.06, 0.14, -0.178], color: C.graphite, rough: 0.45 },
        { mesh: 'box', size: [0.36, 0.16, 0.016], at: [-0.06, 0.14, 0.178], color: C.graphite, rough: 0.45 },
        { mesh: 'cylinder', size: [0.18, 0.016, 0.18], axis: 'z', at: [0.02, 0.09, -0.197], color: C.rubber, rough: 0.8 },
        { mesh: 'cylinder', size: [0.18, 0.016, 0.18], axis: 'z', at: [0.02, 0.09, 0.197], color: C.rubber, rough: 0.8 },
        { mesh: 'box', size: [0.2, 0.04, 0.1], at: [-0.2, 0.02, 0], color: C.graphite, rough: 0.45 },
        { mesh: 'cylinder', size: [0.3, 0.12, 0.3], axis: 'x', tiltZ: e, at: bigTopAt(e, 0), color: C.ignition, rough: 0.4 },
        { mesh: 'cylinder', size: [0.36, 0.1, 0.36], axis: 'x', tiltZ: e, at: bigTopAt(e, 0.11), color: C.ignition, rough: 0.4 },
        { mesh: 'cylinder', size: [0.27, 0.005, 0.27], axis: 'x', tiltZ: e, at: bigTopAt(e, 0.161), color: '#2A1A14', rough: 0.9 },
        { mesh: 'sphere', size: [0.02, 0.02, 0.02], at: bigTopTouchHole(e), color: C.flame, emissive: 1, when: 'lit' },
      ];
    },
    ports: [{ name: 'fuse', channel: 'heat', dir: 'in', at: [-0.2, 0.1, 0.186] }],
    props: {
      elevation: { type: 'angle', min: 15, max: 55, step: 5, default: 30, label: 'Elevation' },
      power: { type: 'int', min: 1, max: 5, default: 3, label: 'Power' },
    },
    art: 'big_top', behaviours: ['launcher'], flammable: { igniteTime: 0.05 },
  },
  {
    // Toy pop-gun: a Signal (or ≥ 4 N on the pull hook) fires its sharp cork at 12 m/s along +X; the
    // cork stays tied on by a 1.5 m string. The cork is a pre-built body (role 'piece').
    type: 'cork_blaster', family: 'boom', name: 'CORK BLASTER', tag: 'Cork pop-gun', ship: 'M2', bounds: bottom([0.3, 0.1, 0.1]),
    body: { kind: 'static', mass: 0.9, friction: 0.5, restitution: 0.25, material: 'powder' },
    piece: {
      shapes: [{ kind: 'capsule', size: [0.028, 0.035, 0.028], axis: 'x', at: [0.13, 0.06, 0] }],
      mass: 0.02, friction: 0.9, restitution: 0.6, sharp: true, ccd: true,
    },
    shapes: () => [
      { kind: 'box', size: [0.18, 0.039, 0.08], at: [0, 0.0195, 0] },
      { kind: 'cylinder', size: [0.06, 0.23, 0.06], axis: 'x', at: [-0.005, 0.06, 0] },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.18, 0.039, 0.08], at: [0, 0.0195, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.06, 0.23, 0.06], axis: 'x', at: [-0.005, 0.06, 0], color: C.ignition, rough: 0.35 },
      { mesh: 'cylinder', size: [0.075, 0.025, 0.075], axis: 'x', at: [0.105, 0.06, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.045, 0.006, 0.045], axis: 'x', at: [-0.135, 0.06, 0], color: C.ignition, rough: 0.2 },
      { mesh: 'sphere', size: [0.008, 0.008, 0.008], at: [0, 0.04, 0.03], color: C.beam, emissive: 0.9, when: 'lit' },
      { mesh: 'cylinder', size: [0.028, 0.035, 0.028], axis: 'x', at: [0.13, 0.06, 0], color: C.cork, rough: 0.8, on: 'piece' },
    ],
    ports: [
      { name: 'fire', channel: 'signal', dir: 'in', at: [-0.03, 0.021, 0.041] },
      { name: 'pull', channel: 'tension', dir: 'in', at: [-0.128, 0.06, 0], kind: 'hook' },
    ],
    props: {}, art: 'cork_blaster', behaviours: ['launcher'],
  },
  // ---- Contraptions ---------------------------------------------------------------------------------
  {
    // Spring boxing glove: a Signal punches the 2 kg glove out 0.5 m along +X at up to 6 m/s (slider
    // with a motor), holds 0.25 s, then ratchets back over 0.6 s.
    type: 'punchline', family: 'contraptions', name: 'PUNCHLINE', tag: 'Boxing glove', ship: 'M2', bounds: bottom([0.3, 0.2, 0.2]),
    body: { kind: 'static', mass: 4, friction: 0.5, restitution: 0.25, material: 'powder' },
    slider: { at: [0.115, 0.09, 0], axis: [1, 0, 0], limits: [0, 0.5], armMass: 2 },
    shapes: () => [
      { kind: 'box', size: [0.2, 0.176, 0.176], at: [-0.05, 0.092, 0] },
      { kind: 'sphere', size: [0.11, 0.11, 0.11], at: [0.115, 0.09, 0], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.2, 0.176, 0.176], at: [-0.05, 0.092, 0], color: C.bone, rough: 0.5 },
      { mesh: 'cylinder', size: [0.05, 0.12, 0.05], axis: 'x', at: [-0.05, 0.12, 0], color: C.steel, metal: 1, rough: 0.2 },
      { mesh: 'sphere', size: [0.12, 0.12, 0.12], at: [0.115, 0.09, 0], color: C.ignition, rough: 0.5, on: 'arm' },
      { mesh: 'cylinder', size: [0.024, 0.06, 0.024], axis: 'x', at: [0.045, 0.09, 0], color: C.steel, metal: 1, rough: 0.2, on: 'arm' },
    ],
    ports: [{ name: 'trigger', channel: 'signal', dir: 'in', at: [-0.1, 0.06, 0.088] }],
    props: {}, art: 'punchline', behaviours: ['slider_actuator'],
  },
  {
    // Pop-up box: three crank turns on Spin, or a whack (box 1.0 N·s, lid 0.5 N·s), pops the head: it
    // springs up 0.30 m, lunges 35° forward (+Z) and bonks what's there. The head is a kinematic
    // pre-built body (role 'piece').
    // bounds include the front crank (knob to z 0.12)
    type: 'gotcha_box', family: 'contraptions', name: 'GOTCHA BOX', tag: 'Pop-up box', ship: 'M2', bounds: b([-0.1, 0, -0.1], [0.1, 0.2, 0.12]),
    body: { kind: 'static', mass: 3, friction: 0.5, restitution: 0.25, material: 'powder' },
    hinge: { at: [0.035, 0.095, 0.09], axis: [0, 0, 1], armMass: 0.1, ghostArm: true },
    piece: { shapes: [{ kind: 'sphere', size: [0.11, 0.11, 0.11], at: GOTCHA.rest }], mass: 0.3, friction: 0.5, restitution: 0.4, kinematic: true },
    shapes: () => [
      { kind: 'box', size: [0.18, 0.17, 0.18], at: [0, 0.089, 0] },
      { kind: 'cylinder', size: [0.05, 0.01, 0.05], axis: 'z', at: [0.035, 0.095, 0.09], on: 'arm' },
    ],
    visuals: () => [
      { mesh: 'box', size: [0.18, 0.17, 0.18], at: [0, 0.089, 0], color: C.bone, rough: 0.5 },
      { mesh: 'box', size: [0.186, 0.012, 0.186], at: [0, 0.18, 0], color: C.ignition, rough: 0.4 },
      { mesh: 'box', size: [0.05, 0.08, 0.004], at: [-0.055, 0.1, 0.091], color: C.brass, rough: 0.3, metal: 0.8 },
      { mesh: 'box', size: [0.04, 0.008, 0.008], at: [0.055, 0.095, 0.1], color: C.steel, metal: 1, rough: 0.3, on: 'arm' },
      { mesh: 'sphere', size: [0.025, 0.025, 0.025], at: [0.075, 0.095, 0.11], color: C.ignition, rough: 0.4, on: 'arm' },
      { mesh: 'sphere', size: [0.11, 0.11, 0.11], at: GOTCHA.rest, color: C.bone, rough: 0.4, on: 'piece' },
      { mesh: 'sphere', size: [0.025, 0.025, 0.025], at: [GOTCHA.rest[0], GOTCHA.rest[1], GOTCHA.rest[2] + 0.055], color: C.ignition, rough: 0.4, on: 'piece' },
    ],
    ports: [{ name: 'crank', channel: 'spin', dir: 'in', at: [0.035, 0.095, 0.091], kind: 'axle' }],
    props: {}, art: 'gotcha_box', behaviours: ['rotator_driven'],
  },
];
