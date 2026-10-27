// CI contrast check for the Glass Lab UI (D77, D80, UI_UX §2): every glass surface is measured over a
// pure white backdrop (the worst case of the brightest set; the blur of a uniform white is white). Text
// drawn straight on a glass fill must reach 4.5:1, and so must text on the raised wells inside it and on
// the stand-alone wells (toasts, chat, menus). The tokens come from styles.css, so changing a token there
// is what this test checks.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, parseColor, resolveToken, rootTokens, stack, WHITE, type Rgb } from '../src/ui/contrast.ts';
import { GLASS_SURFACES } from '../src/ui/glass.ts';

const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
const tokens = rootTokens(css);
const color = (name: string) => parseColor(resolveToken(tokens, name));
const MIN = 4.5;

describe('colour maths', () => {
  it('parses hex and rgb() forms', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#12151C')).toEqual([18, 21, 28, 1]);
    expect(parseColor('rgb(16 19 26 / .64)')).toEqual([16, 19, 26, 0.64]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(() => parseColor('teal')).toThrow();
  });
  it('matches the WCAG reference ratios', () => {
    expect(contrast([0, 0, 0], WHITE)).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], WHITE)).toBeCloseTo(1, 5);
    // UI_UX §2: Void on Ignition is 6.3:1
    expect(contrast(parseColor('#0B0D12'), parseColor('#FF5B2E').slice(0, 3) as unknown as Rgb)).toBeCloseTo(6.3, 1);
  });
  it('reproduces the UI_UX §2 open-item numbers for the old .58 tint', () => {
    const paper = color('--kn-paper');
    const old = contrast(paper, stack(WHITE, [parseColor('rgb(16 19 26 / .58)')]));
    const well = contrast(paper, stack(WHITE, [color('--glass-well')]));
    console.log(`Paper on .58 over white ${old.toFixed(2)}:1 (doc: about 4.0) · on the .72 well ${well.toFixed(2)}:1 (doc: about 6.7)`);
    expect(old).toBeLessThan(MIN);
    expect(old).toBeGreaterThan(3.8);
    expect(well).toBeGreaterThan(6.4);
    expect(well).toBeLessThan(6.8);
  });
});

