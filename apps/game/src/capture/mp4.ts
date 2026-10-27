// C4 (M4): our own MP4 (ISO-BMFF, ISO/IEC 14496-12/-15, AV1-ISOBMFF) muxer and box walker (D94: no libraries).
//
// One video track, progressive layout: `ftyp`, then `mdat` (64-bit size, patched at the end) holding the samples
// in decode order as they arrive from VideoEncoder, then `moov` with the sample tables. The sink is append-only
// plus one patch, so the bytes can stream to an OPFS file (mp4.worker.ts) and a 5-minute 8K clip never sits in
// memory. Samples: AVC and HEVC are length-prefixed (WebCodecs `format: 'avc' | 'hevc'`, description = avcC /
// hvcC); AV1 is the low-overhead OBU stream with temporal delimiters removed, and av1C is built here from the
// codec string and the first key frame's sequence header OBU when the encoder gives no description.

import { ByteWriter, fourcc } from './bytes.ts';

export type VideoCodecKind = 'av1' | 'hevc' | 'avc';

export interface Mp4TrackConfig {
  readonly codec: VideoCodecKind;
  /** The WebCodecs codec string ('av01.0.13M.08', 'hvc1.1.6.L153.B0', 'avc1.640033'). */
  readonly codecString: string;
  readonly width: number;
  readonly height: number;
  /** Frames per second (sets the media timescale). */
  readonly fps: number;
  /** EncodedVideoChunkMetadata.decoderConfig.description (avcC / hvcC / av1C), if the encoder gave one. */
  readonly description?: Uint8Array;
}

/** F5 (M5): the optional audio track (AAC-LC or Opus from WebCodecs AudioEncoder; audio/clip.ts). */
export type AudioCodecKind = 'aac' | 'opus';

export interface Mp4AudioConfig {
  readonly codec: AudioCodecKind;
  /** The WebCodecs codec string ('mp4a.40.2', 'opus'). */
  readonly codecString: string;
  readonly sampleRate: number;
  readonly channels: number;
  /** EncodedAudioChunkMetadata.decoderConfig.description: AAC AudioSpecificConfig, or Opus's OpusHead. */
  readonly description?: Uint8Array;
  /** Encoder delay in samples, trimmed by an edit list (Opus: the OpusHead pre-skip). */
  readonly priming?: number;
  /** Average bitrate (bit/s) for esds. */
  readonly bitrate?: number;
  /** The PCM length in samples: the edit list stops there (the codec pads the last frame). */
  readonly frames?: number;
}

/** An encoded audio track handed to the video sink (timestamps and durations in microseconds). */
export interface EncodedAudioTrack {
  readonly cfg: Mp4AudioConfig;
  readonly samples: readonly { readonly data: Uint8Array; readonly pts: number; readonly dur: number }[];
  /** "AAC-LC 192 kbps". */
  readonly label: string;
}

/** Where the file goes: appended in order, plus patches of bytes already written (the mdat size). */
export interface Mp4Sink {
  append(b: Uint8Array): void;
  patch(offset: number, b: Uint8Array): void;
}

/** An in-memory sink (tests, and the worker's fallback when OPFS isn't available). */
export class MemorySink implements Mp4Sink {
  readonly parts: Uint8Array[] = [];
  private readonly starts: number[] = [];
  size = 0;
  append(b: Uint8Array): void { this.starts.push(this.size); this.parts.push(b.slice()); this.size += b.length; }
  patch(offset: number, b: Uint8Array): void {
    // patches land inside one earlier part (the mdat header)
    for (let i = this.parts.length - 1; i >= 0; i--) {
      if (this.starts[i]! <= offset) { this.parts[i]!.set(b, offset - this.starts[i]!); return; }
    }
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    this.parts.forEach((p, i) => out.set(p, this.starts[i]!));
    return out;
  }
}

/** Media timescale for a frame rate: 90 kHz when it divides evenly (24/25/30/50/60), else fps × 1000. */
export function mediaTimescale(fps: number): number {
  return Number.isInteger(fps) && 90000 % fps === 0 ? 90000 : Math.round(fps * 1000);
}

const MOVIE_TIMESCALE = 1000;

interface Sample { size: number; key: boolean; pts: number; dur: number }

/**
 * F5 (M5): chunks for the sample tables. A chunk is a run of samples contiguous in mdat (at most `per` long), so
 * video and audio samples can sit in mdat in any order (C4's video-only clips get the same one-chunk-per-second
 * table as before).
 */
