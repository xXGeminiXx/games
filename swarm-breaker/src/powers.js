// ===========================================================================
// Swarm Breaker - powers and builds
//
// Pure logic. No canvas, no DOM, no timers, no assets. The physics layer owns
// motion and drawing; this module owns what the swarm IS and what it does on
// contact. Everything here is data in, data out, so the same module drives the
// playable build and a headless balance run without modification.
//
// THREE IDEAS HOLD THE WHOLE SYSTEM UP
//
// 1. BODIES vs COUNT. The swarm count is unbounded and grows multiplicatively;
//    the number of simulated circles is not. Past the body cap, one simulated
//    body carries a STACK - the number of real balls it stands for - and deals
//    that many balls' damage in one impact. A swarm of 4.7 billion resolves in
//    the same frame budget as a swarm of forty. Raising the body cap is its own
//    upgrade line, because bodies are what convert raw count into hit density,
//    and hit density is what the splitting and chaining powers feed on.
//
// 2. MAGNITUDE. Damage, essence, block health and swarm count are all stored
//    as {m, e} mantissa/exponent pairs, so nothing breaks when a build starts
//    dealing 1e60 per impact. Plain numbers are used only where a value is
//    structurally small (ranks, counts of bodies, frame intervals).
//
// 3. NO TREE. Powers are not laid out on a radiating grid. They live in a pool
//    behind gates. Each depth deals a small hand from whatever the pool is
//    willing to show you, and the pool widens as you commit: taking things at
//    all opens the doctrine openers, and investing inside a doctrine reveals
//    its deep ranks and its cross-doctrine keystones. A first-time player sees
//    two cards. A player forty powers in sees a hand drawn from everything.
//
// WHAT THE PLAYER DOES: chooses between turns. Nothing in this module asks for
// input during a turn. Once the swarm is fired it resolves itself. Powers that
// read the market read it ONCE, when the turn opens, and the turn then runs on
// that reading - so trading well is a decision made between turns like every
// other decision here.
//
// TRADE IS A LANE, NOT A TOLL. A power can be paid for with cash or with
// material (see apply's `rail` option). The LEDGER doctrine makes the material
// rail cheap by making the player good at trading; TEMPER, SPOILS and MELT let
// a player who never wants to touch a price chart convert destruction straight
// into strength and pay cash instead. Both routes go all the way up. A third
// group - SPECULATE, HEDGE, LIQUIDITY, SOLVENCY - pays out only when the market
// is in a particular state, which is what makes leaning on it a read rather
// than a habit.
//
// DIFFICULTY IS SUPPLIED, NOT ASSUMED. Nothing here hardcodes one curve. The
// health ramp, cost ramp and payout ramp all read state.tier when it is set and
// fall back to TUNING when it is not, so a selected difficulty tier (and the
// endless stretch past the end of one) drives the numbers without this module
// knowing how tiers are chosen. See setTier().
//
// EVERY EFFECT IS VISIBLE. Each power carries a `visual` note naming its
// on-screen tell, and every hook returns an `fx` list of typed, positioned
// events for the renderer. Nothing is signalled by sound.
//
// ---------------------------------------------------------------------------
// WIRING (the order the physics layer calls this)
//
//   const st = createState({ seed: 12345 });
//
//   per turn, on fire:      const plan = onTurnStart(st, ctx);
//                           for i in 0..plan.bodies:  onBallSpawn(st, i, plan)
//   per frame:              onFrame(st, liveBalls, ctx)   // orbits, tethers
//   per frame, per ball:    steer(st, ball, ctx)          // homing, gravity
//   on wall bounce:         onWallBounce(st, ball)
//   on block contact:       resolveImpact(st, ball, block, ctx)
//   on pickup:              onPickup(st, kind, ctx)
//   on ball crossing floor: onFloor(st, ball, ctx)
//   when the turn ends:     onTurnEnd(st, ctx)
//   between turns:          offer(st, depth) -> apply(st, id)
//
// `ctx` is supplied by the caller and carries the live field:
//   { blocks, posOf(block) -> {x, y}, depth, floorY, topY, width, cell }
// Only `blocks` is required by the damage hooks; `posOf` is required by the
// gravity and orbit hooks. Blocks are the caller's own objects and are read
// through {c, r, hp, max} - the shape the field already uses.
// ===========================================================================


// ---------------------------------------------------------------------------
// MAGNITUDE - mantissa/exponent arithmetic
//
// Stored as { m, e } with 1 <= |m| < 10, or the canonical zero { m: 0, e: 0 }.
// Roughly 15 significant digits and an exponent range of about +/-3e8, which
// is far past anything a run can reach.
// ---------------------------------------------------------------------------

const ZERO = Object.freeze({ m: 0, e: 0 });
const ONE = Object.freeze({ m: 1, e: 0 });
const INF = Object.freeze({ m: 1, e: 1e9 });

function norm(m, e) {
  if (m === 0 || !isFinite(m)) return m === 0 || isNaN(m) ? ZERO : INF;
  const shift = Math.floor(Math.log10(Math.abs(m)));
  if (shift !== 0) { m /= Math.pow(10, shift); e += shift; }
  // Guard the boundary cases float rounding can leave behind.
  if (Math.abs(m) >= 10) { m /= 10; e += 1; }
  else if (Math.abs(m) < 1) { m *= 10; e -= 1; }
  if (e > 1e9) return INF;
  if (e < -1e9) return ZERO;
  return { m, e };
}

/** Coerce a number, a magnitude, or null into a magnitude. */
function big(v) {
  if (v == null) return ZERO;
  if (typeof v === 'number') return norm(v, 0);
  if (typeof v === 'object' && typeof v.m === 'number') return v;
  return ZERO;
}

function badd(a, b) {
  a = big(a); b = big(b);
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const hi = a.e >= b.e ? a : b, lo = a.e >= b.e ? b : a;
  const d = hi.e - lo.e;
  if (d > 16) return hi;
  return norm(hi.m + lo.m * Math.pow(10, -d), hi.e);
}
function bneg(a) { a = big(a); return a.m === 0 ? ZERO : { m: -a.m, e: a.e }; }
function bsub(a, b) { return badd(a, bneg(b)); }
function bmul(a, b) {
  a = big(a); b = big(b);
  if (a.m === 0 || b.m === 0) return ZERO;
  return norm(a.m * b.m, a.e + b.e);
}
function bdiv(a, b) {
  a = big(a); b = big(b);
  if (b.m === 0) return INF;
  if (a.m === 0) return ZERO;
  return norm(a.m / b.m, a.e - b.e);
}
/** Base-10 logarithm. -Infinity for zero. Used for every "scales with size" curve. */
function blog10(a) {
  a = big(a);
  return a.m === 0 ? -Infinity : Math.log10(Math.abs(a.m)) + a.e;
}
/** Fractional and astronomic exponents both go through logs, so nothing overflows. */
function bpow(a, p) {
  a = big(a);
  if (a.m === 0) return p === 0 ? ONE : ZERO;
  if (p === 0) return ONE;
  const L = blog10(a) * p;
  if (!isFinite(L)) return L > 0 ? INF : ZERO;
  const e = Math.floor(L);
  return norm(Math.pow(10, L - e), e);
}
function bcmp(a, b) {
  a = big(a); b = big(b);
  const sa = Math.sign(a.m), sb = Math.sign(b.m);
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (sa === 0) return 0;
  if (a.e !== b.e) return (a.e < b.e ? -1 : 1) * (sa > 0 ? 1 : -1);
  if (a.m === b.m) return 0;
  return a.m < b.m ? -1 : 1;
}
const bgte = (a, b) => bcmp(a, b) >= 0;
const blte = (a, b) => bcmp(a, b) <= 0;
const bmax = (a, b) => (bcmp(a, b) >= 0 ? big(a) : big(b));
const bmin = (a, b) => (bcmp(a, b) <= 0 ? big(a) : big(b));
const bzero = a => big(a).m === 0;

/** Clamped conversion for anything that must be a real JS number (loop counts, positions). */
function bnum(a) {
  a = big(a);
  if (a.m === 0) return 0;
  if (a.e > 308) return a.m > 0 ? Infinity : -Infinity;
  if (a.e < -308) return 0;
  return a.m * Math.pow(10, a.e);
}
function bfloor(a) {
  a = big(a);
  if (a.e > 15) return a;
  return big(Math.floor(bnum(a)));
}

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/**
 * Short display string. Integers below a thousand print plainly, then suffixes
 * carry to 1e36, then scientific notation runs forever. Pure string work - the
 * renderer decides where to put it.
 */
function fmt(a, places) {
  a = big(a);
  if (a.m === 0) return '0';
  const neg = a.m < 0 ? '-' : '';
  const m = Math.abs(a.m), e = a.e;
  if (e < 0) {
    const v = m * Math.pow(10, e);
    return neg + (v < 0.01 ? v.toExponential(1) : v.toFixed(places == null ? 2 : places));
  }
  if (e < 3) return neg + String(Math.round(m * Math.pow(10, e)));
  if (e < 3 * SUFFIX.length) {
    const i = Math.floor(e / 3);
    const v = m * Math.pow(10, e - 3 * i);
    const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v));
    return neg + s + SUFFIX[i];
  }
  return neg + m.toFixed(2) + 'e' + e;
}

/** The magnitude namespace, exported so the caller can do its own arithmetic. */
const B = {
  of: big, zero: ZERO, one: ONE, inf: INF,
  add: badd, sub: bsub, mul: bmul, div: bdiv, pow: bpow, neg: bneg,
  cmp: bcmp, gte: bgte, lte: blte, max: bmax, min: bmin, isZero: bzero,
  log10: blog10, toNumber: bnum, floor: bfloor, fmt,
};


// ---------------------------------------------------------------------------
// Deterministic randomness. A run is reproducible from its seed, which is what
// makes a reroll a real decision instead of a slot machine with hidden state.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(a, b, c) {
  let h = (a | 0) ^ 0x811c9dc5;
  h = Math.imul(h ^ (b | 0), 0x01000193);
  h = Math.imul(h ^ (c | 0), 0x01000193);
  return h >>> 0;
}
/** Deterministic 0..1 with no closure allocated - safe to call per contact. */
function hashUnit(a, b, c) {
  let h = hash3(a, b, c);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}


// ---------------------------------------------------------------------------
// TUNING - every balance dial in one place, exported so a headless run can
// sweep them without editing power definitions.
// ---------------------------------------------------------------------------

const TUNING = {
  baseDamage: 1,          // damage one real ball deals with no powers
  baseBodyCap: 26,        // simulated circles before stacking starts
  hardBodyCap: 480,       // absolute ceiling on simulated circles per turn
  minFireInterval: 1,     // frames between launches at maximum density
  maxFireInterval: 4,     // frames between launches for a small swarm
  baseSpeed: 11,

  // The default curve, used when no difficulty tier is supplied. Every one of
  // these is overridable per tier - see setTier().
  hpBase: 1.35,           // block health at shallow depth, per depth
  hpRamp: 8,              // depth where health stops being linear
  hpGrowth: 1.16,         // geometric health growth past the ramp
  endlessFrom: null,      // depth a tier's authored stretch ends
  endlessGrowth: 1.02,    // extra health ramp per depth past that point
  materialRate: 0.55,     // cash-equivalent of one bulk unit of material

  essenceExp: 0.75,       // essence per kill scales as health^this
  essenceBase: 2.2,
  costDepth: 1.13,        // every power costs this much more per depth
  rerollBase: 9,
  rerollGrowth: 1.8,

  cascadeBudget: 512,     // hard stop on one impact's chain reaction
  fxBudget: 600,          // visual events emitted per turn before thinning
  splitAngle: 0.42,       // radians a split child is rotated off the parent
  tetherPairs: 24,        // linked pairs evaluated per frame
  settleAfter: 900,       // frames before the field starts pushing bodies down
  settleRamp: 900,        // frames over which that push reaches full strength
  strainCap: 120,         // strikes on one block that erosion still counts
  sympathyCap: 150,       // kills in one turn that sympathy still counts
  conductionCap: 56,      // blocks on the field that conduction still counts
};


// ---------------------------------------------------------------------------
// DOCTRINES - the four ways to be strong, plus the support axis every build
// dips into. A doctrine is not a page in a menu; it is a tag that gates the
// pool, biases the hand, and colours the swarm on screen.
// ---------------------------------------------------------------------------

const DOCTRINES = {
  legion: {
    id: 'legion', name: 'LEGION', tint: '#5ad1ff',
    creed: 'more of them than the field can hold',
    reads: 'the swarm band under the floor thickens until it is solid',
  },
  monolith: {
    id: 'monolith', name: 'MONOLITH', tint: '#ff5c46',
    creed: 'few, and each one ruinous',
    reads: 'fewer, larger, hotter bodies that leave craters',
  },
  fracture: {
    id: 'fracture', name: 'FRACTURE', tint: '#ffc94a',
    creed: 'the first hit is not the hit that matters',
    reads: 'arcs between blocks and blooms of secondary detonations',
  },
  well: {
    id: 'well', name: 'WELL', tint: '#b98cff',
    creed: 'do not aim it, bend it',
    reads: 'curved trails, orbit rings, and a visible pull at the field floor',
  },
  ledger: {
    id: 'ledger', name: 'LEDGER', tint: '#6ee7a8',
    creed: 'the field is not an enemy, it is supply',
    reads: 'price marks and fill quality printed beside every payout',
  },
  tithe: {
    id: 'tithe', name: 'TITHE', tint: '#8f9aa8',
    creed: 'what the field owes you, taken with interest',
    reads: 'brighter essence payouts and a wider hand of choices',
  },
};

/** Powers become visible in waves as the player commits to anything at all. */
const TIER_GATE = [0, 2, 6, 13, 22];

