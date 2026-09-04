// ---------------------------------------------------------------------------
// The line under the board.
//
// One sentence, recomputed every frame, naming the single thing most worth
// doing right now and the numbers behind it. It replaces a fixed opening
// sentence that froze after the seventh ball and never spoke again, so a
// player who was losing was told nothing about why or what to move.
//
// Two halves, kept apart so both can be tested. `pick` ranks the state and
// returns a key with the numbers behind it; `write` turns one of those into a
// sentence. Every branch of `pick` ends in a literal `say('key', ...)`, so the
// suite can read the keys straight out of this file and hold LINES to exactly
// that set - a key with no sentence and a sentence never reached are both
// failures.
//
// The ranking is the hard part and it is the design's own view of the game:
// what is on the board and about to close comes before what is in a panel,
// what teaches the round comes before what fine-tunes it, and the handle comes
// before the pace line, because moving the handle is the answer the pace line
// is asking for.
//
// THE HANDLE READING is the one figure here that is not already on a plaque.
// It is the only control a round has, the gap between its best setting and its
// worst is most of what a machine pays, and nothing ever told a player that a
// setting they had already tried was doing better than the one they were on.
// `makeCompass()` keeps a running count of balls sent and balls through the
// slot for each tenth of the handle, taken from counters the run already
// keeps. A ball is credited to the setting the handle is on when it lands,
// which is the setting it was sent at except in the second or two after the
// slider moves; a setting is not quoted until it has BAND_MIN balls behind it,
// which is far more than that drift. Nothing here is saved, and the game never
// plays from it.
// ---------------------------------------------------------------------------

import { num } from './format.js?v=69';

/** How wide a slice of the handle counts as one setting. */
export const BAND_STEP = 0.1;
/** Balls a setting needs behind it before its number is quoted. */
export const BAND_MIN = 40;
/** How much better another setting has to read before it is named. */
export const BAND_EDGE = 1.3;
/** Balls sent before the round stops being read as its opening. */
export const EARLY_BALLS = 8;

export function bandOf(strength) {
  const s = Number.isFinite(strength) ? strength : 0;
  return Math.max(0, Math.min(10, Math.round(s / BAND_STEP)));
}

export function bandLabel(band) { return (band * BAND_STEP).toFixed(1); }

/**
 * A number, or zero.
 *
 * The game already turns a broken number into a zero before it reaches the
 * page, but this line is written from a dozen readings at once and one of them
 * arriving as Infinity would print the word Infinity in the middle of a
 * sentence, which is the exact failure that guard exists to stop.
 */
function fin(v) { return Number.isFinite(v) ? v : 0; }