function chunksOf(sizes: readonly number[], offsets: readonly number[], per: number): { offs: number[]; counts: number[] } {
  const offs: number[] = [], counts: number[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const n = counts.length;
    const contiguous = n > 0 && offsets[i - 1]! + sizes[i - 1]! === offsets[i]! && counts[n - 1]! < per;
    if (contiguous) counts[n - 1]!++;
    else { offs.push(offsets[i]!); counts.push(1); }
  }
  return { offs, counts };
}

export class Mp4Muxer {
  private readonly sink: Mp4Sink;
  private readonly cfg: Mp4TrackConfig;
  private readonly ts: number;
  private readonly samples: Sample[] = [];
  private readonly offsets: number[] = [];
  private pos = 0;
  private mdatStart = 0;
  private config: Uint8Array | null;
  private done = false;
  /** F5 (M5): the audio track, when the clip has one. */
  private audio: { cfg: Mp4AudioConfig; samples: Sample[]; offsets: number[] } | null = null;

  constructor(sink: Mp4Sink, cfg: Mp4TrackConfig) {
    this.sink = sink;
    this.cfg = cfg;
    this.ts = mediaTimescale(cfg.fps);
    this.config = cfg.description && cfg.description.length ? cfg.description.slice() : null;
    if (cfg.codec === 'av1' && this.config && this.config[0] !== 0x81) this.config = null; // not an av1C: build our own
    const w = new ByteWriter(64);
    const brands = ['isom', 'iso2', ...(cfg.codec === 'avc' ? ['avc1'] : cfg.codec === 'av1' ? ['av01'] : []), 'mp41'];
    box(w, 'ftyp', () => { w.ascii('isom').u32(0x200); for (const b of brands) w.ascii(b); });
    this.mdatStart = w.length;
    w.u32(1).ascii('mdat').u64(0); // size 1 → 64-bit largesize, patched in finish()
    this.write(w.finish());
  }

  get sampleCount(): number { return this.samples.length; }
  /** Bytes written so far. */
  get bytesWritten(): number { return this.pos; }

  /** Adds a sample in decode order. `ptsUs`/`durUs` are the chunk's timestamp and duration in microseconds. */
  addSample(data: Uint8Array, key: boolean, ptsUs: number, durUs: number): void {
    if (this.done) throw new Error('mp4: finished');
    let bytes = data;
    if (this.cfg.codec === 'av1') {
      bytes = stripTemporalDelimiters(data);
      if (!this.config && key) {
        const seq = findObu(data, OBU_SEQUENCE_HEADER);
        if (seq) this.config = av1C(this.cfg.codecString, seq);
      }
    }
    this.offsets.push(this.pos);
    this.samples.push({ size: bytes.length, key, pts: Math.round((ptsUs * this.ts) / 1e6), dur: Math.max(1, Math.round((durUs * this.ts) / 1e6)) });
    this.write(bytes);
  }

  /** F5 (M5): declares the audio track (once, before `finish`). */
  addAudioTrack(cfg: Mp4AudioConfig): void {
    if (this.done) throw new Error('mp4: finished');
    if (this.audio) throw new Error('mp4: the audio track is already declared');
    if (!(cfg.sampleRate > 0) || !(cfg.channels >= 1)) throw new Error('mp4: bad audio configuration');
    this.audio = { cfg, samples: [], offsets: [] };
  }

  /** F5 (M5): adds an audio sample (an access unit) in order. `ptsUs`/`durUs` in microseconds. */
  addAudioSample(data: Uint8Array, ptsUs: number, durUs: number): void {
    if (this.done) throw new Error('mp4: finished');
    const a = this.audio;
    if (!a) throw new Error('mp4: audio sample before addAudioTrack');
    const sr = a.cfg.sampleRate;
    a.offsets.push(this.pos);
    a.samples.push({ size: data.length, key: true, pts: Math.round((ptsUs * sr) / 1e6), dur: Math.max(1, Math.round((durUs * sr) / 1e6)) });
    this.write(data);
  }

  get audioSampleCount(): number { return this.audio?.samples.length ?? 0; }

