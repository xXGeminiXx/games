// ---------------------------------------------------------------------------
// The one drawing: a cross-section of the hill.
//
// Sky, a low mound, then the strata as bands that darken with depth. The
// horde hollows each band out from the shaft as it works there, wall to wall
// once it has worked it long enough, and the dead are drawn as dots moving through what they
// have dug. Below the deepest open band is unbroken ground with the face bitten
// into it. Ten diggers are ten dots; a million is a mass. Nothing here is an
// asset, and nothing here is the game: the view reads the simulation and
// never writes it.
//
// The carve of each band is drawn once into an offscreen canvas and only
// redrawn when more of it has been revealed or the size changes, so the
// per-frame cost is the dots.
// ---------------------------------------------------------------------------

import { goodAt, valueAt, hardnessAt, capUnits } from './materials.js?v=54';
import { activeFrom } from './horde.js?v=54';
import * as Lore from './lore.js?v=54';
import * as Icons from './icons.js?v=54';

/** mulberry32 */
function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How much of a band is hollowed out after `worked` seconds of the whole
 * crew, when `seconds` of them hollow it wall to wall. Straight in time, so a
 * layer the crew leans on visibly fills at a steady pace, and a layer nobody
 * works stays as it was.
 */
export function carveFraction(worked, seconds) {
  if (!(worked > 0) || !(seconds > 0)) return 0;
  return Math.min(1, worked / seconds);
}

/**
 * Whether the point `u` across a band (0 to 1, the shaft at 0.5) is dug out
 * when the band is `frac` done. `stand` is a slow wave in 0..1 that decides
 * where rock is left standing. The hollow spreads out from the shaft with a
 * ragged edge and pillars left in it, and both go as the layer is worked: at
 * the end it is open wall to wall, so a layer that is done never looks like
 * it has something left in it to dig.
 */
export function hollowAt(u, frac, stand) {
  if (!(frac > 0)) return false;
  const reach = frac * 1.15;
  const rag = 0.24 * (1 - frac);
  const pillar = 0.84 + 0.2 * Math.pow(frac, 3);
  return Math.abs(u - 0.5) * 2 <= reach + (stand - 0.5) * rag && stand <= pillar;
}

/**
 * The tunnels of one band, in normalised coordinates: x across the band in
 * 0..1, y down the band in 0..1. A branching walk out from the shaft at
 * x = 0.5, seeded by the stratum so a save draws the same hill. Returned in
 * the order they are revealed.
 */
export function segmentsFor(k, seed, count) {
  const r = rng((seed >>> 0) ^ Math.imul(k + 1, 0x9E3779B1));
  const segs = [];
  // Open heads: places a tunnel can continue from.
  const heads = [{ x: 0.5, y: 0.08 + r() * 0.2, dir: 1 }, { x: 0.5, y: 0.3 + r() * 0.5, dir: -1 }];
  let guard = 0;
  while (segs.length < count && guard++ < count * 20) {
    const h = heads[Math.floor(r() * heads.length)];
    const len = 0.02 + r() * 0.07;
    const wobble = (r() - 0.5) * 0.18;
    const nx = Math.max(0.02, Math.min(0.98, h.x + h.dir * len));
    const ny = Math.max(0.06, Math.min(0.94, h.y + wobble));
    segs.push({ x0: h.x, y0: h.y, x1: nx, y1: ny });
    h.x = nx; h.y = ny;
    // Branch sometimes; drop a head that has run out of room.
    if (r() < 0.22) heads.push({ x: nx, y: ny, dir: r() < 0.5 ? 1 : -1 });
    if (nx <= 0.02 || nx >= 0.98) {
      h.dir = -h.dir;
      if (r() < 0.6) { h.x = 0.5; h.y = 0.1 + r() * 0.8; }
    }
    if (heads.length > 14) heads.splice(Math.floor(r() * heads.length), 1);
  }
  return segs;
}

/**
 * Where everything goes for a field of `width` x `height` css pixels and a
 * given depth.
 *
 * The picture follows the dig. Every layer above `focus.from` is worked out,
 * and giving each of them a full band put twenty-five bands of history on
 * the screen and the live dig in one strip at the bottom. They are pressed
 * into a thin stack at the top instead, and the room goes to the layers
 * being worked, the floor being broken, and `focus.ahead` layers below it
 * that the player has paid to see. Those last ones are `L.ahead`, drawn
 * under the face with their names.
 *
 * Without a focus every layer shares the frame equally, which is what a
 * shallow dig looks like anyway.
 */
export function layout(width, height, depth, cfg, focus) {
  const surface = cfg.surfaceHeight;
  const avail = Math.max(0, height - surface);
  const from = Math.max(0, Math.min(depth, (focus && focus.from) | 0));
  const aheadN = Math.max(0, (focus && focus.ahead) | 0);
  // The worked-out layers, stacked thin: a few pixels each, never more than
  // a share of the frame however deep the run goes.
  const oldTotal = from > 0
    ? Math.min(avail * (cfg.historyShare || 0.2), from * (cfg.historyBand || 3))
    : 0;
  const oldH = from > 0 ? oldTotal / from : 0;
  const live = (depth + 2 - from) + aheadN; // worked layers, the face, and what is read below it
  // Bands shrink to fit, and fitting wins: minBandHeight is two pixels, not a
  // readability floor. Held at twelve it pushed the deepest six layers and
  // the face off the bottom of a phone's two hundred pixel field, and the
  // face is the part worth looking at. What a thin band loses is its writing,
  // and that is what labelBandHeight decides.
  let bandH = Math.max(cfg.minBandHeight, Math.min(cfg.bandHeight, (avail - oldTotal) / live));
  // A lord's door being broken, or known below it, gets room enough to read
  // as a wall: up to doorHeight, never more than a share of the field, and
  // only while the other layers keep at least their floor.
  const tall = new Set(((focus && focus.tall) || []).filter(k => k > from && k <= depth + 1 + aheadN));
  let doorH = bandH;
  if (tall.size && cfg.doorHeight > bandH) {
    const want = Math.min(cfg.doorHeight, (avail - oldTotal) * 0.28);
    const rest = (avail - oldTotal - tall.size * want) / Math.max(1, live - tall.size);
    if (want > bandH && rest >= cfg.minBandHeight) {
      doorH = want;
      bandH = Math.max(cfg.minBandHeight, Math.min(cfg.bandHeight, rest));
    }
  }
  const hOf = (k) => (tall.has(k) ? Math.max(doorH, bandH) : bandH);
  const rows = [];
  let y = surface;
  for (let k = 0; k <= depth + 1; k++) {
    const h = k < from ? oldH : hOf(k);
    rows.push({ k, y, h });
    y += h;
  }
  const ahead = [];
  for (let i = 0; i < aheadN; i++) {
    const h = hOf(depth + 2 + i);
    ahead.push({ k: depth + 2 + i, y, h });
    y += h;
  }
  const bottom = y;
  // Whatever room is left under the cut is ground too, and drawing it as one
  // flat rectangle made a shallow dig look like a hole in an empty page. It
  // is bedded out in the same bands, unlit and unnamed, so the picture is
  // always a section through a hill rather than a diagram floating in a box.
  const ghosts = Math.max(0, Math.ceil((height - bottom) / bandH));
  return { width, height, surface, bandH, oldH, from, rows, ahead, bottom, ghosts };
}

/**
 * Which layers the picture gives room to: the deepest few being worked, and
 * every layer below the face whose ground is already known.
 */
export function focusOf(s, cfg) {
  const from = Math.max(0, s.depth - (cfg.focusLayers || 6) + 1);
  let ahead = 0;
  if (s.read) {
    for (let k = s.depth + 2; k <= s.depth + 1 + (cfg.aheadMax || 10); k++) {
      if (!s.read[k]) break;
      ahead++;
    }
  }
  return { from, ahead };
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return 'rgb(' + c.join(',') + ')';
}

