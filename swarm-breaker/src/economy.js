// ---------------------------------------------------------------------------
// Swarm Breaker - the market
//
// Blocks do not pay money. Blocks pay MATERIAL. Material only becomes money
// when somebody buys it, and the somebody buying it is a market with a finite
// book, a demand cycle, and a memory of everything you have already dumped on
// it. Upgrades are priced in material, not money, so what you produce and what
// you need are two different lists and the gap between them is the game.
//
// Everything here is deterministic. There is no randomness anywhere in this
// file. Every price at every future depth is computable from the depth, and a
// player who works out the rules can compute it too. That is the point: the
// market is meant to be solved, not gambled with.
//
// This module is pure logic. No DOM, no rendering, no timers, no network, no
// storage. Call it from a game loop; render whatever it returns however you
// like. State is a plain JSON-safe object, so JSON.stringify round-trips a
// save file with no custom serialiser.
//
// TWO NUMBER SPACES
//   Scale math  - balances, stock, prices, costs. These grow without bound and
//                 use LNum (mantissa + exponent), good past 10^(10^308).
//   Shape math  - elasticities, cycle amplitudes, spreads, ratios. These are
//                 always bounded near 1 and use ordinary floats.
//   Every formula below keeps the two apart on purpose. Ratios never overflow
//   because they are ratios; totals never lose precision because they are LNum.
// ---------------------------------------------------------------------------

export const VERSION = '1.0.0';

// ===========================================================================
// SECTION 1 - LNum: numbers that keep working after they stop being readable
// ===========================================================================
// An LNum is a plain object { m, e } meaning m * 10^e with 1 <= |m| < 10, or
// { m: 0, e: 0 } for zero. Plain objects, not a class, so JSON works and so
// state can be cloned with structuredClone or a spread.

const ZERO = () => ({ m: 0, e: 0 });

function norm(m, e) {
  if (!isFinite(m) || m === 0) return ZERO();
  let s = 1;
  if (m < 0) { s = -1; m = -m; }
  const d = Math.floor(Math.log10(m));
  if (isFinite(d) && d !== 0) {
    // split the shift so denormals and 1e308-scale values both survive
    const h = Math.trunc(d / 2);
    m = m * Math.pow(10, -h) * Math.pow(10, -(d - h));
    e += d;
  }
  while (m >= 10) { m /= 10; e++; }
  while (m > 0 && m < 1) { m *= 10; e--; }
  return { m: s * m, e };
}

/** Coerce a number, numeric string, or LNum into an LNum. */
export function L(x) {
  if (x && typeof x === 'object' && typeof x.m === 'number') return x;
  const n = typeof x === 'string' ? parseFloat(x) : x;
  if (typeof n !== 'number' || !isFinite(n) || n === 0) return ZERO();
  return norm(n, 0);
}

export function neg(a) { a = L(a); return a.m === 0 ? ZERO() : { m: -a.m, e: a.e }; }

export function add(a, b) {
  a = L(a); b = L(b);
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const hi = a.e >= b.e ? a : b;
  const lo = a.e >= b.e ? b : a;
  const d = hi.e - lo.e;
  if (d > 17) return hi;                       // the small one is below precision
  return norm(hi.m + lo.m / Math.pow(10, d), hi.e);
}

export function sub(a, b) { return add(a, neg(b)); }
export function mul(a, b) { a = L(a); b = L(b); if (a.m === 0 || b.m === 0) return ZERO(); return norm(a.m * b.m, a.e + b.e); }
export function div(a, b) { a = L(a); b = L(b); if (b.m === 0 || a.m === 0) return ZERO(); return norm(a.m / b.m, a.e - b.e); }

/** Multiply an LNum by an ordinary float. Used everywhere shape math meets scale math. */
export function scale(a, k) { return mul(a, L(k)); }

/** a ^ p for a float exponent p. Done in log space so the result cannot overflow. */
export function powNum(a, p) {
  a = L(a);
  if (a.m <= 0) return ZERO();
  const lg = (a.e + Math.log10(a.m)) * p;
  const e = Math.floor(lg);
  return { m: Math.pow(10, lg - e), e };
}

export function cmp(a, b) {
  a = L(a); b = L(b);
  if (a.m === 0 && b.m === 0) return 0;
  const sa = Math.sign(a.m), sb = Math.sign(b.m);
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.e !== b.e) return (a.e < b.e ? -1 : 1) * (sa < 0 ? -1 : 1);
  if (a.m === b.m) return 0;
  return a.m < b.m ? -1 : 1;
}

export const gte = (a, b) => cmp(a, b) >= 0;
export const lte = (a, b) => cmp(a, b) <= 0;
export const isPos = (a) => L(a).m > 0;

/** Convert to a float. Returns +/-Infinity above 1e300 and 0 below 1e-300. */
export function toNum(a) {
  a = L(a);
  if (a.m === 0) return 0;
  if (a.e > 300) return a.m > 0 ? Infinity : -Infinity;
  if (a.e < -300) return 0;
  return a.m * Math.pow(10, a.e);
}

export function floorL(a) {
  a = L(a);
  if (a.e >= 17) return a;                     // already an integer at this size
  return L(Math.floor(toNum(a)));
}

export function ceilL(a) {
  a = L(a);
  if (a.e >= 17) return a;
  return L(Math.ceil(toNum(a)));
}

export function minL(a, b) { return cmp(a, b) <= 0 ? L(a) : L(b); }
export function maxL(a, b) { return cmp(a, b) >= 0 ? L(a) : L(b); }

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Human-readable short form: 1.24K, 8.03Qa, 3.11e57. */
export function fmt(a, decimals = 2) {
  a = L(a);
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
  // rounding can push a mantissa to 1000.0; carry it into the next suffix
  if (v >= 999.995 && tier + 1 < SUFFIX.length) { tier += 1; v /= 1000; }
  if (tier < SUFFIX.length) return sign + v.toFixed(v >= 100 ? 0 : decimals) + SUFFIX[tier];
  return sign + m.toFixed(3) + 'e' + e;
}

// ===========================================================================
// SECTION 2 - the goods
// ===========================================================================
// Four raw materials come out of the field. Two refined goods and one apex
// good come out of the workshop. Every one of them has the same four dials:
//
//   elast   how hard it is to move the price. Deep books barely notice you.
//   amp     how far its demand cycle swings.
//   period  how many depths one full demand cycle takes.
//   regen   what fraction of the gap back to normal book depth closes per turn.
//
// The dials are ordered on purpose. Common goods have deep books, small
// swings, and fast recovery. Rare goods have thin books, violent swings, and
// slow recovery, which is exactly why a careless seller ruins a rare market
// for himself for a dozen turns and a careful one does not.

export const MATERIALS = [
  { id: 'slag',    name: 'slag',    tier: 'raw',     base: 4,   anchor: 900, elast: 0.55, amp: 0.10, period: 5,  phase: 0,  regen: 0.30, drop: 3 },
  { id: 'ferrite', name: 'ferrite', tier: 'raw',     base: 9,   anchor: 520, elast: 0.70, amp: 0.18, period: 7,  phase: 2,  regen: 0.26, drop: 2 },
  { id: 'quartz',  name: 'quartz',  tier: 'raw',     base: 16,  anchor: 300, elast: 0.85, amp: 0.26, period: 11, phase: 4,  regen: 0.22, drop: 1 },
  { id: 'cinder',  name: 'cinder',  tier: 'raw',     base: 30,  anchor: 170, elast: 0.95, amp: 0.34, period: 13, phase: 7,  regen: 0.18, drop: 1 },
  { id: 'alloy',   name: 'alloy',   tier: 'refined', base: 33,  anchor: 140, elast: 0.90, amp: 0.30, period: 8,  phase: 1,  regen: 0.20, drop: 0 },
  { id: 'lens',    name: 'lens',    tier: 'refined', base: 66,  anchor: 80,  elast: 1.05, amp: 0.38, period: 17, phase: 5,  regen: 0.16, drop: 0 },
  { id: 'core',    name: 'core',    tier: 'apex',    base: 140, anchor: 36,  elast: 1.20, amp: 0.45, period: 23, phase: 11, regen: 0.12, drop: 0 },
];

