/**
 * accretion / src/render.js
 * =============================================================================
 * Everything the player sees. Drawn entirely from math: no images, no sprites,
 * no webfonts, no audio, no dependencies. Plain ES module.
 *
 * This file contains ZERO game logic. It knows nothing about clicking, costs,
 * unlocks, or rules. It is handed a snapshot of a world and it draws it. The
 * shape of that snapshot is documented under "THE WORLD CONTRACT" below, and
 * the renderer is deliberately tolerant of missing fields so it can draw a
 * half-built simulation without throwing.
 *
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE
 * -----------------------------------------------------------------------------
 * A run spans roughly forty orders of magnitude. A single dot has to be legible
 * on a black screen; so does a galaxy of a billion things; so does whatever a
 * dimension turns out to look like. And the player must never lose the thread
 * between them.
 *
 * Four systems carry that, and together they ARE the art direction:
 *
 *   1. LOG-SPACE CAMERA. Zoom is stored as log10(pixels per meter) and
 *      integrated with an exponential damper. Interpolating scale linearly is
 *      the classic mistake: it makes zoom lurch, because the eye reads scale
 *      change as *ratio* per second, not difference per second. Damping in log
 *      space makes every zoom, across all forty decades, feel like the same
 *      constant glide. One line of code, and the whole aesthetic hangs off it.
 *
 *   2. AUTO-EXPOSURE. The renderer measures the light in the scene and opens or
 *      stops down a virtual aperture, slowly, like a camera adapting to a dark
 *      room. When there is one dot, the aperture opens: the dot is bright and
 *      the vacuum grain becomes faintly visible behind it. When there is a
 *      galaxy, it stops down and only the peaks survive. This single mechanism
 *      is what makes 1 object and 1e9 objects both readable with no per-scale
 *      tuning, and it is the reason the screen never goes flat white or flat
 *      black.
 *
 *   3. THREE RENDER REGISTERS, chosen per object by its size in PIXELS, never
 *      by what it is:
 *        DISCRETE     - resolvable things. Real discs with limb shading and a
 *                       physically-shaped halo.
 *        STATISTICAL  - populations below the pixel threshold. Drawn as the
 *                       luminosity field the population would produce, plus a
 *                       bounded, deterministic, rotating sample of individual
 *                       representatives so a galaxy has grain instead of being
 *                       a smooth blob. Cost is O(aggregates), not O(bodies).
 *        CONTEXTUAL   - things larger than the viewport. Drawn as the shell you
 *                       are inside: a rim glow leaning toward the parent's
 *                       center of mass, and an edge chevron naming it.
 *      Nothing in the game "switches" representation. The pixel threshold does
 *      it continuously, and objects cross-fade across the boundary.
 *
 *   4. THE MAGNITUDE COLUMN. The Deep Sea uses depth on a vertical axis as its
 *      entire atmosphere. This uses magnitude on the same axis. A ladder of
 *      decade ticks at the right edge slides continuously as you zoom, with the
 *      stratum name inscribed beside the current band. It is not a legend, it
 *      is an odometer, and it is the only HUD element that is always present.
 *      It brightens on scale change and fades back down when you settle.
 *
 * The transition between scales is the payoff the game exists for, so it gets
 * dedicated machinery: SCALE DISSOLVE (see Transition) snapshots the framebuffer
 * at the moment a stratum is crossed and shrinks that snapshot toward the point
 * where the old world now lives. You watch your entire previous universe become
 * one dot, using the framebuffer itself as the only "asset".
 *
 *
 * NUMERICAL MODEL: WHY BIG NUMBERS NEVER TOUCH A FLOAT
 * -----------------------------------------------------------------------------
 * float64 holds ~15-16 significant decimal digits. A flat coordinate space
 * spanning 1e-35..1e26 meters would shred to noise. So positions are NEVER
 * global. Every body lives in a FRAME, and every frame carries a decimal
 * exponent `exp`, where one frame-local unit equals 10^exp meters. A frame's
 * own origin is stored in its PARENT's local units.
 *
 * Screen projection therefore only ever evaluates 10^(frame.exp + cam.logPPM),
 * and frames whose exponent is outside a ~10 decade window of the camera are
 * culled or promoted to the contextual register before that exponent is ever
 * used. The exponent of the world may be 40 decades wide; the exponent of any
 * number this file multiplies is never more than about 5.
 *
 * Frame-local coordinates should be kept within roughly +/-1e6 units by the
 * simulation, which should re-parent a body into a coarser frame past that. If
 * the sim hands over a flat body list with no frames at all, the renderer
 * fabricates one implicit root frame at exp 0 and everything still works; that
 * is the correct behaviour for the first minutes of a run, when the whole world
 * fits inside three decades anyway.
 *
 *
 * THE WORLD CONTRACT
 * -----------------------------------------------------------------------------
 * Everything is optional. Nothing here is imported; this is the shape the
 * renderer reads, and sibling modules are free to grow into it.
 *
 *   world = {
 *     t:        Number,          // seconds, monotonic; used for procedural phase
 *     exp:      Number,          // exponent of the implicit root frame (default 0)
 *     frames:   Frame[],         // optional. omit for a flat single-scale world
 *     bodies:   Body[],          // discrete things, MOST SIGNIFICANT FIRST
 *     aggregates: Aggregate[],   // statistical populations
 *     events:   Event[],         // visual events since last frame; drained by the renderer
 *     focus:    id | null,       // what the camera should frame
 *     extent:   Number,          // radius in meters of the whole run, if known
 *   }
 *
 *   Frame = {
 *     id, parent: id|null,
 *     exp:  Number,              // one local unit = 10^exp meters
 *     x, y: Number,              // origin, in PARENT-local units
 *     spin: Number,              // rad/s, optional; rotates contextual cues
 *   }
 *
 *   Body = {
 *     id,
 *     frame:  id,                // omitted = implicit root
 *     x, y:   Number,            // frame-local units
 *     vx, vy: Number,            // frame-local units/s. optional, used for streaking
 *     r:      Number,            // radius, frame-local units. falls back to mass
 *     m:      Number,            // mass, kg. only used for readouts and fallback radius
 *     T:      Number,            // effective temperature, K. drives colour. optional
 *     lum:    Number,            // relative luminosity, 0..inf. optional, derived if absent
 *     kind:   'grain'|'dust'|'rock'|'planet'|'star'|'giant'|'remnant'|
 *             'neutron'|'blackhole'|'node'
 *     seed:   Number,            // stable integer; drives all per-object procedural detail
 *     spin:   Number,            // -1..1, used by black holes for Doppler asymmetry
 *     a:      Number,            // 0..1 opacity multiplier, for fade in / fade out
 *   }
 *
 *   Aggregate = {                // a population too numerous or too small to draw
 *     id, frame, x, y,
 *     n:      Number,            // population count. only affects grain density
 *     rms:    Number,            // characteristic radius, frame-local units
 *     core:   Number,            // 0..1 concentration. 0 = uniform, 1 = cusped
 *     ecc:    Number,            // 0..1 flattening of the profile
 *     angle:  Number,            // rad, orientation of the major axis
 *     spin:   Number,            // rad/s, apparent rotation of representatives
 *     T:      Number,            // luminosity-weighted temperature, K
 *     lum:    Number,            // total luminosity, relative
 *     kind:   'cloud'|'cluster'|'galaxy'|'group'|'filament'|'web'|'field'
 *   }
 *
 *   Event = {                    // pushed by the sim, drained once, then owned here
 *     type: 'birth'   { x, y, frame, r }                  condensation of new matter
 *         | 'merge'   { x, y, frame, r, T, energy }       two things became one
 *         | 'collapse'{ x, y, frame, r0, r1, kind }       something fell inward
 *         | 'shock'   { x, y, frame, r, speed }           a wave leaves a point
 *         | 'stratum' { exp, name }                       a new order of magnitude
 *   }
 *
 * The renderer is a consumer only. It never writes to the world object except
 * to splice `world.events` empty, which is the documented handoff.
 *
 *
 * FRAME BUDGET
 * -----------------------------------------------------------------------------
 * 60fps is 16.67ms. The load-bearing property is that COST IS BOUNDED BY
 * PIXELS, NOT BY OBJECTS, and the design exists to make object count and frame
 * time independent of each other:
 *
 *   - The discrete register draws at most MAX_DISCS[tier] bodies, chosen as a
 *     prefix of world.bodies. See drawBodies for why a prefix and not something
 *     smarter.
 *   - Aggregates are O(1) each regardless of the population they stand for. A
 *     billion stars is one profile splat plus a bounded set of procedural
 *     representatives, and the representative budget is shared across the whole
 *     screen. Below five screen pixels an aggregate takes a single-stamp fast
 *     path with no transform at all, which is the common case in any wide view.
 *   - Effects, waves and ejecta live in preallocated typed arrays with fixed
 *     ceilings. Nothing in the loop allocates per object; the only per-frame
 *     allocations are a fixed handful of canvas gradients and eight Path2D
 *     bucket objects, which is constant work no matter how much world exists.
 *   - The exposure meter is the only GPU to CPU sync, and it runs on one frame
 *     in five over a buffer of at most 240 by 240.
 *
 * Above the caps the renderer still WALKS whatever arrays the simulation keeps
 * resident, which is O(n) in the sim's own working set rather than in this
 * file. CONFIG.bodyScanCap bounds even that.
 *
 * MEASURED, at 1440x860, DPR 1, in headless Chrome with NO GPU (software
 * rasterisation via SwiftShader). That is the pessimistic case by a wide
 * margin: every one of these is a textured quad blend that hardware
 * compositing does essentially for free. Median and 95th percentile, over 60
 * frames after the camera and aperture have settled:
 *
 *     blank opening screen                       1.6 / 1.8 ms
 *     one body                                   1.8 / 1.9 ms
 *     two bodies with a gravity tether           1.9 / 2.0 ms
 *     ten bodies, a star system                  2.2 / 2.4 ms
 *     240 bodies, an accreting cloud             8.1 / 9.2 ms
 *     300 bodies plus a lensing black hole       4.4 / 4.8 ms
 *     a galaxy: 2 aggregates, 535 representatives, 40 bodies
 *                                                4.9 / 5.2 ms
 *     300 aggregates, the cosmic web             5.6 / 6.1 ms
 *     500 bodies                                 5.1 / 5.8 ms
 *     2,000 bodies                              12.5 / 14.7 ms
 *     2,000 aggregates                          12.3 / 12.7 ms
 *     200,000 bodies                             7.5 / 10.6 ms
 *     1,000,000 bodies                          11.6 / 13.0 ms
 *
 * The last three are the whole architecture in one measurement: a million
 * bodies costs LESS than two thousand, because past the caps the frame is
 * bounded by pixels rather than by population, while two thousand sits right in
 * the band where everything is still drawn individually.
 *
 * Two things were found by measuring that no amount of reading would have
 * caught, and both are recorded at the code they affect. The first is that
 * save()/restore() around a transformed draw under a non-default composite
 * operation can make the rasteriser allocate a layer PER CALL: forty three
 * aggregates cost 70ms in one frame that way, and the identical drawing through
 * an explicit setTransform costs nothing. The second is that sampling the
 * VISIBLE canvas for exposure metering stalls the compositor, which is why the
 * light layer is unconditional and every readback goes to an offscreen surface.
 *
 * Holding the budget when the machine cannot: a quality governor watches an EMA
 * of frame time and steps through four tiers, shedding the second bloom tap,
 * then the first, then the separate light buffer, then device pixel ratio,
 * lowering the disc, aggregate and representative caps as it goes. It steps
 * down after 12 consecutive frames over budget, which is a fifth of a second of
 * stutter and worth reacting to, and back up only after 90 frames comfortably
 * under, which is a second and a half of proven headroom. The asymmetry is what
 * stops it oscillating.
 *
 *
 * WHY THERE IS NO AUDIO PATH, AND WHAT REPLACES IT
 * -----------------------------------------------------------------------------
 * Nothing is ever conveyed by sound. Every event that a game would normally
 * punctuate audibly gets a redundant visual pair: a luminance transient AND a
 * geometric transient. A merge is a flash AND an expanding ring. A collapse is
 * a contracting ring AND a brief tonal inversion of the surrounding field. An
 * unlock is a camera pull-back AND the magnitude column scrolling AND the
 * stratum inscription changing. And because an off-screen event would otherwise
 * be silent in every sense, events outside the viewport raise a directional arc
 * on the screen edge that points at them. See Effects.edgePulse.
 */

// =============================================================================
// CONFIG - every tunable, in one place, so the look can be argued with.
// =============================================================================

export const CONFIG = {
  // --- frame budget and quality -------------------------------------------
  targetFrameMs: 16.67,
  budgetFrameMs: 14.3,        // governor steps down above this
  comfortFrameMs: 11.0,       // governor steps back up below this
  maxDpr: 2,
  bodyScanCap: 200000,        // hard ceiling on the per-frame body array walk
  maxDiscs: 3200,             // allocation ceiling for the pick buffers.
                              // MUST be >= MAX_DISCS[0], which is the per-tier
                              // draw cap and the number that actually governs.
  tracersMax: 4200,           // total procedural representatives, all aggregates
  maxEffects: 256,
  maxEjecta: 1400,

  // --- camera --------------------------------------------------------------
  zoomTauPlayer: 0.34,        // s. player input must feel immediate
  zoomTauAuto: 2.6,           // s. world growth must feel geological
  panTau: 0.22,
  frameFill: 0.62,            // subject occupies this fraction of the short axis
  zoomPerWheelNotch: 0.16,    // decades
  zoomClampDecades: 6.5,      // how far the player may stray from the auto frame
  minLogPPM: -46,
  maxLogPPM: 12,

  // --- legibility floors ----------------------------------------------------
  discPx: 1.35,               // below this screen radius a body becomes a point source
  pointFloorAlpha: 0.055,     // see the note in drawBodies. deliberately low
  haloMul: 5.2,               // halo radius multiple for an unresolved point
  haloResolvedMul: 2.0,       // halo radius multiple once a body has an edge
  haloMinPx: 4.5,

  // --- exposure -------------------------------------------------------------
  exposureTau: 1.35,          // s. slow enough to feel like an eye, not a filter
  exposureMinEv: -6.5,
  exposureMaxEv: 5.5,
  exposureHighlight: 0.86,    // where the brightest ~1.5% of the FINAL image should sit
  exposureAverage: 0.075,     // secondary cap on mean frame luminance

  // --- vacuum field ---------------------------------------------------------
  grainOctaves: 3,
  grainIdealSpacingPx: 92,
  grainAlpha: 0.72,
  nebulaCount: 7,
  nebulaAlpha: 0.055,
  pointerGlowPx: 210,
  pointerGlowAlpha: 0.042,

  // --- tethers --------------------------------------------------------------
  tetherMaxBodies: 120,       // above this the pair pass is skipped entirely
  tetherMaxLines: 40,
  tetherAlpha: 0.17,

  // --- black holes ----------------------------------------------------------
  lensRadiusMul: 15,          // shadow radii out to which bodies are lensed
  einsteinMul: 2.35,          // Einstein radius as a multiple of shadow radius
  discTracers: 260,
  discInnerMul: 1.55,
  discOuterMul: 13,

  // --- HUD ------------------------------------------------------------------
  columnWidthPx: 132,
  decadePx: 46,
  hudIdleAlpha: 0.26,
  hudActiveAlpha: 0.72,
  hudFadeTau: 0.55,
  hudFont: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
  hudFace: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',

  // --- transitions -----------------------------------------------------------
  dissolveMs: 1750,

  // --- input -----------------------------------------------------------------
  ownInput: true,             // set false if the host wants to drive the camera
  reducedMotion: null,        // null = follow prefers-reduced-motion
};

// =============================================================================
// MATH - small, hot, allocation free.
// =============================================================================

