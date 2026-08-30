// ---------------------------------------------------------------------------
// Choosing a machine.
//
// Every cabinet on the floor is nailed differently. Two machines built to the
// same drawing pay differently, which is the whole reason a parlour is a row
// of machines rather than one machine, and the reason a regular walks the row
// before sitting down.
//
// So a night starts by picking one. Each candidate is described from its own
// face rather than from a label: how many nails are in it, which way its rows
// lean, how tight the funnel over the gate is, and how often a ball actually
// found the gate when the machine was tried.
//
// That last number is measured, not estimated. A short run of balls is put
// through the board at several settings and the best result is reported. What
// is deliberately NOT reported is which setting produced it: a player is told
// this machine is worth sitting at, and still has to find the handle position
// that proves it. Reading a board is the game.
// ---------------------------------------------------------------------------

import { createBoard, nailPos, layoutFor } from './board.js?v=21';
import { createBalls, launch, stepPhysics } from './physics.js?v=21';
import { rng as makeRng } from './rng.js?v=21';
import { skinForCabinet } from './render/themes.js?v=21';

/** How hard each candidate is tried, and at how many handle settings. */
// Enough balls that a good board is not reported by luck. At forty a single
// gate is worth two and a half points, which is the difference between an
// ordinary machine and the best on the floor; at a hundred and sixty it is
// well under one, and the best of several settings stops being mostly the
// luckiest of several settings.
// Two hundred and forty balls at each of five settings across the band the
// gate actually answers to (the handle sweep puts the gate at zero below 0.45
// and above 0.80). Fewer, fuller samples: the number on the card moved by
// twenty points between two seeds of one layout at a hundred and sixty.
const TRIAL_BALLS = 240;
const TRIAL_SETTINGS = [0.50, 0.56, 0.62, 0.68, 0.74];
const TRIAL_STEP_CAP = 1800;

/**
 * A row of machines to choose from.
 *
 * `seedFrom` seeds the choice itself, so the same night offers the same row.
 */
export function offerCabinets(cfg, seedFrom, count) {
  const r = makeRng('cabinets:' + seedFrom);
  const out = [];
  const n = Math.max(1, count || 3);
  const shown = new Set();
  for (let i = 0; i < n; i++) {
    // A row of three that turns out to be the same cabinet three times is not
    // a choice. Seeds are drawn until one lands on a face the row has not
    // shown yet, and once the whole catalogue is on the row the draw is taken
    // as it comes rather than looped over forever.
    let seed = (r.next() * 1e9) >>> 0;
    for (let tries = 0; tries < 40 && shown.size < layoutCount(cfg); tries++) {
      if (!shown.has(layoutFor(cfg, seed).id)) break;
      seed = (r.next() * 1e9) >>> 0;
    }
    shown.add(layoutFor(cfg, seed).id);
    out.push(readCabinet(cfg, seed, i));
  }
  return out;
}

/**
 * The face of one machine, reduced to what a small picture of it needs: the
 * field, the screen, every mouth, the plates and the nails. Built on demand
 * for the row and never saved, because a card is drawn far less often than a
 * save is written.
 */
export function sketchCabinet(cfg, seed) {
  const board = createBoard(cfg, seed);
  const b = cfg.board;
  return {
    w: board.w, h: board.h,
    field: { left: b.fieldLeft, right: b.fieldRight, top: b.fieldTop, bottom: b.fieldBottom },
    screen: b.reel ? { x: b.reel.x, y: b.reel.y, w: b.reel.w, h: b.reel.h } : null,
    pockets: board.pockets.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, kind: p.kind, pay: p.pay || 0, tone: p.tone || '' })),
    guides: (board.guides || []).map(g => [g.x1, g.y1, g.x2, g.y2]),
    nails: board.nails.map(n => { const p = nailPos(n); return [p.x, p.y]; }),
  };
}

function layoutCount(cfg) {
  return Array.isArray(cfg.board.layouts) && cfg.board.layouts.length ? cfg.board.layouts.length : 1;
}

/** Everything worth knowing about one machine, read off its own face. */
export function readCabinet(cfg, seed, index) {
  const board = createBoard(cfg, seed);
  const shape = describeShape(cfg, board);
  const trial = tryBoard(cfg, board, seed);
  return {
    seed,
    name: cabinetName(seed, index),
    layout: board.layout ? board.layout.name : '',
    skin: board.layout ? skinForCabinet(board.layout.id, cfg) : null,
    title: board.layout ? skinForCabinet(board.layout.id, cfg).title : '',
    note: board.layout ? board.layout.note : '',
    nails: board.pinCount,
    lean: shape.lean,
    leanWord: shape.leanWord,
    funnel: shape.funnel,
    funnelWord: shape.funnelWord,
    gate: trial.gate,
    back: trial.back,
    where: trial.where,
    at: trial.at,
    line: (board.layout && board.layout.note ? board.layout.note.charAt(0).toUpperCase() + board.layout.note.slice(1) + '. ' : '') + sentence(shape, trial),
  };
}

