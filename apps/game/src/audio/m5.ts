// M5 parts (GAME_SPEC §12.10, AUDIO.md §5, §11 "Future"; the "Audio hooks" rows of docs/art/briefs/future.md,
// boom.md SINGULARITY and drive.md GRABBER): procedural sounds for the ten non-Matter M5 parts and the director
// that drives them. GOO VAT (matter.md) belongs to stream X5 with the goo Matter kind: see `M5_EXTRA` below.
//
// Like M3 / M4, every part is driven three ways and whichever arrives first wins (a state fallback stays quiet
// when the matching event already played the cue within 0.3 s); unknown event kinds are ignored:
//   events  stream A5's M5 kinds (docs/dev/M5_NOTES_A5.md) plus the M2–M4 kinds the parts reuse (Signal, Powered,
//           Unpowered, Toggle, Impact, Attach, Release, Despawn, Launch, Detonate)
//   state   part(): flags (powered / armed / lit / pressed / fault), the meter byte, the `arm` body (GRABBER's
//           moving link, GRAV WELL's orb), measured motion (HOVER PAD)
// The full mapping table is in docs/dev/M5_NOTES_F5.md.

import { impact, type Recipe } from './bank';
import { beep, click, snaps } from './m4';
import { F } from './mech';
import { hash01, hashStr, type Rng } from './rng';
import {
  SR, alloc, bp, brown, bubble, chirp, contact, envAD, envFn, fadeEdges, glide, hp, lp, mixInto, modal, normalize, reverse,
  seamless, sweep, voice, white,
} from './synth';
import { Motion, clamp, fin, finite3, type AudioHost, type LoopKind, type LoopOpts, type M5LoopKind, type SimEventLike, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);
const TAU = Math.PI * 2;

// ============================================================================================
// building blocks
// ============================================================================================

/** Band-passed noise whose centre follows f(t) (whooshes and zips). */
function whoosh(sec: number, f: (t: number) => number, amp: (t: number) => number, rng: Rng, q = 1.2): Float32Array {
  const x = white(at(sec), rng);
  sweep(x, 'bp', f, q);
  return envFn(x, amp);
}

/** A seamless loop of `sec` seconds built by `gen` (cross-faded 0.25 s). */
const loopOf = (sec: number, gen: (len: number) => Float32Array, peak = 0.3): Float32Array => normalize(seamless(sec, 0.25, gen), peak);

/** A sum of sines with per-partial amplitude, pitch contour f(t) and amplitude a(t). */
function partials(len: number, f: (t: number) => number, a: (t: number) => number, amps: readonly number[]): Float32Array {
  const x = new Float32Array(len);
  const ph = amps.map(() => 0);
  for (let i = 0; i < len; i++) {
    const t = i / SR, fr = f(t), g = a(t);
    let s = 0;
    for (let k = 0; k < amps.length; k++) { ph[k] = ph[k]! + TAU * fr * (k + 1) / SR; s += amps[k]! * Math.sin(ph[k]!); }
    x[i] = s * g;
  }
  return x;
}

// ============================================================================================
// RIFT GATES (future.md: rift_hum, rift_in, rift_out, rift_cooldown_tick, rift_bonk)
// ============================================================================================

function riftHum(rng: Rng): Float32Array {
  return loopOf(4, (n) => {
    // a soft, slightly unstable portal tone: 55 / 110 Hz with a slow beat, a swirling 660 Hz glint, a shimmering hiss
    const x = partials(n, (t) => 55 * (1 + 0.004 * Math.sin(TAU * 0.25 * t)), (t) => 0.8 + 0.2 * Math.sin(TAU * 0.5 * t), [0.6, 1, 0.25, 0.12]);
    mixInto(x, chirp(n, (t) => 660 + 25 * Math.sin(TAU * 0.5 * t), (t) => 0.12 * (0.6 + 0.4 * Math.sin(TAU * 0.25 * t + 1))));
    const sh = bp(white(n, rng), 3200, 0.8);
    envFn(sh, (t) => 0.5 + 0.5 * Math.sin(TAU * 13 * t) * Math.sin(TAU * 0.5 * t));
    mixInto(x, normalize(sh, 0.12));
    return x;
  }, 0.3);
}

function riftIn(rng: Rng): Float32Array {
  // whoosh-suck: a band of air pulled down into the membrane, swelling, then a soft sub "thup" as it closes
  const sec = 0.5, k = 0.9 + 0.2 * rng.next();
  const x = whoosh(sec, (t) => 4500 * k * Math.pow(300 / 4500, t / sec), (t) => Math.pow(Math.min(1, t / 0.4), 2) * (t > 0.42 ? Math.max(0, 1 - (t - 0.42) / 0.04) : 1), rng, 1.6);
  normalize(x, 0.7);
  mixInto(x, chirp(at(0.15), glide(130 * k, 48, 0.04), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.05)), at(0.4), 0.8);
  return fadeEdges(normalize(x, 0.38));
}

function riftOut(rng: Rng): Float32Array {
  // pop-whoosh: a bright pop, then air flung out and away
  const x = alloc(0.6);
  const k = 0.9 + 0.2 * rng.next();
  mixInto(x, chirp(at(0.06), glide(1100 * k, 320, 0.012), (t) => Math.exp(-t / 0.012)), 0, 0.8);
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0002, 0.002), 2500), 0.5));
  mixInto(x, normalize(whoosh(0.5, (t) => 400 * Math.pow(5500 * k / 400, Math.min(1, t / 0.3)), (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.14), rng, 1.3), 0.6), at(0.01));
  return fadeEdges(normalize(x, 0.38));
}

function riftTick(rng: Rng): Float32Array {
  const x = alloc(0.2);
  mixInto(x, click(3300 * (0.97 + 0.06 * rng.next()), 0.006, rng, 0.0001, 2.1));
  mixInto(x, modal(at(0.2), contact(0.0001, rng), [{ f: 2637, amp: 1, tau: 0.06 }]), at(0.002), 0.25);
  return fadeEdges(normalize(x, 0.2));
}

function riftBonk(rng: Rng): Float32Array {
  // a body bounced off the membrane in its cooldown: rubbery, wobbling, a little indignant
  const sec = 0.45, f0 = 260 + 60 * rng.next();
  const x = chirp(at(sec), (t) => f0 * (1 - 0.35 * Math.min(1, t / 0.2)) * (1 + 0.06 * Math.sin(TAU * 17 * t)), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.12));
  mixInto(x, chirp(at(sec), (t) => 2 * f0 * (1 - 0.3 * Math.min(1, t / 0.2)), (t) => 0.3 * Math.exp(-t / 0.06)));
  mixInto(x, normalize(lp(envAD(white(at(0.04), rng), 0.001, 0.01), 1200), 0.4));
  return fadeEdges(normalize(x, 0.36));
}

// ============================================================================================
// GRAV WELL (future.md: grav_spinup, grav_loop, grav_drop_clack, grav_underpower, grav_capture_whoomp)
// ============================================================================================

function gravSpinup(rng: Rng): Float32Array {
  const sec = 0.75;
  const x = partials(at(sec), (t) => 70 + 260 * Math.pow(Math.min(1, t / 0.6), 1.5), (t) => Math.min(1, t / 0.5) * (t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.1) : 1), [1, 0.5, 0.3, 0.15]);
  normalize(x, 0.6);
  snaps(x, rng, (t) => (t < 0.45 ? 120 : 0), 0.35); // arcs from the arm tips to the orb
  mixInto(x, chirp(at(0.3), () => 50, (t) => 0.5 * Math.min(1, t / 0.05) * Math.exp(-t / 0.15)), at(0.5)); // the field blooming
  return fadeEdges(normalize(x, 0.36));
}

function gravLoop(rng: Rng, repel: boolean): Float32Array {
  return loopOf(2, (n) => {
    // sub-bass hum; attract: the pitch dips down twice a second ("wobbles down"), air drawn in.
    // Repel (beta, D127: its own sound) is the attract hum turned inside out: a fifth higher (75 Hz) with brighter
    // partials, the pitch bumping UP twice a second, glints sweeping upward and outward, and air pushed out (each
    // half-second's swell starts hard and fades, the attract's envelope reversed)
    const x = partials(n, (t) => {
      const ph = (t * 2) % 1;
      return repel ? 75 * (1 + 0.07 * Math.pow(Math.sin(Math.PI * ph), 2)) : 50 * (1 - 0.07 * Math.pow(Math.sin(Math.PI * ph), 2));
    }, () => 1, repel ? [1, 0.75, 0.55, 0.35, 0.22, 0.12] : [1, 0.55, 0.25, 0.1]);
    mixInto(x, normalize(lp(brown(n, rng), repel ? 260 : 160), repel ? 0.18 : 0.25));
    if (repel) {
      for (let k = 0; k < 8; k++) {
        const t0 = k * 0.25, f0 = 1300 + 400 * rng.next();
        mixInto(x, chirp(at(0.22), (t) => f0 * (1 + 1.5 * t / 0.22), (t) => 0.16 * Math.sin(Math.PI * t / 0.22)), at(t0));
      }
      const air = bp(white(n, rng), 1800, 0.7);
      envFn(air, (t) => { const ph = (t * 2) % 1; return 0.25 + 0.75 * Math.exp(-ph / 0.18); });
      mixInto(x, normalize(air, 0.14));
    } else {
      const air = lp(white(n, rng), 600);
      envFn(air, (t) => 0.4 + 0.6 * Math.pow(Math.sin(Math.PI * ((t * 2) % 1)), 2));
      mixInto(x, normalize(air, 0.15));
    }
    return x;
  }, 0.32);
}