const TAU = Math.PI * 2;
const LN10 = Math.LN10;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Frame-rate independent exponential approach. tau is the 63% time in seconds. */
function damp(cur, target, tau, dt) {
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

function smoothstep(e0, e1, x) {
  const t = sat((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Triangular window, peaking at c, zero at c-w and c+w. Used for octave crossfades. */
function tri(x, c, w) {
  return sat(1 - Math.abs(x - c) / w);
}

/**
 * Integer hash. Deterministic per (x, y, seed) so every procedural detail in
 * the world is stable across frames. Nothing here may ever use Math.random in
 * the draw path: a shimmering starfield is the fastest way to make an infinite
 * zoom read as noise instead of as space.
 */
function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// =============================================================================
// COLOUR - every colour in this game is a temperature.
// =============================================================================
//
// There is no palette to art-direct, which is the point: the only chromatic
// decisions available are physical ones. Cold matter is a dim red-brown, a
// young star is blue-white, an old one is amber, and a whole galaxy is the
// luminosity-weighted mean of its population. That produces a coherent adult
// palette for free and it can never drift toward cute. The three colours in the
// game that are NOT blackbody are the void (true black), the photon ring (near
// white with a hair of blue, because it is beamed light not thermal light), and
// the HUD (a desaturated ice tone that reads as instrumentation, not matter).

const BB_STEPS = 96;
const BB_MIN_LOGT = Math.log10(420);
const BB_MAX_LOGT = Math.log10(46000);
const bbR = new Uint8Array(BB_STEPS);
const bbG = new Uint8Array(BB_STEPS);
const bbB = new Uint8Array(BB_STEPS);

(function buildBlackbodyLUT() {
  for (let i = 0; i < BB_STEPS; i++) {
    const t = Math.pow(10, lerp(BB_MIN_LOGT, BB_MAX_LOGT, i / (BB_STEPS - 1)));
    const k = t / 100;
    let r, g, b;
    if (k <= 66) r = 255;
    else r = clamp(329.698727446 * Math.pow(k - 60, -0.1332047592), 0, 255);
    if (k <= 66) g = clamp(99.4708025861 * Math.log(k) - 161.1195681661, 0, 255);
    else g = clamp(288.1221695283 * Math.pow(k - 60, -0.0755148492), 0, 255);
    if (k >= 66) b = 255;
    else if (k <= 19) b = 0;
    else b = clamp(138.5177312231 * Math.log(k - 10) - 305.0447927307, 0, 255);
    // Lift the deep-red end off pure black. A 500K grain that renders as
    // (60, 6, 0) is invisible against the field; the eye needs a little
    // chroma to accept it as an object rather than as compression noise.
    const lift = smoothstep(1600, 400, t) * 26;
    bbR[i] = clamp(r + lift * 0.35, 0, 255);
    bbG[i] = clamp(g + lift * 0.55, 0, 255);
    bbB[i] = clamp(b + lift, 0, 255);
  }
})();

/** Index into the blackbody LUT for a temperature in kelvin. */
function bbIndex(T) {
  const lt = Math.log10(clamp(T || 1200, 420, 46000));
  return clamp(Math.round(((lt - BB_MIN_LOGT) / (BB_MAX_LOGT - BB_MIN_LOGT)) * (BB_STEPS - 1)), 0, BB_STEPS - 1);
}

/** Returns a css rgb() string for a temperature. Only used off the hot path. */
export function blackbody(T, alpha) {
  const i = bbIndex(T);
  if (alpha === undefined) return `rgb(${bbR[i]},${bbG[i]},${bbB[i]})`;
  return `rgba(${bbR[i]},${bbG[i]},${bbB[i]},${alpha})`;
}

const HUD_RGB = '176,203,222';

// =============================================================================
// SCALE - decades, units, and the names of the strata.
// =============================================================================
//
// The strata are the vocabulary of the whole run. They are inscribed beside the
// magnitude column rather than explained, on the theory that a player who sees
// "planetesimal" replaced by "planet" while the view pulls back has understood
// the mechanic completely and has not been told anything.

const STRATA = [
  [-35, 'planck'], [-18, 'subnuclear'], [-15, 'nuclear'], [-11, 'atomic'],
  [-9, 'molecular'], [-6, 'grain'], [-3, 'dust'], [-1, 'pebble'],
  [1, 'body'], [3, 'planetesimal'], [5, 'protoplanet'], [6, 'planet'],
  [8, 'star'], [10, 'system'], [13, 'reach'], [16, 'cloud'],
  [17, 'nebula'], [18, 'cluster'], [20, 'arm'], [21, 'galaxy'],
  [23, 'group'], [24, 'supercluster'], [25, 'filament'], [26, 'web'],
  [27, 'horizon'], [29, 'universe'], [32, 'ensemble'], [35, 'manifold'],
  [38, 'dimension'], [41, 'unbounded'],
];

const UNITS = [
  [-15, 'fm', 1e-15], [-12, 'pm', 1e-12], [-9, 'nm', 1e-9], [-6, 'um', 1e-6],
  [-3, 'mm', 1e-3], [0, 'm', 1], [3, 'km', 1e3], [11, 'AU', 1.495978707e11],
  [16, 'ly', 9.4607e15], [19, 'kpc', 3.0857e19], [22, 'Mpc', 3.0857e22],
  [25, 'Gpc', 3.0857e25],
];

export const Scale = {
  /** Name of the stratum containing a given log10(meters). */
  stratum(logM) {
    let name = STRATA[0][1];
    for (let i = 0; i < STRATA.length; i++) {
      if (logM >= STRATA[i][0]) name = STRATA[i][1];
      else break;
    }
    return name;
  },
  /** The next stratum boundary above logM, or null. Used to pace the column. */
  nextBoundary(logM) {
    for (let i = 0; i < STRATA.length; i++) if (STRATA[i][0] > logM) return STRATA[i];
    return null;
  },
  /**
   * A length as a short human string. Below femtometers and above gigaparsecs
   * the honest answer is the exponent itself, which is also the answer the
   * player is being trained to read all run.
   */
  length(meters) {
    const a = Math.abs(meters);
    if (!isFinite(a) || a === 0) return '0 m';
    const l = Math.log10(a);
    if (l < -16 || l > 26.6) return `10^${l.toFixed(1)} m`;
    let u = UNITS[0];
    for (let i = 0; i < UNITS.length; i++) if (l >= UNITS[i][0]) u = UNITS[i];
    const v = a / u[2];
    const d = v < 10 ? 2 : v < 100 ? 1 : 0;
    return `${v.toFixed(d)} ${u[1]}`;
  },
  /**
   * Mass as a magnitude. Across forty decades the mantissa is decoration and
   * the exponent is the entire message, so the exponent is what is set large.
   */
  mass(kg) {
    if (!isFinite(kg) || kg <= 0) return { exp: '0', unit: 'kg' };
    return { exp: Math.log10(kg).toFixed(1), unit: 'kg' };
  },
};

// =============================================================================
// SPRITE ATLAS - the only reason thousands of glowing things hold 60fps.
// =============================================================================
//
// ctx.shadowBlur is unusably slow and a per-body createRadialGradient allocates
// a gradient object per draw. Both are avoided completely by baking the light
// profiles once, at startup, into offscreen canvases: a small grid of
// temperature buckets crossed with three falloff profiles. Drawing a glowing
// body then costs exactly one drawImage, which is a textured quad the compositor
// is extremely good at. This is generated math, not an asset; nothing is loaded.
//
// Profiles, and why three:
//   CORE  p=5.4  a tight nucleus. what makes a body read as solid.
//   HALO  p=2.1  the scattering halo. what makes a point source read as a star
//                rather than as a dead pixel.
//   VEIL  p=1.15 a very broad, very faint wash. the luminosity profile of a
//                population, used by the statistical register.

const PROFILES = [
  { name: 'core', p: 5.4, inner: 0.16 },
  { name: 'halo', p: 2.1, inner: 0.02 },
  { name: 'veil', p: 1.15, inner: 0.0 },
  { name: 'disc', disc: true },
];
const ATLAS_BUCKETS = 24;
const STAMP_PX = 96;
const STAMP_R = STAMP_PX / 2;

class Atlas {
  constructor() {
    this.stamps = [];       // [profile][bucket] -> canvas
    this.build();
  }

  build() {
    for (let p = 0; p < PROFILES.length; p++) {
      const row = [];
      for (let b = 0; b < ATLAS_BUCKETS; b++) {
        const lutIndex = Math.round((b / (ATLAS_BUCKETS - 1)) * (BB_STEPS - 1));
        row.push(this.makeStamp(PROFILES[p], bbR[lutIndex], bbG[lutIndex], bbB[lutIndex]));
      }
      this.stamps.push(row);
    }
  }

  makeStamp(prof, r, g, b) {
    const c = document.createElement('canvas');
    c.width = c.height = STAMP_PX;
    const x = c.getContext('2d');
    const grad = x.createRadialGradient(STAMP_R, STAMP_R, 0, STAMP_R, STAMP_R, STAMP_R);
    if (prof.disc) {
      // A limb-darkened sphere with a hard terminator. Brightness follows
      // sqrt(1 - (r/R)^2), which is the projection of a uniformly lit sphere,
      // and the alpha holds at one until the very edge so the silhouette is
      // crisp. This is the stamp that makes a planet a planet.
      for (let i = 0; i <= 26; i++) {
        const u = i / 26;
        const q = u / 0.5;
        const limb = q < 1 ? Math.pow(Math.sqrt(1 - q * q), 0.62) : 0;
        const a = u < 0.472 ? 1 : u < 0.5 ? 1 - (u - 0.472) / 0.028 : 0;
        const w = limb * 0.45;
        const rr = Math.round(lerp(r * limb, 255, w * w));
        const gg = Math.round(lerp(g * limb, 255, w * w));
        const bb = Math.round(lerp(b * limb, 255, w * w));
        grad.addColorStop(u, `rgba(${rr},${gg},${bb},${a.toFixed(4)})`);
      }
      x.fillStyle = grad;
      x.fillRect(0, 0, STAMP_PX, STAMP_PX);
      return c;
    }
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      // Falloff, plus a flat inner plateau that keeps small stamps from
      // looking like a pinprick when scaled down to two or three pixels.
      let a = Math.pow(1 - u, prof.p);
      if (u < prof.inner) a = 1;
      // Hot cores desaturate toward white the way any bright emitter does on a
      // display. Without this, a bright star is a saturated orange disc, which
      // reads as cartoon rather than as light.
      const w = Math.pow(1 - u, 6) * 0.72;
      const rr = Math.round(lerp(r, 255, w));
      const gg = Math.round(lerp(g, 255, w));
      const bb = Math.round(lerp(b, 255, w));
      grad.addColorStop(u, `rgba(${rr},${gg},${bb},${a.toFixed(4)})`);
    }
    x.fillStyle = grad;
    x.fillRect(0, 0, STAMP_PX, STAMP_PX);
    return c;
  }

  stamp(profileIndex, T) {
    const b = Math.round((bbIndex(T) / (BB_STEPS - 1)) * (ATLAS_BUCKETS - 1));
    return this.stamps[profileIndex][b];
  }
}

const PROF_CORE = 0, PROF_HALO = 1, PROF_VEIL = 2, PROF_DISC = 3;

// =============================================================================
// CAMERA - log-space zoom, auto-framing, and a player offset that survives it.
// =============================================================================
//
// The camera never fights the player and never loses the player. It tracks an
// automatic framing derived from the largest coherent thing in the world, and
// the player's zoom and pan are stored as an OFFSET from that framing rather
// than as an absolute. So: the world can grow by forty orders of magnitude
// underneath a player who has zoomed in on one rock, and that player stays
// zoomed in on the rock by the same relative amount, forever, without touching
// the wheel. That property is the entire answer to "the player must never be
// lost between scales".
//
// Two damping constants, and the difference between them is deliberate. Player
// zoom resolves in about a third of a second because input that lags feels
// broken. Automatic reframing resolves over two and a half seconds because a
// view that snaps when the world grows feels like the game took the camera
// away. The player should be able to feel the world getting larger without ever
// catching the camera moving.

class Camera {
  constructor() {
    this.logPPM = 1.6;        // log10(pixels per meter). the whole zoom state
    this.targetLogPPM = 1.6;
    this.autoLogPPM = 1.6;
    this.zoomOffset = 0;      // decades. the player's opinion, preserved forever
    this.x = 0; this.y = 0;   // in anchor-frame local units
    this.tx = 0; this.ty = 0;
    this.panOffX = 0; this.panOffY = 0;   // screen px, player pan, decays slowly
    this.anchorExp = 0;
    this.anchorFrame = null;
    this.settled = 1;         // 0 while scale is changing. drives HUD brightness
    this.lastLogPPM = 1.6;
    this.velDecades = 0;      // decades per second, smoothed. used by the grain
  }

  /** Screen pixels per meter, only ever evaluated near the camera's own scale. */
  get ppm() { return Math.pow(10, this.logPPM); }

  /**
   * Frame the given subject radius (in meters). Called every frame with
   * whatever the world says its largest coherent extent is.
   */
  aim(subjectMeters, shortAxisPx) {
    if (!(subjectMeters > 0) || !isFinite(subjectMeters)) return;
    const want = Math.log10((shortAxisPx * CONFIG.frameFill) / (2 * subjectMeters));
    this.autoLogPPM = want;
  }

  step(dt) {
    this.zoomOffset = clamp(this.zoomOffset, -CONFIG.zoomClampDecades, CONFIG.zoomClampDecades);
    const auto = clamp(this.autoLogPPM, CONFIG.minLogPPM, CONFIG.maxLogPPM);
    // Auto framing is damped separately and slowly, then the player's offset is
    // added on top and damped fast. Composing them this way is what lets the
    // world grow without ever yanking a player who is holding a framing.
    this.autoSmoothed = damp(this.autoSmoothed === undefined ? auto : this.autoSmoothed,
      auto, CONFIG.zoomTauAuto, dt);
    this.targetLogPPM = clamp(this.autoSmoothed + this.zoomOffset, CONFIG.minLogPPM, CONFIG.maxLogPPM);
    this.logPPM = damp(this.logPPM, this.targetLogPPM, CONFIG.zoomTauPlayer, dt);

    this.x = damp(this.x, this.tx, CONFIG.panTau, dt);
    this.y = damp(this.y, this.ty, CONFIG.panTau, dt);

    const d = (this.logPPM - this.lastLogPPM) / Math.max(dt, 1e-4);
    this.velDecades = damp(this.velDecades, d, 0.10, dt);
    this.lastLogPPM = this.logPPM;

    // "Settled" is a perceptual quantity, not a physical one: it is how much
    // the view has changed recently, and it is what the HUD listens to. Move
    // through scale and the instrumentation comes up; stop and it recedes.
    const activity = sat(Math.abs(this.velDecades) * 6);
    this.settled = damp(this.settled, 1 - activity, CONFIG.hudFadeTau, dt);
  }

  /** Zoom by a number of decades, keeping the point under (sx, sy) fixed. */
  zoomAt(decades, sx, sy, halfW, halfH) {
    const before = this.zoomOffset;
    this.zoomOffset = clamp(this.zoomOffset + decades, -CONFIG.zoomClampDecades, CONFIG.zoomClampDecades);
    const applied = this.zoomOffset - before;
    if (applied === 0) return;
    // Keep the cursor anchored: the offset from centre scales with the zoom.
    const f = Math.pow(10, applied);
    this.panOffX = (this.panOffX - (sx - halfW)) * f + (sx - halfW);
    this.panOffY = (this.panOffY - (sy - halfH)) * f + (sy - halfH);
  }

  panBy(dx, dy) { this.panOffX += dx; this.panOffY += dy; }
  resetOffsets() { this.zoomOffset = 0; this.panOffX = 0; this.panOffY = 0; }
}

// =============================================================================
// FRAME TREE - projection, and how a forty-decade world is culled to a screen.
// =============================================================================
//
// Once per frame the tree is walked outward from the camera's anchor frame in
// both directions: down into children, up into ancestors. Each frame gets a
// screen origin and a pixels-per-local-unit factor. Because the walk starts at
// the anchor and each step is a single multiply by a neighbour's already-safe
// pixel factor, no intermediate value is ever more than a few decades from the
// screen. A world forty decades wide is projected without ever forming a number
// larger than about 1e10.

const FRAME_WINDOW = 9;   // decades either side of the camera worth visiting

class Projection {
  constructor() {
    this.map = new Map();   // frameId -> { ox, oy, k, exp, vis, frame }
    this.list = [];
    this.root = { id: '__root', parent: null, exp: 0, x: 0, y: 0 };
    this.rootProj = null;
  }

  build(world, cam, halfW, halfH) {
    this.map.clear();
    this.list.length = 0;

    const frames = world && world.frames && world.frames.length ? world.frames : null;
    this.root.exp = (world && typeof world.exp === 'number') ? world.exp : 0;

    if (!frames) {
      // Flat world. One implicit frame; correct and fast for the first minutes
      // of a run, when everything fits inside three decades anyway.
      const k = Math.pow(10, this.root.exp + cam.logPPM);
      const p = {
        frame: this.root, exp: this.root.exp, k,
        ox: halfW - cam.x * k + cam.panOffX,
        oy: halfH - cam.y * k + cam.panOffY,
        vis: true,
      };
      this.map.set('__root', p);
      this.map.set(undefined, p);
      this.list.push(p);
      this.rootProj = p;
      return;
    }

    const byId = new Map();
    const kids = new Map();
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      byId.set(f.id, f);
      const pid = f.parent === undefined ? null : f.parent;
      if (!kids.has(pid)) kids.set(pid, []);
      kids.get(pid).push(f);
    }

    // Anchor: the frame the camera lives in, or the closest in exponent.
    let anchor = byId.get(cam.anchorFrame);
    if (!anchor) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const d = Math.abs(frames[i].exp + cam.logPPM);
        if (d < bestD) { bestD = d; best = frames[i]; }
      }
      anchor = best || this.root;
    }

    const kOf = (f) => Math.pow(10, f.exp + cam.logPPM);
    const ak = kOf(anchor);
    const ap = {
      frame: anchor, exp: anchor.exp, k: ak,
      ox: halfW - cam.x * ak + cam.panOffX,
      oy: halfH - cam.y * ak + cam.panOffY,
      vis: true,
    };
    this.map.set(anchor.id, ap);
    this.list.push(ap);

    // Upward: a child's origin is known, so the parent's follows from it.
    let child = anchor, cp = ap;
    while (child.parent != null) {
      const par = byId.get(child.parent);
      if (!par || this.map.has(par.id)) break;
      const pk = kOf(par);
      const p = {
        frame: par, exp: par.exp, k: pk,
        ox: cp.ox - child.x * pk,
        oy: cp.oy - child.y * pk,
        vis: true,
      };
      this.map.set(par.id, p);
      this.list.push(p);
      child = par; cp = p;
    }

    // Downward: breadth first from every frame already placed. Cull anything
    // whose exponent has left the window or whose origin has left the screen by
    // more than its own plausible extent.
    const queue = this.list.slice();
    const lim = Math.max(halfW, halfH) * 4;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      const ks = kids.get(p.frame.id);
      if (!ks) continue;
      for (let i = 0; i < ks.length; i++) {
        const f = ks[i];
        if (this.map.has(f.id)) continue;
        const rel = f.exp + cam.logPPM;
        if (rel < -FRAME_WINDOW || rel > FRAME_WINDOW) continue;
        const ox = p.ox + f.x * p.k;
        const oy = p.oy + f.y * p.k;
        if (!isFinite(ox) || !isFinite(oy)) continue;
        if (ox < -lim || ox > halfW * 2 + lim || oy < -lim || oy > halfH * 2 + lim) continue;
        const np = { frame: f, exp: f.exp, k: Math.pow(10, rel), ox, oy, vis: true };
        this.map.set(f.id, np);
        this.list.push(np);
        queue.push(np);
      }
    }

    this.rootProj = this.map.get(anchor.id);
    if (!this.map.has(undefined)) this.map.set(undefined, this.rootProj);
    if (!this.map.has('__root')) this.map.set('__root', this.rootProj);
  }

  /**
   * Returns undefined for a frame that was CULLED, and every caller treats that
   * as "skip this object". Falling back to the root frame instead looks
   * harmless and is not: a body whose frame sits outside the scale window then
   * gets drawn with the root's transform, so everything in every distant frame
   * piles up around the origin at completely the wrong size. It shows up as a
   * body count far larger than the projected frames can account for, which is
   * exactly how it was caught.
   *
   * The implicit-root keys (undefined and '__root') ARE registered in the map,
   * so a body that simply declares no frame still resolves correctly.
   */
  of(frameId) {
    return this.map.get(frameId);
  }
}

// =============================================================================
// EXPOSURE - the aperture that makes one dot and one galaxy both readable.
// =============================================================================
//
// This is measured from the previous frame's draw so it costs nothing: every
// draw call adds its own light contribution to an accumulator, and at the end
// of the frame that accumulator becomes next frame's aperture. It is damped
// hard, so the adaptation is felt as an atmosphere rather than seen as a
// flicker: fly into a dense cluster and the field behind it visibly darkens
// over a second and a half, exactly like an eye.

const HIST_BINS = 32, METER_MAX = 240, METER_DIV = 8, METER_EVERY = 5;

class Exposure {
  constructor() {
    this.ev = 0; this.gain = 1; this.mean = 0.02; this.peak = 0.5;
    this.meter = document.createElement('canvas');
    this.mctx = this.meter.getContext('2d', { willReadFrequently: true });
    this.hist = new Uint32Array(HIST_BINS);
    this.mw = 1; this.mh = 1;
    this.tick = 0;
    this.resize(64, 36);
  }

  /**
   * The meter runs at about a sixth of render resolution, capped.
   *
   * Resolution is the whole design question here, and the first attempt got it
   * wrong in an instructive way: metering a heavily blurred buffer is cheap and
   * convenient, but blur is exactly the operation that destroys the peaks the
   * highlight meter exists to find. A field of three hundred small bright
   * galaxies measured through a blur reads as almost black, the controller winds
   * to its ceiling, and the aperture stops doing anything at all. A modest
   * unblurred downsample keeps a ten pixel feature as a two pixel feature,
   * which is enough to survive into the histogram.
   */
  resize(w, h) {
    this.mw = clamp(Math.round(w / METER_DIV), 24, METER_MAX);
    this.mh = clamp(Math.round(h / METER_DIV), 14, METER_MAX);
    this.meter.width = this.mw;
    this.meter.height = this.mh;
  }

  /**
   * Measure what was actually painted, rather than estimating it.
   *
   * The source must be the ALREADY BLURRED eighth-resolution light buffer, not
   * the full resolution one. Downsampling a full resolution canvas straight to
   * 32x18 is a bilinear operation that takes a handful of taps and would miss a
   * single bright star entirely, which is exactly the case where the aperture
   * matters most. The blur pass has already spread every peak across its
   * neighbourhood, so sampling it is representative.
   *
   * 576 pixels, on alternate frames. The readback is the only GPU to CPU sync
   * in the renderer and it is deliberately kept this small.
   */
  measure(source) {
    if (this.tick++ % METER_EVERY) return;
    const m = this.mctx;
    m.globalCompositeOperation = 'copy';
    m.drawImage(source, 0, 0, this.mw, this.mh);
    m.globalCompositeOperation = 'source-over';
    let sum = 0, lit = 0;
    const d = m.getImageData(0, 0, this.mw, this.mh).data;
    const hist = this.hist;
    hist.fill(0);
    const n = this.mw * this.mh;
    for (let i = 0; i < d.length; i += 4) {
      // Rec.709 luma, weighted by coverage. The light layer is premultiplied
      // over transparent black, so alpha carries how much of the pixel is lit.
      const y = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) * (d[i + 3] / 255);
      sum += y;
      const b = (y * (HIST_BINS - 1) / 255) | 0;
      hist[b]++;
      if (b > 0) lit++;
    }
    this.mean = sum / (n * 255);

