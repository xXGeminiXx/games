/**
 * Swarm Breaker - the first minute.
 *
 * There is no tutorial in here. There is no instructional text in here, and
 * there is no method on this module that returns any. That is the design, not
 * an omission.
 *
 * WHAT THIS MODULE ACTUALLY IS
 *
 * A player learns a system by causing something and seeing what it did. This
 * module does one job: it makes the consequences of the first few shots
 * impossible to miss, in the visual language the game already speaks, and then
 * it stops forever. Every mechanic a new player needs is already happening on
 * screen. Most of it is happening too quietly, or in a place the eye is not
 * looking, or one frame after the eye left. The fix is emphasis, not
 * explanation.
 *
 * The five things a first-time player has to work out, and what teaches each:
 *
 *   the input           an aim ray that starts breathing on its own if the
 *                       screen has been sitting still. Nobody is told to drag.
 *                       The launcher demonstrates the arc it swings through,
 *                       inside the angles the game will actually accept, and
 *                       stops the instant a pointer moves.
 *
 *   numbers are health  one block in the opening field carries four health
 *                       among neighbours carrying one. It survives the first
 *                       shot wearing a smaller number than it started with,
 *                       and it is still wearing it at the start of the next
 *                       turn. A number that persists and decreases is not a
 *                       score, and nobody had to say so.
 *
 *   the swarm grows     a collected marker is drawn travelling down into the
 *                       mass at the bottom of the screen, which then visibly
 *                       thickens. Cause and effect in one gesture, with no
 *                       counter to read. A marker that sinks past the line
 *                       instead breaks apart on it, so a miss looks like a
 *                       miss rather than like nothing.
 *
 *   the launch point    the moment the first ball crosses the line, the place
 *                       it crossed is marked and held. At the end of the turn
 *                       the launcher arrives there along a drawn track. The
 *                       rule is posted as a prediction the player then watches
 *                       come true, which is how a systems player prefers to be
 *                       told anything at all.
 *
 *   the line kills      the swarm line runs hot underneath a block that is
 *                       running out of room. A threat display, not a warning
 *                       message, and it lights two turns before the threat is
 *                       real, so the first purchase is a decision with stakes
 *                       rather than a shrug.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No text. No arrows pointing at buttons, no dimmed screen with a hole cut in
 * it, no forced first shot, no gating, no step counter, no character, no
 * sound. Nothing here blocks input and nothing here spends the player's time.
 * Every mark is additive, brief, and drawn outside the screen shake, so the
 * game can shake while the teaching stays still.
 *
 * It also never repeats. Once the arc has run, a flag goes into storage and
 * `createOnboarding` returns an inert object on every later visit, at which
 * point the whole module costs one branch per frame.
 *
 * ---------------------------------------------------------------------------
 * WIRING
 *
 * Three lines, because the module reads the host's own state object rather
 * than asking for a translation layer:
 *
 *   import { createOnboarding } from './src/onboarding.js';
 *   const teach = createOnboarding({ width: W, height: H, floorY: FLOOR, topY: TOP });
 *
 *   // in the frame loop, after juice.update(dt)
 *   teach.update(dt, S);
 *
 *   // in the frame loop, after juice.end(ctx), so marks do not inherit shake
 *   teach.draw(X);
 *
 * `S` is read, never written. The fields it looks for, with the aliases that
 * let the prototype's own state object work unchanged:
 *
 *   depth                current depth
 *   balls                swarm size
 *   essence | gold       spendable currency
 *   origin               launcher x
 *   nextOrigin           x where the first ball crossed the line, or null
 *   firing, aiming, dead flags
 *   blocks | rows        array of { c, r } or { x, y }; read only
 *   markers | drops      array of { c, r, kind } or { x, y, kind }; read only
 *
 * Anything missing switches off the beats that needed it. Nothing throws, and
 * an empty view object is safe.
 *
 * Two optional extras:
 *
 *   teach.attach(canvasEl)     passive pointer and Escape listeners, so the
 *                              idle demonstration yields the moment the player
 *                              moves and Escape skips. Returns a detach
 *                              function.
 *
 *   canAfford: v => boolean    supplied in the options. The one thing this
 *                              module cannot observe is whether the shop has
 *                              become buyable, because prices belong to the
 *                              host and no price is going to live in here.
 *                              Supply it and the canvas edge lights once, the
 *                              first time something is affordable.
 *
 * And one that changes the game rather than the picture:
 *
 *   teach.plan(depth)          an advisory opening field for depths 1 to 4.
 *                              See PRESCRIPTION below. The host may ignore it
 *                              entirely; the module behaves identically either
 *                              way, it just has less to point at.
 *
 * ---------------------------------------------------------------------------
 * NO GAME LOGIC LIVES HERE
 *
 * This module never mutates state, never simulates, never scores, never
 * decides an outcome, and never holds a price. It reads a snapshot, keeps a
 * handful of timers, and draws. `plan()` is data, not behaviour: the host
 * chooses whether to build a field out of it.
 */

