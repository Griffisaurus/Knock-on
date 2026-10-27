// C4 (M4): the MP4 muxer's worker (RENDERING §13). Encoded chunks arrive from the main thread's VideoEncoder and are
// appended to an OPFS file through a sync access handle, so a 5-minute 8K clip streams to disk instead of RAM;
// without OPFS it falls back to memory. On `finish` it writes `moov`, patches the `mdat` size and hands back a File.

/// <reference lib="webworker" />
import { MemorySink, Mp4Muxer, type Mp4AudioConfig, type Mp4Sink, type Mp4TrackConfig } from './mp4.ts';

export type ToMp4Worker =
  | { type: 'init'; cfg: Mp4TrackConfig; name: string }
  | { type: 'sample'; data: ArrayBuffer; key: boolean; pts: number; dur: number }
  // F5 (M5): the clip's sound track (declared once, then its samples; all before 'finish')
  | { type: 'audio'; cfg: Mp4AudioConfig }
  | { type: 'asample'; data: ArrayBuffer; pts: number; dur: number }
  | { type: 'finish' }
  | { type: 'abort' };

export type FromMp4Worker =
  | { type: 'ready'; storage: 'opfs' | 'memory' }
  | { type: 'progress'; samples: number; bytes: number }
  | { type: 'done'; file: Blob; bytes: number; samples: number; storage: 'opfs' | 'memory'; name: string; audioSamples?: number }
  | { type: 'error'; message: string };

interface SyncHandle { write(b: BufferSource, o: { at: number }): number; flush(): void; close(): void; truncate(n: number): void }

class OpfsSink implements Mp4Sink {
  private at = 0;
  constructor(private readonly h: SyncHandle) {}
  append(b: Uint8Array): void { this.at += this.h.write(b, { at: this.at }); }
  patch(offset: number, b: Uint8Array): void { this.h.write(b, { at: offset }); }
}

let mux: Mp4Muxer | null = null;
let mem: MemorySink | null = null;
let handle: SyncHandle | null = null;
let fileHandle: FileSystemFileHandle | null = null;
let fileName = '';
let lastProgress = 0;
const queue: ToMp4Worker[] = [];
let busy = false;

const post = (m: FromMp4Worker): void => (self as unknown as Worker).postMessage(m);

async function init(cfg: Mp4TrackConfig, name: string): Promise<void> {
  fileName = name;
  let storage: 'opfs' | 'memory' = 'memory';
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('captures', { create: true });
    fileHandle = await dir.getFileHandle(name, { create: true });
    handle = await (fileHandle as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
    handle.truncate(0);
    mux = new Mp4Muxer(new OpfsSink(handle), cfg);
    storage = 'opfs';
  } catch {
    handle = null;
    fileHandle = null;
    mem = new MemorySink();
    mux = new Mp4Muxer(mem, cfg);
  }
  post({ type: 'ready', storage });
}

async function handleMsg(m: ToMp4Worker): Promise<void> {
  switch (m.type) {
    case 'init': await init(m.cfg, m.name); return;
    case 'sample': {
      if (!mux) throw new Error('mp4 worker: sample before init');
      mux.addSample(new Uint8Array(m.data), m.key, m.pts, m.dur);
      if (mux.sampleCount - lastProgress >= 30) { lastProgress = mux.sampleCount; post({ type: 'progress', samples: mux.sampleCount, bytes: mux.bytesWritten }); }
      return;
    }
    case 'audio': {
      if (!mux) throw new Error('mp4 worker: audio before init');
      mux.addAudioTrack(m.cfg);
      return;
    }
    case 'asample': {
      if (!mux) throw new Error('mp4 worker: audio sample before init');
      mux.addAudioSample(new Uint8Array(m.data), m.pts, m.dur);
      return;
    }
    case 'finish': {
      if (!mux) throw new Error('mp4 worker: finish before init');
      mux.finish();
      const bytes = mux.bytesWritten, samples = mux.sampleCount, audioSamples = mux.audioSampleCount; // F5 (M5)
      let file: Blob;
      if (handle && fileHandle) {
        handle.flush();
        handle.close();
        handle = null;
        file = await fileHandle.getFile();
      } else file = new Blob(mem!.parts as BlobPart[], { type: 'video/mp4' });
      post({ type: 'done', file, bytes, samples, storage: fileHandle ? 'opfs' : 'memory', name: fileName, audioSamples });
      mux = null; mem = null;
      return;
    }
    case 'abort': {
      try { handle?.close(); } catch { /* already closed */ }
      handle = null; mux = null; mem = null;
      if (fileHandle) {
        try { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('captures'); await dir.removeEntry(fileName); } catch { /* gone */ }
      }
      fileHandle = null;
      return;
    }
  }
}

// messages are handled strictly in order (init is async: OPFS handles)
self.onmessage = (ev: MessageEvent<ToMp4Worker>) => {
  queue.push(ev.data);
  if (busy) return;
  busy = true;
  void (async () => {
    while (queue.length) {
      const m = queue.shift()!;
      try { await handleMsg(m); } catch (err) { post({ type: 'error', message: err instanceof Error ? err.message : String(err) }); }
    }
    busy = false;
  })();
};
