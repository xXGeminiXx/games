// ---------------------------------------------------------------------------
// The page: what the state looks like as words and figures.
//
// The window is the forest floor and the page is a field journal kept beside
// it: a specimen label pinned to the floor carrying the figures, and a paper
// column of entries, ledgers and labels down the side. Everything here reads
// the simulation and writes the document. Nothing here changes the state:
// every button calls into `actions`, which the composition root wires to the
// simulation. Panels are hidden until their reveal flag is set, so the
// journal grows as the organism does.
// ---------------------------------------------------------------------------

import * as Lore from './lore.js?v=14';
import * as Advice from './advice.js?v=14';
import * as Tr from './traits.js?v=14';
import * as Sp from './spores.js?v=14';
import { fill } from '../config.js?v=14';
import { fmt, fmtCoin, fmtCount, fmtRate, fmtTime, fmtArea, fmtPct } from './numbers.js?v=14';
import { LARGEST_ORGANISM_M2 } from './levels.js?v=14';

const LOG_KEEP = 40;
const SEASONS = 4;

export function createUI(doc, sim, cfg, actions) {
  const T = cfg.text;
  const el = (id) => doc.getElementById(id);
  const show = (id, on) => { const e = el(id); if (e) e.hidden = !on; };
  const text = (id, v) => { const e = el(id); if (e && e.textContent !== String(v)) e.textContent = String(v); };
  const state = sim.state;

  // -- a paper label with a price on it ---------------------------------------

  const priced = (button, label, price, can) => {
    if (!button) return;
    const want = label + '' + (price === null || price === undefined ? '' : price);
    if (button._want !== want) {
      button._want = want;
      button.textContent = '';
      const b = doc.createElement('b');
      b.textContent = label;
      button.appendChild(b);
      if (price !== null && price !== undefined && price !== '') {
        const i = doc.createElement('i');
        i.textContent = price;
        button.appendChild(i);
      }
    }
    button.disabled = !can;
  };

  const bind = (id, fn) => { const e = el(id); if (e) e.addEventListener('click', fn); return e; };

  bind('reach', () => actions.reach());
  bind('buy-tip', () => actions.buyTips(1));
  bind('buy-tips-max', () => actions.buyTipsMax());
  bind('aim-clear', () => actions.clearAim());
  bind('extend', () => actions.extend());
  bind('beyond', () => actions.beyond());

  // -- the entries -------------------------------------------------------------

  // Every entry is written with the year and season in front of it, and the
  // same template gives the pattern that finds that mark again when the entry
  // is drawn, so the two can never fall out of step. An entry written before
  // there were marks simply has none.
  const markPattern = new RegExp('^' + T.entryMark
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{n\\}', '\\d+')
    .replace('\\{season\\}', '[a-z]+'), 'i');

  const markNow = () => {
    const s = sim.season();
    return fill(T.entryMark, { n: s.year + 1, season: T.seasons[s.index] });
  };

  const renderLog = () => {
    const box = el('log');
    if (!box) return;
    box.textContent = '';
    // The array is kept newest first, because that is what a save holds; the
    // page reads the other way, the way a notebook is written.
    for (let i = Math.min(state.log.length, LOG_KEEP) - 1; i >= 0; i--) {
      const line = state.log[i];
      const p = doc.createElement('p');
      const m = markPattern.exec(line);
      if (m) {
        const mark = doc.createElement('em');
        mark.className = 'mark';
        mark.textContent = m[0].trim();
        p.appendChild(mark);
        p.appendChild(doc.createTextNode(line.slice(m[0].length)));
      } else {
        p.textContent = line;
      }
      box.appendChild(p);
    }
    // The newest entry is at the foot of the page, so that is where it opens.
    if (typeof box.scrollHeight === 'number') box.scrollTop = box.scrollHeight;
  };

  const log = (line) => {
    if (!line) return;
    state.log.unshift(markNow() + line);
    if (state.log.length > LOG_KEEP) state.log.length = LOG_KEEP;
    renderLog();
  };

  const say = (event) => {
    if (!event || !event.key) return;
    log(Lore.line(state.seed, event.key, event.values, event.salt));
  };

  // -- what happened while nobody was here --------------------------------------
  //
  // An idle game's first job on being opened is to say what it did while it was
  // alone. That used to be one entry among the others; with the entries at the
  // foot of the page it would have been off the bottom of the screen, which is
  // no way to report the thing a player came back for. It stands above
  // everything until anything is pressed.

  const awayNote = (line) => {
    const e = el('away');
    if (!e) return;
    e.textContent = line || '';
    e.hidden = !line;
  };
  const clearAway = () => awayNote('');

  // -- the specimen label ------------------------------------------------------

  // One figure on a chain line: the word for it, then the rate. A part with
  // nothing in it leaves the line rather than standing at zero.
  const chainPart = (id, word, value, on) => {
    const e = el(id);
    if (!e) return;
    e.hidden = !on;
    if (!on) return;
    if (e._word !== word) {
      e._word = word;
      e.textContent = '';
      const i = doc.createElement('i');
      i.textContent = word;
      const b = doc.createElement('b');
      e.appendChild(i);
      e.appendChild(b);
      e._value = b;
    }
    const shown = fmtRate(value);
    if (e._value.textContent !== shown) e._value.textContent = shown;
  };

  const renderLabel = (f, rate, info) => {
    text('sugar', fmt(state.sugar));
    show('st-income', !!f.tips);
    text('income', (rate.sugar < 0 ? '' : T.gain) + fmtCoin(rate.sugar));
    show('st-tips', !!f.tips);
    text('tips', fmtCount(state.tipCount));

    // The chain. Where the sugar came from this second, and what happened to
    // the minerals between the ground and the trees. Both lines arrive with
    // the trees, because until then there is only one source and nothing is
    // being carried anywhere.
    show('st-source', !!f.trees);
    show('st-minerals', !!f.trees);
    if (f.trees) {
      const income = sim.income();
      chainPart('src-wood', T.stats.wood, income.wood, true);
      chainPart('src-trade', T.stats.trade, income.trade + income.fell, true);
      chainPart('src-below', T.stats.below, income.below, income.below > 0);
      const c = sim.carry();
      const lost = Math.max(0, c.produced - c.carried);
      chainPart('minerals', T.stats.dug, c.produced, true);
      chainPart('min-carried', T.stats.carried, rate.minerals, true);
      chainPart('min-lost', T.stats.lost, lost, lost > c.produced * 0.005);
    }

    show('st-level', !!f.reach);
    const last = state.ring >= cfg.world.rings;
    text('level', fill(last ? T.whereClosed : T.where,
      { level: info.name, ring: state.ring, rings: cfg.world.rings }));
    show('st-area', !!f.reach);
    const A = sim.area();
    text('area', fmtArea(A));
    const areaEl = el('st-area');
    if (areaEl) areaEl.title = A >= LARGEST_ORGANISM_M2 ? Lore.ui('largestNote') : '';
  };

  // -- the trees ledger --------------------------------------------------------

  // The figures on one kind, in the order they are read. Each one carries its
  // own word, so nothing depends on a heading further up the page and nothing
  // sits in a column that a narrow window could cut off.
  const FIGURES = ['rate', 'got', 'sent', 'size'];

  // What the player set, read from the state rather than from the market,
  // which is only rebuilt when the simulation steps: a press has to show on
  // the ledger at once, and two presses in the same tenth of a second have to
  // count from what the first one left behind.
  const weightOf = (key) => (state.weights[key] === undefined ? cfg.trees.weightNew : state.weights[key]);
  const policyOf = (key) => state.harvest[key] || 0;

  const treeRows = new Map();

  const treeRow = (row) => {
    let r = treeRows.get(row.key);
    if (r) return r;
    // One block a kind: the name and the count, the figures, the two standing
    // decisions, and the note underneath.
    const box = doc.createElement('div');
    box.className = 'tree';
    const head = doc.createElement('div');
    head.className = 'thead';
    const name = doc.createElement('b');
    name.className = 'name';
    const note = doc.createElement('small');
    note.className = 'count';
    const best = doc.createElement('small');
    best.className = 'best';
    best.textContent = T.columns.best;
    best.hidden = true;
    head.appendChild(name);
    head.appendChild(note);
    head.appendChild(best);
    box.appendChild(head);

    const figs = doc.createElement('div');
    figs.className = 'figs';
    const cells = {};
    for (const key of FIGURES) {
      const fig = doc.createElement('span');
      fig.className = 'fig ' + key;
      const word = doc.createElement('i');
      word.textContent = T.columns[key];
      const value = doc.createElement('b');
      if (key === 'rate') fig.title = T.columns.rateTip;
      fig.appendChild(word);
      fig.appendChild(value);
      figs.appendChild(fig);
      cells[key] = { fig, value };
    }
    box.appendChild(figs);

    const ctl = doc.createElement('div');
    ctl.className = 'ctl';
    // Share: one tick per point of weight. Clicking a tick sets the weight to
    // it, and clicking the last filled tick lets the weight back down, so
    // every value from none to all is one press away.
    const share = doc.createElement('span');
    share.className = 'share';
    const shareWord = doc.createElement('i');
    shareWord.textContent = T.columns.weight;
    share.appendChild(shareWord);
    const ticks = [];
    for (let i = 1; i <= cfg.trees.weightMax; i++) {
      const tick = doc.createElement('button');
      tick.className = 'tick';
      tick.title = T.weightTip;
      tick.addEventListener('click', () => {
        const cur = weightOf(row.key);
        actions.setWeight(row.key, (i === cur ? i - 1 : i) - cur);
      });
      share.appendChild(tick);
      ticks.push(tick);
    }
    ctl.appendChild(share);
    // Policy: what to do with the trees, and whether to feed them.
    const pols = doc.createElement('span');
    pols.className = 'pols';
    const pol = doc.createElement('button');
    pol.className = 'pol';
    pol.title = T.harvestTip;
    pol.addEventListener('click', () => actions.setHarvest(row.key, (policyOf(row.key) + 1) % 3));
    const feed = doc.createElement('button');
    feed.className = 'feed';
    feed.title = T.nurtureTip;
    feed.addEventListener('click', () => actions.toggleNurture(row.key));
    pols.appendChild(pol);
    pols.appendChild(feed);
    ctl.appendChild(pols);
    box.appendChild(ctl);

    // The note: a line in the hand of someone who has watched this kind for
    // years - the season it pays best in, what one grown tree is worth felled
    // against kept, and what feeding buys.
    const noteLine = doc.createElement('p');
    noteLine.className = 'note';
    const mark = doc.createElement('em');
    mark.className = 'mark';
    const figures = doc.createElement('span');
    noteLine.appendChild(mark);
    noteLine.appendChild(figures);
    box.appendChild(noteLine);

    r = { box, cells, name, note, best, ticks, pol, feed, row, mark, figures, figs, ctl };
    treeRows.set(row.key, r);
    el('trees').appendChild(box);
    return r;
  };

  // -- the note under a kind ---------------------------------------------------

  const seasonName = (i) => T.seasons[Math.max(0, Math.min(3, i | 0))];

  const noteFigures = (row, m) => {
    const bits = [];
    // What the next tick on this kind is worth, so a share is a decision with
    // a figure on it rather than a guess.
    if (row.count > 0 && row.weight < cfg.trees.weightMax && Math.abs(row.shareGain || 0) > 0.005) {
      bits.push(Lore.ui(row.shareGain > 0 ? 'shareGain' : 'shareCost', {
        gain: fmtCoin(Math.abs(row.shareGain)),
      }));
    }
    if (m.fell && row.felled > 0) {
      bits.push(row.keptBack > 0
        ? Lore.ui('treeFell', { felled: fmt(row.felled), time: fmtTime(row.keptBack) })
        : Lore.ui('treeFellIdle', { felled: fmt(row.felled) }));
    }
    if (m.nurture && row.count > 0) {
      bits.push(row.feed > 0
        ? Lore.ui('treeFeed', { time: fmtTime(row.feed) })
        : Lore.ui('treeFeedNever'));
    }
    return bits.join(' ');
  };

  const renderTrees = () => {
    if (!state.flags.trees) return;
    const market = sim.market();
    const m = sim.mods();
    const season = sim.season();
    const winter = season.index === 3;
    let any = false;
    // Which kind pays most for the next mineral. It is the whole of the
    // decision the share ticks make, so it is marked rather than left to be
    // worked out across three blocks of figures.
    let bestKey = null;
    let trading = 0;
    for (const key in market) {
      const row = market[key];
      if (!(row.count > 0) || !(row.marginal > 0)) continue;
      trading++;
      if (!bestKey || row.marginal > market[bestKey].marginal) bestKey = key;
    }
    // With one kind standing there is no choice to mark.
    if (trading < 2) bestKey = null;
    for (const sp of sim.roster) {
      const row = market[sp.key];
      if (!row) continue;
      if (row.count === 0 && row.dead === 0) continue;
      any = true;
      const r = treeRow(row);
      r.row = row;
      r.box.hidden = false;
      r.name.textContent = Lore.capital(row.name);
      const bits = [];
      bits.push(row.count === 1 ? T.counts.one : fill(T.counts.many, { n: row.count }));
      if (row.mature > 0) bits.push(fill(T.counts.grown, { n: row.mature }));
      if (row.dead > 0) bits.push(fill(T.counts.dead, { n: row.dead }));
      r.note.textContent = bits.join(', ');
      r.best.hidden = bestKey !== row.key;
      // A kind with nothing standing has nothing to decide: the figures are
      // all zeros and the ticks and the policy do nothing until a seedling is
      // up. Its wood is still worth eating, so the block stays and says so.
      const standing = row.count > 0;
      r.figs.hidden = !standing;
      r.ctl.hidden = !standing;
      if (!standing) {
        r.mark.textContent = '';
        r.figures.textContent = Lore.ui('treeGone');
        continue;
      }
      const grown = row.size / (row.count * row.max);
      r.cells.size.value.textContent = fmtPct(grown);
      r.cells.sent.value.textContent = fmtRate(row.sent);
      r.cells.got.value.textContent = fmtRate(row.got);
      r.cells.rate.value.textContent = fmtCoin(row.marginal);
      // Winter is read off the ledger as well as the floor: the price the
      // trees will pay is dimmed for as long as they are shut down.
      r.cells.rate.fig.title = winter ? Lore.ui(m.evergreen ? 'evergreenWinter' : 'winter') : T.columns.rateTip;
      r.cells.rate.fig.className = 'fig rate' + (winter ? ' cold' : '');
      const weight = weightOf(row.key);
      for (let i = 0; i < r.ticks.length; i++) {
        r.ticks[i].className = 'tick' + (i < weight ? ' on' : '');
      }
      const policy = policyOf(row.key);
      r.pol.hidden = !m.fell;
      r.pol.textContent = T.harvest[policy] || T.harvest[0];
      r.pol.className = 'pol' + (policy ? ' on' : '');
      r.feed.hidden = !m.nurture;
      // A switch has to say which way it is thrown; the colour alone is not
      // a word, and it is the only mark on the page that is not read.
      r.feed.textContent = state.nurture[row.key] ? T.nurtureOn : T.nurture;
      r.feed.className = 'feed' + (state.nurture[row.key] ? ' on' : '');
      // The note: the mark first, then the figures behind it.
      r.mark.textContent = Lore.ui('treeBest', { season: seasonName(row.best) });
      r.figures.textContent = noteFigures(row, m);
    }
    for (const [key, r] of treeRows) {
      if (!market[key] || (market[key].count === 0 && market[key].dead === 0)) r.box.hidden = true;
    }
    text('treesnote', any ? Lore.ui('sharesNote') : Lore.ui('noTrees'));
  };

  // -- the traits -------------------------------------------------------------

  const traitRows = new Map();
  const traitRow = (id) => {
    let r = traitRows.get(id);
    if (r) return r;
    const box = doc.createElement('div');
    box.className = 'rrow';
    const b = doc.createElement('button');
    b.className = 'rite';
    b.addEventListener('click', () => actions.buyTrait(id));
    const line = doc.createElement('span');
    line.className = 'line';
    line.textContent = Lore.trait(id).line;
    const lv = doc.createElement('span');
    lv.className = 'lv';
    box.appendChild(b);
    box.appendChild(lv);
    box.appendChild(line);
    el('traits').appendChild(box);
    r = { box, b, lv };
    traitRows.set(id, r);
    return r;
  };

  const renderTraits = () => {
    if (!state.flags.traits) return;
    const m = sim.mods();
    // What can still be bought comes first, cheapest first; what is finished
    // sits at the foot. A list of thirteen rows where four are actionable is a
    // list nobody reads, and the four used to be scattered through it.
    const list = Tr.offered(cfg, state, m);
    const rank = list.slice().sort((a, b) => {
      const ca = a.cost === null, cb = b.cost === null;
      if (ca !== cb) return ca ? 1 : -1;
      if (ca) return 0;
      return a.cost - b.cost;
    });
    const at = new Map(rank.map((t, i) => [t.id, i]));
    for (const t of list) {
      const seen = t.level > 0 || (t.cost !== null && state.totals.earned >= t.cost * 0.5);
      if (!seen && !traitRows.has(t.id)) continue;
      const r = traitRow(t.id);
      r.box.hidden = !seen;
      if (r.box.style) r.box.style.order = String(at.get(t.id));
      const capped = t.cost === null;
      priced(r.b, Lore.trait(t.id).name, capped ? T.bought : fmt(t.cost), !capped && state.sugar >= t.cost);
      // A trait that goes only one deep says so on its own label; saying it
      // again out at the margin is a word to read for nothing.
      r.lv.textContent = t.cap > 1 ? t.level + '/' + t.cap : '';
    }
  };

  // -- instinct -----------------------------------------------------------------
  //
  // What the organism has learned to do for itself. One row per habit: a paper
  // label that switches it, and under it, in faded ink, what it last did and
  // how long ago. Under the rows, the reserve: four labels for the share of
  // the sugar instinct is not allowed to touch.
  //
  // The first thing a habit ever does is worth one entry in the journal and
  // nothing after it, so the entry is written here, from the time the
  // simulation recorded, and marked in the same book of things said once. A
  // habit that acted while the tab was closed is written up when the notebook
  // is next opened, which is when it would have been noticed.

  const INSTINCTS = ['extend', 'tips', 'beyond'];
  const FIRST_LINE = { extend: 'instinctExtend', tips: 'instinctTips', beyond: 'instinctBeyond' };

  const instinctRows = new Map();
  const instinctRow = (key) => {
    let r = instinctRows.get(key);
    if (r) return r;
    const box = doc.createElement('div');
    box.className = 'rrow';
    const b = doc.createElement('button');
    b.className = 'rite';
    b.title = T.instinct.hints[key] || '';
    b.addEventListener('click', () => actions.setInstinct(key));
    const line = doc.createElement('span');
    line.className = 'line';
    box.appendChild(b);
    box.appendChild(line);
    el('instinct').appendChild(box);
    r = { box, b, line };
    instinctRows.set(key, r);
    return r;
  };

  let reserveLabels = null;
  const reserveRow = () => {
    if (reserveLabels) return reserveLabels;
    const host = el('instinct-reserve');
    if (!host) return null;
    const name = doc.createElement('span');
    name.textContent = T.instinct.reserve;
    host.appendChild(name);
    const buttons = cfg.instinct.reserves.map((share, i) => {
      const b = doc.createElement('button');
      b.textContent = T.instinct.reserves[i] === undefined ? String(share) : T.instinct.reserves[i];
      b.title = T.instinct.reserveTip;
      b.addEventListener('click', () => actions.setReserve(share));
      host.appendChild(b);
      return b;
    });
    reserveLabels = { name, buttons };
    return reserveLabels;
  };

  const renderInstinct = () => {
    if (!state.flags.instinct) return;
    const learned = sim.mods().instinct;
    const inst = sim.instinct();
    for (const key of INSTINCTS) {
      const r = instinctRow(key);
      r.box.hidden = !learned[key];
      if (!learned[key]) continue;
      const on = !!inst[key];
      priced(r.b, T.instinct.names[key], on ? T.instinct.on : T.instinct.off, true);
      r.b.className = 'rite' + (on ? ' on' : '');
      const at = inst.acted ? inst.acted[key] : undefined;
      r.line.textContent = at === undefined
        ? T.instinct.idle
        : fill(T.instinct.ago, { what: T.instinct.acted[key], t: fmtTime(Math.max(0, state.t - at)) });
      if (at !== undefined && !state.fired[FIRST_LINE[key]]) {
        state.fired[FIRST_LINE[key]] = true;
        log(Lore.ui(FIRST_LINE[key]));
      }
    }
    const res = reserveRow();
    if (res) {
      for (let i = 0; i < res.buttons.length; i++) {
        res.buttons[i].className = Math.abs(cfg.instinct.reserves[i] - inst.reserve) < 1e-9 ? 'on' : '';
      }
    }
  };

  // -- what the spore carries ---------------------------------------------------

  const perkRows = new Map();
  const perkRow = (id) => {
    let r = perkRows.get(id);
    if (r) return r;
    const box = doc.createElement('div');
    box.className = 'rrow';
    const b = doc.createElement('button');
    b.className = 'rite';
    b.addEventListener('click', () => actions.buyPerk(id));
    const line = doc.createElement('span');
    line.className = 'line';
    line.textContent = Lore.genome(id).line;
    const lv = doc.createElement('span');
    lv.className = 'lv';
    box.appendChild(b);
    box.appendChild(lv);
    box.appendChild(line);
    el('genome').appendChild(box);
    r = { box, b, lv };
    perkRows.set(id, r);
    return r;
  };

  const renderSpores = () => {
    if (!state.flags.spores) return;
    const g = sim.genome;
    const can = sim.canFruit();
    const n = sim.sporesNow();
    // Before it can fruit, the panel says what it is waiting for rather than
    // standing empty under its own heading.
    text('spores-note', can
      ? Lore.ui('sporesNote', { n })
      : Lore.ui('sporesNeeds', { level: Lore.levelInfo(cfg.spores.fromLevel).name }));
    text('spores-held', g.spores > 0 ? Lore.ui('sporesHeld', { n: g.spores }) : '');
    const fruit = el('fruit');
    if (fruit) { fruit.hidden = !can; fruit.disabled = !can; }
    // What the spores would buy, shown before the button that cannot be taken
    // back is pressed. Fruiting is the largest decision in the game and it
    // used to be a price with nothing to compare it against.
    const showGenome = can || g.fruitings > 0 || g.spores > 0;
    show('p-genome', showGenome);
    show('genome', showGenome);
    if (showGenome) {
      for (const p of Sp.offered(cfg, g)) {
        const r = perkRow(p.id);
        const capped = p.cost === null;
        priced(r.b, Lore.genome(p.id).name, capped ? T.bought : p.cost + (p.cost === 1 ? ' spore' : ' spores'), !capped && g.spores >= p.cost);
        r.lv.textContent = p.level + '/' + p.cap;
      }
    }
  };

  // -- everything ---------------------------------------------------------------

  const render = () => {
    const f = state.flags;
    const rate = state.rate;
    const info = Lore.levelInfo(state.level);

    renderLabel(f, rate, info);

    // The compass: the one thing most worth doing, and the figures for it.
    text('next', Advice.next(sim, cfg).text);

    // The hand. It leaves the page once the tips are out and working: two
    // sugar a press is nothing beside what the front brings in, and a control
    // that says it does nothing is a control to take away.
    show('hand-panel', !(f.handDone && state.reached.length >= 6));
    text('handline', f.handDone ? Lore.ui('handDone') : Lore.ui('handIdle'));
    const reach = el('reach');
    if (reach) reach.title = T.reachTip;

    // The tips.
    show('tips-panel', !!f.tips);
    if (f.tips) {
      const cost = sim.tipCost(1);
      priced(el('buy-tip'), T.buyTip, fmt(cost), state.sugar >= cost);
      const n = sim.tipsAffordable();
      priced(el('buy-tips-max'), T.buyTipMax, n >= 2 ? fmtCount(n) : '', n >= 2);
      const c = sim.carry();
      let line = Lore.ui('tipsLine', { n: fmtCount(state.tipCount), cost: fmt(cost) });
      if (f.trees) line += ' ' + Lore.ui(c.produced > c.capacity * 1.02 ? 'carryShort' : 'carryLine', { carried: fmtCoin(c.carried), produced: fmtCoin(c.produced) });
      text('tipline', line);

      // Where the front has been sent. The line says what a press on the floor
      // does before one is made, and what it did after.
      const aim = state.aim;
      text('aimline', Lore.ui(aim ? 'aimSet' : 'aimIdle'));
      const clear = el('aim-clear');
      if (clear) {
        clear.hidden = !aim;
        if (aim) priced(clear, T.aimClear, '', true);
        clear.title = T.aimClearTip;
      }
    }

    // The trees.
    show('trees-panel', !!f.trees);
    renderTrees();

    // The year: one ruled line, and where in it we are.
    show('season-panel', !!f.season);
    if (f.season) {
      const s = sim.season();
      text('season-name', T.seasons[s.index]);
      text('season-left', fill(T.seasonLeft, { left: fmtTime(s.left) }));
      const bar = el('season-bar');
      if (bar && bar.style) bar.style.left = (100 * (s.index + s.frac) / SEASONS).toFixed(2) + '%';
      const sp = el('season-panel');
      if (sp) sp.className = 'panel season-' + s.index;
    }

    // Reach.
    show('reach-panel', !!f.reach);
    if (f.reach) {
      const total = sim.world.total;
      const last = state.ring >= cfg.world.rings;
      const where = { ring: state.ring, rings: cfg.world.rings, level: last ? Lore.capital(info.name) : info.name,
        reached: fmtCount(state.reached.length), total: fmtCount(total) };
      text('reachline', Lore.ui(last ? 'reachClosed' : 'reachLine', where));
      // The bar: how much of this scale is threaded, and the mark where enough
      // of it is to fold the whole level into one place of the next.
      const fillBar = el('reach-fill');
      if (fillBar && fillBar.style) {
        fillBar.style.width = (100 * Math.min(1, state.reached.length / Math.max(1, total))).toFixed(2) + '%';
      }
      const markBar = el('reach-mark');
      if (markBar && markBar.style) {
        markBar.style.left = (100 * cfg.levels.beyondNeeds).toFixed(2) + '%';
      }
      const ext = el('extend');
      if (ext) {
        ext.hidden = last;
        if (!last) { const c = sim.ringCost(); priced(ext, T.extend, fmt(c), state.sugar >= c); }
      }
      const bey = el('beyond');
      if (bey) {
        bey.hidden = !last;
        if (last) {
          const c = sim.beyondCost();
          const offered = sim.beyondOffered();
          priced(bey, T.beyond, fmt(c), offered && state.sugar >= c);
          text('beyondline', offered
            ? Lore.ui('beyondLine', { level: info.name, next: Lore.levelInfo(state.level + 1).name })
            : Lore.ui('beyondNeeds', { pct: fmtPct(cfg.levels.beyondNeeds), level: info.name }));
        } else text('beyondline', '');
      }
      show('belowline', !!f.below);
      if (f.below) text('belowline', Lore.ui('belowLine', { sugar: fmtCoin(state.below.sugar), minerals: fmtCoin(state.below.minerals) }));
    }

    // Traits.
    show('traits-panel', !!f.traits);
    renderTraits();

    // Instinct.
    show('instinct-panel', !!f.instinct);
    renderInstinct();

    // Fruiting.
    show('spores-panel', !!f.spores);
    renderSpores();
  };

  const restore = () => renderLog();

  let noteTimer = null;
  const savedNote = (t) => {
    text('saved', t);
    if (typeof setTimeout === 'function') {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => text('saved', ''), 3000);
    }
  };

  return { render, say, log, restore, savedNote, renderLog, awayNote, clearAway };
}
