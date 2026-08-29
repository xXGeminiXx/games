// ---------------------------------------------------------------------------
// Fittings: the parts that get bolted into the machine, as pure data.
//
// This file is the catalogue and the contract. It has no imports, no DOM, no
// canvas, no timers and no random source of its own. Everything it needs is
// handed to it. That makes it readable by a test, by a balance tool and by the
// game itself without any of them dragging the others in.
//
// ===========================================================================
// THE MACHINE MODEL
// ===========================================================================
//
// BASE_MODEL is the flat bag of numbers that describes one board. Every key is
// a number. Nothing else in the game is allowed to be a hidden constant: if a
// fitting can change it, it lives here.
//
// A fitting changes the model in one of two ways.
//
//   mods   Declarative. A plain object of key -> [op, value] where op is
//          '+' (add), '*' (multiply) or '=' (replace). The machine builder
//          applies every owned fitting's mods once, before the round starts,
//          in catalogue order: all '=' first, then all '*', then all '+'.
//          Deterministic, order independent within a phase, and testable
//          without running a ball.
//
//   board  Declarative. A plain object read by the board builder to change
//          what is physically on the face: nails added or pulled, a slope, a
//          bumper, a shutter, a second gate mouth. The keys are listed under
//          BOARD DIRECTIVES below. This module never touches geometry itself
//          and never reaches into a renderer.
//
// apply() is the imperative part. It runs on the one event named by `hook`.
// A fitting with hook 'static' has an apply() that does nothing; its whole
// content is in mods and board.
//
// ===========================================================================
// MODEL KEYS
// ===========================================================================
//
//   trayStart      balls in the tray when a run begins
//   slots          bolt points on the machine, i.e. how many fittings fit
//   inFlight       balls allowed on the glass at once
//   flightTime     seconds from launch to settle, at inFlight 1
//   launchFloor    shortest possible gap between launches, seconds
//   pinHits        average nails a falling ball touches
//   aimWindow      strength points either side of the sweet spot that hold
//                  full gate probability
//   aimFalloff     strength points beyond the window over which gate
//                  probability decays to its floor
//
//   gateProb       chance a launched ball enters the centre gate
//   gatePay        balls paid by the gate
//   jadeProb       chance of the jade pocket
//   jadePay        balls paid by the jade pocket
//   creamProb      chance of a cream pocket
//   creamPay       balls paid by a cream pocket
//   sideProb       chance of a side pocket
//   sidePay        balls paid by a side pocket
//   (out is derived: 1 minus the four above)
//
//   reachProb      chance the two outer reels stop on the same face
//   middleWeight   chance the middle reel settles on the reached face
//   stripStops     stops on one reel strip
//   sevenStops     how many of those stops are the seven face
//
//   feverLen       fever length in balls
//   feverMult      multiplier on every payout while the lamp is warm
//   attackerProb   chance of the attacker pocket during fever
//   attackerPay    balls paid by the attacker pocket
//   feverGateProb  gate chance during fever, which is what extends a fever
//   feverCreamProb cream chance during fever
//   feverSideProb  side chance during fever
//   continuationAdd balls added to the fever counter by a match during fever
//
//   quotaMul       multiplier on every round's quota
//   budgetAdd      launches added to every round's budget
//   clearBonusMul  multiplier on the clear bonus
//
//   shopSize       fittings offered per shop
//   rerollBase     first reroll cost in balls
//   rerollStep     how much each further reroll in one shop costs
//
//   payMul         global multiplier on every payout
//   lockStrength   1 if the launch strength is latched to the last paying value
//
// ===========================================================================
// BOARD DIRECTIVES
// ===========================================================================
//
//   addPins        string tag naming a nail group to add
//                  ('side-shelf', 'comb')
//   removePins     string tag naming a nail group to pull
//                  ('gate-shoulder', 'outer-columns')
//   slope          signed fraction, the lean of the lower field
//                  (negative leans left)
//   bumpers        integer count of rubber bumpers set above the gate
//   shutter        string tag naming pockets a shutter closes ('outer-side')
//   gates          integer count of gate mouths
//   diverter       true to move the gate mouth off centre
//   duplicateLower true to mirror the lower third so every pocket exists twice
//   frosted        true to render the glass opaque
//
// The board builder resolves these into geometry. Two fittings adding the same
// tag add the group twice. Nothing here names a colour, a sprite or a node.
//
// ===========================================================================
// HOOKS
// ===========================================================================
//
// Every apply() takes exactly one argument, ctx. Every ctx carries:
//
//   ctx.model    the built model, after mods. Read it; do not write it from a
//                hook. Write through mods instead.
//   ctx.state    a scratch object for the whole run. A fitting may read and
//                write ctx.state[<its own id>] and nothing else. The host
//                clears that key at the start of each round for fittings whose
//                `scope` is 'round'.
//   ctx.stats    read only counters the host maintains:
//                  launchesThisRound, pocketsThisRound, feversThisRound,
//                  ballsThisRun, lastPayingStrength (0..1 or null)
//   ctx.rand     the run's seeded generator, a function returning [0, 1).
//                This module never calls any other source of randomness.
//   ctx.disable  set true to remove this fitting for the rest of the run.
//
// Hooks, what else they carry, and what may legally be written:
//
//   static       Never fires. mods and board carry the whole effect.
//
//   onRunStart   { tray:{balls}, slotsUsed }
//                write: tray.balls
//
//   onRoundStart { round:{n, budget, quota, launches, paid}, tray:{balls} }
//                write: round.budget, round.quota, tray.balls
//
//   onShopOpen   { shop:{offers, rerollCost, rerollStep, freeRerolls,
//                        slots, guarantee} }
//                write: shop.rerollCost, shop.rerollStep, shop.freeRerolls,
//                       shop.guarantee ('rare' forces one rare in the offer)
//
//   onLaunch     { ball, strength (0..1), launchIndex (0 based, per round) }
//                write: ball.mul, ball.add, ball.free, ball.forceGate,
//                       ball.forcePocket ('jade'|'cream'|'side'|'attacker'),
//                       ball.tags
//
//   onPinHit     { ball, pin:{kind:'nail'|'bumper', side:'left'|'right'},
//                  hitIndex (1 based) }
//                write: ball.mul, ball.add, ball.tags
//
//   onPocket     { ball, pocket:{id, kind, base}, payout, fever (bool) }
//                returns: a number that REPLACES ctx.payout. Returning
//                undefined leaves it alone. Fittings on this hook run in
//                catalogue order and each sees the previous one's result.
//
//   onGate       { ball, payout, fever (bool) }
//                returns: a number that replaces ctx.payout.
//
//   onReelSpin   { spin:{reels:[a,b,c], reach, reachSymbol, matched, symbol,
//                        respins, respin, feverLen, feverMult} }
//                write: spin.matched, spin.symbol, spin.respin (host reruns
//                the spin once), spin.feverLen, spin.feverMult (override the
//                fever this spin would start)
//
//   onFeverStart { fever:{balls, mult, symbol, seven, openings} }
//                write: fever.balls, fever.mult, and push windows onto
//                fever.openings as {balls, attackerProb}. The host takes the
//                highest attackerProb among windows still covering the current
//                fever ball.
//
//   onFeverBall  { fever:{balls, mult, ballsUsed}, ball, ballsLeft }
//                write: fever.mult, fever.balls, ball.free, ball.mul, ball.add
//
//   onFeverEnd   { fever:{ballsPaid, totalPaid}, after }
//                write: push windows onto `after` as
//                {balls, attackerProb?, gateProb?}. The host applies them to
//                the balls immediately following the fever, highest value
//                winning where windows overlap.
//
//   onBallLost   { ball, refund }
//                returns: a number that replaces ctx.refund (balls returned
//                to the tray). Default refund is 0.
//
//   onRoundEnd   { round:{n, budget, quota, launches, paid}, cleared (bool),
//                  bonus, carry }
//                returns: a number that replaces ctx.bonus.
//                write: carry.launches (launches carried into the next round)
//
//   onCashOut    { tray:{balls}, rounds, scrip }
//                returns: a number that replaces ctx.scrip.
//
// A hook that neither writes a documented field nor returns a number has done
// nothing. There is no other way for a fitting to affect the game.
//
// ===========================================================================
// FITTING SHAPE
// ===========================================================================
//
//   id        stable string key, used for save data and synergies
//   name      the words pressed into the plaque
//   text      player facing sentence. May contain {token} substitutions
//             resolved by describe(): {key} plain, {key%} percent to 1 dp,
//             {key#} rounded integer, {key~} 2 dp. Keys resolve against the
//             fitting's own `n` bag first, then the live model.
//   rarity    'common' | 'uncommon' | 'rare' | 'brass'
//   price     cost in balls at the shop counter
//   hook      one of the hook names above, or 'static'
//   tags      free strings for filtering and for shop guarantees
//             ('board', 'gate', 'fever', 'reel', 'pocket', 'cadence',
//              'economy', 'cost', 'risk')
//   apply     pure function (ctx) => void or (ctx) => number
//   mods      optional declarative model changes
//   board     optional declarative board changes
//   n         optional bag of the fitting's own numbers, for text and tests
//   scope     'run' (default) or 'round', controlling when the host clears
//             ctx.state[id]
//   maxStack  how many copies may be owned, default 1
//   bound     one sentence saying what stops this fitting running away
// ---------------------------------------------------------------------------

