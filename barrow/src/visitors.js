// ---------------------------------------------------------------------------
// Visitors.
//
// The dig is not the only thing that happens in the field. At long, uneven
// gaps somebody walks up the track with an offer: a buyer paying over the odds
// for one material for a while, a cart of bone for sale, a gang looking for work, the reeve
// wanting his tithe, a peddler with something wrapped in cloth, a preacher, a
// tinker, a man with three cups, a collector, the next lord's herald.
//
// The rules that keep this an idle game and not a chore:
//   - never more than one at the gate at a time, and never the same kind twice
//     running;
//   - every offer waits a long while and then simply leaves;
//   - nothing is lost by being away, and nothing is required to be taken;
//   - who comes and what they want is a hash of the run seed and the visitor's
//     number, so a save replays exactly and no two runs meet the same people.
//
// Everything a visitor needs from the game arrives as `api` from the
// simulation. This file never touches the page and never reaches into state
// it was not handed.
// ---------------------------------------------------------------------------

import { hash, unit, range } from './rng.js?v=47';
import * as Lore from './lore.js?v=47';
import { fill } from '../config.js?v=47';
import { fmtCoin, fmtCount, fmtTime } from './numbers.js?v=47';

/**
 * Everyone who can come up the track. How often each one comes is a weight in
 * config.visitors.weight (one when it says nothing).
 */
export const KINDS = ['buyer', 'bonecart', 'gang', 'reeve', 'relic', 'surveyor', 'mourner',
  'preacher', 'tinker', 'cups', 'collector', 'herald'];

/**
 * How many of a kind one barrow will ever see. A caller who hands out a
 * permanent multiplier is on a clock, and a clock plus a multiplier is
 * compound interest: a run left open overnight would come back multiplied by
 * a number nobody chose. Those are counted and run out, and so is the
 * collector, who pays in relics. The rest hand out nothing that compounds, so
 * they keep coming forever.
 */
const LIMITS = { relic: 'max', reeve: 'max', collector: 'max' };

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
 * Whether a kind has anything to offer this run right now. The two who deal
 * in permanent multipliers run out of stock, a surveyor has nothing to say
 * about ground that is already read, the collector pays relics and so waits
 * for them to open, and a herald only comes when his lord's door is close.
 */
function available(api, kind) {
  const { state, cfg } = api;
  const limit = LIMITS[kind];
  if (limit && takenOf(state, kind) >= cfg.visitors[kind][limit]) return false;
  if (kind === 'surveyor' && groundIsRead(state, cfg)) return false;
  if (kind === 'collector' && !(api.relicsOpen && api.relicsOpen())) return false;
  if (kind === 'herald' && !(api.doorAhead && api.doorAhead(cfg.visitors.herald.within))) return false;
  return !!Lore.visitor(kind);
}

/**
 * The order the kinds are tried in for caller number i: a weighted draw from
 * the seed, never the kind that came last, and the few before it at a
 * fraction of their weight. So nobody comes twice running, a kind that was
 * just here is rare for a while, and it is still a surprise who is next.
 */
