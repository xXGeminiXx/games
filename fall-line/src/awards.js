// ---------------------------------------------------------------------------
// Awards - a record of the odd things a player managed, and nothing else.
//
// None of these change play. They are checked from a bag of plain numbers the
// run hands over, so that adding one never means threading another counter
// through the simulation, and a missing number simply means the award did not
// happen this time rather than an error.
// ---------------------------------------------------------------------------

/** How many kinds must be open before standing them all counts for anything. */
const FULL_HOUSE_MIN_KINDS = 3;
/** The two surge milestones, named by their awards. */
const TWENTY = 20;
const FIFTY = 50;

const num = (v) => (Number.isFinite(v) ? v : 0);
const flag = (v) => !!v;

/** A rule per award id. Each reads the signals and the tuning numbers. */
const RULES = {
  longway: (s, r) => s.leakFree && s.pathRatio >= num(r.longwayRatio),
  dry: (s, r) => s.dryStreak >= num(r.drySurges),
  unadapted: (s, r) => s.leakFree && s.activeTraits >= num(r.unadaptedTraits),
  highground: (s, r) => s.killHeightMax >= num(r.highgroundHeight),
  earthworks: (s, r) => s.sculptActions >= num(r.earthworksActions),
  fullhouse: (s, r, cfg) => fullHouse(cfg, s, r),
  twenty: (s, r) => s.reached >= (Number.isFinite(r.twentySurge) ? r.twentySurge : TWENTY),
  fifty: (s, r) => s.reached >= (Number.isFinite(r.fiftySurge) ? r.fiftySurge : FIFTY),
  trampled: (s) => s.trampled,
  held: (s, r) => s.heldSeconds >= num(r.heldSeconds),
};

/**
 * Every kind that is open is standing somewhere on the field. Kinds are listed
 * in the order they unlock, so the open ones are the first `unlockedCount` of
 * them; taking the count from the caller keeps this in step with a run that
 * carries unlocks over from an earlier one.
 */
function fullHouse(cfg, s, r) {
  const least = Number.isFinite(r.fullhouseKinds) ? r.fullhouseKinds : FULL_HOUSE_MIN_KINDS;
  const kinds = (cfg.works && cfg.works.kinds) || [];
  const open = Math.min(s.unlockedCount, kinds.length);
  if (open < least) return false;
  for (let i = 0; i < open; i++) {
    if (!s.kindsStanding.includes(kinds[i].id)) return false;
  }
  return true;
}

/** Everything a rule may ask about, with a harmless value for anything absent. */
function readSignals(signals) {
  const s = signals || {};
  return {
    pathRatio: num(s.pathRatio),
    dryStreak: num(s.dryStreak),
    activeTraits: num(s.activeTraits),
    leakFree: flag(s.leakFree),
    killHeightMax: num(s.killHeightMax),
    sculptActions: num(s.sculptActions),
    kindsStanding: Array.isArray(s.kindsStanding) ? s.kindsStanding : [],
    unlockedCount: num(s.unlockedCount),
    reached: num(s.reached),
    trampled: flag(s.trampled),
    heldSeconds: num(s.heldSeconds),
  };
}

/** Whether a set of already-earned ids, given as an array or a Set, holds one. */
function alreadyEarned(earned, id) {
  if (!earned) return false;
  if (typeof earned.has === 'function') return earned.has(id);
  if (Array.isArray(earned)) return earned.includes(id);
  return false;
}

/**
 * The awards that have just been earned, in config order. Nothing already in
 * `earned` comes back, and neither `earned` nor `signals` is touched.
 */
export function checkAwards(cfg, earned, signals) {
  const s = readSignals(signals);
  const rules = cfg.awardRules || {};
  const out = [];
  for (const def of cfg.awards || []) {
    if (!def || alreadyEarned(earned, def.id)) continue;
    const rule = RULES[def.id];
    if (!rule) continue;
    if (rule(s, rules, cfg)) out.push(def.id);
  }
  return out;
}

/** The award definition for an id, or null. */
export function awardDef(cfg, id) {
  for (const def of cfg.awards || []) if (def && def.id === id) return def;
  return null;
}
