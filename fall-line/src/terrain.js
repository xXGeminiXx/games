// ---------------------------------------------------------------------------
// The ground.
//
// A field of integer heights with two fixed regions: the snowline in the far
// corner, where the Melt comes down from, and the hearth block near the other
// corner, which it is trying to reach. Neither can be sculpted or built on.
// Everything between them is the player's to raise and to cut.
//
// The natural field is a seeded slope with smooth noise on it, a couple of
// ridges lying across the slope, and one shallow channel winding down from the
// snowline to the hearth. Every ridge is left with a gap wide enough to walk
// through, so the first road down is obvious and nothing is ever sealed off.
// Everything here is a function of the seed alone, so the same seed always
// grows the same field.
// ---------------------------------------------------------------------------

import { hash, unit, range } from './rng.js?v=11';

/** What a cell is. Ground is the only kind that may be changed. */
export const KIND = { ground: 0, snowline: 1, hearth: 2 };

// Shape constants for the generator. These are not turned during play, so they
// stay here rather than in the configuration.
const RIDGE_ROWS = 2;     // an anti-diagonal one cell wide can be squeezed past
const RIDGE_GAP = 4;      // cells of ridge left out, so there is a way through
const CHANNEL_HALF = 2.2; // half width of the channel, in x - y units
const CHANNEL_WOBBLE = 8; // how far the channel wanders sideways, same units
const BASIN = 1;          // the ring around the hearth is held no higher
const TAU = Math.PI * 2;


// ---------------------------------------------------------------------------
// BUILDING A FIELD
// ---------------------------------------------------------------------------

/**
 * A field of heights for a seed. A number seed is used as it stands; anything
 * else is hashed, so a word works as well as a number.
 */
export function createTerrain(cfg, seed) {
  const W = Math.max(1, cfg.terrain.cols | 0);
  const H = Math.max(1, cfg.terrain.rows | 0);
  const n = W * H;
  const s = normalizeSeed(seed);

  const t = {
    W, H,
    h: new Uint8Array(n),
    kind: new Uint8Array(n),
    snowline: [],
    hearth: [],
    hearthCenter: { x: 0, y: 0 },
    snowCenter: { x: 0, y: 0 },
    seed: s,
    version: 1,
    // The ceiling travels with the field so a height change can be checked
    // without the configuration in hand.
    maxHeight: Math.max(0, cfg.terrain.maxHeight | 0),
  };

  // Built in one continuous surface first, then rounded, so the pieces add up
  // before anything is lost to the integer grid.
  const raw = new Float32Array(n);
  addSlope(raw, t, cfg);
  addNoise(raw, t, cfg, s);
  addRidges(raw, t, cfg, s);
  cutChannel(raw, t, cfg, s);
  settle(raw, t, cfg);

  stampSnowline(t, cfg);
  stampHearth(t, cfg);
  sinkBasin(t);
  return t;
}

function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return hash(0x5a17, String(seed));
}

/** The fall of the land, measured along the diagonal the Melt travels. */
function addSlope(raw, t, cfg) {
  const W = t.W, H = t.H;
  const span = Math.max(1, (W - 1) + (H - 1));
  const top = cfg.terrain.gen.slopeTop;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      raw[y * W + x] = top * (1 - (x + y) / span);
    }
  }
}

/**
 * Smooth value noise: seeded values on a coarse lattice, read back with
 * bilinear interpolation. The lattice is small enough to build up front, so
 * the per-cell work is four reads and three lerps.
 */
function addNoise(raw, t, cfg, seed) {
  const W = t.W, H = t.H;
  const amp = cfg.terrain.gen.noise;
  const scale = cfg.terrain.gen.noiseScale;
  if (!(amp > 0) || !(scale > 0)) return;

  const lw = Math.floor((W - 1) / scale) + 2;
  const lh = Math.floor((H - 1) / scale) + 2;
  const lat = new Float32Array(lw * lh);
  for (let gy = 0; gy < lh; gy++) {
    for (let gx = 0; gx < lw; gx++) {
      lat[gy * lw + gx] = unit(seed, 'n:' + gx + ',' + gy) * 2 - 1;
    }
  }

  for (let y = 0; y < H; y++) {
    const gy = y / scale;
    const y0 = Math.min(lh - 2, Math.floor(gy));
    const fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = x / scale;
      const x0 = Math.min(lw - 2, Math.floor(gx));
      const fx = gx - x0;
      const r0 = y0 * lw + x0;
      const r1 = r0 + lw;
      const a = lat[r0] + (lat[r0 + 1] - lat[r0]) * fx;
      const b = lat[r1] + (lat[r1 + 1] - lat[r1]) * fx;
      raw[y * W + x] += (a + (b - a) * fy) * amp;
    }
  }
}

