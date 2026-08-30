// ---------------------------------------------------------------------------
// The balls.
//
// A ball is launched up the outer rail, rides it as far as the handle carries
// it, drops into the field and falls through the nails until something catches
// it. That is the entire simulation, and everything the game reads happens
// inside it: a nail struck, a pocket entered, a ball lost down the out lane.
//
// Balls are kept as parallel arrays rather than objects because thousands are
// live at once late in a run and a per-ball object costs more in collection
// pauses than the whole simulation costs in arithmetic. Nothing here allocates
// during a step except the event records the game must be told about, and
// those are rare by construction.
//
// The step is fixed. Two runs from one seed with one sequence of launches play
// out identically, which is what makes a replay, a test and a balance sweep
// possible at all.
// ---------------------------------------------------------------------------

import { pocketAt } from './board.js?v=35';

export const RAIL = 0;
export const FIELD = 1;

const DEG = Math.PI / 180;

/** A pool of balls with room for `cap` of them in flight at once. */
export function createBalls(cap) {
  return {
    cap,
    n: 0,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    spin: new Float32Array(cap),
    state: new Uint8Array(cap),
    railT: new Float32Array(cap),
    age: new Float32Array(cap),
    hits: new Uint16Array(cap),
    stuck: new Uint16Array(cap),
    // What this ball is worth if it lands somewhere that pays. Fittings that
    // enrich a single ball write here rather than reaching into the payout.
    worth: new Float32Array(cap),
    // A flat addition to whatever this ball lands on, kept apart from the
    // multiplier so a part that adds and a part that multiplies do not have
    // to be applied in a particular order to give the same answer.
    add: new Float32Array(cap),
    // Set when a part has paid for this launch, so the tray is not charged.
    free: new Uint8Array(cap),
  };
}

/** Position and tangent at a point along the outer rail, t in 0..1. */
export function railPoint(cfg, t) {
  const p = cfg.physics;
  const a = (p.railFromDeg + (p.railToDeg - p.railFromDeg) * t) * DEG;
  const sa = Math.sin(a), ca = Math.cos(a);
  return {
    x: p.railCx + p.railR * ca,
    y: p.railCy - p.railR * sa,
    // The direction of travel, which is the way the arc is walked.
    dx: -sa,
    dy: -ca,
  };
}

/**
 * Puts a ball on the rail. `strength` is the handle, 0 to 1, and decides how
 * far around the rail the ball gets before it drops into the field.
 * Returns the index, or -1 when the pool is full.
 */
