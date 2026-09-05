// ===========================================================================
// FRACTAL - the field is an escape-time picture, and the blocks are pieces of it
//
// Julia sets and the Mandelbrot set, laid onto the world and dealt downward.
// The picture is one thing fixed in world space: every world column maps to a
// fixed strip of the complex plane for as long as its panel lasts, so pulling
// the view back reveals more of the same picture rather than dealing another.
//
// A BLOCK IS NOT A CELL HERE. It is a PIECE: a region of the band around the
// set whose outline is the picture's own geometry. The band - the filigree
// between the outer sky and the hollow inside of the set - is cut two ways,
// and only two ways:
//
//   along ITERATION SHELLS, the equipotential curves an escape-time picture
//   draws as its colour bands, and
//   along EXTERNAL RAYS, the curves of constant argument of an early iterate,
//   which run from the outside in to the set and follow its filigree.
//
// A cell of that cutting is a curved quadrilateral: two arcs and two rays.
// Where the set is smooth the cells are fat arcs; where it is lace the cells
// are the lace. Cells bigger than a target are cut by finer rays until they
// fit, cells smaller than a floor are merged into a neighbour, and each
// connected region that is left is one piece. Nothing straight is ever drawn
// through the band: no lattice line, no row seam, no square.
//
// Every piece is known at PIXEL resolution. Each world row is rasterised once,
// at the size its cells have on screen when it is dealt, into a strip that
// holds the smooth iteration count and the piece id of every pixel. The same
// strip is what the swarm collides against (src/fractal-surface.js paints
// from it; index.html asks probe() where a body is touching), so what the
// player sees is exactly what a body bounces off, and a gap in the lace is a
// gap a body can use whatever the size of a cell.
//
// The inside of the set is hollow, and the sky outside the band is sky. Both
// are where the swarm goes.
//
// Rows are still the unit of ARRIVAL. A piece belongs to the row its lowest
// pixel lies in and is dealt when that row arrives at the top of the field,
// so its upper part enters the screen over the following steps like any
// scrolling picture. Rows are dealt from the bottom of a panel upward, so a
// picture stands the right way up.
//
// Everything here is a pure function of (seed, row). A row can be asked for
// again by a save or a test and it is the same row, the same pieces, the same
// ids.
// ===========================================================================

import { CONFIG, leftEdgeAt } from '../config.js?v=25';

const LN2 = Math.LN2;
const TAU = Math.PI * 2;

/** Deterministic 32 bit hash. */
export function hash(a, b) {
  let x = (a | 0) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2545f491);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * The Julia constants a run can meet. Every one lies inside the Mandelbrot set
 * so its Julia set is connected, and every one is a shape people recognise -
 * spirals, dragons, rabbits, dendrites - rather than dust.
 */
export const JULIA = Object.freeze([
  { re: -0.7269, im: 0.1889,  name: 'spiral' },
  { re: -0.8,    im: 0.156,   name: 'seahorse' },
  { re: -0.4,    im: 0.6,     name: 'dragon' },
  { re: 0.285,   im: 0.01,    name: 'galaxy' },
  { re: -0.123,  im: 0.745,   name: 'rabbit' },
  { re: -0.835,  im: -0.2321, name: 'hydra' },
  { re: -0.70176, im: -0.3842, name: 'elephant' },
  { re: 0.355,   im: 0.355,   name: 'coral' },
  { re: -0.75,   im: 0.11,    name: 'filament' },
  { re: -0.1,    im: 0.651,   name: 'wheel' },
  { re: 0.37,    im: 0.1,     name: 'pearl' },
  { re: -0.54,   im: 0.54,    name: 'lace' },
]);

/**
 * Smooth escape-time for z -> z^2 + c.
 *
 * Returns the fractional iteration count (a real number, continuous across
 * the bands) or Infinity for a point that never escaped, which is the inside
 * of the set. A bailout radius of 16 rather than 2 is what makes the count
 * continuous enough to colour without visible steps.
 */
export function escape(zr, zi, cr, ci, maxIter) {
  let n = 0, zr2 = zr * zr, zi2 = zi * zi;
  while (n < maxIter && zr2 + zi2 <= 256) {
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr; zi2 = zi * zi;
    n++;
  }
  if (n >= maxIter) return Infinity;
  const lz = Math.log(zr2 + zi2) * 0.5;
  const mu = n + 1 - Math.log(lz / LN2) / LN2;
  return mu > 0 ? mu : 0;
}

// The angle of an early iterate, written here by escapeRay() beside its
// return value so the hot loop allocates nothing.
let rayAngle = 0;

/**
 * escape(), and the argument of the `rayIter`-th iterate on the side.
 *
 * The curves of constant argument of z_m are the external rays of the set at
 * level m: they come in from far away and land on the boundary, and they bend
 * with its filigree more the larger m is. Cutting the band along them is what
 * gives a piece a fractal outline instead of a straight one.
 */
function escapeRay(zr, zi, cr, ci, maxIter, rayIter) {
  let n = 0, zr2 = zr * zr, zi2 = zi * zi;
  let ar = zr, ai = zi;
  while (n < maxIter && zr2 + zi2 <= 256) {
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr; zi2 = zi * zi;
    n++;
    if (n === rayIter) { ar = zr; ai = zi; }
  }
  if (n < rayIter) { ar = zr; ai = zi; }
  rayAngle = Math.atan2(ai, ar);
  if (n >= maxIter) return Infinity;
  const lz = Math.log(zr2 + zi2) * 0.5;
  const mu = n + 1 - Math.log(lz / LN2) / LN2;
  return mu > 0 ? mu : 0;
}

/**
 * A panel: one picture fitted to the widest lattice.
 *
 * Picture space is (u, v): u runs across the columns, v down the rows, both in
 * plane units. `toPlane(u, v)` turns a picture point into the plane point the
 * iteration starts from (Julia) or the constant it uses (Mandelbrot), which
 * is how the Mandelbrot set is stood on end - it is wider than it is tall,
 * and the panel is taller than it is wide.
 */
