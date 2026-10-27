// M5 stream U5: the pure parts of the M5 UI: Settings › Performance (physics threads), the world's Matter switch
// (format + docstore), the volume sizing maths, RIFT GATES / BUZZ pairing, GRABBER zone maths, BUZZ tagging rules,
// the Matter readout when Matter is off, and the M5 captions.

import { describe, expect, it } from 'vitest';
import { DocStore, tryApply, WorldDoc } from '@knockon/docstore';
import { decodeWorld, DEFAULT_SIM_FLAGS, EMPTY_WORLD, encodeWorld, LEGACY_SIM_FLAGS, opFromWire, opToWire, PartFlag, type PartRecord } from '@knockon/format';
import { propValues } from '@knockon/parts-data';
import { partDef } from '../src/catalog.ts';
import { autoJoltThreads, DEFAULT_SETTINGS, joltThreadsSetting } from '../src/ui/settings.ts';
import { resizeAxis, sizeAxes, snapSize } from '../src/ui/volumetool.ts';
import { autoPair, pairsOf, partnersOf, zoneFromLocal, zoneLocal, ZONE_PROPS } from '../src/ui/m5tools.ts';
import { BUZZ_MAX_KG, taggable } from '../src/ui/inspector.ts';
import { grainStatus } from '../src/ui/matter.ts';
import { captionFor, emoteText } from '../src/ui/captions.ts';
import { CRITTER_EMOTES } from '@knockon/parts-data';
import { BakeStore } from '../src/bakestore.ts';

const part = (id: number, type: string, props?: PartRecord['props'], flags = 0): PartRecord => ({ id, type, pos: [0, 0, 0], rot: { tag: 0 }, flags, ...(props ? { props } : {}) });

describe('Settings › Performance › Physics threads', () => {
  it('Auto is hardwareConcurrency − 3, clamped 2–12 (the sim worker default, D99)', () => {
    expect(autoJoltThreads(16)).toBe(12);
    expect(autoJoltThreads(24)).toBe(12);
    expect(autoJoltThreads(8)).toBe(5);
    expect(autoJoltThreads(4)).toBe(2);
    expect(autoJoltThreads(2)).toBe(2);
  });
  it('Auto sends nothing (the worker decides); a number is sent as is; 0 is single-threaded', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    expect(s.performance.joltThreads).toBe('auto');
    expect(joltThreadsSetting(s)).toBeUndefined();
    s.performance.joltThreads = 0;
    expect(joltThreadsSetting(s)).toBe(0);
    s.performance.joltThreads = 8;
    expect(joltThreadsSetting(s)).toBe(8);
  });
});

describe('the world’s Matter switch (env.matter over the header’s simFlags)', () => {
  it('overrides matterGameplay, undoes back to the header flag, and saves consistently', () => {
    const d = new WorldDoc();
    expect(d.simFlags.matterGameplay).toBe(true); // new worlds run Matter (MI)
    const r = tryApply(d, { k: 'EnvUpdate', patch: { matter: false } });
    expect(r.ok).toBe(true);
    expect(d.simFlags).toEqual({ ...DEFAULT_SIM_FLAGS, matterGameplay: false });
    // the inverse restores the header's flag; on the wire (msgpack) "never set" arrives as null
    if (!r.ok) throw new Error('rejected');
    tryApply(d, opFromWire(opToWire(r.inverse)));
    expect(opFromWire([10, { matter: null }])).toEqual({ k: 'EnvUpdate', patch: { matter: undefined } });
    expect(d.env.matter).toBeUndefined();
    expect(d.simFlags.matterGameplay).toBe(true);
    // a saved world with Matter switched off loads with it off, and with no grains in its header
    tryApply(d, { k: 'EnvUpdate', patch: { matter: false } });
    const back = WorldDoc.fromSnapshot(decodeWorld(encodeWorld(d.toSnapshot({ ...EMPTY_WORLD, counters: {} }))));
    expect(back.simFlags.matterGameplay).toBe(false);
    // and switching it back on there works too
    tryApply(back, { k: 'EnvUpdate', patch: { matter: true } });
    expect(back.simFlags.matterGameplay).toBe(true);
  });
  it('turns a pre-M4 (legacy, Matter off) world on', () => {
    const d = WorldDoc.fromSnapshot({ ...EMPTY_WORLD, simFlags: LEGACY_SIM_FLAGS });
    expect(d.simFlags.matterGameplay).toBe(false);
    tryApply(d, { k: 'EnvUpdate', patch: { matter: true } });
    expect(d.simFlags.matterGameplay).toBe(true);
  });
  it('DocStore.confirmed() sees the switch only once the server confirms it', () => {
    const s = new DocStore(1, WorldDoc.fromSnapshot(EMPTY_WORLD));
    s.applyLocal({ k: 'EnvUpdate', patch: { matter: false } });
    expect(s.doc.simFlags.matterGameplay).toBe(false);
    expect(s.confirmed().simFlags.matterGameplay).toBe(true);
  });
  it('the world card says "Matter off" instead of a grain budget', () => {
    expect(grainStatus(200_000, 16, 1, true)).toMatchObject({ text: 'Matter off', level: 'off' });
    expect(grainStatus(200_000, 16, 1)?.level).toBe('ok');
    expect(grainStatus(0, 16, 0, true)).toBeNull();
  });
});

