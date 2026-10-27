export { Machine, PartFlagBits } from './machine.ts';
export type { BodyInfo, EventKind, MachineOptions, Poke, SimEvent } from './machine.ts';
// critters (stream B): test/soak-only extra lures (MachineOptions.extraLures)
export type { ExtraLure } from './critters/system.ts';
// M2 contract 2 (stream A): the per-tick Sound list and Lure emitters
export type { LureEmitter, Sound } from './machine.ts';
export { GUTTERS } from './channels/gutter.ts';
// A3: Jolt contact buffers sized from the world (the worker sizes its heap with it too)
export { contactEstimate } from './capacity.ts';
export { rotationToQuat } from './rotation.ts';
export type { Quat } from './rotation.ts';
export { roundPath } from './vec.ts';
// MI (M4): the Matter layer (machine.matter, contract 2) and what the browser's links and hosts need
export { DEFAULT_WORLD_SEED, MatterHost, matterSeed, volumeMl } from './matter/host.ts';
export type { MatterCp, MatterOptions, MatterSt, SimFlags } from './matter/host.ts';
export type { MatterBackend, MatterBackendSync, MatterKind, MatterProxy, MatterStepIn, MatterStepOut } from './matter/contract.ts';
export { isSyncBackend } from './matter/contract.ts';
export { SyncBackendLink, snapshotTick } from './matter/link.ts';
export type { MatterLink, MatterSnapRef } from './matter/link.ts';
export { packIn, packOut, unpackIn, unpackOut } from './matter/pack.ts';
export { FISHBOWL, SCOOP } from './matter/parts.ts';
export { matterCapacity, matterGrains, partGrains } from './matter/budget.ts';
export { sandstorm } from './matter/sandstorm.ts';
export type { SandstormOptions, SandstormWorld } from './matter/sandstorm.ts';
