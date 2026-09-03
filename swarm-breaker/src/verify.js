// ---------------------------------------------------------------------------
// THE HONOUR BOARD: what a run writes down, and what anyone can check.
//
// A depth on a board is a claim. This module is the machinery that lets other
// players CHECK a claim instead of being asked to believe it, without a server
// that costs anything and without accusing anybody of anything.
//
// How it works, end to end:
//
//   1. While you play, the game writes down the seed and, per turn, the exact
//      direction the swarm was fired in and anything bought before that shot.
//      Nothing about the board is stored. The run is a few hundred bytes.
//   2. At the end, the game replays its own log through the same simulation
//      and hashes the result. The claim posted to the board is that depth,
//      that log, and that hash, signed by this device's key.
//   3. Any other player looking at the board can replay a top entry in their
//      own browser and post a signed verdict saying whether they got the same
//      hash. That is a WITNESS. An entry with witnesses says so.
//
// WHAT THIS IS NOT. It is not anti-cheat and it is not policing. Nothing is
// ever deleted, nobody is ever banned, and an entry whose hash does not
// reproduce is kept on the board and labelled, because the honest reasons for
// a mismatch (an older build, a browser that rounds differently, a bug of
// ours) are more likely than the dishonest one. The three states are
// descriptions, not verdicts about a person.
//
// The determinism this leans on is a property the game already had: the
// simulation is a fixed step driven by an integer seed, there is no Math.random
// in it and no wall clock reaches it. See docs/LEADERBOARD.md.
// ---------------------------------------------------------------------------

import { stateHash, hashHex } from './replay.js?v=20';

export const LOG_VERSION = 1;

// A run's log stops growing here. Three hundred turns is far past where a run
// ends in practice, and a log that hit the cap is submitted with the flag set
// and shown as UNVERIFIED rather than quietly checked against a partial run.
export const MAX_TURNS = 300;

// The serialized cap, which is the one that matters to the Worker's body
// limit. A turn is about fifty characters, so this is reached at roughly the
// same place as MAX_TURNS.
export const MAX_LOG_CHARS = 16384;

// How many purchases one turn may record. A bulk press is ONE entry with a
// count, so this is the number of different presses, not the number bought.
export const MAX_BUYS_PER_TURN = 24;

export const STATE = Object.freeze({
  unverified: 'unverified',
  witnessed: 'witnessed',
  mismatch: 'mismatch',
});

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

/**
 * The recorder a run carries.
 *
 * The kit's recorder (src/replay.js, from the game art foundation) takes one
 * 32-bit integer of input per tick, which is the right shape for a game whose
 * input is a bitfield of held keys. This game's input is not that: it is ONE
 * direction per turn, plus whatever was bought before the shot. So the shape
 * here is a turn list rather than a tick list, and it keeps the kit's rules
 * that matter - a hard cap, a truncated flag that travels with the log, and a
 * hash over the whole thing so a log cannot be swapped for another.
 *
 * The direction is stored as the two doubles the simulation actually consumed,
 * AFTER the aim clamp, because that is the number the run was played with.
 * Rounding it to something shorter would be recording a different shot.
 *
 * THE VIEW IS RECORDED WITH IT, and that is not decoration. The field widens
 * as a run goes on, and rather than move the blocks the view pulls back: the
 * size of a cell and the position of world column zero both EASE toward their
 * new values over about a second. Block centres are computed from that eased
 * pair, so it is part of the geometry a shot is fired against. It settles on
 * wall time, which means a player who fires the instant a turn opens took
 * their shot against a slightly different board than one who waited - both
 * legitimately. Writing the pair down is what makes the shot reproducible
 * without changing anything about how the game plays.
 */
