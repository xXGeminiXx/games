// ---------------------------------------------------------------------------
// Field patterns
//
// Every block row that descends toward the player is generated here, from math
// only. No tables of hand-authored levels, no assets, no randomness that varies
// between runs: a seed plus a depth always produces the same row, so a run can
// be replayed exactly and a balance pass can measure the field before it ships.
//
// The field is organised into REGIMES. A regime is one generator - a cellular
// automaton, a wave field, a rewriting system, a subdivision scheme - that owns
// a stretch of depth and gives that stretch its own look and its own tactical
// problem. Regimes hand over to each other by dissolving column by column, so
// the field is always visibly turning into something else rather than snapping
// between themes. Past the scripted stretch the generators start recombining
// with each other, which means deep runs keep producing structures that have
// never appeared before instead of looping the opening act.
//
// Two ideas keep the whole thing playable no matter what the math does:
//
//   1. Regimes do not emit blocks. They emit a WEIGHT per column - how much
//      that column wants to be solid. A separate pass decides how many blocks
//      the row is allowed to have and fills the highest-weighted columns. The
//      generator controls the shape; the difficulty curve controls the amount.
//      Every regime therefore works correctly at every density, and density can
//      be tuned without touching a single generator.
//
//   2. A corridor of open columns is carved through every row before selection
//      runs. The corridor wanders by at most one column per row and always
//      keeps a column in common with the row beneath it, so there is an
//      unbroken open path from the launcher to the top of the field at all
//      times, in every regime, at every density.
// ---------------------------------------------------------------------------

/** Columns in the playfield. Rows are emitted at this width, which is the one
 *  authored in config.js so the generator and the board can never disagree. */
import { CONFIG } from '../config.js?v=23';

export const COLS = (CONFIG && CONFIG.board && CONFIG.board.cols > 3) ? CONFIG.board.cols : 8;

/**
 * Hard ceiling on blocks per row. Two columns are always left open, so a row
 * can never seal the field and no run can be lost to an unbreakable wall.
 */
export const MAX_FILLED = COLS - 2;

/** Depths spent dissolving from one regime into the next. */
const HANDOVER = 5;

/** Depth span of each generated regime once the scripted ones run out. */
const DEEP_SPAN = 18;

/** Working width of the automaton lattice. Wider than the playfield so that
 *  structures can grow in from off screen instead of dying against a wrap. */
const LANE = 24;

/** Which lattice column the visible playfield starts at. */
const LANE_OFFSET = 8;

// ---------------------------------------------------------------------------
// Deterministic value noise
//
// One integer hash drives every decision that is not pure geometry. It is
// stateless on purpose: any row can be generated at any time without having
// generated the rows before it, which is what lets a balance pass jump straight
// to depth 400 and what keeps a replay honest.
// ---------------------------------------------------------------------------

function mix32(x) {
  x = x | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function hash(seed, a, b) {
  const h = mix32(seed ^ Math.imul(a | 0, 0x9e3779b1));
  return mix32(h ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b));
}

/** Hashed value in [0,1). */
function unit(seed, a, b) {
  return hash(seed, a, b) / 4294967296;
}

/** Accepts a number or a string so a run can be seeded from a shareable word. */
function normaliseSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return mix32(Math.trunc(seed));
  const text = String(seed === undefined || seed === null ? 'swarm' : seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return mix32(h);
}

// ---------------------------------------------------------------------------
// Self-similar integer sequences
//
// These are aperiodic: they never settle into a repeat, and they look the same
// at several zoom levels. Used as texture sources, they give rows that feel
// composed rather than sprinkled, and a player reading the field never finds
// the loop point because there is not one.
// ---------------------------------------------------------------------------

function popcount(n) {
  n = n >>> 0;
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return Math.imul(n, 0x01010101) >>> 24;
}

/** Thue-Morse: perfectly balanced, never has three identical runs. */
const thueMorse = n => popcount(n) & 1;

/** Regular paperfolding sequence - the dragon curve read as bits. Clusters at
 *  every scale, so windows into it hold both tight pairs and long gaps. */
function paperfold(n) {
  n = n >>> 0;
  if (n === 0) return 0;
  while ((n & 1) === 0) n >>>= 1;
  return ((n >>> 1) & 1) ^ 1;
}

/** Rudin-Shapiro: parity of adjacent one-bits. Dense but strongly patterned. */
function rudinShapiro(n) {
  let c = 0;
  n = n >>> 0;
  while (n) {
    if ((n & 3) === 3) c++;
    n >>>= 1;
  }
  return c & 1;
}

/** Cantor membership - no digit 1 in base three. Gaps nested inside gaps. */
function inCantor(n) {
  n = Math.abs(n | 0);
  while (n > 0) {
    if (n % 3 === 1) return 0;
    n = Math.floor(n / 3);
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Rewriting systems
//
// Expanded once at load, seed independent - these are fixed strings, and the
// seed only decides where a row looks into them.
// ---------------------------------------------------------------------------

function expand(axiom, rules, maxLength) {
  let s = axiom;
  while (s.length < maxLength) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      out += rules[ch] === undefined ? ch : rules[ch];
    }
    if (out.length === s.length) break;
    s = out;
  }
  return s.slice(0, maxLength);
}

/** Fibonacci word. Aperiodic, and its gaps come in exactly two lengths, which
 *  reads as deliberate architecture rather than noise. */
const FIB_WORD = expand('A', { A: 'AB', B: 'A' }, 512);

