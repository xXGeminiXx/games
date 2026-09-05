// ---------------------------------------------------------------------------
// The chalk hand: an alphabet made of strokes, written rather than typeset.
//
// Everything on the slate is drawn by this file. A glyph is a list of
// polylines in a unit box - x from 0, y from 0 at the top of the box to 1 at
// the baseline, with descenders past it - and writing one lays the same
// polyline down two or three times with a small seeded wobble, a round cap and
// a falling alpha, which is what a stick of chalk on a rough wall does.
//
// WHY THE LETTERFORMS ARE CODE AND NOT A FONT. A web font is either a file in
// the repository or a request to a font host at load, and this game has
// neither: no assets, no network. A system stack cannot look written. So the
// display face is a table of coordinates, which also buys the thing a font
// could never give: rewriting a figure genuinely redraws it, with different
// wobble, so the board reads as a hand keeping up with the crowd.
//
// THE WOBBLE IS STABLE PER STRING. It is hashed from the text and the point
// index, not drawn from a live generator, so a figure that has not changed
// does not shimmer between frames. When the digits change the hash changes and
// the strokes are genuinely different, which is the whole effect.
//
// A written string is cached onto its own small canvas and stamped. That is
// what makes a tape of forty prints and a full depth ladder affordable at
// sixty frames a second, and it is also what makes a GHOST cheap: the wiped
// string is the previous cache entry, drawn again at a lower alpha.
// ---------------------------------------------------------------------------

import { xmur3 } from './rng.js?v=7';

const TAU = Math.PI * 2;
const rad = (deg) => (deg * Math.PI) / 180;

// A polyline around an ellipse, from one angle to another in degrees. Angles
// are the usual mathematical ones over a y-down canvas, so 0 is right, 90 is
// down, 180 is left.
function arc(cx, cy, rx, ry, from, to, steps) {
  const n = steps || Math.max(6, Math.round(Math.abs(to - from) / 22));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(from + ((to - from) * i) / n);
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

const ring = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, -95, 268);

