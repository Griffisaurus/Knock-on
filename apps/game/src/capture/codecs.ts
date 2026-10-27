// C4 (M4): video codec choice for offline renders (RENDERING §13): AV1 → HEVC → H.264, hardware first, with the
// codec level picked from the frame size and rate so 8K60 asks for a level that allows it.

import { findObu, OBU_SEQUENCE_HEADER, type VideoCodecKind } from './mp4.ts';

export interface CodecChoice {
  readonly kind: VideoCodecKind;
  readonly codec: string;
  readonly hardware: boolean;
  readonly config: VideoEncoderConfig;
  /** "AV1 (hardware)". */
  readonly label: string;
}

export const CODEC_ORDER: readonly VideoCodecKind[] = ['av1', 'hevc', 'avc'];
export const CODEC_NAME: Record<VideoCodecKind, string> = { av1: 'AV1', hevc: 'HEVC', avc: 'H.264' };

interface Level { readonly id: string; readonly pic: number; readonly rate: number; readonly maxW: number }

// AV1 Annex A (seq_level_idx): max picture size (luma samples), max display rate (luma samples/s), max width
const AV1_LEVELS: readonly Level[] = [
  { id: '04', pic: 665856, rate: 19975680, maxW: 4352 },       // 3.0
  { id: '05', pic: 1065024, rate: 31950720, maxW: 5504 },      // 3.1
  { id: '08', pic: 2359296, rate: 70778880, maxW: 6144 },      // 4.0
  { id: '09', pic: 2359296, rate: 141557760, maxW: 6144 },     // 4.1
  { id: '12', pic: 8912896, rate: 267386880, maxW: 8192 },     // 5.0
  { id: '13', pic: 8912896, rate: 534773760, maxW: 8192 },     // 5.1
  { id: '14', pic: 8912896, rate: 1069547520, maxW: 8192 },    // 5.2
  { id: '16', pic: 35651584, rate: 1069547520, maxW: 16384 },  // 6.0
  { id: '17', pic: 35651584, rate: 2139095040, maxW: 16384 },  // 6.1
  { id: '18', pic: 35651584, rate: 4278190080, maxW: 16384 },  // 6.2
];
// HEVC Annex A (general_level_idc = 30 × level): MaxLumaPs, MaxLumaSr; width ≤ √(8 · MaxLumaPs)
const HEVC_LEVELS: readonly Level[] = [
  { id: '93', pic: 983040, rate: 33177600, maxW: 2804 },
  { id: '120', pic: 2228224, rate: 66846720, maxW: 4222 },
  { id: '123', pic: 2228224, rate: 133693440, maxW: 4222 },
  { id: '150', pic: 8912896, rate: 267386880, maxW: 8444 },
  { id: '153', pic: 8912896, rate: 534773760, maxW: 8444 },
  { id: '156', pic: 8912896, rate: 1069547520, maxW: 8444 },
  { id: '180', pic: 35651584, rate: 1069547520, maxW: 16888 },
  { id: '183', pic: 35651584, rate: 2139095040, maxW: 16888 },
  { id: '186', pic: 35651584, rate: 4278190080, maxW: 16888 },
];
// H.264 Table A-1: MaxFS (macroblocks), MaxMBPS; width ≤ √(8 · MaxFS) macroblocks
const AVC_LEVELS: readonly Level[] = [
  { id: '1F', pic: 3600 * 256, rate: 108000 * 256, maxW: 169 * 16 },
  { id: '28', pic: 8192 * 256, rate: 245760 * 256, maxW: 256 * 16 },
  { id: '2A', pic: 8704 * 256, rate: 522240 * 256, maxW: 263 * 16 },
  { id: '32', pic: 22080 * 256, rate: 589824 * 256, maxW: 420 * 16 },
  { id: '33', pic: 36864 * 256, rate: 983040 * 256, maxW: 543 * 16 },
  { id: '34', pic: 36864 * 256, rate: 2073600 * 256, maxW: 543 * 16 },
  { id: '3C', pic: 139264 * 256, rate: 4177920 * 256, maxW: 1055 * 16 },
  { id: '3D', pic: 139264 * 256, rate: 8355840 * 256, maxW: 1055 * 16 },
  { id: '3E', pic: 139264 * 256, rate: 16711680 * 256, maxW: 1055 * 16 },
];

