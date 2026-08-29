// ---------------------------------------------------------------------------
// The keyboard.
//
// One table in config names every key the page listens to, and this is the
// only thing that reads it, so there is exactly one place a collision could
// hide. Held keys fly the carrier and move the camera every frame; tapped
// keys press a button once.
//
// Flying is relative to the view: forward is away from the camera whichever
// way it has been turned, which is what a player means by "forward" when the
// camera is the only thing telling them which way is which. It pushes the
// carrier's anchor rather than the camera, so the ship is never lost off
// screen, and it uses the same glide the click-to-anchor path uses.
//
// Nothing here touches the DOM until attach() is called, so the intent and
// the step can be driven directly by a test.
// ---------------------------------------------------------------------------

// A key event is ours only if a text box does not have it and no modifier is
// held, so typing into the save box and the browser's own shortcuts survive.
export function isOurs(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const t = e.target;
  const tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (t && t.isContentEditable) return false;
  return true;
}

export function normalise(key) {
  return String(key || '').length === 1 ? String(key).toLowerCase() : String(key || '').toLowerCase();
}

export function createControls(cfg, { fly, camera, actions, panel, help }) {
  const C = cfg.controls;
  const held = new Set();
  // The actions that mean something only while the key is down; everything
  // else fires once on the press.
  const HELD = new Set(['forward', 'back', 'left', 'right', 'orbitLeft', 'orbitRight', 'pitchUp', 'pitchDown', 'zoomIn', 'zoomOut']);

  // key -> action name, built once from the table so a duplicate is loud
  const map = new Map();
  const duplicates = [];
  for (const action in cfg.keys) {
    for (const k of cfg.keys[action]) {
      const key = normalise(k);
      if (map.has(key)) duplicates.push(`${key}: ${map.get(key)} and ${action}`);
      else map.set(key, action);
    }
  }

  const down = (action) => {
    for (const [k, a] of map) if (a === action && held.has(k)) return true;
    return false;
  };
  const axis = (neg, pos) => (down(pos) ? 1 : 0) - (down(neg) ? 1 : 0);

  // What the held keys are asking for this frame: [strafe, advance, orbit,
  // pitch, zoom], each in -1..1.
  const intent = () => [axis('left', 'right'), axis('back', 'forward'), axis('orbitLeft', 'orbitRight'), axis('pitchDown', 'pitchUp'), axis('zoomOut', 'zoomIn')];

  // Advance the carrier and the camera by dt seconds. Returns true if the
  // player asked for anything, which is what stops the idle drift.
  const step = (dt, input = null) => {
    const [ix, iz, io, ip, iq] = input || intent();
    if (io) camera.orbit(io * C.orbitSpeed * dt);
    if (ip) camera.pitchBy(ip * C.pitchSpeed * dt);
    if (iq) camera.zoomBy(-iq * C.zoomSpeed * dt);
    if (ix || iz) {
      // the camera's forward and right, flattened onto the water
      const { forward, right } = camera.basis();
      const f = flatten(forward), r = flatten(right);
      const d = C.flySpeed * dt;
      fly(( r[0] * ix + f[0] * iz) * d, (r[1] * ix + f[1] * iz) * d);
    }
    return !!(ix || iz || io || ip || iq);
  };

  const onKey = (key) => {
    const action = map.get(normalise(key));
    if (!action) return false;
    if (action in actions) { actions[action](); return true; }
    if (action === 'panel') { panel(); return true; }
    if (action === 'help') { help(); return true; }
    return HELD.has(action);
  };

  const attach = (target) => {
    const kd = (e) => {
      if (!isOurs(e)) return;
      const key = normalise(e.key);
      if (!map.has(key)) return;
      const action = map.get(key);
      if (HELD.has(action)) { held.add(key); e.preventDefault(); return; }
      if (e.repeat) return;
      if (onKey(e.key)) e.preventDefault();
    };
    const ku = (e) => { held.delete(normalise(e.key)); };
    const clear = () => held.clear();
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    target.addEventListener('blur', clear);
    return () => {
      target.removeEventListener('keydown', kd);
      target.removeEventListener('keyup', ku);
      target.removeEventListener('blur', clear);
    };
  };

  return { map, duplicates, held, intent, step, attach, onKey, HELD };
}

// Project a direction onto the water and make it a unit heading.
function flatten(v) {
  const x = v[0], z = v[2];
  const l = Math.hypot(x, z);
  return l < 1e-5 ? [0, 1] : [x / l, z / l];
}
