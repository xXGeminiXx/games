// ---------------------------------------------------------------------------
// The trees, and the trade.
//
// A kind of tree is a species from the roster, scaled to the level. Its
// reached trees form one pool. Given m minerals a second, a pool of total
// size S pays
//     sugar = rate * S * (1 - exp(-m / (need * S)))
// so the first mineral fetches rate/need sugar and every one after fetches
// less. The marginal price is what the market table shows, because that is
// the number a player needs to decide where the next mineral should go.
//
// Felling is parasitism: a tree drained loses health and pays while it goes,
// and when it dies its size becomes dead wood. Feeding is transfer: sugar
// sent to a kind makes its trees grow faster. Both are traits.
// ---------------------------------------------------------------------------

import { scale } from './levels.js?v=1';
import { unit } from './rng.js?v=1';

/** The kinds of tree at a level, scaled. */
export function rosterFor(cfg, level) {
  const out = [];
  const per = cfg.trees.perLevel;
  const roster = cfg.trees.roster;
  const k = scale(cfg, level);
  for (let idx = 0; idx < per; idx++) {
    const slot = level * per + idx;
    const base = roster[slot % roster.length];
    const wrap = Math.floor(slot / roster.length);
    const age = wrap > 0 ? cfg.trees.ages[Math.min(wrap - 1, cfg.trees.ages.length - 1)] + ' ' : '';
    out.push({
      idx,
      key: age + base.name,
      name: age + base.name,
      rate: base.rate * k,
      need: base.need * k,
      growth: base.growth,
      max: base.max,
      wood: base.wood * k,
      weight: base.weight,
    });
  }
  return out;
}

/** What a pool pays for m minerals a second, and the price of the next one. */
export function tradeOf(species, S, m) {
  if (!(S > 0) || !(species.rate > 0)) return { got: 0, marginal: 0, sat: 0 };
  const x = m / (species.need * S);
  const sat = 1 - Math.exp(-x);
  return {
    got: species.rate * S * sat,
    marginal: (species.rate / species.need) * Math.exp(-x),
    sat,
  };
}

/** Split a mineral flow across kinds by weight. Kinds with no trees get none. */
export function split(flow, weights, sizes) {
  const out = {};
  let total = 0;
  for (const key of Object.keys(sizes)) {
    if (!(sizes[key] > 0)) continue;
    const w = weights[key] === undefined ? 0 : weights[key];
    if (w > 0) total += w;
  }
  for (const key of Object.keys(sizes)) {
    const w = weights[key] === undefined ? 0 : weights[key];
    out[key] = (total > 0 && w > 0 && sizes[key] > 0) ? flow * w / total : 0;
  }
  return out;
}

/** A tree's living state when it is first reached. */
export function newTree(node, species) {
  return { sp: node.sp, s: node.s0 * species.max, h: 1, dead: false, wood: 0, regrow: 0 };
}

/** A seedling in the gap a felled tree left. */
export function seedling(cfg, level, nodeId, seed, count) {
  const per = cfg.trees.perLevel;
  const roster = rosterFor(cfg, level);
  let total = 0;
  for (const s of roster) total += s.weight;
  let roll = unit(seed, 'seedling:' + level + ':' + nodeId + ':' + count) * total;
  let sp = per - 1;
  for (let k = 0; k < per; k++) {
    if (roll < roster[k].weight) { sp = k; break; }
    roll -= roster[k].weight;
  }
  return { sp, s: cfg.trees.startSize[0] * roster[sp].max, h: 1, dead: false, wood: 0, regrow: 0 };
}

/** Logistic growth toward full size. Bounded, so nothing here can run away. */
export function grow(tree, species, dt, mult) {
  if (tree.dead) return;
  const room = 1 - tree.s / species.max;
  if (room <= 0) return;
  tree.s = Math.min(species.max, tree.s + species.growth * species.max * mult * room * dt);
}

export function isMature(tree, species, cfg) {
  return tree.s >= cfg.trees.mature * species.max;
}
