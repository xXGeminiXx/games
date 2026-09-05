// ---------------------------------------------------------------------------
// Where the diggers stand, worked out by the game.
//
// The player never has to answer this. A layer's buyers only take so much
// before the price falls away, and past that point another digger on it earns
// almost nothing; every market has a flow it pays best at and Mk.bestFlow
// says what that flow is. So the answer is: fill the deepest ground to
// exactly that flow, then the next one up, and so on, and send everyone left
// over down to open the next layer.
//
// Deepest first is right on both counts. A deep layer's material is worth
// 3.5x more per layer while its market has barely been touched, and the
// ground down there holds more of the dead, so the same digger earns more
// coin AND turns up more bones the further down it stands.
//
// The split it returns is shares that sum to one, not the five-step setting
// the panel used to make a player fill in by hand.
// ---------------------------------------------------------------------------

import * as Mk from './market.js?v=18';
import * as H from './horde.js?v=18';

/**
 * The share of the diggers that layer k can take before its buyers stop
 * paying for more. Infinity when nothing binds it.
 */
function roomOn(api, k, perSec) {
  const layer = api.ground.at(k);
  const md = api.mods();
  let room = Infinity;
  for (const part of api.ground.mixAt(k)) {
    if (!(part.share > 0)) continue;
    const m = api.marketFor('s' + part.k);
    if (!m) continue;
    const best = Mk.bestFlow(m, md);
    if (!(best > 0)) return 0;
    // units of this part per second at share x is perSec * x / hardness * part.share
    const share = best * layer.hardness / (perSec * part.share);
    if (share < room) room = share;
  }
  return room;
}

/**
 * Where every digger stands right now.
 *
 * @param {object} api  the simulation: state, cfg, ground, mods, marketFor
 * @returns {{strata: number[], face: number}} shares summing to one
 */
export function bestSplit(api) {
  const { state, cfg } = api;
  const md = api.mods();
  const from = H.activeFrom(state.depth, cfg.horde, md.activeStrata);
  const strata = state.weights.map(() => 0);
  const perSec = state.horde * cfg.horde.digRate * md.digMult;
  // Nobody standing anywhere: the split is all zeros and the caller does
  // nothing with it.
  if (!(perSec > 0)) return { strata, face: 0 };

  // The way down is paid first, so a run never stalls on a rich shallow
  // layer, and it takes whatever nobody else can use on top of that.
  let left = 1 - cfg.horde.faceFloor;
  for (let k = state.depth; k >= from && left > 1e-9; k--) {
    const room = roomOn(api, k, perSec);
    const give = Math.min(left, room > 0 ? room : 0);
    if (give > 1e-9) { strata[k] = give; left -= give; }
  }
  return { strata, face: cfg.horde.faceFloor + Math.max(0, left) };
}
