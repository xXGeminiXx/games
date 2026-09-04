// ---------------------------------------------------------------------------
// Bolting a fitting into the machine.
//
// A fitting is described in the language of what it does to the odds: a wider
// gate, a richer cream mouth, a longer fever. The machine is not built out of
// odds. It is built out of a face with mouths cut in it, nails driven into it
// and plates screwed across it, and every number a player reads is something
// that face does.
//
// This file is the join between the two. It takes what the fittings say and
// turns it into geometry and into the handful of multipliers a round carries,
// so that a part promising a wider gate widens the gate the player is looking
// at rather than quietly adding to a hidden number.
//
// The conversion rates below were measured on this board, not assumed:
//
//   Gate mouth      widening it by one unit is worth about 0.42 points of gate
//                   chance, and it stops helping past about twice its width,
//                   because a mouth wider than the funnel that feeds it is
//                   only a wider way to miss.
//   Pay mouths      one unit of width is worth about 2.1 points of catch.
//   Attacker        already takes about three quarters of everything while it
//                   is open, so width past that buys very little.
//
// Anything a fitting promises past what the face can physically deliver is
// paid in held spins instead: the ball still has to go through the gate, and
// the machine simply remembers more of them. Real cabinets do exactly this,
// and it keeps every promise honest.
// ---------------------------------------------------------------------------

import { createBoard, addPin, removePinsNear, rebuild, nailPos, plateClearance, clearOfPlates, clearNailsAlongPlate, liftPocketsOffPlates, POCKET_PAY, POCKET_GATE } from './board.js?v=63';
import { baseMods } from './run.js?v=63';
import { rng as makeRng } from './rng.js?v=63';

// Board units of mouth width per point of probability, measured.
const GATE_UNITS_PER_POINT = 1 / 0.0042;
const POCKET_UNITS_PER_POINT = 1 / 0.021;
const GATE_WIDTH_CEILING = 2.0;      // multiples of the mouth as built
const SPINS_PER_LEFTOVER_POINT = 9;  // held spins bought by what width cannot deliver

/** A deep copy of the configuration that a run may then have bolted into it. */
export function runConfig(cfg) {
  return JSON.parse(JSON.stringify(cfg));
}

/**
 * Works out what a set of fittings does to a machine.
 *
 * Returns a patched configuration, the multipliers a round should carry, and
 * the list of board changes still to be made once the board exists. Nothing is
 * mutated: the caller decides when the machine goes on the bench.
 */
