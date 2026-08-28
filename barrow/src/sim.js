// ---------------------------------------------------------------------------
// The simulation: one state, one step, and the actions a player can take.
//
// Everything one barrow is lives in `state`, a plain object a save can hold.
// What carries between barrows lives in `legacy`, which the simulation reads
// and never writes except when a run is sealed. The markets are kept beside
// the state (their swell is regenerated from the seed; only their pressure
// and chart survive a save).
//
// A step is dt seconds of the horde digging, the markets recovering, the
// factor selling, the gate being watched and the reveal flags catching up.
// The step size is free: every rate is continuous and the recovery is closed
// form, so a second stepped once and a second stepped ten times land in the
// same place. That is what lets the time away be caught up in coarse chunks.
//
// Events come back from every step and action as plain records carrying the
// line they want said. The simulation never touches the page.
// ---------------------------------------------------------------------------

import { CONFIG as DEFAULT } from '../config.js?v=3';
import * as Mat from './materials.js?v=3';
import * as Mk from './market.js?v=3';
import * as H from './horde.js?v=3';
import * as R from './rites.js?v=3';
import * as Rv from './reveal.js?v=3';
import * as Ch from './chambers.js?v=3';
import * as Vi from './visitors.js?v=3';
import * as Rb from './rebirth.js?v=3';
import * as Lore from './lore.js?v=3';
import { createGround } from './ground.js?v=3';

export const SAVE_VERSION = 2;

export function freshState(cfg, seed) {
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    t: 0,                 // simulation seconds since this barrow was opened
    coin: 0,
    bones: 0,
    horde: 0,
    depth: 0,             // deepest open layer
    weights: [cfg.horde.weightNew],
    faceWeight: 0,        // set when the face is first shown
    capProgress: 0,
    stock: {},            // good id -> units held
    seen: {},             // good id -> true once its market has been on the table
    rites: {},            // rite id -> level
    boons: {},            // standing multipliers taken in chambers and bought
    read: {},             // layer -> true once its seam is known before opening
    chamber: null,        // the room waiting to be answered
    chambersDone: {},     // layer -> the offer taken there
    chamberQueue: [],     // rooms found while an earlier one was unanswered
    visitor: null,        // who is at the gate
    visitNext: null,      // when the next one comes
    visitCount: 0,
    visitorsSeen: 0, visitorsTaken: 0, visitorsMissed: 0,
    visitorsBought: {},   // kind -> how many of it this barrow has taken
    remBonus: 0,          // remembrance promised by chambers
    hand: { digs: 0 },
    effort: [],           // digger-seconds spent per layer, for the drawing
    flags: {},            // reveal flags, monotonic
    fired: {},            // log lines that have gone out, once each
    milestones: { horde: 0, depth: 0 },
    totals: { dug: 0, raised: 0, sold: 0, earned: 0, spent: 0, buckled: 0 },
    income: [],           // [t, coin] samples for the coin/s figure
    rate: 0,
    log: [],              // the last lines said, newest first
  };
}

