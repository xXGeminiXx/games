// ---------------------------------------------------------------------------
// EVENTS - the things the machine does back while a round is being played.
//
// A machine that only ever does one thing is a machine with one thing to
// watch. This is the rest of it: play a certain way and the board answers. A
// spare mouth is cut into the lacquer somewhere else on the face, a stripe of
// the board lights up, the cabinet sends something out across it, three doors
// light and one of them pays.
//
// Everything here is DATA. What can happen, what sets it off, what it does and
// what it says all live in the configuration under `events`; this file only
// starts, steps and ends whatever is in that table, so a new thing the machine
// does is a new entry rather than new code.
//
// Two rules hold the whole file up:
//
//   Every life is measured in BALLS SENT, never in seconds. A thing that ran
//   for ten seconds would be twice as long on a machine sending balls half as
//   fast, and would keep running while the handle was still. Balls sent is the
//   only clock the player is actually spending.
//
//   Every number comes from `state.rng`. Nothing here reads a clock or
//   Math.random, so the same seed plays the same night.
//
// ---------------------------------------------------------------------------
// WHAT THE PICTURE READS  (the contract - nothing else in here is public)
//
// `run.events` hangs off the run state and is safe to read every frame. It is
// never null once a run exists, and its arrays are reused rather than
// replaced, so a renderer may keep a reference to `run.events` itself but must
// not keep a reference to anything inside it across frames.
//
//   run.events.active   Array of live events, in the order they started. Its
//                       length is at most config.events.maxAtOnce plus any
//                       that have finished and are still being shown. Often
//                       empty; never null.
//   run.events.last     The newest live event, or null. Handy for a banner.
//   run.events.marks    Array of { kind, x, y, amount } the picture should
//                       flash, in board units. The run drains this into
//                       `out.marks` once a frame, so a renderer should read
//                       `out.marks` as it already does and ignore this.
//
// Every entry in `active` carries these fields, always, whatever kind it is:
//
//   key        int      rises by one per event, so it is a stable draw key
//   id         string   which entry of config.events.list this is
//   kind       string   what it does, one of:
//                         'mouth'  an extra pocket is open on the face
//                         'plate'  a brass shutter is out, steering balls
//                         'lane'   a vertical stripe of the face is lit
//                         'sweep'  an object is crossing the face
//                         'ride'   every mouth pays more for a while
//                         'doors'  a row of doors, one of which pays
//   name       string   two or three words, for a label
//   line       string   one plain sentence, already filled in, for the log
//   balls      int      launches it started with
//   ballsLeft  int      launches remaining; 0 once it has finished
//   progress   number   0 at the start, 1 at the end
//   mult       number   what it multiplies a payout by; 1 if it does not
//   done       bool     finished, and only still here so it can be seen ending
//
// And two fields that are the WARNING. Something big does not simply appear:
// it is announced first, on the machinery already on the face, and a player
// who learns to read that is a player who knows what is coming.
//
//   pending    bool     true while it is only being announced. NOTHING about
//                       the board has changed yet: there is no pocket, no
//                       shutter, no stripe, and `mult` is 1. Draw the warning,
//                       not the thing.
//   tellLeft   int      balls until it actually happens, counting down
//   tellBalls  int      balls the warning started with, so a fraction can be
//                       taken; 0 means this entry gives no warning at all
//
// A pending event carries the same `kind`, `name` and `line`, so the warning
// can be drawn in the shape of what is coming. Its kind-specific fields below
// are NOT set until it fires.
//
// And then, by kind:
//
//   'mouth'    pocket   the live pocket object, which is also on
//                       run.board.pockets, so whatever already draws pockets
//                       draws this one. Board units:
//                       { id, kind, label, open, pay, tone, x, y, w, h }
//              tone     string, the palette family the mouth is finished in
//
//   'plate'    plate    the live segment object, which is also on
//                       run.board.guides, so whatever already draws the plates
//                       draws this one. Board units:
//                       { x1, y1, x2, y2, temporary: true }
//                       This one is not a picture: the simulation bounces balls
//                       off it, so it really does change where they land.
//
//   'lane'     x0, x1   left and right edge of the lit stripe, board units
//              yTop     top of the stripe, board units
//              yBottom  bottom of the stripe, board units
//
//   'sweep'    x, y     where the object is now, board units
//              r        how far to each side of it counts, board units
//              dir      +1 moving right, -1 moving left
//                       What the object looks like is not here. Each cabinet
//                       sends out its own, and the picture takes that from the
//                       paint, so nothing about it is worth carrying twice.
//
//   'doors'    doors    how many doors are in the row
//              pick     which door pays, counting from 0
//              prize    balls the winning door pays
//              revealed bool - false while the row is still closed, true once
//                       the pick may be shown. Do not read `pick` before it.
//
// Board units are the same units as the board and the balls: x runs 0..board.w
// left to right, y runs 0..board.h top to bottom.
//
// Anything on an event that is not listed above - `def`, `at`, `holdLeft` - is
// this file's own bookkeeping. It is not part of the contract, it will change,
// and `def` is a reference to the configuration rather than a copy, so do not
// walk it and do not serialize an event whole.
//
// The picture is handed this by whatever builds the renderer's view, as
// `run.events`. Nothing here draws anything.
// ---------------------------------------------------------------------------

