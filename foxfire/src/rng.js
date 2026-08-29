// ---------------------------------------------------------------------------
// Determinism.
//
// Nothing in this game rolls a die at the moment it matters. Everything that
// looks random - which seam a layer carries, which chamber is under it, who
// comes up the track and when, which of four ways a line is worded - is a
// hash of the run's seed and a label. That means a run replays exactly from
// its save, the same seed always produces the same barrow, and a step of one
// second and ten steps of a tenth land in the same place.
// ---------------------------------------------------------------------------

/** A 32 bit hash of a seed and a label. */
export function hash(seed, label) {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  const s = String(label);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // A final avalanche, so labels that differ in one character do not produce
  // neighbouring numbers.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A number in [0, 1) from a seed and a label. */
export function unit(seed, label) {
  return hash(seed, label) / 4294967296;
}

/** A number in [lo, hi) from a seed and a label. */
export function range(seed, label, lo, hi) {
  return lo + unit(seed, label) * (hi - lo);
}

/** An item from an array, or undefined for an empty one. */
export function pick(list, seed, label) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[hash(seed, label) % list.length];
}

/** An index into a list of items carrying a numeric `weight`. */
export function pickWeighted(list, seed, label) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  let total = 0;
  for (const item of list) total += (item && item.weight > 0) ? item.weight : 0;
  if (!(total > 0)) return list[hash(seed, label) % list.length];
  let roll = unit(seed, label) * total;
  for (const item of list) {
    const w = (item && item.weight > 0) ? item.weight : 0;
    if (roll < w) return item;
    roll -= w;
  }
  return list[list.length - 1];
}

/** mulberry32: a stream of numbers from one seed, for the drawing. */
export function stream(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
