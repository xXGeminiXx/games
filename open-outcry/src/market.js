// Vendored from the game-art foundation (lib/market.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// An agent economy: goods, an order book per good, and a crowd of traders who
// each hold an opinion about what things are worth.
//
// The point is legibility. A price here is never a number a designer typed;
// it is the residue of who wanted what this tick, and every move traces back
// to the order flow that caused it (lib/market-inspect.js `why`). A game shows
// the crowd and the ladder, and the player reads the market the way a trader
// does instead of being told a number.
//
// WHAT THIS ENGINE FIXES AND WHAT IT LEAVES TO THE GAME. Fixed: matching by
// price and time, escrow, conservation of money and goods, the player hooks,
// and the inspect API that makes a price move explainable. Left open: the
// causal shape of the market. How an opinion about price changes, how big an
// order gets written, and what a shock does are pluggable rules
// (lib/market-rules.js), passed in as `rules`. Several games will copy this
// engine, and a player who learned how prices move in one of them must not
// recognise the same machine under the next one's skin, so a world picks or
// writes its own rules and the tuning below is one configuration rather than
// the engine's identity.
//
// The rules shipped as defaults follow the price-belief model from Doran and Parberry's "Emergent
// Economies for Role Playing Games", as described by Lars Doucet:
// https://www.gamedeveloper.com/design/bazaarbot-an-open-source-economics-engine
// Each agent holds a RANGE per good rather than a number, prices its order at
// a random point inside that range, narrows the range around a fill, and
// widens it while drifting toward the observed market price after a miss.
// Nobody is told the price; the crowd finds it.
//
// The urge to trade is the marginal-rate-of-substitution idea from Sugarscape
// (Epstein and Axtell), rule T:
// https://sugarscape.sourceforge.net/documentation/walkthru.html
// a good is worth more to whoever is shorter of it relative to their own
// consumption. Here that scarcity ratio scales order size and pushes belief,
// rather than setting a bilateral price, because the exchange sets price.
//
// Money circulates: a producer that sells pays most of the proceeds out as
// wages to the households that consume, and pays out anything it hoards above
// a working balance. Without that loop cash pools in the producers within a
// few hundred ticks and demand dies.
//
// Everything is integer and seeded. The generator is re-derived from (seed,
// tick) at the top of every tick, so a save carries only a seed and a tick
// number and the restored market takes an identical next tick.
//
// CONSERVATION is a hard invariant. Goods appear only in production and vanish
// only in consumption; money appears only in a recorded injection and vanishes
// only into the fee and tax pots, which are still counted. Money and goods
// committed to a resting order sit in escrow, so nobody sells what they do not
// hold and nothing is conjured at settlement.
// ---------------------------------------------------------------------------

import { rng } from './rng.js?v=1';
import { OrderBook, BUY, SELL } from './orderbook.js?v=1';
import * as I from './market-inspect.js?v=1';
import { DEFAULT_RULES, SHOCKS } from './market-rules.js?v=1';
import { F64, I32, U8, save, load } from './market-save.js?v=1';

export { BUY, SELL };
export const PRODUCER = 0, CONSUMER = 1, SPECULATOR = 2, PLAYER = 3;
export const ROLE_NAMES = I.ROLE_NAMES;
export const PLAYER_ID = -1;

// A three-good chain: two raw goods and one made from ore. `price` is an
// opening hint for the crowd, not a fixed value. `supply` and `demand` are
// how the population is split; `make` is units per producing tick and `wear`
// is units a household destroys per tick, so the two sides start balanced and
// the market has a price to find rather than a collapse to run.
export const DEFAULT_GOODS = [
  { key: 'ore', price: 20, supply: 4, demand: 2, make: 4, wear: 0.5 },
  { key: 'grain', price: 12, supply: 12, demand: 4, make: 4, wear: 1 },
  { key: 'tool', price: 60, supply: 2, demand: 1, make: 1, wear: 0.15, input: 'ore', inputQty: 2 },
];

