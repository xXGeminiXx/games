// Vendored from the game-art foundation (lib/rules-ui.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// The composer - the DOM half of the rules layer.
//
// It builds one card per rule out of plain elements: selects for the sensor,
// the operator and the action, inputs for the numbers, buttons for add, copy,
// delete and reorder. No drag is required for anything, every control is a
// real focusable element, and Alt with the arrow keys moves the focused card,
// so the whole thing works from the keyboard alone.
//
// It emits STRUCTURE only. Every element carries a class that says what it is
// (rule-card, rule-when, rule-cond, rule-then, rule-why) and nothing that says
// what it looks like: colour, type and spacing belong to the game that adopts
// it. The page must give :focus-visible a ring of its own - the composer will
// not draw one, because a focus ring is part of a game's look.
//
// The card also shows what the machine is thinking. refresh() takes the rows
// from the engine's explain() and writes, on each card, how many times it has
// fired, how often it was held back and by what, and one sentence saying why
// it is not firing right now with the reading that failed. Automation that
// cannot be interrogated reads as broken.
//
// One styling note the page must honour: the data panel is hidden with the
// `hidden` property, and an author rule such as `.rule-io { display: grid }`
// beats the browser's own `[hidden] { display: none }`. Pair any display rule
// on these classes with a `[hidden]` rule of your own.
//
// Structure classes, in the order they nest:
//   rules > rules-bar, rule-list > rule-card > rule-head, rule-when >
//   rule-cond, rule-then, rule-limits, rule-stats, rule-why, rule-tools
//   and rule-io > rule-io-text, rule-io-errors
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const COMPARE = ['<', '<=', '>', '>=', '==', '!='];

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'hidden') el.hidden = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of [].concat(kids)) if (kid) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return el;
}

const option = (value, label, selected) => h('option', { value, text: label, selected: selected ? true : null });

function select(cls, values, labels, current, onchange, aria) {
  const s = h('select', { class: cls, 'aria-label': aria || cls, onchange });
  values.forEach((v, i) => s.appendChild(option(v, labels[i], v === current)));
  return s;
}

function numberInput(cls, value, onchange, spec = {}, aria) {
  return h('input', {
    class: cls, type: 'number', value: String(value), inputmode: 'decimal', 'aria-label': aria || cls,
    min: spec.min, max: spec.max, step: spec.step === undefined ? 'any' : spec.step,
    oninput: (e) => onchange(e.target.value === '' ? 0 : Number(e.target.value)),
  });
}

