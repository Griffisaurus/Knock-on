// Backlot terrain in the sim (environments.md §0.6, §4.2): one static Jolt HeightFieldShape per 32 m chunk
// (64 × 64 quads, 65 × 65 samples with shared edges, 0.5 m spacing, block size 4), built in chunk order from
// the u16 samples (format terrain.ts). Sample → metres is one IEEE multiply and divide, and Jolt quantizes each
// block the same way on every machine, so the collision surface is identical for both players.

import { f32 } from '@knockon/detmath';
import { TERRAIN_CHUNK, TERRAIN_SPACING, type TerrainRecord } from '@knockon/format';
import type { JoltModule } from '@knockon/jolt';

/** `soil` (SIMULATION §4.3, environments.md §0.6). */
const SOIL = { friction: 0.85, restitution: 0.05 } as const;

/** Chunk grid of a terrain: chunks along x and z. */
export function terrainChunks(t: TerrainRecord): { cx: number; cz: number } {
  return { cx: Math.ceil((t.nx - 1) / TERRAIN_CHUNK), cz: Math.ceil((t.nz - 1) / TERRAIN_CHUNK) };
}

/**
 * Adds the terrain's static bodies (one per chunk, chunk-row order) and returns how many it made. `layer` is the
 * sim's static object layer. The samples become metres here and nowhere else.
 */
export function buildTerrain(J: JoltModule, bi: JoltModule, t: TerrainRecord, layer: number): number {
  const { cx, cz } = terrainChunks(t);
  const n = TERRAIN_CHUNK + 1;
  const buf = new Float32Array(n * n);
  const scale = t.maxHeight / 65535;
  let made = 0;
  for (let jz = 0; jz < cz; jz++) {
    for (let jx = 0; jx < cx; jx++) {
      const x0 = jx * TERRAIN_CHUNK, z0 = jz * TERRAIN_CHUNK;
      // edge chunks repeat the last sample past the field (never happens for the 513² / 2049² lots)
      for (let z = 0; z < n; z++) {
        const sz = Math.min(t.nz - 1, z0 + z);
        for (let x = 0; x < n; x++) {
          const sx = Math.min(t.nx - 1, x0 + x);
          buf[z * n + x] = t.heights[sz * t.nx + sx]! * scale;
        }
      }
      const s = new J.HeightFieldShapeSettings();
      s.mSampleCount = n;
      s.mBlockSize = 4;
      s.mBitsPerSample = 8;
      s.mOffset = new J.Vec3(f32(t.origin[0] + x0 * TERRAIN_SPACING), 0, f32(t.origin[1] + z0 * TERRAIN_SPACING));
      s.mScale = new J.Vec3(f32(TERRAIN_SPACING), 1, f32(TERRAIN_SPACING));
      const arr = s.mHeightSamples;
      arr.resize(n * n);
      J.HEAPF32.set(buf, J.getPointer(arr.data()) >> 2);
      const res = s.Create();
      if (!res.IsValid()) throw new Error(`terrain chunk ${jx},${jz}: ${res.GetError().c_str()}`);
      const shape = res.Get();
      J.destroy(s);
      const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, layer);
      bcs.mFriction = f32(SOIL.friction);
      bcs.mRestitution = f32(SOIL.restitution);
      bcs.mUserData = 0x7fffffff;
      const body = bi.CreateBody(bcs);
      J.destroy(bcs);
      bi.AddBody(body.GetID(), J.EActivation_DontActivate);
      made++;
    }
  }
  return made;
}
