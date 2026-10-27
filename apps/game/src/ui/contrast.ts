// Colour maths for the glass legibility guard (D77, D80, UI_UX §2): parse CSS colours, composite
// translucent layers over a backdrop, and measure WCAG contrast. Pure, for the CI check
// (apps/game/test/contrast.test.ts), which reads the tokens straight from styles.css.

export type Rgb = readonly [number, number, number]; // 0..255
export type Rgba = readonly [number, number, number, number]; // 0..255, alpha 0..1

export const WHITE: Rgb = [255, 255, 255];

/** Parse `#rgb`, `#rrggbb`, `rgb(r g b / a)`, `rgb(r, g, b)` and `rgba(r, g, b, a)`. */
export function parseColor(s: string): Rgba {
  const t = s.trim().toLowerCase();
  if (t.startsWith('#')) {
    const h = t.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    if (!/^[0-9a-f]{6}$/.test(full)) throw new Error(`bad colour ${s}`);
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (!m) throw new Error(`bad colour ${s}`);
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? (Number(x.slice(0, -1)) / 100) : Number(x)));
  if (parts.length < 3 || parts.some((x) => !Number.isFinite(x))) throw new Error(`bad colour ${s}`);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

/** Source-over: a translucent layer on an opaque backdrop. */
export function over(top: Rgba, bottom: Rgb): Rgb {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)];
}

/** Composite layers bottom-up over a backdrop: `stack(white, [panel, well])`. */
export function stack(backdrop: Rgb, layers: readonly Rgba[]): Rgb {
  return layers.reduce<Rgb>((acc, l) => over(l, acc), backdrop);
}

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio of a text colour (composited over `bg` if translucent) on `bg`. */
export function contrast(text: Rgba | Rgb, bg: Rgb): number {
  const t = text.length === 4 ? over(text as Rgba, bg) : (text as Rgb);
  const a = luminance(t), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Custom properties declared in every `:root { … }` block of a stylesheet (first declaration wins). */
export function rootTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of noComments.matchAll(/(^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const d of block[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!(d[1]! in out)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

/** Resolve `var(--x)` chains against a token table. */
export function resolveToken(tokens: Record<string, string>, name: string, depth = 0): string {
  const v = tokens[name];
  if (v === undefined) throw new Error(`missing token ${name}`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m && depth < 8) return resolveToken(tokens, m[1]!, depth + 1);
  return v;
}
