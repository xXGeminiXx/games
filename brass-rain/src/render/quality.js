// ---------------------------------------------------------------------------
// How much of the picture gets paid for.
//
// Four separate levers, because they cost completely different amounts and a
// single "low, medium, high" dial hides that from whoever has to tune it:
//
//   scale        the face is drawn into a buffer this fraction of the window
//                and stretched up at the end. Everything except the bezel and
//                the glass scales with the square of it, so it is the only
//                lever that ever moves the frame rate a lot.
//   shadows      the balls' contact shadows, one instanced pass over the
//                whole ball count.
//   glass        the sheen and the bevel refraction in the final pass. One
//                full window of pixels, independent of how much is on the
//                board.
//   reflections  the second bounce: warm lacquer light under the balls, the
//                turn of the pins, the streak down the reel drums. Shader
//                arithmetic inside passes that are drawn either way, so it
//                saves the least of the four.
//   maxBalls     a ceiling on how many balls are drawn. The simulation is
//                not told; the picture just stops adding them.
//
// At the lowest setting the face is still oxblood lacquer, brass pins, chrome
// balls and enamel pockets under one lamp. It is plainer, not different.
//
// Nothing here decides anything on its own. Quality moves when it is told to
// move, so a machine that stutters once does not cost the player their look
// for the rest of the run.
// ---------------------------------------------------------------------------

export const QUALITY_PRESETS = {
  plain:  { scale: 0.60, shadows: false, reflections: false, glass: false, maxBalls: 600 },
  low:    { scale: 0.75, shadows: true,  reflections: false, glass: false, maxBalls: 1200 },
  medium: { scale: 1.00, shadows: true,  reflections: true,  glass: true,  maxBalls: 2000 },
  high:   { scale: 1.00, shadows: true,  reflections: true,  glass: true,  maxBalls: 6000 },
};

export const DEFAULT_QUALITY = QUALITY_PRESETS.medium;

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 2;
export const MAX_BALLS_CEILING = 200000;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A quality object that is safe to render from: every field present, every
 * number finite and in range, every flag a real boolean. A partial object is
 * treated as a patch over `base`, so `setQuality({ scale: 0.5 })` moves one
 * lever and leaves the rest alone.
 */
export function normaliseQuality(q, base) {
  const b = base || DEFAULT_QUALITY;
  const src = q && typeof q === 'object' ? q : {};
  // A preset name is a shorthand for the whole object, and a patch on top of
  // it still applies, so { preset: 'low', glass: true } means what it says.
  const preset = typeof src.preset === 'string' && QUALITY_PRESETS[src.preset]
    ? QUALITY_PRESETS[src.preset]
    : b;
  const pick = (key) => (src[key] === undefined ? preset[key] : src[key]);
  const scale = Number(pick('scale'));
  const maxBalls = Number(pick('maxBalls'));
  return {
    scale: Number.isFinite(scale) ? clamp(scale, SCALE_MIN, SCALE_MAX) : DEFAULT_QUALITY.scale,
    shadows: !!pick('shadows'),
    reflections: !!pick('reflections'),
    glass: !!pick('glass'),
    maxBalls: Number.isFinite(maxBalls) ? Math.floor(clamp(maxBalls, 0, MAX_BALLS_CEILING)) : DEFAULT_QUALITY.maxBalls,
  };
}

/**
 * The drawing buffer for a canvas of this CSS size at this device ratio.
 *
 * The ratio is capped rather than trusted: a phone reporting 4 asks for
 * sixteen times the pixels of a laptop for a face nobody can see that much
 * of. It is never raised to 1 when the display reports less, because a ratio
 * below 1 is that display's own, and forcing it up is supersampling dressed
 * up as a fix.
 */
export function bufferSize(cssW, cssH, dpr, maxDpr = 2) {
  const ratio = clamp(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 0.25, Math.max(0.25, maxDpr));
  return {
    w: Math.max(1, Math.floor(Math.max(1, cssW) * ratio)),
    h: Math.max(1, Math.floor(Math.max(1, cssH) * ratio)),
    dpr: ratio,
  };
}

/** The offscreen the face is drawn into: the buffer times the render scale. */
export function sceneSize(bufW, bufH, scale) {
  const s = clamp(Number.isFinite(scale) ? scale : 1, SCALE_MIN, SCALE_MAX);
  return {
    w: Math.max(2, Math.round(Math.max(1, bufW) * s)),
    h: Math.max(2, Math.round(Math.max(1, bufH) * s)),
  };
}

/** How many balls get drawn, given how many exist. */
export function drawnBalls(n, q) {
  const have = Math.max(0, Math.floor(Number(n) || 0));
  return Math.min(have, q ? q.maxBalls : DEFAULT_QUALITY.maxBalls);
}
