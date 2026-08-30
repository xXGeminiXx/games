// ===========================================================================
// ARRIVAL - how the field reaches the player, and what makes them lose
//
// The field is built on three separated axes. What it is MADE OF is a block
// kind. What decides its LAYOUT is a generator. This is the third one: how the
// field ARRIVES, and therefore where the pressure comes from.
//
// Descending rows are a clock. A block enters at the top, the whole field steps
// down one every turn, and the run ends when something crosses the line the
// swarm fires from. The player is racing a metronome they cannot slow, and
// every turn spent on the wrong angle costs a row of headroom.
//
// That clock is not the only way to press on someone. Take the motion away and
// nothing threatens anything, so the pressure has to come from somewhere else -
// and the honest answer is the board itself. Blocks appear where they appear
// and stay there. Nothing closes on the player; the field simply gets fuller,
// and the run ends when there is no room left. What is still standing is what
// is about to kill you, so clearing efficiently is the whole skill rather than
// a way of buying time.
//
// An arrival answers four questions and nothing else:
//
//   advance   what one turn of motion does to what is already on the board
//   lost      whether the run is over
//   pressure  how close that is, 0 to 1, for anything that wants to show it
//   readout   what the field has to say about itself, if anything
//
// Everything else - the swarm, the angle, the economy, the difficulty ladder,
// the renderer - is identical under every arrival. A new one needs those
// answers and gets the rest of the game for free.
// ===========================================================================

import { CONFIG } from '../config.js?v=17';

/**
 * What an arrival is shown of the board. Rows are measured in cells rather
 * than pixels so an arrival never has to know the size of anything: `rowsTall`
 * is how many rows fit between the top of the field and the swarm line, and it
 * is fractional because the field is not a whole number of cells tall.
 *
 * @typedef {object} BoardView
 * @property {Array}  blocks    live blocks, {c, r, ...}; MUTATED by advance()
 * @property {Array}  drops     live markers, {c, r, kind}; MUTATED by advance()
 * @property {number} cols      columns filling the screen
 * @property {number} lo        leftmost world column
 * @property {number} rowsTall  rows between the top of the field and the line
 */

/**
 * Rows a block may hold without the run being over.
 *
 * A block at row r has its lower edge (r + 1) rows below the top of the field,
 * so it has reached the line when r + 1 >= rowsTall. Rows 0 to safeRows - 1 are
 * therefore the whole of the playable field.
 */
export function safeRows(view) {
  return Math.max(1, Math.ceil(view.rowsTall) - 1);
}

/** Every cell of the playable field, whether or not something is in it. */
export function capacity(view) {
  return Math.max(1, view.cols * safeRows(view));
}

/** Cell key. Blocks and markers are indexed the same way, so one set answers
 *  "is anything standing here" for both. */
export const cellKey = (c, r) => c + ',' + r;

/** Everything currently standing in a cell, blocks and markers together. */
export function occupancy(view) {
  const taken = new Set();
  for (const b of view.blocks) taken.add(cellKey(b.c, b.r));
  for (const p of view.drops) taken.add(cellKey(p.c, p.r));
  return taken;
}

/**
 * Blocks a filling field may hold before the run is over.
 *
 * Deliberately well short of every cell. A completely sealed board is not
 * something a growing field ever reaches - growth needs somewhere to grow - so
 * a limit at the last cell would be a limit that never arrives, and the run
 * would end only when the player got bored. Set where it is, the board crossing
 * it is a real event a player can watch coming for several turns.
 */
export function fillLimit(view) {
  const cfg = CONFIG.bloom || {};
  const share = Math.min(1, Math.max(0.05, Number(cfg.fillShare) || 0.6));
  return Math.max(4, Math.round(capacity(view) * share));
}


// ---------------------------------------------------------------------------
// DESCENT - the original, and still the main game
//
// The field steps down one row a turn and the run ends when a block crosses the
// swarm line. Nothing here is new; it is the behaviour the game was tuned
// around, moved out of the turn loop so it can be one answer among several
// rather than the only thing the loop knows how to do.
// ---------------------------------------------------------------------------

