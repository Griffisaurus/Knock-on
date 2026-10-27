// R5 (M5): engine-drawn `kn_screen` content shared by the static (glbmesh.ts) and skinned (skin.ts) art paths.
// A screen vertex's material bytes say what the part shader draws there (shaders.ts fs_part, KIND_SCREEN):
//   bar / 7-seg / text: [cells / 255, 0, 0, screen]       (the M1 bar meter, code from the instance flags)
//   icon:               [aspect / 8, 1, side, screen]     (an LED icon face, `screenIcon`; the icon comes from the
//                                                          instance's metal byte, SceneItem.icon: 0 dark, 1 + index)
// side: 0 = the critter's left eye, 1 = its right eye (icons mirror), 0.5 = one wide visor drawing both eyes.

import { CHANNEL_RGB, hexLin } from '../catalog.ts';
import { MAT_KIND } from './meshes.ts';

export interface ScreenInfo {
  readonly name: string;
  readonly kind: string;
  readonly pos: readonly number[];
  readonly size: readonly number[];
  readonly cells?: number;
  readonly digits?: number;
  readonly color?: string;
}

/** The LED icon set shared by DUSTY's eyes and BUZZ's visor (critters.md: `faceIcons` order in `.art.json`). */
export const FACE_ICONS = ['neutral', 'blink', 'happy', 'smug', 'scared', 'angry', 'dizzy', 'sleepy', 'surprised', 'determined', 'scan', 'strain'] as const;

const BRAND: Readonly<Record<string, string>> = { beam: '#2FD6FF', plasma: '#FF3DAE', amber: '#FFB020', ignition: '#FF5B2E', cobalt: '#3355FF', volt: '#D7FF3A', bone: '#EEF1F6' };

/** Linear RGB of a screen's colour name (a channel, else a brand colour; default power). */
export function screenRgb(name: string | undefined): readonly number[] {
  const ch = (CHANNEL_RGB as Record<string, readonly number[] | undefined>)[name ?? 'power'];
  if (ch) return ch;
  const b = BRAND[name ?? ''];
  return b ? hexLin(b) : CHANNEL_RGB.power;
}

/** The screen whose centre is nearest a point (art.json positions are in the glb's model space). */
export function nearestScreen(screens: readonly ScreenInfo[], x: number, y: number, z: number): ScreenInfo {
  let best = screens[0]!, bd = Infinity;
  for (const s of screens) {
    const d = (s.pos[0]! - x) ** 2 + (s.pos[1]! - y) ** 2 + (s.pos[2]! - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Vertex material bytes for a screen (see the header). */
export function screenVm(s: ScreenInfo): [number, number, number, number] {
  if (s.kind === 'icon') {
    const dims = s.size.map(Math.abs).filter((v) => v > 1e-6).sort((a, b) => b - a);
    const aspect = dims.length >= 2 ? dims[0]! / dims[1]! : 2;
    const side = /(_l|left)$/.test(s.name) ? 0 : /(_r|right)$/.test(s.name) ? 1 : 0.5;
    return [Math.min(1, aspect / 8), 1, side, MAT_KIND.screen];
  }
  return [Math.min(255, s.cells ?? s.digits ?? 10) / 255, 0, 0, MAT_KIND.screen];
}

/** Icon code for SceneItem.icon: 0 dark, 1 + FACE_ICONS index. */
export function iconCode(name: string): number {
  const i = (FACE_ICONS as readonly string[]).indexOf(name);
  return i < 0 ? 1 : i + 1;
}
