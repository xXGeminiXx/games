'use strict';
// THE COMPASS - one line naming the best thing to do right now.
//
// A player who has never seen this game gets one decision a turn and a screen
// full of numbers explaining nothing about which way to point. Explanation
// does not fix that; a wall of correct text is still a wall. One live line
// that names the single best move, with the run's own figures inside it, does.
//
// This module decides WHICH line and hands back the figures. The words
// themselves live in `CONFIG.text.compass`, so the game keeps every sentence
// in one file and nothing here has to be translated to change a phrase.
//
// It is pure: give it a bag of plain numbers and it answers `{ key, vals }` or
// null. It reads no globals, touches no page and holds no state, so the tests
// drive it directly and the same ordering can be pinned rung by rung.
//
// THE ORDER IS THE DESIGN. Whichever rung fires first is what the game claims
// matters most at that moment, and getting it wrong walks a player into a bad
// habit rather than out of one. Read the ordering below as the game's own
// opinion of itself, and change it only with a measured run behind the change.

/** Every key this module can answer with. The test scans the source for
 *  `say('...')` rather than reading this list, so the list cannot go stale
 *  without the scan noticing. */
export const KEYS = [
  'working', 'start', 'crowded', 'last', 'closing', 'buy', 'hoard', 'marker', 'lane', 'saving', 'aim',
];

function say(key, vals) { return { key, vals: vals || {} }; }

/** Counts a compass sentence can be built around. `{s}` agrees with whichever
 *  of these the sentence actually prints. */
const COUNTS = ['live', 'n', 'cols', 'spare', 'swarm'];

/**
 * One compass sentence, filled in.
 *
 * The `{s}` hole is what keeps a line one sentence in the config instead of
 * two spellings of the same one, and it has to agree with the count the
 * sentence is built around - not with whichever number happens to be in the
 * bag. A rung hands over figures it does not print (the marker line carries
 * the swarm size for the rungs below it), so agreeing with the wrong one
 * reads as "2 cyan marker out there".
 */
export function line(words, vals) {
  const v = Object.assign({}, vals || {});
  for (const k of COUNTS) {
    if (v[k] === undefined || !String(words).includes('{' + k + '}')) continue;
    v.s = Number(v[k]) === 1 ? '' : 's';
  }
  return String(words).replace(/\{(\w+)\}/g, (all, k) => (v[k] === undefined ? all : String(v[k])));
}