/** A rate as balls in a hundred, to one decimal while it is small. */
function inHundred(rate) {
  const v = (Number.isFinite(rate) ? rate : 0) * 100;
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

/**
 * A tally of what each setting of the handle has done this game.
 *
 * Fed once a frame with the counters the run keeps. It holds no opinion; the
 * ranking reads it.
 */
export function makeCompass() {
  const bands = new Map();
  let seed = null;
  let launched = 0;
  let gates = 0;

  function clear() { bands.clear(); launched = 0; gates = 0; }

  return {
    reset() { clear(); seed = null; },
    observe(o) {
      if (!o) return;
      const l = Math.max(0, Math.floor(o.launched || 0));
      const g = Math.max(0, Math.floor(o.gates || 0));
      // A new game, or a counter that went backwards, starts the tally again.
      if (o.seed !== seed || l < launched) {
        clear();
        seed = o.seed;
        launched = l;
        gates = g;
        return;
      }
      const dl = l - launched;
      const dg = Math.max(0, g - gates);
      launched = l;
      gates = g;
      if (dl <= 0) return;
      const b = bandOf(o.strength);
      const cell = bands.get(b) || { band: b, launched: 0, gates: 0 };
      cell.launched += dl;
      cell.gates += dg;
      bands.set(b, cell);
    },
    /** Every setting tried, with its own rate. */
    tally() {
      return Array.from(bands.values())
        .map(c => ({ band: c.band, launched: c.launched, gates: c.gates, rate: c.launched > 0 ? c.gates / c.launched : 0 }))
        .sort((a, b) => a.band - b.band);
    },
  };
}

function say(key, values) { return Object.assign({ key }, values || {}); }

/**
 * What to tell the player, as a key and the numbers behind it.
 *
 * `s` is a plain reading of the game: nothing is pulled out of a live object
 * here, so a test can hand it any state at all.
 */
export function pick(s) {
  const quota = Math.max(0, fin(s.quota));
  const won = Math.max(0, fin(s.won));
  const short = Math.max(0, quota - won);

  // A lit row closes on its own in a few seconds, so it outranks everything.
  if (fin(s.doors) > 0) return say('doors', { doors: Math.floor(fin(s.doors)) });
  if (s.over) return say('over', { short, stars: Math.max(0, Math.floor(fin(s.stars))) });

  const tray = Math.max(0, fin(s.tray));
  const pulls = Math.max(0, fin(s.pullsLeft));

  if (s.bench) {
    const offers = Array.isArray(s.offers) ? s.offers : [];
    // The dearest part in reach, because the cheap ones are still there next
    // round and the balls are worth nothing once the round starts.
    const buy = offers.filter(o => o && Number.isFinite(o.price) && o.price <= tray).sort((a, b) => b.price - a.price)[0];
    if (buy && s.slotsFree) return say('benchBuy', { name: String(buy.name || 'that part'), price: fin(buy.price), tray });
    if (fin(s.bendsLeft) > 0) return say('benchBend', { bends: Math.floor(fin(s.bendsLeft)) });
    return say('benchGo', { tray });
  }

  // Only ever on a game that has not sent a ball yet: at the top of round
  // twelve the player knows where the button is.
  if (fin(s.everLaunched) <= 0 && !s.auto && fin(s.inFlight) <= 0) return say('start', {});
  if (s.fever) return say('bonus', {});
  if (quota > 0 && won >= quota) return say('goalMet', { bonus: Math.max(0, fin(s.nextBonus)), pulls });
  if (fin(s.launched) < EARLY_BALLS) return say('early', { round: Math.max(1, Math.floor(fin(s.round)) || 1), quota, pulls });

  const tally = Array.isArray(s.bands) ? s.bands : [];
  const read = tally.filter(b => b.launched >= BAND_MIN);
  const here = tally.find(b => b.band === bandOf(s.strength));
  const best = read.slice().sort((a, b) => b.rate - a.rate)[0];
  if (best && here && here.launched >= BAND_MIN && best.band !== here.band && best.rate >= here.rate * BAND_EDGE) {
    return say('powerBetter', {
      best: bandLabel(best.band), bestPct: inHundred(best.rate),
      here: bandLabel(here.band), herePct: inHundred(here.rate),
    });
  }
  const need = Math.max(0, fin(s.perBall));
  const getting = fin(s.launched) > 0 ? fin(won / fin(s.launched)) : 0;
  if (getting < need) {
    // Losing on a handle that has only ever been in one place. Telling this
    // player they are behind is true and useless; the slider is the only thing
    // they can still move. A player who is ON pace is left alone, or the game
    // spends every round nagging somebody who is already winning.
    if (here && here.launched >= BAND_MIN && read.length < 2) {
      return say('powerTry', { here: bandLabel(here.band), herePct: inHundred(here.rate) });
    }
    return say('behind', { short, pulls, need, getting });
  }
  return say('onPace', { short, pulls, need, getting });
}

const LINES = {
  doors: p => p.doors + ' doors are lit at the foot of the board. Click one, or press its number: right pays '
    + p.doors + ' times over, wrong pays nothing. Leave them alone and the paying door opens by itself.',
  over: p => 'Out of pulls, ' + num(p.short) + ' short of the goal. Pick a machine and play again.'
    + (p.stars > 0 ? ' Or start over from your arcade: it pays ' + num(p.stars) + (p.stars === 1 ? ' star' : ' stars') + ' right now.' : ''),
  benchBuy: p => "You're holding " + num(p.tray) + ' balls. ' + p.name + ' costs ' + num(p.price)
    + ', and balls are worth nothing once the round starts.',
  benchBend: p => p.bends + (p.bends === 1 ? ' bend' : ' bends') + ' left. Drag a nail just above the SLOT to the right, '
    + 'and the ones feeding it send more balls in.',
  benchGo: p => 'Nothing on the bench is in reach on ' + num(p.tray) + ' balls. Start the round and come back richer.',
  start: () => 'Press Pull to drop a ball down the board. Auto keeps pulling for you.',
  early: p => 'Round ' + p.round + ' wants ' + num(p.quota) + ' balls out of ' + num(p.pulls)
    + ' pulls. The SLOT in the middle is the one that pays: three matching reels open the jackpot pocket.',
  // The banner directly above this counts the balls left in the bonus. Printing
  // the same count here as well showed two different numbers for it, because
  // the line holds still for a beat and the banner does not.
  bonus: () => 'Keep pulling while the jackpot pocket is open. This is the only stretch where the board pays back more than it takes.',
  goalMet: p => 'Goal met. The counter pays ' + num(p.bonus) + ' balls when the round ends, and the '
    + num(p.pulls) + ' pulls left are yours to bank.',
  powerBetter: p => 'Power ' + p.best + ' put ' + p.bestPct + ' balls in a hundred through the slot and '
    + p.here + ' is putting ' + p.herePct + '. Move the slider back to ' + p.best + '.',
  powerTry: p => 'Power ' + p.here + ' is putting ' + p.herePct + ' balls in a hundred through the slot. '
    + 'Move the slider and watch that number. Nothing else you can do moves it as much.',
  behind: p => num(p.short) + ' short with ' + num(p.pulls) + ' pulls left. Each ball has to win '
    + p.need.toFixed(2) + ' and yours are winning ' + p.getting.toFixed(2)
    + '. Only a BONUS closes a gap like that, so move the power until more balls find the slot.',
  onPace: p => 'On pace: ' + num(p.short) + ' short with ' + num(p.pulls) + ' pulls left, each ball has to win '
    + p.need.toFixed(2) + ' and yours are winning ' + p.getting.toFixed(2) + '.',
};

/** Every key `pick` can return, which is what the suite holds LINES to. */
export const KEYS = Object.keys(LINES);

export function write(p) {
  const f = p && LINES[p.key];
  return f ? f(p) : '';
}

/** The whole thing: a state in, a sentence out. */
export function advise(s) { return write(pick(s)); }
