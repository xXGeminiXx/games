// ---------------------------------------------------------------------------
// WebGL2 in about two hundred lines.
//
// The pattern behind most GPU art is the same five things: a canvas with a
// context, a program from two shader strings, a full-screen triangle to run a
// fragment shader over every pixel, textures that a pass can render INTO and
// the next pass can read (ping-pong), and instanced draws for a great many
// copies of one shape. This module is those five things and nothing else, so
// a raymarched world, a particle field, a cellular automaton or a post-process
// chain each fit in one short file beside it.
//
// Errors are loud: a shader that fails to compile throws with the offending
// line quoted, which is the difference between a five-second fix and an hour.
// ---------------------------------------------------------------------------

export function createGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: opts.antialias ?? false,
    alpha: opts.alpha ?? false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    powerPreference: opts.powerPreference ?? 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  // Float render targets are needed for simulations (positions, velocities,
  // chemical concentrations). Nearly every device has them; check anyway.
  const floatColor = !!gl.getExtension('EXT_color_buffer_float');
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');
  let maxDpr = opts.maxDpr ?? 2;
  // A floor on the drawing buffer as well as a ceiling. Browser zoom can put
  // devicePixelRatio below 1, and a buffer smaller than the page is resampled
  // twice on its way to the glass - once by the resolve pass and again by the
  // browser - which no quality setting can undo. Holding a floor of one
  // device pixel per page pixel costs pixels; the frame guard is what pays
  // for it, by easing the raymarch resolution instead.
  let minDpr = opts.minDpr ?? 1;

  // Size the drawing buffer to the element's CSS size times the device pixel
  // ratio, capped, and return whether anything changed.
  const resize = (scale = 1) => {
    const dpr = Math.max(minDpr, Math.min(maxDpr, window.devicePixelRatio || 1)) * scale;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  };

  // The pixel-ratio ceiling can move while the game runs, because the player
  // can change how sharp they want the picture. Nothing is reallocated here;
  // the next resize() sees the new number and reports the change.
  // The ceiling can move while the game runs, because the player can say how
  // much they want spent. It is a cap and only a cap: on a display that
  // reports a ratio below it, raising it changes nothing at all.
  const setMaxDpr = (v) => { maxDpr = Math.max(0.5, Number(v) || 1); };
  const dpr = () => Math.max(minDpr, Math.min(maxDpr, window.devicePixelRatio || 1));

  return { gl, canvas, resize, floatColor, floatLinear, setMaxDpr, dpr, get maxDpr() { return maxDpr; }, get minDpr() { return minDpr; } };
}

