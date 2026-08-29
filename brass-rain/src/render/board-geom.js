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
// turning at once. Offsets are in multiples of the window itself, so the
// pattern holds its shape on any size of board, and no two windows touch: the
// ones beside each other are more than a window apart across, and the ones
// above and below are more than a window apart down.
//
// The order fills the ring evenly rather than sweeping round it, so two
// windows sit above and below the centre and four sit at its corners.
export const REEL_RING = [
  [0, -1.35], [0, 1.35],
  [-1.18, -0.72], [1.18, -0.72],
  [-1.18, 0.72], [1.18, 0.72],
];

/** How many windows can be on the face at once, the centre one included. */
export const REEL_WINDOWS = REEL_RING.length + 1;

/** One window: the brass frame, then the three drums inside it. */
function packOneReel(data, at, digits, rect) {
  data[at] = rect.x;
  data[at + 1] = rect.y;
  data[at + 2] = rect.w * 0.5;
  data[at + 3] = rect.h * 0.5;
  const lit = !!(digits && digits.length === 3);
  data[at + 4] = 0;
  data[at + 5] = 0;
  data[at + 6] = 1;
  data[at + 7] = lit ? 1 : 0;
  // Drums sit inside the frame with the brass surround left showing.
  const inset = Math.min(rect.w, rect.h) * 0.10;
  const drumW = (rect.w - inset * 2) / 3;
  const drumH = rect.h - inset * 2;
  for (let i = 0; i < 3; i++) {
    const o = at + (i + 1) * STRIDE;
    const raw = Math.floor(Number(digits && digits[i]) || 0);
    data[o] = rect.x - rect.w * 0.5 + inset + drumW * (i + 0.5);
    data[o + 1] = rect.y;
    data[o + 2] = drumW * 0.5 * 0.94;
    data[o + 3] = drumH * 0.5;
    // A dark window is a real state: the drums are there, they are simply not
    // showing anything, which is not the same as a nought.
    data[o + 4] = lit ? ((raw % 10) + 10) % 10 : -1;
    data[o + 5] = i;
    data[o + 6] = 0;
    data[o + 7] = 0;
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
export function packReels(digits, rect, into, around) {
  const data = ensureFloats(into, REEL_WINDOWS * 4 * STRIDE);
  let at = packOneReel(data, 0, digits, rect);
  let drawn = 1;
  const extra = Array.isArray(around) ? around : [];
  for (const w of extra) {
    if (drawn >= REEL_WINDOWS) break;
    const slot = Math.max(1, Math.floor(Number(w && w.slot) || 1));
    const off = REEL_RING[(slot - 1) % REEL_RING.length];
    at = packOneReel(data, at, w && w.digits, {
      x: rect.x + off[0] * rect.w,
      y: rect.y + off[1] * rect.h,
      w: rect.w,
      h: rect.h,
    });
    drawn++;
  }
  return { data, count: drawn * 4 };
}