export function order(api, i) {
  const { state, cfg } = api;
  const v = cfg.visitors;
  const recent = Array.isArray(state.visitRecent) ? state.visitRecent : [];
  const last = recent[recent.length - 1];
  const W = v.weight || {};
  const pool = [];
  for (const kind of KINDS) {
    if (kind === last || !available(api, kind)) continue;
    const w = (W[kind] === undefined ? 1 : W[kind]) * (recent.includes(kind) ? v.recentWeight : 1);
    if (w > 0) pool.push({ kind, w });
  }
  const out = [];
  for (let n = 0; pool.length; n++) {
    let total = 0;
    for (const p of pool) total += p.w;
    let roll = unit(state.seed, 'visit-kind:' + i + ':' + n) * total;
    let j = 0;
    while (j < pool.length - 1 && roll >= pool[j].w) { roll -= pool[j].w; j++; }
    out.push(pool[j].kind);
    pool.splice(j, 1);
  }
  return out;
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
  // The simulation's steady figure when it offers one: the coin/s reading
  // goes to nothing while a choosy seller waits on a better price, or while
  // the whole crew is on the way down, and a caller priced off that stays
  // away or hands over nothing for no reason the player can see.
  const r = typeof api.income === 'function' ? api.income() : api.state.rate;
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/**
 * The yardstick a price is set against: what the player is actually bringing
 * in, not what the barrow would earn with the crew where the game would put
 * it. A player who places the crew by hand and sells slowly can make a fifth
 * of that, and a tinker priced off the larger figure asked 289No of somebody
 * holding 39No and making 1No a second. Never under a quarter of what the
 * barrow is worth, so a crew parked on the way down with one digger left on a
 * shallow layer does not make a permanent boon cost nothing.
 */
function priceRef(api) {
  const worth = incomeRef(api);
  const now = typeof api.earning === 'function' ? api.earning() : worth;
  const got = Number.isFinite(now) && now > 0 ? now : 0;
  return Math.max(got, worth * api.cfg.visitors.priceFloor);
}

/** Bones per second the horde is turning up right now. */
function boneRef(api) {
  return api.boneRate();
}


/**
 * Which of a kind's lines caller i says: a pick from the seed, and never the
 * one the last caller of the same kind said. A line is either the sentence
 * itself or { say, taken, passed } when what happens next belongs to it.
 */
function lineFor(state, words, kind, i, key) {
  const list = words[key || 'lines'] || [];
  if (!list.length) return { at: -1, line: { say: '' } };
  const last = state.visitLines && state.visitLines[kind];
  let at = hash(state.seed, 'visit-line:' + i) % list.length;
  if (list.length > 1 && at === last) at = (at + 1) % list.length;
  const l = list[at];
  return { at, line: typeof l === 'string' ? { say: l } : l };
}

/** The line a caller was built with, for what they say when answered. */
function lineOf(words, rec) {
  const list = words[rec.lines || 'lines'] || [];
  const l = rec.line >= 0 ? list[rec.line] : null;
  return l && typeof l === 'object' ? l : {};
}

/**
 * What a caller says at the gate. Somebody talking is named first, so a quote
 * on the panel always has a speaker; somebody described is left as written.
 */
function spoken(name, text) {
  return text.charAt(0) === '"' ? name + ': ' + text : text;
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
  for (const kind of order(api, i)) {
    const rec = buildKind(api, i, kind);
    if (!rec) continue;
    // The one whose turn it is asks more than the player has: nobody comes
    // this time. Sending the next in line instead handed a player who spends
    // every coin a free gift every time a paying caller was due.
    return withinReach(api, rec) ? rec : null;
  }
  return null;
}

/**
 * Whether the player can pay what a caller asks the moment he arrives. A
 * caller who can only be turned away is somebody else not getting a turn at
 * the gate. Counting what the crew would bring in over his wait was tried and
 * let a caller come to a player who spends coin on upgrades as it arrives:
 * the money was always five minutes away and never in hand.
 */
function withinReach(api, rec) {
  if (!(rec.cost > 0)) return true;
  return rec.cost <= api.state.coin;
}

/** One caller of a given kind, or null when that kind has nothing to offer. */
function buildKind(api, i, kind) {
  const { state, cfg } = api;
  const seed = state.seed;
  const md = api.mods();
  const v = cfg.visitors;
  const pay = md.visitPay || 1;
  const ref = incomeRef(api);        // what gifts are sized off
  const cost = priceRef(api);        // and what prices are
  const words = Lore.visitor(kind);
  if (!words) return null;
  const picked = lineFor(state, words, kind, i);
  const said = picked.line.say;
  // A caller's flavour, then what is actually on the table. A price on a
  // button is worth nothing to a player who cannot see what it buys.
  const offer = (values) => (words.offer ? ' ' + fill(words.offer, values) : '');
  const priced = (label, price) => label + (price > 0 ? ' (' + fmtCoin(price) + ')' : '');
  const rec = {
    i, kind, name: words.name, born: state.t, expires: state.t + v.stay,
    line: picked.at, take: words.take, pass: words.pass,
  };

  if (kind === 'buyer') {
    // He wants one material from the layers the crew can reach, and pays
    // over its worth for every bit of it they dig while his offer runs. Where
    // the crew stands decides what that comes to.
    const from = api.activeFrom ? api.activeFrom() : 0;
    const n = state.depth - from + 1;
    if (!(n > 0)) return null;
    const k = from + (hash(seed, 'visit-good:' + i) % n);
    const g = api.ground.at(k);
    const mult = range(seed, 'visit-mult:' + i, v.buyer.multMin, v.buyer.multMax) * pay;
    rec.data = { id: 's' + k, k, mult, lasts: v.buyer.lasts };
    rec.text = spoken(words.name, fill(said, { name: g.name, mult: mult.toFixed(1) }))
      + offer({ name: g.name, t: fmtTime(v.buyer.lasts) });
    return rec;
  }

  if (kind === 'bonecart') {
    const bones = Math.max(v.bonecart.floor, boneRef(api) * v.bonecart.seconds);
    const price = cost * v.bonecart.priceSeconds;
    if (!(price > 0)) return null;
    rec.data = { bones, price };
    rec.text = spoken(words.name, said) + offer({ n: fmtCount(bones), coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  if (kind === 'gang') {
    const seconds = range(seed, 'visit-share:' + i, v.gang.secondsMin, v.gang.secondsMax) * pay;
    const n = Math.max(v.gang.floor, Math.floor(api.growthOver(seconds)));
    rec.data = { n };
    rec.text = spoken(words.name, said) + offer({ n: fmtCount(n) });
    return rec;
  }

  if (kind === 'reeve') {
    const price = cost * v.reeve.seconds * Math.pow(v.reeve.priceGrowth, takenOf(state, 'reeve'));
    if (!(price > 0)) return null;
    rec.data = { price };
    rec.text = spoken(words.name, said) + offer({ coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  if (kind === 'relic') {
    const price = cost * v.relic.seconds * Math.pow(v.relic.priceGrowth, takenOf(state, 'relic'));
    if (!(price > 0)) return null;
    const keys = ['dig', 'bones', 'value', 'face'];
    const key = keys[hash(seed, 'visit-boon:' + i) % keys.length];
    const factor = range(seed, 'visit-factor:' + i, v.relic.boonMin, v.relic.boonMax);
    rec.data = { price, key, factor };
    rec.text = spoken(words.name, said) + offer({ coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  if (kind === 'surveyor') {
    const price = cost * v.surveyor.seconds;
    rec.data = { price, reads: v.surveyor.reads };
    rec.text = spoken(words.name, said) + offer({ n: v.surveyor.reads, coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  if (kind === 'preacher' || kind === 'tinker') {
    // Something for a while: twice the bones, or twice the digging, for a
    // few coins in the hat.
    const c = v[kind];
    const price = cost * c.seconds;
    rec.data = { price, key: c.key, factor: c.factor, lasts: c.lasts };
    rec.text = spoken(words.name, said) + offer({ t: fmtTime(c.lasts), x: c.factor, coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  if (kind === 'cups') {
    // A bet on a pea under a cup. Which cup it is under is the seed's, so
    // reloading the page does not change the answer.
    const stake = cost * v.cups.seconds;
    if (!(stake > 0)) return null;
    const won = unit(seed, 'visit-cups:' + i) < v.cups.odds;
    rec.data = { stake, won, pays: v.cups.pays };
    rec.text = spoken(words.name, said) + offer({ x: v.cups.pays, coin: fmtCoin(stake) });
    rec.take = priced(words.take, stake);
    rec.cost = stake;
    return rec;
  }

  if (kind === 'collector') {
    // Something your crew dug up: coin for it now, or relics kept forever.
    const coin = ref * v.collector.seconds;
    if (!(coin > 0)) return null;
    const relics = v.collector.relics;
    rec.data = { coin, relics };
    rec.text = spoken(words.name, said) + offer({ coin: fmtCoin(coin), n: relics });
    return rec;
  }

  if (kind === 'herald') {
    // The next lord's man, when his door is close: pay him and it breaks
    // faster. One per door.
    const d = api.doorAhead(v.herald.within);
    if (!d) return null;
    const price = cost * v.herald.seconds;
    if (!(price > 0)) return null;
    const pct = Math.round((v.herald.ease - 1) * 100);
    rec.name = fill(words.name, { lord: d.lord });
    rec.data = { price, k: d.k, ease: v.herald.ease, lord: d.lord, pct };
    rec.text = spoken(rec.name, fill(said, { lord: d.lord })) + offer({ lord: d.lord, pct, coin: fmtCoin(price) });
    rec.take = priced(words.take, price);
    rec.cost = price;
    return rec;
  }

  // mourner
  const gift = ref * v.mourner.seconds;
  rec.data = { gift };
  rec.text = spoken(words.name, said);
  return rec;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Bring the gate up to date for a step. Sets or clears state.visitor and
 * pushes a line when somebody arrives or gives up waiting.
 *
 * `waiting` is set while the game is catching up on hours the tab was shut.
 * Nobody gives up during those hours and nobody else walks up behind them:
 * the first caller to arrive sits down at the gate and is still there when
 * the player comes back. Running the gate on the same clock during a
 * catch-up expires almost every caller a player is away for, which turns an
 * offer into a penalty for closing the tab.
 */
export function tick(api, events, waiting) {
  const { state, cfg } = api;
  const md = api.mods();
  if (state.visitNext === undefined || state.visitNext === null) begin(state, cfg, md);
  // What a caller handed over for a while and has run out is let go.
  if (Array.isArray(state.spells) && state.spells.length) {
    state.spells = state.spells.filter(x => x && state.t < x.until);
  }

  if (state.visitor) {
    // Doña Calavera's candle keeps a caller at the gate until they are
    // answered, and one who cannot be answered - a buyer for something none
    // of is on hand - would stand there for good with nobody behind them.
    // They go at their time like anybody else.
    const holds = md.callersWait && affordable(api, state.visitor);
    if (!waiting && !holds && state.t >= state.visitor.expires) {
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
  // Who came, and what they said, so the next one is somebody else and the
  // next of this kind says something else.
  if (!Array.isArray(state.visitRecent)) state.visitRecent = [];
  state.visitRecent.push(rec.kind);
  while (state.visitRecent.length > cfg.visitors.recentKeep) state.visitRecent.shift();
  if (!state.visitLines || typeof state.visitLines !== 'object') state.visitLines = {};
  if (!rec.lines) state.visitLines[rec.kind] = rec.line;
  state.visitorsSeen = (state.visitorsSeen || 0) + 1;
  if (events) events.push({ type: 'visitor', text: rec.text });
}

/**
 * Give whoever is at the gate their full wait, counted from now. Called when
 * the game comes back from hours it was closed, so a caller who arrived in
 * the night is not standing there with a minute left on them.
 */
export function refresh(state, cfg) {
  if (!state.visitor) return false;
  state.visitor.expires = state.t + cfg.visitors.stay;
  return true;
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/** Whether the offer at the gate can be taken right now. */
export function affordable(api, rec) {
  if (!rec) return false;
  if (rec.cost > 0 && api.state.coin < rec.cost) return false;
  return true;
}

/** Take the offer. Returns the line to put in the log. */
export function accept(api) {
  const { state } = api;
  const rec = state.visitor;
  if (!rec) return '';
  const words = Lore.visitor(rec.kind);
  const own = lineOf(words, rec);
  // The line that belongs to what the caller said, or the kind's own.
  const say = (key, values) => fill(own[key] || words[key] || '', values);

  if (rec.cost > 0) {
    if (state.coin < rec.cost) return '';
    api.spend(rec.cost);
  }

  let line = '';
  if (rec.kind === 'buyer') {
    const { id, k, mult, lasts } = rec.data;
    api.spell('buyer', 'worth:' + id, mult, lasts);
    line = say('taken', { name: api.ground.at(k).name, mult: mult.toFixed(1), t: fmtTime(lasts) });
  } else if (rec.kind === 'bonecart') {
    api.addBones(rec.data.bones);
    line = say('taken', { n: fmtCount(rec.data.bones) });
  } else if (rec.kind === 'gang') {
    api.raiseFree(rec.data.n);
    line = say('taken', { n: fmtCount(rec.data.n) });
  } else if (rec.kind === 'reeve') {
    api.boon({ value: api.cfg.visitors.reeve.value });
    line = say('taken', { coin: fmtCoin(rec.cost) });
  } else if (rec.kind === 'relic') {
    const b = {}; b[rec.data.key] = rec.data.factor;
    api.boon(b);
    line = say('taken', { boon: describeBoon(b) });
  } else if (rec.kind === 'surveyor') {
    line = say('taken', { reading: api.survey(rec.data.reads) });
  } else if (rec.kind === 'preacher' || rec.kind === 'tinker') {
    const { key, factor, lasts } = rec.data;
    api.spell(rec.kind, key, factor, lasts);
    line = say('taken', { t: fmtTime(lasts), x: factor });
  } else if (rec.kind === 'cups') {
    const { stake, won, pays } = rec.data;
    if (won) api.earn(stake * pays);
    line = say(won ? 'won' : 'lost', { coin: fmtCoin(stake * pays), stake: fmtCoin(stake) });
  } else if (rec.kind === 'collector') {
    api.earn(rec.data.coin);
    line = say('taken', { coin: fmtCoin(rec.data.coin), n: rec.data.relics });
  } else if (rec.kind === 'herald') {
    api.easeDoor(rec.data.k, rec.data.ease);
    line = say('taken', { lord: rec.data.lord, pct: rec.data.pct });
  } else {
    // A mourner. What they leave is priced off what the barrow earns, and a
    // barrow that has earned nothing yet gets no gift and no line about one.
    const gift = rec.data && rec.data.gift > 0 ? rec.data.gift : 0;
    if (gift > 0 && fmtCoin(gift) !== fmtCoin(0)) {
      api.earn(gift);
      line = say('taken', { coin: fmtCoin(gift) });
    } else {
      line = say('nothing');
    }
  }

  state.visitor = null;
  state.visitorsTaken = (state.visitorsTaken || 0) + 1;
  if (LIMITS[rec.kind]) noteTaken(state, rec.kind);
  state.visitNext = state.t + gapFor(state, api.cfg, api.mods(), state.visitCount);
  if (!line) line = own.say || '';
  return line;
}

/** Turn the offer down. Returns the line to put in the log. */
export function decline(api) {
  const { state } = api;
  const rec = state.visitor;
  if (!rec) return '';
  const words = Lore.visitor(rec.kind);
  const own = lineOf(words, rec);
  let line = fill(own.passed || words.passed || '', { lord: rec.data && rec.data.lord });
  // Turned away, the tax man has the carts stopped at the county line.
  if (rec.kind === 'reeve') api.spell('reeve', 'value', api.cfg.visitors.reeve.sting, api.cfg.visitors.reeve.stingLasts);
  if (rec.kind === 'collector') {
    // The collector's other answer: relics instead of coin.
    if (api.addRelics) api.addRelics(rec.data.relics);
    noteTaken(state, rec.kind);
    line = fill(own.passed || words.passed || '', { n: rec.data.relics });
  }
  state.visitor = null;
  state.visitNext = state.t + gapFor(state, api.cfg, api.mods(), state.visitCount);
  return line;
}

/** A boon in the fewest words that still say what it does, the way the upgrades say it. */
export function describeBoon(boon) {
  const names = {
    dig: 'dig speed',
    bones: 'bones found',
    value: 'prices',
    face: 'dig-down speed',
    soft: 'diggers per bone',
  };
  const parts = [];
  for (const key of Object.keys(boon)) {
    const pct = Math.round((boon[key] - 1) * 100);
    if (key === 'windfall' || key === 'diggers' || key === 'rem') continue;
    parts.push('+' + pct + '% ' + (names[key] || key));
  }
  return parts.join(', ') + '.';
}
