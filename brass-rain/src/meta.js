// ---------------------------------------------------------------------------
// The notebook.
//
// WHAT THIS LAYER IS
//
// Overnight the parlour's nail technician goes down the row and re-nails every
// board. The floor is sold back, the boards are straightened, the machines are
// gone, and the only thing that survives the night is what the technician
// learned about how those boards played. That knowledge is written down as
// MARKS, and marks are the permanent currency of this game.
//
// A reset therefore trades a floor for a notebook. Everything in this file
// exists to make that trade honest: the floor really does go, the notebook
// really does keep filling, and the notebook never empties.
//
//
// THE FORMULA
//
//     marks(L) = floor( scale * (L / divisor) ^ exponent )
//
// where L is LIFETIME SCRIP - every scrip ever taken, across every reset,
// never itself reset. Defaults are scale 4, divisor 1e7, exponent 0.45, and
// all three are read from `cfg.prestige` when present so the pacing can be
// tuned without editing this file.
//
// The exponent is the pacing dial and nothing else in the layer matters as
// much. A root means doubling the marks costs more than doubling the takings:
// at 0.45 it costs 2^(1/0.45) = 4.67x. That is what makes the reset interval
// lengthen on its own, with no extra design and no artificial gate.
//
// Marks are cumulative, not per-run. What a reset pays is
//
//     pending = marks(L) - marks already taken
//
// so lifetime is a single monotone ledger and a reset can never make the
// player poorer. This is the difference between a layer that reads as a
// reward and one that reads as a toll.
//
//
// THE GATE
//
// A reset is offered only when it would pay at least `minMarks` (12), and at
// least `minFraction` (25 per cent) of the marks already held. The flat floor
// stops the first reset arriving before it can buy anything worth having; the
// fraction stops a late player resetting every few minutes for a rounding
// error. Twelve marks is exactly the cost of the opening tier, so the first
// reset buys a whole tier at once rather than one node.
//
//
// THE TREE
//
// Twenty five nodes. Twenty four are bought once; the last is repeatable
// forever so a player who owns the whole tree still has somewhere for marks to
// go. Sixteen of the twenty five put a NEW OBJECT on the screen - a mouth in
// the lacquer that was not there, a sixth bolt hole on the fitting rail, a
// fourth bend token, a second reel window, ten machines already standing when
// the night opens. Each one carries that description in its `visible` field. A
// layer that hands back only a number is a layer the player cannot see, and a
// layer the player cannot see is one they resent paying for.
//
// Nodes are gated three ways, and all three must pass: cost in marks, a list
// of node ids that must already be owned, and a minimum number of resets done.
// The reset gate is what keeps the late tiers from being bought early by a
// player who ground one enormous first night.
//
//
// HOW THE REST OF THE GAME READS THIS
//
// Through `effects(meta)` and nothing else. It returns a plain object with
// every field present and defaulted, so a caller may read any field without
// checking for undefined. `EFFECT_KINDS` declares, per field, whether the
// value is ADDED to a base, MULTIPLIES a base, is a FRACTION between 0 and 1,
// or is a LIST. Read that before wiring a field: a bonus applied as a total,
// or a total applied as a bonus, is the class of mistake that ships quietly.
//
// The fields, and where each one lands:
//
//   floorMult      mult   multiplies floor income (floor income metaMult)
//   cashMult       mult   multiplies the scrip rate at cash out
//   trayBonus      add    balls added to every round's tray grant
//   bendsPerRound  add    added to the board's bends allowance
//   bendReach      mult   multiplies how far a nail head will lean
//   shopSlots      add    added to the number of fittings that bolt in
//   shopOffers     add    added to the cards offered at the bench
//   rerollDiscount frac   fraction off a reroll price
//   startFittings  list   fitting ids bolted in before round one
//   matchBonus     add    added to the chance three reels agree
//   feverBalls     add    added to a fever's length in balls
//   continueBonus  add    added to the chance a fever rolls into another
//   extraPockets   list   pocket descriptions the board adds to its face
//   gateWidth      add    board units added to the gate mouth's width
//   quotaDiscount  frac   fraction taken off every round's quota
//   launchPer      add    added to the balls sent by one pull of the handle
//   spinsPerGate   add    added to the reel spins one gate ball buys
//   startMachines  list   id/count pairs the floor opens with after a reset
//   idleHours      add    hours added to the cap on paid away time
//
//
// WHAT THIS MODULE ASSUMES OF ITS CALLER
//
// 1. LIFETIME. The authoritative lifetime scrip lives at `meta.lifetime.scrip`.
//    The floor also keeps a running `earned`, which is wiped whenever the floor
//    is rebuilt, so every read here takes the larger of the two and `applyReset`
//    writes the larger back into the record. A caller that copies floor.earned
//    into meta.lifetime.scrip on its ordinary save tick loses nothing if the
//    page is closed mid-night.
//
// 2. RESETTING. `applyReset` never touches the floor, the run or the board. It
//    takes the marks, counts the reset and returns an instruction object saying
//    what must be cleared and what the new floor opens with. A function that
//    silently wipes a player's progress is the wrong shape for something one
//    wrong call away from a disaster, so the wiping is the caller's, in the
//    open, where it can be read.
//
// 3. EXTRA POCKETS. A pocket description is shaped like an entry in the board
//    configuration's pay pocket list, with a `kind` of 'pay' or 'gate' and, for
//    a gate, the funnel that feeds it. They must be placed BEFORE the nails are
//    laid, because a nail is never driven into a mouth and that check only runs
//    against furniture already present. The straightforward wiring is to append
//    them to the per-run configuration clone before the board is built.
//
// 4. STARTING FITTINGS. The ids are validated against the fitting table by the
//    caller. An id with no matching fitting must be dropped in silence, never
//    thrown, so a renamed fitting cannot brick a save.
//
//
// ARITHMETIC IS TREATED AS HOSTILE
//
// Every number that enters this file is checked before it is used and every
// number that leaves it is clamped. A lifetime that is negative, infinite or
// not a number yields zero marks rather than NaN; a corrupt saved node level is
// clamped into range rather than trusted; a multiplier can never be zero,
// negative or infinite. Nothing here throws, including on a restore from a
// truncated or hand-edited save.
// ---------------------------------------------------------------------------

