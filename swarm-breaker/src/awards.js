// ===========================================================================
// AWARDS - the things a player has done, kept across runs
//
// WHAT THIS IS FOR, AND WHAT IT IS DELIBERATELY NOT.
//
// A run is thirty seconds to a few minutes and then it is gone. Everything the
// player built inside it - the swarm, the damage, the essence - goes with it,
// which is correct: that is what makes the next run a new decision rather than
// a continuation. But a game where nothing at all survives the run has no way
// of telling you that you are better at it than you were, and "am I getting
// better" is the question a player is actually asking.
//
// So exactly one thing survives: a list of things that have happened once. Not
// currency, not upgrades, not a power that makes the next run easier. An award
// changes nothing about how the game plays. It is a record, and its whole job
// is to be the shape of the ladder a player is climbing.
//
// THREE RULES, and they are what keep this from becoming a chore list:
//
//   1. Nothing here is a TASK. Every award is a thing that happens on the way
//      to playing well - deeper, bigger, cleaner - never a detour the player
//      has to make on purpose. There is nothing to grind and nothing to
//      remember to do.
//   2. Nothing here is missable. Every award is a threshold on a number that
//      only ever goes up, so no run can lock one away.
//   3. Nothing here is a notification the player has to deal with. Earning one
//      is a banner over the field for a second and a half and then it is gone.
//
// The words all live in config.js. What lives here is what each one MEASURES,
// which is the part that is code.
// ===========================================================================

import { CONFIG } from '../config.js?v=17';

/**
 * The tracks an award can be a threshold on.
 *
 * Every one of them is monotonic across a player's whole history - it is the
 * best they have ever managed, or a count of things that have happened - so an
 * award can never be missed and never has to be taken away again.
 */
const TRACKS = {
  depth:   'the deepest any run has reached',
  swarm:   'the largest swarm any run has held',
  essence: 'the most essence any one run has held',
  power:   'the most damage per hit any run has reached',
  clears:  'boards cleared to nothing, over every run',
  streak:  'the most boards cleared to nothing in a row',
  kinds:   'how many different special blocks have been broken',
  wins:    'tiers finished',
  modes:   'fields played',
};

/** An empty history. */
export function emptyProfile() {
  return {
    earned: [],                                  // award ids, in the order won
    best: { depth: 0, swarm: 0, essence: 0, power: 0, streak: 0 },
    clears: 0,
    wins: 0,
    kinds: [],                                   // distinct kind ids broken
    modes: [],                                   // distinct mode ids played
  };
}

/** Anything at all, coerced into a usable history. A corrupt store must never
 *  stop the game loading, and a missing field must read as "never done". */
export function normalise(raw) {
  const p = emptyProfile();
  if (!raw || typeof raw !== 'object') return p;
  const arr = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
  p.earned = arr(raw.earned);
  p.kinds = arr(raw.kinds);
  p.modes = arr(raw.modes);
  p.clears = num(raw.clears);
  p.wins = num(raw.wins);
  if (raw.best && typeof raw.best === 'object') {
    for (const k of Object.keys(p.best)) p.best[k] = num(raw.best[k]);
  }
  return p;
}

/** Every award this build offers, in the order they are shown. */
export function list() {
  const defs = (CONFIG.awards && Array.isArray(CONFIG.awards.list)) ? CONFIG.awards.list : [];
  return defs.filter(a => a && a.id && a.track in TRACKS && a.at > 0);
}

/** Where a history stands on one track. */
export function valueOf(profile, track) {
  const p = normalise(profile);
  switch (track) {
    case 'clears': return p.clears;
    case 'wins':   return p.wins;
    case 'kinds':  return p.kinds.length;
    case 'modes':  return p.modes.length;
    default:       return p.best[track] || 0;
  }
}

