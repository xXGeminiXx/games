// ---------------------------------------------------------------------------
// Every surface on the machine, as shader source.
//
// The rule the FACE is written to: nothing on it emits light. Each material
// behind the glass is told where the lamp is and works out what it reflects,
// so a bright pixel on the playfield is always brass, chrome, enamel or glass
// catching one source hung above and slightly left of it. There is no bloom
// pass over the face and no additive blending on it.
//
// The cabinet around the glass is the opposite, and has to be: side lamps, the
// topper and the show screen are lit signs, and a lit sign that only reflects
// is a dead sign. Those emit, they are the only things that do, and the bezel
// between them and the playfield is what keeps the two readings apart.
//
// The face is painted a saturated, LIGHT colour, which is what the genre
// actually looks like and is also forced: sRGB cannot hold a vivid cyan or
// gold at low lightness. Every gain below is balanced for materials that sit
// between L 0.5 and L 0.9, where the danger is clipping rather than mud, so
// the broad speculars are small and the tight ones carry the gloss.
//
// Shapes are distance fields evaluated per pixel rather than triangles, which
// is what lets a pin be a turned cylinder with a rolled rim, and a ball a
// sphere with a hard highlight, out of a four vertex quad. Edges are
// antialiased from the derivative of the field, so the picture stays clean
// with no multisampling to pay for.
//
// One vertex shader serves the pins, pockets, hit marks and the counter,
// because they are all a rectangle in board units with a payload. Rails need
// their own because they rotate, and balls need their own because their
// positions arrive as five separate arrays that go to the GPU untouched.
// ---------------------------------------------------------------------------

import { digitGlsl } from './digits.js?v=66';
import { marqueeGlsl, MAX_LETTERS } from './marquee.js?v=66';

// ---- shared ---------------------------------------------------------------

const HEAD = `#version 300 es
precision highp float;
`;

// Lighting, colour and the distance fields every pass draws with.
const COMMON = `
uniform vec3  u_lamp;      // the lamp's colour, linear light
uniform vec4  u_lampPos;   // board xy, height above the face, gain
uniform vec2  u_board;     // the face, in board units
uniform float u_encode;    // 1 when the target stores sRGB bytes
uniform float u_reflect;   // 1 when second bounce light is being paid for
uniform float u_time;
uniform vec3  u_lacquer;
uniform vec3  u_brass;
uniform vec3  u_chrome;
uniform vec3  u_enamel;
uniform vec3  u_oxblood;
uniform vec3  u_screen;   // the field the show plays on
uniform vec3  u_glow;     // the hot accent the machine escalates with
uniform vec3  u_shell;    // the moulded cabinet body
uniform vec3  u_room;     // the dark the cabinet stands in
uniform vec4  u_show;     // intensity, revival, win, skin index
uniform vec4  u_parts;    // parts bolted in: on the nails, on the slot, on the rails, on the glass

const vec3 VIEW = vec3(0.0, 0.0, 1.0);

vec3 linearToSrgb3(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec4 outColour(vec3 lin, float a) {
  return vec4(mix(lin, linearToSrgb3(lin), u_encode), a);
}

// The unit vector from a point on the face toward the lamp. Board y runs
// downward, so the lamp sitting above the face has a negative y.
vec3 lampDir(vec2 p) {
  return normalize(vec3(u_lampPos.xy - p, u_lampPos.z));
}

// How much of the lamp reaches a point. Distance is measured in board heights
// so a board described in millimetres and one described in tiles light alike.
float lampFall(vec2 p) {
  vec2 d = (p - u_lampPos.xy) / max(u_board.y, 1e-4);
  return u_lampPos.w / (1.0 + 1.25 * dot(d, d));
}

float specular(vec3 n, vec3 L, float power) {
  vec3 h = normalize(L + VIEW);
  return pow(max(dot(n, h), 0.0), power);
}

// Antialiased coverage of a distance field, from its own screen derivative.
float cover(float d) {
  float w = max(fwidth(d), 1e-6);
  return clamp(0.5 - d / w, 0.0, 1.0);
}

// Paint the top layer over the layer under it, both straight alpha.
vec4 over(vec4 under, vec4 top) {
  float a = top.a + under.a * (1.0 - top.a);
  vec3 c = (top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / max(a, 1e-5);
  return vec4(c, a);
}

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

// The rectangle instances: pins, pockets, hit marks, the counter window.
export const INSTANCE_VS = HEAD + `
in vec2 a_pos;      // unit quad, -0.5 to 0.5
in vec4 a_rect;     // centre xy, half size xy, board units
in vec4 a_data;     // payload, meaning depends on the pass
uniform vec4 u_xform;
uniform vec2 u_pad; // extra board units around the quad, for shadows and lips
out vec2 v_off;     // board units from the instance centre
out vec2 v_half;
out vec2 v_board;
out vec4 v_data;
void main() {
  vec2 hs = a_rect.zw + u_pad;
  v_off = a_pos * hs * 2.0;
  v_half = a_rect.zw;
  v_board = a_rect.xy + v_off;
  v_data = a_data;
  gl_Position = vec4(v_board * u_xform.xy + u_xform.zw, 0.0, 1.0);
}`;

// Rails and deflectors, which stand along a direction.
export const RAIL_VS = HEAD + `
in vec2 a_pos;
in vec4 a_rect;     // centre xy, half length, half thickness
in vec4 a_data;     // direction xy, kind, seed
uniform vec4 u_xform;
uniform vec2 u_pad;
out vec2 v_seg;     // board units along and across the rail
out vec2 v_ext;     // half length, half thickness
out vec2 v_board;
out vec2 v_perp;
out vec4 v_data;
void main() {
  vec2 dir = normalize(a_data.xy + vec2(1e-6, 0.0));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 hs = a_rect.zw + u_pad;
  v_seg = a_pos * hs * 2.0;
  v_ext = a_rect.zw;
  v_perp = perp;
  v_data = a_data;
  v_board = a_rect.xy + dir * v_seg.x + perp * v_seg.y;
  gl_Position = vec4(v_board * u_xform.xy + u_xform.zw, 0.0, 1.0);
}`;

// Balls. Five scalar attributes because the game hands over five separate
// arrays and they go to the card exactly as they are, with no gathering.
export const BALL_VS = HEAD + `
in vec2 a_pos;
in float a_x;
in float a_y;
in float a_vx;
in float a_vy;
in float a_spin;
uniform vec4 u_xform;
uniform float u_ballR;
uniform float u_grow;      // quad slack around the ball, for the soft edge
uniform float u_smear;     // how far speed is allowed to stretch the disc
uniform float u_smearK;    // board units per unit of speed
out vec2 v_disc;           // -1 to 1 in the ball's own frame
out vec2 v_dir;            // the direction the stretch runs in
out vec2 v_board;
out float v_spin;
out float v_speed;
void main() {
  vec2 v = vec2(a_vx, a_vy);
  float speed = length(v);
  vec2 dir = speed > 1e-4 ? v / speed : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float k = min(u_smear, speed * u_smearK);
  v_disc = a_pos * 2.0 * u_grow;
  v_dir = dir;
  v_spin = a_spin;
  v_speed = speed;
  vec2 local = dir * v_disc.x * (1.0 + k) + perp * v_disc.y * (1.0 - k * 0.3);
  v_board = vec2(a_x, a_y) + local * u_ballR;
  gl_Position = vec4(v_board * u_xform.xy + u_xform.zw, 0.0, 1.0);
}`;

// ---- the lacquer ground ---------------------------------------------------
export const GROUND_FS = HEAD + `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_res;    // the buffer being drawn into, in pixels
uniform vec4 u_fit;    // face origin xy in pixels, pixels per board unit
` + COMMON + `
void main() {
  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 p = (px - u_fit.xy) / max(u_fit.z, 1e-6);

  float corner = u_board.y * 0.012;
  float d = sdBox(p - u_board * 0.5, u_board * 0.5, corner);
  float inside = cover(d);

  vec3 L = lampDir(p);
  float fall = lampFall(p);
  vec3 n = vec3(0.0, 0.0, 1.0);

  // Deep lacquer: a dark body colour, a wide soft gloss, and the lamp's own
  // reflection sitting in it as a broad pool rather than a spot.
  vec3 lac = u_lacquer * (0.14 * u_lamp + 1.10 * u_lamp * fall * max(L.z, 0.0));
  lac += u_lamp * u_lacquer * specular(n, L, 9.0) * 0.30 * fall;
  lac += u_lamp * specular(n, L, 300.0) * 0.09 * fall;

  // The grain of the lacquer, and a faint sweep left by the brush under it.
  float grain = hash21(floor(px * 0.5)) - 0.5;
  float sweep = sin(p.x * 0.7 + p.y * 0.21) * sin(p.y * 0.9) * 0.5;
  lac *= 1.0 + grain * 0.035 + sweep * 0.020;

  // A wash of the machine's own accent across the top of the face, which is
  // how a cabinet this colour is actually painted - the paint is not flat, it
  // carries the livery. It climbs with the show, so the whole face lifts when
  // the machine is escalating rather than only the screen.
  float wash = smoothstep(u_board.y * 0.55, 0.0, p.y);
  lac = mix(lac, mix(lac, u_glow * (0.55 + 0.45 * fall), 0.085), wash);
  lac += u_glow * u_show.x * wash * 0.07 * fall;

  // ---- the livery ---------------------------------------------------------
  // What is painted on the face under the nails. A cabinet is not a colour, it
  // is a picture: the same six shapes of machine wear six different pictures,
  // and this is the part a player can tell apart from across the room. Every
  // shape is distance-field or noise in the face's own paint - a darker shade
  // and a lighter one - with the accent kept for one thing per picture, so the
  // nails and the balls still read on top of it.
  {
  int look = int(u_show.w + 0.5);
  float t = u_time;
  vec2 n = p / max(u_board, vec2(1e-4));
  vec2 a = vec2(n.x * u_board.x / max(u_board.y, 1e-4), n.y);
  float dark = 0.0, light = 0.0, acc = 0.0;

  if (look == 0) {
    // Tide Pool: a sun high on one side, and rows of swell across the lower
    // face, each crest catching the lamp.
    float wv = sin(a.x * 14.0 + t * 0.25) * 0.5 + sin(a.x * 23.0 - t * 0.17) * 0.25;
    float rowy = fract(n.y * 7.0 + wv * 0.10);
    float low = smoothstep(0.34, 0.58, n.y);
    light += smoothstep(0.10, 0.0, abs(rowy - 0.5)) * low * 0.55;
    dark += smoothstep(0.30, 0.12, abs(rowy - 0.5)) * smoothstep(0.10, 0.0, abs(rowy - 0.5) - 0.10) * low * 0.30;
    vec2 sc = a - vec2(0.70, 0.10);
    float sun = length(sc) - 0.085;
    light += smoothstep(0.012, 0.0, sun) * 0.9;
    float rayA = atan(sc.y, sc.x);
    light += pow(max(sin(rayA * 9.0 + t * 0.1), 0.0), 14.0) * smoothstep(0.0, 0.10, sun) * smoothstep(0.50, 0.0, sun) * 0.35;
  } else if (look == 1) {
    // Hot House: big leaves climbing both edges, a pale rib down each, and a
    // blossom or two in the accent where a stem ends.
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float side = i < 2 ? -1.0 : 1.0;
      float k = mod(fi, 2.0);
      vec2 c = vec2(0.431 + side * (0.30 + k * 0.08), 0.90 - k * 0.30 - (fi < 2.0 ? 0.0 : 0.12));
      float ang = side * (0.75 - k * 0.25) + sin(t * 0.3 + fi) * 0.03;
      vec2 d2 = a - c;
      vec2 r = vec2(cos(ang) * d2.x - sin(ang) * d2.y, sin(ang) * d2.x + cos(ang) * d2.y);
      float leaf = length(r / vec2(0.075, 0.17)) - 1.0;
      dark += smoothstep(0.05, 0.0, leaf) * 0.8;
      light += smoothstep(0.006, 0.0, abs(r.x)) * step(leaf, 0.0) * 0.55;
      // the veins
      light += smoothstep(0.004, 0.0, abs(fract(r.y * 9.0) - 0.5) - 0.02) * step(leaf, 0.0) * smoothstep(0.0, 0.03, abs(r.x)) * 0.18;
    }
    vec2 b1 = a - vec2(0.09, 0.17), b2 = a - vec2(0.77, 0.24);
    float blossom = min(length(b1) - 0.03, length(b2) - 0.026);
    acc += smoothstep(0.008, 0.0, blossom) * 0.9;
    dark += smoothstep(0.014, 0.0, abs(blossom) - 0.004) * 0.6;
  } else if (look == 2) {
    // Gold Rush: a sunburst off the top of the face, a river of the accent
    // across it, and nuggets heaped along the bottom.
    vec2 sc = a - vec2(0.431, -0.06);
    float ang = atan(sc.x, sc.y);
    float ray = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin(ang * 18.0 + t * 0.05));
    light += ray * 0.26 * smoothstep(0.85, 0.15, n.y);
    float river = abs(n.y - 0.79 - sin(a.x * 7.0 + 0.6) * 0.025) - 0.018;
    acc += smoothstep(0.008, 0.0, river) * 0.75;
    dark += smoothstep(0.012, 0.0, abs(river) - 0.006) * 0.5;
    vec2 g = vec2(a.x * 9.0, (n.y - 0.86) * 13.0);
    vec2 gi = floor(g), gf = fract(g) - 0.5;
    float band = step(0.86, n.y);
    float nug = length(gf + (vec2(hash21(gi), hash21(gi + 7.0)) - 0.5) * 0.4) - 0.26;
    light += smoothstep(0.04, 0.0, nug) * band * 0.7;
    dark += smoothstep(0.05, 0.0, abs(nug) - 0.03) * band * 0.4;
  } else if (look == 3) {
    // Blast Furnace: the face is riveted steel plate, and a hazard chevron runs
    // along the foot of it.
    float seam = abs(fract(n.y * 5.0 + 0.5) - 0.5);
    dark += smoothstep(0.022, 0.0, seam) * 0.75;
    light += smoothstep(0.045, 0.022, seam) * step(0.0, fract(n.y * 5.0 + 0.5) - 0.5) * 0.18;
    vec2 rv = vec2(fract(a.x * 11.0 + 0.5) - 0.5, seam * 5.0);
    float rivet = length(rv) - 0.09;
    light += smoothstep(0.05, 0.0, rivet) * 0.7;
    dark += smoothstep(0.05, 0.0, abs(rivet) - 0.03) * 0.5;
    float foot = step(0.93, n.y);
    float chev = step(0.5, fract((a.x + abs(n.y - 0.965) * 1.2) * 7.0));
    dark += foot * chev * 0.85;
  } else if (look == 4) {
    // Cherry Bomb: a jukebox. A bubble tube climbs the arch over the face
    // with bubbles rising through it, chrome trim runs the arch's rim, a
    // speaker grille of chrome bars crosses the foot, and the record deck
    // on the screen is the machine's heart.
    vec2 ac = vec2(0.431, 0.34);
    vec2 ar = vec2(0.40, 0.31);
    vec2 rel = (a - ac) / ar;
    float arch = length(rel) - 1.0;
    float upper = smoothstep(0.03, -0.02, a.y - ac.y - 0.02);
    float tube = abs(arch) - 0.05;
    float inTube = smoothstep(0.012, 0.0, tube) * upper;
    // the tube is the accent, lit brighter where a bubble passes
    float ang = atan(rel.y, rel.x);
    float bub = smoothstep(0.10, 0.0, abs(fract(ang * 2.2 - t * 0.35) - 0.5) - 0.02)
              * smoothstep(0.035, 0.0, abs(arch));
    acc += inTube * (0.45 + 0.55 * bub);
    light += inTube * bub * 0.5;
    // chrome rims either side of the tube
    dark += smoothstep(0.014, 0.0, abs(abs(arch) - 0.062) - 0.004) * upper * 0.7;
    light += smoothstep(0.012, 0.0, abs(abs(arch) - 0.074) - 0.003) * upper * 0.6;
    // a second, thinner tube inside the first
    float tube2 = abs(arch + 0.11) - 0.014;
    acc += smoothstep(0.008, 0.0, tube2) * upper * 0.35;
    // the speaker grille across the foot
    float foot = step(0.90, n.y);
    float bar = step(0.5, fract(a.x * 24.0));
    light += foot * (1.0 - bar) * 0.45;
    dark += foot * bar * 0.65;
    light += smoothstep(0.005, 0.0, abs(n.y - 0.893)) * 0.9;
    light += smoothstep(0.004, 0.0, abs(n.y - 0.050)) * 0.5 + smoothstep(0.004, 0.0, abs(n.y - 0.068)) * 0.35;
  } else {
    // Stardust: a field of stars that twinkle, a ringed planet up in one
    // corner, and the one dark face on the floor, so the picture is mostly
    // light on dark.
    vec2 sg = a * 26.0;
    vec2 si = floor(sg), sf = fract(sg) - 0.5;
    float sh = hash21(si);
    float star = step(0.90, sh) * smoothstep(0.12, 0.0, length(sf + (vec2(hash21(si + 3.0), hash21(si + 9.0)) - 0.5) * 0.6) - 0.02);
    light += star * (0.45 + 0.55 * sin(t * 1.7 + sh * 50.0)) * 0.9;
    vec2 pc = a - vec2(0.72, 0.13);
    float pl = length(pc) - 0.075;
    dark += smoothstep(0.008, 0.0, pl) * 0.85;
    light += smoothstep(0.03, 0.0, length(pc - vec2(-0.028, -0.028)) - 0.018) * step(pl, 0.0) * 0.35;
    vec2 rr = vec2(pc.x * 0.82 + pc.y * 0.57, -pc.x * 0.57 + pc.y * 0.82);
    float ring = abs(length(rr / vec2(0.165, 0.05)) - 1.0);
    float front = max(step(0.0, pl), step(0.0, rr.y));
    light += smoothstep(0.14, 0.0, ring) * front * 0.75;
    acc += smoothstep(0.05, 0.0, ring) * front * 0.25;
  }

  lac *= 1.0 - clamp(dark, 0.0, 1.0) * 0.45;
  lac = mix(lac, u_lamp * (0.55 + 0.45 * fall), clamp(light, 0.0, 1.0) * 0.42);
  // The accent replaces the paint rather than adding to it: blue added to
  // gold is grey, blue painted over gold is blue.
  lac = mix(lac, u_glow * (0.50 + 0.50 * fall), clamp(acc, 0.0, 1.0) * 0.85);
  }

  // The lacquer turns down into the frame at the rim: a dark seam with the
  // lamp catching the fold just inside it.
  float rimIn = smoothstep(0.0, -u_board.y * 0.010, d);
  float fold = smoothstep(-u_board.y * 0.020, -u_board.y * 0.006, d) * (1.0 - rimIn * 0.0);
  lac *= mix(0.34, 1.0, rimIn);
  lac += u_lamp * u_lacquer * fold * (1.0 - rimIn) * 0.6 * fall;

  // Outside the face is the cabinet body, which the composite pass moulds.
  vec3 surround = u_shell * 0.30 * (0.4 + 0.6 * fall);
  fragColor = outColour(mix(surround, lac, inside), 1.0);
}`;

// ---- brass pins -----------------------------------------------------------
export const PIN_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;      // radius, seed, 0, 0
out vec4 fragColor;
` + COMMON + `
void main() {
  float r = max(v_data.x, 1e-5);
  float seed = v_data.y;
  vec2 p = v_off / r;                 // 1.0 is the edge of the pin head
  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));

  vec4 c = vec4(0.0);

  // The shadow the head throws on the lacquer, cast away from the lamp.
  float sd = length((p - away * 0.66) / vec2(1.16, 1.0)) - 0.98;
  c = over(c, vec4(u_lacquer * 0.40, smoothstep(0.55, -0.15, sd) * 0.60));

  // The shaft below the head: a sliver of turned brass the head does not
  // quite cover, kept narrow so the pin reads as a post and not as a bead
  // sitting in a socket.
  float shaft = length((p - vec2(0.0, 0.46)) / vec2(0.72, 0.90)) - 0.86;
  c = over(c, vec4(u_brass * (0.035 + 0.06 * fall), cover(shaft)));

  // The head. Flat across the top, turning over hard at the rim, which is
  // what separates a machined cylinder from a bead.
  float d = length(p);
  float roll = smoothstep(0.58, 0.99, d);
  vec3 n = normalize(vec3(p * roll * 3.2, 1.0 - roll * 0.62));

  float wear = 0.90 + seed * 0.20;
  float ndl = max(dot(n, L), 0.0);
  vec3 brass = u_brass * (0.06 * u_lamp + 1.30 * u_lamp * ndl * fall) * wear;
  // A part on the nails shows on the nails: every head takes on the accent,
  // more with every such part, so a fitted face is told from a bare one.
  brass = mix(brass, mix(brass, u_glow * u_lamp * (0.5 + 0.9 * fall), 0.55), clamp(u_parts.x * 0.45, 0.0, 1.0));
  brass += u_lamp * u_brass * specular(n, L, 14.0) * 0.35 * fall;
  brass += u_lamp * specular(n, L, 110.0) * 0.50 * fall;
  // The bounce back off the lacquer keeps the shadowed underside warm rather
  // than merely dark, which is the difference between brass and plastic.
  brass += u_lacquer * u_brass * max(-n.y, 0.0) * 0.32 * fall * u_reflect;
  // The rim itself: the lamp takes the near edge as a bright arc and the far
  // edge drops away, which is the whole reason a head this small reads as
  // round rather than as a dot.
  float arc = dot(normalize(p + vec2(1e-5, 0.0)), normalize(L.xy + vec2(1e-6, 0.0)));
  float atRim = smoothstep(0.62, 0.97, d);
  brass *= 1.0 + dot(p, normalize(L.xy + vec2(1e-6, 0.0))) * 0.20 * (1.0 - atRim);
  brass += u_lamp * u_brass * atRim * max(arc, 0.0) * 0.45 * fall;
  brass *= 1.0 - atRim * max(-arc, 0.0) * 0.80;
  // A hairline of shadow right at the outside edge seats the pin in the face.
  brass *= 1.0 - smoothstep(0.90, 1.0, d) * 0.55;

  fragColor = over(c, vec4(brass, cover(d - 1.0)));
  fragColor = outColour(fragColor.rgb, fragColor.a);
}`;

