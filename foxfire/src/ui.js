// ---------------------------------------------------------------------------
// The page: what the state looks like as words and buttons.
//
// Everything here reads the simulation and writes the document. Nothing here
// changes the state: every button calls into `actions`, which the composition
// root wires to the simulation. Panels are hidden until their reveal flag is
// set, so the page grows as the organism does.
// ---------------------------------------------------------------------------

import * as Lore from './lore.js?v=1';
import * as Tr from './traits.js?v=1';
import * as Sp from './spores.js?v=1';
import { fmt, fmtCoin, fmtCount, fmtRate, fmtTime, fmtArea, fmtPct } from './numbers.js?v=1';
import { LARGEST_ORGANISM_M2 } from './levels.js?v=1';

const LOG_KEEP = 40;

export function createUI(doc, sim, cfg, actions) {
  const T = cfg.text;
  const el = (id) => doc.getElementById(id);
  const show = (id, on) => { const e = el(id); if (e) e.hidden = !on; };
  const text = (id, v) => { const e = el(id); if (e && e.textContent !== String(v)) e.textContent = String(v); };
  const state = sim.state;

  // -- a button with a price beside it -----------------------------------------

  const priced = (button, label, price, can) => {
    if (!button) return;
    const want = label + '' + (price === null || price === undefined ? '' : price);
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
  bind('extend', () => actions.extend());
  bind('beyond', () => actions.beyond());

  // -- the log -----------------------------------------------------------------

  const renderLog = () => {
    const box = el('log');
    if (!box) return;
    box.textContent = '';
    for (const line of state.log.slice(0, 8)) {
      const p = doc.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    }
  };

  const log = (line) => {
    if (!line) return;
    state.log.unshift(line);
    if (state.log.length > LOG_KEEP) state.log.length = LOG_KEEP;
    renderLog();
  };

  const say = (event) => {
    if (!event || !event.key) return;
    log(Lore.line(state.seed, event.key, event.values, event.salt));
  };

  // -- the trees table -----------------------------------------------------------

  const treeRows = new Map();
  const treeHead = () => {
    const table = el('trees');
    if (!table || table._head) return;
    table._head = true;
    const tr = doc.createElement('tr');
    for (const key of ['kind', 'size', 'sent', 'got', 'rate', 'weight', 'policy']) {
      const th = doc.createElement('th');
      th.textContent = T.columns[key];
      tr.appendChild(th);
    }
    table.appendChild(tr);
  };

  const treeRow = (row) => {
    let r = treeRows.get(row.key);
    if (r) return r;
    const tr = doc.createElement('tr');
    const cells = {};
    for (const key of ['kind', 'size', 'sent', 'got', 'rate', 'weight', 'policy']) {
      const td = doc.createElement('td');
      td.className = key;
      cells[key] = td;
      tr.appendChild(td);
    }
    // Kind: the name, and a small line under it.
    const name = doc.createElement('b');
    const note = doc.createElement('small');
    cells.kind.appendChild(name);
    cells.kind.appendChild(note);
    // Share: minus, the weight, plus.
    const less = doc.createElement('button');
    less.className = 'w';
    less.textContent = T.weightLess;
    less.addEventListener('click', () => actions.setWeight(row.key, -1));
    const w = doc.createElement('span');
    w.className = 'wv';
    const more = doc.createElement('button');
    more.className = 'w';
    more.textContent = T.weightMore;
    more.addEventListener('click', () => actions.setWeight(row.key, +1));
    cells.weight.appendChild(less);
    cells.weight.appendChild(w);
    cells.weight.appendChild(more);
    // Policy: what to do with the trees, and whether to feed them.
    const pol = doc.createElement('button');
    pol.className = 'pol';
    pol.title = T.harvestTip;
    pol.addEventListener('click', () => actions.setHarvest(row.key, (row.policy + 1) % 3));
    const feed = doc.createElement('button');
    feed.className = 'feed';
    feed.title = T.nurtureTip;
    feed.addEventListener('click', () => actions.toggleNurture(row.key));
    cells.policy.appendChild(pol);
    cells.policy.appendChild(feed);
    r = { tr, cells, name, note, w, pol, feed, row };
    treeRows.set(row.key, r);
    el('trees').appendChild(tr);
    return r;
  };

  const renderTrees = () => {
    if (!state.flags.trees) return;
    treeHead();
    const market = sim.market();
    const m = sim.mods();
    const season = sim.season();
    const winter = season.index === 3;
    let any = false;
    for (const sp of sim.roster) {
      const row = market[sp.key];
      if (!row) continue;
      if (row.count === 0 && row.dead === 0) continue;
      any = true;
      const r = treeRow(row);
      r.row = row;
      r.tr.hidden = false;
      r.name.textContent = Lore.capital(row.name);
      const bits = [];
      bits.push(row.count === 1 ? '1 tree' : row.count + ' trees');
      if (row.mature > 0) bits.push(row.mature + ' grown');
      if (row.dead > 0) bits.push(row.dead + ' ' + Lore.ui('treeDead'));
      r.note.textContent = bits.join(', ');
      r.note.title = r.note.textContent;
      const grown = row.count > 0 ? row.size / (row.count * row.max) : 0;
      r.cells.size.textContent = fmtPct(grown);
      r.cells.sent.textContent = fmtCoin(row.sent) + '/s';
      r.cells.got.textContent = fmtRate(row.got);
      r.cells.rate.textContent = fmtCoin(row.marginal);
      r.cells.rate.title = winter ? Lore.ui(m.evergreen ? 'evergreenWinter' : 'winter') : '';
      r.cells.rate.className = 'rate' + (winter ? ' cold' : (row.sat > 0.85 ? ' sat' : ''));
      r.w.textContent = String(row.weight);
      r.pol.hidden = !m.fell;
      r.pol.textContent = T.harvest[row.policy] || T.harvest[0];
      r.pol.className = 'pol' + (row.policy ? ' on' : '');
      r.feed.hidden = !m.nurture;
      r.feed.textContent = T.nurture;
      r.feed.className = 'feed' + (row.nurture ? ' on' : '');
    }
    for (const [key, r] of treeRows) {
      if (!market[key] || (market[key].count === 0 && market[key].dead === 0)) r.tr.hidden = true;
    }
    text('treesnote', any ? '' : Lore.ui('noTrees'));
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
    line.title = Lore.trait(id).line;
    const lv = doc.createElement('span');
    lv.className = 'lv';
    box.appendChild(b);
    box.appendChild(line);
    box.appendChild(lv);
    el('traits').appendChild(box);
    r = { box, b, lv };
    traitRows.set(id, r);
    return r;
  };

  const renderTraits = () => {
    if (!state.flags.traits) return;
    const m = sim.mods();
    for (const t of Tr.offered(cfg, state, m)) {
      const seen = t.level > 0 || (t.cost !== null && state.totals.earned >= t.cost * 0.5);
      if (!seen && !traitRows.has(t.id)) continue;
      const r = traitRow(t.id);
      r.box.hidden = !seen;
      const capped = t.cost === null;
      priced(r.b, Lore.trait(t.id).name, capped ? T.bought : fmt(t.cost), !capped && state.sugar >= t.cost);
      r.lv.textContent = t.cap > 1 ? t.level + '/' + t.cap : (t.level ? T.bought : '');
    }
  };

  // -- the genome -------------------------------------------------------------------

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
    line.title = Lore.genome(id).line;
    const lv = doc.createElement('span');
    lv.className = 'lv';
    box.appendChild(b);
    box.appendChild(line);
    box.appendChild(lv);
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
    const note = can ? Lore.ui('sporesNote', { n }) : '';
    text('spores-note', note);
    const held = g.spores > 0 ? Lore.ui('sporesHeld', { n: g.spores }) : '';
    text('spores-held', held);
    const fruit = el('fruit');
    if (fruit) { fruit.hidden = !can; fruit.disabled = !can; }
    show('p-genome', g.fruitings > 0 || g.spores > 0);
    show('genome', g.fruitings > 0 || g.spores > 0);
    if (g.fruitings > 0 || g.spores > 0) {
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
    const m = sim.mods();
    const info = Lore.levelInfo(state.level);

    // The top line.
    text('sugar', fmt(state.sugar));
    show('st-income', !!f.tips);
    text('income', fmtRate(rate.sugar));
    show('st-minerals', !!f.trees);
    text('minerals', fmtCoin(rate.minerals) + '/s');
    show('st-tips', !!f.tips);
    text('tips', fmtCount(state.tipCount));
    show('st-area', !!f.reach);
    const A = sim.area();
    text('area', fmtArea(A));
    const areaEl = el('st-area');
    if (areaEl) areaEl.title = A >= LARGEST_ORGANISM_M2 ? Lore.ui('largestNote') : '';
    show('st-level', !!f.reach);
    text('level', Lore.capital(info.name.replace(/^the /, '')) + ' ' + state.ring + '/' + cfg.world.rings);

    // The hand.
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
    }

    // The trees.
    show('trees-panel', !!f.trees);
    renderTrees();

    // The year.
    show('season-panel', !!f.season);
    if (f.season) {
      const s = sim.season();
      text('season-name', T.seasons[s.index]);
      text('season-left', Lore.ui('seasonLine', { name: T.seasons[s.index], left: fmtTime(s.left) }));
      const bar = el('season-bar');
      if (bar && bar.style) bar.style.width = Math.round(s.frac * 100) + '%';
      const sp = el('season-panel');
      if (sp) sp.className = 'panel season-' + s.index;
    }

    // Reach.
    show('reach-panel', !!f.reach);
    if (f.reach) {
      const total = sim.world.total;
      const last = state.ring >= cfg.world.rings;
      text('reachline', last
        ? Lore.ui('reachClosed', { level: Lore.capital(info.name) }) + ' ' + fmtCount(state.reached.length) + ' of ' + fmtCount(total) + ' reached.'
        : Lore.ui('reachLine', { ring: state.ring, rings: cfg.world.rings, level: info.name, reached: fmtCount(state.reached.length), total: fmtCount(total) }));
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

  return { render, say, log, restore, savedNote, renderLog };
}
