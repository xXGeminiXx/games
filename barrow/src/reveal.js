// ---------------------------------------------------------------------------
// When each part of the game appears.
//
// Nothing is shown before it matters, and nothing that has appeared is ever
// taken back: every flag is set once and stays. The order is the order a new
// player meets the game in - dig, sell, raise, the field, the face, the
// market, the rites, and at the far end the seal - and each arrival is
// announced by one line in the log.
// ---------------------------------------------------------------------------

import { BONES } from './materials.js?v=5';

/** Flag -> the pool in the writing that announces it. */
export const ANNOUNCE = {
  sell: 'sellShown',
  raise: 'raiseShown',
  face: 'faceShown',
  market: 'marketShown',
  rites: 'ritesShown',
  handHidden: 'handsDone',
};

/** Goods held a whole unit of, bones not counted: what a market is for. */
export function goodsHeld(s) {
  let n = 0;
  for (const id of Object.keys(s.stock)) if (s.stock[id] >= 1) n++;
  return n;
}

/**
 * Bring the flags up to date. Returns the flags newly set this call, in the
 * order they were set. Mutates s.flags, and sets the face weight the first
 * time the face is shown so a player finds the horde already leaning on it.
 */
export function update(s, cfg, legacy) {
  const fresh = [];
  const set = (flag, cond) => {
    if (!s.flags[flag] && cond) { s.flags[flag] = true; fresh.push(flag); }
  };
  const seals = (legacy && legacy.seals) || 0;
  const remembered = seals > 0 || ((legacy && legacy.remembrance) || 0) > 0;

  set('sell', (s.stock.s0 || 0) >= cfg.reveal.sellAtUnits || s.totals.sold > 0);
  set('raise', s.bones >= 1 || s.horde > 0);
  set('field', s.horde >= 1);
  set('face', s.horde >= cfg.horde.faceShownAt);
  set('market', s.horde >= 1 && goodsHeld(s) >= cfg.reveal.marketAtGoods);
  set('rites', s.coin >= cfg.reveal.ritesAtCoin || Object.keys(s.rites).length > 0);
  set('handHidden', s.horde >= cfg.horde.hideHandAt);
  // The seal shows itself once this barrow is deep enough to be worth
  // closing, and stays visible in every barrow after the first one.
  set('seal', s.depth >= cfg.seal.unlockDepth || remembered);

  if (fresh.includes('face') && !(s.faceWeight > 0)) s.faceWeight = cfg.horde.weightFace;
  return fresh;
}

/** Whether a good's market row should be on the table: held, or ever sold. */
export function marketVisible(s, id) {
  if (id === BONES) return s.bones > 1e-9 || (s.seen && s.seen[id]);
  return (s.stock[id] || 0) > 1e-9 || (s.seen && s.seen[id]);
}
