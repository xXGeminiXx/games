// ---------------------------------------------------------------------------
// Post-processing passes. Each is a complete fragment shader for the
// full-screen triangle in gl.js: `fullscreen(gl, OUTLINE).draw({...})`.
//
// Every shader reads `u_tex` (the frame so far) and `u_res` (its size) and
// writes `fragColor`. A pass costs one full-screen draw; a game usually
// chains two or three. The strongest looks come from the least obvious
// chain: outline + halftone is a comic, kuwahara + grain is a painting,
// bloom + chromatic + vignette is every neon game ever made.
// ---------------------------------------------------------------------------

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_res;
`;

// Darkened corners. u_amount 0.3..0.8.
export const VIGNETTE = HEAD + `
uniform float u_amount;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  vec2 q = v_uv * (1.0 - v_uv);
  float v = pow(q.x * q.y * 15.0, u_amount);
  fragColor = vec4(c * v, 1.0);
}`;

// Film grain that moves. u_time, u_amount 0.02..0.1.
export const GRAIN = HEAD + `
uniform float u_time;
uniform float u_amount;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  float g = hash(v_uv * u_res + fract(u_time) * 1000.0) - 0.5;
  // grain shows in the midtones, not in the blacks or the whites
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += g * u_amount * (1.0 - abs(lum * 2.0 - 1.0));
  fragColor = vec4(c, 1.0);
}`;

// Colour fringing that grows toward the edges. u_amount in pixels, 2..8.
export const CHROMATIC = HEAD + `
uniform float u_amount;
void main() {
  vec2 d = (v_uv - 0.5) * u_amount / u_res;
  float r = texture(u_tex, v_uv + d).r;
  float g = texture(u_tex, v_uv).g;
  float b = texture(u_tex, v_uv - d).b;
  fragColor = vec4(r, g, b, 1.0);
}`;

// Ink outlines from a depth and normal buffer. u_depth and u_normal are
// textures the scene pass wrote (depth as linear distance in .r, normal in
// .rgb); the line is drawn where either changes sharply. u_ink is the line
// colour, u_width in pixels, u_depthK / u_normalK thresholds.
export const OUTLINE = HEAD + `
uniform sampler2D u_depth;
uniform sampler2D u_normal;
uniform vec3 u_ink;
uniform float u_width;
uniform float u_depthK;
uniform float u_normalK;
void main() {
  vec2 px = u_width / u_res;
  float d0 = texture(u_depth, v_uv).r;
  vec3 n0 = texture(u_normal, v_uv).rgb * 2.0 - 1.0;
  float dEdge = 0.0, nEdge = 0.0;
  vec2 offs[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
  for (int i = 0; i < 4; i++) {
    float d = texture(u_depth, v_uv + offs[i]).r;
    vec3 n = texture(u_normal, v_uv + offs[i]).rgb * 2.0 - 1.0;
    dEdge += abs(d - d0) / max(d0, 0.001);
    nEdge += 1.0 - dot(n, n0);
  }
  float edge = max(smoothstep(u_depthK, u_depthK * 2.0, dEdge), smoothstep(u_normalK, u_normalK * 2.0, nEdge));
  vec3 c = texture(u_tex, v_uv).rgb;
  fragColor = vec4(mix(c, u_ink, edge), 1.0);
}`;

// Kuwahara filter: the painted look. Each pixel takes the mean of the least
// varied of four neighbouring quadrants, so flat areas smooth out and edges
// stay crisp, like brush strokes. u_radius 2..6 (cost grows with the square).
export const KUWAHARA = HEAD + `
uniform int u_radius;
void main() {
  vec2 px = 1.0 / u_res;
  float n = float((u_radius + 1) * (u_radius + 1));
  vec3 mean[4]; vec3 sq[4];
  for (int k = 0; k < 4; k++) { mean[k] = vec3(0.0); sq[k] = vec3(0.0); }
  for (int j = -8; j <= 0; j++) for (int i = -8; i <= 0; i++) {
    if (j < -u_radius || i < -u_radius) continue;
    vec3 c = texture(u_tex, v_uv + vec2(float(i), float(j)) * px).rgb; mean[0] += c; sq[0] += c * c;
  }
  for (int j = -8; j <= 0; j++) for (int i = 0; i <= 8; i++) {
    if (j < -u_radius || i > u_radius) continue;
    vec3 c = texture(u_tex, v_uv + vec2(float(i), float(j)) * px).rgb; mean[1] += c; sq[1] += c * c;
  }
  for (int j = 0; j <= 8; j++) for (int i = 0; i <= 8; i++) {
    if (j > u_radius || i > u_radius) continue;
    vec3 c = texture(u_tex, v_uv + vec2(float(i), float(j)) * px).rgb; mean[2] += c; sq[2] += c * c;
  }
  for (int j = 0; j <= 8; j++) for (int i = -8; i <= 0; i++) {
    if (j > u_radius || i < -u_radius) continue;
    vec3 c = texture(u_tex, v_uv + vec2(float(i), float(j)) * px).rgb; mean[3] += c; sq[3] += c * c;
  }
  float minVar = 1e9; vec3 out_ = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    mean[k] /= n; sq[k] = abs(sq[k] / n - mean[k] * mean[k]);
    float v = sq[k].r + sq[k].g + sq[k].b;
    if (v < minVar) { minVar = v; out_ = mean[k]; }
  }
  fragColor = vec4(out_, 1.0);
}`;

// Halftone dots on a rotated grid, the print look. u_scale = dot pitch in
// pixels (6..14), u_angle radians, u_paper / u_ink colours.
export const HALFTONE = HEAD + `
uniform float u_scale;
uniform float u_angle;
uniform vec3 u_paper;
uniform vec3 u_ink;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 p = v_uv * u_res;
  float s = sin(u_angle), co = cos(u_angle);
  p = mat2(co, -s, s, co) * p;
  vec2 cell = fract(p / u_scale) - 0.5;
  float r = sqrt(1.0 - lum) * 0.75;
  float d = length(cell);
  float dot_ = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
  // keep a hint of the source colour inside the dot
  vec3 inkCol = mix(u_ink, c, 0.25);
  fragColor = vec4(mix(u_paper, inkCol, dot_), 1.0);
}`;

// Bloom, in two shaders. Downsample with a threshold (run into a half-size
// target), blur and upsample (run back up), then composite. u_threshold is
// the brightness that glows.
export const BLOOM_DOWN = HEAD + `
uniform float u_threshold;
void main() {
  vec2 px = 1.0 / u_res;
  vec3 c = vec3(0.0);
  c += texture(u_tex, v_uv + px * vec2(-1.0, -1.0)).rgb;
  c += texture(u_tex, v_uv + px * vec2(1.0, -1.0)).rgb;
  c += texture(u_tex, v_uv + px * vec2(-1.0, 1.0)).rgb;
  c += texture(u_tex, v_uv + px * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(u_threshold, u_threshold + 0.3, lum);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLOOM_UP = HEAD + `
uniform float u_spread;
void main() {
  vec2 px = u_spread / u_res;
  vec3 c = vec3(0.0);
  c += texture(u_tex, v_uv + px * vec2(-1.0, -1.0)).rgb * 1.0;
  c += texture(u_tex, v_uv + px * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(u_tex, v_uv + px * vec2(1.0, -1.0)).rgb * 1.0;
  c += texture(u_tex, v_uv + px * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(u_tex, v_uv).rgb * 4.0;
  c += texture(u_tex, v_uv + px * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(u_tex, v_uv + px * vec2(-1.0, 1.0)).rgb * 1.0;
  c += texture(u_tex, v_uv + px * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(u_tex, v_uv + px * vec2(1.0, 1.0)).rgb * 1.0;
  fragColor = vec4(c / 16.0, 1.0);
}`;

// Add the bloom back over the frame with a strength.
export const COMPOSITE = HEAD + `
uniform sampler2D u_bloom;
uniform float u_strength;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb + texture(u_bloom, v_uv).rgb * u_strength;
  fragColor = vec4(c, 1.0);
}`;

// Straight copy, for resolving a float target to the screen.
export const BLIT = HEAD + `
void main() { fragColor = vec4(texture(u_tex, v_uv).rgb, 1.0); }`;

// Pixel-size scanline / phosphor is deliberately absent: retro CRT looks
// read as pixel art, which is not a direction these games take.

export default { VIGNETTE, GRAIN, CHROMATIC, OUTLINE, KUWAHARA, HALFTONE, BLOOM_DOWN, BLOOM_UP, COMPOSITE, BLIT };
