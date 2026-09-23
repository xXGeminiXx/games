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

import * as Mat from './materials.js?v=40';
import * as Mk from './market.js?v=40';
import * as H from './horde.js?v=40';
import * as R from './rites.js?v=40';
import * as Rb from './rebirth.js?v=40';
import * as Lore from './lore.js?v=40';
import * as Advice from './advice.js?v=40';
import * as Lords from './lords.js?v=40';
import * as Ranks from './ranks.js?v=40';
import { fmt, fmtCoin, fmtCount, fmtRate, fmtTime, fmtPct } from './numbers.js?v=40';
import { fill } from '../config.js?v=40';

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
    handOver: byId('handover'), spent: byId('spent'),
    marketPanel: byId('market-panel'), market: byId('market'),
    ritesPanel: byId('rites-panel'), rites: byId('rites'), riteBulk: byId('rite-bulk'),
    tabs: byId('panel-tabs'), tabRites: byId('tab-rites'), tabOaths: byId('tab-oaths'),
    tabOathsCount: byId('tab-oaths-n'), oathsNote: byId('oaths-note'),
    visitorPanel: byId('visitor-panel'), visitorText: byId('visitor-text'), visitorActs: byId('visitor-acts'),
    visitorAfter: byId('visitor-after'),
    chamberPanel: byId('chamber-panel'), chamberTitle: byId('chamber-title'),
    chamberText: byId('chamber-text'), chamberOffers: byId('chamber-offers'),
    sealPanel: byId('seal-panel'), sealNote: byId('seal-note'), sealActs: byId('seal-acts'),
    oaths: byId('oaths'),
    stats: {
      coin: byId('coin'), income: byId('income'), bones: byId('bones'), horde: byId('horde'),
      depth: byId('depth'), rem: byId('rem'), rank: byId('rank'), rankLabel: byId('lbl-rank'),
      coinBox: byId('st-coin'), incomeBox: byId('st-income'), bonesBox: byId('st-bones'),
      hordeBox: byId('st-horde'), depthBox: byId('st-depth'), remBox: byId('st-rem'), rankBox: byId('st-rank'),
    },
    goal: byId('goal'), goalSay: byId('goal-say'), goalBar: byId('goal-bar'), goalRule: byId('goal-rule'),
    ending: byId('ending-panel'),
    standing: byId('standing'),
    fieldhint: byId('fieldhint'),
    compass: byId('compass'), compassSay: byId('compass-say'), compassGo: byId('compass-go'),
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

  /**
   * How far past its ceiling a market is, as a multiple. A layer worked far
   * past what its market can pay reads in the hundreds as a percentage, which
   * is five digits of noise; what the player needs is how many times over.
   */
  const overBy = (sat) => (sat < 10 ? sat.toFixed(1) : fmt(Math.round(sat)));

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

  // HOW MANY LEVELS OF A RITE ONE PRESS BUYS. A rite reaches sixteen levels
  // and more, and buying it there one press at a time is the game asking a
  // player to do arithmetic with their hand. One choice serves every rite in
  // the list rather than three more buttons on each row.
  // The choice is the player's and it is kept with the save, so a reload or a
  // new barrow comes back on whatever they last set.
  const riteSteps0 = [1, 5, 25, 'max'];
  let ritePick = riteSteps0.includes(sim.legacy.ritePick) ? sim.legacy.ritePick : 1;
  const riteSteps = [1, 5, 25, 'max'];
  const riteButtons = [];
  const riteCount = (id) => (ritePick === 'max' ? Math.max(1, sim.riteMax(id)) : ritePick);
  const buildRiteBulk = () => {
    if (!nodes.riteBulk || riteButtons.length) return;
    nodes.riteBulk.appendChild(el('span', { class: 'lbl', text: T.panels.riteBulk }));
    for (const n of riteSteps) {
      const b = el('button', { onclick: () => { ritePick = n; paintRiteBulk(); actions.setRitePick(n); } },
                   el('b', { text: n === 'max' ? 'max' : 'x' + n }));
      riteButtons.push({ n, node: b });
      nodes.riteBulk.appendChild(b);
    }
    paintRiteBulk();
  };
  const paintRiteBulk = () => {
    for (const { n, node } of riteButtons) node.setAttribute('aria-pressed', String(n === ritePick));
  };

  // Rank hands over two switches. They sit where the thing they drive is:
  // auto-buy beside the upgrades, filling in by itself beside filling in.
  let autoBuyButton = null;
  const paintAutoBuy = () => {
    const on = !!sim.mods().autoBuy;
    if (!on && !autoBuyButton) return;
    if (!autoBuyButton && nodes.riteBulk) {
      autoBuyButton = el('button', { class: 'auto', title: T.autoBuyTip, onclick: () => actions.setAutoBuy(!sim.legacy.autoBuy) });
      nodes.riteBulk.appendChild(autoBuyButton);
    }
    if (!autoBuyButton) return;
    show(autoBuyButton, on);
    const text = sim.legacy.autoBuy ? T.autoBuyOn : T.autoBuyOff;
    if (autoBuyButton.textContent !== text) autoBuyButton.textContent = text;
    autoBuyButton.setAttribute('aria-pressed', String(!!sim.legacy.autoBuy));
  };

  // Mortifer's power hands over a third: the dead raising themselves, beside
  // the raise buttons it stands in for.
  let autoRaiseButton = null;
  const paintAutoRaise = () => {
    const on = !!sim.mods().autoRaise;
    if (!on && !autoRaiseButton) return;
    if (!autoRaiseButton && nodes.raise) {
      autoRaiseButton = el('button', { class: 'auto', title: T.autoRaiseTip, onclick: () => actions.setAutoRaise(sim.legacy.autoRaise === false) });
      nodes.raise.appendChild(autoRaiseButton);
    }
    if (!autoRaiseButton) return;
    show(autoRaiseButton, on);
    const running = sim.legacy.autoRaise !== false;
    const text = running ? T.autoRaiseOn : T.autoRaiseOff;
    if (autoRaiseButton.textContent !== text) autoRaiseButton.textContent = text;
    autoRaiseButton.setAttribute('aria-pressed', String(running));
  };

  let autoSealRow = null;
  const paintAutoSeal = () => {
    const on = !!sim.mods().autoSeal;
    if (!on && !autoSealRow) return;
    if (!autoSealRow && nodes.sealActs) {
      const label = el('button', { class: 'auto', title: T.autoSealTip, onclick: () => {
        const at = sim.legacy.autoSealAt;
        actions.setAutoSeal(at > 0 ? 0 : Math.max(sim.state.depth + 6, cfg.seal.unlockDepth + 1));
      } });
      const less = el('button', { class: 'w', text: '-5', onclick: () => actions.setAutoSeal(Math.max(0, (sim.legacy.autoSealAt || 0) - 5)) });
      const more = el('button', { class: 'w', text: '+5', onclick: () => actions.setAutoSeal((sim.legacy.autoSealAt || (sim.state.depth + 1)) + 5) });
      autoSealRow = el('div', { class: 'autoseal' }, label, less, more);
      autoSealRow._label = label; autoSealRow._less = less; autoSealRow._more = more;
      nodes.sealActs.appendChild(autoSealRow);
    }
    if (!autoSealRow) return;
    show(autoSealRow, on);
    const at = sim.legacy.autoSealAt || 0;
    const text = at > 0 ? fill(T.autoSeal, { n: at }) : T.autoSealOff;
    if (autoSealRow._label.textContent !== text) autoSealRow._label.textContent = text;
    autoSealRow._label.setAttribute('aria-pressed', String(at > 0));
    show(autoSealRow._less, at > 0);
    show(autoSealRow._more, at > 0);
  };

  const raiseButtons = [];
  const buildRaise = () => {
    clear(nodes.raise);
    raiseButtons.length = 0;
    const counts = cfg.horde.bulk.concat(['max']);
    nodes.raise.appendChild(el('span', { class: 'lbl', text: T.raise }));
    for (const c of counts) {
      const b = el('button', { class: 'raise', title: T.raiseTip, onclick: () => actions.raise(c) }, el('b', { text: c === 'max' ? T.raiseMax : 'x' + c }), el('i'));
      raiseButtons.push({ count: c, node: b, cost: b.lastChild });
      nodes.raise.appendChild(b);
    }
  };

  // Layers with nobody on them are the set, not the state: deep in a run
  // every layer above the deepest is finished for good and nine rows reading
  // nothing are nine rows of scenery. They fold into one line that says how
  // many and what they left, and anybody who wants the list can open it.
  // Kept with the save like the other things a player sets (David, B16).
  const prefs = () => { if (!sim.legacy.ui || typeof sim.legacy.ui !== 'object') sim.legacy.ui = {}; return sim.legacy.ui; };
  let showSpent = !!prefs().showSpent;

  const weightRows = new Map(); // key -> { node, bar, meta }
  const buildWeights = (split) => {
    const s = sim.state;
    const from = sim.activeFrom();
    const keys = [];
    for (let k = s.depth; k >= from; k--) {
      const live = (split.strata[k] || 0) > 1e-9;
      if (live || showSpent || s.byHand) keys.push(k);
    }
    if (s.flags.face) keys.push('face');
    const have = Array.from(weightRows.keys());
    const same = have.length === keys.length && have.every((k, i) => k === keys[i]);
    if (same) return;
    clear(nodes.weights);
    weightRows.clear();
    for (const key of keys) {
      const isFace = key === 'face';
      const layer = isFace ? null : sim.ground.at(key);
      const name = isFace ? T.face : Lore.label(layer.name);
      const hue = isFace ? cfg.palette.face : layer.hue;
      // Five notches, each its own button. Pressing the third notch puts the
      // layer straight on three; pressing the notch a row is already on
      // clears it. Stepping a row from five to nothing was five presses, and
      // with ten rows on the panel nobody did it.
      const notches = [];
      const bar = el('span', { class: 'bar', title: T.shareBarTip });
      for (let i = 1; i <= cfg.horde.maxWeight; i++) {
        const n = el('button', { class: 'step', title: T.shareBarTip,
          onclick: () => actions.setWeightAt(key, currentWeight(key) === i ? 0 : i) });
        notches.push(n);
        bar.appendChild(n);
      }
      const meta = el('i');
      const rate = el('small', { class: 'rate', title: T.rowRateTip });
      const tag = el('span', { class: 'seam', text: isFace ? '' : seamTag(key) });
      const less = el('button', { class: 'w', text: T.shareLess, title: T.shareLessTip, onclick: () => actions.setWeight(key, -1) });
      const more = el('button', { class: 'w', text: T.shareMore, title: T.shareMoreTip, onclick: () => actions.setWeight(key, 1) });
      const head = el('div', { class: 'wtop' },
        el('span', { class: 'swatch', style: 'background:' + hue }),
        el('span', { class: 'name', text: name, title: isFace ? T.faceLine : seamLine(key) }),
        tag, less, bar, more, meta);
      head.firstChild.style.background = hue;
      // Under the way down: every layer below it the player can already see,
      // so buying the reading five layers ahead shows five layers here.
      const ahead = isFace ? el('small', { class: 'ahead' }) : null;
      const row = el('div', { class: 'wrow' + (isFace ? ' face' : '') }, head, rate, ahead);
      nodes.weights.appendChild(row);
      weightRows.set(key, { node: row, bar, notches, meta, tag, rate, less, more, ahead, nameEl: head.childNodes[1] });
    }
  };

  // One control, and it is optional in both directions: the game splits the
  // diggers on its own and this hands that over to somebody who wants to.
  let handOver = null;
  const buildHandOver = () => {
    if (handOver || !nodes.handOver) return;
    const note = el('span', { class: 'lbl' });
    handOver = el('button', { onclick: () => actions.setByHand(!sim.state.byHand) });
    nodes.handOver.appendChild(note);
    nodes.handOver.appendChild(handOver);
    handOver._note = note;
  };
  const paintHandOver = () => {
    if (!handOver) return;
    const byHand = !!sim.state.byHand;
    handOver.textContent = byHand ? T.autoOn : T.autoOff;
    handOver.title = byHand ? T.autoOnTip : T.autoOffTip;
    handOver._note.textContent = byHand ? T.autoNoteHand : T.autoNoteGame;
  };

  // The one line that stands for every layer nobody is digging any more.
  let spentLine = null, spentButton = null;
  const buildSpent = () => {
    if (spentLine || !nodes.spent) return;
    spentLine = el('span', { class: 'lbl' });
    spentButton = el('button', { onclick: () => { showSpent = !showSpent; prefs().showSpent = showSpent; if (actions.savePrefs) actions.savePrefs(); render(); } });
    nodes.spent.appendChild(spentLine);
    nodes.spent.appendChild(spentButton);
  };
  const paintSpent = (split) => {
    if (!spentLine) return;
    const s = sim.state;
    const from = sim.activeFrom();
    let n = 0, worth = 0;
    for (let k = from; k <= s.depth; k++) {
      if ((split.strata[k] || 0) > 1e-9) continue;
      n++;
      const id = 's' + k;
      const held = sim.held(id);
      if (held > 0) worth += sim.quote(id, held);
    }
    // By hand every row is the player's business, so nothing folds.
    const on = n > 0 && !s.byHand;
    show(nodes.spent, on);
    if (!on) return;
    spentLine.textContent = worth > 0.005
      ? fill(T.spentWorth, { n: n, coin: fmtCoin(worth) })
      : fill(T.spent, { n: n });
    spentButton.textContent = showSpent ? T.spentHide : T.spentShow;
  };

  const currentWeight = (key) =>
    (key === 'face' ? sim.state.faceWeight : sim.state.weights[key]) | 0;

  // -- the market ----------------------------------------------------------

  const marketRows = new Map(); // id -> row parts
  let lesserRow = null;

  /**
   * Which materials get a row of their own, deepest first, bones last.
   *
   * A row for something nobody is bringing up any more, with under a unit of
   * it left on hand, is a picture of a finished layer: it goes in with the
   * older ones on a single line instead of taking a row of the table.
   */
  const rowIds = () => {
    const from = sim.activeFrom();
    const split = sim.split();
    const own = [];
    const lesser = [];
    for (const id of sim.goods()) {
      if (id === Mat.BONES) continue;
      const k = Mat.strataOf(id);
      const done = !sim.state.byHand && k < sim.state.depth
        && !((split.strata[k] || 0) > 1e-9) && sim.held(id) < 1;
      if (k >= from && !done) own.push(id); else lesser.push(id);
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
    // What the market takes and how fast it forgets sits under the demand
    // column. Under "Stock" it read as units on hand, which it is not.
    const takes = el('small', { class: 'ledger', hidden: true, title: T.ledgerTakesTip });
    held.appendChild(el('b'));
    const hot = el('small', { class: 'sat', hidden: true, title: T.ceilingTip });
    const tag = k >= 0 ? seamTag(k) : '';
    const nameCell = el('td', { class: 'good' },
      el('span', { class: 'swatch', style: 'background:' + good.hue }),
      el('span', { text: Lore.label(good.name) }),
      tag ? el('small', { class: 'seam', text: tag, title: seamLine(k) }) : null,
      hot);
    nameCell.firstChild.style.background = good.hue;
    const tr = el('tr', null, nameCell, held, price, el('td', { class: 'chart' }, spark.svg, demand, takes), buttons);
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
        // What one press of Buy costs, worked out on the same terms the
        // action uses. A button that can spend half a purse says the figure.
        const q = absorb * cfg.market.buyShare;
        row.buy.title = fill(T.buyTip, { n: fmt(q), coin: fmtCoin(Mk.quoteBuy(m, q, t, md)) });
        // Bones are raised, not sold by the ton, so their thin market is not
        // flagged as choking.
        const choking = sat > (T.ceilingAt || 1) && id !== Mat.BONES;
        row.hot.textContent = choking ? fill(T.ceilingLine, { x: overBy(sat) }) : '';
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
      lesserRow.name.title = T.lesserTip;
      // Nothing left on hand is nothing to say, not "worth about 0".
      lesserRow.meta.textContent = value > 0.005 ? fill(T.lesserWorth, { coin: fmtCoin(value) }) : '';
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
      const button = el('button', { class: 'rite', onclick: () => actions.buyRite(def.id, riteCount(def.id)) }, el('b', { text: words.name }), cost);
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
  let lastingSaid = '';
  const renderVisitor = () => {
    const s = sim.state;
    const v = s.visitor;
    // What an earlier caller handed over for a while, with the time it has
    // left, under whoever is at the gate now.
    const lasting = [];
    for (const sp of (Array.isArray(s.spells) ? s.spells : [])) {
      if (!sp || !(s.t < sp.until)) continue;
      const words = Lore.visitor(sp.from);
      if (words && words.lasting) lasting.push(fill(words.lasting, { x: sp.factor, t: fmtTime(Math.ceil(sp.until - s.t)) }));
    }
    const said = lasting.join(' ');
    if (nodes.visitorAfter && said !== lastingSaid) { lastingSaid = said; nodes.visitorAfter.textContent = said; }
    show(nodes.visitorAfter, lasting.length > 0);
    show(nodes.visitorPanel, !!v || lasting.length > 0);
    show(nodes.visitorText, !!v);
    show(nodes.visitorActs, !!v);
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

  /**
   * What an offer is worth, worked out from the run as it stands, so both
   * sides of a choice are read on the same axis. Without it a room asks a
   * player to weigh "everything cuts faster" against "the cut goes down
   * without shoring", which are two pictures and no figures.
   */
  const offerGain = (boon) => {
    if (!boon) return '';
    const E = T.effects;
    const parts = [];
    for (const key of Object.keys(boon)) {
      const v = boon[key];
      if (key === 'windfall') {
        const coin = sim.steadyIncome() * Math.min(v, cfg.chambers.windfallCap);
        if (coin > 0) parts.push(fill(E.windfall, { coin: fmtCoin(coin) }));
      } else if (key === 'diggers') {
        const n = Math.max(1, Math.floor(sim.growthOver(v * cfg.chambers.diggerSeconds)));
        parts.push(fill(E.diggers, { n: fmtCount(n) }));
      } else if (key === 'rem') {
        parts.push(fill(E.rem, { n: fmt(v) }));
      } else if (E[key]) {
        parts.push(E[key] + ' +' + Math.round((v - 1) * 100) + '%');
      }
    }
    return parts.join(', ');
  };

  let chamberKey = '';
  const renderChamber = () => {
    const c = sim.state.chamber;
    show(nodes.chamberPanel, !!c);
    if (!c) { chamberKey = ''; return; }
    const key = 'k' + c.k + ':' + (c.kind || 'room');
    if (key === chamberKey) return;
    chamberKey = key;
    if (nodes.chamberPanel) {
      nodes.chamberPanel.className = 'panel' + (c.kind === 'lord' ? ' lord' : '');
      // A lord's scene wears his colour.
      const def = c.kind === 'lord' && cfg.lords ? cfg.lords.list[c.lord] : null;
      if (nodes.chamberPanel.style) nodes.chamberPanel.style.borderLeftColor = def ? def.color : '';
      if (nodes.chamberTitle && nodes.chamberTitle.style) nodes.chamberTitle.style.color = def ? def.color : '';
    }
    if (nodes.chamberTitle) nodes.chamberTitle.textContent = c.title;
    clear(nodes.chamberText);
    for (const l of c.lines) nodes.chamberText.appendChild(el('p', { text: l }));
    clear(nodes.chamberOffers);
    for (const offer of c.offers) {
      const gain = offerGain(offer.boon);
      nodes.chamberOffers.appendChild(el('div', { class: 'offer' },
        el('button', { text: offer.name, onclick: () => actions.takeOffer(offer.i) }),
        el('span', { class: 'line' }, offer.line, gain ? el('b', { text: gain }) : null)));
    }
  };

  // -- the seal ------------------------------------------------------------

  const oathRows = new Map();
  let sealArmed = false;
  let sealButton = null;

  // Which of the two lists the right-hand panel is showing. Relics buy things
  // nobody buys unless they can see them, and the list used to sit at the
  // bottom of a column three screens tall.
  let panelTab = prefs().tab === 'oaths' ? 'oaths' : 'rites';
  const paintTabs = () => {
    const on = (node, yes) => { if (node) node.setAttribute('aria-pressed', String(yes)); };
    on(nodes.tabRites, panelTab === 'rites');
    on(nodes.tabOaths, panelTab === 'oaths');
    show(nodes.riteBulk, panelTab === 'rites');
    show(nodes.rites, panelTab === 'rites');
    show(nodes.oaths, panelTab === 'oaths');
    show(nodes.oathsNote, panelTab === 'oaths');
    show(nodes.standing, panelTab === 'oaths');
  };
  const pickTab = (t) => { panelTab = t; prefs().tab = t; paintTabs(); if (actions.savePrefs) actions.savePrefs(); };
  if (nodes.tabRites) nodes.tabRites.addEventListener('click', () => pickTab('rites'));
  if (nodes.tabOaths) nodes.tabOaths.addEventListener('click', () => pickTab('oaths'));

  // With the rank for it, the second press does not fill the barrow in: it
  // offers the hills the next one can be dug in, and picking one does.
  let hillRow = null;
  const buildHills = () => {
    const choices = sim.hillChoices();
    dropHills();
    if (!choices.length) return false;
    hillRow = el('div', { class: 'hills' }, el('p', { class: 'lbl', text: Lore.hills().pick }));
    for (const id of choices) {
      const w = Lore.hill(id);
      hillRow.appendChild(el('div', { class: 'offer' },
        el('button', { class: 'seal', text: w.name, title: w.line, onclick: () => actions.seal(id) }),
        el('span', { class: 'line', text: w.line })));
    }
    nodes.sealActs.appendChild(hillRow);
    return true;
  };

  const dropHills = () => {
    if (hillRow && hillRow.parentNode) hillRow.parentNode.removeChild(hillRow);
    hillRow = null;
  };

  const buildSeal = () => {
    if (sealButton || !nodes.sealActs) return;
    const words = Lore.seal();
    sealButton = el('button', { class: 'seal', text: words.button, onclick: () => {
      if (!sealArmed) {
        sealArmed = true;
        // With hills on offer, picking one is the confirmation and this
        // button becomes the way back out.
        sealButton.textContent = buildHills() ? words.notYet : words.confirm;
        return;
      }
      if (hillRow) { sealArmed = false; sealButton.textContent = words.button; dropHills(); return; }
      actions.seal();
    } });
    nodes.sealActs.appendChild(sealButton);
  };

  // What relics buy. It lives on its own tab and arrives with the first
  // relic, which a first barrow now earns long before it can be filled in.
  const buildOaths = () => {
    if (oathRows.size || !nodes.oaths) return;
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
        ? words.ready + ' ' + fill(words.yieldNow, { n: fmt(sim.sealYield()) })
        : fill(words.locked, { depth: cfg.seal.unlockDepth + 1 });
    }
    if (sealButton) {
      sealButton.disabled = !ready;
      if (!ready && sealArmed) {
        sealArmed = false; sealButton.textContent = words.button;
        dropHills();
      }
    }
  };

  const renderOaths = () => {
    const legacy = sim.legacy;
    const words = Lore.seal();
    buildOaths();
    let affordable = 0;
    for (const r of oathRows.values()) {
      const lv = Rb.oathLevel(legacy, r.def.id);
      const done = Rb.oathMaxed(legacy, r.def);
      const can = Rb.canBuyOath(legacy, r.def);
      if (can) affordable++;
      r.cost.textContent = done ? T.bought : fmt(Rb.oathCost(r.def, lv));
      r.button.disabled = done || !can;
      r.level.textContent = lv > 0 ? 'lv ' + lv : '';
    }
    // Nothing carries over until a barrow has been closed, so the list and
    // its tab arrive together with the first one.
    const carried = legacy.seals > 0 || legacy.remembrance > 0 || (legacy.renown || 0) > 0;
    show(nodes.tabOaths, carried);
    if (!carried && panelTab === 'oaths') { panelTab = 'rites'; paintTabs(); }
    if (nodes.oathsNote) nodes.oathsNote.textContent = words.oathsNote;
    // The count on the tab is the whole reason a player opens it. Without a
    // figure on the furniture, relics are banked and never spent.
    if (nodes.tabOathsCount) {
      nodes.tabOathsCount.textContent = affordable > 0 ? fmt(legacy.remembrance) : '';
    }
  };

  // -- the goal ------------------------------------------------------------

  /**
   * The next lord's door, always named: how many layers are left to it, and
   * once the dig is on it, how far through. Under it, what the lord whose
   * layers the dig is in does to them.
   */
  let goalSaid = '';
  const renderGoal = () => {
    if (!nodes.goal || !cfg.lords) return;
    const s = sim.state;
    const on = s.flags.face || s.depth > 0;
    show(nodes.goal, on);
    if (!on) return;
    const G = T.goal;
    const doorK = Lords.doorLayer(Lords.realmOf(s.depth, cfg), cfg);
    const door = sim.ground.at(doorK).door;
    const name = Lords.shortName(door.lord);
    const left = doorK - 1 - s.depth;
    let text, pct = 0;
    if (left <= 0) {
      const cap = sim.ground.at(doorK).cap;
      pct = cap > 0 ? Math.max(0, Math.min(1, s.capProgress / cap)) : 0;
      text = fill(G.at, { name, pct: fmtPct(pct) });
    } else if (left === 1) {
      text = fill(G.one, { name });
    } else {
      text = fill(G.ahead, { name, n: doorK, m: left });
    }
    if (text !== goalSaid) { goalSaid = text; nodes.goalSay.textContent = text; nodes.goal.title = G.tip; }
    // The goal wears the colour of the lord it names.
    const hue = door.lord.def.color || '';
    if (nodes.goal.style && nodes.goal.style.borderLeftColor !== hue) nodes.goal.style.borderLeftColor = hue;
    if (nodes.goalBar) {
      if (!nodes.goalFill) { clear(nodes.goalBar); nodes.goalFill = el('span'); nodes.goalBar.appendChild(nodes.goalFill); }
      show(nodes.goalBar, left <= 0);
      nodes.goalFill.style.width = Math.round(pct * 100) + '%';
      nodes.goalFill.style.background = hue;
    }
    if (nodes.goalRule) {
      const here = sim.ground.at(s.depth).lord;
      const words = here ? Lore.lord(here.id) : null;
      const rule = words ? fill(G.rule, { name: Lords.shortName(here), line: words.rule }) : '';
      if (nodes.goalRule.textContent !== rule) nodes.goalRule.textContent = rule;
      // The hill this barrow is dug in, when it has a twist.
      if (!nodes.goalHill) { nodes.goalHill = el('small', { class: 'hill' }); nodes.goal.appendChild(nodes.goalHill); }
      const hw = s.hill ? Lore.hill(s.hill) : null;
      const hillLine = hw ? fill(Lore.hills().here, { name: hw.name, line: hw.line }) : '';
      if (nodes.goalHill.textContent !== hillLine) nodes.goalHill.textContent = hillLine;
      show(nodes.goalHill, !!hw);
    }
  };

  // -- the ending card --------------------------------------------------------

  /**
   * The barrow just filled in, summed up at the top of the next one: how deep
   * it got against the best, the lords it broke, what it paid and the rank it
   * left, until the player moves on.
   */
  let endingShown = false;
  const renderEnding = () => {
    if (!nodes.ending) return;
    const s = sim.state;
    const b = s.ending && sim.legacy.barrows && sim.legacy.barrows[0];
    show(nodes.ending, !!b);
    if (!b) { endingShown = false; return; }
    if (endingShown) return;
    endingShown = true;
    const E = Lore.seal().ending;
    const best = ((sim.legacy.best && sim.legacy.best.depth) || 0) + 1;
    clear(nodes.ending);
    nodes.ending.appendChild(el('h2', { text: fill(E.title, { n: b.n }) }));
    nodes.ending.appendChild(el('p', { text: b.depth >= best ? fill(E.best, { depth: b.depth }) : fill(E.depth, { depth: b.depth, best }) }));
    nodes.ending.appendChild(el('p', { text: b.lords > 0 ? fill(E.lords, { n: b.lords }) : E.noLords }));
    const rk = Ranks.standing(sim.legacy, cfg);
    nodes.ending.appendChild(el('p', { text: fill(E.paid, { n: fmt(b.relics), rank: rk.name }) }));
    nodes.ending.appendChild(el('p', { class: 'dim', text: fill(E.totals, { coin: fmtCoin(b.coin), horde: fmtCount(b.horde) }) }));
    nodes.ending.appendChild(el('button', { text: E.button, onclick: () => actions.dismissEnding() }));
  };

  // -- rank and trophies ------------------------------------------------------

  /**
   * The top of the Kept forever tab: the rank and how far to the next, every
   * lord's trophy (a lord never met is a question mark), and what each rank
   * hands over. Rebuilt only when something in it changes.
   */
  let standingKey = '';
  const renderStanding = () => {
    if (!nodes.standing || !cfg.ranks) return;
    const legacy = sim.legacy;
    const st = Ranks.standing(legacy, cfg);
    const W = T.standing;
    const owned = Object.keys(legacy.trophies || {}).sort().join(',');
    const key = st.points + '|' + owned + '|' + panelTab + '|' + ((legacy.barrows || []).length);
    if (key === standingKey) return;
    standingKey = key;
    clear(nodes.standing);
    nodes.standing.appendChild(el('div', { class: 'rankline' }, el('b', { text: fill(W.rank, { n: st.n, name: st.name }) })));
    const bar = el('div', { class: 'rankbar' }, el('span'));
    bar.firstChild.style.width = Math.round(st.progress * 100) + '%';
    nodes.standing.appendChild(bar);
    nodes.standing.appendChild(el('small', { text: fill(W.next, { into: fmt(st.into), span: fmt(st.span), next: st.nextName }) }));
    if (st.nextKey) nodes.standing.appendChild(el('small', { text: fill(W.nextKey, { n: st.nextKey.rank, line: Lore.rankKey(st.nextKey.id) }) }));
    nodes.standing.appendChild(el('small', { text: W.how }));
    nodes.standing.appendChild(el('h3', { text: W.trophies }));
    const grid = el('div', { class: 'grid' });
    const ids = [cfg.lords.first].concat(cfg.lords.rotating, [cfg.lords.last]);
    for (const id of ids) {
      const words = Lore.lord(id);
      const have = !!(legacy.trophies && legacy.trophies[id]);
      const met = have || ((legacy.lordsMet || {})[id] > 0);
      // One cell a lord: his trophy, and what he hands over beside it, so the
      // two stay together however many columns the tab has room for.
      const cell = have
        ? el('div', { class: 'lordcell' }, el('div', { title: words.trophy.line }, el('b', { text: words.trophy.name }), ' - ' + words.trophy.line))
        : el('div', { class: 'off' }, el('b', { text: met ? words.trophy.name : W.unknown }), ' - ' + W.unmet);
      if (have && words.power) cell.appendChild(el('div', { title: words.power.line }, el('b', { text: words.power.name }), ' - ' + words.power.line));
      grid.appendChild(cell);
    }
    nodes.standing.appendChild(grid);
    nodes.standing.appendChild(el('h3', { text: W.keys }));
    const keys = el('div', { class: 'grid' });
    for (const k of cfg.ranks.keys) {
      const got = st.n >= k.rank;
      keys.appendChild(el('div', { class: got ? '' : 'off' }, el('b', { text: fill(W.atRank, { n: k.rank }) }), ' - ' + Lore.rankKey(k.id)));
    }
    nodes.standing.appendChild(keys);
    const rec = (legacy.barrows || []).slice(0, 8);
    if (rec.length) {
      const words = Lore.seal();
      nodes.standing.appendChild(el('h3', { text: words.recordTitle }));
      const list = el('div', { class: 'grid' });
      for (const b of rec) list.appendChild(el('div', { text: fill(words.record, { n: b.n, depth: b.depth, lords: b.lords, relics: fmt(b.relics) }) }));
      nodes.standing.appendChild(list);
    }
  };

  // -- the line at the top -------------------------------------------------

  // ONE node, built once and only ever retexted. A control rebuilt every frame
  // cannot be pressed by a mouse: the node under the pointer is replaced
  // between the press and the release.
  let compassTarget = null;
  let compassSaid = '';
  if (nodes.compassGo) {
    nodes.compassGo.textContent = T.compass.go;
    nodes.compassGo.addEventListener('click', () => {
      const id = compassTarget;
      if (!id) return;
      // The relics list is a tab, so pointing at it means opening it first.
      if (id === 'tab-oaths') { panelTab = 'oaths'; paintTabs(); }
      const node = byId(id === 'tab-oaths' ? 'rites-panel' : id);
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Whether a panel is out of the part of the page the player can see. */
  const offScreen = (id) => {
    if (!id) return false;
    const node = byId(id === 'tab-oaths' ? 'rites-panel' : id);
    if (!node || !node.getBoundingClientRect) return false;
    const r = node.getBoundingClientRect();
    if (!r.height && !r.width) return false;
    const h = (doc.documentElement && doc.documentElement.clientHeight) || 0;
    if (!h) return false;
    return r.top > h - 40 || r.bottom < 60;
  };

  const renderCompass = () => {
    if (!nodes.compassSay) return;
    let pick;
    try { pick = Advice.next(sim, cfg); } catch (e) { pick = null; }
    if (!pick) return;
    const line = fill(T.compass[pick.key] || '', pick.values);
    if (line !== compassSaid) { compassSaid = line; nodes.compassSay.textContent = line; }
    if (nodes.compass) nodes.compass.title = T.compass.tip;
    compassTarget = pick.target;
    // The button is offered only when it would actually take the player
    // somewhere: a panel off the bottom of the column, or the list of what
    // relics buy, which is on screen but behind a tab.
    const worth = pick.target === 'tab-oaths' ? panelTab !== 'oaths' : offScreen(pick.target);
    show(nodes.compassGo, !!pick.target && worth);
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
      st.depth.textContent = String(s.depth + 1) + ' ' + Lore.label(layer.name);
    }
    // Relics banked, and what this barrow would pay for being filled in right
    // now. Both belong in the strip: the second one is the reason to keep
    // digging and it used to be three screens down a scrolling column.
    if (st.rem) {
      const pending = sim.canSeal() ? sim.sealYield() : 0;
      st.rem.textContent = fmt(sim.legacy.remembrance) + (pending > 0 ? ' +' + fmt(pending) : '');
    }
    show(st.coinBox, s.totals.earned > 0 || s.coin > 0);
    show(st.incomeBox, s.totals.earned > 0 && s.horde > 0);
    show(st.bonesBox, f.raise);
    show(st.hordeBox, s.horde > 0);
    show(st.depthBox, f.face);
    show(st.remBox, sim.legacy.seals > 0 || sim.legacy.remembrance > 0);
    if (st.rank && cfg.ranks) {
      const rk = Ranks.standing(sim.legacy, cfg);
      if (st.rank.textContent !== rk.name) st.rank.textContent = rk.name;
      const lbl = fill(T.stats.rank, { n: rk.n });
      if (st.rankLabel && st.rankLabel.textContent !== lbl) st.rankLabel.textContent = lbl;
      show(st.rankBox, rk.points > 0);
    }

    // The hand.
    show(nodes.hand, !f.handHidden);
    show(nodes.sell, f.sell && !f.market);
    if (nodes.handline) {
      const soil = s.stock.s0 || 0;
      nodes.handline.textContent = soil > 0 && !f.market ? fmt(soil) + ' ' + Lore.label(sim.ground.at(0).name) : '';
    }

    renderEnding();
    renderChamber();
    renderVisitor();
    renderCompass();
    renderGoal();

    // The horde.
    show(nodes.hordePanel, f.raise);
    if (f.raise) {
      if (!raiseButtons.length) buildRaise();
      paintAutoRaise();
      const soft = md.softMult;
      for (const b of raiseButtons) {
        const n = b.count === 'max' ? H.maxRaisable(s.bones, s.horde, cfg.horde, soft) : b.count;
        const cost = H.raiseCostBulk(s.horde, n, cfg.horde, soft);
        // The counted buttons say what they cost; `max` says how many stand
        // up, which is a different kind of number and has to read like one.
        b.cost.textContent = b.count === 'max' ? (n > 0 ? '+' + fmtCount(n) : '-') : fmt(Math.ceil(cost * 10) / 10);
        b.node.disabled = !(n > 0) || cost > s.bones + 1e-9;
      }
      const split = sim.split();
      buildWeights(split);
      buildHandOver();
      buildSpent();
      const byHand = !!s.byHand;
      const rates = sim.layerRates();
      // The bar reads out where the diggers are. When the game is doing the
      // splitting it is a picture of a fraction, not a five-step setting, so
      // it is filled from the share itself and nothing on the row is a
      // button; a player who has taken it over gets the buttons back.
      let top = split.face;
      for (let k = sim.activeFrom(); k <= s.depth; k++) top = Math.max(top, split.strata[k] || 0);
      for (const [key, r] of weightRows) {
        const share = key === 'face' ? split.face : (split.strata[key] || 0);
        const w = byHand
          ? (key === 'face' ? s.faceWeight : (s.weights[key] || 0))
          : (top > 0 ? Math.ceil((share / top) * cfg.horde.maxWeight - 1e-9) : 0);
        for (let i = 0; i < r.notches.length; i++) {
          const on = i < w;
          r.notches[i].textContent = on ? '▌' : '·';
          r.notches[i].className = on ? 'step on' : 'step';
          r.notches[i].disabled = !byHand;
        }
        show(r.less, byHand); show(r.more, byHand);
        // What this layer is paying, so the picture and the figures agree.
        const rate = rates.get(key === 'face' ? 'face' : Number(key));
        if (rate) {
          const bits = [];
          if (rate.coin > 0.005) bits.push(fill(T.rowRate, { coin: fmtCoin(rate.coin) }));
          if (rate.bones > 0.005) bits.push(fill(T.rowBones, { bones: fmt(rate.bones) }));
          r.rate.textContent = bits.length ? bits.join('   ') : (share > 0 ? T.rowNothing : '');
          r.rate.className = 'rate' + (share > 0 && !bits.length ? ' hot' : '');
        }
        let meta = fmtPct(share);
        let hot = false;
        if (key === 'face' && r.nameEl) {
          // Breaking a lord's door is the row's whole meaning while it lasts.
          const door = sim.ground.at(s.depth + 1).door;
          const want = door ? fill(T.doorRow, { name: Lords.shortName(door.lord) }) : T.face;
          if (r.nameEl.textContent !== want) r.nameEl.textContent = want;
        }
        if (key === 'face') {
          // What is under the face, once the ground below has been read: the
          // seam of the floor being broken in the column the face row does not
          // otherwise use, and a line under the row naming every layer below
          // it that anything has read, as far down as that goes.
          const k = s.depth + 1;
          const known = [];
          if (md.assay || s.read[k]) known.push(k);
          for (let j = k + 1; known.length && j <= k + (cfg.view.aheadMax || 10) && s.read[j]; j++) known.push(j);
          r.tag.textContent = known.length ? seamTag(k) : '';
          if (r.ahead) {
            const names = known.map((j) => {
              const tag = seamTag(j);
              return Lore.label(sim.ground.at(j).name) + (tag ? ' (' + tag + ')' : '');
            });
            r.ahead.textContent = names.length ? fill(T.aheadLine, { list: names.join(', ') }) : '';
            show(r.ahead, names.length > 0);
          }
        } else if (md.ledger) {
          const sat = Mk.saturation(sim.marketFor('s' + key), sim.flowOf('s' + key), md);
          if (sat > (T.ceilingAt || 1)) { meta += ' - ' + fill(T.ceilingLine, { x: overBy(sat) }); hot = true; }
        }
        r.meta.textContent = meta;
        r.meta.className = hot ? 'hot' : '';
        r.meta.title = hot ? T.ceilingTip : '';
      }
      paintHandOver();
      paintSpent(split);
      show(nodes.handOver, f.face || s.depth > 0);
      show(nodes.weights, f.face || s.depth > 0);
    }

    // The market.
    show(nodes.marketPanel, f.market);
    if (f.market) { buildMarket(); renderMarket(); }

    // Rites, and beside them what relics buy.
    show(nodes.ritesPanel, f.rites);
    if (f.rites) { buildRiteBulk(); buildRites(); renderRites(); paintTabs(); paintAutoBuy(); }

    // The seal.
    show(nodes.sealPanel, f.seal);
    if (f.seal) { renderSeal(); paintAutoSeal(); }
    if (f.rites) renderOaths();
    renderStanding();

    if (nodes.fieldhint) show(nodes.fieldhint, !f.field);
  };

  const savedNote = (text) => { if (nodes.saved) nodes.saved.textContent = text; };

  return { render, log, say, savedNote, restore, lines };
}