  /** Writes `moov` and patches the `mdat` size. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    if (!this.config) throw new Error(`mp4: no decoder configuration for ${this.cfg.codec}`);
    const mdatSize = this.pos - this.mdatStart;
    const p = new ByteWriter(8);
    p.u64(mdatSize);
    this.sink.patch(this.mdatStart + 8, p.finish());
    this.write(this.moov());
  }

  private write(b: Uint8Array): void { this.sink.append(b); this.pos += b.length; }

  private moov(): Uint8Array {
    const { width, height } = this.cfg;
    const S = this.samples;
    // decode times: back to back from 0 with each sample's duration; composition offsets only if pts ≠ dts
    const dts: number[] = [];
    let t = 0;
    for (const s of S) { dts.push(t); t += s.dur; }
    const mediaDur = t;
    const pts0 = S.length ? Math.min(...S.map((s) => s.pts)) : 0;
    const ctts = S.map((s, i) => s.pts - pts0 - dts[i]!);
    const needCtts = ctts.some((c) => c !== 0);
    const movieDur = Math.round((mediaDur * MOVIE_TIMESCALE) / this.ts);
    // F5 (M5): the audio track's duration (after its edit list trims the encoder delay)
    const A = this.audio;
    const aMedia = A ? A.samples.reduce((n, s) => n + s.dur, 0) : 0;
    // Opus: the pre-skip is signalled in dOps only; Chrome's (FFmpeg's) demuxer would skip it twice with an edit list too
    const aPrime = A && A.cfg.codec !== 'opus' ? Math.max(0, Math.min(Math.round(A.cfg.priming ?? 0), aMedia)) : 0;
    // the edit stops at the PCM's end (the codec pads the last frame); Opus media time still counts its pre-skip
    const aSkip = A && A.cfg.codec === 'opus' ? Math.max(0, Math.round(opusPreSkip(A.cfg.description) ?? A.cfg.priming ?? 0)) : 0;
    const aPlay = A ? Math.min(aMedia - aPrime, A.cfg.frames && A.cfg.frames > 0 ? A.cfg.frames + aSkip : Infinity) : 0;
    const aMovieDur = A ? Math.round((aPlay * MOVIE_TIMESCALE) / A.cfg.sampleRate) : 0;
    const w = new ByteWriter(4096 + S.length * 16 + (A ? A.samples.length * 8 : 0));
    const matrix = (): void => { for (const v of [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]) w.u32(v); };
    box(w, 'moov', () => {
      full(w, 'mvhd', 0, 0, () => {
        w.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(Math.max(movieDur, aMovieDur)).u32(0x10000).u16(0x100).zeros(10);
        matrix();
        w.zeros(24).u32(A ? 3 : 2);
      });
      box(w, 'trak', () => {
        full(w, 'tkhd', 0, 3, () => {
          w.u32(0).u32(0).u32(1).u32(0).u32(movieDur).zeros(8).u16(0).u16(0).u16(0).u16(0);
          matrix();
          w.u32(width * 65536).u32(height * 65536);
        });
        box(w, 'mdia', () => {
          full(w, 'mdhd', 0, 0, () => { w.u32(0).u32(0).u32(this.ts).u32(mediaDur).u16(0x55c4).u16(0); }); // 'und'
          full(w, 'hdlr', 0, 0, () => { w.u32(0).ascii('vide').zeros(12).ascii('KNOCK-ON video').u8(0); });
          box(w, 'minf', () => {
            full(w, 'vmhd', 0, 1, () => { w.u16(0).u16(0).u16(0).u16(0); });
            box(w, 'dinf', () => { full(w, 'dref', 0, 0, () => { w.u32(1); full(w, 'url ', 0, 1, () => {}); }); });
            box(w, 'stbl', () => {
              full(w, 'stsd', 0, 0, () => { w.u32(1); this.sampleEntry(w); });
              // stts: run-length durations
              const runs: [number, number][] = [];
              for (const s of S) { const r = runs.at(-1); if (r && r[1] === s.dur) r[0]++; else runs.push([1, s.dur]); }
              full(w, 'stts', 0, 0, () => { w.u32(runs.length); for (const [n, d] of runs) w.u32(n).u32(d); });
              if (needCtts) {
                const cr: [number, number][] = [];
                for (const c of ctts) { const r = cr.at(-1); if (r && r[1] === c) r[0]++; else cr.push([1, c]); }
                full(w, 'ctts', 1, 0, () => { w.u32(cr.length); for (const [n, c] of cr) w.u32(n).i32(c); });
              }
              if (S.some((s) => !s.key)) {
                const keys = S.map((s, i) => (s.key ? i + 1 : 0)).filter((i) => i > 0);
                full(w, 'stss', 0, 0, () => { w.u32(keys.length); for (const k of keys) w.u32(k); });
              }
              // chunks: runs of samples contiguous in mdat, at most one second of video each
              chunkTables(w, S.map((s) => s.size), this.offsets, Math.max(1, Math.round(this.cfg.fps)));
            });
          });
        });
      });
      if (A) this.audioTrak(w, A, aMedia, aPrime, aMovieDur, matrix);
    });
    return w.finish();
  }

  /** F5 (M5): track 2, the sound track (ISO/IEC 14496-12 §8, -14 esds for AAC, Opus-in-ISOBMFF dOps for Opus). */
  private audioTrak(w: ByteWriter, A: { cfg: Mp4AudioConfig; samples: Sample[]; offsets: number[] }, media: number, prime: number, movieDur: number, matrix: () => void): void {
    const { cfg } = A;
    const S = A.samples;
    box(w, 'trak', () => {
      full(w, 'tkhd', 0, 3, () => {
        w.u32(0).u32(0).u32(2).u32(0).u32(movieDur).zeros(8).u16(0).u16(1).u16(0x100).u16(0); // layer 0, alternate group 1, volume 1.0
        matrix();
        w.u32(0).u32(0);
      });
      // the edit list trims the encoder delay, so sound and picture start together
      box(w, 'edts', () => { full(w, 'elst', 0, 0, () => { w.u32(1).u32(movieDur).i32(prime).u16(1).u16(0); }); });
      box(w, 'mdia', () => {
        full(w, 'mdhd', 0, 0, () => { w.u32(0).u32(0).u32(cfg.sampleRate).u32(media).u16(0x55c4).u16(0); });
        full(w, 'hdlr', 0, 0, () => { w.u32(0).ascii('soun').zeros(12).ascii('KNOCK-ON audio').u8(0); });
        box(w, 'minf', () => {
          full(w, 'smhd', 0, 0, () => { w.u16(0).u16(0); });
          box(w, 'dinf', () => { full(w, 'dref', 0, 0, () => { w.u32(1); full(w, 'url ', 0, 1, () => {}); }); });
          box(w, 'stbl', () => {
            full(w, 'stsd', 0, 0, () => { w.u32(1); audioEntry(w, cfg, prime); });
            const runs: [number, number][] = [];
            for (const s of S) { const r = runs.at(-1); if (r && r[1] === s.dur) r[0]++; else runs.push([1, s.dur]); }
            full(w, 'stts', 0, 0, () => { w.u32(runs.length); for (const [n, d] of runs) w.u32(n).u32(d); });
            // about one second of audio per chunk
            const per = Math.max(1, Math.round(cfg.sampleRate / Math.max(1, S[0]?.dur ?? 1024)));
            chunkTables(w, S.map((s) => s.size), A.offsets, per);
          });
        });
      });
    });
  }

