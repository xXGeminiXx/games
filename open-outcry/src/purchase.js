// Vendored from the game-art foundation (lib/purchase.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Geometric cost curves and buying in bulk.
//
// Depends on ./bignum.js (a game that copies this file copies that one too).
//
// The curve every incremental game uses is cost(n) = base * r^n, where n is
// how many you already own. Buying k more costs the sum of k terms of a
// geometric series, which has a closed form:
//
//     sum = base * r^n * (r^k - 1) / (r - 1)          r != 1
//     sum = base * k                                  r == 1
//
// and the largest k a wallet can afford inverts it:
//
//     k = floor( log( wallet * (r - 1) / (base * r^n) + 1 ) / log(r) )
//
// so buy-max on a thousand-item curve is arithmetic, not a loop. Everything
// here works with plain Numbers and with Big values from bignum.js; the
// LOGARITHM is always a plain double, because log10 of even 1e5000 is 5000.
//
// THE TWO BUGS THIS MODULE EXISTS TO PREVENT
//
// 1. A BUTTON THAT LIT UP AT RENDER AND WAS UNAFFORDABLE AT CLICK. Between
//    the frame that drew the button and the click that used it, the player
//    spent money somewhere else, or an upgrade raised the price. The fix is
//    that a button never carries a decision: it carries an id, and the click
//    handler calls quote() again against the wallet as it is at that instant.
//    quote() is cheap enough to call on every click of every button.
//
// 2. A BUY-100 BUTTON THAT DID NOTHING WHEN THE PLAYER COULD ONLY AFFORD 37.
//    An all-or-nothing bulk buy is silent failure: the number the player was
//    told to press does nothing and no text says why. quote() answers with
//    what is ACTUALLY buyable, so the caller can buy 37, label the button
//    "buy 37" and show the shortfall for the other 63. A game that really
//    wants all-or-nothing passes { partial: false } and still gets the
//    shortfall to show, so the button can explain itself either way.
// ---------------------------------------------------------------------------

import { big, isBig, sub, mul, div, pow, cmp, log10, toNumber, ZERO } from './bignum.js?v=2';

// Everything below 2^53 stays a plain double; past it the arithmetic moves
// into Big so the answers stay right.
const SAFE = 9007199254740992;

function needsBig(...xs) {
  for (const x of xs) {
    if (isBig(x)) return true;
    if (typeof x === 'number' && (x >= SAFE || x <= -SAFE)) return true;
    if (typeof x === 'string') return true;
  }
  return false;
}

// RETURN TYPES. A game that only ever holds plain Numbers gets plain Numbers
// back; it never has to learn about Big to use a shop. The moment a value
// stops fitting a double, or the caller hands in a Big, the answers are Bigs
// from there on. That is the whole rule, and it is why nothing here checks
// typeof on the way out.
function cast(v, useBig) {
  if (useBig) return big(v);
  if (!isBig(v)) return v;
  const n = toNumber(v);
  return Number.isFinite(n) && Math.abs(n) < SAFE ? n : v;
}

// The price of the (n+1)th one, given n owned. cost(base, r, 0) is base.
export function cost(base, r, n) {
  if (needsBig(base, r, n)) return mul(big(base), pow(big(r), toNumber(big(n))));
  const v = base * Math.pow(r, n);
  return Number.isFinite(v) && Math.abs(v) < SAFE ? v : mul(big(base), pow(big(r), n));
}

// The total price of the next k, given n owned. Closed form: no loop, so k
// can be a million.
export function total(base, r, n, k) {
  k = Math.floor(Number(k));
  if (k <= 0) return needsBig(base, r) ? ZERO : 0;
  if (needsBig(base, r, n, k)) return totalBig(big(base), big(r), toNumber(big(n)), k);
  if (r === 1) {
    const v = base * k;
    return Number.isFinite(v) && Math.abs(v) < SAFE ? v : totalBig(big(base), big(r), n, k);
  }
  const v = base * Math.pow(r, n) * (Math.pow(r, k) - 1) / (r - 1);
  if (Number.isFinite(v) && Math.abs(v) < SAFE) return v;
  return totalBig(big(base), big(r), n, k);
}

