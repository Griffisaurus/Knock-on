// W5 (M5): ORBITAL HANGAR and MOON BASE set data (art/briefs/environments.md §5, §6; M5_PLAN contract 4).
// The types are what W5 reads of E5c's generated `env_hangar.ts` / `env_moon.ts` (their contract: docs/dev/M5_NOTES_E5c.md).
// Until those land, HANGAR_SET / MOON_SET / moonField below are W5's stand-ins built from the brief's layout tables: static
// colliders per preset, cameras, drones, the zero-g zones, the emitters and a stand-in regolith heightfield. Switching to
// E5c's data is the three lines at the end of this file.
// Engine space: metres, Y-up, front (default camera side) = +Z. Blender (x, y, z) → engine (x, z, −y). Real scale.
// Each preset is in its own world coordinates, origin = its bounds floor centre (all presets share it here).
// + − × ÷ only (determinism lint).

import { HANGAR } from './env_hangar.ts'; // E5c (generated)
import { MOON, moonTerrain } from './env_moon.ts'; // E5c (generated)

export type SpacePhys = 'powder' | 'wood' | 'ceramic' | 'steel' | 'glass' | 'rubber' | 'paper' | 'fabric' | 'concrete' | 'regolith';
export type SpaceV3 = readonly [number, number, number];

/** Static axis-aligned box: centre and half extents (engine metres). */
export interface SpaceBox { readonly name: string; readonly center: SpaceV3; readonly half: SpaceV3; readonly phys: SpacePhys }
export interface SpaceSphere { readonly name: string; readonly center: SpaceV3; readonly radius: number; readonly phys: SpacePhys }
/** Static convex hull (E5c's `COL__hull` pieces, ≤ 32 points), with its bounding box. */
export interface SpaceHull { readonly name: string; readonly points: readonly SpaceV3[]; readonly phys: SpacePhys; readonly aabb?: { readonly min: SpaceV3; readonly max: SpaceV3 } }
export interface SpaceCamera { readonly pos: SpaceV3; readonly target: SpaceV3; readonly fovYDeg: number; readonly focusM?: number; readonly fStop?: number }

/**
 * A zero-g zone (`ZONE__field__zerog_n`, environments.md §5.1; E5c's `HangarZone`): an Antigrav field at `gravityPercent`
 * (0 = weightless) over a vertical cylinder (`center` at mid-height, `radius`, `halfHeight`) or its `box`. Players can
 * switch the zones off (env.zones), never move them. `ring` is the floor ring the renderer draws (glb mesh prefix).
 */
export interface SpaceZone {
  readonly name: string;
  readonly field: string;
  readonly gravityPercent: number;
  readonly shape: 'cylinder' | 'box';
  readonly center: SpaceV3;
  readonly radius: number;
  readonly halfHeight: number;
  readonly box: { readonly min: SpaceV3; readonly max: SpaceV3 };
  readonly ring?: { readonly center: SpaceV3; readonly innerRadius: number; readonly outerRadius: number; readonly mesh: string };
}

/** A fixed heightfield in format's TerrainRecord layout (u16 × maxHeight ÷ 65535, rows along +z from origin[1]). */
export interface SpaceTerrain {
  readonly origin: readonly [number, number];
  readonly nx: number;
  readonly nz: number;
  readonly maxHeight: number;
  readonly heights: Uint16Array;
  readonly preset: string;
}