  private sampleEntry(w: ByteWriter): void {
    const { codec, width, height } = this.cfg;
    const type = codec === 'avc' ? 'avc1' : codec === 'hevc' ? 'hvc1' : 'av01';
    box(w, type, () => {
      w.zeros(6).u16(1); // reserved, data_reference_index
      w.u16(0).u16(0).zeros(12).u16(width).u16(height).u32(0x480000).u32(0x480000).u32(0).u16(1);
      const name = 'KNOCK-ON';
      w.u8(name.length).ascii(name).zeros(31 - name.length);
      w.u16(0x18).u16(0xffff);
      box(w, codec === 'avc' ? 'avcC' : codec === 'hevc' ? 'hvcC' : 'av1C', () => { w.bytes(this.config!); });
      box(w, 'pasp', () => { w.u32(1).u32(1); });
    });
  }
}

function box(w: ByteWriter, type: string, body: () => void): void {
  const at = w.length;
  w.u32(0).ascii(type);
  body();
  w.setU32(at, w.length - at);
}

function full(w: ByteWriter, type: string, version: number, flags: number, body: () => void): void {
  box(w, type, () => { w.u8(version).u24(flags); body(); });
}

/** stsc (run-length samples per chunk), stsz and stco / co64 for one track. */
function chunkTables(w: ByteWriter, sizes: readonly number[], offsets: readonly number[], per: number): void {
  const { offs, counts } = chunksOf(sizes, offsets, per);
  full(w, 'stsc', 0, 0, () => {
    const e: [number, number][] = [];
    counts.forEach((n, c) => { if (!e.length || e.at(-1)![1] !== n) e.push([c + 1, n]); });
    w.u32(e.length);
    for (const [c, n] of e) w.u32(c).u32(n).u32(1);
  });
  full(w, 'stsz', 0, 0, () => { w.u32(0).u32(sizes.length); for (const s of sizes) w.u32(s); });
  const big = offs.some((o) => o > 0xffffffff);
  full(w, big ? 'co64' : 'stco', 0, 0, () => { w.u32(offs.length); for (const o of offs) (big ? w.u64(o) : w.u32(o)); });
}