// ---- chrome balls ---------------------------------------------------------
// The one thing a player watches for a whole round, and usually only eight or
// ten pixels across. At that size a physically tidy sphere reads as a speck,
// so the shading here is built for the size it will actually be seen at: a
// dark steel body with a broad roll of lamp over the top of it, the lamp own
// image as a crescent up toward it, the lacquer bounced warm underneath, a
// bright ring inside the silhouette and a dark seat right on it. The dark
// seat is what separates a ball from the lacquer; the crescent is what makes
// it metal; the warm underside is what stops it reading as a hole.
export const BALL_FS = HEAD + `
in vec2 v_disc;
in vec2 v_dir;
in vec2 v_board;
in float v_spin;
in float v_speed;
out vec4 fragColor;
` + COMMON + `
void main() {
  float d = length(v_disc);
  if (d > 1.0 + fwidth(d) * 2.0) discard;

  // The disc is drawn in the ball own stretched frame; the normal has to be
  // built back in screen space or a fast ball highlight would swing round
  // with its heading.
  vec2 q = v_dir * v_disc.x + vec2(-v_dir.y, v_dir.x) * v_disc.y;
  float z = sqrt(max(0.0, 1.0 - min(d * d, 1.0)));
  vec3 n = vec3(q, z);

  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  float ndl = max(dot(n, L), 0.0);

  vec3 col = u_chrome * u_lamp * (0.06 + 0.72 * ndl * fall);
  // The dark room turned in the metal keeps the underside from flattening
  // out into the same tone as the top.
  col *= 0.70 + 0.50 * smoothstep(-0.25, 0.95, dot(n, L));

  // The lamp image. A broad source on a sphere leaves an oval lying across
  // the light rather than a round dot, and the core inside it is the mark
  // that says polished steel.
  vec3 h = normalize(L + VIEW);
  vec2 spot = h.xy * 1.02;
  vec2 lit = normalize(L.xy + vec2(1e-6, 0.0));
  vec2 hv = q - spot;
  vec2 hs = vec2(dot(hv, vec2(-lit.y, lit.x)), dot(hv, lit) * 1.7);
  float hd = length(hs);
  col += u_lamp * smoothstep(0.50, 0.22, hd) * 0.95 * fall;
  col += u_lamp * smoothstep(0.20, 0.05, hd) * 2.40 * fall;

  // The lacquer thrown back up under it, and a little of the brass it has
  // been falling through. This is the warm half of a chrome ball and without
  // it a ball on a dark face is a hole in the face.
  float under = max(-n.y, 0.0);
  col += u_lacquer * 0.95 * pow(under, 2.6) * fall * u_reflect;
  col += u_brass * 0.10 * pow(under, 4.5) * fall * u_reflect;

  // A horizon that rides with the spin, so a rolling ball reads as rolling
  // without a trail behind it.
  float band = sin(v_spin + atan(q.y, q.x) * 2.0) * 0.5 + 0.5;
  col *= mix(1.0, 0.80 + 0.30 * band, 0.45 * u_reflect);

  // A bright hairline just inside the silhouette, then a dark seat right on
  // it. The hairline has to stay narrow: widen it and a small ball stops
  // reading as a sphere and starts reading as a ring.
  col += u_lamp * u_chrome * smoothstep(0.70, 0.97, d) * (0.15 + 0.85 * ndl) * 1.35 * fall;
  col *= 1.0 - smoothstep(0.78, 1.0, d) * 0.70;

  fragColor = outColour(col, cover(d - 1.0));
}`;

// ---- the shadow a ball lays on the lacquer --------------------------------
export const BALL_SHADOW_FS = HEAD + `
in vec2 v_disc;
in vec2 v_dir;
in vec2 v_board;
in float v_spin;
in float v_speed;
out vec4 fragColor;
uniform float u_settle;   // speed at which a shadow is fully soft
` + COMMON + `
void main() {
  vec3 L = lampDir(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));

  // A ball in flight sits away from the face, so its shadow is wide, faint
  // and thrown well to the side. A ball at rest is almost touching, and the
  // shadow pulls in under it and darkens.
  float lift = clamp(v_speed / max(u_settle, 1e-4), 0.0, 1.0);
  float spread = mix(0.95, 1.35, lift);
  float dark = mix(0.95, 0.42, lift);
  vec2 p = (v_disc - away * mix(0.40, 0.85, lift)) / spread;

  float d = length(p) - 1.0;
  float a = smoothstep(0.30, -0.60, d) * dark * clamp(lampFall(v_board) * 1.3, 0.0, 1.0);
  fragColor = outColour(u_lacquer * 0.22, a);
}`;

