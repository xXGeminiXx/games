// ---------------------------------------------------------------------------
// The interface: the sentences over the slate, the two dials above the rail,
// the panel at the side, and the loop that drives all of it.
//
// THE BOARD DRAWS FIGURES. THIS FILE WRITES SENTENCES. A stroke alphabet at
// fourteen pixels is mud, and every line the game uses to teach itself is a
// sentence, so the canvas gets the purse, the going rate and the two prices on
// the wall, and the page gets the words. Both read the same state.
//
// THE PLAYER NEVER TYPES A PRICE. Two prices go on the wall - what you pay for
// a sack and what you charge for one - and both are worked out from the going
// rate and one dial: how much of a cut you want. The other dial is how many
// sacks you will handle at a time. Everything else is one button: the market
// walks away from what you wrote, and you wipe it and write it again.
//
// One requestAnimationFrame loop owns the whole frame: it advances the markets
// by a fixed number of ticks, renders the board, and writes the panel at a
// slower cadence than it draws, because text that changes sixty times a second
// cannot be read and costs more than the picture does.
//
// PROGRESSIVE REVEAL is done by hiding sections, not by building them late, so
// the layout never jumps as the game opens up.
// ---------------------------------------------------------------------------

import { CONFIG, withOverrides, applyIdentity } from '../config.js?v=4';
import { CONTENT, fill } from '../content.js?v=4';
import { Game } from './game.js?v=4';
import { Board } from './board.js?v=4';
import { format, counter } from './format.js?v=4';
import { toNumber, cmp } from './bignum.js?v=4';
import { createSave } from './save.js?v=4';
import { affordability } from './purchase.js?v=4';
import { createComposer } from './rules-ui.js?v=4';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (v) => format(v, { decimals: 2 });
// A price is a whole number of coins. Nothing in this game is sold by the
// penny, and a shelf that quotes 777.68 reads as a spreadsheet.
const coins = (v) => format(typeof v === 'number' ? Math.round(v) : v, { decimals: 0 });
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// What is on the shelf, in one place, so the panel is a list and not four
// hand-written blocks that drift apart.
const SHOP = [
  { id: 'size', reveal: 'ladder', name: 'sizeName' },
  { id: 'clerk', reveal: 'clerks', name: 'clerkName' },
  { id: 'seat', reveal: 'seat', name: 'seatName' },
  { id: 'runner', reveal: 'runners', name: 'runnerName' },
];

export function boot() {
  const cfg = withOverrides(CONFIG, location.search, typeof localStorage !== 'undefined' ? localStorage : null);
  const content = CONTENT;
  applyIdentity(cfg, document);
  fillStatic(content);

  const save = createSave({
    key: cfg.identity.storageKey,
    migrations: [],
    interval: cfg.save.intervalSeconds,
    serialize: () => { game.lastSeen = Date.now(); return game.toJSON(); },
  });

  let game;
  const loaded = save.load();
  if (loaded.data) {
    try { game = Game.fromJSON(loaded.data, cfg, content); } catch (e) { game = null; }
  }
  const fresh = !game;
  if (!game) game = new Game(cfg, content);

  const board = new Board($('c'), cfg, content);
  const purse = counter({ rate: 9 });
  purse.snap(toNumber(game.funds));

  const ui = new UI(cfg, content, game, board, save, purse);
  window.game = game;
  window.ui = ui;
  ui.start(fresh);
  return ui;
}

// Every static label on the page names its string in content, so a word is
// changed in one place and a test can prove every name resolves.
function fillStatic(content) {
  const at = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), content);
  for (const node of document.querySelectorAll('[data-t]')) {
    const s = at(node.getAttribute('data-t'));
    if (typeof s === 'string') node.textContent = s;
  }
  for (const node of document.querySelectorAll('[data-title]')) {
    const s = at(node.getAttribute('data-title'));
    if (typeof s === 'string') node.title = s;
  }
}

