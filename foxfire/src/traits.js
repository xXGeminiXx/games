// ---------------------------------------------------------------------------
// Traits: what sugar buys besides tips and ground, and what the spore carries.
//
// Every multiplier the simulation reads comes out of modsOf, in one place, so
// a new trait or genome perk is a config line and an entry here, not a hunt
// through the simulation.
// ---------------------------------------------------------------------------

import { costScale } from './levels.js?v=19';

export function levelOf(state, id) {
  return (state.traits && state.traits[id]) || 0;
}

/** Sugar for the next level of a trait, or null when capped. */
export function costOf(cfg, state, id, mods) {
  const t = cfg.traits.find(x => x.id === id);
  if (!t) return null;
  const lv = levelOf(state, id);
  if (lv >= t.cap) return null;
  const discount = Math.max(0.1, 1 + ((mods && mods.traitCost) || 0));
  return t.cost * Math.pow(t.growth, lv) * costScale(cfg, state.level) * discount;
}

/** Buy one level. Returns the cost paid, or 0. */
export function buy(cfg, state, id, mods) {
  const cost = costOf(cfg, state, id, mods);
  if (cost === null || !(state.sugar >= cost)) return 0;
  state.sugar -= cost;
  state.traits[id] = levelOf(state, id) + 1;
  state.totals.spent += cost;
  return cost;
}

/** Everything every trait and genome perk adds up to. */
export function modsOf(state, cfg, genome) {
  const m = {
    eat: 1,          // dead wood eaten this much faster
    speed: 1,        // tip speed
    tipCost: 1,      // multiplier on the price of a tip
    search: 0,       // extra cells a tip looks
    trade: 1,        // what trees pay
    fell: 0,         // felling allowed
    nurture: 0,      // feeding allowed
    felledWood: 1,   // wood a felled tree leaves
    frost: 0,        // winter no longer slows tips
    evergreen: 0,    // trees pay a little in winter
    awayHours: cfg.time.awayHours,
    yield: 1,        // everything
    startTips: 0,
    traitCost: 0,
    // Which habits the organism has learned. Each one is only a permission:
    // whether it is acted on is the switch in the journal.
    instinct: { extend: 0, tips: 0, beyond: 0 },
  };
  const apply = (list, levels) => {
    for (const t of list) {
      const lv = levels[t.id] || 0;
      if (!lv) continue;
      const e = t.effect;
      if (e.eat) m.eat *= 1 + e.eat * lv;
      if (e.speed) m.speed *= 1 + e.speed * lv;
      if (e.tipCost) m.tipCost *= Math.pow(1 + e.tipCost, lv);
      if (e.search) m.search += e.search * lv;
      if (e.trade) m.trade *= 1 + e.trade * lv;
      if (e.fell) m.fell = 1;
      if (e.nurture) m.nurture = 1;
      if (e.felledWood) m.felledWood *= 1 + e.felledWood * lv;
      if (e.frost) m.frost = 1;
      if (e.evergreen) m.evergreen = 1;
      if (e.awayHours) m.awayHours += e.awayHours * lv;
      if (e.yield) m.yield *= 1 + e.yield * lv;
      if (e.startTips) m.startTips += e.startTips * lv;
      if (e.traitCost) m.traitCost += e.traitCost * lv;
      if (e.instinct && e.instinct in m.instinct) m.instinct[e.instinct] = 1;
    }
  };
  apply(cfg.traits, state.traits || {});
  if (genome) apply(cfg.spores.genome, genome.perks || {});
  return m;
}

/** Traits in the order they are offered, with what is known about each. */
export function offered(cfg, state, mods) {
  return cfg.traits.map(t => ({
    id: t.id,
    level: levelOf(state, t.id),
    cap: t.cap,
    cost: costOf(cfg, state, t.id, mods),
  }));
}
