// ---------------------------------------------------------------------------
// MODES - the fields the game can be played on
//
// A mode is a RECIPE, not a variant. It picks three things that are otherwise
// independent of each other, and everything else about the game is the same in
// all of them: the swarm, the angle, the economy, the difficulty ladder, the
// renderer, the block kinds.
//
//   ARRIVAL   how the field reaches the player, and what makes them lose.
//             src/arrival.js. Descending rows, or a board that fills.
//
//   LAYOUT    what decides where the blocks go. src/patterns.js runs cellular
//             automata a row at a time; src/formations.js builds a whole
//             fractal construction and deals it downward; src/bloom.js grows
//             out of whatever the player left standing.
//
//   WIDTH     how many columns, and whether that can change during a run.
//
// Three exist.
//
//   swarm     Eight columns, fixed, one row at a time from a cellular
//             automaton whose rule changes with depth. The field the game was
//             built around and the one it is tuned for.
//
//   fractal   The field is an escape-time picture - Julia sets and the
//             Mandelbrot set - fixed in world space and dealt downward a row
//             at a time. A block is a cell where the set has mass, its face is
//             the picture at pixel resolution, and the view pulls back over
//             the run until the whole set is on screen. src/fractal.js and
//             src/fractal-surface.js.
//
//   figures   The field this mode used to be: a whole geometric construction -
//             a gasket, a mesh, a Cantor set, a canopy - built first and dealt
//             downward, on a lattice that widens between figures. Off the menu
//             but still playable, so a save started on it still runs.
//
//   bloom     Nothing descends. Blocks accrete onto the mass already on the
//             board and stay where they land, and the run ends when the board
//             is full rather than when something reaches you.
//
// The contract below is deliberately small. A fourth mode needs an arrival, a
// layout and a name, and it gets everything else for free.
// ---------------------------------------------------------------------------

import { CONFIG, leftEdgeAt } from '../config.js';
import { createPatternSource } from './patterns.js';
import { createFormationSource } from './formations.js';
import { createFractalSource } from './fractal.js';
import { createFractalSurface } from './fractal-surface.js';
import { createBloomSource } from './bloom.js';
import { arrivalOf } from './arrival.js';

/**
 * A field source.
 *
 * @typedef {object} Field
 * @property {string} key         which mode built it
 * @property {object} arrival     how it reaches the player; see src/arrival.js
 * @property {boolean} widens     whether width() can change during a run
 * @property {boolean} sharesHealth  whether a row's health number is split
 *                                among the blocks in that row rather than
 *                                carried by each of them
 * @property {function(): number} width       columns the NEXT arrival wants
 * @property {function(number, object): {blocks: Array, open: Array}} arrive
 *                                what lands this turn, in WORLD columns, and
 *                                which free cells a marker may take
 * @property {function(number): string} label        name for the readout
 * @property {function(number): object} signature    {name, key} for the backdrop
 */

// The backdrop draws a signature per regime. Pointing each figure at the
// signature that echoes its construction makes the background agree with the
// field instead of arguing with it.
const FIGURE_SIGS = {
  gasket: 'sierpinski', corner: 'sierpinski', mesh: 'lattice',
  bars: 'cantor', canopy: 'growth', rift: 'chaos',
};

/**
 * Turn one row of on/off cells into the two lists a turn needs: where blocks
 * land, and which cells are free for a marker.
 *
 * A marker goes in a HOLE, never on top of a block. Both are drawn in the same
 * cell, and a ring laid over a health number leaves neither one readable.
 */
function rowArrival(cells, width) {
  const lo = leftEdgeAt(width);
  const blocks = [], open = [];
  for (let j = 0; j < cells.length; j++) {
    (cells[j] ? blocks : open).push({ c: lo + j, r: 0 });
  }
  return { blocks, open };
}