export const DEFAULTS = {
  agents: 600,
  seed: 'market',
  goods: DEFAULT_GOODS,
  roleSplit: [0.14, 0.82],  // cumulative: producers, then consumers, rest speculate
  stockCap: 3,              // a producer stops making once it holds this many turns of output
  consumeIdeal: 8,          // units a household tries to keep on the shelf
  wageShare: 0.85,          // share of a producer's proceeds paid straight out as wages
  payoutAbove: 600,         // producer cash above this is paid out too
  actEvery: 2,              // an agent works its order every N ticks, staggered
  orderTtl: 4,              // ticks a resting order lives before it is pulled
  maxOrder: 12,             // an order must carry more than a turn of output or the pipe throttles the market
  seedMoney: 400,
  seedStock: 10,
  exitFloor: 40,            // net worth under which an agent is failing
  exitPatience: 25,         // consecutive failing ticks before it is replaced
  bandStart: 0.25,          // opening belief half-width as a share of the opening price
  bandMin: 0.02,
  bandMax: 0.35,
  beliefBand: 8,            // a belief may never sit further than this factor from the market
  specCap: 12,              // units a speculator will hold before it has to unwind
  narrow: 0.9,              // belief half-width multiplier after a fill
  widen: 1.06,              // and after a miss. Must be weaker than 1/narrow or a crowd
                            // that fills half its orders drifts wider for ever and never settles
  drift: 0.25,              // how far a missed belief moves toward the market price
  feeBps: 0,
  historyLen: 400,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);


export class Market {
  constructor(opts = {}) {
    const o = this.opt = { ...DEFAULTS, ...opts };
    // Rules are functions, so they are held apart from the serialisable
    // options and handed back in on load.
    this.rules = { ...DEFAULT_RULES, ...(opts.rules || {}) };
    this.rules.shocks = { ...SHOCKS, ...((opts.rules || {}).shocks || {}) };
    delete o.rules;
    this.seed = o.seed;
    this.t = 0;
    this.reseed();

    this.goods = o.goods.map((g, i) => ({
      i, key: g.key, price: g.price | 0, supply: g.supply || 1, demand: g.demand || 1,
      make: g.make || 1, wear: g.wear == null ? 1 : g.wear,
      input: g.input == null ? -1 : o.goods.findIndex((x) => x.key === g.input),
      inputQty: g.inputQty || 0,
    }));
    const G = this.G = this.goods.length;
    this.books = this.goods.map((g) => new OrderBook({ id: g.key, maxTrades: 256 }));

    const N = this.N = o.agents | 0;
    for (const f of F64) this[f] = new Float64Array(f === 'bLo' || f === 'bHi' ? N * G : N);
    for (const f of I32) this[f] = new Int32Array(f === 'inv' || f === 'lock' || f === 'oid' || f === 'oAt' ? N * G : N);
    for (const f of U8) this[f] = new Uint8Array(N);

    // Ledgers. Everything entering or leaving the system is counted here,
    // which is what makes conservation checkable rather than hoped for.
    this.issued = 0;
    this.produced = new Float64Array(G);
    this.consumed = new Float64Array(G);
    this.fees = 0;
    this.taxPot = 0;
    this.wagePool = 0;
    this.feeBps = o.feeBps | 0;

    this.player = {
      money: 0, escrow: 0, inv: new Int32Array(G), lock: new Int32Array(G),
      bid: new Int32Array(G), ask: new Int32Array(G), manual: [], mm: new Array(G).fill(null),
    };

    this.flowBuy = new Float64Array(G * 4);
    this.flowSell = new Float64Array(G * 4);
    this.prevMid = new Float64Array(G);
    this.history = this.goods.map(() => ({ mid: [], vol: [], flow: [] }));
    this.log = [];
    this.fills = [];            // this tick's fills, for a renderer to draw
    this.shocks = [];
    this.prodMul = new Float64Array(G).fill(1);
    this.consMul = new Float64Array(G).fill(1);
    this.taxBps = 0;

    this._populate();
    for (let g = 0; g < G; g++) this.prevMid[g] = this.goods[g].price;
  }

  // The tick's generator is derived from the seed and the tick number alone,
  // so a tick is reproducible on its own and a save needs no generator state.
  reseed() { this.r = rng(`${this.seed}/t${this.t}`); return this.r; }

  // --- setup ---------------------------------------------------------------