const descend = {
  key: 'descend',

  /** The field closes on its own, so a turn spent badly costs headroom. */
  moves: true,

  advance(view) {
    for (const b of view.blocks) b.r++;
    for (const p of view.drops) p.r++;
    // A marker that reaches the line is gone. Without this they descend past
    // the canvas forever and the list grows for the whole run. One cell of
    // grace past the line, which is where it stops being drawn.
    const gone = view.rowsTall + 0.5;
    for (let i = view.drops.length - 1; i >= 0; i--) {
      if (view.drops[i].r >= gone) view.drops.splice(i, 1);
    }
    return true;
  },

  lost(view) {
    return view.blocks.some(b => b.r + 1 >= view.rowsTall);
  },

  pressure(view) {
    let deepest = -1;
    for (const b of view.blocks) if (b.r > deepest) deepest = b.r;
    return Math.min(1, Math.max(0, (deepest + 1) / Math.max(1, view.rowsTall)));
  },

  /** A marker that is not collected rides the field down and off the bottom of
   *  the screen, so they cannot pile up and nothing has to cap them, and none
   *  of them needs a clock of its own. */
  markerLimit() { return Infinity; },
  markerLife() { return Infinity; },

  /** A descending field has nothing to say about itself that the field is not
   *  already saying, so the readout keeps naming the generator. */
  readout() { return null; },
};


// ---------------------------------------------------------------------------
// SETTLING - the field does not come to you, it fills up around you
//
// Blocks land where the generator put them and stay there for as long as they
// have health. The run ends when the field holds more than it has room for.
// ---------------------------------------------------------------------------

const settle = {
  key: 'settle',

  /** Nothing moves on its own. A turn costs the player nothing but the shot. */
  moves: false,

  /**
   * Nothing standing moves. The one thing that does happen is that markers age.
   *
   * A marker in a descending field is a limited offer whether anyone designed
   * it that way or not: it enters at the top, rides down, and is gone in about
   * eight turns. THE SUPPLY LINE IS THE DIFFICULTY LADDER'S ONLY WORKING DIAL,
   * so a field that kept its markers forever would not be an easier version of
   * the same game, it would be a game the ladder no longer grips - every tier's
   * pickups eventually all get collected and the tiers converge.
   *
   * So markers age here too, on the same window, and the whole of a tier's
   * generosity still has to be taken inside it.
   */
  advance(view) {
    for (let i = view.drops.length - 1; i >= 0; i--) {
      const p = view.drops[i];
      if (p.t === undefined) continue;
      if (--p.t <= 0) view.drops.splice(i, 1);
    }
    return false;
  },

  lost(view) {
    return view.blocks.length >= fillLimit(view);
  },

  pressure(view) {
    return Math.min(1, view.blocks.length / fillLimit(view));
  },

  /** Turns a marker waits to be collected before it is gone. */
  markerLife() {
    const n = (CONFIG.bloom && CONFIG.bloom.markerTurns) | 0;
    return Math.max(1, n || 8);
  },

  /**
   * Markers the board may hold at once.
   *
   * A backstop, not a dial. The lifetime above is what actually bounds the
   * count; this only exists so that a configuration with a very long lifetime
   * cannot end up with a board of markers and nowhere to grow.
   *
   * IT MUST NOT BIND IN NORMAL PLAY. Set to four it did, and it silently
   * throttled the supply line: the generous tiers generate markers faster than
   * the cap allows, so their extra pickups were never delivered and swell and
   * undertow measured as the same tier.
   */
  markerLimit() {
    const n = (CONFIG.bloom && CONFIG.bloom.maxMarkers) | 0;
    return Math.max(1, n || 12);
  },

  /**
   * The fourth figure across the top of the screen. A descending field names
   * its generator there, which for a field that only ever runs one generator is
   * a word that never changes. How full the board is changes every turn and is
   * the only number that decides the run, so that is what it says instead.
   */
  readout(view) {
    const limit = fillLimit(view);
    return {
      value: view.blocks.length + '/' + limit,
      pressure: Math.min(1, view.blocks.length / limit),
    };
  },
};


const ARRIVALS = { descend, settle };

/** Every arrival this build knows how to run. */
export const ARRIVAL_IDS = Object.freeze(Object.keys(ARRIVALS));

/** An arrival by name. Anything unknown descends, because that is the game. */
export function arrivalOf(key) {
  return ARRIVALS[key] || descend;
}

export { descend, settle };
export default arrivalOf;
