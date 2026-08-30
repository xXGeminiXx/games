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

const KEY = 'brassrain:nights';
const SALT_KEY = 'brassrain:nights:salt';

// ---- keeping the board honest ------------------------------------------
//
// A night carries a signature over its fields, made with a salt that lives
// under its own key in the same store. A night edited by hand - a bigger
// round typed into the browser's storage - no longer matches its signature
// and is dropped when the board is read. Anyone who can read this file can
// forge one, so this stops a hand edit, not a determined liar; a board that
// is shared between players has to be settled by replaying the game from
// its seed and inputs, and that is a later build.
//
// A night also has to be possible: no pull pays more than a few dozen balls
// and no round takes fewer than a few dozen pulls, so balls won are bounded
// by pulls made and the round is bounded by pulls made.

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function canonical(n) {
  return [n.round, n.won, n.fevers || 0, n.launched || 0, n.machine || '', n.seed, n.at, n.cashed ? 1 : 0].join('|');
}

function saltOf(store) {
  const s = storeOf(store);
  try {
    let salt = s ? s.getItem(SALT_KEY) : null;
    if (!salt) {
      salt = Math.floor(Math.random() * 0xffffffff).toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
      if (s) s.setItem(SALT_KEY, salt);
    }
    return salt;
  } catch (e) { return 'salt'; }
}

/** A signature for any text, with this browser's salt - the save uses it too. */
export function signBlob(text, store) {
  return fnv(saltOf(store) + '#' + String(text)).toString(36);
}

/** The signature a night should carry in this browser. */
export function signature(night, store) {
  return fnv(saltOf(store) + '#' + canonical(night)).toString(36);
}

/** Whether a night is one this browser signed and one the game could have produced. */
export function honest(night, store) {
  if (!sound(night)) return false;
  const launched = Number(night.launched) || 0;
  if (launched > 0) {
    if (night.won > launched * 60) return false;          // no pull pays more than a few dozen balls
    if (night.round > 1 + launched / 20) return false;    // no round takes fewer than a few dozen pulls
  }
  if (night.round > 200 || night.won > 1e12) return false;
  // A night from a game whose save had been edited by hand does not count.
  if (night.trusted === false) return false;
  return night.sig === signature(night, store);
}

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
    return Array.isArray(list) ? list.filter(n => honest(n, store)).sort(compare) : [];
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
  if (sound(night)) night.sig = signature(night, store);
  // A night the game could not have produced is not placed, signed or not.
  if (!honest(night, store)) return { list: loadNights(store), rank: 0 };
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
