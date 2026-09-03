// ---------------------------------------------------------------------------
// Numbers on the furniture.
//
// A game whose whole point is that the numbers get large has to be able to
// show a large number without becoming unreadable, and it has to show a small
// one without pretending to a precision it does not have. Everything the
// player reads passes through here so that one rule covers the whole game.
// ---------------------------------------------------------------------------

// Short scale, which is what a player reading English expects. Past this the
// exponent is shown outright, because a name nobody knows is worse than a
// number everybody can compare.
const SUFFIX = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc',
  'Vg',
];

/**
 * Drops a trailing run of zeros from a fraction, and the point with them.
 *
 * Only from a fraction. Stripping them from a whole number as well turned a
 * hundred thousand into one thousand, which is the same string a player would
 * read as a hundred times less money than they are holding.
 */
function trim(text) {
  if (text.indexOf('.') < 0) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The house style for any quantity a player reads. */
export function num(v, places) {
  if (v === null || v === undefined) return '0';
  if (!Number.isFinite(v)) return v > 0 ? 'huge' : '0';
  const neg = v < 0;
  let n = Math.abs(v);
  let s;

  if (n < 1000) {
    // Small numbers are the ones a player counts, so they stay exact until
    // they stop being counted.
    if (places !== undefined) s = n.toFixed(places);
    else if (n === Math.floor(n)) s = String(n);
    else if (n < 10) s = trim(n.toFixed(2));
    else if (n < 100) s = n.toFixed(1).replace(/\.0$/, '');
    else s = String(Math.round(n));
  } else {
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier < SUFFIX.length) {
      let scaled = n / Math.pow(1000, tier);
      let d = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
      // Rounding can carry the front of the number up to a thousand, and a
      // thousand belongs to the next suffix: 999,999 rounds to 1000 and is a
      // million, not a thousand thousand.
      if (Number(scaled.toFixed(d)) >= 1000 && tier + 1 < SUFFIX.length) {
        tier += 1;
        scaled = n / Math.pow(1000, tier);
        d = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
      }
      s = trim(scaled.toFixed(d)) + SUFFIX[tier];
    } else {
      const e = Math.floor(Math.log10(n));
      s = (n / Math.pow(10, e)).toFixed(2) + 'e' + e;
    }
  }
  return neg ? '-' + s : s;
}

/** A whole count with thousands separators, for anything below a million. */
export function count(v) {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1e6) return num(v);
  return Math.round(v).toLocaleString('en-US');
}

/** A rate, always per second, always with its unit. */
export function rate(v, unit) {
  return num(v) + ' ' + unit + '/s';
}

/** A duration a player is waiting through. */
export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  // Past a thousand days the hours stop mattering and the count takes the
  // house style, so a damaged timestamp reads as a big number, not exponents.
  if (d >= 1000) return num(d) + 'd';
  return d + 'd ' + (h % 24) + 'h';
}

/** A multiplier, written the way a player would say it. */
export function mult(v) {
  if (!Number.isFinite(v)) return 'x1';
  // Either sign hands over to the house style past a thousand.
  if (Math.abs(v) >= 1000) return 'x' + num(v);
  if (v === Math.floor(v)) return 'x' + v;
  return 'x' + v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

/** A share of one, as a percentage, with the precision the size deserves. */
export function pct(v) {
  const p = v * 100;
  if (!Number.isFinite(p)) return '0%';
  if (Math.abs(p) >= 1000) return num(p) + '%';
  if (p >= 10) return Math.round(p) + '%';
  if (p >= 1) return p.toFixed(1) + '%';
  return p.toFixed(2) + '%';
}

/** Fills {braces} in a sentence from an object. Unknown keys are left alone. */
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}