// ---- model -----------------------------------------------------------------

export const BASE_MODEL = Object.freeze({
  trayStart: 100,
  slots: 4,
  inFlight: 1,
  flightTime: 2.0,
  launchFloor: 0.25,
  pinHits: 14,
  aimWindow: 6,
  aimFalloff: 19,

  gateProb: 0.10,
  gatePay: 3,
  jadeProb: 0.02,
  jadePay: 5,
  creamProb: 0.06,
  creamPay: 3,
  sideProb: 0.10,
  sidePay: 1,

  reachProb: 0.2361,
  middleWeight: 0.42,
  stripStops: 12,
  sevenStops: 1,

  feverLen: 10,
  feverMult: 1.0,
  attackerProb: 0.50,
  attackerPay: 8,
  feverGateProb: 0.10,
  feverCreamProb: 0.06,
  feverSideProb: 0.10,
  continuationAdd: 10,

  quotaMul: 1.0,
  budgetAdd: 0,
  clearBonusMul: 1.0,

  shopSize: 3,
  rerollBase: 12,
  rerollStep: 8,

  payMul: 1.0,
  lockStrength: 0
});

// Clamps that hold no matter what is bolted on. Every one of these exists
// because an unbounded version of it ends a run in the first fever.
export const MODEL_CLAMPS = Object.freeze({
  gateProb: [0.01, 0.30],
  jadeProb: [0.0, 0.12],
  creamProb: [0.0, 0.28],
  sideProb: [0.0, 0.28],
  pocketTotal: 0.62,
  attackerProb: [0.0, 0.85],
  middleWeight: [0.05, 0.75],
  reachProb: [0.05, 0.55],
  feverGateProb: [0.01, 0.45],
  inFlight: [1, 8],
  flightTime: [0.35, 4.0],
  pinHits: [3, 30]
});

const NOOP = () => {};

// Apply one mods object to a model. Ops are '=', then '*', then '+', so two
// fittings that touch the same key land in a fixed order whatever the shop
// offered first.
export function applyMods(model, mods) {
  if (!model || !mods) return model;
  for (const phase of ['=', '*', '+']) {
    for (const key of Object.keys(mods)) {
      const entry = mods[key];
      if (!Array.isArray(entry) || entry[0] !== phase) continue;
      const v = entry[1];
      const cur = typeof model[key] === 'number' ? model[key] : 0;
      if (phase === '=') model[key] = v;
      else if (phase === '*') model[key] = cur * v;
      else model[key] = cur + v;
    }
  }
  return model;
}

function clampModel(m) {
  for (const key of Object.keys(MODEL_CLAMPS)) {
    const c = MODEL_CLAMPS[key];
    if (!Array.isArray(c)) continue;
    if (typeof m[key] === 'number') m[key] = Math.min(c[1], Math.max(c[0], m[key]));
  }
  const total = m.gateProb + m.jadeProb + m.creamProb + m.sideProb;
  if (total > MODEL_CLAMPS.pocketTotal) {
    const k = MODEL_CLAMPS.pocketTotal / total;
    m.gateProb *= k; m.jadeProb *= k; m.creamProb *= k; m.sideProb *= k;
  }
  return m;
}

// Build the model for a set of owned fittings. `owned` may be ids or objects,
// and a repeated id stacks its mods that many times.
export function buildModel(owned = [], base = BASE_MODEL) {
  const m = { ...base };
  const list = normaliseOwned(owned);
  for (const f of list) applyMods(m, f.mods);
  return clampModel(m);
}

function normaliseOwned(owned) {
  const out = [];
  for (const o of owned || []) {
    const id = typeof o === 'string' ? o : (o && o.id);
    const f = BY_ID.get(id);
    if (f) out.push(f);
  }
  return out;
}

// ---- expected value --------------------------------------------------------
//
// The whole board economy in one pure function, so a balance tool, a test and
// the game itself all read the same number from the same place.
export function analyse(model = BASE_MODEL) {
  const m = model;
  const outProb = 1 - m.gateProb - m.jadeProb - m.creamProb - m.sideProb;

  const rtpBase =
    (m.gateProb * m.gatePay +
     m.jadeProb * m.jadePay +
     m.creamProb * m.creamPay +
     m.sideProb * m.sidePay) * m.payMul;

  const matchProb = m.reachProb * m.middleWeight;
  const sevenProb = Math.pow(m.sevenStops / m.stripStops, 2) * m.middleWeight;
  const feverPerBall = m.gateProb * matchProb;

  const feverEvBall =
    (m.attackerProb * m.attackerPay +
     m.feverGateProb * m.gatePay +
     m.feverCreamProb * m.creamPay +
     m.feverSideProb * m.sidePay) * m.feverMult * m.payMul;

  const contPerBall = m.feverGateProb * matchProb;
  const drag = 1 - contPerBall * m.continuationAdd;
  const feverLenExpected = m.feverLen / Math.max(0.05, drag);

  const load = feverLenExpected * feverPerBall;
  const feverShare = load / (1 + load);
  const overallRtp = (1 - feverShare) * rtpBase + feverShare * feverEvBall;

  const interval = Math.max(m.launchFloor, m.flightTime / m.inFlight);
  const launchesPerMin = 60 / interval;

  return {
    outProb, rtpBase, matchProb, sevenProb, feverPerBall,
    ballsPerFever: feverPerBall > 0 ? 1 / feverPerBall : Infinity,
    feverEvBall, feverLenExpected, feverShare, overallRtp,
    interval, launchesPerMin,
    netPerLaunch: overallRtp - 1,
    netPerMin: (overallRtp - 1) * launchesPerMin
  };
}

// ---- catalogue -------------------------------------------------------------

function fit(def) {
  const f = {
    rarity: 'common', price: 30, hook: 'static', tags: [],
    scope: 'run', maxStack: 1, n: {}, bound: '', ...def
  };
  if (!f.apply) f.apply = NOOP;
  return f;
}