import { POCKET_PAY } from './board.js?v=58';
import { summonFor, doorsFor, themeForCabinet } from './render/themes.js?v=58';

/** The per-run event state. Never null on a run. */
export function createEvents() {
  return {
    active: [],
    marks: [],
    last: null,
    // What the triggers read. Every one of these is counted in balls.
    dry: 0,          // balls in a row that paid nothing
    hot: 0,          // balls in a row that paid
    steps: 0,        // payout marks already passed this round
    since: 0,        // launches since anything last started
    cool: {},        // entry id -> launches before it may start again
    started: 0,      // entries started this round
    seq: 0,          // how many have ever started, so each has its own key
  };
}

/** Everything stops and the face goes back to the way it was built. */
export function resetEvents(state) {
  const ev = state.events;
  if (!ev) return;
  for (let i = ev.active.length - 1; i >= 0; i--) clearOne(state, ev.active[i]);
  ev.active.length = 0;
  ev.marks.length = 0;
  ev.last = null;
  ev.dry = 0;
  ev.hot = 0;
  ev.steps = 0;
  ev.since = 0;
  ev.cool = {};
  ev.started = 0;
}

/** The table, defended against a configuration that has none. */
function table(state) {
  const c = state.cfg.events;
  if (!c || c.enabled === false || !Array.isArray(c.list) || !c.list.length) return null;
  return c;
}

/** How many are running and still doing something. */
function liveCount(ev) {
  let n = 0;
  for (const e of ev.active) if (!e.done) n++;
  return n;
}

// ---------------------------------------------------------------------------
// The clock. One tick per ball sent, and no other clock anywhere.
// ---------------------------------------------------------------------------

/**
 * One ball has left the handle.
 *
 * Lives run down here and nowhere else, so nothing can outlast the number of
 * balls it was given however the round is played, paused, sped up or left
 * alone.
 */