/** A cabinet number, the way a parlour labels its row. */
function cabinetName(seed, index) {
  const row = String.fromCharCode(65 + (seed % 6));
  const number = 11 + ((seed >>> 3) % 78);
  return row + '-' + number + (index === undefined ? '' : '');
}

/** Which way the rows walk a ball, and how tight the gate funnel is. */
function describeShape(cfg, board) {
  const b = cfg.board;
  const mid = b.w * 0.5;
  let upper = 0, upperN = 0, lower = 0, lowerN = 0;
  for (const nail of board.nails) {
    const p = nailPos(nail);
    if (p.y < b.rowsTop + b.rows * b.rowStep * 0.4) { upper += p.x - mid; upperN++; }
    else { lower += p.x - mid; lowerN++; }
  }
  // A lattice that leans walks a falling ball sideways as it descends. The
  // measure is how far the lower half sits from the upper half, which is what
  // a ball actually experiences on the way down.
  const lean = (lowerN ? lower / lowerN : 0) - (upperN ? upper / upperN : 0);

  // The gate funnel is the pair of nails just above the mouth. How far apart
  // they stand is most of what decides whether the gate is reachable.
  const gx = b.gate.x, gy = b.gate.y;
  let left = null, right = null;
  for (const nail of board.nails) {
    const p = nailPos(nail);
    if (p.y < gy - 6 || p.y > gy - 1) continue;
    if (p.x < gx && (!left || p.x > left.x)) left = p;
    if (p.x > gx && (!right || p.x < right.x)) right = p;
  }
  const funnel = left && right ? right.x - left.x : 0;

  return {
    lean,
    // Measured across boards the lean runs from about -0.9 to 1.5, so these
    // thresholds cut the row into three roughly equal groups. A word that
    // almost never applies is a word a player learns to ignore.
    leanWord: lean < -0.45 ? 'walks balls left' : lean > 0.45 ? 'walks balls right' : 'runs straight',
    funnel,
    funnelWord: funnel <= 0 ? 'no funnel over the gate'
      : funnel < 5.5 ? 'a tight funnel over the gate'
      : funnel < 7.5 ? 'an ordinary funnel over the gate'
      : 'a wide funnel over the gate',
  };
}

/**
 * Puts a short run of balls through a board and reports the best it managed.
 *
 * Several handle settings are tried because a machine that is dead at one is
 * often the best on the floor at another, and reporting only the default
 * setting would recommend the wrong cabinet.
 */
export function tryBoard(cfg, board, seed) {
  let bestGate = 0, bestBack = 0, bestAt = 0;
  for (const strength of TRIAL_SETTINGS) {
    const r = makeRng('trial:' + seed + ':' + strength);
    const balls = createBalls(TRIAL_BALLS + 4);
    for (let i = 0; i < TRIAL_BALLS; i++) {
      launch(cfg, balls, strength, (r.next() * 2 - 1) * cfg.launch.spread, 1);
    }
    const out = { events: [], flashes: [], marks: [], flashCap: 0 };
    let steps = 0;
    while (balls.n > 0 && steps < TRIAL_STEP_CAP) {
      stepPhysics(cfg, board, balls, cfg.physics.step, r.next, out);
      out.flashes.length = 0;
      steps++;
    }
    let gates = 0, paid = 0, total = 0;
    for (const e of out.events) {
      total++;
      if (e.kind === 'gate') gates++;
      else if (e.pay > 0) paid += e.pay;
    }
    if (total === 0) continue;
    const gate = gates / total;
    if (gate > bestGate) { bestGate = gate; bestBack = paid / total; bestAt = strength; }
  }
  // Where the best setting sat, as a direction rather than a number. A player
  // told the exact figure would set it once and never read the board again;
  // a player told which end of the handle to start from still has to find it,
  // and is not left sweeping a dial in the dark.
  const where = bestGate <= 0 ? 'nowhere in particular'
    : bestAt <= 0.5 ? 'a soft launch'
    : bestAt >= 0.74 ? 'a hard launch'
    : 'a launch around the middle';
  return { gate: bestGate, back: bestBack, at: bestAt, where };
}

function sentence(shape, trial) {
  const gate = (trial.gate * 100).toFixed(1);
  return shape.leanWord.charAt(0).toUpperCase() + shape.leanWord.slice(1)
    + ', with ' + shape.funnelWord + '. At its best it put ' + gate
    + ' balls in a hundred through the gate, and it wanted ' + trial.where + ' to do it.';
}
