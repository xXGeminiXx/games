// ---------------------------------------------------------------------------
// The page.
//
// Everything the player touches, and nothing they do not. The game holds the
// rules; this file turns a reading of the game into enamel plaques, a brass
// counter rail and three sheets, and turns clicks back into calls.
//
// Two things it is careful about.
//
// Nothing here is ever announced only by movement or only by colour. Every
// state that matters is a word and a number as well, because a signal that
// needs sound or a steady eye to catch is a signal some players never get.
//
// The face is drawn by the renderer and clicked by this file, and both use the
// same fit, so a nail is exactly where it looks like it is.
// ---------------------------------------------------------------------------

import { createGame, VIEW_MACHINE, VIEW_BENCH, VIEW_FLOOR } from './game.js?v=1';
import { createScene } from './render/scene.js?v=1';
import { fitBoard, pixelToBoard } from './render/layout.js?v=1';
import { num, count, duration, mult, pct, fill } from './format.js?v=1';
import { BULK_STEPS, bulkLabel } from './economy.js?v=1';
import { nailPos } from './board.js?v=1';

const SPEEDS = [1, 2, 4];

export async function boot(doc) {
  const game = await createGame({});
  const cfg = game.cfg;
  const el = index(doc);

  applyIdentity(doc, cfg, el);

  const scene = startScene(doc, el, cfg, game);
  if (scene) game.attach(scene);

  let bulk = 10;
  let speedIndex = 0;
  // Declared with the rest of the state rather than beside the function that
  // uses it: the first paint happens before boot has finished running, so
  // anything it reads has to already exist.
  let lastLog = 0;
  let shownRow = false;

  wire();
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
    on(el.pull, 'click', () => game.pull());
    on(el.auto, 'click', () => game.setAuto(!game.run.auto));
    on(el.speed, 'click', () => {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      game.setSpeed(SPEEDS[speedIndex]);
    });
    on(el.handle, 'input', () => game.setStrength(Number(el.handle.value)));
    on(el.cash, 'click', () => confirmCash());

    on(el.toRow, 'click', () => openRow());
    on(el.rowLater, 'click', () => hide(el.rowSheet));
    on(el.toFloor, 'click', () => openFloor());
    on(el.closeFloor, 'click', () => hide(el.floorSheet));
    on(el.toSettings, 'click', () => openSettings());
    on(el.closeSettings, 'click', () => hide(el.settingsSheet));
    on(el.toHelp, 'click', () => openHelp());
    on(el.closeHelp, 'click', () => hide(el.helpSheet));

    on(el.reroll, 'click', () => { game.reroll(); paintBench(); });
    on(el.leave, 'click', () => { game.leaveBench(); hide(el.benchSheet); });
    on(el.straighten, 'click', () => { game.straightenAll(); paintBench(); });

    on(el.newRun, 'click', () => {
      if (confirm(cfg.text.newRun + '? The night you are on ends now.')) {
        game.newRun(); hide(el.settingsSheet);
      }
    });
    on(el.wipe, 'click', () => {
      if (confirm('Erase the parlour, the floor and everything the technician learned? This cannot be undone.')) {
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
      if (e.key === ' ') { e.preventDefault(); game.pull(); }
      else if (e.key === 'a' || e.key === 'A') game.setAuto(!game.run.auto);
      else if (e.key === 'ArrowLeft') game.setStrength(game.run.strength - 0.01);
      else if (e.key === 'ArrowRight') game.setStrength(game.run.strength + 0.01);
      else if (e.key === 'Escape') { hide(el.floorSheet); hide(el.settingsSheet); hide(el.helpSheet); }
      else if (e.key === 'f' || e.key === 'F') openFloor();
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
    const rect = el.face.getBoundingClientRect();
    return {
      fit: fitBoard(rect.width, rect.height, game.run.board.w, game.run.board.h),
      rect,
    };
  }

  function onFacePointer(e) {
    if (game.view !== VIEW_BENCH) return;
    const { fit, rect } = faceFit();
    const p = pixelToBoard(fit, e.clientX - rect.left, e.clientY - rect.top);
    const i = game.nailAt(p.x, p.y, 4);
    if (i < 0) { say('No nail there. Click a nail, then drag it.'); return; }
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
      say(r.ok ? 'Nail leaned. ' + game.bendsLeft() + ' left this round.' : r.why);
      paintBench();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  // ---- painting ------------------------------------------------------
  function paint(r) {
    el.roundNo.textContent = r.round;
    el.wonNow.textContent = num(r.won);
    el.quotaNo.textContent = num(r.quota);
    const done = Math.min(1, r.quota > 0 ? r.won / r.quota : 0);
    el.quotaTube.firstElementChild.style.width = (done * 100).toFixed(1) + '%';
    el.quotaTube.classList.toggle('done', done >= 1);
    el.perBall.textContent = r.won >= r.quota
      ? 'Cleared. The counter pays ' + num(r.nextBonus) + ' balls.'
      : num(r.pullsLeft) + ' pulls left' + (r.perPull > 1 ? ' at ' + r.perPull + ' balls each' : '')
        + ', ' + r.perBall.toFixed(2) + ' a ball needed from them';

    el.strengthOut.textContent = r.strength.toFixed(2);
    if (doc.activeElement !== el.handle) el.handle.value = String(r.strength);
    el.handle.disabled = !!r.locked;
    el.perPull.textContent = num(r.perPull);
    el.auto.classList.toggle('on', r.auto);
    el.speed.textContent = SPEEDS[speedIndex] + 'x';
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
      if (el.rowSheet.hidden && !shownRow) { shownRow = true; openRow(); }
    } else if (!el.helpSheet.hidden || r.stats.launched > 6) {
      // once the player is going, the hint belongs to whatever is happening
    } else {
      el.hint.textContent = cfg.text.firstLine;
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
      ['Tray', count(r.tray), false],
      ['Won', count(r.won), false],
      ['Pulls left', count(r.pullsLeft) + ' of ' + count(r.pulls), false],
      ['In flight', count(r.inFlight), false],
      ['Gates', count(r.stats.gates), false],
      ['Fevers', count(r.stats.fevers), r.fever],
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
    if (r.fever) {
      el.banner.hidden = false;
      el.banner.textContent = cfg.text.fever + ' - ' + r.feverLeft + ' balls'
        + (r.feverChain > 1 ? ' - chain ' + r.feverChain : '');
    } else if (r.settling) {
      el.banner.hidden = false;
      el.banner.textContent = 'Letting the face clear';
    } else if (r.reel && r.reel.spinning) {
      el.banner.hidden = false;
      el.banner.textContent = 'Reels turning';
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
    el.benchLede.textContent = 'Round ' + r.round + ' is cleared. The machine is on the bench: bolt a part in, '
      + 'lean a nail, then start the next round. The tray is your money here - '
      + count(r.tray) + ' balls.';

    el.offers.textContent = '';
    game.offers().forEach((offer, i) => {
      const f = offer.fitting;
      const card = doc.createElement('div');
      card.className = 'card' + (offer.partners.length ? ' combo' : '');
      const text = describe(f);
      card.innerHTML = '<div class="rar"></div><h4></h4><p></p>'
        + (offer.partners.length ? '<div class="combos"></div>' : '')
        + '<div class="price"><span></span></div>';
      card.querySelector('.rar').textContent = f.rarity;
      card.querySelector('h4').textContent = f.name;
      card.querySelector('p').textContent = text;
      if (offer.partners.length) {
        card.querySelector('.combos').textContent = 'Works with ' + offer.partners.map(nameOf).join(', ');
      }
      card.querySelector('.price span').textContent = num(offer.price) + ' balls';
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Bolt in';
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
    for (const id of r.fittings) {
      const chip = doc.createElement('span');
      chip.className = 'chip';
      chip.textContent = nameOf(id);
      chip.title = 'Click to unbolt';
      chip.addEventListener('click', () => { game.sellFitting(id); paintBench(); });
      el.owned.appendChild(chip);
    }
    if (!r.fittings.length) el.owned.textContent = 'Nothing bolted in yet.';

    paintLanding();
    el.bendLede.textContent = 'Drag a nail on the face, to the right, to lean it. '
      + game.bendsLeft() + ' of ' + (cfg.board.bendsPerRound) + ' bends left, '
      + r.bends + ' nails currently leaning. A nail cannot be leaned into another nail, '
      + 'into a mouth, or further than its head will go.';

    el.reroll.textContent = 'Reroll for ' + num(game.rerollPrice()) + ' balls';
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
      el.bendChart.textContent = 'Play a round and this fills in with where the balls actually went.';
      return;
    }
    const peak = Math.max(...src);
    // A column nothing reached still has to be drawn, or the chart collapses
    // into blanks and reads as broken rather than as empty.
    const blocks = '.:-=+*oO#@';
    let bar = '';
    for (let i = 0; i < src.length; i++) {
      const t = peak > 0 ? src[i] / peak : 0;
      bar += blocks[Math.min(blocks.length - 1, Math.round(t * (blocks.length - 1)))];
    }
    const paid = sum(paidSrc);
    el.bendChart.textContent = 'Where the balls went, left to right across the face:  ' + bar
      + '   (' + count(paid) + ' of ' + count(total) + ' landed somewhere that paid)';
  }

  function sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }

  function describe(f) {
    const cat = game.catalogue;
    if (cat && typeof cat.describe === 'function') {
      try {
        const s = cat.describe(f, { model: game.catalogueModel() });
        if (typeof s === 'string' && s) return s;
      } catch (e) { /* fall through to the plain text */ }
    }
    return String(f.text || '').replace(/\{\w+%?\}/g, '');
  }

  function nameOf(id) {
    const f = game.bench.byId.get(id);
    return f ? f.name : id;
  }

  // ---- the row of machines -------------------------------------------
  function openRow() {
    show(el.rowSheet);
    // Reading a row means putting a few hundred balls through three boards,
    // which takes long enough to be seen. The sheet is put up first and says
    // what it is doing, so the pause reads as work rather than as a hang.
    if (game.row) { paintRow(); return; }
    el.rowLede.textContent = 'Trying each machine...';
    el.cabinets.textContent = '';
    requestAnimationFrame(() => requestAnimationFrame(paintRow));
  }

  function paintRow() {
    const r = game.reading();
    el.rowTitle.textContent = r.over ? 'The night is over' : 'Walk the row';
    el.rowLede.textContent = r.over
      ? 'Round ' + r.round + ' beat the machine. Cash the tray out at the counter, then pick where to sit next. '
        + 'No two cabinets are nailed the same, and the numbers below were measured on these three.'
      : 'Every cabinet is nailed differently. These three were each given a few hundred balls at several '
        + 'handle settings; what is shown is the best each one managed. Sitting down starts a new night.';

    el.cabinets.textContent = '';
    for (const cab of game.cabinets()) {
      const d = doc.createElement('div');
      d.className = 'cab';
      d.innerHTML = '<h4></h4><div class="big"></div><p></p>'
        + '<dl><dt>Nails</dt><dd class="n1"></dd><dt>Rows</dt><dd class="n2"></dd>'
        + '<dt>Back per ball</dt><dd class="n3"></dd></dl>';
      d.querySelector('h4').textContent = cab.name;
      d.querySelector('.big').textContent = pct(cab.gate) + ' to the gate';
      d.querySelector('p').textContent = cab.line;
      d.querySelector('.n1').textContent = count(cab.nails);
      d.querySelector('.n2').textContent = cab.leanWord;
      d.querySelector('.n3').textContent = cab.back.toFixed(2);
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Sit at ' + cab.name;
      b.addEventListener('click', () => {
        if (r.tray > 0 && !confirm('Sitting down starts a new night. The ' + count(r.tray)
            + ' balls in the tray are cashed out first, for ' + num(game.cashOutValue()) + ' scrip. Go ahead?')) return;
        if (r.tray > 0) game.cashOut();
        game.sitAt(cab.seed);
        hide(el.rowSheet);
      });
      d.appendChild(b);
      el.cabinets.appendChild(d);
    }
  }

  // ---- the floor -----------------------------------------------------
  function openFloor() { show(el.floorSheet); paintFloor(); }

  function paintFloor() {
    const r = game.reading();
    el.floorLede.textContent = 'The floor earns ' + num(r.income) + ' scrip a second whether you are at the handle '
      + 'or not, and everything on it is multiplied by ' + mult(game.handMultiplier())
      + ' because you have taken a night to round ' + Math.max(r.bestRound, 0) + '. You hold ' + num(r.scrip) + '.';

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
    body.textContent = '';
    for (const m of cfg.floor.machines) {
      const q = game.quoteMachine(m.id, bulk);
      const mile = game.milestone(m.id);
      const affordable = q.k > 0;
      const seen = mile.owned > 0 || game.floor.scrip >= m.cost * 0.25;
      if (!seen) continue;

      const tr = doc.createElement('tr');
      if (!affordable) tr.className = 'poor';
      tr.innerHTML = '<td></td><td class="n"></td><td class="n"></td><td class="n"></td><td></td><td></td>';
      const cells = tr.children;
      cells[0].textContent = m.name;
      cells[1].textContent = count(mile.owned) + (mile.mult > 1 ? '  ' + mult(mile.mult) : '');
      cells[2].textContent = num(game.machineIncome(m.id)) + ' /s';
      cells[3].textContent = q.k > 0 ? num(q.cost) : num(game.quoteMachine(m.id, 1).cost || 0);

      const buy = doc.createElement('button');
      buy.type = 'button';
      buy.textContent = q.k > 0 ? 'Buy ' + count(q.k) : 'Buy';
      buy.disabled = !affordable;
      buy.addEventListener('click', () => { game.buyMachine(m.id, bulk); paintFloor(); });
      cells[4].appendChild(buy);

      if (mile.next) {
        const note = doc.createElement('span');
        note.style.fontSize = '11px';
        note.style.color = '#8c7f76';
        note.textContent = (mile.next - mile.owned) + ' more doubles it';
        cells[5].appendChild(note);
      } else if (mile.owned > 0) {
        cells[5].textContent = 'every doubling taken';
      }
      body.appendChild(tr);
    }
    if (!body.children.length) {
      const tr = doc.createElement('tr');
      tr.innerHTML = '<td colspan="6">Cash a tray out at the machine and the first cabinet comes within reach.</td>';
      body.appendChild(tr);
    }

    paintPrestige();
  }

  function paintPrestige() {
    const m = game.metaModule;
    el.prestigeBox.textContent = '';
    if (!m || typeof m.pendingMarks !== 'function') return;
    const pending = game.pendingMarks();
    const can = typeof m.canReset === 'function' ? m.canReset(cfg, game.meta, game.floor) : { ok: false, why: '' };

    const h = doc.createElement('h3');
    h.textContent = 'The technician';
    el.prestigeBox.appendChild(h);

    const p = doc.createElement('p');
    p.className = 'lede';
    p.textContent = can.ok
      ? 'Let the technician re-nail every board overnight. The floor goes; ' + num(pending)
        + ' marks stay, and marks buy things that never go away.'
      : (can.why || 'Not yet worth calling anybody in.');
    el.prestigeBox.appendChild(p);

    if (can.ok) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Re-nail the floor for ' + num(pending) + ' marks';
      b.addEventListener('click', () => {
        if (confirm('Every machine on the floor goes. You keep ' + num(pending) + ' marks. Do it?')) {
          game.prestige(); paintFloor();
        }
      });
      el.prestigeBox.appendChild(b);
    }

    if (Array.isArray(m.NODES) && m.NODES.length) {
      const wrap = doc.createElement('div');
      wrap.className = 'nodes';
      wrap.style.marginTop = '10px';
      for (const node of m.NODES) {
        const have = game.meta.nodes && game.meta.nodes[node.id];
        const d = doc.createElement('div');
        d.className = 'node' + (have ? ' have' : '');
        d.innerHTML = '<h4></h4><p></p>';
        d.querySelector('h4').textContent = node.name;
        d.querySelector('p').textContent = node.text;
        if (!have) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.textContent = num(node.cost) + ' marks';
          b.disabled = (game.meta.marks || 0) < node.cost;
          b.addEventListener('click', () => { const r = game.buyNode(node.id); if (!r.ok) say(r.why); paintFloor(); });
          d.appendChild(b);
        }
        wrap.appendChild(d);
      }
      el.prestigeBox.appendChild(wrap);
    }
  }

  // ---- settings and help ---------------------------------------------
  function openSettings() { show(el.settingsSheet); paintSettings(); }

  function paintSettings() {
    const q = game.quality;
    const idx = Math.max(0, cfg.quality.targetChoices.indexOf(q.target));
    el.fpsTarget.value = String(idx < 0 ? 2 : idx);
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

  function openHelp() {
    show(el.helpSheet);
    if (el.helpBody._built) return;
    el.helpBody._built = true;
    el.helpBody.innerHTML = HELP.map(([h, body]) => '<h3>' + h + '</h3><p class="lede">' + body + '</p>').join('');
  }

  function confirmCash() {
    const worth = game.cashOutValue();
    const msg = fill(cfg.text.cashOutAsk, { balls: count(game.run.tray), scrip: num(worth) });
    if (confirm(msg)) game.cashOut();
  }

  function showAway(away) {
    const line = away.capped
      ? 'You were away ' + duration(away.away) + '. The floor pays for the first '
        + duration(away.paid) + ' of that, which came to ' + num(away.gained) + ' scrip.'
      : 'You were away ' + duration(away.away) + '. The floor made ' + num(away.gained) + ' scrip.';
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
      elements.hint.textContent = 'This browser could not start the machine face: ' + (e && e.message ? e.message : e);
      return null;
    }
  }
}

const HELP = [
  ['The round', 'A round rents the machine for a number of PULLS and asks for a number of balls back. '
    + 'Later the machine sends several balls a pull, so the same number of pulls puts far more on the face - '
    + 'a round stays about as long as it ever was while the rain in it gets heavier. Clearing pays a bonus '
    + 'into the tray, and the sooner you clear the more of the rental you have left over.'],
  ['The handle', 'Strength decides how far around the outer rail a ball gets before it drops onto the face. '
    + 'It is the only thing you control while a round is running, and it matters: the difference between the best '
    + 'setting and the worst is most of what the machine pays. Arrow keys nudge it, space pulls, A runs the handle by itself.'],
  ['The gate', 'The narrow mouth in the middle. A ball through it spins the reels. Three matching digits open '
    + 'the attacker, and while the attacker is open the plates run almost everything into it. The odds are printed '
    + 'on the plaque, the way a real cabinet prints them on the glass. Nothing is hidden and nothing is arranged.'],
  ['The nails', 'Between rounds the machine goes on the bench and you can lean the nails. Drag one. A single nail '
    + 'in the right place is worth several times the gate rate; the wrong one closes the board. Watch where balls '
    + 'have been landing and lean the nails that feed the gate. This is the whole craft of the thing.'],
  ['The tray', 'Launching costs a ball. Pockets pay balls. Played straight the face pays back less than it takes, '
    + 'so a round only comes out ahead through a fever. The tray is also the money at the bench: parts and rerolls '
    + 'are bought with the balls you have not spent.'],
  ['The floor', 'Cash a tray out and it becomes scrip, which buys machines. Machines earn on their own. What they '
    + 'earn is multiplied by how deep you have taken a night at the handle, so playing is always the best thing '
    + 'you can do for the floor.'],
];

function index(doc) {
  const $ = (id) => doc.getElementById(id);
  return {
    title: $('title'), tagline: $('tagline'),
    roundNo: $('roundNo'), wonNow: $('wonNow'), quotaNo: $('quotaNo'),
    quotaTube: $('quotaTube'), perBall: $('perBall'),
    handle: $('handle'), strengthOut: $('strengthOut'), perPull: $('perPull'),
    pull: $('pull'), auto: $('auto'), speed: $('speed'),
    oddsMatch: $('oddsMatch'), oddsCont: $('oddsCont'), oddsGate: $('oddsGate'), oddsBack: $('oddsBack'),
    scrip: $('scrip'), income: $('income'), handMult: $('handMult'), cash: $('cash'),
    log: $('log'), rail: $('rail'), face: $('face'), canvas: $('view'),
    banner: $('banner'), hint: $('hint'), flyer: $('flyer'),
    toRow: $('toRow'), rowSheet: $('row'), rowTitle: $('rowTitle'), rowLede: $('rowLede'),
    cabinets: $('cabinets'), rowLater: $('rowLater'),
    toFloor: $('toFloor'), toSettings: $('toSettings'), toHelp: $('toHelp'),
    benchSheet: $('bench'), benchLede: $('benchLede'), offers: $('offers'),
    owned: $('owned'), slotCount: $('slotCount'), bendLede: $('bendLede'), bendChart: $('bendChart'),
    reroll: $('reroll'), leave: $('leave'), straighten: $('straighten'),
    floorSheet: $('floor'), floorLede: $('floorLede'), bulkbar: $('bulkbar'),
    machines: $('machines'), prestigeBox: $('prestigeBox'), closeFloor: $('closeFloor'),
    settingsSheet: $('settings'), fpsTarget: $('fpsTarget'), fpsOut: $('fpsOut'),
    scaleSlider: $('scaleSlider'), scaleOut: $('scaleOut'),
    tShadows: $('tShadows'), tReflect: $('tReflect'), tGlass: $('tGlass'), tAuto: $('tAuto'),
    mFps: $('mFps'), mScale: $('mScale'), mBalls: $('mBalls'), mPins: $('mPins'),
    newRun: $('newRun'), wipe: $('wipe'), closeSettings: $('closeSettings'),
    helpSheet: $('help'), helpBody: $('helpBody'), closeHelp: $('closeHelp'),
  };
}

/** Puts the configured name and colours onto a page that shipped with neither. */
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