describe('Glass Lab contrast over white (D80, ≥ 4.5:1)', () => {
  const rows: string[] = [];
  const check = (label: string, text: string, layers: string[]): number => {
    const bg = stack(WHITE, layers.map(color));
    const r = contrast(color(text), bg);
    rows.push(`${label.padEnd(30)} ${text.padEnd(10)} on ${layers.join(' + ').padEnd(36)} ${r.toFixed(2)}:1`);
    return r;
  };

  it('the text tint is the D80 value', () => {
    expect(parseColor(resolveToken(tokens, '--glass-tint'))[3]).toBeCloseTo(0.64, 3);
    expect(parseColor(resolveToken(tokens, '--glass-well'))[3]).toBeCloseTo(0.72, 3);
  });

  for (const s of GLASS_SURFACES) {
    it(`${s.label} (${s.selector})`, () => {
      for (const t of s.onGlass) expect(check(s.label, t, [s.tint])).toBeGreaterThanOrEqual(MIN);
      for (const t of s.onWell) expect(check(`${s.label} › well`, t, [s.tint, '--glass-well'])).toBeGreaterThanOrEqual(MIN);
      // key hints sit on a dark chip, on glass or on a well
      expect(check(`${s.label} › kbd`, '--kn-paper', [s.tint, '--kbd-bg'])).toBeGreaterThanOrEqual(MIN);
    });
  }

  it('stand-alone wells (toasts, chat, menus, part card) and the solid fallback', () => {
    for (const t of ['--kn-paper', '--text-2']) {
      expect(check('stand-alone well', t, ['--glass-well'])).toBeGreaterThanOrEqual(MIN);
      expect(check('pop surface', t, ['--pop-bg'])).toBeGreaterThanOrEqual(MIN);
      expect(check('solid Graphite', t, ['--kn-graphite'])).toBeGreaterThanOrEqual(MIN);
      expect(check('solid Slate well', t, ['--kn-slate'])).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('the chrome tint (.58) carries no body text', () => {
    // allowed only where no small text sits on it (D80); no registered surface uses it for text
    expect(GLASS_SURFACES.filter((s) => s.tint === '--glass-tint-chrome' && s.onGlass.length)).toEqual([]);
  });

  it('reports the table', () => {
    // printed for docs/dev/M3_NOTES_U3.md
    console.log(`\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('accents', () => {
  it('selected-state gradient with white text (D86: both stops ≥ 4.5:1)', () => {
    const white: Rgb = [255, 255, 255];
    const stops = [...resolveToken(tokens, '--kn-select').matchAll(/#[0-9a-f]{6}/gi)].map((m) => parseColor(m[0]).slice(0, 3) as unknown as Rgb);
    expect(stops).toHaveLength(2);
    const [top, bottom] = stops.map((c) => contrast(white, c)) as [number, number];
    console.log(`select gradient (${resolveToken(tokens, '--kn-select')}), white text: top ${top.toFixed(2)} · bottom ${bottom.toFixed(2)}`);
    expect(top).toBeGreaterThanOrEqual(MIN);
    expect(bottom).toBeGreaterThanOrEqual(MIN);
  });
  it('Void text on Ignition buttons', () => {
    expect(contrast(color('--kn-void'), [0xff, 0x5b, 0x2e])).toBeGreaterThanOrEqual(MIN);
  });
});

// M4 stream U4: the colour presets (Settings › Accessibility) override tokens under :root[data-colours="…"];
// every glass surface is re-measured with each preset's tokens, over white.
describe('colour presets (U4): every surface still ≥ 4.5:1 over white', () => {
  const presetTokens = (name: string): Record<string, string> => {
    const out: Record<string, string> = { ...tokens };
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of noComments.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      const sels = block[1]!.split(',').map((x) => x.trim());
      if (!sels.includes(`:root[data-colours="${name}"]`)) continue;
      for (const d of block[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
    }
    return out;
  };
  for (const name of ['high-contrast', 'deuteranopia', 'protanopia', 'tritanopia']) {
    it(name, () => {
      const t = presetTokens(name);
      const col = (n: string) => parseColor(resolveToken(t, n));
      const lines: string[] = [];
      let worst = Infinity;
      for (const s of GLASS_SURFACES) {
        for (const tx of s.onGlass) worst = Math.min(worst, contrast(col(tx), stack(WHITE, [col(s.tint)])));
        for (const tx of s.onWell) worst = Math.min(worst, contrast(col(tx), stack(WHITE, [col(s.tint), col('--glass-well')])));
      }
      for (const tx of ['--kn-paper', '--text-2']) {
        worst = Math.min(worst, contrast(col(tx), stack(WHITE, [col('--glass-well')])), contrast(col(tx), stack(WHITE, [col('--pop-bg')])), contrast(col(tx), [...col('--kn-graphite')].slice(0, 3) as unknown as Rgb));
      }
      lines.push(`${name}: worst text ${worst.toFixed(2)}:1 · glass tint ${resolveToken(t, '--glass-tint')}`);
      console.log(lines.join(' '));
      expect(worst).toBeGreaterThanOrEqual(MIN);
    });
  }
  it('high contrast raises the glass tint and the secondary text', () => {
    const t = presetTokens('high-contrast');
    expect(parseColor(resolveToken(t, '--glass-tint'))[3]).toBeGreaterThan(parseColor(resolveToken(tokens, '--glass-tint'))[3]);
    expect(resolveToken(t, '--text-2')).not.toBe(resolveToken(tokens, '--text-2'));
  });
});

// M5 stream U5: the M5 in-world chips are opaque and carry text or a glyph in Void: BUZZ's tag (Amber), GRABBER's
// zone A (Beam) and zone B (Amber) letters. Every colour preset keeps them ≥ 4.5:1 (the chip is opaque, so the
// backdrop doesn't matter); the warning lines (⚠ + Paper) sit on wells, covered above.
describe('U5 (M5) chips: Void on Amber / Beam in every preset', () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const presetTokens = (name: string | null): Record<string, string> => {
    const out: Record<string, string> = { ...tokens };
    if (!name) return out;
    for (const block of noComments.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      const sels = block[1]!.split(',').map((x) => x.trim());
      if (!sels.includes(`:root[data-colours="${name}"]`)) continue;
      for (const d of block[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
    }
    return out;
  };
  it('the chip rules use those tokens', () => {
    expect(noComments).toMatch(/\.buzz-tag \{[^}]*background: var\(--kn-amber\); color: var\(--kn-void\)/);
    expect(noComments).toMatch(/\.zone-chip \{[^}]*background: var\(--kn-beam\); color: var\(--kn-void\)/);
    expect(noComments).toMatch(/\.zone-chip\[data-z="B"\] \{ background: var\(--kn-amber\)/);
  });
  for (const name of [null, 'high-contrast', 'deuteranopia', 'protanopia', 'tritanopia']) {
    it(name ?? 'default', () => {
      const t = presetTokens(name);
      const rgb = (n: string): Rgb => parseColor(resolveToken(t, n)).slice(0, 3) as unknown as Rgb;
      const amber = contrast(rgb('--kn-void'), rgb('--kn-amber'));
      const beam = contrast(rgb('--kn-void'), rgb('--kn-beam'));
      console.log(`${name ?? 'default'}: Void on Amber ${amber.toFixed(2)}:1 · Void on Beam ${beam.toFixed(2)}:1`);
      expect(amber).toBeGreaterThanOrEqual(MIN);
      expect(beam).toBeGreaterThanOrEqual(MIN);
    });
  }
});
