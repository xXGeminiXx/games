// ---------------------------------------------------------------------------
// The near miss, as a state the screen can be drawn from.
//
// Two drums have agreed and the third is still turning. That moment is what a
// machine like this actually sells - it happens roughly every fourth spin,
// which is far more often than anything pays, and it is shown constantly and
// deliberately. A machine with no reach show is a machine with three numbers
// changing in a box.
//
// Reach is a ladder, not one animation. Each rung runs longer than the one
// below it and carries a higher chance that this particular spin pays, and a
// player who has watched a few hundred spins reads the rung as a probability
// readout. That reading has to be TRUE. Everything here is derived from the
// spin the simulation already decided, so a rung is real information about an
// outcome that was settled before the drums started turning, never a
// decoration bolted on afterwards.
//
// The rung is drawn deterministically from the faces themselves, so it is the
// same rung on every frame of one spin and the same rung again if that spin is
// replayed. Nothing here decides anything, keeps anything, or is allowed to
// move an outcome: given a set of drums it returns what the screen should be
// doing, and that is all it does.
// ---------------------------------------------------------------------------

/** What the screen is doing. */
export const IDLE = 0;
export const SPIN = 1;
export const REACH = 2;
export const LAND = 3;
export const WIN = 4;

/**
 * The rungs, with the share of reaches each one takes and how often it pays.
 *
 * The lengths are what a cabinet of this kind runs and are recorded so the
 * shape stays honest as the machine's own spin length is retuned. What is
 * actually shown is scaled into the time one spin has.
 */
export const TIERS = [
  { tier: 0, name: 'none',   seconds: 0,  wins: 0.00 },
  { tier: 1, name: 'normal', seconds: 6,  wins: 0.05 },
  { tier: 2, name: 'long',   seconds: 14, wins: 0.15 },
  { tier: 3, name: 'big',    seconds: 40, wins: 0.45 },
  { tier: 4, name: 'sure',   seconds: 75, wins: 1.00 },
];

