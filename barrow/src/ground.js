// ---------------------------------------------------------------------------
// The ground of one run, layer by layer.
//
// materials.js gives the shape every barrow shares: names, and the plain
// geometric ladder of value, hardness, market size and floor thickness. This
// file bends that ladder with the SEAMS this particular run rolled, so no two
// barrows are worked the same way. A layer might be fat with its good, or
// brittle and worthless, or packed with the dead, or so rare that a cartload
// ruins the price for an hour.
//
// Everything is derived from the run's seed and the layer number, memoised on
// first ask, and stored nowhere: a save is still just a depth.
// ---------------------------------------------------------------------------

import * as Mat from './materials.js?v=33';
import * as Lords from './lords.js?v=33';
import { pickWeighted, unit } from './rng.js?v=33';

const ONE = { value: 1, hardness: 1, absorb: 1, bones: 1, swell: 1, cap: 1 };

/**
 * @param {object} cfg   the whole config
 * @param {number} seed  the run seed
 */
export function createGround(cfg, seed, hillRule) {
  const hill = hillRule || {};
  const cache = new Map();
  const sc = cfg.seams;

  /** The seam a layer carries, or null for plain ground. */
  const seamAt = (k) => {
    if (k < sc.from) return null;
    if (unit(seed, 'seam-roll:' + k) >= sc.chance) return null;
    return pickWeighted(sc.list, seed, 'seam-pick:' + k) || null;
  };

  /** Which narrative band a layer falls in: how far past the mound it is. */
  const bandOf = (k) => {
    let b = 0;
    for (const edge of cfg.strata.bands) if (k > edge) b++;
    return b;
  };

  const build = (k) => {
    // The name and the colour are the owning lord's; the worth still climbs
    // with the depth, so a stretch reads right wherever the deal put it.
    const lorded = cfg.lords ? Lords.materialAt(cfg, seed, k) : null;
    const good = lorded ? { id: 's' + k, name: lorded.name, hue: lorded.hue } : Mat.goodAt(k, cfg.strata);
    const seam = seamAt(k);
    const s = seam || ONE;
    // His rule bends every layer in his ten the way a seam bends one.
    const rule = (lorded && lorded.lord.rule) || {};
    const f = (key) => (s[key] === undefined ? 1 : s[key]) * (rule[key] === undefined ? 1 : rule[key])
      * (hill[key] === undefined ? 1 : hill[key]);
    const door = cfg.lords ? Lords.doorAt(cfg, seed, k) : null;
    return {
      k,
      id: good.id,
      name: good.name,
      hue: good.hue,
      seam,
      lord: lorded ? lorded.lord : null,
      door,
      band: bandOf(k),
      // The four numbers that decide how a layer is worked, and the two that
      // decide how its market behaves.
      value:    Mat.valueAt(k, cfg.strata) * f('value'),
      hardness: Mat.hardnessAt(k, cfg.strata) * f('hardness'),
      absorb:   Mat.absorbAt(k, cfg.market) * f('absorb'),
      // Straight line, not a curve: an older grave holds more of the dead than
      // a young one, but nothing here may compound, because whatever compounds
      // in the bones compounds again through the horde and runs the game away.
      bones:    cfg.horde.boneShare * (1 + Mat.rung(k, cfg.strata) * cfg.horde.bonePerLayer) * f('bones'),
      swell:    cfg.market.cycle.amplitude * f('swell'),
      // The floor between the layer above and this one, in units dug at this
      // layer's hardness. A sealed layer is the one that is hard to break into.
      // A lord's door is that many floors deep on top of whatever the ground is.
      cap:      Mat.capUnits(Math.max(0, k - 1), cfg.strata) * f('cap') * (door ? door.thickness : 1),
    };
  };

  const at = (k) => {
    k = Math.max(0, k | 0);
    let g = cache.get(k);
    if (!g) { g = build(k); cache.set(k, g); }
    return g;
  };

  return {
    seed,
    at,
    bandOf,
    /** The good's name, for a line of text. */
    nameOf: (k) => at(k).name,
    /** What a unit dug at k is made of, unchanged by seams. */
    mixAt: (k) => Mat.mixAt(k, cfg.strata),
  };
}
