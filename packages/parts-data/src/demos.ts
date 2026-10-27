// Per-part demo machines (PART_SYSTEM §6): a tiny machine (≤ 30 parts, ≤ 3 s at 120 Hz) per part
// type and per link kind, showing its main interaction. They are the Library hover demos and the
// per-part golden machines (packages/sim/test/goldens.test.ts), so they are plain world data.
//
// @knockon/format is not a dependency of this package, so its two dependency-free modules are
// imported by path (types, metresToPos, makeId, snappedEuler).

import { makeId, type LinkKind, type LinkRecord, type PartRecord } from '../../format/src/model.ts';
import { metresToPos, snappedEuler, type Rotation } from '../../format/src/quantize.ts';
import { partDef, propSteps, type V3 } from './defs.ts';
import { critterDemos } from './critters.ts';
import { m3Demos } from './defs_m3.ts';
import { m4Demos } from './defs_m4.ts'; // A4
import { m5Demos } from './defs_m5.ts'; // A5
import { m5MatterDemos } from './defs_m5_matter.ts'; // X5

export interface DemoCamera {
  /** Orbit target, metres. */
  readonly target: readonly [number, number, number];
  /** Orbit distance, metres. */
  readonly dist: number;
  /** Radians about +Y; 0 looks from +Z (the parts' front) toward −Z. */
  readonly yaw: number;
  /** Radians above the horizon. */
  readonly pitch: number;
}

export interface DemoMachine {
  readonly parts: readonly PartRecord[];
  readonly links: readonly LinkRecord[];
  readonly camera: DemoCamera;
  /** Ticks to run at 120 Hz (≤ 360). */
  readonly ticks: number;
}

/** Demo limits (PART_SYSTEM §6). */
export const DEMO_MAX_PARTS = 30;
export const DEMO_MAX_TICKS = 360;

class Demo {
  readonly parts: PartRecord[] = [];
  readonly links: LinkRecord[] = [];
  private n = 0;

  /** `flags`: PartRecord flags (32 = anchored; M3 POPPER demo). */
  add(type: string, at: V3, props: Readonly<Record<string, number>> = {}, rot: Rotation = snappedEuler(0, 0, 0), flags = 0): number {
    const def = partDef(type);
    if (!def) throw new Error(`demo: unknown part ${type}`);
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v)).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(at[0]), metresToPos(at[1]), metresToPos(at[2])], rot, flags, ...(list.length ? { props: list } : {}) });
    return id;
  }

  link(kind: LinkKind, from: number, fromPort: string, to: number, toPort: string): number {
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: { part: from, port: this.port(from, fromPort) }, to: { part: to, port: this.port(to, toPort) }, via: [], points: [], length: 0 });
    return id;
  }

  /** A path link with no ports (TUBE, GUTTER), through points in metres. */
  path(kind: LinkKind, pts: readonly V3[]): number {
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: null, to: null, via: [], points: pts.map((p) => [metresToPos(p[0]), metresToPos(p[1]), metresToPos(p[2])] as const), length: 0 });
    return id;
  }

  /** A FUSE from a free end (its first point, metres) to a part's heat port. */
  fuseFrom(start: V3, to: number, toPort: string): number {
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind: 'fuse', from: null, to: { part: to, port: this.port(to, toPort) }, via: [], points: [[metresToPos(start[0]), metresToPos(start[1]), metresToPos(start[2])]], length: 0 });
    return id;
  }

  private port(id: number, name: string): number {
    const p = this.parts.find((q) => q.id === id);
    const i = p ? partDef(p.type)!.ports.findIndex((x) => x.name === name) : -1;
    if (i < 0) throw new Error(`demo: no port ${name} on part ${id}`);
    return i;
  }

  /** Frames the parts' positions from the front-right, slightly above. */
  done(ticks: number, cam: Partial<DemoCamera> = {}): DemoMachine {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts) for (let k = 0; k < 3; k++) { const v = p.pos[k]! / 640; lo[k] = Math.min(lo[k]!, v); hi[k] = Math.max(hi[k]!, v); }
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const target: [number, number, number] = [r2((lo[0]! + hi[0]!) / 2), r2((lo[1]! + hi[1]!) / 2 + 0.1), r2((lo[2]! + hi[2]!) / 2)];
    const span = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
    return {
      parts: this.parts, links: this.links, ticks,
      camera: { target, dist: r2(Math.min(4.5, Math.max(1.2, span * 1.5 + 0.6))), yaw: 0.6, pitch: 0.45, ...cam },
    };
  }
}

