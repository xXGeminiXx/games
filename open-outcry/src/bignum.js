// Vendored from the game-art foundation (lib/bignum.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Big numbers for incremental games.
//
// A value is a mantissa and a base-10 exponent: v = m * 10^e. That reaches
// 10^(2^53) instead of the 1.8e308 a double stops at, which is what an idle
// game needs once multipliers start multiplying each other.
//
// THE ONE THING THAT MAKES THIS DIFFERENT: a hybrid representation. Below
// 2^53 the mantissa holds the whole value and the exponent is zero, so
// add/sub/mul are plain IEEE double arithmetic and integers are EXACT. Above
// 2^53 (and below 1e-300) the value is normalised to 1 <= |m| < 10. Every
// value has exactly one canonical form, so comparison never needs a log.
//
// WHY NOT ONE OF THE OTHER TWO OPTIONS. Measured 2026-08-29 on node v22.22.1
// with tools/bignum-bench.js, which is in this repo and can be re-run.
//
// 1. VENDOR break_infinity.js 2.2.0 (MIT, LICENSE file present and reading
//    "Copyright (c) 2019 Timothy Stiles", github.com/Patashu/break_infinity.js,
//    published 2023-02-26). Battle-tested by Antimatter Dimensions, and on
//    the measurements below it is a fair fight: this module is 1.6x faster on
//    add, level on multiply, 1.7x slower on compare. Speed is not why it was
//    rejected. CORRECTNESS is. It normalises every value to 1 <= |m| < 10 by
//    dividing by a power of ten, so it loses whole integers far below 2^53.
//    Run against the published 2.2.0 build:
//        new Decimal(123456789)     ->  123456788.99999999  (not an integer)
//        new Decimal(1e12).add(1)   ->  1000000000001.0001  (not an integer)
//        new Decimal(1e15).add(1)   ->  1000000000000000    (the +1 vanishes)
//        1e15 then +1 ten times     ->  1000000000000000    (all ten vanish)
//        9007199254740991 + 1       ->  9007199254740989    (off by 3)
//    Scanning 100,000 consecutive integers, 32.9% do not round-trip near 1e8
//    and 45.0% do not near 1e12. A counter that ticks up by one is the most
//    common object in this genre and above 1e15 it would silently stop
//    moving. The README's only warning is "prioritize speed over accuracy",
//    and its 4.5x-over-decimal.js claim traces to a single 2017 README commit
//    by the author with a profiler screenshot as its whole evidence.
//    Vendoring also costs a LICENSE file, a pinned version, a sha256 and a
//    VENDORED.md line, for a dependency whose shipped ESM build is one
//    minified line and which itself depends on the npm package pad-end.
//
// 2. PORT THE IDEAS OF verylargenumbers.js (the in-house module in Iron
//    Spine). It is BigInt-backed, which makes it exact at every size, and
//    that is the right instinct. Rejected for three reasons. It is
//    INTEGER-ONLY: division truncates and 1.15 becomes 1, so a geometric cost
//    curve cannot be expressed in it at all. Its operations MUTATE (add()
//    changes the receiver and returns it), which is the opposite of the
//    contract here and the source of aliasing bugs the moment a cost is
//    stored and reused. And BigInt cost is linear in the digit count, so it
//    gets worse exactly where a big-number library is supposed to earn its
//    keep: measured below, one multiply costs 52 ns at 1e20, 1,819 ns at
//    1e600 and 58,790 ns at 1e6000. That is 50x this module at 1e600 and
//    1,600x at 1e6000, and it keeps going, while every digit stays in memory.
//    Late game in an idle game is precisely the large-exponent case.
//
// 3. THIS: fresh, hybrid, immutable. Exact below 2^53 where break_infinity is
//    not, fractional where BigInt is not, flat-cost at every magnitude where
//    BigInt is not, one self-contained file a game can copy, no ledger entry.
//
// MEASURED, 1e7 operations each unless noted, node v22.22.1:
//
//   double add        12.0 ms    1.20 ns/op   the floor: what we give up
//   double mul        14.8 ms    1.48 ns/op
//   Big add plain    252.8 ms   25.28 ns/op   inside the plain band
//   Big mul plain    153.5 ms   15.35 ns/op
//   Big add big      612.0 ms   61.20 ns/op   normalised, at 1e400
//   Big mul big      363.7 ms   36.37 ns/op
//   Big div big      568.8 ms   56.88 ns/op
//   Big cmp big      265.1 ms   26.51 ns/op
//   Big pow(r, 100)  698.0 ms  348.98 ns/op   2e6 ops; ~10 multiplies each
//   break_inf add    963.2 ms   96.32 ns/op   and wrong, see above
//   break_inf mul    343.8 ms   34.38 ns/op
//   break_inf cmp    153.5 ms   15.35 ns/op
//   BigInt add 1e20  507.0 ms   50.70 ns/op
//   BigInt mul 1e20  521.8 ms   52.18 ns/op
//   BigInt add 1e600 1117.8 ms 111.78 ns/op
//   BigInt mul 1e600  18.2 s   1819.34 ns/op
//   BigInt mul 1e6k   58.8 s  58790.49 ns/op  1e6 ops
//
// A frame's worth of work at 61 ns an operation is 16,000 additions in one
// millisecond, so a game runs out of things to add long before it runs out of
// frame. Formatting a number costs more than adding one.
//
// CONTRACT
//   - Values are immutable. Every operation returns a new Big; nothing here
//     writes to its arguments. The *Into functions are the one exception and
//     they say so in their names: they take the destination first.
//   - Integers with |v| < 2^53 are exact through add, sub and mul, and
//     compare exactly.
//   - Values above that carry ~15-16 significant digits, which is what a
//     double mantissa holds. Nothing in a game reads the 17th digit.
//   - Exponents are doubles, so the ceiling is about 10^(9e15). Past that the
//     exponent itself stops being able to count, and pow() says so.
// ---------------------------------------------------------------------------