/**
 * Ridges lie across the slope, on lines of constant x + y, so the Melt meets
 * them head on. Each one is left with a gap: a wall with no way through would
 * only ever be climbed, and the point of a ridge is the detour.
 */
function addRidges(raw, t, cfg, seed) {
  const W = t.W, H = t.H;
  const gen = cfg.terrain.gen;
  const count = Math.max(0, gen.ridges | 0);
  if (count === 0 || !(gen.ridgeHeight > 0)) return;
  const span = (W - 1) + (H - 1);

  for (let r = 0; r < count; r++) {
    // Spread down the slope, then nudged so two seeds do not line up.
    const place = (r + 1) / (count + 1) + (unit(seed, 'ridgeAt:' + r) - 0.5) * 0.1;
    const depth = Math.round(span * Math.min(0.85, Math.max(0.15, place)));

    // One gap window serves every row of the band, so the way through is a
    // straight corridor rather than two offset notches, and it is taken from
    // where the rows overlap so that ridge stands on both sides of it.
    const gapLo = Math.max(0, depth + RIDGE_ROWS - 1 - (H - 1)) + 1;
    const gapHi = Math.min(W - 1, depth) - RIDGE_GAP;
    const gapAt = gapHi >= gapLo
      ? gapLo + Math.floor(unit(seed, 'ridgeGap:' + r) * (gapHi - gapLo + 1))
      : gapLo;

    for (let row = 0; row < RIDGE_ROWS; row++) {
      const s = depth + row;
      const lo = Math.max(0, s - (H - 1));
      const hi = Math.min(W - 1, s);
      for (let x = lo; x <= hi; x++) {
        if (x >= gapAt && x < gapAt + RIDGE_GAP) continue;
        raw[(s - x) * W + x] += gen.ridgeHeight;
      }
    }
  }
}

/**
 * One shallow channel, wandering from the snowline down to the hearth. It is
 * what makes a fresh field read as somewhere water already runs.
 */
function cutChannel(raw, t, cfg, seed) {
  const W = t.W, H = t.H;
  const depth = cfg.terrain.gen.channelDepth;
  if (!(depth > 0)) return;

  const sFrom = Math.max(0, (cfg.terrain.snowlineDepth | 0) + 1);
  const sTo = Math.max(0, (W - 4)) + Math.max(0, (H - 4));
  if (sTo <= sFrom) return;

  // It starts under the middle of the snowline and finishes under the hearth.
  const uFrom = 0;
  const uTo = Math.max(0, W - 4) - Math.max(0, H - 4);
  const f1 = range(seed, 'chan:f1', 0.7, 1.6);
  const f2 = range(seed, 'chan:f2', 1.9, 3.4);
  const p1 = range(seed, 'chan:p1', 0, TAU);
  const p2 = range(seed, 'chan:p2', 0, TAU);

  for (let s = sFrom; s <= sTo; s++) {
    const p = (s - sFrom) / (sTo - sFrom);
    // The wander fades out at both ends so the channel still meets the
    // snowline and the hearth where it is meant to.
    const fade = Math.sin(Math.PI * p);
    const centre = uFrom + (uTo - uFrom) * p + fade * CHANNEL_WOBBLE *
      (Math.sin(p * TAU * f1 + p1) * 0.65 + Math.sin(p * TAU * f2 + p2) * 0.35);
    const lo = Math.max(0, s - (H - 1));
    const hi = Math.min(W - 1, s);
    for (let x = lo; x <= hi; x++) {
      if (Math.abs((2 * x - s) - centre) <= CHANNEL_HALF) raw[(s - x) * W + x] -= depth;
    }
  }
}