/** Powers taken before generated options start appearing in a hand. */
const ECHO_AFTER = 22;


// ---------------------------------------------------------------------------
// DERIVED STATS - the flattened result of everything owned.
//
// Recomputed only when ranks change. Every power writes into this object and
// nothing reads another power's writes, so effects are order independent and
// stacking is trivially additive or trivially multiplicative by field.
// ---------------------------------------------------------------------------

function baseDerived(state) {
  return {
    // damage
    flat: big(TUNING.baseDamage),   // additive damage per real ball
    mult: big(1),                   // global multiplier
    momentum: 0,                    // damage gain per bounce, compounding
    pressure: 0,                    // damage from the size of the swarm
    sunder: 0,                      // damage against undamaged blocks
    singular: 0,                    // share of the swarm poured into one body
    requisition: 0,                 // damage from essence spent this run

    // swarm
    bodyCap: TUNING.baseBodyCap,
    growth: 0,                      // fractional swarm growth per turn
    spoils: 0,                      // balls gained per block destroyed
    nesting: 0,                     // pickups grant this share of the swarm
    spawntide: 0,                   // swarm growth per destroy, end of turn
    spall: 0,                       // bodies granted per order of magnitude of damage

    // propagation
    splits: 0,                      // split charges per body
    splitGens: 1,                    // generations that keep their charges
    splitKeepsStack: false,          // children inherit the full stack
    arcTargets: 0,
    arcFalloff: 0.32,
    detonate: 0,                    // share of lethal damage dealt to neighbours
    detonateChains: 0,
    pierce: 0,
    resonance: false,               // secondary damage stops falling off
    resonanceAmp: 1,                // and grows by this much per link instead

    // field
    pull: 0,                        // steering toward the nearest block
    anchor: false,                  // steering toward the deepest block
    orbitChance: 0,
    orbitTicks: 0,
    orbitFrac: 0.30,
    orbitPeriod: 7,
    erosion: 0,                     // damage growth per prior strike on the same block
    sympathy: 0,                    // secondary damage growth per kill already made this turn
    conduction: 0,                  // damage growth per block currently on the field
    eventHorizon: false,            // orbit ticks feed momentum
    lensing: 0,                     // floor rescues per body
    overrun: 0,                     // top-of-field re-entries per body
    tether: 0,                      // damage per frame along linked bodies
    collapse: 0,                    // end-of-turn implosion, share of turn damage

    // trade - read by the market layer through tradeMods(), never applied here
    fill: 0,                        // how much closer to quote a sale fills
    book: 0,                        // extra effective book depth, so size moves price less
    revealShift: 0,                 // depths earlier the market tools arrive
    forward: 0,                     // consignment payout and capacity
    refineFee: 0,                   // share of the refining fee waived
    refineYield: 0,                 // extra refined output
    yieldBonus: 0,                  // extra material per block destroyed
    coverCut: 0,                    // share of the cover-purchase penalty waived
    monopoly: false,                // sales stop moving the book against you
    corner: 0,                      // material yield scales with the swarm

    // reading the market as a combat stat, resolved once per turn
    speculate: 0,                   // stronger while the market favours selling
    hedge: 0,                       // stronger while it does not
    liquidity: 0,                   // stronger the more material is held unsold
    solvency: 0,                    // stronger the more cash is on hand

    // routes that never touch a price
    temper: 0,                      // permanent damage per block destroyed
    melt: 0,                        // flat cash per bulk unit, no book, no timing

    // economy and choice
    harvest: 0,
    interest: 0,
    scavenge: 0,
    gleaning: false,                // secondary kills pay full essence
    duty: 0,                        // discount on the doctrine you favour
    slots: 0,
    freeRerolls: 0,
    augury: false,                  // the hand survives into the next depth

    // bookkeeping the caller may want to read
    heft: big(state && state.acquired ? state.acquired.heft : 0),
    dominant: null,
  };
}


// ---------------------------------------------------------------------------
// POWERS
//
// Every entry:
//   id          stable key, also the key in state.ranks
//   name        display name
//   doctrine    which axis it belongs to
//   tier        reveal wave (see TIER_GATE)
//   max         rank ceiling, usually Infinity
//   base/growth cost curve: base * growth^rank * costDepth^depth
//   req(s)      extra gate on top of the tier
//   line(r, s)  what the NEXT rank does, in the player's terms
//   visual      the on-screen tell, so nothing is invisible
//   effect      writes into the derived stats
//   onTake      instant, one-shot consequences (mutates state, returns fx)
//   keystone    a cross-doctrine capstone; the hand shows these loudly
// ---------------------------------------------------------------------------

const doc = (s, id) => (s && s.doctrinePoints ? s.doctrinePoints[id] : 0) || 0;
const rank = (s, id) => (s && s.ranks ? s.ranks[id] : 0) || 0;
const owns = (s, id) => (s.ranks[id] || 0) > 0;

