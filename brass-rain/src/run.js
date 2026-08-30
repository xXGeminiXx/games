// ---------------------------------------------------------------------------
// A run.
//
// A run is a session at one machine. It is played in rounds; each round hands
// over a tray of balls and asks for a number of balls back. Launching costs a
// ball, pockets pay balls, and the board pays back less than it takes - so a
// round played straight always ends short. The gate is the way out of that:
// a ball through it spins the reels, three matching digits open the attacker,
// and while the attacker is open the board pays several times what it costs.
//
// Everything a fitting can change goes through the multipliers on this state
// rather than through the physics or the board directly, so the arithmetic of
// a round can be read, tested and swept without a canvas anywhere near it.
// ---------------------------------------------------------------------------

import { rng as makeRng } from './rng.js?v=30';
import { createBoard, pocket } from './board.js?v=30';
import { createBalls, launch, clearBalls, stepPhysics } from './physics.js?v=30';
import { fire, hasHook } from './hooks.js?v=30';
import {
  createEvents, resetEvents, eventsOnLaunch, eventsOnBallHits, eventsOnResolve,
  eventsOnTake, eventsOnReels, eventsOnWideShut, eventsPayMult, isEventPocket,
} from './events.js?v=30';

export const PHASE_PLAY = 'play';
export const PHASE_SETTLE = 'settle';
export const PHASE_SHOP = 'shop';
export const PHASE_OVER = 'over';

/** How finely the face is divided when counting where balls end up. */
export const LANDING_COLUMNS = 36;

/** The multipliers a fitting may move. Reset and rebuilt every round. */
export function baseMods() {
  return {
    payMult: 1,          // every pocket payout
    gatePayMult: 1,      // the attacker only
    feverBalls: 0,       // added to a fever's length
    feverMult: 1,        // multiplies a fever's payout
    matchBonus: 0,       // added to the chance three reels agree
    continueBonus: 0,    // added to the chance a fever chains
    budget: 0,           // extra launches the round is rented for
    launchPer: 0,        // extra balls per pull of the handle
    launchRate: 1,       // multiplies the handle's cadence
    trayGrant: 0,        // extra balls handed over at the start of a round
    quotaMult: 1,        // multiplies what a round asks for; a cost, not a gift
    scatter: 1,          // multiplies how far a nail throws a ball
    ballWorth: 1,        // what one ball is worth when it lands somewhere paying
    refund: 0,           // share of a lost ball handed back
    spinsPerGate: 1,     // reel spins bought by one ball through the gate
  };
}

/** A fresh run on a fresh machine. */
export function createRun(cfg, seed, meta, fitted) {
  const r = makeRng('run:' + seed);
  const board = createBoard(cfg, seed);
  useCabinet(cfg, board);
  const state = {
    cfg,
    seed: seed >>> 0,
    rng: r,
    meta: meta || emptyMeta(),

    board,
    balls: createBalls(cfg.physics.maxLive),

    phase: PHASE_PLAY,
    round: 1,
    quota: 0,
    budget: 0,            // launches this round is rented for
    won: 0,               // balls won this round, which is what a quota counts
    tray: cfg.run.startTray,
    launched: 0,
    strength: cfg.launch.strength,
    auto: false,
    launchAcc: 0,
    lent: 0,              // balls the counter put in to cover this round

    fever: { active: false, ballsLeft: 0, chain: 0, mult: 1, t: 0, spent: 0 },
    // The centre window, plus whatever is turning beside it. A second spin
    // used to wait for the first, which pushed its payout past the end of the
    // round; it now opens its own window around the centre one.
    reel: { spinning: false, t: 0, queued: 0, digits: [0, 0, 0], result: null, holdT: 0, around: [] },
    // What the machine is doing back. Everything the face is showing beyond
    // the mouths it was built with lives here; src/events.js documents the
    // shape the picture reads.
    events: createEvents(),

    fittings: [],
    mods: baseMods(),
    // Where the parts bolted into this machine get to speak, and the scratch
    // space they are allowed to keep notes in. A run with no bench simply
    // never fires a moment, which is how the game runs before a catalogue has
    // been loaded rather than not running at all.
    bench: null,
    // The catalogue's own view of this machine. Parts read it to work out what
    // they are changing FROM; without it a part that asks what a pocket
    // currently pays gets nothing and stops working, which is a part bought
    // and inert with its plaque still promising what it does.
    model: null,
    scratch: {},
    counters: { launchesThisRound: 0, pocketsThisRound: 0, feversThisRound: 0, ballsThisRun: 0, lastPayingStrength: null },

    log: [],
    time: 0,
    speed: 1,
    paused: false,
    over: false,

    stats: {
      launched: 0, won: 0, lost: 0, gates: 0, spins: 0,
      fevers: 0, chains: 0, bestRound: 0, bestFever: 0, pinHits: 0,
      // Balls this run was paid that it would not have been paid by the
      // cabinet on its own: what a lit stripe, a shutter, a spare mouth and a
      // row of doors added on top. Kept because the quota a round asks for is
      // derived from what the bare face pays, so what the rest of it is worth
      // has to be a number somebody can read rather than a number inferred by
      // playing the same seed twice and watching it diverge.
      eventBalls: 0,
    },

    // Where balls have been ending up, across the width of the face. This is
    // the only way a player can see what the nails are actually doing, and it
    // is what makes leaning one of them a decision rather than a guess. It is
    // kept for the round in play and for the round before it, so a bend can be
    // judged against what it replaced.
    landing: new Int32Array(LANDING_COLUMNS),
    landingPaid: new Int32Array(LANDING_COLUMNS),
    landingLast: new Int32Array(LANDING_COLUMNS),
    landingPaidLast: new Int32Array(LANDING_COLUMNS),
  };
  // Everything a part needs is in place before the first round is opened,
  // because the first round opening is itself a moment parts listen for. A run
  // that attaches its parts afterwards silently skips round one for every one
  // of them.
  if (fitted) {
    if (fitted.bench) state.bench = fitted.bench;
    if (fitted.model) state.model = fitted.model;
    if (Array.isArray(fitted.fittings)) state.fittings = fitted.fittings.slice();
    if (fitted.mods) state.mods = fitted.mods;
  }
  startRound(state, 1);
  return state;
}