export function eventsOnLaunch(state) {
  const ev = state.events;
  const cfg = table(state);
  if (!ev || !cfg) return;

  ev.since++;
  for (const id of Object.keys(ev.cool)) {
    if (--ev.cool[id] <= 0) delete ev.cool[id];
  }

  for (let i = ev.active.length - 1; i >= 0; i--) {
    const e = ev.active[i];
    // Still only being announced. Nothing about the board has changed yet.
    if (e.pending) {
      if (--e.tellLeft > 0) continue;
      // The warning has run out, so the thing itself happens now. An entry
      // that turns out to have nowhere to go on this cabinet is dropped here
      // rather than left standing as a warning of nothing.
      if (!fire(state, e)) { ev.active.splice(i, 1); if (ev.last === e) ev.last = null; }
      continue;
    }
    if (!e.done) {
      e.ballsLeft--;
      e.progress = e.balls > 0 ? 1 - Math.max(0, e.ballsLeft) / e.balls : 1;
      if (e.kind === 'sweep') moveSweep(state, e);
      if (e.ballsLeft > 0) continue;
      end(state, e);
      continue;
    }
    // Finished, and shown for a few more balls so the player sees it end.
    if (--e.holdLeft <= 0) {
      clearOne(state, e);
      ev.active.splice(i, 1);
    }
  }
  if (ev.last && ev.active.indexOf(ev.last) < 0) ev.last = null;

  // The rare one that owes nothing to how the round is being played. A machine
  // that only ever answers what you did has no weather in it.
  const odds = clamp01(num(cfg.randomChance, 0));
  if (odds > 0 && state.rng.next() < odds) tryStart(state, 'chance', null);
}

/** A ball touched this many nails on its way down. */
export function eventsOnBallHits(state, hits, x) {
  if (!state.events || !table(state)) return;
  tryStart(state, 'nails', { hits, x });
}

/** A ball has resolved. `paid` is what it paid, which is often nothing. */
export function eventsOnResolve(state, paid, x) {
  const ev = state.events;
  if (!ev || !table(state)) return;
  if (paid > 0) {
    ev.hot++;
    ev.dry = 0;
    tryStart(state, 'hot', { x });
  } else {
    ev.dry++;
    ev.hot = 0;
    tryStart(state, 'dry', { x });
  }
}

/**
 * The round's take has moved.
 *
 * A round is asked for a number of balls, and passing a share of it is a thing
 * the player can feel happening. Each mark is passed once: the count of marks
 * already passed only ever rises within a round, so a payout that crosses two
 * of them at once still only opens one thing.
 */
export function eventsOnTake(state) {
  const ev = state.events;
  const cfg = table(state);
  if (!ev || !cfg) return;
  const quota = Math.max(1, state.quota);
  for (const def of cfg.list) {
    if (!def || !def.trigger || def.trigger.kind !== 'pace') continue;
    const share = num(def.trigger.share, 0.5);
    if (share <= 0) continue;
    const passed = Math.floor(state.won / (quota * share));
    if (passed > ev.steps) {
      ev.steps = passed;
      tryStart(state, 'pace', null);
      return;
    }
  }
}

/** The reels came to rest. `result` is 'match', 'near' or 'miss'. */
export function eventsOnReels(state, result) {
  if (!state.events || !table(state)) return;
  if (result === 'near') tryStart(state, 'near', null);
}

/** The wide mouth at the bottom of the face has just shut. */
export function eventsOnWideShut(state) {
  if (!state.events || !table(state)) return;
  tryStart(state, 'closed', null);
}

// ---------------------------------------------------------------------------
// What a ball is worth while something is happening.
// ---------------------------------------------------------------------------

/**
 * What the live events multiply this payout by.
 *
 * Only the ordinary mouths and the mouths events open are lifted. The wide
 * mouth at the bottom already pays several times what a ball costs for as long
 * as it is open, and stacking on top of that is how one lucky round pays for a
 * whole night. The product is clamped as well, so no arrangement of events
 * compounds however many of them the table grows to.
 */
export function eventsPayMult(state, kind, x, y) {
  const ev = state.events;
  const cfg = table(state);
  if (!ev || !cfg || !ev.active.length) return 1;
  if (kind !== POCKET_PAY) return 1;
  let m = 1;
  for (const e of ev.active) {
    if (e.done || e.pending || e.mult === 1) continue;
    if (e.kind === 'ride') m *= e.mult;
    else if (e.kind === 'lane') {
      if (x >= e.x0 && x <= e.x1 && y >= e.yTop && y <= e.yBottom) m *= e.mult;
    } else if (e.kind === 'sweep') {
      if (Math.abs(x - e.x) <= e.r) m *= e.mult;
    }
  }
  const cap = Math.max(1, num(cfg.maxMult, 4));
  return m > cap ? cap : m;
}

