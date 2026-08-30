// ---------------------------------------------------------------------------
// The interface: the boxes on the slate, the panel at the side, and the loop
// that drives both.
//
// Everything the player can touch is a real focusable element, because the
// board itself is a picture and a picture cannot be tabbed to. The canvas
// draws; this file reads the same state and writes it into the DOM.
//
// One requestAnimationFrame loop owns the whole frame: it advances the pits by
// a fixed number of ticks, renders the board, and writes the panel at a slower
// cadence than it draws, because text that changes sixty times a second cannot
// be read and costs more than the picture does.
//
// PROGRESSIVE REVEAL is done by hiding sections, not by building them late, so
// the layout never jumps as the game opens up: a section that appears takes
// the space it was always going to take.
// ---------------------------------------------------------------------------

import { CONFIG, withOverrides, applyIdentity } from '../config.js?v=2';
import { CONTENT, fill } from '../content.js?v=2';
import { Game } from './game.js?v=2';
import { Board } from './board.js?v=2';
import { format, duration, counter } from './format.js?v=2';
import { toNumber, cmp, big } from './bignum.js?v=2';
import { createSave } from './save.js?v=2';
import { affordability } from './purchase.js?v=2';
import { createComposer } from './rules-ui.js?v=2';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (v) => format(v, { decimals: 2 });

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
  const fundsCounter = counter({ rate: 9 });
  fundsCounter.snap(toNumber(game.funds));

  const ui = new UI(cfg, content, game, board, save, fundsCounter);
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
  // A longer sentence about what a control does. It is a title, not the only
  // place the information lives: nothing here is hover-only.
  for (const node of document.querySelectorAll('[data-title]')) {
    const s = at(node.getAttribute('data-title'));
    if (typeof s === 'string') node.title = s;
  }
}

class UI {
  constructor(cfg, content, game, board, save, fundsCounter) {
    this.cfg = cfg;
    this.content = content;
    this.game = game;
    this.board = board;
    this.save = save;
    this.fundsCounter = fundsCounter;
    this.acc = 0;
    this.last = 0;
    this.panelAt = 0;
    this.tickVolume = 0;
    this.rows = new Map();
    this.spendRows = new Map();
    this.pitRows = new Map();
    this.composer = null;
    this.composerFor = null;
    this.composerTier = 0;
    this.afford = affordability();
    this.folded = false;
    this.editing = null;
    this.frames = 0;
  }