const BUILDERS = {

  swarm(seed, opts) {
    const src = createPatternSource(seed);
    const cols = Math.max(4, (opts && opts.cols) | 0 || CONFIG.board.cols);
    return {
      // The pattern source's own surface is kept reachable - rowFor, nameFor,
      // regimeAt, seed - because a row generated from a depth can be asked for
      // again, and the save fingerprint, the balance tools and the determinism
      // checks all do exactly that.
      ...src,
      key: 'swarm',
      arrival: arrivalOf('descend'),
      widens: false,
      sharesHealth: false,
      width() { return cols; },
      nextRow(depth) {
        const cells = src.rowFor(depth).slice();
        // A generator is allowed to produce nothing; a turn is not. An empty
        // field means the angle decides nothing, so one block is placed to
        // keep the turn worth taking.
        if (!cells.some(Boolean)) cells[(depth * 3) % cols] = true;
        return cells;
      },
      arrive(depth) { return rowArrival(this.nextRow(depth), cols); },
      // This field can be asked for any depth, so what is coming is simply the
      // next few rows.
      preview(depth, n) {
        const out = [];
        for (let i = 1; i <= Math.max(0, n | 0); i++) out.push(src.rowFor(depth + i));
        return { rows: out, lo: leftEdgeAt(cols) };
      },
      label(depth) { return src.nameFor(depth); },
      signature(depth) {
        const r = typeof src.regimeAt === 'function' ? src.regimeAt(depth) : null;
        return { name: src.nameFor(depth), key: r ? r.key : null };
      },
      source: src,
    };
  },

  fractal(seed, opts) {
    const src = createFractalSource(seed, opts && opts.fractal);
    // The ordinary descent, except that the source is told about every step.
    // The picture has to be drawn under rows whose blocks are all gone, and
    // the step count is the only thing that says where those rows are.
    const base = arrivalOf('descend');
    const arrival = Object.assign({}, base, {
      advance(view) {
        const moved = base.advance(view);
        if (moved) src.stepped();
        return moved;
      },
    });
    const cfg = src.config;
    const budgetBase = cfg.rowBudget > 0 ? Number(cfg.rowBudget) : CONFIG.economy.rowBlocks;
    const turnScale = Math.min(1, Math.max(0, Number(cfg.turnScale) || 0));
    return {
      key: 'fractal',
      arrival,
      widens: true,
      dealsSequence: true,
      sharesHealth: true,
      // One block's share of the tier number is bounded far more loosely than
      // the figure field's: a picture row can be forty cells, each a chip.
      shareBounds: {
        min: cfg.shareMin > 0 ? Number(cfg.shareMin) : CONFIG.economy.rowShareMin,
        max: cfg.shareMax > 0 ? Number(cfg.shareMax) : CONFIG.economy.rowShareMax,
      },
      /** Health one row is worth, as a multiple of the tier number, when `k`
       *  rows arrive in the same turn. See config fractal.turnScale. */
      budget(k) {
        const n = Math.max(1, k | 0);
        return budgetBase * Math.pow(n, turnScale) / n;
      },
      /** Rows this turn deals, so the field keeps its pace in pixels. */
      rowsPerTurn() { return src.rowsPerTurn(); },
      // The width is known before the row is, which is how the view learns it
      // has to pull back. It can change on any row here; the picture is fixed
      // in world columns, so a wider row is more of the same picture.
      width() { return src.width(); },
      nextRow() { return src.nextRow(); },
      arrive() {
        const width = src.width();
        const cells = src.nextRow();
        const out = rowArrival(cells, width);
        // Each block remembers the row it was cut from and how deep into the
        // set it sits. The first places its face on the picture, the second
        // decides its share of the row's health.
        for (const b of out.blocks) {
          b.R = cells.R;
          b.w = cells.w[b.c - cells.lo];
        }
        return out;
      },
      preview(depth, n) {
        return { rows: src.upcoming(n), lo: leftEdgeAt(src.width()) };
      },
      label() { return src.figure().name; },
      signature() { return { name: src.figure().name, key: 'fractal' }; },
      // What the blocks are made of. The block layer paints through this
      // instead of drawing materials.
      surface: createFractalSurface(src),
      source: src,
    };
  },

  figures(seed, opts) {
    const src = createFormationSource(seed, opts && opts.formation);
    return {
      key: 'figures',
      arrival: arrivalOf('descend'),
      widens: true,
      dealsSequence: true,
      sharesHealth: true,
      // The width is known before the row is, which is how the view learns it
      // has to pull back. A figure never changes width part way through.
      width() { return src.figure().width; },
      nextRow() { return src.nextRow(); },
      arrive() {
        const width = src.figure().width;
        return rowArrival(src.nextRow(), width);
      },
      // A figure is built whole before any of it is dealt, so the rows still to
      // come are already decided and can simply be looked at.
      preview(depth, n) {
        return { rows: src.upcoming(n), lo: leftEdgeAt(src.figure().width) };
      },
      label() { return src.figure().name; },
      signature() {
        const f = src.figure();
        return { name: f.name, key: f ? (FIGURE_SIGS[f.key] || f.key) : null };
      },
      source: src,
    };
  },

  bloom(seed, opts) {
    const src = createBloomSource(seed, opts && opts.bloom);
    const cols = Math.max(4, (opts && opts.cols) | 0 || CONFIG.board.cols);
    return {
      key: 'bloom',
      arrival: arrivalOf('settle'),
      widens: false,
      // Nothing here deals a row, so there is no row for a number to be shared
      // across. A block that appears alone in the middle of the board carries
      // the whole of the tier's number, exactly as it does in the main game.
      sharesHealth: false,
      width() { return cols; },

      /**
       * Where the field grows this turn, and where a marker may go.
       *
       * `view.bias` is the tier's density, which the other two layouts apply
       * inside their own generator. This one has no sequence of its own to be
       * dense or sparse in - it only has the board - so the bias becomes a
       * number of blocks here, against the mode's own budget.
       */
      arrive(depth, view) {
        const grown = src.grow(depth, view);
        // The cells the growth just claimed are no longer open, so a marker is
        // offered what is left after it rather than what was free before.
        const taken = new Set(grown.map(b => b.c + ',' + b.r));
        const open = src.openCells(depth, view).filter(p => !taken.has(p.c + ',' + p.r));
        return { blocks: grown, open };
      },

      // NOTHING CAN BE PREVIEWED HERE, and that is a property of the mode
      // rather than a gap. What arrives next is decided by what is on the board
      // when the turn ends, and the turn has not been taken yet - the player's
      // own shot is the input. Saying so is better than guessing.
      preview() { return null; },

      label() { return src.name; },
      // Growth on screen, growth behind it. The backdrop's branching signature
      // is the same process this field is running, which is the one case in the
      // game where the scenery and the field are literally the same rule.
      signature() { return { name: src.name, key: 'growth' }; },
      source: src,
    };
  },

};

