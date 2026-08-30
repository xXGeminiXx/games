// ---------------------------------------------------------------------------
// The board.
//
// A board is the physical face of one machine: the nails driven into the
// lacquer, the pockets set into it, the rails that bound the field and the
// sloped plates that steer a falling ball. It is generated from a seed, so a
// machine has a face of its own that is the same every time it is opened, and
// two machines never play alike.
//
// Nails are not laid out by machine. Every row leans a little and a few nails
// are pulled aside; that lean is the whole reason one board pays and the next
// one does not, and it is what a technician changes overnight.
//
// Geometry is in board units: x runs left to right across the face, y runs
// downward from the top. The renderer and the physics both read this shape and
// neither of them may write to it - a board changes only through the functions
// here, and every change bumps `version` so anything caching the shape knows
// to read it again.
// ---------------------------------------------------------------------------

import { rng as makeRng } from './rng.js?v=44';

export const POCKET_OUT = 'out';
export const POCKET_PAY = 'pay';
export const POCKET_GATE = 'gate';
export const POCKET_ATTACKER = 'attacker';

/**
 * Which cabinet a seed is.
 *
 * A parlour is a row of different machines. The seed picks a layout, and the
 * layout decides where the gate is, what mouths are cut into the face, how the
 * plates run and how tight the funnel is - so two machines are different
 * objects rather than the same object nailed slightly differently.
 */
export function layoutFor(cfg, seed) {
  const list = Array.isArray(cfg.board.layouts) && cfg.board.layouts.length
    ? cfg.board.layouts : [{ id: 'sea', name: 'Sea', note: '' }];
  return list[(seed >>> 0) % list.length];
}

/** A board laid out from a seed. */
export function createBoard(cfg, seed) {
  const b = cfg.board;
  const layout = layoutFor(cfg, seed);
  const board = {
    version: 1,
    seed: seed >>> 0,
    layout,
    w: b.w,
    h: b.h,
    pinRadius: b.pinRadius,
    pins: new Float32Array(0),
    pinCount: 0,
    // Every nail as the machine holds it: where it was driven, and how far it
    // has since been bent. A technician does not pull a nail and drive a new
    // one; the nail stays where it is and the head is leaned over, and that is
    // the difference between a board being rebuilt and a board being read.
    nails: [],
    bends: 0,
    pockets: [],
    walls: [],
    guides: [],
    grid: null,
  };
  // Pockets and rails first: a nail is never driven into a mouth, into a
  // plate, or close enough to either that a ball could jam between them, and
  // that can only be checked against furniture that is already placed.
  layOutPockets(cfg, board, layout);
  layOutRails(cfg, board, layout);
  liftPocketsOffScreen(cfg, board);
  liftPocketsOffPlates(cfg, board);
  layOutNails(cfg, board, makeRng(seed).next, layout);
  rebuild(board);
  return board;
}

