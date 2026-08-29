// ---------------------------------------------------------------------------
// Quality.
//
// The same page runs on a laptop that renders in software and on a machine
// that does not notice this game exists. Neither should be asked to configure
// anything, and both should be allowed to.
//
// So there are two dials and one watcher. The player sets a target frame rate
// and a render scale; the watcher measures what is actually being achieved and
// moves the scale toward the target when the player has left it on automatic.
//
// Three rules the watcher obeys, each of which is a bug that has been shipped
// before:
//
//   A card takes seconds to raise its clocks. Frames measured before it has
//   are not evidence of anything, so the first stretch after a start, a
//   resize or a settings change is discarded rather than acted on.
//
//   It must step back UP. A watcher that only ever lowers quality turns one
//   bad second into a permanently worse picture.
//
//   It must be possible to switch off entirely, and switching it off must
//   leave the picture exactly where the player put it.
// ---------------------------------------------------------------------------

export function createQuality(cfg) {
  const q = cfg.quality;
  return {
    cfg,
    auto: q.auto,
    target: q.targetFps,
    scale: q.scale > 0 ? q.scale : 1,
    userScale: q.scale > 0 ? q.scale : 0,   // 0 means the game is choosing
    shadows: q.shadows,
    reflections: q.reflections,
    glass: q.glass,
    maxBalls: q.maxBalls,

    // Measurement.
    warm: 0,
    samples: [],
    lastChange: 0,
    fps: 0,
    p95: 0,
    changes: 0,
    reason: '',
  };
}

/** Everything the renderer needs, and nothing it does not. */
export function renderQuality(state) {
  return {
    scale: state.scale,
    shadows: state.shadows,
    reflections: state.reflections,
    glass: state.glass,
    maxBalls: state.maxBalls,
  };
}

/** Discards whatever has been measured. Called after anything that invalidates it. */
export function resetMeasurement(state, now) {
  state.warm = 0;
  state.samples.length = 0;
  state.lastChange = now;
}

/**
 * One frame of measurement, and an adjustment when one is due.
 *
 * `frameMs` is how long the last frame took. Returns true when the render
 * scale changed, so the caller can resize its buffers.
 */
export function observe(state, frameMs, now) {
  const q = state.cfg.quality;
  if (!(frameMs > 0) || !Number.isFinite(frameMs)) return false;

  // Warm up. A card that has just been given work runs slowly for a second or
  // two while it raises its clocks, and a scale chosen from those frames is
  // chosen from a machine that was not trying yet.
  if (state.warm < q.warmSeconds) {
    state.warm += frameMs / 1000;
    return false;
  }

  state.samples.push(frameMs);
  const want = Math.max(8, Math.round(q.sampleSeconds * 1000 / Math.max(1, frameMs)));
  if (state.samples.length > want) state.samples.splice(0, state.samples.length - want);
  if (state.samples.length < 8) return false;

  const sorted = state.samples.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  state.fps = 1000 / median;
  state.p95 = 1000 / sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

  if (!state.auto) return false;
  if (now - state.lastChange < q.holdSeconds * 1000) return false;

  const budget = 1000 / state.target;
  const was = state.scale;

  if (median > budget * 1.15 && state.scale > q.scaleMin) {
    state.scale = Math.max(q.scaleMin, state.scale * q.stepDown);
    state.reason = 'below target';
  } else if (median < budget * 0.80 && state.scale < q.scaleMax) {
    // Climbing back is deliberately slower than falling, so a moment of load
    // does not start an oscillation the player can see.
    state.scale = Math.min(q.scaleMax, state.scale * q.stepUp);
    state.reason = 'headroom';
  } else {
    return false;
  }

  state.scale = Math.round(state.scale * 1000) / 1000;
  if (state.scale === was) return false;
  state.changes++;
  state.lastChange = now;
  state.samples.length = 0;
  return true;
}

/** The player takes the wheel. Passing 0 hands it back to the game. */
export function setScale(state, scale, now) {
  const q = state.cfg.quality;
  if (!(scale > 0)) {
    state.userScale = 0;
    state.auto = true;
  } else {
    state.userScale = Math.min(q.scaleMax, Math.max(q.scaleMin, scale));
    state.scale = state.userScale;
    state.auto = false;
  }
  resetMeasurement(state, now);
}

export function setTarget(state, fps, now) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n < 10) return;
  state.target = n;
  resetMeasurement(state, now);
}

export function setAuto(state, on, now) {
  state.auto = !!on;
  if (state.auto) state.userScale = 0;
  resetMeasurement(state, now);
}

/** What the player has chosen, small enough to sit inside a save. */
export function serializeQuality(state) {
  return {
    auto: state.auto,
    target: state.target,
    userScale: state.userScale,
    shadows: state.shadows,
    reflections: state.reflections,
    glass: state.glass,
    maxBalls: state.maxBalls,
  };
}

export function restoreQuality(state, obj) {
  if (!obj || typeof obj !== 'object') return state;
  const q = state.cfg.quality;
  if (typeof obj.auto === 'boolean') state.auto = obj.auto;
  if (Number.isFinite(obj.target) && obj.target >= 10) state.target = obj.target;
  if (Number.isFinite(obj.userScale) && obj.userScale > 0) {
    state.userScale = Math.min(q.scaleMax, Math.max(q.scaleMin, obj.userScale));
    state.scale = state.userScale;
  }
  if (typeof obj.shadows === 'boolean') state.shadows = obj.shadows;
  if (typeof obj.reflections === 'boolean') state.reflections = obj.reflections;
  if (typeof obj.glass === 'boolean') state.glass = obj.glass;
  if (Number.isFinite(obj.maxBalls) && obj.maxBalls > 0) state.maxBalls = Math.floor(obj.maxBalls);
  return state;
}