  start(fresh) {
    this.buildLadder();
    this.buildCity();
    this.bind();
    this.resize();
    addEventListener('resize', () => this.resize());
    if (fresh) this.sheet('intro', true);
    else this.showAway();
    this.save.start();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- layout --------------------------------------------------------------

  resize() {
    const c = $('c');
    const r = c.getBoundingClientRect();
    const narrow = innerWidth <= 820;
    this.board.setInset(narrow ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panelW')) || 0);
    this.board.resize(Math.round(r.width), Math.round(r.height), devicePixelRatio || 1);
    // On a wide window the quote is written on the slate and the tickets hang
    // from the rail, both placed against what the canvas drew. On a narrow one
    // the stylesheet takes them out of the picture entirely, so the inline
    // placement has to come off with them.
    const q = $('quote'), rail = $('rail');
    q.style.bottom = narrow ? '' : Math.round(r.height - this.board.railTop + 14) + 'px';
    rail.style.top = narrow ? '' : Math.round(this.board.railTop - 10) + 'px';
    $('hint').textContent = this.content.labels.hint;
    $('hint').style.bottom = Math.round(r.height - this.board.floorBottom + 6) + 'px';
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
    while (this.acc >= 1 && ran < cap) { g.tick(); this.acc -= 1; ran++; }
    if (this.acc > cap) this.acc = 0;

    const p = g.activePit();
    if (p) {
      let vol = 0;
      for (const f of p.m.fills) vol += f.qty;
      this.tickVolume = ran > 0 ? vol : this.tickVolume * 0.9;
    }

    this.fundsCounter.set(toNumber(g.funds));
    this.fundsCounter.update(dt);
    this.board.render(this.view(), dt);

    if (now - this.panelAt > 130) { this.panelAt = now; this.refresh(); }
    requestAnimationFrame((t) => this.frame(t));
  }

  view() {
    const g = this.game, p = g.activePit(), c = this.content;
    if (!p) return { funds: fmt(this.fundsCounter.value), take: '0', pitName: '', price: '0', why: '', position: '0', crowdText: '', crowd: 0, volume: 0, expected: 1, history: [], depth: null, spreadText: '', tape: [] };
    const drawn = Math.min(p.crowd, this.cfg.view.marksMax);
    return {
      // The figure on the wall is whole coins. A till that reads 810.07 is a
      // spreadsheet, not a board somebody wrote on.
      funds: fmt(Math.round(this.fundsCounter.value)),
      // What this pit has paid the till, counting the cash still standing
      // behind its quote as the money it is - otherwise a pit that has just
      // written a bid reads as having cost you what it escrowed.
      take: fmt(Math.round(p.swept + p.m.player.escrow)),
      pitName: p.name,
      price: String(Math.round(p.mid)),
      why: this.whyLine(p),
      shock: p.shockText || '',
      position: String(p.position),
      crowdText: drawn < p.crowd ? `${p.crowd} on the floor, ${drawn} drawn` : `${p.crowd} on the floor`,
      crowd: p.crowd,
      volume: this.tickVolume,
      expected: Math.max(2, p.crowd * 0.22),
      history: p.history,
      depth: p.depth(6),
      spreadText: `${p.bid} / ${p.ask}`,
      tape: p.tape(26),
    };
  }

  // The sentence under the price. The CATEGORY comes from what the tick did;
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

  // --- the panel -----------------------------------------------------------

  refresh() {
    const g = this.game, c = this.content, p = g.activePit();
    this.pitTabs();
    if (p && this.editing !== 'bid') $('bid').value = p.bid;
    if (p && this.editing !== 'ask') $('ask').value = p.ask;
    if (p && this.editing !== 'size') $('size').value = p.size;
    if (p && this.editing !== 'spread') $('spread').value = p.spread;
    $('spreadbox').hidden = !g.shown('spread');
    $('flatten').disabled = !p || p.position <= 0;
    $('pullq').textContent = p && !p.bidOn && !p.askOn ? c.labels.push : c.labels.pull;

    this.section('ladder', g.shown('ladder'));
    this.section('clerks', g.shown('clerks'));
    this.section('seat', g.shown('seat'));
    this.section('runners', g.shown('runners'));
    this.section('pits', g.shown('pits'));
    this.section('corner', g.shown('corner'));
    this.section('city', g.shown('city'));

    for (const row of this.rows.values()) row.update();
    this.pitOffers();
    this.clerks();
    this.seat();
    this.runners();
    this.corner();
    this.city();
    this.tickets();
    this.logList();
    this.lit();
  }

  section(id, on) { const s = $('sec-' + id); if (s) s.hidden = !on; }

  // Becoming affordable is an event, so a button brightens once rather than
  // every frame for as long as the player is rich.
  lit() {
    const prices = {};
    for (const [id, row] of this.rows) prices[id] = row.priceOfOne();
    for (const ch of this.afford.update(this.game.funds, prices)) {
      const row = this.rows.get(ch.id);
      if (row) row.flash(ch.affordable);
    }
  }

  pitTabs() {
    const g = this.game, mount = $('pittabs');
    const keys = g.order;
    if (mount.dataset.keys !== keys.join(',')) {
      mount.textContent = '';
      keys.forEach((k, i) => {
        const b = el('button', 'tab', `${i + 1} ${g.pit(k).name}`);
        b.type = 'button';
        b.addEventListener('click', () => { g.active = k; this.rebuildComposer(); this.refresh(); });
        mount.appendChild(b);
      });
      mount.dataset.keys = keys.join(',');
    }
    [...mount.children].forEach((b, i) => b.classList.toggle('on', keys[i] === g.active));
  }

  // --- purchase rows -------------------------------------------------------

  buildLadder() {
    for (const id of ['size', 'clerk', 'seat', 'runner']) {
      this.rows.set(id, this.buyRow($('ladder-' + id), id));
    }
  }

  buyRow(mount, id) {
    const g = this.game, spec = this.cfg.ladder[id];
    const what = el('div', 'row');
    const label = el('span', 'what grow');
    what.appendChild(label);
    const owned = el('span', 'note');
    what.appendChild(owned);
    const buttons = el('div', 'row');
    const btns = this.cfg.bulk.map((k) => {
      const b = el('button', 'buy');
      b.type = 'button';
      b.addEventListener('click', () => {
        const r = g.buy(id, k);
        if (r.ok) { this.rebuildComposer(); this.save.write('buy'); }
        this.refresh();
      });
      buttons.appendChild(b);
      return { k, b };
    });
    mount.appendChild(what);
    mount.appendChild(buttons);

    const priceOfOne = () => {
      const q = g.quoteFor(id, 1);
      return q.asked === 0 ? Infinity : q.total;
    };
    return {
      priceOfOne,
      flash(on) { for (const { b } of btns) b.classList.toggle('lit', on); },
      update() {
        const l = spec;
        label.textContent = l.label;
        owned.textContent = fill(CONTENT.labels.owned, { n: g.bought[id] });
        for (const { k, b } of btns) {
          const q = g.quoteFor(id, k);
          // The button says what the click will ACTUALLY do. A bulk button
          // that quietly does nothing because only some are affordable is the
          // oldest silent failure in this genre: it offers what it can buy,
          // and when it can buy none it says how far off the money is.
          b.disabled = q.count <= 0;
          if (q.count > 0) b.textContent = `x${q.count} for ${fmt(q.total)}`;
          else {
            // Buy max with nothing affordable asks for nothing, so it has no
            // shortfall of its own to report. What the player wants to know is
            // how far off the next one is.
            const one = k === 'max' ? g.quoteFor(id, 1) : q;
            b.textContent = `x${k === 'max' ? 1 : k} needs ${fmt(one.shortfall || one.price)}`;
          }
        }
      },
    };
  }

  pitOffers() {
    const g = this.game, mount = $('pit-offers');
    const locked = this.cfg.pitOrder.filter((k) => !g.pits.has(k));
    if (mount.dataset.keys !== locked.join(',')) {
      mount.textContent = '';
      this.pitRows.clear();
      for (const k of locked) {
        const row = el('div', 'row');
        const b = el('button', 'buy grow');
        b.type = 'button';
        b.title = this.content.pits[k] || '';
        const note = el('span', 'note');
        b.addEventListener('click', () => { if (g.openPit(k)) { this.rebuildComposer(); this.save.write('pit'); } this.refresh(); });
        row.appendChild(b);
        mount.appendChild(row);
        mount.appendChild(note);
        this.pitRows.set(k, { b, note });
      }
      mount.dataset.keys = locked.join(',');
    }
    for (const [k, r] of this.pitRows) {
      const cost = g.pitCost(k);
      r.b.textContent = fill(CONTENT.labels.openPit, { pit: this.cfg.pits[k].name }) + '  ' + fmt(cost);
      r.b.disabled = !g.canOpen(k);
      r.note.textContent = this.content.pits[k] || '';
    }
  }

  clerks() {
    const g = this.game;
    $('clerk-count').textContent = fill(this.content.labels.clerkSlots, { used: g.cardCount(), n: g.clerkSlots() });
    if (g.bought.clerk > 0) this.rebuildComposer();
  }

  rebuildComposer() {
    const g = this.game;
    if (g.bought.clerk <= 0) return;
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

  seat() {
    const g = this.game, p = g.activePit();
    $('seat-now').textContent = fill(this.content.labels.seatNow, { bps: g.seatBps() });
    $('seat-paid').textContent = p ? fill(this.content.labels.seatTaken, { n: fmt(p.seatPaid) }) : '';
  }

  runners() {
    const g = this.game;
    $('runner-now').textContent = g.bought.runner > 0
      ? fill(this.content.labels.runnerLead, { n: g.runnerLead() })
      : this.content.labels.runnerNone;
  }

  corner() {
    const g = this.game, p = g.activePit();
    if (!p) return;
    const q = g.cornerQuote(p.key);
    $('corner-bar').style.width = Math.round(Math.min(1, q.share / q.need) * 100) + '%';
    $('corner-need').textContent = fill(this.content.labels.cornerNeed, {
      pct: Math.round(q.need * 100) + '%', have: Math.round(q.share * 100) + '%',
    });
    $('corner-pays').textContent = fill(this.content.labels.cornerPays, { funds: fmt(q.funds), rep: q.rep });
    $('corner-call').disabled = !q.ready;
  }

  buildCity() {
    const mount = $('city-spend');
    for (const [id, spec] of Object.entries(this.cfg.city.spend)) {
      const row = el('div', 'row');
      const b = el('button', 'buy grow');
      b.type = 'button';
      b.addEventListener('click', () => { this.game.spendReputation(id, 1); this.refresh(); });
      row.appendChild(b);
      mount.appendChild(row);
      this.spendRows.set(id, { b, spec });
    }
  }

  city() {
    const g = this.game;
    $('city-rep').textContent = fill(this.content.labels.cityRep, { n: g.reputation });
    for (const [id, r] of this.spendRows) {
      const q = g.spendQuote(id, 1);
      r.b.textContent = `${r.spec.label}  ${q.price} ${this.content.labels.reputation}  (${fill(this.content.labels.cityHave, { n: g.spent[id] })})`;
      r.b.disabled = q.count <= 0;
    }
    const go = $('city-go');
    go.textContent = g.canLeave()
      ? fill(this.content.labels.cityGo, { city: g.nextCityName() })
      : this.content.labels.cityNeed;
    go.disabled = !g.canLeave();
  }

  // Clerk tickets hang from the rail. A ticket that fired this tick is marked
  // in red, which is the visual twin of the thing having happened.
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
      t.children[0].textContent = row.name;
      t.children[1].textContent = row.reason;
      t.classList.toggle('fired', !!row.wouldFire);
      t.classList.toggle('off', !row.enabled || row.quarantined);
    });
  }

