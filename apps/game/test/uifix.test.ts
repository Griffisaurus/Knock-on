// UIFIX (beta polish, D122): pure logic behind the playtest fixes (playtests/2026-10-25-autoplay.md bugs 2–9).

import { describe, expect, it } from 'vitest';
import { makeId, metresToPos, snappedEuler, type PartRecord } from '@knockon/format';
import { CameraRig, type CamEvent, type CameraContext } from '../src/cameras.ts';
import { av1SeqSize } from '../src/capture/codecs.ts';
import { calibrate, DEFAULT_COST, drawMs, frameMs } from '../src/capture/estimate.ts';
import { buildReport, inCascade } from '../src/cascade.ts';
import { KoMeter } from '../src/ui/feed.ts';
import { zoneFromLocal, zoneTarget, ZONE_PROPS } from '../src/ui/m5tools.ts';
import { radialKeyUp, RADIAL_TAP_MS } from '../src/ui/panels.ts';
import { partDef } from '../src/catalog.ts';
import type { V3 } from '../src/math.ts';

// ---- fix 1: the offline render drives the Director as live does --------------------------------------------------

function rigWith(): { rig: CameraRig; run: { phase: string; tick: number; tickRate: number; bodies: never[]; transforms: Float32Array; onEvents(fn: (e: readonly CamEvent[]) => void): void }; feed: (e: CamEvent[]) => void } {
  let fn: (e: readonly CamEvent[]) => void = () => {};
  const run = { phase: 'running', tick: 0, tickRate: 120, bodies: [] as never[], transforms: new Float32Array(0), onEvents(f: (e: readonly CamEvent[]) => void) { fn = f; } };
  const ctx: CameraContext = { run, parts: () => [], poseOf: () => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1] }) as never, selected: () => [], hover: () => null };
  const rig = new CameraRig({ yaw: 0, pitch: 0.5, dist: 5, target: [0, 0, 0], trauma: 0 }, ctx);
  rig.setMode('director');
  return { rig, run, feed: (e) => fn(e) };
}

/** Two stations 10 m apart: a burst at A at 1 s and a bigger one at B at 6 s (the playtest's "stations"). */
const STATIONS: CamEvent[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ tick: 120 + i, kind: 'Break', part: 10 + i, pos: [-5, 0.2, 0], mag: 1, id: i + 1, cause: i ? i : -1 })),
  ...Array.from({ length: 8 }, (_, i) => ({ tick: 720 + i, kind: 'Detonate', part: 30 + i, pos: [5, 0.2, 0], mag: 4, id: 20 + i, cause: -1 })),
];

/** Plays `evs` through the rig at 30 fps from `from` to `to` seconds, the worker's way (events once their tick passes). */
function play(r: ReturnType<typeof rigWith>, evs: readonly CamEvent[], from: number, to: number): { t: number; x: number }[] {
  const out: { t: number; x: number }[] = [];
  let last = Math.round(from * 120);
  for (let f = 0; from + f / 30 <= to; f++) {
    const tick = Math.round((from + f / 30) * 120);
    r.run.tick = tick;
    const due = evs.filter((e) => e.tick > last && e.tick <= tick);
    if (tick < last) last = tick; else last = tick;
    if (due.length) r.feed(due);
    const s = r.rig.update(1 / 30, f * 33);
    out.push({ t: tick / 120, x: s.target[0] });
  }
  return out;
}

