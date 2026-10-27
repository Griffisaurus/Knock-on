// World presets (GAME_SPEC §5.3, art/briefs/environments.md §0.2, §1.2, §4.1): bounds, part caps, the floor
// or cove they collide with, the default camera and the neutral build zone. Shared by the sim (floor size,
// Jolt capacities), the host (caps), the editor (camera, zone marks) and the benchmark harness.
// Engine space: metres, Y-up, front (default camera side) = +Z. Blender (x, y, z) → engine (x, z, −y).
// Literals only (determinism lint).

import type { V3 } from './defs.ts';

export type PresetId = 'desk' | 'room' | 'warehouse' | 'arena' | 'megastructure';

export interface WorldPreset {
  readonly id: PresetId;
  readonly name: string;
  /** W × H × D, metres. */
  readonly size: V3;
  /** Playable bounds (engine metres): x ±W/2, y 0…H, z ±D/2. */
  readonly bounds: { readonly min: V3; readonly max: V3 };
  /** Placed-part cap (GAME_SPEC §5.3) and the GB tier it needs (§15.2). */
  readonly cap: number;
  readonly minTier: 4 | 8 | 12 | 16;
  /** The Studio cove (env.ts studioCove) around the bounds, or an open floor that fades out (Megastructure). */
  readonly cove: 'studio' | 'none';
  /** Half extent of the sim's floor box (m): the bounds plus the cove run-out, so nothing falls off the world. */
  readonly floorHalf: number;
  /** Neutral build zone (flat, nothing placed by the set), engine x/z at y = 0. */
  readonly neutral: { readonly min: V3; readonly max: V3 };
  /** Default camera (orbit): target, distance (m) and elevation (degrees), looking straight front (−Z). */
  readonly camera: { readonly target: V3; readonly distance: number; readonly elevation: number };
  /** Multiplayer drone spawns P1 (−X) / P2 (+X). */
  readonly drones: readonly [V3, V3];
  /** Environments that can host this preset (GAME_SPEC §10.2); the first is the default. */
  readonly environments: readonly string[];
  /** Impostors for far parts (RENDERING §5: Arena and Megastructure only). */
  readonly impostors: boolean;
  /** Max camera orbit distance for this preset (m). */
  readonly maxCameraDistance: number;
}

export const PRESETS: Readonly<Record<PresetId, WorldPreset>> = {
  desk: {
    id: 'desk', name: 'Desk', size: [4, 3, 3], bounds: { min: [-2, 0, -1.5], max: [2, 3, 1.5] }, cap: 2_000, minTier: 4,
    cove: 'studio', floorHalf: 32, neutral: { min: [-2, 0, -1.5], max: [2, 0, 1.5] },
    camera: { target: [0, 0.3, 0], distance: 5.2, elevation: 27 },
    drones: [[-1.2, 1.6, 2.4], [1.2, 1.6, 2.4]], environments: ['studio', 'tinker'], impostors: false, maxCameraDistance: 20,
  },
  room: {
    id: 'room', name: 'Room', size: [16, 8, 16], bounds: { min: [-8, 0, -8], max: [8, 8, 8] }, cap: 20_000, minTier: 4,
    cove: 'studio', floorHalf: 64, neutral: { min: [-4, 0, -3], max: [4, 0, 5] },
    camera: { target: [0, 0.5, 1], distance: 13.3, elevation: 30 },
    drones: [[-3, 3, 9], [3, 3, 9]], environments: ['studio', 'tinker', 'kitchen', 'moon'], impostors: false, maxCameraDistance: 80, // W5 (M5): + MOON BASE
  },
  warehouse: {
    id: 'warehouse', name: 'Warehouse', size: [64, 24, 64], bounds: { min: [-32, 0, -32], max: [32, 24, 32] }, cap: 100_000, minTier: 8,
    cove: 'studio', floorHalf: 128, neutral: { min: [-8, 0, -4], max: [8, 0, 12] },
    camera: { target: [0, 1, 4], distance: 35, elevation: 30 },
    drones: [[-5, 8, 26], [5, 8, 26]], environments: ['studio', 'kitchen', 'hangar', 'moon'], impostors: false, maxCameraDistance: 200, // W5 (M5): + ORBITAL HANGAR, MOON BASE
  },
  arena: {
    id: 'arena', name: 'Arena', size: [256, 64, 256], bounds: { min: [-128, 0, -128], max: [128, 64, 128] }, cap: 400_000, minTier: 12,
    cove: 'studio', floorHalf: 320, neutral: { min: [-16, 0, -8], max: [16, 0, 24] },
    camera: { target: [0, 2, 8], distance: 78, elevation: 30 },
    drones: [[-8, 20, 60], [8, 20, 60]], environments: ['studio', 'backlot', 'hangar', 'moon'], impostors: true, maxCameraDistance: 600, // W5 (M5): + ORBITAL HANGAR, MOON BASE
  },
  megastructure: {
    // The Studio stops at Arena; on a Studio Megastructure the floor is open and fades out (no cove).
    // Camera and zone follow the Backlot's Megastructure spawn (environments.md §4.1) on a flat floor.
    id: 'megastructure', name: 'Megastructure', size: [1024, 256, 1024], bounds: { min: [-512, 0, -512], max: [512, 256, 512] }, cap: 1_000_000, minTier: 16,
    cove: 'none', floorHalf: 1024, neutral: { min: [-32, 0, -32], max: [32, 0, 32] },
    camera: { target: [0, 1, 8], distance: 104, elevation: 30 },
    drones: [[-12, 45, 80], [12, 45, 80]], environments: ['backlot', 'studio'], impostors: true, maxCameraDistance: 1600,
  },
};