function level(table: readonly Level[], w: number, h: number, fps: number): Level | null {
  const mbW = Math.ceil(w / 16) * 16, mbH = Math.ceil(h / 16) * 16;
  return table.find((l) => mbW * mbH <= l.pic && mbW * mbH * fps <= l.rate && Math.max(mbW, mbH) <= l.maxW) ?? null;
}

/** The codec string for a kind at this size and rate (null when no level allows it). */
export function codecString(kind: VideoCodecKind, w: number, h: number, fps: number): string | null {
  if (kind === 'av1') { const l = level(AV1_LEVELS, w, h, fps); return l ? `av01.0.${l.id}M.08` : null; }
  if (kind === 'hevc') { const l = level(HEVC_LEVELS, w, h, fps); return l ? `hvc1.1.6.L${l.id}.B0` : null; }
  const l = level(AVC_LEVELS, w, h, fps);
  return l ? `avc1.6400${l.id}` : null;
}

/** Target bitrate (bits/s): a per-codec bits-per-pixel budget, clamped. */
export function bitrateFor(kind: VideoCodecKind, w: number, h: number, fps: number): number {
  const bpp = kind === 'av1' ? 0.05 : kind === 'hevc' ? 0.065 : 0.1;
  return Math.round(Math.min(200e6, Math.max(2e6, w * h * fps * bpp)));
}

export function encoderConfig(kind: VideoCodecKind, codec: string, w: number, h: number, fps: number, hardware: boolean): VideoEncoderConfig {
  const cfg: VideoEncoderConfig = {
    codec, width: w, height: h, framerate: fps, bitrate: bitrateFor(kind, w, h, fps), bitrateMode: 'variable',
    latencyMode: 'quality', hardwareAcceleration: hardware ? 'prefer-hardware' : 'no-preference',
  };
  if (kind === 'avc') (cfg as VideoEncoderConfig & { avc: { format: 'avc' } }).avc = { format: 'avc' };
  if (kind === 'hevc') (cfg as VideoEncoderConfig & { hevc: { format: 'hevc' } }).hevc = { format: 'hevc' };
  return cfg;
}

/**
 * UIFIX (D122): the frame size an AV1 sequence header OBU (with its OBU header) declares: max_frame_width / height
 * (AV1 §5.5.1). Players show this size. Null when it can't be read.
 */
export function av1SeqSize(obu: Uint8Array): { w: number; h: number } | null {
  let p = 0;
  const hdr = obu[p++];
  if (hdr === undefined || ((hdr >> 3) & 15) !== OBU_SEQUENCE_HEADER) return null;
  if (hdr & 4) p++;
  if (hdr & 2) { while (p < obu.length && obu[p++]! & 0x80) { /* leb128 size */ } }
  let bit = p * 8;
  const end = obu.length * 8;
  const f = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (bit >= end) throw new RangeError('av1: short sequence header');
      v = v * 2 + ((obu[bit >> 3]! >> (7 - (bit & 7))) & 1);
      bit++;
    }
    return v;
  };
  const uvlc = (): void => { let z = 0; while (!f(1)) z++; if (z < 32) f(z); };
  try {
    f(3); f(1); // seq_profile, still_picture
    const reduced = f(1);
    if (reduced) f(5);
    else {
      let decoderModel = 0, delayLen = 0;
      if (f(1)) { // timing_info_present_flag
        f(32); f(32);
        if (f(1)) uvlc(); // equal_picture_interval
        decoderModel = f(1);
        if (decoderModel) { delayLen = f(5) + 1; f(32); f(5); f(5); }
      }
      const initialDelay = f(1);
      const ops = f(5) + 1;
      for (let i = 0; i < ops; i++) {
        f(12);
        if (f(5) > 7) f(1);
        if (decoderModel && f(1)) { f(delayLen); f(delayLen); f(1); }
        if (initialDelay && f(1)) f(4);
      }
    }
    const wb = f(4) + 1, hb = f(4) + 1;
    return { w: f(wb) + 1, h: f(hb) + 1 };
  } catch { return null; }
}

/**
 * UIFIX (D122): encodes one blank frame with `config` and checks the size the stream declares. NVENC's AV1 codes a
 * 1920×1080 request as 1088 lines (the 16-line superblock row) with no crop, so players show 1920×1088 with 8 extra
 * lines; H.264 and HEVC crop to the exact size in their SPS. True when the size matches (or can't be checked).
 */
