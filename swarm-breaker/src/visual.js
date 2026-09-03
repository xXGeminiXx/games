/**
 * Swarm Breaker - visual system.
 *
 * The look of the game: palette, block rendering, the swarm view, regime
 * atmosphere, depth, and the motion language that ties them together.
 *
 * Every pixel is generated. There are no image files, no sprite sheets, no
 * icon fonts, no webfonts and nothing fetched from anywhere. Colour is built
 * from numbers, structure is built from lines and arcs, and texture is built
 * from hashes. The whole visual identity is math the browser runs.
 *
 * Nothing here is signalled by sound. Every piece of state a player needs is
 * drawn where it can be read.
 *
 * This module holds no game logic. It never mutates a block, never decides a
 * number, never advances a turn. It takes plain data each frame and draws it.
 * The only state it keeps is presentational: animation timers, a ripple field,
 * per-block visual identity, and the strata a finished regime leaves behind.
 *
 * ---------------------------------------------------------------------------
 * WIRING
 *
 *   import { createVisual } from './src/visual.js';
 *   const vis = createVisual({ width: 520, height: 620, top: 40, floorY: 566 });
 *
 *   // once per frame, before drawing
 *   vis.setDepth(state.depth);              // triggers the descent animation
 *   vis.setSwarm(state.balls);              // number or { m, e }
 *   vis.setRegime(field.regimeAt(depth));   // straight from patterns.js
 *   vis.update(dt);                         // dt in seconds
 *
 *   // draw, back to front
 *   vis.background(ctx);
 *   vis.horizon(ctx, field.previewRows(depth + 1, 2));
 *   vis.blocks(ctx, state.rows);            // [{ c, r, hp, max, mat?, role? }]
 *   vis.pickups(ctx, state.drops);          // [{ c, r, kind, value? }]
 *   vis.aim(ctx, ox, oy, dx, dy);
 *   vis.bodies(ctx, state.live);            // [{ x, y, vx, vy, size?, stack? }]
 *   vis.launcher(ctx, state.origin, floorY);
 *   vis.swarmBand(ctx);
 *   vis.foreground(ctx);
 *
 *   // events
 *   vis.splash(x, strength);   // a body crossed back into the swarm
 *   vis.resolve();             // milestone: the mass resolves into individuals
 *   vis.clear();               // on restart
 *
 * blocks() diffs its own input frame to frame. It notices a block that moved,
 * a block that lost health and a block that vanished, and animates all three
 * without being told. Wiring it is one call.
 * ---------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js?v=19';

// ===========================================================================
// PALETTE
// ===========================================================================
//
// One rule governs the whole system:
//
//   SATURATION IS RESERVED FOR SIGNAL.
//
// The field is desaturated. Material, structure and atmosphere all live below
// about 26% chroma and below 30% lightness. The only fully saturated marks on
// screen are the ones that mean something: the swarm, value, threat, and the
// doctrine tints. A player's eye is therefore drawn to information rather than
// to decoration, and the field can be arbitrarily busy without competing.
//
// The second rule protects the most important text in the game:
//
//   NO FIELD FILL EXCEEDS 30% LIGHTNESS.
//
// Block health numerals are drawn in ink at full opacity over fills capped at
// L30, which holds a contrast ratio above 7:1 no matter what the field does.
// Threat, damage and heat colour EDGES, never fills, so nothing that happens
// to a block can make its number harder to read.

/** The token set. Six structural tones, five meanings. */
// The palette is authored in config.js so one file names every colour in the
// game. These fallbacks keep this module usable on its own, in a test harness
// or a headless run where no configuration has been loaded.
const FALLBACK_PALETTE = {
  void: '#08090c', panel: '#0e1016', rule: '#1c2029', ink: '#e6e9ef', dim: '#7a828f',
  swarm: '#5ad1ff', essence: '#ffc94a', hot: '#ff5c46',
  force: '#b98cff', trade: '#6ee7a8', tithe: '#8f9aa8',
};
const DEFAULT_PALETTE = Object.assign({}, FALLBACK_PALETTE, (CONFIG && CONFIG.palette) || {});

export const PALETTE = {
  // structure - the instrument, not the world
  void:  DEFAULT_PALETTE.void,   // the ground everything sits on
  panel: DEFAULT_PALETTE.panel,  // raised surfaces, readout backing
  rule:  DEFAULT_PALETTE.rule,   // hairlines, frames, grid
  ink:   DEFAULT_PALETTE.ink,    // anything that must be read
  dim:   DEFAULT_PALETTE.dim,    // labels, units, secondary figures

  // meaning - the only saturated colours in the game
  swarm:   DEFAULT_PALETTE.swarm,   // you: bodies, the pool, the launcher, everything yours
  essence: DEFAULT_PALETTE.essence, // value: payout, pickups, prices, yield
  hot:     DEFAULT_PALETTE.hot,     // threat: proximity to the line, breach, loss
  force:   DEFAULT_PALETTE.force,   // curvature: gravity, orbits, wells, anything that bends
  trade:   DEFAULT_PALETTE.trade,   // supply: the market, material, fills, contracts
  tithe:   DEFAULT_PALETTE.tithe,   // obligation: costs, interest, what is owed
};

/**
 * Meanings, stated so nothing drifts. A colour in this game says one thing.
 * If a new system needs a colour, it borrows the meaning or it goes without.
 */
export const MEANING = {
  swarm:   'belongs to the player',
  essence: 'is worth something',
  hot:     'is about to hurt you',
  force:   'bends a path',
  trade:   'can be bought or sold',
  tithe:   'is a cost',
};

// The four doctrine tints powers.js already publishes are the same four
// meanings above, so a doctrine never introduces a colour the field has not
// already taught. LEGION reads as swarm, MONOLITH as threat turned outward,
// FRACTURE as value, WELL as force, LEDGER as trade, TITHE as cost.

// ===========================================================================
// MATERIAL
// ===========================================================================
//
// A block's toughness is not a hue on a rainbow. It is what the block is made
// of. Seven materials climb from waste to apex, each with its own colour, its
// own surface structure and its own silhouette of internal marks - so material
// survives greyscale, colour blindness and a fast glance across a row.
//
// The ladder cycles. Past the seventh material the sequence starts again one
// GRADE higher, marked with pips in the corner, which is how an unbounded
// health curve stays readable without inventing an unbounded colour space.

/** hsl to '#rrggbb'. Runs a few dozen times at load and never again. */
function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
      if (t < 0) t += 1; else if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
  }
  const hx = v => ('0' + Math.round(v * 255).toString(16)).slice(-2);
  return '#' + hx(r) + hx(g) + hx(b);
}

/**
 * The material ladder. `sig` names the surface structure drawn inside the
 * block; `edge` is the frame tone, always a little lighter than the body so a
 * block reads as an object with an edge rather than as a coloured rectangle.
 */
export const MATERIALS = [
  // Lightness sits in 24..30 rather than 16..24. The ceiling is what protects
  // the numerals - ink against L30 still clears 7:1 - but the floor is what
  // decides whether a block is visible at all, and against a void at L3.5 the
  // old low end vanished. A field nobody can see cannot show its own geometry,
  // which is the whole reason touching blocks fuse.
  { id: 'slag',    name: 'slag',    tier: 'raw',     h: 24,  s: 10, l: 24, sig: 'grain' },
  { id: 'ferrite', name: 'ferrite', tier: 'raw',     h: 212, s: 15, l: 26, sig: 'striate' },
  { id: 'quartz',  name: 'quartz',  tier: 'raw',     h: 188, s: 20, l: 27, sig: 'facet' },
  { id: 'cinder',  name: 'cinder',  tier: 'raw',     h: 6,   s: 24, l: 25, sig: 'vesicle' },
  { id: 'alloy',   name: 'alloy',   tier: 'refined', h: 44,  s: 16, l: 28, sig: 'hatch' },
  { id: 'lens',    name: 'lens',    tier: 'refined', h: 268, s: 22, l: 28, sig: 'ring' },
  { id: 'core',    name: 'core',    tier: 'apex',    h: 156, s: 24, l: 29, sig: 'nest' },
];

/** Grades lighten and gain chroma, so a grade-3 slag still reads as slag. */
const GRADE_CAP = 5;
const MAT_HEX = MATERIALS.map(m => {
  const out = [];
  for (let g = 0; g < GRADE_CAP; g++) {
    out.push(hslHex(m.h, Math.min(30, m.s + g * 3), Math.min(34, m.l + g * 2)));
  }
  return out;
});
const MAT_EDGE = MATERIALS.map(m => {
  const out = [];
  for (let g = 0; g < GRADE_CAP; g++) {
    out.push(hslHex(m.h, Math.min(34, m.s + g * 3 + 6), Math.min(46, m.l + g * 2 + 16)));
  }
  return out;
});

/**
 * Decades of health per rung. Chosen so the opening game walks the ladder at a
 * readable pace - a block worth 1 is slag, 4 is ferrite, 9 quartz, 21 cinder,
 * 56 alloy, 151 lens, 401 core, and 1001 begins the second grade.
 */
const MAT_DECADES = 0.42;

/**
 * Which material a value is made of. Accepts a plain number or an { m, e }
 * pair, so it keeps working long after the value stops fitting in a double.
 *
 * @param {number|{m:number,e:number}} value  a block's full health
 * @returns {{ index:number, grade:number, mat:object }}
 */
export function materialFor(value) {
  const lg = log10Of(value);
  let k = Math.floor(Math.max(0, lg) / MAT_DECADES);
  if (!Number.isFinite(k)) k = 0;
  const index = k % MATERIALS.length;
  const grade = Math.min(GRADE_CAP - 1, Math.floor(k / MATERIALS.length));
  return { index, grade, mat: MATERIALS[index] };
}

// ===========================================================================
// REGIME
// ===========================================================================
//
// A regime is a zone, in the sense a depth chart means it: a stretch of the
// descent with its own colour of water and its own things living in it. Three
// things carry that, and none of them is a word in a header bar.
//
//   1. THE WASH. The void itself takes the regime's hue at a few percent
//      chroma. Nothing about it is nameable; the field is simply a different
//      colour of dark than it was fifty rows ago.
//
//   2. THE SIGNATURE. The generator's own geometry, drawn faintly behind the
//      field: the triangles behind sierpinski, the two-source wavefronts
//      behind interfere, the ribs and arches behind cathedral. The player is
//      looking at a picture of the rule that is placing their blocks.
//
//   3. THE STRATUM. When one regime hands over to the next, a named line is
//      laid at the horizon and then descends with the world, carrying its
//      name and the depth it was laid at, fading out over the next several
//      rows. Regimes are not announced. They are passed.
//
// Bred regimes past the scripted run arrive as `deep:<parent>+<parent>`. Their
// signature is literally their two parents drawn over each other, so a player
// can see what a new name is made of. Any key the table does not know gets a
// stable pair chosen by hashing its name, which means the look never runs out.

/** Hue per scripted regime. Applied to the void at 3-6% chroma, never more. */
export const REGIME_HUES = {
  opening: 208, sierpinski: 264, mirror: 196, interference: 178,
  growth: 128, gliders: 92, weave: 40, chaos: 10, slabs: 26,
  lattice: 204, cathedral: 282, cantor: 238, reef: 158,
  fractal: 232,
};

/**
 * How loudly a regime states itself. A regime whose interest is its emptiness
 * should not be the busiest thing on the screen, and the opening in particular
 * is meant to look like almost nothing at all - it is the first thing anyone
 * ever sees, and it should read in a second with nothing to decode.
 */
// HOW LOUD EACH SIGNATURE IS ALLOWED TO BE.
//
// The signatures are not equally busy. A drifting field is a few slow strokes;
// a Sierpinski triangle drawn across the whole backdrop is a wall of geometry
// with more edges in it than the field in front of it has blocks. Drawn at the
// same strength the loud ones stop being scenery: the shape behind the field
// reads as the game, and the blocks read as scatter sitting on top of it.
//
// So every signature carries its own weight, and anything not listed is drawn
// at full. `feel.backdrop` scales all of them together, which is the dial to
// turn when the whole backdrop is too present rather than one signature.
const SIG_WEIGHT = {
  opening: 0.42, sierpinski: 0.45, growth: 0.55, cantor: 0.6,
  chaos: 0.7, static: 0.7, lattice: 0.8, weave: 0.85,
};

/** Every signature scaled together. Clamped, because a backdrop drawn at ten
 *  times strength is a white screen with a game somewhere behind it. An
 *  unconfigured build draws them at full, which is what they did before the
 *  dial existed. */
const BACKDROP = (() => {
  const v = Number(CONFIG.feel && CONFIG.feel.backdrop);
  return Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
})();

/** The strength one signature is painted at. */
const sigWeight = (key) => (SIG_WEIGHT[key] === undefined ? 1 : SIG_WEIGHT[key]) * BACKDROP;

/** Signature per scripted regime. Names index the SIGNATURES table below. */
const REGIME_SIGS = {
  opening: 'drift', sierpinski: 'triangles', mirror: 'axis',
  interference: 'wavefronts', growth: 'branch', gliders: 'chevrons',
  weave: 'weave', chaos: 'static', slabs: 'bands', lattice: 'lattice',
  cathedral: 'ribs', cantor: 'cantor', reef: 'reef',
  fractal: 'none',
};

const SIG_NAMES = [
  'drift', 'triangles', 'axis', 'wavefronts', 'branch', 'chevrons',
  'weave', 'static', 'bands', 'lattice', 'ribs', 'cantor', 'reef',
];

// ===========================================================================
// NUMBERS
// ===========================================================================
//
// Health, essence and swarm size all outgrow a double eventually, and both the
// economy and the powers layer carry { m, e } pairs for that reason. Every
// numeric entry point here takes either form. Nothing is ever rendered as
// "Infinity" and nothing silently rounds to zero.

/** Best-effort plain number. Returns Infinity rather than NaN when too large. */
export function numOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : (v > 0 ? Infinity : 0);
  if (v && typeof v.m === 'number' && typeof v.e === 'number') {
    if (v.m === 0) return 0;
    if (v.e > 300) return v.m > 0 ? Infinity : -Infinity;
    if (v.e < -300) return 0;
    return v.m * Math.pow(10, v.e);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** log10 of a value, in a form that survives any magnitude. 0 for non-positive. */
export function log10Of(v) {
  if (typeof v === 'number') return v > 0 ? Math.log10(v) : 0;
  if (v && typeof v.m === 'number' && typeof v.e === 'number') {
    return v.m > 0 ? Math.log10(v.m) + v.e : 0;
  }
  const n = Number(v);
  return n > 0 ? Math.log10(n) : 0;
}

// SI prefixes carry the first thirty-three decades. Past that, scientific
// notation - which is honest, compact, and reads as an instrument rather than
// as invented vocabulary.
const SI = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];

/**
 * Full-width number for readouts. Up to about seven characters.
 * 842 | 12.4k | 3.71M | 918G | 4.20e41
 */