export const PRESET_IDS: readonly PresetId[] = ['desk', 'room', 'warehouse', 'arena', 'megastructure'];

/** The preset record (unknown ids fall back to Room, the default). */
export function presetOf(id: string | undefined): WorldPreset {
  return (PRESETS as Readonly<Record<string, WorldPreset>>)[id ?? 'room'] ?? PRESETS.room;
}

/** Default camera eye for a preset (straight front, `elevation` degrees up): dcos/dsin-free (fixed table). */
export function presetEye(p: WorldPreset): V3 {
  // elevations used here are 27° and 30°: exact enough as constants, and keeps this file transcendental-free
  const c = p.camera.elevation === 27 ? 0.8910065241883679 : 0.8660254037844387;
  const s = p.camera.elevation === 27 ? 0.45399049973954675 : 0.5;
  const t = p.camera.target;
  return [t[0], t[1] + p.camera.distance * s, t[2] + p.camera.distance * c];
}

/** Is a point (engine metres) inside the preset's playable bounds? */
export function inBounds(p: WorldPreset, x: number, y: number, z: number): boolean {
  const b = p.bounds;
  return x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2];
}

/**
 * Jolt capacities for a run with `parts` placed parts (SIMULATION §4.1). Body count is about one per part plus
 * pre-built pieces (halves, chunks, ragdolls); pairs and contacts scale with what can be awake at once, which
 * the 10k-awake real-time ceiling bounds, but a blast can wake a whole fortress, so they scale with parts too.
 */
export function joltCapacity(parts: number, bodies: number, contacts = 0): { maxBodies: number; maxBodyPairs: number; maxContacts: number; tempBytes: number } {
  const maxBodies = Math.max(16384, bodies + 1024);
  // a running-bond brick wall has ~3.5 contacts per brick: past the limit Jolt drops contacts and bodies sink.
  // 128k contacts covers ~35k bricks awake at once (a 10k-awake real-time ceiling with room for a big blast)
  // A3 (S3 finding 1): `contacts` is the world's start-state estimate (sim capacity.ts contactEstimate); the buffers
  // cover 1.5× it. When they overflow, which contacts Jolt drops depends on state SaveState doesn't record, so a
  // rolled-back run diverges from the straight one: a face-to-face BRIK grid needs ~10 per brick, not 4.
  // M5 (J5 finding 1, verified by the orchestrator): the old caps (2^17 contacts, 2^18 pairs) overflowed once a 154k-part
  // domino wave had ~117k bodies awake, and with Jolt's job threads *which* contacts it drops varies run to run, so
  // two threaded runs diverged at 21 s (D89 broken; a co-op desync). The start-state estimate can't see contacts
  // that only form later, so the buffers scale with the parts up to CONTACTS_MAX / BODY_PAIRS_MAX: 4 contacts and 8
  // pairs per part (a toppled domino holds ~1–2, a running-bond wall ~3.5). With them the runs match bit for bit.
  const want = Math.min(CONTACTS_MAX, Math.ceil(contacts * 1.5));
  const maxBodyPairs = Math.max(16384, Math.min(BODY_PAIRS_MAX, parts * 8), want);
  const maxContacts = Math.max(8192, Math.min(CONTACTS_MAX, parts * 4), want);
  // Jolt's per-step temp allocations: the contact buffer (~496 B each) plus per-body lists; JoltJS's default is 10 MB
  const tempBytes = Math.max(10485760, maxContacts * 512 + maxBodies * 48 + (4 << 20));
  return { maxBodies, maxBodyPairs, maxContacts, tempBytes };
}

/** Above this many parts the sim sizes its own Jolt heap and keeps checkpoints in it (Machine, joltHeapMB). */
export const JOLT_BIG_WORLD = 2000;

/** A3: the most contact constraints a run's buffers are sized for (2^20: ~0.6 GB of temp buffer and caches). */
export const CONTACTS_MAX = 1 << 20;

/** M5: the most body pairs a run's cache is sized for (2^21: 128 MB at Jolt's ~64 B per pair slot). */
export const BODY_PAIRS_MAX = 1 << 21;

/** J5 (M5): the largest Jolt heap a run gets (MB): wasm32's 4 GB less the threaded loader's headroom (jolt load.ts). */
export const JOLT_HEAP_MAX_MB = 4032;

/**
 * J5 (M5): Jolt's SaveState bytes per body when every body is awake in a dense pile (measured 487–581 B: each awake body
 * saves its contact-cache entries too; a sleeping one ≈ 100 B). An in-heap checkpoint (StateRecorderImpl, a growing
 * std::stringstream) holds 1.0–1.9× its bytes (measured), so 2× is the worst case.
 */