const BY_ID = Object.fromEntries(MATERIALS.map(m => [m.id, m]));
export const matDef = (id) => BY_ID[id] || null;

// Which material a column carries. The veins slide one column per depth, so
// the whole layout is visible on the board and its future is one addition away.
// Four of eight columns are slag, two ferrite, one quartz, one cinder.
const VEIN = ['slag', 'slag', 'ferrite', 'slag', 'quartz', 'ferrite', 'cinder', 'slag'];
const COLS = 8;

/** The material a block in this column at this depth is made of. */
export function materialOf(depth, col) {
  const i = ((Math.trunc(col) + Math.trunc(depth)) % COLS + COLS) % COLS;
  return VEIN[i];
}

// Refining. Each recipe loses a few percent to fees at neutral prices, so
// refining is never free money. It becomes profitable only when the output's
// demand is high while its inputs' demand is low, and both of those are
// cycles with known periods.
export const RECIPES = [
  { id: 'alloy', out: 'alloy', qty: 1, inputs: { ferrite: 3, slag: 1 }, fee: 0.02 },
  { id: 'lens',  out: 'lens',  qty: 1, inputs: { quartz: 2, cinder: 1 }, fee: 0.02 },
  { id: 'core',  out: 'core',  qty: 1, inputs: { alloy: 1, lens: 1, cinder: 1 }, fee: 0.03 },
];

const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));

// ===========================================================================
// SECTION 3 - market regimes
// ===========================================================================
// The field reorganises itself every six depths and the market reorganises
// with it. A regime lasts exactly six depths and the whole schedule is fixed,
// so the player always knows what the market will be doing six depths out.

export const REGIMES = [
  { id: 'scarcity',    name: 'scarcity',    mul: { raw: 1.25, refined: 1.05, apex: 1.00 }, regen: 0.60, spread: 0.06, amp: 1.00,
    note: 'raw goods are bid up and the book refills slowly' },
  { id: 'glut',        name: 'glut',        mul: { raw: 0.80, refined: 1.00, apex: 1.05 }, regen: 1.50, spread: 0.05, amp: 1.00,
    note: 'raw goods are cheap and the book refills fast' },
  { id: 'speculation', name: 'speculation', mul: { raw: 1.00, refined: 1.00, apex: 1.00 }, regen: 0.90, spread: 0.09, amp: 2.00,
    note: 'every cycle swings twice as far and spreads widen' },
  { id: 'guild',       name: 'guild',       mul: { raw: 0.95, refined: 1.60, apex: 1.20 }, regen: 1.00, spread: 0.05, amp: 1.10,
    note: 'refined goods are in demand' },
  { id: 'squeeze',     name: 'squeeze',     mul: { raw: 1.10, refined: 1.15, apex: 2.00 }, regen: 0.50, spread: 0.08, amp: 1.30,
    note: 'apex goods are scarce and the book barely refills' },
];

const EPOCH_LEN = 6;
const OPENING = [0, 0, 1, 2, 0, 3, 1];   // the first forty-two depths, fixed
const CYCLE = [1, 2, 4, 3, 0];           // then this five-regime rotation, forever

/** Which regime governs a given depth. Pure function of depth. */
export function regimeOf(depth) {
  const e = Math.max(0, Math.floor((Math.trunc(depth) - 1) / EPOCH_LEN));
  const i = e < OPENING.length ? OPENING[e] : CYCLE[(e - OPENING.length) % CYCLE.length];
  return REGIMES[i];
}

/** The depth at which the current regime ends and the next begins. */
export function nextRegimeDepth(depth) {
  const e = Math.max(0, Math.floor((Math.trunc(depth) - 1) / EPOCH_LEN));
  return (e + 1) * EPOCH_LEN + 1;
}

// Thin books cost more to cross regardless of regime.
const TIER_SPREAD = { raw: 0.00, refined: 0.01, apex: 0.02 };

// ===========================================================================
// SECTION 4 - the one scaling law
// ===========================================================================
// Block toughness, block payout, book depth, and base price all grow by the
// same factor. That makes the market scale-invariant: the shape of a decision
// at depth 12 and the shape of the same decision at depth 12,000 are identical
// and everything the player learned early keeps being true. It is also why
// this economy never needs new content to keep going.

const DEFAULT_HP = (d) => Math.max(1, Math.round(d * 1.35));

/** How many units of material one block's worth of toughness is worth. */
export function bulkOf(maxHp) { return 1 + Math.floor(Math.max(1, maxHp) / 6); }

/** The single scaling factor for the whole economy at a given depth. */
export function depthScale(state, depth) {
  return bulkOf(state.cfg.hpAt(Math.max(1, depth)));
}

// ===========================================================================
// SECTION 5 - the field, projected forward
// ===========================================================================
// A replica of the field generator, kept here so the market can price things
// it has not seen yet. The host may pass its own generator through the config
// if the field rules ever change; the default matches the shipped field.

const FIELD_RULES = [90, 90, 30, 110, 90, 150, 30];

function defaultRule(depth) {
  return FIELD_RULES[Math.min(Math.floor((depth - 1) / 6), FIELD_RULES.length - 1)];
}

function defaultRow(depth) {
  const rule = defaultRule(depth);
  const prev = [];
  for (let c = 0; c < COLS; c++) prev.push((Math.sin(depth * 7.13 + c * 3.77) * 10000 | 0) & 1);
  const out = [];
  for (let c = 0; c < COLS; c++) {
    const l = prev[(c - 1 + COLS) % COLS], m = prev[c], r = prev[(c + 1) % COLS];
    if ((rule >> ((l << 2) | (m << 1) | r)) & 1) out.push(c);
  }
  return out.length ? out : [(depth * 3) % COLS];
}

// ===========================================================================
// SECTION 6 - progressive reveal
// ===========================================================================
// A new player sees one good and one button. Everything else arrives on a
// fixed depth schedule, in the order it becomes useful. Nothing is ever hidden
// that the player already needed.

export const REVEALS = [
  { depth: 1,  id: 'yard',         title: 'the yard',          blurb: 'slag has a price. sell it.' },
  { depth: 3,  id: 'bids',         title: 'two-sided',         blurb: 'you can buy back what you sold, at a worse price.' },
  { depth: 4,  id: 'ferrite',      title: 'ferrite',           blurb: 'a second material, with its own book.' },
  { depth: 6,  id: 'ledger',       title: 'the ledger',        blurb: 'price history, shown as an index where 1.00 is normal.' },
  { depth: 8,  id: 'quartz',       title: 'quartz',            blurb: 'thinner book, wider swings.' },
  { depth: 10, id: 'book',         title: 'book depth',        blurb: 'how full each market is, and what that does to the price.' },
  { depth: 12, id: 'cinder',       title: 'cinder',            blurb: 'the thinnest raw book. one careless sale marks it for ten turns.' },
  { depth: 14, id: 'refinery',     title: 'the refinery',      blurb: 'ferrite and slag become alloy. alloy has its own market.' },
  { depth: 18, id: 'cycles',       title: 'demand cycles',     blurb: 'each good has a period. the readout names it.' },
  { depth: 20, id: 'optics',       title: 'optics',            blurb: 'quartz and cinder become lens.' },
  { depth: 24, id: 'margins',      title: 'refining margin',   blurb: 'output bid minus input ask minus fee, per recipe, live.' },
  { depth: 26, id: 'consignments', title: 'consignments',      blurb: 'sell material you have not mined yet, paid now, delivered later.' },
  { depth: 30, id: 'regimes',      title: 'market regimes',    blurb: 'the field pattern names the regime. the schedule is fixed.' },
  { depth: 32, id: 'assay',        title: 'assay',             blurb: 'exactly what the next rows are made of, before they arrive.' },
  { depth: 36, id: 'almanac',      title: 'the almanac',       blurb: 'the next peak and trough depth for every good.' },
  { depth: 40, id: 'apex',         title: 'cores',             blurb: 'alloy, lens and cinder become a core.' },
  { depth: 48, id: 'exchange',     title: 'the exchange',      blurb: 'order splitting: what a sale is worth broken across turns.' },
];

