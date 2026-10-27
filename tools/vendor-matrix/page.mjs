// Run one harness page in headless Chrome and print its report rows.
//   node tools/vendor-matrix/page.mjs "http://localhost:5201/?mode=proof" [--use-webgpu-adapter=d3d11]
import { runPage } from './cdp.mjs';

const args = process.argv.slice(2);
const shotArg = args.find((a) => a.startsWith('--shot='));
const [url = 'http://localhost:5201/?mode=proof', ...flags] = args.filter((a) => !a.startsWith('--shot='));
let lastProgress = '';
const { value, console: logs } = await runPage({
  url, flags, ...(shotArg ? { screenshot: shotArg.slice(7) } : {}),
  onPoll: (v) => { const p = v?.rows?.length ?? 0; const s = `${p} rows${v?.progress ? `, tick ${v.progress}` : ''}`; if (s !== lastProgress) { lastProgress = s; process.stderr.write(`  … ${s}\n`); } },
});
for (const r of value.rows) console.log(`${r.ok === null ? '○' : r.ok ? '●' : '✕'} ${r.label}: ${r.detail}`);
if (value.result) console.log('result:', JSON.stringify(value.result).slice(0, 2000));
if (value.error) console.log('error:', value.error);
const errs = logs.filter((l) => /error|exception/i.test(l));
if (errs.length) console.log('console:', errs.slice(0, 10).join('\n'));
console.log(value.ok ? 'PASS' : 'FAIL');
process.exit(value.ok ? 0 : 1);
