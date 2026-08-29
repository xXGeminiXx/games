// Vendored from the game-art foundation (lib/orderbook.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// A continuous double auction for one good: the exchange half of an economy.
//
// Orders arrive one at a time and match immediately against the resting book
// by price-time priority. That is the mechanism every real exchange uses and
// it is the one a player can read off the screen: the best price wins, and
// among equal prices the order that has waited longest wins. A price only
// moves when someone crosses the spread, so "why did it move" always has an
// answer.
//
// Prices are integer TICKS and quantities are integer UNITS. Money is
// price * qty, so every number in the book is an exact integer and a long
// run cannot drift the way accumulated floats do. A game picks what a tick
// is worth (a copper piece, a cent) when it displays one.
//
// The aggressor trades at the RESTING order's price, so a taker who crosses
// with a generous limit gets price improvement rather than paying its own
// limit. Same convention as an exchange; it also means a resting order never
// fills worse than it asked for.
//
// The book knows nothing about fees, agents or inventories. It matches, and
// reports what happened. Fees, escrow and settlement belong to the exchange
// that owns the book (lib/market.js) so this file stays a primitive any game
// can copy on its own.
//
// The matching order (sort bids high to low, asks low to high, cross the top
// of one against the top of the other, partial fills allowed) follows the
// standard limit order book described in Doran and Parberry's "Emergent
// Economies for Role Playing Games" and Lars Doucet's BazaarBot writeup:
// https://www.gamedeveloper.com/design/bazaarbot-an-open-source-economics-engine
// BazaarBot clears a whole round at once at the average of the crossing bid
// and ask; this book is continuous instead, because a continuous book gives a
// player something to trade against between ticks and shows a spread.
// ---------------------------------------------------------------------------

export const BUY = 'buy';
export const SELL = 'sell';