// ---- shaders --------------------------------------------------------------
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const line = m ? parseInt(m[1], 10) : 0;
    const lines = src.split('\n');
    const quoted = line ? `\n  ${line - 1}: ${lines[line - 2] ?? ''}\n> ${line}: ${lines[line - 1] ?? ''}\n  ${line + 1}: ${lines[line] ?? ''}` : '';
    gl.deleteShader(sh);
    throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed:\n${log}${quoted}`);
  }
  return sh;
}

// Build a program. Uniform locations are looked up once and cached on the
// returned object so setting them each frame is a plain property access.
export function program(gl, vertSrc, fragSrc, { transformFeedback = null } = {}) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  if (transformFeedback) gl.transformFeedbackVaryings(p, transformFeedback, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program failed to link: ' + gl.getProgramInfoLog(p));
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
  }
  const attribs = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    attribs[info.name] = gl.getAttribLocation(p, info.name);
  }

  let unit = 0;
  // Set uniforms from a plain object. Numbers, arrays of 2-4 numbers,
  // Float32Array(16) matrices and textures are all told apart by the type
  // the shader declared, so the caller never names a glUniform variant.
  const set = (values) => {
    unit = 0;
    for (const name in values) {
      const u = uniforms[name];
      if (!u) continue;
      const v = values[name];
      switch (u.type) {
        case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
        case gl.INT_VEC2: gl.uniform2iv(u.loc, v); break;
        case gl.INT_VEC3: gl.uniform3iv(u.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
        case gl.SAMPLER_2D: case gl.SAMPLER_3D: case gl.SAMPLER_CUBE: case gl.INT_SAMPLER_2D: case gl.UNSIGNED_INT_SAMPLER_2D: {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(u.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : u.type === gl.SAMPLER_CUBE ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D, v.texture || v);
          gl.uniform1i(u.loc, unit);
          unit++;
          break;
        }
        default: break;
      }
    }
  };

  return { program: p, uniforms, attribs, set, use: () => gl.useProgram(p) };
}

// ---- the full-screen pass -------------------------------------------------
// One triangle bigger than the screen; the fragment shader gets v_uv in
// [0, 1]. Shaders written for this expect `#version 300 es` at the top and
// `in vec2 v_uv; out vec4 fragColor;`.
export const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function fullscreen(gl, fragSrc) {
  const prog = program(gl, FULLSCREEN_VS, fragSrc);
  const vao = gl.createVertexArray();
  return {
    ...prog,
    // Run the shader over the whole current framebuffer with these uniforms.
    draw: (values = {}) => {
      gl.useProgram(prog.program);
      gl.bindVertexArray(vao);
      prog.set(values);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// ---- textures and render targets -----------------------------------------
const FORMATS = {
  rgba8: (gl) => [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
  rgba16f: (gl) => [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
  rgba32f: (gl) => [gl.RGBA32F, gl.RGBA, gl.FLOAT],
  r8: (gl) => [gl.R8, gl.RED, gl.UNSIGNED_BYTE],
  r16f: (gl) => [gl.R16F, gl.RED, gl.HALF_FLOAT],
  r32f: (gl) => [gl.R32F, gl.RED, gl.FLOAT],
  rg16f: (gl) => [gl.RG16F, gl.RG, gl.HALF_FLOAT],
  rg32f: (gl) => [gl.RG32F, gl.RG, gl.FLOAT],
};

export function texture(gl, { width, height, format = 'rgba8', data = null, filter = 'linear', wrap = 'clamp', mipmap = false } = {}) {
  const [internal, fmt, type] = FORMATS[format](gl);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, fmt, type, data);
  const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  const w = wrap === 'repeat' ? gl.REPEAT : wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  return { texture: tex, width, height, format };
}

// A framebuffer with one colour attachment (and optionally a depth buffer).
export function target(gl, opts) {
  const color = texture(gl, opts);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color.texture, 0);
  let depth = null;
  if (opts.depth) {
    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, opts.width, opts.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete: ' + status + ' (format ' + opts.format + ')');
  return {
    fbo, color, depth, width: opts.width, height: opts.height, texture: color.texture,
    bind: () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, opts.width, opts.height);
    },
  };
}

// Two targets that swap: read from one while writing the other. The state of
// every simulation lives in a pair like this.
export function pingpong(gl, opts) {
  let a = target(gl, opts), b = target(gl, opts);
  return {
    get read() { return a; },
    get write() { return b; },
    swap: () => { const t = a; a = b; b = t; },
    width: opts.width, height: opts.height,
  };
}

export function bindScreen(gl) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

// ---- geometry and instancing ---------------------------------------------
// Upload a Float32Array as a buffer and describe how a program reads it.
export function buffer(gl, data, usage = gl.STATIC_DRAW) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return buf;
}

// A vertex array from a description:
//   { attribs: { a_pos: { buffer, size: 3 }, a_offset: { buffer, size: 3, divisor: 1 } }, index: Uint16Array }
// divisor 1 makes an attribute advance per instance instead of per vertex,
// which is all instancing is.
export function vao(gl, prog, { attribs, index = null }) {
  const v = gl.createVertexArray();
  gl.bindVertexArray(v);
  for (const name in attribs) {
    const loc = prog.attribs[name];
    if (loc === undefined || loc < 0) continue;
    const a = attribs[name];
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, a.size, a.type || gl.FLOAT, a.normalized || false, a.stride || 0, a.offset || 0);
    if (a.divisor) gl.vertexAttribDivisor(loc, a.divisor);
  }
  let indexCount = 0;
  if (index) {
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    indexCount = index.length;
  }
  gl.bindVertexArray(null);
  return { vao: v, indexCount, indexType: index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

// ---- a few shapes, as {positions, normals, indices} ----------------------
export const shapes = {
  quad: () => ({
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }),
  cube: () => {
    const P = [], N = [], I = [];
    const faces = [
      [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
      [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
      [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
      [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    ];
    faces.forEach(([n, ...pts], f) => {
      pts.forEach((p) => { P.push(p[0] * 0.5, p[1] * 0.5, p[2] * 0.5); N.push(...n); });
      const b = f * 4;
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint16Array(I) };
  },
  // A low-poly sphere; segments 8 is a nice faceted look, 24 is smooth.
  sphere: (segments = 12) => {
    const P = [], N = [], I = [];
    for (let y = 0; y <= segments; y++) {
      const v = y / segments, phi = v * Math.PI;
      for (let x = 0; x <= segments; x++) {
        const u = x / segments, theta = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(theta);
        P.push(nx * 0.5, ny * 0.5, nz * 0.5);
        N.push(nx, ny, nz);
      }
    }
    for (let y = 0; y < segments; y++) {
      for (let x = 0; x < segments; x++) {
        const a = y * (segments + 1) + x, b = a + segments + 1;
        I.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint16Array(I) };
  },
  // A tube along Y, unit height and unit diameter, so it drops into the same
  // scale-a-unit-box idiom as cube(). `caps` off leaves a ring, which is what
  // an engine cowl or a hull frame wants.
  cylinder: (segments = 16, caps = true) => {
    const P = [], N = [], I = [];
    const push = (x, y, z, nx, ny, nz) => { P.push(x, y, z); N.push(nx, ny, nz); return P.length / 3 - 1; };
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const b = push(c0 * 0.5, -0.5, s0 * 0.5, c0, 0, s0);
      push(c1 * 0.5, -0.5, s1 * 0.5, c1, 0, s1);
      push(c1 * 0.5, 0.5, s1 * 0.5, c1, 0, s1);
      push(c0 * 0.5, 0.5, s0 * 0.5, c0, 0, s0);
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    if (caps) {
      for (const dir of [1, -1]) {
        const centre = push(0, dir * 0.5, 0, 0, dir, 0);
        for (let i = 0; i < segments; i++) {
          const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
          const p0 = push(Math.cos(a0) * 0.5, dir * 0.5, Math.sin(a0) * 0.5, 0, dir, 0);
          const p1 = push(Math.cos(a1) * 0.5, dir * 0.5, Math.sin(a1) * 0.5, 0, dir, 0);
          if (dir > 0) I.push(centre, p0, p1); else I.push(centre, p1, p0);
        }
      }
    }
    return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint16Array(I) };
  },
};

// Convenience: a mesh ready to draw instanced. `instances` is an object of
// per-instance Float32Arrays, each with a size (e.g. { a_offset: [data, 3] }).
export function instancedMesh(gl, prog, shape, instances, count) {
  const attribs = {
    a_pos: { buffer: buffer(gl, shape.positions), size: 3 },
  };
  if (shape.normals) attribs.a_nrm = { buffer: buffer(gl, shape.normals), size: 3 };
  if (shape.uvs) attribs.a_uv = { buffer: buffer(gl, shape.uvs), size: 2 };
  const instanceBuffers = {};
  for (const name in instances) {
    const [data, size] = instances[name];
    const b = buffer(gl, data, gl.DYNAMIC_DRAW);
    instanceBuffers[name] = b;
    attribs[name] = { buffer: b, size, divisor: 1 };
  }
  const v = vao(gl, prog, { attribs, index: shape.indices });
  return {
    ...v,
    count,
    buffers: instanceBuffers,
    // Re-upload one per-instance attribute (positions that moved this frame).
    update: (name, data) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffers[name]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    },
    draw: (n = count) => {
      gl.bindVertexArray(v.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, v.indexCount, v.indexType, 0, n);
      gl.bindVertexArray(null);
    },
  };
}

// ---- frame loop -----------------------------------------------------------
// Calls fn(dt, t) every animation frame with dt clamped, so a tab that was in
// the background does not come back with a ten-second step. Returns stop().
export function loop(fn) {
  let last = performance.now(), running = true, t = 0;
  const tick = (now) => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    fn(dt, t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { running = false; };
}

// ---- multiple render targets ---------------------------------------------
// One pass writing several textures at once: a simulation whose state does
// not fit in four floats. The fragment shader declares
//   layout(location = 0) out vec4 o_a; layout(location = 1) out vec4 o_b;
export function mrt(gl, { width, height, format = 'rgba32f', count = 2, filter = 'nearest' }) {
  const colors = [];
  const bufs = [];
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  for (let i = 0; i < count; i++) {
    const t = texture(gl, { width, height, format, filter });
    colors.push(t);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.texture, 0);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('mrt framebuffer incomplete: ' + status);
  return {
    fbo, colors, width, height,
    bind: () => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, width, height); },
  };
}

export function pingpongMRT(gl, opts) {
  let a = mrt(gl, opts), b = mrt(gl, opts);
  return {
    get read() { return a; },
    get write() { return b; },
    swap: () => { const t = a; a = b; b = t; },
    width: opts.width, height: opts.height,
  };
}