// Each entry is [advance width, ...polylines]. Heights: a digit fills the box,
// lowercase sits between 0.38 and 1, ascenders reach 0.03, descenders 1.28.
export const GLYPHS = {
  '0': [0.62, ring(0.31, 0.51, 0.26, 0.47)],
  '1': [0.44, [0.10, 0.26, 0.30, 0.04], [0.30, 0.04, 0.30, 0.98], [0.12, 0.98, 0.48, 0.98]],
  '2': [0.62, [0.06, 0.26, 0.14, 0.10, 0.32, 0.03, 0.50, 0.10, 0.56, 0.26, 0.48, 0.44, 0.08, 0.86, 0.06, 0.98], [0.06, 0.98, 0.57, 0.98]],
  '3': [0.62, [0.07, 0.14, 0.24, 0.03, 0.46, 0.08, 0.52, 0.24, 0.36, 0.45, 0.20, 0.47], [0.28, 0.45, 0.50, 0.52, 0.57, 0.72, 0.48, 0.92, 0.26, 0.99, 0.07, 0.90]],
  '4': [0.62, [0.44, 0.03, 0.05, 0.70, 0.58, 0.70], [0.44, 0.03, 0.44, 0.98]],
  '5': [0.62, [0.52, 0.05, 0.14, 0.05, 0.10, 0.42, 0.28, 0.36, 0.48, 0.44, 0.56, 0.66, 0.46, 0.92, 0.24, 0.99, 0.06, 0.90]],
  '6': [0.62, [0.50, 0.06, 0.28, 0.06, 0.12, 0.24, 0.07, 0.58, 0.12, 0.86, 0.30, 0.99, 0.48, 0.92, 0.54, 0.72, 0.44, 0.55, 0.24, 0.52, 0.10, 0.62]],
  '7': [0.60, [0.05, 0.05, 0.57, 0.05, 0.28, 0.98]],
  '8': [0.62, ring(0.31, 0.25, 0.21, 0.21), ring(0.31, 0.72, 0.25, 0.25)],
  '9': [0.62, ring(0.31, 0.29, 0.24, 0.25), [0.54, 0.30, 0.51, 0.74, 0.36, 0.94, 0.14, 0.98]],

  a: [0.58, ring(0.28, 0.69, 0.22, 0.30), [0.50, 0.40, 0.50, 1.00]],
  b: [0.58, [0.08, 0.03, 0.08, 1.00], ring(0.32, 0.69, 0.24, 0.30)],
  c: [0.56, arc(0.31, 0.69, 0.24, 0.30, 60, 300)],
  d: [0.58, ring(0.28, 0.69, 0.24, 0.30), [0.52, 0.03, 0.52, 1.00]],
  e: [0.56, [0.07, 0.68, 0.53, 0.68], arc(0.30, 0.69, 0.23, 0.30, 0, -250)],
  f: [0.44, [0.42, 0.03, 0.30, 0.05, 0.24, 0.18, 0.24, 1.00], [0.08, 0.42, 0.44, 0.42]],
  g: [0.58, ring(0.28, 0.69, 0.22, 0.29), [0.50, 0.40, 0.50, 1.10, 0.40, 1.25, 0.18, 1.28, 0.06, 1.20]],
  h: [0.58, [0.08, 0.03, 0.08, 1.00], [0.08, 0.55, 0.20, 0.41, 0.38, 0.39, 0.50, 0.51, 0.50, 1.00]],
  i: [0.28, [0.14, 0.44, 0.14, 1.00], [0.14, 0.20, 0.15, 0.22]],
  j: [0.36, [0.26, 0.44, 0.26, 1.12, 0.20, 1.26, 0.06, 1.26], [0.26, 0.20, 0.27, 0.22]],
  k: [0.54, [0.08, 0.03, 0.08, 1.00], [0.46, 0.42, 0.10, 0.76], [0.22, 0.66, 0.48, 1.00]],
  l: [0.30, [0.14, 0.03, 0.14, 0.88, 0.24, 1.00]],
  m: [0.80, [0.06, 0.42, 0.06, 1.00], [0.06, 0.56, 0.16, 0.41, 0.30, 0.42, 0.34, 0.57, 0.34, 1.00], [0.34, 0.57, 0.44, 0.42, 0.58, 0.43, 0.62, 0.58, 0.62, 1.00]],
  n: [0.58, [0.08, 0.42, 0.08, 1.00], [0.08, 0.56, 0.20, 0.41, 0.38, 0.40, 0.50, 0.53, 0.50, 1.00]],
  o: [0.60, ring(0.30, 0.69, 0.24, 0.30)],
  p: [0.58, [0.08, 0.42, 0.08, 1.28], ring(0.32, 0.69, 0.24, 0.30)],
  q: [0.58, ring(0.28, 0.69, 0.24, 0.30), [0.52, 0.42, 0.52, 1.28]],
  r: [0.42, [0.10, 0.42, 0.10, 1.00], [0.10, 0.57, 0.22, 0.43, 0.40, 0.40]],
  s: [0.52, [0.48, 0.47, 0.32, 0.39, 0.14, 0.43, 0.10, 0.56, 0.26, 0.66, 0.44, 0.74, 0.48, 0.88, 0.32, 1.00, 0.12, 0.96]],
  t: [0.42, [0.22, 0.14, 0.22, 0.88, 0.34, 1.00], [0.06, 0.42, 0.42, 0.42]],
  u: [0.58, [0.08, 0.42, 0.08, 0.86, 0.20, 0.99, 0.38, 0.98, 0.50, 0.84], [0.50, 0.42, 0.50, 1.00]],
  v: [0.56, [0.05, 0.42, 0.29, 1.00, 0.53, 0.42]],
  w: [0.76, [0.04, 0.42, 0.19, 1.00, 0.34, 0.62, 0.49, 1.00, 0.64, 0.42]],
  x: [0.56, [0.06, 0.42, 0.50, 1.00], [0.50, 0.42, 0.06, 1.00]],
  y: [0.56, [0.05, 0.42, 0.29, 1.00], [0.53, 0.42, 0.20, 1.26, 0.06, 1.25]],
  z: [0.56, [0.06, 0.43, 0.50, 0.43, 0.06, 1.00, 0.52, 1.00]],

  ' ': [0.34],
  '.': [0.26, [0.11, 0.97, 0.12, 0.98]],
  ',': [0.26, [0.13, 0.93, 0.06, 1.14]],
  ':': [0.26, [0.11, 0.56, 0.12, 0.57], [0.11, 0.97, 0.12, 0.98]],
  '-': [0.48, [0.05, 0.70, 0.42, 0.70]],
  '+': [0.54, [0.05, 0.70, 0.47, 0.70], [0.26, 0.49, 0.26, 0.91]],
  '/': [0.46, [0.04, 1.00, 0.40, 0.03]],
  '(': [0.32, arc(0.34, 0.52, 0.26, 0.54, 128, 232)],
  ')': [0.32, arc(-0.02, 0.52, 0.26, 0.54, -52, 52)],
  "'": [0.22, [0.11, 0.08, 0.08, 0.30]],
  '?': [0.54, [0.06, 0.22, 0.16, 0.06, 0.36, 0.05, 0.48, 0.18, 0.44, 0.36, 0.26, 0.48, 0.26, 0.70], [0.26, 0.96, 0.27, 0.97]],
  '!': [0.24, [0.12, 0.05, 0.12, 0.68], [0.12, 0.96, 0.13, 0.97]],
  '*': [0.48, [0.24, 0.34, 0.24, 0.72], [0.07, 0.42, 0.41, 0.64], [0.41, 0.42, 0.07, 0.64]],
  '=': [0.54, [0.05, 0.58, 0.47, 0.58], [0.05, 0.82, 0.47, 0.82]],
};

const FALLBACK = GLYPHS['-'];
const glyphOf = (ch) => GLYPHS[ch] || (GLYPHS[ch.toLowerCase()] || FALLBACK);

// Advance width of a string, in the same units as the size passed to write.
export function measure(text, size, tracking = 0.09) {
  let w = 0;
  const s = String(text).toLowerCase();
  for (let i = 0; i < s.length; i++) w += glyphOf(s[i])[0] + tracking;
  return w * size;
}

