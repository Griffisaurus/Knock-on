// Glass Lab UI logic (stream U3): the glass budget, the frame-time fallback, the hotbar, palette
// matching and the run HUD's K.O. window and event feed.

import { describe, expect, it } from 'vitest';
import { FeedModel, KoMeter } from '../src/ui/feed.ts';
import { fuzzy, highlightRuns, parseQuery, rank, type Candidate } from '../src/ui/fuzzy.ts';
import { FrameBudget, GLASS_SURFACES, MAX_GLASS, glassCostFrom, planGlass } from '../src/ui/glass.ts';
import { Hotbar, type KeyValueStore } from '../src/ui/hotbar.ts';

describe('glass budget (UI_UX §3, §8)', () => {
  it('the Build HUD is exactly six surfaces, all blurred', () => {
    const build = ['worldcard', 'session', 'viewrail', 'inspector', 'transport', 'tray'];
    const p = planGlass(build);
    expect(p.blur).toHaveLength(6);
    expect(p.demote).toEqual([]);
  });
  it('a seventh surface demotes the lowest priority (the view rail)', () => {
    const p = planGlass(['worldcard', 'session', 'viewrail', 'inspector', 'transport', 'tray', 'radial']);
    expect(p.blur).toHaveLength(MAX_GLASS);
    expect(p.blur).toContain('radial');
    expect(p.demote).toEqual(['viewrail']);
  });
  it('a modal keeps the only blur', () => {
    const p = planGlass(['worldcard', 'session', 'tray', 'palette']);
    expect(p.blur).toEqual(['palette']);
    expect(p.demote).toHaveLength(3);
  });
  it('the Run HUD is four, the Lobby four', () => {
    expect(planGlass(['runpill', 'ko', 'feed', 'runbar']).blur).toHaveLength(4);
    expect(planGlass(['lobby-id', 'lobby-live', 'lobby-worlds', 'lobby-new']).blur).toHaveLength(4);
  });
  it('every surface id is unique and has a selector', () => {
    const ids = GLASS_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of GLASS_SURFACES) expect(s.selector).toMatch(/\S/);
  });
});

describe('frame-time fallback (UI_UX §8: over 4 ms for 2 s)', () => {
  it('trips after 2 s over budget, once', () => {
    const b = new FrameBudget(4, 2000, 1);
    let tripped = 0;
    for (let t = 0; t <= 2100; t += 16) if (b.sample(5, t)) tripped++;
    expect(tripped).toBe(1);
    expect(b.tripped).toBe(true);
  });
  it('a dip under budget restarts the 2 s window', () => {
    const b = new FrameBudget(4, 2000, 1);
    for (let t = 0; t < 1900; t += 16) b.sample(6, t);
    b.sample(1, 1900);
    for (let t = 1916; t < 3800; t += 16) expect(b.sample(6, t)).toBe(false);
    expect(b.sample(6, 3916)).toBe(true);
  });
  it('smoothing ignores a single spike', () => {
    const b = new FrameBudget(4, 100, 0.1);
    for (let t = 0; t < 1000; t += 16) b.sample(t === 480 ? 40 : 0.5, t);
    expect(b.tripped).toBe(false);
    expect(b.peak).toBe(40);
  });
  it('reset clears the latch (tier change)', () => {
    const b = new FrameBudget(4, 0, 1);
    b.sample(9, 0);
    expect(b.tripped).toBe(true);
    b.reset();
    expect(b.tripped).toBe(false);
  });
});

describe('glass cost probe (UI_UX §8, M5: robust to boot texture streaming)', () => {
  it('vsync-bound glass costs nothing', () => {
    const r = glassCostFrom([16.7, 16.7, 16.6, 16.7, 16.7], [16.7, 16.7, 16.8, 16.7]);
    expect(r.noisy).toBe(false);
    expect(r.cost).toBeLessThan(0.1);
  });
  it('a real blur cost shows in every glass round', () => {
    const r = glassCostFrom([10, 10, 10, 10, 10], [13, 13.2, 12.8, 13]);
    expect(r.noisy).toBe(false);
    expect(r.cost).toBeCloseTo(3, 1);
  });
  it('one hitch in a glass round (a texture upload) is not taken for the glass', () => {
    expect(glassCostFrom([16.7, 16.7, 16.7, 16.7, 16.7], [40, 16.7, 16.7, 16.7]).cost).toBeCloseTo(0, 5);
  });
  it('the 2026-10-25 case: loading frames throughout read as noisy, so the probe is retried', () => {
    // solid rounds swing 17–31 ms while textures stream in; the old single solid-then-glass pair read ≈ 4.5 ms
    expect(glassCostFrom([17, 31, 22, 28, 19], [24, 30, 26, 21]).noisy).toBe(true);
  });
  it('the steadiness check (no glass rounds) changes nothing on screen and gates the probe', () => {
    expect(glassCostFrom([16.7, 16.6, 16.8], []).noisy).toBe(false);
    expect(glassCostFrom([16.7, 33.4, 16.7], []).noisy).toBe(true);
  });
});

