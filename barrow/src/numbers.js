// ---------------------------------------------------------------------------
// Numbers as the player reads them.
//
// Thousand, million, billion and trillion by their letters, then the power of
// ten. Quantities below a thousand keep the decimals that matter and nothing
// else, so a price of 0.81 reads as 0.81 and a stock of 4,812 reads as 4.81K.
// Every formatter here is pure and safe on anything: NaN and infinities come
// out as a question mark rather than as text a player has to decode.
// ---------------------------------------------------------------------------

// Past a trillion the old names ran Qa, Qi, Sx, Sp, Oc, No, Dc, UDc, DDc ...
// and nobody can say at a glance whether 2.36DDc is more than 5.24Dc. A power
// of ten says it: 2.36e36 is a thousand times 5.24e33 and it looks it. The
// four letters everybody already knows stay.
export const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/** The figure past which there is no suffix left and the exponent takes over. */
export const SUFFIX_CEILING = Math.pow(10, SUFFIXES.length * 3);

/**
 * A figure held at the top. The largest number the game can hold is about
 * 1.8e308; a product that goes past it reads Infinity, and one that mixes
 * Infinity with nothing reads NaN. Past the top counts as the top, and NaN
 * as nothing, so a figure that grew too big is never mistaken for zero.
 */
export function sat(x) {
  if (x !== x) return 0;
  if (x > Number.MAX_VALUE) return Number.MAX_VALUE;
  if (x < -Number.MAX_VALUE) return -Number.MAX_VALUE;
  return x;
}

/**
 * base^n written out, for a total too big to hold: 2 to the 6000th is a
 * 1807-digit number, and is written 8.02e1805 rather than as a question mark.
 */
export function fmtPow(base, n) {
  const v = Math.pow(base, n);
  if (Number.isFinite(v)) return fmt(v);
  const e = n * Math.log10(base);
  if (!Number.isFinite(e)) return '?';
  const whole = Math.floor(e);
  let mant = Math.pow(10, e - whole);
  let exp = whole;
  if (mant >= 9.995) { mant /= 10; exp += 1; }
  return mant.toFixed(2) + 'e' + exp;
}

/** A number with a suffix, sensible decimals, and an exponent only past the end of the list. */
export function fmt(n, decimals) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  const neg = n < 0;
  const a = Math.abs(n);
  let out;
  if (a < 1000) {
    out = small(a, decimals);
  } else {
    const tier = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(a) / 3));
    if (tier < SUFFIXES.length - 1 || a < SUFFIX_CEILING) {
      const scaled = a / Math.pow(10, tier * 3);
      // 999.995K would round up to 1000.00K; hand it to the next tier instead.
      if (scaled >= 999.995 && tier < SUFFIXES.length - 1) {
        out = (scaled / 1000).toFixed(2) + SUFFIXES[tier + 1];
      } else {
        out = scaled.toFixed(2) + SUFFIXES[tier];
      }
    } else {
      out = a.toExponential(2).replace('e+', 'e');
    }
  }
  return neg ? '-' + out : out;
}

function small(a, decimals) {
  if (decimals !== undefined) return a.toFixed(decimals);
  if (Number.isInteger(a)) return String(a);
  if (a < 10) return trimZeros(a.toFixed(2));
  if (a < 100) return trimZeros(a.toFixed(1));
  return String(Math.round(a));
}

function trimZeros(s) {
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

/** Coin: two decimals below a hundred, because prices live there. */
export function fmtCoin(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  const a = Math.abs(n);
  if (a < 100) return (n < 0 ? '-' : '') + trimZeros(a.toFixed(2));
  return fmt(n);
}

/** A whole count: never a decimal, so a horde of 3 is "3" and never "3.00". */
export function fmtCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  return fmt(Math.floor(n));
}

/** A rate per second. */
export function fmtRate(n) {
  return fmtCoin(n) + '/s';
}

/** Seconds as "2h 5m", "4m 10s", "12s". */
export function fmtTime(s) {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return '?';
  s = Math.round(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** A share as a percentage with no decimals. */
export function fmtPct(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '?';
  return Math.round(x * 100) + '%';
}

/** Clamp, with NaN treated as the low end so a bad input never escapes. */
export function clamp(x, lo, hi) {
  if (!(x > lo)) return lo;
  return x > hi ? hi : x;
}