// ---- F5 (M5): audio sample entries ------------------------------------------------------------------------

/** AAC-LC AudioSpecificConfig for a rate and channel count (when the encoder gives none). */
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const fi = Math.max(0, rates.indexOf(sampleRate));
  const v = (2 << 11) | (fi << 7) | ((channels & 15) << 3); // object type 2 (AAC-LC)
  return Uint8Array.of(v >> 8, v & 0xff);
}

/** An MPEG-4 descriptor: tag, a 4-byte length (0x80 continuation form, which every parser reads) and the body. */
function descriptor(w: ByteWriter, tag: number, body: () => void): void {
  w.u8(tag);
  const at = w.length;
  w.u32(0);
  body();
  const n = w.length - at - 4;
  const b = w.view8();
  b[at] = 0x80 | ((n >> 21) & 0x7f); b[at + 1] = 0x80 | ((n >> 14) & 0x7f); b[at + 2] = 0x80 | ((n >> 7) & 0x7f); b[at + 3] = n & 0x7f;
}

/** The OpusHead's pre-skip (little-endian u16 at byte 10), or null when `d` isn't an OpusHead. */
export function opusPreSkip(d: Uint8Array | undefined): number | null {
  if (!d || d.length < 19 || String.fromCharCode(...d.subarray(0, 8)) !== 'OpusHead') return null;
  return d[10]! | (d[11]! << 8);
}

function audioEntry(w: ByteWriter, cfg: Mp4AudioConfig, prime: number): void {
  const opus = cfg.codec === 'opus';
  box(w, opus ? 'Opus' : 'mp4a', () => {
    w.zeros(6).u16(1); // reserved, data_reference_index
    w.zeros(8).u16(cfg.channels).u16(16).u16(0).u16(0).u32((opus ? 48000 : cfg.sampleRate) * 65536);
    if (opus) {
      // dOps (Opus in ISOBMFF §4.3.2): big-endian, unlike the OpusHead it comes from
      const head = cfg.description;
      const pre = opusPreSkip(head) ?? prime;
      const inRate = head && opusPreSkip(head) !== null ? (head[12]! | (head[13]! << 8) | (head[14]! << 16)) + head[15]! * 16777216 : cfg.sampleRate;
      const gain = head && opusPreSkip(head) !== null ? (head[16]! | (head[17]! << 8)) : 0;
      box(w, 'dOps', () => { w.u8(0).u8(cfg.channels).u16(pre).u32(inRate).u16(gain).u8(0); });
    } else {
      const asc = cfg.description && cfg.description.length >= 2 ? cfg.description : aacConfig(cfg.sampleRate, cfg.channels);
      const rate = Math.round(cfg.bitrate ?? 192000);
      full(w, 'esds', 0, 0, () => {
        descriptor(w, 0x03, () => {
          w.u16(0).u8(0); // ES_ID, flags
          descriptor(w, 0x04, () => {
            w.u8(0x40).u8((0x05 << 2) | 1).u24(6144).u32(rate).u32(rate); // MPEG-4 audio, audio stream; buffer, max / avg bitrate
            descriptor(w, 0x05, () => { w.bytes(asc); });
          });
          descriptor(w, 0x06, () => { w.u8(0x02); }); // SLConfig: predefined MP4
        });
      });
    }
  });
}

// ---- AV1 (AV1-ISOBMFF §2) ---------------------------------------------------------------------------------

export const OBU_SEQUENCE_HEADER = 1;
export const OBU_TEMPORAL_DELIMITER = 2;

interface Obu { type: number; start: number; end: number }