// createComposer({ engine, registry, mount, onChange })
//   engine    a rules engine; the composer installs every edit into it
//   registry  the same registry the engine uses, for the pick lists
//   mount     an element to append to (optional; .el is always returned)
//   onChange  called with the new card list after every edit, for the save
export function createComposer({ engine, registry, mount, onChange = () => {} }) {
  const sensors = registry.sensorList();
  const actions = registry.actionList();
  const sensorNames = sensors.map((s) => s.name);
  const sensorLabels = sensors.map((s) => s.label);
  const actionNames = actions.map((a) => a.name);
  const actionLabels = actions.map((a) => a.label);
  const sensorOf = (n) => registry.sensor_(n) || sensors[0];
  const cards = new Map(); // id -> { el, parts }
  let list = engine.getRules();

  const listEl = h('div', { class: 'rule-list' });
  const ioText = h('textarea', { class: 'rule-io-text', spellcheck: 'false', rows: '6', 'aria-label': 'all cards as data' });
  const ioErrors = h('ul', { class: 'rule-io-errors' });
  const ioEl = h('div', { class: 'rule-io', hidden: true }, [
    h('p', { class: 'rule-io-note', text: 'All cards are data. Copy this out, paste one in.' }),
    ioText,
    h('div', { class: 'rule-io-tools' }, [
      h('button', { class: 'rule-io-export', type: 'button', text: 'Export', onclick: doExport }),
      h('button', { class: 'rule-io-import', type: 'button', text: 'Import', onclick: doImport }),
    ]),
    ioErrors,
  ]);

  const fires = numberInput('rules-fires', engine.maxFiresPerTick, (v) => { engine.setMaxFires(v); }, { min: 1, max: 8, step: 1 }, 'cards allowed to fire each tick');
  const barEl = h('div', { class: 'rules-bar' }, [
    h('button', { class: 'rules-add', type: 'button', text: 'Add card', onclick: () => addCard() }),
    h('label', { class: 'rules-fires-label' }, [h('span', { text: 'fire per tick' }), fires]),
    h('button', { class: 'rules-data', type: 'button', text: 'Data', 'aria-expanded': 'false', onclick: toggleData }),
  ]);

  const el = h('div', { class: 'rules' }, [barEl, listEl, ioEl]);
  if (mount) mount.appendChild(el);

  // -- edits -----------------------------------------------------------------

  // Install the working list and tell the game. Structural edits rebuild the
  // cards and put focus back where it was; value edits leave the DOM alone so
  // typing is never interrupted.
  function commit(rebuild) {
    const res = engine.setRules(list);
    list = engine.getRules();
    onChange(engine.getRules(), res);
    if (rebuild) redraw();
    return res;
  }

  function redraw() {
    const active = document.activeElement;
    const key = active && el.contains(active) ? active.getAttribute('data-key') : null;
    cards.clear();
    listEl.textContent = '';
    for (const rule of sorted()) listEl.appendChild(buildCard(rule));
    if (key) {
      const again = listEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (again) again.focus();
    }
  }

  const sorted = () => list.slice().sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : 1));
  const find = (id) => list.find((r) => r.id === id);

  function newId() {
    let n = list.length + 1;
    while (list.some((r) => r.id === `card-${n}`)) n++;
    return `card-${n}`;
  }

  function addCard(from) {
    const s = sensors[0];
    const a = actions[0];
    const rule = from ? JSON.parse(JSON.stringify(from)) : {
      id: '', name: 'New card',
      when: [{ sensor: s.name, op: s.type === 'number' ? '>' : '==', value: defaultValue(s) }],
      then: { action: a.name, args: defaultArgs(a) },
      priority: 100, cooldownTicks: 0, enabled: true, budget: null,
    };
    rule.id = newId();
    if (from) rule.name = `${from.name} copy`;
    rule.priority = (from ? from.priority : Math.max(0, ...list.map((r) => r.priority))) + 1;
    list.push(rule);
    commit(true);
    const card = cards.get(rule.id);
    if (card) card.el.querySelector('.rule-name').focus();
  }

  function defaultValue(s) {
    if (s.type === 'boolean') return true;
    if (s.type === 'enum') return (s.options || [''])[0];
    return Math.round(((s.min || 0) + (s.max === undefined ? 1 : s.max)) / 2 * 100) / 100;
  }
  function defaultArgs(a) {
    const args = {};
    for (const spec of a.args) args[spec.name] = spec.default !== undefined ? spec.default : spec.type === 'enum' ? (spec.options || [''])[0] : spec.type === 'boolean' ? false : 0;
    return args;
  }

  function move(id, dir) {
    const order = sorted();
    const i = order.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const a = find(order[i].id), b = find(order[j].id);
    const pa = a.priority, pb = b.priority;
    a.priority = pa === pb ? pb + dir : pb;
    b.priority = pa === pb ? pa : pa;
    commit(true);
    const card = cards.get(id);
    if (card) card.el.querySelector(dir < 0 ? '.rule-up' : '.rule-down').focus();
  }

  function remove(id) {
    list = list.filter((r) => r.id !== id);
    commit(true);
  }

  // -- one card --------------------------------------------------------------

  function buildCard(rule) {
    const keyed = (node, name) => { node.setAttribute('data-key', `${rule.id}/${name}`); return node; };

    const nameEl = keyed(h('input', {
      class: 'rule-name', value: rule.name, 'aria-label': 'card name',
      oninput: (e) => { find(rule.id).name = e.target.value; commit(false); },
    }), 'name');

    const enabledEl = keyed(h('input', {
      class: 'rule-enabled', type: 'checkbox', checked: rule.enabled, 'aria-label': `${rule.name} switched on`,
      onchange: (e) => { find(rule.id).enabled = e.target.checked; commit(false); card.el.classList.toggle('is-off', !e.target.checked); },
    }), 'enabled');

    const whenEl = h('div', { class: 'rule-when' }, [
      h('div', { class: 'rule-when-head' }, [
        h('span', { class: 'rule-when-label', text: 'when' }),
        keyed(h('button', {
          class: 'rule-cond-add', type: 'button', text: '+ condition', 'aria-label': `add a condition to ${rule.name}`,
          onclick: () => { const s = sensors[0]; find(rule.id).when.push({ sensor: s.name, op: s.type === 'number' ? '>' : '==', value: defaultValue(s) }); commit(true); },
        }), 'cond-add'),
      ]),
    ]);
    rule.when.forEach((c, i) => whenEl.appendChild(buildCondition(rule, c, i, keyed)));

    const thenEl = h('div', { class: 'rule-then' }, [h('span', { class: 'rule-then-label', text: 'then' })]);
    const argsEl = h('span', { class: 'rule-args' });
    thenEl.appendChild(keyed(select('rule-action', actionNames, actionLabels, rule.then.action, (e) => {
      const r = find(rule.id);
      r.then = { action: e.target.value, args: defaultArgs(registry.action_(e.target.value)) };
      commit(true);
    }, 'action'), 'action'));
    thenEl.appendChild(argsEl);
    buildArgs(rule, argsEl, keyed);

    const budget = rule.budget || { max: 0, periodTicks: 0 };
    const limitsEl = h('div', { class: 'rule-limits' }, [
      h('label', {}, ['order', keyed(numberInput('rule-priority', rule.priority, (v) => { find(rule.id).priority = v; commit(false); }, { step: 1 }, 'evaluation order'), 'priority')]),
      h('label', {}, ['cooldown', keyed(numberInput('rule-cooldown', rule.cooldownTicks, (v) => { find(rule.id).cooldownTicks = Math.max(0, Math.round(v)); commit(false); }, { min: 0, step: 1 }, 'cooldown in ticks'), 'cooldown')]),
      h('label', {}, ['budget', keyed(numberInput('rule-budget-max', budget.max, (v) => setBudget(rule.id, Math.max(0, Math.round(v)), null), { min: 0, step: 1 }, 'budget, most fires'), 'budget-max')]),
      h('label', {}, ['per', keyed(numberInput('rule-budget-period', budget.periodTicks, (v) => setBudget(rule.id, null, Math.max(0, Math.round(v))), { min: 0, step: 1 }, 'budget period in ticks'), 'budget-period')]),
    ]);

    const statsEl = h('div', { class: 'rule-stats' });
    const whyEl = h('div', { class: 'rule-why', role: 'status' });

    const toolsEl = h('div', { class: 'rule-tools' }, [
      keyed(h('button', { class: 'rule-up', type: 'button', text: 'Up', 'aria-label': `move ${rule.name} earlier`, onclick: () => move(rule.id, -1) }), 'up'),
      keyed(h('button', { class: 'rule-down', type: 'button', text: 'Down', 'aria-label': `move ${rule.name} later`, onclick: () => move(rule.id, 1) }), 'down'),
      keyed(h('button', { class: 'rule-dup', type: 'button', text: 'Copy', 'aria-label': `copy ${rule.name}`, onclick: () => addCard(find(rule.id)) }), 'dup'),
      keyed(h('button', { class: 'rule-del', type: 'button', text: 'Delete', 'aria-label': `delete ${rule.name}`, onclick: () => remove(rule.id) }), 'del'),
      keyed(h('button', { class: 'rule-release', type: 'button', text: 'Repair', hidden: true, 'aria-label': `let ${rule.name} run again`, onclick: () => { engine.release(rule.id); commit(true); } }), 'release'),
    ]);

    const cardEl = h('div', {
      class: `rule-card${rule.enabled ? '' : ' is-off'}`, 'data-id': rule.id,
      onkeydown: (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        move(rule.id, e.key === 'ArrowUp' ? -1 : 1);
      },
    }, [
      h('div', { class: 'rule-head' }, [nameEl, h('label', { class: 'rule-on' }, [enabledEl, h('span', { text: 'on' })])]),
      whenEl, thenEl, limitsEl, statsEl, whyEl, toolsEl,
    ]);

    const card = { el: cardEl, statsEl, whyEl, releaseEl: toolsEl.querySelector('.rule-release') };
    cards.set(rule.id, card);
    return cardEl;
  }

  function setBudget(id, max, period) {
    const r = find(id);
    const b = r.budget || { max: 0, periodTicks: 0 };
    if (max !== null) b.max = max;
    if (period !== null) b.periodTicks = period;
    r.budget = (b.max > 0 && b.periodTicks > 0) ? b : null;
    commit(false);
  }

  function buildCondition(rule, c, i, keyed) {
    const row = h('div', { class: 'rule-cond', 'data-i': String(i) });
    const at = () => find(rule.id).when[i];

    row.appendChild(keyed(select('rule-sensor', sensorNames, sensorLabels, c.sensor, (e) => {
      const cond = at();
      cond.sensor = e.target.value;
      const s = sensorOf(cond.sensor);
      if (s.type !== 'number' && !['==', '!='].includes(cond.op)) cond.op = '==';
      cond.value = cond.op === 'between' ? [0, 1] : cond.op === 'for' ? { op: '>', value: defaultValue(s), ticks: 10 } : defaultValue(s);
      commit(true);
    }, 'reading'), `cond${i}-sensor`));

    const s = sensorOf(c.sensor);
    const ops = s.type === 'number' ? [...COMPARE, 'between', 'changedBy', 'for'] : ['==', '!=', 'for'];
    row.appendChild(keyed(select('rule-op', ops, ops.map(opLabel), c.op, (e) => {
      const cond = at();
      cond.op = e.target.value;
      cond.value = cond.op === 'between' ? [0, 1]
        : cond.op === 'changedBy' ? 1
          : cond.op === 'for' ? { op: s.type === 'number' ? '>' : '==', value: defaultValue(s), ticks: 10 }
            : defaultValue(s);
      commit(true);
    }, 'test'), `cond${i}-op`));

    const val = h('span', { class: 'rule-val' });
    buildValue(rule, val, c, i, keyed, s);
    row.appendChild(val);
    if (s.unit) row.appendChild(h('span', { class: 'rule-unit', text: s.unit }));

    row.appendChild(keyed(h('button', {
      class: 'rule-cond-del', type: 'button', text: 'x', 'aria-label': 'remove this condition',
      onclick: () => { find(rule.id).when.splice(i, 1); commit(true); },
    }), `cond${i}-del`));
    return row;
  }

  function opLabel(op) {
    return { '<': 'is below', '<=': 'is at most', '>': 'is above', '>=': 'is at least', '==': 'is', "!=": "isn't", between: 'is between', changedBy: 'changed by', for: 'has held' }[op] || op;
  }

  // The value editor depends on the operator: one box, two for a range, an
  // inner test plus a tick count for "has held".
  function buildValue(rule, host, c, i, keyed, s) {
    const at = () => find(rule.id).when[i];
    const put = (v) => { at().value = v; commit(false); };

    if (c.op === 'between') {
      const lo = Array.isArray(c.value) ? c.value[0] : 0, hi = Array.isArray(c.value) ? c.value[1] : 1;
      host.appendChild(keyed(numberInput('rule-value rule-value-lo', lo, (v) => put([v, at().value[1]]), s, 'low end'), `cond${i}-lo`));
      host.appendChild(h('span', { class: 'rule-and', text: 'and' }));
      host.appendChild(keyed(numberInput('rule-value rule-value-hi', hi, (v) => put([at().value[0], v]), s, 'high end'), `cond${i}-hi`));
      return;
    }
    if (c.op === 'for') {
      const inner = isObj(c.value) ? c.value : { op: '>', value: 0, ticks: 10 };
      const innerOps = s.type === 'number' ? [...COMPARE, 'changedBy'] : ['==', '!='];
      host.appendChild(keyed(select('rule-inner-op', innerOps, innerOps.map(opLabel), inner.op, (e) => { at().value = { ...at().value, op: e.target.value }; commit(true); }, 'inner test'), `cond${i}-inner-op`));
      host.appendChild(scalarEditor(s, inner.value, (v) => { at().value = { ...at().value, value: v }; commit(false); }, keyed, `cond${i}-inner-val`, inner.op === 'changedBy'));
      host.appendChild(h('span', { class: 'rule-for', text: 'for' }));
      host.appendChild(keyed(numberInput('rule-ticks', inner.ticks, (v) => { at().value = { ...at().value, ticks: Math.max(1, Math.round(v)) }; commit(false); }, { min: 1, step: 1 }, 'how many ticks'), `cond${i}-ticks`));
      host.appendChild(h('span', { class: 'rule-for', text: 'ticks' }));
      return;
    }
    host.appendChild(scalarEditor(s, c.value, put, keyed, `cond${i}-value`, c.op === 'changedBy'));
  }

  function scalarEditor(s, value, put, keyed, key, forceNumber) {
    if (!forceNumber && s.type === 'boolean') return keyed(select('rule-value', ['true', 'false'], ['true', 'false'], String(!!value), (e) => put(e.target.value === 'true'), 'value'), key);
    if (!forceNumber && s.type === 'enum') {
      const opts = s.options || [];
      return keyed(select('rule-value', opts, opts, String(value), (e) => put(e.target.value), 'value'), key);
    }
    return keyed(numberInput('rule-value', typeof value === 'number' ? value : 0, put, forceNumber ? {} : s, 'value'), key);
  }

  // An action argument is a typed box, and for a list-valued argument it can
  // also be pointed at a reading, so a card can say "go where it is richest"
  // without naming the place.
  function buildArgs(rule, host, keyed) {
    const spec = registry.action_(rule.then.action);
    if (!spec) return;
    for (const a of spec.args) {
      const cur = rule.then.args[a.name];
      const put = (v) => { find(rule.id).then.args[a.name] = v; commit(false); };
      host.appendChild(h('span', { class: 'rule-arg-label', text: a.label || a.name }));
      if (a.type === 'enum') {
        const feeds = sensors.filter((s) => s.type === 'enum');
        const values = [...(a.options || []), ...feeds.map((s) => `@${s.name}`)];
        const labels = [...(a.options || []), ...feeds.map((s) => `from ${s.label}`)];
        const current = isObj(cur) && cur.sensor ? `@${cur.sensor}` : String(cur);
        host.appendChild(keyed(select('rule-arg', values, labels, current, (e) => {
          const v = e.target.value;
          put(v.startsWith('@') ? { sensor: v.slice(1) } : v);
        }, a.label || a.name), `arg-${a.name}`));
      } else if (a.type === 'boolean') {
        host.appendChild(keyed(select('rule-arg', ['true', 'false'], ['true', 'false'], String(!!cur), (e) => put(e.target.value === 'true'), a.label || a.name), `arg-${a.name}`));
      } else {
        host.appendChild(keyed(numberInput('rule-arg', typeof cur === 'number' ? cur : 0, put, a, a.label || a.name), `arg-${a.name}`));
      }
    }
  }

  // -- live readout ----------------------------------------------------------

  const pct = (n, total) => (total ? ` (${Math.round((n / total) * 100)}%)` : '');

  // rows come from engine.explain() or the last tick's explanation; firedIds
  // marks the cards that acted on this tick so the page can flash them.
  function refresh(rows, firedIds = []) {
    const fired = new Set(firedIds);
    for (const row of rows || []) {
      const card = cards.get(row.id);
      if (!card) continue;
      const s = engine.statsFor(row.id);
      const held = s.blockedCooldown + s.blockedBudget + s.blockedSlots;
      card.statsEl.textContent = `fired ${s.fired} | held ${held}${pct(held, s.fired + held)} | cooldown ${s.blockedCooldown} | budget ${s.blockedBudget} | last ${s.lastFiredTick === null ? 'never' : `tick ${s.lastFiredTick}`}`;
      card.whyEl.textContent = row.reason;
      card.el.classList.toggle('is-ready', !!row.wouldFire);
      card.el.classList.toggle('is-quarantined', !!row.quarantined);
      card.el.classList.toggle('is-firing', fired.has(row.id));
      card.el.setAttribute('data-block', row.block || (row.wouldFire ? 'ready' : ''));
      if (card.releaseEl) card.releaseEl.hidden = !row.quarantined;
    }
  }

  // -- export and import -----------------------------------------------------

  function toggleData() {
    const showing = ioEl.hidden;
    ioEl.hidden = !showing;
    barEl.querySelector('.rules-data').setAttribute('aria-expanded', String(showing));
    if (showing) { doExport(); ioText.focus(); }
  }

  function doExport() {
    ioText.value = JSON.stringify(engine.getRules(), null, 1);
    ioErrors.textContent = '';
  }

  function doImport() {
    ioErrors.textContent = '';
    let parsed;
    try { parsed = JSON.parse(ioText.value); } catch (e) {
      ioErrors.appendChild(h('li', { text: `that isn't valid data: ${e.message}` }));
      return;
    }
    const incoming = Array.isArray(parsed) ? parsed : (parsed && parsed.rules);
    const check = engine.validate(incoming || []);
    for (const e of check.errors) ioErrors.appendChild(h('li', { text: `${e.ruleId || `card ${e.ruleIndex + 1}`}: ${e.path ? `${e.path} ` : ''}${e.message}` }));
    if (!check.ok) return;
    list = (incoming || []).map((r) => JSON.parse(JSON.stringify(r)));
    commit(true);
    ioErrors.appendChild(h('li', { class: 'rule-io-ok', text: `loaded ${list.length} cards` }));
  }

  redraw();

  return {
    el,
    refresh,
    // Re-read the engine, for when the game changed the cards itself.
    sync() { list = engine.getRules(); redraw(); },
    destroy() { cards.clear(); el.remove(); },
  };
}

export default createComposer;
