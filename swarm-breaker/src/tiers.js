// ===========================================================================
// Difficulty tiers
//
// Difficulty is SELECTED, not scaled. A run is played on a tier chosen before
// it starts, each tier has its own authored stretch with a real ending, and an
// endless stretch waits past that ending for anyone who wants it. There is no
// single curve that everybody rides forever.
//
// This module is pure logic. It holds no state, draws nothing, and imports
// nothing. It answers questions: what does this tier feed the swarm at this
// depth, how much health does a block carry, has the run finished, is the next
// tier open yet. The field generator, the powers layer, the market and the
// headless simulator all read the same answers, so a tier means the same thing
// everywhere.
//
// ---------------------------------------------------------------------------
// THE DIAL, AND WHY IT IS THIS ONE
//
// The run is decided by a race between two engines: how fast the swarm grows,
// and how fast health arrives on the field. Both grow linearly with depth, so
// their ratio is constant, so the race is settled in the first dozen turns and
// then never revisited. Measured on the headless simulator, that shows up as a
// tipping point rather than a curve: at every block health coefficient from
// 0.75 to 3.00, the share of runs reaching depth 20 and the share reaching
// depth 60 are the same number.
//
// A coefficient cannot fix that, because multiplying one side of a constant
// ratio only moves where the single decision lands. Measured directly, as the
// share of runs reaching depth 100:
//
//   dial                        casual     competent     best
//   block health 0.75             79%        100%        100%   the baseline
//   block health 3.00              0%         50%         63%
//   blocks per row +2              7%         88%        100%
//   swarm growth capped           79%        100%        100%   swarm 101 -> 33
//
// Health and density move the casual player and stop. The last row is the
// single most useful measurement here: capping swarm growth cut the swarm at
// depth 100 by two thirds and left all three audiences exactly where they
// started. Past the opening, swarm SIZE is not what keeps a run alive, so a
// dial aimed at the size of the swarm is not a dial.
//
// What does separate the audiences is the SUPPLY LINE - how much swarm the
// field hands back, and when. It is the one quantity the player's single
// decision actually touches. The angle chosen each turn does two jobs: it puts
// damage where the field threatens, and it collects the pickups that grow the
// swarm. When a pickup falls every row those jobs never compete, because a
// swarm of any size sweeps the board anyway, and every competent aim is as good
// as every other. Starve the line and the jobs compete: the angle that clears
// the row about to cross the line is usually not the angle that reaches the one
// pickup in the next four rows. That is a decision with a right answer that
// changes every turn, which is the only thing a difficulty dial can grip.
//
// Measured with resupply starved from the first row, block health held at
// 0.75, as the share of runs reaching depth 100:
//
//   pickups per row        competent      best      best minus competent
//   1.00                     100%         100%          0 points
//   0.30                     100%         100%          0 points
//   0.25                      55%          73%         18 points
//   0.22                      27%          46%         18 points
//   0.18                      23%          36%         14 points
//
// Twelve to eighteen points, repeatable across independent seeds, is the
// largest separation any dial tested produced. It is also graded rather than
// binary, which matters more: on the starved tiers the share of runs reaching
// depth 20 runs 13 to 27 points above the share reaching depth 60, so runs fail
// across the whole middle of the ladder. Every other dial tested left those two
// numbers equal at every setting, which is the original complaint restated.
//
// The same dial read from the other end fixes the casual player too: a run that
// opens with a swarm of 4 instead of 1 takes the casual finish rate from 83% to
// 100%, where cutting block health by 27% only reaches 93%. The opening is a
// supply problem, not a health problem.
//
// So one dial spans the whole ladder, expressed as three numbers - the RESUPPLY
// LINE:
//
//   start   how much swarm the run opens with
//   grace   how many depths resupply stays at one pickup a row
//   floor   what it drops to after that
//
// The bottom of the ladder is generous at all three and produces a graded
// casual curve. The top is starved at all three and produces a graded expert
// curve. Nothing else in the module is load bearing on difficulty, and the
// dials that are not load bearing say so in their own comments.
//
// ---------------------------------------------------------------------------
// WHAT ELSE IS IN HERE, AND WHAT IT IS FOR
//
//   health          the casual dial, labelled as such. It decides whether a
//                   beginner clears the opening. It does not touch strong play
//                   at any value and is not used to build the ladder.
//   density         texture. Structurally capped at six of eight columns
//                   because two always stay open, so its whole range is worth
//                   less than one health step.
//   soft ceiling    the WAITING dial, not a difficulty dial. Growth above a
//                   tier's soft swarm size pays diminishing returns. At the
//                   setting every tier ships it takes a third off the swarm and
//                   moves no audience at all, and at three times that strength
//                   it takes two thirds off and still moves nobody. Being
//                   inert is the qualification: it means it can be used for
//                   turn length instead. Launching alone costs a tick a ball,
//                   so a swarm in the hundreds spends seconds firing before
//                   anything happens. Overflow is paid out as essence, so a
//                   pickup a full swarm cannot absorb is still worth the angle
//                   that reaches it.
//   endless ramp    where the numbers go astronomical. Inside a tier's authored
//                   stretch health is exactly linear, which is the regime the
//                   ladder was measured in and the regime the swarm can win.
//                   Past the finish depth it turns geometric, so endless is a
//                   countdown rather than a ladder, and the question stops
//                   being whether and becomes how far.
//
// Rejected after measurement, kept here so it is not re-proposed: more than one
// row descending per turn. It separates the audiences (competent 25%, best 63%)
// but it kills the casual player outright at depth 11 and halves the number of
// decisions a run contains, which makes each decision matter less rather than
// more. Every tier ships at one row a turn; the hook stays so the number is
// visible rather than buried.
//
// ---------------------------------------------------------------------------
// WIRING - what the caller asks, and when
//
//   choosing a tier:      const t = tierOf('undertow');
//                         setTier(state, dialsFor(t));      // powers layer
//                         run.swarm = t.supply.start;
//
//   generating a row:     if (!spawnsRowAt(t, depth, mode)) -> the field is
//                            complete, the run is in its clearing phase
//                         fieldDescends(t, depth, mode) -> whether the field
//                            still closes on the swarm line this turn
//                         densityBiasAt(t, depth)  -> added to the generator's
//                            own regime bias, or
//                         shapeRow(t, depth, detail) -> the same adjustment
//                            applied to a row the generator already produced
//                         spawnsPickupAt(t, depth)   -> swarm pickup this row
//                         spawnsWindfallAt(t, depth) -> essence pickup this row
//                         healthAt(t, depth)         -> block health, magnitude
//
//   collecting a pickup:  const r = resupply(t, { swarm, carry, count: 1 });
//                         swarm += r.balls; carry = r.carry;
//                         essence += overflowEssence(t, depth, r.overflow);
//
//   ending a turn:        const p = progressOf(t, { depth, blocks, sweepTurns });
//                         p.phase  -> 'opening' | 'run' | 'clearing' |
//                                     'complete' | 'endless'
//                         p.finished, p.swept, p.endlessDepth
//
//   after a run:          const next = recordRun(save, { tier, depth, ... });
//                         unlockedTiers(next) -> what the menu may offer
//
// Every function is pure. Nothing here mutates its arguments.
// ===========================================================================


