// M3 master limiter (AUDIO.md §4: lookahead 5 ms, −1 dBTP ceiling, no audible pumping). An AudioWorklet
// brickwall true-peak limiter, loaded from `limiter-processor.js` (a same-origin asset: the host's CSP blocks Blob URLs).
//
// Detector: linked stereo, 4× polyphase windowed-sinc interpolation (16 taps per phase) for inter-sample
// peaks. Gain computer: the per-sample required gain g = min(1, ceiling / truePeak) goes through a sliding
// minimum over the lookahead window, a program-dependent release (fast after short transients, slow when the
// limiter has been working for a while, so a barrage doesn't make the music breathe), and a box average over
// the same window. The box average of a window minimum never exceeds the requirement of the sample it is
// applied to, so the output can't overshoot the ceiling; it also turns each gain step into a smooth ramp.
// The audio is delayed by lookahead + the interpolator's group delay.
//
// Stats are posted every 100 ms: { gr: max gain reduction in dB, tpIn, tpOut } (linear true peaks).



export interface LimiterStats { gr: number; tpIn: number; tpOut: number }

/** Ceiling and lookahead (AUDIO §4). The ceiling sits a hair under −1 dBTP so a finer true-peak meter agrees. */
export const LIMITER_CEILING_DB = -1.05;
export const LIMITER_LOOKAHEAD_S = 0.005;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

import PROCESSOR_URL from './limiter-processor.js?url';

/** Load the processor into a context (once). Resolves false when AudioWorklet is unavailable. */
export function loadLimiter(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(PROCESSOR_URL);
        return true;
      } catch (err) {
        console.warn('[audio] limiter worklet unavailable, using the fallback limiter', err);
        return false;
      }
    })();
    loaded.set(ctx, p);
  }
  return p;
}

export function createLimiter(ctx: BaseAudioContext, onStats?: (s: LimiterStats) => void): AudioWorkletNode {
  const node = new AudioWorkletNode(ctx, 'kn-limiter', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    processorOptions: { ceilingDb: LIMITER_CEILING_DB, lookahead: LIMITER_LOOKAHEAD_S },
  });
  if (onStats) node.port.onmessage = (e: MessageEvent<LimiterStats>) => onStats(e.data);
  return node;
}

/** 4× windowed-sinc true-peak meter (48 taps per phase), for tests: the max |x| over the oversampled signal. */
export function truePeak(chs: readonly Float32Array[], taps = 48): number {
  const half = taps / 2;
  const coef: Float32Array[] = [];
  for (let k = 1; k < 4; k++) {
    const c = new Float32Array(taps);
    let s = 0;
    for (let i = 0; i < taps; i++) {
      const u = k / 4 - (i - (half - 1));
      const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * u / (half + 0.5)) + 0.08 * Math.cos(2 * Math.PI * u / (half + 0.5)); // Blackman
      c[i] = sinc * w; s += sinc * w;
    }
    for (let i = 0; i < taps; i++) c[i] = c[i]! / s;
    coef.push(c);
  }
  let peak = 0;
  for (const x of chs) {
    for (let n = 0; n < x.length; n++) { const a = Math.abs(x[n]!); if (a > peak) peak = a; }
    for (let n = 0; n + taps <= x.length; n++) {
      // cheap skip: an inter-sample peak is never twice its neighbourhood
      let local = 0;
      for (let j = half - 3; j < half + 3; j++) { const a = Math.abs(x[n + j]!); if (a > local) local = a; }
      if (local * 2 < peak) continue;
      for (const c of coef) {
        let y = 0;
        for (let j = 0; j < taps; j++) y += c[j]! * x[n + j]!;
        const a = Math.abs(y);
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}