/**
 * Whether a mouth is one an event cut, rather than one the cabinet was built
 * with. Everything such a mouth pays is money the bare face would never have
 * paid, which is how what the whole table is worth stays a measured number.
 */
export function isEventPocket(state, id) {
  const ev = state.events;
  if (!ev || !id) return false;
  for (const e of ev.active) if (e.pocket && e.pocket.id === id) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Starting one.
// ---------------------------------------------------------------------------

/**
 * Starts the entry whose trigger has just been met, if anything may start.
 *
 * Every gate that keeps the board from turning into a fireworks display is
 * here: a ceiling on how many run at once, a rest after any of them start, a
 * rest per entry, and a life measured in balls that is clamped whatever the
 * configuration asks for.
 */
function tryStart(state, kind, info) {
  const ev = state.events;
  const cfg = table(state);
  if (!cfg) return null;
  if (liveCount(ev) >= Math.max(0, Math.floor(num(cfg.maxAtOnce, 2)))) return null;
  if (ev.since < num(cfg.restBalls, 0)) return null;

  const ready = [];
  for (const def of cfg.list) {
    if (!def || !def.trigger || def.trigger.kind !== kind) continue;
    if (ev.cool[def.id]) continue;
    if (!met(ev, def.trigger, info)) continue;
    ready.push(def);
  }
  if (!ready.length) return null;
  // Two entries can wait on the same trigger, so one is drawn rather than the
  // one written first in the file always winning.
  // Each machine leans toward its own: an entry may carry a weight per skin,
  // so the flytrap's machine opens more spare mouths and the diner lights
  // more rows of doors, while the same triggers fire at the same rate.
  let pick = 0;
  if (ready.length > 1) {
    const skin = themeForCabinet(state.board && state.board.layout ? state.board.layout.id : '');
    const w = ready.map(d => {
      const v = d.weights && Number.isFinite(d.weights[skin]) ? d.weights[skin] : 1;
      return Math.max(0, v);
    });
    const total = w.reduce((a, b) => a + b, 0);
    let roll = state.rng.next() * (total > 0 ? total : ready.length);
    for (let i = 0; i < w.length; i++) { roll -= total > 0 ? w[i] : 1; if (roll <= 0) { pick = i; break; } }
  }
  return start(state, ready[pick], info);
}

/** Whether a trigger is satisfied right now. */
function met(ev, t, info) {
  switch (t.kind) {
    case 'dry': return ev.dry >= Math.max(1, num(t.count, 12));
    case 'hot': return ev.hot >= Math.max(1, num(t.count, 5));
    case 'nails': return !!info && info.hits >= Math.max(1, num(t.hits, 30));
    case 'near': case 'closed': case 'pace': case 'chance': return true;
    default: return false;
  }
}

/**
 * Announces one entry from the table, and lets it happen a few balls later.
 *
 * Nothing big lands out of nowhere. An entry with a warning goes onto the face
 * as a warning first, drawn on the machinery that is already there, and only
 * then becomes the thing itself. A player who has seen it twice knows what is
 * coming, which is the whole of what a warning is for.
 */
function start(state, def, info) {
  const ev = state.events;
  const cfg = table(state);
  const balls = clampInt(num(def.balls, 20), 1, Math.max(1, Math.floor(num(cfg.maxBalls, 120))));
  const tell = clampInt(num(def.tellBalls, num(cfg.tellBalls, 0)), 0, 30);
  const e = {
    key: ++ev.seq,
    id: String(def.id),
    kind: String(def.kind),
    name: String(def.name || ''),
    line: '',
    balls,
    ballsLeft: balls,
    progress: 0,
    mult: 1,
    done: false,
    holdLeft: 0,
    pending: tell > 0,
    tellBalls: tell,
    tellLeft: tell,
    def,
    // Kept because an entry that follows the ball that set it off still has to
    // know where that ball was once the warning has run out.
    at: info && Number.isFinite(info.x) ? info.x : null,
  };

  ev.active.push(e);
  ev.last = e;
  ev.since = 0;
  ev.started++;
  ev.cool[def.id] = clampInt(num(def.restBalls, num(cfg.restBalls, 8)) + balls + tell, 1, 9999);

  if (e.pending) {
    pushLine(state, fill(String(def.tellLine || ''), { n: String(tell) }));
    return e;
  }
  if (!fire(state, e)) {
    ev.active.pop();
    if (ev.last === e) ev.last = null;
    return null;
  }
  return e;
}

/**
 * Puts an announced entry onto the face for real.
 *
 * An entry that cannot be put on THIS cabinet - a face with nowhere clear to
 * cut a mouth, a shutter that would sit on a mouth - simply does not happen,
 * and its rest still runs, so it is not retried on every ball for the rest of
 * the round.
 */
function fire(state, e) {
  const def = e.def;
  const info = e.at === null ? null : { x: e.at };
  let ok = false;
  if (e.kind === 'mouth') ok = buildMouth(state, e, def);
  else if (e.kind === 'plate') ok = buildPlate(state, e, def);
  else if (e.kind === 'lane') ok = buildLane(state, e, def, info);
  else if (e.kind === 'sweep') ok = buildSweep(state, e, def);
  else if (e.kind === 'ride') ok = buildRide(e, def);
  else if (e.kind === 'doors') ok = buildDoors(state, e, def);
  if (!ok) return false;

  e.pending = false;
  e.tellLeft = 0;
  e.line = fill(String(def.line || ''), {
    n: String(e.balls),
    x: trimNumber(e.mult),
    pay: String(e.pocket ? e.pocket.pay : (e.prize || 0)),
    doors: String(e.doors || 0),
    // Named from the cabinet, so the sentence says what the player is looking
    // at rather than one fixed creature the other five machines never send.
    it: summonFor(state.board && state.board.layout ? state.board.layout.id : '', state.cfg),
  });
  pushLine(state, e.line);
  return true;
}

// ---------------------------------------------------------------------------
// The five things an event can be.
// ---------------------------------------------------------------------------

/**
 * An extra mouth cut into the face somewhere else.
 *
 * Where it goes is checked rather than trusted. A mouth sitting on one of the
 * plates catches nearly everything that reaches it, which would pay more from
 * one event than the round is worth; a mouth on top of another mouth is a
 * mouth the player cannot see. Both are refused here, and if no spot on this
 * cabinet passes, the event does not happen at all.
 */
function buildMouth(state, e, def) {
  const b = state.cfg.board;
  const board = state.board;
  const spots = Array.isArray(def.spots) ? def.spots : [];
  if (!spots.length) return false;
  const clear = Math.max(0.5, num(def.clearance, 6));
  const pay = Math.max(1, Math.round(num(def.pay, 3)));
  for (const i of shuffled(state, spots.length)) {
    const s = spots[i];
    const x = b.fieldLeft + clamp01(num(s.x, 0.5)) * (b.fieldRight - b.fieldLeft);
    const y = b.fieldTop + clamp01(num(s.y, 0.5)) * (b.outY - b.fieldTop);
    if (!placeable(state, x, y, clear)) continue;
    const pocket = {
      id: 'bonus' + e.key,
      kind: POCKET_PAY,
      label: String(pay),
      open: true,
      pay,
      tone: String(def.tone || 'jade'),
      temporary: true,
      x, y,
      w: Math.max(1, num(def.w, 3)),
      h: Math.max(0.5, num(def.h, 1.3)),
    };
    board.pockets.push(pocket);
    board.version++;
    e.pocket = pocket;
    e.tone = pocket.tone;
    return true;
  }
  return false;
}

/**
 * A brass shutter swung out across part of the face.
 *
 * This one is not a light or a number. It is a plate the simulation bounces
 * balls off, the same kind of plate the cabinet was built with, so while it is
 * out the balls genuinely go somewhere else - which is the difference between
 * the machine answering you and the machine decorating itself.
 *
 * Where it may swing is checked hard. A plate that passes close under a mouth
 * turns that mouth into a funnel and catches nearly everything that reaches
 * it, which is the one arrangement on this board that pays more than a round
 * is worth; the cabinet guards against it at build time and so does this.
 */
function buildPlate(state, e, def) {
  const b = state.cfg.board;
  const board = state.board;
  const spots = Array.isArray(def.spots) ? def.spots : [];
  if (!spots.length) return false;
  const width = b.fieldRight - b.fieldLeft;
  const clear = Math.max(1, num(def.clearance, 7));
  for (const i of shuffled(state, spots.length)) {
    const s = spots[i];
    const cx = b.fieldLeft + clamp01(num(s.x, 0.5)) * width;
    const cy = b.fieldTop + clamp01(num(s.y, 0.5)) * (b.outY - b.fieldTop);
    const half = Math.max(2, clamp01(num(s.len, 0.2)) * width) * 0.5;
    const tilt = num(s.tilt, 0.3);
    const seg = {
      x1: Math.max(b.fieldLeft, cx - half), y1: cy - half * tilt,
      x2: Math.min(b.fieldRight, cx + half), y2: cy + half * tilt,
      temporary: true,
    };
    if (!plateClear(state, seg, clear)) continue;
    board.guides.push(seg);
    board.version++;
    e.plate = seg;
    return true;
  }
  return false;
}

/** Whether a shutter may swing out here without turning a mouth into a funnel. */
function plateClear(state, seg, clear) {
  const board = state.board;
  for (const p of board.pockets) {
    if (segmentDistance(p.x, p.y, seg) < clear) return false;
  }
  for (const g of board.guides) {
    if (segmentDistance(g.x1, g.y1, seg) < clear * 0.5) return false;
    if (segmentDistance(g.x2, g.y2, seg) < clear * 0.5) return false;
  }
  return true;
}

/** A lit stripe of the face. Anything landing inside it pays more. */
function buildLane(state, e, def, info) {
  const b = state.cfg.board;
  const width = Math.max(2, num(def.width, 18));
  let cx = b.fieldLeft + (b.fieldRight - b.fieldLeft) * 0.5;
  if (def.follow === 'ball' && info && Number.isFinite(info.x)) cx = info.x;
  else if (def.follow === 'gate') {
    const gate = state.board.pockets.find(p => p.id === 'gate');
    if (gate) cx = gate.x;
  }
  const half = width * 0.5;
  e.x0 = Math.max(b.fieldLeft, cx - half);
  e.x1 = Math.min(b.fieldRight, cx + half);
  e.yTop = b.fieldTop;
  e.yBottom = b.outY;
  e.mult = Math.max(1, num(def.mult, 2));
  return e.x1 > e.x0 && e.mult > 1;
}

/** Something crossing the face. Mouths it is passing over pay more. */
function buildSweep(state, e, def) {
  const b = state.cfg.board;
  e.r = Math.max(1, num(def.reach, 9));
  e.dir = state.rng.next() < 0.5 ? 1 : -1;
  e.y = b.fieldTop + clamp01(num(def.y, 0.6)) * (b.outY - b.fieldTop);
  e.mult = Math.max(1, num(def.mult, 3));
  moveSweep(state, e);
  return e.mult > 1;
}

/** Where the crossing object is, worked out from how much of its life is left. */
function moveSweep(state, e) {
  const b = state.cfg.board;
  const from = b.fieldLeft - e.r;
  const to = b.fieldRight + e.r;
  const p = clamp01(e.progress);
  e.x = e.dir > 0 ? from + (to - from) * p : to - (to - from) * p;
}

/** Every mouth pays more for a while. */
function buildRide(e, def) {
  e.mult = Math.max(1, num(def.mult, 1.5));
  return e.mult > 1;
}

/**
 * A row of doors, one of which pays.
 *
 * Which one is settled the moment the row lights, and hidden until the row
 * closes. Settling it up front is what lets the picture open exactly the door
 * that was always going to open, rather than showing a door and then being
 * told which one it was.
 */
function buildDoors(state, e, def) {
  const prizes = Array.isArray(def.prizes) ? def.prizes.filter(v => Number.isFinite(v)) : [];
  if (!prizes.length) return false;
  // The row is the machine's own: each cabinet lights its own number of
  // doors, which is what makes the game different from one machine to the next.
  const own = doorsFor(state.board && state.board.layout ? state.board.layout.id : '', state.cfg);
  e.doors = clampInt(num(own, num(def.doors, prizes.length)), 2, 8);
  // The paying door is any door in the row; what it pays is drawn from the
  // prize list, so a longer row does not mean a bigger purse.
  e.pick = Math.floor(state.rng.next() * e.doors) % e.doors;
  e.prize = Math.max(0, Math.round(prizes[Math.floor(state.rng.next() * prizes.length) % prizes.length]));
  e.revealed = false;
  e.holdBalls = clampInt(num(def.showBalls, 4), 1, 60);
  return true;
}

// ---------------------------------------------------------------------------
// Ending one.
// ---------------------------------------------------------------------------

/** The life has run out. Whatever is owed is paid here, once. */
/**
 * How a row of doors pays when it closes. Left alone, the paying door opens
 * and pays its prize. Called - the player clicked a door while the row was
 * lit - the right door pays as many times over as there are doors and a wrong
 * one pays nothing: the same average, with the choice in the player's hands.
 */
export function settleDoors(e) {
  const prize = Math.max(0, num(e.prize, 0));
  if (!Number.isInteger(e.choice)) return { pay: prize, called: false, right: false };
  const right = e.choice === e.pick;
  // A right call pays as many times over as there were doors to choose from,
  // so the average is the prize whatever the row's length.
  const n = Math.max(2, Math.floor(num(e.doors, 3)));
  return { pay: right ? prize * n : 0, called: true, right };
}

/** The player calls a door, counting from 0. Only while a row is lit and still shut. */
export function chooseDoor(state, k) {
  const ev = state && state.events;
  if (!ev || !Array.isArray(ev.active)) return { ok: false };
  for (const e of ev.active) {
    if (e.kind !== 'doors' || e.pending || e.done || e.revealed) continue;
    const n = Math.max(2, num(e.doors, 3));
    if (!Number.isInteger(k) || k < 0 || k >= n) return { ok: false };
    e.choice = k;
    pushLine(state, fill(String(state.cfg.events.doorsCalled || ''), { door: String(k + 1) }));
    return { ok: true, door: k };
  }
  return { ok: false };
}

function end(state, e) {
  if (e.done) return;
  e.done = true;
  e.mult = 1;
  e.ballsLeft = 0;
  e.progress = 1;
  e.holdLeft = e.kind === 'doors' ? (e.holdBalls || 1) : 1;
  if (e.kind === 'mouth' && e.pocket) e.pocket.open = false;
  if (e.kind === 'doors') {
    e.revealed = true;
    const settled = settleDoors(e);
    if (settled.pay > 0) {
      const b = state.cfg.board;
      state.tray += settled.pay;
      state.won += settled.pay;
      state.stats.won += settled.pay;
      state.stats.eventBalls = (state.stats.eventBalls || 0) + settled.pay;
      state.events.marks.push({ kind: 'pay', x: b.w * 0.5, y: b.h * 0.42, amount: settled.pay });
      if (state.events.marks.length > 32) {
        state.events.marks.splice(0, state.events.marks.length - 32);
      }
    }
    const text = state.cfg.events || {};
    const line = !settled.called ? text.doorsWon : settled.right ? text.doorsRight : text.doorsWrong;
    pushLine(state, fill(String(line || ''), {
      pay: String(settled.pay), door: String((e.pick | 0) + 1), called: String((e.choice | 0) + 1), doors: String(e.doors || 3),
    }));
  }
}

/**
 * The last of it comes off the face.
 *
 * This only takes things away. Anything owed was paid when the life ran out;
 * clearing one early - the round ended under it, or the machine was reset -
 * pays nothing, because a row of doors that was swept off the face never
 * opened and a spare mouth that was taken away never caught anything.
 */
function clearOne(state, e) {
  // Something that was only ever a warning never happened, so there is nothing
  // on the board to take away at all.
  if (e.pending) {
    e.pending = false; e.done = true;
    // A warning that never became anything still keeps the picture's
    // promise: every field a drawn event of its kind carries is present,
    // so a row of doors or a lane cleared mid-warning never reaches the
    // renderer half made.
    const def = e.def || {};
    if (e.kind === 'doors') { e.doors = clampInt(num(def.doors, 3), 2, 8); e.pick = 0; e.prize = 0; e.revealed = false; }
    else if (e.kind === 'lane') { e.x0 = 0; e.x1 = 1; e.yTop = 0; e.yBottom = 1; }
    else if (e.kind === 'sweep') { e.x = 0; e.y = 0; e.r = 1; e.dir = 1; }
    return;
  }
  e.done = true;
  e.mult = 1;
  if (e.kind === 'mouth' && e.pocket) {
    const list = state.board.pockets;
    const at = list.indexOf(e.pocket);
    if (at >= 0) list.splice(at, 1);
    state.board.version++;
    e.pocket = null;
  }
  if (e.kind === 'plate' && e.plate) {
    const list = state.board.guides;
    const at = list.indexOf(e.plate);
    if (at >= 0) list.splice(at, 1);
    state.board.version++;
    e.plate = null;
  }
}

// ---------------------------------------------------------------------------
// Small shared pieces.
// ---------------------------------------------------------------------------

/** Whether a mouth may be cut here: clear of the plates, the mouths and the counter. */
function placeable(state, x, y, clear) {
  const b = state.cfg.board;
  const board = state.board;
  if (x < b.fieldLeft + clear * 0.5 || x > b.fieldRight - clear * 0.5) return false;
  if (y < b.fieldTop + clear || y > b.outY - clear) return false;
  for (const g of board.guides || []) {
    if (segmentDistance(x, y, g) < clear) return false;
  }
  for (const p of board.pockets) {
    if (Math.abs(p.x - x) < clear && Math.abs(p.y - y) < clear) return false;
  }
  const r = b.reel;
  if (r && Math.abs(r.x - x) < r.w * 0.5 + clear && Math.abs(r.y - y) < r.h * 0.5 + clear) return false;
  return true;
}

/** How far a point is from a plate, which is a line segment. */
function segmentDistance(x, y, g) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((x - g.x1) * dx + (y - g.y1) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = g.x1 + dx * t, py = g.y1 + dy * t;
  return Math.hypot(x - px, y - py);
}

/** The numbers 0..n-1, in an order this run drew. */
function shuffled(state, n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(state.rng.next() * (i + 1)) % (i + 1);
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function pushLine(state, text) {
  if (!text || !state.log) return;
  state.log.push({ kind: 'event', text, t: state.time });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

/** Fills {braces} in a sentence from the table. */
function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));
}

/** 2 rather than 2.0, and 1.5 rather than 1.50, for a sentence. */
function trimNumber(v) {
  if (!Number.isFinite(v)) return '1';
  return String(Math.round(v * 100) / 100);
}

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp01(v) { const n = Number(v); return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n; }
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}