// ---------------------------------------------------------------------------
// LOOK
//
// Three of the host's five colours, used exactly as the host uses them: cyan
// is the swarm, gold is essence, hot is the line about to be crossed. Nothing
// here introduces a colour, because a teaching mark in a colour the game does
// not otherwise use reads as interface rather than as the game noticing
// something. Ink and dim are absent on purpose: they are text colours, and
// this module draws no text.
// ---------------------------------------------------------------------------

const SWARM = [90, 209, 255];     // #5ad1ff
const ESSENCE = [255, 201, 74];   // #ffc94a
const HOT = [255, 92, 70];        // #ff5c46

function rgba(c, a) {
  const v = a < 0 ? 0 : a > 1 ? 1 : a;
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + v + ')';
}

// ---------------------------------------------------------------------------
// TIMING
//
// Every number here is short. The longest single mark is under a second,
// nothing queues behind anything else, and no beat delays a shot. A player who
// fires immediately and keeps firing sees the entire arc and never waits a
// frame for any of it.
// ---------------------------------------------------------------------------

const IDLE_RING = 1.3;      // seconds of stillness before the launcher pulses
const RING_LIFE = 1.15;     // one launcher pulse
const RING_GAP = 2.5;       // rest between pulses while the screen stays still
const IDLE_RAY = 2.6;       // stillness before the aim arc demonstrates itself
const RAY_PERIOD = 3.4;     // one full sweep of that demonstration
const RAY_LEN = 240;        // long enough to point into the field, not at floor
const RAY_SWING = 0.62;     // radians either side of straight up, inside the
                            // 15 degree minimum the launcher enforces

const CARET_LIFE = 0.55;    // the landing mark dissolving once the turn ends
const TRACK_LIFE = 0.42;    // the launcher travelling to where the ball landed
const JOIN_LIFE = 0.55;     // a collected marker arriving where it counts
const LOST_LIFE = 0.62;     // a marker breaking up on the line
const SWEEP_LIFE = 0.85;    // the canvas edge lighting when the shop opens up

const THREAT_ROWS = 2.05;   // how close a block gets before the line runs hot

// A block spawned at depth one enters the threat band at depth seven and
// crosses the line at depth nine, so retiring at seven would switch the hot
// line off in the exact turn it starts to matter. Ten leaves the display its
// whole arc, and by then every one-shot mark has long since fired: the module
// is drawing nothing but the line for those last few turns.
const RETIRE_DEPTH = 10;    // the arc is over; the module goes quiet for good
const RETIRE_HOLD = 8;      // extra depth the hot line may borrow, at most
const RETIRE_ON_DEATH = 4;  // a run that got this far counts as taught

// ---------------------------------------------------------------------------
// PRESCRIPTION - the opening field
//
// The most load bearing part of the first minute, and the part that least
// belongs in a file called onboarding. It is here because these four rows
// exist to teach and for no other reason, and it is exposed as advisory data
// so it can be lifted into the field generator as an opening regime, or into
// the difficulty tier table, without touching anything else. See the handover
// note at the bottom of this file.
//
// Four rules produced these rows:
//
//   1. WIDE AND CHEAP. Four or five blocks at one health. Any angle a person
//      can drag hits something inside half a second, and the first shot
//      destroys several. A first shot that hits nothing is the one genuinely
//      unrecoverable outcome in the whole design, so the field removes the
//      possibility instead of explaining around it.
//
//   2. OFFSET GAPS. Consecutive rows put their holes in different columns, so
//      a ball that enters the field rattles between two shelves rather than
//      passing straight through. Rattling is what makes the swarm look like it
//      is working, which is the entire pitch of the game.
//
//   3. ONE COLUMN OPEN THROUGH BOTH ROWS. The generator guarantees an unbroken
//      lane from the launcher upward, and these rows keep that promise, so the
//      opening is never a sealed ceiling. Verified: depths 1 and 2 share
//      column 3, depths 2 and 3 share column 1, depths 3 and 4 share column 5.
//
//   4. ONE BLOCK WITH REAL HEALTH. Depth two, column four, four health among
//      ones, sitting directly over the launcher's right lean. It cannot be
//      cleared in one turn on purpose. It is still standing at the start of
//      turn two wearing a smaller number, which is the whole lesson about what
//      the numbers are.
//
// Markers sit in columns that are open in their own row, so every one of them
// is reachable rather than parked behind a block. Both seed rows carry one, so
// the very first shot can take the swarm from one to three: the size of that
// jump, seen rather than read, is the moment the game explains itself.
// ---------------------------------------------------------------------------

