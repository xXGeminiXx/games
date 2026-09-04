/**
 * advice.js - the one line that says what to do next.
 *
 * Pure. It takes a plain reading of the run and answers with a key and the
 * figures behind it; the interface owns the wording and the placement. Nothing
 * here touches the page, the field or a clock.
 *
 * WHY A LINE AND NOT AN EXPLANATION. A field that is doing something and a
 * field that is stuck look the same from the outside: dots on black. The board
 * already says what each row does, and the readout already says what the run
 * weighs, and between them there is still no answer to "what should I press".
 * This is that answer, recomputed every time the figures move, so it never goes
 * stale and costs nothing to ignore.
 *
 * THE ORDER IS THE RANKING. The first condition that holds wins, so the list
 * below is this game's own view of what matters: a wall first, then the thing
 * the field is straining to do, then what is affordable, then what to wait for.
 * Getting that order wrong is the way this feature fails - it walks a player
 * into spending on the cheap row while the wall stays up.
 */

/** A round figure a person can read: 12, 1.50k, 3.20M, 4.1e9. */
export function figure(n) {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + 'k';
  if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
  return n.toExponential(2);
}

/**
 * A rate, which needs a decimal that a price does not: most of a run earns
 * less than ten a second, and rounding that down printed "0 a second" beside
 * a wait of sixteen seconds computed from the real figure.
 */
export function rateFigure(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n < 10 ? n.toFixed(1) : figure(n);
}

/** How long, in the largest unit that still reads as a number. */
export function span(seconds) {
  const said = (n, unit) => n + ' ' + unit + (n === 1 ? '' : 's');
  if (!Number.isFinite(seconds) || seconds <= 0) return said(0, 'second');
  if (seconds < 90) return said(Math.max(1, Math.round(seconds)), 'second');
  if (seconds < 3600) return said(Math.round(seconds / 60), 'minute');
  return said(Math.round(seconds / 3600), 'hour');
}

/** A kind as it is said out loud. Rock and dust are mass nouns; the rest take an article. */
export function aKind(name) {
  if (!name) return '';
  if (name === 'rock' || name === 'dust') return name;
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
}

/** Below this a second of income is not worth quoting as a rate. */
const EARNING = 0.05;

/**
 * What to do next.
 *
 * @param {object} w                a reading of the run
 * @param {number} w.seeds          every seed that has landed, clicked or fallen
 * @param {number} w.era            0 before anything has met, then 1 to 4
 * @param {number} w.flux           what is banked
 * @param {number} w.rate           flux a second, everything counted, smoothed
 * @param {boolean} w.full          the field holds all the mass one run can carry
 * @param {boolean} w.closed        the universe has been closed
 * @param {string} w.idleLaw        a law whose dial is at zero, or ''
 * @param {string[]} w.wanting      names of kinds the field is straining to make
 * @param {object[]} w.rows         the board: { id, name, cost, open, affordable, unlocks }
 * @returns {?{key: string, values: object}}
 */
export function advise(w) {
  if (!w || w.closed) return null;

  const rows = Array.isArray(w.rows) ? w.rows : [];
  const open = rows.filter(r => r.open);
  const affordable = open.filter(r => r.affordable);
  const wanting = Array.isArray(w.wanting) ? w.wanting : [];
  const rate = w.rate > EARNING ? w.rate : 0;

  // The row that would let the field do the thing it is straining to do.
  const strained = open.find(r => r.unlocks && wanting.indexOf(r.unlocks) >= 0) || null;
  // Otherwise the nearest one, which is what a player is saving toward.
  const cheapest = open.slice().sort((a, b) => a.cost - b.cost)[0] || null;

  const say = (key, values) => ({ key, values: values || {} });
  const eta = (row) => span(rate > 0 ? Math.max(0, row.cost - w.flux) / rate : 0);
  const money = { flux: figure(w.flux), rate: rateFigure(w.rate) };
  const price = (row) => ({ name: row.name, cost: figure(row.cost) });

  // Nothing has been put in the field yet.
  if (!(w.seeds > 0)) return say('first');

  // Something is in the field and nothing has met anything else.
  if (!(w.era > 0)) return say('meet');

  // A law that is held and turned off. The field goes quiet and the handle
  // that did it is a long way from the eye that stopped seeing arrivals.
  if (w.idleLaw === 'infall') return say('infallOff');

  // THE WALL. A run at its mass ceiling takes no more clicks and no more
  // infall, so every ordinary reading of the game says nothing is happening.
  // What is banked is the only move left, and it is usually enough.
  if (w.full) {
    if (strained && strained.affordable) return say('fullWanted', Object.assign({ kind: aKind(strained.unlocks) }, price(strained), money));
    if (affordable.length) return say('fullBuy', Object.assign({}, price(affordable[0]), money));
    if (rate > 0 && cheapest) return say('fullWait', Object.assign({}, price(cheapest), money, { eta: eta(cheapest) }));
    return say('fullStuck');
  }

  // THE FIELD IS ASKING FOR SOMETHING. A blocked promotion lights a row, and
  // that is the field naming its own next step; it outranks anything cheaper.
  if (strained) {
    const kind = aKind(strained.unlocks);
    if (strained.affordable) return say('wantedBuy', Object.assign({ kind }, price(strained), money));
    // A wait is only a wait if something is coming. With nothing earning, the
    // figure to quote is the price and the move is to put more in the field.
    if (rate > 0) return say('wantedWait', Object.assign({ kind }, price(strained), money, { eta: eta(strained) }));
    return say('wantedClick', Object.assign({ kind }, price(strained), money));
  }

  if (affordable.length) return say('buy', Object.assign({}, price(affordable[0]), money));
  if (rate > 0 && cheapest) return say('wait', Object.assign({}, price(cheapest), money, { eta: eta(cheapest) }));
  return say('click');
}

/** Fill {holes} in a line. A hole with no value is left as it was written. */
export function fill(line, values) {
  if (typeof line !== 'string') return '';
  return line.replace(/\{(\w+)\}/g, (whole, key) =>
    (values && values[key] !== undefined ? String(values[key]) : whole));
}

export default { advise, fill, figure, rateFigure, span, aKind };