// ---- rails and deflector plates -------------------------------------------
export const RAIL_FS = HEAD + `
in vec2 v_seg;
in vec2 v_ext;
in vec2 v_board;
in vec2 v_perp;
in vec4 v_data;    // direction xy, kind, seed
out vec4 fragColor;
` + COMMON + `
void main() {
  float halfT = max(v_ext.y, 1e-5);
  float core = max(v_ext.x - halfT, 0.0);
  float d = length(vec2(max(abs(v_seg.x) - core, 0.0), v_seg.y)) - halfT;

  float across = clamp(v_seg.y / halfT, -1.0, 1.0);
  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));
  bool guide = v_data.z > 0.5;

  vec4 c = vec4(0.0);

  // The shadow the rail lays down beside itself.
  vec2 s = v_seg - away * halfT * 1.5;
  float sd = length(vec2(max(abs(s.x) - core, 0.0), s.y)) - halfT * 1.25;
  c = over(c, vec4(u_lacquer * 0.42, smoothstep(halfT * 0.9, -halfT * 0.2, sd) * 0.55));

  // A wall is a half round chrome bar; a deflector is a flatter brass plate,
  // so its face stays broad and only the near edge turns over.
  float turnOver = guide ? 0.55 : 1.0;
  vec2 nxy = v_perp * across * turnOver;
  vec3 n = normalize(vec3(nxy, sqrt(max(0.04, 1.0 - dot(nxy, nxy)))));

  vec3 base = guide ? u_brass : u_chrome;
  float ndl = max(dot(n, L), 0.0);
  vec3 col = base * u_lamp * ((guide ? 0.08 : 0.04) + (guide ? 1.25 : 0.55) * ndl * fall);
  col += u_lamp * base * specular(n, L, guide ? 18.0 : 34.0) * (guide ? 0.40 : 0.60) * fall;
  col += u_lamp * specular(n, L, guide ? 140.0 : 220.0) * (guide ? 0.40 : 1.00) * fall;
  col += u_lacquer * base * max(-n.y, 0.0) * 0.30 * fall * u_reflect;
  // The seam where the rail meets the lacquer.
  col *= 1.0 - smoothstep(0.72, 1.0, abs(across)) * 0.45;

  fragColor = over(c, vec4(col, cover(d)));
  fragColor = outColour(fragColor.rgb, fragColor.a);
}`;

// ---- the mouths ----------------------------------------------------------
// Three different objects share this pass because they share a rectangle.
//
//   a pay mouth  is a pressed enamel plaque with a brass lip, and its TONE
//                decides what it is pressed from - the one jade mouth on the
//                face is the rarest and best paying and has to be seen as
//                that from across the room, whatever it happens to pay.
//   the gate     is not a plaque at all. It is a narrow throat: heavy brass
//                either side, a black slot between them, a chrome lip on top.
//   the attacker has two states and they must not be subtle. Shut, a brass
//                flap fills the mouth, proud of the face, with a seam down
//                the middle and a hard shadow under it. Open, the flap is
//                gone, the mouth is a wide black hole with a lit jade throat
//                and the flaps folded back as wings at each end. That change,
//                with the lamp warming, is the whole announcement of a fever,
//                and it has to carry with the sound off.
export const POCKET_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // kind, open, tone, lip width
out vec4 fragColor;
uniform vec3 u_pocketFill[4];
uniform vec2 u_pad;   // the room the quad has around the mouth, board units
` + COMMON + `
void main() {
  vec2 hs = v_half;
  float lip = max(v_data.w, 1e-5);
  int kind = int(v_data.x + 0.5);
  float open = v_data.y;
  int tone = int(v_data.z + 0.5);

  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));
  vec4 c = vec4(0.0);

  bool gate = kind == 2;
  bool attacker = kind == 3;
  float radius = min(hs.x, hs.y) * (gate ? 0.16 : 0.30);
  float d = sdBox(v_off, hs, radius);

  // The housing. A mouth on its own is a few pixels of brass on a busy face,
  // and where the mouths sit is most of what makes one machine a different
  // machine from the next. Set into a lit plaque the better part of a ball
  // wide either side, every mouth reads from across the room, which is what a
  // parlour does with moulded plastic. The plaque is picture only - a ball
  // cannot land on it - so the mouth the simulation uses is untouched.
  {
    vec2 grow = attacker ? vec2(0.55, 0.70) : gate ? vec2(1.35, 0.95) : vec2(1.25, 0.95);
    vec2 hh = hs + min(grow, u_pad * 0.72);
    float rh = radius * 1.8 + lip;
    float dh = sdBox(v_off, hh, rh);
    float hsd = sdBox(v_off - away * lip * 1.8, hh, rh);
    c = over(c, vec4(u_lacquer * 0.28, smoothstep(lip * 2.2, -lip * 0.3, hsd) * 0.80));
    c = over(c, vec4(u_oxblood * (0.30 + 0.45 * fall), cover(dh) * 0.92));
    float hb = clamp(-(dh + lip * 0.55) / max(lip * 1.7, 1e-4), 0.0, 1.0);
    vec2 hg = normalize(vec2(dFdx(dh), dFdy(dh)) + vec2(1e-6, 0.0));
    vec3 hn = normalize(vec3(hg * (1.0 - hb) * 1.3, 0.55 + 0.45 * hb));
    // The plaque takes the mouth's own colour: brass for the slot, the jade
    // for the jackpot pocket, the enamel a pay mouth is pressed in.
    vec3 hc = gate ? u_brass : attacker ? u_pocketFill[1] : u_pocketFill[tone];
    if (attacker) hc = mix(hc * 0.45, hc, open);
    vec3 plaque = hc * u_lamp * (0.09 + 0.90 * max(dot(hn, L), 0.0) * fall) * 0.80;
    plaque += u_lamp * specular(hn, L, 90.0) * 0.30 * fall;
    plaque += u_lamp * hc * specular(hn, L, 16.0) * 0.18 * fall;
    if (gate) {
      // The slot is the one mouth the whole game is aimed at, so its plaque
      // is lit from within and breathes while the machine rests - brighter
      // than any pay mouth, and the first thing found on a new face.
      float breathe = 0.55 + 0.45 * sin(u_time * 1.6);
      plaque += u_lamp * (0.16 + 0.22 * breathe) * (0.6 + 0.4 * hb) * (1.0 + 0.5 * clamp(u_parts.y, 0.0, 2.0));
      c = over(c, vec4(u_lamp * 0.9, (cover(dh + lip * 0.55) - cover(dh + lip * 1.35)) * (0.35 + 0.45 * breathe)));
    }
    c = over(c, vec4(plaque, cover(dh + lip * 0.55)));
  }

  // Everything standing off the face throws the same hard little shadow.
  float sd = sdBox(v_off - away * lip * 1.4, hs, radius);
  c = over(c, vec4(u_lacquer * 0.38, smoothstep(lip * 1.5, -lip * 0.2, sd) * 0.75));

  // The keyline, laid down before the brass so the brass sits inside it.
  c = over(c, vec4(u_oxblood * (0.30 + 0.55 * fall), cover(d - lip * 0.42) * 0.92));

  // The brass surround. Its face rolls outward across the band, so the lamp
  // takes the near edge and the far edge drops away.
  float lipW = gate ? lip * 1.7 : (attacker ? lip * 1.3 : lip);
  float band = clamp(-d / lipW, 0.0, 1.0);
  vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
  vec3 nl = normalize(vec3(grad * (1.0 - band) * 1.4, 0.55 + 0.45 * band));
  vec3 lipCol = u_brass * u_lamp * (0.08 + 1.25 * max(dot(nl, L), 0.0) * fall);
  lipCol += u_lamp * u_brass * specular(nl, L, 20.0) * 0.40 * fall;
  lipCol += u_lamp * specular(nl, L, 140.0) * 0.55 * fall;
  c = over(c, vec4(lipCol, cover(d)));

  float inner = d + lipW;

  if (gate) {
    // A slot, not a plaque: black inside, with the lamp catching the chrome
    // edge across its top so the opening is legible at four pixels wide.
    c = over(c, vec4(u_lacquer * 0.03, cover(inner)));
    float top = smoothstep(0.0, -hs.y * 0.5, v_off.y);
    vec3 edge = u_chrome * u_lamp * (0.15 + 1.4 * fall) + u_lamp * 0.5 * fall;
    c = over(c, vec4(edge, cover(inner + hs.y * 0.30) * top * 0.9));
    fragColor = outColour(c.rgb, c.a);
    return;
  }

  if (attacker) {
    if (open > 0.5) {
      // Wide open. The flap is gone and what is left is a hole: black almost
      // all the way across, with the machine's jade lit in a band around the
      // inside of it. Jade is the one colour on this face that appears only
      // when something is being paid, which is what makes an open mouth
      // readable from across a room with the sound off.
      float mouth = inner - lipW * 0.45;
      c = over(c, vec4(u_lacquer * 0.010, cover(mouth)));
      float rim = mouth + min(hs.x, hs.y) * 0.34;
      vec3 jadeCol = u_pocketFill[1] * u_lamp * (0.40 + 1.30 * fall) + u_glow * 0.55 * fall;
      c = over(c, vec4(jadeCol, (cover(mouth) - cover(rim)) * 0.95));
      // A chrome lip along the top of the opening, the edge a ball goes over.
      float topEdge = smoothstep(0.0, -hs.y * 0.7, v_off.y);
      vec3 edgeCol = u_chrome * u_lamp * (0.20 + 1.6 * fall) + u_lamp * 0.55 * fall;
      c = over(c, vec4(edgeCol, (cover(mouth + hs.y * 0.14) - cover(mouth)) * topEdge));
      // The two flaps folded back flat into the ends of the mouth.
      float wing = min(
        sdBox(v_off - vec2(-(hs.x - lipW * 1.5), 0.0), vec2(lipW * 0.55, hs.y * 0.52), lipW * 0.25),
        sdBox(v_off - vec2(hs.x - lipW * 1.5, 0.0), vec2(lipW * 0.55, hs.y * 0.52), lipW * 0.25));
      vec3 wingCol = u_brass * u_lamp * (0.12 + 1.3 * fall) + u_lamp * u_brass * 0.6 * fall;
      c = over(c, vec4(wingCol, cover(wing) * 0.95));
    } else {
      // Shut. One piece of brass across the whole mouth, standing proud, with
      // a seam down the middle and a hard shadow beneath it.
      float flap = sdBox(v_off, hs - lipW * 0.55, radius * 0.7);
      float flapShadow = sdBox(v_off - away * lipW * 1.1, hs - lipW * 0.55, radius * 0.7);
      c = over(c, vec4(u_lacquer * 0.05, smoothstep(lipW, -lipW * 0.3, flapShadow) * 0.85));
      vec2 fgrad = normalize(vec2(dFdx(flap), dFdy(flap)) + vec2(1e-6, 0.0));
      float fb = clamp(-flap / (lipW * 0.9), 0.0, 1.0);
      vec3 nf = normalize(vec3(fgrad * (1.0 - fb) * 1.2, 0.6 + 0.4 * fb));
      vec3 flapCol = u_brass * u_lamp * (0.09 + 1.05 * max(dot(nf, L), 0.0) * fall);
      flapCol += u_lamp * u_brass * specular(nf, L, 24.0) * 1.3 * fall;
      c = over(c, vec4(flapCol, cover(flap)));
      float seam = abs(v_off.y) - hs.y * 0.03;
      c = over(c, vec4(u_brass * 0.05, cover(seam) * cover(flap + lipW * 0.4) * 0.9));
    }
    fragColor = outColour(c.rgb, c.a);
    return;
  }

  // A pay mouth. Pressed enamel in whatever it is toned, set slightly into
  // the lip so its inner wall is lit on the lamp side and shadowed opposite.
  float wall = clamp(-inner / (lipW * 0.8), 0.0, 1.0);
  vec2 innerN = normalize(vec2(dFdx(inner), dFdy(inner)) + vec2(1e-6, 0.0)) * (1.0 - wall);
  vec3 ne = normalize(vec3(innerN * 1.1, 0.6 + 0.4 * wall));
  vec3 fill = u_pocketFill[tone];
  vec3 face = fill * u_lamp * (0.18 + 1.15 * max(dot(ne, L), 0.0) * fall);
  face += u_lamp * fill * specular(ne, L, 22.0) * 0.28 * fall;
  face += u_lamp * specular(ne, L, 400.0) * 0.30 * fall;
  float shut = 1.0 - open;
  face *= mix(1.0, 0.40, shut);
  c = over(c, vec4(face, cover(inner)));

  float slat = sdBox(v_off - vec2(0.0, -hs.y * 0.10), vec2(hs.x - lipW * 1.2, hs.y * 0.16), lipW * 0.5);
  vec3 slatCol = u_brass * u_lamp * (0.10 + 0.7 * fall) + u_lamp * u_brass * 0.35 * fall;
  c = over(c, vec4(slatCol, cover(slat) * shut));

  fragColor = outColour(c.rgb, c.a);
}`;

// ---- the launch rail ------------------------------------------------------
// The arc a ball rides up the side of the face and across the top before it
// drops into the nails. It is where every ball comes from and where the
// handle decides its fate, so it is drawn as a real channel: two polished
// chrome rails with a dark floor between them and the lamp on the inner edge,
// which is the edge a ball runs against.
//
// One instance covers the whole circle the arc is cut from, and the arc is
// measured per pixel, so it is a true circle with round ends rather than a
// chain of straight pieces that shows its joints at the top of the sweep.
export const ARC_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // radius, from, to (radians), half width
out vec4 fragColor;
` + COMMON + `
void main() {
  float R = max(v_data.x, 1e-4);
  float w = max(v_data.w, 1e-4);

  // The machine lays its arc out with y upward, so the angle of a point on a
  // face whose y runs downward is measured against the negated offset.
  float a = atan(-v_off.y, v_off.x);
  float mid = (v_data.y + v_data.z) * 0.5;
  float span = abs(v_data.z - v_data.y) * 0.5;
  float da = a - mid;
  da = da - 6.28318530718 * floor(da / 6.28318530718 + 0.5);
  float ca = mid + clamp(da, -span, span);
  vec2 onArc = vec2(cos(ca), -sin(ca)) * R;
  float d = length(v_off - onArc) - w;

  // Which side of the middle of the channel a pixel is on, and therefore
  // which way its bit of metal is turned.
  float across = clamp((length(v_off) - R) / w, -1.0, 1.0);
  vec2 radial = normalize(v_off + vec2(1e-6, 0.0));

  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));
  vec4 c = vec4(0.0);

  // The shadow the channel lays on the lacquer beside it. It has to be
  // measured from the shifted point against the arc, not from the arc against
  // a shifted point, or what appears beside the rail is a second rail.
  vec2 sp = v_off - away * w * 1.1;
  float sda = atan(-sp.y, sp.x) - mid;
  sda = sda - 6.28318530718 * floor(sda / 6.28318530718 + 0.5);
  vec2 sOn = vec2(cos(mid + clamp(sda, -span, span)), -sin(mid + clamp(sda, -span, span))) * R;
  float sd = length(sp - sOn) - w * 1.05;
  c = over(c, vec4(u_lacquer * 0.40, smoothstep(w * 0.7, -w * 0.2, sd) * 0.60));

  // The floor of the channel, dark and slightly warm.
  c = over(c, vec4(u_lacquer * u_lamp * (0.06 + 0.22 * fall) * 0.45, cover(d)));

  // Two rails, one either side. The inner one is the edge a ball runs
  // against, so it carries the brighter hairline.
  float rail = 1.0 - smoothstep(0.34, 0.66, abs(across));
  float onRail = 1.0 - rail;
  vec2 nxy = radial * across * onRail;
  vec3 n = normalize(vec3(nxy, sqrt(max(0.05, 1.0 - dot(nxy, nxy)))));
  vec3 col = u_chrome * u_lamp * (0.05 + 0.70 * max(dot(n, L), 0.0) * fall);
  col += u_lamp * u_chrome * specular(n, L, 30.0) * 0.55 * fall;
  col += u_lamp * specular(n, L, 240.0) * 1.00 * fall;
  float inside = smoothstep(-0.60, -0.95, across);
  col += u_lamp * inside * 0.55 * fall;
  // A part on the rails shows on the rails: the chrome warms toward the
  // accent with each one, and a second rail runs down the middle of the
  // channel once any is bolted in.
  float railParts = clamp(u_parts.z, 0.0, 2.0);
  col = mix(col, u_glow * u_lamp * (0.45 + 0.85 * fall), 0.30 * railParts);
  c = over(c, vec4(col, cover(d) * onRail));
  float middle = smoothstep(0.09, 0.0, abs(across)) * step(0.5, railParts);
  vec3 midCol = u_chrome * u_lamp * (0.25 + 0.90 * fall) + u_lamp * 0.45 * fall;
  c = over(c, vec4(midCol, cover(d) * middle * 0.9));

  // The rail is drawn only inside the field's walls. Its circle bulges past
  // the left wall between the shoulder and the hip, and drawn there it read
  // as a rail poking through the bar; hidden there it reads as the rail
  // entering the outer channel behind the bar, which is what it is. The
  // ball still rides the whole circle.
  float inField = step(0.06 * u_board.x, v_board.x) * step(v_board.x, 0.94 * u_board.x);
  fragColor = outColour(c.rgb, c.a * inField);
}`;