function makePanel(seed, index, cfg, cols, startWidth) {
  const maxIter = Math.max(32, cfg.maxIter | 0);
  const every = Math.max(2, cfg.mandelbrotEvery | 0);
  const isMandel = index > 0 && index % every === 0;

  let kind, cr, ci, name, angle;
  if (isMandel) {
    kind = 'mandelbrot'; cr = 0; ci = 0; name = 'mandelbrot';
    angle = (Math.floor(index / every) & 1) ? -Math.PI / 2 : Math.PI / 2;
  } else {
    kind = 'julia';
    const pool = JULIA;
    let pick = hash(seed, index * 7 + 3) % pool.length;
    if (index === 0) pick = hash(seed, 11) % 3;
    const prev = index > 0 ? hash(seed, (index - 1) * 7 + 3) % pool.length : -1;
    if (index > 0 && pick === prev) pick = (pick + 1) % pool.length;
    const j = pool[pick];
    cr = j.re; ci = j.im; name = j.name;
    angle = [0, Math.PI / 2, -Math.PI / 2][hash(seed, index * 13 + 5) % 3];
  }
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const toPlane = (u, v) => [u * ca - v * sa, u * sa + v * ca];
  const iter = isMandel
    ? (u, v) => { const p = toPlane(u, v); return escape(0, 0, p[0], p[1], maxIter); }
    : (u, v) => { const p = toPlane(u, v); return escape(p[0], p[1], cr, ci, maxIter); };

  // --- fit the window to the set ------------------------------------------
  const N = Math.max(48, cfg.scan | 0);
  const span = 2.2;
  const near = maxIter * Math.min(0.5, Math.max(0.01, Number(cfg.nearShare) || 0.05));
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const mus = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = -span + (y + 0.5) * (2 * span / N);
    for (let x = 0; x < N; x++) {
      const u = -span + (x + 0.5) * (2 * span / N);
      const m = iter(u, v);
      mus[y * N + x] = m === Infinity ? maxIter : m;
      if (m >= near) {
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
    }
  }
  if (!(u1 > u0) || !(v1 > v0)) { u0 = -1.6; u1 = 1.6; v0 = -1.2; v1 = 1.2; }
  const margin = Math.max(0, Number(cfg.margin) || 0.06);
  const pad = Math.max(u1 - u0, v1 - v0) * margin;
  u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;

  const dx = (u1 - u0) / cols;
  const minRows = Math.max(8, cfg.minRows | 0), maxRows = Math.max(minRows, cfg.maxRows | 0);
  let rows = Math.round((v1 - v0) / dx);
  rows = Math.min(maxRows, Math.max(minRows, rows));
  const vc = (v0 + v1) / 2;
  const top = vc - rows * dx / 2;

  // --- the mass threshold ---------------------------------------------------
  //
  // Chosen so that the band fills the window to the target share. The scan's
  // ESCAPED samples inside the window are sorted by iteration count and the
  // threshold is read off at the quantile that leaves the target share of
  // the whole window above it; the inside of the set does not count, because
  // it is hollow. Clamped to the near band at the low end so the sky never
  // becomes a block.
  const escaped = [];
  let total = 0;
  for (let y = 0; y < N; y++) {
    const v = -span + (y + 0.5) * (2 * span / N);
    if (v < top || v > top + rows * dx) continue;
    for (let x = 0; x < N; x++) {
      const u = -span + (x + 0.5) * (2 * span / N);
      if (u < u0 || u > u1) continue;
      total++;
      const m = mus[y * N + x];
      if (m < maxIter) escaped.push(m);
    }
  }
  escaped.sort((a, b) => a - b);
  const target = Math.min(0.9, Math.max(0.05, Number(cfg.massTarget) || 0.3));
  const want = Math.round(total * target);
  let T = escaped.length ? escaped[Math.max(0, escaped.length - want)] : near;
  T = Math.max(near, Math.min(maxIter * 0.9, T));

  const p = {
    index, kind, name, cr, ci, angle, cols, rows, u0, dx, top, T, maxIter, iter, toPlane,
    isMandel, ca, sa, masks: null, labeled: false,
  };

  // --- the coarse masks, and the trim ---------------------------------------
  //
  // A cell-level view of where the band is, used only to cut the panel down
  // to where its mass actually is. The bottom is cut to the first row with
  // band in the columns the view will have when the panel starts arriving -
  // a panel that opens with a dozen rows of sky spends the whole opening
  // dealing nothing. The top is cut to the last row with any mass at all.
  const all = [];
  for (let j = 0; j < rows; j++) all.push(maskRow(p, j, cfg));
  const sw = Math.max(1, Math.min(cols, startWidth | 0 || cols));
  const cLo = Math.floor((cols - sw) / 2), cHi = cLo + sw;
  const rowHas = (m, a, b) => { for (let c = a; c < b; c++) if (m[c]) return true; return false; };
  let jBottom = rows - 1;
  while (jBottom > 0 && !rowHas(all[jBottom], cLo, cHi)) jBottom--;
  let jTop = 0;
  while (jTop < jBottom && !rowHas(all[jTop], 0, cols)) jTop++;
  if (jBottom - jTop + 1 < minRows) {
    const need = minRows - (jBottom - jTop + 1);
    jTop = Math.max(0, jTop - need);
    if (jBottom - jTop + 1 < minRows) jBottom = Math.min(rows - 1, jTop + minRows - 1);
  }
  p.top = top + jTop * dx;
  p.rows = jBottom - jTop + 1;
  p.masks = all.slice(jTop, jBottom + 1);
  return p;
}

