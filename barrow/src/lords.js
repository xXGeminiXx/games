// ---------------------------------------------------------------------------
// The lords of the dead, and the ground they own.
//
// The dig is cut into stretches of `lords.every` layers, and each stretch
// belongs to one lord. The floor under its last layer is his door. Which lord
// owns which stretch is fixed the moment a barrow is opened, from its seed:
// the first door is always Rex Mortis and every fifth is Mortifer, and the
// three between are dealt from the rest, so no two barrows meet the same
// three. Past Mortifer the round starts again with everybody in the deal and
// one pass harder, which is where the affixes come from.
//
// Everything here is a pure function of the config, the seed and a layer
// number. Nothing is stored: a save is still just a depth.
// ---------------------------------------------------------------------------

import { hash } from './rng.js?v=36';
import * as Lore from './lore.js?v=36';

/** Which lord's stretch layer k is in, counting from zero. */
export function realmOf(k, cfg) {
  return Math.floor(Math.max(0, k | 0) / cfg.lords.every);
}

/** Whether the floor into layer k is a lord's door. */
export function isDoor(k, cfg) {
  return k > 0 && k % cfg.lords.every === 0;
}

/** The layer a stretch's door opens onto. */
export function doorLayer(r, cfg) {
  return (r + 1) * cfg.lords.every;
}

/** The first door below layer k: the one the player is digging toward. */
export function nextDoor(k, cfg) {
  return doorLayer(realmOf(k, cfg), cfg);
}

/** A deterministic shuffle of `list` for this seed and salt. */
function dealt(list, seed, salt) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash(seed, salt + ':' + i) % (i + 1);
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/**
 * The lord who owns stretch r of this barrow: who he is, which pass of the
 * round this is, and the affixes that pass has put on him.
 */
export function lordAt(cfg, seed, r) {
  const L = cfg.lords;
  const round = Math.floor(r / L.round);
  const pos = r % L.round;
  let id;
  if (pos === L.round - 1) id = L.last;
  else if (round === 0 && pos === 0) id = L.first;
  else {
    // The first round deals the rotating lords into the three middle doors;
    // every round after deals everybody but Mortifer into four.
    const pool = round === 0 ? L.rotating : [L.first].concat(L.rotating);
    const deck = dealt(pool, seed, 'lords-round:' + round);
    id = deck[(round === 0 ? pos - 1 : pos) % deck.length];
  }
  const def = L.list[id];
  const affixes = [];
  if (round > 0) {
    const deck = dealt(L.affixes, seed, 'affixes:' + r);
    for (let i = 0; i < Math.min(round, deck.length); i++) affixes.push(deck[i]);
  }
  let door = 1, hoard = 1;
  const rule = Object.assign({}, def.rule);
  for (const a of affixes) {
    door *= a.door || 1;
    hoard *= a.hoard || 1;
    for (const key of ['value', 'visitGap']) {
      if (a[key] !== undefined) rule[key] = (rule[key] === undefined ? 1 : rule[key]) * a[key];
    }
  }
  return { id, r, round, pass: round + 1, pos, def, affixes, door, hoard, rule };
}

/** The material of layer k: the owning lord's, by where k sits in his ten. */
export function materialAt(cfg, seed, k) {
  const lord = lordAt(cfg, seed, realmOf(k, cfg));
  const m = lord.def.materials[Math.max(0, k | 0) % cfg.lords.every] || lord.def.materials[0];
  return { name: m[0], hue: m[1], lord };
}

/**
 * The door on the floor into layer k, or null. The door belongs to the lord
 * of the stretch ABOVE it: his ten layers are what the player dug to reach it.
 */
export function doorAt(cfg, seed, k) {
  if (!isDoor(k, cfg)) return null;
  const r = realmOf(k, cfg) - 1;
  const lord = lordAt(cfg, seed, r);
  return { k, r, lord, thickness: cfg.lords.doorThickness * lord.door };
}

/** Which door of its round a door is, one to five, for what it pays. */
export function doorNumber(r, cfg) {
  return (r % cfg.lords.round) + 1;
}

/**
 * The lord's name as the player sees it: the affixes the pass has put on him
 * in front, and from the second pass a title after it.
 */
export function nameOf(lord) {
  const words = Lore.lord(lord.id);
  const base = words ? words.name : lord.id;
  const pre = lord.affixes.map(a => Lore.affix(a.id).name).join(' ');
  const passWords = Lore.passTitle(lord.pass);
  return (pre ? pre + ' ' : '') + base + (passWords ? ', ' + passWords : '');
}

/** The short name, for a line that says whose door it is. */
export function shortName(lord) {
  const words = Lore.lord(lord.id);
  const base = words ? words.name : lord.id;
  const pre = lord.affixes.map(a => Lore.affix(a.id).name).join(' ');
  return (pre ? pre + ' ' : '') + base;
}