export function format(v) {
  const lg = log10Of(v);
  const n = numOf(v);
  if (n === 0) return '0';
  if (n < 10000 && Number.isFinite(n)) {
    return n < 100 && n % 1 !== 0 ? n.toFixed(1) : String(Math.round(n));
  }
  const g = Math.floor(lg / 3);
  if (g < SI.length) {
    const m = Math.pow(10, lg - 3 * g);
    return (m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : String(Math.round(m))) + SI[g];
  }
  const e = Math.floor(lg);
  return Math.pow(10, lg - e).toFixed(2) + 'e' + e;
}

/**
 * Number for a place with no room: block health, pickup values, badges.
 * Never longer than five characters.
 * 9999 | 12.4k | 120M | 4e41
 */
export function formatTight(v) {
  const lg = log10Of(v);
  const n = numOf(v);
  if (n === 0) return '0';
  if (n < 100000 && Number.isFinite(n)) return String(Math.round(n));
  const g = Math.floor(lg / 3);
  if (g < SI.length) {
    const m = Math.pow(10, lg - 3 * g);
    return (m < 10 ? m.toFixed(1) : String(Math.round(m))) + SI[g];
  }
  const e = Math.floor(lg);
  return String(Math.round(Math.pow(10, lg - e))) + 'e' + e;
}

// ===========================================================================
// HASHING AND CONSTANTS
// ===========================================================================

const TAU = Math.PI * 2;
const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