const REVEAL_DEPTH = Object.fromEntries(REVEALS.map(r => [r.id, r.depth]));

// which good becomes tradable at which reveal
const MAT_GATE = {
  slag: 'yard', ferrite: 'ferrite', quartz: 'quartz', cinder: 'cinder',
  alloy: 'refinery', lens: 'optics', core: 'apex',
};

// ---------------------------------------------------------------------------
// WHAT THE PLAYER'S HAND IS WORTH AT THE DESK
//
// A trade power does nothing on its own. The hand works out what each one is
// worth and hands this module a bag of plain numbers - no import either way,
// so neither file knows the other exists. Everything below reads it through
// mods() and a run with no such powers reads the defaults and behaves exactly
// as it did.
//
// The host refreshes it whenever the hand changes. It is derived, so it is not
// written down with the run.
// ---------------------------------------------------------------------------

const NO_MODS = {
  slippageMult: 1,        // 0 closes the whole gap between quote and fill
  bookDepthMult: 1,       // above 1 and size moves the price less
  revealShift: 0,         // depths earlier every tool arrives
  forwardPayoutMult: 1,
  forwardCapacityMult: 1,
  refineFeeMult: 1,
  refineYieldMult: 1,
  noBookImpact: false,    // a sale stops moving the book at all
};

function mods(state) { return (state && state.pow) || NO_MODS; }

/** True when a reveal is available at the state's current progress. */
export function has(state, id) {
  return state.reach + (mods(state).revealShift || 0) >= (REVEAL_DEPTH[id] ?? Infinity);
}

/** Everything unlocked so far plus the next thing and how far off it is. */
export function reveal(state) {
  const unlocked = REVEALS.filter(r => state.reach >= r.depth);
  const next = REVEALS.find(r => state.reach < r.depth) || null;
  return {
    unlocked: unlocked.map(r => r.id),
    detail: unlocked,
    next: next ? { ...next, away: next.depth - state.reach } : null,
    goods: MATERIALS.filter(m => has(state, MAT_GATE[m.id])).map(m => m.id),
  };
}

// ===========================================================================
// SECTION 7 - creating and advancing the market
// ===========================================================================

const HISTORY = 96;

/**
 * Build a fresh market.
 *
 * config:
 *   depth       starting depth, default 1
 *   reach       highest depth ever reached, which is what gates the reveal
 *               schedule. Pass a saved value so a returning player keeps the
 *               tools they earned. Defaults to depth.
 *   essence     starting cash, default 0
 *   hpAt        (depth) => block max hp. Defaults to the shipped field rule.
 *   rowSource   (depth) => array of column indices carrying blocks. Defaults
 *               to a replica of the shipped field generator.
 */
export function create(config = {}) {
  const depth = Math.max(1, Math.trunc(config.depth ?? 1));
  const cfg = {
    hpAt: typeof config.hpAt === 'function' ? config.hpAt : DEFAULT_HP,
    rowSource: typeof config.rowSource === 'function' ? config.rowSource : defaultRow,
  };
  const state = {
    v: VERSION,
    depth,
    reach: Math.max(depth, Math.trunc(config.reach ?? depth)),
    cfg,
    // CASH ONLY. A run that is not trading never sees the four ores, the price
    // table, the refinery or the consignment desk. A block pays essence at what
    // the ore it held was worth, and the upgrade list is priced the same way,
    // so every number below stays the number it was tuned to be. Nothing here
    // is removed - it is not reached.
    cashOnly: !!config.cash,
    essence: L(config.essence ?? 0),
    stock: {},         // market book, in units
    held: {},          // player inventory, in units
    hist: {},          // ring buffer of {d, rel, u, p}
    flow: {},          // exponential average of units harvested per turn
    bought: {},        // how many times each upgrade has been purchased
    forwards: [],      // open consignments
    standing: 50,      // credit with the market, 0..100
    boost: { turns: 0, mult: 1 },
    mods: { gain: 0 }, // yield upgrades the market itself needs to know about
    trades: [],        // last forty fills, newest first
    stats: { sold: {}, bought_units: {}, mined: {}, essenceEarned: ZERO(), essenceSpent: ZERO(), defaults: 0, delivered: 0 },
  };
  state.bookScale = depthScale(state, depth);
  for (const m of MATERIALS) {
    state.stock[m.id] = anchorOf(state, m, depth);
    state.held[m.id] = ZERO();
    state.hist[m.id] = [];
    state.flow[m.id] = ZERO();
    state.stats.sold[m.id] = ZERO();
    state.stats.bought_units[m.id] = ZERO();
    state.stats.mined[m.id] = ZERO();
  }
  record(state);
  return state;
}

/**
 * Advance the market one turn. Call once per turn, with the new depth.
 * Settles due consignments, refills books, and writes the history point.
 * Returns a report of everything that happened without being asked for.
 */
export function tick(state, depth) {
  const before = regimeOf(state.depth);
  state.depth = Math.max(1, Math.trunc(depth));
  state.reach = Math.max(state.reach, state.depth);

  const settled = settleDue(state);

  // A BOOK THAT NOBODY TRADED IN HAS NOT MOVED.
  //
  // Normal depth for a book scales with what a block at this depth is worth,
  // and past the finish depth that compounds. The refill only ever closes a
  // fixed share of the gap, so a book could never catch up: it fell further
  // behind normal every turn, read as emptier and emptier, and its price rose
  // on its own with nobody trading. Material bought early and held through it
  // was free money - measured, 1,000 essence became 1,284,560,996 over two
  // hundred turns without a block being broken, while the same strategy with
  // the depth held still lost.
  //
  // The stock is carried up with normal depth first, so how full a book is
  // only ever changes because somebody bought or sold.
  const wasScale = state.bookScale || depthScale(state, state.depth);
  const nowScale = depthScale(state, state.depth);
  if (nowScale !== wasScale && wasScale > 0) {
    const carry = nowScale / wasScale;
    for (const m of MATERIALS) state.stock[m.id] = scale(state.stock[m.id], carry);
  }
  state.bookScale = nowScale;

  // books refill toward normal depth at a fixed fraction of the remaining gap
  const reg = regimeOf(state.depth);
  for (const m of MATERIALS) {
    const a = anchorOf(state, m, state.depth);
    const rate = Math.min(0.95, m.regen * reg.regen);
    const s = state.stock[m.id];
    state.stock[m.id] = clampStock(add(s, scale(sub(a, s), rate)), a);
    state.flow[m.id] = scale(state.flow[m.id], 0.75);   // decays if you stop mining it
  }

  if (state.boost.turns > 0 && --state.boost.turns === 0) state.boost.mult = 1;

  record(state);

  const after = regimeOf(state.depth);
  return {
    depth: state.depth,
    settled,
    regime: after,
    regimeChanged: before.id !== after.id,
    regimeEnds: nextRegimeDepth(state.depth),
    revealed: REVEALS.filter(r => r.depth === state.depth).map(r => r.id),
  };
}

function record(state) {
  for (const m of MATERIALS) {
    const h = state.hist[m.id];
    const q = quoteOf(state, m, state.depth);
    h.push({ d: state.depth, rel: q.index, u: q.book, p: q.mid });
    if (h.length > HISTORY) h.shift();
  }
}

// ===========================================================================
// SECTION 8 - pricing
// ===========================================================================
//   price = base(depth) x pressure x demand(depth) x regime
//
//   base(depth)  the scaling law: the good's base price times the depth scale.
//   pressure     (normal book / actual book) ^ elasticity. Sell and it falls,
//                buy and it rises. Nothing else touches it.
//   demand       1 + amp x sin(2pi (depth + phase) / period). A fixed cycle
//                with a small whole-number period, learnable by watching.
//   regime       a multiplier per tier of good, on a fixed six-depth schedule.
//
// The last three multiply to the INDEX, which is what the ledger charts. The
// index has no inflation in it, so a chart from depth 9 and a chart from depth
// 9,000 are directly comparable and both read 1.00 at neutral.

const TAU = Math.PI * 2;
const U_MIN = 0.02;    // a book cannot be emptied below this fraction of normal
const U_MAX = 25;      // beyond this the book stops absorbing and pays a floor