export function emptyMeta() {
  return { scrip: 0, marks: 0, best: { round: 0, balls: 0, fever: 0 }, seen: {} };
}

/**
 * What round `n` asks for.
 *
 * The step between rounds shrinks as the run goes on. It is the deceleration
 * that makes a run feel like it is being won: the quota keeps climbing, but by
 * round nine it is climbing more slowly than the machine is being improved.
 */
export function quotaFor(cfg, n, mods) {
  const demand = cfg.run.demandBase * Math.pow(cfg.run.demandGrowth, Math.max(0, n - 1));
  // Asked against what THIS cabinet pays, which is carried on the run's own
  // configuration rather than threaded through every caller. A thin board and
  // a generous one are different machines, and asking both for the same
  // number of balls would make picking a cabinet a matter of picking the least
  // punishing one rather than picking the one you want to play.
  const base = demand * cfg.run.baseReturn * budgetFor(cfg, n, mods);
  return Math.max(1, Math.ceil(base * (mods ? mods.quotaMult : 1)));
}

/**
 * Tells a configuration which cabinet it belongs to.
 *
 * Called once when a board is put in front of the player. Everything that asks
 * what a round demands then gets the right answer without having to know a
 * cabinet exists.
 */
export function useCabinet(cfg, board) {
  const pays = board && board.layout && Number.isFinite(board.layout.baseReturn)
    ? board.layout.baseReturn : null;
  if (pays !== null) cfg.run.baseReturn = pays;
  return cfg;
}

/** How many pulls of the handle round `n` is rented for. */
export function pullsFor(cfg, n, mods) {
  const extra = mods && Number.isFinite(mods.budget) ? mods.budget : 0;
  return Math.max(1, Math.floor(cfg.run.budgetBase + cfg.run.budgetStep * n + extra));
}

/**
 * How many balls round `n` is rented for.
 *
 * A round is rented by the PULL, not by the ball, so a machine that has been
 * made to send four balls at a time sends four times as many balls in the same
 * number of pulls. The quota is derived from this number, so the round is no
 * easier - it is the same round, played in a quarter of the time, with four
 * times as much happening on the face. That is what a busier machine is worth.
 */
export function budgetFor(cfg, n, mods) {
  return pullsFor(cfg, n, mods) * perPullAt(cfg, n, mods);
}

/** Balls sent by one pull in round `n`. */
export function perPullAt(cfg, n, mods) {
  const table = cfg.run.ballsPerPull;
  const byRound = Array.isArray(table) && table.length
    ? table[Math.min(table.length - 1, Math.max(0, n - 1))]
    : 1;
  const extra = mods && Number.isFinite(mods.launchPer) ? mods.launchPer : 0;
  return Math.max(1, Math.round((byRound + extra) * (cfg.launch.perLaunch || 1)));
}

/** What clearing round `n` pays into the tray. */
export function clearBonusFor(cfg, n, mods) {
  return Math.round(quotaFor(cfg, n, mods) * cfg.run.clearBonus);
}

/** What the quota works out to per launch still left in the round. */
export function quotaRate(state) {
  const left = Math.max(0, state.quota - state.won);
  return left / Math.max(1, launchesLeft(state));
}

/** Balls still allowed this round, the rental and the tray both counted. */
export function launchesLeft(state) {
  const byBudget = state.budget - state.launched;
  const byTray = Math.floor(state.tray / state.cfg.launch.cost);
  return Math.max(0, Math.min(byBudget, byTray));
}

/** Pulls still left in the round, which is what a player counts. */
export function pullsLeft(state) {
  return Math.ceil(launchesLeft(state) / Math.max(1, ballsPerPull(state)));
}

