// The GPU side of the island: the land as textures, the drones as textures,
// and the picture raymarched from both. All constants are baked from config.
import { NOISE, HASH } from './noise.glsl.js?v=17';
import { LIGHT } from './light.glsl.js?v=17';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 v_uv;
`;
const OUT = `out vec4 fragColor;
`;

export function makeShaders(cfg) {
  const W = cfg.world;
  const C = `
const float WORLD = ${W.size.toFixed(1)};
const float HEIGHT = ${W.height.toFixed(1)};
const float SEA = ${W.sea.toFixed(1)};
const float SNOW = ${(W.height * W.snowLine).toFixed(1)};
vec2 worldUv(vec2 xz) { return xz / WORLD + 0.5; }
vec2 uvWorld(vec2 uv) { return (uv - 0.5) * WORLD; }
`;

  // ---- the island: height in r (0..1 of HEIGHT), moisture in g ------------
  const HEIGHT_FS = HEAD + OUT + C + NOISE + `
uniform float u_seed;
uniform float u_island;
void main() {
  vec2 xz = uvWorld(v_uv);
  vec2 p = xz * 0.0055 + u_seed;
  float rim = 1.0 - smoothstep(0.33, 0.5, length(v_uv - 0.5));
  float cont = fbm(p * 0.55, 3) * 0.5 + 0.5;
  float ridge = ridged(p * 0.95 + 3.1, 5);
  float ranges = smoothstep(0.45, 0.78, cont);
  float h = 0.02 + cont * 0.58 + ridge * ridge * (0.5 + 0.08 * u_island) * ranges;
  h += ridged(p * 2.6 + 7.7, 4) * 0.1 * ranges;
  h += fbm(p * 3.0, 6) * 0.04;
  // inlets: a warped channel field bites bays into the coast
  float bays = smoothstep(0.52, 0.6, warp(p * 1.3 + 20.0, 1.5) * 0.5 + 0.5);
  h -= bays * 0.16;
  h *= rim;
  // cliff coasts: where a slow noise says cliff, the shore rises sharply
  float seaFrac = SEA / HEIGHT;
  float cliff = smoothstep(0.55, 0.7, fbm(p * 0.8 + 40.0, 3) * 0.5 + 0.5);
  if (h > seaFrac) {
    float above = h - seaFrac;
    h = seaFrac + above * (1.0 + 2.2 * cliff * (1.0 - smoothstep(0.0, 0.08, above)));
  }
  h = clamp(h, 0.0, 1.0);
  float moisture = fbm(p * 2.1 + 10.0, 4) * 0.5 + 0.5;
  fragColor = vec4(h, moisture, 0.0, 1.0);
}`;

  // ---- what the land can hold: ore, timber, fish, ice as rgba ------------
  const SUIT_FS = HEAD + OUT + C + NOISE + `
uniform sampler2D u_height;
uniform float u_seed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_height, 0));
  vec2 hm = texture(u_height, v_uv).rg;
  float h = hm.r * HEIGHT;
  float hx = (texture(u_height, v_uv + vec2(px.x, 0.0)).r - texture(u_height, v_uv - vec2(px.x, 0.0)).r) * HEIGHT;
  float hy = (texture(u_height, v_uv + vec2(0.0, px.y)).r - texture(u_height, v_uv - vec2(0.0, px.y)).r) * HEIGHT;
  float cell = WORLD * px.x * 2.0;
  float slope = clamp(length(vec2(hx, hy)) / cell, 0.0, 3.0);
  float m = hm.g;
  vec2 xz = uvWorld(v_uv);
  float patchy = fbm(xz * 0.03 + u_seed, 3) * 0.5 + 0.5;
  float ore = smoothstep(0.35, 0.9, slope) * smoothstep(SEA + 6.0, SEA + 14.0, h) * (0.5 + 0.5 * patchy);
  float timber = smoothstep(SEA + 1.5, SEA + 5.0, h) * (1.0 - smoothstep(SEA + 22.0, SEA + 30.0, h)) * smoothstep(0.35, 0.6, m) * (1.0 - smoothstep(0.3, 0.6, slope));
  float fish = smoothstep(SEA - 16.0, SEA - 9.0, h) * (1.0 - smoothstep(SEA - 1.2, SEA - 0.2, h)) * (0.4 + 0.6 * (fbm(xz * 0.05 + 5.0 + u_seed, 3) * 0.5 + 0.5));
  float ice = smoothstep(SNOW - 3.0, SNOW + 4.0, h) * (1.0 - smoothstep(0.7, 1.2, slope));
  fragColor = clamp(vec4(ore, timber, fish, ice), 0.0, 1.0);
}`;

  // ---- the live richness: stripped by the harvest, regrown toward full ----
  const RICH_FS = HEAD + OUT + C + `