  _populate() {
    const o = this.opt, G = this.G, r = rng(`${this.seed}/populate`);
    const idx = this.goods.map((g) => g.i);
    const sw = this.goods.map((g) => g.supply), dw = this.goods.map((g) => g.demand);
    for (let i = 0; i < this.N; i++) {
      const roll = r.next();
      this.role[i] = roll < o.roleSplit[0] ? PRODUCER : roll < o.roleSplit[1] ? CONSUMER : SPECULATOR;
      this.good[i] = r.weighted(idx, this.role[i] === PRODUCER ? sw : dw);
      this._grant(i, o.seedMoney + r.int(0, 200));
      for (let g = 0; g < G; g++) {
        const stock = g === this.good[i] ? o.seedStock + r.int(0, 4) : r.int(0, 2);
        this.inv[i * G + g] = stock;
        this.produced[g] += stock;               // opening stock counts as production
        this._setBelief(i, g, this.goods[g].price, o.bandStart);
      }
      this.lastWorth[i] = this._worth(i);
    }
  }

  _setBelief(i, g, mid, halfShare) {
    const h = Math.max(1, mid * halfShare);
    this.bLo[i * this.G + g] = Math.max(1, mid - h);
    this.bHi[i * this.G + g] = mid + h;
  }

  // The only way the money supply grows, and it is recorded so the
  // conservation identity still closes.
  _grant(i, amount) {
    if (amount <= 0) return;
    this.money[i] += amount;
    this.issued += amount;
  }

  _worth(i) {
    let w = this.money[i] + this.escrow[i];
    for (let g = 0; g < this.G; g++) {
      const q = this.inv[i * this.G + g] + this.lock[i * this.G + g];
      if (q) w += q * (this.books[g].mid() || this.goods[g].price);
    }
    return w;
  }

  // --- account access, by agent index or PLAYER_ID -------------------------

  _money(id) { return id === PLAYER_ID ? this.player.money : this.money[id]; }
  _addMoney(id, d) { if (id === PLAYER_ID) this.player.money += d; else this.money[id] += d; }
  _addEscrow(id, d) { if (id === PLAYER_ID) this.player.escrow += d; else this.escrow[id] += d; }
  _inv(id, g) { return id === PLAYER_ID ? this.player.inv[g] : this.inv[id * this.G + g]; }
  _addInv(id, g, d) { if (id === PLAYER_ID) this.player.inv[g] += d; else this.inv[id * this.G + g] += d; }
  _addLock(id, g, d) { if (id === PLAYER_ID) this.player.lock[g] += d; else this.lock[id * this.G + g] += d; }
  _roleOf(id) { return id === PLAYER_ID ? PLAYER : this.role[id]; }

  // --- placing and settling ------------------------------------------------

  // Post a limit order for an account, reserving what it commits. Size is cut
  // to what the account can actually cover, so an order is never a promise of
  // money or goods that are not there. Returns the book result, or null.
  // opts.ioc discards the remainder instead of resting it.
  post(id, g, side, price, qty, opts = {}) {
    price = Math.max(1, Math.round(price));
    qty = Math.max(0, Math.round(qty));
    if (!qty) return null;
    if (side === BUY) {
      if (this._money(id) < price * qty) qty = Math.floor(this._money(id) / price);
      if (qty <= 0) return null;
      this._addMoney(id, -price * qty);
      this._addEscrow(id, price * qty);
    } else {
      if (this._inv(id, g) < qty) qty = this._inv(id, g);
      if (qty <= 0) return null;
      this._addInv(id, g, -qty);
      this._addLock(id, g, qty);
    }
    const res = this.books[g].limit(side, price, qty, id, this.t, opts);
    this._settle(g, res.trades, side, price);
    if (opts.ioc && res.filled < qty) this._release(id, g, side, price, qty - res.filled);
    return res;
  }

  _release(id, g, side, price, qty) {
    if (qty <= 0) return;
    if (side === BUY) { this._addEscrow(id, -price * qty); this._addMoney(id, price * qty); }
    else { this._addLock(id, g, -qty); this._addInv(id, g, qty); }
  }

