// A checkpoint's Matter record ↔ the MATR section (DATA_FORMATS §6), for desync repair (MULTIPLAYER §7.4).

import { decodeMatrSection, encodeMatrSection } from '@knockon/format';
import type { MatterCp, MatterHost } from './host.ts';
import { packOut, unpackOut } from './pack.ts';

/** The MATR payload for a checkpoint's Matter record (the snapshot's bytes may come from the GPU host). */
export function exportMatter(host: MatterHost, cp: MatterCp): Uint8Array {
  return encodeMatrSection({
    tick: cp.tick,
    snapshot: host.snapshotBytes(cp),
    results: cp.early.map(packOut),
    proxies: cp.snaps.map((s) => ({ tick: s.tick, n: s.n, rec: s.rec })),
  });
}

/** A Matter record from a partner's MATR payload. */
export function importMatter(host: MatterHost, bytes: Uint8Array): MatterCp {
  const m = decodeMatrSection(bytes);
  return host.adopt(m.tick, m.snapshot, m.results.map(unpackOut), m.proxies.map((p) => ({ tick: p.tick, n: p.n, rec: p.rec })));
}