function mix32(x) {
  x = x | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
function h2(a, b) { return mix32((a | 0) ^ Math.imul((b | 0) + 0x9e3779b1, 0x85ebca6b)); }
/** Hashed value in [0,1). Stateless: the same inputs always give the same mark. */
function u01(a, b) { return h2(a, b) / 4294967296; }
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return mix32(h);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
/** Cubic ease out. The only easing curve in the system. */
function ease(t) { const u = 1 - clamp(t, 0, 1); return 1 - u * u * u; }

// ===========================================================================
// TONES
// ===========================================================================
//
// Every colour used in a loop is pre-expanded into a table of rgba strings, so
// drawing a faded mark is an array index rather than string concatenation. The
// key set is fixed at load, so the table never grows during play.

function parseHex(css) {
  const s = String(css).trim();
  if (s.charCodeAt(0) === 35) {
    if (s.length === 4) {
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
    }
    if (s.length >= 7) {
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    }
  }
  const nums = s.match(/-?\d*\.?\d+/g);
  if (nums && nums.length >= 3) {
    return [clamp(+nums[0] | 0, 0, 255), clamp(+nums[1] | 0, 0, 255), clamp(+nums[2] | 0, 0, 255)];
  }
  return [230, 233, 239];
}

function createTones() {
  const STEPS = 41;
  const cache = new Map();
  function ramp(css) {
    let r = cache.get(css);
    if (r === undefined) {
      const c = parseHex(css);
      r = new Array(STEPS);
      const head = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',';
      for (let i = 0; i < STEPS; i++) r[i] = head + (i / (STEPS - 1)).toFixed(3) + ')';
      if (cache.size > 160) cache.clear();
      cache.set(css, r);
    }
    return r;
  }
  return {
    /** rgba string for a colour at an alpha of 0..1. Allocation free. */
    a(css, alpha) {
      const r = ramp(css);
      let k = (alpha * (STEPS - 1) + 0.5) | 0;
      if (k < 0) k = 0; else if (k > STEPS - 1) k = STEPS - 1;
      return r[k];
    },
    rgb(css) { return parseHex(css); },
  };
}

// ===========================================================================
// REGIME SIGNATURES
// ===========================================================================
//
// Each of these appends geometry describing one generator. They are handed
// either a Path2D or a drawing context - the two share the path interface - so
// a signature can be built once into a cached path and stroked every frame for
// the price of a single call.
//
// Every signature is built from lines and arcs only, is bounded by the rect it
// is given, and holds its detail under about 140 segments so the cached path
// stays cheap to rasterise.

const SIGNATURES = {
  /** Nothing at all. For a field that is its own picture and wants no scenery
   *  arguing with it. */
  none() {},

  /** Parallel drift, the quietest field there is. The opening looks like nothing. */
  drift(p, x, y, w, h, q) {
    const step = 30 + (1 - q) * 22;
    for (let i = -h; i < w + h; i += step) { p.moveTo(x + i, y + h); p.lineTo(x + i + h * 0.55, y); }
  },

  /** Nested triangles: the shape rule 90 draws, drawn behind the blocks it places. */
  triangles(p, x, y, w, h, q) {
    const limit = q > 0.6 ? 4 : 3;
    (function tri(cx, cy, s, d) {
      if (d <= 0 || s < 16) return;
      const hh = s * 0.866;
      p.moveTo(cx, cy - hh / 2); p.lineTo(cx - s / 2, cy + hh / 2);
      p.lineTo(cx + s / 2, cy + hh / 2); p.closePath();
      tri(cx, cy - hh / 4, s / 2, d - 1);
      tri(cx - s / 4, cy + hh / 4, s / 2, d - 1);
      tri(cx + s / 4, cy + hh / 4, s / 2, d - 1);
    })(x + w / 2, y + h * 0.54, w * 0.94, limit);
  },

  /** A centre line with everything folded across it. */
  axis(p, x, y, w, h) {
    const cx = x + w / 2;
    p.moveTo(cx, y); p.lineTo(cx, y + h);
    for (let i = 1; i <= 6; i++) {
      const d = i * w / 15, skew = h * 0.34;
      p.moveTo(cx - d, y); p.lineTo(cx - d - skew, y + h);
      p.moveTo(cx + d, y); p.lineTo(cx + d + skew, y + h);
    }
  },

  /** Two sources, and the pattern where their rings meet. */
  wavefronts(p, x, y, w, h, q) {
    const step = 20 + (1 - q) * 14;
    const f = [x + w * 0.27, y + h * 0.28, x + w * 0.73, y + h * 0.66];
    for (let k = 0; k < 2; k++) {
      const fx = f[k * 2], fy = f[k * 2 + 1];
      for (let r = step; r < Math.max(w, h) * 0.95; r += step) {
        p.moveTo(fx + r, fy); p.arc(fx, fy, r, 0, TAU);
      }
    }
  },

  /** Growth from the floor upward, branching as it climbs. */
  branch(p, x, y, w, h, q) {
    const limit = q > 0.6 ? 5 : 4;
    const grow = (px, py, ang, len, d) => {
      if (d <= 0 || len < 9) return;
      const nx = px + Math.cos(ang) * len, ny = py + Math.sin(ang) * len;
      p.moveTo(px, py); p.lineTo(nx, ny);
      grow(nx, ny, ang - 0.44, len * 0.68, d - 1);
      grow(nx, ny, ang + 0.44, len * 0.68, d - 1);
    };
    for (let i = 0; i < 3; i++) {
      grow(x + w * (0.2 + 0.3 * i), y + h, -Math.PI / 2 + (i - 1) * 0.22, h * 0.30, limit);
    }
  },

  /** Small travelling shapes on a lattice, all pointing the same way. */
  chevrons(p, x, y, w, h) {
    const s = 27, a = 6;
    for (let j = 0; j * s < h - 8; j++) {
      for (let i = 0; i * s < w - 8; i++) {
        if ((i * 3 + j * 5) % 4 === 0) continue;
        const cx = x + 14 + i * s, cy = y + 14 + j * s;
        p.moveTo(cx - a, cy - a); p.lineTo(cx, cy + a * 0.4); p.lineTo(cx + a, cy - a);
      }
    }
  },

  /** Over and under, with the breaks that make it a weave and not a grid. */
  weave(p, x, y, w, h) {
    const s = 26, gap = 5;
    for (let i = 0; i * s < w; i++) {
      const gx = x + i * s + 8;
      for (let j = 0; j * s < h; j++) {
        const gy = y + j * s + 8;
        if ((i + j) & 1) { p.moveTo(gx, gy - s / 2 + gap); p.lineTo(gx, gy + s / 2 - gap); }
        else { p.moveTo(gx - s / 2 + gap, gy); p.lineTo(gx + s / 2 - gap, gy); }
      }
    }
  },

  /** No structure at all, and the absence of it is the structure. */
  static(p, x, y, w, h, q) {
    const n = Math.round(180 * clamp(q, 0.4, 1));
    for (let i = 0; i < n; i++) {
      const px = x + u01(i, 11) * w, py = y + u01(i, 12) * h;
      const len = 2 + u01(i, 13) * 5;
      p.moveTo(px, py); p.lineTo(px + len, py);
    }
  },

  /** Heavy horizontal mass. The field as a stack of floors. */
  bands(p, x, y, w, h) {
    for (let j = 0; j < 7; j++) {
      const by = y + h * (j + 0.5) / 7;
      p.moveTo(x, by); p.lineTo(x + w, by);
      p.moveTo(x, by + 5); p.lineTo(x + w, by + 5);
    }
  },

  /** Perfectly regular, and the only signature that admits it. */
  lattice(p, x, y, w, h) {
    const s = 26;
    for (let i = 0; i * s <= w; i++) { p.moveTo(x + i * s, y); p.lineTo(x + i * s, y + h); }
    for (let j = 0; j * s <= h; j++) { p.moveTo(x, y + j * s); p.lineTo(x + w, y + j * s); }
  },

  /** Ribs and arches. The field as architecture that was built on purpose. */
  ribs(p, x, y, w, h) {
    const n = 6, s = w / n;
    for (let i = 0; i <= n; i++) {
      const rx = x + i * s;
      p.moveTo(rx, y + h * 0.22); p.lineTo(rx, y + h);
    }
    for (let i = 0; i < n; i++) {
      const cx = x + i * s + s / 2;
      p.moveTo(cx - s / 2, y + h * 0.22);
      p.arc(cx, y + h * 0.22, s / 2, Math.PI, 0);
    }
    p.moveTo(x, y + h * 0.22); p.lineTo(x + w, y + h * 0.22);
  },

  /** Middle thirds removed, forever, until the gaps are too small to see. */
  cantor(p, x, y, w, h) {
    const rows = 6;
    const cut = (x0, x1, level) => {
      if (level >= rows) return;
      const yy = y + (level + 0.5) * h / rows;
      p.moveTo(x0, yy); p.lineTo(x1, yy);
      const t = (x1 - x0) / 3;
      if (t < 3) return;
      cut(x0, x0 + t, level + 1);
      cut(x1 - t, x1, level + 1);
    };
    cut(x, x + w, 0);
  },

  /** Accreted, irregular, grown rather than placed. */
  reef(p, x, y, w, h, q) {
    const n = Math.round(46 * clamp(q, 0.5, 1));
    for (let i = 0; i < n; i++) {
      const cx = x + u01(i, 21) * w, cy = y + u01(i, 22) * h;
      const r = 3 + u01(i, 23) * 13;
      const seg = 5 + ((h2(i, 24) % 3) | 0);
      for (let k = 0; k <= seg; k++) {
        const a = k / seg * TAU;
        const rr = r * (0.62 + u01(i * 31 + k, 25) * 0.55);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.72;
        if (k === 0) p.moveTo(px, py); else p.lineTo(px, py);
      }
    }
  },
};

/**
 * Which signatures a regime key draws. Scripted keys are looked up; bred keys
 * are unpacked into their two parents; anything unknown is hashed into a
 * stable pair, so a name that has never existed still gets a look that is
 * always the same for that name.
 */
function sigsFor(key) {
  const k = String(key || 'opening');
  if (REGIME_SIGS[k]) return [REGIME_SIGS[k], null];
  if (k.indexOf('deep:') === 0) {
    const parts = k.slice(5).split('+');
    const a = REGIME_SIGS[parts[0]], b = REGIME_SIGS[parts[1]];
    if (a || b) return [a || b, a && b && a !== b ? b : null];
  }
  const hs = hashStr(k);
  const a = SIG_NAMES[hs % SIG_NAMES.length];
  const b = SIG_NAMES[(hs >>> 8) % SIG_NAMES.length];
  return [a, b === a ? null : b];
}

/** Hue for a regime key, hashed into the cool-to-warm span when unlisted. */
function hueFor(key) {
  const k = String(key || 'opening');
  if (REGIME_HUES[k] !== undefined) return REGIME_HUES[k];
  if (k.indexOf('deep:') === 0) {
    const parts = k.slice(5).split('+');
    const a = REGIME_HUES[parts[0]], b = REGIME_HUES[parts[1]];
    if (a !== undefined && b !== undefined) {
      // Shortest way round the wheel, so two neighbouring hues do not average
      // into their opposite.
      const d = ((b - a + 540) % 360) - 180;
      return (a + d * 0.5 + 360) % 360;
    }
    if (a !== undefined) return a;
    if (b !== undefined) return b;
  }
  return hashStr(k) % 360;
}

// ===========================================================================
// LOOK CONSTANTS
// ===========================================================================

const LOOK = {
  inset: 3,          // gap between a free block edge and its cell boundary
  bracket: 0.34,     // corner bracket length as a share of the block, at full health
  seam: 0.55,        // alpha of the hairline joint between two fused blocks
  hazeTop: 0.62,     // atmospheric perspective: alpha of the void wash at the horizon
  threatRows: 3,     // rows from the line at which a block starts reading as threat
  slideTime: 0.20,   // seconds for the world to step down one row
  birthTime: 0.42,   // seconds for a new row to arrive out of the horizon
  hitTime: 0.16,     // seconds a struck block holds its bright edge
  scarTime: 0.75,    // seconds a destroyed block's outline stays in the field
  markFade: 6,       // rows a regime stratum stays legible for after it is laid
  transit: 1.05,     // seconds the regime changeover wipe takes to cross the field
  surface: 56,       // samples across the swarm surface
  discs: 176,        // hard ceiling on drawn swarm primitives, at any count
};

// ===========================================================================
// FACTORY
// ===========================================================================

/**
 * Build a visual layer.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=520]     canvas width in css pixels
 * @param {number} [opts.height=620]    canvas height in css pixels
 * @param {number} [opts.top=40]        y of the horizon; the field starts here
 * @param {number} [opts.floorY]        y of the swarm line, defaults to height-54
 * @param {number} [opts.cols=8]        columns in the field
 * @param {number} [opts.quality=1]     detail multiplier, 0..1
 * @param {boolean} [opts.autoQuality=true]  step detail down if a frame runs long
 * @param {number} [opts.budgetMs=1.4]  the per-frame draw budget to hold to
 * @param {boolean} [opts.reducedMotion] force motion damping on or off
 * @param {(row:number)=>number} [opts.depthAtRow] map a grid row to an absolute
 *        depth, if the caller knows it. Supplied rows get numbered ticks on the
 *        depth scale; without it the scale is drawn unlabelled.
 */
export function createVisual(opts) {
  const o = opts || {};
  const tone = createTones();

  let W = o.width > 0 ? o.width : 520;
  let H = o.height > 0 ? o.height : 620;
  let TOP = o.top >= 0 ? o.top : 40;
  let FLOOR = o.floorY > 0 ? o.floorY : H - 54;
  let COLS = o.cols > 0 ? o.cols : 8;
  let CELL = W / COLS;

  // The field widens as a run goes on: the view pulls back, cells shrink, and
  // more columns fit. A block therefore carries a WORLD column, which never
  // moves, rather than a screen column, which does. ORIGIN is where world
  // column zero sits, in pixels. Everything that draws a BLOCK goes through it;
  // the column grid does not, because the grid is a property of the screen.
  let ORIGIN = o.origin || 0;
  let BAND = H - FLOOR;

  let quality = o.quality === undefined ? 1 : clamp(o.quality, 0.25, 1);
  let autoQuality = o.autoQuality !== false;
  const budgetMs = o.budgetMs > 0 ? o.budgetMs : 1.4;
  let reduced = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotion();
  const depthAtRow = typeof o.depthAtRow === 'function' ? o.depthAtRow : null;

  const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

  // --- animated state ------------------------------------------------------

  let clock = 0;              // seconds since start; drives all ambient drift
  let slide = 0;              // 0..1 through the current descent step
  let sliding = false;
  let depth = 1;

  let swLog = 0;              // log10 of the swarm count
  let swText = '1';
  let swRaw = 1;
  let flight = 0;             // share of the swarm currently off the pool
  let resolveT = 0;           // milestone strobe: the mass briefly resolves

  let regimeKey = 'opening', regimeName = 'drift', regimeNext = '';

  // How close the run is to ending, when that is not something a COLUMN can be
  // close to. null means every block is judged by its own distance from the
  // line, which is what a descending field means by threat.
  let pressure = null;
  // What the blocks are made of, when it is not a material. A surface paints
  // the block fills itself (and the picture under them); see setSurface.
  let surface = null;
  // The column grid in the backdrop. A field that is a picture turns it off.
  let gridOn = true;
  let regimeIndex = -1, handover = 0;
  let hue = REGIME_HUES.opening, hueTo = hue;
  let prevSigs = null, curSigs = sigsFor('opening');
  let transitT = 0;           // 1 -> 0 as the changeover wipe crosses the field

  // Named lines left behind by finished regimes, descending with the world.
  const marks = [];           // { name, depth, row, alpha }

  // Outlines of destroyed blocks, holding the shape of the wall that fell.
  const scars = [];           // { x, y, w, h, t, hex }

  // --- swarm surface -------------------------------------------------------
  //
  // The swarm line is not a drawn rule. It is the surface of the pool the
  // swarm lives in, and it behaves like one: bodies leaving it dip it, bodies
  // returning splash into it, and the ripples cross and interfere.

  const SURF = LOOK.surface;
  const sh = new Float32Array(SURF);   // displacement
  const sv = new Float32Array(SURF);   // velocity
  const stmp = new Float32Array(SURF);

  // --- block identity ------------------------------------------------------
  //
  // Blocks are plain objects the game owns. A WeakMap gives each one a stable
  // visual identity without touching it, and a parallel map keeps the record
  // one frame past the block's death so the field can be left scarred.

  const idOf = new WeakMap();
  const recs = new Map();
  let nextId = 1;
  let frameId = 0;

  // Occupancy stamps for fusion. Cleared by generation rather than by wiping.
  // Indexed by SCREEN column (world column minus the left edge), because a
  // widened field has world columns below zero. Reallocated when the lattice
  // widens.
  const OCC_ROWS = 64;
  let OCC_W = COLS + 8;
  let occ = new Int32Array(OCC_W * OCC_ROWS);

  // Per-frame scratch, sized once. Nothing in the draw path allocates. Big
  // enough for a field of eleven pixel cells.
  const CAPB = 4096;
  const bx = new Float32Array(CAPB), by = new Float32Array(CAPB);
  const bw = new Float32Array(CAPB), bh = new Float32Array(CAPB);
  const bInt = new Float32Array(CAPB), bHit = new Float32Array(CAPB);
  const bAl = new Float32Array(CAPB), bThreat = new Float32Array(CAPB);
  const bMat = new Int32Array(CAPB), bGrade = new Int32Array(CAPB);
  const bFuse = new Int32Array(CAPB), bRole = new Int32Array(CAPB);
  const bSeed = new Int32Array(CAPB), bCol = new Int32Array(CAPB);
  const bRow = new Int32Array(CAPB);
  const bText = new Array(CAPB).fill('');
  // The whole cell, before fusion insets, and the block itself - what a
  // surface needs to paint through a block.
  const bCX = new Float32Array(CAPB), bCY = new Float32Array(CAPB);
  const bObj = new Array(CAPB).fill(null);
  let bN = 0;

  // --- cached device objects ----------------------------------------------

  const sigCache = new Map();     // key -> Path2D
  let gradVoid = null, gradHaze = null, gradRim = null, gradPool = null;
  let hazeH = 0, poolReach = 0;
  let gradKey = '';
  const hasPath2D = typeof Path2D !== 'undefined';

  // A regime signature is a large piece of static line work covering the whole
  // field. Stroking it every frame is the single most expensive thing this
  // layer could do, so each one is drawn ONCE into an offscreen surface and
  // blitted thereafter - still generated, still no asset file, but a rebuild
  // happens on a regime change rather than sixty times a second.
  const layers = new Map();       // key -> { cv, w, h }
  let layerBudget = 6;

  // --- self-governing detail ----------------------------------------------

  let costEma = 0, overrun = 0, frameT0 = 0;

  function prefersReducedMotion() {
    try {
      return typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    } catch (e) { return false; }
  }

  // =========================================================================
  // GRADIENTS
  // =========================================================================
  //
  // Five gradients carry most of the atmosphere, and all five are objects, so
  // they are built when something they depend on changes and never inside a
  // loop. The key quantises hue and swarm brightness so ordinary play rebuilds
  // them a handful of times per run.

  function ensureGradients(ctx) {
    const hb = Math.round(hue / 8);
    const lb = Math.round(clamp(swLog / 9, 0, 1) * 8);
    const key = hb + ':' + lb + ':' + Math.round(W) + 'x' + Math.round(H);
    if (key === gradKey && gradVoid) return;
    gradKey = key;

    const wash = hslHex(hue, 34, 9);
    gradVoid = ctx.createLinearGradient(0, 0, 0, H);
    gradVoid.addColorStop(0, PALETTE.void);
    gradVoid.addColorStop(TOP / H, PALETTE.void);
    gradVoid.addColorStop(0.62, tone.a(wash, 0.5));
    gradVoid.addColorStop(FLOOR / H, tone.a(wash, 0.85));
    gradVoid.addColorStop(1, PALETTE.void);

    // Aerial perspective. Distance costs contrast, and only contrast - this is
    // drawn before the health numerals, never over them.
    // Reaches zero at 62% of the way down the field, so only that much of it
    // is ever painted.
    hazeH = (FLOOR - TOP) * 0.62;
    gradHaze = ctx.createLinearGradient(0, TOP, 0, TOP + hazeH);
    gradHaze.addColorStop(0, tone.a(PALETTE.void, LOOK.hazeTop));
    gradHaze.addColorStop(0.55, tone.a(PALETTE.void, 0.15));
    gradHaze.addColorStop(1, tone.a(PALETTE.void, 0));

    // The only light source in the world is the swarm. Everything above the
    // line is lit from below, and the light gets stronger as the swarm grows.
    const lit = 0.10 + 0.55 * (lb / 8);
    gradRim = ctx.createLinearGradient(0, FLOOR, 0, FLOOR - CELL * 4.2);
    gradRim.addColorStop(0, tone.a(PALETTE.swarm, lit));
    gradRim.addColorStop(1, tone.a(PALETTE.swarm, 0));

    // How far up the field the swarm's light reaches is itself a readout. Past
    // the point where the band cannot get any fuller or any brighter, this is
    // what keeps growing, and it is the reason a huge swarm changes how the
    // whole screen looks rather than just how the bottom strip looks.
    poolReach = CELL * (1.0 + 2.6 * (lb / 8));
    gradPool = ctx.createLinearGradient(0, FLOOR, 0, FLOOR - poolReach);
    gradPool.addColorStop(0, tone.a(PALETTE.swarm, 0.10 + 0.34 * (lb / 8)));
    gradPool.addColorStop(0.45, tone.a(PALETTE.swarm, 0.03 + 0.11 * (lb / 8)));
    gradPool.addColorStop(1, tone.a(PALETTE.swarm, 0));

  }

  /**
   * The swarm mote. One soft disc, generated once into an offscreen surface
   * and stamped for every drawn member of the swarm.
   *
   * It has a white core inside a cyan halo, and that single fact is what makes
   * the whole band work at both ends of the number system. Drawn once at high
   * opacity it is a glowing ball, which is what one member of a swarm of six
   * should look like. Stamped two hundred times with heavy overlap under an
   * additive blend, the cores pile up past white while the halos stay cyan -
   * so an enormous swarm becomes light with a coloured edge, rather than a
   * pile of visible circles, without a second code path or a second cost.
   */
  function moteSprite() {
    const key = 'mote';
    let L = layers.get(key);
    if (L) return L;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const lc = cv.getContext('2d');
    if (!lc) return null;
    const g = lc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.16, 'rgba(196,240,255,0.72)');
    g.addColorStop(0.38, 'rgba(90,209,255,0.34)');
    g.addColorStop(0.70, 'rgba(90,209,255,0.10)');
    g.addColorStop(1.00, 'rgba(90,209,255,0)');
    lc.fillStyle = g;
    lc.fillRect(0, 0, S, S);
    L = { cv, w: S, h: S };
    layers.set(key, L);
    layerBudget++;
    return L;
  }

  /**
   * An offscreen surface, drawn once and blitted after. Used only for line
   * work that is static between regime changes.
   */
  function layerFor(key, w, h, paint) {
    let L = layers.get(key);
    if (L && L.w === w && L.h === h) return L;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
    const lc = cv.getContext('2d');
    if (!lc) return null;
    paint(lc);
    L = { cv, w, h };
    if (layers.size >= layerBudget) layers.delete(layers.keys().next().value);
    layers.set(key, L);
    return L;
  }

  function sigPath(name, x, y, w, h) {
    const fn = SIGNATURES[name];
    if (!fn) return null;
    const qb = Math.round(quality * 4);
    const key = name + '|' + qb + '|' + (w | 0) + 'x' + (h | 0);
    let p = sigCache.get(key);
    if (p === undefined) {
      if (hasPath2D) {
        p = new Path2D();
        fn(p, x, y, w, h, quality);
      } else {
        p = null;
      }
      if (sigCache.size > 24) sigCache.clear();
      sigCache.set(key, p);
    }
    return p;
  }

  // =========================================================================
  // FRAME
  // =========================================================================

  /**
   * Advance every animation. dt is seconds; a millisecond value is detected,
   * and a long stall is clamped so nothing teleports when a tab comes back.
   */
  function update(dt) {
    let d = dt;
    if (!(d > 0)) d = 1 / 60;
    if (d > 1) d = d / 1000;
    if (d > 0.05) d = 0.05;
    clock += d;

    if (sliding) {
      slide += d / LOOK.slideTime;
      if (slide >= 1) { slide = 1; sliding = false; }
    }

    if (transitT > 0) transitT = Math.max(0, transitT - d / LOOK.transit);
    if (resolveT > 0) resolveT = Math.max(0, resolveT - d / 0.55);

    // Hue drifts rather than cutting, so a handover is felt before it is seen.
    if (hue !== hueTo) {
      const diff = ((hueTo - hue + 540) % 360) - 180;
      if (Math.abs(diff) < 0.4) hue = hueTo;
      else hue += diff * Math.min(1, d * 2.4);
      hue = (hue + 360) % 360;
    }

    // Block records: arrival, descent, the flash of a strike.
    recs.forEach(r => {
      if (r.birth > 0) r.birth = Math.max(0, r.birth - d / LOOK.birthTime);
      if (r.hit > 0) r.hit = Math.max(0, r.hit - d / LOOK.hitTime);
      if (r.move > 0) r.move = Math.max(0, r.move - d / LOOK.slideTime);
    });

    for (let i = scars.length - 1; i >= 0; i--) {
      scars[i].t -= d / LOOK.scarTime;
      if (scars[i].t <= 0) scars.splice(i, 1);
    }

    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].row > LOOK.markFade + 2) marks.splice(i, 1);
    }

    stepSurface(d);
  }

  /**
   * The surface as a chain of coupled springs. Splashes inject velocity, the
   * chain carries it outward, and damping settles it. Fifty-six samples cost
   * nothing and buy the single most physical thing on the screen.
   */
  function stepSurface(d) {
    const k = 92, damp = Math.exp(-3.6 * d);
    for (let i = 0; i < SURF; i++) {
      const l = sh[i > 0 ? i - 1 : 0], r = sh[i < SURF - 1 ? i + 1 : SURF - 1];
      stmp[i] = (l + r) * 0.5 - sh[i];
    }
    for (let i = 0; i < SURF; i++) {
      sv[i] = (sv[i] + stmp[i] * k * d - sh[i] * 6 * d) * damp;
      sh[i] += sv[i] * d;
      if (sh[i] > 9) sh[i] = 9; else if (sh[i] < -9) sh[i] = -9;
    }
  }

  // =========================================================================
  // SIGNALS
  // =========================================================================

  /** Current depth. An increase starts the world stepping down one row. */
  function setDepth(d) {
    const v = Math.max(1, Math.floor(d) || 1);
    if (v > depth) descend(v - depth);
    depth = v;
  }

  /** Start the descent animation without waiting for a depth change. */
  function descend(rows) {
    const n = Math.max(1, Math.floor(rows) || 1);
    slide = 0; sliding = true;
    for (let i = 0; i < marks.length; i++) marks[i].row += n;
  }

  /** Swarm size, as a number or an { m, e } pair. Drives the whole pool. */
  function setSwarm(n) {
    swRaw = n;
    swLog = Math.max(0, log10Of(n));
    swText = format(n);
  }

  /** Share of the swarm currently in flight, 0..1. Dips the pool while a turn runs. */
  function setFlight(f) { flight = clamp(Number(f) || 0, 0, 1); }

  /** A body crossed back into the pool. Rings out from x. */
  function splash(x, strength) {
    if (!Number.isFinite(x)) return;
    const i = clamp(Math.round(x / W * (SURF - 1)), 0, SURF - 1);
    const amp = clamp(Number(strength) || 1, 0.2, 6) * (reduced ? 0.5 : 1);
    sv[i] -= amp * 26;
    if (i > 0) sv[i - 1] -= amp * 13;
    if (i < SURF - 1) sv[i + 1] -= amp * 13;
  }

  /**
   * A threshold was crossed. The mass briefly resolves back into countable
   * individuals and then melts together again - the one moment the game shows
   * a player what their number actually became.
   */
  function resolve() { resolveT = 1; }

  /**
   * Current regime, straight from the pattern source. Handover progress fades
   * one signature into the next; a change of index lays a named stratum and
   * sends the changeover wipe down the field.
   */
  function setRegime(info) {
    if (!info) return;
    const key = info.key || regimeKey;
    const name = info.name || regimeName;
    handover = info.handingOver ? clamp(info.progress || 0, 0, 1) : 0;
    regimeNext = info.handingOver ? (info.next || '') : '';

    const idx = info.index === undefined ? regimeIndex : info.index;
    if (idx !== regimeIndex) {
      if (regimeIndex >= 0) {
        marks.push({ name: String(name).toUpperCase(), depth, row: 0 });
        if (marks.length > 12) marks.shift();
        transitT = 1;
      }
      regimeIndex = idx;
    }
    if (key !== regimeKey) {
      prevSigs = curSigs;
      curSigs = sigsFor(key);
      regimeKey = key;
      hueTo = hueFor(key);
    }
    regimeName = name;
  }

  // =========================================================================
  // BACKGROUND
  // =========================================================================

  /**
   * The void, the wash, the grid, the depth scale and the regime signature.
   * Draw first; everything else sits on top of it.
   */
  function background(ctx) {
    if (!ctx) return;
    frameT0 = now();
    ensureGradients(ctx);

    // The ground, the wash, the column grid and the regime's own geometry are
    // all static between regime changes, so they are baked into one surface and
    // laid down as a single opaque copy. What is left to draw per frame is only
    // what actually moves.
    const backdrop = layerFor(backdropKey(), W, H, lc => {
      lc.fillStyle = gradVoid ? rebuildVoid(lc) : PALETTE.void;
      lc.fillRect(0, 0, W, H);
      paintSignature(lc, curSigs, 0);
      if (gridOn) {
        lc.strokeStyle = tone.a(PALETTE.rule, 0.55);
        lc.lineWidth = 1;
        lc.beginPath();
        for (let c = 1; c < COLS; c++) {
          const x = Math.round(c * CELL) + 0.5;
          lc.moveTo(x, TOP); lc.lineTo(x, FLOOR);
        }
        lc.stroke();
      }
    });

    if (backdrop) ctx.drawImage(backdrop.cv, 0, 0);
    else {
      ctx.fillStyle = gradVoid;
      ctx.fillRect(0, 0, W, H);
      paintSignature(ctx, curSigs, 0);
      if (gridOn) drawGrid(ctx);
    }

    drawHandover(ctx);
    drawStrata(ctx);

  }

  /** Identity of the current backdrop. Changes only when its inputs do. */
  function backdropKey() {
    return 'bd|' + (gridOn ? 'g' : 'n') + '|' + curSigs[0] + '|' + curSigs[1] + '|' + Math.round(hue / 15)
      + '|' + Math.round(quality * 4) + '|' + sigWeight(regimeKey)
      + '|' + (W | 0) + 'x' + (H | 0)
      + '|' + (TOP | 0) + '|' + (FLOOR | 0) + '|' + COLS + '|' + Math.round(CELL);
  }

  /** The void gradient, rebuilt against whichever context is painting it. */
  function rebuildVoid(lc) {
    const wash = hslHex(hue, 34, 9);
    const g = lc.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PALETTE.void);
    g.addColorStop(TOP / H, PALETTE.void);
    g.addColorStop(0.62, tone.a(wash, 0.5));
    g.addColorStop(FLOOR / H, tone.a(wash, 0.85));
    g.addColorStop(1, PALETTE.void);
    return g;
  }

  /**
   * One regime's geometry, drawn into whatever context is given. Called once
   * per backdrop rebuild, and per frame only for the outgoing regime during a
   * handover - which lasts five rows out of a regime's fourteen or more.
   */
  function paintSignature(lc, sigs, alphaOverride) {
    if (!sigs) return;
    const w = W, h = FLOOR - TOP;
    const base = hslHex(hue, 40, 62);
    const strength = (0.44 + 0.14 * quality) * sigWeight(regimeKey);
    if (strength <= 0) return;
    const two = sigs[1] ? 0.66 : 1;
    lc.save();
    lc.beginPath(); lc.rect(0, TOP, w, h); lc.clip();
    lc.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const name = sigs[i];
      if (!name) continue;
      lc.strokeStyle = tone.a(base, (alphaOverride || strength) * two);
      const p = sigPath(name, 0, TOP, w, h);
      if (p) lc.stroke(p);
      else { lc.beginPath(); SIGNATURES[name](lc, 0, TOP, w, h, quality); lc.stroke(); }
    }
    lc.restore();
  }

  /**
   * A regime does not switch, it dissolves. For the few rows either side of a
   * changeover the outgoing geometry is still faintly present over the
   * incoming backdrop, and the moment the new one takes over a single bright
   * rule sweeps the field from the horizon to the line, with the old world
   * above it and the new one below.
   */
  function drawHandover(ctx) {
    const h = FLOOR - TOP;

    if (prevSigs && (handover > 0 || transitT > 0)) {
      const fade = transitT > 0 ? transitT : (1 - handover);
      if (fade > 0.02) {
        ctx.save();
        if (transitT > 0) {
          const wipeY = TOP + h * (1 - ease(1 - transitT));
          ctx.beginPath(); ctx.rect(0, wipeY, W, FLOOR - wipeY); ctx.clip();
        }
        paintSignature(ctx, prevSigs, (0.44 + 0.14 * quality) * fade * BACKDROP);
        ctx.restore();
      }
    }

  }

  /**
   * The changeover, drawn over the field rather than behind it. When one
   * regime finishes, a single bright rule crosses from the horizon to the line
   * with a short wake behind it. It passes over the blocks, so the moment the
   * world turns over is something that happens TO the field a player is
   * looking at, not something that happens somewhere underneath it.
   */
  function drawTransit(ctx) {
    if (transitT <= 0) return;
    const h = FLOOR - TOP;
    const wipeY = TOP + h * (1 - ease(1 - transitT));
    const a = ease(transitT);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, TOP, W, h); ctx.clip();

    // A wake trailing the edge, additive so it lights what it passes over.
    ctx.globalCompositeOperation = 'lighter';
    const wake = ctx.createLinearGradient(0, wipeY - 54, 0, wipeY);
    wake.addColorStop(0, tone.a(PALETTE.swarm, 0));
    wake.addColorStop(1, tone.a(PALETTE.swarm, a * 0.26));
    ctx.fillStyle = wake;
    ctx.fillRect(0, wipeY - 54, W, 54);

    // The edge itself, bright enough to be the thing you are looking at for
    // the second it takes to cross.
    ctx.strokeStyle = tone.a(PALETTE.ink, a * 0.92);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(wipeY) + 0.5); ctx.lineTo(W, Math.round(wipeY) + 0.5);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = tone.a(PALETTE.swarm, a * 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(wipeY) + 3.5); ctx.lineTo(W, Math.round(wipeY) + 3.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrid(ctx) {
    ctx.strokeStyle = tone.a(PALETTE.rule, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
      const x = Math.round(c * CELL) + 0.5;
      ctx.moveTo(x, TOP); ctx.lineTo(x, FLOOR);
    }
    ctx.stroke();
  }

  /**
   * The depth scale: a tick at every row boundary, heavier every fifth, moving
   * down with the world one row at a time. It is the only thing on screen that
   * says how far down this is, and it says it without a single word.
   */
  function drawStrata(ctx) {
    const off = (sliding ? ease(slide) - 1 : 0) * CELL;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let heavy = null;
    for (let r = 0; r * CELL + TOP < FLOOR + CELL; r++) {
      const y = Math.round(TOP + r * CELL + off) + 0.5;
      if (y < TOP || y > FLOOR) continue;
      const abs = depthAtRow ? depthAtRow(r) : null;
      const isHeavy = abs !== null ? (abs % 5 === 0) : (r % 5 === 0);
      if (isHeavy) { (heavy || (heavy = [])).push(y, abs); continue; }
      ctx.moveTo(0, y); ctx.lineTo(10, y);
      ctx.moveTo(W - 10, y); ctx.lineTo(W, y);
    }
    ctx.strokeStyle = tone.a(PALETTE.rule, 0.7);
    ctx.stroke();

    if (heavy) {
      ctx.beginPath();
      for (let i = 0; i < heavy.length; i += 2) {
        ctx.moveTo(0, heavy[i]); ctx.lineTo(22, heavy[i]);
        ctx.moveTo(W - 22, heavy[i]); ctx.lineTo(W, heavy[i]);
      }
      ctx.strokeStyle = tone.a(PALETTE.dim, 0.30);
      ctx.stroke();
      if (depthAtRow) {
        ctx.font = '500 9px ' + FONT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = tone.a(PALETTE.dim, 0.34);
        for (let i = 0; i < heavy.length; i += 2) {
          if (heavy[i + 1] === null) continue;
          ctx.fillText(String(heavy[i + 1]), 26, heavy[i]);
        }
      }
    }

    // Named lines left by finished regimes, descending and fading.
    if (marks.length) {
      ctx.font = '600 9px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ls = 'letterSpacing' in ctx;
      if (ls) ctx.letterSpacing = '0.26em';
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const y = Math.round(TOP + (m.row + (sliding ? ease(slide) - 1 : 0)) * CELL) + 0.5;
        if (y < TOP - 2 || y > FLOOR) continue;
        const a = clamp(1 - m.row / LOOK.markFade, 0, 1) * 0.62;
        if (a <= 0.02) continue;
        const label = m.name;
        const tw = 9 * label.length + 30;
        ctx.strokeStyle = tone.a(PALETTE.dim, a * 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo((W - tw) / 2, y);
        ctx.moveTo((W + tw) / 2, y); ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillStyle = tone.a(PALETTE.dim, a * 1.4);
        ctx.fillText(label, W / 2, y);
      }
      if (ls) ctx.letterSpacing = '0px';
    }
  }

  // =========================================================================
  // HORIZON
  // =========================================================================

  /**
   * The band above the field: where rows come from. Given the next few rows it
   * draws them receding toward a vanishing line, compressed and dimmed by
   * distance, so the field visibly extends past the top of the screen and a
   * player can read what is coming before it arrives.
   *
   * @param {ctx} ctx
   * @param {boolean[][]} [rows] future rows, nearest first
   */
  /**
   * The strip above the field, and the rows still to come drawn into it.
   *
   * @param {Array<boolean[]>} rows  the next rows, nearest first. NOT the live
   *        blocks - this wants the field's own answer about what is coming, and
   *        being handed the block list instead is why this drew nothing at all
   *        for as long as it existed.
   * @param {number} [lo] the leftmost WORLD column, so a field that has widened
   *        draws its preview over the columns it will actually land on.
   */
  function horizon(ctx, rows, lo) {
    if (!ctx) return;
    const h = TOP;
    const left = Number.isFinite(lo) ? lo : 0;

    // Distance is darker, not lighter. Nothing up there is resolved yet.
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, W, h);

    if (rows && rows.length && Array.isArray(rows[0])) {
      const n = Math.min(3, rows.length);
      const off = sliding ? (ease(slide) - 1) : 0;
      for (let i = n - 1; i >= 0; i--) {
        // Each successive row sits higher, thinner and dimmer.
        const t = (i + 1 + off);
        const scale = Math.pow(0.62, t - 1);
        const rh = CELL * 0.5 * scale;
        const y = h - (h * 0.06) - rh - (h * 0.30) * (t - 1);
        if (y + rh < 0) continue;
        const a = 0.30 * Math.pow(0.55, t - 1) * clamp(1 + off, 0, 1);
        if (a < 0.02) continue;
        const row = rows[i];
        const inset = (CELL * (1 - scale)) * 0.5 + LOOK.inset;
        ctx.fillStyle = tone.a(hslHex(hue, 26, 58), a);
        for (let c = 0; c < row.length; c++) {
          if (!row[c]) continue;
          ctx.fillRect(ORIGIN + (left + c) * CELL + inset, y, CELL - inset * 2, rh);
        }
      }
    }

    // The horizon itself: the line the field is born at.
    ctx.strokeStyle = tone.a(hslHex(hue, 40, 60), 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, TOP + 0.5); ctx.lineTo(W, TOP + 0.5); ctx.stroke();

    // A regime hands over across several rows rather than switching. While it
    // is happening the incoming name is legible at the horizon, brightening as
    // the field turns into it, with a rule showing how far through it is. You
    // can see the next zone coming before you are in it.
    if (regimeNext && handover > 0) {
      const a = 0.20 + 0.55 * handover;
      const ls = 'letterSpacing' in ctx;
      if (ls) ctx.letterSpacing = '0.22em';
      ctx.font = '600 9px ' + FONT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = tone.a(PALETTE.dim, a);
      ctx.fillText(String(regimeNext).toUpperCase(), W - 10, TOP - 8);
      if (ls) ctx.letterSpacing = '0px';
      const bwid = 46;
      ctx.strokeStyle = tone.a(PALETTE.rule, 0.9);
      ctx.beginPath();
      ctx.moveTo(W - 10 - bwid, TOP - 4.5); ctx.lineTo(W - 10, TOP - 4.5); ctx.stroke();
      ctx.strokeStyle = tone.a(PALETTE.swarm, 0.55);
      ctx.beginPath();
      ctx.moveTo(W - 10 - bwid, TOP - 4.5);
      ctx.lineTo(W - 10 - bwid + bwid * handover, TOP - 4.5); ctx.stroke();
    }

  }

  // =========================================================================
  // BLOCKS
  // =========================================================================
  //
  // The block layer is a differ. It is handed the game's list every frame and
  // works out for itself what arrived, what moved, what was struck and what
  // died - so wiring it is one call and it stays correct through row purges,
  // rows lifted off the line, and anything else that rearranges the field.
  //
  // It draws in passes rather than per block: one path for every seam in the
  // field, one for every bezel of a given threat level, one per material for
  // surface structure, one for all cracks, one for the light coming up off the
  // swarm. Sixty blocks cost about thirty draw calls instead of four hundred.

  const ROLE_SOLITARY = 0, ROLE_EDGE = 1, ROLE_SPINE = 2, ROLE_CORE = 3;

  function recordOf(b) {
    let id = idOf.get(b);
    if (id === undefined) {
      id = nextId++;
      idOf.set(b, id);
    }
    let r = recs.get(id);
    if (r === undefined) {
      r = {
        id, c: b.c | 0, r: b.r | 0, fromR: b.r | 0,
        birth: 1, hit: 0, move: 0, frame: 0,
        hpKey: null, text: '', mat: 0, grade: 0, maxKey: null,
        seed: mix32(id * 2654435761),
      };
      recs.set(id, r);
    }
    return r;
  }

  /**
   * Draw the whole block layer.
   *
   * @param {ctx} ctx
   * @param {Array<{c:number,r:number,hp:*,max:*,mat?:string,role?:string}>} list
   */
  function blocks(ctx, list) {
    if (!ctx || !list) return;
    frameId++;
    bN = 0;

    const off = (sliding ? ease(slide) - 1 : 0) * CELL;
    const rowsToFloor = (FLOOR - TOP) / CELL;

    // A surface that draws the whole field draws it: the blocks are its
    // pieces, with their own outlines and their own numbers, and none of the
    // cell furniture below - seams, bezels, plates, scars - applies to them.
    if (surface && typeof surface.draw === 'function') {
      surface.draw(ctx, {
        cell: CELL, origin: ORIGIN, top: TOP, floor: FLOOR, width: W, off,
        rowsTall: rowsToFloor, dt: 1 / 60, blocks: list, pressure,
      });
      return;
    }
    // The leftmost world column on screen. The lattice eases cell and origin
    // together, so this is exact at rest and within a column mid-ease.
    const LO = Math.round(-ORIGIN / CELL);

    // --- pass 0: identity, occupancy -------------------------------------
    for (let i = 0; i < list.length && bN < CAPB; i++) {
      const b = list[i];
      if (!b) continue;
      const rec = recordOf(b);
      rec.frame = frameId;

      const nr = b.r | 0;
      if (nr !== rec.r) { rec.fromR = rec.r; rec.r = nr; rec.move = 1; }
      rec.c = b.c | 0;

      if (b.hp !== rec.hpKey) {
        if (rec.hpKey !== null) rec.hit = 1;
        rec.hpKey = b.hp;
        rec.text = formatTight(b.hp);
      }
      if (b.max !== rec.maxKey) {
        rec.maxKey = b.max;
        const m = materialFor(b.max);
        rec.mat = m.index; rec.grade = m.grade;
      }
      if (typeof b.mat === 'string') {
        for (let k = 0; k < MATERIALS.length; k++) if (MATERIALS[k].id === b.mat) { rec.mat = k; break; }
      }

      const idx = bN++;
      bCol[idx] = rec.c; bRow[idx] = rec.r;
      bMat[idx] = rec.mat; bGrade[idx] = rec.grade;
      bSeed[idx] = rec.seed;
      bHit[idx] = rec.hit;
      bText[idx] = rec.text;

      // Integrity in log space, so it survives health that no longer fits in a
      // double. A block at full health reads 1; a block one hit from gone
      // reads near 0.
      const lh = log10Of(b.hp), lm = log10Of(b.max);
      let integ = lm > 0 ? Math.pow(10, lh - lm) : (numOf(b.hp) > 0 ? 1 : 0);
      if (!Number.isFinite(integ)) integ = 1;
      bInt[idx] = clamp(integ, 0, 1);

      // Vertical position, easing in from the row above during a descent and
      // out of the horizon on the frame it is born.
      const moved = rec.move > 0 ? (1 - ease(1 - rec.move)) : 0;
      const y = TOP + (rec.r - moved * (rec.r - rec.fromR)) * CELL + off;
      const born = rec.birth > 0 ? ease(1 - rec.birth) : 1;
      by[idx] = y - (1 - born) * CELL * 0.5;
      bAl[idx] = born;
      bCY[idx] = by[idx];
      bCX[idx] = ORIGIN + rec.c * CELL;
      bObj[idx] = b;

      // A descending field threatens BY COLUMN: the block one row off the line
      // is the one about to end the run, and the shadow it casts says which
      // one. A field that fills threatens as a whole - no block on it is nearer
      // to the ending than any other, and judging by distance would light the
      // lowest ones for the entire run, because the bottom of the board is
      // simply where the mass lives. Lit for the whole run, the one colour that
      // means the run is about to end would stop meaning anything.
      bThreat[idx] = pressure === null
        ? clamp(1 - (rowsToFloor - 1 - rec.r) / LOOK.threatRows, 0, 1)
        : pressure;

      const sc = rec.c - LO;
      if (rec.r >= 0 && rec.r < OCC_ROWS && sc >= 0 && sc < OCC_W) {
        occ[rec.r * OCC_W + sc] = frameId;
      }
    }

    // --- pass 0.5: fusion and role ---------------------------------------
    //
    // Blocks that touch fuse. Their shared edge becomes a hairline joint
    // instead of two separate frames, which is what turns eight columns of
    // squares into architecture - a wall reads as a wall, a scatter reads as a
    // scatter, and the shape the generator drew becomes visible.
    for (let i = 0; i < bN; i++) {
      const c = bCol[i] - LO, r = bRow[i];
      let mask = 0;
      const inRow = r >= 0 && r < OCC_ROWS && c >= 0 && c < OCC_W;
      if (inRow && c > 0 && occ[r * OCC_W + c - 1] === frameId) mask |= 1;
      if (inRow && c < OCC_W - 1 && occ[r * OCC_W + c + 1] === frameId) mask |= 2;
      if (inRow && r > 0 && occ[(r - 1) * OCC_W + c] === frameId) mask |= 4;
      if (inRow && r + 1 < OCC_ROWS && occ[(r + 1) * OCC_W + c] === frameId) mask |= 8;
      bFuse[i] = mask;

      const n = (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
      bRole[i] = n >= 3 ? ROLE_CORE
        : (mask === 3 || mask === 12) ? ROLE_SPINE
        : n === 0 ? ROLE_SOLITARY : ROLE_EDGE;

      const ins = LOOK.inset;
      bx[i] = ORIGIN + c * CELL + (mask & 1 ? 0 : ins);
      bw[i] = CELL - (mask & 1 ? 0 : ins) - (mask & 2 ? 0 : ins);
      const top = (mask & 4 ? 0 : ins), bot = (mask & 8 ? 0 : ins);
      by[i] += top;
      bh[i] = CELL - top - bot;
    }

    if (surface) {
      // The field is a picture. Its faint whole goes under everything, the
      // living blocks are painted through, and the material passes - fills,
      // surface marks - are its business rather than this layer's. Seams and
      // frames stay while a cell is big enough for them to be joints and
      // corners rather than a mesh laid over the picture.
      const frame = {
        n: bN, cellX: bCX, cellY: bCY, blocks: bObj, alpha: bAl, integ: bInt,
        cell: CELL, origin: ORIGIN, top: TOP, floor: FLOOR, width: W, off,
        rowsTall: rowsToFloor,
      };
      surface.ghost(ctx, frame);
      drawScars(ctx);
      surface.paint(ctx, frame);
      if (CELL >= surface.seamMin) drawSeams(ctx);
      drawCracks(ctx);
      if (CELL >= surface.frameMin) drawBezels(ctx);
    } else {
      drawScars(ctx);
      drawFills(ctx);
      drawSeams(ctx);
      drawSignatureMarks(ctx);
      drawCracks(ctx);
      drawBezels(ctx);
    }
    drawRimLight(ctx);

    // Atmospheric perspective goes on before the numerals and never over them.
    // A surface says how much of it the picture takes.
    if (gradHaze) {
      const share = surface && Number.isFinite(surface.haze) ? surface.haze : 1;
      if (share > 0) {
        ctx.save();
        ctx.globalAlpha = share;
        ctx.fillStyle = gradHaze; ctx.fillRect(0, TOP, W, hazeH);
        ctx.restore();
      }
    }

    drawThreat(ctx);
    drawNumerals(ctx);

    // --- sweep: anything not seen this frame died ------------------------
    recs.forEach((rec, id) => {
      if (rec.frame === frameId) return;
      const c = rec.c;
      scars.push({
        x: ORIGIN + c * CELL + LOOK.inset,
        y: TOP + rec.r * CELL + LOOK.inset,
        w: CELL - LOOK.inset * 2, h: CELL - LOOK.inset * 2,
        t: 1, hex: MAT_EDGE[rec.mat][rec.grade],
      });
      recs.delete(id);
    });
    if (scars.length > 48) scars.splice(0, scars.length - 48);

  }

  /**
   * A destroyed block leaves its outline behind for three quarters of a
   * second. Clearing a row therefore reads as a wall coming down rather than
   * as squares being deleted, and the shape of what was there is still legible
   * while the debris is still in the air.
   */
  function drawScars(ctx) {
    if (!scars.length) return;
    ctx.lineWidth = 1;
    for (let i = 0; i < scars.length; i++) {
      const s = scars[i];
      const a = s.t * s.t * 0.5;
      const g = (1 - s.t) * 3;
      ctx.strokeStyle = tone.a(s.hex, a);
      ctx.strokeRect(s.x - g + 0.5, s.y - g + 0.5, s.w + g * 2 - 1, s.h + g * 2 - 1);
    }
  }

  function drawFills(ctx) {
    for (let i = 0; i < bN; i++) {
      // Worn material loses body before it loses colour.
      const a = (0.58 + 0.42 * bInt[i]) * bAl[i];
      ctx.fillStyle = tone.a(MAT_HEX[bMat[i]][bGrade[i]], a);
      ctx.fillRect(bx[i], by[i], bw[i], bh[i]);
    }
  }

  /** The joint between two fused blocks: one hairline, one stroke, whole field. */
  function drawSeams(ctx) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < bN; i++) {
      const m = bFuse[i];
      if (m & 2) {
        const x = Math.round(bx[i] + bw[i]) + 0.5;
        ctx.moveTo(x, by[i] + 2); ctx.lineTo(x, by[i] + bh[i] - 2); any = true;
      }
      if (m & 8) {
        const y = Math.round(by[i] + bh[i]) + 0.5;
        ctx.moveTo(bx[i] + 2, y); ctx.lineTo(bx[i] + bw[i] - 2, y); any = true;
      }
    }
    if (!any) return;
    ctx.strokeStyle = tone.a(PALETTE.void, LOOK.seam);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Surface structure, one path per material present. This is what makes a
   * material identifiable with the colour removed: slag is grainy, ferrite is
   * striated, quartz is faceted, cinder is full of holes, alloy is two things
   * crosshatched together, lens is concentric, core is nested.
   */
  function drawSignatureMarks(ctx) {
    if (quality < 0.4) return;
    ctx.lineWidth = 1;
    for (let m = 0; m < MATERIALS.length; m++) {
      let opened = false;
      for (let i = 0; i < bN; i++) {
        if (bMat[i] !== m) continue;
        if (bw[i] < 14 || bh[i] < 14) continue;
        if (!opened) { ctx.beginPath(); opened = true; }
        markFor(ctx, MATERIALS[m].sig, bx[i], by[i], bw[i], bh[i], bSeed[i]);
      }
      if (opened) {
        ctx.strokeStyle = tone.a(MAT_EDGE[m][0], 0.30);
        ctx.stroke();
      }
    }

    // Load-bearing blocks. A block fused on three or more sides is inside a
    // structure rather than sitting on one, and carries a keystone mark to say
    // so - which is what makes the difference between a wall and a row of
    // separate blocks readable without counting neighbours.
    let keys = false;
    for (let i = 0; i < bN; i++) {
      if (bRole[i] !== ROLE_CORE || bw[i] < 16) continue;
      if (!keys) { ctx.beginPath(); keys = true; }
      const kx = bx[i] + bw[i] / 2, ky = by[i] + bh[i] / 2, k = Math.min(bw[i], bh[i]) * 0.30;
      ctx.moveTo(kx - k, ky + k * 0.55);
      ctx.lineTo(kx, ky - k * 0.55);
      ctx.lineTo(kx + k, ky + k * 0.55);
    }
    if (keys) { ctx.strokeStyle = tone.a(PALETTE.ink, 0.13); ctx.lineWidth = 1; ctx.stroke(); }

    // Grade pips: how many times the material ladder has been round. Three
    // ticks in a corner, counted rather than read.
    let pips = false;
    for (let i = 0; i < bN; i++) {
      if (bGrade[i] <= 0) continue;
      if (!pips) { ctx.beginPath(); pips = true; }
      const px = bx[i] + bw[i] - 4, py = by[i] + 4;
      for (let g = 0; g < bGrade[i] && g < 4; g++) {
        ctx.moveTo(px - g * 3, py); ctx.lineTo(px - g * 3, py + 3);
      }
    }
    if (pips) { ctx.strokeStyle = tone.a(PALETTE.ink, 0.34); ctx.stroke(); }
  }

  function markFor(p, sig, x, y, w, h, seed) {
    const cx = x + w / 2, cy = y + h / 2;
    switch (sig) {
      case 'grain':
        for (let k = 0; k < 4; k++) {
          const gy = y + h * (0.22 + 0.19 * k);
          const gx = x + 4 + u01(seed, k) * (w - 14);
          p.moveTo(gx, gy); p.lineTo(gx + 4 + u01(seed, k + 9) * 5, gy);
        }
        break;
      case 'striate':
        for (let k = 1; k < 5; k++) {
          const gy = Math.round(y + h * k / 5) + 0.5;
          p.moveTo(x + 3, gy); p.lineTo(x + w - 3, gy);
        }
        break;
      case 'facet':
        p.moveTo(x + 2, y + h * 0.62); p.lineTo(x + w * 0.44, y + 2);
        p.moveTo(x + w * 0.44, y + 2); p.lineTo(x + w - 2, y + h * 0.48);
        p.moveTo(x + w * 0.28, y + h - 2); p.lineTo(x + w * 0.72, y + h * 0.30);
        break;
      case 'vesicle':
        for (let k = 0; k < 4; k++) {
          const vx = x + 5 + u01(seed, k + 3) * (w - 10);
          const vy = y + 5 + u01(seed, k + 17) * (h - 10);
          const r = 1.2 + u01(seed, k + 31) * 2.2;
          p.moveTo(vx + r, vy); p.arc(vx, vy, r, 0, TAU);
        }
        break;
      case 'hatch':
        for (let k = -1; k <= 1; k++) {
          const d = k * w * 0.3;
          p.moveTo(x + 3 + d, y + h - 3); p.lineTo(x + w * 0.5 + d, y + 3);
          p.moveTo(x + w - 3 - d, y + h - 3); p.lineTo(x + w * 0.5 - d, y + 3);
        }
        break;
      case 'ring':
        p.moveTo(cx + w * 0.34, cy); p.arc(cx, cy, w * 0.34, 0, TAU);
        p.moveTo(cx + w * 0.19, cy); p.arc(cx, cy, w * 0.19, 0, TAU);
        break;
      case 'nest':
        for (let k = 1; k <= 2; k++) {
          const d = k * 4.5;
          p.rect(x + d + 0.5, y + d + 0.5, w - d * 2 - 1, h - d * 2 - 1);
        }
        break;
      default: break;
    }
  }

  /**
   * Damage as fracture, not as a hue shift. Cracks start at the perimeter and
   * walk inward, and each one is a stable function of the block and its index,
   * so damage ACCUMULATES: a crack that appeared at three quarters health is
   * still in the same place when the block is nearly gone. Integrity is
   * quantised into eight steps so a block generates its crack set at most
   * eight times in its life.
   */
  function drawCracks(ctx) {
    let opened = false;
    for (let i = 0; i < bN; i++) {
      const dmg = 1 - bInt[i];
      const n = Math.min(6, Math.floor(dmg * 7));
      if (n <= 0) continue;
      if (bw[i] < 12 || bh[i] < 12) continue;
      if (!opened) { ctx.beginPath(); opened = true; }
      const x = bx[i], y = by[i], w = bw[i], h = bh[i], seed = bSeed[i];
      for (let k = 0; k < n; k++) {
        const side = h2(seed, k) % 4;
        const t = u01(seed, k + 40);
        let px, py, ang;
        if (side === 0) { px = x + t * w; py = y; ang = Math.PI / 2; }
        else if (side === 1) { px = x + w; py = y + t * h; ang = Math.PI; }
        else if (side === 2) { px = x + t * w; py = y + h; ang = -Math.PI / 2; }
        else { px = x; py = y + t * h; ang = 0; }
        ang += (u01(seed, k + 60) - 0.5) * 1.5;
        p2(ctx, px, py);
        let len = (w + h) * 0.12;
        for (let s = 0; s < 3; s++) {
          ang += (u01(seed, k * 11 + s + 80) - 0.5) * 1.1;
          px += Math.cos(ang) * len; py += Math.sin(ang) * len;
          px = clamp(px, x + 1, x + w - 1); py = clamp(py, y + 1, y + h - 1);
          ctx.lineTo(px, py);
          len *= 0.72;
        }
      }
    }
    if (!opened) return;
    ctx.strokeStyle = tone.a(PALETTE.void, 0.9);
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  function p2(ctx, x, y) { ctx.moveTo(x, y); }

  /**
   * The frame. Corner brackets rather than a full outline, because a bracket
   * can carry a length and a full outline cannot: BRACKET LENGTH IS REMAINING
   * INTEGRITY. At full health the brackets nearly close into a frame; at a
   * tenth they are nubs. A whole row's condition is readable in one glance
   * without reading a single number.
   *
   * Fused edges have no bracket - the frame belongs to the structure, not to
   * the block - so a solid wall is drawn with four brackets total and a
   * scatter of eight loose blocks is drawn with thirty-two.
   */
  function drawBezels(ctx) {
    for (let tier = 0; tier < 3; tier++) {
      let opened = false;
      for (let i = 0; i < bN; i++) {
        const th = bThreat[i];
        const t = th > 0.66 ? 2 : th > 0.01 ? 1 : 0;
        if (t !== tier) continue;
        if (!opened) { ctx.beginPath(); opened = true; }
        const x = bx[i], y = by[i], w = bw[i], h = bh[i], m = bFuse[i];
        const len = Math.min(Math.min(w, h) * 0.46,
          2.5 + LOOK.bracket * Math.min(w, h) * bInt[i]);
        // top-left
        if (!(m & 1) && !(m & 4)) { ctx.moveTo(x + 0.5, y + len); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + len, y + 0.5); }
        if (!(m & 2) && !(m & 4)) { ctx.moveTo(x + w - len, y + 0.5); ctx.lineTo(x + w - 0.5, y + 0.5); ctx.lineTo(x + w - 0.5, y + len); }
        if (!(m & 1) && !(m & 8)) { ctx.moveTo(x + 0.5, y + h - len); ctx.lineTo(x + 0.5, y + h - 0.5); ctx.lineTo(x + len, y + h - 0.5); }
        if (!(m & 2) && !(m & 8)) { ctx.moveTo(x + w - len, y + h - 0.5); ctx.lineTo(x + w - 0.5, y + h - 0.5); ctx.lineTo(x + w - 0.5, y + h - len); }
        // Solitary blocks close their frame entirely. They are objects, not walls.
        if (bRole[i] === ROLE_SOLITARY && bInt[i] > 0.85) {
          ctx.moveTo(x + len, y + 0.5); ctx.lineTo(x + w - len, y + 0.5);
          ctx.moveTo(x + len, y + h - 0.5); ctx.lineTo(x + w - len, y + h - 0.5);
        }
      }
      if (!opened) continue;
      ctx.lineWidth = tier === 2 ? 1.4 : 1;
      ctx.strokeStyle = tier === 2
        ? tone.a(PALETTE.hot, 0.55 + 0.35 * pulse(2.2))
        : tier === 1
          ? tone.a(PALETTE.hot, 0.30)
          : tone.a(PALETTE.ink, 0.16);
      ctx.stroke();
    }

    // Integrity, on the one edge every block has whether or not it is fused
    // into a wall. A rule along the top inside edge, left aligned so a whole
    // row can be compared at a glance, whose LENGTH is the share of health
    // remaining. Corner brackets say the same thing about the outside of a
    // structure; this says it about every block inside one, which is most of
    // them once the field starts building walls.
    let wear = false;
    for (let i = 0; i < bN; i++) {
      if (bw[i] < 12) continue;
      const run = (bw[i] - 7) * bInt[i];
      if (run < 1) continue;
      if (!wear) { ctx.beginPath(); wear = true; }
      const wy = Math.round(by[i] + 3.5) + 0.5;
      ctx.moveTo(bx[i] + 3.5, wy); ctx.lineTo(bx[i] + 3.5 + run, wy);
    }
    if (wear) {
      ctx.strokeStyle = tone.a(PALETTE.ink, 0.40);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // A struck block flares along its frame for a sixth of a second. Impact is
    // already carried by numbers and debris; this says WHICH block took it.
    let hot = false;
    for (let i = 0; i < bN; i++) {
      if (bHit[i] <= 0) continue;
      if (!hot) { ctx.beginPath(); hot = true; }
      ctx.rect(bx[i] + 0.5, by[i] + 0.5, bw[i] - 1, bh[i] - 1);
    }
    if (hot) {
      let a = 0;
      for (let i = 0; i < bN; i++) if (bHit[i] > a) a = bHit[i];
      ctx.strokeStyle = tone.a(PALETTE.ink, a * 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * The only light source in this world is the swarm, and it is below you.
   * Every free bottom edge picks up a rim of it, through one cached gradient
   * that falls off with height - so the field is lit from underneath, distance
   * is reinforced without another pass, and the whole screen gets brighter as
   * the swarm grows. A large swarm does not just read on a counter. It changes
   * how the world looks.
   */
  function drawRimLight(ctx) {
    if (!gradRim) return;
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < bN; i++) {
      if (bFuse[i] & 8) continue;
      const y = Math.round(by[i] + bh[i]) - 0.5;
      ctx.moveTo(bx[i] + 1, y); ctx.lineTo(bx[i] + bw[i] - 1, y);
      any = true;
    }
    if (!any) return;
    ctx.strokeStyle = gradRim;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * The health number. The most important text on the screen, and the rules
   * around it are absolute: always full-opacity ink, never hazed, never
   * pulsed, never tinted by damage, never smaller than 10px, and always over a
   * fill capped at 30% lightness. Everything else in the system gives way to
   * this.
   */
  function drawNumerals(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = '';
    // A surface can be any colour, so its numerals sit on a plate of void;
    // and below a size the surface names, a cell carries no number at all -
    // the picture is the information at that size.
    const minPx = surface ? surface.minNumeral : 12;
    const plate = !!(surface && surface.backing);
    for (let i = 0; i < bN; i++) {
      const txt = bText[i];
      if (!txt || bw[i] < minPx || bh[i] < minPx) continue;
      const size = txt.length <= 3 ? 14 : txt.length === 4 ? 12 : 10;
      const f = '600 ' + size + 'px ' + FONT;
      if (f !== font) { ctx.font = f; font = f; }
      const cx = bx[i] + bw[i] / 2, cy = by[i] + bh[i] / 2;
      if (plate) {
        const pw = Math.min(bw[i] - 2, txt.length * size * 0.62 + 6), ph = Math.min(bh[i] - 2, size + 4);
        ctx.fillStyle = tone.a(PALETTE.void, 0.62 * Math.min(1, bAl[i] * 1.7));
        ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
      }
      ctx.fillStyle = tone.a(PALETTE.ink, Math.min(1, bAl[i] * 1.7));
      ctx.fillText(txt, cx, cy + 0.5);
    }
  }

  /**
   * Proximity to the line, shown as a shadow the block casts down onto the
   * swarm. The columns about to be breached are the ones with something
   * falling out of them, which needs no legend and no colour vocabulary.
   */
  function drawThreat(ctx) {
    for (let i = 0; i < bN; i++) {
      const th = bThreat[i];
      if (th < 0.02) continue;
      const x = bx[i], w = bw[i], y = by[i] + bh[i];
      const drop = FLOOR - y;
      if (drop <= 0) continue;
      const a = th * th * 0.44 * (0.70 + 0.30 * pulse(1.6));
      ctx.fillStyle = tone.a(PALETTE.hot, a);
      ctx.fillRect(x, y, w, drop);
    }
  }

  /** A slow triangle wave in 0..1. The only oscillator in the system. */
  function pulse(hz) {
    if (reduced) return 0.5;
    return 0.5 + 0.5 * Math.sin(clock * TAU * hz);
  }

  /**
   * One block, drawn on its own. The batched path above is what the game
   * should call; this exists for tools, previews and documentation, where a
   * single block needs to be drawn outside a field.
   */
  function block(ctx, b, x, y, size) {
    if (!ctx || !b) return;
    const s = size > 0 ? size : CELL - LOOK.inset * 2;
    const px = x === undefined ? ORIGIN + b.c * CELL + LOOK.inset : x;
    const py = y === undefined ? TOP + b.r * CELL + LOOK.inset : y;
    const m = materialFor(b.max);
    const lh = log10Of(b.hp), lm = log10Of(b.max);
    const integ = clamp(lm > 0 ? Math.pow(10, lh - lm) : 1, 0, 1);
    const seed = mix32(((b.c | 0) * 733) ^ ((b.r | 0) * 977));

    ctx.fillStyle = tone.a(MAT_HEX[m.index][m.grade], 0.58 + 0.42 * integ);
    ctx.fillRect(px, py, s, s);
    ctx.beginPath(); markFor(ctx, m.mat.sig, px, py, s, s, seed);
    ctx.strokeStyle = tone.a(MAT_EDGE[m.index][0], 0.30); ctx.lineWidth = 1; ctx.stroke();

    const len = Math.min(s * 0.46, 2.5 + LOOK.bracket * s * integ);
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + len); ctx.lineTo(px + 0.5, py + 0.5); ctx.lineTo(px + len, py + 0.5);
    ctx.moveTo(px + s - len, py + 0.5); ctx.lineTo(px + s - 0.5, py + 0.5); ctx.lineTo(px + s - 0.5, py + len);
    ctx.moveTo(px + 0.5, py + s - len); ctx.lineTo(px + 0.5, py + s - 0.5); ctx.lineTo(px + len, py + s - 0.5);
    ctx.moveTo(px + s - len, py + s - 0.5); ctx.lineTo(px + s - 0.5, py + s - 0.5); ctx.lineTo(px + s - 0.5, py + s - len);
    ctx.strokeStyle = tone.a(PALETTE.ink, 0.16); ctx.stroke();

    const txt = formatTight(b.hp);
    ctx.font = '600 ' + (txt.length <= 3 ? 14 : txt.length === 4 ? 12 : 10) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(txt, px + s / 2, py + s / 2 + 0.5);
  }

  // =========================================================================
  // PICKUPS
  // =========================================================================
  //
  // Every meaning that has a colour also has a silhouette, so nothing here
  // depends on telling cyan from amber. A swarm pickup is a ring with an open
  // aperture; essence is a faceted lozenge. Shape carries it, colour confirms
  // it, and the value is printed on both.

  function pickups(ctx, list) {
    if (!ctx || !list || !list.length) return;
    const off = (sliding ? ease(slide) - 1 : 0) * CELL;
    const spin = reduced ? 0 : clock * 0.5;

    ctx.lineWidth = 1.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      const px = ORIGIN + p.c * CELL + CELL / 2;
      const py = TOP + p.r * CELL + CELL / 2 + off;
      const r = CELL * 0.20;
      const gold = p.kind === 'gold' || p.kind === 'essence';

      if (gold) {
        // A cut stone: four facets meeting at a lit centre.
        ctx.beginPath();
        ctx.moveTo(px, py - r); ctx.lineTo(px + r * 0.78, py);
        ctx.lineTo(px, py + r); ctx.lineTo(px - r * 0.78, py);
        ctx.closePath();
        ctx.fillStyle = tone.a(PALETTE.essence, 0.20);
        ctx.fill();
        ctx.strokeStyle = tone.a(PALETTE.essence, 0.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - r * 0.78, py); ctx.lineTo(px + r * 0.78, py);
        ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
        ctx.strokeStyle = tone.a(PALETTE.essence, 0.30);
        ctx.stroke();
      } else {
        // An aperture: three arcs with gaps, turning slowly.
        ctx.strokeStyle = tone.a(PALETTE.swarm, 0.85);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a0 = spin + k * TAU / 3 + 0.22;
          ctx.arc(px, py, r, a0, a0 + TAU / 3 - 0.44);
          ctx.moveTo(px + Math.cos(a0 + TAU / 3) * r, py + Math.sin(a0 + TAU / 3) * r);
        }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, r * 0.30, 0, TAU);
        ctx.fillStyle = tone.a(PALETTE.swarm, 0.55); ctx.fill();
      }

      const label = p.value !== undefined ? formatTight(p.value) : (gold ? '' : '+1');
      if (label) {
        ctx.font = '600 9px ' + FONT;
        ctx.fillStyle = tone.a(gold ? PALETTE.essence : PALETTE.swarm, 0.95);
        ctx.fillText(label, px, py + r + 7);
      }
    }
  }

  // =========================================================================
  // AIM
  // =========================================================================

  /**
   * The aim guide, drawn as an instrument rather than as a dotted line: a ray
   * that fades with distance, ticked at regular intervals so the player can
   * read range off it, and the launch angle printed at the origin.
   *
   * @param {ctx} ctx
   * @param {number} ox origin x
   * @param {number} oy origin y
   * @param {number} dx unit direction x
   * @param {number} dy unit direction y
   * @param {number} [len=520] ray length
   */
  /**
   * The aim ray.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.clamped] the drag was flatter than the launcher will
   *        take and has been slid along the limit. Drawn in a different colour
   *        and labelled, because the alternative - which is what this used to do
   *        - was to draw nothing at all, which told the player neither that a
   *        rule existed nor what it was.
   * @param {number} [opts.limit] the flattest legal shot as a vertical unit, so
   *        the two limit rays can be shown as the aim approaches them. The rule
   *        reveals itself exactly when it starts to matter and stays invisible
   *        the rest of the time.
   */
  function aim(ctx, ox, oy, dx, dy, len, opts) {
    if (!ctx) return;
    const L = len > 0 ? len : Math.max(W, H);
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n, uy = dy / n;
    const o = opts || {};
    const hue = o.clamped ? PALETTE.essence : PALETTE.swarm;

    // The forbidden wedge, shown as the aim comes near it. Both sides, because
    // the limit is symmetric and seeing only the near one reads as an edge
    // rather than as a rule.
    if (o.limit > 0) {
      const near = (-uy) - o.limit;
      const show = o.clamped ? 1 : Math.max(0, 1 - near / 0.16);
      if (show > 0.02) {
        const lx = Math.sqrt(Math.max(0, 1 - o.limit * o.limit));
        ctx.save();
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = tone.a(PALETTE.essence, 0.30 * show);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + side * lx * L * 1.15, oy - o.limit * L * 1.15);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.save();
    ctx.lineWidth = 1;
    // The ray, in four segments that each fade a little further.
    for (let s = 0; s < 4; s++) {
      const a0 = s / 4, a1 = (s + 1) / 4;
      ctx.strokeStyle = tone.a(hue, 0.42 * (1 - a0));
      ctx.beginPath();
      ctx.moveTo(ox + ux * L * a0, oy + uy * L * a0);
      ctx.lineTo(ox + ux * L * a1, oy + uy * L * a1);
      ctx.stroke();
    }
    // Range ticks every forty pixels, perpendicular to the ray.
    ctx.beginPath();
    for (let d = 40; d < L; d += 40) {
      const px = ox + ux * d, py = oy + uy * d;
      if (py < TOP || py > FLOOR) continue;
      ctx.moveTo(px - uy * 3, py + ux * 3);
      ctx.lineTo(px + uy * 3, py - ux * 3);
    }
    ctx.strokeStyle = tone.a(hue, 0.28);
    ctx.stroke();

    const deg = Math.round(Math.atan2(-uy, ux) * 180 / Math.PI);
    ctx.font = '600 10px ' + FONT;
    ctx.textAlign = ux > 0 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = tone.a(hue, 0.85);
    // The angle, and - when the drag has been slid along the limit - the fact
    // that it has been. A player who drags too low sees the line stop moving
    // AND is told why, in the same glance.
    ctx.fillText(deg + '\u00b0' + (o.clamped ? '  ' + (o.label || 'limit') : ''),
                 ox + (ux > 0 ? -10 : 10), oy - 8);
    ctx.restore();
  }

  // =========================================================================
  // BODIES
  // =========================================================================

  /**
   * Live bodies. Each is an ellipse elongated along its own velocity, so speed
   * is visible in the shape and not only in the trail, and every body in the
   * field goes into a single path and a single fill.
   *
   * A body that carries a stack - one circle standing for a billion balls -
   * is ringed, and the number of rings is the log of what it carries. That is
   * how an unbounded swarm stays visible inside a bounded number of circles.
   */
  function bodies(ctx, list, radius) {
    if (!ctx || !list || !list.length) return;
    // Bodies shrink as the field fills. Four hundred circles at the size one
    // circle wants to be is a white sheet, not a swarm.
    const R = (radius > 0 ? radius : 5) * clamp(1.3 - 0.32 * Math.log10(Math.max(1, list.length)), 0.48, 1);
    const hasEllipse = typeof ctx.ellipse === 'function';
    // Elongating a body along its velocity says "this one is moving fast", which
    // is worth saying about eight bodies and worth nothing about four hundred -
    // where the trails already carry it and the tessellation is the most
    // expensive thing on screen.
    const detailed = list.length <= 48;

    // A few bodies are individuals and carry their own light. Hundreds of
    // bodies are a stream, and giving each one a halo turns the field into fog
    // and costs more than every other pass combined - so the corona is what
    // separates a handful from a flood, and the flood does without it.
    if (detailed) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || !Number.isFinite(b.x)) continue;
        const r = (b.size > 0 ? b.size : 1) * R;
        ctx.moveTo(b.x + r * 1.9, b.y);
        ctx.arc(b.x, b.y, r * 1.9, 0, TAU);
      }
      ctx.fillStyle = tone.a(PALETTE.swarm, 0.12);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !Number.isFinite(b.x)) continue;
      const r = (b.size > 0 ? b.size : 1) * R;
      const sp = Math.hypot(b.vx || 0, b.vy || 0);
      if (hasEllipse && detailed && sp > 0.001) {
        const st = clamp(sp / 26, 0, 0.55);
        ctx.moveTo(b.x + r * (1 + st), b.y);
        ctx.ellipse(b.x, b.y, r * (1 + st), r * (1 - st * 0.6), Math.atan2(b.vy, b.vx), 0, TAU);
      } else {
        ctx.moveTo(b.x + r, b.y);
        ctx.arc(b.x, b.y, r, 0, TAU);
      }
    }
    ctx.fillStyle = tone.a(PALETTE.ink, detailed ? 1 : 0.86);
    ctx.fill();

    // A body carrying a stack - one circle standing for a billion balls - gets
    // a single hard rim, and the rim THICKENS with the log of what it carries.
    // One ring rather than nested ones, because nested cyan circles are what a
    // pickup looks like and two things must never share a silhouette.
    for (let w = 1; w <= 4; w++) {
      let any = false;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || !b.stack) continue;
        const lgs = log10Of(b.stack);
        if (lgs < 0.5) continue;
        if (Math.min(4, Math.ceil(lgs / 3)) !== w) continue;
        if (!any) { ctx.beginPath(); any = true; }
        const rr = (b.size > 0 ? b.size : 1) * R + 1.5 + w * 0.5;
        ctx.moveTo(b.x + rr, b.y);
        ctx.arc(b.x, b.y, rr, 0, TAU);
      }
      if (!any) continue;
      ctx.strokeStyle = tone.a(PALETTE.swarm, 0.75);
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }

  /**
   * The launcher: an aperture sitting on the surface of the pool, opening as
   * the swarm is drawn out of it. It is not a ball. It is the place the swarm
   * comes from.
   */
  function launcher(ctx, x, y) {
    if (!ctx) return;
    const py = y === undefined ? FLOOR : y;
    const open = 0.5 + 0.5 * flight;
    const r = 6 + 3 * open;

    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = tone.a(PALETTE.swarm, 0.85);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a0 = k * TAU / 4 + 0.30 + (reduced ? 0 : clock * 0.4);
      ctx.arc(x, py, r, a0, a0 + TAU / 4 - 0.60);
      ctx.moveTo(x + Math.cos(a0 + TAU / 4) * r, py + Math.sin(a0 + TAU / 4) * r);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, py, 2.6 + 1.4 * (1 - flight), 0, TAU);
    ctx.fillStyle = tone.a(PALETTE.swarm, 0.95);
    ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // THE SWARM
  // =========================================================================
  //
  // This is the point of the game, so it is worth being exact about what it
  // does. The band below the line is not a meter and not decoration. It is the
  // swarm, drawn, and it is designed to pass through three states without ever
  // switching between them:
  //
  //   COUNTABLE     one to a few dozen. Every member is a separate mark with
  //                 its own drift. You can count them, and at one you can see
  //                 that you have one.
  //
  //   RESOLVING     up to a couple of thousand. The marks grow, soften and
  //                 begin to overlap. The eye gives up somewhere in here, and
  //                 the exact place it gives up is different for every player.
  //                 That moment is the thing the game exists to produce.
  //
  //   CONTINUUM     beyond that. Individuals are gone. What is left is a
  //                 density - a lit, moving mass with currents in it, whose
  //                 brightness and turbulence keep climbing on a log scale
  //                 long after its height has saturated.
  //
  // There is no mode switch anywhere in the code below. Four parameters -
  // primitive count, radius, opacity and turbulence - are continuous functions
  // of log10(count), and the three states are what those functions look like
  // at different magnitudes. Crossing from one to the next is a gradient, not
  // an event.
  //
  // The primitive count is CAPPED. A swarm of ten draws ten discs; a swarm of
  // 10^40 draws the same two hundred and forty as a swarm of ten thousand, at
  // a lower opacity, accumulating under a lighter blend into something
  // brighter. Cost is flat from four bodies to the end of the number system.

  function swarmBand(ctx) {
    if (!ctx) return;
    const lg = swLog;
    const q = quality;

    // How deep into the band the mass reaches. Saturates around ten thousand.
    const fill = 0.16 + 0.84 * (1 - Math.exp(-lg / 2.4));
    // How bright it burns. Keeps climbing long after the height has stopped.
    const lum = clamp(lg / 11, 0, 1);
    // Turbulence is the one channel with headroom left after height and
    // brightness have both saturated. A swarm of ten thousand is a full band; a
    // swarm of ten to the seventeenth is a full band that will not hold still.
    const turb = clamp(lg / 14, 0, 1);
    // A small swarm is a tight knot near the launcher. A vast one fills the
    // world. The mass spreads outward as it grows, so width is magnitude too.
    const spreadX = clamp(0.30 + 0.15 * lg, 0.30, 1);

    const approx = numOf(swRaw);
    const cap = Math.round(LOOK.discs * clamp(q, 0.35, 1));
    let P = Math.max(1, Math.min(cap, Math.round(Number.isFinite(approx) ? approx : cap)));

    // The strobe: for half a second the mass separates back into individuals,
    // then melts together again. It is the only time a large swarm is ever
    // shown as a set of things rather than as a quantity.
    const res = reduced ? 0 : resolveT * resolveT;

    // Radius climbs hard with magnitude. At a handful of bodies the discs are
    // separate marks; by a million they overlap several times over and stop
    // being marks at all. This is the whole mechanism by which the swarm stops
    // being countable, and it costs the same either way.
    const r = lerp(2.6 + 10.4 * clamp(lg / 6, 0, 1), 1.8, res);
    const baseA = clamp(3.0 / Math.pow(P, 0.52), 0.05, 0.92);
    const alpha = lerp(baseA * (0.75 + 0.55 * lum), Math.min(0.95, baseA * 3), res);

    ctx.save();

    // Surface first: the pool is filled downward from the line.
    const surfY = i => FLOOR - sh[i] - flight * 3;

    // Clipping to the rippled surface is only worth its cost while the surface
    // is actually moving. A calm pool clips to a rectangle instead, which is a
    // fraction of the price and pixel-identical.
    let rip = 0;
    for (let i = 0; i < SURF; i++) { const v = sh[i] < 0 ? -sh[i] : sh[i]; if (v > rip) rip = v; }
    ctx.beginPath();
    if (rip > 0.6) {
      ctx.moveTo(0, H);
      for (let i = 0; i < SURF; i++) ctx.lineTo(i / (SURF - 1) * W, surfY(i));
      ctx.lineTo(W, H);
      ctx.closePath();
    } else {
      ctx.rect(0, FLOOR - flight * 3, W, H - FLOOR + flight * 3);
    }
    ctx.clip();

    // Body of the pool: a dark base so the discs have something to sit in.
    // A floor of light under the discs, so a vast swarm never reads as gaps.
    ctx.fillStyle = tone.a(PALETTE.swarm, 0.04 + 0.24 * lum);
    ctx.fillRect(0, FLOOR - 10, W, BAND + 10);

    ctx.globalCompositeOperation = 'lighter';

    // Members of the swarm, in three depth bands so the mass is lit from its
    // own surface. Positions come from an R2 low-discrepancy sequence, which
    // covers evenly without the clumping that makes uniform random noise look
    // like dirt, and a flow field pushes them into currents.
    const sprite = moteSprite();
    const depthTop = FLOOR;
    const reach = BAND * fill;
    for (let band = 0; band < 3; band++) {
      const bandA = alpha * (band === 0 ? 1 : band === 1 ? 0.74 : 0.52);
      if (bandA < 0.004) continue;
      let opened = false;
      for (let i = band; i < P; i += 3) {
        const ux = (i * 0.7548776662466927) % 1;
        const uy = (i * 0.5698402909980532) % 1;
        let px = W * 0.5 + (ux - 0.5) * W * spreadX;
        let py = depthTop + (0.02 + 0.98 * uy) * reach;
        const drift = (2 + 9 * turb) * (1 - res);
        px += Math.sin(py * 0.10 + clock * (0.85 + turb) + i * 0.7) * drift;
        py += Math.cos(px * 0.055 + clock * (0.62 + turb * 0.8) + i * 1.3) * drift * 0.45;
        const rr = r * (0.7 + 0.6 * ((i * 2654435761 >>> 8) & 15) / 15);
        if (sprite) {
          if (!opened) { ctx.globalAlpha = bandA; opened = true; }
          ctx.drawImage(sprite.cv, px - rr, py - rr, rr * 2, rr * 2);
        } else {
          if (!opened) { ctx.beginPath(); opened = true; }
          ctx.moveTo(px + rr, py);
          ctx.arc(px, py, rr, 0, TAU);
        }
      }
      if (opened && !sprite) { ctx.fillStyle = tone.a(PALETTE.swarm, bandA); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // The crest: the surface of the pool, and the line a block has to touch to
    // end the run. It follows the ripple field, and it is drawn in segments
    // whose brightness travels along it - so a large swarm has a surface that
    // will not sit still, and the death line is never a flat drawn rule.
    ctx.save();
    const SEG = 8, per = (SURF - 1) / SEG;
    const crestCol = lum > 0.6 ? PALETTE.ink : PALETTE.swarm;
    ctx.lineWidth = 1.2 + 0.9 * lum;
    for (let g = 0; g < SEG; g++) {
      const i0 = Math.floor(g * per), i1 = Math.ceil((g + 1) * per);
      ctx.beginPath();
      for (let i = i0; i <= i1 && i < SURF; i++) {
        const x = i / (SURF - 1) * W, y = surfY(i);
        if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const caustic = 0.5 + 0.5 * Math.sin(g * 1.7 - clock * (0.9 + turb * 1.6));
      ctx.strokeStyle = tone.a(crestCol, (0.30 + 0.45 * lum) * (0.55 + 0.45 * caustic));
      ctx.stroke();
    }
    ctx.restore();

    // The count, printed. The band and the number are the same fact stated
    // twice, which is how a player learns to read the band.
    ctx.font = '600 10px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = tone.a(PALETTE.swarm, 0.75);
    ctx.fillText(swText, W - 8, H - 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = tone.a(PALETTE.dim, 0.55);
    ctx.fillText('swarm', 8, H - 8);

  }

  // =========================================================================
  // FOREGROUND
  // =========================================================================

  /**
   * The last pass: the light the swarm throws up into the field, and a
   * vignette that pulls the eye to the middle without darkening anything that
   * has to be read. Draw after the effects layer, before the frame ends.
   */
  function foreground(ctx) {
    if (!ctx) return;
    ensureGradients(ctx);

    drawTransit(ctx);

    // The swarm throws light up into the field. This is the only full-width
    // additive pass in the layer, and it is held to two rows for that reason.
    if (gradPool) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradPool;
      ctx.fillRect(0, FLOOR - poolReach, W, poolReach);
      ctx.restore();
    }

    // Self-governing detail. If the layer is running over its budget it steps
    // itself down rather than dropping frames, and steps back up when it can.
    //
    // The whole frame is measured with ONE pair of timestamps, from the first
    // draw call to the last, rather than one pair per pass. Two things force
    // that: browsers clamp the clock to a tenth of a millisecond, so seven
    // small windows are mostly quantisation error, and canvas work is
    // deferred, so the cost of a pass is not paid inside the call that
    // submitted it. One window per frame catches the work wherever it lands.
    if (frameT0) {
      costEma = costEma * 0.88 + (now() - frameT0) * 0.12;
      frameT0 = 0;
      if (autoQuality) {
        if (costEma > budgetMs) {
          if (++overrun > 45) { quality = Math.max(0.35, quality - 0.15); overrun = 0; sigCache.clear(); layers.clear(); }
        } else if (costEma < budgetMs * 0.55) {
          if (--overrun < -240) { quality = Math.min(1, quality + 0.15); overrun = 0; sigCache.clear(); layers.clear(); }
        } else overrun = 0;
      }
    }
  }

  // =========================================================================
  // READOUT PRIMITIVES
  // =========================================================================
  //
  // The shell is spare; the readout is not. Panels are allowed to be dense -
  // numbers presented without apology, aligned in columns, separated by
  // hairlines and nothing else. These two primitives are how any future panel
  // draws itself so every panel in the game looks like the same instrument.

  /**
   * A block of label and value pairs, tabular and right-aligned, with hairline
   * separators. Values may be numbers, { m, e } pairs or strings.
   *
   * @param {ctx} ctx
   * @param {number} x left edge
   * @param {number} y top edge
   * @param {number} w width
   * @param {Array<[string, *, string=]>} rows label, value, optional tint key
   * @returns {number} the height it drew
   */
  function readout(ctx, x, y, w, rows) {
    if (!ctx || !rows || !rows.length) return 0;
    const lh = 15;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < rows.length; i++) {
      const ry = y + i * lh + lh / 2;
      if (i > 0) {
        ctx.strokeStyle = tone.a(PALETTE.rule, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, Math.round(ry - lh / 2) + 0.5);
        ctx.lineTo(x + w, Math.round(ry - lh / 2) + 0.5);
        ctx.stroke();
      }
      ctx.font = '500 9px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = tone.a(PALETTE.dim, 0.9);
      ctx.fillText(String(rows[i][0]).toUpperCase(), x, ry);

      const raw = rows[i][1];
      const txt = typeof raw === 'string' ? raw : format(raw);
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE[rows[i][2]] || PALETTE.ink;
      ctx.fillText(txt, x + w, ry);
    }
    return rows.length * lh;
  }

  /**
   * A deterministic emblem for a name: doctrines, materials, achievements,
   * anything that wants a mark and cannot have an image file. The same string
   * always draws the same figure, built from a ring, a set of spokes and a
   * chord pattern chosen by the hash.
   */
  function glyph(ctx, x, y, size, seed, tint) {
    if (!ctx) return;
    const hs = typeof seed === 'string' ? hashStr(seed) : mix32(seed | 0);
    const r = size / 2;
    const spokes = 3 + (hs % 5);
    const inner = 0.3 + ((hs >>> 3) % 5) / 12;
    const rot = ((hs >>> 7) % 32) / 32 * TAU;
    const col = tint || PALETTE.ink;

    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = tone.a(col, 0.85);
    ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, TAU); ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = rot + i * TAU / spokes;
      const b = rot + ((i + 1 + ((hs >>> 11) % spokes)) % spokes) * TAU / spokes;
      ctx.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
      ctx.lineTo(x + Math.cos(b) * r * 0.92, y + Math.sin(b) * r * 0.92);
    }
    ctx.strokeStyle = tone.a(col, 0.55);
    ctx.stroke();

    ctx.beginPath(); ctx.arc(x, y, r * inner, 0, TAU);
    ctx.fillStyle = tone.a(col, 0.9); ctx.fill();
    ctx.restore();
  }

  /**
   * A single line of state, centred, backed so it stays legible over a busy
   * field. Every signal in this game is visible; this is the one that is also
   * literal.
   */
  function caption(ctx, text, y, tintKey) {
    if (!ctx || !text) return;
    const t = String(text).toUpperCase().slice(0, 40);
    const py = y === undefined ? TOP + (FLOOR - TOP) * 0.30 : y;
    const ls = 'letterSpacing' in ctx;
    if (ls) ctx.letterSpacing = '0.24em';
    ctx.font = '600 12px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(t).width + 40;
    ctx.fillStyle = tone.a(PALETTE.void, 0.82);
    ctx.fillRect((W - w) / 2, py - 13, w, 26);
    ctx.strokeStyle = tone.a(PALETTE[tintKey] || PALETTE.swarm, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo((W - w) / 2, py - 13.5); ctx.lineTo((W + w) / 2, py - 13.5);
    ctx.moveTo((W - w) / 2, py + 12.5); ctx.lineTo((W + w) / 2, py + 12.5);
    ctx.stroke();
    ctx.fillStyle = PALETTE[tintKey] || PALETTE.ink;
    ctx.fillText(t, W / 2, py);
    if (ls) ctx.letterSpacing = '0px';
  }

  // =========================================================================
  // CONTROL
  // =========================================================================

  /** Drop every animation and cached identity. Call on restart. */
  function clear() {
    recs.clear();
    scars.length = 0;
    marks.length = 0;
    sh.fill(0); sv.fill(0);
    slide = 0; sliding = false;
    transitT = 0; resolveT = 0; flight = 0;
    depth = 1; regimeIndex = -1;
    regimeKey = 'opening'; regimeName = 'drift'; regimeNext = '';
    prevSigs = null; curSigs = sigsFor('opening');
    hue = hueTo = REGIME_HUES.opening;
    swLog = 0; swText = '1'; swRaw = 1;
    occ.fill(0); frameId = 0;
    gradKey = '';
    layers.clear();
  }

  /** Match new canvas geometry. */
  function resize(width, height, top, floorY, cols) {
    if (width > 0) W = width;
    if (height > 0) H = height;
    if (top >= 0) TOP = top;
    FLOOR = floorY > 0 ? floorY : H - 54;
    if (cols > 0) COLS = cols;
    CELL = W / COLS;
    BAND = H - FLOOR;
    gradKey = '';
    sigCache.clear();
    layers.clear();
  }

  /**
   * Move the lattice. `cols` is how many columns fill the screen, `cell` their
   * width in pixels, and `origin` where world column zero sits.
   *
   * Called every frame while the view is pulling back, so it clears nothing:
   * the backdrop is keyed on the cell size and the layer cache evicts by
   * budget, which turns a continuous ease into a handful of bakes rather than
   * one per frame.
   */
  function setLattice(cols, cell, origin) {
    if (cols > 0 && cols !== COLS) {
      COLS = cols;
      if (COLS + 8 > OCC_W) { OCC_W = COLS + 8; occ = new Int32Array(OCC_W * OCC_ROWS); }
    }
    CELL = cell > 0 ? cell : W / COLS;
    ORIGIN = Number.isFinite(origin) ? origin : 0;
  }

  /**
   * What the blocks are made of, when it is not a material. A surface paints
   * the block fills itself: `ghost(ctx, frame)` under the field, `paint(ctx,
   * frame)` through the living blocks, plus the sizes at which numerals,
   * seams and frames stop. Pass null to go back to materials.
   */
  function setSurface(s) {
    surface = s && (typeof s.paint === 'function' || typeof s.draw === 'function') ? s : null;
  }

  /** The column grid in the backdrop. Off for a field that is a picture. */
  function setGrid(on) {
    const v = !!on;
    if (v === gridOn) return;
    gridOn = v;
    layers.clear();
  }

  /** Detail multiplier, 0.25 (bare) to 1 (full). Pins auto-quality off. */
  function setQuality(v) {
    quality = clamp(Number(v) || 1, 0.25, 1);
    autoQuality = false;
    sigCache.clear();
    layers.clear();
  }
  function setAutoQuality(on) { autoQuality = !!on; }

  /**
   * How close the run is to ending, 0 to 1, for a field where that is a
   * property of the BOARD rather than of any one block. Pass null - which is
   * the default - for a field that closes on the swarm line, where a block's
   * own distance from it is the better answer and says which column as well as
   * how close.
   */
  function setPressure(p) {
    pressure = (p === null || p === undefined) ? null : clamp(Number(p) || 0, 0, 1);
  }

  /** Motion damping. Ambient drift stops; nothing that carries state stops. */
  function setReducedMotion(on) { reduced = !!on; }

  /** Live figures, for a debug readout. Not for use in the frame loop. */
  function stats() {
    return {
      quality, costMs: Math.round(costEma * 1000) / 1000,
      blocks: bN, records: recs.size, scars: scars.length, marks: marks.length,
      swarmLog: Math.round(swLog * 100) / 100, regime: regimeName, hue: Math.round(hue),
      sliding, transit: transitT,
    };
  }

  // =========================================================================
  // THE PAGE AROUND THE BOARD
  // =========================================================================
  //
  // Everything above draws inside the canvas. This is the one thing that
  // reaches outside it: the colours the page itself should be wearing while
  // this field is on screen. The page is CSS and cannot see the hue the field
  // is drawn at, so left alone it stays whatever it was authored as - which
  // is a frame that belongs to a different picture the moment the field is
  // strongly coloured.
  //
  // Returned as custom property names so the caller sets them and needs to
  // know nothing about how a colour was arrived at. Values change only as the
  // hue drifts, and the drift is slow, so the same object comes back for as
  // long as it is still the right one.

  const GROUND = (() => {
    const g = CONFIG.feel && CONFIG.feel.ground;
    if (!g) return null;
    const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      sat: n(g.sat, 34), satMax: n(g.satMax, 50), refShare: n(g.refShare, 0.7),
      page: n(g.page, 6), panel: n(g.panel, 3), line: n(g.line, 9.5),
    };
  })();

  /** A css hex as hsl percentages. */
  function hslOf(css) {
    const c = tone.rgb(css);
    if (!c) return null;
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return { h: hue, s: 0, l: l * 100 };
    const d = mx - mn;
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: sat * 100, l: l * 100 };
  }

  let shellKey = -1;
  let shellVars = null;

  /**
   * The page's colours for whatever is being played right now.
   *
   * @param {string} [ref]  a colour the field is drawn on, if it names one.
   *   Its hue and saturation are used instead of the regime's; a field that
   *   paints its own picture knows what it sits on better than the hue the
   *   backdrop is washed at does.
   * @returns {Object|null} custom property name to value, or null when the
   *   page should keep the palette it was given.
   */
  function shell(ref) {
    if (!GROUND) return null;
    const from = ref ? hslOf(ref) : null;
    const h = from ? from.h : hue;
    // A field's own ground can be far more saturated than a wash. Capped, or
    // the page stops being quiet and starts being a colour.
    const sat = from ? Math.min(GROUND.satMax, from.s) : GROUND.sat;
    // A NAMED GROUND IS TAKEN AT A SHARE OF ITS OWN LIGHTNESS; a hue with no
    // colour behind it is taken at the setting. Both land under the field they
    // frame, which is the rule that matters: the page can share the picture's
    // colour, and must never be the brightest thing on the screen.
    const light = from ? from.l * GROUND.refShare : GROUND.page;
    const key = Math.round(h / 2) * 4096 + Math.round(sat) * 32 + Math.round(light);
    if (key === shellKey && shellVars) return shellVars;
    // The saturation falls as the surface rises, so a button is closer to
    // neutral than the ground it sits on and its border closer still. A panel
    // carrying as much colour as the page behind it reads as a stain on it
    // rather than as a raised surface. Their lightnesses are LIFTS above the
    // page, so the chrome keeps its spacing whatever the ground turns out to
    // be.
    const page  = hslHex(h, sat, light);
    const panel = hslHex(h, sat * 0.85, light + GROUND.panel);
    const line  = hslHex(h, sat * 0.60, light + GROUND.line);
    shellKey = key;
    shellVars = {
      '--bg': page,
      '--panel': panel,
      '--line': line,
      // The two full screen covers. They are the page colour rather than a
      // fixed near-black, or the moment one opens the whole window jumps back
      // to a ground the game stopped using.
      '--scrim': tone.a(page, 0.93),
      '--scrim-strong': tone.a(page, 0.96),
    };
    return shellVars;
  }

  return {
    // frame
    update, background, horizon, blocks, block, pickups, aim, bodies,
    launcher, swarmBand, foreground,
    // the page around the frame
    shell,
    // readout primitives
    readout, glyph, caption,
    // signals
    setDepth, setSwarm, setRegime, setFlight, setPressure, splash, descend, resolve,
    // control
    clear, resize, setLattice, setSurface, setGrid, setQuality, setAutoQuality, setReducedMotion, stats,
    // helpers, exposed so a caller never has to reimplement them
    format, formatTight, materialFor, palette: PALETTE,
    get cell() { return CELL; },
    get origin() { return ORIGIN; },
    get quality() { return quality; },
    /** Vertical offset the field is being drawn at right now, in pixels.
     *  Anything a caller draws ON a block has to use the same one, or it
     *  detaches from the block for the length of every descent. */
    get slideOffset() { return (sliding ? ease(slide) - 1 : 0) * CELL; },
  };
}

