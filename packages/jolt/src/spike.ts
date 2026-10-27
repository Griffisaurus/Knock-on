// M0 determinism spike (PRODUCTION §2 M0, SIMULATION §3, §10–11).
// Builds a canonical scene, steps it, and hashes exact float bits. Run the same scenario in Node
// and in every browser (single- and multi-threaded builds): all hashes must match.

import { Hasher, Rng, toHex64 } from '@knockon/detmath';

// Minimal structural typing over the jolt-physics module so this file works with any build flavour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

export interface ScenarioOptions {
  readonly ticks: number;
  readonly hashEvery: number;
  readonly towers: number; // towers of 0.1 m boxes
  readonly towerHeight: number;
  readonly balls: number;
  readonly workerThreads?: number; // multithread builds only
  /** Save state at this tick, finish the run, then restore and re-run to compare (rollback check). */
  readonly rollbackAt?: number;
}

export const DEFAULT_SCENARIO: ScenarioOptions = { ticks: 600, hashEvery: 60, towers: 36, towerHeight: 10, balls: 40 };

export interface ScenarioResult {
  readonly hashes: string[]; // one per hashEvery ticks
  readonly final: string;
  readonly rollbackMatches: boolean | null;
  readonly bodies: number;
  readonly ms: number;
}

const LAYER_STATIC = 0;
const LAYER_MOVING = 1;
const DT = 1 / 120;

export function runScenario(Jolt: J, opts: ScenarioOptions = DEFAULT_SCENARIO): ScenarioResult {
  const t0 = performance.now();
  const settings = new Jolt.JoltSettings();
  // JoltPhysics.js uses a fixed-size temp allocator, so contact/pair limits must stay modest;
  // production sizing per tier is a packages/jolt custom-build setting (SIMULATION §3).
  settings.mMaxBodies = 4096;
  settings.mMaxBodyPairs = 8192;
  settings.mMaxContactConstraints = 4096;
  if (opts.workerThreads !== undefined) settings.mMaxWorkerThreads = opts.workerThreads;
  const pairFilter = new Jolt.ObjectLayerPairFilterTable(2);
  pairFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING);
  pairFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  const bpStatic = new Jolt.BroadPhaseLayer(0);
  const bpMoving = new Jolt.BroadPhaseLayer(1);
  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, bpStatic);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, bpMoving);
  settings.mObjectLayerPairFilter = pairFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 2, pairFilter, 2);
  const jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const system = jolt.GetPhysicsSystem();
  const bi = system.GetBodyInterface();
  system.SetGravity(new Jolt.Vec3(0, -9.81, 0));

  const bodies: J[] = [];
  const add = (shape: J, x: number, y: number, z: number, dynamic: boolean, restitution: number, friction: number): void => {
    const cs = new Jolt.BodyCreationSettings(
      shape, new Jolt.RVec3(Math.fround(x), Math.fround(y), Math.fround(z)), new Jolt.Quat(0, 0, 0, 1),
      dynamic ? Jolt.EMotionType_Dynamic : Jolt.EMotionType_Static, dynamic ? LAYER_MOVING : LAYER_STATIC,
    );
    cs.mRestitution = restitution;
    cs.mFriction = friction;
    if (dynamic) cs.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    const body = bi.CreateBody(cs);
    Jolt.destroy(cs);
    bi.AddBody(body.GetID(), dynamic ? Jolt.EActivation_Activate : Jolt.EActivation_DontActivate);
    if (dynamic) bodies.push(body);
  };

  // Canonical creation order (SIMULATION §3): ground, towers row-major, then balls.
  add(new Jolt.BoxShape(new Jolt.Vec3(10, 0.5, 10), 0.05, null), 0, -0.5, 0, false, 0.1, 0.7);
  const side = Math.ceil(Math.sqrt(opts.towers));
  const box = new Jolt.BoxShape(new Jolt.Vec3(0.05, 0.05, 0.05), 0.005, null);
  for (let t = 0; t < opts.towers; t++) {
    const tx = (t % side) * 0.3 - side * 0.15;
    const tz = Math.floor(t / side) * 0.3 - side * 0.15;
    for (let h = 0; h < opts.towerHeight; h++) add(box, tx, 0.05 + h * 0.1, tz, true, 0.25, 0.5);
  }
  const rng = new Rng(0xC0FFEE, 7);
  const ball = new Jolt.SphereShape(0.11);
  for (let b = 0; b < opts.balls; b++) {
    add(ball, rng.range(-1.5, 1.5), 1.5 + rng.range(0, 2), rng.range(-1.5, 1.5), true, 0.5, 0.4);
  }
  system.OptimizeBroadPhase();

  const hashState = (): string => {
    const h = new Hasher();
    const f = new Float64Array(7);
    const bytes = new Uint8Array(f.buffer);
    for (const body of bodies) {
      const p = body.GetPosition();
      const q = body.GetRotation();
      f[0] = p.GetX(); f[1] = p.GetY(); f[2] = p.GetZ();
      f[3] = q.GetX(); f[4] = q.GetY(); f[5] = q.GetZ(); f[6] = q.GetW();
      h.bytes(bytes);
    }
    return toHex64(h.digest());
  };

  const hashes: string[] = [];
  let saved: J = null;
  let tail: string[] = [];
  for (let tick = 1; tick <= opts.ticks; tick++) {
    jolt.Step(DT, 1);
    if (opts.rollbackAt === tick) {
      saved = new Jolt.StateRecorderImpl();
      system.SaveState(saved, Jolt.EStateRecorderState_All);
    }
    if (tick % opts.hashEvery === 0) {
      const hsh = hashState();
      hashes.push(hsh);
      if (opts.rollbackAt !== undefined && tick > opts.rollbackAt) tail.push(hsh);
    }
  }
  const final = hashes.at(-1) ?? hashState();

  let rollbackMatches: boolean | null = null;
  if (saved && opts.rollbackAt !== undefined) {
    saved.Rewind();
    system.RestoreState(saved);
    const replay: string[] = [];
    for (let tick = opts.rollbackAt + 1; tick <= opts.ticks; tick++) {
      jolt.Step(DT, 1);
      if (tick % opts.hashEvery === 0) replay.push(hashState());
    }
    rollbackMatches = replay.length === tail.length && replay.every((x, i) => x === tail[i]);
    Jolt.destroy(saved);
    tail = [];
  }

  const count = bodies.length;
  Jolt.destroy(jolt);
  return { hashes, final, rollbackMatches, bodies: count, ms: performance.now() - t0 };
}
