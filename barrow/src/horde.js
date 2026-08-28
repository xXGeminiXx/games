// ---------------------------------------------------------------------------
// The horde: raising the dead, and what they dig.
//
// Raising costs bones. The n-th digger costs base * (1 + n / soft) bones, so
// the first few dozen are cheap and after that the horde grows about linearly
// in the bones it is fed.
//
// Where a digger stands decides how many bones it turns up: deep ground holds
// far more of the dead than the topsoil does, and a bonefield seam holds more
// again. How FAST a digger works never changes that, so coin can never buy
// growth and speed can never buy growth. That one rule is what keeps the
// curve from folding in on itself.
//
// Diggers are split across the open layers and the face by weights. The face
// is the floor under the deepest open layer; digging it through opens the
// next one, and the dead working it turn up the bones of the layer they are
// breaking into.
// ---------------------------------------------------------------------------

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

/** The shallowest layer the horde will still work. */
export function activeFrom(depth, cfg, active) {
  const keep = active || cfg.activeStrata;
  return Math.max(0, depth - keep + 1);
}

/**
 * Split N diggers by weight. `weights` is an array indexed by stratum plus a
 * `face` weight; layers above `from` are abandoned and count for nothing.
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
 * @param {object} s      the state (mutated)
 * @param {number} dt
 * @param {object} cfg    the whole config
 * @param {object} mods   every multiplier, from rites.modsOf
 * @param {object} ground this run's layers, from ground.createGround
 * @returns {number[]}    layers opened during this step, in order
 */
export function dig(s, dt, cfg, mods, ground) {
  const opened = [];
  if (!(dt > 0) || !(s.horde > 0)) return opened;

  const digMult = (mods && mods.digMult) || 1;
  const boneMult = (mods && mods.boneMult) || 1;
  const faceMult = (mods && mods.faceMult) || 1;
  const from = activeFrom(s.depth, cfg.horde, mods && mods.activeStrata);
  const split = distribute(s.weights, s.faceWeight, from);
  const diggerSeconds = s.horde * cfg.horde.digRate * dt;
  const rate = diggerSeconds * digMult;

  for (let k = from; k <= s.depth; k++) {
    const share = split.strata[k] || 0;
    if (share <= 0) continue;
    const layer = ground.at(k);
    yieldUnits(s, k, rate * share / layer.hardness, cfg, ground);
    // Bones are counted per digger-second, not per unit, so faster hands
    // never find more of them: only deeper ground does.
    s.bones += diggerSeconds * share * layer.bones * boneMult;
  }

  if (split.face > 0) {
    let target = ground.at(s.depth + 1);
    // The dead on the face are still in the ground of the layer they are
    // breaking into, so they turn up its bones as they go.
    s.bones += diggerSeconds * split.face * target.bones * boneMult;
    let progress = s.capProgress + rate * split.face * faceMult / target.hardness;
    while (progress >= target.cap) {
      progress -= target.cap;
      s.depth += 1;
      opened.push(s.depth);
      const next = ground.at(s.depth + 1);
      // Effort left over was spent against the old floor; the next one is a
      // different hardness, so it does not carry across one for one.
      progress *= target.hardness / next.hardness;
      target = next;
      while (s.weights.length <= s.depth) s.weights.push(0);
      s.weights[s.depth] = cfg.horde.weightNew;
      if (opened.length > 64) break; // a step cannot open the whole earth
    }
    s.capProgress = progress;
  }
  return opened;
}

/**
 * Add `units` dug at layer k to the stock, split by the layer's mix.
 * `pure` skips the mix and yields only the layer's own good - what a hand
 * turns up, which is never a trace of the ground below.
 */
export function yieldUnits(s, k, units, cfg, ground, pure) {
  if (!(units > 0)) return;
  if (pure) {
    s.stock['s' + k] = (s.stock['s' + k] || 0) + units;
  } else {
    for (const part of ground.mixAt(k)) {
      const id = 's' + part.k;
      s.stock[id] = (s.stock[id] || 0) + units * part.share;
    }
  }
  s.totals.dug += units;
  if (s.effort) s.effort[k] = (s.effort[k] || 0) + units * ground.at(k).hardness;
}

/**
 * Raise up to `count` diggers. If the bones will not stretch to all of them
 * it raises as many as they will: a button that is lit never does nothing,
 * which matters because the horde is spending bones the whole time you are
 * deciding. Returns how many stood up.
 */
export function raise(s, count, cfg, softMult) {
  if (count === 'max') count = maxRaisable(s.bones, s.horde, cfg, softMult);
  count = Math.floor(count);
  if (!(count > 0)) return 0;
  let cost = raiseCostBulk(s.horde, count, cfg, softMult);
  if (cost > s.bones + 1e-9) {
    count = maxRaisable(s.bones, s.horde, cfg, softMult);
    if (!(count > 0)) return 0;
    cost = raiseCostBulk(s.horde, count, cfg, softMult);
  }
  s.bones -= cost;
  if (s.bones < 0) s.bones = 0;
  s.horde += count;
  s.totals.raised += count;
  return count;
}

/** Raise diggers that cost nothing: a gang at the gate, a chamber emptied. */
export function raiseFree(s, count) {
  count = Math.floor(count);
  if (!(count > 0)) return 0;
  s.horde += count;
  s.totals.raised += count;
  return count;
}