function anchorOf(state, m, depth) {
  return scale(L(m.anchor), depthScale(state, depth));
}

// A UNIT IS A UNIT AT EVERY DEPTH.
//
// This used to scale the price of one unit by the depth as well, and a deeper
// block already yields proportionally MORE units - so depth was counted twice
// and a block at depth 100 paid ninety-five times what the same block paid a
// run that was not trading. It also made holding material a riskless way to
// make money: material bought at depth 20 and sold at depth 60 gained the
// whole difference for nothing. Measured, that turned 1,000 essence into
// 22,766,967 over two hundred turns without a block being broken, and the same
// strategy with the depth held still LOST money, which is what says the depth
// was the mechanism rather than the demand cycle.
//
// A deeper block still pays more. It pays more because it hands over more.
function baseOf(state, m, depth) {
  return L(m.base);
}

function clampStock(s, anchor) {
  return minL(maxL(s, scale(anchor, U_MIN)), scale(anchor, U_MAX));
}

/** How full the book is, as a multiple of normal depth. 1.00 is normal. */
function bookOf(state, m, depth) {
  const u = toNum(div(state.stock[m.id], anchorOf(state, m, depth)));
  if (!isFinite(u) || u <= 0) return U_MIN;
  return Math.min(U_MAX, Math.max(U_MIN, u));
}

/** The demand cycle for one good at one depth. Pure, periodic, learnable. */
export function demandAt(id, depth) {
  const m = matDef(id);
  if (!m) return 1;
  const reg = regimeOf(depth);
  const amp = m.amp * reg.amp;
  return 1 + amp * Math.sin(TAU * (depth + m.phase) / m.period);
}

function regimeMul(m, depth) { return regimeOf(depth).mul[m.tier]; }

function spreadOf(m, depth) { return regimeOf(depth).spread + TIER_SPREAD[m.tier]; }

function quoteOf(state, m, depth) {
  const book = bookOf(state, m, depth);
  const pressure = Math.pow(book, -m.elast);
  const demand = demandAt(m.id, depth);
  const rmul = regimeMul(m, depth);
  const index = pressure * demand * rmul;
  const mid = scale(baseOf(state, m, depth), index);
  const sp = spreadOf(m, depth);
  return {
    id: m.id, name: m.name, tier: m.tier,
    mid, bid: scale(mid, 1 - sp), ask: scale(mid, 1 + sp),
    index, pressure, demand, regime: rmul, spread: sp, book,
    held: state.held[m.id], stock: state.stock[m.id],
  };
}

/**
 * Every price the player is allowed to see, newest state.
 * Pass { all: true } to ignore the reveal schedule (useful for tools).
 */
export function prices(state, opts = {}) {
  const out = [];
  for (const m of MATERIALS) {
    if (!opts.all && !has(state, MAT_GATE[m.id])) continue;
    const q = quoteOf(state, m, state.depth);
    out.push({
      ...q,
      midText: fmt(q.mid), bidText: fmt(q.bid), askText: fmt(q.ask),
      heldText: fmt(q.held),
      // the book readout is itself a reveal; hide the number until then
      bookShown: has(state, 'book') ? q.book : null,
      indexShown: has(state, 'ledger') ? q.index : null,
    });
  }
  return out;
}

/** A single quote by id. Ignores the reveal schedule; use prices() for UI. */
export function quote(state, id) {
  const m = matDef(id);
  return m ? quoteOf(state, m, state.depth) : null;
}

// ===========================================================================
// SECTION 9 - filling orders along the curve
// ===========================================================================
// An order does not fill at the posted price. It fills along the curve, unit
// by unit, and the posted price afterwards is where the curve ended up. The
// integral is exact and closed-form, which means a player can work out in
// advance exactly what a given order size is worth and exactly where to stop.
//
//   revenue for selling q into a book at u0, normal depth A:
//     A x base x demand x regime x integral from u0 to u0+q/A of u^-E du
//
//   integral of u^-E du = (b^(1-E) - a^(1-E)) / (1-E),  or ln(b/a) when E = 1.
//
// Past U_MAX the book stops absorbing and the rest of the order fills flat at
// the floor price. That cap is what makes a reckless dump merely bad instead
// of permanently ruinous, and it recovers in about nine turns.

function integ(a, b, E) {
  if (b <= a) return 0;
  if (Math.abs(1 - E) < 1e-9) return Math.log(b / a);
  return (Math.pow(b, 1 - E) - Math.pow(a, 1 - E)) / (1 - E);
}

/** What selling qty would pay, and where it would leave the price. No mutation. */
export function sellPreview(state, id, qty) {
  const m = matDef(id);
  if (!m) return { ok: false, reason: 'unknown' };
  const q = maxL(L(qty), ZERO());
  if (!isPos(q)) return { ok: false, reason: 'qty' };

  const depth = state.depth;
  const A = anchorOf(state, m, depth);
  const u0 = bookOf(state, m, depth);
  const k = mul(baseOf(state, m, depth), L(demandAt(id, depth) * regimeMul(m, depth)));
  const sp = spreadOf(m, depth);
  const md = mods(state);
  // FLOAT deepens the book the sale walks down, so size costs less price. The
  // real anchor still decides where the book ends up.
  const Ac = scale(A, md.bookDepthMult);

  // units that still fit on the curve before the book stops absorbing
  const roomQty = scale(Ac, Math.max(0, U_MAX - u0));
  const onCurve = minL(q, roomQty);
  const flat = sub(q, onCurve);

  const du = toNum(div(onCurve, Ac));
  const acc = integ(u0, Math.min(U_MAX, u0 + (isFinite(du) ? du : U_MAX)), m.elast);

  let gross = scale(mul(k, Ac), acc);
  if (isPos(flat)) gross = add(gross, mul(mul(k, L(Math.pow(U_MAX, -m.elast))), flat));

  let net = scale(gross, 1 - sp);
  // STANDING closes the gap between the price quoted and the price filled;
  // MONOPOLY closes it entirely. The quote is what the whole lot would fetch
  // if the sale moved nothing.
  if (md.slippageMult < 1) {
    const atQuote = scale(mul(scale(k, Math.pow(u0, -m.elast)), q), 1 - sp);
    net = sub(atQuote, scale(sub(atQuote, net), md.slippageMult));
  }
  const endStock = clampStock(add(state.stock[id], q), A);
  const endBook = Math.min(U_MAX, Math.max(U_MIN, toNum(div(endStock, A))));

  return {
    ok: true, id, qty: q, filled: q,
    gross, net, proceeds: net,
    unit: div(net, q),
    startIndex: Math.pow(u0, -m.elast) * demandAt(id, depth) * regimeMul(m, depth),
    endIndex: Math.pow(endBook, -m.elast) * demandAt(id, depth) * regimeMul(m, depth),
    startBook: u0, endBook,
    capped: isPos(flat), cappedQty: flat,
    netText: fmt(net), unitText: fmt(div(net, q)),
  };
}

/** What buying qty would cost. Partially fills if the book cannot supply it. */
export function buyPreview(state, id, qty) {
  const m = matDef(id);
  if (!m) return { ok: false, reason: 'unknown' };
  const want = maxL(L(qty), ZERO());
  if (!isPos(want)) return { ok: false, reason: 'qty' };

  const depth = state.depth;
  const A = anchorOf(state, m, depth);
  const u0 = bookOf(state, m, depth);
  const k = mul(baseOf(state, m, depth), L(demandAt(id, depth) * regimeMul(m, depth)));
  const sp = spreadOf(m, depth);

  const Ac = scale(A, mods(state).bookDepthMult);
  const available = scale(Ac, Math.max(0, u0 - U_MIN));
  const filled = minL(want, available);
  if (!isPos(filled)) return { ok: false, reason: 'empty', filled: ZERO() };

  const du = toNum(div(filled, Ac));
  const u1 = Math.max(U_MIN, u0 - (isFinite(du) ? du : u0));
  const acc = integ(u1, u0, m.elast);

  const gross = scale(mul(k, Ac), acc);
  const cost = scale(gross, 1 + sp);
  const endStock = clampStock(sub(state.stock[id], filled), A);
  const endBook = Math.min(U_MAX, Math.max(U_MIN, toNum(div(endStock, A))));

  return {
    ok: true, id, qty: want, filled, short: sub(want, filled),
    gross, cost,
    unit: div(cost, filled),
    startBook: u0, endBook,
    startIndex: Math.pow(u0, -m.elast) * demandAt(id, depth) * regimeMul(m, depth),
    endIndex: Math.pow(endBook, -m.elast) * demandAt(id, depth) * regimeMul(m, depth),
    costText: fmt(cost), unitText: fmt(div(cost, filled)),
  };
}

