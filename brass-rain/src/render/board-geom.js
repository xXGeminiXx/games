// ---------------------------------------------------------------------------
// The still half of the machine, packed once.
//
// Pins, pockets, rails and deflectors do not move while a round is played, so
// they are turned into instance buffers when the board's version changes and
// left alone after that. Nine hundred pins then cost one upload a round and
// one draw call a frame; the alternative, rebuilding them per frame, is the
// single easiest way to make a face like this slow.
//
// Everything is packed as two vec4s per instance - a rectangle and a payload
// - so every static element shares one vertex layout and one vertex shader,
// and adding a kind of thing to the face costs a fragment shader rather than
// a pipeline.
//
// Buffers only ever grow. A board with fewer pins than the last one reuses
// the array it already has and draws fewer instances, so replaying a round
// does not churn the heap.
//
// Coordinates are board units throughout, x to the right and y downward.
// A pocket's x and y are its CENTRE, and its w and h are its full size.
//
// Pure: no GL, no DOM, no config beyond the numbers passed in.
// ---------------------------------------------------------------------------

export const STRIDE = 8;

// Pocket kinds in the order the shader indexes them. The kind decides how a
// mouth is built - a plaque, a throat, a flap - and its tone decides what it
// is pressed from, which are different questions.
export const POCKET_KINDS = ['out', 'pay', 'gate', 'attacker'];

// The materials a pocket can be pressed from, in the order the shader indexes
// them. Anything unnamed is plain enamel.
export const POCKET_TONES = ['enamel', 'jade', 'oxblood', 'brass'];

// Rail kinds. A wall is a chrome rail with a lit top edge; a guide is a
// flatter brass deflector plate.
export const RAIL_WALL = 0;
export const RAIL_GUIDE = 1;

// Hit marks, in the order the shader indexes them.
export const FLASH_KINDS = ['pin', 'pocket', 'wall', 'gate'];

/** The quad around a pin, in multiples of its radius, with room for shadow. */
export const PIN_QUAD = 2.5;

/**
 * A Float32Array of at least `floats` entries, reusing `arr` when it is
 * already big enough. Capacity climbs in powers of two so a board that grows
 * a little does not reallocate every time.
 */
export function ensureFloats(arr, floats) {
  // Anything that is not an array of numbers is treated as absent rather than
  // measured. A caller that hands over the wrong object would otherwise get a
  // capacity of NaN, which allocates an array of length zero and then fails
  // silently every frame afterwards.
  const have = arr && typeof arr.length === 'number' && Number.isFinite(arr.length) ? arr.length : 0;
  if (have >= floats) return arr;
  let cap = Math.max(64, have);
  while (cap < floats) cap *= 2;
  return new Float32Array(cap);
}

/**
 * A small deterministic number in [0, 1) from an integer. Gives each pin and
 * each pocket its own slight variation - the lattice reads as hand adjusted
 * rather than printed - without storing anything per element.
 */