/** Splits a low-overhead AV1 bitstream into OBUs (every OBU must carry obu_has_size_field, as encoders emit). */
export function parseObus(b: Uint8Array): Obu[] {
  const out: Obu[] = [];
  let p = 0;
  while (p < b.length) {
    const start = p;
    const h = b[p++]!;
    const type = (h >> 3) & 15;
    if (h & 4) p++; // extension header
    let size = b.length - p;
    if (h & 2) {
      size = 0;
      for (let i = 0; i < 8; i++) {
        const byte = b[p++]!;
        size += (byte & 0x7f) * 2 ** (7 * i);
        if (!(byte & 0x80)) break;
      }
    }
    p += size;
    if (p > b.length) throw new Error('av1: truncated OBU');
    out.push({ type, start, end: p });
  }
  return out;
}

export function findObu(b: Uint8Array, type: number): Uint8Array | null {
  const o = parseObus(b).find((x) => x.type === type);
  return o ? b.slice(o.start, o.end) : null;
}

/** AV1 samples in MP4 should not carry temporal delimiters (AV1-ISOBMFF §2.4). */
export function stripTemporalDelimiters(b: Uint8Array): Uint8Array {
  const obus = parseObus(b);
  if (!obus.some((o) => o.type === OBU_TEMPORAL_DELIMITER)) return b;
  const keep = obus.filter((o) => o.type !== OBU_TEMPORAL_DELIMITER);
  const out = new Uint8Array(keep.reduce((n, o) => n + o.end - o.start, 0));
  let p = 0;
  for (const o of keep) { out.set(b.subarray(o.start, o.end), p); p += o.end - o.start; }
  return out;
}

/** AV1CodecConfigurationRecord from 'av01.P.LLT.DD…' and the sequence header OBU (4:2:0, as WebCodecs encodes). */
export function av1C(codecString: string, seqHeader: Uint8Array): Uint8Array {
  const m = /^av01\.(\d)\.(\d\d)([MH])\.(\d\d)/.exec(codecString);
  const profile = m ? Number(m[1]) : 0, level = m ? Number(m[2]) : 8, tier = m?.[3] === 'H' ? 1 : 0, depth = m ? Number(m[4]) : 8;
  const out = new Uint8Array(4 + seqHeader.length);
  out[0] = 0x81; // marker, version 1
  out[1] = ((profile & 7) << 5) | (level & 31);
  out[2] = (tier << 7) | ((depth > 8 ? 1 : 0) << 6) | ((depth === 12 ? 1 : 0) << 5) | (0 << 4) | (1 << 3) | (1 << 2) | 0;
  out[3] = 0;
  out.set(seqHeader, 4);
  return out;
}

// ---- reading back (tests, and the in-browser verify after a capture) --------------------------------------

export interface Box { type: string; start: number; size: number; header: number; children: Box[] }

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta']);
const ENTRIES = new Set(['avc1', 'hvc1', 'hev1', 'av01']);
/** F5 (M5): audio sample entries (their child boxes start after the 28-byte AudioSampleEntry fields). */
const AUDIO_ENTRIES = new Set(['mp4a', 'Opus']);

/** Walks the box tree. Throws on a box that overruns its parent. */
export function walkBoxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = fourcc(b, p + 4);
    let header = 8;
    if (size === 1) { size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); header = 16; }
    else if (size === 0) size = end - p;
    if (size < header || p + size > end) throw new Error(`mp4: box ${type} at ${p} (size ${size}) overruns ${end}`);
    const bx: Box = { type, start: p, size, header, children: [] };
    if (CONTAINERS.has(type)) bx.children = walkBoxes(b, p + header, p + size);
    else if (type === 'stsd') bx.children = walkBoxes(b, p + header + 8, p + size);
    else if (ENTRIES.has(type)) bx.children = walkBoxes(b, p + header + 78, p + size);
    else if (AUDIO_ENTRIES.has(type)) bx.children = walkBoxes(b, p + header + 28, p + size);
    out.push(bx);
    p += size;
  }
  if (p !== end) throw new Error(`mp4: ${end - p} trailing bytes at ${p}`);
  return out;
}

export function findBox(boxes: readonly Box[], path: string): Box | null {
  const [head, ...rest] = path.split('/');
  const b = boxes.find((x) => x.type === head);
  if (!b) return null;
  return rest.length ? findBox(b.children, rest.join('/')) : b;
}

export interface Mp4Info {
  brands: string[];
  entry: string;
  width: number;
  height: number;
  timescale: number;
  /** Media duration in seconds. */
  duration: number;
  sampleCount: number;
  keyFrames: number[];
  sizes: number[];
  /** Absolute file offset of every sample. */
  offsets: number[];
  config: Uint8Array;
  boxes: Box[];
  /** F5 (M5): the sound track, if there is one. */
  audio: Mp4AudioInfo | null;
}

