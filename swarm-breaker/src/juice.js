/**
 * Swarm Breaker - impact and feedback layer.
 *
 * Everything a hit, a break, a pickup or a milestone looks like: floating
 * damage numbers, procedural shatter debris, ball trails, impact rings,
 * screen shake, and a chromatic pulse for swarm milestones.
 *
 * Drawn entirely from canvas primitives and math. No image files, no fonts to
 * load, no dependencies, no build step.
 *
 * Every signal in here is visual. Nothing about the game state is ever carried
 * by sound, so a player who cannot hear the game loses no information.
 *
 * ---------------------------------------------------------------------------
 * WIRING
 *
 *   import { createJuice } from './src/juice.js';
 *   const juice = createJuice({ width: 520, height: 620, floorY: 566 });
 *
 *   // once per frame, in this order
 *   juice.update(dt);        // dt in seconds (milliseconds are detected too)
 *   juice.begin(ctx);        // saves the context and applies screen shake
 *   drawTheField(ctx);       // blocks, balls, launcher - the game's own draw
 *   juice.draw(ctx);         // debris, trails, sparks, rings, damage numbers
 *   juice.end(ctx);          // restores the context, draws the full-screen pass
 *
 *   // from the simulation, whenever something happens
 *   juice.hit(x, y, damage, nx, ny);
 *   juice.destroy(x, y, blockColor, nx, ny);
 *   juice.pickup(x, y, 'ball', 1);
 *   juice.launch(x, y, dx, dy);
 *   juice.trail(x, y, vx, vy);   // once per live ball per frame
 *   juice.swarm(n);              // current swarm size, once per frame
 *   juice.clear();               // on restart
 *
 * All emit methods are safe to call at any rate and in any order. They never
 * allocate, never throw on bad input, and silently thin themselves out when
 * the field gets busy.
 * ---------------------------------------------------------------------------
 */

// --- look ------------------------------------------------------------------

const FONT_STACK = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

const INK = '#e6e9ef';
const SWARM = '#5ad1ff';
const GOLD = '#ffc94a';
const HOT = '#ff5c46';
const DIM = '#7a828f';

// Fixed palette slots. These never get recycled, so the core colors are always
// available even after a run has churned through a hundred block shades.
const S_INK = 0, S_SWARM = 1, S_GOLD = 2, S_HOT = 3, S_DIM = 4, S_BG = 5;
const RESERVED_SLOTS = 6;
const BG = '#08090c';

// Damage numbers step through four sizes rather than scaling continuously, so
// the font string is a lookup instead of a rebuild on every draw.
const NUM_FONTS = [
  '600 11px ' + FONT_STACK,
  '600 13px ' + FONT_STACK,
  '700 15px ' + FONT_STACK,
  '700 18px ' + FONT_STACK
];
const NUM_SLOTS = [S_DIM, S_INK, S_GOLD, S_HOT];

// --- capacity --------------------------------------------------------------

/**
 * Hard pool caps. Every effect lives in a preallocated slot table; nothing is
 * allocated once the game is running. When a pool fills, the write cursor
 * recycles the oldest slot, so a thousand simultaneous impacts cost exactly
 * what ten cost. These numbers are the whole performance story: worst case the
 * layer draws ~1150 primitives plus at most 48 short text runs per frame.
 */
const CAP = {
  trail: 512,   // ball trail stamps
  spark: 320,   // impact streaks
  debris: 240,  // shatter shards
  number: 48,   // floating damage numbers (merged on contact, rarely near cap)
  ring: 32,     // expanding impact, pickup and launch rings
  color: 16     // distinct colors held as prebuilt alpha ramps
};

/**
 * Per-frame emission budgets. Hundreds of balls can land dozens of hits in one
 * frame. Past these counts a hit still registers as a damage number and still
 * feeds the shake, but stops spawning particles - the readout stays legible
 * instead of washing out into noise.
 */
const BUDGET = { hit: 12, destroy: 6 };

// Screen shake ceiling in pixels. Deliberately low: the shake reads as a kick,
// not as a camera fault, and the offset is rounded to whole pixels so the
// block HP numbers underneath stay sharp.
const SHAKE_MAX = 5.5;

/**
 * Shard outlines in unit space, irregular on purpose. Identical triangles read
 * as confetti; uneven slivers read as broken material.
 */
const SHARDS = [
  new Float32Array([-1, -0.6, 0.9, -1, 0.6, 0.8, -0.7, 1]),
  new Float32Array([-1, -0.3, 0.4, -1, 1, 0.5]),
  new Float32Array([-0.8, -1, 1, -0.2, 0.1, 1, -1, 0.5]),
  new Float32Array([-0.5, -1, 1, -0.4, 0.3, 1]),
  new Float32Array([-1, 0, 0, -1, 1, 0.2, 0.2, 1]),
  new Float32Array([-0.9, -0.8, 0.8, -0.9, 0.5, 0.9, -0.6, 0.7])
];

// --- color ------------------------------------------------------------------