export function seedOf(i) {
  let x = (i + 1) * 0x9e3779b1;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Pins as x, y, half size, half size / radius, seed, 0, 0.
 * `pins` is the flat x, y, r triple array the board carries.
 */
export function packPins(pins, into) {
  const count = pins && pins.length ? Math.floor(pins.length / 3) : 0;
  const data = ensureFloats(into, Math.max(STRIDE, count * STRIDE));
  for (let i = 0; i < count; i++) {
    const r = Math.max(1e-4, finite(pins[i * 3 + 2], 0.5));
    const o = i * STRIDE;
    data[o] = finite(pins[i * 3], 0);
    data[o + 1] = finite(pins[i * 3 + 1], 0);
    data[o + 2] = r * PIN_QUAD;
    data[o + 3] = r * PIN_QUAD;
    data[o + 4] = r;
    data[o + 5] = seedOf(i);
    data[o + 6] = 0;
    data[o + 7] = 0;
  }
  return { data, count };
}

/** The middle pin radius, which is what a ball is sized against by default. */
export function medianPinRadius(pins) {
  const count = pins && pins.length ? Math.floor(pins.length / 3) : 0;
  if (!count) return 0;
  const radii = new Float64Array(count);
  for (let i = 0; i < count; i++) radii[i] = Math.max(0, finite(pins[i * 3 + 2], 0));
  radii.sort();
  return radii[count >> 1];
}

/** The index the shader uses for a pocket kind; anything unknown is plain. */
export function pocketKindIndex(kind) {
  const i = POCKET_KINDS.indexOf(kind);
  return i < 0 ? 0 : i;
}

/** The index the shader uses for a pocket tone; anything unknown is enamel. */
export function pocketToneIndex(tone) {
  const i = POCKET_TONES.indexOf(tone);
  return i < 0 ? 0 : i;
}

/** The index the shader uses for a hit mark kind. */
export function flashKindIndex(kind) {
  const i = FLASH_KINDS.indexOf(kind);
  return i < 0 ? 0 : i;
}

/**
 * Pockets as centre, half size, kind, open, tone, brass lip width.
 * The lip is a fraction of the pocket's shorter side so a tall gate and a
 * wide payout tray carry the same weight of brass.
 */
export function packPockets(pockets, into, { lip = 0.18 } = {}) {
  const list = Array.isArray(pockets) ? pockets : [];
  const count = list.length;
  const data = ensureFloats(into, Math.max(STRIDE, count * STRIDE));
  for (let i = 0; i < count; i++) {
    const p = list[i] || {};
    const w = Math.max(1e-4, finite(p.w, 1));
    const h = Math.max(1e-4, finite(p.h, 1));
    const o = i * STRIDE;
    data[o] = finite(p.x, 0);
    data[o + 1] = finite(p.y, 0);
    data[o + 2] = w * 0.5;
    data[o + 3] = h * 0.5;
    data[o + 4] = pocketKindIndex(p.kind);
    data[o + 5] = p.open === false ? 0 : 1;
    data[o + 6] = pocketToneIndex(p.tone);
    data[o + 7] = Math.min(w, h) * 0.5 * lip;
  }
  return { data, count };
}

/**
 * Walls and deflectors as one buffer: centre, half length, half thickness,
 * then the unit direction, the kind and a seed.
 *
 * A segment with no length at all would leave the direction undefined, so it
 * is dropped rather than drawn as a speck pointing nowhere.
 */
export function packRails(walls, guides, into, { wallThickness = 0.9, guideThickness = 0.55 } = {}) {
  const sets = [
    [Array.isArray(walls) ? walls : [], RAIL_WALL, wallThickness],
    [Array.isArray(guides) ? guides : [], RAIL_GUIDE, guideThickness],
  ];
  let total = 0;
  for (const [list] of sets) total += list.length;
  const data = ensureFloats(into, Math.max(STRIDE, total * STRIDE));
  let count = 0;
  let n = 0;
  for (const [list, kind, thickness] of sets) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      n++;
      const x1 = finite(s.x1, 0), y1 = finite(s.y1, 0);
      const x2 = finite(s.x2, 0), y2 = finite(s.y2, 0);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      const t = Math.max(1e-4, finite(s.thickness, thickness));
      const o = count * STRIDE;
      data[o] = (x1 + x2) * 0.5;
      data[o + 1] = (y1 + y2) * 0.5;
      data[o + 2] = len * 0.5;
      data[o + 3] = t * 0.5;
      data[o + 4] = dx / len;
      data[o + 5] = dy / len;
      data[o + 6] = kind;
      data[o + 7] = seedOf(n * 13 + 5);
      count++;
    }
  }
  return { data, count };
}

/**
 * Hit marks for one frame, written into an array that is allocated once.
 * `t` counts 1 down to 0, so a mark starts small and hard and opens out as
 * it fades, the way a struck pin lets go of the light.
 */
export function packFlashes(flashes, into, radius, cap) {
  const list = Array.isArray(flashes) ? flashes : [];
  const limit = Math.min(list.length, cap);
  const data = ensureFloats(into, Math.max(STRIDE, cap * STRIDE));
  let count = 0;
  for (let i = 0; i < limit; i++) {
    const f = list[i];
    if (!f) continue;
    const t = finite(f.t, 0);
    if (t <= 0 || t > 1.0001) continue;
    const grow = 1 + (1 - t) * 0.55;
    const o = count * STRIDE;
    data[o] = finite(f.x, 0);
    data[o + 1] = finite(f.y, 0);
    data[o + 2] = radius * grow;
    data[o + 3] = radius * grow;
    data[o + 4] = t;
    data[o + 5] = flashKindIndex(f.kind);
    data[o + 6] = seedOf(i * 31 + 11);
    data[o + 7] = 0;
    count++;
  }
  return { data, count };
}