/** Sell material into the book. Moves the price down as it fills. */
export function sell(state, id, qty) {
  if (!has(state, MAT_GATE[id] ?? 'apex')) return { ok: false, reason: 'locked' };
  const q = minL(maxL(L(qty), ZERO()), state.held[id] ?? ZERO());
  if (!isPos(q)) return { ok: false, reason: 'holdings' };

  const pv = sellPreview(state, id, q);
  if (!pv.ok) return pv;

  state.held[id] = sub(state.held[id], q);
  // MONOPOLY: the book does not take the sale on, so the price does not move.
  if (!mods(state).noBookImpact) {
    state.stock[id] = clampStock(add(state.stock[id], q), anchorOf(state, matDef(id), state.depth));
  }
  state.essence = add(state.essence, pv.net);
  state.stats.sold[id] = add(state.stats.sold[id], q);
  state.stats.essenceEarned = add(state.stats.essenceEarned, pv.net);
  logTrade(state, { kind: 'sell', id, qty: q, value: pv.net, index: pv.startIndex });
  return pv;
}

/** Buy material out of the book. Moves the price up as it fills. */
export function buy(state, id, qty) {
  if (!has(state, 'bids')) return { ok: false, reason: 'locked' };
  if (!has(state, MAT_GATE[id] ?? 'apex')) return { ok: false, reason: 'locked' };

  let pv = buyPreview(state, id, qty);
  if (!pv.ok) return pv;
  if (cmp(pv.cost, state.essence) > 0) {
    const most = maxAffordable(state, id);
    if (!isPos(most)) return { ok: false, reason: 'essence', afford: ZERO() };
    pv = buyPreview(state, id, most);
    if (!pv.ok || cmp(pv.cost, state.essence) > 0) return { ok: false, reason: 'essence', afford: most };
  }

  state.essence = sub(state.essence, pv.cost);
  state.held[id] = add(state.held[id], pv.filled);
  state.stock[id] = clampStock(sub(state.stock[id], pv.filled), anchorOf(state, matDef(id), state.depth));
  state.stats.bought_units[id] = add(state.stats.bought_units[id], pv.filled);
  state.stats.essenceSpent = add(state.stats.essenceSpent, pv.cost);
  logTrade(state, { kind: 'buy', id, qty: pv.filled, value: pv.cost, index: pv.startIndex });
  return pv;
}

/** Largest quantity of a good the current essence balance can pay for. */
export function maxAffordable(state, id) {
  const m = matDef(id);
  if (!m) return ZERO();
  const A = anchorOf(state, m, state.depth);
  const u0 = bookOf(state, m, state.depth);
  let lo = ZERO(), hi = scale(A, Math.max(0, u0 - U_MIN));
  if (!isPos(hi)) return ZERO();
  if (cmp(buyPreview(state, id, hi).cost ?? ZERO(), state.essence) <= 0) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = scale(add(lo, hi), 0.5);
    const pv = buyPreview(state, id, mid);
    if (pv.ok && cmp(pv.cost, state.essence) <= 0) lo = mid; else hi = mid;
  }
  return floorL(lo);
}

function logTrade(state, t) {
  state.trades.unshift({ d: state.depth, ...t });
  if (state.trades.length > 40) state.trades.pop();
}

// ===========================================================================
// SECTION 10 - production
// ===========================================================================

/**
 * A block was destroyed. Credits the player's inventory and returns what came
 * out. block = { depth, col, maxHp }.
 */
export function harvest(state, block) {
  const depth = Math.max(1, Math.trunc(block.depth ?? state.depth));
  const id = materialOf(depth, block.col ?? 0);
  const m = matDef(id);
  const maxHp = block.maxHp ?? state.cfg.hpAt(depth);
  const units = scale(L(m.drop * bulkOf(maxHp)), (1 + state.mods.gain) * state.boost.mult);
  if (state.cashOnly) {
    const worth = scale(units, m.base);
    state.essence = add(state.essence, worth);
    state.stats.essenceEarned = add(state.stats.essenceEarned, worth);
    return { id, name: m.name, qty: units, text: fmt(units), essence: worth, essenceText: fmt(worth) };
  }
  state.held[id] = add(state.held[id], units);
  state.stats.mined[id] = add(state.stats.mined[id], units);
  // running estimate of production per turn, which is what forward capacity is based on
  state.flow[id] = add(scale(state.flow[id], 0.75), scale(units, 0.25));
  return { id, name: m.name, qty: units, text: fmt(units) };
}

/** A field pickup that pays cash rather than material. Roughly six slag. */
export function windfall(state, depth = state.depth) {
  // A pickup off the FIELD, not a price at the desk, so it scales with the
  // depth it was found at the way a block's yield does.
  const gain = scale(L(matDef('slag').base * 6), depthScale(state, depth));
  state.essence = add(state.essence, gain);
  state.stats.essenceEarned = add(state.stats.essenceEarned, gain);
  return { essence: gain, text: fmt(gain) };
}

/**
 * What the next n rows are made of, before they arrive. Gated behind the assay
 * reveal; without it this is the tool a careful player is missing, and with it
 * consignments stop being a gamble.
 */
export function forecast(state, n = 6) {
  if (!has(state, 'assay')) return { ok: false, reason: 'locked' };
  const rows = [];
  const totals = {};
  for (const m of MATERIALS) totals[m.id] = ZERO();
  for (let i = 1; i <= n; i++) {
    const d = state.depth + i;
    const cols = state.cfg.rowSource(d);
    const hp = state.cfg.hpAt(d);
    const cells = cols.map(c => {
      const id = materialOf(d, c);
      const qty = scale(L(matDef(id).drop * bulkOf(hp)), 1 + state.mods.gain);
      totals[id] = add(totals[id], qty);
      return { col: c, id, qty };
    });
    rows.push({ depth: d, hp, cells, regime: regimeOf(d).id });
  }
  return { ok: true, rows, totals, totalsText: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fmt(v)])) };
}

// ===========================================================================
// SECTION 11 - refining
// ===========================================================================
// Every recipe loses money at neutral prices. That is deliberate. Refining is
// not a income stream, it is a bet that a known output cycle is above a known
// input cycle right now, and the periods that decide it are 5, 7, 8, 11, 13,
// 17 and 23. Those are the seven numbers that make this market solvable.

/** The live margin on one unit of a recipe: output bid minus input ask minus fee. */
export function marginOf(state, recipeId) {
  const r = RECIPE_BY_ID[recipeId];
  if (!r) return null;
  const outQ = quote(state, r.out);
  const revenue = scale(outQ.bid, r.qty);
  let cost = ZERO();
  const parts = [];
  for (const [id, n] of Object.entries(r.inputs)) {
    const q = quote(state, id);
    const c = scale(q.ask, n);
    cost = add(cost, c);
    parts.push({ id, n, ask: q.ask, cost: c, index: q.index });
  }
  const fee = scale(outQ.mid, r.fee * r.qty);
  const margin = sub(sub(revenue, cost), fee);
  const pct = toNum(div(margin, cost));
  return {
    id: r.id, out: r.out, outQty: r.qty, inputs: parts,
    revenue, cost, fee, margin, pct,
    marginText: fmt(margin), pctText: (pct * 100).toFixed(1) + '%',
    positive: isPos(margin),
  };
}

const RECIPE_GATE = { alloy: 'refinery', lens: 'optics', core: 'apex' };

/** Recipes the player has unlocked, with how many runs inventory supports. */
export function recipes(state) {
  return RECIPES.filter(r => has(state, RECIPE_GATE[r.id]))
    .map(r => ({ id: r.id, out: r.out, qty: r.qty, inputs: r.inputs, runs: craftable(state, r.id) }));
}

