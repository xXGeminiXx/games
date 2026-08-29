// Vendored from the game-art foundation (lib/rules.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Rules - the no-code automation layer.
//
// A player writes cards. A card is plain JSON: some conditions, one action, a
// priority, a cooldown and an optional budget. Every tick the engine walks the
// cards in priority order and fires the first N whose conditions all hold. The
// player never writes code, and the engine never runs any: conditions are
// looked up in an operator table and actions are functions the GAME registered
// by name. There is no eval and no Function constructor anywhere, so a card
// pasted from a stranger can do nothing the game did not already offer.
//
// The engine knows nothing about any game. A game registers sensors (named
// readings with a declared type) and actions (named functions with an argument
// schema); the cards can only refer to those names. That is what makes this
// reusable: the same composer drives a mine, a fleet or a farm.
//
// Two properties matter more than features.
//
// Determinism: evaluation is a fixed step driven by tick(), every reading is
// taken once per tick, ties in priority break on the card id, and nothing here
// reaches for an unseeded source of randomness. The same cards over the same
// readings produce the same fire trace on every machine.
//
// It must never throw mid-tick. A card is checked before it is installed; a
// card that fails its check is installed QUARANTINED so the player can see it
// and repair it instead of losing it. A card whose action throws at runtime is
// quarantined on the spot with the error kept for display. A tick with a
// broken card in it still runs every other card.
//
// explain() is the other half of the design. Automation that silently does
// nothing is unreadable, so the engine can always say, for every card, whether
// it would fire and if not which condition failed and what the reading
// actually was. The composer shows that sentence on the card.
// ---------------------------------------------------------------------------

// Bumped when the saved shape changes. fromJSON refuses a version it does not
// know rather than guessing at a stranger's fields.
export const RULES_SCHEMA = 1;

// The operators a condition may use. Kept as a table so a card is data: the
// only thing a card can name is a key of this object.
//   compare ops   read the sensor and compare it with the card's value
//   between       inclusive range, value is [low, high]
//   changedBy     the signed change since the previous committed tick.
//                 a positive value asks "rose by at least this much", a
//                 negative one "fell by at least this much", zero "changed"
//   for           an inner condition that has held for K consecutive ticks
export const OPS = ['<', '<=', '>', '>=', '==', '!=', 'between', 'changedBy', 'for'];
const NUMERIC_OPS = new Set(['<', '<=', '>', '>=', 'between', 'changedBy']);
const INNER_OPS = OPS.filter((o) => o !== 'for');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => isNum(v) && Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Registry - what the game offers the player to build cards from.
// ---------------------------------------------------------------------------

// sensor(name, { label, type, read, unit, min, max, step, options, format })
//   type is 'number', 'boolean' or 'enum'; options lists the values of an enum.
//   read(ctx) returns the current value. It is called at most once per tick.
// action(name, { label, args, run })
//   args is a list of { name, label, type, min, max, step, options, default }.
//   run(ctx, args, info) does the thing. Its return value is ignored.
export function createRegistry() {
  const sensors = new Map();
  const actions = new Map();
  const reg = {
    sensor(name, def) {
      sensors.set(name, { name, label: def.label || name, type: def.type || 'number', unit: def.unit || '', ...def });
      return reg;
    },
    action(name, def) {
      actions.set(name, { name, label: def.label || name, args: def.args || [], run: def.run });
      return reg;
    },
    sensors,
    actions,
    sensor_(name) { return sensors.get(name); },
    action_(name) { return actions.get(name); },
    sensorList() { return [...sensors.values()]; },
    actionList() { return [...actions.values()]; },
  };
  return reg;
}

// ---------------------------------------------------------------------------
// Validation. Every failure is a structured error, never a throw.
// ---------------------------------------------------------------------------

const err = (ruleId, ruleIndex, path, code, message) => ({ ruleId, ruleIndex, path, code, message });

function checkValueType(sensor, value) {
  if (sensor.type === 'number') return isNum(value);
  if (sensor.type === 'boolean') return typeof value === 'boolean';
  if (sensor.type === 'enum') return typeof value === 'string' && (!sensor.options || sensor.options.includes(value));
  return true;
}