/** Branching growth. Produces trunks with side shoots at several scales. */
const BRANCH_WORD = expand('A', { A: 'AABA', B: 'BAB' }, 512);

// ---------------------------------------------------------------------------
// Elementary cellular automata
//
// Run on a lattice wider than the playfield and observed through a window, so
// structures drift in from outside instead of wrapping into themselves. The
// lattice is re-seeded every `span` rows: a fresh triangle starting every dozen
// rows keeps the automaton visibly restating itself, which is more legible than
// one enormous structure the player only ever sees a slice of.
// ---------------------------------------------------------------------------

function caStep(rule, row) {
  const out = new Array(LANE);
  for (let i = 0; i < LANE; i++) {
    const l = row[(i - 1 + LANE) % LANE];
    const m = row[i];
    const r = row[(i + 1) % LANE];
    out[i] = (rule >> ((l << 2) | (m << 1) | r)) & 1;
  }
  return out;
}

function caSeedRow(seed, anchor, mode) {
  const row = new Array(LANE).fill(0);
  if (mode === 'single') {
    row[(LANE_OFFSET + 4 + (hash(seed, anchor, 11) % 5)) % LANE] = 1;
  } else if (mode === 'pair') {
    const a = hash(seed, anchor, 12) % LANE;
    row[a] = 1;
    row[(a + 3 + (hash(seed, anchor, 13) % 7)) % LANE] = 1;
  } else {
    for (let i = 0; i < LANE; i++) {
      row[i] = unit(seed, anchor, i + 31) < 0.34 ? 1 : 0;
    }
  }
  return row;
}

/**
 * Weight field from an automaton. Live cells weigh 1. Dead cells pick up a
 * little weight from live neighbours, so when the difficulty curve asks for
 * more blocks than the automaton produced, the extra ones thicken the existing
 * structure instead of speckling the row.
 */
function caField(rule, mode, span, depth, seed) {
  const anchor = Math.floor(depth / span) * span;
  let row = caSeedRow(seed, anchor, mode);
  for (let s = anchor; s < depth; s++) row = caStep(rule, row);

  const w = new Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const i = LANE_OFFSET + c;
    const near = row[(i - 1 + LANE) % LANE] + row[(i + 1) % LANE];
    w[c] = row[i] ? 1 : 0.10 + 0.16 * near;
  }
  return w;
}

// ---------------------------------------------------------------------------
// REGIMES
//
// Each returns eight weights in roughly [0,1]. High weight means the column
// wants to be solid. Nothing here decides how many blocks a row gets.
// ---------------------------------------------------------------------------