  // Move goods and money for each fill. A taker may have committed more than
  // the fill cost (it crossed with a generous limit), so the difference comes
  // back out of escrow; a maker always trades at its own price.
  _settle(g, trades, takerSide, takerLimit) {
    for (const t of trades) {
      const notional = t.price * t.qty;
      const fee = Math.floor((notional * this.feeBps) / 10000);
      const buyLimit = takerSide === BUY && t.taker === t.buyer ? takerLimit : t.price;

      this._addEscrow(t.buyer, -buyLimit * t.qty);
      this._addMoney(t.buyer, (buyLimit - t.price) * t.qty);
      this._addInv(t.buyer, g, t.qty);

      this._addLock(t.seller, g, -t.qty);
      let proceeds = notional - fee;
      this.fees += fee;
      // A producer's sale is the economy's payday: most of it goes straight
      // back out to the households that buy from it.
      if (this._roleOf(t.seller) === PRODUCER) {
        const wage = Math.floor(proceeds * this.opt.wageShare);
        proceeds -= wage;
        this.wagePool += wage;
      }
      this._addMoney(t.seller, proceeds);

      this.flowBuy[g * 4 + this._roleOf(t.buyer)] += t.qty;
      this.flowSell[g * 4 + this._roleOf(t.seller)] += t.qty;
      this._onFill(t.buyer, g, t.price);
      this._onFill(t.seller, g, t.price);
      this.fills.push({ g, price: t.price, qty: t.qty, buyer: t.buyer, seller: t.seller });
    }
  }

  // A fill is evidence, a miss is weaker evidence, and what an agent does
  // with either is the world's rule, not the engine's.
  _onFill(id, g, price) { if (id !== PLAYER_ID) this.rules.belief.fill(this, id, g, price); }
  _onMiss(id, g) { if (id !== PLAYER_ID) this.rules.belief.miss(this, id, g); }

  // --- the tick ------------------------------------------------------------

  tick() {
    this.t++;
    this.reseed();
    this.flowBuy.fill(0);
    this.flowSell.fill(0);
    this.fills.length = 0;
    for (let g = 0; g < this.G; g++) this.prevMid[g] = this.books[g].mid() || this.goods[g].price;
    this._expire();
    this._shocks();
    this._produce();
    this._consume();
    this._act();
    this._mm();
    this._churn();
    this._payWages();
    this._record();
    return this;
  }

  run(n) { for (let i = 0; i < n; i++) this.tick(); return this; }

  _expire() {
    const ttl = this.opt.orderTtl;
    for (let i = 0; i < this.N; i++) {
      for (let g = 0; g < this.G; g++) {
        const k = i * this.G + g;
        if (!this.oid[k] || this.t - this.oAt[k] < ttl) continue;
        const o = this.books[g].cancel(this.oid[k]);
        this.oid[k] = 0;
        if (!o) continue;
        this._release(i, g, o.side, o.price, o.qty - o.filled);
        if (o.filled === 0) this._onMiss(i, g);
      }
    }
    for (let m = this.player.manual.length - 1; m >= 0; m--) {
      const e = this.player.manual[m];
      if (this.t - e.at < ttl) continue;
      const o = this.books[e.g].cancel(e.id);
      if (o) this._release(PLAYER_ID, e.g, o.side, o.price, o.qty - o.filled);
      this.player.manual.splice(m, 1);
    }
  }

  // Producers turn inputs, or nothing for a raw good, into output. A shed
  // that is full stops the line: that cap is what keeps an oversupplied good
  // from being produced into worthlessness.
  _produce() {
    const G = this.G, cap = this.opt.stockCap;
    for (let i = 0; i < this.N; i++) {
      if (this.role[i] !== PRODUCER) continue;
      const g = this.good[i], gd = this.goods[g], k = i * G + g;
      let want = Math.round(gd.make * this.prodMul[g]);
      want = Math.min(want, gd.make * cap - this.inv[k]);
      if (gd.input >= 0) want = Math.min(want, Math.floor(this.inv[i * G + gd.input] / gd.inputQty));
      if (want <= 0) continue;
      if (gd.input >= 0) {
        const used = want * gd.inputQty;
        this.inv[i * G + gd.input] -= used;
        this.consumed[gd.input] += used;
      }
      this.inv[k] += want;
      this.produced[g] += want;
    }
  }