export interface SpacePreset {
  /** Hangar: each bay is its own glb (§5: each preset is its own bay). Absent = the environment's `glb`. */
  readonly glb?: string;
  /** Where this preset's world origin sits in set coordinates; the glb is drawn at −origin. */
  readonly origin: SpaceV3;
  readonly bounds: { readonly min: SpaceV3; readonly max: SpaceV3 };
  readonly neutral: { readonly min: SpaceV3; readonly max: SpaceV3 };
  readonly camera: SpaceV3;
  readonly target: SpaceV3;
  readonly cameras: { readonly default: SpaceCamera } & Readonly<Record<string, SpaceCamera>>;
  readonly drones: readonly [SpaceV3, SpaceV3];
  readonly scaleRef: SpaceV3;
  readonly boxes: readonly SpaceBox[];
  readonly spheres: readonly SpaceSphere[];
  readonly hulls?: readonly SpaceHull[];
  /** Zero-g zones (Hangar). */
  readonly zones?: readonly SpaceZone[];
  /** Ambience emitters (environments.md §5.6 / §6.7), preset world coordinates. */
  readonly emitters: readonly { readonly name: string; readonly pos: SpaceV3 }[];
}

/** What W5 reads of an environment (E5c's `HangarEnv` / `MoonEnv` carry more: light rig, IBL, Earth, practicals). */
export interface SpaceEnv {
  readonly env: 'hangar' | 'moon';
  readonly scale: number;
  /** Gravity (percent) and air (fraction): format envPhysics has the same values. */
  readonly gravityPercent: number;
  readonly air: number;
  readonly feel: 'real';
  /** Moon: the one shared glb (the Hangar has one per bay, on its presets). */
  readonly glb?: string;
  readonly presets: Readonly<Partial<Record<'room' | 'warehouse' | 'arena', SpacePreset>>>;
  readonly lut?: { readonly name: string; readonly file: string };
  readonly noShadow: readonly string[];
  /** Single-sided meshes drawn with back-face culling (the Bay 2 front wall, so the spawn camera sees in). */
  readonly cutaway?: readonly string[];
  /** True for W5's stand-in data (E5c's generated files omit it). */
  readonly standIn?: boolean;
}

// ---- stand-in builders (W5) -----------------------------------------------------------------------------------------

const box = (name: string, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, phys: SpacePhys): SpaceBox =>
  ({ name, center: [cx, cy, cz], half: [hx, hy, hz], phys });

/** The scale reference (environments.md §0.7) at floor point (x, y, z): plinth, stick and foot, the THUD on top. */
function scaleRef(x: number, y: number, z: number): { boxes: SpaceBox[]; spheres: SpaceSphere[] } {
  return {
    boxes: [box('scale_plinth', x, y + 0.225, z, 0.2, 0.225, 0.2, 'powder'), box('scale_stick', x + 0.35, y + 0.52, z, 0.02, 0.5, 0.01, 'powder'),
      box('scale_foot', x + 0.35, y + 0.01, z, 0.06, 0.01, 0.06, 'powder')],
    spheres: [{ name: 'scale_thud', center: [x, y + 0.45 + 0.11, z], radius: 0.11, phys: 'powder' }],
  };
}

const cam = (pos: SpaceV3, target: SpaceV3): SpaceCamera => ({ pos, target, fovYDeg: 40 });

/** A hangar bay: deck, four walls just outside the bounds, ceiling, the window glass in the back wall. */
function hangarShell(w: number, ceil: number, win: { half: number; y0: number; y1: number }): SpaceBox[] {
  const t = 0.5;
  return [
    box('deck', 0, -0.25, 0, w + 1, 0.25, w + 1, 'steel'),
    box('wall_left', -w - t, ceil / 2, 0, t, ceil / 2, w + 1, 'powder'),
    box('wall_right', w + t, ceil / 2, 0, t, ceil / 2, w + 1, 'powder'),
    box('wall_front', 0, ceil / 2, w + t, w + 1, ceil / 2, t, 'powder'),
    // the back wall around the window, and the glass plane in it (+Y in Blender = engine −Z)
    box('wall_back_low', 0, win.y0 / 2, -w - t, w + 1, win.y0 / 2, t, 'powder'),
    box('wall_back_high', 0, (win.y1 + ceil) / 2, -w - t, w + 1, (ceil - win.y1) / 2, t, 'powder'),
    box('wall_back_left', -(w + 1 + win.half) / 2, (win.y0 + win.y1) / 2, -w - t, (w + 1 - win.half) / 2, (win.y1 - win.y0) / 2, t, 'powder'),
    box('wall_back_right', (w + 1 + win.half) / 2, (win.y0 + win.y1) / 2, -w - t, (w + 1 - win.half) / 2, (win.y1 - win.y0) / 2, t, 'powder'),
    box('window_glass', 0, (win.y0 + win.y1) / 2, -w - 0.2, win.half, (win.y1 - win.y0) / 2, 0.05, 'glass'),
    box('ceiling', 0, ceil + t, 0, w + 1, t, w + 1, 'powder'),
  ];
}

