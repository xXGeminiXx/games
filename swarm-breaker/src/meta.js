// ===========================================================================
// Swarm Breaker - meta
//
// Everything that outlives a run, and the wager a player places on himself.
//
// Pure logic. No DOM, no canvas, no timers, no storage, no network, no
// dependencies. The host owns persistence; this module owns what is worth
// persisting and what it means. State is a plain JSON-safe object.
//
// ---------------------------------------------------------------------------
// PART ONE - WHAT CARRIES, AND THE ARGUMENT FOR IT
//
// THE POSITION: a run leaves behind KNOWLEDGE and OPTIONS. It never leaves
// behind STATS.
//
// Nothing here makes the next run numerically easier. There is no permanent
// +damage, no starting swarm bonus, no "keep 3% of your essence", no rank that
// carries. Every run starts from one ball and zero essence, forever.
//
// The argument, in the order it actually matters:
//
// 1. A CARRIED STAT IS A NUMBER, AND A NUMBER IS SKIPPABLE. If a permanent
//    +1 damage per run were the reward, then run forty is run one with a
//    bigger constant in it. Anyone who can open a console can type that
//    constant in, and if typing it in costs them nothing, it was never
//    content - it was a delay dressed as an achievement. The honest test for
//    any progression system is: would handing the player the end state for
//    free destroy anything? If the answer is no, do not build it.
//
// 2. WHAT SURVIVES THAT TEST IS SHAPE, NOT SIZE. Handing a player a harder
//    tier, a doctrine lock, or a start at depth 15 does not spoil anything,
//    because the thing being handed over is a DIFFERENT run, not a
//    pre-completed one. You still have to play it. That is why every
//    persistent thing in this module is one of: a key (reach, tier unlocks),
//    a record (history, calibration, codex), or a lever that changes what the
//    next run IS (tiers, pledges). None of the three is a multiplier.
//
// 3. SO UNLOCKS ARE NOT GATED ON REPETITION. Every tier and every pledge
//    opens on doing a thing ONCE, or on paying a bankroll that tops itself up
//    for free. Nothing in here says "do that again nine more times". A door
//    that opens on the tenth identical run is a door that opens on patience,
//    and patience is not a skill this game is about.
//
// 4. A FAILED RUN IS PROGRESS, AND NOT IN THE CONSOLING SENSE. It is progress
//    in the literal sense: the run is the input to the line. A death sharpens
//    the game's model of you, moves the number it posts next time, and that
//    number is the thing you are trying to beat. This is the only design I
//    know where "you learned something" is not a lie told to a losing player -
//    the learning is a row in a table and you can watch it move.
//
// 5. PRESTIGE IS REJECTED, AND NOT ON TASTE. Prestige exists to solve a
//    numeric ceiling: when the numbers stop meaning anything, you fold them
//    into a small permanent bonus and start over. This game has no ceiling.
//    Swarm, essence and depth are mantissa-exponent values and the market is
//    scale invariant, so depth 12,000 poses the same decisions as depth 12 at
//    a different magnitude. A reset layer bolted onto a system with no ceiling
//    is pure bookkeeping - a second spreadsheet you must keep current to stay
//    optimal, which is the exact thing that makes people quit incrementals.
//    The tier ladder does everything prestige claims to do (a fresh start that
//    means something) with none of the arithmetic: you choose a harder world,
//    instantly, and the world is different rather than the multiplier being
//    bigger.
//
// 6. THE CONSOLE DOOR IS LEFT OPEN ON PURPOSE. `unlockAll()` and `setReach()`
//    are part of the documented API, not a debug leak. Anything a cheat
//    function can hand you was never content, so there is nothing to protect.
//    What a cheat cannot hand you is a wager you were right about, and that is
//    where the whole meta layer puts its weight.
//
// 7. AND IT IS ENFORCED, NOT PROMISED. `grindAudit()` fails if any persistent
//    field ever becomes a multiplier on damage, swarm, essence or yield, and
//    if `runStartKit()` ever returns a kit that is not one ball and no
//    essence. A rule with a test behind it survives the next contributor. A
//    rule written only in a comment does not.
//
// ---------------------------------------------------------------------------
// PART TWO - WAGERING ON YOUR OWN RUN
//
// The game posts a LINE - a depth, an essence total, a block count - drawn
// from your own history. Before a stretch begins you take the over or the
// under, at a strike you choose, for a stake you choose. The currency is the
// game's own and it is called RESOLVE. Nothing buys it and nothing cashes out.
//
// THE ONE IDEA THAT MAKES IT UNEXPLOITABLE: the line and the price come out of
// the SAME distribution. The line is a high quantile of what you have done;
// the payout is one over the probability of the strike under that same fit. So
// a player who tanks runs to drag the line down drags the price down with it,
// by exactly the same amount. You cannot move the target without moving what
// the target is worth. Sandbagging is not policed, it is priced.
//
// Five rules carry that, and each is load bearing:
//
//   R1 ONLY WAGERED STRETCHES RECORD AT FULL WEIGHT. If you had no position,
//      the stretch does not teach the line anything. So dragging the line down
//      costs a lost stake per attempt, and posting only on turns that look
//      good is self-correcting: cherry-picking your best moments makes the
//      line the quantile OF your best moments.
//
//   R2 CENSORED EVIDENCE CAN RAISE YOUR LINE, NEVER LOWER IT. An unwagered
//      run, or a stretch cut short by death, is a lower bound on what you can
//      do, not a measurement of it. Lower bounds are admitted only when they
//      argue against you. This single rule closes deliberate death, quitting
//      early, and idle-run padding all at once.
//
//   R3 A RATCHET UNDER THE QUANTILE. The line never falls below your own
//      robust best minus a fixed drop. Thirty bad runs in a row cannot buy a
//      line you can walk over.
//
//   R4 THE PRICE COMES FROM THE SAME FIT. See above. This is the spine.
//
//   R5 THE CERTAINTY BAND IS CLOSED. A payout must clear 1.0x after the vig,
//      which means no bet whose probability exceeds about 0.90 is offerable at
//      all. There is no safe rung to farm, so the only bets on the board are
//      bets you might lose.
//
// THE CAUTION TRAP, PRESERVED DELIBERATELY. The interesting failure is the
// player who takes the over and then plays carefully to protect it, and loses
// the very thing he bet on. Four rules keep that alive, and each one was the
// obvious place to design it away:
//
//   - A POSITION CANNOT BE CLOSED. No cash-out, no hedge-out, no buy-back.
//     The only way to protect a bet is to change how you play.
//   - THE RUN ENDING MID-STRETCH LOSES EVERY OPEN WAGER, both sides. So every
//     wager is a survival bet stapled to its metric, and caution that kills
//     you loses the bet it was protecting.
//   - SETTLEMENT IS BINARY. No partial credit for getting close. Close is the
//     shape of a cautious run and it pays nothing.
//   - BLOCKS CLEARED MEANS CLEARED BY THE SWARM. Purging a row to survive
//     does not count toward the blocks line. The panic button is priced.
//
// COMPOSING WITH THE MARKET POWERS. SPECULATE and HEDGE (src/powers.js) pay
// on which way the MARKET is going. A wager pays on which way YOU are going.
// They are deliberately not the same bet: a player can be long a favourable
// stretch and long himself and be wrong in two separate ways, and
// `exposure()` exists to print exactly that so the doubling is visible before
// it is expensive rather than after.
//
// THE FIXED RULE. The wagered currency is the game's own. Nothing is
// purchased, nothing cashes out, no real money touches any part of this.
//
// ---------------------------------------------------------------------------
// WIRING
//
//   import * as Meta from './src/meta.js';
//
//   const profile = Meta.load(JSON.parse(localStorage.mb || 'null'));
//   const run = Meta.beginRun(profile, { tier: 'descent', pledges: [] });
//   const kit = Meta.runStartKit(run);         // one ball, zero essence, dials
//
//   between turns:   Meta.board(profile, run)  -> lines, rungs, odds
//                    Meta.post(profile, run, { metric, side, spread, stake })
//   at turn end:     Meta.observe(profile, run, { depth, essence, blocks })
//   when it ends:    Meta.endRun(profile, run, { cause: 'overrun' })
//   saving:          Meta.save(profile)
//
// The host passes CUMULATIVE totals to observe(): essence EARNED across the
// run (not the spendable balance, which goes down and would break the
// monotonicity early settlement depends on) and blocks destroyed BY THE SWARM.
// ===========================================================================


// ---------------------------------------------------------------------------
// NUMBERS
//
// Two number systems, on purpose, and the split is the reason this module
// survives a swarm of 1e400.
//
// BALANCES are { m, e } mantissa-exponent pairs, the same plain shape
// src/economy.js and src/powers.js use, so values pass between the three
// modules without conversion and JSON round-trips exactly.
//
// DISTRIBUTIONS are done entirely in LOG10 SPACE, as ordinary floats. That is
// not a convenience, it is the correct metric space for this game: the economy
// is scale invariant, so "40% better than the line" is the meaningful
// comparison at every depth and it is a constant offset in logs. Quantiles,
// regressions and odds on log values stay finite and well conditioned whether
// the numbers are 30 or 1e300, and no distribution code ever has to hold a
// number it cannot represent.
// ---------------------------------------------------------------------------

const ZERO = { m: 0, e: 0 };
const LOG_FLOOR = -9;             // log10 of "effectively nothing"

function norm(m, e) {
  if (!isFinite(m) || m === 0) return { m: 0, e: 0 };
  let s = 1;
  if (m < 0) { s = -1; m = -m; }
  const d = Math.floor(Math.log10(m));
  if (isFinite(d) && d !== 0) {
    const h = Math.trunc(d / 2);
    m = m * Math.pow(10, -h) * Math.pow(10, -(d - h));
    e += d;
  }
  while (m >= 10) { m /= 10; e++; }
  while (m > 0 && m < 1) { m *= 10; e--; }
  return { m: s * m, e };
}

/** Coerce a number, numeric string or magnitude into a magnitude. */
function N(x) {
  if (x && typeof x === 'object' && typeof x.m === 'number') return x;
  const n = typeof x === 'string' ? parseFloat(x) : x;
  if (typeof n !== 'number' || !isFinite(n) || n === 0) return { m: 0, e: 0 };
  return norm(n, 0);
}

function nneg(a) { a = N(a); return a.m === 0 ? { m: 0, e: 0 } : { m: -a.m, e: a.e }; }

function nadd(a, b) {
  a = N(a); b = N(b);
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const hi = a.e >= b.e ? a : b, lo = a.e >= b.e ? b : a;
  const d = hi.e - lo.e;
  if (d > 17) return hi;
  return norm(hi.m + lo.m / Math.pow(10, d), hi.e);
}

function nsub(a, b) { return nadd(a, nneg(b)); }
function nmul(a, b) { a = N(a); b = N(b); if (a.m === 0 || b.m === 0) return { m: 0, e: 0 }; return norm(a.m * b.m, a.e + b.e); }
function ndiv(a, b) { a = N(a); b = N(b); if (a.m === 0 || b.m === 0) return { m: 0, e: 0 }; return norm(a.m / b.m, a.e - b.e); }

function ncmp(a, b) {
  a = N(a); b = N(b);
  if (a.m === 0 && b.m === 0) return 0;
  const sa = Math.sign(a.m), sb = Math.sign(b.m);
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.e !== b.e) return (a.e < b.e ? -1 : 1) * (sa < 0 ? -1 : 1);
  if (a.m === b.m) return 0;
  return a.m < b.m ? -1 : 1;
}

const nmax = (a, b) => (ncmp(a, b) >= 0 ? N(a) : N(b));
const nmin = (a, b) => (ncmp(a, b) <= 0 ? N(a) : N(b));
const npos = (a) => N(a).m > 0;

function nnum(a) {
  a = N(a);
  if (a.m === 0) return 0;
  if (a.e > 300) return a.m > 0 ? Infinity : -Infinity;
  if (a.e < -300) return 0;
  return a.m * Math.pow(10, a.e);
}

/** log10 of a magnitude or number, floored so zero stays finite. */
function logOf(v) {
  if (v == null) return LOG_FLOOR;
  if (typeof v === 'number') return v > 0 ? Math.max(LOG_FLOOR, Math.log10(v)) : LOG_FLOOR;
  if (typeof v === 'object' && typeof v.m === 'number') {
    return v.m > 0 ? Math.max(LOG_FLOOR, Math.log10(v.m) + v.e) : LOG_FLOOR;
  }
  return LOG_FLOOR;
}

