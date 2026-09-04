// ---------------------------------------------------------------------------
// One pit: a crowd, a book, and your two quotes standing in it.
//
// The market engine (src/market.js) owns the crowd, the matching and the
// conservation invariant. This file owns everything the PLAYER does to it:
// where the two quotes sit, when they are written back onto the board, what
// the fills did to the position, what the seat took, and how cash crosses the
// boundary between the pit and the till.
//
// THE ORDER OF A TICK, and why it is that order.
//
//   market.tick()   the crowd acts against the quotes already resting, then
//                   the engine pulls them (a quote lives exactly one tick)
//   readFills()     what your two quotes did, and what it cost or paid
//   clerks.tick()   the cards look at the result and may move the quote
//   place()         the quote is written back onto the board
//   settle()        cash crosses the boundary in whichever direction it needs
//
// A quote that rests for one tick and is rewritten is the whole loop: it is
// why a player has to keep requoting, and it is what the first clerk buys.
//
// CASH ACROSS THE BOUNDARY. The engine's conservation identity is that every
// coin in the market was explicitly issued. The till is outside the market, so
// money moving between the two is recorded as a change in issuance: a sweep
// out lowers `issued` by exactly what it took, a wire in raises it. Do it any
// other way and conservation() goes false within a few ticks, which is the
// first thing the tests check.
// ---------------------------------------------------------------------------