/** A shuttle on its docking clamps (stand-in hull: fuselage, cockpit, wings, fin), nose toward +Z (Blender −Y). */
function shuttle(name: string, x: number, z: number, s: number): SpaceBox[] {
  return [
    box(`${name}_fuselage`, x, 2.6 * s, z, 2 * s, 1.6 * s, 7 * s, 'powder'),
    box(`${name}_nose`, x, 2.4 * s, z + 8 * s, 1.4 * s, 1.1 * s, 1 * s, 'powder'),
    box(`${name}_wings`, x, 1.6 * s, z - 2 * s, 6 * s, 0.25 * s, 3 * s, 'powder'),
    box(`${name}_fin`, x, 5 * s, z - 5.5 * s, 0.2 * s, 1.6 * s, 1.5 * s, 'powder'),
    box(`${name}_clamp_fl`, x - 1.6 * s, 0.5 * s, z + 4 * s, 0.5 * s, 0.5 * s, 0.5 * s, 'steel'),
    box(`${name}_clamp_fr`, x + 1.6 * s, 0.5 * s, z + 4 * s, 0.5 * s, 0.5 * s, 0.5 * s, 'steel'),
    box(`${name}_clamp_bl`, x - 1.6 * s, 0.5 * s, z - 4 * s, 0.5 * s, 0.5 * s, 0.5 * s, 'steel'),
    box(`${name}_clamp_br`, x + 1.6 * s, 0.5 * s, z - 4 * s, 0.5 * s, 0.5 * s, 0.5 * s, 'steel'),
  ];
}

/** A stack of 2 × 2 × 4 m cargo containers (long side along z). */
function containers(name: string, x: number, z: number, n: number): SpaceBox[] {
  const out: SpaceBox[] = [];
  for (let i = 0; i < n; i++) out.push(box(`${name}_${i}`, x + (i % 2) * 2.1, 1 + Math.floor(i / 2) * 2, z, 1, 1, 2, 'powder'));
  return out;
}

/** A zero-g zone in E5c's shape: a cylinder standing on the deck at (x, z), radius r, height h. */
function zone(n: number, x: number, z: number, r: number, h: number): SpaceZone {
  return {
    name: `zerog_${n}`, field: 'antigrav', gravityPercent: 0, shape: 'cylinder', center: [x, h / 2, z], radius: r, halfHeight: h / 2,
    box: { min: [x - r, 0, z - r], max: [x + r, h, z + r] },
    ring: { center: [x, 0, z], innerRadius: r - 0.35, outerRadius: r, mesh: `env_hangar__zerog_ring_${n}` },
  };
}