import { priceAt } from './economy.js?v=3';

// ---------------------------------------------------------------------------
// Tuning that belongs to the layer rather than to the formula. The formula is
// read from configuration so it can be swept; the tree is content, and content
// lives with the code that describes it.
// ---------------------------------------------------------------------------

export const TUNING = Object.freeze({
  scale: 4,             // marks at exactly one divisor of lifetime scrip
  divisor: 1e7,         // the unit lifetime is measured in
  exponent: 0.45,       // the pacing dial; doubling marks costs 4.67x lifetime
  minScrip: 1e6,        // no reset is ever offered below this lifetime
  minMarks: 12,         // and none that would pay fewer marks than this
  minFraction: 0.25,    // nor fewer than this share of the marks already held
  perMark: 0.25,        // the notebook's passive, per root of marks earned
  maxMarks: 1e15,       // a ceiling, so no arithmetic here can reach infinity
});

/** Reads one tuning number out of configuration, falling back to the default. */
function tune(cfg, key) {
  const v = cfg && cfg.prestige ? Number(cfg.prestige[key]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : TUNING[key];
}

// ---------------------------------------------------------------------------
// The pockets the tree can set into the face. Geometry is in board units on the
// same face the nails are driven into, and every one of them is placed clear of
// the furniture that is already there and clear of the funnel that feeds the
// main gate.
// ---------------------------------------------------------------------------

const SAUCER = Object.freeze({
  id: 'saucer', kind: 'pay', label: '4', tone: 'brass',
  x: 50, y: 44, w: 4.6, h: 2.2, pay: 4,
});

const SHOULDER_LEFT = Object.freeze({
  id: 'shoulderL', kind: 'pay', label: '3', tone: 'enamel',
  x: 24, y: 72, w: 4.2, h: 2.2, pay: 3,
});

const SHOULDER_RIGHT = Object.freeze({
  id: 'shoulderR', kind: 'pay', label: '3', tone: 'enamel',
  x: 76, y: 72, w: 4.2, h: 2.2, pay: 3,
});

const SECOND_GATE = Object.freeze({
  id: 'gate2', kind: 'gate', label: 'Gate', tone: 'chrome',
  x: 27, y: 64, w: 3.4, h: 2.4, pay: 0, open: true,
  // A mouth with nothing gathering balls into it is a mouth nothing reaches,
  // so the description carries its own funnel. A board that ignores these two
  // numbers still works; the gate just sees far fewer balls.
  funnelRows: 2, funnelWidth: 11,
});

// ---------------------------------------------------------------------------
// The tree.
//
//   id        stable, saved, never renamed once shipped
//   name      what the notebook page is called
//   text      one sentence with the real numbers in it
//   cost      marks, or the base of a geometric price for a repeatable node
//   needs     node ids that must already be owned
//   resets    the number of resets that must have been done
//   gives     the effect fields this node moves
//   visible   what appears on screen that was not there before, or null
//   tier      which page of the notebook it sits on, for the menu
// ---------------------------------------------------------------------------

export const NODES = [

  // -- the first page -------------------------------------------------------

  {
    id: 'notebook', name: 'The Notebook', tier: 0, cost: 1, needs: [], resets: 1,
    text: 'The technician keeps a notebook. Every mark ever written in it raises what the whole floor earns, by a quarter of the square root of the count: 12 marks makes it x1.87, 60 marks x2.94, 400 marks x6.',
    visible: 'A bound notebook on the bench, open at the current page, with the mark count written on it.',
    gives: { perMark: true },
  },

  // -- the opening tier, twelve marks with the root, bought in one go --------

  {
    id: 'first_row', name: 'The First Row', tier: 1, cost: 3, needs: ['notebook'], resets: 1,
    text: 'Ten Upright Tens are left standing when the floor is sold. Every night opens with a row already earning, and ten is the first milestone, so the row runs at double rate from the first second.',
    visible: 'Ten machines standing on the floor at the moment a reset finishes, where there used to be an empty row and a price.',
    gives: { startMachines: { upright: 10 } },
  },
  {
    id: 'spare_tray', name: 'The Spare Tray', tier: 1, cost: 2, needs: ['notebook'], resets: 1,
    text: 'A spare tray under the machine. Every round starts with 60 more balls in it.',
    visible: 'A second tray under the cabinet, already full, before the first ball is sent.',
    gives: { trayBonus: 60 },
  },
  {
    id: 'bench_stool', name: 'The Third Stool', tier: 1, cost: 2, needs: ['notebook'], resets: 1,
    text: 'Room at the bench for one more fitting. Six bolt in at once instead of five.',
    visible: 'A sixth bolt hole on the fitting rail, empty and lit, from the first shop of the run.',
    gives: { shopSlots: 1 },
  },
  {
    id: 'pin_hammer', name: 'The Pin Hammer', tier: 1, cost: 2, needs: ['notebook'], resets: 1,
    text: 'A hammer of the technician\'s own. Four nails can be leaned each round instead of three.',
    visible: 'A fourth bend token on the nail rail, and a fourth nail that will take a lean.',
    gives: { bendsPerRound: 1 },
  },
  {
    id: 'counter_rail', name: 'The Counter Rail', tier: 1, cost: 2, needs: ['notebook'], resets: 1,
    text: 'A rail from the tray to the counter. Cashing out pays 30 per cent more scrip per ball.',
    visible: null,
    gives: { cashMult: 1.30 },
  },

  // -- the second page, from the second reset -------------------------------

  {
    id: 'floor_ledger', name: 'The Floor Ledger', tier: 2, cost: 8, needs: ['counter_rail'], resets: 2,
    text: 'The floor keeps its own books. Every machine earns 50 per cent more, and six more hours of an absence are paid, 18 instead of 12.',
    visible: null,
    gives: { floorMult: 1.50, idleHours: 6 },
  },
  {
    id: 'wider_gate', name: 'The Filed Gate', tier: 2, cost: 6, needs: ['pin_hammer'], resets: 2,
    text: 'The gate mouth filed out by four fifths of a board unit, from 3.6 wide to 4.4. The shoulder nails stand further apart to match.',
    visible: 'A measurably wider gate, with the two shoulder nails that guard it visibly pushed out.',
    gives: { gateWidth: 0.8 },
  },
  {
    id: 'second_offer', name: 'The Fourth Card', tier: 2, cost: 6, needs: ['bench_stool'], resets: 2,
    text: 'The bench lays out four fittings instead of three, every shop, for the whole run.',
    visible: 'A fourth card on the bench at every shop.',
    gives: { shopOffers: 1 },
  },
  {
    id: 'worn_reroll', name: 'The Worn Deck', tier: 2, cost: 5, needs: ['bench_stool'], resets: 2,
    text: 'A well-thumbed deck. Every reroll costs 30 per cent less, including the ones that have already climbed.',
    visible: null,
    gives: { rerollDiscount: 0.30 },
  },
  {
    id: 'pay_saucer', name: 'The Saucer', tier: 2, cost: 7, needs: ['spare_tray'], resets: 2,
    text: 'A brass saucer set high in the centre of the face, paying 4. It catches balls early in the fall, before the nails have finished with them.',
    visible: 'A new brass mouth in the lacquer high on the centre line, with the nail lattice opened around it.',
    gives: { extraPockets: [SAUCER] },
  },
  {
    id: 'first_fitting', name: 'The Bolted Fitting', tier: 2, cost: 8, needs: ['bench_stool'], resets: 2,
    text: 'A Brass Lip is left bolted to the machine. Round one is played with a fitting already in, before the first shop.',
    visible: 'A fitting already in slot one of the fitting rail when the run opens.',
    gives: { startFittings: ['brass_lip'] },
  },

  // -- the third page, from the fifth reset ---------------------------------

  {
    id: 'second_row', name: 'The Second Row', tier: 3, cost: 12, needs: ['first_row'], resets: 5,
    text: 'Ten Handle Cabinets and five Digital Seas are left standing as well. The cabinets are at their first milestone too.',
    visible: 'Three rows of machines standing on the floor the moment a reset finishes, not one.',
    gives: { startMachines: { handle: 10, digital: 5 } },
  },
  {
    id: 'nail_gauge', name: 'The Nail Gauge', tier: 3, cost: 15, needs: ['pin_hammer'], resets: 5,
    text: 'A gauge for the lean. A nail head will go half again as far, 2.4 board units instead of 1.6.',
    visible: 'The reach ring drawn around a picked nail is half again as wide, and reaches nails it could not before.',
    gives: { bendReach: 1.5 },
  },
  {
    id: 'long_lamp', name: 'The Long Lamp', tier: 3, cost: 16, needs: ['wider_gate'], resets: 5,
    text: 'A fever runs 30 balls longer, 120 instead of 90, and rolls straight into another 6 points more often, 36 per cent instead of 30.',
    visible: null,
    gives: { feverBalls: 30, continueBonus: 0.06 },
  },
  {
    id: 'detent_file', name: 'The Filed Detent', tier: 3, cost: 16, needs: ['wider_gate'], resets: 5,
    text: 'The reel detent filed back. Three digits agree 3 points more often, 14 per cent instead of 11.',
    visible: null,
    gives: { matchBonus: 0.03 },
  },
  {
    id: 'reel_window', name: 'The Second Window', tier: 3, cost: 18, needs: ['detent_file'], resets: 5,
    text: 'A second reel window beside the first. One ball through the gate buys two spins instead of one.',
    visible: 'A second window of three digits on the machine head, spinning its own reels beside the original.',
    gives: { spinsPerGate: 1 },
  },
  {
    id: 'standing_order', name: 'The Standing Order', tier: 3, cost: 18, needs: ['floor_ledger'], resets: 5,
    text: 'A standing order with the hall. Every machine on the floor earns 75 per cent more again.',
    visible: null,
    gives: { floorMult: 1.75 },
  },
  {
    id: 'two_hands', name: 'Two Hands', tier: 3, cost: 22, needs: ['first_fitting'], resets: 5,
    text: 'Two balls leave the rail on every pull of the handle instead of one. The tray empties twice as fast, which is a cost as well as a gift.',
    visible: 'Two balls riding the top rail together on every pull, and a tray counter that falls twice as fast.',
    gives: { launchPer: 1 },
  },

  // -- the last page, from the ninth reset ----------------------------------

  {
    id: 'short_night', name: 'The Short Night', tier: 4, cost: 40, needs: ['standing_order'], resets: 9,
    text: 'The parlour closes early. Every round asks for 12 per cent fewer balls, at every round of every run.',
    visible: null,
    gives: { quotaDiscount: 0.12 },
  },
  {
    id: 'second_gate', name: 'The Second Gate', tier: 4, cost: 45, needs: ['reel_window'], resets: 9,
    text: 'A second gate cut into the left of the face, with its own two rows of funnel nails, feeding the same reels.',
    visible: 'A second gate mouth on the face with a funnel of nails driven above it, where there was only lattice.',
    gives: { extraPockets: [SECOND_GATE] },
  },
  {
    id: 'bolted_pair', name: 'The Bolted Pair', tier: 4, cost: 50, needs: ['first_fitting', 'two_hands'], resets: 9,
    text: 'A Lamp Reflector and a Felt Strip are left bolted in as well. Round one is played with three fittings already fitted.',
    visible: 'Three of the fitting rail\'s slots filled before the first shop, not one.',
    gives: { startFittings: ['lamp_reflector', 'felt_strip'] },
  },
  {
    id: 'whole_row', name: 'The Whole Row', tier: 4, cost: 55, needs: ['standing_order', 'second_row'], resets: 9,
    text: 'The technician works the whole row, not one machine. Every machine earns 125 per cent more again, and cashing out pays double.',
    visible: null,
    gives: { floorMult: 2.25, cashMult: 2.00 },
  },
  {
    id: 'pocket_pair', name: 'The Pair', tier: 4, cost: 60, needs: ['pay_saucer'], resets: 9,
    text: 'Two more mouths set into the shoulders of the face, level with the gate and well out from it, paying 3 each.',
    visible: 'Two new mouths in the lacquer either side of the gate, catching the balls the funnel turns away.',
    gives: { extraPockets: [SHOULDER_LEFT, SHOULDER_RIGHT] },
  },

  // -- the page that never ends ---------------------------------------------
  //
  // Once the tree is bought out, marks would otherwise pile up against nothing.
  // This node takes them forever, at a price that climbs faster than what it
  // gives, so it can absorb any number of marks without ever running the
  // progression away.

  {
    id: 'page_after_page', name: 'Page After Page', tier: 5, cost: 12, ratio: 1.60,
    needs: [], resets: 1, repeatable: true, maxLevel: 200,
    text: 'One more page of nail settings. Each page adds 6 per cent to what the floor earns and 3 per cent to what cashing out pays, and each costs 60 per cent more marks than the page before it.',
    visible: null,
    gives: { floorMultPer: 1.06, cashMultPer: 1.03 },
  },
];

const BY_ID = new Map(NODES.map(n => [n.id, n]));

/** The node with this id, or null. */
export function nodeById(id) { return BY_ID.get(id) || null; }

// ---------------------------------------------------------------------------
// What every effect field means, declared rather than remembered.
//
//   'mult'  multiplies a base value; defaults to 1
//   'add'   is added to a base value; defaults to 0
//   'frac'  is a share between 0 and 1 taken off a base value; defaults to 0
//   'list'  is an array or a map, never a number; defaults to empty
// ---------------------------------------------------------------------------

export const EFFECT_KINDS = Object.freeze({
  floorMult: 'mult',
  cashMult: 'mult',
  trayBonus: 'add',
  bendsPerRound: 'add',
  bendReach: 'mult',
  shopSlots: 'add',
  shopOffers: 'add',
  rerollDiscount: 'frac',
  startFittings: 'list',
  matchBonus: 'add',
  feverBalls: 'add',
  continueBonus: 'add',
  extraPockets: 'list',
  gateWidth: 'add',
  quotaDiscount: 'frac',
  launchPer: 'add',
  spinsPerGate: 'add',
  startMachines: 'list',
  idleHours: 'add',
});

/** Ceilings, so no stack of nodes and no corrupt save can produce an absurdity. */
const CLAMPS = Object.freeze({
  floorMult: 1e12,
  cashMult: 1e9,
  trayBonus: 100000,
  bendsPerRound: 64,
  bendReach: 8,
  shopSlots: 24,
  shopOffers: 12,
  rerollDiscount: 0.90,
  matchBonus: 0.60,
  feverBalls: 5000,
  continueBonus: 0.60,
  gateWidth: 20,
  quotaDiscount: 0.50,
  launchPer: 64,
  spinsPerGate: 16,
  idleHours: 240,
});

// ---------------------------------------------------------------------------
// Small guards. Every number that arrives from a save, from configuration or
// from another module goes through one of these before it is used.
// ---------------------------------------------------------------------------

function finite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegative(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function wholeIn(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/** Trims the float noise a stack of discounts leaves behind. */
function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

function clampTo(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

// ---------------------------------------------------------------------------
// The record.
// ---------------------------------------------------------------------------

/** The permanent record as it stands before a single night has been played. */
export function createMeta() {
  return {
    version: 1,

    marks: 0,        // in hand, unspent
    spent: 0,        // gone into the tree
    earned: 0,       // every mark ever taken; drives the passive and the gate
    resets: 0,

    nodes: {},       // id -> level; 0 or 1 for a single node, 0..maxLevel above

    // The ledger a reset is priced from. Lifetime scrip is never reset, which
    // is what stops a reset from ever making the player poorer.
    lifetime: { scrip: 0, cashed: 0, balls: 0, runs: 0, seconds: 0 },

    // The best night ever had. The deepest round survives a reset because the
    // notebook remembers it, and because the floor's multiplier reads it: a
    // reset that also wiped this would take an hour of play back as well as
    // the machines.
    best: { round: 0, balls: 0, fever: 0, marks: 0, scrip: 0 },
  };
}

// ---------------------------------------------------------------------------
// The formula.
// ---------------------------------------------------------------------------

/**
 * The marks a lifetime of scrip is worth in total, taken and untaken together.
 *
 * A root, so doubling the marks costs 2^(1/exponent) times the takings and the
 * interval between resets lengthens without anything having to enforce it.
 * Anything that is not a positive finite number of scrip is worth nothing at
 * all, which is the only safe answer: a lifetime that has gone wrong somewhere
 * else must not be paid out on.
 */
export function marksFor(cfg, lifetimeScrip) {
  const L = Number(lifetimeScrip);
  if (!Number.isFinite(L) || L <= 0) return 0;

  const divisor = tune(cfg, 'divisor');
  const exponent = clampTo(tune(cfg, 'exponent'), 0.05, 1);
  const scale = tune(cfg, 'scale');
  if (!(divisor > 0) || !(scale > 0)) return 0;

  const ratio = L / divisor;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;

  const raw = scale * Math.pow(ratio, exponent);
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  // A value that is exactly an integer in arithmetic is very often a hair under
  // one in floating point: the cube root of 1e6 comes back as 99.99999999999999
  // and would floor to 99. The epsilon is relative so it stays meaningful at
  // any size and never moves a number that is genuinely below the next whole.
  const nudged = raw + Math.max(1e-9, raw * 1e-12);
  return Math.min(TUNING.maxMarks, Math.floor(nudged));
}

/**
 * The lifetime scrip a reset is priced from.
 *
 * The floor keeps a running total that is wiped when the floor is rebuilt, and
 * the record keeps one that is not, so the larger of the two is the truth. It
 * is read rather than written here: nothing about asking what a reset is worth
 * should change anything.
 */
export function lifetimeScrip(meta, floor) {
  const fromMeta = meta && meta.lifetime ? nonNegative(meta.lifetime.scrip) : 0;
  const fromFloor = floor ? nonNegative(floor.earned) : 0;
  return Math.max(fromMeta, fromFloor);
}

/** What a reset right now would pay. Never negative, never NaN. */
export function pendingMarks(cfg, meta, floor) {
  const total = marksFor(cfg, lifetimeScrip(meta, floor));
  const taken = meta ? nonNegative(meta.earned) : 0;
  const pending = Math.floor(total - taken);
  return pending > 0 ? pending : 0;
}

/** The fewest marks a reset must pay before it is offered at all. */
export function resetThreshold(cfg, meta) {
  const taken = meta ? nonNegative(meta.earned) : 0;
  const floorMarks = tune(cfg, 'minMarks');
  const share = Math.ceil(taken * tune(cfg, 'minFraction'));
  return Math.max(1, Math.max(floorMarks, share));
}

/**
 * Whether the technician is worth calling out, and if not, what to say.
 *
 * The sentence is the whole point of this function. A greyed-out button with
 * no reason on it is how a layer becomes a stat page nobody visits.
 */
export function canReset(cfg, meta, floor) {
  const L = lifetimeScrip(meta, floor);
  const minScrip = tune(cfg, 'minScrip');

  if (!(L > 0)) {
    return { ok: false, why: 'Nothing has been taken yet. There is nothing here for the technician to read.', marks: 0, need: resetThreshold(cfg, meta) };
  }
  if (L < minScrip) {
    return { ok: false, why: 'One night at one machine is not a row. Keep the floor running.', marks: 0, need: resetThreshold(cfg, meta) };
  }

  const marks = pendingMarks(cfg, meta, floor);
  const need = resetThreshold(cfg, meta);
  if (marks < need) {
    const short = need - marks;
    return {
      ok: false,
      marks, need,
      why: marks <= 0
        ? 'The boards have not changed since they were last read. Take more off the floor first.'
        : 'There are only ' + marks + ' marks in the floor as it stands. The technician will not come out for fewer than ' + need + ', which is ' + short + ' more.',
    };
  }

  return { ok: true, why: '', marks, need };
}

// ---------------------------------------------------------------------------
// Buying.
// ---------------------------------------------------------------------------

/** The level of a node, clamped into range whatever the save said. */
export function levelOf(meta, id) {
  const node = BY_ID.get(id);
  if (!node) return 0;
  const max = node.repeatable ? wholeIn(node.maxLevel, 1, 100000) : 1;
  const raw = meta && meta.nodes ? meta.nodes[id] : 0;
  return wholeIn(raw, 0, max);
}

/** What the next level of a node costs in marks. Infinity once it is finished. */
export function nodeCost(meta, id) {
  const node = BY_ID.get(id);
  if (!node) return Infinity;
  const level = levelOf(meta, id);
  if (!node.repeatable) return level > 0 ? Infinity : Math.max(1, Math.ceil(node.cost));
  const max = wholeIn(node.maxLevel, 1, 100000);
  if (level >= max) return Infinity;
  const price = priceAt(Math.max(1, node.cost), Math.max(1.0001, node.ratio || 1.6), level);
  return Number.isFinite(price) ? Math.ceil(price) : Infinity;
}

/** Everything a menu needs to draw one node, requirements and price included. */
export function nodeStatus(cfg, meta, id) {
  const node = BY_ID.get(id);
  if (!node) return { id, exists: false, level: 0, cost: Infinity, unlocked: false, affordable: false, done: true, why: 'no such page' };

  const level = levelOf(meta, id);
  const cost = nodeCost(meta, id);
  const done = !Number.isFinite(cost);
  const held = meta ? nonNegative(meta.marks) : 0;
  const resets = meta ? nonNegative(meta.resets) : 0;
  const needResets = Math.max(0, Math.floor(finite(node.resets, 0)));

  let why = '';
  let unlocked = true;
  if (resets < needResets) {
    unlocked = false;
    why = needResets === 1
      ? 'The technician has not been out yet.'
      : 'Not until the technician has been out ' + needResets + ' times.';
  } else {
    for (const req of node.needs || []) {
      if (levelOf(meta, req) <= 0) {
        const r = BY_ID.get(req);
        unlocked = false;
        why = 'Wants ' + (r ? r.name : req) + ' first.';
        break;
      }
    }
  }

  const affordable = unlocked && !done && held >= cost;
  if (unlocked && !done && !affordable) why = 'Costs ' + cost + ' marks.';
  if (done) why = node.repeatable ? 'Every page is written.' : 'Already in the notebook.';

  return { id, exists: true, level, cost, unlocked, affordable, done, why, node };
}

/**
 * Spends marks on a node.
 *
 * Refuses cleanly and says why. Nothing is taken and nothing is written unless
 * the whole purchase succeeds, so a refused buy leaves the record exactly as it
 * was found.
 */
export function buyNode(cfg, meta, id) {
  if (!meta || typeof meta !== 'object') return { ok: false, why: 'There is no notebook to write in.' };
  const node = BY_ID.get(id);
  if (!node) return { ok: false, why: 'There is no such page.' };

  const status = nodeStatus(cfg, meta, id);
  if (status.done) return { ok: false, why: status.why };
  if (!status.unlocked) return { ok: false, why: status.why };

  const cost = status.cost;
  const held = nonNegative(meta.marks);
  if (!Number.isFinite(cost)) return { ok: false, why: 'Every page is written.' };
  if (held < cost) {
    return { ok: false, why: 'That page costs ' + cost + ' marks and there are ' + Math.floor(held) + ' in hand.' };
  }

  if (!meta.nodes || typeof meta.nodes !== 'object') meta.nodes = {};
  meta.marks = held - cost;
  meta.spent = nonNegative(meta.spent) + cost;
  meta.nodes[id] = status.level + 1;

  return { ok: true, why: '', id, level: meta.nodes[id], cost, marks: meta.marks };
}

// ---------------------------------------------------------------------------
// Reading the layer.
// ---------------------------------------------------------------------------

/** Every field present, every field defaulted, nothing undefined. */
function emptyEffects() {
  return {
    floorMult: 1,
    cashMult: 1,
    trayBonus: 0,
    bendsPerRound: 0,
    bendReach: 1,
    shopSlots: 0,
    shopOffers: 0,
    rerollDiscount: 0,
    startFittings: [],
    matchBonus: 0,
    feverBalls: 0,
    continueBonus: 0,
    extraPockets: [],
    gateWidth: 0,
    quotaDiscount: 0,
    launchPer: 0,
    spinsPerGate: 0,
    startMachines: {},
    idleHours: 0,
  };
}

/**
 * Everything the notebook is worth, as one object.
 *
 * This is the only place the rest of the game reads the permanent layer from.
 * It is pure, it allocates a fresh object every call, and it never returns a
 * field that is undefined, so a caller may read any field and use the answer
 * without checking it first.
 *
 * `EFFECT_KINDS` says, for each field, whether the number is added to a base or
 * multiplies one. Read it before wiring a field in.
 */
export function effects(meta) {
  const e = emptyEffects();
  if (!meta || typeof meta !== 'object') return e;

  // The notebook's passive. It grows with the ROOT of the marks ever earned,
  // not with the count itself. A bonus that grows in step with the currency it
  // is paid in is compound interest: each reset would buy a multiplier that
  // shortens the next reset, and the whole curve would accelerate away instead
  // of flattening. A root cannot do that.
  //
  // It reads marks EARNED rather than marks HELD on purpose. Where the passive
  // is paid on the unspent pile, spending is a loss, and the well-known result
  // is a community rule telling players never to spend more than a sliver of
  // their pile, which turns the whole tree into content nobody buys.
  if (levelOf(meta, 'notebook') > 0) {
    const earned = nonNegative(meta.earned);
    e.floorMult *= 1 + TUNING.perMark * Math.sqrt(earned);
  }

  for (const node of NODES) {
    const level = levelOf(meta, node.id);
    if (level <= 0) continue;
    const g = node.gives || {};

    if (g.floorMult > 0) e.floorMult *= g.floorMult;
    if (g.cashMult > 0) e.cashMult *= g.cashMult;
    if (g.floorMultPer > 0) e.floorMult *= Math.pow(g.floorMultPer, level);
    if (g.cashMultPer > 0) e.cashMult *= Math.pow(g.cashMultPer, level);
    if (g.bendReach > 0) e.bendReach *= g.bendReach;

    if (g.trayBonus) e.trayBonus += g.trayBonus * level;
    if (g.bendsPerRound) e.bendsPerRound += g.bendsPerRound * level;
    if (g.shopSlots) e.shopSlots += g.shopSlots * level;
    if (g.shopOffers) e.shopOffers += g.shopOffers * level;
    if (g.matchBonus) e.matchBonus += g.matchBonus * level;
    if (g.feverBalls) e.feverBalls += g.feverBalls * level;
    if (g.continueBonus) e.continueBonus += g.continueBonus * level;
    if (g.gateWidth) e.gateWidth += g.gateWidth * level;
    if (g.launchPer) e.launchPer += g.launchPer * level;
    if (g.spinsPerGate) e.spinsPerGate += g.spinsPerGate * level;
    if (g.idleHours) e.idleHours += g.idleHours * level;

    // Fractions taken off a price or a target stack the way discounts do, so
    // that any number of them can never reach or pass 100 per cent.
    if (g.rerollDiscount) e.rerollDiscount = 1 - (1 - e.rerollDiscount) * (1 - g.rerollDiscount);
    if (g.quotaDiscount) e.quotaDiscount = 1 - (1 - e.quotaDiscount) * (1 - g.quotaDiscount);

    if (Array.isArray(g.startFittings)) for (const id of g.startFittings) if (!e.startFittings.includes(id)) e.startFittings.push(id);
    if (Array.isArray(g.extraPockets)) for (const p of g.extraPockets) e.extraPockets.push(Object.assign({}, p));
    if (g.startMachines) for (const k of Object.keys(g.startMachines)) {
      e.startMachines[k] = (e.startMachines[k] || 0) + Math.max(0, Math.floor(g.startMachines[k]));
    }
  }

  // Nothing leaves this function unclamped. A multiplier of zero would silence
  // the whole floor and a multiplier of infinity would poison every number
  // downstream of it, and both are one corrupt save away.
  e.floorMult = clampTo(e.floorMult, 1, CLAMPS.floorMult);
  e.cashMult = clampTo(e.cashMult, 1, CLAMPS.cashMult);
  e.bendReach = clampTo(e.bendReach, 1, CLAMPS.bendReach);
  e.trayBonus = clampTo(e.trayBonus, 0, CLAMPS.trayBonus);
  e.bendsPerRound = wholeIn(e.bendsPerRound, 0, CLAMPS.bendsPerRound);
  e.shopSlots = wholeIn(e.shopSlots, 0, CLAMPS.shopSlots);
  e.shopOffers = wholeIn(e.shopOffers, 0, CLAMPS.shopOffers);
  e.rerollDiscount = round6(clampTo(e.rerollDiscount, 0, CLAMPS.rerollDiscount));
  e.matchBonus = clampTo(e.matchBonus, 0, CLAMPS.matchBonus);
  e.feverBalls = clampTo(e.feverBalls, 0, CLAMPS.feverBalls);
  e.continueBonus = clampTo(e.continueBonus, 0, CLAMPS.continueBonus);
  e.gateWidth = clampTo(e.gateWidth, 0, CLAMPS.gateWidth);
  e.quotaDiscount = round6(clampTo(e.quotaDiscount, 0, CLAMPS.quotaDiscount));
  e.launchPer = wholeIn(e.launchPer, 0, CLAMPS.launchPer);
  e.spinsPerGate = wholeIn(e.spinsPerGate, 0, CLAMPS.spinsPerGate);
  e.idleHours = clampTo(e.idleHours, 0, CLAMPS.idleHours);

  return e;
}

// ---------------------------------------------------------------------------
// The reset.
// ---------------------------------------------------------------------------

/**
 * Calls the technician out.
 *
 * This takes the marks, writes the lifetime ledger into the record, counts the
 * reset, and then STOPS. It does not clear the floor, it does not end the run
 * and it does not straighten a single nail. It returns an instruction saying
 * what must go and what the new floor opens with, and the caller does the
 * clearing where it can be seen.
 *
 * That split is deliberate. This function sits one wrong call away from
 * deleting a player's night, and a function shaped so that calling it by
 * accident destroys something is the wrong shape however carefully it is
 * called.
 *
 * On refusal nothing at all is written and the reason is a sentence.
 */
export function applyReset(cfg, meta, floor) {
  const check = canReset(cfg, meta, floor);
  if (!check.ok) {
    return { ok: false, why: check.why, marks: 0, clear: null, start: null };
  }

  const marks = check.marks;
  const L = lifetimeScrip(meta, floor);

  if (!meta.lifetime || typeof meta.lifetime !== 'object') meta.lifetime = createMeta().lifetime;
  meta.lifetime.scrip = L;
  if (floor) {
    meta.lifetime.cashed = Math.max(nonNegative(meta.lifetime.cashed), nonNegative(floor.cashed));
    meta.best.round = Math.max(nonNegative(meta.best.round), nonNegative(floor.bestRound));
  }
  meta.best.scrip = Math.max(nonNegative(meta.best.scrip), L);
  meta.best.marks = Math.max(nonNegative(meta.best.marks), marks);

  meta.marks = nonNegative(meta.marks) + marks;
  meta.earned = nonNegative(meta.earned) + marks;
  meta.resets = Math.floor(nonNegative(meta.resets)) + 1;

  const e = effects(meta);

  return {
    ok: true,
    why: '',
    marks,
    resets: meta.resets,
    lifetime: L,

    // What the caller must clear. Every one of these is a thing the technician
    // undoes overnight, and naming them one at a time is what makes the trade
    // readable rather than a shrug.
    clear: {
      scrip: true,          // the till goes back to nothing
      machines: true,       // every machine is sold; see `start` for what stays
      attendants: true,     // and every attendant is let go
      run: true,            // the night in progress ends where it stands
      fittings: true,       // every fitting bolted in during that run
      bends: true,          // every board is straightened and re-nailed
      seeds: true,          // and every machine gets a new face
      rerolls: true,        // the bench prices go back to their opening numbers
    },

    // What survives, listed so a reader does not have to infer it from what is
    // missing above.
    keep: {
      lifetimeScrip: true,  // marks are priced from it; resetting it would
                            // charge the player twice for the same night
      bestRound: true,      // the notebook remembers the best night
      marks: true,
      nodes: true,
    },

    // What the floor opens with the moment the clearing is done. A floor that
    // opens at nothing is a floor that pays nothing for the first minutes of
    // every reset, and those minutes are exactly where a prestige layer earns
    // its reputation.
    start: {
      machines: e.startMachines,
      fittings: e.startFittings.slice(),
      bestRound: nonNegative(meta.best.round),
      scrip: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Saving.
// ---------------------------------------------------------------------------

/** The record, small enough to sit inside a save and flat enough to read. */
export function serializeMeta(meta) {
  const m = (meta && typeof meta === 'object') ? meta : createMeta();
  const nodes = {};
  for (const node of NODES) {
    const level = levelOf(m, node.id);
    if (level > 0) nodes[node.id] = level;
  }
  const lifetime = m.lifetime || {};
  const best = m.best || {};
  return {
    version: 1,
    marks: nonNegative(m.marks),
    spent: nonNegative(m.spent),
    earned: nonNegative(m.earned),
    resets: Math.floor(nonNegative(m.resets)),
    nodes,
    lifetime: {
      scrip: nonNegative(lifetime.scrip),
      cashed: nonNegative(lifetime.cashed),
      balls: nonNegative(lifetime.balls),
      runs: Math.floor(nonNegative(lifetime.runs)),
      seconds: nonNegative(lifetime.seconds),
    },
    best: {
      round: Math.floor(nonNegative(best.round)),
      balls: nonNegative(best.balls),
      fever: nonNegative(best.fever),
      marks: Math.floor(nonNegative(best.marks)),
      scrip: nonNegative(best.scrip),
    },
  };
}

/**
 * A record back out of a save.
 *
 * Anything at all may be handed to this: a number, a string, null, a truncated
 * object, an object whose fields are the wrong types, a node level of minus
 * one, a node id that no longer exists. It never throws and it always returns a
 * record the rest of this file will accept. A save that cannot be read is a
 * fresh notebook, never an error and never a blank screen.
 */
export function restoreMeta(obj) {
  const meta = createMeta();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return meta;

  meta.marks = nonNegative(obj.marks);
  meta.spent = nonNegative(obj.spent);
  meta.earned = nonNegative(obj.earned);
  meta.resets = Math.floor(nonNegative(obj.resets));

  const nodes = (obj.nodes && typeof obj.nodes === 'object' && !Array.isArray(obj.nodes)) ? obj.nodes : {};
  for (const node of NODES) {
    const max = node.repeatable ? wholeIn(node.maxLevel, 1, 100000) : 1;
    const level = wholeIn(nodes[node.id], 0, max);
    if (level > 0) meta.nodes[node.id] = level;
  }

  const lifetime = (obj.lifetime && typeof obj.lifetime === 'object') ? obj.lifetime : {};
  meta.lifetime.scrip = nonNegative(lifetime.scrip);
  meta.lifetime.cashed = nonNegative(lifetime.cashed);
  meta.lifetime.balls = nonNegative(lifetime.balls);
  meta.lifetime.runs = Math.floor(nonNegative(lifetime.runs));
  meta.lifetime.seconds = nonNegative(lifetime.seconds);

  const best = (obj.best && typeof obj.best === 'object') ? obj.best : {};
  meta.best.round = Math.floor(nonNegative(best.round));
  meta.best.balls = nonNegative(best.balls);
  meta.best.fever = nonNegative(best.fever);
  meta.best.marks = Math.floor(nonNegative(best.marks));
  meta.best.scrip = nonNegative(best.scrip);

  // A record whose marks in hand and marks spent do not add up to the marks
  // ever earned has been edited or was written by an older build. The earned
  // total is the one the passive and the reset gate are priced from, so it is
  // raised to fit rather than the other two being cut: a player is never
  // charged for a fault in a file.
  const accounted = meta.marks + meta.spent;
  if (meta.earned < accounted) meta.earned = accounted;

  return meta;
}
