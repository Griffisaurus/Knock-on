// Critter emote bubbles (GAME_SPEC §11): a small speech bubble over each critter's head showing its
// current emote (`CRITTER_EMOTES[critterState byte 2]`), as a DOM overlay positioned from the head bone
// each frame. Glyphs are emoji / text for v1 (an icon atlas can replace GLYPH later). Bubbles pop in and
// out with a short scale animation (an opacity fade only with reduced motion), shrink with distance, and
// hide past 30 m, behind the camera, or while `hidden` is set (photo mode).

import type { Mat4 } from '../math.ts';

/** Emote name → glyph (CRITTER_EMOTES, parts-data critters.ts). Unknown names show nothing. */
export const EMOTE_GLYPH: Readonly<Record<string, string>> = {
  '!': '❗', '?': '❓', zzz: '💤', stars: '💫', heart: '❤️', angry: '💢', sweat: '💦',
  eyes_pip: '👀', snack_heart: '🍪', grumpy: '😒', steam: '💨', dog_alert: '🐕',
  seed: '🌻', cat_alert: '🐈', stopwatch: '⏱️',
  bubbles: '🫧', water_drop: '💧', food_flake: '🐟', kiss: '😘',
  sparkle: '✨', grin: '😁', pedal: '🚲',
  // M4 (B4's emotes): BISCUIT, HENNY, DUSTY
  bark: '🗯️', eyes_mochi: '👀', bone: '🦴', egg: '🥚', '!!': '‼️', feather: '🪶', sparkle_clean: '✨', bin_full: '🗑️',
  // M5 (B5's emotes): BUZZ
  package: '📦', pin: '📍', check: '✅', clock: '⏰',
};

const STYLE = `
.kn-emote { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 5; will-change: transform;
  transform-origin: 50% 100%; }
.kn-emote > b { display: block; transform-origin: 50% 100%; transform: scale(0); opacity: 0;
  transition: transform 180ms cubic-bezier(.3,1.6,.6,1), opacity 120ms linear;
  background: #fffdf8; color: #1c1f26; border-radius: 1.1em; padding: .18em .42em; line-height: 1.15;
  font: 600 1em/1.15 Inter, system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.25); white-space: nowrap; }
.kn-emote > b::after { content: ''; position: absolute; left: 50%; bottom: -.32em; margin-left: -.3em;
  border: .32em solid transparent; border-top-color: #fffdf8; border-bottom: 0; }
.kn-emote.in > b { transform: scale(1); opacity: 1; }
.kn-emote.calm > b { transition: opacity 160ms linear; transform: scale(1); }
`;

export interface EmoteShow {
  readonly key: string;
  /** World point just above the head. */
  readonly pos: readonly [number, number, number];
  readonly emote: string;
}

export class EmoteBubbles {
  /** Photo mode (or any clean capture) hides every bubble. */
  hidden = false;
  /** Reduced motion: fade instead of pop. */
  reducedMotion = false;
  private readonly host: HTMLElement;
  private readonly live = new Map<string, { el: HTMLDivElement; emote: string; leaving: number }>();

  constructor(host: HTMLElement) {
    this.host = host;
    if (!document.getElementById('kn-emote-style')) {
      const st = document.createElement('style');
      st.id = 'kn-emote-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
  }

  /** Per frame: place, pop in, change or pop out every bubble. */
  update(shows: readonly EmoteShow[], viewProj: Mat4, eye: readonly number[], canvas: HTMLCanvasElement, now: number): void {
    const seen = new Set<string>();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const s of this.hidden ? [] : shows) {
      const glyph = EMOTE_GLYPH[s.emote];
      if (!glyph) continue;
      const p = s.pos, m = viewProj;
      const cw = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
      const dist = Math.hypot(p[0] - eye[0]!, p[1] - eye[1]!, p[2] - eye[2]!);
      if (cw <= 0.05 || dist > 30) continue;
      const x = ((m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / cw * 0.5 + 0.5) * w;
      const y = (1 - ((m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / cw * 0.5 + 0.5)) * h;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
      seen.add(s.key);
      let b = this.live.get(s.key);
      if (!b) {
        const el = document.createElement('div');
        el.className = 'kn-emote';
        el.appendChild(document.createElement('b'));
        this.host.appendChild(el);
        b = { el, emote: '', leaving: 0 };
        this.live.set(s.key, b);
      }
      if (b.emote !== s.emote || b.leaving) {
        b.emote = s.emote;
        b.leaving = 0;
        (b.el.firstChild as HTMLElement).textContent = glyph;
        b.el.classList.toggle('calm', this.reducedMotion);
        // re-pop: drop the class, force a style flush, add it back
        b.el.classList.remove('in');
        void b.el.offsetWidth;
        b.el.classList.add('in');
      }
      // readable at normal distances: 15–24 px
      const px = Math.max(15, Math.min(24, 30 / Math.sqrt(Math.max(dist, 0.5))));
      b.el.style.fontSize = `${px.toFixed(1)}px`;
      b.el.style.transform = `translate(${(x + canvas.offsetLeft).toFixed(1)}px, ${(y + canvas.offsetTop).toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [k, b] of this.live) {
      if (seen.has(k)) continue;
      if (!b.leaving) { b.leaving = now; b.el.classList.remove('in'); }
      else if (now - b.leaving > 220) { b.el.remove(); this.live.delete(k); }
    }
  }

  clear(): void {
    for (const b of this.live.values()) b.el.remove();
    this.live.clear();
  }
}
