// The picture: the island raymarched, the carrier as a few lit parts, the
// fleet as instances, all sharing one depth buffer, resolved to the screen.
// The camera orbits the carrier; clicking the land moves the anchor.
import { fullscreen, target, bindScreen, program, buffer, vao, shapes } from './gl.js?v=1';
import { orbitCamera } from './camera.js?v=1';
import { m4 } from './mat.js?v=1';
import { hexToRgb } from './palette.js?v=1';

export function createView(G, canvas, cfg, S, world, drones) {
  const gl = G.gl;
  const P = cfg.palette;
  const rgb = (h) => hexToRgb(h);
  const terrain = fullscreen(gl, S.TERRAIN_FS);
  const resolve = fullscreen(gl, S.RESOLVE_FS);
  const partProg = program(gl, S.PART_VS, S.PART_FS);

  // the carrier's parts: a long hull, a keel, two fins
  const partMesh = (shape) => {
    const v = vao(gl, partProg, {
      attribs: { a_pos: { buffer: buffer(gl, shape.positions), size: 3 }, a_nrm: { buffer: buffer(gl, shape.normals), size: 3 } },
      index: shape.indices,
    });
    return v;
  };
  const hull = partMesh(shapes.sphere(20));
  const box = partMesh(shapes.cube());
  const parts = [
    { mesh: hull, scale: [22, 7, 8], off: [0, 0, 0], col: 'hull' },
    { mesh: box, scale: [12, 2.2, 3.2], off: [-1, -4.6, 0], col: 'hullDark' },
    { mesh: box, scale: [7, 0.4, 5], off: [-9, 1.5, 3.5], col: 'hullDark' },
    { mesh: box, scale: [7, 0.4, 5], off: [-9, 1.5, -3.5], col: 'hullDark' },
    { mesh: box, scale: [5, 3.5, 0.4], off: [-10, 2.5, 0], col: 'hull' },
  ];

  // a narrow viewport (a phone) needs the camera farther back to hold the island in frame
  const narrow = canvas.clientWidth > 0 && canvas.clientWidth < canvas.clientHeight;
  const cam = orbitCamera({ target: [0, 0, 0], distance: cfg.camera.distance * (narrow ? 1.6 : 1), yaw: cfg.camera.yaw, pitch: cfg.camera.pitch, fov: cfg.camera.fov, near: 0.5, far: 1800 });
  cam.attach(canvas, { sensitivity: 0.004 });
  let lastInput = performance.now();
  let dragged = false, downAt = null;
  canvas.addEventListener('pointerdown', (e) => { lastInput = performance.now(); downAt = [e.clientX, e.clientY]; dragged = false; });
  canvas.addEventListener('pointermove', (e) => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) dragged = true; });
  canvas.addEventListener('wheel', () => { lastInput = performance.now(); });

  const sun = (() => { const v = [0.45, 0.42, 0.55]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
  const state = { carrier: [0, 0, 0], anchor: [0, 0], heading: 0 };
  let scene = null;

  const carrierHeight = () => Math.max(world.groundAt(state.carrier[0], state.carrier[2]), cfg.world.sea) + cfg.carrier.hover;

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
      state.heading += (Math.atan2(dx, dz) - state.heading) * Math.min(1, dt * 2);
    }
    state.carrier[1] += (carrierHeight() - state.carrier[1]) * Math.min(1, dt * 1.5);
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
      if (y < world.groundAt(x, z) || y < cfg.world.sea) {
        const lim = cfg.world.size * 0.46;
        return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
      }
    }
    return null;
  };

  const draw = (t, range, fogK = 0.0009) => {
    if (G.resize(1) || !scene) {
      scene = target(gl, { width: Math.max(2, Math.floor(canvas.width * cfg.render.scale)), height: Math.max(2, Math.floor(canvas.height * cfg.render.scale)), format: 'rgba16f', filter: 'linear', depth: true });
    }
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
    const base = m4.compose(state.carrier, state.heading, 0, cfg.carrier.scale);
    for (const part of parts) {
      const local = m4.multiply(m4.translation(part.off[0], part.off[1], part.off[2]), m4.scaling(part.scale[0], part.scale[1], part.scale[2]));
      const model = m4.multiply(base, local);
      partProg.set({ u_model: model, u_viewProj: viewProj, u_sun: sun, u_col: rgb(P[part.col]), u_colDark: rgb(P.hullDark), u_fog: rgb(P.fog), u_eye: eye, u_fogK: fogK });
      gl.bindVertexArray(part.mesh.vao);
      gl.drawElements(gl.TRIANGLES, part.mesh.indexCount, part.mesh.indexType, 0);
      gl.bindVertexArray(null);
    }

    // the fleet
    drones.draw({ u_viewProj: viewProj, u_time: t, u_carrier: state.carrier, u_sun: sun, u_col: rgb(P.drone), u_colLoaded: rgb(P.droneLoaded), u_fog: rgb(P.fog), u_fogK: fogK });
    gl.disable(gl.DEPTH_TEST);

    bindScreen(gl);
    resolve.draw({ u_tex: scene, u_exposure: 0.98 });
  };

  return { gl, G, cam, state, sun, placeCarrier, update, pick, draw, get scale() { return cfg.carrier.scale; } };
}
