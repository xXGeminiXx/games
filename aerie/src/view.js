// The picture: the island raymarched, the carrier as a few lit parts, the
// fleet as instances, all sharing one depth buffer, resolved to the screen.
// The camera orbits the carrier; clicking the land moves the anchor.
import { fullscreen, target, bindScreen, program, buffer, vao } from './gl.js?v=5';
import { orbitCamera } from './camera.js?v=5';
import { m4, clamp } from './mat.js?v=5';
import { hexToRgb } from './palette.js?v=5';
import { carrierMesh } from './carrier.js?v=5';

export function createView(G, canvas, cfg, S, world, drones) {
  const gl = G.gl;
  const P = cfg.palette;
  const rgb = (h) => hexToRgb(h);
  const terrain = fullscreen(gl, S.TERRAIN_FS);
  const resolve = fullscreen(gl, S.RESOLVE_FS);
  const partProg = program(gl, S.PART_VS, S.PART_FS);

  // The carrier: every piece of it baked into one mesh with a colour per
  // vertex, so a ship made of seventy parts still costs one draw call.
  const ship = carrierMesh(P);
  const shipMesh = vao(gl, partProg, {
    attribs: {
      a_pos: { buffer: buffer(gl, ship.positions), size: 3 },
      a_nrm: { buffer: buffer(gl, ship.normals), size: 3 },
      a_col: { buffer: buffer(gl, ship.colors), size: 4 },
    },
    index: ship.indices,
  });

  // a narrow viewport (a phone) needs the camera farther back to hold the island in frame
  const narrow = canvas.clientWidth > 0 && canvas.clientWidth < canvas.clientHeight;
  const cam = orbitCamera({ target: [0, 0, 0], distance: cfg.camera.distance * (narrow ? 1.6 : 1), yaw: cfg.camera.yaw, pitch: cfg.camera.pitch, fov: cfg.camera.fov, near: 0.5, far: 1800 });
  cam.attach(canvas, { sensitivity: 0.004 });
  const home = { distance: cam.distance, yaw: cam.yaw, pitch: cam.pitch };
  let lastInput = performance.now();
  const markInput = () => { lastInput = performance.now(); };
  let dragged = false, downAt = null;
  canvas.addEventListener('pointerdown', (e) => { markInput(); downAt = [e.clientX, e.clientY]; dragged = false; });
  canvas.addEventListener('pointermove', (e) => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) dragged = true; });
  canvas.addEventListener('wheel', markInput);

  // What the keyboard drives. Distance and pitch are held inside the limits
  // the game is framed for, so no key can put the camera underground or so
  // far out that the island is a speck.
  const C = cfg.controls;
  const control = {
    basis: () => cam.basis(),
    orbit: (d) => { cam.yaw -= d; markInput(); },
    pitchBy: (d) => { cam.pitch = clamp(cam.pitch + d, C.minPitch, C.maxPitch); markInput(); },
    zoomBy: (d) => { cam.distance = clamp(cam.distance * Math.exp(d), C.minDistance, C.maxDistance); markInput(); },
    recentre: () => { cam.distance = home.distance; cam.yaw = home.yaw; cam.pitch = home.pitch; markInput(); },
  };

  const sun = (() => { const v = [0.45, 0.42, 0.55]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
  const state = { carrier: [0, 0, 0], anchor: [0, 0], heading: 0 };
  let scene = null;

  const carrierHeight = () => Math.max(world.groundAt(state.carrier[0], state.carrier[2]), cfg.world.sea) + cfg.carrier.hover;

  // Nothing may be anchored past the edge of the world, however it got there.
  const clampAnchor = (x, z) => {
    const l = cfg.world.size * 0.46;
    return [Math.max(-l, Math.min(l, x)), Math.max(-l, Math.min(l, z))];
  };

  // Push the anchor across the water; the carrier glides after it exactly as
  // it does when the land is clicked.
  const fly = (dx, dz) => { state.anchor = clampAnchor(state.anchor[0] + dx, state.anchor[1] + dz); markInput(); };

  const placeCarrier = (x, z) => {
    state.carrier = [x, 0, z];
    state.carrier[1] = carrierHeight();
    state.anchor = [x, z];
  };

  // Glide toward the anchor; hold height over whatever is below.
  const update = (dt) => {
    const [ax, az] = state.anchor;
    const dx = ax - state.carrier[0], dz = az - state.carrier[2];
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      const step = Math.min(dist, cfg.carrier.speed * dt);
      state.carrier[0] += (dx / dist) * step;
      state.carrier[2] += (dz / dist) * step;
      // turn the short way round, so crossing due south does not spin the ship
      let turn = Math.atan2(dx, dz) - state.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      state.heading += turn * Math.min(1, dt * 2);
    }
    state.carrier[1] += (carrierHeight() - state.carrier[1]) * Math.min(1, dt * 1.5);
    // the wheel and the keyboard share one set of limits
    cam.distance = clamp(cam.distance, C.minDistance, C.maxDistance);
    cam.pitch = clamp(cam.pitch, C.minPitch, C.maxPitch);
    cam.target = [state.carrier[0], state.carrier[1] - 6, state.carrier[2]];
    if (performance.now() - lastInput > cfg.camera.idleAfter * 1000) cam.yaw += dt * cfg.camera.idleOrbit;
  };

  // Where a click lands on the land: a coarse march along the pick ray.
  const pick = (clientX, clientY) => {
    if (dragged) return null;
    const r = canvas.getBoundingClientRect();
    const u = (clientX - r.left) / r.width, v = 1 - (clientY - r.top) / r.height;
    const { forward, right, up } = cam.basis();
    const tan = Math.tan((cam.fov * Math.PI) / 360), aspect = r.width / r.height;
    const sx = (u * 2 - 1) * aspect * tan, sy = (v * 2 - 1) * tan;
    const rd = [forward[0] + sx * right[0] + sy * up[0], forward[1] + sx * right[1] + sy * up[1], forward[2] + sx * right[2] + sy * up[2]];
    const l = Math.hypot(...rd); rd[0] /= l; rd[1] /= l; rd[2] /= l;
    const ro = cam.position();
    for (let t = 1; t < 1500; t += 1.2) {
      const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t;
      if (y < world.groundAt(x, z) || y < cfg.world.sea) return clampAnchor(x, z);
    }
    return null;
  };

  // The buffer the island is marched into.
  //
  // It is expensive to make - a full-screen half-float colour plus a depth
  // buffer runs to tens of megabytes - so it is not rebuilt the instant the
  // window changes size. Dragging a window edge changes the size on every
  // frame of the drag, and building one buffer a frame would churn the
  // driver through hundreds of megabytes and slow down exactly the moment the
  // player is watching. Instead the old buffer keeps being drawn into, a
  // little stretched, until the size has held still; then one new buffer is
  // made and the old one is handed back.
  let sceneW = 0, sceneH = 0, wantW = 0, wantH = 0, pending = 0, now = false;
  const setScale = (s) => { cfg.render.scale = s; now = true; };

  const fitScene = (dt) => {
    const w = Math.max(2, Math.floor(canvas.width * cfg.render.scale));
    const h = Math.max(2, Math.floor(canvas.height * cfg.render.scale));
    if (scene && w === sceneW && h === sceneH) { pending = 0; now = false; return; }
    // The first buffer, and a deliberate change of detail, happen at once. A
    // window being dragged does not: the clock runs only while the requested
    // size holds still, so a drag that changes it every frame never reaches
    // the delay and no buffer is built until the drag ends.
    if (scene && !now) {
      if (w !== wantW || h !== wantH) { wantW = w; wantH = h; pending = 0; return; }
      pending += dt;
      if (pending < cfg.render.resizeDelay) return;
    }
    pending = 0; now = false;
    wantW = w; wantH = h;
    const old = scene;
    scene = target(gl, { width: w, height: h, format: 'rgba16f', filter: 'linear', depth: true });
    sceneW = w; sceneH = h;
    if (old) old.dispose();
  };

  const draw = (t, range, fogK = 0.0009, dt = 0.016) => {
    G.resize(1);
    fitScene(dt);
    const aspect = canvas.width / canvas.height;
    const { view, projection } = cam.matrices(aspect);
    const viewProj = m4.multiply(projection, view);
    const { forward, right, up } = cam.basis();
    const eye = cam.position();

    scene.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    terrain.draw({
      u_height: world.height, u_rich: world.rich.read, u_suit: world.suit,
      u_ro: eye, u_fwd: forward, u_right: right, u_up: up, u_aspect: aspect, u_tanFov: Math.tan((cam.fov * Math.PI) / 360),
      u_viewProj: viewProj, u_time: t, u_sun: sun, u_carrier: [state.carrier[0], state.carrier[2]], u_range: range, u_fogK: fogK,
      u_sea: rgb(P.sea), u_seaShallow: rgb(P.seaShallow), u_foam: rgb(P.foam), u_sand: rgb(P.sand), u_chalk: rgb(P.chalk), u_rock: rgb(P.rock),
      u_scree: rgb(P.scree), u_scrub: rgb(P.scrub), u_pine: rgb(P.pine), u_stump: rgb(P.stump), u_snow: rgb(P.snow), u_bareIce: rgb(P.bareIce),
      u_zenith: rgb(P.zenith), u_horizon: rgb(P.horizon), u_sunCol: rgb(P.sun), u_fogCol: rgb(P.fog), u_accent: rgb(P.accent),
    });

    // the carrier
    partProg.use();
    partProg.set({ u_model: m4.compose(state.carrier, state.heading, 0, cfg.carrier.scale), u_viewProj: viewProj, u_sun: sun, u_colDark: rgb(P.hullDark), u_fog: rgb(P.fog), u_eye: eye, u_fogK: fogK });
    gl.bindVertexArray(shipMesh.vao);
    gl.drawElements(gl.TRIANGLES, shipMesh.indexCount, shipMesh.indexType, 0);
    gl.bindVertexArray(null);

    // the fleet
    drones.draw({ u_viewProj: viewProj, u_time: t, u_carrier: state.carrier, u_sun: sun, u_col: rgb(P.drone), u_colLoaded: rgb(P.droneLoaded), u_colTrim: rgb(P.hullDark), u_fog: rgb(P.fog), u_fogK: fogK });
    gl.disable(gl.DEPTH_TEST);

    bindScreen(gl);
    resolve.draw({ u_tex: scene, u_exposure: 0.98 });
  };

  return { gl, G, cam, control, state, sun, ship, placeCarrier, fly, markInput, setScale, update, pick, draw, get scale() { return cfg.carrier.scale; } };
}