const HANGAR_W: SpacePreset = (() => {
  const ref = scaleRef(10.5, 0, 21.5);
  return {
    glb: 'env/hangar/hangar_warehouse.glb',
    origin: [0, 0, 0], bounds: { min: [-32, 0, -32], max: [32, 24, 32] }, neutral: { min: [-8, 0, 4], max: [8, 0, 20] },
    camera: [0, 19.5, 42], target: [0, 1, 10], cameras: { default: cam([0, 19.5, 42], [0, 1, 10]) },
    drones: [[-5, 8, 34], [5, 8, 34]], scaleRef: [10.5, 0, 21.5],
    boxes: [
      ...hangarShell(32, 26, { half: 28, y0: 3, y1: 21 }),
      ...shuttle('shuttle', 0, -20, 1),
      box('gantry_rail', 0, 22, -6, 32, 0.4, 0.4, 'steel'),
      box('airlock_left', -32.3, 3, 10, 0.3, 3, 2.5, 'steel'), box('airlock_right', 32.3, 3, 10, 0.3, 3, 2.5, 'steel'),
      ...containers('cargo_l', -27, 24, 4), ...containers('cargo_r', 25, 24, 4),
      box('tool_cart', 13.5, 0.5, 24.5, 0.6, 0.5, 0.4, 'steel'),
      ...ref.boxes,
    ],
    spheres: ref.spheres,
    zones: [zone(1, -18, -14, 6, 20), zone(2, 18, -14, 6, 20)],
    emitters: [
      { name: 'amb_hangar_pa_chime', pos: [-31, 12, 0] }, { name: 'amb_hangar_gantry', pos: [0, 22, -6] },
      { name: 'amb_hangar_zerog_ring', pos: [-18, 0.2, -14] }, { name: 'amb_hangar_zerog_ring', pos: [18, 0.2, -14] },
      { name: 'amb_hangar_window', pos: [0, 12, -32] },
    ],
  };
})();

const HANGAR_A: SpacePreset = (() => {
  const ref = scaleRef(18.5, 0, 41.5);
  return {
    glb: 'env/hangar/hangar_arena.glb',
    origin: [0, 0, 0], bounds: { min: [-128, 0, -128], max: [128, 64, 128] }, neutral: { min: [-16, 0, 8], max: [16, 0, 40] },
    camera: [0, 41, 88], target: [0, 2, 20], cameras: { default: cam([0, 41, 88], [0, 2, 20]) },
    drones: [[-8, 20, 72], [8, 20, 72]], scaleRef: [18.5, 0, 41.5],
    boxes: [
      ...hangarShell(128, 68, { half: 110, y0: 6, y1: 56 }),
      ...shuttle('shuttle_l', -70, -80, 1.5), ...shuttle('shuttle_r', 70, -80, 1.5),
      box('gantry_rail_0', 0, 62, 0, 128, 0.6, 0.6, 'steel'), box('gantry_rail_1', 0, 62, -60, 128, 0.6, 0.6, 'steel'),
      box('airlock_left', -128.3, 4, 0, 0.3, 4, 3.5, 'steel'), box('airlock_right', 128.3, 4, 0, 0.3, 4, 3.5, 'steel'),
      box('airlock_front', 0, 4, 128.3, 3.5, 4, 0.3, 'steel'), box('airlock_back', 60, 4, -128.3, 3.5, 4, 0.3, 'steel'),
      ...containers('cargo_l0', -124, -20, 6), ...containers('cargo_l1', -124, 30, 4), ...containers('cargo_l2', -124, 90, 6),
      ...containers('cargo_r0', 120, -20, 6), ...containers('cargo_r1', 120, 30, 4), ...containers('cargo_r2', 120, 90, 6),
      ...ref.boxes,
    ],
    spheres: ref.spheres,
    zones: [zone(1, -60, -40, 12, 50), zone(2, 60, -40, 12, 50), zone(3, -60, 60, 12, 50), zone(4, 60, 60, 12, 50)],
    emitters: [
      { name: 'amb_hangar_pa_chime', pos: [-127, 20, 0] }, { name: 'amb_hangar_pa_chime', pos: [127, 20, 0] }, { name: 'amb_hangar_gantry', pos: [0, 62, 0] },
      { name: 'amb_hangar_zerog_ring', pos: [-60, 0.2, -40] }, { name: 'amb_hangar_zerog_ring', pos: [60, 0.2, -40] },
      { name: 'amb_hangar_zerog_ring', pos: [-60, 0.2, 60] }, { name: 'amb_hangar_zerog_ring', pos: [60, 0.2, 60] },
      { name: 'amb_hangar_window', pos: [0, 30, -128] },
    ],
  };
})();