// ---------------------------------------------------------------------------
// MAGNITUDES
//
// Health and essence both run away past what a double can hold, so anything
// that can grow without bound is carried as a mantissa and a base ten exponent,
// the same {m, e} shape the powers and market layers use. A plain number is
// accepted anywhere a magnitude is, and small results still read as ordinary
// numbers, so a caller that never goes deep never has to think about this.
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js?v=16';

const ZERO = Object.freeze({ m: 0, e: 0 });

function norm(m, e) {
  if (!isFinite(m) || m === 0) return m === 0 ? ZERO : { m: m > 0 ? 1 : -1, e: 308 };
  const d = Math.floor(Math.log10(Math.abs(m)));
  if (d === 0) return { m, e };
  return { m: m / Math.pow(10, d), e: e + d };
}

/** Coerce a number or an {m, e} pair to a magnitude. */
function mag(v) {
  if (v == null) return ZERO;
  if (typeof v === 'number') return norm(v, 0);
  if (typeof v === 'object' && typeof v.m === 'number') return v;
  return ZERO;
}

function mmul(a, b) {
  a = mag(a); b = mag(b);
  if (a.m === 0 || b.m === 0) return ZERO;
  return norm(a.m * b.m, a.e + b.e);
}

/** A plain base raised to a plain exponent, evaluated in log space. */
function mpow(base, exp) {
  if (!(base > 0)) return ZERO;
  if (exp === 0) return { m: 1, e: 0 };
  const v = exp * Math.log10(base);
  const e = Math.floor(v);
  return { m: Math.pow(10, v - e), e };
}

function mlog10(a) {
  a = mag(a);
  return a.m === 0 ? -Infinity : a.e + Math.log10(Math.abs(a.m));
}

function mfloor(a) {
  a = mag(a);
  if (a.e > 15) return a;                    // already past integer resolution
  return norm(Math.floor(a.m * Math.pow(10, a.e)), 0);
}

/** Collapse to a plain number. Saturates rather than returning NaN. */
function mnum(a) {
  a = mag(a);
  if (a.m === 0) return 0;
  if (a.e > 308) return a.m > 0 ? Infinity : -Infinity;
  return a.m * Math.pow(10, a.e);
}

/** Deterministic hash, used only where a fractional setting has to become a
 *  whole block. Identical inputs always produce the identical row. */
