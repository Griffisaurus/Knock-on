// Repro (S3, M3): late-poke rollback on a big brick stack is not exact for some scenes.
// A stack of N BRIKs (3 layers on a 30 × 30 grid), a shoved part at (-1, y, 1), an impulse at tick `poke`.
// "straight" applies the poke on time; "late" learns of it at tick 260, restores and resimulates to 300.
// Measured (M3): N = 1990 matches; N = 2100 with a BRIK shoved at y 0.05 does not, even with the in-heap
// checkpoints, the settings reuse, the scaled capacities and the INERT fast paths disabled — so it predates S3.
// The same 2100 stack with a THUD at y 0.11 (packages/sim/test/terrain.test.ts) matches.
// Run: pnpm --filter @knockon/game exec tsx bench/repro-rollback.ts [N=2100] [poke=70] [type=brik] [y=0.05]
import { loadJolt } from '@knockon/jolt';
import { Machine } from '@knockon/sim';
import { makeId, metresToPos, type PartRecord } from '@knockon/format';

const N = Number(process.argv[2] ?? 2100);
const pokeAt = Number(process.argv[3] ?? 70);
const type = process.argv[4] ?? 'brik';
const y = Number(process.argv[5] ?? 0.05);
const J = await loadJolt('single', { heapMB: 512 });
const parts: PartRecord[] = [];
for (let i = 0; i < N; i++) parts.push({ id: makeId(1, i + 1), type: 'brik', pos: [metresToPos((i % 30) * 0.2), metresToPos(0.05 + Math.floor(i / 900) * 0.1), metresToPos(Math.floor((i % 900) / 30) * 0.1)], rot: { tag: 0 }, flags: 0 });
parts.push({ id: makeId(1, 5000), type, pos: [metresToPos(-1), metresToPos(y), metresToPos(1)], rot: { tag: 0 }, flags: 0 });
const poke = { tick: pokeAt, seq: 1, partId: makeId(1, 5000), kind: 'impulse' as const, data: [40, 6, -20] };
const straight = new Machine(J, { parts }, { preset: 'warehouse' });
straight.addPoke(poke);
for (let i = 0; i < 300; i++) straight.step();
const late = new Machine(J, { parts }, { preset: 'warehouse' });
for (let i = 0; i < 260; i++) late.step();
late.addPoke(poke);
const back = late.restore(poke.tick);
while (late.tick < 300) late.step();
console.log(JSON.stringify({ N, poke: pokeAt, type, y, restoredTo: back, matches: late.hash() === straight.hash() }));
process.exit(0);
