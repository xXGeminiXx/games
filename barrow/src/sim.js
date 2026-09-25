// ---------------------------------------------------------------------------
// The simulation: one state, one step, and the actions a player can take.
//
// Everything one barrow is lives in `state`, a plain object a save can hold.
// What carries between barrows lives in `legacy`, which the simulation reads
// and never writes except when a run is sealed.
//
// A step is dt seconds of the horde digging, what it dug going for what it
// is worth, the gate being watched and the reveal flags catching up. The step
// size is free: every rate is continuous, so a second stepped once and a
// second stepped ten times land in the same place. That is what lets the time
// away be caught up in coarse chunks.
//
// There is no market. Every material has a worth - its layer's, lifted by
// the run's boons - and whatever the dead dig is sold at that worth the moment
// it comes up. What the player decides is where the crew stands, what coin
// buys and how deep to go.
//
// Events come back from every step and action as plain records carrying the
// line they want said. The simulation never touches the page.
// ---------------------------------------------------------------------------

import { CONFIG as DEFAULT } from '../config.js?v=46';
import * as Mat from './materials.js?v=46';
import * as H from './horde.js?v=46';
import * as Crew from './crew.js?v=46';
import * as R from './rites.js?v=46';
import * as Rv from './reveal.js?v=46';
import * as Ch from './chambers.js?v=46';
import * as Vi from './visitors.js?v=46';
import * as Rb from './rebirth.js?v=46';
import * as Lore from './lore.js?v=46';
import * as Lords from './lords.js?v=46';
import * as Ranks from './ranks.js?v=46';
import { createGround } from './ground.js?v=46';
import { hash } from './rng.js?v=46';
import { fill } from '../config.js?v=46';
import { fmt, fmtCoin } from './numbers.js?v=46';

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
    tuned: {},            // layer -> true once the player has set this row
    byHand: false,        // the player took the splitting over; nothing forces this
    faceWeight: 0,        // where the way down sits when it is set by hand
    capProgress: 0,
    stock: {},            // good id -> units held
    seen: {},             // good id -> true once its market has been on the table
    rites: {},            // rite id -> level
    boons: {},            // standing multipliers taken in chambers and bought
    read: {},             // layer -> true once its seam is known before opening
    chamber: null,        // the room waiting to be answered
    chambersDone: {},     // layer -> the offer taken there
    chamberQueue: [],     // rooms found while an earlier one was unanswered
    doors: {},            // layer -> true once the lord's door into it is broken
    hill: null,           // which hill this barrow is dug in; null is a plain one
    doorsV: 1,            // set on every run that has had doors from its start
    visitor: null,        // who is at the gate
    visitNext: null,      // when the next one comes
    visitCount: 0,
    visitorsSeen: 0, visitorsTaken: 0, visitorsMissed: 0,
    visitorsBought: {},   // kind -> how many of it this barrow has taken
    marketGone: 1,        // begun after the market came out of the game
    visitRecent: [],      // the last few kinds that came, newest last
    spells: [],           // what callers handed over for a while
    doorEase: {},         // door layer -> how much easier a herald made it
    remBonus: 0,          // remembrance promised by chambers
    hand: { digs: 0 },
    effort: [],           // digger-seconds spent per layer, for the drawing
    worked: [],           // seconds of the whole crew spent on each layer, for the hollow
    finds: {},            // layer -> how many of its finds have been turned up
    flags: {},            // reveal flags, monotonic
    fired: {},            // log lines that have gone out, once each
    milestones: { horde: 0, depth: 0 },
    totals: { dug: 0, raised: 0, sold: 0, earned: 0, spent: 0, buckled: 0 },
    income: [],           // [t, coin] samples for the coin/s figure
    rate: 0,
    log: [],              // the last lines said, newest first
  };
}

/**
 * How many seconds of digging a stretch nobody watched is worth. The first
 * minute counts in full, so a look at another tab costs nothing; the rest is
 * dug at the away pace.
 */
export function awayWork(seconds, time, awayPace) {
  if (!(seconds > 0)) return 0;
  const p = awayPace === undefined ? time.awayPace : awayPace;
  const pace = p > 0 ? Math.min(1, p) : 1;
  const grace = Math.min(seconds, time.awayGrace > 0 ? time.awayGrace : 0);
  return grace + (seconds - grace) * pace;
}

