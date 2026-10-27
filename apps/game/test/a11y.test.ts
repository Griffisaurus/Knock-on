// M4 stream U4: the pure parts of the accessibility pass: the announcer's rate limiter, event captions
// and emote text, keyboard building's camera-relative arrows and port ordering, and the colour presets'
// channel palettes measured under simulated colour-vision deficiencies (Machado 2009).

import { describe, expect, it } from 'vitest';
import { AnnounceQueue } from '../src/ui/a11y.ts';
import { CaptionModel, captionFor, directionMark, emoteText, lineText, SOUND_DB_MIN } from '../src/ui/captions.ts';
import { closestPair, hexRgb, simulate, type Cvd } from '../src/ui/cvd.ts';
import { arrowStep, portsByDistance, snapTo, type PortInfo } from '../src/ui/keyboard.ts';
import { CHANNEL_PALETTES, CORE_CHANNELS, DEFAULT_CHANNELS } from '../src/ui/palettes.ts';
import { contrast, stack, WHITE, parseColor } from '../src/ui/contrast.ts';
import { CRITTER_EMOTES } from '@knockon/parts-data';

const ev = (kind: string, mag = 0, part = 1) => ({ kind, part, mag, pos: [0, 0, 0] as const });

describe('announcer queue', () => {
  it('releases one message per gap, assertive first, and drops repeats', () => {
    const q = new AnnounceQueue(700, 2500, 4);
    q.push('Placed THUD', 'polite', 0);
    q.push('Placed THUD', 'polite', 100); // repeat inside the de-dupe window
    q.push('Blocked', 'assertive', 100);
    expect(q.size).toBe(2);
    expect(q.take(200)?.text).toBe('Blocked');
    expect(q.take(500)).toBeNull(); // too soon
    expect(q.take(950)?.text).toBe('Placed THUD');
    q.push('Placed THUD', 'polite', 3000); // outside the window: spoken again
    expect(q.take(3000)?.text).toBe('Placed THUD');
  });
  it('keeps only the newest few', () => {
    const q = new AnnounceQueue(0, 0, 3);
    for (let i = 0; i < 6; i++) q.push(`m${i}`, 'polite', i);
    expect(q.size).toBe(3);
  });
});

describe('captions', () => {
  it('turns notable events into bracketed captions', () => {
    expect(captionFor(ev('Detonate', 5), 'POWDER KEG')?.text).toBe('[BOOM] POWDER KEG');
    expect(captionFor(ev('Break'), 'PANE')?.text).toBe('[crash] PANE breaks');
    expect(captionFor(ev('FuseLit'), 'WICK')?.text).toBe('[fizz] WICK fuse lit');
    expect(captionFor(ev('Impact', 99), 'THUD')).toBeNull(); // contacts are too frequent to caption
    expect(captionFor(ev('Sound', SOUND_DB_MIN - 1), 'RINGER')).toBeNull();
    expect(captionFor(ev('Sound', SOUND_DB_MIN + 10), 'RINGER', undefined, 'ringer')?.text).toBe('[RINGER rings]');
    expect(captionFor(ev('Sound', SOUND_DB_MIN + 10), 'THUD', undefined, 'thud')?.text).toBe('[clonk] THUD'); // a hard hit
  });
  it('gives critters voices by species and mood', () => {
    const e = (name: string) => CRITTER_EMOTES.indexOf(name as (typeof CRITTER_EMOTES)[number]);
    expect(captionFor(ev('Emote', e('dog_alert')), 'BISCUIT', 'biscuit')?.text).toBe('[Biscuit barks]');
    expect(captionFor(ev('Emote', e('angry')), 'MOCHI', 'mochi')?.text).toBe('[Mochi hisses]');
    expect(captionFor(ev('Emote', e('!')), 'HENNY', 'henny')?.text).toBe('[Henny squawks]');
    expect(captionFor(ev('Emote', e('zzz')), 'SOMEONE', 'newcritter')?.text).toBe('[Someone snores]'); // unknown species: defaults
    expect(captionFor(ev('Ragdoll', 30), 'PIP', 'pip')?.text).toBe('[Pip tumbles]');
    expect(emoteText('MOCHI', e('!'))).toBe('Mochi: alarmed!');
    expect(emoteText('MOCHI', 0)).toBe('');
  });
  it('collapses repeats, caps the lines and the rate, and keeps big moments', () => {
    const m = new CaptionModel(3, 3500, 2500, 4);
    const boom = { key: 'Detonate:KEG', text: '[BOOM] KEG', big: true };
    expect(m.push(boom, [0, 0, 0], 0)?.fresh).toBe(true);
    for (let i = 1; i < 6; i++) expect(m.push(boom, [0, 0, 0], i * 10)?.fresh).toBe(false);
    expect(lineText(m.lines[0]!)).toBe('[BOOM] KEG ×6');
    // a burst of small captions: 4 starts a second at most, 3 lines at most, the boom stays
    let started = 1;
    for (let i = 0; i < 8; i++) if (m.push({ key: `Cut:${i}`, text: `[snip] ${i}`, big: false }, [0, 0, 0], 100 + i)?.fresh) started++;
    expect(started).toBe(4);
    expect(m.lines).toHaveLength(3);
    expect(m.lines.some((l) => l.key === boom.key)).toBe(true);
    expect(m.expire(10_000)).toBe(true);
    expect(m.lines).toHaveLength(0);
  });
  it('marks direction', () => {
    expect(directionMark(0.1, true)).toBe('‹');
    expect(directionMark(0.5, true)).toBe('');
    expect(directionMark(0.9, true)).toBe('›');
    expect(directionMark(-0.2, false)).toBe('◂');
    expect(directionMark(1.4, false)).toBe('▸');
  });
});