// Index of the level holding `price`, or where it would be inserted.
// Bids descend, asks ascend, so `desc` picks the comparison.
function levelIndex(levels, price, desc) {
  let lo = 0, hi = levels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = levels[mid].price;
    if (desc ? p > price : p < price) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class OrderBook {
  // maxTrades sizes the recent-trades ring: the tape a player reads, not a
  // full history. A game that wants the whole history keeps its own log.
  constructor({ id = 'good', maxTrades = 256 } = {}) {
    this.id = id;
    this.bids = [];            // [{ price, orders: [] }] price descending
    this.asks = [];            // [{ price, orders: [] }] price ascending
    this.orders = new Map();   // id -> order, for cancel
    this.seq = 1;              // next order id; ids are never reused
    this.last = 0;             // last traded price in ticks, 0 before the first trade
    this.lastTick = -1;
    this.volume = 0;           // units traded over the life of the book
    this.notional = 0;         // price * qty traded over the life of the book
    this.maxTrades = maxTrades | 0;
    this.tape = [];            // ring buffer of trades
    this.tapeHead = 0;
    this.tradeCount = 0;       // trades ever, including those the ring dropped
  }

  _record(t) {
    this.last = t.price;
    this.lastTick = t.tick;
    this.volume += t.qty;
    this.notional += t.price * t.qty;
    this.tradeCount++;
    if (this.tape.length < this.maxTrades) this.tape.push(t);
    else { this.tape[this.tapeHead] = t; this.tapeHead = (this.tapeHead + 1) % this.maxTrades; }
  }

  // Submit a limit order. Returns { id, trades, filled, resting }.
  // id is 0 when nothing rested (fully filled, or ioc). `trades` are this
  // order's fills, oldest first, each { tick, price, qty, buyer, seller,
  // maker, taker, makerId, aggressor }.
  //
  // opts.ioc: immediate-or-cancel, the remainder is discarded instead of
  // resting. A market order is an ioc limit at an extreme price.
  limit(side, price, qty, owner = -1, tick = 0, opts = {}) {
    price = price | 0;
    qty = qty | 0;
    if (qty <= 0) return { id: 0, trades: [], filled: 0, resting: 0 };
    if (price <= 0) throw new Error('orderbook: price must be a positive integer of ticks');
    if (side !== BUY && side !== SELL) throw new Error('orderbook: side must be buy or sell');

    const buying = side === BUY;
    const opposite = buying ? this.asks : this.bids;
    const trades = [];
    let left = qty, filled = 0;

    while (left > 0 && opposite.length) {
      const level = opposite[0];
      // Stop as soon as the best opposing price is worse than the limit.
      if (buying ? level.price > price : level.price < price) break;
      const queue = level.orders;
      while (left > 0 && queue.length) {
        const maker = queue[0];                       // oldest at this price
        const avail = maker.qty - maker.filled;
        const n = left < avail ? left : avail;
        maker.filled += n;
        left -= n;
        filled += n;
        const t = {
          tick, price: level.price, qty: n,
          buyer: buying ? owner : maker.owner,
          seller: buying ? maker.owner : owner,
          maker: maker.owner, taker: owner, makerId: maker.id,
          aggressor: side,
        };
        trades.push(t);
        this._record(t);
        if (maker.filled >= maker.qty) { queue.shift(); this.orders.delete(maker.id); }
      }
      if (queue.length === 0) opposite.shift();
    }

    let id = 0;
    if (left > 0 && !opts.ioc) {
      id = this.seq++;
      const order = { id, side, price, qty: left, filled: 0, owner, tick };
      this.orders.set(id, order);
      const levels = buying ? this.bids : this.asks;
      const i = levelIndex(levels, price, buying);
      if (levels[i] && levels[i].price === price) levels[i].orders.push(order);
      else levels.splice(i, 0, { price, orders: [order] });
    }
    return { id, trades, filled, resting: opts.ioc ? 0 : left };
  }

  // Pull a resting order. Returns the order (read qty - filled to release
  // whatever was reserved for it) or null if it is already gone.
  cancel(id) {
    const o = this.orders.get(id);
    if (!o) return null;
    const levels = o.side === BUY ? this.bids : this.asks;
    const i = levelIndex(levels, o.price, o.side === BUY);
    const level = levels[i];
    if (level && level.price === o.price) {
      const k = level.orders.indexOf(o);
      if (k >= 0) level.orders.splice(k, 1);
      if (level.orders.length === 0) levels.splice(i, 1);
    }
    this.orders.delete(id);
    return o;
  }

  order(id) { return this.orders.get(id) || null; }
  get openCount() { return this.orders.size; }

  bestBid() { return this.bids.length ? this.bids[0].price : 0; }
  bestAsk() { return this.asks.length ? this.asks[0].price : 0; }

  // Midpoint of the quoted spread. Falls back to the last trade, then to 0,
  // so a caller never has to special-case an empty book.
  mid() {
    const b = this.bestBid(), a = this.bestAsk();
    if (b && a) return (b + a) / 2;
    return b || a || this.last;
  }

  // Quoted spread in ticks, or 0 when one side is empty (no spread exists).
  spread() {
    const b = this.bestBid(), a = this.bestAsk();
    return b && a ? a - b : 0;
  }

  // Top n levels of each side: { bids: [{price, qty, orders}], asks: [...] }.
  // This is the ladder a player reads, aggregated the way a screen shows it.
  depth(n = 8) {
    const side = (levels) => {
      const out = [];
      for (let i = 0; i < levels.length && i < n; i++) {
        let q = 0;
        for (const o of levels[i].orders) q += o.qty - o.filled;
        out.push({ price: levels[i].price, qty: q, orders: levels[i].orders.length });
      }
      return out;
    };
    return { bids: side(this.bids), asks: side(this.asks) };
  }

  // Total resting units on one side, across every level.
  resting(side) {
    const levels = side === BUY ? this.bids : this.asks;
    let q = 0;
    for (const l of levels) for (const o of l.orders) q += o.qty - o.filled;
    return q;
  }

  // The tape, newest first.
  recentTrades(n = 32) {
    const out = [];
    const len = this.tape.length;
    for (let i = 0; i < len && out.length < n; i++) {
      const idx = (this.tapeHead - 1 - i + len * 2) % len;
      out.push(this.tape[idx]);
    }
    return out;
  }

  // Volume-weighted average price over the tape, or the last price when the
  // tape is empty. A steadier read than `last` for a chart.
  vwap(n = 32) {
    const ts = this.recentTrades(n);
    let q = 0, v = 0;
    for (const t of ts) { q += t.qty; v += t.price * t.qty; }
    return q ? v / q : this.last;
  }

  clear() {
    this.bids.length = 0;
    this.asks.length = 0;
    this.orders.clear();
  }

  // Serialisation keeps per-level order, so time priority survives a save.
  toJSON() {
    const flat = (levels) => levels.map((l) => ({
      p: l.price,
      o: l.orders.map((o) => [o.id, o.qty, o.filled, o.owner, o.tick]),
    }));
    return {
      v: 1, id: this.id, seq: this.seq, last: this.last, lastTick: this.lastTick,
      volume: this.volume, notional: this.notional, maxTrades: this.maxTrades,
      tradeCount: this.tradeCount, tapeHead: this.tapeHead,
      tape: this.tape.map((t) => [t.tick, t.price, t.qty, t.buyer, t.seller, t.maker, t.taker, t.makerId, t.aggressor === BUY ? 1 : 0]),
      bids: flat(this.bids), asks: flat(this.asks),
    };
  }

  static fromJSON(j) {
    const b = new OrderBook({ id: j.id, maxTrades: j.maxTrades });
    b.seq = j.seq; b.last = j.last; b.lastTick = j.lastTick;
    b.volume = j.volume; b.notional = j.notional; b.tradeCount = j.tradeCount;
    b.tapeHead = j.tapeHead;
    b.tape = (j.tape || []).map((t) => ({
      tick: t[0], price: t[1], qty: t[2], buyer: t[3], seller: t[4],
      maker: t[5], taker: t[6], makerId: t[7], aggressor: t[8] ? BUY : SELL,
    }));
    const build = (levels, side) => levels.map((l) => ({
      price: l.p,
      orders: l.o.map((o) => {
        const order = { id: o[0], side, price: l.p, qty: o[1], filled: o[2], owner: o[3], tick: o[4] };
        b.orders.set(order.id, order);
        return order;
      }),
    }));
    b.bids = build(j.bids || [], BUY);
    b.asks = build(j.asks || [], SELL);
    return b;
  }
}

export default OrderBook;
