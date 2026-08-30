// ---------------------------------------------------------------------------
// The ten materials, and the one lamp that lights them.
//
// A machine is painted in a named skin, and the skin decides every colour on
// it. This module resolves one: it takes the skin's name, lays anything the
// config wants to say over the top, and hands back a set of materials that is
// always complete. A missing role, or a string that is not a colour, costs a
// colour rather than a frame.
//
// Shaders want linear light, not sRGB bytes, so every role is also kept as a
// three float array ready to hand to a uniform. Those arrays are allocated
// once and written into afterwards, never replaced - repainting the machine
// must not invalidate a uniform somebody is holding a reference to, and must
// not allocate.
//
// The lamp is the light over the cabinet. It has two ends - resting and
// fevered - and a frame asks for a point between them. The fevered end is
// derived from the skin's own lamp rather than being a second colour somebody
// has to keep in step: warmer by a shift toward the orange end of its own
// hue, and brighter by a lift in gain. A machine in fever is the same lamp
// turned up, not a different lamp.
// ---------------------------------------------------------------------------

import { oklch, hexToRgb, srgbToLinear, hexToOklch, clampOklch } from '../palette.js?v=46';
import { resolveTheme, themeForCabinet, DEFAULT_THEME } from './themes.js?v=46';

// What a machine is made of when nobody has said. This is the default skin
// written out flat, so this module still produces a face with no skin table
// reachable at all.
export const DEFAULT_PALETTE = {
  lacquer: '#00bac9',
  lamp:    '#e9f9f9',
  brass:   '#f0e8cb',
  chrome:  '#d5dbde',
  enamel:  '#00eeef',
  jade:    '#ffa658',
  oxblood: '#042428',
  room:    '#040a12',
  screen:  '#0d2036',
  glow:    '#e36b00',
  shell:   '#3a6a71',
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
 * Every role as a hex string, with anything missing or malformed replaced.
 * Never throws: a broken config costs a colour, not a frame.
 *
 * The order of precedence is the order somebody would expect from the outside.
 * A named skin is the machine's paint and wins, because a player who picked a
 * cabinet expects that cabinet's colours. A config palette is what a machine
 * with no skin named is painted in, so a page that only hands over a palette -
 * which is how this started - still gets exactly the face it asks for.
 */
export function resolvePalette(cfg, theme) {
  const named = typeof theme === 'string' && theme ? resolveTheme(theme, cfg) : null;
  const given = (cfg && cfg.palette) || {};
  const out = {};
  for (const role of ROLES) {
    const skin = named && isHex(named[role]) ? normaliseHex(named[role]) : null;
    if (skin) { out[role] = skin; continue; }
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
export function feverLamp(hex, { warmth = 115, lift = -0.03, chroma = 0.075 } = {}) {
  const [L, C, H] = hexToOklch(hex);
  // Hue walks toward orange the short way round, so a lamp of any skin warms
  // and one that is already orange stays put rather than swinging through red.
  // The swing has to be wide: a machine painted turquoise hangs a lamp with a
  // cool cast, and a cap tight enough for a cream lamp would leave that one
  // walking from cyan to green and calling it heat.
  const target = 62;
  let dh = ((target - H + 540) % 360) - 180;
  dh = Math.max(-warmth, Math.min(warmth, dh));
  const rgb = clampOklch([Math.min(1, L + lift), C + chroma, (H + dh + 360) % 360]);
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

/**
 * Every colour a frame needs, in linear light, plus the two ends of the lamp.
 *
 * The arrays are allocated here and only ever written into, so a repaint is a
 * hundred floats rather than a rebuild, and a uniform holding one of them
 * keeps pointing at the right thing. `lampInto` and `paint` are the only parts
 * anything calls after this returns.
 */
export function createColours(cfg, theme) {
  const lin = {};
  for (const role of ROLES) lin[role] = new Float32Array(3);

  const roles = Object.assign({}, DEFAULT_TONE_ROLES, (cfg && cfg.pocketTones) || {});
  // The four tones laid end to end, so the shader can index a pocket straight
  // into one uniform array rather than branching per pocket.
  const pocketFill = new Float32Array(TONE_ORDER.length * 3);
  const rest = new Float32Array(3);
  const hot = new Float32Array(3);
  const lampColour = new Float32Array(3);
  // Gain rides with the colour: a fevered lamp is brighter as well as warmer,
  // because a hue change on its own is a state the eye can miss.
  const restGain = 1.0;
  const hotGain = 1.5;

  let hex = null;
  let painted = null;

  function paint(name) {
    const want = typeof name === 'string' && name ? name : DEFAULT_THEME;
    if (painted === want) return false;
    painted = want;
    hex = resolvePalette(cfg, want);
    for (const role of ROLES) linearInto(hex[role], lin[role]);
    TONE_ORDER.forEach((tone, i) => {
      const role = ROLES.includes(roles[tone]) ? roles[tone] : DEFAULT_TONE_ROLES[tone];
      pocketFill.set(lin[role], i * 3);
    });
    rest.set(lin.lamp);
    hot.set(feverLamp(hex.lamp));
    return true;
  }
  paint(theme);

  return {
    lin,
    pocketFill,
    toneOrder: TONE_ORDER,
    /** The skin the machine is wearing, and the hex it resolved to. */
    theme() { return painted; },
    hex() { return hex; },
    /** Repaint in a named skin. True when anything actually changed. */
    paint,
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

export { themeForCabinet, DEFAULT_THEME };
