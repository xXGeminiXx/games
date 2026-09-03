// ---------------------------------------------------------------------------
// The page.
//
// Everything the player touches, and nothing they do not. The game holds the
// rules; this file turns a reading of the game into enamel plaques, a brass
// counter rail and three sheets, and turns clicks back into calls.
//
// Two things it is careful about.
//
// Nothing here is ever announced only by movement or only by color. Every
// state that matters is a word and a number as well, because a signal that
// needs sound or a steady eye to catch is a signal some players never get.
//
// The face is drawn by the renderer and clicked by this file, and both use the
// same fit, so a nail is exactly where it looks like it is.
// ---------------------------------------------------------------------------

import { createGame, VIEW_MACHINE, VIEW_BENCH, VIEW_FLOOR } from './game.js?v=62';
import { createScene } from './render/scene.js?v=62';
import { fitBoard, pixelToBoard } from './render/layout.js?v=62';
import { num, count, duration, mult, pct, fill } from './format.js?v=62';
import { BULK_STEPS, bulkLabel } from './economy.js?v=62';
import { nailPos } from './board.js?v=62';
import { DOORS_ROW } from './render/board-geom.js?v=62';
import { sketchCabinet } from './cabinets.js?v=62';
import { recordNight, loadNights, withNight, rankOf, ordinal } from './nights.js?v=62';

const SPEEDS = [1, 2, 4];

