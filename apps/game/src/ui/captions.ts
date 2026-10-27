// Event captions and critter emote text (M4 stream U4; GAME_SPEC §20 "Event captions ("💥 Powder Keg ×6"),
// critter emote text", UI_UX §4.10 / §7; Settings › Accessibility › Captions).
//
// The run's sounds and notable SimEvents become short bracketed captions ("[BOOM] POWDER KEG ×6",
// "[Biscuit barks]") in a strip above the run bar, on a raised well (6.6:1 over white, D77). Repeats of
// the same thing collapse into a count; at most 3 lines show, each for 3.5 s; at most 4 new lines a second
// (the rest merge or wait), and a direction mark (‹ ›, or ◂ ▸ when off screen) says where it happened.
// New lines also go to the screen-reader announcer (ui/a11y.ts). While captions are on, each critter
// with an emote bubble also gets a text tag over its head ("Mochi: alarmed!").
//
// The pure parts (captionFor, emoteText, CaptionModel) are unit-tested in test/a11y.test.ts.

import { CRITTER_EMOTES, CRITTER_FSM } from '@knockon/parts-data'; // UIFIX (D122): CRITTER_FSM

export interface CaptionEvent { readonly kind: string; readonly part: number; readonly mag: number; readonly pos: readonly number[]; readonly other?: number }
export interface Caption { readonly key: string; readonly text: string; readonly big: boolean }

/** Title-case a part or critter name for voice lines ("BISCUIT" → "Biscuit"). */
export const voiceName = (name: string): string => name.slice(0, 1).toUpperCase() + name.slice(1).toLowerCase();

/** Emote → mood (CRITTER_EMOTES names; unknown future emotes fall back to 'voice'). */
const MOOD: Readonly<Record<string, Mood>> = {
  '!': 'alarm', cat_alert: 'alarm', dog_alert: 'alarm', eyes_pip: 'alarm',
  '?': 'confused', zzz: 'sleepy', stars: 'dizzy',
  heart: 'happy', snack_heart: 'happy', kiss: 'happy', grin: 'happy', sparkle: 'happy',
  angry: 'angry', grumpy: 'angry', steam: 'angry',
  sweat: 'tired', stopwatch: 'tired', pedal: 'tired',
  bubbles: 'water', water_drop: 'water', seed: 'food', food_flake: 'food',
  // M4 critters (B4: BISCUIT, HENNY, DUSTY)
  bark: 'voice', eyes_mochi: 'alarm', bone: 'happy', egg: 'egg', '!!': 'alarm', feather: 'dizzy', sparkle_clean: 'happy', bin_full: 'full',
  // M5 (B5: BUZZ): package = off to fetch a tagged object, pin = the claw has it, clock / check = delivered (on time / late)
  package: 'fetch', pin: 'grab', clock: 'done', check: 'done',
};
type Mood = 'alarm' | 'confused' | 'sleepy' | 'dizzy' | 'happy' | 'angry' | 'tired' | 'water' | 'food' | 'egg' | 'full' | 'voice' | 'fetch' | 'grab' | 'done';

/** What each critter sounds like, per mood ("[Biscuit barks]"). Unknown species use `default`. */
const VOICE: Readonly<Record<string, Partial<Record<Mood, string>>>> = {
  mochi: { voice: 'meows', alarm: 'yowls', confused: 'mrrps?', sleepy: 'snores softly', dizzy: 'mews, dizzy', happy: 'purrs', angry: 'hisses', tired: 'pants', food: 'crunches a snack' },
  pip: { voice: 'squeaks', alarm: 'squeaks in alarm', confused: 'chirps?', sleepy: 'snores, tiny', dizzy: 'squeaks, dizzy', happy: 'chitters happily', angry: 'squeaks crossly', tired: 'puffs', food: 'stuffs its cheeks' },
  goby: { voice: 'blubs', alarm: 'splashes', water: 'blubs', tired: 'gasps', happy: 'blows a kiss bubble', food: 'gulps a flake' },
  bandit: { voice: 'chitters', alarm: 'shrieks', confused: 'chirrs?', happy: 'chuckles gleefully', angry: 'snarls', tired: 'huffs and pedals', sleepy: 'snores' },
  biscuit: { voice: 'barks', alarm: 'barks', confused: 'whines', sleepy: 'snores', dizzy: 'whimpers, dizzy', happy: 'wags and pants', angry: 'growls', tired: 'pants' },
  henny: { voice: 'clucks', alarm: 'squawks', confused: 'bawks?', sleepy: 'coos', dizzy: 'flaps, feathers everywhere', happy: 'clucks happily', angry: 'squawks crossly', food: 'pecks at seeds', egg: 'lays a YOLK' },
  dusty: { voice: 'beeps', alarm: 'beeps twice', confused: 'boops?', sleepy: 'hums, docked', dizzy: 'whirs, spinning', happy: 'chimes, all clean', angry: 'buzzes', tired: 'whines', full: 'chimes: bin full', food: 'slurps up grains' },
  // M5 (B5)
  buzz: { voice: 'chirps', alarm: 'beeps in alarm', confused: 'chirps?', sleepy: 'powers down, docked', dizzy: 'whirs, tumbling', happy: 'chirps happily', angry: 'buzzes crossly', tired: 'whines', fetch: 'whirs off to fetch', grab: 'clamps on: got it!', done: 'chimes: delivered!' },
  default: { voice: 'makes a noise', alarm: 'yelps', confused: 'sounds puzzled', sleepy: 'snores', dizzy: 'is dizzy', happy: 'sounds happy', angry: 'sounds cross', tired: 'pants', water: 'splashes', food: 'munches', egg: 'lays an egg', full: 'is full', fetch: 'sets off', grab: 'grabs it', done: 'is done' },
};