/** The tray handed over at the start of round `n`. */
export function trayFor(cfg, n, mods) {
  const g = Math.pow(cfg.run.trayGrantGrowth, n - 1);
  return Math.floor(cfg.run.trayGrant * g) + (mods ? mods.trayGrant : 0);
}

export function startRound(state, n) {
  const cfg = state.cfg;
  state.round = n;
  state.phase = PHASE_PLAY;
  state.budget = budgetFor(cfg, n, state.mods);
  state.quota = quotaFor(cfg, n, state.mods);
  state.won = 0;
  state.launched = 0;
  // The counter lends the machine its round. A tray short of what the round
  // is rented for is topped up to it, so a part bought at the bench can never
  // leave the player unable to play the round they bought it for. Spending at
  // the bench costs the profit, not the game.
  state.tray = Math.floor(state.tray * cfg.run.carryOver) + trayFor(cfg, n, state.mods);
  if (state.tray < state.budget) {
    state.lent = state.budget - state.tray;
    state.tray = state.budget;
  } else {
    state.lent = 0;
  }
  state.fever.active = false;
  state.fever.ballsLeft = 0;
  state.fever.chain = 0;
  state.reel.spinning = false;
  state.reel.queued = 0;
  state.reel.result = null;
  state.reel.around.length = 0;
  // Both counts move together. Keeping the round's total and its paid share
  // over different rounds is how a chart ends up saying more balls paid than
  // were ever launched.
  state.landingLast.set(state.landing);
  state.landingPaidLast.set(state.landingPaid);
  state.landing.fill(0);
  state.landingPaid.fill(0);
  clearBalls(state.balls);
  closeAttacker(state);
  // Nothing carries across a round. A round starts on the face the cabinet was
  // built with, so a spare mouth cut into it cannot still be there while the
  // nails are being set at the bench.
  resetEvents(state);
  state.counters.launchesThisRound = 0;
  state.counters.pocketsThisRound = 0;
  state.counters.feversThisRound = 0;
  const rs = moment(state, 'onRoundStart', {
    round: { n, budget: state.budget, quota: state.quota, launches: 0, paid: 0 },
    tray: { balls: state.tray },
  });
  if (rs) {
    if (Number.isFinite(rs.round.budget) && rs.round.budget > 0) state.budget = Math.floor(rs.round.budget);
    if (Number.isFinite(rs.round.quota) && rs.round.quota > 0) state.quota = Math.ceil(rs.round.quota);
    if (Number.isFinite(rs.tray.balls) && rs.tray.balls >= 0) state.tray = Math.floor(rs.tray.balls);
  }

  logLine(state, 'round', state.cfg.text.round + ' ' + n + ' - ' + state.quota + ' ' + state.cfg.text.balls
    + (state.lent > 0 ? ' (the counter lent ' + state.lent + ')' : ''));
}

function closeAttacker(state) {
  const a = pocket(state.board, 'attacker');
  if (a) a.open = false;
}

function openAttacker(state) {
  const a = pocket(state.board, 'attacker');
  if (a) a.open = true;
}

const EMPTY_MODEL = {};

/** The context every moment is handed. */
function ctxFor(state, extra) {
  const ctx = {
    // Never null. A part that asks the machine what a pocket currently pays
    // and is handed nothing at all throws, and a part that throws is switched
    // off in silence with the player's balls already spent.
    model: state.model || EMPTY_MODEL,
    state: state.scratch,
    stats: state.counters,
    rand: state.rng.next,
    disable: false,
  };
  if (extra) for (const k of Object.keys(extra)) ctx[k] = extra[k];
  return ctx;
}

/** Fires a moment at the parts bolted in, if any are listening. */
function moment(state, name, extra) {
  if (!state.bench || !hasHook(state.bench, state.fittings, name)) return null;
  const ctx = ctxFor(state, extra);
  fire(state.bench, state.fittings, name, ctx);
  return ctx;
}

