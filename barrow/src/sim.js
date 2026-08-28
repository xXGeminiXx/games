// ---------------------------------------------------------------------------
// The simulation: one state, one step, and the actions a player can take.
//
// Everything the game is lives in `state`, a plain object a save can hold.
// The markets are kept beside it (their swell is regenerated from the seed;
// only their pressure and chart survive a save). A step is dt seconds of the
// horde digging, the markets recovering, the broker selling, and the reveal
// flags catching up. The step size is free: every rate is continuous and the
// recovery is closed form, so a second stepped once and a second stepped ten
// times land in the same place. That is what lets the time away be caught up
// in coarse chunks.
//
// Events come back from every step and action as plain records the page turns
// into log lines. The simulation never touches the page.
// ---------------------------------------------------------------------------

import { CONFIG as DEFAULT } from '../config.js?v=1';
import * as Mat from './materials.js?v=1';
import * as Mk from './market.js?v=1';
import * as H from './horde.js?v=1';
import * as R from './rites.js?v=1';
import * as Rv from './reveal.js?v=1';

export const SAVE_VERSION = 1;

export function freshState(cfg, seed) {
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    t: 0,                 // simulation seconds since the run began
    coin: 0,
    bones: 0,
    horde: 0,
    depth: 0,             // deepest open stratum
    weights: [cfg.horde.weightNew],
    faceWeight: 0,        // set when the face is first shown
    capProgress: 0,
    stock: {},            // good id -> units held
    seen: {},             // good id -> true once its market has been on the table
    rites: {},            // rite id -> level
    hand: { digs: 0 },
    effort: [],           // digger-seconds spent per stratum, for the drawing
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
      m = Mk.createMarket({
        id, seed: state.seed, base: Mat.valueAt(k, cfg.strata), absorb: Mat.absorbAt(k, cfg.market),
        recovery: cfg.market.recoverySeconds, cycle: cfg.market.cycle,
      });
    }
    markets.set(id, m);
    return m;
  };

  const mods = () => R.modsOf(state, cfg);

  const held = (id) => (id === Mat.BONES ? state.bones : (state.stock[id] || 0));
  const take = (id, q) => {
    if (id === Mat.BONES) state.bones = Math.max(0, state.bones - q);
    else state.stock[id] = Math.max(0, (state.stock[id] || 0) - q);
  };

  /** Every good whose market row is on the table, in stratum order, bones last. */
  const goods = () => {
    const ids = Object.keys(state.stock)
      .filter(id => Rv.marketVisible(state, id))
      .sort((a, b) => Mat.strataOf(a) - Mat.strataOf(b));
    if (Rv.marketVisible(state, Mat.BONES)) ids.push(Mat.BONES);
    return ids;
  };

  const earn = (coin) => {
    state.coin += coin;
    state.totals.earned += coin;
    const inc = state.income;
    inc.push([state.t, coin]);
  };

  const fire = (events, key, values) => {
    if (state.fired[key]) return;
    state.fired[key] = true;
    events.push({ type: 'log', key, values: values || null });
  };

  const announce = (events, fresh) => {
    for (const flag of fresh) {
      const key = Rv.ANNOUNCE[flag];
      if (key) fire(events, key);
    }
  };

  const milestones = (events) => {
    const hm = cfg.text.log.hordeMilestones;
    while (state.milestones.horde < hm.length && state.horde >= hm[state.milestones.horde][0]) {
      events.push({ type: 'log', text: hm[state.milestones.horde][1] });
      state.milestones.horde += 1;
    }
    const dm = cfg.text.log.depthMilestones;
    while (state.milestones.depth < dm.length && state.depth >= dm[state.milestones.depth][0]) {
      events.push({ type: 'log', text: dm[state.milestones.depth][1] });
      state.milestones.depth += 1;
    }
  };

  const noteSeen = (events) => {
    for (const id of Object.keys(state.stock)) {
      if (!state.seen[id] && state.stock[id] > 1e-9) {
        state.seen[id] = true;
        marketFor(id);
        const k = Mat.strataOf(id);
        if (k > 0) fire(events, 'newMarket:' + id, { name: Mat.goodAt(k, cfg.strata).name, _line: 'newMarket' });
      }
    }
    if (!state.seen[Mat.BONES] && state.bones > 1e-9) {
      state.seen[Mat.BONES] = true;
      marketFor(Mat.BONES);
    }
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

  const brokerStep = (dt, md) => {
    const b = md.broker;
    if (!b) return;
    const shareNow = 1 - Math.pow(1 - b.share, dt);
    for (const id of goods()) {
      const units = held(id);
      if (!(units > 1e-9)) continue;
      const m = marketFor(id);
      if (b.patient && Mk.priceAt(m, state.t) < m.base) continue;
      const q = units * shareNow;
      const revenue = Mk.sell(m, q, state.t, md) * (1 - b.fee);
      take(id, q);
      state.totals.sold += q;
      earn(revenue);
    }
  };

  /** One step of dt seconds. Returns the events it produced. */
  const step = (dt) => {
    const events = [];
    if (!(dt > 0)) return events;
    const md = mods();
    const before = Math.floor(state.t / cfg.market.sampleSeconds);

    const opened = H.dig(state, dt, cfg, md);
    for (const k of opened) {
      const g = Mat.goodAt(k, cfg.strata);
      events.push({ type: 'opened', k });
      fire(events, 'breakthrough:' + k, { name: g.name, _line: 'breakthrough' });
    }

    for (const m of markets.values()) Mk.relax(m, dt, md);
    brokerStep(dt, md);

    state.t += dt;
    trimIncome();

    const after = Math.floor(state.t / cfg.market.sampleSeconds);
    if (after !== before) {
      const keep = md.ledger ? cfg.market.historyLedger : cfg.market.history;
      for (const m of markets.values()) Mk.sample(m, state.t, keep);
    }

    noteSeen(events);
    announce(events, Rv.update(state, cfg));
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
    const max = cfg.time.offlineMaxHours * 3600;
    const capped = away && seconds > max;
    const total = capped ? max : seconds;
    const chunk = away ? cfg.time.offlineStep : cfg.time.tick;
    const startCoin = state.coin, startBones = state.bones, startStock = Object.assign({}, state.stock);
    const startDepth = state.depth;
    let left = total;
    let guard = 0;
    while (left > 1e-9 && guard++ < 2e6) {
      const dt = Math.min(chunk, left);
      for (const e of step(dt)) events.push(e);
      left -= dt;
    }
    const gained = { coin: state.coin - startCoin, bones: state.bones - startBones, stock: {}, strata: state.depth - startDepth };
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
    H.yieldUnits(state, 0, cfg.hand.units, cfg, true);
    if (state.hand.digs === cfg.hand.firstBoneAt) {
      state.bones += 1;
      fire(events, 'firstBone');
    } else if (state.hand.digs > cfg.hand.firstBoneAt && cfg.hand.bonesPerDig > 0) {
      state.bones += cfg.hand.bonesPerDig;
    }
    fire(events, 'firstDig');
    noteSeen(events);
    announce(events, Rv.update(state, cfg));
    return events;
  };

  const sell = (id, q) => {
    const events = [];
    const have = held(id);
    q = Math.min(q, have);
    if (!(q > 1e-12)) return { events, coin: 0 };
    const md = mods();
    const m = marketFor(id);
    const revenue = Mk.sell(m, q, state.t, md);
    take(id, q);
    state.totals.sold += q;
    earn(revenue);
    fire(events, 'firstSale');
    if (Mk.demandOf(m) < cfg.market.buckleBelow) {
      const k = Mat.strataOf(id);
      const name = k >= 0 ? Mat.goodAt(k, cfg.strata).name : Mat.BONES;
      if (!state.fired.buckled) state.totals.buckled += 1;
      fire(events, 'buckled', { name });
    }
    announce(events, Rv.update(state, cfg));
    return { events, coin: revenue };
  };

  const sellShare = (id, share) => sell(id, held(id) * share);

  /** Sell one lot: about what the market absorbs before it buckles. */
  const sellLot = (id) => {
    const { absorb } = Mk.effective(marketFor(id), mods());
    return sell(id, Math.min(held(id), absorb * cfg.market.lotShare));
  };

  /** Buy with up to `coin` coin (default: one buyShare of what the market absorbs). */
  const buy = (id, coinLimit) => {
    const events = [];
    if (!mods().ledger) return { events, units: 0, coin: 0 };
    const md = mods();
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
    state.coin -= paid;
    if (state.coin < 0) state.coin = 0;
    if (id === Mat.BONES) state.bones += q; else state.stock[id] = (state.stock[id] || 0) + q;
    return { events, units: q, coin: paid };
  };

  const raise = (count) => {
    const events = [];
    const md = mods();
    const n = H.raise(state, count, cfg.horde, md.softMult);
    if (n > 0) {
      fire(events, 'firstRaise');
      announce(events, Rv.update(state, cfg));
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
    if (k < H.activeFrom(state.depth, cfg.horde) || k > state.depth) return 0;
    while (state.weights.length <= k) state.weights.push(0);
    state.weights[k] = Math.max(0, Math.min(max, (state.weights[k] | 0) + delta));
    return state.weights[k];
  };

  const buyRite = (id) => {
    const events = [];
    const level = R.buy(state, id, cfg);
    if (level > 0) {
      events.push({ type: 'rite', id, level });
      announce(events, Rv.update(state, cfg));
    }
    return { events, level };
  };

  // -- persistence --------------------------------------------------------

  const snapshot = () => ({
    state: JSON.parse(JSON.stringify(state)),
    markets: Array.from(markets.values()).map(Mk.snapshotMarket),
  });

  const sim = {
    cfg, state, markets, marketFor, mods, goods, held,
    step, advance, dig, sell, sellShare, sellLot, buy, raise, setWeight, buyRite, snapshot,
    price: (id) => Mk.priceAt(marketFor(id), state.t),
    quote: (id, q) => Mk.quote(marketFor(id), q, state.t, mods()),
    /** Steady flow of a good in units per second from the horde as set. */
    flowOf: (id) => {
      const md = mods();
      const from = H.activeFrom(state.depth, cfg.horde);
      const split = H.distribute(state.weights, state.faceWeight, from);
      const perSec = state.horde * cfg.horde.digRate * md.digMult;
      let q = 0;
      for (let k = from; k <= state.depth; k++) {
        const share = split.strata[k] || 0;
        if (share <= 0) continue;
        const units = perSec * share / Mat.hardnessAt(k, cfg.strata);
        for (const part of Mat.mixAt(k, cfg.strata)) if ('s' + part.k === id) q += units * part.share;
      }
      if (id === Mat.BONES) q = state.horde * cfg.horde.digRate * cfg.horde.boneShare;
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
  for (const key of ['coin', 'bones', 'horde', 'depth', 'capProgress', 'faceWeight', 't', 'rate']) {
    if (!Number.isFinite(state[key])) state[key] = defaults[key];
  }
  for (const key of Object.keys(state.totals)) if (!Number.isFinite(state.totals[key])) state.totals[key] = 0;
  if (!Array.isArray(state.weights)) state.weights = [cfg.horde.weightNew];
  while (state.weights.length <= state.depth) state.weights.push(0);
  if (!Array.isArray(state.income)) state.income = [];
  if (!Array.isArray(state.effort)) state.effort = [];
  if (!Array.isArray(state.log)) state.log = [];
  for (const k of ['stock', 'seen', 'rites', 'flags', 'fired']) {
    if (!state[k] || typeof state[k] !== 'object') state[k] = {};
  }
  return createSim(cfg, { state, snapshot: snap });
}