// ---- the show screen -------------------------------------------------------
// The middle of the machine, and the thing a player is actually watching while
// a ball is in the air. On a real cabinet the nails are a ring and an apron
// around this panel rather than the whole face, and building the field without
// building this is building the frame and skipping the picture.
//
// Four states, and every one of them has to read with the sound off:
//
//   idle    nobody is playing and the machine is still alive. A skin's own
//           motion runs slowly, because a still cabinet reads as broken.
//   spin    the drums are turning and nothing has been decided.
//   reach   two drums agree and the third is still going. The panel escalates,
//           and how far it escalates is a true readout of how likely this spin
//           is to pay. This is the state the whole machine exists for.
//   win     it paid. The show dips first and then blazes, because a blaze that
//           was in doubt for half a second is worth two that were not.
//
// Six skins, six motifs, one branch. The branch is on a uniform, so every
// pixel of the panel takes the same path and the other five cost nothing.
export const SCREEN_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // phase, tier, the phase's own beat, intensity
out vec4 fragColor;
` + COMMON + `
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s * 1.143;
}

// Turn, for anything that swings, sloshes or lies along an arm.
mat2 turn(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

// Distance to a segment. Every stem, arm, needle and tail on these panels is
// a chain of these, which is what lets a thing be built a piece at a time
// while it is being watched instead of being fetched whole from a texture.
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// The two nearest points of a scattered set. The gap between them is the web
// that runs along the walls between cells, which is the shape sunlight makes
// on a sand bottom, and it costs nine cells rather than an image.
vec2 web(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float m1 = 8.0, m2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(i + g), hash21(i + g + vec2(41.7, 19.3)));
      float d = length(g + o - f);
      if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) { m2 = d; }
    }
  }
  return vec2(m1, m2);
}

// A small fish: a wedge with its point along +x.
float sdFish(vec2 p, float r) {
  p /= max(r, 1e-5);
  return max(max(dot(p, vec2(0.80, 0.60)), dot(p, vec2(0.80, -0.60))), -p.x - 0.95) * r;
}