const FIELDS = {

  // OPENING - depths 1 to 8
  // A handful of blocks orbiting a slowly walking centre, with wide clear water
  // on both sides. Nothing to solve; it exists so the first shots teach the
  // player that the swarm ricochets and that a wall bank is worth more than a
  // straight line. Density is low here regardless of the field, so this mostly
  // controls where the few blocks sit rather than how many there are.
  opening(depth, seed) {
    const centre = 3.5 + 3.0 * Math.sin(depth * 0.37 + 0.9);
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const pull = 1 - Math.min(1, Math.abs(c - centre) / 4.2);
      w[c] = 0.62 * pull + 0.38 * unit(seed, depth, c * 13 + 1);
    }
    return w;
  },

  // SIERPINSKI - depths 9 to 22
  // Pascal's triangle taken modulo two: the classic nested triangle, drawn at
  // two zoom levels at once. The fine triangle decides the blocks; the coarse
  // one holds the extras when the row is allowed to be denser, so the structure
  // stays self-similar as difficulty climbs instead of blurring.
  // Tactically it is the best geometry in the game for the swarm - the sloping
  // faces feed balls sideways along the diagonal instead of straight back down,
  // so a single well-aimed shot rakes half a row.
  sierpinski(depth, seed) {
    const era = Math.floor(depth / 14);
    // Alternate the time scale so triangles appear at two sizes: at coarse
    // scale each generation is held for two rows, doubling the structure.
    const coarseEra = (era & 1) === 1;
    const step = coarseEra ? depth >> 1 : depth;
    const n = step & 7;
    const off = hash(seed, era, 3) & 7;

    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const x = (c + off) & 7;
      const fine = (x & n) === x;
      const half = x >> 1;
      const coarse = (half & (n >> 1)) === half;
      w[c] = fine ? 1 : coarse ? 0.42 : 0.09 + 0.07 * unit(seed, depth, c);
    }
    return w;
  },

  // MIRROR - depths 23 to 36
  // Every row is axially symmetric: four columns generated, four reflected. The
  // half is drawn from Thue-Morse so it never falls into a short loop.
  // Symmetric fields are the one place where the centre line is genuinely the
  // strongest aim, and where a shot that works on the left works on the right -
  // the regime rewards a player who has started reading the field rather than
  // reacting to it.
  mirror(depth, seed) {
    const phase = (depth * 5 + (hash(seed, Math.floor(depth / 14), 7) & 15)) >>> 0;
    const half = new Array(4);
    for (let h = 0; h < 4; h++) {
      const bit = thueMorse(phase + h * 3);
      const soft = 0.30 * unit(seed, depth, h + 41);
      half[h] = bit ? 0.85 + 0.15 * soft : 0.12 + soft;
    }
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) w[c] = half[c < 4 ? c : COLS - 1 - c];
    return w;
  },

  // INTERFERENCE - depths 37 to 52
  // Two travelling waves of different wavelength summed across the row. Where
  // they cancel, a gap opens; where they reinforce, a bar of blocks forms. The
  // waves drift in opposite directions, so the nodes crawl sideways one column
  // every few rows and the field appears to flow.
  // The tactical point is that the safe lane MOVES. A player who found a good
  // angle three turns ago has to find it again, and reading which way the
  // pattern is sliding is worth more than any single shot.
  interference(depth, seed) {
    const p1 = (hash(seed, 101, 1) % 628) / 100;
    const p2 = (hash(seed, 101, 2) % 628) / 100;
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const v = Math.sin(c * 0.94 - depth * 0.37 + p1)
              + Math.sin(c * 1.73 + depth * 0.21 + p2);
      w[c] = (v + 2) / 4;
    }
    return w;
  },

  // GROWTH - depths 53 to 68
  // A rewriting system read through a sliding window. The string grows by
  // substitution, so motifs the player has already seen come back stretched or
  // nested inside larger copies of themselves.
  // It plays as a field with memory: clusters and gaps recur at recognisable
  // spacings, and a player can start to predict the next row without ever
  // getting the same row twice.
  growth(depth, seed) {
    const base = hash(seed, 202, 1) % 64;
    const off = (base + depth * 3) % (BRANCH_WORD.length - COLS);
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const solid = BRANCH_WORD[off + c] === 'A';
      w[c] = solid ? 0.95 + 0.05 * unit(seed, depth, c) : 0.14 + 0.10 * unit(seed, depth, c + 9);
    }
    return w;
  },

  // GLIDERS - depths 69 to 84
  // Rule 110 on the wider lattice. It throws off small stable structures that
  // travel sideways one column per row against a striped background.
  // Playing it means shooting at something that is moving relative to the grid:
  // a glider that is two columns from the wall this turn is against it next
  // turn, and catching one before it merges into the background wall is the
  // most satisfying single shot in this stretch.
  gliders(depth, seed) {
    return caField(110, 'scatter', 16, depth, seed);
  },

  // WEAVE - depths 85 to 98
  // Two diagonal bands crossing the field at different speeds and opposite
  // directions, one slightly faster than the other so their crossing point
  // walks. Between crossings the field is two clean lanes; at a crossing it is
  // a single thick knot.
  // The rhythm is the hook - the player learns to spend the loose turns banking
  // essence and to save the swarm for the knot.
  weave(depth, seed) {
    const drift = (hash(seed, 303, 1) % 100) / 100;
    const a = (depth * 0.71 + drift * COLS) % COLS;
    const b = (COLS * 4 - depth * 1.27 + drift * COLS) % COLS;
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const da = Math.min(Math.abs(c - a), COLS - Math.abs(c - a));
      const db = Math.min(Math.abs(c - b), COLS - Math.abs(c - b));
      const ba = Math.max(0, 1 - da / 1.7);
      const bb = Math.max(0, 1 - db / 1.7);
      w[c] = Math.max(ba, bb) * 0.9 + 0.08 + 0.06 * unit(seed, depth, c + 5);
    }
    return w;
  },

  // CHAOS - depths 99 to 112
  // Rule 30 from a single live cell. One side of the growing triangle stays
  // orderly, the other is genuinely unpredictable, and the window sits across
  // the boundary so each row shows both.
  // This is the regime that punishes autopilot. Nothing about the previous row
  // tells the player where the next gap is, so play shifts from planning to
  // reacting, and it lands right after the weave taught them a rhythm.
  chaos(depth, seed) {
    return caField(30, 'single', 13, depth, seed);
  },

  // SLABS - depths 113 to 128
  // Recursive binary subdivision. The row is halved, the halves halved again,
  // and each surviving segment is either wholly solid or wholly open, so every
  // edge lands on a power-of-two boundary.
  // Wide flat faces are the reward here: they bounce a ball straight back down
  // rather than scattering it, which makes raw damage suddenly worth more than
  // clever angles and gives the upgrade the player has been buying a moment to
  // prove itself.
  slabs(depth, seed) {
    let segs = [[0, COLS]];
    for (let level = 0; level < 3; level++) {
      const next = [];
      for (let i = 0; i < segs.length; i++) {
        const [start, len] = segs[i];
        const splitChance = 0.78 - level * 0.14;
        if (len > 1 && unit(seed, depth, level * 17 + start + 60) < splitChance) {
          const h = len >> 1;
          next.push([start, h], [start + h, len - h]);
        } else {
          next.push([start, len]);
        }
      }
      segs = next;
    }
    const w = new Array(COLS).fill(0.10);
    for (let i = 0; i < segs.length; i++) {
      const [start, len] = segs[i];
      const solid = unit(seed, depth, start + 130) < 0.52;
      const value = solid ? 0.92 + 0.08 * unit(seed, depth, start + 150) : 0.16;
      for (let c = start; c < start + len; c++) w[c] = value;
    }
    return w;
  },

  // LATTICE - depths 129 to 142
  // Rule 150 - an additive automaton, every cell the parity of its three
  // neighbours. It produces a fine, even, crystalline mesh with none of rule
  // 90's empty interior.
  // It is the most uniformly hostile geometry in the game: no soft spot, no
  // funnel, no obvious lane. Progress comes from grinding a hole and widening
  // it, which is exactly the point in the run where the swarm has grown large
  // enough to do that in a single turn.
  lattice(depth, seed) {
    return caField(150, 'single', 12, depth, seed);
  },

  // CATHEDRAL - depths 143 to 158
  // Mirrored arches alternating with mirrored pillars. An arch row is solid at
  // the walls and open through the middle; a pillar row is the inverse. Held
  // for a few rows each, they stack into a nave with columns and openings.
  // The open middle of an arch is bait. It invites a straight shot that sails
  // clean through and comes back having hit nothing, while the same angle
  // banked off a wall rattles the whole span. It is the clearest lesson in the
  // game that the obvious lane is not the paying one.
  cathedral(depth, seed) {
    const bay = Math.floor(depth / 3);
    const arch = (bay & 1) === 0;
    const radius = 1.15 + 1.35 * (0.5 + 0.5 * Math.sin(bay * 0.9 + (hash(seed, 404, 1) % 100) / 16));
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const dist = Math.abs(c - (COLS - 1) / 2);
      const outside = dist > radius;
      const solid = arch ? outside : !outside;
      w[c] = solid ? 0.94 : 0.12 + 0.08 * unit(seed, depth, c + 70);
    }
    return w;
  },

  // CANTOR - depths 159 to 172
  // The Cantor set read across the row: gaps with gaps inside them, at every
  // scale the eight columns can show.
  // Its signature is the hole that is never where the player expects, because
  // the gap structure is scale free - a wide opening always has a narrower one
  // nested beside it, and threading the small one is worth far more than
  // dropping the swarm down the obvious wide one.
  cantor(depth, seed) {
    const off = (hash(seed, 505, 1) % 81) + depth * 2;
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const solid = inCantor(off + c);
      const near = inCantor(off + c - 1) + inCantor(off + c + 1);
      w[c] = solid ? 0.96 : 0.10 + 0.13 * near;
    }
    return w;
  },

  // REEF - depths 173 to 188
  // Two aperiodic sequences read as one continuous scanline through the field,
  // one column per step, so no row is ever a repeat of any earlier row and the
  // structure has no period at all.
  // It is dense, uneven and organic - the closest thing to a natural surface
  // the generators produce, and after the strict geometry of the cathedral and
  // the lattice it reads as the field going wild.
  reef(depth, seed) {
    const base = depth * COLS + (hash(seed, 606, 1) % 4096);
    const w = new Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const n = base + c;
      w[c] = 0.52 * rudinShapiro(n) + 0.34 * paperfold(n)
           + 0.10 * (FIB_WORD[n % FIB_WORD.length] === 'A' ? 1 : 0)
           + 0.06 * unit(seed, depth, c + 90);
    }
    return w;
  },
};

