// ---------------------------------------------------------------------------
// Cameras.
//
// fly: a free camera with yaw and pitch, driven by WASD/arrows, mouse drag or
// touch, with velocity easing so motion feels like flight rather than a
// cursor. orbit: the camera circles a point, for looking at a thing.
//
// Both expose the same three things a renderer needs: position, a basis
// (forward, right, up) for a raymarcher, and view / projection matrices for
// rasterisation. Nothing here touches the DOM until attach() is called, so
// a headless test can drive a camera by calling move() directly.
// ---------------------------------------------------------------------------

import { m4, v3, clamp } from './mat.js?v=4';

export function flyCamera({ position = [0, 2, 5], yaw = 0, pitch = 0, fov = 60, near = 0.05, far = 500, speed = 6, sensitivity = 0.0025, damping = 8 } = {}) {
  const cam = {
    position: [...position], yaw, pitch, fov, near, far, speed, sensitivity,
    velocity: [0, 0, 0],
    keys: new Set(),
    view: new Float32Array(16),
    projection: new Float32Array(16),
  };

  const basis = () => {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const forward = [sy * cp, sp, -cy * cp];
    const right = [cy, 0, sy];
    const up = v3.cross(right, forward);
    return { forward, right, up };
  };

  // Intent from keys: [strafe, rise, advance] in -1..1.
  const intent = () => {
    const k = cam.keys;
    const x = (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('w') || k.has('ArrowUp') ? 1 : 0) - (k.has('s') || k.has('ArrowDown') ? 1 : 0);
    const y = (k.has('e') || k.has(' ') ? 1 : 0) - (k.has('q') || k.has('Shift') ? 1 : 0);
    return [x, y, z];
  };

  // Advance by dt seconds. `input` overrides the keyboard intent, for tests
  // and for touch sticks: [strafe, rise, advance].
  const move = (dt, input = null) => {
    const [ix, iy, iz] = input || intent();
    const { forward, right } = basis();
    const boost = cam.keys.has('Control') ? 3 : 1;
    const want = v3.scale(v3.add(v3.add(v3.scale(forward, iz), v3.scale(right, ix)), [0, iy, 0]), cam.speed * boost);
    const k = 1 - Math.exp(-damping * dt);
    cam.velocity = v3.lerp(cam.velocity, want, k);
    cam.position = v3.add(cam.position, v3.scale(cam.velocity, dt));
  };

  const look = (dx, dy) => {
    cam.yaw += dx * cam.sensitivity;
    cam.pitch = clamp(cam.pitch - dy * cam.sensitivity, -1.5, 1.5);
  };

  const matrices = (aspect) => {
    const { forward } = basis();
    m4.lookAt(cam.position, v3.add(cam.position, forward), [0, 1, 0], cam.view);
    m4.perspective((cam.fov * Math.PI) / 180, aspect, cam.near, cam.far, cam.projection);
    return { view: cam.view, projection: cam.projection };
  };

  // Wire up keyboard, pointer drag and touch. Returns a detach function.
  const attach = (el) => {
    let dragging = false, lx = 0, ly = 0;
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture?.(e.pointerId); };
    const up = () => { dragging = false; };
    const mv = (e) => {
      if (!dragging) return;
      look(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    };
    const kd = (e) => { cam.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault(); };
    const ku = (e) => { cam.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); };
    const blur = () => cam.keys.clear();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    el.style.touchAction = 'none';
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  };

  return Object.assign(cam, { basis, move, look, matrices, attach });
}

// A camera that orbits a target. Drag to rotate, wheel to zoom.
export function orbitCamera({ target = [0, 0, 0], distance = 10, yaw = 0.6, pitch = 0.4, fov = 50, near = 0.05, far = 500 } = {}) {
  const cam = { target: [...target], distance, yaw, pitch, fov, near, far, view: new Float32Array(16), projection: new Float32Array(16) };

  const position = () => {
    const cp = Math.cos(cam.pitch);
    return v3.add(cam.target, [Math.sin(cam.yaw) * cp * cam.distance, Math.sin(cam.pitch) * cam.distance, Math.cos(cam.yaw) * cp * cam.distance]);
  };

  const basis = () => {
    const forward = v3.norm(v3.sub(cam.target, position()));
    const right = v3.norm(v3.cross(forward, [0, 1, 0]));
    const up = v3.cross(right, forward);
    return { forward, right, up };
  };

  const matrices = (aspect) => {
    m4.lookAt(position(), cam.target, [0, 1, 0], cam.view);
    m4.perspective((cam.fov * Math.PI) / 180, aspect, cam.near, cam.far, cam.projection);
    return { view: cam.view, projection: cam.projection };
  };

  const attach = (el, { sensitivity = 0.005, zoom = 0.1 } = {}) => {
    let dragging = false, lx = 0, ly = 0;
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; };
    const up = () => { dragging = false; };
    const mv = (e) => {
      if (!dragging) return;
      cam.yaw -= (e.clientX - lx) * sensitivity;
      cam.pitch = clamp(cam.pitch + (e.clientY - ly) * sensitivity, -1.5, 1.5);
      lx = e.clientX; ly = e.clientY;
    };
    const wheel = (e) => { cam.distance *= Math.exp(Math.sign(e.deltaY) * zoom); e.preventDefault(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.style.touchAction = 'none';
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
  };

  return Object.assign(cam, { position, basis, matrices, attach });
}