/** Round the surface onto the integer grid and hold it inside its range. */
function settle(raw, t, cfg) {
  const top = Math.min(t.maxHeight, Math.max(0, cfg.terrain.gen.maxNatural | 0));
  for (let i = 0; i < raw.length; i++) {
    let v = Math.round(raw[i]);
    if (v < 0) v = 0; else if (v > top) v = top;
    t.h[i] = v;
  }
}

function stampSnowline(t, cfg) {
  const W = t.W, H = t.H;
  const depth = cfg.terrain.snowlineDepth | 0;
  const height = Math.min(t.maxHeight, Math.max(0, cfg.terrain.snowlineHeight | 0));
  let sx = 0, sy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x + y > depth) continue;
      const i = y * W + x;
      t.kind[i] = KIND.snowline;
      t.h[i] = height;
      t.snowline.push(i);
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  const c = t.snowline.length || 1;
  t.snowCenter = { x: sx / c, y: sy / c };
}

function stampHearth(t, cfg) {
  const W = t.W, H = t.H;
  const x0 = Math.max(0, W - 4), x1 = Math.max(0, W - 3);
  const y0 = Math.max(0, H - 4), y1 = Math.max(0, H - 3);
  let sx = 0, sy = 0;
  for (let y = y0; y <= y1 && y < H; y++) {
    for (let x = x0; x <= x1 && x < W; x++) {
      const i = y * W + x;
      t.kind[i] = KIND.hearth;
      t.h[i] = 0;
      t.hearth.push(i);
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  const c = t.hearth.length || 1;
  t.hearthCenter = { x: sx / c, y: sy / c };
}

/** Everything touching the hearth is held low, so it sits in a basin. */
function sinkBasin(t) {
  const W = t.W, H = t.H;
  for (const i of t.hearth) {
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (t.kind[j] !== KIND.ground) continue;
        if (t.h[j] > BASIN) t.h[j] = BASIN;
      }
    }
  }
}


// ---------------------------------------------------------------------------
// READING A FIELD
// ---------------------------------------------------------------------------

export function idx(t, x, y) {
  return y * t.W + x;
}

export function xy(t, i) {
  const x = i % t.W;
  return { x, y: (i - x) / t.W };
}

export function inBounds(t, x, y) {
  return x >= 0 && y >= 0 && x < t.W && y < t.H;
}

/** True for the snowline and the hearth: the cells nothing may change. */
export function isFixed(t, i) {
  return i < 0 || i >= t.kind.length || t.kind[i] !== KIND.ground;
}

/** The height of the cell holding a continuous world point. */
export function heightAt(t, x, y) {
  let cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0) cx = 0; else if (cx >= t.W) cx = t.W - 1;
  if (cy < 0) cy = 0; else if (cy >= t.H) cy = t.H - 1;
  return t.h[cy * t.W + cx];
}


// ---------------------------------------------------------------------------
// CHANGING A FIELD
//
// Cost and permission are separate from the change itself: the run checks
// whether it can afford the work, and only then spends and applies it.
// ---------------------------------------------------------------------------

/** Whether a cell may move one level in a direction. */
export function canSculpt(cfg, t, i, dir) {
  if (dir !== 1 && dir !== -1) return false;
  if (i < 0 || i >= t.h.length) return false;
  if (t.kind[i] !== KIND.ground) return false;
  const to = t.h[i] + dir;
  return to >= 0 && to <= cfg.terrain.maxHeight;
}

/**
 * What one level costs here. Raising gets dearer the higher the ground already
 * stands, so a tower of earth is a real spend; cutting is flat.
 */
export function sculptCost(cfg, t, i, dir) {
  if (!canSculpt(cfg, t, i, dir)) return Infinity;
  if (dir === 1) return cfg.economy.raiseBase + cfg.economy.raisePer * t.h[i];
  return cfg.economy.cutCost;
}

/** Move one cell one level. Nothing is charged here. */
export function sculpt(t, i, dir) {
  if (dir !== 1 && dir !== -1) return false;
  if (i < 0 || i >= t.h.length) return false;
  if (t.kind[i] !== KIND.ground) return false;
  const to = t.h[i] + dir;
  if (to < 0 || to > t.maxHeight) return false;
  t.h[i] = to;
  t.version++;
  return true;
}
