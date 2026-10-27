// The vendor matrix's Node leg: the Sandstorm Matter scene on the CPU reference (packages/matter, split across worker
// threads by src/node/parallel.ts — bit-identical to the single-threaded reference). Writes per-tick results as JSON.
//   node --disable-warning=ExperimentalWarning tools/vendor-matrix/cpu.ts --ticks=120 --grains=4000000 --threads=20 --out=cpu.json

import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { checksumHex, type MatterStepOut } from '../../packages/matter/src/index.ts';
import { MatterCpuParallel } from '../../packages/matter/src/node/parallel.ts';
import { sandstorm } from '../../packages/matter/src/scenes.ts';

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ticks = Number(arg('ticks', '120'));
const grains = Number(arg('grains', '4000000'));
const threads = Number(arg('threads', String(Math.max(1, cpus().length - 4))));
const out = arg('out', 'cpu.json');

/** Same per-tick digest as the browser harness (storm mode). */
function impulseHash(o: MatterStepOut): string {
  let h = 0;
  for (const i of o.impulses) for (const v of [...i.lin, ...i.ang]) h = (Math.imul(h ^ v, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const sc = sandstorm({ grains });
const be = new MatterCpuParallel(threads);
await be.init({ capacity: sc.capacity, seed: sc.seed });
be.restoreSync(sc.init!);
const sums: string[] = [], impulse: string[] = [];
let counts: number[] = [];
const t0 = Date.now();
for (let t = 1; t <= ticks; t++) {
  const o = be.stepSync(sc.input(t));
  sums.push(checksumHex(o.checksum));
  impulse.push(impulseHash(o));
  counts = [...o.counts];
  if (t % 5 === 0 || t === ticks) {
    process.stderr.write(`cpu ${grains}: tick ${t}/${ticks} ${sums[t - 1]} ${((Date.now() - t0) / t / 1000).toFixed(2)} s/tick\n`);
    writeFileSync(out, JSON.stringify({ impl: 'cpu', threads, grains, ticks: t, sums, impulse, counts, secPerTick: (Date.now() - t0) / t / 1000 }));
  }
}
be.destroy();
process.exit(0);