function checkCondition(c, i, registry, id, index, out, path) {
  if (!isObj(c)) { out.push(err(id, index, path, 'bad-condition', 'a condition must be an object')); return; }
  const sensor = registry.sensor_(c.sensor);
  if (!sensor) { out.push(err(id, index, `${path}.sensor`, 'unknown-sensor', `no sensor named "${c.sensor}"`)); return; }
  if (!OPS.includes(c.op)) { out.push(err(id, index, `${path}.op`, 'unknown-op', `no operator "${c.op}"`)); return; }

  if (c.op === 'for') {
    const v = c.value;
    if (!isObj(v)) { out.push(err(id, index, `${path}.value`, 'bad-value', 'a "for" condition needs { op, value, ticks }')); return; }
    if (!INNER_OPS.includes(v.op)) { out.push(err(id, index, `${path}.value.op`, 'unknown-op', `"for" cannot hold the operator "${v.op}"`)); return; }
    if (!isInt(v.ticks) || v.ticks < 1) out.push(err(id, index, `${path}.value.ticks`, 'bad-value', 'ticks must be a whole number of 1 or more'));
    checkCondition({ sensor: c.sensor, op: v.op, value: v.value }, i, registry, id, index, out, `${path}.value`);
    return;
  }
  if (NUMERIC_OPS.has(c.op) && sensor.type !== 'number') {
    out.push(err(id, index, `${path}.op`, 'type-mismatch', `"${c.op}" needs a number sensor, but ${sensor.name} is a ${sensor.type}`));
    return;
  }
  if (c.op === 'between') {
    if (!Array.isArray(c.value) || c.value.length !== 2 || !isNum(c.value[0]) || !isNum(c.value[1])) {
      out.push(err(id, index, `${path}.value`, 'bad-value', '"between" needs [low, high]'));
    } else if (c.value[0] > c.value[1]) {
      out.push(err(id, index, `${path}.value`, 'bad-value', '"between" needs low no greater than high'));
    }
    return;
  }
  if (c.op === 'changedBy') {
    if (!isNum(c.value)) out.push(err(id, index, `${path}.value`, 'bad-value', '"changedBy" needs a number'));
    return;
  }
  if (!checkValueType(sensor, c.value)) {
    out.push(err(id, index, `${path}.value`, 'type-mismatch', `${sensor.name} is a ${sensor.type}, so the value must be a ${sensor.type}`));
  }
}

function checkArgs(then, registry, id, index, out) {
  const action = registry.action_(then.action);
  if (!action) { out.push(err(id, index, 'then.action', 'unknown-action', `no action named "${then.action}"`)); return; }
  const args = isObj(then.args) ? then.args : {};
  const declared = new Set(action.args.map((a) => a.name));
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) out.push(err(id, index, `then.args.${key}`, 'unknown-arg', `${action.name} takes no argument called "${key}"`));
  }
  for (const spec of action.args) {
    const has = Object.prototype.hasOwnProperty.call(args, spec.name);
    if (!has) {
      if (spec.default === undefined) out.push(err(id, index, `then.args.${spec.name}`, 'missing-arg', `${action.name} needs "${spec.name}"`));
      continue;
    }
    const v = args[spec.name];
    // An argument may be taken from a sensor instead of typed in, so a card
    // can say "rally on whichever face is richest" without naming a face.
    if (isObj(v) && typeof v.sensor === 'string') {
      const s = registry.sensor_(v.sensor);
      if (!s) out.push(err(id, index, `then.args.${spec.name}.sensor`, 'unknown-sensor', `no sensor named "${v.sensor}"`));
      else if (spec.type && s.type !== spec.type) out.push(err(id, index, `then.args.${spec.name}`, 'type-mismatch', `${spec.name} is a ${spec.type}, ${v.sensor} reads a ${s.type}`));
      continue;
    }
    if (spec.type === 'number' && !isNum(v)) out.push(err(id, index, `then.args.${spec.name}`, 'bad-arg', `${spec.name} must be a number`));
    else if (spec.type === 'boolean' && typeof v !== 'boolean') out.push(err(id, index, `then.args.${spec.name}`, 'bad-arg', `${spec.name} must be true or false`));
    else if (spec.type === 'enum' && !(typeof v === 'string' && (!spec.options || spec.options.includes(v)))) out.push(err(id, index, `then.args.${spec.name}`, 'bad-arg', `${spec.name} must be one of ${(spec.options || []).join(', ')}`));
  }
}

