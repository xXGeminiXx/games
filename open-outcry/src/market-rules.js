// Vendored from the game-art foundation (lib/market-rules.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// The rules a market runs on: how an opinion about price changes, how big an
// order gets written, and what a shock does.
//
// These are separate from the exchange on purpose. Matching, escrow,
// conservation and the inspect API are the same machine everywhere; the
// CAUSAL SHAPE of a market - whether prices creep or run, whether a crowd
// settles or feeds a bubble, whether a shock is believed at once or slowly -
// is a choice each world makes. Two worlds that share this engine should not
// feel like the same market wearing different paint, and a player who learned
// how prices move in one should have to learn it again in the next.
//
// A rule set is plain functions in an object, so a world can ship its own
// without touching the engine:
//
//   new Market({ rules: { belief: BELIEFS.anchored, sizing: SIZING.conviction,
//                         shocks: { ...SHOCKS, blight: (m, s) => ... } } })
//
// The three belief rules here behave visibly differently on the same seed:
// `adaptive` finds a price and holds it, `anchored` crawls and lags a shock by
// many ticks, `momentum` overshoots every move and trends away.
//
// The band model itself is from Doran and Parberry's "Emergent Economies for
// Role Playing Games", by way of Lars Doucet:
// https://www.gamedeveloper.com/design/bazaarbot-an-open-source-economics-engine
// ---------------------------------------------------------------------------

import { BUY } from './orderbook.js?v=3';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const centreOf = (m, k) => (m.bLo[k] + m.bHi[k]) / 2;
const halfOf = (m, k) => (m.bHi[k] - m.bLo[k]) / 2;

// Every rule writes a belief through here. No opinion may sit further than
// `beliefBand` from what the market last paid: an agent whose valuation runs
// away stops being able to afford a single unit, stops posting, stops missing,
// and so never corrects. This is the guard rail, not a rule.
export function setBand(m, i, g, centre, half) {
  const o = m.opt, k = i * m.G + g;
  const ref = m.books[g].vwap(16) || m.goods[g].price;
  centre = clamp(centre, Math.max(1, ref / o.beliefBand), ref * o.beliefBand);
  half = clamp(half, centre * o.bandMin, centre * o.bandMax);
  m.bLo[k] = Math.max(1, centre - half);
  m.bHi[k] = centre + half;
}

export const BELIEFS = {
  // Confident after a fill, unsure after a miss, always drifting toward what
  // the market last paid. Finds a price within a few dozen ticks and holds it.
  adaptive: {
    name: 'adaptive',
    fill(m, i, g, price) {
      const k = i * m.G + g, c = centreOf(m, k);
      setBand(m, i, g, c + (price - c) * 0.5, halfOf(m, k) * m.opt.narrow);
    },
    miss(m, i, g) {
      const k = i * m.G + g, c = centreOf(m, k);
      const ref = m.books[g].vwap(16) || m.goods[g].price;
      setBand(m, i, g, c + (ref - c) * m.opt.drift, halfOf(m, k) * m.opt.widen);
    },
  },

  // A long-held view that a single trade barely revises. Prices crawl, the
  // spread stays wide, and a shock takes many ticks to be believed, so a
  // player who acts early on news is well paid for it.
  anchored: {
    name: 'anchored',
    fill(m, i, g, price) {
      const k = i * m.G + g, c = centreOf(m, k);
      setBand(m, i, g, c + (price - c) * 0.06, halfOf(m, k) * 0.99);
    },
    miss(m, i, g) {
      const k = i * m.G + g, c = centreOf(m, k);
      const ref = m.books[g].vwap(16) || m.goods[g].price;
      setBand(m, i, g, c + (ref - c) * 0.03, halfOf(m, k) * 1.01);
    },
  },

  // Extrapolates. A fill past where the agent thought the price was is read as
  // a reason to expect more of the same, so the band jumps beyond the trade
  // and trends feed on themselves. Markets run, break and run again instead of
  // settling, which is the shape a world wants when speculation is the story.
  momentum: {
    name: 'momentum',
    fill(m, i, g, price) {
      const k = i * m.G + g, c = centreOf(m, k);
      setBand(m, i, g, c + (price - c) * 1.7, halfOf(m, k) * 0.95);
    },
    miss(m, i, g) {
      const k = i * m.G + g, c = centreOf(m, k);
      const ref = m.books[g].vwap(16) || m.goods[g].price;
      setBand(m, i, g, c + (ref - c) * 0.45, halfOf(m, k) * 1.09);
    },
  },
};

