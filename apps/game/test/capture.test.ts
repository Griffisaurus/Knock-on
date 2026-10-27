// C4 (M4): the in-house capture writers (D94): the MP4 muxer (walked back box by box), the GIF encoder (decoded back
// pixel for pixel) and the animated WebP writer (parsed back), plus the codec level picker and the camera path.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ByteWriter } from '../src/capture/bytes.ts';
import { bitrateFor, codecString } from '../src/capture/codecs.ts';
import { binLut, compositeGif, decodeGif, encodeGif, gifDelays, lzwDecode, lzwEncode, medianCut, toBins } from '../src/capture/gif.ts';
import { aacConfig, av1C, findBox, MemorySink, mediaTimescale, Mp4Muxer, parseObus, readMp4, walkBoxes, type Mp4TrackConfig } from '../src/capture/mp4.ts';
import { buildAnimatedWebp, parseAnimatedWebp, parseRiff, stillToFrame, webpDurations } from '../src/capture/webp.ts';
import { CameraPath, type CamKey } from '../src/capture/path.ts';

/** A deterministic byte generator (xorshift). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s; };
}
const randomBytes = (n: number, seed: number): Uint8Array => { const r = rng(seed); return Uint8Array.from({ length: n }, () => r() & 0xff); };

function mux(cfg: Mp4TrackConfig, samples: { data: Uint8Array; key: boolean; pts: number; dur: number }[]): Uint8Array {
  const sink = new MemorySink();
  const m = new Mp4Muxer(sink, cfg);
  for (const s of samples) m.addSample(s.data, s.key, s.pts, s.dur);
  m.finish();
  return sink.bytes();
}

describe('MP4 muxer', () => {
  const avcC = Uint8Array.from([1, 0x64, 0, 0x33, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x33, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);

  it('writes a file whose boxes walk back and whose samples are byte-identical', () => {
    const fps = 30;
    const samples = Array.from({ length: 95 }, (_, i) => ({ data: randomBytes(100 + ((i * 37) % 900), i + 1), key: i % 30 === 0, pts: Math.round((i * 1e6) / fps), dur: Math.round(1e6 / fps) }));
    const file = mux({ codec: 'avc', codecString: 'avc1.640033', width: 1920, height: 1080, fps, description: avcC }, samples);
    const top = walkBoxes(file).map((b) => b.type);
    expect(top).toEqual(['ftyp', 'mdat', 'moov']);
    const info = readMp4(file);
    expect(info.brands).toContain('isom');
    expect(info.brands).toContain('avc1');
    expect(info.entry).toBe('avc1');
    expect([info.width, info.height]).toEqual([1920, 1080]);
    expect(info.timescale).toBe(90000);
    expect(info.sampleCount).toBe(95);
    expect(info.duration).toBeCloseTo(95 / 30, 6);
    expect(info.keyFrames).toEqual([0, 30, 60, 90]);
    expect(Array.from(info.config)).toEqual(Array.from(avcC));
    samples.forEach((s, i) => expect(Array.from(file.subarray(info.offsets[i]!, info.offsets[i]! + info.sizes[i]!))).toEqual(Array.from(s.data)));
    // 4 chunks (30 + 30 + 30 + 5): stsc has the run and the short last chunk
    expect(findBox(info.boxes, 'moov/trak/mdia/minf/stbl/stco')).not.toBeNull();
    // the 64-bit mdat size covers exactly the samples
    const mdat = info.boxes.find((b) => b.type === 'mdat')!;
    expect(mdat.header).toBe(16);
    expect(mdat.size - 16).toBe(samples.reduce((n, s) => n + s.data.length, 0));
  });

  it('leaves out stss when every sample is a key frame, and writes ctts only for reordered timestamps', () => {
    const base = { codec: 'hevc' as const, codecString: 'hvc1.1.6.L153.B0', width: 640, height: 360, fps: 60, description: Uint8Array.from([1, 2, 3, 4]) };
    const allKey = mux(base, [0, 1, 2].map((i) => ({ data: Uint8Array.of(i, i, i), key: true, pts: (i * 1e6) / 60, dur: 1e6 / 60 })));
    let info = readMp4(allKey);
    expect(info.entry).toBe('hvc1');
    expect(findBox(info.boxes, 'moov/trak/mdia/minf/stbl/stss')).toBeNull();
    expect(findBox(info.boxes, 'moov/trak/mdia/minf/stbl/ctts')).toBeNull();
    expect(info.keyFrames).toEqual([0, 1, 2]);
    // decode order I P B with presentation order I B P
    const pts = [0, 2, 1];
    const reordered = mux(base, pts.map((p, i) => ({ data: Uint8Array.of(i), key: i === 0, pts: (p * 1e6) / 60, dur: 1e6 / 60 })));
    info = readMp4(reordered);
    expect(findBox(info.boxes, 'moov/trak/mdia/minf/stbl/ctts')).not.toBeNull();
  });

  it('builds av1C from the sequence header and strips temporal delimiters from AV1 samples', () => {
    const td = Uint8Array.of(0x12, 0x00);
    const seq = Uint8Array.of(0x0a, 0x03, 0x00, 0x00, 0x00);
    const frame = (n: number): Uint8Array => Uint8Array.of(0x32, 0x04, n, n, n, n);
    const s0 = Uint8Array.from([...td, ...seq, ...frame(1)]), s1 = Uint8Array.from([...td, ...frame(2)]);
    expect(parseObus(s0).map((o) => o.type)).toEqual([2, 1, 6]);
    const file = mux({ codec: 'av1', codecString: 'av01.0.13M.08', width: 3840, height: 2160, fps: 60 }, [
      { data: s0, key: true, pts: 0, dur: 16667 }, { data: s1, key: false, pts: 16667, dur: 16667 },
    ]);
    const info = readMp4(file);
    expect(info.entry).toBe('av01');
    expect(info.brands).toContain('av01');
    expect(Array.from(info.config)).toEqual(Array.from(av1C('av01.0.13M.08', seq)));
    expect(info.config[0]).toBe(0x81);
    expect(info.config[1]).toBe((0 << 5) | 13);
    expect(Array.from(file.subarray(info.offsets[0]!, info.offsets[0]! + info.sizes[0]!))).toEqual([...seq, ...frame(1)]);
    expect(Array.from(file.subarray(info.offsets[1]!, info.offsets[1]! + info.sizes[1]!))).toEqual([...frame(2)]);
  });

  // F5 (M5): clips carry the game's sound as a second track
  it('muxes a sound track (AAC and Opus) that walks back, interleaved with the video or after it', () => {
    const fps = 30;
    const video = Array.from({ length: 40 }, (_, i) => ({ data: randomBytes(200 + ((i * 53) % 700), 1000 + i), key: i % 30 === 0, pts: Math.round((i * 1e6) / fps), dur: Math.round(1e6 / fps) }));
    const opusHead = Uint8Array.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]); // OpusHead, pre-skip 312, 48 kHz
    for (const [codec, interleave] of [['aac', false], ['aac', true], ['opus', false]] as const) {
      const frame = codec === 'aac' ? 1024 : 960;
      const audio = Array.from({ length: 70 }, (_, i) => ({ data: randomBytes(150 + ((i * 31) % 300), 5000 + i), pts: Math.round((i * frame * 1e6) / 48000), dur: Math.round((frame * 1e6) / 48000) }));
      const sink = new MemorySink();
      const m = new Mp4Muxer(sink, { codec: 'avc', codecString: 'avc1.640033', width: 1280, height: 720, fps, description: avcC });
      m.addAudioTrack(codec === 'aac'
        ? { codec, codecString: 'mp4a.40.2', sampleRate: 48000, channels: 2, description: aacConfig(48000, 2), bitrate: 192000, frames: 48000 }
        : { codec, codecString: 'opus', sampleRate: 48000, channels: 2, description: opusHead, priming: 312, bitrate: 160000, frames: 48000 });
      if (interleave) {
        // one video frame, then the audio up to its time: chunks must split wherever the tracks alternate
        let a = 0;
        for (const v of video) { m.addSample(v.data, v.key, v.pts, v.dur); while (a < audio.length && audio[a]!.pts <= v.pts + v.dur) { m.addAudioSample(audio[a]!.data, audio[a]!.pts, audio[a]!.dur); a++; } }
        for (; a < audio.length; a++) m.addAudioSample(audio[a]!.data, audio[a]!.pts, audio[a]!.dur);
      } else {
        for (const v of video) m.addSample(v.data, v.key, v.pts, v.dur);
        for (const s of audio) m.addAudioSample(s.data, s.pts, s.dur);
      }
      m.finish();
      const file = sink.bytes();
      expect(walkBoxes(file).map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov']);
      const info = readMp4(file);
      // the video track is unchanged
      expect(info.sampleCount).toBe(video.length);
      video.forEach((s, i) => expect(Array.from(file.subarray(info.offsets[i]!, info.offsets[i]! + info.sizes[i]!))).toEqual(Array.from(s.data)));
      // the sound track: entry, format, every sample byte-identical at its offset
      const au = info.audio!;
      expect(au).not.toBeNull();
      expect(au.entry).toBe(codec === 'aac' ? 'mp4a' : 'Opus');
      expect([au.channels, au.sampleRate, au.timescale]).toEqual([2, 48000, 48000]);
      expect(au.sampleCount).toBe(audio.length);
      expect(au.duration).toBeCloseTo((audio.length * frame) / 48000, 6);
      audio.forEach((s, i) => expect(Array.from(file.subarray(au.offsets[i]!, au.offsets[i]! + au.sizes[i]!))).toEqual(Array.from(s.data)));
      const moov = info.boxes.find((b) => b.type === 'moov')!;
      expect(moov.children.filter((c) => c.type === 'trak').length).toBe(2);
      const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
      const mvhd = findBox(info.boxes, 'moov/mvhd')!;
      expect(dv.getUint32(mvhd.start + mvhd.size - 4)).toBe(3); // next_track_ID
      if (codec === 'aac') {
        expect(Array.from(au.config)).toEqual(Array.from(aacConfig(48000, 2)));
        expect(Array.from(au.config)).toEqual([0x11, 0x90]); // AAC-LC, 48 kHz, stereo
        expect(au.priming).toBe(0);
      } else {
        // dOps: version 0, 2 channels, the OpusHead's pre-skip (big-endian), 48 kHz input; the edit list doesn't skip it twice
        expect(Array.from(au.config.subarray(0, 8))).toEqual([0, 2, 0x01, 0x38, 0, 0, 0xbb, 0x80]);
        expect(au.priming).toBe(0);
      }
      // the edit list plays exactly the PCM's length (the encoder pads the last frame)
      const trak = moov.children.filter((c) => c.type === 'trak')[1]!;
      const elst = findBox(trak.children, 'edts/elst')!;
      const seg = dv.getUint32(elst.start + 16);
      expect(seg).toBe(Math.round(((48000 + (codec === 'opus' ? 312 : 0)) * 1000) / 48000));
      // interleaved: more than one audio chunk, and none of them crosses a video sample
      if (interleave) {
        const stco = findBox(trak.children, 'mdia/minf/stbl/stco')!;
        expect(dv.getUint32(stco.start + 12)).toBeGreaterThan(10);
      }
    }
    // a silent clip has no sound track
    expect(readMp4(mux({ codec: 'avc', codecString: 'avc1.640033', width: 16, height: 16, fps: 30, description: avcC }, [{ data: Uint8Array.of(1), key: true, pts: 0, dur: 33333 }])).audio).toBeNull();
  });

  it('refuses audio samples before the track is declared, or after finishing', () => {
    const m = new Mp4Muxer(new MemorySink(), { codec: 'avc', codecString: 'avc1.640033', width: 16, height: 16, fps: 30, description: Uint8Array.of(1, 2, 3) });
    expect(() => m.addAudioSample(Uint8Array.of(1), 0, 21333)).toThrow(/addAudioTrack/);
    m.addAudioTrack({ codec: 'aac', codecString: 'mp4a.40.2', sampleRate: 48000, channels: 2 });
    expect(() => m.addAudioTrack({ codec: 'aac', codecString: 'mp4a.40.2', sampleRate: 48000, channels: 2 })).toThrow(/already/);
    m.addSample(Uint8Array.of(1), true, 0, 33333);
    m.finish();
    expect(() => m.addAudioSample(Uint8Array.of(1), 0, 21333)).toThrow(/finished/);
  });

  it('refuses to finish without a decoder configuration', () => {
    const m = new Mp4Muxer(new MemorySink(), { codec: 'avc', codecString: 'avc1.640033', width: 16, height: 16, fps: 30 });
    m.addSample(Uint8Array.of(1), true, 0, 33333);
    expect(() => m.finish()).toThrow(/decoder configuration/);
  });

  it('picks timescales and codec levels that fit the size and rate', () => {
    expect(mediaTimescale(60)).toBe(90000);
    expect(mediaTimescale(24)).toBe(90000);
    expect(mediaTimescale(29.97)).toBe(29970);
    expect(codecString('av1', 1920, 1080, 60)).toBe('av01.0.09M.08');
    expect(codecString('av1', 3840, 2160, 60)).toBe('av01.0.13M.08');
    expect(codecString('av1', 7680, 4320, 60)).toBe('av01.0.17M.08');
    expect(codecString('hevc', 7680, 4320, 60)).toBe('hvc1.1.6.L183.B0');
    expect(codecString('avc', 1920, 1080, 60)).toBe('avc1.64002A');
    expect(codecString('avc', 3840, 2160, 60)).toBe('avc1.640034');
    expect(codecString('avc', 7680, 4320, 60)).toBe('avc1.64003D');
    expect(codecString('avc', 16384, 8640, 60)).toBeNull();
    expect(bitrateFor('av1', 7680, 4320, 60)).toBeLessThanOrEqual(200e6);
  });
});

describe('GIF encoder', () => {
  it('LZW round-trips through dictionary resets', () => {
    const r = rng(7);
    // runs and noise: long enough to fill the 4096-code table many times
    const data = new Uint8Array(300_000);
    for (let i = 0; i < data.length;) { const v = r() & 0xff, n = 1 + (r() % 40); for (let k = 0; k < n && i < data.length; k++) data[i++] = r() % 3 === 0 ? r() & 0xff : v; }
    const enc = lzwEncode(data, 8);
    expect(Array.from(lzwDecode(enc, 8, data.length).subarray(0, 5000))).toEqual(Array.from(data.subarray(0, 5000)));
    expect(lzwDecode(enc, 8, data.length)).toEqual(data);
    expect(lzwDecode(lzwEncode(new Uint8Array(0)), 8, 0).length).toBe(0);
    expect(lzwDecode(lzwEncode(Uint8Array.of(5)), 8, 1)).toEqual(Uint8Array.of(5));
  });

  it('quantises to ≤ 255 colours and maps bins to the nearest one', () => {
    const hist = new Uint32Array(32768);
    hist[(31 << 10)] = 100; hist[31 << 5] = 50; hist[31] = 10; hist[0] = 1000;
    const pal = medianCut(hist, 255);
    expect(pal.length / 3).toBe(4);
    const lut = binLut(pal);
    const at = (k: number): number[] => Array.from(pal.subarray(lut[k]! * 3, lut[k]! * 3 + 3));
    expect(at(31 << 10)).toEqual([252, 4, 4]);
    expect(at(0)).toEqual([4, 4, 4]);
    expect(at((30 << 10) | 1)).toEqual([252, 4, 4]);
  });

  it('encodes changed rectangles over a global palette and decodes back pixel for pixel', () => {
    const W = 96, H = 64, N = 6;
    const hist = new Uint32Array(32768);
    const frames: Uint16Array[] = [];
    for (let f = 0; f < N; f++) {
      const rgba = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const inBox = x >= 10 + f * 8 && x < 30 + f * 8 && y >= 20 && y < 40;
        rgba.set(inBox ? [255, 91, 46, 255] : [x * 2, y * 3, 120, 255], o);
      }
      frames.push(toBins(rgba, W, H, hist, 1));
    }
    const delays = gifDelays(N, 25);
    expect(delays).toEqual([4, 4, 4, 4, 4, 4]);
    const gif = encodeGif(W, H, frames, delays, hist);
    const d = decodeGif(gif);
    expect([d.width, d.height, d.loop, d.frames.length]).toEqual([W, H, 0, N]);
    expect(d.frames.map((f) => f.delayCs)).toEqual(delays);
    expect(d.frames[0]).toMatchObject({ x: 0, y: 0, w: W, h: H, transparent: null });
    // later frames are only the moving box's rectangle, unchanged pixels transparent
    for (const f of d.frames.slice(1)) { expect(f.w).toBeLessThan(40); expect(f.transparent).toBe(255); expect(f.disposal).toBe(1); }
    const pal = medianCut(hist, 255), lut = binLut(pal);
    expect(Array.from(d.palette.subarray(0, pal.length))).toEqual(Array.from(pal));
    compositeGif(d).forEach((canvas, fi) => {
      for (let i = 0; i < W * H; i++) if (canvas[i] !== lut[frames[fi]![i]!]) throw new Error(`frame ${fi} pixel ${i}: ${canvas[i]} ≠ ${lut[frames[fi]![i]!]}`);
    });
  });

  it('with a tolerance, leaves near-identical pixels as shown (never further off than the tolerance)', () => {
    const W = 64, H = 32, N = 5;
    const hist = new Uint32Array(32768);
    const frames: Uint16Array[] = [];
    const r = rng(3);
    for (let f = 0; f < N; f++) {
      const rgba = new Uint8Array(W * H * 4);
      // a gradient with per-frame grain of ±6
      for (let i = 0; i < W * H; i++) { const g = (r() % 13) - 6; rgba.set([(i % W) * 4 + g, 100 + g, 180 - (i % W) + g, 255].map((v) => Math.max(0, Math.min(255, v))), i * 4); }
      frames.push(toBins(rgba, W, H, hist, 0));
    }
    const exact = encodeGif(W, H, frames, gifDelays(N, 25), hist);
    const tol = encodeGif(W, H, frames, gifDelays(N, 25), hist, undefined, 24);
    expect(tol.length).toBeLessThan(exact.length);
    const pal = medianCut(hist, 255), lut = binLut(pal);
    const d = decodeGif(tol);
    compositeGif(d).forEach((canvas, fi) => {
      for (let i = 0; i < W * H; i++) {
        const a = canvas[i]!, b = lut[frames[fi]![i]!]!;
        const dist = Math.hypot(pal[a * 3]! - pal[b * 3]!, pal[a * 3 + 1]! - pal[b * 3 + 1]!, pal[a * 3 + 2]! - pal[b * 3 + 2]!);
        if (dist > 24) throw new Error(`frame ${fi} pixel ${i} is ${dist.toFixed(1)} off`);
      }
    });
  });

  it('keeps the clip clock with whole-centisecond delays', () => {
    const d = gifDelays(30, 30);
    expect(d.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.min(...gifDelays(60, 60))).toBe(2);
  });
});

/** A minimal still WebP: RIFF WEBP + one VP8L (or VP8) chunk of the given size (the bitstream body is filler). */
function fakeStill(w: number, h: number, lossy: boolean, bodyLen = 31): Uint8Array {
  const bw = new ByteWriter();
  if (lossy) bw.u24le(0).u8(0x9d).u8(0x01).u8(0x2a).u16le(w).u16le(h).bytes(randomBytes(bodyLen, w));
  else { const v = (w - 1) | ((h - 1) << 14); bw.u8(0x2f).u32le(v).bytes(randomBytes(bodyLen, h)); }
  const img = bw.finish();
  const out = new ByteWriter();
  out.ascii('RIFF').u32le(0).ascii('WEBP').ascii(lossy ? 'VP8 ' : 'VP8L').u32le(img.length).bytes(img);
  if (img.length & 1) out.u8(0);
  out.setU32le(4, out.length - 8);
  return out.finish();
}