function gravClack(rng: Rng): Float32Array {
  // the polished orb dropping into its three-armed cradle: a weighty steel clack and a short ring
  const x = alloc(0.5);
  mixInto(x, modal(at(0.5), contact(0.0004, rng, 0.2), [{ f: 1650 + 200 * rng.next(), amp: 1, tau: 0.05 }, { f: 3900 + 400 * rng.next(), amp: 0.5, tau: 0.03 }, { f: 230, amp: 0.8, tau: 0.04 }]));
  mixInto(x, impact('steel', 1, rng), at(0.006), 0.4);
  mixInto(x, modal(at(0.15), contact(0.0003, rng), [{ f: 1900, amp: 1, tau: 0.02 }]), at(0.07 + 0.03 * rng.next()), 0.25); // a small settle
  return fadeEdges(normalize(x, 0.36));
}

function gravStutter(rng: Rng): Float32Array {
  const sec = 0.7;
  const x = partials(at(sec), (t) => 50 * (1 - 0.15 * t / sec), (t) => (Math.sin(TAU * 11 * t) > -0.2 ? 1 : 0.15) * Math.min(1, t / 0.02) * Math.max(0, 1 - t / sec), [1, 0.6, 0.3]);
  snaps(x, rng, () => 25, 0.25);
  return fadeEdges(normalize(lp(x, 2500), 0.34));
}

function gravWhoomp(rng: Rng): Float32Array {
  // a body pulled into the core: air rushing in, then a deep soft thump
  const x = whoosh(0.4, (t) => 250 * Math.pow(1400 / 250, Math.min(1, t / 0.3)), (t) => Math.pow(Math.min(1, t / 0.3), 1.5) * (t > 0.3 ? Math.max(0, 1 - (t - 0.3) / 0.05) : 1), rng, 0.9);
  normalize(x, 0.5);
  const y = alloc(0.8);
  mixInto(y, x);
  mixInto(y, chirp(at(0.45), glide(95, 42, 0.06), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.12)), at(0.3), 0.9);
  return fadeEdges(normalize(y, 0.38));
}

// ============================================================================================
// TRACTOR BEAM (future.md: tractor_on, tractor_loop (warble, depth ∝ load), tractor_capture, tractor_release, tractor_strain)
// ============================================================================================

function tractorOn(rng: Rng): Float32Array {
  const sec = 0.5;
  const x = chirp(at(sec), (t) => (300 + 600 * Math.min(1, t / 0.35)) * (1 + 0.03 * Math.min(1, t / 0.35) * Math.sin(TAU * 7 * t)), (t) => Math.min(1, t / 0.03) * (t > 0.38 ? Math.exp(-(t - 0.38) / 0.04) : 1));
  mixInto(x, chirp(at(sec), (t) => 2 * (300 + 600 * Math.min(1, t / 0.35)), (t) => 0.25 * Math.min(1, t / 0.1) * (t > 0.38 ? Math.exp(-(t - 0.38) / 0.04) : 1)));
  mixInto(x, click(2200, 0.008, rng, 0.0002), 0, 0.4);
  return fadeEdges(normalize(x, 0.32));
}

function tractorLoop(rng: Rng, deep: boolean): Float32Array {
  return loopOf(2, (n) => {
    // the beam's warble: an FM'd tone (6 Hz) with a soft octave and an airy hiss; the deep layer (load) is slower and wider
    const f0 = deep ? 210 : 420, vib = deep ? 0.12 : 0.06, rate = deep ? 4 : 6;
    const x = partials(n, (t) => f0 * (1 + vib * Math.sin(TAU * rate * t)), (t) => 0.8 + 0.2 * Math.sin(TAU * 3 * t), deep ? [1, 0.5, 0.3, 0.15] : [1, 0.35, 0.1]);
    mixInto(x, normalize(bp(white(n, rng), deep ? 900 : 2200, 1), deep ? 0.08 : 0.12));
    return x;
  }, 0.3);
}

function tractorCapture(rng: Rng): Float32Array {
  const x = bubble(0.22, 280 + 60 * rng.next(), 1.6, 0.06);
  mixInto(x, chirp(at(0.12), glide(160, 90, 0.03), (t) => 0.5 * Math.exp(-t / 0.04)));
  return fadeEdges(normalize(x, 0.34));
}

function tractorRelease(rng: Rng): Float32Array {
  const sec = 0.35, f0 = 620 + 80 * rng.next();
  const x = chirp(at(sec), (t) => f0 * Math.pow(0.4, t / sec), (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.12));
  mixInto(x, chirp(at(sec), (t) => 1.5 * f0 * Math.pow(0.4, t / sec), (t) => 0.2 * Math.exp(-t / 0.08)));
  return fadeEdges(normalize(x, 0.28));
}

function tractorStrain(rng: Rng): Float32Array {
  const sec = 0.8;
  const n = at(sec);
  const x = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p += (180 * (1 + 0.06 * Math.sin(TAU * 9 * t)) * (1 - 0.08 * t)) / SR;
    x[i] = (2 * (p % 1) - 1) * Math.sin(Math.PI * Math.min(1, t / sec));
  }
  lp(x, 1800);
  mixInto(x, normalize(bp(white(n, rng), 1200, 2), 0.15));
  return fadeEdges(normalize(x, 0.3));
}

// ============================================================================================
// HOVER PAD (future.md: hover_hum (pitch ∝ load), hover_powerdown, hover_land_clunk, hover_overload_warble, hover_thruster_flutter)
// ============================================================================================

function hoverHum(rng: Rng): Float32Array {
  return loopOf(2, (n) => {
    const x = partials(n, (t) => 100 * (1 + 0.003 * Math.sin(TAU * 0.5 * t)), () => 1, [1, 0.45, 0.3, 0.12, 0.08]);
    mixInto(x, partials(n, () => 101.5, () => 1, [0.35]));
    mixInto(x, normalize(bp(white(n, rng), 1500, 0.6), 0.1)); // four thrusters' soft hush
    return x;
  }, 0.3);
}

function hoverFlutter(rng: Rng): Float32Array {
  return loopOf(1, (n) => { const x = bp(white(n, rng), 900, 0.7); envFn(x, (t) => 0.5 + 0.5 * Math.sin(TAU * 22 * t)); return x; }, 0.3);
}

function hoverPowerdown(rng: Rng): Float32Array {
  const sec = 1.2;
  const x = partials(at(sec), (t) => 80 + 520 * Math.exp(-t / 0.3), (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.45), [1, 0.4, 0.2]);
  normalize(x, 0.6);
  snaps(x, rng, (t) => (t < 0.15 ? 200 : 0), 0.4); // the edge spark spit
  return fadeEdges(normalize(x, 0.34));
}

function hoverLand(rng: Rng): Float32Array {
  const x = impact('poly', 2, rng);
  mixInto(x, chirp(at(0.25), glide(110, 60, 0.03), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.06)), 0, 0.8);
  mixInto(x, impact('rubber', 1, rng), at(0.004), 0.4);
  return fadeEdges(normalize(x, 0.38));
}

function hoverOverload(rng: Rng): Float32Array {
  const sec = 0.9;
  const x = chirp(at(sec), (t) => (Math.sin(TAU * 6 * t) > 0 ? 480 : 360) * (1 - 0.12 * t / sec), (t) => 0.8 * Math.sin(Math.PI * t / sec));
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(2 * x[i]!);
  mixInto(x, normalize(bp(white(x.length, rng), 1500, 1), 0.08));
  return fadeEdges(normalize(lp(x, 4000), 0.28));
}

// ============================================================================================
// FORCE WALL (future.md: wall_on (rising zip), wall_off (falling zip), wall_hum (gain ∝ area), wall_ripple, wall_critter_boing)
// ============================================================================================

function zip(up: boolean, rng: Rng): Float32Array {
  const sec = up ? 0.32 : 0.26;
  const u = (t: number): number => (up ? t / sec : 1 - t / sec);
  const x = whoosh(sec, (t) => 500 * Math.pow(12, u(t)), (t) => Math.sin(Math.PI * Math.min(1, t / sec)) ** 0.7, rng, 2);
  normalize(x, 0.6);
  // the lattice printing in: a buzzing saw that climbs (or falls) with the zip
  const n = x.length;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p += (120 * Math.pow(5, u(t))) / SR;
    x[i] = x[i]! + 0.25 * (2 * (p % 1) - 1) * Math.sin(Math.PI * Math.min(1, t / sec));
  }
  return fadeEdges(normalize(lp(x, 9000), 0.32));
}

function wallHum(rng: Rng): Float32Array {
  return loopOf(2, (n) => {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      x[i] = Math.sin(TAU * 120 * t) + 0.5 * Math.tanh(3 * Math.sin(TAU * 240 * t)) + 0.2 * Math.sin(TAU * 360 * t) + 0.15 * Math.sin(TAU * 60.5 * t);
    }
    normalize(x, 1);
    snaps(x, rng, () => 4, 0.15); // faint field crackle
    mixInto(x, normalize(hp(white(n, rng), 6000), 0.03));
    return x;
  }, 0.28);
}

function wallRipple(rng: Rng): Float32Array {
  // a soft "thoom": the hex lattice taking a hit and ringing outward
  const sec = 0.6, f0 = 150 + 30 * rng.next();
  const x = partials(at(sec), (t) => f0 * (0.62 + 0.38 * Math.exp(-t / 0.06)), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.16), [1, 0.35, 0.15]);
  mixInto(x, normalize(whoosh(sec, (t) => 1800 * Math.exp(-t / 0.2) + 300, (t) => Math.exp(-t / 0.08), rng, 1), 0.25));
  mixInto(x, chirp(at(0.3), (t) => 1200 + 400 * Math.sin(TAU * 30 * t), (t) => 0.06 * Math.exp(-t / 0.06)));
  return fadeEdges(normalize(x, 0.36));
}

function wallBoing(rng: Rng): Float32Array {
  // a critter bounced softly off the wall: a springy cartoon boing (never a zap)
  const sec = 0.5, f0 = 240 + 50 * rng.next();
  const x = chirp(at(sec), (t) => f0 * (1 + 0.5 * Math.sin(TAU * 13 * t) * Math.exp(-t / 0.15)), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.16));
  mixInto(x, impact('rubber', 0, rng), 0, 0.4);
  return fadeEdges(normalize(x, 0.34));
}