export const FITTINGS = [

  // ---- common ---------------------------------------------------------- //

  fit({
    id: 'extra_nail_row', name: 'Extra Nail Row',
    text: 'A fresh row of nails above the side shelves. Side pocket chance +2 points, now {sideProb%}.',
    rarity: 'common', price: 30, hook: 'static', tags: ['board', 'pocket'],
    mods: { sideProb: ['+', 0.02] }, board: { addPins: 'side-shelf' },
    maxStack: 2,
    bound: 'Side pockets pay 1, so a row is worth +0.02 balls per launch and the pocket total clamp holds at 0.62.'
  }),

  fit({
    id: 'pulled_nail', name: 'Pulled Nail',
    text: 'Two nails pulled from the gate shoulder. Gate chance +1 point, now {gateProb%}.',
    rarity: 'common', price: 30, hook: 'static', tags: ['board', 'gate'],
    mods: { gateProb: ['+', 0.01] }, board: { removePins: 'gate-shoulder' },
    maxStack: 3,
    bound: 'Gate probability is clamped at 0.30, so three copies plus a magnet still cannot open the board.'
  }),

  fit({
    id: 'brass_lip', name: 'Brass Lip',
    text: 'A brass lip on the cream pockets. Cream pays {creamPay} instead of 3.',
    rarity: 'common', price: 30, hook: 'static', tags: ['pocket'],
    mods: { creamPay: ['+', 1] },
    bound: 'One extra ball on a 6 percent pocket is +0.06 RTP.'
  }),

  fit({
    id: 'rubber_sleeve', name: 'Rubber Sleeve',
    text: 'Rubber sleeves on ten nails. Every nail the ball touches adds x{per~}, up to x1.20.',
    rarity: 'common', price: 35, hook: 'onPinHit', tags: ['ball'],
    n: { per: 0.02, cap: 0.20 },
    bound: 'Hard capped at +0.20 per ball, so a longer fall is worth nothing extra.',
    apply: (ctx) => {
      const acc = ctx.ball.s.rubber_sleeve || 0;
      if (acc >= 0.20) return;
      const step = Math.min(0.02, 0.20 - acc);
      ctx.ball.s.rubber_sleeve = acc + step;
      ctx.ball.mul += step;
    }
  }),

  fit({
    id: 'felt_strip', name: 'Felt Strip',
    text: 'Felt on the deep nails. Every 4th nail touched adds +{add~} to the pocket value, up to +3.',
    rarity: 'common', price: 30, hook: 'onPinHit', tags: ['ball'],
    n: { every: 4, add: 0.5, cap: 3 },
    bound: 'Capped at +3 flat, which is worth less than one cream pocket once payouts scale.',
    apply: (ctx) => {
      const st = ctx.ball.s.felt_strip || { hits: 0, add: 0 };
      st.hits += 1;
      if (st.hits % 4 === 0 && st.add < 3) {
        const step = Math.min(0.5, 3 - st.add);
        st.add += step;
        ctx.ball.add += step;
      }
      ctx.ball.s.felt_strip = st;
    }
  }),

  fit({
    id: 'counterweight_plate', name: 'Counterweight Plate',
    text: 'A weight on the launch arm. A launch at strength 80 or over carries x{mul~}.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { min: 0.80, mul: 1.15 },
    bound: 'Strength 80 and over sits well off the gate sweet spot, so taking it costs gate frequency.',
    apply: (ctx) => { if (ctx.strength >= 0.80) ctx.ball.mul *= 1.15; }
  }),

  fit({
    id: 'soft_spring', name: 'Soft Spring',
    text: 'A softer launch spring. A launch at strength 35 or under adds +{add#} to whatever it pays.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { max: 0.35, add: 2 },
    bound: 'Flat +2 and only on soft launches, which reach the gate less often.',
    apply: (ctx) => { if (ctx.strength <= 0.35) ctx.ball.add += 2; }
  }),

  fit({
    id: 'return_rail', name: 'Return Rail',
    text: 'A rail under the out lanes. 1 lost ball in 5 rolls back into the tray.',
    rarity: 'common', price: 35, hook: 'onBallLost', tags: ['economy'],
    n: { p: 0.20 },
    bound: 'Returns a ball, never a payout, so it never touches the quota.',
    apply: (ctx) => (ctx.rand() < 0.20 ? ctx.refund + 1 : ctx.refund)
  }),

  fit({
    id: 'wire_basket', name: 'Wire Basket',
    text: 'Wire baskets behind the side pockets. Side pockets pay {sidePay} instead of 1.',
    rarity: 'common', price: 35, hook: 'static', tags: ['pocket'],
    mods: { sidePay: ['+', 1] },
    bound: 'Doubles the cheapest pocket on the board: +0.10 RTP.'
  }),

  fit({
    id: 'reel_detent', name: 'Reel Detent',
    text: 'A detent on the middle reel. It settles on the reached face {middleWeight%} of the time.',
    rarity: 'common', price: 30, hook: 'static', tags: ['reel', 'fever'],
    mods: { middleWeight: ['+', 0.04] },
    bound: 'Middle reel weight is clamped at 0.75, and it only affects reaches that already happened.'
  }),

  fit({
    id: 'slack_reel', name: 'Slack Reel',
    text: 'Slack in the outer reel belts. Reach chance +3 points, now {reachProb%}.',
    rarity: 'common', price: 30, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['+', 0.03] },
    bound: 'Reach probability is clamped at 0.55.'
  }),

  fit({
    id: 'gate_tongue', name: 'Gate Tongue',
    text: 'A tongue in the gate mouth. The gate pays {gatePay} balls instead of 3.',
    rarity: 'common', price: 30, hook: 'static', tags: ['gate'],
    mods: { gatePay: ['+', 2] },
    bound: 'Pays balls only. It does not change how often the reels spin.'
  }),

  fit({
    id: 'lamp_reflector', name: 'Lamp Reflector',
    text: 'A reflector behind the lamp. Fever runs {feverLen} balls instead of 10.',
    rarity: 'common', price: 35, hook: 'static', tags: ['fever'],
    mods: { feverLen: ['+', 2] },
    bound: 'Adds length, not rate. With no fever in a round it does nothing at all.'
  }),

  fit({
    id: 'second_rail', name: 'Second Rail',
    text: 'A second launch rail. {inFlight} balls on the glass at once, so the tray empties and fills twice as fast.',
    rarity: 'common', price: 35, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 1] },
    bound: 'Cadence multiplies wins and losses equally. Under RTP 1 it kills you faster.'
  }),

  fit({
    id: 'rail_brush', name: 'Rail Brush',
    text: 'A brush that wipes the rail clean. Flight time -15%.',
    rarity: 'common', price: 30, hook: 'static', tags: ['cadence'],
    mods: { flightTime: ['*', 0.85] },
    bound: 'Flight time floors at 0.35s and the rail floor caps the gain regardless.'
  }),

  fit({
    id: 'sorting_gate', name: 'Sorting Gate',
    text: 'A sorting gate on the rail. Every 10th ball of a round is steered into the gate mouth.',
    rarity: 'common', price: 40, hook: 'onLaunch', tags: ['gate'],
    n: { every: 10 },
    bound: 'One in ten is the base gate rate, so this removes drought rather than raising the average.',
    apply: (ctx) => { if ((ctx.launchIndex + 1) % 10 === 0) ctx.ball.forceGate = true; }
  }),

  fit({
    id: 'wear_plate', name: 'Wear Plate',
    text: 'A wear plate under the tray. +{add#} launches added to every round budget.',
    rarity: 'common', price: 30, hook: 'onRoundStart', tags: ['economy'],
    n: { add: 6 },
    bound: 'Extra launches at RTP under 1 are extra losses. It only helps a machine already over 1.',
    apply: (ctx) => { ctx.round.budget += 6; }
  }),

  fit({
    id: 'till_rail', name: 'Till Rail',
    text: 'An extra window on the till rail. Clear bonus x{mul~}.',
    rarity: 'common', price: 35, hook: 'onRoundEnd', tags: ['economy'],
    n: { mul: 1.12 },
    bound: 'Pays nothing on a failed round, and the clear bonus is the one number the quota does not count.',
    apply: (ctx) => (ctx.cleared ? ctx.bonus * 1.12 : ctx.bonus)
  }),

  fit({
    id: 'oiled_cloth', name: 'Oiled Cloth',
    text: 'The face is oiled. Flight time -20%, but the ball touches 4 fewer nails.',
    rarity: 'common', price: 25, hook: 'static', tags: ['cadence', 'cost'],
    mods: { flightTime: ['*', 0.80], pinHits: ['+', -4] },
    bound: 'Cheap because it is a straight trade: it guts every nail fitting you own.'
  }),

  fit({
    id: 'bent_nail', name: 'Bent Nail',
    text: 'One nail bent toward the jade pocket. Jade chance +1 point, now {jadeProb%}.',
    rarity: 'common', price: 35, hook: 'static', tags: ['board', 'pocket'],
    mods: { jadeProb: ['+', 0.01] }, board: { addPins: 'jade-lead' },
    bound: 'Jade probability is clamped at 0.12.'
  }),

  fit({
    id: 'copper_wire', name: 'Copper Wire',
    text: 'Copper wire across the gate throat. The gate pays +{add#} more while a fever is running.',
    rarity: 'common', price: 30, hook: 'onGate', tags: ['gate', 'fever'],
    n: { add: 2 },
    bound: 'Only during fever, where the gate is a 10 percent event on a short window.',
    apply: (ctx) => (ctx.fever ? ctx.payout + 2 : ctx.payout)
  }),

  fit({
    id: 'ball_bearing', name: 'Ball Bearing',
    text: 'Truer bearings in the tray. Every ball carries x{mul~}.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball'],
    n: { mul: 1.08 },
    maxStack: 3,
    bound: 'Three copies is x1.26, which is under one uncommon pocket fitting for the same three slots.',
    apply: (ctx) => { ctx.ball.mul *= 1.08; }
  }),

  fit({
    id: 'return_chute', name: 'Return Chute',
    text: 'A chute off the budget counter. Every {per#} launches you did not spend returns 1 ball.',
    rarity: 'common', price: 30, hook: 'onRoundEnd', tags: ['economy'],
    n: { per: 4 },
    bound: 'Rewards finishing early, so it pays least exactly when the round was hard.',
    apply: (ctx) => (ctx.cleared
      ? ctx.bonus + Math.floor(Math.max(0, ctx.round.budget - ctx.round.launches) / 4)
      : ctx.bonus)
  }),

  fit({
    id: 'wiping_cloth', name: 'Wiping Cloth',
    text: 'A cloth kept by the counter. Reroll cost rises by {step#} instead of 8.',
    rarity: 'common', price: 25, hook: 'onShopOpen', tags: ['shop'],
    n: { step: 4 },
    bound: 'Touches the shop only. It never puts a ball on the board.',
    apply: (ctx) => { ctx.shop.rerollStep = 4; }
  }),

  // ---- uncommon -------------------------------------------------------- //

  fit({
    id: 'nail_comb', name: 'Nail Comb',
    text: 'A comb of nails funnelling into the cream pockets. Cream chance +4 points, now {creamProb%}.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['board', 'pocket'],
    mods: { creamProb: ['+', 0.04] }, board: { addPins: 'comb' },
    bound: 'Cream probability is clamped at 0.28 and the pocket total at 0.62.'
  }),

  fit({
    id: 'slope_plate', name: 'Slope Plate',
    text: 'The lower field is shimmed to lean left. Side chance +5 points, jade chance -0.5 points.',
    rarity: 'uncommon', price: 60, hook: 'static', tags: ['board', 'pocket', 'cost'],
    mods: { sideProb: ['+', 0.05], jadeProb: ['+', -0.005] }, board: { slope: -0.06 },
    bound: 'Trades the 5 ball pocket for the 1 ball pocket, so it is a downgrade once jade fittings are on.'
  }),

  fit({
    id: 'rubber_bumper', name: 'Rubber Bumper',
    text: 'A rubber bumper set above the gate. Hitting it adds x{mul~} to the ball, once per ball, and widens the run into the gate by 2 points.',
    rarity: 'uncommon', price: 70, hook: 'onPinHit', tags: ['board', 'gate', 'ball'],
    mods: { gateProb: ['+', 0.02] }, board: { bumpers: 1 },
    n: { mul: 0.35 },
    bound: 'Once per ball, and only balls whose path crosses the bumper touch it.',
    apply: (ctx) => {
      if (ctx.pin.kind !== 'bumper' || ctx.ball.s.rubber_bumper) return;
      ctx.ball.s.rubber_bumper = 1;
      ctx.ball.mul += 0.35;
    }
  }),

  fit({
    id: 'shutter_plate', name: 'Shutter Plate',
    text: 'A shutter closes the outer side pockets. Side -6 points, cream +4, jade +2, and the balls funnel inward.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['board', 'pocket'],
    mods: { sideProb: ['+', -0.06], creamProb: ['+', 0.04], jadeProb: ['+', 0.02] },
    board: { shutter: 'outer-side' },
    bound: 'Net +0.16 RTP, and it destroys any side pocket build you already bought.'
  }),

  fit({
    id: 'horseshoe_magnet', name: 'Horseshoe Magnet',
    text: 'A horseshoe magnet behind the gate. Gate chance +4 points, now {gateProb%}.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['gate', 'fever'],
    mods: { gateProb: ['+', 0.04] },
    bound: 'Gate probability is clamped at 0.30, which is the hard ceiling on fever frequency.'
  }),

  fit({
    id: 'reel_brake', name: 'Reel Brake',
    text: 'A brake shoe on the middle reel. It settles on the reached face {middleWeight%} of the time.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['reel', 'fever'],
    mods: { middleWeight: ['+', 0.10] },
    bound: 'Clamped at 0.75. Reaches still have to happen first.'
  }),

  fit({
    id: 'held_reel', name: 'Held Reel',
    text: 'The first reach of every round is held until it matches. Once per round.',
    rarity: 'uncommon', price: 65, hook: 'onReelSpin', tags: ['reel', 'fever'],
    scope: 'round',
    bound: 'Exactly one guaranteed fever per round. It cannot fire twice however long the round runs.',
    apply: (ctx) => {
      if (ctx.state.held_reel || !ctx.spin.reach) return;
      ctx.state.held_reel = 1;
      ctx.spin.matched = true;
      ctx.spin.symbol = ctx.spin.reachSymbol;
    }
  }),

  fit({
    id: 'long_fever', name: 'Long Fever',
    text: 'A longer cam on the fever timer. Fever runs {feverLen} balls.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['fever'],
    mods: { feverLen: ['+', 4] },
    bound: 'Length only. A round with no gate luck sees none of it.'
  }),

  fit({
    id: 'kicker_plate', name: 'Kicker Plate',
    text: 'A kicker plate in the attacker pocket. It pays {attackerPay} instead of 8.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['fever', 'pocket'],
    mods: { attackerPay: ['+', 3] },
    bound: 'Fever balls are about 10 percent of a base run, so this is +0.15 overall RTP alone.'
  }),

  fit({
    id: 'gate_widener', name: 'Gate Widener',
    text: 'The gate mouth widens while the lamp is warm. Gate chance during fever {feverGateProb%}, so fevers extend more often.',
    rarity: 'uncommon', price: 60, hook: 'static', tags: ['fever', 'gate'],
    mods: { feverGateProb: ['+', 0.08] },
    bound: 'Fever gate chance is clamped at 0.45, which holds expected fever length finite.'
  }),

  fit({
    id: 'third_rail', name: 'Third Rail',
    text: 'Two more launch rails. {inFlight} balls on the glass at once.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 2] },
    bound: 'In flight is clamped at 8, so the board never becomes a spray.'
  }),

  fit({
    id: 'spring_latch', name: 'Spring Latch',
    text: 'A latch that holds the launch arm. Strength locks to the last value that paid, and every locked ball carries x{mul~}.',
    rarity: 'uncommon', price: 60, hook: 'onLaunch', tags: ['ball', 'aim', 'cost'],
    mods: { lockStrength: ['=', 1] },
    n: { mul: 1.20 },
    bound: 'You lose the strength dial, which is worth about 30 percent of overall RTP when the board is re-nailed each round.',
    apply: (ctx) => { ctx.ball.mul *= 1.20; }
  }),

  fit({
    id: 'trip_wire', name: 'Trip Wire',
    text: 'A trip wire deep in the lattice. The 12th nail a ball touches adds x{mul~}.',
    rarity: 'uncommon', price: 60, hook: 'onPinHit', tags: ['ball'],
    n: { at: 12, mul: 1.0 },
    bound: 'Only balls that reach 12 nails fire it, which is about 60 percent of them and none at all under Thin Glass.',
    apply: (ctx) => { if (ctx.hitIndex === 12) ctx.ball.mul += 1.0; }
  }),

  fit({
    id: 'bar_magnet', name: 'Bar Magnet',
    text: 'A bar magnet under the jade pockets. 1 launch in 20 is dragged into a jade pocket.',
    rarity: 'uncommon', price: 70, hook: 'onLaunch', tags: ['pocket'],
    n: { p: 0.05 },
    bound: 'Fixed at 1 in 20 and it overrides the gate, so it trades fever chances for guaranteed small pays.',
    apply: (ctx) => { if (ctx.rand() < 0.05) ctx.ball.forcePocket = 'jade'; }
  }),

  fit({
    id: 'escapement', name: 'Escapement',
    text: 'An escapement on the fever counter. Each fever ball adds +{step~} to the fever multiplier, resetting when the lamp cools.',
    rarity: 'uncommon', price: 65, hook: 'onFeverBall', tags: ['fever'],
    n: { step: 0.03 },
    bound: 'Resets at every fever end, so it rewards long chains and nothing else.',
    apply: (ctx) => { ctx.fever.mult += 0.03; }
  }),

  fit({
    id: 'counter_wheel', name: 'Counter Wheel',
    text: 'A counting wheel on the till. Every {every#}th pocket paid in a round pays double.',
    rarity: 'uncommon', price: 60, hook: 'onPocket', tags: ['pocket', 'economy'],
    scope: 'round',
    n: { every: 8 },
    bound: 'One pocket in eight, counted per round, so a short round sees it twice.',
    apply: (ctx) => {
      const c = (ctx.state.counter_wheel || 0) + 1;
      ctx.state.counter_wheel = c;
      return c % 8 === 0 ? ctx.payout * 2 : ctx.payout;
    }
  }),

  fit({
    id: 'thin_glass', name: 'Thin Glass',
    text: 'Thinner glass, less drag. Flight time -30%, but the ball touches 5 fewer nails.',
    rarity: 'uncommon', price: 55, hook: 'static', tags: ['cadence', 'cost'],
    mods: { flightTime: ['*', 0.70], pinHits: ['+', -5] },
    bound: 'Takes the ball below 12 nails, which switches off Trip Wire entirely.'
  }),

  fit({
    id: 'hopper', name: 'Hopper',
    text: 'A hopper of borrowed balls. +{balls#} balls at the start of every round, and that round quota is 8% higher.',
    rarity: 'uncommon', price: 60, hook: 'onRoundStart', tags: ['economy', 'cost'],
    n: { balls: 25, quota: 1.08 },
    bound: 'The quota rise compounds with the round curve, so it is a loan that gets worse every round.',
    apply: (ctx) => {
      ctx.tray.balls += 25;
      ctx.round.quota = Math.ceil(ctx.round.quota * 1.08);
    }
  }),

  fit({
    id: 'diverter', name: 'Diverter',
    text: 'A diverter plate moves the gate mouth off centre. Gate chance +3 points, but the strength window that finds it is 30% narrower.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['board', 'gate', 'cost'],
    mods: { gateProb: ['+', 0.03], aimWindow: ['*', 0.7] },
    board: { diverter: true },
    bound: 'The narrower window costs more gate frequency than the 3 points give back unless you actually re-aim each round.'
  }),

  fit({
    id: 'sticky_detent', name: 'Sticky Detent',
    text: 'A sticky detent on the outer reels. Reach chance {reachProb%}, but the middle reel settles on it only {middleWeight%} of the time.',
    rarity: 'uncommon', price: 55, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['+', 0.064], middleWeight: ['+', -0.06] },
    bound: 'Match rate moves from 0.099 to 0.108. It buys tension, not much fever.'
  }),

  fit({
    id: 'solenoid', name: 'Solenoid',
    text: 'A solenoid on the attacker shutter. The first 4 balls of every fever run at 62% attacker chance instead of 50%.',
    rarity: 'uncommon', price: 70, hook: 'onFeverStart', tags: ['fever'],
    n: { balls: 4, attackerProb: 0.62 },
    bound: 'Four balls only, and the attacker clamp at 0.85 caps what stacking windows can reach.',
    apply: (ctx) => { ctx.fever.openings.push({ balls: 4, attackerProb: 0.62 }); }
  }),

  fit({
    id: 'warm_lamp', name: 'Warm Lamp',
    text: 'The lamp holds its heat. For {balls#} balls after a fever ends, the attacker pocket is still open at {attackerProb%}.',
    rarity: 'uncommon', price: 60, hook: 'onFeverEnd', tags: ['fever'],
    n: { balls: 6, attackerProb: 0.20 },
    bound: 'Six balls at a fifth of the fever rate, and it does not extend the fever counter.',
    apply: (ctx) => { ctx.after.push({ balls: 6, attackerProb: 0.20 }); }
  }),

  fit({
    id: 'anchor_plate', name: 'Anchor Plate',
    text: 'An anchor plate on the budget counter. Clear with {spare#} or more launches unspent and the till pays {balls#} balls.',
    rarity: 'uncommon', price: 60, hook: 'onRoundEnd', tags: ['economy'],
    n: { spare: 20, balls: 40 },
    bound: 'Flat 40 balls. Against a round 12 quota of 389 it is rounding error.',
    apply: (ctx) => (ctx.cleared && (ctx.round.budget - ctx.round.launches) >= 20
      ? ctx.bonus + 40
      : ctx.bonus)
  }),

  fit({
    id: 'relay', name: 'Relay',
    text: 'A relay across the reel contacts. A missed spin has a {p%} chance to spin once more.',
    rarity: 'uncommon', price: 65, hook: 'onReelSpin', tags: ['reel', 'fever'],
    n: { p: 0.12 },
    bound: 'One respin per gate entry, never a chain of them.',
    apply: (ctx) => {
      if (!ctx.spin.matched && ctx.spin.respins < 1 && ctx.rand() < 0.12) ctx.spin.respin = true;
    }
  }),

  // ---- rare ------------------------------------------------------------ //

  fit({
    id: 'twin_gate', name: 'Twin Gate',
    text: 'A second gate mouth cut into the left of the face. Gate chance +7 points, now {gateProb%}.',
    rarity: 'rare', price: 120, hook: 'static', tags: ['board', 'gate', 'fever'],
    mods: { gateProb: ['+', 0.07] }, board: { gates: 2 },
    bound: 'Gate probability clamps at 0.30, so this plus a magnet plus three pulled nails is already the ceiling.'
  }),

  fit({
    id: 'magnet_coil', name: 'Magnet Coil',
    text: 'A coil that energises while the lamp is warm. Every pocket pays x{mul~} during a fever.',
    rarity: 'rare', price: 110, hook: 'onPocket', tags: ['fever', 'pocket'],
    n: { mul: 1.5 },
    bound: 'Fever balls only, which is 10 percent of a base run and never more than about half of a chained one.',
    apply: (ctx) => (ctx.fever ? ctx.payout * 1.5 : ctx.payout)
  }),

  fit({
    id: 'nail_gauge', name: 'Nail Gauge',
    text: 'The technician gauge, left in the cabinet. Every pocket chance x1.25; the out lanes take the loss.',
    rarity: 'rare', price: 125, hook: 'static', tags: ['board', 'pocket'],
    mods: {
      gateProb: ['*', 1.25], jadeProb: ['*', 1.25],
      creamProb: ['*', 1.25], sideProb: ['*', 1.25]
    },
    bound: 'Multiplies into the 0.62 pocket total clamp, so it is worth less the more board fittings you already own.'
  }),

  fit({
    id: 'short_strip', name: 'Short Reel Strip',
    text: 'A shorter reel strip, 8 stops instead of 12. Reach chance {reachProb%}.',
    rarity: 'rare', price: 110, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['=', 0.34], stripStops: ['=', 8] },
    bound: 'Sets reach rather than adding to it, so it overwrites Slack Reel and Sticky Detent instead of stacking.'
  }),

  fit({
    id: 'continuation_lock', name: 'Continuation Lock',
    text: 'A lock on the fever counter. A match during a fever adds {continuationAdd} balls instead of 10.',
    rarity: 'rare', price: 125, hook: 'static', tags: ['fever'],
    mods: { continuationAdd: ['+', 8] },
    bound: 'Expected fever length is feverLen / (1 - feverGateProb * matchProb * continuationAdd) and both factors are clamped, so the series always converges.'
  }),

  fit({
    id: 'rolling_shutter', name: 'Rolling Shutter',
    text: 'A rolling shutter closes the out lanes as a fever starts. The first {balls#} fever balls run at {attackerProb%} attacker chance.',
    rarity: 'rare', price: 120, hook: 'onFeverStart', tags: ['board', 'fever'],
    n: { balls: 6, attackerProb: 0.72 },
    bound: 'Six balls, and the attacker clamp at 0.85 is the ceiling however many windows overlap.',
    apply: (ctx) => { ctx.fever.openings.push({ balls: 6, attackerProb: 0.72 }); }
  }),

  fit({
    id: 'pocket_magnet', name: 'Pocket Magnet',
    text: 'Magnets behind the side pockets. {p%} of lost balls are dragged into the nearest side pocket.',
    rarity: 'rare', price: 110, hook: 'onBallLost', tags: ['pocket', 'economy'],
    n: { p: 0.30 },
    bound: 'Pays the side pocket value, the smallest on the board, so it scales with the weakest thing you own.',
    apply: (ctx) => (ctx.rand() < 0.30 ? ctx.refund + ctx.model.sidePay : ctx.refund)
  }),

  fit({
    id: 'ratchet', name: 'Ratchet',
    text: 'A ratchet on the quota counter. Every round quota is {cut#}% lower.',
    rarity: 'rare', price: 115, hook: 'onRoundStart', tags: ['economy'],
    n: { mul: 0.88, cut: 12 },
    bound: 'A flat 12 percent against a quota that grows 17 percent a round: it buys about two thirds of one round.',
    apply: (ctx) => { ctx.round.quota = Math.ceil(ctx.round.quota * 0.88); }
  }),

  fit({
    id: 'pawl', name: 'Pawl',
    text: 'A pawl that holds the budget counter. On a clear, up to {cap#} unspent launches carry into the next round.',
    rarity: 'rare', price: 110, hook: 'onRoundEnd', tags: ['economy'],
    n: { cap: 30 },
    bound: 'Capped at 30 and it never carries twice: the carry is consumed by the next round budget.',
    apply: (ctx) => {
      if (ctx.cleared) {
        ctx.carry.launches = Math.min(30, Math.max(0, ctx.round.budget - ctx.round.launches));
      }
      return ctx.bonus;
    }
  }),

  fit({
    id: 'score_plate', name: 'Score Plate',
    text: 'Raised numerals pressed into every pocket. Every pocket pays +2.',
    rarity: 'rare', price: 130, hook: 'static', tags: ['pocket'],
    mods: {
      gatePay: ['+', 2], jadePay: ['+', 2], creamPay: ['+', 2],
      sidePay: ['+', 2], attackerPay: ['+', 2]
    },
    bound: 'Additive, so its share of the payout shrinks every time a multiplier fitting is bought after it.'
  }),

  fit({
    id: 'cam', name: 'Cam',
    text: 'A cam that winds as the round runs. Each launch adds +0.4% to the ball multiplier, up to x{cap~}, reset each round.',
    rarity: 'rare', price: 110, hook: 'onLaunch', tags: ['ball'],
    n: { per: 0.004, cap: 2.0 },
    bound: 'Capped at x2.00 and reset every round, so it pays most in the long rounds you were already winning.',
    apply: (ctx) => { ctx.ball.mul *= Math.min(2.0, 1 + 0.004 * ctx.launchIndex); }
  }),

  fit({
    id: 'hopper_wheel', name: 'Hopper Wheel',
    text: 'A wheel that feeds the rail off the fever payout. The first {free#} balls of every fever cost nothing from the tray.',
    rarity: 'rare', price: 120, hook: 'onFeverBall', tags: ['fever', 'economy'],
    n: { free: 8 },
    bound: 'Saves 8 balls, never adds a payout, and cannot save more balls than a fever is long.',
    apply: (ctx) => { if (ctx.fever.ballsUsed < 8) ctx.ball.free = true; }
  }),

  fit({
    id: 'copper_bus', name: 'Copper Bus',
    text: 'A copper bus down the left of the lattice. Every nail touched on the left half adds x{per~}, with no cap.',
    rarity: 'rare', price: 105, hook: 'onPinHit', tags: ['ball'],
    n: { per: 0.05 },
    bound: 'Uncapped but geometry bounded: about half of the ball nail contacts are on the left, so pinHits sets the ceiling and Thin Glass or Oiled Cloth cuts it.',
    apply: (ctx) => { if (ctx.pin.side === 'left') ctx.ball.mul += 0.05; }
  }),

  fit({
    id: 'bevel_glass', name: 'Bevel Glass',
    text: 'Heavier bevelled glass over the fever counter. Fever starts at x{feverMult~} instead of x1.00.',
    rarity: 'rare', price: 115, hook: 'static', tags: ['fever'],
    mods: { feverMult: ['+', 0.5] },
    bound: 'Multiplies fever payouts only, so a fever free round gets nothing from a 115 ball purchase.'
  }),

  fit({
    id: 'sprocket', name: 'Sprocket',
    text: 'A sprocket drive on the rail set. {inFlight} balls on the glass, and the rail can fire every 0.18s.',
    rarity: 'rare', price: 115, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 3], launchFloor: ['=', 0.18] },
    bound: 'In flight is clamped at 8. Cadence is a magnifier in both directions and does nothing to RTP.'
  }),

  fit({
    id: 'wire_guard', name: 'Wire Guard',
    text: 'Wire guards close the outer columns. Nothing reaches the far out lanes: cream +6 points, side +4.',
    rarity: 'rare', price: 120, hook: 'static', tags: ['board', 'pocket'],
    mods: { creamProb: ['+', 0.06], sideProb: ['+', 0.04] },
    board: { removePins: 'outer-columns' },
    bound: 'Runs into the 0.62 pocket total clamp faster than anything else in the catalogue.'
  }),

  fit({
    id: 'tilt_weight', name: 'Tilt Weight',
    text: 'A tilt weight that remembers the last paying strength. Launch within 5 of it and the ball carries x{mul~}.',
    rarity: 'rare', price: 105, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { tol: 0.05, mul: 1.4 },
    bound: 'Needs a paying pocket to set the mark, so it is dead for the first ball of a round and dead through a drought.',
    apply: (ctx) => {
      const last = ctx.stats.lastPayingStrength;
      if (last != null && Math.abs(ctx.strength - last) <= 0.05) ctx.ball.mul *= 1.4;
    }
  }),

  fit({
    id: 'fuse_wire', name: 'Fuse Wire',
    text: 'Fuse wire across the till. Every payout x{mul~} until one ball pays more than {blow#}, which blows the fuse for the rest of the run.',
    rarity: 'rare', price: 100, hook: 'onPocket', tags: ['risk', 'pocket'],
    n: { mul: 1.8, blow: 60 },
    bound: 'Self limiting. On any machine strong enough to matter, the first fever blows it inside two balls.',
    apply: (ctx) => {
      if (ctx.state.fuse_wire === 'blown') return ctx.payout;
      const out = ctx.payout * 1.8;
      if (out > 60) {
        ctx.state.fuse_wire = 'blown';
        ctx.disable = true;
      }
      return out;
    }
  }),

  // ---- brass ----------------------------------------------------------- //

  fit({
    id: 'brass_seven', name: 'The Brass Seven',
    text: 'The seven face is cut from solid brass. A seven match starts a {balls#} ball fever at x{mult~}. There is one seven in twelve stops.',
    rarity: 'brass', price: 220, hook: 'onReelSpin', tags: ['reel', 'fever'],
    n: { balls: 40, mult: 2.0 },
    bound: 'A seven reach is 1 in 144 spins before the middle reel, so this fires about once in 3,400 launched balls unaided.',
    apply: (ctx) => {
      if (ctx.spin.matched && ctx.spin.symbol === 'seven') {
        ctx.spin.feverLen = 40;
        ctx.spin.feverMult = 2.0;
      }
    }
  }),

  fit({
    id: 'holding_plate', name: 'Holding Plate',
    text: 'A plate that holds the gate open after a fever. For {balls#} balls the gate runs at {gateProb%}, so fevers chain.',
    rarity: 'brass', price: 210, hook: 'onFeverEnd', tags: ['gate', 'fever'],
    n: { balls: 25, gateProb: 0.35 },
    bound: 'The hold does not raise payouts, only gate frequency, and it expires after 25 balls whether or not it chained.',
    apply: (ctx) => { ctx.after.push({ balls: 25, gateProb: 0.35 }); }
  }),

  fit({
    id: 'second_face', name: 'Second Face',
    text: 'The lower third of the face is doubled: every pocket exists twice. Every pocket chance x1.6.',
    rarity: 'brass', price: 240, hook: 'static', tags: ['board', 'pocket'],
    mods: {
      gateProb: ['*', 1.6], jadeProb: ['*', 1.6],
      creamProb: ['*', 1.6], sideProb: ['*', 1.6]
    },
    board: { duplicateLower: true },
    bound: 'The 0.62 pocket total clamp bites immediately, so on a stacked board it delivers well under 1.6.'
  }),

  fit({
    id: 'attacker_mouth', name: 'Attacker Mouth',
    text: 'The attacker pocket is cut wide open. {attackerProb%} attacker chance during a fever, paying {attackerPay}.',
    rarity: 'brass', price: 230, hook: 'static', tags: ['fever', 'pocket'],
    mods: { attackerProb: ['=', 0.68], attackerPay: ['+', 6] },
    bound: 'Fever only. It cannot start a fever, and the attacker clamp at 0.85 caps what shutters can add on top.'
  }),

  fit({
    id: 'counter_till', name: 'Counter Till',
    text: 'A second till behind the counter. Clear bonus x{mul~}.',
    rarity: 'brass', price: 200, hook: 'onRoundEnd', tags: ['economy'],
    n: { mul: 2.0 },
    bound: 'Pays nothing on the round that ends the run, which is the round it would have mattered on.',
    apply: (ctx) => (ctx.cleared ? ctx.bonus * 2.0 : ctx.bonus)
  }),

  fit({
    id: 'overflow_rail', name: 'Overflow Rail',
    text: 'The full rail set, eight abreast, firing every 0.15s. Past the {after#}th launch of a round every ball adds +1.',
    rarity: 'brass', price: 200, hook: 'onLaunch', tags: ['cadence', 'economy'],
    mods: { inFlight: ['=', 8], launchFloor: ['=', 0.15] },
    n: { after: 100, add: 1 },
    bound: 'The +1 is flat and only past launch 100, so it is a wide board rescue, not a scaling multiplier.',
    apply: (ctx) => { if (ctx.launchIndex >= 100) ctx.ball.add += 1; }
  }),

  fit({
    id: 'ground_glass', name: 'Ground Glass',
    text: 'The glass is ground opaque. Every payout x{mul~}, but you cannot watch the ball fall and the strength window that finds the gate is half as wide.',
    rarity: 'brass', price: 190, hook: 'static', tags: ['risk', 'cost'],
    mods: { payMul: ['*', 2.4], aimWindow: ['*', 0.5] },
    board: { frosted: true },
    n: { mul: 2.4 },
    bound: 'Halving the aim window costs about 30 percent of overall RTP on a re-nailed board, and it hides the feedback you would use to find the spot again.'
  }),

  fit({
    id: 'technicians_plan', name: "Technician's Plan",
    text: 'The technician own plan, pinned inside the cabinet. One extra bolt point, and every shop offers at least one rare fitting.',
    rarity: 'brass', price: 230, hook: 'onShopOpen', tags: ['shop', 'economy'],
    mods: { slots: ['+', 1] },
    bound: 'One slot and better offers. It puts no ball on the board and pays nothing by itself.',
    apply: (ctx) => { ctx.shop.guarantee = 'rare'; }
  })

];

