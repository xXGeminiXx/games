// ---------------------------------------------------------------------------
// The simulation: one state, one step, and the actions a player can take.
//
// Everything one organism is lives in `state`, a plain object a save can
// hold. What carries between organisms lives in `genome`, which the
// simulation reads and never writes except when the organism fruits. The
// ground is regenerated from the seed and the level, so the state only has to
// remember which nodes have been reached and what has happened to them.
//
// A step is dt seconds of the tips foraging, the wood being eaten, the soil
// giving up minerals, the trees trading, growing, being drained, and the
// year turning. Every rate is continuous and the tips move by distance
// budget, so a second stepped once and a second stepped ten times land
// within a hair of each other (a tip waiting behind another's claim waits
// the whole step, which is the hair). That is what lets time away be caught
// up in coarse chunks.
//
// Events come back from every step and action as plain records naming the
// line they want said. The simulation never touches the page.
// ---------------------------------------------------------------------------

import { CONFIG as DEFAULT } from '../config.js?v=14';
import { buildLevel, nearestOpen } from './world.js?v=14';
import * as Tips from './tips.js?v=14';
import * as Trees from './trees.js?v=14';
import * as Tr from './traits.js?v=14';
import * as Lv from './levels.js?v=14';
import * as Sp from './spores.js?v=14';
import * as Rv from './reveal.js?v=14';
import * as Ev from './events.js?v=14';
import { seasonOf, AUTUMN, WINTER } from './season.js?v=14';
import { hash } from './rng.js?v=14';
import * as Lore from './lore.js?v=14';
import { fmtArea, fmtCoin } from './numbers.js?v=14';

export const SAVE_VERSION = 1;

/**
 * The instinct book: which habits are acted on, the share of the sugar they
 * are not allowed to touch, when they last decided anything, and when each
 * one last did something. Going beyond starts switched off even once it is
 * learned, because it ends a level and that is the player's to end.
 */
export function freshInstinct(cfg) {
  const list = cfg.instinct.reserves;
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(cfg.instinct.reserveDefault)));
  return { extend: true, tips: true, beyond: false, reserve: list[i], at: 0, acted: {} };
}

export function freshState(cfg, seed) {
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    t: 0,                  // simulation seconds since the spore landed
    level: 0,
    sugar: 0,
    ring: 1,               // rings of reach open on this level
    tips: [],              // the moving bodies: { x, y, from, to }, at most cfg.tips.bodies
    aim: null,             // where the front has been sent, in cells: { x, y }
    tipCount: 0,           // how many tips there are; the bodies stand for them
    tipsBought: 0,         // ever, for the price
    relocations: 0,        // a counter the tips hash their moves from
    reached: [0],          // node ids on this level, in the order reached
    threads: [],           // [from, to] pairs, for the drawing
    wood: {},              // node id -> sugar left in it
    trees: {},             // node id -> { sp, s, h, dead, wood, regrow }
    weights: {},           // kind -> share of the mineral flow
    harvest: {},           // kind -> 0 keep, 1 fell mature, 2 fell all
    nurture: {},           // kind -> true when sugar is being sent
    traits: {},            // id -> level
    instinct: freshInstinct(cfg),  // the habits, their reserve and their clock
    below: { sugar: 0, minerals: 0 },  // what arrives from the levels folded away
    hand: { presses: 0 },
    opened: false,          // the origin has been laid and the free tips placed
    flags: {},             // reveal flags, monotonic
    fired: {},             // lines said once
    totals: { earned: 0, spent: 0, eaten: 0, traded: 0, sentMinerals: 0, felled: 0, fed: 0, regrown: 0 },
    rate: { sugar: 0, minerals: 0 },
    litterYear: -1,
    seasonSeen: -1,
    bestSeen: null,        // the kind that was paying most for the next mineral
    milestones: { tips: 0, area: 0 },
    events: Ev.freshEvents(),  // what the world is doing on its own
    log: [],               // the last lines said, newest first
  };
}

