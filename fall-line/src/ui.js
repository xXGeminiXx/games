// ---------------------------------------------------------------------------
// The page: the panels, the header, the overlays.
//
// The ui reads the run through a small api and writes the page. It never
// changes the run itself; every button calls an action on the api. Text is
// only written when it changed, so a frame that changes nothing touches
// nothing.
// ---------------------------------------------------------------------------

import { fill } from '../config.js?v=4';
import { format } from './economy.js?v=4';
import { kindDef, costOf } from './works.js?v=4';
import { idsOf } from './traits.js?v=4';

const LOG_SHOWN = 8;

export function createUi(cfg, doc, win, api) {
  const t = cfg.text;
  const el = {};
  for (const id of ['ore', 'hearth', 'surge', 'best', 'speed', 'pause', 'call', 'hint', 'build', 'raise', 'cut',
    'earthcost', 'selinfo', 'upgrade', 'sell', 'forecast', 'log', 'awards', 'help', 'newrun', 'export', 'import',
    'helpbox', 'helptitle', 'helplines', 'helpclose', 'overbox', 'overtitle', 'overtext', 'overnew']) {
    el[id] = doc.getElementById(id);
  }
  const last = new Map();
  const put = (node, text) => {
    if (!node) return;
    const s = String(text);
    if (last.get(node) === s) return;
    last.set(node, s);
    node.textContent = s;
  };
  const setClass = (node, cls, on) => { if (node) node.classList.toggle(cls, !!on); };
  const setDisabled = (node, off) => { if (node && node.disabled !== !!off) node.disabled = !!off; };
  const clear = (node) => { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); };
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  };

  // ---- static furniture ---------------------------------------------------

  const speedButtons = [];
  clear(el.speed);
  for (const s of cfg.sim.speeds) {
    const b = make('button', '', s + 'x');
    b.addEventListener('click', () => api.setSpeed(s));
    if (el.speed) el.speed.appendChild(b);
    speedButtons.push({ s, b });
  }

  const buildButtons = [];
  clear(el.build);
  for (const def of cfg.works.kinds) {
    const b = make('button');
    const icon = glyphSvg(doc, def.glyph);
    if (icon) b.appendChild(icon);
    const name = make('b', '', def.name);
    const cost = make('i', '', '');
    b.appendChild(name);
    b.appendChild(cost);
    b.title = def.line;
    b.addEventListener('click', () => api.setTool('build', def.id));
    if (el.build) el.build.appendChild(b);
    buildButtons.push({ def, b, cost });
  }

  const awardRows = [];
  clear(el.awards);
  for (const a of cfg.awards) {
    const row = make('div', 'award');
    row.appendChild(make('span', '', a.name));
    row.appendChild(make('i', '', a.line));
    if (el.awards) el.awards.appendChild(row);
    awardRows.push({ a, row });
  }

  clear(el.helplines);
  if (el.helplines) for (const line of t.help) el.helplines.appendChild(make('p', '', line));
  put(el.helptitle, cfg.identity.name);
  put(el.overtitle, t.over);

  if (el.raise) el.raise.addEventListener('click', () => api.setTool('raise'));
  if (el.cut) el.cut.addEventListener('click', () => api.setTool('cut'));
  if (el.upgrade) el.upgrade.addEventListener('click', () => api.upgrade());
  if (el.sell) el.sell.addEventListener('click', () => api.sell());
  if (el.pause) el.pause.addEventListener('click', () => api.togglePause());
  if (el.call) el.call.addEventListener('click', () => api.callSurge());
  if (el.help) el.help.addEventListener('click', () => showHelp(true));
  if (el.helpclose) el.helpclose.addEventListener('click', () => showHelp(false));
  if (el.newrun) el.newrun.addEventListener('click', () => {
    if (win.confirm ? win.confirm(t.newRunSure) : true) api.newRun();
  });
  if (el.overnew) el.overnew.addEventListener('click', () => api.newRun());
  if (el.export) el.export.addEventListener('click', () => {
    const s = api.exportString();
    if (win.prompt) win.prompt(t.export, s);
  });
  if (el.import) el.import.addEventListener('click', () => {
    const s = win.prompt ? win.prompt(t.import, '') : null;
    if (s) api.importString(s);
  });

  let helpOpen = false;
  if (el.helpbox) el.helpbox.hidden = true;
  if (el.overbox) el.overbox.hidden = true;
  function showHelp(on) {
    helpOpen = !!on;
    if (el.helpbox) el.helpbox.hidden = !helpOpen;
  }

  // ---- per-frame ----------------------------------------------------------

  let forecastKey = '';
  let logKey = '';
  let awardsKey = '';
  let overShown = false;

  function update() {
    const state = api.state();
    const meta = state.meta;
    const tool = api.tool();
    const hover = api.hover();

    put(el.ore, format(Math.floor(state.ore)));
    put(el.hearth, Math.max(0, Math.ceil(state.hearthHp)) + '/' + cfg.hearth.hp);
    setClass(el.hearth, 'low', state.hearthHp < cfg.hearth.hp * 0.3);
    put(el.surge, state.surge);
    put(el.best, meta.bestReached);

    for (const { s, b } of speedButtons) setClass(b, 'on', state.speed === s);
    put(el.pause, state.paused ? t.resume : t.pause);
    setClass(el.pause, 'on', state.paused);

    if (state.phase === 'countdown') {
      put(el.call, fill(t.callIn, { n: state.surge, s: Math.ceil(state.timer) }));
      setDisabled(el.call, false);
    } else if (state.phase === 'surge') {
      put(el.call, fill(t.calling, { n: state.surge, count: api.aliveSurge() + state.spawnLeft }));
      setDisabled(el.call, true);
    } else {
      put(el.call, t.over);
      setDisabled(el.call, true);
    }

    for (const { def, b, cost } of buildButtons) {
      const open = api.isUnlocked(def.id);
      const price = costOf(cfg, def, 1);
      setClass(b, 'locked', !open);
      setDisabled(b, !open);
      setClass(b, 'on', tool.type === 'build' && tool.kind === def.id);
      setClass(b, 'poor', open && price > state.ore);
      put(cost, open ? price : fill(t.locked, { n: def.unlock }));
    }
    setClass(el.raise, 'on', tool.type === 'raise');
    setClass(el.cut, 'on', tool.type === 'cut');

    // The earthworks line: the cost at the hovered cell for the active tool,
    // otherwise the general prices.
    if ((tool.type === 'raise' || tool.type === 'cut') && hover.cell >= 0) {
      const p = api.preview(tool.type, null, hover.cell);
      const h = state.terrain.h[hover.cell];
      if (p.reason === 'fixed') put(el.earthcost, 'This ground does not move.');
      else put(el.earthcost, (tool.type === 'raise' ? t.raise : t.cut) + ': ' + p.cost + ' ore, ' + h + ' to ' + p.height + (p.ok ? '' : ' - not enough ore'));
    } else {
      put(el.earthcost, t.raise + ' ' + cfg.economy.raiseBase + '+ ore a level, ' + t.cut.toLowerCase() + ' ' + cfg.economy.cutCost + ' ore.');
    }

    const sel = api.selected();
    if (sel) {
      const def = kindDef(cfg, sel.kind);
      const s = api.workStats(sel);
      const lines = [];
      lines.push(def.name + ' - ' + fill(t.tier, { t: sel.tier }) + (s.buffed ? ' - lit' : ''));
      if (s.dmg) lines.push('Damage ' + fmt1(s.dmg) + (s.rate ? ' x ' + fmt1(s.rate) + '/s' : ''));
      if (s.burnDps) lines.push('Burns ' + fmt1(s.burnDps) + '/s for ' + fmt1(s.burnSeconds) + 's');
      if (s.slow) lines.push('Slows ' + Math.round(s.slow * 100) + '% for ' + fmt1(s.slowSeconds) + 's');
      if (s.pull) lines.push('Drags ' + fmt1(s.pull) + ' cells/s');
      if (s.chain) lines.push('Chains ' + s.chain + ' times');
      if (s.splash) lines.push('Bursts ' + fmt1(s.splash) + ' wide');
      if (s.aura) lines.push('Lights works within ' + fmt1(s.aura));
      const hg = state.terrain.h[sel.cell];
      lines.push('Reach ' + fmt1(s.range) + (hg > 0 ? ' (high ground +' + Math.round(cfg.works.highGroundRange * hg * 100) + '%)' : ''));
      lines.push('Kills ' + sel.kills + ', dealt ' + format(Math.round(sel.dealt)));
      put(el.selinfo, lines.join('\n'));
      const next = sel.tier < cfg.works.maxTier ? costOf(cfg, def, sel.tier + 1) : null;
      put(el.upgrade, next === null ? t.upgrade + ' - top' : t.upgrade + ' ' + next);
      setDisabled(el.upgrade, next === null || next > state.ore || state.phase === 'over');
      put(el.sell, t.sell + ' +' + Math.floor(sel.spent * cfg.economy.sellRefund));
      setDisabled(el.sell, state.phase === 'over');
    } else {
      put(el.selinfo, t.nothing);
      put(el.upgrade, t.upgrade);
      put(el.sell, t.sell);
      setDisabled(el.upgrade, true);
      setDisabled(el.sell, true);
    }

    // The forecast, the log and the awards only change at surge ends.
    const fc = state.forecast;
    const fk = fc ? fc.title + '|' + fc.lines.map(l => l.cls + l.text).join('|') : '';
    if (fk !== forecastKey) {
      forecastKey = fk;
      clear(el.forecast);
      if (fc && el.forecast) {
        for (const line of fc.lines) {
          el.forecast.appendChild(make('div', line.cls || 'dim', line.text));
        }
      }
    }

    const shown = state.log.slice(-LOG_SHOWN);
    const lk = shown.map(l => l.cls + l.text).join('|');
    if (lk !== logKey) {
      logKey = lk;
      clear(el.log);
      if (el.log) for (const l of shown) el.log.appendChild(make('div', l.cls === 'ink' ? 'ink' : '', l.text));
    }

    const ak = meta.awards.join(',');
    if (ak !== awardsKey) {
      awardsKey = ak;
      for (const { a, row } of awardRows) setClass(row, 'won', meta.awards.includes(a.id));
    }

    // The hint line under the field.
    put(el.hint, hintText(state, tool, hover));

    // The run-over card.
    if (state.phase === 'over' && !overShown) {
      overShown = true;
      clear(el.overtext);
      if (el.overtext) for (const line of api.summary()) el.overtext.appendChild(make('p', 'ink', line));
      if (el.overbox) el.overbox.hidden = false;
    } else if (state.phase !== 'over' && overShown) {
      overShown = false;
      if (el.overbox) el.overbox.hidden = true;
    }
  }

  function hintText(state, tool, hover) {
    if (state.phase === 'over') return t.over;
    if (hover.cell < 0) {
      if (tool.type === 'build') {
        const def = kindDef(cfg, tool.kind);
        return def ? def.name + ': ' + def.line : '';
      }
      if (tool.type === 'raise') return t.raise + ': click or drag on the ground. Right click to stop.';
      if (tool.type === 'cut') return t.cut + ': click or drag on the ground. Right click to stop.';
      if (state.surge === 1 && state.phase === 'countdown') return t.firstLine;
      return '';
    }
    const h = state.terrain.h[hover.cell];
    const kind = state.terrain.kind[hover.cell];
    const where = kind === 1 ? t.snowline : kind === 2 ? t.hearth : 'height ' + h;
    if (tool.type === 'build') {
      const def = kindDef(cfg, tool.kind);
      const p = api.preview('build', tool.kind, hover.cell);
      if (!def) return '';
      if (p.reason === 'fixed') return def.name + ': not on the ' + where + '.';
      if (p.reason === 'occupied') return def.name + ': something stands here.';
      if (p.reason === 'ore') return def.name + ': ' + p.cost + ' ore, you have ' + Math.floor(state.ore) + '.';
      return def.name + ' here for ' + p.cost + ' ore on ' + where + (h > 0 ? ', reach +' + Math.round(cfg.works.highGroundRange * h * 100) + '%' : '') + '.';
    }
    if (tool.type === 'raise' || tool.type === 'cut') {
      const p = api.preview(tool.type, null, hover.cell);
      if (p.reason === 'fixed') return 'The ' + where + ' does not move.';
      return (tool.type === 'raise' ? t.raise : t.cut) + ' to ' + p.height + ' for ' + p.cost + ' ore' + (p.ok ? '.' : ' - not enough ore.');
    }
    const w = api.workAt(hover.cell);
    if (w) {
      const def = kindDef(cfg, w.kind);
      return def.name + ', ' + fill(t.tier, { t: w.tier }).toLowerCase() + ', on ' + where + '. Click to select.';
    }
    return where.charAt(0).toUpperCase() + where.slice(1) + '.';
  }

  const fmt1 = (v) => (Math.round(v * 10) / 10).toString();

  return { update, showHelp, isHelpOpen: () => helpOpen, el };
}