/** Live margin on every unlocked recipe. Empty until the margin readout unlocks. */
export function margins(state) {
  if (!has(state, 'margins')) return [];
  return RECIPES.filter(r => has(state, RECIPE_GATE[r.id])).map(r => marginOf(state, r.id));
}

/** How many times a recipe can be run from inventory alone. */
export function craftable(state, recipeId) {
  const r = RECIPE_BY_ID[recipeId];
  if (!r) return ZERO();
  let n = null;
  for (const [id, need] of Object.entries(r.inputs)) {
    const can = floorL(div(state.held[id], L(need)));
    n = n === null ? can : minL(n, can);
  }
  return n ?? ZERO();
}

/** Run a recipe from inventory. Consumes inputs, pays the fee in essence. */
export function craft(state, recipeId, times = 1) {
  const r = RECIPE_BY_ID[recipeId];
  if (!r) return { ok: false, reason: 'unknown' };
  if (!has(state, RECIPE_GATE[r.id])) return { ok: false, reason: 'locked' };

  const n = minL(floorL(maxL(L(times), ZERO())), craftable(state, recipeId));
  if (!isPos(n)) return { ok: false, reason: 'inputs' };

  const md = mods(state);
  const fee = mul(scale(quote(state, r.out).mid, r.fee * r.qty * md.refineFeeMult), n);
  if (cmp(fee, state.essence) > 0) return { ok: false, reason: 'fee', fee };

  for (const [id, need] of Object.entries(r.inputs)) {
    state.held[id] = sub(state.held[id], mul(L(need), n));
  }
  const made = scale(mul(L(r.qty), n), md.refineYieldMult);
  state.held[r.out] = add(state.held[r.out], made);
  state.essence = sub(state.essence, fee);
  logTrade(state, { kind: 'craft', id: r.out, qty: made, value: fee, index: quote(state, r.out).index });
  return { ok: true, id: r.id, out: r.out, made, fee, runs: n, madeText: fmt(made) };
}

// ===========================================================================
// SECTION 12 - consignments
// ===========================================================================
// A consignment is material sold before it is mined. The buyer pays now, in
// full, at the good's FAIR value on the delivery depth, plus a premium for the
// term. Fair value carries the demand cycle but not the book pressure, so the
// forward price curve is literally the demand cycle drawn out in front of the
// player. Someone who knows the periods reads the curve; someone who does not
// sees noise and takes the wrong side of it.
//
// Failing to deliver costs twice the value of the shortfall and thirty points
// of standing. Standing sets both the premium and how much can be committed,
// so a default is felt for a long time.

const TERM_MIN = 3, TERM_MAX = 12;

function fairAt(state, id, depth) {
  const m = matDef(id);
  return mul(baseOf(state, m, depth), L(demandAt(id, depth) * regimeMul(m, depth)));
}

function premiumOf(term, standing) {
  return 1 + 0.012 * term * (0.6 + standing / 125);
}

/** Units of one good the market will let the player commit to, all terms combined. */
export function forwardCapacity(state, id) {
  const turns = 2 + state.standing / 12;
  const floorCap = scale(L(matDef(id).drop * 4), depthScale(state, state.depth));
  const cap = scale(maxL(scale(state.flow[id], turns), floorCap), mods(state).forwardCapacityMult);
  const open = state.forwards.filter(f => f.id === id).reduce((a, f) => add(a, f.qty), ZERO());
  return { cap, open, free: maxL(sub(cap, open), ZERO()) };
}

/** Price a consignment without opening it. */
export function consignPreview(state, id, qty, term) {
  const m = matDef(id);
  if (!m) return { ok: false, reason: 'unknown' };
  if (!has(state, 'consignments')) return { ok: false, reason: 'locked' };
  const t = Math.max(TERM_MIN, Math.min(TERM_MAX, Math.trunc(term)));
  const q = floorL(maxL(L(qty), ZERO()));
  if (!isPos(q)) return { ok: false, reason: 'qty' };

  const cap = forwardCapacity(state, id);
  if (cmp(q, cap.free) > 0) return { ok: false, reason: 'capacity', free: cap.free, freeText: fmt(cap.free) };

  const due = state.depth + t;
  const fair = fairAt(state, id, due);
  const prem = premiumOf(t, state.standing);
  const sp = spreadOf(m, state.depth);
  const unit = scale(fair, (1 - sp) * prem * mods(state).forwardPayoutMult);
  const payout = mul(unit, q);
  const spotUnit = quote(state, id).bid;
  return {
    ok: true, id, qty: q, term: t, due,
    unit, payout, premium: prem,
    fair, spotUnit,
    edge: toNum(div(sub(unit, spotUnit), spotUnit)),
    payoutText: fmt(payout), unitText: fmt(unit),
    demandAtDue: demandAt(id, due), regimeAtDue: regimeOf(due).id,
  };
}

/** Open a consignment. Pays immediately, obligates delivery at the due depth. */
export function consign(state, id, qty, term) {
  const pv = consignPreview(state, id, qty, term);
  if (!pv.ok) return pv;
  state.essence = add(state.essence, pv.payout);
  state.stats.essenceEarned = add(state.stats.essenceEarned, pv.payout);
  state.forwards.push({
    key: `${state.depth}:${id}:${state.forwards.length}`,
    id, qty: pv.qty, due: pv.due, opened: state.depth,
    term: pv.term, unit: pv.unit, paid: pv.payout,
  });
  logTrade(state, { kind: 'consign', id, qty: pv.qty, value: pv.payout, index: null });
  return pv;
}

/** Open consignments with their current shortfall, worst first. */
export function consignments(state) {
  return state.forwards
    .map(f => {
      const short = maxL(sub(f.qty, state.held[f.id]), ZERO());
      return {
        ...f,
        away: f.due - state.depth,
        short,
        covered: !isPos(short),
        penalty: scale(mul(short, fairAt(state, f.id, f.due)), 2),
        qtyText: fmt(f.qty), paidText: fmt(f.paid), shortText: fmt(short),
      };
    })
    .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
}

function settleDue(state) {
  const out = [];
  const keep = [];
  for (const f of state.forwards) {
    if (f.due > state.depth) { keep.push(f); continue; }
    const have = state.held[f.id];
    const give = minL(have, f.qty);
    const short = sub(f.qty, give);
    state.held[f.id] = sub(have, give);
    // delivered goods land in the book, which is the seller's own problem next turn
    const A = anchorOf(state, matDef(f.id), state.depth);
    state.stock[f.id] = clampStock(add(state.stock[f.id], give), A);

    if (isPos(short)) {
      const penalty = scale(mul(short, fairAt(state, f.id, f.due)), 2);
      const paid = minL(penalty, state.essence);
      state.essence = sub(state.essence, paid);
      const partial = isPos(give);
      state.standing = Math.max(0, state.standing - (partial ? 15 : 30));
      state.stats.defaults++;
      out.push({ ...f, status: partial ? 'partial' : 'default', delivered: give, short, penalty, paid,
                 penaltyText: fmt(penalty), standing: state.standing });
    } else {
      state.standing = Math.min(100, state.standing + 5);
      state.stats.delivered++;
      out.push({ ...f, status: 'delivered', delivered: give, short: ZERO(), standing: state.standing });
    }
  }
  state.forwards = keep;
  return out;
}

// ===========================================================================
// SECTION 13 - upgrades
// ===========================================================================
// Upgrades are priced in material, never in cash. That is what forces trade:
// the field decides what you produce and the upgrade list decides what you
// need, and those two lists never match.
//
// A cost is (units x depth scale x growth ^ times already bought). The depth
// scale is the same factor that scales block payout, so an upgrade always
// costs the same number of BLOCKS at every depth. Only the number of times you
// have already bought it makes it dearer. That is the whole progression curve
// and it is one line long.