function layOutNails(cfg, board, rng, layout) {
  const b = cfg.board;
  const nails = [];
  const shape = layout || {};
  const gate = shape.gate || b.gate;
  const funnelRows = Number.isFinite(shape.funnelRows) ? shape.funnelRows : b.gateFunnelRows;
  const funnelWidth = Number.isFinite(shape.funnelWidth) ? shape.funnelWidth : b.gateFunnelWidth;
  // Two nails closer together than this cannot pass a ball, and a ball that
  // cannot pass and cannot roll off is a ball that never resolves. A board is
  // nailed tight but it is never nailed shut, so every pair laid here is
  // checked and a nail that would close a gap is simply not driven.
  const minSep = 2 * (cfg.physics.ballRadius + b.pinRadius) + 0.2;
  // The same clearance is owed to the rails down each side.
  const railClear = 2 * cfg.physics.ballRadius + b.pinRadius + 0.3;
  // The same again for the plates and the pocket mouths. A nail standing this
  // close to either builds a corner a ball can sit in, and a ball that sits
  // still is the one thing a face must never do.
  const furnitureClear = cfg.physics.ballRadius + b.pinRadius + 0.6;
  const keep = (x, y) => {
    if (x < b.fieldLeft + railClear || x > b.fieldRight - railClear) return false;
    for (let i = 0; i < nails.length; i += 3) {
      const dx = x - nails[i], dy = y - nails[i + 1];
      if (dx * dx + dy * dy < minSep * minSep) return false;
    }
    for (const g of board.guides) {
      if (pointToSegment(x, y, g) < furnitureClear + cfg.physics.ballRadius) return false;
    }
    for (const q of board.pockets) {
      if (Math.abs(x - q.x) < q.w * 0.5 + furnitureClear &&
          Math.abs(y - q.y) < q.h * 0.5 + furnitureClear) return false;
    }
    const reel = b.reel;
    if (reel && Math.abs(x - reel.x) < reel.w * 0.5 + furnitureClear &&
        Math.abs(y - reel.y) < reel.h * 0.5 + furnitureClear) return false;
    return true;
  };

  for (let row = 0; row < b.rows; row++) {
    const y = b.rowsTop + row * b.rowStep;
    if (y > b.fieldBottom - b.rowStep * 0.5) break;

    // Every other row is offset half a column, the pattern that makes a ball
    // fall through a lattice instead of down a corridor.
    const offset = (row % 2) ? b.colStep * 0.5 : 0;
    // The whole row leans, which is the single strongest thing a technician
    // can do to a board: it walks balls sideways as they descend.
    const lean = (rng() * 2 - 1) * b.leanMax;

    for (let x = b.fieldLeft + 2 + offset; x <= b.fieldRight - 2; x += b.colStep) {
      const jx = x + lean * (row + 1) * 0.35 + (rng() * 2 - 1) * b.jitterMax;
      const jy = y + (rng() * 2 - 1) * b.jitterMax * 0.4;
      if (!keep(jx, jy)) continue;
      nails.push(jx, jy, b.pinRadius);
    }
  }

  // The funnel over the gate. Two converging lines of nails that gather a
  // narrow band of falling balls and drop them at the gate mouth, with a pair
  // of shoulder nails that turn most of them away again. Without this the gate
  // is unreachable; with it too wide the gate is free.
  const rows = funnelRows;
  for (let i = 0; i < rows; i++) {
    const t = i / Math.max(1, rows - 1);
    const halfWidth = funnelWidth * (1 - t * 0.62) * 0.5;
    const y = gate.y - (rows - i) * 4.4;
    // The funnel is driven over whatever the lattice put there, because its
    // whole job is to be the one deliberate shape on an otherwise even face.
    clearNear(nails, gate.x - halfWidth, y, minSep);
    clearNear(nails, gate.x + halfWidth, y, minSep);
    if (y < gate.y - gate.h * 0.5 - furnitureClear) {
      nails.push(gate.x - halfWidth, y, b.pinRadius);
      nails.push(gate.x + halfWidth, y, b.pinRadius);
    }
  }
  // The shoulders, set so the mouth between them is a ball and a half wide.
  const shoulder = Math.max(gate.w * 0.5 + 1.2, (minSep + 1.4) * 0.5);
  clearNear(nails, gate.x - shoulder, gate.y - 3.4, minSep);
  clearNear(nails, gate.x + shoulder, gate.y - 3.4, minSep);
  nails.push(gate.x - shoulder, gate.y - 3.4, b.pinRadius);
  nails.push(gate.x + shoulder, gate.y - 3.4, b.pinRadius);

  board.nails = [];
  for (let i = 0; i < nails.length; i += 3) {
    board.nails.push({ x0: nails[i], y0: nails[i + 1], r: nails[i + 2], bx: 0, by: 0, added: false });
  }
  board.bends = 0;
}

/** Distance from a point to a segment. */
function pointToSegment(x, y, seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - seg.x1, y - seg.y1);
  let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (seg.x1 + dx * t), y - (seg.y1 + dy * t));
}

/** Pulls any nail within `r` of a point out of a nail list being built. */
function clearNear(nails, x, y, r) {
  for (let i = nails.length - 3; i >= 0; i -= 3) {
    const dx = x - nails[i], dy = y - nails[i + 1];
    if (dx * dx + dy * dy < r * r) nails.splice(i, 3);
  }
}