describe('fix 1: Director in an offline render (bug 2)', () => {
  it('live, the director cuts from station A to station B', () => {
    const r = rigWith();
    const shots = play(r, STATIONS, 0, 8);
    expect(shots.find((s) => s.t > 1.5 && s.t < 2)!.x).toBeLessThan(-3);
    expect(shots.at(-1)!.x).toBeGreaterThan(3);
  });

  it('rewound to the clip start, restart() makes it cut again exactly as live (it held the last live shot before)', () => {
    const live = rigWith();
    const liveShots = play(live, STATIONS, 0, 8);
    // the "offline render": the same rig after the live run, rewound to 0 by the capture
    const r = rigWith();
    play(r, STATIONS, 0, 12);
    r.rig.restart([]);
    const off = play(r, STATIONS, 0, 8);
    expect(off.map((s) => s.x.toFixed(4))).toEqual(liveShots.map((s) => s.x.toFixed(4)));
  });

  it('a clip that starts mid-run is handed the events before its start (restart(history))', () => {
    const r = rigWith();
    play(r, STATIONS, 0, 12);
    r.rig.restart(STATIONS.filter((e) => e.tick <= 700));
    expect(r.rig.directorState.events).toBe(6);
    const off = play(r, STATIONS, 700 / 120, 8);
    expect(off.at(-1)!.x).toBeGreaterThan(3);
  });

  it('a plain scrub back (no restart) no longer freezes the director until the old cut time', () => {
    const r = rigWith();
    play(r, STATIONS, 0, 12);
    const off = play(r, STATIONS, 0, 8);
    expect(off.find((s) => s.t > 1.5 && s.t < 2)!.x).toBeLessThan(-3);
    expect(off.at(-1)!.x).toBeGreaterThan(3);
  });
});

// ---- fix 2: radial menu, hold Q, point, let go -------------------------------------------------------------------

describe('fix 2: radial key-up (bug 4)', () => {
  it('a chosen wedge runs on release', () => expect(radialKeyUp(900, 3)).toBe('run'));
  it('a quick tap keeps it open for the arrows and Enter', () => expect(radialKeyUp(RADIAL_TAP_MS - 50, -1)).toBe('sticky'));
  it('a hold let go over the centre cancels', () => expect(radialKeyUp(RADIAL_TAP_MS + 200, -1)).toBe('cancel'));
  it('even a quick flick to a wedge runs it', () => expect(radialKeyUp(120, 0)).toBe('run'));
});

// ---- fix 3: GRABBER zone pointing ----------------------------------------------------------------------------------

const part = (type: string, at: V3, id = 5): PartRecord => ({ id: makeId(1, id), type, pos: [metresToPos(at[0]), metresToPos(at[1]), metresToPos(at[2])], rot: snappedEuler(0, 0, 0), flags: 0 });

describe('fix 3: GRABBER "Point zone A" at a part (bug 5)', () => {
  it('a STITCH is pointed at by its centre and its contact height, not its top', () => {
    const stitch = part('stitch', [0.3, 0.0375, 0.1]);
    const hitTop: V3 = [0.31, 0.075, 0.1]; // the ray hits the ball's top
    const w = zoneTarget(hitTop, stitch);
    expect(w[0]).toBeCloseTo(0.3, 5);
    expect(w[2]).toBeCloseTo(0.1, 5);
    expect(w[1]).toBeCloseTo(0, 3); // it rests on the floor: zone height 0, as the default zone that picks it up
    const def = partDef('grabber')!;
    const z = zoneFromLocal(def, ZONE_PROPS.grabber!.a, w);
    expect(z.aHeight).toBe(0);
  });
  it('a static part (a LEDGE to put things on) keeps the surface point', () => {
    const ledge = part('ledge', [0.3, 0.1, 0.1]);
    const hit: V3 = [0.32, 0.15, 0.12];
    expect(zoneTarget(hit, ledge)).toEqual(hit);
  });
  it('the floor (no part) keeps the point', () => expect(zoneTarget([1, 0, 2], null)).toEqual([1, 0, 2]));
});

// ---- fix 5: capture size and estimate ------------------------------------------------------------------------------

/** An AV1 sequence header OBU (as encoders emit it) with these max frame dimensions. */
function seqObu(w: number, h: number, levelIdx = 8): Uint8Array {
  const bits: number[] = [];
  const put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(0, 3); put(0, 1); put(0, 1); // profile, still, reduced
  put(0, 1); put(0, 1); put(0, 5); // timing info, initial display delay, one operating point
  put(0, 12); put(levelIdx, 5); if (levelIdx > 7) put(0, 1);
  put(10, 4); put(10, 4); put(w - 1, 11); put(h - 1, 11);
  put(0, 1); put(0, 1); // frame_id_numbers_present, … (rest padded)
  while (bits.length % 8) bits.push(0);
  const payload = Uint8Array.from({ length: bits.length / 8 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => a * 2 + b, 0));
  return Uint8Array.from([0x0a, payload.length, ...payload]);
}