export function logLine(state, kind, text) {
  state.log.push({ kind, text, t: state.time });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

/** Sends one pull of the handle, which may be more than one ball. */
/** Balls sent by one pull, which grows as the night goes on. */
export function ballsPerPull(state) {
  return perPullAt(state.cfg, state.round, state.mods);
}

export function pullHandle(state) {
  const cfg = state.cfg;
  if (state.phase !== PHASE_PLAY) return 0;
  const per = ballsPerPull(state);
  let sent = 0;
  for (let i = 0; i < per; i++) {
    // The machine is rented for a number of launches and holds a tray of
    // balls, and either running out ends the pull. The budget is what usually
    // binds; the tray only binds if a round has been played very badly.
    if (state.launched >= state.budget) break;
    if (state.tray < cfg.launch.cost) break;
    const jitter = (state.rng.next() * 2 - 1) * cfg.launch.spread;
    // `s` is the ball's own scratch space. Parts that accumulate something
    // over a ball's flight keep it here, and without it they have nowhere to
    // put it and stop working the moment they try.
    const ball = { mul: state.mods.ballWorth, add: 0, free: false, forceGate: false, forcePocket: null, tags: [], s: {} };
    moment(state, 'onLaunch', { ball, strength: state.strength, launchIndex: state.launched });
    // A ball sent during a fever is offered to the parts BEFORE it is paid
    // for and before it leaves the handle, so a part that pays for it, enriches
    // it or lengthens the fever is acting on the ball about to be sent rather
    // than on one already gone.
    if (state.fever.active) {
      const fb = {
        fever: { balls: state.fever.ballsLeft, mult: state.fever.mult, ballsUsed: state.fever.spent || 0 },
        ball, ballsLeft: state.fever.ballsLeft,
      };
      moment(state, 'onFeverBall', fb);
      if (Number.isFinite(fb.fever.mult) && fb.fever.mult > 0) state.fever.mult = fb.fever.mult;
      if (Number.isFinite(fb.fever.balls) && fb.fever.balls > 0) state.fever.ballsLeft = Math.round(fb.fever.balls);
      state.fever.spent = (state.fever.spent || 0) + 1;
    }
    const idx = launch(cfg, state.balls, state.strength, jitter,
      Number.isFinite(ball.mul) ? ball.mul : 1,
      Number.isFinite(ball.add) ? ball.add : 0,
      !!ball.free);
    if (idx < 0) break;
    // A part that steers a ball steers it: the ball is put on the face above
    // the mouth it was sorted into and falls into it from there. It is still a
    // ball on the board, it can still be knocked off course by the nails just
    // under it, and the player can watch it happen.
    const target = ball.forceGate ? 'gate' : ball.forcePocket;
    if (target) steerTo(state, idx, target);
    if (!ball.free) state.tray -= cfg.launch.cost;
    state.counters.launchesThisRound++;
    state.counters.ballsThisRun++;
    state.launched++;
    state.stats.launched++;
    sent++;
    // Balls sent is the only clock anything the machine is doing back runs on,
    // so it is ticked here, once per ball, whatever else is going on.
    eventsOnLaunch(state);
    // A fever is measured in balls sent, not in seconds, so it cannot be
    // stretched by playing slowly or cut short by a pause.
    if (state.fever.active) {
      if (--state.fever.ballsLeft <= 0) endFever(state);
    }
  }
  return sent;
}

/** One frame of the run. `dt` is real seconds; speed is applied here. */
export function stepRun(state, dt, out) {
  const cfg = state.cfg;
  // The face keeps running while the last balls come down. A round that ends
  // the instant its quota is met would freeze fifty balls in mid air and throw
  // away whatever they were about to pay, and the record of where balls went
  // would be a record of the ones that resolved first, which are the ones
  // caught highest up the face.
  if (state.paused || (state.phase !== PHASE_PLAY && state.phase !== PHASE_SETTLE)) return;
  const scaled = Math.min(dt * state.speed, 0.25);
  state.time += scaled;

  // The handle, when it is running itself. Nothing is sent while the face is
  // clearing.
  if (state.auto && state.phase === PHASE_PLAY) {
    const perSecond = cfg.launch.perMinute * state.mods.launchRate / 60;
    state.launchAcc += scaled * perSecond;
    let guard = 400;
    while (state.launchAcc >= 1 && guard-- > 0) {
      state.launchAcc -= 1;
      if (pullHandle(state) === 0) { state.launchAcc = 0; break; }
    }
  }

  stepReels(state, scaled, out);

  // The board itself, in fixed steps so a run is reproducible.
  const h = cfg.physics.step;
  state.physAcc = (state.physAcc || 0) + scaled;
  let steps = 0;
  while (state.physAcc >= h && steps < cfg.physics.maxSteps * Math.max(1, state.speed)) {
    state.physAcc -= h;
    stepPhysics(cfg, state.board, state.balls, h, state.rng.next, out);
    steps++;
  }
  if (state.physAcc > h * 4) state.physAcc = 0;

  for (const e of out.events) resolveEvent(state, e, out);
  out.events.length = 0;

  // Anything the machine paid out on its own - a row of doors closing on the
  // ball that ended it - is flashed on the face through the same collector the
  // mouths use, so the picture has one place to read a payout from.
  if (state.events.marks.length) {
    for (const m of state.events.marks) out.marks.push(m);
    state.events.marks.length = 0;
  }

  checkRoundEnd(state);
}

function resolveEvent(state, e, out) {
  const cfg = state.cfg;
  state.stats.pinHits += e.hits || 0;
  const col = landingColumn(state.board, e.x);
  state.landing[col]++;
  if (e.kind === 'pay' || e.kind === 'attacker' || e.kind === 'gate') state.landingPaid[col]++;
  // What this ball did on the way down, offered to whatever the machine might
  // do back. A ball that rattled the whole face is the one a player noticed.
  eventsOnBallHits(state, e.hits || 0, e.x);
  if (e.type === 'out') {
    state.stats.lost++;
    eventsOnResolve(state, 0, e.x);
    const lost = moment(state, 'onBallLost', { ball: ballOf(e), refund: state.mods.refund, value: state.mods.refund });
    let back = lost && Number.isFinite(lost.value) ? lost.value : state.mods.refund;
    if (lost && Number.isFinite(lost.refund) && lost.refund !== state.mods.refund) back = lost.refund;
    if (back > 0) {
      state.trayFrac = (state.trayFrac || 0) + back;
      while (state.trayFrac >= 1) { state.trayFrac -= 1; state.tray++; }
    }
    return;
  }
  if (e.kind === 'gate') {
    state.stats.gates++;
    const gateCtx = moment(state, 'onGate', { ball: ballOf(e), payout: 0, value: 0, fever: state.fever.active });
    if (gateCtx) {
      const given = Number.isFinite(gateCtx.value) ? gateCtx.value : gateCtx.payout;
      const gatePay = Math.max(0, Math.round((Number.isFinite(given) ? given : 0) * state.mods.payMult));
      if (gatePay > 0) {
        state.tray += gatePay;
        state.won += gatePay;
        state.stats.won += gatePay;
        out.marks.push({ kind: 'pay', x: e.x, y: e.y, amount: gatePay });
      }
    }
    // Spins are whole things. A part worth a fraction of an extra spin gives
    // that fraction as a chance of one, rather than a fraction of a spin: a
    // counter holding 1.5 spins can never be run down to nothing, and a round
    // that waits for the drums to stop then waits forever.
    const per = Math.max(1, state.mods.spinsPerGate);
    let spins = Math.floor(per);
    if (state.rng.next() < per - spins) spins++;
    state.reel.queued = Math.min(8, state.reel.queued + Math.max(1, spins));
    logLine(state, 'gate', cfg.text.gateHit);
    out.marks.push({ kind: 'gate', x: e.x, y: e.y });
    // A ball through the gate is the best thing that happens on this board, so
    // it ends a run of nothing whether or not the gate itself paid anything.
    eventsOnResolve(state, 1, e.x);
    return;
  }
  const feverMult = e.kind === 'attacker' ? state.fever.mult * state.mods.feverMult : 1;
  const gateMult = e.kind === 'attacker' ? state.mods.gatePayMult : 1;
  const ball = ballOf(e);

  // Every nail this ball touched, offered to the parts that care about nails.
  // Fired here rather than inside the simulation because a moment fired for
  // every contact of every ball is thousands a second and buys nothing: an
  // effect that accumulates over a ball's contacts gives the same answer
  // accumulated at the end of them.
  if (state.bench && hasHook(state.bench, state.fittings, 'onPinHit')) {
    const hits = Math.min(e.hits || 0, 60);
    for (let h = 1; h <= hits; h++) {
      moment(state, 'onPinHit', { ball, pin: { kind: 'nail', side: h % 2 ? 'left' : 'right' }, hitIndex: h });
    }
  }

  let base = e.pay * (Number.isFinite(ball.mul) ? ball.mul : 1) + (Number.isFinite(ball.add) ? ball.add : 0);
  const pocketCtx = moment(state, 'onPocket', {
    ball, pocket: { id: e.pocket, kind: e.kind, base: e.pay },
    payout: base, value: base, fever: state.fever.active,
  });
  if (pocketCtx) {
    const given = Number.isFinite(pocketCtx.value) ? pocketCtx.value : pocketCtx.payout;
    if (Number.isFinite(given)) base = given;
  }
  // Carried as a fraction rather than rounded at each mouth. The mouths pay
  // 1, 1, 2, 2 and 6, so rounding here threw away every multiplier under about
  // a quarter: a part promising eight percent more per ball delivered exactly
  // nothing on a board where nothing pays enough for eight percent to be a
  // whole ball. The remainder is kept and paid out as soon as it adds up.
  // What the machine is doing back is applied here rather than folded into the
  // mods, so a lit stripe and a shutter are worth exactly what they say and
  // are gone the moment they end. It never lifts the wide mouth at the bottom.
  const eventMult = eventsPayMult(state, e.kind, e.x, e.y);
  const exact = Math.max(0, base * state.mods.payMult * feverMult * gateMult * eventMult);
  // A mouth an event cut into the face pays nothing but event money; a mouth
  // the cabinet was built with pays the part above what it would have paid.
  state.stats.eventBalls += isEventPocket(state, e.pocket)
    ? exact
    : exact - exact / eventMult;
  state.wonFrac = (state.wonFrac || 0) + exact;
  const pay = Math.floor(state.wonFrac);
  state.wonFrac -= pay;
  if (pay > 0) {
    state.tray += pay;
    state.won += pay;
    state.stats.won += pay;
    out.marks.push({ kind: 'pay', x: e.x, y: e.y, amount: pay });
    if (e.kind === 'attacker') state.feverWon = (state.feverWon || 0) + pay;
    state.counters.pocketsThisRound++;
    state.counters.lastPayingStrength = state.strength;
  }
  eventsOnResolve(state, exact, e.x);
  if (pay > 0) eventsOnTake(state);
}

/** How many balls a set of windows is worth, ignoring anything malformed. */
function windowBalls(list) {
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const w of list) {
    const n = Number(w && w.balls);
    if (Number.isFinite(n) && n > 0) total += Math.min(400, Math.floor(n));
  }
  return Math.min(400, total);
}

