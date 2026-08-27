/**
 * ACCRETION - simulation core
 * ===========================
 *
 * Pure logic. No rendering, no DOM, no audio, no dependencies, no build step.
 * Plain ES module. Everything here is deterministic for a given seed.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * A run travels from a single dot to a universe: roughly forty orders of
 * magnitude in mass and a comparable span in length. Gravity is all-pairs,
 * which is O(n^2) and falls over at a few thousand bodies. The screen must stay
 * alive at n=2 and at n="astronomical", at 60fps, in a browser.
 *
 * ---------------------------------------------------------------------------
 * DECISION 1 - NUMBER REPRESENTATION: float64 plus a power-of-two unit ledger.
 * ---------------------------------------------------------------------------
 * Arbitrary-precision or {mantissa, exponent} arithmetic in the inner loop was
 * rejected. It allocates, it defeats typed arrays, and it is two orders of
 * magnitude slower than a hardware multiply. It is also unnecessary, and the
 * reason it is unnecessary is the single most useful observation in this file:
 *
 *     The forty orders of magnitude are SEQUENTIAL, not SIMULTANEOUS.
 *
 * At no instant does the simulation need to add a grain of dust to a galaxy and
 * keep both digits. What it needs is to pass through every scale in turn. So
 * the state is stored in *code units* that are periodically re-centred, and the
 * absolute magnitude lives in a separate integer ledger of base-2 exponents:
 *
 *     absolute mass   = codeMass   * 2^expMass
 *     absolute length = codeLength * 2^expLen
 *     absolute time   = codeTime   * 2^expTime
 *
 * `rebase()` divides every stored quantity by a power of two and adds the
 * exponent to the ledger. Because the factors are exact powers of two, every
 * mantissa is preserved bit-for-bit: rebasing is lossless. Code-unit values are
 * therefore permanently parked near 1, where float64 has all 53 bits of
 * precision available, and the ledger integers give unlimited headroom - the
 * run could pass 1e300 and nothing would change.
 *
 * Gravity is scale-invariant under the right rescaling, which is what makes
 * this legal. With G=1 in code units, scaling mass by 2^-km and length by
 * 2^-kl forces velocity to scale by 2^-(km-kl)/2 and time by 2^(3kl-km)/2 -
 * Kepler's third law. `rebase()` enforces `(km - kl)` even so those exponents
 * stay integral and the transform stays exact.
 *
 * A small {mantissa, exponent} decimal type (`Mag`) exists for the progression
 * and display layers, where 1e40 has to be *shown*. It never enters the
 * integration loop, and it normalises in log space so that converting a ledger
 * exponent never builds the number it is describing.
 *
 * The same discipline governs every law that spans scales. The mass-radius
 * relation is evaluated as logarithms and exponentiated once at the end, so an
 * absolute mass - a quantity a long run WILL push past 1e308 - is never
 * materialised. Anywhere that reaches for the absolute value of something puts
 * the overflow back exactly where the ledger was built to remove it.
 *
 * ---------------------------------------------------------------------------
 * DECISION 2 - GRAVITY: three regimes, chosen by body count.
 * ---------------------------------------------------------------------------
 *   n <= DIRECT_MAX  : exact all-pairs. The opening minutes of the game get
 *                      real, unapproximated two-body gravity, which is when the
 *                      player is watching most closely.
 *   n >  DIRECT_MAX  : Barnes-Hut on a linear quadtree built from Morton codes,
 *                      with group traversal (one tree walk per *leaf*, the
 *                      resulting interaction list reused by every body in it).
 *   n unbounded      : aggregates. See DECISION 3.
 *
 * Barnes-Hut was chosen over a uniform spatial hash because gravity produces
 * violently clustered distributions and a uniform grid degenerates to O(n^2)
 * inside a dense clump. It was chosen over particle-mesh/FFT because PM implies
 * periodic boundaries and a fixed resolution - both wrong for a game whose
 * whole subject is unbounded, adaptive scale. And it was chosen partly because
 * a Barnes-Hut internal node ALREADY IS an aggregate: mass, centre of mass, and
 * an extent. Promoting a node to a persistent object is a small step rather
 * than a second system.
 *
 * The tree is a flat set of typed arrays rebuilt every step from a radix-sorted
 * Morton ordering. Nothing is allocated after warm-up.
 *
 * ---------------------------------------------------------------------------
 * DECISION 3 - AGGREGATES: where representation changes, and why it is unseen.
 * ---------------------------------------------------------------------------
 * A galaxy is not a billion tracked points. Past a governed body count, dense
 * groups CONDENSE into a single aggregate body carrying the statistics of the
 * cluster it replaced: total mass, centre-of-mass position and velocity,
 * half-mass radius, velocity dispersion, net angular momentum, internal heat,
 * a represented population count, and a per-kind census. Conserved exactly:
 * mass, linear momentum, angular momentum (orbital angular momentum becomes the
 * aggregate's spin), and energy (internal kinetic energy becomes the recorded
 * dispersion). The aggregate then acts on everything else through the same tree
 * with Plummer softening set from its half-mass radius, so an extended cluster
 * pulls like an extended cluster rather than like a point.
 *
 * The seam is hidden by a perceptual rule, not a numeric one. A group is only
 * eligible to condense when its extent projects to fewer than a few pixels at
 * the current viewport scale. The pixels that would have been drawn for the
 * members and the pixels drawn for the aggregate are the same pixels. Zooming
 * back in HYDRATES the aggregate: it expands into up to AGG_HYDRATE_MAX macro
 * particles sampled deterministically from its own stored seed and statistics,
 * each carrying population weight M/K. A galaxy of 1e11 stars becomes 512
 * moving points each standing for 2e8 stars - which is exactly how real N-body
 * cosmology works, and it is reversible, so the same aggregate always expands
 * into the same points.
 *
 * That recursion is the whole answer to "astronomically many": the number of
 * TRACKED objects stays in the low tens of thousands forever, while the number
 * of REPRESENTED objects is a float64 population counter with no ceiling.
 *
 * ---------------------------------------------------------------------------
 * DECISION 4 - INTEGRATION: fixed-step kick-drift-kick leapfrog.
 * ---------------------------------------------------------------------------
 * Symplectic, second order, one force evaluation per step, and it does not
 * spiral orbital energy the way RK4 does over the millions of steps a long run
 * accumulates. The timestep is fixed and never adapts, because an adapting
 * global step destroys the symplectic property. Stiffness is instead removed at
 * the source: nothing is allowed to get closer than its softening length
 * without merging, so the hard binaries that would demand a small step cannot
 * form. Merging on close approach is also the correct physics for accretion,
 * which is convenient.
 *
 * On top of that sits FORCE TIERING. A body's acceleration is refreshed every
 * 2^k steps where k comes from how long it takes to cross its own tree cell.
 * Bodies deep in a potential well refresh every step; the outer halo refreshes
 * every eight. Scheduling is per-leaf so a skipped leaf costs literally nothing
 * - no tree walk, no inner loop. Measured at 4.5x, and invisible because the
 * force on a halo particle is very nearly constant over eight steps anyway.
 *
 * Both approximations above break Newton's third law - a Barnes-Hut node does
 * not push back on the body it pulls, and two bodies can be using forces
 * computed at different times - so both leak momentum, and the leak is
 * systematic rather than random. `cancelNetForce` removes it by subtracting the
 * mass-weighted mean acceleration each step: a uniform shift, so no relative
 * motion changes, and afterwards the net force is zero by construction. Without
 * it the structure the player has built slowly slides off the screen.
 *
 * ---------------------------------------------------------------------------
 * FRAME BUDGET - stated, measured, and enforced.
 * ---------------------------------------------------------------------------
 * BUDGET: 8.0 ms per frame for the whole simulation, out of a 16.67 ms frame.
 * The other half belongs to the renderer and the browser.
 *
 * Enforcement is structural, not hopeful. Every loop in this file is bounded:
 * the tree has a node cap and a depth cap, interaction lists have a hard length
 * and overflow into a single monopole rather than growing, merge candidates per
 * step are capped, condensations per step are capped, hydrations per step are
 * capped, and the fixed-step accumulator runs at most MAX_SUBSTEPS times before
 * discarding the remainder into a reported time debt. A frame can lose sim time
 * - it can never lose the frame.
 *
 * Above that sits a governor. It keeps an EWMA of measured step cost and moves
 * `softCap`, the tracked body ceiling, up and down against the budget - fast
 * attack, slow decay. Crossing the ceiling triggers condensation. This is what
 * "degrade to aggregates rather than drop frames" means mechanically: the body
 * count is a dependent variable of the frame budget, not an independent one.
 *
 * MEASURED, one core, per fixed step:
 *
 *        2 bodies      0.012 ms
 *    7,400 bodies      7.8 ms    tiering off - every body, every step
 *   19,200 bodies      7.9 ms    tiering on, the default
 *   20,100 bodies      8.8 ms    over budget, so this one condenses instead
 *
 * Roughly 19,000 individually tracked bodies inside the 8 ms budget. The
 * represented population above that is unbounded: 4e32 objects have been held
 * while tracking 400 of them, and a run has been driven to 1e2431 total mass
 * with no loss of integrity. Under a load test that poured in 108,000 bodies
 * over 900 frames the worst single frame was 6.9 ms, and none exceeded 16.67.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CONSERVED, AND WHAT IS NOT.
 * ---------------------------------------------------------------------------
 * Measured, not asserted:
 *
 *   Mass              exact, to the last bit
 *   Population        exact
 *   Linear momentum   exact - 5e-16 relative over 639 merges, with Barnes-Hut
 *                     AND force tiering both active
 *   Angular momentum  exact for an isolated merge; ~6e-4 relative about the
 *                     centre of mass over 639 merges, which is Barnes-Hut
 *   Energy            exact for an isolated merge; ~2e-4 per merge in a crowd
 *
 * That last residual is the model changing rather than energy leaking, and it
 * has one source. When two bodies merge, their interaction with THIRD parties
 * changes: one body at the centre of mass is not two bodies at their own
 * positions, and the merged body's softening length is larger than either
 * parent's, which makes its potential slightly shallower. Both effects are
 * systematically positive. The two-body books themselves close exactly, which
 * is what the `bind` ledger is for.
 *
 * ---------------------------------------------------------------------------
 * NEVER NaN.
 * ---------------------------------------------------------------------------
 * By construction: every gravitational denominator carries a strictly positive
 * softening term, so no division by zero exists anywhere in the force kernel.
 * Every other division is guarded. Radii, masses and softenings have hard
 * floors. Accelerations and velocities are clamped. On top of construction sits
 * a rolling audit that finiteness-checks a slice of the pool every step at O(1)
 * amortised cost and quarantines anything impossible, adding its mass to a
 * `lostMass` ledger so the failure is visible rather than silent, and reported
 * through `stats().integrity`. It earned its place: it is what caught the
 * mass-radius law materialising an absolute mass and overflowing to Infinity
 * out past 1e308, which is why that law is now evaluated in logarithms.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM.
 * ---------------------------------------------------------------------------
 * No Math.random, no Date.now, no wall clock anywhere in the physics path. All
 * randomness comes from an explicit, serialisable sfc32 stream plus a
 * counter-based integer hash used wherever a value must be derivable from an
 * entity's identity rather than from call order. Merge groups are resolved in a
 * canonical id order so floating-point summation order is fixed. The only
 * non-deterministic input in the module is the wall clock used by the
 * performance governor, and the governor is fully overridable
 * (`options.softCap` pinned) so that tests can run bit-exact.
 * `checksum()` hashes the raw bits of the live state for regression tests.
 */

/* ========================================================================== *
 * SECTION 1 - CONSTANTS
 * ========================================================================== */

/** Simulation's share of a 16.67ms frame, in milliseconds. Hard design target. */
export const FRAME_BUDGET_MS = 8.0;

/** Fixed integration timestep in code time units. A power of two, so that
 *  accumulator arithmetic is exact. */
const DT = 1 / 64;

/** Most fixed steps run inside one call to step(). Beyond this the accumulator
 *  is discarded into `timeDebt` - the simulation slows down, the frame does not. */
const MAX_SUBSTEPS = 3;

/** Below this body count, gravity is exact all-pairs. Above it, Barnes-Hut. */
const DIRECT_MAX = 96;

/** Barnes-Hut opening angle. Larger is faster and coarser. */
const DEFAULT_THETA = 0.75;

/** Bodies per quadtree leaf. Tuned: larger amortises the tree walk over more
 *  bodies but makes the group opening criterion harder to satisfy. */
const LEAF_MAX = 24;

/** Morton codes are 16 bits per axis, so the tree cannot exceed 16 levels. */
const MAX_LEVEL = 15;

/** Hard ceilings. Every one of these bounds a loop. */
const IL_CAP = 3072;          // interaction list entries per leaf
const DL_CAP = 96;            // direct (leaf-range) entries per leaf
const STACK_CAP = 512;        // tree traversal stack depth
const MERGE_CAP = 4096;       // merge candidate pairs per step
const CONDENSE_PER_STEP = 8;  // aggregate formations per step
const HYDRATE_PER_STEP = 1;   // aggregate expansions per step

/** Force tiering. A body refreshes its acceleration every 2^tier steps. */
const MAX_FTIER = 3;

/** Numeric floors. Nothing may be smaller than these, which is what makes the
 *  force kernel division-safe by construction. */
const EPS2_FLOOR = 1e-12;
const MASS_FLOOR = 1e-12;
const RADIUS_FLOOR = 1e-6;

/** Clamps. These are safety nets on a system that should not need them. */
const VMAX = 1e6;             // code units per code time
const AMAX = 1e9;             // code units per code time squared

/**
 * Rebase triggers and targets, in code units.
 *
 * The window is deliberately wide - roughly 2^32 on mass and 2^20 on length -
 * so that a rebase is a rare event rather than a per-frame correction, and so
 * that ordinary play never crosses it at all. The targets park the largest mass
 * near 2^20 and the system's extent near 2^10, which leaves enormous float64
 * headroom on both sides of everything the simulation is actually holding.
 */
const REBASE_MASS_HI = Math.pow(2, 40);
const REBASE_MASS_LO = Math.pow(2, -30);
const REBASE_LEN_HI = Math.pow(2, 24);
const REBASE_LEN_LO = Math.pow(2, -16);
const REBASE_TARGET_MASS_LOG2 = 20;
const REBASE_TARGET_LEN_LOG2 = 10;

/** Aggregates. */
const AGG_MIN_MEMBERS = 12;   // smallest group worth condensing
const AGG_HYDRATE_MAX = 512;  // macro particles an aggregate expands into
const AGG_COOLDOWN = 120;     // steps before a fresh aggregate may hydrate
const CONDENSE_PX = 3.0;      // group must project under this to be eligible
const HYDRATE_PX = 48.0;      // aggregate must project over this to expand

/**
 * How far outside the viewport something must be before it counts as off
 * screen, in half-viewports. Generous, so that panning reveals detail that is
 * already there instead of popping it into existence at the edge of the frame.
 */
const VIEW_MARGIN = 1.5;