/**
 * The launch rail: one instance covering the whole circle it is cut from.
 * The arc itself is measured in the fragment shader, so it is a true circle
 * with round ends rather than a chain of straight pieces.
 *
 * Angles arrive in degrees on the convention the machine is laid out with -
 * a point at angle a is (cx + R cos a, cy - R sin a), so the angle climbs
 * anticlockwise on a face whose y runs downward.
 */
export function packArc(rail, into) {
  const data = ensureFloats(into, STRIDE);
  if (!rail) return { data, count: 0 };
  const r = Math.max(1e-4, finite(rail.r, 1));
  const width = Math.max(1e-4, finite(rail.width, r * 0.045));
  const reach = r + width * 2.2;
  data[0] = finite(rail.cx, 0);
  data[1] = finite(rail.cy, 0);
  data[2] = reach;
  data[3] = reach;
  data[4] = r;
  data[5] = (finite(rail.fromDeg, 0) * Math.PI) / 180;
  data[6] = (finite(rail.toDeg, 0) * Math.PI) / 180;
  data[7] = width;
  return { data, count: 1 };
}

/**
 * The reel window and its three drums as four instances: the frame first so
 * the drums land on top of it.
 * `digits` is the three number array the view carries, or nothing at all when
 * the window is dark, in which case the drums are packed blank.
 */
// Where a second, third or seventh set of drums sits when more than one is
// turning at once.
//
// They are arranged around the show screen, not around each other, because the
// screen is the largest thing on the face and anything that lands on it is
// unreadable. Offsets are in multiples of the screen's HALF extent, so a
// number past one is clear of its edge whatever size the screen is built at.
//
// The order fills the ring evenly rather than sweeping round it: the first two
// open beside the screen where there is most room, then the pair below on the
// apron, then the pair above in the shoulders, which is the tightest space and
// is why they sit closer in.
export const REEL_RING = [
  [-1.38, 0.10], [1.38, 0.10],
  [-1.30, 0.86], [1.30, 0.86],
  [-1.38, -0.25], [1.38, -0.25],
];

// How big an extra window is beside the main strip of drums. Smaller, because
// only one of them is the spin being watched and the rest are a queue.
export const RING_SCALE = 0.62;

/** How many windows can be on the face at once, the centre one included. */
export const REEL_WINDOWS = REEL_RING.length + 1;

/**
 * The show screen: one instance, carrying what the machine is doing.
 *
 * A cabinet is built around this. The nails are a ring and an apron about it,
 * not the other way round, and it is the thing a player is actually watching
 * while a ball is in the air. One rectangle is enough because everything on it
 * is measured per pixel in the fragment shader.
 */
export function packScreen(rect, show, into) {
  const data = ensureFloats(into, STRIDE);
  const s = show || {};
  data[0] = finite(rect.x, 0);
  data[1] = finite(rect.y, 0);
  data[2] = Math.max(1e-4, finite(rect.w, 1)) * 0.5;
  data[3] = Math.max(1e-4, finite(rect.h, 1)) * 0.5;
  data[4] = Math.max(0, Math.min(4, Math.floor(finite(s.phase, 0))));
  data[5] = Math.max(0, Math.min(4, Math.floor(finite(s.tier, 0))));
  data[6] = Math.max(0, Math.min(1, finite(s.progress, 0)));
  data[7] = Math.max(0, Math.min(1, finite(s.intensity, 0)));
  return { data, count: 1 };
}

/**
 * How hard the machine is pushing, on one scale from nothing to everything.
 *
 * Every part of the picture that answers to the show - the screen, the side
 * lamps, the topper, the rays - rides this one number, so they escalate
 * together instead of each being tuned against the others. A rung of the
 * ladder sets the ceiling and the seconds inside it set how far up that
 * ceiling the machine has climbed.
 */