export const OFFERS = [
  { id: 'conscript', name: 'conscript', desc: '+1 to the swarm',                         gate: 'yard',
    cost: { slag: 6 },                       growth: 1.10, effect: { balls: 1 } },
  { id: 'levy',      name: 'levy',      desc: '+5 to the swarm',                         gate: 'ferrite',
    cost: { slag: 24, ferrite: 4 },          growth: 1.14, effect: { balls: 5 } },
  { id: 'sharpen',   name: 'sharpen',   desc: '+1 damage per hit',                       gate: 'ferrite',
    cost: { ferrite: 4, slag: 2 },           growth: 1.20, effect: { power: 1 } },
  { id: 'harvest',   name: 'harvest',   desc: '+1 to every material yield',              gate: 'quartz',
    cost: { ferrite: 4, quartz: 3 },         growth: 1.24, effect: { gain: 1 } },
  { id: 'purge',     name: 'purge row', desc: 'destroy the lowest row',                  gate: 'cinder',
    cost: { cinder: 2 },                     growth: 1.02, effect: { clearRow: 1 } },
  { id: 'brake',     name: 'brake',     desc: 'lift every row one step off the line',    gate: 'refinery',
    cost: { alloy: 1 },                      growth: 1.03, effect: { liftRows: 1 } },
  { id: 'prospect',  name: 'prospect',  desc: 'double material yield for three turns',   gate: 'optics',
    cost: { lens: 1 },                       growth: 1.05, effect: { yieldBoost: { turns: 3, mult: 2 } } },
  { id: 'ascension', name: 'ascension', desc: '+25 swarm and +2 damage',                 gate: 'apex',
    cost: { core: 1 },                       growth: 1.30, effect: { balls: 25, power: 2 } },
];

const OFFER_BY_ID = Object.fromEntries(OFFERS.map(o => [o.id, o]));

export function costOf(state, offerId) {
  const o = OFFER_BY_ID[offerId];
  if (!o) return null;
  const n = state.bought[offerId] ?? 0;
  const scaleF = depthScale(state, state.depth);
  const growth = Math.pow(o.growth, n);
  const out = {};
  for (const [id, units] of Object.entries(o.cost)) {
    out[id] = ceilL(scale(L(units), scaleF * growth));
  }
  return out;
}

/** The same upgrade, priced in essence: what the ore it asks for is worth. */
export function cashCostOf(state, offerId) {
  const o = OFFER_BY_ID[offerId];
  if (!o) return null;
  const n = state.bought[offerId] ?? 0;
  const f = depthScale(state, state.depth) * Math.pow(o.growth, n);
  let total = ZERO();
  for (const [id, units] of Object.entries(o.cost)) {
    total = add(total, scale(L(units * matDef(id).base), f));
  }
  return ceilL(total);
}

/** Every unlocked upgrade, with cost, affordability, and the shortfall if any. */
export function offers(state) {
  if (state.cashOnly) return cashOffers(state);
  return OFFERS.filter(o => has(state, o.gate)).map(o => {
    const cost = costOf(state, o.id);
    const lines = Object.entries(cost).map(([id, need]) => ({
      id, need, have: state.held[id], short: maxL(sub(need, state.held[id]), ZERO()),
      needText: fmt(need), haveText: fmt(state.held[id]),
    }));
    const afford = lines.every(l => !isPos(l.short));
    // what it would cost to cover the shortfall on the open market right now
    let buyIn = ZERO();
    let buyable = true;
    for (const l of lines) {
      if (!isPos(l.short)) continue;
      const pv = buyPreview(state, l.id, l.short);
      if (!pv.ok || isPos(pv.short ?? ZERO())) { buyable = false; continue; }
      buyIn = add(buyIn, pv.cost);
    }
    return {
      id: o.id, name: o.name, desc: o.desc, effect: o.effect,
      bought: state.bought[o.id] ?? 0, cost, lines, afford,
      coverCost: buyIn, coverText: fmt(buyIn),
      coverable: buyable && !afford && cmp(buyIn, state.essence) <= 0,
    };
  });
}

/**
 * The upgrade list for a run that is not trading.
 *
 * Only what the hand of powers does not already do. A run with no market has
 * one place to build from and one place to buy a way out of trouble, and
 * neither of them offers the other's goods.
 */
// Their own depths, because a run with no market has never heard of cinder or
// the refinery and cannot be gated behind either.
const CASH_OFFERS = { purge: 8, brake: 14 };
const CASH_OFFER_IDS = Object.keys(CASH_OFFERS);

function cashOffers(state) {
  return OFFERS.filter(o => state.reach >= (CASH_OFFERS[o.id] ?? Infinity)).map(o => {
    const need = cashCostOf(state, o.id);
    const afford = cmp(state.essence, need) >= 0;
    return {
      id: o.id, name: o.name, desc: o.desc, effect: o.effect,
      bought: state.bought[o.id] ?? 0,
      cost: { essence: need },
      lines: [{ id: 'essence', need, have: state.essence,
                short: maxL(sub(need, state.essence), ZERO()),
                needText: fmt(need), haveText: fmt(state.essence) }],
      afford,
      coverCost: ZERO(), coverText: '', coverable: false,
    };
  });
}

/**
 * Buy an upgrade with material from inventory.
 * Returns the effect record for the host to apply to its own game state.
 * Yield-affecting effects are also applied here, since pricing needs them.
 */
export function purchase(state, offerId) {
  const o = OFFER_BY_ID[offerId];
  if (!o) return { ok: false, reason: 'unknown' };
  if (!has(state, o.gate)) return { ok: false, reason: 'locked' };
  if (state.cashOnly) {
    if (!CASH_OFFER_IDS.includes(offerId)) return { ok: false, reason: 'unknown' };
    const price = cashCostOf(state, offerId);
    if (cmp(state.essence, price) < 0) return { ok: false, reason: 'essence', need: price, have: state.essence };
    state.essence = sub(state.essence, price);
    state.stats.essenceSpent = add(state.stats.essenceSpent, price);
    state.bought[offerId] = (state.bought[offerId] ?? 0) + 1;
    if (o.effect.gain) state.mods.gain += o.effect.gain;
    if (o.effect.yieldBoost) state.boost = { turns: o.effect.yieldBoost.turns, mult: o.effect.yieldBoost.mult };
    return { ok: true, id: o.id, effect: o.effect, cost: { essence: price }, bought: state.bought[offerId] };
  }
  const cost = costOf(state, offerId);
  for (const [id, need] of Object.entries(cost)) {
    if (cmp(state.held[id], need) < 0) return { ok: false, reason: 'material', id, need, have: state.held[id] };
  }
  for (const [id, need] of Object.entries(cost)) state.held[id] = sub(state.held[id], need);
  state.bought[offerId] = (state.bought[offerId] ?? 0) + 1;

  if (o.effect.gain) state.mods.gain += o.effect.gain;
  if (o.effect.yieldBoost) {
    state.boost = { turns: o.effect.yieldBoost.turns, mult: o.effect.yieldBoost.mult };
  }
  return { ok: true, id: o.id, effect: o.effect, cost, bought: state.bought[offerId] };
}

/**
 * Buy the market material needed to cover an upgrade, then buy the upgrade.
 * This is the buy-past-tedium path: pay cash to skip the mining.
 */
export function purchaseWithCover(state, offerId) {
  const o = OFFER_BY_ID[offerId];
  if (!o) return { ok: false, reason: 'unknown' };
  const cost = costOf(state, offerId);
  const bought = [];
  for (const [id, need] of Object.entries(cost)) {
    const short = sub(need, state.held[id]);
    if (!isPos(short)) continue;
    const res = buy(state, id, short);
    if (!res.ok || isPos(res.short ?? ZERO())) return { ok: false, reason: 'cover', id, detail: res };
    bought.push({ id, qty: res.filled, cost: res.cost });
  }
  const p = purchase(state, offerId);
  return p.ok ? { ...p, covered: bought } : p;
}

// ===========================================================================
// SECTION 14 - reading the market
// ===========================================================================

/** Price history for one good. Newest last. Empty until the ledger unlocks. */
export function history(state, id, n = HISTORY) {
  if (!has(state, 'ledger')) return [];
  const h = state.hist[id] ?? [];
  const from = Math.max(0, h.length - Math.max(1, Math.trunc(n)));
  return h.slice(from).map(p => ({
    depth: p.d,
    index: p.rel,
    book: p.u,
    price: p.p,
    priceText: fmt(p.p),
  }));
}