export function createSim(cfg = DEFAULT, opts = {}) {
  const seed = (opts.seed === undefined ? (Math.random() * 4294967296) : opts.seed) >>> 0;
  const state = opts.state || freshState(cfg, seed);
  const legacy = opts.legacy || Rb.freshLegacy();
  const ground = createGround(cfg, state.seed);
  const markets = new Map();

  const marketFor = (id) => {
    let m = markets.get(id);
    if (m) return m;
    if (id === Mat.BONES) {
      m = Mk.createMarket({
        id, seed: state.seed, base: cfg.market.bones.base, absorb: cfg.market.bones.absorb,
        recovery: cfg.market.bones.recoverySeconds, cycle: cfg.market.cycle,
      });
    } else {
      const k = Mat.strataOf(id);
      if (k < 0) throw new Error('no such good: ' + id);
      const layer = ground.at(k);
      m = Mk.createMarket({
        id, seed: state.seed, base: layer.value, absorb: layer.absorb, amp: layer.swell,
        recovery: cfg.market.recoverySeconds, cycle: cfg.market.cycle,
      });
    }
    markets.set(id, m);
    return m;
  };

  const mods = () => R.modsOf(state, cfg, legacy);

  /** A market's base price, after any boon that lifted what everything fetches. */
  const baseOf = (id) => {
    const m = marketFor(id);
    return m.base * (id === Mat.BONES ? 1 : mods().valueMult);
  };

  const held = (id) => (id === Mat.BONES ? state.bones : (state.stock[id] || 0));
  const take = (id, q) => {
    if (id === Mat.BONES) state.bones = Math.max(0, state.bones - q);
    else state.stock[id] = Math.max(0, (state.stock[id] || 0) - q);
  };

  const activeFrom = () => H.activeFrom(state.depth, cfg.horde, mods().activeStrata);

  /** Every good whose market row is on the table, in layer order, bones last. */
  const goods = () => {
    const ids = Object.keys(state.stock)
      .filter(id => Rv.marketVisible(state, id))
      .sort((a, b) => Mat.strataOf(a) - Mat.strataOf(b));
    if (Rv.marketVisible(state, Mat.BONES)) ids.push(Mat.BONES);
    return ids;
  };

  const earn = (coin) => {
    if (!Number.isFinite(coin) || coin <= 0) return;
    state.coin += coin;
    state.totals.earned += coin;
    state.income.push([state.t, coin]);
  };

  const spend = (coin) => {
    if (!(coin > 0)) return;
    state.coin = Math.max(0, state.coin - coin);
    state.totals.spent += coin;
  };

  // -- what gets said -------------------------------------------------------

  const line = (key, values, salt) => Lore.line(state.seed, key, values, salt);

  /**
   * Say a line once and never again. `once` is what is remembered so a reload
   * does not repeat it; `key` is the pool the words came from, which is what
   * the tests read to check the order the story arrives in.
   */
  const fire = (events, once, key, values, salt) => {
    if (state.fired[once]) return;
    state.fired[once] = true;
    const text = line(key, values, salt);
    if (text) events.push({ type: 'log', key, once, text });
  };

  const announce = (events, fresh) => {
    for (const flag of fresh) {
      const key = Rv.ANNOUNCE[flag];
      if (key) fire(events, 'flag:' + flag, key);
    }
  };

  const milestones = (events) => {
    const hm = Lore.CONTENT.log.hordeMilestones;
    while (state.milestones.horde < hm.length && state.horde >= hm[state.milestones.horde][0]) {
      events.push({ type: 'log', key: 'hordeMilestone', text: hm[state.milestones.horde][1] });
      state.milestones.horde += 1;
    }
    const dm = Lore.CONTENT.log.depthMilestones;
    while (state.milestones.depth < dm.length && state.depth >= dm[state.milestones.depth][0]) {
      events.push({ type: 'log', key: 'depthMilestone', text: dm[state.milestones.depth][1] });
      state.milestones.depth += 1;
    }
  };

  const noteSeen = (events) => {
    for (const id of Object.keys(state.stock)) {
      if (!state.seen[id] && state.stock[id] > 1e-9) {
        state.seen[id] = true;
        marketFor(id);
        const k = Mat.strataOf(id);
        if (k > 0) fire(events, 'market:' + id, 'newMarket', { name: ground.at(k).name }, String(k));
      }
    }
    if (!state.seen[Mat.BONES] && state.bones > 1e-9) {
      state.seen[Mat.BONES] = true;
      marketFor(Mat.BONES);
    }
  };

  /** The line a newly opened layer says about the ground it turned out to be. */
  const seamLine = (events, k) => {
    const layer = ground.at(k);
    if (!layer.seam) return;
    const words = Lore.seam(layer.seam.id);
    if (!words) return;
    if (state.fired['seam:' + k]) return;
    fire(events, 'seam:' + k, 'seamFound', { name: layer.name, seam: words.tag }, String(k));
    events.push({ type: 'log', key: 'seamLine', text: words.line });
  };

  const trimIncome = () => {
    const inc = state.income;
    const cut = state.t - cfg.time.incomeWindow;
    let i = 0;
    while (i < inc.length && inc[i][0] < cut) i++;
    if (i > 0) inc.splice(0, i);
    let sum = 0;
    for (const [, c] of inc) sum += c;
    const span = Math.min(cfg.time.incomeWindow, Math.max(1, state.t));
    state.rate = sum / span;
  };

  /**
   * The factor. It sells into the room each market has rather than a share of
   * what is held, so a tab left open earns close to what a market can pay and
   * the player's edge is in where the horde stands and when to sell by hand.
   * It never touches bones: the horde is raised by decision, not by a clerk.
   */
  const brokerStep = (dt, md) => {
    const b = md.broker;
    if (!b) return;
    for (const id of goods()) {
      if (id === Mat.BONES) continue;
      const units = held(id);
      if (!(units > 1e-9)) continue;
      const m = marketFor(id);
      if (b.above > 0 && Mk.cycleAt(m, state.t) < b.above) continue;
      const q = Math.min(units, Mk.bestFlow(m, md) * b.flow * dt);
      if (!(q > 1e-12)) continue;
      const revenue = Mk.sell(m, q, state.t, md) * (1 - b.fee) * md.valueMult;
      take(id, q);
      state.totals.sold += q;
      earn(revenue);
    }
  };

  /** Drop dust and the charts of markets nobody can see, so a long run stays small. */
  const tidy = () => {
    const from = activeFrom();
    for (const id of Object.keys(state.stock)) {
      const k = Mat.strataOf(id);
      if (state.stock[id] < 1e-9 && k >= 0 && k < from - 1) delete state.stock[id];
    }
    for (const m of markets.values()) {
      const k = Mat.strataOf(m.id);
      if (k >= 0 && k < from - 1 && m.history.length) m.history.length = 0;
    }
  };

  // -- chambers -------------------------------------------------------------

  const openChamber = (events, k) => {
    if (state.chambersDone[k]) return;
    const room = Ch.chamberAt(state.seed, k, cfg, ground);
    if (!room) return;
    // Only one room waits at a time; a second one found while the first is
    // unanswered is simply the one that comes after it.
    if (state.chamber) state.chamberQueue = (state.chamberQueue || []).concat(k);
    else state.chamber = room;
    events.push({ type: 'chamber', k });
    for (const l of room.lines) events.push({ type: 'log', text: l });
  };

  const nextChamber = () => {
    const queue = state.chamberQueue || [];
    while (queue.length) {
      const k = queue.shift();
      if (state.chambersDone[k]) continue;
      const room = Ch.chamberAt(state.seed, k, cfg, ground);
      if (room) { state.chamber = room; return; }
    }
    state.chamber = null;
  };

  /**
   * Pay out the parts of a boon that are not multipliers.
   *
   * The dead handed over are counted in seconds of the horde's own growth
   * rather than as a share of it. A share would multiply the horde every few
   * layers, and anything that multiplies the horde on a schedule compounds
   * with itself until the numbers stop meaning anything.
   */
  const payBoon = (out) => {
    if (out.windfall > 0) earn(state.rate * Math.min(out.windfall, cfg.chambers.windfallCap));
    if (out.diggers > 0) {
      const n = growthOver(out.diggers * cfg.chambers.diggerSeconds);
      H.raiseFree(state, Math.max(1, Math.floor(n)));
    }
    if (out.rem > 0) state.remBonus = (state.remBonus || 0) + out.rem;
  };

  /** How many the horde would raise, unaided, in `seconds` at its present rate. */
  const growthOver = (seconds) => {
    const md = mods();
    const bones = boneRate() * seconds;
    return H.maxRaisable(bones, state.horde, cfg.horde, md.softMult);
  };

  /** Bones per second the horde is turning up as it currently stands. */
  const boneRate = () => {
    const md = mods();
    const from = activeFrom();
    const split = H.distribute(state.weights, state.faceWeight, from);
    let q = 0;
    for (let k = from; k <= state.depth; k++) q += (split.strata[k] || 0) * ground.at(k).bones;
    q += split.face * ground.at(state.depth + 1).bones;
    return q * state.horde * cfg.horde.digRate * md.boneMult;
  };

  const takeOffer = (index) => {
    const events = [];
    const room = state.chamber;
    if (!room) return { events };
    const offer = room.offers[index | 0];
    if (!offer) return { events };
    payBoon(Ch.applyBoon(state, offer.boon));
    state.chambersDone[room.k] = offer.name;
    events.push({ type: 'log', text: offer.line });
    nextChamber();
    announce(events, Rv.update(state, cfg, legacy));
    milestones(events);
    return { events };
  };

  // -- visitors -------------------------------------------------------------

  /** What the gate is allowed to reach into. Nothing else is exposed to it. */
  const visitorApi = {
    state, cfg, ground,
    mods, goods, held, take, earn, spend, marketFor,
    strataOf: Mat.strataOf,
    boneRate,
    growthOver,
    addBones: (n) => { if (n > 0) state.bones += n; },
    raiseFree: (n) => H.raiseFree(state, n),
    boon: (b) => payBoon(Ch.applyBoon(state, b)),
    sting: (p) => {
      const ids = goods().filter(id => id !== Mat.BONES);
      if (!ids.length) return;
      marketFor(ids[ids.length - 1]).pressure += p;
    },
    survey: (n) => {
      const names = [];
      for (let i = 1; i <= n; i++) {
        const k = state.depth + i;
        state.read[k] = true;
        const layer = ground.at(k);
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        names.push(layer.name + (words ? ' (' + words.tag + ')' : ''));
      }
      return 'below the face: ' + names.join(', ') + '.';
    },
  };

  const acceptVisitor = () => {
    const events = [];
    const text = Vi.accept(visitorApi);
    if (text) events.push({ type: 'log', text });
    return { events };
  };

  const declineVisitor = () => {
    const events = [];
    const text = Vi.decline(visitorApi);
    if (text) events.push({ type: 'log', text });
    return { events };
  };

  // -- the step -------------------------------------------------------------

  const step = (dt) => {
    const events = [];
    if (!(dt > 0)) return events;
    const md = mods();
    const before = Math.floor(state.t / cfg.market.sampleSeconds);

    const opened = H.dig(state, dt, cfg, md, ground);
    for (const k of opened) {
      events.push({ type: 'opened', k });
      fire(events, 'break:' + k, 'breakthrough', { name: ground.at(k).name }, String(k));
      seamLine(events, k);
      openChamber(events, k);
    }

    for (const m of markets.values()) Mk.relax(m, dt, md);
    brokerStep(dt, md);

    state.t += dt;
    trimIncome();
    Vi.tick(visitorApi, events);

    const after = Math.floor(state.t / cfg.market.sampleSeconds);
    if (after !== before) {
      const keep = md.ledger ? cfg.market.historyLedger : cfg.market.history;
      const on = new Set(goods());
      for (const m of markets.values()) if (on.has(m.id)) Mk.sample(m, state.t, keep);
      if (opened.length) tidy();
    }

    noteSeen(events);
    announce(events, Rv.update(state, cfg, legacy));
    milestones(events);
    return events;
  };

  /**
   * Move the simulation `seconds` forward. Short gaps step at the live tick;
   * a long gap (a closed tab, a phone in a pocket) is stepped in coarse
   * chunks and capped, and the summary of what happened is returned with the
   * events so the page can say what the dead did while nobody watched.
   */
  const advance = (seconds) => {
    const events = [];
    if (!(seconds > 0)) return { events, elapsed: 0, capped: false, away: false };
    const away = seconds > cfg.time.catchUpAfter;
    const max = mods().offlineHours * 3600;
    const capped = away && seconds > max;
    const total = capped ? max : seconds;
    const chunk = away ? cfg.time.offlineStep : cfg.time.tick;
    const startCoin = state.coin, startBones = state.bones;
    const startDepth = state.depth, startHorde = state.horde;
    const startStock = Object.assign({}, state.stock);
    const startVisits = state.visitorsSeen || 0;
    let left = total;
    let guard = 0;
    while (left > 1e-9 && guard++ < 2e6) {
      const dt = Math.min(chunk, left);
      for (const e of step(dt)) events.push(e);
      left -= dt;
    }
    const gained = {
      coin: state.coin - startCoin,
      bones: state.bones - startBones,
      strata: state.depth - startDepth,
      horde: state.horde - startHorde,
      visits: (state.visitorsSeen || 0) - startVisits,
      stock: {},
    };
    for (const id of Object.keys(state.stock)) {
      const d = state.stock[id] - (startStock[id] || 0);
      if (d > 1e-9) gained.stock[id] = d;
    }
    return { events, elapsed: total, capped, away, gained };
  };

  // -- actions ------------------------------------------------------------

  const dig = () => {
    const events = [];
    state.hand.digs += 1;
    H.yieldUnits(state, 0, cfg.hand.units, cfg, ground, true);
    if (state.hand.digs === cfg.hand.firstBoneAt) {
      state.bones += 1;
      fire(events, 'firstBone', 'firstBone');
    } else if (state.hand.digs > cfg.hand.firstBoneAt && cfg.hand.bonesPerDig > 0) {
      state.bones += cfg.hand.bonesPerDig;
    }
    fire(events, 'firstDig', 'firstDig');
    noteSeen(events);
    announce(events, Rv.update(state, cfg, legacy));
    return events;
  };

  const sell = (id, q) => {
    const events = [];
    const have = held(id);
    q = Math.min(q, have);
    if (!(q > 1e-12)) return { events, coin: 0 };
    const md = mods();
    const m = marketFor(id);
    const revenue = Mk.sell(m, q, state.t, md) * (id === Mat.BONES ? 1 : md.valueMult);
    take(id, q);
    state.totals.sold += q;
    earn(revenue);
    fire(events, 'firstSale', 'firstSale');
    if (Mk.demandOf(m) < cfg.market.buckleBelow) {
      const k = Mat.strataOf(id);
      const name = k >= 0 ? ground.at(k).name : cfg.text.stats.bones;
      if (!state.fired.buckled) state.totals.buckled += 1;
      fire(events, 'buckled', 'buckled', { name });
    }
    announce(events, Rv.update(state, cfg, legacy));
    return { events, coin: revenue };
  };

  const sellShare = (id, share) => sell(id, held(id) * share);

  /** Sell one lot: about what the market takes before it buckles. */
  const sellLot = (id) => {
    const { absorb } = Mk.effective(marketFor(id), mods());
    return sell(id, Math.min(held(id), absorb * cfg.market.lotShare));
  };

  /** Buy with up to `coin` coin (default: one buyShare of what the market holds). */
  const buy = (id, coinLimit) => {
    const events = [];
    const md = mods();
    if (!md.ledger) return { events, units: 0, coin: 0 };
    const m = marketFor(id);
    const { absorb } = Mk.effective(m, md);
    let q = absorb * cfg.market.buyShare;
    const budget = Math.min(state.coin, coinLimit === undefined ? Infinity : coinLimit);
    const cost = Mk.quoteBuy(m, q, state.t, md);
    if (cost > budget) {
      const head = Mk.priceAt(m, state.t);
      q = absorb * Math.log(1 + budget / (head * absorb));
    }
    if (!(q > 1e-12)) return { events, units: 0, coin: 0 };
    const paid = Mk.buy(m, q, state.t, md);
    spend(paid);
    if (id === Mat.BONES) state.bones += q; else state.stock[id] = (state.stock[id] || 0) + q;
    return { events, units: q, coin: paid };
  };

  const raise = (count) => {
    const events = [];
    const md = mods();
    const n = H.raise(state, count, cfg.horde, md.softMult);
    if (n > 0) {
      fire(events, 'firstRaise', 'firstRaise');
      announce(events, Rv.update(state, cfg, legacy));
      milestones(events);
    }
    return { events, raised: n };
  };

  const setWeight = (target, delta) => {
    const max = cfg.horde.maxWeight;
    if (target === 'face') {
      state.faceWeight = Math.max(0, Math.min(max, (state.faceWeight | 0) + delta));
      return state.faceWeight;
    }
    const k = target | 0;
    if (k < activeFrom() || k > state.depth) return 0;
    while (state.weights.length <= k) state.weights.push(0);
    state.weights[k] = Math.max(0, Math.min(max, (state.weights[k] | 0) + delta));
    return state.weights[k];
  };

  const buyRite = (id) => {
    const events = [];
    const level = R.buy(state, id, cfg);
    if (level > 0) {
      events.push({ type: 'rite', id, level });
      announce(events, Rv.update(state, cfg, legacy));
    }
    return { events, level };
  };

  // -- persistence --------------------------------------------------------

  const snapshot = () => ({
    state: JSON.parse(JSON.stringify(state)),
    markets: Array.from(markets.values()).map(Mk.snapshotMarket),
    legacy: JSON.parse(JSON.stringify(legacy)),
  });

  const sim = {
    cfg, state, legacy, ground, markets, marketFor, mods, goods, held, baseOf, activeFrom,
    step, advance, dig, sell, sellShare, sellLot, buy, raise, setWeight, buyRite, snapshot,
    takeOffer, acceptVisitor, declineVisitor,
    visitorReady: () => Vi.affordable(visitorApi, state.visitor),
    sealYield: () => Rb.yieldOf(state, cfg),
    canSeal: () => Rb.canSeal(state, cfg),
    price: (id) => Mk.priceAt(marketFor(id), state.t) * (id === Mat.BONES ? 1 : mods().valueMult),
    quote: (id, q) => Mk.quote(marketFor(id), q, state.t, mods()) * (id === Mat.BONES ? 1 : mods().valueMult),
    /** Steady flow of a good in units per second from the horde as it is set. */
    flowOf: (id) => {
      const md = mods();
      const from = activeFrom();
      const split = H.distribute(state.weights, state.faceWeight, from);
      const perSec = state.horde * cfg.horde.digRate * md.digMult;
      let q = 0;
      for (let k = from; k <= state.depth; k++) {
        const share = split.strata[k] || 0;
        if (share <= 0) continue;
        const units = perSec * share / ground.at(k).hardness;
        for (const part of ground.mixAt(k)) if ('s' + part.k === id) q += units * part.share;
      }
      if (id === Mat.BONES) q = boneRate();
      return q;
    },
  };

  if (opts.snapshot) {
    for (const ms of opts.snapshot.markets || []) {
      try { Mk.restoreMarket(marketFor(ms.id), ms); } catch (e) { /* an unknown good is dropped */ }
    }
  }
  return sim;
}