/**
 * Fold what a run has done into the history.
 *
 * Everything merged here is a MAXIMUM or a UNION, never a replacement, so
 * calling it twice with the same run cannot take anything away and calling it
 * mid-run is as correct as calling it at the end. That is what lets the game
 * check awards at any moment worth checking without keeping track of which
 * moments it has already checked.
 *
 * @param {object} profile  the stored history; not modified
 * @param {object} run      {depth, swarm, essence, power, streak, clears, won,
 *                           kinds: string[], mode: string}
 * @returns {object} a new history
 */
export function fold(profile, run) {
  const p = normalise(profile);
  const r = run || {};
  const up = (k, v) => { if (Number.isFinite(+v) && +v > p.best[k]) p.best[k] = Math.floor(+v); };
  up('depth', r.depth); up('swarm', r.swarm); up('essence', r.essence);
  up('power', r.power); up('streak', r.streak);

  // Counts are the run's own totals, and a run only ever grows them, so the
  // history keeps the largest it has seen from THIS run plus everything from
  // the ones before. Tracked as a per-run total rather than an increment so a
  // mid-run check cannot double count.
  if (Number.isFinite(+r.clears)) {
    p.clears = Math.max(p.clears, (r.clearsBefore || 0) + Math.floor(+r.clears));
  }
  if (r.won) p.wins = Math.max(p.wins, (r.winsBefore || 0) + 1);

  for (const k of (Array.isArray(r.kinds) ? r.kinds : [])) {
    if (typeof k === 'string' && !p.kinds.includes(k)) p.kinds.push(k);
  }
  if (typeof r.mode === 'string' && !p.modes.includes(r.mode)) p.modes.push(r.mode);
  return p;
}

/**
 * Which awards a history has now earned that it had not before.
 *
 * @returns {{profile: object, won: Array}} the updated history and the awards
 *          newly won, in list order
 */
export function settle(profile, run) {
  const p = fold(profile, run);
  const won = [];
  for (const a of list()) {
    if (p.earned.includes(a.id)) continue;
    if (valueOf(p, a.track) >= a.at) { p.earned.push(a.id); won.push(a); }
  }
  return { profile: p, won };
}

/** How far along an unearned award is, 0 to 1. For a progress readout. */
export function progressOf(profile, award) {
  if (!award || !(award.track in TRACKS)) return 0;
  return Math.max(0, Math.min(1, valueOf(profile, award.track) / award.at));
}

/**
 * A history that keeps itself, bound to one storage slot.
 *
 * Storage is allowed to be absent or broken - a private window, a full disk, a
 * browser that refuses - and the game has to keep working when it is, so every
 * read falls back to an empty history and every write is allowed to fail.
 */
export function createAwards(opts = {}) {
  const key = opts.key || 'awards';
  const store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);

  let profile = emptyProfile();
  try { if (store) profile = normalise(JSON.parse(store.getItem(key) || 'null')); } catch (e) {}

  function save() {
    try { if (store) store.setItem(key, JSON.stringify(profile)); } catch (e) {}
  }

  return {
    get profile() { return profile; },
    list,
    valueOf: (track) => valueOf(profile, track),
    progressOf: (award) => progressOf(profile, award),
    earned: (id) => profile.earned.includes(id),

    /**
     * Fold a run in and announce anything newly won.
     * @param {object} run   see fold()
     * @param {function} [onWin] called once per newly won award
     * @returns {Array} the awards newly won
     */
    check(run, onWin) {
      const out = settle(profile, run);
      profile = out.profile;
      if (out.won.length) save(); else save();
      if (typeof onWin === 'function') for (const a of out.won) onWin(a);
      return out.won;
    },

    /** Everything, with whether it is won and how far along it is. */
    report() {
      return list().map(a => ({
        ...a,
        won: profile.earned.includes(a.id),
        have: valueOf(profile, a.track),
        progress: progressOf(profile, a),
      }));
    },

    reset() { profile = emptyProfile(); save(); },
  };
}

export { TRACKS };
export default createAwards;