import { Market, PLAYER_ID, PRODUCER, CONSUMER, BUY, SELL } from './market.js?v=5';
import { PIT_BELIEFS as BELIEFS, PIT_SIZING as SIZING } from './pit-rules.js?v=5';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Pit {
  constructor(key, cfg, opts = {}) {
    const spec = cfg.pits[key];
    this.cfg = cfg;
    this.key = key;
    this.name = spec.name;
    this.spec = spec;
    this.seed = opts.seed || `oo/${key}`;
    this.crowd = opts.crowd || cfg.crowd.start;
    this.seatBps = opts.seatBps || 0;
    this.priceMul = opts.priceMul || 1;

    // The quote. Prices are integer ticks, the same units the book uses.
    this.bid = 0;
    this.ask = 0;
    this.size = cfg.pit.startSize;
    this.spread = cfg.pit.startSpread;
    this.lean = 0;              // ticks the whole quote is shifted, set by a clerk
    this.offPrice = 0;              // ticks the board has stood right off the price
    this.bidOn = true;
    this.askOn = true;
    this.bidIds = [];           // resting order ids, so a standing quote is left
    this.askIds = [];           // standing and keeps its place in the queue

    this.basis = 0;             // average cost of what is being carried
    this.realized = 0;          // cash made and lost on closed trade, this pit
    this.swept = 0;             // cash sent to the till over the pit's life
    this.seatPaid = 0;          // of that, what the seat took
    this.volumeAtGrow = 0;
    this.held = 0;              // consecutive ticks the corner share has held
    this.fillsSeen = 0;
    this.lastFill = null;       // { bought, sold, price }
    this.history = [];          // mid per tick, kept across a crowd rebuild
    this.closed = false;

    this.build(Math.max(1, Math.round(spec.price * this.priceMul)));
  }

  // Build the market itself. Called once at the start and again whenever the
  // crowd grows, because the engine sizes its typed arrays at construction.
  build(price) {
    const c = this.cfg, s = this.spec;
    this.basePrice = Math.max(1, Math.round(s.price * this.priceMul));
    this.m = new Market({
      agents: this.crowd,
      seed: this.seed,
      goods: [{ key: this.key, price, supply: s.supply, demand: s.demand, make: s.make, wear: s.wear }],
      roleSplit: c.market.roleSplit.slice(),
      seedMoney: Math.round(this.basePrice * c.market.moneyOfPrice),
      seedStock: c.market.seedStock,
      actEvery: c.market.actEvery,
      orderTtl: c.market.orderTtl,
      maxOrder: c.market.maxOrder,
      stockCap: c.market.stockCap,
      consumeIdeal: c.market.consumeIdeal,
      specCap: c.market.specCap,
      historyLen: c.market.historyLen,
      feeBps: this.seatBps,
      rules: { belief: BELIEFS[s.belief], sizing: SIZING[s.sizing] },
    });
    this.world(this.m);
    if (!this.bid || !this.ask) this.recentre();
    return this.m;
  }

  // The four numbers the rules in src/pit-rules.js read off the market: what
  // this floor has always thought the good is worth, how far a price may run
  // from it, how hard it pulls on an opinion, and how much of the crowd will
  // not wait for its price.
  //
  // They live on the market object and are NOT part of what a market saves, so
  // a restored pit has to be given them again. Without this a loaded run has no
  // anchor and no impatience at all: the price walks off, the maker earns
  // nothing, and it shows up hours later in somebody else's save.
  world(m) {
    const c = this.cfg, s = this.spec;
    m.anchorPrice = this.basePrice;
    m.anchorSpan = c.pit.anchorSpan;
    m.anchorPull = c.pit.anchorPull;
    m.impatience = s.impatience === undefined ? c.pit.impatience : s.impatience;
    return m;
  }

  // The price the CROWD is making, with the player's own quote taken out of
  // the book first.
  //
  // A maker who is the only bid on the board is otherwise the best bid, so a
  // quote centred on the touch centres on itself, never improves, and stands
  // at a price nobody will sell at until the run stops earning. Every reading
  // that decides where to quote - the mid, the drift, the standing value the
  // beliefs are pulled toward - has to be the market without you in it.
  marketTouch() {
    const book = this.m.books[0];
    let bid = 0, ask = 0;
    for (const l of book.bids) {
      let q = 0;
      for (const o of l.orders) if (o.owner !== PLAYER_ID) q += o.qty - o.filled;
      if (q > 0) { bid = l.price; break; }
    }
    for (const l of book.asks) {
      let q = 0;
      for (const o of l.orders) if (o.owner !== PLAYER_ID) q += o.qty - o.filled;
      if (q > 0) { ask = l.price; break; }
    }
    return { bid, ask };
  }

  get mid() {
    const t = this.marketTouch();
    if (t.bid && t.ask) return (t.bid + t.ask) / 2;
    return t.bid || t.ask || this.m.books[0].last || this.basePrice;
  }
  get position() { return this.m.player.inv[0] + this.m.player.lock[0]; }
  get cash() { return this.m.player.money + this.m.player.escrow; }
  get volume() { return this.m.books[0].volume; }
  get tick() { return this.m.t; }

  // Units of this good in existence in the pit. Cornering is measured against
  // it, so it is the engine's own ledger rather than anything counted here.
  get float() { return Math.max(0, this.m.produced[0] - this.m.consumed[0]); }
  get share() { const f = this.float; return f > 0 ? this.position / f : 0; }

  // What the next bid needs in cash, over and above what the pit is already
  // holding. A bid escrows its full value the moment it is written, so this is
  // the capital a quote of this size at this price actually takes.
  wants() {
    if (!this.bidOn || this.size <= 0) return 0;
    const resting = this.bidId && this.m.books[0].order(this.bidId);
    if (resting && resting.price === this.bid) return 0;
    return Math.max(0, Math.ceil(this.bid * this.size - this.m.player.money));
  }

  // --- the quote -----------------------------------------------------------

  // Put both sides back where you are willing to stand. This is the click the
  // first clerk takes over.
  //
  // The spread dial is how WIDE you are willing to be, not where you go. A
  // crowd of a few hundred converges on a price and quotes within a tick or
  // two of it, so a quote hung a fixed distance either side of the mid ends up
  // behind the market and never trades. Instead: when the book is wider than
  // your spread you stand INSIDE it at your own price and take the flow; when
  // the book is tighter you join the touch and take the tick that is there.
  //
  // That is why the size upgrade is the first rung of the ladder. A big crowd
  // is a tight book, so a wide spread earns nothing in one; what a big crowd
  // gives you is flow, and flow is taken with size.
  recentre() {
    const mid = this.mid || this.basePrice;
    const half = Math.max(1, Math.round(this.spread / 2));
    const { bid: b, ask: a } = this.marketTouch();
    let bid = Math.round(mid - half + this.lean);
    let ask = Math.round(mid + half + this.lean);
    if (b) bid = Math.max(b, bid);
    if (a) ask = Math.min(a, ask);
    this.bid = Math.max(1, bid);
    this.ask = Math.max(this.bid + 1, ask);
    this.bidOn = true;
    this.askOn = true;
    return this;
  }

  setSpread(n) {
    this.spread = clamp(Math.round(n), this.cfg.pit.minSpread, 400);
    return this.spread;
  }

  setSize(n) {
    this.size = clamp(Math.round(n), 1, 1e9);
    return this.size;
  }

  setBid(p) { this.bid = clamp(Math.round(p), 1, 1e9); if (this.ask <= this.bid) this.ask = this.bid + 1; return this.bid; }
  setAsk(p) { this.ask = clamp(Math.round(p), 2, 1e9); if (this.bid >= this.ask) this.bid = this.ask - 1; return this.ask; }

  // How far the mid has walked away from the middle of your quote. This is
  // the reading a clerk watches, and the reason a stale quote is expensive.
  drift() {
    const centre = (this.bid + this.ask) / 2;
    return this.mid - centre;
  }

  pull() { this.bidOn = false; this.askOn = false; this.cancel(); return this; }
  push() { this.bidOn = true; this.askOn = true; return this; }

  // Pull one side off the book and release whatever it was holding.
  cancelSide(side) {
    const m = this.m, ids = side === BUY ? this.bidIds : this.askIds;
    for (const id of ids) {
      const o = m.books[0].cancel(id);
      if (o) m._release(PLAYER_ID, 0, o.side, o.price, o.qty - o.filled);
    }
    ids.length = 0;
  }

  cancel() { this.cancelSide(BUY); this.cancelSide(SELL); }

  // Units still standing on one side at the quoted price. Anything resting at
  // a price that is no longer quoted is pulled while it is counted.
  resting(side) {
    const m = this.m, book = m.books[0];
    const ids = side === BUY ? this.bidIds : this.askIds;
    const price = side === BUY ? this.bid : this.ask;
    let live = 0;
    const keep = [];
    for (const id of ids) {
      const o = book.order(id);
      if (!o) continue;
      if (o.price !== price) {
        const c = book.cancel(id);
        if (c) m._release(PLAYER_ID, 0, c.side, c.price, c.qty - c.filled);
        continue;
      }
      live += o.qty - o.filled;
      keep.push(id);
    }
    ids.length = 0;
    for (const id of keep) ids.push(id);
    return live;
  }

  // The most stock the quote will carry. A maker who bids without a limit ends
  // up owning the pit by accident: the bid keeps filling on the way down while
  // the offer can only sell a quote at a time, so the position ratchets one
  // way. At the cap the bid comes off and the offer works the stock back out.
  carry() {
    return Math.max(this.size, Math.round(this.size * this.cfg.pit.carryOfSize));
  }

  // Cash the next bid needs over what the pit is already holding.
  wants() {
    if (!this.bidOn || this.size <= 0 || this.position >= this.carry()) return 0;
    const short = Math.min(this.size, this.carry() - this.position) - this.resting(BUY);
    if (short <= 0) return 0;
    return Math.max(0, Math.ceil(this.bid * short - this.m.player.money));
  }

  // Write the quote onto the board.
  //
  // A QUOTE THAT HAS NOT CHANGED IS LEFT WHERE IT IS, and this is the most
  // important rule in the file. The book fills by price and then by TIME, so an
  // order that has been standing at a price is served before one that has just
  // arrived at the same price. Cancelling and reposting every tick puts the
  // player at the back of every queue for ever and the quote never fills.
  // Leaving it standing is also what gives requoting a cost: moving with the
  // market gives up the place in the queue that waiting earned.
  //
  // What IS topped up is the size. A quote that has been half filled is half a
  // quote, and without a top-up the size a player bought would only ever work
  // until the first trade took it. The top-up goes on the back of the queue at
  // the same price, so it costs nothing that was already earned.
  //
  // A bid written above the resting offer lifts it there and then, which is
  // exactly what quoting through a market means.
  place() {
    const m = this.m;
    if (!this.bidOn || this.size <= 0 || this.position >= this.carry()) this.cancelSide(BUY);
    else {
      const room = Math.min(this.size, this.carry() - this.position) - this.resting(BUY);
      if (room > 0) {
        const r = m.post(PLAYER_ID, 0, BUY, this.bid, room);
        if (r && r.id) this.bidIds.push(r.id);
      }
    }
    if (!this.askOn || this.size <= 0 || m.player.inv[0] <= 0) this.cancelSide(SELL);
    else {
      const room = Math.min(this.size, m.player.inv[0]) - this.resting(SELL);
      if (room > 0) {
        const r = m.post(PLAYER_ID, 0, SELL, this.ask, room);
        if (r && r.id) this.askIds.push(r.id);
      }
    }
  }

  // Sell the position into whatever is bidding, now. The cost of doing it is
  // the point: an immediate-or-cancel sale takes the price the book offers.
  flatten() {
    const m = this.m;
    const qty = m.player.inv[0];
    if (qty <= 0) return { qty: 0, price: 0 };
    const before = m.player.money;
    const r = m.post(PLAYER_ID, 0, SELL, 1, qty, { ioc: true });
    const done = r ? r.filled : 0;
    const paid = m.player.money - before;
    if (done > 0) {
      this.realized += paid - this.basis * done;
      this.lastFill = { bought: 0, sold: done, price: Math.round(paid / done) };
    }
    return { qty: done, price: done ? Math.round(paid / done) : 0 };
  }

  // --- the tick ------------------------------------------------------------

  // What your quotes did this tick, and what it did to the position. The
  // engine has already moved the money and the goods; this keeps the cost
  // basis so a realised number can be shown.
  readFills() {
    let bought = 0, sold = 0, spent = 0, got = 0;
    for (const f of this.m.fills) {
      if (f.buyer === PLAYER_ID) { bought += f.qty; spent += f.price * f.qty; }
      if (f.seller === PLAYER_ID) { sold += f.qty; got += f.price * f.qty; }
    }
    if (sold > 0) this.realized += got - this.basis * sold;
    if (bought > 0) {
      const held = Math.max(0, this.position - bought + sold);
      this.basis = (this.basis * held + spent) / Math.max(1, held + bought);
    }
    if (bought + sold > 0) {
      this.fillsSeen++;
      this.lastFill = {
        bought, sold,
        price: Math.round((spent + got) / (bought + sold)),
        // The two sides are kept apart as well as together. Where both filled
        // in the same tick, the difference between them is the gap the player
        // actually kept, and that is the only number the board throws up the
        // wall - a one-sided fill has not made or lost anything yet.
        buyPrice: bought > 0 ? spent / bought : 0,
        sellPrice: sold > 0 ? got / sold : 0,
      };
    } else this.lastFill = null;
    return this.lastFill;
  }

  // Put cash into the pit for the quote about to be written. The pit keeps no
  // standing float: it borrows what a quote escrows, and everything that comes
  // back is swept out again the same tick. That is why the number on the wall
  // is the whole of the money - nothing is quietly parked in a pit.
  fund(available) {
    const want = this.wants();
    const wire = Math.min(want, Math.max(0, Math.floor(available)));
    if (wire <= 0) return 0;
    this.m.player.money += wire;
    this.m.issued += wire;
    // `swept` is what this pit has NET paid the till over its life, so the
    // capital lent to it has to come back off. Counting only the sweeps makes
    // a pit look like it has paid many times what it has actually earned,
    // because most of what it sweeps back is the money it was just given.
    this.swept -= wire;
    return wire;
  }

  // Take back everything the pit is holding loose, and everything the seat has
  // taken. Both are recorded as a fall in issuance so the engine's
  // conservation identity still closes.
  sweep() {
    const m = this.m;
    let out = 0;
    if (m.fees >= 1) {
      const f = Math.floor(m.fees);
      m.fees -= f;
      m.issued -= f;
      this.seatPaid += f;
      out += f;
    }
    const loose = Math.floor(m.player.money);
    if (loose > 0) {
      m.player.money -= loose;
      m.issued -= loose;
      out += loose;
    }
    this.swept += out;
    return out;
  }

  // Money the whole floor is holding, including what is escrowed against a
  // resting order and what is waiting to be paid out as wages.
  floorMoney() {
    let money = this.m.player.money + this.m.player.escrow + this.m.wagePool;
    for (let i = 0; i < this.m.N; i++) money += this.m.money[i] + this.m.escrow[i];
    return money;
  }

  // What the floor knows, and what the city is willing to lend it.
  //
  // Two slow pulls, and both exist because a pit has to still be a grain pit
  // an hour later. A crowd left entirely to its own prints random-walks its
  // price level away from anything the pit is named for, and every coin the
  // player sweeps out of the room is a coin the room cannot bid with, so a
  // profitable player would quietly starve the market that pays them.
  //
  // The first pull is knowledge: a grain trader has an idea what grain has
  // been worth for twenty years, so every belief creeps back toward the pit's
  // own price. The second is credit: if the floor is holding less cash than
  // its stock is worth at that price, the city lends it the difference. The
  // rates are small enough that a tick, a minute and a shock are entirely the
  // crowd's; only an hour's drift belongs to this.
  //
  // Money is only ever added, never confiscated, and every coin added is
  // recorded as issuance, so the engine's conservation identity still closes.
  anchor() {
    const m = this.m, c = this.cfg.pit;
    // A floor stripped of its stock stops knowing what the good is worth, so
    // the pull toward the standing value fades as the float runs out. This is
    // what makes a corner expensive: the last third of a pit's stock is bought
    // in a market that has nothing left to anchor it.
    const normal = Math.max(1, this.crowd * c.floorPerTrader);
    m.anchorPull = c.anchorPull * Math.min(1, this.float / normal);
    const mix = this.keepMix();
    const want = this.basePrice * this.float * c.moneyFloor;
    const have = this.floorMoney();
    // Money is lent through the wage pool, and the wage pool is paid to
    // households. With none on the floor the engine sends it to the tax pot
    // instead, so lending into an empty room would run for ever and reach
    // nobody. Fix the mix first, then lend.
    if (have >= want || !mix.consumers) return 0;
    const lend = Math.round((want - have) * c.lendRate);
    if (lend <= 0) return 0;
    m.wagePool += lend;
    m.issued += lend;
    return lend;
  }

  // Keep the floor's mix of trades.
  //
  // When the engine replaces a trader who has been failing, it gives them
  // whichever trade the price says is worth taking up: production if the good
  // is dear against what it opened at, a household otherwise. In a chain of
  // several goods that reads as labour moving to where it is needed. In a pit
  // of ONE good it is a knife edge - a pit trading a hair above where it was
  // last built turns every replacement into a producer, and within an hour
  // there is nobody left to sell to, the price falls through the floor, the
  // book has no bid on it at all and the pit is dead with a full warehouse.
  // Measured: 296 traders, 237 of them producers, zero households.
  //
  // So the mix is held near what the pit was populated with, a few traders at
  // a time, taking whoever is doing worst. A trader changing trade keeps
  // everything they hold; only a stake up to what a new arrival would carry is
  // new money, and that is recorded as issuance like any other.
  keepMix() {
    const m = this.m, o = m.opt;
    const want = [
      Math.round(m.N * o.roleSplit[0]),                       // producers
      Math.round(m.N * (o.roleSplit[1] - o.roleSplit[0])),    // households
      m.N - Math.round(m.N * o.roleSplit[1]),                 // position takers
    ];
    const have = [0, 0, 0];
    for (let i = 0; i < m.N; i++) if (m.role[i] < 3) have[m.role[i]]++;
    // Move from whichever trade is most over its share to whichever is most
    // under it, a few at a time, so the floor drifts back into shape over
    // minutes rather than snapping every time somebody fails.
    let low = 0, high = 0;
    for (let r = 1; r < 3; r++) {
      if (have[r] - want[r] < have[low] - want[low]) low = r;
      if (have[r] - want[r] > have[high] - want[high]) high = r;
    }
    const step = Math.max(2, Math.round(m.N * 0.02));
    if (low === high || want[low] - have[low] < step) return { have, moved: 0 };
    let moved = 0;
    for (let i = 0; i < m.N && moved < step; i++) {
      if (m.role[i] !== high) continue;
      m.role[i] = low;
      m.need[i] = 0;
      m.hunger[i] = 0;
      m.fail[i] = 0;
      const stake = Math.round(o.seedMoney * 0.5);
      if (m.money[i] < stake) m._grant(i, stake - m.money[i]);
      moved++;
    }
    have[high] -= moved;
    have[low] += moved;
    return { have, moved, consumers: have[1] };
  }

  // --- the crowd -----------------------------------------------------------

  // How many more traders the pit's own volume has earned, held back until
  // there are enough of them to be worth rebuilding for. The batch grows with
  // the crowd, so a big floor is rebuilt no more often than a small one.
  pendingCrowd(cap) {
    const c = this.cfg.crowd;
    const earned = Math.floor((this.volume - this.volumeAtGrow) / c.per);
    const room = Math.max(0, cap - this.crowd);
    const want = Math.min(earned, room);
    const batch = Math.max(c.batchMin, Math.round(this.crowd * c.batchOf));
    return want >= batch || (want > 0 && room === want && want >= c.batchMin) ? want : 0;
  }

  // Rebuild the market with more traders in it. The price level, the position
  // and the cash come across; the book and the crowd's opinions start again,
  // which is what a floor filling up actually looks like.
  growCrowd(n) {
    const old = this.m;
    const mid = Math.max(1, Math.round(old.mid(0)));
    const pos = old.player.inv[0] + old.player.lock[0];
    const cash = Math.round(old.player.money + old.player.escrow);
    const t = old.t;
    this.cancel();
    this.crowd += n;
    this.volumeAtGrow = this.volume;
    const carriedVolume = old.books[0].volume;
    this.build(mid);
    this.m.t = t;
    this.m.reseed();
    this.m.books[0].volume = carriedVolume;
    this.m.books[0].last = mid;
    this.volumeAtGrow = carriedVolume;
    if (cash > 0) { this.m.player.money += cash; this.m.issued += cash; }
    if (pos > 0) { this.m.player.inv[0] += pos; this.m.produced[0] += pos; }
    this.bidIds.length = 0;
    this.askIds.length = 0;
    this.recentre();
    return n;
  }

  // --- readings ------------------------------------------------------------

  why() { return this.m.why(0); }
  depth(n) { return this.m.books[0].depth(n); }
  tape(n) { return this.m.books[0].recentTrades(n); }
  conservation() { return this.m.conservation(); }

  // WHO IS CROSSING THE SPREAD TO GET FILLED, smoothed over the last few
  // ticks. This is what the floor is drawn from.
  //
  // It is deliberately the takers and not the resting book. A crowd that wants
  // to buy does not leave bids sitting there; it reaches over and lifts the
  // offers, so a rising market shows a HEAVY sell book and a light buy book,
  // and a floor drawn from depth would put a packed crowd of sellers under the
  // words "everybody wants to buy". Takers are also what actually moves the
  // price, which is the thing the player has to see coming.
  readFlow() {
    const book = this.m.books[0];
    const seen = book.tradeCount - (this.tradesAt || 0);
    this.tradesAt = book.tradeCount;
    let b = 0, s = 0;
    if (seen > 0) {
      for (const t of book.recentTrades(Math.min(seen, 64))) {
        if (t.aggressor === BUY) b += t.qty; else s += t.qty;
      }
    }
    const k = this.cfg.pit.flowDecay;
    this.flowBuy = (this.flowBuy || 0) * k + b;
    this.flowSell = (this.flowSell || 0) * k + s;
  }

  taking() { return { buy: this.flowBuy || 0, sell: this.flowSell || 0 }; }

  // How stale the board is, from 0 when the price is sitting on it to 1 when
  // the price has walked a whole spread away and one side is being run over.
  staleness() {
    if (!this.bidOn && !this.askOn) return 1;
    const half = Math.max(1, this.spread / 2);
    return clamp(Math.abs(this.drift()) / (half * 2), 0, 1);
  }

  record() {
    this.history.push(this.mid);
    if (this.history.length > this.cfg.sim.historyLen) this.history.shift();
    this.readFlow();
  }

  // --- save ----------------------------------------------------------------

  toJSON() {
    return {
      key: this.key, seed: this.seed, crowd: this.crowd, seatBps: this.seatBps,
      priceMul: this.priceMul, bid: this.bid, ask: this.ask, size: this.size,
      spread: this.spread, lean: this.lean, bidOn: this.bidOn, askOn: this.askOn,
      bidIds: this.bidIds.slice(), askIds: this.askIds.slice(), held: this.held,
      basis: this.basis, realized: this.realized, swept: this.swept,
      seatPaid: this.seatPaid, volumeAtGrow: this.volumeAtGrow, fillsSeen: this.fillsSeen,
      history: this.history.slice(), closed: this.closed,
      market: this.m.toJSON(),
    };
  }

  static fromJSON(j, cfg) {
    const p = new Pit(j.key, cfg, { seed: j.seed, crowd: j.crowd, seatBps: j.seatBps, priceMul: j.priceMul });
    const s = cfg.pits[j.key];
    p.m = Market.fromJSON(j.market, { rules: { belief: BELIEFS[s.belief], sizing: SIZING[s.sizing] } });
    p.world(p.m);
    for (const k of ['bid', 'ask', 'size', 'spread', 'lean', 'bidOn', 'askOn', 'held', 'basis', 'realized', 'swept', 'seatPaid', 'volumeAtGrow', 'fillsSeen', 'closed']) {
      if (j[k] !== undefined) p[k] = j[k];
    }
    p.history = Array.isArray(j.history) ? j.history.slice() : [];
    p.bidIds = Array.isArray(j.bidIds) ? j.bidIds.slice() : [];
    p.askIds = Array.isArray(j.askIds) ? j.askIds.slice() : [];
    return p;
  }
}

export default Pit;
