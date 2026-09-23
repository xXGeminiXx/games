// ---------------------------------------------------------------------------
// When each part of the game appears.
//
// Nothing is shown before it matters, and nothing that has appeared is ever
// taken back: every flag is set once and stays. The order is the order a new
// player meets the game in - dig, raise, the field, the face, the upgrades,
// and at the far end filling in - and each arrival is announced by one line
// in the log.
// ---------------------------------------------------------------------------


/** Flag -> the pool in the writing that announces it. */
export const ANNOUNCE = {
  raise: 'raiseShown',
  face: 'faceShown',
  rites: 'ritesShown',
  handHidden: 'handsDone',
  // Said once, in the first barrow that gets deep enough. Every barrow after
  // it opens with the flag already set (openedState brings the flags up to
  // date before the run starts), so this never repeats.
  seal: 'sealShown',
};


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
  // Filling in shows itself once a barrow has been filled in before. Relics
  // alone do not count: the first barrow earns them from its first layers.
  const seals = (legacy && legacy.seals) || 0;
  const remembered = seals > 0;

  set('raise', s.bones >= 1 || s.horde > 0);
  set('field', s.horde >= 1);
  set('face', s.horde >= cfg.horde.faceShownAt);
  set('rites', s.coin >= cfg.reveal.ritesAtCoin || Object.keys(s.rites).length > 0);
  set('handHidden', s.horde >= cfg.horde.hideHandAt);
  // The seal shows itself once this barrow is deep enough to be worth
  // closing, and stays visible in every barrow after the first one.
  set('seal', s.depth >= cfg.seal.unlockDepth || remembered);

  if (fresh.includes('face') && !(s.faceWeight > 0)) s.faceWeight = cfg.horde.weightFace;
  return fresh;
}
