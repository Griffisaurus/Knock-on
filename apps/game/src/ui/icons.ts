// Icons (D77, ui_icons brief): parts are shown as 3D renders everywhere (tray, Library, Inspector header,
// palette, feed, Cascade chips) from /parts/<art>/<art>.thumb.webp, with a line icon by family as the
// fallback. Line icons stay for actions and tools. Channel glyphs are SVG (colour + shape, never colour alone).

import { CHANNEL_HEX, partDef } from '../catalog.ts';
import { channelHex, DEFAULT_CHANNELS } from './palettes.ts';
import { settings } from './settings.ts';

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

/** Line icons for actions and tools (24 × 24, currentColor). */
export const ICON = {
  orbit: svg('<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3v2M12 19v2"/>'),
  pan: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 15.5a1.6 1.6 0 0 1 2.6-1.8L8 16"/>'),
  zoom: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6M8 11h6"/>'),
  cube: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  xray: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 2.5"/><circle cx="12" cy="12" r="3"/>'),
  section: svg('<path d="M4 8h12v12H4z"/><path d="M8 4h12v12" stroke-dasharray="2 2.5"/>'),
  cutaway: svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9" stroke-dasharray="2 2.5"/><path d="M4 7.5 12 12"/>'),
  outliner: svg('<path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>'),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  menu: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  pin: svg('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
  stepBack: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="3" height="14" rx="1"/><path d="M19 5v14L9 12z"/></svg>',
  stepFwd: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16" y="5" width="3" height="14" rx="1"/><path d="M5 5v14l10-7z"/></svg>',
  back1: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 6v12L3 12zM20 6v12l-8-6z"/></svg>',
  fwd1: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 6v12l8-6zM4 6v12l8-6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z" fill="currentColor"/></svg>',
  starLine: svg('<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  modules: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  connect: svg('<circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17c6 0 4-10 10-10"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  anchor: svg('<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 10h8"/>'),
  inspect: svg('<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="17" cy="16" r="3"/><path d="m21 20-1.8-1.8"/>'),
  library: svg('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 3.5.9-3 14.6-3.4-.8"/>'),
  isolate: svg('<circle cx="12" cy="12" r="4"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  group: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>'),
  mirror: svg('<path d="M12 3v18" stroke-dasharray="2 3"/><path d="M9 7 4 12l5 5zM15 7l5 5-5 5z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  worlds: svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>'),
  camera: svg('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3z"/>'),
  ride: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>'),
  overview: svg('<path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  broom: svg('<path d="M14 4 9 13M6 13h8l2 7H4z"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  ping: svg('<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/>'),
  // U5 (M5): BUZZ's tag (D105): a luggage tag
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.6"/>'),
  // U5 (M5): sizing handles (FORCE WALL, STASIS FIELD, ZONE)
  resize: svg('<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>'),
} as const;
export type IconName = keyof typeof ICON;

/** Family line icons: tray tabs and the 3D-render fallback. */
export const FAMILY_ICON: Record<string, string> = {
  rollers: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/>'),
  frame: svg('<path d="M3 20h18L3 8z"/>'),
  drive: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
  air: svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
  power: svg('<path d="M14 2 5 14h6l-2 8 9-12h-6z"/>'),
  boom: svg('<rect x="4" y="9" width="12" height="10" rx="2"/><path d="M16 12c3 0 3-5 6-5M20 4l1-1M22 7h1"/>'),
  contraptions: svg('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 18 4M16 16 6 4"/>'),
  fun: svg('<rect x="4" y="4" width="5" height="16" rx="1"/><rect x="11" y="6" width="5" height="14" rx="1" transform="rotate(14 13 13)"/>'),
  critters: svg('<circle cx="12" cy="13" r="6"/><path d="m7 9-1-5 4 3M17 9l1-5-4 3"/>'),
  // M4 (U4): Matter (sand, water, marbles): a pile of grains under a drop
  matter: svg('<path d="M12 2c2 3 4 5 4 7a4 4 0 0 1-8 0c0-2 2-4 4-7z"/><circle cx="5" cy="20" r="1.6"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="14.5" cy="19" r="1.6"/><circle cx="19" cy="20" r="1.6"/><circle cx="7.3" cy="16" r="1.6"/><circle cx="12" cy="15.4" r="1.6"/><circle cx="16.7" cy="16" r="1.6"/>'),
  future: svg('<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>'),
};

/** The art mesh a part's render is named after (COG sizes have one each). */
export function artName(type: string, props?: Record<string, number>): string {
  const d = partDef(type);
  if (!d) return type;
  if (d.artFor && props) return d.artFor(props);
  return d.art ?? type;
}

export const thumbUrl = (art: string): string => `/parts/${art}/${art}.thumb.webp`;

const missing = new Set<string>();

/**
 * A part's 3D icon: the thumbnail render on a transparent background, or the family line icon when the
 * render isn't built (remembered, so a missing render is requested once per session).
 */
export function partIcon(type: string, opts: { size?: number; props?: Record<string, number>; cls?: string } = {}): HTMLElement {
  const art = artName(type, opts.props);
  const fam = partDef(type)?.family ?? '';
  const wrap = document.createElement('span');
  wrap.className = `picon ${opts.cls ?? ''}`.trim();
  if (opts.size) wrap.style.setProperty('--picon', `${opts.size}px`);
  const fallback = (): void => {
    wrap.classList.add('line');
    wrap.innerHTML = FAMILY_ICON[fam] ?? ICON.cube;
  };
  if (missing.has(art)) { fallback(); return wrap; }
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.draggable = false;
  img.src = thumbUrl(art);
  img.onerror = () => { missing.add(art); img.remove(); fallback(); };
  wrap.appendChild(img);
  return wrap;
}

/** Channel colours (UI_UX §2), including the M2 channels the catalogue doesn't list; the colour preset (U4) swaps them. */
const glyphHex = (ch: string): string => (ch in CHANNEL_HEX || ch in DEFAULT_CHANNELS ? channelHex(ch, settings.accessibility.colourPreset) : '#8A93A6');
/** Channel glyph paths (UI_UX / GAME_SPEC §9.2): shape + colour. */
const GLYPH: Record<string, { d: string; fill?: boolean; sw?: number }> = {
  impact: { d: 'M12 2 L14.1 6.9 L19.1 4.9 L17.1 9.9 L22 12 L17.1 14.1 L19.1 19.1 L14.1 17.1 L12 22 L9.9 17.1 L4.9 19.1 L6.9 14.1 L2 12 L6.9 9.9 L4.9 4.9 L9.9 6.9Z', fill: true },
  signal: { d: 'M12 2 L20 12 L12 22 L4 12Z', fill: true },
  spin: { d: 'M19.8 9A8.5 8.5 0 1 0 20 15 M22 4.5 L20 9.5 L15 8', sw: 3 },
  tension: { d: 'M2 12c2.5-6 5-6 7 0s4.5 6 7 0 3-4 6-3', sw: 3.2 },
  power: { d: 'M14 2 5 14h6l-2 8 9-12h-6z', fill: true },
  heat: { d: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z', fill: true },
  air: { d: 'M3 7c3-2 6 2 9 0s6-2 8 0M3 12c3-2 6 2 9 0s6-2 8 0M3 17c3-2 6 2 9 0s6-2 8 0', sw: 2.4 },
  light: { d: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1', sw: 2.2 },
  fluid: { d: 'M12 2c3 5 7 8.5 7 13a7 7 0 0 1-14 0c0-4.5 4-8 7-13z', fill: true },
  sound: { d: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', sw: 2.2 },
  lure: { d: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z', fill: true },
  field: { d: 'M6 3v8a6 6 0 0 0 12 0V3M6 3h4v8a2 2 0 0 0 4 0V3h4', sw: 2.2 },
  other: { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', fill: true },
};

export function glyph(ch: string, size = 16): string {
  const g = GLYPH[ch];
  const col = glyphHex(ch);
  if (!g) return '';
  const paint = g.fill ? `fill="${col}" stroke="none"` : `fill="none" stroke="${col}" stroke-width="${g.sw ?? 2}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${ch}" data-ch="${ch}"><title>${ch}</title><path d="${g.d}" ${paint}/></svg>`;
}

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Build an element from an HTML string (trusted templates only; dynamic text goes in via textContent). */
export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}