    // The highlight level is a percentile over the LIT pixels, not over the
    // frame, and that distinction is what makes it work across forty decades.
    //
    // A whole-frame percentile silently measures composition rather than
    // brightness: the same galaxy occupying two percent of the screen and forty
    // percent of the screen produces wildly different readings, so the aperture
    // lurches whenever the subject changes apparent size, which in this game is
    // constantly. Restricting the population to pixels that have any light in
    // them at all removes the dependence on how much black surrounds the
    // subject, and one dot on an empty screen and a screen filled with galaxies
    // then land on the same statistic.
    const want = Math.max(3, lit * 0.02);
    let acc = 0, bin = HIST_BINS - 1;
    for (; bin > 0; bin--) { acc += hist[bin]; if (acc >= want) break; }
    this.peak = (bin + 0.5) / HIST_BINS;
    this.lit = lit / n;
  }

  /**
   * A leaky integrator on the log error, NOT an absolute setting.
   *
   * This distinction is easy to get wrong and produces a very convincing bug:
   * `ev = log2(target / mean)` looks like the right formula, but the mean was
   * measured with the CURRENT gain already applied, so that expression settles
   * at whatever fixed point satisfies ev == log2(target / mean(ev)) and the
   * measured luminance never actually reaches the target. Adding the error to
   * the existing ev integrates it away properly. Clamping inside the loop also
   * prevents the integrator winding up when the scene is saturated and more
   * gain can no longer raise the measurement.
   */
  step(dt, bloomGain) {
    // HIGHLIGHT PRIORITY, with average as a secondary cap.
    //
    // Average metering is the obvious choice and it is wrong here, because the
    // screen is deliberately mostly empty: a subject occupying four percent of
    // the frame cannot move the average to any sane target even when it is pure
    // white, so an average-driven controller simply winds to its ceiling and
    // stays there. Exposing for the BRIGHTEST few percent instead drives the
    // top of the image to a constant, which is precisely the invariant wanted
    // here: whatever the largest thing in view happens to be, one dot or a
    // supercluster, its bright parts sit just under clipping. The average is
    // kept as a second constraint so a screen that really is full of light gets
    // pulled down further, and the more restrictive of the two always wins.
    // The meter reads the LIGHT layer, but the player sees light plus bloom,
    // and bloom very nearly doubles a broad bright region. Without dividing it
    // out, the aperture happily exposes the light layer to half scale and the
    // composite clips anyway. The factor tracks the quality tier, because the
    // governor sheds bloom taps.
    const target = CONFIG.exposureHighlight / Math.max(bloomGain || 1, 0.25);
    const errPeak = Math.log2(target / Math.max(this.peak, 2e-3));
    const errMean = Math.log2(CONFIG.exposureAverage / Math.max(this.mean, 2e-5));
    const targetEv = clamp(this.ev + Math.min(errPeak, errMean),
      CONFIG.exposureMinEv, CONFIG.exposureMaxEv);
    this.ev = damp(this.ev, targetEv, CONFIG.exposureTau, dt);
    this.gain = Math.pow(2, this.ev);
  }

  /**
   * The vacuum is lit by the aperture too, but inversely and weakly. A wide
   * open aperture on an empty screen is what makes the grain faintly visible in
   * the first seconds; a stopped-down one on a galaxy sinks the grain back into
   * black so it never competes with the subject.
   */
  get fieldGain() { return clamp(0.35 + this.ev * 0.14, 0.22, 1.5); }
}

// =============================================================================
// VACUUM FIELD - why a black screen has to not be a black rectangle.
// =============================================================================
//
// An unlit canvas is a dead surface. Space is not: it has depth, it has an
// enormous faint structure, and above all it has PARALLAX, which is the only
// thing that tells an eye it is moving. The field is three layers:
//
//   1. A base gradient, almost imperceptible, that breaks the flatness.
//   2. Nebular structure: a handful of huge, very low alpha radial washes in
//      cold indigo and dim rust, positioned by hash and re-rolled per decade.
//      Cached to a tile and redrawn only when the decade changes.
//   3. THE GRAIN, which is the important one. A scale-locked point lattice in
//      three octaves whose screen spacing is held near 92px. As you zoom, the
//      octave whose spacing has grown past ~184px fades out while a new finer
//      one fades in below. The result is an infinitely deep dust field with no
//      repetition and no popping, and the RATE at which grains slide past is a
//      direct readout of how fast you are moving through scale. That is the
//      Deep Sea trick, and it is the single cheapest thing in this file that
//      makes forty decades feel traversed rather than jumped.
//
// The grain is anchored to an integrated pan offset rather than to world
// coordinates. This is deliberate. Attaching the vacuum to real positions would
// require global coordinates, which is precisely the thing that cannot exist in
// a forty-decade world. The vacuum is the void, not an object in it.

class VacuumField {
  constructor() {
    this.tile = document.createElement('canvas');
    this.tctx = this.tile.getContext('2d');
    this.dither = makeDitherTile();
    // Nebulae are pure low-frequency gradients, so they are generated at half
    // resolution and upscaled. Visually identical, four times cheaper, and it
    // matters because the whole tile is rebuilt in a single frame whenever the
    // camera crosses a scale band. At full resolution that rebuild was a
    // measurable spike in the frame time percentile.
    this.low = document.createElement('canvas');
    this.lctx = this.low.getContext('2d');
    this.tileDecade = NaN;
    this.tileW = 0; this.tileH = 0;
    this.offX = new Float64Array(8);
    this.offY = new Float64Array(8);
    this.buckets = [];
    for (let i = 0; i < 8; i++) this.buckets.push(new Path2D());
  }

  resize(w, h) {
    this.tileW = w; this.tileH = h;
    this.tile.width = Math.max(1, w);
    this.tile.height = Math.max(1, h);
    this.low.width = Math.max(1, w >> 1);
    this.low.height = Math.max(1, h >> 1);
    this.tileDecade = NaN;
  }