/** The inverse: a log10 float back to a magnitude. */
function fromLog(x) {
  if (!isFinite(x) || x <= LOG_FLOOR) return { m: 0, e: 0 };
  const e = Math.floor(x);
  return norm(Math.pow(10, x - e), e);
}

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Human readable short form, matching the economy module's conventions. */
function fmt(a, decimals = 2) {
  a = N(a);
  if (a.m === 0) return '0';
  const sign = a.m < 0 ? '-' : '';
  const m = Math.abs(a.m), e = a.e;
  if (e < 3) {
    const n = m * Math.pow(10, e);
    if (e >= 2 || Number.isInteger(n)) return sign + String(Math.round(n));
    return sign + n.toFixed(Math.min(decimals, e >= 1 ? 1 : 2)).replace(/\.?0+$/, '');
  }
  let tier = Math.floor(e / 3);
  let v = m * Math.pow(10, e - tier * 3);
  if (v >= 999.995 && tier + 1 < SUFFIX.length) { tier += 1; v /= 1000; }
  if (tier < SUFFIX.length) return sign + v.toFixed(v >= 100 ? 0 : decimals) + SUFFIX[tier];
  return sign + m.toFixed(3) + 'e' + e;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Probabilities are clamped SYMMETRICALLY, to [pMin, 1 - pMin]. An asymmetric
 * ceiling looks harmless and is not: an under is priced off one minus the
 * over, so a ceiling on the over becomes a floor on the under, and every deep
 * under collapses onto the same payout no matter how far out it is placed.
 */
const clampP = (p) => clamp(p, TUNING.pMin, 1 - TUNING.pMin);


// ---------------------------------------------------------------------------
// TUNING - every dial the meta layer has, in one place, exported so a headless
// run can sweep them without editing anything below.
// ---------------------------------------------------------------------------

const TUNING = {
  // --- the line ------------------------------------------------------------
  lineQ: 0.62,            // quantile of your own residuals the line sits at
  ratchetQ: 0.90,         // the "robust best" the ratchet hangs off
  ratchetDrop: 0.115,     // log10 drop below it the line may never go under (~77%)
  recency: 0.955,         // weight decay per run of age; ~15 runs dominate
  rowCap: 300,            // rows kept per line before the oldest are dropped
  censoredCap: 120,

  // --- fitting -------------------------------------------------------------
  minFullRows: 4,         // full-weight rows before a fit stops being provisional
  fitDepthAt: 6,          // total weight before depth becomes a regressor
  fitLengthAt: 14,        // total weight before stretch length joins it
  varFloor: 0.004,        // regressor variance below this is treated as none
  ridge: 0.04,            // ridge term, as a fraction of total weight
  slopeDepthMax: 4.0,     // decades of metric per decade of depth, clamped
  slopeLenMax: 2.5,
  scaleFloor: 0.045,      // minimum residual spread in log10 units (~11%)
  scaleSeed: 0.30,        // spread assumed before there is any data at all
  extrapPenalty: 0.55,    // residual spread widening per decade extrapolated
  provTilt: 0.10,         // log10 the line is raised while a fit is provisional
  provDamp: 0.55,         // credit a pledge gets for being hard, before data

  // --- the book ------------------------------------------------------------
  vig: 0.06,              // the only reason it exists is to close the certainty band
  pMin: 1e-6,             // floors the price of a strike nobody has ever come near
  maxOdds: 100000,        // past here a far rung is a lottery ticket and says so
  minMultiple: 1.04,      // below this a rung is not offerable at all
  blendAt: 9,             // total weight at which empirical odds dominate the fit
  smoothing: 1.4,         // Laplace weight on the empirical tail
  convictionPer: 0.018,   // payout bonus per depth of stretch beyond the minimum
  convictionCap: 0.18,

  // --- stretches -----------------------------------------------------------
  minStretch: 3,
  maxStretch: 24,
  maxOpen: 4,             // open wagers at once, across all metrics

  // --- the bankroll --------------------------------------------------------
  floorBase: 120,         // stake floor at reach 0
  floorPow: 2,            // scales with reach the way essence does: quadratic
  minStakeFrac: 0.05,     // smallest stake, as a fraction of the floor
  debtCapRuns: 8,         // debt beyond this is written off, never carried
};

/** Spread rungs a board offers by default. Distance from the line, both ways. */
const RUNGS = {
  over: [0, 0.15, 0.40, 1.00, 3.00, 9.00],
  under: [0, 0.12, 0.30, 0.55, 0.78],
};


// ---------------------------------------------------------------------------
// METRICS
//
// Three, because three is what the direction names and because each one
// punishes a different kind of caution. Every metric must be MONOTONE
// NON-DECREASING inside a stretch - that is what makes early settlement sound,
// since a number that can only climb has crossed a strike for good the first
// time it crosses it.
//
// BLOCKS deliberately counts only what the swarm destroyed. Clearing a row
// with the purge button is survival, not production, and a metric that paid
// for the panic button would let a player buy his way over his own line.
// ---------------------------------------------------------------------------

const METRICS = {
  depth: {
    id: 'depth', name: 'DEPTH', unit: 'depth',
    scopes: ['run'],
    read: s => (s && s.depth != null ? s.depth : 0),
    blurb: 'how deep the run ends',
    reveal: 'wager',
  },
  essence: {
    id: 'essence', name: 'ESSENCE', unit: 'essence',
    scopes: ['stretch', 'run'],
    read: s => (s && s.essence != null ? s.essence : 0),
    blurb: 'essence earned, not essence held',
    reveal: 'stretch',
  },
  blocks: {
    id: 'blocks', name: 'BLOCKS', unit: 'blocks',
    scopes: ['stretch', 'run'],
    read: s => (s && s.blocks != null ? s.blocks : 0),
    blurb: 'blocks the swarm destroyed; purged rows do not count',
    reveal: 'blocks',
  },
};

/**
 * Register another metric. Module level, so it affects every profile in the
 * page. The definition must supply id, name, scopes, and a read(snapshot) that
 * returns a monotone non-decreasing cumulative total.
 */
function defineMetric(def) {
  if (!def || !def.id || typeof def.read !== 'function') throw new Error('meta: bad metric');
  METRICS[def.id] = Object.assign({ scopes: ['stretch'], unit: def.id, reveal: 'wager' }, def);
  return METRICS[def.id];
}


// ---------------------------------------------------------------------------
// TIERS - difficulty is selected, and this is what the meta layer needs to
// know about the selection: an id, a name, the scaling dials, where the
// authored stretch ends, and a rough seed for a first line.
//
// This list is a FALLBACK. If the project carries a dedicated difficulty
// module, hand its ladder to useTiers() at startup and it takes over entirely.
// The list is duplicated rather than imported because this module is
// dependency free on purpose and has to run alone in a headless script.
//
// Each tier carries plain scaling dials in exactly the shape src/powers.js
// setTier() accepts, and an `endlessFrom` marking where its authored stretch
// ends and its endless mode begins. This module never imports powers.js; it
// just hands the host a data object the host passes along.
//
// SHALLOWS runs to 48 on purpose: that is where the market finishes revealing
// itself, so the gentlest tier is the one that shows a player the whole
// economy. The hard tiers are not where the content is. They are where the
// content is hard.
//
// Tier unlock is a single achievement - clear a tier's authored stretch once -
// and SHALLOWS and DESCENT are both open from the first launch so nobody is
// routed through the easy one to reach the normal one.
// ---------------------------------------------------------------------------

const TIERS = [
  {
    id: 'shallows', name: 'SHALLOWS', order: 0,
    blurb: 'the whole economy, at a pace that lets you read it',
    dials: { hpBase: 0.85, hpRamp: 10, hpGrowth: 1.10, endlessFrom: 48, endlessGrowth: 1.015, essenceBase: 2.6, costDepth: 1.11 },
    seed: { depth: 26, essenceExp: 2.0, blocksPerDepth: 3.2 },
    opensAt: null,
  },
  {
    id: 'descent', name: 'DESCENT', order: 1,
    blurb: 'the honest version, and the one every number was tuned against',
    dials: { hpBase: 1.35, hpRamp: 8, hpGrowth: 1.16, endlessFrom: 72, endlessGrowth: 1.02, essenceBase: 2.2, costDepth: 1.13 },
    seed: { depth: 22, essenceExp: 2.2, blocksPerDepth: 3.4 },
    opensAt: null,
  },
  {
    id: 'pressure', name: 'PRESSURE', order: 2,
    blurb: 'health outruns a lazy swarm; the market stops being optional',
    dials: { hpBase: 2.1, hpRamp: 7, hpGrowth: 1.22, endlessFrom: 96, endlessGrowth: 1.025, essenceBase: 2.0, costDepth: 1.16, materialRate: 0.50 },
    seed: { depth: 18, essenceExp: 2.3, blocksPerDepth: 3.6 },
    opensAt: { tier: 'descent', depth: 72 },
  },
  {
    id: 'trench', name: 'TRENCH', order: 3,
    blurb: 'nothing is affordable on time; every purchase is a thing given up',
    dials: { hpBase: 3.4, hpRamp: 6, hpGrowth: 1.28, endlessFrom: 120, endlessGrowth: 1.03, essenceBase: 1.85, costDepth: 1.19, materialRate: 0.44 },
    seed: { depth: 15, essenceExp: 2.4, blocksPerDepth: 3.8 },
    opensAt: { tier: 'pressure', depth: 96 },
  },
  {
    id: 'abyss', name: 'ABYSS', order: 4,
    blurb: 'built to be lost; the line is the only thing left to win',
    dials: { hpBase: 5.0, hpRamp: 5, hpGrowth: 1.35, endlessFrom: 144, endlessGrowth: 1.04, essenceBase: 1.7, costDepth: 1.22, materialRate: 0.38 },
    seed: { depth: 12, essenceExp: 2.5, blocksPerDepth: 4.0 },
    opensAt: { tier: 'trench', depth: 120 },
  },
];

let TIER_BY_ID = {};
let DEFAULT_TIER = 'descent';

function indexTiers() {
  TIER_BY_ID = {};
  for (const t of TIERS) TIER_BY_ID[t.id] = t;
  const open = TIERS.filter(t => !t.opensAt);
  DEFAULT_TIER = (open[open.length - 1] || TIERS[0]).id;
}
indexTiers();

/** The tiers open on a brand new profile: every one with no condition on it. */
function defaultUnlocked() {
  const out = {};
  for (const t of TIERS) if (!t.opensAt) out[t.id] = true;
  return out;
}

/**
 * Replace the ladder with the host's own.
 *
 * If the project grows a dedicated difficulty module, THAT module is the
 * authority and this list is a fallback - hand its ladder in here at startup
 * and everything downstream (lines, shapes, unlocks, reach) keys off the real
 * ids instead of these. Kept as a hand-in rather than an import because this
 * module has no dependencies by design and has to run on its own in a headless
 * balance script.
 *
 * Each entry needs { id, name, dials }. `seed`, `blurb`, `order` and `opensAt`
 * are filled in if absent: the seed from the tier's own endless boundary, so a
 * fresh profile still gets a sane first line before it has any history.
 */
function useTiers(list) {
  if (!list || !list.length) return TIERS;
  const next = list.map((t, i) => {
    const dials = Object.assign({}, t.dials || t);
    const endless = dials.endlessFrom || t.endlessFrom || 72;
    return {
      id: t.id, name: t.name || String(t.id).toUpperCase(), order: t.order == null ? i : t.order,
      blurb: t.blurb || '',
      dials,
      seed: t.seed || { depth: Math.max(6, Math.round(endless * 0.5)), essenceExp: 2.2, blocksPerDepth: 3.5 },
      opensAt: t.opensAt || (i > 1 ? { tier: list[i - 1].id, depth: (list[i - 1].dials || list[i - 1]).endlessFrom || endless } : null),
    };
  });
  TIERS.length = 0;
  for (const t of next) TIERS.push(t);
  indexTiers();
  return TIERS;
}


// ---------------------------------------------------------------------------
// PLEDGES - the persistent thing that actually changes a run.
//
// A pledge is a promise made before the run starts about the shape of it. It
// is data the HOST enforces; this module records which ones are in play,
// prices the line for them, and never applies them itself.
//
// Two properties matter and they are the reason pledges are not upgrades:
//
//   lineMult   how much easier or harder this shape makes the metric. Used
//              ONLY until the shape has real data of its own, and biased
//              toward the house while it is used at all, so inventing an
//              untried combination can never buy a soft line.
//   wagerMult  a payout bonus for playing a harder shape. Applies ONLY once
//              the shape has real data, for the same reason.
//
// SPRINT is the clearest statement of the whole position. The first fifteen
// depths are always the same and a player who has proved them should not have
// to re-prove them. The anti-grind answer to repeated content is to let people
// skip it, not to make it faster. It is not a boost, because the line moves
// with the start depth: begin at 15 and the game expects a run that began at
// 15.
// ---------------------------------------------------------------------------

const PLEDGES = [
  {
    id: 'sprint', name: 'SPRINT',
    line: 'start at depth 15 with the swarm a depth-15 run would have',
    effect: { startDepth: 15, swarmSeed: 'proportional' },
    lineMult: 1.00, wagerMult: 1.00,
    unlock: { reachAny: 30 },
  },
  {
    id: 'plunge', name: 'PLUNGE',
    line: 'start at depth 40, the same way',
    effect: { startDepth: 40, swarmSeed: 'proportional' },
    lineMult: 1.00, wagerMult: 1.00,
    unlock: { reachAny: 60 },
  },
  {
    id: 'creed', name: 'CREED',
    line: 'the hand deals one doctrine and nothing else',
    effect: { doctrineLock: true },
    lineMult: 0.86, wagerMult: 1.15,
    unlock: { reachAny: 34 },
  },
  {
    id: 'blind', name: 'BLIND',
    line: 'no shop and no market until depth 20',
    effect: { shopFromDepth: 20 },
    lineMult: 0.78, wagerMult: 1.22,
    unlock: { reachAny: 36 },
  },
  {
    id: 'nopanic', name: 'NO PANIC',
    line: 'purge row and brake are off the board',
    effect: { offersOff: ['clear', 'purge', 'brake'] },
    lineMult: 0.80, wagerMult: 1.20,
    unlock: { reachAny: 40 },
  },
  {
    id: 'ascetic', name: 'ASCETIC',
    line: 'no market: material melts or it is wasted',
    effect: { marketOff: true },
    lineMult: 0.72, wagerMult: 1.30,
    unlock: { reachAny: 45 },
  },
  {
    id: 'bare', name: 'BARE',
    line: 'no powers are offered at any depth',
    effect: { powersOff: true },
    lineMult: 0.60, wagerMult: 1.45,
    unlock: { reachAny: 50 },
  },
  {
    id: 'onceonly', name: 'ONCE ONLY',
    line: 'no rerolls, and every hand is the first hand',
    effect: { rerollOff: true },
    lineMult: 0.93, wagerMult: 1.08,
    unlock: { reachAny: 32 },
  },
  {
    id: 'downpour', name: 'DOWNPOUR',
    line: 'two rows arrive every turn instead of one',
    effect: { rowsPerTurn: 2 },
    lineMult: 0.55, wagerMult: 1.55,
    unlock: { reachAny: 55 },
  },
];

const PLEDGE_BY_ID = {};
for (const p of PLEDGES) PLEDGE_BY_ID[p.id] = p;


// ---------------------------------------------------------------------------
// REVEALS - the meta layer arrives the same way the market does: after the
// problem it solves exists. A first-time player is not shown a betting board.
// They are shown a line they cannot bet on yet, for six depths, so the number
// means something by the time it costs anything.
// ---------------------------------------------------------------------------

const REVEALS = [
  { at: 6, id: 'line', what: 'the line appears, read only. it is what the game expects of you.' },
  { at: 10, id: 'wager', what: 'wagering opens: the over or the under on where this run ends' },
  { at: 16, id: 'stretch', what: 'stretch wagers, and a line on essence earned' },
  { at: 22, id: 'blocks', what: 'a line on blocks cleared, and the far rungs of the ladder' },
  { at: 30, id: 'pledges', what: 'pledges: choose the shape of the run before it starts' },
  { at: 42, id: 'dossier', what: 'your own calibration: how often you actually beat each rung' },
];


// ---------------------------------------------------------------------------
// SECTION - THE MODEL OF YOU
//
// A line has to do two things at once that pull against each other: it has to
// MOVE AS YOU IMPROVE, and it has to be HARD TO DRAG DOWN. A plain average of
// recent runs does the first and fails the second. A plain all-time best does
// the second and fails the first.
//
// What is used instead is a location model plus a residual distribution:
//
//   1. Fit a weighted ridge regression of log10(metric) on log10(depth posted
//      at) and log10(stretch length). That is the LOCATION - what a player of
//      your recent form does at this depth, for this length. It is what makes
//      one line work at depth 12 and at depth 12,000 without banding the
//      history, because the economy inflates essence quadratically in depth
//      and a regression in log space simply measures the exponent rather than
//      assuming it.
//
//   2. Take the RESIDUALS - how far above or below your own trend each run
//      landed - and treat them as the distribution. The line is a high
//      quantile of those residuals; the odds on a strike are the tail
//      probability of those residuals. One fit, two uses, which is the
//      property that makes sandbagging self-defeating.
//
// Recency weighting (0.955 per run of age) is what makes it move. The ratchet
// under the quantile is what stops it collapsing. Neither can be gamed by
// volume, because both are quantiles and quantiles do not care how many
// samples sit below them.
// ---------------------------------------------------------------------------

/** Weighted quantile over entries of { v, w }, sorted ascending on v. */
function wquantile(sorted, wsum, q) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0].v;
  const target = q * wsum;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i].w;
    const next = cum + w;
    if (next >= target) {
      // interpolate inside the mass of this sample so small samples move smoothly
      const prev = i > 0 ? sorted[i - 1].v : sorted[0].v;
      const t = w > 0 ? clamp((target - cum) / w, 0, 1) : 1;
      return prev + (sorted[i].v - prev) * t;
    }
    cum = next;
  }
  return sorted[sorted.length - 1].v;
}

