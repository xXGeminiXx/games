// ===========================================================================
// FRACTAL - the field is an escape-time fractal, and the blocks are its mass
//
// Julia sets and the Mandelbrot set, drawn onto the lattice. Every cell of the
// world grid maps to a fixed rectangle of the complex plane, so the picture is
// one thing that the view reveals more of as it pulls back, and a block is a
// cell where the set has mass: the filigree around the boundary and the body
// inside it. The sky between the arms is empty, which is what lets the swarm
// into the spirals.
//
// The picture does not live at the resolution of the cells. A cell at the
// start of a run is sixty-five pixels across and the fractal inside it is
// drawn at every one of those pixels (src/fractal-surface.js), which is what
// makes the opening read as a handful of blocks with a spiral cutting through
// them rather than as a handful of squares. As the lattice widens the cells
// shrink toward pixels and the silhouette itself becomes the picture.
//
// ---------------------------------------------------------------------------
// PANELS
//
// The field is a sequence of PANELS stacked in world rows. A panel is one
// picture - a Julia set for a constant chosen by the seed, or the Mandelbrot
// set - fitted to the widest lattice the ladder reaches. Its window is fitted
// to the set's own bounding box, so a panel is as tall as its picture and no
// taller; the rows are dealt from the bottom of the picture upward, because a
// row arrives at the top of the screen and everything already there moves
// down, so the first row dealt ends up lowest and the picture stands the right
// way up.
//
// A panel is fitted at the WIDEST width and every row is dealt CROPPED to the
// width the lattice has when that row arrives. The world column of a cell
// never changes, so a widening reveals the outer columns of the same picture
// instead of dealing a different one. The rows below stay cropped to the
// width they arrived at, which is what it looks like to pull a camera back
// over a strip that is still scrolling.
//
// ---------------------------------------------------------------------------
// MASS AND WEIGHT
//
// A cell samples the plane at a small grid of points. It is a block when
// enough of those points sit in the BAND around the set - at or past the
// panel's threshold iteration count, and escaped. The inside of the set, the
// black of the picture, is HOLLOW: it is where the swarm gets to go. Measured
// with the inside solid, the middle of every Julia set arrived as full rows
// across a narrow view and every tier above the first died at the same depth
// whether the player aimed or not. Hollow, the blocks are the filigree itself,
// the eyes of the spirals are rooms a body can get into, and a row is never a
// wall for long.
//
// The threshold is chosen per panel so that the band fills the window to a
// target share - a fat rabbit and a thin dendrite come out equally playable.
// The cell also carries a WEIGHT, how deep into the band it sits, and the
// row's health is shared by weight: the pale outer lace is many soft cells,
// the dark rim against the inside is fewer hard ones.
//
// EVERY ROW KEEPS SKY. A narrow view of the middle of a dense set is solid
// halo from edge to edge, and a solid row is a wall: a body strikes it once
// and comes home, where a row with holes lets the swarm in to ricochet.
// Measured on the shipped sets, the middle of a seahorse arrived as full rows
// for five turns running at ten columns. So a dealt row is guaranteed a share
// of its width open - `openShare` - and the cells that give way are its
// faintest, which is the outer halo being read as the sky it looks like. The
// picture under the field is untouched; only where a block stands changes.
//
// Everything here is a pure function of (seed, row). No draw happens at deal
// time; a row can be asked for again by a save or a test and it is the same
// row.
// ===========================================================================

import { CONFIG, leftEdgeAt } from '../config.js';