/** ORBITAL HANGAR (environments.md §5), W5 stand-in. */
export const HANGAR_STANDIN: SpaceEnv = {
  env: 'hangar', scale: 1, gravityPercent: 38, air: 1, feel: 'real', standIn: true,
  presets: { warehouse: HANGAR_W, arena: HANGAR_A },
  noShadow: [], cutaway: ['wall_front'],
};

// ---- MOON BASE ----------------------------------------------------------------------------------------------------

/** The Moon's landmarks as colliders (stand-ins for E5c's hulls and meshes), standing on the stand-in ground. */
function moonProps(arena: boolean): SpaceBox[] {
  const out: SpaceBox[] = [
    // lander (−22, +18) set → engine (−22, −18), 12 m tall: descent stage, ascent stage, four legs (feet sunk into the regolith)
    box('lander_descent', -22, 4.6, -18, 2.6, 1.4, 2.6, 'powder'), box('lander_ascent', -22, 7.8, -18, 1.8, 1.8, 1.8, 'powder'),
    box('lander_leg_0', -25.4, 1.8, -21.4, 0.25, 2, 0.25, 'steel'), box('lander_leg_1', -18.6, 1.8, -21.4, 0.25, 2, 0.25, 'steel'),
    box('lander_leg_2', -25.4, 1.8, -14.6, 0.25, 2, 0.25, 'steel'), box('lander_leg_3', -18.6, 1.8, -14.6, 0.25, 2, 0.25, 'steel'),
    // rover (+20, +6) set → engine (20, −6), on the apron
    box('rover_body', 20, 1.15, -6, 1.3, 0.45, 2.1, 'powder'), box('rover_wheels', 20, 0.4, -6, 1.6, 0.4, 1.7, 'rubber'),
    // supply crates on the apron by the lander
    box('crate_0', -16.5, 0.6, -12.5, 0.6, 0.6, 0.6, 'powder'), box('crate_1', -15.4, 0.4, -13.2, 0.4, 0.4, 0.4, 'powder'),
  ];
  if (arena) {
    // solar arrays ×3 (+40…+70, +40) set → engine x 40…70, z −40; antenna mast (−60, +60) → (−60, −60), 25 m
    for (const [i, x] of [40, 55, 70].entries()) out.push(box(`solar_${i}`, x, 4.2, -40, 5, 0.08, 2.5, 'steel'), box(`solar_post_${i}`, x, 2, -40, 0.15, 2.2, 0.15, 'steel'));
    out.push(box('antenna_mast', -60, 13.5, -60, 0.4, 13.5, 0.4, 'powder'), box('pennant_pole', 6, 1.5, -21, 0.03, 1.5, 0.03, 'powder'));
  }
  return out;
}

/** The sintered apron (§6.1, Ø 48 m, top at y = 0) as concrete boxes: a 34 m square plus two 48 m bars (an octagon). */
const APRON: readonly SpaceBox[] = [
  box('apron_square', 0, -0.25, 0, 17, 0.25, 17, 'concrete'),
  box('apron_bar_x', 0, -0.25, 0, 24, 0.25, 10, 'concrete'),
  box('apron_bar_z', 0, -0.25, 0, 10, 0.25, 24, 'concrete'),
];