function mix32(x) {
  x = x | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
const unit = (a, b) => mix32(mix32(a | 0) ^ Math.imul((b | 0) + 0x165667b1, 0x9e3779b1)) / 4294967296;


// ---------------------------------------------------------------------------
// SHAPE CONSTANTS
//
// Facts about the game the ladder is built on top of, kept in one place so a
// tier that violates one gets caught by checkLadder() rather than by a player.
// ---------------------------------------------------------------------------

/** Columns in the playfield, taken from config.js so every module measures the
 *  field the same way. */
const COLS = (CONFIG && CONFIG.board && CONFIG.board.cols > 3) ? CONFIG.board.cols : 8;

/** Hard ceiling on blocks in a row. Two columns always stay open, so density
 *  can never seal the field no matter what a tier asks for. */
const MAX_FILLED = COLS - 2;

/** Depth at which the market reveals its last instrument. Every tier must
 *  finish past this, or the tier hides content that was built to be seen. */
const CONTENT_HORIZON = 48;

/** Turns the clearing phase allows before the run advances anyway. A victory
 *  lap is a reward; a victory lap with no time limit is waiting. */
const SWEEP_TURNS = 5;

/** Essence an unabsorbed ball pays, as a share of one block's health. */
const OVERFLOW_SHARE = 0.25;


// ---------------------------------------------------------------------------
// THE LADDER
//
// Five tiers. Each is one point on the resupply line plus the supporting
// coefficients that give it a texture of its own.
//
//   supply.start   swarm the run opens with
//   supply.grace   depths of full resupply, one pickup a row
//   supply.floor   pickups a row after the grace ends
//   supply.windfall  essence pickups a row, flat for the whole run
//
//   field.densityBias    added to the generator's own per-regime bias
//   field.rowsPerTurn    rows descending per turn; one everywhere, see header
//
//   dials.hpRamp is parked at the finish depth and dials.hpGrowth at 1, so the
//   authored stretch is linear; see the health section for why.
//
//   swarm.soft, swarm.drag   the soft ceiling: growth above `soft` pays
//                            (soft / swarm) ^ drag, so the swarm keeps growing
//                            forever but stops doubling the wait every time it
//                            doubles the count
//
//   dials          handed straight to the powers layer's setTier(). Only keys
//                  that layer knows about live in here.
//
//   benchmark      median depth by audience, measured on the headless simulator
//                  with the shipped field generator and no finish cap. 120 is
//                  the measurement cap, so a 120 means the run was still alive
//                  when measuring stopped. Present so the simulator can
//                  regression check a tier, and so a wagered line has a prior
//                  before the player has a history of their own.
// ---------------------------------------------------------------------------

const LADDER = [
  {
    id: 'shallows',
    name: 'shallows',
    blurb: 'the swarm is fed. learn what it does.',
    tell: 'the easiest. a pickup every row, and you open with five',
    requires: null,
    finish: 60,
    supply: { start: 5, grace: Infinity, floor: 1, windfall: 1 / 3 },
    field: { densityBias: -0.35, rowsPerTurn: 1 },
    swarm: { soft: 24, drag: 1 },
    dials: {
      hpBase: 0.55, hpRamp: 60, hpGrowth: 1,
      endlessFrom: 60, endlessGrowth: 1.05,
      essenceExp: 0.75, essenceBase: 2.2, costDepth: 1.11, materialRate: 0.60,
    },
    endless: { floor: 1, densityBias: -0.35 },
    benchmark: { casual: 120, competent: 120, best: 120 },
  },
  {
    id: 'swell',
    name: 'swell',
    blurb: 'the line thins out. the angle starts to matter.',
    tell: 'resupply halves after depth 16',
    requires: null,
    finish: 60,
    supply: { start: 3, grace: 16, floor: 0.55, windfall: 1 / 3 },
    field: { densityBias: -0.15, rowsPerTurn: 1 },
    swarm: { soft: 24, drag: 1 },
    dials: {
      hpBase: 0.75, hpRamp: 60, hpGrowth: 1,
      endlessFrom: 60, endlessGrowth: 1.06,
      essenceExp: 0.75, essenceBase: 2.2, costDepth: 1.12, materialRate: 0.58,
    },
    endless: { floor: 1, densityBias: -0.15 },
    benchmark: { casual: 120, competent: 120, best: 120 },
  },
  {
    id: 'undertow',
    name: 'undertow',
    blurb: 'one pickup in three rows. choose which one you can reach.',
    tell: 'resupply falls to a third after depth 8',
    requires: 'swell',
    finish: 75,
    supply: { start: 2, grace: 8, floor: 0.35, windfall: 1 / 3 },
    field: { densityBias: 0, rowsPerTurn: 1 },
    swarm: { soft: 24, drag: 1 },
    dials: {
      hpBase: 0.75, hpRamp: 75, hpGrowth: 1,
      endlessFrom: 75, endlessGrowth: 1.07,
      essenceExp: 0.75, essenceBase: 2.4, costDepth: 1.13, materialRate: 0.55,
    },
    endless: { floor: 0.7, densityBias: 0 },
    benchmark: { casual: 55, competent: 120, best: 120 },
  },
  {
    id: 'maelstrom',
    name: 'maelstrom',
    blurb: 'almost nothing is given. one pickup in five rows.',
    tell: 'two turns of grace, and resupply never rises after them',
    requires: 'undertow',
    finish: 75,
    // OPENED UP, MEASURED 2026-08-28. It shipped at start 1 / grace 0, and on
    // the field as it now plays that is not a hard tier, it is a closed door: a
    // single body against a row of three blocks cannot out-damage the row that
    // arrives behind it, so every run ended between depth 9 and 11 and a player
    // paying close attention got no further than one firing at random. A tier
    // nobody can move inside is not difficulty, it is a wall with a number on
    // it. The ladder's own finding is that the opening is a supply problem and
    // not a health one, so the opening is what moved and the starved resupply
    // that actually defines this tier did not.
    supply: { start: 3, grace: 2, floor: 0.22, windfall: 1 / 3 },
    field: { densityBias: 0, rowsPerTurn: 1 },
    swarm: { soft: 24, drag: 1 },
    dials: {
      hpBase: 0.75, hpRamp: 75, hpGrowth: 1,
      endlessFrom: 75, endlessGrowth: 1.08,
      essenceExp: 0.75, essenceBase: 2.6, costDepth: 1.14, materialRate: 0.52,
    },
    endless: { floor: 0.7, densityBias: 0 },
    benchmark: { casual: 11, competent: 22, best: 120 },
  },
  {
    id: 'abyss',
    name: 'abyss',
    blurb: 'two balls, one pickup in six rows. every angle is the only angle.',
    tell: 'the hardest. it feeds you almost nothing, and never relents',
    requires: 'maelstrom',
    finish: 90,
    // Same correction as maelstrom above, one rung meaner: enough of an opening
    // to have a run at all, and the thinnest resupply on the ladder kept
    // exactly as it was.
    supply: { start: 2, grace: 1, floor: 0.18, windfall: 1 / 3 },
    field: { densityBias: 0, rowsPerTurn: 1 },
    swarm: { soft: 24, drag: 1 },
    dials: {
      hpBase: 0.75, hpRamp: 90, hpGrowth: 1,
      endlessFrom: 90, endlessGrowth: 1.10,
      essenceExp: 0.75, essenceBase: 2.8, costDepth: 1.15, materialRate: 0.50,
    },
    endless: { floor: 0.6, densityBias: 0 },
    benchmark: { casual: 11, competent: 17, best: 21 },
  },
];

// WHAT THE LADDER MEASURES OUT AT. Share of runs finishing the tier, on the
// shipped field generator, 36 runs an audience and 22 for the two that probe:
//
//   tier        start/grace/floor   finish   casual   competent   best
//   shallows      5 / all  / 1.00     60      100%      100%      100%
//   swell         3 /  16  / 0.55     60       97%      100%      100%
//   undertow      2 /   8  / 0.35     75       47%      100%      100%
//   maelstrom     1 /   0  / 0.22     75        0%       37%       51%
//   abyss         1 /   0  / 0.18     90        0%       18%       25%
//
// The top two are pooled over two independent seeds at 60 runs an audience;
// they separate by 14 and 8 points and hold their order on both seeds. Their
// failures spread from depth 14 to depth 60 rather than piling up before 15,
// which is the whole difference between a ladder and a tipping point.
//
// TWO THINGS THAT LOOK WRONG IN THAT TABLE AND ARE NOT.
//
// Block health stops moving above swell. That is not an oversight - it is the
// finding. Raising it on the top two tiers was measured and it collapsed the
// separation between a competent player and an expert from eighteen points to
// zero, by killing both of them at the same depth. Health has one job at the
// bottom of the ladder and no job at the top.
//
// Density stops moving at undertow, for the same reason. Every second source of
// pressure added on top of a starved supply line flattened the tier back into
// the tipping point it was built to replace. The top two tiers ship on the
// generator's own density because that is the configuration the ladder was
// measured in.

// Configured overrides are folded in before anything is frozen, so a number
// tuned in config.js means the same thing to every module that reads a tier.
// Only the keys named are replaced; the rest of the tier is left alone.
(function applyTierOverrides() {
  const patch = (CONFIG && CONFIG.difficulty && CONFIG.difficulty.tierOverrides) || null;
  if (!patch) return;
  for (const t of LADDER) {
    const p = patch[t.id];
    if (!p) continue;
    for (const group of Object.keys(p)) {
      const value = p[group];
      if (value && typeof value === 'object' && t[group] && typeof t[group] === 'object') {
        Object.assign(t[group], value);
      } else {
        t[group] = value;
      }
    }
  }
})();

// Index and freeze. A tier record is read by four other modules; none of them
// should be able to bend one mid-run.
LADDER.forEach((t, i) => { t.index = i; });
const BY_ID = Object.create(null);
for (const t of LADDER) {
  Object.freeze(t.supply); Object.freeze(t.field); Object.freeze(t.swarm);
  Object.freeze(t.dials); Object.freeze(t.endless); Object.freeze(t.benchmark);
  BY_ID[t.id] = Object.freeze(t);
}

/** Every tier, easiest first. */
export const TIERS = Object.freeze(LADDER.slice());

/** Tier ids in ladder order. */
export const TIER_IDS = Object.freeze(LADDER.map(t => t.id));

/** The tier a player who has never chosen one gets. */
export const DEFAULT_TIER =
  (CONFIG && CONFIG.difficulty && BY_ID[CONFIG.difficulty.defaultTier])
    ? CONFIG.difficulty.defaultTier
    : 'swell';

/**
 * Look up a tier by id, by index, or pass one through.
 * @param {string|number|object} which
 * @returns {object|null}
 */
export function tierOf(which) {
  if (which == null) return BY_ID[DEFAULT_TIER];
  if (typeof which === 'object') return BY_ID[which.id] || null;
  if (typeof which === 'number') return LADDER[which] || null;
  return BY_ID[which] || null;
}

/** The tier one step harder, or null at the top. */
export function nextTier(which) {
  const t = tierOf(which);
  return t ? (LADDER[t.index + 1] || null) : null;
}

/** Throwing lookup, for callers that would rather fail loudly. */
function need(which) {
  const t = tierOf(which);
  if (!t) throw new Error('unknown difficulty tier: ' + String(which && which.id ? which.id : which));
  return t;
}


// ---------------------------------------------------------------------------
// THE RESUPPLY LINE
//
// The ladder itself. Supply is a step, not a fade: full through the grace, the
// tier's floor from then on. A fade was measured and does not work - spread
// over twenty depths it lands entirely after the run has already been decided,
// and every audience finishes every tier. A step lands while the swarm is still
// small enough for the difference to be felt.
// ---------------------------------------------------------------------------

/**
 * Swarm pickups per row at a depth. A rate, not a count - see spawnsPickupAt
 * for the row by row answer.
 *
 * @param {object|string} which  tier
 * @param {number} depth
 * @param {string} [mode]  'ladder' (default) or 'endless'
 * @returns {number} pickups per row, 0 to 1
 */
export function supplyAt(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  if (mode === 'endless' && d > t.finish) return t.endless.floor;
  return d <= t.supply.grace ? 1 : t.supply.floor;
}

/** Total pickups the line has issued through a depth. Closed form, so any
 *  depth can be asked about without walking the ones before it. */
function supplyThrough(t, depth, mode) {
  const d = Math.max(0, Math.floor(depth) || 0);
  if (d <= 0) return 0;
  const grace = Math.min(d, t.supply.grace === Infinity ? d : t.supply.grace);
  let total = grace + Math.max(0, d - grace) * t.supply.floor;
  if (mode === 'endless' && d > t.finish) {
    const past = d - t.finish;
    total = supplyThrough(t, t.finish, 'ladder') + past * t.endless.floor;
  }
  return total;
}

/**
 * Does a swarm pickup arrive with the row at this depth? Deterministic and
 * evenly spaced, so a player can see the next one coming and plan the angle
 * that reaches it. That planning is the skill the ladder is built on; hiding
 * the cadence behind randomness would remove it.
 */
export function spawnsPickupAt(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  return Math.floor(supplyThrough(t, d, mode) + 1e-9)
       > Math.floor(supplyThrough(t, d - 1, mode) + 1e-9);
}

/** Rows until the next swarm pickup, counting from the depth after this one.
 *  Zero means one arrives with the next row. Feeds the readout that lets a
 *  player decide whether to spend a turn reaching for it. */
export function rowsToNextPickup(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  const rate = supplyAt(t, d + 1, mode);
  const horizon = rate > 0 ? Math.ceil(2 / rate) + 2 : 64;
  for (let i = 1; i <= horizon; i++) if (spawnsPickupAt(t, d + i, mode)) return i - 1;
  return -1;
}

/** Does an essence pickup arrive with this row? Held flat across the ladder:
 *  a hard tier starves the swarm, not the market, because the market is one of
 *  the ways out of being starved. */
export function spawnsWindfallAt(which, depth) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  const r = t.supply.windfall;
  return Math.floor(d * r + 1e-9) > Math.floor((d - 1) * r + 1e-9);
}


