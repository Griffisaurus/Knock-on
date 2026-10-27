// A local test server for the perf harness (M3_PLAN rule 3): its own port and data folder, no static files.
//   node --disable-warning=ExperimentalWarning apps/game/bench/host.ts      (KN_BENCH_HOST, KNOCKON_DATA override)
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KNOCKON_PORT = process.env.KN_BENCH_HOST ?? '8795';
process.env.KNOCKON_DATA ??= join(tmpdir(), 'knockon-bench-host');
process.env.KNOCKON_STATIC = 'none';
await import('../../host/src/main.ts');