function layOutPockets(cfg, board, layout) {
  const b = cfg.board;
  const shape = layout || {};
  const gate = shape.gate || b.gate;
  const attacker = shape.attacker || b.attacker;
  const pockets = Array.isArray(shape.payPockets) ? shape.payPockets : b.payPockets;
  const p = [];

  p.push({
    id: 'gate', kind: POCKET_GATE, label: cfg.text.gate, open: true, pay: 0,
    x: gate.x, y: gate.y, w: gate.w, h: gate.h,
  });
  if (shape.extraGate) {
    p.push({
      id: 'gate2', kind: POCKET_GATE, label: cfg.text.gate, open: true, pay: 0,
      x: shape.extraGate.x, y: shape.extraGate.y, w: shape.extraGate.w, h: shape.extraGate.h,
    });
  }
  p.push({
    id: 'attacker', kind: POCKET_ATTACKER, label: cfg.text.attacker, open: false,
    pay: cfg.fever.attackerPay,
    x: attacker.x, y: attacker.y, w: attacker.w, h: attacker.h,
  });
  pockets.forEach((q, i) => {
    p.push({
      id: q.id || ('pay' + i), kind: POCKET_PAY, label: String(q.pay), open: true, pay: q.pay,
      tone: q.tone || 'enamel', x: q.x, y: q.y, w: q.w, h: q.h,
    });
  });

  board.pockets = p;
}

function layOutRails(cfg, board, layout) {
  const b = cfg.board;
  const shape = layout || {};
  // The outer rails. The left one is the curve a strongly hit ball rides
  // around; the right one is the channel it is launched up.
  board.walls = [
    { x1: b.fieldLeft, y1: b.fieldTop, x2: b.fieldLeft, y2: b.fieldBottom },
    { x1: b.fieldRight, y1: b.fieldTop, x2: b.fieldRight, y2: b.fieldBottom },
  ];
  // The plates. Two shallow slopes low on the face that gather everything the
  // nails have scattered and run it down to the attacker's mouth. Whether that
  // is a payout or the out lane is decided entirely by whether the attacker is
  // open, which is what makes a fever worth having and the rest of the time
  // worth surviving.
  const a = shape.attacker || b.attacker;
  const mouthY = a.y - a.h * 0.5 - cfg.physics.ballRadius * 1.1;
  board.guides = [
    { x1: b.fieldLeft, y1: mouthY - 11, x2: a.x - a.w * 0.4, y2: mouthY },
    { x1: b.fieldRight, y1: mouthY - 11, x2: a.x + a.w * 0.4, y2: mouthY },
  ];
}

/**
 * Moves any pay mouth that is sitting on a plate.
 *
 * The plates are a chute: everything the nails scatter runs down them to the
 * attacker's mouth. A pay mouth left on that run catches almost every ball
 * that reaches it - measured at 97 percent on one cabinet, which paid nearly
 * two balls for every one launched and made the gate pointless. Whether that
 * happens is decided by two numbers in a layout being close together, which is
 * far too easy to do by accident, so it is corrected here rather than trusted
 * to whoever writes the next cabinet.
 */
/**
 * Where the extra reel windows open around the show screen, in multiples of
 * the screen's half extent. The same table the renderer arranges them by
 * (REEL_RING in render/board-geom.js); a test holds the two together.
 */
export const SCREEN_RING = [
  [-1.38, 0.10], [1.38, 0.10],
  [-1.30, 0.86], [1.30, 0.86],
  [-1.38, -0.25], [1.38, -0.25],
];

/**
 * Every rectangle the picture can paint over the face: the show screen and
 * the six reel windows that open around it while spins are waiting.
 */
export function screenCover(cfg) {
  const scr = cfg.board.reel;
  if (!scr) return [];
  const win = { w: cfg.board.w * 0.135, h: cfg.board.h * 0.046 };
  const out = [{ x: scr.x, y: scr.y, w: scr.w, h: scr.h }];
  for (const o of SCREEN_RING) out.push({ x: scr.x + o[0] * scr.w * 0.5, y: scr.y + o[1] * scr.h * 0.5, w: win.w, h: win.h });
  return out;
}

/**
 * A mouth under the show screen or under a reel window is a mouth nobody can
 * see: the picture is painted over the mouths, and a ball still falls into
 * it. Any mouth the picture would cover is moved down to just under the
 * screen, and sideways if that spot is taken, so every mouth on every machine
 * is in plain view. Runs before the plates are checked, since the plates are
 * lower and have the final say.
 */
function liftPocketsOffScreen(cfg, board) {
  const cover = screenCover(cfg);
  if (!cover.length) return;
  const clear = cfg.physics.ballRadius * 1.5;
  const scr = cover[0];
  const overlaps = (p, r) => Math.abs(p.x - r.x) < (p.w + r.w) * 0.5 + clear && Math.abs(p.y - r.y) < (p.h + r.h) * 0.5 + clear;
  const b = cfg.board;
  for (const p of board.pockets) {
    if (!cover.some(r => overlaps(p, r))) continue;
    p.y = scr.y + scr.h * 0.5 + clear + p.h * 0.5 + 1.0;
    for (let tries = 0; tries < 12; tries++) {
      const busy = board.pockets.some(q => q !== p && Math.abs(q.x - p.x) < (q.w + p.w) * 0.5 + clear * 2 && Math.abs(q.y - p.y) < (q.h + p.h) * 0.5 + clear * 2);
      if (!busy) break;
      p.x += (tries % 2 === 0 ? 1 : -1) * 8 * (tries + 1);
      p.x = Math.max(b.fieldLeft + 6, Math.min(b.fieldRight - 6, p.x));
    }
  }
}