describe('keyboard building', () => {
  it('maps arrows to the grid axis nearest the camera direction', () => {
    // main.ts's default camera (yaw 0) looks towards −z
    expect(arrowStep('ArrowUp', 0, 0.1)).toEqual([0, 0, -0.1]);
    expect(arrowStep('ArrowDown', 0, 0.1)).toEqual([0, 0, 0.1]);
    expect(arrowStep('ArrowRight', 0, 0.1)).toEqual([0.1, 0, 0]);
    expect(arrowStep('ArrowLeft', 0, 0.1)).toEqual([-0.1, 0, 0]);
    // camera swung round to the +x side (yaw 90°): "up" now runs towards −x
    expect(arrowStep('ArrowUp', Math.PI / 2, 0.1)).toEqual([-0.1, 0, 0]);
    expect(arrowStep('ArrowRight', Math.PI / 2, 0.1)).toEqual([0, 0, -0.1]);
    // 30° off-axis still snaps to the nearer axis
    expect(arrowStep('ArrowUp', Math.PI / 6, 0.025)).toEqual([0, 0, -0.025]);
    expect(snapTo(0.149, 0.1)).toBeCloseTo(0.1, 9);
  });
  it('orders ports nearest first', () => {
    const port = (part: number, x: number): PortInfo => ({ part, index: 0, world: [x, 0, 0], channel: 'signal', dir: 'out', label: `p${part}` });
    expect(portsByDistance([port(1, 3), port(2, -1), port(3, 0.5)], [0, 0, 0]).map((p) => p.part)).toEqual([3, 2, 1]);
  });
});

