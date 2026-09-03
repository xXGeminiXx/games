// Vendored from the game-art foundation (lib/format.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Number and duration formatting for incremental games.
//
// Depends on ./bignum.js (a game that copies this file copies that one too).
//
// THE SUFFIX SYSTEM, STATED ONCE, BECAUSE THE TWO COMMON ONES DISAGREE.
// This module uses the MOBILE-IDLER ALPHABETIC system:
//
//     1e3  K        1e15  aa       1e42  aj       1e93  ba
//     1e6  M        1e18  ab       ...            1e96  bb
//     1e9  B        1e21  ac       1e90  az       ...
//     1e12 T        1e24  ad                      1e2040 zz
//
// The four words come first, then every two-letter pair from aa to zz, three
// decades apart. Past zz (about 1e2042) it falls back to scientific notation,
// because a third letter buys nothing a player can read.
//
// The other system in wide use, the one Antimatter Dimensions uses, spells
// out the Latin names first (Qa Qi Sx Sp Oc No Dc, then Vg, then Tg) and
// only reaches aa at 1e81. The two are irreconcilable: the SAME STRING "aa"
// means 1e15 here and 1e81 there, a factor of 1e66. Mixing them inside one
// game, or across two games a player plays, is a bug that looks like a
// balance problem. Pick one, say which, never mix. This is the mobile one
// because these games are played in a browser tab next to a phone game, not
// next to Antimatter Dimensions.
//
// NO WIDTH JITTER. A number that ticks 999 -> 1.00K -> 1.01K changes its
// character count three times in a second, and a right-aligned column
// twitches. fixed() always returns exactly the same number of characters, so
// a column can be right-aligned and left alone. Pair it with the CSS
// `font-variant-numeric: tabular-nums` so the digits are also the same width;
// the suffix letters are not, which is why the padding goes on the left and
// the column is right-aligned.
// ---------------------------------------------------------------------------

import { isBig, log10 as bigLog10, toNumber as bigToNumber } from './bignum.js?v=4';

const WORDS = ['', 'K', 'M', 'B', 'T'];
const AZ = 'abcdefghijklmnopqrstuvwxyz';

// Tier t means the value is between 1000^t and 1000^(t+1). Returns null past
// the end of the table, which is the caller's cue to go scientific.
export function suffix(t) {
  if (t < 0) return null;
  if (t < WORDS.length) return WORDS[t];
  const i = t - WORDS.length;
  if (i >= 676) return null;
  return AZ[(i / 26) | 0] + AZ[i % 26];
}

// The largest tier the table covers, and the decade it starts at. Exported so
// a game can say "past here we show exponents" in its own settings screen.
export const MAX_TIER = WORDS.length + 675;
export const MAX_TIER_DECADE = MAX_TIER * 3;

// Split a Number or a Big into sign, a mantissa in [1, 1000) and a tier.
// Zero comes back as tier 0 with mantissa 0.
function split(v) {
  if (isBig(v)) {
    if (v.m === 0) return { sign: 1, mant: 0, tier: 0, exp: 0 };
    const sign = v.m < 0 ? -1 : 1;
    const am = v.m < 0 ? -v.m : v.m;
    if (v.e === 0) return splitNumber(sign, am);
    // Normalised: e is already the true decade, so this is exact.
    const tier = Math.floor(v.e / 3);
    return { sign, mant: am * Math.pow(10, v.e - tier * 3), tier, exp: v.e };
  }
  const n = Number(v);
  if (n === 0 || !Number.isFinite(n)) return { sign: n < 0 ? -1 : 1, mant: n === 0 ? 0 : Math.abs(n), tier: 0, exp: 0 };
  return splitNumber(n < 0 ? -1 : 1, Math.abs(n));
}

function splitNumber(sign, am) {
  const exp = Math.floor(Math.log10(am));
  // Tier never goes negative: everything under 1000, fractions included, is
  // tier 0 and prints as itself. A negative tier would ask for a suffix
  // below K, and there is no such thing.
  const tier = exp < 3 ? 0 : Math.floor(exp / 3);
  const mant = tier === 0 ? am : am / Math.pow(10, tier * 3);
  return { sign, mant, tier, exp };
}

function trimZeros(s) {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/\.?0+$/, '');
}