const POWER_LIST = [

  // -- LEGION ---------------------------------------------------------------
  // The count build. Grows the swarm multiplicatively, converts count into
  // damage through pressure, and converts count into hit density through the
  // body cap. Its ceiling is not a number in a table; it is an exponent.

  {
    id: 'conscript', name: 'CONSCRIPT', doctrine: 'legion', tier: 0,
    max: Infinity, base: 14, growth: 1.42,
    line: (r, s) => `+${fmt(conscriptGain(s, r + 1))} to the swarm now (or 9% of it, whichever is more)`,
    visual: 'the swarm band under the floor visibly thickens on purchase',
    effect: () => {},
    onTake: (s, r) => {
      const gain = conscriptGain(s, r);
      s.swarm = badd(s.swarm, gain);
      return [{ type: 'swarm', amount: gain, reason: 'conscript' }];
    },
  },
  {
    id: 'levy', name: 'LEVY', doctrine: 'legion', tier: 1,
    max: Infinity, base: 90, growth: 1.36,
    req: s => doc(s, 'legion') >= 2,
    line: r => `the swarm grows ${(7 + r).toFixed(0)}% every turn, compounding`,
    visual: 'a growth figure ticks up on the swarm readout at the end of every turn',
    effect: (d, r) => { d.growth += 0.07 + 0.01 * r; },
  },
  {
    id: 'spoils', name: 'SPOILS', doctrine: 'legion', tier: 1,
    max: Infinity, base: 70, growth: 1.33,
    req: s => doc(s, 'legion') >= 2,
    line: r => `every block destroyed adds ${(0.05 * r).toFixed(2)} to the swarm`,
    visual: 'a fractional counter fills beside the swarm readout as blocks die',
    effect: (d, r) => { d.spoils += 0.05 * r; },
  },
  {
    id: 'broodline', name: 'BROODLINE', doctrine: 'legion', tier: 2,
    max: Infinity, base: 150, growth: 1.44,
    req: s => doc(s, 'legion') >= 5,
    line: r => `+${2 + Math.floor(r / 3)} bodies on the field; the same swarm arrives as more, smaller impacts`,
    visual: 'more distinct circles in flight for the same swarm size',
    effect: (d, r) => { d.bodyCap += 2 * r + Math.floor(r * r / 6); },
  },
  {
    id: 'nesting', name: 'NESTING', doctrine: 'legion', tier: 2,
    max: Infinity, base: 175, growth: 1.40,
    req: s => doc(s, 'legion') >= 5,
    line: r => `swarm pickups grant ${(2 * r).toFixed(0)}% of the current swarm instead of one ball`,
    visual: 'pickups burst into a spray sized to the swarm rather than a single mote',
    effect: (d, r) => { d.nesting += 0.02 * r; },
  },
  {
    id: 'pressure', name: 'PRESSURE', doctrine: 'legion', tier: 2,
    max: Infinity, base: 220, growth: 1.42,
    req: s => doc(s, 'legion') >= 4,
    line: r => `every impact hits harder the larger the swarm is (+${(30 * r)}% per order of magnitude)`,
    visual: 'impact flashes scale with the swarm readout',
    effect: (d, r) => { d.pressure += 0.30 * r; },
  },
  {
    id: 'overrun', name: 'OVERRUN', doctrine: 'legion', tier: 3,
    max: Infinity, base: 500, growth: 1.5,
    req: s => doc(s, 'legion') >= 9,
    line: r => `${r} time${r === 1 ? '' : 's'} per body, crossing the floor re-enters it from the top instead of ending`,
    visual: 'bodies wrap through the top edge with a bright seam where they cross',
    effect: (d, r) => { d.overrun += r; },
  },

  // -- MONOLITH -------------------------------------------------------------
  // The per-ball build. Wants FEW bodies, each carrying an enormous number.
  // Its engine is multiplicative damage and per-bounce momentum, so it is
  // paid by turn length rather than by turn count.

  {
    id: 'sharpen', name: 'SHARPEN', doctrine: 'monolith', tier: 0,
    max: Infinity, base: 34, growth: 1.38,
    line: (r, s) => `+${fmt(sharpenGain(s, r + 1))} damage per ball`,
    visual: 'the damage figure on the launcher rises',
    effect: (d, r, s) => {
      let total = ZERO;
      for (let i = 1; i <= r; i++) total = badd(total, sharpenGain(s, i, true));
      d.flat = badd(d.flat, total);
    },
  },
  {
    id: 'hone', name: 'HONE', doctrine: 'monolith', tier: 1,
    max: Infinity, base: 120, growth: 1.40,
    req: s => doc(s, 'monolith') >= 2,
    line: r => `x${(1.25 + 0.02 * r).toFixed(2)} damage, multiplying with everything else`,
    visual: 'bodies burn brighter and their impact flash grows with each rank',
    effect: (d, r) => {
      for (let i = 1; i <= r; i++) d.mult = bmul(d.mult, big(1.25 + 0.02 * i));
    },
  },
  {
    id: 'momentum', name: 'MOMENTUM', doctrine: 'monolith', tier: 1,
    max: Infinity, base: 130, growth: 1.38,
    req: s => doc(s, 'monolith') >= 2,
    line: r => `+${(5 + r).toFixed(0)}% damage for every bounce a body has already made, compounding`,
    visual: 'a body heats from cold to white across a long turn and trails harder',
    effect: (d, r) => { d.momentum += 0.05 + 0.01 * r; },
  },
  {
    id: 'sunder', name: 'SUNDER', doctrine: 'monolith', tier: 2,
    max: Infinity, base: 240, growth: 1.42,
    req: s => doc(s, 'monolith') >= 5,
    line: r => `+${(60 * r)}% damage against a block at full health, falling off as it breaks`,
    visual: 'first contact on a fresh block throws a heavier flash than later ones',
    effect: (d, r) => { d.sunder += 0.6 * r; },
  },
  {
    id: 'crucible', name: 'CRUCIBLE', doctrine: 'monolith', tier: 2,
    max: Infinity, base: 260, growth: 1.30,
    req: s => doc(s, 'monolith') >= 4 && bgte(s.swarm, big(24)),
    line: (r, s) => `burn 40% of the swarm now; keep ${fmt(crucibleGain(s, r + 1))} of it as permanent damage`,
    visual: 'the swarm band collapses inward and the launcher core turns molten',
    effect: () => {},
    onTake: (s, r) => {
      const burned = bmul(s.swarm, big(0.4));
      const gained = crucibleGain(s, r, burned);
      s.swarm = bmax(bsub(s.swarm, burned), big(1));
      s.acquired.heft = badd(s.acquired.heft, gained);
      return [
        { type: 'swarm', amount: bneg(burned), reason: 'crucible' },
        { type: 'crucible', burned, gained },
      ];
    },
  },
  {
    id: 'temper', name: 'TEMPER', doctrine: 'monolith', tier: 2,
    max: Infinity, base: 245, growth: 1.42,
    req: s => doc(s, 'monolith') >= 4,
    line: r => `every block destroyed adds ${(0.08 * r).toFixed(2)} permanent damage - no material, no selling, no price`,
    visual: 'the launcher core thickens by a visible increment as blocks break',
    effect: (d, r) => { d.temper += 0.08 * r; },
  },
  {
    id: 'singular', name: 'SINGULAR', doctrine: 'monolith', tier: 3,
    max: 5, base: 620, growth: 1.85,
    req: s => doc(s, 'monolith') >= 9,
    line: r => `the first body of every turn carries ${(15 * r)}% of the entire swarm by itself`,
    visual: 'one enormous body leads the volley, drawn several times the size of the rest',
    effect: (d, r) => { d.singular += 0.15 * r; },
  },

  // -- FRACTURE -------------------------------------------------------------
  // The propagation build. Damage does not come from the contact; it comes
  // from what the contact sets off. Scales with the number of impacts, which
  // is why it wants bodies, and with the number of blocks, which is why it
  // gets better as the field fills up rather than worse.

  {
    id: 'fission', name: 'FISSION', doctrine: 'fracture', tier: 1,
    max: Infinity, base: 105, growth: 1.40,
    req: s => s.meta.taken >= 2,
    line: r => `destroying a block splits the body in two, ${r} time${r === 1 ? '' : 's'} per body; +${Math.floor(r * 1.5)} bodies at launch`,
    visual: 'a body visibly cleaves into two smaller ones at the moment a block dies',
    effect: (d, r) => { d.splits += r; d.bodyCap += Math.floor(r * 1.5); },
  },
  {
    id: 'arc', name: 'ARC', doctrine: 'fracture', tier: 1,
    max: Infinity, base: 115, growth: 1.38,
    req: s => s.meta.taken >= 2,
    line: r => `each impact also strikes the ${r} nearest other block${r === 1 ? '' : 's'} for a share of the damage`,
    visual: 'a drawn line jumps from the struck block to each secondary target',
    effect: (d, r) => { d.arcTargets += r; d.arcFalloff = Math.min(0.85, 0.32 + 0.04 * r); },
  },
  {
    id: 'conduction', name: 'CONDUCTION', doctrine: 'fracture', tier: 1,
    max: Infinity, base: 110, growth: 1.40,
    req: s => doc(s, 'fracture') >= 1,
    line: (r, s) => `+${((0.04 + 0.015 * r) * (1 + doc(s, 'fracture') / 15) * 100).toFixed(0)}% damage for every block standing on the field, compounding - and it sharpens as FRACTURE deepens`,
    visual: 'the whole field glows faintly and the glow deepens as it fills up',
    // Multiplied by how deep FRACTURE runs, so this is the doctrine's reward
    // for going all in. A few points splashed into another build barely move
    // it; a build that lives here can break the first block on its own.
    effect: (d, r, s) => { d.conduction += (0.04 + 0.015 * r) * (1 + doc(s, 'fracture') / 15); },
  },
  {
    id: 'detonate', name: 'DETONATE', doctrine: 'fracture', tier: 1,
    max: Infinity, base: 145, growth: 1.40,
    req: s => doc(s, 'fracture') >= 2,
    line: r => `a destroyed block detonates, dealing ${(45 * r)}% of the killing blow to its neighbors`,
    visual: 'a square shockwave expands from every block as it dies',
    effect: (d, r) => { d.detonate += 0.45 * r; d.detonateChains = 3 + 2 * r; },
  },
  {
    id: 'sympathy', name: 'SYMPATHY', doctrine: 'fracture', tier: 2,
    max: Infinity, base: 250, growth: 1.42,
    req: s => doc(s, 'fracture') >= 4,
    line: r => `every block already destroyed this turn makes arcs and detonations ${(4 + r)}% harder, and direct impacts half that`,
    visual: 'the whole field destabilises as the turn goes on - later impacts flash harder than the first ones did',
    effect: (d, r) => { d.sympathy += 0.04 + 0.01 * r; },
  },
  {
    id: 'pierce', name: 'PIERCE', doctrine: 'fracture', tier: 2,
    max: Infinity, base: 230, growth: 1.44,
    req: s => doc(s, 'fracture') >= 5,
    line: r => `bodies pass straight through their first ${r} block${r === 1 ? '' : 's'} instead of bouncing`,
    visual: 'a body punches through in a straight line and leaves a bored channel behind it',
    effect: (d, r) => { d.pierce += r; },
  },
  {
    id: 'resonance', name: 'RESONANCE', doctrine: 'fracture', tier: 3,
    max: 1, base: 900, growth: 3,
    req: s => doc(s, 'fracture') >= 9,
    line: (r, s) => `a chain stops losing strength and starts gaining it: every link hits harder than the one before, scaled by how deep FRACTURE runs (currently x${(1 + 0.02 * doc(s, 'fracture')).toFixed(2)} per link)`,
    visual: 'chain lines brighten link by link instead of fading, ending brighter than they began',
    effect: (d, r, s) => {
      d.resonance = true;
      d.resonanceAmp = 1 + 0.02 * doc(s, 'fracture');
    },
  },
  {
    id: 'cascade', name: 'CASCADE', doctrine: 'fracture', tier: 4,
    max: 4, base: 1400, growth: 2.1,
    req: s => doc(s, 'fracture') >= 13 && owns(s, 'fission'),
    line: r => `split children keep their own split charges for ${r} further generation${r === 1 ? '' : 's'}`,
    visual: 'one cleave becomes a branching front of bodies filling the field',
    effect: (d, r) => { d.splitGens = 1 + r; },
  },

  // -- WELL -----------------------------------------------------------------
  // The field build. Instead of a harder ball, it changes where balls go and
  // how long they stay. Aim stops mattering, turns get long, and everything
  // that scales with time or with contact count rides on top of it.

  {
    id: 'pull', name: 'PULL', doctrine: 'well', tier: 1,
    max: Infinity, base: 100, growth: 1.36,
    req: s => s.meta.taken >= 2,
    line: r => `bodies curve toward the nearest block (steering ${(5 * r)}%)`,
    visual: 'flight paths bend visibly instead of running straight between bounces',
    effect: (d, r) => { d.pull += 0.05 * r; },
  },
  {
    id: 'anchor', name: 'ANCHOR', doctrine: 'well', tier: 2,
    max: Infinity, base: 210, growth: 1.42,
    req: s => doc(s, 'well') >= 4,
    line: r => `a well forms on the deepest block and drags the whole swarm into it (+${(6 * r)}% pull)`,
    visual: 'a drawn well ring sits on the deepest block with the swarm spiralling in',
    effect: (d, r) => { d.anchor = true; d.pull += 0.06 * r; },
  },
  {
    id: 'orbit', name: 'ORBIT', doctrine: 'well', tier: 2,
    max: Infinity, base: 250, growth: 1.44,
    req: s => doc(s, 'well') >= 5,
    line: r => `${(9 * r)}% of impacts capture the body into orbit, grinding the block instead of bouncing off`,
    visual: 'captured bodies trace a visible ring around their block, striking every few frames',
    effect: (d, r) => {
      d.orbitChance += 0.09 * r;
      d.orbitTicks = 44 + 10 * r;
      d.orbitFrac = 0.30 + 0.02 * r;
    },
  },
  {
    id: 'erosion', name: 'EROSION', doctrine: 'well', tier: 2,
    max: Infinity, base: 235, growth: 1.42,
    req: s => doc(s, 'well') >= 4,
    line: r => `every strike a block has already taken this turn makes the next one ${(5 + r)}% harder`,
    visual: 'a block being worked over cracks progressively and its number falls faster each strike',
    effect: (d, r) => { d.erosion += 0.05 + 0.01 * r; },
  },
  {
    id: 'lensing', name: 'LENSING', doctrine: 'well', tier: 2,
    max: Infinity, base: 280, growth: 1.46,
    req: s => doc(s, 'well') >= 5,
    line: r => `${r} time${r === 1 ? '' : 's'} per body, the floor throws it back up instead of taking it`,
    visual: 'the floor line flexes and kicks the body upward with a visible bow',
    effect: (d, r) => { d.lensing += r; },
  },
  {
    id: 'tether', name: 'TETHER', doctrine: 'well', tier: 3,
    max: Infinity, base: 560, growth: 1.5,
    req: s => doc(s, 'well') >= 9,
    line: r => `bodies are linked in pairs; the line between them cuts anything it crosses for ${(6 * r)}% per frame`,
    visual: 'bright lines strung between paired bodies sweep across the field',
    effect: (d, r) => { d.tether += 0.06 * r; },
  },
  {
    id: 'collapse', name: 'COLLAPSE', doctrine: 'well', tier: 3,
    max: Infinity, base: 640, growth: 1.5,
    req: s => doc(s, 'well') >= 10,
    line: r => `when the turn ends the well implodes for ${(3 * r)}% of everything the turn dealt`,
    visual: 'the field pulls inward once and everything inside the well flashes at once',
    effect: (d, r) => { d.collapse += 0.03 * r; },
  },

  // -- LEDGER ---------------------------------------------------------------
  // The trade build. It wins by being good at selling rather than by being
  // good at hitting, and it is entirely optional: every one of these improves
  // a rail the player can decline to use. Nothing here fires during a turn -
  // the market is read once when the turn opens and the turn runs on that read.

  {
    id: 'standing', name: 'STANDING', doctrine: 'ledger', tier: 0,
    max: Infinity, base: 42, growth: 1.34,
    line: r => `close ${(100 * (1 - 1 / (1 + standingFill(r)))).toFixed(0)}% of the gap between what a sale is quoted and what it actually fills at`,
    visual: 'each payout prints the fill price against the quote, with the gap visibly narrowing',
    // Every rank shortens the remaining gap rather than adding a flat share of
    // the quote, so this improves without limit and can never pay above quote.
    effect: (d, r) => { d.fill += standingFill(r); },
  },
  {
    id: 'float', name: 'FLOAT', doctrine: 'ledger', tier: 1,
    max: Infinity, base: 150, growth: 1.40,
    req: s => doc(s, 'ledger') >= 2,
    line: r => `the books you trade in run ${(25 * r)}% deeper, so a large sale moves the price less against you`,
    visual: 'the book depth bars sit visibly fuller than the market alone would draw them',
    effect: (d, r) => { d.book += 0.25 * r; },
  },
  {
    id: 'assayer', name: 'ASSAYER', doctrine: 'ledger', tier: 1,
    max: Infinity, base: 120, growth: 1.36,
    req: s => doc(s, 'ledger') >= 2,
    line: r => `every block destroyed yields ${(20 * r)}% more material`,
    visual: 'material counts tick up harder over each block as it breaks',
    effect: (d, r) => { d.yieldBonus += 0.20 * r; },
  },
  {
    id: 'foresight', name: 'FORESIGHT', doctrine: 'ledger', tier: 1,
    max: 4, base: 260, growth: 2.0,
    req: s => doc(s, 'ledger') >= 3,
    line: r => `every market tool arrives ${(2 * r)} depths earlier than it otherwise would`,
    visual: 'unlocked panels appear ahead of their usual depth, marked as brought forward',
    effect: (d, r) => { d.revealShift += 2 * r; },
  },
  {
    id: 'forward', name: 'FORWARD', doctrine: 'ledger', tier: 2,
    max: Infinity, base: 300, growth: 1.44,
    req: s => doc(s, 'ledger') >= 5,
    line: r => `forward sales pay ${(15 * r)}% more and you can carry ${(35 * r)}% more of them at once`,
    visual: 'open consignments list with a fatter payout column and more open slots',
    effect: (d, r) => { d.forward += 0.15 * r; },
  },
  {
    id: 'refinery', name: 'REFINERY', doctrine: 'ledger', tier: 2,
    max: Infinity, base: 320, growth: 1.44,
    req: s => doc(s, 'ledger') >= 5,
    line: r => `refining waives ${Math.min(90, 20 * r)}% of its fee and returns ${(10 * r)}% more`,
    visual: 'the refining panel shows the fee struck through and the output figure raised',
    effect: (d, r) => { d.refineFee += 0.20 * r; d.refineYield += 0.10 * r; },
  },
  {
    id: 'speculate', name: 'SPECULATE', doctrine: 'ledger', tier: 2,
    max: Infinity, base: 270, growth: 1.42,
    req: s => doc(s, 'ledger') >= 4,
    line: r => `+${(45 * r)}% damage while the market favours selling, and nothing while it does not`,
    visual: 'the launcher carries a bright market mark on a good turn and a dead one otherwise',
    effect: (d, r) => { d.speculate += 0.45 * r; },
  },
  {
    id: 'liquidity', name: 'LIQUIDITY', doctrine: 'ledger', tier: 2,
    max: Infinity, base: 280, growth: 1.42,
    req: s => doc(s, 'ledger') >= 4,
    line: r => `+${(30 * r)}% damage per order of magnitude of material you are still holding`,
    visual: 'held stock is drawn as weight on the launcher, heavier the more you sit on',
    effect: (d, r) => { d.liquidity += 0.30 * r; },
  },
  {
    id: 'hedge', name: 'HEDGE', doctrine: 'ledger', tier: 3,
    max: Infinity, base: 420, growth: 1.46,
    req: s => doc(s, 'ledger') >= 7,
    line: r => `+${(55 * r)}% damage while the market is against you, and nothing while it is not`,
    visual: 'the same market mark on the launcher, lit on exactly the turns SPECULATE is dark',
    effect: (d, r) => { d.hedge += 0.55 * r; },
  },
  {
    id: 'solvency', name: 'SOLVENCY', doctrine: 'ledger', tier: 3,
    max: Infinity, base: 440, growth: 1.46,
    req: s => doc(s, 'ledger') >= 7,
    line: r => `+${(30 * r)}% damage per order of magnitude of cash on hand, so spending it costs you strength`,
    visual: 'the cash readout is ringed, and the ring thins as the balance is spent down',
    effect: (d, r) => { d.solvency += 0.30 * r; },
  },

  // -- TITHE ----------------------------------------------------------------
  // The support axis. No build wins on it alone and every build wants some of
  // it, which is what makes it the interesting greed decision each depth.

  {
    id: 'harvest', name: 'HARVEST', doctrine: 'tithe', tier: 0,
    max: Infinity, base: 48, growth: 1.34,
    line: r => `+${(30 * r)}% essence from destroyed blocks`,
    visual: 'essence payouts print larger over the block that paid them',
    effect: (d, r) => { d.harvest += 0.30 * r; },
  },
  {
    id: 'survey', name: 'SURVEY', doctrine: 'tithe', tier: 1,
    max: 3, base: 190, growth: 2.4,
    req: s => doc(s, 'tithe') >= 2,
    line: r => `+1 option in every hand and +${r} free reroll each depth`,
    visual: 'an extra card slot appears in the choice row',
    effect: (d, r) => { d.slots += r; d.freeRerolls += r; },
  },
  {
    id: 'scavenge', name: 'SCAVENGE', doctrine: 'tithe', tier: 1,
    max: Infinity, base: 130, growth: 1.36,
    req: s => doc(s, 'tithe') >= 2,
    line: r => `pickups are worth ${(1 + r)}x`,
    visual: 'pickups draw with a heavier ring the more they are worth',
    effect: (d, r) => { d.scavenge += r; },
  },
  {
    id: 'melt', name: 'MELT', doctrine: 'tithe', tier: 1,
    max: Infinity, base: 135, growth: 1.36,
    req: s => doc(s, 'tithe') >= 2,
    line: r => `dump material straight into essence at a flat ${(0.30 + 0.10 * r).toFixed(2)} per unit - worse than selling it well, and it never asks you to read a price`,
    visual: 'a melt action on the material panel that prints one flat figure with no quote beside it',
    effect: (d, r) => { d.melt += 0.30 + 0.10 * r; },
  },
  {
    id: 'interest', name: 'INTEREST', doctrine: 'tithe', tier: 2,
    max: Infinity, base: 300, growth: 1.44,
    req: s => doc(s, 'tithe') >= 4,
    line: r => `unspent essence grows ${(3 * r)}% every turn`,
    visual: 'the essence readout ticks upward on its own between turns',
    effect: (d, r) => { d.interest += 0.03 * r; },
  },
  {
    id: 'duty', name: 'DUTY', doctrine: 'tithe', tier: 2,
    max: 4, base: 340, growth: 2.0,
    req: s => doc(s, 'tithe') >= 4,
    line: r => `powers in your most-invested doctrine cost ${(12 * r)}% less`,
    visual: 'discounted options are marked in their doctrine color',
    effect: (d, r) => { d.duty += 0.12 * r; },
  },
  {
    id: 'augury', name: 'AUGURY', doctrine: 'tithe', tier: 3,
    max: 1, base: 700, growth: 3,
    req: s => doc(s, 'tithe') >= 8,
    line: () => 'the hand you did not take carries over instead of being redealt',
    visual: 'carried options are drawn dimmed until the depth they were held from passes',
    effect: d => { d.augury = true; },
  },

  // -- KEYSTONES ------------------------------------------------------------
  // These only exist for players who committed hard to two doctrines at once.
  // Each one takes a thing that was linear and makes it feed itself.

  {
    id: 'shardstorm', name: 'SHARDSTORM', doctrine: 'legion', tier: 3, keystone: true,
    max: 1, base: 1500, growth: 3,
    req: s => doc(s, 'legion') >= 9 && doc(s, 'fracture') >= 7,
    line: () => 'a split no longer divides a body: both halves carry the whole stack',
    visual: 'the field fills with full-size bodies where there was one, each hitting as hard as the parent',
    effect: d => { d.splitKeepsStack = true; },
  },
  {
    id: 'spawntide', name: 'SPAWNTIDE', doctrine: 'legion', tier: 3, keystone: true,
    max: Infinity, base: 1300, growth: 1.7,
    req: s => doc(s, 'legion') >= 8 && doc(s, 'well') >= 6,
    line: r => `at the end of a turn the swarm grows ${(0.5 * r).toFixed(1)}% for every block the turn destroyed`,
    visual: 'the swarm band surges once, sized to the turn, as the field settles',
    effect: (d, r) => { d.spawntide += 0.005 * r; },
  },
  {
    id: 'spall', name: 'SPALL', doctrine: 'monolith', tier: 3, keystone: true,
    max: Infinity, base: 1250, growth: 1.7,
    req: s => doc(s, 'monolith') >= 8 && doc(s, 'legion') >= 6,
    line: r => `+${r} bodies for every order of magnitude of damage a single ball deals`,
    visual: 'heavier bodies shed splinters that become bodies of their own on launch',
    effect: (d, r) => { d.spall += r; },
  },
  {
    id: 'horizon', name: 'EVENT HORIZON', doctrine: 'well', tier: 3, keystone: true,
    max: 1, base: 1600, growth: 3,
    req: s => doc(s, 'well') >= 8 && doc(s, 'monolith') >= 7,
    line: () => 'orbit strikes count as bounces, so a captured body keeps compounding for as long as it circles',
    visual: 'an orbiting body brightens continuously through its ring instead of holding steady',
    effect: d => { d.eventHorizon = true; },
  },
  {
    id: 'gleaning', name: 'GLEANING', doctrine: 'fracture', tier: 3, keystone: true,
    max: 1, base: 1100, growth: 3,
    req: s => doc(s, 'fracture') >= 7 && doc(s, 'tithe') >= 5,
    line: () => 'blocks killed by arcs and detonations pay full essence instead of a fraction',
    visual: 'chain kills print their essence in full rather than dimmed',
    effect: d => { d.gleaning = true; },
  },
  {
    id: 'monopoly', name: 'MONOPOLY', doctrine: 'ledger', tier: 3, keystone: true,
    max: 1, base: 1700, growth: 3,
    req: s => doc(s, 'ledger') >= 9 && doc(s, 'tithe') >= 5,
    line: () => 'your sales stop moving the book against you: size no longer costs you price, at any size',
    visual: 'the book depth bar stops draining as a sale fills, however large the sale is',
    effect: d => { d.monopoly = true; },
  },
  {
    id: 'corner', name: 'CORNER', doctrine: 'ledger', tier: 3, keystone: true,
    max: Infinity, base: 1450, growth: 1.7,
    req: s => doc(s, 'ledger') >= 8 && doc(s, 'legion') >= 6,
    line: r => `material yield rises ${(18 * r)}% per order of magnitude of swarm, so the horde works the seams as well as the field`,
    visual: 'material payouts scale with the swarm band rather than with the block that paid them',
    effect: (d, r) => { d.corner += 0.18 * r; },
  },
  {
    id: 'requisition', name: 'REQUISITION', doctrine: 'monolith', tier: 3, keystone: true,
    max: Infinity, base: 1150, growth: 1.7,
    req: s => doc(s, 'monolith') >= 7 && doc(s, 'tithe') >= 5,
    line: r => `+${(12 * r)}% damage per order of magnitude of essence spent this run`,
    visual: 'the launcher core is ringed by a band that thickens as the run total climbs',
    effect: (d, r) => { d.requisition += 0.12 * r; },
  },
];