const PLAN_ROWS = [
  { cells: '.##..##.', hp: {}, marker: 4 },
  { cells: '#.#.##.#', hp: { 4: 4 }, marker: 3 },
  { cells: '..##..##', hp: {}, marker: 5 },
  { cells: '##..#..#', hp: { 0: 2, 1: 2, 4: 2, 7: 2 }, marker: 2 },
];

function planAt(depth) {
  const row = PLAN_ROWS[depth - 1];
  if (!row) return null;
  const cells = [];
  const hp = [];
  for (let c = 0; c < row.cells.length; c++) {
    const on = row.cells[c] === '#';
    cells.push(on);
    hp.push(on ? (row.hp[c] || 1) : 0);
  }
  return {
    depth: depth,
    cells: cells,
    hp: hp,
    markers: [{ col: row.marker, kind: 'ball' }],
    advisory: true,
  };
}

// ---------------------------------------------------------------------------
// SMALL HELPERS
// ---------------------------------------------------------------------------

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Fast in, slow out. Anything that travels uses it, so a mark that moves reads
// as arriving somewhere rather than as sliding around.
function easeOut(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

function readStorage(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch (e) {
    /* private browsing or storage disabled: the arc simply runs again */
  }
}

function dropStorage(key) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch (e) {
    /* nothing to clear */
  }
}