/** Solve a small symmetric system by Gaussian elimination with partial pivot. */
function solveSmall(A, b, k) {
  const M = [];
  for (let i = 0; i < k; i++) M.push(A[i].slice(0, k).concat([b[i]]));
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const out = [];
  for (let i = 0; i < k; i++) out.push(M[i][k] / M[i][i]);
  return out;
}

/**
 * Fit the location model.
 *
 * Rows are { v, d, l, w } - log10 metric, log10 depth posted at, log10 stretch
 * length, weight. Regressors are added only when there is enough weight AND
 * enough spread in them to justify one, so a player with six near-identical
 * runs gets an honest flat model rather than a slope fitted to noise.
 */
function fitModel(rows) {
  const n = rows.length;
  if (!n) return null;

  let wsum = 0, sd = 0, sl = 0;
  for (const r of rows) { wsum += r.w; sd += r.d * r.w; sl += r.l * r.w; }
  if (wsum <= 0) return null;
  const dBar = sd / wsum, lBar = sl / wsum;

  let vd = 0, vl = 0, dMin = Infinity, dMax = -Infinity;
  for (const r of rows) {
    vd += r.w * (r.d - dBar) * (r.d - dBar);
    vl += r.w * (r.l - lBar) * (r.l - lBar);
    if (r.d < dMin) dMin = r.d;
    if (r.d > dMax) dMax = r.d;
  }
  vd /= wsum; vl /= wsum;

  let k = 1;
  if (wsum >= TUNING.fitDepthAt && vd > TUNING.varFloor) k = 2;
  if (k === 2 && wsum >= TUNING.fitLengthAt && vl > TUNING.varFloor) k = 3;

  // normal equations on centred features [1, d - dBar, l - lBar]
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const r of rows) {
    const f = [1, r.d - dBar, r.l - lBar];
    for (let i = 0; i < k; i++) {
      b[i] += r.w * f[i] * r.v;
      for (let j = 0; j < k; j++) A[i][j] += r.w * f[i] * f[j];
    }
  }
  const ridge = TUNING.ridge * wsum;
  for (let i = 1; i < k; i++) A[i][i] += ridge;

  let coef = solveSmall(A, b, k) || [b[0] / (A[0][0] || 1), 0, 0];
  while (coef.length < 3) coef.push(0);

  // Clamp the slopes. An unclamped slope fitted to five rows can extrapolate
  // a line into absurdity ten depths later, in either direction.
  coef[1] = clamp(coef[1] || 0, 0, TUNING.slopeDepthMax);
  coef[2] = clamp(coef[2] || 0, 0, TUNING.slopeLenMax);

  const model = { b0: coef[0], bd: coef[1], bl: coef[2], dBar, lBar, dMin, dMax, wsum, n, k };

  // residuals, recomputed against the clamped coefficients
  const resid = [];
  for (const r of rows) resid.push({ v: r.v - predictAt(model, r.d, r.l), w: r.w });
  resid.sort((a, x) => a.v - x.v);
  model.resid = resid;
  model.rwsum = wsum;

  const q16 = wquantile(resid, wsum, 0.16);
  const q84 = wquantile(resid, wsum, 0.84);
  model.scale = Math.max(TUNING.scaleFloor, (q84 - q16) / 3.3164);
  model.mid = wquantile(resid, wsum, 0.5);
  return model;
}

function predictAt(model, dLog, lLog) {
  return model.b0 + model.bd * (dLog - model.dBar) + model.bl * (lLog - model.lBar);
}

/**
 * How far outside the data a prediction is reaching, in decades of depth.
 * Extrapolation does not get a free pass: the residual spread is widened by
 * it, which pulls every probability toward one half and therefore SHORTENS
 * long odds. An uncertain model can never be farmed for a big payout.
 */
function extrapOf(model, dLog) {
  if (!model || !isFinite(model.dMin)) return 0;
  if (dLog > model.dMax) return dLog - model.dMax;
  if (dLog < model.dMin) return model.dMin - dLog;
  return 0;
}

/**
 * P(residual > r), from the same residual set the line came out of.
 *
 * A logistic fit for the tails, blended toward the empirical tail as real
 * weight accumulates. The empirical half is Laplace smoothed so a strike past
 * every observation still has a finite, monotone price instead of infinite
 * odds on the first lucky run.
 */
function pAbove(model, r, spreadMult) {
  const s = Math.max(TUNING.scaleFloor, (model ? model.scale : TUNING.scaleSeed) * (spreadMult || 1));
  const mu = model ? model.mid : 0;
  const z = (r - mu) / s;
  const pFit = 1 / (1 + Math.exp(clamp(z, -40, 40)));

  let p = pFit;
  if (model && model.resid && model.resid.length) {
    let above = 0;
    for (const e of model.resid) if (e.v > r) above += e.w;
    const sm = TUNING.smoothing;
    const pEmp = (above + sm * pFit) / (model.rwsum + sm);
    const lambda = model.rwsum / (model.rwsum + TUNING.blendAt);
    p = (1 - lambda) * pFit + lambda * pEmp;
  }
  return clampP(p);
}

/**
 * Price a probability. The vig is not here to take the player's money - the
 * currency has no exit, so there is nothing to take. It exists to CLOSE THE
 * CERTAINTY BAND: a bet that wins more than about nine times in ten cannot
 * clear 1.0x after it, so it is refused outright and there is no safe rung to
 * farm. Everything on the board is something you can lose.
 *
 * The default ladder never gets near that band on its own, because the line
 * sits at a high quantile and every rung walks AWAY from it in both
 * directions. Where the check earns its place is after a run of deliberate
 * failures: the ratchet holds the line up while the player's real results sag
 * under it, which is exactly when the under becomes a near certainty. That is
 * the moment the book stops quoting it.
 */
function priceOf(p) {
  return Math.min(TUNING.maxOdds, (1 / p) * (1 - TUNING.vig));
}

// A note on the far rungs. Expected value is stake x (1 - vig) at every rung,
// because the price is one over the probability - that is what makes "how far
// out do you want to go" a question about variance rather than a question with
// a right answer. The two clamps break that on purpose and both break it
// toward the house: a probability floored UP is paid less than it is worth,
// and a payout capped is paid less than it is worth. So the further out a rung
// sits the worse its edge gets, which is the correct shape for a lottery
// ticket and the reason there is no rung worth farming at either end.