const BY_ID = new Map(FITTINGS.map((f) => [f.id, f]));

export function byId(id) { return BY_ID.get(id) || null; }

// ---- synergies -------------------------------------------------------------
//
// A synergy is inert data. The host checks which ones are satisfied by the
// owned set and applies `mult` to the quantity named in `on`. `mult` under 1
// is a real penalty and those entries are marked trap, because a combination
// that quietly makes the machine worse is worth as much to learn as one that
// makes it better.
//
//   ids   every fitting that must be owned
//   on    what the multiplier lands on:
//         'creamPay' | 'ballMul' | 'gateProb' | 'feverEv' | 'feverLen'
//         'pocketPay' | 'afterglow' | 'sevenProb' | 'recovery'
//         'cadence' | 'budget' | 'bonus' | 'payout'
//   mult  the multiplier applied to that quantity while all ids are owned

export const SYNERGIES = [
  {
    ids: ['nail_comb', 'shutter_plate'], name: 'The Funnel', on: 'creamPay', mult: 1.35,
    text: 'The comb feeds what the shutter turns inward. Cream pockets pay x1.35.'
  },
  {
    ids: ['rubber_sleeve', 'felt_strip', 'trip_wire'], name: 'Wet Nails', on: 'ballMul', mult: 1.50,
    text: 'Three surfaces on the same nails. Everything a ball picks up on the way down is worth x1.50.'
  },
  {
    ids: ['oiled_cloth', 'rubber_sleeve'], name: 'Slick Board', on: 'ballMul', mult: 0.70, trap: true,
    text: 'Oil on rubber. The ball skates past the sleeves: what it picks up is worth x0.70.'
  },
  {
    ids: ['warm_lamp', 'holding_plate'], name: 'Second Wind', on: 'afterglow', mult: 1.60,
    text: 'The lamp is still warm when the gate is still open. Everything paid after a fever is worth x1.60.'
  },
  {
    ids: ['holding_plate', 'gate_widener', 'continuation_lock'], name: 'The Chain', on: 'feverLen', mult: 2.20,
    text: 'Held open, widened, and locked. Expected fever length x2.20.'
  },
  {
    ids: ['twin_gate', 'horseshoe_magnet'], name: 'Twin Mouth', on: 'gateProb', mult: 1.25,
    text: 'Two mouths and a magnet behind both. Gate chance x1.25, to the 30% ceiling.'
  },
  {
    ids: ['counterweight_plate', 'spring_latch'], name: 'Hard Rail', on: 'ballMul', mult: 1.45,
    text: 'The arm is latched at the top of its travel. Ball multiplier x1.45.'
  },
  {
    ids: ['tilt_weight', 'spring_latch'], name: 'The Groove', on: 'ballMul', mult: 1.80,
    text: 'Latched onto the last paying strength and weighted to hold it. Ball multiplier x1.80.'
  },
  {
    ids: ['second_face', 'score_plate'], name: 'Full Face', on: 'pocketPay', mult: 1.30,
    text: 'Twice the pockets, all of them re-numbered. Pocket pay x1.30.'
  },
  {
    ids: ['held_reel', 'brass_seven'], name: 'Held Seven', on: 'sevenProb', mult: 3.00,
    text: 'The held reach can be held on the seven. Seven chance x3.00 on the first reach of a round.'
  },
  {
    ids: ['attacker_mouth', 'rolling_shutter'], name: 'Open Mouth', on: 'feverEv', mult: 1.35,
    text: 'The shutter drops across a mouth already cut wide. Fever value x1.35.'
  },
  {
    ids: ['escapement', 'bevel_glass'], name: 'The Ramp', on: 'feverEv', mult: 1.50,
    text: 'A fever that starts high and climbs. Fever value x1.50.'
  },
  {
    ids: ['hopper_wheel', 'long_fever'], name: 'Free Fever', on: 'feverEv', mult: 1.40,
    text: 'Eight free balls out of fourteen. Fever value x1.40.'
  },
  {
    ids: ['counter_wheel', 'score_plate'], name: 'Bank Shot', on: 'pocketPay', mult: 1.22,
    text: 'The wheel doubles a pocket that was already raised. Pocket pay x1.22.'
  },
  {
    ids: ['return_rail', 'pocket_magnet'], name: 'Recovery', on: 'recovery', mult: 1.50,
    text: 'The rail catches what the magnets miss. Balls recovered from the out lanes x1.50.'
  },
  {
    ids: ['second_rail', 'third_rail', 'sprocket'], name: 'Wide Load', on: 'cadence', mult: 1.15,
    text: 'Every rail the cabinet will take. Launches per minute x1.15 on top of the count.'
  },
  {
    ids: ['ground_glass', 'sorting_gate'], name: 'Blind Run', on: 'payout', mult: 1.30,
    text: 'You cannot see, but every tenth ball finds the gate anyway. Payout x1.30.'
  },
  {
    ids: ['fuse_wire', 'attacker_mouth'], name: 'Blown Fuse', on: 'payout', mult: 0.50, trap: true,
    text: 'The first attacker ball is over sixty. The fuse goes in the first fever: payout x0.50.'
  },
  {
    ids: ['nail_gauge', 'second_face'], name: 'The Tide', on: 'pocketPay', mult: 1.20,
    text: 'Both multiply into the same ceiling, so the pockets pay instead. Pocket pay x1.20.'
  },
  {
    ids: ['pawl', 'wear_plate', 'anchor_plate'], name: 'Long Night', on: 'budget', mult: 1.30,
    text: 'Budget added, carried and rewarded. Effective budget x1.30.'
  }
];