// Below this magnitude the mantissa holds the whole value and e is 0. It is
// 2^53 exactly: the largest power of two where every integer below it is a
// distinct double, which is what makes the exactness promise true.
const PLAIN_MAX = 9007199254740992;

// The small end of the plain band. A double keeps full relative precision
// down to about 2.2e-308; stopping at 1e-300 leaves room for a few
// multiplications before subnormals would start eating digits.
const PLAIN_MIN = 1e-300;

// 10^0 .. 10^22 are exactly representable doubles; the negative half is
// correctly rounded and identical to Math.pow, so the table is a speed aid,
// not a correctness one. Math.pow costs 20-40 ns and this path runs on every
// operation that leaves the plain band.
const POW10 = [];
for (let i = -22; i <= 22; i++) POW10.push(Number('1e' + i));

function pow10(e) {
  if (e >= -22 && e <= 22) return POW10[e + 22];
  return Math.pow(10, e);
}

// A value: v = m * 10^e. Treat both fields as read-only.
export class Big {
  constructor(m, e) {
    this.m = m;
    this.e = e;
  }
  add(x) { return add(this, x); }
  sub(x) { return sub(this, x); }
  mul(x) { return mul(this, x); }
  div(x) { return div(this, x); }
  pow(n) { return pow(this, n); }
  neg() { return neg(this); }
  abs() { return abs(this); }
  cmp(x) { return cmp(this, x); }
  lt(x) { return cmp(this, x) < 0; }
  lte(x) { return cmp(this, x) <= 0; }
  gt(x) { return cmp(this, x) > 0; }
  gte(x) { return cmp(this, x) >= 0; }
  eq(x) { return cmp(this, x) === 0; }
  log10() { return log10(this); }
  toNumber() { return toNumber(this); }
  toString() { return str(this); }
  toJSON() { return str(this); }
  get sign() { return this.m < 0 ? -1 : this.m > 0 ? 1 : 0; }
}

// Canonicalise into a Big. `out` writes in place instead of allocating; it is
// how the *Into functions avoid a new object per operation in a hot loop.
function make(m, e, out) {
  if (e === 0) {
    const a = m < 0 ? -m : m;
    if (a >= PLAIN_MIN && a < PLAIN_MAX) return out ? set(out, m, 0) : new Big(m, 0);
  }
  return norm(m, e, out);
}

function set(out, m, e) {
  out.m = m;
  out.e = e;
  return out;
}