  logList() {
    const g = this.game, list = $('log');
    const lines = g.log.slice(-16).reverse();
    if (list.childElementCount !== lines.length) {
      list.textContent = '';
      for (let i = 0; i < lines.length; i++) list.appendChild(el('li'));
    }
    lines.forEach((l, i) => { const li = list.children[i]; if (li.textContent !== l.text) li.textContent = l.text; });
  }

  // --- input ---------------------------------------------------------------

  bind() {
    const g = this.game;
    const num = (id, apply) => {
      const input = $(id);
      input.addEventListener('focus', () => { this.editing = id; });
      input.addEventListener('blur', () => { this.editing = null; });
      input.addEventListener('input', () => { const v = Number(input.value); if (Number.isFinite(v)) apply(v); });
    };
    num('bid', (v) => { const p = g.activePit(); if (p) p.setBid(v); });
    num('ask', (v) => { const p = g.activePit(); if (p) p.setAsk(v); });
    num('size', (v) => { const p = g.activePit(); if (p) p.setSize(Math.min(v, g.quoteSize())); });
    num('spread', (v) => { const p = g.activePit(); if (p) p.setSpread(v); });

    for (const b of document.querySelectorAll('[data-step]')) {
      const [what, delta] = b.getAttribute('data-step').split(':');
      b.addEventListener('click', () => this.step(what, Number(delta)));
    }
    $('requote').addEventListener('click', () => this.requote());
    $('flatten').addEventListener('click', () => this.flatten());
    $('pullq').addEventListener('click', () => this.toggleQuote());
    $('corner-call').addEventListener('click', () => { const p = g.activePit(); if (p) { g.callCorner(p.key); this.save.write('corner'); this.rebuildComposer(); this.refresh(); } });
    $('city-go').addEventListener('click', () => { if (g.leaveCity()) { this.save.write('city'); this.rebuildComposer(); this.refresh(); } });

    $('intro-go').addEventListener('click', () => this.sheet('intro', false));
    $('away-go').addEventListener('click', () => this.sheet('away', false));
    $('keys-close').addEventListener('click', () => this.sheet('keys', false));
    $('do-keys').addEventListener('click', () => this.showKeys());
    $('foldbtn').addEventListener('click', () => this.fold());

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
    if (what === 'bid') p.setBid(p.bid + delta);
    else if (what === 'ask') p.setAsk(p.ask + delta);
    else if (what === 'size') p.setSize(Math.min(p.size + delta, this.game.quoteSize()));
    else if (what === 'spread') { p.setSpread(p.spread + delta); p.recentre(); }
    this.refresh();
  }

