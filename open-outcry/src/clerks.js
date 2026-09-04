// ---------------------------------------------------------------------------
// Clerks: what a hired hand can read off the board and what it can do about it.
//
// A clerk is a card in the rules engine (src/rules.js). The engine never runs
// any code the player wrote: a card can only name a sensor and an action that
// this file registered, so the worst a badly written card can do is nothing.
//
// The sensors and actions arrive in TIERS. A player with one clerk can read the
// mid and how far the mid has left their quote, and can requote; that single
// pairing is the whole of the first clerk, and it is deliberately the exact
// click the player has been making by hand. Size, the position, the flow, the
// spread and a runner's news appear as more clerks are hired, so the composer
// is never a wall of choices nobody has a use for yet.
//
// Every sensor reads the pit the card belongs to, which arrives on the context.
// One engine per pit, so a card written for grain cannot fire on oil.
// ---------------------------------------------------------------------------

import { createRegistry } from './rules.js?v=5';
import { PLAYER_ID, SELL } from './market.js?v=5';

// Which reading and which action arrive with which clerk. A tier is a count of
// clerks hired across the whole run.
export const SENSOR_TIERS = {
  mid: 1, stale: 1,
  spread: 2, position: 2,
  volume: 3, flow: 3,
  cash: 4, drift: 4,
  disagreement: 5, rumour: 5,
};

export const ACTION_TIERS = {
  requote: 1,
  resize: 2, cut: 2,
  widen: 3, narrow: 3,
  lean: 4, pull: 4, push: 4,
};

const READ = {
  mid: (p) => Math.round(p.mid * 10) / 10,
  stale: (p) => Math.round(Math.abs(p.drift()) * 10) / 10,
  drift: (p) => Math.round(p.drift() * 10) / 10,
  spread: (p) => p.m.books[0].spread(),
  position: (p) => p.position,
  volume: (p) => { let v = 0; for (const f of p.m.fills) v += f.qty; return v; },
  flow: (p) => p.m.netFlow(0),
  cash: (p) => Math.round(p.m.player.money),
  disagreement: (p) => Math.round(p.m.beliefSpread(0) * 1000) / 1000,
  rumour: (p) => !!p.rumourKnown,
};

// What the number beside a reading is counted in, in the words the rest of the
// game uses. It used to say ticks and units, which are the engine's words.
const UNITS = {
  mid: 'coins', stale: 'coins', drift: 'coins', spread: 'coins',
  position: 'sacks', volume: 'sacks', flow: 'sacks', cash: '', disagreement: '',
};

const DO = {
  requote: (p, a) => { if (a.spread) p.setSpread(a.spread); p.recentre(); },
  resize: (p, a) => { p.setSize(a.size); },
  cut: (p, a) => {
    const want = Math.max(0, Math.round(a.to));
    if (p.position - want <= 0) return;
    const qty = Math.min(p.position - want, p.m.player.inv[0]);
    if (qty > 0) p.m.post(PLAYER_ID, 0, SELL, 1, qty, { ioc: true });
  },
  widen: (p, a) => { p.setSpread(p.spread + Math.max(1, Math.round(a.by))); p.recentre(); },
  narrow: (p, a) => { p.setSpread(p.spread - Math.max(1, Math.round(a.by))); p.recentre(); },
  lean: (p, a) => { p.lean = Math.round(a.ticks); p.recentre(); },
  pull: (p) => { p.pull(); },
  push: (p) => { p.push(); p.recentre(); },
};

const ARGS = {
  requote: [{ name: 'spread', label: 'spread', type: 'number', min: 0, max: 200, step: 1, default: 0 }],
  resize: [{ name: 'size', label: 'size', type: 'number', min: 1, max: 1e9, step: 1, default: 10 }],
  cut: [{ name: 'to', label: 'down to', type: 'number', min: 0, max: 1e9, step: 1, default: 0 }],
  widen: [{ name: 'by', label: 'by', type: 'number', min: 1, max: 100, step: 1, default: 2 }],
  narrow: [{ name: 'by', label: 'by', type: 'number', min: 1, max: 100, step: 1, default: 1 }],
  lean: [{ name: 'ticks', label: 'ticks', type: 'number', min: -100, max: 100, step: 1, default: 0 }],
  pull: [],
  push: [],
};

// Build the registry for a given clerk count. It is rebuilt when the count
// changes, and the composer with it, so the selects only ever offer what the
// player has actually reached.
export function buildRegistry(content, tier = 1) {
  const reg = createRegistry();
  const has = (t) => t <= Math.max(1, tier);

  for (const [name, t] of Object.entries(SENSOR_TIERS)) {
    if (!has(t)) continue;
    reg.sensor(name, {
      label: content.sensors[name] || name,
      type: name === 'rumour' ? 'boolean' : 'number',
      unit: UNITS[name] || '',
      read: (ctx) => READ[name](ctx.pit),
    });
  }
  for (const [name, t] of Object.entries(ACTION_TIERS)) {
    if (!has(t)) continue;
    reg.action(name, {
      label: content.actions[name] || name,
      args: ARGS[name],
      run: (ctx, args) => DO[name](ctx.pit, args),
    });
  }
  return reg;
}

// The card a new clerk starts with: follow the mid. It is the click the player
// has been making by hand, written down, and it is editable from the moment it
// appears.
export function firstCard(content, spread) {
  return {
    id: 'follow',
    name: content.clerkCards.firstName,
    when: [{ sensor: 'stale', op: '>', value: 1 }],
    then: { action: 'requote', args: { spread: Math.max(2, Math.round(spread)) } },
    priority: 10,
    cooldownTicks: 0,
    enabled: true,
  };
}

export default buildRegistry;
