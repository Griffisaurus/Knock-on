// Colour-vision-deficiency maths for the colour presets (M4 stream U4; GAME_SPEC §20 "Channel overlays are
// colour-blind-safe (glyph-coded, with alternate palettes)"). Machado, Oliveira & Fernandes (2009)
// full-severity simulation matrices in linear sRGB, and CIELAB distance (ΔE*ab, D65). Pure: the palette
// check in test/a11y.test.ts measures how far apart the channel colours stay under each deficiency.

export type Cvd = 'protanopia' | 'deuteranopia' | 'tritanopia';
type M3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

export const MACHADO: Readonly<Record<Cvd, M3>> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const toLin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const toSrgb = (l: number): number => { const c = Math.min(1, Math.max(0, l)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** How a colour looks with a full-severity deficiency (sRGB 0..255). */
export function simulate(rgb: readonly [number, number, number], cvd: Cvd | null): [number, number, number] {
  if (!cvd) return [rgb[0], rgb[1], rgb[2]];
  const m = MACHADO[cvd];
  const l = rgb.map(toLin) as [number, number, number];
  return [0, 1, 2].map((r) => toSrgb(m[r]![0] * l[0] + m[r]![1] * l[1] + m[r]![2] * l[2])) as [number, number, number];
}

/** sRGB → CIELAB (D65). */
export function lab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map(toLin) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export const deltaE = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** The closest pair of a palette as seen with `cvd` (ΔE*ab), with its names. */
export function closestPair(palette: Readonly<Record<string, string>>, cvd: Cvd | null): { a: string; b: string; d: number } {
  const keys = Object.keys(palette);
  let best = { a: '', b: '', d: Infinity };
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const d = deltaE(simulate(hexRgb(palette[keys[i]!]!), cvd), simulate(hexRgb(palette[keys[j]!]!), cvd));
    if (d < best.d) best = { a: keys[i]!, b: keys[j]!, d };
  }
  return best;
}