void main() {
  vec2 hs = v_half;
  float phase = v_data.x;
  float tier = v_data.y;
  float beat = v_data.z;
  float heat = clamp(v_data.w, 0.0, 1.0);
  float t = u_time;

  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));

  float bez = min(hs.x, hs.y) * 0.13;
  float round = min(hs.x, hs.y) * 0.16;
  float d = sdBox(v_off, hs, round);
  vec4 c = vec4(0.0);

  // The housing stands proud of the face and throws a hard little shadow.
  float sd = sdBox(v_off - away * bez * 0.9, hs, round);
  c = over(c, vec4(u_lacquer * 0.30, smoothstep(bez * 1.2, -bez * 0.3, sd) * 0.85));

  // Moulded housing, rolling over from the face into the panel.
  float band = clamp(-d / bez, 0.0, 1.0);
  vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
  vec3 hn = normalize(vec3(grad * (1.0 - band) * 1.6, 0.45 + 0.55 * band));
  vec3 house = u_chrome * u_lamp * (0.12 + 0.85 * max(dot(hn, L), 0.0) * fall);
  house += u_lamp * specular(hn, L, 150.0) * 0.85 * fall;
  house += u_lamp * u_chrome * specular(hn, L, 24.0) * 0.30 * fall;
  // The housing picks up whatever the panel is doing, so the escalation does
  // not stop dead at the edge of the glass.
  house += u_glow * heat * (1.0 - band) * 0.60;
  c = over(c, vec4(house, cover(d)));

  float inner = d + bez;
  // How much of the panel this pixel is, worked out before anything branches
  // on it, because it is the one value here that needs a screen derivative.
  float onPanel = cover(inner);
  if (onPanel <= 0.0) {
    fragColor = outColour(c.rgb, c.a);
    return;
  }
  vec2 uv = v_off / hs;

  // While the last drum is being watched the whole panel shudders. It is a
  // few thousandths of the panel and it is the difference between a machine
  // straining and a machine playing an animation.
  float shudder = phase > 1.5 && phase < 2.5 ? heat * 0.010 * sin(t * 57.0) : 0.0;
  vec2 q = uv + vec2(shudder, shudder * 0.4);
  // Square units, so a disc is round on a panel that is not. Board y runs
  // downward, so +y here is the near edge of the panel and -y is the far one.
  float asp = hs.x / max(hs.y, 1e-5);
  vec2 p = q * vec2(asp, 1.0);
  // The last drum still turning is the one moment the panel is built around.
  float reach = phase > 1.5 && phase < 2.5 ? clamp(beat, 0.0, 1.0) : 0.0;

  vec3 field = u_screen * (0.60 + 0.40 * fall);
  int look = int(u_show.w + 0.5);

  // Every panel below is drawn in its own machine's colours - the bright
  // enamel, the body lacquer, the near white lamp - and spends the hot accent
  // on exactly one thing, so the accent stays the thing the eye goes to
  // instead of becoming the picture.
  if (look == 0) {
    // Looking down into a lit shallow. Two webs of scattered points, drifting
    // against each other, are the net the sun lays on a sand bottom.
    vec2 w1 = web(p * 5.4 + vec2(t * 0.075, t * 0.045));
    float net = 1.0 - smoothstep(0.0, 0.115, w1.y - w1.x);
    net *= net;
    if (u_reflect > 0.5) {
      vec2 w2 = web(p * 8.6 + vec2(17.0 - t * 0.058, 5.0 + t * 0.092));
      float fine = 1.0 - smoothstep(0.0, 0.090, w2.y - w2.x);
      net = net * 0.80 + fine * fine * 0.55;
    }
    // The light does not land evenly. It gathers and thins as the surface
    // moves over it, which is the difference between water and cracked glass.
    net *= 0.10 + 1.70 * smoothstep(0.30, 0.86, fbm(p * 1.25 + vec2(t * 0.035, -t * 0.022)));
    field += u_lamp * net * (0.44 + 0.60 * heat);
    // The water is deeper at the far edge, so the far edge is darker.
    field += u_lacquer * smoothstep(-1.0, 1.0, q.y) * 0.10;

    // A shoal, on one heading. They turn together because there is only one
    // heading, and on a reach the heading straightens and they leave.
    float head = sin(t * 0.31) * 0.85 - reach * 2.0;
    vec2 dir = vec2(cos(head), sin(head));
    vec2 sc = vec2(-0.10, -0.45) + dir * (0.30 + reach * 2.2) + vec2(sin(t * 0.31) * 0.20, 0.0);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 o = vec2(hash21(vec2(fi, 3.0)), hash21(vec2(fi, 7.0))) - 0.5;
      vec2 fp = turn(-head) * (p - sc - o * vec2(0.46, 0.29));
      fp.y += sin(t * 6.0 + fi * 1.9) * 0.010;
      field += mix(u_enamel, u_lamp, 0.45) * smoothstep(0.007, -0.005, sdFish(fp, 0.042)) * 0.75;
    }

    // Jellyfish, pulsing on their own clocks. The one thing on this panel in
    // the hot accent.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float pulse = 0.5 + 0.5 * sin(t * (1.35 + 0.22 * fi) + fi * 2.3);
      vec2 jc = vec2(sin(t * 0.21 + fi * 2.1) * 0.62, cos(t * 0.16 + fi * 1.7) * 0.34 - 0.34);
      vec2 jp = p - jc;
      float bell = length(jp / vec2(0.155 + 0.030 * pulse, 0.125 - 0.028 * pulse)) - 1.0;
      float dome = smoothstep(0.30, -0.20, bell) * smoothstep(0.05, -0.02, jp.y);
      field += u_glow * dome * 0.45;
      field += u_lamp * smoothstep(0.05, -0.30, bell) * smoothstep(-0.02, -0.07, jp.y) * 0.10;
      for (int k = 0; k < 3; k++) {
        float fk = float(k) - 1.0;
        float tx = jc.x + fk * 0.050 + sin(jp.y * 12.0 - t * 2.6 + fi + fk) * 0.030;
        field += u_glow * smoothstep(0.011, 0.0, abs(p.x - tx))
               * smoothstep(0.02, 0.06, jp.y) * smoothstep(0.40, 0.14, jp.y) * 0.40;
      }
    }

    // Something big is over the shallow. Its shadow arrives first.
    float sweep = clamp(beat, 0.0, 1.0);
    float cx = -1.7 + 3.4 * sweep;
    float shade = smoothstep(0.9, 0.0, length((p - vec2(cx, -0.20)) * vec2(0.75, 1.7)));
    field *= 1.0 - shade * step(1.5, tier) * 0.55;
    if (tier > 2.5) {
      // Then the ray itself: two wings on one body, beating along their span.
      vec2 mp = p - vec2(cx, -0.16);
      mp.y -= sin(abs(mp.x) * 5.5 - t * 3.2) * 0.075 - 0.02;
      float wing = length(mp / vec2(0.60, 0.17)) - 1.0;
      float tail = sdSeg(mp, vec2(0.0, 0.0), vec2(-0.62, 0.10)) - 0.012;
      float body = max(smoothstep(0.04, -0.04, wing), smoothstep(0.008, -0.006, tail));
      field = mix(field, u_screen * 0.20, body * sweep);
      field += u_lamp * smoothstep(0.05, 0.0, abs(wing) - 0.03) * 0.30 * sweep;
    }
  } else if (look == 1) {
    // A greenhouse gone feral. The vine puts out one segment at a time from
    // the floor of the panel, tapering as it climbs, and is cut back when it
    // tops out. It climbs faster the harder the machine is pushing.
    float cycle = fract(t * (0.040 + 0.075 * heat) + 0.12);
    // Cutting back leaves a stub rather than bare soil, so the glass is never
    // empty and what a player watches is the climb rather than a blank pane.
    float seg = clamp(3.6 + cycle * 3.6, 0.0, 7.0);
    float open = tier > 2.5 ? clamp(beat * 1.6, 0.0, 1.0)
                            : clamp(seg - 5.5, 0.0, 1.0) * (0.20 + 0.45 * heat);

    // The house around it: daylight through the roof, and glass in a frame.
    field += u_lamp * smoothstep(1.1, -1.1, q.y) * 0.045;
    field += u_lacquer * 0.10 * smoothstep(0.026, 0.008, abs(fract(p.x * 1.25 + 0.5) - 0.5));
    field += u_lacquer * 0.07 * smoothstep(0.026, 0.008, abs(fract(p.y * 1.10 + 0.5) - 0.5));
    // Seed and pollen adrift in the house, so the glass is never empty.
    for (int m = 0; m < 4; m++) {
      float fm = float(m);
      vec2 mp = vec2(sin(t * (0.13 + 0.04 * fm) + fm * 2.4) * 0.80,
                     fract(0.27 * fm - t * 0.045) * 2.2 - 1.1);
      field += u_lamp * smoothstep(0.016, 0.0, length(p - mp)) * 0.28;
    }
    if (u_reflect > 0.5) field += u_enamel * fbm(p * 2.2 + vec2(t * 0.05, -t * 0.03)) * 0.16;

    for (int v = 0; v < 2; v++) {
      float fv = float(v) * 2.0 - 1.0;
      vec2 a = vec2(fv * 0.66 * asp, 1.06);
      for (int s = 0; s < 7; s++) {
        float fs = float(s);
        float on = clamp(seg - fs, 0.0, 1.0);
        // Each piece takes its own lean rather than adding to the last one, so
        // the vine snakes without ever walking off the side of the panel, and
        // it leans outward to leave the middle of the panel clear.
        float ang = -1.5708 + sin(t * 0.40 + fs * 1.25 + fv * 2.1) * 0.34 + fv * 0.09;
        vec2 b = a + vec2(cos(ang), sin(ang)) * 0.31 * on;
        field += u_enamel * smoothstep(0.010, -0.010, sdSeg(p, a, b) - (0.040 - fs * 0.0038)) * 0.85 * on;
        // A leaf at every other joint: two arcs meeting at a point, which is
        // what the overlap of two discs is.
        float has = mod(fs, 2.0);
        float la = ang + fv * 1.35;
        vec2 lp = turn(-la) * (p - b - vec2(cos(la), sin(la)) * 0.150);
        float leaf = max(length(lp - vec2(0.0, 0.140)) - 0.205, length(lp - vec2(0.0, -0.140)) - 0.205);
        field += mix(u_lacquer, u_enamel, 0.30) * smoothstep(0.006, -0.008, leaf) * 1.10 * on * has;
        field += u_enamel * smoothstep(0.005, 0.0, abs(lp.y)) * smoothstep(0.15, 0.0, abs(lp.x)) * 0.45 * on * has;
        a = b;
      }
      // The flower at the tip. Five petals round a disc, and the one thing on
      // this panel in the hot accent.
      for (int k = 0; k < 5; k++) {
        float ak = float(k) * 1.2566 + t * 0.18 + fv;
        vec2 pc = a + vec2(cos(ak), sin(ak)) * (0.038 + 0.075 * open);
        vec2 e = turn(-ak) * (p - pc);
        float petal = length(e / vec2(0.058 + 0.070 * open, 0.038 + 0.026 * open)) - 1.0;
        field += u_glow * smoothstep(0.30, -0.20, petal) * (0.22 + 0.60 * open);
      }
      field += u_lamp * smoothstep(0.030, 0.012, length(p - a)) * (0.25 + 0.55 * open);
    }
  } else if (look == 2) {
    // A pan of gravel worked under running water, seen from above. The pan
    // rocks, the gravel rides with it, and the water takes the light stuff
    // off the near edge a grain at a time.
    float clear = clamp(heat * 0.75 + step(2.5, tier) * beat, 0.0, 1.0);
    float rock = sin(t * 0.55) * 0.10;
    vec2 g = turn(rock) * p + vec2(sin(t * 0.55) * 0.09, cos(t * 0.47) * 0.05);

    // One lumpy grain per cell, kept inside its own cell so a dense bed costs
    // a single lookup. Two beds at different scales and turned against each
    // other, because one grid of them on its own reads as a printed pattern.
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 cellp = turn(rock + fi * 1.15) * g * (6.5 + fi * 5.5) + vec2(fi * 13.7, fi * 7.3);
      vec2 ci = floor(cellp), cf = fract(cellp) - 0.5;
      float r1 = hash21(ci + vec2(fi * 31.0, 0.0));
      float r2 = hash21(ci + vec2(19.7 + fi, 7.3));
      float r3 = hash21(ci + vec2(3.1, 91.7 + fi));
      vec2 gp = cf - (vec2(r1, r2) - 0.5) * 0.40;
      float ga = atan(gp.y, gp.x) + r1 * 6.283;
      float rad = 0.34 * (0.32 + 0.68 * r3)
                * (1.0 + 0.10 * sin(ga * 3.0 + r2 * 21.0) + 0.07 * sin(ga * 5.0 - r1 * 14.0)
                       + 0.05 * sin(ga * 7.0 + r3 * 9.0));
      float grain = smoothstep(0.035, -0.006, length(gp) - rad) * step(0.10 + 0.16 * fi, r3);
      // The light stuff goes first, and it goes off the near edge.
      grain *= step(clear, 0.28 + 0.46 * r3 + (0.5 - g.y * 0.35) * 0.35);
      vec3 stone = mix(u_screen * 3.0, u_brass * 0.20, r1) * (0.45 + 0.55 * smoothstep(0.3, -0.4, gp.y));
      field = mix(field, stone, grain);
      // Now and then one of them is gold, and it takes the light.
      float au = step(0.955, r2) * grain;
      field = mix(field, u_enamel * (0.55 + 1.25 * heat), au);
      field += u_lamp * au * pow(max(sin(t * 1.7 + r1 * 30.0), 0.0), 24.0) * 1.5;
    }

    // Water sheets across the pan as a band with a working edge, and it is the
    // one thing on this panel in the hot accent.
    float wy = -1.55 + fract(t * 0.22) * 3.15;
    float ahead = p.y - wy - sin(p.x * 5.5 + t * 1.6) * 0.022;
    float sheet = smoothstep(0.0, -0.14, ahead) * smoothstep(-1.40, -0.55, ahead);
    field = mix(field, mix(field, u_glow, 0.45), sheet * 0.75);
    field += u_lamp * sheet * 0.07 * (0.5 + 0.5 * sin(p.x * 9.0 + p.y * 4.0 - t * 2.4));
    field += u_glow * smoothstep(0.10, 0.0, abs(ahead)) * 0.40;
    field += u_lamp * smoothstep(0.024, 0.0, abs(ahead)) * 0.60;

    // The pan itself, over the top of everything in it.
    float pr = length(p * vec2(1.0, 1.04));
    field *= 1.0 - smoothstep(0.90, 1.00, pr) * 0.80;
    field += u_brass * u_lamp * smoothstep(0.022, -0.014, abs(pr - 0.945) - 0.035) * (0.30 + 0.85 * fall);

    if (tier > 2.5) {
      // The pan worked out: everything gone but the one lump worth keeping.
      vec2 np = p - vec2(0.0, -0.26);
      float na = atan(np.y, np.x);
      float nug = length(np * vec2(1.0, 1.12))
                - 0.17 * (1.0 + 0.16 * sin(na * 4.0 + 1.3) + 0.10 * sin(na * 7.0));
      float nm = smoothstep(0.020, -0.012, nug) * beat;
      field = mix(field, u_enamel * 1.30, nm);
      field += u_lamp * smoothstep(0.060, 0.0, length(np - vec2(-0.05, -0.06))) * nm * 1.3;
    }
  } else if (look == 3) {
    // The inside of a furnace: one scalar heat field, dragged about by a
    // second noise field, read through a ramp from dark red through ember to
    // white. A hotter panel is a better spin, which makes the ramp a readout.
    vec2 h = p * 1.7 + vec2(0.0, t * 0.30);
    if (u_reflect > 0.5) {
      vec2 drag = vec2(fbm(p * 1.35 + t * 0.19), fbm(p * 1.35 + vec2(4.7, 1.9) - t * 0.16)) - 0.5;
      h += drag * (1.1 + 0.9 * heat);
    }
    // The noise is stretched over the whole ramp first: an unstretched field
    // sits in the middle of it and reads as one flat orange with no cold iron
    // at one end and no white at the other.
    float temp = smoothstep(0.20, 0.82, fbm(h)) * 0.95 + (q.y * 0.5 + 0.5) * 0.32 - 0.10;
    temp = clamp(temp * (0.90 + 0.45 * heat + 0.06 * tier), 0.0, 1.35);
    field = mix(field, u_lacquer * 0.10, smoothstep(0.0, 0.26, temp));
    field = mix(field, u_lacquer * 0.30, smoothstep(0.14, 0.44, temp));
    field = mix(field, u_lacquer * 0.95, smoothstep(0.36, 0.70, temp));
    field = mix(field, u_enamel * 1.20, smoothstep(0.66, 0.94, temp));
    field = mix(field, u_lamp * 1.45, smoothstep(0.92, 1.18, temp));

    // Sparks off the charge, rising and turning over in the draught.
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float life = fract(t * (0.26 + 0.045 * fi) + hash21(vec2(fi, 2.0)) * 9.0);
      float sx = (hash21(vec2(fi, 5.0)) - 0.5) * 1.75 * asp + sin(life * 7.0 + fi * 2.0) * 0.11;
      float sy = 1.05 - life * 2.25;
      vec2 sp = (p - vec2(sx, sy)) * vec2(1.5, 0.42);
      field += u_enamel * smoothstep(0.075, 0.0, length(sp)) * (1.0 - life) * (0.55 + 0.70 * heat);
      field += u_lamp * smoothstep(0.028, 0.0, length(sp)) * (1.0 - life) * (1.20 + 1.30 * heat);
    }

    // The water cooled pipe along the roof: the one cold thing in here, and
    // the one thing on this panel in the hot accent.
    float pipe = abs(p.y + 0.78 + sin(p.x * 6.0 + t * 0.9) * 0.012) - 0.008;
    field = mix(field, u_glow * 0.75, smoothstep(0.008, -0.006, pipe) * 0.75);
    field += u_glow * smoothstep(0.030, 0.0, pipe) * (0.14 + 0.12 * sin(t * 0.8 + p.x * 3.0));
  } else if (look == 4) {
    // A jukebox mechanism behind its glass: the stack standing on its arcs
    // across the top, one record out on the deck below it, and the arm coming
    // down on that one.
    vec2 hub = vec2(0.0, 2.55);
    float hr = length(p - hub);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float rr = 2.62 + fi * 0.115 + sin(t * 0.45 + fi * 1.1) * 0.008;
      field += u_lacquer * 0.55 * smoothstep(0.016, -0.012, abs(hr - rr) - 0.030);
      field += u_lamp * 0.22 * smoothstep(0.008, 0.0, abs(hr - rr - 0.028));
    }

    // The one that was pulled, turning on the deck. Its grooves are rings and
    // the sheen goes round with it, which is how a record reads as spinning.
    vec2 dp = p - vec2(0.0, -0.16);
    float dr = length(dp);
    float da = atan(dp.y, dp.x);
    float disc = dr - 0.36;
    float onDisc = smoothstep(0.010, -0.010, disc);
    field = mix(field, u_lacquer * (0.16 + 0.10 * (0.5 + 0.5 * sin(dr * 210.0))), onDisc);
    field += u_lamp * pow(max(cos(da - t * 2.3), 0.0), 16.0) * onDisc * 0.55;
    field += u_lamp * smoothstep(0.012, -0.006, abs(disc) - 0.008) * 0.35;
    field = mix(field, u_enamel * (0.85 + 0.25 * sin(da * 3.0 + t * 2.3)),
                smoothstep(0.006, -0.006, dr - 0.115));
    field += u_lamp * smoothstep(0.016, 0.004, dr) * 0.60;

    // The arm comes down as the last drum is watched, and it stays down once
    // the machine has committed.
    float down = max(reach, step(2.5, tier) * clamp(beat * 1.4, 0.0, 1.0));
    vec2 piv = vec2(0.80 * asp, 0.34);
    vec2 tip = piv + turn(mix(-0.95, -0.30, down)) * vec2(-0.66, 0.00);
    field += u_chrome * u_lamp * smoothstep(0.010, -0.008, sdSeg(p, piv, tip) - 0.022) * (0.35 + 0.65 * fall);
    field += u_lamp * smoothstep(0.055, 0.022, length(p - piv)) * 0.40;
    field += u_lamp * smoothstep(0.024, 0.0, length(p - tip)) * (0.40 + 0.70 * down);

    // The tube round the whole panel, with the bubbles going up it. The one
    // thing on this panel in the hot accent, and the shape that says diner.
    float tubed = abs(sdBox(v_off, hs * 0.855, min(hs.x, hs.y) * 0.26)) / max(hs.y, 1e-5);
    float tube = smoothstep(0.050, 0.016, tubed);
    field = mix(field, u_glow * 0.80, tube * 0.75);
    float upright = smoothstep(0.52, 0.74, abs(p.x) / max(asp, 1e-5));
    float rise = fract(-p.y * 1.5 + t * 0.42 + step(0.0, v_off.x) * 0.5);
    field += mix(u_glow, u_lamp, 0.75) * tube * upright * smoothstep(0.20, 0.02, abs(rise - 0.5)) * 1.20;

    // The whole panel keeps time once the record is playing.
    field *= 1.0 + step(2.5, tier) * beat * 0.22 * pow(max(sin(t * 6.2), 0.0), 3.0);
  } else {
    // A window on deep space: a warped cloud, a nearer sheet of dust sliding
    // across it at its own speed, and stars with the four way cross a real
    // lens puts on them.
    vec2 wq = p * 1.5 + vec2(t * 0.010, 0.0);
    if (u_reflect > 0.5) {
      wq += (vec2(fbm(wq * 0.9 + t * 0.030), fbm(wq.yx * 0.9 - t * 0.026)) - 0.5) * 1.7;
    }
    float neb = fbm(wq);
    field = mix(field, u_screen * 0.30, smoothstep(0.52, 0.16, neb) * 0.85);
    field = mix(field, u_lacquer * 0.46, smoothstep(0.34, 0.84, neb) * 0.85);
    field += u_enamel * pow(max(neb - 0.56, 0.0), 2.0) * 2.2 * (0.7 + 0.6 * heat);
    if (u_reflect > 0.5) {
      float dust = fbm(p * 3.2 + vec2(t * 0.055, -t * 0.020));
      field += u_enamel * pow(max(dust - 0.68, 0.0), 2.0) * 1.4;
      field = mix(field, u_screen * 0.60, smoothstep(0.74, 0.96, dust) * 0.35);
    }
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 sp = p * (9.5 + fi * 8.0) + vec2(fi * 3.7, t * (0.02 + 0.035 * fi));
      vec2 si = floor(sp), sf = fract(sp) - 0.5;
      float r = hash21(si + vec2(fi * 17.0));
      float on = step(0.895 + 0.03 * fi, r);
      float tw = 0.40 + 0.60 * (0.5 + 0.5 * sin(t * (1.3 + r * 3.0) + r * 40.0));
      float core = smoothstep(0.055, 0.0, length(sf));
      float spike = smoothstep(0.014, 0.0, abs(sf.x)) * smoothstep(0.46, 0.0, abs(sf.y))
                  + smoothstep(0.014, 0.0, abs(sf.y)) * smoothstep(0.46, 0.0, abs(sf.x));
      field += u_lamp * on * tw * (core * 1.40 + spike * 0.70) * (1.0 - 0.35 * fi);
    }
    if (tier > 2.5) {
      // A comet crosses the frame: the one thing on this panel in the hot
      // accent, and it only ever comes out at the top of the ladder.
      float run = clamp(beat, 0.0, 1.0);
      vec2 head = mix(vec2(-asp - 0.35, 0.55), vec2(asp + 0.35, -0.80), run);
      vec2 dir = normalize(vec2(2.0 * asp + 0.70, -1.35));
      float s = clamp(dot(p - head, -dir), 0.0, 1.0);
      float td = length(p - (head - dir * s));
      field += u_glow * smoothstep(0.020 + 0.055 * s, 0.0, td) * (1.0 - s) * 0.90;
      field += u_lamp * smoothstep(0.032, 0.0, length(p - head)) * 1.10;
    }
  }

  // Rays running into the middle. Their count and their speed are the rung of
  // the ladder made visible, which is the whole point of having rungs, and
  // they are in the machine's own bright so the hot accent stays spent on the
  // one thing the panel's own picture spends it on.
  float ang = atan(uv.y, uv.x);
  float rays = pow(max(sin(ang * (6.0 + 5.0 * tier) + t * (1.1 + 0.9 * tier)), 0.0), 6.0);
  field += mix(u_enamel, u_lamp, 0.35) * rays * heat * heat * 0.55 * smoothstep(0.12, 0.95, length(uv));

  // The panel lifts as a whole, and a paid spin floods it.
  field *= 1.0 + heat * 0.60;
  field += u_enamel * step(3.5, phase) * beat * 0.65;
  field += u_lamp * step(3.5, phase) * pow(beat, 3.0) * 0.45;

  // It is a panel behind glass, not a hole in the machine.
  field *= 1.0 - 0.30 * pow(length(uv * vec2(0.92, 1.0)), 2.6);
  field *= 0.97 + 0.03 * sin(v_off.y / max(u_board.y, 1e-4) * 620.0);
  field += u_lamp * 0.045 * smoothstep(0.65, 0.0, abs(uv.x * 0.7 + uv.y - 0.52)) * fall * u_reflect;

  c = over(c, vec4(field, onPanel));
  fragColor = outColour(c.rgb, c.a);
}`;


// ---- the things the machine does back -------------------------------------
// Four of them need drawing, and they share this pass because they share a
// rectangle: a lit stripe of the board, an object crossing it, every mouth
// paying more for a while, and a row of doors with something behind one.
//
// The one that is only being announced is not here. It has no position yet, so
// its warning rides on the lamps, the sign and the screen instead, which is
// what makes it a warning about the machine rather than a preview of the
// thing.
//
// None of these replaces the board under it. They are laid over what is
// already drawn, so a nail lit by a stripe is still a nail, and an object
// crossing the board passes in front of the nails and behind the balls.
export const EVENT_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // kind, progress, fade, extra
out vec4 fragColor;
` + COMMON + `
// A capsule, which is most of what a swimming thing is made of.
float sdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * h)) - r;
}

// A soft union, so a body built out of separate lumps reads as one body.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec2 turn(vec2 p, float a) {
  float ca = cos(a), sa = sin(a);
  return vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
}

// Distance along a bar and distance across it, plus how long it is, so teeth
// and running water can be repeated down its length without solving it twice.
vec3 barFrame(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len = max(length(ab), 1e-6);
  vec2 dir = ab / len;
  vec2 q = p - a;
  return vec3(dot(q, dir), dot(q, vec2(-dir.y, dir.x)), len);
}

// A bar with riffle teeth standing off whichever side faces up the board.
// The teeth are short bars of their own rather than a varying thickness: a
// thickness that steps puts a jump in the distance, and a jump in the distance
// is an edge the coverage cannot resolve.
float sdRiffle(vec2 p, vec2 a, vec2 b, float r, float tooth) {
  vec2 ab = b - a;
  float len = max(length(ab), 1e-6);
  vec2 dir = ab / len;
  vec2 up = vec2(dir.y, -dir.x);
  up *= up.y > 0.0 ? -1.0 : 1.0;
  float d = sdSeg(p, a, b, r);
  for (int i = 0; i < 7; i++) {
    vec2 root = a + ab * ((float(i) + 0.5) / 7.0);
    d = min(d, sdSeg(p, root, root + up * tooth, r * 0.40));
  }
  return d;
}

// A point along a quadratic curve, which is how a stem bends.
vec2 curveAt(vec2 a, vec2 b, vec2 c, float s) {
  return mix(mix(a, b, s), mix(b, c, s), s);
}

void main() {
  int kind = int(v_data.x + 0.5);
  float progress = v_data.y;
  float fade = v_data.z;
  float extra = v_data.w;
  float t = u_time;

  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));
  vec4 c = vec4(0.0);

  if (kind == 0) {
    // A stripe of the board is lit. It is light laid on the paint rather than
    // a panel over it, so the nails inside it still read as nails.
    vec2 n = v_off / max(v_half, vec2(1e-4));
    float across = 1.0 - smoothstep(0.55, 1.0, abs(n.x));
    // A slow travel down the stripe, so it reads as running rather than as on.
    float run = 0.55 + 0.45 * sin(n.y * 3.1 - t * 2.2);
    float body = across * (0.30 + 0.42 * run) * fade;
    // The two rails at its edges, which is what makes it a lane and not a haze.
    float rail = smoothstep(0.14, 0.0, abs(abs(n.x) - 0.88));
    c = over(c, vec4(u_glow * (0.7 + 0.9 * fall), clamp(body * 0.55 + rail * fade * 0.85, 0.0, 1.0)));

  } else if (kind == 1) {
    // The machine has sent something out onto the board. What it is belongs to
    // the cabinet: each paint job summons its own creature or contraption, and
    // no two send the same one. Facing is baked into the offset so a thing
    // travelling left is the same thing turned round, not a second drawing.
    float leftward = step(0.25, fract(extra));
    vec2 p = v_off / max(v_half.y, 1e-4);
    p.x *= mix(1.0, -1.0, leftward);
    int look = int(u_show.w + 0.5);

    // Three parts, and any of them may be absent: the body, a second material
    // laid over it, and the one part that takes the machine's hot accent.
    float d = 100.0;
    float lit = 100.0;
    float trim = 100.0;
    vec3 skinCol = u_brass;
    vec3 litCol = u_enamel;
    float gloss = 22.0;

    if (look == 0) {
      // A manta ray, seen from above: a wing swept back from the nose to two
      // points, two lobes either side of the mouth, and a whip tail. Beating
      // narrows and widens the span, which is what a flap looks like from
      // straight overhead.
      float beat = 0.5 + 0.5 * sin(t * 2.0);
      float span = 0.72 + 0.14 * beat;
      vec2 q = p * 1.20;
      float yy = abs(q.y) / span;
      float lead = 0.62 - 1.10 * pow(yy, 1.35);
      float trail = -0.26 - 0.38 * yy * yy;
      // The tips are rounded onto the swept edges rather than cut square.
      d = -smin(-max(q.x - lead, trail - q.x), -(yy - 1.0), 0.11);
      d = min(d, length(vec2((q.x - 0.58) * 1.5, (abs(q.y) - 0.15) * 1.5)) - 0.16);
      float tail = sdSeg(q, vec2(-0.26, 0.0), vec2(-0.96, (beat - 0.5) * 0.26), 0.065);
      d = min(d, tail + smoothstep(-0.26, -0.96, q.x) * 0.048);
      // The lamp catching the leading edge, which is what keeps a dark shape
      // off the paint instead of sunk into it.
      lit = max(max(d + 0.02, -(d + 0.14)), -0.22 - q.x);
      trim = min(length(q - vec2(0.22, 0.25)) - 0.070,
                 length(q - vec2(0.22, -0.25)) - 0.070);
      skinCol = u_lacquer * 0.44;
      litCol = u_chrome;
      gloss = 12.0;

    } else if (look == 1) {
      // A flytrap on a stem: two half discs hinged on one line, teeth down
      // both rims, chewing. It comes up out of the board and goes back down.
      float rise = smoothstep(0.0, 0.16, progress) * (1.0 - smoothstep(0.84, 1.0, progress));
      vec2 q = p + vec2(0.0, (1.0 - rise) * 1.7);
      float lean = sin(t * 0.9) * 0.09;
      d = sdSeg(q, vec2(lean * 1.6, 1.35), vec2(lean, 0.30), 0.085);
      vec2 h = q - vec2(lean, 0.20);
      float chew = 0.5 + 0.5 * sin(t * 1.7);
      float ang = mix(0.05, 0.78, chew * chew);
      vec2 up = turn(h, -ang);
      vec2 lo = turn(h, ang);
      float sawU = abs(fract(atan(up.y, up.x) * 9.0 / 6.28318) - 0.5) * 2.0;
      float sawL = abs(fract(atan(lo.y, lo.x) * 9.0 / 6.28318) - 0.5) * 2.0;
      float jawU = max(length(vec2(up.x * 0.86, up.y)) - (0.54 + 0.13 * sawU), up.y);
      float jawL = max(length(vec2(lo.x * 0.86, lo.y)) - (0.54 + 0.13 * sawL), -lo.y);
      float jaws = min(jawU, jawL);
      d = min(d, jaws);
      // The lining inside the trap, which is the only part that is not plant.
      trim = max(jaws + 0.17, -(jaws + 0.30));
      skinCol = u_enamel;
      gloss = 11.0;

    } else if (look == 2) {
      // Two sluice bars with riffle teeth, dropping in from the upper corners
      // and closing into a funnel that steers a ball back toward the middle.
      float drop = smoothstep(0.0, 0.14, progress) * (1.0 - smoothstep(0.86, 1.0, progress));
      vec2 q = p + vec2(0.0, (1.0 - drop) * 1.9);
      vec2 a0 = vec2(-1.12, -0.86), a1 = vec2(-0.06, 0.62);
      vec2 b0 = vec2(1.12, -0.86), b1 = vec2(0.06, 0.62);
      d = min(sdRiffle(q, a0, a1, 0.13, 0.30), sdRiffle(q, b0, b1, 0.13, 0.30));
      // Water running down the channel of each bar, which is what a sluice is
      // for and the only part of it that moves.
      vec3 fa = barFrame(q, a0, a1);
      vec3 fb = barFrame(q, b0, b1);
      float wa = smoothstep(0.26, 0.0, abs(fract(fa.x * 1.3 - t * 0.9) - 0.5) - 0.20);
      float wb = smoothstep(0.26, 0.0, abs(fract(fb.x * 1.3 - t * 0.9) - 0.5) - 0.20);
      trim = min(max(sdSeg(q, a0, a1, 0.13) + 0.055, 0.02 - wa),
                 max(sdSeg(q, b0, b1, 0.13) + 0.055, 0.02 - wb));
      skinCol = u_brass;
      gloss = 30.0;

    } else if (look == 3) {
      // A ladle swings in on its arm, tips, and pours. The stream is a chain
      // of drops run together, so it falls rather than hangs there as a bar.
      float swing = smoothstep(0.0, 0.20, progress);
      float tip = smoothstep(0.26, 0.46, progress) * (1.0 - smoothstep(0.72, 0.92, progress));
      float arm = mix(1.15, 0.10, swing) + sin(t * 1.3) * 0.04;
      vec2 pin = vec2(0.10, -1.34);
      vec2 cup = pin + turn(vec2(0.0, 1.30), arm);
      float tilt = tip * 1.15;
      vec2 vq = turn(p - cup, -tilt);
      float bowl = max(abs(length(vec2(vq.x, vq.y * 0.92)) - 0.40) - 0.105, -vq.y - 0.04);
      d = min(bowl, sdSeg(p, pin, cup, 0.055));
      // What it holds, running out over the lip.
      vec2 lip = cup + turn(vec2(0.40, -0.03), tilt);
      float stream = length(p - lip) - 0.10;
      for (int i = 1; i < 9; i++) {
        float ph = fract(t * 0.65 + float(i) / 8.0);
        vec2 blob = lip + vec2(sin(ph * 4.0 + t * 2.0) * 0.07, ph * (1.50 - lip.y));
        stream = smin(stream, length(p - blob) - mix(0.100, 0.055, ph), 0.11);
      }
      lit = mix(100.0, stream, step(0.28, tip));
      // The hoop the bowl hangs in.
      trim = max(abs(length(vec2(vq.x, vq.y * 0.92)) - 0.52) - 0.030, -vq.y - 0.12);
      skinCol = u_chrome;
      litCol = u_enamel;
      gloss = 34.0;

    } else if (look == 4) {
      // A pair of cherries, dropped in and bouncing, both stems on one join.
      float fallIn = smoothstep(0.0, 0.13, progress);
      float bounce = abs(sin(t * 2.1));
      float drop = mix(-1.9, mix(0.24, -0.18, bounce), fallIn);
      vec2 q = p - vec2(0.0, drop);
      float squash = 1.0 + 0.14 * (1.0 - bounce);
      vec2 big = vec2(-0.38, 0.36);
      vec2 small = vec2(0.40, 0.48);
      d = min(length(vec2(q.x - big.x, (q.y - big.y) * squash)) - 0.40,
              length(vec2(q.x - small.x, (q.y - small.y) * squash)) - 0.34);
      // The gloss on each one, which is what makes it fruit and not a bead.
      lit = min(length(q - big - vec2(-0.15, -0.18)) - 0.125,
                length(q - small - vec2(-0.13, -0.15)) - 0.105);
      vec2 join = vec2(0.04, -0.36);
      float stems = 100.0;
      for (int i = 0; i < 5; i++) {
        float s0 = float(i) / 5.0;
        float s1 = float(i + 1) / 5.0;
        stems = min(stems, sdSeg(q, curveAt(big, vec2(-0.44, -0.16), join, s0),
                                    curveAt(big, vec2(-0.44, -0.16), join, s1), 0.030));
        stems = min(stems, sdSeg(q, curveAt(small, vec2(0.48, 0.04), join, s0),
                                    curveAt(small, vec2(0.48, 0.04), join, s1), 0.030));
      }
      trim = stems;
      skinCol = u_lacquer * 0.45;
      litCol = u_chrome;
      gloss = 50.0;

    } else {
      // A black hole opens: a ring at two tilts, the dark disc over the middle
      // of it, and a bright rim where the light bends past the edge. It grows
      // out of a point and collapses back to one.
      float open = smoothstep(0.0, 0.16, progress) * (1.0 - smoothstep(0.84, 1.0, progress));
      vec2 q = p / max(open, 0.05);
      float r0 = length(q);
      vec2 e1 = turn(q, 0.24);
      vec2 e2 = turn(q, -0.58);
      float ringA = abs(length(vec2(e1.x, e1.y / 0.30)) - 0.80) - 0.13;
      float ringB = abs(length(vec2(e2.x, e2.y / 0.17)) - 0.97) - 0.085;
      d = max(min(ringA, ringB), r0 - 1.30);
      lit = r0 - 0.34;
      trim = abs(r0 - 0.43) - 0.024;
      skinCol = u_enamel;
      litCol = u_lacquer * 0.06;
      gloss = 9.0;
    }

    // The shadow it lays on the board, which is what sets it off the paint.
    float sd = min(min(d, lit), trim);
    c = over(c, vec4(u_lacquer * 0.28, smoothstep(0.13, -0.02, sd + 0.05) * 0.55 * fade));

    vec2 g1 = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
    float in1 = clamp(-d * 2.4, 0.0, 1.0);
    vec3 n1 = normalize(vec3(g1 * (1.0 - in1) * 1.5, 0.42 + 0.58 * in1));
    vec3 col1 = skinCol * u_lamp * (0.14 + 0.92 * max(dot(n1, L), 0.0) * fall);
    col1 += u_lamp * skinCol * specular(n1, L, gloss) * 0.42 * fall;
    c = over(c, vec4(col1, cover(d) * fade));

    vec2 g2 = normalize(vec2(dFdx(lit), dFdy(lit)) + vec2(1e-6, 0.0));
    float in2 = clamp(-lit * 2.4, 0.0, 1.0);
    vec3 n2 = normalize(vec3(g2 * (1.0 - in2) * 1.5, 0.42 + 0.58 * in2));
    vec3 col2 = litCol * u_lamp * (0.18 + 0.95 * max(dot(n2, L), 0.0) * fall);
    col2 += u_lamp * litCol * specular(n2, L, 26.0) * 0.40 * fall;
    c = over(c, vec4(col2, cover(lit) * fade));

    c = over(c, vec4(u_glow * (0.85 + 1.25 * fall), cover(trim) * fade * 0.92));

  } else if (kind == 2) {
    // Every mouth is paying more. The whole board is hot, so the board itself
    // says so: a band of light running down it and a rim round the edge, and
    // nothing in the middle, because the middle is where the game is.
    vec2 n = v_off / max(v_half, vec2(1e-4));
    float rim = smoothstep(0.0, 0.16, 1.0 - max(abs(n.x), abs(n.y)));
    float edge = (1.0 - rim) * fade;
    float sweepBand = smoothstep(0.30, 0.0, abs(fract(n.y * 0.5 - t * 0.22) - 0.5) - 0.16);
    float amount = clamp((extra - 1.0) / 3.0, 0.15, 1.0);
    float a = edge * (0.30 + 0.55 * sweepBand) * amount;
    if (a < 0.004) discard;
    c = over(c, vec4(u_glow * (0.8 + 1.2 * fall), clamp(a, 0.0, 1.0)));

  } else {
    // A row of doors, one of which is worth opening. Shut they are brass with
    // a seam and a handle; once the row is read the one that pays is open and
    // lit and the rest have gone dull.
    // The row sits at the foot of the face where the lamp reaches least, so it
    // carries a floor of light of its own; a dull row reads as a broken one.
    float lit = max(fall, 0.75);
    float n = floor(extra / 1000.0);
    float pick = floor(mod(extra, 1000.0) / 100.0);
    float called = floor(mod(extra, 100.0) / 10.0);   // 0 for none, else the door and one
    float shown = mod(extra, 10.0);
    float slot = (v_off.x / v_half.x * 0.5 + 0.5) * n;
    float which = clamp(floor(slot), 0.0, n - 1.0);
    float doorW = v_half.x / n;
    vec2 p = vec2(v_off.x - (which + 0.5 - n * 0.5) * doorW * 2.0, v_off.y);
    // Each machine hangs its own doors: portholes on the tide pool and among
    // the stars, an arched glasshouse door, planked timber at the diggings, a
    // chamfered hatch on the furnace, and the rounded door of the jukebox.
    int look = int(u_show.w + 0.5);
    bool port = look == 0 || look == 5;
    float side = min(doorW * 0.82, v_half.y * 0.86);
    vec2 bx = port ? vec2(side) : vec2(doorW * 0.82, v_half.y * 0.86);
    float rad = port ? side * 0.98
      : look == 1 ? doorW * 0.60
      : look == 2 ? doorW * 0.05
      : look == 3 ? doorW * 0.36
      : doorW * 0.28;
    float d = sdBox(p, bx, rad);

    float isPick = step(abs(which - pick), 0.4) * step(0.5, shown);
    float dull = step(0.5, shown) * (1.0 - isPick);

    c = over(c, vec4(u_lacquer * 0.32, smoothstep(doorW * 0.4, -doorW * 0.1,
      sdBox(p - away * doorW * 0.25, bx, rad)) * 0.75 * fade));

    // Open, and paying.
    vec3 open = mix(u_glow, u_lamp, 0.25) * (1.1 + 1.9 * lit);
    // Shut, and either still a question or already answered.
    vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
    vec3 nb = normalize(vec3(grad * 0.9, 0.65));
    vec3 shut = u_brass * u_lamp * (0.12 + 0.85 * max(dot(nb, L), 0.0) * lit);
    shut += u_lamp * u_brass * specular(nb, L, 20.0) * 0.32 * lit;
    shut *= mix(1.0, 0.42, dull);
    // Before the row is read, every door breathes on its own beat, so a player
    // watches all of them rather than one.
    shut *= 1.0 + (1.0 - step(0.5, shown)) * 0.22 * sin(t * 3.0 + which * 2.1);

    c = over(c, vec4(mix(shut, open, isPick), cover(d) * fade));
    // The seam down the middle of a shut door - three seams between the
    // planks of a timber door, and a rim instead of a seam on a porthole.
    float sx = look == 2 ? min(abs(p.x), min(abs(p.x - doorW * 0.5), abs(p.x + doorW * 0.5))) : abs(p.x);
    float seam = port ? abs(d + doorW * 0.12) - doorW * 0.03 : max(sx - doorW * 0.03, d + doorW * 0.18);
    c = over(c, vec4(u_brass * 0.22, cover(seam) * fade * (1.0 - isPick)));
    // The door the player called wears a lamp keyline until the row is read.
    float isCalled = step(abs(which + 1.0 - called), 0.4) * (1.0 - step(0.5, shown));
    float ring = abs(d + doorW * 0.10) - doorW * 0.045;
    c = over(c, vec4(u_lamp * (1.2 + 0.8 * lit), smoothstep(doorW * 0.04, 0.0, ring) * isCalled * fade * 0.9));
  }

  fragColor = outColour(c.rgb, c.a);
}`;

