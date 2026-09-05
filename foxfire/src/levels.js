// ---------------------------------------------------------------------------
// The scales.
//
// Level L pays yieldFactor^L times the floor and charges costFactor^L, so
// each level is the floor's shape with a bigger number on it and takes a
// little longer than the one before. Going beyond folds
// the whole level into the origin node of the next one and keeps a share of
// its income arriving from below.
// ---------------------------------------------------------------------------

import { cellsInDisc } from './world.js?v=19';

export function scale(cfg, level) {
  return Math.pow(cfg.levels.yieldFactor, level);
}

/** What a price is multiplied by at a level. Steeper than the yield. */
export function costScale(cfg, level) {
  return Math.pow(cfg.levels.costFactor, level);
}

/** Sugar to open ring r (1-based) at a level. Ring 1 is open from the start. */
export function ringCost(cfg, level, ring) {
  return cfg.levels.ringCostBase * Math.pow(cfg.levels.ringCostGrowth, ring - 1) * costScale(cfg, level);
}

export function beyondCost(cfg, level) {
  return ringCost(cfg, level, cfg.world.rings + 1) * cfg.levels.beyondMult;
}

/** How many nodes a level holds on average - what one node above stands for. */
export function nodesPerLevel(cfg) {
  return cellsInDisc(cfg.world.ringWidth * cfg.world.rings) * cfg.world.density;
}

/** Square metres one node at a level stands for. */
export function nodeArea(cfg, level) {
  return cfg.levels.floorNodeArea * Math.pow(nodesPerLevel(cfg), level);
}

/** Square metres of ground the organism holds. */
export function areaOf(cfg, level, reachedCount) {
  return reachedCount * nodeArea(cfg, level);
}

/** Whether going beyond is offered: every ring open and enough of them reached. */
export function beyondOffered(cfg, state, world) {
  if (state.ring < cfg.world.rings) return false;
  return state.reached.length >= cfg.levels.beyondNeeds * world.total;
}

export const EARTH_LAND_M2 = 1.49e14;
export const LARGEST_ORGANISM_M2 = 9.65e6; // the Oregon honey fungus, roughly
