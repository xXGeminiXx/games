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

import { hash } from './rng.js?v=6';
import * as Lore from './lore.js?v=6';

/** Whether a chamber waits under layer k. */
export function isChamberDepth(k, cfg) {
  const c = cfg.chambers;
  return k >= c.first && (k - c.first) % c.every === 0;
}

/** How many chambers lie at or above layer k, for numbering them. */
export function chamberIndex(k, cfg) {
  const c = cfg.chambers;
  if (k < c.first) return -1;
  return Math.floor((k - c.first) / c.every);
}


/** How many chambers at or above k fall in the same band as k does. */
function bandOrdinal(k, cfg, ground) {
  if (!ground) return 0;
  const band = ground.at(k).band;
  let n = 0;
  for (let j = cfg.chambers.first; j < k; j += cfg.chambers.every) {
    if (ground.at(j).band === band) n++;
  }
  return n;
}

/**
 * The chamber under layer k of this run: its scene and its two offers, in the
 * order this run puts them.
 */
export function chamberAt(seed, k, cfg, ground) {
  if (!isChamberDepth(k, cfg)) return null;
  const band = ground ? ground.at(k).band : 0;
  const pool = Lore.chamberBand(band);
  if (!pool || !pool.length) return null;
  // Where the seed starts in the band's pool is the run's business; from
  // there the rooms are taken in order, so a band never shows the same room
  // twice before it has shown the rest.
  const ordinal = bandOrdinal(k, cfg, ground);
  const template = pool[(hash(seed, 'chamber-band:' + band) + ordinal) % pool.length];
  if (!template) return null;
  const offers = template.offers.slice();
  if (hash(seed, 'chamber-order:' + k) % 2 === 1) offers.reverse();
  return {
    k,
    index: chamberIndex(k, cfg),
    band,
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
