// ---------------------------------------------------------------------------
// OKLCH to sRGB hex.
//
// Every colour in this game is written as a lightness, a chroma and a hue,
// because those three move independently and look like they do: a ramp built
// by stepping lightness keeps its hue, and two colours at the same lightness
// really do read as equally bright. A palette guessed in hex is how a picture
// ends up with muddy midtones.
//
// A colour outside sRGB has its CHROMA reduced until it fits, by bisection.
// Hue and lightness survive that, which is what the eye is watching; clipping
// a channel instead would shift both.
//
// The OKLab transform is Bjorn Ottosson's.
// ---------------------------------------------------------------------------

const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    srgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

const inGamut = (c) => c[0] >= -0.0005 && c[0] <= 1.0005 && c[1] >= -0.0005 && c[1] <= 1.0005
  && c[2] >= -0.0005 && c[2] <= 1.0005;

function toRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
}

// L in [0, 1], C in [0, ~0.4], H in degrees. Returns '#rrggbb'.
export function oklch(L, C, H) {
  L = Math.max(0, Math.min(1, L));
  let rgb = toRgb(L, C, H);
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toRgb(L, mid, H))) lo = mid; else hi = mid;
    }
    rgb = toRgb(L, lo, H);
  }
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return '#' + q(rgb[0]) + q(rgb[1]) + q(rgb[2]);
}

// The same colour with an alpha, for a canvas fill or stroke. Written as
// 8-digit hex so it works everywhere a hex colour does.
export function alpha(hex, a) {
  const v = Math.max(0, Math.min(255, Math.round(a * 255))).toString(16).padStart(2, '0');
  return hex + v;
}

export default oklch;