// ===========================================================================
// THE SHELL
// ===========================================================================
//
// The frame around the game should be close to invisible: no title screen, no
// menu, no loading state, nothing that has to be dismissed before play. What
// chrome does exist is a hairline and a label, and it uses the same palette
// the canvas does - one source of colour, two consumers, so the page and the
// field can never drift apart.

/** The palette as CSS custom properties. Drop into a :root block. */
export function cssVariables() {
  let out = '';
  for (const k in PALETTE) out += '  --' + k + ':' + PALETTE[k] + ';\n';
  return out;
}

/**
 * The full shell stylesheet. Spare chrome, dense readout: hairline rules,
 * uppercase micro-labels, tabular numerals that never reflow as they grow, and
 * buttons that are a border and a word.
 */
export function styleSheet() {
  return `:root{
${cssVariables()}  --gap:12px;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  background:var(--void); color:var(--ink);
  font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  display:flex; flex-direction:column; align-items:center;
  -webkit-user-select:none; user-select:none;
  font-variant-numeric:tabular-nums;
}
header,footer,#shop{width:100%; max-width:520px}
header{
  display:flex; gap:0; padding:10px var(--gap);
  border-bottom:1px solid var(--rule);
  justify-content:space-between; align-items:baseline;
}
.stat{display:flex; flex-direction:column; gap:2px; min-width:0}
.stat b{
  font-size:19px; font-weight:600; letter-spacing:-0.02em;
  font-variant-numeric:tabular-nums;
}
.stat span{
  font-size:9px; color:var(--dim); text-transform:uppercase;
  letter-spacing:.12em;
}
.swarmv{color:var(--swarm)} .hotv{color:var(--hot)} .goldv{color:var(--essence)}
.tradev{color:var(--trade)} .forcev{color:var(--force)} .tithev{color:var(--tithe)}
canvas{display:block; touch-action:none}
footer{
  padding:8px var(--gap) 14px; color:var(--dim); font-size:11px;
  display:flex; justify-content:space-between; border-top:1px solid var(--rule);
}
button{
  font:inherit; background:transparent; color:var(--ink);
  border:1px solid var(--rule); padding:4px 10px; cursor:pointer;
  transition:border-color .12s linear, color .12s linear;
}
button:hover:not(:disabled){border-color:var(--swarm); color:var(--swarm)}
button:disabled{opacity:.32; cursor:default}
#shop{display:none; gap:6px; padding:8px var(--gap); border-top:1px solid var(--rule); flex-wrap:wrap}
#shop.on{display:flex}
.buy{flex:1 1 150px; text-align:left; line-height:1.35; background:var(--panel)}
.buy small{display:block; color:var(--dim); font-size:10px; letter-spacing:.02em}
#over{
  position:fixed; inset:0; background:rgba(8,9,12,.93); display:none;
  flex-direction:column; align-items:center; justify-content:center; gap:14px;
}
#over.on{display:flex}
#over h1{font-size:22px; margin:0; font-weight:600; letter-spacing:-0.02em}
@media (prefers-reduced-motion: reduce){
  button{transition:none}
}`;
}

/** Attach the shell stylesheet to a document. Idempotent. */
export function injectStyle(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return null;
  let el = d.getElementById('sb-visual-style');
  if (!el) {
    el = d.createElement('style');
    el.id = 'sb-visual-style';
    d.head.appendChild(el);
  }
  el.textContent = styleSheet();
  return el;
}

export default createVisual;