/** Emote bubble → short text for the over-the-head tag. */
const MOOD_TEXT: Readonly<Record<Mood, string>> = {
  alarm: 'alarmed!', confused: 'puzzled?', sleepy: 'asleep (zzz)', dizzy: 'dizzy', happy: 'happy', angry: 'cross', tired: 'puffed out',
  water: 'blub blub', food: 'snacking', egg: 'laid an egg!', full: 'bin full', voice: '…',
  fetch: 'on its way!', grab: 'got it!', done: 'delivered!',
};

export function emoteMood(emote: number): Mood {
  const name = CRITTER_EMOTES[emote] as string | undefined;
  return (name && MOOD[name]) || 'voice';
}

/**
 * "Mochi: alarmed!" for an emote index (0 = none → ''). UIFIX (D122): `state` is the critter's FSM state
 * (critterState byte 3); an alarm while it is startled reads "startled!" ("Buzz: startled!" for BUZZ's startle,
 * PARTSIM D121, whose "!" otherwise also marks setting off on a job).
 */
export function emoteText(name: string, emote: number, state = -1): string {
  if (!emote) return '';
  const label = CRITTER_EMOTES[emote] as string | undefined;
  if (!label || label === 'none') return '';
  if (label === 'pedal') return `${voiceName(name)}: pedalling`;
  if (label === 'bark') return `${voiceName(name)}: woof!`;
  const mood = emoteMood(emote);
  const fsm = state >= 0 ? (CRITTER_FSM[state] as string | undefined) : undefined;
  if (mood === 'alarm' && (fsm === 'startled' || fsm === 'wheel_startled')) return `${voiceName(name)}: startled!`;
  return `${voiceName(name)}: ${MOOD_TEXT[mood]}`;
}