async function codedSizeOk(kind: VideoCodecKind, config: VideoEncoderConfig, w: number, h: number): Promise<boolean> {
  if (kind !== 'av1' || (w % 16 === 0 && h % 16 === 0) || typeof VideoFrame === 'undefined' || typeof OffscreenCanvas === 'undefined') return true;
  let first: Uint8Array | null = null;
  try {
    const enc = new VideoEncoder({ output: (c) => { if (!first) { first = new Uint8Array(c.byteLength); c.copyTo(first); } }, error: () => {} });
    enc.configure(config);
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d'); // a VideoFrame needs a canvas with a context
    if (!g) return true;
    g.fillRect(0, 0, w, h);
    const frame = new VideoFrame(c, { timestamp: 0 });
    enc.encode(frame, { keyFrame: true });
    frame.close();
    await enc.flush();
    enc.close();
  } catch { return true; }
  const seq = first ? findObu(first, OBU_SEQUENCE_HEADER) : null;
  const size = seq ? av1SeqSize(seq) : null;
  return !size || (size.w === w && size.h === h);
}

/**
 * The encoder for an offline render: hardware before software (an 8K software AV1 encode is many times slower than
 * the render), and AV1 → HEVC → H.264 within each. Chrome lists the test system's hardware encoders only up to
 * 1080p60 / 2160p30 (measured, M4_NOTES_C4), so above that a hardware config is retried with the frame-rate *hint*
 * capped at 30 and the bitrate scaled to match: an offline render feeds frames as fast as it draws them, the
 * timestamps carry the real rate, and the rate control's per-frame budget (bitrate / hint) stays the same.
 */
export async function chooseCodec(w: number, h: number, fps: number, only?: VideoCodecKind): Promise<CodecChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const kinds = only ? [only] : CODEC_ORDER;
  const tryCfg = async (config: VideoEncoderConfig): Promise<boolean> => {
    try { return (await VideoEncoder.isConfigSupported(config)).supported === true; } catch { return false; }
  };
  for (const hardware of [true, false]) {
    for (const kind of kinds) {
      const codec = codecString(kind, w, h, fps);
      if (!codec) continue;
      const config = encoderConfig(kind, codec, w, h, fps, hardware);
      // UIFIX (D122): an encoder that would pad the frame (1088 lines for 1080p) is skipped for the next one
      if (await tryCfg(config)) {
        if (await codedSizeOk(kind, config, w, h)) return { kind, codec, hardware, config, label: `${CODEC_NAME[kind]} (${hardware ? 'hardware' : 'software'})` };
        continue;
      }
      if (hardware && fps > 30) {
        const hint = 30;
        // the level for the real rate first (what the stream is), then the hint's level
        for (const c of new Set([codec, codecString(kind, w, h, hint) ?? codec])) {
          const hinted: VideoEncoderConfig = { ...config, codec: c, framerate: hint, bitrate: Math.round((config.bitrate! * hint) / fps) };
          if (await tryCfg(hinted)) return { kind, codec: c, hardware, config: hinted, label: `${CODEC_NAME[kind]} (hardware, ${hint} fps rate hint)` };
        }
      }
    }
  }
  return null;
}

export interface CodecProbeRow { size: string; fps: number; kind: VideoCodecKind; codec: string | null; hardware: boolean; software: boolean }

/** Every codec × hardware/software at the capture sizes (the notes' "codecs found on the test system"). */
export async function probeCodecs(sizes: readonly [number, number][] = [[1920, 1080], [3840, 2160], [7680, 4320]], fps = 60): Promise<CodecProbeRow[]> {
  const rows: CodecProbeRow[] = [];
  for (const [w, h] of sizes) for (const kind of CODEC_ORDER) {
    const codec = codecString(kind, w, h, fps);
    const ok = async (hw: boolean): Promise<boolean> => {
      if (!codec || typeof VideoEncoder === 'undefined') return false;
      try { return (await VideoEncoder.isConfigSupported(encoderConfig(kind, codec, w, h, fps, hw))).supported === true; } catch { return false; }
    };
    // 'prefer-hardware' succeeds only with a hardware encoder; software is probed with 'prefer-software'
    const hardware = await ok(true);
    let software = false;
    if (codec && typeof VideoEncoder !== 'undefined') {
      try { software = (await VideoEncoder.isConfigSupported({ ...encoderConfig(kind, codec, w, h, fps, false), hardwareAcceleration: 'prefer-software' })).supported === true; } catch { software = false; }
    }
    rows.push({ size: `${w}×${h}`, fps, kind, codec, hardware, software });
  }
  return rows;
}