/** A ball as a part sees it, rebuilt from what the simulation reported. */
function ballOf(e) {
  return {
    mul: Number.isFinite(e.worth) ? e.worth : 1,
    add: Number.isFinite(e.add) ? e.add : 0,
    hits: e.hits || 0, tags: [], s: {},
  };
}

/** Drops a ball onto the face just above a named mouth. */
function steerTo(state, idx, want) {
  const board = state.board;
  const name = want === 'gate' ? 'gate'
    : want === 'attacker' ? 'attacker'
    : want === 'jade' ? 'jade'
    : null;
  let target = null;
  if (name) target = board.pockets.find(p => p.id === name);
  else if (want === 'cream') target = board.pockets.find(p => p.id.indexOf('cream') === 0);
  else if (want === 'side') target = board.pockets.find(p => p.id.indexOf('side') === 0);
  if (!target) return;
  const b = state.balls;
  b.state[idx] = 1;
  b.x[idx] = target.x;
  b.y[idx] = target.y - target.h * 0.5 - state.cfg.physics.ballRadius * 2.4;
  b.vx[idx] = 0;
  b.vy[idx] = state.cfg.physics.gravity * 0.05;
  b.age[idx] = 0;
}

/**
 * Everything turning right now: the centre window first, then whatever opened
 * beside it. A set that has finished and finished being read leaves the ring.
 */
