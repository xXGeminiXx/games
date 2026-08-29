// ---------------------------------------------------------------------------
// Prices.
//
// Everything bought more than once gets more expensive by a fixed ratio, which
// is the oldest and most reliable shape there is for a game whose numbers grow
// without bound: it never stops the player and it never lets them run away.
//
// Every price question is answered in closed form rather than by looping. A
// loop is fine for buying ten and quietly catastrophic for buying a hundred
// thousand, and the two must give the same answer, so there is one
// implementation and the loop is only ever used to check it in a test.
// ---------------------------------------------------------------------------

/** Price of the next single unit when `owned` are already held. */
export function priceAt(base, ratio, owned) {
  if (!(ratio > 0)) return Infinity;
  if (ratio === 1) return base;
  return base * Math.pow(ratio, owned);
}

/**
 * Price of buying `k` more when `owned` are already held.
 *
 * The sum of a geometric run, which is exact for any k and does not care how
 * large k is. Buying zero costs nothing; a nonsensical k costs nothing.
 */
export function priceOf(base, ratio, owned, k) {
  if (!(k > 0)) return 0;
  if (!(ratio > 0)) return Infinity;
  if (ratio === 1) return base * k;
  const first = base * Math.pow(ratio, owned);
  // One unit is the price of that unit. Running it through the sum instead
  // divides two numbers that are equal in arithmetic and not in floating
  // point, and comes back a hair over - which is enough to refuse a purchase
  // a player has exactly the money for.
  if (k === 1) return first;
  return first * (Math.pow(ratio, k) - 1) / (ratio - 1);
}

// How far over a price may land and still count as affordable. A geometric
// sum and a logarithm disagree in the last few bits, and a player should never
// be refused a purchase over an error that small.
//
// It is ADDED rather than multiplied. Multiplying funds by a number above one
// overflows to infinity at the top of the float range, and a comparison
// against infinity is true forever, which is a loop that never ends rather
// than an answer that is slightly wrong.
const SLACK = 1e-9;

/** Whether a price is within reach of some funds, allowing for float drift. */
function within(price, funds) {
  if (!Number.isFinite(price)) return false;
  return price <= funds + Math.abs(funds) * SLACK;
}

/**
 * The most that can be afforded with `funds`.
 *
 * Solving the sum above for k. The logarithm is the reason a player can hold
 * an unreadable pile of scrip and still be told exactly how many machines it
 * buys, instantly, without the game counting them one at a time.
 *
 * A ratio at or below one would let a purchase get cheaper the more of it you
 * own, which compounds the wrong way and ends in a number no arithmetic can
 * recover from. It is refused here rather than trusted.
 */
export function maxAffordable(base, ratio, owned, funds, cap) {
  const limit = cap === undefined ? Infinity : cap;
  if (!(funds > 0) || !(base > 0)) return 0;
  if (!(ratio > 0)) return 0;
  if (ratio <= 1) {
    // A flat price. Guarded rather than extrapolated, because a ratio below
    // one is a fault somewhere else and must not be answered with a number.
    if (ratio < 1) return 0;
    return Math.max(0, Math.min(limit, Math.floor(funds / base)));
  }
  const first = base * Math.pow(ratio, owned);
  if (!Number.isFinite(first) || first <= 0) return 0;
  const inner = 1 + funds * (ratio - 1) / first;
  if (!(inner > 1)) return 0;
  let k = Math.floor(Math.log(inner) / Math.log(ratio) + 1e-9);
  if (!Number.isFinite(k) || k < 0) return 0;
  // The logarithm and the sum are computed differently and disagree in the
  // last bits, so at the boundary the count can be one more than the money
  // actually buys. Settled against the sum itself, which is the arithmetic
  // the purchase will really use.
  // Settled against the sum the purchase will really be charged by. Both
  // loops carry a hard step limit: a settling loop is a correction of a few
  // units at most, so one that runs away has been given something no answer
  // fits, and stopping with a slightly wrong number beats not stopping.
  let guard = 64;
  while (k > 0 && guard-- > 0 && !within(priceOf(base, ratio, owned, k), funds)) k--;
  guard = 64;
  while (guard-- > 0 && within(priceOf(base, ratio, owned, k + 1), funds)) k++;
  return Math.min(limit, k);
}

/**
 * How many units a bulk button should buy, and what that costs.
 *
 * `want` is a number, or the string 'max'. The answer is never more than can
 * be afforded and never more than any cap allows, so a button either buys
 * something or is plainly dead, and never half-buys.
 */
export function bulkBuy(base, ratio, owned, funds, want, cap) {
  const most = maxAffordable(base, ratio, owned, funds, cap);
  const k = want === 'max' ? most : Math.min(most, Math.max(0, Math.floor(want)));
  return { k, cost: k > 0 ? priceOf(base, ratio, owned, k) : 0 };
}

/** The standard set of bulk steps, and the one the player has chosen. */
export const BULK_STEPS = [1, 10, 100, 1000, 'max'];

export function bulkLabel(step) {
  return step === 'max' ? 'max' : 'x' + step;
}
