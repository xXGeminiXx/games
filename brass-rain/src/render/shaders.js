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

import { digitGlsl } from './digits.js?v=6';
import { marqueeGlsl, MAX_LETTERS } from './marquee.js?v=6';

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
  c = over(c, vec4(col, cover(d) * onRail));

  fragColor = outColour(c.rgb, c.a);
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

  vec3 field = u_screen * (0.60 + 0.40 * fall);
  int look = int(u_show.w + 0.5);

  if (look == 0) {
    // A shallow reef at noon. Two scrolling noise layers thresholded together
    // are a caustic net, and things drift through it.
    float ca = fbm(q * 3.2 + vec2(t * 0.07, t * 0.04));
    if (u_reflect > 0.5) ca += fbm(q * 4.7 - vec2(t * 0.05, t * 0.09)); else ca += 0.5;
    field += u_lamp * pow(max(ca - 0.86, 0.0), 2.0) * 2.2 * (0.35 + 0.65 * heat);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 jc = vec2(sin(t * 0.23 + fi * 2.1) * 0.60, cos(t * 0.17 + fi * 1.7) * 0.42 - 0.10);
      float jd = length((q - jc) / vec2(1.0, 0.62)) - 0.13;
      field += u_glow * smoothstep(0.09, -0.02, jd) * 0.55;
      // tentacles, as a sine trailing below the bell
      float tx = jc.x + sin((q.y - jc.y) * 9.0 + t * 2.0 + fi) * 0.05;
      field += u_glow * smoothstep(0.020, 0.0, abs(q.x - tx))
             * smoothstep(0.0, -0.34, q.y - jc.y) * 0.35;
    }
  } else if (look == 1) {
    // A greenhouse gone feral. Vines climb from the floor of the panel, and
    // how far up they have got is how far the machine has climbed.
    float grew = -1.0 + 2.0 * (0.30 + 0.70 * heat);
    for (int i = 0; i < 3; i++) {
      float fi = float(i) - 1.0;
      float x = fi * 0.44 + sin(q.y * 3.1 + t * 0.45 + fi * 2.0) * 0.17;
      float w = 0.050 * (1.0 - (q.y * 0.5 + 0.5) * 0.55);
      float stem = smoothstep(w, 0.0, abs(q.x - x)) * step(q.y, grew);
      field += u_glow * stem * 0.60;
      // leaves, as discs pinned along the stem
      float ly = fract(q.y * 2.6 + fi) - 0.5;
      float leaf = length(vec2((q.x - x) * 1.6, ly * 0.35)) - 0.055;
      field += u_lamp * smoothstep(0.02, -0.01, leaf) * step(q.y, grew) * 0.22;
    }
    if (u_reflect > 0.5) field += u_lamp * fbm(q * 2.4 + t * 0.04) * 0.10;
  } else if (look == 2) {
    // A pan of gravel worked under running water. Every so often a grain is
    // gold and takes the light.
    vec2 g = q * 5.4 + vec2(sin(t * 0.55) * 0.28, t * 0.10);
    float grain = smoothstep(0.52, 0.86, vnoise(g));
    field += u_lamp * grain * 0.20;
    field += u_glow * step(0.94, vnoise(floor(g) * 1.7)) * grain * (0.9 + 1.6 * heat);
    float sheet = smoothstep(0.17, 0.0, abs(q.y - sin(t * 0.5) * 0.66));
    field += u_screen * sheet * 1.6 + u_lamp * sheet * 0.12;
  } else if (look == 3) {
    // The inside of a furnace: one heat field, warped, read through a
    // temperature ramp. A hotter panel is a better spin and it is legible.
    vec2 h = q * 2.0;
    if (u_reflect > 0.5) h += vec2(fbm(h * 1.5 + t * 0.22), fbm(h * 1.5 - t * 0.19)) * 0.55;
    float temp = clamp(fbm(h + vec2(0.0, -t * 0.30)) * (0.85 + 0.95 * heat), 0.0, 1.0);
    field = mix(field, u_glow, smoothstep(0.34, 0.88, temp) * 0.85);
    field += u_lamp * smoothstep(0.80, 1.0, temp) * 0.95;
    field += u_lamp * step(0.988, hash21(floor(vec2(q.x * 22.0, q.y * 18.0 - t * 6.0)))) * 0.85;
  } else if (look == 4) {
    // A jukebox seen through its glass: records on their arcs, and a tube of
    // bubbles round the whole panel.
    float rad = length(q * vec2(1.0, 1.35));
    float ring = abs(fract(rad * 3.3 - t * 0.22) - 0.5);
    field += u_glow * smoothstep(0.09, 0.0, ring) * (0.32 + 0.55 * heat);
    float edge = max(abs(q.x), abs(q.y));
    float tube = smoothstep(0.055, 0.0, abs(edge - 0.90));
    float bub = step(0.70, fract((q.x + q.y * 1.7) * 2.2 - t * 0.5));
    field += u_lamp * tube * (0.22 + 0.85 * bub);
  } else {
    // A window into deep space. Warped noise for the cloud, points with a
    // four way cross for the stars.
    vec2 wq = q * 1.6;
    if (u_reflect > 0.5) wq += vec2(fbm(wq + t * 0.030), fbm(wq.yx - t * 0.024)) * 0.9;
    float neb = fbm(wq);
    field = mix(field, u_lacquer * 0.50, smoothstep(0.34, 0.86, neb) * 0.70);
    field += u_glow * pow(max(neb - 0.62, 0.0), 2.0) * 1.8;
    vec2 cellf = fract(q * 13.0) - 0.5;
    float star = hash21(floor(q * 13.0));
    float tw = 0.55 + 0.45 * sin(t * 2.1 + star * 40.0);
    field += u_lamp * step(0.982, star) * tw * 1.6
           * smoothstep(0.045, 0.0, min(abs(cellf.x), abs(cellf.y)))
           * smoothstep(0.44, 0.0, length(cellf));
  }

  // Rays running into the middle. Their count and their speed are the rung of
  // the ladder made visible, which is the whole point of having rungs.
  float ang = atan(uv.y, uv.x);
  float rays = pow(max(sin(ang * (6.0 + 5.0 * tier) + t * (1.1 + 0.9 * tier)), 0.0), 6.0);
  field += u_glow * rays * heat * heat * 0.60 * smoothstep(0.12, 0.95, length(uv));

  // The panel lifts as a whole, and a paid spin floods it.
  field *= 1.0 + heat * 0.60;
  field += u_glow * step(3.5, phase) * beat * 0.75;
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
    // Something is crossing the board. Facing is baked into the offset so a
    // thing swimming left is the same thing turned round, not a second one.
    float shape = floor(extra);
    float leftward = step(0.25, fract(extra));
    vec2 p = v_off / max(v_half.y, 1e-4);
    p.x *= mix(1.0, -1.0, leftward);

    float d = 1e9;
    float trim = 1e9;
    if (shape < 0.5) {
      // A carp: a tapered body, a fanned tail, and one fin that beats.
      float wag = sin(t * 3.4) * 0.30;
      vec2 spine = vec2(p.x, p.y - sin(p.x * 1.7 + t * 3.4) * 0.13);
      d = length(vec2(spine.x * 0.62, spine.y)) - 0.52;
      float tail = sdSeg(p, vec2(-1.05, wag * 0.5), vec2(-1.55, wag), 0.06)
                 - smoothstep(-1.0, -1.6, p.x) * 0.22;
      d = min(d, tail);
      // The eye and the gill, which is all a fish needs to be a fish.
      trim = min(length(p - vec2(0.62, -0.12)) - 0.075,
                 abs(sdSeg(p, vec2(0.30, -0.42), vec2(0.30, 0.42), 0.0)) - 0.035);
    } else if (shape < 1.5) {
      // A paper lantern: a swollen cylinder, a cap at each end, ribs down it.
      vec2 q = vec2(p.x, p.y * 0.92);
      d = length(vec2(q.x / (0.62 + 0.10 * cos(q.y * 2.2)), q.y)) - 0.60;
      d = min(d, sdSeg(p, vec2(0.0, -0.72), vec2(0.0, 0.72), 0.16));
      trim = abs(fract(p.x * 2.6 + 0.5) - 0.5) / 2.6 - 0.022;
      trim = max(trim, d + 0.06);
    } else {
      // A hatch: a ring with bolts round it and a lit gap in the middle.
      float ring = abs(length(p) - 0.62) - 0.16;
      d = ring;
      float a = atan(p.y, p.x);
      trim = abs(length(p) - 0.62) - 0.05;
      trim = max(trim, abs(fract(a * 8.0 / 6.28318 + 0.5) - 0.5) * 0.5 - 0.03);
    }

    // The shadow it lays on the board, which is what sets it off the paint.
    float sd = min(d, trim);
    c = over(c, vec4(u_lacquer * 0.32, smoothstep(0.24, -0.06, sd + 0.12) * 0.65 * fade));
    // Brass, lit from the lamp side the way everything else on this board is.
    vec2 grad = normalize(v_off + vec2(1e-5, 1e-5));
    vec3 nb = normalize(vec3(grad * clamp(d * 3.2 + 1.0, 0.0, 1.0) * 1.1, 0.6));
    vec3 body = u_brass * u_lamp * (0.14 + 0.95 * max(dot(nb, L), 0.0) * fall);
    body += u_lamp * u_brass * specular(nb, L, 22.0) * 0.35 * fall;
    body += u_glow * 0.30 * fall;
    c = over(c, vec4(body, cover(d) * fade));
    c = over(c, vec4(mix(u_glow, u_lamp, 0.30) * (0.8 + 1.4 * fall), cover(trim) * fade * 0.9));

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
    float n = floor(extra / 100.0);
    float pick = floor(mod(extra, 100.0) / 10.0);
    float shown = mod(extra, 10.0);
    float slot = (v_off.x / v_half.x * 0.5 + 0.5) * n;
    float which = clamp(floor(slot), 0.0, n - 1.0);
    float doorW = v_half.x / n;
    vec2 p = vec2(v_off.x - (which + 0.5 - n * 0.5) * doorW * 2.0, v_off.y);
    float d = sdBox(p, vec2(doorW * 0.82, v_half.y * 0.86), doorW * 0.22);

    float isPick = step(abs(which - pick), 0.4) * step(0.5, shown);
    float dull = step(0.5, shown) * (1.0 - isPick);

    c = over(c, vec4(u_lacquer * 0.32, smoothstep(doorW * 0.4, -doorW * 0.1,
      sdBox(p - away * doorW * 0.25, vec2(doorW * 0.82, v_half.y * 0.86), doorW * 0.22)) * 0.75 * fade));

    // Open, and paying.
    vec3 open = mix(u_glow, u_lamp, 0.25) * (1.1 + 1.9 * fall);
    // Shut, and either still a question or already answered.
    vec2 grad = normalize(vec2(dFdx(d), dFdy(d)) + vec2(1e-6, 0.0));
    vec3 nb = normalize(vec3(grad * 0.9, 0.65));
    vec3 shut = u_brass * u_lamp * (0.12 + 0.85 * max(dot(nb, L), 0.0) * fall);
    shut += u_lamp * u_brass * specular(nb, L, 20.0) * 0.32 * fall;
    shut *= mix(1.0, 0.42, dull);
    // Before the row is read, every door breathes on its own beat, so a player
    // watches all of them rather than one.
    shut *= 1.0 + (1.0 - step(0.5, shown)) * 0.22 * sin(t * 3.0 + which * 2.1);

    c = over(c, vec4(mix(shut, open, isPick), cover(d) * fade));
    // The seam down the middle of a shut door, and the handle beside it.
    float seam = max(abs(p.x) - doorW * 0.03, d + doorW * 0.18);
    c = over(c, vec4(u_brass * 0.22, cover(seam) * fade * (1.0 - isPick)));
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
