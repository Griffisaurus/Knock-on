// Matter layer (SIMULATION §8): deterministic integer particles (sand, water, marbles), two-way coupled with the rigid
// sim through proxies. This entry point is Node-safe (contract, constants, CPU reference, WGSL sources, tick prep);
// the WebGPU backend is `@knockon/matter/gpu`. The M0 spike lives on in `@knockon/matter/spike`.

export * from './backend.ts';
export * from './constants.ts';
export { MatterCpu, checksumHex } from './cpu.ts';
export { encodeMatr, decodeMatr, finishChecksum } from './payload.ts';
export type { MatrState } from './payload.ts';
export { prepareTick, pbucket } from './prep.ts';
export type { TickPack } from './prep.ts';
export { idiv, isqrt, damp, fmix32, mixK, ucell, cellTag, rowHash, grainHash, grainHash2, normDist } from './imath.ts';
