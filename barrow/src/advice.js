// ---------------------------------------------------------------------------
// The one line at the top of the page: what is most worth doing right now.
//
// An idle game that has taught a player nothing still has to answer one
// question every time they look at it - what do I press. This is an ordered
// list of conditions over the live state; the first one that holds wins, and
// it returns a key plus the figures behind it. The page turns the key into a
// sentence (config.text.compass) and, when the answer is off the bottom of a
// scrolling column, offers to scroll to the panel that holds it.
//
// Two rules keep it honest. Every branch names its key as a literal in the
// call, so the suite can scan this file for them and check that each one has
// a sentence and that no sentence is written for a key nothing reaches. And
// every value in a line is measured off the state as it stands, never a
// constant chosen here.
//
// The order is a claim about the game: a caller who leaves beats a purchase
// that will still be there in a minute, work the player is not doing beats
// anything they could buy, and filling the barrow in - which ends the run -
// is named only when what it pays is what carries them over the cheapest
// thing they can keep, which is to say only when ending the run buys
// something that outlasts it.
// ---------------------------------------------------------------------------

import * as H from './horde.js?v=20';
import * as R from './rites.js?v=20';
import * as Rb from './rebirth.js?v=20';
import * as Lore from './lore.js?v=20';
import { fmt, fmtCoin, fmtCount, fmtRate, fmtTime } from './numbers.js?v=20';

/** How much better a layer has to pay per notch before the line says to move one. */
const MOVE_RATIO = 4;
/** How many more of the horde a raise has to add before the line asks for it. */
const RAISE_SHARE = 0.1;

const say = (key, values, target) => ({ key, values: values || {}, target: target || null });

/** The cheapest rite the player could buy right now, and the cheapest of all. */
function riteChoice(sim, cfg) {
  const s = sim.state;
  let best = null, next = null;
  for (const def of R.visible(s, cfg)) {
    if (R.maxed(s, def)) continue;
    const price = R.cost(def, R.levelOf(s, def.id));
    if (price <= s.coin) { if (!best || price < best.price) best = { def, price }; }
    if (!next || price < next.price) next = { def, price };
  }
  return { best, next };
}

/** The cheapest permanent upgrade not yet held, and whether it is paid for. */
function oathChoice(sim, cfg, relics) {
  let cheapest = null;
  for (const def of Rb.oathDefs(cfg)) {
    if (Rb.oathMaxed(sim.legacy, def)) continue;
    const price = Rb.oathCost(def, Rb.oathLevel(sim.legacy, def.id));
    if (!cheapest || price < cheapest.price) cheapest = { def, price };
  }
  if (!cheapest) return null;
  cheapest.afford = relics >= cheapest.price;
  return cheapest;
}

/**
 * What each worked layer pays for the share of the diggers it has, so two
 * rows can be compared on the same axis. Only used when the player has
 * asked to place the diggers themselves.
 */
function perNotch(sim) {
  const rates = sim.layerRates();
  const s = sim.state;
  const out = [];
  for (const [key, r] of rates) {
    if (key === 'face') continue;
    const w = s.weights[key] || 0;
    if (!(w > 0) || !(r.coin > 0)) continue;
    out.push({ k: Number(key), w, per: r.coin / w });
  }
  out.sort((a, b) => a.per - b.per);
  return out;
}

/**
 * The single most useful thing to do, as a key and the figures behind it.
 * Pure: it reads the simulation and changes nothing.
 */