describe('animated WebP writer', () => {
  it('wraps still bitstreams as ANMF frames and parses back', () => {
    const fps = 60;
    const durs = webpDurations(4, fps);
    expect(durs.reduce((a, b) => a + b, 0)).toBe(67);
    const stills = [fakeStill(320, 180, true), fakeStill(64, 32, true, 40), fakeStill(64, 32, false), fakeStill(320, 180, true, 12)];
    stills.forEach((s) => expect(() => parseRiff(s)).not.toThrow());
    const frames = stills.map((s, i) => ({ data: stillToFrame(s), x: i === 1 || i === 2 ? 100 : 0, y: i === 1 || i === 2 ? 60 : 0, durationMs: durs[i]! }));
    const file = buildAnimatedWebp(320, 180, frames, 0);
    const p = parseAnimatedWebp(file);
    expect([p.width, p.height, p.loop, p.frames.length]).toEqual([320, 180, 0, 4]);
    expect(p.frames.map((f) => [f.x, f.y, f.w, f.h, f.durationMs])).toEqual([[0, 0, 320, 180, 17], [100, 60, 64, 32, 16], [100, 60, 64, 32, 17], [0, 0, 320, 180, 17]]);
    expect(p.frames.map((f) => f.chunks[0])).toEqual(['VP8 ', 'VP8 ', 'VP8L', 'VP8 ']);
    expect(p.frames.every((f) => !f.blend && !f.dispose)).toBe(true);
    expect(p.alpha).toBe(true); // a VP8L frame
  });

  it('rejects odd offsets and frames outside the canvas', () => {
    const f = stillToFrame(fakeStill(10, 10, true));
    expect(() => buildAnimatedWebp(20, 20, [{ data: f, x: 1, y: 0, durationMs: 10 }])).toThrow(/even/);
    expect(() => buildAnimatedWebp(20, 20, [{ data: f, x: 12, y: 0, durationMs: 10 }])).toThrow(/outside/);
  });
});