// ---------------------------------------------------------------------------
// THE SOFT CEILING
//
// Not a difficulty dial, and it earns its place by being measured as one and
// failing. At the shipped setting the swarm at depth 100 falls from 101 to 63
// and every audience lands exactly where it landed without it; at three times
// the strength the swarm falls to 33 and every audience still lands there. Only
// past anything shipped does it finally start costing the casual player, which
// is the boundary the setting stays inside.
//
// Being inert is the qualification. What it buys is time: launching alone costs
// a tick a ball, so a swarm in the hundreds spends seconds firing before
// anything happens, and endless would otherwise run the count into the
// thousands. The ceiling holds the count where a turn stays short, and pays the
// difference out as essence, so a pickup a full swarm cannot absorb is still
// worth the angle that reaches it.
// ---------------------------------------------------------------------------

/**
 * What one unit of new swarm is worth at the current size.
 * @returns {number} 0 to 1
 */
export function absorption(which, swarm) {
  const t = need(which);
  const soft = t.swarm.soft, drag = t.swarm.drag;
  if (!(drag > 0) || !(soft > 0)) return 1;
  const n = mlog10(mag(swarm));
  const s = Math.log10(soft);
  if (!(n > s)) return 1;
  const f = Math.pow(10, -drag * (n - s));
  return f > 0 ? f : 0;
}

