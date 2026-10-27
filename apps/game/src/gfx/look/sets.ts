// Per-environment look data (environments.md §1.4, §2.3, §3.4; D79, D82): the light rig the renderer
// shades with, the set bake (sun, sky, probe, bounds), fog, grade and finishing. The Tinker Lab follows
// the approved key art (`tools/blender/render_tinker_lab.py`): sun from behind-right through the back
// wall's windows, ≈ 20° up, warm; cool sky fill; real scale (bench top 0.9 m, the mat is world y = 0).

import { norm, type V3 } from '../../math.ts';
import type { StudioLook } from '../renderer.ts';
import type { FogParams } from './fog.ts';
import { NEUTRAL_GRADE, type Grade } from './lut.ts';

export interface SetLook {
  readonly id: string;
  /** IBL diffuse / specular intensity and the weight of the old hemisphere ambient (Studio continuity). */
  readonly ibl: { readonly diffuse: number; readonly spec: number; readonly hemi: number };
  readonly sky: { readonly top: readonly [number, number, number]; readonly horizon: readonly [number, number, number]; readonly ground: readonly [number, number, number] };
  readonly sunScale: number; // bake sun = keyColor × keyI × sunScale
  readonly emissive: number;
  readonly probe: V3;
  readonly bounds: { readonly min: V3; readonly max: V3 };
  readonly fog: FogParams | null;
  readonly grade: Grade;
  readonly lutFile?: string;
  /** E3b's 32 × 32³ PNG strip LUT (tried after `lutFile`). */
  readonly lutPng?: string;
  /** E3b's baked IBL descriptor (`ibl_<set>.json` → equirect `.hdr`), × `iblScale` into engine units. */
  readonly iblFile?: string;
  readonly iblScale?: number;
  readonly vignette: number;
  readonly grain: number;
  /** Scale on the practicals' key-art intensity (70 W against the strength-9 sun), matched to the key art. */
  readonly practicalScale?: number;
  /** Practical lamp stand-ins (world position, linear colour × intensity, radius m) when the set has no data. */
  readonly practicals: readonly { readonly pos: V3; readonly color: readonly [number, number, number]; readonly radius: number }[];
}

const lin = (h: string): [number, number, number] => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
};

/** Blender Z-up (front −Y) → engine Y-up (front +Z); the key art's mat top (z 0.904) is world y = 0. */
export const MAT_Z = 0.904;
export const fromBlender = (x: number, y: number, z: number): V3 => [x, z - MAT_Z, -y];

/** THE TINKER LAB, golden hour (D82: the key art's rig). */
export const TINKER_LIGHT: StudioLook = {
  cyc: lin('#E9DCC3'),
  key: norm([0.5, 0.42, -1.0]),                  // to the sun: behind (the window wall), right, 20.6° up
  fill: norm([-0.55, 0.45, 0.7]),                // the warm fill from the camera side (key art 'Fill')
  rim: norm([0.35, 0.55, -0.75]),                // cool window sky
  keyI: 4.2, fillI: 0.8, rimI: 0.35,
  // exposure and fill matched region by region to the key art (M3_NOTES_L3: the D79 proof)
  rimColor: [0.62, 0.74, 1.0], etch: 0, exposure: 1.15,
  keyColor: [1.0, 0.74, 0.47],
};