/** Parse '#abc', '#aabbcc', 'rgb(...)' or 'hsl(...)' into [r,g,b]. Cold path. */
function parseRGB(css) {
  const s = String(css).trim().toLowerCase();

  if (s.charCodeAt(0) === 35) { // '#'
    if (s.length === 4) {
      const r = parseInt(s[1] + s[1], 16), g = parseInt(s[2] + s[2], 16), b = parseInt(s[3] + s[3], 16);
      return [r, g, b];
    }
    if (s.length >= 7) {
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    }
    return [230, 233, 239];
  }

  // Accepts both comma and space separated forms of rgb()/hsl().
  const nums = s.match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 3) return [230, 233, 239];

  if (s.startsWith('hsl')) {
    const h = ((+nums[0] % 360) + 360) % 360 / 360;
    const sat = Math.min(1, Math.max(0, +nums[1] / 100));
    const l = Math.min(1, Math.max(0, +nums[2] / 100));
    if (sat === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }

  return [clamp255(+nums[0]), clamp255(+nums[1]), clamp255(+nums[2])];
}

function hue(p, q, t) {
  if (t < 0) t += 1; else if (t > 1) t -= 1;
  let v;
  if (t < 1 / 6) v = p + (q - p) * 6 * t;
  else if (t < 1 / 2) v = q;
  else if (t < 2 / 3) v = p + (q - p) * (2 / 3 - t) * 6;
  else v = p;
  return Math.round(v * 255);
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

/**
 * A tiny color table. Each registered color is expanded once into 17 prebuilt
 * 'rgba(...)' strings, so drawing a faded particle is an array lookup instead
 * of string concatenation in the hot loop.
 */
function createPalette() {
  const STEPS = 17;
  const key = new Array(CAP.color).fill(null);
  const ramp = new Array(CAP.color).fill(null);
  let cursor = RESERVED_SLOTS;

  function build(css) {
    const c = parseRGB(css);
    const out = new Array(STEPS);
    const head = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',';
    for (let i = 0; i < STEPS; i++) out[i] = head + (i / (STEPS - 1)).toFixed(3) + ')';
    return out;
  }

  function register(i, css) { key[i] = css; ramp[i] = build(css); }

  register(S_INK, INK);
  register(S_SWARM, SWARM);
  register(S_GOLD, GOLD);
  register(S_HOT, HOT);
  register(S_DIM, DIM);
  register(S_BG, BG);

  return {
    /** Slot index for a css color, registering it if new. Recycles oldest. */
    slot(css) {
      if (typeof css !== 'string' || css.length === 0) return S_INK;
      for (let i = 0; i < CAP.color; i++) if (key[i] === css) return i;
      const i = cursor;
      cursor = cursor + 1 >= CAP.color ? RESERVED_SLOTS : cursor + 1;
      register(i, css);
      return i;
    },
    /** Prebuilt rgba string for a slot at an alpha of 0..1. Allocation free. */
    shade(slot, alpha) {
      const r = ramp[slot] || ramp[S_INK];
      let k = (alpha * 16 + 0.5) | 0;
      if (k < 0) k = 0; else if (k > 16) k = 16;
      return r[k];
    }
  };
}

// --- factory ----------------------------------------------------------------

/**
 * Build a juice layer.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=520]      canvas width in css pixels
 * @param {number} [opts.height=620]     canvas height in css pixels
 * @param {number} [opts.floorY]         y of the swarm line; debris settles here
 * @param {number} [opts.shake=1]        screen shake multiplier, 0 disables it
 * @param {number} [opts.particles=1]    particle density multiplier, 0..1
 * @param {string} [opts.trailColor]     ball trail color, defaults to swarm cyan
 * @param {boolean} [opts.reducedMotion] force motion damping on or off
 * @param {number} [opts.seed]           rng seed, for reproducible captures
 */
export function createJuice(opts) {
  const o = opts || {};
  const pal = createPalette();

  let W = o.width > 0 ? o.width : 520;
  let H = o.height > 0 ? o.height : 620;
  let floorY = o.floorY > 0 ? o.floorY : H - 54;

  const shakeScale = o.shake === undefined ? 1 : Math.max(0, o.shake);
  let density = o.particles === undefined ? 1 : Math.min(1, Math.max(0, o.particles));
  let trailSlot = pal.slot(o.trailColor || SWARM);

  // Players who ask the system for less motion get the readout without the
  // camera movement: shake off, particles thinned, everything still visible.
  let reduced = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotion();
  if (reduced) density *= 0.55;

  // Deterministic noise. Cheaper than Math.random and makes captures repeatable.
  let rs = (o.seed >>> 0) || 0x9e3779b9;
  function rnd() {
    rs ^= rs << 13; rs >>>= 0;
    rs ^= rs >>> 17;
    rs ^= rs << 5; rs >>>= 0;
    return rs / 4294967296;
  }
  function spread(a) { return (rnd() * 2 - 1) * a; }

  // Emitters take coordinates straight from the simulation. A non-finite one
  // would poison a pooled slot for the rest of the run, so it is dropped here.
  function place(x, y) { return Number.isFinite(x) && Number.isFinite(y); }

  // --- pools (struct of arrays, fixed slots, round robin recycling) ---------

  const tX = new Float32Array(CAP.trail), tY = new Float32Array(CAP.trail);
  const tVX = new Float32Array(CAP.trail), tVY = new Float32Array(CAP.trail);
  const tLife = new Float32Array(CAP.trail), tTtl = new Float32Array(CAP.trail);
  const tSize = new Float32Array(CAP.trail);
  let tW = 0;

  const kX = new Float32Array(CAP.spark), kY = new Float32Array(CAP.spark);
  const kVX = new Float32Array(CAP.spark), kVY = new Float32Array(CAP.spark);
  const kLife = new Float32Array(CAP.spark), kTtl = new Float32Array(CAP.spark);
  const kSlot = new Int32Array(CAP.spark);
  const kSlotCount = new Int32Array(CAP.color);
  let kW = 0;

  const dX = new Float32Array(CAP.debris), dY = new Float32Array(CAP.debris);
  const dVX = new Float32Array(CAP.debris), dVY = new Float32Array(CAP.debris);
  const dRot = new Float32Array(CAP.debris), dVR = new Float32Array(CAP.debris);
  const dLife = new Float32Array(CAP.debris), dTtl = new Float32Array(CAP.debris);
  const dSize = new Float32Array(CAP.debris);
  const dShape = new Int32Array(CAP.debris), dSlot = new Int32Array(CAP.debris);
  let dW = 0;

  const nX = new Float32Array(CAP.number), nY = new Float32Array(CAP.number);
  const nVX = new Float32Array(CAP.number), nVY = new Float32Array(CAP.number);
  const nLife = new Float32Array(CAP.number), nTtl = new Float32Array(CAP.number);
  const nVal = new Float32Array(CAP.number), nPop = new Float32Array(CAP.number);
  const nSlot = new Int32Array(CAP.number);
  const nText = new Array(CAP.number).fill('');
  const nFixed = new Uint8Array(CAP.number); // 1 = label text, never re-numbered
  let nW = 0;

  const rX = new Float32Array(CAP.ring), rY = new Float32Array(CAP.ring);
  const rR0 = new Float32Array(CAP.ring), rR1 = new Float32Array(CAP.ring);
  const rLife = new Float32Array(CAP.ring), rTtl = new Float32Array(CAP.ring);
  const rWidth = new Float32Array(CAP.ring);
  const rSlot = new Int32Array(CAP.ring);
  let rW = 0;

  // --- continuous state ----------------------------------------------------

  let clock = 0;            // seconds since start, drives the shake oscillator
  let overlayDone = false;  // guards against drawing the overlay twice per frame
  let saveDepth = 0;

  let shakeEnergy = 0;      // 0..1, saturating so more hits never means more chaos
  let shakeDirX = 0, shakeDirY = 0;
  let shakeX = 0, shakeY = 0;

  let flash = 0, flashSlot = S_INK;   // full-screen additive bloom, capped low
  let chroma = 0;                     // milestone channel split, 0..1

  let bannerText = '';
  let bannerLife = 0;
  const BANNER_TTL = 1.5;

  let swarmN = 1;             // last reported swarm size
  let milestoneMark = 0;      // highest power of ten already announced
  let trailStride = 1;        // 1 in N balls leaves a trail this frame
  let trailCalls = 0;
  let trailLen = 0.30;        // trail lifetime in seconds, shrinks with the swarm
  let trailPx = 2.2;          // trail stamp size, shrinks with the swarm

  let hitBudget = BUDGET.hit;
  let destroyBudget = BUDGET.destroy;

  // Built once from the drawing context the first time the pulse fires, and
  // rebuilt on resize. Gradients are objects, so they never get made in a loop.
  let gradL = null, gradR = null;

  let letterSpacingChecked = false, hasLetterSpacing = false;

  // --- spawn helpers (no allocation, round robin over fixed slots) ----------

  function spawnTrail(x, y, vx, vy) {
    const i = tW; tW = tW + 1 >= CAP.trail ? 0 : tW + 1;
    tX[i] = x; tY[i] = y;
    tVX[i] = vx * 0.06; tVY[i] = vy * 0.06;
    tTtl[i] = tLife[i] = trailLen;
    tSize[i] = trailPx;
  }

  function spawnSpark(x, y, vx, vy, ttl, slot) {
    const i = kW; kW = kW + 1 >= CAP.spark ? 0 : kW + 1;
    kX[i] = x; kY[i] = y; kVX[i] = vx; kVY[i] = vy;
    kTtl[i] = kLife[i] = ttl;
    kSlot[i] = slot;
    // Counted here as well as in update() so a spark drawn on the same frame it
    // was emitted is not skipped by the per-color batching below.
    kSlotCount[slot]++;
  }

  function spawnDebris(x, y, vx, vy, size, slot) {
    const i = dW; dW = dW + 1 >= CAP.debris ? 0 : dW + 1;
    dX[i] = x; dY[i] = y; dVX[i] = vx; dVY[i] = vy;
    dRot[i] = rnd() * 6.283;
    dVR[i] = spread(9);
    dTtl[i] = dLife[i] = 0.55 + rnd() * 0.55;
    dSize[i] = size;
    dShape[i] = (rnd() * SHARDS.length) | 0;
    dSlot[i] = slot;
  }

  function spawnRing(x, y, r0, r1, ttl, width, slot) {
    const i = rW; rW = rW + 1 >= CAP.ring ? 0 : rW + 1;
    rX[i] = x; rY[i] = y; rR0[i] = r0; rR1[i] = r1;
    rTtl[i] = rLife[i] = ttl;
    rWidth[i] = width; rSlot[i] = slot;
  }

  /** Format once on change so draw() never builds a string. */
  function formatValue(v) {
    return v >= 10000 ? ((v / 1000) | 0) + 'k' : String(v | 0);
  }

  function spawnNumber(x, y, value, vx, vy, ttl, label, slot) {
    const i = nW; nW = nW + 1 >= CAP.number ? 0 : nW + 1;
    nX[i] = x; nY[i] = y; nVX[i] = vx; nVY[i] = vy;
    nTtl[i] = nLife[i] = ttl;
    nVal[i] = value; nPop[i] = 1.3;
    if (label) { nText[i] = label; nFixed[i] = 1; nSlot[i] = slot; }
    else { nText[i] = formatValue(value); nFixed[i] = 0; nSlot[i] = -1; }
    return i;
  }

  /**
   * Saturating shake. Each kick closes a fraction of the remaining headroom,
   * so forty hits in one frame land barely harder than four - the curve stays
   * inside a readable range no matter how large the swarm gets.
   */
  function kick(power, dx, dy) {
    if (shakeScale === 0 || reduced) return;
    const p = Math.min(0.6, power);
    shakeEnergy = shakeEnergy + p * (1 - shakeEnergy);
    if (shakeEnergy > 1) shakeEnergy = 1;
    if (dx || dy) {
      const m = Math.sqrt(dx * dx + dy * dy) || 1;
      const w = p * 2.2;
      shakeDirX += (dx / m - shakeDirX) * Math.min(1, w);
      shakeDirY += (dy / m - shakeDirY) * Math.min(1, w);
    }
  }

  function addFlash(amount, slot) {
    flash = flash + amount * (1 - flash);
    if (flash > 1) flash = 1;
    flashSlot = slot;
  }

  // --- public: emitters ----------------------------------------------------

  /** A ball damaged a block. nx,ny is the impact direction and may be omitted. */
  function hit(x, y, damage, nx, ny) {
    if (!place(x, y)) return;
    const dmg = damage > 0 ? damage : 1;

    // Roll the number into a live one nearby instead of stacking a new label on
    // top of it. Without this, a large swarm buries the field in text.
    let merged = -1;
    for (let i = 0; i < CAP.number; i++) {
      if (nLife[i] <= 0 || nFixed[i]) continue;
      if (nLife[i] < nTtl[i] - 0.32) continue;
      const ddx = nX[i] - x, ddy = nY[i] - y;
      if (ddx * ddx + ddy * ddy < 420) { merged = i; break; }
    }
    if (merged >= 0) {
      nVal[merged] += dmg;
      nText[merged] = formatValue(nVal[merged]);
      nPop[merged] = 1.28;
      nLife[merged] = Math.min(nTtl[merged], nLife[merged] + 0.1);
      nVY[merged] = -42;
    } else {
      spawnNumber(x, y - 4, dmg, spread(10), -42, 0.78, null, -1);
    }

    kick(0.045 + Math.min(0.09, dmg * 0.006), nx || 0, ny || -1);

    if (hitBudget <= 0 || density <= 0) return;
    hitBudget--;

    let ux = nx || 0, uy = ny || 0;
    if (ux === 0 && uy === 0) { ux = spread(1); uy = -0.7; }
    const base = Math.atan2(uy, ux);
    const n = 2 + ((rnd() * 2 * density) | 0);
    for (let i = 0; i < n; i++) {
      const a = base + spread(1.05);
      const sp = 70 + rnd() * 140;
      spawnSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.1 + rnd() * 0.1, S_INK);
    }
    spawnRing(x, y, 2, 11, 0.16, 2, S_INK);
  }

  /**
   * A block broke. color is the block's own fill so the shards read as that
   * material; nx,ny is the impact direction the debris inherits.
   */
  function destroy(x, y, color, nx, ny) {
    if (!place(x, y)) return;
    const slot = pal.slot(color || '#2a3040');
    addFlash(0.34, slot);
    kick(0.13, nx || 0, ny || -1);

    spawnRing(x, y, 4, 30, 0.30, 2.5, slot);
    spawnRing(x, y, 2, 17, 0.20, 1.5, S_INK);

    if (destroyBudget <= 0 || density <= 0) {
      // Past the budget the break still flashes and shakes, it just does not
      // add another two dozen shards to a frame that is already full.
      return;
    }
    destroyBudget--;

    let ux = nx || 0, uy = ny || 0;
    if (ux === 0 && uy === 0) { ux = spread(0.6); uy = -1; }
    const base = Math.atan2(uy, ux);
    const shards = Math.max(4, (9 * density) | 0);
    for (let i = 0; i < shards; i++) {
      // Half the shards follow the impact, half scatter: the break reads as
      // directional without looking like a fan.
      const a = i % 2 === 0 ? base + spread(0.9) : rnd() * 6.283;
      const sp = 55 + rnd() * 150;
      spawnDebris(x + spread(6), y + spread(6), Math.cos(a) * sp, Math.sin(a) * sp - 45, 3 + rnd() * 4.5, slot);
    }
    const sparks = Math.max(3, (7 * density) | 0);
    for (let i = 0; i < sparks; i++) {
      const a = base + spread(1.4);
      const sp = 120 + rnd() * 220;
      spawnSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.12 + rnd() * 0.14, i % 3 === 0 ? S_INK : slot);
    }
  }

  /**
   * A pickup was collected. kind is 'ball', 'gold' or any string; amount is
   * optional and shows as a rising label when given.
   */
  function pickup(x, y, kind, amount) {
    if (!place(x, y)) return;
    const slot = kind === 'gold' ? S_GOLD : kind === 'hot' ? S_HOT : S_SWARM;
    addFlash(0.4, slot);
    kick(0.1, 0, -1);

    spawnRing(x, y, 3, 34, 0.36, 2.5, slot);
    spawnRing(x, y, 1, 15, 0.18, 1.5, S_INK);

    if (amount > 0) {
      spawnNumber(x, y - 12, amount, 0, -50, 1.0, '+' + formatValue(amount), slot);
    }

    if (density <= 0) return;
    const n = Math.max(5, (13 * density) | 0);
    for (let i = 0; i < n; i++) {
      // Even fan, jittered: a burst rather than a spray.
      const a = (i / n) * 6.283 + spread(0.25);
      const sp = 90 + rnd() * 170;
      spawnSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.18 + rnd() * 0.16, slot);
    }
  }

  /** The swarm launched. dx,dy is the aim direction and may be omitted. */
  function launch(x, y, dx, dy) {
    if (!place(x, y)) return;
    kick(0.06, 0, 1);
    spawnRing(x, y, 3, 26, 0.28, 2, S_SWARM);
    if (density <= 0) return;
    let ux = dx || 0, uy = dy || 0;
    if (ux === 0 && uy === 0) { ux = 0; uy = -1; }
    const base = Math.atan2(uy, ux);
    const n = Math.max(3, (7 * density) | 0);
    for (let i = 0; i < n; i++) {
      const a = base + spread(0.55);
      const sp = 130 + rnd() * 190;
      spawnSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.14 + rnd() * 0.12, S_SWARM);
    }
  }

  /**
   * A live ball's position this frame. Call once per ball per frame; the layer
   * thins the trail on its own as the swarm grows, so hundreds of balls stay
   * legible as texture instead of smearing into a single wash.
   */
  function trail(x, y, vx, vy) {
    trailCalls++;
    if (density <= 0 || !place(x, y)) return;
    if (trailStride > 1 && trailCalls % trailStride !== 0) return;
    spawnTrail(x, y, vx || 0, vy || 0);
  }

  /**
   * Report the current swarm size. Drives trail density and fires the
   * milestone pulse automatically when the count crosses a power of ten.
   */
  function swarm(n) {
    const v = n > 0 ? n | 0 : 0;
    if (v > swarmN) {
      let mark = 10;
      while (mark <= v) {
        if (mark > milestoneMark) { milestoneMark = mark; milestone('swarm ' + mark); }
        mark *= 10;
      }
    }
    swarmN = v;
  }

  /**
   * Announce a threshold: a short banner plus a chromatic pulse across the
   * field. Text is uppercased and clipped; keep it to a few words.
   */
  function milestone(text) {
    bannerText = String(text == null ? '' : text).toUpperCase().slice(0, 26);
    bannerLife = BANNER_TTL;
    chroma = 1;
    addFlash(0.5, S_SWARM);
    kick(0.18, 0, -1);
    spawnRing(W / 2, H * 0.34, 10, Math.max(W, H) * 0.7, 0.7, 1.5, S_SWARM);
  }

  // --- public: frame -------------------------------------------------------

  /**
   * Advance every effect. dt is seconds; a millisecond value is detected and
   * converted, and a long stall is clamped so nothing teleports on tab return.
   */
  function update(dt) {
    let d = dt;
    if (!(d > 0)) d = 1 / 60;
    if (d > 1) d = d / 1000;
    if (d > 0.05) d = 0.05;

    clock += d;
    hitBudget = BUDGET.hit;
    destroyBudget = BUDGET.destroy;

    // Trail density from the swarm size seen last frame. One stamp per ball is
    // right at 1 ball and unreadable at 400, so the stride climbs and the
    // stamps get shorter and smaller as the mass grows.
    const seen = Math.max(swarmN, trailCalls, 1);
    trailStride = Math.max(1, Math.ceil(seen / 48));
    trailLen = Math.min(0.32, Math.max(0.07, 0.32 * Math.sqrt(24 / Math.max(24, seen))));
    trailPx = seen > 120 ? 1 : seen > 40 ? 1.6 : 2.2;
    trailCalls = 0;

    const damp = Math.exp(-3.2 * d);

    for (let i = 0; i < CAP.trail; i++) {
      if (tLife[i] <= 0) continue;
      tLife[i] -= d;
      tX[i] += tVX[i]; tY[i] += tVY[i];
    }

    kSlotCount.fill(0);
    for (let i = 0; i < CAP.spark; i++) {
      if (kLife[i] <= 0) continue;
      kLife[i] -= d;
      if (kLife[i] <= 0) continue;
      kX[i] += kVX[i] * d; kY[i] += kVY[i] * d;
      kVX[i] *= damp; kVY[i] = kVY[i] * damp + 210 * d;
      kSlotCount[kSlot[i]]++;
    }

    for (let i = 0; i < CAP.debris; i++) {
      if (dLife[i] <= 0) continue;
      dLife[i] -= d;
      if (dLife[i] <= 0) continue;
      dX[i] += dVX[i] * d; dY[i] += dVY[i] * d;
      dVX[i] *= damp; dVY[i] = dVY[i] * damp + 620 * d;
      dRot[i] += dVR[i] * d;
      // Shards settle on the swarm line rather than raining past it.
      if (dY[i] > floorY) { dY[i] = floorY; dVY[i] = -dVY[i] * 0.32; dVX[i] *= 0.65; dVR[i] *= 0.5; }
    }

    for (let i = 0; i < CAP.number; i++) {
      if (nLife[i] <= 0) continue;
      nLife[i] -= d;
      if (nLife[i] <= 0) continue;
      nX[i] += nVX[i] * d; nY[i] += nVY[i] * d;
      nVX[i] *= damp; nVY[i] *= Math.exp(-2.6 * d);
      nPop[i] += (1 - nPop[i]) * Math.min(1, 14 * d);
    }

    for (let i = 0; i < CAP.ring; i++) {
      if (rLife[i] <= 0) continue;
      rLife[i] -= d;
    }

    // Shake: a damped two-frequency wobble around the impact direction, not
    // per-frame random jitter. Random jitter at this amplitude reads as a
    // broken display; a decaying wobble reads as force.
    shakeEnergy *= Math.exp(-d / 0.105);
    if (shakeEnergy < 0.002) { shakeEnergy = 0; shakeX = 0; shakeY = 0; }
    else {
      const amp = SHAKE_MAX * shakeScale * Math.pow(shakeEnergy, 1.25);
      const ox = shakeDirX * 0.55 + 0.45 * Math.sin(clock * 54.0);
      const oy = shakeDirY * 0.55 + 0.45 * Math.sin(clock * 41.3 + 1.1);
      shakeX = Math.round(ox * amp);
      shakeY = Math.round(oy * amp);
    }

    flash *= Math.exp(-d / 0.09);
    if (flash < 0.004) flash = 0;

    chroma -= d / 0.75;
    if (chroma < 0) chroma = 0;

    if (bannerLife > 0) bannerLife -= d;
  }

  /**
   * Save the context and apply screen shake. Call before the game draws its
   * field; pair it with end(). Optional - skip both and nothing shakes.
   */
  function begin(ctx) {
    if (!ctx) return;
    overlayDone = false;
    ctx.save();
    saveDepth++;
    if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
  }

  /**
   * Restore the context saved by begin() and run the full-screen pass. Safe to
   * call without begin(); the overlay draws at most once per update.
   */
  function end(ctx) {
    if (!ctx) return;
    if (saveDepth > 0) { ctx.restore(); saveDepth--; }
    drawOverlay(ctx);
  }

  /**
   * Draw the world-space effects: trails, rings, debris, sparks, numbers.
   * Call after the game's own field draw, inside begin()/end().
   */
  function draw(ctx) {
    if (!ctx) return;
    overlayDone = false;
    ctx.save();

    // Trails and sparks are additive so they read as light against the field
    // regardless of what is drawn underneath them.
    ctx.globalCompositeOperation = 'lighter';

    // Trails in five alpha bands: one fill color per band instead of one per
    // particle keeps five hundred stamps down to five state changes.
    for (let b = 4; b >= 0; b--) {
      const lo = b / 5, hi = (b + 1) / 5;
      let opened = false;
      for (let i = 0; i < CAP.trail; i++) {
        const l = tLife[i];
        if (l <= 0) continue;
        const f = l / tTtl[i];
        if (f < lo || f >= hi) continue;
        if (!opened) { ctx.fillStyle = pal.shade(trailSlot, 0.06 + 0.34 * hi); opened = true; }
        const s = tSize[i] * (0.5 + 0.5 * f);
        ctx.fillRect(tX[i] - s * 0.5, tY[i] - s * 0.5, s, s);
      }
    }

    // Rings: expanding outlines, thinning as they go.
    for (let i = 0; i < CAP.ring; i++) {
      const l = rLife[i];
      if (l <= 0) continue;
      const f = l / rTtl[i];
      // Eased outward: fast at the moment of impact, easing as it thins out.
      const rad = rR0[i] + (rR1[i] - rR0[i]) * (1 - f * f);
      ctx.strokeStyle = pal.shade(rSlot[i], 0.55 * f);
      ctx.lineWidth = Math.max(0.5, rWidth[i] * f);
      ctx.beginPath();
      ctx.arc(rX[i], rY[i], rad, 0, 6.28318);
      ctx.stroke();
    }

    // Sparks: one path per active color and brightness band. Fade is carried
    // by streak length as well as alpha, so they shrink out instead of blinking.
    for (let s = 0; s < CAP.color; s++) {
      if (kSlotCount[s] === 0) continue;
      for (let band = 0; band < 2; band++) {
        const lo = band === 0 ? 0.5 : 0, hi = band === 0 ? 1.01 : 0.5;
        ctx.strokeStyle = pal.shade(s, band === 0 ? 0.9 : 0.4);
        ctx.lineWidth = band === 0 ? 1.4 : 1;
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < CAP.spark; i++) {
          if (kLife[i] <= 0 || kSlot[i] !== s) continue;
          const f = kLife[i] / kTtl[i];
          if (f < lo || f >= hi) continue;
          const k = 0.004 + 0.018 * f;
          ctx.moveTo(kX[i], kY[i]);
          ctx.lineTo(kX[i] - kVX[i] * k, kY[i] - kVY[i] * k);
          any = true;
        }
        if (any) ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    // Debris: rotated polygons built from unit shapes, transformed by hand so
    // no per-shard save/restore is needed.
    let lastFill = '';
    for (let i = 0; i < CAP.debris; i++) {
      const l = dLife[i];
      if (l <= 0) continue;
      const f = l / dTtl[i];
      const pts = SHARDS[dShape[i]];
      const c = Math.cos(dRot[i]), sn = Math.sin(dRot[i]);
      const sz = dSize[i] * (0.35 + 0.65 * f);
      const x = dX[i], y = dY[i];
      // Freshly broken material glows before it cools to the block's own color.
      const fill = f > 0.78 ? pal.shade(S_INK, 0.9) : pal.shade(dSlot[i], Math.min(1, f * 1.35));
      if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
      ctx.beginPath();
      for (let p = 0; p < pts.length; p += 2) {
        const px = pts[p] * sz, py = pts[p + 1] * sz;
        const wx = x + px * c - py * sn, wy = y + px * sn + py * c;
        if (p === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Damage numbers last, on top of everything, in the monospace stack so the
    // digits share a fixed advance and stacked values line up column by column.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < CAP.number; i++) {
      const l = nLife[i];
      if (l <= 0 || nText[i] === '') continue;
      const f = l / nTtl[i];
      let a = (1 - f) / 0.08;
      const out = f / 0.45;
      if (out < a) a = out;
      if (a > 1) a = 1;
      if (a <= 0.02) continue;

      const v = nVal[i];
      let tier = nFixed[i] ? 1 : v < 3 ? 0 : v < 10 ? 1 : v < 40 ? 2 : 3;
      const slot = nFixed[i] ? nSlot[i] : NUM_SLOTS[tier];
      const pop = nPop[i];
      if (pop > 1.02) tier = Math.min(3, tier + 1);
      ctx.font = NUM_FONTS[tier];

      const x = nX[i], y = nY[i];
      // A one pixel backdrop keeps the value readable over a bright block.
      if (a > 0.3) {
        ctx.fillStyle = pal.shade(S_BG, a * 0.75);
        ctx.fillText(nText[i], x + 1, y + 1);
      }
      ctx.fillStyle = pal.shade(slot, a);
      ctx.fillText(nText[i], x, y);
    }

    ctx.restore();
  }

  /**
   * The full-screen pass: impact bloom, milestone channel split, banner.
   * end() calls this; call it directly only if you are not using begin()/end().
   * Drawing it twice in one frame is a no-op, so both routes are safe, and a
   * repaint with no update in between still shows it.
   */
  function drawOverlay(ctx) {
    if (!ctx || overlayDone) return;
    overlayDone = true;
    if (flash <= 0 && chroma <= 0 && bannerLife <= 0) return;

    ctx.save();

    if (flash > 0) {
      // Capped hard at a whisper. A bright full-screen flash on every break is
      // unusable once the swarm is large.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pal.shade(flashSlot, flash * 0.055);
      ctx.fillRect(0, 0, W, H);
    }

    if (chroma > 0) {
      // Channel split at the edges: the frame reads as briefly mis-registered
      // without touching pixel data or costing a second render pass.
      buildGradients(ctx);
      if (gradL) {
        const c = chroma * chroma;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.13 * c;
        ctx.fillStyle = gradL; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = gradR; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    if (bannerLife > 0 && bannerText) {
      drawBanner(ctx);
    }

    ctx.restore();
  }

  function drawBanner(ctx) {
    const f = bannerLife / BANNER_TTL;
    let a = (1 - f) / 0.09;             // snap in
    const out = f / 0.35;               // long fade out
    if (out < a) a = out;
    if (a > 1) a = 1;
    if (a <= 0.01) return;

    const y = Math.round(H * 0.34);
    const rise = (1 - Math.min(1, (1 - f) / 0.18)) * 8;

    ctx.globalCompositeOperation = 'source-over';
    if (!letterSpacingChecked) {
      letterSpacingChecked = true;
      hasLetterSpacing = 'letterSpacing' in ctx;
    }
    if (hasLetterSpacing) ctx.letterSpacing = '0.24em';
    ctx.font = '600 13px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const w = Math.max(120, ctx.measureText(bannerText).width + 44);

    // Backing plate so the banner stays legible over a dense field.
    ctx.fillStyle = pal.shade(S_BG, a * 0.8);
    ctx.fillRect((W - w) / 2, y - 15 + rise, w, 30);

    // Rules wiping outward from center carry the moment without motion blur.
    const wipe = Math.min(1, (1 - f) / 0.22);
    const half = (w / 2) * wipe;
    ctx.strokeStyle = pal.shade(S_SWARM, a * 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - half, y - 15.5 + rise); ctx.lineTo(W / 2 + half, y - 15.5 + rise);
    ctx.moveTo(W / 2 - half, y + 14.5 + rise); ctx.lineTo(W / 2 + half, y + 14.5 + rise);
    ctx.stroke();

    // While the pulse is live the text is split into its channels, then settles.
    const off = chroma * 2.4;
    if (off > 0.15) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pal.shade(S_HOT, a * 0.45);
      ctx.fillText(bannerText, W / 2 - off, y + rise);
      ctx.fillStyle = pal.shade(S_SWARM, a * 0.45);
      ctx.fillText(bannerText, W / 2 + off, y + rise);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = pal.shade(S_INK, a);
    ctx.fillText(bannerText, W / 2, y + rise);

    if (hasLetterSpacing) ctx.letterSpacing = '0px';
  }

  function buildGradients(ctx) {
    if (gradL || !ctx || !ctx.createLinearGradient) return;
    gradL = ctx.createLinearGradient(0, 0, W * 0.42, 0);
    gradL.addColorStop(0, SWARM);
    gradL.addColorStop(1, 'rgba(90,209,255,0)');
    gradR = ctx.createLinearGradient(W, 0, W * 0.58, 0);
    gradR.addColorStop(0, HOT);
    gradR.addColorStop(1, 'rgba(255,92,70,0)');
  }

  function prefersReducedMotion() {
    try {
      return typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
    } catch (e) { return false; }
  }

  // --- public: control -----------------------------------------------------

  /** Drop every live effect. Call on restart so nothing bleeds into a new run. */
  function clear() {
    tLife.fill(0); kLife.fill(0); dLife.fill(0); nLife.fill(0); rLife.fill(0);
    kSlotCount.fill(0);
    tW = kW = dW = nW = rW = 0;
    shakeEnergy = 0; shakeX = 0; shakeY = 0; shakeDirX = 0; shakeDirY = 0;
    flash = 0; chroma = 0;
    bannerLife = 0; bannerText = '';
    swarmN = 1; milestoneMark = 0;
    trailCalls = 0; trailStride = 1;
    for (let i = 0; i < CAP.number; i++) { nText[i] = ''; nFixed[i] = 0; }
  }

  /** Match a new canvas size. floorY is optional and defaults to height - 54. */
  function resize(width, height, newFloorY) {
    if (width > 0) W = width;
    if (height > 0) H = height;
    floorY = newFloorY > 0 ? newFloorY : H - 54;
    gradL = null; gradR = null;   // rebuilt against the new width on next pulse
  }

  /** Turn motion damping on or off at runtime. */
  function setReducedMotion(on) {
    reduced = !!on;
    if (reduced) { shakeEnergy = 0; shakeX = 0; shakeY = 0; }
  }

  /** Particle density multiplier, 0 (off) to 1 (full). */
  function setDensity(v) { density = Math.min(1, Math.max(0, v)); }

  /** Recolor the ball trail, for example when the swarm changes state. */
  function setTrailColor(css) { trailSlot = pal.slot(css); }

  /** Live counts, for a debug readout. Not for use in the frame loop. */
  function stats() {
    let t = 0, k = 0, d = 0, n = 0, r = 0;
    for (let i = 0; i < CAP.trail; i++) if (tLife[i] > 0) t++;
    for (let i = 0; i < CAP.spark; i++) if (kLife[i] > 0) k++;
    for (let i = 0; i < CAP.debris; i++) if (dLife[i] > 0) d++;
    for (let i = 0; i < CAP.number; i++) if (nLife[i] > 0) n++;
    for (let i = 0; i < CAP.ring; i++) if (rLife[i] > 0) r++;
    return {
      trails: t, sparks: k, debris: d, numbers: n, rings: r,
      shake: shakeEnergy, chroma, flash, stride: trailStride, swarm: swarmN
    };
  }

  return {
    // frame
    update, begin, draw, end, drawOverlay,
    // emitters
    hit, destroy, pickup, launch, trail, swarm, milestone,
    // control
    clear, resize, setReducedMotion, setDensity, setTrailColor, stats,
    // current shake offset in whole pixels, if the caller wants to apply it itself
    get shakeX() { return shakeX; },
    get shakeY() { return shakeY; }
  };
}

export default createJuice;
