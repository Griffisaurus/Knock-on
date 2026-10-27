// P5 design check (not part of the deliverable): run the spec headlessly in the real sim to tune hand-offs before
// building it through the UI. Usage: node sim.ts [seconds]
import { makeId, metresToPos, snappedEuler, type LinkRecord, type PartRecord } from '../../../packages/format/src/index.ts';
import { loadJolt } from '../../../packages/jolt/src/index.ts';
import { partDef, propSteps, LINK_FOR_CHANNEL } from '../../../packages/parts-data/src/index.ts';
import { Machine } from '../../../packages/sim/src/index.ts';
import { writeFileSync } from 'node:fs';
import { MatterCpu } from '../../../packages/matter/src/index.ts';
// @ts-ignore
const M = await import('./' + (process.env.SPEC ?? 'machine.mjs'));
const secs = Number(process.argv[2] ?? 75);
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const TRACE = process.argv[4] ? new RegExp(process.argv[4]) : null;
const SP = FILTER ? M.parts.filter((p: any) => FILTER.test(p.key)) : M.parts;
const keep = new Set(SP.map((p: any) => p.key));
const idOf = new Map<string, number>();
let n = 0;
const parts: PartRecord[] = SP.map((p: any) => {
  const def = partDef(p.type)!;
  const id = makeId(1, ++n); idOf.set(p.key, id);
  const list = Object.entries(p.props).map(([k, v]) => propSteps(def, k, v as number)).sort((a, b) => a[0] - b[0]);
  return { id, type: p.type, pos: p.pos.map(metresToPos), rot: snappedEuler(p.rot[0], p.rot[1], p.rot[2]), flags: p.flags, ...(list.length ? { props: list } : {}) };
});
const typeOf = new Map(M.parts.map((p: any) => [p.key, p.type]));
const links: LinkRecord[] = M.links.filter((l: any) => keep.has(l.from[0]) && keep.has(l.to[0])).map((l: any) => {
  const pi = (key: string, name: string) => { const d = partDef(typeOf.get(key) as string)!; const i = d.ports.findIndex((q) => q.name === name); if (i < 0) throw new Error(`no port ${name} on ${key}`); return i; };
  const ch = partDef(typeOf.get(l.from[0]) as string)!.ports[pi(l.from[0], l.from[1])]!.channel;
  return { id: makeId(1, ++n), kind: LINK_FOR_CHANNEL[ch], from: { part: idOf.get(l.from[0])!, port: pi(l.from[0], l.from[1]) }, to: { part: idOf.get(l.to[0])!, port: pi(l.to[0], l.to[1]) }, via: [], points: (l.via ?? []).map((q: number[]) => q.map(metresToPos)), length: 0 } as any;
});
for (const t of (FILTER ? M.tubes.filter((t: any) => FILTER.test(t.key)) : M.tubes)) links.push({ id: makeId(1, ++n), kind: t.slim ? 'tube_slim' : 'tube', from: null, to: null, via: [], points: t.pts.map((q: number[]) => q.map(metresToPos)), length: 0 } as any);
if (process.env.TRIG) for (const tg of process.env.TRIG.split(',')) { // test-only: a RINGER at t s into key.port
  const [kp, ts] = tg.split('@'); const [key, port] = kp.split(':');
  const def = partDef('ringer')!; const id = makeId(1, ++n);
  const tp = parts.find((q) => q.id === idOf.get(key))!;
  parts.push({ id, type: 'ringer', pos: [tp.pos[0] + 64 * 3, 0, tp.pos[2]], rot: snappedEuler(0, 0, 0), flags: 0, props: [propSteps(def, 'time', Number(ts))] } as any);
  const pi = partDef(tp.type)!.ports.findIndex((q) => q.name === port);
  links.push({ id: makeId(1, ++n), kind: 'cable_signal', from: { part: id, port: 0 }, to: { part: tp.id, port: pi }, via: [], points: [], length: 0 } as any);
}
console.log(`${parts.length} parts, ${links.length} links, ${M.types.length} types`);
if (process.env.BALLPOS) { const [bx, by, bz] = process.env.BALLPOS.split(',').map(Number); const bb = parts.find((q) => q.id === idOf.get(process.env.BALLKEY ?? 'bo'))!; (bb as any).pos = [metresToPos(bx!), metresToPos(by!), metresToPos(bz!)]; }
const J = await loadJolt('single');
const m = new Machine(J, { parts, links }, { preset: process.env.PRESET ?? 'arena', ...(process.env.MATTER ? { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 65536 } } : {}) } as any);
// POKE="key@seconds[,key@seconds]": press a THE BUTTON or a Ctrl+click shove (impulse) at that time, as the friend would
if (process.env.POKE) { let seq = 1; for (const tok of process.env.POKE.split(',')) { const [k, t] = tok.split('@'); const id = idOf.get(k.trim()); if (!id) throw new Error('poke: no ' + k); m.addPoke({ tick: Math.round(Number(t) * 120), seq: seq++, partId: id, kind: 'impulse', data: [0, -1, 0] } as any); } }
const keyOf = new Map([...idOf].map(([k, v]) => [v, k]));
const info = m.bodyInfo();
const base = info.map((b, i) => ({ i, part: b.part, role: b.role }));
const t0 = m.transforms(new Float32Array(info.length * 7));
const start = new Map<number, number[]>(); for (const b of base) if (b.role === 'base' && !start.has(b.part)) start.set(b.part, [t0[b.i * 7]!, t0[b.i * 7 + 1]!, t0[b.i * 7 + 2]!]);
const moved = new Map<number, number>();
const firstMove = new Map<number, number>();
const armQ0 = new Map<number, number[]>(); base.forEach((b) => { if (b.role === 'arm') armQ0.set(b.i, [t0[b.i*7+3]!, t0[b.i*7+4]!, t0[b.i*7+5]!, t0[b.i*7+6]!]); });
const armRot = new Map<number, number>();
const evs: any[] = [];
const T = secs * 120;
const tt = Date.now();
for (let t = 0; t < T; t++) {
  m.step();
  for (const x of m.drainEvents() as any[]) evs.push(x);
  if (t % 30 === 0) {
    const tr = m.transforms(new Float32Array(m.bodyInfo().length * 7));
    const bi = m.bodyInfo();
    if (process.env.POS && t % 60 === 0) { const re = new RegExp(process.env.POS); bi.forEach((b, i) => { const k = keyOf.get(b.part) ?? ''; if (re.test(k)) console.log(`    t${(t / 120).toFixed(1)} ${k} ${b.role} ${[0, 1, 2].map((j) => tr[i * 7 + j]!.toFixed(2)).join(',')} q ${[3, 4, 5, 6].map((j) => tr[i * 7 + j]!.toFixed(2)).join(',')}`); }); }
    bi.forEach((b, i) => { if (b.role === 'arm' && armQ0.has(i)) { const q = armQ0.get(i)!; const d = Math.abs(q[0]*tr[i*7+3]! + q[1]*tr[i*7+4]! + q[2]*tr[i*7+5]! + q[3]*tr[i*7+6]!); armRot.set(b.part, Math.max(armRot.get(b.part) ?? 0, 2 * Math.acos(Math.min(1, d)) * 57.3)); }
      if (b.role !== 'base') return; const s = start.get(b.part); if (!s) return; const d = Math.hypot(tr[i * 7]! - s[0]!, tr[i * 7 + 1]! - s[1]!, tr[i * 7 + 2]! - s[2]!); moved.set(b.part, Math.max(moved.get(b.part) ?? 0, d)); if (d > 0.03 && !firstMove.has(b.part)) firstMove.set(b.part, t / 120); });
  }
}
console.log(`sim ${secs}s in ${((Date.now() - tt) / 1000).toFixed(1)}s, ${evs.length} events`);
const byPart = new Map<number, Map<string, number>>();
for (const e of evs) { const k = byPart.get(e.part) ?? new Map(); if (!k.has(e.kind)) k.set(e.kind, e.tick); byPart.set(e.part, k); }
const rows: string[] = [];
const perType = new Map<string, string[]>();
for (const p of M.parts) {
  const id = idOf.get(p.key)!;
  const ev = byPart.get(id);
  const mv = moved.get(id) ?? 0;
  const ar = armRot.get(id) ?? 0;
  const acted = (ev && ev.size) || mv > 0.03 || ar > 10;
  const s = `${acted ? '●' : '✕'} ${p.key.padEnd(26)} ${p.type.padEnd(16)} moved ${mv.toFixed(2).padStart(6)}${firstMove.has(id) ? '@' + firstMove.get(id)!.toFixed(1) : ''}${ar > 1 ? ` arm ${ar.toFixed(0)}°` : ''} ${ev ? [...ev].map(([k, t]) => `${k}@${(t / 120).toFixed(1)}`).join(' ') : ''}`;
  rows.push(s);
  const l = perType.get(p.type) ?? []; if (acted) l.push(p.key); perType.set(p.type, l);
}
writeFileSync(new URL(FILTER ? './sim_part.txt' : './sim_out.txt', import.meta.url), rows.join('\n'));
if (FILTER) console.log(rows.join('\n'));
if (TRACE) for (const e of evs) { const k = keyOf.get(e.part) ?? '?'; if (TRACE.test(k)) console.log(`  ${(e.tick / 120).toFixed(2)} ${k} ${e.kind} mag ${(+e.mag).toFixed(2)}${e.other !== undefined ? ' other ' + (keyOf.get(e.other) ?? e.other) : ''} @${e.pos.map((v: number) => v.toFixed(2)).join(',')}`); }
const dead = [...perType].filter(([, l]) => !l.length).map(([t]) => t);
console.log(`types acting: ${M.types.length - dead.length}/${M.types.length}; never acted: ${dead.join(', ')}`);
// key hand-offs
const first = (key: string, kind: string) => { const v = byPart.get(idOf.get(key)!)?.get(kind); return v === undefined ? '—' : (v / 120).toFixed(2); };
for (const [k, kind] of [['s1.spine.pad', 'Press'], ['s1.spine.pad', 'Signal'], ['s2.bus', 'Signal'], ['s2.lift.lift2', 'Arrive'], ['s3.split.tripwire5', 'Trip'], ['s4.pingRx', 'PingRx'], ['s4.bus', 'Signal'], ['s4.toS5', 'Signal'], ['s5.bonk.the_button4', 'Press'], ['s5.bonk.the_button4', 'Signal'], ['s6.bus', 'Signal'], ['s6.hourglass', 'Empty'], ['s7.bus', 'Signal'], ['s8.bus', 'Signal'], ['s8.recycler', 'Goal'], ['s8.finale', 'Signal'], ['s8.plunger', 'Press'], ['s8.plunger', 'Signal'], ['s8.keg1', 'Detonate'], ['s8.singularity', 'Engage']]) console.log(`${k} ${kind}: ${first(k, kind)}`);
m.destroy();
process.exit(0);
