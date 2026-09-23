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

import { goodAt, valueAt, hardnessAt, absorbAt, capUnits } from './materials.js?v=42';
import { activeFrom } from './horde.js?v=42';
import * as Lore from './lore.js?v=42';

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
  const bandH = Math.max(cfg.minBandHeight, Math.min(cfg.bandHeight, (avail - oldTotal) / live));
  const rows = [];
  let y = surface;
  for (let k = 0; k <= depth + 1; k++) {
    const h = k < from ? oldH : bandH;
    rows.push({ k, y, h });
    y += h;
  }
  const ahead = [];
  for (let i = 0; i < aheadN; i++) {
    ahead.push({ k: depth + 2 + i, y, h: bandH });
    y += bandH;
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
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
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

export function createView(canvas, cfg, palette, strataCfg, hordeCfg, doc, ground) {
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
    const key = [width, height, s.depth, L.from, L.ahead.length, Math.round(dug * 4), hillTint || '', revealed.join(',')].join('|');
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
      c.fillStyle = withAlpha(g.hue, open ? 0.19 : 0.07);
      c.fillRect(0, row.y, width, row.h);
      if (row.h >= 6) {
        const bed = c.createLinearGradient(0, row.y, 0, row.y + row.h);
        bed.addColorStop(0, withAlpha(palette.bone, 0.035));
        bed.addColorStop(0.55, 'rgba(0,0,0,0)');
        bed.addColorStop(1, 'rgba(0,0,0,0.30)');
        c.fillStyle = bed;
        c.fillRect(0, row.y, width, row.h);
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
      c.fillStyle = withAlpha(layerAt(row.k).hue, 0.09);
      c.fillRect(0, row.y, width, row.h);
      if (row.h >= 6) {
        const bed = c.createLinearGradient(0, row.y, 0, row.y + row.h);
        bed.addColorStop(0, withAlpha(palette.bone, 0.02));
        bed.addColorStop(0.6, 'rgba(0,0,0,0)');
        bed.addColorStop(1, 'rgba(0,0,0,0.26)');
        c.fillStyle = bed;
        c.fillRect(0, row.y, width, row.h);
      }
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
      c.fillStyle = mix(palette.deep, palette.void, 0.35);
      c.fillRect(0, row.y, width, row.h);
      // Dressed stone: a wash of his colour, courses of blocks, and the
      // joints between them staggered course to course.
      c.fillStyle = withAlpha(hue, 0.13);
      c.fillRect(0, row.y, width, row.h);
      const courses = Math.max(1, Math.min(4, Math.floor(row.h / 8)));
      const ch = row.h / courses;
      const blockW = Math.max(18, Math.min(60, ch * 2.6));
      c.fillStyle = withAlpha(palette.void, 0.55);
      for (let i = 0; i < courses; i++) {
        const y0 = row.y + i * ch;
        if (i > 0) c.fillRect(0, y0, width, 1);
        const off = (i % 2) * blockW / 2;
        for (let x = off; x < width; x += blockW) c.fillRect(x, y0 + 1, 1, ch - 1);
      }
      // His mark, big enough to read on the stone.
      const r = Math.max(3, Math.min(row.h * 0.4, 14));
      const cx = width * 0.5, cy = row.y + row.h / 2;
      c.fillStyle = mix(palette.deep, palette.void, 0.5);
      c.beginPath();
      c.moveTo(cx, cy - r - 2); c.lineTo(cx + r + 2, cy); c.lineTo(cx, cy + r + 2); c.lineTo(cx - r - 2, cy); c.closePath();
      c.fill();
      c.strokeStyle = withAlpha(hue, 0.9);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath();
      c.stroke();
      c.fillStyle = withAlpha(hue, 0.95);
      c.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      // A lit edge along the top and bottom, so a door reads as a door even
      // when the band is only a few pixels tall.
      c.fillStyle = withAlpha(hue, 0.5);
      c.fillRect(0, row.y, width, 1);
      c.fillRect(0, row.y + row.h - 1, width, 1);
    };
    doorBand(L.rows[s.depth + 1]);
    for (const row of L.ahead) doorBand(row);

    // Where each lord's ground begins: a line in his colour across the top of
    // his first layer, so the stack of worked-out layers reads as the lords it
    // went through rather than as one long smear.
    for (let k = 1; k <= s.depth; k++) {
      const row = L.rows[k];
      if (!row || !layerAt(k).door) continue;
      const lord = layerAt(k).lord;
      c.fillStyle = withAlpha(lordColor(lord), row.h >= 6 ? 0.55 : 0.8);
      c.fillRect(0, row.y, width, 1);
    }

    // Glints of each band's good, so a rich layer sparkles and the one under
    // the cut only hints.
    for (const row of L.rows) {
      if (row.k > s.depth + 1) continue;
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
    const sx = width * 0.5 - cfg.shaftWidth / 2;
    const sh = Math.max(0, faceRow.y - L.surface + 4 + crest * 0.4);
    c.fillStyle = palette.tunnel;
    c.fillRect(sx, L.surface - 4 - crest * 0.4, cfg.shaftWidth, sh);
    c.fillStyle = withAlpha(palette.bone, 0.10);
    c.fillRect(sx - 1, L.surface - 4 - crest * 0.4, 1, sh);
    c.fillRect(sx + cfg.shaftWidth, L.surface - 4 - crest * 0.4, 1, sh);

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
      particles.push({ band: null, seg: 0, u: Math.random(), v: 0.04 + Math.random() * 0.06, dir: Math.random() < 0.5 ? -1 : 1, shaft: Math.random() < 0.12, life: Math.random() * 6 });
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
    ctx.fillStyle = withAlpha(palette.bone, over ? 0.95 : 0.85);
    for (const p of particles) {
      p.life -= dt;
      let x, y;
      if (p.shaft) {
        // Carriers: up and down the shaft between the mound and their band.
        p.u += p.v * dt * p.dir * 1.6;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        const row = p.band >= 0 ? L.rows[p.band] : faceRow;
        const yEnd = row.y + row.h * 0.5;
        x = width * 0.5 + (Math.sin(p.u * 9) * 1.2);
        y = L.surface - 2 + (yEnd - L.surface + 2) * p.u;
      } else if (p.band >= 0) {
        const row = L.rows[p.band];
        const list = segs(p.band);
        const sg = list[Math.min(p.seg, list.length - 1)];
        p.u += p.v * dt * p.dir * 4;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        x = (sg.x0 + (sg.x1 - sg.x0) * p.u) * width;
        y = row.y + (sg.y0 + (sg.y1 - sg.y0) * p.u) * row.h;
      } else {
        // At the face: crowded into the bite.
        p.u += p.v * dt * p.dir * 3;
        if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; }
        x = width * 0.5 + (p.u - 0.5) * (12 + bite * 20);
        y = faceRow.y + 1 + Math.abs(Math.sin(p.u * 6.28 + p.life)) * (biteDepth - 2);
      }
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
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
      const cx = width * 0.5, cy = face.y + face.h / 2;
      ctx.lineWidth = 1;
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
        ctx.strokeStyle = withAlpha(hue, 0.35 + 0.4 * pct);
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
  const draw = (s, worked, dt, active, split, md) => {
    if (!split) split = { strata: [], face: 0 };
    seed = s.seed;
    hillTint = (md && md.hillTint) || null;
    const L = layout(width, height, s.depth, cfg, focusOf(s, cfg));
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
    drawEmbers(L, s, Math.min(0.1, dt || 0.016));
    drawHall(L, s);

    // Band names on the left, and on the right a bar for the share of the
    // horde standing in that band, so the panel and the picture say the same
    // thing and a layer nobody is working looks empty from here too. Deep in
    // a run the bands are a few pixels tall and a label on every one is
    // noise, so the writing stops and the bars carry on.
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const barMax = Math.min(70, width * 0.09);
    for (const row of L.rows) {
      if (row.k > s.depth) break;
      const layer = layerAt(row.k);
      const mid = row.y + row.h / 2;
      if (row.h >= cfg.labelBandHeight) {
        ctx.fillStyle = withAlpha(palette.ink, 0.62);
        ctx.fillText(Lore.label(layer.name), 8, mid);
        // The seam, quieter, so a layer's character reads off the hill as
        // well as off the panel.
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        if (words && row.h >= cfg.seamBandHeight) {
          const w = ctx.measureText(Lore.label(layer.name)).width;
          ctx.fillStyle = withAlpha(layer.hue, 0.72);
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
      ctx.fillStyle = withAlpha(lordColor(door.lord), 0.95);
      ctx.fillText(words.name + (Lore.doors().doorTag || ''), 8, mid);
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
