// ---------------------------------------------------------------------------
// The page: panels, rows, buttons and the log.
//
// Everything a player reads is DOM, built here from the simulation's state and
// nothing else. Short labels come from config.js and sentences from
// content.js. Nothing is drawn with innerHTML; every node is created, so the
// headless harness can stand in for a browser with a very small stub.
// render() is idempotent and cheap: rows are keyed and reused, and only their
// text changes frame to frame.
//
// The panels appear in the order the reveal flags are set and never go away.
// ---------------------------------------------------------------------------

import * as Mat from './materials.js?v=2';
import * as Mk from './market.js?v=2';
import * as H from './horde.js?v=2';
import * as R from './rites.js?v=2';
import * as Rb from './rebirth.js?v=2';
import * as Lore from './lore.js?v=2';
import { fmt, fmtCoin, fmtCount, fmtRate, fmtTime, fmtPct } from './numbers.js?v=2';
import { fill } from '../config.js?v=2';

const SVG = 'http://www.w3.org/2000/svg';

export function createUI(doc, sim, cfg, actions) {
  const T = cfg.text;
  const byId = (id) => doc.getElementById(id);
  const el = (tag, attrs, ...children) => {
    const n = doc.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'title') n.title = v;
        else if (k === 'onclick') n.addEventListener('click', v);
        else if (k === 'hidden') n.hidden = !!v;
        else n.setAttribute(k, v);
      }
    }
    for (const c of children) if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    return n;
  };
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };
  const show = (n, on) => { if (n) n.hidden = !on; };

  const nodes = {
    log: byId('log'),
    hand: byId('hand'), dig: byId('dig'), sell: byId('sell'), handline: byId('handline'),
    hordePanel: byId('horde-panel'), raise: byId('raise'), weights: byId('weights'),
    marketPanel: byId('market-panel'), market: byId('market'),
    ritesPanel: byId('rites-panel'), rites: byId('rites'),
    visitorPanel: byId('visitor-panel'), visitorText: byId('visitor-text'), visitorActs: byId('visitor-acts'),
    chamberPanel: byId('chamber-panel'), chamberTitle: byId('chamber-title'),
    chamberText: byId('chamber-text'), chamberOffers: byId('chamber-offers'),
    sealPanel: byId('seal-panel'), sealNote: byId('seal-note'), sealActs: byId('seal-acts'),
    oaths: byId('oaths'), oathsTitle: byId('p-oaths'),
    stats: {
      coin: byId('coin'), income: byId('income'), bones: byId('bones'), horde: byId('horde'),
      depth: byId('depth'), rem: byId('rem'),
      coinBox: byId('st-coin'), incomeBox: byId('st-income'), bonesBox: byId('st-bones'),
      hordeBox: byId('st-horde'), depthBox: byId('st-depth'), remBox: byId('st-rem'),
    },
    fieldhint: byId('fieldhint'),
    saved: byId('saved'),
  };

  // The log lives on the state so a reload shows what was last said.
  if (!Array.isArray(sim.state.log)) sim.state.log = [];
  const lines = sim.state.log;
  const LOG_MAX = 14;

  const showLog = () => {
    if (!nodes.log) return;
    clear(nodes.log);
    for (const t of lines) nodes.log.appendChild(el('p', { text: t }));
  };

  /** One line into the log, newest first. */
  const log = (text) => {
    if (!text) return;
    lines.unshift(text);
    if (lines.length > LOG_MAX) lines.length = LOG_MAX;
    showLog();
  };

  /** Put a restored run's lines back on the page. */
  const restore = () => showLog();

  /** Turn a simulation event into a line, if it carries one. */
  const say = (e) => {
    if (e.type !== 'log') return;
    if (e.text) log(e.text);
  };

  /** The tag a layer's seam shows, or nothing at all for plain ground. */
  const seamTag = (k) => {
    const layer = sim.ground.at(k);
    if (!layer.seam) return '';
    const words = Lore.seam(layer.seam.id);
    return words ? words.tag : '';
  };
  const seamLine = (k) => {
    const layer = sim.ground.at(k);
    if (!layer.seam) return '';
    const words = Lore.seam(layer.seam.id);
    return words ? words.line : '';
  };

  // -- the hand ------------------------------------------------------------

  if (nodes.dig) nodes.dig.addEventListener('click', () => actions.dig());
  if (nodes.sell) nodes.sell.addEventListener('click', () => actions.sell('s0', sim.held('s0')));

  // -- the horde -----------------------------------------------------------

  const raiseButtons = [];
  const buildRaise = () => {
    clear(nodes.raise);
    raiseButtons.length = 0;
    const counts = cfg.horde.bulk.concat(['max']);
    nodes.raise.appendChild(el('span', { class: 'lbl', text: T.raise }));
    for (const c of counts) {
      const b = el('button', { class: 'raise', onclick: () => actions.raise(c) }, el('b', { text: c === 'max' ? T.raiseMax : 'x' + c }), el('i'));
      raiseButtons.push({ count: c, node: b, cost: b.lastChild });
      nodes.raise.appendChild(b);
    }
  };

  const weightRows = new Map(); // key -> { node, bar, meta }
  const buildWeights = () => {
    const s = sim.state;
    const from = sim.activeFrom();
    const keys = [];
    for (let k = s.depth; k >= from; k--) keys.push(k);
    if (s.flags.face) keys.push('face');
    const have = Array.from(weightRows.keys());
    const same = have.length === keys.length && have.every((k, i) => k === keys[i]);
    if (same) return;
    clear(nodes.weights);
    weightRows.clear();
    for (const key of keys) {
      const isFace = key === 'face';
      const layer = isFace ? null : sim.ground.at(key);
      const name = isFace ? T.face : layer.name;
      const hue = isFace ? cfg.palette.face : layer.hue;
      const bar = el('span', { class: 'bar' });
      const meta = el('i');
      const tag = el('span', { class: 'seam', text: isFace ? '' : seamTag(key) });
      const row = el('div', { class: 'wrow' + (isFace ? ' face' : '') },
        el('span', { class: 'swatch', style: 'background:' + hue }),
        el('span', { class: 'name', text: name, title: isFace ? T.faceLine : seamLine(key) }),
        tag,
        el('button', { class: 'w', text: T.weightLess, onclick: () => actions.setWeight(key, -1) }),
        bar,
        el('button', { class: 'w', text: T.weightMore, onclick: () => actions.setWeight(key, 1) }),
        meta);
      row.firstChild.style.background = hue;
      nodes.weights.appendChild(row);
      weightRows.set(key, { node: row, bar, meta, tag });
    }
  };

  // -- the market ----------------------------------------------------------

  const marketRows = new Map(); // id -> row parts
  let lesserRow = null;

  /** Which goods get a row of their own, deepest first, bones last. */
  const rowIds = () => {
    const from = sim.activeFrom();
    const own = [];
    const lesser = [];
    for (const id of sim.goods()) {
      if (id === Mat.BONES) continue;
      const k = Mat.strataOf(id);
      if (k >= from) own.push(id); else lesser.push(id);
    }
    own.sort((a, b) => Mat.strataOf(b) - Mat.strataOf(a));
    if (sim.goods().includes(Mat.BONES)) own.push(Mat.BONES);
    return { own, lesser };
  };

  const sparkline = () => {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 96 24');
    svg.setAttribute('class', 'spark');
    const base = doc.createElementNS(SVG, 'line');
    base.setAttribute('class', 'base');
    const future = doc.createElementNS(SVG, 'polyline');
    future.setAttribute('class', 'future');
    const line = doc.createElementNS(SVG, 'polyline');
    line.setAttribute('class', 'line');
    svg.appendChild(base); svg.appendChild(future); svg.appendChild(line);
    return { svg, base, line, future };
  };

  const makeRow = (id) => {
    const k = Mat.strataOf(id);
    const good = k >= 0 ? sim.ground.at(k) : { name: cfg.text.stats.bones, hue: cfg.palette.bone, seam: null };
    const spark = sparkline();
    const held = el('td', { class: 'num' });
    const price = el('td', { class: 'num' });
    const delta = el('i');
    price.appendChild(el('b'));
    price.appendChild(delta);
    const demand = el('span', { class: 'demand' }, el('span'));
    const buttons = el('td', { class: 'acts' },
      el('button', { text: T.sellLot, title: T.sellLotTip, onclick: () => actions.sellLot(id) }),
      el('button', { text: T.sellAll, onclick: () => actions.sellShare(id, 1) }),
      el('button', { class: 'buy', text: T.buy, title: T.buyTip, hidden: true, onclick: () => actions.buy(id) }));
    // The ledger's figures sit under the price (base) and under the chart
    // (what it takes, how fast it recovers); a choking market is flagged
    // beside its name.
    const base = el('small', { class: 'ledger', hidden: true });
    price.appendChild(base);
    const takes = el('small', { class: 'ledger', hidden: true });
    held.appendChild(el('b'));
    held.appendChild(takes);
    const hot = el('small', { class: 'sat', hidden: true });
    const tag = k >= 0 ? seamTag(k) : '';
    const nameCell = el('td', { class: 'good' },
      el('span', { class: 'swatch', style: 'background:' + good.hue }),
      el('span', { text: good.name }),
      tag ? el('small', { class: 'seam', text: tag, title: seamLine(k) }) : null,
      hot);
    nameCell.firstChild.style.background = good.hue;
    const tr = el('tr', null, nameCell, held, price, el('td', { class: 'chart' }, spark.svg, demand), buttons);
    return { id, tr, held: held.firstChild, price: price.firstChild, delta, demandBar: demand.firstChild, spark, buy: buttons.lastChild, base, takes, hot, sampled: -1 };
  };

  const buildMarket = () => {
    const { own, lesser } = rowIds();
    const wanted = own.join('|') + '#' + (lesser.length ? 'lesser' : '');
    if (nodes.market._key === wanted) return;
    nodes.market._key = wanted;
    clear(nodes.market);
    const head = el('tr', { class: 'head' },
      el('th', { text: T.columns.good }), el('th', { text: T.columns.held }),
      el('th', { text: T.columns.price }), el('th', { text: T.columns.demand }), el('th'));
    nodes.market.appendChild(head);
    for (const id of own) {
      let row = marketRows.get(id);
      if (!row) { row = makeRow(id); marketRows.set(id, row); }
      nodes.market.appendChild(row.tr);
    }
    if (lesser.length) {
      const meta = el('td', { class: 'num', colspan: '3' });
      const name = el('td', { class: 'good lesser' });
      lesserRow = { tr: el('tr', { class: 'lesserrow' }, name, meta,
        el('td', { class: 'acts' }, el('button', { text: T.sellAll, onclick: () => actions.sellLesser() }))), name, meta };
      nodes.market.appendChild(lesserRow.tr);
    } else {
      lesserRow = null;
    }
  };

  const drawSpark = (row, m, t, md) => {
    const hist = m.history;
    if (hist.length < 2) { row.spark.line.setAttribute('points', ''); return; }
    const keep = md.ledger ? cfg.market.historyLedger : cfg.market.history;
    const fut = md.foresight ? Mk.forecast(m, t, 24, cfg.market.forecastSeconds / 24) : [];
    let lo = m.base, hi = m.base;
    for (const v of hist) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const v of fut) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-9) { hi = lo * 1.05 + 1e-9; lo = lo * 0.95; }
    const span = fut.length ? 76 : 96;
    const xOf = (i, n) => (i / Math.max(1, keep - 1)) * span + (span - Math.min(n, keep) / Math.max(1, keep - 1) * span);
    const yOf = (v) => 22 - ((v - lo) / (hi - lo)) * 20;
    const pts = [];
    const n = hist.length;
    for (let i = 0; i < n; i++) pts.push(xOf(i, n).toFixed(1) + ',' + yOf(hist[i]).toFixed(1));
    row.spark.line.setAttribute('points', pts.join(' '));
    const by = yOf(m.base).toFixed(1);
    row.spark.base.setAttribute('x1', '0'); row.spark.base.setAttribute('x2', '96');
    row.spark.base.setAttribute('y1', by); row.spark.base.setAttribute('y2', by);
    if (fut.length) {
      const fp = [];
      const x0 = span;
      for (let i = 0; i < fut.length; i++) fp.push((x0 + (i + 1) / fut.length * 20).toFixed(1) + ',' + yOf(fut[i]).toFixed(1));
      row.spark.future.setAttribute('points', pts[pts.length - 1] + ' ' + fp.join(' '));
    } else {
      row.spark.future.setAttribute('points', '');
    }
  };

  const renderMarket = () => {
    const s = sim.state;
    const md = sim.mods();
    const t = s.t;
    for (const row of marketRows.values()) {
      if (!row.tr.parentNode) continue;
      const id = row.id;
      const m = sim.marketFor(id);
      const units = sim.held(id);
      const p = sim.price(id);
      const base = sim.baseOf(id);
      row.held.textContent = id === Mat.BONES ? fmt(Math.floor(units)) : fmt(units);
      row.price.textContent = fmtCoin(p);
      const rel = p / base - 1;
      row.delta.textContent = (rel >= 0 ? '+' : '') + Math.round(rel * 100) + '%';
      row.delta.className = rel >= 0.05 ? 'up' : (rel <= -0.05 ? 'down' : '');
      const d = Math.max(0, Math.min(1, Mk.demandOf(m)));
      row.demandBar.style.width = Math.round(d * 100) + '%';
      row.demandBar.className = d < cfg.market.buckleBelow ? 'low' : '';
      if (row.sampled !== m.history.length) { row.sampled = m.history.length; drawSpark(row, m, t, md); }
      show(row.buy, md.ledger);
      if (md.ledger) {
        const { absorb, recovery } = Mk.effective(m, md);
        const sat = Mk.saturation(m, sim.flowOf(id), md);
        row.base.textContent = fill(T.ledgerBase, { base: fmtCoin(base) });
        row.takes.textContent = fill(T.ledgerTakes, { absorb: fmt(absorb), t: fmtTime(recovery) });
        row.takes.title = 'about what this market takes before it buckles, and how long it takes to recover';
        // Bones are raised, not sold by the ton, so their thin market is not
        // flagged as choking.
        const choking = sat > 1 && id !== Mat.BONES;
        row.hot.textContent = choking ? fill(T.ceilingLine, { pct: Math.round(sat * 100) }) : '';
        show(row.hot, choking);
      }
      show(row.base, md.ledger);
      show(row.takes, md.ledger);
    }
    if (lesserRow) {
      const { lesser } = rowIds();
      let value = 0;
      for (const id of lesser) value += sim.quote(id, sim.held(id));
      lesserRow.name.textContent = fill(T.lesserGoods, { n: lesser.length });
      lesserRow.meta.textContent = fill(T.lesserWorth, { coin: fmtCoin(value) });
    }
  };

  // -- rites ---------------------------------------------------------------

  const riteRows = new Map();
  const buildRites = () => {
    const s = sim.state;
    const vis = R.visible(s, cfg);
    for (const def of vis) {
      if (riteRows.has(def.id)) continue;
      const words = R.wordsOf(def.id);
      const cost = el('i');
      const level = el('span', { class: 'lv' });
      const button = el('button', { class: 'rite', onclick: () => actions.buyRite(def.id) }, el('b', { text: words.name }), cost);
      // The row shows the short line and says the whole of it on hover, so a
      // narrow column never hides something the player needed.
      const row = el('div', { class: 'rrow', title: words.name + ': ' + (words.long || words.line) },
        button, el('span', { class: 'line', text: words.line, title: words.long || words.line }), level);
      nodes.rites.appendChild(row);
      riteRows.set(def.id, { def, row, button, cost, level });
    }
  };
  const renderRites = () => {
    const s = sim.state;
    for (const r of riteRows.values()) {
      const lv = R.levelOf(s, r.def.id);
      const done = R.maxed(s, r.def);
      r.cost.textContent = done ? T.bought : fmtCoin(R.cost(r.def, lv));
      r.button.disabled = done || !R.canBuy(s, r.def);
      r.level.textContent = lv > 0 ? 'lv ' + lv : '';
    }
  };

  // -- the gate ------------------------------------------------------------

  let visitorKey = '';
  const renderVisitor = () => {
    const v = sim.state.visitor;
    show(nodes.visitorPanel, !!v);
    if (!v) { visitorKey = ''; return; }
    const key = v.kind + ':' + v.i;
    if (key !== visitorKey) {
      visitorKey = key;
      if (nodes.visitorText) nodes.visitorText.textContent = v.text;
      clear(nodes.visitorActs);
      const take = el('button', { class: 'take', text: v.take, onclick: () => actions.acceptVisitor() });
      nodes.visitorActs.appendChild(take);
      nodes.visitorActs.appendChild(el('button', { text: v.pass, onclick: () => actions.declineVisitor() }));
      nodes.visitorActs._take = take;
    }
    const take = nodes.visitorActs && nodes.visitorActs._take;
    if (take) take.disabled = !sim.visitorReady();
  };

  // -- a chamber -----------------------------------------------------------

  let chamberKey = '';
  const renderChamber = () => {
    const c = sim.state.chamber;
    show(nodes.chamberPanel, !!c);
    if (!c) { chamberKey = ''; return; }
    const key = 'k' + c.k;
    if (key === chamberKey) return;
    chamberKey = key;
    if (nodes.chamberTitle) nodes.chamberTitle.textContent = c.title;
    clear(nodes.chamberText);
    for (const l of c.lines) nodes.chamberText.appendChild(el('p', { text: l }));
    clear(nodes.chamberOffers);
    for (const offer of c.offers) {
      nodes.chamberOffers.appendChild(el('div', { class: 'offer' },
        el('button', { text: offer.name, onclick: () => actions.takeOffer(offer.i) }),
        el('span', { class: 'line', text: offer.line })));
    }
  };

  // -- the seal ------------------------------------------------------------

  const oathRows = new Map();
  let sealArmed = false;
  let sealButton = null;

  const buildSeal = () => {
    if (sealButton || !nodes.sealActs) return;
    const words = Lore.seal();
    sealButton = el('button', { class: 'seal', text: words.button, onclick: () => {
      if (!sealArmed) { sealArmed = true; sealButton.textContent = words.confirm; return; }
      actions.seal();
    } });
    nodes.sealActs.appendChild(sealButton);
    for (const def of Rb.oathDefs(cfg)) {
      const words2 = Lore.oath(def.id);
      const cost = el('i');
      const level = el('span', { class: 'lv' });
      const button = el('button', { class: 'rite', onclick: () => actions.buyOath(def.id) }, el('b', { text: words2.name }), cost);
      const row = el('div', { class: 'rrow', title: words2.name + ': ' + (words2.long || words2.line) },
        button, el('span', { class: 'line', text: words2.line, title: words2.long || words2.line }), level);
      nodes.oaths.appendChild(row);
      oathRows.set(def.id, { def, button, cost, level });
    }
  };

  const renderSeal = () => {
    const s = sim.state;
    const legacy = sim.legacy;
    const words = Lore.seal();
    buildSeal();
    const ready = sim.canSeal();
    if (nodes.sealNote) {
      nodes.sealNote.textContent = ready
        ? words.ready + ' ' + fill(words.yield, { n: fmt(sim.sealYield()) })
        : fill(words.locked, { depth: cfg.seal.unlockDepth + 1 });
    }
    if (sealButton) {
      sealButton.disabled = !ready;
      if (!ready && sealArmed) { sealArmed = false; sealButton.textContent = words.button; }
    }
    for (const r of oathRows.values()) {
      const lv = Rb.oathLevel(legacy, r.def.id);
      const done = Rb.oathMaxed(legacy, r.def);
      r.cost.textContent = done ? T.bought : fmt(Rb.oathCost(r.def, lv));
      r.button.disabled = done || !Rb.canBuyOath(legacy, r.def);
      r.level.textContent = lv > 0 ? 'lv ' + lv : '';
    }
    // Nothing is remembered until a barrow has been closed, so the heading
    // goes with the list rather than standing over an empty space.
    const remembered = legacy.seals > 0 || legacy.remembrance > 0;
    show(nodes.oaths, remembered);
    show(nodes.oathsTitle, remembered);
  };

  // -- everything ----------------------------------------------------------

  const render = () => {
    const s = sim.state;
    const f = s.flags;
    const md = sim.mods();

    // Stats, each appearing when it first means something.
    const st = nodes.stats;
    if (st.coin) st.coin.textContent = fmtCoin(s.coin);
    if (st.income) st.income.textContent = fmtRate(s.rate);
    if (st.bones) st.bones.textContent = fmt(Math.floor(s.bones * 10) / 10);
    if (st.horde) st.horde.textContent = fmtCount(s.horde);
    if (st.depth) {
      const layer = sim.ground.at(s.depth);
      st.depth.textContent = String(s.depth + 1) + ' ' + layer.name;
    }
    if (st.rem) st.rem.textContent = fmt(sim.legacy.remembrance);
    show(st.coinBox, s.totals.earned > 0 || s.coin > 0);
    show(st.incomeBox, s.totals.earned > 0 && s.horde > 0);
    show(st.bonesBox, f.raise);
    show(st.hordeBox, s.horde > 0);
    show(st.depthBox, f.face);
    show(st.remBox, sim.legacy.seals > 0 || sim.legacy.remembrance > 0);

    // The hand.
    show(nodes.hand, !f.handHidden);
    show(nodes.sell, f.sell && !f.market);
    if (nodes.handline) {
      const soil = s.stock.s0 || 0;
      nodes.handline.textContent = soil > 0 && !f.market ? fmt(soil) + ' ' + sim.ground.at(0).name : '';
    }

    renderChamber();
    renderVisitor();

    // The horde.
    show(nodes.hordePanel, f.raise);
    if (f.raise) {
      if (!raiseButtons.length) buildRaise();
      const soft = md.softMult;
      for (const b of raiseButtons) {
        const n = b.count === 'max' ? H.maxRaisable(s.bones, s.horde, cfg.horde, soft) : b.count;
        const cost = H.raiseCostBulk(s.horde, n, cfg.horde, soft);
        // The counted buttons say what they cost; `max` says how many stand
        // up, which is a different kind of number and has to read like one.
        b.cost.textContent = b.count === 'max' ? (n > 0 ? '+' + fmtCount(n) : '-') : fmt(Math.ceil(cost * 10) / 10);
        b.node.disabled = !(n > 0) || cost > s.bones + 1e-9;
      }
      buildWeights();
      const from = sim.activeFrom();
      const split = H.distribute(s.weights, s.faceWeight, from);
      for (const [key, r] of weightRows) {
        const w = key === 'face' ? s.faceWeight : (s.weights[key] || 0);
        let bar = '';
        for (let i = 0; i < cfg.horde.maxWeight; i++) bar += i < w ? '▌' : '·';
        r.bar.textContent = bar;
        const share = key === 'face' ? split.face : (split.strata[key] || 0);
        let meta = fmtPct(share);
        let hot = false;
        if (key === 'face') {
          // What is under the face, once the ground below has been read. The
          // name goes where the share is and the seam goes in the column the
          // face row does not otherwise use, so neither is cut off.
          const k = s.depth + 1;
          if (md.assay || s.read[k]) {
            meta += ' - ' + fill(T.seamAhead, { seam: sim.ground.at(k).name });
            r.tag.textContent = seamTag(k);
          } else {
            r.tag.textContent = '';
          }
        } else if (md.ledger) {
          const sat = Mk.saturation(sim.marketFor('s' + key), sim.flowOf('s' + key), md);
          if (sat > 1) { meta += ' - ' + fill(T.ceilingLine, { pct: Math.round(sat * 100) }); hot = true; }
        }
        r.meta.textContent = meta;
        r.meta.className = hot ? 'hot' : '';
      }
      show(nodes.weights, f.face || s.depth > 0);
    }

    // The market.
    show(nodes.marketPanel, f.market);
    if (f.market) { buildMarket(); renderMarket(); }

    // Rites.
    show(nodes.ritesPanel, f.rites);
    if (f.rites) { buildRites(); renderRites(); }

    // The seal.
    show(nodes.sealPanel, f.seal);
    if (f.seal) renderSeal();

    if (nodes.fieldhint) show(nodes.fieldhint, !f.field);
  };

  const savedNote = (text) => { if (nodes.saved) nodes.saved.textContent = text; };

  return { render, log, say, savedNote, restore, lines };
}