describe('fix 5: clip size and time estimate (bug 3)', () => {
  it('reads the frame size an AV1 sequence header declares (the hardware encoder coded 1088 lines for 1080p)', () => {
    expect(av1SeqSize(seqObu(1920, 1088, 12))).toEqual({ w: 1920, h: 1088 });
    expect(av1SeqSize(seqObu(1920, 1080))).toEqual({ w: 1920, h: 1080 });
    // the bytes NVENC wrote in the playtest's 1080p clip (header 12 00, then this sequence header OBU)
    expect(av1SeqSize(Uint8Array.from([0x0a, 0x0c, 0x00, 0x00, 0x00, 0x66, 0xab, 0xbf, 0xc3, 0xfe, 0x00, 0x10, 0xcc, 0x02]))).toEqual({ w: 1920, h: 1088 });
    // libaom's, for the same request
    expect(av1SeqSize(Uint8Array.from([0x0a, 0x0e, 0x00, 0x00, 0x00, 0x42, 0xab, 0xbf, 0xc3, 0x74, 0x06, 0x88, 0x08, 0x68, 0x08, 0x20]))).toEqual({ w: 1920, h: 1080 });
    expect(av1SeqSize(Uint8Array.from([0x12, 0x00]))).toBeNull(); // a temporal delimiter
  });

  it('the default estimate is in line with the playtest render (1500 frames of 1080p30 MP4 in 79 s)', () => {
    const ms = frameMs(DEFAULT_COST, 1.6, 1920, 1080, 1920 * 1080, 'mp4');
    const s = (1500 * ms) / 1000;
    expect(s).toBeGreaterThan(79 * 0.8);
    expect(s).toBeLessThan(79 * 1.25);
  });

  it('a measured render calibrates the next estimate (first sample replaces the default, later ones blend)', () => {
    const draw = drawMs(2, 1280, 720, 1920 * 1080, 'mp4');
    const m1 = calibrate(DEFAULT_COST, 'mp4', 900 * 40, 900, draw);
    expect(frameMs(m1, 2, 1280, 720, 1920 * 1080, 'mp4')).toBeCloseTo(40, 6);
    const m2 = calibrate(m1, 'mp4', 900 * 60, 900, draw);
    expect(frameMs(m2, 2, 1280, 720, 1920 * 1080, 'mp4')).toBeCloseTo(40 * 0.4 + 60 * 0.6, 6);
    expect(m2.samples.mp4).toBe(2);
    expect(m2.residual.gif).toBe(DEFAULT_COST.residual.gif);
    expect(calibrate(m2, 'mp4', 0, 0, draw)).toBe(m2);
  });
});

// ---- fix 7: one K.O. count -------------------------------------------------------------------------------------------

describe('fix 7: the HUD K.O. and the Cascade Report K.O. agree (bug 9)', () => {
  // a chain: BUTTON(1) → DELAY(2) → BANGSTICK(3) breaks two BRIKs (4, 5); sounds and emotes are not steps; a repeat
  // edge counts once; part 0 is the world
  const evs = [
    { id: 1, tick: 10, kind: 'Press', part: 1, cause: -1, pos: [0, 0, 0] as const, mag: 1 },
    { id: 2, tick: 11, kind: 'Signal', part: 2, cause: 1, pos: [0, 0, 0] as const, mag: 1 },
    { id: 3, tick: 12, kind: 'Sound', part: 3, cause: 2, pos: [0, 0, 0] as const, mag: 1 },
    { id: 4, tick: 130, kind: 'Detonate', part: 3, cause: 2, pos: [0, 0, 0] as const, mag: 3 },
    { id: 5, tick: 131, kind: 'Break', part: 4, cause: 4, pos: [0, 0, 0] as const, mag: 1 },
    { id: 6, tick: 132, kind: 'Break', part: 5, cause: 4, pos: [0, 0, 0] as const, mag: 1 },
    { id: 7, tick: 140, kind: 'Impact', part: 5, cause: 4, pos: [0, 0, 0] as const, mag: 9 },
    { id: 8, tick: 141, kind: 'Emote', part: 6, cause: 7, pos: [0, 0, 0] as const, mag: 1 },
    { id: 9, tick: 150, kind: 'Impact', part: 0, cause: 6, pos: [0, 0, 0] as const, mag: 1 },
  ];

  it('counts the same knock-on steps as the report', () => {
    const k = new KoMeter();
    for (const e of evs) k.add(e);
    const r = buildReport(evs, { tickRate: 120, partsTotal: 6, linked: () => false });
    expect(r.ko).toBe(4); // 1>2, 2>3, 3>4, 3>5
    expect(k.count).toBe(r.ko);
  });

  it('shows the count at the playhead, and replayed events (scrub back, rollback) are not counted twice', () => {
    const k = new KoMeter();
    for (const e of evs) k.add(e);
    for (const e of evs) k.add(e); // replayed with the same ids
    expect(k.count).toBe(4);
    expect(k.countAt(11)).toBe(1);
    expect(k.countAt(130)).toBe(2);
    expect(k.lastSecond(140, 120)).toBe(3); // (20, 140]: 2>3, 3>4, 3>5
    k.reset();
    expect(k.count).toBe(0);
  });

  it('the filter both use', () => {
    expect(inCascade({ kind: 'Sound', part: 3 })).toBe(false);
    expect(inCascade({ kind: 'Break', part: 0 })).toBe(false);
    expect(inCascade({ kind: 'Break', part: 3 })).toBe(true);
  });
});

