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
// Every kind also has a season it pays best in and one it pays least in, on
// top of the year's own curve, so which kind deserves the minerals changes
// through the year rather than being settled once.
//
// Felling is parasitism: a tree drained loses health and pays while it goes,
// and when it dies its size becomes dead wood. Feeding is transfer: sugar
// sent to a kind makes its trees grow faster. Both are traits. What each is
// worth is worked out here and shown on the ledger, so the figures a player
// reads are the ones the simulation pays.
// ---------------------------------------------------------------------------

import { scale } from './levels.js?v=17';
import { unit } from './rng.js?v=17';

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
      season: base.season && base.season.length === 4 ? base.season.slice() : [1, 1, 1, 1],
    });
  }
  return out;
}

/** What this kind pays in a season, relative to what it pays in an average one. */
export function seasonMult(species, index) {
  const s = species && species.season;
  if (!s || !(s.length === 4)) return 1;
  const v = s[Math.max(0, Math.min(3, index | 0))];
  return v > 0 ? v : 0;
}

/** The season a kind pays best in, and the one it pays least in. */
export function bestSeason(species) {
  return pickSeason(species, 1);
}

export function worstSeason(species) {
  return pickSeason(species, -1);
}

function pickSeason(species, sign) {
  const s = (species && species.season) || [];
  let at = 0;
  for (let i = 1; i < 4; i++) {
    const a = s[i] === undefined ? 1 : s[i];
    const b = s[at] === undefined ? 1 : s[at];
    if (sign * (a - b) > 0) at = i;
  }
  return at;
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

/**
 * Split a mineral flow so every kind is paying the same for its next mineral.
 *
 * A kind's price falls the more it is sent, so the flow is worth the most when
 * no kind is still paying more than another for one more. That point is one
 * price L: a kind takes minerals until its own price has fallen to L, and a
 * kind whose first mineral is worth less than L takes nothing. The price at m
 * is `(rate/need) * exp(-m/(need*S)) * mult`, so the minerals that bring it to
 * L are `need * S * ln(top/L)` where top is what its first mineral fetches.
 * That total falls as L rises, so L is found by halving the range.
 *
 * This is what the split does unless the player has taken it over. Splitting
 * the flow evenly instead is what a player who never touches the ledger gets,
 * and it leaves money on the table every second of the run for a reason
 * nothing on the page can teach.
 *
 * @param {number} flow    minerals a second to divide
 * @param {Array}  roster  the kinds at this level
 * @param {object} sizes   key -> standing size, 0 or absent for none standing
 * @param {object} mults   key -> what this kind's payment is multiplied by now
 * @returns {object} key -> minerals a second
 */
export function bestSplit(flow, roster, sizes, mults) {
  const out = {};
  const live = [];
  let top = 0;
  for (const sp of roster) {
    const S = sizes[sp.key] || 0;
    out[sp.key] = 0;
    if (!(S > 0) || !(sp.rate > 0) || !(sp.need > 0)) continue;
    const mult = mults && mults[sp.key] !== undefined ? mults[sp.key] : 1;
    const first = (sp.rate / sp.need) * mult;      // what its next mineral fetches at nothing sent
    if (!(first > 0)) continue;
    live.push({ key: sp.key, first, span: sp.need * S });
    if (first > top) top = first;
  }
  if (!(flow > 0) || live.length === 0 || !(top > 0)) return out;
  if (live.length === 1) { out[live[0].key] = flow; return out; }

  const wanted = (L) => {
    let sum = 0;
    for (const k of live) if (k.first > L) sum += k.span * Math.log(k.first / L);
    return sum;
  };
  // At L just under `top` only the best kind takes anything, so the demand is
  // near nothing; at L near zero it is unbounded. Halve until the demand is
  // the flow.
  let lo = top * 1e-12, hi = top;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (wanted(mid) > flow) lo = mid; else hi = mid;
  }
  const L = (lo + hi) / 2;
  let sum = 0;
  for (const k of live) {
    const m = k.first > L ? k.span * Math.log(k.first / L) : 0;
    out[k.key] = m;
    sum += m;
  }
  // The solve lands a hair off; hand the flow out in the proportions it found
  // so nothing is invented and nothing leaks.
  if (sum > 0) for (const k of live) out[k.key] = flow * out[k.key] / sum;
  return out;
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

// -- what the two standing decisions are worth -------------------------------
//
// Felling is judged whole trees at a time, so it is measured against what a
// tree of that size is actually being paid now: the pool's pay shared out by
// size. Feeding adds a little size to a pool that already has its minerals,
// so it is measured against what one more unit of size would fetch, which is
// less - below saturation the minerals simply move to the trees already
// standing there. Both figures go on the ledger.

/** Sugar a tree of this size is paid a second, out of what its pool is paid. */
export function keptRate(got, S, size) {
  return S > 0 && size > 0 ? got * size / S : 0;
}

/** Sugar one more unit of a pool's size would be paid a second. */
export function sizeValue(species, S, m, mult) {
  if (!(S > 0) || !(species.rate > 0)) return 0;
  const u = m / (species.need * S);
  const e = Math.exp(-u);
  return species.rate * ((1 - e) - u * e) * mult;
}

/** Sugar a tree of this size is worth felled: the drain, and then the wood. */
export function fellValue(cfg, species, size, mods) {
  if (!(size > 0)) return 0;
  const yieldMod = (mods && mods.yield) || 1;
  const woodMod = (mods && mods.felledWood) || 1;
  const drain = species.rate * size * cfg.trees.fell.yield * yieldMod * cfg.trees.fell.seconds;
  return drain + size * species.wood * woodMod;
}

/**
 * How long feeding a pool takes to pay for itself, in seconds, or Infinity.
 *
 * Fed, a pool closes on its full size at (1 + boost) times the rate; the sugar
 * that buys is the difference between the two curves, and the cost is charged
 * on the growth still to come, which is what the sugar is actually buying.
 * Both are integrated, and the answer is where they cross. Past the horizon it is called no payback at all.
 */
export function feedPayback(cfg, species, pool, value, growthMult, k) {
  const count = pool.count || 0;
  const size = pool.size || 0;
  const full = count * species.max;
  const room = full - size;
  const a = species.growth * growthMult;
  const b = a * (1 + cfg.trees.nurture.boost);
  if (!(room > 0) || !(a > 0) || !(b > a) || !(value > 0)) return Infinity;
  const cost = cfg.trees.nurture.sugarPerSize * k;
  const net = (t) => {
    const ea = Math.exp(-a * t), eb = Math.exp(-b * t);
    const gained = value * room * ((1 - ea) / a - (1 - eb) / b);
    const paid = cost * room * (1 - eb) / b;
    return gained - paid;
  };
  const horizon = Math.max(1, cfg.trees.nurture.paybackHorizon);
  // The net rises out of the red and then falls again, since the growth it
  // buys is bounded and the cost is not, so the crossing is found by walking
  // out and then closing on it.
  let lo = 0, hi = 0;
  const steps = 48;
  for (let i = 1; i <= steps; i++) {
    const t = horizon * Math.pow(i / steps, 2);
    if (net(t) > 0) { hi = t; break; }
    lo = t;
  }
  if (!(hi > 0)) return Infinity;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (net(mid) > 0) hi = mid; else lo = mid;
  }
  return hi;
}