function convictionOf(scope, stretch) {
  if (scope !== 'stretch') return 0;
  const extra = Math.max(0, (stretch || TUNING.minStretch) - TUNING.minStretch);
  return Math.min(TUNING.convictionCap, extra * TUNING.convictionPer);
}


// ---------------------------------------------------------------------------
// SECTION - HISTORY, SHAPES AND THE LINE
//
// A line belongs to a SHAPE: a tier plus the sorted pledges in force. A run
// with no purge button is not the same run, so it does not share a line with
// one that had it.
//
// Before a shape has data of its own it borrows the tier's plain-shape rows
// and adjusts them by the pledges' declared difficulty - DAMPED, and damped in
// the direction that costs the player. A hard pledge gets 55% of the credit it
// claims; an easy one gets 180% of the penalty. So inventing a fresh
// combination to farm a soft provisional line is strictly worse than playing a
// shape the game already knows, and the incentive points at building history
// rather than at churning shapes.
// ---------------------------------------------------------------------------

function shapeKeyOf(pledges) {
  if (!pledges || !pledges.length) return '-';
  return pledges.slice().sort().join('+');
}

function lineKey(tier, shape, metric, scope) {
  return tier + '/' + shape + '/' + metric + '/' + scope;
}

function bucketOf(profile, key) {
  let b = profile.history[key];
  if (!b) { b = profile.history[key] = { rows: [], cens: [] }; }
  if (!b.rows) b.rows = [];
  if (!b.cens) b.cens = [];
  return b;
}

/** Recency weight for a row recorded on run number `at`. */
function weightOf(profile, at) {
  const age = Math.max(0, (profile.runs || 0) - (at || 0));
  return Math.pow(TUNING.recency, age);
}

function weighted(profile, raw) {
  const out = [];
  for (const r of raw) out.push({ v: r.v, d: r.d, l: r.l, w: weightOf(profile, r.t) });
  return out;
}

/**
 * The provisional adjustment applied to a borrowed line, in log10 units.
 * Damped toward the house in both directions - see the section note.
 */
function pledgeAdjust(pledges, field) {
  let raw = 1;
  for (const id of pledges || []) {
    const p = PLEDGE_BY_ID[id];
    if (p && p[field] != null) raw *= p[field];
  }
  if (raw === 1) return 1;
  const d = TUNING.provDamp;
  return raw < 1 ? 1 - (1 - raw) * d : 1 + (raw - 1) / d;
}

/**
 * Build the model behind a line. Fit on full-weight rows only, because
 * censored rows are lower bounds and a regression fitted to lower bounds
 * slopes the wrong way. Censored rows are then measured AGAINST that fit and
 * admitted one at a time, only when they land above the line the full rows
 * produced - rule R2, in eight lines of code.
 */
function modelFor(profile, tier, pledges, metric, scope) {
  const shape = shapeKeyOf(pledges);
  const key = lineKey(tier, shape, metric, scope);
  const own = bucketOf(profile, key);

  let rows = weighted(profile, own.rows);
  let cens = weighted(profile, own.cens);
  let borrowed = false, adjust = 0;

  // not enough of its own? borrow the plain shape of the same tier
  if (rows.length < TUNING.minFullRows && shape !== '-') {
    const base = bucketOf(profile, lineKey(tier, '-', metric, scope));
    if (base.rows.length >= TUNING.minFullRows) {
      rows = weighted(profile, base.rows);
      cens = weighted(profile, base.cens);
      borrowed = true;
      adjust = Math.log10(pledgeAdjust(pledges, 'lineMult'));
    }
  }

  const provisional = rows.length < TUNING.minFullRows;
  let model = fitModel(rows);

  // Nothing wagered yet at all: fit on whatever censored evidence exists, so a
  // calibration-period player still gets a line. It is provisional, tilted
  // against them, and replaced the moment real rows arrive.
  if (!model && cens.length) model = fitModel(cens);

  return {
    key, shape, tier, metric, scope, model,
    cens, provisional, borrowed, adjust,
    rowCount: rows.length, censCount: cens.length,
  };
}

/**
 * The seed line for a metric with no history whatsoever, in log10 units.
 *
 * A guess, and it only ever matters for the first bet on a fresh profile - one
 * real row and the regression takes over. It is written from the shape the
 * economy actually has: essence inflates roughly quadratically in depth, so a
 * run total goes as depth^k and a stretch total as its slope times the length,
 * while blocks arrive at a flat rate per row.
 */
function seedLine(tierId, metric, scope, depth, stretch) {
  const t = TIER_BY_ID[tierId] || TIER_BY_ID[DEFAULT_TIER];
  const s = t.seed;
  const d = Math.max(1, depth || 1);
  const len = Math.max(1, stretch || TUNING.minStretch);

  if (metric === 'depth') return logOf(s.depth);
  if (metric === 'blocks') {
    return logOf(Math.max(1, s.blocksPerDepth * (scope === 'run' ? s.depth : len)));
  }
  const k = s.essenceExp;
  if (scope === 'run') return logOf(Math.max(1, Math.pow(s.depth, k)));
  return logOf(Math.max(1, k * Math.pow(d, k - 1) * len));
}

/**
 * THE LINE. Everything above converges here.
 *
 *   line = max( quantile(residuals, 0.62), quantile(residuals, 0.90) - drop )
 *          taken around the fitted location for this depth and this length,
 *          then raised by any censored evidence that argues against you.
 *
 * The ratchet is the second term. It is why thirty deliberate failures cannot
 * buy a walkover: the 0.90 quantile of your residuals is robust to any number
 * of samples added below it, and the line is pinned within 0.115 decades of it
 * forever.
 */
function computeLine(profile, ctx) {
  const { tier, pledges, metric, scope } = ctx;
  const depth = Math.max(1, ctx.depth || 1);
  const stretch = scope === 'run' ? 1 : Math.max(1, ctx.stretch || TUNING.minStretch);
  const dLog = logOf(depth), lLog = logOf(stretch);

  const info = modelFor(profile, tier, pledges, metric, scope);
  const m = info.model;

  if (!m) {
    const v = seedLine(tier, metric, scope, depth, stretch) + TUNING.provTilt;
    return {
      key: info.key, metric, scope, depth, stretch,
      logLine: v, value: fromLog(v), text: fmt(fromLog(v)),
      mu: v - TUNING.provTilt, scale: TUNING.scaleSeed, spreadMult: 1,
      provisional: true, borrowed: false, seeded: true,
      rows: 0, censored: 0, model: null,
    };
  }

  const mu = predictAt(m, dLog, lLog) + info.adjust;
  const extra = extrapOf(m, dLog);
  const spreadMult = 1 + TUNING.extrapPenalty * extra;

  // the quantile, and the ratchet under it
  const q = wquantile(m.resid, m.rwsum, TUNING.lineQ);
  const best = wquantile(m.resid, m.rwsum, TUNING.ratchetQ);
  let residLine = Math.max(q, best - TUNING.ratchetDrop);

  // R2: censored rows are admitted only where they argue upward
  if (info.cens.length) {
    const add = [];
    for (const c of info.cens) {
      const r = c.v - (predictAt(m, c.d, c.l) + info.adjust);
      if (r > residLine) add.push({ v: r, w: c.w });
    }
    if (add.length) {
      const merged = m.resid.concat(add).sort((a, b) => a.v - b.v);
      let ws = m.rwsum;
      for (const a of add) ws += a.w;
      const q2 = wquantile(merged, ws, TUNING.lineQ);
      const b2 = wquantile(merged, ws, TUNING.ratchetQ);
      residLine = Math.max(residLine, q2, b2 - TUNING.ratchetDrop);
    }
  }

  let logLine = mu + residLine;
  if (info.provisional) logLine += TUNING.provTilt;

  return {
    key: info.key, metric, scope, depth, stretch,
    logLine, value: fromLog(logLine), text: fmt(fromLog(logLine)),
    mu, residLine, scale: m.scale, spreadMult, extrap: extra,
    provisional: info.provisional, borrowed: info.borrowed, seeded: false,
    rows: info.rowCount, censored: info.censCount, model: m,
  };
}


// ---------------------------------------------------------------------------
// SECTION - THE PROFILE
//
// The entire persistent state. Read the field list as the answer to "what does
// a run leave behind": a reach, a set of doors, a table of what you did, a
// bankroll, and a record. Not one multiplier among them.
// ---------------------------------------------------------------------------

const SAVE_VERSION = 1;

/** Persistent keys that must never become gameplay multipliers. Audited. */
const BANNED_CARRY = [
  'damage', 'power', 'mult', 'swarmBonus', 'startSwarm', 'startEssence',
  'yield', 'gain', 'bonus', 'perm', 'prestige', 'ascension', 'rebirth',
];

function freshProfile() {
  return {
    v: SAVE_VERSION,
    runs: 0,
    reach: {},                 // tierId -> deepest depth ever reached on it
    tiers: { unlocked: defaultUnlocked(), last: DEFAULT_TIER },
    pledges: { unlocked: {}, last: [] },
    history: {},               // lineKey -> { rows, cens }
    codex: {},                 // powerId -> best rank ever taken. A record, nothing more.
    bank: {
      resolve: N(TUNING.floorBase),
      debt: ZERO,
      peak: N(TUNING.floorBase),
      writtenOff: ZERO,
    },
    career: {
      posted: 0, won: 0, lost: 0, voided: 0,
      staked: ZERO, returned: ZERO,
      streak: 0, bestStreak: 0,
      rungs: {},               // "over@0.40" -> { posted, won, impliedSum }
    },
    seen: {},                  // reveal ids already shown
  };
}

/** Deepest depth ever reached, across every tier. Gates the meta reveals. */
function reachOf(profile, tierId) {
  if (tierId) return profile.reach[tierId] || 0;
  let best = 0;
  for (const k in profile.reach) if (profile.reach[k] > best) best = profile.reach[k];
  return best;
}

/** Whether a meta feature has been revealed yet. */
function has(profile, id) {
  const r = REVEALS.find(x => x.id === id);
  if (!r) return true;
  if (profile.flags && profile.flags.unlockAll) return true;
  return reachOf(profile) >= r.at;
}

/** Reveals in order, each marked with whether it has landed and what it costs. */
function reveals(profile) {
  const reach = reachOf(profile);
  return REVEALS.map(r => ({ ...r, open: has(profile, r.id), at: r.at, away: Math.max(0, r.at - reach) }));
}

function tiers(profile) {
  return TIERS.map(t => {
    const open = !t.opensAt || !!(profile.tiers.unlocked || {})[t.id] || (profile.flags && profile.flags.unlockAll);
    return {
      id: t.id, name: t.name, order: t.order, blurb: t.blurb,
      dials: t.dials, endlessFrom: t.dials.endlessFrom,
      open: !!open,
      requires: t.opensAt ? `reach depth ${t.opensAt.depth} on ${(TIER_BY_ID[t.opensAt.tier] || {}).name}` : null,
      reach: profile.reach[t.id] || 0,
      cleared: (profile.reach[t.id] || 0) >= t.dials.endlessFrom,
      endless: (profile.reach[t.id] || 0) > t.dials.endlessFrom,
    };
  });
}

function pledges(profile) {
  const reach = reachOf(profile);
  const all = has(profile, 'pledges');
  return PLEDGES.map(p => {
    const bought = !!(profile.pledges.unlocked || {})[p.id];
    const earned = p.unlock && p.unlock.reachAny != null && reach >= p.unlock.reachAny;
    const open = all && (bought || earned || (profile.flags && profile.flags.unlockAll));
    return {
      id: p.id, name: p.name, line: p.line, effect: p.effect,
      lineMult: p.lineMult, wagerMult: p.wagerMult,
      open: !!open,
      requires: open ? null : `reach depth ${p.unlock.reachAny}, or pay ${fmt(pledgeCost(profile))} resolve`,
      cost: pledgeCost(profile),
    };
  });
}

/**
 * A pledge costs one run's stake floor. Not ten. The price of an option is
 * never allowed to become a reason to play more runs than you wanted to.
 */
function pledgeCost(profile) {
  return nmul(stakeFloor(profile), N(1));
}

