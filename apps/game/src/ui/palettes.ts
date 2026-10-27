// Channel colour palettes for the colour presets (M4 stream U4; GAME_SPEC §20, UI_UX §2 / §4.10,
// Settings › Accessibility › Colour preset). Channel identity is always carried by the glyph shape too
// (ui/icons.ts glyph, and the port glyph overlay); the palettes keep the colours apart as well.
//
// How the alternate palettes were made (measured, not picked by eye): a simulated-annealing search over
// sRGB maximised the smallest CIELAB distance between channel colours as seen with that deficiency
// (Machado 2009 full-severity simulation, ui/cvd.ts), while keeping (a) each colour within 25° of its
// default hue so the families still read (heat warm, fluid blue, lure green), (b) the normal-vision
// distances apart, and (c) every colour ≥ 3.2:1 against a stand-alone well over white (non-text contrast,
// WCAG 1.4.11). The numbers are in docs/dev/M4_NOTES_U4.md and checked by test/a11y.test.ts.

import type { ColourPreset } from './settings.ts';

export const CHANNELS = ['impact', 'signal', 'spin', 'tension', 'power', 'heat', 'air', 'light', 'fluid', 'sound', 'lure', 'field'] as const;
export type ChannelName = (typeof CHANNELS)[number];
/** The seven channels every part kit uses (the rest arrived with M2–M4 parts). */
export const CORE_CHANNELS: readonly ChannelName[] = ['impact', 'signal', 'spin', 'tension', 'power', 'heat', 'air'];

/** UI_UX §2 tokens (catalog.ts CHANNEL_HEX plus the M2 channels). */
export const DEFAULT_CHANNELS: Readonly<Record<ChannelName, string>> = {
  impact: '#F2F4F8', signal: '#FFC21A', spin: '#A78BFA', tension: '#E0A96D', power: '#C6FF3A', heat: '#FF5B2E', air: '#9BE7D8',
  light: '#FFF1A8', fluid: '#4C8DFF', sound: '#F472B6', lure: '#34D399', field: '#FF3DAE',
};

export const CHANNEL_PALETTES: Readonly<Record<ColourPreset, Readonly<Record<ChannelName, string>>>> = {
  default: DEFAULT_CHANNELS,
  protanopia: {
    impact: '#F2F4F8', signal: '#FFF1B9', spin: '#9CB0F2', tension: '#D0A461', power: '#99FD7B', heat: '#FC8E07', air: '#0BC19C',
    light: '#8ECE27', fluid: '#ADCCEE', sound: '#F49AB6', lure: '#0EFF2B', field: '#F07CFF',
  },
  deuteranopia: {
    impact: '#F2F4F8', signal: '#F8F0A7', spin: '#FB8AFC', tension: '#E7B100', power: '#F9FF01', heat: '#E49D5C', air: '#10BEBD',
    light: '#BDF756', fluid: '#2DB3FD', sound: '#E0A4AA', lure: '#01D01B', field: '#FCACD8',
  },
  tritanopia: {
    impact: '#F2F4F8', signal: '#E6D759', spin: '#ABB5E1', tension: '#D4A15E', power: '#A8F00B', heat: '#FF9318', air: '#20E4E7',
    light: '#B3D61A', fluid: '#65B7FF', sound: '#FF8CD2', lure: '#19C71D', field: '#CA9FC3',
  },
  // high contrast: the default hues, lifted so every glyph is ≥ 3:1 on a well over white
  'high-contrast': {
    impact: '#FFFFFF', signal: '#FFC21A', spin: '#C4B0FF', tension: '#EBC08F', power: '#C6FF3A', heat: '#FF8A5E', air: '#9BE7D8',
    light: '#FFF1A8', fluid: '#8AB4FF', sound: '#F9A0CE', lure: '#5EE8B0', field: '#FF7AC6',
  },
};

/** A channel's colour in a preset (unknown channels fall back to Fog). */
export function channelHex(ch: string, preset: ColourPreset = 'default'): string {
  return (CHANNEL_PALETTES[preset] ?? DEFAULT_CHANNELS)[ch as ChannelName] ?? '#8A93A6';
}
