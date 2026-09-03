// ---------------------------------------------------------------------------
// The next thing worth doing.
//
// This game is a chain - the tips reach ground, bare soil and dead wood give
// up minerals, the tips carry them to the trees, the trees pay sugar, and the
// sugar buys more tips and more ground. Every link is on the page somewhere,
// which is not the same as any of it being obvious. So one line at the top of
// the journal always names the single thing most worth doing and says why, in
// the same figures the rest of the page is showing.
//
// The order below is the whole of the advice. Nothing here changes the state
// and nothing here is required: it is a compass, and a player who ignores it
// is playing the same game.
// ---------------------------------------------------------------------------

import * as Lore from './lore.js?v=10';
import * as Tr from './traits.js?v=10';
import { fmt, fmtCoin } from './numbers.js?v=10';

/** The share of the mineral flow going to waste before it is worth saying. */
const WASTE = 0.08;
/** How much better the best price has to be before moving a share is worth it. */
const SPREAD = 1.35;

/**
 * @returns {{key: string, text: string}} the line, and the key it came from so
 *          a caller can tell one piece of advice from the next.
 */
export function next(sim, cfg) {
  const state = sim.state;
  const f = state.flags;
  const say = (key, values) => ({ key, text: Lore.ui('next.' + key, values) });

  // The opening: there is one button, and it is not obvious that pressing it
  // is meant to be temporary.
  if (state.tipCount === 0) {
    return state.sugar >= sim.tipCost(1) ? say('firstTip') : say('hand');
  }

  const lastRing = state.ring >= cfg.world.rings;
  const empty = sim.rt.frontier.size === 0;

  if (lastRing && sim.beyondOffered() && state.sugar >= sim.beyondCost()) {
    return say('beyond', {
      level: Lore.levelInfo(state.level).name,
      next: Lore.levelInfo(state.level + 1).name,
    });
  }

  // Throughput. The tips are both the front and the freight, and a front too
  // small to carry what the ground gives up is the one mistake that costs the
  // whole run and shows nowhere else.
  const carry = sim.carry();
  if (f.trees && carry.produced > 0 && carry.carried < carry.produced * (1 - WASTE)) {
    return say('waste', {
      produced: fmtCoin(carry.produced),
      lost: fmtCoin(carry.produced - carry.carried),
    });
  }

  // Ground to open, and the money in hand to open it.
  const ringCost = !lastRing ? sim.ringCost() : 0;
  if (empty && !lastRing && state.sugar >= ringCost) return say('ring');

  // The market. Minerals sent where the price is highest fetch more sugar for
  // the same minerals, and the prices move with the year. This sits above
  // saving for a ring on purpose: while the sugar piles up, moving the shares
  // is the one thing that makes it pile up faster.
  if (f.trees) {
    const market = sim.market();
    let best = null, worst = null;
    for (const key in market) {
      const row = market[key];
      if (!(row.count > 0) || !(row.marginal > 0)) continue;
      if (!best || row.marginal > market[best].marginal) best = key;
      if (!worst || row.marginal < market[worst].marginal) worst = key;
    }
    if (best && worst && best !== worst && market[best].marginal > market[worst].marginal * SPREAD) {
      const w = state.weights[best] === undefined ? cfg.trees.weightNew : state.weights[best];
      if (w < cfg.trees.weightMax) {
        return say('market', {
          best: market[best].name,
          bestPrice: fmtCoin(market[best].marginal),
          worst: market[worst].name,
          worstPrice: fmtCoin(market[worst].marginal),
        });
      }
    }
  }

  // A trait, cheapest first, once one is affordable outright. Ahead of any
  // waiting, because a trait bought now is working while the waiting happens.
  if (f.traits) {
    let pick = null;
    for (const t of Tr.offered(cfg, state, sim.mods())) {
      if (t.cost === null || t.cost > state.sugar) continue;
      if (!pick || t.cost < pick.cost) pick = t;
    }
    if (pick) return say('trait', { name: Lore.trait(pick.id).name });
  }

  // The waiting, and what it is for. A level standing finished with the fold
  // priced and unaffordable is the largest thing in front of the player, so it
  // is named rather than left to a button further down the page.
  if (lastRing && sim.beyondOffered()) {
    return say('beyondSaving', {
      cost: fmt(sim.beyondCost()), have: fmt(state.sugar),
      level: Lore.levelInfo(state.level).name,
      next: Lore.levelInfo(state.level + 1).name,
    });
  }

  if (empty && !lastRing) {
    return say('saving', { cost: fmt(ringCost), have: fmt(state.sugar) });
  }

  if (lastRing && !sim.beyondOffered()) {
    const need = Math.ceil(cfg.levels.beyondNeeds * sim.world.total);
    return say('beyondNeeds', {
      reached: fmt(state.reached.length), need: fmt(need),
      level: Lore.levelInfo(state.level).name,
    });
  }

  // Winter, and what winter actually costs depends on whether the trade has
  // been made evergreen: a quarter of the usual, or most of it.
  if (f.trees && sim.season().index === 3) {
    if (sim.mods().evergreen) return say('winterEvergreen');
    return say('winter');
  }

  return say('idle');
}