describe('colour presets: channel palettes (Machado 2009, ΔE*ab)', () => {
  const core = (p: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(CORE_CHANNELS.map((k) => [k, p[k]!]));
  const rows: string[] = [];
  const cases: [keyof typeof CHANNEL_PALETTES, Cvd][] = [['protanopia', 'protanopia'], ['deuteranopia', 'deuteranopia'], ['tritanopia', 'tritanopia']];
  for (const [preset, cvd] of cases) {
    it(`${preset}: the channels stay further apart than the default palette does`, () => {
      const before = closestPair(DEFAULT_CHANNELS, cvd), after = closestPair(CHANNEL_PALETTES[preset], cvd);
      const beforeCore = closestPair(core(DEFAULT_CHANNELS), cvd), afterCore = closestPair(core(CHANNEL_PALETTES[preset]), cvd);
      rows.push(`${preset.padEnd(13)} all 12: ${before.d.toFixed(1)} (${before.a}/${before.b}) → ${after.d.toFixed(1)} (${after.a}/${after.b}) · core 7: ${beforeCore.d.toFixed(1)} → ${afterCore.d.toFixed(1)}`);
      expect(after.d).toBeGreaterThan(before.d * 2);
      expect(after.d).toBeGreaterThanOrEqual(15); // clearly different at a glance
      expect(afterCore.d).toBeGreaterThanOrEqual(15);
      // and still distinct for normal colour vision (players share screens)
      expect(closestPair(CHANNEL_PALETTES[preset], null).d).toBeGreaterThanOrEqual(15);
    });
  }
  it('every preset colour reads against a well (≥ 3:1 over white, WCAG 1.4.11); the default lists its exceptions', () => {
    const well = stack(WHITE, [parseColor('rgb(16 19 26 / .72)')]);
    const chip = stack(WHITE, [parseColor('rgb(11 13 18 / .9)')]);
    for (const [name, pal] of Object.entries(CHANNEL_PALETTES)) {
      for (const [ch, hex] of Object.entries(pal)) {
        const rgb = hexRgb(hex);
        // the port glyph overlay draws on a near-black chip: every palette passes there
        expect(contrast(rgb, chip), `${name} ${ch} on the glyph chip`).toBeGreaterThanOrEqual(3);
        if (name !== 'default') expect(contrast(rgb, well), `${name} ${ch} on a well`).toBeGreaterThanOrEqual(3);
      }
    }
    // where glyphs actually sit in the default UI: a well inside a glass panel (cards, Inspector, chips) or the pop surface
    const inGlass = stack(WHITE, [parseColor('rgb(16 19 26 / .64)'), parseColor('rgb(16 19 26 / .72)')]);
    const pop = stack(WHITE, [parseColor('rgb(14 16 22 / .94)')]);
    for (const [ch, hex] of Object.entries(DEFAULT_CHANNELS)) {
      expect(contrast(hexRgb(hex), inGlass), `default ${ch} on a well in glass`).toBeGreaterThanOrEqual(3);
      expect(contrast(hexRgb(hex), pop), `default ${ch} on the pop surface`).toBeGreaterThanOrEqual(3);
    }
    const lowDefault = Object.entries(DEFAULT_CHANNELS).filter(([, hex]) => contrast(hexRgb(hex), well) < 3).map(([ch, hex]) => `${ch} ${contrast(hexRgb(hex), well).toFixed(2)}`);
    console.log(`default palette under 3:1 on a lone .72 well over white (no glyphs sit there): ${lowDefault.join(', ') || 'none'}`);
  });
  it('simulation sanity: red and green collapse for a deuteranope', () => {
    const r = simulate([255, 0, 0], 'deuteranopia'), g = simulate([0, 160, 0], 'deuteranopia');
    expect(Math.abs(r[0] - g[0]) + Math.abs(r[1] - g[1])).toBeLessThan(120);
    console.log(`\n${rows.join('\n')}`);
  });
});

describe('Matter indicator', () => {
  it('counts the particles a world starts with, as matterInit does', async () => {
    const { worldGrains, grainStatus, fmtCount } = await import('../src/ui/matter.ts');
    const { partDef } = await import('../src/catalog.ts');
    const { propSteps } = await import('@knockon/parts-data');
    const rec = (id: number, type: string, props: Record<string, number> = {}) => {
      const d = partDef(type)!;
      const list = Object.keys(props).map((k) => propSteps(d, k, props[k]!) as [number, number]);
      return { id, type, pos: [0, 0, 0] as [number, number, number], rot: { tag: 0 as const }, flags: 0, ...(list.length ? { props: list } : {}) };
    };
    if (!partDef('grit_hopper')) return; // A4's defs not in this checkout yet
    const g = worldGrains([rec(1, 'grit_hopper'), rec(2, 'tank'), rec(3, 'sponge'), rec(4, 'thud')]);
    expect(g.sand).toBe(200_000); // default capacity, full at start
    expect(g.water).toBe(15_000); // TANK 15 L; a sponge starts dry
    expect(g.total).toBe(215_000);
    expect(fmtCount(215_000)).toBe('215k');
    expect(fmtCount(1_250_000)).toBe('1.3M');
    expect(grainStatus(215_000, 16)?.level).toBe('ok');
    expect(grainStatus(900_000, 8)?.level).toBe('warn');
    const over = grainStatus(3_000_000, 8)!;
    expect(over.level).toBe('over');
    expect(over.text).toContain('needs 16 GB');
    expect(grainStatus(0, 16)).toBeNull();
  });
});

describe('DUSTY patrol zone tool', () => {
  it('takes drag corners into the part frame (B4 zone_x / zone_z / zone_w / zone_d)', async () => {
    const { zoneFromCorners, toLocal, toWorld } = await import('../src/ui/zonetool.ts');
    // unrotated part at (1, 0, 2): a 2 × 1 m drag centred 0.5 m to its right
    const z = zoneFromCorners([1, 0, 2], 0, [0.5, 0, 1.5], [2.5, 0, 2.5]);
    expect(z.zone_x).toBeCloseTo(0.5); expect(z.zone_z).toBeCloseTo(0); expect(z.zone_w).toBeCloseTo(2); expect(z.zone_d).toBeCloseTo(1);
    // turned 90° (yawQ about +Y): the part's forward (+z) now points along world +x
    const r = zoneFromCorners([0, 0, 0], Math.PI / 2, [1, 0, -0.5], [3, 0, 0.5]);
    expect(r.zone_z).toBeCloseTo(2); expect(r.zone_x).toBeCloseTo(0); expect(r.zone_w).toBeCloseTo(1); expect(r.zone_d).toBeCloseTo(2);
    // round trip
    const l = toLocal({ pos: [3, 0, -1] }, 0.7, [4.2, 0, 0.3]);
    const w = toWorld({ pos: [3, 0, -1] }, 0.7, l);
    expect(w[0]).toBeCloseTo(4.2); expect(w[1]).toBeCloseTo(0.3);
    // a click (no drag) still gives a usable minimum
    expect(zoneFromCorners([0, 0, 0], 0, [0, 0, 0], [0.01, 0, 0]).zone_w).toBe(0.4);
  });
});