/**
 * Resupply the swarm. The caller owns the fractional carry so this stays pure:
 * pass back what the last call returned.
 *
 * @param {object|string} which
 * @param {object} at
 * @param {number|object} at.swarm  current swarm, number or magnitude
 * @param {number} [at.carry]       fraction left over from the last pickup
 * @param {number} [at.count]       balls the pickup is worth before the ceiling
 * @returns {{balls: number, carry: number, overflow: number, absorbed: number}}
 */
export function resupply(which, at) {
  const t = need(which);
  const count = at && at.count != null ? at.count : 1;
  const carry = at && at.carry ? at.carry : 0;
  const f = absorption(t, at ? at.swarm : 0);
  const gained = count * f + carry;
  const balls = Math.floor(gained);
  return {
    balls,
    carry: gained - balls,
    overflow: count * (1 - f),
    absorbed: f,
  };
}

/**
 * Essence paid for swarm the ceiling would not absorb, priced against what a
 * block at this depth is worth so it keeps its value as the numbers climb.
 * @returns {{m: number, e: number}} magnitude
 */
export function overflowEssence(which, depth, overflow, mode) {
  const t = need(which);
  if (!(overflow > 0)) return ZERO;
  return mmul(healthAt(t, depth, mode), overflow * OVERFLOW_SHARE);
}


// ---------------------------------------------------------------------------
// THE FIELD
//
// Density is texture, not the ladder. Its entire range is worth less than one
// step of block health, because two columns always stay open and the generator
// already refuses to fill more than six of eight. It is here so a hard tier
// reads as heavier at a glance, and it is expressed as a bias on the
// generator's own per-regime bias rather than as a block count, so every regime
// keeps its shape at every tier.
// ---------------------------------------------------------------------------

/**
 * Bias to add to the field generator's per-regime density bias.
 *
 * MEASURED 2026-08-28, AND WORTH KNOWING BEFORE TRUSTING THE LADDER TABLE:
 * NOTHING IN THE DESCENDING MODES READS THIS. src/patterns.js is built from a
 * seed alone and has its own per-regime bias; the only paths that ever consult
 * a tier's density are shapeRow() and densityDeltaAt() below, and neither is
 * called by the game. The growing field is the one mode that does read it, via
 * the board view.
 *
 * So the ladder table's line that "density stops moving at undertow" describes
 * the simulator it was measured on rather than the field a player meets, and a
 * tier's field.densityBias currently changes nothing about the main game.
 * Confirmed by shifting it across the whole ladder and measuring zero change in
 * either player's median depth at any setting.
 *
 * It is left connected rather than deleted because the growing field does use
 * it and because wiring it into the others is a live option - but the ladder's
 * own finding argues against doing so: every second source of pressure stacked
 * on top of a starved supply line flattened the tiers back into the single
 * tipping point they were built to replace.
 */
export function densityBiasAt(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  if (mode === 'endless' && d > t.finish) return t.endless.densityBias;
  return t.field.densityBias;
}

/**
 * The same adjustment as a whole number of blocks, for a caller working with a
 * row the generator has already produced. The fraction is dithered from the
 * depth rather than rounded, so the average density tracks the bias exactly
 * instead of quantising into visible steps.
 */
export function densityDeltaAt(which, depth, mode) {
  const b = densityBiasAt(which, depth, mode);
  const whole = Math.trunc(b);
  const frac = Math.abs(b - whole);
  const extra = unit(Math.floor(depth) || 1, 0x5be1) < frac ? Math.sign(b) : 0;
  return whole + extra;
}