// The plain reading of a value. Numbers under 1000 keep their own shape
// (947 stays "947", 0.5 stays "0.5"); everything else is mantissa plus
// suffix, and past the table it is scientific.
//
//   format(1234)        "1.23K"
//   format(9.4e17)      "940.00aa"     (940 * 1000^5, and 1000^5 is 1e15)
//   format(big('1e500'))"1.00e500"
export function format(v, opts = {}) {
  const decimals = opts.decimals === undefined ? 2 : opts.decimals;
  const style = opts.style || 'suffix';
  const n = isBig(v) ? null : Number(v);
  if (n !== null && !Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : (n > 0 ? 'Infinity' : '-Infinity');
  if (isBig(v) && !Number.isFinite(v.m)) return Number.isNaN(v.m) ? 'NaN' : (v.m > 0 ? 'Infinity' : '-Infinity');

  let { sign, mant, tier, exp } = split(v);
  if (mant === 0) return '0';
  const s = sign < 0 ? '-' : '';

  if (style === 'scientific') return s + sci(v, decimals);

  // Rounding can carry the mantissa over 1000 ("999.996" at 2 decimals is
  // "1000.00"), which would print a mantissa the tier says is impossible.
  let body = mant.toFixed(tier === 0 ? decimals : decimals);
  if (parseFloat(body) >= 1000) { tier += 1; mant /= 1000; body = mant.toFixed(decimals); }

  const suf = suffix(tier);
  if (suf === null) return s + sci(v, decimals);
  if (tier === 0) {
    // A fraction gets as many decimals as it takes to show the digits it
    // actually has, because rendering 0.001 as "0.00" is a different number
    // and a player reading a rate would believe it. Past eight decimals even
    // that stops being readable, so it becomes an exponent instead.
    let d = Math.max(decimals, 0);
    if (mant > 0 && mant < 1) d = Math.min(8, Math.max(d, -Math.floor(Math.log10(mant)) + d - 1));
    const plain = trimZeros(mant.toFixed(d));
    if (parseFloat(plain) === 0 && mant !== 0) return s + sci(v, decimals);
    return s + plain;
  }
  return s + body + suf;
}

// Scientific notation. For a Big past the double range the mantissa and
// exponent are already stored separately, so this is exact rather than a
// logarithm of a logarithm.
export function sci(v, decimals = 2) {
  if (isBig(v)) {
    if (v.m === 0) return (0).toFixed(decimals) + 'e0';
    if (v.e !== 0) {
      const am = v.m < 0 ? -v.m : v.m;
      return am.toFixed(decimals) + 'e' + v.e;
    }
  }
  const n = isBig(v) ? bigToNumber(v) : Number(v);
  const a = Math.abs(n);
  if (a === 0) return (0).toFixed(decimals) + 'e0';
  const e = Math.floor(Math.log10(a));
  let m = a / Math.pow(10, e);
  if (parseFloat(m.toFixed(decimals)) >= 10) return (m / 10).toFixed(decimals) + 'e' + (e + 1);
  return m.toFixed(decimals) + 'e' + e;
}

// log10 of the magnitude, for Numbers and Bigs alike. Handy when a game
// wants a progress bar across decades rather than across a value.
export function decade(v) {
  if (isBig(v)) return bigLog10(v);
  const a = Math.abs(Number(v));
  return a === 0 ? -Infinity : Math.log10(a);
}

// Exactly `width` characters, every time, right-aligned. Decimals are given
// up one at a time to make room before the notation changes, so a value that
// grows past the column loses precision rather than the layout.
//
//   fixed(947)          "    947"
//   fixed(1234)         "  1.23K"
//   fixed(999999)       " 1000.0K" -> " 1.00M" -> "  1.00M"
export function fixed(v, opts = {}) {
  const width = opts.width === undefined ? 7 : opts.width;
  const padChar = opts.pad === undefined ? ' ' : opts.pad;
  let decimals = opts.decimals === undefined ? 2 : opts.decimals;
  let s = format(v, { ...opts, decimals });
  while (s.length > width && decimals > 0) {
    decimals -= 1;
    s = format(v, { ...opts, decimals });
  }
  if (s.length > width) {
    // Still over: scientific with as few digits as it takes. If even that
    // does not fit, return it long rather than return a wrong number.
    for (let d = Math.max(opts.decimals === undefined ? 2 : opts.decimals, 0); d >= 0; d--) {
      const alt = format(v, { ...opts, decimals: d, style: 'scientific' });
      if (alt.length <= width) return alt.padStart(width, padChar);
      s = alt;
    }
    return s;
  }
  return s.padStart(width, padChar);
}

// A duration in the shape an offline summary wants: the two largest non-zero
// units, never more. 33120 -> "9h 12m", 45 -> "45s", 0 -> "0s".
export function duration(seconds) {
  let s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (s || parts.length === 0) parts.push(s + 's');
  return parts.slice(0, 2).join(' ');
}

// A percentage, with the decimals a bar label wants and no more.
export function percent(fraction, decimals = 0) {
  const n = Number(fraction) * 100;
  if (!Number.isFinite(n)) return '0%';
  return n.toFixed(decimals) + '%';
}

// ---------------------------------------------------------------------------
// Count-up tween.
//
// UI.md: headline numbers count up by exponential smoothing, with
// tabular-nums so nothing shifts. The smoothing is written against elapsed
// TIME, not against frames: `v += (target - v) * 0.1` per frame moves twice
// as fast on a 120 Hz display as on a 60 Hz one, and that difference is
// visible. 1 - exp(-rate * dt) is the frame-rate independent form of the same
// curve. `rate` is the reciprocal of the time constant: 8 closes about 63% of
// the gap in the first eighth of a second, which reads as instant but soft.
//
// It converges: once the gap is under `epsilon` of the target the value is
// snapped to the target exactly and `done` goes true, so a display never sits
// forever at 999.9999 of 1000, and a game can wait on it.
// ---------------------------------------------------------------------------

export function counter(opts = {}) {
  const rate = opts.rate === undefined ? 8 : opts.rate;
  const epsilon = opts.epsilon === undefined ? 1e-4 : opts.epsilon;
  let value = Number(opts.value) || 0;
  let target = opts.target === undefined ? value : Number(opts.target);

  return {
    get value() { return value; },
    get target() { return target; },
    get done() { return value === target; },
    // Aim at a new number. The display keeps moving from where it is.
    set(t) { target = Number(t) || 0; return this; },
    // Jump there with no animation: for a load, a reset, or a mode switch.
    snap(t) { if (t !== undefined) target = Number(t) || 0; value = target; return this; },
    // dt in seconds.
    update(dt) {
      if (value === target) return value;
      const k = 1 - Math.exp(-rate * Math.max(0, dt));
      value += (target - value) * k;
      const scale = Math.max(1, Math.abs(target));
      if (Math.abs(target - value) <= epsilon * scale) value = target;
      return value;
    },
    // What to put in the element.
    text(o) { return format(value, o); },
  };
}

export default format;
