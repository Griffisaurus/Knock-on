// Wire protocol (MULTIPLAYER §10). Every message is a MessagePack `[type, payload]` array.
// Op payloads carry ops in their DATA_FORMATS §3 wire form; decode them with format.opFromWire.

import { pack, unpack } from 'msgpackr';

export const PROTO = 1;
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
/**
 * MI (M4): the largest desync-repair checkpoint a client can send (client → host). Only `checkpoint` messages may be
 * this big (decodeClient); everything else stays under MAX_MESSAGE_BYTES. It matches J4's 64 MB WebSocket cap
 * (server.ts). Deflated rigid state plus Matter (MX's MTR1: 28 B per grain before deflate): a 1M-grain world's
 * checkpoint fits (sizes in M4_NOTES_MI). Bigger ones can't be re-synced by checkpoint; the authority reports it and the
 * run carries on (sim.worker.ts).
 */
export const MAX_CHECKPOINT_MESSAGE_BYTES = 64 * 1024 * 1024;
export const MAX_CHECKPOINT_BYTES = MAX_CHECKPOINT_MESSAGE_BYTES - 4096;

export type PlayerColor = 'beam' | 'plasma';
export const PLAYER_COLORS: Record<1 | 2, { name: PlayerColor; hex: string }> = {
  1: { name: 'beam', hex: '#2FD6FF' },
  2: { name: 'plasma', hex: '#FF3DAE' },
};

export interface PlayerInfo {
  readonly slot: 1 | 2;
  readonly name: string;
  readonly login: string | null;
  readonly color: PlayerColor;
  readonly isHost: boolean;
  readonly tier: number;
}

export type Vec3 = [number, number, number];
export type CamPose = [number, number, number, number, number, number, number]; // pos + quat

export type PingKind = 'look' | 'help' | 'nice' | 'boom';

/**
 * The part a player is holding (drag-to-move, a gizmo move, a paste ghost), relayed in presence at ≤ 20 Hz. D117 sent
 * `type` + `pos`; BUILDUX (D124) appends, all optional (old clients ignore them, PROTO unchanged): `rot` = its rotation
 * quaternion, and `parts` = up to PRESENCE_GHOST_MAX held parts (the first is this one) as compact tuples: type, offset
 * from `pos` in whole millimetres, rotation quaternion × 10 000 rounded.
 */
export interface PresenceGhost {
  type: string;
  pos: Vec3;
  rot?: [number, number, number, number];
  parts?: [type: string, dx: number, dy: number, dz: number, qx: number, qy: number, qz: number, qw: number][];
}
export const PRESENCE_GHOST_MAX = 32;

export interface WorldInfo {
  readonly id: string;
  readonly title: string;
  readonly preset: string;
  readonly parts: number;
  readonly modified: number;
}

export interface ClientMsgs {
  hello: { proto: number; build: string; tier: number; resumeToken?: string; nickname?: string };
  join: { worldId: string } | { newWorld: { name: string; preset: string } };
  op: { clientOpId: string; baseSeq: number; op: unknown };
  lock: { ids: number[] };
  unlock: { ids: number[] };
  presence: { cam: CamPose; cursor?: Vec3; tool: string; ghost?: PresenceGhost };
  ping: { pos: Vec3; kind: PingKind };
  chat: { text: string };
  'run.request': { solo?: false };
  'run.cancel': { runId: string };
  'run.stop': { runId: string };
  play: { runId: string; tick: number; speed: number; paused: boolean };
  baked: { runId: string; tick: number };
  poke: { runId: string; tick: number; partId: number; kind: 'impulse' | 'drag' | 'release'; data: number[] };
  /**
   * `h` is the state hash (it includes the Matter checksum, SIMULATION §10.4); MI (M4): `mc` repeats the Matter checksum for desync reports.
   * M5 (desync fix): `pk` = how many pokes the hash was computed with (known pokes with tick < `tick`). The host compares a tick
   * only across reports with the same `pk`, and a client reports re-baked ticks again after a rollback (net hashes.ts).
   */
  hash: { runId: string; tick: number; h: string; mc?: string; pk?: number };
  checkpoint: { runId: string; tick: number; blob: Uint8Array };
  save: Record<string, never>;
  time: { t0: number };
}