/**
 * Apply a tier's density to a row the generator has already produced, using the
 * generator's own column weights and its own corridor. Two columns always stay
 * open, so a tier can never seal the field.
 *
 * @param {object|string} which
 * @param {number} depth
 * @param {Array<{col: number, on: boolean, weight: number, role: string}>} detail
 *        the per column detail the field generator exposes
 * @returns {boolean[]} one entry per column, true where a block belongs
 */
export function shapeRow(which, depth, detail, mode) {
  const cells = detail.map(d => !!d.on);
  const delta = densityDeltaAt(which, depth, mode);
  if (!delta) return cells;

  const base = cells.filter(Boolean).length;
  const want = Math.max(1, Math.min(MAX_FILLED, base + delta));
  if (want === base) return cells;

  const pool = detail
    .filter(d => d.role !== 'corridor')
    .slice()
    .sort((a, b) => (b.weight - a.weight) || (a.col - b.col));

  const out = new Array(cells.length).fill(false);
  for (let i = 0; i < Math.min(want, pool.length); i++) out[pool[i].col] = true;
  return out;
}

/** Rows arriving per turn. One on every tier - see the header for the
 *  measurement that rejected anything else. */
export function rowsArrivingAt(which) {
  return need(which).field.rowsPerTurn;
}

/**
 * Is the field still producing rows? In ladder mode it stops at the finish
 * depth, which is what gives the run an ending to play rather than a number to
 * stop at. In endless it never stops.
 */
export function spawnsRowAt(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  return mode === 'endless' ? true : d <= t.finish;
}

/**
 * Does the field still close on the swarm line this turn? It stops once the
 * last row of a tier has arrived. Nothing new is coming, so what is left on the
 * board is something to break rather than a threat still closing, and a run
 * cannot be lost on its own victory lap.
 */
export function fieldDescends(which, depth, mode) {
  return spawnsRowAt(which, depth, mode);
}


// ---------------------------------------------------------------------------
// HEALTH
//
// The casual dial. It decides whether a beginner clears the opening and nothing
// else: moved from 0.75 to 3.00 it swings the casual finish rate by most of its
// range and leaves best play where it was. It is set per tier because a tier
// should feel heavier as well as be harder, not because the ladder rests on it.
//
// The shape matches the powers layer exactly, so a caller that reads health
// from either gets the same number:
//
//   floor( (1 + hpBase * d) * hpGrowth ^ (d - hpRamp) * endlessGrowth ^ (d - finish) )
//
// Every tier sets hpGrowth to 1, which makes health exactly linear for the
// whole authored stretch. That is deliberate and it is the regime the ladder
// was measured in: a geometric term inside the run would move the casual dial
// by a factor of five at the finish depth, undoing the only thing health is
// there to do. The geometry lives past the finish instead, where endlessGrowth
// takes over and health compounds while the swarm can only add. Endless
// therefore always ends, which is the point of endless.
// ---------------------------------------------------------------------------

/**
 * Block health at a depth, as a magnitude.
 * @returns {{m: number, e: number}}
 */
export function healthAt(which, depth, mode) {
  const t = need(which);
  const d = Math.max(1, Math.floor(depth) || 1);
  const dl = t.dials;
  // One number over the whole ladder, so a tier keeps the shape it was authored
  // with and only the overall weight moves. See difficulty.healthScale.
  const scale = (CONFIG && CONFIG.difficulty && Number(CONFIG.difficulty.healthScale) > 0)
    ? Number(CONFIG.difficulty.healthScale) : 1;
  let hp = mag((1 + dl.hpBase * d) * scale);
  if (d > dl.hpRamp) hp = mmul(hp, mpow(dl.hpGrowth, d - dl.hpRamp));
  if (dl.endlessFrom != null && d > dl.endlessFrom && mode === 'endless') {
    hp = mmul(hp, mpow(dl.endlessGrowth, d - dl.endlessFrom));
  }
  return mfloor(hp);
}

/** Block health as a plain number, saturating at Infinity rather than NaN.
 *  For the shallow depths a renderer actually prints. */
export function healthNumber(which, depth, mode) {
  return mnum(healthAt(which, depth, mode));
}

/** Health as a base ten exponent. Cheap, and safe at any depth. */
export function healthLog10(which, depth, mode) {
  return mlog10(healthAt(which, depth, mode));
}

/**
 * The scaling dials the powers layer honours, ready for its setTier(). Returned
 * as a fresh object so a caller may override one without touching the ladder.
 */
export function dialsFor(which) {
  return Object.assign({}, need(which).dials);
}

/** Everything the field generator and the turn loop need, in one object. */
export function fieldFor(which, mode) {
  const t = need(which);
  return {
    densityBias: mode === 'endless' ? t.endless.densityBias : t.field.densityBias,
    rowsPerTurn: t.field.rowsPerTurn,
    maxFilled: MAX_FILLED,
    supplyFloor: mode === 'endless' ? t.endless.floor : t.supply.floor,
    supplyGrace: t.supply.grace,
    windfall: t.supply.windfall,
    startSwarm: t.supply.start,
    softSwarm: t.swarm.soft,
    swarmDrag: t.swarm.drag,
  };
}


// ---------------------------------------------------------------------------
// FINISHING, AND ENDLESS
//
// A tier is finished by surviving to its finish depth. Rows stop arriving
// there, and the field stops closing with them, so the last thing a tier asks
// is an act rather than a counter: break what is still standing. The run ends
// on the last block rather than on a number ticking over, and it cannot be lost
// during the clearing, because nothing is moving toward the line any more.
//
// Clearing inside SWEEP_TURNS marks the sweep, which is the clean version of a
// finish and the thing to come back for. The budget exists because an unbounded
// victory lap is waiting, and waiting is never the content.
//
// Endless begins the depth after the finish. It is not the same run continued:
// health turns geometric, resupply relaxes back toward full because the swarm
// now has an exponential to chase, and the score is the depth past the finish.
// ---------------------------------------------------------------------------

