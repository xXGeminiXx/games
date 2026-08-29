// ---------------------------------------------------------------------------
// Lighting and atmosphere for shaders.
//
// The look of a scene is mostly decided here, not in the geometry: a sun and
// a sky colour, a rim of light on edges facing away, fog that turns distance
// into depth, and a tone map that keeps bright things bright without
// clipping to white. Each is a few lines; together they are the difference
// between a diagram and a place.
// ---------------------------------------------------------------------------

export const LIGHT = `
// Edges facing away from the eye catch light: the cheapest cue of volume.
float fresnel(vec3 n, vec3 v, float power) { return pow(1.0 - clamp(dot(n, v), 0.0, 1.0), power); }
// Lambert, wrapped so the terminator is soft (wrap 0 = hard, 0.5 = very soft).
float wrapDiffuse(vec3 n, vec3 l, float wrap) { return clamp((dot(n, l) + wrap) / (1.0 + wrap), 0.0, 1.0); }
// Blinn-Phong highlight.
float specular(vec3 n, vec3 l, vec3 v, float shininess) { vec3 h = normalize(l + v); return pow(clamp(dot(n, h), 0.0, 1.0), shininess); }
// Sky above, ground below: soft fill light with no direction.
vec3 hemiLight(vec3 n, vec3 skyCol, vec3 groundCol) { return mix(groundCol, skyCol, n.y * 0.5 + 0.5); }
// Quantise a lighting term into bands. Cel shading is this one line.
float toon(float x, float bands) { return floor(x * bands + 0.5) / bands; }
// Smooth-edged bands, for a softer cel look.
float toonSoft(float x, float bands, float softness) { float s = x * bands; return (floor(s) + smoothstep(0.5 - softness, 0.5 + softness, fract(s))) / bands; }
// Fog that thickens with distance.
float fogExp(float dist, float density) { return 1.0 - exp(-dist * density); }
float fogExp2(float dist, float density) { float d = dist * density; return 1.0 - exp(-d * d); }
// Height fog: thicker near the ground.
float fogHeight(vec3 ro, vec3 rd, float dist, float density, float falloff) {
  float f = (density / falloff) * exp(-ro.y * falloff) * (1.0 - exp(-dist * rd.y * falloff)) / rd.y;
  return clamp(f, 0.0, 1.0);
}
// A sky from a ray direction: horizon glow, zenith, a sun disc and halo.
vec3 skyGradient(vec3 rd, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 sunCol) {
  float t = clamp(rd.y, 0.0, 1.0);
  vec3 sky = mix(horizon, zenith, pow(t, 0.45));
  float sun = clamp(dot(rd, sunDir), 0.0, 1.0);
  sky += sunCol * (pow(sun, 256.0) * 4.0 + pow(sun, 8.0) * 0.25);
  return sky;
}
// Filmic tone map (Narkowicz ACES fit). Input is linear HDR, output [0,1].
vec3 tonemapACES(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 tonemapReinhard(vec3 x) { return x / (1.0 + x); }
vec3 gammaOut(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
vec3 gammaIn(vec3 c) { return pow(c, vec3(2.2)); }
// Distance-based desaturation and cooling, the painter's aerial perspective.
vec3 aerial(vec3 col, vec3 skyCol, float dist, float density) { return mix(col, skyCol, fogExp(dist, density)); }
// Triplanar blend weights for a normal: which of the three axis projections
// a texture function should be sampled from, for seamless procedural detail.
vec3 triplanarWeights(vec3 n, float sharpness) { vec3 w = pow(abs(n), vec3(sharpness)); return w / (w.x + w.y + w.z); }
`;

export default LIGHT;
