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

import * as Lore from './lore.js?v=16';
import * as Tr from './traits.js?v=16';
import { fmt, fmtCoin } from './numbers.js?v=16';

/** The share of the mineral flow going to waste before it is worth saying. */
const WASTE = 0.08;
/** How much better the best price has to be before moving a share is worth it. */
const SPREAD = 1.35;
/**
 * While the front is idle and the next thing to buy is the whole bottleneck, a
 * trait is only worth naming if it costs no more than this share of it. A
 * player who buys every affordable trait during that wait never opens the
 * ring at all: measured over ten minutes of following this line, the sugar
 * went 2.56K, 4.32K, 3.02K, 5.12K, 3.35K against a 10.24K ring and the run
 * stood still on one ring the whole time. The same wait happens on the last
 * ring of a level, where what is being saved for is the fold rather than a
 * ring, and it costs the same thing.
 */
const TRAIT_SHARE = 0.25;

/**
 * @returns {{key: string, text: string}} the line, and the key it came from so
 *          a caller can tell one piece of advice from the next.
 */
export function next(sim, cfg) {
  const state = sim.state;
  const f = state.flags;
  // A line and, where the move it names is a single press, the press itself.
  // The control the line points at can be a thousand pixels down a column that
  // scrolls, and the line goes off the top of the window on the way to it, so
  // the line carries the button: `do` is the action, `arg` what it acts on,
  // and `label` the key of the words on it.
  const say = (key, values, act) => ({ key, text: Lore.ui('next.' + key, values), act: act || null });

  // The opening: there is one button, and it is not obvious that pressing it
  // is meant to be temporary. So it counts down to the thing that ends it -
  // ten identical presses with nothing to press toward is the worst minute in
  // the game, and it is the first one.
  if (state.tipCount === 0) {
    const cost = sim.tipCost(1);
    if (state.sugar >= cost) return say('firstTip', null, { do: 'tip', label: 'tip' });
    const perPress = cfg.hand.sugar * sim.scale();
    const left = perPress > 0 ? Math.max(1, Math.ceil((cost - state.sugar) / perPress)) : 0;
    // The wood and the soil are paying too, so it arrives by this press at the
    // latest. One press left is a different sentence from six.
    const grow = { do: 'reach', label: 'hand' };
    return left > 1 ? say('hand', { n: fmt(left) }, grow) : say('handLast', null, grow);
  }

  const lastRing = state.ring >= cfg.world.rings;
  const empty = sim.rt.frontier.size === 0;

  if (lastRing && sim.beyondOffered() && state.sugar >= sim.beyondCost()) {
    return say('beyond', {
      level: Lore.levelInfo(state.level).name,
      next: Lore.levelInfo(state.level + 1).name,
    }, { do: 'beyond', label: 'beyond' });
  }

  // Throughput. The tips are both the front and the freight, and a front too
  // small to carry what the ground gives up is the one mistake that costs the
  // whole run and shows nowhere else.
  const carry = sim.carry();
  if (f.trees && carry.produced > 0 && carry.carried < carry.produced * (1 - WASTE)) {
    const n = sim.tipsAffordable();
    return say('waste', {
      produced: fmtCoin(carry.produced),
      lost: fmtCoin(carry.produced - carry.carried),
    }, n >= 2 ? { do: 'tipsMax', label: 'tips', values: { n: fmt(n) } }
      : n === 1 ? { do: 'tip', label: 'tip' } : null);
  }

  // Ground to open, and the money in hand to open it.
  const ringCost = !lastRing ? sim.ringCost() : 0;
  if (empty && !lastRing && state.sugar >= ringCost) return say('ring', null, { do: 'ring', label: 'ring' });

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
        }, { do: 'share', arg: best, label: 'share', values: { name: Lore.capital(market[best].name) } });
      }
    }
  }

  // A trait, cheapest first, once one is affordable outright. Ahead of any
  // waiting, because a trait bought now is working while the waiting happens -
  // except while the one thing left to buy is the whole bottleneck, when only
  // a trait small enough not to hold it up is worth naming. On a middle ring
  // that thing is the next ring; on the last one it is the fold.
  const foldCost = lastRing && sim.beyondOffered() ? sim.beyondCost() : 0;
  const holdingFor = (empty && !lastRing && state.sugar < ringCost) ? ringCost
    : (foldCost > 0 && state.sugar < foldCost) ? foldCost : 0;
  if (f.traits) {
    let pick = null;
    for (const t of Tr.offered(cfg, state, sim.mods())) {
      if (t.cost === null || t.cost > state.sugar) continue;
      if (holdingFor > 0 && t.cost > holdingFor * TRAIT_SHARE) continue;
      if (!pick || t.cost < pick.cost) pick = t;
    }
    if (pick) {
      const name = Lore.trait(pick.id).name;
      return say('trait', { name }, { do: 'trait', arg: pick.id, label: 'trait', values: { name } });
    }
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

  // Nothing to press. Say what the sugar is piling up toward rather than
  // listing what sugar is for.
  if (!lastRing) return say('idle', { cost: fmt(ringCost) });
  return say('idleLast');
}
