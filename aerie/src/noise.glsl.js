// ---------------------------------------------------------------------------
// Noise for shaders, as strings to splice into a fragment or vertex shader.
//
// Usage:  const frag = `#version 300 es\nprecision highp float;\n${NOISE}\n ...`
//
// hash12/hash22/hash13: cheap white noise from a coordinate, no textures.
// snoise(vec2), snoise(vec3): simplex noise in [-1, 1].
// fbm(p, octaves): fractal sum, the workhorse for terrain, clouds and grain.
// worley(p): cellular noise, (f1, f2) distances.
// warp(p, k): domain warped fbm, marble and smoke and geology.
// curl(p): a divergence-free 2D flow from noise, for drifting particles.
// ---------------------------------------------------------------------------

export const HASH = `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
`;

export const SIMPLEX = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const FBM = `
float fbm(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    norm += amp;
    p = p * 2.02 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum / norm;
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    norm += amp;
    p = p * 2.02 + vec3(17.3, 9.1, 3.7);
    amp *= 0.5;
  }
  return sum / norm;
}
// Sharp crests: 1 on the ridges, 0 in the valleys.
float ridged(vec2 p, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0, w = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float s = 1.0 - abs(snoise(p));
    s = s * s * w;
    w = clamp(s * 2.0, 0.0, 1.0);
    sum += s * amp;
    norm += amp;
    p = p * 2.0 + vec2(3.1, 7.7);
    amp *= 0.5;
  }
  return sum / norm;
}
// Domain warp: noise sampled where noise has moved the point.
float warp(vec2 p, float k) {
  vec2 q = vec2(fbm(p, 4), fbm(p + vec2(5.2, 1.3), 4));
  return fbm(p + k * q, 4);
}
// Two-level warp: the tangled organic look.
float warp2(vec2 p, float k) {
  vec2 q = vec2(fbm(p, 4), fbm(p + vec2(5.2, 1.3), 4));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2), 4), fbm(p + 4.0 * q + vec2(8.3, 2.8), 4));
  return fbm(p + k * r, 4);
}
`;

export const WORLEY = `
// (nearest distance, second nearest). f1: cells and bubbles. f2 - f1: cracks.
vec2 worley(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return sqrt(vec2(f1, f2));
}
// 3D cellular noise, nearest distance only.
float worley3(vec3 p) {
  vec3 n = floor(p), f = fract(p);
  float f1 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 r = g + hash33(n + g) - f;
    f1 = min(f1, dot(r, r));
  }
  return sqrt(f1);
}
`;

export const CURL = `
// Divergence-free 2D flow from a noise potential.
vec2 curl(vec2 p) {
  const float e = 0.01;
  float dx = snoise(p + vec2(e, 0.0)) - snoise(p - vec2(e, 0.0));
  float dy = snoise(p + vec2(0.0, e)) - snoise(p - vec2(0.0, e));
  return vec2(dy, -dx) / (2.0 * e);
}
// 3D curl from three offset noise fields.
vec3 curl3(vec3 p) {
  const float e = 0.01;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  float x = snoise(p + dy + vec3(31.4, 0.0, 0.0)) - snoise(p - dy + vec3(31.4, 0.0, 0.0)) - snoise(p + dz + vec3(0.0, 27.2, 0.0)) + snoise(p - dz + vec3(0.0, 27.2, 0.0));
  float y = snoise(p + dz) - snoise(p - dz) - snoise(p + dx + vec3(31.4, 0.0, 0.0)) + snoise(p - dx + vec3(31.4, 0.0, 0.0));
  float z = snoise(p + dx + vec3(0.0, 27.2, 0.0)) - snoise(p - dx + vec3(0.0, 27.2, 0.0)) - snoise(p + dy) + snoise(p - dy);
  return vec3(x, y, z) / (2.0 * e);
}
`;

// Everything, in dependency order.
export const NOISE = HASH + SIMPLEX + FBM + WORLEY + CURL;
export default NOISE;
