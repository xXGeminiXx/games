// ---------------------------------------------------------------------------
// Best nights.
//
// Every finished game is a night, and the best of them are kept: ranked by
// the round that ended them, then by the balls won on the way, then by who
// got there first. They live in this browser, beside the save, and they
// outlast a new game - a board that a fresh start wiped would be no board.
//
// Nothing here throws. A store that is full, disabled, or holding something
// that is not a list reads as an empty board.
// ---------------------------------------------------------------------------

const KEY = 'brass-rain:nights';

/** How many nights the board keeps. */
export const KEEP = 20;

function sound(n) {
  return !!n && typeof n === 'object' && Number.isFinite(n.round) && Number.isFinite(n.won);
}

function storeOf(store) {
  if (store) return store;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

/** The board as kept, best first. */
export function loadNights(store) {
  try {
    const s = storeOf(store);
    const raw = s ? s.getItem(KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(sound).sort(compare) : [];
  } catch (e) {
    return [];
  }
}

/** Better nights first: the round that ended it, the balls won, then the earlier one. */
export function compare(a, b) {
  return (b.round - a.round) || (b.won - a.won) || ((a.at || 0) - (b.at || 0));
}

/** The board with one more night on it, best first, no longer than it keeps. */
export function withNight(list, night) {
  const out = (Array.isArray(list) ? list.filter(sound) : []).concat(sound(night) ? [night] : []);
  out.sort(compare);
  return out.slice(0, KEEP);
}

/** Where a night stands on a board, counting from one; 0 when it is not on it. */
export function rankOf(list, night) {
  const i = list.findIndex(n => n === night || (n.at === night.at && n.seed === night.seed && n.round === night.round));
  return i < 0 ? 0 : i + 1;
}

/** Records a finished night and says where it landed. */
export function recordNight(night, store) {
  const list = withNight(loadNights(store), night);
  try {
    const s = storeOf(store);
    if (s) s.setItem(KEY, JSON.stringify(list));
  } catch (e) { /* a board that cannot be kept is still shown */ }
  return { list, rank: rankOf(list, night) };
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st. */
export function ordinal(n) {
  const v = Math.abs(n) % 100;
  const s = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th';
  return n + s;
}
