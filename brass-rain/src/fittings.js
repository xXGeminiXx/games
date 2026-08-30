// ---------------------------------------------------------------------------
// Fittings: the parts that get bolted into the machine, as pure data.
//
// This file is the catalog and the contract. It has no imports, no DOM, no
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
//          in catalog order: all '=' first, then all '*', then all '+'.
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
//   gateProb       chance a launched ball enters the center gate
//   gatePay        balls paid by the gate
//   jadeProb       chance of the big pocket, the single high value mouth
//   jadePay        balls paid by the big pocket
//   creamProb      chance of a mid pocket, the pair of middling mouths
//   creamPay       balls paid by a mid pocket
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
//   feverCreamProb mid pocket chance during fever
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
//   diverter       true to move the gate mouth off center
//   duplicateLower true to mirror the lower third so every pocket exists twice
//   frosted        true to render the glass opaque
//
// The board builder resolves these into geometry. Two fittings adding the same
// tag add the group twice. Nothing here names a color, a sprite or a node.
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
//                catalog order and each sees the previous one's result.
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

// ---- catalog -------------------------------------------------------------

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
    id: 'extra_nail_row', name: 'Side Shelf Nails',
    text: 'Side pockets catch 2 more balls in every 100, now {sideProb%}. A fresh row of nails feeds the shelves.',
    rarity: 'common', price: 30, hook: 'static', tags: ['board', 'pocket'],
    mods: { sideProb: ['+', 0.02] }, board: { addPins: 'side-shelf' },
    maxStack: 2,
    bound: 'Side pockets pay 1 ball, the least on the board. Two rows still leave most balls falling out the bottom.'
  }),

  fit({
    id: 'pulled_nail', name: 'Pulled Slot Nails',
    text: 'The slot takes 1 more ball in every 100, now {gateProb%}. Two nails are pulled out of its shoulder.',
    rarity: 'common', price: 30, hook: 'static', tags: ['board', 'gate'],
    mods: { gateProb: ['+', 0.01] }, board: { removePins: 'gate-shoulder' },
    maxStack: 3,
    bound: 'The slot never takes more than 30 balls in 100 whatever you bolt on, so copies stop helping near that ceiling.'
  }),

  fit({
    id: 'brass_lip', name: 'Mid Pocket Lip',
    text: 'The mid pockets pay {creamPay} balls instead of 3. A brass lip stops the ball bouncing back out.',
    rarity: 'common', price: 30, hook: 'static', tags: ['pocket'],
    mods: { creamPay: ['+', 1] },
    bound: 'Only the mid pockets, and only about 6 balls in 100 land there. One extra ball every sixteen pulls or so.'
  }),

  fit({
    id: 'rubber_sleeve', name: 'Rubber Sleeves',
    text: 'Every nail the ball touches adds x{per~} to what it pays, up to x1.20 on one ball. Ten nails get rubber.',
    rarity: 'common', price: 35, hook: 'onPinHit', tags: ['ball'],
    n: { per: 0.02, cap: 0.20 },
    bound: 'Stops at x1.20 on a single ball, so a longer fall through the nails is worth nothing extra.',
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
    text: 'Every 4th nail the ball touches adds +{add~} balls to what it pays, up to +3 on one ball.',
    rarity: 'common', price: 30, hook: 'onPinHit', tags: ['ball'],
    n: { every: 4, add: 0.5, cap: 3 },
    bound: 'Stops at +3 balls, and it\'s a flat amount. It fades to nothing once your payouts run into the dozens.',
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
    id: 'counterweight_plate', name: 'Hard Pull Weight',
    text: 'Pull the handle to 80 or higher and the ball pays x{mul~}. A weight is hung on the handle arm.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { min: 0.80, mul: 1.15 },
    bound: 'A hard pull throws the ball past the slot more often, so you trade slot hits for the bonus.',
    apply: (ctx) => { if (ctx.strength >= 0.80) ctx.ball.mul *= 1.15; }
  }),

  fit({
    id: 'soft_spring', name: 'Soft Pull Spring',
    text: 'Pull the handle to 35 or lower and the ball pays +{add#} balls on top. A softer spring is fitted.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { max: 0.35, add: 2 },
    bound: 'A soft pull reaches the slot less often, so it\'s +2 balls on the pulls least likely to pay at all.',
    apply: (ctx) => { if (ctx.strength <= 0.35) ctx.ball.add += 2; }
  }),

  fit({
    id: 'return_rail', name: 'Catch Tray',
    text: '1 lost ball in 5 comes back to you. A tray is fitted under the out lanes.',
    rarity: 'common', price: 35, hook: 'onBallLost', tags: ['economy'],
    n: { p: 0.20 },
    bound: 'It hands back a ball, never a payout, so it never counts toward the goal you have to clear.',
    apply: (ctx) => (ctx.rand() < 0.20 ? ctx.refund + 1 : ctx.refund)
  }),

  fit({
    id: 'wire_basket', name: 'Side Pocket Baskets',
    text: 'Side pockets pay {sidePay} balls instead of 1. Wire baskets catch what used to drop straight through.',
    rarity: 'common', price: 35, hook: 'static', tags: ['pocket'],
    mods: { sidePay: ['+', 1] },
    bound: 'Doubles the cheapest pocket on the board. Two balls is still two balls once the machine pays dozens.'
  }),

  fit({
    id: 'reel_detent', name: 'Middle Reel Catch',
    text: 'When the two outer reels match, the middle reel lands on the same symbol {middleWeight%} of the time. A catch slows it.',
    rarity: 'common', price: 30, hook: 'static', tags: ['reel', 'fever'],
    mods: { middleWeight: ['+', 0.04] },
    bound: 'It does nothing until the outer reels match on their own, and it tops out at 75 percent.'
  }),

  fit({
    id: 'slack_reel', name: 'Loose Reel Belts',
    text: 'The two outer reels match 3 more times in every 100 spins, now {reachProb%}. That\'s the first half of starting a BONUS.',
    rarity: 'common', price: 30, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['+', 0.03] },
    bound: 'The outer reels never match more than 55 percent of the time, and the middle reel still has to agree.'
  }),

  fit({
    id: 'gate_tongue', name: 'Slot Pay Tongue',
    text: 'The slot pays {gatePay} balls instead of 3. A tongue in the pocket holds the ball a moment longer.',
    rarity: 'common', price: 30, hook: 'static', tags: ['gate'],
    mods: { gatePay: ['+', 2] },
    bound: 'Pays balls only. It doesn\'t make the slot easier to hit or the reels spin any more often.'
  }),

  fit({
    id: 'lamp_reflector', name: 'Bonus Reflector',
    text: 'A BONUS runs {feverLen} balls instead of 10. A reflector is set behind the lamp.',
    rarity: 'common', price: 35, hook: 'static', tags: ['fever'],
    mods: { feverLen: ['+', 2] },
    bound: 'Longer BONUSes, not more of them. In a round where the reels never match it does nothing at all.'
  }),

  fit({
    id: 'second_rail', name: 'Second Rail',
    text: '{inFlight} balls in the air at once, so you fire about twice as fast. A second rail is bolted on.',
    rarity: 'common', price: 35, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 1] },
    bound: 'Speed magnifies whatever the machine already does. If it\'s losing balls, this loses them twice as fast.'
  }),

  fit({
    id: 'rail_brush', name: 'Quick Fall Brush',
    text: 'Balls fall 15 percent faster, so you get more pulls per minute. A brush keeps the rail clean.',
    rarity: 'common', price: 30, hook: 'static', tags: ['cadence'],
    mods: { flightTime: ['*', 0.85] },
    bound: 'Speed changes nothing about what a ball is worth. It only gets you to the same result sooner.'
  }),

  fit({
    id: 'sorting_gate', name: 'Tenth Ball Sorter',
    text: 'Every 10th ball of a round is steered straight into the slot. A sorter is fitted to the rail.',
    rarity: 'common', price: 40, hook: 'onLaunch', tags: ['gate'],
    n: { every: 10 },
    bound: 'One ball in ten is about what the slot takes anyway. This cuts the dry spells rather than raising the average.',
    apply: (ctx) => { if ((ctx.launchIndex + 1) % 10 === 0) ctx.ball.forceGate = true; }
  }),

  fit({
    id: 'wear_plate', name: 'Budget Plate',
    text: '+{add#} pulls added to every round. A wear plate takes the load off the tray.',
    rarity: 'common', price: 30, hook: 'onRoundStart', tags: ['economy'],
    n: { add: 6 },
    bound: 'More pulls on a machine that loses balls just loses more of them. It only helps once yours pays its way.',
    apply: (ctx) => { ctx.round.budget += 6; }
  }),

  fit({
    id: 'till_rail', name: 'Register Window',
    text: 'The bonus for clearing a round is x{mul~}. A second window opens on the register.',
    rarity: 'common', price: 35, hook: 'onRoundEnd', tags: ['economy'],
    n: { mul: 1.12 },
    bound: 'Pays nothing on a round you fail, and the clear bonus never counts toward the goal you needed.',
    apply: (ctx) => (ctx.cleared ? ctx.bonus * 1.12 : ctx.bonus)
  }),

  fit({
    id: 'oiled_cloth', name: 'Oiled Board',
    text: 'Balls fall 20 percent faster but touch 4 fewer nails on the way down. The board is wiped with oil.',
    rarity: 'common', price: 25, hook: 'static', tags: ['cadence', 'cost'],
    mods: { flightTime: ['*', 0.80], pinHits: ['+', -4] },
    bound: 'Cheap for a reason. Fewer nails guts every part you own that pays off nail contacts.'
  }),

  fit({
    id: 'bent_nail', name: 'Big Pocket Nail',
    text: 'The big pocket takes 1 more ball in every 100, now {jadeProb%}. One nail is bent to lean toward it.',
    rarity: 'common', price: 35, hook: 'static', tags: ['board', 'pocket'],
    mods: { jadeProb: ['+', 0.01] }, board: { addPins: 'jade-lead' },
    bound: 'The big pocket never takes more than 12 balls in 100, and it\'s the smallest pocket on the board.'
  }),

  fit({
    id: 'copper_wire', name: 'Bonus Slot Wire',
    text: 'During a BONUS the slot pays +{add#} balls more. Copper wire is run across its throat.',
    rarity: 'common', price: 30, hook: 'onGate', tags: ['gate', 'fever'],
    n: { add: 2 },
    bound: 'BONUS only, and the slot is a rare hit inside an already short window. Worth nothing in a round without one.',
    apply: (ctx) => (ctx.fever ? ctx.payout + 2 : ctx.payout)
  }),

  fit({
    id: 'ball_bearing', name: 'Ball Bearings',
    text: 'Every ball pays x{mul~}. Truer bearings are dropped into the tray.',
    rarity: 'common', price: 30, hook: 'onLaunch', tags: ['ball'],
    n: { mul: 1.08 },
    maxStack: 3,
    bound: 'Three copies come to about x1.26, less than one better pocket bought with the same three bolt points.',
    apply: (ctx) => { ctx.ball.mul *= 1.08; }
  }),

  fit({
    id: 'return_chute', name: 'Leftover Chute',
    text: 'Clear a round and every {per#} pulls you didn\'t use hand back 1 ball.',
    rarity: 'common', price: 30, hook: 'onRoundEnd', tags: ['economy'],
    n: { per: 4 },
    bound: 'It only pays when you finish early, so it pays least on exactly the rounds that were hard.',
    apply: (ctx) => (ctx.cleared
      ? ctx.bonus + Math.floor(Math.max(0, ctx.round.budget - ctx.round.launches) / 4)
      : ctx.bonus)
  }),

  fit({
    id: 'wiping_cloth', name: 'Reroll Cloth',
    text: 'Each reroll at the bench costs {step#} more than the last instead of 8.',
    rarity: 'common', price: 25, hook: 'onShopOpen', tags: ['shop'],
    n: { step: 4 },
    bound: 'Cheaper shopping and nothing else. It never puts a ball on the board.',
    apply: (ctx) => { ctx.shop.rerollStep = 4; }
  }),

  // ---- uncommon -------------------------------------------------------- //

  fit({
    id: 'nail_comb', name: 'Mid Pocket Comb',
    text: 'The mid pockets catch 4 more balls in every 100, now {creamProb%}. A comb of nails funnels into them.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['board', 'pocket'],
    mods: { creamProb: ['+', 0.04] }, board: { addPins: 'comb' },
    bound: 'The mid pockets top out at 28 balls in 100, and every pocket together can never take more than about 62.'
  }),

  fit({
    id: 'slope_plate', name: 'Slope Plate',
    text: 'Side pockets catch 5 more balls in every 100, but the big pocket catches half a ball fewer. The lower board leans left.',
    rarity: 'uncommon', price: 60, hook: 'static', tags: ['board', 'pocket', 'cost'],
    mods: { sideProb: ['+', 0.05], jadeProb: ['+', -0.005] }, board: { slope: -0.06 },
    bound: 'It trades 5 ball hits for 1 ball hits. That\'s a downgrade the moment you own anything feeding the big pocket.'
  }),

  fit({
    id: 'rubber_bumper', name: 'Rubber Bumper',
    text: 'Hitting the bumper adds x{mul~} to what the ball pays, once per ball, and the slot takes 2 more balls in every 100.',
    rarity: 'uncommon', price: 70, hook: 'onPinHit', tags: ['board', 'gate', 'ball'],
    mods: { gateProb: ['+', 0.02] }, board: { bumpers: 1 },
    n: { mul: 0.35 },
    bound: 'Once per ball, and only balls whose path happens to cross the bumper touch it at all.',
    apply: (ctx) => {
      if (ctx.pin.kind !== 'bumper' || ctx.ball.s.rubber_bumper) return;
      ctx.ball.s.rubber_bumper = 1;
      ctx.ball.mul += 0.35;
    }
  }),

  fit({
    id: 'shutter_plate', name: 'Inward Shutter',
    text: 'Mid pockets catch 4 more balls in every 100 and the big pocket 2 more, but side pockets catch 6 fewer.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['board', 'pocket'],
    mods: { sideProb: ['+', -0.06], creamProb: ['+', 0.04], jadeProb: ['+', 0.02] },
    board: { shutter: 'outer-side' },
    bound: 'A clear gain overall, but it wrecks any side pocket build you already paid for.'
  }),

  fit({
    id: 'horseshoe_magnet', name: 'Slot Magnet',
    text: 'The slot takes 4 more balls in every 100, now {gateProb%}. A horseshoe magnet sits behind it.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['gate', 'fever'],
    mods: { gateProb: ['+', 0.04] },
    bound: 'The slot stops at 30 balls in 100, and that\'s the hard ceiling on how often a BONUS can start.'
  }),

  fit({
    id: 'reel_brake', name: 'Middle Reel Brake',
    text: 'When the outer reels match, the middle reel lands on the same symbol {middleWeight%} of the time. A brake shoe drags on it.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['reel', 'fever'],
    mods: { middleWeight: ['+', 0.10] },
    bound: 'Tops out at 75 percent, and the outer reels still have to match first before this does anything.'
  }),

  fit({
    id: 'held_reel', name: 'First Match Hold',
    text: 'The first time the outer reels match in a round, the middle reel is held until it matches too. One guaranteed BONUS a round.',
    rarity: 'uncommon', price: 65, hook: 'onReelSpin', tags: ['reel', 'fever'],
    scope: 'round',
    bound: 'Exactly one guaranteed BONUS per round. However long the round runs, it never fires twice.',
    apply: (ctx) => {
      if (ctx.state.held_reel || !ctx.spin.reach) return;
      ctx.state.held_reel = 1;
      ctx.spin.matched = true;
      ctx.spin.symbol = ctx.spin.reachSymbol;
    }
  }),

  fit({
    id: 'long_fever', name: 'Long Bonus',
    text: 'A BONUS runs {feverLen} balls. A longer cam is fitted to the bonus timer.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['fever'],
    mods: { feverLen: ['+', 4] },
    bound: 'Length only, never how often one starts. A round where the reels never match sees none of it.'
  }),

  fit({
    id: 'kicker_plate', name: 'Jackpot Kicker',
    text: 'The jackpot pocket pays {attackerPay} balls instead of 8. It only opens during a BONUS.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['fever', 'pocket'],
    mods: { attackerPay: ['+', 3] },
    bound: 'BONUS only. On a machine that rarely gets one, this is a dead bolt point.'
  }),

  fit({
    id: 'gate_widener', name: 'Bonus Slot Widener',
    text: 'During a BONUS the slot takes {feverGateProb%} of balls, and a slot hit inside a BONUS extends it.',
    rarity: 'uncommon', price: 60, hook: 'static', tags: ['fever', 'gate'],
    mods: { feverGateProb: ['+', 0.08] },
    bound: 'It stops at 45 percent, which is what keeps a BONUS from running forever. Outside a BONUS it does nothing.'
  }),

  fit({
    id: 'third_rail', name: 'Third Rail',
    text: '{inFlight} balls in the air at once. Two more rails are bolted to the cabinet.',
    rarity: 'uncommon', price: 70, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 2] },
    bound: 'The cabinet never holds more than 8 balls at once, and speed magnifies losses as readily as wins.'
  }),

  fit({
    id: 'spring_latch', name: 'Strength Latch',
    text: 'Every ball pays x{mul~}, but the handle locks to the last pull that paid and you can no longer aim.',
    rarity: 'uncommon', price: 60, hook: 'onLaunch', tags: ['ball', 'aim', 'cost'],
    mods: { lockStrength: ['=', 1] },
    n: { mul: 1.20 },
    bound: 'Losing the handle is the steepest cost here. Being able to aim is worth more than x1.20 on almost any board.',
    apply: (ctx) => { ctx.ball.mul *= 1.20; }
  }),

  fit({
    id: 'trip_wire', name: 'Trip Wire',
    text: 'The 12th nail a ball touches adds x{mul~} to what it pays. A wire is strung deep in the nails.',
    rarity: 'uncommon', price: 60, hook: 'onPinHit', tags: ['ball'],
    n: { at: 12, mul: 1.0 },
    bound: 'Only about 6 balls in 10 get that deep, and none at all if you fit anything that cuts nail contacts.',
    apply: (ctx) => { if (ctx.hitIndex === 12) ctx.ball.mul += 1.0; }
  }),

  fit({
    id: 'bar_magnet', name: 'Big Pocket Magnet',
    text: '1 ball in 20 is dragged into the big pocket. A bar magnet sits underneath it.',
    rarity: 'uncommon', price: 70, hook: 'onLaunch', tags: ['pocket'],
    n: { p: 0.05 },
    bound: 'It overrides the slot on those balls, so it trades chances at a BONUS for small guaranteed pays.',
    apply: (ctx) => { if (ctx.rand() < 0.05) ctx.ball.forcePocket = 'jade'; }
  }),

  fit({
    id: 'escapement', name: 'Bonus Climber',
    text: 'Every ball of a BONUS raises the BONUS multiplier by +{step~}. It drops back when the BONUS ends.',
    rarity: 'uncommon', price: 65, hook: 'onFeverBall', tags: ['fever'],
    n: { step: 0.03 },
    bound: 'It resets at the end of every BONUS, so it pays on long ones and almost nothing on short ones.',
    apply: (ctx) => { ctx.fever.mult += 0.03; }
  }),

  fit({
    id: 'counter_wheel', name: 'Doubling Wheel',
    text: 'Every {every#}th pocket you hit in a round pays double. A counting wheel is fitted to the register.',
    rarity: 'uncommon', price: 60, hook: 'onPocket', tags: ['pocket', 'economy'],
    scope: 'round',
    n: { every: 8 },
    bound: 'The count restarts every round, so a short round may only reach it once.',
    apply: (ctx) => {
      const c = (ctx.state.counter_wheel || 0) + 1;
      ctx.state.counter_wheel = c;
      return c % 8 === 0 ? ctx.payout * 2 : ctx.payout;
    }
  }),

  fit({
    id: 'thin_glass', name: 'Thin Glass',
    text: 'Balls fall 30 percent faster but touch 5 fewer nails on the way down.',
    rarity: 'uncommon', price: 55, hook: 'static', tags: ['cadence', 'cost'],
    mods: { flightTime: ['*', 0.70], pinHits: ['+', -5] },
    bound: 'It drops a ball under 12 nail contacts, which switches Trip Wire off completely.'
  }),

  fit({
    id: 'hopper', name: 'Loan Hopper',
    text: '+{balls#} balls at the start of every round, but that round needs 8 percent more to clear.',
    rarity: 'uncommon', price: 60, hook: 'onRoundStart', tags: ['economy', 'cost'],
    n: { balls: 25, quota: 1.08 },
    bound: 'The higher goal stacks on top of the rise every round already brings, so the loan gets worse the longer you play.',
    apply: (ctx) => {
      ctx.tray.balls += 25;
      ctx.round.quota = Math.ceil(ctx.round.quota * 1.08);
    }
  }),

  fit({
    id: 'diverter', name: 'Off-Center Slot',
    text: 'The slot takes 3 more balls in every 100, but the handle range that finds it is 30 percent narrower.',
    rarity: 'uncommon', price: 65, hook: 'static', tags: ['board', 'gate', 'cost'],
    mods: { gateProb: ['+', 0.03], aimWindow: ['*', 0.7] },
    board: { diverter: true },
    bound: 'The narrow range costs more slot hits than the 3 balls give back unless you re-find the spot every round.'
  }),

  fit({
    id: 'sticky_detent', name: 'Sticky Outer Reels',
    text: 'The outer reels match {reachProb%} of the time, but the middle reel then agrees only {middleWeight%} of the time.',
    rarity: 'uncommon', price: 55, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['+', 0.064], middleWeight: ['+', -0.06] },
    bound: 'Full matches go from about 10 in 100 to about 11 in 100. It buys near misses, not many BONUSes.'
  }),

  fit({
    id: 'solenoid', name: 'Jackpot Solenoid',
    text: 'The first 4 balls of every BONUS hit the jackpot pocket 62 percent of the time instead of the usual 50.',
    rarity: 'uncommon', price: 70, hook: 'onFeverStart', tags: ['fever'],
    n: { balls: 4, attackerProb: 0.62 },
    bound: 'Four balls only, and the jackpot pocket never opens past 85 percent however many parts push on it.',
    apply: (ctx) => { ctx.fever.openings.push({ balls: 4, attackerProb: 0.62 }); }
  }),

  fit({
    id: 'warm_lamp', name: 'Afterglow Lamp',
    text: 'For {balls#} balls after a BONUS ends the jackpot pocket stays open, taking {attackerProb%} of them. Normally it shuts at once.',
    rarity: 'uncommon', price: 60, hook: 'onFeverEnd', tags: ['fever'],
    n: { balls: 6, attackerProb: 0.20 },
    bound: 'A fifth of the rate you get inside a BONUS, and it doesn\'t make the BONUS itself any longer.',
    apply: (ctx) => { ctx.after.push({ balls: 6, attackerProb: 0.20 }); }
  }),

  fit({
    id: 'anchor_plate', name: 'Early Finish Plate',
    text: 'Clear a round with {spare#} or more pulls unused and the register pays you {balls#} balls.',
    rarity: 'uncommon', price: 60, hook: 'onRoundEnd', tags: ['economy'],
    n: { spare: 20, balls: 40 },
    bound: 'A flat 40 balls. By round 12 the goal runs into the hundreds and this barely registers.',
    apply: (ctx) => (ctx.cleared && (ctx.round.budget - ctx.round.launches) >= 20
      ? ctx.bonus + 40
      : ctx.bonus)
  }),

  fit({
    id: 'relay', name: 'Respin Relay',
    text: 'A reel spin that misses has a {p%} chance to spin again. A relay is wired across the contacts.',
    rarity: 'uncommon', price: 65, hook: 'onReelSpin', tags: ['reel', 'fever'],
    n: { p: 0.12 },
    bound: 'One extra spin per slot hit, never a chain of them.',
    apply: (ctx) => {
      if (!ctx.spin.matched && ctx.spin.respins < 1 && ctx.rand() < 0.12) ctx.spin.respin = true;
    }
  }),

  // ---- rare ------------------------------------------------------------ //

  fit({
    id: 'twin_gate', name: 'Twin Slot',
    text: 'The slot takes 7 more balls in every 100, now {gateProb%}. A second pocket is cut into the left of the board.',
    rarity: 'rare', price: 120, hook: 'static', tags: ['board', 'gate', 'fever'],
    mods: { gateProb: ['+', 0.07] }, board: { gates: 2 },
    bound: 'The slot stops at 30 balls in 100. This plus a magnet plus a few pulled nails is already the ceiling.'
  }),

  fit({
    id: 'magnet_coil', name: 'Bonus Coil',
    text: 'During a BONUS every pocket pays x{mul~}. A coil energizes during a BONUS.',
    rarity: 'rare', price: 110, hook: 'onPocket', tags: ['fever', 'pocket'],
    n: { mul: 1.5 },
    bound: 'BONUS balls only, which on most machines is well under a fifth of the balls you fire.',
    apply: (ctx) => (ctx.fever ? ctx.payout * 1.5 : ctx.payout)
  }),

  fit({
    id: 'nail_gauge', name: 'All-Pocket Nails',
    text: 'Every pocket on the board takes 25 percent more balls. The out lanes take the loss.',
    rarity: 'rare', price: 125, hook: 'static', tags: ['board', 'pocket'],
    mods: {
      gateProb: ['*', 1.25], jadeProb: ['*', 1.25],
      creamProb: ['*', 1.25], sideProb: ['*', 1.25]
    },
    bound: 'Every pocket together can never take more than about 62 balls in 100, so this is worth less the more board parts you own.'
  }),

  fit({
    id: 'short_strip', name: 'Short Reel Strip',
    text: 'The outer reels match {reachProb%} of the time. Each reel carries 8 faces instead of 12.',
    rarity: 'rare', price: 110, hook: 'static', tags: ['reel', 'fever'],
    mods: { reachProb: ['=', 0.34], stripStops: ['=', 8] },
    bound: 'It sets the match rate rather than adding to it, so it overwrites Loose Reel Belts and Sticky Outer Reels instead of stacking.'
  }),

  fit({
    id: 'continuation_lock', name: 'Bonus Extender',
    text: 'A reel match during a BONUS adds {continuationAdd} balls to it instead of 10.',
    rarity: 'rare', price: 125, hook: 'static', tags: ['fever'],
    mods: { continuationAdd: ['+', 8] },
    bound: 'Both the slot rate and the match rate have ceilings, so a BONUS still ends. Long ones get longer, not endless.'
  }),

  fit({
    id: 'rolling_shutter', name: 'Bonus Shutter',
    text: 'The first {balls#} balls of every BONUS hit the jackpot pocket {attackerProb%} of the time. A shutter rolls over the out lanes.',
    rarity: 'rare', price: 120, hook: 'onFeverStart', tags: ['board', 'fever'],
    n: { balls: 6, attackerProb: 0.72 },
    bound: 'Six balls, and the jackpot pocket never opens past 85 percent however many parts stack on it.',
    apply: (ctx) => { ctx.fever.openings.push({ balls: 6, attackerProb: 0.72 }); }
  }),

  fit({
    id: 'pocket_magnet', name: 'Out Lane Magnet',
    text: '{p%} of the balls headed for the out lanes are dragged into a side pocket instead.',
    rarity: 'rare', price: 110, hook: 'onBallLost', tags: ['pocket', 'economy'],
    n: { p: 0.30 },
    bound: 'It pays the side pocket value, the smallest on the board, so it\'s only as good as your weakest pocket.',
    apply: (ctx) => (ctx.rand() < 0.30 ? ctx.refund + ctx.model.sidePay : ctx.refund)
  }),

  fit({
    id: 'ratchet', name: 'Goal Ratchet',
    text: 'Every round needs {cut#} percent fewer balls to clear. A ratchet is fitted to the goal counter.',
    rarity: 'rare', price: 115, hook: 'onRoundStart', tags: ['economy'],
    n: { mul: 0.88, cut: 12 },
    bound: 'A flat 12 percent against a goal that grows about 17 percent a round. It buys most of one extra round, not a run.',
    apply: (ctx) => { ctx.round.quota = Math.ceil(ctx.round.quota * 0.88); }
  }),

  fit({
    id: 'pawl', name: 'Carryover Latch',
    text: 'Clear a round and up to {cap#} unused pulls carry into the next one.',
    rarity: 'rare', price: 110, hook: 'onRoundEnd', tags: ['economy'],
    n: { cap: 30 },
    bound: 'Capped at 30 and it never carries twice. The next round spends whatever it brought forward.',
    apply: (ctx) => {
      if (ctx.cleared) {
        ctx.carry.launches = Math.min(30, Math.max(0, ctx.round.budget - ctx.round.launches));
      }
      return ctx.bonus;
    }
  }),

  fit({
    id: 'score_plate', name: 'All-Pocket Plate',
    text: 'Every pocket on the board pays +2 balls, the jackpot pocket included. The numerals are raised in the enamel.',
    rarity: 'rare', price: 130, hook: 'static', tags: ['pocket'],
    mods: {
      gatePay: ['+', 2], jadePay: ['+', 2], creamPay: ['+', 2],
      sidePay: ['+', 2], attackerPay: ['+', 2]
    },
    bound: 'A flat amount. Its share of a payout shrinks every time you buy a multiplier after it.'
  }),

  fit({
    id: 'cam', name: 'Warm-Up Cam',
    text: 'Each pull in a round adds 0.4 percent to what your balls pay, up to x{cap~}. It winds back to nothing each round.',
    rarity: 'rare', price: 110, hook: 'onLaunch', tags: ['ball'],
    n: { per: 0.004, cap: 2.0 },
    bound: 'It resets every round, so it pays most in the long rounds you were already winning.',
    apply: (ctx) => { ctx.ball.mul *= Math.min(2.0, 1 + 0.004 * ctx.launchIndex); }
  }),

  fit({
    id: 'hopper_wheel', name: 'Free Ball Wheel',
    text: 'The first {free#} balls of every BONUS cost you nothing.',
    rarity: 'rare', price: 120, hook: 'onFeverBall', tags: ['fever', 'economy'],
    n: { free: 8 },
    bound: 'It saves balls, never pays any, and it can\'t save more of them than a BONUS is long.',
    apply: (ctx) => { if (ctx.fever.ballsUsed < 8) ctx.ball.free = true; }
  }),

  fit({
    id: 'copper_bus', name: 'Copper Bus',
    text: 'Every nail touched on the left half of the board adds x{per~} to what the ball pays, with no limit.',
    rarity: 'rare', price: 105, hook: 'onPinHit', tags: ['ball'],
    n: { per: 0.05 },
    bound: 'No cap, but only about half the nails a ball touches are on the left, and anything that speeds the fall cuts them.',
    apply: (ctx) => { if (ctx.pin.side === 'left') ctx.ball.mul += 0.05; }
  }),

  fit({
    id: 'bevel_glass', name: 'Hot Start Glass',
    text: 'A BONUS starts at x{feverMult~} instead of x1.00. Heavier glass is set over the bonus counter.',
    rarity: 'rare', price: 115, hook: 'static', tags: ['fever'],
    mods: { feverMult: ['+', 0.5] },
    bound: 'It multiplies BONUS payouts only. A round without one gets nothing back for the price.'
  }),

  fit({
    id: 'sprocket', name: 'Fast Rail Drive',
    text: '{inFlight} balls in the air at once, and the rail can fire every 0.18 seconds.',
    rarity: 'rare', price: 115, hook: 'static', tags: ['cadence'],
    mods: { inFlight: ['+', 3], launchFloor: ['=', 0.18] },
    bound: 'The cabinet never holds more than 8 balls. Speed changes how fast you find out, not what a ball is worth.'
  }),

  fit({
    id: 'wire_guard', name: 'Out Lane Guards',
    text: 'Mid pockets catch 6 more balls in every 100 and side pockets 4 more. Guards close the outer columns.',
    rarity: 'rare', price: 120, hook: 'static', tags: ['board', 'pocket'],
    mods: { creamProb: ['+', 0.06], sideProb: ['+', 0.04] },
    board: { removePins: 'outer-columns' },
    bound: 'It runs into the ceiling on total pocket chance faster than anything else here, so it\'s weakest on a stacked board.'
  }),

  fit({
    id: 'tilt_weight', name: 'Repeat Pull Weight',
    text: 'Pull within 5 of the last strength that paid and the ball pays x{mul~}. A tilt weight remembers the spot.',
    rarity: 'rare', price: 105, hook: 'onLaunch', tags: ['ball', 'aim'],
    n: { tol: 0.05, mul: 1.4 },
    bound: 'It needs a paying hit to set the mark, so it\'s dead on the first ball of a round and dead through any dry spell.',
    apply: (ctx) => {
      const last = ctx.stats.lastPayingStrength;
      if (last != null && Math.abs(ctx.strength - last) <= 0.05) ctx.ball.mul *= 1.4;
    }
  }),

  fit({
    id: 'fuse_wire', name: 'Fuse Wire',
    text: 'Every payout is x{mul~} until one ball pays more than {blow#} balls. That blows the fuse and the part is done for the run.',
    rarity: 'rare', price: 100, hook: 'onPocket', tags: ['risk', 'pocket'],
    n: { mul: 1.8, blow: 60 },
    bound: 'It kills itself. On any machine strong enough to be worth it, the first BONUS blows the fuse within a couple of balls.',
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
    id: 'brass_seven', name: 'Brass Seven',
    text: 'Match three sevens and the BONUS runs {balls#} balls at x{mult~}. One symbol in twelve on each reel is a seven.',
    rarity: 'brass', price: 220, hook: 'onReelSpin', tags: ['reel', 'fever'],
    n: { balls: 40, mult: 2.0 },
    bound: 'A seven on both outer reels comes up about once in 144 spins, so unaided this fires about once in 3,400 balls.',
    apply: (ctx) => {
      if (ctx.spin.matched && ctx.spin.symbol === 'seven') {
        ctx.spin.feverLen = 40;
        ctx.spin.feverMult = 2.0;
      }
    }
  }),

  fit({
    id: 'holding_plate', name: 'Slot Hold Plate',
    text: 'For {balls#} balls after a BONUS ends the slot takes {gateProb%} of everything you fire, so one BONUS often runs into the next.',
    rarity: 'brass', price: 210, hook: 'onFeverEnd', tags: ['gate', 'fever'],
    n: { balls: 25, gateProb: 0.35 },
    bound: 'It only opens the slot. Payouts are unchanged, and the hold expires after 25 balls whether it chained or not.',
    apply: (ctx) => { ctx.after.push({ balls: 25, gateProb: 0.35 }); }
  }),

  fit({
    id: 'second_face', name: 'Double Board',
    text: 'Every pocket takes 60 percent more balls. The lower third of the board is doubled, so every pocket exists twice.',
    rarity: 'brass', price: 240, hook: 'static', tags: ['board', 'pocket'],
    mods: {
      gateProb: ['*', 1.6], jadeProb: ['*', 1.6],
      creamProb: ['*', 1.6], sideProb: ['*', 1.6]
    },
    board: { duplicateLower: true },
    bound: 'The ceiling on total pocket chance bites at once, so on a stacked board you get well under the 60 percent.'
  }),

  fit({
    id: 'attacker_mouth', name: 'Jackpot Mouthpiece',
    text: 'During a BONUS the jackpot pocket takes {attackerProb%} of balls and pays {attackerPay}. The pocket is cut wide open.',
    rarity: 'brass', price: 230, hook: 'static', tags: ['fever', 'pocket'],
    mods: { attackerProb: ['=', 0.68], attackerPay: ['+', 6] },
    bound: 'BONUS only. It can\'t start one, and it sets the rate rather than adding to it, so shutters add less on top.'
  }),

  fit({
    id: 'counter_till', name: 'Second Register',
    text: 'The bonus for clearing a round is x{mul~}. A second register opens behind the counter.',
    rarity: 'brass', price: 200, hook: 'onRoundEnd', tags: ['economy'],
    n: { mul: 2.0 },
    bound: 'It pays nothing on the round that ends your run, which is the round you needed it most.',
    apply: (ctx) => (ctx.cleared ? ctx.bonus * 2.0 : ctx.bonus)
  }),

  fit({
    id: 'overflow_rail', name: 'Overflow Rail',
    text: 'Eight balls in the air at once, firing every 0.15 seconds, and past the {after#}th pull of a round every ball pays +1.',
    rarity: 'brass', price: 200, hook: 'onLaunch', tags: ['cadence', 'economy'],
    mods: { inFlight: ['=', 8], launchFloor: ['=', 0.15] },
    n: { after: 100, add: 1 },
    bound: 'The +1 is flat and only arrives after pull 100, so it rescues a slow grind rather than scaling with a good board.',
    apply: (ctx) => { if (ctx.launchIndex >= 100) ctx.ball.add += 1; }
  }),

  fit({
    id: 'ground_glass', name: 'Blind Glass',
    text: 'Every payout is x{mul~}, but the glass goes opaque: you can\'t watch the ball, and the handle range that finds the slot is half as wide.',
    rarity: 'brass', price: 190, hook: 'static', tags: ['risk', 'cost'],
    mods: { payMul: ['*', 2.4], aimWindow: ['*', 0.5] },
    board: { frosted: true },
    n: { mul: 2.4 },
    bound: 'Half the aim range is a heavy loss on a board you re-find every round, and you lose the sight of the ball you would use to find it.'
  }),

  fit({
    id: 'technicians_plan', name: 'Bench Plan',
    text: 'One more bolt point on the machine, and the bench always offers at least one rare part.',
    rarity: 'brass', price: 230, hook: 'onShopOpen', tags: ['shop', 'economy'],
    mods: { slots: ['+', 1] },
    bound: 'A bolt point and better offers. It puts no ball on the board and pays nothing by itself.',
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
    ids: ['nail_comb', 'shutter_plate'], name: 'Mid Pocket Funnel', on: 'creamPay', mult: 1.35,
    text: 'Mid pockets pay x1.35. The comb feeds them and the shutter turns the rest of the board inward.'
  },
  {
    ids: ['rubber_sleeve', 'felt_strip', 'trip_wire'], name: 'Loaded Nails', on: 'ballMul', mult: 1.50,
    text: 'Everything a ball picks up on the way down is worth x1.50. Three surfaces on the same nails.'
  },
  {
    ids: ['oiled_cloth', 'rubber_sleeve'], name: 'Oil On Rubber', on: 'ballMul', mult: 0.70, trap: true,
    text: 'Everything a ball picks up on the way down is worth x0.70. It skates past the sleeves instead of gripping them.'
  },
  {
    ids: ['warm_lamp', 'holding_plate'], name: 'Long Afterglow', on: 'afterglow', mult: 1.60,
    text: 'Everything paid in the balls right after a BONUS is worth x1.60. The BONUS just ended and the slot is still open.'
  },
  {
    ids: ['holding_plate', 'gate_widener', 'continuation_lock'], name: 'Bonus Chain', on: 'feverLen', mult: 2.20,
    text: 'BONUSes run x2.20 longer. Held open, widened, and locked so a reel match stretches them farther.'
  },
  {
    ids: ['twin_gate', 'horseshoe_magnet'], name: 'Double Slot Pull', on: 'gateProb', mult: 1.25,
    text: 'The slot takes x1.25 more balls, up to its 30 in 100 ceiling. Two pockets with a magnet behind them.'
  },
  {
    ids: ['counterweight_plate', 'spring_latch'], name: 'Latched Hard', on: 'ballMul', mult: 1.45,
    text: 'Every ball pays x1.45 more. The arm is latched at the top of its travel.'
  },
  {
    ids: ['tilt_weight', 'spring_latch'], name: 'In The Groove', on: 'ballMul', mult: 1.80,
    text: 'Every ball pays x1.80 more. Latched onto the last strength that paid, and weighted to hold it.'
  },
  {
    ids: ['second_face', 'score_plate'], name: 'Twice The Pockets', on: 'pocketPay', mult: 1.30,
    text: 'Every pocket pays x1.30. Twice as many pockets, all of them re-numbered.'
  },
  {
    ids: ['held_reel', 'brass_seven'], name: 'Hold For Sevens', on: 'sevenProb', mult: 3.00,
    text: 'Three times the chance of a seven on the first reel match of a round, and a seven is the biggest BONUS in the game.'
  },
  {
    ids: ['attacker_mouth', 'rolling_shutter'], name: 'Wide Open Jackpot', on: 'feverEv', mult: 1.35,
    text: 'A BONUS is worth x1.35. The shutter drops across a pocket already cut wide.'
  },
  {
    ids: ['escapement', 'bevel_glass'], name: 'Hot And Climbing', on: 'feverEv', mult: 1.50,
    text: 'A BONUS is worth x1.50. It starts high and climbs with every ball.'
  },
  {
    ids: ['hopper_wheel', 'long_fever'], name: 'Bonus On The House', on: 'feverEv', mult: 1.40,
    text: 'A BONUS is worth x1.40. Eight of its fourteen balls cost you nothing.'
  },
  {
    ids: ['counter_wheel', 'score_plate'], name: 'Doubled And Raised', on: 'pocketPay', mult: 1.22,
    text: 'Every pocket pays x1.22. The wheel doubles a pocket that was already worth more.'
  },
  {
    ids: ['return_rail', 'pocket_magnet'], name: 'Nothing Wasted', on: 'recovery', mult: 1.50,
    text: 'Balls saved from the out lanes go up x1.50. The tray catches what the magnets miss.'
  },
  {
    ids: ['second_rail', 'third_rail', 'sprocket'], name: 'Every Rail Fitted', on: 'cadence', mult: 1.15,
    text: 'Pulls per minute x1.15, on top of the extra balls already in the air.'
  },
  {
    ids: ['ground_glass', 'sorting_gate'], name: 'Blind But Sorted', on: 'payout', mult: 1.30,
    text: 'Every payout x1.30. You can\'t see the ball, but every tenth one finds the slot anyway.'
  },
  {
    ids: ['fuse_wire', 'attacker_mouth'], name: 'Fuse Goes First', on: 'payout', mult: 0.50, trap: true,
    text: 'Every payout x0.50. The first jackpot ball pays over sixty and blows the fuse in your first BONUS.'
  },
  {
    ids: ['nail_gauge', 'second_face'], name: 'Both Into The Ceiling', on: 'pocketPay', mult: 1.20,
    text: 'Every pocket pays x1.20. Both parts push at the same ceiling on pocket chance, so the pay rises instead.'
  },
  {
    ids: ['pawl', 'wear_plate', 'anchor_plate'], name: 'More Pulls', on: 'budget', mult: 1.30,
    text: 'Effective pull budget x1.30. Pulls added, carried over, and rewarded for going unused.'
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
