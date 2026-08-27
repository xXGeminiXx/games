// ---------------------------------------------------------------------------
// MODES - the two different fields the game can be played on
//
// A mode is nothing but a source of rows. Everything else - the swarm, the
// angle, the economy, the difficulty ladder, the renderer - is identical in
// both, which is the point: a mode changes what descends, never how the game
// is played.
//
// Two exist.
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
// The contract below is deliberately small. A third mode needs a width, a row,
// and a name, and it gets everything else for free.
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js';
import { createPatternSource } from './patterns.js';
import { createFormationSource } from './formations.js';

/**
 * A field source.
 *
 * @typedef {object} Field
 * @property {string} key         which mode built it
 * @property {boolean} widens     whether width() can change during a run
 * @property {boolean} sharesHealth  whether a row's health number is split
 *                                among the blocks in that row rather than
 *                                carried by each of them
 * @property {function(): number} width       columns the NEXT row wants
 * @property {function(number): boolean[]} nextRow   the next row, one entry per
 *                                column of width(), taken in order
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
      widens: true,
      sharesHealth: true,
      // The width is known before the row is, which is how the view learns it
      // has to pull back. A figure never changes width part way through.
      width() { return src.figure().width; },
      nextRow() { return src.nextRow(); },
      label() { return src.figure().name; },
      signature() {
        const f = src.figure();
        return { name: f.name, key: f ? (FIGURE_SIGS[f.key] || f.key) : null };
      },
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
 * @returns {Field}
 */
export function createField(id, seed, opts) {
  return BUILDERS[normaliseMode(id)](seed, opts || {});
}

export { FIGURE_SIGS };
export default createField;