export function launch(cfg, balls, strength, jitter, worth, add, free) {
  if (balls.n >= balls.cap) return -1;
  const i = balls.n++;
  const p = railPoint(cfg, 0);
  balls.x[i] = p.x;
  balls.y[i] = p.y;
  balls.vx[i] = 0;
  balls.vy[i] = 0;
  balls.spin[i] = 0;
  balls.state[i] = RAIL;
  // Where this ball will leave the rail. The machine's own slop is added here
  // and nowhere else, so two balls sent at one setting land differently and a
  // player can feel a setting without ever hitting the same slot twice.
  balls.railT[i] = clamp01(strength + jitter);
  balls.age[i] = 0;
  balls.hits[i] = 0;
  balls.stuck[i] = 0;
  balls.worth[i] = worth === undefined ? 1 : worth;
  balls.add[i] = add === undefined ? 0 : add;
  balls.free[i] = free ? 1 : 0;
  return i;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Drops ball `i` out of the pool by moving the last one into its place. */
export function retire(balls, i) {
  const last = --balls.n;
  if (i !== last) {
    balls.x[i] = balls.x[last]; balls.y[i] = balls.y[last];
    balls.vx[i] = balls.vx[last]; balls.vy[i] = balls.vy[last];
    balls.spin[i] = balls.spin[last]; balls.state[i] = balls.state[last];
    balls.railT[i] = balls.railT[last]; balls.age[i] = balls.age[last];
    balls.hits[i] = balls.hits[last]; balls.worth[i] = balls.worth[last];
    balls.stuck[i] = balls.stuck[last];
    balls.add[i] = balls.add[last]; balls.free[i] = balls.free[last];
  }
}

/**
 * One fixed step.
 *
 * `rand` returns [0,1) and is the run's own stream, so the scatter a nail puts
 * on a ball is part of what a seed reproduces. `out` collects what the game
 * has to react to: `events` for anything that ends a ball, `flashes` for the
 * short lived marks the picture draws where a nail was struck.
 */
export function stepPhysics(cfg, board, balls, dt, rand, out) {
  const P = cfg.physics;
  const grid = board.grid;
  const pins = board.pins;
  const br = P.ballRadius;
  const railStep = P.railSpeed * dt / railLength(cfg);
  const gravity = P.gravity * dt;
  const drag = 1 - P.drag;
  const flashCap = out.flashCap === undefined ? 64 : out.flashCap;

  for (let i = 0; i < balls.n; i++) {
    balls.age[i] += dt;

    // ---- on the rail -----------------------------------------------------
    if (balls.state[i] === RAIL) {
      let t = balls.age[i] * P.railSpeed / railLength(cfg);
      const exit = balls.railT[i];
      if (t >= exit) {
        const p = railPoint(cfg, exit);
        // A ball does not leave the rail at the speed it rode up it. It rolls
        // off the end, and how fast it is still travelling when it does
        // decides whether the handle picks a place on the face or merely
        // throws everything at the same corner.
        const exitSpeed = P.railSpeed * (P.railExit === undefined ? 1 : P.railExit);
        balls.x[i] = p.x;
        balls.y[i] = p.y;
        balls.vx[i] = p.dx * exitSpeed;
        balls.vy[i] = p.dy * exitSpeed;
        balls.state[i] = FIELD;
      } else {
        const p = railPoint(cfg, t);
        balls.x[i] = p.x;
        balls.y[i] = p.y;
        continue;
      }
    }

    // ---- falling through the field ---------------------------------------
    const wasX = balls.x[i], wasY = balls.y[i];
    let x = balls.x[i], y = balls.y[i];
    let vx = balls.vx[i], vy = balls.vy[i];

    vy += gravity;
    vx *= drag; vy *= drag;

    x += vx * dt;
    y += vy * dt;

    // Nails. Only the cells the ball overlaps are ever looked at, so the cost
    // of a step does not grow with the number of nails on the board.
    const reach = br + board.pinRadius;
    const c0 = cellIndex(grid, x - reach, y - reach);
    const c1 = cellIndex(grid, x + reach, y + reach);
    for (let cy = c0.cy; cy <= c1.cy; cy++) {
      for (let cx = c0.cx; cx <= c1.cx; cx++) {
        const c = cy * grid.cols + cx;
        for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
          const pi = grid.items[k] * 3;
          const dx = x - pins[pi], dy = y - pins[pi + 1];
          const rr = br + pins[pi + 2];
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;

          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          // Lift the ball clear so it cannot be caught between two nails.
          x = pins[pi] + nx * rr;
          y = pins[pi + 1] + ny * rr;

          const vn = vx * nx + vy * ny;
          if (vn < -P.restSpeed) {
            // A struck nail. The ball keeps a fraction of its approach speed,
            // loses some of its sideways speed to the brass, and picks up the
            // small unpredictable kick that is the whole reason two balls sent
            // at one setting do not land in the same place.
            const tx = -ny, ty = nx;
            const vt = vx * tx + vy * ty;
            const nvn = -vn * P.restitution;
            const nvt = vt * P.tangent + (rand() * 2 - 1) * P.scatter * Math.abs(vn);
            vx = nx * nvn + tx * nvt;
            vy = ny * nvn + ty * nvt;
            balls.spin[i] += nvt * 0.02;
            balls.hits[i]++;
            if (out.flashes.length < flashCap) {
              out.flashes.push({ x: pins[pi], y: pins[pi + 1], t: 1, kind: 'pin' });
            }
          } else if (vn < 0) {
            // Resting against the nail rather than striking it. Only the speed
            // into the brass is taken away; whatever is left carries the ball
            // around the head, which is what lets gravity walk it off. Taking
            // the sideways speed here as well is what pins a ball to a nail
            // and holds it there.
            vx -= nx * vn; vy -= ny * vn;
            // A ball balanced exactly on a nail head has nowhere to fall to.
            // Tip it toward the side its centre already favours.
            if (Math.abs(nx) < 0.25 && Math.hypot(vx, vy) < P.settleSpeed) {
              vx += (nx >= 0 ? 1 : -1) * P.nudge * (0.4 + rand() * 0.6);
            }
          }
        }
      }
    }

    // Rails down each side of the field.
    const b = cfg.board;
    if (x < b.fieldLeft + br) { x = b.fieldLeft + br; if (vx < -P.restSpeed) vx = -vx * P.restitution; else if (vx < 0) vx = 0; }
    if (x > b.fieldRight - br) { x = b.fieldRight - br; if (vx > P.restSpeed) vx = -vx * P.restitution; else if (vx > 0) vx = 0; }

    // The sloped plates low on the face.
    for (let g = 0; g < board.guides.length; g++) {
      const seg = board.guides[g];
      const hit = segmentPush(x, y, br, seg);
      if (hit) {
        x += hit.nx * hit.push;
        y += hit.ny * hit.push;
        const vn = vx * hit.nx + vy * hit.ny;
        if (vn < -P.restSpeed) {
          const tx = -hit.ny, ty = hit.nx;
          const vt = vx * tx + vy * ty;
          const nvn = -vn * P.restitution;
          const nvt = vt * P.tangent;
          vx = hit.nx * nvn + tx * nvt;
          vy = hit.ny * nvn + ty * nvt;
        } else if (vn < 0) {
          // Lying on the plate. The plate takes the speed into itself and
          // nothing else, so the ball runs down the slope the way it should.
          vx -= hit.nx * vn; vy -= hit.ny * vn;
          vx *= P.slide; vy *= P.slide;
        }
      }
    }

    const speed = Math.hypot(vx, vy);
    if (speed > P.maxSpeed) { const s = P.maxSpeed / speed; vx *= s; vy *= s; }

    // A ball can still be caught where a rail meets a plate, or where a
    // fitting drove a nail in beside another one. Anything that has stopped
    // moving is worked loose, and anything that stays caught is dropped
    // straight past whatever is holding it. Neither is a thing a player sees
    // often, and both are better than a ball that hangs on the face forever.
    const movedX = x - wasX, movedY = y - wasY;
    if (movedX * movedX + movedY * movedY < 0.0009) {
      const s = ++balls.stuck[i];
      if (s > 10) {
        vx += (rand() * 2 - 1) * P.nudge * 2;
        vy += P.nudge;
      }
      if (s > 80) { x += (rand() * 2 - 1) * 0.6; y += P.ballRadius * 2.2; vx = 0; vy = P.nudge; balls.stuck[i] = 0; }
    } else if (balls.stuck[i]) {
      balls.stuck[i] = 0;
    }

    balls.x[i] = x; balls.y[i] = y; balls.vx[i] = vx; balls.vy[i] = vy;

    // Pockets, then the out lane. A pocket is checked against the centre of
    // the ball, which is what a mouth just wider than a ball amounts to.
    // A mouth catches what falls into it. A ball crossing the same band
    // sideways at speed is passing over the pocket, not entering it, and the
    // difference is what stops a wide plate from being a wide pocket.
    const p = vy > 0 ? pocketAt(board, x, y) : null;
    if (p) {
      out.events.push({ type: 'pocket', pocket: p.id, kind: p.kind, pay: p.pay,
        worth: balls.worth[i], add: balls.add[i], hits: balls.hits[i], x, y });
      retire(balls, i--);
      continue;
    }
    if (y >= b.outY || balls.age[i] > P.maxAge) {
      out.events.push({ type: 'out', worth: balls.worth[i], add: balls.add[i], hits: balls.hits[i], x, y });
      retire(balls, i--);
      continue;
    }
    // A ball that somehow leaves the face is lost rather than left in flight.
    if (y > b.h + 20 || y < -40 || x < -20 || x > b.w + 20 || !Number.isFinite(x) || !Number.isFinite(y)) {
      out.events.push({ type: 'out', worth: balls.worth[i], add: balls.add[i], hits: balls.hits[i], x, y });
      retire(balls, i--);
    }
  }
}