export function showIntensity(show) {
  if (!show) return 0;
  const tier = Math.max(0, Math.min(4, Math.floor(finite(show.tier, 0))));
  const ceiling = [0.10, 0.42, 0.66, 0.86, 1.00][tier];
  if (show.phase === 4) {
    // Paid. The dip before it blazes is worth more than the blaze alone.
    const dip = 1 - 0.75 * finite(show.revival, 0);
    return Math.max(0.55, Math.min(1, (0.72 + 0.28 * finite(show.win, 0)) * dip));
  }
  if (show.phase === 2) {
    const climb = Math.pow(Math.max(0, Math.min(1, finite(show.crawl, 0))), 0.7);
    return Math.min(1, 0.18 + (ceiling - 0.18) * climb);
  }
  if (show.phase === 3) return Math.max(0, ceiling * 0.35 * (1 - finite(show.hold, 0)));
  if (show.phase === 1) return 0.14 + 0.06 * finite(show.progress, 0);
  return 0.08;
}

// The things the machine does back, in the order the shader indexes them.
export const EVENT_KINDS = ['lane', 'sweep', 'ride', 'doors'];

/** How many of these can be on the board at once before the rest are dropped. */
export const EVENT_CAP = 8;

const kindIndex = (k) => Math.max(0, EVENT_KINDS.indexOf(k));

/**
 * The live events, as one instance each.
 *
 * Only the four that need drawing are packed. An extra mouth and a brass
 * shutter are already on the board's own pockets and plates, so whatever draws
 * those draws these, and packing them again would draw them twice.
 *
 * An event that is only being announced is not packed at all. Nothing about
 * the board has changed yet, and it has no position to be drawn at: the
 * warning is carried on the machinery that is always there - the lamps, the
 * sign, the screen - which is what makes it a warning rather than a preview.
 */
export function packEvents(events, boardW, boardH, into) {
  const list = events && Array.isArray(events.active) ? events.active : [];
  const data = ensureFloats(into, EVENT_CAP * STRIDE);
  let count = 0;
  for (let i = 0; i < list.length && count < EVENT_CAP; i++) {
    const e = list[i];
    if (!e || e.pending) continue;
    const kind = EVENT_KINDS.indexOf(e.kind);
    if (kind < 0) continue;
    const o = count * STRIDE;
    // How far through it is, and how close it is to ending, because a thing
    // about to stop should be seen stopping rather than simply vanishing.
    const progress = Math.max(0, Math.min(1, finite(e.progress, 0)));
    const fade = e.done ? 0 : Math.min(1, Math.max(0.0, 1 - Math.max(0, progress - 0.88) / 0.12));
    let extra = 0;
    if (kind === 0) {
      const x0 = finite(e.x0, 0), x1 = finite(e.x1, boardW);
      const yT = finite(e.yTop, 0), yB = finite(e.yBottom, boardH);
      data[o] = (x0 + x1) * 0.5;
      data[o + 1] = (yT + yB) * 0.5;
      data[o + 2] = Math.max(1e-3, Math.abs(x1 - x0) * 0.5);
      data[o + 3] = Math.max(1e-3, Math.abs(yB - yT) * 0.5);
    } else if (kind === 1) {
      const r = Math.max(1e-3, finite(e.r, boardW * 0.05));
      data[o] = finite(e.x, boardW * 0.5);
      data[o + 1] = finite(e.y, boardH * 0.5);
      // Room for the whole thing rather than for the band it pays over: a
      // wingtip, a tail, a pouring stream and a dropping stem all reach past
      // the column of face the mouths under them are counted in.
      data[o + 2] = r * 2.1;
      data[o + 3] = r * 1.9;
      // Which way it is travelling, so it can be turned round rather than
      // drawn twice. What it looks like is the cabinet's own business.
      extra = finite(e.dir, 1) >= 0 ? 0 : 0.5;
    } else if (kind === 2) {
      data[o] = boardW * 0.5;
      data[o + 1] = boardH * 0.5;
      data[o + 2] = boardW * 0.5;
      data[o + 3] = boardH * 0.5;
      extra = Math.max(1, finite(e.mult, 1));
    } else {
      const n = Math.max(1, Math.floor(finite(e.doors, 3)));
      const pick = Math.max(0, Math.min(n - 1, Math.floor(finite(e.pick, 0))));
      data[o] = boardW * 0.5;
      data[o + 1] = boardH * 0.80;
      data[o + 2] = Math.min(boardW * 0.42, n * boardW * 0.085);
      data[o + 3] = boardH * 0.055;
      const called = Number.isInteger(e.choice) ? Math.max(0, Math.min(n - 1, e.choice)) + 1 : 0;
      extra = n * 1000 + pick * 100 + called * 10 + (e.revealed ? 1 : 0);
    }
    data[o + 4] = kind;
    data[o + 5] = progress;
    data[o + 6] = fade;
    data[o + 7] = extra;
    count++;
  }
  return { data, count };
}