// The slow half of make: shift the mantissa into [1, 10), then collapse back
// into the plain band if the value fits there after all.
function norm(m, e, out) {
  if (m === 0 || !Number.isFinite(m)) return out ? set(out, m === 0 ? 0 : m, 0) : new Big(m === 0 ? 0 : m, 0);
  let a = m < 0 ? -m : m;
  // Adding or multiplying two normalised mantissas lands within a decade or
  // two of the target, so try the cheap shifts before reaching for log10.
  if (a >= 10) {
    if (a < 100) { m /= 10; e += 1; }
    else { const s = Math.floor(Math.log10(a)); m /= pow10(s); e += s; }
  } else if (a < 1) {
    if (a >= 0.1) { m *= 10; e -= 1; }
    else {
      const s = Math.floor(Math.log10(a));
      // Multiplying by 10^-s keeps precision that dividing by a subnormal
      // would lose; past 1e300 it takes two steps so the factor stays finite.
      if (s >= -300) m *= pow10(-s);
      else { m *= 1e300; m *= pow10(-s - 300); }
      e += s;
    }
  }
  a = m < 0 ? -m : m;
  // log10 can land one decade out at a boundary; one step always fixes it.
  if (a >= 10) { m /= 10; e += 1; }
  else if (a < 1 && a > 0) { m *= 10; e -= 1; }
  if (e > -301 && e < 16) {
    const v = m * pow10(e);
    const av = v < 0 ? -v : v;
    if (av >= PLAIN_MIN && av < PLAIN_MAX) return out ? set(out, v, 0) : new Big(v, 0);
  }
  return out ? set(out, m, e) : new Big(m, e);
}

export const ZERO = new Big(0, 0);
export const ONE = new Big(1, 0);

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const ZERO_RE = /^[+-]?0*\.?0*$/;

// A decimal string with more than about 309 digits in front of the point
// parses to Infinity through Number(), and one with more than about 324
// zeros behind it parses to 0. Both are ordinary shapes for a save file
// written by a game that has been played, so long strings are split into a
// mantissa and an exponent by counting digits instead.
function parseLongDecimal(s) {
  let sign = 1, i = 0;
  if (s[0] === '+') i = 1;
  else if (s[0] === '-') { sign = -1; i = 1; }
  const body = s.slice(i);
  const dot = body.indexOf('.');
  const intPart = dot < 0 ? body : body.slice(0, dot);
  const digits = intPart + (dot < 0 ? '' : body.slice(dot + 1));
  let first = 0;
  while (first < digits.length && digits[first] === '0') first++;
  if (first === digits.length) return ZERO;
  const trimmed = digits.slice(first);
  // 25 digits is more than a double keeps; the rest cannot change the value.
  return make(sign * Number(trimmed[0] + '.' + trimmed.slice(1, 25)), intPart.length - 1 - first);
}

// Coerce anything into a Big. Numbers and decimal strings both work, and the
// string form is how a value past 1e308 survives a save file.
export function big(v) {
  if (v instanceof Big) return v;
  if (typeof v === 'number') return make(v, 0);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!NUM_RE.test(s)) return new Big(NaN, 0);
    const i = s.search(/[eE]/);
    const mantStr = i < 0 ? s : s.slice(0, i);
    const exp = i < 0 ? 0 : Number(s.slice(i + 1));
    const n = Number(mantStr);
    // The direct parse is exact when it works, so only fall back when it did
    // not: an overflow to Infinity, or an underflow to zero from a non-zero
    // string.
    if (Number.isFinite(n) && (n !== 0 || ZERO_RE.test(mantStr))) return make(n, exp);
    const d = parseLongDecimal(mantStr);
    return make(d.m, d.e + exp);
  }
  if (v && typeof v.m === 'number' && typeof v.e === 'number') return make(v.m, v.e);
  if (v === null || v === undefined) return ZERO;
  return new Big(NaN, 0);
}

export function isBig(v) { return v instanceof Big; }

// The exponent the value would have if it were normalised. Only the mixed
// paths need it; the plain and normalised fast paths never call it.
function trueExp(x) {
  if (x.e !== 0) return x.e;
  if (x.m === 0) return -Infinity;
  return Math.floor(Math.log10(x.m < 0 ? -x.m : x.m));
}

// x rescaled so that its value reads as (result) * 10^e.
function mantissaAt(x, e) {
  const d = x.e - e;
  return d === 0 ? x.m : x.m * pow10(d);
}

// Two values more than this many decades apart cannot affect each other: a
// double carries under 17 significant digits.
const REACH = 18;