export const TINKER_SET: SetLook = {
  id: 'tinker',
  ibl: { diffuse: 1.0, spec: 0.85, hemi: 0 },
  sky: { top: [0.42 * 0.9, 0.5 * 0.9, 0.62 * 0.9], horizon: lin('#FFD9A0').map((v) => v * 1.2) as [number, number, number], ground: [0.25, 0.17, 0.1] },
  sunScale: 1, emissive: 1,
  probe: fromBlender(0.1, -0.6, 1.35),
  bounds: { min: fromBlender(-4.5, -3.5, 0) as V3, max: fromBlender(4.5, 3.5, 3.3) as V3 },
  fog: {
    // environments.md §3.4: 0.010 / m, anisotropy 0.65 (the sun term scaled so the shafts read like the key art's haze)
    density: 0.012, falloff: 0.05, base: -0.9, g: 0.65, ambient: [0.002, 0.0017, 0.0014], sunScale: 0.35,
    haze: 0.012, hazeColor: [0.09, 0.07, 0.05],
  },
  // the key art's comp: lift (1, .99, .97), gain (1.05, 1, .93), AgX high contrast; brief: highlights +6 % warmth, teal shadows
  grade: { lift: [1, 0.99, 0.97], gamma: [1, 1, 1], gain: [1.05, 1.0, 0.93], warm: 0.6, teal: 0.35, sat: 1.06, contrast: 0.22 },
  lutFile: '/env/tinker/lut_tinker_lab.cube',
  lutPng: '/env/tinker/lut_tinker_lab.png',
  // Cycles radiance → engine: the bake's sun is strength 9 (a white diffuse reads 9 / π); ours reads keyI
  iblFile: '/env/tinker/ibl_tinker_lab.json',
  iblScale: (Math.PI * 4.2) / 9,
  vignette: 0.15, grain: 0.02,
  practicalScale: 0.35,
  practicals: [
    // the key art's 70 W pendants (2,700 K): about two thirds of the sun's irradiance on the bench below
    { pos: fromBlender(-0.35, 0.05, 1.9), color: [6, 4, 2.4], radius: 3.5 },
    { pos: fromBlender(0.95, 0.15, 1.95), color: [6, 4, 2.4], radius: 3.5 },
    { pos: fromBlender(2.6, 0.6, 2.1), color: [6, 4, 2.4], radius: 3.5 },
  ],
};

export const KITCHEN_SET: SetLook = {
  id: 'kitchen',
  ibl: { diffuse: 0.9, spec: 0.8, hemi: 0 },
  sky: { top: lin('#CFE6FF'), horizon: lin('#FFF1DC'), ground: [0.3, 0.26, 0.2] },
  sunScale: 1, emissive: 1,
  probe: [0, 1.2, 0],
  bounds: { min: [-12, -1, -12], max: [12, 8, 12] },
  fog: { density: 0.012, falloff: 0.08, base: 0, g: 0.6, ambient: [0.004, 0.004, 0.004], sunScale: 0.5, haze: 0.006, hazeColor: [0.1, 0.09, 0.08] },
  grade: { lift: [1, 1, 0.99], gamma: [1, 1, 1], gain: [1.03, 1.0, 0.96], warm: 0.35, teal: 0.2, sat: 1.03, contrast: 0.12 },
  lutFile: '/env/kitchen/lut_kitchen_morning.cube',
  vignette: 0.15, grain: 0.02,
  practicals: [],
};

/** The Studio: no set, its IBL is the cyc sky; neutral grade; vignette and grain only (RENDERING §9). */
export function studioSet(L: StudioLook): SetLook {
  const c = L.cyc;
  return {
    id: 'studio',
    ibl: { diffuse: 0, spec: 0, hemi: 1 },
    sky: { top: [c[0] * 1.15, c[1] * 1.15, c[2] * 1.17], horizon: [...c] as [number, number, number], ground: [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92] },
    sunScale: 0, emissive: 1,
    probe: [0, 0.5, 0],
    bounds: { min: [-10, 0, -10], max: [10, 5, 10] },
    fog: null,
    grade: NEUTRAL_GRADE,
    vignette: 0.15, grain: 0.02,
    practicals: [],
  };
}

// ---- W5 (M5): ORBITAL HANGAR and MOON BASE (environments.md §5.3, §6.4) -------------------------------------------------
// Directions are "toward the light" (engine Y-up, front +Z; Blender +Y = engine −Z). Exposure is the look's fixed scale
// (the engine has no auto exposure yet): the brief's EV100 11 (Hangar) and 15 fixed (Moon) map onto it relative to
// the Tinker Lab's 9.5.

/** ORBITAL HANGAR: the 5,800 K sun through the window (30° up, from +Y), 6,500 K ceiling strips from above, the 9,000 K
 *  earthlight from below the window line (0.06 × sun) on undersides. */