// ---- hit marks ------------------------------------------------------------
export const FLASH_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // t (1 down to 0), kind, seed, 0
out vec4 fragColor;
uniform vec3 u_flashTint[4];
` + COMMON + `
void main() {
  vec2 p = v_off / max(v_half.x, 1e-5);
  float d = length(p);
  float t = clamp(v_data.x, 0.0, 1.0);
  int kind = int(v_data.y + 0.5);

  // A struck pin catches the lamp harder for a moment. It is a ring of
  // brighter reflection opening outward, never a light of its own, so it is
  // laid over the metal rather than added to it.
  float ring = smoothstep(0.16, 0.0, abs(d - (1.0 - t * 0.35)) - 0.05);
  float core = smoothstep(0.30, 0.0, d) * t * t;
  float a = clamp(ring * t * 0.30 + core * 0.30, 0.0, 1.0) * clamp(lampFall(v_board), 0.0, 1.4);

  vec3 tint = mix(u_lamp, u_flashTint[kind], 0.45);
  fragColor = outColour(tint * (0.8 + 0.6 * t), a);
}`;

// ---- the counter window ---------------------------------------------------
export const REEL_FS = HEAD + `
in vec2 v_off;
in vec2 v_half;
in vec2 v_board;
in vec4 v_data;   // digit (below zero when dark), slot, isFrame, lit
out vec4 fragColor;
` + COMMON + `
` + digitGlsl() + `
void main() {
  vec3 L = lampDir(v_board);
  float fall = lampFall(v_board);
  vec2 away = -normalize(L.xy + vec2(1e-6, 0.0));
  bool frame = v_data.z > 0.5;
  // A window set into the show screen is already surrounded by its housing, so
  // it gets a drum bezel and nothing more. A window standing on the lacquer on
  // its own still gets the brass.
  bool housed = frame ? v_data.y > 0.5 : v_data.w > 0.5;
  // The window is furniture and is always there. Whether anything is showing
  // in it is a different question, and a dark window is a state of its own
  // rather than an absence.
  bool lit = frame ? v_data.w > 0.5 : v_data.x >= 0.0;
  vec4 c = vec4(0.0);

  if (frame && housed) {
    // Just the well the drums turn in, and a hairline of chrome round it.
    float lip = min(v_half.x, v_half.y) * 0.16;
    float d = sdBox(v_off, v_half, lip * 0.8);
    vec3 rim = u_chrome * u_lamp * (0.18 + 0.90 * fall) + u_lamp * 0.45 * fall;
    c = over(c, vec4(rim, cover(d)));
    c = over(c, vec4(u_screen * 0.55, cover(d + lip * 0.55)));
    fragColor = outColour(c.rgb, c.a);
    return;
  }

  if (frame) {
    // A brass surround with the window recessed into it.
    float lip = min(v_half.x, v_half.y) * 0.30;
    float d = sdBox(v_off, v_half, lip * 0.9);
    float sd = sdBox(v_off - away * lip * 0.9, v_half, lip * 0.9);
    c = over(c, vec4(u_lacquer * 0.12, smoothstep(lip, -lip * 0.2, sd) * 0.7));

    float band = clamp(-d / lip, 0.0, 1.0);
    vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
    vec3 n = normalize(vec3(grad * (1.0 - band) * 1.5, 0.5 + 0.5 * band));
    vec3 col = u_brass * u_lamp * (0.10 + 0.80 * max(dot(n, L), 0.0) * fall);
    col += u_lamp * u_brass * specular(n, L, 36.0) * 1.1 * fall;
    col += u_lamp * specular(n, L, 300.0) * 0.55 * fall;
    c = over(c, vec4(col, cover(d)));

    // The dark well the drums turn in.
    float well = sdBox(v_off, v_half - lip, lip * 0.4);
    c = over(c, vec4(u_lacquer * 0.05, cover(well)));

    fragColor = outColour(c.rgb, c.a);
    return;
  }

  // A drum: a cylinder lying across the window, so the lamp lays a band down
  // the middle of it and both edges fall away.
  vec2 p = v_off / max(v_half.y, 1e-5);
  float across = clamp(v_off.y / max(v_half.y, 1e-5), -1.0, 1.0);
  float d = sdBox(v_off, v_half, min(v_half.x, v_half.y) * 0.12);
  vec3 n = normalize(vec3(0.0, across * 0.9, sqrt(max(0.05, 1.0 - across * across * 0.81))));

  // The drums are always in the window. When nothing is turning they are
  // simply unlit, which is a machine at rest rather than a hole in the face.
  float on = lit ? 1.0 : 0.0;
  vec3 body = mix(u_enamel * 0.20, u_enamel, on);
  vec3 drum = body * u_lamp * (0.08 + mix(0.30, 0.86, on) * max(dot(n, L), 0.0) * fall);
  drum += u_lamp * body * specular(n, L, 16.0) * mix(0.25, 0.6, on) * fall;

  // The drum face is pressed with this machine's own mark, so a set of three
  // reads as the cabinet's drums rather than as three blank discs. It is a
  // shallow relief in the face's own colour, held well away from the depth of
  // the ink, because the figure has to stay the only dark thing in the window.
  int look = int(u_show.w + 0.5);
  float mark = 0.0;
  if (look == 0) {
    // Rings running out from the middle, the way water leaves them.
    float rr = length(p * vec2(0.62, 1.0));
    mark = smoothstep(0.030, 0.008, abs(fract(rr * 2.4 + 0.5) - 0.5) / 2.4);
  } else if (look == 1) {
    // A leaf, veined down its length.
    mark = smoothstep(0.045, 0.010, abs(abs(p.x) * 0.62 - (p.y + 0.60)))
         + smoothstep(0.035, 0.008, abs(p.x)) * smoothstep(0.90, 0.20, abs(p.y));
  } else if (look == 2) {
    // The rim of a pan.
    mark = smoothstep(0.045, 0.012, abs(length(p * vec2(0.62, 1.0)) - 0.72));
  } else if (look == 3) {
    // An ingot, chamfered off at its corners.
    mark = smoothstep(0.045, 0.012, abs(sdBox(p, vec2(0.48, 0.72), 0.22)));
  } else if (look == 4) {
    // A record label: the paper and the run out groove around it.
    float rr = length(p * vec2(0.62, 1.0));
    mark = smoothstep(0.045, 0.012, abs(rr - 0.74)) + smoothstep(0.045, 0.012, abs(rr - 0.42));
  } else {
    // Three stars, which is as much constellation as a drum holds.
    mark = smoothstep(0.070, 0.030, length(p - vec2(-0.40, -0.56)))
         + smoothstep(0.070, 0.030, length(p - vec2(0.34, -0.10)))
         + smoothstep(0.070, 0.030, length(p - vec2(-0.16, 0.62)));
  }
  drum = mix(drum, drum * 0.82, clamp(mark, 0.0, 1.0) * on);

  // The figure, pressed into the drum: dark ink with a lit shoulder on the
  // lamp side, the way a stamped numeral catches light.
  float em = v_half.y * 1.30;
  float gd = digitDistance(int(abs(v_data.x) + 0.5), vec2(p.x, -p.y) * v_half.y / em * 2.0);
  float ink = cover(gd * em) * on;
  float shoulder = (cover((gd + em * 0.05) * em) - cover(gd * em)) * on;
  // The ink is a deep shade of the machine's own colour rather than its
  // lettering colour: the drum face is the skin's bright enamel on every
  // machine, so the figure has to be dark on all six - including the one
  // whose lettering elsewhere is light because its face is dark. A figure
  // lit by the lamp fraction went grey on the pale drums and read as mud.
  drum = mix(drum, u_lacquer * (0.07 + 0.08 * fall), ink);
  drum += u_lamp * u_enamel * shoulder * 0.35 * fall;

  // The glass over the window takes a streak.
  float streak = smoothstep(0.55, 0.0, abs(p.x * 0.6 + across - 0.25));
  drum += u_lamp * streak * 0.05 * fall * u_reflect;

  c = over(c, vec4(drum, cover(d)));
  fragColor = outColour(c.rgb, c.a);
}`;

// ---- the glass, the bezel, and the way out --------------------------------
export const COMPOSITE_FS = HEAD + `
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform vec2 u_res;      // the drawing buffer, in pixels
uniform vec4 u_face;     // centre xy, half size xy, in pixels
uniform vec4 u_fit;      // face origin xy in pixels, pixels per board unit
uniform float u_decode;  // 1 when the scene texture holds sRGB bytes
uniform float u_glass;
uniform float u_shadow;  // 1 when the contact shadows are being paid for
uniform float u_bezel;   // bezel thickness in pixels
uniform int u_nameLen;
` + COMMON + `
const int MAX_NAME = ${MAX_LETTERS};
uniform int u_name[MAX_NAME];
` + marqueeGlsl() + `
// Softening for a field that is already measured in pixels. One pixel wide,
// no derivative, and therefore safe to use inside a branch.
float coverPx(float d) { return clamp(0.5 - d, 0.0, 1.0); }

