// Audio test page: live buttons for listening, plus offline renders that measure peak/RMS so levels can be
// verified without ears (no clipping, nothing silent, chains stay under the ceiling).

import { GameAudio, type LimiterStats, type SimEventLike } from './audio/index';
import { ambienceRecipes } from './audio/ambience';
import { critterRecipes } from './audio/critters';
import { truePeak } from './audio/limiter';
import { m3Recipes } from './audio/m3';
import { mechRecipes } from './audio/mech';
import { pyroRecipes } from './audio/pyro';
import { Rng } from './audio/rng';
import * as partsData from '@knockon/parts-data';
import { M4_TEST_TYPES, liveM4, offlineM4 } from './audio/testm4';
import { M5_TEST_TYPES, clipChecks, liveM5, offlineM5 } from './audio/testm5';
import { offlineBeta } from './audio/testbeta'; // AUDIO (beta polish, D127)

type Vec = [number, number, number];
const TYPES: Record<number, string> = {
  1: 'thud', 2: 'boing', 3: 'brik', 4: 'plank', 5: 'bangstick', 6: 'wick', 7: 'helio', 8: 'the_button', 9: 'stomp_pad',
  10: 'motor', 11: 'topple_tile', 12: 'cog', 13: 'pane', 14: 'gale', 15: 'snipper', 16: 'mains',
  // M2
  20: 'lamp', 21: 'torch', 22: 'suncell', 23: 'burning_glass', 24: 'toggle', 25: 'ringer', 26: 'delay', 27: 'flap', 28: 'skyrocket',
  29: 'big_top', 30: 'cork_blaster', 31: 'punchline', 32: 'gotcha_box', 33: 'sprong', 34: 'puffer', 35: 't_plunger', 36: 'fishbowl',
  37: 'trap_box', 38: 'scoop', 39: 'dynamo', 40: 'turbine', 41: 'hamster_drive', 42: 'pedal_rig', 43: 'cell', 44: 'vortex',
  50: 'mochi', 51: 'pip', 52: 'goby', 53: 'bandit',
  // M3
  60: 'lance', 61: 'mirror_splitter', 62: 'tripwire', 63: 'ping', 64: 'ping', 65: 'maglock', 66: 'marble', 67: 'bearing', 68: 'spindeck', 69: 'lift',
  70: 'rack', 71: 'ram', 72: 'powder_keg', 73: 'jitterjuice', 74: 'skyshow', 75: 'flamer', 76: 'popper', 77: 'snaptrap', 78: 'bonker', 79: 'flinger',
  80: 'wrecker', 81: 'pinger', 82: 'paddle', 83: 'bumper', 84: 'pin', 85: 'stacker', 86: 'vase', 87: 'tonebars', 88: 'ding', 89: 'fabricator',
  90: 'recycler', 91: 'zone', 92: 'slope', 93: 'tonebars', 94: 'ledge',
  // M4 (audio/testm4.ts)
  ...M4_TEST_TYPES,
  // M5 (audio/testm5.ts)
  ...M5_TEST_TYPES,
};
const partType = (id: number): string | undefined => TYPES[id] ?? (id >= 2000 ? 'powder_keg' : id >= 1000 ? 'bangstick' : id >= 500 ? 'topple_tile' : id >= 400 ? 'stacker' : id >= 300 ? 'pin' : id >= 200 ? 'brik' : undefined);
const ev = (t: number, kind: string, part: number, pos: Vec, mag = 0, other?: number): SimEventLike => ({ tick: Math.round(t * 120), kind, part, pos, mag, ...(other !== undefined ? { other } : {}) });

// ---------------- live ----------------

const live = document.getElementById('live')!;
const ga = new GameAudio();
let liveT = 0;
const btn = (label: string, fn: () => void, parent: HTMLElement = live): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = async () => { await ga.unlock(); fn(); };
  parent.appendChild(b);
};
const row = (title: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = `<b>${title}</b> `; live.appendChild(d); return d; };
const now = (): number => (liveT += 0.02);
setInterval(() => ga.frame(1 / 30), 33);
ga.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] });

const r1 = row('UI');
for (const n of ['place', 'remove', 'rotate', 'wire', 'unwire', 'select', 'countdown', 'go', 'stop', 'error', 'chat', 'undo']) btn(n, () => ga.ui(n), r1);
const r2 = row('Events');
const evs: [string, string, number, number][] = [
  ['impact thud', 'Impact', 1, 20], ['impact boing', 'Impact', 2, 3], ['impact brik', 'Impact', 3, 8], ['impact plank', 'Impact', 4, 2],
  ['impact cog', 'Impact', 12, 4], ['impact pane', 'Impact', 13, 1], ['impact tile', 'Impact', 11, 0.3], ['impact stick', 'Impact', 5, 1],
  ['signal', 'Signal', 8, 0], ['powered', 'Powered', 10, 0], ['unpowered', 'Unpowered', 10, 0], ['ignite stick', 'Ignite', 5, 0],
  ['ignite wick', 'Ignite', 6, 0], ['extinguish', 'Extinguish', 6, 0], ['fuse lit', 'FuseLit', 5, 0], ['fuse end', 'FuseEnd', 5, 0],
  ['pop', 'Pop', 7, 0], ['cut', 'Cut', 99, 0], ['press button', 'Press', 8, 0], ['press pad', 'Press', 9, 0], ['detonate', 'Detonate', 5, 1],
];
for (const [label, kind, part, mag] of evs) btn(label, () => ga.onSimEvents([ev(now(), kind, part, [(Math.random() - 0.5) * 2, 0.2, 0], mag)], partType), r2);
btn('chain ×50', () => {
  const t0 = now();
  for (let i = 0; i < 50; i++) setTimeout(() => ga.onSimEvents([ev(t0 + i * 0.02, 'Detonate', 1000 + i, [-3 + i * 0.12, 0.1, -1], 1)], partType), i * 20);
}, r2);
btn('domino run', () => {
  for (let i = 0; i < 60; i++) setTimeout(() => ga.onSimEvents([ev(now(), 'Impact', 500 + i, [-2 + i * 0.07, 0.05, 0], 0.4)], partType), i * 12);
}, r2);
const r3 = row('Loops (3 s)');
for (const k of ['fuse', 'motor', 'fan', 'flame', 'roll'] as const) btn(k, () => {
  const t0 = performance.now();
  const h = setInterval(() => {
    const e = (performance.now() - t0) / 3000;
    if (e > 1) return clearInterval(h);
    ga.loop(`test-${k}`, k, [Math.sin(e * 6) * 1.5, 0.2, 0], k === 'roll' ? e * 1.2 : 0.4 + 0.6 * e, 'thud');
  }, 16);
}, r3);
const r4 = row('Mode / mix');
for (const m of ['build', 'countdown', 'running'] as const) btn(m, () => ga.setMode(m), r4);
btn('heat +', () => { for (let i = 0; i < 3; i++) ga.onSimEvents([ev(now(), 'Detonate', 1000 + i, [0, 0, -2], 1)], partType); }, r4);
btn('mute', () => ga.setVolumes({ muted: true }), r4);
btn('unmute', () => ga.setVolumes({ muted: false }), r4);
btn('HRTF', () => ga.setPanning('HRTF'), r4);

// ---------------- live: M2 (mechanisms, critters, ambience) ----------------

/** Clip / emote tables matching the critter briefs, until parts-data exports CRITTER_CLIPS / CRITTER_EMOTES (stream B). */
const PD = partsData as unknown as Record<string, readonly string[] | undefined>;
const CLIPS: readonly string[] = PD['CRITTER_CLIPS'] ?? ['idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy', 'trapped', 'celebrate', 'sleep', 'sniff',
  'emote_happy', 'emote_angry', 'emote_confused', 'pounce', 'arch_scared', 'stalk', 'wheel_run', 'wheel_sprint', 'pedal', 'flop', 'steal_grab',
  'loot_admire', 'bubble_rescue', 'swim', 'steal_carry'];
const EMOTES: readonly string[] = PD['CRITTER_EMOTES'] ?? ['none', '!', '?', 'zzz', 'stars', 'heart', 'angry', 'sweat'];
const clip = (n: string): number => CLIPS.indexOf(n);
ga.setCritterNames(CLIPS, EMOTES);
const rotY = (a: number): [number, number, number, number] => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

