// ---------------------------------------------------------------------------
// Where the diggers stand, worked out by the game.
//
// The player never has to answer this. Every material has a fixed worth and
// every layer a hardness, so each layer pays a digger a fixed amount a second:
// what it turns up times what that is worth. The way down gets its share
// first, so a run never stalls on a rich layer, and everyone else stands on
// the layer that pays a digger most - almost always the deepest one, since a
// layer's worth climbs faster with depth than its hardness does, unless a
// seam makes the one above it richer.
//
// The split it returns is shares that sum to one, rather than the five-step
// setting the panel makes a player fill in by hand.
// ---------------------------------------------------------------------------

import * as H from './horde.js?v=45';

/** Coin a digger earns a second on layer k, before the crew's own speed. */
export function payOn(api, k, md) {
  const layer = api.ground.at(k);
  let worth = 0;
  for (const part of api.ground.mixAt(k)) worth += part.share * api.worthOf('s' + part.k, md);
  return layer.hardness > 0 ? worth / layer.hardness : 0;
}

/**
 * Where every digger stands right now.
 *
 * @param {object} api  the simulation: state, cfg, ground, mods, worthOf
 * @returns {{strata: number[], face: number}} shares summing to one
 */
export function bestSplit(api) {
  const { state, cfg } = api;
  const md = api.mods();
  const from = H.activeFrom(state.depth, cfg.horde, md.activeStrata);
  const strata = state.weights.map(() => 0);
  while (strata.length <= state.depth) strata.push(0);
  const perSec = state.horde * cfg.horde.digRate * md.digMult;
  // Nobody standing anywhere: the split is all zeros and the caller does
  // nothing with it.
  if (!(perSec > 0)) return { strata, face: 0 };
  let best = state.depth, top = -1;
  for (let k = state.depth; k >= from; k--) {
    const pay = payOn(api, k, md);
    if (pay > top * 1.000001) { top = pay; best = k; }
  }
  strata[best] = 1 - cfg.horde.faceFloor;
  return { strata, face: cfg.horde.faceFloor };
}