/**
 * Where a run stands.
 *
 * @param {object|string} which
 * @param {object} run
 * @param {number} run.depth        current depth
 * @param {number} run.blocks       blocks still on the field
 * @param {number} [run.sweepTurns] turns spent in the clearing phase
 * @param {string} [run.mode]       'ladder' (default) or 'endless'
 * @returns {{phase: string, finished: boolean, swept: boolean,
 *            endlessDepth: number, sweepLeft: number, toFinish: number}}
 */
export function progressOf(which, run) {
  const t = need(which);
  const d = Math.max(1, Math.floor((run && run.depth) || 1));
  const blocks = Math.max(0, (run && run.blocks) || 0);
  const spent = Math.max(0, (run && run.sweepTurns) || 0);
  const mode = (run && run.mode) === 'endless' ? 'endless' : 'ladder';

  if (mode === 'endless') {
    return {
      phase: 'endless', finished: true, swept: false,
      endlessDepth: Math.max(0, d - t.finish), sweepLeft: 0, toFinish: 0,
    };
  }

  const past = d >= t.finish;
  const clean = past && blocks === 0 && spent <= SWEEP_TURNS;
  const phase = past ? (blocks === 0 ? 'complete' : 'clearing')
                     : (d <= t.supply.grace ? 'opening' : 'run');

  return {
    phase,
    finished: past,
    swept: clean,
    endlessDepth: 0,
    sweepLeft: past ? Math.max(0, SWEEP_TURNS - spent) : SWEEP_TURNS,
    toFinish: Math.max(0, t.finish - d),
  };
}

/** Depth past the tier's finish, which is the endless score. */
export function endlessDepth(which, depth) {
  const t = need(which);
  return Math.max(0, (Math.floor(depth) || 0) - t.finish);
}

/** May this run carry on into endless? Only a finished one may. */
export function canEnterEndless(which, run) {
  return progressOf(which, run).finished;
}


// ---------------------------------------------------------------------------
// UNLOCKS
//
// The first two tiers are open from the start, so nobody is gated out of the
// game and nobody who already knows it is made to sit through a tutorial. The
// top three are earned, one at a time, by finishing the tier below.
//
// The reason for the split is what a wall teaches. A player who meets the abyss
// first learns only that the game is unfair, because the abyss is a test of a
// decision they have not been shown yet - which pickup is worth the angle. A
// player who reaches it through undertow has been taught that decision by a
// tier that lets them lose it a few times and live.
// ---------------------------------------------------------------------------

/** A fresh, empty progress record. Plain data, JSON round-trips cleanly. */
export function emptyProgress() {
  return { best: {}, finished: {}, swept: {}, endless: {} };
}

/**
 * Fold a completed run into a progress record. Pure - returns a new record and
 * never touches the one passed in.
 *
 * @param {object} progress
 * @param {object} result
 * @param {object|string} result.tier
 * @param {number} result.depth
 * @param {boolean} [result.finished]
 * @param {boolean} [result.swept]
 * @param {string} [result.mode]
 */
export function recordRun(progress, result) {
  const t = need(result && result.tier);
  const p = progress || emptyProgress();
  const next = {
    best: Object.assign({}, p.best),
    finished: Object.assign({}, p.finished),
    swept: Object.assign({}, p.swept),
    endless: Object.assign({}, p.endless),
  };
  const depth = Math.max(0, Math.floor(result.depth) || 0);
  next.best[t.id] = Math.max(next.best[t.id] || 0, depth);
  if (result.finished) next.finished[t.id] = true;
  if (result.swept) next.swept[t.id] = true;
  if (result.mode === 'endless') {
    next.endless[t.id] = Math.max(next.endless[t.id] || 0, endlessDepth(t, depth));
  }
  return next;
}

/**
 * Is a tier available?
 * @param {object} progress
 * @param {object|string} which
 * @param {object} [opts]
 * @param {boolean} [opts.unlockAll] open everything, for a headless run or for
 *        a player who would rather not be gated
 */
export function isUnlocked(progress, which, opts) {
  const t = need(which);
  if (opts && opts.unlockAll) return true;
  if (!t.requires) return true;
  const p = progress || emptyProgress();
  return !!(p.finished && p.finished[t.requires]);
}

/** Every tier a menu may offer right now, easiest first. */
export function unlockedTiers(progress, opts) {
  return LADDER.filter(t => isUnlocked(progress, t, opts));
}

/** The hardest tier the player has finished, or null. */
export function highestFinished(progress) {
  const p = progress || emptyProgress();
  let out = null;
  for (const t of LADDER) if (p.finished && p.finished[t.id]) out = t;
  return out;
}

/**
 * What the menu should have selected when it opens: the hardest unlocked tier
 * the player has not finished yet. A player who has beaten swell is pointed at
 * undertow, not back down the ladder at a tier they skipped.
 */
export function suggestedTier(progress, opts) {
  const open = unlockedTiers(progress, opts);
  if (!open.length) return BY_ID[DEFAULT_TIER];
  const p = progress || emptyProgress();
  let pick = null;
  for (const t of open) if (!(p.finished && p.finished[t.id])) pick = t;
  return pick || open[open.length - 1];
}


// ---------------------------------------------------------------------------
// READOUTS
// ---------------------------------------------------------------------------

/**
 * Player facing description of a tier. Text only; the caller decides how to
 * draw it. Nothing here names a coefficient, because a coefficient is not what
 * the player is choosing between.
 */
