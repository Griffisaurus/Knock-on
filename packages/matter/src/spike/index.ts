// The M0 Matter spike (M0_STATUS "Matter spike"), kept unchanged as a legacy reference for
// apps/game/src/spike-matter.ts. Production Matter is the package root (backend.ts, cpu.ts, gpu/).

export * from './constants.ts';
export { idiv, isqrt, damp, cellKey, neighbourKey, fmix32, mixK, grainHash } from './imath.ts';
export { initialState, latticeSide } from './init.ts';
export type { MatterState } from './init.ts';
export { MatterCpu, checksumOf, checksumHex } from './cpu.ts';
export type { Checksum } from './cpu.ts';
export { MATTER_WGSL, WG, SCAN_CHUNK } from './wgsl.ts';
export type { KernelName } from './wgsl.ts';
