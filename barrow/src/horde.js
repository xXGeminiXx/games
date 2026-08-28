// ---------------------------------------------------------------------------
// The horde: raising the dead, and what they dig.
//
// Raising costs bones. The n-th digger costs base * (1 + n / soft) bones, so
// the first few dozen are cheap and after that the horde grows about linearly
// in the bones it is fed. Every digger turns up bones at the same rate
// wherever it stands and however fast it digs; only the grave rite changes
// how far a bone goes.
//
// Diggers are split across the open strata and the face by weights. The face
// is the cap under the deepest open stratum; digging it through opens the
// next one.
// ---------------------------------------------------------------------------

import { hardnessAt, capUnits, mixAt } from './materials.js?v=1';

/** Bones for the digger numbered n (the first is n = 0). */
export function raiseCost(n, cfg, softMult) {
  const soft = cfg.boneCostSoft * (softMult || 1);
  return cfg.boneCostBase * (1 + n / soft);
}

/** Bones for `count` diggers starting at n. Closed form of the sum above. */
export function raiseCostBulk(n, count, cfg, softMult) {
  if (!(count > 0)) return 0;
  const soft = cfg.boneCostSoft * (softMult || 1);
  const m = count;
  return cfg.boneCostBase * (m + (m * n + m * (m - 1) / 2) / soft);
}

/** The most diggers `bones` will raise from n. */
export function maxRaisable(bones, n, cfg, softMult) {
  if (!(bones >= raiseCost(n, cfg, softMult))) return 0;
  let lo = 1, hi = 1;
  while (raiseCostBulk(n, hi, cfg, softMult) <= bones) {
    lo = hi;
    hi *= 2;
    if (hi > 1e15) break;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (raiseCostBulk(n, mid, cfg, softMult) <= bones) lo = mid; else hi = mid;
  }
  return lo;
}

/** The shallowest stratum the horde will still dig. */
export function activeFrom(depth, cfg) {
  return Math.max(0, depth - cfg.activeStrata + 1);
}

/**
 * Split N diggers by weight. `weights` is an array indexed by stratum plus a
 * `face` weight; strata above `from` are abandoned and count for nothing.
 * Returns { strata: [share...], face: share } summing to one, or all zeros
 * when nothing has weight.
 */
export function distribute(weights, faceWeight, from = 0) {
  let total = faceWeight > 0 ? faceWeight : 0;
  for (let k = from; k < weights.length; k++) if (weights[k] > 0) total += weights[k];
  if (total <= 0) return { strata: weights.map(() => 0), face: 0 };
  return {
    strata: weights.map((w, k) => (k >= from && w > 0 ? w / total : 0)),
    face: faceWeight > 0 ? faceWeight / total : 0,
  };
}

/**
 * dt seconds of digging.
 *
 * @param {object} s      the horde's part of the state (mutated):
 *                        horde, depth, weights[], faceWeight, capProgress,
 *                        stock{}, bones, totals{dug, raised}
 * @param {number} dt
 * @param {object} cfg    { horde, strata }
 * @param {object} mods   { digMult }
 * @returns {number[]}    strata opened during this step, in order
 */
export function dig(s, dt, cfg, mods) {
  const opened = [];
  if (!(dt > 0) || !(s.horde > 0)) return opened;

  const rate = s.horde * cfg.horde.digRate * ((mods && mods.digMult) || 1) * dt;
  const split = distribute(s.weights, s.faceWeight, activeFrom(s.depth, cfg.horde));

  // Bones come up at the same rate for every digger wherever it stands, and
  // faster hands do not find more of them: the horde grows with its size and
  // the grave rite, and with nothing else.
  s.bones += s.horde * cfg.horde.digRate * cfg.horde.boneShare * dt;

  for (let k = activeFrom(s.depth, cfg.horde); k <= s.depth; k++) {
    const share = split.strata[k] || 0;
    if (share <= 0) continue;
    const units = rate * share / hardnessAt(k, cfg.strata);
    yieldUnits(s, k, units, cfg);
  }

  if (split.face > 0) {
    // Progress is kept in units of the cap currently being dug.
    let progress = s.capProgress + rate * split.face / hardnessAt(s.depth + 1, cfg.strata);
    let cap = capUnits(s.depth, cfg.strata);
    while (progress >= cap) {
      progress -= cap;
      s.depth += 1;
      opened.push(s.depth);
      // Leftover effort was spent at the old hardness; the next cap is harder.
      progress /= cfg.strata.hardnessGrowth;
      cap = capUnits(s.depth, cfg.strata);
      while (s.weights.length <= s.depth) s.weights.push(0);
      s.weights[s.depth] = cfg.horde.weightNew;
      if (opened.length > 64) break; // a step cannot open the whole earth
    }
    s.capProgress = progress;
  }
  return opened;
}

/**
 * Add `units` dug at stratum k to the stock, split by the stratum's mix.
 * `pure` skips the mix and yields only the stratum's own good - what a hand
 * turns up, which is never a trace of the ground below.
 */
export function yieldUnits(s, k, units, cfg, pure) {
  if (!(units > 0)) return;
  if (pure) {
    s.stock['s' + k] = (s.stock['s' + k] || 0) + units;
  } else {
    for (const part of mixAt(k, cfg.strata)) {
      const id = 's' + part.k;
      s.stock[id] = (s.stock[id] || 0) + units * part.share;
    }
  }
  s.totals.dug += units;
  if (s.effort) s.effort[k] = (s.effort[k] || 0) + units * hardnessAt(k, cfg.strata);
}

/** Raise `count` diggers if the bones are there. Returns how many were. */
export function raise(s, count, cfg, softMult) {
  if (count === 'max') count = maxRaisable(s.bones, s.horde, cfg, softMult);
  count = Math.floor(count);
  if (!(count > 0)) return 0;
  const cost = raiseCostBulk(s.horde, count, cfg, softMult);
  if (cost > s.bones + 1e-9) return 0;
  s.bones -= cost;
  if (s.bones < 0) s.bones = 0;
  s.horde += count;
  s.totals.raised += count;
  return count;
}