export function createSim(cfg = DEFAULT, opts = {}) {
  const seed = (opts.seed === undefined ? (Math.random() * 4294967296) : opts.seed) >>> 0;
  const state = opts.state || freshState(cfg, seed);
  const genome = opts.genome || Sp.freshGenome();

  let world = buildLevel(cfg, state.seed, state.level);
  let roster = Trees.rosterFor(cfg, state.level);
  let rt = null;

  // -- runtime bookkeeping, rebuilt from the state --------------------------

  const rebuild = () => {
    rt = Tips.runtimeOf(state);
    rt.soil = 0;
    rt.roots = 0;
    for (const id of state.reached) {
      const n = world.nodes[id];
      if (!n) continue;
      if (n.kind === 'soil') rt.soil++;
      else if (n.kind === 'root') rt.roots++;
    }
    rt.market = {};
    rt.income = { wood: 0, trade: 0, fell: 0, below: 0 };
    rt.carry = { produced: 0, capacity: 0, carried: 0 };
    rt.boost = {};
    // -- events.js hook: ground another fungus holds, and what a hop into it
    //    costs a tip. Read by Tips.step and by the hand.
    Ev.runtime(state, cfg, rt);
  };

  const scale = () => Lv.scale(cfg, state.level);
  const mods = () => Tr.modsOf(state, cfg, genome);

  // -- saying things -----------------------------------------------------------

  let events = [];
  const say = (key, values, once, salt) => {
    if (once) {
      if (state.fired[key]) return;
      state.fired[key] = true;
    }
    events.push({ key, values: values || {}, salt });
  };
  const drain = () => { const out = events; events = []; return out; };

  // -- reaching a node ------------------------------------------------------

  const woodStockOf = (node) => cfg.wood.stockBase * node.stock * scale();

  const reachNode = (id, fromId) => {
    if (rt.reached.has(id)) return false;
    const n = world.nodes[id];
    rt.reached.add(id);
    rt.frontier.add(id);
    // -- events.js hook: ground contested off a rival stops being its the
    //    moment the threads are in it.
    if (rt.rival && rt.rival.has(id)) { rt.rival.delete(id); Ev.taken(state, id); }
    state.reached.push(id);
    if (fromId !== undefined && fromId !== null && fromId !== id) state.threads.push([fromId, id]);
    if (n.kind === 'wood') {
      // -- events.js hook: a log that has already been through something keeps
      //    what happened to it. A burnt one is in the books at nothing and is
      //    not laid again; one the wind brought down holds what fell on it.
      if (state.wood[id] === undefined) state.wood[id] = woodStockOf(n);
      state.wood[id] += Ev.fallenStock(state, id);
    } else if (n.kind === 'soil') {
      rt.soil++;
      say('firstSoil', { thing: Lore.thing(state.level, 'soil') }, true);
    } else if (n.kind === 'root') {
      rt.roots++;
      const species = roster[n.sp];
      // -- events.js hook: a tree burnt to a snag is still standing there when
      //    the threads come back to it, charred wood and all.
      if (!state.trees[id]) state.trees[id] = Trees.newTree(n, species);
      if (state.weights[species.key] === undefined) state.weights[species.key] = cfg.trees.weightNew;
      say('firstRoot', { thing: Lore.thing(state.level, 'root') }, true);
    }
    return true;
  };

  // Open the origin: the log the spore landed on.
  const openOrigin = () => {
    const origin = world.nodes[world.origin];
    state.wood[origin.id] = woodStockOf(origin);
  };

  /** Add tips: the count always, a body while there is room for one. */
  const addTips = (n, at) => {
    for (let i = 0; i < n; i++) {
      state.tipCount++;
      if (state.tips.length < cfg.tips.bodies) state.tips.push(Tips.makeTip(world, at(i)));
    }
  };

  if (state.tipCount === undefined) state.tipCount = state.tips.length;
  // -- events.js hook: the world's own doings, put on any state that reaches
  //    here without them, and dated from the seed.
  Ev.ensure(state, cfg);
  if (!state.opened) {
    openOrigin();
    rebuild();
    addTips(mods().startTips, () => world.origin);
    state.opened = true;
  } else {
    rebuild();
  }

  // -- prices ---------------------------------------------------------------

  /** Sugar for the next n tips: the n-th ever costs base * (1 + n / slope), summed. */
  const tipCost = (n = 1) => {
    const b = state.tipsBought;
    const slope = cfg.tips.costSlope;
    const unit = cfg.tips.costBase * Math.pow(cfg.tips.costFactor, state.level) * mods().tipCost;
    return unit * (n + (n * b + (n * (n - 1)) / 2) / slope);
  };

  /** Minerals a second the tips can carry. */
  const carryCapacity = (m) => state.tipCount * cfg.tips.carry * Math.pow(cfg.tips.carryFactor, state.level) * m.yield;

  const tipsAffordable = () => {
    let lo = 0, hi = cfg.tips.maxBuy;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tipCost(mid) <= state.sugar) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  // -- the step -------------------------------------------------------------

  const step = (dt) => {
    if (!(dt > 0)) return drain();
    const m = mods();
    const k = scale();
    const season = seasonOf(cfg, state.t);
    const winter = season.index === WINTER;

    // -- events.js hook: the world's own doings, before the tips move, since
    //    a fire changes what there is to move over. `weather.soil` is the
    //    share of its minerals the ground is giving this step.
    const weather = Ev.step(state, cfg, {
      world, roster, season, say, rebuild, lore: Lore, rt: () => rt,
      search: cfg.tips.search + m.search,
    });

    // The tips forage.
    const tipMult = (m.frost && winter) ? 1 : season.tips;
    Tips.step(state, world, rt, cfg.tips.speed * m.speed * tipMult * dt,
      cfg.tips.search + m.search, reachNode, aimOf());

    let sugar = 0;
    const income = { wood: 0, trade: 0, fell: 0, below: 0 };
    let mineralFlow = 0;

    // Dead wood is eaten, and the minerals in it come loose.
    const eatRate = cfg.wood.eatRate * k * m.eat * m.yield;
    for (const id in state.wood) {
      const stock = state.wood[id];
      if (!(stock > 0)) continue;
      const eat = Math.min(stock, eatRate * dt);
      state.wood[id] = stock - eat;
      sugar += eat;
      income.wood += eat;
      mineralFlow += eat * cfg.wood.mineralsPerSugar;
      if (state.wood[id] <= 0) say('woodGone', { thing: Lore.thing(state.level, 'wood') }, true);
    }
    state.totals.eaten += income.wood;

    // Soil gives minerals; so does everything folded away below.
    mineralFlow += rt.soil * cfg.soil.rate * k * m.yield * weather.soil * dt;
    sugar += state.below.sugar * dt;
    income.below = state.below.sugar * dt;

    // The tips carry the minerals to the trees. What they cannot carry
    // leaches away, so the front is the organism's throughput.
    const produced = mineralFlow / dt;
    const capacity = carryCapacity(m);
    const flowPerSecond = Math.min(produced, capacity) + state.below.minerals;
    rt.carry = { produced, capacity, carried: Math.min(produced, capacity) };

    // The trees: pools by kind.
    const sizes = {};
    const counts = {};
    const mature = {};
    // -- ledger hook: the size the grown trees of a kind come to, so the
    //    ledger can say what one of them is worth felled against kept.
    const matureSize = {};
    for (const id in state.trees) {
      const tree = state.trees[id];
      if (tree.dead) continue;
      const sp = roster[tree.sp];
      sizes[sp.key] = (sizes[sp.key] || 0) + tree.s;
      counts[sp.key] = (counts[sp.key] || 0) + 1;
      if (Trees.isMature(tree, sp, cfg)) {
        mature[sp.key] = (mature[sp.key] || 0) + 1;
        matureSize[sp.key] = (matureSize[sp.key] || 0) + tree.s;
      }
    }

    // The trade.
    const tradeMult = (winter && m.evergreen) ? cfg.season.evergreenWinter : season.trade;
    const sent = Trees.split(flowPerSecond, state.weights, sizes);
    const market = {};
    for (const sp of roster) {
      const S = sizes[sp.key] || 0;
      const ms = sent[sp.key] || 0;
      const r = Trees.tradeOf(sp, S, ms);
      // -- ledger hook: a kind has a season it pays best in, over and above
      //    the year's own curve, so the best kind changes as the year does.
      //    It is in the price the ledger shows because it is in the trade.
      const mult = m.trade * m.yield * tradeMult * Trees.seasonMult(sp, season.index);
      const got = r.got * mult;
      sugar += got * dt;
      income.trade += got * dt;
      state.totals.traded += got * dt;
      state.totals.sentMinerals += ms * dt;
      const row = {
        key: sp.key, name: sp.name, count: counts[sp.key] || 0, mature: mature[sp.key] || 0,
        size: S, sent: ms, got, marginal: r.marginal * mult, sat: r.sat,
        dead: 0, weight: state.weights[sp.key] === undefined ? cfg.trees.weightNew : state.weights[sp.key],
        policy: state.harvest[sp.key] || 0, nurture: !!state.nurture[sp.key], max: sp.max,
        // -- ledger hook: which season this kind pays best in, and what the
        //    two standing decisions are worth. Grown size is what is actually
        //    standing there when any of it is grown, and a plain grown tree
        //    otherwise. felled and kept are per grown tree: a lump now
        //    against what trade pays it over one season at this price. feed
        //    is how long feeding takes to pay for itself, 0 for not at all.
        best: Trees.bestSeason(sp), worst: Trees.worstSeason(sp),
        grownSize: 0, felled: 0, kept: 0, keptBack: 0, feed: 0,
      };
      const grownSize = mature[sp.key] > 0
        ? matureSize[sp.key] / mature[sp.key]
        : cfg.trees.mature * sp.max;
      row.grownSize = grownSize;
      if (m.fell) {
        row.felled = Trees.fellValue(cfg, sp, grownSize, m);
        // What one grown tree of this kind is paid a second where it stands.
        // The ledger used to set the lump against one season of that, which
        // made felling look obviously right at every price - a lump of 243
        // against 16 a season is not a decision anyone weighs. What it is
        // really worth is how long the tree needs to trade its own felling
        // price back, so that is the figure the ledger carries.
        const perSecond = Trees.keptRate(got, S, grownSize);
        row.kept = perSecond;
        row.keptBack = perSecond > 0 ? row.felled / perSecond : 0;
      }
      if (m.nurture && S > 0) {
        const value = Trees.sizeValue(sp, S, ms, mult);
        const pay = Trees.feedPayback(cfg, sp, { count: counts[sp.key] || 0, size: S }, value, season.growth, k);
        row.feed = Number.isFinite(pay) ? pay : 0;
      }
      market[sp.key] = row;
      if (got > 0) say('firstTrade', { kind: sp.name }, true);
    }

    // What one more point of a kind's share is worth, in sugar a second.
    // Moving one weight moves the split for every kind, so the whole market is
    // priced again at the new weights and the difference is what the press
    // actually buys. It goes on the ledger beside the tick that makes it,
    // because a share is the only decision here with no other way to check it.
    const totalAt = (weights) => {
      const share = Trees.split(flowPerSecond, weights, sizes);
      let sum = 0;
      for (const sp of roster) {
        const S = sizes[sp.key] || 0;
        if (!(S > 0)) continue;
        const r = Trees.tradeOf(sp, S, share[sp.key] || 0);
        sum += r.got * m.trade * m.yield * tradeMult * Trees.seasonMult(sp, season.index);
      }
      return sum;
    };
    const nowPaid = totalAt(state.weights);
    for (const sp of roster) {
      const row = market[sp.key];
      if (!row || !(row.count > 0)) continue;
      row.shareGain = 0;
      if (row.weight >= cfg.trees.weightMax) continue;
      const trial = Object.assign({}, state.weights);
      trial[sp.key] = row.weight + 1;
      row.shareGain = totalAt(trial) - nowPaid;
    }

    // Feeding: sugar to a kind, for growth.
    const boost = {};
    if (m.nurture) {
      for (const sp of roster) {
        if (!state.nurture[sp.key]) continue;
        const S = sizes[sp.key] || 0;
        if (!(S > 0)) continue;
        // Sugar is charged on the growth still to come, not on the whole
        // standing pool. Trees already at their full size cannot use it, so
        // feeding a grown kind costs nothing and does nothing, and the sugar
        // always buys size that is actually arriving.
        const room = Math.max(0, (counts[sp.key] || 0) * sp.max - S);
        if (!(room > 0)) continue;
        const cost = cfg.trees.nurture.sugarPerSize * room * k * dt;
        if (state.sugar + sugar >= cost) {
          sugar -= cost;
          state.totals.fed += cost;
          boost[sp.key] = cfg.trees.nurture.boost;
        }
      }
    }
    rt.boost = boost;

    // Each tree: drained, dying, dead and eaten, regrowing, or growing.
    for (const id in state.trees) {
      const tree = state.trees[id];
      // -- events.js hook: a tree on ground the threads are no longer in - a
      //    snag the fire left behind - is neither eaten nor tended until they
      //    come back to it.
      if (!rt.reached.has(+id)) continue;
      const sp = roster[tree.sp];
      if (tree.dead) {
        market[sp.key].dead++;
        if (tree.wood > 0) {
          const eat = Math.min(tree.wood, eatRate * dt);
          tree.wood -= eat;
          sugar += eat;
          income.wood += eat;
          state.totals.eaten += eat;
          mineralFlow += eat * cfg.wood.mineralsPerSugar;
          if (tree.wood <= 0) tree.regrow = state.t + cfg.trees.regrowSeconds;
        } else if (state.t >= tree.regrow) {
          state.totals.regrown++;
          state.trees[id] = Trees.seedling(cfg, state.level, Number(id), state.seed, state.totals.regrown);
          say('regrown', { kind: sp.name }, true);
        }
        continue;
      }
      const policy = m.fell ? (state.harvest[sp.key] || 0) : 0;
      if (policy === 2 || (policy === 1 && Trees.isMature(tree, sp, cfg))) {
        tree.h -= dt / cfg.trees.fell.seconds;
        const got = sp.rate * tree.s * cfg.trees.fell.yield * m.yield * dt;
        sugar += got;
        income.fell += got;
        if (tree.h <= 0) {
          tree.dead = true;
          tree.h = 0;
          tree.wood = tree.s * sp.wood * m.felledWood;
          tree.regrow = 0;
          state.totals.felled++;
          say('treeFelled', { kind: sp.name }, true);
        }
        continue;
      }
      Trees.grow(tree, sp, dt, season.growth * (1 + (boost[sp.key] || 0)));
    }
    rt.market = market;

    // Autumn: the leaves come down and every reached log regains a little.
    if (season.index === AUTUMN && state.litterYear < season.year) {
      state.litterYear = season.year;
      const fall = cfg.wood.litterFall * cfg.wood.stockBase * k * season.litter;
      // -- events.js hook: litter only counts where the threads are, so a log
      //    the fire took does not fill up again while it lies outside the reach.
      for (const id in state.wood) if (rt.reached.has(+id)) state.wood[id] += fall * world.nodes[id].stock;
    }
    if (season.index !== state.seasonSeen) {
      const first = state.seasonSeen < 0;
      state.seasonSeen = season.index;
      if (!first && state.flags.season) say('season.' + season.index, {}, false, season.year);
    }

    // Every kind pays best in a season of its own, so the kind worth the
    // minerals changes as the year does. When it changes hands the journal
    // says so, which is the only warning a player gets that the split they set
    // last season is now the wrong one.
    let bestKind = null;
    for (const sp of roster) {
      const row = market[sp.key];
      if (!row || !(row.count > 0) || !(row.marginal > 0)) continue;
      if (!bestKind || row.marginal > market[bestKind].marginal) bestKind = sp.key;
    }
    if (bestKind && state.bestSeen !== bestKind) {
      const had = state.bestSeen !== undefined && state.bestSeen !== null;
      state.bestSeen = bestKind;
      if (had && state.flags.season) {
        say('bestKind', { kind: market[bestKind].name }, false, bestKind + ':' + season.year + ':' + season.index);
      }
    }

    // Book it.
    state.sugar += sugar;
    state.totals.earned += Math.max(0, sugar);
    const a = Math.min(1, dt * 1.5);
    state.rate.sugar += (sugar / dt - state.rate.sugar) * a;
    state.rate.minerals += (flowPerSecond - state.rate.minerals) * a;
    rt.income = { wood: income.wood / dt, trade: income.trade / dt, fell: income.fell / dt, below: income.below / dt };
    state.t += dt;

    // -- instinct hook: the organism doing for itself what the hand has been
    //    doing. It reads the books that were just closed and presses the same
    //    buttons a player would, so it belongs after them and before the page
    //    is told what to show.
    runInstinct(m);

    // What is now on the page, and what is worth saying.
    Rv.update(state, cfg, { tipCost: tipCost(1), rootsReached: rt.roots, genome });
    milestones();
    return drain();
  };

  // -- instinct --------------------------------------------------------------
  //
  // Three habits the organism can learn, each bought as a trait and switched
  // in the journal. Every one of them calls the same action a press calls and
  // nothing else, so there is no sum an instinct can reach that a hand could
  // not: what it saves is attention. Each decision leaves the reserve - the
  // share of the sugar the player keeps back - untouched, measured against
  // what is held at the moment the decision is taken.
  //
  // They decide on their own coarse clock, so an hour watched and an hour
  // caught up in five-second chunks take the same decisions at the same
  // moments.

  /** The instinct book, put on any state that arrives here without one. */
  const instinctBook = () => {
    if (!state.instinct) state.instinct = freshInstinct(cfg);
    return state.instinct;
  };

  /** Sugar an instinct may spend right now: everything above the reserve. */
  const aboveReserve = () => {
    const r = instinctBook().reserve;
    const keep = Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
    return Math.max(0, state.sugar) * (1 - keep);
  };

  /** The most tips a budget buys, never more than `cap` of them. */
  const tipsWithin = (budget, cap) => {
    let lo = 0, hi = Math.max(0, Math.min(Math.floor(cap), cfg.tips.maxBuy));
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tipCost(mid) <= budget) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  // An action drains the events said so far and hands them back; put them
  // where the step will find them, so a ring opened by instinct still reads
  // as a ring opened.
  const keep = (said) => { for (const e of said) events.push(e); };

  const runInstinct = (m) => {
    const inst = instinctBook();
    const every = Math.max(0.1, cfg.instinct.everySeconds);
    // A hair of slack on the interval: the running clock is a sum of every
    // step taken, so an hour played a tenth of a second at a time carries a
    // rounding error an hour caught up in chunks does not. Without the slack
    // that error swallows a decision now and then, and the same hour would
    // land in two different places depending on how finely it was stepped.
    if (state.t - (inst.at || 0) < every - 1e-9) return;
    inst.at = state.t;
    const did = (key) => { inst.acted[key] = state.t; };

    // REACH: nothing left to reach inside the open ground, and the next ring
    // is affordable above the reserve.
    if (m.instinct.extend && inst.extend && rt.frontier.size === 0 && state.ring < cfg.world.rings) {
      if (Lv.ringCost(cfg, state.level, state.ring + 1) <= aboveReserve()) {
        const ring = state.ring;
        keep(extend());
        if (state.ring > ring) did('extend');
      }
    }

    // FRONT: the ground is giving up more than the tips can carry. Buy enough
    // to close the gap, within a share of what is above the reserve, so one
    // decision cannot empty the stores into the front.
    if (m.instinct.tips && inst.tips) {
      const c = rt.carry;
      if (c && c.produced > c.capacity * cfg.instinct.carryShort) {
        const per = cfg.tips.carry * Math.pow(cfg.tips.carryFactor, state.level) * m.yield;
        const gap = c.produced - c.capacity;
        const want = per > 0 ? Math.ceil(gap / per) : 0;
        const n = tipsWithin(aboveReserve() * cfg.instinct.tipsShare, want);
        if (n > 0) { keep(buyTips(n)); did('tips'); }
      }
    }

    // BEYOND: the level is finished and the fold is affordable above the
    // reserve. Switched off until the player switches it on, because it is
    // the one instinct that ends something.
    if (m.instinct.beyond && inst.beyond && Lv.beyondOffered(cfg, state, world)) {
      if (Lv.beyondCost(cfg, state.level) <= aboveReserve()) {
        const level = state.level;
        keep(beyond());
        if (state.level > level) did('beyond');
      }
    }
  };

  const milestones = () => {
    const n = state.tipCount;
    if (n >= 10 * state.milestones.tips && n >= 10) {
      let mark = state.milestones.tips || 1;
      while (mark * 10 <= n) mark *= 10;
      if (mark > state.milestones.tips) {
        state.milestones.tips = mark;
        say('milestoneTips', { n: mark }, false, mark);
      }
    }
    const A = area();
    if (A >= 100) {
      let mark = state.milestones.area || 10;
      while (mark * 10 <= A) mark *= 10;
      if (mark > state.milestones.area) {
        state.milestones.area = mark;
        say('milestoneArea', { area: fmtArea(mark) }, false, mark);
      }
    }
    if (A >= Lv.LARGEST_ORGANISM_M2) say('largest', {}, true);
    if (Lv.beyondOffered(cfg, state, world)) say('canBeyond', { level: Lore.levelInfo(state.level).name }, true);
    if (Sp.canFruit(cfg, state)) say('canFruit', {}, true);
  };

  /** Time away, in coarse chunks, up to the hours the organism keeps working. */
  const advance = (seconds) => {
    const m = mods();
    const cap = m.awayHours * 3600;
    const elapsed = Math.max(0, Math.min(seconds, cap));
    const before = { sugar: state.sugar, reached: state.reached.length, t: state.t };
    const chunk = Math.max(0.5, cfg.time.awayChunk);
    let left = elapsed;
    const all = [];
    let guard = 0;
    while (left > 1e-6 && guard++ < 200000) {
      const dt = Math.min(chunk, left);
      for (const e of step(dt)) all.push(e);
      left -= dt;
    }
    return {
      away: true,
      elapsed,
      capped: seconds > cap,
      gained: { sugar: state.sugar - before.sugar, reached: state.reached.length - before.reached },
      events: all,
    };
  };

  // -- actions ---------------------------------------------------------------

  /** Push a thread out by hand: one node, from wherever the front is. */
  // -- where the front has been sent -----------------------------------------
  //
  // A place on this ground the tips lean toward. It changes which of the open
  // places they take first and nothing else: no ground is closed off, no ring
  // opens any faster, and the level still has to be reached to be folded. What
  // it buys is order, and order is worth a lot - a stand of the kind that is
  // paying best this season is worth reaching before a bog is.

  const aimOf = () => {
    const a = state.aim;
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    return { x: a.x, y: a.y, pull: cfg.tips.aimPull };
  };

  /** Send the front toward a place on the ground, in cells from the middle. */
  const setAim = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return drain();
    // Never further out than the ground that is open, so the mark is always
    // somewhere the tips can actually get to.
    const edge = state.ring * cfg.world.ringWidth;
    const d = Math.sqrt(x * x + y * y);
    if (d > edge && d > 1e-6) { x = x * edge / d; y = y * edge / d; }
    state.aim = { x, y };
    say('aimSet', {}, true);
    return drain();
  };

  const clearAim = () => { state.aim = null; return drain(); };

  const reachByHand = () => {
    state.hand.presses++;
    const k = scale();
    const search = cfg.tips.search + mods().search;
    const isReached = (id) => rt.reached.has(id);
    const isClaimed = (id) => rt.claimed.has(id);
    let target = -1, from = -1;
    for (let i = 0; i < rt.frontier.size && target < 0; i++) {
      const f = rt.frontier.at(i);
      // -- events.js hook: the hand cannot help itself to ground a rival holds.
      const id = nearestOpen(world, f, search, state.ring, isReached, isClaimed, Ev.rivalGuard(rt), false, aimOf());
      if (id >= 0) { target = id; from = f; }
    }
    state.sugar += cfg.hand.sugar * k;
    state.totals.earned += cfg.hand.sugar * k;
    say('firstHand', {}, true);
    if (target >= 0) {
      reachNode(target, from);
      say('handReach', { thing: Lore.thing(state.level, world.nodes[target].kind) }, true);
    }
    Rv.update(state, cfg, { tipCost: tipCost(1), rootsReached: rt.roots, genome });
    return drain();
  };

  const buyTips = (n) => {
    n = Math.max(0, Math.floor(n || 0));
    if (n === 0) return drain();
    const cost = tipCost(n);
    if (!(state.sugar >= cost)) return drain();
    state.sugar -= cost;
    state.totals.spent += cost;
    addTips(n, () => {
      const at = rt.frontier.size > 0
        ? rt.frontier.at(hash(state.seed, 'tip:' + state.tipsBought) % rt.frontier.size)
        : world.origin;
      state.tipsBought++;
      return at;
    });
    say('firstTip', {}, true);
    Rv.update(state, cfg, { tipCost: tipCost(1), rootsReached: rt.roots, genome });
    return drain();
  };

  const buyTipsMax = () => buyTips(tipsAffordable());

  const setWeight = (key, delta) => {
    const cur = state.weights[key] === undefined ? cfg.trees.weightNew : state.weights[key];
    state.weights[key] = Math.max(0, Math.min(cfg.trees.weightMax, cur + delta));
    return drain();
  };

  const setHarvest = (key, policy) => {
    if (!mods().fell) return drain();
    policy = Math.max(0, Math.min(2, Math.floor(policy)));
    state.harvest[key] = policy;
    if (policy > 0) say('firstFell', { kind: key }, true);
    return drain();
  };

  const toggleNurture = (key) => {
    if (!mods().nurture) return drain();
    state.nurture[key] = !state.nurture[key];
    return drain();
  };

  const buyTrait = (id) => {
    Tr.buy(cfg, state, id, mods());
    return drain();
  };

  /** Switch one habit on or off. Passing nothing turns it the other way. */
  const setInstinct = (key, on) => {
    const inst = instinctBook();
    if (key !== 'extend' && key !== 'tips' && key !== 'beyond') return drain();
    inst[key] = on === undefined ? !inst[key] : !!on;
    return drain();
  };

  /** The share of the sugar instinct leaves alone: one of the offered ones. */
  const setReserve = (share) => {
    const inst = instinctBook();
    let best = cfg.instinct.reserves[0];
    for (const r of cfg.instinct.reserves) {
      if (Math.abs(r - share) < Math.abs(best - share)) best = r;
    }
    inst.reserve = best;
    return drain();
  };

  const extend = () => {
    if (state.ring >= cfg.world.rings) return drain();
    const cost = Lv.ringCost(cfg, state.level, state.ring + 1);
    if (!(state.sugar >= cost)) return drain();
    state.sugar -= cost;
    state.totals.spent += cost;
    state.ring++;
    // Every reached node may have something new near it now.
    for (const id of state.reached) rt.frontier.add(id);
    say('ringOpened', { n: world.ringCounts[state.ring] }, false, state.level + ':' + state.ring);
    if (state.ring === cfg.world.rings) say('lastRing', { level: Lore.levelInfo(state.level).name }, false, state.level);
    return drain();
  };

  /** Fold this level into one node of the next. */
  const beyond = () => {
    if (!Lv.beyondOffered(cfg, state, world)) return drain();
    const cost = Lv.beyondCost(cfg, state.level);
    if (!(state.sugar >= cost)) return drain();
    state.sugar -= cost;
    state.totals.spent += cost;
    const carry = cfg.levels.carry;
    // Minerals from below arrive already carried: they need no tips.
    state.below = {
      sugar: Math.max(0, state.rate.sugar) * carry,
      minerals: Math.max(0, state.rate.minerals) * carry,
    };
    state.level++;
    state.ring = 1;
    state.reached = [0];
    state.threads = [];
    state.wood = {};
    state.trees = {};
    state.relocations = 0;
    // -- events.js hook: a burn and a rival belong to the ground that was just
    //    folded away, and its node numbers mean something else up here.
    Ev.levelChanged(state);
    world = buildLevel(cfg, state.seed, state.level);
    roster = Trees.rosterFor(cfg, state.level);
    openOrigin();
    Tips.gather(state, world, world.origin);
    rebuild();
    say('beyond', { level: Lore.levelInfo(state.level).name }, false, state.level);
    // What the fold is worth, in the figures it is worth it in. Folding a
    // level is the largest single thing that happens in this game and it used
    // to pass without a number: the picture went quiet and the label read a
    // new name. The ground left behind pays on, and this says how much.
    state.aim = null;
    state.bestSeen = null;
    say('below', {
      sugar: fmtCoin(state.below.sugar),
      minerals: fmtCoin(state.below.minerals),
      level: Lore.levelInfo(state.level - 1).name,
    }, false, state.level);
    Rv.update(state, cfg, { tipCost: tipCost(1), rootsReached: rt.roots, genome });
    return drain();
  };

  // -- reading ----------------------------------------------------------------

  const area = () => Lv.areaOf(cfg, state.level, state.reached.length);
  const canFruit = () => Sp.canFruit(cfg, state);
  const sporesNow = () => Sp.sporesFor(cfg, state, area());

  const snapshot = () => ({ state: JSON.parse(JSON.stringify(state)), genome: JSON.parse(JSON.stringify(genome)) });

  return {
    cfg, state, genome,
    get world() { return world; },
    get roster() { return roster; },
    get rt() { return rt; },
    mods, scale,
    step, advance, drain,
    tipCost, tipsAffordable, carryCapacity: () => carryCapacity(mods()),
    reachByHand, buyTips, buyTipsMax, setWeight, setHarvest, toggleNurture, buyTrait, extend, beyond,
    setAim, clearAim, aim: () => aimOf(),
    setInstinct, setReserve, instinct: () => instinctBook(),
    area, canFruit, sporesNow,
    ringCost: () => Lv.ringCost(cfg, state.level, state.ring + 1),
    beyondCost: () => Lv.beyondCost(cfg, state.level),
    beyondOffered: () => Lv.beyondOffered(cfg, state, world),
    market: () => rt.market,
    carry: () => rt.carry,
    income: () => rt.income,
    season: () => seasonOf(cfg, state.t),
    snapshot,
  };
}

export function restoreSim(cfg, snap) {
  if (!snap || !snap.state) return null;
  const state = snap.state;
  const genome = snap.genome || Sp.freshGenome();
  return createSim(cfg, { state, genome });
}

/** The state a fresh organism opens on after fruiting, with the genome kept. */
export function openedState(cfg, genome, seed, lines) {
  const state = freshState(cfg, seed);
  state.log = lines || [];
  state.flags.spores = true;
  return state;
}
