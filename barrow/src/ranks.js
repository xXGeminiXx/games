// ---------------------------------------------------------------------------
// Ranks: what the player is, across every barrow, and it never goes down.
//
// Points come in from breaking lords' doors, from digging deeper than the
// player has ever been, and from filling barrows in. A rank is a grade and a
// title - Under-Fossor, Fossor, High Fossor, Grand Fossor, then Sexton and on
// up to Rex - and past the last title the Rex rank counts deeps forever.
// Every rank listed in config.ranks.keys hands over one thing, and the game
// asks `has(legacy, cfg, id)` rather than comparing rank numbers anywhere.
// ---------------------------------------------------------------------------

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth',
  'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth',
  'Eighteenth', 'Nineteenth', 'Twentieth'];

/** Points rank n takes, counting ranks from one. */
export function need(n, cfg) {
  const m = Math.max(0, n - 1);
  return cfg.ranks.step * m + m * m;
}

/** The rank a number of points has reached. */
export function rankOf(points, cfg) {
  const p = Number.isFinite(points) && points > 0 ? points : 0;
  // Solve step*m + m^2 <= p for the largest whole m, then check the edges.
  const st = cfg.ranks.step;
  let m = Math.floor((-st + Math.sqrt(st * st + 4 * p)) / 2);
  while (need(m + 2, cfg) <= p) m++;
  while (m > 0 && need(m + 1, cfg) > p) m--;
  return m + 1;
}

/** The name of rank n: a grade and a title, and past the titles, a deep. */
export function nameOf(n, cfg) {
  const R = cfg.ranks;
  const per = R.grades.length;
  const last = R.titles.length * per;
  if (n <= last) {
    const t = Math.floor((n - 1) / per);
    const g = (n - 1) % per;
    return R.grades[g] + R.titles[t];
  }
  const deep = n - last;
  const ord = ORDINALS[deep] || (deep + 'th');
  return R.titles[R.titles.length - 1] + ' of the ' + ord + ' Deep';
}

/** Everything the page needs to show a rank: which, what it is called, how far to the next. */
export function standing(legacy, cfg) {
  const points = (legacy && legacy.renown) || 0;
  const n = rankOf(points, cfg);
  const lo = need(n, cfg), hi = need(n + 1, cfg);
  const next = cfg.ranks.keys.find(k => k.rank > n) || null;
  return {
    n,
    name: nameOf(n, cfg),
    nextName: nameOf(n + 1, cfg),
    points,
    into: points - lo,
    span: hi - lo,
    progress: hi > lo ? Math.max(0, Math.min(1, (points - lo) / (hi - lo))) : 1,
    nextKey: next,
  };
}

/** Whether the player's rank has handed over the thing called `id`. */
export function has(legacy, cfg, id) {
  const key = cfg.ranks.keys.find(k => k.id === id);
  if (!key) return false;
  return rankOf((legacy && legacy.renown) || 0, cfg) >= key.rank;
}

/**
 * Points for a save that predates ranks, from what it had already done:
 * a point for every layer of its best depth and a share for every barrow it
 * filled in. It gets credit for the digging, not for lords it never met.
 */
export function fromHistory(legacy, cfg) {
  const best = (legacy && legacy.best && legacy.best.depth) || 0;
  const seals = (legacy && legacy.seals) || 0;
  return best > 0 || seals > 0 ? (best + 1) * cfg.ranks.points.newDepth + seals * cfg.ranks.points.sealPer : 0;
}