const M2_EVENTS: [string, string, number, number][] = [
  ['lamp on', 'Lit', 20, 0], ['lamp off', 'Unlit', 20, 0], ['torch on', 'Lit', 21, 0], ['torch off', 'Unlit', 21, 0], ['suncell lit', 'Lit', 22, 0],
  ['glass focus', 'Lit', 23, 0], ['toggle on', 'Toggle', 24, 1], ['toggle off', 'Toggle', 24, 0], ['flap open', 'Toggle', 27, 1], ['flap close', 'Toggle', 27, 0],
  ['ringer RING', 'Ring', 25, 0], ['delay fire', 'Signal', 26, 0], ['skyrocket', 'Launch', 28, 12], ['big top', 'Launch', 29, 8], ['cork blaster', 'Launch', 30, 6],
  ['punchline', 'Launch', 31, 6], ['gotcha pop', 'Launch', 32, 0], ['sprong hit', 'Impact', 33, 4], ['puffer', 'Press', 34, 2], ['puffer strong', 'Press', 34, 8],
  ['t-plunger', 'Press', 35, 0], ['fishbowl smash', 'Break', 36, 0], ['splash', 'Splash', 36, 2], ['trap slam', 'Impact', 37, 8], ['scoop fill', 'Despawn', 38, 0],
  ['pane break', 'Break', 13, 0], ['plank break', 'Break', 4, 0], ['note C5', 'Note', 32, 0], ['note G6', 'Note', 32, 91], ['jam', 'Jam', 10, 0], ['brownout', 'Brownout', 16, 0],
];
const r5 = row('M2 events');
for (const [label, kind, part, mag] of M2_EVENTS) btn(label, () => ga.onSimEvents([ev(now(), kind, part, [(Math.random() - 0.5) * 2, 0.3, 0], mag)], partType), r5);
btn('Note scale', () => { for (let k = 0; k < 8; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Note', 32, [0, 0.3, 0], k)], partType), k * 250); }, r5);

/** Drive ga.part()/roller() for `sec` seconds as if a run were playing (mode 'running'). */
let simTick = 0;
function simulate(sec: number, fn: (e: number, dt: number) => void): void {
  ga.setMode('running');
  const t0 = performance.now();
  let last = t0;
  const h = setInterval(() => {
    const t = performance.now(), e = (t - t0) / 1000 / sec, dt = (t - last) / 1000;
    last = t;
    if (e > 1) { clearInterval(h); return; }
    simTick += dt * 120;
    ga.setPlayback(false, 1, simTick);
    fn(e, dt);
  }, 16);
}
const r6 = row('M2 loops (simulated run)');
const spinLoop = (label: string, id: number, type: string, wMax: number): void => {
  let a = 0;
  btn(label, () => simulate(4, (e, dt) => { a += wMax * Math.min(1, e * 1.5) * dt; ga.part(id, type, [Math.sin(e * 4), 0.3, 0], 0, 0, rotY(a)); }), r6);
};
spinLoop('dynamo ω↑', 39, 'dynamo', 20); spinLoop('turbine ω↑', 40, 'turbine', 15); spinLoop('hamster wheel', 41, 'hamster_drive', 5); spinLoop('pedal rig chain', 42, 'pedal_rig', 19);
const flagLoop = (label: string, id: number, type: string, flags: number, sec = 3, meter: (e: number) => number = () => 0): void => {
  btn(label, () => simulate(sec, (e) => ga.part(id, type, [0.5, 0.3, 0], e < 0.92 ? flags : 0, meter(e), null)), r6);
};
flagLoop('lamp', 20, 'lamp', 1); flagLoop('suncell', 22, 'suncell', 1); flagLoop('cell (drains)', 43, 'cell', 2); flagLoop('burning glass', 23, 'burning_glass', 1);
flagLoop('ringer 6 s', 25, 'ringer', 16, 6, (e) => Math.ceil(6 * (1 - e))); flagLoop('delay', 26, 'delay', 16); flagLoop('fishbowl', 36, 'fishbowl', 0, 4);
flagLoop('gotcha crank tune', 32, 'gotcha_box', 2, 10); flagLoop('big top fuse', 29, 'big_top', 16);
btn('skyrocket fly-by', () => simulate(2.5, (e) => ga.part(28, 'skyrocket', [-15 + 30 * e, 2 + 4 * e, -2], 1, 0, null)), r6);
btn('vortex spiral', () => {
  let a = 0;
  simulate(4, (e, dt) => {
    ga.part(44, 'vortex', [0, 0.2, -0.5], 0, 0, null);
    const r = 0.38 * (1 - e) + 0.02;
    a += (1.5 / r) * dt;
    ga.roller('rb', 'stitch', [Math.cos(a) * r, 0.5 - 0.3 * e, -0.5 + Math.sin(a) * r]);
  });
}, r6);
btn('tube roll', () => { ga.setPaths([{ kind: 'tube', pts: [[-3, 0.6, 0], [3, 0.6, 0]] }]); simulate(3, (e) => ga.roller('rt', 'thud', [-3 + 6 * e, 0.6, 0])); }, r6);
btn('gutter roll', () => { ga.setPaths([{ kind: 'gutter', pts: [[-3, 0.6, 0], [3, 0.6, 0]] }]); simulate(3, (e) => ga.roller('rg', 'boing', [-3 + 6 * e, 0.6, 0])); }, r6);
btn('floor roll', () => simulate(3, (e) => ga.roller('rf', 'thud', [-3 + 6 * e, 0.11, 0])), r6);
btn('pause 1 s', () => { ga.setPlayback(true, 1, simTick); setTimeout(() => ga.setPlayback(false, 1, simTick), 1000); }, r6);
btn('stop (build)', () => ga.setMode('build'), r6);

const r7 = row('Critters (simulated)');
const crit = (label: string, id: number, type: string, sec: number, st: (e: number) => [Vec, number[]]): void => {
  btn(label, () => simulate(sec, (e) => { const [p, b] = st(e); ga.part(id, type, p, 0, 0, null, b); }), r7);
};
crit('Mochi walk-by', 50, 'mochi', 4, (e) => [[-3 + 6 * e, 0, 0], [clip('walk'), 0, 0, 0]]);
crit('Mochi chase', 50, 'mochi', 3, (e) => [[-4 + 9 * e, 0, 0], [clip('chase'), 0, 0, 0]]);
crit('Mochi nap (purr)', 50, 'mochi', 6, () => [[0, 0, 0], [clip('sleep'), 4, 0, 0]]);
crit('Mochi startled', 50, 'mochi', 1.5, (e) => [[0, 0, 0], [clip(e < 0.2 ? 'idle' : 'arch_scared'), 0, 0, 0]]);
crit('Mochi trapped', 50, 'mochi', 2, (e) => [[0, 0, 0], [clip(e < 0.2 ? 'idle' : 'trapped'), e < 0.2 ? 0 : 2, 0, 0]]);
crit('Pip scurry', 51, 'pip', 3, (e) => [[-1 + 2 * e, 0, 0.5], [clip('run'), 0, 0, 0]]);
crit('Pip wheel sprint', 51, 'pip', 6, (e) => [[0, 0.1, 0], [clip(e < 0.85 ? 'wheel_sprint' : 'idle'), 8, 0, 0]]);
crit('Pip alarm', 51, 'pip', 1.5, (e) => [[0, 0, 0.5], [clip(e < 0.2 ? 'idle' : 'startled'), 0, 0, 0]]);
crit('Goby swim (idle bloops)', 52, 'goby', 10, () => [[0.4, 0.3, 0], [clip('swim'), 0, 0, 0]]);
crit('Goby flop', 52, 'goby', 4, () => [[0.4, 0, 0], [clip('flop'), 0, 0, 0]]);
crit('Bandit walk', 53, 'bandit', 4, (e) => [[3 - 6 * e, 0, -0.5], [clip('walk'), 0, 0, 0]]);
crit('Bandit pedal', 53, 'bandit', 6, () => [[0, 0.3, 0], [clip('pedal'), 8, 0, 0]]);
crit('Bandit steal', 53, 'bandit', 2, (e) => [[0, 0, 0], [clip(e < 0.2 ? 'idle' : 'steal_grab'), 0, 0, 0]]);
crit('Bandit snore', 53, 'bandit', 6, () => [[0, 0, 0], [clip('sleep'), 4, 0, 0]]);
const r7b = row('Critter events');
for (const [sp, id] of [['mochi', 50], ['pip', 51], ['goby', 52], ['bandit', 53]] as const) {
  btn(`${sp} ragdoll`, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Ragdoll', id, [0, 0.2, 0], 5)], partType); }, r7b);
  btn(`${sp} thump`, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Impact', id, [0, 0.1, 0], 4)], partType); }, r7b);
  btn(`${sp} getup`, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Getup', id, [0, 0.2, 0], 0)], partType); }, r7b);
  btn(`${sp} emote ♥`, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Emote', id, [0, 0.2, 0], Math.max(0, EMOTES.indexOf('heart')))], partType); }, r7b);
}
btn('trap box catches Mochi', () => { ga.setMode('running'); ga.onSimEvents([{ ...ev(now(), 'Trapped', 37, [0, 0.2, 0], 0), other: 50 }], partType); }, r7b);
btn('goby rescued (despawn)', () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Despawn', 52, [0, 0.3, 0], 0)], partType); }, r7b);

const r8 = row('Ambience');
for (const env of ['studio', 'kitchen', 'off']) btn(env, () => ga.setEnvironment(env, 'room'), r8);
btn('kitchen (warehouse)', () => ga.setEnvironment('kitchen', 'warehouse'), r8);
btn('run mode', () => ga.setMode('running'), r8);
btn('build mode', () => ga.setMode('build'), r8);
btn('pause', () => ga.setPlayback(true, 1, simTick), r8);
btn('unpause', () => ga.setPlayback(false, 1, simTick), r8);
btn('action burst (duck)', () => { ga.setMode('running'); for (let i = 0; i < 12; i++) setTimeout(() => ga.onSimEvents([ev(now(), 'Detonate', 1000 + i, [Math.sin(i) * 3, 0.1, -3], 1)], partType), i * 120); }, r8);

// every M2 bank cue, straight from the recipe lists
const cueRow = (title: string, names: string[]): void => {
  const d = document.createElement('details');
  d.innerHTML = `<summary><b>${title}</b> (${names.length})</summary>`;
  live.appendChild(d);
  for (const n of names) btn(n, () => ga.cue(n, { pos: [0.4, 0.3, 0.3] }), d);
};
cueRow('All M2 mechanism cues', mechRecipes().map((r) => r[0]));
cueRow('All critter cues', critterRecipes().map((r) => r[0]));
cueRow('All ambience cues', ambienceRecipes().map((r) => r[0]));

// ---------------- live: M3 (parts, pyro, spectacle, Tinker Lab, music v2) ----------------

const M3_EVENTS: [string, string, number, number, number?][] = [
  ['lance on', 'Lit', 60, 0], ['lance burn', 'Ignite', 60, 0], ['lance off', 'Unlit', 60, 0], ['mirror ting', 'Lit', 61, 0],
  ['tripwire arm', 'Lit', 62, 0], ['tripwire chirp', 'Signal', 62, 0], ['ping tx', 'Send', 63, 1], ['ping rx', 'Receive', 64, 1],
  ['maglock on', 'Powered', 65, 0], ['maglock clack', 'Impact', 65, 2], ['maglock off', 'Unpowered', 65, 0], ['marble click', 'Impact', 66, 0.1, 67],
  ['spindeck clunk', 'Powered', 68, 0], ['lift clunk', 'Powered', 69, 0], ['lift chime', 'Arrive', 69, 0], ['ram fire', 'Signal', 71, 0], ['ram retract', 'Retract', 71, 0],
  ['POWDER KEG', 'Detonate', 72, 3], ['jitter clink', 'Impact', 73, 0.05], ['JITTERJUICE', 'Detonate', 73, 1.5],
  ['skyshow lift', 'Launch', 74, 20], ['burst crackle', 'Burst', 74, 1], ['burst pops', 'Burst', 74, 5], ['burst hiss', 'Burst', 74, 2], ['burst boom', 'Burst', 74, 0],
  ['flamer ignite', 'Lit', 75, 0], ['flamer off', 'Unlit', 75, 0], ['popper', 'Pop', 76, 0], ['snaptrap', 'Launch', 77, 5],
  ['bonker swing', 'Signal', 78, 0], ['bonker bonk', 'Impact', 78, 4], ['flinger', 'Launch', 79, 8], ['wrecker hit', 'Impact', 80, 30],
  ['pinger', 'Signal', 81, 0], ['pinger thock', 'Impact', 81, 2], ['paddle flip', 'Signal', 82, 0], ['paddle hit', 'Impact', 82, 3], ['bumper', 'Impact', 83, 1],
  ['pin knock', 'Impact', 84, 2], ['stacker knock', 'Impact', 85, 1], ['pane shatter', 'Break', 13, 0], ['vase shatter', 'Break', 86, 0],
  ['tonebar C6', 'Note', 87, 84], ['tonebar deg 4', 'Note', 87, 4], ['tonebar (impact)', 'Impact', 93, 0.8], ['ding (note)', 'Note', 88, 0], ['ding (impact)', 'Impact', 88, 1.5], ['ding dunk', 'Impact', 88, 0.1],
  ['fabricator spawn', 'Spawn', 89, 0], ['recycler gulp', 'Despawn', 90, 0], ['booster', 'Boost', 99, 4], ['pins all down', 'PinsAllDown', 84, 0],
];
const r9 = row('M3 events');
for (const [label, kind, part, mag, other] of M3_EVENTS) btn(label, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), kind, part, [(Math.random() - 0.5) * 2, 0.3, 0], mag, other)], partType); }, r9);
btn('tonebars scale', () => { ga.setMode('running'); for (let k = 0; k < 15; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Note', 87, [-1.5 + k * 0.2, 0.3, 0], k)], partType), k * 180); }, r9);
btn('pins strike (10)', () => { ga.setMode('running'); for (let k = 0; k < 10; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Impact', 300 + k, [k * 0.05, 0.1, 0], 3)], partType), k * 12); }, r9);
btn('stacker tower falls', () => { ga.setMode('running'); for (let k = 0; k < 14; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Impact', 400 + k, [k * 0.03, 0.1 + k * 0.05, 0], 1.5)], partType), k * 15); }, r9);
btn('skyshow ×6 (auto bursts)', () => { ga.setMode('running'); for (let k = 0; k < 6; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Launch', 74, [0, 0.2, -2], 20)], partType), k * 700); }, r9);

const r10 = row('M3 loops (simulated run)');
const m3flag = (label: string, id: number, type: string, flags: number, sec = 3, meter: (e: number) => number = () => 0): void => {
  btn(label, () => simulate(sec, (e) => ga.part(id, type, [0.5, 0.3, 0], e < 0.92 ? flags : 0, meter(e), null)), r10);
};
m3flag('lance hum', 60, 'lance', 1); m3flag('lance cutting', 60, 'lance', 1 | 16); m3flag('prism shimmer', 61, 'mirror_splitter', 1); m3flag('maglock hum', 65, 'maglock', 2);
m3flag('keg fuse + cook', 72, 'powder_keg', 16 | 1, 4); m3flag('jitterjuice fizz', 73, 'jitterjuice', 0); m3flag('skyshow fuse', 74, 'skyshow', 16); m3flag('flamer roar', 75, 'flamer', 1, 4);
m3flag('fabricator hum', 89, 'fabricator', 2); m3flag('zone hum', 91, 'zone', 0);
let deckA = 0;
btn('spindeck spin-up', () => simulate(4, (e, dt) => { deckA += 4 * Math.min(1, e * 1.5) * (e < 0.85 ? 1 : 0) * dt; ga.part(68, 'spindeck', [0, 0.2, 0], 0, 0, rotY(deckA)); }), r10);
btn('lift up and down', () => simulate(5, (e) => ga.part(69, 'lift', [0, 0, 0], 2, 0, null, null, [0, e < 0.45 ? 1.5 * Math.min(1, e / 0.4) : e < 0.55 ? 1.5 : 1.5 * Math.max(0, 1 - (e - 0.55) / 0.4), 0])), r10);
btn('rack run to endstop', () => simulate(3, (e) => ga.part(70, 'rack', [0, 0.2, 0], 0, 0, null, null, [Math.min(0.6, e * 1.2), 0.2, 0])), r10);
btn('ram fire (flag)', () => simulate(2, (e) => ga.part(71, 'ram', [0, 0.2, 0], e > 0.2 && e < 0.6 ? 2 : 0, 0, null)), r10);
btn('wrecker swing', () => simulate(5, (e) => { const th = 1.1 * Math.cos(e * 5 * 2.2); ga.part(80, 'wrecker', [Math.sin(th) * 2, 2.2 - Math.cos(th) * 2, -1], 0, 0, null); }), r10);

const r11 = row('Marbles / glidepath');
const surf = (type: string, id: number): void => ga.part(id, type, [0, 0.0, 0], 0, 0, null);
btn('glint on wood (slope)', () => simulate(3, (e) => { surf('slope', 92); ga.roller('m1', 'marble', [-0.5 + 1 * e, 0.05, 0]); }), r11);
btn('bearing on steel (tonebars)', () => simulate(3, (e) => { surf('tonebars', 93); ga.roller('m2', 'bearing', [-0.4 + 0.8 * e, 0.06, 0]); }), r11);
btn('glint on glass (pane)', () => simulate(3, (e) => { surf('pane', 13); ga.roller('m3', 'marble', [-0.4 + 0.8 * e, 0.05, 0]); }), r11);
btn('glint on the floor (env)', () => simulate(3, (e) => ga.roller('m4', 'marble', [-2 + 4 * e, 0.01, 1])), r11);
btn('glidepath rail + booster', () => {
  ga.setPaths([{ kind: 'glidepath', pts: [[-4, 0.5, 0], [4, 0.5, 0]] }]);
  let x = -4;
  simulate(4, (e, dt) => { const v = e < 0.4 ? 1.2 : 4.5; x += v * dt; ga.roller('g1', 'bearing', [Math.min(4, x), 0.5, 0]); });
}, r11);

/** 400 Bangsticks + 60 Powder Kegs: a broadcast of 64, then the chain spreading through a 24 m fortress over `sec`. */
function kilotonPlan(sec: number, t0: number, rng: Rng): { t: number; id: number; pos: Vec; y: number }[] {
  const all: { t: number; id: number; pos: Vec; y: number }[] = [];
  for (let k = 0; k < 460; k++) {
    const keg = k >= 400;
    const t = k < 64 ? 0.02 * rng.next() : 0.1 + sec * Math.pow(rng.next(), 0.8);
    const a = rng.next() * Math.PI * 2, r = 6 + 6 * rng.next();
    all.push({ t: t0 + t, id: keg ? 2000 + k : 1000 + k, pos: [Math.cos(a) * r, rng.next() * 3, Math.sin(a) * r], y: keg ? 3 : 1 });
  }
  return all.sort((a, b) => a.t - b.t);
}
const kilotonLive = (sec: number, seed: string): void => {
  const all = kilotonPlan(sec, now(), new Rng(seed));
  let i = 0;
  const start = performance.now(), t0 = all[0]!.t;
  const h = setInterval(() => {
    const t = t0 + (performance.now() - start) / 1000;
    const es: SimEventLike[] = [];
    while (i < all.length && all[i]!.t <= t) { const d = all[i++]!; es.push(ev(d.t, 'Detonate', d.id, d.pos, d.y)); }
    if (es.length) ga.onSimEvents(es, partType);
    if (i >= all.length) clearInterval(h);
  }, 16);
};
const r12 = row('Pyro / spectacle');
btn('KILOTON (400 + 60)', () => { ga.setMode('running'); ga.setListener({ pos: [0, 17, 30], forward: [0, -0.5, -0.87], up: [0, 1, 0] }); kilotonLive(3, 'kiloton'); }, r12);
btn('listener back', () => ga.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] }), r12);
btn('hitstop 80 ms on a keg', () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Detonate', 72, [0, 0.2, -2], 3)], partType); setTimeout(() => ga.hitstop(80, 1), 30); }, r12);
btn('slow-mo 0.25× 0.8 s', () => {
  ga.setMode('running');
  ga.onSimEvents([ev(now(), 'Detonate', 72, [0, 0.2, -2], 3)], partType);
  ga.hitstop(80, 1);
  setTimeout(() => ga.slowmo(0.25, 0.8), 90);
  for (let k = 0; k < 8; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Impact', 200 + k, [Math.sin(k), 0.2, -1.5], 4)], partType), 120 + k * 90);
}, r12);
btn('slow-mo inferred (playhead 0.25×)', () => simulate(3, (_e, dt) => { simTick -= dt * 120 * 0.75; ga.loop('sm', 'motor', [0, 0.3, 0], 1); }), r12);

const r13 = row('Tinker Lab');
btn('tinker (room)', () => ga.setEnvironment('tinker', 'room'), r13);
btn('tinker (desk)', () => ga.setEnvironment('tinker', 'desk'), r13);
btn('hide Mochi', () => ga.setAmbientMochi(false), r13);
btn('show Mochi', () => ga.setAmbientMochi(true), r13);
btn('listener at Mochi (desk)', () => ga.setListener({ pos: [3.6, 0.6, 1.2], forward: [0, 0, -1], up: [0, 1, 0] }), r13);
btn('listener: desk camera', () => ga.setListener({ pos: [0, 2.66, 4.63], forward: [0, -0.45, -0.89], up: [0, 1, 0] }), r13);

const r14 = row('Music v2');
btn('density burst (L5)', () => { ga.setMode('running'); for (let k = 0; k < 40; k++) setTimeout(() => ga.onSimEvents([ev(now(), 'Detonate', 1000 + k, [Math.sin(k) * 6, 0.1, -8], 1)], partType), k * 60); }, r14);
btn('Kiloton drop', () => { ga.setMode('running'); kilotonLive(2, 'drop'); }, r14);

cueRow('All M3 part cues', m3Recipes().map((r) => r[0]));
// ---------------- live: M4 (parts, Biscuit / Henny / Dusty, Matter, GPU probe) ----------------
liveM4({ ga, btn, row, now, simulate, cueRow, ev, partType, clip });
// ---------------- live: M5 (parts, BUZZ, Hangar / Moon, air 0 %) ----------------
liveM5({ ga, btn, row, now, simulate, cueRow, ev, partType, clip });
cueRow('All M3 pyro cues', pyroRecipes().map((r) => r[0]));
const statsLine = document.createElement('div');
statsLine.style.cssText = 'font: 12px monospace; opacity: .7; margin-top: 6px';
live.appendChild(statsLine);
setInterval(() => { statsLine.textContent = JSON.stringify(ga.stats); }, 500);

// ---------------- offline checks ----------------

interface Result { name: string; dur: number; peak: number; tp: number; rmsDb: number; maxWinRmsDb: number; minWinRmsDb: number; over: number; renderMs: number; ok: boolean; note: string; grMax?: number }
/** Substring filter for the offline checks (window.__audioOffline(filter)); empty = all. */
let offlineFilter = '';
/** Limiter ceiling as the test meters it (true peak, 4× / 48 taps): −1 dBTP with a 0.05 dB metering tolerance. */
const TP_LIMIT_DB = -0.95;

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -200);

interface Expect {
  silentOk?: [number, number][]; minPeakDb?: number; slots?: [number, number][]; quiet?: [number, number][]; env?: string; preset?: string;
  check?: (g: GameAudio, buf: AudioBuffer, lim: LimiterStats[]) => string;
  /** M3: run on the fallback limiter (no AudioWorklet). */
  noWorklet?: boolean;
  listener?: { pos: Vec; forward: Vec };
  /** Fail when the RMS over [from, to] s is outside [lo, hi] dB. */
  rms?: { from: number; to: number; lo: number; hi: number };
}

async function render(name: string, sec: number, script: (g: GameAudio, t: number, i: number) => void, expect: Expect = {}): Promise<Result | null> {
  if (offlineFilter && !name.toLowerCase().includes(offlineFilter.toLowerCase())) return null;
  const ctx = new OfflineAudioContext(2, Math.round(sec * 48000), 48000);
  const g = new GameAudio({ context: ctx, noWorklet: expect.noWorklet ?? false });
  g.setEnvironment(expect.env ?? 'off', expect.preset ?? 'room');
  g.setCritterNames(CLIPS, EMOTES);
  const lim: LimiterStats[] = [];
  const pm = (window as unknown as { __pyroMakeup?: number }).__pyroMakeup;
  if (pm) g.pyroMakeup = pm;
  g.onLimiterStats = (st) => lim.push(st);
  await g.unlock();
  g.setListener(expect.listener ? { pos: expect.listener.pos, forward: expect.listener.forward, up: [0, 1, 0] } : { pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] });
  const dt = 1 / 60;
  for (let i = 1; i * dt < sec - 0.02; i++) {
    const t = i * dt;
    void ctx.suspend(t).then(() => { try { script(g, t, i); g.frame(dt); } catch (err) { console.error(err); } void ctx.resume(); });
  }
  const a = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - a;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, sum = 0, over = 0;
  const win = 4800; // 100 ms windows
  let maxW = -200, minW = 200;
  const silentWins: number[] = [];
  for (let w = 0; w + win <= L.length; w += win) {
    let s = 0;
    for (let i = w; i < w + win; i++) {
      const l = L[i]!, r = R[i]!;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
      if (al > 0.995 || ar > 0.995) over++;
      s += l * l + r * r;
    }
    sum += s;
    const wdb = db(Math.sqrt(s / (2 * win)));
    const t = w / 48000;
    const allowed = (expect.silentOk ?? [[0, 0.3]]).some(([x, y]) => t >= x && t < y);
    if (!allowed) { maxW = Math.max(maxW, wdb); minW = Math.min(minW, wdb); if (wdb < -60) silentWins.push(t); }
  }
  const rmsDb = db(Math.sqrt(sum / (2 * L.length)));
  const notes: string[] = [];
  if (expect.slots) {
    // per-sound check: every slot must contain something audible; continuous silence checks are skipped
    silentWins.length = 0;
    const quiet: string[] = [];
    let minSlot = 0;
    expect.slots.forEach(([x, y], k) => {
      let p = 0;
      for (let i = Math.round(x * 48000); i < Math.min(L.length, Math.round(y * 48000)); i++) p = Math.max(p, Math.abs(L[i]!), Math.abs(R[i]!));
      if (db(p) < -40) quiet.push(`#${k}`);
      minSlot = Math.min(minSlot, db(p));
    });
    minW = minSlot;
    if (quiet.length) notes.push(`quiet slots ${quiet.join(',')}`);
  }
  for (const [x, y] of expect.quiet ?? []) {
    let p = 0;
    for (let i = Math.round(x * 48000); i < Math.min(L.length, Math.round(y * 48000)); i++) p = Math.max(p, Math.abs(L[i]!), Math.abs(R[i]!));
    if (db(p) > -50) notes.push(`not quiet ${x}-${y}s (${db(p).toFixed(1)} dB)`);
  }
  if (expect.rms) {
    const { from, to, lo, hi } = expect.rms;
    let ss = 0, n = 0;
    for (let i = Math.round(from * 48000); i < Math.min(L.length, Math.round(to * 48000)); i++) { ss += L[i]! * L[i]! + R[i]! * R[i]!; n += 2; }
    const r = db(Math.sqrt(ss / Math.max(1, n)));
    if (r < lo || r > hi) notes.push(`RMS ${r.toFixed(1)} dB outside [${lo}, ${hi}]`);
  }
  const extra = expect.check?.(g, buf, lim);
  if (extra && extra.startsWith('!')) notes.push(extra.slice(1));
  if (over > 0) notes.push(`${over} samples ≥ 0.995`);
  // M3: the master limiter's ceiling is −1 dBTP (true peak)
  const tp = truePeak([L, R]);
  if (g.stats.limiter === 'worklet' && db(tp) > TP_LIMIT_DB) notes.push(`true peak ${db(tp).toFixed(2)} dBTP over −1`);
  if (g.stats.limiter !== 'worklet' && db(peak) > -0.99) notes.push(`fallback sample peak ${db(peak).toFixed(2)} dBFS over −1`);
  if (silentWins.length) notes.push(`silent windows at ${silentWins.slice(0, 4).map((t) => t.toFixed(1)).join(', ')}s`);
  if (db(peak) < (expect.minPeakDb ?? -30)) notes.push('too quiet');
  let grMax = 0;
  for (const st of lim) if (st.gr > grMax) grMax = st.gr;
  const res: Result = {
    name, dur: sec, peak, tp, rmsDb, maxWinRmsDb: maxW, minWinRmsDb: minW, over, renderMs, ok: notes.length === 0, grMax,
    note: notes.join('; ') || `bank ${g.stats.buildMs} ms, ${g.stats.limiter}, GR max ${grMax.toFixed(1)} dB, stolen ${g.stats.stolen}, merged ${g.stats.merged}, booms merged ${g.stats.boomsMerged}${extra ? `, ${extra}` : ''}`,
  };
  return res;
}

async function offline(): Promise<Result[]> {
  const results: Result[] = [];
  const out = document.getElementById('out')!;
  const show = () => {
    out.innerHTML = `<table><tr><th>scenario</th><th>dur s</th><th>peak dBFS</th><th>TP dBTP</th><th>RMS dB</th><th>max 100ms RMS</th><th>min 100ms RMS / slot peak</th><th>render ms</th><th>CPU≈</th><th>notes</th></tr>${results.map((r) =>
      `<tr><td class="${r.ok ? 'ok' : 'bad'}">${r.name}</td><td>${r.dur}</td><td>${db(r.peak).toFixed(2)}</td><td>${db(r.tp).toFixed(2)}</td><td>${r.rmsDb.toFixed(1)}</td><td>${r.maxWinRmsDb.toFixed(1)}</td><td>${r.minWinRmsDb.toFixed(1)}</td><td>${r.renderMs.toFixed(0)}</td><td>${(100 * r.renderMs / 1000 / r.dur).toFixed(1)}%</td><td>${r.note}</td></tr>`).join('')}</table>`;
  };
  const add = (r: Result | null) => { if (!r) return; results.push(r); show(); console.log('[audio-test]', JSON.stringify(r)); };

  // UI: one sound every 0.5 s
  const uiNames = ['place', 'remove', 'rotate', 'wire', 'unwire', 'select', 'countdown', 'countdown', 'countdown', 'go', 'stop', 'error', 'chat', 'undo'];
  add(await render('ui sounds', uiNames.length * 0.5 + 0.5, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    const k = Math.round((t - 0.3) / 0.5);
    if (Math.abs(t - 0.3 - k * 0.5) < 0.5 / 60 && k >= 0 && k < uiNames.length) g.ui(uiNames[k]!);
  }, { slots: uiNames.map((_, k) => [0.3 + k * 0.5, 0.3 + k * 0.5 + 0.4] as [number, number]) }));

  // Impacts per material, three strengths each
  const imp: [number, number][] = [];
  for (const p of [1, 2, 3, 4, 5, 7, 11, 12, 13, 8]) for (const J of [0.3, 3, 25]) imp.push([p, J]);
  add(await render('impacts (10 parts × 3 J)', imp.length * 0.25 + 0.5, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    const k = Math.round((t - 0.3) / 0.25);
    if (Math.abs(t - 0.3 - k * 0.25) < 0.5 / 60 && k >= 0 && k < imp.length) g.onSimEvents([ev(t, 'Impact', imp[k]![0], [0, 0.1, 0], imp[k]![1])], partType);
  }, { slots: imp.map((_, k) => [0.3 + k * 0.25, 0.3 + k * 0.25 + 0.2] as [number, number]) }));

  // Single bangstick, 2 m away
  add(await render('detonate ×1', 4, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    if (i === 18) g.onSimEvents([ev(t, 'Detonate', 5, [0, 0.1, 1], 1)], partType);
  }, { silentOk: [[0, 0.3], [1.8, 9]] })); // a yield-1 boom's tail is below -60 dB by 1.8 s (unchanged since M1)

  // 50 booms in one second (Kiloton benchmark scaled down)
  add(await render('chain 50 booms / 1 s', 5, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    if (t > 0.3 && t < 1.3) {
      const es: SimEventLike[] = [];
      for (let k = 0; k < 50; k++) { const tk = 0.3 + k * 0.02; if (tk >= t - 1 / 60 && tk < t) es.push(ev(tk, 'Detonate', 1000 + k, [-2 + k * 0.08, 0.1, -1 + (k % 5) * 0.3], 1)); }
      if (es.length) g.onSimEvents(es, partType);
    }
  }, { silentOk: [[0, 0.3], [4.2, 9]] }));

  // 400 booms in 2 s, with music on, plus a domino run: worst case
  add(await render('400 booms / 2 s + music', 6, (g, t, i) => {
    if (i === 1) g.setMode('running');
    if (t > 0.5 && t < 2.5) {
      const es: SimEventLike[] = [];
      for (let k = 0; k < 7; k++) es.push(ev(t, 'Detonate', 1000 + i * 7 + k, [Math.sin(i + k) * 4, 0.1, Math.cos(i * 3 + k) * 4 - 2], 1));
      for (let k = 0; k < 3; k++) es.push(ev(t, 'Impact', 500 + k, [k * 0.1, 0.05, 0], 0.4));
      g.onSimEvents(es, partType);
    }
  }));

  // Every one-shot event kind
  const kinds: [string, number, number][] = [
    ['Signal', 8, 0], ['Powered', 10, 0], ['Unpowered', 10, 0], ['Ignite', 5, 0], ['Ignite', 6, 0], ['Extinguish', 6, 0], ['FuseLit', 5, 0],
    ['FuseEnd', 5, 0], ['Pop', 7, 0], ['Cut', 99, 0], ['Press', 8, 0], ['Press', 9, 0],
  ];
  add(await render('event one-shots', kinds.length * 0.6 + 1.2, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    const k = Math.round((t - 0.3) / 0.6);
    if (Math.abs(t - 0.3 - k * 0.6) < 0.5 / 60 && k >= 0 && k < kinds.length) g.onSimEvents([ev(t, kinds[k]![0], kinds[k]![1], [0.5, 0.2, 0.5])], partType);
  }, { slots: kinds.map((_, k) => [0.3 + k * 0.6, 0.3 + k * 0.6 + 0.5] as [number, number]) }));

  // Loops, 2 s each, level ramps
  const loopKinds = ['fuse', 'motor', 'fan', 'flame', 'roll'] as const;
  add(await render('loops', loopKinds.length * 2 + 0.6, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    const k = Math.floor((t - 0.2) / 2);
    if (t > 0.2 && k < loopKinds.length) {
      const e = ((t - 0.2) % 2) / 2;
      g.loop(`L${k}`, loopKinds[k]!, [Math.sin(e * 6), 0.2, 0], loopKinds[k] === 'roll' ? 0.2 + e : 0.3 + 0.7 * e, 'thud');
    }
  }, { silentOk: [[0, 0.3], [loopKinds.length * 2 + 0.2, 99]] }));

  // Many rolling balls and motors at once (voice caps)
  add(await render('40 loops at once', 4, (g, t) => {
    g.setVolumes({ music: 0 });
    for (let k = 0; k < 40; k++) g.loop(`M${k}`, k % 2 ? 'roll' : 'motor', [Math.sin(k) * 3, 0.1, Math.cos(k) * 3], 0.6 + 0.3 * Math.sin(t + k), k % 4 === 1 ? 'boing' : 'thud');
  }));

  // Music: build bed 20 s
  add(await render('music build 20 s', 20, (g, _t, i) => { if (i === 1) g.setVolumes({ sfx: 0 }); }, { silentOk: [[0, 1.2]], minPeakDb: -30 }));

  // Music: run with rising intensity 24 s
  add(await render('music run 24 s (intensity ramp)', 24, (g, t, i) => {
    if (i === 1) { g.setVolumes({ sfx: 0 }); g.setMode('running'); }
    if (i % 30 === 0 && t > 4 && t < 18) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [0, 0, -3], 1 + t / 6)], partType);
  }, { silentOk: [[0, 0.4]] }));

  // Mode round trip and mute
  add(await render('modes + mute', 10, (g, t, i) => {
    if (i === 60) g.setMode('countdown');
    if (i === 60 || i === 100 || i === 140) g.ui('countdown');
    if (i === 180) { g.setMode('running'); g.ui('go'); }
    if (i === 420) { g.setMode('build'); g.ui('stop'); }
    if (i === 500) g.setVolumes({ muted: true });
    void t;
  }, { silentOk: [[0, 0.5], [8.4, 99]] }));

  // ---------------- M2 ----------------
  const slotted = (n: number, w: number, t0 = 0.3): [number, number][] => Array.from({ length: n }, (_, k) => [t0 + k * w, t0 + k * w + w * 0.85] as [number, number]);
  const atSlot = (t: number, w: number, t0 = 0.3): number => { const k = Math.round((t - t0) / w); return Math.abs(t - t0 - k * w) < 0.5 / 60 ? k : -1; };

  add(await render('M2 event one-shots', M2_EVENTS.length * 0.7 + 2.5, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const k = atSlot(t, 0.7);
    if (k >= 0 && k < M2_EVENTS.length) { const [, kind, part, mag] = M2_EVENTS[k]!; g.onSimEvents([ev(t, kind, part, [0.5, 0.3, 0.5], mag)], partType); }
  }, { slots: slotted(M2_EVENTS.length, 0.7) }));

  const critCues = critterRecipes().map((r) => r[0]).filter((n) => !n.startsWith('loop/'));
  add(await render('critter cues', critCues.length * 0.6 + 1, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    const k = atSlot(t, 0.6);
    if (k >= 0 && k < critCues.length) g.cue(critCues[k]!, { pos: [0.5, 0.2, 0.5] });
  }, { slots: slotted(critCues.length, 0.6), minPeakDb: -30 }));

  // every M2 state loop through the real part() path: 1.6 s each
  type LoopCase = [string, number, string, (e: number, a: number) => [number, number, [number, number, number, number] | null, Vec], number?];
  const loopCases: LoopCase[] = [
    ['dynamo', 39, 'dynamo', (_e, a) => [0, 0, rotY(a), [0, 0.3, 0]], 18], ['turbine', 40, 'turbine', (_e, a) => [0, 0, rotY(a), [0, 0.3, 0]], 12],
    ['wheel', 41, 'hamster_drive', (_e, a) => [0, 0, rotY(a), [0, 0.3, 0]], 5], ['chain', 42, 'pedal_rig', (_e, a) => [0, 0, rotY(a), [0, 0.3, 0]], 18],
    ['lamp', 20, 'lamp', () => [1, 0, null, [0, 0.3, 0.5]]], ['suncell', 22, 'suncell', () => [1, 0, null, [0, 0.3, 0.5]]],
    ['cell', 43, 'cell', () => [2, 0, null, [0, 0.3, 0.5]]], ['sizzle', 23, 'burning_glass', () => [1, 0, null, [0, 0.3, 0.5]]],
    ['ringer', 25, 'ringer', () => [16, 9, null, [0, 0.3, 0.5]]], ['delay', 26, 'delay', () => [16, 0, null, [0, 0.3, 0.5]]],
    ['thrust', 28, 'skyrocket', (e) => [1, 0, null, [-6 + 12 * e, 1.5, -1]]], ['bubbles', 36, 'fishbowl', () => [0, 0, null, [0, 0.3, 0.5]]],
    ['crank+tune', 32, 'gotcha_box', () => [2, 0, null, [0, 0.3, 0.5]]],
  ];
  add(await render('M2 loops via part()', loopCases.length * 1.6 + 0.8, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const k = Math.floor((t - 0.2) / 1.6);
    if (t > 0.2 && k < loopCases.length) {
      const [, id, type, f, w] = loopCases[k]!;
      const e = ((t - 0.2) % 1.6) / 1.6;
      const [flags, meter, rot, pos] = f(e, (w ?? 0) * t);
      g.part(id, type, pos, flags, meter, rot);
    }
  }, { slots: loopCases.map((_, k) => [0.4 + k * 1.6, 0.2 + (k + 1) * 1.6] as [number, number]) }));

  add(await render('rollers: floor / tube / vortex', 7, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); g.setPaths([{ kind: 'tube', pts: [[-3, 0.6, 0], [3, 0.6, 0]] }]); }
    g.setPlayback(false, 1, t * 120);
    if (t > 0.2 && t < 2.2) g.roller('a', 'thud', [-2 + 2 * (t - 0.2), 0.11, 0]);
    else if (t > 2.4 && t < 4.4) g.roller('b', 'stitch', [-2 + 2 * (t - 2.4), 0.6, 0]);
    else if (t > 4.6 && t < 6.6) {
      g.part(44, 'vortex', [0, 0.2, -0.5], 0, 0, null);
      const e = (t - 4.6) / 2, r = 0.36 * (1 - e) + 0.03, a = 8 * e / Math.max(r, 0.05);
      g.roller('c', 'stitch', [Math.cos(a) * r, 0.45 - 0.2 * e, -0.5 + Math.sin(a) * r]);
    }
  }, { slots: [[0.5, 2.2], [2.7, 4.4], [4.9, 6.6]] }));

  add(await render('critters: walk, nap, wheel, pedal, flop', 10.5, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    if (t > 0.2 && t < 2.2) g.part(50, 'mochi', [-1.5 + 1.5 * (t - 0.2), 0, 0], 0, 0, null, [clip('walk'), 0, 0, 0]);
    else if (t > 2.2 && t < 4.2) g.part(50, 'mochi', [1.5, 0, 0], 0, 0, null, [clip('sleep'), 4, 0, 0]);
    else if (t > 4.2 && t < 6.2) g.part(51, 'pip', [0, 0.1, 0.5], 0, 0, null, [clip('wheel_sprint'), 8, 0, 0]);
    else if (t > 6.2 && t < 8.2) g.part(53, 'bandit', [0, 0.3, 0], 0, 0, null, [clip('pedal'), 8, 0, 0]);
    else if (t > 8.2 && t < 10.2) g.part(52, 'goby', [0.3, 0, 0.5], 0, 0, null, [clip('flop'), 0, 0, 0]);
  }, { slots: [[0.4, 2.2], [2.4, 4.2], [4.4, 6.2], [6.4, 8.2], [8.8, 10.2]] }));

  add(await render('pause silences run loops', 4, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const paused = t > 1.5;
    g.setPlayback(paused, 1, paused ? 180 : t * 120);
    g.loop('m', 'motor', [0, 0.3, 0], 1);
    g.part(39, 'dynamo', [0.5, 0.3, 0], 0, 0, rotY(t * 15));
    g.part(50, 'mochi', [0, 0, 0.5], 0, 0, null, [clip('sleep'), 4, 0, 0]);
  }, { silentOk: [[0, 0.5], [1.5, 9]], quiet: [[2.4, 3.9]] }));

  add(await render('slow-mo 0.25× loops', 3, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 0.25, t * 30);
    g.loop('m', 'motor', [0, 0.3, 0], 1);
  }));

  add(await render('ambience: Studio 12 s', 12, (g, _t, i) => { if (i === 1) g.setVolumes({ music: 0 }); },
    { env: 'studio', silentOk: [[0, 1.5]], minPeakDb: -60, check: (g) => `ambience voices ${g.stats.ambience}` }));
  add(await render('ambience: Mega Kitchen 30 s', 30, (g, _t, i) => { if (i === 1) g.setVolumes({ music: 0 }); },
    { env: 'kitchen', silentOk: [[0, 1.5]], minPeakDb: -60, check: (g) => `ambience voices ${g.stats.ambience}` }));
  add(await render('ambience ducks under action', 10, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    if (t > 4 && t < 6 && i % 6 === 0) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [0, 0.1, -3], 1)], partType);
  }, { env: 'kitchen', silentOk: [[0, 1.5], [4, 7.5]], minPeakDb: -60 })); // the room may vanish under the chain, and must come back after

  // robustness (director-camera bug): NaN/Infinity inputs, listener teleports on camera cuts, dt = 0 frames.
  // Nothing may throw (stats.faults stays 0) and the output stays finite and unclipped.
  add(await render('robustness: NaN, teleports, dt 0', 5, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const N = Number.NaN, I = Number.POSITIVE_INFINITY;
    g.setPlayback(false, i % 50 === 0 ? N : 1, i % 70 === 0 ? I : t * 120);
    // a camera cut every 0.5 s: the listener jumps 20 m (and one NaN pose)
    const cut = Math.floor(t * 2) % 2;
    g.setListener({ pos: i === 100 ? [N, 1, 1] : [cut ? 20 : 0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] });
    g.part(28, 'skyrocket', [-6 + 3 * t, 1.5, -1], 1, 0, null);                       // doppler loop across the cuts
    g.part(39, 'dynamo', [0, 0.3, 0], 2, N, i % 9 === 0 ? [N, N, N, N] : rotY(t * 15)); // NaN meter and rotations
    g.part(50, 'mochi', i % 13 === 0 ? [N, 0, 0] : [Math.sin(t) * 2, 0, 0], 0, 0, null, [clip('walk'), 0, 0, 0]);
    g.part(51, 'pip', i % 40 === 0 ? [500, 0, 0] : [0, 0, 0.5], 0, 0, null, [clip('run'), 0, 0, 0]); // teleports
    g.roller('r', 'thud', i % 11 === 0 ? [I, 0, 0] : [Math.cos(t) * 2, 0.11, 0]);
    g.loop('m', 'motor', i % 17 === 0 ? [N, 0, 0] : [0, 0.3, 0], i % 23 === 0 ? N : 1);
    if (i % 20 === 0) g.onSimEvents([ev(t, 'Impact', 3, [0, 0.1, 0], I), ev(t, 'Launch', 30, [N, 0, 0], N), ev(t, 'Detonate', 5, [0, 0.1, -2], N), ev(t, 'Note', 32, [0, 0.3, 0], I)], partType);
    g.frame(i % 7 === 0 ? 0 : i % 29 === 0 ? N : 1 / 60);
  }, { silentOk: [[0, 9]], check: (g) => (g.stats.faults > 0 ? `!${g.stats.faults} faults caught` : 'no faults') }));

  // worst case: 30 mechanism loops, 8 critters, rollers, booms, the kitchen and music, all at once
  let maxVoices = 0;
  add(await render('M2 stress: voice budget', 6, (g, t, i) => {
    if (i === 1) g.setMode('running');
    g.setPlayback(false, 1, t * 120);
    const types = ['dynamo', 'turbine', 'lamp', 'suncell', 'cell', 'burning_glass', 'ringer', 'delay', 'skyrocket', 'fishbowl', 'gotcha_box', 'hamster_drive', 'pedal_rig'];
    for (let k = 0; k < 30; k++) g.part(100 + k, types[k % types.length]!, [Math.sin(k) * 3, 0.3, Math.cos(k) * 3], 1 | 2 | 16, 0, rotY(t * (4 + k)));
    const sp = ['mochi', 'pip', 'goby', 'bandit'] as const;
    for (let k = 0; k < 8; k++) g.part(200 + k, sp[k % 4]!, [Math.sin(t + k) * 2, 0, Math.cos(t + k) * 2], 0, 0, null, [clip(k % 2 ? 'run' : 'idle'), 0, 0, 0]);
    for (let k = 0; k < 10; k++) g.roller(`r${k}`, 'thud', [Math.sin(t * 2 + k) * 2, 0.11, Math.cos(t * 2 + k) * 2]);
    if (t > 1 && t < 3) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [Math.sin(i) * 3, 0.1, -2], 1), ev(t, 'Impact', 500, [0, 0.05, 0], 2)], partType);
    maxVoices = Math.max(maxVoices, g.stats.voices + g.stats.loops + g.stats.ambience);
  }, { env: 'kitchen', check: () => (maxVoices > 64 ? `!voices peaked at ${maxVoices} > 64` : `peak voices ${maxVoices}/64`) }));

  // ---------------- M3 ----------------

  add(await render('M3 event one-shots', M3_EVENTS.length * 0.7 + 3, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const k = atSlot(t, 0.7);
    if (k >= 0 && k < M3_EVENTS.length) { const [, kind, part, mag, other] = M3_EVENTS[k]!; g.onSimEvents([ev(t, kind, part, [0.5, 0.3, 0.5], mag, other)], partType); }
  }, { slots: slotted(M3_EVENTS.length, 0.7) }));

  type M3Loop = [string, number, string, (e: number, t: number) => [number, number, [number, number, number, number] | null, Vec, Vec | null]];
  const m3Loops: M3Loop[] = [
    ['lance', 60, 'lance', () => [1, 0, null, [0, 0.3, 0.5], null]], ['lance cutting', 60, 'lance', () => [1 | 16, 0, null, [0, 0.3, 0.5], null]],
    ['prism', 61, 'mirror_splitter', () => [1, 0, null, [0, 0.3, 0.5], null]], ['maglock', 65, 'maglock', () => [2, 0, null, [0, 0.3, 0.5], null]],
    ['spindeck', 68, 'spindeck', (_e, t) => [0, 0, rotY(t * 3), [0, 0.2, 0.5], null]],
    ['lift', 69, 'lift', (e) => [2, 0, null, [0, 0, 0.5], [0, 0.2 + 0.8 * e, 0.5]]], ['rack', 70, 'rack', (e) => [0, 0, null, [0, 0.2, 0.5], [0.3 * e, 0.2, 0.5]]],
    ['keg fuse+cook', 72, 'powder_keg', () => [16 | 1, 0, null, [0, 0.2, 0.5], null]], ['jitter fizz', 73, 'jitterjuice', () => [0, 0, null, [0, 0.3, 1.5], null]],
    ['skyshow fuse', 74, 'skyshow', () => [16, 0, null, [0, 0.2, 0.5], null]], ['flamer', 75, 'flamer', () => [1, 0, null, [0, 0.3, 0.5], null]],
    ['wrecker swing', 80, 'wrecker', (_e, t) => { const th = 1.1 * Math.cos(t * 4); return [0, 0, null, [Math.sin(th) * 2, 2.2 - Math.cos(th) * 2, 0], null]; }],
    ['fabricator', 89, 'fabricator', () => [2, 0, null, [0, 0.3, 0.5], null]], ['zone', 91, 'zone', () => [0, 0, null, [0, 0.3, 1.5], null]],
  ];
  add(await render('M3 loops via part()', m3Loops.length * 1.6 + 0.8, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const k = Math.floor((t - 0.2) / 1.6);
    if (t > 0.2 && k < m3Loops.length) {
      const [, id, type, f] = m3Loops[k]!;
      const e = ((t - 0.2) % 1.6) / 1.6;
      const [flags, meter, rot, pos, arm] = f(e, t);
      g.part(id, type, pos, flags, meter, rot, null, arm);
    }
  }, { slots: m3Loops.map((_, k) => [0.45 + k * 1.6, 0.2 + (k + 1) * 1.6] as [number, number]) }));

  add(await render('marbles: wood / steel / glass / floor / glidepath', 10, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); g.setEnvironment('tinker', 'room'); g.setPaths([{ kind: 'glidepath', pts: [[-4, 0.5, -1], [4, 0.5, -1]] }]); }
    g.setPlayback(false, 1, t * 120);
    const seg = Math.floor((t - 0.2) / 1.9), e = ((t - 0.2) % 1.9) / 1.9;
    if (t < 0.2 || seg > 4) return;
    if (seg === 0) { g.part(92, 'slope', [0, 0, 0], 0, 0, null); g.roller('a', 'marble', [-0.5 + e, 0.05, 0]); }
    if (seg === 1) { g.part(93, 'tonebars', [2, 0, 0], 0, 0, null); g.roller('b', 'bearing', [1.6 + 0.8 * e, 0.06, 0]); }
    if (seg === 2) { g.part(13, 'pane', [-2, 0, 0], 0, 0, null); g.roller('c', 'marble', [-2.4 + 0.8 * e, 0.05, 0]); }
    if (seg === 3) g.roller('d', 'marble', [-1 + 2 * e, 0.01, 1.5]);
    if (seg === 4) g.roller('r', 'bearing', [-3 + (e < 0.4 ? 2.5 * e : 1 + 9 * (e - 0.4)), 0.5, -1]);
  }, { env: 'off', slots: [[0.5, 2.0], [2.4, 3.9], [4.3, 5.8], [6.2, 7.7], [8.1, 9.6]] }));

  add(await render('fun: tonebars scale, ding, pins strike, tower collapse', 9, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const es: SimEventLike[] = [];
    for (let k = 0; k < 15; k++) if (Math.abs(t - (0.3 + k * 0.2)) < 0.5 / 60) es.push(ev(t, 'Note', 87, [-1.4 + k * 0.2, 0.3, 0], k));
    if (Math.abs(t - 3.6) < 0.5 / 60) es.push(ev(t, 'Note', 88, [0, 0.3, 0], 0));
    if (Math.abs(t - 4.6) < 0.5 / 60) es.push(ev(t, 'Impact', 88, [0.3, 0.3, 0], 1.5));
    for (let k = 0; k < 10; k++) if (Math.abs(t - (5.8 + k * 0.012)) < 0.5 / 60) es.push(ev(t, 'Impact', 300 + k, [k * 0.05, 0.1, 0], 3));
    for (let k = 0; k < 14; k++) if (Math.abs(t - (7.2 + k * 0.015)) < 0.5 / 60) es.push(ev(t, 'Impact', 400 + k, [k * 0.03, 0.1 + k * 0.05, 0], 1.5));
    if (es.length) g.onSimEvents(es, partType);
  }, { slots: [[0.3, 3.3], [3.6, 4.4], [4.6, 5.5], [5.8, 7.0], [7.2, 8.6]] }));

  // ---- Kiloton: the loudest benchmark; the limiter must peak at −1 dBTP with a smooth release ----
  const limCheck = (g: GameAudio, lim: LimiterStats[], maxV: number): string => {
    let grMax = 0, rec = 0, loud = 0;
    const grs = lim.map((s) => s.gr);
    for (let k = 0; k < grs.length; k++) {
      grMax = Math.max(grMax, grs[k]!);
      if (grs[k]! > 1) loud++;
      if (k > 0 && grs[k - 1]! > 1) rec = Math.max(rec, grs[k - 1]! - grs[k]!);
    }
    const sorted = grs.filter((x) => x > 0.05).sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)]! : 0;
    const bad: string[] = [];
    if (maxV > 64) bad.push(`voices ${maxV} > 64`);
    if (g.stats.faults) bad.push(`${g.stats.faults} faults`);
    if (rec > 4) bad.push(`fast release ${rec.toFixed(1)} dB/100 ms (pumping risk)`);
    const s = `limiter reports ${lim.length}, GR max ${grMax.toFixed(1)} dB, p95 ${p95.toFixed(1)} dB, ${(loud / 10).toFixed(1)} s over 1 dB, release ≤ ${rec.toFixed(1)} dB/100 ms, voices ${maxV}/64, leads ${g.stats.pyroLeads}, merged ${g.stats.boomsMerged}, megas ${g.stats.megas}, drops ${g.musicStats?.drops ?? 0}`;
    return bad.length ? `!${bad.join('; ')} (${s})` : s;
  };
  const kilotonRun = (name: string, listener: { pos: Vec; forward: Vec }, noWorklet = false) => {
    const plan = kilotonPlan(3, 0.5, new Rng('kiloton'));
    const debrisRng = new Rng('kiloton-debris');
    let idx = 0, maxV = 0;
    return render(name, 12, (g, t, i) => {
      if (i === 1) g.setMode('running');
      g.setPlayback(false, 1, t * 120);
      const es: SimEventLike[] = [];
      while (idx < plan.length && plan[idx]!.t <= t) { const d = plan[idx++]!; es.push(ev(d.t, 'Detonate', d.id, d.pos, d.y)); }
      // the Brik fortress coming apart: chunks hitting things while the chain runs
      if (t > 0.6 && t < 5) for (let k = 0; k < 6; k++) { const a = debrisRng.next() * 6.28, r = 3 + 12 * debrisRng.next(); es.push(ev(t, 'Impact', 200 + k, [Math.cos(a) * r, 0.1, Math.sin(a) * r], 1 + 20 * debrisRng.next())); }
      if (es.length) g.onSimEvents(es, partType);
      maxV = Math.max(maxV, g.stats.voices + g.stats.loops + g.stats.ambience);
    }, { env: 'tinker', listener, noWorklet, silentOk: [[0, 0.5], [9, 99]], check: (g, _b, lim) => limCheck(g, lim, maxV) });
  };
  add(await kilotonRun('Kiloton: 400 Bangsticks + 60 Powder Kegs, arena camera (35 m)', { pos: [0, 17, 30], forward: [0, -0.5, -0.87] }));
  add(await kilotonRun('Kiloton: inside the fortress (3 m from the nearest charges)', { pos: [0, 2, 3], forward: [0, -0.2, -1] }));
  add(await kilotonRun('Kiloton: fallback limiter (no AudioWorklet), inside', { pos: [0, 2, 3], forward: [0, -0.2, -1] }, true));

  // ---- spectacle: hitstop, slow-mo, inferred slow-mo (wall clock) ----
  let tsSeen = 1;
  add(await render('spectacle: hitstop + slow-mo + inferred slow-mo', 7, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0.6 }); g.setMode('running'); }
    // 0–2.5 s: normal playhead; 2.5–6 s: the playhead advances at 0.25× (G3's local slow-mo)
    const tick = t < 2.5 ? t * 120 : 300 + (t - 2.5) * 30;
    g.setPlayback(false, 1, tick);
    if (i === 70) { g.onSimEvents([ev(t, 'Detonate', 72, [0, 0.2, -2], 3)], partType); g.hitstop(80, 1); }
    if (i === 76) g.slowmo(0.25, 0.8);
    if (i > 76 && i < 130 && i % 6 === 0) g.onSimEvents([ev(t, 'Impact', 200 + (i % 5), [Math.sin(i) * 1.5, 0.2, -1.5], 4)], partType);
    g.loop('m', 'motor', [0.5, 0.3, 0], 1);
    if (t > 5 && t < 5.5) tsSeen = Math.min(tsSeen, g.stats.timeScale);
  }, { check: (g) => (g.stats.faults ? `!${g.stats.faults} faults` : tsSeen > 0.5 ? `!inferred time scale ${tsSeen.toFixed(2)} (expected ~0.25)` : `inferred time scale ${tsSeen.toFixed(2)}`) }));

  // ---- THE TINKER LAB ----
  const roomCam = { pos: [0, 7.15, 12.5] as Vec, forward: [0, -0.5, -0.87] as Vec };
  const deskCam = { pos: [0, 2.66, 4.63] as Vec, forward: [0, -0.45, -0.89] as Vec };
  add(await render('ambience: Tinker Lab (Room camera) 30 s', 30, (g, _t, i) => { if (i === 1) g.setVolumes({ music: 0 }); },
    { env: 'tinker', preset: 'room', listener: roomCam, silentOk: [[0, 1.5]], minPeakDb: -60, rms: { from: 3, to: 30, lo: -52, hi: -46 }, check: (g) => `ambience voices ${g.stats.ambience}` }));
  let voicesShown = 0, voicesHidden = 0;
  add(await render('ambience: Tinker Lab (Desk camera), Mochi purr then hidden', 20, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    if (t > 8 && t < 8.1) voicesShown = g.stats.ambience;
    if (i === 600) g.setAmbientMochi(false);
    if (t > 16 && t < 16.1) voicesHidden = g.stats.ambience;
  }, { env: 'tinker', preset: 'desk', listener: deskCam, silentOk: [[0, 1.5]], minPeakDb: -60, rms: { from: 3, to: 20, lo: -52, hi: -45 },
    check: () => (voicesShown - voicesHidden !== 1 ? `!ambience voices ${voicesShown} → ${voicesHidden} (Mochi purr didn't stop)` : `ambience voices ${voicesShown} → ${voicesHidden} after hiding Mochi`) }));
  add(await render('ambience: Tinker Lab build → countdown → run (ducks) → stop', 16, (g, t, i) => {
    if (i === 1) g.setVolumes({ music: 0 });
    if (i === 240) g.setMode('countdown');
    if (i === 420) g.setMode('running');
    g.setPlayback(false, 1, t * 120);
    if (t > 8 && t < 10 && i % 6 === 0) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [0, 0.1, -3], 1)], partType);
    if (i === 780) g.setMode('build');
  }, { env: 'tinker', preset: 'room', listener: roomCam, silentOk: [[0, 1.5], [8, 12]], minPeakDb: -60 }));

  // ---- music v2 ----
  add(await render('music v2: build bed 70 s (16-bar sections, stem shuffle)', 70, (g, _t, i) => { if (i === 1) g.setVolumes({ sfx: 0 }); },
    { silentOk: [[0, 1.2]], minPeakDb: -30, check: (g) => ((g.musicStats?.sections ?? 0) < 2 ? `!only ${g.musicStats?.sections ?? 0} section(s)` : `sections ${g.musicStats?.sections}`) }));
  add(await render('music v2: run, explosion density (L5) + Kiloton drop', 24, (g, t, i) => {
    if (i === 1) { g.setVolumes({ sfx: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    // a steady barrage from 3 s, then > 40 yield in 2 s at 10 s
    if (t > 3 && t < 9 && i % 5 === 0) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [Math.sin(i) * 5, 0.1, -8], 1)], partType);
    if (t > 10 && t < 11.5) g.onSimEvents([ev(t, 'Detonate', 2000 + i, [Math.sin(i) * 5, 0.1, -8], 1.2)], partType);
  }, { silentOk: [[0, 0.4]], check: (g) => ((g.musicStats?.drops ?? 0) < 1 ? '!no Kiloton drop' : `drops ${g.musicStats?.drops}, accents ${g.musicStats?.hits}, megas ${g.stats.megas}`) }));

  // ---- budget and robustness ----
  let maxV3 = 0;
  add(await render('M3 stress: voice budget', 6, (g, t, i) => {
    if (i === 1) g.setMode('running');
    g.setPlayback(false, 1, t * 120);
    const types: [string, number][] = [['lance', 1], ['mirror_splitter', 1], ['maglock', 2], ['powder_keg', 17], ['jitterjuice', 0], ['flamer', 1], ['fabricator', 2], ['zone', 0], ['skyshow', 16], ['wrecker', 0]];
    for (let k = 0; k < 30; k++) { const [ty, f] = types[k % types.length]!; g.part(600 + k, ty, [Math.sin(k) * 3 + (ty === 'wrecker' ? Math.sin(t * 3) * 2 : 0), 0.3, Math.cos(k) * 3], f, 0, rotY(t * (2 + k)), null, null); }
    for (let k = 0; k < 12; k++) g.roller(`mb${k}`, 'marble', [Math.sin(t * 2 + k) * 1.5, 0.01, Math.cos(t * 2 + k) * 1.5]);
    if (t > 1 && t < 4) g.onSimEvents([ev(t, 'Detonate', 2000 + i, [Math.sin(i) * 4, 0.1, -3], 3), ev(t, 'Impact', 300 + (i % 10), [0, 0.1, 0], 3), ev(t, 'Note', 87, [0, 0.3, 0], i % 15)], partType);
    maxV3 = Math.max(maxV3, g.stats.voices + g.stats.loops + g.stats.ambience);
  }, { env: 'tinker', check: () => (maxV3 > 64 ? `!voices peaked at ${maxV3} > 64` : `peak voices ${maxV3}/64`) }));

  add(await render('robustness M3: NaN, Infinity, bad spectacle calls', 4, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const N = Number.NaN, I = Number.POSITIVE_INFINITY;
    g.setPlayback(false, 1, t * 120);
    g.part(68, 'spindeck', [0, 0.2, 0], 0, N, i % 9 === 0 ? [N, N, N, N] : rotY(t * 3), null, [N, 0, 0]);
    g.part(69, 'lift', i % 13 === 0 ? [N, 0, 0] : [0, 0, 0], 2, I, null, null, i % 7 === 0 ? [I, 0, 0] : [0, t, 0]);
    g.part(80, 'wrecker', i % 11 === 0 ? [500, 0, 0] : [Math.sin(t) * 2, 1, 0], 0, 0, null);
    g.roller('mx', 'marble', i % 5 === 0 ? [N, 0, 0] : [Math.cos(t), 0.01, 0]);
    if (i % 20 === 0) {
      g.onSimEvents([ev(t, 'Detonate', 72, [0, 0.1, -2], N), ev(t, 'Note', 87, [0, 0.3, 0], N), ev(t, 'Burst', 74, [0, 8, -4], I), ev(t, 'Impact', 88, [0, 0.3, 0], I), ev(t, 'Detonate', 2000, [N, 0, 0], 3)], partType);
      g.hitstop(N, I); g.slowmo(N, N); g.slowmo(0.25, I); g.setWorldKey(N, 'minor');
    }
  }, { silentOk: [[0, 9]], check: (g) => (g.stats.faults > 0 ? `!${g.stats.faults} faults caught` : 'no faults') }));

  // ---------------- M4 ----------------
  await offlineM4({
    render: (n, sec, script, e) => render(n, sec, script, e as Expect), add: (r) => add(r as Result | null), slotted, atSlot, ev, partType, clip,
    result: (name, ok, note) => { if (!offlineFilter || name.toLowerCase().includes(offlineFilter.toLowerCase())) add({ name, dur: 0, peak: 0, tp: 0, rmsDb: 0, maxWinRmsDb: 0, minWinRmsDb: 0, over: 0, renderMs: 0, ok, note }); },
  });
  // ---------------- M5 ----------------
  const m5kit = {
    render: (n: string, sec: number, script: (g: GameAudio, t: number, i: number) => void, e?: Record<string, unknown>) => render(n, sec, script, e as Expect),
    add: (r: unknown) => add(r as Result | null), ev, partType, filter: () => offlineFilter, make: (share?: GameAudio) => new GameAudio(share ? { share } : {}),
    result: (name: string, ok: boolean, note: string) => { if (!offlineFilter || name.toLowerCase().includes(offlineFilter.toLowerCase())) add({ name, dur: 0, peak: 0, tp: 0, rmsDb: 0, maxWinRmsDb: 0, minWinRmsDb: 0, over: 0, renderMs: 0, ok, note }); },
  };
  await offlineM5(m5kit);
  await clipChecks(m5kit);
  await offlineBeta(m5kit); // AUDIO (beta polish, D127): repel, wall area, zones, rift phase lock, Matter in clips
  return results;
}

(window as unknown as { __GameAudio: typeof GameAudio }).__GameAudio = GameAudio;
document.getElementById('offline')!.onclick = async () => {
  offlineFilter = '';
  const r = await offline();
  (window as unknown as { __audioResults: Result[] }).__audioResults = r;
};
/** Console / automation: run the offline checks whose name contains `filter` (case-insensitive). */
(window as unknown as { __audioOffline: (f?: string) => Promise<Result[]> }).__audioOffline = async (f = '') => {
  offlineFilter = f;
  const r = await offline();
  (window as unknown as { __audioResults: Result[] }).__audioResults = r;
  return r;
};
