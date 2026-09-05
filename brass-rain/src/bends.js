// ---------------------------------------------------------------------------
// The machine leans its own nails.
//
// Bending is what this game is about and it was the last thing left that
// quietly cost a player who never did it: three leans a round, worth about a
// quarter more balls through the slot, needing a drag on the face that nothing
// did for them. So the machine does it, and a drag of your own still overrides
// it exactly the way it always did.
//
// WHAT IS MEASURED, and how: every legal lean of the nails nearest a slot,
// eight directions, walked in from full reach until the board accepts it, the
// best kept, three deep. Judged on one stream of balls, then CONFIRMED on a
// stream it was never chosen against - which is the only way to tell a lean
// that works from a lean that happened to suit the balls it was picked on.
//
// WHAT IT IS WORTH, over 47 faces (2026-09-05, the fitted board at the
// resting power, every face judged on 2500 balls of a stream the search never
// saw): the slot rate goes to a MEDIAN 1.121x, mean 1.134x, better on 36 of
// the 47 and WORSE ON 8, worst 0.900x, best 1.444x; what the pockets pay is a
// wash at median 1.003x. So it is worth having and it is not free: roughly one
// face in six comes out a little worse, and no honest reading of it says
// otherwise.
//
// That last sentence is here because the number it replaced said the opposite.
// An earlier note recorded "about 1.3x on every board it was tried on" from
// ten faces measured in one sitting, and at 47 faces that is simply not what
// the search does. Anything quoted here from fewer than about forty faces is a
// reading of one afternoon, not a property of the module.
//
// WHAT DOES NOT HELP, so nobody spends another evening on it: a SECOND
// held-out confirmation. The reasoning for it is sound - the first
// confirmation takes the first of up to SHORTLIST candidates to clear
// CONFIRM_EDGE against one reading, so it is still choosing on the balls it is
// scoring on - and on ten faces it looked like it removed every loss. Over the
// same 47 faces it does nothing: median 1.076x against 1.121x, better on 14
// faces and worse on 17, the SAME eight losses, worst 0.906x against 0.900x,
// paired difference -0.013 (t = -0.65 on 46 df). It also rejects fifteen leans
// that were fine and more than doubles the dearest slice, 325 ms to 754 ms.
// The idea is reasonable and the evidence says no.
//
// So the sample size is the whole thing, and this module keeps the same
// discipline the measurement used: a candidate is SCREENED cheaply, and the
// winner of the screen is then CONFIRMED against the plain board on a second
// stream before it is allowed anywhere near the face. A screen is allowed to
// be noisy; the confirmation is what decides.
//
// It runs in slices while the workbench is open, on a board of its own - never
// the one being drawn, or the nails would jitter as candidates were tried and
// put back. A slice is a handful of readings and one reading is indivisible,
// so a slice is a fraction of a second rather than a frame: measured across
// 47 faces, the dearest single slice was 325 ms and the median whole search
// 4.0 seconds on a quiet machine; the same slice measured 471 ms across seven
// faces while the machine was busy. Nothing is animating at the workbench,
// which is why the search lives there and nowhere else.
//
// What it keeps depends on the face and on nothing else. It used to depend on
// how busy the machine was, because a reading was bounded by a wall clock;
// see WORK_PER_BALL.
// ---------------------------------------------------------------------------

import { bendCheck, bendNail } from './board.js?v=73';
import { createBalls, launch, stepPhysics } from './physics.js?v=73';
import { rng } from './rng.js?v=73';

/** Nails nearest each slot that the screen will try. */
export const NEAR_NAILS = 16;
/**
 * Balls a candidate is screened on.
 *
 * Cheap and noisy on purpose, and cheap is a hard requirement: one measurement
 * is one indivisible piece of work inside a frame, and at 460 balls on a real
 * face that piece took forty milliseconds, which is three frames dropped every
 * time. The shortlist and the confirmation below are what make a noisy screen
 * safe.
 */
export const SCREEN_BALLS = 180;
/** How many of the screen's best are put to the confirmation, in order. */
export const SHORTLIST = 8;
/** Balls the winner of a screen is confirmed on, twice: with and without. */
export const CONFIRM_BALLS = 700;
/** How much better the confirmation has to read before a lean is kept. */
export const CONFIRM_EDGE = 1.02;
/** Physics steps one measurement may take before it is called finished. */
const STEP_CAP = 2500;
/**
 * The most work one measurement may do, counted per ball it was given.
 *
 * The physics costs a step for every ball still falling, so what a reading
 * costs is not the number of steps it takes but the balls carried through
 * them. A lean that traps a hundred balls in a pocket keeps the whole field
 * live for the whole step cap, which measured at ELEVEN AND A HALF SECONDS
 * inside one frame. The bound therefore goes on that product - balls carried,
 * summed over steps - which is the thing the cost is proportional to.
 *
 * It replaces a wall clock, and the wall clock was the bug. A reading bounded
 * by a clock is a different reading on a busy machine than on an idle one, so
 * the same face searched twice found different leans: seed 7, twice in one
 * process, kept one lean and then three. And the clock was firing on healthy
 * faces as a matter of course - a plain 700 ball reading costs 326,000 to
 * 405,000 ball-steps and ran 174 to 630 ms against a 200 ms cap - so most
 * confirmations were being decided on a clipped sample. A budget counted in
 * work does what the clock was there to do and gives the same answer on every
 * machine.
 *
 * Set at about 1.7x the dearest healthy reading measured, so an ordinary one
 * never touches it and a trapped face is still stopped well short of the step
 * cap.
 */