// ============================================================================================
// COILGUN RING (future.md: coil_charge, coil_ready, coil_fire (pitch by Δv), coil_idle_hum, coil_pass_dud)
// ============================================================================================

function coilCharge(rng: Rng): Float32Array {
  const sec = 0.55;
  const x = partials(at(sec), (t) => 380 * Math.pow(2400 / 380, Math.min(1, t / 0.5)), (t) => Math.min(1, t / 0.05) * (0.4 + 0.6 * t / sec) * (t > 0.5 ? Math.max(0, 1 - (t - 0.5) / 0.05) : 1), [1, 0.3, 0.12]);
  mixInto(x, normalize(hp(white(x.length, rng), 5000), 0.05));
  return fadeEdges(normalize(x, 0.24));
}

function coilReady(rng: Rng): Float32Array {
  return fadeEdges(normalize(modal(at(0.5), contact(0.0001, rng), [{ f: 2637, amp: 1, tau: 0.22 }, { f: 5274, amp: 0.25, tau: 0.08 }, { f: 3951, amp: 0.15, tau: 0.1 }]), 0.26));
}

function coilFire(rng: Rng): Float32Array {
  // six coils firing in sequence (the LED chase in 0.1 s), a deep magnetic thunk, an electric snap, a zap tail
  const x = alloc(0.7);
  for (let k = 0; k < 6; k++) mixInto(x, click(900 + 260 * k, 0.012, rng, 0.0002, 1.9), at(k * 0.017), 0.35);
  mixInto(x, chirp(at(0.4), glide(120, 44, 0.05), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.1)), at(0.09), 1);
  mixInto(x, normalize(hp(envAD(white(at(0.02), rng), 0.0001, 0.003), 2000), 0.7), at(0.09));
  mixInto(x, impact('steel', 1, rng), at(0.095), 0.3);
  const z = chirp(at(0.3), (t) => 1600 * Math.exp(-t / 0.08) + 200, (t) => Math.exp(-t / 0.07));
  for (let i = 0; i < z.length; i++) z[i] = Math.sign(z[i]!) * Math.pow(Math.abs(z[i]!), 0.5);
  mixInto(x, z, at(0.1), 0.25);
  return fadeEdges(normalize(x, 0.4));
}

function coilHum(rng: Rng): Float32Array {
  return loopOf(2, (n) => {
    const x = partials(n, () => 100, () => 1, [1, 0.6, 0.2, 0.1]);
    mixInto(x, chirp(n, () => 2000, () => 0.06));
    mixInto(x, normalize(bp(white(n, rng), 300, 1), 0.06));
    return x;
  }, 0.24);
}

function coilDud(rng: Rng): Float32Array {
  return fadeEdges(normalize(whoosh(0.35, (t) => 700 + 1200 * Math.sin(Math.PI * t / 0.35), (t) => Math.sin(Math.PI * t / 0.35), rng, 1.1), 0.24));
}

// ============================================================================================
// STASIS FIELD (future.md: stasis_engage, stasis_loop (low choral drone + slowed clock tick), stasis_release, stasis_body_ting)
// ============================================================================================

function glassChime(rng: Rng, f: number, tau = 0.7): Float32Array {
  return modal(at(Math.min(2, tau * 3)), contact(0.0001, rng), [{ f, amp: 1, tau }, { f: f * 1.5, amp: 0.4, tau: tau * 0.7 }, { f: f * 2.76, amp: 0.25, tau: tau * 0.4 }, { f: f * 4.07, amp: 0.1, tau: tau * 0.25 }]);
}

function stasisEngage(rng: Rng): Float32Array {
  // a reverse swell sucked into the moment, and a glassy chime as time stops
  // a short reverse swell (0.25 s: it can't start before the event) into the chime
  const swell = reverse(envAD(lp(white(at(0.25), rng), 3000), 0.002, 0.08));
  mixInto(swell, reverse(partials(at(0.25), () => 330, (t) => Math.exp(-t / 0.08), [1, 0.5, 0.25])), 0, 0.3);
  normalize(swell, 0.6);
  const x = alloc(1.6);
  mixInto(x, swell);
  mixInto(x, glassChime(rng, 1568 * (0.98 + 0.04 * rng.next())), at(0.24), 0.7);
  return fadeEdges(normalize(x, 0.36));
}

function stasisLoop(rng: Rng): Float32Array {
  return loopOf(4, (n) => {
    const sec = n / SR;
    // a low choral "ooh" (two formant voices a fifth apart, breathing slowly), and a slowed clock: one deep tick a second
    const ooh = (f: number) => [{ f: 320, bw: 70, amp: 1 }, { f: 700, bw: 110, amp: 0.35 }, { f: 2500, bw: 300, amp: 0.06 }].map((x) => ({ ...x, f: x.f * (f > 130 ? 1.05 : 1) }));
    const x = voice(sec, (t) => 110 * (1 + 0.003 * Math.sin(TAU * 0.5 * t)), () => ooh(110), (t) => 0.7 + 0.3 * Math.sin(TAU * 0.25 * t), rng, { breath: 0.08, jitter: 0.004 });
    mixInto(x, voice(sec, (t) => 165 * (1 + 0.003 * Math.sin(TAU * 0.5 * t + 1)), () => ooh(165), (t) => 0.6 + 0.4 * Math.sin(TAU * 0.25 * t + 2), rng, { breath: 0.08, jitter: 0.004 }), 0, 0.6);
    normalize(x, 0.8);
    for (let k = 0; k < Math.round(sec); k++) mixInto(x, modal(at(0.4), contact(0.0006, rng), [{ f: 520, amp: 1, tau: 0.08 }, { f: 1300, amp: 0.3, tau: 0.04 }]), at(k + 0.3), 0.35);
    return x;
  }, 0.3);
}

function stasisRelease(rng: Rng): Float32Array {
  // time snaps back: an upward rush into a crisp snap, then airy sparkle
  const x = alloc(0.8);
  mixInto(x, normalize(whoosh(0.28, (t) => 300 * Math.pow(20, t / 0.28), (t) => Math.pow(t / 0.28, 2), rng, 1.4), 0.6));
  mixInto(x, normalize(hp(envAD(white(at(0.015), rng), 0.0001, 0.002), 1500), 0.8), at(0.28));
  mixInto(x, click(1800, 0.01, rng, 0.0002), at(0.28), 0.5);
  snaps(x, rng, (t) => (t > 0.3 && t < 0.7 ? 60 : 0), 0.2);
  return fadeEdges(normalize(x, 0.36));
}

function stasisTing(rng: Rng): Float32Array { return fadeEdges(normalize(glassChime(rng, 3136 * (0.97 + 0.06 * rng.next()), 0.25), 0.22)); }

// ============================================================================================
// BUZZ BEACON (critters.md Notes: the landing pad; its `call` Signal sends BUZZ out)
// ============================================================================================

function beaconCall(rng: Rng): Float32Array {
  const x = alloc(0.35);
  for (let k = 0; k < 2; k++) mixInto(x, chirp(at(0.07), (t) => (1320 + 440 * t / 0.07) * (k ? 1.12 : 1), (t) => Math.sin(Math.PI * t / 0.07)), at(k * 0.12), 0.8);
  hp(x, 400);
  mixInto(x, normalize(bp(white(x.length, rng), 2500, 1), 0.02));
  return fadeEdges(normalize(lp(x, 4000), 0.26));
}

function beaconDock(rng: Rng): Float32Array {
  const x = impact('poly', 1, rng);
  mixInto(x, chirp(at(0.15), glide(190, 110, 0.03), (t) => Math.exp(-t / 0.04)), 0, 0.6);
  mixInto(x, click(2400, 0.01, rng, 0.0002), at(0.06), 0.4); // the latch
  return fadeEdges(normalize(x, 0.32));
}

// ============================================================================================
// SINGULARITY (boom.md: arm_click, spin_up, pull_loop (∝ captured mass), recycle_pop, collapse (implosion + 150 ms silence), vent_hiss)
// ============================================================================================

function singArm(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, click(1450, 0.02, rng, 0.0004, 1.7));
  mixInto(x, impact('steel', 0, rng), at(0.004), 0.5);
  mixInto(x, click(3100, 0.005, rng, 0.0001), at(0.05), 0.3); // the relay behind it
  return fadeEdges(normalize(x, 0.34));
}

function singSpinup(rng: Rng): Float32Array {
  const sec = 0.6;
  const x = partials(at(sec), (t) => 180 * Math.pow(1500 / 180, Math.min(1, t / 0.5)), (t) => Math.min(1, t / 0.4) * (t > 0.52 ? Math.max(0, 1 - (t - 0.52) / 0.08) : 1), [1, 0.4, 0.2]);
  mixInto(x, partials(at(sec), (t) => 30 + 30 * t / sec, (t) => 0.7 * Math.min(1, t / 0.5), [1, 0.5]));
  mixInto(x, normalize(hp(white(x.length, rng), 3000), 0.05));
  return fadeEdges(normalize(x, 0.34));
}

function singPull(rng: Rng): Float32Array {
  return loopOf(3, (n) => {
    // the sub-bass drone (36 / 54 Hz) pulsing, under reverse whooshes: air streaming into the core every 1.5 s
    const x = partials(n, (t) => 36 * (1 + 0.01 * Math.sin(TAU * (1 / 3) * t)), (t) => 0.75 + 0.25 * Math.sin(TAU * (2 / 3) * t), [1, 0.3, 0.6, 0.15]);
    normalize(x, 1);
    for (let k = 0; k < 2; k++) {
      const w = reverse(envAD(bp(white(at(1.4), rng), 600 + 300 * k, 0.7), 0.002, 0.4));
      mixInto(x, normalize(w, 0.35), at(k * 1.5));
    }
    mixInto(x, normalize(lp(brown(n, rng), 120), 0.3));
    return x;
  }, 0.36);
}