let railLenCache = null;
function railLength(cfg) {
  const p = cfg.physics;
  if (!railLenCache || railLenCache.key !== p.railR + ':' + p.railFromDeg + ':' + p.railToDeg) {
    railLenCache = {
      key: p.railR + ':' + p.railFromDeg + ':' + p.railToDeg,
      len: p.railR * Math.abs(p.railToDeg - p.railFromDeg) * DEG,
    };
  }
  return railLenCache.len;
}

function cellIndex(grid, x, y) {
  let cx = Math.floor(x / grid.cell), cy = Math.floor(y / grid.cell);
  if (cx < 0) cx = 0; else if (cx >= grid.cols) cx = grid.cols - 1;
  if (cy < 0) cy = 0; else if (cy >= grid.rows) cy = grid.rows - 1;
  return { cx, cy };
}

/** How far a ball at (x,y) must move to clear a segment, or null. */
function segmentPush(x, y, r, seg) {
  const ax = seg.x1, ay = seg.y1, bx = seg.x2, by = seg.y2;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  let t = ((x - ax) * dx + (y - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t, py = ay + dy * t;
  const ox = x - px, oy = y - py;
  const d = Math.hypot(ox, oy);
  if (d >= r || d === 0) return null;
  return { nx: ox / d, ny: oy / d, push: r - d };
}

/** Everything in flight, cleared. Used between rounds and on a new run. */
export function clearBalls(balls) { balls.n = 0; }

/** A compact record of the pool, small enough to sit inside a save. */
export function serializeBalls(balls) {
  const out = [];
  for (let i = 0; i < balls.n; i++) {
    out.push(
      round3(balls.x[i]), round3(balls.y[i]), round3(balls.vx[i]), round3(balls.vy[i]),
      balls.state[i], round3(balls.railT[i]), round3(balls.age[i]), balls.hits[i], round3(balls.worth[i]),
      round3(balls.add[i]), balls.free[i],
    );
  }
  return out;
}

export function restoreBalls(balls, arr) {
  balls.n = 0;
  if (!Array.isArray(arr)) return balls;
  for (let k = 0; k + 10 < arr.length && balls.n < balls.cap; k += 11) {
    const i = balls.n++;
    balls.x[i] = arr[k]; balls.y[i] = arr[k + 1];
    balls.vx[i] = arr[k + 2]; balls.vy[i] = arr[k + 3];
    balls.state[i] = arr[k + 4]; balls.railT[i] = arr[k + 5];
    balls.age[i] = arr[k + 6]; balls.hits[i] = arr[k + 7]; balls.worth[i] = arr[k + 8];
    balls.add[i] = arr[k + 9]; balls.free[i] = arr[k + 10];
    balls.spin[i] = 0;
  }
  return balls;
}

function round3(v) { return Math.round(v * 1000) / 1000; }