const POWERS = {};
for (const p of POWER_LIST) POWERS[p.id] = p;

// Scaling helpers used by the instant-effect powers. Both stay relevant at any
// depth because they are anchored to what the player already has, not to a
// fixed table.
function standingFill(r) {
  let total = 0;
  for (let i = 1; i <= r; i++) total += 0.04 + 0.01 * i;
  return total;
}
function conscriptGain(s, r) {
  const flat = big(4 * Math.pow(1.85, Math.max(0, r - 1)));
  return bmax(flat, bmul(s.swarm, big(0.09)));
}
function sharpenGain(s, r) {
  // Each rank is worth more than the last, and the whole line is anchored to
  // the depth it was bought at so a late rank is not a rounding error.
  return big(Math.pow(1.55, r) * (1 + (s.meta.depthAt[`sharpen:${r}`] || 0) * 0.6));
}
function crucibleGain(s, r, burnedOverride) {
  const burned = burnedOverride || bmul(s.swarm, big(0.4));
  // Sub-linear on purpose: burning the swarm is a real trade, not free damage.
  return bmul(bpow(burned, 0.85), big(0.6 + 0.12 * r));
}


// ---------------------------------------------------------------------------
// ECHOES - endless generated options
//
// The authored list runs out; the run does not. Once the pool cannot fill a
// hand with things the player has not maxed out, it starts minting echoes:
// single-rank fragments of a doctrine whose magnitude is set by the depth they
// were found at. They are stored as plain data and applied through a switch,
// so a saved state is still just JSON.
// ---------------------------------------------------------------------------

const ECHO_KEYS = {
  legion: [
    { key: 'e_growth', label: 'growth', word: 'MULTITUDE', mag: 0.02, line: m => `the swarm grows a further ${(m * 100).toFixed(1)}% per turn` },
    { key: 'e_bodies', label: 'bodies', word: 'BROOD', mag: 3, line: m => `+${Math.round(m)} bodies on the field` },
    { key: 'e_spoils', label: 'spoils', word: 'HARVESTING', mag: 0.04, line: m => `+${m.toFixed(2)} swarm per block destroyed` },
    { key: 'e_swarm', label: 'levy', word: 'CONSCRIPTION', mag: 0.5, line: m => `the swarm is ${(1 + m).toFixed(2)}x larger, immediately` },
  ],
  monolith: [
    { key: 'e_mult', label: 'damage', word: 'ATTRITION', mag: 0.35, line: m => `x${(1 + m).toFixed(2)} damage` },
    { key: 'e_momentum', label: 'momentum', word: 'INERTIA', mag: 0.02, line: m => `+${(m * 100).toFixed(1)}% damage per bounce already made` },
    { key: 'e_sunder', label: 'sunder', word: 'BREACH', mag: 0.4, line: m => `+${(m * 100).toFixed(0)}% damage against blocks at full health` },
  ],
  fracture: [
    { key: 'e_arc', label: 'arc', word: 'SPLINTER', mag: 1, line: m => `+${Math.round(m)} arc target${Math.round(m) === 1 ? '' : 's'} per impact` },
    { key: 'e_deto', label: 'detonation', word: 'RUPTURE', mag: 0.3, line: m => `+${(m * 100).toFixed(0)}% detonation damage` },
    { key: 'e_split', label: 'split', word: 'CLEAVING', mag: 1, line: m => `+${Math.round(m)} split charge${Math.round(m) === 1 ? '' : 's'} per body` },
  ],
  well: [
    { key: 'e_pull', label: 'pull', word: 'DRAG', mag: 0.04, line: m => `+${(m * 100).toFixed(0)}% steering toward blocks` },
    { key: 'e_orbit', label: 'orbit', word: 'CAPTURE', mag: 0.05, line: m => `+${(m * 100).toFixed(0)}% chance an impact captures the body into orbit` },
    { key: 'e_collapse', label: 'collapse', word: 'IMPLOSION', mag: 0.02, line: m => `the end-of-turn implosion deals a further ${(m * 100).toFixed(1)}% of the turn` },
  ],
  tithe: [
    { key: 'e_harvest', label: 'essence', word: 'RECKONING', mag: 0.25, line: m => `+${(m * 100).toFixed(0)}% essence from destroyed blocks` },
    { key: 'e_interest', label: 'interest', word: 'USURY', mag: 0.02, line: m => `unspent essence grows a further ${(m * 100).toFixed(1)}% per turn` },
  ],
};

const ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH',
  'ELEVENTH', 'TWELFTH', 'THIRTEENTH', 'FOURTEENTH', 'FIFTEENTH', 'SIXTEENTH'];

function echoName(index, word) {
  const o = index < ORDINALS.length ? ORDINALS[index] : `${index + 1}TH`;
  return `${o} ${word}`;
}

function mintEcho(state, rnd, depth) {
  const docs = Object.keys(ECHO_KEYS);
  // Weight toward what the player is already building, so an echo reinforces a
  // build instead of scattering it.
  let pick = docs[Math.floor(rnd() * docs.length)];
  let best = -1;
  for (const dId of docs) {
    const w = (doc(state, dId) + 1) * rnd();
    if (w > best) { best = w; pick = dId; }
  }
  const tmpl = ECHO_KEYS[pick][Math.floor(rnd() * ECHO_KEYS[pick].length)];
  const scale = 1 + depth / 30;
  const mag = tmpl.mag * scale * (0.8 + rnd() * 0.6);
  const n = state.meta.echoCount++;
  // Priced off how many echoes the player has actually absorbed, not off how
  // many have been minted, so the line keeps climbing for as long as the run
  // does and browsing costs nothing.
  const held = state.meta.echoesOwned || 0;
  const rec = {
    id: `echo:${tmpl.key}:${n}`,
    name: echoName(n % 16, tmpl.word),
    doctrine: pick,
    key: tmpl.key,
    mag,
    tier: 2,
    echo: true,
    cost: bmul(big(210 * Math.pow(1.34, held)), bpow(big(dial(state, 'costDepth')), depth)),
    line: tmpl.line(mag),
    visual: DOCTRINES[pick].reads,
  };
  state.echoPool[rec.id] = rec;
  return rec;
}

function applyEcho(d, rec, state) {
  const m = rec.mag;
  switch (rec.key) {
    case 'e_growth': d.growth += m; break;
    case 'e_bodies': d.bodyCap += Math.round(m); break;
    case 'e_spoils': d.spoils += m; break;
    case 'e_swarm': break; // instant, handled at purchase
    case 'e_mult': d.mult = bmul(d.mult, big(1 + m)); break;
    case 'e_momentum': d.momentum += m; break;
    case 'e_sunder': d.sunder += m; break;
    case 'e_arc': d.arcTargets += Math.round(m); break;
    case 'e_deto': d.detonate += m; break;
    case 'e_split': d.splits += Math.round(m); break;
    case 'e_pull': d.pull += m; break;
    case 'e_orbit': d.orbitChance += m; if (!d.orbitTicks) d.orbitTicks = 44; break;
    case 'e_collapse': d.collapse += m; break;
    case 'e_harvest': d.harvest += m; break;
    case 'e_interest': d.interest += m; break;
  }
}


// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

/**
 * Create a run state. Plain data throughout - JSON round-trips cleanly, which
 * is what lets a headless run replay a real one.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed]    reproducible run seed
 * @param {number} [opts.swarm]   starting swarm count
 * @param {number} [opts.essence] starting essence
 * @param {object} [opts.tier]    selected difficulty tier; see setTier()
 * @returns {object} state
 */
function createState(opts) {
  opts = opts || {};
  const state = {
    seed: (opts.seed == null ? (Date.now() & 0x7fffffff) : opts.seed) >>> 0,
    tier: opts.tier || null,   // selected difficulty; null uses the TUNING defaults
    depth: 1,
    swarm: big(opts.swarm == null ? 1 : opts.swarm),
    essence: big(opts.essence || 0),
    ranks: {},
    echoPool: {},          // generated echoes that have been offered
    doctrinePoints: { legion: 0, monolith: 0, fracture: 0, well: 0, ledger: 0, tithe: 0 },
    acquired: { heft: ZERO, spoilsPool: 0, temperPool: 0 },
    meta: {
      taken: 0,
      spent: ZERO,
      rerolls: 0,
      rerollsThisDepth: 0,
      offerDepth: 0,
      echoCount: 0,
      echoesOwned: 0,
      seen: {},            // ids the player has been shown at least once
      depthAt: {},         // where a given rank was purchased, for scaling
      held: null,          // the hand currently dealt, with ranks as dealt
      carry: null,         // options AUGURY is carrying into the next depth
    },
    turn: freshTurn(),
    derived: null,
    offerCache: null,
  };
  recompute(state);
  return state;
}

