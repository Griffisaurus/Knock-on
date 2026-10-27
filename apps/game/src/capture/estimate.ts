// UIFIX (D122): the Record clip time estimate, calibrated from measured renders (bug 3 of the 2026-10-25 playtest: the
// dialog said "≈ 29 s" for a render that took 79 s).
//
// A clip frame costs the GPU's draw (the live GPU frame time scaled by the pixel count) plus a per-frame residual: the
// exact-tick seek round trip to the sim worker, Matter's replica catching up, waiting for the GPU queue, the encoder's
// back-pressure, the sound track, and the share of the start-up and the file's finish. The draw part is what changes
// with the size; the residual is what the old formula guessed (14 ms) and got about 3× too low. So the residual is
// measured: after each render the whole wall time (start to file) per frame, minus the draw estimate, is folded into a
// per-format running value, kept per viewer in localStorage. Until a first render, the default comes from the
// playtest's measured clip (1080p30 MP4 of a 370-part world: 52.7 ms per frame, the draw ≈ 2 ms).

export type CostFormat = 'mp4' | 'gif' | 'webp';

export interface CostModel {
  /** Per-frame residual (ms) per format, measured (or the default). */
  readonly residual: Readonly<Record<CostFormat, number>>;
  /** How many renders went into each value (0 = the default). */
  readonly samples: Readonly<Record<CostFormat, number>>;
}

export const DEFAULT_COST: CostModel = {
  residual: { mp4: 50, gif: 50, webp: 55 },
  samples: { mp4: 0, gif: 0, webp: 0 },
};

/** GIF and WebP render at up to 2× and downscale (offline.ts): their draw covers about 4× the pixels. */
const supersample = (format: CostFormat): number => (format === 'mp4' ? 1 : 4);

/** The draw part of a frame (ms): the live GPU frame time scaled by the pixel count (at least 4 ms). */
export function drawMs(gpuMs: number, w: number, h: number, canvasPixels: number, format: CostFormat): number {
  const ratio = (w * h * supersample(format)) / Math.max(1, canvasPixels);
  return Math.max(4, (gpuMs > 0 ? gpuMs : 16) * ratio);
}

/** Estimated wall time per frame (ms). */
export function frameMs(model: CostModel, gpuMs: number, w: number, h: number, canvasPixels: number, format: CostFormat): number {
  return drawMs(gpuMs, w, h, canvasPixels, format) + model.residual[format];
}

/**
 * Folds a finished render into the model: `wallMs` from Render to the finished file, `frames` rendered (the clip's,
 * plus preroll), `draw` the draw estimate that went with it. The first sample replaces the default; later ones are
 * a running average that leans on the newest (worlds and sizes change).
 */
export function calibrate(model: CostModel, format: CostFormat, wallMs: number, frames: number, draw: number): CostModel {
  if (!(frames > 0) || !(wallMs > 0)) return model;
  const measured = Math.max(0, wallMs / frames - draw);
  const n = model.samples[format];
  const next = n === 0 ? measured : model.residual[format] * 0.4 + measured * 0.6;
  return { residual: { ...model.residual, [format]: next }, samples: { ...model.samples, [format]: n + 1 } };
}

const KEY = 'knockon.capture.cost.v1';

export function loadCost(): CostModel {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COST;
    const m = JSON.parse(raw) as Partial<CostModel>;
    const r = m.residual ?? {}, s = m.samples ?? {};
    const pick = (f: CostFormat, o: Partial<Record<CostFormat, number>>, d: number): number => (typeof o[f] === 'number' && Number.isFinite(o[f]) ? o[f]! : d);
    return {
      residual: { mp4: pick('mp4', r, DEFAULT_COST.residual.mp4), gif: pick('gif', r, DEFAULT_COST.residual.gif), webp: pick('webp', r, DEFAULT_COST.residual.webp) },
      samples: { mp4: pick('mp4', s, 0), gif: pick('gif', s, 0), webp: pick('webp', s, 0) },
    };
  } catch { return DEFAULT_COST; }
}

export function saveCost(m: CostModel): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage full or blocked */ }
}
