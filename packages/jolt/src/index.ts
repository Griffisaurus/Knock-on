export { DEFAULT_SCENARIO, runScenario } from './spike.ts';
export type { ScenarioOptions, ScenarioResult } from './spike.ts';
export { DEFAULT_THREADS, isJoltAbort, isJoltOom, joltHeapBytes, joltHeapHighWater, joltIsThreaded, joltThreads, loadJolt } from './load.ts'; // J5 (M5): heap high-water, aborts
export type { JoltLoadOptions, JoltModule } from './load.ts';
// J4 (M4): the buffered contact path, safe on Jolt's job threads
export { BF_CONVEYOR, BF_PERSIST, CONTACT_WORDS, CTL, CTL_WORDS, REC, contactCallbacks, contactScriptUrl } from './contacts.ts';
export type { ContactScriptParams } from './contacts.ts';