// ---------------------------------------------------------------------------
// Scripted regime order
//
// Spans are short early, where the player is learning fast and every new look
// is information, and lengthen slightly later where each regime is a problem
// worth living with for a while.
// ---------------------------------------------------------------------------

// `bias` shifts a regime's block count up or down against the difficulty curve,
// so regimes differ in weight as well as in shape. A regime whose interest
// comes from its gaps is given room to show them; a regime whose interest comes
// from mass is allowed to be heavy. The curve still owns the overall trend -
// bias only tilts a regime around it, and never past the hard ceiling.
const SCRIPT = [
  { key: 'opening',      name: 'drift',      span: 8,  bias: -0.5 },
  { key: 'sierpinski',   name: 'sierpinski', span: 14, bias: -0.2 },
  { key: 'mirror',       name: 'mirror',     span: 14, bias:  0.0 },
  { key: 'interference', name: 'interfere',  span: 16, bias: -0.3 },
  { key: 'growth',       name: 'growth',     span: 16, bias:  0.1 },
  { key: 'gliders',      name: 'gliders',    span: 16, bias: -0.1 },
  { key: 'weave',        name: 'weave',      span: 14, bias: -0.4 },
  { key: 'chaos',        name: 'chaos',      span: 14, bias:  0.2 },
  { key: 'slabs',        name: 'slabs',      span: 16, bias:  0.4 },
  { key: 'lattice',      name: 'lattice',    span: 14, bias:  0.5 },
  { key: 'cathedral',    name: 'cathedral',  span: 16, bias:  0.2 },
  { key: 'cantor',       name: 'cantor',     span: 14, bias: -0.5 },
  { key: 'reef',         name: 'reef',       span: 16, bias:  0.3 },
];

/** First depth after the scripted regimes hand over to generated ones. */
const SCRIPT_END = SCRIPT.reduce((n, e) => n + e.span, 1);

// ---------------------------------------------------------------------------
// DEEP REGIMES - depth 189 and beyond
//
// Past the scripted run the regimes stop being authored and start being bred.
// Each deep regime picks two of the generators above, transforms one of them,
// and combines them with one of five operators. The result is a genuinely new
// structure - a cathedral cut by interference is not a cathedral and not
// interference - and because the choice is hashed from the regime index there
// are more distinct combinations than any run will ever reach.
//
// This is what keeps depth 400 from looking like depth 40. The player is not
// grinding through a longer version of the opening; the world is still turning
// into things it has not been before, and each one arrives with a name.
// ---------------------------------------------------------------------------

const OPERATORS = [
  // union - everything either parent wants, the densest and most walled result
  { tag: 'union', fn: (a, b) => Math.max(a, b) },
  // rift  - only where the parents disagree, which carves long clean channels
  { tag: 'rift',  fn: (a, b) => Math.abs(a - b) },
  // weld  - only where both agree, leaving isolated cores and open floor
  { tag: 'weld',  fn: (a, b) => Math.min(a, b) },
  // fold  - the average, which blurs both structures into soft banding
  { tag: 'fold',  fn: (a, b) => (a + b) * 0.5 },
  // comb  - alternating columns from each parent, an interleaved lattice
  { tag: 'comb',  fn: (a, b, c) => ((c & 1) === 0 ? a : b) },
];

