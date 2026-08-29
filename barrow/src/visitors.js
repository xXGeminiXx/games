// ---------------------------------------------------------------------------
// Visitors.
//
// The dig is not the only thing that happens in the field. At long, uneven
// gaps somebody walks up the track with an offer: a buyer paying over the odds
// for one good, a cart of bone for sale, a gang looking for work, the reeve
// wanting his tithe, a peddler with something wrapped in cloth.
//
// The rules that keep this an idle game and not a chore:
//   - never more than one at the gate at a time;
//   - every offer waits a long while and then simply leaves;
//   - nothing is lost by being away, and nothing is required to be taken;
//   - who comes and what they want is a hash of the run seed and the visitor's
//     number, so a save replays exactly and no two runs meet the same people.
//
// Everything a visitor needs from the game arrives as `api` from the
// simulation. This file never touches the page and never reaches into state
// it was not handed.
// ---------------------------------------------------------------------------

import { hash, unit, range, pick } from './rng.js?v=8';
import * as Mk from './market.js?v=8';
import * as Lore from './lore.js?v=8';
import { fill } from '../config.js?v=8';
import { fmt, fmtCoin, fmtCount } from './numbers.js?v=8';

const KINDS = ['buyer', 'buyer', 'bonecart', 'gang', 'reeve', 'relic', 'surveyor', 'mourner'];

/**
 * How many of a kind one barrow will ever see. A caller who hands out a
 * permanent multiplier is on a clock, and a clock plus a multiplier is
 * compound interest: a run left open overnight would come back multiplied by
 * a number nobody chose. Those two are counted and run out. The rest - a
 * buyer, a cart, a gang, a surveyor, a mourner - hand out nothing that
 * compounds, so they keep coming forever.
 */
const LIMITS = { relic: 'max', reeve: 'max' };

/** How many of this kind this barrow has already taken. */
function takenOf(state, kind) {
  return (state.visitorsBought && state.visitorsBought[kind]) || 0;
}

function noteTaken(state, kind) {
  if (!state.visitorsBought) state.visitorsBought = {};
  state.visitorsBought[kind] = takenOf(state, kind) + 1;
}

/** Whether the ground the surveyor would read has already been read. */
function groundIsRead(state, cfg) {
  for (let i = 1; i <= cfg.visitors.surveyor.reads; i++) {
    if (!state.read[state.depth + i]) return false;
  }
  return true;
}

/**
 * The kind at the gate: the seed's choice, or the next one still worth
 * hearing. A caller is skipped when there is nothing left for them to sell -
 * the two who deal in permanent multipliers run out of stock, and a surveyor
 * has nothing to say about ground that has already been read.
 */
function kindFor(state, cfg, i) {
  const start = hash(state.seed, 'visit-kind:' + i) % KINDS.length;
  for (let n = 0; n < KINDS.length; n++) {
    const kind = KINDS[(start + n) % KINDS.length];
    const limit = LIMITS[kind];
    if (limit && takenOf(state, kind) >= cfg.visitors[kind][limit]) continue;
    if (kind === 'surveyor' && groundIsRead(state, cfg)) continue;
    return kind;
  }
  return KINDS[start];
}

/** Seconds until the next caller, after the rites and the oaths have their say. */
export function gapFor(state, cfg, md, i) {
  const v = cfg.visitors;
  const base = range(state.seed, 'visit-gap:' + i, v.gapMin, v.gapMax);
  return Math.max(30, base * (md.visitGap || 1));
}

/** Set the clock for the first caller of a run. */
export function begin(state, cfg, md) {
  state.visitCount = state.visitCount || 0;
  state.visitNext = cfg.visitors.firstAt * (md.visitGap || 1);
}

/**
 * The yardstick every offer is priced against: what this barrow earns in a
 * second. A run that has just started, or one whose owner has sold nothing
 * yet, is floored so a caller never hands out something for nothing.
 */
