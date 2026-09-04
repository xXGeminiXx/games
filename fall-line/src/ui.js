// ---------------------------------------------------------------------------
// The page: the panels, the header, the overlays.
//
// The ui reads the run through a small api and writes the page. It never
// changes the run itself; every button calls an action on the api. Text is
// only written when it changed, so a frame that changes nothing touches
// nothing.
// ---------------------------------------------------------------------------

import { fill } from '../config.js?v=11';
import { format, clearBonus, raiseCost } from './economy.js?v=11';
import { kindDef, costOf } from './works.js?v=11';
import { idsOf } from './traits.js?v=11';

const LOG_SHOWN = 8;

export function createUi(cfg, doc, win, api) {
  const t = cfg.text;
  const el = {};
  for (const id of ['ore', 'hearth', 'surge', 'best', 'speed', 'pause', 'call', 'hint', 'build', 'raise', 'cut',
    'earthcost', 'selinfo', 'upgrade', 'sell', 'forecast', 'log', 'awards', 'help', 'newrun', 'export', 'import',
    'helpbox', 'helptitle', 'helplines', 'helpclose', 'helpmore', 'overbox', 'overtitle', 'overtext', 'overnew']) {
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

  if (el.call && t.callHint) el.call.title = t.callHint;

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
  if (el.helpmore) el.helpmore.addEventListener('click', () => writeHelp(false));
  // A sheet with the field showing all round it invites a click beside it, and
  // a click that does nothing reads as a page that has stopped working.
  if (el.helpbox) el.helpbox.addEventListener('click', (ev) => { if (ev.target === el.helpbox) showHelp(false); });
  if (el.newrun) el.newrun.addEventListener('click', () => {
    if (win.confirm ? win.confirm(t.newRunSure) : true) api.newRun();
  });
  if (el.overnew) el.overnew.addEventListener('click', () => api.newRun());
  if (el.export) el.export.addEventListener('click', () => {
    const s = api.exportString();
    if (win.prompt) win.prompt(t.exportAsk || t.export, s);
  });
  if (el.import) el.import.addEventListener('click', () => {
    const s = win.prompt ? win.prompt(t.importAsk || t.import, '') : null;
    if (s) api.importString(s);
  });

  let helpOpen = false;
  if (el.helpbox) el.helpbox.hidden = true;
  if (el.overbox) el.overbox.hidden = true;

  /**
   * Fill the sheet. A player opening the game for the first time gets four
   * lines and a button, because a wall of rules in front of a field nobody has
   * seen yet is read by nobody; every other opening gets the whole thing. The
   * rest of the rules are one press away either way.
   */
  function writeHelp(opening) {
    clear(el.helplines);
    const lines = opening ? t.opening : t.help;
    if (el.helplines) for (const line of lines) el.helplines.appendChild(make('p', opening ? 'ink' : '', line));
    setClass(el.helpbox, 'full', !opening);
    put(el.helpclose, opening ? t.startButton : t.closeButton);
    if (el.helpmore) el.helpmore.hidden = !opening;
  }

  function showHelp(on, opening) {
    helpOpen = !!on;
    if (helpOpen) writeHelp(!!opening);
    if (el.helpbox) el.helpbox.hidden = !helpOpen;
    // Nothing attacks a player who is reading. The run is held while the sheet
    // is up and let go the moment it closes.
    if (api.holdRun) api.holdRun(helpOpen);
  }
  writeHelp(false);

  // ---- per-frame ----------------------------------------------------------

  let forecastKey = '';
  let logKey = '';
  let awardsKey = '';
  let overShown = false;

  // The ore figure runs up to its value instead of jumping, the hearth flashes
  // when it is hit, and a tile lights the moment it becomes affordable: every
  // event the player would otherwise have had to notice by ear has a visible
  // twin. Timers here are in frames, since update runs once a frame.
  let shownOre = -1;
  let lastHearth = -1;
  let hitFrames = 0;
  const wasPoor = new Map();
  const litFrames = new Map();

  function update() {
    const state = api.state();
    const meta = state.meta;
    const tool = api.tool();
    const hover = api.hover();

    const ore = Math.floor(state.ore);
    if (shownOre < 0 || Math.abs(ore - shownOre) < 1 || Math.abs(ore - shownOre) > 5000) shownOre = ore;
    else shownOre += (ore - shownOre) * 0.25;
    const oreText = Math.abs(ore - shownOre) < 1 ? ore : (ore > shownOre ? Math.floor(shownOre) : Math.ceil(shownOre));
    // Raising the ground costs half an ore at odd heights, so a counter that
    // only ever shows whole ore made a player with 7.9 read "7" and believe a
    // 7.5 raise was out of reach. The half is shown while the counter is
    // settled and there is one to show; a climbing figure stays whole so the
    // count does not flicker through fractions on its way up.
    const settled = Math.abs(ore - shownOre) < 1;
    const half = settled && Math.abs(state.ore - ore - 0.5) < 0.05;
    put(el.ore, format(oreText) + (half ? '.5' : ''));

    put(el.hearth, Math.max(0, Math.ceil(state.hearthHp)) + '/' + cfg.hearth.hp);
    setClass(el.hearth, 'low', state.hearthHp < cfg.hearth.hp * 0.3);
    if (lastHearth >= 0 && state.hearthHp < lastHearth - 1e-6) hitFrames = 18;
    lastHearth = state.hearthHp;
    if (hitFrames > 0) hitFrames--;
    setClass(el.hearth, 'hit', hitFrames > 0);
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
      const poor = open && price > state.ore;
      setClass(b, 'locked', !open);
      setDisabled(b, !open);
      setClass(b, 'on', tool.type === 'build' && tool.kind === def.id);
      setClass(b, 'poor', poor);
      // Becoming affordable is an event: the tile brightens for a moment.
      if (open && wasPoor.get(def.id) === true && !poor) litFrames.set(def.id, 40);
      wasPoor.set(def.id, poor);
      const lit = (litFrames.get(def.id) || 0) - 1;
      if (lit >= 0) litFrames.set(def.id, lit);
      setClass(b, 'lit', lit > 0);
      put(cost, open ? price : fill(t.locked, { n: def.unlock }));
    }
    setClass(el.raise, 'on', tool.type === 'raise');
    setClass(el.cut, 'on', tool.type === 'cut');

    // The earthworks line: the cost at the hovered cell for the active tool,
    // otherwise what the ground is for and what it costs.
    if ((tool.type === 'raise' || tool.type === 'cut') && hover.cell >= 0) {
      const p = api.preview(tool.type, null, hover.cell);
      const h = state.terrain.h[hover.cell];
      if (p.reason === 'fixed') put(el.earthcost, immovable(state, tool.type, hover.cell));
      else put(el.earthcost, (tool.type === 'raise' ? t.raise : t.cut) + ': height ' + h + ' to ' + p.height +
        ', ' + p.cost + ' ore' + (p.ok ? '' : ' - not enough ore'));
    } else {
      put(el.earthcost, fill(t.earthNote, { raise: cfg.economy.raiseBase, cut: cfg.economy.cutCost }));
    }

    const sel = api.selected();
    if (sel) {
      const def = kindDef(cfg, sel.kind);
      const s = api.workStats(sel);
      const st = t.stats;
      const lines = [];
      lines.push(def.name + ' - ' + fill(t.tier, { t: sel.tier }) + (s.buffed ? ' - ' + t.boosted : ''));
      if (s.dmg) lines.push(fill(s.rate ? st.damage : st.damageOnly, { dmg: fmt1(s.dmg), rate: fmt1(s.rate) }));
      if (s.burnDps) lines.push(fill(st.burn, { dps: fmt1(s.burnDps), secs: fmt1(s.burnSeconds) }));
      if (s.slow) lines.push(fill(st.slow, { pct: Math.round(s.slow * 100), secs: fmt1(s.slowSeconds) }));
      if (s.pull) lines.push(fill(st.pull, { rate: fmt1(s.pull) }));
      if (s.chain) lines.push(fill(st.chain, { n: s.chain }));
      if (s.splash) lines.push(fill(st.splash, { r: fmt1(s.splash) }));
      if (s.aura) lines.push(fill(st.aura, { r: fmt1(s.aura) }));
      const hg = state.terrain.h[sel.cell];
      lines.push(fill(hg > 0 ? st.rangeHigh : st.range,
        { r: fmt1(s.range), pct: Math.round(cfg.works.highGroundRange * hg * 100) }));
      lines.push(fill(st.tally, { kills: sel.kills, dealt: format(Math.round(sel.dealt)) }));
      put(el.selinfo, lines.join('\n'));
      const next = sel.tier < cfg.works.maxTier ? costOf(cfg, def, sel.tier + 1) : null;
      put(el.upgrade, next === null ? t.topTier : t.upgrade + ' ' + next);
      setDisabled(el.upgrade, next === null || next > state.ore || state.phase === 'over');
      put(el.sell, t.sell + ' +' + Math.floor(sel.spent * cfg.economy.sellRefund));
      setDisabled(el.sell, state.phase === 'over');
    } else {
      // With no tower picked the button still has a target, and it says which.
      const best = api.bestUpgrade();
      put(el.selinfo, t.nothing);
      put(el.upgrade, best ? fill(t.upgradeBest, { name: best.def.name, cost: Math.ceil(best.cost) }) : t.upgradeNone);
      put(el.sell, t.sell);
      setDisabled(el.upgrade, !best || best.cost > state.ore || state.phase === 'over');
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
      if (el.log) {
        shown.forEach((l, k) => {
          const row = make('div', l.cls === 'ink' ? 'ink' : '', l.text);
          // The newest line is marked so the eye finds what just happened.
          if (k === shown.length - 1) row.classList.add('new');
          el.log.appendChild(row);
        });
      }
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

  /**
   * Why a cell will not move. The run gives one reason for three different
   * situations - ground that is fixed, ground already at the top, and ground
   * already at the bottom - and each needs its own sentence, or a player at
   * the valley floor goes looking for a rule that is not there.
   */
  function immovable(state, type, cell) {
    const kind = state.terrain.kind[cell];
    if (kind === 1) return fill(t.earthFixed, { where: t.snowline.toLowerCase() });
    if (kind === 2) return fill(t.earthFixed, { where: t.hearth.toLowerCase() });
    return type === 'raise' ? t.earthTop : t.earthLow;
  }

  /**
   * Every cell the Melt may walk: the road it will take plus every branch off
   * the other starts. Rebuilt only when the ground or the road changed.
   */
  let roadKey = '';
  let roadSet = new Set();
  function roadCells(state) {
    const key = state.flowVersion + '|' + (state.fallLine ? state.fallLine.length : 0);
    if (key === roadKey) return roadSet;
    roadKey = key;
    roadSet = new Set(state.fallLine || []);
    for (const branch of (state.fallLines || [])) for (const i of branch) roadSet.add(i);
    return roadSet;
  }

  /** Whether anything standing can reach any cell of that road. */
  let coverKey = '';
  let coverAns = true;
  function coversRoad(state) {
    const list = state.works.list;
    const road = roadCells(state);
    const key = roadKey + '|' + list.length + '|' + list.reduce((a, w) => a + w.tier, 0);
    if (key === coverKey) return coverAns;
    coverKey = key;
    coverAns = false;
    const W = state.terrain.W;
    for (const w of list) {
      const reach = api.workStats(w);
      const r = (reach.range || reach.aura || 0);
      if (r <= 0) continue;
      for (const i of road) {
        const dx = (i % W) + 0.5 - w.x;
        const dy = Math.floor(i / W) + 0.5 - w.y;
        if (dx * dx + dy * dy <= r * r) { coverAns = true; return coverAns; }
      }
    }
    return coverAns;
  }

  /**
   * One line naming the move worth making right now, with the figures it will
   * cost and pay at this moment. A player who says they do not follow the game
   * is not asking for more rules; they are asking what to press.
   */
  function compassLine(state) {
    const c = t.compass;
    const ore = Math.floor(state.ore);
    const cap = cfg.hearth.hp;
    const hp = Math.max(0, Math.ceil(state.hearthHp));
    if (hp < cap * 0.5) return fill(c.hurt, { hp, max: cap, regen: cfg.hearth.regenPerSurge });

    const open = cfg.works.kinds.filter(d => api.isUnlocked(d.id));
    let cheap = null;
    for (const d of open) if (!cheap || costOf(cfg, d, 1) < costOf(cfg, cheap, 1)) cheap = d;
    const cheapCost = cheap ? Math.ceil(costOf(cfg, cheap, 1)) : 0;

    const list = state.works.list;
    if (cheap && !list.length) return fill(c.first, { name: cheap.name, cost: cheapCost, ore });
    if (list.length && !coversRoad(state)) return c.reach;
    if (cheap && ore >= cheapCost) return fill(c.buy, { ore, name: cheap.name, cost: cheapCost });

    const up = api.bestUpgrade();
    if (up && ore >= Math.ceil(up.cost)) {
      return fill(c.upgrade, { ore, name: up.def.name, t: up.tier, cost: Math.ceil(up.cost) });
    }

    let lift = Infinity;
    for (const i of roadCells(state)) {
      if (state.terrain.kind[i] !== 0) continue;
      if (state.terrain.h[i] >= cfg.terrain.maxHeight) continue;
      const price = raiseCost(cfg, state.terrain.h[i]);
      if (price < lift) lift = price;
    }
    if (Number.isFinite(lift) && ore >= lift) return fill(c.sculpt, { ore, cost: fmt1(lift) });

    return fill(c.earn, { ore, kill: fmt1(state.plan ? state.plan.ore : 0),
      n: state.surge, bonus: Math.round(clearBonus(cfg, state.surge)) });
  }

  function hintText(state, tool, hover) {
    if (state.phase === 'over') return t.over;
    if (hover.cell < 0) {
      if (tool.type === 'build') {
        const def = kindDef(cfg, tool.kind);
        return def ? def.name + ': ' + def.line : '';
      }
      if (tool.type === 'raise' || tool.type === 'cut') {
        return fill(t.toolHint, { tool: tool.type === 'raise' ? t.raise : t.cut });
      }
      return compassLine(state);
    }
    const h = state.terrain.h[hover.cell];
    const kind = state.terrain.kind[hover.cell];
    const where = kind === 1 ? t.snowline.toLowerCase() : kind === 2 ? t.hearth.toLowerCase() : 'height ' + h;
    if (tool.type === 'build') {
      const def = kindDef(cfg, tool.kind);
      const p = api.preview('build', tool.kind, hover.cell);
      if (!def) return '';
      if (p.reason === 'fixed') return def.name + ': not on the ' + where + '.';
      if (p.reason === 'occupied') return def.name + ': something already stands here.';
      if (p.reason === 'ore') return def.name + ': ' + p.cost + ' ore, you have ' + Math.floor(state.ore) + '.';
      return def.name + ' here for ' + p.cost + ' ore, on ' + where +
        (h > 0 ? ', range +' + Math.round(cfg.works.highGroundRange * h * 100) + '%' : '') + '.';
    }
    if (tool.type === 'raise' || tool.type === 'cut') {
      const p = api.preview(tool.type, null, hover.cell);
      if (p.reason === 'fixed') return immovable(state, tool.type, hover.cell);
      return (tool.type === 'raise' ? t.raise : t.cut) + ' this cell to height ' + p.height +
        ' for ' + p.cost + ' ore' + (p.ok ? '.' : ' - not enough ore.');
    }
    const w = api.workAt(hover.cell);
    if (w) {
      const def = kindDef(cfg, w.kind);
      const chosen = api.selected();
      const line = def.name + ', ' + fill(t.tier, { t: w.tier }).toLowerCase() + ', on ' + where + '.';
      return chosen && chosen.id === w.id ? line : line + ' ' + t.clickToSelect;
    }
    // The snowline and the hearth are worth naming under the pointer. Plain
    // ground with no tool in hand is worth nothing: its height is already in
    // the picture, and the line does better work naming the next move.
    if (kind === 1 || kind === 2) return where.charAt(0).toUpperCase() + where.slice(1) + '.';
    return compassLine(state);
  }

  const fmt1 = (v) => (Math.round(v * 10) / 10).toString();

  return { update, showHelp, isHelpOpen: () => helpOpen, compassLine, el };
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