// ?teach=1 forces the arc on for a returning player, ?teach=0 forces it off.
// A testing affordance, absent everywhere else.
function urlOverride() {
  try {
    if (typeof location === 'undefined' || !location.search) return null;
    const m = /[?&]teach=([01])/.exec(location.search);
    return m ? m[1] === '1' : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------

/**
 * Build the first-minute director.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=520]        canvas width
 * @param {number} [opts.height=620]       canvas height
 * @param {number} [opts.floorY=566]       the swarm line
 * @param {number} [opts.topY=40]          top of the block field
 * @param {number} [opts.cols=8]           columns in the field
 * @param {number} [opts.cell]             cell size; defaults to width / cols
 * @param {number} [opts.ballRadius=5]     used to sit marks on the launcher
 * @param {boolean} [opts.threat=true]     the hot line under a descending block
 * @param {function} [opts.canAfford]      (view) => boolean; enables the shop beat
 * @param {object} [opts.storage]          { getItem, setItem }; defaults to localStorage
 * @param {string} [opts.storageKey]       defaults to 'swarmbreaker.taught.v1'
 * @param {boolean} [opts.force]           run the arc regardless of storage
 * @returns {object} the director
 */
export function createOnboarding(opts) {
  const o = opts || {};

  let W = num(o.width, 520);
  let H = num(o.height, 620);
  let floorY = num(o.floorY, 566);
  const topY = num(o.topY, 40);
  const cols = Math.max(1, Math.round(num(o.cols, 8)));
  const cell = num(o.cell, W / cols);
  const ballR = num(o.ballRadius, 5);
  const showThreat = o.threat !== false;
  const canAfford = typeof o.canAfford === 'function' ? o.canAfford : null;
  const storeKey = typeof o.storageKey === 'string' ? o.storageKey : 'swarmbreaker.taught.v1';

  const store = o.storage && typeof o.storage.getItem === 'function' ? o.storage : null;
  const readFlag = () => (store ? store.getItem(storeKey) : readStorage(storeKey));
  const writeFlag = () => (store && store.setItem ? store.setItem(storeKey, '1') : writeStorage(storeKey, '1'));

  const override = urlOverride();
  let live = override === null ? (o.force === true || readFlag() !== '1') : override;

  // Where a collected marker is heading. Cyan goes down into the swarm mass,
  // which is the count drawn. Gold goes up and off the top edge, toward the
  // essence readout in the header, so the two currencies are visibly separate
  // things going to visibly separate places.
  const SWARM_SINK_X = W / 2;
  const SWARM_SINK_Y = floorY + (H - floorY) * 0.42;
  const ESSENCE_SINK_X = W * 0.62;
  const ESSENCE_SINK_Y = 2;

  // --- observed state -------------------------------------------------------

  let t = 0;              // seconds since the module woke up
  let still = 0;          // seconds since the pointer last moved
  let ringAt = -99;       // when the last launcher pulse started

  let firstFire = false;  // the player has taken a shot
  let firstJoin = false;  // a swarm marker has been collected
  let firstMove = false;  // the launcher has relocated at least once
  let shopLit = false;    // the canvas edge has flashed once
  let threatSeen = false; // the line has run hot at least once
  let threatNow = false;  // the line is running hot this frame

  let lastDepth = null;
  let lastBalls = null;
  let lastOrigin = null;
  let lastFiring = false;
  let lastView = null;

  // A landing mark: set the instant the first ball of the turn crosses the
  // line, held until the launcher gets there.
  let caretX = null;
  let caretT = 0;

  // Markers tracked by object identity, so a collection can be told apart from
  // a marker that merely sank. Two maps that swap roles each frame rather than
  // one that gets rebuilt, so the steady state allocates nothing.
  let seenNow = new Map();
  let seenPrev = new Map();

  // Transient marks. Few enough at any moment that an array is right.
  const fx = [];

  function emit(kind, life, p) {
    fx.push({ kind: kind, t: 0, life: life, p: p });
    if (fx.length > 24) fx.shift();
  }

  // Being taught and still drawing are separate states, and they have to be.
  // The hot line is allowed to outlive the rest of the arc by a few turns so
  // that it never blinks out from under a block sitting on it, and a player
  // who is under pressure for that whole stretch must not be re-taught on his
  // next visit because the drawing never happened to stop. So the flag lands
  // the moment the lessons are done, and the drawing stops when it is safe to.
  let taught = readFlag() === '1';

  function markTaught() {
    if (taught) return;
    taught = true;
    writeFlag();
  }

  function retire() {
    markTaught();
    if (!live) return;
    live = false;
    fx.length = 0;
    caretX = null;
    seenNow.clear();
    seenPrev.clear();
  }

  // --- geometry -------------------------------------------------------------

  function pointOf(item, out) {
    if (!item) return null;
    if (typeof item.x === 'number' && typeof item.y === 'number') {
      out.x = item.x;
      out.y = item.y;
      return out;
    }
    if (typeof item.c === 'number' && typeof item.r === 'number') {
      out.x = item.c * cell + cell / 2;
      out.y = topY + item.r * cell + cell / 2;
      return out;
    }
    return null;
  }

  // --- reading the host's state --------------------------------------------

  const snap = {
    depth: 1, balls: 1, essence: 0, origin: 0, nextOrigin: null,
    firing: false, aiming: false, dead: false, blocks: null, markers: null, raw: null,
  };

  function view(v) {
    const s = v || {};
    snap.depth = num(s.depth, 1);
    snap.balls = num(s.balls, 1);
    snap.essence = num(s.essence !== undefined ? s.essence : s.gold, 0);
    snap.origin = num(s.origin, W / 2);
    snap.nextOrigin = typeof s.nextOrigin === 'number' && isFinite(s.nextOrigin) ? s.nextOrigin : null;
    snap.firing = !!s.firing;
    snap.aiming = !!s.aiming;
    snap.dead = !!s.dead;
    snap.blocks = Array.isArray(s.blocks) ? s.blocks : (Array.isArray(s.rows) ? s.rows : null);
    snap.markers = Array.isArray(s.markers) ? s.markers : (Array.isArray(s.drops) ? s.drops : null);
    snap.raw = s;
    return snap;
  }

  // --- the beats ------------------------------------------------------------

  const scratchPoint = { x: 0, y: 0 };

  // A marker either joins something or breaks apart on the line. Both are
  // drawn, because a loss that looks like nothing teaches nothing.
  function trackMarkers(s) {
    if (!s.markers) {
      if (seenPrev.size) seenPrev.clear();
      return;
    }

    seenNow.clear();
    for (let i = 0; i < s.markers.length; i++) {
      const m = s.markers[i];
      if (!m || typeof m !== 'object') continue;
      const p = pointOf(m, scratchPoint);
      if (!p) continue;

      const prev = seenPrev.get(m);
      if (prev && prev.y < floorY && p.y >= floorY) {
        emit('lost', LOST_LIFE, { x: p.x, y: floorY, gold: m.kind === 'gold' });
      }
      seenNow.set(m, { x: p.x, y: p.y });
    }

    // Present last frame, gone now, and last seen above the line: collected.
    // The host removes a marker on contact and at no other time.
    seenPrev.forEach((p, m) => {
      if (seenNow.has(m) || p.y >= floorY) return;
      const gold = !!(m && m.kind === 'gold');
      emit('join', JOIN_LIFE, {
        x0: p.x, y0: p.y,
        x1: gold ? ESSENCE_SINK_X : SWARM_SINK_X,
        y1: gold ? ESSENCE_SINK_Y : SWARM_SINK_Y,
        gold: gold,
      });
      if (!gold) firstJoin = true;
    });

    const swap = seenPrev;
    seenPrev = seenNow;
    seenNow = swap;
  }

  function trackLanding(s) {
    if (s.nextOrigin === null || caretX !== null) return;
    caretX = s.nextOrigin;
    caretT = 0;
  }

  function trackTurnEnd(s) {
    if (lastDepth === null || s.depth <= lastDepth) return;

    // A completed turn is proof the player has fired, whatever the firing flag
    // did or did not do in the frames this module happened to observe. Without
    // this, one missed flag brings the idle demonstration back to a player who
    // has been shooting for a minute, which is the single most patronising
    // failure available to the module.
    firstFire = true;

    const from = lastOrigin === null ? s.origin : lastOrigin;
    if (Math.abs(s.origin - from) > 1.5) {
      emit('track', TRACK_LIFE, { x0: from, x1: s.origin });
      firstMove = true;
    }
    if (caretX !== null) {
      emit('caret', CARET_LIFE, { x: caretX });
      caretX = null;
    }
  }

  // The line running hot is the fifth lesson, and it cannot be triggered: it
  // arrives when a block gets close, which takes five or six turns. Tracked
  // here rather than in draw() so that retirement never happens before it.
  function trackThreat(s) {
    threatNow = false;
    if (!showThreat || !s.blocks) return;
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i];
      if (!b || typeof b.r !== 'number') continue;
      if (floorY - (topY + b.r * cell + cell) <= THREAT_ROWS * cell) {
        threatNow = true;
        threatSeen = true;
        return;
      }
    }
  }

  function trackShop(s) {
    if (shopLit || !canAfford || s.firing) return;
    let ok = false;
    try {
      ok = !!canAfford(s.raw);
    } catch (e) {
      ok = false;
    }
    if (!ok) return;
    shopLit = true;
    emit('sweep', SWEEP_LIFE, null);
  }

  // --- update ---------------------------------------------------------------

  /**
   * Advance the director one frame.
   *
   * @param {number} dt   seconds since the last frame; milliseconds are detected
   * @param {object} v    the host's state object, read and never written
   */
  function update(dt, v) {
    if (v) lastView = v;
    if (!live) return;

    let d = num(dt, 1 / 60);
    if (d > 0.25) d = d / 1000;          // a millisecond value, not a stall
    if (d < 0) d = 0;
    if (d > 0.1) d = 0.1;                // a genuine stall: do not skip marks
    t += d;
    still += d;

    for (let i = fx.length - 1; i >= 0; i--) {
      fx[i].t += d;
      if (fx[i].t >= fx[i].life) fx.splice(i, 1);
    }
    if (caretX !== null) caretT += d;

    const s = view(lastView);

    if (s.dead) {
      caretX = null;
      if (s.depth >= RETIRE_ON_DEATH) retire();
      return;
    }

    if (s.aiming) still = 0;
    if (s.firing && !lastFiring) firstFire = true;

    // The run was restarted. Every block and marker on the field is a new
    // object, and the old ones are all missing, which would otherwise read as
    // a whole field of markers being collected at once. Drop the run-scoped
    // tracking; the lessons already learned stay learned, so a player who
    // resets on turn two is not taught the input again.
    if (s.depth < lastDepth) {
      seenNow.clear();
      seenPrev.clear();
      caretX = null;
      fx.length = 0;
    }

    trackMarkers(s);
    trackLanding(s);
    trackTurnEnd(s);
    trackThreat(s);
    trackShop(s);

    lastDepth = s.depth;
    lastBalls = s.balls;
    lastOrigin = s.origin;
    lastFiring = s.firing;

    // Finished when the field has moved past the opening, or when all five
    // lessons have landed. Whichever comes first. Requiring threatSeen stops a
    // fast player retiring the module at depth four and never seeing the line
    // run hot, which is the one lesson that costs a run.
    const lessonsDone = s.depth >= RETIRE_DEPTH ||
      (firstFire && firstJoin && firstMove && threatSeen && s.depth >= 5);

    if (lessonsDone) {
      markTaught();
      if (!threatNow || s.depth >= RETIRE_DEPTH + RETIRE_HOLD) retire();
    }
  }

  // --- drawing --------------------------------------------------------------

  function drawIdle(ctx, s) {
    if (firstFire || s.firing) return;
    const x = s.origin;
    const y = floorY - ballR;

    // A single ring on the thing the player controls. Not a prompt: the
    // launcher is simply the only part of a still screen that is alive.
    if (still > IDLE_RING) {
      if (t - ringAt > RING_LIFE + RING_GAP) ringAt = t;
      const age = t - ringAt;
      if (age >= 0 && age < RING_LIFE) {
        const f = age / RING_LIFE;
        ctx.strokeStyle = rgba(SWARM, 0.30 * (1 - f));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 6 + 18 * easeOut(f), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // The launcher sweeping the arc it can fire into. It shows the axis and
    // the limits at once, never demonstrates an angle the launcher would
    // refuse, and gives way the moment a pointer moves, so a player who
    // already understands never sees it finish a sweep.
    if (still > IDLE_RAY) {
      const phase = ((t - IDLE_RAY) % RAY_PERIOD) / RAY_PERIOD;
      const swing = Math.sin(phase * Math.PI * 2);
      const ang = -Math.PI / 2 + swing * RAY_SWING;
      // Bright enough to read as the launcher moving, dim enough that nobody
      // mistakes it for the real aim guide, which is drawn at more than twice
      // this alpha the moment a drag starts.
      const fade = clamp01((still - IDLE_RAY) / 0.9) * (0.18 + 0.16 * (1 - Math.abs(swing)));
      const tipX = x + Math.cos(ang) * RAY_LEN;
      const tipY = y + Math.sin(ang) * RAY_LEN;

      ctx.save();
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = rgba(SWARM, fade);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = rgba(SWARM, fade * 1.6);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The mark that says where the launcher is about to be. Placed the moment
  // the ball crosses, which makes it a prediction; the launcher then arrives
  // on it, which makes it a confirmed one.
  function drawCaretMark(ctx, x, alpha) {
    ctx.strokeStyle = rgba(SWARM, alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 5.5, floorY + 5);
    ctx.lineTo(x, floorY - 0.5);
    ctx.lineTo(x + 5.5, floorY + 5);
    ctx.stroke();

    ctx.fillStyle = rgba(SWARM, alpha * 0.9);
    ctx.beginPath();
    ctx.arc(x, floorY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHeldCaret(ctx) {
    if (caretX === null) return;
    drawCaretMark(ctx, caretX, 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(caretT * 7)));
  }

  // The launcher does not slide, it is simply somewhere else on the next
  // frame, so a mark that merely travels to the new position arrives at a
  // launcher already standing there and explains nothing. What reads instead
  // is a departure: the old position lets go, and the path draws itself from
  // there to the landing mark. Was there, came along here, is now here.
  function drawTrack(ctx, p, f) {
    const y = floorY - ballR;
    const fade = 1 - f;
    const head = p.x0 + (p.x1 - p.x0) * easeOut(f);

    ctx.strokeStyle = rgba(SWARM, 0.5 * fade * fade);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x0, y, 6 + 7 * f, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = rgba(SWARM, 0.42 * fade);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x0, y);
    ctx.lineTo(head, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = rgba(SWARM, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(head, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // A collected marker travelling to whatever it just made bigger.
  function drawJoin(ctx, p, f) {
    const col = p.gold ? ESSENCE : SWARM;
    const head = easeOut(f);
    const tail = easeOut(clamp01(f - 0.22));
    const fade = 1 - f * f;

    const hx = p.x0 + (p.x1 - p.x0) * head;
    const hy = p.y0 + (p.y1 - p.y0) * head;
    const tx = p.x0 + (p.x1 - p.x0) * tail;
    const ty = p.y0 + (p.y1 - p.y0) * tail;

    ctx.strokeStyle = rgba(col, 0.45 * fade);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    ctx.fillStyle = rgba(col, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Arrival. The swarm mass takes it as a brightening; essence leaves the
    // top edge as a short stroke, because its counter lives above the canvas.
    if (f > 0.75) {
      const g = (f - 0.75) / 0.25;
      ctx.strokeStyle = rgba(col, 0.30 * (1 - g));
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (p.gold) {
        ctx.moveTo(p.x1 - 9 - 14 * g, p.y1 + 2);
        ctx.lineTo(p.x1 + 9 + 14 * g, p.y1 + 2);
      } else {
        ctx.arc(p.x1, p.y1, 8 + 26 * g, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  // A marker breaking up on the line: the same colour as a collection, moving
  // the wrong way, so a miss reads as the same event having failed.
  function drawLost(ctx, p, f) {
    const col = p.gold ? ESSENCE : SWARM;
    const fade = (1 - f) * (1 - f);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.4;
      const spread = 3 + 20 * easeOut(f);
      const px = p.x + Math.cos(a) * spread;
      const py = p.y + Math.abs(Math.sin(a)) * spread * 0.75 + 10 * f * f;
      ctx.fillStyle = rgba(col, 0.55 * fade);
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  // Something below the canvas became possible. A gold edge, once per run.
  function drawSweep(ctx, f) {
    const y = H - 1.5;
    const fade = Math.sin(clamp01(f) * Math.PI);

    ctx.strokeStyle = rgba(ESSENCE, 0.22 * fade);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();

    const head = W * easeOut(f);
    ctx.strokeStyle = rgba(ESSENCE, 0.75 * fade);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, head - 90), y);
    ctx.lineTo(head, y);
    ctx.stroke();
  }

  function drawFx(ctx) {
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      const f = clamp01(e.t / e.life);
      if (e.kind === 'track') drawTrack(ctx, e.p, f);
      else if (e.kind === 'caret') drawCaretMark(ctx, e.p.x, 0.75 * (1 - f));
      else if (e.kind === 'join') drawJoin(ctx, e.p, f);
      else if (e.kind === 'lost') drawLost(ctx, e.p, f);
      else if (e.kind === 'sweep') drawSweep(ctx, f);
    }
  }

  // The line runs hot under a block that is running out of room. It lights two
  // turns before the block can reach it, which is what turns the next purchase
  // into a decision instead of a shrug.
  function drawThreat(ctx, s) {
    if (!showThreat || !s.blocks || !s.blocks.length) return;

    let drew = false;
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i];
      if (!b || typeof b.r !== 'number' || typeof b.c !== 'number') continue;

      const bottom = topY + b.r * cell + cell;
      const rowsLeft = (floorY - bottom) / cell;
      if (rowsLeft > THREAT_ROWS) continue;

      const heat = clamp01(1 - rowsLeft / THREAT_ROWS);
      const x0 = b.c * cell + 3;
      const w = cell - 6;

      ctx.strokeStyle = rgba(HOT, 0.16 + 0.55 * heat * heat);
      ctx.lineWidth = 1 + 1.6 * heat;
      ctx.beginPath();
      ctx.moveTo(x0, floorY + 0.5);
      ctx.lineTo(x0 + w, floorY + 0.5);
      ctx.stroke();

      // Two ticks that reach further up as the block closes on the line.
      const tick = 3 + 7 * heat;
      ctx.strokeStyle = rgba(HOT, 0.10 + 0.42 * heat);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, floorY - tick);
      ctx.lineTo(x0 + 0.5, floorY);
      ctx.moveTo(x0 + w - 0.5, floorY - tick);
      ctx.lineTo(x0 + w - 0.5, floorY);
      ctx.stroke();
      drew = true;
    }

    // If anything is close at all, the rest of the line acknowledges it, so
    // the threat reads as a property of the line rather than of one block.
    if (drew) {
      ctx.strokeStyle = rgba(HOT, 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(t * 4.5)));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, floorY + 0.5);
      ctx.lineTo(W, floorY + 0.5);
      ctx.stroke();
    }
  }

  /**
   * Draw the overlay. Call it after the effects layer has restored the
   * context, so teaching marks do not inherit screen shake: the game shakes,
   * the explanation holds still.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  function draw(ctx) {
    if (!live || !ctx) return;
    const s = view(lastView);
    if (s.dead) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawThreat(ctx, s);
    drawFx(ctx);
    drawHeldCaret(ctx);
    drawIdle(ctx, s);

    ctx.restore();
  }

  // --- optional input listeners --------------------------------------------

  let detach = null;

  /**
   * Wire passive listeners so the idle demonstration yields the instant the
   * player moves a pointer, and so Escape retires the module. Entirely
   * optional: without it the demonstration still appears and still stops at
   * the first shot, it is just less polite to a player who is already moving
   * the mouse.
   *
   * @param {HTMLElement|Window} [el]  the canvas; defaults to the window
   * @returns {function} detach
   */
  function attach(el) {
    if (detach) detach();
    const target = el || (typeof window !== 'undefined' ? window : null);
    if (!target || !target.addEventListener) return function () {};

    const move = () => { still = 0; };
    const key = (e) => { if (e && (e.key === 'Escape' || e.key === 'Esc')) retire(); };
    const win = typeof window !== 'undefined' ? window : null;

    target.addEventListener('mousemove', move, { passive: true });
    target.addEventListener('touchstart', move, { passive: true });
    target.addEventListener('pointermove', move, { passive: true });
    if (win) win.addEventListener('keydown', key);

    detach = function () {
      target.removeEventListener('mousemove', move);
      target.removeEventListener('touchstart', move);
      target.removeEventListener('pointermove', move);
      if (win) win.removeEventListener('keydown', key);
      detach = null;
    };
    return detach;
  }

  // --- API ------------------------------------------------------------------

  return {
    /** False for a returning player, and false forever once the arc is done. */
    get active() {
      return live;
    },

    update: update,
    draw: draw,

    /**
     * Report pointer activity. Only needed when attach() is not used: it ends
     * the idle demonstration for a player who is clearly already engaged.
     */
    pointer(/* x, y, down */) {
      still = 0;
    },

    /**
     * Where the first ball of the turn crossed the swarm line. Only needed if
     * the host's state does not expose `nextOrigin`; with it, this is derived
     * and the call is unnecessary.
     *
     * @param {number} x
     */
    landed(x) {
      if (!live || caretX !== null) return;
      const v = num(x, null);
      if (v === null) return;
      caretX = v;
      caretT = 0;
    },

    /**
     * The advisory opening field. Returns null outside depths 1 to 4 and null
     * once the module has retired, so a host can call it unconditionally and
     * fall through to the generator on null.
     *
     * @param {number} depth
     * @returns {null|{depth:number, cells:boolean[], hp:number[], markers:{col:number,kind:string}[], advisory:boolean}}
     */
    plan(depth) {
      if (!live) return null;
      const d = Math.floor(num(depth, 0));
      return d >= 1 ? planAt(d) : null;
    },

    /** Every advisory row at once, for a balance pass or a field preview. */
    planAll() {
      return PLAN_ROWS.map((_, i) => planAt(i + 1));
    },

    attach: attach,

    /** Remove anything attach() wired up. Safe to call more than once. */
    destroy() {
      if (detach) detach();
      fx.length = 0;
    },

    /**
     * Stop now and never run again on this machine. Wired to Escape by
     * attach(), and safe to call from a key, a menu, or a settings toggle.
     */
    skip: retire,

    /** Clear the stored flag so the arc runs again. Testing only. */
    forget() {
      if (store && typeof store.removeItem === 'function') store.removeItem(storeKey);
      else dropStorage(storeKey);
    },

    /** Keep the geometry in step with a resized canvas. */
    resize(width, height, newFloorY) {
      if (num(width, 0) > 0) W = width;
      if (num(height, 0) > 0) H = height;
      if (num(newFloorY, 0) > 0) floorY = newFloorY;
    },

    /** Which beats have fired. Diagnostic only; nothing in the game reads it. */
    state() {
      return {
        active: live,
        taught: taught,
        seconds: t,
        fired: firstFire,
        collected: firstJoin,
        launcherMoved: firstMove,
        shopLit: shopLit,
        threatSeen: threatSeen,
        threatNow: threatNow,
        marks: fx.length,
        depth: lastDepth,
        balls: lastBalls,
      };
    },
  };
}

export default createOnboarding;

// ---------------------------------------------------------------------------
// HANDOVER - what belongs somewhere else
//
// Three parts of the first minute are not presentation and should not stay in
// this file. Each is implemented or worked around here so the opening is right
// today, and each is a clean lift.
//
// 1. THE OPENING FIELD BELONGS IN patterns.js. PLAN_ROWS is a four row opening
//    regime wearing a different hat. In the generator it is entry zero of
//    SCRIPT with a span of four and a fixed cell table, which would also let
//    the corridor pass handle the handover into 'drift' properly. As it stands
//    the prescription cannot guarantee a shared open column between depth four
//    and whatever the generator emits at depth five, because it does not know
//    the seed.
//
// 2. THE OPENING HEALTH RAMP BELONGS IN THE DIFFICULTY TIER. The host's ramp,
//    round(depth * 0.75), makes every block in the first two rows one health,
//    so nothing is ever seen to lose health and the numbers read as score. The
//    prescription plants a single four health block to fix that. The general
//    form of the rule is that opening rows want variance rather than a flat
//    value: a tier's early ramp should emit a spread wide enough that at least
//    one block always survives a turn.
//
// 3. THE THREAT DISPLAY SHOULD BE PERMANENT. The hot swarm line under a
//    descending block is a heads up element, not a teaching aid, and it is
//    switched off with the rest of this module at depth seven, which is wrong:
//    a player at depth forty wants it more, not less. Moving it into the
//    effects layer or the host's own draw is a short lift, at which point pass
//    threat: false here.
//
// One host bug worth naming while it is in view: uncollected markers are never
// removed from the field. They keep descending past the swarm line and off the
// canvas, growing the array for the length of the run. This module draws them
// breaking up on the line, which is what a player should see; the host still
// needs to cull them.
// ---------------------------------------------------------------------------
