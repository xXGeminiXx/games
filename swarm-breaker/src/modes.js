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
//   fractal   A whole construction is built first - a gasket, a mesh, a Cantor
//             set, a canopy - and then dealt downward a row at a time, so the
//             shape assembles on screen as it descends. The constructions are
//             exact only at particular widths, so the field widens as the run
//             goes on and the view pulls back to match.
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
      label(depth) { return src.nameFor(depth); },
      signature(depth) {
        const r = typeof src.regimeAt === 'function' ? src.regimeAt(depth) : null;
        return { name: src.nameFor(depth), key: r ? r.key : null };
      },
      source: src,
    };
  },

  fractal(seed, opts) {
    const src = createFormationSource(seed, opts && opts.formation);
    return {
      key: 'fractal',
      arrival: arrivalOf('descend'),
      widens: true,
      sharesHealth: true,
      // The width is known before the row is, which is how the view learns it
      // has to pull back. A figure never changes width part way through.
      width() { return src.figure().width; },
      nextRow() { return src.nextRow(); },
      arrive() {
        const width = src.figure().width;
        return rowArrival(src.nextRow(), width);
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
