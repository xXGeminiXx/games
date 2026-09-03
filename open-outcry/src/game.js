// ---------------------------------------------------------------------------
// The run: the till, the pits that are open, the ladder, and the road out.
//
// The pit (src/pit.js) is where money is made a few ticks at a time. This file
// is everything above it: what a purchase costs, what is on screen yet, when a
// runner brings news, when a pit can be closed by cornering it, and what a
// player carries into the next city.
//
// FUNDS IS THE NUMBER, and it is a big number (src/bignum.js) because a run
// does not end. A PIT's money is not: the book matches on integer ticks and
// integer units, and it stays inside a working float that never grows past a
// few quotes' worth. Everything the pits earn is swept into the till, which is
// the only place the number is allowed to run away.
//
// NOTHING PAYS OUT ON A SCHEDULE. Reputation buys structure at the moment a
// city is entered - a bigger floor, a cheaper seat, another pit, a faster
// clock - and then it is spent and gone. A share of the take every N minutes
// would be compound interest wearing a hat, and it would bend the curve
// upward for the rest of the run.
// ---------------------------------------------------------------------------

import { Pit } from './pit.js?v=4';
import { big, add, sub, mul, cmp, gte, toNumber, ZERO } from './bignum.js?v=4';
import { quote } from './purchase.js?v=4';
import { catchUp, summary } from './offline.js?v=4';
import { createEngine } from './rules.js?v=4';
import { buildRegistry, firstCard, SENSOR_TIERS, ACTION_TIERS } from './clerks.js?v=4';
import { rng } from './rng.js?v=4';
import { fill, pick } from '../content.js?v=4';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Game {
  constructor(cfg, content, opts = {}) {
    this.cfg = cfg;
    this.content = content;
    this.seed = opts.seed || 'oo-' + Math.floor(Date.now() % 1e7);
    this.funds = big(0);
    this.reputation = 0;
    this.city = 0;
    this.corners = 0;           // pits taken in THIS city
    this.cornersEver = 0;       // pits taken over the whole run
    this.cornered = new Set();  // a pit taken here cannot be opened here again
    this.fills = 0;
    this.volumeTotal = 0;
    this.picks = 0;                 // how many content picks have been made, so a load repeats them
    this.bought = { size: 0, clerk: 0, seat: 0, runner: 0 };
    this.spent = { floor: 0, seat: 0, slot: 0, clock: 0 };
    this.pits = new Map();
    this.order = [];
    this.active = null;
    this.revealed = new Set();
    this.log = [];
    this.rumours = new Map();       // pit key -> { kind, at, told, landed }
    this.engines = new Map();       // pit key -> rules engine
    this.registry = null;
    this.registryTier = 0;
    this.lastSeen = opts.now || Date.now();
    this.elapsedTicks = 0;
    this.lastSweep = 0;

    this.rebuildRegistry();
    if (!opts.blank) {
      this.funds = big(cfg.pit.startFunds);
      this.openPit(cfg.pitOrder[0], { free: true, quiet: true });
      this.settleAll();
    }
  }

  // --- names and rates -----------------------------------------------------

  cityName() {
    const list = this.content.cities;
    return list[this.city % list.length] + (this.city >= list.length ? ' ' + (1 + Math.floor(this.city / list.length)) : '');
  }

  nextCityName() {
    const list = this.content.cities;
    const n = this.city + 1;
    return list[n % list.length] + (n >= list.length ? ' ' + (1 + Math.floor(n / list.length)) : '');
  }

  tickHz() {
    const c = this.cfg;
    const base = c.sim.tickHz * Math.pow(c.city.tickHzGrowth, this.city);
    return Math.min(c.city.tickHzMax, base + c.city.clockBonus * this.spent.clock);
  }

  crowdCap() {
    const t = this.cfg.city.crowdCap;
    const base = this.city < t.length ? t[this.city]
      : Math.round(t[t.length - 1] * Math.pow(this.cfg.city.crowdCapGrowth, this.city - t.length + 1));
    return base + this.cfg.crowd.reputationCapBonus * this.spent.floor;
  }

  // A pit opens with a share of the city's floor already on it, so a bigger
  // city is bigger from the first tick rather than after an hour of growth.
  openingCrowd() {
    return Math.max(this.cfg.crowd.start, Math.round(this.crowdCap() * this.cfg.city.openShare));
  }

  cornersToLeave() {
    const t = this.cfg.city.cornersToLeave;
    return this.city < t.length ? t[this.city] : t[t.length - 1];
  }

  slots() {
    const t = this.cfg.city.slots;
    const base = this.city < t.length ? t[this.city] : t[t.length - 1];
    return Math.min(this.cfg.city.slotsMax, base + this.spent.slot);
  }

  priceMul() { return Math.pow(this.cfg.city.priceGrowth, this.city); }
  costMul() { return Math.pow(this.cfg.city.costGrowth, this.city); }
  seatCostMul() { return Math.max(0.2, 1 - this.cfg.city.seatDiscount * this.spent.seat); }
  quoteSize() { return this.cfg.pit.startSize + this.bought.size * this.cfg.ladder.size.step; }
  seatBps() { return this.bought.seat * this.cfg.ladder.seat.bps; }
  runnerLead() { return this.cfg.rumour.leadBase + this.bought.runner * this.cfg.ladder.runner.lead; }

  // --- the log -------------------------------------------------------------

  note(text) {
    if (!text) return;
    this.log.push({ t: this.elapsedTicks, text });
    if (this.log.length > this.cfg.sim.logLen) this.log.shift();
  }

  // A seeded pick that a reload repeats: the counter is saved, so the same run
  // reads the same words in the same order.
  say(pool) {
    const r = rng(`${this.seed}/say/${this.picks++}`);
    return pick(pool, r);
  }

  // --- pits ----------------------------------------------------------------

  pit(key) { return this.pits.get(key); }
  activePit() { return this.pits.get(this.active); }
  openPits() { return this.order.map((k) => this.pits.get(k)).filter(Boolean); }

  pitCost(key) {
    return Math.round(this.cfg.pits[key].cost * this.costMul());
  }

  canOpen(key) {
    if (this.pits.has(key) || this.cornered.has(key)) return false;
    if (this.order.length >= this.slots()) return false;
    // A pit opens once the one before it in the order has been WORKED, which
    // a pit that was taken and closed counts as. Requiring it to still be open
    // would strand a player who cornered their way up the order.
    const i = this.cfg.pitOrder.indexOf(key);
    const prev = this.cfg.pitOrder[i - 1];
    if (i > 0 && !this.pits.has(prev) && !this.cornered.has(prev)) return false;
    return gte(this.wallet(), this.pitCost(key));
  }

  openPit(key, opts = {}) {
    if (this.pits.has(key) || (!opts.free && this.cornered.has(key))) return null;
    const cost = opts.free ? 0 : this.pitCost(key);
    if (!opts.free && !gte(this.wallet(), cost)) return null;
    if (!opts.free) { this.freeCash(cost); this.funds = sub(this.funds, cost); }
    const p = new Pit(key, this.cfg, {
      seed: `${this.seed}/c${this.city}/${key}`,
      crowd: Math.min(this.openingCrowd(), this.crowdCap()),
      seatBps: this.seatBps(),
      priceMul: this.priceMul(),
    });
    p.setSize(this.quoteSize());
    p.recentre();
    p.place();
    this.pits.set(key, p);
    this.order.push(key);
    if (!this.active) this.active = key;
    this.engines.set(key, createEngine({ registry: this.registry, maxFiresPerTick: Math.max(1, this.bought.clerk) }));
    this.scheduleRumour(key);
    if (!opts.quiet) this.note(fill(this.content.events.marketOpened, { pit: p.name }));
    this.staffBoards();
    return p;
  }

  // --- the ladder ----------------------------------------------------------

  curve(id) {
    const l = this.cfg.ladder[id];
    const mul = id === 'seat' ? this.seatCostMul() : 1;
    return { base: l.base * this.costMul() * mul, r: l.r, owned: this.bought[id] };
  }

  // What a button should say and what a click should do, worked out against
  // the till as it is at this instant rather than at the frame it was drawn.
  quoteFor(id, k) {
    const l = this.cfg.ladder[id];
    const cap = l.max === undefined ? Infinity : Math.max(0, l.max - this.bought[id]);
    return quote(this.wallet(), this.curve(id), k, { cap });
  }

  buy(id, k = 1) {
    const q = this.quoteFor(id, k);
    if (q.count <= 0) return { ok: false, quote: q };
    this.freeCash(q.total);
    this.funds = sub(this.funds, q.total);
    this.bought[id] += q.count;
    if (id === 'size') for (const p of this.openPits()) p.setSize(this.quoteSize());
    if (id === 'seat') for (const p of this.openPits()) { p.seatBps = this.seatBps(); p.m.setFeeBps(p.seatBps); }
    if (id === 'clerk') this.onClerkHired(q.count);
    if (id === 'runner' && this.bought.runner === q.count) this.note(fill(this.content.events.runnerHired, { lead: Math.round((this.runnerLead() / this.tickHz()) * 10) / 10 }));
    if (id === 'seat') this.note(this.content.events.seatUp);
    return { ok: true, quote: q };
  }

  // --- clerks --------------------------------------------------------------

  clerkTier() { return Math.max(1, this.bought.clerk); }

  rebuildRegistry() {
    const tier = this.clerkTier();
    if (this.registry && this.registryTier === tier) return false;
    this.registry = buildRegistry(this.content, tier);
    this.registryTier = tier;
    // The engines hold a reference to the registry, so they are rebuilt with
    // the cards they already had; a card naming something that has not been
    // reached yet would be quarantined rather than lost, but nothing here can
    // produce one.
    for (const [key, engine] of this.engines) {
      const cards = engine.getRules();
      const next = createEngine({ registry: this.registry, maxFiresPerTick: Math.max(1, this.bought.clerk), tick: engine.tickIndex });
      next.setRules(cards);
      this.engines.set(key, next);
    }
    return true;
  }

  cardCount() {
    let n = 0;
    for (const e of this.engines.values()) n += e.getRules().length;
    return n;
  }

  clerkSlots() { return this.bought.clerk; }
  clerksFree() { return Math.max(0, this.clerkSlots() - this.cardCount()); }

  onClerkHired(n) {
    this.rebuildRegistry();
    for (const e of this.engines.values()) e.setMaxFires(Math.max(1, this.bought.clerk));
    this.staffBoards();
    return n;
  }

  // A HIRED CLERK IS ALREADY DOING THE JOB. They arrive knowing the one click
  // the player has been making by hand, and they take the first board that
  // has nobody on it, so hiring one and opening a market is two clicks and no
  // configuration. The composer is there for a player who wants to change what
  // they do, never to make them work in the first place.
  staffBoards() {
    let hired = false;
    for (const p of this.openPits()) {
      if (this.clerksFree() <= 0) break;
      const engine = this.engines.get(p.key);
      if (!engine || engine.getRules().length > 0) continue;
      engine.setRules([firstCard(this.content, p.spread)]);
      this.note(fill(this.content.events.clerkHired, { name: this.clerkName(this.cardCount() - 1), pit: p.name }));
      hired = true;
    }
    return hired;
  }

  // Clerks are people, so they have names. The name is the order they were
  // hired in, which is stable across a reload because the count is saved.
  clerkName(i) {
    const list = this.content.clerkNames;
    return list[i % list.length] + (i >= list.length ? ' ' + (1 + Math.floor(i / list.length)) : '');
  }

  // Who is working which board, for the panel. One card is one clerk.
  clerkRoster() {
    const out = [];
    for (const key of this.order) {
      const engine = this.engines.get(key);
      if (!engine) continue;
      for (const card of engine.getRules()) {
        out.push({ name: this.clerkName(out.length), pit: this.pits.get(key).name, job: card.name, on: card.enabled !== false });
      }
    }
    for (let i = out.length; i < this.clerkSlots(); i++) out.push({ name: this.clerkName(i), pit: null, job: null, on: false });
    return out;
  }

  setCards(key, cards) {
    const engine = this.engines.get(key);
    if (!engine) return { ok: false, errors: [] };
    const others = this.cardCount() - engine.getRules().length;
    const room = Math.max(0, this.clerkSlots() - others);
    return engine.setRules(cards.slice(0, room));
  }

  // --- rumours -------------------------------------------------------------

  scheduleRumour(key) {
    const p = this.pits.get(key);
    if (!p) return;
    const n = (this.rumours.get(key) ? this.rumours.get(key).n + 1 : 0);
    const r = rng(`${this.seed}/rumour/${key}/${this.city}/${n}`);
    const c = this.cfg.rumour;
    const kinds = Object.keys(c.kinds);
    this.rumours.set(key, {
      n,
      kind: r.pick(kinds),
      at: p.tick + c.everyTicks + r.int(-c.jitter, c.jitter),
      told: false,
      landed: false,
    });
  }

  stepRumour(p, quiet) {
    const r = this.rumours.get(p.key);
    if (!r) return;
    const c = this.cfg.rumour;
    const spec = c.kinds[r.kind];
    const words = this.content.rumours[r.kind];
    if (!r.told && p.tick >= r.at - this.runnerLead()) {
      r.told = true;
      p.rumourKnown = true;
      if (this.runnerLead() > 0 && !quiet) this.note(fill(this.content.events.rumour, { text: fill(words.news, { pit: p.name }) }));
    }
    if (!r.landed && p.tick >= r.at) {
      r.landed = true;
      p.rumourKnown = false;
      p.m.shock({ kind: spec.shock, good: 0, factor: spec.factor, ticks: spec.ticks });
      p.shockUntil = p.tick + spec.ticks;
      p.shockText = fill(words.land, { pit: p.name });
      if (!quiet) this.note(fill(this.content.events.shockHit, { text: p.shockText }));
      this.scheduleRumour(p.key);
    }
    if (p.shockUntil && p.tick > p.shockUntil) { p.shockUntil = 0; p.shockText = ''; }
  }

  // --- the tick ------------------------------------------------------------

  tick(quiet = false) {
    this.elapsedTicks++;
    for (const p of this.openPits()) {
      p.m.tick();
      const f = p.readFills();
      if (f) { this.fills++; if (!quiet) this.noteFill(p, f); }
      this.volumeTotal += p.m.fills.reduce((a, x) => a + x.qty, 0);

      const engine = this.engines.get(p.key);
      const staffed = engine && engine.getRules().some((r) => r.enabled);
      if (staffed) engine.tick({ pit: p, game: this });

      // A QUOTE STANDS ONLY WHERE SOMEBODY IS STANDING. The pit you are looking
      // at is quoted because you are at its rail; any other pit is quoted only
      // if a clerk is working it. A quote nobody is moving is run over by the
      // market within a minute, so a second pit without a clerk on it would be
      // a hole in the till rather than a second income, and a player would have
      // no way to see why. This is what makes a clerk the thing that lets you
      // hold more than one pit.
      p.attended = p.key === this.active || !!staffed;
      if (!p.attended) p.pull();
      else {
        this.take(-p.fund(this.spare()));
        p.place();
        this.take(p.sweep());
      }
      p.record();
      this.stepRumour(p, quiet);
      if (p.tick % this.cfg.pit.anchorEvery === 0) p.anchor();

      p.held = p.share >= this.cfg.corner.share ? p.held + 1 : 0;

      const cap = this.crowdCap();
      const pending = p.pendingCrowd(cap);
      if (pending > 0) {
        p.growCrowd(pending);
        p.setSize(Math.min(p.size, this.quoteSize()));
        if (p.attended) {
          this.take(-p.fund(this.spare()));
          p.place();
          this.take(p.sweep());
        }
        if (!quiet) this.note(fill(this.content.events.crowdGrew, { n: pending }));
      }
    }

    this.checkReveals();
    return this;
  }

  noteFill(p, f) {
    const c = this.content.fills;
    if (f.bought && f.sold) this.note(fill(c.both, { qty: f.bought + f.sold, price: f.price }));
    else if (f.bought) this.note(fill(c.bought, { qty: f.bought, price: f.price }));
    else if (f.sold) this.note(fill(c.sold, { qty: f.sold, price: f.price }));
  }

  // The till, as a plain number the pits can be funded from. A quote may stand
  // on most of it but never all of it, so a pit whose bid has just been written
  // cannot leave the run with nothing loose at all.
  spare() {
    const till = cmp(this.funds, 1e12) > 0 ? 1e12 : Math.max(0, Math.floor(toNumber(this.funds)));
    return Math.floor(till * this.cfg.pit.wireShare);
  }

  // Cash standing behind the quotes on the boards. It is money, it is just not
  // loose: cancel the quote and it comes back within the tick.
  onBoards() {
    let e = 0;
    for (const p of this.openPits()) e += p.m.player.escrow;
    return Math.round(e);
  }

  // The number on the wall: everything that is money, wherever it is standing.
  cash() { return add(this.funds, this.onBoards()); }

  // Money that has to stay behind the quotes the boards are carrying.
  //
  // A bid escrows its whole value the moment it is written, so quoting size S
  // at price P takes S times P in cash and nothing else can have it. Without
  // this the ladder eats the capital its own rungs need: a player buys size
  // until the till cannot fund a single bid, every quote is trimmed to nothing,
  // income stops, and the run is over with a large number on the wall. So the
  // shop spends what is LEFT once the quotes are covered, and the size rung is
  // gated by whether the player can still stand behind it.
  reserve() {
    let r = 0;
    for (const p of this.openPits()) r += Math.max(1, p.bid) * Math.max(1, p.size);
    return Math.ceil(r * this.cfg.pit.reserveOfQuote);
  }

  // What the shop may spend: everything that is money, less what the quotes
  // need to keep standing.
  wallet() {
    const left = sub(this.cash(), this.reserve());
    return cmp(left, 0) > 0 ? left : ZERO;
  }

  // Take the quotes off the boards until the till alone can pay for something.
  // Stepping away from the rail to settle up costs the place in the queue that
  // waiting earned, which is the whole price of buying in the middle of a
  // market; the quotes go back up on the next tick.
  freeCash(need) {
    if (gte(this.funds, need)) return true;
    for (const p of this.openPits()) {
      p.cancel();
      this.take(p.sweep());
      if (gte(this.funds, need)) return true;
    }
    return gte(this.funds, need);
  }

  take(n) {
    if (n > 0) this.funds = add(this.funds, n);
    else if (n < 0) this.funds = sub(this.funds, -n);
    if (cmp(this.funds, 0) < 0) this.funds = ZERO;
  }

  settleAll() {
    for (const p of this.openPits()) {
      this.take(-p.fund(this.spare()));
      this.take(p.sweep());
    }
  }

  // --- what is on screen yet -----------------------------------------------

  reveal(id) {
    if (this.revealed.has(id)) return false;
    this.revealed.add(id);
    return true;
  }

  shown(id) { return this.revealed.has(id); }

  checkReveals() {
    const r = this.cfg.reveal;
    const p = this.activePit();
    if (this.fills >= r.ladder.fills) this.reveal('ladder');
    if (this.fills >= r.spread.fills) this.reveal('spread');
    if (gte(this.funds, r.clerks.funds * this.costMul())) this.reveal('clerks');
    if (this.volumeTotal >= r.seat.volume) this.reveal('seat');
    if (this.bought.clerk >= r.pits.clerks) this.reveal('pits');
    if (this.order.length >= r.runners.pits) this.reveal('runners');
    if (p && p.share >= r.corner.share) this.reveal('corner');
    if (this.cornersEver >= r.city.corners) this.reveal('city');
  }

  // --- cornering -----------------------------------------------------------

  cornerQuote(key) {
    const p = this.pits.get(key);
    if (!p) return null;
    const c = this.cfg.corner;
    const mid = p.mid;
    const funds = Math.round(p.position * mid * c.premium);
    const rep = Math.max(c.reputationMin, Math.round(p.crowd * c.reputationOfCrowd));
    return {
      share: p.share, need: c.share, held: p.held, holdTicks: c.holdTicks,
      // The last pit on the floor cannot be closed. A player who shut their
      // only market would have no income and no way back, and a run that can
      // be walked into a dead end is a bug wearing a decision.
      last: this.order.length < 2,
      ready: p.share >= c.share && p.held >= c.holdTicks && this.order.length >= 2,
      funds, rep, mid,
    };
  }

  callCorner(key) {
    const q = this.cornerQuote(key);
    if (!q || !q.ready) return null;
    const p = this.pits.get(key);
    p.cancel();
    this.funds = add(this.funds, q.funds);
    this.reputation += q.rep;
    this.corners++;
    this.cornersEver++;
    this.cornered.add(key);
    this.pits.delete(key);
    this.order = this.order.filter((k) => k !== key);
    this.engines.delete(key);
    this.rumours.delete(key);
    if (this.active === key) this.active = this.order[0] || null;
    this.note(fill(this.content.events.marketCornered, { pit: p.name, funds: q.funds, rep: q.rep }));
    this.checkReveals();
    return q;
  }

  // --- the road out --------------------------------------------------------

  canLeave() { return this.corners >= this.cornersToLeave(); }

  spendQuote(id, k = 1) {
    const s = this.cfg.city.spend[id];
    return quote(this.reputation, { base: s.base, r: s.r, owned: this.spent[id] }, k);
  }

  spendReputation(id, k = 1) {
    const q = this.spendQuote(id, k);
    if (q.count <= 0) return { ok: false, quote: q };
    // Reputation is counted in whole names, so a geometric total is rounded up
    // rather than left as a fraction nobody can spend.
    q.total = Math.ceil(Number(q.total));
    this.reputation -= q.total;
    this.spent[id] += q.count;
    this.note(fill(this.content.events.citySpent, { label: this.cfg.city.spend[id].label, n: q.total }));
    return { ok: true, quote: q };
  }

  leaveCity() {
    if (!this.canLeave()) return null;
    for (const p of this.openPits()) p.cancel();
    this.settleAll();
    this.pits.clear();
    this.engines.clear();
    this.rumours.clear();
    this.order = [];
    this.active = null;
    this.city++;
    this.corners = 0;
    this.cornered.clear();
    this.bought.seat = 0;          // a seat belongs to the floor you bought it on
    const name = this.cityName();
    this.openPit(this.cfg.pitOrder[0], { free: true, quiet: true });
    this.note(fill(this.content.events.cityLeft, { city: name, n: this.reputation }));
    return { city: this.city, name, reputation: this.reputation };
  }

  // --- away and back -------------------------------------------------------

  // The floor keeps trading with nobody at the rail. It is run for real, but
  // only for a bounded number of ticks: past that the till is paid at the rate
  // those ticks actually earned, and the summary says so rather than implying
  // every tick was simulated.
  resume(now = Date.now()) {
    const c = this.cfg.offline;
    const hz = this.tickHz();
    const r = catchUp({ lastSeen: this.lastSeen, now, cap: c.cap, step: 1 / hz });
    this.lastSeen = now;
    // The result of catchUp is handed back AS IT IS, with fields added to it.
    // Spreading it into a new object drops the getter that makes the ambiguous
    // name `seconds` throw, which is the whole reason that guard exists.
    const ticksDue = Math.floor(r.simulated * hz);
    if (ticksDue <= 0 || r.simulated < c.minSeconds) {
      r.ticksDue = 0; r.ticksRun = 0; r.gained = ZERO; r.away = ''; r.counted = '';
      return r;
    }
    const ticksRun = Math.min(ticksDue, c.maxTicks);
    const before = this.funds;
    for (let i = 0; i < ticksRun; i++) this.tick(true);
    this.settleAll();
    let gained = sub(this.funds, before);
    if (cmp(gained, 0) < 0) gained = ZERO;
    const rate = ticksRun > 0 ? ticksDue / ticksRun : 1;
    if (rate > 1) {
      const extra = mul(gained, rate - 1);
      this.funds = add(this.funds, extra);
      gained = add(gained, extra);
    }
    const s = summary(r, { minSeconds: c.minSeconds });
    r.ticksDue = ticksDue;
    r.ticksRun = ticksRun;
    r.rate = rate;
    r.gained = gained;
    r.away = s.away;
    r.counted = s.counted;
    return r;
  }

  // --- save ----------------------------------------------------------------

  toJSON() {
    return {
      seed: this.seed,
      funds: this.funds.toString(),
      reputation: this.reputation,
      city: this.city,
      corners: this.corners,
      cornersEver: this.cornersEver,
      cornered: [...this.cornered],
      fills: this.fills,
      volumeTotal: this.volumeTotal,
      picks: this.picks,
      bought: { ...this.bought },
      spent: { ...this.spent },
      order: this.order.slice(),
      active: this.active,
      revealed: [...this.revealed],
      log: this.log.slice(-this.cfg.sim.logLen),
      elapsedTicks: this.elapsedTicks,
      lastSeen: this.lastSeen,
      pits: this.order.map((k) => this.pits.get(k).toJSON()),
      rumours: [...this.rumours].map(([k, v]) => [k, { ...v }]),
      cards: [...this.engines].map(([k, e]) => [k, e.toJSON()]),
    };
  }

  static fromJSON(j, cfg, content) {
    const g = new Game(cfg, content, { blank: true, seed: j.seed });
    g.funds = big(j.funds);
    g.reputation = j.reputation || 0;
    g.city = j.city || 0;
    g.corners = j.corners || 0;
    g.cornersEver = j.cornersEver || 0;
    g.cornered = new Set(j.cornered || []);
    g.fills = j.fills || 0;
    g.volumeTotal = j.volumeTotal || 0;
    g.picks = j.picks || 0;
    g.bought = { size: 0, clerk: 0, seat: 0, runner: 0, ...(j.bought || {}) };
    g.spent = { floor: 0, seat: 0, slot: 0, clock: 0, ...(j.spent || {}) };
    g.order = (j.order || []).slice();
    g.active = j.active || g.order[0] || null;
    g.revealed = new Set(j.revealed || []);
    g.log = (j.log || []).slice();
    g.elapsedTicks = j.elapsedTicks || 0;
    g.lastSeen = j.lastSeen || Date.now();
    for (const pj of j.pits || []) g.pits.set(pj.key, Pit.fromJSON(pj, cfg));
    for (const [k, v] of j.rumours || []) g.rumours.set(k, { ...v });
    g.registryTier = 0;
    g.rebuildRegistry();
    for (const key of g.order) {
      const engine = createEngine({ registry: g.registry, maxFiresPerTick: Math.max(1, g.bought.clerk) });
      const saved = (j.cards || []).find(([k]) => k === key);
      if (saved) engine.loadJSON(saved[1]);
      g.engines.set(key, engine);
    }
    if (!g.order.length) g.openPit(cfg.pitOrder[0], { free: true, quiet: true });
    return g;
  }
}

export { SENSOR_TIERS, ACTION_TIERS };
export default Game;