function singPop(rng: Rng): Float32Array {
  // a body recycled: sucked in (a tiny reverse swell), then a hollow "thoomp-pop"
  const x = alloc(0.35);
  mixInto(x, normalize(reverse(envAD(bp(white(at(0.12), rng), 1400, 1), 0.001, 0.03)), 0.35));
  mixInto(x, chirp(at(0.2), glide(420 * (0.85 + 0.3 * rng.next()), 110, 0.02), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.04)), at(0.12), 0.9);
  mixInto(x, normalize(hp(envAD(white(at(0.01), rng), 0.0001, 0.002), 2000), 0.25), at(0.12));
  return fadeEdges(normalize(x, 0.34));
}

function singImplode(rng: Rng): Float32Array {
  // 1.0 s that ends exactly on the collapse: everything rushing inward (a reversed boom), cut dead at the end
  const sec = 1.0, n = at(sec);
  const body = alloc(sec);
  mixInto(body, partials(n, (t) => 45 + 40 * Math.exp(-t / 0.2), (t) => Math.exp(-t / 0.35), [1, 0.5, 0.2]));
  mixInto(body, normalize(lp(envAD(white(n, rng), 0.001, 0.3), 900), 0.8));
  reverse(body);
  envFn(body, (t) => Math.pow(t / sec, 1.5));
  for (let i = n - at(0.004); i < n; i++) body[i] = body[i]! * Math.max(0, (n - i) / at(0.004));
  return normalize(body, 0.42);
}

function singCollapse(rng: Rng): Float32Array {
  // after the 150 ms of silence: the aftermath, a huge soft low "thoom" ringing out and the rings braking
  const x = alloc(2.4);
  mixInto(x, partials(at(2.4), (t) => 28 + 44 * Math.exp(-t / 0.12), (t) => Math.min(1, t / 0.006) * Math.exp(-t / 0.7), [1, 0.4, 0.25, 0.1]));
  mixInto(x, normalize(lp(envAD(white(at(1.5), rng), 0.003, 0.35), 500), 0.5));
  mixInto(x, chirp(at(1.2), (t) => 900 * Math.exp(-t / 0.4) + 120, (t) => 0.08 * Math.exp(-t / 0.4)), at(0.05)); // rings braking
  return fadeEdges(normalize(x, 0.44), 0.001, 0.2);
}

function singVent(rng: Rng): Float32Array {
  const sec = 3.2;
  const x = hp(white(at(sec), rng), 1500);
  envFn(x, (t) => Math.min(1, t / 0.08) * Math.exp(-t / 1.1) * (0.8 + 0.2 * Math.sin(TAU * 7 * t)));
  mixInto(x, normalize(bp(white(at(sec), rng), 4500, 2), 0.2));
  return fadeEdges(normalize(lp(x, 9000), 0.26), 0.01, 0.3);
}

function singSpit(rng: Rng): Float32Array {
  // a critter spat back out (never recycled): a comic "ptoo" and a boing
  const x = alloc(0.6);
  mixInto(x, chirp(at(0.12), (t) => 300 + 900 * t / 0.12, (t) => Math.sin(Math.PI * t / 0.12)), 0, 0.6);
  mixInto(x, chirp(at(0.45), (t) => 260 * (1 + 0.4 * Math.sin(TAU * 12 * t) * Math.exp(-t / 0.12)), (t) => Math.exp(-t / 0.14)), at(0.1), 0.7);
  return fadeEdges(normalize(x, 0.34));
}

// ============================================================================================
// GRABBER (drive.md: servo_whine_loop (pitch ∝ joint speed), gripper_close_click, gripper_open, grabber_park_clunk, grabber_shrug_beep)
// ============================================================================================

function servoLoop(rng: Rng): Float32Array {
  return loopOf(1, (n) => {
    // the joint servo: a geared whine (1.1 kHz with its octave) over a little motor hiss
    const x = partials(n, () => 1100, () => 1, [1, 0.35, 0.12]);
    mixInto(x, normalize(bp(white(n, rng), 2500, 0.7), 0.15));
    // gear teeth in the clear caps: a fine tick train
    for (let k = 0; k < Math.floor(60 * n / SR); k++) mixInto(x, click(4200, 0.002, rng, 0.00005), at(k / 60), 0.06);
    return x;
  }, 0.24);
}

function gripClose(rng: Rng): Float32Array {
  const x = alloc(0.2);
  mixInto(x, click(2400, 0.008, rng, 0.0002));
  mixInto(x, click(1700, 0.012, rng, 0.0003), at(0.03), 0.8);
  mixInto(x, impact('rubber', 0, rng), at(0.035), 0.3); // the grip pads closing on it
  return fadeEdges(normalize(x, 0.3));
}

function gripOpen(rng: Rng): Float32Array {
  const x = alloc(0.25);
  mixInto(x, chirp(at(0.08), (t) => 1600 + 800 * t / 0.08, (t) => 0.4 * Math.sin(Math.PI * t / 0.08)));
  mixInto(x, click(2000, 0.01, rng, 0.0002), at(0.08), 0.7);
  return fadeEdges(normalize(x, 0.26));
}

function grabPark(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, chirp(at(0.25), (t) => 1300 * Math.pow(0.5, t / 0.25), (t) => 0.4 * Math.exp(-t / 0.1))); // the servo winding down
  mixInto(x, impact('poly', 1, rng), at(0.2), 0.8);
  return fadeEdges(normalize(x, 0.32));
}

function grabShrug(): Float32Array {
  const x = alloc(0.4);
  mixInto(x, beep(at(0.12), 880, 1.4));
  mixInto(x, beep(at(0.16), 660, 1.4), at(0.17));
  return fadeEdges(normalize(lp(x, 5000), 0.24));
}

// ============================================================================================
// recipes, loop parameters
// ============================================================================================

export function m5Recipes(): Recipe[] {
  return [
    // RIFT GATES
    ['loop/rift', 1, riftHum], ['rift/in', 4, riftIn], ['rift/out', 4, riftOut], ['rift/tick', 2, riftTick], ['rift/bonk', 3, riftBonk],
    // GRAV WELL
    ['grav/spinup', 2, gravSpinup], ['loop/grav_attract', 1, (g) => gravLoop(g, false)], ['loop/grav_repel', 1, (g) => gravLoop(g, true)],
    ['grav/clack', 3, gravClack], ['grav/stutter', 2, gravStutter], ['grav/whoomp', 3, gravWhoomp],
    // TRACTOR BEAM
    ['tractor/on', 2, tractorOn], ['loop/tractor', 1, (g) => tractorLoop(g, false)], ['loop/tractor_load', 1, (g) => tractorLoop(g, true)],
    ['tractor/capture', 3, tractorCapture], ['tractor/release', 2, tractorRelease], ['tractor/strain', 2, tractorStrain],
    // HOVER PAD
    ['loop/hover', 1, hoverHum], ['loop/hover_flutter', 1, hoverFlutter], ['hover/powerdown', 2, hoverPowerdown], ['hover/land', 3, hoverLand], ['hover/overload', 2, hoverOverload],
    // FORCE WALL
    ['wall/on', 2, (g) => zip(true, g)], ['wall/off', 2, (g) => zip(false, g)], ['loop/wall', 1, wallHum], ['wall/ripple', 4, wallRipple], ['wall/boing', 3, wallBoing],
    // COILGUN RING
    ['coil/charge', 2, coilCharge], ['coil/ready', 2, coilReady], ['coil/fire', 4, coilFire], ['loop/coil_hum', 1, coilHum], ['coil/dud', 3, coilDud],
    // STASIS FIELD
    ['stasis/engage', 2, stasisEngage], ['loop/stasis', 1, stasisLoop], ['stasis/release', 2, stasisRelease], ['stasis/ting', 3, stasisTing],
    // BUZZ BEACON
    ['beacon/call', 2, beaconCall], ['beacon/dock', 2, beaconDock],
    // SINGULARITY
    ['sing/arm', 2, singArm], ['sing/spinup', 1, singSpinup], ['loop/sing_pull', 1, singPull], ['sing/pop', 4, singPop],
    ['sing/implode', 1, singImplode], ['sing/collapse', 2, singCollapse], ['sing/vent', 2, singVent], ['sing/spit', 2, singSpit],
    // GRABBER
    ['loop/servo', 1, servoLoop], ['grab/close', 3, gripClose], ['grab/open', 2, gripOpen], ['grab/park', 2, grabPark], ['grab/shrug', 2, () => grabShrug()],
  ];
}