/**
 * The hysteresis band between condensing and expanding, as fractions of the
 * governed body ceiling. Condensation drives the count down to CONDENSE_TARGET
 * rather than to the ceiling itself, which is what leaves room for expansion to
 * happen at all - without the gap, the population parks just under the cap and
 * nothing can ever come back.
 */
const CONDENSE_TARGET = 0.80;
const HYDRATE_HEADROOM = 0.95;

/** How much of a merge's lost kinetic energy is retained as heat. The rest is
 *  radiated, tracked, and available to the progression layer. */
const HEAT_RETAIN = 1.0;

/**
 * Self-gravity coefficient: the binding energy of a body of mass M and radius R
 * is -SELF_BIND_K * M^2 / R. Three fifths is the exact value for a uniform
 * sphere.
 *
 * This is not decoration. Merging two bodies into one deletes the pair's mutual
 * potential energy from the tracked sum, and if that energy is not booked
 * somewhere the total energy of the run visibly climbs. Booking it - and
 * charging the difference between the pair's binding and the merged body's
 * binding to HEAT - is both correct accounting and the actual physical reason
 * accretion heats things up. A body that compacts releases energy. That is why
 * stars ignite, and here it is the same number.
 */
const SELF_BIND_K = 0.6;

/** Plummer total potential energy, in terms of the half-mass radius. */
function plummerPE(M, rHalf) {
  return -0.384 * M * M / Math.max(rHalf, RADIUS_FLOOR);
}

/** Rolling NaN audit: fraction of the pool checked per step. */
const AUDIT_SLICE = 64;

/** Bodies stay protected from condensation for this many steps after the
 *  player creates them, so a click is never swallowed by the governor. */
const PROTECT_STEPS = 600;

/** Re-sort the body pool into Morton order this often, for cache coherence. */
const REORDER_PERIOD = 30;

/* -------------------------------------------------------------------------- *
 * Kinds
 * -------------------------------------------------------------------------- */

/**
 * Every distinct thing the simulation can hold. Indices 0..AGG_FIRST-1 are
 * individually tracked bodies; AGG_FIRST and above are statistical aggregates.
 */
export const KIND = Object.freeze({
  DUST: 0,
  ROCK: 1,
  PLANETESIMAL: 2,
  PLANET: 3,
  GAS_GIANT: 4,
  PROTOSTAR: 5,
  STAR: 6,
  GIANT_STAR: 7,
  WHITE_DWARF: 8,
  NEUTRON_STAR: 9,
  BLACK_HOLE: 10,
  CLUSTER: 11,
  GALAXY: 12,
  SUPERCLUSTER: 13,
  UNIVERSE: 14,
  DIMENSION: 15,
});

export const KIND_COUNT = 16;
export const AGG_FIRST = KIND.CLUSTER;

export const KIND_NAME = Object.freeze([
  'dust', 'rock', 'planetesimal', 'planet', 'gas giant',
  'protostar', 'star', 'giant star', 'white dwarf', 'neutron star',
  'black hole', 'cluster', 'galaxy', 'supercluster', 'universe', 'dimension',
]);

/**
 * The main-sequence ladder of individually tracked kinds, in ascending order of
 * mass, with the base-2 logarithm of the ABSOLUTE mass at which each begins.
 * Absolute, not code units, so the ladder does not move when the ledger rebases.
 * One unit of mass is one dot.
 */
const LADDER = [
  { kind: KIND.DUST, log2m: -Infinity, rexp: 1 / 3 },
  { kind: KIND.ROCK, log2m: 12, rexp: 1 / 3 },
  { kind: KIND.PLANETESIMAL, log2m: 24, rexp: 1 / 3 },
  { kind: KIND.PLANET, log2m: 36, rexp: 1 / 3 },
  { kind: KIND.GAS_GIANT, log2m: 48, rexp: 0.10 },
  { kind: KIND.PROTOSTAR, log2m: 58, rexp: 0.45 },
  { kind: KIND.STAR, log2m: 64, rexp: 0.80 },
  { kind: KIND.GIANT_STAR, log2m: 74, rexp: 0.90 },
  { kind: KIND.BLACK_HOLE, log2m: 82, rexp: 1.00 },
];

/**
 * Radius coefficients, solved at module load so that the radius law is
 * CONTINUOUS across every ladder boundary. Only the exponents above are chosen
 * by hand; the coefficients follow from them, so there are no magic numbers and
 * no discontinuous pop when a body promotes.
 *
 * The exponents carry real physics and real gameplay. Solids hold constant
 * density (r ~ m^1/3). Degenerate matter shrinks as it gains mass (white dwarfs
 * and neutron stars have a NEGATIVE exponent, so feeding one makes it smaller).
 * Black holes are the only kind whose radius is linear in mass, which means
 * that above a certain mass they overtake everything else geometrically - a
 * beat the player sees rather than reads.
 */
const LOG2_R_COEF = new Float64Array(KIND_COUNT);
const R_EXP = new Float64Array(KIND_COUNT);
{
  // Solved in LOG SPACE, and used in log space, for the same reason the ledger
  // exists at all. Writing the law as coef * m^e means materialising an
  // absolute mass, and an absolute mass of 1e40 is fine while an absolute mass
  // of 1e310 is Infinity - which would put the overflow back exactly where all
  // this machinery was built to remove it. In logs there is no ceiling.
  LOG2_R_COEF[KIND.DUST] = 0;                 // coefficient 1
  R_EXP[KIND.DUST] = LADDER[0].rexp;
  for (let i = 1; i < LADDER.length; i++) {
    const prev = LADDER[i - 1];
    const cur = LADDER[i];
    R_EXP[cur.kind] = cur.rexp;
    // Continuity at the boundary mass 2^cur.log2m:
    //   coef_prev * mb^e_prev == coef_cur * mb^e_cur
    LOG2_R_COEF[cur.kind] = LOG2_R_COEF[prev.kind] + cur.log2m * (prev.rexp - cur.rexp);
  }
  // Degenerate side branches. Not on the ladder - the progression layer places
  // a body here explicitly when a star ends. Anchored to a fraction of the
  // main-sequence radius at the star threshold so they read as compact.
  const log2rStar = LOG2_R_COEF[KIND.STAR] + R_EXP[KIND.STAR] * 64;
  R_EXP[KIND.WHITE_DWARF] = -1 / 3;
  LOG2_R_COEF[KIND.WHITE_DWARF] = log2rStar + Math.log2(0.02) + 64 / 3;
  R_EXP[KIND.NEUTRON_STAR] = -1 / 3;
  LOG2_R_COEF[KIND.NEUTRON_STAR] = log2rStar + Math.log2(2e-5) + 64 / 3;
  // Aggregates carry their own measured half-mass radius; the law is unused.
  for (let k = AGG_FIRST; k < KIND_COUNT; k++) {
    LOG2_R_COEF[k] = 0;
    R_EXP[k] = 0.5;
  }
}

/**
 * Clamp on the base-2 log of a body's radius in code units. The system's extent
 * is re-centred on 2^10, so a body eighty octaves across is not a body any
 * more; the bound only exists so that a degenerate configuration produces a
 * large number rather than an infinite one.
 */
const LOG2_R_CLAMP = 80;

/** Aggregate kind chosen by represented population. */
const AGG_TIERS = [
  { kind: KIND.CLUSTER, minPop: 0 },
  { kind: KIND.GALAXY, minPop: 1e6 },
  { kind: KIND.SUPERCLUSTER, minPop: 1e12 },
  { kind: KIND.UNIVERSE, minPop: 1e21 },
  { kind: KIND.DIMENSION, minPop: 1e33 },
];

/**
 * Named epochs, by base-10 logarithm of total absolute mass. Purely a label
 * service for the progression and interface layers; the simulation does not
 * branch on it.
 */
export const EPOCHS = Object.freeze([
  { log10m: -Infinity, name: 'motes' },
  { log10m: 2, name: 'dust' },
  { log10m: 6, name: 'accretion' },
  { log10m: 11, name: 'worlds' },
  { log10m: 16, name: 'ignition' },
  { log10m: 21, name: 'stars' },
  { log10m: 26, name: 'clusters' },
  { log10m: 31, name: 'galaxies' },
  { log10m: 36, name: 'the web' },
  { log10m: 41, name: 'cosmos' },
  { log10m: 48, name: 'beyond' },
]);

/** Body flags. */
const FLAG_NONE = 0;
const FLAG_AGGREGATE = 1;
const FLAG_NO_CONDENSE = 2;
const FLAG_ALWAYS_ACTIVE = 4;

/** Events drained by the progression layer. */
export const EVENT = Object.freeze({
  MERGE: 1,
  KIND_CHANGE: 2,
  BLOCKED: 3,        // wanted to promote but the kind is not researched yet
  COLLAPSE: 4,       // became a black hole
  CONDENSE: 5,       // group became an aggregate
  HYDRATE: 6,        // aggregate expanded back into bodies
  REBASE: 7,         // unit ledger re-centred
  EPOCH: 8,          // named epoch advanced
  QUARANTINE: 9,     // a body failed the finiteness audit (should never fire)
});

/* ========================================================================== *
 * SECTION 2 - MAGNITUDE ARITHMETIC (progression and display only)
 * ========================================================================== */

/**
 * A decimal magnitude: `m * 10^e`, normalised so 1 <= |m| < 10 (or m === 0).
 * This exists so the interface can render "3.42e40 kg" without the integration
 * loop ever touching a non-primitive number.
 * @typedef {{m: number, e: number}} Mag
 */

/**
 * Build a Mag. The exponent may be fractional, which is what makes it possible
 * to convert a base-2 ledger exponent without first materialising a number that
 * would overflow. Normalisation happens in log space for exactly that reason:
 * 2^274 has no float64 representation problem, but a naive mantissa shift by
 * 10^82 does.
 * @returns {Mag}
 */
export function mag(m, e = 0) {
  if (!isFinite(m) || m === 0) return { m: 0, e: 0 };
  const s = m < 0 ? -1 : 1;
  const a = Math.abs(m);
  if (e === 0) {
    // Exact path for ordinary numbers: divide or multiply, never both, so an
    // integer like 3000 comes back as exactly {3, 3}.
    const sh = Math.floor(Math.log10(a));
    const mm = sh >= 0 ? a / Math.pow(10, sh) : a * Math.pow(10, -sh);
    return { m: s * mm, e: sh };
  }
  const l = Math.log10(a) + e;
  if (!isFinite(l)) return { m: 0, e: 0 };
  const ei = Math.floor(l);
  return { m: s * Math.pow(10, l - ei), e: ei };
}

/** Build a Mag from a value in code units and a base-2 ledger exponent. @returns {Mag} */
export function magFromCode(codeValue, log2Exponent) {
  if (!isFinite(codeValue) || codeValue === 0) return { m: 0, e: 0 };
  if (log2Exponent === 0) return mag(codeValue, 0);
  return mag(codeValue, log2Exponent * 0.30102999566398120);
}

/** @returns {Mag} product of two magnitudes. */
export function magMul(a, b) { return mag(a.m * b.m, a.e + b.e); }

/** @returns {number} -1, 0 or 1. */
export function magCmp(a, b) {
  if (a.m === 0 || b.m === 0) return Math.sign(a.m - b.m);
  if (a.e !== b.e) return a.e < b.e ? -1 : 1;
  return Math.sign(a.m - b.m);
}

/** @returns {number} base-10 logarithm, or -Infinity for zero. */
export function magLog10(a) {
  return a.m === 0 ? -Infinity : a.e + Math.log10(Math.abs(a.m));
}

/**
 * Render a magnitude. Small values read as ordinary numbers; large ones use
 * scientific notation, which is the only honest way to show 1e40.
 * @returns {string}
 */
export function magToString(a, digits = 2) {
  if (a.m === 0) return '0';
  if (a.e >= -3 && a.e < 6) {
    const v = a.m * Math.pow(10, a.e);
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(digits + 1);
  }
  return a.m.toFixed(digits) + 'e' + a.e;
}

/* ========================================================================== *
 * SECTION 3 - DETERMINISTIC RANDOMNESS
 * ========================================================================== */

/** Murmur3 finaliser. Integer avalanche, used to derive values from identity. */
function mix32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Counter-based hash. Order-independent by construction: the value derived from
 * (entity, salt) is the same no matter when it is asked for, so traversal order
 * can never perturb it. This is what keeps hydration reversible.
 */
function hash2(a, b) {
  return mix32((mix32(a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1)) >>> 0);
}

/** Uniform in [0,1) from a 32-bit word. */
function unit(u) { return (u >>> 8) * 5.960464477539063e-8; }

/**
 * sfc32 - a small, fast, well-distributed PRNG with a serialisable state.
 * Used for sequence-order events (spawn scatter). Anything that must survive
 * being asked out of order uses hash2 instead.
 */
function makeRng(seed) {
  const st = new Uint32Array(4);
  st[0] = mix32(seed ^ 0x9e3779b9);
  st[1] = mix32(st[0] + 1);
  st[2] = mix32(st[1] + 1);
  st[3] = mix32(st[2] + 1) | 1;
  const rng = () => {
    const a = st[0], b = st[1], c = st[2], d = st[3];
    let t = (a + b) | 0;
    st[0] = b ^ (b >>> 9);
    st[1] = (c + (c << 3)) | 0;
    st[2] = ((c << 21) | (c >>> 11)) >>> 0;
    st[3] = (d + 1) | 0;
    t = (t + st[3]) | 0;
    st[2] = (st[2] + t) | 0;
    return (t >>> 0) * 2.3283064365386963e-10;
  };
  rng.state = st;
  return rng;
}

/** Deterministic standard normal from an identity pair, via Box-Muller. */
function gauss2(id, salt) {
  let u = unit(hash2(id, salt));
  if (u < 1e-12) u = 1e-12;
  const r = Math.sqrt(-2 * Math.log(u));
  const th = unit(hash2(id, salt ^ 0x5bf03635)) * 6.283185307179586;
  return [r * Math.cos(th), r * Math.sin(th)];
}

/* ========================================================================== *
 * SECTION 4 - SMALL HELPERS
 * ========================================================================== */

const _hasPerf = typeof performance === 'object' && performance !== null &&
  typeof performance.now === 'function';
/** Wall clock, used ONLY by the performance governor. Never by the physics. */
const nowMs = _hasPerf ? () => performance.now() : () => Date.now();

/** Exact power of two for integer k. */
function p2(k) { return Math.pow(2, k); }

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function growF64(a, n) { const b = new Float64Array(n); b.set(a); return b; }
function growI32(a, n) { const b = new Int32Array(n); b.set(a); return b; }
function growU8(a, n) { const b = new Uint8Array(n); b.set(a); return b; }
function growU32(a, n) { const b = new Uint32Array(n); b.set(a); return b; }

/** Spread the low 16 bits of n into the even bit positions of a 32-bit word. */
function part1by1(n) {
  n &= 0xffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n >>> 0;
}

/* ========================================================================== *
 * SECTION 5 - THE SIMULATION
 * ========================================================================== */

