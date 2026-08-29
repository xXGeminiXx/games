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

import { CONFIG as DEFAULT } from '../config.js?v=3';
import { buildLevel, nearestOpen } from './world.js?v=3';
import * as Tips from './tips.js?v=3';
import * as Trees from './trees.js?v=3';
import * as Tr from './traits.js?v=3';
import * as Lv from './levels.js?v=3';
import * as Sp from './spores.js?v=3';
import * as Rv from './reveal.js?v=3';
import { seasonOf, AUTUMN, WINTER } from './season.js?v=3';
import { hash } from './rng.js?v=3';
import * as Lore from './lore.js?v=3';
import { fmtArea } from './numbers.js?v=3';

export const SAVE_VERSION = 1;

export function freshState(cfg, seed) {
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    t: 0,                  // simulation seconds since the spore landed
    level: 0,
    sugar: 0,
    ring: 1,               // rings of reach open on this level
    tips: [],              // the moving bodies: { x, y, from, to }, at most cfg.tips.bodies
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
    below: { sugar: 0, minerals: 0 },  // what arrives from the levels folded away
    hand: { presses: 0 },
    opened: false,          // the origin has been laid and the free tips placed
    flags: {},             // reveal flags, monotonic
    fired: {},             // lines said once
    totals: { earned: 0, spent: 0, eaten: 0, traded: 0, sentMinerals: 0, felled: 0, fed: 0, regrown: 0 },
    rate: { sugar: 0, minerals: 0 },
    litterYear: -1,
    seasonSeen: -1,
    milestones: { tips: 0, area: 0 },
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
    state.reached.push(id);
    if (fromId !== undefined && fromId !== null && fromId !== id) state.threads.push([fromId, id]);
    if (n.kind === 'wood') {
      state.wood[id] = woodStockOf(n);
    } else if (n.kind === 'soil') {
      rt.soil++;
      say('firstSoil', { thing: Lore.thing(state.level, 'soil') }, true);
    } else if (n.kind === 'root') {
      rt.roots++;
      const species = roster[n.sp];
      state.trees[id] = Trees.newTree(n, species);
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

    // The tips forage.
    const tipMult = (m.frost && winter) ? 1 : season.tips;
    Tips.step(state, world, rt, cfg.tips.speed * m.speed * tipMult * dt, cfg.tips.search + m.search, reachNode);

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
    mineralFlow += rt.soil * cfg.soil.rate * k * m.yield * dt;
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
    for (const id in state.trees) {
      const tree = state.trees[id];
      if (tree.dead) continue;
      const sp = roster[tree.sp];
      sizes[sp.key] = (sizes[sp.key] || 0) + tree.s;
      counts[sp.key] = (counts[sp.key] || 0) + 1;
      if (Trees.isMature(tree, sp, cfg)) mature[sp.key] = (mature[sp.key] || 0) + 1;
    }

    // The trade.
    const tradeMult = (winter && m.evergreen) ? cfg.season.evergreenWinter : season.trade;
    const sent = Trees.split(flowPerSecond, state.weights, sizes);
    const market = {};
    for (const sp of roster) {
      const S = sizes[sp.key] || 0;
      const ms = sent[sp.key] || 0;
      const r = Trees.tradeOf(sp, S, ms);
      const got = r.got * m.trade * m.yield * tradeMult;
      sugar += got * dt;
      income.trade += got * dt;
      state.totals.traded += got * dt;
      state.totals.sentMinerals += ms * dt;
      market[sp.key] = {
        key: sp.key, name: sp.name, count: counts[sp.key] || 0, mature: mature[sp.key] || 0,
        size: S, sent: ms, got, marginal: r.marginal * m.trade * m.yield * tradeMult, sat: r.sat,
        dead: 0, weight: state.weights[sp.key] === undefined ? cfg.trees.weightNew : state.weights[sp.key],
        policy: state.harvest[sp.key] || 0, nurture: !!state.nurture[sp.key], max: sp.max,
      };
      if (got > 0) say('firstTrade', { kind: sp.name }, true);
    }

    // Feeding: sugar to a kind, for growth.
    const boost = {};
    if (m.nurture) {
      for (const sp of roster) {
        if (!state.nurture[sp.key]) continue;
        const S = sizes[sp.key] || 0;
        if (!(S > 0)) continue;
        const cost = cfg.trees.nurture.sugarPerSize * S * k * dt;
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
      for (const id in state.wood) state.wood[id] += fall * world.nodes[id].stock;
    }
    if (season.index !== state.seasonSeen) {
      const first = state.seasonSeen < 0;
      state.seasonSeen = season.index;
      if (!first && state.flags.season) say('season.' + season.index, {}, false, season.year);
    }

    // Book it.
    state.sugar += sugar;
    state.totals.earned += Math.max(0, sugar);
    const a = Math.min(1, dt * 1.5);
    state.rate.sugar += (sugar / dt - state.rate.sugar) * a;
    state.rate.minerals += (flowPerSecond - state.rate.minerals) * a;
    rt.income = { wood: income.wood / dt, trade: income.trade / dt, fell: income.fell / dt, below: income.below / dt };
    state.t += dt;

    // What is now on the page, and what is worth saying.
    Rv.update(state, cfg, { tipCost: tipCost(1), rootsReached: rt.roots, genome });
    milestones();
    return drain();
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
  const reachByHand = () => {
    state.hand.presses++;
    const k = scale();
    const search = cfg.tips.search + mods().search;
    const isReached = (id) => rt.reached.has(id);
    const isClaimed = (id) => rt.claimed.has(id);
    let target = -1, from = -1;
    for (let i = 0; i < rt.frontier.size && target < 0; i++) {
      const f = rt.frontier.at(i);
      const id = nearestOpen(world, f, search, state.ring, isReached, isClaimed);
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
    world = buildLevel(cfg, state.seed, state.level);
    roster = Trees.rosterFor(cfg, state.level);
    openOrigin();
    Tips.gather(state, world, world.origin);
    rebuild();
    say('beyond', { level: Lore.levelInfo(state.level).name }, false, state.level);
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