/** Rebuild a simulation from a snapshot, refusing one from a newer build. */
export function restoreSim(cfg, snap) {
  if (!snap || !snap.state || typeof snap.state !== 'object') return null;
  const st = snap.state;
  if (st.v !== SAVE_VERSION) return null;
  const fresh = freshState(cfg, st.seed | 0);
  const defaults = freshState(cfg, st.seed | 0);
  // Every field the save carries lands on a fresh state, so a save that
  // predates a field still has that field's default, and a field that is not
  // a number any more goes back to its default rather than poisoning the run.
  const state = Object.assign(fresh, st);
  state.totals = Object.assign(defaults.totals, st.totals || {});
  state.milestones = Object.assign(defaults.milestones, st.milestones || {});
  state.hand = Object.assign(defaults.hand, st.hand || {});
  for (const key of ['coin', 'bones', 'horde', 'depth', 'capProgress', 'faceWeight', 't', 'rate', 'visitCount', 'remBonus']) {
    if (!Number.isFinite(state[key])) state[key] = defaults[key];
  }
  for (const key of Object.keys(state.totals)) if (!Number.isFinite(state.totals[key])) state.totals[key] = 0;
  if (!Array.isArray(state.weights)) state.weights = [cfg.horde.weightNew];
  while (state.weights.length <= state.depth) state.weights.push(0);
  if (!Array.isArray(state.income)) state.income = [];
  if (!Array.isArray(state.effort)) state.effort = [];
  if (!Array.isArray(state.log)) state.log = [];
  if (!Array.isArray(state.chamberQueue)) state.chamberQueue = [];
  for (const k of ['stock', 'seen', 'rites', 'flags', 'fired', 'boons', 'read', 'chambersDone', 'visitorsBought']) {
    if (!state[k] || typeof state[k] !== 'object') state[k] = {};
  }
  if (state.visitor && typeof state.visitor !== 'object') state.visitor = null;
  const legacy = Rb.restoreLegacy(snap.legacy);
  return createSim(cfg, { state, legacy, snapshot: snap });
}