function liftPocketsOffPlates(cfg, board) {
  const clear = cfg.physics.ballRadius * 2.6;
  for (const p of board.pockets) {
    if (p.kind !== POCKET_PAY) continue;
    for (let tries = 0; tries < 30; tries++) {
      let onPlate = false;
      for (const g of board.guides) {
        if (pointToSegment(p.x, p.y, g) < clear) { onPlate = true; break; }
      }
      if (!onPlate) break;
      p.y -= clear * 0.5;
      if (p.y < cfg.board.fieldTop + 6) break;
    }
  }
}

/** Rebuilds the packed nail array and the lookup grid. Call after any change. */
export function rebuild(board) {
  const n = board.nails.length;
  if (!board.pins || board.pins.length !== n * 3) board.pins = new Float32Array(n * 3);
  const pins = board.pins;
  for (let i = 0; i < n; i++) {
    const nail = board.nails[i];
    pins[i * 3] = nail.x0 + nail.bx;
    pins[i * 3 + 1] = nail.y0 + nail.by;
    pins[i * 3 + 2] = nail.r;
  }
  board.pinCount = n;
  board.grid = buildGrid(board);
  board.version++;
  return board;
}

/** Where a nail actually stands, bend included. */
export function nailPos(nail) {
  return { x: nail.x0 + nail.bx, y: nail.y0 + nail.by };
}