function freshTurn() {
  return {
    index: 0,
    destroyed: 0,
    damage: ZERO,
    essence: ZERO,
    spawned: 0,
    pressureMult: 1,
    reqMult: 1,
    marketMult: 1,
    market: null,
    fxBudget: TUNING.fxBudget,
    plan: null,
  };
}

/**
 * Flatten every owned power into state.derived. Called automatically by
 * apply(); call it directly only if you mutate state.ranks yourself.
 */
function recompute(state) {
  if (state.acquired && state.acquired.temperPool == null) state.acquired.temperPool = 0;
  const points = { legion: 0, monolith: 0, fracture: 0, well: 0, ledger: 0, tithe: 0 };
  const d = baseDerived(state);

  // First pass tallies commitment, second pass spends it. Powers that scale
  // off how deep their own doctrine runs need the totals to already exist.
  for (const id in state.ranks) {
    const r = state.ranks[id];
    if (!r) continue;
    const def = POWERS[id] || state.echoPool[id];
    if (!def) continue;
    points[def.doctrine] = (points[def.doctrine] || 0) + r;
  }
  state.doctrinePoints = points;

  for (const id in state.ranks) {
    const r = state.ranks[id];
    if (!r) continue;
    const def = POWERS[id] || state.echoPool[id];
    if (!def) continue;
    if (def.echo) applyEcho(d, def, state);
    else if (def.effect) def.effect(d, r, state);
  }

  d.flat = badd(d.flat, state.acquired.heft);

  let top = null, topN = 0;
  for (const k in points) if (points[k] > topN) { topN = points[k]; top = k; }
  d.dominant = topN > 0 ? top : null;

  state.doctrinePoints = points;
  state.derived = d;
  return d;
}

/** Damage one real ball deals on a clean impact, before per-turn and per-body factors. */
function perBallDamage(state) {
  const d = state.derived;
  return bmul(d.flat, d.mult);
}

/** The swarm count as a magnitude. */
function swarmCount(state) { return state.swarm; }

/**
 * A readable description of the swarm's size, for the header and the run
 * summary. Pure text; the caller decides how to draw it.
 */
function describeSwarm(state) {
  const n = blog10(state.swarm);
  const tiers = [
    [0.7, 'alone'], [1.1, 'a handful'], [1.6, 'a pack'], [2.4, 'a mob'],
    [3.4, 'a horde'], [4.4, 'a legion'], [6, 'a tide'], [9, 'a plague'],
    [12, 'an ocean'], [18, 'uncountable'],
  ];
  let word = 'beyond counting';
  for (const [lim, w] of tiers) if (n < lim) { word = w; break; }
  const plan = state.turn.plan;
  return {
    count: state.swarm,
    text: fmt(state.swarm),
    word,
    bodies: plan ? plan.bodies : bodyCapOf(state),
    stackPer: plan ? plan.bodyStack : ONE,
  };
}


// ---------------------------------------------------------------------------
// DIFFICULTY TIERS
//
// This module never decides how hard the game is. It reads the numbers off
// state.tier when one is set and falls back to TUNING when one is not, so a
// selected tier - and the endless stretch past the end of a tier's authored
// run - drives health, cost and payout without this module knowing anything
// about how tiers are chosen or what they are called.
// ---------------------------------------------------------------------------

/** Read a scaling dial: the tier's value if it sets one, otherwise the default. */
function dial(state, key) {
  const t = state && state.tier;
  return t && t[key] != null ? t[key] : TUNING[key];
}

/**
 * Attach or replace the difficulty tier. Any subset of the TUNING scaling keys
 * is honoured: hpBase, hpRamp, hpGrowth, endlessFrom, endlessGrowth,
 * essenceExp, essenceBase, costDepth, baseBodyCap, materialRate.
 *
 * @param {object} state
 * @param {object|null} tier plain data, kept on the state and serialized with it
 */
function setTier(state, tier) {
  state.tier = tier || null;
  state.offerCache = null;   // prices move with the tier
  return state.tier;
}

// ---------------------------------------------------------------------------
// FIELD SCALING
//
// Adopting hpFor() is what removes the content ceiling: block health tracks the
// same geometric curve that damage does, so there is never a depth where the
// authored numbers run out.
// ---------------------------------------------------------------------------

/** Block health at a given depth, as a magnitude. */
function hpFor(state, depth) {
  const d = depth == null ? state.depth : depth;
  const ramp = dial(state, 'hpRamp');
  let hp = big(1 + dial(state, 'hpBase') * d);
  if (d > ramp) hp = bmul(hp, bpow(big(dial(state, 'hpGrowth')), d - ramp));
  // Past the end of a tier's authored run, the endless stretch takes over.
  const endless = dial(state, 'endlessFrom');
  if (endless != null && d > endless) {
    hp = bmul(hp, bpow(big(dial(state, 'endlessGrowth')), d - endless));
  }
  return bfloor(hp);
}

/**
 * Essence a destroyed block pays out.
 * @param {object} state
 * @param {object} block  {c, r, hp, max}
 * @param {string} [cause] 'impact' | 'arc' | 'detonate' | 'tether' | 'orbit' | 'collapse'
 */
function essenceFor(state, block, cause) {
  const d = state.derived;
  const maxHp = bmax(big(block && block.max != null ? block.max : 1), ONE);
  let e = bmul(bpow(maxHp, dial(state, 'essenceExp')), big(dial(state, 'essenceBase')));
  e = bmul(e, big(1 + d.harvest));
  // Secondary kills pay a fraction until GLEANING closes the gap.
  const secondary = cause && cause !== 'impact';
  if (secondary && !d.gleaning) e = bmul(e, big(0.4));
  return e;
}

/**
 * Subtract damage from a block. Works whether the caller stores hp as a plain
 * number or as a magnitude, and reports whether the block died.
 * @returns {{dead: boolean, hp: (number|object), overkill: object}}
 */
function applyDamage(state, block, dmg) {
  dmg = big(dmg);
  if (typeof block.hp === 'number') {
    const n = bnum(dmg);
    block.hp = n === Infinity ? -1 : block.hp - n;
    return { dead: block.hp <= 0, hp: block.hp, overkill: block.hp < 0 ? big(-block.hp) : ZERO };
  }
  block.hp = bsub(big(block.hp), dmg);
  const dead = bcmp(block.hp, ZERO) <= 0;
  return { dead, hp: block.hp, overkill: dead ? bneg(block.hp) : ZERO };
}

function hpFraction(block) {
  if (!block || block.max == null) return 1;
  const hp = typeof block.hp === 'number' ? block.hp : bnum(block.hp);
  const mx = typeof block.max === 'number' ? block.max : bnum(block.max);
  if (!(mx > 0)) return 1;
  return Math.max(0, Math.min(1, hp / mx));
}


// ---------------------------------------------------------------------------
// THE MARKET SEAM
//
// This module never imports the market layer and never touches an order book.
// It reads an optional snapshot the caller hands in on ctx, and it publishes
// the modifiers the market layer should apply. Both directions are plain data,
// so either module runs without the other.
//
// The snapshot, all fields optional:
//
//   ctx.market = {
//     favour:    -1..1   how good this stretch is for selling right now
//     inventory: number|magnitude   material held and not yet sold, in bulk units
//     cash:      number|magnitude   spendable balance
//     regime:    string  name of the current regime, for display only
//   }
//
// A missing snapshot reads as a flat, neutral market, so a build with no trade
// powers is completely unaffected by whether a market exists at all.
// ---------------------------------------------------------------------------

function readMarket(ctx) {
  const m = (ctx && ctx.market) || null;
  return {
    favour: m && typeof m.favour === 'number' ? Math.max(-1, Math.min(1, m.favour)) : 0,
    inventory: m ? big(m.inventory) : ZERO,
    cash: m ? big(m.cash) : ZERO,
    regime: (m && m.regime) || null,
  };
}

/**
 * The turn-constant damage multiplier the market powers are worth right now.
 * Resolved once, when the turn opens - a turn never re-reads the market, so
 * nothing about trading asks the player to act while the swarm is working.
 */
function marketMultiplier(state, snap) {
  const d = state.derived;
  let m = 1;
  if (d.speculate > 0) m *= 1 + d.speculate * Math.max(0, snap.favour);
  if (d.hedge > 0) m *= 1 + d.hedge * Math.max(0, -snap.favour);
  if (d.liquidity > 0) m *= 1 + d.liquidity * Math.max(0, blog10(badd(snap.inventory, big(10))) - 1);
  if (d.solvency > 0) m *= 1 + d.solvency * Math.max(0, blog10(badd(snap.cash, big(10))) - 1);
  return m;
}

/**
 * What the market layer should apply on the player's behalf. Pure data - this
 * module does no trading itself.
 *
 * `slippageMult` is the one the market layer should reach for: multiply the
 * price concession a sale would otherwise suffer by it. It falls toward zero
 * without ever going negative, so a sale can approach the quoted price but
 * never beat it.
 *
 * @returns {{fillBonus, slippageMult, bookDepthMult, revealShift,
 *            forwardPayoutMult, forwardCapacityMult, refineFeeMult,
 *            refineYieldMult, yieldMult, coverPenaltyMult, noBookImpact,
 *            cornerPerDecade}}
 */
function tradeMods(state) {
  const d = state.derived;
  return {
    fillBonus: d.fill,                               // raw, for display
    slippageMult: d.monopoly ? 0 : 1 / (1 + d.fill), // multiply the book's price concession by this
    bookDepthMult: 1 + d.book,                       // effective depth, so size costs less price
    revealShift: d.revealShift,                      // depths earlier every tool arrives
    forwardPayoutMult: 1 + d.forward,
    forwardCapacityMult: 1 + d.forward * 2.33,
    refineFeeMult: Math.max(0.10, 1 - d.refineFee),
    refineYieldMult: 1 + d.refineYield,
    yieldMult: 1 + d.yieldBonus,
    coverPenaltyMult: Math.max(0.15, 1 - d.coverCut),
    noBookImpact: !!d.monopoly,                      // a sale stops moving the book at all
    cornerPerDecade: d.corner,                       // yield growth per decade of swarm
  };
}

/**
 * Material a destroyed block should pay, as a multiplier on whatever the market
 * layer already computes. CORNER folds the swarm's size into the yield, which
 * is the one place the count build and the trade build feed each other.
 */
function yieldMult(state) {
  const d = state.derived;
  let m = 1 + d.yieldBonus;
  if (d.corner > 0) m *= 1 + d.corner * Math.max(0, blog10(badd(state.swarm, big(10))) - 1);
  return m;
}

/**
 * Cash from dumping material without trading it: flat, immediate, and worse
 * than selling it properly. Zero without MELT, which is the point - the crude
 * route has to be bought like anything else.
 *
 * @param {number|object} units bulk material units
 */
function meltYield(state, units) {
  const d = state.derived;
  if (d.melt <= 0) return ZERO;
  return bmul(big(units), big(d.melt));
}

// ---------------------------------------------------------------------------
// OFFERS
//
// offer() is idempotent for a given (depth, reroll count) so the caller can
// poll it every frame while repainting. Buying from a hand does not redeal it -
// the option stays, at its new rank and new price, so a player who is saving up
// can plan. A new hand arrives with the next depth.
// ---------------------------------------------------------------------------

function tierOpen(state, tier) {
  return state.meta.taken >= (TIER_GATE[tier] == null ? Infinity : TIER_GATE[tier]);
}

function eligible(state, def) {
  const r = rank(state, def.id);
  if (r >= (def.max == null ? Infinity : def.max)) return false;
  if (!tierOpen(state, def.tier)) return false;
  if (def.req && !def.req(state)) return false;
  return true;
}

/** Price of the next rank of a power, after discounts. */
function costOf(state, id, depth) {
  const dep = depth == null ? state.depth : depth;
  const echo = state.echoPool[id];
  if (echo) return echo.cost;
  const def = POWERS[id];
  if (!def) return INF;
  const r = rank(state, id);
  let c = bmul(big(def.base * Math.pow(def.growth, r)), bpow(big(dial(state, 'costDepth')), dep));
  const d = state.derived;
  if (d.duty > 0 && d.dominant === def.doctrine) c = bmul(c, big(Math.max(0.4, 1 - d.duty)));
  return bfloor(c);
}

function canAfford(state, id, depth) {
  return bgte(state.essence, costOf(state, id, depth));
}

function slotCount(state) {
  const base = 2 + Math.floor(state.meta.taken / 5);
  return Math.min(5, base) + state.derived.slots;
}

function rerollCost(state, depth) {
  const dep = depth == null ? state.depth : depth;
  if (state.meta.rerollsThisDepth < state.derived.freeRerolls) return ZERO;
  const n = state.meta.rerollsThisDepth - state.derived.freeRerolls;
  return bfloor(bmul(
    big(TUNING.rerollBase * Math.pow(TUNING.rerollGrowth, Math.max(0, n))),
    bpow(big(dial(state, 'costDepth')), dep)
  ));
}