/** Where each drum stops, as a share of the spin. Matches how they are run. */
export const SETTLE = [0.55, 0.75, 0.95];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A stable small number from a few integers, so one spin keeps one rung. */
function mix(a, b, c, d) {
  let h = 0x9e3779b1;
  for (const v of [a, b, c, d]) {
    h = Math.imul(h ^ ((v | 0) + 0x85ebca6b), 0xc2b2ae35);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Which rung a reach climbs to.
 *
 * A spin that pays climbs high and a spin that misses mostly stays low, which
 * is what makes the rung worth reading. The top rung is only ever reached by a
 * spin that pays, so a player who learns to recognize it has learned something
 * true. The draw is taken from the faces rather than from a generator, so it
 * is settled at the same moment the spin is.
 */
export function tierFor(digits, matched, salt) {
  const d = Array.isArray(digits) ? digits : [0, 0, 0];
  const r = mix(d[0], d[1], d[2], (salt | 0) * 2 + (matched ? 1 : 0));
  if (matched) return r < 0.34 ? 4 : r < 0.72 ? 3 : 2;
  return r < 0.06 ? 3 : r < 0.28 ? 2 : 1;
}

/**
 * Everything the screen needs, from one set of drums.
 *
 * `reel` is a turning set as the machine keeps it. `spinSeconds` and
 * `holdSeconds` are how long it turns and how long the answer stays up.
 * `salt` separates one spin from the next so two identical results in a row
 * do not have to climb the same rung.
 *
 * The returned object is written into `into` when one is given, because this
 * runs once a frame for every window on the face.
 */
export function showState(reel, { spinSeconds = 4.6, holdSeconds = 2.4, salt = 0, faces = 10 } = {}, into) {
  const s = into || {};
  const spin = Math.max(0.05, num(spinSeconds, 4.6));
  const hold = Math.max(0.05, num(holdSeconds, 2.4));

  s.phase = IDLE;
  s.tier = 0;
  s.beat = 0;
  s.face = -1;
  s.progress = 0;
  s.crawl = 0;
  s.hold = 0;
  s.symbol = -1;
  s.land = -1;
  s.stopped = 0;
  s.revival = 0;
  s.win = 0;
  if (!reel) return s;

  const plan = reel.plan || null;
  const digits = reel.digits || [0, 0, 0];

  if (reel.spinning) {
    const t = Math.max(0, num(reel.t, 0));
    s.progress = clamp01(t / spin);
    s.stopped = SETTLE.reduce((n, f) => n + (s.progress >= f ? 1 : 0), 0);
    // Two down and agreeing, one still turning. Everything the machine has is
    // spent on the next second.
    const reaching = s.stopped >= 2 && s.stopped < 3 && digits[0] === digits[1];
    if (!reaching) {
      s.phase = SPIN;
      s.beat = s.progress;
      return s;
    }
    s.phase = REACH;
    s.symbol = digits[0];
    s.crawl = clamp01((s.progress - SETTLE[1]) / Math.max(1e-4, SETTLE[2] - SETTLE[1]));
    s.land = plan && Array.isArray(plan.digits) ? plan.digits[2] : -1;
    s.tier = tierFor(plan ? plan.digits : digits, !!(plan && plan.matched), salt);
    s.beat = s.crawl;
    s.face = crawlFace(s, faces);
    return s;
  }

  if (reel.holdT > 0) {
    s.hold = clamp01(1 - reel.holdT / hold);
    s.stopped = 3;
    const matched = digits[0] === digits[1] && digits[1] === digits[2];
    s.symbol = matched ? digits[0] : (digits[0] === digits[1] ? digits[0] : -1);
    if (matched) {
      s.phase = WIN;
      s.tier = tierFor(digits, true, salt);
      // The show appears to fail before it pays. A machine that dips and then
      // blazes feels twice as loud as one that simply blazes, and it costs a
      // curve rather than a scene. It only ever happens on a spin that pays,
      // so anybody who learns to spot it has learned something true.
      s.revival = s.hold < 0.30 ? 1 - clamp01(s.hold / 0.30) : 0;
      s.win = clamp01((s.hold - 0.22) / 0.30);
      s.beat = s.win;
      return s;
    }
    s.phase = LAND;
    s.tier = digits[0] === digits[1] || digits[1] === digits[2] || digits[0] === digits[2] ? 1 : 0;
    s.beat = s.hold;
    return s;
  }

  return s;
}

/**
 * What face the last drum shows while it crawls.
 *
 * The drums are turned by the simulation and the face one lands on is the face
 * it landed on. This is about the seconds before that: a drum that has to
 * decide is drawn stepping through faces one at a time and slowing as it goes,
 * and it is made to pass the face it is being watched for at least once
 * without stopping on it. That pass is the near miss in its purest form and it
 * costs nothing but arithmetic.
 */
export function crawlFace(show, faces = 10) {
  const n = Math.max(2, Math.floor(faces));
  if (!show || show.phase !== REACH || show.land < 0 || show.symbol < 0) return -1;
  const c = clamp01(show.crawl);
  const wrap = (v) => ((v % n) + n) % n;

  // A higher rung steps through fewer faces in the same time, which is what
  // makes it read as slower without anybody being shown a number.
  const steps = show.tier >= 3 ? 4 : show.tier === 2 ? 6 : 9;

  // The approach. Eased, so the drum arrives at the watched face almost
  // stopped rather than flicking past it.
  if (c < 0.62) {
    const k = 1 - Math.pow(1 - c / 0.62, 2.4);
    return wrap(show.symbol + steps - Math.floor(k * steps + 1e-6));
  }
  // The shudder. It sits on the face everybody is watching for, and does not
  // stop there. This pause is the whole trick.
  if (c < 0.80) return show.symbol;

  // Letting go. A drum that only slipped a face or two walks off it; one that
  // has further to fall breaks away and shows the last few faces of its run.
  const gap = wrap(show.symbol - show.land);
  if (gap === 0) return show.land;
  const shown = Math.min(gap, 3);
  const k = clamp01((c - 0.80) / 0.20);
  return wrap(show.land + shown - Math.floor(k * shown + 1e-6));
}