uniform sampler2D u_rich;
uniform sampler2D u_suit;
uniform sampler2D u_harvest;
uniform float u_dt;
uniform float u_take;
uniform float u_regrow;
uniform float u_bulk;       // an offline strip: fraction removed within range, once
uniform vec2 u_carrier;
uniform float u_range;
void main() {
  vec4 r = texture(u_rich, v_uv);
  vec4 full = texture(u_suit, v_uv);
  vec4 h = texture(u_harvest, v_uv);
  r -= h * u_take;
  r += (full - r) * u_regrow * u_dt;
  if (u_bulk > 0.0 && distance(uvWorld(v_uv), u_carrier) < u_range) r *= (1.0 - u_bulk);
  fragColor = clamp(r, vec4(0.0), full);
}`;

  const INIT_RICH_FS = HEAD + OUT + `
uniform sampler2D u_suit;
void main() { fragColor = texture(u_suit, v_uv); }`;

  // ---- the drones ---------------------------------------------------------
  // pos: xyz, w = base kind (0..3 specialist, 4 generalist)
  // aux: x = state + 10 * trip kind (0 out, 1 gather, 2 return, 3 docked), y = timer, zw = target xz
  const DRONE_COMMON = C + HASH + `
uniform sampler2D u_pos;
uniform sampler2D u_aux;
uniform sampler2D u_kind;
uniform sampler2D u_height;
uniform sampler2D u_rich;
uniform vec3 u_carrier;
uniform float u_range;
uniform float u_active;
uniform float u_speed;
uniform float u_dt;
uniform float u_time;
uniform float u_gatherTime;
uniform float u_dockTime;
uniform float u_cruise;
uniform float u_hover;
uniform float u_minRich;
uniform float u_texW;
float ground(vec2 xz) { return texture(u_height, worldUv(xz)).r * HEIGHT; }
vec4 kindMask(int k) { return k == 0 ? vec4(1.0, 0.0, 0.0, 0.0) : k == 1 ? vec4(0.0, 1.0, 0.0, 0.0) : k == 2 ? vec4(0.0, 0.0, 1.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0); }
`;

  const DRONE_SIM_FS = HEAD + DRONE_COMMON + `
