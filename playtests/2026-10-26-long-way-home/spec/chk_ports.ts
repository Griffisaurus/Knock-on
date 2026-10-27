import { partDef } from '../../../packages/parts-data/src/index.ts';
// @ts-ignore
const M = await import('./' + (process.argv[2] ?? 'lwh2.mjs'));
const type = new Map(M.parts.map((p: any) => [p.key, p.type]));
const use = new Map<string, number>();
for (const l of M.links) for (const e of [l.from, l.to]) { const k = `${e[0]}.${e[1]}`; use.set(k, (use.get(k) ?? 0) + 1); }
let bad = 0;
for (const [k, n] of use) { const [key, port] = k.split('.'); const d = partDef(type.get(key) as string)!; const pt = d.ports.find((q: any) => q.name === port)!; const max = (pt as any).maxLinks ?? 1; if (n > max) { console.log(`OVER ${k} (${d.name} ${pt.channel} ${pt.dir}): ${n} > ${max}`); bad++; } }
console.log(bad ? `${bad} over-limit ports` : 'all ports within their link limits');