export const HANGAR_LIGHT: StudioLook = {
  cyc: lin('#0B0E14'),                         // space through the window (the sky term in reflections)
  key: norm([0, 0.5, -0.8660254]),             // to the sun: behind, through the back-wall window, 30° up
  fill: norm([0.08, 1, 0.12]),                 // the ceiling strips
  rim: norm([0, -0.17364818, -0.98480775]),    // earthlight from below the window line
  keyI: 3.4, fillI: 1.15, rimI: 0.2,
  rimColor: lin('#9CC8FF'), etch: 0, exposure: 0.5, // measured in Chrome against E5c's bay bake (EV100 11 is brighter than the Lab's 9.5)
  keyColor: [1.0, 0.93, 0.86],                 // 5,800 K
};

export const HANGAR_SET: SetLook = {
  id: 'hangar',
  ibl: { diffuse: 0.95, spec: 0.8, hemi: 0 },
  sky: { top: [0.6, 0.66, 0.76], horizon: [0.42, 0.46, 0.54], ground: [0.32, 0.33, 0.35] },
  sunScale: 1, emissive: 1,
  probe: [0, 8, 0],
  bounds: { min: [-33, 0, -33], max: [33, 26, 33] },
  fog: null,
  // lut_hangar (§5.3): slightly cool shadows, neutral highlights
  grade: { lift: [0.99, 1, 1.02], gamma: [1, 1, 1], gain: [1, 1, 1], warm: 0, teal: 0.2, sat: 1.02, contrast: 0.12 },
  lutPng: '/env/hangar/lut_hangar.png',
  vignette: 0.12, grain: 0.015,
  practicalScale: 0.6,
  // the 4 shadowed area-approximations over the neutral zone (§5.3), as pendant stand-ins (EnvView moves them per bay)
  practicals: [
    { pos: [-4, 18, 8], color: [5, 5.4, 6], radius: 14 }, { pos: [4, 18, 8], color: [5, 5.4, 6], radius: 14 },
    { pos: [-4, 18, 16], color: [5, 5.4, 6], radius: 14 }, { pos: [4, 18, 16], color: [5, 5.4, 6], radius: 14 },
  ],
};

/** MOON BASE: one hard 5,900 K sun 18° up from front-left (raking, long black shadows), no sky (pure black), the regolith's
 *  bounce from below (0.08 × sun, the 4 / 8 GB fallback the brief gives) and a faint blue earthshine. */
export const MOON_LIGHT: StudioLook = {
  cyc: [0, 0, 0],                              // the black sky
  key: norm([-0.82363910, 0.30901699, 0.47552826]),
  fill: [0, -1, 0],                            // ground bounce, from below
  rim: norm([0.41338, 0.20791, -0.88651]),     // earthshine from Earth's direction
  keyI: 4.6, fillI: 0.37, rimI: 0.02,
  rimColor: lin('#A8C4FF'), etch: 0, exposure: 0.8,
  keyColor: [1.0, 0.95, 0.9],                  // 5,900 K
};

export const MOON_SET: SetLook = {
  id: 'moon',
  ibl: { diffuse: 0.6, spec: 0.5, hemi: 0 },
  sky: { top: [0, 0, 0], horizon: [0.004, 0.004, 0.005], ground: [0.16, 0.155, 0.148] },
  sunScale: 1, emissive: 1,
  probe: [0, 3, 0],
  bounds: { min: [-130, -1, -130], max: [130, 30, 130] },
  fog: null,                                   // never any haze: the crisp black horizon is the point
  // lut_moon (§6.4): neutral, slight cool shadows
  grade: { lift: [0.995, 1, 1.01], gamma: [1, 1, 1], gain: [1, 1, 1], warm: 0, teal: 0.12, sat: 1, contrast: 0.1 },
  lutPng: '/env/moon/lut_moon.png',
  // E5c's Cycles bake (sun strength 8) → engine units, as the Tinker Lab's
  iblFile: '/env/moon/ibl_moon.json',
  iblScale: (Math.PI * 4.6) / 8,
  vignette: 0.1, grain: 0.01,
  practicals: [],
};