// Kept short: these are read at a glance from a small label, and a bred regime
// arriving under its own name is most of what tells a player the world just
// turned over. Longest label the source can produce is thirteen characters.
const DEEP_NAMES = [
  'anneal', 'cascade', 'spires', 'tide', 'shatter', 'bloom',
  'helix', 'static', 'vault', 'quench', 'murmur', 'fracture',
];

const NUMERALS = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Source generators available for breeding. The opening is excluded - it is a
 *  tutorial shape, not a texture, and it has nothing to contribute deep down. */
const BREEDABLE = SCRIPT.slice(1).map(e => e.key);

function buildDeepRegime(index, seed) {
  const k = index - SCRIPT.length;

  const ai = hash(seed, 900 + k, 1) % BREEDABLE.length;
  let bi = hash(seed, 900 + k, 2) % BREEDABLE.length;
  if (bi === ai) bi = (bi + 3) % BREEDABLE.length;

  const op = OPERATORS[hash(seed, 900 + k, 3) % OPERATORS.length];
  const shift = hash(seed, 900 + k, 4) % COLS;
  const flip = (hash(seed, 900 + k, 5) & 1) === 1;
  // A slight depth skew makes the second parent evolve at its own rate, so the
  // two structures slide past each other instead of marching in lockstep.
  const skew = (hash(seed, 900 + k, 6) % 5) + 1;

  const cycle = Math.floor(k / DEEP_NAMES.length);
  const suffix = NUMERALS[Math.min(cycle + 1, NUMERALS.length - 1)];
  const name = DEEP_NAMES[k % DEEP_NAMES.length] + (suffix ? ' ' + suffix : '');

  const first = FIELDS[BREEDABLE[ai]];
  const second = FIELDS[BREEDABLE[bi]];

  return {
    key: 'deep:' + BREEDABLE[ai] + '+' + BREEDABLE[bi],
    name,
    span: DEEP_SPAN,
    // Union runs heavy and rift runs light by nature, so the bias leans with
    // the operator and keeps a bred regime honest about what it is.
    bias: (op.tag === 'union' ? 0.35 : op.tag === 'rift' ? -0.45 : 0)
        + ((hash(seed, 900 + k, 7) % 7) - 3) * 0.1,
    field(depth, s) {
      const wa = first(depth, s);
      const raw = second(depth + skew, s ^ 0x5bf03635);
      const w = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const src = flip ? COLS - 1 - c : c;
        w[c] = op.fn(wa[c], raw[(src + shift) % COLS], c);
      }
      return w;
    },
  };
}

// ---------------------------------------------------------------------------
// Regime lookup
// ---------------------------------------------------------------------------

function regimeSlot(depth) {
  let start = 1;
  for (let i = 0; i < SCRIPT.length; i++) {
    if (depth < start + SCRIPT[i].span) {
      return { index: i, start, span: SCRIPT[i].span };
    }
    start += SCRIPT[i].span;
  }
  const k = Math.floor((depth - SCRIPT_END) / DEEP_SPAN);
  return {
    index: SCRIPT.length + k,
    start: SCRIPT_END + k * DEEP_SPAN,
    span: DEEP_SPAN,
  };
}

// ---------------------------------------------------------------------------
// The open corridor
//
// One column per row is guaranteed clear. It moves by at most one column
// between neighbouring rows, and on the rows where it moves, both the old and
// the new column are cleared - so the corridor is connected side to side as
// well as bottom to top and a ball can physically travel its whole length.
//
// The result is a slowly snaking open channel through the entire field. It
// guarantees the top of the field is always reachable, it guarantees no row can
// ever be solid, and it is a real tactical feature rather than a safety hack:
// the corridor is where a shot with any angle at all can climb, so finding it
// and threading it is the highest-value read available every single turn.
// ---------------------------------------------------------------------------

function corridorAt(depth, seed) {
  const p1 = (hash(seed, 7, 1) % 628) / 100;
  const p2 = (hash(seed, 7, 2) % 628) / 100;
  const p3 = (hash(seed, 7, 3) % 628) / 100;
  // Amplitudes total 3.5 so the value spans the full column range, and the
  // combined slope stays well under one column per row so the corridor can
  // never jump a gap it would be impossible to travel through.
  const v = 3.5
    + 1.9 * Math.sin(depth * 0.1300 + p1)
    + 1.1 * Math.sin(depth * 0.0571 + p2)
    + 0.5 * Math.sin(depth * 0.0233 + p3);
  const c = Math.round(v);
  return c < 0 ? 0 : c > COLS - 1 ? COLS - 1 : c;
}

function openColumns(depth, seed) {
  const here = corridorAt(depth, seed);
  const below = corridorAt(depth - 1, seed);
  return here === below ? [here] : [here, below];
}

// ---------------------------------------------------------------------------
// Difficulty envelope
//
// Decides HOW MANY blocks a row gets, entirely separately from what it looks
// like. Smooth by construction, so the count never jumps more than one or two
// between neighbouring rows and a player is never handed an unfair spike.
//
// Two beats punctuate the curve:
//   REST  - a near-empty row, dropped in occasionally as a breath and a chance
//           for the swarm to climb deep into the field on one shot. Never twice
//           in a row, and never empty, because a dead turn is worse than a hard
//           one.
//   GATE  - a full-width wall with only the corridor through it. Rare, never
//           back to back, and never adjacent to a rest, so it always lands as a
//           deliberate obstacle rather than a run-ending pile-up.
// ---------------------------------------------------------------------------

