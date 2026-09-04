// ---------------------------------------------------------------------------
// One market per good.
//
//   price = base * cycle(t) * exp(-pressure)
//
// Selling adds to pressure, buying takes it away, and pressure drains back
// toward zero over the recovery time. The revenue of a sale is the integral
// of the price along the way down, in closed form, so selling ten units in
// one go and in ten goes of one are worth exactly the same and neither can be
// gamed by splitting.
//
// The cycle is a slow swell around the base built from two sines with
// periods and phases drawn from the seed. It is deterministic in t, which
// makes it readable, forecastable, and identical after a save is reloaded.
//
// Two consequences worth knowing:
//   - A single sale can never earn more than base * cycle * absorb. Past
//     about three times absorb the extra units are worth nearly nothing.
//   - Selling steadily at q units per second settles at price
//     base * exp(-q * recovery / absorb). Revenue per second peaks at
//     q = absorb / recovery and can never exceed base * absorb / (recovery * e).
//     That number is the market's CEILING and the reason to spread a horde
//     across many goods.
// ---------------------------------------------------------------------------

import { hash, stream } from './rng.js?v=17';

const TAU = Math.PI * 2;

/** A small integer hash of a string, for seeding one market from a run seed. */
export const hashId = hash;

/**
 * @param {object} o
 * @param {number} o.base      coin per unit at a calm market
 * @param {number} o.absorb    units it takes before it buckles
 * @param {number} o.recovery  seconds for pressure to fall by e
 * @param {number} o.seed      run seed, mixed with the id
 * @param {string} o.id
 * @param {object} o.cycle     { amplitude, periodMin, periodMax }
 * @param {number} [o.amp]     swell for this market, overriding the default;
 *                             a salted seam swings hard, a still one barely
 *                             moves at all
 */
export function createMarket(o) {
  const r = stream(hash(o.seed, o.id));
  const span = o.cycle.periodMax - o.cycle.periodMin;
  const m = {
    id: o.id,
    base: o.base,
    absorb: o.absorb,
    recovery: o.recovery,
    amp: Number.isFinite(o.amp) ? o.amp : o.cycle.amplitude,
    p1: o.cycle.periodMin + r() * span,
    f1: r() * TAU,
    p2: (o.cycle.periodMin + r() * span) * 0.37,
    f2: r() * TAU,
    pressure: 0,
    history: [],
    sold: 0,     // lifetime units sold into it
    bought: 0,
  };
  return m;
}

/** The swell at time t: a number around 1, within +-amplitude. */
export function cycleAt(m, t) {
  return 1 + m.amp * (0.72 * Math.sin(TAU * t / m.p1 + m.f1) + 0.28 * Math.sin(TAU * t / m.p2 + m.f2));
}

/** What the market absorbs and how fast it recovers, after the rites. */
export function effective(m, mods) {
  const absorb = m.absorb * ((mods && mods.absorbMult) || 1);
  const recovery = m.recovery / ((mods && mods.recoveryMult) || 1);
  return { absorb, recovery };
}

/** The price a unit fetches right now. */
export function priceAt(m, t) {
  return m.base * cycleAt(m, t) * Math.exp(-m.pressure);
}

/** Demand as the player sees it: 1 is a calm market, 0 is a buckled one. */
export function demandOf(m) {
  return Math.exp(-m.pressure);
}

/**
 * Sell q units at time t. Returns the coin earned. Exact: the revenue is the
 * integral of the falling price, so order and batching do not matter.
 */
export function sell(m, q, t, mods) {
  if (!(q > 0)) return 0;
  const { absorb } = effective(m, mods);
  const head = m.base * cycleAt(m, t) * Math.exp(-m.pressure);
  const revenue = head * absorb * (1 - Math.exp(-q / absorb));
  m.pressure += q / absorb;
  m.sold += q;
  return revenue;
}

/** Buy q units at time t. Returns the coin it costs. The mirror of sell. */
export function buy(m, q, t, mods) {
  if (!(q > 0)) return 0;
  const { absorb } = effective(m, mods);
  const head = m.base * cycleAt(m, t) * Math.exp(-m.pressure);
  const cost = head * absorb * (Math.exp(q / absorb) - 1);
  m.pressure -= q / absorb;
  m.bought += q;
  return cost;
}

/** Coin q units would fetch right now, without selling them. */
export function quote(m, q, t, mods) {
  if (!(q > 0)) return 0;
  const { absorb } = effective(m, mods);
  return m.base * cycleAt(m, t) * Math.exp(-m.pressure) * absorb * (1 - Math.exp(-q / absorb));
}

/** Coin q units would cost right now, without buying them. */
export function quoteBuy(m, q, t, mods) {
  if (!(q > 0)) return 0;
  const { absorb } = effective(m, mods);
  return m.base * cycleAt(m, t) * Math.exp(-m.pressure) * absorb * (Math.exp(q / absorb) - 1);
}

/** Let dt seconds of recovery pass. Closed form, so the step size is free. */
export function relax(m, dt, mods) {
  if (!(dt > 0) || m.pressure === 0) return;
  const { recovery } = effective(m, mods);
  m.pressure *= Math.exp(-dt / recovery);
  if (Math.abs(m.pressure) < 1e-12) m.pressure = 0;
}

/** The most coin per second this market can ever pay for a steady flow. */
export function ceiling(m, mods) {
  const { absorb, recovery } = effective(m, mods);
  return m.base * absorb / (recovery * Math.E);
}

/** The flow, in units per second, at which the ceiling is reached. */
export function bestFlow(m, mods) {
  const { absorb, recovery } = effective(m, mods);
  return absorb / recovery;
}

/**
 * How saturated a steady flow of q units per second leaves the market: the
 * pressure it settles at. 1 means the price sits at base/e - the ceiling.
 * Above 1 the extra units earn less than nothing would have.
 */
export function saturation(m, q, mods) {
  if (!(q > 0)) return 0;
  const { absorb, recovery } = effective(m, mods);
  return q * recovery / absorb;
}

/** Record a chart point. Keeps at most `keep` points. */
export function sample(m, t, keep) {
  m.history.push(round3(priceAt(m, t)));
  if (m.history.length > keep) m.history.splice(0, m.history.length - keep);
}

/** The cycle ahead, for the chart: `n` points, `step` seconds apart. */
export function forecast(m, t, n, step) {
  const out = [];
  const p = Math.exp(-m.pressure);
  for (let i = 1; i <= n; i++) out.push(m.base * cycleAt(m, t + i * step) * p);
  return out;
}

function round3(x) { return Math.round(x * 1000) / 1000; }

/** What a save keeps of a market. The swell is regenerated from the seed. */
export function snapshotMarket(m) {
  return { id: m.id, pressure: m.pressure, history: m.history.slice(), sold: m.sold, bought: m.bought };
}

export function restoreMarket(m, snap) {
  if (!snap) return m;
  m.pressure = Number.isFinite(snap.pressure) ? snap.pressure : 0;
  m.history = Array.isArray(snap.history) ? snap.history.filter(Number.isFinite) : [];
  m.sold = Number.isFinite(snap.sold) ? snap.sold : 0;
  m.bought = Number.isFinite(snap.bought) ? snap.bought : 0;
  return m;
}