// Check one raw card. Returns the list of errors; empty means it is usable.
export function validateRule(raw, registry, index = 0, seenIds = null) {
  const out = [];
  if (!isObj(raw)) return [err(null, index, '', 'not-an-object', 'a card must be an object')];
  const id = typeof raw.id === 'string' && raw.id.length ? raw.id : null;
  if (!id) out.push(err(null, index, 'id', 'bad-id', 'a card needs a non-empty string id'));
  if (seenIds && id) {
    if (seenIds.has(id)) out.push(err(id, index, 'id', 'duplicate-id', `two cards share the id "${id}"`));
    seenIds.add(id);
  }
  if (raw.name !== undefined && typeof raw.name !== 'string') out.push(err(id, index, 'name', 'bad-name', 'name must be text'));
  if (raw.priority !== undefined && !isNum(raw.priority)) out.push(err(id, index, 'priority', 'bad-priority', 'priority must be a number'));
  if (raw.cooldownTicks !== undefined && (!isInt(raw.cooldownTicks) || raw.cooldownTicks < 0)) out.push(err(id, index, 'cooldownTicks', 'bad-cooldown', 'cooldown must be a whole number of ticks, 0 or more'));
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') out.push(err(id, index, 'enabled', 'bad-enabled', 'enabled must be true or false'));
  if (raw.budget !== undefined && raw.budget !== null) {
    const b = raw.budget;
    if (!isObj(b) || !isInt(b.max) || b.max < 0 || !isInt(b.periodTicks) || b.periodTicks < 1) {
      out.push(err(id, index, 'budget', 'bad-budget', 'a budget is { max, periodTicks } with whole numbers and a period of 1 or more'));
    }
  }
  const when = raw.when === undefined ? [] : raw.when;
  if (!Array.isArray(when)) out.push(err(id, index, 'when', 'bad-when', 'when must be a list of conditions'));
  else when.forEach((c, i) => checkCondition(c, i, registry, id, index, out, `when[${i}]`));

  if (!isObj(raw.then)) out.push(err(id, index, 'then', 'bad-then', 'a card needs an action in "then"'));
  else checkArgs(raw.then, registry, id, index, out);
  return out;
}

// Fill in the defaults so the rest of the engine never tests for undefined.
function normalize(raw) {
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    when: Array.isArray(raw.when) ? raw.when.map((c) => ({ sensor: c.sensor, op: c.op, value: c.value })) : [],
    then: { action: raw.then && raw.then.action, args: (raw.then && isObj(raw.then.args)) ? { ...raw.then.args } : {} },
    priority: isNum(raw.priority) ? raw.priority : 100,
    cooldownTicks: isInt(raw.cooldownTicks) ? raw.cooldownTicks : 0,
    enabled: raw.enabled !== false,
    budget: isObj(raw.budget) ? { max: raw.budget.max, periodTicks: raw.budget.periodTicks } : null,
  };
}

const freshStats = () => ({ fired: 0, blockedCooldown: 0, blockedBudget: 0, blockedCondition: 0, blockedSlots: 0, errored: 0, lastFiredTick: null, lastReason: 'never evaluated' });

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