layout(location = 0) out vec4 o_pos;
layout(location = 1) out vec4 o_aux;
void main() {
  vec2 cell = floor(v_uv * u_texW);
  float id = cell.y * u_texW + cell.x;
  vec4 pos = texture(u_pos, v_uv);
  vec4 aux = texture(u_aux, v_uv);
  int baseKind = int(floor(texture(u_kind, v_uv).r * 255.0 + 0.5) / 50.0 + 0.5);
  vec3 p = pos.xyz;
  int state = int(mod(aux.x, 10.0));
  int tripKind = int(floor(aux.x / 10.0));
  float timer = aux.y;
  vec2 target = aux.zw;
  if (id >= u_active) {
    // not launched: sits inside the carrier
    o_pos = vec4(u_carrier, float(baseKind));
    o_aux = vec4(3.0, 0.0, u_carrier.xz);
    return;
  }
  if (state == 3) {
    timer -= u_dt;
    p = mix(p, u_carrier, min(1.0, u_dt * 4.0));
    if (timer <= 0.0) {
      // choose where to go: a few random cells within range, the richest wins
      float best = 0.0; vec2 bestXz = u_carrier.xz; int bestKind = baseKind == 4 ? 0 : baseKind;
      for (int i = 0; i < 6; i++) {
        vec2 r2 = hash22(vec2(id * 0.731 + float(i) * 13.7, u_time * 7.0 + float(i)));
        float ang = r2.x * 6.2831853, rad = u_range * sqrt(r2.y);
        vec2 c = u_carrier.xz + vec2(cos(ang), sin(ang)) * rad;
        if (abs(c.x) > WORLD * 0.49 || abs(c.y) > WORLD * 0.49) continue;
        vec4 rich = texture(u_rich, worldUv(c));
        if (baseKind == 4) {
          // a generalist takes whatever is richest here
          for (int k = 0; k < 4; k++) { float v = dot(rich, kindMask(k)); if (v > best) { best = v; bestXz = c; bestKind = k; } }
        } else {
          float v = dot(rich, kindMask(baseKind));
          if (v > best) { best = v; bestXz = c; }
        }
      }
      if (best >= u_minRich) { state = 0; target = bestXz; tripKind = bestKind; }
      else timer = 0.8;
    }
  } else if (state == 0) {
    vec2 d = target - p.xz;
    float dist = length(d);
    vec2 dir = dist > 0.001 ? d / dist : vec2(0.0);
    float step_ = min(dist, u_speed * u_dt);
    p.xz += dir * step_;
    float want = ground(p.xz) + u_cruise + 2.0 * sin(id * 0.37);
    want = max(want, SEA + 3.0);
    p.y += (want - p.y) * min(1.0, u_dt * 2.5);
    if (dist < 1.5) { state = 1; timer = u_gatherTime; }
  } else if (state == 1) {
    timer -= u_dt;
    // a slow circle over the cell
    float a = u_time * 2.0 + id;
    vec2 ring = target + vec2(cos(a), sin(a)) * 1.2;
    p.xz += (ring - p.xz) * min(1.0, u_dt * 3.0);
    float want = max(ground(target), SEA) + u_hover;
    p.y += (want - p.y) * min(1.0, u_dt * 3.0);
    if (timer <= 0.0) state = 2;
  } else {
    vec2 d = u_carrier.xz - p.xz;
    float dist = length(d);
    vec2 dir = dist > 0.001 ? d / dist : vec2(0.0);
    p.xz += dir * min(dist, u_speed * u_dt);
    float want = mix(ground(p.xz) + u_cruise, u_carrier.y, smoothstep(30.0, 4.0, dist));
    want = max(want, SEA + 3.0);
    p.y += (want - p.y) * min(1.0, u_dt * 2.5);
    if (dist < 2.5) { state = 3; timer = u_dockTime; }
  }
  o_pos = vec4(p, float(baseKind));
  o_aux = vec4(float(state) + 10.0 * float(tripKind), timer, target);
}`;

  // harvest: every gathering drone lays a point of its trip kind on the land
  const HARVEST_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_pos;
uniform sampler2D u_aux;
uniform int u_w;
uniform float u_active;
out vec4 v_mask;
const float WORLD = ${W.size.toFixed(1)};
void main() {
  int id = gl_VertexID;
  ivec2 c = ivec2(id % u_w, id / u_w);
  vec4 pos = texelFetch(u_pos, c, 0);
  vec4 aux = texelFetch(u_aux, c, 0);
  int state = int(mod(aux.x, 10.0));
  int k = int(floor(aux.x / 10.0));
  v_mask = k == 0 ? vec4(1.0, 0.0, 0.0, 0.0) : k == 1 ? vec4(0.0, 1.0, 0.0, 0.0) : k == 2 ? vec4(0.0, 0.0, 1.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0);
  if (state != 1 || float(id) >= u_active) { gl_Position = vec4(3.0, 3.0, 0.0, 1.0); gl_PointSize = 1.0; return; }
  vec2 uv = aux.zw / WORLD + 0.5;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 3.0;
}`;
  const HARVEST_FS = `#version 300 es
precision highp float;
in vec4 v_mask;
out vec4 fragColor;
uniform float u_amount;
void main() { float d = length(gl_PointCoord - 0.5); fragColor = v_mask * u_amount * (1.0 - smoothstep(0.2, 0.5, d)); }`;

  const DRONE_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 a_pos;