export interface Mp4AudioInfo {
  entry: string;
  channels: number;
  sampleRate: number;
  timescale: number;
  /** Media duration in seconds (before the edit list). */
  duration: number;
  /** The edit list's media_time in samples (the trimmed encoder delay), 0 without one. */
  priming: number;
  sampleCount: number;
  sizes: number[];
  offsets: number[];
  /** The AudioSpecificConfig (from esds) or the dOps payload. */
  config: Uint8Array;
}

/** Per-sample sizes and absolute offsets from one track's stbl (checked against the mdat bounds). */
function sampleTable(b: Uint8Array, dv: DataView, stbl: Box, mdat: Box): { sizes: number[]; offsets: number[] } {
  const child = (t: string): Box | undefined => stbl.children.find((c) => c.type === t);
  const stsz = child('stsz'), stco = child('stco') ?? child('co64'), stsc = child('stsc');
  if (!stsz || !stco || !stsc) throw new Error('mp4: incomplete sample table');
  const n = dv.getUint32(stsz.start + 16), fixed = dv.getUint32(stsz.start + 12);
  const sizes = Array.from({ length: n }, (_, i) => (fixed ? fixed : dv.getUint32(stsz.start + 20 + i * 4)));
  const nc = dv.getUint32(stco.start + 12);
  const chunkOff = Array.from({ length: nc }, (_, i) => (stco.type === 'co64' ? dv.getUint32(stco.start + 16 + i * 8) * 4294967296 + dv.getUint32(stco.start + 20 + i * 8) : dv.getUint32(stco.start + 16 + i * 4)));
  const ne = dv.getUint32(stsc.start + 12);
  const runs = Array.from({ length: ne }, (_, i) => ({ first: dv.getUint32(stsc.start + 16 + i * 12), per: dv.getUint32(stsc.start + 20 + i * 12) }));
  const offsets: number[] = [];
  let s = 0;
  for (let c = 0; c < nc; c++) {
    const run = [...runs].reverse().find((r) => r.first <= c + 1)!;
    let o = chunkOff[c]!;
    for (let k = 0; k < run.per && s < n; k++, s++) { offsets.push(o); o += sizes[s]!; }
  }
  if (offsets.length !== n) throw new Error(`mp4: stsc covers ${offsets.length} of ${n} samples`);
  offsets.forEach((o, i) => { if (o < mdat.start + mdat.header || o + sizes[i]! > mdat.start + mdat.size) throw new Error(`mp4: sample ${i} outside mdat`); });
  void b;
  return { sizes, offsets };
}

/** F5 (M5): reads the sound track (the trak whose handler is 'soun'). */
function readAudio(b: Uint8Array, dv: DataView, boxes: Box[], mdat: Box): Mp4AudioInfo | null {
  const moov = boxes.find((x) => x.type === 'moov');
  const trak = moov?.children.filter((c) => c.type === 'trak').find((t) => {
    const h = findBox(t.children, 'mdia/hdlr');
    return h ? fourcc(b, h.start + 16) === 'soun' : false;
  });
  if (!trak) return null;
  const need = (path: string): Box => { const x = findBox(trak.children, path); if (!x) throw new Error(`mp4: audio track missing ${path}`); return x; };
  const stbl = need('mdia/minf/stbl');
  const entry = need('mdia/minf/stbl/stsd').children[0];
  if (!entry) throw new Error('mp4: audio track has no sample entry');
  const channels = dv.getUint16(entry.start + entry.header + 16), sampleRate = dv.getUint32(entry.start + entry.header + 24) / 65536;
  const mdhd = need('mdia/mdhd');
  const timescale = dv.getUint32(mdhd.start + 20), mdur = dv.getUint32(mdhd.start + 24);
  const elst = findBox(trak.children, 'edts/elst');
  const priming = elst && dv.getUint32(elst.start + 12) > 0 ? dv.getInt32(elst.start + 20) : 0;
  let config = new Uint8Array(0);
  const esds = entry.children.find((c) => c.type === 'esds'), dops = entry.children.find((c) => c.type === 'dOps');
  if (dops) config = b.slice(dops.start + 8, dops.start + dops.size);
  else if (esds) {
    // the DecoderSpecificInfo (tag 5) inside the ES descriptor
    let p = esds.start + 12;
    const end = esds.start + esds.size;
    const len = (): number => { let n = 0; for (let i = 0; i < 4; i++) { const v = b[p++]!; n = (n << 7) | (v & 0x7f); if (!(v & 0x80)) break; } return n; };
    while (p < end) {
      const tag = b[p++]!, n = len();
      if (tag === 0x03) { p += 3; continue; }
      if (tag === 0x04) { p += 13; continue; }
      if (tag === 0x05) { config = b.slice(p, p + n); break; }
      p += n;
    }
  }
  const { sizes, offsets } = sampleTable(b, dv, stbl, mdat);
  return { entry: entry.type, channels, sampleRate, timescale, duration: mdur / timescale, priming, sampleCount: sizes.length, sizes, offsets, config };
}