// Which synergies a set of owned ids satisfies. Pure, order independent.
export function activeSynergies(owned = []) {
  const have = new Set(normaliseOwned(owned).map((f) => f.id));
  return SYNERGIES.filter((s) => s.ids.every((id) => have.has(id)));
}

// ---- the shop --------------------------------------------------------------

export const DEFAULT_RARITY_WEIGHTS = Object.freeze({
  common: 60, uncommon: 27, rare: 11, brass: 2
});

export const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'brass']);

function ownedCounts(owned) {
  const counts = new Map();
  for (const o of owned || []) {
    const id = typeof o === 'string' ? o : (o && o.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

// Roll one shop offer set. `rng` is a function returning [0, 1) and is the
// only source of randomness. Two draws are taken per offer, always in the same
// order, so the same rng gives the same shop every time.
//
// A fitting is a candidate when the owned count is below its maxStack, which
// is what stops a unique being offered twice or a stackable being offered past
// its cap. Nothing else is filtered.
export function rollOffer(rng, owned = [], rarityWeights = DEFAULT_RARITY_WEIGHTS, count = 3) {
  const counts = ownedCounts(owned);
  const taken = new Set();
  const offers = [];

  const available = (rarity) => FITTINGS.filter((f) =>
    f.rarity === rarity &&
    !taken.has(f.id) &&
    (counts.get(f.id) || 0) < (f.maxStack || 1));

  for (let i = 0; i < count; i++) {
    const buckets = [];
    let total = 0;
    for (const rarity of RARITY_ORDER) {
      const pool = available(rarity);
      if (!pool.length) continue;
      const w = Math.max(0, rarityWeights[rarity] || 0);
      if (w <= 0) continue;
      buckets.push({ rarity, pool, w });
      total += w;
    }
    if (!total) break;

    let roll = rng() * total;
    let chosen = buckets[buckets.length - 1];
    for (const b of buckets) {
      roll -= b.w;
      if (roll < 0) { chosen = b; break; }
    }

    const idx = Math.min(chosen.pool.length - 1, Math.floor(rng() * chosen.pool.length));
    const pick = chosen.pool[idx];
    taken.add(pick.id);
    offers.push(pick);
  }

  return offers;
}

// Cost of the r-th reroll in one shop, r counted from 0.
export function rerollCost(model, r) {
  const base = (model && model.rerollBase) || BASE_MODEL.rerollBase;
  const step = (model && model.rerollStep) || BASE_MODEL.rerollStep;
  return base + step * Math.max(0, r);
}

// ---- player facing text ----------------------------------------------------

function formatValue(v, fmt) {
  if (typeof v !== 'number' || !isFinite(v)) return String(v);
  if (fmt === '%') return (v * 100).toFixed(1) + '%';
  if (fmt === '#') return String(Math.round(v));
  if (fmt === '~') return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// Substitute live numbers into a fitting sentence. Tokens resolve against the
// fitting's own numbers first, then the live model, then ctx itself. An
// unresolved token is left exactly as written so a missing key is visible in
// the plaque instead of silently reading as a finished sentence.
export function describe(fitting, ctx) {
  if (!fitting || typeof fitting.text !== 'string') return '';
  const model = (ctx && ctx.model) || BASE_MODEL;
  const n = fitting.n || {};
  return fitting.text.replace(/\{([A-Za-z0-9_]+)([%#~])?\}/g, (whole, key, fmt) => {
    let v;
    if (Object.prototype.hasOwnProperty.call(n, key)) v = n[key];
    else if (Object.prototype.hasOwnProperty.call(model, key)) v = model[key];
    else if (ctx && Object.prototype.hasOwnProperty.call(ctx, key)) v = ctx[key];
    if (v === undefined) return whole;
    return formatValue(v, fmt);
  });
}

// ---- bulk buying -----------------------------------------------------------
//
// Everything bought repeatedly is priced as a geometric series: the m-th unit
// of a thing costs base * ratio^m. These two functions are the whole of the
// x1 / x10 / x100 / x1000 / max buttons.
//
// Computed through logarithms so a ratio raised to a four figure exponent does
// not lose the answer to floating point before it is compared with funds.

// Cost of buying k units when m are already owned.
export function costOfUnits(base, ratio, owned, k) {
  if (k <= 0) return 0;
  if (ratio === 1) return base * k;
  return base * Math.pow(ratio, owned) * (Math.pow(ratio, k) - 1) / (ratio - 1);
}

// The largest k with costOfUnits(base, ratio, owned, k) <= funds.
export function maxUnits(base, ratio, owned, funds) {
  if (funds < 0) return 0;
  if (ratio === 1) return Math.floor(funds / base);
  const first = base * Math.pow(ratio, owned);
  const inner = 1 + (funds * (ratio - 1)) / first;
  if (!(inner > 0)) return 0;
  const k = Math.floor(Math.log(inner) / Math.log(ratio));
  return Math.max(0, k);
}

// The same for an additively priced series, base + step * m, used by rerolls.
export function costOfUnitsLinear(base, step, owned, k) {
  if (k <= 0) return 0;
  return k * (base + step * owned) + (step * k * (k - 1)) / 2;
}

export function maxUnitsLinear(base, step, owned, funds) {
  if (funds < 0) return 0;
  if (step === 0) return Math.floor(funds / base);
  const a = base + step * owned;
  const b = a - step / 2;
  const k = (Math.sqrt(b * b + 2 * step * funds) - b) / step;
  return Math.max(0, Math.floor(k + 1e-9));
}