function totalBig(base, r, n, k) {
  const first = mul(base, pow(r, n));
  if (cmp(r, 1) === 0) return mul(first, k);
  return div(mul(first, sub(pow(r, k), 1)), sub(r, 1));
}

// The largest k with total(base, r, n, k) <= wallet.
//
// The closed form gives the answer directly, but a logarithm of a ratio of
// large numbers is only good to about fifteen digits, and one digit of error
// at the boundary is one item too many or too few, which is exactly where a
// player is looking. So the closed form supplies a starting guess and a
// bounded correction walks it to the exact answer: a handful of comparisons,
// never a loop over k.
export function maxAffordable(wallet, base, r, n) {
  const useBig = needsBig(wallet, base, r, n);
  const rn = Number(isBig(r) ? toNumber(r) : r);
  const nn = Number(isBig(n) ? toNumber(n) : n);
  if (!(rn > 0) || !Number.isFinite(rn)) return 0;
  if (cmp(wallet, 0) <= 0) return 0;
  // A free item is a configuration mistake, not a purchase: say so by
  // answering the honest infinity rather than dividing by zero.
  if (cmp(base, 0) <= 0) return Infinity;

  let guess;
  if (rn === 1) {
    // Flat price: how many times does base fit in the wallet.
    const q = useBig ? toNumber(div(big(wallet), big(base))) : wallet / base;
    guess = Math.floor(q);
  } else {
    // Work entirely in log10, which stays an ordinary double even when the
    // wallet is 1e5000: log10(wallet * (r-1) / (base * r^n)).
    const lw = log10(big(wallet));
    const lb = log10(big(base));
    const lr = Math.log10(rn);
    const lx = lw + Math.log10(Math.abs(rn - 1)) - lb - nn * lr;
    let lnum;
    if (rn > 1) {
      // x + 1, where x may be astronomically large or vanishingly small.
      lnum = lx > 15 ? lx : Math.log10(Math.pow(10, lx) + 1);
      guess = Math.floor(lnum / lr);
    } else {
      // r < 1: prices shrink, so the series converges and a big enough
      // wallet buys every remaining item. x is negative here.
      const x = -Math.pow(10, lx);
      if (x <= -1) return Infinity;
      guess = Math.floor(Math.log10(1 + x) / lr);
    }
  }
  if (!Number.isFinite(guess)) return guess > 0 ? Infinity : 0;
  if (guess < 0) guess = 0;

  // Correct the guess. Two or three steps is the worst seen; the cap is
  // there so a pathological input cannot hang a frame.
  let k = guess;
  let steps = 0;
  while (k > 0 && cmp(total(base, r, n, k), wallet) > 0 && steps++ < 64) k--;
  steps = 0;
  while (cmp(total(base, r, n, k + 1), wallet) <= 0 && steps++ < 64) k++;
  return k;
}

