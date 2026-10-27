// C4 (M4): the GIF encoder's worker. Frames arrive as RGBA, are dithered into 15-bit bins (2 bytes per pixel kept)
// with the clip's histogram growing alongside; `finish` picks the palette and writes the file (gif.ts).

/// <reference lib="webworker" />
import { encodeGif, gifDelays, medianCut, toBins } from './gif.ts';

export type ToGifWorker =
  | { type: 'init'; width: number; height: number }
  | { type: 'frame'; rgba: ArrayBuffer }
  | { type: 'finish'; fps: number };

export type FromGifWorker =
  | { type: 'progress'; frame: number }
  | { type: 'done'; bytes: Uint8Array; colours: number }
  | { type: 'error'; message: string };

/** Ordered-dither amplitude (bin steps) and the unchanged-pixel tolerance (RGB distance): chosen by measured size
 * and look on the M4 sample clips (M4_NOTES_C4). */
const DITHER = 0.75;
const TOLERANCE = 10;
let W = 0, H = 0;
let hist = new Uint32Array(32768);
let frames: Uint16Array[] = [];
const post = (m: FromGifWorker, t: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, t);

self.onmessage = (ev: MessageEvent<ToGifWorker>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') { W = m.width; H = m.height; hist = new Uint32Array(32768); frames = []; return; }
    if (m.type === 'frame') { frames.push(toBins(new Uint8Array(m.rgba), W, H, hist, DITHER)); return; }
    if (m.type === 'finish') {
      const colours = medianCut(hist, 255).length / 3;
      const bytes = encodeGif(W, H, frames, gifDelays(frames.length, m.fps), hist, (i) => { if (i % 10 === 0) post({ type: 'progress', frame: i }); }, TOLERANCE);
      frames = [];
      post({ type: 'done', bytes, colours }, [bytes.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