function stepReels(state, dt, out) {
  const reel = state.reel;

  // Start what is owed before anything moves, so a spin bought this frame
  // turns this frame rather than a frame late.
  startSpins(state);

  stepOneReel(state, reel, dt, out);
  for (let i = reel.around.length - 1; i >= 0; i--) {
    const r = reel.around[i];
    stepOneReel(state, r, dt, out);
    if (!r.spinning && r.holdT <= 0) reel.around.splice(i, 1);
  }
}

/**
 * Hands every owed spin a set of drums. The centre window is used first
 * because it is the one the machine is built around; past that a spin opens
 * its own window rather than queueing behind the centre, which is what used to
 * leave a round paying itself out long after the last ball had dropped.
 *
 * The ring is finite, so a machine bought into spinning constantly still has a
 * bounded number of windows and the rest wait as they always did.
 */
function startSpins(state) {
  const reel = state.reel;
  const most = Math.max(0, Math.floor(state.cfg.reels.around));
  while (reel.queued > 0) {
    if (!reel.spinning && reel.holdT <= 0) {
      begin(state, reel);
    } else if (reel.around.length < most) {
      const made = { slot: freeSlot(reel, most), spinning: false, t: 0, digits: [0, 0, 0], result: null, holdT: 0 };
      reel.around.push(made);
      begin(state, made);
    } else {
      break;
    }
  }
}

function begin(state, reel) {
  state.reel.queued = Math.max(0, state.reel.queued - 1);
  reel.spinning = true;
  reel.t = 0;
  reel.result = null;
  reel.holdT = 0;
  reel.plan = planSpin(state, reel);
  state.stats.spins++;
}

/**
 * What this spin will land on, decided before the drums start coming to rest.
 *
 * The outcome used to be worked out after all three had stopped, and the faces
 * were then written over with it - so a player could watch three fives settle
 * and be shown a nine, a five and a nine instead. That is the moment they are
 * watching hardest, and it was the one moment the machine was not telling them
 * the truth.
 *
 * Deciding here means each drum comes to rest on the face it actually landed
 * on, and the last one to stop is the answer. Two sevens with the third still
 * turning is then a real near miss rather than a picture about to be replaced.
 * None of the odds move: the same draws happen, in the same numbers.
 */