// The opening sheet, filled from the board it is standing in front of.
function fillIntro(content, pit) {
  const steps = $('intro-steps');
  if (!steps || steps.childElementCount) return;
  const v = pit ? { bid: pit.bid, ask: pit.ask, cut: pit.ask - pit.bid } : {};
  for (const line of content.intro.steps) steps.appendChild(el('li', null, fill(line, v)));
}

class UI {
  constructor(cfg, content, game, board, save, purse) {
    this.cfg = cfg;
    this.content = content;
    this.game = game;
    this.board = board;
    this.save = save;
    this.purse = purse;
    this.acc = 0;
    this.last = 0;
    this.panelAt = 0;
    this.tickVolume = 0;
    this.shop = new Map();
    this.spendRows = new Map();
    this.marketRows = new Map();
    this.composer = null;
    this.composerFor = null;
    this.composerTier = 0;
    this.composerOpen = false;
    this.afford = affordability();
    this.folded = false;
    this.said = new Map();       // last text written into each node, so a
    this.frames = 0;             // frame that changed nothing touches no DOM
  }

  start(fresh) {
    this.buildShop();
    this.buildCity();
    this.bind();
    this.resize();
    addEventListener('resize', () => this.resize());
    if (fresh) { fillIntro(this.content, this.game.activePit()); this.sheet('intro', true); }
    else this.showAway();
    this.save.start();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- layout --------------------------------------------------------------

  // The sentences and the controls are laid out against the picture, so where
  // the rail lands has to reach the stylesheet. Two custom properties carry it.
  resize() {
    const c = $('c');
    const r = c.getBoundingClientRect();
    const narrow = innerWidth <= 820;
    this.board.setNarrow(narrow);
    this.board.setInset(narrow ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panelW')) || 0);
    this.board.resize(Math.round(r.width), Math.round(r.height), devicePixelRatio || 1);
    const root = document.documentElement.style;
    const h = Math.max(1, r.height);
    root.setProperty('--railTop', (this.board.railTop / h) * 100 + '%');
    root.setProperty('--railBottom', (this.board.railBottom / h) * 100 + '%');
    root.setProperty('--floorBottom', (this.board.floorBottom / h) * 100 + '%');
    $('hint').textContent = this.content.labels.hint;
  }

  // --- the frame -----------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    window.__frame = this.frames;

    const g = this.game;
    const hz = g.tickHz();
    this.acc += dt * hz;
    let ran = 0;
    const cap = this.cfg.sim.maxCatchUpTicks;
    const was = g.activePit();
    while (this.acc >= 1 && ran < cap) { g.tick(); this.acc -= 1; ran++; }
    if (this.acc > cap) this.acc = 0;

    const p = g.activePit();
    if (p) {
      let vol = 0;
      for (const f of p.m.fills) vol += f.qty;
      this.tickVolume = ran > 0 ? vol : this.tickVolume * 0.9;
      if (ran > 0 && p === was) this.throwMoney(p);
    }

    this.purse.set(toNumber(g.funds));
    this.purse.update(dt);
    this.board.render(this.view(), dt);

    if (now - this.panelAt > 130) { this.panelAt = now; this.refresh(); }
    requestAnimationFrame((t) => this.frame(t));
  }

  // THE GAP, THROWN UP THE WALL. When both sides of the board fill in the same
  // breath you have bought a sack and sold a sack and kept the difference, and
  // that difference is the whole game, so it is the one number that gets an
  // animation. Nothing pops for a one-sided fill: buying a sack has not made
  // any money yet, and saying it did would be a lie the purse contradicts a
  // minute later.
  throwMoney(p) {
    const f = p.lastFill;
    if (!f) return;
    const matched = Math.min(f.bought, f.sold);
    if (matched <= 0) return;
    const kept = Math.round(matched * (f.sellPrice - f.buyPrice));
    if (kept === 0) return;
    this.board.pop((kept > 0 ? '+' : '') + fmt(kept), kept > 0 ? 'buy' : 'sell');
  }

  view() {
    const g = this.game, p = g.activePit();
    const purse = fmt(Math.round(this.purse.value));
    if (!p) return { purse, pitName: '', rate: '0', history: [], showQuote: false, bid: 0, ask: 0, buyPressure: 0, sellPressure: 0, crowd: 1, volume: 0 };
    const press = p.taking();
    return {
      // The figure on the wall is whole coins. A purse that reads 810.07 is a
      // spreadsheet, not a board somebody wrote on.
      purse,
      pitName: p.name,
      rate: String(Math.round(p.mid)),
      history: p.history,
      showQuote: p.bidOn || p.askOn,
      bid: p.bid,
      ask: p.ask,
      buyPressure: press.buy,
      sellPressure: press.sell,
      crowd: p.crowd,
      volume: this.tickVolume,
    };
  }

  // The line under the going rate. The CATEGORY comes from what the tick did;
  // the words are chosen once when the category changes, so the note is stable
  // while the state is and genuinely rewritten when it turns over.
  whyLine(p) {
    const w = p.why();
    const c = this.content.why;
    const book = p.m.books[0];
    let cat;
    if (w.volume === 0) cat = (!book.bestBid() || !book.bestAsk()) ? 'thin' : 'quiet';
    else if (w.net > 0 && w.to >= w.from) cat = 'upBuyers';
    else if (w.net < 0 && w.to <= w.from) cat = 'downSellers';
    else cat = 'flatBoth';
    if (p._whyCat !== cat) { p._whyCat = cat; p._whyText = this.game.say(c[cat]); }
    return p._whyText || '';
  }

  // Write a string into a node only when it actually changed. The panel runs
  // eight times a second and most of what it writes is what it wrote last time.
  say(id, text) {
    if (this.said.get(id) === text) return;
    this.said.set(id, text);
    const node = $(id);
    if (node) node.textContent = text;
  }

  // --- the panel -----------------------------------------------------------

  refresh() {
    const g = this.game, p = g.activePit();
    this.pitTabs();
    this.slate(p);
    this.controls(p);
    this.nextLine();

    this.section('buy', SHOP.some((s) => g.shown(s.reveal)));
    this.section('clerks', g.bought.clerk > 0);
    this.section('markets', g.shown('pits'));
    this.section('corner', g.shown('corner'));
    this.section('city', g.shown('city'));

    for (const row of this.shop.values()) row.update();
    this.markets();
    this.clerks();
    this.corner();
    this.city();
    this.tickets();
    this.logList();
    this.lit();
  }

  section(id, on) { const s = $('sec-' + id); if (s) s.hidden = !on; }

  // The sentences laid over the picture.
  slate(p) {
    const c = this.content.labels;
    if (!p) return;
    // A NUMBER ONLY MEANS SOMETHING NEXT TO WHAT IS NORMAL. Holding a couple of
    // sacks is the job; holding forty is a bet on the price, and the line says
    // so and turns red. Turning red for any stock at all made red mean nothing,
    // because you are almost always carrying something.
    const held = p.position;
    const lots = Math.abs(held) > p.size * this.cfg.pit.carryOfSize;
    this.say('holding', held === 0 ? c.holdingNone
      : held > 0 ? fill(c[lots ? 'holdingLots' : 'holding'], { n: held })
        : fill(c[lots ? 'owingLots' : 'owing'], { n: -held }));
    $('holding').classList.toggle('carrying', lots);
    this.say('crowd', fill(c.crowd, { n: format(p.crowd, { decimals: 0 }) }));
    this.say('why', this.whyLine(p));
    this.say('news', p.shockText || '');
  }

  // The two dials, the one button, and the line that says how far the price
  // has walked off the board. That bar is the whole tension of the game made
  // visible: it fills, you wipe, it starts filling again.
  controls(p) {
    const c = this.content.labels;
    if (!p) return;
    this.say('cut-val', String(p.spread));
    this.say('size-val', String(p.size));
    // WHICH WAY IT WENT AND WHAT THAT COSTS. "The price has left your board" is
    // true and useless; a player wants to know that everything they have is
    // about to be bought off them, or that they are about to be sold to all
    // afternoon. The line only says that once the price is genuinely past one
    // of the two written on the wall.
    const down = !p.bidOn && !p.askOn;
    const s = p.staleness();
    const state = down ? 'down' : s > 0.62 ? 'stale' : s > 0.3 ? 'warn' : 'on';
    const mid = p.mid;
    const stale = mid > p.ask ? c.freshHigh : mid < p.bid ? c.freshLow : c.freshStale;
    this.say('fresh-text', down ? c.freshDown
      : state === 'stale' ? stale
        : state === 'warn' ? c.freshDrift : c.freshOn);
    $('fresh-bar').style.width = Math.round(s * 100) + '%';
    const fresh = $('fresh');
    fresh.classList.toggle('warn', state === 'warn');
    fresh.classList.toggle('stale', state === 'stale' || state === 'down');
    $('wipe').classList.toggle('stale', state === 'stale' || state === 'down');
    $('dump').disabled = p.position <= 0;
    this.say('stopq', down ? c.start : c.stop);
    $('cut-minus').disabled = p.spread <= this.cfg.pit.minSpread;
    $('size-plus').disabled = p.size >= this.game.quoteSize();
    $('size-minus').disabled = p.size <= 1;
  }

  // ONE LINE THAT SAYS WHAT TO DO NEXT, and only ever one. A player who has
  // put the game down for a week reads this and carries on.
  nextLine() {
    const g = this.game, c = this.content.labels, p = g.activePit();
    // A line that says SAVE UP for something already in the purse reads as a
    // game that has not noticed. Each goal has the sentence for both states.
    const goal = (id, key) => {
      const q = g.quoteFor(id, 1);
      const now = q.count > 0;
      return fill(c[key + (now ? 'Now' : '')], { n: coins(now ? q.total : q.price) });
    };
    let text = '';
    if (!g.fills) text = c.nextFirstFill;
    else if (!g.shown('clerks')) text = c.nextWipe;
    else if (g.bought.clerk === 0) text = goal('clerk', 'nextBuyClerk');
    if (!text && g.shown('city') && !g.canLeave()) text = fill(c.nextCity, { n: g.cornersToLeave() - g.corners });
    if (!text && g.shown('corner') && p) text = fill(c.nextCorner, { pit: p.name, have: Math.round(p.share * 100) + '%' });
    if (!text && g.shown('pits')) {
      const next = this.cfg.pitOrder.find((k) => !g.pits.has(k) && !g.cornered.has(k));
      if (next && g.order.length < g.slots()) {
        text = fill(c[g.canOpen(next) ? 'nextOpenPitNow' : 'nextOpenPit'], { n: coins(g.pitCost(next)), pit: this.cfg.pits[next].name });
      }
    }
    if (!text && g.shown('ladder')) text = goal('size', 'nextBuySize');
    this.say('next', text || c.nextNone);
  }

  // What the next one costs, whether or not the purse can reach it. A quote
  // that buys nothing has a total of nothing, and "save up 0" is what that
  // reads as on the page.
  priceOfNext(id) {
    const q = this.game.quoteFor(id, 1);
    return q.count > 0 ? q.total : q.price;
  }

  // Becoming affordable is an event, so a button brightens once rather than
  // every frame for as long as the player is rich.
  lit() {
    const prices = {};
    for (const [id, row] of this.shop) prices[id] = row.priceOfOne();
    for (const ch of this.afford.update(this.game.funds, prices)) {
      const row = this.shop.get(ch.id);
      if (row) row.flash(ch.affordable);
    }
  }

  pitTabs() {
    const g = this.game, mount = $('pittabs');
    const keys = g.order;
    if (mount.dataset.keys !== keys.join(',')) {
      mount.textContent = '';
      keys.forEach((k, i) => {
        const b = el('button', 'tab', g.pit(k).name);
        b.type = 'button';
        b.addEventListener('click', () => { g.active = k; this.rebuildComposer(); this.refresh(); });
        mount.appendChild(b);
      });
      mount.dataset.keys = keys.join(',');
    }
    [...mount.children].forEach((b, i) => b.classList.toggle('on', keys[i] === g.active));
  }

  // --- the shelf -----------------------------------------------------------

  buildShop() {
    const mount = $('buy-list');
    for (const spec of SHOP) this.shop.set(spec.id, this.shopItem(mount, spec));
  }

  // One thing you can buy: what it is called, what it will do for you with the
  // number in it, and at most two buttons.
  //
  // The old row put out four - one, ten, a hundred, and as many as the purse
  // allows - and whenever a cap or the money bit, three of them said the same
  // thing. Two identical buttons side by side is worse than one button.
  shopItem(mount, spec) {
    const g = this.game, c = this.content.labels;
    const box = el('div', 'item');
    const head = el('div', 'head');
    const title = el('span', 'title', c[spec.name]);
    const have = el('span', 'have');
    head.appendChild(title); head.appendChild(have);
    const what = el('div', 'what');
    const acts = el('div', 'acts');
    const one = el('button', 'buy');
    const many = el('button', 'buy');
    one.type = 'button'; many.type = 'button';
    const click = (k) => () => {
      const r = g.buy(spec.id, k);
      if (r.ok) { this.rebuildComposer(); this.save.write('buy'); }
      this.refresh();
    };
    one.addEventListener('click', click(1));
    many.addEventListener('click', click('max'));
    acts.appendChild(one); acts.appendChild(many);
    box.appendChild(head); box.appendChild(what); box.appendChild(acts);
    mount.appendChild(box);

    // What the next one buys you, said with its number in it.
    const wording = () => {
      const p = g.activePit();
      if (spec.id === 'size') return fill(c.sizeWhat, { n: g.quoteSize() + this.cfg.ladder.size.step, was: g.quoteSize() });
      if (spec.id === 'clerk') return c.clerkWhat;
      if (spec.id === 'seat') {
        const paid = p && p.seatPaid > 0 ? ' ' + fill(c.seatPaid, { n: coins(p.seatPaid) }) : '';
        return c.seatWhat + paid;
      }
      const secs = Math.round(((g.runnerLead() + this.cfg.ladder.runner.lead) / g.tickHz()) * 10) / 10;
      return fill(c.runnerWhat, { n: secs });
    };

    return {
      priceOfOne() { const q = g.quoteFor(spec.id, 1); return q.asked === 0 ? Infinity : q.total; },
      flash(on) { one.classList.toggle('lit', on); },
      update: () => {
        box.hidden = !g.shown(spec.reveal);
        if (box.hidden) return;
        have.textContent = fill(c.owned, { n: g.bought[spec.id] });
        what.textContent = wording();
        const q1 = g.quoteFor(spec.id, 1);
        one.disabled = q1.count <= 0;
        one.textContent = q1.count > 0
          ? fill(c.buyFor, { n: 1, cost: coins(q1.total) })
          : `${fill(c.buyFor, { n: 1, cost: coins(q1.price) })}, ${fill(c.needs, { n: coins(q1.shortfall || q1.price) })}`;
        // A second button only when it would buy something the first does not.
        const qm = g.quoteFor(spec.id, 'max');
        const worth = qm.count > 1;
        many.hidden = !worth;
        if (worth) many.textContent = fill(c.buyFor, { n: qm.count, cost: coins(qm.total) });
      },
    };
  }

  markets() {
    const g = this.game, mount = $('market-list');
    const shut = this.cfg.pitOrder.filter((k) => !g.pits.has(k));
    if (mount.dataset.keys !== shut.join(',')) {
      mount.textContent = '';
      this.marketRows.clear();
      for (const k of shut) {
        const box = el('div', 'item');
        const b = el('button', 'buy wide');
        b.type = 'button';
        const what = el('div', 'what', this.content.pits[k] || '');
        b.addEventListener('click', () => { if (g.openPit(k)) { this.rebuildComposer(); this.save.write('pit'); } this.refresh(); });
        box.appendChild(b);
        box.appendChild(what);
        mount.appendChild(box);
        this.marketRows.set(k, { b, box });
      }
      mount.dataset.keys = shut.join(',');
    }
    // A HEADING OVER NOTHING IS A BUG. When every town slot is taken, every row
    // here is hidden and the section used to sit there empty; say why instead.
    const full = g.order.length >= g.slots();
    this.say('markets-full', full ? fill(this.content.labels.marketsFull, { n: g.slots() }) : '');
    $('markets-full').hidden = !full;
    for (const [k, r] of this.marketRows) {
      const name = this.cfg.pits[k].name;
      const text = `${fill(this.content.labels.openMarket, { pit: name })}  ${coins(g.pitCost(k))}`;
      if (r.b.textContent !== text) r.b.textContent = text;
      r.b.disabled = !g.canOpen(k);
      r.box.hidden = full && !g.canOpen(k);
    }
  }

  // Clerks are people with names, and a hired one is already doing the job.
  // The composer that lets you rewrite what they do is behind a toggle,
  // because nobody should have to open a rules editor to hire somebody.
  clerks() {
    const g = this.game, c = this.content.labels, mount = $('clerk-list');
    const roster = g.clerkRoster();
    while (mount.childElementCount < roster.length) {
      const box = el('div', 'clerk');
      box.appendChild(el('div', 'who'));
      box.appendChild(el('div', 'job'));
      mount.appendChild(box);
    }
    while (mount.childElementCount > roster.length) mount.removeChild(mount.lastChild);
    roster.forEach((r, i) => {
      const box = mount.children[i];
      const who = r.pit ? `${r.name}, on the ${r.pit} board` : r.name;
      const job = r.pit ? r.job : c.clerkIdle;
      if (box.children[0].textContent !== who) box.children[0].textContent = who;
      if (box.children[1].textContent !== job) box.children[1].textContent = job;
      box.classList.toggle('idle', !r.pit);
    });
    this.say('clerk-count', fill(c.clerkSlots, { used: g.cardCount(), n: g.clerkSlots() }));
    if (this.composerOpen && g.bought.clerk > 0) this.rebuildComposer();
  }

  rebuildComposer() {
    const g = this.game;
    if (!this.composerOpen || g.bought.clerk <= 0) return;
    const key = g.active;
    const engine = g.engines.get(key);
    if (!engine) return;
    if (this.composerFor === key && this.composerTier === g.registryTier && this.composer) {
      this.composer.refresh(engine.explain({ pit: g.pit(key), game: g }));
      return;
    }
    if (this.composer) this.composer.destroy();
    const mount = $('composer');
    mount.textContent = '';
    this.composer = createComposer({
      engine,
      registry: g.registry,
      mount,
      onChange: (cards) => { g.setCards(key, cards); this.save.write('cards'); },
    });
    this.composerFor = key;
    this.composerTier = g.registryTier;
  }

  corner() {
    const g = this.game, p = g.activePit(), c = this.content.labels;
    if (!p) return;
    const q = g.cornerQuote(p.key);
    $('corner-bar').style.width = Math.round(Math.min(1, q.share / q.need) * 100) + '%';
    this.say('corner-need', q.last ? c.cornerLast
      : q.share >= q.need && q.held < q.holdTicks ? c.cornerHold
        : fill(c.cornerNeed, { pit: p.name, have: Math.round(q.share * 100) + '%' }));
    this.say('corner-pays', fill(c.cornerPays, { funds: coins(q.funds), rep: q.rep }));
    $('corner-call').disabled = !q.ready;
  }

  buildCity() {
    const mount = $('city-spend');
    for (const [id, spec] of Object.entries(this.cfg.city.spend)) {
      const b = el('button', 'buy wide');
      b.type = 'button';
      b.style.marginBottom = '6px';
      b.addEventListener('click', () => { this.game.spendReputation(id, 1); this.refresh(); });
      mount.appendChild(b);
      this.spendRows.set(id, { b, spec });
    }
  }

  city() {
    const g = this.game, c = this.content.labels;
    this.say('city-rep', fill(c.cityRep, { n: g.reputation }));
    for (const [id, r] of this.spendRows) {
      const q = g.spendQuote(id, 1);
      const text = `${r.spec.label}, ${q.price} ${c.reputation}  (${fill(c.cityHave, { n: g.spent[id] })})`;
      if (r.b.textContent !== text) r.b.textContent = text;
      r.b.disabled = q.count <= 0;
    }
    const go = $('city-go');
    const text = g.canLeave()
      ? fill(c.cityGo, { city: g.nextCityName() })
      : fill(c.cityNeed, { n: g.cornersToLeave() - g.corners });
    if (go.textContent !== text) go.textContent = text;
    go.disabled = !g.canLeave();
  }

  // A clerk's ticket hangs from the rail on the board they are working. One
  // that fired this tick is marked, which is the visual twin of it happening.
  tickets() {
    const g = this.game, mount = $('rail'), p = g.activePit();
    if (!p || g.bought.clerk <= 0) { if (mount.childElementCount) mount.textContent = ''; return; }
    const engine = g.engines.get(p.key);
    if (!engine) return;
    const rows = engine.lastExplain || [];
    if (mount.dataset.n !== String(rows.length)) { mount.textContent = ''; mount.dataset.n = String(rows.length); }
    while (mount.childElementCount < rows.length) {
      const t = el('div', 'ticket');
      t.appendChild(el('b'));
      t.appendChild(el('span'));
      mount.appendChild(t);
    }
    rows.forEach((row, i) => {
      const t = mount.children[i];
      const name = g.clerkName(i) + ': ';
      if (t.children[0].textContent !== name) t.children[0].textContent = name;
      if (t.children[1].textContent !== row.name) t.children[1].textContent = row.name;
      t.classList.toggle('fired', !!row.wouldFire);
      t.classList.toggle('off', !row.enabled || row.quarantined);
    });
  }

  logList() {
    const g = this.game, list = $('log');
    const lines = g.log.slice(-14).reverse();
    if (list.childElementCount !== lines.length) {
      list.textContent = '';
      for (let i = 0; i < lines.length; i++) list.appendChild(el('li'));
    }
    lines.forEach((l, i) => { const li = list.children[i]; if (li.textContent !== l.text) li.textContent = l.text; });
  }

  // --- input ---------------------------------------------------------------

  bind() {
    const g = this.game;
    for (const b of document.querySelectorAll('[data-step]')) {
      const [what, delta] = b.getAttribute('data-step').split(':');
      b.addEventListener('click', () => this.step(what, Number(delta)));
    }
    $('wipe').addEventListener('click', () => this.wipe());
    $('dump').addEventListener('click', () => this.dump());
    $('stopq').addEventListener('click', () => this.toggleBoard());
    $('corner-call').addEventListener('click', () => { const p = g.activePit(); if (p) { g.callCorner(p.key); this.save.write('corner'); this.rebuildComposer(); this.refresh(); } });
    $('city-go').addEventListener('click', () => { if (g.leaveCity()) { this.save.write('city'); this.rebuildComposer(); this.refresh(); } });

    $('intro-go').addEventListener('click', () => this.sheet('intro', false));
    $('away-go').addEventListener('click', () => this.sheet('away', false));
    $('keys-close').addEventListener('click', () => this.sheet('keys', false));
    $('do-keys').addEventListener('click', () => this.showKeys());
    $('foldbtn').addEventListener('click', () => this.fold());
    $('composer-toggle').addEventListener('click', () => {
      this.composerOpen = !this.composerOpen;
      $('composer').hidden = !this.composerOpen;
      if (this.composerOpen) this.rebuildComposer();
      this.refresh();
    });

    $('do-export').addEventListener('click', () => {
      $('savebox').value = this.save.exportString();
      $('savebox').select();
      $('save-note').textContent = this.content.labels.copied;
    });
    $('do-import').addEventListener('click', () => {
      const r = this.save.importString($('savebox').value.trim());
      if (!r.ok) { $('save-note').textContent = fill(this.content.labels.importBad, { why: r.reason }); return; }
      location.reload();
    });
    $('do-reset').addEventListener('click', () => {
      if (!confirm(this.content.labels.resetConfirm)) return;
      this.save.reset();
      location.reload();
    });

    addEventListener('keydown', (e) => this.key(e));
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.game.lastSeen = Date.now(); });
  }

  step(what, delta) {
    const p = this.game.activePit();
    if (!p) return;
    if (what === 'size') p.setSize(clamp(p.size + delta, 1, this.game.quoteSize()));
    else if (what === 'cut') { p.setSpread(p.spread + delta); p.recentre(); p.place(); }
    this.refresh();
  }

  wipe() {
    const p = this.game.activePit();
    if (!p) return;
    if (!p.bidOn && !p.askOn) p.push();
    p.recentre();
    p.place();
    this.game.note(fill(this.content.events.wiped, { bid: p.bid, ask: p.ask }));
    this.refresh();
  }

  dump() {
    const p = this.game.activePit();
    if (!p) return;
    const r = p.flatten();
    this.game.note(r.qty
      ? fill(this.content.events.dumped, { qty: r.qty, price: r.price })
      : this.content.events.dumpedNothing);
    this.refresh();
  }

  toggleBoard() {
    const p = this.game.activePit();
    if (!p) return;
    if (p.bidOn || p.askOn) { p.pull(); this.game.note(this.content.events.stopped); }
    else { p.push(); p.recentre(); p.place(); this.game.note(this.content.events.started); }
    this.refresh();
  }

  key(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const g = this.game, k = e.key;
    if (k === ' ' || k === 'r' || k === 'R') this.wipe();
    else if (k === 's' || k === 'S' || k === 'f' || k === 'F') this.dump();
    else if (k === 'x' || k === 'X' || k === 'q' || k === 'Q') this.toggleBoard();
    else if (k >= '1' && k <= '6') { const key = g.order[Number(k) - 1]; if (key) { g.active = key; this.rebuildComposer(); this.refresh(); } }
    else if (k === '[') this.step('cut', -1);
    else if (k === ']') this.step('cut', 1);
    else if (k === '-') this.step('size', -1);
    else if (k === '=' || k === '+') this.step('size', 1);
    else if (k === 'p' || k === 'P') this.fold();
    else if (k === '?') this.showKeys();
    else if (k === 'Escape') { this.sheet('keys', false); this.sheet('away', false); return; }
    else return;
    e.preventDefault();
  }

  fold() {
    this.folded = !this.folded;
    $('panel').classList.toggle('folded', this.folded);
    $('foldbtn').textContent = this.folded ? this.content.labels.unfold : this.content.labels.fold;
    document.documentElement.style.setProperty('--panelW', this.folded ? '0px' : '340px');
    this.resize();
  }

  sheet(id, on) { $(id).hidden = !on; }

  showKeys() {
    const list = $('keys-list');
    if (!list.childElementCount) {
      for (const [k, what] of this.content.keys) {
        list.appendChild(el('dt', null, k));
        list.appendChild(el('dd', null, what));
      }
    }
    this.sheet('keys', true);
  }

  // The summary names the time away and the time counted separately, because
  // they are different quantities whenever the cap bit.
  showAway() {
    const r = this.game.resume(Date.now());
    if (!r.ticksDue) return;
    const c = this.content.labels;
    $('away-title').textContent = fill(c.away, { away: r.away, counted: r.counted });
    $('away-body').textContent = cmp(r.gained, 0) > 0
      ? fill(c.awayRan, { funds: coins(r.gained) })
      : c.awayNothing;
    this.sheet('away', true);
    this.save.write('resume');
  }
}

export { UI };
export default boot;