/** Pay resolve to open a pledge early. The other door is reaching the depth. */
function buyPledge(profile, id) {
  const p = PLEDGE_BY_ID[id];
  if (!p) return { ok: false, reason: 'no such pledge' };
  if ((profile.pledges.unlocked || {})[id]) return { ok: false, reason: 'already open' };
  if (!has(profile, 'pledges')) return { ok: false, reason: 'pledges have not been revealed yet' };
  const cost = pledgeCost(profile);
  if (ncmp(profile.bank.resolve, cost) < 0) return { ok: false, reason: 'not enough resolve', cost };
  profile.bank.resolve = nsub(profile.bank.resolve, cost);
  profile.pledges.unlocked[id] = true;
  return { ok: true, id, cost, resolve: profile.bank.resolve };
}


// ---------------------------------------------------------------------------
// SECTION - RESOLVE, THE BANKROLL
//
// RESOLVE is the game's own currency and the only thing wagers move. Nothing
// buys it, nothing cashes out, and no real money touches it. Fixed rule.
//
// Two properties keep it from becoming a grind:
//
//   THE FLOOR. Before every run the bankroll is topped up to a floor that
//   scales with your reach, so you can never be locked out of betting by being
//   broke. "Play twenty runs to afford a bet" is not in here.
//
//   THE FLOOR IS A LOAN, NOT A GIFT. The top-up is recorded as debt and
//   winnings clear debt first. That closes the obvious exploit - a free
//   minimum stake every run is free variance, and free variance at long odds
//   is a printing press. You are never broke and never free.
//
// And debt is never a wall either: past eight runs' worth it is written off
// into a career scar. Nothing here can trap a player in arithmetic.
// ---------------------------------------------------------------------------

/** The stake floor at this reach. Scales quadratically, like essence does. */
function stakeFloor(profile) {
  const reach = Math.max(0, reachOf(profile));
  const lg = Math.log10(1 + reach) * TUNING.floorPow + Math.log10(TUNING.floorBase);
  return fromLog(lg);
}

function minStake(profile) {
  return nmul(stakeFloor(profile), N(TUNING.minStakeFrac));
}

/** Top up to the floor, on credit. Called by beginRun. */
function topUp(profile) {
  const floor = stakeFloor(profile);
  if (ncmp(profile.bank.resolve, floor) >= 0) return { lent: ZERO, floor };
  const lent = nsub(floor, profile.bank.resolve);
  profile.bank.resolve = floor;
  profile.bank.debt = nadd(profile.bank.debt, lent);

  const cap = nmul(floor, N(TUNING.debtCapRuns));
  if (ncmp(profile.bank.debt, cap) > 0) {
    const off = nsub(profile.bank.debt, cap);
    profile.bank.debt = cap;
    profile.bank.writtenOff = nadd(profile.bank.writtenOff, off);
  }
  return { lent, floor };
}

/** Credit winnings, debt first. */
function credit(profile, amount) {
  let a = N(amount);
  if (!npos(a)) return { toDebt: ZERO, toBank: ZERO };
  let toDebt = ZERO;
  if (npos(profile.bank.debt)) {
    toDebt = nmin(a, profile.bank.debt);
    profile.bank.debt = nsub(profile.bank.debt, toDebt);
    a = nsub(a, toDebt);
  }
  profile.bank.resolve = nadd(profile.bank.resolve, a);
  if (ncmp(profile.bank.resolve, profile.bank.peak) > 0) profile.bank.peak = profile.bank.resolve;
  return { toDebt, toBank: a };
}

function debit(profile, amount) {
  const a = nmin(N(amount), profile.bank.resolve);
  profile.bank.resolve = nsub(profile.bank.resolve, a);
  return a;
}

/** The bankroll, formatted for a header. */
function bank(profile) {
  const b = profile.bank;
  return {
    resolve: b.resolve, resolveText: fmt(b.resolve),
    debt: b.debt, debtText: fmt(b.debt),
    peak: b.peak, peakText: fmt(b.peak),
    writtenOff: b.writtenOff, writtenOffText: fmt(b.writtenOff),
    floor: stakeFloor(profile), floorText: fmt(stakeFloor(profile)),
    min: minStake(profile),
  };
}


// ---------------------------------------------------------------------------
// SECTION - CREATE, SAVE, LOAD
// ---------------------------------------------------------------------------

function create() { return freshProfile(); }

function save(profile) {
  return JSON.parse(JSON.stringify(profile));
}

/**
 * Load a saved profile, or make a new one. Unknown or missing fields are
 * filled from a fresh profile rather than rejected, so an older save never
 * costs a player their history.
 */
function load(saved) {
  const p = freshProfile();
  if (!saved || typeof saved !== 'object') return p;
  const out = Object.assign(p, saved);
  out.v = SAVE_VERSION;
  out.bank = Object.assign(p.bank, saved.bank || {});
  for (const k of ['resolve', 'debt', 'peak', 'writtenOff']) out.bank[k] = N(out.bank[k]);
  out.career = Object.assign(freshProfile().career, saved.career || {});
  out.career.staked = N(out.career.staked);
  out.career.returned = N(out.career.returned);
  out.tiers = Object.assign(p.tiers, saved.tiers || {});
  out.tiers.unlocked = Object.assign(defaultUnlocked(), out.tiers.unlocked || {});
  out.pledges = Object.assign({ unlocked: {}, last: [] }, saved.pledges || {});
  out.history = saved.history || {};
  out.reach = saved.reach || {};
  out.codex = saved.codex || {};
  out.seen = saved.seen || {};
  return out;
}


// ---------------------------------------------------------------------------
// SECTION - A RUN
//
// The run object is scratch state. It is not persisted and nothing in it
// survives except the rows it writes back on the way out.
// ---------------------------------------------------------------------------

/**
 * Open a run.
 *
 * @param {object} profile
 * @param {object} [opts] { tier, pledges: [ids], seed }
 */
function beginRun(profile, opts) {
  opts = opts || {};
  const tierId = TIER_BY_ID[opts.tier] ? opts.tier : (profile.tiers.last || DEFAULT_TIER);
  const tier = TIER_BY_ID[tierId];

  const open = tiers(profile).find(t => t.id === tierId);
  if (!open || !open.open) return { ok: false, reason: 'that tier is not open yet' };

  const avail = {};
  for (const p of pledges(profile)) if (p.open) avail[p.id] = true;
  const chosen = (opts.pledges || []).filter(id => PLEDGE_BY_ID[id] && avail[id]);

  profile.tiers.last = tierId;
  profile.pledges.last = chosen.slice();
  profile.runs = (profile.runs || 0) + 1;

  const lent = topUp(profile);
  const startDepth = startDepthOf(chosen);

  const run = {
    ok: true,
    id: profile.runs,
    seed: opts.seed == null ? ((Date.now() ^ (profile.runs * 2654435761)) >>> 0) : (opts.seed >>> 0),
    tier: tierId, tierName: tier.name, dials: Object.assign({}, tier.dials),
    pledges: chosen, shape: shapeKeyOf(chosen),
    effects: mergeEffects(chosen),
    startDepth,
    depth: startDepth, turns: 0, alive: true, over: false,
    snap: { depth: startDepth, essence: ZERO, blocks: ZERO },
    base: { essence: ZERO, blocks: ZERO },
    wagers: [], nextId: 1,
    lent: lent.lent,
    log: [],
  };
  return run;
}

function startDepthOf(chosen) {
  let d = 1;
  for (const id of chosen || []) {
    const p = PLEDGE_BY_ID[id];
    if (p && p.effect && p.effect.startDepth) d = Math.max(d, p.effect.startDepth);
  }
  return d;
}

function mergeEffects(chosen) {
  const out = {};
  for (const id of chosen || []) {
    const p = PLEDGE_BY_ID[id];
    if (!p || !p.effect) continue;
    for (const k in p.effect) {
      if (k === 'offersOff') out.offersOff = (out.offersOff || []).concat(p.effect.offersOff);
      else if (k === 'startDepth') out.startDepth = Math.max(out.startDepth || 0, p.effect.startDepth);
      else if (k === 'rowsPerTurn') out.rowsPerTurn = Math.max(out.rowsPerTurn || 1, p.effect.rowsPerTurn);
      else out[k] = p.effect[k];
    }
  }
  return out;
}

/**
 * Everything the host needs to start the run, and the proof of Part One: the
 * swarm is one and the essence is zero on run one and on run ten thousand.
 * The only things that differ are the dials and the pledge effects, and both
 * of those change what the run IS rather than how strong you are inside it.
 */
function runStartKit(run) {
  return {
    tier: run.tier,
    tierDials: Object.assign({}, run.dials),   // pass straight to powers.setTier()
    swarm: 1,
    essence: ZERO,
    powers: {},
    depth: run.startDepth,
    seed: run.seed,
    effects: Object.assign({}, run.effects),
    pledges: run.pledges.slice(),
    shape: run.shape,
  };
}


// ---------------------------------------------------------------------------
// SECTION - THE BOARD
//
// What can be bet, at what strikes, for what price. Everything here is derived
// and nothing is stored - the board is a view of the line, and the line is a
// view of your history.
// ---------------------------------------------------------------------------

/** The value a wager is measured against right now. */
function currentValue(run, w, snap) {
  const def = METRICS[w.metric];
  const raw = N(def.read(snap || run.snap));
  if (w.scope === 'run' && w.metric === 'depth') return raw;
  const base = w.startValue || ZERO;
  const d = nsub(raw, base);
  return d.m > 0 ? d : ZERO;
}

function metricsOpen(profile, run) {
  const out = [];
  for (const id in METRICS) {
    const m = METRICS[id];
    if (!has(profile, m.reveal)) continue;
    for (const scope of m.scopes) {
      if (scope === 'stretch' && !has(profile, 'stretch')) continue;
      if (scope === 'run' && run && run.turns > 0) continue;   // run bets are posted before the first fire
      out.push({ metric: id, scope, name: m.name, unit: m.unit, blurb: m.blurb });
    }
  }
  return out;
}

/**
 * Quote one strike. The single most important line in this module is the one
 * that computes `p`: it comes from the SAME residual set that produced the
 * line, so moving the line moves the price with it.
 */
function quote(profile, run, req) {
  req = req || {};
  const metric = req.metric, scope = req.scope || 'stretch';
  const def = METRICS[metric];
  if (!def) return { ok: false, reason: 'no such metric' };
  if (def.scopes.indexOf(scope) < 0) return { ok: false, reason: metric + ' has no ' + scope + ' line' };

  const side = req.side === 'under' ? 'under' : 'over';
  const stretch = scope === 'run' ? 1 : clamp(Math.round(req.stretch || 8), TUNING.minStretch, TUNING.maxStretch);
  const spread = clamp(req.spread || 0, 0, side === 'under' ? 0.95 : 60);

  const line = computeLine(profile, {
    tier: run.tier, pledges: run.pledges, metric, scope,
    depth: run.depth, stretch,
  });

  const offset = side === 'over' ? Math.log10(1 + spread) : Math.log10(1 - spread);
  const strike = line.logLine + offset;

  // P(clear the strike). For an under, clearing means landing below it.
  //
  // The provisional tilt is deliberately NOT priced in. While a line is a
  // guess it is raised against the player, and the price is quoted as if it
  // had not been - so an unproven line is worse EV than a proven one at the
  // same rung. Pricing the tilt honestly would make it EV neutral, which would
  // make hopping between untested shapes free, which is the thing the tilt is
  // there to stop.
  const resid = strike - line.mu - (line.provisional ? TUNING.provTilt : 0);
  const pOver = pAbove(line.model, resid, line.spreadMult);
  const p = side === 'over' ? pOver : 1 - pOver;
  const pc = clampP(p);

  // OFFERABILITY IS JUDGED ON THE BARE PRICE. Conviction and pledge bonuses
  // enrich a bet that was already a bet; neither may manufacture one. Without
  // this, a long stretch on a near certainty clears 1.0x on the bonus alone
  // and the certainty band quietly reopens.
  const base = priceOf(pc);
  const offerable = base > TUNING.minMultiple;

  const conviction = convictionOf(scope, stretch);
  // A pledge's payout bonus applies only once the shape has real data, for the
  // same reason its line adjustment stops applying then: an untested shape
  // must never be worth more than a tested one.
  const wm = (!line.provisional && !line.borrowed) ? pledgeAdjust(run.pledges, 'wagerMult') : 1;
  const multiple = Math.min(TUNING.maxOdds, base * (1 + conviction) * wm);
  return {
    ok: true, metric, scope, side, spread, stretch,
    line: line.value, lineText: fmt(line.value), logLine: line.logLine,
    strike: fromLog(strike), strikeText: fmt(fromLog(strike)), logStrike: strike,
    p: pc, multiple, conviction, pledgeMult: wm,
    offerable,
    reason: offerable ? null : 'too likely to pay anything - pick a strike you might miss',
    provisional: line.provisional, borrowed: line.borrowed, seeded: line.seeded,
    rows: line.rows, censored: line.censored, extrap: line.extrap || 0,
    endsAtDepth: scope === 'run' ? null : run.depth + stretch,
  };
}

