// W5 (M5): ORBITAL HANGAR and MOON BASE in the format: per-environment physics defaults, the environment switch,
// env.zones on the wire, and old saves unchanged.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENV, EMPTY_WORLD, decodeWorld, defaultEnvFor, encodeWorld, envPhysics, envSwitchPatch, envZonesOn, opFromWire, opToWire,
  WIND_PRESETS, windSpeedAt, type EnvSettings, type EnvWind, type Op,
} from '@knockon/format';

describe('environment physics defaults', () => {
  it('Hangar 38 % gravity; Moon 16.5 % and no air; everything else Earth', () => {
    expect(envPhysics('hangar')).toEqual({ gravity: 38, air: 100 });
    expect(envPhysics('moon')).toEqual({ gravity: 16.5, air: 0 });
    for (const e of ['studio', 'tinker', 'kitchen', 'backlot', 'unknown']) expect(envPhysics(e)).toEqual({ gravity: 100, air: 100 });
    expect(defaultEnvFor('room', 'moon')).toEqual({ preset: 'room', environment: 'moon', gravity: 16.5, air: 0, feel: 'real' });
    expect(defaultEnvFor('arena', 'hangar')).toMatchObject({ gravity: 38, air: 100 });
    // the preset defaults are as before (new worlds open in the Tinker Lab / Studio / Backlot, at Earth)
    expect(defaultEnvFor('room')).toEqual({ preset: 'room', environment: 'tinker', gravity: 100, air: 100, feel: 'real' });
    expect(DEFAULT_ENV).toEqual(defaultEnvFor('room'));
  });

  it('switching environment brings its defaults along unless the world has custom values', () => {
    const lab: EnvSettings = defaultEnvFor('room');
    expect(envSwitchPatch(lab, 'moon')).toEqual({ environment: 'moon', gravity: 16.5, air: 0 });
    const moon = { ...lab, ...envSwitchPatch(lab, 'moon') };
    expect(envSwitchPatch(moon, 'studio')).toEqual({ environment: 'studio', gravity: 100, air: 100 });
    expect(envSwitchPatch(moon, 'hangar')).toEqual({ environment: 'hangar', gravity: 38, air: 100 });
    expect(envSwitchPatch({ ...lab, gravity: 200 }, 'moon')).toEqual({ environment: 'moon', air: 0 }); // custom gravity kept
    expect(envSwitchPatch(lab, 'kitchen')).toEqual({ environment: 'kitchen' });
  });
});

describe('env.zones and gravity on the wire', () => {
  const rt = (op: Op): Op => opFromWire(JSON.parse(JSON.stringify(opToWire(op))) as unknown[]);
  it('EnvUpdate carries zones and half-percent gravity; an undo of "never set" (null) means on', () => {
    expect(rt({ k: 'EnvUpdate', patch: { zones: false } })).toEqual({ k: 'EnvUpdate', patch: { zones: false } });
    expect(rt({ k: 'EnvUpdate', patch: { gravity: 16.5, air: 0 } })).toEqual({ k: 'EnvUpdate', patch: { gravity: 16.5, air: 0 } });
    expect(opFromWire([10, { zones: null }])).toEqual({ k: 'EnvUpdate', patch: { zones: true } });
    expect(() => opFromWire([10, { gravity: 16.25 }])).toThrow();
    expect(() => opFromWire([10, { gravity: 300.5 }])).toThrow();
  });

  it('zones are on unless switched off, and only in an environment that has them', () => {
    expect(envZonesOn({ environment: 'hangar' })).toBe(true);
    expect(envZonesOn({ environment: 'hangar', zones: false })).toBe(false);
    expect(envZonesOn({ environment: 'moon' })).toBe(false);
    expect(envZonesOn({ environment: 'studio', zones: true })).toBe(false);
  });
});

