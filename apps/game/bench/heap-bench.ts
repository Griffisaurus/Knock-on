// J5 (M5): Jolt heap calibration (joltHeapMB, parts-data presets.ts). For a scene: what the Machine's build takes (its
// Jolt capacities: bodies, body pairs, contact buffers and the temp allocator), and what one in-heap rollback checkpoint
// takes once the scene has run `ticks` (the state of every body plus the contact cache of the awake ones), measured as the
// heap in use (JoltInterface sGetTotalMemory − sGetFreeMemory) around each call, and the high-water mark (jolt
// joltHeapHighWater) for the transients. Same Jolt build and Machine as the sim worker.
//
//   node --disable-warning=ExperimentalWarning apps/game/bench/heap-bench.ts pile <count> <ticks> [--threads=N]
//   node … heap-bench.ts domino <count> <lanes> <ticks> [--threads=N]     (unbroken lanes: the wave keeps them awake)
//   node … heap-bench.ts big <count> <ticks> [preset]                       (bigWorld: 99 % asleep)

import { joltHeapHighWater, loadJolt } from '@knockon/jolt';
import { Machine, contactEstimate } from '@knockon/sim';
import { checkpointPlan, joltCapacity, joltHeapMB } from '@knockon/parts-data';
import { awakePile, bigWorld, dominoDay } from './scenes.ts';
import type { WorldSnapshot } from '@knockon/format';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const threadArg = process.argv.find((a) => a.startsWith('--threads='));
const threads = threadArg ? Number(threadArg.slice(10)) : undefined;
const which = args[0] ?? 'pile';
let world: WorldSnapshot, ticks: number;
if (which === 'pile') { world = awakePile(Number(args[1] ?? 10_000), 8, 'arena'); ticks = Number(args[2] ?? 240); }
else if (which === 'domino') { world = dominoDay(Number(args[1] ?? 20_000), Number(args[2] ?? 64), 1.5, 1e9); ticks = Number(args[3] ?? 600); }
else { world = bigWorld(Number(args[1] ?? 100_000), (args[3] ?? 'megastructure') as 'megastructure'); ticks = Number(args[2] ?? 60); }

const n = world.parts.length;
const contacts = contactEstimate(world.parts);
const cap = joltCapacity(n, n * 2 + 64, contacts);
const J = await loadJolt(threads !== undefined ? 'multi' : 'single', { heapMB: 4000, ...(threads !== undefined ? { threads } : {}) });
const used = (): number => (J.JoltInterface.prototype.sGetTotalMemory() >>> 0) - (J.JoltInterface.prototype.sGetFreeMemory() >>> 0);
const MB = (b: number): number => +(b / 1048576).toFixed(1);
const u0 = used(), hw0 = joltHeapHighWater(J);
const m = new Machine(J, { parts: world.parts, links: world.links }, {
  preset: world.env.preset, environment: world.env.environment, seed: [...world.seed] as [number, number], checkpointEvery: 0, keepCheckpoints: 1000,
});
const build = used() - u0;
for (let t = 0; t < ticks; t++) m.step();
const awake = m.awakeBodies();
const afterRun = used() - u0;
const cps: number[] = [];
for (let k = 0; k < 4; k++) { const a = used(); m.checkpoint(); cps.push(used() - a); }
const hwCp = joltHeapHighWater(J);
// the raw SaveState bytes (what a StateRecorderImpl holds, before its buffer's growth slack)
const raw = (m as unknown as { saveJolt(): Uint8Array }).saveJolt().length;
const a = used();
const exp = m.exportCheckpoint(m.tick);
const hwExp = joltHeapHighWater(J);
const cp = Math.max(...cps);
console.log(JSON.stringify({
  scene: which, parts: n, bodies: m.bodies.length, ticks, awake, threads: threads ?? 0, contacts, maxContacts: cap.maxContacts, maxBodyPairs: cap.maxBodyPairs, tempMB: MB(cap.tempBytes),
  baseMB: MB(u0), baseHighWaterMB: MB(hw0), buildMB: MB(build), runGrowthMB: MB(afterRun - build),
  checkpointMB: cps.map(MB), checkpointBytesPerBody: Math.round(cp / m.bodies.length), rawStateMB: MB(raw), rawBytesPerBody: Math.round(raw / m.bodies.length), slack: +(cp / raw).toFixed(2),
  highWaterAfter4CpMB: MB(hwCp), exportBlobMB: exp ? MB(exp.blob.length) : 0, exportHeapDeltaMB: MB(used() - a), highWaterAfterExportMB: MB(hwExp),
  plan: checkpointPlan(n), heapMB: joltHeapMB(n, contacts),
}));
process.exit(0);