function buildHand(state, depth, prefill) {
  const rnd = mulberry32(hash3(state.seed, depth, state.meta.rerolls * 31 + 7));
  const want = slotCount(state);

  const carried = {};
  const hand = [];
  if (prefill) {
    for (const def of prefill) {
      if (hand.length >= want || carried[def.id]) continue;
      carried[def.id] = true;
      hand.push(def);
    }
  }

  const pool = [];
  for (const def of POWER_LIST) {
    if (carried[def.id]) continue;
    if (!eligible(state, def)) continue;
    // Investment bias: what you are building shows up more, but never to the
    // exclusion of everything else.
    let w = 1 + doc(state, def.doctrine) * 0.22;
    if (def.keystone) w *= 7;                    // a keystone that has unlocked demands to be seen
    if (rank(state, def.id) === 0) w *= 1.35;    // new options edge out repeats
    if (def.tier === 0 && state.meta.taken > 10) w *= 0.5;
    pool.push({ def, w });
  }

  const used = {};

  // One slot is held for a doctrine the player has not invested in, so a pivot
  // is always physically possible and no run is locked in by turn six.
  if (hand.length < want && want >= 3 && state.meta.taken >= 3) {
    const strangers = pool.filter(p => doc(state, p.def.doctrine) === 0);
    if (strangers.length) {
      const pickIdx = Math.floor(rnd() * strangers.length);
      const s = strangers[pickIdx];
      used[s.def.id] = true;
      hand.push(s.def);
    }
  }

  while (hand.length < want) {
    const avail = pool.filter(p => !used[p.def.id]);
    if (!avail.length) break;
    let total = 0;
    for (const p of avail) total += p.w;
    let roll = rnd() * total;
    let chosen = avail[avail.length - 1];
    for (const p of avail) { roll -= p.w; if (roll <= 0) { chosen = p; break; } }
    used[chosen.def.id] = true;
    hand.push(chosen.def);
  }

  // The authored pool cannot fill the hand: mint echoes for the rest.
  while (hand.length < want) hand.push(mintEcho(state, rnd, depth));

  // Past the point where the authored list has stopped surprising anyone, the
  // pool starts minting anyway, more often the deeper the run goes. Ranked
  // powers already scale without a ceiling; this is what keeps the CHOICE from
  // going stale, so a hand at depth 400 is not the same hand as at depth 40.
  if (state.meta.taken >= ECHO_AFTER && hand.length) {
    const chance = Math.min(0.5, 0.10 + depth / 320);
    if (rnd() < chance) {
      // Displace an ordinary option, never a keystone the player unlocked.
      let idx = -1;
      for (let i = hand.length - 1; i >= 0; i--) if (!hand[i].keystone) { idx = i; break; }
      if (idx >= 0) hand[idx] = mintEcho(state, rnd, depth);
    }
  }

  return hand;
}

/**
 * The choices to present right now.
 *
 * @param {object} state
 * @param {number} [depth] defaults to state.depth; passing it also syncs state
 * @returns {{
 *   depth: number,
 *   slots: Array<{id, name, doctrine, tint, line, visual, rank, cost, costText,
 *                 affordable, keystone, echo, isNew}>,
 *   essence: object, essenceText: string,
 *   rerollCost: object, rerollFree: boolean, canReroll: boolean,
 *   swarm: object, damage: object
 * }}
 */
function offer(state, depth) {
  const dep = depth == null ? state.depth : depth;
  if (dep !== state.depth) state.depth = dep;

  if (state.meta.offerDepth !== dep) {
    // A new depth deals a new hand. AUGURY carries the options that were passed
    // on into it - the ones already bought are spent, and the rest of the hand
    // is dealt fresh, so the stream of new options never dries up.
    const prev = state.meta.held;
    const holding = state.derived.augury && prev && prev.depth === dep - 1;
    state.meta.offerDepth = dep;
    state.meta.rerollsThisDepth = 0;
    state.offerCache = null;
    state.meta.carry = holding
      ? prev.ids.filter(id => rank(state, id) === (prev.ranks ? prev.ranks[id] : -1))
      : null;
    state.meta.held = null;
  }

  const key = `${dep}:${state.meta.rerolls}`;
  if (!state.offerCache || state.offerCache.key !== key) {
    let prefill = null;
    if (state.meta.carry && state.meta.carry.length) {
      prefill = state.meta.carry
        .map(id => POWERS[id] || state.echoPool[id])
        .filter(d => d && (d.echo ? !rank(state, d.id) : eligible(state, d)));
    }
    const defs = buildHand(state, dep, prefill);
    const ranks = {};
    for (const d of defs) ranks[d.id] = rank(state, d.id);
    state.offerCache = { key, ids: defs.map(d => d.id) };
    state.meta.held = { depth: dep, ids: state.offerCache.ids, ranks };
    for (const id of state.offerCache.ids) state.meta.seen[id] = true;
  }

  const slots = state.offerCache.ids.map(id => {
    const def = POWERS[id] || state.echoPool[id];
    const r = rank(state, id);
    const cost = costOf(state, id, dep);
    return {
      id,
      name: def.name,
      doctrine: def.doctrine,
      tint: DOCTRINES[def.doctrine].tint,
      line: def.echo ? def.line : def.line(r + 1, state),
      visual: def.visual,
      rank: r,
      maxed: r >= (def.max == null ? Infinity : def.max),
      cost,
      costText: fmt(cost),
      costMaterial: costInMaterial(state, id, dep),
      costMaterialText: fmt(costInMaterial(state, id, dep)),
      affordable: bgte(state.essence, cost),
      keystone: !!def.keystone,
      echo: !!def.echo,
      isNew: r === 0,
    };
  });

  const rc = rerollCost(state, dep);
  return {
    depth: dep,
    slots,
    essence: state.essence,
    essenceText: fmt(state.essence),
    rerollCost: rc,
    rerollFree: bzero(rc),
    canReroll: bzero(rc) || bgte(state.essence, rc),
    swarm: state.swarm,
    damage: perBallDamage(state),
  };
}

/**
 * The same power priced on the other rail: bulk material units instead of cash.
 * A player who trades well pays this; a player who never touches the market
 * pays costOf() in cash. Neither rail is a discount on the other by default -
 * LEDGER makes the material rail cheap, MELT and TEMPER make the cash rail
 * reachable without ever reading a price.
 */
function costInMaterial(state, id, depth) {
  const cash = costOf(state, id, depth);
  const rate = dial(state, 'materialRate') || TUNING.materialRate;
  return bfloor(bdiv(cash, big(rate)));
}

/**
 * Take a power from the current hand.
 *
 * Two rails. The default deducts cash from state.essence. Passing
 * `{ rail: 'material' }` means the caller has already taken the material from
 * its own inventory (this module does not hold one) and just wants the power
 * granted; the cash-equivalent is still recorded as spend so that anything
 * keyed to lifetime outlay stays honest across both rails.
 *
 * @param {object} state
 * @param {string} id
 * @param {object} [opts]
 * @param {'cash'|'material'|'free'} [opts.rail] how it was paid for
 * @returns {{ok: boolean, reason?: string, id?: string, rank?: number,
 *            spent?: object, rail?: string, fx?: Array}}
 */
function apply(state, id, opts) {
  const def = POWERS[id] || state.echoPool[id];
  if (!def) return { ok: false, reason: 'unknown' };

  const r = rank(state, id);
  if (r >= (def.max == null ? Infinity : def.max)) return { ok: false, reason: 'maxed' };

  const rail = (opts && opts.rail) || 'cash';
  const cost = costOf(state, id, state.depth);
  if (rail === 'cash' && !bgte(state.essence, cost)) return { ok: false, reason: 'essence' };

  if (rail === 'cash') state.essence = bsub(state.essence, cost);
  if (rail !== 'free') state.meta.spent = badd(state.meta.spent, cost);
  state.ranks[id] = r + 1;
  state.meta.taken++;
  state.meta.depthAt[`${id}:${r + 1}`] = state.depth;

  let fx = [];
  if (def.echo) state.meta.echoesOwned = (state.meta.echoesOwned || 0) + 1;
  if (def.echo && def.key === 'e_swarm') {
    const gain = bmul(state.swarm, big(def.mag));
    state.swarm = badd(state.swarm, gain);
    fx.push({ type: 'swarm', amount: gain, reason: id });
  } else if (def.onTake) {
    fx = def.onTake(state, r + 1) || [];
  }

  recompute(state);
  fx.push({ type: 'take', id, name: def.name, tint: DOCTRINES[def.doctrine].tint });
  return { ok: true, id, rank: r + 1, spent: cost, rail, fx };
}

/**
 * Redeal the hand. Free while SURVEY rerolls remain, then priced.
 * @returns {{ok: boolean, reason?: string, spent?: object}}
 */
function reroll(state) {
  const cost = rerollCost(state, state.depth);
  if (!bzero(cost) && !bgte(state.essence, cost)) return { ok: false, reason: 'essence' };
  state.essence = bsub(state.essence, cost);
  state.meta.spent = badd(state.meta.spent, cost);
  state.meta.rerolls++;
  state.meta.rerollsThisDepth++;
  state.meta.held = null;
  state.meta.carry = null;
  state.offerCache = null;
  return { ok: true, spent: cost };
}

/** Add essence from any source. */
function gainEssence(state, amount) {
  state.essence = badd(state.essence, amount);
  return state.essence;
}

/**
 * Everything the player has learned exists, for a full-run panel. Owned powers
 * first, then revealed-but-unbought, then a count of what is still hidden -
 * the system is legible in full to a deep player without ever being dumped on
 * a new one.
 */
function codex(state) {
  const owned = [], revealed = [], locked = [];
  for (const def of POWER_LIST) {
    const r = rank(state, def.id);
    const entry = {
      id: def.id, name: def.name, doctrine: def.doctrine,
      tint: DOCTRINES[def.doctrine].tint, rank: r,
      line: def.line(Math.max(1, r), state), visual: def.visual, keystone: !!def.keystone,
    };
    if (r > 0) owned.push(entry);
    else if (state.meta.seen[def.id] || eligible(state, def)) revealed.push(entry);
    else if (doc(state, def.doctrine) > 0) locked.push({ ...entry, line: null, name: null });
    else locked.push({ id: null, doctrine: null, tint: null, rank: 0 });
  }
  for (const id in state.echoPool) {
    const rec = state.echoPool[id];
    const r = rank(state, id);
    const entry = {
      id, name: rec.name, doctrine: rec.doctrine, tint: DOCTRINES[rec.doctrine].tint,
      rank: r, line: rec.line, visual: rec.visual, echo: true,
    };
    if (r > 0) owned.push(entry); else revealed.push(entry);
  }
  return {
    owned, revealed,
    hidden: locked.length,
    doctrines: Object.keys(DOCTRINES).map(k => ({
      ...DOCTRINES[k], points: doc(state, k), dominant: state.derived.dominant === k,
    })),
    taken: state.meta.taken,
    spent: state.meta.spent,
  };
}


// ---------------------------------------------------------------------------
// TURN EXECUTION
// ---------------------------------------------------------------------------

function bodyCapOf(state) {
  const d = state.derived;
  let cap = d.bodyCap + (dial(state, 'baseBodyCap') - TUNING.baseBodyCap);
  if (d.spall > 0) {
    const mag = Math.max(0, blog10(perBallDamage(state)));
    cap += Math.floor(mag * d.spall);
  }
  return Math.max(1, Math.min(TUNING.hardBodyCap, Math.floor(cap)));
}

/**
 * Open a turn. Decides how many circles actually get simulated and how much of
 * the swarm each one stands for, so an eight-figure swarm costs the same frame
 * budget as a two-figure one.
 *
 * @param {object} state
 * @param {object} [ctx]
 * @returns {{bodies, bodyStack, coreStack, hasCore, interval, speed, pressureMult, perBall}}
 */
function onTurnStart(state, ctx) {
  const d = state.derived;
  state.turn = freshTurn();
  const t = state.turn;
  t.index = state.depth;

  const cap = bodyCapOf(state);
  const countN = bnum(state.swarm);
  const bodies = Math.max(1, Math.min(cap, Math.floor(countN) || 1));

  // Damage from the sheer size of the swarm, independent of what any one body
  // is carrying. This is how a count build hurts without ever buying damage.
  t.pressureMult = 1 + d.pressure * Math.max(0, blog10(badd(state.swarm, big(10))));
  t.reqMult = d.requisition > 0
    ? 1 + d.requisition * Math.max(0, blog10(badd(state.meta.spent, big(10))))
    : 1;

  // The market is read here and nowhere else. Whatever it says now is what the
  // whole turn runs on, so leaning on it is a decision made before firing.
  t.market = readMarket(ctx);
  t.marketMult = marketMultiplier(state, t.market);

  let coreStack = ZERO, hasCore = false;
  let pool = state.swarm;
  if (d.singular > 0 && bodies > 1) {
    hasCore = true;
    coreStack = bmul(state.swarm, big(Math.min(0.75, d.singular)));
    pool = bsub(state.swarm, coreStack);
  }
  const spread = hasCore ? bodies - 1 : bodies;
  const bodyStack = bmax(bdiv(pool, big(Math.max(1, spread))), big(1e-9));

  // Denser swarms launch faster so a large turn does not become a long wait.
  const interval = Math.max(
    TUNING.minFireInterval,
    Math.round(TUNING.maxFireInterval - Math.min(3, Math.log10(Math.max(1, bodies)) * 1.4))
  );

  const plan = {
    bodies, bodyStack, coreStack, hasCore,
    interval,
    speed: TUNING.baseSpeed,
    pressureMult: t.pressureMult,
    marketMult: t.marketMult,
    market: t.market,
    perBall: perBallDamage(state),
  };
  t.plan = plan;
  return plan;
}

/**
 * Fields to merge onto a newly launched circle. The caller owns position and
 * velocity; everything here describes what the circle IS.
 *
 * @returns {{stack, base, pierce, splits, gen, bounces, orbit, homing, size, tint, core}}
 */