describe('old saves', () => {
  it('a world saved before M5 loads unchanged (no zones key, Earth gravity), and the new fields round-trip', () => {
    const base = { ...EMPTY_WORLD, title: 'old' };
    const old = decodeWorld(encodeWorld({ ...base, env: { preset: 'room', environment: 'studio', gravity: 100, air: 100, feel: 'real' } }));
    expect(old.env).toEqual({ preset: 'room', environment: 'studio', gravity: 100, air: 100, feel: 'real' });
    expect('zones' in old.env).toBe(false);
    const hangar = decodeWorld(encodeWorld({ ...base, env: { ...defaultEnvFor('warehouse', 'hangar'), zones: false } }));
    expect(hangar.env).toEqual({ preset: 'warehouse', environment: 'hangar', gravity: 38, air: 100, feel: 'real', zones: false });
    const moon = decodeWorld(encodeWorld({ ...base, env: defaultEnvFor('room', 'moon') }));
    expect(moon.env.gravity).toBe(16.5);
    expect(moon.env.air).toBe(0);
  });
});

describe('env.wind (W5, D26)', () => {
  const rt = (op: Op): Op => opFromWire(JSON.parse(JSON.stringify(opToWire(op))) as unknown[]);
  it('EnvUpdate carries wind (0.1 m/s steps, 0–15, 0–359°, a gust profile); null clears it; bad values are refused', () => {
    expect(rt({ k: 'EnvUpdate', patch: { wind: { speed: 6, dir: 30, gusts: 'gusty' } } })).toEqual({ k: 'EnvUpdate', patch: { wind: { speed: 6, dir: 30, gusts: 'gusty' } } });
    expect(rt({ k: 'EnvUpdate', patch: { wind: { speed: 2.5, dir: 0 } } })).toEqual({ k: 'EnvUpdate', patch: { wind: { speed: 2.5, dir: 0, gusts: 'none' } } });
    expect(opFromWire([10, { wind: null }])).toEqual({ k: 'EnvUpdate', patch: { wind: undefined } });
    for (const bad of [{ speed: 16, dir: 0 }, { speed: 3, dir: 360 }, { speed: 3, dir: 0, gusts: 'storm' }, 5]) expect(() => opFromWire([10, { wind: bad }])).toThrow();
  });

  it('old saves have no wind; wind round-trips through a save', () => {
    const base = { ...EMPTY_WORLD, title: 'w' };
    expect('wind' in decodeWorld(encodeWorld({ ...base, env: defaultEnvFor('arena', 'backlot') })).env).toBe(false);
    const w = decodeWorld(encodeWorld({ ...base, env: { ...defaultEnvFor('arena', 'backlot'), wind: WIND_PRESETS.breezy } }));
    expect(w.env.wind).toEqual({ speed: 3, dir: 0, gusts: 'breezy' });
  });

  it('gusts are seeded and deterministic, stay in their band and 0–15 m/s', () => {
    const sample = (w: EnvWind, seed: number): number[] => Array.from({ length: 600 }, (_, i) => windSpeedAt(w, i * 0.1, seed));
    const g = sample(WIND_PRESETS.gusty, 42);
    expect(sample(WIND_PRESETS.gusty, 42)).toEqual(g);
    expect(sample(WIND_PRESETS.gusty, 43)).not.toEqual(g);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...g)).toBeLessThanOrEqual(10);
    expect(Math.max(...g) - Math.min(...g)).toBeGreaterThan(1);
    const b = sample(WIND_PRESETS.breezy, 1);
    expect(Math.min(...b)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...b)).toBeLessThanOrEqual(4);
    expect(sample({ speed: 14.5, dir: 0, gusts: 'gusty' }, 5).every((v) => v <= 15)).toBe(true);
    expect(windSpeedAt(WIND_PRESETS.calm, 3, 1)).toBe(0);
    expect(windSpeedAt(undefined, 3, 1)).toBe(0);
    expect(windSpeedAt({ speed: 4, dir: 90 }, 7, 1)).toBe(4);
  });
});

describe('env.baseLights (W5)', () => {
  it('rides EnvUpdate (null = off) and is absent from older saves', () => {
    expect(opFromWire(JSON.parse(JSON.stringify(opToWire({ k: 'EnvUpdate', patch: { baseLights: true } }))) as unknown[])).toEqual({ k: 'EnvUpdate', patch: { baseLights: true } });
    expect(opFromWire([10, { baseLights: null }])).toEqual({ k: 'EnvUpdate', patch: { baseLights: false } });
    expect('baseLights' in decodeWorld(encodeWorld({ ...EMPTY_WORLD, env: defaultEnvFor('room', 'moon') })).env).toBe(false);
  });
});