/**
 * How loudly the machine is announcing something that has not happened yet.
 *
 * A warning has nowhere on the board to be drawn, because the thing it is
 * warning about does not exist yet. So it is carried on the parts that are
 * always there and always lit, and this is the one number that drives them.
 */
export function tellHeat(events) {
  const list = events && Array.isArray(events.active) ? events.active : [];
  let most = 0;
  for (const e of list) {
    if (!e || !e.pending) continue;
    const total = Math.max(1, finite(e.tellBalls, 0));
    const left = Math.max(0, finite(e.tellLeft, 0));
    most = Math.max(most, Math.min(1, 1 - left / total));
  }
  return most;
}

/** One window: the brass frame, then the three drums inside it. */
function packOneReel(data, at, digits, rect, housed, lastFace) {
  data[at] = rect.x;
  data[at + 1] = rect.y;
  data[at + 2] = rect.w * 0.5;
  data[at + 3] = rect.h * 0.5;
  const lit = !!(digits && digits.length === 3);
  data[at + 4] = 0;
  // A window set into the show screen already has a housing around it, so it
  // is drawn as a bare drum bezel rather than as a second brass surround.
  data[at + 5] = housed ? 1 : 0;
  data[at + 6] = 1;
  data[at + 7] = lit ? 1 : 0;
  // Drums sit inside the frame with the brass surround left showing.
  const inset = Math.min(rect.w, rect.h) * 0.10;
  const drumW = (rect.w - inset * 2) / 3;
  const drumH = rect.h - inset * 2;
  for (let i = 0; i < 3; i++) {
    const o = at + (i + 1) * STRIDE;
    // The last drum can be told what to show while it is still turning, so it
    // steps through faces one at a time instead of flickering. What it stops
    // on is never overridden: that face belongs to the spin.
    const over = i === 2 && Number.isFinite(lastFace) && lastFace >= 0 ? lastFace : null;
    const raw = Math.floor(over === null ? (Number(digits && digits[i]) || 0) : over);
    data[o] = rect.x - rect.w * 0.5 + inset + drumW * (i + 0.5);
    data[o + 1] = rect.y;
    data[o + 2] = drumW * 0.5 * 0.94;
    data[o + 3] = drumH * 0.5;
    // A dark window is a real state: the drums are there, they are simply not
    // showing anything, which is not the same as a nought.
    data[o + 4] = lit || over !== null ? ((raw % 10) + 10) % 10 : -1;
    data[o + 5] = i;
    data[o + 6] = 0;
    data[o + 7] = housed ? 1 : 0;
  }
  return at + 4 * STRIDE;
}

/**
 * The reel windows. `digits` is the centre one and is always drawn, because
 * the window is part of the machine whether or not anything is showing in it.
 * `around` is what else is turning: each entry carries its own digits and the
 * ring position it opened in, so a window stays where it is while it is read.
 *
 * The buffer is always sized for a full ring, so a busy frame never reallocates
 * and a quiet one costs the same as it always did.
 */
export function packReels(digits, rect, into, around, opts) {
  const o = opts || {};
  const data = ensureFloats(into, REEL_WINDOWS * 4 * STRIDE);
  let at = packOneReel(data, 0, digits, rect, o.housed, o.lastFace);
  let drawn = 1;
  // The extra windows are spaced against whatever they are arranged around,
  // which is the screen and not the strip of drums inside it, so the pattern
  // clears the housing instead of landing on top of it.
  const ring = o.ring || rect;
  const scale = Number.isFinite(o.ringScale) ? o.ringScale : RING_SCALE;
  const extra = Array.isArray(around) ? around : [];
  for (const w of extra) {
    if (drawn >= REEL_WINDOWS) break;
    const slot = Math.max(1, Math.floor(Number(w && w.slot) || 1));
    const off = REEL_RING[(slot - 1) % REEL_RING.length];
    at = packOneReel(data, at, w && w.digits, {
      x: ring.x + off[0] * ring.w * 0.5,
      y: ring.y + off[1] * ring.h * 0.5,
      w: rect.w * scale,
      h: rect.h * scale,
    }, false, -1);
    drawn++;
  }
  return { data, count: drawn * 4 };
}