function hex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function withAlpha(h, a) {
  // A colour from mix() arrives as rgb(r,g,b); anything else is #rrggbb.
  const m = typeof h === 'string' && h.startsWith('rgb(') ? h.slice(4, -1).split(',').map(Number) : null;
  const [r, g, b] = m || hex(h);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/**
 * What a layer is made of decides its texture, so two layers side by side
 * read as two different things rather than two shades of one: grain, fine
 * bedding lines, pebbles, crystals, veins or fractures. Picked from the
 * material's name, so the same material looks the same in every barrow.
 */
const TEXTURES = ['grain', 'laminae', 'pebbles', 'crystals', 'veins', 'fractured'];
export function textureOf(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return TEXTURES[h % TEXTURES.length];
}

/**
 * A smooth wave across a band: a value in 0..1 for any x in 0..1, drawn from
 * control points about `every` pixels apart and eased between them. Used for
 * the roof, the floor and the pillars of a hollowed layer, so each of those
 * varies over a span a person can see rather than jittering column to column.
 */
function wave(rand, width, every) {
  const n = Math.max(3, Math.min(48, Math.round(width / every)));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(rand());
  return (u) => {
    const x = Math.max(0, Math.min(1, u)) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    return pts[i] + (pts[i + 1] - pts[i]) * t;
  };
}

export function createView(canvas, cfg, palette, strataCfg, hordeCfg, doc, ground, lordsCfg) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  // The view is happy without a run's ground: it falls back to the plain
  // ladder, which is what the drawing looked like before seams existed.
  /** A lord's own colour, falling back to the page's for a lord without one. */
  const lordColor = (lord) => (lord && lord.def && lord.def.color) || palette.deepink;
  let hillTint = null;
  const layerAt = ground ? (k) => ground.at(k) : (k) => {
    const g = goodAt(k, strataCfg);
    return { name: g.name, hue: g.hue, seam: null, cap: capUnits(Math.max(0, k - 1), strataCfg) };
  };
  let width = 300, height = 200, dpr = 1;
  let ctx = canvas.getContext('2d');
  const segCache = new Map();   // k -> segments
  const carve = { canvas: null, ctx: null, revealed: [], key: '' };
  const particles = [];
  let seed = 1;
  let lastDepth = -1;
  // Embers rising through Mortifer's ground while the dig is in it.
  const embers = [];
  // A door that has just given way lights the layer it opened, and fades.
  let doorsSeen = -1;
  const flash = { k: -1, t: 0, hue: null };
  const FLASH_SECONDS = 1.8;
  // The lords whose trophies the player holds, as markers on the mound.
  let trophies = [];
  let trophyKey = '';
  // Loose bits: chips off the face, coin lifting out of worked ground, and
  // the rubble of a door coming down. Few, short-lived, and capped.
  const bits = [];
  const BITS_MAX = 240;
  let chipDue = 0, coinDue = 0, clock = 0;
  const spawn = (b) => { if (bits.length < BITS_MAX) bits.push(b); };

  /** The shaft widens with the crew: a hand's width at the start, a road at a trillion. */
  const shaftW = (s) => cfg.shaftWidth + Math.min(10, Math.log10(1 + Math.max(0, s.horde || 0)) * 0.4);

  /**
   * A band's texture, painted once into the cached ground. `a` is how strong:
   * full for a layer the dig has opened, fainter for ground only read ahead.
   */
  const texture = (c, row, g, a) => {
    if (!(row.h >= 5)) return;
    const r = rng((seed ^ Math.imul(row.k + 3, 0x2c1b3c6d)) >>> 0);
    const kind = textureOf(g.name);
    const light = mix(g.hue, palette.bone, 0.45);
    const dark = palette.void;
    const y0 = row.y + 1, h = row.h - 2;
    const area = width * h;
    if (kind === 'grain') {
      const n = Math.min(2400, Math.round(area / 85));
      for (let i = 0; i < n; i++) {
        c.fillStyle = withAlpha(r() < 0.5 ? light : dark, (0.10 + r() * 0.16) * a);
        c.fillRect(r() * width, y0 + r() * h, 1, 1);
      }
    } else if (kind === 'laminae') {
      const lines = Math.max(2, Math.floor(h / 5));
      for (let i = 1; i < lines; i++) {
        const base = y0 + (i / lines) * h;
        c.beginPath();
        c.moveTo(0, base);
        for (let x = 0; x <= width; x += 40) c.lineTo(x, base + (r() - 0.5) * 2.2);
        c.strokeStyle = withAlpha(i % 2 ? light : dark, (i % 2 ? 0.13 : 0.3) * a);
        c.lineWidth = 1;
        c.stroke();
      }
    } else if (kind === 'pebbles') {
      const n = Math.min(500, Math.round(area / 520));
      for (let i = 0; i < n; i++) {
        const x = r() * width, y = y0 + r() * Math.max(1, h - 3), w = 2 + r() * 3, hh = 1.5 + r() * 2;
        c.fillStyle = withAlpha(dark, 0.32 * a);
        c.fillRect(x, y + 1, w, hh);
        c.fillStyle = withAlpha(light, 0.22 * a);
        c.fillRect(x, y, w - 1, 1);
      }
    } else if (kind === 'crystals') {
      const n = Math.min(260, Math.round(area / 1300));
      for (let i = 0; i < n; i++) {
        const x = r() * width, y = y0 + 2 + r() * Math.max(1, h - 4), s0 = 1.5 + r() * 2;
        c.fillStyle = withAlpha(light, (0.35 + r() * 0.3) * a);
        c.beginPath();
        c.moveTo(x, y - s0); c.lineTo(x + s0 * 0.7, y); c.lineTo(x, y + s0); c.lineTo(x - s0 * 0.7, y); c.closePath();
        c.fill();
        c.fillStyle = withAlpha(palette.bone, 0.55 * a);
        c.fillRect(x - 0.5, y - 0.5, 1, 1);
      }
    } else if (kind === 'veins') {
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        let y = y0 + r() * h;
        const drift = (r() - 0.5) * h * 0.6;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x <= width; x += 16) {
          y = Math.max(y0, Math.min(y0 + h, y + (r() - 0.5) * 3 + drift / Math.max(1, width / 16)));
          c.lineTo(x, y);
        }
        c.strokeStyle = withAlpha(light, 0.3 * a);
        c.lineWidth = 1 + (i === 0 ? 0.6 : 0);
        c.stroke();
      }
    } else {
      const n = Math.min(160, Math.round(width / 28));
      for (let i = 0; i < n; i++) {
        let x = r() * width, y = y0 + r() * h;
        c.beginPath();
        c.moveTo(x, y);
        const steps = 2 + Math.floor(r() * 3);
        for (let j = 0; j < steps; j++) {
          x += (r() - 0.3) * 9; y = Math.max(y0, Math.min(y0 + h, y + (r() - 0.5) * 7));
          c.lineTo(x, y);
        }
        c.strokeStyle = withAlpha(dark, 0.45 * a);
        c.lineWidth = 1;
        c.stroke();
      }
    }
  };

  /** What a band's seam looks like on top of its texture. */
  const seamMark = (c, row, g, a) => {
    const id = g.seam && g.seam.id;
    if (!id || !(row.h >= 5)) return;
    const r = rng((seed ^ Math.imul(row.k + 11, 0x51ed270b)) >>> 0);
    const y0 = row.y + 1, h = row.h - 2;
    const light = mix(g.hue, palette.bone, 0.5);
    if (id === 'flooded') {
      const wl = y0 + h * 0.58;
      c.fillStyle = withAlpha('#0e1a24', 0.55 * a);
      c.fillRect(0, wl, width, y0 + h - wl);
      c.fillStyle = withAlpha('#7fa6c0', 0.3 * a);
      c.fillRect(0, wl, width, 1);
    } else if (id === 'burnt') {
      const n = Math.round(width / 70);
      for (let i = 0; i < n; i++) {
        const x = r() * width, w = 20 + r() * 50;
        c.fillStyle = withAlpha(palette.void, 0.3 * a);
        c.fillRect(x, y0 + h * (0.2 + r() * 0.5), w, h * 0.3);
      }
      for (let i = 0; i < n * 2; i++) {
        c.fillStyle = withAlpha(palette.hot, (0.35 + r() * 0.3) * a);
        c.fillRect(r() * width, y0 + r() * h, 1.5, 1.5);
      }
    } else if (id === 'salted') {
      const n = Math.round(width * h / 260);
      for (let i = 0; i < n; i++) {
        c.fillStyle = withAlpha('#eeeeea', (0.18 + r() * 0.22) * a);
        c.fillRect(r() * width, y0 + r() * h, 1, 1);
      }
    } else if (id === 'bonefield') {
      const n = Math.round(width / 55);
      for (let i = 0; i < n; i++) Icons.paint(c, 'bone', r() * width, y0 + r() * Math.max(1, h - 9), 1, palette.bone, 0.3 * a);
    } else if (id === 'hollow') {
      const n = Math.round(width / 45);
      for (let i = 0; i < n; i++) {
        const x = r() * width, y = y0 + 1 + r() * Math.max(1, h - 5), w = 3 + r() * 6;
        c.fillStyle = withAlpha(palette.tunnel, 0.75 * a);
        c.fillRect(x, y, w, 2 + r() * 2);
      }
    } else if (id === 'brittle') {
      const n = Math.round(width / 30);
      for (let i = 0; i < n; i++) {
        let x = r() * width, y = y0 + r() * h;
        c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 3; j++) { x += (r() - 0.5) * 10; y = Math.max(y0, Math.min(y0 + h, y + (r() - 0.5) * 8)); c.lineTo(x, y); }
        c.strokeStyle = withAlpha(light, 0.28 * a); c.lineWidth = 1; c.stroke();
      }
    } else if (id === 'dense') {
      const n = Math.min(2400, Math.round(width * h / 70));
      for (let i = 0; i < n; i++) {
        c.fillStyle = withAlpha(palette.void, (0.14 + r() * 0.18) * a);
        c.fillRect(r() * width, y0 + r() * h, 1.5, 1.5);
      }
    } else if (id === 'rich') {
      const n = Math.round(width / 22);
      for (let i = 0; i < n; i++) {
        c.fillStyle = withAlpha(light, (0.5 + r() * 0.4) * a);
        const s0 = 1 + r() * 1.5;
        c.fillRect(r() * width, y0 + r() * h, s0, s0);
      }
    } else if (id === 'sealed') {
      c.fillStyle = withAlpha(palette.void, 0.5 * a);
      c.fillRect(0, y0 + h - 3, width, 3);
      c.fillStyle = withAlpha(light, 0.18 * a);
      c.fillRect(0, y0 + h - 4, width, 1);
    } else if (id === 'thin') {
      c.fillStyle = withAlpha(light, 0.3 * a);
      c.fillRect(0, y0 + h * 0.5, width, 1);
    }
  };

  const segs = (k) => {
    let s = segCache.get(k);
    if (!s) { s = segmentsFor(k, seed, cfg.tunnelSegments); segCache.set(k, s); }
    return s;
  };

  const ensureCarve = () => {
    if (!carve.canvas && d && typeof d.createElement === 'function') {
      carve.canvas = d.createElement('canvas');
      carve.ctx = carve.canvas.getContext('2d');
    }
  };

  const resize = (w, h, ratio) => {
    width = Math.max(1, w | 0); height = Math.max(1, h | 0); dpr = ratio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ensureCarve();
    if (carve.canvas) { carve.canvas.width = canvas.width; carve.canvas.height = canvas.height; }
    carve.key = '';
  };

  /** Bands and the carve, drawn into the offscreen canvas when they change. */
  const drawGround = (L, s, worked) => {
    ensureCarve();
    const c = carve.ctx || ctx;
    const revealed = [];
    for (let k = 0; k <= s.depth; k++) {
      const frac = carveFraction(worked[k] || 0, cfg.clearSeconds);
      revealed.push(Math.round(frac * cfg.tunnelSegments));
    }
    const dug = Math.max(0, Math.log10(1 + (s.totals ? s.totals.dug || 0 : 0)));
    const key = [width, height, s.depth, L.from, L.ahead.length, Math.round(dug * 4), hillTint || '', Math.round(shaftW(s)), trophyKey, L.rows.length ? L.rows[L.rows.length - 1].h : 0, revealed.join(',')].join('|');
    if (key === carve.key) return;
    carve.key = key;
    carve.revealed = revealed;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    // Sky: darkest at the top, so the strip above the grass reads as air.
    const sky = c.createLinearGradient(0, 0, 0, L.surface);
    sky.addColorStop(0, palette.void);
    sky.addColorStop(1, palette.sky);
    c.fillStyle = sky;
    c.fillRect(0, 0, width, L.surface);
    // A few stars over the field, fixed by the seed and faint enough that it
    // stays night rather than turning into a sky anybody looks at.
    const sr = rng((seed ^ 0x5eed5eed) >>> 0);
    const stars = Math.round(width / 26);
    for (let i = 0; i < stars; i++) {
      const x = sr() * width, y = sr() * Math.max(4, L.surface - 16);
      c.fillStyle = withAlpha(palette.bone, 0.1 + sr() * 0.24);
      c.fillRect(x, y, 1, 1);
    }

    // The mound, and the spoil heap beside it, which grows with everything
    // that has come out of the hole. The mound is a hill, so it is drawn as
    // one: a few hundred pixels across whatever the window is, not a flat
    // three quarters of the width with a ten pixel rise in the middle.
    const half = Math.max(60, Math.min(220, width * 0.22));
    const crest = Math.min(L.surface - 5, 16 + dug * 1.5);
    // The hill this barrow is dug in colours the mound a little.
    c.fillStyle = hillTint ? mix(palette.mound, hillTint, 0.4) : palette.mound;
    c.beginPath();
    c.moveTo(width * 0.5 - half, L.surface);
    c.quadraticCurveTo(width * 0.5, L.surface - crest * 1.6, width * 0.5 + half, L.surface);
    c.closePath();
    c.fill();
    // A standing stone on the mound, off to one side of the shaft: whoever
    // raised the barrow marked it.
    {
      const sx0 = width * 0.5 - half * 0.42;
      const u = (sx0 - (width * 0.5 - half)) / (2 * half);
      const ground0 = L.surface - crest * 1.6 * 2 * u * (1 - u);
      const sh0 = Math.min(L.surface - 4, 9 + crest * 0.25);
      c.fillStyle = mix(palette.mound, palette.bone, 0.22);
      c.beginPath();
      c.moveTo(sx0 - 3.5, ground0 + 1);
      c.lineTo(sx0 - 2.5, ground0 - sh0 + 2);
      c.lineTo(sx0 + 0.5, ground0 - sh0);
      c.lineTo(sx0 + 3, ground0 - sh0 + 3);
      c.lineTo(sx0 + 3.5, ground0 + 1);
      c.closePath();
      c.fill();
    }
    // A marker on the mound for every lord whose trophy the player holds, in
    // his colour: the hill shows who it has beaten.
    for (let i = 0; i < trophies.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const step = Math.floor(i / 2) + 1;
      const mx = width * 0.5 + side * half * (0.12 + 0.13 * step);
      const u = (mx - (width * 0.5 - half)) / (2 * half);
      if (!(u > 0.04 && u < 0.96)) continue;
      const gy = L.surface - crest * 1.6 * 2 * u * (1 - u);
      const mh = Math.min(L.surface - 6, 7 + crest * 0.12);
      c.fillStyle = mix(palette.mound, palette.bone, 0.18);
      c.fillRect(mx - 1.5, gy - mh + 1, 3, mh);
      c.fillStyle = withAlpha(trophies[i], 0.9);
      c.fillRect(mx - 1.5, gy - mh, 3, 2);
    }
    const heap = Math.min(L.surface - 6, dug * 1.3);
    if (heap > 1) {
      c.fillStyle = withAlpha(palette.bone, 0.16);
      c.beginPath();
      c.moveTo(width * 0.5 + half * 0.9, L.surface);
      c.quadraticCurveTo(width * 0.5 + half * 1.35, L.surface - heap, width * 0.5 + half * 1.8, L.surface);
      c.closePath();
      c.fill();
    }
    // The grass line.
    c.fillStyle = withAlpha(palette.bone, 0.13);
    c.fillRect(0, L.surface - 1, width, 1);

    // Bands. Each one is the dark earth washed with the color of what is in
    // it, so the ladder from soil to whatever is down there reads off the
    // picture the way a cut bank reads off a road. Bedded darker at the
    // bottom of each band, which is what separates one from the next.
    for (const row of L.rows) {
      // Rock keeps its body all the way down. Darkening a band toward the
      // void with depth put the deep bands within a shade of the hollows cut
      // into them, and a layer you could not tell from its own tunnels was
      // the whole reason the deep of a run read as noise.
      const t = 1 - Math.exp(-row.k / 9);
      const open = row.k <= s.depth;
      const base = open ? mix(palette.earth, palette.deep, t * 0.55) : mix(palette.face, palette.deep, Math.min(1, t + 0.2));
      c.fillStyle = base;
      c.fillRect(0, row.y, width, row.h);
      const g = layerAt(row.k);
      // The layer's own colour, stronger than it was: side by side, two
      // layers should read as two materials at a glance. Every other layer
      // sits a shade darker, so the boundary is there even between two
      // layers of a like colour.
      c.fillStyle = withAlpha(g.hue, open ? 0.27 : 0.08);
      c.fillRect(0, row.y, width, row.h);
      if (row.k % 2 === 1) { c.fillStyle = withAlpha(palette.void, 0.12); c.fillRect(0, row.y, width, row.h); }
      if (row.h >= 6) {
        const bed = c.createLinearGradient(0, row.y, 0, row.y + row.h);
        bed.addColorStop(0, withAlpha(palette.bone, 0.045));
        bed.addColorStop(0.55, 'rgba(0,0,0,0)');
        bed.addColorStop(1, 'rgba(0,0,0,0.34)');
        c.fillStyle = bed;
        c.fillRect(0, row.y, width, row.h);
      }
      if (open || row.k === s.depth + 1) {
        texture(c, row, g, open ? 1 : 0.55);
        seamMark(c, row, g, open ? 1 : 0.55);
      }
      c.fillStyle = withAlpha(palette.tunnel, 0.55);
      c.fillRect(0, row.y, width, 1);
    }

    // Ground below the face that the player has paid to see: unbroken, but
    // washed faintly with what is in it, so the next few layers read as
    // somewhere the dig is going rather than as the dark.
    for (const row of L.ahead) {
      const t = 1 - Math.exp(-row.k / 9);
      c.fillStyle = mix(palette.face, palette.deep, Math.min(1, t + 0.3));
      c.fillRect(0, row.y, width, row.h);
      c.fillStyle = withAlpha(layerAt(row.k).hue, 0.11);
      c.fillRect(0, row.y, width, row.h);
      if (row.h >= 6) {
        const bed = c.createLinearGradient(0, row.y, 0, row.y + row.h);
        bed.addColorStop(0, withAlpha(palette.bone, 0.02));
        bed.addColorStop(0.6, 'rgba(0,0,0,0)');
        bed.addColorStop(1, 'rgba(0,0,0,0.26)');
        c.fillStyle = bed;
        c.fillRect(0, row.y, width, row.h);
      }
      // Known ground shows what it is made of, faintly.
      texture(c, row, layerAt(row.k), 0.4);
      seamMark(c, row, layerAt(row.k), 0.4);
      c.fillStyle = withAlpha(palette.tunnel, 0.5);
      c.fillRect(0, row.y, width, 1);
    }

    // Ground below the cut, bedded out in the same bands and going black, so
    // the picture always ends in rock rather than in an empty rectangle.
    for (let i = 0; i < L.ghosts; i++) {
      const y = L.bottom + i * L.bandH;
      const h = Math.min(L.bandH, height - y);
      if (h <= 0) break;
      c.fillStyle = mix(palette.deep, palette.void, Math.min(0.86, 0.12 + i * 0.11));
      c.fillRect(0, y, width, h);
      if (h >= 6) {
        const bed = c.createLinearGradient(0, y, 0, y + h);
        bed.addColorStop(0, withAlpha(palette.bone, 0.02));
        bed.addColorStop(0.6, 'rgba(0,0,0,0)');
        bed.addColorStop(1, 'rgba(0,0,0,0.22)');
        c.fillStyle = bed;
        c.fillRect(0, y, width, h);
      }
      c.fillStyle = withAlpha(palette.tunnel, 0.5);
      c.fillRect(0, y, width, 1);
    }

    // A lord's door: the floor under his ten, drawn as what it is - banded
    // stone with his mark in the middle - wherever it shows, whether the dig
    // is on it or it is only known from below.
    const doorBand = (row) => {
      const g = layerAt(row.k);
      if (!g.door || row.h < 3) return;
      const hue = lordColor(g.door.lord);
      const lordId = g.door.lord && g.door.lord.id;
      c.fillStyle = mix(palette.deep, palette.void, 0.35);
      c.fillRect(0, row.y, width, row.h);
      // Dressed stone: a wash of his colour, courses of blocks with the
      // joints staggered course to course, and each block lit along its top
      // and shadowed along its foot, so the wall has a face to it.
      c.fillStyle = withAlpha(hue, 0.16);
      c.fillRect(0, row.y, width, row.h);
      const courses = Math.max(1, Math.min(4, Math.floor(row.h / 9)));
      const ch = row.h / courses;
      const blockW = Math.max(18, Math.min(64, ch * 2.8));
      for (let i = 0; i < courses; i++) {
        const y0 = row.y + i * ch;
        const off = (i % 2) * blockW / 2;
        c.fillStyle = withAlpha(palette.void, 0.6);
        if (i > 0) c.fillRect(0, y0, width, 1);
        for (let x = off; x < width; x += blockW) c.fillRect(x, y0 + 1, 1, ch - 1);
        if (ch >= 6) {
          c.fillStyle = withAlpha(mix(hue, palette.bone, 0.5), 0.13);
          for (let x = off - blockW; x < width; x += blockW) c.fillRect(x + 2, y0 + 1, blockW - 3, 1);
          c.fillStyle = withAlpha(palette.void, 0.35);
          for (let x = off - blockW; x < width; x += blockW) c.fillRect(x + 2, y0 + ch - 2, blockW - 3, 1);
        }
      }
      // Skulls cut along the wall, where there is room for them.
      const cx = width * 0.5, cy = row.y + row.h / 2;
      if (row.h >= 22) {
        const sy = cy - 4.5;
        for (let x = 36; x < width - 12; x += 58) {
          if (Math.abs(x + 4.5 - cx) < 40) continue;
          if (x < 190) continue; // the name is written there
          Icons.paint(c, 'skull', x, sy, 1, mix(hue, palette.bone, 0.55), 0.3);
        }
      }
      // His mark, in a carved frame in the middle of the wall.
      const px = row.h >= 34 ? 3 : row.h >= 20 ? 2 : row.h >= 11 ? 1 : 0;
      if (px > 0 && lordId && Icons.ICONS[lordId]) {
        const size = Icons.GRID * px;
        const pad = Math.max(2, px + 1);
        c.fillStyle = mix(palette.deep, palette.void, 0.65);
        c.fillRect(cx - size / 2 - pad, cy - size / 2 - pad, size + pad * 2, size + pad * 2);
        c.strokeStyle = withAlpha(hue, 0.85);
        c.lineWidth = 1;
        c.strokeRect(cx - size / 2 - pad + 0.5, cy - size / 2 - pad + 0.5, size + pad * 2 - 1, size + pad * 2 - 1);
        Icons.paint(c, lordId, cx - size / 2, cy - size / 2, px, hue, 0.95);
      } else {
        const r = Math.max(2, Math.min(row.h * 0.4, 14));
        c.strokeStyle = withAlpha(hue, 0.9);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath();
        c.stroke();
      }
      // A lit edge along the top and bottom, so a door reads as a door even
      // when the band is only a few pixels tall.
      c.fillStyle = withAlpha(hue, 0.6);
      c.fillRect(0, row.y, width, row.h >= 20 ? 2 : 1);
      c.fillRect(0, row.y + row.h - (row.h >= 20 ? 2 : 1), width, row.h >= 20 ? 2 : 1);
    };
    doorBand(L.rows[s.depth + 1]);
    for (const row of L.ahead) doorBand(row);

    // Where each lord's ground begins: a line in his colour across the top of
    // his first layer, so the stack of worked-out layers reads as the lords it
    // went through rather than as one long smear.
    // Up in the stack of worked-out layers, every door the dig has broken is
    // a line of rubble in the colour of the lord it held back, so looking up
    // the hill shows the lords the barrow has been through.
    for (let k = 1; k <= s.depth; k++) {
      const row = L.rows[k];
      if (!row || !layerAt(k).door) continue;
      const lord = layerAt(k).lord;
      const hue = lordColor(layerAt(k).door ? layerAt(k).door.lord : lord);
      const r = rng((seed ^ Math.imul(k, 0x7feb352d)) >>> 0);
      for (let x = 0; x < width;) {
        const w = 4 + r() * 14;
        if (r() < 0.7) {
          c.fillStyle = withAlpha(hue, row.h >= 6 ? 0.5 : 0.4);
          c.fillRect(x, row.y, w, row.h >= 6 ? 2 : 1);
        }
        x += w + 1 + r() * 4;
      }
    }

    // Glints of each band's good, so a rich layer sparkles and the one under
    // the cut only hints.
    for (const row of L.rows) {
      if (row.k > s.depth + 1) continue;
      // Worked-out layers pressed into the stack are a few pixels tall, and
      // glints there turned the stack into static.
      if (row.h < 6) continue;
      const g = layerAt(row.k);
      const r = rng((seed ^ (row.k * 7919)) >>> 0);
      const open = row.k <= s.depth;
      const n = open ? cfg.glintCount : Math.ceil(cfg.glintCount / 3);
      for (let i = 0; i < n; i++) {
        const gx = r() * width, gy = row.y + 3 + r() * Math.max(1, row.h - 6);
        const gs = 1 + r() * 1.8;
        c.fillStyle = withAlpha(g.hue, (open ? 0.65 : 0.22) * (0.5 + r() * 0.5));
        c.fillRect(gx, gy, gs, gs);
      }
    }

    // The shaft, from the mound to the face, with its walls picked out.
    const faceRow = L.rows[s.depth + 1];
    const sw = shaftW(s);
    const sx = width * 0.5 - sw / 2;
    const sh = Math.max(0, faceRow.y - L.surface + 4 + crest * 0.4);
    c.fillStyle = palette.tunnel;
    c.fillRect(sx, L.surface - 4 - crest * 0.4, sw, sh);
    c.fillStyle = withAlpha(palette.bone, 0.12);
    c.fillRect(sx - 1, L.surface - 4 - crest * 0.4, 1, sh);
    c.fillRect(sx + sw, L.surface - 4 - crest * 0.4, 1, sh);
    // Timber props down a wide shaft, every few layers.
    if (sw >= 7) {
      c.fillStyle = withAlpha('#6b4f3a', 0.55);
      for (let k = L.from; k <= s.depth; k++) {
        const row = L.rows[k];
        if (!row || row.h < 10) continue;
        c.fillRect(sx - 1, row.y + 2, sw + 2, 1.5);
      }
    }

    // What the horde has taken out of each band: a hollow spreading from the
    // shaft, ragged at its edge, with pillars left standing in it. A band is
    // forty times wider than it is tall, so drawing each tunnel as a line
    // laid two hundred of them across a thirty pixel strip and the deep of a
    // long run came out looking like static. A hollow says the one thing the
    // line ever meant: how much of this layer is gone.
    for (let k = 0; k <= s.depth; k++) {
      const row = L.rows[k];
      const frac = Math.min(1, revealed[k] / cfg.tunnelSegments);
      if (!(frac > 0)) continue;
      const cols = Math.max(32, Math.min(320, Math.round(width / 5)));
      const r = rng((seed ^ Math.imul(k + 1, 0x85EBCA6B)) >>> 0);
      // Three slow waves across the band: where the roof sits, where the floor
      // sits, and where the rock was left standing. Rolling a fresh number per
      // column made a comb of even teeth that read as brickwork; a wave with a
      // control point every seventy pixels reads as a worked-out seam.
      const roof = wave(r, width, 70), floor = wave(r, width, 70), stand = wave(r, width, 90);
      const inset = Math.min(row.h * 0.34, Math.max(1, row.h * 0.20));
      const open = (u) => hollowAt(u, frac, stand(u));
      // Each run of open ground is one closed shape, drawn along its roof and
      // back along its floor. Filling it column by column left a staircase of
      // flat steps, which at thirty pixels a band is masonry, not a cavern.
      let i = 0;
      while (i < cols) {
        while (i < cols && !open((i + 0.5) / cols)) i++;
        if (i >= cols) break;
        const start = i;
        while (i < cols && open((i + 0.5) / cols)) i++;
        const end = i;
        if (end - start < 1) continue;
        const x = (j) => (j / (cols - 1)) * width;
        const top = (j) => row.y + 1 + roof((j + 0.5) / cols) * inset;
        const bot = (j) => row.y + row.h - 1 - floor((j + 0.5) / cols) * inset;
        c.beginPath();
        c.moveTo(x(start), top(start));
        for (let j = start + 1; j < end; j++) c.lineTo(x(j), top(j));
        for (let j = end - 1; j >= start; j--) c.lineTo(x(j), bot(j));
        c.closePath();
        c.fillStyle = withAlpha(palette.tunnel, 0.92);
        c.fill();
        // The cut floor catches what little light is down there.
        c.beginPath();
        c.moveTo(x(start), bot(start));
        for (let j = start + 1; j < end; j++) c.lineTo(x(j), bot(j));
        c.strokeStyle = withAlpha(palette.bone, 0.10);
        c.lineWidth = 1;
        c.stroke();
      }
    }
  };

  /**
   * How many dots this field has room for. The cap is a ceiling for a wide
   * window; on a phone the same two thousand dots in a strip a fifth the size
   * are one solid bar of bone and the ground behind them stops showing at
   * all, so the population follows the area.
   */
  const roomForDots = () => Math.max(120, Math.min(cfg.particleCap, Math.round(width * height / cfg.pixelsPerDot)));

  /** Keep the dot population in step with the horde and the weights. */
  const populate = (L, s, active, split) => {
    const want = Math.min(roomForDots(), Math.floor(s.horde));
    while (particles.length > want) particles.pop();
    const from = activeFrom(s.depth, hordeCfg, active);
    const pickBand = (r) => {
      let acc = 0;
      for (let k = from; k <= s.depth; k++) {
        acc += split.strata[k] || 0;
        if (r < acc) return k;
      }
      return -1; // the face
    };
    if (s.depth !== lastDepth) {
      // Reassign a share when the ground changes so the dots follow the horde.
      for (const p of particles) if (Math.random() < 0.5) p.band = null;
      lastDepth = s.depth;
    }
    while (particles.length < want) {
      particles.push({ band: null, seg: 0, u: Math.random(), v: 0.04 + Math.random() * 0.06, dir: Math.random() < 0.5 ? -1 : 1, shaft: Math.random() < 0.12, life: Math.random() * 6, oy: Math.random() - 0.5 });
    }
    for (const p of particles) {
      if (p.band === null || p.life <= 0) {
        p.band = pickBand(Math.random());
        p.life = 3 + Math.random() * 8;
        const list = p.band >= 0 ? segs(p.band) : null;
        const n = list ? Math.max(1, Math.min(list.length, carve.revealed[p.band] || 1)) : 1;
        p.seg = Math.floor(Math.random() * n);
        p.u = Math.random();
      }
    }
  };

  const drawDots = (L, s, dt) => {
    const faceRow = L.rows[s.depth + 1];
    const cap = layerAt(s.depth + 1).cap;
    const bite = Math.min(1, cap > 0 ? s.capProgress / cap : 0);
    const biteDepth = 4 + bite * (faceRow.h - 6);

    // The face bite: a notch widening as the cap is dug.
    ctx.fillStyle = palette.tunnel;
    ctx.beginPath();
    ctx.moveTo(width * 0.5 - 6 - bite * 10, faceRow.y);
    ctx.lineTo(width * 0.5 + 6 + bite * 10, faceRow.y);
    ctx.lineTo(width * 0.5 + 2 + bite * 4, faceRow.y + biteDepth);
    ctx.lineTo(width * 0.5 - 2 - bite * 4, faceRow.y + biteDepth);
    ctx.closePath();
    ctx.fill();

    const over = s.horde > particles.length;
    const size = cfg.particleSize * (over ? 1.25 : 1);
    const sw = shaftW(s);
    const boneInk = withAlpha(palette.bone, over ? 0.95 : 0.85);
    ctx.fillStyle = boneInk;
    // Where a band is tall enough, a digger is a figure - a head, a body and
    // a pick that swings - instead of a dot. Deep in a run, when the bands are
    // thin, they go back to dots and the mass is the picture.
    // Past a few hundred on screen, figures only pile into a white mass, and
    // dots say the same thing more clearly.
    const figures = particles.length <= 500;
    const figure = (x, y, p) => {
      const swing = Math.sin(clock * 9 + p.life * 3) > 0 ? 1 : 0;
      ctx.fillRect(x - 1, y - 5, 2, 2);
      ctx.fillRect(x - 0.5, y - 3, 1, 3.5);
      ctx.fillRect(x + (p.dir > 0 ? 1 : -2), y - 4 + swing, 1.5, 1);
    };
    for (const p of particles) {
      p.life -= dt;
      // A dot sent to a band the layout no longer has (the run was put back
      // to a shallower depth under it) is sent somewhere else next frame.
      if (p.band >= 0 && !L.rows[p.band]) { p.band = null; continue; }
      let x, y;
      if (p.shaft) {
        // Carriers: up and down the shaft between the mound and their band.
        p.u += p.v * dt * p.dir * 1.6;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        const row = p.band >= 0 ? L.rows[p.band] : faceRow;
        const yEnd = row.y + row.h * 0.5;
        x = width * 0.5 + (Math.sin(p.u * 9 + p.life) * Math.max(1.2, sw * 0.32));
        y = L.surface - 2 + (yEnd - L.surface + 2) * p.u;
      } else if (p.band >= 0) {
        const row = L.rows[p.band];
        const list = segs(p.band);
        const sg = list[Math.min(p.seg, list.length - 1)];
        p.u += p.v * dt * p.dir * 4;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        x = (sg.x0 + (sg.x1 - sg.x0) * p.u) * width;
        // Spread through the height of the band, so a crew packed into a few
        // tunnels reads as a crowd rather than one white line.
        y = row.y + Math.max(0.12, Math.min(0.9, (sg.y0 + (sg.y1 - sg.y0) * p.u) + (p.oy || 0) * 0.5)) * row.h;
      } else {
        // At the face: crowded into the bite.
        p.u += p.v * dt * p.dir * 3;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        x = width * 0.5 + (p.u - 0.5) * (12 + bite * 20);
        y = faceRow.y + 1 + Math.abs(Math.sin(p.u * 6.28 + p.life)) * (biteDepth - 2);
      }
      const hereH = p.shaft ? 0 : (p.band >= 0 ? L.rows[p.band].h : faceRow.h);
      if (hereH >= 16 && figures) figure(x, y + 2, p);
      else ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  };

  /**
   * The door the dig is breaking, cracking as it goes: a crack for every
   * fourteenth of the way through, running out from his mark. And the layer
   * a door has just opened onto, lit in the lord's colour for a moment.
   */
  const drawDoorWork = (L, s, dt) => {
    const face = L.rows[s.depth + 1];
    const target = layerAt(s.depth + 1);
    if (target.door && face && face.h >= 3) {
      const pct = target.cap > 0 ? Math.max(0, Math.min(1, s.capProgress / target.cap)) : 0;
      const n = Math.ceil(pct * 14);
      const hue = lordColor(target.door.lord);
      const lit = mix(hue, palette.bone, 0.55);
      const cx = width * 0.5, cy = face.y + face.h / 2;
      // Blocks knocked out of the wall as the dig gets through it, near the
      // shaft first, dark holes with his colour at their rim.
      const holes = Math.floor(pct * 12);
      for (let i = 0; i < holes; i++) {
        const r = rng((seed ^ Math.imul(s.depth + 1, 0x3c6ef372) ^ Math.imul(i + 1, 0x1b873593)) >>> 0);
        const hx = cx + (r() - 0.5) * width * (0.12 + 0.5 * pct);
        const hw = 6 + r() * 12, hh = Math.max(2, face.h * (0.2 + r() * 0.3));
        const hy = face.y + 2 + r() * Math.max(1, face.h - hh - 4);
        ctx.fillStyle = withAlpha(palette.tunnel, 0.9);
        ctx.fillRect(hx, hy, hw, hh);
        ctx.fillStyle = withAlpha(hue, 0.45);
        ctx.fillRect(hx, hy + hh - 1, hw, 1);
      }
      // The cracks: a dark cut with his light showing through it, stronger
      // the further through the wall the dig is.
      for (let i = 0; i < n; i++) {
        const r = rng((seed ^ Math.imul(s.depth + 1, 0x27d4eb2d) ^ Math.imul(i + 1, 0x165667b1)) >>> 0);
        const dir = i % 2 === 0 ? 1 : -1;
        const reach = width * (0.08 + 0.4 * pct) * (0.5 + r() * 0.5);
        let x = cx + dir * 8, y = cy + (r() - 0.5) * face.h * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const steps = 4 + Math.floor(r() * 4);
        for (let j = 0; j < steps; j++) {
          x += dir * reach / steps;
          y = Math.max(face.y + 1, Math.min(face.y + face.h - 1, y + (r() - 0.5) * face.h * 0.6));
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = withAlpha(palette.void, 0.85);
        ctx.lineWidth = face.h >= 20 ? 3 : 2;
        ctx.stroke();
        ctx.strokeStyle = withAlpha(lit, 0.3 + 0.6 * pct);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // A door broken since the last frame lights the layer it opened.
    const broken = s.doors ? Object.keys(s.doors).length : 0;
    if (doorsSeen >= 0 && broken > doorsSeen) {
      let k = -1;
      for (const key of Object.keys(s.doors)) k = Math.max(k, Number(key));
      if (k >= 0 && k <= s.depth + 1) {
        flash.k = k; flash.t = FLASH_SECONDS;
        flash.hue = lordColor(layerAt(k).door ? layerAt(k).door.lord : null);
        // The wall comes down: chunks of it fall away down the hole.
        const row = L.rows[k];
        if (row) {
          for (let i = 0; i < 70; i++) {
            spawn({
              x: Math.random() * width, y: row.y + Math.random() * Math.max(2, row.h * 0.5),
              vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 40, g: 160,
              life: 0.8 + Math.random() * 0.9, fade: 0.6, s: 2 + Math.random() * 2.5,
              color: Math.random() < 0.5 ? flash.hue : mix(palette.deep, palette.bone, 0.25),
            });
          }
        }
      }
    }
    doorsSeen = broken;
    if (flash.t > 0 && L.rows[flash.k]) {
      const row = L.rows[flash.k];
      const a = flash.t / FLASH_SECONDS;
      ctx.fillStyle = withAlpha(flash.hue, 0.28 * a);
      ctx.fillRect(0, row.y, width, row.h);
      ctx.fillStyle = withAlpha(flash.hue, 0.9 * a);
      ctx.fillRect(0, row.y, width, 2);
      flash.t -= dt;
    }
  };

  /**
   * Loose bits, each frame. Chips fly off the face in proportion to how many
   * are digging down (by the order of the number, so a trillion is a steady
   * spray and ten is a pick now and then). Coin lifts off the layers being
   * worked while the barrow is earning. Door rubble is spawned where the door
   * gives way.
   */
  const drawBits = (L, s, dt, split) => {
    clock += dt;
    const faceRow = L.rows[s.depth + 1];
    const target = layerAt(s.depth + 1);
    const onFace = (s.horde || 0) * (split.face || 0);
    if (faceRow && onFace >= 1 && !target.beyond) {
      chipDue += dt * Math.min(28, 2 + 2.2 * Math.log10(1 + onFace));
      const cap = target.cap;
      const bite = Math.min(1, cap > 0 ? s.capProgress / cap : 0);
      const chip = mix(target.hue || palette.bone, palette.bone, 0.35);
      while (chipDue >= 1) {
        chipDue -= 1;
        spawn({
          x: width * 0.5 + (Math.random() - 0.5) * (12 + bite * 20), y: faceRow.y + 2 + Math.random() * Math.max(2, faceRow.h * 0.3),
          vx: (Math.random() - 0.5) * 50, vy: -(15 + Math.random() * 45), g: 150,
          life: 0.45 + Math.random() * 0.5, fade: 0.35, s: 1.5, color: chip,
        });
      }
    }
    const rate = s.rate || 0;
    if (rate > 0) {
      coinDue += dt * Math.min(10, 0.6 + 0.2 * Math.log10(1 + rate));
      const from = Math.max(L.from, 0);
      while (coinDue >= 1) {
        coinDue -= 1;
        // A layer, picked by how much of the crew is on it.
        let pick = -1, acc = 0;
        const r0 = Math.random();
        for (let k = from; k <= s.depth; k++) { acc += split.strata[k] || 0; if (r0 < acc) { pick = k; break; } }
        const row = pick >= 0 ? L.rows[pick] : null;
        if (!row || row.h < 6) continue;
        spawn({
          x: width * (0.2 + Math.random() * 0.6), y: row.y + row.h * (0.3 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 6, vy: -(8 + Math.random() * 10), g: 0,
          life: 1 + Math.random() * 0.8, fade: 0.8, s: 1.6, color: palette.coin,
        });
      }
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt;
      if (!(b.life > 0) || b.y > height + 4) { bits.splice(i, 1); continue; }
      b.vy += (b.g || 0) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      ctx.fillStyle = withAlpha(b.color, Math.min(1, b.life / (b.fade || 0.5)));
      ctx.fillRect(b.x, b.y, b.s, b.s);
    }
  };

  /**
   * While a lord waits to be answered, his hall is drawn where his door gave
   * way: an arched room at the foot of the shaft, lit in his colour, pillars
   * either side, candles along the floor and the lord on his seat. It goes
   * when he has been answered.
   */
  let hallClock = 0;
  const drawHall = (L, s) => {
    const c0 = s.chamber;
    if (!c0 || c0.kind !== 'lord') return;
    const row = L.rows[c0.k];
    if (!row || row.h < 8) return;
    const def = layerAt(c0.k).door ? layerAt(c0.k).door.lord : null;
    const hue = lordColor(def) || palette.deepink;
    const big = c0.lord === 'mortifer';
    hallClock += 0.016;
    const cx = width * 0.5;
    const hw = Math.min(big ? 240 : 170, width * (big ? 0.34 : 0.26)) / 2;
    const top = row.y + row.h * 0.1, floor = row.y + row.h * 0.94;
    const h = floor - top;
    // The room: an arch cut into the rock.
    ctx.fillStyle = withAlpha(palette.void, 0.92);
    ctx.beginPath();
    ctx.moveTo(cx - hw, floor);
    ctx.lineTo(cx - hw, top + h * 0.35);
    ctx.quadraticCurveTo(cx, top - h * 0.25, cx + hw, top + h * 0.35);
    ctx.lineTo(cx + hw, floor);
    ctx.closePath();
    ctx.fill();
    const glow = ctx.createRadialGradient(cx, floor - h * 0.3, 2, cx, floor - h * 0.3, hw);
    glow.addColorStop(0, withAlpha(hue, 0.32));
    glow.addColorStop(1, withAlpha(hue, 0));
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.strokeStyle = withAlpha(hue, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Pillars either side.
    ctx.fillStyle = withAlpha(hue, 0.35);
    for (const px of [cx - hw * 0.72, cx + hw * 0.72]) ctx.fillRect(px - 2, top + h * 0.3, 4, floor - top - h * 0.3);
    // His seat, and him on it.
    const sw = Math.max(8, Math.min(22, h * 0.5));
    ctx.fillStyle = withAlpha(hue, 0.55);
    ctx.fillRect(cx - sw / 2, floor - h * 0.62, sw, h * 0.62);
    ctx.fillStyle = withAlpha(palette.void, 0.9);
    ctx.fillRect(cx - sw / 2 + 2, floor - h * 0.3, sw - 4, 3);
    ctx.fillStyle = withAlpha(palette.bone, 0.9);
    const head = Math.max(1.5, sw * 0.14);
    ctx.beginPath();
    ctx.arc(cx, floor - h * 0.5, head, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - head * 0.9, floor - h * 0.5 + head, head * 1.8, h * 0.22);
    // Candles along the floor, flickering.
    const n = big ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const x = cx - hw * 0.9 + (i / (n - 1)) * hw * 1.8;
      if (Math.abs(x - cx) < sw) continue;
      const f = 0.55 + 0.45 * Math.sin(hallClock * 9 + i * 1.7);
      ctx.fillStyle = withAlpha(palette.bone, 0.5);
      ctx.fillRect(x - 0.5, floor - 4, 1, 3);
      ctx.fillStyle = withAlpha(hue, 0.5 + 0.5 * f);
      ctx.fillRect(x - 1, floor - 6, 2, 2);
    }
  };

  /**
   * Mortifer's layers are warm. While the dig is in them, sparks drift up
   * out of the worked ground and fade; anywhere else there are none.
   */
  const drawEmbers = (L, s, dt) => {
    const here = layerAt(s.depth).lord;
    const hot = here && here.id === 'mortifer';
    if (!hot) { embers.length = 0; return; }
    const hue = lordColor(here);
    const top = L.rows[Math.max(L.from, s.depth - 5)] || L.rows[0];
    const face = L.rows[s.depth + 1];
    const y0 = top.y, y1 = face.y + face.h;
    const want = Math.round(Math.min(90, width / 14));
    while (embers.length < want) {
      embers.push({ x: Math.random() * width, y: y0 + Math.random() * (y1 - y0), v: 6 + Math.random() * 14, life: 1 + Math.random() * 3 });
    }
    for (const e of embers) {
      e.y -= e.v * dt;
      e.x += Math.sin(e.y * 0.05 + e.life) * 0.3;
      e.life -= dt;
      if (e.life <= 0 || e.y < y0) {
        e.x = Math.random() * width; e.y = y1 - Math.random() * (y1 - y0) * 0.3; e.life = 1 + Math.random() * 3;
      }
      ctx.fillStyle = withAlpha(hue, Math.max(0, Math.min(0.85, e.life / 2)));
      ctx.fillRect(e.x, e.y, 1.5, 1.5);
    }
  };

  /**
   * Draw one frame. `worked` is seconds of the whole crew spent on each
   * layer (state.worked); `md` is the
   * run's multipliers, read only for what the player can see ahead.
   */
  const draw = (s, worked, dt, active, split, md, legacy) => {
    if (!split) split = { strata: [], face: 0 };
    seed = s.seed;
    hillTint = (md && md.hillTint) || null;
    // The lords whose trophies are held, in their colours, for the mound.
    if (legacy && legacy.trophies) {
      const key = Object.keys(legacy.trophies).filter(id => legacy.trophies[id]).sort().join(',');
      if (key !== trophyKey) {
        trophyKey = key;
        trophies = key ? key.split(',').map(id => (lordsCfg && lordsCfg.list && lordsCfg.list[id] && lordsCfg.list[id].color) || palette.deepink) : [];
      }
    }
    const focus = focusOf(s, cfg);
    // A door on screen below the dig - the one being broken or one read ahead -
    // gets a taller band.
    focus.tall = [];
    for (let k = s.depth + 1; k <= s.depth + 1 + focus.ahead; k++) if (layerAt(k).door) focus.tall.push(k);
    const L = layout(width, height, s.depth, cfg, focus);
    drawGround(L, s, worked);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (carve.canvas && carve.canvas !== canvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(carve.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    populate(L, s, active, split);
    drawDots(L, s, Math.min(0.1, dt || 0.016));
    drawDoorWork(L, s, Math.min(0.1, dt || 0.016));
    drawBits(L, s, Math.min(0.1, dt || 0.016), split);
    drawEmbers(L, s, Math.min(0.1, dt || 0.016));
    drawHall(L, s);

    // Band names on the left, and on the right a bar for the share of the
    // horde standing in that band, so the panel and the picture say the same
    // thing and a layer nobody is working looks empty from here too. Deep in
    // a run the bands are a few pixels tall and a label on every one is
    // noise, so the writing stops and the bars carry on.
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.font = '11px ' + MONO;
    ctx.textBaseline = 'middle';
    const barMax = Math.min(70, width * 0.09);
    for (const row of L.rows) {
      if (row.k > s.depth) break;
      const layer = layerAt(row.k);
      const mid = row.y + row.h / 2;
      if (row.h >= cfg.labelBandHeight) {
        ctx.fillStyle = withAlpha(palette.ink, 0.82);
        ctx.fillText(Lore.label(layer.name), 8, mid);
        // The seam, quieter, so a layer's character reads off the hill as
        // well as off the panel.
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        if (words && row.h >= cfg.seamBandHeight) {
          const w = ctx.measureText(Lore.label(layer.name)).width;
          ctx.fillStyle = withAlpha(mix(layer.hue, palette.bone, 0.3), 0.9);
          ctx.fillText(words.tag, 14 + w, mid);
        }
      }
      const share = split.strata[row.k] || 0;
      if (share > 0.001 && row.h >= 4) {
        const w = Math.max(2, barMax * share / 0.5);
        const h = Math.max(2, Math.min(4, row.h * 0.22));
        ctx.fillStyle = withAlpha(layer.hue, 0.55);
        ctx.fillRect(width - 10 - Math.min(w, barMax), mid - h / 2, Math.min(w, barMax), h);
      }
    }

    // Whose ground each stretch was, down the right-hand edge, wherever the
    // stretch is tall enough to carry a name. The worked-out stack at the top
    // becomes a list of the lords the dig went through.
    ctx.textAlign = 'right';
    for (let k0 = 0; k0 <= s.depth; k0 += 10) {
      const first = L.rows[k0];
      const lastK = Math.min(k0 + 9, s.depth);
      const last = L.rows[lastK];
      if (!first || !last) continue;
      const tall = last.y + last.h - first.y;
      if (tall < 12) continue;
      const lord = layerAt(k0).lord;
      const words = lord ? Lore.lord(lord.id) : null;
      if (!words) continue;
      ctx.fillStyle = withAlpha(lordColor(lord), 0.55);
      ctx.fillText(words.name, width - 12 - barMax, first.y + Math.min(tall / 2, 9));
    }
    ctx.textAlign = 'left';

    // Ground below the cut that has been read ahead of the dead reaching it:
    // named, faintly, where it lies. This is what a player gets for buying
    // the reading, and it is the only place in the game that shows the shape
    // of a barrow before it is dug. The floor being broken is named too once
    // anything has read it.
    const known = [];
    const face = L.rows[s.depth + 1];
    if ((md && md.assay) || (s.read && s.read[s.depth + 1])) known.push(face);
    for (const row of L.ahead) known.push(row);
    // A door is always named, read or not: it is the thing the dig is for.
    const doors = [face].concat(L.ahead).filter(row => layerAt(row.k).door);
    for (const row of doors) {
      if (row.h < cfg.labelBandHeight - 6) continue;
      const mid = row.y + row.h / 2;
      if (mid > height - 4) continue;
      const door = layerAt(row.k).door;
      const words = door && door.lord ? Lore.lord(door.lord.id) : null;
      if (!words) continue;
      const text = words.name + (Lore.doors().doorTag || '');
      // Cut into the wall: capitals, spaced where there is room, on a dark
      // plate that stops short of his mark in the middle.
      ctx.font = '600 11px ' + MONO;
      const room = width * 0.5 - 34;
      let cap = text.toUpperCase().split('').join(' ');
      if (ctx.measureText(cap).width + 12 > room) cap = text.toUpperCase();
      const fits = ctx.measureText(cap).width + 12 <= room;
      ctx.font = '11px ' + MONO;
      if (row.h >= 22 && fits) {
        ctx.font = '600 11px ' + MONO;
        const w = ctx.measureText(cap).width;
        ctx.fillStyle = withAlpha(palette.void, 0.72);
        ctx.fillRect(4, mid - 9, w + 12, 18);
        ctx.fillStyle = withAlpha(lordColor(door.lord), 1);
        ctx.fillText(cap, 10, mid + 0.5);
        ctx.font = '11px ' + MONO;
      } else {
        ctx.fillStyle = withAlpha(lordColor(door.lord), 0.95);
        ctx.fillText(text, 8, mid);
      }
    }
    for (const row of known) {
      if (row.h < cfg.labelBandHeight) continue;
      if (layerAt(row.k).door) continue;
      const mid = row.y + row.h / 2;
      if (mid > height - 4) break;
      const layer = layerAt(row.k);
      ctx.fillStyle = withAlpha(palette.ink, 0.4);
      ctx.fillText(Lore.label(layer.name), 8, mid);
      const words = layer.seam ? Lore.seam(layer.seam.id) : null;
      if (words && row.h >= cfg.seamBandHeight) {
        const w = ctx.measureText(Lore.label(layer.name)).width;
        ctx.fillStyle = withAlpha(layer.hue, 0.5);
        ctx.fillText(words.tag, 14 + w, mid);
      }
    }
    return L;
  };

  return { resize, draw, layout: () => layout(width, height, 0, cfg), particles, get size() { return { width, height, dpr }; } };
}