/** The outline of a work's glyph as a small inline drawing for the tray. */
const GLYPH_PATHS = {
  triangle: 'M11 3 L20 19 L2 19 Z',
  square:   'M4 4 H18 V18 H4 Z',
  hexagon:  'M11 2 L19 6.5 V15.5 L11 20 L3 15.5 V6.5 Z',
  asterisk: 'M11 2 V20 M2 6.5 L20 15.5 M20 6.5 L2 15.5',
  diamond:  'M11 2 L20 11 L11 20 L2 11 Z',
  ring:     'M11 3 A8 8 0 1 0 11.01 3 Z M11 8 A3 3 0 1 0 11.01 8 Z',
  star:     'M11 2 L13.4 8.2 L20 8.6 L14.9 12.8 L16.6 19.2 L11 15.6 L5.4 19.2 L7.1 12.8 L2 8.6 L8.6 8.2 Z',
};

function glyphSvg(doc, glyph) {
  if (typeof doc.createElementNS !== 'function') return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', GLYPH_PATHS[glyph] || GLYPH_PATHS.square);
  svg.appendChild(path);
  return svg;
}

/** Names of the traits in a mask, for anything outside the forecast. */
export function traitList(cfg, mask) {
  return idsOf(mask).map(id => cfg.melt.mutations[id].name).join(', ');
}