export async function boot(doc) {
  const game = await createGame({});
  // On the window for the screenshot and save tools, which drive the game
  // from outside the page. Nothing in the page reads it from here.
  globalThis.game = game;
  const cfg = game.cfg;
  const el = index(doc);

  applyIdentity(doc, cfg, el);

  const scene = startScene(doc, el, cfg, game);
  if (scene) game.attach(scene);

  let bulk = 1;
  let speedIndex = 0;
  // The games already written to the board, held weakly so a finished run is
  // still collectable. Keyed on the run itself rather than on its seed: two
  // games in a row on the same machine share a seed, and keying on that meant
  // the second of them was never recorded and never counted.
  const banked = new WeakSet();
  let lastRank = 0;
  let lastNightAt = 0;
  // The board as last painted, and the live rank last spoken, so the plaque
  // only rewrites when the standing actually moves.
  let nightsList = [];
  let liveKey = '';
  // The last lit row the hint spoke for, so it speaks once per row.
  let litRow = null;
  // The tags on the mouths, keyed by mouth id. Declared here with the rest
  // of the state because the first paint runs before boot has finished.
  const mouthTags = new Map();
  const mouthPoint = { x: 0, y: 0 };
  // Declared with the rest of the state rather than beside the function that
  // uses it: the first paint happens before boot has finished running, so
  // anything it reads has to already exist.
  let lastLog = 0;
  let shownRow = false;

  // The first-run card. Shown until it is dismissed once, then never again.
  // The flag sits beside the save rather than inside it, so a player who
  // starts a new game is not told how to play a second time.
  const primerKey = cfg.identity.storagePrefix + ':primed';

  wire();
  openPrimer();
  paint(game.reading());
  game.start(now());
  requestAnimationFrame(loop);

  function loop(t) {
    game.frame(t);
    if (scene) sizeCanvas();
    paint(game.reading());
    requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------------
  function wire() {
    // Pressing anything is about to change what the card describes, and the
    // page can scroll out from under a card that is pinned to the pointer.
    doc.addEventListener('pointerdown', hideTip, true);
    doc.addEventListener('scroll', hideTip, true);
    on(el.pull, 'click', () => game.pull());
    on(el.auto, 'click', () => game.setAuto(!game.run.auto));
    on(el.speed, 'click', () => {
      // The next step is taken from the speed the run is actually at, never
      // from a counter of clicks: a new run starts at 1x and a reload brings
      // back whatever was saved, and a button that counted clicks instead
      // showed 4x over a machine running at 1x until it was toggled again.
      const cur = SPEEDS.indexOf(game.reading().speed);
      speedIndex = ((cur < 0 ? 0 : cur) + 1) % SPEEDS.length;
      game.setSpeed(SPEEDS[speedIndex]);
    });
    on(el.handle, 'input', () => game.setStrength(Number(el.handle.value)));
    on(el.cash, 'click', () => confirmCash());

    on(el.toRow, 'click', () => openRow());
    on(el.rowLater, 'click', () => {
      // On a finished game this starts the same machine again. Hiding the
      // sheet alone left a run with no pulls and no way forward.
      const r = game.reading();
      if (r.over) {
        bankNight();
        game.stayHere();
      }
      hide(el.rowSheet);
    });
    on(el.toFloor, 'click', () => openFloor());
    on(el.closeFloor, 'click', () => hide(el.floorSheet));
    on(el.toSettings, 'click', () => openSettings());
    on(el.closeSettings, 'click', () => hide(el.settingsSheet));
    on(el.toHelp, 'click', () => openHelp());
    on(el.toBests, 'click', () => openBests());
    on(el.closeBests, 'click', () => hide(el.bestsSheet));
    on(el.shareBests, 'click', async () => {
      // The best night as one line, on the clipboard. Nothing is sent
      // anywhere; the player pastes it wherever they like.
      const line = el.bestsLine ? el.bestsLine.value : '';
      if (!line) return;
      let done = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(line); done = true; } } catch (e) { done = false; }
      if (!done && el.bestsLine) { el.bestsLine.focus(); el.bestsLine.select(); }
      el.shareBests.textContent = done ? 'Copied' : 'Select and copy';
      setTimeout(() => { el.shareBests.textContent = 'Copy my best night'; }, 1800);
    });
    on(el.closeHelp, 'click', () => hide(el.helpSheet));
    on(el.primerGo, 'click', () => closePrimer());

    on(el.reroll, 'click', () => { game.reroll(); paintBench(); });
    on(el.leave, 'click', () => { game.leaveBench(); hide(el.benchSheet); });
    on(el.straighten, 'click', () => {
      game.straightenAll();
      say('Every nail stands straight again, and your ' + game.bendsLeft() + ' bends for this round are back.');
      paintBench();
    });

    on(el.newRun, 'click', () => {
      if (confirm('Start a new game? The one you\'re playing ends right now.')) {
        game.newRun(); hide(el.settingsSheet);
      }
    });
    on(el.wipe, 'click', () => {
      if (confirm('Erase this game, your whole arcade, every star and every upgrade? This can\'t be undone.')) {
        game.wipe(); location.reload();
      }
    });

    on(el.fpsTarget, 'input', () => {
      const choices = cfg.quality.targetChoices;
      const v = choices[Math.min(choices.length - 1, Number(el.fpsTarget.value) | 0)];
      game.quality.target = v;
      el.fpsOut.textContent = v;
    });
    on(el.scaleSlider, 'input', () => {
      const v = Number(el.scaleSlider.value);
      setScale(v >= 1 && game.quality.userScale === 0 ? 0 : v);
    });
    on(el.tShadows, 'click', () => toggleDetail('shadows', el.tShadows));
    on(el.tReflect, 'click', () => toggleDetail('reflections', el.tReflect));
    on(el.tGlass, 'click', () => toggleDetail('glass', el.tGlass));
    on(el.tAuto, 'click', () => {
      game.quality.auto = !game.quality.auto;
      if (game.quality.auto) game.quality.userScale = 0;
      paintSettings();
    });

    on(doc, 'keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      // A chord belongs to the browser. Without this, select-all pressed Auto
      // and find opened the arcade, on top of doing what the browser does.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); game.pull(); }
      else if (e.key === 'a' || e.key === 'A') game.setAuto(!game.run.auto);
      else if (e.key === 'ArrowLeft') game.setStrength(game.run.strength - 0.01);
      else if (e.key === 'ArrowRight') game.setStrength(game.run.strength + 0.01);
      else if (e.key === 'Escape') {
        hide(el.floorSheet); hide(el.settingsSheet); hide(el.helpSheet); hide(el.bestsSheet);
        if (el.primerSheet && !el.primerSheet.hidden) closePrimer();
      }
      else if (e.key === 'f' || e.key === 'F') openFloor();
      else if (/^[1-8]$/.test(e.key)) {
        // The number keys call a door while a row is lit, for a player who
        // would rather not reach for the mouse mid-round.
        const r = game.chooseDoor(Number(e.key) - 1);
        if (r.ok) say('Door ' + e.key + ' called. Right pays as many times over as there are doors, wrong pays nothing.');
      }
    });

    on(el.canvas, 'pointerdown', onFacePointer);
  }

  function toggleDetail(key, button) {
    game.quality[key] = !game.quality[key];
    if (scene) scene.setQuality(renderSettings());
    button.classList.toggle('on', game.quality[key]);
  }

  function renderSettings() {
    const q = game.quality;
    return { scale: q.scale, shadows: q.shadows, reflections: q.reflections, glass: q.glass, maxBalls: q.maxBalls };
  }

  function setScale(v) {
    const q = game.quality;
    if (!(v > 0)) { q.userScale = 0; q.auto = true; }
    else { q.userScale = v; q.scale = v; q.auto = false; }
    if (scene) scene.setQuality(renderSettings());
    paintSettings();
  }

  // ---- the face -----------------------------------------------------
  function sizeCanvas() {
    const rect = el.face.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === el.canvas._w && h === el.canvas._h) return;
    el.canvas._w = w; el.canvas._h = h;
    const dpr = Math.min(cfg.quality.maxDpr, (window.devicePixelRatio || 1));
    scene.resize(w, h, dpr);
  }

  function faceFit() {
    // The mapping from a pointer to the board is taken from the renderer's
    // own projection, not refitted here: the scene draws the board with a
    // margin and a lift, and a plain refit put every click a few units off,
    // which a nail's tolerance forgave and a door's did not.
    const rect = el.canvas.getBoundingClientRect();
    const board = game.run.board;
    if (scene && typeof scene.project === 'function') {
      const o = scene.project(0, 0, {});
      const s = scene.project(board.w, 0, {});
      const scale = (s.x - o.x) / board.w;
      if (Number.isFinite(scale) && scale > 0) return { fit: { ox: o.x, oy: o.y, scale }, rect };
    }
    return { fit: fitBoard(rect.width, rect.height, board.w, board.h), rect };
  }

  /** Which door of a lit row a board point is on, or -1. Same geometry the picture draws. */
  function doorAt(x, y) {
    const run = game.run;
    const active = run && run.events && Array.isArray(run.events.active) ? run.events.active : [];
    const e = active.find(q => q.kind === 'doors' && !q.pending && !q.done && !q.revealed);
    if (!e) return -1;
    const b = cfg.board;
    const n = Math.max(2, Math.floor(e.doors || 3));
    const cx = b.w * 0.5, cy = b.h * DOORS_ROW.y;
    const hw = Math.min(b.w * DOORS_ROW.maxHw, n * b.w * DOORS_ROW.hw), hh = b.h * DOORS_ROW.hh;
    if (Math.abs(y - cy) > hh || Math.abs(x - cx) > hw) return -1;
    return Math.max(0, Math.min(n - 1, Math.floor((x - (cx - hw)) / (2 * hw / n))));
  }

  function onFacePointer(e) {
    if (game.view === VIEW_MACHINE) {
      const { fit, rect } = faceFit();
      const p = pixelToBoard(fit, e.clientX - rect.left, e.clientY - rect.top);
      const k = doorAt(p.x, p.y);
      if (k >= 0) {
        const r = game.chooseDoor(k);
        if (r.ok) say('Door ' + (k + 1) + ' called. Right pays as many times over as there are doors, wrong pays nothing.');
      }
      return;
    }
    if (game.view !== VIEW_BENCH) return;
    const { fit, rect } = faceFit();
    const p = pixelToBoard(fit, e.clientX - rect.left, e.clientY - rect.top);
    const i = game.nailAt(p.x, p.y, 4);
    if (i < 0) { say('No nail there. Press right on a nail, then drag it.'); return; }
    dragNail(i, rect, fit);
  }

  function dragNail(i, rect, fit) {
    const move = (ev) => {
      const p = pixelToBoard(fit, ev.clientX - rect.left, ev.clientY - rect.top);
      const check = game.checkBend(i, p.x, p.y);
      say(check.ok ? 'Let go to leave it there.' : check.why);
    };
    const up = (ev) => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      const p = pixelToBoard(fit, ev.clientX - rect.left, ev.clientY - rect.top);
      const r = game.bend(i, p.x, p.y);
      say(r.ok ? 'Nail bent. ' + game.bendsLeft() + ' bends left this round.' : r.why);
      paintBench();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  // ---- painting ------------------------------------------------------
  function paint(r) {
    // Every frame, so a card whose part was bolted in or sold closes on the
    // next one rather than waiting for a pointer event that can never arrive.
    checkTip();
    el.roundNo.textContent = r.round;
    // Which cabinet this is. The whole point of walking the row is that the
    // machine in front of you is a particular machine, so it says which.
    if (el.cabinet) el.cabinet.textContent = r.skin ? r.skin.title : (r.cabinet ? r.cabinet.name : '');
    el.wonNow.textContent = num(r.won);
    paintMouths();
    paintLiveRank(r);
    // The arcade is how stars are earned, and a player with coins and no
    // machines has not been told. The plaque says so until the first is bought.
    if (el.floorHint) {
      const cheapest = cfg.floor && cfg.floor.machines && cfg.floor.machines[0] ? cfg.floor.machines[0].cost : 0;
      // A start-over that would pay is the biggest thing the plaque can say,
      // so it says that first; the sheet has the full terms.
      const mm = game.metaModule;
      const offer = mm && typeof mm.canReset === 'function' ? mm.canReset(cfg, game.meta, game.floor) : { ok: false };
      const stars = offer && offer.ok && typeof game.pendingMarks === 'function' ? game.pendingMarks() : 0;
      el.floorHint.textContent = stars > 0 ? 'Starting over pays ' + num(stars) + (stars === 1 ? ' star' : ' stars') + ' right now - open Your arcade. Stars buy upgrades that never go away.'
        : r.income > 0 ? ''
        : r.scrip >= cheapest && cheapest > 0 ? 'You can buy your first arcade machine now - open Your arcade. Machines earn coins on their own, even while you are away.'
        : 'Trade balls for coins, then buy arcade machines. They earn while you are away, and that is what earns stars.';
    }
    el.quotaNo.textContent = num(r.quota);
    const done = Math.min(1, r.quota > 0 ? r.won / r.quota : 0);
    el.quotaTube.firstElementChild.style.width = (done * 100).toFixed(1) + '%';
    el.quotaTube.classList.toggle('done', done >= 1);
    el.perBall.textContent = r.won >= r.quota
      ? 'Goal met. The counter pays a bonus of ' + num(r.nextBonus) + ' balls.'
      : r.pullsLeft <= 0 ? 'No pulls left.'
      : num(r.pullsLeft) + ' pulls left' + (r.perPull > 1 ? ' at ' + r.perPull + ' balls a pull' : '')
        + '. Each of those balls has to win ' + r.perBall.toFixed(2) + ' to hit the goal.';

    el.strengthOut.textContent = r.strength.toFixed(2);
    if (doc.activeElement !== el.handle) el.handle.value = String(r.strength);
    el.handle.disabled = !!r.locked;
    el.perPull.textContent = num(r.perPull);
    el.auto.classList.toggle('on', r.auto);
    el.speed.textContent = (Number.isFinite(r.speed) ? r.speed : SPEEDS[speedIndex]) + 'x';
    el.pull.disabled = r.auto || r.over;

    el.oddsMatch.textContent = pct(r.matchChance);
    el.oddsCont.textContent = pct(r.continueChance);
    const gateRate = r.stats.launched > 0 ? r.stats.gates / r.stats.launched : 0;
    el.oddsGate.textContent = r.stats.launched < 40 ? 'reading...' : pct(gateRate);
    const back = r.stats.launched > 0 ? r.stats.won / r.stats.launched : 0;
    el.oddsBack.textContent = r.stats.launched < 40 ? 'reading...' : back.toFixed(2);

    el.scrip.textContent = num(r.scrip);
    el.income.textContent = num(r.income) + ' /s';
    el.handMult.textContent = mult(game.handMultiplier());
    el.cash.disabled = r.tray <= 0;

    paintRail(r);
    paintBanner(r);
    paintLog(r);
    paintFlyers();

    if (!r.over) shownRow = false;
    if (r.view === VIEW_BENCH && el.benchSheet.hidden) { show(el.benchSheet); paintBench(); }
    if (r.view !== VIEW_BENCH && !el.benchSheet.hidden) hide(el.benchSheet);
    el.face.classList.toggle('bending', r.view === VIEW_BENCH);

    if (r.over) {
      el.hint.textContent = fill(cfg.text.roundLost, { short: num(r.quota - r.won) });
      // The end of a game is where a player decides what to do next, so if
      // starting over would pay, the same line says so.
      const mm = game.metaModule;
      const offer = mm && typeof mm.canReset === 'function' ? mm.canReset(cfg, game.meta, game.floor) : { ok: false };
      const stars = offer && offer.ok && typeof game.pendingMarks === 'function' ? game.pendingMarks() : 0;
      if (stars > 0) el.hint.textContent += ' Or start over from Your arcade: it pays ' + num(stars) + (stars === 1 ? ' star' : ' stars') + ' right now.';
      // The night goes on the board the moment it ends, once.
      const seed = game.run && Number.isFinite(game.run.seed) ? game.run.seed : -1;
      if (game.run && !banked.has(game.run)) {
        banked.add(game.run);
        const night = {
          round: r.round, cleared: Math.max(0, r.round - 1), won: r.stats.won || 0, fevers: r.stats.fevers || 0, launched: r.stats.launched || 0,
          machine: r.skin ? r.skin.title : '', layout: r.cabinet ? r.cabinet.name : '', seed, at: Date.now(), trusted: r.trusted !== false,
        };
        const res = recordNight(night);
        lastRank = res.rank; lastNightAt = night.at;
        if (typeof game.countGame === 'function') game.countGame();
        paintNights(res.list);
      }
      if (el.rowSheet.hidden && !shownRow) { shownRow = true; openRow(); }
    } else if (!el.helpSheet.hidden || r.stats.launched > 6) {
      // once the player is going, the hint belongs to whatever is happening
    } else {
      el.hint.textContent = cfg.text.firstLine;
    }
    // A lit row of doors says how to play it, once, the moment it lights.
    const lit = (game.run.events && Array.isArray(game.run.events.active) ? game.run.events.active : [])
      .find(e => e.kind === 'doors' && !e.pending && !e.done && !e.revealed);
    if (lit && lit.key !== litRow) {
      litRow = lit.key;
      el.hint.textContent = (lit.doors || 3) + ' doors are lit at the foot of the board. Click one, or press its number, to call it.';
    }

    if (r.away && r.away.gained > 0) {
      showAway(r.away);
      game.away = null;
    }
    if (!el.settingsSheet.hidden) paintSettings();
    if (!el.floorSheet.hidden) paintFloor();
  }

  function paintRail(r) {
    const cells = [
      ['Balls you hold', count(r.tray), false],
      ['Won this round', count(r.won), false],
      ['Pulls left', count(r.pullsLeft) + ' of ' + count(r.pulls), false],
      ['Balls falling', count(r.inFlight), false],
      ['Slot hits', count(r.stats.gates), false],
      ['Bonuses', count(r.stats.fevers), r.fever],
      ['Best round', count(Math.max(r.bestRound, r.round - 1)), false],
    ];
    if (!el.rail._built || el.rail._built !== cells.length) {
      el.rail.textContent = '';
      for (const [label] of cells) {
        const d = doc.createElement('div');
        d.className = 'counter';
        d.innerHTML = '<em></em><b></b>';
        d.firstChild.textContent = label;
        el.rail.appendChild(d);
      }
      el.rail._built = cells.length;
    }
    cells.forEach(([, value, hot], i) => {
      const node = el.rail.children[i];
      node.lastChild.textContent = value;
      node.classList.toggle('hot', !!hot);
    });
  }

  function paintBanner(r) {
    if (r.fever && !r.over) {
      el.banner.hidden = false;
      // The banner wears the machine's accent, with lettering that reads on it.
      // Written every time rather than only when there is one, or a machine
      // with no accent of its own keeps wearing the last machine's.
      if (!(r.skin && r.skin.glow)) {
        el.banner.style.background = cfg.palette.jade;
        el.banner.style.color = cfg.palette.oxblood;
      }
      if (r.skin && r.skin.glow) {
        const g = r.skin.glow.replace('#', '');
        const lum = (parseInt(g.slice(0, 2), 16) * 0.2126 + parseInt(g.slice(2, 4), 16) * 0.7152 + parseInt(g.slice(4, 6), 16) * 0.0722) / 255;
        el.banner.style.background = r.skin.glow;
        el.banner.style.color = lum < 0.45 ? (r.skin.lamp || '#f6f2ea') : '#06180f';
      }
      el.banner.textContent = cfg.text.fever + ' - jackpot pocket open, ' + r.feverLeft + ' balls left'
        + (r.feverChain > 1 ? ' - streak ' + r.feverChain : '');
    } else if (r.settling) {
      el.banner.hidden = false;
      el.banner.textContent = 'Waiting for the last balls to land';
    } else if (r.reel && r.reel.spinning) {
      el.banner.hidden = false;
      el.banner.textContent = 'Reels spinning';
    } else {
      el.banner.hidden = true;
    }
  }

  function paintLog(r) {
    if (r.log.length === lastLog) return;
    lastLog = r.log.length;
    el.log.textContent = '';
    for (const line of r.log.slice(-9).reverse()) {
      const li = doc.createElement('li');
      li.textContent = line.text;
      li.className = line.kind;
      el.log.appendChild(li);
    }
  }

  function paintFlyers() {
    for (const m of game.out.marks) {
      if (m.kind !== 'pay' || !(m.amount > 0)) continue;
      const { fit, rect } = faceFit();
      const px = fit.ox + m.x * fit.scale;
      const py = fit.oy + m.y * fit.scale;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) continue;
      const d = doc.createElement('div');
      d.className = 'fly' + (m.amount >= 6 ? ' jade' : '');
      d.textContent = '+' + num(m.amount);
      d.style.left = px + 'px';
      d.style.top = py + 'px';
      el.flyer.appendChild(d);
      setTimeout(() => d.remove(), 1000);
      if (el.flyer.children.length > 24) el.flyer.firstChild.remove();
    }
  }

  // ---- the bench -----------------------------------------------------
  function paintBench() {
    const r = game.reading();
    el.benchLede.textContent = 'Round ' + r.round + ' is cleared. Between rounds the machine is open: buy a part, '
      + 'bend a nail, then start the next round. Balls are the money here, and you have '
      + count(r.tray) + ' of them.';

    el.offers.textContent = '';
    const hand = game.offers().map(o => o.fitting.id);
    game.offers().forEach((offer, i) => {
      const f = offer.fitting;
      // What buying this would finish, and what it would set up with another
      // card in the same hand.
      const would = wouldFinish(f.id, r.fittings, hand.filter(x => x !== f.id));
      const card = doc.createElement('div');
      card.className = 'card' + (would.now.length ? ' combo' : '') + (would.soon.length ? ' pairs' : '');
      const text = describe(f, true);
      const lines = would.now.length + would.soon.length;
      card.innerHTML = '<div class="rar"></div><h4></h4><p></p>'
        + '<div class="combos"></div>'.repeat(lines)
        + '<div class="price"><span></span></div>';
      card.querySelector('.rar').textContent = f.rarity;
      // The rarity goes round the box as well as into the label, in the same
      // colour the bolted-in bead uses, so a rare part is found at a glance.
      card.classList.add('r-' + f.rarity);
      card.querySelector('h4').textContent = f.name;
      card.querySelector('p').textContent = text;
      // The name of the combination AND what it pays, on the card, at rest.
      // "Works with X" alone left the whole of the reason to buy it one hover
      // away, and half of them were a pairing the player could not see at all.
      const slots = card.querySelectorAll('.combos');
      let k = 0;
      for (const sgy of would.now) {
        const d = slots[k++];
        d.textContent = 'Finishes ' + sgy.name + ': ' + sgy.text;
        if (sgy.trap) d.className = 'combos trap';
      }
      for (const { sgy, missing } of would.soon) {
        const d = slots[k++];
        d.className = 'combos pair';
        d.textContent = 'With ' + missing.map(nameOf).join(' and ') + ', also on offer: '
          + sgy.name + '. ' + sgy.text;
      }
      card.querySelector('.price span').textContent = num(offer.price) + ' balls';
      // The same card a bolted-in part shows, so what is on offer and what is
      // already in the machine are read the same way.
      attachTip(card, () => {
        const t = tipFor(f.id) || { name: f.name, rarity: f.rarity, price: f.price, text, bound: f.bound || '', tags: f.tags || [], combos: [], partners: [] };
        t.price = offer.price;
        return t;
      });
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Buy';
      b.disabled = r.tray < offer.price || r.fittings.length >= r.slots;
      b.addEventListener('click', () => {
        const res = game.buyFitting(f.id);
        if (!res.ok) say(res.why);
        paintBench();
      });
      card.querySelector('.price').appendChild(b);
      el.offers.appendChild(card);
    });

    el.slotCount.textContent = '(' + r.fittings.length + ' of ' + r.slots + ')';
    el.owned.textContent = '';
    const combos = activeCombos(r.fittings);
    for (const id of r.fittings) {
      const f = game.bench.byId.get(id);
      const chip = doc.createElement('span');
      // Finished combinations are marked one way and half finished ones
      // another, so a part sitting in the machine waiting for its partner is
      // not indistinguishable from one that is doing nothing.
      const running = combos.some(c => c.ids.indexOf(id) >= 0);
      const waiting = !running && partnersOf(id, r.fittings).length > 0;
      chip.className = 'chip r-' + (f ? f.rarity : 'common')
        + (running ? ' combo' : '') + (waiting ? ' waiting' : '');
      chip.tabIndex = 0;
      const bead = doc.createElement('i');
      bead.setAttribute('aria-hidden', 'true');
      chip.appendChild(bead);
      chip.appendChild(doc.createTextNode(nameOf(id)));
      chip.setAttribute('aria-label', nameOf(id) + ', ' + (f ? f.rarity : 'common')
        + (running ? ', in a finished combination' : waiting ? ', half of a combination' : '')
        + '. Click to unbolt.');
      attachTip(chip, () => tipFor(id));
      chip.addEventListener('click', () => { hideTip(); game.sellFitting(id); paintBench(); });
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); game.sellFitting(id); paintBench(); }
      });
      el.owned.appendChild(chip);
    }
    if (!r.fittings.length) el.owned.textContent = 'No parts in this machine yet.';

    paintLanding();
    el.bendLede.textContent = 'Drag any nail on the board to the right to bend it. Bending steers where the balls '
      + 'fall, so bend the ones that feed balls into the slot. '
      + game.bendsLeft() + ' of ' + game.bendsPerRound() + ' bends left this round, '
      + r.bends + ' nails bent so far. A nail won\'t go into another nail, into a pocket, '
      + 'or farther than its head reaches. Straighten every nail undoes them all and gives the bends back.';

    el.reroll.textContent = 'Show different parts for ' + num(game.rerollPrice()) + ' balls';
    el.reroll.disabled = r.tray < game.rerollPrice();
  }

  /**
   * Where balls have been ending up, drawn as a row of blocks.
   *
   * This is the only thing that tells a player which nails are worth leaning,
   * so it is a picture rather than a table, and the columns that paid are
   * marked separately from the columns that merely caught something.
   */
  function paintLanding() {
    const run = game.run;
    // The round just finished is the useful one; before there is such a round,
    // whatever the current one has collected so far will do.
    // The round just played is still in the live counters at the bench: the
    // next round is not opened until the player leaves. The previous round's
    // copy is only used before there has been a round at all.
    const usingLive = sum(run.landing) > 0;
    const src = usingLive ? run.landing : run.landingLast;
    const paidSrc = usingLive ? run.landingPaid : run.landingPaidLast;
    const total = sum(src);
    if (total <= 0) {
      el.bendChart.textContent = 'Play a round and this fills in with where the balls actually ended up.';
      return;
    }
    const peak = Math.max(...src);
    const paid = sum(paidSrc);
    el.bendChart.textContent = 'Where the balls landed, left to right across the board. '
      + count(paid) + ' of ' + count(total) + ' landed in a pocket that paid; the lit part of each bar is the share that paid.';
    drawLanding(el.bendBars, src, paidSrc, peak, game.reading().skin);
  }

  function sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }

  // ---- the hover card -------------------------------------------------
  //
  // What a part is, in full, without having to unbolt it to find out: its
  // rarity, what it does with the numbers this machine actually has in it, the
  // ceiling the catalogue puts on it, and any named combination it is
  // currently half of. Shown on hover and on keyboard focus, because a detail
  // only reachable with a mouse is a detail some players never see.

  function activeCombos(ids) {
    const cat = game.catalogue;
    if (!cat || typeof cat.activeSynergies !== 'function') return [];
    try {
      const owned = (cat.FITTINGS || []).filter(f => ids.indexOf(f.id) >= 0);
      return cat.activeSynergies(owned) || [];
    } catch (e) { return []; }
  }

  function tipFor(id) {
    const f = game.bench.byId.get(id);
    if (!f) return null;
    
    const owned = game.reading().fittings;
    const live = activeCombos(owned).filter(c => c.ids.indexOf(id) >= 0);
    const partners = partnersOf(id, owned);
    return {
      name: f.name,
      rarity: f.rarity,
      price: f.price,
      text: describe(f, owned.indexOf(id) < 0),
      bound: f.bound || '',
      tags: Array.isArray(f.tags) ? f.tags : [],
      combos: live,
      partners,
    };
  }

  /**
   * The combinations one more part would finish, and the ones it would only
   * get halfway to. `here` is everything else on offer in the same hand, so a
   * pairing between two cards side by side is visible before either is bought
   * rather than only after one of them is.
   */
  function wouldFinish(id, owned, here) {
    const cat = game.catalogue;
    const list = (cat && Array.isArray(cat.SYNERGIES)) ? cat.SYNERGIES : [];
    const have = new Set(owned);
    const offered = new Set(here || []);
    const now = [], soon = [];
    for (const sgy of list) {
      if (!sgy || !Array.isArray(sgy.ids) || sgy.ids.indexOf(id) < 0) continue;
      if (sgy.ids.every(x => have.has(x))) continue;         // already running
      const missing = sgy.ids.filter(x => x !== id && !have.has(x));
      if (!missing.length) now.push(sgy);
      else if (missing.every(x => offered.has(x))) soon.push({ sgy, missing });
    }
    return { now, soon };
  }

  function partnersOf(id, owned) {
    const cat = game.catalogue;
    const list = (cat && Array.isArray(cat.SYNERGIES)) ? cat.SYNERGIES : [];
    const out = [];
    for (const sgy of list) {
      if (!sgy || !Array.isArray(sgy.ids) || sgy.ids.indexOf(id) < 0) continue;
      const missing = sgy.ids.filter(x => x !== id && owned.indexOf(x) < 0);
      if (missing.length) out.push({ name: sgy.name, missing: missing.map(nameOf) });
    }
    return out;
  }

  function attachTip(node, build) {
    const show = (e) => {
      const t = build();
      if (!t) return;
      el.tip.innerHTML = '<h5></h5><div class="rar"></div><p></p>';
      el.tip.querySelector('h5').textContent = t.name;
      el.tip.querySelector('.rar').innerHTML = '';
      el.tip.querySelector('.rar').appendChild(doc.createTextNode(t.rarity));
      const cost = doc.createElement('b');
      cost.textContent = '  ' + num(t.price) + ' balls';
      el.tip.querySelector('.rar').appendChild(cost);
      el.tip.querySelector('p').textContent = t.text;

      for (const c of t.combos) {
        const d = doc.createElement('div');
        d.className = 'combos';
        d.textContent = c.name + ': ' + c.text;
        el.tip.appendChild(d);
      }
      for (const p of t.partners) {
        const d = doc.createElement('div');
        d.className = 'combos need';
        d.textContent = p.name + ' needs ' + p.missing.join(' and ');
        el.tip.appendChild(d);
      }
      if (t.bound) {
        const b = doc.createElement('div');
        b.className = 'bound';
        b.textContent = t.bound;
        el.tip.appendChild(b);
      }
      if (t.tags.length) {
        const g = doc.createElement('div');
        g.className = 'tags';
        g.textContent = t.tags.map(tagWord).join('  ');
        el.tip.appendChild(g);
      }
      el.tip.hidden = false;
      tipOwner = node;
      place(e || lastPoint, node);
    };
    node.addEventListener('pointerenter', show);
    node.addEventListener('focus', show);
    node.addEventListener('pointermove', (e) => { if (!el.tip.hidden) place(e, node); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('blur', hideTip);
  }

  let lastPoint = null;
  let tipOwner = null;
  function place(e, node) {
    const box = el.tip.getBoundingClientRect();
    const pad = 12;
    let x, y;
    if (e && Number.isFinite(e.clientX)) {
      lastPoint = e;
      x = e.clientX + 14;
      y = e.clientY + 16;
    } else {
      const r = node.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 8;
    }
    // Kept inside the window on both axes, so a part near an edge still shows
    // its whole card rather than half of one.
    if (x + box.width + pad > window.innerWidth) x = window.innerWidth - box.width - pad;
    if (y + box.height + pad > window.innerHeight) y = y - box.height - 26;
    el.tip.style.left = Math.max(pad, x) + 'px';
    el.tip.style.top = Math.max(pad, y) + 'px';
  }

  function hideTip() { el.tip.hidden = true; tipOwner = null; }

  // The card belongs to whatever the pointer is over, and that thing can go
  // away underneath it in two different ways. Bolting a part in rebuilds the
  // bench, so the offer the pointer was resting on stops existing; starting the
  // round hides the bench, so a bolted-in part is still on the page but is no
  // longer on screen. Neither one reports the pointer leaving, so the card was
  // never told to go and hung over the board for the rest of the run.
  //
  // Rather than remember to close it everywhere either of those can happen, the
  // card checks the one thing that has to be true for it to be open: the thing
  // it describes is still visible. getClientRects is empty for a node that has
  // been removed, for one inside a hidden panel, and for one collapsed to
  // nothing, which is every way this has gone wrong. It is measured only while
  // the card is actually open, so it costs nothing the rest of the time.
  function checkTip() {
    if (!el.tip || el.tip.hidden) return;
    if (!tipOwner || !tipOwner.isConnected || !tipOwner.getClientRects().length) hideTip();
  }

  /**
   * A part's sentence, with the numbers it would actually produce.
   *
   * `withPart` means the sentence is built against the machine this part WOULD
   * make rather than the one it is not in yet, which is the difference between
   * "fever runs 12 balls instead of 10" and "fever runs 10 balls instead of 10".
   */
  function describe(f, withPart) {
    const cat = game.catalogue;
    if (cat && typeof cat.describe === 'function') {
      try {
        const model = withPart ? modelWith(f.id) : game.catalogueModel();
        const s = cat.describe(f, { model });
        if (typeof s === 'string' && s) return s;
      } catch (e) { /* fall through to the plain text */ }
    }
    return String(f.text || '').replace(/\{\w+[%#~]?\}/g, '');
  }

  /** The catalogue's view of this machine with one more part bolted in. */
  function modelWith(id) {
    const cat = game.catalogue;
    if (!cat || typeof cat.buildModel !== 'function') return null;
    try {
      const want = new Set(game.reading().fittings);
      want.add(id);
      return cat.buildModel((cat.FITTINGS || []).filter(x => want.has(x.id)));
    } catch (e) { return game.catalogueModel(); }
  }

  function nameOf(id) {
    const f = game.bench.byId.get(id);
    return f ? f.name : id;
  }

  // ---- picking a machine ---------------------------------------------
  //
  // Three machines are offered at a time and no two are nailed alike. The one
  // number that decides whether a machine is generous is how many balls come
  // back for each ball spent, so that is the headline and it is spelled out in
  // words rather than left as a ratio to be worked out.

  // The measuring code names things the way a machine shop does. These are the
  // same facts in the words a first-time player already has.
  const DROP_WORDS = {
    'walks balls left': 'pushes balls to the left',
    'walks balls right': 'pushes balls to the right',
    'runs straight': 'drops balls straight down',
  };
  const FUNNEL_WORDS = {
    'no funnel over the gate': 'nothing funnels balls toward the slot',
    'a tight funnel over the gate': 'a tight funnel of nails feeds the slot',
    'an ordinary funnel over the gate': 'an ordinary funnel of nails feeds the slot',
    'a wide funnel over the gate': 'a wide funnel of nails feeds the slot',
  };
  const POWER_WORDS = {
    'a soft launch': 'a soft pull',
    'a hard launch': 'a hard pull',
    'a launch around the middle': 'a pull around the middle',
    'nowhere in particular': 'no setting in particular',
  };
  const plain = (table, word) => table[word] || word || '';

  function openRow() {
    show(el.rowSheet);
    // Reading three machines means putting a few hundred balls through each,
    // which takes long enough to be seen. The sheet is put up first and says
    // what it is doing, so the pause reads as work rather than as a hang.
    if (game.row) { paintRow(); return; }
    el.rowLede.textContent = 'Testing each machine...';
    el.cabinets.textContent = '';
    requestAnimationFrame(() => requestAnimationFrame(paintRow));
  }

  function paintRow() {
    const r = game.reading();
    el.rowTitle.textContent = r.over ? 'That game is over' : 'Pick a machine to play';
    el.rowLede.textContent = r.over
      ? 'Round ' + r.round + ' beat you' + (lastRank > 0 ? ' - your ' + ordinal(lastRank) + ' best night. ' : '. ') + 'Pick where to play next. Every machine has its nails, its '
        + 'pockets and its slot in different places, so what pays on one doesn\'t pay on the next. '
        + 'Each machine below was measured by dropping a few hundred balls through it.'
      : 'Every machine has its nails, its pockets and its slot in different places, so what pays on one '
        + 'doesn\'t pay on the next. Each was measured by dropping a few hundred balls through it at '
        + 'several handle settings. Picking one starts a new game.';

    el.rowLater.textContent = r.over ? 'Play this machine again' : 'Keep playing the one I\'m on';
    // The tooltip says what the button does, which is two different things.
    el.rowLater.title = r.over
      ? 'Start a new game on the machine you are already at.'
      : 'Back to the machine you are on. The game you are playing carries on.';
    el.cabinets.textContent = '';
    for (const cab of game.cabinets()) {
      const label = cab.title || cab.layout || cab.name;
      const d = doc.createElement('div');
      d.className = 'cab';
      // The card wears the machine's own colour, so the row reads from across
      // the room the way a row of cabinets does.
      if (cab.skin) {
        d.style.setProperty('--face', cab.skin.lacquer);
        d.style.setProperty('--face-glow', cab.skin.glow);
      }
      d.innerHTML = '<h4></h4><div class="theme"></div><canvas class="sketch"></canvas><div class="big"></div><p></p>'
        + '<dl><dt>Balls reaching the slot</dt><dd class="n1"></dd>'
        + '<dt>Nails on the board</dt><dd class="n2"></dd>'
        + '<dt>Machine number</dt><dd class="n3"></dd></dl>'
        + '<div class="warn"></div>';
      d.querySelector('h4').textContent = label;
      const doorCount = cab.skin && Number.isFinite(cab.skin.doors) ? cab.skin.doors : 3;
      const sends = cab.skin && cab.skin.summon ? ' - sends ' + String(cab.skin.summon).replace(/^A pair of /i, '').replace(/^An? /i, '').toLowerCase() : '';
      d.querySelector('.theme').textContent = (cab.layout ? cab.layout + ' board' : '') + ' - lights ' + doorCount + ' doors' + sends;
      drawSketch(d.querySelector('.sketch'), sketchCabinet(cfg, cab.seed), cab.skin);

      const big = d.querySelector('.big');
      big.textContent = cab.back.toFixed(2) + ' balls back';
      const small = doc.createElement('small');
      // Said as measured, not as a rule. Most machines pay back under 1.00 and
      // a few read over it at their best setting, and a card that always
      // claimed the first would be telling the player something untrue about
      // the machine right in front of them.
      small.textContent = cab.back >= 1
        ? 'For every ball you spend here, ' + cab.back.toFixed(2) + ' comes back out of the pockets. '
          + 'Over 1.00, so the pockets alone can pay for the balls you feed it, and a bonus is profit on top.'
        : 'For every ball you spend here, ' + cab.back.toFixed(2) + ' comes back out of the pockets. '
          + 'Under 1.00, so this machine keeps the difference and a bonus is the only way to finish ahead.';
      big.appendChild(small);

      // The layout's own line leads, because it is the thing that differs
      // between two cards; the measured reading follows.
      const note = cab.note ? cab.note.charAt(0).toUpperCase() + cab.note.slice(1) + '. ' : '';
      d.querySelector('p').textContent = note + 'It ' + plain(DROP_WORDS, cab.leanWord) + ', and '
        + plain(FUNNEL_WORDS, cab.funnelWord) + '. It paid best on ' + plain(POWER_WORDS, cab.where) + '.';
      d.querySelector('.n1').textContent = pct(cab.gate);
      d.querySelector('.n2').textContent = count(cab.nails);
      d.querySelector('.n3').textContent = cab.name;

      const cost = r.tray > 0
        ? 'Starts a new game. Your ' + count(r.tray) + ' balls are cashed in first, for '
          + num(game.cashOutValue()) + ' coins.'
        : r.over
          ? 'Starts a new game.'
          : 'Starts a new game. The round you\'re playing now is lost.';
      d.querySelector('.warn').textContent = cost;

      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Play ' + label;
      b.addEventListener('click', () => {
        // Asked every time there is a game to lose, not only when there are
        // balls to cash in: an empty tray in the middle of a good run is still
        // a run, and restarting it without a word is how one gets thrown away.
        if (!r.over && !confirm(cost + ' Go ahead?')) return;
        bankNight();
        // The chosen machine is named to whichever call starts the run, so it
        // is started once. Cashing out and then sitting down started two, and
        // the games count moved by two for one game.
        if (r.tray > 0) game.cashOut(cab.seed); else game.sitAt(cab.seed);
        hide(el.rowSheet);
      });
      d.appendChild(b);
      el.cabinets.appendChild(d);
    }
  }

  /**
   * The landing chart: one bar a column across the board, its height where
   * the balls ended up, the lit part the share that paid. A column nothing
   * reached is drawn as a stub so the chart never reads as broken.
   */
  function drawLanding(canvas, src, paidSrc, peak, skin) {
    if (!canvas || !canvas.getContext) return;
    canvas.hidden = false;
    const W = 400, H = 56, dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const n = src.length;
    const slot = W / n;
    for (let i = 0; i < n; i++) {
      const h = peak > 0 ? Math.max(2, (src[i] / peak) * (H - 6)) : 2;
      const paidH = src[i] > 0 ? h * Math.min(1, (paidSrc[i] || 0) / src[i]) : 0;
      const x = i * slot + 1, w = Math.max(1, slot - 2);
      c.fillStyle = '#6a5a4e';
      c.fillRect(x, H - 3 - h, w, h);
      if (paidH > 0) {
        c.fillStyle = (skin && skin.glow) || '#4fa88a';
        c.fillRect(x, H - 3 - paidH, w, paidH);
      }
    }
  }

  /**
   * A small picture of a machine's face, drawn from its real geometry: where
   * the screen is, where every mouth is, how the plates run, where the nails
   * stand. This is how a row of machines is told apart before sitting down -
   * the slot high or low, one slot or two, the pockets stacked or spread -
   * and it is the same drawing the board is built from, so it cannot lie.
   */
  // The tag a part carries is a code word; the card shows the game's word for it.
  const TAG_WORDS = { cadence: 'speed', fever: 'bonus', gate: 'slot', economy: 'coins', cost: 'price', reel: 'reels', static: 'always on' };
  function tagWord(t) { return TAG_WORDS[t] || t; }

  function drawSketch(canvas, sk, skin) {
    if (!canvas || !sk || !canvas.getContext) return;
    const W = 200, H = Math.round(W * sk.h / sk.w);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const c = canvas.getContext('2d');
    if (!c) return;
    const s = W * dpr / sk.w;
    c.setTransform(s, 0, 0, s, 0, 0);
    const col = (role, fallback) => (skin && skin[role]) || fallback;
    // the face
    c.fillStyle = col('lacquer', '#555');
    c.fillRect(0, 0, sk.w, sk.h);
    // the nails, faint, so the mouths and the screen read over them
    c.fillStyle = col('brass', '#eee');
    c.globalAlpha = 0.55;
    for (const n of sk.nails) c.fillRect(n[0] - 0.4, n[1] - 0.4, 0.8, 0.8);
    c.globalAlpha = 1;
    // the screen
    if (sk.screen) {
      const r = sk.screen;
      c.fillStyle = col('screen', '#111');
      c.fillRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
      c.strokeStyle = col('chrome', '#ddd');
      c.lineWidth = 0.9;
      c.strokeRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
    }
    // the rails and the plates
    c.strokeStyle = col('chrome', '#ddd');
    c.lineWidth = 1.1;
    c.lineCap = 'round';
    for (const g of sk.guides) { c.beginPath(); c.moveTo(g[0], g[1]); c.lineTo(g[2], g[3]); c.stroke(); }
    // every mouth, drawn larger than life so it can be seen at this size, in
    // the colour the board itself gives it
    for (const p of sk.pockets) {
      const gate = p.kind === 'gate';
      const attacker = p.kind === 'attacker';
      const w = Math.max(p.w * 1.6, 5), h = Math.max(p.h * 2.2, 3.2);
      c.fillStyle = col('oxblood', '#000');
      c.fillRect(p.x - w / 2 - 0.7, p.y - h / 2 - 0.7, w + 1.4, h + 1.4);
      c.fillStyle = gate ? col('lamp', '#fff') : attacker ? col('glow', '#f80')
        : p.tone === 'jade' ? col('jade', '#0f8') : col('enamel', '#eee');
      c.fillRect(p.x - w / 2, p.y - h / 2, w, h);
      if (gate) {
        // the funnel over the slot, which is what a player is looking for
        c.strokeStyle = col('lamp', '#fff');
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(p.x - 7, p.y - 9); c.lineTo(p.x - w / 2, p.y - h / 2);
        c.moveTo(p.x + 7, p.y - 9); c.lineTo(p.x + w / 2, p.y - h / 2);
        c.stroke();
      }
    }
  }

  // ---- the board of best nights -------------------------------------------
  //
  // A game ends two ways: it dies, or its balls are banked for coins. Both are
  // nights, and a banked round-twenty game outranks a lost round-eight one.
  function bankNight() {
    const r = game.reading();
    const seed = game.run && Number.isFinite(game.run.seed) ? game.run.seed : -1;
    if (!game.run || banked.has(game.run) || !r.stats || !(r.stats.launched > 0)) return;
    banked.add(game.run);
    const night = {
      round: r.round, cleared: Math.max(0, r.round - 1), won: r.stats.won || 0, fevers: r.stats.fevers || 0, launched: r.stats.launched || 0,
      machine: r.skin ? r.skin.title : '', layout: r.cabinet ? r.cabinet.name : '', seed, at: Date.now(), cashed: !r.over, trusted: r.trusted !== false,
    };
    const res = recordNight(night);
    lastRank = res.rank; lastNightAt = night.at;
    if (typeof game.countGame === 'function') game.countGame();
    paintNights(res.list);
    return res;
  }
  //
  // The best finished games this browser has played, best first, always in
  // view under the arcade. The night just finished is marked.
  function paintNights(list) {
    const box = el.nights;
    if (!box) return;
    nightsList = list || loadNights();
    const rows = nightsList.slice(0, 5);
    box.textContent = '';
    for (const n of rows) {
      const li = doc.createElement('li');
      if (n.at === lastNightAt) li.className = 'now';
      const b = doc.createElement('b');
      b.textContent = 'Round ' + n.round;
      li.appendChild(b);
      li.appendChild(doc.createTextNode(' ' + (n.machine || '') + ', ' + num(n.won || 0) + ' balls' + (n.cashed ? ', banked' : '')));
      const s = doc.createElement('small');
      const d = new Date(n.at || 0);
      s.textContent = Number.isFinite(d.getTime()) && n.at ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      li.appendChild(s);
      box.appendChild(li);
    }
    if (el.nightsLede) {
      el.nightsLede.textContent = rows.length
        ? 'Best first: the round that ended the game, then the balls won. Beat round ' + rows[0].round + ' to take the top.'
        : 'Finish a game and it goes on the board. Beat your best round to climb it.';
    }
  }
  paintNights();

  /** Where the game being played would land on the board right now. */
  function liveStanding(r) {
    if (!r || r.over || !r.stats || !(r.stats.launched > 0) || !nightsList.length) return null;
    const now = { round: r.round, won: r.stats.won || 0, at: -1, seed: -2 };
    const rank = rankOf(withNight(nightsList, now), now);
    return rank > 0 ? rank : nightsList.length + 1;
  }

  /** The plaque says the live standing, rewritten only when it moves. */
  function paintLiveRank(r) {
    if (!el.nightsLede) return;
    const rank = liveStanding(r);
    const key = rank === null ? '' : rank + ':' + nightsList[0].round;
    if (key === liveKey) return;
    liveKey = key;
    if (rank === null) return;
    el.nightsLede.textContent = 'This game would land ' + ordinal(rank) + ' right now. Beat round ' + nightsList[0].round + ' to take the top.';
  }

  /** The full board, one click from anywhere: every night kept, best first. */
  function openBests() {
    const list = loadNights();
    const body = el.bestsBody;
    if (!body) return;
    body.textContent = '';
    if (!list.length) {
      const p = doc.createElement('p');
      p.className = 'lede';
      p.textContent = 'Nothing yet. Finish a game and it goes here.';
      body.appendChild(p);
    } else {
      const t = doc.createElement('table');
      t.innerHTML = '<thead><tr><th>#</th><th>Round</th><th>Machine</th><th class="n">Balls won</th><th class="n">Bonuses</th><th>Ended</th><th>When</th></tr></thead><tbody></tbody>';
      const tb = t.tBodies[0];
      list.forEach((n, i) => {
        const tr = doc.createElement('tr');
        tr.className = (i === 0 ? 'top' : '') + (n.at === lastNightAt ? ' now' : '');
        const d = new Date(n.at || 0);
        const when = n.at && Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        const cells = [String(i + 1), 'Round ' + n.round, n.machine || '', num(n.won || 0), num(n.fevers || 0), n.cashed ? 'Banked' : 'Lost', when];
        cells.forEach((v, k) => { const td = doc.createElement('td'); if (k === 3 || k === 4) td.className = 'n'; td.textContent = v; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      body.appendChild(t);
    }
    if (el.bestsLine) {
      const best = list[0];
      el.bestsLine.value = best
        ? 'Brass Rain - my best night: round ' + best.round + ' on ' + (best.machine || 'a machine') + ', ' + num(best.won || 0) + ' balls. Beat it: xxgeminixx.github.io/games/brass-rain/'
        : '';
      el.bestsLine.hidden = !best;
      if (el.shareBests) el.shareBests.hidden = !best;
    }
    const standing = liveStanding(game.reading());
    if (el.bestsLede) el.bestsLede.textContent = list.length
      ? 'Every game you have finished, best first: the round that ended it, then the balls won on the way.'
        + (standing ? ' The game you are playing would land ' + ordinal(standing) + ' right now.' : '')
        + ' Beat round ' + list[0].round + ' to take the top.'
      : 'Every game you finish goes here, best first.';
    show(el.bestsSheet);
  }

  // ---- the lettering on the mouths ------------------------------------
  //
  // Every mouth is named on the face: the slot says SLOT, a pay mouth says
  // what it pays, the jackpot pocket says JACKPOT. A face of brass
  // rectangles asks a new player to learn which is which; this tells them,
  // from the board's own geometry, so it is right on every machine.
  function paintMouths() {
    const box = el.mouths;
    if (!box || !scene || !game.run || !game.run.board) return;
    const pockets = game.run.board.pockets || [];
    // While a row of doors is lit the tags step aside, or JACKPOT sits on a door.
    const ev = game.run.events && Array.isArray(game.run.events.active) ? game.run.events.active : [];
    box.hidden = ev.some(e => e.kind === 'doors' && !e.pending && !e.done);
    const seen = new Set();
    for (const p of pockets) {
      seen.add(p.id);
      const kind = p.kind === 'gate' ? 'slot' : p.kind === 'attacker' ? 'jackpot' : 'pay';
      const want = kind === 'slot' ? 'SLOT' : kind === 'jackpot' ? 'JACKPOT' : String(p.pay);
      let t = mouthTags.get(p.id);
      if (!t) {
        t = doc.createElement('div');
        box.appendChild(t);
        mouthTags.set(p.id, t);
      }
      if (t.className !== 'mouth ' + kind) t.className = 'mouth ' + kind;
      if (t.textContent !== want) t.textContent = want;
      const pt = scene.project(p.x, p.y - p.h * 0.5 - 1.4, mouthPoint);
      t.style.transform = 'translate(' + pt.x.toFixed(1) + 'px,' + pt.y.toFixed(1) + 'px) translate(-50%,-100%)';
    }
    for (const [id, t] of mouthTags) if (!seen.has(id)) { t.remove(); mouthTags.delete(id); }
  }

  // ---- the arcade ----------------------------------------------------
  //
  // A second, separate set of machines. These are not played and never appear
  // on screen as a board: they are bought with coins and they earn coins on
  // their own, including while the page is closed.
  function openFloor() { show(el.floorSheet); paintFloor(); }

  // The arcade table and the star board are built ONCE and thereafter only
  // their numbers change. They used to be thrown away and rebuilt on every
  // frame, which replaced each button between the press and the release of a
  // click - so the browser never saw a click on any of them and not one of
  // these buttons could be pressed by hand. Anything painted every frame must
  // update its text in place; only a change in what rows exist may rebuild.
  const machineRows = new Map();
  let emptyRow = null;
  let prestigeUi = null;

  /** What the next single unit of a machine costs at the count now owned. */
  function nextUnitPrice(m, owned) { return m.cost * Math.pow(m.ratio, owned); }

  function buildMachineRows(body) {
    body.textContent = '';
    for (const m of cfg.floor.machines) {
      const tr = doc.createElement('tr');
      tr.innerHTML = '<td></td><td class="n"></td><td class="n"></td><td class="n"></td><td></td><td></td>';
      const cells = tr.children;
      cells[0].textContent = m.name;
      const buy = doc.createElement('button');
      buy.type = 'button';
      buy.title = 'Costs coins. Adds to what your arcade earns every second.';
      buy.addEventListener('click', () => { game.buyMachine(m.id, bulk); paintFloor(); });
      cells[4].appendChild(buy);
      const note = doc.createElement('span');
      note.style.fontSize = '11px';
      note.style.color = '#8c7f76';
      cells[5].appendChild(note);
      body.appendChild(tr);
      machineRows.set(m.id, { tr, cells, buy, note });
    }
    emptyRow = doc.createElement('tr');
    emptyRow.innerHTML = '<td colspan="6">Trade some balls for coins at the machine, and the cheapest arcade machine here comes within reach.</td>';
    body.appendChild(emptyRow);
  }

  function paintFloor() {
    const r = game.reading();
    const started = game.meta && game.meta.lifetime ? Math.floor(game.meta.lifetime.runs || 0) : 0;
    const finished = game.floor && game.floor.games ? game.floor.games : 0;
    el.floorLede.textContent = (started ? 'Games played: ' + started + (finished ? ', finished: ' + finished : '') + '. ' : '') + 'You own these machines. They earn '
      + num(r.income) + ' coins a second whether you\'re at the handle or not, even with the page closed. '
      + 'Everything they earn is multiplied by ' + mult(game.handMultiplier())
      + ' because your best game reached round ' + Math.max(r.bestRound, 0)
      + ', so playing well is the best thing you can do for the arcade. You hold ' + num(r.scrip) + ' coins.';

    if (!el.bulkbar._built) {
      for (const step of BULK_STEPS) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = bulkLabel(step);
        b.addEventListener('click', () => { bulk = step; paintFloor(); });
        el.bulkbar.appendChild(b);
      }
      el.bulkbar._built = true;
    }
    Array.from(el.bulkbar.children).forEach((b, i) => {
      b.classList.toggle('on', BULK_STEPS[i] === bulk);
    });

    const body = el.machines.tBodies[0];
    if (!machineRows.size) buildMachineRows(body);

    let anyShown = false;
    for (const m of cfg.floor.machines) {
      const row = machineRows.get(m.id);
      if (!row) continue;
      const q = game.quoteMachine(m.id, bulk);
      const mile = game.milestone(m.id);
      const affordable = q.k > 0;
      // A machine is shown once it is within a quarter of reach, so the next
      // rung is visible before it is buyable.
      const seen = mile.owned > 0 || game.floor.scrip >= m.cost * 0.25;
      row.tr.style.display = seen ? '' : 'none';
      if (!seen) continue;
      anyShown = true;
      row.tr.className = affordable ? '' : 'poor';
      row.cells[1].textContent = count(mile.owned) + (mile.mult > 1 ? '  ' + mult(mile.mult) : '');
      row.cells[2].textContent = num(game.machineIncome(m.id)) + ' /s';
      // What one more costs when none are affordable. Quoting a purchase of
      // zero costs zero, and printing that told the player a machine they
      // could not buy was free.
      row.cells[3].textContent = num(affordable ? q.cost : nextUnitPrice(m, mile.owned));
      row.buy.textContent = affordable ? 'Buy ' + count(q.k) : 'Buy';
      row.buy.disabled = !affordable;
      row.note.textContent = mile.next
        ? 'buy ' + (mile.next - mile.owned) + ' more to double what these earn'
        : mile.owned > 0 ? 'every doubling already taken' : '';
    }
    if (emptyRow) emptyRow.style.display = anyShown ? 'none' : '';

    paintPrestige();
  }

  function buildPrestige() {
    const m = game.metaModule;
    const box = el.prestigeBox;
    box.textContent = '';

    const h = doc.createElement('h3');
    h.textContent = 'Start over, and keep what you learned';
    box.appendChild(h);

    const p = doc.createElement('p');
    p.className = 'lede';
    box.appendChild(p);

    const sell = doc.createElement('button');
    sell.type = 'button';
    sell.addEventListener('click', () => {
      const pending = game.pendingMarks();
      if (confirm('Every machine in your arcade is sold and your coins go with it. You keep '
          + num(pending) + ' stars and every upgrade you have already bought. Do it?')) {
        game.prestige(); paintFloor();
      }
    });
    box.appendChild(sell);

    const nodes = new Map();
    if (m && Array.isArray(m.NODES) && m.NODES.length) {
      const subhead = doc.createElement('h3');
      subhead.textContent = 'Permanent upgrades, bought with stars';
      box.appendChild(subhead);
      const wrap = doc.createElement('div');
      wrap.className = 'nodes';
      wrap.style.marginTop = '10px';
      for (const node of m.NODES) {
        const d = doc.createElement('div');
        d.className = 'node';
        d.innerHTML = '<h4></h4><p></p>';
        d.querySelector('h4').textContent = node.name;
        d.querySelector('p').textContent = node.text;
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Buy for ' + num(node.cost) + ' stars';
        b.addEventListener('click', () => { const res = game.buyNode(node.id); if (!res.ok) say(res.why); paintFloor(); });
        d.appendChild(b);
        wrap.appendChild(d);
        nodes.set(node.id, { d, b });
      }
      box.appendChild(wrap);
    }
    prestigeUi = { p, sell, nodes };
  }

  function paintPrestige() {
    const m = game.metaModule;
    if (!m || typeof m.pendingMarks !== 'function') { el.prestigeBox.textContent = ''; return; }
    if (!prestigeUi) buildPrestige();
    const pending = game.pendingMarks();
    const can = typeof m.canReset === 'function' ? m.canReset(cfg, game.meta, game.floor) : { ok: false, why: '' };

    prestigeUi.p.textContent = can.ok
      ? 'Sell every machine in your arcade and build it again from nothing. You lose the arcade and keep '
        + num(pending) + ' stars. Stars buy permanent upgrades, listed below, and those never go away no '
        + 'matter how many times you start over. You have ' + num((game.meta && game.meta.marks) || 0) + ' stars now.'
      : (can.why || 'There\'s nothing to start over from yet. Keep playing and building the arcade.');

    prestigeUi.sell.textContent = 'Sell the arcade for ' + num(pending) + ' stars';
    prestigeUi.sell.style.display = can.ok ? '' : 'none';

    for (const node of (Array.isArray(m.NODES) ? m.NODES : [])) {
      const ui = prestigeUi.nodes.get(node.id);
      if (!ui) continue;
      const have = !!(game.meta.nodes && game.meta.nodes[node.id]);
      ui.d.className = 'node' + (have ? ' have' : '');
      ui.b.style.display = have ? 'none' : '';
      ui.b.disabled = (game.meta.marks || 0) < node.cost;
    }
  }

  // ---- settings and help ---------------------------------------------
  function openSettings() { show(el.settingsSheet); paintSettings(); }

  function paintSettings() {
    const q = game.quality;
    const found = cfg.quality.targetChoices.indexOf(q.target);
    // A target that is not one of the choices lands on the middle choice, not
    // on the first: Math.max wrote the fallback out of reach.
    const idx = found >= 0 ? found : Math.min(2, cfg.quality.targetChoices.length - 1);
    el.fpsTarget.value = String(idx);
    el.fpsOut.textContent = q.target;
    el.scaleSlider.value = String(q.userScale > 0 ? q.userScale : q.scale);
    el.scaleOut.textContent = q.userScale > 0 ? q.userScale.toFixed(2) : 'auto ' + q.scale.toFixed(2);
    el.tShadows.classList.toggle('on', q.shadows);
    el.tReflect.classList.toggle('on', q.reflections);
    el.tGlass.classList.toggle('on', q.glass);
    el.tAuto.classList.toggle('on', q.auto);
    el.mFps.textContent = q.fps > 0 ? q.fps.toFixed(0) + ' (worst 5 percent ' + q.p95.toFixed(0) + ')' : 'measuring...';
    el.mScale.textContent = q.scale.toFixed(2) + (q.auto ? ' chosen by the game' : ' set by you');
    el.mBalls.textContent = count(game.run.balls.n);
    el.mPins.textContent = count(game.run.board.pinCount);
  }

  function openPrimer() {
    if (!el.primerSheet) return;
    let seen = null;
    try { seen = game.storage ? game.storage.getItem(primerKey) : null; } catch (e) { seen = null; }
    if (seen) return;
    show(el.primerSheet);
  }

  function closePrimer() {
    hide(el.primerSheet);
    // Storage can be full or switched off. If the flag will not write, the
    // card comes back next visit, which is a far smaller problem than the
    // game refusing to start.
    try { if (game.storage) game.storage.setItem(primerKey, '1'); } catch (e) { /* nothing to do */ }
  }

  // Built every time it is opened rather than once. Some of what it says is
  // about the machine being played, and every machine cuts its pockets
  // somewhere else and holds a different number of parts, so a card built once
  // is a card that is true of one machine and wrong on the next.
  function openHelp() {
    show(el.helpSheet);
    el.helpBody.textContent = '';
    for (const [head, body] of HELP) {
      const h = doc.createElement('h3');
      h.textContent = head;
      const p = doc.createElement('p');
      p.className = 'lede';
      p.textContent = typeof body === 'function' ? body(helpFacts()) : body;
      el.helpBody.appendChild(h);
      el.helpBody.appendChild(p);
    }
  }

  /** What the help has to read off the machine rather than assume. */
  function helpFacts() {
    const r = game.reading();
    const pays = ((game.run.board && game.run.board.pockets) || [])
      .filter(p => p.kind === 'pay')
      .map(p => p.pay)
      .sort((a, b) => a - b);
    return {
      pays,
      best: pays.length ? pays[pays.length - 1] : 0,
      slots: r.slots,
      machines: (cfg.board.layouts || []).length || 1,
    };
  }


  function confirmCash() {
    const worth = game.cashOutValue();
    const msg = fill(cfg.text.cashOutAsk, { balls: count(game.run.tray), scrip: num(worth) });
    if (confirm(msg)) { bankNight(); game.cashOut(); }
  }

  function showAway(away) {
    const line = away.capped
      ? 'You were away ' + duration(away.away) + '. Your arcade pays for the first '
        + duration(away.paid) + ' of that, which came to ' + num(away.gained) + ' coins.'
      : 'You were away ' + duration(away.away) + '. Your arcade earned ' + num(away.gained) + ' coins.';
    say(line);
  }

  function say(text) { el.hint.textContent = text; }

  // -------------------------------------------------------------------
  function startScene(doc2, elements, config, g) {
    try {
      // The physics is handed over rather than left to be inferred. The rail the
      // renderer draws and the rail a ball rides have to be the same circle,
      // and a board-derived guess happens to match today only by arithmetic.
      const s = createScene(elements.canvas, {
        palette: config.palette,
        physics: config.physics,
        render: { maxDpr: config.quality.maxDpr, reel: config.board.reel },
      });
      s.setQuality(renderSettings());
      const rect = elements.face.getBoundingClientRect();
      s.resize(Math.max(1, rect.width), Math.max(1, rect.height), Math.min(config.quality.maxDpr, window.devicePixelRatio || 1));
      elements.canvas._w = Math.round(rect.width);
      elements.canvas._h = Math.round(rect.height);
      return s;
    } catch (e) {
      elements.hint.textContent = 'This browser could not draw the game board: ' + (e && e.message ? e.message : e);
      return null;
    }
  }
}

// Every word the game uses that a player would otherwise have to guess at,
// defined in the order they run into it. This is the reference behind the Help
// button, and it is the only place any of these words is explained in full, so
// a term used anywhere on screen has to appear here.
/** '1, 2 or 6 balls', the way a person says a short list of numbers out loud. */
function listOfPays(numbers) {
  const seen = Array.from(new Set(numbers));
  if (!seen.length) return 'nothing';
  const most = seen[seen.length - 1];
  const balls = most === 1 ? ' ball' : ' balls';
  if (seen.length === 1) return seen[0] + balls;
  return seen.slice(0, -1).join(', ') + ' or ' + most + balls;
}

const HELP = [
  ['Balls', 'Everything is counted in balls. Pulling the handle spends a ball and sends it arcing over the '
    + 'top of the board. Balls that land in a pocket pay balls back into your count, and the count is on '
    + 'the counter rail along the bottom of the screen. Balls are also the money at the workbench between '
    + 'rounds. Run out of pulls before you reach the round goal and the game ends.'],
  ['The board and the nails', 'The board is the tall lit panel filling most of the screen: a field of several '
    + 'hundred brass nails with pockets cut into it. A falling ball bounces off nail after nail, so where the '
    + 'nails stand decides where the balls end up.'],
  ['The handle and the power', 'The power slider sets how hard a ball is thrown around the outer rail before '
    + 'it drops onto the nails. It\'s the only thing you control while a round is running, and it\'s worth '
    + 'a lot: the gap between the best power setting and the worst is most of what a machine pays. The arrow '
    + 'keys nudge it, the space bar pulls, and A turns on Auto so the handle pulls itself, and the number keys call a door when a row is lit.'],
  ['The pockets', (f) => 'A pocket is a cut in the board that catches a ball and pays for it. This machine has '
    + f.pays.length + ', paying ' + listOfPays(f.pays) + '. The ' + f.best + '-ball pocket is the hardest '
    + 'to reach. Balls that find no pocket run out through the OUT LANES at the bottom and are gone, which '
    + 'is most of them, and is why playing straight slowly loses ground.'],
  ['The slot and the reels', 'The slot is the narrow pocket in the middle of the board, under a funnel of '
    + 'nails. It pays nothing by itself. What it does is spin the three reels, and that makes it the pocket '
    + 'worth aiming everything at. The panel on the left prints the real odds, the way an arcade cabinet '
    + 'prints them on the glass.'],
  ['The bonus and the jackpot pocket', 'The JACKPOT POCKET is the wide pocket across the bottom of the '
    + 'board, and it\'s shut almost all of the time. When all three reels stop on the same digit a BONUS '
    + 'starts: the jackpot pocket swings open, the board runs nearly every falling ball straight into it, '
    + 'and it pays hard for the next hundred balls or so. A bonus can roll straight into another one, which '
    + 'the banner counts as a streak. This is the whole point of the game. Played straight the board pays '
    + 'back less than it takes, so a bonus is the only way a round finishes ahead.'],
  ['What the machine sends back', 'Now and then the machine sends something out: a lit stripe that pays more for a while, '
    + 'its own creature crossing the board, a spare pocket, or a row of doors. The doors are a game. Click a door '
    + 'to call it while the row is lit: right pays as many times over as there are doors, wrong pays nothing, and '
    + 'left alone the paying door opens by itself. Every machine lights its own number of doors. Parts you bolt in '
    + 'show on the machine too: nail parts warm the nails, slot parts brighten the slot, rail parts run a second '
    + 'rail, and glass parts thicken the sheet.'],
  ['A round and its goal', 'A round rents the machine for a set number of PULLS and asks you to win a set number of balls back, which is the GOAL. Meet the goal and the counter pays a bonus of balls and the next round starts, harder. Miss it and the game is over. Later rounds send several balls per pull, so the same number of pulls puts far more on the board.'],
  ['The workbench', (f) => 'Between rounds the machine opens up. Parts are for sale, paid for with the balls you '
    + 'haven\'t launched, and a part changes how this machine behaves for the rest of the game. Up to '
    + f.slots + ' can be in the machine at once, and clicking one already in takes it back out. Some parts work '
    + 'together, and the card says so when they do.'],
  ['Bending the nails', 'Also at the workbench: drag any nail on the board to the right to bend it. Bending steers where balls fall, and there are only a few bends per round, so the good ones are the nails that feed balls into the slot. The chart at the workbench shows where the last round actually ended up, which is how you tell which nails are worth bending.'],
  ['Picking a machine', (f) => 'There are ' + f.machines + ' machines, and the pockets, the slot and the funnel sit somewhere else on each. Each lights its own number of doors and sends its own creature across the board. Change machine at the top of the screen to see three of them measured for you. The number that matters most is how many balls come back for each ball spent. Picking a machine starts a new game, so what you win on a machine is worth checking before you sit down for hours.'],
  ['Coins and your arcade', 'Cash your balls in at the counter and they become COINS. Coins buy machines for your arcade. Those machines earn coins every second on their own, including while the page is closed. What they earn is multiplied by how far you\'ve gotten at the handle, so playing well is the best thing you can do for the arcade.'],
  ['Stars and starting over', 'Once the arcade is large enough you can sell all of it and build it again from nothing. Doing that pays STARS. Stars buy permanent upgrades that survive every restart. The arcade rebuilds far faster the second time, and starting over never takes stars away.'],
];

function index(doc) {
  const $ = (id) => doc.getElementById(id);
  return {
    title: $('title'), tagline: $('tagline'),
    roundNo: $('roundNo'), cabinet: $('cabinet'), wonNow: $('wonNow'), quotaNo: $('quotaNo'),
    quotaTube: $('quotaTube'), perBall: $('perBall'),
    handle: $('handle'), strengthOut: $('strengthOut'), perPull: $('perPull'),
    pull: $('pull'), auto: $('auto'), speed: $('speed'), mouths: $('mouths'),
    oddsMatch: $('oddsMatch'), oddsCont: $('oddsCont'), oddsGate: $('oddsGate'), oddsBack: $('oddsBack'),
    scrip: $('scrip'), income: $('income'), handMult: $('handMult'), cash: $('cash'),
    log: $('log'), rail: $('rail'), face: $('face'), canvas: $('view'),
    banner: $('banner'), hint: $('hint'), flyer: $('flyer'), tip: $('tip'),
    toRow: $('toRow'), rowSheet: $('row'), rowTitle: $('rowTitle'), rowLede: $('rowLede'),
    cabinets: $('cabinets'), rowLater: $('rowLater'),
    toFloor: $('toFloor'), toSettings: $('toSettings'), toHelp: $('toHelp'),
    benchSheet: $('bench'), benchLede: $('benchLede'), offers: $('offers'),
    owned: $('owned'), slotCount: $('slotCount'), bendLede: $('bendLede'), bendChart: $('bendChart'), bendBars: $('bendBars'),
    nights: $('nights'), nightsLede: $('nightsLede'), floorHint: $('floorHint'),
    reroll: $('reroll'), leave: $('leave'), straighten: $('straighten'),
    floorSheet: $('floor'), floorLede: $('floorLede'), bulkbar: $('bulkbar'),
    machines: $('machines'), prestigeBox: $('prestigeBox'), closeFloor: $('closeFloor'),
    settingsSheet: $('settings'), fpsTarget: $('fpsTarget'), fpsOut: $('fpsOut'),
    scaleSlider: $('scaleSlider'), scaleOut: $('scaleOut'),
    tShadows: $('tShadows'), tReflect: $('tReflect'), tGlass: $('tGlass'), tAuto: $('tAuto'),
    mFps: $('mFps'), mScale: $('mScale'), mBalls: $('mBalls'), mPins: $('mPins'),
    newRun: $('newRun'), wipe: $('wipe'), closeSettings: $('closeSettings'),
    helpSheet: $('help'), helpBody: $('helpBody'), closeHelp: $('closeHelp'),
    toBests: $('toBests'), bestsSheet: $('bests'), bestsBody: $('bestsBody'), bestsLede: $('bestsLede'), closeBests: $('closeBests'),
    bestsLine: $('bestsLine'), shareBests: $('shareBests'),
    primerSheet: $('primer'), primerGo: $('primerGo'),
  };
}

/** Puts the configured name and colors onto a page that shipped with neither. */
export function applyIdentity(doc, cfg, el) {
  doc.title = cfg.identity.name;
  if (el.title) el.title.textContent = cfg.identity.name;
  if (el.tagline) el.tagline.textContent = cfg.identity.tagline;
  const root = doc.documentElement;
  if (!root || !root.style || typeof root.style.setProperty !== 'function') return;
  const map = {
    lacquer: '--lacquer', lacquer2: '--lacquer2', lamp: '--lamp', brass: '--brass',
    brassLit: '--brass-lit', chrome: '--chrome', chromeLit: '--chrome-lit',
    enamel: '--enamel', enamel2: '--enamel2', jade: '--jade', oxblood: '--oxblood',
    ink: '--ink', dim: '--dim', rule: '--rule',
  };
  for (const key of Object.keys(map)) {
    if (cfg.palette[key]) root.style.setProperty(map[key], cfg.palette[key]);
  }
}

function on(node, event, fn) { if (node && node.addEventListener) node.addEventListener(event, fn); }
function show(node) { if (node) node.hidden = false; }
function hide(node) { if (node) node.hidden = true; }
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
