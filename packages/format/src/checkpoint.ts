// Checkpoints on the wire (DATA_FORMATS §6, MULTIPLAYER §7.4 desync repair): a `KNCP` container.
//   JOLT  Jolt StateRecorder bytes (EStateRecorderState::All)
//   ECS   the Machine's plain run state (behaviour, channel, RNG and event-cause state), UTF-8 JSON
//   MATR  Matter state (only on checkpoints that carry a Matter snapshot): see encodeMatrSection
// Sections are deflated by the container, which matters for repair: client → host messages are capped at
// MAX_CHECKPOINT_BYTES (net protocol).

import { ByteReader, ByteWriter, FormatError } from './bytes.ts';
import { Codec, decodeContainer, encodeContainer, section, type Section } from './container.ts';

export interface CheckpointBlob {
  readonly tick: number;
  readonly jolt: Uint8Array;
  /** The run state, UTF-8 JSON. */
  readonly state: Uint8Array;
  /** The MATR payload (encodeMatrSection), when the checkpoint carries Matter. */
  readonly matr?: Uint8Array;
  /** Header extras (simVersion, runId, worldHash, tier, flags; DATA_FORMATS §6). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export function encodeCheckpoint(cp: CheckpointBlob, codec: Codec = Codec.Deflate): Uint8Array {
  const sections: Section[] = [{ tag: 'JOLT', data: cp.jolt }, { tag: 'ECS ', data: cp.state }];
  if (cp.matr) sections.push({ tag: 'MATR', data: cp.matr });
  return encodeContainer({ magic: 'KNCP', flags: 0, header: { ...(cp.meta ?? {}), tick: cp.tick }, sections }, codec);
}

export function decodeCheckpoint(bytes: Uint8Array): CheckpointBlob {
  const c = decodeContainer(bytes);
  if (c.magic !== 'KNCP') throw new FormatError('not a checkpoint');
  const tick = c.header.tick;
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) throw new FormatError('checkpoint tick');
  const jolt = section(c, 'JOLT'), state = section(c, 'ECS ');
  if (!jolt || !state) throw new FormatError('checkpoint missing JOLT or ECS');
  const matr = section(c, 'MATR');
  const { tick: _t, ...meta } = c.header;
  return { tick, jolt, state, ...(matr ? { matr } : {}), meta };
}

// ---- MATR (DATA_FORMATS §6) ------------------------------------------------------------------------------------

export const MATR_SECTION_VERSION = 1;
/** Matter grains a MATR section may describe (the 32 GB tier's 8M, GAME_SPEC §15.2). */
export const MATR_MAX_SNAPSHOT_BYTES = 8_000_000 * 32;

/**
 * The MATR section of a checkpoint: the backend's own MATR payload (MX backend.ts: positions, velocities, materials,
 * counters) wrapped with what the rigid–Matter coupling needs to resume at exactly this tick:
 *   u16 version · u32 tick (rigid tick of the checkpoint)
 *   snapshot: u32 length · bytes (the backend's snapshot(), MX's MTR1 layout)
 *   results:  u16 count · per result: u32 length (i32 words) · i32[] (computed, not yet applied: sim matter/pack.ts)
 *   proxies:  u16 count · per snapshot: i32 rigid tick · u32 proxies · u32 length (i32 words) · i32[]
 */
export interface MatrSection {
  readonly tick: number;
  readonly snapshot: Uint8Array;
  readonly results: readonly Int32Array[];
  readonly proxies: readonly { readonly tick: number; readonly n: number; readonly rec: Int32Array }[];
}

export function encodeMatrSection(m: MatrSection): Uint8Array {
  let words = 0;
  for (const r of m.results) words += r.length;
  for (const p of m.proxies) words += p.rec.length;
  const w = new ByteWriter(32 + m.snapshot.length + words * 4 + (m.results.length + m.proxies.length) * 12);
  w.u16(MATR_SECTION_VERSION).u32(m.tick).u32(m.snapshot.length).bytes(m.snapshot);
  w.u16(m.results.length);
  for (const r of m.results) { w.u32(r.length); for (let i = 0; i < r.length; i++) w.u32(r[i]! >>> 0); }
  w.u16(m.proxies.length);
  for (const p of m.proxies) { w.u32(p.tick >>> 0).u32(p.n).u32(p.rec.length); for (let i = 0; i < p.rec.length; i++) w.u32(p.rec[i]! >>> 0); }
  return w.finish();
}

export function decodeMatrSection(bytes: Uint8Array): MatrSection {
  const r = new ByteReader(bytes);
  const v = r.u16();
  if (v !== MATR_SECTION_VERSION) throw new FormatError(`MATR version ${v}`);
  const tick = r.u32();
  const sl = r.u32();
  if (sl > MATR_MAX_SNAPSHOT_BYTES || sl > r.remaining) throw new FormatError('MATR snapshot size');
  const snapshot = r.bytes(sl).slice();
  const words = (): Int32Array => {
    const n = r.u32();
    if (n * 4 > r.remaining) throw new FormatError('MATR length');
    const a = new Int32Array(n);
    for (let i = 0; i < n; i++) a[i] = r.u32() | 0;
    return a;
  };
  const nr = r.u16();
  if (nr > 8) throw new FormatError('MATR results');
  const results: Int32Array[] = [];
  for (let i = 0; i < nr; i++) results.push(words());
  const np = r.u16();
  if (np > 16) throw new FormatError('MATR proxies');
  const proxies: { tick: number; n: number; rec: Int32Array }[] = [];
  for (let i = 0; i < np; i++) { const t = r.u32() | 0; const n = r.u32(); proxies.push({ tick: t, n, rec: words() }); }
  if (r.remaining !== 0) throw new FormatError('trailing bytes in MATR');
  return { tick, snapshot, results, proxies };
}