function onBallSpawn(state, index, plan) {
  const d = state.derived;
  const core = plan.hasCore && index === 0;
  const stack = core ? plan.coreStack : plan.bodyStack;
  const base = bmul(bmul(plan.perBall, stack), big(state.turn.reqMult * state.turn.marketMult));
  return {
    stack,
    base,                       // damage this body deals per clean impact
    pierce: d.pierce,
    splits: d.splits,
    splitGens: d.splitGens,
    gen: 0,
    bounces: 0,
    orbit: null,
    lensing: d.lensing,
    overrun: d.overrun,
    homing: d.pull,
    core,
    size: bodySize(stack, core),
    tint: bodyTint(state, core),
  };
}

function bodySize(stack, core) {
  const mag = Math.max(0, blog10(stack));
  return Math.min(5.5, 1 + mag * 0.30) * (core ? 2.4 : 1);
}
function bodyTint(state, core) {
  if (core) return DOCTRINES.monolith.tint;
  const dom = state.derived.dominant;
  return dom ? DOCTRINES[dom].tint : '#e6e9ef';
}

/**
 * Render hints for one live body. Pure data - size, colour, trail length and a
 * halo strength scaled to what it is carrying, so a stacked body is obviously
 * not an ordinary one.
 */
function ballStyle(state, ball) {
  const mag = Math.max(0, blog10(ball.stack || ONE));
  return {
    size: ball.size || bodySize(ball.stack || ONE, ball.core),
    tint: ball.tint || bodyTint(state, ball.core),
    halo: Math.min(1, mag / 8),
    trail: Math.min(18, 3 + ball.bounces * 0.5 + mag),
    heat: state.derived.momentum > 0
      ? Math.min(1, ball.bounces * state.derived.momentum / 3)
      : 0,
    orbiting: !!ball.orbit,
  };
}

/** Wall and floor bounces feed momentum, which is what makes a long turn pay. */
function onWallBounce(state, ball) {
  ball.bounces++;
  return null;
}


// -- damage resolution -------------------------------------------------------

function fxPush(state, list, ev) {
  if (state.turn.fxBudget <= 0) return;
  state.turn.fxBudget--;
  list.push(ev);
}

/**
 * Erosion: a block remembers how many times it has been struck this turn and
 * gives more each time. Target-local, so it cannot clear a field on its own -
 * it dissolves whatever the swarm has settled on.
 */
function strainMult(state, block) {
  const d = state.derived;
  if (d.erosion <= 0) return ONE;
  if (block._strainTurn !== state.turn.index) {
    block._strainTurn = state.turn.index;
    block._strain = 0;
  }
  const n = Math.min(block._strain, TUNING.strainCap);
  block._strain++;
  return n === 0 ? ONE : bpow(big(1 + d.erosion), n);
}

/**
 * Sympathy: a chain reaction feeds on what the turn has already killed, so the
 * last detonation of a long turn is worth many times the first. Applies only to
 * secondary damage, which is what keeps it a propagation engine rather than a
 * flat damage bonus.
 */
/**
 * Conduction: a crowded field carries a strike further, so a chain build gets
 * stronger exactly when it is losing ground. Bounded per turn by how many
 * blocks the field can physically hold, and unbounded in investment.
 */
function conductionMult(state, ctx) {
  const d = state.derived;
  if (d.conduction <= 0) return ONE;
  const n = Math.min((ctx && ctx.blocks ? ctx.blocks.length : 0), TUNING.conductionCap);
  return n === 0 ? ONE : bpow(big(1 + d.conduction), n);
}

function sympathyMult(state, half) {
  const d = state.derived;
  if (d.sympathy <= 0) return ONE;
  const n = Math.min(state.turn.destroyed, TUNING.sympathyCap);
  if (n === 0) return ONE;
  return bpow(big(1 + (half ? d.sympathy * 0.5 : d.sympathy)), n);
}

function gridDist(a, b) {
  const dc = a.c - b.c, dr = a.r - b.r;
  return Math.sqrt(dc * dc + dr * dr);
}

function nearestBlocks(blocks, from, n, exclude) {
  const out = [];
  for (const b of blocks) {
    if (b === from || (exclude && exclude.has(b))) continue;
    out.push({ b, d: gridDist(from, b) });
  }
  out.sort((x, y) => x.d - y.d);
  return out.slice(0, n).map(x => x.b);
}

function neighboursOf(blocks, block) {
  const out = [];
  for (const b of blocks) {
    if (b === block) continue;
    const dc = Math.abs(b.c - block.c), dr = Math.abs(b.r - block.r);
    if (dc + dr === 1 || (dc === 1 && dr === 1)) out.push(b);
  }
  return out;
}

/**
 * What one contact is worth and what else it touches.
 *
 * Mutates `ball.bounces` and `ball.pierce`. Returns damage instructions rather
 * than applying them, so the caller stays in control of block bookkeeping.
 * Most callers should use resolveImpact() instead, which drives the whole
 * cascade including detonation chains.
 *
 * @returns {{hits: Array<{block, damage, cause}>, reflect: boolean, capture: object|null, fx: Array}}
 */
function onHit(state, ball, block, ctx) {
  const d = state.derived, t = state.turn;
  const fx = [];

  let dmg = bmul(ball.base, big(t.pressureMult));
  if (d.momentum > 0 && ball.bounces > 0) {
    dmg = bmul(dmg, bpow(big(1 + d.momentum), ball.bounces));
  }
  if (d.sunder > 0) dmg = bmul(dmg, big(1 + d.sunder * hpFraction(block)));
  if (d.erosion > 0) dmg = bmul(dmg, strainMult(state, block));
  if (d.conduction > 0) dmg = bmul(dmg, conductionMult(state, ctx));
  if (d.sympathy > 0) dmg = bmul(dmg, sympathyMult(state, true));

  const hits = [{ block, damage: dmg, cause: 'impact' }];
  fxPush(state, fx, {
    type: 'impact', at: { c: block.c, r: block.r },
    mag: blog10(dmg), tint: ball.tint, size: ball.size,
  });

  // Arcs: the same contact reaches blocks the body never touched.
  if (d.arcTargets > 0) {
    const falloff = d.arcFalloff;
    const targets = nearestBlocks(ctx.blocks || [], block, d.arcTargets);
    const symp = sympathyMult(state);
    let carry = dmg;
    for (const tb of targets) {
      carry = d.resonance ? bmul(carry, big(d.resonanceAmp)) : bmul(carry, big(falloff));
      hits.push({ block: tb, damage: bmul(carry, symp), cause: 'arc' });
      fxPush(state, fx, {
        type: 'arc', from: { c: block.c, r: block.r }, at: { c: tb.c, r: tb.r },
        mag: blog10(carry), tint: DOCTRINES.fracture.tint, full: d.resonance,
      });
    }
  }

  // Capture into orbit: the body stops bouncing and starts grinding.
  let capture = null;
  if (d.orbitChance > 0 && !ball.orbit) {
    const seedA = ball.bounces * 97 + state.turn.destroyed;
    const seedB = block.c * 31 + block.r;
    if (hashUnit(state.seed, seedA, seedB) < d.orbitChance) {
      const ang = hashUnit(seedB, state.seed, seedA) * Math.PI * 2;
      capture = { block, ticks: d.orbitTicks, t: 0, angle: ang, radius: 0 };
      fxPush(state, fx, {
        type: 'orbit', at: { c: block.c, r: block.r }, tint: DOCTRINES.well.tint, ticks: d.orbitTicks,
      });
    }
  }

  let reflect = true;
  if (capture) reflect = false;
  else if (ball.pierce > 0) {
    ball.pierce--;
    reflect = false;
    fxPush(state, fx, { type: 'pierce', at: { c: block.c, r: block.r }, tint: DOCTRINES.fracture.tint });
  }

  ball.bounces++;
  return { hits, reflect, capture, fx };
}

/**
 * What a dying block gives back and sets off.
 *
 * @param {object} state
 * @param {object} block
 * @param {object} ctx     needs ctx.blocks for detonation
 * @param {object} [info]  {cause, damage, ball} - the blow that killed it
 * @returns {{essence, swarmDelta, hits: Array, spawns: Array, fx: Array}}
 */
function onDestroy(state, block, ctx, info) {
  const d = state.derived, t = state.turn;
  info = info || {};
  const fx = [], hits = [], spawns = [];

  t.destroyed++;
  const essence = essenceFor(state, block, info.cause);
  t.essence = badd(t.essence, essence);

  // Spoils accumulate as a fraction and cash out at the end of the turn.
  let swarmDelta = 0;
  if (d.spoils > 0) {
    state.acquired.spoilsPool += d.spoils;
    swarmDelta = d.spoils;
  }
  // Tempering banks permanent damage off the destruction itself. No material
  // changes hands and no price is involved, which is the whole point of it.
  if (d.temper > 0) state.acquired.temperPool += d.temper;

  fxPush(state, fx, {
    type: 'kill', at: { c: block.c, r: block.r },
    essence, essenceText: fmt(essence), cause: info.cause || 'impact',
    tint: DOCTRINES[d.dominant || 'legion'].tint,
  });

  // Detonation: the corpse damages what is next to it, which can kill those
  // too, which detonate in turn. resolveImpact() owns the recursion budget.
  const chainDepth = info.chain || 0;
  if (d.detonate > 0 && info.damage && chainDepth < d.detonateChains) {
    const frac = d.resonance ? Math.max(1, d.detonate) : d.detonate;
    let wave = bmul(bmul(big(info.damage), big(frac)), sympathyMult(state));
    if (d.resonance) wave = bmul(wave, big(d.resonanceAmp));
    for (const nb of neighboursOf(ctx.blocks || [], block)) {
      hits.push({ block: nb, damage: wave, cause: 'detonate', chain: chainDepth + 1 });
    }
    fxPush(state, fx, {
      type: 'detonate', at: { c: block.c, r: block.r },
      mag: blog10(wave), tint: DOCTRINES.fracture.tint, chain: chainDepth,
    });
  }

  // Fission: the body that landed the killing blow cleaves.
  const ball = info.ball;
  if (ball && info.cause === 'impact' && ball.splits > 0) {
    const keepStack = d.splitKeepsStack;
    const childStack = keepStack ? ball.stack : bmul(ball.stack, big(0.5));
    const childBase = keepStack ? ball.base : bmul(ball.base, big(0.5));
    const nextGen = ball.gen + 1;
    const childSplits = nextGen < ball.splitGens ? ball.splits : ball.splits - 1;
    const sp = Math.hypot(ball.vx || 0, ball.vy || 0) || TUNING.baseSpeed;
    const ang = Math.atan2(ball.vy || -1, ball.vx || 0);
    for (const sign of [-1, 1]) {
      const a = ang + sign * TUNING.splitAngle;
      spawns.push({
        x: ball.x, y: ball.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        stack: childStack, base: childBase,
        pierce: ball.pierce, splits: Math.max(0, childSplits),
        splitGens: ball.splitGens, gen: nextGen, bounces: ball.bounces,
        orbit: null, lensing: ball.lensing, overrun: ball.overrun,
        homing: ball.homing, core: false,
        size: bodySize(childStack, false), tint: ball.tint,
      });
    }
    ball.splits = Math.max(0, ball.splits - 1);
    t.spawned += 2;
    fxPush(state, fx, {
      type: 'split', at: { c: block.c, r: block.r },
      tint: DOCTRINES.fracture.tint, full: keepStack,
    });
  }

  return { essence, swarmDelta, hits, spawns, fx };
}

/**
 * Apply a list of damage instructions and everything they set off: blocks that
 * die, detonations those trigger, blocks those kill in turn, and any splits
 * that result. Bounded by TUNING.cascadeBudget so a resonant board wipe still
 * fits inside one frame.
 *
 * Essence is credited to state.essence here, in one place, whether the damage
 * came from a contact, an orbit tick, a tether or the end-of-turn implosion.
 *
 * The caller removes `destroyed` from the field and pushes `spawns` into the
 * live list.
 *
 * @param {Array<{block, damage, cause, chain?}>} seedHits
 * @param {object} [ball] the body responsible, when there is one (enables splits)
 * @returns {{destroyed: Array, essence, damage, spawns: Array, fx: Array}}
 */
function resolveHits(state, seedHits, ctx, ball) {
  const fx = [];
  const destroyed = [];
  const spawns = [];
  let essence = ZERO, damage = ZERO;

  const queue = seedHits.slice();
  const gone = new Set();
  let budget = TUNING.cascadeBudget;

  while (queue.length && budget-- > 0) {
    const h = queue.shift();
    const b = h.block;
    if (!b || gone.has(b)) continue;
    damage = badd(damage, h.damage);
    const res = applyDamage(state, b, h.damage);
    if (!res.dead) continue;
    gone.add(b);
    destroyed.push(b);
    const out = onDestroy(state, b, ctx, {
      cause: h.cause, damage: h.damage, chain: h.chain || 0,
      ball: h.cause === 'impact' ? ball : null,
    });
    essence = badd(essence, out.essence);
    for (const nh of out.hits) if (!gone.has(nh.block)) queue.push(nh);
    for (const sp of out.spawns) spawns.push(sp);
    for (const e of out.fx) fx.push(e);
  }

  state.turn.damage = badd(state.turn.damage, damage);
  state.essence = badd(state.essence, essence);
  return { destroyed, essence, damage, spawns, fx };
}

/**
 * Drive one contact all the way through. The single call a physics layer needs
 * on a block collision.
 *
 * The caller removes `destroyed` from the field, pushes `spawns` into the live
 * list, sets `ball.orbit = capture` when a capture is returned, and reflects
 * the ball only if `reflect` is true.
 *
 * @returns {{reflect, capture, destroyed: Array, essence, damage, spawns: Array, fx: Array}}
 */
function resolveImpact(state, ball, block, ctx) {
  const first = onHit(state, ball, block, ctx);
  const out = resolveHits(state, first.hits, ctx, ball);
  return {
    reflect: first.reflect,
    capture: first.capture,
    destroyed: out.destroyed,
    essence: out.essence,
    damage: out.damage,
    spawns: out.spawns,
    fx: first.fx.concat(out.fx),
  };
}


