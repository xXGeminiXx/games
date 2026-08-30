// The chart table: a column of glass cards on the right. Everything the
// player reads or presses is here; nothing is drawn on the canvas as text.
import { fmt, rate, count, pct } from './numbers.js?v=18';
import { fill } from '../content.js?v=18';

export function createUI(doc, cfg, content, eco, on) {
  const $ = (id) => doc.getElementById(id);
  const K = cfg.kindOrder;
  const el = {
    funds: $('funds'), income: $('income'), drones: $('drones'), working: $('working'),
    target: $('target'), hire: $('hire'), hireCost: $('hire-cost'), hireLabel: $('hire-label'),
    bulk: $('bulk'), wing: $('wing'), wingCost: $('wing-cost'),
    hold: $('hold'), holdRows: $('hold-rows'), fleet: $('fleet'), specialists: $('specialists'), specRows: $('spec-rows'),
    carrier: $('carrier'), upRows: $('up-rows'), voyage: $('voyage'), island: $('island'), remaining: $('remaining'),
    castOff: $('castoff'), castOffCost: $('castoff-cost'), log: $('log'), anchorHint: $('anchor-hint'),
    exportBtn: $('export'), importBtn: $('import'), resetBtn: $('reset'), saveBox: $('savebox'), range: $('range'),
    fold: $('fold'), quality: $('quality'), rateOut: $('rate'), perfBtn: $('perf'), keysBtn: $('keys'), keyHelp: $('keyhelp'), keyRows: $('key-rows'), keyClose: $('keyclose'),
    specWarn: $('spec-warn'), rangeRow: $('range-row'),
  };
  const L = content.labels;

  // Every heading and static label in the page names its string in content
  // with data-t, so a word is written once and the page cannot drift from it.
  for (const node of doc.querySelectorAll('[data-t]')) {
    const s = node.getAttribute('data-t').split('.').reduce((o, k) => (o == null ? o : o[k]), content);
    if (typeof s === 'string') node.textContent = s;
  }

  // ---- build the rows once ----
  const row = (parent, html) => { const d = doc.createElement('div'); d.className = 'row'; d.innerHTML = html; parent.appendChild(d); return d; };
  const holdRows = {}, specRows = {}, upRows = {};
  for (const k of K) {
    holdRows[k] = row(el.holdRows, `<span class="k">${content.kinds[k]}</span><span class="v" data-y></span><span class="v" data-p></span><span class="v dim" data-pct></span>`);
    holdRows[k].title = fill(L.where, { kind: content.kinds[k], where: cfg.kinds[k].where });
  }
  for (const k of K) {
    specRows[k] = row(el.specRows, `<button data-spec="${k}"><b>${fill(L.specialist, { kind: content.kinds[k] })}</b><i data-cost></i></button><span class="v" data-n></span>`);
    specRows[k].title = fill(content.hints.specialist, { kind: content.kinds[k], x: cfg.economy.specialistMult });
    specRows[k].querySelector('button').addEventListener('click', () => { on.specialist(k, countFor('specialist', k)); paintHire(); });
  }
  for (const u in cfg.economy.upgrades) {
    const U = cfg.economy.upgrades[u];
    upRows[u] = row(el.upRows, `<button data-up="${u}"><b>${U.name}</b><i data-cost></i></button><span class="v" data-lvl></span>`);
    upRows[u].title = U.does;
    upRows[u].querySelector('button').addEventListener('click', () => { on.upgrade(u, countFor('upgrade', u)); paintHire(); });
  }
  if (el.rangeRow) el.rangeRow.title = content.hints.range;
  // How many a press buys. Remembered, because a player who has decided to
  // buy a thousand at a time has decided it for the rest of the run.
  let bulk = cfg.bulk.start;
  const bulkButtons = [];
  if (el.bulk) {
    for (const n of cfg.bulk.steps) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = n === 0 ? (content.labels.bulkMax || 'max') : ('x' + count(n));
      b.addEventListener('click', () => { bulk = n; paintBulk(); paintHire(); });
      el.bulk.appendChild(b);
      bulkButtons.push({ n, b });
    }
  }
  const paintBulk = () => {
    for (const { n, b } of bulkButtons) b.setAttribute('aria-pressed', String(n === bulk));
  };
  /**
   * The hire button, and which quantities are within reach. Called both from
   * the frame update and the moment a quantity is chosen - without the second,
   * the button keeps the old count and its old price until the next tick, so
   * choosing a thousand appears to do nothing.
   */
  const paintHire = () => {
    if (!el.hire) return;
    const many = bulkCount();
    if (el.hireCost) el.hireCost.textContent = fmt(eco.actions.hire.cost(many));
    if (el.hireLabel) el.hireLabel.textContent = many === 1 ? L.hire : fill(L.hireMany, { n: count(many) });
    el.hire.disabled = !eco.actions.hire.can(many);
    for (const { n, b } of bulkButtons) b.disabled = n !== 0 && !eco.actions.hire.can(n);
  };
  paintBulk();
  /** How many the next press would buy: the chosen number, or all that is affordable. */
  const bulkCount = () => (bulk === 0 ? Math.max(1, eco.actions.hire.max()) : bulk);
  /**
   * The same choice, asked of any action that can be bought more than once.
   * `max` means as many as that particular thing allows, which is not the same
   * number for a drone, a specialist and an upgrade - each has its own ceiling.
   */
  const countFor = (name, arg) => {
    const a = eco.actions[name];
    if (bulk !== 0) return bulk;
    return Math.max(1, a && a.max ? a.max(arg) : 1);
  };

  el.hire.addEventListener('click', () => { on.hire(bulkCount()); paintHire(); });
  el.wing.addEventListener('click', on.wing);
  el.castOff.addEventListener('click', on.castOff);
  el.exportBtn.addEventListener('click', on.exportSave);
  el.importBtn.addEventListener('click', on.importSave);
  el.resetBtn.addEventListener('click', on.reset);
  // ---- the view card: how sharp the picture is, and how it is running ----
  const qualityBtns = {};
  for (const name of cfg.render.presetOrder) {
    const preset = cfg.render.presets[name];
    if (!preset) continue;
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.quality = name;
    b.title = preset.hint || '';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<b>${preset.name}</b>`;
    b.addEventListener('click', () => on.quality(name));
    el.quality.appendChild(b);
    qualityBtns[name] = b;
  }
  el.quality.title = content.hints.quality;

  // WHAT THE PICTURE IS TRADED AGAINST. The detail buttons say how much to
  // draw; this says how often. They are separate because the trade between
  // them is the player's to make, not a single dial someone else decided.
  const targetBtns = {};
  for (const fps of cfg.render.targets) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.innerHTML = `<b>${fps > 0 ? fps : (L.targetFree || 'as many as it can')}</b>`;
    b.addEventListener('click', () => on.target(fps));
    el.target.appendChild(b);
    targetBtns[fps] = b;
  }
  const showTarget = (fps) => {
    for (const k in targetBtns) targetBtns[k].setAttribute('aria-pressed', String(Number(k) === Number(fps)));
  };

  // The chosen preset is the pressed one; auto also reports where it settled.
  const showQuality = (name, scale, hz) => {
    for (const k in qualityBtns) qualityBtns[k].setAttribute('aria-pressed', String(k === name));
    if (!cfg.render.showRate) { el.rateOut.textContent = ''; return; }
    if (!(hz > 0)) { el.rateOut.textContent = ''; return; }
    const vars = { n: Math.round(hz), pct: Math.round(scale * 100) + '%' };
    el.rateOut.textContent = fill(name === 'auto' ? L.rateAuto : L.rate, vars);
  };

  // ---- folding the table away ---------------------------------------------
  const showFold = (folded) => {
    doc.body.classList.toggle('folded', !!folded);
    el.fold.innerHTML = folded ? '<b>&lsaquo;</b>' : '<b>&rsaquo;</b>';
    const label = folded ? L.unfold : L.fold;
    el.fold.title = label;
    el.fold.setAttribute('aria-label', label);
    el.fold.setAttribute('aria-expanded', String(!folded));
    el.anchorHint.textContent = folded ? L.hintFolded : L.hint;
  };
  el.fold.addEventListener('click', on.fold);

  // ---- the key list, printed from the same table the keyboard reads -------
  const printKey = (k) => (content.keyLabels[k] || (k.length === 1 ? k.toUpperCase() : k));
  for (const group in content.keyGroups) {
    const h = doc.createElement('h2');
    h.textContent = content.keyGroupNames[group] || group;
    el.keyRows.appendChild(h);
    for (const action of content.keyGroups[group]) {
      const keys = cfg.keys[action];
      if (!keys || !keys.length) continue;
      const d = doc.createElement('div');
      d.className = 'krow';
      d.innerHTML = `<kbd></kbd><span></span>`;
      d.querySelector('kbd').textContent = keys.map(printKey).join(L.keySep);
      d.querySelector('span').textContent = content.keyNames[action] || action;
      el.keyRows.appendChild(d);
    }
  }
  const showKeys = (open) => { el.keyHelp.hidden = !open; };
  el.keysBtn.addEventListener('click', on.help);
  el.perfBtn.addEventListener('click', on.exportPerf);
  el.perfBtn.title = content.hints.perf;
  el.keyClose.addEventListener('click', on.closeHelp);

  el.hire.title = content.hints.hire;
  el.castOff.title = fill(content.hints.castOff, { x: cfg.economy.islandRichness, y: cfg.economy.islandPrice });

  // ---- the deck log: newest on top, bounded ----
  const log = (line) => {
    const p = doc.createElement('p');
    p.textContent = line;
    el.log.insertBefore(p, el.log.firstChild);
    while (el.log.children.length > 8) el.log.removeChild(el.log.lastChild);
  };

  const show = (node, yes) => { if (node) node.hidden = !yes; };
  // "timber", "timber and ice", "timber, fish and ice"
  const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  // ---- refresh every visible number ----
  const update = (view) => {
    const s = eco.state;
    el.funds.textContent = fmt(s.funds);
    el.income.textContent = rate(eco.revenue());
    el.drones.textContent = count(s.drones);
    const y = eco.yields();
    el.working.textContent = view.active < s.drones ? fill(L.shown, { n: count(view.active) }) : '';
    // A step nobody can reach yet is dimmed rather than hidden, so the row
    // does not change shape as funds climb.
    paintHire();
    show(el.wing, eco.level('hangars') >= cfg.reveal.wingsAtHangars);
    el.wing.querySelector('b').textContent = fill(L.hireWing, { n: cfg.economy.wingSize });
    el.wingCost.textContent = fmt(eco.wingCost());
    el.wing.disabled = !eco.actions.wing.can();
    const strandedKinds = [];
    for (const k of K) {
      const r = holdRows[k];
      r.querySelector('[data-y]').textContent = rate(y[k]);
      r.querySelector('[data-p]').textContent = fmt(eco.price(k));
      const p = eco.price(k) / (cfg.kinds[k].basePrice * eco.islandPrice());
      const pe = r.querySelector('[data-pct]');
      pe.textContent = pct(p);
      pe.className = 'v ' + (p < 0.5 ? 'bad' : p < 0.85 ? 'dim' : 'good');
      const sr = specRows[k];
      sr.querySelector('[data-cost]').textContent = fmt(eco.specialistCost());
      // What the land still holds of this kind. Income is multiplied by it, so
      // a kind worked down to nothing pays nothing however many drones are on
      // it - and without this the panel gave no sign of that at all, leaving
      // specialists assigned to a seam that had run out.
      const left = s.avail[k];
      const n = s.specialists[k];
      const ne = sr.querySelector('[data-n]');
      const stranded = !!(n && !(left > 0));
      if (stranded) strandedKinds.push(content.kinds[k]);
      ne.textContent = n ? count(n) : '';
      ne.className = 'v' + (stranded ? ' bad' : '');
      ne.title = stranded ? fill(L.workedOutOne, { kind: content.kinds[k] }) : '';
      const sn = countFor('specialist', k);
      sr.querySelector('[data-cost]').textContent = fmt(eco.actions.specialist.cost(k, sn));
      sr.querySelector('button').disabled = !eco.actions.specialist.can(k, sn);
      sr.querySelector('button').dataset.many = sn > 1 ? 'x' + count(sn) : '';
    }
    // A tooltip is no use to a player who does not know to hover. Specialists
    // are locked to one trade, so a trade with nothing left within reach earns
    // them nothing at all until the carrier is moved, and that has to be said
    // out loud where the specialists are bought.
    if (el.specWarn) {
      el.specWarn.hidden = strandedKinds.length === 0;
      el.specWarn.textContent = strandedKinds.length ? fill(L.workedOut, { kinds: list(strandedKinds) }) : '';
    }
    for (const u in cfg.economy.upgrades) {
      const r = upRows[u];
      const lvl = eco.level(u), max = cfg.economy.upgrades[u].max;
      r.querySelector('[data-cost]').textContent = lvl >= max ? L.maxed : fmt(eco.upgradeCost(u));
      r.querySelector('[data-lvl]').textContent = lvl ? fill(L.level, { n: lvl }) : '';
      const un = countFor('upgrade', u);
      r.querySelector('button').disabled = !eco.actions.upgrade.can(u, un);
      r.querySelector('button').dataset.many = un > 1 ? 'x' + count(un) : '';
    }
    el.island.textContent = fill(L.island, { n: s.island });
    el.remaining.textContent = pct(s.remaining);
    el.castOff.querySelector('b').textContent = fill(L.castOff, { n: s.island + 1 });
    el.castOffCost.textContent = fmt(eco.castOffCost());
    el.castOff.disabled = !eco.actions.castOff.can();
    el.range.textContent = fmt(eco.range());
  };

  // The view settings are not gated behind progress the way the game's own
  // panels are. A player whose machine cannot hold a frame needs the quality
  // control in the first minute, before anything could have unlocked it, so
  // hiding it until the game decides to offer it would keep it from the one
  // person who needs it. It sits below the deck log, under the game rather
  // than inside it, for the same reason the funds and fleet cards are always
  // there: it is part of the window, not part of the run.
  const reveal = (flags) => {
    show(el.hold, flags.hold);
    show(el.specialists, flags.specialists);
    show(el.carrier, flags.carrier);
    show(el.voyage, flags.voyage);
  };

  return { el, log, update, reveal, get bulk() { return bulk; }, show, showQuality, showTarget, showFold, showKeys, get keysOpen() { return !el.keyHelp.hidden; } };
}