// A price drawn from the agent's own band, never below a floor the caller
// supplies (a maker will not sell under what its inputs cost).
//
// Urgency rides on the ORDER, not on the belief: a household that has gone
// without pays over its own view to get fed this once, and still remembers
// what the thing is normally worth. Writing urgency into the belief instead
// leaves a chronically short crowd valuing the good at several times the
// market for the rest of the run, and the two sides never meet again.
function bandPrice(m, i, g, side, floor) {
  const k = i * m.G + g;
  const lo = Math.max(m.bLo[k], floor), hi = Math.max(lo, m.bHi[k]);
  let p = lo + m.r.next() * (hi - lo);
  if (side === BUY && m.hunger[i] > 0) p *= 1 + Math.min(0.5, 0.05 * m.hunger[i]);
  return Math.max(1, Math.round(p));
}

// How far inside its own band this price sits. Cheap relative to the band is a
// reason to buy more of it; dear is a reason to sell more of it.
function favour(m, i, g, side, price) {
  const k = i * m.G + g;
  const span = Math.max(1e-6, m.bHi[k] - m.bLo[k]);
  const f = side === BUY ? (m.bHi[k] - price) / span : (price - m.bLo[k]) / span;
  return clamp(f, 0.15, 1);
}

export const SIZING = {
  // Order size tracks how much room the agent has and how good the price
  // looks. A ladder of many small orders at many prices.
  need: {
    name: 'need',
    price: (m, i, g, side, role, floor) => bandPrice(m, i, g, side, floor),
    qty(m, i, g, side, role, price, room) {
      return Math.max(1, Math.round(room * favour(m, i, g, side, price)));
    },
  },

  // Everyone writes the same ticket. The book is thicker and blockier, fills
  // are lumpier, and a single order moves the price further.
  flat: {
    name: 'flat',
    price: (m, i, g, side, role, floor) => bandPrice(m, i, g, side, floor),
    qty(m, i, g, side, role, price, room) {
      return Math.max(1, Math.min(room, m.opt.maxOrder));
    },
  },

  // Size follows disagreement: the further the market is from what this agent
  // believes, the harder it backs its own view, and it crosses the spread to
  // do it. Produces violent corrections rather than a drift.
  conviction: {
    name: 'conviction',
    price(m, i, g, side, role, floor) {
      const k = i * m.G + g, c = centreOf(m, k);
      const ref = m.books[g].vwap(16) || m.goods[g].price;
      const gap = Math.abs(c - ref) / Math.max(1, ref);
      // Sure of itself: quote at the aggressive edge of the band and take
      // whatever is on the other side.
      const p = gap > 0.15 ? (side === BUY ? m.bHi[k] : m.bLo[k]) : bandPrice(m, i, g, side, floor);
      return Math.max(1, Math.round(Math.max(p, floor)));
    },
    qty(m, i, g, side, role, price, room) {
      const k = i * m.G + g, c = centreOf(m, k);
      const ref = m.books[g].vwap(16) || m.goods[g].price;
      const gap = clamp(Math.abs(c - ref) / Math.max(1, ref), 0.05, 1);
      return Math.max(1, Math.round(room * (0.3 + gap)));
    },
  },
};

// A shock is a named function that runs once per tick while it is live. A
// world adds its own kind by putting another entry in this object.
export const SHOCKS = {
  // Production throttled to a fraction of normal.
  supply(m, s) { m.prodMul[s.g] *= s.factor; },
  // Households destroy more per tick than usual.
  demand(m, s) { m.consMul[s.g] *= s.factor; },
  // A skim off every account, taken once per tick into the tax pot.
  tax(m, s) { m.taxBps += s.rateBps; },
};

export const DEFAULT_RULES = { belief: BELIEFS.adaptive, sizing: SIZING.need, shocks: SHOCKS };

export default { BELIEFS, SIZING, SHOCKS, DEFAULT_RULES, setBand };