// What a button should say and what a click should do, computed against the
// wallet as it is right now.
//
//   quote(wallet, {base, r, owned}, 100)
//     -> { count, total, affordable, shortfall, asked, price }
//
//   count       how many can actually be bought (0 .. asked)
//   total       what those count cost (0 when count is 0)
//   affordable  true only when all `asked` are affordable
//   shortfall   what is still missing to afford all `asked` (0 if affordable)
//   asked       what was requested, after 'max' is resolved
//   price       the price of the very next one, for a per-item label
//
// `k` may be a number or the string 'max'. { partial: false } makes it
// all-or-nothing: count comes back 0 unless every one of them is affordable,
// and shortfall still says how far off the player is.
export function quote(wallet, curve, k, opts = {}) {
  const base = curve.base, r = curve.r === undefined ? curve.rate : curve.r;
  const owned = curve.owned === undefined ? (curve.n === undefined ? 0 : curve.n) : curve.owned;
  const partial = opts.partial !== false;
  const cap = opts.cap === undefined ? Infinity : opts.cap;
  const zero = needsBig(wallet, base, r) ? ZERO : 0;

  let asked;
  if (k === 'max' || k === Infinity) asked = maxAffordable(wallet, base, r, owned);
  else asked = Math.max(0, Math.floor(Number(k) || 0));
  asked = Math.min(asked, cap);
  if (!Number.isFinite(asked)) asked = Number.MAX_SAFE_INTEGER;

  const useBig = needsBig(wallet, base, r);
  const price = cast(cost(base, r, owned), useBig);
  if (asked <= 0) {
    return { count: 0, total: zero, affordable: false, shortfall: zero, asked: 0, price };
  }

  const askedTotal = total(base, r, owned, asked);
  if (cmp(askedTotal, wallet) <= 0) {
    return { count: asked, total: cast(askedTotal, useBig), affordable: true, shortfall: zero, asked, price };
  }

  const can = Math.min(maxAffordable(wallet, base, r, owned), asked);
  const shortfall = cast(sub(askedTotal, wallet), useBig);
  if (!partial || can <= 0) {
    return { count: 0, total: zero, affordable: false, shortfall, asked, price };
  }
  return { count: can, total: cast(total(base, r, owned, can), useBig), affordable: false, shortfall, asked, price };
}

// The bulk sizes an idle game puts on a row of buttons. A game can pass its
// own list; this is the one players expect.
export const BULK = [1, 10, 100, 1000, 'max'];

// ---------------------------------------------------------------------------
// Affordability transitions.
//
// UI.md: "becoming affordable is an event" - the button brightens once, a
// line lands in the log. The thing that makes it an event and not a state is
// the EDGE, and an edge needs the previous frame's answer. This keeps that
// one bit per price and reports only what changed, so a game can brighten a
// button once instead of every frame for as long as the player is rich.
//
// It is deliberately not a comparison of prices: a price that rises above
// the wallet has to go dark again, which is the same edge in the other
// direction and the half everyone forgets.
// ---------------------------------------------------------------------------

export function affordability() {
  const state = new Map();
  return {
    // prices: an object or Map of id -> price. Returns the ids whose state
    // changed since the last call, as [{ id, affordable, price }].
    update(wallet, prices) {
      const changes = [];
      const entries = prices instanceof Map ? prices.entries() : Object.entries(prices);
      const seen = new Set();
      for (const [id, price] of entries) {
        seen.add(id);
        const now = cmp(wallet, price) >= 0;
        // An id nobody has seen yet counts as DARK, not as unknown, because
        // dark is how a button is drawn before anything has happened. So the
        // first call reports only the things that are already affordable,
        // and a page does not open by playing an unaffordable animation for
        // every item in the shop.
        const was = state.has(id) ? state.get(id) : false;
        if (was !== now) {
          state.set(id, now);
          changes.push({ id, affordable: now, price });
        }
      }
      // An id that stopped being offered forgets its state, so if it comes
      // back it announces itself again rather than staying silently lit.
      for (const id of [...state.keys()]) if (!seen.has(id)) state.delete(id);
      return changes;
    },
    is(id) { return state.get(id) === true; },
    // For a load or a mode switch: the next update reports every id as new.
    clear() { state.clear(); },
    get size() { return state.size; },
  };
}

// A convenience for the common shape: one curve, a row of bulk buttons, one
// quote each, computed at the moment of drawing and again at the moment of
// clicking.
export function quoteRow(wallet, curve, sizes = BULK, opts = {}) {
  return sizes.map((k) => ({ size: k, ...quote(wallet, curve, k, opts) }));
}

export default quote;