type LP = { gain: number; rate: number; cutoff: number };
/** Loop parameters for the M5 kinds (index.ts loopParams): level = intensity, aux = variant tweak. BUZZ's are in buzz.ts. */
export const M5_LOOPS: Readonly<Partial<Record<M5LoopKind, (x: number, aux: number) => LP>>> = {
  rift: (x) => ({ gain: 0.16 * Math.min(x, 1.6), rate: 0.95 + 0.12 * Math.min(x - 1, 0.6), cutoff: 6000 + 6000 * Math.min(x - 1, 0.6) }),
  grav_attract: (x) => ({ gain: 0.55 * (0.35 + 0.65 * Math.min(x, 1.2)), rate: 0.75 + 0.3 * Math.min(x, 1.2), cutoff: 500 + 3500 * Math.min(x, 1) }),
  grav_repel: (x) => ({ gain: 0.5 * (0.35 + 0.65 * Math.min(x, 1.2)), rate: 0.8 + 0.3 * Math.min(x, 1.2), cutoff: 2000 + 9000 * Math.min(x, 1) }),
  tractor: (x, aux) => ({ gain: 0.3 * Math.min(x, 1.2), rate: 0.95 + 0.1 * Math.min(aux, 1), cutoff: 6000 }),
  tractor_load: (x) => ({ gain: 0.38 * Math.min(x, 1.2), rate: 0.85 + 0.2 * Math.min(x, 1.2), cutoff: 3500 }),
  hover: (x, aux) => ({ gain: 0.32 * Math.min(x, 1.2), rate: 0.85 + 0.35 * clamp(aux, 0, 1.3), cutoff: 2500 + 3000 * clamp(aux, 0, 1) }),
  hover_flutter: (x) => ({ gain: 0.32 * Math.min(x, 1.2), rate: 0.9 + 0.3 * Math.min(x, 1), cutoff: 5000 }),
  // beta (D127): level = the field's area (m²): +11 dB from 0.01 to 1 m² (before the panner's wider reference distance), a touch deeper when big
  wall: (x) => ({ gain: 0.08 + 0.3 * Math.sqrt(clamp(x, 0, 1)), rate: 1.05 - 0.1 * Math.sqrt(clamp(x, 0, 1)), cutoff: 6000 + 3000 * Math.sqrt(clamp(x, 0, 1)) }),
  coil_hum: (x) => ({ gain: 0.14 * Math.min(x, 1), rate: 1, cutoff: 6000 }),
  stasis: (x) => ({ gain: 0.32 * Math.min(x, 1.2), rate: 1, cutoff: 5000 }),
  sing_pull: (x) => ({ gain: 0.65 * Math.min(x, 1.3), rate: 0.8 + 0.25 * Math.min(x, 1.3), cutoff: 500 + 3500 * Math.min(x, 1) }),
  servo: (x) => ({ gain: 0.3 * Math.min(1, x * 1.5), rate: clamp(0.55 + 0.75 * x, 0.5, 1.9), cutoff: 6000 + 6000 * Math.min(x, 1) }),
  // BUZZ (buzz.ts): rotor level = thrust, aux = load (0..1: heavier = lower, harder); winch level = reel speed
  rotor: (x, aux) => ({ gain: 0.3 * (0.3 + 0.7 * Math.min(x, 1.3)), rate: clamp((0.7 + 0.45 * Math.min(x, 1.4)) * (1 - 0.12 * clamp(aux, 0, 1)), 0.5, 1.6), cutoff: 2500 + 9000 * Math.min(x, 1) }),
  winch: (x) => ({ gain: 0.3 * Math.min(1, x * 1.5), rate: clamp(0.7 + 0.6 * x, 0.6, 1.6), cutoff: 9000 }),
};

// ============================================================================================
// director
// ============================================================================================

/** Canonical M5 type ids (brief type_ids), with aliases A5 might pick. */
const ALIAS: Readonly<Record<string, string>> = {
  rift: 'rift_gate', rift_gates: 'rift_gate', portal: 'rift_gate', gravwell: 'grav_well', gravity_well: 'grav_well', tractor: 'tractor_beam', tractorbeam: 'tractor_beam',
  hoverpad: 'hover_pad', forcewall: 'force_wall', force_field: 'force_wall', coilgun: 'coilgun_ring', coil_ring: 'coilgun_ring', stasis: 'stasis_field',
  beacon: 'buzz_beacon', black_hole: 'singularity', robot_arm: 'grabber', arm: 'grabber',
};
export const canonM5 = (t: string | undefined): string => (t ? ALIAS[t] ?? t : '');
export const M5_TYPES: ReadonlySet<string> = new Set([
  'rift_gate', 'grav_well', 'tractor_beam', 'hover_pad', 'force_wall', 'coilgun_ring', 'stasis_field', 'buzz_beacon', 'singularity', 'grabber',
]);
export const isM5 = (t: string | undefined): boolean => M5_TYPES.has(canonM5(t)) || M5_EXTRA.some((x) => x.types.has(canonM5(t)));

/**
 * GOO VAT (matter.md) is X5's: when it lands it registers its part-level sounds here (bubble_blorp loop,
 * stirrer_hum, valve_clunk, goo_pour, drip_snap, refill_gloop) and the goo kind joins matter.ts's granular streams
 * (see M5_NOTES_F5.md "GOO VAT hook"). Until then GOO VAT is silent apart from its material impacts.
 */
export interface M5Extra {
  types: ReadonlySet<string>;
  recipes(): Recipe[];
  event(h: AudioHost, e: SimEventLike, type: string, when: number, var01: number): boolean;
  part(h: AudioHost, id: number, type: string, pos: Vec3, flags: number, meter: number, dt: number, edges: boolean): void;
}
export const M5_EXTRA: M5Extra[] = [];

/** Where sounds come from on each part, relative to its base origin (briefs: emitters). */
const EMIT: Readonly<Record<string, Vec3>> = {
  rift_gate: [0, 0.205, 0], grav_well: [0, 0.135, 0], tractor_beam: [0, 0.06, 0.15], hover_pad: [0, 0.03, 0], force_wall: [0, 0.3, 0],
  coilgun_ring: [0, 0.1575, 0], stasis_field: [0, 0.2, 0], buzz_beacon: [0, 0.03, 0], singularity: [0, 0.115, 0], grabber: [0, 0.3, 0],
};
/** SIMULATION §5.12 / boom.md: the SINGULARITY's field runs 6.0 s from its arming Signal; spin-up is the first 0.5 s. */
const SING_FIELD_S = 6.0, SING_SPIN_S = 0.5, SING_SILENCE_S = 0.15;
/** COILGUN RING recharge (future.md: 0.5 s). */
const COIL_RECHARGE_S = 0.5;

interface PState {
  type: string; flags: number; seen: number; motion: Motion; rot: readonly [number, number, number, number] | null; spin: number;
  onAt: number; offAt: number; boost: number; next: number; meter: number; meterRate: number; meterAt: number;
  armAt: number; collapsed: boolean; mass: number; ready: boolean; moving: boolean; movedAt: number; airborne: boolean; vyMin: number; armPos: Vec3 | null;
  /** GRAV WELL / HOVER PAD field on (A5: lit, or powered). GRABBER: when its last cycle started. */
  on: boolean; cycleAt: number;
}
/** Beta (D127): one part's static props as the director sees them (main.ts: parts-data `propValues`). */
export interface PartProps { id: number; type: string; props: Readonly<Record<string, number>> }
/** Beta (D127): the part types whose sound reads their props: GRAV WELL `mode`, FORCE WALL `width` × `height`, RIFT GATE `pair`. */
export const AUDIO_PROP_TYPES: ReadonlySet<string> = new Set(['grav_well', 'force_wall', 'rift_gate']);
/** FORCE WALL field area (m²) from its props (parts-data defaults 0.6 × 0.4 m; 0.1–1 m each way). */
export const wallArea = (p: Readonly<Record<string, number>>): number => clamp(fin(p.width ?? 0.6, 0.6), 0.1, 1) * clamp(fin(p.height ?? 0.4, 0.4), 0.1, 1);

interface Sched { at: number; name: string; pos: Vec3; gain: number; rate: number; id: number; family: 'mech' | 'fx' | 'impact' | 'pyro' }

export class M5Parts {
  private readonly parts = new Map<number, PState>();
  private readonly recent = new Map<string, number>();
  private readonly sched: Sched[] = [];
  /** Last known base position of every M5 part (rift exits, SINGULARITY recycling, collapse). */
  private readonly where = new Map<number, Vec3>();
  readonly stats = { events: 0, cues: 0, collapses: 0 };
  /** Beta (D127): static props by part id (setProps, from the document when a run starts). */
  private readonly props = new Map<number, Readonly<Record<string, number>>>();
  /** Beta (D127): RIFT GATEs per pair colour, in part order (the sim pairs the 1st with the 2nd, the 3rd with the 4th …). */
  private readonly riftOrder = new Map<number, number[]>();

  /** `silence(when, s)`: the host dips everything (sfx and music) for `s` seconds: the SINGULARITY's collapse. */
  constructor(private readonly h: AudioHost, private readonly silence: (when: number, s: number) => void = () => {}) {}

  reset(): void { this.parts.clear(); this.recent.clear(); this.sched.length = 0; this.where.clear(); this.riftOrder.clear(); }