describe('volume sizing handles', () => {
  const zone = partDef('zone')!;
  it('finds the sized axes from width / height / depth props', () => {
    expect(sizeAxes(zone)).toEqual([0, 1, 2]);
    const fw = partDef('force_wall');
    if (fw) expect(sizeAxes(fw)).toEqual([0, 1]); // FORCE WALL: width and height (A5)
    const sf = partDef('stasis_field');
    if (sf) expect(sizeAxes(sf)).toEqual([0, 1, 2]);
    expect(sizeAxes(partDef('thud'))).toEqual([]);
  });
  it('keeps the opposite face where it was', () => {
    const v = propValues(zone);
    // ZONE is centred in x: growing the +x face by 0.4 moves the part +0.2
    const r = resizeAxis(zone, v, 0, 1, v.width! + 0.4);
    expect(r.props.width).toBeCloseTo(v.width! + 0.4);
    expect(r.shift[0]).toBeCloseTo(0.2);
    // the −x face: the part moves the other way
    expect(resizeAxis(zone, v, 0, 0, v.width! + 0.4).shift[0]).toBeCloseTo(-0.2);
    // y is bottom-anchored: the top face changes the height only, the bottom face lifts the part
    expect(resizeAxis(zone, v, 1, 1, v.height! + 0.5).shift[1]).toBeCloseTo(0);
    expect(resizeAxis(zone, v, 1, 0, v.height! + 0.5).shift[1]).toBeCloseTo(-0.5);
  });
  it('snaps to the property step and clamps to its range', () => {
    const spec = zone.props.width!;
    expect(snapSize(spec, 1.234)).toBeCloseTo(1.2);
    expect(snapSize(spec, 99)).toBe(spec.max);
    expect(snapSize(spec, -3)).toBe(spec.min);
    expect(snapSize(spec, 1.234, true)).toBeCloseTo(1.234);
  });
});

describe('RIFT GATES and BUZZ pairing', () => {
  const rift = partDef('rift_gate');
  const pairAt = (type: string, c: number): PartRecord['props'] => { const d = partDef(type)!; const i = Object.keys(d.props).indexOf('pair'); return [[i, c]]; };
  it.runIf(!!rift)('pairs gates of a colour in part order and finds the lonely one', () => {
    const parts = [part(1, 'rift_gate', pairAt('rift_gate', 0)), part(2, 'rift_gate', pairAt('rift_gate', 1)), part(3, 'rift_gate', pairAt('rift_gate', 0)), part(4, 'rift_gate', pairAt('rift_gate', 0))];
    const { links, lonely } = pairsOf(parts);
    expect(links).toEqual([{ a: 1, b: 3, colour: 0, kind: 'rift' }]);
    expect([...lonely].sort()).toEqual([2, 4]);
    expect(partnersOf(3, links)).toEqual([1]);
    // a new gate joins a colour with an odd count, so it pairs at once
    expect(autoPair('rift_gate', parts)).toBe(0);
    expect(autoPair('rift_gate', [])).toBe(0);
    expect(autoPair('rift_gate', [part(1, 'rift_gate', pairAt('rift_gate', 0)), part(2, 'rift_gate', pairAt('rift_gate', 0))])).toBe(1);
  });
  it.runIf(!!partDef('buzz') && !!partDef('buzz_beacon'))('pairs each BUZZ with the first free beacon of its colour', () => {
    const parts = [part(1, 'buzz_beacon', pairAt('buzz_beacon', 5)), part(2, 'buzz', pairAt('buzz', 5)), part(3, 'buzz', pairAt('buzz', 5))];
    const { links, lonely } = pairsOf(parts);
    expect(links).toEqual([{ a: 2, b: 1, colour: 5, kind: 'buzz' }]);
    expect([...lonely]).toEqual([3]);
    // a new beacon takes a free colour; a new BUZZ the colour of a beacon without one
    expect(autoPair('buzz_beacon', parts)).not.toBe(5);
    expect(autoPair('buzz', [part(1, 'buzz_beacon', pairAt('buzz_beacon', 2))])).toBe(2);
    expect(autoPair('thud', parts)).toBeNull();
  });
});