function moonPreset(p: 'room' | 'warehouse' | 'arena'): SpacePreset {
  const at = p === 'room' ? { ref: [5.5, 6], neutral: [[-4, -3], [4, 5]], cam: [0, 7.15, 12.5], tgt: [0, 0.5, 1], drones: [[-3, 3, 9], [3, 3, 9]], b: [8, 8] }
    : p === 'warehouse' ? { ref: [10.5, 13.5], neutral: [[-8, -4], [8, 12]], cam: [0, 18.5, 34.3], tgt: [0, 1, 4], drones: [[-5, 8, 26], [5, 8, 26]], b: [32, 24] }
      : { ref: [18.5, 21.5], neutral: [[-16, -12], [16, 20]], cam: [0, 41, 76], tgt: [0, 2, 8], drones: [[-8, 20, 60], [8, 20, 60]], b: [128, 64] };
  const v3 = (a: readonly number[]): SpaceV3 => [a[0]!, a[1]!, a[2]!];
  const rx = at.ref[0]!, rz = at.ref[1]!, ry = moonGround(rx, rz);
  const ref = scaleRef(rx, ry, rz);
  const props = p === 'room' ? [] : moonProps(p === 'arena');
  return {
    origin: [0, 0, 0], bounds: { min: [-at.b[0]!, 0, -at.b[0]!], max: [at.b[0]!, at.b[1]!, at.b[0]!] },
    neutral: { min: [at.neutral[0]![0]!, 0, at.neutral[0]![1]!], max: [at.neutral[1]![0]!, 0, at.neutral[1]![1]!] },
    camera: v3(at.cam), target: v3(at.tgt), cameras: { default: cam(v3(at.cam), v3(at.tgt)) },
    drones: [v3(at.drones[0]!), v3(at.drones[1]!)], scaleRef: [rx, ry, rz],
    boxes: [...APRON, ...props, ...ref.boxes],
    // the habitat dome (0, +40) set → engine (0, −40), Ø 30 m, 15 m tall: a hemisphere (COL__mesh in the brief)
    spheres: [...ref.spheres, ...(p === 'room' ? [] : [{ name: 'habitat_dome', center: [0, moonGround(0, -40), -40] as SpaceV3, radius: 15, phys: 'powder' as SpacePhys }])],
    emitters: [{ name: 'amb_moon_dome_hum', pos: [0, 4, -40] }, ...(p === 'arena' ? [{ name: 'amb_moon_beacon', pos: [-60, 27, -60] as SpaceV3 }] : [])],
  };
}

// ---- the Moon's fixed heightfield (stand-in for E5c's authored samples; TerrainRecord layout) --------------------------
// The ground never goes below the bounds floor (u16): the base sits on the flat floor of a shallow basin at y = 0 (the apron
// and the Arena neutral zone), and the regolith, the craters (each on its own mound, so its floor stays above 0) and the
// ridge rise around it. Integer hashing and IEEE + − × ÷ / sqrt only.

/** Craters (§6.1), engine x, z, radius and depth (m): the Ø 60 m × 8 m one at set (+80, −70), then six medium ones. */
export const MOON_CRATERS: readonly { readonly x: number; readonly z: number; readonly r: number; readonly depth: number }[] = [
  { x: 80, z: 70, r: 30, depth: 8 },
  { x: -72, z: 44, r: 10, depth: 2.6 }, { x: -96, z: -22, r: 7, depth: 1.8 }, { x: 46, z: 56, r: 8, depth: 2.0 },
  { x: 100, z: 6, r: 11, depth: 2.8 }, { x: -34, z: 92, r: 12.5, depth: 3.0 }, { x: 30, z: -96, r: 6, depth: 1.5 },
];

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell, fz = z / cell;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ux = fx - ix, uz = fz - iz;
  const sx = ux * ux * (3 - 2 * ux), sz = uz * uz * (3 - 2 * uz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** The stand-in surface height (m) at engine (x, z), before quantization. */
export function moonGround(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  const apron = smooth(24, 34, r);
  const dx = Math.max(0, Math.abs(x) - 16), dz = Math.max(0, z > 4 ? z - 20 : -12 - z);
  const rough = Math.min(apron, smooth(0, 10, Math.sqrt(dx * dx + dz * dz)));
  let h = rough * (1.1 + 0.7 * vnoise(x, z, 23, 5) + 0.25 * vnoise(x, z, 7, 13));
  h += rough * 18 * smooth(-92, -124, z) * (0.72 + 0.28 * vnoise(x, z, 37, 29)); // the ridge, set y +100…+128
  for (const c of MOON_CRATERS) {
    const d = Math.sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z));
    if (d >= c.r * 2) continue;
    const u = d / c.r, rim = 0.22 * c.depth;
    h += (c.depth + 0.4) * smooth(2, 1, u); // the crater's mound
    h += u < 1 ? rim - (c.depth + rim) * (1 - u * u) : rim * smooth(1.6, 1, u);
  }
  return Math.max(0, h);
}

