// Share links, client side (GAME_SPEC §17.2, DATA_FORMATS §7): the hooks the UI calls. Small worlds become an
// inline `#m=…` link (no server involved); anything bigger is stored on the Host Server (apps/host/src/share.ts)
// and shared as `#s=<id>`, which the partner opens on the same host, or another host fetches by URL. Modules
// share the same way. Opening a link imports the world into the host's list and switches to it (host player),
// or stores the module in the world's Library.
//
// UI hooks: shareWorld() (the session bar's Share button), shareModule(), openShareLink() on boot / hashchange,
// importFromHost() (paste another host's link). `t` and `cam` deep-link a moment of the replay; the caller applies them.

import { encodeWorld, idLink, inlineLink, nextSmallId, parseShareLink, type ShareRef, type WorldSnapshot } from '@knockon/format';
import type { NetClient } from './net.ts';

export interface ShareResult {
  /** The full URL to copy. */
  readonly url: string;
  /** 'inline' (in the fragment, nothing stored) or 'host' (stored on this Host Server). */
  readonly via: 'inline' | 'host';
  readonly bytes?: number;
}

interface ShareMeta { id: string; kind: 'world' | 'module'; title: string; parts: number; bytes: number }

const base = (): string => `${location.origin}${location.pathname}`;

async function post(path: string, body?: BodyInit, json = false): Promise<Response> {
  const res = await fetch(path, { method: 'POST', ...(body !== undefined ? { body } : {}), headers: { 'content-type': json ? 'application/json' : 'application/octet-stream' } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new Error(`Share: ${msg}`);
  }
  return res;
}

/** The world as the session has it (editor state left out: links share machines, not layouts). */
function snapshotOf(net: NetClient): WorldSnapshot | null {
  const doc = net.store?.doc;
  if (!doc) return null;
  return doc.toSnapshot({ title: 'Shared machine', simVersion: '0.0.0-dev', tickRate: 120, seed: [0x9e3779b9, 0x7f4a7c15], counters: {} });
}

/**
 * The Share button: a link to the current world. Inline when it fits in ~12 KB compressed (GAME_SPEC §17.2),
 * otherwise the host stores its confirmed copy of the world. `t` / `cam` deep-link a moment and a camera.
 */
export async function shareWorldLink(net: NetClient, opts: { t?: number; cam?: string; forceHost?: boolean } = {}): Promise<ShareResult> {
  const snap = snapshotOf(net);
  if (snap && !opts.forceHost) {
    const frag = inlineLink(snap, opts);
    if (frag) return { url: `${base()}#${frag}`, via: 'inline', bytes: frag.length };
  }
  const meta = (await (await post('/share/world')).json()) as ShareMeta;
  return { url: `${base()}#${idLink(meta.id, opts)}`, via: 'host', bytes: meta.bytes };
}

let bound: NetClient | null = null;
/** U3 hook: the session bar calls `shareWorld()` after `bindShare(net)` at boot. */
export function bindShare(net: NetClient): void { bound = net; }

/** U3 hook (session bar Share button): resolves to the link to copy. */
export async function shareWorld(): Promise<string> {
  if (!bound) throw new Error('Share: not connected');
  return (await shareWorldLink(bound)).url;
}

/** Shares a `.knockmod` module (the Library's module card): always through the host. */
export async function shareModule(blob: Uint8Array): Promise<ShareResult> {
  const meta = (await (await post('/share', blob)).json()) as ShareMeta;
  if (meta.kind !== 'module') throw new Error('Share: that was not a module');
  return { url: `${base()}#${idLink(meta.id)}`, via: 'host', bytes: meta.bytes };
}

/** The share link in the current URL, if any (throws on a malformed one so the UI can say so). */
export function currentShareLink(hash = location.hash): ShareRef | null {
  return parseShareLink(hash);
}

export type OpenResult =
  | { readonly kind: 'world'; readonly worldId: string; readonly title: string; readonly t?: number; readonly cam?: string }
  | { readonly kind: 'module'; readonly moduleId: number; readonly title: string };

/**
 * Opens a share link: a world is imported into the host's world list and, for the host player, switched to (the
 * partner follows, as with any world switch); a module is stored in this world's Library (a ModuleSave op).
 */
export async function openShareLink(net: NetClient, ref: ShareRef): Promise<OpenResult> {
  let id: string;
  let meta: ShareMeta;
  if (ref.kind === 'inline') {
    // the host stores it like any upload, so both players (and later visits) get the same world
    meta = (await (await post('/share', encodeWorld(ref.world))).json()) as ShareMeta;
    id = meta.id;
  } else {
    id = ref.id;
    const res = await fetch(`/share/${id}/meta`);
    if (!res.ok) throw new Error('Share: this host has no such link (ask for the link from the host it came from)');
    meta = (await res.json()) as ShareMeta;
  }
  if (meta.kind === 'module') {
    const blob = new Uint8Array(await (await fetch(`/share/${id}`)).arrayBuffer());
    const store = net.store, me = net.me;
    if (!store || !me) throw new Error('Share: not connected');
    const moduleId = nextSmallId(me.slot, store.doc.modules.keys());
    if (!net.submit({ k: 'ModuleSave', id: moduleId, name: meta.title.slice(0, 64) || 'Shared module', blob })) throw new Error('Share: the module was refused');
    return { kind: 'module', moduleId, title: meta.title };
  }
  const imp = (await (await post(`/share/${id}/import`)).json()) as { worldId: string; title: string };
  if (net.me?.isHost) net.send(['join', { worldId: imp.worldId }]);
  return { kind: 'world', worldId: imp.worldId, title: imp.title, ...(ref.t !== undefined ? { t: ref.t } : {}), ...(ref.cam ? { cam: ref.cam } : {}) };
}

/** Imports another host's share (`https://<host>/share/<id>` or its `/#s=<id>` page link) onto this host. */
export async function importFromHost(net: NetClient, link: string): Promise<OpenResult> {
  const u = new URL(link);
  const ref = u.pathname.startsWith('/share/') ? null : parseShareLink(u.hash);
  const id = ref?.kind === 'id' ? ref.id : u.pathname.split('/')[2] ?? '';
  const meta = (await (await post('/share/fetch', JSON.stringify({ url: `${u.origin}/share/${id}` }), true)).json()) as ShareMeta;
  return openShareLink(net, { kind: 'id', id: meta.id, ...(ref?.t !== undefined ? { t: ref.t } : {}), ...(ref?.cam ? { cam: ref.cam } : {}) });
}

