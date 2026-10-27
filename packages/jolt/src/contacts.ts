// J4 (M4): the buffered contact path (SIMULATION §4.4, §10; D89).
//
// Jolt calls contact callbacks from whichever thread runs the narrow phase. With the multithreaded build those are
// pthread workers, each with its own JS heap: a `ContactListenerJS` made on the sim thread doesn't exist there (the
// glue's JSImplementation lookup throws, and Step aborts with "unwind"). The published build has a hook for this,
// `Module.configureWorkerScripts(url, params)`: every Jolt thread imports `url` and calls its default export with
// its own Module before it starts. So the callbacks (contact-script.js) are installed on every thread, the sim thread included,
// and do only what is safe anywhere:
//   - read the two bodies and the manifold (nothing else runs on them during the narrow phase);
//   - set a TREADWAY's surface velocity from a per-body table the sim thread writes before each step;
//   - append a fixed-size record to a buffer in the WASM heap (shared memory in the threaded build), claiming
//     its slot with an atomic counter.
// Callback order differs run to run with threads, so the Machine sorts the records canonically after the step
// (`ContactBuffer.gather`, packages/sim/src/contactbuf.ts) and only then lets the sim see them.
//
// contact-script.js must stay self-contained (no imports): every Jolt pthread imports it by URL.

/** i32/f32 words per contact record. */
export const CONTACT_WORDS = 20;
/**
 * Record layout (i32 words unless noted):
 * 0 body 1 index (user data), 1 body 2 index, 2 added (1) / persisted (0), 3 sub-shape 1, 4 sub-shape 2,
 * 5–7 body 1 linear velocity (f32), 8–10 body 2 linear velocity (f32), 11–13 normal from 1 to 2 (f32),
 * 14 body 1 inverse mass (f32, 0 unless dynamic), 15 body 2 inverse mass (f32), 16–18 contact point on 1 (f32),
 * 19 the callback's place among its body pair's callbacks this step (see `seq` below).
 */
export const REC = { i1: 0, i2: 1, added: 2, sub1: 3, sub2: 4, v1: 5, v2: 8, n: 11, inv1: 14, inv2: 15, p: 16, seq: 19 } as const;

/**
 * Control block (i32 words): 0 records written (atomic; may pass the capacity, then the extra records are lost),
 * 1 capacity (records), 2 records pointer, 3 body flags pointer (u8 per body index), 4 surface velocity pointer
 * (3 f32 per body index), 5 persisted contacts wanted at all (0/1), 6 body table size, 7 callbacks this step
 * (atomic; diagnostics only), 8 step number (written by the sim thread before each step), 9 Jolt threads started
 * (atomic; counted by the worker script).
 */
export const CTL = { count: 0, cap: 1, recs: 2, flags: 3, surf: 4, persistAny: 5, nTab: 6, calls: 7, step: 8, started: 9 } as const;
export const CTL_WORDS = 10;
/** Body flag bits: a belt surface (TREADWAY base with a non-zero speed), and wants persisted contacts. */
export const BF_CONVEYOR = 1;
export const BF_PERSIST = 2;

export type { ContactScriptParams } from './contact-script.js';
/** Installs the listener's callbacks on one thread's Module (contact-script.js; every Jolt worker thread runs it too). */
export { contactCallbacks } from './contact-script.js';

/**
 * The worker script's URL: contact-script.js as a same-origin file (the Host Server's CSP, script-src 'self', blocks
 * data: and blob: scripts). Node gets a file: URL; Vite serves the file in dev and emits it as an asset in a build.
 */
export function contactScriptUrl(): string {
  // ?no-inline: Vite would inline a file this small as a data: URL (assetsInlineLimit), which the CSP blocks
  return new URL('./contact-script.js?no-inline', import.meta.url).href;
}
