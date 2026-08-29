// ---------------------------------------------------------------------------
// The seven materials, and the one lamp that lights them.
//
// Every colour the face is made of arrives as a hex string in the config, so
// the picture can be retuned without touching a shader. This module is the
// only place a fallback lives: a config that is missing a role, or carries a
// string that is not a colour, still produces a face rather than a black
// canvas. The fallbacks are built in OKLCH rather than guessed in hex, so the
// seven of them read as one family lit by one source.
//
// Shaders want linear light, not sRGB bytes, so every role is also kept as a
// three float array ready to hand to a uniform. Those arrays are allocated
// once and never rebuilt, because they are set on a uniform every frame.
//
// The lamp is the only thing in the picture that changes colour. It has two
// ends - resting and fevered - and a frame asks for a point between them. The
// fevered end is derived from the config's own lamp rather than being a
// second colour somebody has to keep in step: warmer by a shift toward the
// orange end of its own hue, and brighter by a lift in lightness. A machine
// in fever is the same lamp turned up, not a different lamp.
// ---------------------------------------------------------------------------

import { oklch, hexToRgb, srgbToLinear, hexToOklch, clampOklch } from '../palette.js?v=5';

// The face as it would be described by somebody standing in front of it:
// deep oxblood lacquer, one cream lamp, brass pins, chrome balls and bezel,
// cream and jade enamel, oxblood lettering.
export const DEFAULT_PALETTE = {
  lacquer: oklch(0.185, 0.068, 27),
  lamp:    oklch(0.930, 0.045, 88),
  brass:   oklch(0.720, 0.115, 88),
  chrome:  oklch(0.680, 0.008, 250),
  enamel:  oklch(0.900, 0.022, 110),
  jade:    oklch(0.655, 0.095, 168),
  oxblood: oklch(0.320, 0.090, 25),
};

export const ROLES = Object.keys(DEFAULT_PALETTE);

// A pocket is pressed from one of these, named by its tone rather than by
// what it pays, because two mouths that pay differently can be the same
// enamel and the one that is not has to be seen from across the room.
// A config may remap any tone onto another palette role.
export const TONE_ORDER = ['enamel', 'jade', 'oxblood', 'brass'];
export const DEFAULT_TONE_ROLES = {
  enamel: 'enamel',
  jade: 'jade',
  oxblood: 'oxblood',
  brass: 'brass',
};

const HEX = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True when a value is a string a colour can actually be read out of. */
export function isHex(value) {
  return typeof value === 'string' && HEX.test(value.trim());
}

/**
 * The seven roles as hex strings, every missing or malformed one replaced.
 * Never throws: a broken config costs a colour, not a frame.
 */
export function resolvePalette(cfg) {
  const given = (cfg && cfg.palette) || {};
  const out = {};
  for (const role of ROLES) {
    out[role] = isHex(given[role]) ? normaliseHex(given[role]) : DEFAULT_PALETTE[role];
  }
  return out;
}

function normaliseHex(value) {
  let h = value.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.toLowerCase();
}

/** A hex string as linear light, written into `out` so no frame allocates. */
export function linearInto(hex, out) {
  const rgb = hexToRgb(hex);
  out[0] = srgbToLinear(rgb[0]);
  out[1] = srgbToLinear(rgb[1]);
  out[2] = srgbToLinear(rgb[2]);
  return out;
}

/** A hex string as a fresh three float linear colour. */
export const linear = (hex) => linearInto(hex, new Float32Array(3));

/**
 * The lamp at full fever, derived from the lamp at rest: the same light
 * pushed toward the warm end of its own hue. Brightness is deliberately left
 * almost alone here and carried by the gain instead, because lifting an
 * already pale lamp's lightness runs it out of gamut, and a colour that has
 * been chroma clamped back to white reads cooler, not warmer.
 */
export function feverLamp(hex, { warmth = 26, lift = -0.03, chroma = 0.075 } = {}) {
  const [L, C, H] = hexToOklch(hex);
  // Hue walks toward orange the short way round, so a cream lamp warms and a
  // lamp that is already orange stays put rather than swinging through red.
  const target = 62;
  let dh = ((target - H + 540) % 360) - 180;
  dh = Math.max(-warmth, Math.min(warmth, dh));
  const rgb = clampOklch([Math.min(1, L + lift), C + chroma, (H + dh + 360) % 360]);
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

/**
 * Every colour a frame needs, in linear light, plus the two ends of the lamp.
 * Built once per config; `lampInto` is the only part a frame touches.
 */
export function createColours(cfg) {
  const hex = resolvePalette(cfg);
  const lin = {};
  for (const role of ROLES) lin[role] = linear(hex[role]);

  const roles = Object.assign({}, DEFAULT_TONE_ROLES, (cfg && cfg.pocketTones) || {});
  // The four tones laid end to end, so the shader can index a pocket straight
  // into one uniform array rather than branching per pocket.
  const pocketFill = new Float32Array(TONE_ORDER.length * 3);
  TONE_ORDER.forEach((tone, i) => {
    const role = ROLES.includes(roles[tone]) ? roles[tone] : DEFAULT_TONE_ROLES[tone];
    pocketFill.set(lin[role], i * 3);
  });

  const rest = lin.lamp;
  const hot = feverLamp(hex.lamp);
  const lampColour = new Float32Array(3);
  // Gain rides with the colour: a fevered lamp is brighter as well as warmer,
  // because a hue change on its own is a state the eye can miss.
  const restGain = 1.0;
  const hotGain = 1.5;

  return {
    hex,
    lin,
    pocketFill,
    toneOrder: TONE_ORDER,
    /** The lamp between rest and fever. Returns the shared array, not a copy. */
    lampInto(fever) {
      const f = Math.max(0, Math.min(1, Number(fever) || 0));
      for (let i = 0; i < 3; i++) lampColour[i] = rest[i] + (hot[i] - rest[i]) * f;
      return lampColour;
    },
    lampGain(fever) {
      const f = Math.max(0, Math.min(1, Number(fever) || 0));
      return restGain + (hotGain - restGain) * f;
    },
  };
}