// How far a written string reaches below the baseline, so a caller can lay out
// rows without clipping a descender.
export function descent(text, size) {
  let d = 0;
  const s = String(text).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const g = glyphOf(s[i]);
    for (let k = 1; k < g.length; k++) for (let j = 1; j < g[k].length; j += 2) if (g[k][j] > d) d = g[k][j];
  }
  return Math.max(0, d - 1) * size;
}

// Lay the strokes of one string into a context, with the baseline at y.
// Nothing here caches; drawTo is what the cache calls.
function drawTo(ctx, text, x, y, size, cfg, colour, widthMul) {
  const s = String(text).toLowerCase();
  const h = xmur3(s + '|' + size.toFixed(1));
  const seed = h();
  // The wander is a share of the letter height, which at a big size puts it
  // several pixels off and turns a figure into a blot: an eight became two
  // overlapping blobs at 44 pixels. A hand writing large is steadier relative
  // to the letter, so the wander is capped in real pixels as well.
  const jitter = Math.min(cfg.jitter * size, cfg.jitterMax === undefined ? Infinity : cfg.jitterMax);
  const passes = Math.max(1, cfg.passes | 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colour;
  let n = 0;
  for (let pass = 0; pass < passes; pass++) {
    ctx.globalAlpha = pass === 0 ? 1 : cfg.grain * (1 - pass / passes);
    ctx.lineWidth = Math.max(0.7, size * cfg.widthOfSize * widthMul * (pass === 0 ? 1 : 0.72));
    ctx.beginPath();
    let cx = x;
    n = 0;
    for (let i = 0; i < s.length; i++) {
      const g = glyphOf(s[i]);
      for (let k = 1; k < g.length; k++) {
        const pts = g[k];
        for (let j = 0; j < pts.length; j += 2) {
          n++;
          const wob = wobble(seed, n, pass, jitter);
          const px = cx + pts[j] * size + wob[0];
          const py = y - size + pts[j + 1] * size + wob[1];
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        // A single point is a dot: a zero-length segment with a round cap.
        if (pts.length === 2) ctx.lineTo(cx + pts[0] * size + 0.01, y - size + pts[1] * size);
      }
      cx += (g[0] + cfg.tracking) * size;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const wobbleOut = [0, 0];
function wobble(seed, n, pass, amount) {
  let h = Math.imul(seed ^ Math.imul(n, 374761393) ^ Math.imul(pass + 1, 668265263), 1274126177);
  h = (h ^ (h >>> 15)) >>> 0;
  wobbleOut[0] = ((h & 1023) / 1023 - 0.5) * 2 * amount;
  wobbleOut[1] = (((h >>> 10) & 1023) / 1023 - 0.5) * 2 * amount;
  return wobbleOut;
}

// ---------------------------------------------------------------------------
// The cache. A written string becomes a small canvas that is stamped wherever
// it is needed; the entry is also what a ghost is drawn from.
// ---------------------------------------------------------------------------

export function createHand(cfg, opts = {}) {
  const cache = new Map();
  const limit = opts.limit || 500;
  const make = opts.canvas || (typeof document !== 'undefined' ? () => document.createElement('canvas') : () => null);

  function entry(text, size, colour, widthMul) {
    const key = `${text}|${size}|${colour}|${widthMul}`;
    let e = cache.get(key);
    if (e) { cache.delete(key); cache.set(key, e); return e; }
    const pad = Math.ceil(size * 0.5) + 3;
    const w = Math.ceil(measure(text, size, cfg.tracking)) + pad * 2;
    const asc = Math.ceil(size) + pad;
    const desc = Math.ceil(descent(text, size)) + pad;
    const c = make();
    if (!c) return null;
    c.width = Math.max(1, w);
    c.height = Math.max(1, asc + desc);
    const g = c.getContext('2d');
    drawTo(g, text, pad, asc, size, cfg, colour, widthMul);
    e = { canvas: c, w: c.width, h: c.height, pad, asc, adv: measure(text, size, cfg.tracking) };
    cache.set(key, e);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return e;
  }

  // Stamp a string. x is the left edge unless align says otherwise, y is the
  // baseline. Returns the advance, so a caller can chain.
  function write(ctx, text, x, y, size, o = {}) {
    const colour = o.colour || '#ffffff';
    const widthMul = o.width || 1;
    const e = entry(String(text), Math.round(size * 2) / 2, colour, widthMul);
    if (!e) return 0;
    let left = x;
    if (o.align === 'centre') left = x - e.adv / 2;
    else if (o.align === 'right') left = x - e.adv;
    const a = o.alpha === undefined ? 1 : o.alpha;
    if (a <= 0.004) return e.adv;
    const was = ctx.globalAlpha;
    ctx.globalAlpha = was * a;
    ctx.drawImage(e.canvas, Math.round(left - e.pad), Math.round(y - e.asc));
    ctx.globalAlpha = was;
    return e.adv;
  }

  return { write, measure: (t, s) => measure(t, s, cfg.tracking), descent, entry, get size() { return cache.size; }, clear: () => cache.clear() };
}

export default createHand;