function planSpin(state, reel) {
  const cfg = state.cfg;
  let matched = state.rng.next() < matchChance(state);
  let symbol = Math.floor(state.rng.next() * cfg.reels.digits);
  let feverLen = 0, feverMult = 0;

  const faces = () => {
    if (matched) return [symbol, symbol, symbol];
    // A miss is drawn honestly and shown exactly as it fell. Three of a kind
    // would be a match, so it is redrawn rather than dressed up as one.
    const d = [0, 0, 0];
    do {
      for (let i = 0; i < 3; i++) d[i] = Math.floor(state.rng.next() * cfg.reels.digits);
    } while (d[0] === d[1] && d[1] === d[2]);
    return d;
  };
  let digits = faces();

  // One face on the strip is the seven, the way a cabinet has one. It is named
  // rather than numbered so a part can ask for it by name, which is how the
  // catalogue is written.
  const named = (d) => (d === cfg.reels.sevenDigit ? 'seven' : d);
  const before = matched;
  const spinCtx = moment(state, 'onReelSpin', {
    spin: {
      reels: [digits[0], digits[1], digits[2]],
      reach: !matched, reachSymbol: named(symbol), matched, symbol: named(symbol),
      respins: 0, respin: false, feverLen: 0, feverMult: 0,
    },
  });
  if (spinCtx) {
    const sp = spinCtx.spin;
    if (typeof sp.matched === 'boolean') matched = sp.matched;
    if (sp.symbol === 'seven') symbol = cfg.reels.sevenDigit;
    else if (Number.isFinite(sp.symbol)) symbol = Math.max(0, Math.floor(sp.symbol)) % cfg.reels.digits;
    if (Number.isFinite(sp.feverLen) && sp.feverLen > 0) feverLen = sp.feverLen;
    if (Number.isFinite(sp.feverMult) && sp.feverMult > 0) feverMult = sp.feverMult;
    // A part may buy one more turn of the reels, and exactly one, so no
    // arrangement of parts can leave the drums turning forever.
    if (sp.respin) { state.reel.queued = Math.min(8, state.reel.queued + 1); }
    // A part that changed the answer changes the faces with it, before any of
    // them has been shown.
    if (matched !== before || matched) digits = faces();
  }

  const two = digits[0] === digits[1] || digits[1] === digits[2] || digits[0] === digits[2];
  return { digits, matched, result: matched ? 'match' : (two ? 'near' : 'miss'), feverLen, feverMult };
}

/** The lowest ring position nothing is using, so the pattern fills in evenly. */
function freeSlot(reel, most) {
  for (let s = 1; s <= most; s++) {
    let taken = false;
    for (const r of reel.around) if (r.slot === s) { taken = true; break; }
    if (!taken) return s;
  }
  return 1;
}

/** One turn of one set of drums, wherever on the face it is. */
function stepOneReel(state, reel, dt, out) {
  const cfg = state.cfg;

  if (reel.holdT > 0) {
    reel.holdT -= dt;
    if (reel.holdT <= 0) { reel.result = null; reel.holdT = 0; }
  }
  if (!reel.spinning) return;
  // A spin restored from a save has no plan behind it, so it gets one rather
  // than settling onto nothing.
  if (!reel.plan) reel.plan = planSpin(state, reel);

  reel.t += dt;
  const spin = cfg.reels.spinSeconds;
  for (let i = 0; i < 3; i++) {
    const settle = spin * (0.55 + i * 0.2);
    // Still turning: the face is a blur, which is the honest way to show that
    // this drum has not decided yet. Stopped: the face it landed on, and it
    // does not change again.
    reel.digits[i] = reel.t < settle
      ? Math.floor(state.rng.next() * cfg.reels.digits)
      : reel.plan.digits[i];
  }
  if (reel.t < spin) return;

  reel.spinning = false;
  reel.holdT = cfg.reels.holdSeconds;
  reel.result = reel.plan.result;
  if (reel.plan.matched) {
    startFever(state, out, reel.plan.feverLen, reel.plan.feverMult, reel.plan.digits[0]);
  } else if (reel.plan.result === 'near') {
    logLine(state, 'reel', cfg.text.reelMiss);
    // Two of the three agreeing is the moment a player is watching hardest,
    // and it happens on about a quarter of spins. The machine answers it.
    eventsOnReels(state, 'near');
  }
  reel.plan = null;
}

/** The chance the reels agree, as the plaque advertises it. */
export function matchChance(state) {
  return Math.min(0.95, state.cfg.reels.matchChance + state.mods.matchBonus);
}

/** The chance a fever runs straight into another, as the plaque advertises it. */
export function continueChance(state) {
  return Math.min(0.95, state.cfg.fever.continueChance + state.mods.continueBonus);
}

/**
 * Opens a fever. `symbol` is the face the drums agreed on, and it is passed in
 * rather than read off the centre window, because the set that matched may be
 * one of the windows turning beside it.
 */
export function startFever(state, out, lenOverride, multOverride, symbol) {
  const cfg = state.cfg;
  const f = state.fever;
  const chaining = f.active;
  f.active = true;
  const face = Number.isFinite(symbol) ? symbol : state.reel.digits[0];
  const fev = { balls: Math.max(1, cfg.fever.balls + state.mods.feverBalls), mult: 1, symbol: face, seven: false, openings: [] };
  const before = f.ballsLeft;
  if (Number.isFinite(lenOverride) && lenOverride > 0) fev.balls = lenOverride;
  if (Number.isFinite(multOverride) && multOverride > 0) fev.mult = multOverride;
  moment(state, 'onFeverStart', { fever: fev });
  f.ballsLeft = Math.max(1, Math.round(fev.balls));
  f.chain = chaining ? f.chain + 1 : 1;
  f.spent = 0;
  f.mult = Number.isFinite(fev.mult) && fev.mult > 0 ? fev.mult : 1;
  // A part may buy extra balls of an open attacker on top of the fever itself.
  // The attacker is a flap: the only thing a window can mean physically is
  // that it stays open longer, so that is what it means.
  f.ballsLeft += windowBalls(fev.openings);
  state.counters.feversThisRound++;
  f.t = 0;
  state.feverWon = 0;
  openAttacker(state);
  state.stats.fevers++;
  if (chaining) state.stats.chains++;
  logLine(state, 'fever', cfg.text.feverOn.replace('{n}', String(f.ballsLeft)));
  if (out) out.marks.push({ kind: 'fever', x: state.board.w * 0.5, y: state.board.h * 0.5 });
}