describe('GRABBER zones', () => {
  const g = partDef('grabber');
  it.runIf(!!g)('turns a point in the part’s frame into yaw / reach / height and back', () => {
    const keys = ZONE_PROPS.grabber!.a;
    const z = zoneFromLocal(g!, keys, [0.2, 0.05, 0]); // straight out to its right (+X): yaw 90°
    expect(z[keys[0]]).toBe(90);
    expect(z[keys[1]]).toBeCloseTo(0.2);
    expect(z[keys[2]]).toBeCloseTo(0.05);
    const back = zoneLocal(z, keys);
    expect(back[0]).toBeCloseTo(0.2);
    expect(back[2]).toBeCloseTo(0);
    // out of reach is clamped to the arm; below the base to 0
    const far = zoneFromLocal(g!, keys, [0, -1, 2]);
    expect(far[keys[1]]).toBe(g!.props[keys[1]]!.max);
    expect(far[keys[2]]).toBe(0);
    expect(far[keys[0]]).toBe(0);
  });
});

describe('BUZZ tagging (D105)', () => {
  it('uses the format’s tag bit and only offers it on loose, non-critter parts', () => {
    expect(PartFlag.Tagged).toBe(1 << 9);
    expect(taggable(partDef('thud'))).toBe(true);
    expect(taggable(partDef('slope'))).toBe(false); // static
    expect(taggable(partDef('mochi'))).toBe(false); // critter
    expect(BUZZ_MAX_KG).toBe(2);
  });
});