vec3 srgbToLinear3(vec3 c) {
  return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main() {
  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 rel = px - u_face.xy;
  float corner = min(u_face.z, u_face.w) * 0.03;
  float d = sdBox(rel, u_face.zw, corner);
  vec2 board = (px - u_fit.xy) / max(u_fit.z, 1e-6);
  float fall = lampFall(board);

  vec2 uv = v_uv;

  // Bevelled glass. The sheet is thicker at its edges, so the picture bends
  // there and the light gathers. The bend is a small pull of the sample
  // toward the middle of the face, strongest in the last few millimetres.
  float bevelW = min(u_face.z, u_face.w) * 0.045;
  float bevel = 1.0 - smoothstep(-bevelW, 0.0, d);     // 1 inside, 0 at the rim
  if (u_glass > 0.5) {
    vec2 pull = normalize(rel + vec2(1e-6, 0.0)) * (1.0 - bevel) * bevelW * 0.28;
    uv -= vec2(pull.x / u_res.x, -pull.y / u_res.y);
  }

  vec3 scene = texture(u_scene, uv).rgb;
  vec3 lin = mix(scene, srgbToLinear3(scene), u_decode);

  if (u_glass > 0.5) {
    // One soft diagonal sheen across the whole sheet, with a narrower second
    // pass beside it, drifting slowly enough to read as the room moving
    // rather than as an effect.
    vec2 g = rel / max(u_face.w, 1.0);
    float t = dot(g, normalize(vec2(0.78, -0.62))) + sin(u_time * 0.07) * 0.06;
    float wide = smoothstep(0.55, 0.0, abs(t + 0.18));
    float tight = smoothstep(0.10, 0.0, abs(t - 0.34));
    float sheen = wide * 0.014 + tight * 0.030;
    // Parts on the glass show on the glass: a heavier, brighter sheet.
    sheen *= 1.0 + 0.9 * clamp(u_parts.w, 0.0, 2.0);
    // The light pools where the sheet is thickest.
    sheen += (1.0 - bevel) * 0.030;
    sheen *= clamp(fall, 0.0, 1.6) * step(d, 0.0);
    lin += u_lamp * sheen;
    // And the sheet's own body dims what is under it very slightly.
    lin *= mix(1.0, 0.97, step(d, 0.0));
  }

  // A hairline chrome bezel, mitred at the corners.
  float outer = u_bezel;
  float frame = smoothstep(outer, outer * 0.5, d) * step(0.0, d);
  vec2 fg = normalize(rel + vec2(1e-6, 0.0));
  vec3 bn = normalize(vec3(fg * 0.85, 0.5));
  vec3 L = lampDir(board);
  vec3 chrome = u_chrome * u_lamp * (0.06 + 0.55 * max(dot(bn, L), 0.0) * fall);
  chrome += u_lamp * specular(bn, L, 220.0) * 1.4 * fall;
  chrome += u_lamp * u_chrome * specular(bn, L, 22.0) * 0.9 * fall;
  // The bright wire right on the inside edge is what makes it read hairline.
  float wire = smoothstep(1.5, 0.0, abs(d + 1.0));
  chrome += u_lamp * wire * 0.9 * fall;
  // The mitre: the seam where two lengths of the frame meet on the diagonal.
  vec2 a = abs(rel);
  float diag = abs((a.x - u_face.z) - (a.y - u_face.w)) * 0.7071;
  float inCorner = step(u_face.z, a.x) * step(u_face.w, a.y);
  float mitre = smoothstep(1.2, 0.0, diag) * inCorner;
  chrome *= 1.0 - mitre * 0.55;
  lin = mix(lin, chrome, frame);

  // ---- the cabinet the glass is set into ---------------------------------
  // Not one pixel of this is playfield, so the whole body is skipped on the
  // pixels that are. Everything in it is measured in pixels already, which
  // means its edges are softened against a fixed width rather than against a
  // screen derivative - that is what makes the branch safe, and it is also
  // one less derivative per shape.
  // Everything past the bezel is the machine as an object: a moulded body, a
  // lamp down each side, a lit sign on top and the dish the balls fall into.
  // A face with nothing round it is a diagram; this is what makes it a thing
  // somebody could sit down at.
  if (d > -outer * 3.0) {
  vec2 fh = u_face.zw;
  vec2 pad = vec2(fh.x * 0.130, fh.y * 0.055);
  float topH = fh.y * 0.205;
  float dishH = fh.y * 0.235;
  vec2 cabHalf = vec2(fh.x + pad.x, fh.y + pad.y + (topH + dishH) * 0.5);
  vec2 cabC = u_face.xy + vec2(0.0, (dishH - topH) * 0.5);
  vec2 crel = px - cabC;
  float dcab = sdBox(crel, cabHalf, fh.x * 0.10);

  // The room. Dark on purpose: the cabinet is the only lit thing in frame.
  vec3 cab = u_room * (0.55 + 0.45 * clamp(fall, 0.0, 1.6));

  // The shadow the whole machine lays on the floor behind it.
  cab *= mix(0.42, 1.0, smoothstep(0.0, fh.x * 0.34, dcab));

  // Past here is nothing but room, and room is one multiply.
  if (dcab > min(fh.x, fh.y) * 0.14) {
    lin = mix(cab, lin, smoothstep(outer * 1.6, outer * 0.4, d));
    fragColor = vec4(linearToSrgb3(lin) + (hash21(px + fract(u_time) * 17.0) - 0.5) / 255.0, 1.0);
    return;
  }

  // The moulding.
  float shellB = min(fh.x, fh.y) * 0.085;
  float sband = clamp(-dcab / shellB, 0.0, 1.0);
  // The way the moulding faces, worked out from the box itself rather than
  // from a derivative, so it is right inside a branch and costs less.
  vec2 sgr = normalize(sign(crel) * max(abs(crel) - cabHalf + shellB, vec2(0.0)) + vec2(1e-5, 1e-5));
  vec3 sn = normalize(vec3(sgr * (1.0 - sband) * 1.5, 0.5 + 0.5 * sband));
  vec3 shell = u_shell * u_lamp * (0.30 + 1.15 * max(dot(sn, L), 0.0) * fall);
  if (u_glass > 0.5) {
    shell += u_lamp * specular(sn, L, 70.0) * 0.30 * fall;
    shell += u_lamp * u_shell * specular(sn, L, 14.0) * 0.25 * fall;
  }
  shell += u_glow * u_show.x * (1.0 - sband) * 0.30;
  cab = mix(cab, shell, coverPx(dcab));

  // The two lamps down the sides. They breathe when the machine is resting and
  // chase upward when it is escalating, which is the oldest tell there is.
  vec2 lrel = vec2(abs(px.x - u_face.x) - (fh.x + pad.x * 0.50), px.y - u_face.y);
  float lampR = pad.x * 0.27;
  float dlamp = length(vec2(lrel.x, max(abs(lrel.y) - fh.y * 0.78, 0.0))) - lampR;
  float run = fract(-(px.y - u_face.y) / max(fh.y, 1.0) * (0.9 + 1.8 * u_show.x)
                    - u_time * (0.22 + 2.4 * u_show.x));
  float breathe = 0.55 + 0.45 * sin(u_time * 1.5);
  float chase = smoothstep(0.0, 0.30, run) * smoothstep(0.90, 0.42, run);
  vec3 lampTube = mix(u_lamp, u_glow, 0.30 + 0.60 * u_show.x)
                * (0.60 + 2.1 * u_show.x)
                * (0.40 + 0.90 * mix(breathe, chase, u_show.x));
  float inTube = coverPx(dlamp);
  cab = mix(cab, lampTube, inTube);
  // and the light it throws on the moulding beside it
  if (u_glass > 0.5) cab += lampTube * 0.55 * exp(-max(dlamp, 0.0) / max(lampR * 1.5, 1e-3)) * (1.0 - inTube);

  // The sign on top. A lit panel with the machine's name in tubes across it,
  // the unlit tubes still faintly visible the way they are on a real sign.
  float topY = u_face.y - fh.y - pad.y - topH * 0.52;
  vec2 trel = vec2(px.x - u_face.x, px.y - topY);
  vec2 tHalf = vec2(fh.x * 0.88, topH * 0.42);
  float dtop = sdBox(trel, tHalf, topH * 0.24);
  float em = topH * 0.19;
  float adv = em * 1.30;
  float total = adv * float(max(u_nameLen, 1));
  vec3 signCol = mix(u_screen, u_glow, 0.34 + 0.40 * u_show.x) * (1.55 + 2.0 * u_show.x);
  if (dtop < em && abs(trel.x) < total * 0.5 + adv && abs(trel.y) < em * 1.6) {
    int li = int(floor((trel.x + total * 0.5) / adv));
    vec2 lp = vec2(trel.x + total * 0.5 - (float(clamp(li, 0, u_nameLen - 1)) + 0.5) * adv, -trel.y) / max(em, 1e-4);
    vec2 letter = letterDistance(u_name[clamp(li, 0, MAX_NAME - 1)], lp);
    float onSign = step(0.0, float(li)) * step(float(li), float(u_nameLen) - 0.5);
    // The unlit tubes: just visible, the way they are on a real sign in daylight.
    signCol *= 1.0 - coverPx(letter.y * em) * 0.16 * onSign;
    // The lit ones, with the halo the tube throws on the panel behind it.
    float glyph = coverPx(letter.x * em) * onSign;
    float halo = exp(-max(letter.x * em, 0.0) / max(em * 0.55, 1e-3)) * onSign;
    if (u_glass > 0.5) signCol += mix(u_lamp, u_glow, 0.35) * halo * (0.30 + 0.60 * u_show.x);
    signCol = mix(signCol, mix(u_lamp, u_glow, 0.12) * (2.4 + 3.4 * u_show.x), glyph);
  }
  float inTop = coverPx(dtop);
  cab = mix(cab, signCol, inTop);
  if (u_glass > 0.5) cab += signCol * 0.20 * exp(-max(dtop, 0.0) / max(topH * 0.18, 1e-3)) * (1.0 - inTop);

  // The dish. A chrome trough with a rolled lip, and the balls that are in it.
  float dishY = u_face.y + fh.y + pad.y + dishH * 0.46;
  vec2 drel = vec2(px.x - u_face.x, px.y - dishY);
  vec2 dHalf = vec2(fh.x * 0.93, dishH * 0.38);
  float ddish = sdBox(drel, dHalf, dishH * 0.30);
  float dinner = ddish + dishH * 0.085;
  float acr = clamp(drel.y / max(dHalf.y, 1.0), -1.0, 1.0);
  vec3 lipRoll = u_chrome * u_lamp * (0.20 + 1.00 * fall) + u_lamp * 0.55 * fall;
  cab = mix(cab, lipRoll, coverPx(ddish));
  vec3 trough = u_chrome * u_lamp * (0.06 + 0.45 * (0.5 - 0.5 * acr) * fall);
  trough *= 0.30 + 0.70 * smoothstep(-1.0, 0.5, acr);
  cab = mix(cab, trough, coverPx(dinner));
  // Balls, sitting where they landed. A dish with nothing in it is a machine
  // nobody has played.
  if (u_shadow > 0.5 && dinner < dishH * 0.2) {
    float bs = dishH * 0.115;
    vec2 bcell = vec2(drel.x, drel.y - dHalf.y * 0.34) / (bs * 2.05);
    vec2 bi = floor(bcell);
    vec2 bf = (fract(bcell) - 0.5) * 2.05 * bs;
    float have = step(hash21(bi * 1.7 + 3.0), 0.68) * step(abs(bi.y + 0.5), 1.0);
    float dball = length(bf) - bs;
    vec3 bn = normalize(vec3(bf / max(bs, 1e-3) * 0.9, 0.6));
    vec3 ballCol = u_chrome * u_lamp * (0.10 + 0.55 * max(dot(bn, L), 0.0) * fall);
    ballCol += u_lamp * specular(bn, L, 40.0) * 1.3 * fall;
    cab = mix(cab, ballCol, coverPx(dball) * have * coverPx(dinner + bs * 0.4));
  }

  lin = mix(cab, lin, smoothstep(outer * 1.6, outer * 0.4, d));
  }

  // A dither below the last bit, because a lacquer this dark bands without it.
  float dither = (hash21(px + fract(u_time) * 17.0) - 0.5) / 255.0;
  fragColor = vec4(linearToSrgb3(lin) + dither, 1.0);
}`;