  /** Huge cold washes. Regenerated only when the decade changes: cheap enough. */
  ensureTile(decade, w, h) {
    if (this.tileDecade === decade && this.tileW === w) return;
    this.tileDecade = decade;
    const x = this.lctx;
    const lw = this.low.width, lh = this.low.height;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, lw, lh);
    // Generated in half-resolution space, then blown up.
    x.save();
    x.scale(lw / w, lh / h);
    const d = decade | 0;
    for (let i = 0; i < CONFIG.nebulaCount; i++) {
      const hx = hash3(i, d, 7717);
      const hy = hash3(i, d, 3391);
      const hr = hash3(i, d, 9931);
      const hc = hash3(i, d, 1237);
      const cx = hx * w * 1.4 - w * 0.2;
      const cy = hy * h * 1.4 - h * 0.2;
      const rad = (0.35 + hr * 0.75) * Math.max(w, h);
      // Cold indigo through faint teal through a dim rust. These are the
      // colours of thin matter lit by nothing in particular, kept below 6%
      // alpha so they are felt as depth rather than seen as clouds.
      const c = hc < 0.45 ? [46, 62, 122] : hc < 0.78 ? [34, 84, 96] : [104, 58, 44];
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const a = CONFIG.nebulaAlpha * (0.55 + hr * 0.9);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(4)})`);
      g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},${(a * 0.35).toFixed(4)})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    x.restore();

    const t = this.tctx;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'copy';
    t.drawImage(this.low, 0, 0, w, h);
    t.globalCompositeOperation = 'source-over';

    // Dither, at FULL resolution and after the upscale, which is the only order
    // that works: a gradient this faint quantises to eight bits and shows
    // visible contour bands, and on a screen meant to read as depth that is the
    // most damaging artifact available. A few units of hashed noise destroys the
    // contours completely, but only if it is applied at the resolution the
    // banding lives at. Baked into the tile, so it costs nothing per frame.
    const pat = t.createPattern(this.dither, 'repeat');
    if (pat) {
      t.globalCompositeOperation = 'lighter';
      t.fillStyle = pat;
      t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'source-over';
    }
  }

  draw(ctx, cam, w, h, dPanX, dPanY, exposure, pointer, dt) {
    // Base. Not black: a very cold vertical fall with a hair of warmth low
    // down. On an OLED this is the difference between "space" and "the monitor
    // is off", and it costs one gradient fill.
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#04060b');
    base.addColorStop(0.62, '#05060a');
    base.addColorStop(1, '#080609');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const decade = Math.floor(cam.logPPM / 3);
    this.ensureTile(decade, w, h);
    // Cross-fade the nebular tile across the boundary so the structure
    // dissolves instead of cutting. The dip bottoms out at about half alpha,
    // exactly where the tile is swapped, which hides the change of hash.
    const f = cam.logPPM / 3 - decade;
    ctx.globalAlpha = sat(1 - Math.abs(f - 0.5) * 1.1) * 0.9 + 0.1;
    ctx.drawImage(this.tile, 0, 0, w, h);
    ctx.globalAlpha = 1;

    this.drawGrain(ctx, cam, w, h, dPanX, dPanY, exposure, pointer);

    // The pointer wash. Before the player has clicked anything, this is the
    // only thing on screen that answers them, and it is what teaches the click
    // without a tutorial: the void is already reacting to where they are.
    if (pointer.inside) {
      const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, CONFIG.pointerGlowPx);
      const a = CONFIG.pointerGlowAlpha * pointer.warm;
      g.addColorStop(0, `rgba(150,178,205,${a.toFixed(4)})`);
      g.addColorStop(1, 'rgba(150,178,205,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(pointer.x - CONFIG.pointerGlowPx, pointer.y - CONFIG.pointerGlowPx,
        CONFIG.pointerGlowPx * 2, CONFIG.pointerGlowPx * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawGrain(ctx, cam, w, h, dPanX, dPanY, exposure, pointer) {
    const oct = CONFIG.grainOctaves;
    // Choose the base level so that one octave sits at the ideal spacing. As
    // logPPM slides continuously, k0 steps by one and the triangular windows
    // hand off between octaves with no visible event.
    const z = cam.logPPM;
    const idealLog2 = Math.log2(CONFIG.grainIdealSpacingPx);
    const k0f = idealLog2 - z * (LN10 / Math.LN2);
    const k0 = Math.floor(k0f);

    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = new Path2D();
    let drawn = 0;
    const cap = 4200;

    for (let o = 0; o < oct; o++) {
      const k = k0 + o;
      const spacing = Math.pow(2, k) * Math.pow(10, z);
      if (!(spacing > 6) || spacing > 3000) continue;
      // Window: full strength at the ideal spacing, gone at half and double.
      const wgt = tri(Math.log2(spacing), idealLog2, 1.15);
      if (wgt <= 0.01) continue;

      // Parallax: coarser octaves drift slower, which is what gives the field
      // depth. Offsets are integrated in lattice units and wrapped, so they
      // stay bounded forever regardless of how far the camera travels.
      const par = 1 / (1 + o * 0.55);
      this.offX[o] = (this.offX[o] - (dPanX * par) / spacing) % 4096;
      this.offY[o] = (this.offY[o] - (dPanY * par) / spacing) % 4096;

      const i0 = Math.floor(this.offX[o]) - 1;
      const j0 = Math.floor(this.offY[o]) - 1;
      const nx = Math.ceil(w / spacing) + 2;
      const ny = Math.ceil(h / spacing) + 2;
      const fx = (this.offX[o] - Math.floor(this.offX[o])) * spacing;
      const fy = (this.offY[o] - Math.floor(this.offY[o])) * spacing;

      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          if (drawn >= cap) break;
          const gi = i0 + i, gj = j0 + j;
          const hv = hash3(gi, gj, 1013 + k * 131);
          if (hv > 0.62) continue;   // most cells are empty. sparse reads as far
          const jx = hash3(gi, gj, 5501);
          const jy = hash3(gi, gj, 7717);
          const sx = (i + jx - 1) * spacing - fx;
          const sy = (j + jy - 1) * spacing - fy;
          if (sx < -2 || sx > w + 2 || sy < -2 || sy > h + 2) continue;
          let a = (0.10 + hv * 1.25) * wgt * CONFIG.grainAlpha * exposure.fieldGain;
          // Grain leans toward the pointer. Subliminal, but it is what makes
          // the empty screen feel like a medium rather than a background.
          if (pointer.inside) {
            const dx = sx - pointer.x, dy = sy - pointer.y;
            const d2 = dx * dx + dy * dy;
            const rr = CONFIG.pointerGlowPx * CONFIG.pointerGlowPx;
            if (d2 < rr) a += (1 - d2 / rr) * 0.30 * pointer.warm;
          }
          if (a <= 0.012) continue;
          const b = clamp((a * 8) | 0, 0, 7);
          const size = hv < 0.10 ? 1.7 : 1;
          this.buckets[b].rect(sx | 0, sy | 0, size, size);
          drawn++;
        }
      }
    }

    // Eight fills instead of four thousand. The alpha quantisation is invisible
    // at these levels and it turns the grain from a per-point cost into a
    // per-bucket one.
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < 8; b++) {
      ctx.fillStyle = `rgba(196,214,236,${((b + 0.5) / 8).toFixed(3)})`;
      ctx.fill(this.buckets[b]);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// =============================================================================
// EFFECTS - every transient, pooled, with no allocation in the draw path.
// =============================================================================
//
// Since nothing may be conveyed by sound, each transient is redundantly coded:
// a LUMINANCE change and a GEOMETRIC change, always both. A flash alone can be
// missed by a player looking elsewhere on the screen; a ring that sweeps across
// the whole viewport cannot.

const FX_NONE = 0, FX_FLASH = 1, FX_RING = 2, FX_IMPLODE = 3, FX_CONDENSE = 4, FX_EDGE = 5;

/**
 * A shock front: two concentric strokes, a thin bright edge over a wide dim
 * wake. STROKED, not stamped, and that is the whole point of the function.
 *
 * The first implementation drew waves by scaling a pre-baked annulus stamp to
 * the wave radius, which is fast and looks completely wrong, because a scaled
 * stamp scales its own feature width too. A wave crossing the whole viewport
 * then arrives as a viewport-sized soft blob rather than as a front, and the
 * one gesture that has to carry "something happened over there" without any
 * sound turns into fog. A real front stays thin as it expands. Line width here
 * grows only weakly with radius, so a wave reads as a wave at two pixels and at
 * two thousand.
 */
function strokeFront(ctx, x, y, r, a, motion) {
  const lw = clamp(1.6 + r * 0.010, 1.4, 8);
  ctx.strokeStyle = 'rgba(212,231,255,1)';
  ctx.globalAlpha = sat(a * 0.20 * motion);
  ctx.lineWidth = lw * 4.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.globalAlpha = sat(a);
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

class Effects {
  constructor(atlas) {
    this.atlas = atlas;
    const n = CONFIG.maxEffects;
    this.type = new Uint8Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.r0 = new Float32Array(n); this.r1 = new Float32Array(n);
    this.t = new Float32Array(n); this.life = new Float32Array(n);
    this.T = new Float32Array(n); this.amp = new Float32Array(n);
    this.ang = new Float32Array(n);
    this.count = 0;

    const e = CONFIG.maxEjecta;
    this.ex = new Float32Array(e); this.ey = new Float32Array(e);
    this.evx = new Float32Array(e); this.evy = new Float32Array(e);
    this.et = new Float32Array(e); this.elife = new Float32Array(e);
    this.eT = new Float32Array(e); this.ecount = 0;
  }

  spawn(type, x, y, r0, r1, life, T, amp, ang) {
    let i = this.count;
    if (i >= CONFIG.maxEffects) {
      // Replace the oldest rather than dropping the newest. The most recent
      // event is always the one the player is looking for.
      let best = 0, bestAge = -1;
      for (let k = 0; k < CONFIG.maxEffects; k++) {
        const age = this.t[k] / Math.max(this.life[k], 1e-3);
        if (age > bestAge) { bestAge = age; best = k; }
      }
      i = best;
    } else this.count++;
    this.type[i] = type; this.x[i] = x; this.y[i] = y;
    this.r0[i] = r0; this.r1[i] = r1; this.t[i] = 0; this.life[i] = life;
    this.T[i] = T; this.amp[i] = amp; this.ang[i] = ang || 0;
    return i;
  }

  ejecta(x, y, n, speed, T) {
    for (let i = 0; i < n; i++) {
      if (this.ecount >= CONFIG.maxEjecta) return;
      const k = this.ecount++;
      const a = TAU * (i / n) + hash3(i, k, 331) * 0.9;
      const s = speed * (0.35 + hash3(i, k, 977) * 1.15);
      this.ex[k] = x; this.ey[k] = y;
      this.evx[k] = Math.cos(a) * s; this.evy[k] = Math.sin(a) * s;
      this.et[k] = 0; this.elife[k] = 0.5 + hash3(i, k, 55) * 1.1;
      this.eT[k] = T;
    }
  }

  step(dt, panDx, panDy, zoomRatio, cx, cy) {
    // Effects live in SCREEN space, and are carried by camera motion rather
    // than re-projected. This is the right call: a shockwave is a visual event
    // whose job is done in under two seconds, and keeping it in screen space
    // means it costs nothing and cannot produce a degenerate transform when the
    // camera crosses a scale boundary mid-flight.
    for (let i = 0; i < this.count; i++) {
      this.t[i] += dt;
      this.x[i] = (this.x[i] - cx) * zoomRatio + cx + panDx;
      this.y[i] = (this.y[i] - cy) * zoomRatio + cy + panDy;
      this.r0[i] *= zoomRatio; this.r1[i] *= zoomRatio;
      if (this.t[i] >= this.life[i]) {
        const last = --this.count;
        if (i !== last) {
          this.type[i] = this.type[last]; this.x[i] = this.x[last]; this.y[i] = this.y[last];
          this.r0[i] = this.r0[last]; this.r1[i] = this.r1[last]; this.t[i] = this.t[last];
          this.life[i] = this.life[last]; this.T[i] = this.T[last]; this.amp[i] = this.amp[last];
          this.ang[i] = this.ang[last];
        }
        i--;
      }
    }
    for (let i = 0; i < this.ecount; i++) {
      this.et[i] += dt;
      this.ex[i] = (this.ex[i] - cx) * zoomRatio + cx + panDx + this.evx[i] * dt;
      this.ey[i] = (this.ey[i] - cy) * zoomRatio + cy + panDy + this.evy[i] * dt;
      this.evx[i] *= Math.exp(-dt * 1.5); this.evy[i] *= Math.exp(-dt * 1.5);
      if (this.et[i] >= this.elife[i]) {
        const last = --this.ecount;
        if (i !== last) {
          this.ex[i] = this.ex[last]; this.ey[i] = this.ey[last];
          this.evx[i] = this.evx[last]; this.evy[i] = this.evy[last];
          this.et[i] = this.et[last]; this.elife[i] = this.elife[last]; this.eT[i] = this.eT[last];
        }
        i--;
      }
    }
  }

  draw(ctx, exposure, motion) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (let i = 0; i < this.count; i++) {
      const u = sat(this.t[i] / this.life[i]);
      const T = this.T[i];
      switch (this.type[i]) {
        case FX_FLASH: {
          // A merge releases binding energy. The flash is hot and very short,
          // falling as an inverse square in time because that is roughly what a
          // cooling optically thin fireball does and because it keeps the peak
          // from lingering into cartoon territory.
          const a = this.amp[i] * Math.pow(1 - u, 2.2) * motion;
          if (a < 0.004) break;
          const r = lerp(this.r0[i], this.r1[i], Math.pow(u, 0.42));
          const s = this.atlas.stamp(PROF_HALO, T);
          ctx.globalAlpha = sat(a);
          ctx.drawImage(s, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
          const c = this.atlas.stamp(PROF_CORE, Math.max(T, 9000));
          const rc = r * 0.30;
          ctx.globalAlpha = sat(a * 1.25);
          ctx.drawImage(c, this.x[i] - rc, this.y[i] - rc, rc * 2, rc * 2);
          break;
        }
        case FX_RING: {
          // sqrt(t) growth: a real blast front decelerates, and a ring that
          // expands linearly reads as a UI pulse instead of as physics.
          const r = lerp(this.r0[i], this.r1[i], Math.sqrt(u));
          const a = this.amp[i] * Math.pow(1 - u, 1.9) * motion
            * Math.pow(this.r0[i] / Math.max(r, 1), 0.30);
          if (a < 0.004 || r < 1) break;
          strokeFront(ctx, this.x[i], this.y[i], r, a, motion);
          break;
        }
        case FX_IMPLODE: {
          // The inverse gesture. A ring that CONTRACTS, accelerating, is read
          // instantly as collapse and it is the clearest possible statement
          // that something is falling in rather than blowing out.
          const r = lerp(this.r0[i], this.r1[i], u * u * u);
          const a = this.amp[i] * (0.30 + u * 0.90) * motion;
          if (r < 0.8) break;
          strokeFront(ctx, this.x[i], this.y[i], r, a, motion);
          break;
        }
        case FX_CONDENSE: {
          // The birth gesture, and the most important animation in the game:
          // the first dot does not appear, it CONDENSES out of the field. Field
          // grain within a radius rushes inward and coalesces. It states the
          // whole premise in three hundred and fifty milliseconds without a
          // word of text, and it is what makes one dot on a black screen
          // legible, because it arrived with motion.
          const n = 22;
          const e = 1 - Math.pow(1 - u, 2.4);
          for (let q = 0; q < n; q++) {
            const a0 = TAU * hash3(q, i, 4441);
            const rr = lerp(this.r1[i], this.r0[i], e) * (0.45 + hash3(q, i, 991) * 0.75);
            const sx = this.x[i] + Math.cos(a0 + e * 1.5) * rr;
            const sy = this.y[i] + Math.sin(a0 + e * 1.5) * rr;
            ctx.globalAlpha = sat((0.16 + hash3(q, i, 77) * 0.5) * (1 - u * u) * motion);
            ctx.fillStyle = '#bcd0e8';
            ctx.fillRect(sx, sy, 1.4, 1.4);
          }
          const a = Math.pow(u, 2.5) * 0.85 * motion;
          const r = lerp(this.r1[i] * 0.5, this.r0[i], e);
          const s = this.atlas.stamp(PROF_HALO, T);
          ctx.globalAlpha = sat(a);
          ctx.drawImage(s, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
          break;
        }
        case FX_EDGE: {
          // The replacement for a sound cue. Something happened off screen; an
          // arc lights on the edge in its direction. Without this, an event
          // outside the viewport is silent in every available sense.
          const a = this.amp[i] * Math.pow(1 - u, 1.5) * 0.8 * motion;
          if (a < 0.005) break;
          ctx.globalAlpha = sat(a);
          ctx.strokeStyle = blackbody(T, 1);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(this.x[i], this.y[i], this.r0[i], this.ang[i] - 0.34, this.ang[i] + 0.34);
          ctx.stroke();
          break;
        }
      }
    }
    // Ejecta. Streaked along velocity, because a moving spark drawn as a round
    // dot reads as a bubble and a streaked one reads as debris.
    for (let i = 0; i < this.ecount; i++) {
      const u = sat(this.et[i] / this.elife[i]);
      const a = Math.pow(1 - u, 1.8) * 0.85 * motion;
      if (a < 0.01) continue;
      const vx = this.evx[i], vy = this.evy[i];
      const sp = Math.sqrt(vx * vx + vy * vy);
      const len = clamp(sp * 0.012, 1, 9);
      ctx.globalAlpha = sat(a);
      ctx.strokeStyle = blackbody(lerp(this.eT[i], 1400, u), 1);
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(this.ex[i], this.ey[i]);
      ctx.lineTo(this.ex[i] - (vx / (sp || 1)) * len, this.ey[i] - (vy / (sp || 1)) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// =============================================================================
// BLACK HOLES - what an absence looks like when everything else is a dot.
// =============================================================================
//
// The defining constraint of this whole project is that every object on screen
// is made of light. A black hole is the one thing that is made of the removal
// of light, so it is the one thing that can be rendered by SUBTRACTION and be
// unmistakable at a glance. Four elements, in order of how much they matter:
//
//   1. THE SHADOW is punched out of the composited scene with destination-out,
//      after the vacuum field has been drawn and before the light layer is
//      added. So it removes the background too: a perfectly black disc with a
//      hard edge, which on a nearly black screen is invisible on its own. That
//      is exactly right, because what you actually see is the hole's effect on
//      everything around it.
//   2. THE PHOTON RING, drawn in twenty segments with per-segment Doppler
//      weighting so the approaching limb is several times brighter. It is the
//      brightest and thinnest thing on the entire screen at any scale, which is
//      what makes a black hole findable in a field of a million stars.
//   3. LENSING. Bodies within fifteen shadow radii are displaced outward along
//      the standard thin-lens mapping and stretched tangentially, and each
//      bright one gets a faint SECONDARY IMAGE on the opposite side. That
//      second image is the tell. Once the player notices that every bright
//      thing near the hole has a ghost twin arcing round the far side, the
//      object is understood without one word of explanation.
//   4. THE DISC: Keplerian tracers with T proportional to r^-3/4 and relativistic
//      beaming on the approaching side, plus a two-armed spiral density
//      modulation so it has structure rather than being a smooth annulus.
//
// No jets. The world is a plane seen face on, so a real jet would point at the
// camera and read as a smear. High spin instead produces frame-dragging shear:
// faint co-rotating spiral wisps just outside the ring.

class BlackHoles {
  constructor(atlas) {
    this.atlas = atlas;
    this.list = [];   // { sx, sy, rs, spin, seed, T }
  }

  clear() { this.list.length = 0; }

  /**
   * Keeps the LARGEST holes when more are on screen than the budget allows.
   * First-come would be wrong: a two pixel hole gets a single stamp anyway, so
   * spending the budget on it and dropping a screen-filling one is exactly
   * backwards. The list is tiny, so a linear scan for the smallest is cheaper
   * than maintaining any structure.
   */
  add(sx, sy, rs, spin, seed, T, cap) {
    if (this.list.length < cap) { this.list.push({ sx, sy, rs, spin, seed, T }); return; }
    let worst = -1, worstR = rs;
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].rs < worstR) { worstR = this.list[i].rs; worst = i; }
    }
    if (worst >= 0) {
      const h = this.list[worst];
      h.sx = sx; h.sy = sy; h.rs = rs; h.spin = spin; h.seed = seed; h.T = T;
    }
  }

  /**
   * The thin-lens deflection, applied in screen space. Returns the displaced
   * radius for a source at true angular radius b, plus the secondary image
   * radius (negative, meaning the far side).
   */
  static lensMap(b, te) {
    const s = Math.sqrt(b * b + 4 * te * te);
    return { primary: 0.5 * (b + s), secondary: 0.5 * (b - s) };
  }

  /**
   * Applied by the body pass. Given a screen position, returns the lensed
   * position plus a tangential stretch factor, or null if unaffected.
   */
  lens(sx, sy, out) {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      const dx = sx - h.sx, dy = sy - h.sy;
      const b = Math.sqrt(dx * dx + dy * dy);
      const reach = h.rs * CONFIG.lensRadiusMul;
      if (b > reach || b < 1e-4) continue;
      const te = h.rs * CONFIG.einsteinMul;
      const m = BlackHoles.lensMap(b, te);
      const ux = dx / b, uy = dy / b;
      out.x = h.sx + ux * m.primary;
      out.y = h.sy + uy * m.primary;
      out.sx2 = h.sx + ux * m.secondary;
      out.sy2 = h.sy + uy * m.secondary;
      // Tangential magnification of the primary image. Diverges at the Einstein
      // radius, which is precisely the arc the eye is looking for, so it is
      // capped rather than removed.
      out.stretch = clamp(m.primary / Math.max(b, 1e-3), 1, 4.5);
      out.mag2 = clamp((te * te) / (b * b), 0, 0.55);
      // For a distant source the secondary image falls inward and would land
      // inside the shadow, where by definition nothing can be seen. Suppress it
      // there rather than drawing a dot inside a black disc.
      if (Math.abs(m.secondary) < h.rs * 1.06) out.mag2 = 0;
      out.ang = Math.atan2(uy, ux);
      out.hit = true;
      return out;
    }
    out.hit = false;
    return out;
  }

  /** Punched into the main canvas after the field, before the light layer. */
  punchShadows(ctx) {
    if (!this.list.length) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      ctx.beginPath();
      ctx.arc(h.sx, h.sy, h.rs, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // The shadow removed the background too, so paint true black back in. This
    // is the only place in the entire renderer that draws pure #000, and that
    // is the whole point: on a screen where nothing is ever fully black, a
    // black hole is the one region that is.
    ctx.fillStyle = '#000';
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      ctx.beginPath();
      ctx.arc(h.sx, h.sy, h.rs, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * Re-blacken the shadow interiors after bloom. Called on the main canvas at
   * the very end of compositing. Falls to zero before it reaches the photon
   * ring, so the ring and its inner glow survive untouched.
   */
  sealShadows(ctx) {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (h.rs < 2) continue;
      const g = ctx.createRadialGradient(h.sx, h.sy, 0, h.sx, h.sy, h.rs * 0.98);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.80, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(h.sx, h.sy, h.rs * 0.98, 0, TAU);
      ctx.fill();
    }
  }

  /** Ring, disc, and shear. Drawn into the light layer with additive blending. */
  drawLight(ctx, t, exposure, gain) {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      const R = h.rs;
      if (R < 0.8) {
        // Too small to resolve. A sub-pixel black hole still has to be
        // findable, so it collapses to a single hard blue-white point with a
        // tight halo: brighter than any star of the same size, which is how you
        // spot one in a crowd.
        const s = this.atlas.stamp(PROF_CORE, 22000);
        const r = 2.4;
        ctx.globalAlpha = sat(0.9 * gain);
        ctx.drawImage(s, h.sx - r, h.sy - r, r * 2, r * 2);
        continue;
      }
      this.drawDisc(ctx, h, t, exposure, gain);
      this.drawRing(ctx, h, gain, exposure);
      if (Math.abs(h.spin) > 0.35 && R > 14) this.drawShear(ctx, h, t, gain);
    }
  }

  drawDisc(ctx, h, t, exposure, gain) {
    const R = h.rs;
    if (R < 3) return;
    const inner = R * CONFIG.discInnerMul;
    const outer = R * CONFIG.discOuterMul;
    // Tracer budget scales with the hole's screen size: a distant hole gets a
    // handful, a screen-filling one gets the full allotment. Cost tracks pixels
    // rather than importance, which is the rule everywhere in this file.
    const n = clamp(Math.round(CONFIG.discTracers * sat(R / 90)), 24, CONFIG.discTracers);
    const sgn = h.spin >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const u = hash3(i, h.seed, 313);
      // r^(1/2) sampling gives uniform area coverage; the extra bias packs the
      // inner disc where the light actually is.
      const rr = inner + (outer - inner) * Math.pow(u, 0.62);
      const omega = sgn * 2.6 * Math.pow(rr / inner, -1.5);
      const ang = TAU * hash3(i, h.seed, 787) + t * omega;
      const px = h.sx + Math.cos(ang) * rr;
      const py = h.sy + Math.sin(ang) * rr;
      // Shakura-Sunyaev temperature profile.
      const T = 34000 * Math.pow(rr / inner, -0.75);
      // Two-armed spiral density wave. Without it the disc is a smooth ring,
      // which reads as a drawn circle instead of as orbiting matter.
      const spiral = 0.55 + 0.45 * Math.cos(2 * (ang - 2.2 * Math.log(rr / inner)));
      // Relativistic beaming. The approaching limb is genuinely several times
      // brighter and it is the single detail that makes a face-on disc look
      // like a photograph rather than a diagram.
      const beta = 0.42 * Math.pow(rr / inner, -0.5);
      const cosang = Math.sin(ang) * sgn;
      const boost = Math.pow(1 + beta * cosang, 3);
      const a = sat(0.055 * spiral * boost * gain * (0.4 + u * 0.9));
      if (a < 0.006) continue;
      const s = this.atlas.stamp(PROF_HALO, T);
      const sz = clamp(R * 0.11, 1.4, 26);
      ctx.globalAlpha = a;
      ctx.drawImage(s, px - sz, py - sz, sz * 2, sz * 2);
    }
  }

  drawRing(ctx, h, gain, exposure) {
    const R = h.rs;
    const rp = R * 1.045;
    const sgn = h.spin >= 0 ? 1 : -1;
    // Segment count and pass count both track screen size. The Doppler
    // asymmetry is the reason for segmenting at all, and it is not resolvable
    // on a ten pixel ring, so a small hole gets a plain bright circle for a
    // twentieth of the cost. Measured: this and the hole cap together took a
    // pathological twenty four hole scene from 23ms to inside budget.
    const segs = clamp(Math.round(R * 0.5), 4, 20);
    const passes = R > 18 ? 3 : R > 7 ? 2 : 1;
    const lw = clamp(R * 0.055, 1.0, 7);
    ctx.lineCap = 'butt';
    // Up to three passes: a wide dim bloom seat, a mid, and the hairline. This
    // gets a genuine specular feel out of three strokes and no filters.
    for (let pass = 3 - passes; pass < 3; pass++) {
      const wm = [5.5, 2.2, 1][pass];
      const am = [0.10, 0.26, 1][pass];
      ctx.lineWidth = lw * wm;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * TAU, a1 = ((s + 1) / segs) * TAU;
        const mid = (a0 + a1) * 0.5;
        const beta = 0.62;
        const boost = Math.pow(1 + beta * Math.sin(mid) * sgn, 3) / Math.pow(1 + beta, 3);
        const a = sat((0.22 + 0.95 * boost) * am * gain);
        if (a < 0.006) continue;
        ctx.globalAlpha = a;
        // Beamed light, not thermal light: near white with a hair of blue.
        ctx.strokeStyle = 'rgba(228,240,255,1)';
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, rp, a0, a1 + 0.004);
        ctx.stroke();
      }
    }
  }

  /** Frame dragging, as faint co-rotating wisps just outside the ring. */
  drawShear(ctx, h, t, gain) {
    const sgn = h.spin >= 0 ? 1 : -1;
    const n = 5;
    ctx.lineWidth = 1.1;
    for (let i = 0; i < n; i++) {
      const r0 = h.rs * (1.16 + i * 0.19 + hash3(i, h.seed, 61) * 0.10);
      const ph = TAU * hash3(i, h.seed, 4409) + t * sgn * (1.4 / (1 + i));
      ctx.globalAlpha = sat(0.065 * Math.abs(h.spin) * gain);
      ctx.strokeStyle = 'rgba(190,214,244,1)';
      ctx.beginPath();
      ctx.arc(h.sx, h.sy, r0, ph, ph + 1.1 * sgn, sgn < 0);
      ctx.stroke();
    }
  }
}

// =============================================================================
// TRANSITION - the payoff. Your entire universe becomes one dot.
// =============================================================================
//
// When the run crosses into a new order of magnitude, the camera pulls back and
// everything that came before shrinks toward a point. The problem with just
// letting the camera do it is that at these ratios the old world is sub-pixel
// within a few hundred milliseconds, so the moment happens too fast to be felt.
//
// The fix uses the framebuffer as the only asset in the game: at the instant of
// the transition, the composited frame is copied into an offscreen canvas. For
// the next 1.75 seconds that snapshot is drawn on top of the live scene,
// shrinking toward the point where the old world now lives and fading out. The
// live scene is already pulling back underneath it, so the two motions agree
// and what the player sees is a continuous, legible collapse of everything they
// built into a single point of light. It costs one full-canvas blit, once, per
// stratum, and it is the single most important 40 lines in this file.

class Transition {
  constructor() {
    this.snap = document.createElement('canvas');
    this.sctx = this.snap.getContext('2d');
    this.t = 0; this.active = false;
    this.ax = 0.5; this.ay = 0.5;
    this.label = '';
    this.labelT = 0;
  }

  begin(mainCanvas, ax, ay, label) {
    if (mainCanvas.width < 2) return;
    this.snap.width = mainCanvas.width;
    this.snap.height = mainCanvas.height;
    const sw = this.snap.width, sh = this.snap.height;
    this.sctx.setTransform(1, 0, 0, 1, 0, 0);
    this.sctx.globalCompositeOperation = 'source-over';
    this.sctx.clearRect(0, 0, sw, sh);
    this.sctx.drawImage(mainCanvas, 0, 0);
    // FEATHER THE SNAPSHOT, once, here. The frame is a rectangle and the scene
    // it captured is not: composited additively at reduced scale, its near
    // black background adds a few units of luminance over the live scene and
    // the result is a clearly visible glowing rectangle sliding inward, which
    // is the one thing that would give away that this is a screen grab rather
    // than the world receding. A radial alpha punch takes the corners and the
    // edges to nothing, which also removes the instrumentation from the
    // snapshot so the magnitude column does not shrink along with the universe.
    const cx = sw * 0.5, cy = sh * 0.5;
    const m = Math.min(sw, sh);
    const fade = this.sctx.createRadialGradient(cx, cy, m * 0.26, cx, cy, m * 0.60);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.72, 'rgba(0,0,0,0.72)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    this.sctx.globalCompositeOperation = 'destination-out';
    this.sctx.fillStyle = fade;
    this.sctx.fillRect(0, 0, sw, sh);
    this.sctx.globalCompositeOperation = 'source-over';
    this.t = 0; this.active = true;
    this.ax = ax; this.ay = ay;
    if (label) { this.label = label; this.labelT = 0; }
  }

  step(dt) {
    if (this.active) {
      this.t += dt * 1000;
      if (this.t >= CONFIG.dissolveMs) this.active = false;
    }
    if (this.label) {
      this.labelT += dt;
      if (this.labelT > 6.5) this.label = '';
    }
  }

  draw(ctx, w, h, motion) {
    if (!this.active) return;
    const u = sat(this.t / CONFIG.dissolveMs);
    // Ease so most of the shrink happens in the first third: the eye needs to
    // see it become small, then needs a beat to register that it is gone.
    const e = 1 - Math.pow(1 - u, 3.1);
    const s = lerp(1, 0.004, e);
    const a = Math.pow(1 - u, 1.35) * motion;
    if (a < 0.004) return;
    const cx = this.ax * w, cy = this.ay * h;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = sat(a);
    // A touch of blur as it shrinks, which reads as the whole structure losing
    // resolution rather than merely getting small. Skipped if unsupported.
    try { ctx.filter = `blur(${(e * 2.2).toFixed(2)}px)`; } catch (_) { /* fine */ }
    ctx.drawImage(this.snap, cx - (cx) * s, cy - (cy) * s, w * s, h * s);
    ctx.restore();
  }
}

// =============================================================================
// HUD - the magnitude column, and nothing else that can be avoided.
// =============================================================================
//
// The brief said a legend would be the wrong answer, and it is: a legend is a
// thing you read. What is wanted is a thing you FEEL, and the reference point
// is The Deep Sea, where a depth number sliding past a vertical axis is the
// entire atmosphere and the entire information design at once. This is that,
// rotated into scale.
//
// A ladder of decade ticks runs up the right edge. Zooming out slides the
// ladder down, continuously, at a rate exactly proportional to how fast you are
// crossing magnitudes. A bracket marks the span currently on screen, which
// silently answers "how much am I looking at" without a sentence. Stratum names
// are inscribed beside their bands in letterspaced small caps, so crossing from
// planetesimal into planet is something you watch happen to the ruler rather
// than something you are told.
//
// The column idles at 26% opacity and rises to 72% whenever the scale changes,
// then falls back over half a second. Instrumentation that is only present when
// it is relevant.

class Hud {
  constructor() { this.caption = ''; this.captionAlpha = 0; }

  /**
   * Layout, right edge inward:
   *
   *     [ decade numbers ]  | axis |  [ stratum names ]
   *
   * The axis sits CONFIG.columnWidthPx in from the right so the stratum names,
   * which are the long items, have room to the right of it without ever
   * clipping. Decade numbers hang off the left of the axis, right aligned to
   * it, so the two columns can never collide no matter how long a stratum name
   * gets. Ticks read left off the axis and the on-screen span bracket rides the
   * axis itself.
   */
  draw(ctx, cam, w, h, dpr, exposure, world) {
    const alpha = lerp(CONFIG.hudActiveAlpha, CONFIG.hudIdleAlpha, sat(cam.settled));
    const axisX = Math.round(w - CONFIG.columnWidthPx);
    const midY = h * 0.5;
    // The ladder is drawn against log10(meters per pixel), so zooming out
    // slides it downward. That direction is deliberate: growing outward should
    // feel like rising, and the numbers should stream down past you.
    const centerLog = -cam.logPPM;
    const dp = CONFIG.decadePx;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // The axis, faded at both ends so it reads as an instrument that continues
    // past the screen rather than as a border.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(${HUD_RGB},0)`);
    g.addColorStop(0.16, `rgba(${HUD_RGB},${(alpha * 0.32).toFixed(3)})`);
    g.addColorStop(0.84, `rgba(${HUD_RGB},${(alpha * 0.32).toFixed(3)})`);
    g.addColorStop(1, `rgba(${HUD_RGB},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(axisX, 0, 1, h);

    const lo = Math.floor(centerLog - (midY + 60) / dp);
    const hi = Math.ceil(centerLog + (h - midY + 60) / dp);
    for (let e = lo; e <= hi; e++) {
      const y = Math.round(midY + (e - centerLog) * dp) + 0.5;
      if (y < -20 || y > h + 20) continue;
      const edgeFade = smoothstep(0, 90, y) * smoothstep(0, 90, h - y);
      const major = (e % 3 === 0);
      const a = alpha * edgeFade * (major ? 0.9 : 0.34);
      if (a < 0.01) continue;
      ctx.fillStyle = `rgba(${HUD_RGB},${a.toFixed(3)})`;
      const len = major ? 11 : 5;
      ctx.fillRect(axisX - len, y, len, 1);
      if (major) drawDecadeLabel(ctx, e, axisX - 16, y, `rgba(${HUD_RGB},${(a * 0.92).toFixed(3)})`);
    }

    // The bracket: the span of magnitudes actually on screen right now, from
    // one pixel at the top to the full viewport at the bottom. This is the
    // answer to "how much am I looking at", given as geometry rather than as a
    // sentence, and it is why the column needs no legend.
    const spanDec = Math.log10(Math.max(w, h));
    const y0 = Math.round(midY) + 0.5;
    const y1 = Math.round(midY + spanDec * dp) + 0.5;
    ctx.fillStyle = `rgba(${HUD_RGB},${(alpha * 0.18).toFixed(3)})`;
    ctx.fillRect(axisX - 1, y0, 3, Math.max(y1 - y0, 2));
    ctx.fillStyle = `rgba(${HUD_RGB},${(alpha * 0.95).toFixed(3)})`;
    ctx.fillRect(axisX - 4, y0 - 1, 9, 2);
    ctx.fillStyle = `rgba(${HUD_RGB},${(alpha * 0.45).toFixed(3)})`;
    ctx.fillRect(axisX - 3, y1 - 1, 7, 2);

    // Stratum inscriptions, to the right of the axis, beside their own bands.
    // Letterspaced uppercase at nine pixels reads as engraving rather than as
    // a game font, and it is the only typographic gesture in the interface.
    ctx.font = `400 9px ${CONFIG.hudFace}`;
    for (let i = 0; i < STRATA.length; i++) {
      const e = STRATA[i][0];
      const y = midY + (e - centerLog) * dp;
      if (y < -10 || y > h + 10) continue;
      const near = 1 - sat(Math.abs(y - midY) / (h * 0.62));
      const a = alpha * near * near * 0.95;
      if (a < 0.02) continue;
      ctx.fillStyle = `rgba(${HUD_RGB},${(a * 0.55).toFixed(3)})`;
      ctx.fillRect(axisX + 2, Math.round(y) + 0.5, 5, 1);
      drawTracked(ctx, STRATA[i][1].toUpperCase(), axisX + 13, y,
        `rgba(${HUD_RGB},${a.toFixed(3)})`, 2.3);
    }

    // The current stratum, stated once, top left. The only emphasised word in
    // the whole interface, and it changes maybe thirty times in an entire run.
    const curStratum = Scale.stratum(centerLog + Math.log10(Math.max(w, h)) - 0.5);
    const introA = lerp(0.68, 0.32, sat(cam.settled));
    ctx.font = `300 13px ${CONFIG.hudFace}`;
    drawTracked(ctx, curStratum.toUpperCase(), 30, 34,
      `rgba(${HUD_RGB},${introA.toFixed(3)})`, 5.2);
    ctx.font = `500 10px ${CONFIG.hudFont}`;
    ctx.fillStyle = `rgba(${HUD_RGB},${(introA * 0.5).toFixed(3)})`;
    ctx.fillText(Scale.length(Math.max(w, h) / Math.pow(10, cam.logPPM)) + ' across', 30, 53);

    // A caption slot the host owns. The renderer refuses to invent words for
    // things it does not model; progression decides what, if anything, to say.
    if (this.caption && this.captionAlpha > 0.01) {
      ctx.font = `300 12px ${CONFIG.hudFace}`;
      drawTracked(ctx, this.caption, 30, h - 34,
        `rgba(${HUD_RGB},${(this.captionAlpha * 0.66).toFixed(3)})`, 1.6);
    }

    ctx.restore();
  }
}

/**
 * "10" with a raised, smaller exponent. Real typographic superscript rather
 * than the Unicode superscript block, which has no minus sign in most system
 * monospace faces and would silently render a decade label as a box.
 */
function drawDecadeLabel(ctx, e, rightX, y, fill) {
  ctx.fillStyle = fill;
  ctx.textAlign = 'left';
  ctx.font = `500 10px ${CONFIG.hudFont}`;
  const wm = ctx.measureText('10').width;
  ctx.font = `500 7.5px ${CONFIG.hudFont}`;
  const we = ctx.measureText(String(e)).width;
  const x = rightX - (wm + 0.8 + we);
  ctx.fillText(String(e), x + wm + 0.8, y - 4.2);
  ctx.font = `500 10px ${CONFIG.hudFont}`;
  ctx.fillText('10', x, y);
}

/**
 * Letterspaced text, drawn per glyph. ctx.letterSpacing exists but is not
 * universally supported and cannot be animated per character; this is a dozen
 * fillText calls on a handful of labels and costs nothing measurable.
 * It always advances left to right, so a caller wanting right alignment must
 * measure with trackedWidth and offset. ctx.textAlign is ignored.
 */
function drawTracked(ctx, text, x, y, fill, track) {
  ctx.fillStyle = fill;
  ctx.textAlign = 'left';
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
}

function trackedWidth(ctx, text, track) {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + track;
  return w - track;
}

// =============================================================================
// THE RENDERER
// =============================================================================

/**
 * How much a broad bright region is amplified by the bloom composite at each
 * quality tier. Used to convert an exposure target on the final image into a
 * target on the light layer, which is what the meter can actually see.
 */
const BLOOM_GAIN = [1.95, 1.55, 1.0, 1.0];

/**
 * Per tier ceilings on the two costs that actually scale. Measured, not
 * guessed: on a software rasteriser a discrete body runs about 3 microseconds
 * and an aggregate about 40, so these are the counts that fit the budget with
 * the rest of the pipeline in it. Hardware compositing is several times faster
 * and simply leaves the caps unreached.
 */
const MAX_DISCS = [3200, 2200, 1400, 800];
const MAX_AGGS = [420, 300, 180, 110];
/**
 * Black holes given the full treatment at once. Low on purpose: the ring, the
 * disc and the lensing are the most expensive per-object work in the file, and
 * a scene with more than a handful of resolvable holes in view is either a very
 * late game state or a bug. Holes beyond the cap still exist, they are just
 * drawn by the discrete register like anything else.
 */
const MAX_HOLES = [10, 8, 5, 3];

/**
 * Screen radius below which an aggregate takes the single-stamp path. Above it,
 * the full profile plus representatives. See drawAggregates.
 */
const AGG_SIMPLE_PX = 8;

const LENS_OUT = { hit: false, x: 0, y: 0, sx2: 0, sy2: 0, stretch: 1, mag2: 0, ang: 0 };

class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {function():object} [opts.world] called once per frame when the
   *        renderer owns the loop. Return the world snapshot.
   * @param {boolean} [opts.ownInput] whether the renderer binds pointer/wheel.
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.opts = opts;
    this.getWorld = opts.world || null;

    this.atlas = new Atlas();
    this.cam = new Camera();
    this.proj = new Projection();
    this.exposure = new Exposure();
    this.field = new VacuumField();
    this.fx = new Effects(this.atlas);
    this.holes = new BlackHoles(this.atlas);
    this.transition = new Transition();
    this.hud = new Hud();

    // Offscreen light buffer. All emissive drawing lands here so it can be
    // bloomed and so a black hole's shadow can be punched from the composited
    // background beneath it without eating the light in front of it.
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.bloomA = document.createElement('canvas');
    this.bctxA = this.bloomA.getContext('2d');
    this.bloomB = document.createElement('canvas');
    this.bctxB = this.bloomB.getContext('2d');

    this.w = 0; this.h = 0; this.dpr = 1; this.diag = 1000;
    this.pointer = { x: 0, y: 0, inside: false, warm: 0, down: false, lx: 0, ly: 0 };
    this.tier = 0;              // 0 best .. 3 worst
    this.overFrames = 0; this.underFrames = 0;
    this.bounces = 0; this.sinceTierChange = 0; this.lastChangeWasPromotion = false;
    this.frameMsEma = 8;
    this.last = 0; this.tSec = 0;
    this.running = false;
    this.rafId = 0;
    this.lastLogPPM = null;
    this.lastPanX = 0; this.lastPanY = 0;
    this.motion = 1;            // scaled down under prefers-reduced-motion
    this.inversion = null;
    this.stats_ = { fps: 0, ms: 0, discs: 0, aggregates: 0, tracers: 0, tier: 0, ev: 0 };
    this.renderedX = new Float32Array(CONFIG.maxDiscs);
    this.renderedY = new Float32Array(CONFIG.maxDiscs);
    this.renderedR = new Float32Array(CONFIG.maxDiscs);
    this.renderedI = new Int32Array(CONFIG.maxDiscs);
    this.renderedN = 0;
    this.lastBodies = null;
    this.tetherA = new Int32Array(CONFIG.tetherMaxLines);
    this.tetherB = new Int32Array(CONFIG.tetherMaxLines);
    this.tetherF = new Float32Array(CONFIG.tetherMaxLines);

    const rm = CONFIG.reducedMotion;
    this.reduced = rm === null
      ? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      : !!rm;
    this.motion = this.reduced ? 0.35 : 1;

    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    if (opts.ownInput !== undefined ? opts.ownInput : CONFIG.ownInput) this.bindInput();
  }

  // ---------------------------------------------------------------- lifecycle

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || this.canvas.width || 1));
    const cssH = Math.max(1, Math.round(rect.height || this.canvas.height || 1));
    const dprCap = [CONFIG.maxDpr, CONFIG.maxDpr, 1.25, 1][this.tier];
    const dpr = Math.min(devicePixelRatio || 1, dprCap);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    // Reallocating five canvases and regenerating the vacuum tile costs a whole
    // frame, and the quality governor would otherwise pay it on every tier
    // change even when the backing size is identical, which on any display at
    // ratio 1 it always is. That showed up as an 18ms spike in the p95 at
    // exactly the moment the governor was trying to REDUCE cost.
    if (w === this.w && h === this.h && this.light.width === w) { this.dpr = dpr; return; }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.light.width = this.w; this.light.height = this.h;
    const bs = 8, bs2 = 26;
    this.bloomA.width = Math.max(1, Math.round(this.w / bs));
    this.bloomA.height = Math.max(1, Math.round(this.h / bs));
    this.bloomB.width = Math.max(1, Math.round(this.w / bs2));
    this.bloomB.height = Math.max(1, Math.round(this.h / bs2));
    this.field.resize(this.w, this.h);
    this.exposure.resize(this.w, this.h);
    // Waves are capped against this so an expanding front leaves the screen
    // instead of growing into a full-field wash.
    this.diag = Math.hypot(this.w, this.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const world = this.getWorld ? this.getWorld() : null;
      this.renderFrame(world, now);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.rafId); }

  destroy() {
    this.stop();
    removeEventListener('resize', this._onResize);
    if (this._unbind) this._unbind();
  }

  // -------------------------------------------------------------------- input

  bindInput() {
    const c = this.canvas;
    const onMove = (e) => {
      const r = c.getBoundingClientRect();
      const nx = (e.clientX - r.left) * this.dpr;
      const ny = (e.clientY - r.top) * this.dpr;
      if (this.pointer.down) this.cam.panBy(nx - this.pointer.x, ny - this.pointer.y);
      this.pointer.x = nx; this.pointer.y = ny; this.pointer.inside = true;
    };
    const onLeave = () => { this.pointer.inside = false; this.pointer.down = false; };
    const onDown = (e) => { if (e.button === 1 || e.button === 2 || e.shiftKey) this.pointer.down = true; };
    const onUp = () => { this.pointer.down = false; };
    const onWheel = (e) => {
      e.preventDefault();
      const d = -Math.sign(e.deltaY) * CONFIG.zoomPerWheelNotch * (e.ctrlKey ? 3 : 1);
      this.cam.zoomAt(d, this.pointer.x, this.pointer.y, this.w / 2, this.h / 2);
    };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('pointerdown', onDown);
    addEventListener('pointerup', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this._unbind = () => {
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      c.removeEventListener('wheel', onWheel);
    };
  }

  // ------------------------------------------------------------------- events

  /** Push one visual event. Shapes are documented in THE WORLD CONTRACT. */
  emit(ev) {
    if (!ev) return;
    // An event in a frame the camera cannot currently resolve has no position
    // on screen. It still deserves an edge cue, so it is placed at the centre
    // and reported as off screen rather than dropped.
    const p = this.proj.of(ev.frame);
    const k = p ? p.k : 1;
    const sx = p ? p.ox + (ev.x || 0) * k : this.w / 2;
    const sy = p ? p.oy + (ev.y || 0) * k : this.h / 2;
    const onScreen = sx > -60 && sx < this.w + 60 && sy > -60 && sy < this.h + 60;

    switch (ev.type) {
      case 'birth': {
        const r = clamp((ev.r || 0) * k, 1.6, 90);
        this.fx.spawn(FX_CONDENSE, sx, sy, Math.max(r, 3), Math.max(r * 14, 130), 0.42,
          ev.T || 2600, 1, 0);
        break;
      }
      case 'merge': {
        const r = clamp((ev.r || 0) * k, 2, 260);
        const e = clamp(ev.energy === undefined ? 1 : ev.energy, 0.2, 4);
        this.fx.spawn(FX_FLASH, sx, sy, r * 1.4, r * 5.2, 0.34, ev.T || 9000, 0.95 * e, 0);
        this.fx.spawn(FX_RING, sx, sy, Math.max(r * 1.2, 4),
          Math.min(Math.max(r * 16, 90), this.diag * 0.75), 0.95, 0, 0.55 * e, 0);
        this.fx.ejecta(sx, sy, clamp(Math.round(10 * e), 6, 34), 60 + r * 5, ev.T || 6000);
        break;
      }
      case 'collapse': {
        const r0 = clamp((ev.r0 || 0) * k, 3, 400);
        const r1 = clamp((ev.r1 || 0) * k, 0.5, r0);
        this.fx.spawn(FX_IMPLODE, sx, sy, r0 * 1.6, r1, 0.55, 0, 0.9, 0);
        this.fx.spawn(FX_FLASH, sx, sy, r1 * 2, r0 * 3.4, 0.30, 30000, 1.25, 0);
        this.fx.spawn(FX_RING, sx, sy, r0,
          Math.min(Math.max(r0 * 22, 220), this.diag * 1.05), 1.5, 0, 0.7, 0);
        this.fx.ejecta(sx, sy, 28, 130 + r0 * 6, 14000);
        // Collapse also inverts the surrounding field for a beat. See
        // drawInversion: it is the loudest thing the renderer can say without
        // a sound, and it is reserved for the moment a thing stops being made
        // of matter.
        this.inversion = { x: sx, y: sy, r: Math.max(r0 * 8, 180), t: 0, life: 0.34 };
        break;
      }
      case 'shock':
        this.fx.spawn(FX_RING, sx, sy, clamp((ev.r || 1) * k, 2, 200),
          Math.min(Math.max((ev.r || 1) * k * 18, 160), this.diag), 1.2, 0, 0.6, 0);
        break;
      case 'stratum': {
        const ax = clamp(sx / Math.max(this.w, 1), 0.05, 0.95);
        const ay = clamp(sy / Math.max(this.h, 1), 0.05, 0.95);
        this.transition.begin(this.canvas, isFinite(ax) ? ax : 0.5, isFinite(ay) ? ay : 0.5, ev.name || '');
        this.cam.settled = 0;
        break;
      }
    }

    // Off-screen events get an edge arc. Without a sound channel this is the
    // only way a player can learn that something happened where they are not
    // looking, and it is deliberately the same colour as the event itself.
    if (!onScreen && ev.type !== 'stratum') {
      const cx = this.w / 2, cy = this.h / 2;
      const ang = Math.atan2(sy - cy, sx - cx);
      const rr = Math.min(this.w, this.h) * 0.47;
      this.fx.spawn(FX_EDGE, cx, cy, rr, rr, 0.85,
        ev.type === 'collapse' ? 22000 : 7000, 0.9, ang);
    }
  }

  setCaption(text) { this.hud.caption = text || ''; this.hud.captionAlpha = 1; }

  // -------------------------------------------------------------- public math

  /**
   * Screen pixels to world coordinates in the camera's anchor frame.
   * @returns {{x:number, y:number, frame:*, exp:number, metersPerUnit:number}}
   */
  screenToWorld(sx, sy) {
    const p = this.proj.rootProj;
    if (!p) return { x: 0, y: 0, frame: null, exp: 0, metersPerUnit: 1 };
    return {
      x: (sx * this.dpr - p.ox) / p.k,
      y: (sy * this.dpr - p.oy) / p.k,
      frame: p.frame.id,
      exp: p.exp,
      metersPerUnit: Math.pow(10, p.exp),
    };
  }

  /**
   * World coordinates in a frame to CSS pixels.
   * Returns null when that frame is not currently projected, which happens
   * whenever it lies outside the camera's scale window. Callers should treat
   * null as "not on screen at this scale" rather than as an error.
   */
  worldToScreen(x, y, frameId) {
    const p = this.proj.of(frameId);
    if (!p) return null;
    return { x: (p.ox + x * p.k) / this.dpr, y: (p.oy + y * p.k) / this.dpr };
  }

  /**
   * Nearest thing actually rendered at a screen point, within a tolerance.
   * Picking belongs to the renderer because only the renderer knows what ended
   * up visible and at what size after LOD and lensing.
   */
  pick(sx, sy, tolerancePx = 14) {
    const px = sx * this.dpr, py = sy * this.dpr;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.renderedN; i++) {
      const dx = this.renderedX[i] - px, dy = this.renderedY[i] - py;
      const d = Math.sqrt(dx * dx + dy * dy) - this.renderedR[i];
      if (d < bestD && d < tolerancePx * this.dpr) { bestD = d; best = i; }
    }
    if (best < 0 || !this.lastBodies) return null;
    return this.lastBodies[this.renderedI[best]] || null;
  }

  /**
   * What the camera can currently see. The simulation is expected to use this
   * to decide what it needs to keep resident at full fidelity: anything below
   * minResolvableMeters can be represented statistically with no visible loss,
   * which is the contract that lets object count and frame cost stay decoupled.
   */
  getViewport() {
    const mpp = Math.pow(10, -this.cam.logPPM);
    return {
      logPPM: this.cam.logPPM,
      metersPerPixel: mpp,
      widthMeters: this.w * mpp,
      heightMeters: this.h * mpp,
      minResolvableMeters: mpp * CONFIG.discPx,
      decadesVisible: Math.log10(Math.max(this.w, this.h)),
      stratum: Scale.stratum(Math.log10(Math.max(this.w, this.h) * mpp)),
      center: this.screenToWorld(this.w / (2 * this.dpr), this.h / (2 * this.dpr)),
    };
  }

  nudgeZoom(decades) { this.cam.zoomAt(decades, this.w / 2, this.h / 2, this.w / 2, this.h / 2); }
  recenter() { this.cam.resetOffsets(); }
  stats() { return this.stats_; }
  /** Pin a quality tier, or 'auto' to hand control back to the governor. */
  setQuality(tier) {
    this.tier = tier === 'auto' ? 0 : clamp(tier | 0, 0, 3);
    this.bounces = 0; this.overFrames = 0; this.underFrames = 0;
    this.sinceTierChange = 0; this.lastChangeWasPromotion = false;
    this.resize();
  }

  // ------------------------------------------------------------- the frame

  /**
   * Draw one frame. Call this directly if the host owns the animation loop;
   * otherwise start() calls it.
   * @param {object|null} world snapshot conforming to THE WORLD CONTRACT
   * @param {number} [nowMs] performance.now(), optional
   */
  renderFrame(world, nowMs) {
    const t0 = performance.now();
    const now = nowMs === undefined ? t0 : nowMs;
    let dt = (now - this.last) / 1000;
    this.last = now;
    // Clamp: a backgrounded tab returns with a multi-second delta and every
    // damper in the file would snap. Clamping is what makes returning to the
    // tab look like nothing happened rather than like a jump cut.
    dt = clamp(dt, 0.0005, 0.05);
    this.tSec += dt;

    const ctx = this.ctx;
    const w = this.w, h = this.h;
    if (w < 2 || h < 2) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // --- camera -----------------------------------------------------------
    const subject = this.subjectRadiusMeters(world);
    this.cam.aim(subject, Math.min(w, h));
    const prevPanX = this.cam.panOffX, prevPanY = this.cam.panOffY;
    const prevLog = this.cam.logPPM;
    this.cam.step(dt);
    const zoomRatio = Math.pow(10, this.cam.logPPM - prevLog);
    const dPanX = this.cam.panOffX - prevPanX;
    const dPanY = this.cam.panOffY - prevPanY;

    this.pointer.warm = damp(this.pointer.warm, this.pointer.inside ? 1 : 0, 0.30, dt);
    this.hud.captionAlpha = damp(this.hud.captionAlpha, this.hud.caption ? 1 : 0, 0.4, dt);

    // --- projection --------------------------------------------------------
    this.proj.build(world, this.cam, w / 2, h / 2);

    // --- drain events ------------------------------------------------------
    if (world && world.events && world.events.length) {
      const evs = world.events;
      for (let i = 0; i < evs.length; i++) this.emit(evs[i]);
      evs.length = 0;
    }

    this.fx.step(dt, dPanX, dPanY, zoomRatio, w / 2, h / 2);
    this.transition.step(dt);
    if (this.inversion) {
      this.inversion.t += dt;
      if (this.inversion.t >= this.inversion.life) this.inversion = null;
    }

    // --- 1. vacuum ---------------------------------------------------------
    this.field.draw(ctx, this.cam, w, h, dPanX, dPanY, this.exposure, this.pointer, dt);
    this.drawContext(ctx, world, w, h);

    // --- 2. light layer ----------------------------------------------------
    // The separate light layer is UNCONDITIONAL, at every quality tier.
    //
    // It was originally the third thing the governor shed, which left the
    // lowest tier drawing light straight onto the visible canvas and therefore
    // metering exposure from the visible canvas too. That is a pipeline stall:
    // sampling the canvas the compositor is presenting forces it to be resolved
    // and flushed, and it was measured at over eighty milliseconds in a frame,
    // five times worse than the entire budget it was supposed to be protecting.
    // The buffer costs one clear and one blit and it keeps every readback on an
    // offscreen surface, so it stays. The lowest tier now sheds device pixel
    // ratio, both bloom taps and the object caps, which is plenty.
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, w, h);

    this.holes.clear();
    if (world) this.collectHoles(world);
    // Punched into the background here, before ANY light lands. At the lowest
    // quality tier the light layer IS the main canvas, so punching after the
    // light pass would cut holes in the light instead of behind it.
    this.holes.punchShadows(ctx);

    L.globalCompositeOperation = 'lighter';
    const gain = this.exposure.gain;
    let nAgg = 0, nTracer = 0;
    if (world) {
      nAgg = this.drawAggregates(L, world, gain);
      nTracer = this.lastTracers | 0;
      this.drawBodies(L, world, gain);
      this.drawTethers(L, world, gain);
    }
    this.holes.drawLight(L, this.tSec, this.exposure, gain);
    this.fx.draw(L, this.exposure, this.motion);
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;

    // --- 3. composite ------------------------------------------------------
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.light, 0, 0);
    this.drawBloom(ctx, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // Always metered from the LIGHT layer, never from the visible canvas: the
    // vacuum field and the vignette must not drag the aperture around, and an
    // offscreen source is the only one that can be sampled without stalling
    // the compositor.
    this.exposure.measure(this.light);
    this.holes.sealShadows(ctx);

    // --- 4. transients over the composite ---------------------------------
    this.drawInversion(ctx, w, h);
    this.transition.draw(ctx, w, h, this.motion);
    this.drawVignette(ctx, w, h);

    // --- 5. instrumentation ------------------------------------------------
    this.hud.draw(ctx, this.cam, w, h, this.dpr, this.exposure, world);

    // --- 6. exposure and governor -----------------------------------------
    this.exposure.step(dt, BLOOM_GAIN[this.tier]);
    const ms = performance.now() - t0;
    this.frameMsEma = this.frameMsEma * 0.9 + ms * 0.1;
    this.governor();
    this.stats_.ms = this.frameMsEma;
    this.stats_.fps = 1000 / Math.max(this.frameMsEma, 0.01);
    this.stats_.discs = this.renderedN;
    this.stats_.aggregates = nAgg;
    this.stats_.tracers = nTracer;
    this.stats_.tier = this.tier;
    this.stats_.ev = this.exposure.ev;
  }

  /**
   * The quality governor. This is how 60fps is HELD rather than hoped for: a
   * smoothed frame time drives four tiers, each shedding the most expensive
   * thing left that costs the least perceptually. Hysteresis is asymmetric on
   * purpose. Twelve frames over budget is a fifth of a second of stutter, which
   * is worth reacting to; ninety frames under is a second and a half of proven
   * headroom, which is what it takes before it is safe to spend again.
   */
  /**
   * The quality governor, and specifically its ANTI-HUNTING rule.
   *
   * Asymmetric hysteresis alone is not enough. A scene sitting near a tier
   * boundary runs comfortably at the lower tier, waits out the recovery window,
   * gets promoted, immediately blows the budget, and is demoted again, forever.
   * Measured, that was a burst of over-budget frames every couple of seconds on
   * a scene whose median was perfectly healthy: the p50 hid it completely and
   * only the p95 showed it.
   *
   * The fix has to distinguish HUNTING from an honest demotion. Counting all
   * demotions and backing off on the total is the obvious version and it is
   * wrong, because one heavy moment early then permanently caps quality for the
   * rest of the session, including on an empty screen. So only a demotion that
   * arrives soon after a promotion counts as a bounce, and a long stable spell
   * clears the count. A borderline scene settles within two or three attempts;
   * a scene that genuinely got lighter recovers fully.
   */
  governor() {
    this.sinceTierChange++;
    if (this.sinceTierChange > 3600) this.bounces = 0;

    if (this.frameMsEma > CONFIG.budgetFrameMs) {
      this.overFrames++; this.underFrames = 0;
      if (this.overFrames > 12 && this.tier < 3) {
        if (this.lastChangeWasPromotion && this.sinceTierChange < 240) this.bounces++;
        this.tier++; this.overFrames = 0;
        this.sinceTierChange = 0; this.lastChangeWasPromotion = false;
        this.resize();
      }
    } else if (this.frameMsEma < CONFIG.comfortFrameMs) {
      this.underFrames++; this.overFrames = 0;
      const need = 90 * Math.pow(3, Math.min(this.bounces, 4));
      if (this.underFrames > need && this.tier > 0) {
        this.tier--; this.underFrames = 0;
        this.sinceTierChange = 0; this.lastChangeWasPromotion = true;
        this.resize();
      }
    }
  }

  /** The largest coherent extent in the world, in meters. Drives auto-framing. */
  subjectRadiusMeters(world) {
    if (!world) return 1;
    if (world.extent > 0) return world.extent;
    let best = 0;
    const rootExp = (typeof world.exp === 'number') ? world.exp : 0;
    const expOf = (frameId) => {
      const p = this.proj.map.get(frameId);
      return p ? p.exp : rootExp;
    };
    const ag = world.aggregates;
    if (ag) for (let i = 0; i < ag.length; i++) {
      const m = (ag[i].rms || 0) * 2.2 * Math.pow(10, expOf(ag[i].frame));
      if (m > best) best = m;
    }
    const bs = world.bodies;
    if (bs) {
      // Extent, not radius: the framing has to hold the arrangement, not the
      // largest object. Sampling is capped because this runs every frame.
      const n = Math.min(bs.length, 2048);
      let maxD = 0;
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        const s = Math.pow(10, expOf(b.frame));
        const d = (Math.hypot(b.x || 0, b.y || 0) + (b.r || 0) * 3) * s;
        if (d > maxD) maxD = d;
      }
      if (maxD > best) best = maxD;
    }
    return best > 0 ? best : 1;
  }

  // ------------------------------------------------------- statistical pass

  /**
   * The statistical register. A population that cannot be resolved is drawn as
   * the light it would produce, which is both cheaper and more honest than
   * drawing a million dots: from far enough away a galaxy IS a luminosity
   * profile. Three parts per aggregate:
   *
   *   - The profile itself: one anisotropic veil stamp, scaled by rms, squashed
   *     by ecc, rotated by angle. Plus a concentrated core stamp weighted by
   *     `core`, which is what separates a diffuse cloud from a cusped galaxy.
   *   - REPRESENTATIVES: a bounded, deterministic sample of individuals drawn
   *     as points, positioned from the aggregate's own seed and rotated by its
   *     spin. This is the thing that makes a galaxy read as being MADE OF a
   *     billion objects rather than as an airbrushed ellipse, and it costs a
   *     fixed budget shared across the whole screen no matter the population.
   *   - A DUST LANE for disc-like aggregates: a dark arc punched with
   *     destination-out at low alpha. Dust lanes are most of what makes a
   *     galaxy legible as a galaxy, and they are one stroke.
   */
  drawAggregates(L, world, gain) {
    const ag = world.aggregates;
    this.lastTracers = 0;
    if (!ag || !ag.length) return 0;
    const n = Math.min(ag.length, MAX_AGGS[this.tier]);
    const tracerBudget = [CONFIG.tracersMax, CONFIG.tracersMax * 0.6, CONFIG.tracersMax * 0.35, 0][this.tier];
    let tracersLeft = tracerBudget;
    let drawn = 0;
    const w = this.w, h = this.h;

    for (let i = 0; i < n; i++) {
      const a = ag[i];
      const p = this.proj.of(a.frame);
      if (!p) continue;
      const k = p.k;
      const sx = p.ox + (a.x || 0) * k;
      const sy = p.oy + (a.y || 0) * k;
      const R = (a.rms || 1) * k;
      if (!isFinite(sx) || !isFinite(sy) || !(R > 0)) continue;
      // Contextual promotion: an aggregate larger than the screen is no longer
      // an object, it is the room you are standing in. It hands off to
      // drawContext and stops being drawn as a body.
      if (R > Math.max(w, h) * 1.6) continue;
      const reach = R * 2.6;
      if (sx + reach < 0 || sx - reach > w || sy + reach < 0 || sy - reach > h) continue;

      drawn++;
      const T = a.T || 4200;
      if (R < AGG_SIMPLE_PX) {
        // Below sixteen pixels across, an aggregate has no discernible shape:
        // orientation, flattening, the nucleus and the lane are all invisible
        // at that size and none of them are worth a transform, three stamps and
        // a dozen representatives. One stamp, no save, no restore. In any wide
        // view this is almost every aggregate on screen, and it was measured as
        // the single largest saving available in the statistical register.
        const lum0 = a.lum !== undefined ? a.lum : Math.max(a.n || 1, 1);
        const sb = clamp(Math.log10(lum0 / Math.max(R * R, 1) + 1) * 0.085 * gain, 0.004, 0.9);
        const rr = Math.max(R * 2.0, 2.2);
        L.globalAlpha = sat(sb * 0.85);
        L.drawImage(this.atlas.stamp(PROF_HALO, T), sx - rr, sy - rr, rr * 2, rr * 2);
        continue;
      }
      const ecc = clamp(a.ecc || 0, 0, 0.92);
      const ang = a.angle || 0;
      const core = clamp(a.core === undefined ? 0.5 : a.core, 0, 1);
      const lum = a.lum !== undefined ? a.lum : Math.max(a.n || 1, 1);
      // SURFACE BRIGHTNESS, not total luminosity. What determines how bright a
      // pixel is, is light per unit SCREEN AREA, and the difference is the
      // whole ballgame across forty decades: total luminosity ignores zoom
      // entirely, so a galaxy drawn from it saturates to a white ellipse the
      // moment it fills any meaningful part of the screen. Dividing by screen
      // area means the same galaxy dims as you fly into it and concentrates to
      // a brilliant point as you pull away, which is both what really happens
      // and what keeps the exposure system from having to swallow a factor of
      // a million between one scale and the next.
      const area = Math.max(R * R, 1);
      const surface = clamp(Math.log10(lum / area + 1) * 0.085 * gain, 0.004, 0.80);

      // setTransform, NOT save/translate/rotate/scale/restore.
      //
      // This is the single most expensive lesson in the file. A save() around a
      // transformed draw while a non-default composite operation is active lets
      // the rasteriser decide it needs a temporary layer, and it allocates one
      // PER CALL. Measured, forty three aggregates drawn this way cost 70ms in
      // a single frame, about 1.6 milliseconds each for three small stamps.
      // Reducing the number of stamps would never have found it; only timing
      // the pass with the rasteriser forced to flush did.
      //
      // The matrix is translate(sx,sy) . rotate(ang) . scale(1, sq), composed
      // by hand: with R = [[ca,-sa],[sa,ca]] and S = [[1,0],[0,sq]], the
      // product R.S is [[ca, -sa*sq],[sa, ca*sq]], which in the (a,b,c,d,e,f)
      // order canvas expects is exactly the call below.
      const sq = 1 - ecc;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      L.setTransform(ca, sa, -sa * sq, ca * sq, sx, sy);

      // Three components, deliberately weighted so the smooth part is the
      // faint envelope and the STRUCTURE comes from the representatives below.
      // Loading the brightness into the smooth stamps is what produced a white
      // ellipse; the smooth part is only meant to be the light between the
      // objects, not the objects.
      const veil = this.atlas.stamp(PROF_VEIL, T);
      const rv = R * 2.4;
      L.globalAlpha = sat(surface * 0.17);
      L.drawImage(veil, -rv, -rv, rv * 2, rv * 2);
      const halo = this.atlas.stamp(PROF_HALO, T);
      const rh = R * (0.60 + (1 - core) * 0.85);
      L.globalAlpha = sat(surface * (0.20 + core * 0.42));
      L.drawImage(halo, -rh, -rh, rh * 2, rh * 2);
      if (core > 0.35 && R > 6) {
        // The nucleus is SMALL. A cusped galaxy is a faint disc with a hard
        // bright pip at the middle, and the pip has to stay a pip.
        const cs = this.atlas.stamp(PROF_CORE, T * 1.25);
        const rc = Math.max(R * 0.085 * core, 1.5);
        L.globalAlpha = sat(surface * core * 1.1);
        L.drawImage(cs, -rc, -rc, rc * 2, rc * 2);
      }
      L.setTransform(1, 0, 0, 1, 0, 0);

      // Representatives. Density scales with screen area, so a distant galaxy
      // gets a dozen and one filling the viewport gets a few hundred, and the
      // whole screen shares one budget.
      if (tracersLeft > 0 && R > AGG_SIMPLE_PX) {
        // Density per unit screen area, not per unit radius. A population
        // spread over four times the area needs four times the samples to look
        // like the same population, and radius-proportional counts leave a
        // large aggregate visibly under-sampled in the middle.
        const want = clamp(Math.round(R * R * 0.085), 12, 900);
        const cnt = Math.min(want, tracersLeft | 0);
        tracersLeft -= cnt;
        this.lastTracers += cnt;
        this.drawRepresentatives(L, a, sx, sy, R, T, ecc, ang, core, cnt, surface, gain);
      }

      // Dust lane. Applied to the composited light, which is why it goes in as
      // destination-out: it removes light rather than adding darkness, and that
      // is what an obscuring lane actually does.
      if (ecc > 0.22 && R > 22 && a.kind !== 'cloud') {
        // Two ARCS at different radii, not one ring. A near-complete ellipse
        // reads as a drawn outline; a pair of offset arcs reads as obscuring
        // material lying along the arms, which is what it is. They subtract
        // rather than add, because a dust lane removes light.
        L.setTransform(ca, sa, -sa * sq, ca * sq, sx, sy);
        L.globalCompositeOperation = 'destination-out';
        L.strokeStyle = '#000';
        L.lineCap = 'round';
        const seed = (a.seed !== undefined ? a.seed : hashString(a.id)) | 0;
        for (let q = 0; q < 2; q++) {
          const ph = TAU * hash3(q, seed, 2207) + q * Math.PI;
          L.globalAlpha = 0.30 - q * 0.07;
          L.lineWidth = Math.max(R * (0.075 - q * 0.018), 1.2);
          L.beginPath();
          L.arc(0, 0, R * (0.60 + q * 0.28), ph, ph + 2.0 + hash3(q, seed, 331) * 0.9);
          L.stroke();
        }
        L.globalCompositeOperation = 'lighter';
        L.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    L.globalAlpha = 1;
    return drawn;
  }

  /**
   * The representatives, and the one rule that makes the whole LOD scheme
   * correct: PER-REPRESENTATIVE BRIGHTNESS SCALES AS 1/count. The sample is a
   * stand-in for a fixed amount of light, so drawing twice as many of them must
   * make each one half as bright. Without that rule the tracer budget is a
   * brightness knob, the quality governor changes how bright the galaxy is when
   * it sheds tracers, and a galaxy that gains screen area gains light out of
   * nowhere. With it, the budget changes only the GRAIN of the galaxy, which is
   * exactly what a level of detail control is supposed to do.
   */
  drawRepresentatives(L, a, sx, sy, R, T, ecc, ang, core, cnt, surface, gain) {
    const seed = (a.seed !== undefined ? a.seed : hashString(a.id)) | 0;
    const spin = (a.spin || 0) * this.tSec;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sq = 1 - ecc;
    const alphaBase = clamp((surface * 62) / Math.max(cnt, 1), 0.012, 0.42);
    const stampS = this.atlas.stamp(PROF_CORE, T * 1.15);
    const stampH = this.atlas.stamp(PROF_HALO, T * 0.82);
    for (let q = 0; q < cnt; q++) {
      const u = hash3(q, seed, 191);
      const v = hash3(q, seed, 733);
      // Radial profile: a power sample controlled by `core` reproduces
      // everything from a uniform cloud to a cusped nucleus with one exponent.
      const rr = R * Math.pow(u, 0.5 + core * 1.6) * 1.35;
      // Differential rotation: inner material goes round faster. This is what
      // makes a galaxy visibly shear over minutes rather than spin like a
      // wheel, and it is one power law.
      const omega = spin * Math.pow(Math.max(rr / R, 0.05), -0.62);
      const th = TAU * v + omega;
      // Spiral arms, as an angular density modulation. Two arms, logarithmic.
      const armPhase = 2 * (th - 2.1 * Math.log(Math.max(rr / (R * 0.1), 1.02)));
      const arm = 0.42 + 0.58 * Math.pow(sat(0.5 + 0.5 * Math.cos(armPhase)), 1.7);
      let lx = Math.cos(th) * rr;
      let ly = Math.sin(th) * rr * sq;
      const px = sx + lx * ca - ly * sa;
      const py = sy + lx * sa + ly * ca;
      const bright = hash3(q, seed, 977);
      const aa = alphaBase * arm * (0.25 + bright * bright * 1.9);
      if (aa < 0.006) continue;
      // A small fraction of representatives are bright and hot: the O and B
      // stars. They are what give a galaxy its blue-white sparkle against the
      // amber bulk and they cost the same as the dim ones.
      const hot = bright > 0.955;
      const s = hot ? stampS : stampH;
      const sz = hot ? 2.6 : 1.7;
      L.globalAlpha = sat(hot ? aa * 2.2 : aa);
      L.drawImage(s, px - sz, py - sz, sz * 2, sz * 2);
    }
  }

  // ----------------------------------------------------------- discrete pass

  collectHoles(world) {
    const bs = world.bodies;
    if (!bs) return;
    const n = Math.min(bs.length, CONFIG.bodyScanCap);
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (b.kind !== 'blackhole') continue;
      const p = this.proj.of(b.frame);
      if (!p) continue;
      const sx = p.ox + (b.x || 0) * p.k;
      const sy = p.oy + (b.y || 0) * p.k;
      const rs = Math.max((b.r || 0) * p.k, 0.35);
      const reach = rs * CONFIG.lensRadiusMul;
      if (sx + reach < 0 || sx - reach > this.w || sy + reach < 0 || sy - reach > this.h) continue;
      this.holes.add(sx, sy, rs, b.spin === undefined ? 0.7 : b.spin,
        (b.seed !== undefined ? b.seed : hashString(b.id)) | 0, b.T || 20000,
        MAX_HOLES[this.tier]);
    }
  }

  /**
   * The discrete register.
   *
   * The legibility rule that makes a single dot survive forty decades: below
   * CONFIG.discPx a body stops shrinking and starts DIMMING. That is what
   * actually happens to a point source at distance, since its angular size is
   * already unresolvable and only its flux changes, and it means a lone dot can
   * never vanish into a sub-pixel smear.
   *
   * The floor under that dimming is deliberately LOW, and the reason is worth
   * stating because the obvious value is wrong. A high floor keeps a lone dot
   * visible, which is the goal, but it also means a thousand unresolvable dots
   * each hold that same floor, and a thousand floors added together is a white
   * screen. Auto-exposure is the correct instrument for the lone dot case: an
   * almost empty frame drives the aperture wide open and the dot comes back up
   * on its own, while a crowded frame stops down. So the floor exists only to
   * stop a body reaching exactly zero, and legibility is exposure's job.
   *
   * SELECTION UNDER THE CAP is a straight prefix of the array, and that is a
   * deliberate retreat from something cleverer that did not work. The first
   * version ran an adaptive screen-radius threshold that raised itself whenever
   * the cap saturated and decayed when it did not. It reads well and it
   * oscillates: once the threshold rises past the largest body nothing draws at
   * all, nothing saturates, so the threshold decays for twenty five frames and
   * everything floods back. Measured at fifty thousand bodies it was rendering
   * an EMPTY SCREEN half the time and reporting an excellent frame time for it.
   *
   * A fixed cap on a prefix has none of that behaviour: the same bodies are
   * chosen every frame, so there is no flicker, and there is no feedback loop
   * to become unstable. It relies on the documented contract that world.bodies
   * is ordered most significant first, which costs the simulation nothing to
   * honour and is the only place in this file that asks anything of it. If the
   * ordering is not honoured the result is still stable and still in budget,
   * just less well chosen.
   */
  drawBodies(L, world, gain) {
    const bs = world.bodies;
    this.renderedN = 0;
    this.lastBodies = bs || null;
    if (!bs || !bs.length) return;

    const n = Math.min(bs.length, CONFIG.bodyScanCap);
    const w = this.w, h = this.h;
    const cap = MAX_DISCS[this.tier];
    // The halo is drawn at five times the core radius, so in a dense clump it
    // is by far the largest source of OVERDRAW, and overdraw rather than draw
    // count is what actually costs at these object densities. Shedding it is
    // the last lever the governor has and the most effective one, which is why
    // it is reserved for the bottom tier: losing the halos costs atmosphere but
    // every body is still exactly where it was and still legible.
    const wantHalo = this.tier < 3;
    const lens = LENS_OUT;
    const hasHoles = this.holes.list.length > 0;
    let drawn = 0;

    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (b.kind === 'blackhole') continue;
      const p = this.proj.of(b.frame);
      if (!p) continue;
      const k = p.k;
      let sx = p.ox + (b.x || 0) * k;
      let sy = p.oy + (b.y || 0) * k;
      if (!isFinite(sx) || !isFinite(sy)) continue;

      let R = (b.r !== undefined ? b.r : radiusFromMass(b.m)) * k;
      if (!(R >= 0)) R = 0;

      let stretch = 1, ang = 0, ghostX = 0, ghostY = 0, ghostA = 0;
      if (hasHoles) {
        this.holes.lens(sx, sy, lens);
        if (lens.hit) {
          sx = lens.x; sy = lens.y;
          stretch = lens.stretch; ang = lens.ang;
          ghostX = lens.sx2; ghostY = lens.sy2; ghostA = lens.mag2;
        }
      }

      const core = Math.max(R, CONFIG.discPx);
      // resolved: 0 while the body is a point source, 1 once it has an edge.
      const resolved = smoothstep(CONFIG.discPx * 1.3, CONFIG.discPx * 3.0, R);
      const halo = Math.max(core * lerp(CONFIG.haloMul, CONFIG.haloResolvedMul, resolved),
        CONFIG.haloMinPx);
      if (sx + halo < 0 || sx - halo > w || sy + halo < 0 || sy - halo > h) continue;

      // Point-source dimming below the resolution floor.
      const shrink = R < CONFIG.discPx ? R / CONFIG.discPx : 1;
      const flux = R < CONFIG.discPx
        ? Math.max(shrink * shrink, CONFIG.pointFloorAlpha)
        : 1;
      const opacity = (b.a === undefined ? 1 : sat(b.a));
      const lumMul = b.lum === undefined ? kindLuminosity(b.kind) : b.lum;
      const T = b.T || kindTemperature(b.kind);
      let aCore = sat(flux * opacity * lumMul * gain * (wantHalo ? 0.95 : 1.30));
      let aHalo = wantHalo ? sat(flux * opacity * lumMul * gain * 0.42) : 0;
      if (aCore < 0.006 && aHalo < 0.006) continue;

      if (drawn >= cap) break;

      const sc = this.atlas.stamp(PROF_CORE, T);
      const sh = this.atlas.stamp(PROF_HALO, T);
      const sd = resolved > 0.01 ? this.atlas.stamp(PROF_DISC, T) : null;
      const aDisc = sat(opacity * resolved * clamp(gain * 0.5, 0.25, 1));

      if (stretch > 1.06) {
        // Lensed: stretch tangentially about the hole. This is what turns
        // nearby bodies into arcs and it is the reason a black hole reads
        // instantly even when everything on screen is a dot.
        // Same matrix-not-save rule as the aggregate pass. This path runs for
        // every body near a black hole, which is exactly when the frame is
        // already at its busiest.
        const ta = ang + Math.PI / 2;
        const tc = Math.cos(ta), ts = Math.sin(ta);
        L.setTransform(tc * stretch, ts * stretch, -ts, tc, sx, sy);
        if (wantHalo) {
          L.globalAlpha = aHalo;
          L.drawImage(sh, -halo, -halo, halo * 2, halo * 2);
        }
        L.globalAlpha = aCore;
        L.drawImage(sc, -core, -core, core * 2, core * 2);
        if (sd) {
          const dr = core * 2;
          L.globalAlpha = aDisc;
          L.drawImage(sd, -dr, -dr, dr * 2, dr * 2);
        }
        L.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        if (wantHalo) {
          L.globalAlpha = aHalo;
          L.drawImage(sh, sx - halo, sy - halo, halo * 2, halo * 2);
        }
        L.globalAlpha = aCore;
        L.drawImage(sc, sx - core, sy - core, core * 2, core * 2);
        if (sd) {
          // The disc stamp is half its own canvas wide, so it is drawn at twice
          // the body radius to land the limb exactly on R.
          const dr = core * 2;
          L.globalAlpha = aDisc;
          L.drawImage(sd, sx - dr, sy - dr, dr * 2, dr * 2);
        }
      }

      // The secondary image. The single most legible tell of a gravity well.
      if (ghostA > 0.02) {
        const gr = core * clamp(ghostA * 2.2, 0.4, 1.6);
        L.globalAlpha = sat(aCore * ghostA * 1.6);
        L.drawImage(sh, ghostX - gr * 2.4, ghostY - gr * 2.4, gr * 4.8, gr * 4.8);
        L.globalAlpha = sat(aCore * ghostA);
        L.drawImage(sc, ghostX - gr, ghostY - gr, gr * 2, gr * 2);
      }


      if (this.renderedN < CONFIG.maxDiscs) {
        this.renderedX[this.renderedN] = sx;
        this.renderedY[this.renderedN] = sy;
        this.renderedR[this.renderedN] = core;
        this.renderedI[this.renderedN] = i;
        this.renderedN++;
      }
      drawn++;
    }

    L.globalAlpha = 1;
  }

  /**
   * GRAVITY, DRAWN. In the first minutes there are two or three objects and
   * nothing on screen explains why they are moving. A tether between a pair,
   * with brightness proportional to the force between them, shows the mechanic
   * instead of stating it, and the brightening as they close is the first piece
   * of feedback the game ever gives.
   *
   * It switches itself off above CONFIG.tetherMaxBodies, which is exactly
   * right: the pass is O(n^2) and it is only legible when the scene is
   * intimate. Above a hundred bodies a force web is spaghetti and below it, it
   * is the tutorial. The perf ceiling and the design ceiling are the same
   * number, which is a good sign the rule is the right one.
   */
  drawTethers(L, world, gain) {
    const bs = world.bodies;
    if (!bs || bs.length < 2 || bs.length > CONFIG.tetherMaxBodies) return;
    const n = bs.length;
    let cnt = 0;
    let weakest = Infinity, weakestSlot = -1;

    for (let i = 0; i < n; i++) {
      const bi = bs[i];
      const pi = this.proj.of(bi.frame);
      if (!pi) continue;
      const mi = bi.m || 1;
      for (let j = i + 1; j < n; j++) {
        const bj = bs[j];
        const pj = this.proj.of(bj.frame);
        if (!pj) continue;
        const ax = pi.ox + (bi.x || 0) * pi.k, ay = pi.oy + (bi.y || 0) * pi.k;
        const bx = pj.ox + (bj.x || 0) * pj.k, by = pj.oy + (bj.y || 0) * pj.k;
        const dx = bx - ax, dy = by - ay;
        const d2 = dx * dx + dy * dy;
        if (d2 < 4 || d2 > 4e6) continue;
        // LOG force, not force. In a world spanning forty decades of mass the
        // product of two masses routinely exceeds the 3.4e38 ceiling of a
        // float32 and silently becomes Infinity, after which the ranking
        // divides Infinity by Infinity and every tether turns to NaN. Working
        // in logs keeps the whole comparison inside a range of about +/-300 and
        // preserves the ordering exactly, since log is monotonic.
        const f = Math.log10(mi) + Math.log10(bj.m || 1) - Math.log10(d2);
        if (!isFinite(f)) continue;
        if (cnt < CONFIG.tetherMaxLines) {
          this.tetherA[cnt] = i; this.tetherB[cnt] = j; this.tetherF[cnt] = f;
          if (f < weakest) { weakest = f; weakestSlot = cnt; }
          cnt++;
        } else if (f > weakest) {
          this.tetherA[weakestSlot] = i; this.tetherB[weakestSlot] = j; this.tetherF[weakestSlot] = f;
          weakest = Infinity;
          for (let q = 0; q < cnt; q++) if (this.tetherF[q] < weakest) { weakest = this.tetherF[q]; weakestSlot = q; }
        }
      }
    }
    if (!cnt) return;

    let maxF = -Infinity;
    for (let q = 0; q < cnt; q++) if (this.tetherF[q] > maxF) maxF = this.tetherF[q];
    if (!isFinite(maxF)) return;

    L.lineCap = 'round';
    for (let q = 0; q < cnt; q++) {
      // Back out of log space into a 0..1 ratio against the strongest pair on
      // screen, then compress: a linear ratio would leave every tether but the
      // strongest invisible, since the force spread across a scene is itself
      // several decades wide.
      const rel = sat(Math.pow(10, (this.tetherF[q] - maxF) * 0.5));
      const a = Math.pow(rel, 0.42) * CONFIG.tetherAlpha * clamp(gain, 0.4, 1.4);
      if (!(a >= 0.012)) continue;
      const bi = bs[this.tetherA[q]], bj = bs[this.tetherB[q]];
      const pi = this.proj.of(bi.frame), pj = this.proj.of(bj.frame);
      const ax = pi.ox + (bi.x || 0) * pi.k, ay = pi.oy + (bi.y || 0) * pi.k;
      const bx = pj.ox + (bj.x || 0) * pj.k, by = pj.oy + (bj.y || 0) * pj.k;
      // A gradient along the line, brighter at the heavier end. It reads as a
      // direction without being an arrow, which matters: an arrow would be a
      // UI element and this has to be part of the world.
      const heavier = (bi.m || 1) >= (bj.m || 1);
      const g = L.createLinearGradient(ax, ay, bx, by);
      const c1 = heavier ? a : a * 0.18, c2 = heavier ? a * 0.18 : a;
      g.addColorStop(0, `rgba(118,148,196,${c1.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(118,148,196,${(a * 0.42).toFixed(3)})`);
      g.addColorStop(1, `rgba(118,148,196,${c2.toFixed(3)})`);
      L.strokeStyle = g;
      L.lineWidth = clamp(0.5 + rel * 0.8, 0.5, 1.3);
      L.globalAlpha = 1;
      L.beginPath();
      L.moveTo(ax, ay); L.lineTo(bx, by);
      L.stroke();

      // One luminance ripple travelling from the lighter body toward the
      // heavier, at a rate set by the force. It animates the direction of the
      // pull, which no static line can do, and it is four numbers of work.
      const ph = (this.tSec * (0.35 + rel * 1.4)) % 1;
      const t = heavier ? 1 - ph : ph;
      const rx = lerp(ax, bx, t), ry = lerp(ay, by, t);
      const s = this.atlas.stamp(PROF_HALO, 5200);
      const rr = 3.6;
      L.globalAlpha = sat(a * 1.25);
      L.drawImage(s, rx - rr, ry - rr, rr * 2, rr * 2);
    }
    L.globalAlpha = 1;
  }

  // ------------------------------------------------------------ contextual

  /**
   * The contextual register: things larger than the viewport. You cannot draw
   * a structure you are inside, so you draw the FACT that you are inside it.
   * A rim gradient leans the screen edge toward the parent's centre of mass and
   * takes its colour, plus a small chevron at the edge naming it. Deep inside a
   * galaxy the screen very faintly glows toward the core. It costs two
   * gradients, it is never noticed consciously, and without it a zoomed-in view
   * has no orientation at all.
   */
  drawContext(ctx, world, w, h) {
    if (!world || !world.aggregates) return;
    const ag = world.aggregates;
    const n = Math.min(ag.length, MAX_AGGS[0]);
    for (let i = 0; i < n; i++) {
      const a = ag[i];
      const p = this.proj.of(a.frame);
      if (!p) continue;
      const R = (a.rms || 1) * p.k;
      if (R <= Math.max(w, h) * 1.6) continue;
      const sx = p.ox + (a.x || 0) * p.k;
      const sy = p.oy + (a.y || 0) * p.k;
      if (!isFinite(sx) || !isFinite(sy)) continue;
      const cx = w / 2, cy = h / 2;
      const dx = sx - cx, dy = sy - cy;
      const d = Math.hypot(dx, dy);
      const T = a.T || 4200;
      const idx = bbIndex(T);
      // Depth into the structure: dead centre is dim ambient everywhere,
      // out near the rim the gradient becomes strongly directional.
      const depth = sat(d / Math.max(R, 1));
      const ux = d > 1 ? dx / d : 0, uy = d > 1 ? dy / d : 1;
      const g = ctx.createLinearGradient(cx - ux * w, cy - uy * h, cx + ux * w, cy + uy * h);
      const a0 = 0.010 + depth * 0.055;
      g.addColorStop(0, `rgba(${bbR[idx]},${bbG[idx]},${bbB[idx]},0)`);
      g.addColorStop(1, `rgba(${bbR[idx]},${bbG[idx]},${bbB[idx]},${a0.toFixed(4)})`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      // The chevron: a short arc on the edge in the direction of the centre,
      // with the structure's name beside it. This is the "you are here" and
      // it is the only place the contextual register uses a word.
      if (a.kind && d > 1) {
        const rr = Math.min(w, h) * 0.46;
        const ex = cx + ux * rr, ey = cy + uy * rr;
        ctx.globalAlpha = 0.24;
        ctx.strokeStyle = `rgba(${HUD_RGB},1)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, Math.atan2(uy, ux) - 0.11, Math.atan2(uy, ux) + 0.11);
        ctx.stroke();
        ctx.font = `400 9px ${CONFIG.hudFace}`;
        ctx.textBaseline = 'middle';
        const label = String(a.kind).toUpperCase();
        const lw = trackedWidth(ctx, label, 2.0);
        // Just inside the chevron, on whichever side keeps it fully on screen.
        const lx = clamp(ex - ux * 18 - (ux > 0 ? lw : 0), 12, w - lw - 12);
        drawTracked(ctx, label, lx, clamp(ey - uy * 14, 14, h - 14),
          `rgba(${HUD_RGB},0.34)`, 2.0);
        ctx.globalAlpha = 1;
      }
      break;   // one containing structure is orientation; two is noise
    }
  }

  // -------------------------------------------------------------- composite

  /**
   * Two-tap bloom. Downsample the light layer twice, blur each with the canvas
   * filter (cheap at 1/8 and 1/26 resolution, where a 6px blur is an enormous
   * radius in screen terms), add both back. The result is the scattering halo
   * that makes emitted light read as light rather than as coloured shapes, and
   * it is what makes a dense clump of dots blow out to a white core the way a
   * long exposure does.
   *
   * The taps are the first thing the governor sheds, because losing bloom costs
   * atmosphere but never costs legibility.
   */
  drawBloom(ctx, w, h) {
    if (this.tier >= 2) return;
    const a = this.bctxA, b = this.bctxB;
    const aw = this.bloomA.width, ah = this.bloomA.height;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'source-over';
    a.clearRect(0, 0, aw, ah);
    try { a.filter = 'blur(3px)'; } catch (_) { /* fine */ }
    a.drawImage(this.light, 0, 0, aw, ah);
    a.filter = 'none';
    if (this.tier >= 2) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this.bloomA, 0, 0, w, h);

    if (this.tier < 1) {
      const bw = this.bloomB.width, bh = this.bloomB.height;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.clearRect(0, 0, bw, bh);
      try { b.filter = 'blur(4px)'; } catch (_) { /* fine */ }
      b.drawImage(this.bloomA, 0, 0, bw, bh);
      b.filter = 'none';
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.bloomB, 0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The collapse inversion. For about a third of a second after something
   * collapses, the region around it is composited with `difference`, which
   * briefly renders the local field as a negative. It is jarring, it is
   * completely unmistakable, and it is reserved for the one class of event
   * where the rules of the object changed. With no audio channel available,
   * this is the loudest thing the renderer can say.
   */
  drawInversion(ctx, w, h) {
    const inv = this.inversion;
    if (!inv) return;
    const u = sat(inv.t / inv.life);
    const a = Math.pow(1 - u, 1.4) * 0.85 * this.motion;
    if (a < 0.02) return;
    const r = inv.r * (0.4 + u * 1.5);
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    const g = ctx.createRadialGradient(inv.x, inv.y, 0, inv.x, inv.y, r);
    g.addColorStop(0, `rgba(255,255,255,${(a * 0.55).toFixed(3)})`);
    g.addColorStop(0.65, `rgba(190,214,255,${(a * 0.22).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(inv.x - r, inv.y - r, r * 2, r * 2);
    ctx.restore();
  }

  /**
   * A vignette that breathes very slightly. It is doing two jobs: it keeps the
   * eye centred where the subject is, and its slow pulse is the only thing on
   * an otherwise still screen that proves the simulation is running. On a
   * literally blank opening screen that matters more than it sounds.
   */
  drawVignette(ctx, w, h) {
    const breathe = 1 + Math.sin(this.tSec * 0.31) * 0.035;
    const r = Math.max(w, h) * 0.78 * breathe;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.42, w / 2, h / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

// =============================================================================
// FALLBACKS - so a half-built simulation still draws something honest.
// =============================================================================

function radiusFromMass(m) {
  // Constant density fallback in the absence of a radius. Only ever a
  // placeholder: the simulation owns the real relation, which is not a single
  // power law across the whole run anyway.
  if (!(m > 0)) return 0.5;
  return Math.pow(m, 1 / 3) * 0.5;
}

const KIND_T = {
  grain: 60, dust: 90, rock: 300, planet: 700, giant: 1400,
  star: 5600, remnant: 12000, neutron: 900000, blackhole: 20000, node: 3000,
};
const KIND_L = {
  grain: 0.20, dust: 0.26, rock: 0.34, planet: 0.42, giant: 0.62,
  star: 1.0, remnant: 0.85, neutron: 1.25, blackhole: 1.0, node: 0.7,
};
function kindTemperature(kind) { return KIND_T[kind] || 1600; }
function kindLuminosity(kind) { return KIND_L[kind] === undefined ? 0.55 : KIND_L[kind]; }

/**
 * A 128px tile of hashed 0..4 luminance noise, added over the vacuum washes to
 * break 8-bit gradient banding. Generated from the same integer hash as
 * everything else; nothing is loaded.
 */
function makeDitherTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const img = x.createImageData(128, 128);
  const d = img.data;
  for (let j = 0; j < 128; j++) {
    for (let i = 0; i < 128; i++) {
      const v = (hash3(i, j, 8123) * 5) | 0;
      const o = (j * 128 + i) * 4;
      d[o] = v; d[o + 1] = v; d[o + 2] = v + 1; d[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

function hashString(s) {
  let h = 2166136261;
  const str = String(s === undefined ? '' : s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Create a renderer bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas  sized by CSS; the renderer owns its
 *        backing store and device pixel ratio.
 * @param {object} [opts]
 * @param {function():object} [opts.world]  called once per frame by start().
 *        Return the world snapshot. Omit if the host drives renderFrame().
 * @param {boolean} [opts.ownInput=true]  bind wheel-to-zoom, drag-to-pan.
 * @returns {{
 *   start:      function(): void,
 *   stop:       function(): void,
 *   destroy:    function(): void,
 *   renderFrame:function(object, number=): void,
 *   resize:     function(): void,
 *   emit:       function(object): void,
 *   setCaption: function(string): void,
 *   screenToWorld: function(number, number): object,
 *   worldToScreen: function(number, number, *): {x:number,y:number},
 *   pick:       function(number, number, number=): object|null,
 *   getViewport:function(): object,
 *   nudgeZoom:  function(number): void,
 *   recenter:   function(): void,
 *   setQuality: function(number|'auto'): void,
 *   stats:      function(): object,
 *   camera:     Camera
 * }}
 */
export function createRenderer(canvas, opts) {
  const r = new Renderer(canvas, opts);
  return {
    start: () => r.start(),
    stop: () => r.stop(),
    destroy: () => r.destroy(),
    renderFrame: (world, now) => r.renderFrame(world, now),
    resize: () => r.resize(),
    emit: (ev) => r.emit(ev),
    setCaption: (t) => r.setCaption(t),
    screenToWorld: (x, y) => r.screenToWorld(x, y),
    worldToScreen: (x, y, f) => r.worldToScreen(x, y, f),
    pick: (x, y, tol) => r.pick(x, y, tol),
    getViewport: () => r.getViewport(),
    nudgeZoom: (d) => r.nudgeZoom(d),
    recenter: () => r.recenter(),
    setQuality: (t) => r.setQuality(t),
    stats: () => r.stats(),
    camera: r.cam,
    _internal: r,
  };
}

export default createRenderer;

// =============================================================================
// SIMULATION ADAPTER - the seam, for a structure-of-arrays simulation.
// =============================================================================
//
// The contract documented at the top of this file describes bodies as an array
// of objects, because that is the shape a half-built simulation can produce on
// day one and because it degrades gracefully when fields are missing. A mature
// simulation at these object counts will not want to hand over objects at all:
// it will keep parallel typed arrays and a count, so that stepping the world
// touches no garbage collector. Both are right, and this is the seam between
// them.
//
// Nothing is imported here. The adapter duck-types on the presence of `count`
// and `px`, and every assumption about the producer's encoding is an option the
// caller can override. It reuses pooled objects, so after the first frame it
// allocates nothing.
//
// Expected source shape, all fields optional except count/px/py:
//
//   { count, px, py, radius, mass, kind, flags, idOfSlot,
//     aggN, aggR, aggSigma, aggPhase, pop, heat, vx, vy, spin }
//
// USAGE
//
//   const adapt = createSimAdapter();
//   const world = adapt(sim.getRenderView(), { extent, events, t });
//   renderer.renderFrame(world);
//
// KNOWN CAVEAT, stated because it is the one thing that will bite: the renderer
// draws a PREFIX of world.bodies when the count exceeds its cap, and expects
// that prefix to be the most significant objects. Pool slot order is not
// significance order. If a producer's slots are not roughly ordered by mass,
// either keep them so, or expose a significance-ordered index and pass it as
// options.order. Nothing breaks without it; the choice of which bodies survive
// the cap simply becomes arbitrary rather than sensible.

/** Default map from an integer kind code to the kind strings this file draws. */
const DEFAULT_KIND_MAP = [
  'dust', 'rock', 'rock', 'planet', 'giant',
  'star', 'star', 'giant', 'remnant', 'neutron',
  'blackhole',
];
/** Default map for kind codes at or above the aggregate threshold. */
const DEFAULT_AGG_MAP = ['cluster', 'galaxy', 'group', 'web', 'field'];

/**
 * Build a reusable adapter from a structure-of-arrays render view to the world
 * shape this renderer consumes.
 *
 * @param {object} [options]
 * @param {number} [options.aggFirstKind=11] kind codes at or above this are
 *        aggregates. Ignored when the view supplies `flags` and flagAggregate.
 * @param {number} [options.flagAggregate=0] bit in `flags` marking an
 *        aggregate. Takes precedence over aggFirstKind when non-zero.
 * @param {string[]} [options.kindMap] kind code to body kind string.
 * @param {string[]} [options.aggMap] kind code offset to aggregate kind string.
 * @param {function(number, number):number} [options.temperature] (heat, kind)
 *        to kelvin. Omit and the renderer falls back to a per-kind default,
 *        which is the right answer until the producer defines a heat scale.
 * @param {number[]} [options.order] optional significance-ordered slot indices.
 * @returns {function(object, object=): object} adapt(view, extra) -> world
 */
export function createSimAdapter(options = {}) {
  const aggFirst = options.aggFirstKind === undefined ? 11 : options.aggFirstKind;
  const flagAgg = options.flagAggregate || 0;
  const kindMap = options.kindMap || DEFAULT_KIND_MAP;
  const aggMap = options.aggMap || DEFAULT_AGG_MAP;
  const tempOf = options.temperature || null;

  const bodyPool = [];
  const aggPool = [];
  const world = {
    t: 0, exp: 0, frames: null,
    bodies: [], aggregates: [], events: [], extent: 0,
  };

  return function adapt(view, extra) {
    const n = view && view.count > 0 ? view.count : 0;
    const px = view && view.px, py = view && view.py;
    let nb = 0, na = 0;
    if (n && px && py) {
      const order = options.order || null;
      const rad = view.radius, mass = view.mass, kind = view.kind, flags = view.flags;
      const ids = view.idOfSlot, heat = view.heat, spin = view.spin;
      const vx = view.vx, vy = view.vy;
      const aggN = view.aggN, aggR = view.aggR, aggSig = view.aggSigma, aggPh = view.aggPhase;

      for (let s = 0; s < n; s++) {
        const i = order ? order[s] : s;
        const k = kind ? kind[i] : 0;
        const isAgg = flagAgg ? ((flags ? flags[i] : 0) & flagAgg) !== 0 : k >= aggFirst;

        if (isAgg) {
          let a = aggPool[na];
          if (!a) a = aggPool[na] = {};
          na++;
          a.id = ids ? ids[i] : i;
          a.frame = undefined;
          a.x = px[i]; a.y = py[i];
          a.n = aggN ? aggN[i] : 1;
          // aggSigma is a spread; prefer it as the characteristic radius and
          // fall back to the aggregate radius, then to the body radius.
          a.rms = (aggSig && aggSig[i]) || (aggR && aggR[i]) || (rad ? rad[i] : 1);
          a.core = 0.62;
          a.ecc = 0.34;
          a.angle = aggPh ? aggPh[i] : 0;
          a.spin = 0.05;
          a.kind = aggMap[k - aggFirst] || 'cluster';
          a.lum = a.n;
          a.seed = (ids ? ids[i] : i) | 0;
          if (tempOf) a.T = tempOf(heat ? heat[i] : 0, k);
          else a.T = undefined;
        } else {
          let b = bodyPool[nb];
          if (!b) b = bodyPool[nb] = {};
          nb++;
          b.id = ids ? ids[i] : i;
          b.frame = undefined;
          b.x = px[i]; b.y = py[i];
          b.vx = vx ? vx[i] : 0; b.vy = vy ? vy[i] : 0;
          b.r = rad ? rad[i] : 1;
          // Mass may be in the producer's own code units with a shared
          // exponent. That is fine here: the only uses are tether ranking,
          // which needs order and not magnitude, and a radius fallback that a
          // supplied radius already pre-empts. Absolute mass is the interface
          // layer's problem, not the renderer's.
          b.m = mass ? mass[i] : 1;
          b.kind = kindMap[k] || 'rock';
          b.spin = spin ? spin[i] : 0;
          b.seed = (ids ? ids[i] : i) | 0;
          b.a = 1;
          b.T = tempOf ? tempOf(heat ? heat[i] : 0, k) : undefined;
          b.lum = undefined;
        }
      }
    }
    world.bodies.length = nb;
    for (let i = 0; i < nb; i++) world.bodies[i] = bodyPool[i];
    world.aggregates.length = na;
    for (let i = 0; i < na; i++) world.aggregates[i] = aggPool[i];

    if (extra) {
      if (extra.t !== undefined) world.t = extra.t;
      if (extra.exp !== undefined) world.exp = extra.exp;
      if (extra.extent !== undefined) world.extent = extra.extent;
      if (extra.frames !== undefined) world.frames = extra.frames;
      if (extra.focus !== undefined) world.focus = extra.focus;
      // Events are DRAINED by the renderer, so they are moved across rather
      // than aliased: the producer keeps ownership of its own array.
      if (extra.events && extra.events.length) {
        for (let i = 0; i < extra.events.length; i++) world.events.push(extra.events[i]);
        extra.events.length = 0;
      }
    }
    return world;
  };
}

// =============================================================================
// FIXTURE - a development harness only. NOT part of the API and NOT game logic.
// =============================================================================
//
// This produces a static, analytically-posed world snapshot conforming to the
// contract above, so render.js can be developed and verified standing alone
// before sim.js exists, and so sibling modules have something concrete to check
// their own shapes against. It contains no rules, no state, and no decisions:
// positions are a closed-form function of t. Delete it the day it stops being
// useful; nothing in the renderer references it.

export function createFixtureWorld(stage = 'first', seed = 7) {
  const world = { t: 0, exp: 0, bodies: [], aggregates: [], events: [], extent: 0 };
  const B = (o) => { world.bodies.push(o); return o; };

  if (stage === 'blank') {
    world.extent = 4;
  } else if (stage === 'first') {
    B({ id: 'a', x: 0, y: 0, r: 0.30, m: 1, kind: 'dust', T: 900, seed: 1 });
    world.extent = 3;
  } else if (stage === 'pair') {
    B({ id: 'a', x: -1.6, y: 0.2, r: 0.30, m: 1.4, kind: 'dust', T: 1000, seed: 1 });
    B({ id: 'b', x: 1.5, y: -0.3, r: 0.22, m: 0.7, kind: 'dust', T: 800, seed: 2 });
    world.extent = 3.4;
  } else if (stage === 'cloud') {
    for (let i = 0; i < 240; i++) {
      const a = TAU * hash3(i, seed, 11);
      const r = 60 * Math.pow(hash3(i, seed, 23), 0.55);
      B({
        id: 'c' + i, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8,
        r: 0.3 + hash3(i, seed, 31) * 1.4, m: 1 + hash3(i, seed, 41) * 12,
        kind: hash3(i, seed, 53) > 0.86 ? 'star' : 'rock',
        T: 700 + hash3(i, seed, 61) * 5200, seed: i,
      });
    }
    world.extent = 90;
  } else if (stage === 'system') {
    B({ id: 'star', x: 0, y: 0, r: 7, m: 2e30, kind: 'star', T: 5800, seed: 1 });
    for (let i = 0; i < 9; i++) {
      const rr = 30 + i * 34;
      const a = TAU * hash3(i, seed, 71);
      B({
        id: 'p' + i, x: Math.cos(a) * rr, y: Math.sin(a) * rr,
        r: 1.2 + hash3(i, seed, 83) * 2.6, m: 1e24,
        kind: i > 4 ? 'giant' : 'planet', T: 300 + hash3(i, seed, 97) * 900, seed: i,
      });
    }
    world.extent = 420;
  } else if (stage === 'blackhole') {
    B({ id: 'bh', x: 0, y: 0, r: 26, m: 1e32, kind: 'blackhole', spin: 0.85, seed: 5 });
    for (let i = 0; i < 300; i++) {
      const a = TAU * hash3(i, seed, 13);
      const r = 60 + 900 * Math.pow(hash3(i, seed, 29), 0.7);
      B({
        id: 's' + i, x: Math.cos(a) * r, y: Math.sin(a) * r,
        r: 1.1 + hash3(i, seed, 37) * 2.4, m: 2e30, kind: 'star',
        T: 3200 + hash3(i, seed, 43) * 16000, seed: i,
      });
    }
    world.extent = 900;
  } else if (stage === 'galaxy') {
    world.aggregates.push({
      id: 'g0', x: 0, y: 0, n: 4e11, rms: 300, core: 0.72, ecc: 0.36,
      angle: 0.5, spin: 0.06, T: 4600, lum: 3e10, kind: 'galaxy', seed: 3,
    });
    world.aggregates.push({
      id: 'g1', x: 900, y: -420, n: 2e9, rms: 70, core: 0.5, ecc: 0.2,
      angle: 1.9, spin: 0.14, T: 6200, lum: 4e8, kind: 'cluster', seed: 9,
    });
    B({ id: 'bh', x: 0, y: 0, r: 3.2, m: 1e37, kind: 'blackhole', spin: 0.9, seed: 5 });
    // Only NOTABLE bodies are discrete at this scale. A simulation that also
    // handed over half a thousand unresolvable field stars sitting inside an
    // aggregate that already represents four hundred billion of them would be
    // double counting the same light, and the renderer would faithfully draw it
    // twice. Aggregates own the population; discrete bodies own the exceptions.
    for (let i = 0; i < 40; i++) {
      const a = TAU * hash3(i, seed, 101);
      const r = 330 * Math.pow(hash3(i, seed, 103), 0.6);
      B({
        id: 'f' + i, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62,
        r: 1.6 + hash3(i, seed, 109) * 2.2, m: 2e31, kind: 'giant',
        T: 3000 + hash3(i, seed, 107) * 18000, seed: i,
      });
    }
    world.extent = 1300;
  } else if (stage === 'web') {
    for (let i = 0; i < 340; i++) {
      const a = TAU * hash3(i, seed, 151);
      const r = 4000 * Math.pow(hash3(i, seed, 157), 0.5);
      world.aggregates.push({
        id: 'w' + i, x: Math.cos(a) * r + (hash3(i, seed, 163) - 0.5) * 900,
        y: Math.sin(a) * r * 0.75 + (hash3(i, seed, 167) - 0.5) * 900,
        n: 1e11, rms: 20 + hash3(i, seed, 173) * 90,
        core: 0.4 + hash3(i, seed, 179) * 0.5, ecc: hash3(i, seed, 181) * 0.7,
        angle: TAU * hash3(i, seed, 191), spin: 0.05,
        T: 3400 + hash3(i, seed, 193) * 3400, lum: 1e9 * (0.2 + hash3(i, seed, 197) * 4),
        kind: 'galaxy', seed: i,
      });
    }
    world.extent = 5200;
  }
  return world;
}