/** Parses the sample tables back into per-sample offsets and sizes (checked against the mdat bounds). */
export function readMp4(b: Uint8Array): Mp4Info {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const boxes = walkBoxes(b);
  const need = (path: string): Box => { const x = findBox(boxes, path); if (!x) throw new Error(`mp4: missing ${path}`); return x; };
  const ftyp = need('ftyp');
  const brands: string[] = [];
  for (let p = ftyp.start + 8; p < ftyp.start + ftyp.size; p += 4) if (p !== ftyp.start + 12) brands.push(fourcc(b, p));
  const stbl = 'moov/trak/mdia/minf/stbl';
  const stsd = need(`${stbl}/stsd`);
  const entry = stsd.children[0]!;
  const width = dv.getUint16(entry.start + entry.header + 24), height = dv.getUint16(entry.start + entry.header + 26);
  const cfgBox = entry.children.find((c) => ['avcC', 'hvcC', 'av1C'].includes(c.type));
  if (!cfgBox) throw new Error('mp4: sample entry has no codec configuration');
  const mdhd = need('moov/trak/mdia/mdhd');
  const timescale = dv.getUint32(mdhd.start + 20), mdur = dv.getUint32(mdhd.start + 24);
  const stsz = need(`${stbl}/stsz`);
  const n = dv.getUint32(stsz.start + 16), fixed = dv.getUint32(stsz.start + 12);
  const sizes = Array.from({ length: n }, (_, i) => (fixed ? fixed : dv.getUint32(stsz.start + 20 + i * 4)));
  const stco = findBox(boxes, `${stbl}/stco`) ?? need(`${stbl}/co64`);
  const nc = dv.getUint32(stco.start + 12);
  const chunkOff = Array.from({ length: nc }, (_, i) => (stco.type === 'co64' ? dv.getUint32(stco.start + 16 + i * 8) * 4294967296 + dv.getUint32(stco.start + 20 + i * 8) : dv.getUint32(stco.start + 16 + i * 4)));
  const stsc = need(`${stbl}/stsc`);
  const ne = dv.getUint32(stsc.start + 12);
  const runs = Array.from({ length: ne }, (_, i) => ({ first: dv.getUint32(stsc.start + 16 + i * 12), per: dv.getUint32(stsc.start + 20 + i * 12) }));
  const offsets: number[] = [];
  let s = 0;
  for (let c = 0; c < nc; c++) {
    const run = [...runs].reverse().find((r) => r.first <= c + 1)!;
    let o = chunkOff[c]!;
    for (let k = 0; k < run.per && s < n; k++, s++) { offsets.push(o); o += sizes[s]!; }
  }
  if (offsets.length !== n) throw new Error(`mp4: stsc covers ${offsets.length} of ${n} samples`);
  const mdat = boxes.find((x) => x.type === 'mdat');
  if (!mdat) throw new Error('mp4: no mdat');
  offsets.forEach((o, i) => { if (o < mdat.start + mdat.header || o + sizes[i]! > mdat.start + mdat.size) throw new Error(`mp4: sample ${i} outside mdat`); });
  const stss = findBox(boxes, `${stbl}/stss`);
  const keyFrames = stss ? Array.from({ length: dv.getUint32(stss.start + 12) }, (_, i) => dv.getUint32(stss.start + 16 + i * 4) - 1) : sizes.map((_, i) => i);
  return {
    brands, entry: entry.type, width, height, timescale, duration: mdur / timescale, sampleCount: n, keyFrames, sizes, offsets,
    config: b.slice(cfgBox.start + 8, cfgBox.start + cfgBox.size), boxes, audio: readAudio(b, dv, boxes, mdat),
  };
}