/**
 * The state a fresh barrow begins with once the oaths have had their say: a
 * horde already standing, layers already open, coin in the purse and the
 * rites the books remember already held.
 */
export function openedState(cfg, legacy, seed, lines) {
  const state = freshState(cfg, seed);
  const o = Rb.oathMods(legacy, cfg);
  const ground = createGround(cfg, state.seed);
  if (lines) state.log = lines.slice(0, 14);

  for (const id of o.startRites) state.rites[id] = 1;
  if (o.startCoin > 0) state.coin = o.startCoin;

  const depth = Math.max(0, Math.min(o.startDepth, 40));
  for (let k = 0; k <= depth; k++) {
    if (k > state.depth) state.depth = k;
    while (state.weights.length <= k) state.weights.push(0);
    state.weights[k] = cfg.horde.weightNew;
    // Enough of each good to put its market on the table, and enough effort
    // spent for the drawing to show the tunnels that were supposedly cut.
    state.stock['s' + k] = ground.at(k).absorb * 0.05;
    state.seen['s' + k] = true;
    state.effort[k] = ground.at(k).cap * ground.at(k).hardness;
  }
  if (o.startHorde > 0) {
    state.horde = o.startHorde;
    state.bones = 0;
    state.faceWeight = cfg.horde.weightFace;
  }
  Rv.update(state, cfg, legacy);
  return state;
}
