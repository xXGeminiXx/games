/**
 * game.js - the research window, the laws, the ending, and the save.
 *
 * This is the layer that makes the field a game: it reads what the field
 * did, pays flux for it, keeps the six-node board on screen, applies what a
 * bought node does (unlocks a kind in the simulation, multiplies a class of
 * income, grants a law), runs the laws every frame, and closes the universe
 * when the player chooses to. The rules live in research.js; this is where
 * they meet the simulation and the page.
 *
 * Nothing here draws on the canvas. The board is ordinary text in the page,
 * in the same corner as the mass figure, and it is the only text in the game
 * that a player reads more than once.
 */

import * as R from './research.js';
import * as Stellar from './stellar.js';
import * as Rebirth from './rebirth.js';

const SAVE_VERSION = 2;

/**
 * @param {object} o
 * @param {object} o.CONFIG        the game's configuration
 * @param {object} o.KIND          the simulation's kind codes
 * @param {object} o.KIND_NAME
 * @param {object} o.EVENT         the simulation's event codes
 * @param {object} o.STAGE
 * @param {function} o.getSim      () => the live simulation (it is replaced on a new run)
 * @param {function} o.seedWorld   (x, y, opts) => void: put a click's worth of matter at a world point
 * @param {function} o.say         (text, seconds) => void: the line along the bottom
 * @param {function} o.discover    (key) => void: name a first happening
 * @param {object} o.doc           the document
 * @param {object} o.storage       localStorage or a stand-in
 * @param {function} o.storageKey  (slot) => namespaced key
 * @param {function} o.onNewRun    () => void: the host rebuilds the field for a new universe
 */