function incomeRef(api) {
  const r = api.state.rate;
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/** Bones per second the horde is turning up right now. */
function boneRef(api) {
  return api.boneRate();
}

/** The goods with a market and a row of their own, deepest last. */
function tradeable(api) {
  return api.goods().filter(id => id !== 'bones' && api.strataOf(id) >= 0);
}

// ---------------------------------------------------------------------------
// Building one caller
// ---------------------------------------------------------------------------

/**
 * Decide who is at the gate and what they want. Returns the visitor record,
 * or null when nobody suitable could be found (an empty yard, no income yet),
 * in which case the caller is skipped and the clock is reset.
 */
export function build(api, i) {
  const { state, cfg } = api;
  const seed = state.seed;
  const md = api.mods();
  const v = cfg.visitors;
  const pay = md.visitPay || 1;
  const ref = incomeRef(api);
  const kind = kindFor(state, cfg, i);
  const words = Lore.visitor(kind);
  if (!words) return null;
  const say = (key, values) => fill(pick(words[key], seed, 'visit-line:' + i) || '', values);
  // A caller's flavour, then what is actually on the table. A price on a
  // button is worth nothing to a player who cannot see what it buys.
  const offer = (values) => (words.offer ? ' ' + fill(words.offer, values) : '');
  const rec = { i, kind, name: words.name, born: state.t, expires: state.t + v.stay };

  if (kind === 'buyer') {
    const ids = tradeable(api);
    if (!ids.length) return null;
    const id = ids[hash(seed, 'visit-good:' + i) % ids.length];
    const k = api.strataOf(id);
    const g = api.ground.at(k);
    const m = api.marketFor(id);
    const mult = range(seed, 'visit-mult:' + i, v.buyer.multMin, v.buyer.multMax) * pay;
    const want = Mk.bestFlow(m, md) * v.buyer.seconds;
    rec.data = { id, k, mult, want };
    rec.text = fill(say('lines'), { name: g.name, mult: mult.toFixed(1) });
    rec.take = words.take;
    rec.pass = words.pass;
    return rec;
  }

  if (kind === 'bonecart') {
    const bones = Math.max(v.bonecart.floor, boneRef(api) * v.bonecart.seconds);
    const price = ref * v.bonecart.priceSeconds;
    if (!(price > 0)) return null;
    rec.data = { bones, price };
    rec.text = say('lines') + offer({ n: fmtCount(bones) });
    rec.take = words.take + ' (' + fmtCoin(price) + ')';
    rec.pass = words.pass;
    rec.cost = price;
    return rec;
  }

  if (kind === 'gang') {
    const seconds = range(seed, 'visit-share:' + i, v.gang.secondsMin, v.gang.secondsMax) * pay;
    const n = Math.max(v.gang.floor, Math.floor(api.growthOver(seconds)));
    rec.data = { n };
    rec.text = say('lines') + offer({ n: fmtCount(n) });
    rec.take = words.take;
    rec.pass = words.pass;
    return rec;
  }

  if (kind === 'reeve') {
    const price = ref * v.reeve.seconds * Math.pow(v.reeve.priceGrowth, takenOf(state, 'reeve'));
    if (!(price > 0)) return null;
    rec.data = { price };
    rec.text = say('lines') + offer();
    rec.take = words.take + ' (' + fmtCoin(price) + ')';
    rec.pass = words.pass;
    rec.cost = price;
    return rec;
  }

  if (kind === 'relic') {
    const price = ref * v.relic.seconds * Math.pow(v.relic.priceGrowth, takenOf(state, 'relic'));
    if (!(price > 0)) return null;
    const keys = ['dig', 'bones', 'value', 'face'];
    const key = keys[hash(seed, 'visit-boon:' + i) % keys.length];
    const factor = range(seed, 'visit-factor:' + i, v.relic.boonMin, v.relic.boonMax);
    rec.data = { price, key, factor };
    rec.text = say('lines') + offer();
    rec.take = words.take + ' (' + fmtCoin(price) + ')';
    rec.pass = words.pass;
    rec.cost = price;
    return rec;
  }

  if (kind === 'surveyor') {
    const price = ref * v.surveyor.seconds;
    rec.data = { price, reads: v.surveyor.reads };
    rec.text = say('lines') + offer({ n: v.surveyor.reads });
    rec.take = words.take + (price > 0 ? ' (' + fmtCoin(price) + ')' : '');
    rec.pass = words.pass;
    rec.cost = price;
    return rec;
  }

  // mourner
  const gift = ref * v.mourner.seconds;
  rec.data = { gift };
  rec.text = say('lines');
  rec.take = words.take;
  rec.pass = words.pass;
  return rec;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Bring the gate up to date for a step. Sets or clears state.visitor and
 * pushes a line when somebody arrives or gives up waiting.
 */
export function tick(api, events) {
  const { state, cfg } = api;
  const md = api.mods();
  if (state.visitNext === undefined || state.visitNext === null) begin(state, cfg, md);

  if (state.visitor) {
    if (state.t >= state.visitor.expires) {
      state.visitorsMissed = (state.visitorsMissed || 0) + 1;
      state.visitor = null;
      state.visitNext = state.t + gapFor(state, cfg, md, state.visitCount);
    }
    return;
  }

  if (state.t < state.visitNext) return;
  const i = state.visitCount;
  state.visitCount = i + 1;
  const rec = build(api, i);
  state.visitNext = state.t + gapFor(state, cfg, md, state.visitCount);
  if (!rec) return;                       // nobody suitable; the track stays empty
  state.visitor = rec;
  state.visitorsSeen = (state.visitorsSeen || 0) + 1;
  if (events) events.push({ type: 'visitor', text: rec.text });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/** Whether the offer at the gate can be taken right now. */
export function affordable(api, rec) {
  if (!rec) return false;
  if (rec.cost > 0 && api.state.coin < rec.cost) return false;
  if (rec.kind === 'buyer' && !(api.held(rec.data.id) > 1e-9)) return false;
  return true;
}

/** Take the offer. Returns the line to put in the log. */
export function accept(api) {
  const { state } = api;
  const rec = state.visitor;
  if (!rec) return '';
  const words = Lore.visitor(rec.kind);
  const seed = state.seed;
  const say = (key, values) => fill(words[key] || '', values);

  if (rec.cost > 0) {
    if (state.coin < rec.cost) return '';
    api.spend(rec.cost);
  }

  let line = '';
  if (rec.kind === 'buyer') {
    const { id, k, mult, want } = rec.data;
    const units = Math.min(api.held(id), want);
    if (!(units > 1e-9)) {
      line = words.empty;
    } else {
      // An off-market sale: it is carted away rather than put on the yard, so
      // the price the yard is asking is not moved by it.
      const coin = units * api.ground.at(k).value * mult;
      api.take(id, units);
      api.earn(coin);
      line = say('taken', { coin: fmtCoin(coin), name: api.ground.at(k).name, n: fmt(units) });
    }
  } else if (rec.kind === 'bonecart') {
    api.addBones(rec.data.bones);
    line = say('taken', { n: fmtCount(rec.data.bones) });
  } else if (rec.kind === 'gang') {
    api.raiseFree(rec.data.n);
    line = say('taken', { n: fmtCount(rec.data.n) });
  } else if (rec.kind === 'reeve') {
    api.boon({ absorb: api.cfg.visitors.reeve.absorb });
    line = say('taken', { coin: fmtCoin(rec.cost) });
  } else if (rec.kind === 'relic') {
    const b = {}; b[rec.data.key] = rec.data.factor;
    api.boon(b);
    line = say('taken', { boon: describeBoon(b) });
  } else if (rec.kind === 'surveyor') {
    line = say('taken', { reading: api.survey(rec.data.reads) });
  } else {
    api.earn(rec.data.gift);
    line = say('taken', { coin: fmtCoin(rec.data.gift) });
  }

  state.visitor = null;
  state.visitorsTaken = (state.visitorsTaken || 0) + 1;
  if (LIMITS[rec.kind]) noteTaken(state, rec.kind);
  state.visitNext = state.t + gapFor(state, api.cfg, api.mods(), state.visitCount);
  if (!line) line = pick(words.lines, seed, 'visit-line:' + rec.i) || '';
  return line;
}

/** Turn the offer down. Returns the line to put in the log. */
export function decline(api) {
  const { state } = api;
  const rec = state.visitor;
  if (!rec) return '';
  const words = Lore.visitor(rec.kind);
  if (rec.kind === 'reeve') api.sting(api.cfg.visitors.reeve.sting);
  state.visitor = null;
  state.visitNext = state.t + gapFor(state, api.cfg, api.mods(), state.visitCount);
  return words.passed || '';
}

/** A boon in the fewest words that still say what it does. */
export function describeBoon(boon) {
  const names = {
    dig: 'they dig faster',
    bones: 'the ground gives up more of them',
    value: 'everything is worth more',
    face: 'the face gives way faster',
    absorb: 'every market takes more',
    soft: 'bones go further',
  };
  const parts = [];
  for (const key of Object.keys(boon)) {
    const pct = Math.round((boon[key] - 1) * 100);
    if (key === 'windfall' || key === 'diggers' || key === 'rem') continue;
    parts.push((names[key] || key) + ', by ' + pct + '%');
  }
  return parts.join(' and ') + '.';
}
