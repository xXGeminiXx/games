// ---------------------------------------------------------------------------
// The one drawing: a cross-section of the hill.
//
// Sky, a low mound, then the strata as bands that darken with depth. The
// horde has carved each band into a network of tunnels that grows with the
// effort spent there, and the dead are drawn as dots moving through what they
// have dug. Below the deepest open band is unbroken ground with the face bitten
// into it. Ten diggers are ten dots; a million is a mass. Nothing here is an
// asset, and nothing here is the game: the view reads the simulation and
// never writes it.
//
// The carve of each band is drawn once into an offscreen canvas and only
// redrawn when more of it has been revealed or the size changes, so the
// per-frame cost is the dots.
// ---------------------------------------------------------------------------

import { goodAt, valueAt, hardnessAt, absorbAt, capUnits } from './materials.js?v=5';
import { distribute, activeFrom } from './horde.js?v=5';
import * as Lore from './lore.js?v=5';

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
 * How much of a band's carve is revealed after `effort` digger-seconds.
 * Logarithmic, so the first digger's first minute shows and the ten-thousandth
 * digger's still adds something.
 */
export function carveFraction(effort, scale) {
  if (!(effort > 0)) return 0;
  return Math.min(1, Math.log10(1 + effort / scale) / 3);
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
 * given depth. Bands shrink to fit so the whole dig is always on screen.
 */
export function layout(width, height, depth, cfg) {
  const surface = cfg.surfaceHeight;
  const bands = depth + 2; // open strata, plus the unbroken one the face is in
  const avail = Math.max(0, height - surface);
  const bandH = Math.max(cfg.minBandHeight, Math.min(cfg.bandHeight, avail / bands));
  const rows = [];
  for (let k = 0; k <= depth + 1; k++) rows.push({ k, y: surface + k * bandH, h: bandH });
  return { width, height, surface, bandH, rows, bottom: surface + bands * bandH };
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

export function createView(canvas, cfg, palette, strataCfg, hordeCfg, doc, ground) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  // The view is happy without a run's ground: it falls back to the plain
  // ladder, which is what the drawing looked like before seams existed.
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
  const drawGround = (L, s, effort) => {
    ensureCarve();
    const c = carve.ctx || ctx;
    const revealed = [];
    for (let k = 0; k <= s.depth; k++) {
      const frac = carveFraction(effort[k] || 0, cfg.carveScale * Math.pow(1.35, k));
      revealed.push(Math.round(frac * cfg.tunnelSegments));
    }
    const key = [width, height, s.depth, revealed.join(',')].join('|');
    if (key === carve.key) return;
    carve.key = key;
    carve.revealed = revealed;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    // Sky and the mound.
    c.fillStyle = palette.sky;
    c.fillRect(0, 0, width, L.surface);
    c.fillStyle = palette.mound;
    c.beginPath();
    c.moveTo(width * 0.30, L.surface);
    c.quadraticCurveTo(width * 0.5, L.surface - 22, width * 0.70, L.surface);
    c.closePath();
    c.fill();

    // Bands, darker as they go.
    for (const row of L.rows) {
      const t = 1 - Math.exp(-row.k / 9);
      c.fillStyle = row.k <= s.depth ? mix(palette.earth, palette.deep, t) : mix(palette.face, palette.deep, Math.min(1, t + 0.35));
      c.fillRect(0, row.y, width, row.h);
      c.fillStyle = withAlpha(palette.tunnel, 0.5);
      c.fillRect(0, row.y, width, 1);
    }
    // Ground below the last band: unbroken.
    c.fillStyle = palette.deep;
    c.fillRect(0, L.bottom, width, Math.max(0, height - L.bottom));

    // Glints of each band's good, so the colour of what is down there shows.
    for (const row of L.rows) {
      if (row.k > s.depth + 1) continue;
      const g = layerAt(row.k);
      const r = rng((seed ^ (row.k * 7919)) >>> 0);
      const n = row.k <= s.depth ? cfg.glintCount : Math.ceil(cfg.glintCount / 3);
      c.fillStyle = withAlpha(g.hue, row.k <= s.depth ? 0.55 : 0.25);
      for (let i = 0; i < n; i++) {
        const gx = r() * width, gy = row.y + 3 + r() * Math.max(1, row.h - 6);
        const gs = 1 + r() * 1.6;
        c.fillRect(gx, gy, gs, gs);
      }
    }

    // The shaft, from the mound to the face.
    const faceRow = L.rows[s.depth + 1];
    c.fillStyle = palette.tunnel;
    c.fillRect(width * 0.5 - cfg.shaftWidth / 2, L.surface - 4, cfg.shaftWidth, Math.max(0, faceRow.y - L.surface + 4));

    // The carve of each open band.
    c.strokeStyle = palette.tunnel;
    c.lineCap = 'round';
    for (let k = 0; k <= s.depth; k++) {
      const row = L.rows[k];
      const list = segs(k);
      const n = Math.min(list.length, revealed[k]);
      if (n <= 0) continue;
      c.lineWidth = Math.max(1.2, Math.min(3.2, row.h * 0.11));
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const sg = list[i];
        c.moveTo(sg.x0 * width, row.y + sg.y0 * row.h);
        c.lineTo(sg.x1 * width, row.y + sg.y1 * row.h);
      }
      c.stroke();
    }
  };

  /** Keep the dot population in step with the horde and the weights. */
  const populate = (L, s, active) => {
    const want = Math.min(cfg.particleCap, Math.floor(s.horde));
    while (particles.length > want) particles.pop();
    const from = activeFrom(s.depth, hordeCfg, active);
    const split = distribute(s.weights, s.faceWeight, from);
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

    const over = s.horde > cfg.particleCap;
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

  /** Draw one frame. `effort` is digger-seconds spent per layer. */
  const draw = (s, effort, dt, active) => {
    seed = s.seed;
    const L = layout(width, height, s.depth, cfg);
    drawGround(L, s, effort);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (carve.canvas && carve.canvas !== canvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(carve.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    populate(L, s, active);
    drawDots(L, s, Math.min(0.1, dt || 0.016));

    // Band names, quietly, on the left. Deep in a run the bands are only a
    // few pixels tall and a label on every one is noise, so they stop.
    if (L.bandH >= 17) {
      ctx.fillStyle = withAlpha(palette.ink, 0.42);
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      for (const row of L.rows) {
        if (row.k > s.depth) break;
        const layer = layerAt(row.k);
        ctx.fillText(Lore.label(layer.name), 6, row.y + row.h / 2);
        // The seam, quieter still, so a layer's character reads off the hill
        // as well as off the panel.
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        if (words && L.bandH >= 24) {
          const w = ctx.measureText(Lore.label(layer.name)).width;
          ctx.fillStyle = withAlpha(layer.hue, 0.5);
          ctx.fillText(words.tag, 12 + w, row.y + row.h / 2);
          ctx.fillStyle = withAlpha(palette.ink, 0.42);
        }
      }
    }
    return L;
  };

  return { resize, draw, layout: () => layout(width, height, 0, cfg), particles, get size() { return { width, height, dpr }; } };
}
