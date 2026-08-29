// ---------------------------------------------------------------------------
// Noise on the CPU: simplex (2D, 3D), value noise, fractal sums, ridges,
// domain warping, cellular (Worley) noise and curl.
//
// Everything a texture, a terrain, a cloud, a coastline or a drift of motion
// needs, with no image files. The GPU versions live in glsl/noise.glsl.js and
// match these formulas closely enough that a height sampled here for game
// logic agrees with what the shader draws.
//
// All functions return roughly [-1, 1] unless noted. Seed with makeNoise(seed)
// to get an independent permutation table; the bare exports use a fixed one.
// ---------------------------------------------------------------------------

import { rng } from './rng.js?v=8';

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

export function makeNoise(seed = 'noise') {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  r.shuffle(p);
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  // 2D simplex noise (Gustavson's formulation).
  function simplex2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g = GRAD3[permMod12[ii + perm[jj]]];
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g = GRAD3[permMod12[ii + i1 + perm[jj + j1]]];
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g = GRAD3[permMod12[ii + 1 + perm[jj + 1]]];
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }

  // 3D simplex noise.
  function simplex3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const g = GRAD3[permMod12[ii + perm[jj + perm[kk]]]];
      t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const g = GRAD3[permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]];
      t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const g = GRAD3[permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]];
      t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const g = GRAD3[permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]];
      t3 *= t3; n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
    }
    return 32 * n;
  }

  // Value noise: smooth interpolation of a lattice of random values. Softer
  // and blockier than simplex, cheaper, and good for ground tones.
  const lattice = (x, y) => perm[(x & 255) + perm[y & 255]] / 255;
  function value2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * 2 - 1;
  }

  // Fractal sum. octaves layers, each lacunarity times finer and gain times
  // quieter. Normalised so the output stays inside about [-1, 1].
  function fbm2(x, y, octaves = 5, lacunarity = 2, gain = 0.5, fn = simplex2) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * fn(x, y);
      norm += amp;
      x *= lacunarity; y *= lacunarity; amp *= gain;
    }
    return sum / norm;
  }

  function fbm3(x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * simplex3(x, y, z);
      norm += amp;
      x *= lacunarity; y *= lacunarity; z *= lacunarity; amp *= gain;
    }
    return sum / norm;
  }

  // Ridged multifractal: sharp crests, the mountain-range shape. Returns
  // [0, 1] with 1 on the ridges.
  function ridged2(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let s = 1 - Math.abs(simplex2(x, y));
      s = s * s * weight;
      weight = Math.min(1, Math.max(0, s * 2));
      sum += s * amp;
      norm += amp;
      x *= lacunarity; y *= lacunarity; amp *= gain;
    }
    return sum / norm;
  }

  // Domain warping: sample the noise at a point that noise itself has moved.
  // One warp gives marble and smoke; two give the tangled, organic look.
  function warp2(x, y, strength = 1, octaves = 4) {
    const qx = fbm2(x, y, octaves);
    const qy = fbm2(x + 5.2, y + 1.3, octaves);
    return fbm2(x + strength * qx, y + strength * qy, octaves);
  }

  function warp2x2(x, y, strength = 1, octaves = 4) {
    const qx = fbm2(x, y, octaves);
    const qy = fbm2(x + 5.2, y + 1.3, octaves);
    const rx = fbm2(x + 4 * qx + 1.7, y + 4 * qy + 9.2, octaves);
    const ry = fbm2(x + 4 * qx + 8.3, y + 4 * qy + 2.8, octaves);
    return fbm2(x + strength * rx, y + strength * ry, octaves);
  }

  // Cellular (Worley) noise. Returns {f1, f2, id}: distance to the nearest
  // and second-nearest feature point and the nearest cell's id, in [0, ~1.4].
  // f1 alone is bubbles and cells; f2 - f1 is cracks, scales and cobbles.
  function worley2(x, y, jitter = 1) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i, cy = yi + j;
        const h = perm[(cx & 255) + perm[cy & 255]];
        const h2 = perm[(cx + 37 & 255) + perm[cy + 91 & 255]];
        const px = cx + 0.5 + (h / 255 - 0.5) * jitter;
        const py = cy + 0.5 + (h2 / 255 - 0.5) * jitter;
        const dx = px - x, dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = h * 256 + h2; }
        else if (d < f2) f2 = d;
      }
    }
    return { f1, f2, id };
  }

  // Curl of a 2D scalar field: a divergence-free flow, so particles pushed
  // along it swirl and never pile up. Returns [vx, vy].
  function curl2(x, y, eps = 0.01, fn = simplex2) {
    const dx = (fn(x + eps, y) - fn(x - eps, y)) / (2 * eps);
    const dy = (fn(x, y + eps) - fn(x, y - eps)) / (2 * eps);
    return [dy, -dx];
  }

  // Fill a Float32Array grid with fbm, for a texture or a heightmap.
  function grid(w, h, scale = 0.02, octaves = 5, fn = fbm2) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = fn(x * scale, y * scale, octaves);
    }
    return out;
  }

  return { simplex2, simplex3, value2, fbm2, fbm3, ridged2, warp2, warp2x2, worley2, curl2, grid, perm };
}

const shared = makeNoise('shared');
export const simplex2 = shared.simplex2;
export const simplex3 = shared.simplex3;
export const value2 = shared.value2;
export const fbm2 = shared.fbm2;
export const fbm3 = shared.fbm3;
export const ridged2 = shared.ridged2;
export const warp2 = shared.warp2;
export const warp2x2 = shared.warp2x2;
export const worley2 = shared.worley2;
export const curl2 = shared.curl2;
export const grid = shared.grid;

export default makeNoise;