  // Wages are split evenly across households; the integer remainder goes to
  // one of them, picked by the seeded generator, so not a coin is lost.
  _payWages() {
    if (this.wagePool <= 0) return;
    const takers = [];
    for (let i = 0; i < this.N; i++) if (this.role[i] === CONSUMER) takers.push(i);
    if (!takers.length) { this.taxPot += this.wagePool; this.wagePool = 0; return; }
    const each = Math.floor(this.wagePool / takers.length);
    let rest = this.wagePool - each * takers.length;
    for (const i of takers) this.money[i] += each;
    if (rest > 0) this.money[takers[this.r.int(0, takers.length - 1)]] += rest;
    this.wagePool = 0;
  }

  _consume() {
    const o = this.opt;
    for (let i = 0; i < this.N; i++) {
      if (this.role[i] !== CONSUMER) continue;
      const g = this.good[i], k = i * this.G + g;
      const gd = this.goods[g];
      // Unmet need is capped at a couple of turns. Letting it accumulate makes
      // a household that went short eat every unit it buys the instant the
      // unit arrives, so its shelf never recovers, it is permanently hungry,
      // and its belief sits pinned at the ceiling for the rest of the run.
      this.need[i] = Math.min(this.need[i] + gd.wear * this.consMul[g], Math.max(1, gd.wear * 2));
      const want = Math.floor(this.need[i]);
      if (want <= 0) continue;
      const eat = Math.min(want, this.inv[k]);
      this.inv[k] -= eat;
      this.consumed[g] += eat;
      this.need[i] -= eat;
      // Going without raises what the good is worth to this household: the
      // Sugarscape scarcity idea, applied to one agent's own shortfall.
      // Going without is recorded here and spent at order time (see the
      // sizing rule), so urgency raises what this household will pay today
      // without rewriting what it thinks the good is worth.
      this.hunger[i] = eat < want ? Math.min(20, this.hunger[i] + 1) : 0;
    }
  }

  // Every agent that is due works one order. The acting order is shuffled
  // every tick: in a continuous book whoever moves first at a price is served
  // first, so a fixed order would be a standing advantage for low indices.
  _act() {
    const due = [];
    for (let i = 0; i < this.N; i++) if ((this.t + i) % this.opt.actEvery === 0) due.push(i);
    this.r.shuffle(due);
    for (const i of due) this._workOrder(i);
  }

  _workOrder(i) {
    const G = this.G, o = this.opt, role = this.role[i];
    const g = this.good[i], gd = this.goods[g];
    let target = g, side = SELL;
    if (role === PRODUCER) {
      // A producer buys its input when the shed is running low, sells when
      // there is output to sell, and otherwise stands aside.
      if (gd.input >= 0 && this.inv[i * G + gd.input] < gd.inputQty * gd.make * 2) { target = gd.input; side = BUY; }
      else if (this.inv[i * G + g] <= 0) return;
    } else if (role === CONSUMER) {
      if (this.inv[i * G + g] >= o.consumeIdeal) return;
      side = BUY;
    } else {
      // A speculator acts when the book is outside its own band, and is
      // forced to unwind once its book is bigger than it can carry. Without
      // the cap a speculator buys every dip on the way down and takes stock
      // out of circulation permanently.
      const k = i * G + g, ask = this.books[g].bestAsk(), bid = this.books[g].bestBid();
      if (this.inv[k] > o.specCap) side = SELL;
      else if (ask && ask < this.bLo[k] && this.money[i] > ask * 2) side = BUY;
      else if (bid && bid > this.bHi[k] && this.inv[k] > 0) side = SELL;
      else return;
    }
    const k = i * G + target;
    if (this.oid[k]) return;                       // one working order per good
    // A maker will not sell below what the inputs cost it. Without this floor
    // a manufacturer whose input has run dear is squeezed out of business, its
    // trade disappears from the world, and the good it made runs away to a
    // price nobody can pay with nobody left to supply it.
    const floor = side === SELL && role === PRODUCER && gd.input >= 0
      ? gd.inputQty * this.mid(gd.input) * 1.05 : 1;
    const room = side === SELL ? this.inv[k]
      : role === CONSUMER ? o.consumeIdeal * 2 - this.inv[k]
        : role === PRODUCER ? gd.inputQty * gd.make * 4 - this.inv[k] : o.maxOrder;
    if (room <= 0) { this._onMiss(i, target); return; }
    const price = this.rules.sizing.price(this, i, target, side, role, floor);
    let qty = Math.min(this.rules.sizing.qty(this, i, target, side, role, price, room), o.maxOrder, room);
    if (side === BUY) qty = Math.min(qty, Math.floor(this.money[i] / price));
    // Wanting to trade and being unable to is evidence as strong as a miss:
    // it is how an agent priced out of a runaway market learns to come back
    // down. Without it a belief that outruns the agent's purse never posts
    // again, never misses, and never corrects.
    if (qty <= 0) { this._onMiss(i, target); return; }
    const res = this.post(i, target, side, price, qty);
    if (!res) { this._onMiss(i, target); return; }
    if (res.id) { this.oid[k] = res.id; this.oAt[k] = this.t; }
  }