function addCore(a, b, out) {
  // The hot path. Both inside the plain band, so this is exactly the IEEE
  // sum and integers below 2^53 come out exact.
  if (a.e === 0 && b.e === 0) return make(a.m + b.m, 0, out);
  if (a.m === 0) return out ? set(out, b.m, b.e) : b;
  if (b.m === 0) return out ? set(out, a.m, a.e) : a;
  const ea = trueExp(a), eb = trueExp(b);
  if (ea - eb > REACH) return out ? set(out, a.m, a.e) : a;
  if (eb - ea > REACH) return out ? set(out, b.m, b.e) : b;
  const e = ea > eb ? ea : eb;
  return make(mantissaAt(a, e) + mantissaAt(b, e), e, out);
}

export function add(a, b) { return addCore(big(a), big(b)); }
export function sub(a, b) { return addCore(big(a), neg(big(b))); }

export function mul(a, b) {
  a = big(a); b = big(b);
  // Mantissas are bounded (under 1e16 plain, under 10 normalised), so this
  // product can never overflow a double no matter how large the values are.
  return make(a.m * b.m, a.e + b.e);
}

export function div(a, b) {
  a = big(a); b = big(b);
  if (b.m === 0) return new Big(a.m === 0 ? NaN : (a.m < 0 ? -Infinity : Infinity), 0);
  return divCore(a, b);
}

function divCore(a, b, out) {
  const q = a.m / b.m;
  if (Number.isFinite(q) && (q !== 0 || a.m === 0)) return make(q, a.e - b.e, out);
  // A plain tiny divisor can overflow the raw quotient. Renormalising both
  // mantissas into [1, 10) first puts the quotient in [0.1, 10).
  const na = norm(a.m, a.e), nb = norm(b.m, b.e);
  const ma = na.e === 0 ? na.m / pow10(trueExp(na)) : na.m;
  const mb = nb.e === 0 ? nb.m / pow10(trueExp(nb)) : nb.m;
  return make(ma / mb, trueExp(na) - trueExp(nb), out);
}

export function neg(a) {
  a = big(a);
  return a.m === 0 ? ZERO : new Big(-a.m, a.e);
}

export function abs(a) {
  a = big(a);
  return a.m < 0 ? new Big(-a.m, a.e) : a;
}

// -1, 0 or 1. NaN on either side gives NaN, which is false in every
// comparison, the same as a bare double.
export function cmp(a, b) {
  a = big(a); b = big(b);
  const ra = a.m === Infinity ? 1 : a.m === -Infinity ? -1 : 0;
  const rb = b.m === Infinity ? 1 : b.m === -Infinity ? -1 : 0;
  if (ra || rb) return ra === rb ? 0 : (ra < rb ? -1 : 1);
  if (Number.isNaN(a.m) || Number.isNaN(b.m)) return NaN;
  if (a.m === 0) return b.m === 0 ? 0 : (b.m > 0 ? -1 : 1);
  if (b.m === 0) return a.m > 0 ? 1 : -1;
  const sa = a.m > 0 ? 1 : -1;
  if ((b.m > 0 ? 1 : -1) !== sa) return sa;
  // Same sign, so compare magnitudes and flip for negatives. The canonical
  // form is what makes this work without a logarithm: a plain value is
  // always smaller in magnitude than a normalised value with a positive
  // exponent and always larger than one with a negative exponent.
  const am = a.m < 0 ? -a.m : a.m;
  const bm = b.m < 0 ? -b.m : b.m;
  let mc;
  if (a.e === b.e) mc = am < bm ? -1 : am > bm ? 1 : 0;
  else if (a.e === 0) mc = b.e > 0 ? -1 : 1;
  else if (b.e === 0) mc = a.e > 0 ? 1 : -1;
  else mc = a.e < b.e ? -1 : 1;
  return sa > 0 ? mc : -mc;
}

export function lt(a, b) { return cmp(a, b) < 0; }
export function lte(a, b) { return cmp(a, b) <= 0; }
export function gt(a, b) { return cmp(a, b) > 0; }
export function gte(a, b) { return cmp(a, b) >= 0; }
export function eq(a, b) { return cmp(a, b) === 0; }
export function max(a, b) { return cmp(a, b) >= 0 ? big(a) : big(b); }
export function min(a, b) { return cmp(a, b) <= 0 ? big(a) : big(b); }