/** A number a person reads, in the same shape the readout uses. */
function round(n) {
  if (!Number.isFinite(n)) return 0;
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

/**
 * The line for this moment.
 *
 * bag = {
 *   phase:    'aim' | 'firing' | 'over'
 *   shots:    shots fired since the page loaded
 *   depth:    how far the field has come down
 *   swarm:    bodies that go out on the next shot
 *   damage:   what one body takes off a block on a clean hit
 *   essence:  essence in hand, as a number
 *   essenceText: the same, as the readout prints it
 *   live:     bodies still in flight
 *   broke:    blocks broken so far this turn
 *   descends: true when the field comes down a row a turn
 *   spare:    rows of room under the lowest block (descending fields only)
 *   fill:     0..1 of the board that is standing (fields that fill only)
 *   openCols: columns with nothing standing in them
 *   markers:  { swarm, essence } markers waiting on the field
 *   trading:  true when the run mines ore and has a market to sell it on
 *   hoard:    what the held material would fetch if it were sold now
 *   offers:   [{ name, cost, costText, effect, affordable }] the hand
 * }
 */
export function advise(bag) {
  const b = bag || {};
  if (b.phase === 'over') return null;

  // A turn that is running says what it is doing. The figures move while the
  // player watches, which is the whole reason the wait reads as a result
  // rather than as a pause.
  if (b.phase === 'firing') {
    return say('working', { live: Math.max(0, b.live | 0), broke: Math.max(0, b.broke | 0) });
  }

  // Nobody has fired yet, so nothing else is worth saying.
  //
  // A RUN COMES BACK FROM STORAGE WITH ITS SHOT COUNT AT ZERO, because the
  // count is a thing the turn keeps rather than a thing the save carries. So
  // the depth has to agree: somebody reopening the tab at depth six knows how
  // to fire and wants to be told what to do next, and only a run still on its
  // first row is genuinely somebody's first look at the game.
  if (!(b.shots > 0) && !(b.depth > 1)) return say('start', {});

  // Losing beats every other consideration. The two field kinds lose in
  // different ways and a single sentence for both would describe one of them
  // wrongly, so each gets its own.
  if (!b.descends) {
    const fill = Number(b.fill) || 0;
    if (fill >= 0.75) return say('crowded', { pct: Math.round(fill * 100) });
  } else if (Number.isFinite(b.spare)) {
    // No whole row of clearance left, so the next step down ends it. Its own
    // line, because "0 rows of room" is not a sentence anybody says.
    if (b.spare <= 0) return say('last', {});
    if (b.spare <= 2) return say('closing', { spare: Math.round(b.spare) });
  }

  // Essence sitting in hand does nothing at all. Two measured runs on the
  // default difficulty ended holding enough for two powers that were never
  // bought, which is the single most expensive habit a new player has here.
  // Name the biggest step the run can actually take.
  const price = (o) => (o && Number.isFinite(Number(o.cost)) ? Number(o.cost) : Infinity);
  const affordable = (b.offers || []).filter(o => o && o.affordable);
  if (affordable.length) {
    let best = affordable[0];
    for (const o of affordable) if (price(o) > price(best)) best = o;
    return say('buy', {
      cash: b.essenceText || String(round(b.essence || 0)),
      name: best.name, cost: best.costText || String(price(best)), effect: best.effect,
    });
  }

  // ORE THAT HAS NEVER BEEN SOLD.
  //
  // A real run on this machine reached depth 42 holding six hundred and
  // twenty five units of it while the hand went untaken, and nothing on the
  // screen had ever mentioned it was there. It sits below buying, because
  // spending money you already have beats a sale, and above saving, because
  // selling beats waiting.
  let cheapest = null;
  for (const o of (b.offers || [])) if (!cheapest || price(o) < price(cheapest)) cheapest = o;
  if (b.trading && (b.hoard | 0) > 0 && cheapest && Number.isFinite(price(cheapest))) {
    return say('hoard', {
      worth: b.hoardText || String(Math.round(b.hoard)),
      name: cheapest.name, cost: cheapest.costText || String(price(cheapest)),
    });
  }

  // The swarm is the damage, and markers are the only thing that grows it.
  const mk = b.markers || {};
  if ((mk.swarm | 0) > 0) {
    return say('marker', {
      n: mk.swarm | 0, swarm: b.swarm | 0, damage: round(b.damage || 0),
    });
  }

  // The best shot in the game, and one almost nobody finds on their own: a
  // body that reaches the ceiling untouched flattens out and rakes the whole
  // top row from above. It needs a clear column to get there.
  if ((b.openCols | 0) > 0 && (b.swarm | 0) >= 4) {
    return say('lane', { cols: b.openCols | 0 });
  }

  // Saving toward something, with the gap named so the wait has a length.
  if (cheapest && Number.isFinite(price(cheapest))) {
    const gap = Math.max(0, Math.round(price(cheapest) - (Number(b.essence) || 0)));
    return say('saving', {
      cash: b.essenceText || String(round(b.essence || 0)),
      name: cheapest.name, cost: cheapest.costText || String(price(cheapest)),
      short: gap.toLocaleString('en-US'),
    });
  }

  return say('aim', {
    swarm: b.swarm | 0, damage: round(b.damage || 0),
    pass: round((b.swarm | 0) * (b.damage || 0)),
  });
}

export default { advise, line, KEYS };