export function describe(which) {
  const t = need(which);
  const s = t.supply;
  const line = s.floor >= 1 ? 'a pickup every row, the whole way down'
    : s.grace > 0
      ? `a pickup every row to depth ${s.grace}, then one in ${Math.round(1 / s.floor)}`
      : `one pickup in ${Math.round(1 / s.floor)} rows, from the first row`;
  return {
    id: t.id,
    name: t.name,
    blurb: t.blurb,
    tell: t.tell,
    supplyLine: line,
    opens: `you start with ${s.start}`,
    ends: `depth ${t.finish}, then endless`,
    locked: t.requires ? `finish ${t.requires} first` : null,
  };
}

/**
 * The depth a run on this tier is expected to reach, blended from the tier's
 * measured benchmark and the player's own recent history. A line has to come
 * from somewhere before a player has a history, and the tier is the only thing
 * that knows the prior.
 *
 * @param {object|string} which
 * @param {number[]} [history] recent depths on this tier, most recent last
 * @param {string} [audience] 'casual' | 'competent' | 'best' when there is no
 *        history at all; defaults to the middle of the three
 */
export function expectedDepth(which, history, audience) {
  const t = need(which);
  const prior = t.benchmark[audience || 'competent'];
  const runs = (history || []).filter(x => x > 0).slice(-8);
  if (!runs.length) return prior;
  // Recent runs are weighted up, so a line follows a player who is improving
  // rather than averaging away the improvement.
  let num = 0, den = 0;
  runs.forEach((d, i) => { const w = i + 1; num += d * w; den += w; });
  const seen = num / den;
  const trust = Math.min(1, runs.length / 6);
  return Math.round(seen * trust + prior * (1 - trust));
}


// ---------------------------------------------------------------------------
// SELF CHECK
//
// The ladder has to be monotone to be a ladder, and every tier has to run past
// the last thing the game has to show. Both are easy to break by editing one
// number, so both are checked rather than trusted. Returns a report instead of
// throwing, so a headless run can print it.
// ---------------------------------------------------------------------------

export function checkLadder() {
  const problems = [];
  const seen = Object.create(null);
  let prev = null;

  for (const t of LADDER) {
    if (seen[t.id]) problems.push(`duplicate tier id ${t.id}`);
    seen[t.id] = true;

    if (t.finish < CONTENT_HORIZON) {
      problems.push(`${t.id} finishes at ${t.finish}, before the last market reveal at ${CONTENT_HORIZON}`);
    }
    if (!(t.supply.floor > 0 && t.supply.floor <= 1)) {
      problems.push(`${t.id} supply floor ${t.supply.floor} is outside 0 to 1`);
    }
    if (t.supply.start < 1) problems.push(`${t.id} opens with no swarm`);
    if (t.field.rowsPerTurn !== 1) {
      problems.push(`${t.id} descends ${t.field.rowsPerTurn} rows a turn; measured and rejected, see the header`);
    }
    if (t.dials.endlessFrom !== t.finish) {
      problems.push(`${t.id} starts endless at ${t.dials.endlessFrom} but finishes at ${t.finish}`);
    }
    if (!(t.dials.endlessGrowth > 1)) {
      problems.push(`${t.id} endless does not ramp, so it never ends`);
    }
    if (t.requires && !BY_ID[t.requires]) {
      problems.push(`${t.id} requires ${t.requires}, which is not a tier`);
    }
    if (t.requires && BY_ID[t.requires].index >= t.index) {
      problems.push(`${t.id} requires a tier at or above it in the ladder`);
    }

    if (prev) {
      // The ladder only means anything if every dial moves one way along it.
      if (t.supply.start > prev.supply.start) problems.push(`${t.id} opens with more swarm than ${prev.id}`);
      if (t.supply.grace > prev.supply.grace) problems.push(`${t.id} has a longer grace than ${prev.id}`);
      if (t.supply.floor > prev.supply.floor) problems.push(`${t.id} resupplies faster than ${prev.id}`);
      if (t.dials.hpBase < prev.dials.hpBase) problems.push(`${t.id} has lighter blocks than ${prev.id}`);
      if (t.field.densityBias < prev.field.densityBias) problems.push(`${t.id} has a thinner field than ${prev.id}`);
      if (t.finish < prev.finish) problems.push(`${t.id} finishes shallower than ${prev.id}`);
      if (t.swarm.soft > prev.swarm.soft) problems.push(`${t.id} carries a larger swarm than ${prev.id}`);
    }
    prev = t;
  }

  // A density bias must never be able to seal the field.
  for (const t of LADDER) {
    for (let d = 1; d <= 200; d++) {
      if (Math.abs(densityDeltaAt(t, d)) > MAX_FILLED - 1) {
        problems.push(`${t.id} asks for a density change of more than the field can hold at depth ${d}`);
        break;
      }
    }
  }

  // Health has to stay finite where a renderer will try to print it, and has to
  // keep climbing where endless needs it to.
  for (const t of LADDER) {
    if (!isFinite(healthNumber(t, t.finish))) {
      problems.push(`${t.id} health is already past a double at its own finish depth`);
    }
    const a = healthLog10(t, t.finish + 50, 'endless');
    const b = healthLog10(t, t.finish, 'endless');
    if (!(a > b + 1)) problems.push(`${t.id} endless barely ramps over fifty depths`);
  }

  return { ok: problems.length === 0, tiers: LADDER.length, problems };
}


export default {
  TIERS, TIER_IDS, DEFAULT_TIER,
  tierOf, nextTier,
  supplyAt, spawnsPickupAt, rowsToNextPickup, spawnsWindfallAt,
  absorption, resupply, overflowEssence,
  densityBiasAt, densityDeltaAt, shapeRow, rowsArrivingAt, spawnsRowAt, fieldDescends,
  healthAt, healthNumber, healthLog10, dialsFor, fieldFor,
  progressOf, endlessDepth, canEnterEndless,
  emptyProgress, recordRun, isUnlocked, unlockedTiers, highestFinished, suggestedTier,
  describe, expectedDepth, checkLadder,
};
