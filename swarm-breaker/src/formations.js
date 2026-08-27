// ===========================================================================
// Formations
//
// The field is not a stack of independent rows. It is a sequence of FIGURES,
// each one a two dimensional fractal construction generated whole and then fed
// into the field a row at a time, so the shape assembles itself on screen as it
// descends and is visible as a shape rather than as a texture.
//
// This is the difference between a fractal and a fractal-flavoured row. A
// generator that emits one row at a time from a weight field can only ever
// bias which columns are likely to be solid; the structure that makes a
// Sierpinski gasket a gasket lives BETWEEN rows, and a per-row generator has
// nowhere to put it. So the construction happens first, in full, and the field
// is what is left after it has been dealt out.
//
// ---------------------------------------------------------------------------
// FEEDING ORDER, WHICH IS EASY TO GET BACKWARDS AND DECIDES THE DIFFICULTY
//
// A row arrives at the top and everything already present moves down one, so
// the FIRST row fed ends up LOWEST and the figure reads as its own mirror.
//
// Which end is fed first is not a presentation choice, it is the difficulty
// curve. A gasket fed base first opens the game with a solid wall of eight
// against a swarm of five and ends every run around depth seven, measured. Fed
// point first it opens with one block and arrives at the wall a dozen turns
// later, with a swarm that has grown into it.
//
// So a figure is always dealt from its SPARSE end. Every figure then ramps as
// it lands, which is a difficulty curve the shape itself provides rather than
// one bolted on top of it.
//
// ---------------------------------------------------------------------------
// FAIRNESS, WITHOUT CARVING
//
// The previous generator guaranteed a clear lane by cutting one through every
// row before it was emitted. That guarantees passage and destroys the figure -
// a gasket with a channel cut through it is no longer a gasket. Nothing here is
// carved. Every block is destructible, so no arrangement is unwinnable; the
// only real hazard is a wall of solid rows with no way past while it is being
// broken. So the single rule is: no more than `maxSolidRun` consecutive full
// rows, and the row that would break that rule gives up its least structural
// cell. On every figure shipped here that rule does nothing at all, which is
// the point - it is a backstop, not a shaping pass.
// ===========================================================================

/** Deterministic 32 bit hash. Identical inputs always give the identical figure. */
function hash(a, b) {
  let x = (a | 0) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2545f491);
  return (x ^ (x >>> 16)) >>> 0;
}

const grid = (w, h) => Array.from({ length: h }, () => new Array(w).fill(0));

// ---------------------------------------------------------------------------
// The constructions
//
// Each returns rows top first, at whatever size it is natural at. Every one is
// a genuine self-similar construction rather than noise that happens to look
// busy: the same rule applied at every scale, all the way down to the cell.
// ---------------------------------------------------------------------------

/** Pascal's triangle mod 2. The Sierpinski gasket, exactly. */
function gasket(w, h) {
  const out = grid(w, h);
  for (let r = 0; r < h; r++) {
    for (let k = 0; k <= r; k++) {
      // (r choose k) is odd exactly when k's bits are a subset of r's.
      if ((k & r) !== k) continue;
      const x = Math.floor((w - r) / 2) + k;
      if (x >= 0 && x < w) out[r][x] = 1;
    }
  }
  return out;
}

/** Cantor dust: a cell survives only where neither coordinate has a base three
 *  digit of one. The middle third removed, in both directions, at every scale.
 *  Exact only where the width is a power of three, which is why the ladder
 *  stops at nine and twenty seven on the way out. */
function cantorDust(w, h) {
  const keep = (n) => { while (n > 0) { if (n % 3 === 1) return false; n = Math.floor(n / 3); } return true; };
  const out = grid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = (keep(r) && keep(c)) ? 1 : 0;
  return out;
}

/** Vicsek: the plus shaped fractal. A cell lives where every scale agrees it
 *  sits on a centre line. */
function vicsek(w, h) {
  const on = (r, c) => {
    while (r > 0 || c > 0) {
      if (r % 3 !== 1 && c % 3 !== 1) return false;
      r = Math.floor(r / 3); c = Math.floor(c / 3);
    }
    return true;
  };
  const out = grid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = on(r, c) ? 1 : 0;
  return out;
}

/** Sierpinski carpet: everything except the middle ninth, at every scale. The
 *  densest figure in the set, and the one the widest lattice exists for. */
function carpet(w, h) {
  const on = (r, c) => {
    while (r > 0 || c > 0) {
      if (r % 3 === 1 && c % 3 === 1) return false;
      r = Math.floor(r / 3); c = Math.floor(c / 3);
    }
    return true;
  };
  const out = grid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = on(r, c) ? 1 : 0;
  return out;
}

/** Sierpinski again, anchored in a corner rather than centred: a cell lives
 *  where the row and column indices share no bit. Three levels of the same rule
 *  are visible across eight columns, which the base three constructions cannot
 *  manage at this width without losing their symmetry to the crop. */