const upright = snappedEuler(0, 90, 0); // a PLANK stood on end
const across = snappedEuler(90, 0, 0); // a BRIK turned to lie along Z

function build(): Record<string, DemoMachine> {
  const D: Record<string, DemoMachine> = {};

  // ---- Rollers ----------------------------------------------------------------------------------
  {
    // THUD rolls down a SLOPE and knocks over a PLANK stood on end
    const d = new Demo();
    d.add('slope', [0, 0, 0]);
    d.add('thud', [0.15, 0.4, 0]);
    d.add('plank', [-0.65, 0.5, 0], {}, upright);
    D.thud = d.done(360);
  }
  {
    // BOING dropped from 1 m bounces back up most of the way
    const d = new Demo();
    d.add('boing', [0, 1.0, 0]);
    D.boing = d.done(240, { target: [0, 0.5, 0], dist: 1.8 });
  }
  {
    // STITCH: a small hard ball drops onto a SLOPE, bounces and rolls away
    const d = new Demo();
    d.add('slope', [0, 0, 0]);
    d.add('stitch', [0.1, 0.8, 0]);
    D.stitch = d.done(300, { target: [-0.3, 0.3, 0] });
  }
  {
    // HELIO floats up and pops on the teeth of a COG above it
    const d = new Demo();
    d.add('helio', [0, 0.3, 0]);
    d.add('cog', [0, 1.2, 0], { size: 2 });
    D.helio = d.done(300);
  }

  // ---- Frame ------------------------------------------------------------------------------------
  {
    // a three-course BRIK wall stands firm until a BANGSTICK (lit by a WICK and a FUSE) cracks
    // its mortar and throws it down
    const d = new Demo();
    for (let row = 0; row < 3; row++) {
      const xs = row % 2 === 0 ? [-0.3, -0.1, 0.1, 0.3] : [-0.2, 0, 0.2];
      for (const x of xs) d.add('brik', [x, 0.05 + row * 0.1, 0]);
    }
    const stick = d.add('bangstick', [-0.1, 0.039, 0.35], { fuse: 0.5 });
    const wick = d.add('wick', [0.2, 0, 0.45]);
    d.link('fuse', wick, 'flame', stick, 'fuse');
    D.brik = d.done(300, { yaw: 0.9 });
  }
  {
    // a PLANK bridges two LEDGEs; a THUD dropped from high up snaps it in two
    const d = new Demo();
    d.add('ledge', [-0.4, 0.3, 0]);
    d.add('ledge', [0.4, 0.3, 0]);
    d.add('plank', [0, 0.4, 0], {}, snappedEuler(90, 0, 0));
    d.add('thud', [0, 2.5, 0]);
    D.plank = d.done(240, { target: [0, 0.8, 0], dist: 2.6 });
  }
  {
    // a steep SLOPE sends a BOING rolling away
    const d = new Demo();
    d.add('slope', [0, 0, 0], { angle: 30 });
    d.add('boing', [0.05, 0.41, 0]);
    D.slope = d.done(300, { target: [-0.4, 0.2, 0] });
  }
  {
    // a LEDGE holds a THUD up in the air; a BOING bounces off it
    const d = new Demo();
    d.add('ledge', [0, 0.4, 0]);
    d.add('thud', [0, 0.57, 0]);
    d.add('boing', [0.12, 1.2, 0.1]);
    D.ledge = d.done(300);
  }
  {
    // FULCRUM: a BOING on the left end, a THUD lands on the right end and the beam tips
    const d = new Demo();
    d.add('fulcrum', [0, 0.065, 0]);
    d.add('boing', [-0.24, 0.23, 0]);
    d.add('thud', [0.24, 0.9, 0]);
    D.fulcrum = d.done(300);
  }
  {
    // ANCHOR: a HELIO on a LINE stays put
    const d = new Demo();
    const a = d.add('anchor', [0, 0, 0]);
    const h = d.add('helio', [0, 0.6, 0]);
    d.link('line', h, 'knot', a, 'hook');
    D.anchor = d.done(240, { target: [0, 0.35, 0], dist: 1.4 });
  }
  {
    // SHEAVE: a HELIO pulls a rope over a pulley and lifts the left end of a FULCRUM
    const d = new Demo();
    const f = d.add('fulcrum', [0, 0.065, 0]);
    const s = d.add('sheave', [-0.28, 0.8, 0.027]);
    const h = d.add('helio', [0.15, 1.1, 0.044]);
    d.link('line', f, 'end_l', s, 'axle');
    d.link('line', h, 'knot', s, 'axle');
    D.sheave = d.done(300);
  }

  // ---- Drive ------------------------------------------------------------------------------------
  {
    // TREADWAY: MAINS → MOTOR → BAND turns the belt; a BRIK rides along +X
    const d = new Demo();
    const mains = d.add('mains', [-0.9, 0, 0.35]);
    const motor = d.add('motor', [-0.5, 0, 0.35]);
    const belt = d.add('treadway', [0, 0, 0]);
    d.add('brik', [-0.2, 0.15, 0]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', belt, 'drive_l');
    D.treadway = d.done(300, { target: [-0.2, 0.15, 0.1] });
  }
  {
    // COG: a motor-driven COG S turns a meshed COG M (half speed) and COG L (a third), both
    // the other way
    const d = new Demo();
    const mains = d.add('mains', [-0.8, 0, 0]);
    const motor = d.add('motor', [-0.4, 0, 0]);
    const s = d.add('cog', [0.1, 0.35, 0], { size: 0 });
    d.add('cog', [0.25, 0.35, 0], { size: 1 });
    d.add('cog', [-0.1, 0.35, 0], { size: 2 });
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', s, 'axle');
    D.cog = d.done(240);
  }
  {
    // MOTOR: powered by MAINS, it spins a COG through a BAND (set to CCW)
    const d = new Demo();
    const mains = d.add('mains', [-0.5, 0, 0]);
    const motor = d.add('motor', [0, 0, 0], { direction: 1 });
    const cog = d.add('cog', [0.5, 0.4, 0], { size: 2 });
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', cog, 'axle');
    D.motor = d.done(240);
  }

  // ---- Air --------------------------------------------------------------------------------------
  {
    // GALE: blows a BOING away and puts out a WICK
    const d = new Demo();
    const mains = d.add('mains', [-0.5, 0, 0]);
    const fan = d.add('gale', [0, 0, 0]);
    d.add('boing', [0, 0.12, 0.6]);
    d.add('wick', [0, 0, 1.2]);
    d.link('cable_power', mains, 'out', fan, 'in');
    D.gale = d.done(240, { yaw: 1.2 });
  }

  // ---- Power and signal -------------------------------------------------------------------------
  {
    // MAINS starts off; a THUD on THE BUTTON switches it on and the GALE starts blowing
    const d = new Demo();
    const mains = d.add('mains', [-0.5, 0, 0], { on: 0 });
    const fan = d.add('gale', [0, 0, 0]);
    d.add('boing', [0, 0.12, 0.5]);
    const button = d.add('the_button', [-0.9, 0, 0]);
    d.add('thud', [-0.9, 0.4, 0]);
    d.link('cable_power', mains, 'out', fan, 'in');
    d.link('cable_signal', button, 'out', mains, 'in');
    D.mains = d.done(300, { yaw: 1.0 });
  }
  {
    // STOMP PAD (2 kg): a BOING is too light, a THUD presses it and the BANGSTICK goes off
    const d = new Demo();
    const light = d.add('stomp_pad', [-0.15, 0, 0], { weight: 2 });
    const heavy = d.add('stomp_pad', [0.15, 0, 0], { weight: 2 });
    d.add('boing', [-0.15, 0.4, 0]);
    d.add('thud', [0.15, 0.4, 0]);
    const stick = d.add('bangstick', [0.15, 0.039, 0.8]);
    d.link('cable_signal', light, 'out', stick, 'detonator');
    d.link('cable_signal', heavy, 'out', stick, 'detonator');
    D.stomp_pad = d.done(240);
  }
  {
    // THE BUTTON: a THUD lands on it and the signal sets off a BANGSTICK next to some bricks
    const d = new Demo();
    const button = d.add('the_button', [0, 0, 0]);
    d.add('thud', [0, 0.4, 0]);
    const stick = d.add('bangstick', [0.6, 0.039, 0]);
    d.add('brik', [0.95, 0.05, 0], {}, across);
    d.add('brik', [0.95, 0.15, 0], {}, across);
    d.link('cable_signal', button, 'out', stick, 'detonator');
    D.the_button = d.done(240);
  }

  // ---- Fire and boom ----------------------------------------------------------------------------
  {
    // WICK: its flame burns through one of the two LINEs holding a HELIO, which swings free
    const d = new Demo();
    const a1 = d.add('anchor', [-0.4, 0, 0]);
    const a2 = d.add('anchor', [0.4, 0, 0]);
    const h = d.add('helio', [0, 0.772, 0]);
    d.add('wick', [-0.28, 0, 0.024]);
    d.link('line', h, 'knot', a1, 'hook');
    d.link('line', h, 'knot', a2, 'hook');
    D.wick = d.done(360);
  }
  {
    // BANGSTICK: a WICK lights its fuse stub through a short FUSE; the blast sets off a second
    // stick nearby and throws a little wall
    const d = new Demo();
    const wick = d.add('wick', [0, 0, 0]);
    const a = d.add('bangstick', [-0.14, 0.039, 0.2], { fuse: 0.5 });
    d.add('bangstick', [-0.14, 0.039, 0.7]);
    for (let row = 0; row < 2; row++) for (const x of [-0.3, -0.1, 0.1]) d.add('brik', [x + (row % 2) * 0.1, 0.05 + row * 0.1, 1.0]);
    d.link('fuse', wick, 'flame', a, 'fuse');
    D.bangstick = d.done(300, { yaw: 1.0 });
  }

  // ---- Contraptions -----------------------------------------------------------------------------
  {
    // SNIPPER: a THUD on THE BUTTON closes the blades; the cut LINE lets a HELIO float away
    const d = new Demo();
    const snip = d.add('snipper', [0.3, 0, 0]);
    const hook = d.add('anchor', [0.4, 0.036, 0]);
    const h = d.add('helio', [0.4, 0.7, 0]);
    const button = d.add('the_button', [-0.3, 0, 0]);
    d.add('thud', [-0.3, 0.4, 0]);
    d.link('line', h, 'knot', hook, 'hook');
    d.link('cable_signal', button, 'out', snip, 'close');
    D.snipper = d.done(360, { target: [0.05, 0.6, 0], dist: 2.2 });
  }

  // ---- Fun --------------------------------------------------------------------------------------
  {
    // TOPPLE TILES: a THUD rolls off a SLOPE into a row of ten
    const d = new Demo();
    d.add('slope', [0, 0, 0]);
    d.add('thud', [0.15, 0.4, 0]);
    for (let i = 0; i < 10; i++) d.add('topple_tile', [-0.5 - i * 0.1, 0.075, 0]);
    D.topple_tile = d.done(360);
  }

  // ---- Links ------------------------------------------------------------------------------------
  {
    // LINE: a HELIO tied to the left end of a FULCRUM tips the beam up
    const d = new Demo();
    const f = d.add('fulcrum', [0, 0.065, 0]);
    const h = d.add('helio', [-0.28, 0.6, 0.044]);
    d.link('line', h, 'knot', f, 'end_l');
    D.line = d.done(240);
  }
  {
    // BAND: the MOTOR turns a COG across the room at its own speed
    const d = new Demo();
    const mains = d.add('mains', [-0.8, 0, 0]);
    const motor = d.add('motor', [-0.4, 0, 0]);
    const cog = d.add('cog', [0.5, 0.6, 0]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', cog, 'axle');
    D.band = d.done(240);
  }
  {
    // FUSE: a WICK lights a FUSE that burns to a BANGSTICK
    const d = new Demo();
    const wick = d.add('wick', [0, 0, 0]);
    const stick = d.add('bangstick', [-0.14, 0.039, 0.33], { fuse: 0.5 });
    d.add('brik', [0.3, 0.05, 0.33], {}, across);
    d.add('brik', [0.3, 0.15, 0.33], {}, across);
    d.link('fuse', wick, 'flame', stick, 'fuse');
    D.fuse = d.done(300, { yaw: 1.0 });
  }
  {
    // CABLE (signal): one STOMP PAD wired to two BANGSTICKs sets both off together
    const d = new Demo();
    const pad = d.add('stomp_pad', [0, 0, 0]);
    d.add('thud', [0, 0.4, 0]);
    const s1 = d.add('bangstick', [-0.9, 0.039, 0]);
    const s2 = d.add('bangstick', [0.9, 0.039, 0]);
    d.link('cable_signal', pad, 'out', s1, 'detonator');
    d.link('cable_signal', pad, 'out', s2, 'detonator');
    D.cable_signal = d.done(240);
  }
  {
    // CABLE (power): one MAINS runs a MOTOR (turning a COG) and a GALE (blowing a BOING)
    const d = new Demo();
    const mains = d.add('mains', [0, 0, 0]);
    const motor = d.add('motor', [0.5, 0, 0]);
    const cog = d.add('cog', [1.0, 0.35, 0]);
    const fan = d.add('gale', [-0.5, 0, 0]);
    d.add('boing', [-0.5, 0.12, 0.5]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('cable_power', mains, 'out', fan, 'in');
    d.link('band', motor, 'out', cog, 'axle');
    D.cable_power = d.done(240);
  }
  // ---- M2 machine parts (stream A) --------------------------------------------------------------
  {
    // FUZZ: dropped on a steep SLOPE, it grips and rolls away instead of sliding
    const d = new Demo();
    d.add('slope', [0, 0, 0], { angle: 30 });
    d.add('fuzz', [0.12, 0.45, 0]);
    D.fuzz = d.done(300, { target: [-0.3, 0.2, 0] });
  }
  {
    // PIG IRON rolls down a SLOPE and knocks over a PLANK stood on end
    const d = new Demo();
    d.add('slope', [0, 0, 0]);
    d.add('pig_iron', [0.15, 0.36, 0]);
    d.add('plank', [-0.65, 0.5, 0], {}, upright);
    D.pig_iron = d.done(360);
  }
  {
    // VORTEX: a STITCH dropped onto the bowl rolls to the middle and drops out underneath
    const d = new Demo();
    d.add('vortex', [0, 0.45, 0]);
    d.add('stitch', [0.24, 1.2, 0.08]);
    D.vortex = d.done(360, { target: [0, 0.6, 0], dist: 2.2 });
  }
  {
    // SPRONG: a BOING dropped from 1 m comes back up higher than it started
    const d = new Demo();
    d.add('sprong', [0, 0, 0]);
    d.add('boing', [0, 1.0, 0]);
    D.sprong = d.done(300, { target: [0, 0.6, 0], dist: 2.2 });
  }
  {
    // SCOOP: a HELIO tied to the empty bucket's handle slowly lifts it
    const d = new Demo();
    const s = d.add('scoop', [0, 0, 0]);
    const h = d.add('helio', [0, 0.62, 0]);
    d.link('line', h, 'knot', s, 'bail');
    D.scoop = d.done(360, { target: [0, 0.6, 0], dist: 2.0 });
  }
  {
    // FLAP: two STITCHes wait on the latched trapdoor; a THUD on THE BUTTON opens it and they drop
    const d = new Demo();
    const flap = d.add('flap', [0, 0.5, -0.13]);
    d.add('stitch', [-0.05, 0.551, 0]);
    d.add('stitch', [0.05, 0.551, 0.03]);
    const button = d.add('the_button', [-0.5, 0, 0]);
    d.add('thud', [-0.5, 0.4, 0]);
    d.link('cable_signal', button, 'out', flap, 'in');
    D.flap = d.done(300, { target: [-0.2, 0.4, 0] });
  }
  {
    // DYNAMO: MAINS → MOTOR → BAND spins the DYNAMO, which powers a LAMP
    const d = new Demo();
    const mains = d.add('mains', [-0.9, 0, 0]);
    const motor = d.add('motor', [-0.5, 0, 0]);
    const dyn = d.add('dynamo', [0, 0, 0.3]);
    const lamp = d.add('lamp', [0.45, 0, 0.3]);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', dyn, 'in');
    d.link('cable_power', dyn, 'out', lamp, 'in');
    D.dynamo = d.done(300);
  }
  {
    // TURBINE: a GALE on a LEDGE blows on its face and the rotor spins up
    const d = new Demo();
    const mains = d.add('mains', [-0.5, 0, -0.2]);
    d.add('ledge', [0, 0.08, 0]);
    const fan = d.add('gale', [0, 0.13, 0]);
    d.add('turbine', [0, 0, 0.7], {}, snappedEuler(180, 0, 0));
    d.link('cable_power', mains, 'out', fan, 'in');
    D.turbine = d.done(360, { yaw: 1.2 });
  }
  {
    // PUFFER: a THUD lands on the pad and the puff blows out a WICK
    const d = new Demo();
    d.add('puffer', [0, 0, 0]);
    d.add('thud', [-0.03, 0.55, 0]);
    d.add('wick', [0.6, 0, 0]);
    D.puffer = d.done(240);
  }
  {
    // CELL: a battery powers a LAMP and a MOTOR (its charge bar drops as it works)
    const d = new Demo();
    const cell = d.add('cell', [0, 0, 0], { capacity: 5 });
    const lamp = d.add('lamp', [0.3, 0, 0]);
    const motor = d.add('motor', [-0.35, 0, 0]);
    d.link('cable_power', cell, 'out', lamp, 'in');
    d.link('cable_power', cell, 'out', motor, 'in');
    D.cell = d.done(300);
  }
  {
    // SUNCELL: a TORCH shining down on the panel powers a MOTOR that spins a COG
    const d = new Demo();
    const sun = d.add('suncell', [0, 0, 0]);
    d.add('torch', [-0.035, 0.5, 0], { on: 1 }, snappedEuler(0, 0, -90));
    const motor = d.add('motor', [0.5, 0, 0]);
    const cog = d.add('cog', [0.95, 0.35, 0]);
    d.link('cable_power', sun, 'out', motor, 'in');
    d.link('band', motor, 'out', cog, 'axle');
    D.suncell = d.done(300);
  }
  {
    // LAMP: MAINS lights the bulb; its light on a SUNCELL runs a GALE that blows a BOING away
    const d = new Demo();
    const mains = d.add('mains', [-0.5, 0, 0]);
    const lamp = d.add('lamp', [0, 0, 0]);
    const sun = d.add('suncell', [0, 0, 0.25]);
    const fan = d.add('gale', [0.5, 0, 0.25]);
    d.add('boing', [0.5, 0.12, 0.8]);
    d.link('cable_power', mains, 'out', lamp, 'in');
    d.link('cable_power', sun, 'out', fan, 'in');
    D.lamp = d.done(300);
  }
  {
    // TORCH: a THUD on THE BUTTON switches it on; its beam lands on a SUNCELL and a LAMP lights
    const d = new Demo();
    const button = d.add('the_button', [-0.5, 0, 0]);
    d.add('thud', [-0.5, 0.4, 0]);
    const torch = d.add('torch', [-0.035, 0.5, 0], {}, snappedEuler(0, 0, -90));
    const sun = d.add('suncell', [0, 0, 0]);
    const lamp = d.add('lamp', [0.4, 0, 0]);
    d.link('cable_signal', button, 'out', torch, 'in');
    d.link('cable_power', sun, 'out', lamp, 'in');
    D.torch = d.done(240);
  }
  {
    // BURNING GLASS: a TORCH switched on by THE BUTTON shines through the lens; the hot spot pops a HELIO
    const d = new Demo();
    d.add('burning_glass', [0, 0, 0]);
    const torch = d.add('torch', [0, 0.19, -0.3], {}, snappedEuler(-90, 0, 0));
    const button = d.add('the_button', [-0.5, 0, -0.3]);
    d.add('thud', [-0.5, 0.4, -0.3]);
    const a = d.add('anchor', [0, 0, 0.425]);
    const h = d.add('helio', [0, 0.245, 0.425]);
    d.link('cable_signal', button, 'out', torch, 'in');
    d.link('line', h, 'knot', a, 'hook');
    D.burning_glass = d.done(240, { yaw: 1.3 });
  }
  {
    // TOGGLE: a STITCH drops on the lever, flips it on, and the MAINS power reaches the GALE
    const d = new Demo();
    const mains = d.add('mains', [-0.4, 0, 0]);
    const tog = d.add('toggle', [0, 0, 0]);
    const fan = d.add('gale', [0.4, 0, 0]);
    d.add('stitch', [-0.06, 0.5, 0]);
    d.add('boing', [0.4, 0.12, 0.5]);
    d.link('cable_power', mains, 'out', tog, 'in');
    d.link('cable_power', tog, 'out_power', fan, 'in');
    D.toggle = d.done(300);
  }
  {
    // RINGER: after 1 s it rings and its signal sets off a BANGSTICK
    const d = new Demo();
    const ring = d.add('ringer', [0, 0, 0], { time: 1 });
    const stick = d.add('bangstick', [0.6, 0.039, 0]);
    d.link('cable_signal', ring, 'out', stick, 'detonator');
    D.ringer = d.done(240);
  }
  {
    // DELAY: THE BUTTON's signal waits 1 s in the DELAY, then sets off a BANGSTICK
    const d = new Demo();
    const button = d.add('the_button', [-0.4, 0, 0]);
    d.add('thud', [-0.4, 0.4, 0]);
    const delay = d.add('delay', [0, 0, 0], { delay: 1 });
    const stick = d.add('bangstick', [0.6, 0.039, 0]);
    d.link('cable_signal', button, 'out', delay, 'in');
    d.link('cable_signal', delay, 'out', stick, 'detonator');
    D.delay = d.done(300);
  }
  {
    // T-PLUNGER: a THUD lands on the handle and both wired BANGSTICKs go off at once
    const d = new Demo();
    const tp = d.add('t_plunger', [0, 0, 0]);
    d.add('thud', [0, 0.65, 0]);
    const s1 = d.add('bangstick', [-0.8, 0.039, 0.4]);
    const s2 = d.add('bangstick', [0.8, 0.039, 0.4]);
    d.link('cable_signal', tp, 'out', s1, 'detonator');
    d.link('cable_signal', tp, 'out', s2, 'detonator');
    D.t_plunger = d.done(240);
  }
  {
    // SKYROCKET: a WICK lights a short FUSE; after its stub the rocket flies straight up
    const d = new Demo();
    const wick = d.add('wick', [0.12, 0, 0.03]);
    const rocket = d.add('skyrocket', [0, 0.12, 0], { fuse: 0.2 });
    d.link('fuse', wick, 'flame', rocket, 'fuse');
    D.skyrocket = d.done(360, { target: [0, 1.2, 0], dist: 4 });
  }
  {
    // BIG TOP: a BOING sits loaded in the barrel; a WICK and a FUSE light the touch-hole and it fires
    const d = new Demo();
    const top = d.add('big_top', [0, 0, 0]);
    d.add('boing', [0.1224, 0.216, 0]);
    const wick = d.add('wick', [-0.2, 0, 0.36]);
    d.link('fuse', wick, 'flame', top, 'fuse');
    D.big_top = d.done(360, { target: [1.0, 0.6, 0], dist: 3.5 });
  }
  {
    // CORK BLASTER: THE BUTTON fires the cork, which pops a HELIO tied in front of it
    const d = new Demo();
    d.add('ledge', [0, 0.25, 0]);
    const cb = d.add('cork_blaster', [0, 0.3, 0]);
    const button = d.add('the_button', [-0.5, 0, 0]);
    d.add('thud', [-0.5, 0.4, 0]);
    const a = d.add('anchor', [0.8, 0, 0]);
    const h = d.add('helio', [0.8, 0.36, 0]);
    d.link('cable_signal', button, 'out', cb, 'fire');
    d.link('line', h, 'knot', a, 'hook');
    D.cork_blaster = d.done(240);
  }
  {
    // PUNCHLINE: THE BUTTON triggers the glove, which punches a BOING across the floor
    const d = new Demo();
    const pl = d.add('punchline', [0, 0, 0]);
    const button = d.add('the_button', [-0.5, 0, 0]);
    d.add('thud', [-0.5, 0.4, 0]);
    d.add('boing', [0.42, 0.12, 0]);
    d.link('cable_signal', button, 'out', pl, 'trigger');
    D.punchline = d.done(240);
  }
  {
    // GOTCHA BOX: a MOTOR cranks it three turns; the head pops up and bonks a PLANK stood in front
    const d = new Demo();
    const mains = d.add('mains', [-0.8, 0, 0]);
    const motor = d.add('motor', [-0.4, 0, 0]);
    const box = d.add('gotcha_box', [0, 0, 0]);
    d.add('plank', [0, 0.5, 0.215], {}, upright);
    d.link('cable_power', mains, 'out', motor, 'in');
    d.link('band', motor, 'out', box, 'crank');
    D.gotcha_box = d.done(360);
  }
  {
    // GUTTER: a STITCH rolls down an open half-pipe and drops off the end
    const d = new Demo();
    d.add('stitch', [-0.6, 0.6, 0]);
    d.path('gutter', [[-0.7, 0.5, 0], [0.4, 0.25, 0], [0.8, 0.2, 0.3]]);
    D.gutter = d.done(300, { target: [0.1, 0.4, 0.1] });
  }
  // M3 parts and the GLIDEPATH link (stream A3, defs_m3.ts)
  Object.assign(D, m3Demos(() => new Demo()));
  // M4 parts (stream A4, defs_m4.ts)
  Object.assign(D, m4Demos(() => new Demo()));
  // M5 parts (stream A5, defs_m5.ts)
  Object.assign(D, m5Demos(() => new Demo()));
  // GOO VAT (stream X5, defs_m5_matter.ts)
  Object.assign(D, m5MatterDemos(() => new Demo()));
  // critters and the critter-bound devices (stream B, critters.ts)
  Object.assign(D, critterDemos(() => new Demo()));
  return D;
}

/** Keyed by part type id (every PART) and link kind (line, band, fuse, cable_signal, cable_power). */
export const DEMOS: Readonly<Record<string, DemoMachine>> = build();
