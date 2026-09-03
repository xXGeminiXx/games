// Vendored from the game-art foundation (lib/offline.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Offline catch-up.
//
// Depends on ./format.js for the summary wording (and format.js on bignum.js).
//
// THE BUG THIS MODULE IS SHAPED AROUND. The same offline-time fault shipped
// in three separate games. In each one, catch-up looked like this:
//
//     function catchUp(lastSeen, now) {
//       let seconds = (now - lastSeen) / 1000;
//       if (seconds > CAP) seconds = CAP;      // <- the whole bug
//       return seconds;
//     }
//
// The clamp is correct. The NAME is the bug. `seconds` leaves that function
// meaning the simulated time, but every caller reads it as the real time
// away, so the summary says "away 8h" to a player who was away three days,
// and any code that decides what to show, or how much to grant, or whether
// to congratulate, is quietly working from a number that means the other
// thing. Nobody catches it, because both meanings are seconds and both are
// plausible.
//
// So NOTHING here returns a bare number. catchUp returns an object whose
// fields are named for which quantity they are:
//
//     elapsed     real seconds between lastSeen and now
//     simulated   seconds the game will actually run (elapsed, capped)
//     capped      true when the cap bit, so the UI can say so
//     discarded   elapsed - simulated, the time being thrown away
//
// and the result also carries a `seconds` accessor that THROWS, because the
// mistake the three games made was reaching for exactly that name. It is
// non-enumerable, so JSON.stringify and object spread never trip it: only
// code that asks for `.seconds` does, and that code is asking the ambiguous
// question on purpose.
// ---------------------------------------------------------------------------

import { duration } from './format.js?v=4';

// Twelve hours. The point of a cap is that an idle game cannot pay out a
// week of production in one lump without wrecking its own curve; the number
// belongs to the game, this is only a starting value.
export const DEFAULT_CAP = 12 * 3600;

// How long a run of catch-up is allowed to take. 600 steps at 60 per second
// of simulated time is ten seconds of game time; the rest is folded in.
export const DEFAULT_MAX_STEPS = 600;

// Work out what happened while the tab was shut.
//
//   catchUp({ lastSeen, now, cap, step })
//
// lastSeen and now are epoch milliseconds (Date.now()). cap and step are in
// SECONDS, and both are named in the returned object so a caller never has
// to remember which unit a field is.
export function catchUp(opts = {}) {
  const now = opts.now === undefined ? Date.now() : Number(opts.now);
  const lastSeen = opts.lastSeen === undefined ? now : Number(opts.lastSeen);
  const cap = opts.cap === undefined ? DEFAULT_CAP : Math.max(0, Number(opts.cap));
  const step = opts.step === undefined ? 1 : Math.max(1e-6, Number(opts.step));

  let elapsed = (now - lastSeen) / 1000;
  // A clock that moved backwards (a timezone change, an NTP correction, a
  // player winding the system clock back) is not negative time away, it is
  // no time away. Going forwards is the cap's problem, not this one's.
  let clockWentBackwards = false;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    clockWentBackwards = elapsed < 0;
    elapsed = 0;
  }

  const simulated = Math.min(elapsed, cap);
  const result = {
    elapsed,
    simulated,
    capped: elapsed > cap,
    discarded: elapsed - simulated,
    cap,
    step,
    clockWentBackwards,
  };
  return guard(result);
}

// Make `.seconds` throw. This is the structural half of the fix: a comment
// asking the next author to pick a name is advice, and a getter that throws
// with the reason is a guardrail.
function guard(o) {
  Object.defineProperty(o, 'seconds', {
    enumerable: false,
    configurable: true,
    get() {
      throw new Error(
        'offline: there is no single "seconds". Use elapsed (real time away) ' +
        'or simulated (time the game will actually run). They differ whenever ' +
        'the cap bit, which is what `capped` reports.'
      );
    },
  });
  return o;
}

// Run a bounded number of simulation steps over `seconds` of game time.
//
//   simulate(fn, seconds, maxSteps)
//
// fn(stepSeconds, index) is called once per step. The step size is chosen so
// the number of calls never exceeds maxSteps no matter how long the player
// was away: past that point the steps get LONGER rather than more numerous,
// which is the trade every idle game makes and should make on purpose. The
// remainder is folded into the final step rather than dropped, so the total
// time handed to fn adds up to exactly `seconds` and nothing is lost to
// rounding.
//
// Returns { steps, stepSeconds, seconds, coarse } - coarse is true when the
// step had to grow past the one that was asked for, which is a fact the
// summary may want to mention.
export function simulate(fn, seconds, maxSteps = DEFAULT_MAX_STEPS, step = 1) {
  const total = Math.max(0, Number(seconds) || 0);
  const want = Math.max(1e-6, Number(step) || 1);
  const limit = Math.max(1, Math.floor(maxSteps));
  if (total <= 0) return { steps: 0, stepSeconds: want, seconds: 0, coarse: false };

  let stepSeconds = want;
  let steps = Math.floor(total / stepSeconds);
  let coarse = false;
  if (steps > limit) {
    stepSeconds = total / limit;
    steps = limit;
    coarse = true;
  }
  if (steps < 1) { steps = 1; stepSeconds = total; }

  const remainder = total - steps * stepSeconds;
  for (let i = 0; i < steps; i++) {
    // The last step carries whatever the division left over, so the sum of
    // the step sizes is exactly `total`.
    fn(i === steps - 1 ? stepSeconds + remainder : stepSeconds, i);
  }
  return { steps, stepSeconds, seconds: total, coarse };
}

// The sentence the player reads. Built from a catchUp result, so it cannot
// be built from the wrong number.
//
//   summary(catchUp({...}))
//     -> { away: '3d 4h', counted: '12h', capped: true,
//          text: 'away 3d 4h, 12h counted' }
export function summary(r, opts = {}) {
  if (!r || typeof r !== 'object' || typeof r.elapsed !== 'number') {
    throw new Error('offline.summary takes the object catchUp returns');
  }
  const min = opts.minSeconds === undefined ? 60 : opts.minSeconds;
  const away = duration(r.elapsed);
  const counted = duration(r.simulated);
  const worth = r.simulated >= min;
  let text;
  if (!worth) text = '';
  else if (r.capped) text = `away ${away}, ${counted} counted`;
  else text = `away ${away}`;
  return { away, counted, capped: r.capped, discarded: duration(r.discarded), worth, text };
}

// The whole sequence in one call, for the common case: work out the time,
// run the steps, hand back both the numbers and the sentence.
//
//   const r = resume({ lastSeen, now, cap }, (dt) => world.tick(dt));
//
// The returned object is the catchUp result with `run` (what simulate said)
// and `summary` attached, so a caller has one thing to pass around and every
// field on it still says which quantity it is.
export function resume(opts, fn) {
  const r = catchUp(opts);
  const run = simulate(fn, r.simulated, opts.maxSteps === undefined ? DEFAULT_MAX_STEPS : opts.maxSteps, r.step);
  r.run = run;
  r.summary = summary(r, opts);
  return r;
}

export default catchUp;