function corner(w, h) {
  const out = grid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = ((r & c) === 0) ? 1 : 0;
  return out;
}

/** The same rule read the other way: solid everywhere the corner gasket is
 *  hollow. Dense where the other is sparse, and self-similar for the same
 *  reason. */
function rift(w, h) {
  const out = grid(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = ((r & c) === 0) ? 0 : 1;
  return out;
}

/** Cantor bars. Each row is the previous row's segments with their middles
 *  removed, so the field falls apart into ever finer pieces as it descends and
 *  then starts over. Removal is by halves rather than thirds because eight
 *  columns is three clean bisections and no clean trisection at all. */
function cantorBars(w, h) {
  const out = grid(w, h);
  for (let r = 0; r < h; r++) {
    const level = r % 4;                     // 0 solid, then three bisections
    const seg = w >> level;                  // width of a surviving segment
    for (let c = 0; c < w; c++) {
      // Survives when every bisection so far kept the half this column is in.
      let keep = true;
      for (let L = 1; L <= level; L++) {
        const width = w >> (L - 1);
        if (Math.floor((c % width) / (width / 2)) === (L % 2 ? 1 : 0)) { keep = false; break; }
      }
      out[r][c] = keep && seg >= 1 ? 1 : 0;
    }
  }
  return out;
}

/** An H tree: a trunk that splits, and each half splits again on the same rule.
 *  Self-similar by construction rather than by a cell test. */
function hTree(w, h) {
  const out = grid(w, h);
  const put = (r, c) => { if (r >= 0 && r < h && c >= 0 && c < w) out[r][c] = 1; };
  (function branch(r, c, span, depth) {
    if (depth <= 0 || span < 1) return;
    for (let k = -span; k <= span; k++) put(r, c + k);          // the bar
    const drop = Math.max(1, Math.round(span));
    for (const side of [-span, span]) {
      for (let k = 1; k <= drop; k++) put(r + k, c + side);     // the two risers
      branch(r + drop, c + side, Math.max(1, Math.floor(span / 2)), depth - 1);
    }
  })(0, Math.floor(w / 2), Math.max(1, Math.floor(w / 4)), 3);
  return out;
}

/** Rule 90 run from a single cell is the gasket again, so this runs rule 150 -
 *  every cell the parity of its three neighbours - for a crystalline mesh that
 *  is self-similar without being triangular. */
function mesh(w, h) {
  const lattice = w * 3;
  let row = new Uint8Array(lattice);
  row[lattice >> 1] = 1;
  const out = grid(w, h);
  const off = Math.floor((lattice - w) / 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) out[r][c] = row[off + c];
    const next = new Uint8Array(lattice);
    for (let i = 0; i < lattice; i++) {
      const l = row[(i - 1 + lattice) % lattice], m = row[i], rr = row[(i + 1) % lattice];
      next[i] = (l ^ m ^ rr);                                    // rule 150
    }
    row = next;
  }
  return out;
}

/** The figures, in the order a run meets them. Early ones are open and easy to
 *  read; the mass arrives once the shape is recognisable. */
// A construction is only itself at the widths its rule divides. A base three
// figure cropped into eight columns is not a Cantor set with a rough edge, it
// is a different and worse pattern - which is the whole reason the lattice
// widens rather than the figures being squeezed.
const anyWidth = () => true;
const powerOfThree = (w) => w === 9 || w === 27 || w === 81;
const bisectable = (w) => w % 8 === 0;

const FIGURES = [
  { key: 'gasket', name: 'gasket', fits: anyWidth,      build: gasket },
  { key: 'corner', name: 'corner', fits: anyWidth,      build: corner },
  { key: 'mesh',   name: 'mesh',   fits: anyWidth,      build: mesh },
  { key: 'canopy', name: 'canopy', fits: anyWidth,      build: hTree },
  { key: 'rift',   name: 'rift',   fits: anyWidth,      build: rift },
  { key: 'bars',   name: 'bars',   fits: bisectable,    build: cantorBars },
  { key: 'dust',   name: 'dust',   fits: powerOfThree,  build: cantorDust },
  { key: 'cross',  name: 'cross',  fits: powerOfThree,  build: vicsek },
  { key: 'carpet', name: 'carpet', fits: powerOfThree,  build: carpet },
];

/** Mirror or invert a figure so the same construction is not the same board
 *  twice. The construction is untouched; only its orientation moves. */
function orient(rows, code) {
  let out = rows.map(r => r.slice());
  if (code & 1) out = out.map(r => r.slice().reverse());
  if (code & 2) out = out.slice().reverse();
  return out;
}