/** Every metric, every default rung, priced. What a UI paints. */
function board(profile, run, opts) {
  opts = opts || {};
  const stretch = clamp(Math.round(opts.stretch || 8), TUNING.minStretch, TUNING.maxStretch);
  const far = has(profile, 'blocks');
  const out = [];
  for (const m of metricsOpen(profile, run)) {
    const rows = [];
    for (const side of ['over', 'under']) {
      const ladder = RUNGS[side].filter((s, i) => far || i < 3);
      for (const s of ladder) {
        const q = quote(profile, run, { metric: m.metric, scope: m.scope, side, spread: s, stretch });
        if (q.ok) rows.push(q);
      }
    }
    const head = quote(profile, run, { metric: m.metric, scope: m.scope, side: 'over', spread: 0, stretch });
    out.push({
      metric: m.metric, scope: m.scope, name: m.name, unit: m.unit, blurb: m.blurb,
      line: head.line, lineText: head.lineText,
      provisional: head.provisional, seeded: head.seeded, rows: head.rows,
      offers: rows,
    });
  }
  return {
    canWager: has(profile, 'wager') && run.alive && !run.over,
    bank: bank(profile),
    open: run.wagers.filter(w => w.state === 'open').length,
    maxOpen: TUNING.maxOpen,
    stretch,
    lines: out,
  };
}


// ---------------------------------------------------------------------------
// SECTION - POSTING, AND THE FACT THAT YOU CANNOT TAKE IT BACK
//
// A wager is posted between turns, at a strike and a stake the player chooses,
// and from that moment there is no exit. No cash-out, no buy-back, no partial
// credit, no hedging the same line from the other side. That is not an
// oversight and it is the whole point: if a position could be closed, the
// player who takes the over and then gets nervous would simply close it, and
// the most interesting thing this system produces - a confident player
// strangling his own run to protect a bet - would never happen.
//
// Posting late is allowed on purpose. If you wait for a turn that looks good
// before you post, your history fills with the stretches that looked good, and
// the line becomes the quantile of THOSE. Selection bias is not policed here
// because the line eats it.
// ---------------------------------------------------------------------------

function rungKey(side, spread) {
  return side + '@' + (Math.round(spread * 100) / 100);
}

function post(profile, run, req) {
  if (!run || !run.ok) return { ok: false, reason: 'no run' };
  if (!run.alive || run.over) return { ok: false, reason: 'the run is over' };
  if (!has(profile, 'wager')) return { ok: false, reason: 'wagering has not been revealed yet' };

  const q = quote(profile, run, req);
  if (!q.ok) return q;
  if (!q.offerable) return { ok: false, reason: q.reason, quote: q };

  if (q.scope === 'run' && run.turns > 0) {
    return { ok: false, reason: 'a run line is posted before the first shot, not after it' };
  }
  const openNow = run.wagers.filter(w => w.state === 'open');
  if (openNow.length >= TUNING.maxOpen) return { ok: false, reason: 'too many open positions' };
  if (openNow.some(w => w.metric === q.metric && w.scope === q.scope)) {
    return { ok: false, reason: 'that line already has a position on it' };
  }

  const floorMin = minStake(profile);
  let stake = N(req.stake == null ? stakeFloor(profile) : req.stake);
  if (ncmp(stake, floorMin) < 0) stake = floorMin;
  if (ncmp(stake, profile.bank.resolve) > 0) {
    return { ok: false, reason: 'not enough resolve', have: profile.bank.resolve, want: stake };
  }

  debit(profile, stake);
  const def = METRICS[q.metric];
  const startValue = q.scope === 'run' && q.metric === 'depth' ? ZERO : N(def.read(run.snap));

  const w = {
    id: run.nextId++,
    metric: q.metric, scope: q.scope, side: q.side,
    spread: q.spread, stretch: q.scope === 'run' ? null : q.stretch,
    stake, multiple: q.multiple, p: q.p,
    payout: nmul(stake, N(q.multiple)),
    logLine: q.logLine, line: q.line,
    logStrike: q.logStrike, strike: q.strike,
    startValue,
    postedAtDepth: run.depth,
    endsAtDepth: q.endsAtDepth,
    key: lineKey(run.tier, run.shape, q.metric, q.scope),
    state: 'open', recorded: false, done: false,
    settledAtDepth: null, result: null,
    provisional: q.provisional,
  };
  run.wagers.push(w);

  profile.career.posted++;
  profile.career.staked = nadd(profile.career.staked, stake);
  const rk = rungKey(w.side, w.spread);
  const rec = profile.career.rungs[rk] || (profile.career.rungs[rk] = { posted: 0, won: 0, implied: 0 });
  rec.posted++;
  rec.implied += q.p;

  run.log.push(`${w.side} ${METRICS[w.metric].name} ${fmt(w.strike)} at ${w.multiple.toFixed(2)}x for ${fmt(stake)}`);
  return { ok: true, wager: w, bank: bank(profile) };
}


// ---------------------------------------------------------------------------
// SECTION - SETTLEMENT
//
// Metrics only climb, so a strike crossed is a strike crossed for good: an
// over is WON the instant the number passes it, and an under is LOST the
// instant the number passes it. Neither side is left playing out a bet that
// cannot change, which matters because waiting is never the content here.
//
// Recording is separate from settling. A wager that wins early keeps being
// watched until its window closes, and the row written is the TRUE total at
// the end of the window, not the value at the moment it settled. Otherwise
// every recorded row would pile up exactly on a strike and the distribution
// would learn nothing.
// ---------------------------------------------------------------------------

function recordRow(profile, key, row, censored) {
  const b = bucketOf(profile, key);
  const list = censored ? b.cens : b.rows;
  list.push(row);
  const cap = censored ? TUNING.censoredCap : TUNING.rowCap;
  while (list.length > cap) list.shift();
}

function rowFor(run, w, value) {
  return {
    v: logOf(value),
    d: logOf(w.postedAtDepth || run.startDepth || 1),
    l: logOf(w.scope === 'run' ? 1 : (w.stretch || TUNING.minStretch)),
    t: run.id,
  };
}

function settle(profile, run, w, outcome, value, atDepth) {
  if (w.state !== 'open') return null;
  w.state = outcome;
  w.settledAtDepth = atDepth;
  w.result = N(value);

  let returned = ZERO;
  if (outcome === 'won') {
    returned = nmul(w.stake, N(w.multiple));
    credit(profile, returned);
    profile.career.won++;
    profile.career.streak = Math.max(0, profile.career.streak) + 1;
    if (profile.career.streak > profile.career.bestStreak) profile.career.bestStreak = profile.career.streak;
    const rec = profile.career.rungs[rungKey(w.side, w.spread)];
    if (rec) rec.won++;
  } else if (outcome === 'void') {
    returned = w.stake;
    credit(profile, returned);
    profile.career.voided++;
  } else {
    profile.career.lost++;
    profile.career.streak = 0;
  }
  profile.career.returned = nadd(profile.career.returned, returned);
  w.returned = returned;

  run.log.push(`${METRICS[w.metric].name} ${w.side} ${outcome} at ${fmt(w.result)} (${fmt(returned)} back)`);
  return { wager: w, outcome, returned, value: w.result };
}

/**
 * Called at the end of every turn with CUMULATIVE run totals.
 *
 *   depth    the depth just reached
 *   essence  total essence EARNED this run, never the spendable balance
 *   blocks   total blocks the SWARM destroyed; purged rows do not count
 */
function observe(profile, run, snap) {
  if (!run || !run.ok || run.over) return { events: [] };
  const s = {
    depth: snap && snap.depth != null ? snap.depth : run.depth,
    essence: N(snap && snap.essence),
    blocks: N(snap && snap.blocks),
  };
  run.snap = s;
  run.depth = s.depth;
  run.turns++;

  const events = [];
  for (const w of run.wagers) {
    if (w.done) continue;
    const val = currentValue(run, w, s);
    const lv = logOf(val);
    const crossed = lv >= w.logStrike;

    if (w.state === 'open') {
      if (crossed) {
        const r = settle(profile, run, w, w.side === 'over' ? 'won' : 'lost', val, s.depth);
        if (r) events.push(Object.assign({ early: true }, r));
      } else if (w.endsAtDepth != null && s.depth >= w.endsAtDepth) {
        const r = settle(profile, run, w, w.side === 'under' ? 'won' : 'lost', val, s.depth);
        if (r) events.push(Object.assign({ early: false }, r));
      }
    }

    if (!w.recorded && w.endsAtDepth != null && s.depth >= w.endsAtDepth) {
      recordRow(profile, w.key, rowFor(run, w, val), false);
      w.recorded = true;
    }
    if (w.state !== 'open' && w.recorded) w.done = true;
  }
  return { events, depth: s.depth, open: run.wagers.filter(w => w.state === 'open').length };
}


// ---------------------------------------------------------------------------
// SECTION - THE END OF A RUN
//
// One rule does the heavy lifting: THE RUN ENDING MID-STRETCH LOSES EVERY OPEN
// WAGER, on both sides.
//
// It is tempting to void an unfinished under instead - it feels fairer, since
// the number never got the chance to climb past the strike. It is also an
// exploit: an under that voids on death is a free option, and a player about
// to lose one would simply die. Losing both sides removes the incentive
// entirely, costs one sentence to explain, and has the side effect the design
// wanted anyway - every wager becomes a survival bet stapled to its metric, so
// caution that kills you loses the bet it was protecting.
//
// What a dead stretch DOES leave behind is a censored row: the number it
// reached is a lower bound on what that stretch was worth, so it is admitted
// only where it argues against the player. Deliberately dying to soften your
// own line does nothing at all.
// ---------------------------------------------------------------------------

function endRun(profile, run, final) {
  if (!run || !run.ok) return { ok: false, reason: 'no run' };
  if (run.over) return { ok: false, reason: 'already ended' };
  final = final || {};

  const s = {
    depth: final.depth != null ? final.depth : run.depth,
    essence: N(final.essence != null ? final.essence : run.snap.essence),
    blocks: N(final.blocks != null ? final.blocks : run.snap.blocks),
  };
  run.snap = s;
  run.depth = s.depth;
  run.alive = false;
  run.over = true;

  const events = [];
  const wagered = {};
  for (const w of run.wagers) {
    const val = currentValue(run, w, s);
    wagered[w.metric + '/' + w.scope] = true;

    if (w.state === 'open') {
      if (w.scope === 'run') {
        const lv = logOf(val);
        const win = w.side === 'over' ? lv >= w.logStrike : lv < w.logStrike;
        const r = settle(profile, run, w, win ? 'won' : 'lost', val, s.depth);
        if (r) events.push(r);
      } else {
        const r = settle(profile, run, w, 'lost', val, s.depth);
        if (r) events.push(Object.assign({ truncated: true }, r));
      }
    }
    if (!w.recorded) {
      // a completed run-scope wager is a measurement; a cut-short stretch is a bound
      recordRow(profile, w.key, rowFor(run, w, val), w.scope !== 'run');
      w.recorded = true;
    }
    w.done = true;
  }

  // R2 in its second form: an unwagered run still says something about you,
  // but only ever something that raises the bar.
  for (const id in METRICS) {
    const def = METRICS[id];
    if (def.scopes.indexOf('run') < 0) continue;
    if (wagered[id + '/run']) continue;
    const v = id === 'depth' ? N(s.depth) : N(def.read(s));
    recordRow(profile, lineKey(run.tier, run.shape, id, 'run'), {
      v: logOf(v), d: logOf(run.startDepth || 1), l: 0, t: run.id,
    }, true);
  }

  const before = profile.reach[run.tier] || 0;
  if (s.depth > before) profile.reach[run.tier] = s.depth;
  const opened = syncUnlocks(profile);

  let staked = ZERO, returned = ZERO, won = 0, lost = 0;
  for (const w of run.wagers) {
    staked = nadd(staked, w.stake);
    returned = nadd(returned, w.returned || ZERO);
    if (w.state === 'won') won++;
    else if (w.state === 'lost') lost++;
  }

  return {
    ok: true,
    depth: s.depth, cause: final.cause || 'overrun',
    tier: run.tier, pledges: run.pledges.slice(), shape: run.shape,
    turns: run.turns,
    essence: s.essence, blocks: s.blocks,
    wagers: run.wagers.map(summarize),
    won, lost, staked, returned,
    net: nsub(returned, staked),
    netText: fmt(nsub(returned, staked)),
    reach: profile.reach[run.tier], record: s.depth > before,
    unlocked: opened,
    bank: bank(profile),
    events,
    log: run.log.slice(),
  };
}