const LN2 = Math.LN2;

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
  // n + 1 - log2(log2 |z|). |z|^2 is what we have, so log|z| = log(r2) / 2.
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
    // Stood on end: the tail points down the screen. Alternate which way
    // round between visits so the picture is not the same twice.
    angle = (Math.floor(index / every) & 1) ? -Math.PI / 2 : Math.PI / 2;
  } else {
    kind = 'julia';
    // Never the same constant twice in a row, and the first panel of every
    // run is one of the spiral family, because that is the shape that says
    // what the field is made of.
    const pool = JULIA;
    let pick = hash(seed, index * 7 + 3) % pool.length;
    if (index === 0) pick = hash(seed, 11) % 3;
    const prev = index > 0 ? hash(seed, (index - 1) * 7 + 3) % pool.length : -1;
    if (index > 0 && pick === prev) pick = (pick + 1) % pool.length;
    const j = pool[pick];
    cr = j.re; ci = j.im; name = j.name;
    // A quarter turn one way or the other, or none: a Julia set is symmetric
    // through the origin, so this is orientation, not a different set.
    angle = [0, Math.PI / 2, -Math.PI / 2][hash(seed, index * 13 + 5) % 3];
  }
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const toPlane = (u, v) => [u * ca - v * sa, u * sa + v * ca];
  const iter = isMandel
    ? (u, v) => { const p = toPlane(u, v); return escape(0, 0, p[0], p[1], maxIter); }
    : (u, v) => { const p = toPlane(u, v); return escape(p[0], p[1], cr, ci, maxIter); };

  // --- fit the window to the set ------------------------------------------
  //
  // Scan picture space for everything that is near or inside the set, and
  // wrap the window around it. The scan is coarse and deterministic; it only
  // decides where the picture sits and how tall the panel is.
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

  // Width fits the columns exactly; the height follows at the same scale and
  // is clamped so a panel is neither a sliver nor a whole run.
  const dx = (u1 - u0) / cols;
  const minRows = Math.max(8, cfg.minRows | 0), maxRows = Math.max(minRows, cfg.maxRows | 0);
  let rows = Math.round((v1 - v0) / dx);
  rows = Math.min(maxRows, Math.max(minRows, rows));
  const vc = (v0 + v1) / 2;
  const top = vc - rows * dx / 2;          // picture row 0 starts here

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

  const p = { index, kind, name, cr, ci, angle, cols, rows, u0, dx, top, T, maxIter, iter, toPlane, masks: null };

  // --- the masks, and the trim ---------------------------------------------
  //
  // Every row's mask is built here, once, so the panel can be cut down to
  // where its mass actually is. The bottom is cut to the first row with a
  // block in the columns the view will have when the panel starts arriving -
  // a panel that opens with a dozen rows of sky in the middle of the picture
  // spends the whole opening dealing nothing, and the opening is where the
  // pull-back is supposed to start. The top is cut to the last row with any
  // mass at all.
  const all = [];
  for (let j = 0; j < rows; j++) all.push(maskRow(p, j, cfg));
  const sw = Math.max(1, Math.min(cols, startWidth | 0 || cols));
  const cLo = Math.floor((cols - sw) / 2), cHi = cLo + sw;
  const rowHas = (m, a, b) => { for (let c = a; c < b; c++) if (m.mask[c]) return true; return false; };
  let jBottom = rows - 1;
  while (jBottom > 0 && !rowHas(all[jBottom], cLo, cHi)) jBottom--;
  let jTop = 0;
  while (jTop < jBottom && !rowHas(all[jTop], 0, cols)) jTop++;
  // Never below the floor of what a panel may be.
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

