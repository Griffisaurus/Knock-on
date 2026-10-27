// Shared audio types: the director (index.ts) hands the M2 sub-directors (mech.ts, critters.ts, ambience.ts)
// a small host interface instead of its internals.

export type Vec3 = readonly [number, number, number];

/** Voice families (AUDIO.md §2 concurrency classes). */
export type Family = 'impact' | 'roll' | 'mech' | 'pyro' | 'tail' | 'fx' | 'ui' | 'critter' | 'step' | 'amb';

/** Continuous sources. Each maps to `loop/<variant>` in the bank (see index.ts loopParams). */
export type LoopKind =
  | 'fuse' | 'motor' | 'fan' | 'flame' | 'roll'
  // M2 mechanisms
  | 'dynamo' | 'turbine' | 'filament' | 'shimmer' | 'cell' | 'sizzle' | 'ringer' | 'delay' | 'thrust' | 'crank'
  | 'bubbles' | 'wheel' | 'chain' | 'spiral'
  // M2 critters
  | 'purr' | 'snore' | 'patter' | 'pedal'
  // M3 parts (m3.ts) and the pyro barrage bed (pyro.ts)
  | 'lance' | 'burn' | 'prism' | 'maghum' | 'marble' | 'rail' | 'spindeck' | 'liftmotor' | 'ratchet'
  | 'flamer' | 'fizz' | 'cook' | 'chaincreak' | 'swingair' | 'fabhum' | 'zone' | 'barrage'
  // M4 parts, critters and Matter fallback beds (params in m4.ts M4_LOOPS)
  | M4LoopKind
  // M5 parts (m5.ts M5_LOOPS) and BUZZ (buzz.ts BUZZ_LOOPS)
  | M5LoopKind;

/** M4 loop kinds (m4.ts M4_LOOPS): parts, the BISCUIT / HENNY / DUSTY loops (critters.ts), the Matter fallback beds (matter.ts). */
export type M4LoopKind = 'pour' | 'hourglass' | 'fill' | 'sprinkle' | 'waterwheel' | 'dripwet' | 'slurp' | 'feed' | 'dryer' | 'airrush' | 'suction'
  | 'gashiss' | 'tesla' | 'corona' | 'toast' | 'yolkroll' | 'zippy'
  | 'pant' | 'roost' | 'drive' | 'vacuum' | 'binrattle' | 'matter';

/** M5 loop kinds: the parts (m5.ts M5_LOOPS) and BUZZ's rotors and winch (buzz.ts BUZZ_LOOPS). */
export type M5LoopKind = 'rift' | 'grav_attract' | 'grav_repel' | 'tractor' | 'tractor_load' | 'hover' | 'hover_flutter' | 'wall' | 'coil_hum' | 'stasis'
  | 'sing_pull' | 'servo' | 'rotor' | 'winch';

export interface PlayOpts {
  family: Family; pos: Vec3 | null; when: number; gain: number;
  rate?: number; prio?: number; key?: string; maxDist?: number;
  /** M3 pyro: far-field compensation (big blasts carry: ×(d/3 m)^0.85, up to +18 dB), the near field is unchanged. */
  farComp?: boolean;
}
export interface LoopOpts {
  /** Secondary control (e.g. Dynamo load → gain while ω sets pitch). */
  aux?: number;
  /** Bank variant (`loop/<variant>`) when it differs from the kind, e.g. `roll/tube`. */
  variant?: string;
  /** Apply a doppler-ish pitch shift from the source's motion relative to the listener. */
  doppler?: boolean;
  /** Panner reference distance (m) when it isn't 1 (M3: the barrage bed is a big, wide source). */
  ref?: number;
  /**
   * Beta (D127): loops with the same sync key play one shared source (each keeps its own filter, gain and panner), so
   * they share one phase: a RIFT GATE pair hums as one system. Members should be given the same level and aux.
   */
  sync?: string;
}

export interface AudioHost {
  play(name: string, var01: number, o: PlayOpts): boolean;
  loop(id: string, kind: LoopKind, pos: Vec3, level: number, o?: LoopOpts): void;
  /** AudioContext time. */
  now(): number;
  /** Current run tick (for hashing per-event variation so replays sound the same). */
  tick(): number;
  listener(): Vec3;
  /** Feed the music/ambience intensity integrator. */
  heat(x: number): void;
}

/** Common event shape (SIMULATION §9 + M2 contract 1: id, cause and other are optional so M1 events still fit). */
export interface SimEventLike {
  tick: number; kind: string; part: number; pos: readonly [number, number, number]; mag: number;
  id?: number; cause?: number; other?: number;
}

/** A jump longer than this between samples is a teleport (camera cut, respawn, scrub), not motion. */
export const TELEPORT_M = 2;

/**
 * Estimates velocity from positions sampled once per render frame. Transforms only change when the sim worker
 * posts a frame, so identical samples accumulate time until the position actually moves. Non-finite samples are
 * ignored and teleports reset the velocity to zero, so `vel` and `speed` are always finite.
 */
export class Motion {
  pos: [number, number, number];
  vel: [number, number, number] = [0, 0, 0];
  speed = 0;
  private acc = 0;
  constructor(p: Vec3) { this.pos = [p[0], p[1], p[2]]; }
  update(p: Vec3, dt: number): void {
    if (!finite3(p)) return;
    this.acc += Number.isFinite(dt) && dt > 0 ? dt : 0;
    const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
    if (!finite3(this.pos) || Math.hypot(dx, dy, dz) > TELEPORT_M) { this.reset(p); return; }
    if (dx === 0 && dy === 0 && dz === 0) {
      // nothing moved: decay toward rest once we've waited longer than a worker frame
      if (this.acc > 0.12) { this.vel = [0, 0, 0]; this.speed = 0; }
      return;
    }
    const t = Math.max(this.acc, 1 / 240);
    const k = 0.5; // light smoothing
    this.vel = [this.vel[0] + (dx / t - this.vel[0]) * k, this.vel[1] + (dy / t - this.vel[1]) * k, this.vel[2] + (dz / t - this.vel[2]) * k];
    this.speed = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    if (!Number.isFinite(this.speed)) { this.reset(p); return; }
    this.pos = [p[0], p[1], p[2]];
    this.acc = 0;
  }
  reset(p: Vec3): void { this.pos = [p[0], p[1], p[2]]; this.vel = [0, 0, 0]; this.speed = 0; this.acc = 0; }
}

/** Clamp that never returns NaN (NaN → a); ±Infinity clamp to the bounds. Every value bound for an AudioParam goes through it. */
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x >= a ? x : a);
/** x if finite, else the fallback. */
export const fin = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);
export const finite3 = (p: Vec3): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