/**
 * A beat fires when its roll comes up and no roll came up in the few rows
 * beneath it. Requiring a quiet run behind it is what turns a raw probability
 * into a rhythm: it enforces a minimum spacing without any state, so beats stay
 * punctuation instead of arriving in clumps that read as the curve breaking.
 */
function beat(depth, seed, salt, chance, lookback) {
  if (unit(seed, depth, salt) >= chance) return false;
  for (let i = 1; i <= lookback; i++) {
    if (unit(seed, depth - i, salt) < chance) return false;
  }
  return true;
}

function restBeat(depth, seed) {
  // Not in the opening. A breather only means something once there is pressure
  // to be relieved of, and the first rows are already nearly empty.
  if (depth < 10) return false;
  return beat(depth, seed, 77, 0.10, 3);
}

function gateBeat(depth, seed) {
  if (depth < 20) return false;
  if (!beat(depth, seed, 88, 0.06, 3)) return false;
  // A gate never touches a rest on either side. A wall the turn after a breath
  // is the one thing here that would read as the game cheating.
  return !restBeat(depth, seed)
    && !restBeat(depth + 1, seed)
    && !restBeat(depth - 1, seed);
}

function rawCount(depth, seed, bias) {
  // Ramp: about two blocks at the surface easing toward four. It approaches its
  // ceiling rather than reaching it, deliberately leaving several columns open
  // even at extreme depth - the row count stops climbing long before block
  // health does, so late difficulty comes from hit points while the field stays
  // open enough for its structure to still be readable.
  const ramp = 1.9 + 2.3 * (1 - Math.exp(-(depth - 1) / 48));

  // Two slow swells at unrelated frequencies. Together they give long stretches
  // of pressure and long stretches of relief without ever repeating a cycle
  // the player could time.
  const swell = 0.62 * Math.sin(depth * 0.1013 + 0.4)
              + 0.38 * Math.sin(depth * 0.0431 + 2.1);

  let t = ramp + swell + (Number.isFinite(bias) ? bias : 0);
  if (gateBeat(depth, seed)) t = MAX_FILLED;
  if (restBeat(depth, seed)) t = Math.min(t, 2);

  // Dither the fraction rather than rounding it, so the average density tracks
  // the curve exactly instead of quantising into visible steps.
  const floor = Math.floor(t);
  let count = floor + (unit(seed, depth, 3) < t - floor ? 1 : 0);

  // Ordinary rows stop one short of the ceiling. Reaching it is reserved for a
  // gate, so a full-width wall always means something.
  const ceiling = gateBeat(depth, seed) ? MAX_FILLED : MAX_FILLED - 1;
  const minimum = depth <= 2 ? 1 : 2;
  if (count < minimum) count = minimum;
  if (count > ceiling) count = ceiling;
  return count;
}

/**
 * The density bias in force at a depth, handover included.
 *
 * Extracted so that the row being built and the guard that compares it against
 * the row below ask the same question the same way. They used to not, and that
 * was a real defect - see targetCount.
 */
function biasAt(depth, regimeOf) {
  const slot = regimeSlot(depth);
  const here = regimeOf(slot.index);
  const untilEnd = slot.start + slot.span - depth;
  if (untilEnd >= HANDOVER) return here.bias;
  const next = regimeOf(slot.index + 1);
  return here.bias + (next.bias - here.bias) * ((HANDOVER - untilEnd) / HANDOVER);
}

/**
 * Final block count for a row, with a hard limit on how much harder a row may
 * be than the one below it. Everything upstream is smooth already; this exists
 * so that a gate landing on top of an unusually light row still arrives as a
 * step rather than a cliff. Rows are free to get easier as fast as they like.
 *
 * THE PREVIOUS ROW'S COUNT HAS TO BE ASKED FOR WITH THE PREVIOUS ROW'S BIAS.
 *
 * It was not, and the guard quietly stopped guarding. During a handover the
 * bias slides a little every row, so the row below was built with a bias a few
 * hundredths from this one's. rawCount dithers its fractional target against a
 * hashed roll, and a few hundredths is enough to flip that roll - so the guard
 * believed the row below had three blocks where the player had been shown two,
 * allowed a cap of six instead of five, and a gate row landed as a four block
 * jump. 1.8% of seeds over depths 1..600, every one of them inside a handover.
 */