/** Event kinds that become captions: sound word, whether it's a big moment, and an optional verb. */
const SOUND: Readonly<Record<string, readonly [word: string, big: boolean, verb?: string]>> = {
  Detonate: ['BOOM', true], Break: ['crash', true, 'breaks'], Pop: ['pop', true], Burst: ['crackle', true, 'bursts'],
  Ignite: ['fwoosh', false, 'catches fire'], FuseLit: ['fizz', false, 'fuse lit'], Extinguish: ['hiss', false, 'goes out'],
  Cut: ['snip', false], Ring: ['ding', false], Launch: ['whoosh', false, 'launches'], Splash: ['splash', false],
  Confetti: ['pop', false, 'confetti!'], Fire: ['thwack', false], Snap: ['snap', false, 'springs'], Jam: ['clunk', false, 'jams'],
  Brownout: ['bzzt', false, 'browns out'], Cook: ['sizzle', false, 'is cooking'], PinsAllDown: ['clatter', true, 'all pins down!'],
  Sound: ['noise', false], Splat: ['splat', true],
  // M5 parts (A5, docs/dev/M5_NOTES_A5.md). Emerge is the same moment as Teleport (not captioned twice); Charged is
  // the COILGUN RING's recharge (too frequent); Barrier, Engage, Freeze, Boost, Despawn, Teleport, Attach / Release and
  // GRABBER's Trigger / Jam are worded in m5Caption.
  Bounce: ['bonk', false, 'bounces it back'], Call: ['beep-beep', false, 'calls BUZZ'], Collapse: ['implosion', true, 'collapses'], // F5: a beat of silence, then the implosion
};
/** M5 (U5): kinds whose words depend on the part type, the event's mag or the other part. undefined = not one of these. */
function m5Caption(e: CaptionEvent, name: string, type?: string, otherName?: string): Caption | null | undefined {
  const it = otherName ? ` ${otherName}` : '';
  switch (e.kind) {
    case 'Barrier': return e.mag ? { key: `barrier:${e.part}:1`, text: `[hum] ${name} switches on`, big: false } : { key: `barrier:${e.part}:0`, text: `[fzzt] ${name} switches off`, big: false };
    case 'Engage':
      if (type === 'singularity') return { key: `sing:${e.part}`, text: `[VWOOOM] ${name} opens`, big: true };
      return e.mag ? { key: `stasis:${e.part}:1`, text: `[fwmm] ${name} freezes things`, big: false } : { key: `stasis:${e.part}:0`, text: `[fwmm] ${name} lets go`, big: false };
    case 'Boost': return e.mag > 0 ? { key: `boost:${e.part}`, text: `[zzang] ${name} boosts${it}`, big: false } : null;
    case 'Despawn': return type === 'singularity' ? { key: `eat:${e.part}`, text: `[slurp] ${name} swallows${it || ' a part'}`, big: false } : null;
    case 'Teleport': return { key: `warp:${e.part}`, text: `[vwoom]${it || ' something'} warps through ${name}`, big: false };
    case 'Freeze': return { key: `freeze:${e.part}`, text: `[fwip] ${name} freezes${it || ' something'}`, big: false };
    // A5: GRABBER and TRACTOR BEAM (MAGLOCK, M3, uses the same two kinds)
    case 'Attach':
      if (type === 'grabber') return { key: `grab:${e.part}`, text: `[clamp] ${name} grabs${it || ' something'}`, big: false };
      if (type === 'tractor_beam') return { key: `beam:${e.part}`, text: `[hmmm] ${name} catches${it || ' something'}`, big: false };
      if (type === 'maglock') return { key: `mag:${e.part}`, text: `[clank] ${name} grabs${it || ' something'}`, big: false };
      return null;
    case 'Release':
      if (type === 'grabber') return { key: `put:${e.part}`, text: `[clack] ${name} puts${it || ' it'} down`, big: false };
      if (type === 'tractor_beam' || type === 'maglock') return { key: `let:${e.part}`, text: `[click] ${name} lets go`, big: false };
      return null;
    case 'Jam': return type === 'grabber' ? { key: `shrug:${e.part}`, text: `[whirr-clunk] ${name} shrugs: nothing at zone A`, big: false } : undefined;
    case 'Trigger': return type === 'grabber' ? { key: `pick:${e.part}`, text: `[whirr] ${name} reaches for zone A`, big: false } : undefined;
    case 'Emerge': case 'Charged': return null;
    default: return undefined;
  }
}
/** Critter-only kinds (the part is a critter). Bark / Lay: B4's M4 critters. Fetch / Deliver: B5's BUZZ. */
const CRITTER_KIND = new Set(['Emote', 'Ragdoll', 'Trapped', 'Getup', 'Bark', 'Lay', 'Fetch', 'Deliver']);
/** Loudness (dB at 1 m) at which a part's Sound event is captioned. */
export const SOUND_DB_MIN = 70;
/** What a part sounds like when it makes a Sound (SIMULATION §5.10); anything else making one was a hard hit. */
const SOUND_VERB: Readonly<Record<string, string>> = {
  ringer: 'rings', ding: 'dings', tonebars: 'plays a note', gotcha_box: 'springs open', skyrocket: 'whooshes up', big_top: 'booms',
  cork_blaster: 'pops', popper: 'pops', arc_tower: 'crackles', quack: 'squeaks', pane: 'shatters', vase: 'shatters', fishbowl: 'shatters',
};

/**
 * The caption for one SimEvent, or null when it isn't worth one. `name` is the part's display name
 * ("POWDER KEG"); `species` is set when the part is a critter ('mochi', 'biscuit', …).
 */
