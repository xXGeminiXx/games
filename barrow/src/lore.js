// ---------------------------------------------------------------------------
// The writing, chosen for this run.
//
// Every line the player reads comes out of a pool in content.js. Which entry
// of a pool a run uses is a hash of the run's seed and the pool's name, so a
// second barrow is not worded like the first one and neither reads as random
// noise: a given seed always says the same things in the same order.
//
// Nothing here knows what the game is doing. It is handed a key and some
// values and gives back a sentence.
// ---------------------------------------------------------------------------

import { CONTENT } from '../content.js?v=30';
import { pick } from './rng.js?v=30';
import { fill } from '../config.js?v=30';

/**
 * One line from a log pool.
 * @param {number} seed   the run seed
 * @param {string} key    a key in CONTENT.log
 * @param {object} [values]  holes to fill
 * @param {string} [salt]    varies the choice within a run, for lines that
 *                           fire more than once (a different layer, say)
 */
export function line(seed, key, values, salt) {
  const pool = CONTENT.log[key];
  if (!pool) return '';
  const chosen = Array.isArray(pool) ? pick(pool, seed, key + ':' + (salt || '')) : pool;
  return values ? fill(chosen, values) : chosen;
}

/** True when the writing has something to say for this key. */
export function has(key) {
  return !!CONTENT.log[key];
}

/**
 * A word used as a label rather than as part of a sentence.
 *
 * The materials are common nouns and are stored lower case, because that is
 * how they read inside a sentence: "The floor gives out onto amber." Every
 * panel that shows one as a value or a heading puts it through here, so the
 * one rule is: lower case in prose, capitalised everywhere else.
 */
export function label(word) {
  const s = String(word || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The other direction: a label used inside a sentence.
 *
 * The panels store their words capitalised because that is how a label reads.
 * A sentence that borrows one - "you were gone an hour, 1.1B coin" - needs it
 * back in lower case.
 */
export function inline(word) {
  const s = String(word || '');
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** The tag and the line for a seam id. */
export function seam(id) {
  return CONTENT.seams[id] || null;
}

/** The name and line for a rite id. */
export function rite(id) {
  return CONTENT.rites[id] || { name: id, line: '' };
}

/** The name and line for an oath id. */
export function oath(id) {
  return CONTENT.oaths[id] || { name: id, line: '' };
}

/** The visitor writing for a kind. */
export function visitor(kind) {
  return CONTENT.visitors[kind] || null;
}

/** Everything the seal panel says. */
export function seal() {
  return CONTENT.seal;
}

/** The chamber templates for a band, clamped to the bands that exist. */
export function chamberBand(band) {
  const bands = CONTENT.chambers.bands;
  return bands[Math.max(0, Math.min(bands.length - 1, band | 0))];
}

export { CONTENT };

/** The words for a lord of the dead. */
export function lord(id) {
  return (CONTENT.lords && CONTENT.lords[id]) || null;
}

/** The words for an affix a pass puts on a lord. */
export function affix(id) {
  return (CONTENT.affixes && CONTENT.affixes[id]) || { name: id, line: '' };
}

/** What a lord is called on his nth pass: nothing on the first. */
export function passTitle(n) {
  const d = CONTENT.doors;
  if (!d || !(n > 1)) return '';
  return d.passTitles[n - 1] || fill(d.passMany, { n });
}

/** The door, hoard and goal lines. */
export function doors() {
  return CONTENT.doors;
}

/** What a rank hands over. */
export function rankKey(id) {
  return (CONTENT.rankKeys && CONTENT.rankKeys[id]) || id;
}

/** The rooms written for one lord's ten, or none. */
export function lordRooms(id) {
  return (id && CONTENT.lordRooms && CONTENT.lordRooms[id]) || [];
}

/** The words for a hill. */
export function hill(id) {
  return (CONTENT.hills && CONTENT.hills[id]) || { name: id, line: '' };
}

/** The hill words as a whole, for the lines that are not one hill's. */
export function hills() {
  return CONTENT.hills || {};
}