function targetCount(depth, seed, bias, prevBias) {
  const b = Number.isFinite(bias) ? bias : 0;
  const count = rawCount(depth, seed, b);
  if (depth <= 1) return count;
  const pb = Number.isFinite(prevBias) ? prevBias : b;
  return Math.min(count, rawCount(depth - 1, seed, pb) + 3);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildRow(depth, seed, regimeOf) {
  const slot = regimeSlot(depth);
  const here = regimeOf(slot.index);
  const w = here.field(depth, seed);

  // Handover: over the last few rows of a regime, columns switch across to the
  // incoming one a few at a time, decided by a stable hash. Because a column
  // that has switched stays switched, the new pattern visibly eats the old one
  // rather than cross fading into mush. The density bias slides across at the
  // same time, so a heavy regime arrives with its weight already building.
  const untilEnd = slot.start + slot.span - depth;
  if (untilEnd < HANDOVER) {
    const next = regimeOf(slot.index + 1);
    const progress = (HANDOVER - untilEnd) / HANDOVER;
    const nw = next.field(depth, seed);
    for (let c = 0; c < COLS; c++) {
      if (unit(seed, slot.index + 1, c + 400) < progress) w[c] = nw[c];
    }
  }

  const bias = biasAt(depth, regimeOf);
  const count = targetCount(depth, seed, bias, depth > 1 ? biasAt(depth - 1, regimeOf) : bias);
  const open = openColumns(depth, seed);

  // Rank the columns the corridor has not claimed, and fill the strongest.
  const ranked = [];
  for (let c = 0; c < COLS; c++) {
    if (open.indexOf(c) !== -1) continue;
    // A small jitter only ever separates columns the generator scored equally.
    // It is deliberately too small to overturn real structure.
    ranked.push({ c, k: w[c] + 0.03 * unit(seed, depth, c + 200) });
  }
  ranked.sort((a, b) => (b.k - a.k) || (a.c - b.c));

  const cells = new Array(COLS).fill(false);
  const take = Math.min(count, ranked.length);
  let mask = 0;
  for (let i = 0; i < take; i++) {
    cells[ranked[i].c] = true;
    mask |= 1 << ranked[i].c;
  }
  return { cells, weights: w, count: take, open, ranked, mask };
}

/** How far back the stall check looks for rows identical to this one. */
const STALL_WINDOW = 16;

/**
 * A generator that changes slowly, asked for only a few blocks, can name the
 * same columns several rows running and freeze the field into static pillars.
 *
 * Rather than compare finished rows - which can collide by coincidence and hide
 * a stall - each row is told how many identical rows sit directly beneath it,
 * and rows deeper into a repeat swap in a different near miss. Identical input
 * therefore produces a different output every row, so the field keeps shifting
 * through the alternatives its own generator ranked next best. It is the
 * smallest change that breaks a stall while staying honest to the pattern, and
 * it never touches the corridor or the block count.
 */
function repeatDepth(depth, baseAt) {
  const mask = baseAt(depth).mask;
  let k = 0;
  while (k < STALL_WINDOW && depth - k - 1 >= 1 && baseAt(depth - k - 1).mask === mask) k++;
  // A field frozen for longer than the window is genuinely static, so fall back
  // to advancing with depth and let the substitutions keep cycling.
  return k < STALL_WINDOW ? k : STALL_WINDOW + (depth % 7);
}

function applyVariant(row, k) {
  if (k === 0) return row;
  const spares = row.ranked.length - row.count;
  if (spares < 1 || row.count < 1) return row;

  // Step the outgoing block first and the incoming column second, so successive
  // rows of a repeat never land on the same substitution.
  const idx = k - 1;
  const outCol = row.ranked[row.count - 1 - (idx % row.count)].c;
  const inCol = row.ranked[row.count + (Math.floor(idx / row.count) % spares)].c;
  if (outCol === inCol) return row;

  const cells = row.cells.slice();
  cells[outCol] = false;
  cells[inCol] = true;
  return { cells, weights: row.weights, count: row.count, open: row.open, ranked: row.ranked, mask: row.mask };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a pattern source for one run.
 *
 * @param {number|string} [seed] anything stable - a number, or a word a player
 *   can share. The same seed always produces the same field.
 * @returns {{
 *   seed: number,
 *   cols: number,
 *   rowFor(depth: number): boolean[],
 *   nameFor(depth: number): string,
 *   regimeAt(depth: number): { name: string, key: string, index: number,
 *                              start: number, span: number, progress: number,
 *                              handingOver: boolean, next: string },
 *   detailFor(depth: number): Array<{ on: boolean, col: number, weight: number,
 *                                     role: string, hpScale: number }>,
 *   metricsFor(depth: number): object,
 *   previewRows(from: number, count: number): boolean[][],
 *   checkInvariants(from?: number, to?: number): object
 * }}
 */
export function createPatternSource(seed) {
  const s = normaliseSeed(seed);

  // Deep regimes are built once each and kept; the scripted ones are static.
  const deepCache = new Map();
  function regimeOf(index) {
    if (index < SCRIPT.length) {
      const e = SCRIPT[index];
      return { key: e.key, name: e.name, span: e.span, bias: e.bias, field: FIELDS[e.key] };
    }
    let r = deepCache.get(index);
    if (!r) {
      r = buildDeepRegime(index, s);
      deepCache.set(index, r);
      if (deepCache.size > 64) deepCache.delete(deepCache.keys().next().value);
    }
    return r;
  }

  // A row depends only on its own depth and on how long the rows beneath it
  // have been repeating, so rows can be cached freely and asked for in any
  // order. The caches exist because the renderer, the stall check and a balance
  // pass all ask for the same row more than once, not because generation is
  // costly - and they keep the stall check's short walk backwards amortised to
  // nothing during ordinary play.
  function cached(map, key, make) {
    let hit = map.get(key);
    if (hit === undefined) {
      hit = make();
      map.set(key, hit);
      if (map.size > 512) map.delete(map.keys().next().value);
    }
    return hit;
  }

  // Rows as their generator produced them, before the stall check. Kept
  // separate so the check always compares unaltered output and cannot cascade.
  const baseCache = new Map();
  const baseAt = depth => cached(baseCache, depth, () => buildRow(depth, s, regimeOf));

  const rowCache = new Map();
  function rowData(rawDepth) {
    const depth = Number.isFinite(rawDepth) ? Math.max(1, Math.floor(rawDepth) || 1) : 1;
    return cached(rowCache, depth, () => applyVariant(baseAt(depth), repeatDepth(depth, baseAt)));
  }

  function regimeAt(rawDepth) {
    const depth = Number.isFinite(rawDepth) ? Math.max(1, Math.floor(rawDepth) || 1) : 1;
    const slot = regimeSlot(depth);
    const here = regimeOf(slot.index);
    const untilEnd = slot.start + slot.span - depth;
    const handingOver = untilEnd < HANDOVER;
    const progress = handingOver ? (HANDOVER - untilEnd) / HANDOVER : 0;
    const next = regimeOf(slot.index + 1);
    return {
      name: handingOver && progress >= 0.5 ? next.name : here.name,
      key: here.key,
      index: slot.index,
      start: slot.start,
      span: slot.span,
      progress,
      handingOver,
      next: next.name,
    };
  }

  return {
    seed: s,
    cols: COLS,

    /**
     * The row that arrives at this depth: one boolean per column, true where a
     * block should be placed. A fresh array every call, safe to mutate.
     */
    rowFor(depth) {
      return rowData(depth).cells.slice();
    },

    /** Short label for the pattern the field is currently expressing. */
    nameFor(depth) {
      return regimeAt(depth).name;
    },

    regimeAt,

    /**
     * Per-column detail for callers that want more than a boolean.
     *
     *   role     'block' solid, 'open' empty, 'corridor' guaranteed open
     *   weight   how strongly the generator wanted this column, 0 to 1
     *   hpScale  advisory multiplier - blocks with solid neighbours on both
     *            sides sit at the core of a structure and can carry a little
     *            more health without changing how long the row takes to clear.
     *            Purely optional; ignoring it changes nothing.
     */
    detailFor(depth) {
      const { cells, weights, open } = rowData(depth);
      return cells.map((on, c) => {
        const walled = (c > 0 && cells[c - 1]) && (c < COLS - 1 && cells[c + 1]);
        return {
          col: c,
          on,
          weight: Math.max(0, Math.min(1, weights[c])),
          role: on ? 'block' : (open.indexOf(c) !== -1 ? 'corridor' : 'open'),
          hpScale: on ? (walled ? 1.2 : 1) : 0,
        };
      });
    },

    /** Everything a balance pass wants about one depth, without re-deriving it. */
    metricsFor(depth) {
      const d = Math.max(1, Math.floor(depth) || 1);
      const { cells, count, open } = rowData(d);
      const r = regimeAt(d);
      return {
        depth: d,
        regime: r.name,
        key: r.key,
        handingOver: r.handingOver,
        count,
        density: count / COLS,
        corridor: open.slice(),
        rest: restBeat(d, s),
        gate: gateBeat(d, s),
        cells: cells.slice(),
      };
    },

    /** A block of consecutive rows, for previewing or measuring a stretch. */
    previewRows(from, count) {
      const out = [];
      const start = Math.max(1, Math.floor(from) || 1);
      const n = Math.max(0, Math.floor(count) || 0);
      for (let i = 0; i < n; i++) out.push(rowData(start + i).cells.slice());
      return out;
    },

    /**
     * Verifies the guarantees over a stretch of depth: no solid rows, no empty
     * rows, no unreachable rows, and no density spike. Returns a report rather
     * than throwing, so a balance pass can print it.
     */
    checkInvariants(from = 1, to = 600) {
      const problems = [];
      // A verifier that cannot say "I checked nothing" can be trusted into a
      // false negative. An empty or reversed range walks no rows, so it reports
      // that plainly rather than returning a clean bill of health with the
      // summary counters still at the values they were initialised to.
      const lo = Math.max(1, from);
      if (!Number.isFinite(lo) || !Number.isFinite(to) || to < lo) {
        return {
          ok: false, rows: 0, minCount: null, maxCount: null, meanCount: null,
          problems: ['checked nothing: range ' + from + '..' + to + ' contains no rows'],
        };
      }
      let minCount = COLS;
      let maxCount = 0;
      let total = 0;
      let prevOpenSet = null;
      let prevCount = null;
      let emptyRun = 0;

      for (let d = Math.max(1, from); d <= to; d++) {
        const { cells } = rowData(d);
        const filled = cells.filter(Boolean).length;
        const openSet = [];
        for (let c = 0; c < COLS; c++) if (!cells[c]) openSet.push(c);

        if (filled >= COLS) problems.push('solid row at depth ' + d);
        if (filled === 0) {
          emptyRun++;
          if (emptyRun > 0) problems.push('empty row at depth ' + d);
        } else {
          emptyRun = 0;
        }
        if (prevOpenSet && !openSet.some(c => prevOpenSet.indexOf(c) !== -1)) {
          problems.push('no shared open column between depth ' + (d - 1) + ' and ' + d);
        }
        // Only sudden increases matter. A row that suddenly gets easier is a
        // gift; a row that suddenly gets harder is the thing that feels unfair.
        if (prevCount !== null && filled - prevCount > 3) {
          problems.push('density spike at depth ' + d + ' (' + prevCount + ' to ' + filled + ')');
        }

        minCount = Math.min(minCount, filled);
        maxCount = Math.max(maxCount, filled);
        total += filled;
        prevOpenSet = openSet;
        prevCount = filled;
      }

      const rows = Math.max(1, to - Math.max(1, from) + 1);
      return {
        ok: problems.length === 0,
        rows,
        minCount,
        maxCount,
        meanCount: total / rows,
        problems: problems.slice(0, 40),
      };
    },
  };
}

export default createPatternSource;
