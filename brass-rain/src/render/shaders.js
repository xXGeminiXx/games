// ---------------------------------------------------------------------------
// Every surface on the machine, as shader source.
//
// The rule the whole file is written to: nothing emits light. Each material
// is told where the lamp is and works out what it reflects, so a bright pixel
// is always brass, chrome, enamel or glass catching one source hung above and
// slightly left of the face. That is why there is no bloom pass and no
// additive blending anywhere in here - both would make a surface brighter
// than the light falling on it, which is the exact look this face is not.
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

import { digitGlsl } from './digits.js?v=2';

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
  vec3 lac = u_lacquer * (0.12 * u_lamp + 1.15 * u_lamp * fall * max(L.z, 0.0));
  lac += u_lamp * u_lacquer * specular(n, L, 9.0) * 1.6 * fall;
  lac += u_lamp * specular(n, L, 260.0) * 0.075 * fall;

  // The grain of the lacquer, and a faint sweep left by the brush under it.
  float grain = hash21(floor(px * 0.5)) - 0.5;
  float sweep = sin(p.x * 0.7 + p.y * 0.21) * sin(p.y * 0.9) * 0.5;
  lac *= 1.0 + grain * 0.035 + sweep * 0.020;

  // The lacquer turns down into the frame at the rim: a dark seam with the
  // lamp catching the fold just inside it.
  float rimIn = smoothstep(0.0, -u_board.y * 0.010, d);
  float fold = smoothstep(-u_board.y * 0.020, -u_board.y * 0.006, d) * (1.0 - rimIn * 0.0);
  lac *= mix(0.34, 1.0, rimIn);
  lac += u_lamp * u_lacquer * fold * (1.0 - rimIn) * 0.6 * fall;

  // Outside the face is the cabinet, which the lamp barely reaches.
  vec3 surround = u_lacquer * 0.055 * (0.4 + 0.6 * fall);
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
  c = over(c, vec4(u_lacquer * 0.10, smoothstep(0.55, -0.15, sd) * 0.75));

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
  brass += u_lamp * u_brass * specular(n, L, 14.0) * 2.2 * fall;
  brass += u_lamp * specular(n, L, 90.0) * 0.85 * fall;
  // The bounce back off the lacquer keeps the shadowed underside warm rather
  // than merely dark, which is the difference between brass and plastic.
  brass += u_lacquer * u_brass * max(-n.y, 0.0) * 0.9 * fall * u_reflect;
  // The rim itself: the lamp takes the near edge as a bright arc and the far
  // edge drops away, which is the whole reason a head this small reads as
  // round rather than as a dot.
  float arc = dot(normalize(p + vec2(1e-5, 0.0)), normalize(L.xy + vec2(1e-6, 0.0)));
  float atRim = smoothstep(0.62, 0.97, d);
  brass *= 1.0 + dot(p, normalize(L.xy + vec2(1e-6, 0.0))) * 0.20 * (1.0 - atRim);
  brass += u_lamp * u_brass * atRim * max(arc, 0.0) * 1.5 * fall;
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

  vec3 col = u_chrome * u_lamp * (0.035 + 0.46 * ndl * fall);
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
  col += u_lamp * smoothstep(0.50, 0.22, hd) * 1.15 * fall;
  col += u_lamp * smoothstep(0.20, 0.05, hd) * 2.8 * fall;

  // The lacquer thrown back up under it, and a little of the brass it has
  // been falling through. This is the warm half of a chrome ball and without
  // it a ball on a dark face is a hole in the face.
  float under = max(-n.y, 0.0);
  col += u_lacquer * 15.0 * pow(under, 2.6) * fall * u_reflect;
  col += u_brass * 0.22 * pow(under, 4.5) * fall * u_reflect;

  // A horizon that rides with the spin, so a rolling ball reads as rolling
  // without a trail behind it.
  float band = sin(v_spin + atan(q.y, q.x) * 2.0) * 0.5 + 0.5;
  col *= mix(1.0, 0.80 + 0.30 * band, 0.45 * u_reflect);

  // A bright hairline just inside the silhouette, then a dark seat right on
  // it. The hairline has to stay narrow: widen it and a small ball stops
  // reading as a sphere and starts reading as a ring.
  col += u_lamp * u_chrome * smoothstep(0.70, 0.97, d) * (0.15 + 0.85 * ndl) * 1.0 * fall;
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
  fragColor = outColour(u_lacquer * 0.02, a);
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
  c = over(c, vec4(u_lacquer * 0.14, smoothstep(halfT * 0.9, -halfT * 0.2, sd) * 0.55));

  // A wall is a half round chrome bar; a deflector is a flatter brass plate,
  // so its face stays broad and only the near edge turns over.
  float turnOver = guide ? 0.55 : 1.0;
  vec2 nxy = v_perp * across * turnOver;
  vec3 n = normalize(vec3(nxy, sqrt(max(0.04, 1.0 - dot(nxy, nxy)))));

  vec3 base = guide ? u_brass : u_chrome;
  float ndl = max(dot(n, L), 0.0);
  vec3 col = base * u_lamp * ((guide ? 0.08 : 0.04) + (guide ? 1.25 : 0.55) * ndl * fall);
  col += u_lamp * base * specular(n, L, guide ? 18.0 : 34.0) * (guide ? 1.5 : 2.2) * fall;
  col += u_lamp * specular(n, L, guide ? 120.0 : 200.0) * (guide ? 0.45 : 1.30) * fall;
  col += u_lacquer * base * max(-n.y, 0.0) * 0.8 * fall * u_reflect;
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

  // Everything standing off the face throws the same hard little shadow.
  float sd = sdBox(v_off - away * lip * 1.4, hs, radius);
  c = over(c, vec4(u_lacquer * 0.10, smoothstep(lip * 1.5, -lip * 0.2, sd) * 0.8));

  // The brass surround. Its face rolls outward across the band, so the lamp
  // takes the near edge and the far edge drops away.
  float lipW = gate ? lip * 1.7 : (attacker ? lip * 1.3 : lip);
  float band = clamp(-d / lipW, 0.0, 1.0);
  vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
  vec3 nl = normalize(vec3(grad * (1.0 - band) * 1.4, 0.55 + 0.45 * band));
  vec3 lipCol = u_brass * u_lamp * (0.08 + 1.25 * max(dot(nl, L), 0.0) * fall);
  lipCol += u_lamp * u_brass * specular(nl, L, 20.0) * 1.7 * fall;
  lipCol += u_lamp * specular(nl, L, 120.0) * 0.7 * fall;
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
      vec3 jadeCol = u_pocketFill[1] * u_lamp * (0.40 + 3.4 * fall);
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
  vec3 face = fill * u_lamp * (0.16 + 1.35 * max(dot(ne, L), 0.0) * fall);
  face += u_lamp * fill * specular(ne, L, 22.0) * 0.85 * fall;
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
  c = over(c, vec4(u_lacquer * 0.10, smoothstep(w * 0.7, -w * 0.2, sd) * 0.65));

  // The floor of the channel, dark and slightly warm.
  c = over(c, vec4(u_lacquer * u_lamp * (0.04 + 0.18 * fall), cover(d)));

  // Two rails, one either side. The inner one is the edge a ball runs
  // against, so it carries the brighter hairline.
  float rail = 1.0 - smoothstep(0.34, 0.66, abs(across));
  float onRail = 1.0 - rail;
  vec2 nxy = radial * across * onRail;
  vec3 n = normalize(vec3(nxy, sqrt(max(0.05, 1.0 - dot(nxy, nxy)))));
  vec3 col = u_chrome * u_lamp * (0.05 + 0.70 * max(dot(n, L), 0.0) * fall);
  col += u_lamp * u_chrome * specular(n, L, 30.0) * 2.0 * fall;
  col += u_lamp * specular(n, L, 220.0) * 1.2 * fall;
  float inside = smoothstep(-0.60, -0.95, across);
  col += u_lamp * inside * 0.55 * fall;
  c = over(c, vec4(col, cover(d) * onRail));

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
  // The window is furniture and is always there. Whether anything is showing
  // in it is a different question, and a dark window is a state of its own
  // rather than an absence.
  bool lit = frame ? v_data.w > 0.5 : v_data.x >= 0.0;
  vec4 c = vec4(0.0);

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

  // The figure, pressed into the drum: dark ink with a lit shoulder on the
  // lamp side, the way a stamped numeral catches light.
  float em = v_half.y * 1.30;
  float gd = digitDistance(int(abs(v_data.x) + 0.5), vec2(p.x, -p.y) * v_half.y / em * 2.0);
  float ink = cover(gd * em) * on;
  float shoulder = (cover((gd + em * 0.05) * em) - cover(gd * em)) * on;
  drum = mix(drum, u_oxblood * (0.12 + 0.5 * fall), ink);
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
uniform float u_bezel;   // bezel thickness in pixels
` + COMMON + `
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

  // Outside the frame the cabinet falls away into the room.
  float outside = smoothstep(outer * 0.5, outer * 2.5, d);
  lin *= mix(1.0, 0.35, outside);

  // A dither below the last bit, because a lacquer this dark bands without it.
  float dither = (hash21(px + fract(u_time) * 17.0) - 0.5) / 255.0;
  fragColor = vec4(linearToSrgb3(lin) + dither, 1.0);
}`;
