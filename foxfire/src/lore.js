// ---------------------------------------------------------------------------
// Choosing the words.
//
// content.js holds pools; this picks from them. The pick is a hash of the
// organism's seed and the line's key (plus a salt for lines said more than
// once), so one organism always words a thing the same way and two organisms
// word it differently.
// ---------------------------------------------------------------------------

import { CONTENT } from '../content.js?v=9';
import { fill } from '../config.js?v=9';
import { hash } from './rng.js?v=9';
import { TEXT as EVENTS } from './events.js?v=9';

function walk(root, key) {
  let node = root;
  for (const part of String(key).split('.')) {
    node = node ? node[part] : undefined;
  }
  return node;
}

// The log first, then what happens to the ground. An "events.<name>" key names
// a pool under the events set; if the writing has none for it yet, the module
// that says the line keeps a plain one of its own.
function resolve(key) {
  const inLog = walk(CONTENT.log, key);
  if (inLog !== undefined) return inLog;
  const parts = String(key).split('.');
  if (parts.length === 2 && parts[0] === 'events') {
    return (CONTENT.events && CONTENT.events[parts[1]]) || EVENTS[parts[1]];
  }
  return walk(CONTENT.events, key);
}

/** One line from a pool, filled. An unknown key comes back as the key itself. */
export function line(seed, key, values, salt) {
  const pool = resolve(key);
  if (!pool) return String(key);
  const list = Array.isArray(pool) ? pool : [String(pool)];
  if (list.length === 0) return '';
  const i = hash(seed >>> 0, key + ':' + (salt === undefined ? '' : salt)) % list.length;
  return fill(list[i], values);
}

/** A short line from the furniture set, filled. */
export function ui(key, values) {
  const s = CONTENT.ui[key];
  return s === undefined ? String(key) : fill(s, values);
}

/** Names for a scale: the level and what its nodes are called. */
export function levelInfo(level) {
  const L = CONTENT.levels;
  if (level < L.length) return L[level];
  const n = level - L.length + 2; // the floor through the world are one world; beyond is the second
  const ord = CONTENT.ordinals[Math.min(n - 1, CONTENT.ordinals.length - 1)] || String(n) + 'th';
  const b = CONTENT.beyondLevel;
  return { name: fill(b.name, { n: ord }), wood: b.wood, soil: b.soil, root: b.root, many: b.many };
}

/** The noun for a node kind at a level. */
export function thing(level, kind) {
  const info = levelInfo(level);
  return info[kind] || kind;
}

export function trait(id) {
  return CONTENT.traits[id] || { name: id, line: '' };
}

export function genome(id) {
  return CONTENT.genome[id] || { name: id, line: '' };
}

/** First letter up. */
export function capital(s) {
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A label written for a heading, brought down for a sentence. */
export function inline(label) {
  return String(label).toLowerCase();
}
