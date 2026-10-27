// Share links (DATA_FORMATS §7, GAME_SPEC §17.2): small machines ride in the URL fragment, which never reaches a
// server log: `#m=1<base64url(deflate-raw(canonical .knockon without INPT))>`, optionally `&t=<seconds>&cam=<mode>`.
// Bigger ones are a Host Server share id: `#s=<16 hex>` (apps/host/src/share.ts). The decoder refuses any payload
// over 64 KB, and the world inside is validated like any file (never partially loaded).

import { deflateSync, inflateSync } from 'fflate';
import { FormatError } from './bytes.ts';
import { Codec } from './container.ts';
import { decodeWorld, encodeWorld, type WorldSnapshot } from './world.ts';

export const LINK_VERSION = '1';
/** The Share button offers an inline link up to this many compressed bytes (GAME_SPEC §17.2). */
export const INLINE_LINK_MAX = 12 * 1024;
/** Decoder limit on the base64url payload (DATA_FORMATS §7). */
export const LINK_PAYLOAD_MAX = 64 * 1024;

export type ShareRef =
  | { readonly kind: 'inline'; readonly world: WorldSnapshot; readonly t?: number; readonly cam?: string }
  | { readonly kind: 'id'; readonly id: string; readonly t?: number; readonly cam?: string };

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new FormatError('link: not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The inline fragment for a world (`m=1…`, no leading '#'), or null when it's over INLINE_LINK_MAX compressed
 * (share it through the host instead). The world is encoded canonically (no editor state) and uncompressed, then
 * deflated once as a whole.
 */
export function inlineLink(world: WorldSnapshot, opts: { t?: number; cam?: string } = {}): string | null {
  const raw = encodeWorld(world, { canonical: true, codec: Codec.None });
  const packed = deflateSync(raw, { level: 9 });
  if (packed.length > INLINE_LINK_MAX) return null;
  return `m=${LINK_VERSION}${b64url(packed)}${suffix(opts)}`;
}

/** The fragment for a host share id. */
export function idLink(id: string, opts: { t?: number; cam?: string } = {}): string {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new FormatError('link: bad share id');
  return `s=${id}${suffix(opts)}`;
}

function suffix(o: { t?: number; cam?: string }): string {
  let s = '';
  if (o.t !== undefined && Number.isFinite(o.t) && o.t >= 0) s += `&t=${Math.round(o.t * 10) / 10}`;
  if (o.cam && /^[a-z]{1,16}$/.test(o.cam)) s += `&cam=${o.cam}`;
  return s;
}

/** Parses `location.hash` (with or without '#'): an inline world, a share id, or null when it's no share link. */
export function parseShareLink(hash: string): ShareRef | null {
  const frag = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new Map<string, string>();
  for (const kv of frag.split('&')) {
    const i = kv.indexOf('=');
    if (i > 0) params.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const t = params.has('t') ? Number(params.get('t')) : undefined;
  const cam = params.get('cam');
  const extra = { ...(t !== undefined && Number.isFinite(t) && t >= 0 ? { t } : {}), ...(cam && /^[a-z]{1,16}$/.test(cam) ? { cam } : {}) };
  const m = params.get('m');
  if (m !== undefined) {
    if (m[0] !== LINK_VERSION) throw new FormatError(`link: unsupported version ${m[0] ?? ''}`);
    const payload = m.slice(1);
    if (payload.length > LINK_PAYLOAD_MAX) throw new FormatError('link: payload over 64 KB');
    let raw: Uint8Array;
    try { raw = inflateSync(unb64url(payload)); } catch (err) { throw new FormatError(`link: ${(err as Error).message}`); }
    if (raw.length > 16 * 1024 * 1024) throw new FormatError('link: world too large');
    return { kind: 'inline', world: decodeWorld(raw), ...extra };
  }
  const s = params.get('s');
  if (s !== undefined) {
    if (!/^[0-9a-f]{16}$/.test(s)) throw new FormatError('link: bad share id');
    return { kind: 'id', id: s, ...extra };
  }
  return null;
}