export function next(sim, cfg) {
  const s = sim.state;
  const f = s.flags;
  const md = sim.mods();
  const name = (k) => Lore.inline(sim.ground.at(k).name);

  // A room stops nothing but it is the only choice on the page that is gone
  // once it is answered.
  if (s.chamber) return say('room', {}, 'chamber-panel');

  // Somebody at the gate leaves on a clock; everything else waits.
  const v = s.visitor;
  if (v) {
    if (v.kind === 'buyer' && !(sim.held(v.data.id) > 1e-9)) {
      return say('gateEmpty', { name: name(v.data.k) }, 'visitor-panel');
    }
    if (v.cost > 0 && s.coin < v.cost) {
      return say('gateCoin', { cost: fmtCoin(v.cost), coin: fmtCoin(s.coin) }, 'visitor-panel');
    }
    return say('gate', { t: fmtTime(Math.max(0, v.expires - s.t)) }, 'visitor-panel');
  }

  // Before there is a horde there is a hand, and one button.
  const raiseOne = H.raiseCost(s.horde, cfg.horde, md.softMult);
  if (s.horde < 1) {
    if (s.bones + 1e-9 < raiseOne) {
      const per = s.hand.digs < cfg.hand.firstBoneAt
        ? cfg.hand.firstBoneAt
        : Math.max(1, Math.round(1 / cfg.hand.bonesPerDig));
      return say('dig', { n: per }, 'hand');
    }
    return say('raise', { bones: fmt(Math.floor(s.bones * 10) / 10), cost: fmt(raiseOne) }, 'horde-panel');
  }

  // The first coin comes off the hand, before there is a market to sell into.
  if (f.sell && !f.market && s.totals.earned <= 0) {
    const units = s.stock.s0 || 0;
    if (units >= 1) {
      return say('sell', { n: fmt(units), name: name(0), coin: fmtCoin(sim.quote('s0', units)) }, 'hand');
    }
  }

  // These two only ever fire for a player who asked to place the diggers
  // themselves. Left to the game they cannot happen: the way down is always
  // staffed and no layer is ever worked past what its buyers will take.
  if (f.face && s.byHand && !(s.faceWeight > 0)) {
    return say('face', { name: cfg.text.face, next: name(s.depth + 1) }, 'horde-panel');
  }

  // A layer whose buyers filled up hours ago against one that is paying.
  const rows = s.byHand ? perNotch(sim) : [];
  if (rows.length > 1) {
    const low = rows[0], high = rows[rows.length - 1];
    if (high.per >= low.per * MOVE_RATIO) {
      return say('move', {
        from: name(low.k), name: name(high.k),
        low: fmtCoin(low.per), high: fmtCoin(high.per),
      }, 'horde-panel');
    }
  }

  // Bones buy nothing else, and the horde is the only thing that compounds.
  const canRaise = H.maxRaisable(s.bones, s.horde, cfg.horde, md.softMult);
  if (canRaise >= Math.max(1, s.horde * RAISE_SHARE)) {
    return say('raiseMore', { bones: fmt(Math.floor(s.bones)), n: fmtCount(canRaise) }, 'horde-panel');
  }

  const relics = sim.legacy.remembrance || 0;
  const oath = oathChoice(sim, cfg, relics);
  const pending = sim.canSeal() ? sim.sealYield() : 0;
  const rites = riteChoice(sim, cfg);

  // Relics already banked and something they will buy. Free, instant, and it
  // does not end the run, so it comes before anything that does.
  if (oath && oath.afford) {
    return say('oath', { n: fmt(relics), name: Lore.oath(oath.def.id).name, cost: fmt(oath.price) }, 'tab-oaths');
  }

  // Filling the barrow in when it genuinely pays best. Coin buys things that
  // go back in the hole with everything else; relics buy things that hold in
  // every barrow after, so once filling in reaches something permanent that
  // the relics in hand will not, it is the better move and the line says so
  // with both figures on it. It never presses anything: ending a run is his.
  if (pending > 0 && oath && relics + pending >= oath.price) {
    const words = { n: fmt(pending), name: Lore.oath(oath.def.id).name, cost: fmt(oath.price) };
    if (rites.best) {
      words.buy = R.wordsOf(rites.best.def.id).name;
      words.coin = fmtCoin(rites.best.price);
      return say('sealBeats', words, 'seal-panel');
    }
    return say('seal', words, 'seal-panel');
  }

  if (rites.best) {
    const words = R.wordsOf(rites.best.def.id);
    return say('rite', { name: words.name, cost: fmtCoin(rites.best.price), line: words.line }, 'rites-panel');
  }

  // Nothing on the page can be pressed. Say how long that lasts.
  if (rites.next) {
    const short = rites.next.price - s.coin;
    if (s.rate > 0) {
      return say('wait', {
        name: R.wordsOf(rites.next.def.id).name, cost: fmtCoin(rites.next.price),
        t: fmtTime(short / s.rate), rate: fmtRate(s.rate),
      }, 'rites-panel');
    }
  }

  // The dead are working and there is nothing to press. Say what they are on.
  const rates = sim.layerRates();
  let bestCoin = null, bestBones = null;
  for (const [key, r] of rates) {
    if (r.coin > 0 && (!bestCoin || r.coin > bestCoin.coin)) bestCoin = { key, coin: r.coin };
    if (r.bones > 0 && (!bestBones || r.bones > bestBones.bones)) bestBones = { key, bones: r.bones };
  }
  if (bestCoin) {
    return say('work', { name: Lore.label(sim.ground.at(Number(bestCoin.key)).name), coin: fmtCoin(bestCoin.coin) }, null);
  }
  if (bestBones) {
    const k = bestBones.key === 'face' ? s.depth + 1 : Number(bestBones.key);
    return say('bones', { name: Lore.label(sim.ground.at(k).name), bones: fmt(bestBones.bones) }, null);
  }
  return say('idle', {}, 'horde-panel');
}

/** Every key `next` can return, for the suite and for nothing else. */
export const KEYS = [
  'room', 'gateEmpty', 'gateCoin', 'gate', 'dig', 'raise', 'sell', 'face',
  'move', 'raiseMore', 'oath', 'sealBeats', 'seal', 'rite', 'wait', 'work', 'bones', 'idle',
];

// Named so a reader of this file can see the two the ordering is built around
// without running it: nothing is bought while a caller is waiting, and the
// seal is never named ahead of work the player can do without ending the run.
export const RATIOS = { MOVE_RATIO, RAISE_SHARE };