export function fitMachine(cfg, catalogue, ids, extra) {
  const out = runConfig(cfg);
  const mods = baseMods();
  const notes = [];
  const shape = { addPins: 0, removePins: 0, bumpers: 0, slope: 0, diverter: 0, shutter: 0, gates: 1, duplicateLower: 0, frosted: 0 };

  const model = modelFor(catalogue, ids);
  if (!model) return { cfg: out, mods: applyExtra(mods, extra), notes, shape };
  const base = catalogue.BASE_MODEL || {};
  const d = (key) => {
    const a = Number(model[key]), b = Number(base[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return a - b;
  };
  const ratio = (key) => {
    const a = Number(model[key]), b = Number(base[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 1;
    return a / b;
  };

  // ---- the gate --------------------------------------------------------
  const gateGain = d('gateProb');
  if (gateGain !== 0) {
    const built = cfg.board.gate.w;
    const wanted = gateGain * 100 * GATE_UNITS_PER_POINT * 0.01;
    const room = built * (GATE_WIDTH_CEILING - 1);
    const widened = Math.max(-built * 0.55, Math.min(room, wanted));
    out.board.gate.w = round2(built + widened);
    // What the mouth could not deliver is converted back out of board units
    // into the chance it stood for, and paid in held spins. Getting this
    // conversion the wrong way round turns a modest part into a hundred spins
    // a ball, so it is done in one place and clamped.
    const leftoverProb = Math.max(0, (wanted - widened) / GATE_UNITS_PER_POINT);
    if (leftoverProb > 0) {
      mods.spinsPerGate = Math.min(4, mods.spinsPerGate + leftoverProb * SPINS_PER_LEFTOVER_POINT);
    }
    notes.push(gateGain > 0 ? 'the gate mouth is wider' : 'the gate mouth is tighter');
  }

  // ---- the pay mouths --------------------------------------------------
  widenPockets(out, ['side0', 'side1'], d('sideProb'), notes, 'the side shelves');
  widenPockets(out, ['cream0', 'cream1'], d('creamProb'), notes, 'the cream mouths');
  widenPockets(out, ['jade'], d('jadeProb'), notes, 'the jade mouth', true);

  setPay(out, ['side0', 'side1'], model.sidePay, base.sidePay);
  setPay(out, ['cream0', 'cream1'], model.creamPay, base.creamPay);
  setPay(out, ['jade'], model.jadePay, base.jadePay);

  // ---- the attacker ----------------------------------------------------
  const atkGain = d('attackerProb');
  if (atkGain !== 0) {
    out.board.attacker.w = round2(clamp(cfg.board.attacker.w * (1 + atkGain * 0.9), 6, cfg.board.w * 0.42));
    notes.push(atkGain > 0 ? 'the attacker opens wider' : 'the attacker opens less far');
  }
  if (d('attackerPay') !== 0 && Number.isFinite(base.attackerPay) && base.attackerPay > 0) {
    out.fever.attackerPay = round2(cfg.fever.attackerPay * (model.attackerPay / base.attackerPay));
  }

  // ---- the fever -------------------------------------------------------
  if (d('feverLen') !== 0 && Number.isFinite(base.feverLen) && base.feverLen > 0) {
    out.fever.balls = Math.max(1, Math.round(cfg.fever.balls * (model.feverLen / base.feverLen)));
  }
  mods.feverMult *= safeRatio(ratio('feverMult'));
  // A continuation is written in points in the catalogue and in a share here.
  mods.continueBonus += d('continuationAdd') / 100;

  // ---- the handle ------------------------------------------------------
  if (d('inFlight') !== 0 && Number.isFinite(base.inFlight) && base.inFlight > 0) {
    out.launch.perLaunch = Math.max(1, Math.round(cfg.launch.perLaunch * (model.inFlight / base.inFlight)));
  }
  if (d('aimWindow') !== 0 && Number.isFinite(base.aimWindow) && base.aimWindow > 0) {
    // A narrower aim window is a steadier machine, which is a smaller slop.
    out.launch.spread = round3(clamp(cfg.launch.spread * (model.aimWindow / base.aimWindow), 0.005, 0.3));
  }
  // Only when a part actually moved it. The catalogue's launch floor is
  // measured in seconds between launches and the configured one is a position
  // on the handle; reading one onto the other on a machine with nothing bolted
  // in silently changes the range of the only control the player has.
  if (d('launchFloor') !== 0 && Number.isFinite(base.launchFloor) && base.launchFloor > 0) {
    const scale = model.launchFloor / base.launchFloor;
    out.launch.strengthMin = clamp(cfg.launch.strengthMin * scale, 0.05, 0.9);
  }
  if (d('flightTime') !== 0 && Number.isFinite(base.flightTime) && model.flightTime > 0) {
    // A longer flight is a lighter ball, which is less gravity and more nails
    // struck on the way down.
    out.physics.gravity = round2(cfg.physics.gravity * Math.pow(base.flightTime / model.flightTime, 2));
  }
  if (Number.isFinite(model.lockStrength) && model.lockStrength > 0) out.launch.locked = true;

  // ---- the reels -------------------------------------------------------
  // The reels are only re-cut when something actually changed them. Reading
  // the catalogue's own starting numbers back onto a machine with nothing
  // bolted into it would quietly replace the odds printed on the plaque.
  if (d('stripStops') !== 0 || d('sevenStops') !== 0) {
    if (Number.isFinite(model.stripStops) && model.stripStops > 1) {
      out.reels.digits = Math.max(2, Math.round(model.stripStops));
    }
    const wasChance = Number(base.sevenStops) / Number(base.stripStops);
    const nowChance = Number(model.sevenStops) / Number(model.stripStops);
    if (Number.isFinite(wasChance) && Number.isFinite(nowChance) && wasChance > 0) {
      out.reels.matchChance = clamp(cfg.reels.matchChance * (nowChance / wasChance), 0.01, 0.9);
    }
  }

  // The chance three reels agree. The catalogue keeps it as two numbers - how
  // often the outer two land together, and how often the middle one joins them
  // - and the run carries the whole thing as one bonus, so what the parts make
  // of the pair over what the bare machine makes of it is that bonus. Without
  // this, four parts in the catalogue described the reels in a language nothing
  // read and changed nothing at all.
  const matchNow = Number(model.reachProb) * Number(model.middleWeight);
  const matchWas = Number(base.reachProb) * Number(base.middleWeight);
  if (Number.isFinite(matchNow) && Number.isFinite(matchWas) && matchNow !== matchWas) {
    mods.matchBonus += matchNow - matchWas;
  }
  // What a ball through the slot pays on its own. Held as the DIFFERENCE from
  // the bare machine, so a machine with nothing bolted in still pays what it
  // always paid and a part that says the slot pays two more really pays two
  // more.
  mods.gateBase += d('gatePay');

  // ---- the round ------------------------------------------------------
  mods.payMult *= safeRatio(ratio('payMul'));
  mods.quotaMult *= safeRatio(ratio('quotaMul'));
  // Launches, not tray balls. This used to add them to the tray, and a round
  // never runs out of tray - it runs out of the launches it is rented for - so
  // everything promising more pulls delivered nothing at all.
  mods.budget += Number.isFinite(model.budgetAdd) ? Math.round(model.budgetAdd) : 0;
  if (d('trayStart') !== 0 && Number.isFinite(base.trayStart) && base.trayStart > 0) {
    out.run.trayGrant = Math.max(1, Math.round(cfg.run.trayGrant * (model.trayStart / base.trayStart)));
  }
  if (d('slots') !== 0) out.shop.slots = Math.max(1, cfg.shop.slots + Math.round(d('slots')));
  if (d('shopSize') !== 0) out.shop.offers = Math.max(1, cfg.shop.offers + Math.round(d('shopSize')));

  // ---- the shape of the face -------------------------------------------
  for (const f of fittingsFor(catalogue, ids)) {
    const b = f && f.board;
    if (!b) continue;
    for (const k of Object.keys(shape)) {
      const v = Number(b[k]);
      if (Number.isFinite(v)) shape[k] = k === 'gates' ? Math.max(shape[k], v) : shape[k] + v;
    }
  }

  return { cfg: out, mods: applyExtra(mods, extra), notes, shape };
}

function widenPockets(out, ids, gain, notes, what, singular) {
  if (!gain) return;
  const units = gain * 100 * POCKET_UNITS_PER_POINT * 0.01 / Math.max(1, ids.length);
  let touched = false;
  for (const p of out.board.payPockets) {
    if (ids.indexOf(p.id) < 0) continue;
    const w = clamp(p.w + units, 2.9, 14);
    if (w !== p.w) { p.w = round2(w); touched = true; }
  }
  if (!touched) return;
  const verb = singular ? ' is ' : ' are ';
  notes.push(what + verb + (gain > 0 ? 'wider' : 'tighter'));
}

function setPay(out, ids, value, baseValue) {
  if (!Number.isFinite(value) || !Number.isFinite(baseValue) || baseValue <= 0) return;
  const r = value / baseValue;
  for (const p of out.board.payPockets) {
    if (ids.indexOf(p.id) >= 0) p.pay = Math.max(0, Math.round(p.pay * r));
  }
}

/**
 * Makes the face match a set of fittings.
 *
 * The board is built from the patched configuration and then the shape
 * directives are carried out on it, so a fitting that says it drives nails in
 * drives nails the player can see and the ball can strike.
 */
export function buildFittedBoard(fittedCfg, seed, shape) {
  const board = createBoard(fittedCfg, seed);
  if (!shape) return board;
  const r = makeRng('shape:' + seed);
  const b = fittedCfg.board;

  if (shape.gates > 1) {
    // A second mouth, cut to the left of the first and fed by its own pair of
    // shoulder nails so it is a gate rather than a hole.
    const g = fittedCfg.board.gate;
    board.pockets.push({
      id: 'gate2', kind: POCKET_GATE, label: fittedCfg.text.gate, open: true, pay: 0,
      x: b.fieldLeft + (g.x - b.fieldLeft) * 0.45, y: g.y + 4, w: g.w, h: g.h,
    });
  }
  if (shape.duplicateLower > 0) {
    const lower = board.pockets.filter(p => p.kind === POCKET_PAY && p.y > b.h * 0.6);
    lower.forEach((p, i) => {
      board.pockets.push({ ...p, id: p.id + ':copy' + i, x: clamp(p.x + (p.x < b.w / 2 ? -12 : 12), b.fieldLeft + 6, b.fieldRight - 6) });
    });
  }
  for (let i = 0; i < shape.removePins; i++) {
    const n = board.nails[Math.floor(r.next() * board.nails.length)];
    if (n) { const p = nailPos(n); removePinsNear(board, p.x, p.y, 0.1); }
  }
  for (let i = 0; i < shape.addPins; i++) {
    const spot = freeSpot(fittedCfg, board, r);
    if (spot) addPin(board, spot.x, spot.y, b.pinRadius);
  }
  for (let i = 0; i < shape.bumpers; i++) {
    const spot = freeSpot(fittedCfg, board, r, b.pinRadius * 2.4);
    if (spot) addPin(board, spot.x, spot.y, b.pinRadius * 2.4);
  }
  if (shape.slope) {
    // Steepening a plate walks it into nails that were driven clear of where
    // it used to lie, so the nails it has moved under come out with it.
    for (const g of board.guides) {
      g.y2 += shape.slope * 1.5;
      clearNailsAlongPlate(fittedCfg, board, g);
    }
  }
  // Mouths cut above and plates moved above are both new since the board was
  // built, and either can leave a mouth sitting on the chute - which catches
  // nearly everything that reaches it and pays more than a round is worth.
  liftPocketsOffPlates(fittedCfg, board);
  for (let i = 0; i < shape.diverter; i++) {
    const seg = plateSpot(fittedCfg, board, r);
    if (!seg) continue;
    // The plate goes down across a face that is already nailed, so it pulls
    // the nails it would otherwise trap a ball against - the same nails the
    // board would never have driven had the plate been there from the start.
    clearNailsAlongPlate(fittedCfg, board, seg);
    board.guides.push(seg);
  }
  return rebuild(board);
}

/** A place a nail can stand without closing a gap or blocking furniture. */
function freeSpot(cfg, board, r, radius) {
  const b = cfg.board;
  const rr = radius === undefined ? b.pinRadius : radius;
  const minSep = 2 * (cfg.physics.ballRadius + rr) + 0.2;
  for (let tries = 0; tries < 60; tries++) {
    const x = b.fieldLeft + 5 + r.next() * (b.fieldRight - b.fieldLeft - 10);
    const y = b.rowsTop + r.next() * (b.rowsTop + b.rows * b.rowStep - b.rowsTop);
    let ok = true;
    for (const n of board.nails) {
      const p = nailPos(n);
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < minSep * minSep) { ok = false; break; }
    }
    if (!ok) continue;
    if (!clearOfPlates(cfg, board, x, y)) continue;
    for (const q of board.pockets) {
      if (Math.abs(x - q.x) < q.w * 0.5 + minSep && Math.abs(y - q.y) < q.h * 0.5 + minSep) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return null;
}

/**
 * Where an extra plate can be laid across the face.
 *
 * A plate is a roof: whatever is under it stops receiving balls. Laid over a
 * mouth it shuts that mouth, and laid over the show screen it is a plate
 * nobody can see, so both are kept out from under it. The lattice underneath
 * is not a reason to reject a spot, because the nails in the way are pulled.
 */
function plateSpot(cfg, board, r) {
  const b = cfg.board;
  const half = 7, drop = 4;
  const clear = plateClearance(cfg);
  for (let tries = 0; tries < 40; tries++) {
    const y = b.fieldTop + (b.fieldBottom - b.fieldTop) * (0.3 + r.next() * 0.35);
    const x = b.fieldLeft + 8 + r.next() * (b.fieldRight - b.fieldLeft - 16);
    const seg = { x1: x - half, y1: y, x2: x + half, y2: y + drop };
    const roofs = (q) => {
      for (let s = 0; s <= 14; s++) {
        const px = seg.x1 + (seg.x2 - seg.x1) * (s / 14);
        const py = seg.y1 + (seg.y2 - seg.y1) * (s / 14);
        if (Math.abs(px - q.x) < q.w * 0.5 + clear && Math.abs(py - q.y) < q.h * 0.5 + clear) return true;
      }
      return false;
    };
    if (board.pockets.some(roofs)) continue;
    if (b.reel && roofs(b.reel)) continue;
    if (board.guides.some(g => Math.abs(g.y1 - seg.y1) < clear * 2)) continue;
    return seg;
  }
  return null;
}

function modelFor(catalogue, ids) {
  if (!catalogue || typeof catalogue.buildModel !== 'function') return null;
  try {
    return catalogue.buildModel(fittingsFor(catalogue, ids));
  } catch (e) {
    return null;
  }
}

function fittingsFor(catalogue, ids) {
  const all = Array.isArray(catalogue && catalogue.FITTINGS) ? catalogue.FITTINGS : [];
  const want = new Set(ids || []);
  return all.filter(f => f && want.has(f.id));
}

function applyExtra(mods, extra) {
  if (!extra || typeof extra !== 'object') return mods;
  const MULT = new Set(['payMult', 'gatePayMult', 'feverMult', 'launchRate', 'quotaMult', 'scatter', 'ballWorth']);
  for (const k of Object.keys(mods)) {
    const v = Number(extra[k]);
    if (!Number.isFinite(v)) continue;
    if (MULT.has(k)) mods[k] *= v; else mods[k] += v;
  }
  return mods;
}

function safeRatio(v) { return Number.isFinite(v) && v > 0 ? v : 1; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