/** Every mode id, in the order they are offered. */
export const MODE_IDS = Object.freeze(
  (CONFIG.modes && Array.isArray(CONFIG.modes.list) ? CONFIG.modes.list : [])
    .map(m => m.id)
    .filter(id => id in BUILDERS)
);

/** The mode a fresh install plays. */
export const DEFAULT_MODE =
  (CONFIG.modes && MODE_IDS.includes(CONFIG.modes.default)) ? CONFIG.modes.default
  : (MODE_IDS[0] || 'swarm');

/** Its entry from config, or null. Words live there, behaviour lives here. */
export function modeOf(id) {
  if (!CONFIG.modes || !Array.isArray(CONFIG.modes.list)) return null;
  return CONFIG.modes.list.find(m => m.id === id) || null;
}

/** Whether a string names a mode this build can actually play. */
export function isMode(id) {
  return typeof id === 'string' && MODE_IDS.includes(id);
}

/** Coerce anything to a playable mode id. */
export function normaliseMode(id) {
  return isMode(id) ? id : DEFAULT_MODE;
}

/**
 * Build the field source for a run.
 *
 * @param {string} id    mode id; anything unknown falls back to the default
 * @param {number} seed  the run's field seed
 * @param {object} [opts]
 * @param {number} [opts.cols]       fixed width, for modes that do not widen
 * @param {object} [opts.formation]  options for the formation source
 * @param {object} [opts.bloom]      options for the growth source
 * @returns {Field}
 */
export function createField(id, seed, opts) {
  return BUILDERS[normaliseMode(id)](seed, opts || {});
}

export { FIGURE_SIGS };
export default createField;
