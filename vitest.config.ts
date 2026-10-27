import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// Beta polish: several suites start their own thread pools (the Matter CPU reference, threaded Jolt), so one test
// worker per core oversubscribed the CPU and starved Vitest's own RPC ("Timeout calling onTaskUpdate" on heavy files
// in full runs). Half the cores keeps the runner responsive; each file still runs as before.
const workers = Math.max(2, Math.floor(availableParallelism() / 2));

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    poolOptions: {
      forks: { maxForks: workers, minForks: 1 },
      threads: { maxThreads: workers, minThreads: 1 },
    },
  },
});