export function createRunLog({ seed, mode, tier, build, daily = null } = {}) {
  const turns = [];
  let truncated = false;
  let pending = [];

  return {
    get turns() { return turns.length; },
    get truncated() { return truncated; },

    /** A purchase made before the next shot. Order is kept; it changes prices. */
    buy(id, count) {
      const n = Math.max(0, count | 0);
      if (!n || typeof id !== 'string') return;
      if (pending.length >= MAX_BUYS_PER_TURN) { truncated = true; return; }
      const last = pending[pending.length - 1];
      // Two presses of the same offer in a row are one entry, which is what
      // they are: the price is re-read per unit either way.
      if (last && last[0] === id) last[1] += n;
      else pending.push([id, n]);
    },

    /** The shot, exactly as the simulation took it. Closes the turn. */
    fire(x, y, cell, origin) {
      if (turns.length >= MAX_TURNS) { truncated = true; pending = []; return; }
      const turn = { d: [x, y], v: [cell, origin] };
      if (pending.length) turn.b = pending;
      pending = [];
      turns.push(turn);
    },

    /** Anything bought after the last shot, which no turn will consume. */
    tail() { return pending.slice(); },

    log() {
      const out = {
        v: LOG_VERSION,
        seed: seed >>> 0,
        mode: String(mode || ''),
        tier: String(tier || ''),
        build: String(build || ''),
        turns: turns.map(t => (t.b
        ? { d: t.d.slice(), v: t.v.slice(), b: t.b.map(p => p.slice()) }
        : { d: t.d.slice(), v: t.v.slice() })),
        truncated,
      };
      if (daily) out.daily = String(daily);
      if (JSON.stringify(out).length > MAX_LOG_CHARS) {
        // Cut from the end and say so, rather than posting something the
        // Worker will refuse and the player will never hear about.
        while (out.turns.length && JSON.stringify(out).length > MAX_LOG_CHARS) out.turns.pop();
        out.truncated = true;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// CHECKING A LOG BEFORE SPENDING ANY WORK ON IT
// ---------------------------------------------------------------------------

/** null when the log is replayable, otherwise a sentence saying what is wrong. */
export function validateLog(log, { maxTurns = MAX_TURNS } = {}) {
  if (!log || typeof log !== 'object') return 'the log is not an object';
  if (log.v !== LOG_VERSION) return `log version ${log.v} is not ${LOG_VERSION}`;
  if (!Number.isInteger(log.seed) || log.seed < 0 || log.seed > 0xffffffff) return 'the seed is not a uint32';
  if (typeof log.mode !== 'string' || !log.mode) return 'the log names no mode';
  if (typeof log.tier !== 'string' || !log.tier) return 'the log names no tier';
  if (!Array.isArray(log.turns)) return 'the log has no turns';
  if (log.turns.length > maxTurns) return `the log has ${log.turns.length} turns, over the ${maxTurns} cap`;
  for (let i = 0; i < log.turns.length; i++) {
    const t = log.turns[i];
    if (!t || !Array.isArray(t.d) || t.d.length !== 2) return `turn ${i + 1} has no direction`;
    const [x, y] = t.d;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return `turn ${i + 1} has a direction that is not a number`;
    // A direction the game could produce is a unit vector. Anything else was
    // not played, it was written.
    const len = Math.sqrt(x * x + y * y);
    if (!(Math.abs(len - 1) < 1e-6)) return `turn ${i + 1} has a direction of length ${len.toFixed(6)}, not 1`;
    if (!Array.isArray(t.v) || t.v.length !== 2) return `turn ${i + 1} records no view`;
    if (!Number.isFinite(t.v[0]) || !(t.v[0] > 0) || t.v[0] > 4096) return `turn ${i + 1} has an impossible cell size`;
    if (!Number.isFinite(t.v[1]) || Math.abs(t.v[1]) > 1e7) return `turn ${i + 1} has an impossible view origin`;
    if (t.b !== undefined) {
      if (!Array.isArray(t.b) || t.b.length > MAX_BUYS_PER_TURN) return `turn ${i + 1} has a bad purchase list`;
      for (const p of t.b) {
        if (!Array.isArray(p) || p.length !== 2) return `turn ${i + 1} has a malformed purchase`;
        if (typeof p[0] !== 'string' || !/^[a-z][a-z0-9_-]{0,15}$/.test(p[0])) return `turn ${i + 1} names a bad offer`;
        if (!Number.isInteger(p[1]) || p[1] < 1 || p[1] > 1e9) return `turn ${i + 1} buys a bad count`;
      }
    }
  }
  return null;
}

/**
 * The fingerprint of a log. Signed with the run, so the log that arrives is
 * provably the log that was played rather than one substituted for it.
 *
 * Doubles are folded in as their exact bytes, which is what makes a direction
 * that differs in its last bit a different log.
 */
export function logHash(log) {
  const head = [LOG_VERSION, log.seed >>> 0, log.turns.length, log.truncated ? 1 : 0];
  const nums = [];
  for (const t of log.turns) {
    nums.push(t.d[0], t.d[1], t.v[0], t.v[1]);
    const buys = t.b || [];
    nums.push(buys.length);
    for (const [id, n] of buys) {
      // The offer id folded in by its characters, so 'ball' and 'gain' differ.
      for (let i = 0; i < id.length; i++) nums.push(id.charCodeAt(i));
      nums.push(n);
    }
  }
  const text = `${log.mode}|${log.tier}|${log.build}|${log.daily || ''}`;
  for (let i = 0; i < text.length; i++) nums.push(text.charCodeAt(i));
  return hashHex(stateHash(Float64Array.from(head.concat(nums))));
}

/**
 * The fingerprint of a RESULT: what the run finished with, and how many blocks
 * each of its turns took down. The kills are in it because two runs can end on
 * the same depth for completely different reasons, and the turn by turn shape
 * is what a replay is really reproducing. Anything that differs anywhere in
 * the run shows up here.
 */
export function runHash({ depth, swarm, essence, doctrine, kills }) {
  const nums = [depth, swarm, essence, (kills || []).length];
  for (const k of kills || []) nums.push(k);
  const d = String(doctrine || 'none');
  for (let i = 0; i < d.length; i++) nums.push(d.charCodeAt(i));
  return hashHex(stateHash(Float64Array.from(nums)));
}

// ---------------------------------------------------------------------------
// THE SIGNED CLAIM
// ---------------------------------------------------------------------------

/**
 * The exact bytes a player signs when posting a run, and the exact bytes the
 * Worker rebuilds to check the signature. Both sides call THIS function; a
 * board test compares the two so a change to one that is not carried across
 * turns the suite red rather than silently rejecting every submission.
 *
 * Everything that decides where a run sits on a board is inside it: change the
 * depth, the tier, the build or the log and the signature stops matching.
 */
export function canonicalRun(entry) {
  return [
    'sb1',
    entry.tier,
    entry.mode,
    String(entry.seed >>> 0),
    String(entry.depth),
    String(entry.swarmLog),
    String(entry.essenceLog),
    entry.build,
    entry.playerId,
    entry.runHash,
    entry.logHash,
  ].join('|');
}

/** What a witness signs. The run hash is in it, so a verdict belongs to the
 *  exact run it was made about: a better run replaces the row, changes the
 *  hash, and starts collecting its own witnesses from nothing. */
export function canonicalWitness(w) {
  return ['sbw1', w.tier, w.crew || '', w.entryId, w.entryHash, w.verdict, w.witnessId].join('|');
}

// ---------------------------------------------------------------------------
// WHAT A BOARD ROW SAYS
// ---------------------------------------------------------------------------

/**
 * The three honest states, in the order a row is checked.
 *
 * MISMATCH wins over a count of agreements: if anybody replayed this run and
 * got a different answer, that is the thing worth showing, and it is shown
 * without the row being removed, moved, or marked as cheating. Most mismatches
 * will be a run played on an older build.
 */
export function entryState(entry) {
  if (!entry) return STATE.unverified;
  if ((entry.mismatch | 0) > 0) return STATE.mismatch;
  if ((entry.witnesses | 0) > 0) return STATE.witnessed;
  return STATE.unverified;
}

/** The words a player reads. Never an accusation, never a score. */
export function stateLabel(entry, text = {}) {
  const state = entryState(entry);
  if (state === STATE.mismatch) return text.mismatch || 'no replay match';
  if (state === STATE.witnessed) {
    const n = entry.witnesses | 0;
    return (text.witnessed || 'checked by N').replace('N', String(n));
  }
  return text.unverified || 'unchecked';
}

/** The longer sentence, for a title attribute or a details line. */
export function stateNote(entry, text = {}) {
  const state = entryState(entry);
  if (state === STATE.mismatch) {
    return text.mismatchNote
      || 'Someone replayed this run and reached a different result. Usually that means it was played on an older build. It keeps its place.';
  }
  if (state === STATE.witnessed) {
    const n = entry.witnesses | 0;
    return (text.witnessedNote || 'N other players replayed this run and got the same result.').replace('N', String(n));
  }
  if (entry && entry.truncated) {
    return text.truncatedNote || 'This run was too long to write down, so nobody can replay it. It keeps its place.';
  }
  if (entry && !entry.hasLog) {
    return text.noLogNote || "This run posted no replay, so there's nothing to check. It keeps its place.";
  }
  return text.unverifiedNote || 'Nobody has replayed this run yet.';
}

export default {
  LOG_VERSION, MAX_TURNS, MAX_LOG_CHARS, MAX_BUYS_PER_TURN, STATE,
  createRunLog, validateLog, logHash, runHash, canonicalRun, canonicalWitness,
  entryState, stateLabel, stateNote,
};