  // Replace agents that have been failing for a while, and drain hoarded
  // producer cash back into wages. The estate stays in the world, so nothing
  // is destroyed; only the shortfall to a working stake is new money, and
  // that is recorded. A replacement takes up the good the market is short of,
  // which is how the population tracks demand instead of collapsing.
  _churn() {
    const o = this.opt;
    for (let i = 0; i < this.N; i++) {
      if (this.role[i] === PRODUCER && this.money[i] > o.payoutAbove) {
        const excess = Math.floor(this.money[i] - o.payoutAbove);
        this.money[i] -= excess;
        this.wagePool += excess;
      }
      const w = this._worth(i);
      this.profit[i] = this.profit[i] * 0.95 + (w - this.lastWorth[i]) * 0.05;
      this.lastWorth[i] = w;
      const glut = this.role[i] === PRODUCER
        && this.inv[i * this.G + this.good[i]] >= this.goods[this.good[i]].make * o.stockCap;
      this.fail[i] = (w < o.exitFloor || glut) ? this.fail[i] + 1 : 0;
      if (this.fail[i] < o.exitPatience) continue;
      let live = 0;
      for (let g = 0; g < this.G; g++) if (this.oid[i * this.G + g]) live++;
      if (!live) this._respawn(i);               // settle first, then leave
    }
  }

  _respawn(i) {
    const o = this.opt, G = this.G;
    // Where to go to work: the good that has run furthest above what it opened
    // at. Price relative to its own base is the one scarcity signal that still
    // reads when a market has seized up completely, which is exactly when a
    // trade most needs someone to take it up. Reading resting bids instead
    // leaves a dead book looking like a good nobody wants.
    let best = 0, bestScore = -Infinity;
    for (let g = 0; g < G; g++) {
      const score = this.mid(g) / this.goods[g].price;
      if (score > bestScore) { bestScore = score; best = g; }
    }
    this.role[i] = bestScore > 1 ? PRODUCER : this.r.next() < 0.75 ? CONSUMER : SPECULATOR;
    this.good[i] = best;
    this.fail[i] = 0;
    this.hunger[i] = 0;
    this.need[i] = 0;
    this.profit[i] = 0;
    this._grant(i, o.seedMoney - this.money[i]);
    for (let g = 0; g < G; g++) this._setBelief(i, g, this.books[g].mid() || this.goods[g].price, o.bandStart);
    this.lastWorth[i] = this._worth(i);
    this._note({ kind: 'respawn', g: best, role: this.role[i] });
  }