export const JOLT_AWAKE_STATE_BYTES = 600;

/**
 * J5 (M5): Jolt WASM heap (MB) the worst case of a run with `parts` placed parts needs, uncapped: every part awake in one
 * dense pile, the rollback ring full of awake checkpoints, plus a desync-repair export and a checkpoint mid-growth on top.
 * See joltHeapMB for the measurements.
 */
export function joltHeapNeedMB(parts: number, contacts = 0): number {
  if (parts <= JOLT_BIG_WORLD) return 128;
  const cap = joltCapacity(parts, parts * 2 + 64, contacts); // as the Machine sizes it
  // the Machine's build: Jolt's temp allocator + 560 B per part (bodies, motion, shapes, broadphase, the Machine's own)
  // + 500 B per contact slot (contact constraints and caches) + 64 B per body-pair slot + 8 MB (measured on 12 worlds
  // of 2.5k–400k parts: never under, ≤ 80 MB over on a mostly static 400k-part world)
  const build = cap.tempBytes + 8 * 1048576 + parts * 560 + cap.maxContacts * 500 + cap.maxBodyPairs * 64;
  // the rollback ring of in-heap checkpoints, all awake, plus two more (a desync-repair export restores a checkpoint
  // into a second recorder; a recorder growing copies its buffer), each at the 2× worst case
  const ring = (checkpointPlan(parts).keep + 2) * 2 * JOLT_AWAKE_STATE_BYTES * parts;
  return Math.ceil((64 * 1048576 + build + ring) / 1048576 / 64) * 64; // + 64 MB: static data, stack, fragmentation
}

/**
 * Jolt WASM heap (MB) for a run with `parts` placed parts and a start-state contact estimate `contacts` (sim
 * capacity.ts; jolt load.ts `heapMB`). Worlds up to JOLT_BIG_WORLD parts keep the published builds' fixed 128 MB (their
 * checkpoints live in JS memory). Above that the heap is sized for the worst case the world can reach, every part
 * awake (joltHeapNeedMB), in 64 MB steps, capped at JOLT_HEAP_MAX_MB; a world whose worst case is bigger than that
 * runs until it really runs out, and then the sim worker stops the run with a message (J5: never a crash).
 *
 * J5 (M5) measured (docs/dev/M5_NOTES_J5.md; the heap's high-water mark, jolt `joltHeapHighWater`):
 * - **What a world costs at rest** (the Machine's build): ≈ 560 B per part + 500 B per contact slot + 64 B per body-pair
 *   slot + Jolt's temp allocator (≈ 512 B per contact slot). A dense pile's contact estimate fills the 2^20 cap from
 *   ≈ 140k parts (1.1 GB built; 400k parts 1.35 GB); a mostly static 400k-part world builds in ≈ 0.6 GB.
 * - **What each awake body costs:** ≈ 0.5 KB more in every in-heap checkpoint (600 B saved vs ≈ 100 B asleep), 1.2 KB at
 *   the recorder's 2× slack, times the ring (16 checkpoints up to 20k parts, 3–16 above: checkpointPlan) plus two: up to
 *   ≈ 22 KB per awake body at 20k–50k parts, ≈ 6 KB at 400k. Peaks measured all awake (dense pile, 8 threads; the
 *   single-threaded build ≤ 9 MB lower): 20k parts 385 MB, 50k 1,267 MB, 100k 2,141 MB, 154k 2,067 MB (fewer kept
 *   checkpoints), 400k 2,079 MB; the 154k-part domino wave 1,244 MB at 130k awake. This sizes them 704 / 1,536 /
 *   2,560 / 3,072 / 3,712 / 2,176 MB (≥ 19 % to spare). A settled (sleeping) 100k-part world peaks at ≈ 0.35 GB.
 * - The old model (256 MB + 820 B per part + checkpoints at 201 B per body) assumed a mostly sleeping world: T5's
 *   154k-part domino world ran out (`Aborted(OOM)`) at ≈ 74k awake in 640 MB.
 * The heap's size never changes results (packages/sim/test/heap.test.ts).
 */
export function joltHeapMB(parts: number, contacts = 0): number {
  return Math.min(JOLT_HEAP_MAX_MB, joltHeapNeedMB(parts, contacts));
}

/**
 * Rollback checkpoints (SIMULATION §11) for a world of `parts`: every 0.5 s and 16 kept (8 s), as since M1, up to
 * 20k parts. Bigger worlds hold every body in each checkpoint (~134 B per body, plus the recorder's buffer slack),
 * so they checkpoint every 2 s and keep what fits in 256 MB, never fewer than 3 (a ≥ 6 s window, past
 * the 4 s bake-ahead a late poke can reach back across).
 */
export function checkpointPlan(parts: number): { every: number; keep: number; bytes: number } {
  const bytes = parts * 134 * 1.5; // measured: 134 B per body in Jolt's SaveState, about one body per part
  if (parts <= 20_000) return { every: 60, keep: 16, bytes };
  return { every: 240, keep: Math.max(3, Math.min(16, Math.floor(256e6 / bytes))), bytes };
}