/** The nail nearest a point within `reach`, as an index, or -1. */
export function nailNear(board, x, y, reach) {
  let best = -1, bestD = reach * reach;
  for (let i = 0; i < board.nails.length; i++) {
    const p = nailPos(board.nails[i]);
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Whether a nail can be leaned to a place, and if not, why.
 *
 * A bend is refused for exactly three reasons, and each one is a sentence a
 * player can act on: the lean is further than the head will go, the nail would
 * close a gap so tight no ball could pass, or it would stand in the furniture.
 * Nothing else is refused, so anything not refused is worth trying.
 */
export function bendCheck(cfg, board, index, x, y) {
  const nail = board.nails[index];
  if (!nail) return { ok: false, why: 'no nail there' };

  const reach = cfg.board.bendReach;
  const dx = x - nail.x0, dy = y - nail.y0;
  if (dx * dx + dy * dy > reach * reach) return { ok: false, why: 'that is further than the head will lean' };

  const b = cfg.board;
  const minSep = 2 * (cfg.physics.ballRadius + b.pinRadius) + 0.2;
  // The same clearance the face was nailed under. Allowing a lean to stand
  // closer to a rail than a nail may be driven builds a gap between brass and
  // steel that a ball fits into and cannot fall out of.
  const railClear = 2 * cfg.physics.ballRadius + b.pinRadius + 0.3;
  if (x < b.fieldLeft + railClear || x > b.fieldRight - railClear ||
      y < b.fieldTop || y > b.fieldBottom) return { ok: false, why: 'that is off the face' };

  for (let i = 0; i < board.nails.length; i++) {
    if (i === index) continue;
    const p = nailPos(board.nails[i]);
    const ddx = p.x - x, ddy = p.y - y;
    if (ddx * ddx + ddy * ddy < minSep * minSep) {
      return { ok: false, why: 'no ball would pass between those two' };
    }
  }
  // Furniture. Some nails are driven close to a mouth on purpose - the pair
  // guarding the gate are the whole reason the gate is hard - so the rule is
  // not "keep away from furniture" but "do not crowd it any further than this
  // nail already does". Without that a shoulder can be leaned once and never
  // leaned back, which reads as the game losing a nail.
  const clear = cfg.physics.ballRadius + b.pinRadius + 0.6;
  for (const g of board.guides) {
    const was = pointToSegment(nail.x0, nail.y0, g);
    const wants = Math.min(clear + cfg.physics.ballRadius, was);
    if (pointToSegment(x, y, g) < wants) return { ok: false, why: 'that is into the plate' };
  }
  for (const q of board.pockets) {
    const wasX = Math.abs(nail.x0 - q.x) - q.w * 0.5;
    const wasY = Math.abs(nail.y0 - q.y) - q.h * 0.5;
    const nowX = Math.abs(x - q.x) - q.w * 0.5;
    const nowY = Math.abs(y - q.y) - q.h * 0.5;
    const wantX = Math.min(clear, Math.max(0, wasX));
    const wantY = Math.min(clear, Math.max(0, wasY));
    if (nowX < wantX && nowY < wantY) return { ok: false, why: 'that is into a mouth' };
  }
  return { ok: true, why: '' };
}

/** Leans a nail. Returns whether it moved. */
export function bendNail(cfg, board, index, x, y) {
  const check = bendCheck(cfg, board, index, x, y);
  if (!check.ok) return check;
  const nail = board.nails[index];
  const wasBent = nail.bx !== 0 || nail.by !== 0;
  nail.bx = x - nail.x0;
  nail.by = y - nail.y0;
  const nowBent = nail.bx !== 0 || nail.by !== 0;
  if (nowBent && !wasBent) board.bends++;
  else if (!nowBent && wasBent) board.bends--;
  rebuild(board);
  return check;
}

/** Puts every nail back where it was driven. */
export function straighten(board) {
  for (const n of board.nails) { n.bx = 0; n.by = 0; }
  board.bends = 0;
  return rebuild(board);
}

/** A uniform grid over the nails, so a ball only ever tests its neighbours. */
function buildGrid(board) {
  const cell = 8;
  const cols = Math.max(1, Math.ceil(board.w / cell));
  const rows = Math.max(1, Math.ceil(board.h / cell));
  const counts = new Int32Array(cols * rows);
  const n = board.pinCount;
  const pins = board.pins;

  const cellOf = (x, y) => {
    let cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
    if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
    return cy * cols + cx;
  };

  for (let i = 0; i < n; i++) counts[cellOf(pins[i * 3], pins[i * 3 + 1])]++;
  const start = new Int32Array(cols * rows + 1);
  for (let i = 0; i < cols * rows; i++) start[i + 1] = start[i] + counts[i];
  const items = new Int32Array(n);
  const cursor = start.slice(0, cols * rows);
  for (let i = 0; i < n; i++) {
    const c = cellOf(pins[i * 3], pins[i * 3 + 1]);
    items[cursor[c]++] = i;
  }
  return { cell, cols, rows, start, items };
}

/** Drives a nail in. Call rebuild when a batch of changes is done. */
export function addPin(board, x, y, r) {
  board.nails.push({ x0: x, y0: y, r, bx: 0, by: 0, added: true });
}

/** Pulls every nail inside a circle. */
export function removePinsNear(board, x, y, r) {
  for (let i = board.nails.length - 1; i >= 0; i--) {
    const p = nailPos(board.nails[i]);
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < r * r) board.nails.splice(i, 1);
  }
}

/** Re-lays every nail from a new seed. Bends and additions do not survive. */
export function renail(cfg, board, seed) {
  board.seed = seed >>> 0;
  layOutNails(cfg, board, makeRng(board.seed).next, board.layout);
  return rebuild(board);
}

/** The bends, small enough to sit inside a save. */
export function serializeBends(board) {
  const out = [];
  board.nails.forEach((n, i) => {
    if (n.bx || n.by) out.push(i, Math.round(n.bx * 100) / 100, Math.round(n.by * 100) / 100);
  });
  return out;
}

export function restoreBends(board, arr) {
  straighten(board);
  if (!Array.isArray(arr)) return board;
  for (let k = 0; k + 2 < arr.length; k += 3) {
    const nail = board.nails[arr[k]];
    if (!nail) continue;
    nail.bx = Number(arr[k + 1]) || 0;
    nail.by = Number(arr[k + 2]) || 0;
    if (nail.bx || nail.by) board.bends++;
  }
  return rebuild(board);
}

/** The pocket a point falls into, or null. Pockets that are shut catch nothing. */
export function pocketAt(board, x, y) {
  const list = board.pockets;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.open) continue;
    if (x >= p.x - p.w * 0.5 && x <= p.x + p.w * 0.5 &&
        y >= p.y - p.h * 0.5 && y <= p.y + p.h * 0.5) return p;
  }
  return null;
}

/** The pocket with this id, or null. */
export function pocket(board, id) {
  return board.pockets.find(p => p.id === id) || null;
}