  _note(e) {
    this.log.push({ t: this.t, ...e });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  _record() {
    const H = this.opt.historyLen;
    for (let g = 0; g < this.G; g++) {
      const h = this.history[g];
      let vol = 0;
      for (const f of this.fills) if (f.g === g) vol += f.qty;
      h.mid.push(this.books[g].mid() || this.goods[g].price);
      h.vol.push(vol);
      h.flow.push(I.netFlow(this, g));
      if (h.mid.length > H) { h.mid.shift(); h.vol.shift(); h.flow.shift(); }
    }
  }

  // --- player hooks --------------------------------------------------------

  // (a) trade as a participant on the same book as everyone else.
  playerOrder(g, side, price, qty, opts = {}) {
    const res = this.post(PLAYER_ID, g, side, price, qty, opts);
    if (res && res.id) this.player.manual.push({ g, id: res.id, at: this.t });
    this._note({ kind: 'player-order', g, side, price, qty, filled: res ? res.filled : 0 });
    return res;
  }

  // (b) own the exchange: a fee in basis points off every sale's proceeds.
  // Charging the seller keeps a bid's escrow exactly its limit times its size,
  // so a buyer never reserves for a fee that might change before it fills.
  setFeeBps(bps) {
    this.feeBps = clamp(bps | 0, 0, 10000);
    this._note({ kind: 'fee', bps: this.feeBps });
    return this.feeBps;
  }

  // (c) quote both sides around the mid and keep inventory inside a band.
  marketMake(g, cfg) {
    this.player.mm[g] = cfg ? { spread: 2, size: 4, maxInv: 40, ...cfg } : null;
    this._note({ kind: 'mm', g, on: !!cfg });
  }

  _mm() {
    const p = this.player;
    for (let g = 0; g < this.G; g++) {
      for (const slot of ['bid', 'ask']) {
        if (!p[slot][g]) continue;
        const o = this.books[g].cancel(p[slot][g]);
        if (o) this._release(PLAYER_ID, g, o.side, o.price, o.qty - o.filled);
        p[slot][g] = 0;
      }
      const c = p.mm[g];
      if (!c) continue;
      const mid = this.books[g].mid() || this.goods[g].price;
      const half = Math.max(1, Math.round(c.spread / 2));
      if (p.inv[g] < c.maxInv) {
        const r = this.post(PLAYER_ID, g, BUY, Math.max(1, Math.round(mid) - half), c.size);
        if (r && r.id) p.bid[g] = r.id;
      }
      if (p.inv[g] > 0) {
        const r = this.post(PLAYER_ID, g, SELL, Math.round(mid) + half, Math.min(c.size, p.inv[g]));
        if (r && r.id) p.ask[g] = r.id;
      }
    }
  }

  // (d) shocks. A supply cut throttles production, a demand surge multiplies
  // what households destroy, a tax skims every account once per tick.
  shock(s) {
    const e = {
      kind: s.kind, g: s.good == null ? -1 : s.good, factor: s.factor == null ? 1 : s.factor,
      rateBps: s.rateBps | 0, until: this.t + (s.ticks == null ? 60 : s.ticks),
    };
    this.shocks.push(e);
    this._note({ kind: 'shock', shock: e.kind, g: e.g, factor: e.factor, until: e.until });
    return e;
  }

  _shocks() {
    this.prodMul.fill(1);
    this.consMul.fill(1);
    this.taxBps = 0;
    this.shocks = this.shocks.filter((s) => s.until > this.t);
    for (const s of this.shocks) {
      const fn = this.rules.shocks[s.kind];
      if (fn) fn(this, s);
    }
    if (!this.taxBps) return;
    for (let i = 0; i < this.N; i++) {
      const take = Math.floor((this.money[i] * this.taxBps) / 10000);
      if (take > 0) { this.money[i] -= take; this.taxPot += take; }
    }
  }

  // --- inspection (lib/market-inspect.js) ----------------------------------

  mid(g) { return this.books[g].mid() || this.goods[g].price; }
  depth(g, n) { return I.depth(this, g, n); }
  tape(g, n) { return I.tape(this, g, n); }
  byRole(g) { return I.byRole(this, g); }
  beliefHistogram(g, bins, lo, hi) { return I.beliefHistogram(this, g, bins, lo, hi); }
  beliefSpread(g) { return I.beliefSpread(this, g); }
  netFlow(g) { return I.netFlow(this, g); }
  why(g) { return I.why(this, g); }
  conservation() { return I.conservation(this); }
  stats() { return I.stats(this); }

  // --- save and load (lib/market-save.js) ----------------------------------

  toJSON() { return save(this); }

  // Rules are functions and do not serialise. Hand back the same set the world
  // runs on, or the restored market silently reverts to the defaults.
  static fromJSON(j, opts = {}) { return load(Market, j, opts); }
}

export default Market;
