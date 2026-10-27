// Determinism lint (ENGINEERING §4.1). Scans sim-side packages for APIs that differ between
// browsers/CPUs or depend on wall-clock time. Exits non-zero on any finding.
//   node tools/lint/determinism.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCOPES = ['packages/sim/src', 'packages/docstore/src', 'packages/format/src', 'packages/net/src', 'packages/detmath/src', 'packages/matter/src', 'packages/parts-data/src'];

const RULES = [
  { id: 'no-nondeterministic-globals', re: /\bMath\.random\s*\(|\bDate\.now\s*\(|\bnew Date\s*\(|\bperformance\.now\s*\(|crypto\.getRandomValues/ },
  { id: 'no-platform-transcendentals', re: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|sinh|cosh|tanh)\s*\(/ },
  { id: 'no-unordered-iteration', re: /\bfor\s*\(\s*(const|let|var)\s+\w+\s+in\s+/ },
  { id: 'no-float-format-in-hash', re: /\.(toFixed|toPrecision)\s*\(/ },
  { id: 'no-timers', re: /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/ },
];

// Files allowed to touch a rule (with a reason): detmath implements the replacements;
// net's clock sync measures real time by design (it never feeds the sim).
const ALLOW = {
  'packages/detmath/src/trig.ts': ['no-platform-transcendentals'],
  'packages/net/src/clock.ts': ['no-nondeterministic-globals'],
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

let findings = 0;
for (const scope of SCOPES) {
  const dir = join(root, scope);
  try { statSync(dir); } catch { continue; }
  for (const file of walk(dir)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const rule of RULES) {
        if ((ALLOW[rel] ?? []).includes(rule.id)) continue;
        if (rule.re.test(code)) {
          findings++;
          console.log(`${rel}:${i + 1}  ${rule.id}  ${line.trim()}`);
        }
      }
    });
  }
}
if (findings) {
  console.log(`\n${findings} determinism finding(s). See docs/ENGINEERING.md §4.1.`);
  process.exit(1);
}
console.log('determinism lint: clean');