// ---- fix 8: undo right after an edit --------------------------------------------------------------------------------

describe('fix 8: an undo never overtakes the edit it undoes', () => {
  it('goes out behind ops still queued by the 150 ops/s window, so the host sees them in order', async () => {
    const { NetClient } = await import('../src/net.ts');
    const { DocStore } = await import('@knockon/docstore');
    const net = new NetClient(16, 'test');
    const sent: string[] = [];
    (net as unknown as { send: (m: [string, unknown]) => void }).send = (m) => { sent.push(m[0]); };
    net.store = new DocStore(1);
    // a burst has used this second's window: the next edit waits in the queue
    (net as unknown as { opWindow: { second: number; sent: number } }).opWindow = { second: Math.floor(performance.now() / 1000), sent: 150 };
    const p = part('thud', [0, 0.11, 0], 1);
    expect(net.submit({ k: 'PartAdd', part: p })).toBe(true);
    expect(sent).toEqual([]);
    net.undo();
    expect(net.store.doc.parts.size).toBe(0); // undone locally at once
    expect(sent).toEqual([]); // and not sent ahead of the queued edit
    (net as unknown as { opWindow: { second: number; sent: number } }).opWindow = { second: -1, sent: 0 };
    (net as unknown as { flushOps(): void }).flushOps();
    expect(sent.length).toBe(2);
    expect(net.store.pendingCount).toBe(2);
    // the acks come back in send order: the edit's, then the undo's (out of order used to throw)
    const ids = (net.store as unknown as { pending: { clientOpId: string }[] }).pending.map((x) => x.clientOpId);
    expect(() => { net.store!.onAck(ids[0]!, 1); net.store!.onAck(ids[1]!, 2); }).not.toThrow();
    const t = (net as unknown as { opTimer: ReturnType<typeof setTimeout> | null }).opTimer;
    if (t) clearTimeout(t);
  });
});

// ---- PARTSIM hand-off: BUZZ's startle reads as one --------------------------------------------------------------

describe('BUZZ startle tag (PARTSIM D121 → UIFIX)', () => {
  it('"Buzz: startled!" while startled; the same "!" setting off on a job stays "alarmed!"', async () => {
    const { emoteText } = await import('../src/ui/captions.ts');
    const { CRITTER_EMOTES, CRITTER_FSM } = await import('@knockon/parts-data');
    const bang = CRITTER_EMOTES.indexOf('!' as never);
    expect(emoteText('BUZZ', bang, CRITTER_FSM.indexOf('startled' as never))).toBe('Buzz: startled!');
    expect(emoteText('BUZZ', bang, CRITTER_FSM.indexOf('takeoff' as never))).toBe('Buzz: alarmed!');
    expect(emoteText('PIP', bang, CRITTER_FSM.indexOf('wheel_startled' as never))).toBe('Pip: startled!');
    expect(emoteText('MOCHI', bang)).toBe('Mochi: alarmed!');
  });
});