export function createGame(o) {
  const { CONFIG, KIND, KIND_NAME, EVENT, STAGE, getSim, seedWorld, seedCloud, say, discover, doc, storage, storageKey, onNewRun, onClose } = o;
  const G = CONFIG.game;
  const T = CONFIG.text;

  let research = R.createResearch();
  let rebirth = Rebirth.createState();
  let infallDebt = 0;
  let lastSave = 0;
  let lastHud = 0;
  let boardDirty = true;
  let seeds = 0;             // every seed that ever landed, clicked or fallen
  let elapsed = 0;           // seconds of play this universe
  let closing = null;        // { at } while the ending plays out

  const el = (id) => (doc && typeof doc.getElementById === 'function' ? doc.getElementById(id) : null);
  const fluxEl = el('flux'), rateEl = el('fluxrate'), eraEl = el('era'), nodesEl = el('nodes'), lawsEl = el('laws');
  const starRow = el('starrow'), starEl = el('star'), starLabel = el('starlabel');
  const endingEl = el('ending'), boardEl = el('board');

  function fmt(n) {
    if (!Number.isFinite(n)) return '0';
    if (n < 1000) return String(Math.floor(n));
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
    return n.toExponential(2);
  }

  /* ---------------------------------------------------------------------- *
   * Applying what a node does
   * ---------------------------------------------------------------------- */

  function applyEffects(effects) {
    const sim = getSim();
    for (const e of effects) {
      if (e.unlock !== undefined) {
        sim.setKindUnlocked(e.unlock, true);
      } else if (e.law === 'cycle') {
        applyCycle();
      } else if (e.era !== undefined) {
        say((T.eraPrefix || '') + R.era(research).name, T.captionSeconds);
      } else if (e.ending) {
        beginEnding();
      }
    }
    boardDirty = true;
  }

  /** How long thrown gas takes to cool before it can gather, at a setting. */
  function coolSeconds(d) { return CONFIG.stellar.gasCoolSeconds * (1 - 0.85 * d); }

  /** How many bodies arrive in one cloud, at a setting. */
  function cloudBodies(d) { return Math.max(6, Math.round(G.cloudBodies * (0.2 + 0.8 * d))); }

  /**
   * WHAT A DIAL READS. A percentage of an unstated maximum says nothing: it
   * tells a player where the handle is, which they can already see. Each dial
   * prints the quantity it actually sets, in the unit that quantity has.
   */
  function dialReadout(key, v) {
    switch (key) {
      case 'infall': return (v * G.infallPerSecond).toFixed(1) + '/s';
      case 'cycle': return Math.round(coolSeconds(v)) + 's';
      case 'formation': return cloudBodies(v) + ' bodies';
      default: return Math.round(v * 100) + '%';
    }
  }

  /** The stellar cycle law: thrown gas gathers again sooner. */
  function applyCycle() {
    const sim = getSim();
    if (!R.hasLaw(research, 'cycle')) return;
    sim.setStellar(Object.assign({}, sim.getStellar(), { gasCoolSeconds: coolSeconds(R.dial(research, 'cycle')) }));
  }

  /** Re-apply everything a restored run had bought. */
  function reapply() {
    const sim = getSim();
    for (const id of research.bought) {
      const n = R.node(id);
      if (n && n.does.unlock !== undefined) sim.setKindUnlocked(n.does.unlock, true);
    }
    applyCycle();
    boardDirty = true;
  }

  /* ---------------------------------------------------------------------- *
   * Reading the field
   * ---------------------------------------------------------------------- */

  /** One simulation event. Pays for it and keeps the board honest. */
  function onEvent(e) {
    if (closing) return;
    switch (e.type) {
      case EVENT.MERGE:
        if (research.era === 0) { R.begin(research); boardDirty = true; say(T.boardAppears || '', T.captionSeconds); }
        R.onEvent(research, { kind: 'merge', rung: e.kind < KIND.STAR ? e.kind : KIND.STAR });
        break;
      case EVENT.BLOCKED:
        // The field has earned something it may not take. The node lights.
        if (research.era === 0) { R.begin(research); boardDirty = true; }
        if (research.wanted.indexOf(e.kind) < 0) { R.want(research, e.kind); boardDirty = true; }
        break;
      case EVENT.KIND_CHANGE:
        if (e.kind === KIND.STAR) R.onEvent(research, { kind: e.from === KIND.DUST ? 'second' : 'ignite' });
        else if (e.kind === KIND.GIANT_STAR) R.onEvent(research, { kind: 'giant' });
        else if (e.kind < KIND.STAR) R.onEvent(research, { kind: 'promote', rung: e.kind });
        break;
      case EVENT.DEATH:
        if (e.stage === STAGE.NEBULA) R.onEvent(research, { kind: 'nebula' });
        else if (e.stage === STAGE.SUPERNOVA) R.onEvent(research, { kind: 'supernova' });
        else if (e.stage === STAGE.COLLAPSE) R.onEvent(research, { kind: 'collapse' });
        else if (e.stage === STAGE.DETONATION) R.onEvent(research, { kind: 'detonation' });
        break;
      case EVENT.REMNANT:
        if (e.kind >= 0) R.onEvent(research, { kind: 'remnant', rung: e.kind - KIND.STAR });
        break;
      case EVENT.CONDENSE:
        R.onEvent(research, { kind: 'condense' });
        break;
      default: break;
    }
  }

  /** What shines this frame, for the per-second income. */
  const census = { starLum: 0, giants: 0, remnants: 0, holes: 0 };
  function takeCensus(rv) {
    census.starLum = 0; census.giants = 0; census.remnants = 0; census.holes = 0;
    const exp = rv.expMass || 0;
    for (let i = 0; i < rv.count; i++) {
      const k = rv.kind[i];
      if (k < KIND.STAR || (rv.flags[i] & 1)) continue;
      if (k === KIND.STAR) {
        const M = Stellar.solar(Math.log2(Math.max(rv.mass[i], 1e-12)) + exp);
        census.starLum += Math.min(R.PAY.starLumCap, Math.pow(Math.max(Stellar.mainSequence(M).L, 1e-6), 0.25));
      } else if (k === KIND.GIANT_STAR) census.giants++;
      else if (k === KIND.WHITE_DWARF || k === KIND.NEUTRON_STAR) census.remnants++;
      else if (k === KIND.BLACK_HOLE) census.holes++;
    }
    return census;
  }

  /* ---------------------------------------------------------------------- *
   * The laws, run every frame
   * ---------------------------------------------------------------------- */

  /** Infall: matter arrives on its own, at a rate the player set. */
  function runInfall(dt, stats) {
    if (!R.hasLaw(research, 'infall')) return;
    const rate = R.dial(research, 'infall') * G.infallPerSecond;
    if (!(rate > 0)) return;
    infallDebt += rate * dt;
    const sim = getSim();
    let n = 0;
    while (infallDebt >= 1 && n < 4) {
      infallDebt -= 1; n++;
      // Somewhere in the field, chosen by the count so it is the same every
      // time for the same run, never by a random number.
      const ext = stats && stats.extent ? stats.extent.m * Math.pow(10, stats.extent.e) : 0;
      const ledger = stats ? stats.ledger : null;
      const extCode = ledger ? ext / Math.pow(2, ledger.expLen) : ext;
      const rv = sim.getRenderView();
      let cx = 0, cy = 0, mt = 0;
      for (let i = 0; i < rv.count; i++) { const m = rv.mass[i]; mt += m; cx += m * rv.px[i]; cy += m * rv.py[i]; }
      if (mt > 0) { cx /= mt; cy /= mt; }
      const h = hash(seeds * 7919 + 13);
      const a = h * 6.2831853;
      const r = (0.25 + 0.7 * hash(seeds * 104729 + 7)) * Math.max(extCode * 0.5, 1e-6);
      if (R.hasLaw(research, 'formation') && typeof seedCloud === 'function') {
        // Star formation: a whole cloud, each body standing for a share of
        // everything the field already represents.
        const d = R.dial(research, 'formation');
        const nBodies = cloudBodies(d);
        const p = stats && stats.population ? stats.population.m * Math.pow(10, stats.population.e) : 0;
        const pop = Math.max(1, Math.floor((p * G.popShare) / nBodies));
        seedCloud(cx + Math.cos(a) * r, cy + Math.sin(a) * r, nBodies, pop);
      } else {
        seedWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r, { fell: true });
      }
    }
  }

  function hash(n) {
    let h = Math.imul(n | 0, 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Orbit: the sideways share a seed arrives with, 0 when the law is not held. */
  function orbitShare() {
    return R.hasLaw(research, 'orbit') ? R.dial(research, 'orbit') : 0;
  }

  /* ---------------------------------------------------------------------- *
   * The board, on the page
   * ---------------------------------------------------------------------- */

  function clear(node) {
    if (!node) return;
    while (node.children && node.children.length) node.removeChild(node.children[0]);
    if (!node.children) node.textContent = '';
  }

  function make(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /**
   * What stands in the price column. A node learned in an earlier universe is
   * free and says so; a node with no price at all is not "known" and must not
   * claim to be.
   */
  function costText(row) {
    if (row.known) return T.known || 'known';
    return row.cost > 0 ? fmt(row.cost) : '';
  }

  /**
   * The heaviest star, named. Nothing is shown until the research that reads a
   * spectrum is bought, and nothing is shown when the field holds no star -
   * which is most of an opening, and is not worth a line saying so.
   */
  function renderStar() {
    if (!starRow) return;
    const on = research.hud && research.hud.indexOf('spectroscopy') >= 0;
    const st = on && getSim().stats ? getSim().stats() : null;
    const s = st && st.heaviestStar;
    if (!s) { starRow.hidden = true; return; }
    starRow.hidden = false;
    if (starEl) starEl.textContent = s.spectral;
    if (!starLabel) return;
    const mass = (s.solar < 10 ? s.solar.toFixed(2) : fmt(s.solar)) + ' ' + (T.starSolar || 'solar');
    // Seconds while there is a run left to watch, minutes once there is not
    // much point counting them - the same shape the ending uses for its span.
    const left = s.secondsLeft < 90
      ? Math.max(1, Math.round(s.secondsLeft)) + ' ' + (T.endingSeconds || 'seconds')
      : Math.round(s.secondsLeft / 60) + ' ' + (T.endingMinutes || 'minutes');
    const what = s.giant ? (T.starGiant || 'giant') : (T.starMain || 'main sequence');
    starLabel.textContent = what + ' - ' + mass + ' - ' + left + ' ' + (T.starLeft || 'left');
  }

  function renderBoard() {
    boardDirty = false;
    if (!nodesEl) return;
    clear(nodesEl);
    clear(lawsEl);
    const rows = R.board(research);
    // Named the way the caption names it, so the heading reads as the chapter
    // the run is in rather than as a title for the list under it.
    if (eraEl) eraEl.textContent = research.era === 0 ? '' : (T.eraPrefix || '') + R.era(research).name;
    if (boardEl && boardEl.style) boardEl.style.display = research.era === 0 || closing ? 'none' : '';
    for (const row of rows) {
      const n = row.node;
      const div = make('div', 'node' + (row.affordable ? ' can' : '') + (row.open ? '' : ' shut') + (row.wanted ? ' wanted' : ''));
      div.dataset.id = n.id;
      const head = make('div', 'head');
      head.appendChild(make('span', 'name', n.name));
      head.appendChild(make('span', 'cost', costText(row)));
      div.appendChild(head);
      // A locked row keeps its price AND says what it is waiting on, because
      // the price and the prerequisite are two different reasons a row cannot
      // be bought and a row that shows only one of them cannot be read. It
      // keeps its description too: what a node does is the reason to want it.
      div.appendChild(make('div', 'line', row.open ? n.line
        : (T.needs || 'needs ') + R.node(n.needs).name + '. ' + n.line));
      if (row.open) div.addEventListener('click', () => { if (buy(n.id)) renderBoard(); });
      nodesEl.appendChild(div);
    }
    if (lawsEl) {
      for (const id of research.laws) {
        const n = R.NODES.find(x => x.does.law === id);
        if (!n) continue;
        const d = n.does.dial;
        const div = make('div', 'law');
        const head = make('div', 'head');
        head.appendChild(make('span', 'name', n.name));
        const val = make('span', 'cost', dialReadout(d.key, R.dial(research, d.key)));
        head.appendChild(val);
        div.appendChild(head);
        const input = make('input');
        input.type = 'range'; input.min = String(d.min); input.max = String(d.max); input.step = '0.01';
        input.value = String(R.dial(research, d.key));
        input.setAttribute('aria-label', d.label);
        input.addEventListener('input', () => {
          R.setDial(research, d.key, input.value);
          val.textContent = dialReadout(d.key, R.dial(research, d.key));
          if (id === 'cycle') applyCycle();
        });
        div.appendChild(input);
        // A law arrives with a name and a handle and nothing else. One line
        // says what the handle does, and it stays there for the rest of the run.
        if (d.line) div.appendChild(make('div', 'line', d.line));
        lawsEl.appendChild(div);
      }
    }
  }

  function renderFlux() {
    if (fluxEl) fluxEl.textContent = fmt(research.flux);
    renderStar();
    if (rateEl) rateEl.textContent = research.rate > 0.005 ? '+' + (research.rate < 10 ? research.rate.toFixed(1) : fmt(research.rate)) + '/s' : '';
    // Affordability changes as flux climbs; re-render the board when a row
    // crosses its price rather than every frame.
    if (nodesEl && nodesEl.children) {
      const rows = R.board(research);
      for (let i = 0; i < rows.length && i < nodesEl.children.length; i++) {
        const div = nodesEl.children[i];
        const can = rows[i].affordable;
        const had = div.className.indexOf(' can') >= 0;
        if (can !== had) { boardDirty = true; break; }
      }
    }
  }

  function buy(id) {
    const effects = R.buy(research, id);
    if (!effects) return false;
    const n = R.node(id);
    applyEffects(effects);
    if (n && n.does.unlock !== undefined) discover(KIND_NAME[n.does.unlock]);
    save(true);
    return true;
  }

  /* ---------------------------------------------------------------------- *
   * The ending
   * ---------------------------------------------------------------------- */

  function runSnapshot() {
    const sim = getSim();
    const st = sim.stats();
    const log10 = (mg) => (mg && mg.m > 0 ? Math.log10(mg.m) + mg.e : -Infinity);
    let peak = 0, top = 0;
    for (const k of st.byKind) if (k.tracked > 0 && k.kind < 11 && k.kind > peak) peak = k.kind;
    for (const k of st.byKind) if (k.kind === peak) top = k.tracked;
    return {
      arcComplete: true, peakTierIndex: peak, tierCount: 11,
      boundMass: { log10: log10(st.totalMass) }, totalMass: { log10: log10(st.totalMass) },
      lostMass: { log10: log10(st.dispersed) },
      structureCount: top, elapsed: elapsed, researched: research.known.slice(),
      recursionDepth: 0, exotic: false, terminatedBy: 'manual',
    };
  }

  function beginEnding() {
    const run = runSnapshot();
    const r = Rebirth.close(run, rebirth);
    rebirth = r.state;
    closing = { at: elapsed, name: r.closure ? r.closure.classification.name.toLowerCase() : '' };
    if (boardEl && boardEl.style) boardEl.style.display = 'none';
    say('', 0);
    if (typeof onClose === 'function') onClose();
    if (endingEl) {
      clear(endingEl);
      endingEl.appendChild(make('div', 'title', T.endingTitle || 'the universe closes'));
      const c = research.counts;
      const lines = [
        (T.endingClass || 'it was') + ' ' + closing.name,
        `${fmt(seeds)} ${T.endingSeeds || 'seeds'}, ${spanOfPlay()}`,
        `${fmt((c.ignite || 0) + (c.second || 0))} ${T.endingStars || 'stars'}, ${fmt((c.nebula || 0) + (c.supernova || 0) + (c.collapse || 0) + (c.detonation || 0))} ${T.endingDeaths || 'deaths'}, ${fmt(c.remnant || 0)} ${T.endingRemnants || 'left behind'}`,
        `${fmt(research.earned)} ${T.endingFlux || 'flux earned'}`,
      ];
      for (const l of lines) endingEl.appendChild(make('div', 'line', l));
      const again = make('div', 'again', T.endingAgain || 'again, knowing what you know');
      again.addEventListener('click', () => newRun());
      endingEl.appendChild(again);
      if (endingEl.style) endingEl.style.display = 'flex';
    }
    save(true);
  }

  /** How long the run lasted, in a unit that is not zero. */
  function spanOfPlay() {
    return elapsed < 90
      ? Math.max(1, Math.round(elapsed)) + ' ' + (T.endingSeconds || 'seconds')
      : Math.round(elapsed / 60) + ' ' + (T.endingMinutes || 'minutes');
  }

  /** A new universe. What was learned is kept; nothing else crosses. */
  function newRun() {
    const known = research.known.slice();
    research = R.createResearch(known);
    infallDebt = 0; seeds = 0; elapsed = 0; closing = null;
    if (endingEl) { clear(endingEl); if (endingEl.style) endingEl.style.display = 'none'; }
    if (typeof onNewRun === 'function') onNewRun();
    boardDirty = true;
    save(true);
  }

  /* ---------------------------------------------------------------------- *
   * Per frame
   * ---------------------------------------------------------------------- */

  function tick(dt, now, stats) {
    if (!(dt > 0)) dt = 0;
    elapsed += dt;
    if (!closing) {
      R.tick(research, dt, takeCensus(getSim().getRenderView()));
      runInfall(dt, stats);
    }
    if (now - lastHud >= G.hudEveryMs) { lastHud = now; renderFlux(); if (boardDirty) renderBoard(); }
    if (now - lastSave >= G.saveEverySeconds * 1000) { lastSave = now; save(false); }
  }

  /* ---------------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------------- */

  function record() {
    return {
      v: SAVE_VERSION,
      at: Date.now(),
      sim: getSim().serialize(),
      research: R.serialize(research),
      rebirth: Rebirth.serialize(rebirth),
      seeds, elapsed,
      closed: !!closing,
    };
  }

  function save(force) {
    if (!storage || !G.autosave) return false;
    try {
      storage.setItem(storageKey('run'), JSON.stringify(record()));
      return true;
    } catch (e) { return false; }
  }

  /** Read a saved run, or null. Does not touch the simulation. */
  function load() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(storageKey('run'));
      if (!raw) return null;
      const rec = JSON.parse(raw);
      if (!rec || rec.v !== SAVE_VERSION || !rec.sim) return null;
      return rec;
    } catch (e) { return null; }
  }

  /** Take a saved run on (the host has already rebuilt the simulation from rec.sim). */
  function adopt(rec) {
    research = R.deserialize(rec.research);
    try { rebirth = Rebirth.deserialize(rec.rebirth); } catch (e) { rebirth = Rebirth.createState(); }
    seeds = rec.seeds | 0;
    elapsed = +rec.elapsed || 0;
    closing = null;
    if (rec.closed && research.closed) beginEnding();
    reapply();
  }

  function forget() {
    if (!storage) return;
    try { storage.removeItem(storageKey('run')); } catch (e) { /* fine */ }
  }

  return {
    get research() { return research; },
    get rebirth() { return rebirth; },
    get closing() { return !!closing; },
    get seeds() { return seeds; },
    noteSeed() { seeds++; },
    orbitShare,
    onEvent, tick, buy, renderBoard, renderFlux,
    record, save, load, adopt, forget, newRun,
    board: () => R.board(research),
  };
}

export default createGame;
