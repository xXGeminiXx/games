// The fleet as textures. Each drone is one texel in two textures stepped by
// one shader; the CPU only uploads a kind table when the fleet's makeup
// changes and a count when it grows. Drawing is one instanced call.
import { fullscreen, program, instancedMesh, pingpongMRT, texture, buffer } from './gl.js?v=2';
import { dart } from './dart.js?v=2';

export function createDrones(gl, cfg, S) {
  const W = Math.round(Math.sqrt(cfg.drones.visibleCap));
  const N = W * W;
  const sim = fullscreen(gl, S.DRONE_SIM_FS);
  const buf = pingpongMRT(gl, { width: W, height: W, format: 'rgba32f', count: 2 });
  const kindTex = texture(gl, { width: W, height: W, format: 'r8', filter: 'nearest' });
  const kinds = new Uint8Array(N);
  const harvestProg = program(gl, S.HARVEST_VS, S.HARVEST_FS);
  const harvestVao = gl.createVertexArray();
  const drawProg = program(gl, S.DRONE_VS, S.DRONE_FS);

  // The body every drone is drawn with. instancedMesh takes positions and
  // normals; the shade that separates the canopy and the rotors from the
  // orange body rides along as one more per-vertex attribute.
  const body = dart();
  const mesh = instancedMesh(gl, drawProg, body, {}, N);
  (() => {
    const loc = drawProg.attribs.a_shade;
    if (loc === undefined || loc < 0) return;
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, body.shades));
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  })();

  let active = 0;

  // Put every drone in the carrier, docked, ready to launch.
  const reset = (carrier) => {
    const init = new Float32Array(N * 4), aux = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      init[i * 4] = carrier[0]; init[i * 4 + 1] = carrier[1]; init[i * 4 + 2] = carrier[2]; init[i * 4 + 3] = 4;
      aux[i * 4] = 3; aux[i * 4 + 1] = (i % 97) * 0.02; aux[i * 4 + 2] = carrier[0]; aux[i * 4 + 3] = carrier[2];
    }
    for (const t of [buf.read, buf.write]) {
      gl.bindTexture(gl.TEXTURE_2D, t.colors[0].texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RGBA, gl.FLOAT, init);
      gl.bindTexture(gl.TEXTURE_2D, t.colors[1].texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RGBA, gl.FLOAT, aux);
    }
  };

  // The fleet's makeup: specialists first in kind order, then generalists.
  // Only `count` drones fly; the visible fleet stands for the whole count.
  const setFleet = (count, specialists, kindOrder) => {
    active = Math.min(N, Math.floor(count));
    let i = 0;
    const kindIndex = { ore: 0, timber: 1, fish: 2, ice: 3 };
    for (const k of kindOrder) {
      const n = Math.min(specialists[k] || 0, N - i);
      for (let j = 0; j < n; j++) kinds[i++] = kindIndex[k] * 50;
    }
    while (i < N) kinds[i++] = 4 * 50;
    gl.bindTexture(gl.TEXTURE_2D, kindTex.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED, gl.UNSIGNED_BYTE, kinds);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  };

  const step = (dt, t, world, carrier, range, speed) => {
    buf.write.bind();
    sim.draw({
      u_pos: buf.read.colors[0], u_aux: buf.read.colors[1], u_kind: kindTex, u_height: world.height, u_rich: world.rich.read,
      u_carrier: carrier, u_range: range, u_active: active, u_speed: speed, u_dt: dt, u_time: t,
      u_gatherTime: cfg.drones.gatherTime, u_dockTime: cfg.drones.dockTime, u_cruise: cfg.drones.cruise, u_hover: cfg.drones.hover,
      u_minRich: cfg.drones.minRich, u_texW: W,
    });
    buf.swap();
    // lay the harvest where the gatherers hover
    world.harvest.bind();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    harvestProg.use();
    harvestProg.set({ u_pos: buf.read.colors[0], u_aux: buf.read.colors[1], u_w: W, u_active: active, u_amount: dt });
    gl.bindVertexArray(harvestVao);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  };

  const draw = (uniforms) => {
    drawProg.use();
    drawProg.set({ u_pos: buf.read.colors[0], u_aux: buf.read.colors[1], u_texW: W, u_active: active, u_size: cfg.drones.size, ...uniforms });
    mesh.draw(active);
  };

  return { W, N, body, reset, setFleet, step, draw, get active() { return active; } };
}