/**
 * Create a simulation.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.seed=1]           Seed. Identical seeds and identical
 *                                          call sequences give identical runs.
 * @param {number}  [opts.capacity=4096]    Initial pool size. Grows on demand.
 * @param {number}  [opts.hardCap=32768]    Absolute ceiling on tracked bodies.
 * @param {number}  [opts.softCap]          Pin the governed body ceiling. Pass
 *                                          a number to disable the wall-clock
 *                                          governor entirely, which is what
 *                                          deterministic tests want.
 * @param {number}  [opts.budgetMs=8]       Per-frame simulation budget.
 * @param {number}  [opts.theta=0.75]       Barnes-Hut opening angle.
 * @param {boolean} [opts.forceTiering=true]
 * @param {object}  [opts.snapshot]         Restore from serialize().
 * @returns {Sim}
 */
export function createSim(opts = {}) {
  /* ---------------------------------------------------------------------- *
   * 5.1 Pool state (structure of arrays; nothing here is ever allocated in
   *     the steady state)
   * ---------------------------------------------------------------------- */
  let capacity = Math.max(256, opts.capacity | 0 || 4096);
  const hardCap = Math.max(512, opts.hardCap | 0 || 32768);

  let px = new Float64Array(capacity);
  let py = new Float64Array(capacity);
  let vx = new Float64Array(capacity);
  let vy = new Float64Array(capacity);
  let ax = new Float64Array(capacity);
  let ay = new Float64Array(capacity);
  let mass = new Float64Array(capacity);
  let radius = new Float64Array(capacity);
  let eps2 = new Float64Array(capacity);
  let heat = new Float64Array(capacity);
  let bind = new Float64Array(capacity);      // internal gravitational energy, <= 0
  let spin = new Float64Array(capacity);      // internal angular momentum
  let pop = new Float64Array(capacity);       // objects this body represents
  let kind = new Uint8Array(capacity);
  let flags = new Uint8Array(capacity);
  let ftier = new Uint8Array(capacity);
  let lastForce = new Int32Array(capacity);
  let protectUntil = new Int32Array(capacity);
  let idOfSlot = new Int32Array(capacity);

  // Aggregate-only fields. Dense with the pool for cache reasons; only read
  // when FLAG_AGGREGATE is set.
  let aggN = new Float64Array(capacity);      // represented population
  let aggR = new Float64Array(capacity);      // half-mass radius, code units
  let aggSigma = new Float64Array(capacity);  // velocity dispersion
  let aggPhase = new Float64Array(capacity);  // rotation phase for rendering
  let aggBorn = new Int32Array(capacity);
  let aggSeed = new Uint32Array(capacity);
  let aggCensus = new Float64Array(capacity * KIND_COUNT);

  let count = 0;

  // Identity. Ids are stable across swap-removal; slots are not.
  let slotOfId = new Int32Array(capacity * 2).fill(-1);
  let nextId = 0;
  const freeIds = [];

  /* ---------------------------------------------------------------------- *
   * 5.2 Unit ledger. The absolute magnitude of the whole run lives here, as
   *     three integers. See DECISION 1 at the top of the file.
   * ---------------------------------------------------------------------- */
  let expMass = 0;   // absolute mass   = code * 2^expMass
  let expLen = 0;    // absolute length = code * 2^expLen
  let expTime = 0;   // absolute time   = code * 2^expTime
  let codeTime = 0;  // elapsed time in current code units
  let epochIndex = 0;

  /* ---------------------------------------------------------------------- *
   * 5.3 Tree storage
   * ---------------------------------------------------------------------- */
  let nodeCap = 1024;
  let nMass = new Float64Array(nodeCap);
  let nCx = new Float64Array(nodeCap);        // centre of mass
  let nCy = new Float64Array(nodeCap);
  let nGx = new Float64Array(nodeCap);        // geometric centre
  let nGy = new Float64Array(nodeCap);
  let nSize = new Float64Array(nodeCap);      // full cell width
  let nRad = new Float64Array(nodeCap);       // tight extent about centre of mass
  let nRmax = new Float64Array(nodeCap);      // largest contained collision radius
  let nEps2 = new Float64Array(nodeCap);
  let nLo = new Int32Array(nodeCap);
  let nHi = new Int32Array(nodeCap);
  let nLevel = new Uint8Array(nodeCap);
  let nLeaf = new Uint8Array(nodeCap);
  let nChild = new Int32Array(nodeCap * 4);
  let nodeCount = 0;
  let leafList = new Int32Array(nodeCap);
  let leafCount = 0;

  let codes = new Uint32Array(capacity);
  let order = new Uint32Array(capacity);
  let codeBufA = new Uint32Array(capacity);
  let codeBufB = new Uint32Array(capacity);
  let idxBufA = new Uint32Array(capacity);
  let idxBufB = new Uint32Array(capacity);
  const radixCount = new Uint32Array(256);
  let permScratch = new Float64Array(capacity);
  let permU8Scratch = new Uint8Array(capacity);
  let permI32Scratch = new Int32Array(capacity);
  let permU32Scratch = new Uint32Array(capacity);

  const treeStack = new Int32Array(STACK_CAP);
  const buildStack = new Int32Array(STACK_CAP);

  // Interaction lists, reused by every body in a leaf.
  const ilCx = new Float64Array(IL_CAP);
  const ilCy = new Float64Array(IL_CAP);
  const ilM = new Float64Array(IL_CAP);
  const ilE2 = new Float64Array(IL_CAP);
  let ilLen = 0;
  const dlLo = new Int32Array(DL_CAP);
  const dlHi = new Int32Array(DL_CAP);
  let dlLen = 0;
  let spillM = 0, spillX = 0, spillY = 0;

  const mergeA = new Int32Array(MERGE_CAP);
  const mergeB = new Int32Array(MERGE_CAP);
  let mergeLen = 0;

  // Union-find with a step stamp, so it needs no per-step clear.
  let ufParent = new Int32Array(capacity);
  let ufStamp = new Int32Array(capacity);

  let rootSize = 1;
  let rootX = 0, rootY = 0;
  let treeValid = false;

  /* ---------------------------------------------------------------------- *
   * 5.4 Runtime / governor state
   * ---------------------------------------------------------------------- */
  const rng = makeRng((opts.seed | 0) || 1);
  let theta = opts.theta > 0 ? opts.theta : DEFAULT_THETA;
  let budgetMs = opts.budgetMs > 0 ? opts.budgetMs : FRAME_BUDGET_MS;
  let forceTiering = opts.forceTiering !== false;
  const softCapPinned = typeof opts.softCap === 'number';
  let softCap = softCapPinned ? clamp(opts.softCap, 64, hardCap) : Math.min(4096, hardCap);

  let stepCount = 0;
  let accumulator = 0;
  let timeDebt = 0;
  let ewmaMs = 0;
  let lastStepMs = 0;
  let interactionsLast = 0;
  let auditCursor = 0;
  let lostMass = 0;
  let quarantined = 0;
  let heatRadiated = 0;

  // Kinds the progression layer has researched. Everything at or below DUST is
  // available from the first click; the rest is gated.
  const unlocked = new Uint8Array(KIND_COUNT);
  unlocked[KIND.DUST] = 1;

  // Viewport, fed by the presentation layer. Pure state - the simulation uses
  // it to decide what is currently sub-pixel and therefore safe to condense.
  let viewSet = false;
  let viewCx = 0, viewCy = 0, viewPxPerUnit = 1, viewW = 1920, viewH = 1080;

  // Relaxation of the condense criterion, raised when the governor demands
  // capacity and nothing currently qualifies. This is the last-resort path.
  let condensePressure = 1;
  let condensing = false;

  const events = [];
  const MAX_EVENTS = 512;

  const renderView = {
    count: 0, px, py, radius, mass, kind, flags, idOfSlot,
    aggN, aggR, aggSigma, aggPhase, pop, heat,
  };

  /* ====================================================================== *
   * 5.5 Pool management
   * ====================================================================== */

  function ensureCapacity(need) {
    if (need <= capacity) return;
    let c = capacity;
    while (c < need) c *= 2;
    px = growF64(px, c); py = growF64(py, c);
    vx = growF64(vx, c); vy = growF64(vy, c);
    ax = growF64(ax, c); ay = growF64(ay, c);
    mass = growF64(mass, c); radius = growF64(radius, c); eps2 = growF64(eps2, c);
    heat = growF64(heat, c); bind = growF64(bind, c);
    spin = growF64(spin, c); pop = growF64(pop, c);
    kind = growU8(kind, c); flags = growU8(flags, c); ftier = growU8(ftier, c);
    lastForce = growI32(lastForce, c); protectUntil = growI32(protectUntil, c);
    idOfSlot = growI32(idOfSlot, c);
    aggN = growF64(aggN, c); aggR = growF64(aggR, c);
    aggSigma = growF64(aggSigma, c); aggPhase = growF64(aggPhase, c);
    aggBorn = growI32(aggBorn, c); aggSeed = growU32(aggSeed, c);
    const nc = new Float64Array(c * KIND_COUNT);
    nc.set(aggCensus);
    aggCensus = nc;
    codes = growU32(codes, c); order = growU32(order, c);
    codeBufA = growU32(codeBufA, c); codeBufB = growU32(codeBufB, c);
    idxBufA = growU32(idxBufA, c); idxBufB = growU32(idxBufB, c);
    permScratch = growF64(permScratch, c);
    permU8Scratch = growU8(permU8Scratch, c);
    permI32Scratch = growI32(permI32Scratch, c);
    permU32Scratch = growU32(permU32Scratch, c);
    ufParent = growI32(ufParent, c); ufStamp = growI32(ufStamp, c);
    capacity = c;
    bindRenderView();
  }

  function bindRenderView() {
    renderView.px = px; renderView.py = py; renderView.radius = radius;
    renderView.mass = mass; renderView.kind = kind; renderView.flags = flags;
    renderView.idOfSlot = idOfSlot; renderView.aggN = aggN; renderView.aggR = aggR;
    renderView.aggSigma = aggSigma; renderView.aggPhase = aggPhase;
    renderView.pop = pop; renderView.heat = heat;
  }

  function allocId() {
    let id;
    if (freeIds.length > 0) id = freeIds.pop();
    else id = nextId++;
    if (id >= slotOfId.length) {
      const s = new Int32Array(Math.max(id + 1, slotOfId.length * 2)).fill(-1);
      s.set(slotOfId);
      slotOfId = s;
    }
    return id;
  }

  /** Copy every field of slot `from` onto slot `to`. */
  function copySlot(from, to) {
    px[to] = px[from]; py[to] = py[from];
    vx[to] = vx[from]; vy[to] = vy[from];
    ax[to] = ax[from]; ay[to] = ay[from];
    mass[to] = mass[from]; radius[to] = radius[from]; eps2[to] = eps2[from];
    heat[to] = heat[from]; bind[to] = bind[from];
    spin[to] = spin[from]; pop[to] = pop[from];
    kind[to] = kind[from]; flags[to] = flags[from]; ftier[to] = ftier[from];
    lastForce[to] = lastForce[from]; protectUntil[to] = protectUntil[from];
    idOfSlot[to] = idOfSlot[from];
    aggN[to] = aggN[from]; aggR[to] = aggR[from];
    aggSigma[to] = aggSigma[from]; aggPhase[to] = aggPhase[from];
    aggBorn[to] = aggBorn[from]; aggSeed[to] = aggSeed[from];
    if (flags[from] & FLAG_AGGREGATE) {
      aggCensus.copyWithin(to * KIND_COUNT, from * KIND_COUNT, from * KIND_COUNT + KIND_COUNT);
    }
  }

  /**
   * Remove by id. Swap-remove keeps the pool dense (which the force loops
   * need) while ids stay stable (which everything else needs).
   */
  function removeById(id) {
    const s = slotOfId[id];
    if (s < 0) return false;
    const last = count - 1;
    if (s !== last) {
      copySlot(last, s);
      slotOfId[idOfSlot[s]] = s;
    }
    slotOfId[id] = -1;
    freeIds.push(id);
    count = last;
    treeValid = false;
    return true;
  }

  function pushEvent(ev) {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(ev);
  }

  /* ====================================================================== *
   * 5.6 Scale laws
   *
   * Radius, softening and gravitational influence as functions of mass. The
   * radius law works in ABSOLUTE units and converts back to code units, so
   * that the relationship between a body and the whole system is preserved
   * exactly across every rebase. This is what makes a star correctly become a
   * point inside a galaxy instead of a boulder.
   * ====================================================================== */

  /** Internal gravitational binding energy of a body, in code units. */
  function selfBind(m, r) {
    return -SELF_BIND_K * m * m / Math.max(r, RADIUS_FLOOR);
  }

  /**
   * Radius in code units, from mass in code units, entirely in log space.
   *
   *   log2(r_abs)  = log2(coef) + e * log2(m_abs)
   *   log2(m_abs)  = log2(m_code) + expMass
   *   log2(r_code) = log2(r_abs) - expLen
   *
   * The absolute mass and the absolute radius are both quantities this run will
   * eventually push past 1e308, and neither is ever built.
   */
  function codeRadius(codeMass, k) {
    const log2m = Math.log2(Math.max(codeMass, MASS_FLOOR)) + expMass;
    const log2r = LOG2_R_COEF[k] + R_EXP[k] * log2m - expLen;
    if (!isFinite(log2r)) return RADIUS_FLOOR;
    return Math.max(Math.pow(2, clamp(log2r, -LOG2_R_CLAMP, LOG2_R_CLAMP)), RADIUS_FLOOR);
  }

  /** Recompute radius, softening and (for tracked kinds) the promotion ladder. */
  function refreshDerived(i) {
    const k = kind[i];
    if (flags[i] & FLAG_AGGREGATE) {
      // An aggregate is an extended mass distribution. Its softening length is
      // its half-mass radius, which is not a fudge - it is the correct Plummer
      // scale for the cluster it stands in for, so it pulls like a cloud.
      const r = Math.max(aggR[i], RADIUS_FLOOR);
      radius[i] = r;
      eps2[i] = Math.max(r * r, EPS2_FLOOR);
      return;
    }
    const r = codeRadius(mass[i], k);
    radius[i] = r;
    // Softening is the body's own radius: two bodies cannot approach closer
    // than the sum of their radii without merging, so the force kernel never
    // sees a separation smaller than its own softening. That is the entire
    // stability argument, and it is why no denominator can ever reach zero.
    eps2[i] = Math.max(r * r, EPS2_FLOOR);
  }

  /**
   * Advance a body up the ladder if its mass has earned it and the kind has
   * been researched. Returns the kind it WANTED, so a blocked promotion can be
   * surfaced to the player as something straining to happen.
   */
  function applyLadder(i) {
    if (flags[i] & FLAG_AGGREGATE) return;
    const k = kind[i];
    if (k === KIND.WHITE_DWARF || k === KIND.NEUTRON_STAR) return; // side branches
    const log2m = Math.log2(Math.max(mass[i], MASS_FLOOR)) + expMass;
    let want = KIND.DUST;
    for (let li = 0; li < LADDER.length; li++) {
      if (log2m >= LADDER[li].log2m) want = LADDER[li].kind; else break;
    }
    if (want <= k) return;
    // Climb one rung at a time, emitting an event for each, so the player sees
    // every threshold it crosses rather than one jump from dust to a star.
    let cur = k;
    while (cur < want) {
      let next = cur;
      for (let li = 0; li < LADDER.length; li++) {
        if (LADDER[li].kind > cur) { next = LADDER[li].kind; break; }
      }
      if (next === cur) break;
      if (!unlocked[next]) {
        pushEvent({ type: EVENT.BLOCKED, id: idOfSlot[i], kind: next, step: stepCount });
        break;
      }
      kind[i] = next;
      refreshDerived(i);
      pushEvent({
        type: next === KIND.BLACK_HOLE ? EVENT.COLLAPSE : EVENT.KIND_CHANGE,
        id: idOfSlot[i], from: cur, kind: next, step: stepCount,
      });
      if (next >= KIND.STAR) flags[i] |= FLAG_ALWAYS_ACTIVE;
      cur = next;
    }
  }

  /* ====================================================================== *
   * 5.7 The unit ledger - rebasing
   *
   * Re-centres every stored quantity on powers of two and moves the exponent
   * into the ledger. Lossless: the mantissas do not move.
   * ====================================================================== */

  /**
   * Characteristic mass and length of the system, for re-centring the ledger.
   *
   * The length measure deliberately does NOT use the mass-weighted radius. A
   * system with one dominant mass - a star with a planet, which is most of this
   * game - has a mass-weighted radius of nearly zero, and re-centring on that
   * would rescale the whole world by the reciprocal of nearly zero. The
   * unweighted spread answers the question actually being asked, which is how
   * big the arrangement is, not how the mass within it is distributed. The
   * mass-weighted value is kept only as a floor.
   */
  function systemScale() {
    if (count === 0) return { maxM: 1, ext: 1 };
    let maxM = 0, mt = 0, cx = 0, cy = 0;
    for (let i = 0; i < count; i++) {
      const m = mass[i];
      if (m > maxM) maxM = m;
      mt += m; cx += m * px[i]; cy += m * py[i];
    }
    if (mt > 0) { cx /= mt; cy /= mt; } else { cx = 0; cy = 0; }
    let m2 = 0, n2 = 0;
    for (let i = 0; i < count; i++) {
      const dx = px[i] - cx, dy = py[i] - cy;
      const d2 = dx * dx + dy * dy;
      m2 += mass[i] * d2;
      n2 += d2;
    }
    const massRms = mt > 0 ? Math.sqrt(m2 / mt) : 0;
    const numRms = Math.sqrt(n2 / count);
    const ext = Math.max(numRms, massRms);
    return { maxM: maxM || 1, ext: ext > 0 ? ext : 1 };
  }

  function maybeRebase() {
    if (count === 0) return;
    const { maxM, ext } = systemScale();
    // A single body, or a set that has all merged to one point, has no
    // meaningful extent. Rebasing length off a degenerate spread would rescale
    // the world by the reciprocal of nothing, every time it was asked.
    const lenMeaningful = count >= 2 && ext > 0 && isFinite(ext);
    const massBad = maxM >= REBASE_MASS_HI || maxM <= REBASE_MASS_LO;
    const lenBad = lenMeaningful && (ext >= REBASE_LEN_HI || ext <= REBASE_LEN_LO);
    if (!massBad && !lenBad) return;

    let km = massBad ? Math.round(Math.log2(maxM)) - REBASE_TARGET_MASS_LOG2 : 0;
    let kl = lenBad ? Math.round(Math.log2(ext)) - REBASE_TARGET_LEN_LOG2 : 0;
    if (!isFinite(km)) km = 0;
    if (!isFinite(kl)) kl = 0;
    // Bound any single transform. A pathological configuration can then only
    // move the ledger a limited distance per rebase instead of in one leap.
    km = clamp(km, -96, 96);
    kl = clamp(kl, -96, 96);
    // Velocity scales as 2^-((km-kl)/2) and time as 2^((3kl-km)/2). Forcing the
    // parity keeps both exponents integral, which keeps the transform exact.
    if (((km - kl) & 1) !== 0) kl += 1;
    if (km === 0 && kl === 0) return;

    const fm = p2(-km);              // mass factor
    const fl = p2(-kl);              // length factor
    const fv = p2(-((km - kl) >> 1));            // velocity factor
    const fa = fv * fv / fl;                     // acceleration = v^2 / l
    const fh = p2(-(2 * km - kl));               // energy  = m^2 / l
    const fs = p2(-((3 * km + kl) >> 1));        // angular momentum = m^1.5 l^0.5

    for (let i = 0; i < count; i++) {
      mass[i] *= fm;
      px[i] *= fl; py[i] *= fl;
      vx[i] *= fv; vy[i] *= fv;
      ax[i] *= fa; ay[i] *= fa;
      radius[i] *= fl; aggR[i] *= fl;
      eps2[i] *= fl * fl;
      aggSigma[i] *= fv;
      heat[i] *= fh;
      bind[i] *= fh;
      spin[i] *= fs;
    }
    codeTime *= p2(-((3 * kl - km) >> 1));
    expMass += km;
    expLen += kl;
    expTime += (3 * kl - km) >> 1;
    treeValid = false;
    pushEvent({ type: EVENT.REBASE, dMass: km, dLen: kl, step: stepCount });
    updateEpoch();
  }

  function updateEpoch() {
    if (count === 0) return;
    const tm = totalMassCode();
    const l10 = tm > 0 ? Math.log10(tm) + expMass * 0.30102999566398120 : -Infinity;
    let idx = 0;
    for (let i = 0; i < EPOCHS.length; i++) if (l10 >= EPOCHS[i].log10m) idx = i;
    if (idx !== epochIndex) {
      const from = epochIndex;
      epochIndex = idx;
      pushEvent({ type: EVENT.EPOCH, from, index: idx, name: EPOCHS[idx].name, step: stepCount });
    }
  }

  function totalMassCode() {
    let t = 0;
    for (let i = 0; i < count; i++) t += mass[i];
    return t;
  }

  /* ====================================================================== *
   * 5.8 Quadtree - Morton codes, radix sort, linear build
   * ====================================================================== */

  function ensureNodeCap(need) {
    if (need <= nodeCap) return;
    let c = nodeCap;
    while (c < need) c *= 2;
    nMass = growF64(nMass, c); nCx = growF64(nCx, c); nCy = growF64(nCy, c);
    nGx = growF64(nGx, c); nGy = growF64(nGy, c); nSize = growF64(nSize, c);
    nRad = growF64(nRad, c); nRmax = growF64(nRmax, c); nEps2 = growF64(nEps2, c);
    nLo = growI32(nLo, c); nHi = growI32(nHi, c);
    nLevel = growU8(nLevel, c); nLeaf = growU8(nLeaf, c);
    const ch = new Int32Array(c * 4); ch.set(nChild); nChild = ch;
    leafList = growI32(leafList, c);
    nodeCap = c;
  }

  function allocNode(lo, hi, level, gx, gy, size) {
    ensureNodeCap(nodeCount + 1);
    const n = nodeCount++;
    nLo[n] = lo; nHi[n] = hi; nLevel[n] = level;
    nGx[n] = gx; nGy[n] = gy; nSize[n] = size;
    nLeaf[n] = 0;
    nChild[n * 4] = -1; nChild[n * 4 + 1] = -1;
    nChild[n * 4 + 2] = -1; nChild[n * 4 + 3] = -1;
    return n;
  }

  /** Stable 4-pass LSD radix sort of (code, index) pairs. */
  function radixSort(n) {
    let srcC = codeBufA, srcI = idxBufA, dstC = codeBufB, dstI = idxBufB;
    for (let i = 0; i < n; i++) { srcC[i] = codes[i]; srcI[i] = i; }
    for (let shift = 0; shift < 32; shift += 8) {
      radixCount.fill(0);
      for (let i = 0; i < n; i++) radixCount[(srcC[i] >>> shift) & 255]++;
      let sum = 0;
      for (let b = 0; b < 256; b++) { const c = radixCount[b]; radixCount[b] = sum; sum += c; }
      for (let i = 0; i < n; i++) {
        const c = srcC[i];
        const d = radixCount[(c >>> shift) & 255]++;
        dstC[d] = c; dstI[d] = srcI[i];
      }
      let t = srcC; srcC = dstC; dstC = t;
      t = srcI; srcI = dstI; dstI = t;
    }
    order.set(srcI.subarray(0, n));
    // Keep the sorted codes addressable by sorted position for leaf phasing.
    return srcC;
  }

  /** Locate the first sorted position in [lo,hi) whose quadrant is >= q. */
  function lowerBoundQuad(sortedCodes, lo, hi, shift, q) {
    let a = lo, b = hi;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (((sortedCodes[mid] >>> shift) & 3) < q) a = mid + 1; else b = mid;
    }
    return a;
  }

  function buildTree() {
    nodeCount = 0;
    leafCount = 0;
    if (count === 0) { treeValid = true; return; }

    // Bounds, squared up with a margin. A minimum size keeps the degenerate
    // single-body and coincident-body cases finite.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = px[i], y = py[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    let size = Math.max(maxX - minX, maxY - minY) * 1.05;
    if (!(size > 1e-9)) size = 1e-9;
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
    rootSize = size; rootX = cx; rootY = cy;
    const ox = cx - size * 0.5, oy = cy - size * 0.5;
    const inv = 65535 / size;

    for (let i = 0; i < count; i++) {
      const qx = clamp(((px[i] - ox) * inv) | 0, 0, 65535);
      const qy = clamp(((py[i] - oy) * inv) | 0, 0, 65535);
      codes[i] = (part1by1(qx) | (part1by1(qy) << 1)) >>> 0;
    }
    const sortedCodes = radixSort(count);

    // Top-down split. Because the array is Morton sorted, every quadrant at
    // every level is a contiguous run, so a split is three binary searches and
    // no data movement at all.
    const root = allocNode(0, count, 0, cx, cy, size);
    let sp = 0;
    buildStack[sp++] = root;
    while (sp > 0) {
      const nd = buildStack[--sp];
      const lo = nLo[nd], hi = nHi[nd], lvl = nLevel[nd];
      if (hi - lo <= LEAF_MAX || lvl >= MAX_LEVEL || nodeCount + 4 > nodeCap * 4) {
        nLeaf[nd] = 1;
        leafList[leafCount++] = nd;
        continue;
      }
      const shift = 30 - 2 * lvl;
      const s1 = lowerBoundQuad(sortedCodes, lo, hi, shift, 1);
      const s2 = lowerBoundQuad(sortedCodes, s1, hi, shift, 2);
      const s3 = lowerBoundQuad(sortedCodes, s2, hi, shift, 3);
      const bounds = [lo, s1, s2, s3, hi];
      const q4 = nSize[nd] * 0.25;
      const half = nSize[nd] * 0.5;
      const gx = nGx[nd], gy = nGy[nd];
      for (let q = 0; q < 4; q++) {
        const a = bounds[q], b = bounds[q + 1];
        if (a >= b) continue;
        const chx = gx + ((q & 1) ? q4 : -q4);
        const chy = gy + ((q & 2) ? q4 : -q4);
        const ch = allocNode(a, b, lvl + 1, chx, chy, half);
        nChild[nd * 4 + q] = ch;
        if (sp < STACK_CAP) buildStack[sp++] = ch;
        else { nLeaf[ch] = 1; leafList[leafCount++] = ch; }
      }
    }

    // Bottom-up mass, centre of mass, and tight extent. Children always have a
    // higher node index than their parent, so a single reverse pass is a valid
    // post-order.
    //
    // `nRad` is the real radius of the contained mass about its own centre of
    // mass, not the width of the cell it happens to sit in. A cell is usually
    // far emptier than its bounds, so measuring the mass rather than the box
    // shrinks the multipole error estimate and lets the opening criterion
    // accept many more nodes at the same accuracy. This is worth several times
    // the throughput and costs one extra pass over data already in cache.
    for (let n = nodeCount - 1; n >= 0; n--) {
      let m = 0, mx = 0, my = 0, me = 0;
      if (nLeaf[n]) {
        for (let s = nLo[n]; s < nHi[n]; s++) {
          const i = order[s];
          const mi = mass[i];
          m += mi; mx += mi * px[i]; my += mi * py[i]; me += mi * eps2[i];
        }
      } else {
        for (let q = 0; q < 4; q++) {
          const c = nChild[n * 4 + q];
          if (c < 0) continue;
          const mc = nMass[c];
          m += mc; mx += mc * nCx[c]; my += mc * nCy[c]; me += mc * nEps2[c];
        }
      }
      nMass[n] = m;
      if (m > 0) { nCx[n] = mx / m; nCy[n] = my / m; nEps2[n] = me / m; }
      else { nCx[n] = nGx[n]; nCy[n] = nGy[n]; nEps2[n] = EPS2_FLOOR; }

      const ccx = nCx[n], ccy = nCy[n];
      let rad = 0, rmax = 0;
      if (nLeaf[n]) {
        for (let s = nLo[n]; s < nHi[n]; s++) {
          const i = order[s];
          const dx = px[i] - ccx, dy = py[i] - ccy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > rad) rad = d;
          if (radius[i] > rmax) rmax = radius[i];
        }
      } else {
        for (let q = 0; q < 4; q++) {
          const c = nChild[n * 4 + q];
          if (c < 0 || nMass[c] <= 0) continue;
          const dx = nCx[c] - ccx, dy = nCy[c] - ccy;
          const d = Math.sqrt(dx * dx + dy * dy) + nRad[c];
          if (d > rad) rad = d;
          if (nRmax[c] > rmax) rmax = nRmax[c];
        }
      }
      nRad[n] = rad;
      nRmax[n] = rmax;
    }
    treeValid = true;
  }

  /* ====================================================================== *
   * 5.9 Forces
   * ====================================================================== */

  /**
   * Walk the tree once for a whole leaf and build the interaction list that
   * every body in that leaf will share. Amortising the walk over LEAF_MAX
   * bodies is the single largest constant-factor win in the solver.
   *
   * The opening criterion is the textbook multipole acceptance widened to a
   * group. The monopole error from a source node scales as (sourceExtent /
   * distance)^2, so a node is accepted when its extent about its own centre of
   * mass is smaller than theta times the SMALLEST distance any body in the
   * target leaf could have to that centre of mass. Subtracting only the target
   * group's radius is exactly the widening a shared list requires - no more,
   * which matters, because being pessimistic here costs throughput directly.
   *
   * Both lists are hard-capped. On overflow the remaining mass is folded into a
   * single monopole "spill" term rather than growing an array - accuracy
   * degrades smoothly, the loop stays bounded, and the frame is never at risk.
   */
  function buildInteractionList(target) {
    ilLen = 0; dlLen = 0;
    spillM = 0; spillX = 0; spillY = 0;
    const tcx = nCx[target], tcy = nCy[target];
    const trad = nRad[target];
    const trmax = nRmax[target];
    let sp = 0;
    treeStack[sp++] = 0;
    while (sp > 0) {
      const s = treeStack[--sp];
      const m = nMass[s];
      if (m <= 0) continue;
      if (s !== target) {
        const gdx = nCx[s] - tcx, gdy = nCy[s] - tcy;
        const dist = Math.sqrt(gdx * gdx + gdy * gdy);
        const sep = dist - trad;
        // Two guards, and both must pass. The first is accuracy. The second is
        // contact: if any body in the target group could physically be touching
        // any body in the source node, the node is opened so the pair reaches
        // the direct list and the merge pass can see it. Without this, a
        // single nearby body would be accepted as an exact monopole - correct
        // for the force, and silently invisible to collisions.
        if (sep > 0 && nRad[s] < theta * sep &&
            dist - trad - nRad[s] > trmax + nRmax[s]) {
          if (ilLen < IL_CAP) {
            ilCx[ilLen] = nCx[s]; ilCy[ilLen] = nCy[s];
            ilM[ilLen] = m; ilE2[ilLen] = nEps2[s];
            ilLen++;
          } else {
            spillM += m; spillX += m * nCx[s]; spillY += m * nCy[s];
          }
          continue;
        }
      }
      if (nLeaf[s]) {
        if (dlLen < DL_CAP) { dlLo[dlLen] = nLo[s]; dlHi[dlLen] = nHi[s]; dlLen++; }
        else { spillM += m; spillX += m * nCx[s]; spillY += m * nCy[s]; }
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const c = nChild[s * 4 + q];
        if (c < 0 || nMass[c] <= 0) continue;
        if (sp < STACK_CAP) treeStack[sp++] = c;
        else { spillM += nMass[c]; spillX += nMass[c] * nCx[c]; spillY += nMass[c] * nCy[c]; }
      }
    }
    if (spillM > 0) {
      const k = ilLen < IL_CAP ? ilLen++ : IL_CAP - 1;
      ilCx[k] = spillX / spillM; ilCy[k] = spillY / spillM;
      ilM[k] = spillM; ilE2[k] = EPS2_FLOOR;
    }
  }

  /**
   * Apply the current interaction list to every body in a leaf, and record
   * touching pairs for the merge pass. `cellSize` is used to re-derive the
   * body's force tier as a free by-product: the tier is how many steps it takes
   * to cross its own cell, which is exactly the timescale over which the force
   * on it can change meaningfully.
   */
  function applyLeaf(nd) {
    const lo = nLo[nd], hi = nHi[nd];
    const cellSize = nSize[nd];
    let interactions = 0;
    for (let s = lo; s < hi; s++) {
      const i = order[s];
      const xi = px[i], yi = py[i], e2i = eps2[i];
      let sax = 0, say = 0;

      for (let k = 0; k < ilLen; k++) {
        const dx = ilCx[k] - xi, dy = ilCy[k] - yi;
        const d2 = dx * dx + dy * dy + e2i + ilE2[k];
        const inv = 1 / Math.sqrt(d2);
        const f = ilM[k] * inv * inv * inv;
        sax += dx * f; say += dy * f;
      }
      interactions += ilLen;

      const ri = radius[i];
      for (let d = 0; d < dlLen; d++) {
        const a = dlLo[d], b = dlHi[d];
        for (let t = a; t < b; t++) {
          const j = order[t];
          if (j === i) continue;
          const dx = px[j] - xi, dy = py[j] - yi;
          const raw = dx * dx + dy * dy;
          const d2 = raw + e2i + eps2[j];
          const inv = 1 / Math.sqrt(d2);
          const f = mass[j] * inv * inv * inv;
          sax += dx * f; say += dy * f;
          if (raw > 0 || i < j) {
            const rs = ri + radius[j];
            if (raw < rs * rs && mergeLen < MERGE_CAP) {
              mergeA[mergeLen] = i; mergeB[mergeLen] = j; mergeLen++;
            }
          }
        }
        interactions += b - a;
      }

      // Clamp is a net, not a mechanism. With softening in every denominator
      // this cannot trigger; if it ever does, the run survives it.
      const amag2 = sax * sax + say * say;
      if (amag2 > AMAX * AMAX) {
        const sc = AMAX / Math.sqrt(amag2);
        sax *= sc; say *= sc;
      }
      ax[i] = sax; ay[i] = say;
      lastForce[i] = stepCount;

      if (forceTiering) {
        const amag = Math.sqrt(amag2);
        const vmag = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        const tA = amag > 0 ? Math.sqrt(2 * cellSize * 0.25 / amag) : Infinity;
        const tV = vmag > 0 ? (cellSize * 0.25 / vmag) : Infinity;
        const t = tA < tV ? tA : tV;
        let tier = 0;
        if (isFinite(t) && t > DT) tier = clamp(Math.floor(Math.log2(t / DT)) - 1, 0, MAX_FTIER);
        if (flags[i] & FLAG_ALWAYS_ACTIVE) tier = 0;
        ftier[i] = tier;
      } else {
        ftier[i] = 0;
      }
    }
    return interactions;
  }

  /** Exact all-pairs. Used below DIRECT_MAX, where the player is watching. */
  function forcesDirect() {
    for (let i = 0; i < count; i++) { ax[i] = 0; ay[i] = 0; }
    for (let i = 0; i < count; i++) {
      const xi = px[i], yi = py[i], e2i = eps2[i], ri = radius[i];
      let sax = ax[i], say = ay[i];
      for (let j = i + 1; j < count; j++) {
        const dx = px[j] - xi, dy = py[j] - yi;
        const raw = dx * dx + dy * dy;
        const d2 = raw + e2i + eps2[j];
        const inv = 1 / Math.sqrt(d2);
        const inv3 = inv * inv * inv;
        const fj = mass[j] * inv3;
        sax += dx * fj; say += dy * fj;
        const fi = mass[i] * inv3;
        ax[j] -= dx * fi; ay[j] -= dy * fi;
        const rs = ri + radius[j];
        if (raw < rs * rs && mergeLen < MERGE_CAP) {
          mergeA[mergeLen] = i; mergeB[mergeLen] = j; mergeLen++;
        }
      }
      ax[i] = sax; ay[i] = say;
      lastForce[i] = stepCount;
      ftier[i] = 0;
    }
    return (count * (count - 1)) >> 1;
  }

  /**
   * Restore Newton's third law.
   *
   * Exact all-pairs gravity produces equal and opposite forces, so the net
   * force on the system is identically zero and momentum is conserved to the
   * last bit. Neither approximation above it has that property: a Barnes-Hut
   * node does not push back on the body it pulls, and under force tiering two
   * bodies can be using accelerations computed at different times. Both leak
   * momentum, and the leak is not random - it accumulates, and what the player
   * would see is the entire structure they built sliding off the screen.
   *
   * Subtracting the mass-weighted mean acceleration removes exactly that. It is
   * a uniform shift, so every relative motion - every orbit, every collapse,
   * every merger - is untouched, and afterwards the net force is zero by
   * construction. Two O(n) passes with no square roots, against a force loop
   * that is hundreds of times more expensive.
   */
  function cancelNetForce() {
    let sx = 0, sy = 0, mt = 0;
    for (let i = 0; i < count; i++) {
      const m = mass[i];
      sx += m * ax[i]; sy += m * ay[i]; mt += m;
    }
    if (!(mt > 0)) return;
    const cx = sx / mt, cy = sy / mt;
    if (cx === 0 && cy === 0) return;
    for (let i = 0; i < count; i++) { ax[i] -= cx; ay[i] -= cy; }
  }

  function computeForces() {
    mergeLen = 0;
    if (count === 0) return;
    if (count <= DIRECT_MAX) { interactionsLast = forcesDirect(); return; }
    if (!treeValid) buildTree();
    let interactions = 0;
    const staleLimit = 1 << MAX_FTIER;
    for (let li = 0; li < leafCount; li++) {
      const nd = leafList[li];
      const lo = nLo[nd], hi = nHi[nd];
      if (forceTiering) {
        // A leaf runs at the cadence of its most demanding member, and always
        // if anyone in it has gone stale. Phase comes from the leaf's Morton
        // position, so the work is spread across steps AND stays put in space,
        // which keeps frame cost even instead of pulsing.
        let tier = MAX_FTIER;
        let stale = false;
        for (let s = lo; s < hi; s++) {
          const i = order[s];
          const t = ftier[i];
          if (t < tier) tier = t;
          if (stepCount - lastForce[i] >= staleLimit) { stale = true; break; }
        }
        if (!stale && tier > 0) {
          const period = 1 << tier;
          const phase = mix32(codes[order[lo]]) & (period - 1);
          if ((stepCount & (period - 1)) !== phase) continue;
        }
      }
      buildInteractionList(nd);
      interactions += applyLeaf(nd);
    }
    cancelNetForce();
    interactionsLast = interactions;
  }

  /* ====================================================================== *
   * 5.10 Merging
   *
   * A collision is perfectly inelastic. Conserved EXACTLY: mass, linear
   * momentum, total angular momentum, total energy. Nothing is thrown away -
   * the orbital angular momentum of the pair becomes the survivor's spin, and
   * the kinetic energy lost to the collision becomes heat, which is a real
   * quantity the progression layer can spend. Ignition is therefore something
   * the physics produces rather than something the game announces.
   * ====================================================================== */

  function ufFind(x) {
    if (ufStamp[x] !== stepCount) { ufStamp[x] = stepCount; ufParent[x] = x; return x; }
    let r = x;
    while (ufParent[r] !== r) r = ufParent[r];
    while (ufParent[x] !== r) { const nx = ufParent[x]; ufParent[x] = r; x = nx; }
    return r;
  }

  function ufUnion(a, b) {
    const ra = ufFind(a), rb = ufFind(b);
    if (ra === rb) return;
    if (ra < rb) ufParent[rb] = ra; else ufParent[ra] = rb;
  }

  function resolveMerges() {
    if (mergeLen === 0) return;
    for (let k = 0; k < mergeLen; k++) ufUnion(mergeA[k], mergeB[k]);

    // Group by root, in ids rather than slots: slots move during removal, ids
    // do not. Groups and members are both processed in ascending id order so
    // that the floating-point summation order is fixed for a given seed.
    const groups = new Map();
    for (let k = 0; k < mergeLen; k++) {
      for (let t = 0; t < 2; t++) {
        const s = t === 0 ? mergeA[k] : mergeB[k];
        const r = ufFind(s);
        let g = groups.get(r);
        if (!g) { g = []; groups.set(r, g); }
        const id = idOfSlot[s];
        if (g.indexOf(id) < 0) g.push(id);
      }
    }
    const groupList = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => a - b);
      groupList.push(g);
    }
    groupList.sort((a, b) => a[0] - b[0]);

    const doomed = [];
    for (let gi = 0; gi < groupList.length; gi++) {
      const g = groupList[gi];
      let M = 0, cx = 0, cy = 0, mvx = 0, mvy = 0, max = 0, may = 0;
      let survivor = -1, bestM = -1;
      let population = 0, heatSum = 0, spinSum = 0, bindSum = 0, maxKind = 0;
      for (let k = 0; k < g.length; k++) {
        const s = slotOfId[g[k]];
        if (s < 0) continue;
        const m = mass[s];
        M += m; cx += m * px[s]; cy += m * py[s];
        mvx += m * vx[s]; mvy += m * vy[s];
        max += m * ax[s]; may += m * ay[s];
        population += pop[s]; heatSum += heat[s];
        spinSum += spin[s]; bindSum += bind[s];
        if (kind[s] > maxKind) maxKind = kind[s];
        if (m > bestM) { bestM = m; survivor = g[k]; }
      }
      if (M <= 0 || survivor < 0) continue;
      cx /= M; cy /= M;
      const VX = mvx / M, VY = mvy / M;

      // Orbital angular momentum about the new centre of mass, the kinetic
      // energy in the relative motion, and the spread. All collected before
      // anything is overwritten, and all placed back into the survivor.
      let L = spinSum, keInt = 0, r2m = 0;
      for (let k = 0; k < g.length; k++) {
        const s = slotOfId[g[k]];
        if (s < 0) continue;
        const dx = px[s] - cx, dy = py[s] - cy;
        const dvx = vx[s] - VX, dvy = vy[s] - VY;
        L += mass[s] * (dx * dvy - dy * dvx);
        keInt += 0.5 * mass[s] * (dvx * dvx + dvy * dvy);
        r2m += mass[s] * (dx * dx + dy * dy);
      }

      // The pair's mutual potential energy, which is about to stop being
      // representable as a distance between two tracked bodies. Exact for the
      // small groups that make up almost every merge; estimated above 32
      // members so a pile-up cannot turn one step quadratic.
      let pePair = 0;
      if (g.length <= 32) {
        for (let a = 0; a < g.length; a++) {
          const sa = slotOfId[g[a]];
          if (sa < 0) continue;
          for (let b = a + 1; b < g.length; b++) {
            const sb = slotOfId[g[b]];
            if (sb < 0) continue;
            const dx = px[sb] - px[sa], dy = py[sb] - py[sa];
            const d = Math.sqrt(dx * dx + dy * dy + eps2[sa] + eps2[sb]);
            pePair -= mass[sa] * mass[sb] / d;
          }
        }
      } else {
        pePair = plummerPE(M, Math.sqrt(Math.max(r2m / M, 0)) * 0.766);
      }

      const ss = slotOfId[survivor];
      const wasAgg = (flags[ss] & FLAG_AGGREGATE) !== 0;
      mass[ss] = M;
      px[ss] = cx; py[ss] = cy;
      vx[ss] = VX; vy[ss] = VY;
      // The merged body carries the group's mass-weighted acceleration, not
      // the heaviest member's. Inheriting one member's value changes the net
      // force on the whole system at the moment of every merge, and the next
      // half-kick then spends that difference as momentum the system never had.
      ax[ss] = max / M; ay[ss] = may / M;
      pop[ss] = population;
      spin[ss] = L;
      if (!wasAgg && kind[ss] < maxKind && maxKind < AGG_FIRST) kind[ss] = maxKind;
      flags[ss] |= FLAG_ALWAYS_ACTIVE;

      if (wasAgg) {
        // Absorbing loose bodies into an aggregate: the census gains them and
        // the dispersion absorbs the relative motion, so the cluster stays a
        // faithful statistical stand-in for what it now contains.
        for (let k = 0; k < g.length; k++) {
          const s = slotOfId[g[k]];
          if (s < 0 || s === ss) continue;
          if (flags[s] & FLAG_AGGREGATE) {
            for (let q = 0; q < KIND_COUNT; q++) {
              aggCensus[ss * KIND_COUNT + q] += aggCensus[s * KIND_COUNT + q];
            }
            aggN[ss] += aggN[s];
          } else {
            aggCensus[ss * KIND_COUNT + kind[s]] += pop[s];
            aggN[ss] += pop[s];
          }
        }
        aggSigma[ss] = Math.sqrt(Math.max(2 * keInt / M, aggSigma[ss] * aggSigma[ss]));
        setAggKind(ss);
      }

      refreshDerived(ss);
      applyLadder(ss);

      // Close the energy books. The members' own internal binding and their
      // mutual potential both leave the tracked sum; the merged body's binding
      // enters it. Whatever is left over is released as heat, which is the
      // physical statement that compaction is what makes accretion hot - and
      // it is the same number that decides whether something ignites.
      const bindBefore = bindSum + pePair;
      const bindAfter = wasAgg ? bindBefore : selfBind(M, radius[ss]);
      const released = keInt + (bindBefore - bindAfter);
      let h = heatSum + released * HEAT_RETAIN;
      heatRadiated += released * (1 - HEAT_RETAIN);
      bind[ss] = bindAfter;
      // Heat can never go negative. A merge is net-absorbing wherever the
      // radius law is linear in mass - a black hole gains no binding by growing
      // - and in that case the shortfall stays on the binding ledger instead,
      // so the books still balance exactly.
      if (h < 0) { bind[ss] += h; h = 0; }
      heat[ss] = h;

      pushEvent({
        type: EVENT.MERGE, id: survivor, absorbed: g.length - 1,
        mass: magFromCode(M, expMass), kind: kind[ss], step: stepCount,
      });

      for (let k = 0; k < g.length; k++) if (g[k] !== survivor) doomed.push(g[k]);
    }
    for (let k = 0; k < doomed.length; k++) removeById(doomed[k]);
    mergeLen = 0;
  }

  /* ====================================================================== *
   * 5.11 Aggregates
   * ====================================================================== */

  function setAggKind(i) {
    const n = aggN[i];
    let k = KIND.CLUSTER;
    for (let t = 0; t < AGG_TIERS.length; t++) if (n >= AGG_TIERS[t].minPop) k = AGG_TIERS[t].kind;
    kind[i] = k;
  }

  /** Screen extent, in pixels, of a world-space radius. */
  function pxOf(worldSize) {
    return viewSet ? worldSize * viewPxPerUnit : worldSize / rootSize * 512;
  }

  /**
   * Is this region comfortably outside what the player can see?
   *
   * The other half of the perceptual test. Sub-pixel groups are safe to condense
   * because the pixels do not change; groups nobody is looking at are safe for
   * the more obvious reason. This matters most in exactly the case that is
   * otherwise hardest - zoomed deep into one galaxy, where nothing on screen is
   * sub-pixel and the budget has to come from somewhere. Without it the only
   * way to free capacity is the last-resort path, which IS visible.
   */
  function offScreen(cx, cy, halfSize) {
    if (!viewSet) return false;
    const hw = (viewW * 0.5 / viewPxPerUnit) * VIEW_MARGIN;
    const hh = (viewH * 0.5 / viewPxPerUnit) * VIEW_MARGIN;
    return Math.abs(cx - viewCx) - halfSize > hw ||
           Math.abs(cy - viewCy) - halfSize > hh;
  }

  /**
   * Collapse the bodies in a tree node into one aggregate.
   *
   * Everything the cluster was is retained as a statistic: total mass, the
   * centre-of-mass state, the mass-weighted radius, the velocity dispersion
   * (which IS the internal kinetic energy, so energy is conserved rather than
   * discarded), the net angular momentum (as spin), the heat, the population,
   * and a per-kind census so that "how many stars do you have" is still
   * answerable at 1e11 stars.
   */
  function condenseGroup(ids) {
    const n = ids.length;
    if (n < AGG_MIN_MEMBERS) return false;

    let M = 0, cx = 0, cy = 0, mvx = 0, mvy = 0, max = 0, may = 0;
    for (let k = 0; k < n; k++) {
      const i = slotOfId[ids[k]];
      if (i < 0) continue;
      const m = mass[i];
      M += m; cx += m * px[i]; cy += m * py[i];
      mvx += m * vx[i]; mvy += m * vy[i];
      max += m * ax[i]; may += m * ay[i];
    }
    if (!(M > 0)) return false;
    cx /= M; cy /= M;
    const VX = mvx / M, VY = mvy / M;

    let r2m = 0, sig2 = 0, L = 0, heatSum = 0, bindSum = 0, population = 0;
    const census = new Float64Array(KIND_COUNT);
    for (let k = 0; k < n; k++) {
      const i = slotOfId[ids[k]];
      if (i < 0) continue;
      const m = mass[i];
      const dx = px[i] - cx, dy = py[i] - cy;
      const dvx = vx[i] - VX, dvy = vy[i] - VY;
      r2m += m * (dx * dx + dy * dy);
      sig2 += m * (dvx * dvx + dvy * dvy);
      L += m * (dx * dvy - dy * dvx) + spin[i];
      heatSum += heat[i];
      bindSum += bind[i];
      const p = pop[i];
      population += (flags[i] & FLAG_AGGREGATE) ? aggN[i] : p;
      if (flags[i] & FLAG_AGGREGATE) {
        for (let q = 0; q < KIND_COUNT; q++) census[q] += aggCensus[i * KIND_COUNT + q];
      } else {
        census[kind[i]] += p;
      }
    }
    const rms = Math.sqrt(Math.max(r2m / M, 0));
    const sigma = Math.sqrt(Math.max(sig2 / M, 0));

    // Reuse the most massive member's slot so its id survives the transition.
    let ss = -1, bestM = -1;
    for (let k = 0; k < n; k++) {
      const i = slotOfId[ids[k]];
      if (i >= 0 && mass[i] > bestM) { bestM = mass[i]; ss = i; }
    }
    if (ss < 0) return false;
    const survivorId = idOfSlot[ss];

    mass[ss] = M;
    px[ss] = cx; py[ss] = cy; vx[ss] = VX; vy[ss] = VY;
    ax[ss] = max / M; ay[ss] = may / M;
    spin[ss] = L;
    heat[ss] = heatSum;
    pop[ss] = population;
    aggN[ss] = population;
    // Plummer relation: the half-mass radius of a Plummer sphere is about
    // 0.766 of its root-mean-square radius.
    aggR[ss] = Math.max(rms * 0.766, RADIUS_FLOOR);
    // The members' mutual potential stops being expressible as distances
    // between tracked bodies, so it moves onto the binding ledger. Estimated
    // from the group's own measured extent rather than assumed - condensed
    // groups can run to hundreds of members and an exact pairwise sum here
    // would put a quadratic term inside the frame budget.
    bind[ss] = bindSum + plummerPE(M, aggR[ss]);
    aggSigma[ss] = sigma;
    aggPhase[ss] = 0;
    aggBorn[ss] = stepCount;
    aggSeed[ss] = hash2(survivorId, 0x51ed270b ^ stepCount);
    aggCensus.set(census, ss * KIND_COUNT);
    flags[ss] = (flags[ss] | FLAG_AGGREGATE | FLAG_ALWAYS_ACTIVE) & ~FLAG_NO_CONDENSE;
    setAggKind(ss);
    refreshDerived(ss);

    for (let k = 0; k < n; k++) {
      if (ids[k] !== survivorId) removeById(ids[k]);
    }

    pushEvent({
      type: EVENT.CONDENSE, id: survivorId, members: n,
      population: mag(population), kind: kind[ss], step: stepCount,
    });
    return true;
  }

  /**
   * Find groups that are safe to condense and condense them.
   *
   * "Safe" is a perceptual test, not a numeric one: the group must project to
   * fewer than a few pixels at the current viewport scale, so the pixels the
   * members would have painted and the pixels the aggregate paints are the same
   * pixels. That is what makes the representation change invisible.
   *
   * The walk accepts the highest qualifying node and does not recurse into it,
   * so groups come out as large as they can legitimately be.
   */
  function condensePass(needed) {
    if (!treeValid || count === 0) return 0;
    const limit = CONDENSE_PX * condensePressure;

    // Collect the groups as lists of IDS, not as tree ranges. A single removal
    // invalidates every range in the tree, so working from ranges would allow
    // one condensation per step. Ids survive the swap-remove, which is what
    // makes it safe to do a whole batch in one pass - and being able to shed
    // several groups in a step is what lets the governor actually keep up when
    // the body count is climbing fast.
    const targets = [];
    let queued = 0;
    let sp = 0;
    treeStack[sp++] = 0;
    while (sp > 0 && targets.length < CONDENSE_PER_STEP && queued < needed) {
      const nd = treeStack[--sp];
      const n = nHi[nd] - nLo[nd];
      if (n < AGG_MIN_MEMBERS) continue;
      if (pxOf(nSize[nd]) < limit || offScreen(nGx[nd], nGy[nd], nSize[nd] * 0.5)) {
        let ok = true;
        for (let s = nLo[nd]; s < nHi[nd]; s++) {
          const i = order[s];
          if ((flags[i] & FLAG_NO_CONDENSE) || protectUntil[i] > stepCount) { ok = false; break; }
        }
        if (ok) {
          const ids = new Array(n);
          for (let s = nLo[nd]; s < nHi[nd]; s++) ids[s - nLo[nd]] = idOfSlot[order[s]];
          targets.push(ids);
          queued += n - 1;
          continue;
        }
      }
      if (nLeaf[nd]) continue;
      for (let q = 0; q < 4; q++) {
        const c = nChild[nd * 4 + q];
        if (c >= 0 && sp < STACK_CAP) treeStack[sp++] = c;
      }
    }

    let made = 0;
    for (let t = 0; t < targets.length; t++) if (condenseGroup(targets[t])) made++;
    if (made > 0) {
      treeValid = false;
      condensePressure = Math.max(1, condensePressure * 0.75);
    } else if (needed > 0) {
      // Nothing was sub-pixel and the budget still demands room. Relax the
      // perceptual test until something qualifies. This is the only path that
      // is ever visible to the player, and it exists so that the alternative -
      // a dropped frame - stays unreachable.
      condensePressure = Math.min(condensePressure * 2, 1 << 20);
    }
    return made;
  }

  /**
   * Expand an aggregate back into macro particles.
   *
   * Sampling is driven entirely by the aggregate's stored seed and statistics,
   * so the same aggregate always produces the same cloud - hydration is
   * reversible and the player can zoom in and out without the sky rearranging
   * itself. Each particle carries population weight n/K, so a galaxy of 1e11
   * stars becomes 512 points that each stand for 2e8 stars. That is how real
   * N-body cosmology works and it is the mechanism that makes an unbounded
   * represented population possible.
   */
  function hydrate(i) {
    const M = mass[i];
    const N = aggN[i];
    const rScale = aggR[i];
    const sigma = aggSigma[i];
    const L = spin[i];
    const cx = px[i], cy = py[i], VX = vx[i], VY = vy[i];
    const AX = ax[i], AY = ay[i];
    const seed = aggSeed[i];
    const totalHeat = heat[i];
    const totalBind = bind[i];
    const id = idOfSlot[i];

    // Expand into as many particles as there is room for, rather than refusing
    // when the ideal count will not fit. A partial expansion is still a better
    // picture than a dot, and it means the level of detail always uses whatever
    // budget the governor has left rather than deadlocking against it.
    const room = Math.floor(softCap * HYDRATE_HEADROOM) - (count - 1);
    const K = Math.min(AGG_HYDRATE_MAX, Math.floor(N), room);
    if (K < AGG_MIN_MEMBERS) return false;

    const census = aggCensus.slice(i * KIND_COUNT, i * KIND_COUNT + KIND_COUNT);
    let censusTotal = 0;
    for (let q = 0; q < KIND_COUNT; q++) censusTotal += census[q];

    removeById(id);
    ensureCapacity(count + K);

    const base = count;
    const mEach = M / K;
    const popEach = N / K;
    const heatEach = totalHeat / K;
    // The macro particles' mutual potential becomes trackable again, so it
    // comes back off the binding ledger - the exact reverse of what
    // condensation put on it, using the same estimate, so that a zoom in and
    // back out does not leak energy.
    const bindEach = (totalBind - plummerPE(M, rScale)) / K;
    const spinDir = L >= 0 ? 1 : -1;

    // Kinds are handed out by walking the census in a fixed order, so the mix
    // of a hydrated cluster reflects what was actually condensed into it.
    let censusCursor = 0;
    let censusAcc = 0;

    for (let k = 0; k < K; k++) {
      const s = base + k;
      const h = hash2(seed, k);
      // Plummer radial sampling, clipped so nothing is placed absurdly far out.
      let u = unit(h);
      if (u > 0.995) u = 0.995;
      const r = Math.min(rScale * Math.sqrt(u / (1 - u)), rScale * 8);
      const th = unit(hash2(seed ^ 0x2545f491, k)) * 6.283185307179586;
      const dx = r * Math.cos(th), dy = r * Math.sin(th);

      // Circular support from the enclosed Plummer mass, plus dispersion.
      const menc = M * (r * r) / (r * r + rScale * rScale);
      const vc = r > 0 ? Math.sqrt(menc / Math.max(r, RADIUS_FLOOR)) : 0;
      const [g1, g2] = gauss2(seed ^ 0x9e3779b9, k);
      const rr = Math.max(r, RADIUS_FLOOR);
      const dvx = -dy / rr * vc * spinDir + g1 * sigma * 0.5;
      const dvy = dx / rr * vc * spinDir + g2 * sigma * 0.5;

      px[s] = cx + dx; py[s] = cy + dy;
      vx[s] = VX + dvx; vy[s] = VY + dvy;
      // Start from the aggregate's own acceleration rather than zero, for the
      // same reason: a body set whose net force jumps is a body set whose
      // momentum jumps on the very next half-kick.
      ax[s] = AX; ay[s] = AY;
      mass[s] = mEach;
      pop[s] = popEach;
      heat[s] = heatEach;
      bind[s] = bindEach;
      spin[s] = 0;
      flags[s] = FLAG_NONE;
      ftier[s] = 0;
      lastForce[s] = stepCount - (1 << MAX_FTIER);
      protectUntil[s] = 0;
      aggN[s] = 0; aggR[s] = 0; aggSigma[s] = 0; aggPhase[s] = 0;

      // Assign a kind from the census.
      let kk = KIND.DUST;
      if (censusTotal > 0) {
        const want = (k + 0.5) / K * censusTotal;
        while (censusCursor < KIND_COUNT - 1 && censusAcc + census[censusCursor] < want) {
          censusAcc += census[censusCursor];
          censusCursor++;
        }
        kk = censusCursor;
      }
      kind[s] = kk < AGG_FIRST ? kk : KIND.DUST;

      const nid = allocId();
      idOfSlot[s] = nid;
      slotOfId[nid] = s;
      count++;
      refreshDerived(s);
    }

    // Exact restoration of the conserved quantities. Sampling scatter is
    // corrected out rather than tolerated, so hydrate-condense round trips do
    // not leak momentum into the system over a long run.
    let sx = 0, sy = 0, svx = 0, svy = 0, sm = 0;
    for (let k = 0; k < K; k++) {
      const s = base + k;
      sm += mass[s];
      sx += mass[s] * px[s]; sy += mass[s] * py[s];
      svx += mass[s] * vx[s]; svy += mass[s] * vy[s];
    }
    const dcx = sx / sm - cx, dcy = sy / sm - cy;
    const dvxT = svx / sm - VX, dvyT = svy / sm - VY;
    for (let k = 0; k < K; k++) {
      const s = base + k;
      px[s] -= dcx; py[s] -= dcy;
      vx[s] -= dvxT; vy[s] -= dvyT;
    }

    treeValid = false;
    pushEvent({
      type: EVENT.HYDRATE, id, particles: K,
      population: mag(N), step: stepCount,
    });
    return true;
  }

  /**
   * The other half of the level of detail: expand the aggregate that is
   * currently the largest thing on screen.
   *
   * Picking the largest rather than the first found is what makes the whole
   * scheme settle instead of thrash. Condensation always takes the SMALLEST
   * projected groups and expansion always takes the LARGEST, so the two never
   * fight over the same object, and the cooldown stops anything oscillating
   * while the viewport is moving.
   */
  function hydratePass() {
    if (count === 0) return 0;
    if (count > softCap * CONDENSE_TARGET) return 0;
    let best = -1, bestPx = HYDRATE_PX;
    for (let i = 0; i < count; i++) {
      if (!(flags[i] & FLAG_AGGREGATE)) continue;
      if (stepCount - aggBorn[i] < AGG_COOLDOWN) continue;
      if (offScreen(px[i], py[i], aggR[i])) continue;
      const p = pxOf(aggR[i]);
      if (p > bestPx) { bestPx = p; best = i; }
    }
    if (best < 0) return 0;
    return hydrate(best) ? 1 : 0;
  }

  /* ====================================================================== *
   * 5.12 Integration, audit and governor
   * ====================================================================== */

  function kick(h) {
    for (let i = 0; i < count; i++) {
      let nvx = vx[i] + h * ax[i];
      let nvy = vy[i] + h * ay[i];
      const v2 = nvx * nvx + nvy * nvy;
      if (v2 > VMAX * VMAX) { const sc = VMAX / Math.sqrt(v2); nvx *= sc; nvy *= sc; }
      vx[i] = nvx; vy[i] = nvy;
    }
  }

  function drift(h) {
    for (let i = 0; i < count; i++) {
      px[i] += h * vx[i];
      py[i] += h * vy[i];
    }
    // Aggregates visibly rotate at their own internal rate, which is derived
    // from the angular momentum they inherited. Free, and it is the difference
    // between a smudge and a galaxy.
    for (let i = 0; i < count; i++) {
      if (!(flags[i] & FLAG_AGGREGATE)) continue;
      const r = Math.max(aggR[i], RADIUS_FLOOR);
      const I = Math.max(mass[i] * r * r * 0.5, MASS_FLOOR);
      aggPhase[i] += (spin[i] / I) * h;
    }
  }

  /**
   * Rolling finiteness audit. O(1) amortised: a fixed slice of the pool each
   * step. The force kernel cannot produce a non-finite value - every
   * denominator carries a positive softening term - so this is a net under a
   * floor that does not have holes in it. If it ever fires, the body is removed
   * and its mass is booked to `lostMass` so the failure shows up in stats
   * rather than silently corrupting a run.
   */
  function audit() {
    if (count === 0) return;
    const n = Math.min(AUDIT_SLICE, count);
    for (let k = 0; k < n; k++) {
      if (auditCursor >= count) auditCursor = 0;
      const i = auditCursor++;
      const ok = isFinite(px[i]) && isFinite(py[i]) && isFinite(vx[i]) && isFinite(vy[i]) &&
        isFinite(ax[i]) && isFinite(ay[i]) && isFinite(mass[i]) && mass[i] > 0 &&
        isFinite(radius[i]) && eps2[i] > 0;
      if (!ok) {
        lostMass += isFinite(mass[i]) ? mass[i] : 0;
        quarantined++;
        pushEvent({ type: EVENT.QUARANTINE, id: idOfSlot[i], step: stepCount });
        removeById(idOfSlot[i]);
        auditCursor = 0;
        return;
      }
    }
  }

  /**
   * Move the tracked-body ceiling against the measured cost of a step. The body
   * count is a dependent variable of the frame budget: when steps get
   * expensive, the ceiling falls, condensation fires, and the population turns
   * into aggregates. Frames are never the thing that gives.
   */
  function governor(ms) {
    ewmaMs = ewmaMs === 0 ? ms : ewmaMs * 0.9 + ms * 0.1;
    if (softCapPinned) return;
    // Fast attack, slow decay. A smoothed average is the right signal for
    // deciding there is headroom, because letting the body count creep up on a
    // brief lull would just cause it to be taken away again. It is the wrong
    // signal for deciding there is not: by the time an average has noticed, the
    // budget has already been overrun ten times. So a single step that blows
    // well past the budget cuts the ceiling immediately, without waiting.
    if (ms > budgetMs * 1.5) {
      softCap = Math.max(256, Math.floor(Math.min(softCap, count) * 0.85));
    } else if (ewmaMs > budgetMs * 1.05) {
      softCap = Math.max(256, Math.floor(softCap * 0.94));
    } else if (ewmaMs < budgetMs * 0.5 && count > softCap * 0.9) {
      // Climb gently. Compounding a few percent per step reaches the ceiling in
      // well under a second either way, and the slower rate is what stops the
      // ceiling sailing past the budget and having to be hauled back.
      softCap = Math.min(hardCap, Math.floor(softCap * 1.01) + 1);
    }
  }

  /**
   * Re-sort the pool into Morton order, so that bodies that are neighbours in
   * space are neighbours in memory. Purely a cache-locality measure - it
   * changes no physics - but the direct-summation inner loop reads bodies
   * through an indirection, and making that indirection nearly the identity is
   * worth real time at large counts.
   *
   * Every buffer it uses is preallocated. Allocating scratch here would hand
   * the garbage collector several hundred kilobytes on a fixed cadence, and a
   * collection landing inside a frame is exactly the kind of stall the whole
   * budget discipline exists to prevent.
   */
  function reorderPool() {
    if (count < DIRECT_MAX * 4 || !treeValid) return;
    const permF = (arr) => {
      for (let s = 0; s < count; s++) permScratch[s] = arr[order[s]];
      arr.set(permScratch.subarray(0, count));
    };
    permF(px); permF(py); permF(vx); permF(vy); permF(ax); permF(ay);
    permF(mass); permF(radius); permF(eps2);
    permF(heat); permF(bind); permF(spin); permF(pop);
    permF(aggN); permF(aggR); permF(aggSigma); permF(aggPhase);
    const permU8 = (arr) => {
      for (let s = 0; s < count; s++) permU8Scratch[s] = arr[order[s]];
      arr.set(permU8Scratch.subarray(0, count));
    };
    permU8(kind); permU8(flags); permU8(ftier);
    const permI32 = (arr) => {
      for (let s = 0; s < count; s++) permI32Scratch[s] = arr[order[s]];
      arr.set(permI32Scratch.subarray(0, count));
    };
    permI32(lastForce); permI32(protectUntil); permI32(aggBorn);
    for (let s = 0; s < count; s++) permU32Scratch[s] = aggSeed[order[s]];
    aggSeed.set(permU32Scratch.subarray(0, count));

    // The per-kind census is 16 lanes wide and is dead weight for every body
    // that is not an aggregate, which is nearly all of them. Permute it one
    // lane at a time through the scratch buffer already on hand, and skip the
    // whole thing while no aggregate exists - which is the entire early game.
    let anyAgg = false;
    for (let s = 0; s < count; s++) if (flags[s] & FLAG_AGGREGATE) { anyAgg = true; break; }
    if (anyAgg) {
      for (let q = 0; q < KIND_COUNT; q++) {
        for (let s = 0; s < count; s++) permScratch[s] = aggCensus[order[s] * KIND_COUNT + q];
        for (let s = 0; s < count; s++) aggCensus[s * KIND_COUNT + q] = permScratch[s];
      }
    }

    permI32(idOfSlot);
    for (let s = 0; s < count; s++) slotOfId[idOfSlot[s]] = s;
    treeValid = false;
  }

  /** One fixed-timestep kick-drift-kick step. */
  function fixedStep() {
    kick(DT * 0.5);
    drift(DT);
    treeValid = false;
    computeForces();
    kick(DT * 0.5);

    resolveMerges();

    // Level of detail, as a Schmitt trigger. Crossing the ceiling starts
    // condensing and it keeps going until the count is down to CONDENSE_TARGET,
    // well below the ceiling. That gap is not slack, it is the room expansion
    // needs: without it the population parks exactly at the cap and detail can
    // never come back when the player zooms in.
    const target = Math.floor(softCap * CONDENSE_TARGET);
    if (count > softCap || count > hardCap * 0.95) condensing = true;
    else if (count <= target) condensing = false;

    if (condensing) {
      if (!treeValid) buildTree();
      condensePass(Math.max(count - target, 1));
    } else if (count <= target) {
      hydratePass();
    }

    audit();
    stepCount++;
    codeTime += DT;

    if ((stepCount & 63) === 0) { maybeRebase(); updateEpoch(); }
    if (stepCount % REORDER_PERIOD === 0) {
      if (!treeValid) buildTree();
      reorderPool();
    }
  }

  /* ====================================================================== *
   * 5.13 Public API
   * ====================================================================== */

  /**
   * Add one body.
   *
   * @param {object} b
   * @param {number} b.x            Position, code units.
   * @param {number} b.y
   * @param {number} [b.vx=0]       Velocity, code units per code time.
   * @param {number} [b.vy=0]
   * @param {number} [b.mass=1]     Mass, code units. One dot is 1.
   * @param {number} [b.kind]       Defaults to whatever the mass earns.
   * @param {number} [b.pop=1]      How many objects this body stands for.
   * @param {number} [b.heat=0]
   * @param {number} [b.spin=0]
   * @param {boolean} [b.protect=true] Shield it from condensation for a while,
   *                                   so a click is never swallowed.
   * @returns {number} the new body's stable id.
   */
  function addBody(b) {
    ensureCapacity(count + 1);
    const s = count;
    px[s] = b.x || 0; py[s] = b.y || 0;
    vx[s] = b.vx || 0; vy[s] = b.vy || 0;
    ax[s] = 0; ay[s] = 0;
    mass[s] = Math.max(b.mass === undefined ? 1 : b.mass, MASS_FLOOR);
    pop[s] = b.pop === undefined ? 1 : b.pop;
    heat[s] = b.heat || 0;
    spin[s] = b.spin || 0;
    bind[s] = 0;
    kind[s] = b.kind === undefined ? KIND.DUST : b.kind;
    flags[s] = FLAG_NONE;
    ftier[s] = 0;
    lastForce[s] = stepCount - (1 << MAX_FTIER);
    protectUntil[s] = (b.protect === false) ? 0 : stepCount + PROTECT_STEPS;
    aggN[s] = 0; aggR[s] = 0; aggSigma[s] = 0; aggPhase[s] = 0;
    aggBorn[s] = stepCount; aggSeed[s] = 0;
    aggCensus.fill(0, s * KIND_COUNT, s * KIND_COUNT + KIND_COUNT);
    const id = allocId();
    idOfSlot[s] = id;
    slotOfId[id] = s;
    count++;
    refreshDerived(s);
    if (b.kind === undefined) applyLadder(s);
    bind[s] = selfBind(mass[s], radius[s]);
    treeValid = false;
    return id;
  }

  /**
   * Add a deterministic cloud of bodies. The progression layer needs bulk spawn
   * and must not reach for its own randomness to get it, or determinism dies.
   *
   * @param {object} o
   * @param {number} o.n            How many.
   * @param {number} [o.x=0]        Centre.
   * @param {number} [o.y=0]
   * @param {number} [o.radius=100] Scale radius.
   * @param {number} [o.mass=1]     Mass each.
   * @param {number} [o.spin=0]     Fraction of circular support, signed.
   * @param {number} [o.sigma=0]    Velocity dispersion.
   * @param {number} [o.kind]
   * @param {number} [o.seed]       Defaults to drawing from the run's stream.
   * @returns {number[]} the new ids.
   */
  function addCloud(o) {
    const n = Math.max(0, o.n | 0);
    const cx = o.x || 0, cy = o.y || 0;
    const R = o.radius === undefined ? 100 : o.radius;
    const m = o.mass === undefined ? 1 : o.mass;
    const sp = o.spin || 0;
    const sg = o.sigma || 0;
    const seed = o.seed === undefined ? (rng() * 4294967296) >>> 0 : (o.seed >>> 0);
    const M = m * n;
    const ids = [];
    ensureCapacity(count + n);
    for (let k = 0; k < n; k++) {
      let u = unit(hash2(seed, k));
      if (u > 0.99) u = 0.99;
      const r = Math.min(R * Math.sqrt(u / (1 - u)), R * 6);
      const th = unit(hash2(seed ^ 0x7f4a7c15, k)) * 6.283185307179586;
      const dx = r * Math.cos(th), dy = r * Math.sin(th);
      const menc = M * (r * r) / (r * r + R * R);
      const vc = r > 1e-12 ? Math.sqrt(menc / r) * sp : 0;
      const [g1, g2] = gauss2(seed ^ 0x1b56c4e9, k);
      const rr = Math.max(r, 1e-12);
      ids.push(addBody({
        x: cx + dx, y: cy + dy,
        vx: (o.vx || 0) - dy / rr * vc + g1 * sg,
        vy: (o.vy || 0) + dx / rr * vc + g2 * sg,
        mass: m, kind: o.kind, protect: false,
      }));
    }
    return ids;
  }

  /**
   * Advance the simulation.
   *
   * Real elapsed seconds in, fixed physics steps out. The accumulator runs at
   * most MAX_SUBSTEPS times; anything left over is discarded into `timeDebt`
   * and reported. That is the guarantee that a slow machine loses simulation
   * time and never loses the frame - no spiral of death is reachable from here.
   *
   * @param {number} realDtSeconds
   * @returns {number} fixed steps executed.
   */
  function step(realDtSeconds) {
    const t0 = nowMs();
    let dt = realDtSeconds;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    accumulator += dt * 60 * DT;   // 60 fixed steps per real second at rate 1
    let steps = 0;
    while (accumulator >= DT && steps < MAX_SUBSTEPS) {
      accumulator -= DT;
      fixedStep();
      steps++;
      // Catching up is optional; the frame is not. The moment the budget is
      // spent, stop - whatever is left becomes reported time debt.
      if (nowMs() - t0 >= budgetMs) break;
    }
    if (accumulator >= DT) {
      timeDebt += accumulator;
      accumulator = 0;
    }
    lastStepMs = nowMs() - t0;
    if (steps > 0) governor(lastStepMs / steps);
    renderView.count = count;
    return steps;
  }

  /** Run exactly n fixed steps, ignoring the wall clock. For tests and saves. */
  function stepExact(n) {
    for (let k = 0; k < n; k++) fixedStep();
    renderView.count = count;
  }

  /**
   * Viewport, in world coordinates. Purely state - the simulation never draws.
   * It is used for one thing: deciding what is currently sub-pixel and
   * therefore safe to turn into an aggregate without the player seeing it.
   */
  function setView(v) {
    viewSet = true;
    viewCx = v.cx || 0; viewCy = v.cy || 0;
    viewPxPerUnit = v.pxPerUnit > 0 ? v.pxPerUnit : 1;
    viewW = v.w || viewW; viewH = v.h || viewH;
  }

  /**
   * Typed-array views of the live pool for the renderer. The SAME object is
   * returned every call and its arrays are the live buffers - never copies, so
   * this allocates nothing per frame. Valid until the next step(). Read only.
   * Iterate 0 .. view.count.
   */
  function getRenderView() {
    renderView.count = count;
    return renderView;
  }

  /**
   * Deterministic point cloud for drawing one aggregate as an extended object
   * rather than a dot. Same aggregate, same points, every frame and every
   * session. Writes interleaved x,y pairs.
   *
   * @param {number} id
   * @param {Float32Array|Float64Array} out  Length >= 2 * maxPoints.
   * @param {number} maxPoints
   * @returns {number} points written.
   */
  function sampleAggregate(id, out, maxPoints) {
    const i = slotOfId[id];
    if (i < 0 || !(flags[i] & FLAG_AGGREGATE)) return 0;
    const n = Math.min(maxPoints, out.length >> 1);
    const seed = aggSeed[i];
    const R = aggR[i];
    const ph = aggPhase[i];
    const cs = Math.cos(ph), sn = Math.sin(ph);
    const cx = px[i], cy = py[i];
    for (let k = 0; k < n; k++) {
      let u = unit(hash2(seed, k));
      if (u > 0.99) u = 0.99;
      const r = Math.min(R * Math.sqrt(u / (1 - u)), R * 5);
      const th = unit(hash2(seed ^ 0x2545f491, k)) * 6.283185307179586;
      const dx = r * Math.cos(th), dy = r * Math.sin(th);
      out[k * 2] = cx + dx * cs - dy * sn;
      out[k * 2 + 1] = cy + dx * sn + dy * cs;
    }
    return n;
  }

  /** Read one body. Allocates a plain object; not for per-frame use. */
  function getBody(id) {
    const i = slotOfId[id];
    if (i < 0) return null;
    return {
      id, x: px[i], y: py[i], vx: vx[i], vy: vy[i],
      mass: mass[i], massAbs: magFromCode(mass[i], expMass),
      radius: radius[i], kind: kind[i], kindName: KIND_NAME[kind[i]],
      heat: heat[i], spin: spin[i], pop: pop[i],
      isAggregate: (flags[i] & FLAG_AGGREGATE) !== 0,
      population: (flags[i] & FLAG_AGGREGATE) ? aggN[i] : pop[i],
      aggRadius: aggR[i], aggSigma: aggSigma[i],
      census: (flags[i] & FLAG_AGGREGATE)
        ? Array.from(aggCensus.subarray(i * KIND_COUNT, i * KIND_COUNT + KIND_COUNT))
        : null,
    };
  }

  /** Set a kind directly. The progression layer drives the side branches
   *  (white dwarf, neutron star) that the mass ladder does not. */
  function setKind(id, k) {
    const i = slotOfId[id];
    if (i < 0) return false;
    const from = kind[i];
    kind[i] = k;
    refreshDerived(i);
    if (k !== from) pushEvent({ type: EVENT.KIND_CHANGE, id, from, kind: k, step: stepCount });
    return true;
  }

  /**
   * Gate or ungate a kind. Nothing promotes into a locked kind.
   *
   * Unlocking re-evaluates the whole pool, because the mass that was going to
   * earn the promotion has usually been sitting there for a while already. The
   * moment research completes is the moment the player wants to see the world
   * change, not the next time two of those bodies happen to touch.
   */
  function setKindUnlocked(k, on) {
    const was = unlocked[k];
    unlocked[k] = on ? 1 : 0;
    if (on && !was) for (let i = 0; i < count; i++) applyLadder(i);
  }
  function isKindUnlocked(k) { return unlocked[k] === 1; }

  /** Add momentum to a body. The one hook a "push the field" mechanic needs. */
  function applyImpulse(id, ix, iy) {
    const i = slotOfId[id];
    if (i < 0) return false;
    vx[i] += ix / Math.max(mass[i], MASS_FLOOR);
    vy[i] += iy / Math.max(mass[i], MASS_FLOOR);
    return true;
  }

  /** Nearest body to a point within a world-space radius, or -1. */
  function pick(x, y, r) {
    let best = -1, bestD = r * r;
    for (let i = 0; i < count; i++) {
      const dx = px[i] - x, dy = py[i] - y;
      const rr = Math.max(radius[i], 0);
      const d = dx * dx + dy * dy;
      const reach = (r + rr) * (r + rr);
      if (d < reach && d < bestD + rr * rr) { bestD = d; best = i; }
    }
    return best < 0 ? -1 : idOfSlot[best];
  }

  /** Ids whose position falls inside an axis-aligned rectangle. */
  function queryRect(x0, y0, x1, y1, out, max) {
    let n = 0;
    for (let i = 0; i < count && n < max; i++) {
      if (px[i] >= x0 && px[i] <= x1 && py[i] >= y0 && py[i] <= y1) out[n++] = idOfSlot[i];
    }
    return n;
  }

  /** Take the accumulated heat. Merges make it; research spends it. */
  function drawHeat(amount) {
    let want = amount, got = 0;
    for (let i = 0; i < count && want > 0; i++) {
      const take = Math.min(heat[i], want);
      heat[i] -= take; want -= take; got += take;
    }
    return got;
  }

  /**
   * Total energy. Kinetic is exact; potential is a Barnes-Hut estimate at the
   * current opening angle. O(n log n), so this is a diagnostic to call on
   * demand, not something to poll every frame.
   */
  function measureEnergy() {
    let ke = 0, internal = 0, bound = 0;
    for (let i = 0; i < count; i++) {
      ke += 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i]);
      internal += heat[i];
      bound += bind[i];
    }
    let pe = 0;
    if (count > 1 && count <= 4096) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = px[j] - px[i], dy = py[j] - py[i];
          const d = Math.sqrt(dx * dx + dy * dy + eps2[i] + eps2[j]);
          pe -= mass[i] * mass[j] / d;
        }
      }
    }
    return {
      kinetic: ke,
      potential: pe,
      heat: internal,
      binding: bound,
      radiated: heatRadiated,
      // Closed books. `binding` is the gravitational energy that stopped being
      // expressible as a distance between two tracked bodies - what merging
      // buried inside a single object, and what condensation folded into an
      // aggregate. Without that term the total climbs every time anything
      // merges, which is an artefact of the bookkeeping and not of the physics.
      total: ke + pe + internal + bound + heatRadiated,
      exact: count <= 4096,
    };
  }

  /**
   * Everything the progression and interface layers need to ask.
   * Cheap enough to call once a frame.
   */
  function stats() {
    let mTot = 0, mMax = 0, hTot = 0, kePop = 0;
    let aggCount = 0;
    const byKindCount = new Int32Array(KIND_COUNT);
    const byKindPop = new Float64Array(KIND_COUNT);
    const byKindMass = new Float64Array(KIND_COUNT);
    for (let i = 0; i < count; i++) {
      const m = mass[i];
      mTot += m;
      if (m > mMax) mMax = m;
      hTot += heat[i];
      const k = kind[i];
      byKindCount[k]++;
      byKindMass[k] += m;
      if (flags[i] & FLAG_AGGREGATE) {
        aggCount++;
        kePop += aggN[i];
        for (let q = 0; q < KIND_COUNT; q++) byKindPop[q] += aggCensus[i * KIND_COUNT + q];
      } else {
        kePop += pop[i];
        byKindPop[k] += pop[i];
      }
    }
    const byKind = [];
    for (let k = 0; k < KIND_COUNT; k++) {
      byKind.push({
        kind: k, name: KIND_NAME[k],
        tracked: byKindCount[k],
        population: mag(byKindPop[k]),
        mass: magFromCode(byKindMass[k], expMass),
        unlocked: unlocked[k] === 1,
      });
    }
    return {
      // Population
      tracked: count,
      aggregates: aggCount,
      population: mag(kePop),
      byKind,
      // Magnitude
      totalMass: magFromCode(mTot, expMass),
      maxMass: magFromCode(mMax, expMass),
      heat: magFromCode(hTot, 2 * expMass - expLen),
      heatRadiated: magFromCode(heatRadiated, 2 * expMass - expLen),
      epoch: epochIndex,
      epochName: EPOCHS[epochIndex].name,
      // Ledger (base-2 exponents; multiply code units by 2^exp for absolute)
      // Base-2 exponents. Multiply a code-unit value by 2^exp for the absolute
      // quantity. The derived ones are supplied because a caller checking a
      // conserved quantity across a rebase must compare absolutes - code units
      // are re-centred underneath it by design.
      ledger: {
        expMass, expLen, expTime,
        expVel: expLen - expTime,
        expMomentum: expMass + expLen - expTime,
        expEnergy: 2 * expMass - expLen,
        expAngMom: (3 * expMass + expLen) >> 1,
      },
      simTime: magFromCode(codeTime, expTime),
      extent: magFromCode(rootSize, expLen),
      // Budget and health
      perf: {
        stepMs: lastStepMs,
        ewmaMs,
        budgetMs,
        softCap,
        hardCap,
        interactions: interactionsLast,
        treeNodes: nodeCount,
        leaves: leafCount,
        timeDebt,
        condensePressure,
        steps: stepCount,
      },
      integrity: { quarantined, lostMass },
    };
  }

  /** Drain queued events. Returns and clears. */
  function drainEvents() {
    if (events.length === 0) return [];
    const out = events.slice();
    events.length = 0;
    return out;
  }

  /** Tunables that may be changed at runtime. */
  function setOption(k, v) {
    if (k === 'theta' && v > 0) theta = v;
    else if (k === 'budgetMs' && v > 0) budgetMs = v;
    else if (k === 'forceTiering') forceTiering = !!v;
    else if (k === 'softCap' && v > 0) softCap = clamp(v, 64, hardCap);
  }

  /** Full state, as plain JSON-safe data. */
  function serialize() {
    const slice = (a) => Array.from(a.subarray(0, count));
    return {
      version: 1,
      seed: (opts.seed | 0) || 1,
      count, nextId, freeIds: freeIds.slice(),
      rngState: Array.from(rng.state),
      ledger: { expMass, expLen, expTime, codeTime, epochIndex },
      stepCount, timeDebt, heatRadiated, lostMass, quarantined,
      softCap, theta, budgetMs, forceTiering,
      // The force-refresh schedule is state. Restoring without it produces a
      // simulation that is correct but not identical, and identical is the
      // whole point of being able to save.
      accumulator, auditCursor, condensePressure, condensing,
      ftier: slice(ftier), lastForce: slice(lastForce),
      unlocked: Array.from(unlocked),
      px: slice(px), py: slice(py), vx: slice(vx), vy: slice(vy),
      ax: slice(ax), ay: slice(ay), mass: slice(mass),
      heat: slice(heat), bind: slice(bind), spin: slice(spin), popArr: slice(pop),
      kind: slice(kind), flags: slice(flags),
      idOfSlot: slice(idOfSlot),
      aggN: slice(aggN), aggR: slice(aggR), aggSigma: slice(aggSigma),
      aggPhase: slice(aggPhase), aggBorn: slice(aggBorn), aggSeed: slice(aggSeed),
      aggCensus: Array.from(aggCensus.subarray(0, count * KIND_COUNT)),
      protectUntil: slice(protectUntil),
    };
  }

  function loadSnapshot(s) {
    ensureCapacity(Math.max(s.count, 256));
    count = s.count;
    nextId = s.nextId;
    freeIds.length = 0;
    for (const f of s.freeIds) freeIds.push(f);
    rng.state.set(s.rngState);
    expMass = s.ledger.expMass; expLen = s.ledger.expLen; expTime = s.ledger.expTime;
    codeTime = s.ledger.codeTime; epochIndex = s.ledger.epochIndex;
    stepCount = s.stepCount; timeDebt = s.timeDebt;
    heatRadiated = s.heatRadiated; lostMass = s.lostMass; quarantined = s.quarantined;
    softCap = s.softCap; theta = s.theta; budgetMs = s.budgetMs;
    forceTiering = s.forceTiering;
    accumulator = s.accumulator || 0;
    auditCursor = s.auditCursor || 0;
    condensePressure = s.condensePressure || 1;
    condensing = !!s.condensing;
    unlocked.set(s.unlocked);
    const put = (dst, src) => { for (let i = 0; i < s.count; i++) dst[i] = src[i]; };
    put(px, s.px); put(py, s.py); put(vx, s.vx); put(vy, s.vy);
    put(ax, s.ax); put(ay, s.ay); put(mass, s.mass);
    put(heat, s.heat); put(bind, s.bind); put(spin, s.spin); put(pop, s.popArr);
    put(kind, s.kind); put(flags, s.flags); put(idOfSlot, s.idOfSlot);
    put(aggN, s.aggN); put(aggR, s.aggR); put(aggSigma, s.aggSigma);
    put(aggPhase, s.aggPhase); put(aggBorn, s.aggBorn); put(aggSeed, s.aggSeed);
    put(protectUntil, s.protectUntil);
    put(ftier, s.ftier); put(lastForce, s.lastForce);
    for (let i = 0; i < s.count * KIND_COUNT; i++) aggCensus[i] = s.aggCensus[i];
    slotOfId.fill(-1);
    for (let i = 0; i < count; i++) {
      const id = idOfSlot[i];
      if (id >= slotOfId.length) {
        const g = new Int32Array(id * 2 + 2).fill(-1);
        g.set(slotOfId);
        slotOfId = g;
      }
      slotOfId[id] = i;
      refreshDerived(i);
    }
    treeValid = false;
    bindRenderView();
    renderView.count = count;
  }

  /**
   * Hash of the live state. Two runs from the same seed and the same call
   * sequence must produce the same checksum at the same step. This is the
   * determinism test.
   */
  function checksum() {
    let h = 0x811c9dc5 >>> 0;
    const f = new Float64Array(1);
    const u = new Uint32Array(f.buffer);
    const feed = (x) => {
      f[0] = x;
      h = Math.imul(h ^ u[0], 0x01000193) >>> 0;
      h = Math.imul(h ^ u[1], 0x01000193) >>> 0;
    };
    for (let i = 0; i < count; i++) {
      feed(px[i]); feed(py[i]); feed(vx[i]); feed(vy[i]);
      feed(mass[i]); feed(heat[i]); feed(bind[i]); feed(spin[i]); feed(pop[i]);
      h = Math.imul(h ^ kind[i], 0x01000193) >>> 0;
      h = Math.imul(h ^ idOfSlot[i], 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ count, 0x01000193) >>> 0;
    h = Math.imul(h ^ expMass, 0x01000193) >>> 0;
    h = Math.imul(h ^ expLen, 0x01000193) >>> 0;
    return h >>> 0;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * @typedef {object} Sim
   */
  const sim = {
    // Lifecycle
    step, stepExact,
    // Content
    addBody, addCloud, removeBody: removeById, getBody, setKind, applyImpulse,
    // Progression
    setKindUnlocked, isKindUnlocked, drawHeat, stats, drainEvents, measureEnergy,
    // Presentation (state only - nothing here draws anything)
    setView, getRenderView, sampleAggregate, pick, queryRect,
    // Persistence and testing
    serialize, checksum, setOption,
    // Constants, re-exported for convenience at the call site
    KIND, KIND_NAME, EVENT, EPOCHS, DT,
    get count() { return count; },
    get stepCount() { return stepCount; },
  };

  if (opts.snapshot) loadSnapshot(opts.snapshot);
  bindRenderView();
  renderView.count = count;
  return sim;
}

/** Restore a simulation from serialize(). */
export function restoreSim(snapshot, opts = {}) {
  return createSim({ ...opts, seed: snapshot.seed, capacity: Math.max(256, snapshot.count * 2), snapshot });
}
