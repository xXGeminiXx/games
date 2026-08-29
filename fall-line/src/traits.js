// ---------------------------------------------------------------------------
// Traits - what the Melt has grown.
//
// A mote carries a bitmask. Every trait's effect is a multiplier or a flag
// read from config.melt.mutations, and effects combine by multiplying, so a
// mote with two hp-costing traits pays both. Nothing here rolls dice or
// decides which trait comes next; that is melt.js.
// ---------------------------------------------------------------------------

/** Bit for each trait id, in the order config lists them. */
export const TRAIT = {
  chitin:   1 << 0,
  scatter:  1 << 1,
  slick:    1 << 2,
  faraday:  1 << 3,
  numb:     1 << 4,
  ballast:  1 << 5,
  wings:    1 << 6,
  haste:    1 << 7,
  bulk:     1 << 8,
  swarm:    1 << 9,
  regrowth: 1 << 10,
};

export const TRAIT_IDS = Object.keys(TRAIT);

/** The trait that decides a mote's colour when it carries several. */
const DOMINANCE = ['wings', 'bulk', 'swarm', 'haste', 'chitin', 'slick', 'faraday',
  'scatter', 'numb', 'ballast', 'regrowth'];

const MULTIPLIERS = ['kinetic', 'blast', 'burn', 'arc', 'speed', 'hp', 'count', 'leak', 'burnTime'];
const FLAGS = ['ignoreTerrain', 'immuneSlow', 'immunePull', 'stopsChain'];

/** A bitmask from a list of ids. Unknown ids are ignored. */
export function maskOf(ids) {
  let m = 0;
  for (const id of ids || []) if (id in TRAIT) m |= TRAIT[id];
  return m >>> 0;
}

/** The ids set in a mask, in config order. */
export function idsOf(mask) {
  const out = [];
  for (const id of TRAIT_IDS) if (mask & TRAIT[id]) out.push(id);
  return out;
}

export function hasTrait(mask, id) {
  return !!(mask & (TRAIT[id] || 0));
}

/**
 * The combined effect of every trait in a mask. Multipliers default to 1,
 * flags to false, regen to 0. Cached per mask because motes ask every step.
 */
const cache = new Map();
export function traitEffects(cfg, mask) {
  mask = mask >>> 0;
  const key = cfg.melt.mutations === lastTable ? mask : -1;
  if (key >= 0 && cache.has(key)) return cache.get(key);
  if (cfg.melt.mutations !== lastTable) { cache.clear(); lastTable = cfg.melt.mutations; }

  const e = { regen: 0 };
  for (const k of MULTIPLIERS) e[k] = 1;
  for (const k of FLAGS) e[k] = false;
  for (const id of TRAIT_IDS) {
    if (!(mask & TRAIT[id])) continue;
    const def = cfg.melt.mutations[id];
    if (!def) continue;
    for (const k of MULTIPLIERS) if (typeof def[k] === 'number') e[k] *= def[k];
    for (const k of FLAGS) if (def[k]) e[k] = true;
    if (typeof def.regen === 'number') e.regen += def.regen;
  }
  cache.set(mask, e);
  return e;
}
let lastTable = null;

/** The multiplier a mote with this mask applies to incoming damage of a type. */
export function takenMultiplier(cfg, mask, type) {
  const e = traitEffects(cfg, mask);
  return typeof e[type] === 'number' ? e[type] : 1;
}

/** Display names for the traits in a mask, in config order. */
export function traitNames(cfg, mask) {
  return idsOf(mask).map(id => (cfg.melt.mutations[id] || {}).name || id);
}

/** The id that colours a mote, or null for a plain one. */
export function dominantTrait(mask) {
  for (const id of DOMINANCE) if (mask & TRAIT[id]) return id;
  return null;
}

/** True when two ids may not be active together. */
export function conflicts(cfg, a, b) {
  const da = cfg.melt.mutations[a];
  const db = cfg.melt.mutations[b];
  return !!((da && da.conflicts === b) || (db && db.conflicts === a));
}
