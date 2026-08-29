// ---------------------------------------------------------------------------
// Colour, done in OKLCH.
//
// OKLCH is the perceptual space browsers now speak natively (CSS oklch()).
// Lightness, chroma and hue move independently and look like they do, so a
// ramp built by stepping L keeps its hue, and two colours with the same L
// really read as equally bright. Building palettes in hex and guessing is
// how a game ends up with the muddy midtones every other game has.
//
// Also here: Inigo Quilez's cosine palettes (a whole gradient from four
// vectors, ideal for shaders), harmony generators, contrast, and a gamut
// clamp so a vivid OKLCH colour still lands on a real sRGB pixel.
// ---------------------------------------------------------------------------

// ---- sRGB <-> linear ------------------------------------------------------
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// ---- hex ------------------------------------------------------------------
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return '#' + q(r) + q(g) + q(b);
}

// ---- OKLab (Bjorn Ottosson) ----------------------------------------------
export function rgbToOklab([r, g, b]) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
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
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

// ---- OKLCH ----------------------------------------------------------------
// L in [0, 1], C in [0, ~0.4], H in degrees.
export function oklabToOklch([L, a, b]) {
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

export function oklchToOklab([L, C, H]) {
  const h = (H * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

export const rgbToOklch = (rgb) => oklabToOklch(rgbToOklab(rgb));
export const oklchToRgb = (lch) => oklabToRgb(oklchToOklab(lch));
export const hexToOklch = (hex) => rgbToOklch(hexToRgb(hex));

const inGamut = ([r, g, b]) => r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && b >= -0.0005 && b <= 1.0005;

// Reduce chroma until the colour fits sRGB. Hue and lightness survive, which
// is what the eye cares about; a clipped channel would shift both.
export function clampOklch([L, C, H]) {
  L = Math.max(0, Math.min(1, L));
  let rgb = oklchToRgb([L, C, H]);
  if (inGamut(rgb)) return rgb.map((v) => Math.max(0, Math.min(1, v)));
  let lo = 0, hi = C;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    rgb = oklchToRgb([L, mid, H]);
    if (inGamut(rgb)) lo = mid; else hi = mid;
  }
  return oklchToRgb([L, lo, H]).map((v) => Math.max(0, Math.min(1, v)));
}

// oklch(L C H) -> '#rrggbb'
export const oklch = (L, C, H) => rgbToHex(clampOklch([L, C, H]));

// CSS string, for custom properties and canvas fillStyle in browsers that
// take oklch() (all current ones do).
export const oklchCss = (L, C, H, alpha) =>
  alpha === undefined ? `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`
    : `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)} / ${alpha})`;

// ---- ramps and harmonies --------------------------------------------------
// n colours from one OKLCH colour to another, interpolated in OKLCH so the
// midpoints are neither grey nor muddy. Hue takes the short way round.
export function ramp(from, to, n) {
  const [L0, C0, H0] = from, [L1, C1, H1] = to;
  let dh = ((H1 - H0 + 540) % 360) - 180;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    out.push(rgbToHex(clampOklch([L0 + (L1 - L0) * t, C0 + (C1 - C0) * t, (H0 + dh * t + 360) % 360])));
  }
  return out;
}

// Tints and shades of one hue: a full material family from a single colour.
export function family(H, C = 0.12, steps = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
  return steps.map((L) => oklch(L, C * Math.sin(Math.PI * L) * 1.2 + 0.01, H));
}

// Hues around the wheel from a base hue.
export const harmony = {
  complementary: (H) => [H, (H + 180) % 360],
  split: (H) => [H, (H + 150) % 360, (H + 210) % 360],
  triad: (H) => [H, (H + 120) % 360, (H + 240) % 360],
  analogous: (H, spread = 30) => [(H - spread + 360) % 360, H, (H + spread) % 360],
  tetrad: (H) => [H, (H + 90) % 360, (H + 180) % 360, (H + 270) % 360],
};

// ---- cosine palettes (Inigo Quilez) --------------------------------------
// colour(t) = a + b * cos(2 pi (c t + d)), t in [0, 1]. Four vec3s describe a
// whole gradient; the same four numbers drop straight into a shader.
export function cosine(t, a, b, c, d) {
  return [0, 1, 2].map((i) => Math.max(0, Math.min(1, a[i] + b[i] * Math.cos(2 * Math.PI * (c[i] * t + d[i])))));
}

export const cosinePresets = {
  // warm to cool, the default rainbow with the green tamed
  rainbow: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]],
  // fire: black, red, yellow, white
  fire: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 0.5], [0.8, 0.9, 0.3]],
  // deep sea
  sea: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.3, 0.2, 0.2]],
  // dusk: violet, orange, teal
  dusk: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [2, 1, 0], [0.5, 0.2, 0.25]],
  // ashes: grey with a warm ember
  ember: [[0.35, 0.3, 0.3], [0.35, 0.3, 0.25], [1, 1, 1], [0, 0.1, 0.2]],
};

export function cosineRamp(preset, n) {
  const [a, b, c, d] = typeof preset === 'string' ? cosinePresets[preset] : preset;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rgbToHex(cosine(i / Math.max(1, n - 1), a, b, c, d)));
  return out;
}

// ---- contrast -------------------------------------------------------------
export function luminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio between two hex colours; 4.5 is the floor for text.
export function contrast(hexA, hexB) {
  const a = luminance(hexToRgb(hexA)), b = luminance(hexToRgb(hexB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Nudge a colour's lightness until it clears a contrast ratio against a
// background. Keeps hue and chroma; walks away from the background's L.
export function ensureContrast(hex, bgHex, ratio = 4.5) {
  let [L, C, H] = hexToOklch(hex);
  const bgL = hexToOklch(bgHex)[0];
  const dir = L >= bgL ? 1 : -1;
  for (let i = 0; i < 40 && contrast(oklch(L, C, H), bgHex) < ratio; i++) L = Math.max(0, Math.min(1, L + dir * 0.02));
  return oklch(L, C, H);
}

// ---- mixing ---------------------------------------------------------------
export function mix(hexA, hexB, t) {
  const a = rgbToOklab(hexToRgb(hexA)), b = rgbToOklab(hexToRgb(hexB));
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t)).map((v) => Math.max(0, Math.min(1, v))));
}

// A whole game palette from one seed hue. Returns named roles, all mutually
// legible on the chosen ground. Dark or light ground.
export function scheme(H, { dark = true, chroma = 0.13 } = {}) {
  const ground = dark ? oklch(0.15, 0.02, H) : oklch(0.96, 0.015, H);
  const panel = dark ? oklch(0.21, 0.025, H) : oklch(0.91, 0.02, H);
  const ink = dark ? oklch(0.92, 0.02, H) : oklch(0.18, 0.03, H);
  const dim = dark ? oklch(0.62, 0.03, H) : oklch(0.48, 0.03, H);
  const [h1, h2, h3] = harmony.split(H);
  const accent = ensureContrast(oklch(dark ? 0.75 : 0.5, chroma, h1), ground, 4.5);
  const warm = ensureContrast(oklch(dark ? 0.78 : 0.55, chroma, h2), ground, 4.5);
  const cool = ensureContrast(oklch(dark ? 0.72 : 0.5, chroma, h3), ground, 4.5);
  return { ground, panel, ink, dim, accent, warm, cool };
}

export default { oklch, oklchCss, ramp, family, harmony, cosine, cosineRamp, contrast, ensureContrast, mix, scheme };