export function captionFor(e: CaptionEvent, name: string, species?: string, type?: string, otherName?: string): Caption | null {
  if (species && CRITTER_KIND.has(e.kind)) {
    const who = voiceName(name);
    const voice = { ...VOICE.default, ...(VOICE[species] ?? {}) };
    if (e.kind === 'Emote') {
      const mood = emoteMood(e.mag);
      return { key: `emote:${e.part}:${mood}`, text: `[${who} ${voice[mood] ?? voice.voice}]`, big: mood === 'alarm' };
    }
    if (e.kind === 'Ragdoll') return { key: `ragdoll:${e.part}`, text: `[${who} tumbles]`, big: true };
    if (e.kind === 'Trapped') return { key: `trapped:${e.part}`, text: `[${who} is caught!]`, big: true };
    if (e.kind === 'Bark') return { key: `bark:${e.part}`, text: `[${who} ${voice.voice}]`, big: false };
    if (e.kind === 'Lay') return { key: `lay:${e.part}`, text: `[${who} ${voice.egg}]`, big: true };
    // M5 (B5): BUZZ picks up a tagged item and drops it on its beacon
    if (e.kind === 'Fetch') return { key: `fetch:${e.part}`, text: `[${who} grabs ${otherName ?? 'its package'}]`, big: false };
    if (e.kind === 'Deliver') return { key: `deliver:${e.part}`, text: `[${who} delivers ${otherName ?? 'the package'}]`, big: true };
    return null; // Getup: the next emote says it
  }
  const m5 = m5Caption(e, name, type, otherName);
  if (m5 !== undefined) return m5;
  const s = SOUND[e.kind];
  if (!s) return null;
  if (e.kind === 'Sound' && e.mag < SOUND_DB_MIN) return null;
  const [word, big, verb] = s;
  if (e.kind === 'Sound') {
    const verb = type ? SOUND_VERB[type] : undefined;
    return verb ? { key: `sound:${name}`, text: `[${name} ${verb}]`, big } : { key: `clonk:${name}`, text: `[clonk] ${name}`, big };
  }
  if (e.kind === 'Splash') return { key: 'splash', text: '[splash]', big };
  return { key: `${e.kind}:${name}`, text: `[${word}] ${name}${verb ? ` ${verb}` : ''}`, big };
}

export interface CaptionLine { readonly id: number; readonly key: string; text: string; n: number; big: boolean; at: number; born: number; pos: readonly number[] }

/**
 * The visible caption lines: repeats of a key within `mergeMs` collapse to ×n (and move to the front),
 * at most `max` lines live for `lifeMs`, and at most `perSecond` new lines start each second (a burst
 * beyond that merges into the oldest line of the same kind, or is dropped if it isn't a big moment).
 */
export class CaptionModel {
  lines: CaptionLine[] = [];
  private seq = 0;
  private starts: number[] = [];
  constructor(readonly max = 3, readonly lifeMs = 3500, readonly mergeMs = 2500, readonly perSecond = 4) {}

  /** Returns the line that changed and whether it is new (for the announcer), or null if dropped. */
  push(c: Caption, pos: readonly number[], now: number): { line: CaptionLine; fresh: boolean } | null {
    const hit = this.lines.find((l) => l.key === c.key && now - l.at < this.mergeMs);
    if (hit) {
      hit.n++; hit.at = now; hit.pos = pos; hit.big = hit.big || c.big;
      return { line: hit, fresh: false };
    }
    this.starts = this.starts.filter((t) => now - t < 1000);
    if (this.starts.length >= this.perSecond && !c.big) return null;
    this.starts.push(now);
    const line: CaptionLine = { id: ++this.seq, key: c.key, text: c.text, n: 1, big: c.big, at: now, born: now, pos };
    this.lines = [line, ...this.lines];
    if (this.lines.length > this.max) {
      // keep big moments over small ones when trimming
      const small = [...this.lines].reverse().find((l) => !l.big && l !== line);
      this.lines = this.lines.filter((l) => l !== (small ?? this.lines.at(-1)));
    }
    return { line, fresh: true };
  }

  /** Drop expired lines; true when something changed. */
  expire(now: number): boolean {
    const n = this.lines.length;
    this.lines = this.lines.filter((l) => now - l.at < this.lifeMs);
    return this.lines.length !== n;
  }

  clear(): void { this.lines = []; this.starts = []; }
}

/** The display text of a line ("[BOOM] POWDER KEG ×6"). */
export const lineText = (l: Pick<CaptionLine, 'text' | 'n'>): string => (l.n > 1 ? `${l.text} ×${l.n}` : l.text);

/** Where on screen (0..1 across, off-screen flag) → a direction mark for the caption. */
export function directionMark(x: number, onScreen: boolean): '' | '‹' | '›' | '◂' | '▸' {
  if (!onScreen) return x < 0.5 ? '◂' : '▸';
  if (x < 0.3) return '‹';
  if (x > 0.7) return '›';
  return '';
}