describe('M5 captions (A5 parts, B5 BUZZ)', () => {
  const ev = (kind: string, mag = 0, part = 1) => ({ kind, part, mag, pos: [0, 0, 0] as const });
  it('words the M5 parts’ events', () => {
    expect(captionFor(ev('Teleport', 2), 'RIFT GATES', undefined, 'rift_gate', 'a THUD')?.text).toBe('[vwoom] a THUD warps through RIFT GATES');
    expect(captionFor(ev('Emerge', 2), 'RIFT GATES', undefined, 'rift_gate')).toBeNull();
    expect(captionFor(ev('Barrier', 1), 'FORCE WALL', undefined, 'force_wall')?.text).toBe('[hum] FORCE WALL switches on');
    expect(captionFor(ev('Barrier', 0), 'FORCE WALL', undefined, 'force_wall')?.text).toBe('[fzzt] FORCE WALL switches off');
    expect(captionFor(ev('Engage', 1), 'STASIS FIELD', undefined, 'stasis_field')?.text).toBe('[fwmm] STASIS FIELD freezes things');
    expect(captionFor(ev('Engage', 1), 'SINGULARITY', undefined, 'singularity')).toMatchObject({ text: '[VWOOOM] SINGULARITY opens', big: true });
    expect(captionFor(ev('Collapse', 12), 'SINGULARITY', undefined, 'singularity')).toMatchObject({ text: '[implosion] SINGULARITY collapses', big: true });
    expect(captionFor(ev('Despawn', 3), 'SINGULARITY', undefined, 'singularity', 'a PLANK')?.text).toBe('[slurp] SINGULARITY swallows a PLANK');
    expect(captionFor(ev('Despawn', 1), 'CORK BLASTER', undefined, 'cork_blaster')).toBeNull(); // M2's piece despawn stays quiet
    expect(captionFor(ev('Boost', 3), 'COILGUN RING', undefined, 'coilgun_ring', 'a BEARING')?.text).toBe('[zzang] COILGUN RING boosts a BEARING');
    expect(captionFor(ev('Boost', 0), 'COILGUN RING', undefined, 'coilgun_ring')).toBeNull();
    expect(captionFor(ev('Charged', 1), 'COILGUN RING', undefined, 'coilgun_ring')).toBeNull();
    expect(captionFor(ev('Call', 1), 'BUZZ BEACON', undefined, 'buzz_beacon')?.text).toBe('[beep-beep] BUZZ BEACON calls BUZZ');
    expect(captionFor(ev('Freeze', 0), 'STASIS FIELD', undefined, 'stasis_field', 'a BOING')?.text).toBe('[fwip] STASIS FIELD freezes a BOING');
    expect(captionFor(ev('Attach', 0), 'GRABBER', undefined, 'grabber', 'a STITCH')?.text).toBe('[clamp] GRABBER grabs a STITCH');
    expect(captionFor(ev('Release', 0), 'GRABBER', undefined, 'grabber', 'a STITCH')?.text).toBe('[clack] GRABBER puts a STITCH down');
    expect(captionFor(ev('Attach', 0), 'TRACTOR BEAM', undefined, 'tractor_beam', 'a FUZZ')?.text).toBe('[hmmm] TRACTOR BEAM catches a FUZZ');
    expect(captionFor(ev('Trigger', 1), 'GRABBER', undefined, 'grabber')?.text).toBe('[whirr] GRABBER reaches for zone A');
    expect(captionFor(ev('Trigger', 1), 'PADDLE', undefined, 'paddle')).toBeNull(); // M3 triggers stay quiet
    expect(captionFor(ev('Jam', 0), 'GRABBER', undefined, 'grabber')?.text).toBe('[whirr-clunk] GRABBER shrugs: nothing at zone A');
    expect(captionFor(ev('Jam', 0), 'COG', undefined, 'cog')?.text).toBe('[clunk] COG jams'); // M2 wording kept
  });
  it('gives BUZZ a voice and its emotes words', () => {
    expect(captionFor(ev('Fetch', 0.3), 'BUZZ', 'buzz', 'buzz', 'a THUD')?.text).toBe('[Buzz grabs a THUD]');
    expect(captionFor(ev('Deliver', 4), 'BUZZ', 'buzz', 'buzz', 'a THUD')).toMatchObject({ text: '[Buzz delivers a THUD]', big: true });
    const pkg = CRITTER_EMOTES.indexOf('package' as never);
    if (pkg > 0) {
      expect(captionFor(ev('Emote', pkg), 'BUZZ', 'buzz')?.text).toBe('[Buzz whirs off to fetch]');
      expect(emoteText('BUZZ', pkg)).toBe('Buzz: on its way!');
      expect(emoteText('BUZZ', CRITTER_EMOTES.indexOf('check' as never))).toBe('Buzz: delivered!');
    }
  });
});

describe('BakeStore carries BUZZ’s targets (U5 tag glyph)', () => {
  it('plays back the target pairs at the playhead, keyframe by keyframe', () => {
    const N = 3, KF = 4;
    const st = (g: number[]) => ({ f: new Uint8Array(N), m: new Uint8Array(N), l: new Float32Array(0), c: new Uint8Array(N * 4), k: new Int32Array(0), b: new Float32Array(0), mf: new Float32Array(0), mc: new Int32Array(0), g: Int32Array.from(g) });
    const s = new BakeStore(KF, { t: new Float32Array(N * 7), ...st([]) });
    const none = { idx: new Int32Array(0), xf: new Float32Array(0) };
    s.put(4, none, st([0, 2]));
    s.put(8, none, st([0, 2]));
    s.put(12, none, st([]));
    expect([...(s.frame(4).g ?? [])]).toEqual([0, 2]);
    expect([...(s.frame(9).g ?? [])]).toEqual([0, 2]);
    expect([...(s.frame(12).g ?? [])]).toEqual([]);
    expect([...(s.frame(0).g ?? [])]).toEqual([]);
  });
});
