// ---------------------------------------------------------------------------
// Colour arithmetic in OKLab.
//
// Every tint the relief needs - a shadow cooled and darkened, a lit face
// warmed, far ground faded toward the paper - is a mix or a lightness move.
// Done in OKLab those moves keep their hue and read as even steps to the eye;
// done in hex they go muddy in the middle. This is the small set of
// conversions that makes the ground's palette from the seven band colours
// in config, once, at start.
// ---------------------------------------------------------------------------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return '#' + q(rgb[0]) + q(rgb[1]) + q(rgb[2]);
}

export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [
    clamp(toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  ];
}

export const hexToOklab = (hex) => rgbToOklab(hexToRgb(hex));
export const oklabToHex = (lab) => rgbToHex(oklabToRgb(lab));

/** A hex colour moved a fraction of the way toward another, in OKLab. */
export function mixHex(hexA, hexB, t) {
  const a = hexToOklab(hexA), b = hexToOklab(hexB);
  return oklabToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** A hex colour with its lightness scaled, hue and chroma kept. */
export function scaleLightness(hex, f) {
  const lab = hexToOklab(hex);
  return oklabToHex([Math.max(0, Math.min(1, lab[0] * f)), lab[1], lab[2]]);
}