export const WORK_PER_BALL = 1000;
/**
 * Steps with nothing resolving before a measurement gives up.
 *
 * A lean can build a pocket between brass and steel that a ball fits into and
 * cannot fall out of. Those balls never resolve, so the run went the whole
 * step cap every time, and one measurement of a trapped board took eleven and
 * a half SECONDS inside a single frame. The stuck balls are still counted as
 * balls that reached nothing, which is what they are, so a lean that traps
 * them scores badly and is thrown out on its own merits.
 */
const STALL_STEPS = 260;

const DIRECTIONS = 8;
/** The most pieces of work one slice may do, however fast they look. */
const TICKS_PER_SLICE = 8;
/** How far along a direction to try, as shares of the head's reach. */
const REACH_STEPS = [1, 0.68, 0.45, 0.28];

/** The slots on a face: the mouths that spin the reels. */
function slotsOf(board) {
  return board.pockets.filter(p => p.kind === 'gate');
}

/** Nails above a slot, nearest first. */
function nearest(board, slot, n) {
  const out = [];
  for (let i = 0; i < board.nails.length; i++) {
    const nail = board.nails[i];
    if (nail.y0 >= slot.y - 0.5) continue;
    out.push({ i, x0: nail.x0, y0: nail.y0, d: Math.hypot(nail.x0 - slot.x, nail.y0 - (slot.y - 3)) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, n);
}

/**
 * Sends a run of balls down a board and says what share reached a slot.
 *
 * The stream is named, so the same name is the same balls every time and two
 * boards can be compared on identical balls; a different name is a different
 * set of balls, which is what a confirmation needs.
 */
export function measure(cfg, board, stream, balls, strength, workPerBall) {
  const r = rng(stream);
  const b = createBalls(balls + 8);
  for (let i = 0; i < balls; i++) launch(cfg, b, strength, (r.next() * 2 - 1) * cfg.launch.spread, 1);
  const out = { events: [], flashes: [], marks: [], flashCap: 0 };
  let steps = 0;
  let stall = 0;
  let live = b.n;
  let work = 0;
  const per = Number.isFinite(workPerBall) && workPerBall > 0 ? workPerBall : WORK_PER_BALL;
  const workCap = per * Math.max(1, balls);
  while (b.n > 0 && steps < STEP_CAP && stall < STALL_STEPS && work < workCap) {
    work += b.n;
    stepPhysics(cfg, board, b, cfg.physics.step, r.next, out);
    out.flashes.length = 0;
    steps++;
    if (b.n < live) { live = b.n; stall = 0; } else stall++;
  }
  let gates = 0, paid = 0, total = 0;
  for (const e of out.events) {
    total++;
    if (e.kind === 'gate') gates++;
    else if (e.pay > 0) paid += e.pay;
  }
  return { gate: total ? gates / total : 0, back: total ? paid / total : 0, resolved: total };
}

/**
 * A search for leans, run a few milliseconds at a time.
 *
 * `board` is the planner's own: it is bent and unbent hundreds of times and
 * must never be the board on screen. Hand it a fresh one built from the same
 * seed with the same leans already on it.
 */
export function makePlanner(cfg, board, opts = {}) {
  let budget = Math.max(0, Math.floor(opts.budget === undefined ? 3 : opts.budget));
  const strength = Number.isFinite(opts.strength) ? opts.strength : cfg.launch.strength;
  const seed = opts.seed === undefined ? 0 : opts.seed;
  const screenBalls = opts.screenBalls || SCREEN_BALLS;
  const confirmBalls = opts.confirmBalls || CONFIRM_BALLS;
  const reach = cfg.board.bendReach;

  const dirs = [];
  for (let k = 0; k < DIRECTIONS; k++) {
    dirs.push([Math.cos((k * 2 * Math.PI) / DIRECTIONS), Math.sin((k * 2 * Math.PI) / DIRECTIONS)]);
  }

  /**
   * How far a nail will actually go that way.
   *
   * Full reach is not always legal: a head that will lean two units cannot
   * lean two units into the nail beside it, and how far it reaches depends on
   * what the machine is carrying. Leaning at full reach only found nothing at
   * all on the real face - every candidate refused, nothing measured, and the
   * workbench reporting that it had tried. So each direction is walked in from
   * as far as the head goes until the board accepts it.
   */
  function landing(index, x0, y0, ux, uy) {
    for (const share of REACH_STEPS) {
      const x = x0 + ux * reach * share;
      const y = y0 + uy * reach * share;
      if (bendCheck(cfg, board, index, x, y).ok) return { x, y };
    }
    return null;
  }

  // Every nail worth trying, once, nearest a slot first.
  const seen = new Set();
  const nails = [];
  for (const slot of slotsOf(board)) {
    for (const o of nearest(board, slot, NEAR_NAILS)) {
      if (seen.has(o.i)) continue;
      seen.add(o.i);
      nails.push(o);
    }
  }

  const applied = [];
  const taken = new Set();
  let round = 0;              // which of the `budget` leans is being looked for
  let at = 0;                 // where the screen has got to
  let baseGate = null;        // the screen's reading of the board as it stands
  let shortlist = [];         // the screen's best few, best first
  let plainGate = null;       // the board as it stands, on the confirming stream
  let done = nails.length === 0 || budget === 0;
  let tried = 0;

  function screenStream() { return 'lean:' + seed + ':' + round; }
  function confirmStream() { return 'held:' + seed + ':' + round; }

  /** One unit of work. Returns whether there is more to do. */
  function tick() {
    if (done) return false;
    if (baseGate === null) {
      baseGate = measure(cfg, board, screenStream(), screenBalls, strength).gate;
      return true;
    }
    if (at < nails.length * dirs.length) {
      const o = nails[Math.floor(at / dirs.length)];
      const [dx, dy] = dirs[at % dirs.length];
      at++;
      if (taken.has(o.i)) return true;
      const spot = landing(o.i, o.x0, o.y0, dx, dy);
      if (!spot) return true;
      const x = spot.x, y = spot.y;
      bendNail(cfg, board, o.i, x, y);
      const g = measure(cfg, board, screenStream(), screenBalls, strength).gate;
      bendNail(cfg, board, o.i, o.x0, o.y0);
      tried++;
      if (g > baseGate) {
        // The screen keeps a few, not one. On this few hundred balls the very
        // best score is as likely to be the luckiest as the truest, and a
        // single nomination meant a real lean sitting second was never put to
        // the confirmation at all.
        shortlist.push({ i: o.i, x, y, x0: o.x0, y0: o.y0, gate: g });
        shortlist.sort((a, b) => b.gate - a.gate);
        if (shortlist.length > SHORTLIST) shortlist.length = SHORTLIST;
      }
      return true;
    }
    // The screen is finished. Its picks go to a stream none of them was ever
    // chosen against, one at a time, against the board as it actually stands.
    if (plainGate === null) {
      plainGate = measure(cfg, board, confirmStream(), confirmBalls, strength).gate;
      return true;
    }
    if (shortlist.length) {
      const pick = shortlist.shift();
      bendNail(cfg, board, pick.i, pick.x, pick.y);
      const bent = measure(cfg, board, confirmStream(), confirmBalls, strength).gate;
      if (bent >= plainGate * CONFIRM_EDGE && bent > 0) {
        applied.push([pick.i, pick.x, pick.y]);
        taken.add(pick.i);
        round++;
        at = 0;
        baseGate = null;
        plainGate = null;
        shortlist = [];
        if (applied.length >= budget) done = true;
        return !done;
      }
      // It did not hold. The nail goes back and the next one is tried.
      bendNail(cfg, board, pick.i, pick.x0, pick.y0);
      return true;
    }
    // Nothing the screen liked survived the confirmation, so the face is left
    // exactly as the player set it.
    done = true;
    return false;
  }

  return {
    /** Works for about `ms` milliseconds and says where it got to. */
    step(ms, now) {
      const clock = typeof now === 'function' ? now : () => Date.now();
      const until = clock() + Math.max(0, ms || 0);
      // Two bounds, and both are needed. The clock stops a slice that has used
      // its share of the frame; the count stops a slice whose first piece of
      // work overran, which measured at nearly three seconds in one frame with
      // the clock alone. A slice is now at most a handful of readings.
      // At least one piece of work every call, whatever the budget. Checking
      // the clock first meant a tight budget did nothing at all, for ever: a
      // caller asking for a millisecond got no progress rather than a little.
      let guard = 0;
      do { tick(); } while (!done && clock() < until && ++guard < TICKS_PER_SLICE);
      return { done, applied: applied.slice(), tried, looking: round + 1, of: budget };
    },
    /**
     * Lets it look for `n` more leans on top of what it has already kept.
     *
     * The workbench closes when the player is ready, not when the search is,
     * so a search picked up next round carries on rather than starting over.
     */
    more(n) {
      const want = applied.length + Math.max(0, Math.floor(n || 0));
      if (want <= budget) return;
      budget = want;
      done = nails.length === 0;
    },
    /** Everything it has decided to lean so far. */
    plan() { return applied.slice(); },
    done() { return done; },
    tried() { return tried; },
  };
}