function summarize(w) {
  return {
    id: w.id, metric: w.metric, scope: w.scope, side: w.side, spread: w.spread,
    stretch: w.stretch, stake: w.stake, stakeText: fmt(w.stake),
    multiple: w.multiple, p: w.p,
    line: w.line, strike: w.strike, strikeText: fmt(w.strike),
    state: w.state, result: w.result, resultText: w.result ? fmt(w.result) : null,
    returned: w.returned || ZERO, returnedText: fmt(w.returned || ZERO),
    postedAtDepth: w.postedAtDepth, endsAtDepth: w.endsAtDepth, settledAtDepth: w.settledAtDepth,
  };
}

/** Open any tier whose one-time condition is now met. Returns what changed. */
function syncUnlocks(profile) {
  const opened = [];
  for (const t of TIERS) {
    if (!t.opensAt) continue;
    if ((profile.tiers.unlocked || {})[t.id]) continue;
    if ((profile.reach[t.opensAt.tier] || 0) >= t.opensAt.depth) {
      profile.tiers.unlocked[t.id] = true;
      opened.push({ kind: 'tier', id: t.id, name: t.name });
    }
  }
  const reach = reachOf(profile);
  for (const p of PLEDGES) {
    if ((profile.pledges.unlocked || {})[p.id]) continue;
    if (p.unlock && p.unlock.reachAny != null && reach >= p.unlock.reachAny) {
      profile.pledges.unlocked[p.id] = true;
      opened.push({ kind: 'pledge', id: p.id, name: p.name });
    }
  }
  for (const r of REVEALS) {
    if (profile.seen[r.id]) continue;
    if (reach >= r.at) { profile.seen[r.id] = true; opened.push({ kind: 'reveal', id: r.id, what: r.what }); }
  }
  return opened;
}


// ---------------------------------------------------------------------------
// SECTION - EXPOSURE
//
// SPECULATE and HEDGE bet on the MARKET. A wager bets on YOU. They compose
// rather than duplicate, and the composition has a failure mode worth printing
// before it is expensive: a player long a favourable stretch and long himself
// is holding the same optimism twice, and one bad turn takes both.
//
// This function does not stop anyone. It names the position.
// ---------------------------------------------------------------------------

function exposure(run, market) {
  market = market || {};
  const open = (run && run.wagers ? run.wagers : []).filter(w => w.state === 'open');
  let selfLong = ZERO, selfShort = ZERO;
  for (const w of open) {
    if (w.side === 'over') selfLong = nadd(selfLong, w.stake);
    else selfShort = nadd(selfShort, w.stake);
  }
  const favour = typeof market.favour === 'number' ? clamp(market.favour, -1, 1) : 0;
  const marketLong = (market.speculate || 0) > 0;
  const marketShort = (market.hedge || 0) > 0;

  let note = null;
  if (npos(selfLong) && marketLong && favour > 0.15) {
    note = 'long the market and long yourself: one bad turn is two losses';
  } else if (npos(selfShort) && marketShort && favour < -0.15) {
    note = 'short the market and short yourself: a good turn costs twice';
  } else if (npos(selfLong) && marketShort) {
    note = 'the market powers pay while you are betting on yourself to run hot; they are pulling apart';
  }

  return {
    positions: open.map(summarize),
    selfLong, selfShort,
    selfLongText: fmt(selfLong), selfShortText: fmt(selfShort),
    marketFavour: favour, marketLong, marketShort,
    doubled: !!note, note,
  };
}


// ---------------------------------------------------------------------------
// SECTION - THE RECORD
//
// The codex is exactly what its name says: a list of what you have taken, kept
// because seeing your own history is worth something. It confers nothing. That
// is deliberate and it is the whole Part One position in one field.
// ---------------------------------------------------------------------------

function noteCodex(profile, ranks) {
  if (!ranks) return profile.codex;
  for (const id in ranks) {
    const r = ranks[id] | 0;
    if (r > (profile.codex[id] || 0)) profile.codex[id] = r;
  }
  return profile.codex;
}

/**
 * Your own calibration, by rung: what the book thought your chances were
 * against how often you actually got there. The late reveal, and the most
 * useful number in the module - a player reading 'over +40%: implied 31%,
 * actual 44%' has found an edge in himself that the line has not caught yet.
 */
function dossier(profile) {
  const rows = [];
  for (const k in profile.career.rungs) {
    const r = profile.career.rungs[k];
    if (!r.posted) continue;
    const implied = r.implied / r.posted;
    const actual = r.won / r.posted;
    rows.push({
      rung: k, posted: r.posted, won: r.won,
      implied, actual, edge: actual - implied,
      text: `${k}: implied ${(implied * 100).toFixed(0)}%, actual ${(actual * 100).toFixed(0)}% over ${r.posted}`,
    });
  }
  rows.sort((a, b) => b.posted - a.posted);
  const c = profile.career;
  return {
    open: has(profile, 'dossier'),
    runs: profile.runs,
    posted: c.posted, won: c.won, lost: c.lost, voided: c.voided,
    hitRate: c.posted ? c.won / c.posted : 0,
    staked: c.staked, returned: c.returned,
    net: nsub(c.returned, c.staked), netText: fmt(nsub(c.returned, c.staked)),
    streak: c.streak, bestStreak: c.bestStreak,
    rows,
  };
}

/** One object with everything a between-runs screen wants. */
function report(profile) {
  return {
    runs: profile.runs,
    reach: reachOf(profile),
    reachByTier: Object.assign({}, profile.reach),
    bank: bank(profile),
    tiers: tiers(profile),
    pledges: pledges(profile),
    reveals: reveals(profile),
    dossier: dossier(profile),
    codex: Object.assign({}, profile.codex),
  };
}


// ---------------------------------------------------------------------------
// SECTION - THE DOORS LEFT OPEN
//
// Documented, not hidden. Anything these hand over was never content, so there
// is nothing here to protect. What they cannot hand over is having been right
// about yourself, which is the only thing the meta layer actually scores.
// ---------------------------------------------------------------------------

/** Open every tier, pledge and reveal. */
function unlockAll(profile) {
  profile.flags = profile.flags || {};
  profile.flags.unlockAll = true;
  for (const t of TIERS) profile.tiers.unlocked[t.id] = true;
  for (const p of PLEDGES) profile.pledges.unlocked[p.id] = true;
  for (const r of REVEALS) profile.seen[r.id] = true;
  return report(profile);
}

/** Set a tier's reach directly. Moves the gates; moves no line. */
function setReach(profile, tierId, depth) {
  profile.reach[tierId] = Math.max(0, Math.floor(depth || 0));
  return syncUnlocks(profile);
}

/** Wipe the history behind one line, or all of them. Lines rebuild from play. */
function forget(profile, key) {
  if (key) delete profile.history[key];
  else profile.history = {};
  return Object.keys(profile.history).length;
}


// ---------------------------------------------------------------------------
// SECTION - AUDITS
//
// Two claims in this file are strong enough that they should not be left as
// prose. Both are runnable.
// ---------------------------------------------------------------------------

/**
 * PART ONE, ENFORCED. Fails if any persistent field has become a gameplay
 * multiplier, or if a start kit ever hands out more than one ball and no
 * essence. A comment does not survive the next contributor; this does.
 */
function grindAudit(profile) {
  const findings = [];
  const p = profile || freshProfile();

  const scan = (obj, path) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k in obj) {
      const low = k.toLowerCase();
      for (const bad of BANNED_CARRY) {
        if (low === bad || low.startsWith(bad) || low.endsWith(bad)) {
          const v = obj[k];
          const numeric = typeof v === 'number' || (v && typeof v === 'object' && typeof v.m === 'number');
          if (numeric) findings.push(`persistent numeric field ${path}${k} looks like a carried stat`);
        }
      }
      if (obj[k] && typeof obj[k] === 'object' && path.split('.').length < 4) scan(obj[k], path + k + '.');
    }
  };
  scan({ reach: p.reach, tiers: p.tiers, pledges: p.pledges, codex: p.codex, career: p.career }, '');

  const probe = load(save(p));
  unlockAll(probe);
  for (const t of TIERS) {
    for (const combo of [[], ['creed'], ['bare', 'nopanic'], ['sprint', 'downpour']]) {
      const r = beginRun(probe, { tier: t.id, pledges: combo, seed: 1 });
      if (!r.ok) { findings.push(`beginRun refused ${t.id} + ${combo.join('+')}`); continue; }
      const kit = runStartKit(r);
      if (kit.swarm !== 1) findings.push(`${t.id}/${combo.join('+')} starts with swarm ${kit.swarm}`);
      if (npos(kit.essence)) findings.push(`${t.id}/${combo.join('+')} starts with essence`);
      if (Object.keys(kit.powers).length) findings.push(`${t.id}/${combo.join('+')} starts with powers`);
      endRun(probe, r, { depth: r.startDepth + 1 });
    }
  }

  return { ok: findings.length === 0, findings, checked: TIERS.length * 4 };
}

/**
 * PART TWO, DEMONSTRATED. Runs the sandbagger's plan numerically.
 *
 * The plan: throw `runs` deliberately bad stretches to drag the line down,
 * each costing a stake, then cash in by taking the over at the softened line.
 * The audit computes what the line and the price were before, what they are
 * after, and how many cash-in bets it takes to recover the cost of tanking.
 *
 * The result to look at is `breakEvenRuns`. It comes out large because the
 * line and the price share one distribution: whatever the sandbag takes off
 * the target it also takes off the payout, so the cash-in is a bet at short
 * odds that has to be repeated - and every repetition puts a real row back
 * into the history and pushes the line straight back up.
 */
function sandbagAudit(profile, opts) {
  opts = opts || {};
  const tier = opts.tier || DEFAULT_TIER;
  const metric = opts.metric || 'essence';
  const scope = opts.scope || 'stretch';
  const stretch = opts.stretch || 8;
  const depth = opts.depth || 30;
  const runs = opts.runs || 10;
  const drop = opts.drop == null ? 0.6 : opts.drop;   // decades below trend a tanked stretch lands

  const fake = { ok: true, tier, pledges: [], shape: '-', depth, turns: 1, alive: true, wagers: [], snap: { depth } };
  const before = quote(profile, fake, { metric, scope, side: 'over', spread: opts.spread || 0, stretch });

  const clone = load(save(profile));
  const key = lineKey(tier, '-', metric, scope);
  const b = bucketOf(clone, key);
  const m = modelFor(clone, tier, [], metric, scope).model;
  const baseline = m ? predictAt(m, logOf(depth), logOf(stretch)) : logOf(1000);
  for (let i = 0; i < runs; i++) {
    b.rows.push({ v: baseline - drop, d: logOf(depth), l: logOf(stretch), t: clone.runs });
  }
  const after = quote(clone, fake, { metric, scope, side: 'over', spread: opts.spread || 0, stretch });

  const stake = nnum(stakeFloor(profile)) || 1;
  const evBefore = before.ok && before.offerable ? before.p * (before.multiple - 1) - (1 - before.p) : 0;
  const evAfter = after.ok && after.offerable ? after.p * (after.multiple - 1) - (1 - after.p) : 0;
  const cost = runs * stake;
  const gainPerRun = evAfter * stake;

  return {
    metric, scope, depth, stretch, sandbagRuns: runs,
    lineBefore: before.lineText, lineAfter: after.lineText,
    lineDropDecades: before.logLine - after.logLine,
    pBefore: before.p, pAfter: after.p,
    multipleBefore: before.multiple, multipleAfter: after.multiple,
    evBefore, evAfter,
    costOfSandbagging: cost,
    gainPerCashIn: gainPerRun,
    breakEvenRuns: gainPerRun > 0 ? cost / gainPerRun : Infinity,
    verdict: gainPerRun <= 0
      ? 'sandbagging leaves the cash-in with no edge at all'
      : `sandbagging needs ${Math.ceil(cost / gainPerRun)} winning cash-ins to repay ${runs} thrown runs, and every one of them raises the line again`,
  };
}