const WINDOWS: Readonly<Record<string, { half: number; height: number }>> = { room: { half: 32, height: 8 }, warehouse: { half: 32, height: 24 }, arena: { half: 128, height: 64 } };
const fields = new Map<string, SpaceTerrain>();

/** The stand-in Moon heightfield for a preset (cached; read-only): Room / Warehouse the central 64 m, Arena 256 m. */
export function moonFieldStandIn(preset: string): SpaceTerrain | null {
  const w = WINDOWS[preset];
  if (!w) return null;
  const hit = fields.get(preset);
  if (hit) return hit;
  const n = w.half * 4 + 1;
  const heights = new Uint16Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    heights[iz * n + ix] = Math.max(0, Math.min(65535, Math.round((moonGround(-w.half + ix * 0.5, -w.half + iz * 0.5) * 65535) / w.height)));
  }
  const t: SpaceTerrain = { origin: [-w.half, -w.half], nx: n, nz: n, maxHeight: w.height, heights, preset };
  fields.set(preset, t);
  return t;
}

/** MOON BASE (environments.md §6), W5 stand-in. Its regolith heightfield is `moonField(preset)`. */
export const MOON_STANDIN: SpaceEnv = {
  env: 'moon', scale: 1, gravityPercent: 16.5, air: 0, feel: 'real', glb: 'env/moon/moon.glb', standIn: true,
  presets: { room: moonPreset('room'), warehouse: moonPreset('warehouse'), arena: moonPreset('arena') },
  noShadow: [],
};

// ---- what the sim and renderer use ------------------------------------------------------------------------------------
// E5c's generated `env_hangar.ts` / `env_moon.ts` (HANGAR, MOON, moonTerrain) when they land; W5's stand-ins until then.
// To switch: import them here and point these three at them.

export const HANGAR_SET: SpaceEnv = HANGAR; // E5c's (landed 2026-10-25)
export const MOON_SET: SpaceEnv = MOON; // E5c's (landed 2026-10-25)
/** The Moon's regolith heightfield for a preset (null for presets the Moon doesn't host). */
export function moonField(preset: string): SpaceTerrain | null {
  return preset === 'room' || preset === 'warehouse' || preset === 'arena' ? moonTerrain(preset) : null; // E5c's authored samples
}

/** A space set's preset, or null if the set isn't built for it. */
export function spacePreset(env: SpaceEnv, preset: string | undefined): SpacePreset | null {
  const ps = env.presets as Readonly<Record<string, SpacePreset | undefined>>;
  return ps[preset ?? ''] ?? null;
}

/** Height (m) of a space heightfield at engine (x, z): bilinear between samples; 0 outside it. */
export function spaceTerrainHeight(t: SpaceTerrain, x: number, z: number): number {
  const fx = (x - t.origin[0]) / 0.5, fz = (z - t.origin[1]) / 0.5;
  if (fx < 0 || fz < 0 || fx > t.nx - 1 || fz > t.nz - 1) return 0;
  const ix = Math.min(t.nx - 2, Math.floor(fx)), iz = Math.min(t.nz - 2, Math.floor(fz));
  const ux = fx - ix, uz = fz - iz;
  const h = t.heights;
  const a = h[iz * t.nx + ix]!, b = h[iz * t.nx + ix + 1]!, c = h[(iz + 1) * t.nx + ix]!, d = h[(iz + 1) * t.nx + ix + 1]!;
  return ((a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * t.maxHeight) / 65535;
}