// -- field forces ------------------------------------------------------------

/**
 * Steering for one body. Returns a new velocity, or null when there is nothing
 * to apply. Speed is preserved, so this bends paths without making the swarm
 * faster or slower.
 *
 * Two forces live here. PULL bends bodies toward blocks. SETTLE is the field
 * giving up: once a turn has run past TUNING.settleAfter frames, every body is
 * blended toward the floor, harder the longer it goes. That guarantees a turn
 * ends, including the pathological ones - a body trapped in a flat horizontal
 * bounce, or one held in a stable curve by its own gravity - without capping
 * anything the player earned. Pass ctx.frame (the frame index within the turn)
 * to arm it.
 *
 * @param {object} ctx needs {blocks, posOf(block) -> {x, y}}; optional ctx.frame
 */
function steer(state, ball, ctx) {
  const d = state.derived;
  if (ball.orbit) return null;

  const frame = ctx && ctx.frame != null ? ctx.frame : 0;
  const settle = frame > TUNING.settleAfter
    ? Math.min(0.5, (frame - TUNING.settleAfter) / Math.max(1, TUNING.settleRamp))
    : 0;

  const hasBlocks = ctx && ctx.posOf && ctx.blocks && ctx.blocks.length;
  if (d.pull <= 0 && settle <= 0) return null;

  if (!hasBlocks || d.pull <= 0) {
    if (settle <= 0) return null;
    const sp0 = Math.hypot(ball.vx, ball.vy) || TUNING.baseSpeed;
    let ux = ball.vx / sp0 * (1 - settle);
    let uy = ball.vy / sp0 * (1 - settle) + settle;
    const ul = Math.hypot(ux, uy) || 1;
    return { vx: ux / ul * sp0, vy: uy / ul * sp0 };
  }

  let target = null;
  if (d.anchor) {
    // The deepest block is the one that ends the run, so the well sits on it.
    // It is the same target for every body, so it is resolved once per frame
    // when the caller stamps ctx.frame.
    if (ctx.frame != null && ctx._anchorFrame === ctx.frame) target = ctx._anchor;
    else {
      for (const b of ctx.blocks) if (!target || b.r > target.r) target = b;
      if (ctx.frame != null) { ctx._anchorFrame = ctx.frame; ctx._anchor = target; }
    }
  } else {
    let best = Infinity;
    for (const b of ctx.blocks) {
      const p = ctx.posOf(b);
      const dd = (p.x - ball.x) * (p.x - ball.x) + (p.y - ball.y) * (p.y - ball.y);
      if (dd < best) { best = dd; target = b; }
    }
  }
  if (!target) return null;

  const p = ctx.posOf(target);
  const dx = p.x - ball.x, dy = p.y - ball.y;
  const len = Math.hypot(dx, dy) || 1;
  const sp = Math.hypot(ball.vx, ball.vy) || TUNING.baseSpeed;
  // The pull weakens as the field settles, so gravity cannot hold a body up
  // forever against the end of the turn.
  const k = Math.min(0.45, d.pull) * (1 - settle * 2 > 0 ? 1 - settle * 2 : 0);
  let nx = ball.vx / sp * (1 - k - settle) + (dx / len) * k;
  let ny = ball.vy / sp * (1 - k - settle) + (dy / len) * k + settle;
  const nl = Math.hypot(nx, ny) || 1;
  return { vx: nx / nl * sp, vy: ny / nl * sp };
}

/**
 * Per-frame effects that are not tied to a single contact: orbiting bodies
 * grinding their block, and tether lines cutting whatever they cross.
 *
 * Mutates orbiting bodies' x/y so the caller can draw them on their ring.
 *
 * @param {Array} balls the live bodies
 * @param {object} ctx  needs {blocks, posOf}
 * @returns {{hits: Array<{block, damage, cause}>, released: Array, fx: Array}}
 */
function onFrame(state, balls, ctx) {
  const d = state.derived;
  const hits = [], released = [], fx = [];
  if (!balls || !balls.length) return { hits, released, fx };

  // Orbits
  if (d.orbitTicks > 0) {
    for (const ball of balls) {
      const o = ball.orbit;
      if (!o) continue;
      o.t++;
      const cell = (ctx && ctx.cell) || 65;
      if (!o.radius) o.radius = cell * 0.62;
      o.angle += 0.22;
      if (ctx && ctx.posOf && o.block) {
        const p = ctx.posOf(o.block);
        ball.x = p.x + Math.cos(o.angle) * o.radius;
        ball.y = p.y + Math.sin(o.angle) * o.radius;
      }
      ball.vx = -Math.sin(o.angle) * TUNING.baseSpeed;
      ball.vy = Math.cos(o.angle) * TUNING.baseSpeed;

      if (o.t % d.orbitPeriod === 0) {
        let dmg = bmul(ball.base, big(state.turn.pressureMult * d.orbitFrac));
        if (d.momentum > 0 && ball.bounces > 0) dmg = bmul(dmg, bpow(big(1 + d.momentum), ball.bounces));
        if (d.erosion > 0) dmg = bmul(dmg, strainMult(state, o.block));
        hits.push({ block: o.block, damage: dmg, cause: 'orbit' });
        // The keystone: a captured body keeps compounding while it circles.
        if (d.eventHorizon) ball.bounces++;
        fxPush(state, fx, {
          type: 'orbitTick', at: { x: ball.x, y: ball.y },
          mag: blog10(dmg), tint: DOCTRINES.well.tint,
        });
      }
      if (o.t >= o.ticks) { ball.orbit = null; released.push(ball); }
    }
  }

  // Tethers: bodies are paired in launch order and the segment between them
  // cuts anything it passes over.
  if (d.tether > 0 && ctx && ctx.posOf && ctx.blocks && ctx.blocks.length) {
    const cell = ctx.cell || 65;
    // Pairs are capped so a maximum-density swarm cannot turn one frame into a
    // quadratic sweep; the visual reads the same either way.
    const pairs = Math.min(balls.length - 1, TUNING.tetherPairs * 2);
    for (let i = 0; i + 1 < pairs; i += 2) {
      const a = balls[i], b = balls[i + 1];
      if (!a || !b) continue;
      for (const blk of ctx.blocks) {
        const p = ctx.posOf(blk);
        if (segNear(a.x, a.y, b.x, b.y, p.x, p.y, cell * 0.45)) {
          const dmg = bmul(bmul(a.base, big(d.tether)), big(state.turn.pressureMult));
          hits.push({ block: blk, damage: dmg, cause: 'tether' });
        }
      }
      fxPush(state, fx, {
        type: 'tether', from: { x: a.x, y: a.y }, at: { x: b.x, y: b.y },
        tint: DOCTRINES.well.tint,
      });
    }
  }

  return { hits, released, fx };
}

function segNear(x1, y1, x2, y2, px, py, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const cxp = x1 + dx * t, cyp = y1 + dy * t;
  return (cxp - px) * (cxp - px) + (cyp - py) * (cyp - py) <= r * r;
}

/**
 * A body has crossed the floor. Field builds get it back; everyone else loses
 * it. Returns null when the body should be removed as normal.
 *
 * @returns {{keep: true, mode: 'lens'|'wrap', vx, vy, y}|null}
 */
function onFloor(state, ball, ctx) {
  const floorY = (ctx && ctx.floorY) != null ? ctx.floorY : 566;
  const topY = (ctx && ctx.topY) != null ? ctx.topY : 40;
  if (ball.lensing > 0) {
    ball.lensing--;
    ball.bounces++;
    return { keep: true, mode: 'lens', vx: ball.vx, vy: -Math.abs(ball.vy), y: floorY - 6 };
  }
  if (ball.overrun > 0) {
    ball.overrun--;
    ball.bounces++;
    return { keep: true, mode: 'wrap', vx: ball.vx, vy: Math.abs(ball.vy), y: topY + 6 };
  }
  return null;
}

/**
 * A pickup was collected.
 * @param {string} kind 'ball' | 'gold'
 * @returns {{swarmDelta, essenceDelta, fx: Array}}
 */
function onPickup(state, kind, ctx) {
  const d = state.derived;
  const mult = 1 + d.scavenge;
  if (kind === 'ball') {
    // NESTING turns a flat pickup into a share of the swarm, which is what
    // keeps pickups meaningful once the swarm is in the millions.
    const flat = big(1 * mult);
    const share = d.nesting > 0 ? bmul(state.swarm, big(d.nesting * mult)) : ZERO;
    const gain = bmax(flat, share);
    state.swarm = badd(state.swarm, gain);
    return {
      swarmDelta: gain, essenceDelta: ZERO,
      fx: [{ type: 'swarm', amount: gain, reason: 'pickup', tint: DOCTRINES.legion.tint }],
    };
  }
  const e = bmul(bmul(big(5 + state.depth), big(mult)), big(1 + d.harvest));
  state.essence = badd(state.essence, e);
  return {
    swarmDelta: ZERO, essenceDelta: e,
    fx: [{ type: 'essence', amount: e, text: fmt(e), tint: DOCTRINES.tithe.tint }],
  };
}

/**
 * Close the turn: cash out spoils, grow the swarm, fire the well implosion and
 * accrue interest. Everything that compounds compounds here, once, in the open.
 *
 * @param {object} ctx needs {blocks, depth} for the implosion
 * @returns {{swarmBefore, swarmAfter, swarmGain, essence, hits: Array, fx: Array, log: string[]}}
 */
function onTurnEnd(state, ctx) {
  const d = state.derived, t = state.turn;
  const before = state.swarm;
  const fx = [], hits = [], log = [];

  // Spoils: fractional gains banked across the turn become whole balls.
  // Tempering hardens into permanent damage at the end of the turn.
  if (state.acquired.temperPool > 0) {
    const won = big(state.acquired.temperPool);
    state.acquired.temperPool = 0;
    state.acquired.heft = badd(state.acquired.heft, won);
    recompute(state);
    fxPush(state, fx, { type: 'temper', amount: won, tint: DOCTRINES.monolith.tint });
    log.push(`temper +${fmt(won)}`);
  }

  if (state.acquired.spoilsPool >= 1) {
    const whole = Math.floor(state.acquired.spoilsPool);
    state.acquired.spoilsPool -= whole;
    state.swarm = badd(state.swarm, big(whole));
    log.push(`spoils +${whole}`);
  }

  // Per-turn multiplicative growth. This is the count build's whole engine and
  // the reason the number stops being readable after a few dozen turns.
  let growth = d.growth;
  if (d.spawntide > 0) growth += d.spawntide * t.destroyed;
  if (growth > 0) {
    const gain = bmul(state.swarm, big(growth));
    state.swarm = badd(state.swarm, gain);
    fxPush(state, fx, { type: 'swarm', amount: gain, reason: 'growth', tint: DOCTRINES.legion.tint });
    log.push(`swarm x${(1 + growth).toFixed(3)}`);
  }

  // The well implodes for a share of everything the turn dealt, which rewards
  // turns that lasted rather than turns that hit hard once.
  if (d.collapse > 0 && !bzero(t.damage) && ctx && ctx.blocks && ctx.blocks.length) {
    const wave = bmul(t.damage, big(d.collapse));
    for (const b of ctx.blocks) hits.push({ block: b, damage: wave, cause: 'collapse' });
    fxPush(state, fx, { type: 'collapse', mag: blog10(wave), tint: DOCTRINES.well.tint });
    log.push(`collapse ${fmt(wave)}`);
  }

  if (d.interest > 0 && !bzero(state.essence)) {
    const gain = bmul(state.essence, big(d.interest));
    state.essence = badd(state.essence, gain);
    fxPush(state, fx, { type: 'essence', amount: gain, text: fmt(gain), reason: 'interest', tint: DOCTRINES.tithe.tint });
  }

  if (ctx && ctx.depth != null) state.depth = ctx.depth;

  return {
    swarmBefore: before,
    swarmAfter: state.swarm,
    swarmGain: bsub(state.swarm, before),
    essence: t.essence,
    destroyed: t.destroyed,
    damage: t.damage,
    hits, fx, log,
  };
}


// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

export {
  // magnitude
  B, fmt,
  // definitions
  TUNING, DOCTRINES, POWERS, POWER_LIST, ECHO_KEYS, TIER_GATE, ECHO_AFTER,
  // state
  createState, recompute, perBallDamage, swarmCount, describeSwarm, bodyCapOf,
  // difficulty tiers
  setTier, dial,
  // choice
  offer, apply, reroll, codex, costOf, costInMaterial, canAfford, rerollCost, gainEssence,
  // the market seam
  tradeMods, yieldMult, meltYield, readMarket, marketMultiplier,
  // field scaling
  hpFor, essenceFor, applyDamage,
  // turn hooks
  onTurnStart, onBallSpawn, ballStyle, steer, onFrame,
  onWallBounce, onHit, onDestroy, resolveImpact, resolveHits, onFloor, onPickup, onTurnEnd,
};

export default {
  B, fmt, TUNING, DOCTRINES, POWERS, POWER_LIST, ECHO_KEYS, TIER_GATE,
  createState, recompute, perBallDamage, swarmCount, describeSwarm, bodyCapOf,
  setTier, dial,
  offer, apply, reroll, codex, costOf, costInMaterial, canAfford, rerollCost, gainEssence,
  tradeMods, yieldMult, meltYield, readMarket, marketMultiplier,
  hpFor, essenceFor, applyDamage,
  onTurnStart, onBallSpawn, ballStyle, steer, onFrame,
  onWallBounce, onHit, onDestroy, resolveImpact, resolveHits, onFloor, onPickup, onTurnEnd,
};
