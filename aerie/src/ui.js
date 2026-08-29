// The chart table: a column of glass cards on the right. Everything the
// player reads or presses is here; nothing is drawn on the canvas as text.
import { fmt, rate, count, pct } from './numbers.js?v=1';
import { fill } from '../content.js?v=1';

export function createUI(doc, cfg, content, eco, on) {
  const $ = (id) => doc.getElementById(id);
  const K = cfg.kindOrder;
  const el = {
    funds: $('funds'), income: $('income'), drones: $('drones'), working: $('working'),
    hire: $('hire'), hireCost: $('hire-cost'), wing: $('wing'), wingCost: $('wing-cost'),
    hold: $('hold'), holdRows: $('hold-rows'), fleet: $('fleet'), specialists: $('specialists'), specRows: $('spec-rows'),
    carrier: $('carrier'), upRows: $('up-rows'), voyage: $('voyage'), island: $('island'), remaining: $('remaining'),
    castOff: $('castoff'), castOffCost: $('castoff-cost'), log: $('log'), anchorHint: $('anchor-hint'),
    exportBtn: $('export'), importBtn: $('import'), resetBtn: $('reset'), saveBox: $('savebox'), range: $('range'),
  };
  const L = content.labels;

  // ---- build the rows once ----
  const row = (parent, html) => { const d = doc.createElement('div'); d.className = 'row'; d.innerHTML = html; parent.appendChild(d); return d; };
  const holdRows = {}, specRows = {}, upRows = {};
  for (const k of K) {
    holdRows[k] = row(el.holdRows, `<span class="k">${content.kinds[k]}</span><span class="v" data-y></span><span class="v" data-p></span><span class="v dim" data-pct></span>`);
    holdRows[k].title = cfg.kinds[k].where;
  }
  for (const k of K) {
    specRows[k] = row(el.specRows, `<button data-spec="${k}"><b>${fill(L.specialist, { kind: content.kinds[k] })}</b><i data-cost></i></button><span class="v" data-n></span>`);
    specRows[k].querySelector('button').addEventListener('click', () => on.specialist(k));
  }
  for (const u in cfg.economy.upgrades) {
    const U = cfg.economy.upgrades[u];
    upRows[u] = row(el.upRows, `<button data-up="${u}"><b>${U.name}</b><i data-cost></i></button><span class="v" data-lvl></span>`);
    upRows[u].title = U.does;
    upRows[u].querySelector('button').addEventListener('click', () => on.upgrade(u));
  }
  el.hire.addEventListener('click', on.hire);
  el.wing.addEventListener('click', on.wing);
  el.castOff.addEventListener('click', on.castOff);
  el.exportBtn.addEventListener('click', on.exportSave);
  el.importBtn.addEventListener('click', on.importSave);
  el.resetBtn.addEventListener('click', on.reset);
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

  // ---- refresh every visible number ----
  const update = (view) => {
    const s = eco.state;
    el.funds.textContent = fmt(s.funds);
    el.income.textContent = rate(eco.revenue());
    el.drones.textContent = count(s.drones);
    const y = eco.yields();
    let working = 0;
    for (const k of K) working += y[k] > 0 ? 1 : 0;
    el.working.textContent = view.active < s.drones ? `${count(view.active)} shown` : '';
    el.hireCost.textContent = fmt(eco.hireCost());
    el.hire.disabled = !eco.actions.hire.can();
    show(el.wing, eco.level('hangars') >= cfg.reveal.wingsAtHangars);
    el.wing.querySelector('b').textContent = fill(L.hireWing, { n: cfg.economy.wingSize });
    el.wingCost.textContent = fmt(eco.wingCost());
    el.wing.disabled = !eco.actions.wing.can();
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
      sr.querySelector('[data-n]').textContent = s.specialists[k] ? count(s.specialists[k]) : '';
      sr.querySelector('button').disabled = !eco.actions.specialist.can(k);
    }
    for (const u in cfg.economy.upgrades) {
      const r = upRows[u];
      const lvl = eco.level(u), max = cfg.economy.upgrades[u].max;
      r.querySelector('[data-cost]').textContent = lvl >= max ? L.maxed : fmt(eco.upgradeCost(u));
      r.querySelector('[data-lvl]').textContent = lvl ? fill(L.level, { n: lvl }) : '';
      r.querySelector('button').disabled = !eco.actions.upgrade.can(u);
    }
    el.island.textContent = fill(L.island, { n: s.island });
    el.remaining.textContent = pct(s.remaining);
    el.castOffCost.textContent = fmt(eco.castOffCost());
    el.castOff.disabled = !eco.actions.castOff.can();
    el.range.textContent = fmt(eco.range());
  };

  const reveal = (flags) => {
    show(el.hold, flags.hold);
    show(el.specialists, flags.specialists);
    show(el.carrier, flags.carrier);
    show(el.voyage, flags.voyage);
  };

  return { el, log, update, reveal, show };
}
