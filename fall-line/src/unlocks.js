// ---------------------------------------------------------------------------
// Which works are available.
//
// A kind opens the first time any run reaches its surge and stays open for
// every run after, so the ladder is asked about with two numbers: the best
// surge ever reached, and the surge this run is on. The current run counts too,
// which means the run that first reaches surge three gets the kiln that
// instant rather than at the start of the next one.
// ---------------------------------------------------------------------------

/** The furthest down the ladder either number has taken the player. */
function reachedFrom(bestReached, surge) {
  const a = Number.isFinite(bestReached) ? bestReached : 0;
  const b = Number.isFinite(surge) ? surge : 0;
  return a > b ? a : b;
}

/** Whether one kind is available. */
export function isUnlocked(cfg, def, bestReached, surge) {
  if (!def) return false;
  const unlock = Number.isFinite(def.unlock) ? def.unlock : 0;
  return reachedFrom(bestReached, surge) >= unlock;
}

/** The ids of every available kind, in the order config lists them. */
export function unlockedKinds(cfg, bestReached, surge) {
  const out = [];
  for (const def of cfg.works.kinds) {
    if (isUnlocked(cfg, def, bestReached, surge)) out.push(def.id);
  }
  return out;
}

/** The kinds that opened between two reach numbers, for the log. */
export function newlyUnlocked(cfg, prevReached, nowReached) {
  const prev = Number.isFinite(prevReached) ? prevReached : 0;
  const now = Number.isFinite(nowReached) ? nowReached : 0;
  const out = [];
  for (const def of cfg.works.kinds) {
    const unlock = Number.isFinite(def.unlock) ? def.unlock : 0;
    if (prev < unlock && unlock <= now) out.push(def);
  }
  return out;
}

/** The next kind still to come, or null when the ladder is finished. */
export function nextUnlock(cfg, reached) {
  const r = Number.isFinite(reached) ? reached : 0;
  for (const def of cfg.works.kinds) {
    const unlock = Number.isFinite(def.unlock) ? def.unlock : 0;
    if (unlock > r) return def;
  }
  return null;
}
