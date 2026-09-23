// ---------------------------------------------------------------------------
// Chambers.
//
// Every few layers down, the floor does not open onto more ground: it opens
// onto a room somebody built. A chamber is a scene, and a choice of two, and
// whichever is taken is a multiplier the rest of that run carries.
//
// Which room is under which layer is a hash of the run's seed, drawn from the
// pool for that depth's band, so the story of one barrow is not the story of
// the next and both are fixed the moment the run begins.
// ---------------------------------------------------------------------------

import { hash } from './rng.js?v=34';
import * as Lore from './lore.js?v=34';

/** Whether a chamber waits under layer k: at fixed places in every lord's ten. */
export function isChamberDepth(k, cfg) {
  const every = cfg.lords ? cfg.lords.every : 10;
  return k > 0 && cfg.chambers.at.includes(k % every);
}

/** How many chambers lie above layer k, for numbering them. */
export function chamberIndex(k, cfg) {
  let n = 0;
  for (let j = 1; j < k; j++) if (isChamberDepth(j, cfg)) n++;
  return isChamberDepth(k, cfg) ? n : -1;
}

/** The pool of rooms the lord who owns layer k draws from. */
export function poolOf(k, cfg, ground) {
  const pools = cfg.chambers.pools || {};
  const id = ground && ground.at(k).lord ? ground.at(k).lord.id : null;
  const key = id && pools[id] ? id : 'other';
  const bands = pools[key] || [0];
  const rooms = [];
  // A lord's own rooms first, then the shared ones his pool draws on.
  for (const r of Lore.lordRooms(id)) rooms.push(r);
  const own = rooms.length;
  for (const b of bands) for (const r of Lore.chamberBand(b)) rooms.push(r);
  return { key: own ? id : key, rooms, own };
}

/**
 * The chamber under layer k of this run: its scene and its two offers, in the
 * order this run puts them.
 */
export function chamberAt(seed, k, cfg, ground) {
  if (!isChamberDepth(k, cfg)) return null;
  const { key, rooms, own } = poolOf(k, cfg, ground);
  if (!rooms.length) return null;
  // A lord's own rooms come first, the first time the dig is in his ground;
  // the shared ones fill in after. Where the seed starts within each is the
  // run's business, and from there they are taken in order, so a pool never
  // shows the same room twice before it has shown the rest.
  let ordinal = 0;
  for (let j = 1; j < k; j++) if (isChamberDepth(j, cfg) && poolOf(j, cfg, ground).key === key) ordinal++;
  const start = hash(seed, 'chamber-pool:' + key);
  const shared = rooms.slice(own);
  const template = ordinal < own
    ? rooms[(start + ordinal) % own]
    : (shared.length ? shared[(start + ordinal - own) % shared.length] : rooms[(start + ordinal) % rooms.length]);
  if (!template) return null;
  const offers = template.offers.slice();
  if (hash(seed, 'chamber-order:' + k) % 2 === 1) offers.reverse();
  return {
    k,
    index: chamberIndex(k, cfg),
    pool: key,
    title: template.title,
    lines: template.lines.slice(),
    offers: offers.map((o, i) => ({ i, name: o.name, line: o.line, boon: o.boon })),
  };
}

/**
 * Fold a boon into the run's standing multipliers. The two that are not
 * multipliers - a windfall of coin and a gang of the dead raised free - are
 * handed back for the caller to pay out, because only it knows the income and
 * the horde.
 */
export function applyBoon(state, boon) {
  const out = { windfall: 0, diggers: 0, rem: 0 };
  if (!boon) return out;
  if (!state.boons) state.boons = {};
  for (const key of Object.keys(boon)) {
    const v = boon[key];
    if (key === 'windfall') out.windfall += v;
    else if (key === 'diggers') out.diggers += v;
    else if (key === 'rem') out.rem += v;
    else state.boons[key] = (state.boons[key] || 1) * v;
  }
  return out;
}

/** Every standing multiplier a boon can set, defaulted to one. */
export function boonsOf(state) {
  const b = state.boons || {};
  const m = (k) => (Number.isFinite(b[k]) && b[k] > 0 ? b[k] : 1);
  return { dig: m('dig'), bones: m('bones'), absorb: m('absorb'), value: m('value'), face: m('face'), soft: m('soft') };
}