const memStore = (): KeyValueStore & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('hotbar (UI_UX §4.3)', () => {
  const defaults = ['thud', 'boing', 'helio', 'brik', 'plank', 'slope', 'fulcrum', 'motor', 'cog', 'bangstick'];
  const known = (t: string): boolean => /^[a-z_]+$/.test(t) && t !== 'nope';
  it('starts from the defaults; keys map 1…9, 0', () => {
    const h = new Hotbar(defaults, known, memStore());
    expect(h.typeAt(0)).toBe('thud');
    expect(Hotbar.indexOfKey('1')).toBe(0);
    expect(Hotbar.indexOfKey('0')).toBe(9);
    expect(Hotbar.keyOf(9)).toBe('0');
    expect(Hotbar.indexOfKey('a')).toBe(-1);
  });
  it('assigning a part already on the bar swaps the two slots', () => {
    const h = new Hotbar(defaults, known, memStore());
    h.assign(0, 'motor');
    expect(h.typeAt(0)).toBe('motor');
    expect(h.typeAt(7)).toBe('thud');
    expect(new Set(h.slots).size).toBe(10);
  });
  it('clear, unknown types, persistence and de-duplication', () => {
    const st = memStore();
    const h = new Hotbar(defaults, known, st);
    h.clear(3);
    h.assign(4, 'nope');
    expect(h.typeAt(3)).toBeNull();
    expect(h.typeAt(4)).toBe('plank');
    const again = new Hotbar(defaults, known, st);
    expect(again.slots).toEqual(h.slots);
    st.setItem('kn.hotbar', JSON.stringify(['thud', 'thud', 'nope', 7]));
    const odd = new Hotbar(defaults, known, st);
    expect(odd.slots.slice(0, 4)).toEqual(['thud', null, null, null]);
  });
  it('favourites toggle and persist', () => {
    const st = memStore();
    const h = new Hotbar(defaults, known, st);
    let fired = 0;
    h.on(() => fired++);
    expect(h.toggleFavourite('gale')).toBe(true);
    expect(new Hotbar(defaults, known, st).favourites.has('gale')).toBe(true);
    expect(h.toggleFavourite('gale')).toBe(false);
    expect(fired).toBe(2);
  });
});

describe('command palette matching (UI_UX §4.6)', () => {
  it('prefixes pick the scope', () => {
    expect(parseQuery('>wire')).toEqual({ scope: 'actions', text: 'wire' });
    expect(parseQuery('@ Motor')).toEqual({ scope: 'scene', text: 'motor' });
    expect(parseQuery('?chan')).toEqual({ scope: 'help', text: 'chan' });
    expect(parseQuery('conn')).toEqual({ scope: 'all', text: 'conn' });
  });
  it('prefix beats word start beats substring beats subsequence', () => {
    const s = (l: string): number => fuzzy(l, 'con')!.score;
    expect(s('Connect selected ports')).toBeGreaterThan(s('Show all connections'));
    expect(s('Show all connections')).toBeGreaterThan(s('Reconnect'));
    expect(s('Reconnect')).toBeGreaterThan(fuzzy('Cog on a nut', 'con')!.score);
    expect(fuzzy('Stop', 'xyz')).toBeNull();
  });
  it('hits highlight the matched letters', () => {
    const m = fuzzy('Connect selected ports', 'conn')!;
    expect(highlightRuns('Connect selected ports', m.hits)[0]).toEqual({ text: 'Conn', hit: true });
    const sub = fuzzy('Let it rip', 'lir')!;
    expect(sub.hits).toEqual([0, 4, 7]);
  });
  it('rank groups results, filters by scope, hides scene parts until asked', () => {
    const items: Candidate[] = [
      { label: 'Let it rip', group: 'Actions' }, { label: 'MOTOR', group: 'Parts' }, { label: 'MOTOR #7', group: 'Parts in scene' },
      { label: 'How channels connect parts', group: 'Help' }, { label: 'Settings: Comfort', group: 'Settings' },
    ];
    expect(rank(items, '').map((r) => r.item.label)).not.toContain('MOTOR #7');
    expect(rank(items, '@').map((r) => r.item.label)).toEqual(['MOTOR #7']);
    expect(rank(items, 'motor').map((r) => r.item.group)).toEqual(['Parts in scene', 'Parts']);
    expect(rank(items, '?').map((r) => r.item.label)).toEqual(['How channels connect parts']);
    expect(rank(items, '>').map((r) => r.item.group).sort()).toEqual(['Actions', 'Settings']);
  });
});

describe('run HUD (UI_UX §4.8)', () => {
  it('K.O. counts knock-on steps (UIFIX, D122: as the Cascade Report); "+N this second" is a 1 s sim-time window', () => {
    const k = new KoMeter();
    // a chain 1 → 2 → 3 → 4 → 5 (each event caused by the previous one, on the next part)
    for (const [i, tick] of [10, 20, 100, 200, 230].entries()) k.add({ kind: 'Impact', tick, part: i + 1, id: i + 1, cause: i ? i : -1 });
    expect(k.count).toBe(4);
    expect(k.lastSecond(230, 120)).toBe(2); // the steps at ticks 200 and 230 fall in (110, 230]
    expect(k.lastSecond(1000, 120)).toBe(0);
  });
  it('the feed collapses repeats, keeps three, newest first, and expires', () => {
    const f = new FeedModel(3, 2500, 4000);
    f.push({ kind: 'Break', part: 1 }, 'topple_tile', 0);
    for (let i = 0; i < 8; i++) f.push({ kind: 'Break', part: 2 + i }, 'topple_tile', 100 + i * 50);
    expect(f.items).toHaveLength(1);
    expect(f.items[0]!.n).toBe(9);
    f.push({ kind: 'FuseLit', part: 20 }, 'bangstick', 600);
    f.push({ kind: 'Press', part: 21 }, 'the_button', 700);
    f.push({ kind: 'Detonate', part: 20 }, 'bangstick', 800);
    expect(f.items.map((i) => i.label)).toEqual(['BOOM', 'PRESSED', 'FUSE LIT']);
    expect(f.push({ kind: 'Impact', part: 1 }, 'thud', 900)).toBeNull();
    expect(f.expire(10_000)).toBe(true);
    expect(f.items).toEqual([]);
  });
});