export interface ServerMsgs {
  welcome: { you: PlayerInfo; serverBuild: string; worlds: WorldInfo[]; resumeToken: string };
  snapshot: { worldId: string; seq: number; world: Uint8Array; players: PlayerInfo[]; locks: Record<string, number>; run: RunState | null };
  op: { seq: number; by: number; op: unknown };
  'op.ack': { clientOpId: string; seq: number };
  'op.reject': { clientOpId: string; reason: string };
  locks: { held: Record<string, number>; released: number[] };
  presence: ClientMsgs['presence'] & { by: number };
  ping: ClientMsgs['ping'] & { by: number };
  chat: { text: string; by: number; at: number };
  peer: { event: 'join' | 'leave' | 'reconnect'; player: PlayerInfo };
  'run.countdown': { runId: string; startsAt: number; by: number };
  'run.start': { runId: string; worldSeq: number };
  'run.cancel': { runId: string; by: number };
  'run.stop': { runId: string; by: number };
  play: ClientMsgs['play'] & { atServerTime: number; by: number };
  bakedMin: { runId: string; tick: number };
  poke: ClientMsgs['poke'] & { seq: number; by: number };
  desync: { runId: string; tick: number };
  checkpoint: { runId: string; tick: number; blob: Uint8Array };
  saved: { worldId: string; at: number };
  time: { t0: number; serverTime: number };
  error: { code: ErrorCode; message: string };
}

export interface RunState {
  readonly runId: string;
  readonly worldSeq: number;
  readonly phase: 'countdown' | 'running';
  readonly startsAt: number;
  readonly pokes: ServerMsgs['poke'][];
}

export type ErrorCode = 'BUILD_MISMATCH' | 'PROTO_MISMATCH' | 'SESSION_FULL' | 'NOT_ALLOWED' | 'OVER_CAPACITY' | 'RATE_LIMIT' | 'BAD_MESSAGE' | 'NOT_HOST';

export type ClientType = keyof ClientMsgs;
export type ServerType = keyof ServerMsgs;
export type ClientMsg = { [K in ClientType]: [K, ClientMsgs[K]] }[ClientType];
export type ServerMsg = { [K in ServerType]: [K, ServerMsgs[K]] }[ServerType];

const CLIENT_TYPES: ReadonlySet<string> = new Set<ClientType>([
  'hello', 'join', 'op', 'lock', 'unlock', 'presence', 'ping', 'chat', 'run.request', 'run.cancel', 'run.stop',
  'play', 'baked', 'poke', 'hash', 'checkpoint', 'save', 'time',
]);
const SERVER_TYPES: ReadonlySet<string> = new Set<ServerType>([
  'welcome', 'snapshot', 'op', 'op.ack', 'op.reject', 'locks', 'presence', 'ping', 'chat', 'peer', 'run.countdown',
  'run.start', 'run.cancel', 'run.stop', 'play', 'bakedMin', 'poke', 'desync', 'checkpoint', 'saved', 'time', 'error',
]);

export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

export function encode<M extends ClientMsg | ServerMsg>(msg: M): Uint8Array {
  return pack(msg) as Uint8Array;
}

function decodeAny(bytes: Uint8Array, allowed: ReadonlySet<string>, limit: number): [string, Record<string, unknown>] {
  if (bytes.byteLength > limit) throw new ProtocolError('message too large');
  let v: unknown;
  try { v = unpack(bytes); } catch { throw new ProtocolError('malformed message'); }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || !allowed.has(v[0])) throw new ProtocolError('unknown message');
  const payload = v[1];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new ProtocolError('payload must be a map');
  return [v[0], payload as Record<string, unknown>];
}

/**
 * Decode a client → server message. Shape-level checks only; the session validates fields. `checkpoint` (desync repair)
 * may be up to MAX_CHECKPOINT_MESSAGE_BYTES; every other type is capped at `limit` (MI, M4).
 */
export function decodeClient(bytes: Uint8Array, limit = MAX_MESSAGE_BYTES): ClientMsg {
  const msg = decodeAny(bytes, CLIENT_TYPES, Math.max(limit, MAX_CHECKPOINT_MESSAGE_BYTES)) as unknown as ClientMsg;
  if (bytes.byteLength > limit && msg[0] !== 'checkpoint') throw new ProtocolError('message too large');
  return msg;
}

export function decodeServer(bytes: Uint8Array): ServerMsg {
  return decodeAny(bytes, SERVER_TYPES, MAX_UPLOAD_BYTES) as unknown as ServerMsg;
}