/** How deep into the band a sample sits: 0 at the threshold, 1 at the rim. */
function depthOf(mu, p) {
  const lo = Math.log(1 + p.T), hi = Math.log(1 + p.maxIter);
  const t = (Math.log(1 + Math.max(mu, 0)) - lo) / Math.max(1e-6, hi - lo);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Coarse band presence per cell of picture row j, for the trim. */
function maskRow(p, j, cfg) {
  const samples = Math.max(1, Math.min(8, cfg.samples | 0 || 4));
  const massShare = Math.min(1, Math.max(0.05, Number(cfg.massShare) || 0.35));
  const cols = p.cols;
  const mask = new Uint8Array(cols);
  const v0 = p.top + j * p.dx;
  const step = p.dx / samples;
  const n = samples * samples;
  for (let c = 0; c < cols; c++) {
    const uc = p.u0 + c * p.dx;
    let hits = 0;
    for (let y = 0; y < samples; y++) {
      const v = v0 + (y + 0.5) * step;
      for (let x = 0; x < samples; x++) {
        const mu = p.iter(uc + (x + 0.5) * step, v);
        if (mu >= p.T && mu !== Infinity) hits++;
      }
    }
    if (hits / n >= massShare) mask[c] = 1;
  }
  return mask;
}

/**
 * The field source.
 *
 * @param {number} seed
 * @param {object} [opts]   overrides for CONFIG.fractal, used by tools and tests
 */
export function createFractalSource(seed, opts) {
  const cfg = Object.assign({}, CONFIG.fractal || {}, opts || {});
  const s = (seed >>> 0) || 1;

  const ladder = (Array.isArray(cfg.ladder) && cfg.ladder.length ? cfg.ladder : [8]).map(n => Math.max(4, n | 0));
  const rungRows = Math.max(1, cfg.rungRows | 0);
  const cols = Math.max(...ladder);              // the panel width, world columns
  const panelLo = leftEdgeAt(cols);
  const gap = Math.max(0, cfg.gap | 0);
  const boardW = CONFIG.board.width;
  const cell0 = boardW / CONFIG.board.cols;
  const fieldH = (CONFIG.board.height - CONFIG.board.floorGap) - (CONFIG.board.topGap + Math.max(0, CONFIG.board.ceilingGap | 0));
  const descentPx = Math.max(4, Number(cfg.descentPx) || cell0);

  // The cutting.
  const PC = Object.assign({}, cfg.pieces || {});
  const maxArea = Math.max(0.05, Number(PC.maxArea) || 1.4);       // cells^2
  const minArea = Math.max(0, Number(PC.minArea) || 0.12);          // cells^2
  const sectors0 = Math.max(1, PC.sectors | 0 || 4);
  const rayIter = Math.max(1, PC.rayIter | 0 || 5);
  const shellW = Math.max(0.1, Number(PC.shell) || 1);
  const maxLevel = Math.max(0, Math.min(12, PC.maxLevel | 0 || 8));
  const maxFill = Math.min(1, Math.max(0, Number(cfg.maxFill) || 0));
  const maxIterN = Math.max(32, cfg.maxIter | 0);

  const panels = [];                 // built in order; panel k starts at row starts[k]
  const starts = [];
  const strips = new Map();          // R -> strip
  const pieces = new Map();          // id -> piece
  const dealtRows = new Map();       // R -> { width, lo, r0 }
  const liveById = new Map();        // id -> the game's live block
  const live = [];                   // the same, dense by id, for the hot loop
  let dealt = 0;                     // rows dealt so far; the next row is R = dealt
  let steps = 0;                     // times the board has stepped down
  let nextId = 1;
  let rowAtScreen = null;            // sr -> R, rebuilt when placement changes
  let placementDirty = true;

  /** Width the lattice has for row R. The ladder climbs one rung every
   *  `rungRows` rows and holds at the top. */
  function widthAt(R) {
    const rung = Math.floor(Math.max(0, R) / rungRows);
    return ladder[Math.min(rung, ladder.length - 1)];
  }

  /** Rows the field shows between its top and the swarm line at a width. */
  function fieldRowsAt(width) { return fieldH / (boardW / width); }

  /**
   * The width a row is RASTERISED at: the widest the view will reach while
   * the row is still on screen. A row is dealt at one width and stays on
   * screen while the view pulls back past it, and what the pull-back reveals
   * beside it has to already be there.
   */
  function renderWidthAt(R) {
    const w = widthAt(R);
    return widthAt(R + Math.ceil(fieldRowsAt(w)) + 1);
  }

  /** Build panel k's window and constants, without cutting it. */
  function buildPanel(k) {
    while (panels.length <= k) {
      const start = panels.length ? starts[panels.length - 1] + panels[panels.length - 1].rows + gap : 0;
      const p = makePanel(s, panels.length, cfg, cols, widthAt(start));
      p.start = start;
      p.rowStrips = [];
      p.rastered = 0;
      panels.push(p); starts.push(start);
    }
    return panels[k];
  }

  /** Panel k, built and cut - synchronously if it has not been prepared. */
  function panelAt(k) {
    const p = buildPanel(k);
    if (!p.labeled) {
      rasterPanel(p, Infinity);
      if (!p.cutter) p.cutter = cutPanelSteps(p);
      while (!p.cutter.next().done) { /* every stage, now */ }
      p.cutter = null;
    }
    return p;
  }

  /**
   * Work ahead on the next panel for at most `budgetMs`, so that its cutting
   * happens in the quiet between turns rather than on the turn that first
   * needs it. Rasterising goes a row at a time and the cutting a stage at a
   * time, so no single call runs long. Returns true when there is nothing
   * left to prepare.
   */
  function prepare(budgetMs) {
    const at = locate(dealt);
    const k = at ? at.k + 1 : panels.length;
    const p = buildPanel(k);
    if (p.labeled) return true;
    const t0 = now();
    if (!rasterPanel(p, budgetMs)) return false;
    if (!p.cutter) p.cutter = cutPanelSteps(p);
    do {
      if (p.cutter.next().done) { p.cutter = null; return true; }
    } while (now() - t0 < budgetMs);
    return false;
  }

  /** Which panel and picture row a world row belongs to; null for a gap row. */
  function locate(R) {
    let k = 0;
    for (;;) {
      const p = panelAt(k);
      const start = starts[k];
      if (R < start) return null;
      if (R < start + p.rows) return { panel: p, k, j: p.rows - 1 - (R - start) };
      k++;
    }
  }

  // -------------------------------------------------------------------------
  // RASTER
  // -------------------------------------------------------------------------

  /** Rasterise world row R of panel p (picture row j): the smooth iteration
   *  count and the ray angle of every pixel, at the row's render width. */
  function rasterRow(p, R, j) {
    const width = renderWidthAt(R), lo = leftEdgeAt(width);
    const px = Math.max(1, Math.ceil(boardW / width));
    const w = width * px, h = px;
    const mu = new Float32Array(w * h);
    const ang = new Uint16Array(w * h);
    const c0 = lo - panelLo;
    const v0 = p.top + j * p.dx;
    const inv = 1 / px;
    const ca = p.ca, sa = p.sa, cr = p.cr, ci = p.ci, maxIter = p.maxIter, isMandel = p.isMandel;
    for (let k = 0; k < h; k++) {
      const v = v0 + (k + 0.5) * inv * p.dx;
      let idx = k * w;
      for (let i = 0; i < w; i++, idx++) {
        const u = p.u0 + (c0 + (i + 0.5) * inv) * p.dx;
        const pr = u * ca - v * sa, pi = u * sa + v * ca;
        const m = isMandel
          ? escapeRay(0, 0, pr, pi, maxIter, rayIter)
          : escapeRay(pr, pi, cr, ci, maxIter, rayIter);
        mu[idx] = m;
        ang[idx] = ((rayAngle / TAU + 1) % 1) * 65535;
      }
    }
    return { R, j, width, lo, px, w, h, mu, ang, id: new Int32Array(w * h), cellHas: new Uint8Array(width), pieceIds: new Set(), base: 0, panel: p };
  }

  // -------------------------------------------------------------------------
  // THE CUTTING - pieces of the band
  // -------------------------------------------------------------------------

  /** Union-find with path halving over a panel's pixels. */
  function find(parent, x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }

  /** Rasterise the panel's rows, bottom first, within a time budget. True
   *  when every row has a strip. */
  function rasterPanel(p, budgetMs) {
    const t0 = budgetMs === Infinity ? 0 : now();
    while (p.rastered < p.rows) {
      if (budgetMs !== Infinity && p.rastered > 0 && now() - t0 >= budgetMs) return false;
      const j = p.rows - 1 - p.rastered;
      const R = p.start + p.rastered;
      const st = rasterRow(p, R, j);
      p.rowStrips.push(st);
      p.rastered++;
    }
    return true;
  }

  function now() {
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now() : Date.now();
  }

  /**
   * Cut the band of one panel into pieces, one stage per yield.
   *
   * Every band pixel is labelled by (shell, sector): the shell is the integer
   * iteration band it lies in past the threshold, the sector is a slice of
   * the ray angle. Neighbouring pixels of one label join; a region larger
   * than the target is re-cut with twice as many sectors, as many times as
   * it takes; a region smaller than the floor joins its longest neighbour.
   * What is left is the pieces.
   */
  function* cutPanelSteps(p) {
    const T = p.T;
    const rowStrips = p.rowStrips;
    let total = 0;
    for (const st of rowStrips) {
      st.base = total;
      total += st.w * st.h;
      strips.set(st.R, st);
    }
    p.rowStrips = null;
    // Panel-wide arrays over every pixel, indexed strip.base + local.
    const inBand = new Uint8Array(total);
    const shell = new Uint8Array(total);
    const level = new Uint8Array(total);
    const parent = new Int32Array(total);
    const angAll = new Uint16Array(total);
    const pxOf = new Float32Array(total);      // 1/px^2: the pixel's area in cells^2
    for (const st of rowStrips) {
      const b = st.base, n = st.w * st.h, area = 1 / (st.px * st.px);
      for (let i = 0; i < n; i++) {
        const m = st.mu[i];
        const g = b + i;
        parent[g] = g;
        pxOf[g] = area;
        angAll[g] = st.ang[i];
        if (m >= T && m !== Infinity) {
          inBand[g] = 1;
          const sh = Math.floor((m - T) / shellW);
          shell[g] = sh > 255 ? 255 : sh;
        }
      }
    }

    yield;
    const sectorOf = (g, L) => (angAll[g] * sectors0 * (1 << L)) >>> 16;
    const same = (a, b, L) => shell[a] === shell[b] && sectorOf(a, L) === sectorOf(b, L);

    /** Join neighbours of one level and label, within and across strips. */
    function unite(L) {
      for (let si = 0; si < rowStrips.length; si++) {
        const st = rowStrips[si];
        const w = st.w, h = st.h, b = st.base;
        for (let k = 0; k < h; k++) {
          const row = b + k * w;
          for (let i = 0; i < w; i++) {
            const g = row + i;
            if (!inBand[g] || level[g] !== L) continue;
            if (i + 1 < w) {
              const q = g + 1;
              if (inBand[q] && level[q] === L && same(g, q, L)) join(g, q);
            }
            if (k + 1 < h) {
              const q = g + w;
              if (inBand[q] && level[q] === L && same(g, q, L)) join(g, q);
            }
          }
        }
        // The strip ABOVE this one on screen is the next world row, whose
        // bottom pixel row touches this strip's top pixel row.
        const up = rowStrips[si + 1];
        if (!up) continue;
        for (let i = 0; i < w; i++) {
          const g = b + i;
          if (!inBand[g] || level[g] !== L) continue;
          const u = st.lo + (i + 0.5) / st.px;
          const xi = Math.floor((u - up.lo) * up.px);
          if (xi < 0 || xi >= up.w) continue;
          const q = up.base + (up.h - 1) * up.w + xi;
          if (inBand[q] && level[q] === L && same(g, q, L)) join(g, q);
        }
      }
    }
    function join(a, b) {
      const ra = find(parent, a), rb = find(parent, b);
      if (ra !== rb) parent[rb] = ra;
    }

    const areaOf = new Float32Array(total);   // area per root, valid after a pass
    function measure(L) {
      areaOf.fill(0);
      for (let g = 0; g < total; g++) if (inBand[g] && level[g] === L) areaOf[find(parent, g)] += pxOf[g];
    }

    for (let L = 0; L <= maxLevel; L++) {
      unite(L);
      yield;
      if (L === maxLevel) break;
      measure(L);
      let big = 0;
      for (let g = 0; g < total; g++) {
        if (!inBand[g] || level[g] !== L) continue;
        if (areaOf[find(parent, g)] > maxArea) { level[g] = L + 1; big++; }
      }
      if (!big) break;
      for (let g = 0; g < total; g++) if (level[g] === L + 1) parent[g] = g;
    }

    // --- merge the small into the large -------------------------------------
    yield;
    areaOf.fill(0);
    for (let g = 0; g < total; g++) if (inBand[g]) areaOf[find(parent, g)] += pxOf[g];
    if (minArea > 0) {
      // Border length between a small region and each neighbour, then the
      // longest neighbour wins it. Done over the pixels of small regions only.
      const border = new Map();     // rootSmall -> Map(rootOther -> count)
      const neighbours = (st, k, i, cb) => {
        const w = st.w, h = st.h, g = st.base + k * w + i;
        if (i > 0) cb(g - 1);
        if (i + 1 < w) cb(g + 1);
        if (k > 0) cb(g - w);
        if (k + 1 < h) cb(g + w);
        const si = rowStrips.indexOf(st);
        if (k === 0 && rowStrips[si + 1]) {
          const up = rowStrips[si + 1];
          const xi = Math.floor((st.lo + (i + 0.5) / st.px - up.lo) * up.px);
          if (xi >= 0 && xi < up.w) cb(up.base + (up.h - 1) * up.w + xi);
        }
        if (k === h - 1 && si > 0) {
          const dn = rowStrips[si - 1];
          const xi = Math.floor((st.lo + (i + 0.5) / st.px - dn.lo) * dn.px);
          if (xi >= 0 && xi < dn.w) cb(dn.base + xi);
        }
      };
      for (const st of rowStrips) {
        const w = st.w, h = st.h;
        for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) {
          const g = st.base + k * w + i;
          if (!inBand[g]) continue;
          const r = find(parent, g);
          if (areaOf[r] >= minArea) continue;
          let m = border.get(r);
          if (!m) { m = new Map(); border.set(r, m); }
          neighbours(st, k, i, (q) => {
            if (!inBand[q]) return;
            const rq = find(parent, q);
            if (rq === r) return;
            m.set(rq, (m.get(rq) || 0) + 1);
          });
        }
      }
      // Smallest first, so a speck joins a neighbour before that neighbour
      // is itself absorbed.
      const smalls = [...border.keys()].sort((a, b) => (areaOf[a] - areaOf[b]) || (a - b));
      for (const r of smalls) {
        const m = border.get(r);
        let best = -1, bestN = 0;
        for (const [rq, n] of m) {
          const root = find(parent, rq);
          if (root === find(parent, r)) continue;
          if (n > bestN || (n === bestN && root < best)) { best = root; bestN = n; }
        }
        if (best < 0) continue;
        const ra = find(parent, r);
        parent[ra] = best;
        areaOf[best] += areaOf[ra];
      }
      // A speck that found no neighbour to join is dust, not a block.
      for (let g = 0; g < total; g++) {
        if (!inBand[g]) continue;
        if (areaOf[find(parent, g)] < minArea * 0.5) inBand[g] = 0;
      }
    }

    // --- ids and piece records --------------------------------------------
    yield;
    const idOfRoot = new Map();
    const recs = [];
    for (const st of rowStrips) {
      const w = st.w, h = st.h, b = st.base, px = st.px, R = st.R;
      const area = 1 / (px * px);
      for (let k = 0; k < h; k++) {
        for (let i = 0; i < w; i++) {
          const g = b + k * w + i;
          if (!inBand[g]) continue;
          const r = find(parent, g);
          let id = idOfRoot.get(r);
          let rec;
          if (id === undefined) {
            id = nextId++;
            idOfRoot.set(r, id);
            rec = {
              id, panel: p.index, area: 0, wsum: 0, musum: 0, n: 0, usum: 0, hsum: 0,
              rowLo: Infinity, rowHi: -Infinity, umin: Infinity, umax: -Infinity,
              box: new Map(),          // R -> [x0, x1, y0, y1] in that strip's pixels (x1, y1 exclusive)
              anchorU: 0, anchorH: 0, insR: 0,
            };
            pieces.set(id, rec);
            recs.push(rec);
          } else rec = pieces.get(id);
          st.id[g - b] = id;
          st.pieceIds.add(id);
          st.cellHas[Math.floor(i / px)] = 1;
          const u = st.lo + (i + 0.5) / px;
          rec.area += area;
          rec.n++;
          rec.wsum += depthOf(st.mu[g - b], p) * area;
          rec.musum += st.mu[g - b] * area;
          rec.usum += u * area;
          // Height above the bottom edge of world row R's band, in rows;
          // resolved against the piece's own bottom row later.
          rec.hsum += (R + 1 - (k + 0.5) / px) * area;
          if (R < rec.rowLo) rec.rowLo = R;
          if (R > rec.rowHi) rec.rowHi = R;
          if (u < rec.umin) rec.umin = u;
          if (u > rec.umax) rec.umax = u;
          let bx = rec.box.get(R);
          if (!bx) { bx = [i, i + 1, k, k + 1]; rec.box.set(R, bx); }
          else {
            if (i < bx[0]) bx[0] = i; if (i + 1 > bx[1]) bx[1] = i + 1;
            if (k < bx[2]) bx[2] = k; if (k + 1 > bx[3]) bx[3] = k + 1;
          }
        }
      }
    }

    // --- the sky guarantee ------------------------------------------------
    //
    // A strip more than `maxFill` band across its dealt width is a wall; the
    // faintest pieces standing in it give way until it is not. The picture
    // under the field is untouched; only where a piece stands changes.
    yield;
    if (maxFill > 0 && maxFill < 1) {
      for (const st of rowStrips) {
        const vw = widthAt(st.R), vlo = leftEdgeAt(vw);
        const x0 = Math.max(0, (vlo - st.lo) * st.px), x1 = Math.min(st.w, (vlo + vw - st.lo) * st.px);
        const window = Math.max(1, (x1 - x0) * st.h);
        const fillOf = () => {
          let n = 0;
          for (let k = 0; k < st.h; k++) for (let i = x0; i < x1; i++) if (st.id[k * st.w + i]) n++;
          return n / window;
        };
        let guard = 0;
        while (fillOf() > maxFill && guard++ < 64) {
          let faint = null;
          for (const id of st.pieceIds) {
            const rec = pieces.get(id);
            if (!rec) continue;
            const d = rec.wsum / Math.max(1e-9, rec.area);
            if (!faint || d < faint.d || (d === faint.d && id < faint.id)) faint = { id, d };
          }
          if (!faint) break;
          erase(faint.id);
        }
      }
    }

    // --- finish the records -------------------------------------------------
    yield;
    for (const rec of recs) {
      if (!pieces.has(rec.id)) continue;
      const a = Math.max(1e-9, rec.area);
      rec.depth = rec.wsum / a;
      rec.mu = rec.musum / a;
      rec.cu = rec.usum / a;
      // The bottom edge of the piece: the lowest pixel row it has in its
      // lowest world row.
      const bx = rec.box.get(rec.rowLo);
      const stLo = strips.get(rec.rowLo);
      rec.bottom = rec.rowLo + 1 - bx[3] / stLo.px;         // world y of its lowest edge
      rec.hc = rec.hsum / a - rec.bottom;                  // centroid height above it, rows
      rec.r0 = bx[3] / stLo.px - 1;                        // screen row of that edge when rowLo is at row 0
      rec.c0 = Math.floor(rec.umin); rec.c1 = Math.ceil(rec.umax);
      rec.rows = rec.rowHi - rec.rowLo + 1;
      // Weight for the health share: area, and how deep into the band.
      rec.w = rec.area * (0.15 + 0.85 * rec.depth);
      anchorOf(rec);
      delete rec.wsum; delete rec.musum; delete rec.usum; delete rec.hsum;
    }
    p.labeled = true;
  }

  /** Remove a piece from every strip it stands in. */
  function erase(id) {
    const rec = pieces.get(id);
    if (!rec) return;
    for (const [R, bx] of rec.box) {
      const st = strips.get(R);
      if (!st) continue;
      for (let k = bx[2]; k < bx[3]; k++) for (let i = bx[0]; i < bx[1]; i++) {
        const g = k * st.w + i;
        if (st.id[g] === id) st.id[g] = 0;
      }
      st.pieceIds.delete(id);
    }
    pieces.delete(id);
  }

  /**
   * Where a piece's number goes: the pixel furthest from its edge, and how far
   * that is. A chamfer distance over the piece's own pixels, per strip, with
   * the strip edges treated as open where the piece continues.
   */
  function anchorOf(rec) {
    let best = -1, bu = rec.cu, bh = rec.hc, bpx = 1;
    for (const [R, bx] of rec.box) {
      const st = strips.get(R);
      if (!st) continue;
      const W = bx[1] - bx[0], H = bx[3] - bx[2];
      if (W <= 0 || H <= 0) continue;
      const INF = 1e6;
      const d = new Float32Array(W * H);
      const up = strips.get(R + 1), dn = strips.get(R - 1);
      for (let k = 0; k < H; k++) for (let i = 0; i < W; i++) {
        const g = (bx[2] + k) * st.w + (bx[0] + i);
        if (st.id[g] !== rec.id) { d[k * W + i] = 0; continue; }
        // A pixel on the strip's top or bottom row is interior if the piece
        // carries on in the neighbouring strip, and an edge otherwise.
        let edge = false;
        if (bx[2] + k === 0) edge = !(up && continues(up, st, bx[0] + i, rec.id, up.h - 1));
        if (bx[2] + k === st.h - 1) edge = edge || !(dn && continues(dn, st, bx[0] + i, rec.id, 0));
        d[k * W + i] = edge ? 0.5 : INF;
      }
      // Forward and backward passes.
      for (let k = 0; k < H; k++) for (let i = 0; i < W; i++) {
        const o = k * W + i;
        if (d[o] === 0) continue;
        let v = d[o];
        v = Math.min(v, i > 0 ? d[o - 1] + 1 : 1, k > 0 ? d[o - W] + 1 : v);
        if (i === 0 || i === W - 1) v = Math.min(v, 1);
        d[o] = v;
      }
      for (let k = H - 1; k >= 0; k--) for (let i = W - 1; i >= 0; i--) {
        const o = k * W + i;
        if (d[o] === 0) continue;
        let v = d[o];
        v = Math.min(v, i + 1 < W ? d[o + 1] + 1 : 1, k + 1 < H ? d[o + W] + 1 : v);
        d[o] = v;
      }
      for (let k = 0; k < H; k++) for (let i = 0; i < W; i++) {
        const v = d[k * W + i] / st.px;
        if (v > best) {
          best = v;
          bu = st.lo + (bx[0] + i + 0.5) / st.px;
          bh = (R + 1 - (bx[2] + k + 0.5) / st.px) - rec.bottom;
          bpx = st.px;
        }
      }
    }
    rec.insR = Math.max(0, best);
    rec.anchorU = bu;
    rec.anchorH = bh;
    rec.anchorPx = bpx;
  }

  /** Whether strip `other` holds piece `id` at the column pixel i of strip
   *  `st`, on its pixel row k. */
  function continues(other, st, i, id, k) {
    const xi = Math.floor((st.lo + (i + 0.5) / st.px - other.lo) * other.px);
    if (xi < 0 || xi >= other.w) return false;
    return other.id[k * other.w + xi] === id;
  }

  // -------------------------------------------------------------------------
  // PLACEMENT - where each dealt row is on screen
  // -------------------------------------------------------------------------

  function placement() {
    if (!placementDirty && rowAtScreen) return rowAtScreen;
    rowAtScreen = new Map();
    for (const [R, d] of dealtRows) {
      const sr = steps - d.r0;
      // Rows dealt in the same step share a screen row; the one dealt last is
      // the one whose pieces are there.
      const had = rowAtScreen.get(sr);
      if (had === undefined || R > had) rowAtScreen.set(sr, R);
    }
    placementDirty = false;
    return rowAtScreen;
  }

  // -------------------------------------------------------------------------
  // COLLISION
  // -------------------------------------------------------------------------

  // Scratch for probe(), indexed by piece id so the hot loop touches no Map.
  let hitN = new Int32Array(1024), hitU = new Float64Array(1024), hitR = new Float64Array(1024);
  let touched = new Int32Array(256);
  function growScratch() {
    const n = Math.max(1024, nextId + 256);
    if (hitN.length >= n) return;
    hitN = new Int32Array(n); hitU = new Float64Array(n); hitR = new Float64Array(n);
  }

  /**
   * A body against the pieces.
   *
   * @param {number} u    body centre, world column (continuous)
   * @param {number} rr   body centre, screen row (continuous, 0 at the top of the field)
   * @param {number} rad  body radius in cells
   * @returns {null|{block, nx, ny, depth}}  the living piece it overlaps most,
   *   the unit normal pointing out of that piece (screen sense: +y down), and
   *   how far along it the body must move to be clear, in cells
   */
  function probe(u, rr, rad) {
    const place = placement();
    const cLo = Math.floor(u - rad), cHi = Math.floor(u + rad);
    const sLo = Math.floor(rr - rad), sHi = Math.floor(rr + rad);
    // Fast path: is any band pixel in reach at all.
    let any = false;
    for (let sr = sLo; sr <= sHi && !any; sr++) {
      const R = place.get(sr);
      if (R === undefined) continue;
      const st = strips.get(R);
      if (!st) continue;
      for (let c = cLo; c <= cHi; c++) {
        const cc = c - st.lo;
        if (cc >= 0 && cc < st.width && st.cellHas[cc]) { any = true; break; }
      }
    }
    if (!any) return null;

    if (hitN.length <= nextId) growScratch();
    let nt = 0;
    let bestId = 0, bestN = 0;
    for (let sr = sLo; sr <= sHi; sr++) {
      const R = place.get(sr);
      if (R === undefined) continue;
      const st = strips.get(R);
      if (!st) continue;
      const px = st.px, w = st.w, h = st.h;
      const tx = (u - st.lo) * px, ty = (rr - sr) * px, rt = rad * px + 0.5;
      const k0 = Math.max(0, Math.ceil(ty - rt - 0.5)), k1 = Math.min(h - 1, Math.floor(ty + rt - 0.5));
      for (let k = k0; k <= k1; k++) {
        const dy = (k + 0.5) - ty;
        const span = rt * rt - dy * dy;
        if (span < 0) continue;
        const half = Math.sqrt(span);
        const i0 = Math.max(0, Math.ceil(tx - half - 0.5)), i1 = Math.min(w - 1, Math.floor(tx + half - 0.5));
        const row = k * w;
        for (let i = i0; i <= i1; i++) {
          const id = st.id[row + i];
          if (!id) continue;
          const b = live[id];
          if (!b || b.dead || !(b.hp > 0)) continue;
          if (hitN[id] === 0) {
            if (nt >= touched.length) { const t = new Int32Array(touched.length * 2); t.set(touched); touched = t; }
            touched[nt++] = id;
            hitU[id] = 0; hitR[id] = 0;
          }
          const n = ++hitN[id];
          hitU[id] += st.lo + (i + 0.5) / px;
          hitR[id] += sr + (k + 0.5) / px;
          if (n > bestN || (n === bestN && id > bestId)) { bestN = n; bestId = id; }
        }
      }
    }
    let nx = 0, ny = 0;
    if (bestId) { nx = u - hitU[bestId] / bestN; ny = rr - hitR[bestId] / bestN; }
    for (let t = 0; t < nt; t++) hitN[touched[t]] = 0;
    if (!bestId) return null;
    let len = Math.hypot(nx, ny);
    if (len < 1e-9) { nx = 0; ny = -1; len = 1; }
    nx /= len; ny /= len;
    // How far along the normal the body must move to clear every pixel of
    // that piece it overlaps: for each pixel at offset t from the centre the
    // clearing distance is sqrt(r^2 - perp^2) - along, and the largest wins.
    let depth = 0;
    for (let sr = sLo; sr <= sHi; sr++) {
      const R = place.get(sr);
      if (R === undefined) continue;
      const st = strips.get(R);
      if (!st) continue;
      const px = st.px, w = st.w, h = st.h;
      const tx = (u - st.lo) * px, ty = (rr - sr) * px, rt = rad * px + 0.5;
      const rc = rt / px;
      const k0 = Math.max(0, Math.ceil(ty - rt - 0.5)), k1 = Math.min(h - 1, Math.floor(ty + rt - 0.5));
      for (let k = k0; k <= k1; k++) {
        const dy = (k + 0.5) - ty;
        const span = rt * rt - dy * dy;
        if (span < 0) continue;
        const half = Math.sqrt(span);
        const i0 = Math.max(0, Math.ceil(tx - half - 0.5)), i1 = Math.min(w - 1, Math.floor(tx + half - 0.5));
        const row = k * w;
        for (let i = i0; i <= i1; i++) {
          if (st.id[row + i] !== bestId) continue;
          const txu = (st.lo + (i + 0.5) / px) - u, tyr = (sr + (k + 0.5) / px) - rr;
          const along = -(txu * nx + tyr * ny);
          const perp2 = txu * txu + tyr * tyr - along * along;
          const need = Math.sqrt(Math.max(0, rc * rc - perp2)) - along;
          if (need > depth) depth = need;
        }
      }
    }
    return { block: live[bestId], nx, ny, depth };
  }

  // -------------------------------------------------------------------------
  // DEALING
  // -------------------------------------------------------------------------

  /**
   * The pieces of row R and the open cells of its dealt width.
   *
   * Only a piece that touches the columns on screen when the row arrives is
   * dealt. A strip is rasterised wider than the view, so that the pull-back
   * has picture to reveal beside the rows already on screen - but a piece
   * standing entirely out there would be a block no body can reach until it
   * is nearly at the line, so what the pull-back reveals beside an old row
   * is the picture, not blocks.
   */
  function dealRow(R, width) {
    const lo = leftEdgeAt(width);
    const at = locate(R);
    const out = [], open = [];
    const st = strips.get(R);
    if (at && st) {
      for (const id of st.pieceIds) {
        const rec = pieces.get(id);
        if (!rec || rec.rowLo !== R) continue;
        if (rec.umax <= lo || rec.umin >= lo + width) continue;
        out.push({
          id, c: Math.floor(rec.cu), r: rec.r0, w: rec.w, R,
          cu: rec.cu, hc: rec.hc, box: { c0: rec.c0, c1: rec.c1, R0: rec.rowLo, R1: rec.rowHi + 1 },
          area: rec.area, mu: rec.mu, depth: rec.depth,
        });
      }
      out.sort((a, b) => (a.cu - b.cu) || (a.id - b.id));
      // A marker goes where the middle of a cell is clear of the picture, so
      // a body can reach it and nothing is drawn over the lace.
      for (let c = lo; c < lo + width; c++) {
        const cc = c - st.lo;
        if (cc < 0 || cc >= st.width) continue;
        if (!st.cellHas[cc]) { open.push({ c, r: 0 }); continue; }
        const x0 = Math.floor((cc + 0.25) * st.px), x1 = Math.ceil((cc + 0.75) * st.px);
        const y0 = Math.floor(0.25 * st.px), y1 = Math.ceil(0.75 * st.px);
        let clear = true;
        for (let k = y0; k < y1 && clear; k++) for (let i = x0; i < x1; i++) if (st.id[k * st.w + i]) { clear = false; break; }
        if (clear) open.push({ c, r: 0 });
      }
    } else {
      for (let c = lo; c < lo + width; c++) open.push({ c, r: 0 });
    }
    return { R, width, lo, pieces: out, open };
  }

  /** Forget strips and pieces that can no longer be on screen. */
  function prune() {
    const keepFrom = dealt - 200;
    if (strips.size < 260) return;
    for (const [R, st] of strips) {
      if (R >= keepFrom) continue;
      for (const id of st.pieceIds) {
        const rec = pieces.get(id);
        if (rec && rec.rowHi < keepFrom) { pieces.delete(id); liveById.delete(id); live[id] = undefined; }
      }
      strips.delete(R);
      dealtRows.delete(R);
    }
    placementDirty = true;
  }

  return {
    /** The next width the lattice wants. Read BEFORE the row, so the view can
     *  pull back to meet it. */
    width() { return widthAt(dealt); },

    /** Deal the next row: its pieces and its open cells. */
    nextRow() {
      const width = widthAt(dealt);
      const R = dealt++;
      locate(R);                       // builds and labels the panel if needed
      const row = dealRow(R, width);
      dealtRows.set(R, { width, lo: row.lo, r0: steps });
      placementDirty = true;
      prune();
      return row;
    },

    /** The board stepped down a row. */
    stepped() { steps++; placementDirty = true; },

    /** The whole field handed back n rows of headroom. */
    lift(n) { steps -= Math.max(0, n | 0); placementDirty = true; },

    /** Rows this turn should deal, so the field descends at a steady pace in
     *  pixels whatever the size of a cell. */
    rowsPerTurn() {
      const cell = boardW / widthAt(dealt);
      return Math.max(1, Math.round(descentPx / cell));
    },

    /** The panel being dealt, in the shape the rest of the game expects of a
     *  figure: its name, kind and the current width. */
    figure() {
      const at = locate(dealt) || locate(Math.max(0, dealt - 1)) || { panel: panelAt(0), k: 0, j: 0 };
      return { key: at.panel.kind, name: at.panel.name, index: at.k, width: widthAt(dealt), rows: at.panel.rows };
    },

    /** Where a dealt row is: the panel it came from, its picture row, the
     *  width and left edge it was dealt at, and the step count when it
     *  arrived. Null for a row not yet dealt. */
    rowInfo(R) {
      const d = dealtRows.get(R);
      if (!d) return null;
      const at = locate(R);
      return { R, width: d.width, lo: d.lo, r0: d.r0, panel: at ? at.panel : null, j: at ? at.j : -1 };
    },

    /** The living block standing on a piece, or null. */
    bind(b) {
      const rec = pieces.get(b.id);
      if (!rec) return false;
      b.cu = rec.cu; b.hc = rec.hc;
      b.box = { c0: rec.c0, c1: rec.c1, R0: rec.rowLo, R1: rec.rowHi + 1 };
      b.insR = rec.insR; b.anchorU = rec.anchorU; b.anchorH = rec.anchorH;
      b.area = rec.area; b.mu = rec.mu; b.depth = rec.depth;
      liveById.set(b.id, b);
      live[b.id] = b;
      return true;
    },
    unbind(id) { liveById.delete(id); live[id] = undefined; },
    alive(id) {
      const b = liveById.get(id);
      return b && !b.dead && b.hp > 0 ? b : null;
    },
    /** Every row's screen position this instant: Map screenRow -> R. */
    placement,
    probe,

    /** The panel that owns row R, or null in a gap. Builds it if needed. */
    panelOf(R) { const at = locate(R); return at ? at.panel : null; },
    locate,
    panelAt,
    widthAt,
    renderWidthAt,
    stripOf(R) { return strips.get(R) || null; },
    pieceOf(id) { return pieces.get(id) || null; },
    /** Work ahead on the next panel within a time budget; see prepare(). */
    prepare,
    /** Restore after a save: rows are replayed with nextRow(); this puts the
     *  step counter where one step per row would have left it. */
    resync() { steps = Math.max(0, dealt - 1); dealtRows.forEach((d, R) => { d.r0 = R; }); placementDirty = true; },

    get dealt() { return dealt; },
    get steps() { return steps; },
    get pieceCount() { return pieces.size; },
    get liveCount() { return liveById.size; },

    ladder: ladder.slice(),
    rungRows,
    cols,
    panelLo,
    config: cfg,
    seed: s,
    depthOf: (mu, p) => depthOf(mu, p),
    names: JULIA.map(j => j.name).concat(['mandelbrot']),
  };
}

export default createFractalSource;