export function endFever(state) {
  const cfg = state.cfg;
  const f = state.fever;
  if (state.feverWon > state.stats.bestFever) state.stats.bestFever = state.feverWon;
  const endCtx = moment(state, 'onFeverEnd', { fever: { ballsPaid: state.feverWon || 0, totalPaid: state.stats.won }, after: [] });
  // Windows the fever leaves behind it: the flap does not slam the instant the
  // lamp cools, it stays open for a few more balls.
  const trailing = endCtx ? windowBalls(endCtx.after) : 0;
  if (trailing > 0) {
    f.ballsLeft = trailing;
    f.mult = 1;
    logLine(state, 'fever', 'The attacker is still open for ' + trailing + '.');
    return;
  }
  if (state.rng.next() < continueChance(state)) {
    startFever(state, null);
    return;
  }
  f.active = false;
  f.ballsLeft = 0;
  f.chain = 0;
  closeAttacker(state);
  logLine(state, 'fever', cfg.text.feverOff);
  // The wide mouth shutting is a moment on its own, and the machine answers it
  // so that the end of a good spell is not simply the board going quiet.
  eventsOnWideShut(state);
}

function checkRoundEnd(state) {
  if (state.phase === PHASE_SETTLE) {
    // Waiting for the face to clear. Whatever is still falling still counts.
    // Every one of these is a "nothing is still happening" test, so every one
    // of them is written as at-or-below rather than exactly-equal. A counter
    // that drifts past zero must still read as finished.
    if (state.balls.n <= 0 && state.reel.queued <= 0 && !state.reel.spinning && state.reel.holdT <= 0
        && state.reel.around.length <= 0) {
      state.phase = state.won >= state.quota ? PHASE_SHOP : PHASE_OVER;
      // The face goes back to the way the cabinet was built before anybody is
      // allowed near it with a hammer. Setting nails around a shutter that is
      // about to swing back in would be setting them against a board that does
      // not exist.
      resetEvents(state);
      if (state.phase === PHASE_OVER) {
        state.over = true;
        logLine(state, 'lost', state.cfg.text.roundLost.replace('{short}', String(state.quota - state.won)));
      }
    }
    return;
  }
  if (state.phase !== PHASE_PLAY) return;
  if (state.won >= state.quota) {
    state.phase = PHASE_SETTLE;
    if (state.round > state.stats.bestRound) state.stats.bestRound = state.round;
    // Clearing pays, and it pays more the sooner it happens, because what is
    // left of the rented budget is never spent.
    let bonus = clearBonusFor(state.cfg, state.round, state.mods);
    // `value` is where a returned number lands. A part may either write the
    // bonus in place or return a new one, and both have to work, because the
    // catalogue does both.
    const endCtx = moment(state, 'onRoundEnd', {
      round: { n: state.round, budget: state.budget, quota: state.quota, launches: state.launched, paid: state.won },
      cleared: true, bonus, value: bonus, tray: { balls: state.tray },
    });
    if (endCtx) {
      const given = endCtx.value !== bonus ? endCtx.value : endCtx.bonus;
      if (Number.isFinite(given) && given >= 0) bonus = Math.round(given);
    }
    state.tray += bonus;
    state.stats.bonuses = (state.stats.bonuses || 0) + bonus;
    logLine(state, 'won', state.cfg.text.roundWon.replace('{n}', String(state.round))
      + ' The counter pays ' + bonus + ' balls.');
    return;
  }
  // A round is only lost once the tray is empty AND the face is clear, so a
  // ball still falling can still be the one that clears the round.
  // Out of launches. The face still has to clear, and a ball still falling can
  // still be the one that clears the round.
  if (launchesLeft(state) <= 0) state.phase = PHASE_SETTLE;
}

/** Which column of the landing count a point on the face belongs to. */
export function landingColumn(board, x) {
  const c = Math.floor(x / board.w * LANDING_COLUMNS);
  // A comparison against a number that is not one is false both ways, so a
  // two sided clamp lets it through and the count is written to an index that
  // silently discards it. The chart is what a player reads before leaning a
  // nail, so a ball missing from it is worse than a ball in the wrong column.
  if (Number.isNaN(c)) return 0;
  if (c < 0) return 0;
  if (c >= LANDING_COLUMNS) return LANDING_COLUMNS - 1;
  return c;
}

/** A fresh output collector. Reused every frame so a frame allocates nothing. */
export function createOut() {
  return { events: [], flashes: [], marks: [], flashCap: 48 };
}