export function createEngine({ registry, rules = [], maxFiresPerTick = 1, tick = 0, errorLimit = 20 } = {}) {
  const state = {
    tick,
    maxFiresPerTick: Math.max(1, maxFiresPerTick | 0),
    rules: [],
    stats: new Map(),
    prev: new Map(),        // sensor name -> reading at the end of the last tick
    held: new Map(),        // "id#i" -> consecutive ticks the inner condition held
    fires: new Map(),       // id -> tick numbers of recent fires, for the budget window
    quarantine: new Map(),  // id -> { tick, message }
    errors: [],             // bounded log of sensor and action failures
  };

  // The evaluation order is fixed when the cards are installed: ascending
  // priority, ties broken on the id so two machines never disagree.
  let order = [];
  let byId = new Map();
  const reorder = () => {
    order = state.rules.slice().sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    byId = new Map(state.rules.map((r) => [r.id, r]));
  };
  const statsOf = (id) => { let s = state.stats.get(id); if (!s) { s = freshStats(); state.stats.set(id, s); } return s; };
  const note = (kind, id, message) => {
    state.errors.push({ tick: state.tick, kind, id, message: String(message) });
    if (state.errors.length > errorLimit) state.errors.shift();
  };

  // One reading per sensor per evaluation. A sensor that throws yields
  // undefined and every condition on it fails with a reason the player can
  // read; the sensor belongs to the game, so a game fault does not condemn
  // the player's card.
  function makeReader(ctx) {
    const cache = new Map();
    return (name) => {
      if (cache.has(name)) return cache.get(name);
      const s = registry.sensor_(name);
      let v;
      if (!s) v = { error: `no sensor named "${name}"` };
      else {
        try { v = { value: s.read(ctx) }; } catch (e) { v = { error: (e && e.message) || String(e) }; note('sensor', name, e); }
      }
      cache.set(name, v);
      return v;
    };
  }

  function compare(op, a, b) {
    switch (op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '==': return a === b;
      case '!=': return a !== b;
      case 'between': return a >= b[0] && a <= b[1];
      default: return false;
    }
  }

  // Evaluate one condition. Returns { pass, observed, note } where note is the
  // short phrase the composer prints beside the reading.
  function evalCondition(rule, c, i, read, held, commit) {
    const r = read(c.sensor);
    if (r.error) return { pass: false, observed: undefined, note: r.error, sensorError: true };
    const v = r.value;

    if (c.op === 'changedBy') {
      const had = state.prev.has(c.sensor);
      const delta = had ? v - state.prev.get(c.sensor) : 0;
      const target = c.value;
      const pass = target > 0 ? delta >= target : target < 0 ? delta <= target : delta !== 0;
      const sign = delta > 0 ? '+' : '';
      return { pass, observed: v, note: `changed ${sign}${round(delta)} since last tick` };
    }

    if (c.op === 'for') {
      const inner = c.value;
      const innerPass = inner.op === 'changedBy'
        ? evalCondition(rule, { sensor: c.sensor, op: 'changedBy', value: inner.value }, i, read, held, commit).pass
        : compare(inner.op, v, inner.value);
      const key = `${rule.id}#${i}`;
      const count = innerPass ? (held.get(key) || 0) + 1 : 0;
      held.set(key, count);
      return { pass: count >= inner.ticks, observed: v, note: `held ${count} of ${inner.ticks} ticks` };
    }

    return { pass: compare(c.op, v, c.value), observed: v, note: '' };
  }

  const round = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
  const show = (v) => (typeof v === 'number' ? round(v) : String(v));
  const showValue = (c) => (c.op === 'between' ? `${c.value[0]} to ${c.value[1]}` : c.op === 'for' ? `${c.value.op} ${show(c.value.value)} for ${c.value.ticks} ticks` : show(c.value));

  // Resolve an action's arguments, substituting any that read from a sensor.
  function resolveArgs(rule, read) {
    const spec = registry.action_(rule.then.action);
    const outArgs = {};
    for (const a of (spec ? spec.args : [])) {
      let v = Object.prototype.hasOwnProperty.call(rule.then.args, a.name) ? rule.then.args[a.name] : a.default;
      if (isObj(v) && typeof v.sensor === 'string') {
        const r = read(v.sensor);
        v = r.error ? a.default : r.value;
      }
      outArgs[a.name] = v;
    }
    return outArgs;
  }

  // The one evaluation path. commit=false is a dry run: nothing fires, no
  // counter moves, and the "for" hold counters are worked on a copy.
  function evaluate(ctx, commit) {
    const read = makeReader(ctx);
    const held = commit ? state.held : new Map(state.held);
    const rows = [];

    for (const rule of order) {
      const q = state.quarantine.get(rule.id);
      if (q) {
        rows.push({ id: rule.id, name: rule.name, priority: rule.priority, enabled: rule.enabled, quarantined: true, conditions: [], wouldFire: false, candidate: false, block: 'quarantined', reason: `quarantined: ${q.message}`, firstFailure: null });
        continue;
      }
      const conditions = rule.when.map((c, i) => {
        const e = evalCondition(rule, c, i, read, held, commit);
        return { sensor: c.sensor, op: c.op, value: c.value, valueText: showValue(c), observed: e.observed, observedText: e.observed === undefined ? 'unreadable' : show(e.observed), note: e.note, pass: e.pass };
      });
      const failed = conditions.findIndex((c) => !c.pass);
      const row = { id: rule.id, name: rule.name, priority: rule.priority, enabled: rule.enabled, quarantined: false, conditions, wouldFire: false, candidate: false, block: null, reason: '', firstFailure: failed < 0 ? null : { index: failed, ...conditions[failed] } };

      if (!rule.enabled) { row.block = 'disabled'; row.reason = 'switched off'; }
      else if (failed >= 0) {
        const f = conditions[failed];
        row.block = 'condition';
        row.reason = f.observed === undefined ? `${f.sensor} could not be read: ${f.note}` : `${f.sensor} is ${f.observedText}, needs ${f.op} ${f.valueText}${f.note ? ` (${f.note})` : ''}`;
      } else {
        const s = statsOf(rule.id);
        const since = s.lastFiredTick === null ? Infinity : state.tick - s.lastFiredTick;
        const spent = spentInWindow(rule);
        if (since < rule.cooldownTicks) { row.block = 'cooldown'; row.reason = `cooling down, ${rule.cooldownTicks - since} ticks left`; }
        else if (rule.budget && spent >= rule.budget.max) { row.block = 'budget'; row.reason = `budget spent, ${spent} of ${rule.budget.max} in the last ${rule.budget.periodTicks} ticks`; }
        else { row.candidate = true; row.reason = 'ready'; }
      }
      rows.push(row);
    }
    return { rows, read };
  }

  // Hand the fire slots out in evaluation order. Kept apart from the
  // condition work so tick() can withhold a slot from a card whose action
  // threw and give it to the next card in line.
  const noSlot = () => `no slot left this tick (${state.maxFiresPerTick} per tick)`;
  function applySlots(rows) {
    let slots = state.maxFiresPerTick;
    for (const row of rows) {
      if (!row.candidate) continue;
      if (slots > 0) { row.wouldFire = true; slots--; }
      else { row.block = 'slots'; row.reason = noSlot(); }
    }
    return rows;
  }

  function spentInWindow(rule) {
    if (!rule.budget) return 0;
    const log = state.fires.get(rule.id);
    if (!log) return 0;
    const from = state.tick - rule.budget.periodTicks + 1;
    let n = 0;
    for (const t of log) if (t >= from) n++;
    return n;
  }

  const engine = {
    get tickIndex() { return state.tick; },
    get maxFiresPerTick() { return state.maxFiresPerTick; },
    get errors() { return state.errors.slice(); },
    lastExplain: [],

    setMaxFires(n) { state.maxFiresPerTick = Math.max(1, n | 0); return engine; },

    // Check a card set without installing it.
    validate(list) {
      const errors = [];
      const seen = new Set();
      const arr = Array.isArray(list) ? list : [];
      if (!Array.isArray(list)) errors.push(err(null, 0, '', 'not-a-list', 'a card set must be a list'));
      arr.forEach((raw, i) => errors.push(...validateRule(raw, registry, i, seen)));
      return { ok: errors.length === 0, errors };
    },

    // Install a card set. By default a card that fails its check is still
    // installed, quarantined, so the player can see and repair it in the
    // composer; strict mode installs nothing unless every card is sound.
    setRules(list, { strict = false } = {}) {
      const { ok, errors } = engine.validate(list);
      if (strict && !ok) return { ok: false, errors };
      const arr = Array.isArray(list) ? list : [];
      const byIndex = new Map();
      for (const e of errors) if (!byIndex.has(e.ruleIndex)) byIndex.set(e.ruleIndex, e);
      const next = [];
      const keep = new Set();
      arr.forEach((raw, i) => {
        const bad = byIndex.get(i);
        const id = (isObj(raw) && typeof raw.id === 'string' && raw.id.length) ? raw.id : `unnamed-${i}`;
        if (keep.has(id)) return;
        keep.add(id);
        const rule = normalize(isObj(raw) ? { ...raw, id } : { id, then: { action: null } });
        next.push(rule);
        if (bad) state.quarantine.set(id, { tick: state.tick, message: `${bad.path || 'card'}: ${bad.message}` });
        else state.quarantine.delete(id);
      });
      state.rules = next;
      reorder();
      for (const id of [...state.stats.keys()]) if (!keep.has(id)) state.stats.delete(id);
      for (const id of [...state.quarantine.keys()]) if (!keep.has(id)) state.quarantine.delete(id);
      for (const id of [...state.fires.keys()]) if (!keep.has(id)) state.fires.delete(id);
      for (const id of next) statsOf(id.id);
      return { ok, errors };
    },

    getRules() { return state.rules.map((r) => JSON.parse(JSON.stringify(r))); },
    getRule(id) { const r = byId.get(id); return r ? JSON.parse(JSON.stringify(r)) : null; },
    setEnabled(id, on) { const r = byId.get(id); if (r) r.enabled = !!on; return engine; },
    statsFor(id) { return { ...statsOf(id), quarantined: state.quarantine.get(id) || null }; },
    quarantineOf(id) { return state.quarantine.get(id) || null; },

    // Let a repaired card back in.
    release(id) { state.quarantine.delete(id); return engine; },

    // Advance one fixed step: read, decide, act.
    tick(ctx) {
      const { rows, read } = evaluate(ctx, true);
      const fired = [];
      let slots = state.maxFiresPerTick;
      for (const row of rows) {
        const rule = byId.get(row.id);
        const s = statsOf(row.id);
        s.lastReason = row.reason;
        if (row.quarantined || !rule) continue;
        if (row.block === 'disabled') continue;
        if (row.block === 'condition') { s.blockedCondition++; continue; }
        if (row.block === 'cooldown') { s.blockedCooldown++; continue; }
        if (row.block === 'budget') { s.blockedBudget++; continue; }
        if (slots <= 0) { row.block = 'slots'; row.reason = noSlot(); s.blockedSlots++; s.lastReason = row.reason; continue; }

        const action = registry.action_(rule.then.action);
        const args = resolveArgs(rule, read);
        try {
          action.run(ctx, args, { rule: row.id, tick: state.tick });
        } catch (e) {
          // A card whose action throws is taken out of service with the
          // message kept, and it does not consume its slot: a broken card
          // must not cost a healthy one its turn.
          s.errored++;
          s.lastReason = `action failed: ${(e && e.message) || e}`;
          state.quarantine.set(rule.id, { tick: state.tick, message: `action failed: ${(e && e.message) || e}` });
          note('action', rule.id, e);
          row.wouldFire = false;
          row.block = 'error';
          row.reason = s.lastReason;
          continue;
        }
        slots--;
        row.wouldFire = true;
        s.fired++;
        s.lastFiredTick = state.tick;
        if (rule.budget) {
          let log = state.fires.get(rule.id);
          if (!log) { log = []; state.fires.set(rule.id, log); }
          log.push(state.tick);
          const from = state.tick - rule.budget.periodTicks + 1;
          while (log.length && log[0] < from) log.shift();
        }
        fired.push({ id: rule.id, action: rule.then.action, args });
      }

      // Remember this tick's readings so changedBy has something to subtract.
      for (const rule of state.rules) for (const c of rule.when) {
        const r = read(c.sensor);
        if (!r.error) state.prev.set(c.sensor, r.value);
      }
      const result = { tick: state.tick, fired, explain: rows };
      engine.lastExplain = rows;
      state.tick++;
      return result;
    },

    // A dry run at the current tick: what would happen, and for a card that
    // would not fire, which condition failed and what the reading was.
    explain(ctx) { return applySlots(evaluate(ctx, false).rows); },

    reset({ tick: t = 0 } = {}) {
      state.tick = t;
      state.stats.clear(); state.prev.clear(); state.held.clear(); state.fires.clear(); state.quarantine.clear();
      state.errors.length = 0;
      for (const r of state.rules) statsOf(r.id);
      return engine;
    },

    toJSON() {
      return {
        v: RULES_SCHEMA,
        tick: state.tick,
        maxFiresPerTick: state.maxFiresPerTick,
        rules: engine.getRules(),
        state: {
          prev: Object.fromEntries(state.prev),
          held: Object.fromEntries(state.held),
          fires: Object.fromEntries([...state.fires].map(([k, v]) => [k, v.slice()])),
          quarantine: Object.fromEntries(state.quarantine),
          stats: Object.fromEntries([...state.stats].map(([k, v]) => [k, { ...v }])),
        },
      };
    },

    loadJSON(json) {
      if (!isObj(json)) return { ok: false, errors: [err(null, 0, '', 'not-an-object', 'a saved card set must be an object')] };
      if (json.v !== RULES_SCHEMA) return { ok: false, errors: [err(null, 0, 'v', 'bad-version', `saved cards are version ${json.v}, this game reads version ${RULES_SCHEMA}`)] };
      const res = engine.setRules(json.rules || []);
      state.tick = isInt(json.tick) ? json.tick : 0;
      state.maxFiresPerTick = Math.max(1, (json.maxFiresPerTick | 0) || 1);
      const st = isObj(json.state) ? json.state : {};
      state.prev = new Map(Object.entries(st.prev || {}));
      state.held = new Map(Object.entries(st.held || {}));
      state.fires = new Map(Object.entries(st.fires || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : []]));
      for (const [k, v] of Object.entries(st.quarantine || {})) state.quarantine.set(k, v);
      for (const [k, v] of Object.entries(st.stats || {})) state.stats.set(k, { ...freshStats(), ...v });
      return res;
    },
  };

  engine.setRules(rules);
  return engine;
}

// Rebuild an engine straight from a save.
export function fromJSON(json, registry) {
  const e = createEngine({ registry });
  const res = e.loadJSON(json);
  return { engine: e, ...res };
}

export default createEngine;