in vec3 a_nrm;
in float a_shade;
uniform sampler2D u_pos;
uniform sampler2D u_aux;
uniform int u_texW;
uniform float u_active;
uniform mat4 u_viewProj;
uniform float u_size;
uniform float u_time;
uniform vec3 u_carrier;
out vec3 v_nrm;
out float v_dist;
out float v_loaded;
out float v_shade;
void main() {
  int id = gl_InstanceID;
  v_shade = a_shade;
  ivec2 c = ivec2(id % u_texW, id / u_texW);
  vec4 s = texelFetch(u_pos, c, 0);
  vec4 a = texelFetch(u_aux, c, 0);
  int state = int(mod(a.x, 10.0));
  if (float(id) >= u_active || state == 3) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); v_nrm = vec3(0.0, 1.0, 0.0); v_dist = 1.0; v_loaded = 0.0; return; }
  // face where it is going
  vec2 goal = state == 2 ? u_carrier.xz : a.zw;
  vec2 d = goal - s.xz;
  float ang = (state == 1) ? u_time * 2.0 + float(id) : atan(d.x, d.y);
  float cs = cos(ang), sn = sin(ang);
  vec3 lp = a_pos * u_size;
  lp.y += 0.15 * sin(u_time * 5.0 + float(id));
  vec3 rp = vec3(cs * lp.x + sn * lp.z, lp.y, -sn * lp.x + cs * lp.z);
  vec3 wp = s.xyz + rp;
  v_nrm = vec3(cs * a_nrm.x + sn * a_nrm.z, a_nrm.y, -sn * a_nrm.x + cs * a_nrm.z);
  vec4 clip = u_viewProj * vec4(wp, 1.0);
  v_dist = clip.w;
  v_loaded = state == 2 ? 1.0 : 0.0;
  gl_Position = clip;
}`;
  const DRONE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 v_nrm;
in float v_dist;
in float v_loaded;
in float v_shade;
out vec4 fragColor;
uniform vec3 u_sun;
uniform vec3 u_col;
uniform vec3 u_colLoaded;
uniform vec3 u_colTrim;
uniform vec3 u_fog;
uniform float u_fogK;
` + LIGHT + `
void main() {
  float dif = wrapDiffuse(v_nrm, u_sun, 0.4);
  // the body takes the fleet colour; the canopy and the rotors take the trim
  vec3 body = mix(u_col, u_colLoaded, v_loaded);
  vec3 col = mix(body, u_colTrim, v_shade) * (0.45 + 0.75 * dif);
  col = mix(col, u_fog, fogExp(v_dist, u_fogK));
  fragColor = vec4(col, 1.0);
}`;

  // ---- the carrier: a few lit parts -----------------------------------------
  const PART_VS = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec3 a_nrm;