function movingAvg(h, n) {
  if (!h.length) return null;
  const s = h.slice(Math.max(0, h.length - n));
  return s.reduce((a, p) => a + p.rel, 0) / s.length;
}

// Solve for the next depth where sin(2pi (d + phase)/period) hits its extreme.
function nextExtreme(depth, period, phase, peak) {
  const target = peak ? 0.25 : 0.75;
  const k = Math.floor((depth + phase) / period - target) + 1;
  let d = Math.ceil(period * (target + k) - phase);
  while (d <= depth) d += period;
  return d;
}

/**
 * The full read on one good: where it is, where it has been, and where its
 * cycle is going. Fields appear as their reveals unlock, so this is safe to
 * render wholesale at any depth.
 */
export function indicators(state, id) {
  const m = matDef(id);
  if (!m) return null;
  const q = quote(state, id);
  const h = state.hist[id] ?? [];
  const out = {
    id, name: m.name, tier: m.tier,
    mid: q.mid, bid: q.bid, ask: q.ask, spread: q.spread,
    midText: fmt(q.mid), bidText: fmt(q.bid), askText: fmt(q.ask),
    held: q.held, heldText: fmt(q.held),
  };
  if (has(state, 'ledger')) {
    out.index = q.index;
    out.ma8 = movingAvg(h, 8);
    out.ma24 = movingAvg(h, 24);
    out.trend = out.ma8 != null && out.ma24 != null ? out.ma8 - out.ma24 : null;
  }
  if (has(state, 'book')) {
    out.book = q.book;
    out.pressure = q.pressure;
    out.elasticity = m.elast;
    out.refill = m.regen * regimeOf(state.depth).regen;
  }
  if (has(state, 'cycles')) {
    out.period = m.period;
    out.amp = m.amp * regimeOf(state.depth).amp;
    out.demand = q.demand;
    out.phase = (((state.depth + m.phase) / m.period) % 1 + 1) % 1;
  }
  if (has(state, 'regimes')) {
    const r = regimeOf(state.depth);
    out.regime = { id: r.id, name: r.name, note: r.note, mul: r.mul[m.tier], ends: nextRegimeDepth(state.depth) };
  }
  if (has(state, 'almanac')) {
    out.nextPeak = nextExtreme(state.depth, m.period, m.phase, true);
    out.nextTrough = nextExtreme(state.depth, m.period, m.phase, false);
    out.peakDemand = demandAt(id, out.nextPeak);
    out.troughDemand = demandAt(id, out.nextTrough);
  }
  return out;
}

/**
 * Order splitting. Given a quantity to sell and a number of turns to sell it
 * over, compare candidate splits and return the best. Selling into a book
 * refills between turns, so patience is worth a computable amount, and this
 * says exactly how much.
 */
export function planSale(state, id, qty, turns = 4) {
  if (!has(state, 'exchange')) return { ok: false, reason: 'locked' };
  const m = matDef(id);
  if (!m) return { ok: false, reason: 'unknown' };
  const total = maxL(L(qty), ZERO());
  if (!isPos(total)) return { ok: false, reason: 'qty' };
  const T = Math.max(1, Math.min(24, Math.trunc(turns)));

  const shapes = [
    { id: 'all-now',  w: [1] },
    { id: 'even',     w: Array.from({ length: T }, () => 1) },
    { id: 'front',    w: Array.from({ length: T }, (_, i) => T - i) },
    { id: 'back',     w: Array.from({ length: T }, (_, i) => i + 1) },
    { id: 'peak',     w: Array.from({ length: T }, (_, i) => Math.max(0.05, demandAt(id, state.depth + i)) ** 4) },
  ];

  const results = shapes.map(s => ({ id: s.id, ...simulateSplit(state, m, total, s.w) }));
  results.sort((a, b) => cmp(b.net, a.net));
  const best = results[0], now = results.find(r => r.id === 'all-now');
  return {
    ok: true, id, qty: total, turns: T,
    plans: results.map(r => ({ ...r, netText: fmt(r.net) })),
    best: best.id,
    gainOverImmediate: sub(best.net, now.net),
    gainText: fmt(sub(best.net, now.net)),
    gainPct: toNum(div(sub(best.net, now.net), now.net)) * 100,
  };
}

// Walks a candidate split forward against a copy of the book. No mutation of
// real state; the market model is deterministic so this is exact, not a guess.
function simulateSplit(state, m, total, weights) {
  const wsum = weights.reduce((a, w) => a + w, 0);
  let stock = state.stock[m.id];
  let net = ZERO();
  const steps = [];
  for (let i = 0; i < weights.length; i++) {
    const depth = state.depth + i;
    const A = anchorOf(state, m, depth);
    if (i > 0) {
      const rate = Math.min(0.95, m.regen * regimeOf(depth).regen);
      stock = clampStock(add(stock, scale(sub(A, stock), rate)), A);
    }
    const q = scale(total, weights[i] / wsum);
    if (!isPos(q)) { steps.push({ depth, qty: ZERO(), net: ZERO() }); continue; }
    const shadow = { ...state, depth, stock: { ...state.stock, [m.id]: stock } };
    const pv = sellPreview(shadow, m.id, q);
    net = add(net, pv.net);
    stock = clampStock(add(stock, q), A);
    steps.push({ depth, qty: q, net: pv.net, index: pv.startIndex });
  }
  return { net, steps };
}

// ===========================================================================
// SECTION 15 - the dashboard
// ===========================================================================

/** Everything the player is allowed to see, in one call. Safe to poll. */
export function report(state) {
  const r = reveal(state);
  if (state.cashOnly) {
    return {
      depth: state.depth, reach: state.reach,
      essence: state.essence, essenceText: fmt(state.essence),
      scale: depthScale(state, state.depth),
      boost: state.boost.turns > 0 ? { ...state.boost } : null,
      offers: offers(state),
      prices: [], indicators: [], margins: [], recipes: [], forwards: [], trades: [],
      regime: null, reveal: null, standing: state.standing,
      worth: { value: state.essence, text: fmt(state.essence) },
    };
  }
  return {
    depth: state.depth,
    reach: state.reach,
    essence: state.essence,
    essenceText: fmt(state.essence),
    standing: state.standing,
    scale: depthScale(state, state.depth),
    boost: state.boost.turns > 0 ? { ...state.boost } : null,
    regime: has(state, 'regimes')
      ? { ...regimeOf(state.depth), ends: nextRegimeDepth(state.depth) }
      : null,
    prices: prices(state),
    indicators: r.goods.map(id => indicators(state, id)),
    offers: offers(state),
    margins: margins(state),
    recipes: recipes(state),
    forwards: has(state, 'consignments') ? consignments(state) : [],
    trades: state.trades.slice(0, 12),
    reveal: r,
    worth: netWorth(state),
  };
}

/**
 * Total wealth: cash, plus what the inventory would fetch if liquidated in one
 * order each, minus what is owed on open consignments. This is the number that
 * says whether trading is working, and it is the only scoreboard the market
 * keeps.
 */
export function netWorth(state) {
  let v = state.essence;
  for (const m of MATERIALS) {
    const h = state.held[m.id];
    if (!isPos(h)) continue;
    const pv = sellPreview(state, m.id, h);
    if (pv.ok) v = add(v, pv.net);
  }
  for (const f of state.forwards) {
    const short = maxL(sub(f.qty, state.held[f.id]), ZERO());
    if (isPos(short)) v = sub(v, mul(short, fairAt(state, f.id, f.due)));
  }
  return { value: v, text: fmt(v) };
}

// ===========================================================================
// SECTION 16 - save and load
// ===========================================================================
// State is JSON-safe apart from the two functions in cfg, which are rebuilt
// from the same config object on load.

export function save(state) {
  // `pow` is what the player's hand is worth right now. The hand is written
  // down on its own and this is worked out again from it, so saving it would
  // only be a second copy that could disagree with the first.
  const { cfg, pow, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}

export function load(saved, config = {}) {
  const state = create({ ...config, depth: saved.depth, reach: saved.reach });
  Object.assign(state, saved, { cfg: state.cfg });
  return state;
}