  /** Beta (D127): the parts' static props (GRAV WELL mode, FORCE WALL size, RIFT pair colour); junk entries are skipped. */
  setProps(list: readonly PartProps[]): void {
    this.props.clear();
    this.riftOrder.clear();
    for (const p of list) {
      if (!p || !Number.isFinite(p.id) || !p.props || typeof p.props !== 'object') continue;
      const o: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.props)) if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
      this.props.set(p.id, o);
    }
  }

  /** GRAV WELL in Repel mode (its Mode prop; without props, F5's stand-in: the `armed` flag). */
  private repel(id: number, flags: number): boolean { const p = this.props.get(id); return p ? Math.round(p.mode ?? 0) === 1 : (flags & F.armed) !== 0; }

  /**
   * RIFT GATE pairs, as the sim makes them (channels/m5_rift.ts riftInit): gates of one colour in part order, the 1st
   * with the 2nd, the 3rd with the 4th. main.ts reports parts in part order every frame, so first-seen order is part order.
   */
  private riftPair(id: number): { key: string; mate: number | undefined } {
    const colour = clamp(Math.round(fin(this.props.get(id)?.pair ?? 0, 0)), 0, 5);
    let list = this.riftOrder.get(colour);
    if (!list) { list = []; this.riftOrder.set(colour, list); }
    let k = list.indexOf(id);
    if (k < 0) { list.push(id); k = list.length - 1; }
    return { key: `rift:${colour}:${k >> 1}`, mate: list[k ^ 1] };
  }

  private cue(id: number, name: string, var01: number, pos: Vec3, when: number, gain: number, x: { rate?: number; prio?: number; family?: Sched['family'] } = {}): void {
    this.recent.set(`${id}:${name}`, this.h.now());
    const o: Parameters<AudioHost['play']>[2] = { family: x.family ?? 'mech', pos, when, gain: clamp(gain, 0, 1.2), key: name };
    if (x.rate !== undefined) o.rate = clamp(x.rate, 0.25, 4);
    if (x.prio !== undefined) o.prio = x.prio;
    if (this.h.play(name, var01, o)) this.stats.cues++;
  }
  private fresh(id: number, name: string, within = 0.3): boolean { return this.h.now() - (this.recent.get(`${id}:${name}`) ?? -10) < within; }
  private later(at: number, id: number, name: string, pos: Vec3, gain: number, rate = 1, family: Sched['family'] = 'mech'): void {
    if (this.sched.length < 64) this.sched.push({ at, id, name, pos: [pos[0], pos[1], pos[2]], gain, rate, family });
  }
  private cancel(id: number, name: string): void { for (let i = this.sched.length - 1; i >= 0; i--) if (this.sched[i]!.id === id && this.sched[i]!.name === name) this.sched.splice(i, 1); }
  /** A body comes out of gate id: the pop-whoosh (velocity-scaled), the trim ring spins up, the cooldown tick. */
  private emerge(id: number, fallback: Vec3, when: number, var01: number, speed: number): void {
    const exit = this.at(id, 'rift_gate', fallback);
    this.cue(id, 'rift/out', var01, exit, when, clamp(0.35 + speed / 6, 0.35, 0.85), { family: 'fx', prio: 1.3, rate: clamp(0.92 + speed / 40, 0.92, 1.15) });
    const xs = this.parts.get(id);
    if (xs) xs.boost = 1;
    this.later(when + 0.25, id, 'rift/tick', exit, 0.2);
  }
  private emit(t: string, pos: Vec3): Vec3 { const o = EMIT[t] ?? [0, 0, 0]; return [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]]; }
  private at(id: number, t: string, fallback: Vec3): Vec3 { const w = this.where.get(id); return w ? this.emit(t, w) : fallback; }

  /** The SINGULARITY was armed at `when`: spin-up now, the implosion swell timed to land on the collapse. */
  private arm(id: number, s: PState | undefined, pos: Vec3, when: number, var01: number): void {
    if (s && s.armAt > 0 && this.h.now() - s.armAt < SING_FIELD_S + 1) return; // already running
    if (s) { s.armAt = when; s.collapsed = false; s.mass = 0; }
    const c = this.emit('singularity', pos);
    this.cue(id, 'sing/arm', var01, c, when, 0.5);
    this.cue(id, 'sing/spinup', var01, c, when + 0.03, 0.55, { family: 'fx' });
    this.later(when + SING_FIELD_S - 1.0, id, 'sing/implode', c, 0.85, 1, 'pyro');
    this.h.heat(0.1);
  }

  /** The collapse: the implosion has landed (scheduled), 150 ms of silence, then the aftermath and the vent. */
  private collapse(id: number, s: PState | undefined, pos: Vec3, when: number, var01: number): void {
    if (s?.collapsed) return;
    if (s) s.collapsed = true;
    this.stats.collapses++;
    const c = this.emit('singularity', pos);
    // a collapse earlier than scheduled (the sim is authoritative): the implosion still has to land on it
    if (s && when < s.armAt + SING_FIELD_S - 0.05) { this.cancel(id, 'sing/implode'); this.cue(id, 'sing/implode', var01, c, Math.max(this.h.now(), when - 0.3), 0.5, { family: 'pyro', rate: 3.3 }); }
    this.silence(when, SING_SILENCE_S);
    this.cue(id, 'sing/collapse', var01, c, when + SING_SILENCE_S, 0.9, { family: 'pyro', prio: 2 });
    this.later(when + SING_SILENCE_S + 0.4, id, 'sing/vent', [c[0], c[1] + 0.085, c[2]], 0.4, 1, 'fx');
    this.h.heat(0.6);
  }

  // ---- events ----

  /** Returns true when handled (the M4/M3/M2/M1 paths then skip it). */
  event(e: SimEventLike, rawType: string | undefined, when: number, var01: number, typeOf?: (id: number) => string | undefined): boolean {
    const t = canonM5(rawType);
    for (const x of M5_EXTRA) if (x.types.has(t) && x.event(this.h, e, t, when, var01)) return true;
    if (!M5_TYPES.has(t)) return false;
    this.stats.events++;
    const k = e.kind, id = e.part, p = e.pos;
    const J = Math.max(0, fin(e.mag, 0));
    const s = this.parts.get(id);
    switch (t) {
      case 'rift_gate': {
        // A5 (channels/m5_rift.ts): Teleport at the entry gate, Emerge at the exit gate (other = the body, mag = speed),
        // Bounce when a body arrives during the pair's 0.25 s cooldown
        if (k === 'Teleport') {
          const entry = this.at(id, t, p);
          this.cue(id, 'rift/in', var01, entry, when, clamp(0.4 + J / 10, 0.4, 0.75), { family: 'fx', prio: 1.3 });
          if (s) s.boost = 1;
          this.later(when + 0.25, id, 'rift/tick', entry, 0.2);
          this.h.heat(0.04);
          return true;
        }
        if (k === 'Emerge') { this.emerge(id, p, when, var01, J); return true; }
        if (k === 'Bounce') { if (!this.fresh(id, 'rift/bonk', 0.1)) this.cue(id, 'rift/bonk', var01, p, when, clamp(0.35 + J / 6, 0.35, 0.7), { family: 'impact' }); return true; }
        return false;
      }
      case 'grav_well':
        // A5 has no GRAV WELL events of its own: the field's edges come from the flags (`lit` while the field is on)
        if (k === 'Powered') { if (!this.fresh(id, 'grav/spinup', 0.5)) this.cue(id, 'grav/spinup', var01, this.at(id, t, p), when, 0.5, this.repel(id, s?.flags ?? 0) ? { rate: 1.22 } : {}); return true; }
        if (k === 'Unpowered') { if (!this.fresh(id, 'grav/clack', 0.5)) this.cue(id, 'grav/clack', var01, this.at(id, t, p), when + 0.12, 0.5, { family: 'impact' }); return true; }
        if (k === 'Brownout') { if (!this.fresh(id, 'grav/stutter', 0.8)) this.cue(id, 'grav/stutter', var01, this.at(id, t, p), when, 0.4); return true; }
        return false;
      case 'tractor_beam':
        // A5: Attach / Release as bodies are captured and let go (other = the body); `fault` (strain) is in the flags
        if (k === 'Powered') { if (!this.fresh(id, 'tractor/on', 0.4)) this.cue(id, 'tractor/on', var01, this.at(id, t, p), when, 0.4); return true; }
        if (k === 'Unpowered') { this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.25, rate: 0.75 }); return true; }
        if (k === 'Attach') { if (!this.fresh(id, 'tractor/capture', 0.2)) this.cue(id, 'tractor/capture', var01, this.at(id, t, p), when, 0.45, { family: 'fx' }); return true; }
        if (k === 'Release') { if (!this.fresh(id, 'tractor/release', 0.2)) this.cue(id, 'tractor/release', var01, this.at(id, t, p), when, 0.4, { family: 'fx' }); return true; }
        if (k === 'Brownout') { if (!this.fresh(id, 'tractor/strain', 0.8)) this.cue(id, 'tractor/strain', var01, this.at(id, t, p), when, 0.4); return true; }
        return false;
      case 'hover_pad':
        // A5: power edges; hovering / overload are the flags (`lit` / `fault`); a landing is its own Impact after the drop
        if (k === 'Unpowered') { if (!this.fresh(id, 'hover/powerdown', 0.5)) this.cue(id, 'hover/powerdown', var01, p, when, 0.5); if (s) { s.airborne = true; s.offAt = when; } return true; }
        if (k === 'Powered') { this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.25, rate: 0.85 }); return true; }
        if (k === 'Impact' && s?.airborne && J >= 0.5) { s.airborne = false; this.cue(id, 'hover/land', var01, p, when, clamp(0.4 + J / 15, 0.4, 0.85), { family: 'impact' }); return true; }
        return false;
      case 'force_wall': {
        // A5: Barrier (mag = the new state, 1 on / 0 off) on each toggle Signal; contacts are Impacts on the wall
        if (k === 'Barrier') {
          const name = e.mag > 0 ? 'wall/on' : 'wall/off';
          const wp = this.props.get(id);
          if (!this.fresh(id, name, 0.15)) this.cue(id, name, var01, this.at(id, t, p), when, 0.33 + 0.17 * Math.sqrt(wp ? wallArea(wp) : 0.24)); // beta (D127): by area
          return true;
        }
        if (k === 'Impact') {
          const critter = typeOf && e.other !== undefined ? isCritterType(typeOf(e.other)) : false;
          const on = s ? (s.flags & F.lit) !== 0 : true;
          if (!on) return false; // the pylons: the material bank
          if (critter && J >= 0.1) { if (!this.fresh(id, 'wall/boing', 0.3)) this.cue(id, 'wall/boing', var01, p, when, clamp(0.4 + J / 8, 0.4, 0.7), { family: 'impact' }); return true; }
          if (J >= 0.05 && !this.fresh(id, 'wall/ripple', 0.05)) this.cue(id, 'wall/ripple', var01, p, when, clamp(0.25 + Math.log10(1 + J * 2) * 0.35, 0.25, 0.8), { family: 'impact', rate: clamp(1.25 - Math.log10(1 + J) * 0.3, 0.7, 1.3) });
          return true;
        }
        return false;
      }
      case 'coilgun_ring':
        // A5: Boost per pass (mag = the 3 m/s kick for a steel body, 0 for anything else: the dud), Charged when it's ready
        if (k === 'Boost') {
          const c = this.at(id, t, p);
          if (J <= 0.01) { if (!this.fresh(id, 'coil/dud', 0.2)) this.cue(id, 'coil/dud', var01, c, when, 0.3, { family: 'fx' }); return true; }
          this.cue(id, 'coil/fire', var01, c, when, clamp(0.55 + J / 12, 0.55, 0.9), { family: 'fx', prio: 1.4, rate: clamp(0.85 + J / 15, 0.85, 1.25) });
          if (s) { s.ready = false; s.onAt = when; }
          this.later(when + 0.12, id, 'coil/charge', c, 0.3);
          this.h.heat(0.06);
          return true;
        }
        if (k === 'Charged') { if (!this.fresh(id, 'coil/ready', 0.3)) this.cue(id, 'coil/ready', var01, this.at(id, t, p), when, 0.25); if (s) s.ready = true; return true; }
        if (k === 'Powered') { if (!this.fresh(id, 'coil/charge', 0.4)) this.cue(id, 'coil/charge', var01, this.at(id, t, p), when, 0.3); return true; }
        if (k === 'Unpowered') return true;
        return false;
      case 'stasis_field':
        // A5: Engage (mag 1 engaged, 0 released), Freeze per body caught inside (other = the body)
        if (k === 'Engage') {
          const name = e.mag > 0 ? 'stasis/engage' : 'stasis/release';
          if (!this.fresh(id, name, 0.5)) this.cue(id, name, var01, this.at(id, t, p), when, 0.55, { family: 'fx' });
          return true;
        }
        if (k === 'Freeze') { if (!this.fresh(id, 'stasis/ting', 0.08)) this.cue(id, 'stasis/ting', var01, e.pos, when, 0.3, { family: 'fx', rate: 0.95 + 0.1 * var01 }); return true; }
        return false;
      case 'buzz_beacon':
        // A5: Call (mag = the call number); BUZZ docking on the pad is B5's 'docked' state (buzz.ts plays the clunk)
        if (k === 'Call') { if (!this.fresh(id, 'beacon/call', 0.4)) this.cue(id, 'beacon/call', var01, this.at(id, t, p), when, 0.35); return true; }
        return false;
      case 'singularity':
        // A5: Engage on the arming Signal (it works once), Despawn per body recycled (other = the body), Launch per critter
        // spat out, Collapse at 6.0 s (mag = bodies swallowed)
        if (k === 'Engage') { this.arm(id, s, this.where.get(id) ?? p, when, var01); return true; }
        if (k === 'Collapse') { this.collapse(id, s, this.where.get(id) ?? p, when, var01); return true; }
        if (k === 'Despawn') { this.recycled(id, s, e.pos, when, var01, 0); return true; }
        if (k === 'Launch') { if (!this.fresh(id, 'sing/spit', 0.3)) this.cue(id, 'sing/spit', var01, this.at(id, t, p), when, 0.5, { family: 'fx' }); return true; }
        return false;
      case 'grabber':
        // A5: Trigger (a cycle starts), Attach (it grips: other = the body), Release (set down), Jam (nothing at A: the shrug)
        if (k === 'Trigger') { if (s) s.cycleAt = when; if (!this.fresh(id, 'relay', 0.2)) { this.recent.set(`${id}:relay`, this.h.now()); this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.22, rate: 1.2 }); } return true; }
        if (k === 'Attach') { if (!this.fresh(id, 'grab/close', 0.2)) this.cue(id, 'grab/close', var01, s?.armPos ?? this.at(id, t, p), when, 0.4); return true; }
        if (k === 'Release') { if (!this.fresh(id, 'grab/open', 0.2)) this.cue(id, 'grab/open', var01, s?.armPos ?? this.at(id, t, p), when, 0.35); return true; }
        if (k === 'Jam') { if (!this.fresh(id, 'grab/shrug', 1)) this.cue(id, 'grab/shrug', var01, this.at(id, t, p), when, 0.35); return true; }
        if (k === 'Powered' || k === 'Unpowered') { this.h.play('relay', var01, { family: 'mech', pos: p, when, gain: 0.25, rate: 0.9 }); return true; }
        return false;
      default:
        return false;
    }
  }

  /** A body recycled into the core: a pop (rate-limited: at most 12 a second), and the pull loop grows with the mass. */
  private recycled(id: number, s: PState | undefined, pos: Vec3, when: number, var01: number, mass: number): void {
    if (s) s.mass += mass > 0 ? mass : 0.5;
    if (this.fresh(id, 'sing/pop', 1 / 12)) return;
    const c = this.where.get(id) ? this.emit('singularity', this.where.get(id)!) : pos;
    this.cue(id, 'sing/pop', var01, c, when, 0.45, { family: 'fx', rate: 0.9 + 0.25 * var01 });
    this.h.heat(0.02);
  }

  /** Per frame: scheduled one-shots (rift ticks, coil ready pings, the implosion, the vent) and forgetting stale parts. */
  update(): void {
    const now = this.h.now();
    for (let i = this.sched.length - 1; i >= 0; i--) {
      const q = this.sched[i]!;
      if (now < q.at - 0.03) continue;
      this.sched.splice(i, 1);
      if (q.name === 'coil/ready') { const s = this.parts.get(q.id); if (s) s.ready = true; }
      this.h.play(q.name, hash01(q.id, Math.floor(q.at * 20)), { family: q.family, pos: q.pos, when: Math.max(now + 0.005, q.at), gain: q.gain, rate: q.rate, key: q.name });
    }
    if (this.parts.size > 0 && Math.floor(now * 2) !== Math.floor((now - 0.017) * 2)) {
      for (const [id, s] of this.parts) if (now - s.seen > 2) { this.parts.delete(id); this.where.delete(id); }
    }
  }

  // ---- part state ----

  part(id: number, type: string, pos: Vec3, flags: number, meter: number, rot: readonly [number, number, number, number] | null, arm: Vec3 | null, dt: number, edges: boolean): void {
    const t = canonM5(type);
    if (!finite3(pos)) return;
    for (const x of M5_EXTRA) if (x.types.has(t)) { x.part(this.h, id, t, pos, flags, meter, dt, edges); return; }
    this.where.set(id, [pos[0], pos[1], pos[2]]);
    const h = this.h, now = h.now();
    const m = clamp(fin(meter, 0), 0, 255);
    let s = this.parts.get(id);
    if (!s || s.type !== t) {
      s = {
        type: t, flags, seen: now, motion: new Motion(pos), rot, spin: 0, onAt: (flags & F.powered) ? now - 10 : -10, offAt: -10, boost: 0, next: now + 0.5,
        meter: m, meterRate: 0, meterAt: now, armAt: -10, collapsed: false, mass: 0, ready: true, moving: false, movedAt: -10, airborne: false, vyMin: 0, armPos: null,
        on: (flags & (F.lit | F.powered)) !== 0, cycleAt: -10,
      };
      this.parts.set(id, s);
    }
    const prev = s.flags;
    s.flags = flags; s.seen = now;
    s.motion.update(pos, dt);
    if (arm && finite3(arm)) s.armPos = [arm[0], arm[1], arm[2]];
    if (m !== s.meter) {
      const span = Math.max(now - s.meterAt, 1 / 120);
      s.meterRate += (clamp((m - s.meter) / span, -2000, 2000) - s.meterRate) * 0.5;
      s.meter = m; s.meterAt = now;
    } else if (now - s.meterAt > 0.6) s.meterRate *= 0.85;
    // ω of the moving body (GRABBER's link, GRAV WELL's orb)
    if (rot && Number.isFinite(rot[0]) && Number.isFinite(rot[1]) && Number.isFinite(rot[2]) && Number.isFinite(rot[3])) {
      const r0 = s.rot;
      if (r0 && (r0[0] !== rot[0] || r0[1] !== rot[1] || r0[2] !== rot[2] || r0[3] !== rot[3])) {
        const d = clamp(Math.abs(r0[0] * rot[0] + r0[1] * rot[1] + r0[2] * rot[2] + r0[3] * rot[3]), 0, 1);
        const w = clamp((2 * Math.acos(d)) / Math.max(dt, 1 / 240), 0, 200);
        s.spin = clamp(s.spin + (w - s.spin) * 0.35, 0, 200);
      } else if (r0) s.spin *= 0.9;
      s.rot = rot;
    }
    if (flags & F.dead) return;
    const rise = (b: number): boolean => edges && !(prev & b) && (flags & b) !== 0;
    const fall = (b: number): boolean => edges && (prev & b) !== 0 && !(flags & b);
    const v01 = hash01(id, h.tick(), hashStr(t));
    const L = (kind: LoopKind, level: number, o?: LoopOpts, where: Vec3 = this.emit(t, pos)): void => h.loop(`${kind}:${id}`, kind, where, level, o);
    const powered = (flags & F.powered) !== 0, armed = (flags & F.armed) !== 0, lit = (flags & F.lit) !== 0, pressed = (flags & F.pressed) !== 0, fault = (flags & F.fault) !== 0;
    if (rise(F.powered)) s.onAt = now;
    if (fall(F.powered)) s.offAt = now;
    switch (t) {
      case 'rift_gate': {
        // the paired-gate hum (unpaired gates — `fault` — are still and silent); a transit spins it up for a moment
        s.boost = Math.max(0, s.boost - dt * 2);
        // beta (D127): the pair hums as one system: one shared source (one LFO phase) and the pair's transit boost
        const pr = this.riftPair(id);
        const ms = pr.mate !== undefined ? this.parts.get(pr.mate) : undefined;
        const boost = Math.max(s.boost, ms && ms.type === 'rift_gate' ? ms.boost : 0);
        if (lit) L('rift', 1 + 0.6 * boost, { sync: pr.key }); // A5: `lit` while paired (`armed` in the pair's cooldown)
        break;
      }
      case 'grav_well': {
        // the field on (A5: `lit` while the field is on; else powered): spin-up (0.6 s), then the field hum. Beta (D127):
        // the Mode prop picks the attract hum or the repel hum (brighter, rising) and a brighter spin-up
        const on = lit || powered;
        const repel = this.repel(id, flags);
        if (edges && on && !s.on) { s.onAt = now; if (!this.fresh(id, 'grav/spinup', 0.5)) this.cue(id, 'grav/spinup', v01, this.emit(t, pos), now, 0.5, repel ? { rate: 1.22 } : {}); }
        if (edges && !on && s.on && !this.fresh(id, 'grav/clack', 0.5)) this.cue(id, 'grav/clack', v01, this.emit(t, pos), now + 0.12, 0.5, { family: 'impact' });
        s.on = on;
        if (on && now - s.onAt > 0.45) L(repel ? 'grav_repel' : 'grav_attract', fault ? 0.6 : 1);
        if (on && fault && now >= s.next) { this.cue(id, 'grav/stutter', v01, this.emit(t, pos), now, 0.35); s.next = now + 1.4 + 0.6 * hash01(id, h.tick(), 3); }
        break;
      }
      case 'tractor_beam': {
        // powered: the warble. A5: the meter is the load against 2 kg (1–21), `lit` while it carries something, `fault` = strain
        const load = m >= 1 ? clamp((m - 1) / 20, 0, 1.2) : lit || pressed ? 0.5 : 0;
        if (powered || lit) { L('tractor', 1, { aux: load }); if (lit || load > 0.05) L('tractor_load', Math.max(load, 0.3)); }
        if (rise(F.powered) && !this.fresh(id, 'tractor/on', 0.4)) this.cue(id, 'tractor/on', v01, this.emit(t, pos), now, 0.4);
        if ((rise(F.lit) || rise(F.pressed)) && !this.fresh(id, 'tractor/capture', 0.3)) this.cue(id, 'tractor/capture', v01, this.emit(t, pos), now, 0.45, { family: 'fx' });
        if ((fall(F.lit) || fall(F.pressed)) && !this.fresh(id, 'tractor/release', 0.3)) this.cue(id, 'tractor/release', v01, this.emit(t, pos), now, 0.4, { family: 'fx' });
        if (powered && fault && now >= s.next) { this.cue(id, 'tractor/strain', v01, this.emit(t, pos), now, 0.38); s.next = now + 1.2; }
        break;
      }
      case 'hover_pad': {
        // powered: the hum (pitch ∝ load: the meter / deck pressure), thruster flutter while it rises or sinks;
        // unpowered: the whine-drop, then a clunk when it lands (measured: falling, then stopped)
        // A5: `lit` while hovering, the meter is the deck load against 10 kg (1–21), `fault` while overloaded
        const load = m >= 1 ? clamp((m - 1) / 20, 0, 1.3) : 0;
        const vy = s.motion.vel[1];
        const on = lit || powered;
        if (edges && !on && s.on && !this.fresh(id, 'hover/powerdown', 0.5)) { this.cue(id, 'hover/powerdown', v01, pos, now, 0.5); s.airborne = true; s.offAt = now; }
        s.on = on;
        if (on) {
          L('hover', 1, { aux: load });
          if (Math.abs(vy) > 0.05) L('hover_flutter', Math.min(1.2, Math.abs(vy) * 2), undefined, pos);
          if (fault && now >= s.next) { this.cue(id, 'hover/overload', v01, pos, now, 0.38); s.next = now + 1.1; }
        }
        if (rise(F.powered) && !this.fresh(id, 'relay', 0.3)) { this.recent.set(`${id}:relay`, now); h.play('relay', v01, { family: 'mech', pos, when: now, gain: 0.25, rate: 0.85 }); }
        if (s.airborne) {
          s.vyMin = Math.min(s.vyMin, vy);
          if (s.vyMin < -0.5 && vy > -0.1 && edges && !this.fresh(id, 'hover/land', 0.4)) { this.cue(id, 'hover/land', v01, pos, now, clamp(0.4 + -s.vyMin / 6, 0.4, 0.85), { family: 'impact' }); s.airborne = false; }
          if (now - s.offAt > 3 && s.offAt > 0) s.airborne = false;
        } else s.vyMin = 0;
        break;
      }
      case 'force_wall': {
        // ON (A5: `lit`): the hum. Beta (D127): it scales with the field's area (width × height props, 0.01–1 m²):
        // louder (gain ∝ √area: a radiator's power ∝ area) and spread wider (the panner's reference distance grows with
        // the wall's size, so a big field fills more of the room), a little deeper too. Without props: a meter in
        // 1/100 m² if one ever comes, else the default 0.6 × 0.4 m
        const on = lit || powered || armed;
        const wp = this.props.get(id);
        const area = wp ? wallArea(wp) : m > 0 ? clamp(m / 100, 0.01, 1) : 0.24;
        if (on) L('wall', area, { ref: 0.5 + 0.9 * Math.sqrt(area) });
        const was = (prev & (F.lit | F.powered | F.armed)) !== 0;
        if (edges && on !== was) { const n = on ? 'wall/on' : 'wall/off'; if (!this.fresh(id, n, 0.15) && !this.fresh(id, on ? 'wall/off' : 'wall/on', 0.05)) this.cue(id, n, v01, this.emit(t, pos), now, 0.33 + 0.17 * Math.sqrt(area)); }
        break;
      }
      case 'coilgun_ring': {
        // powered: charging (the 0.5 s whine; A5's meter is the charge, 1–21), the ready ping when `lit` (charged; A5's
        // Charged event plays it first), then the idle hum; `fault` = underpowered
        if (rise(F.powered)) { s.ready = false; if (!this.fresh(id, 'coil/charge', 0.4)) this.cue(id, 'coil/charge', v01, this.emit(t, pos), now, 0.3); }
        if ((rise(F.lit) || rise(F.armed)) && !this.fresh(id, 'coil/ready', 0.3)) this.cue(id, 'coil/ready', v01, this.emit(t, pos), now, 0.25);
        if (powered && !fault) L('coil_hum', 1);
        break;
      }
      case 'stasis_field': {
        // engaged (A5: lit, else powered without fault): the choral drone; edges fall back to engage / release
        const engaged = lit || (powered && !fault);
        const was = (prev & F.lit) !== 0 || ((prev & F.powered) !== 0 && !(prev & F.fault));
        if (engaged) L('stasis', 1);
        if (edges && engaged && !was && !this.fresh(id, 'stasis/engage', 0.5)) this.cue(id, 'stasis/engage', v01, this.emit(t, pos), now, 0.55, { family: 'fx' });
        if (edges && !engaged && was && !this.fresh(id, 'stasis/release', 0.5)) this.cue(id, 'stasis/release', v01, this.emit(t, pos), now, 0.55, { family: 'fx' });
        break;
      }
      case 'buzz_beacon':
        // a call (B5 writes `lureSeen` into the device byte; A5 may pulse `pressed`): the radio chirp
        if (rise(F.pressed) && !this.fresh(id, 'beacon/call', 0.4)) this.cue(id, 'beacon/call', v01, this.emit(t, pos), now, 0.35);
        break;
      case 'singularity': {
        // armed: spin-up, then the pull loop growing over the 6 s field (and with the recycled mass) until the collapse
        if (rise(F.armed) || rise(F.lit)) this.arm(id, s, pos, now, v01);
        const running = s.armAt > 0 && !s.collapsed && now - s.armAt < SING_FIELD_S + 0.2;
        if (running && now - s.armAt > SING_SPIN_S * 0.8) {
          // A5's meter: seconds left + 1 (the countdown screen); else the clock since the arming
          const prog = m >= 2 ? clamp(1 - (m - 1) / SING_FIELD_S, 0, 1) : clamp((now - s.armAt) / SING_FIELD_S, 0, 1);
          L('sing_pull', 0.55 + 0.45 * prog + Math.min(0.3, Math.log10(1 + s.mass) * 0.2), { ref: 2 });
        }
        // the sim's collapse is authoritative; the flag edge (armed falling) or the clock are the fallbacks
        if (s.armAt > 0 && !s.collapsed && ((fall(F.armed) && now - s.armAt > 1) || now - s.armAt >= SING_FIELD_S + 0.12)) this.collapse(id, s, pos, Math.min(now, s.armAt + SING_FIELD_S), v01);
        break;
      }
      case 'grabber': {
        // the servo whine follows the moving link's speed (the gripper link's rotation and travel, main.ts)
        const speed = clamp(s.spin / 3, 0, 2);
        const travel = this.armSpeed(s, dt);
        // no moving link to measure (main.ts passes the gripper when it can): a cycle runs ~4 s from its Trigger
        const cycling = travel === 0 && s.spin < 0.01 && now - s.cycleAt < 4 ? 0.5 + 0.3 * Math.sin((now - s.cycleAt) * 2.3) : 0;
        const js = Math.max(speed, travel / 0.6, cycling);
        if ((powered || js > 0.05) && js > 0.04) L('servo', js, undefined, s.armPos ?? this.emit(t, pos));
        // A5: `lit` while holding something, `fault` during the shrug
        if ((rise(F.lit) || rise(F.pressed)) && !this.fresh(id, 'grab/close', 0.3)) this.cue(id, 'grab/close', v01, s.armPos ?? this.emit(t, pos), now, 0.4);
        if ((fall(F.lit) || fall(F.pressed)) && !this.fresh(id, 'grab/open', 0.3)) this.cue(id, 'grab/open', v01, s.armPos ?? this.emit(t, pos), now, 0.35);
        if (rise(F.fault) && !this.fresh(id, 'grab/shrug', 1)) this.cue(id, 'grab/shrug', v01, this.emit(t, pos), now, 0.35);
        // parked: it was moving and has come to rest
        if (!s.moving && js > 0.3) { s.moving = true; s.movedAt = now; }
        if (s.moving && js < 0.03 && now - s.movedAt > 0.8) { s.moving = false; if (edges && !this.fresh(id, 'grab/park', 1)) this.cue(id, 'grab/park', v01, this.emit(t, pos), now, 0.3); }
        break;
      }
      default:
    }
  }

  private readonly armPrev = new WeakMap<PState, Vec3>();
  /** Linear speed of the `arm` body (m/s), from frame to frame. */
  private armSpeed(s: PState, dt: number): number {
    const a = s.armPos;
    if (!a) return 0;
    const p = this.armPrev.get(s);
    this.armPrev.set(s, [a[0], a[1], a[2]]);
    if (!p || !(dt > 0)) return 0;
    const d = Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]);
    return d > 1 ? 0 : clamp(d / dt, 0, 10);
  }
}

const CRITTERS = new Set(['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty', 'buzz']);
const isCritterType = (t: string | undefined): boolean => (t ? CRITTERS.has(t) : false);