in vec4 a_col;
uniform mat4 u_model;
uniform mat4 u_viewProj;
out vec3 v_nrm;
out float v_dist;
out vec3 v_wp;
out vec4 v_col;
void main() {
  vec4 wp = u_model * vec4(a_pos, 1.0);
  v_wp = wp.xyz;
  v_nrm = normalize(mat3(u_model) * a_nrm);
  v_col = a_col;
  vec4 clip = u_viewProj * wp;
  v_dist = clip.w;
  gl_Position = clip;
}`;
  const PART_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 v_nrm;
in float v_dist;
in vec3 v_wp;
in vec4 v_col;
out vec4 fragColor;
uniform vec3 u_sun;
uniform vec3 u_colDark;
uniform vec3 u_fog;
uniform vec3 u_eye;
uniform float u_fogK;
` + LIGHT + `
void main() {
  vec3 n = normalize(v_nrm);
  vec3 v = normalize(u_eye - v_wp);
  float dif = wrapDiffuse(n, u_sun, 0.3);
  // Each piece carries its own colour; the shaded side falls toward the
  // ship's dark rather than toward black, so panel lines stay readable.
  vec3 col = mix(v_col.rgb * u_colDark * 2.0, v_col.rgb, dif);
  col += vec3(1.0) * specular(n, u_sun, v, 60.0) * 0.22;
  col += u_fog * fresnel(n, v, 3.0) * 0.22;
  // windows and lamps burn through the shading and hold their colour in haze
  float lit = v_col.a;
  col = mix(col, v_col.rgb * 1.25, lit);
  col = mix(col, u_fog, fogExp(v_dist, u_fogK) * (1.0 - 0.7 * lit));
  fragColor = vec4(col, 1.0);
}`;

  // ---- the picture ----------------------------------------------------------
  const TERRAIN_FS = HEAD + OUT + C + NOISE + LIGHT + `
uniform sampler2D u_height;
uniform sampler2D u_rich;
uniform sampler2D u_suit;
uniform vec3 u_ro;
uniform vec3 u_fwd;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_aspect;
uniform float u_tanFov;
uniform mat4 u_viewProj;
uniform float u_time;
uniform vec3 u_sun;
uniform vec2 u_carrier;
uniform float u_range;
uniform float u_fogK;
uniform vec3 u_sea, u_seaShallow, u_foam, u_sand, u_chalk, u_rock, u_scree, u_scrub, u_pine, u_stump, u_snow, u_bareIce;
uniform vec3 u_zenith, u_horizon, u_sunCol, u_fogCol, u_accent;

float terrain(vec2 xz) {
  float h = texture(u_height, worldUv(xz)).r * HEIGHT;
  float land = smoothstep(SEA - 2.0, SEA + 4.0, h);
  h += (0.14 * snoise(xz * 0.7) + 0.05 * snoise(xz * 2.3)) * land;
  return h;
}
vec3 terrainNormal(vec2 xz, float t) {
  float e = 0.35 + 0.004 * t;
  return normalize(vec3(terrain(xz - vec2(e, 0.0)) - terrain(xz + vec2(e, 0.0)), 2.0 * e, terrain(xz - vec2(0.0, e)) - terrain(xz + vec2(0.0, e))));
}
float marchTerrain(vec3 ro, vec3 rd, float tmin, float tmax) {
  float lh = 0.0, ly = 0.0, t = tmin, dt = 0.6;
  for (int i = 0; i < 240; i++) {
    vec3 p = ro + rd * t;
    float h = terrain(p.xz);
    if (p.y < h) return t - dt + dt * (lh - ly) / (p.y - ly - h + lh);
    if (p.y > HEIGHT + 4.0 && rd.y > 0.0) return -1.0;
    dt = max(0.45, 0.011 * t);
    lh = h; ly = p.y; t += dt;
    if (t > tmax) break;
  }
  return -1.0;
}
float sunShadow(vec3 p) {
  float t = 1.5, res = 1.0;
  for (int i = 0; i < 24; i++) {
    vec3 q = p + u_sun * t;
    float h = terrain(q.xz);
    res = min(res, 5.0 * (q.y - h) / t);
    if (res < 0.01 || q.y > HEIGHT + 2.0) break;
    t += clamp(q.y - h, 0.6, 6.0);
  }
  return clamp(res, 0.0, 1.0);
}
vec3 sky(vec3 rd) {
  vec3 s = skyGradient(rd, u_sun, u_zenith, u_horizon, u_sunCol);
  if (rd.y > 0.02) {
    vec2 cp = rd.xz / rd.y * 2.5 + u_time * 0.015;
    float c = fbm(cp, 4) * 0.5 + 0.5;
    c = smoothstep(0.5, 0.8, c) * smoothstep(0.0, 0.2, rd.y);
    s = mix(s, mix(u_horizon, vec3(1.0), 0.5), c * 0.6);
  }
  return s;
}
void main() {
  vec2 sc = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0) * u_tanFov;
  vec3 rd = normalize(u_fwd + sc.x * u_right + sc.y * u_up);
  vec3 ro = u_ro;
  float tmax = 1500.0;
  float t = marchTerrain(ro, rd, 0.3, tmax);
  float tw = (rd.y < -0.0001) ? (SEA - ro.y) / rd.y : -1.0;
  bool water = tw > 0.0 && (t < 0.0 || tw < t);
  vec3 col, p;
  if (t < 0.0 && !water) { fragColor = vec4(sky(rd), 1.0); gl_FragDepth = 1.0; return; }
  if (water) {
    t = tw; p = ro + rd * t;
    vec2 w = vec2(snoise(p.xz * 0.5 + u_time * 0.3), snoise(p.xz * 0.5 + 7.0 - u_time * 0.25)) * 0.03;
    vec3 n = normalize(vec3(w.x, 1.0, w.y));
    vec3 refl = reflect(rd, n); refl.y = abs(refl.y);
    float bottom = terrain(p.xz);
    float depth = clamp((SEA - bottom) / 9.0, 0.0, 1.0);
    vec3 deep = mix(u_seaShallow, u_sea, depth);
    // shoals: where fish are rich the shallows dapple
    float fish = texture(u_rich, worldUv(p.xz)).b;
    deep = mix(deep, u_foam * 0.8, fish * (0.5 + 0.5 * snoise(p.xz * 0.9 + u_time * 0.5)) * 0.35 * (1.0 - depth));
    float f = fresnel(n, -rd, 4.0) * 0.85 + 0.1;
    col = mix(deep, sky(refl), f);
    // foam at the shore
    float foam = (1.0 - smoothstep(0.0, 1.6, SEA - bottom)) * (0.6 + 0.4 * snoise(p.xz * 1.5 + u_time * 0.8));
    col = mix(col, u_foam, clamp(foam, 0.0, 1.0) * 0.8);
    col += u_sunCol * specular(n, u_sun, -rd, 500.0) * 1.2;
  } else {
    p = ro + rd * t;
    vec3 n = terrainNormal(p.xz, t);
    float h = p.y, slope = 1.0 - n.y;
    vec2 uv = worldUv(p.xz);
    vec4 rich = texture(u_rich, uv);
    vec4 full = max(texture(u_suit, uv), vec4(0.001));
    vec4 frac = clamp(rich / full, 0.0, 1.0);
    float m = texture(u_height, uv).g;
    float grain = fbm(p.xz * 0.05, 3) * 0.5 + 0.5;
    // the land: scrub, pine where timber stands, stumps where it was taken
    vec3 base = u_scrub * (0.85 + 0.3 * grain);
    float timber = full.g;
    vec3 wood = mix(u_stump, u_pine, frac.g);
    base = mix(base, wood, smoothstep(0.15, 0.6, timber));
    // rock: pale chalk on coastal cliffs, dark scree where ore stands, pale rock where it was taken
    vec3 rock = mix(u_chalk, u_rock, smoothstep(SEA + 18.0, SEA + 30.0, h));
    vec3 oreRock = mix(u_rock, u_scree, frac.r);
    rock = mix(rock, oreRock, smoothstep(0.2, 0.7, full.r));
    base = mix(base, rock, smoothstep(0.3, 0.6, slope));
    // sand at the waterline
    base = mix(base, u_sand, (1.0 - smoothstep(SEA + 0.3, SEA + 2.4, h)) * (1.0 - smoothstep(0.25, 0.5, slope)));
    // snow above the line, bare ice where the ice was taken
    vec3 ice = mix(u_bareIce, u_snow, frac.a);
    base = mix(base, ice, smoothstep(0.2, 0.8, full.a) * (1.0 - smoothstep(0.5, 0.9, slope)));
    float sh = sunShadow(p + n * 0.3);
    float dif = wrapDiffuse(n, u_sun, 0.25);
    vec3 light = u_sunCol * dif * sh * 1.35;
    light += hemiLight(n, u_zenith, u_sand * 0.4) * 0.42;
    col = base * light;
    col += u_sunCol * fresnel(n, -rd, 3.0) * 0.06 * sh;
    // the working radius, drawn on the ground
    float ring = abs(distance(p.xz, u_carrier) - u_range);
    col = mix(col, u_accent, (1.0 - smoothstep(0.3, 1.0, ring)) * 0.55);
  }
  // morning haze: distance fog, thicker near the water
  float fogK = fogExp(t, u_fogK);
  float bank = (1.0 - smoothstep(SEA + 1.0, SEA + 9.0, p.y)) * (0.5 + 0.5 * (fbm(p.xz * 0.02 + u_time * 0.01, 3) * 0.5 + 0.5));
  fogK = max(fogK, bank * 0.4 * smoothstep(40.0, 160.0, t));
  vec3 fogCol = mix(u_fogCol, u_sunCol, pow(clamp(dot(rd, u_sun), 0.0, 1.0), 8.0) * 0.4);
  col = mix(col, fogCol, fogK);
  vec4 clip = u_viewProj * vec4(p, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  fragColor = vec4(col, 1.0);
}`;

  const RESOLVE_FS = HEAD + OUT + LIGHT + `
uniform sampler2D u_tex;
uniform float u_exposure;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb * u_exposure;
  c = tonemapACES(c);
  // a breath of cold air: lift the blacks a touch
  c = c * 0.97 + 0.015;
  fragColor = vec4(c, 1.0);
}`;

  const BLIT_FS = HEAD + OUT + `
uniform sampler2D u_tex;
void main() { fragColor = texture(u_tex, v_uv); }`;

  return { HEIGHT_FS, SUIT_FS, RICH_FS, INIT_RICH_FS, DRONE_SIM_FS, HARVEST_VS, HARVEST_FS, DRONE_VS, DRONE_FS, PART_VS, PART_FS, TERRAIN_FS, RESOLVE_FS, BLIT_FS };
}