// The sample clips recorded in Chrome (M4_NOTES_C4): real VideoEncoder / still-encoder output through our writers.
describe('recorded samples (art/style-samples/capture)', () => {
  const dir = resolve(__dirname, '../../../art/style-samples/capture');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const load = (f: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, f)));
  it.skipIf(!files.some((f) => f.endsWith('.mp4')))('every MP4 walks back: boxes, sample table inside mdat, AV1 config', () => {
    for (const f of files.filter((x) => x.endsWith('.mp4'))) {
      const b = load(f);
      const info = readMp4(b);
      expect(walkBoxes(b).map((x) => x.type)).toEqual(['ftyp', 'mdat', 'moov']);
      expect(info.sampleCount).toBeGreaterThan(10);
      expect(info.keyFrames[0]).toBe(0);
      if (info.entry === 'av01') {
        expect(info.config[0]).toBe(0x81);
        // every sample is a run of size-delimited OBUs with no temporal delimiter
        for (let i = 0; i < info.sampleCount; i++) {
          const obus = parseObus(b.subarray(info.offsets[i]!, info.offsets[i]! + info.sizes[i]!));
          expect(obus.some((o) => o.type === 2)).toBe(false);
        }
      }
    }
  });
  it.skipIf(!files.some((f) => f.endsWith('.gif')))('every GIF decodes: frames, delays, loop', () => {
    for (const f of files.filter((x) => x.endsWith('.gif'))) {
      const d = decodeGif(load(f));
      expect(d.loop).toBe(0);
      expect(d.frames.length).toBeGreaterThan(10);
      expect(compositeGif(d).length).toBe(d.frames.length);
    }
  });
  it.skipIf(!files.some((f) => /\.webp$/.test(f)))('every animated WebP parses (stills are RIFF WEBP)', () => {
    for (const f of files.filter((x) => x.endsWith('.webp'))) {
      const b = load(f);
      const cs = parseRiff(b);
      if (cs[0]?.id === 'VP8X' && (cs[0].data[0]! & 2)) expect(parseAnimatedWebp(b).frames.length).toBeGreaterThan(10);
      else expect(cs.some((c) => c.id === 'VP8 ' || c.id === 'VP8L')).toBe(true);
    }
  });
});

describe('camera path', () => {
  const key = (t: number, x: number): CamKey => ({ t, eye: [x, 2, 5], target: [x, 0, 0], fov: 40 });
  it('passes through its keys and holds before the first and after the last', () => {
    const p = new CameraPath([key(0, 0), key(1, 1), key(2, 4), key(3, 9)]);
    expect(p.duration).toBe(3);
    for (const k of [0, 1, 2, 3]) expect(p.at(k).eye[0]).toBeCloseTo([0, 1, 4, 9][k]!, 9);
    expect(p.at(-1).eye[0]).toBe(0);
    expect(p.at(10).eye[0]).toBe(9);
    const mid = p.at(1.5).eye[0];
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(4);
  });
  it('round-trips through JSON', () => {
    const p = new CameraPath([key(0, 0), key(2, 3)]);
    expect(CameraPath.fromJSON(JSON.parse(JSON.stringify(p.toJSON()))).at(1)).toEqual(p.at(1));
  });
});