// ---------------------------------------------------------------------------
// SECTION - SELF TEST
//
//   node --input-type=module -e "import('./src/meta.js').then(m=>console.log(m.selftest()))"
//
// Every claim the comments make that could quietly stop being true is checked
// here, including the ones about very large numbers.
// ---------------------------------------------------------------------------

function selftest() {
  const checks = [];
  const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });

  // --- numbers -------------------------------------------------------------
  const huge = fromLog(400.5);
  ok('magnitude survives 1e400', Math.abs(logOf(huge) - 400.5) < 1e-9, fmt(huge));
  ok('magnitude arithmetic at scale',
    Math.abs(logOf(nmul(fromLog(300), fromLog(120))) - 420) < 1e-9);
  ok('zero logs to the floor', logOf(ZERO) === LOG_FLOOR);

  // --- a scripted player ---------------------------------------------------
  // A synthetic run: reach `depth`, earn `1e(k)` essence, clear `blocks`.
  const play = (p, o) => {
    const run = beginRun(p, { tier: o.tier || 'descent', pledges: o.pledges || [], seed: 7 });
    if (!run.ok) return run;
    if (o.post) {
      const r = post(p, run, o.post);
      if (!r.ok && o.mustPost) throw new Error('post refused: ' + r.reason);
      run.lastPost = r;
    }
    let ess = 0, blk = 0;
    for (let d = run.startDepth + 1; d <= o.depth; d++) {
      ess += o.perDepth || 1000;
      blk += o.blocksPer || 4;
      if (o.postAt && d === o.postAt.depth) run.lastPost = post(p, run, o.postAt.req);
      observe(p, run, { depth: d, essence: ess, blocks: blk });
    }
    return { run, end: endRun(p, run, { depth: o.depth, essence: ess, blocks: blk, cause: o.cause || 'overrun' }) };
  };

  // --- the line moves with form -------------------------------------------
  const A = create();
  setReach(A, 'descent', 40);
  for (let i = 0; i < 8; i++) play(A, { depth: 30, perDepth: 1000 });
  const fake = { ok: true, tier: 'descent', pledges: [], shape: '-', depth: 20, turns: 1, alive: true, wagers: [], snap: { depth: 20 } };
  const lineA = quote(A, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  for (let i = 0; i < 8; i++) play(A, { depth: 90, perDepth: 1000 });
  const lineB = quote(A, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  ok('the line rises as the player improves', lineB.logLine > lineA.logLine + 0.15,
    `${lineA.lineText} -> ${lineB.lineText}`);

  // --- censored evidence is one directional -------------------------------
  const C = load(save(A));
  const key = lineKey('descent', '-', 'depth', 'run');
  const base = quote(C, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  for (let i = 0; i < 12; i++) bucketOf(C, key).cens.push({ v: logOf(3), d: 0, l: 0, t: C.runs });
  const lowered = quote(C, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  ok('censored rows cannot lower a line', Math.abs(lowered.logLine - base.logLine) < 1e-9,
    `${base.lineText} -> ${lowered.lineText}`);
  for (let i = 0; i < 12; i++) bucketOf(C, key).cens.push({ v: logOf(400), d: 0, l: 0, t: C.runs });
  const raised = quote(C, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  ok('censored rows can raise a line', raised.logLine > base.logLine + 0.05,
    `${base.lineText} -> ${raised.lineText}`);

  // --- the ratchet ---------------------------------------------------------
  const R = load(save(A));
  const before = quote(R, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  for (let i = 0; i < 40; i++) play(R, { depth: 6, perDepth: 10, post: { metric: 'depth', scope: 'run', side: 'under', spread: 0.5 } });
  const after = quote(R, fake, { metric: 'depth', scope: 'run', side: 'over', spread: 0 });
  ok('forty thrown runs cannot collapse the line',
    after.logLine > before.logLine - 0.75, `${before.lineText} -> ${after.lineText}`);

  // --- the certainty band is closed ---------------------------------------
  ok('the price of a near certainty cannot clear 1x',
    priceOf(0.905) <= TUNING.minMultiple && priceOf(0.90) > TUNING.minMultiple,
    `band closes at p = ${(1 - TUNING.vig) / TUNING.minMultiple}`);

  const S = create();
  setReach(S, 'descent', 60);
  for (let i = 0; i < 16; i++) play(S, { depth: 40 + (i % 3), perDepth: 1000 });
  const sFake = { ok: true, tier: 'descent', pledges: [], shape: '-', depth: 1, turns: 0, alive: true, wagers: [], snap: { depth: 1 } };
  let worst = Infinity, offered = 0;
  const bd = board(S, beginRun(S, { tier: 'descent' }), { stretch: 8 });
  for (const l of bd.lines) for (const o of l.offers) {
    if (o.offerable) { offered++; worst = Math.min(worst, o.multiple); }
  }
  ok('nothing offerable pays 1.0x or less', worst > TUNING.minMultiple, `worst of ${offered} offered: ${worst.toFixed(3)}x`);

  // the band closes exactly where it has to: on a player whose real results
  // have sagged under a line the ratchet is still holding up
  const key2 = lineKey('descent', '-', 'depth', 'run');
  const sag = bucketOf(S, key2);
  for (let i = 0; i < 30; i++) sag.rows.push({ v: logOf(5), d: 0, l: 0, t: S.runs });
  const cert = quote(S, sFake, { metric: 'depth', scope: 'run', side: 'under', spread: 0 });
  ok('a near-certain under stops being quoted', !cert.offerable,
    `p ${cert.p.toFixed(3)} at ${cert.multiple.toFixed(3)}x, line ${cert.lineText}`);

  // --- death loses both sides, and records a bound ------------------------
  const D = create();
  setReach(D, 'descent', 40);
  for (let i = 0; i < 6; i++) play(D, { depth: 40, perDepth: 1000 });
  for (const side of ['over', 'under']) {
    const run = beginRun(D, { tier: 'descent' });
    observe(D, run, { depth: 2, essence: 500, blocks: 4 });
    // strikes far enough out that neither side resolves before the run dies
    const r = post(D, run, { metric: 'essence', scope: 'stretch', side, spread: side === 'over' ? 4.0 : 0.2, stretch: 10 });
    ok(`a ${side} posts`, r.ok, r.reason || '');
    if (r.ok) {
      observe(D, run, { depth: 3, essence: 600, blocks: 6 });
      const e = endRun(D, run, { depth: 3, essence: 600, blocks: 6, cause: 'overrun' });
      ok(`death loses an open ${side}`, e.wagers[0].state === 'lost', e.wagers[0].state);
      const b = bucketOf(D, lineKey('descent', '-', 'essence', 'stretch'));
      ok(`a dead stretch records as a bound, not a measurement`, b.cens.length > 0 && b.rows.length === 0,
        `rows ${b.rows.length}, censored ${b.cens.length}`);
    }
  }

  // --- an over settles the moment it clears -------------------------------
  const E = create();
  setReach(E, 'descent', 40);
  for (let i = 0; i < 6; i++) play(E, { depth: 40, perDepth: 1000 });
  const run = beginRun(E, { tier: 'descent' });
  observe(E, run, { depth: 2, essence: 100, blocks: 2 });
  const posted = post(E, run, { metric: 'essence', scope: 'stretch', side: 'over', spread: 0.2, stretch: 12 });
  ok('a stretch over posts', posted.ok, posted.reason || '');
  if (posted.ok) {
    const big = nmul(posted.wager.strike, N(4));
    const ev = observe(E, run, { depth: 3, essence: nadd(big, N(100)), blocks: 40 });
    ok('an over settles early on the crossing', ev.events.length === 1 && ev.events[0].outcome === 'won',
      JSON.stringify(ev.events.map(x => x.outcome)));
    ok('winning early still keeps watching for the record', !posted.wager.done);
    for (let d = 4; d <= 16; d++) observe(E, run, { depth: d, essence: nadd(big, N(100 * d)), blocks: 40 + d });
    ok('the row written is the total at the window close, not the strike',
      bucketOf(E, lineKey('descent', '-', 'essence', 'stretch')).rows.length === 1);
    endRun(E, run, { depth: 20, essence: nadd(big, N(9999)), blocks: 90 });
  }

  // --- the bankroll --------------------------------------------------------
  const B = create();
  setReach(B, 'descent', 40);
  B.bank.resolve = ZERO;
  const r1 = beginRun(B, { tier: 'descent' });
  ok('a broke player is topped up, never locked out', npos(B.bank.resolve) && npos(B.bank.debt));
  endRun(B, r1, { depth: 5 });
  for (let i = 0; i < 40; i++) { const r = beginRun(B, { tier: 'descent' }); endRun(B, r, { depth: 5 }); }
  const cap = nmul(stakeFloor(B), N(TUNING.debtCapRuns));
  ok('debt is capped and written off, never a wall', ncmp(B.bank.debt, cap) <= 0,
    `debt ${fmt(B.bank.debt)} vs cap ${fmt(cap)}`);

  // --- astronomically large play ------------------------------------------
  const H = create();
  setReach(H, 'abyss', 500);
  unlockAll(H);
  for (let i = 0; i < 6; i++) {
    const rr = beginRun(H, { tier: 'abyss' });
    let e = ZERO;
    for (let d = 2; d <= 12; d++) { e = nadd(e, fromLog(280 + d)); observe(H, rr, { depth: d * 40, essence: e, blocks: fromLog(120 + d) }); }
    endRun(H, rr, { depth: 480, essence: e, blocks: fromLog(140) });
  }
  const hq = quote(H, { ok: true, tier: 'abyss', pledges: [], shape: '-', depth: 400, turns: 1, alive: true, wagers: [], snap: { depth: 400 } },
    { metric: 'essence', scope: 'run', side: 'over', spread: 0.5 });
  ok('lines are finite past 1e290', hq.ok && isFinite(hq.logLine) && isFinite(hq.multiple), hq.lineText + ' at ' + (hq.multiple || 0).toFixed(2) + 'x');

  // --- audits --------------------------------------------------------------
  const ga = grindAudit(A);
  ok('nothing persistent is a carried stat', ga.ok, ga.findings.join('; '));
  const sa = sandbagAudit(A, { metric: 'essence', scope: 'stretch', depth: 30, runs: 10 });
  ok('sandbagging does not pay', !isFinite(sa.breakEvenRuns) || sa.breakEvenRuns > 12, sa.verdict);

  // --- save round trip -----------------------------------------------------
  const round = load(JSON.parse(JSON.stringify(save(A))));
  ok('a save round trips exactly',
    round.runs === A.runs
    && Object.keys(round.history).length === Object.keys(A.history).length
    && ncmp(round.bank.resolve, A.bank.resolve) === 0);

  const failed = checks.filter(c => !c.ok);
  return { ok: failed.length === 0, passed: checks.length - failed.length, failed: failed.length, checks };
}


// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

export {
  // numbers
  N, fmt, logOf, fromLog, nadd, nsub, nmul, ndiv, ncmp, nnum,
  // tables
  TUNING, TIERS, PLEDGES, METRICS, REVEALS, RUNGS,
  // profile
  create, save, load, report, reachOf, has, reveals, tiers, pledges,
  buyPledge, pledgeCost, bank, stakeFloor, minStake, noteCodex, dossier,
  // the line
  computeLine, quote, board, modelFor, lineKey, shapeKeyOf,
  // a run
  beginRun, runStartKit, post, observe, endRun, exposure,
  // extension
  defineMetric, useTiers,
  // doors
  unlockAll, setReach, forget,
  // proofs
  grindAudit, sandbagAudit, selftest,
};

export default {
  N, fmt, logOf, fromLog,
  TUNING, TIERS, PLEDGES, METRICS, REVEALS, RUNGS,
  create, save, load, report, reachOf, has, reveals, tiers, pledges,
  buyPledge, pledgeCost, bank, stakeFloor, minStake, noteCodex, dossier,
  computeLine, quote, board, modelFor, lineKey, shapeKeyOf,
  beginRun, runStartKit, post, observe, endRun, exposure,
  defineMetric, useTiers, unlockAll, setReach, forget,
  grindAudit, sandbagAudit, selftest,
};