// Base-10 logarithm of the magnitude. This is the number that stays a
// perfectly ordinary double no matter how large the value gets, which is why
// the rest of the kit does its reasoning about scale here.
export function log10(a) {
  a = big(a);
  if (a.m === 0) return -Infinity;
  return a.e + Math.log10(a.m < 0 ? -a.m : a.m);
}

// Binary exponentiation. Every intermediate goes through mul, so while the
// running product stays under 2^53 the result is exact: 3^33 comes out as
// 5559060566555523, not 5559060566555522.9.
function ipow(a, n) {
  let result = ONE, base = a, k = n < 0 ? -n : n;
  while (k > 0) {
    if (k & 1) result = mul(result, base);
    k >>>= 1;
    if (k > 0) base = mul(base, base);
  }
  return n < 0 ? div(ONE, result) : result;
}

// Whole exponents up to this use binary exponentiation (about 2*log2(n)
// roundings). Past it, and for fractional exponents, the log-space path
// costs one rounding but only keeps as many digits as the exponent leaves.
const IPOW_MAX = 1e6;

export function pow(a, n) {
  a = big(a);
  if (isBig(n) || typeof n === 'string') n = toNumber(big(n));
  if (n === 0) return ONE;
  if (n === 1) return a;
  if (a.m === 0) return n > 0 ? ZERO : new Big(Infinity, 0);
  if (Number.isInteger(n) && Math.abs(n) <= IPOW_MAX) return ipow(a, n);
  const negBase = a.m < 0;
  if (negBase && !Number.isInteger(n)) return new Big(NaN, 0);
  const l = log10(a) * n;
  if (!Number.isFinite(l)) return new Big(l > 0 ? Infinity : 0, 0);
  // Past 2^53 decades the exponent cannot count in whole numbers any more,
  // so the answer would be a lie with a precise-looking mantissa.
  if (Math.abs(l) >= PLAIN_MAX) return new Big(l > 0 ? Infinity : 0, 0);
  const e = Math.floor(l);
  let m = Math.pow(10, l - e);
  if (negBase && Math.abs(n % 2) === 1) m = -m;
  return make(m, e);
}

export function sqrt(a) {
  a = big(a);
  if (a.m < 0) return new Big(NaN, 0);
  if (a.e === 0) return make(Math.sqrt(a.m), 0);
  const half = a.e / 2;
  const e = Math.floor(half);
  return make(Math.sqrt(a.m * (half === e ? 1 : 10)), e);
}

export function floor(a) {
  a = big(a);
  // Above 2^53 every value is already a whole number of its own last digit.
  if (a.e !== 0) return a;
  return make(Math.floor(a.m), 0);
}

export function toNumber(a) {
  a = big(a);
  return a.e === 0 ? a.m : a.m * pow10(a.e);
}

// Round-trips through big(): String(m) is the shortest decimal that reads
// back as the same double, so a save keeps every bit it had.
function str(a) {
  if (a.e === 0) return String(a.m);
  return String(a.m) + 'e' + a.e;
}

export function toString(a) { return str(big(a)); }

// ---------------------------------------------------------------------------
// In-place variants.
//
// A Big is two numbers in an object, so a game that runs a few thousand
// operations a frame allocates a few thousand short-lived objects a frame.
// Measured in isolation with the order alternated across five runs, addInto
// costs 261-294 ms per 5e6 operations against 356-401 ms for add: writing
// into a destination is about 25% faster than allocating a result. Inside a
// longer benchmark run the gap disappears into GC noise entirely.
//
// So allocation is NOT the thing to optimise first, and the immutable API is
// the default. These exist for the one case where 25% is worth the ugliness:
// a per-entity accumulator updated every frame across tens of thousands of
// entities, where the garbage scales with the horde. The destination comes
// first and is the only thing written.
// ---------------------------------------------------------------------------

export function scratch(v) { const b = big(v); return new Big(b.m, b.e); }
export function copyInto(out, a) { a = big(a); return set(out, a.m, a.e); }
export function addInto(out, a, b) { return addCore(big(a), big(b), out); }
export function subInto(out, a, b) { return addCore(big(a), neg(big(b)), out); }
export function mulInto(out, a, b) { a = big(a); b = big(b); return make(a.m * b.m, a.e + b.e, out); }
export function divInto(out, a, b) {
  a = big(a); b = big(b);
  if (b.m === 0) return set(out, a.m === 0 ? NaN : (a.m < 0 ? -Infinity : Infinity), 0);
  return divCore(a, b, out);
}

export default big;
