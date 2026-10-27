import { describe, expect, it } from 'vitest';
import initJolt from 'jolt-physics/wasm';
import { DEFAULT_SCENARIO, runScenario } from '../src/index.ts';

describe('Jolt determinism spike (Node, single-threaded WASM)', () => {
  it('fresh worlds built in canonical order give bit-identical results', async () => {
    const JoltA = await initJolt();
    const a = runScenario(JoltA, DEFAULT_SCENARIO);
    const b = runScenario(JoltA, DEFAULT_SCENARIO);
    const JoltB = await initJolt(); // a second module instance
    const c = runScenario(JoltB, DEFAULT_SCENARIO);
    expect(a.bodies).toBe(400);
    expect(b.hashes).toEqual(a.hashes);
    expect(c.hashes).toEqual(a.hashes);
    // Pin the golden: browsers (single- and multi-threaded) must reproduce this exact value.
    expect(a.final).toMatchInlineSnapshot(`"d36267ef85945df9"`);
    console.log(`[spike] 400 bodies × 600 ticks in ${a.ms.toFixed(0)} ms; final ${a.final}`);
  }, 60_000);

  it('save → restore → re-simulate reproduces the same future (rollback)', async () => {
    const Jolt = await initJolt();
    const r = runScenario(Jolt, { ...DEFAULT_SCENARIO, rollbackAt: 300 });
    expect(r.rollbackMatches).toBe(true);
  }, 60_000);
});
