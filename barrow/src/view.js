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

import { goodAt, valueAt, hardnessAt, absorbAt, capUnits } from './materials.js?v=17';
import { activeFrom } from './horde.js?v=17';
import * as Lore from './lore.js?v=17';

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
  // Bands shrink to fit, and fitting wins: minBandHeight is two pixels, not a
  // readability floor. Held at twelve it pushed the deepest six layers and
  // the face off the bottom of a phone's two hundred pixel field, and the
  // face is the part worth looking at. What a thin band loses is its writing,
  // and that is what labelBandHeight decides.
  const bandH = Math.max(cfg.minBandHeight, Math.min(cfg.bandHeight, avail / bands));
  const rows = [];
  for (let k = 0; k <= depth + 1; k++) rows.push({ k, y: surface + k * bandH, h: bandH });
  const bottom = surface + bands * bandH;
  // Whatever room is left under the cut is ground too, and drawing it as one
  // flat rectangle made a shallow dig look like a hole in an empty page. It
  // is bedded out in the same bands, unlit and unnamed, so the picture is
  // always a section through a hill rather than a diagram floating in a box.
  const ghosts = Math.max(0, Math.ceil((height - bottom) / bandH));
  return { width, height, surface, bandH, rows, bottom, ghosts };
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
    const dug = Math.max(0, Math.log10(1 + (s.totals ? s.totals.dug || 0 : 0)));
    const key = [width, height, s.depth, Math.round(dug * 4), revealed.join(',')].join('|');
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

    // The mound, and the spoil heap beside it, which grows with everything
    // that has come out of the hole. The mound is a hill, so it is drawn as
    // one: a few hundred pixels across whatever the window is, not a flat
    // three quarters of the width with a ten pixel rise in the middle.
    const half = Math.max(60, Math.min(220, width * 0.22));
    const crest = Math.min(L.surface - 5, 16 + dug * 1.5);
    c.fillStyle = palette.mound;
    c.beginPath();
    c.moveTo(width * 0.5 - half, L.surface);
    c.quadraticCurveTo(width * 0.5, L.surface - crest * 1.6, width * 0.5 + half, L.surface);
    c.closePath();
    c.fill();
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
      const open = (u) => Math.abs(u - 0.5) * 2 <= frac + (stand(u) - 0.5) * 0.24 && stand(u) <= 0.84;
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

  /** Draw one frame. `effort` is digger-seconds spent per layer. */
  const draw = (s, effort, dt, active, split) => {
    if (!split) split = { strata: [], face: 0 };
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
    populate(L, s, active, split);
    drawDots(L, s, Math.min(0.1, dt || 0.016));

    // Band names on the left, and on the right a bar for the share of the
    // horde standing in that band, so the panel and the picture say the same
    // thing and a layer nobody is working looks empty from here too. Deep in
    // a run the bands are a few pixels tall and a label on every one is
    // noise, so the writing stops and the bars carry on.
    const from = activeFrom(s.depth, hordeCfg, active);
    const named = L.bandH >= cfg.labelBandHeight;
    if (named) {
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
    }
    const barMax = Math.min(70, width * 0.09);
    for (const row of L.rows) {
      if (row.k > s.depth) break;
      const layer = layerAt(row.k);
      const mid = row.y + row.h / 2;
      if (named) {
        ctx.fillStyle = withAlpha(palette.ink, 0.62);
        ctx.fillText(Lore.label(layer.name), 8, mid);
        // The seam, quieter, so a layer's character reads off the hill as
        // well as off the panel.
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        if (words && L.bandH >= cfg.seamBandHeight) {
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

    // Ground below the cut that has been read ahead of the dead reaching it:
    // named, faintly, where it lies. This is what a player gets for buying
    // the reading, and it is the only place in the game that shows the shape
    // of a barrow before it is dug.
    if (named && s.read) {
      for (let k = s.depth + 1; k < s.depth + 40; k++) {
        if (!s.read[k]) continue;
        const y = k <= s.depth + 1 ? L.rows[k].y : L.bottom + (k - s.depth - 2) * L.bandH;
        const mid = y + L.bandH / 2;
        if (mid > height - 4) break;
        const layer = layerAt(k);
        ctx.fillStyle = withAlpha(palette.ink, 0.34);
        ctx.fillText(Lore.label(layer.name), 8, mid);
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        if (words && L.bandH >= cfg.seamBandHeight) {
          const w = ctx.measureText(Lore.label(layer.name)).width;
          ctx.fillStyle = withAlpha(layer.hue, 0.42);
          ctx.fillText(words.tag, 14 + w, mid);
        }
      }
    }
    return L;
  };

  return { resize, draw, layout: () => layout(width, height, 0, cfg), particles, get size() { return { width, height, dpr }; } };
}