export function createSim(cfg = DEFAULT, opts = {}) {
  const seed = (opts.seed === undefined ? (Math.random() * 4294967296) : opts.seed) >>> 0;
  const state = opts.state || freshState(cfg, seed);
  const legacy = opts.legacy || Rb.freshLegacy();
  const ground = createGround(cfg, state.seed, Rb.hillRule(cfg, state.hill));
  const mods = () => R.modsOf(state, cfg, legacy);
  // A save from before ranks gets credit for what it had already done.
  if (legacy.renown === null || legacy.renown === undefined) legacy.renown = Ranks.fromHistory(legacy, cfg);
  // A save from before the crew milestones paid has reached, at the least,
  // the ones this run's crew already passed; they are not paid twice.
  if (!(legacy.crewMark > 0)) {
    const biggest = Math.max((legacy.best && legacy.best.horde) || 0, state.horde || 0);
    const hm0 = Lore.CONTENT.log.hordeMilestones;
    let n = 0;
    while (n < hm0.length && biggest >= hm0[n][0]) n++;
    if (n > 0) legacy.crewMark = n;
  }
  if (!legacy.trophies) legacy.trophies = {};
  if (!legacy.lordsMet) legacy.lordsMet = {};

  const activeFrom = () => H.activeFrom(state.depth, cfg.horde, mods().activeStrata);

  /** How much a buyer at the gate is paying over the odds for one material, right now. */
  const buyerFor = (id) => {
    let f = 1;
    for (const sp of (Array.isArray(state.spells) ? state.spells : [])) {
      if (sp && sp.key === 'worth:' + id && state.t < sp.until && sp.factor > 0) f *= sp.factor;
    }
    return f;
  };

  /**
   * What one unit of a material fetches: its layer's worth, the run's boons
   * on everything, and a buyer at the gate who wants that one in particular.
   */
  const worthOf = (id, md) => {
    const k = Mat.strataOf(id);
    if (k < 0) return 0;
    return ground.at(k).value * (md || mods()).valueMult * buyerFor(id);
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
      const i = state.milestones.horde;
      let text = hm[i][1];
      // The first time ever a crew this size stands up, it pays relics: the
      // biggest crew a player has had is a record like the deepest layer.
      const pay = cfg.lords ? cfg.lords.crewRelics * (i + 1) : 0;
      if (pay > 0 && i >= (legacy.crewMark || 0) && opened()) {
        legacy.crewMark = i + 1;
        legacy.remembrance = (legacy.remembrance || 0) + pay;
        legacy.earned = (legacy.earned || 0) + pay;
        text += ' ' + fill(Lore.doors().crew, { relics: pay });
      }
      events.push({ type: 'log', key: 'hordeMilestone', text });
      state.milestones.horde += 1;
    }
    const dm = Lore.CONTENT.log.depthMilestones;
    while (state.milestones.depth < dm.length && state.depth >= dm[state.milestones.depth][0]) {
      events.push({ type: 'log', key: 'depthMilestone', text: dm[state.milestones.depth][1] });
      state.milestones.depth += 1;
    }
  };

  /**
   * Sell everything the dead have brought up at what it is worth. Called
   * after every dig, so nothing is ever held: a material is coin the moment
   * it reaches the top.
   */
  const cashIn = (events, md) => {
    let coin = 0;
    for (const id of Object.keys(state.stock)) {
      const q = state.stock[id];
      if (!(q > 0)) continue;
      coin += q * worthOf(id, md);
      state.totals.sold += q;
      state.stock[id] = 0;
      if (!state.seen[id]) {
        state.seen[id] = true;
        const k = Mat.strataOf(id);
        // Said for the first couple of materials, while a new player is
        // still learning that deeper is worth more. After that every layer
        // would say it, and a line said every layer is a line nobody reads.
        if (events && k > 0 && k <= 2) fire(events, 'market:' + id, 'newMarket', { name: ground.at(k).name }, String(k));
      }
    }
    earn(coin);
    if (coin > 0 && events) fire(events, 'firstSale', 'firstSale');
    return coin;
  };

  /**
   * Mark the ground below the cut as known, as far ahead as anything bought
   * reads. The panel and the hill both show a layer's name and its seam once
   * it is in here, so this is where reading ahead turns into something on
   * screen.
   */
  const readAhead = () => {
    const md = mods();
    let n = md.readAhead;
    // The lamp names everything down to the next lord's door.
    if (md.readToDoor && cfg.lords) n = Math.max(n, Lords.nextDoor(state.depth + 1, cfg) - state.depth);
    if (!(n > 0)) return;
    if (!state.read) state.read = {};
    for (let i = 1; i <= n; i++) state.read[state.depth + i] = true;
  };

  /** The line a newly opened layer says about the ground it turned out to be. */
  const seamLine = (events, k) => {
    const layer = ground.at(k);
    if (!layer.seam) return;
    const words = Lore.seam(layer.seam.id);
    if (!words) return;
    if (state.fired['seam:' + k]) return;
    fire(events, 'seam:' + k, 'seamFound', { name: layer.name, seam: words.here || words.tag, line: words.line }, String(k));
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
   * What the crew turns up as it digs a layer out: a find at each mark in
   * config.finds.at, paid once, the last one the layer cleared. Sized in
   * seconds of what the barrow earns and of the bones it turns up, so a find
   * is worth the same share of a run however far along it is. While nobody is
   * watching they are paid without a line each, so a night away does not
   * come back as a page of them; the away line has the coin and bones.
   */
  const turnUp = (events, md) => {
    const F = cfg.finds;
    const T = cfg.view && cfg.view.clearSeconds;
    if (!F || !(T > 0)) return;
    if (!state.finds || typeof state.finds !== 'object') state.finds = {};
    const words = Lore.finds();
    for (let k = activeFrom(); k <= state.depth; k++) {
      const frac = (state.worked[k] || 0) / T;
      let paid = state.finds[k] || 0;
      while (paid < F.at.length && frac >= F.at[paid] - 1e-9) {
        const mult = md.findsMult || 1;
        const coin = steadyIncome() * (F.coinSeconds[paid] || 0) * mult;
        const bones = boneRate() * (F.boneSeconds[paid] || 0) * mult;
        earn(coin);
        if (bones > 0) state.bones += bones;
        const last = paid === F.at.length - 1;
        if (events && words) {
          const item = words.items[hash(state.seed, 'find:' + k + ':' + paid) % words.items.length];
          const text = fill(last ? words.cleared : words.found, {
            item, name: ground.at(k).name, coin: fmtCoin(coin), bones: fmt(bones),
          });
          events.push({ type: 'log', key: last ? 'cleared' : 'found', text });
        }
        paid++;
      }
      state.finds[k] = paid;
    }
  };

  /** Drop the empty entries for layers left behind, so a long run stays small. */
  const tidy = () => {
    const from = activeFrom();
    for (const id of Object.keys(state.stock)) {
      const k = Mat.strataOf(id);
      if (!(state.stock[id] > 1e-9) && k >= 0 && k < from - 1) delete state.stock[id];
    }
  };

  // -- chambers -------------------------------------------------------------

  /** Put a room or a lord in front of the player, or behind whoever is already there. */
  const present = (events, room) => {
    // Only one waits at a time; a second one found while the first is
    // unanswered is simply the one that comes after it. A room is queued by
    // its layer and rebuilt; a lord is queued whole, because what he says
    // depends on whether this was the first time.
    if (state.chamber) state.chamberQueue = (state.chamberQueue || []).concat(room.kind === 'lord' ? [room] : [room.k]);
    else state.chamber = room;
    events.push({ type: 'chamber', k: room.k, kind: room.kind || 'room' });
  };

  const openChamber = (events, k) => {
    if (state.chambersDone[k]) return;
    const room = Ch.chamberAt(state.seed, k, cfg, ground);
    if (!room) return;
    present(events, room);
    for (const l of room.lines) events.push({ type: 'log', text: l });
  };

  const nextChamber = () => {
    const queue = state.chamberQueue || [];
    while (queue.length) {
      const q = queue.shift();
      if (q && typeof q === 'object') {
        if (state.chambersDone[q.k]) continue;
        state.chamber = q;
        return;
      }
      if (state.chambersDone[q]) continue;
      const room = Ch.chamberAt(state.seed, q, cfg, ground);
      if (room) { state.chamber = room; return; }
    }
    state.chamber = null;
  };

  // -- the lords ------------------------------------------------------------

  /**
   * Rank points, and the line that says so when they carry the player up a
   * rank, with whatever that rank hands over.
   */
  const addRenown = (events, pts) => {
    const before = Ranks.rankOf(legacy.renown || 0, cfg);
    legacy.renown = (legacy.renown || 0) + pts;
    const after = Ranks.rankOf(legacy.renown, cfg);
    if (after <= before) return;
    const D = Lore.doors();
    const key = cfg.ranks.keys.find(k => k.rank > before && k.rank <= after);
    events.push({ type: 'log', key: 'rankUp', text: fill(D.rankUp, { name: Ranks.nameOf(after, cfg) })
      + (key ? ' ' + Lore.rankKey(key.id) : '') });
  };

  /** A lord in front of the player: what he says, and his two gifts. */
  const hallFor = (door, first) => {
    const lord = door.lord;
    const words = Lore.lord(lord.id);
    const lines = (first ? words.meet : words.again).slice();
    for (const a of lord.affixes) {
      const aw = Lore.affix(a.id);
      if (aw.line) lines.push(aw.name + ': ' + aw.line);
    }
    return {
      k: door.k,
      kind: 'lord',
      lord: lord.id,
      first: !!first,
      title: Lords.nameOf(lord),
      lines,
      offers: lord.def.gifts.map((boon, i) => ({
        i, name: words.gifts[i].name, line: words.gifts[i].line, boon,
      })),
    };
  };

  /**
   * A lord's door has given way. His hoard is paid on the spot - coin priced
   * in seconds of income, never a share of anything, and relics that go
   * straight into what carries over - and the first time a player ever breaks
   * a given lord, his trophy is theirs for good.
   */
  const breakDoor = (events, k) => {
    const door = ground.at(k).door;
    if (!door || (state.doors && state.doors[k])) return;
    if (!state.doors) state.doors = {};
    state.doors[k] = true;
    const lord = door.lord;
    const md = mods();
    const L = cfg.lords;
    const coin = steadyIncome() * L.hoardSeconds * lord.hoard * md.hoardMult;
    earn(coin);
    const relics = Math.round(L.hoardRelics * Lords.doorNumber(door.r, cfg) * lord.hoard * md.hoardMult);
    legacy.remembrance = (legacy.remembrance || 0) + relics;
    legacy.earned = (legacy.earned || 0) + relics;
    const first = !legacy.trophies[lord.id];
    legacy.trophies[lord.id] = true;
    legacy.lordsMet[lord.id] = (legacy.lordsMet[lord.id] || 0) + 1;
    const D = Lore.doors();
    const words = Lore.lord(lord.id);
    events.push({ type: 'door', k, lord: lord.id, first, coin, relics });
    events.push({ type: 'log', key: 'door', text: fill(D.broke, { name: Lords.shortName(lord), his: words.his || 'his', coin: fmtCoin(coin), n: fmt(relics) }) });
    if (first && words.trophy) {
      events.push({ type: 'log', key: 'trophy', text: fill(D.trophy, { name: words.trophy.name, line: words.trophy.line }) });
    }
    // And what he hands over beside it, never for sale.
    if (first && words.power) {
      events.push({ type: 'log', key: 'power', text: fill(D.trophy, { name: words.power.name, line: words.power.line }) });
    }
    present(events, hallFor(door, first));
    addRenown(events, first ? cfg.ranks.points.firstLord : cfg.ranks.points.door);
  };

  /**
   * Whether the lords' part of the game has opened for this player: their
   * first door broken, or a barrow filled in before there were lords. Until
   * then the opening is the old one - dig, sell, raise, one thing at a time -
   * and relics, rank and the new-best rewards wait for Rex Mortis.
   */
  const opened = () => (legacy.seals || 0) > 0 || Object.keys(legacy.trophies || {}).length > 0;

  /**
   * Every layer deeper than the player has ever been pays relics and a point
   * of rank the moment it opens. Beating a best is always worth something.
   */
  const newDepth = (events, k) => {
    if (!legacy.best) legacy.best = { depth: 0, earned: 0, horde: 0 };
    if (!(k > (legacy.best.depth || 0))) return;
    legacy.best.depth = k;
    if (!opened()) return;
    const relics = cfg.lords ? cfg.lords.newDepthRelics : 0;
    if (relics > 0) {
      legacy.remembrance = (legacy.remembrance || 0) + relics;
      legacy.earned = (legacy.earned || 0) + relics;
    }
    // Said on the end of the line that announces the layer, so a first run
    // - where every layer is the deepest yet - does not say two lines a layer.
    const note = fill(Lore.doors().newDepth, { n: k + 1, relics });
    let said = false;
    for (let i = events.length - 1; i >= 0 && !said; i--) {
      const e = events[i];
      if (e.type === 'log' && e.once === 'break:' + k) { e.text += ' ' + note; said = true; }
    }
    if (!said) events.push({ type: 'log', key: 'newDepth', text: note });
    addRenown(events, cfg.ranks.points.newDepth);
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
    if (out.windfall > 0) earn(steadyIncome() * Math.min(out.windfall, cfg.chambers.windfallCap));
    if (out.diggers > 0) {
      const n = growthOver(out.diggers * cfg.chambers.diggerSeconds);
      H.raiseFree(state, Math.max(1, Math.floor(n)));
    }
    if (out.rem > 0) state.remBonus = (state.remBonus || 0) + out.rem;
  };

  /**
   * What a second of this barrow is worth, for anything paid in seconds of
   * income. The coin/s figure counts sales over the last ten seconds, and a
   * seller who only sells above the usual price can go quiet for longer than
   * that - a hoard priced off it once paid nothing. So it is the largest of
   * that figure, what the diggers are turning up per second where they stand,
   * and what they would turn up standing where the game would put them.
   *
   * The last one is for a player who has placed the crew by hand, all of it
   * on the way down: nobody is digging anything to sell, so the first two
   * read nothing, and every gift, hoard and caller priced off them came to 0
   * coin. Where the crew stands is a choice about how fast to go down, and it
   * does not make a lord's hoard any smaller.
   */
  const steadyIncome = () => {
    const coinOf = (sp) => {
      let made = 0;
      try { for (const r of layerRates(sp).values()) made += r.coin || 0; } catch (e) { made = 0; }
      return Number.isFinite(made) ? made : 0;
    };
    const rate = Number.isFinite(state.rate) ? state.rate : 0;
    const here = coinOf(null);
    const best = state.byHand ? coinOf(Crew.bestSplit(crewApi)) : here;
    return Math.max(0, rate, here, best);
  };

  /**
   * What the crew is actually bringing in a second where it stands: the coin
   * figure, or what the diggers turn up at the price their flow holds. This
   * is what a player can count on to pay for something, where steadyIncome is
   * what the barrow is worth.
   */
  const earningNow = () => {
    let made = 0;
    try { for (const r of layerRates().values()) made += r.coin || 0; } catch (e) { made = 0; }
    const rate = Number.isFinite(state.rate) ? state.rate : 0;
    return Math.max(0, rate, Number.isFinite(made) ? made : 0);
  };

  /** How many the horde would raise, unaided, in `seconds` at its present rate. */
  const growthOver = (seconds) => {
    const md = mods();
    const bones = boneRate() * seconds;
    return H.maxRaisable(bones, state.horde, cfg.horde, md.softMult);
  };

  /**
   * Where the diggers stand. The game works it out from what each layer pays
   * a digger, and keeps working it out as the run changes, so a player who
   * never opens the panel is never behind one who does. It is only read off
   * the rows when the player has asked to set it by hand.
   */
  const crewApi = { state, cfg, ground, mods, worthOf };
  const split = () => {
    if (state.byHand) return H.distribute(state.weights, state.faceWeight, activeFrom());
    return Crew.bestSplit(crewApi);
  };

  /** Bones per second the horde is turning up as it currently stands. */
  const boneRate = () => {
    const md = mods();
    const from = activeFrom();
    const sp = split();
    let q = 0;
    for (let k = from; k <= state.depth; k++) q += (sp.strata[k] || 0) * ground.at(k).bones;
    q += sp.face * ground.at(state.depth + 1).bones;
    return q * state.horde * cfg.horde.digRate * md.boneMult;
  };

  /**
   * What every open layer and the way down are making right now, at the
   * weights as they stand: coin per second at what each material is worth,
   * and bones per second.
   */
  const layerRates = (given) => {
    const md = mods();
    const from = activeFrom();
    const sp = given || split();
    const perSec = state.horde * cfg.horde.digRate * md.digMult;
    const diggerSeconds = state.horde * cfg.horde.digRate;
    const rows = new Map();
    for (let k = from; k <= state.depth; k++) {
      const share = sp.strata[k] || 0;
      const layer = ground.at(k);
      const parts = [];
      let coin = 0;
      if (share > 0) {
        const units = perSec * share / layer.hardness;
        for (const part of ground.mixAt(k)) {
          const id = 's' + part.k;
          const q = units * part.share;
          parts.push({ id, q });
          coin += q * worthOf(id, md);
        }
      }
      rows.set(k, { share, parts, coin, bones: diggerSeconds * share * layer.bones * md.boneMult });
    }
    // The dead on the way down bring up no goods, only the bones of the layer
    // they are breaking into.
    rows.set('face', {
      share: sp.face, parts: [], coin: 0,
      bones: diggerSeconds * sp.face * ground.at(state.depth + 1).bones * md.boneMult,
    });
    return rows;
  };

  const takeOffer = (index) => {
    const events = [];
    const room = state.chamber;
    if (!room) return { events };
    const offer = room.offers[index | 0];
    if (!offer) return { events };
    // With the rank for it a lord hands over both of his gifts, whichever
    // button was pressed.
    const both = room.kind === 'lord' && mods().bothGifts;
    for (const o of (both ? room.offers : [offer])) {
      payBoon(Ch.applyBoon(state, o.boon));
      events.push({ type: 'log', text: (room.kind === 'lord' ? o.name + ': ' : '') + o.line });
    }
    state.chambersDone[room.k] = offer.name;
    nextChamber();
    announce(events, Rv.update(state, cfg, legacy));
    milestones(events);
    return { events };
  };

  /**
   * With the rank that hands over both of a lord's gifts there is nothing to
   * pick between, so no lord waits to be answered: what he says goes in the
   * log and both gifts are handed over, whether he is in front of the player,
   * queued behind a room, or was left waiting in a save from before.
   */
  const takeLordsGifts = (events) => {
    if (!mods().bothGifts) return;
    const say = (room) => {
      const line = room.lines && room.lines[0];
      if (line) events.push({ type: 'log', text: room.title + ': ' + line });
    };
    const queue = state.chamberQueue || [];
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (!q || typeof q !== 'object' || q.kind !== 'lord') continue;
      queue.splice(i, 1);
      if (state.chambersDone[q.k]) continue;
      say(q);
      for (const o of q.offers) {
        payBoon(Ch.applyBoon(state, o.boon));
        events.push({ type: 'log', text: o.name + ': ' + o.line });
      }
      state.chambersDone[q.k] = q.offers.length ? q.offers[0].name : true;
    }
    let guard = 0;
    while (state.chamber && state.chamber.kind === 'lord' && guard++ < 50) {
      say(state.chamber);
      for (const e of takeOffer(0).events) events.push(e);
    }
  };

  /**
   * Rooms still waiting when the barrow fills itself in. Everything a room
   * offers lasts the rest of this barrow, which is nothing once it is filled
   * in - except relics, which the fill-in pays out. So a waiting room that
   * offers relics is answered with that offer, the rest are left where they
   * are, and the barrow fills in at the layer the player set rather than
   * digging on until somebody comes back to answer a room.
   */
  const answerForFillIn = () => {
    const events = [];
    takeLordsGifts(events);
    const rooms = state.chamber ? [state.chamber] : [];
    for (const q of state.chamberQueue || []) {
      if (q && typeof q === 'object') rooms.push(q);
      else if (!state.chambersDone[q]) {
        const room = Ch.chamberAt(state.seed, q, cfg, ground);
        if (room) rooms.push(room);
      }
    }
    for (const room of rooms) {
      if (state.chambersDone[room.k]) continue;
      const o = room.offers.find(x => x.boon && x.boon.rem > 0);
      if (!o) continue;
      payBoon(Ch.applyBoon(state, o.boon));
      events.push({ type: 'log', text: (room.kind === 'lord' ? o.name + ': ' : '') + o.line });
      state.chambersDone[room.k] = o.name;
    }
    // The barrow is filled in next, and nothing else in these rooms outlives it.
    state.chamber = null;
    state.chamberQueue = [];
    return events;
  };

  // -- visitors -------------------------------------------------------------

  /** What the gate is allowed to reach into. Nothing else is exposed to it. */
  const visitorApi = {
    state, cfg, ground,
    mods, earn, spend, worthOf,
    strataOf: Mat.strataOf,
    boneRate,
    growthOver,
    income: () => steadyIncome(),
    earning: () => earningNow(),
    addBones: (n) => { if (n > 0) state.bones += n; },
    raiseFree: (n) => H.raiseFree(state, n),
    boon: (b) => payBoon(Ch.applyBoon(state, b)),
    survey: (n) => {
      const names = [];
      for (let i = 1; i <= n; i++) {
        const k = state.depth + i;
        state.read[k] = true;
        const layer = ground.at(k);
        const words = layer.seam ? Lore.seam(layer.seam.id) : null;
        names.push(layer.name + (words ? ' (' + words.tag + ')' : ''));
      }
      return fill(Lore.visitor('surveyor').reading, { name: names.join(', ') });
    },
    // The shallowest layer the crew still works, for a buyer deciding what
    // to ask for.
    activeFrom: () => activeFrom(),
    // Relics wait for the first lord's door, like every other relic.
    relicsOpen: () => opened(),
    addRelics: (n) => {
      if (!(n > 0)) return;
      legacy.remembrance = (legacy.remembrance || 0) + n;
      legacy.earned = (legacy.earned || 0) + n;
    },
    // Something a caller hands over for a while. A second one from the same
    // caller while the first is still running starts the clock again from
    // now; it neither doubles it again nor adds the time on, so a player
    // whose callers come every minute cannot keep it running for good.
    spell: (from, key, factor, seconds) => {
      if (!Array.isArray(state.spells)) state.spells = [];
      const live = state.spells.find(x => x && x.from === from && x.key === key && state.t < x.until);
      if (live) live.until = Math.max(live.until, state.t + seconds);
      else state.spells.push({ from, key, factor, until: state.t + seconds });
    },
    // The next lord's door below the dig, when it is close enough for his
    // herald to come up the track and nobody has paid him yet.
    doorAhead: (within) => {
      if (!cfg.lords) return null;
      const k = Lords.nextDoor(state.depth, cfg);
      if (!(k > state.depth && k - state.depth <= within)) return null;
      if (state.doorEase && state.doorEase[k]) return null;
      const door = ground.at(k).door;
      if (!door) return null;
      return { k, lord: Lords.shortName(door.lord), togo: k - state.depth };
    },
    easeDoor: (k, factor) => {
      if (!state.doorEase || typeof state.doorEase !== 'object') state.doorEase = {};
      state.doorEase[k] = factor;
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

  const step = (dt, unwatched) => {
    const events = [];
    if (!(dt > 0)) return events;
    const md = mods();

    const sp = split();
    // A hungry lord eats some of the crew working his door, every minute it
    // stands.
    const target = ground.at(state.depth + 1);
    if (target.door && sp.face > 0 && state.horde > 0) {
      let eats = 0;
      for (const a of target.door.lord.affixes) eats += a.eats || 0;
      if (eats > 0) {
        const lost = Math.min(state.horde - 1, state.horde * sp.face * eats * dt / 60);
        if (lost > 0) state.horde -= lost;
      }
    }
    const opened = H.dig(state, dt, cfg, md, ground, sp);
    cashIn(events, md);
    turnUp(unwatched ? null : events, md);
    for (const k of opened) {
      events.push({ type: 'opened', k });
      fire(events, 'break:' + k, 'breakthrough', { name: ground.at(k).name }, String(k));
      seamLine(events, k);
      newDepth(events, k);
      if (md.boneCart > 0) state.bones += boneRate() * md.boneCart;
      // Rex Mortis's muster: every new layer brings diggers up with it.
      if (md.muster > 0) H.raiseFree(state, growthOver(md.muster));
      if (ground.at(k).door) breakDoor(events, k);
      else openChamber(events, k);
    }
    if (opened.length) readAhead();
    if (state.chamber || (state.chamberQueue && state.chamberQueue.length)) takeLordsGifts(events);

    // A rank that lets upgrades buy themselves: the cheapest one on the panel
    // that coin will cover, one a step, while the player has it switched on.
    if (md.autoBuy && legacy.autoBuy) {
      let best = null;
      for (const def of R.visible(state, cfg)) {
        if (!R.canBuy(state, def)) continue;
        const price = R.cost(def, R.levelOf(state, def.id));
        if (!best || price < best.price) best = { def, price };
      }
      if (best) { R.buy(state, best.def.id, cfg, 1); readAhead(); }
    }
    // Mortifer's call: every spare bone raises diggers, while the player has
    // it switched on.
    if (md.autoRaise && legacy.autoRaise !== false) H.raise(state, 'max', cfg.horde, mods().softMult);

    state.t += dt;
    trimIncome();
    Vi.tick(visitorApi, unwatched ? null : events, unwatched);

    if (opened.length) tidy();

    announce(events, Rv.update(state, cfg, legacy));
    milestones(events);
    return events;
  };

  /**
   * Move the simulation `seconds` forward. Short gaps step at the live tick;
   * a long gap (a closed tab, a phone in a pocket) is stepped in coarse
   * chunks and capped, and the summary of what happened is returned with the
   * events so the page can say what the dead did while nobody watched.
   *
   * `opts.unwatched` is the page saying nobody was looking: the gap is then
   * dug at the away pace, so time at the machine always beats time away.
   * Without it every second counts in full, which is what a caller stepping
   * the simulation forward on purpose wants.
   */
  const advance = (seconds, opts) => {
    const events = [];
    if (!(seconds > 0)) return { events, elapsed: 0, worked: 0, capped: false, away: false };
    const away = seconds > cfg.time.catchUpAfter;
    const max = mods().offlineHours * 3600;
    const capped = away && seconds > max;
    const total = capped ? max : seconds;
    const worked = away && opts && opts.unwatched ? awayWork(total, cfg.time, mods().awayPace) : total;
    const chunk = away ? cfg.time.offlineStep : cfg.time.tick;
    const startCoin = state.coin, startBones = state.bones;
    const startDepth = state.depth, startHorde = state.horde;
    const startStock = Object.assign({}, state.stock);
    const startVisits = state.visitorsSeen || 0;
    const startRelics = legacy.remembrance || 0;
    const startDoors = Object.keys(state.doors || {}).length;
    let left = worked;
    let guard = 0;
    // A barrow set to fill itself in stops here when it reaches that layer,
    // and the time still owed goes to the next barrow rather than digging
    // this one on past where the player asked it to end.
    const stop = !!(opts && opts.stopForFillIn);
    let stopped = false;
    while (left > 1e-9 && guard++ < 2e6) {
      const dt = Math.min(chunk, left);
      for (const e of step(dt, away)) events.push(e);
      left -= dt;
      if (stop && autoSealDue()) { stopped = true; break; }
    }
    // What is left, as time on the clock: the unwatched stretch was dug at
    // the away pace after its free first part, so a second still owed to the
    // dig is more than a second of the clock.
    let leftover = 0;
    if (stopped && left > 1e-9) {
      const done = worked - left;
      const p = mods().awayPace;
      const pace = away && opts && opts.unwatched ? (p > 0 ? Math.min(1, p) : 1) : 1;
      const grace = away && opts && opts.unwatched ? Math.min(total, cfg.time.awayGrace > 0 ? cfg.time.awayGrace : 0) : total;
      const spent = done <= grace ? done : grace + (done - grace) / pace;
      leftover = Math.max(0, total - spent);
    }
    // Whoever walked up while the tab was shut gets their full wait from the
    // moment the player looks at the page again.
    const waiting = away ? Vi.refresh(state, cfg) : false;
    const gained = {
      coin: state.coin - startCoin,
      bones: state.bones - startBones,
      strata: state.depth - startDepth,
      horde: state.horde - startHorde,
      visits: (state.visitorsSeen || 0) - startVisits,
      relics: (legacy.remembrance || 0) - startRelics,
      doors: Object.keys(state.doors || {}).length - startDoors,
      waiting,
      stock: {},
    };
    for (const id of Object.keys(state.stock)) {
      const d = state.stock[id] - (startStock[id] || 0);
      if (d > 1e-9) gained.stock[id] = d;
    }
    return { events, elapsed: total, worked, capped, away, gained, stopped, leftover };
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
    cashIn(events, mods());
    announce(events, Rv.update(state, cfg, legacy));
    return events;
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

  /**
   * Hand the splitting to the player, or give it back to the game. Nothing in
   * the run requires either: this is for somebody who wants to fiddle.
   * Taking it over starts from wherever the game had the diggers, so the
   * first press never costs anything.
   */
  const setByHand = (on) => {
    const want = !!on;
    if (want === !!state.byHand) return want;
    if (want) {
      const sp = split();
      const max = cfg.horde.maxWeight;
      const from = activeFrom();
      let top = sp.face;
      for (let k = from; k <= state.depth; k++) top = Math.max(top, sp.strata[k] || 0);
      const notches = (x) => (top > 0 ? Math.max(x > 1e-6 ? 1 : 0, Math.round((x / top) * max)) : 0);
      while (state.weights.length <= state.depth) state.weights.push(0);
      for (let k = 0; k < state.weights.length; k++) state.weights[k] = k >= from ? notches(sp.strata[k] || 0) : 0;
      state.faceWeight = notches(sp.face);
    }
    state.byHand = want;
    return want;
  };

  /**
   * What the next barrow is handed of how the crew was placed. A player who
   * took the placing over keeps it: the switch stays on Me, the way down keeps
   * its notches, and the layers keep theirs counted up from the bottom, so
   * "everyone straight down" is still everyone straight down on new ground.
   * Only the layers the crew can still reach are read; the ones above them
   * count for nothing now and would count for nothing next time.
   */
  const keepPlacing = () => {
    if (!state.byHand) { legacy.placing = { byHand: false }; return legacy.placing; }
    const rows = [];
    const from = activeFrom();
    for (let k = state.depth; k >= from; k--) rows.push(state.weights[k] | 0);
    while (rows.length && !rows[rows.length - 1]) rows.pop();
    legacy.placing = { byHand: true, face: state.faceWeight | 0, rows };
    return legacy.placing;
  };

  const setWeight = (target, delta) => {
    if (target === 'face') return setWeightAt(target, (state.faceWeight | 0) + delta);
    const k = target | 0;
    if (k < activeFrom() || k > state.depth) return 0;
    return setWeightAt(k, (state.weights[k] | 0) + delta);
  };

  /**
   * Put a layer straight on a weight. The bar on the panel is five notches
   * and pressing one sets it, so moving a row from five to nothing is one
   * press rather than five. A row set this way is the player's from then on
   * and no breakthrough moves it again.
   */
  const setWeightAt = (target, value) => {
    const max = cfg.horde.maxWeight;
    const w = Math.max(0, Math.min(max, Math.round(value) || 0));
    if (target === 'face') { state.faceWeight = w; return w; }
    const k = target | 0;
    if (k < activeFrom() || k > state.depth) return 0;
    while (state.weights.length <= k) state.weights.push(0);
    state.weights[k] = w;
    if (!state.tuned) state.tuned = {};
    state.tuned[k] = true;
    return w;
  };

  /** The switches rank hands over, kept with the things that carry between barrows. */
  const setAutoBuy = (on) => { legacy.autoBuy = !!on; return legacy.autoBuy; };
  const setAutoRaise = (on) => { legacy.autoRaise = !!on; return legacy.autoRaise; };
  const dismissEnding = () => { state.ending = false; };
  /** The hills on offer for the next barrow, if rank offers any. */
  const hillChoices = () => Rb.hillChoices(legacy, cfg, state.seed, (id) => Ranks.has(legacy, cfg, id));
  const setAutoSeal = (layer) => {
    const n = Math.max(0, Math.round(layer) || 0);
    legacy.autoSealAt = n > 0 ? Math.max(cfg.seal.unlockDepth + 1, n) : 0;
    return legacy.autoSealAt;
  };
  /** Whether the barrow has reached the layer the player asked it to fill itself in at. */
  // A room left waiting does not hold it up: answerForFillIn takes what a
  // room offers that the fill-in can still pay, and the rest is buried with
  // the barrow like everything else it held.
  const autoSealDue = () => {
    const md = mods();
    return !!(md.autoSeal && legacy.autoSealAt > 0 && state.depth + 1 >= legacy.autoSealAt
      && Rb.canSeal(state, cfg));
  };

  const buyRite = (id, count) => {
    const events = [];
    const level = R.buy(state, id, cfg, count);
    if (level > 0) {
      events.push({ type: 'rite', id, level });
      readAhead();
      announce(events, Rv.update(state, cfg, legacy));
    }
    return { events, level };
  };

  // -- persistence --------------------------------------------------------

  const snapshot = () => ({
    state: JSON.parse(JSON.stringify(state)),
    legacy: JSON.parse(JSON.stringify(legacy)),
  });

  const sim = {
    cfg, state, legacy, ground, mods, worthOf, activeFrom,
    step, advance, dig, raise, setWeight, setWeightAt, buyRite,
    split, setByHand, keepPlacing, answerForFillIn, setAutoBuy, setAutoRaise, setAutoSeal, autoSealDue, dismissEnding, hillChoices, steadyIncome,
    riteMax: (id) => R.maxBuy(state, id, cfg), snapshot,
    takeOffer, acceptVisitor, declineVisitor, growthOver, visitorApi,
    visitorReady: () => Vi.affordable(visitorApi, state.visitor),
    sealYield: () => Rb.yieldOf(state, cfg, mods().sealRelics),
    canSeal: () => Rb.canSeal(state, cfg),
    layerRates,
  };

  // A run from before the market came out: what it had on hand sells at its
  // worth, and whatever it spent on the market's own upgrades comes back.
  // Levels rank or Old Habits handed over free are not paid for twice.
  if (opts.state && !state.marketGone) {
    state.marketGone = 1;
    const md = mods();
    let sold = 0;
    for (const id of Object.keys(state.stock)) {
      if (state.stock[id] > 0) sold += state.stock[id] * worthOf(id, md);
      state.stock[id] = 0;
    }
    const gone = (cfg.rites && cfg.rites.retired) || {};
    const rank = cfg.ranks ? Ranks.rankOf(legacy.renown || 0, cfg) : 0;
    const books = (legacy.oaths && legacy.oaths.books) || 0;
    let back = 0;
    for (const id of Object.keys(gone)) {
      const lv = state.rites[id] || 0;
      const g = gone[id];
      let free = 0;
      if ((g.freeAtRank && rank >= g.freeAtRank) || (g.booksLevel && books >= g.booksLevel)) free = 1;
      if (g.freeTwoAtRank && rank >= g.freeTwoAtRank) free = 2;
      for (let l = free; l < lv; l++) back += g.cost * Math.pow(g.growth, l);
      delete state.rites[id];
    }
    if (sold > 0) earn(sold);
    if (back > 0) state.coin += back;
    const w = Lore.CONTENT.log.marketGone;
    if (w && (sold > 0 || back > 0)) {
      const parts = [w.head];
      if (sold > 0) parts.push(fill(w.sold, { coin: fmtCoin(sold) }));
      if (back > 0) parts.push(fill(w.back, { coin: fmtCoin(back) }));
      state.log.unshift(parts.join(' '));
      if (state.log.length > 14) state.log.length = 14;
    }
  }


  // A run from before there were lords has already dug past some of their
  // doors. They come up to meet the player now: each one pays, talks and
  // offers his gifts as if the door had just broken, newest line on top.
  if (opts.state && state.doorsV !== 1 && cfg.lords) {
    state.doorsV = 1;
    const events = [];
    for (let k = cfg.lords.every; k <= state.depth; k += cfg.lords.every) breakDoor(events, k);
    for (const e of events) if (e.type === 'log' && e.text) state.log.unshift(e.text);
    if (state.log.length > 14) state.log.length = 14;
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
  // A run saved before there were lords says nothing about doors; the fresh
  // state underneath says it has had them all along, which is not true of it.
  if (!Object.prototype.hasOwnProperty.call(st, 'doorsV')) state.doorsV = 0;
  // Likewise a run saved while there was still a market: the fresh state
  // says it never had one, which is not true of it.
  if (!Object.prototype.hasOwnProperty.call(st, 'marketGone')) state.marketGone = 0;
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
  // A save from before the hollow was measured in crew time carries over at
  // whatever its old drawing showed, so a layer that looked dug out still does.
  if (!Array.isArray(st.worked)) {
    const v = cfg.view || {};
    state.worked = state.effort.map((e, k) => {
      if (!(e > 0) || !(v.clearSeconds > 0)) return 0;
      const scale = (v.carveScale || 60) * Math.pow(1.35, k);
      return Math.min(1, Math.log10(1 + e / scale) / 3) * v.clearSeconds;
    });
  }
  // A save from before finds: whatever its layers were already dug out to has
  // been passed, so it is not paid in one flood the moment it opens.
  if (!st.finds || typeof st.finds !== 'object') {
    state.finds = {};
    const F = cfg.finds, T = cfg.view && cfg.view.clearSeconds;
    if (F && T > 0) {
      for (let k = 0; k < state.worked.length; k++) {
        const frac = (state.worked[k] || 0) / T;
        let n = 0;
        while (n < F.at.length && frac >= F.at[n] - 1e-9) n++;
        if (n > 0) state.finds[k] = n;
      }
    }
  }
  if (!Array.isArray(state.log)) state.log = [];
  if (!Array.isArray(state.chamberQueue)) state.chamberQueue = [];
  // The game does the splitting for everybody, including runs that predate
  // it. Only a run from before there was a choice is read off its rows: a
  // save that predates the choice and has rows somebody set by hand keeps
  // them, and one that never had a row touched comes back automatic. Every
  // save since carries the answer itself, and it is taken at its word - a
  // player who set a row, then gave the splitting back, gave it back for
  // good, and the rows they set are still there if they take it again.
  state.byHand = Object.prototype.hasOwnProperty.call(st, 'byHand')
    ? !!st.byHand
    : Object.keys((st.tuned && typeof st.tuned === 'object') ? st.tuned : {}).length > 0;
  if (!Array.isArray(state.visitRecent)) state.visitRecent = [];
  if (!Array.isArray(state.spells)) state.spells = [];
  for (const k of ['stock', 'seen', 'rites', 'flags', 'fired', 'boons', 'read', 'chambersDone', 'visitorsBought', 'tuned', 'doors', 'doorEase']) {
    if (!state[k] || typeof state[k] !== 'object') state[k] = {};
  }
  if (state.visitor && typeof state.visitor !== 'object') state.visitor = null;
  if (typeof state.hill !== 'string') state.hill = null;
  const legacy = Rb.restoreLegacy(snap.legacy);
  return createSim(cfg, { state, legacy, snapshot: snap });
}

/**
 * The state a fresh barrow begins with once the oaths have had their say: a
 * horde already standing, layers already open, coin in the purse and the
 * rites the books remember already held.
 */
export function openedState(cfg, legacy, seed, lines, hill) {
  const state = freshState(cfg, seed);
  if (hill) state.hill = hill;
  const o = Rb.oathMods(legacy, cfg);
  // The barrow just filled in gets a card at the top of the next one.
  state.ending = Array.isArray(legacy.barrows) && legacy.barrows.length > 0;
  const ground = createGround(cfg, state.seed, Rb.hillRule(cfg, state.hill));
  if (lines) state.log = lines.slice(0, 14);

  for (const id of o.startRites) state.rites[id] = 1;
  // What rank hands over at the start of every barrow.
  if (cfg.ranks && Ranks.has(legacy, cfg, 'assay')) state.rites.assay = Math.max(state.rites.assay || 0, 1);
  if (o.startCoin > 0) state.coin = o.startCoin;

  // A barrow never starts past the first lord's door: he is always met.
  const firstDoor = cfg.lords ? cfg.lords.every - 1 : 40;
  const deeper = cfg.ranks && Ranks.has(legacy, cfg, 'startDeeper') ? 1 : 0;
  const depth = Math.max(0, Math.min(o.startDepth + deeper, 40, firstDoor));
  for (let k = 0; k <= depth; k++) {
    if (k > state.depth) state.depth = k;
    while (state.weights.length <= k) state.weights.push(0);
    // The same step back a breakthrough applies, so ground that comes free
    // with a new barrow is already leaning down rather than spread flat.
    H.settle(state, cfg.horde);
    // Ground that comes free with a new barrow has been seen and half dug.
    state.seen['s' + k] = true;
    state.effort[k] = ground.at(k).cap * ground.at(k).hardness;
    if (!Array.isArray(state.worked)) state.worked = [];
    state.worked[k] = (cfg.view && cfg.view.clearSeconds ? cfg.view.clearSeconds : 0) * 0.5;
    // Half dug out, and the finds in that half were somebody else's.
    if (cfg.finds) state.finds[k] = cfg.finds.at.filter(a => a <= 0.5).length;
  }
  // The jar's share of the last barrow's dead comes along, once.
  const carried = legacy.carry > 0 ? legacy.carry : 0;
  legacy.carry = 0;
  if (o.startHorde > 0 || carried > 0) {
    state.horde = o.startHorde + carried;
    state.bones = 0;
    state.faceWeight = cfg.horde.weightFace;
  }
  Rv.update(state, cfg, legacy);
  placeAsLeft(state, cfg, legacy.placing);
  return state;
}

/**
 * Put the crew where the player had them when the last barrow filled in.
 * The rows are counted up from the bottom, so they land on the new barrow's
 * deepest layers. A placing that had nobody anywhere would leave a new barrow
 * with nobody digging, so it keeps the switch on Me and starts from where the
 * game put them - the same as pressing Me does.
 */
function placeAsLeft(state, cfg, placing) {
  if (!placing || !placing.byHand) return;
  const max = cfg.horde.maxWeight;
  const clamp = (w) => Math.max(0, Math.min(max, w | 0));
  const rows = Array.isArray(placing.rows) ? placing.rows : [];
  const face = clamp(placing.face);
  if (face > 0 || rows.some(w => w > 0)) {
    for (let k = 0; k < state.weights.length; k++) state.weights[k] = 0;
    for (let i = 0; i < rows.length && state.depth - i >= 0; i++) state.weights[state.depth - i] = clamp(rows[i]);
    state.faceWeight = face;
  }
  state.byHand = true;
}