/** The mask and weights of picture row j of a panel, at full width. */
function maskRow(p, j, cfg) {
  const samples = Math.max(1, Math.min(8, cfg.samples | 0 || 4));
  const massShare = Math.min(1, Math.max(0.05, Number(cfg.massShare) || 0.35));
  const cols = p.cols;
  const mask = new Uint8Array(cols), w = new Float32Array(cols);
  const v0 = p.top + j * p.dx;
  const step = p.dx / samples;
  const n = samples * samples;
  for (let c = 0; c < cols; c++) {
    const uc = p.u0 + c * p.dx;
    let hits = 0, sum = 0;
    for (let y = 0; y < samples; y++) {
      const v = v0 + (y + 0.5) * step;
      for (let x = 0; x < samples; x++) {
        const mu = p.iter(uc + (x + 0.5) * step, v);
        // In the band: past the threshold, and escaped. The inside is hollow.
        if (mu >= p.T && mu !== Infinity) { hits++; sum += depthOf(mu, p); }
      }
    }
    if (hits / n >= massShare) {
      mask[c] = 1;
      w[c] = 0.15 + 0.85 * (sum / hits);
    }
  }
  return { mask, w };
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
  const samples = Math.max(1, Math.min(8, cfg.samples | 0 || 4));
  const maxSolidRun = Math.max(1, cfg.maxSolidRun | 0 || 2);
  const openShare = Math.min(0.9, Math.max(0, Number(cfg.openShare) || 0));
  const boardW = CONFIG.board.width;
  const cell0 = boardW / CONFIG.board.cols;
  const descentPx = Math.max(4, Number(cfg.descentPx) || cell0);

  const panels = [];                 // built in order; panel k starts at row starts[k]
  const starts = [];
  const rowCache = new Map();        // R -> { mask: Uint8Array, w: Float32Array }
  const dealtRows = new Map();       // R -> { width, lo, r0 }
  let dealt = 0;                     // rows dealt so far; the next row is R = dealt
  let steps = 0;                     // times the board has stepped down
  let solidRun = 0;                  // consecutive full rows dealt

  function panelAt(k) {
    while (panels.length <= k) {
      const start = panels.length ? starts[panels.length - 1] + panels[panels.length - 1].rows + gap : 0;
      const p = makePanel(s, panels.length, cfg, cols, widthAt(start));
      panels.push(p); starts.push(start);
    }
    return panels[k];
  }

  /** Which panel and picture row a world row belongs to; null for a gap row. */
  function locate(R) {
    let k = 0;
    for (;;) {
      const p = panelAt(k);
      const start = starts[k];
      if (R < start) return null;                          // inside the gap before k
      if (R < start + p.rows) return { panel: p, k, j: p.rows - 1 - (R - start) };
      k++;
    }
  }

  /** Width the lattice has for row R. The ladder climbs one rung every
   *  `rungRows` rows and holds at the top. */
  function widthAt(R) {
    const rung = Math.floor(Math.max(0, R) / rungRows);
    return ladder[Math.min(rung, ladder.length - 1)];
  }

  /** The full-width mask and weights of world row R. A gap row is empty. */
  function rowOf(R) {
    let row = rowCache.get(R);
    if (row) return row;
    const at = locate(R);
    row = at ? at.panel.masks[at.j] : { mask: new Uint8Array(cols), w: new Float32Array(cols) };
    rowCache.set(R, row);
    return row;
  }

  /** One row cropped to a width: cells relative to the row's left edge, with
   *  the sky guarantee applied. The same for a deal and for a preview. */
  function crop(R, width) {
    const row = rowOf(R);
    const lo = leftEdgeAt(width);
    const cells = new Array(width), w = new Array(width);
    let solid = 0;
    for (let i = 0; i < width; i++) {
      const c = lo + i - panelLo;
      cells[i] = c >= 0 && c < cols ? !!row.mask[c] : false;
      w[i] = c >= 0 && c < cols ? row.w[c] : 0;
      if (cells[i]) solid++;
    }
    // The sky guarantee: open the faintest cells until enough of the row is
    // open. Ties go to the cell nearer the middle, so a lane opens where a
    // shot can use it rather than at the wall.
    const mustOpen = Math.ceil(width * openShare);
    if (width - solid < mustOpen) {
      const order = [];
      for (let i = 0; i < width; i++) if (cells[i]) order.push(i);
      const mid = (width - 1) / 2;
      order.sort((a, b) => (w[a] - w[b]) || (Math.abs(a - mid) - Math.abs(b - mid)) || (a - b));
      for (let k = 0; k < order.length && width - solid < mustOpen; k++) {
        cells[order[k]] = false; w[order[k]] = 0; solid--;
      }
    }
    return { cells, w, lo };
  }

  return {
    /** The next width the lattice wants. Read BEFORE the row, so the view can
     *  pull back to meet it. */
    width() { return widthAt(dealt); },

    /** Deal the next row: booleans across the current width, plus weights. */
    nextRow() {
      const width = widthAt(dealt);
      const R = dealt++;
      const out = crop(R, width);
      // THE BACKSTOP. A row that is solid across the view is a wall; two in a
      // row is a wall being built. The third gives up its lightest cell, so
      // there is always a way past while the rest is being broken. On the
      // pictures shipped here it fires rarely, which is the point.
      if (out.cells.every(Boolean)) {
        if (++solidRun > maxSolidRun) {
          let at = 0;
          for (let i = 1; i < width; i++) if (out.w[i] < out.w[at]) at = i;
          out.cells[at] = false; out.w[at] = 0;
          solidRun = 0;
        }
      } else solidRun = 0;
      dealtRows.set(R, { width, lo: out.lo, r0: steps });
      return Object.assign(out.cells, { w: out.w, R, lo: out.lo });
    },

    /** The board stepped down a row. Called by the mode's arrival so the
     *  picture can be placed under rows that have no blocks left. */
    stepped() { steps++; },

    /** Rows still to come at the width they will be dealt at, top first,
     *  without dealing them. */
    upcoming(n) {
      const out = [];
      for (let i = 0; i < Math.max(0, n | 0); i++) {
        const R = dealt + i;
        out.push(crop(R, widthAt(R)).cells);
      }
      return out;
    },

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

    /** The panel that owns row R, or null in a gap. Builds it if needed. */
    panelOf(R) { const at = locate(R); return at ? at.panel : null; },
    locate,
    panelAt,
    widthAt,
    rowOf,

    get dealt() { return dealt; },
    get steps() { return steps; },
    /** Restore after a save: rows are replayed with nextRow(); this puts the
     *  step counter where one step per row would have left it. */
    resync() { steps = Math.max(0, dealt - 1); dealtRows.forEach((d, R) => { d.r0 = R; }); },

    ladder: ladder.slice(),
    rungRows,
    cols,
    panelLo,
    samples,
    config: cfg,
    seed: s,
    names: JULIA.map(j => j.name).concat(['mandelbrot']),
  };
}

export default createFractalSource;