  requote() {
    const p = this.game.activePit();
    if (!p) return;
    p.recentre();
    p.place();
    this.game.note(fill(this.content.events.requote, { bid: p.bid, ask: p.ask }));
    this.refresh();
  }

  flatten() {
    const p = this.game.activePit();
    if (!p) return;
    const r = p.flatten();
    this.game.note(r.qty
      ? fill(this.content.events.flattened, { qty: r.qty, price: r.price })
      : this.content.events.flattenNothing);
    this.refresh();
  }

  toggleQuote() {
    const p = this.game.activePit();
    if (!p) return;
    if (p.bidOn || p.askOn) { p.pull(); this.game.note(this.content.events.pulled); }
    else { p.push(); p.recentre(); p.place(); }
    this.refresh();
  }

  key(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const g = this.game, k = e.key;
    if (k === 'r' || k === 'R') this.requote();
    else if (k === 'f' || k === 'F') this.flatten();
    else if (k === 'q' || k === 'Q') this.toggleQuote();
    else if (k >= '1' && k <= '6') { const key = g.order[Number(k) - 1]; if (key) { g.active = key; this.rebuildComposer(); this.refresh(); } }
    else if (k === '[') this.step('spread', -1);
    else if (k === ']') this.step('spread', 1);
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
    document.documentElement.style.setProperty('--panelW', this.folded ? '0px' : '334px');
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
      ? fill(c.awayRan, { ticks: r.ticksRun, funds: fmt(r.gained) })
      : c.awayNothing;
    this.sheet('away', true);
    this.save.write('resume');
  }
}

export { UI };
export default boot;