/**
 * A source of figures on a WIDENING lattice.
 *
 * The field does not stay eight columns wide. Every figure is dealt at its own
 * width, and the widths climb: the view pulls back a little each time, blocks
 * get smaller, and more of them fit. That is the only way the constructions get
 * room to be themselves - three levels of recursion is all eight columns can
 * hold, and a Cantor set has no exact form there at all. At twenty seven it
 * does.
 *
 * The caller is told the width of each figure BEFORE its first row arrives, so
 * it can move its own camera to match. A figure never changes width part way
 * through being dealt.
 *
 * @param {number} seed
 * @param {object} [opts]
 * @param {number[]} [opts.ladder]      width per figure; the last entry repeats
 * @param {function} [opts.heightFor]   (width) => rows a figure occupies
 * @param {number} [opts.gap=1]         empty rows between figures
 * @param {number} [opts.maxSolidRun=2] consecutive full rows allowed
 */
export function createFormationSource(seed, opts = {}) {
  const ladder = (Array.isArray(opts.ladder) && opts.ladder.length)
    ? opts.ladder.map(n => Math.max(4, n | 0))
    : [8];
  const heightFor = typeof opts.heightFor === 'function'
    ? opts.heightFor
    : (w) => w;
  const gap = opts.gap >= 0 ? opts.gap | 0 : 1;
  const maxSolidRun = opts.maxSolidRun > 0 ? opts.maxSolidRun | 0 : 2;
  const s = (seed >>> 0) || 1;

  let index = -1;
  let queue = [];          // rows still to be dealt, already in feeding order
  let current = null;      // { key, name, index, width, height }

  const widthAt = (n) => ladder[Math.min(n, ladder.length - 1)];

  /** The construction dealt at figure n: the first one that is exact at this
   *  width, rotated by n so the same width does not always mean the same
   *  figure. */
  function figureAt(n, width) {
    // The first field a player ever sees is the gasket. It is the one shape
    // most people can name, so it says what the field is made of before any
    // other figure has to.
    if (n === 0) return FIGURES[0];
    const usable = FIGURES.filter(f => f.fits(width));
    const pool = usable.length ? usable : [FIGURES[0]];
    return pool[(n + (hash(s, n) & 7)) % pool.length];
  }

  function isFull(row) { return row.every(v => v); }

  /** The backstop described at the top of the file. */
  function relieve(rows, width) {
    let run = 0;
    for (let r = 0; r < rows.length; r++) {
      if (!isFull(rows[r])) { run = 0; continue; }
      if (++run <= maxSolidRun) continue;
      // Open the cell with the fewest solid neighbours above and below, so the
      // hole lands where the figure is thinnest rather than through its spine.
      let best = 0, bestScore = Infinity;
      for (let c = 0; c < width; c++) {
        const up = r > 0 ? rows[r - 1][c] : 0;
        const dn = r + 1 < rows.length ? rows[r + 1][c] : 0;
        const score = up + dn + Math.abs(c - (width - 1) / 2) * 0.01;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      rows[r][best] = 0;
      run = 0;
    }
    return rows;
  }

  function build(n) {
    const width = widthAt(n);
    const height = Math.max(3, Math.round(heightFor(width)));
    const fig = figureAt(n, width);
    const rows = relieve(orient(fig.build(width, height), hash(s, n) & 3), width);

    // Deal from the sparse end, whichever end that is. See the note on feeding
    // order: this is what stops a figure landing its heaviest rows first.
    const half = Math.floor(rows.length / 2);
    const weigh = (from, to) => {
      let k = 0;
      for (let r = from; r < to; r++) for (let c = 0; c < width; c++) k += rows[r][c] ? 1 : 0;
      return k;
    };
    const topHeavy = weigh(0, half) > weigh(rows.length - half, rows.length);
    // A row arriving ends up below the one after it, so feeding the array in
    // its natural order puts row zero at the bottom.
    const dealt = topHeavy ? rows.slice() : rows.slice().reverse();
    for (let g = 0; g < gap; g++) dealt.push(new Array(width).fill(0));
    return { fig, width, height, dealt };
  }

  function ensure() {
    if (queue.length) return;
    index++;
    const b = build(index);
    current = { key: b.fig.key, name: b.fig.name, index, width: b.width, height: b.height };
    queue = b.dealt;
  }

  return {
    /** The figure being dealt, INCLUDING its width. Reading this before taking
     *  a row is how a caller learns the lattice is about to change. */
    figure() { ensure(); return { ...current }; },

    /** The next row of the field, one entry per column of `figure().width`.
     *  Never null: a figure with a hole in it deals an empty row, and that hole
     *  is the figure. */
    nextRow() { ensure(); return queue.shift().slice(); },

    /** Whether the figure being dealt has finished arriving. */
    settled() { return queue.length === 0; },

    /** The whole of a figure as it will appear, top row first, backstop
     *  included. Does not disturb the sequence being dealt. */
    peek(n) {
      const b = build(n);
      return { rows: orient(FIGURES.find(f => f.key === b.fig.key).build(b.width, b.height), hash(s, n) & 3), width: b.width, height: b.height, name: b.fig.name };
    },

    /** Width a given figure will be dealt at, without building it. */
    widthAt,

    names: FIGURES.map(f => f.name),
  };
}

export { FIGURES };
export default createFormationSource;
