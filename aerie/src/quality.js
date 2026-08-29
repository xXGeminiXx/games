// ---------------------------------------------------------------------------
// How sharp the picture is, and who decides.
//
// Almost all of this game's cost is the island being raymarched, so the cost
// of a frame follows the number of pixels marched: the canvas, times the
// resolution fraction, squared. No shipped number can be right for every
// machine, and worse, no number is right for one machine for a whole run.
// Measured on one desktop GPU: three drones in a small window ran at the
// display's 120 Hz cap, while five hundred drones in a large window at full
// resolution ran at 20 to 30 frames a second. The window grows when the
// player resizes it and the fleet grows all game, and neither is knowable in
// advance. So the game measures itself and moves.
//
// Two things are watched, not one. The median says how it usually runs; the
// worst twentieth says whether it stutters. A median of 30 with a worst
// twentieth of 12 is not a smooth game, and a guard that only watched the
// median would call it fine. Either measure going bad steps the picture down.
//
// Warming up is ignored. A GPU that has been idle runs at a low clock and
// takes several seconds to boost; the frames a page reports the moment it
// loads have been measured climbing from 24 to 92 a second over four
// consecutive samples with nothing whatever changed between them. Acting on
// those would lock a fast machine into a poor picture for a reason that had
// already stopped being true.
//
// Stepping up matters as much as stepping down. A guard that can only fall is
// a ratchet, and one cold reading or one busy moment would cost the player
// the rest of the run.
//
// A player who picks a setting is never overruled: anything but auto turns
// the guard off.
//
// Pure: feed it frame times and it decides. Nothing here touches the DOM.
// ---------------------------------------------------------------------------

export function createQuality(cfg, { onScale, onDpr } = {}) {
  const R = cfg.render;
  const A = cfg.adapt;
  const times = [];
  let over = 0, under = 0, settle = A.start;
  let preset = R.quality;
  let scale = R.scale;
  let stats = { median: 0, p95: 0 };

  const rungIndex = (s) => {
    let best = 0, bestD = Infinity;
    A.rungs.forEach((r, i) => { const d = Math.abs(r - s); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };

  const measure = () => {
    if (times.length < 8) return { median: 0, p95: 0 };
    const a = [...times].sort((x, y) => x - y);
    const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
    return { median: at(0.5), p95: at(0.95) };
  };

  const setScale = (s) => {
    if (Math.abs(s - scale) < 1e-6) return false;
    scale = s;
    settle = A.settle;
    times.length = 0;
    over = 0; under = 0;
    if (onScale) onScale(scale);
    return true;
  };

  // Choose a named preset. Anything but auto stops the guard.
  const choose = (name) => {
    const p = R.presets[name];
    if (!p) return false;
    preset = name;
    if (onDpr) onDpr(p.dpr);
    if (!setScale(p.scale)) settle = A.settle;
    return true;
  };

  // One frame took `ms`. Returns true if the resolution moved.
  const sample = (ms) => {
    if (!(ms > 0) || ms > 2000) return false;   // a tab coming back is not a slow frame
    times.push(ms);
    while (times.length > A.window) times.shift();
    stats = measure();
    const dt = ms / 1000;
    if (settle > 0) { settle -= dt; return false; }
    if (!R.presets[preset] || !R.presets[preset].adapt) return false;
    if (times.length < A.window || stats.median <= 0) return false;

    const i = rungIndex(scale);
    const bad = stats.median > A.budgetMs || stats.p95 > A.stutterMs;
    if (bad) {
      under = 0; over += dt;
      if (over >= A.downAfter && i > 0) return setScale(A.rungs[i - 1]);
      return false;
    }
    if (i >= A.rungs.length - 1) { over = 0; under = 0; return false; }
    // What the next rung would cost. Pixels marched go as the square of the
    // resolution fraction, and cost tracks pixels closely enough to predict
    // with - but not exactly, so the prediction has to fit inside the budget
    // with room to spare before it is acted on. Predicting rather than
    // stepping up on a fixed headroom rule is what stops the guard climbing
    // into a rung it cannot hold and dropping straight back out of it.
    const next = A.rungs[i + 1];
    const k = (next * next) / (scale * scale);
    const fits = stats.median * k < A.budgetMs * A.upMargin && stats.p95 * k < A.stutterMs * A.upMargin;
    if (fits) {
      over = 0; under += dt;
      if (under >= A.upAfter) return setScale(next);
    } else { over = 0; under = 0; }
    return false;
  };

  // The frames measured since the last window, for the performance log.
  const window = () => times.slice();

  return {
    sample, choose, setScale, window,
    get preset() { return preset; },
    get scale() { return scale; },
    get median() { return stats.median; },
    get p95() { return stats.p95; },
    get rate() { return stats.median > 0 ? 1000 / stats.median : 0; },
    get adapting() { return !!(R.presets[preset] && R.presets[preset].adapt); },
  };
}
