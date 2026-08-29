// ---------------------------------------------------------------------------
// The topper alphabet, with no font and no image.
//
// The lit sign on top of a cabinet carries the machine's name, and a name is
// the one thing on this whole picture a font would normally supply. A font
// file is out, so the sign is what a real lit sign is made of: a fixed set of
// bars in a box, and a letter is the set of bars that are switched on.
//
// Sixteen bars, which is the arrangement that can hold every letter of the
// alphabet without the diagonals looking like an accident. The bar layout is
// the only description; a letter is a bitmask over it, so the whole alphabet
// is one array of small integers and the shader measures a pixel's distance to
// the nearest lit bar. That stays sharp at any size and costs nothing to load.
//
// Letters live in a box one unit wide and two tall, centered on the origin with
// y upward, so the sign can be laid out by simple arithmetic.
// ---------------------------------------------------------------------------

/** Half the width of a bar, in the same units the box is measured in. */
export const BAR_WEIGHT = 0.085;

// The nine points a bar can run between: three across by three down.
const TL = [-0.5, 1.0], TM = [0.0, 1.0], TR = [0.5, 1.0];
const ML = [-0.5, 0.0], MM = [0.0, 0.0], MR = [0.5, 0.0];
const BL = [-0.5, -1.0], BM = [0.0, -1.0], BR = [0.5, -1.0];

// The bars, in the order a letter's bits index them.
export const BARS = [
  [TL, TM], [TM, TR],          // 0, 1  the top, in two halves
  [TR, MR], [MR, BR],          // 2, 3  the right side
  [BM, BR], [BL, BM],          // 4, 5  the bottom, in two halves
  [BL, ML], [ML, TL],          // 6, 7  the left side
  [ML, MM], [MM, MR],          // 8, 9  the waist, in two halves
  [TL, MM], [TM, MM], [TR, MM],// 10, 11, 12  down from the top
  [BL, MM], [BM, MM], [BR, MM],// 13, 14, 15  up from the bottom
];

const on = (...bits) => bits.reduce((m, b) => m | (1 << b), 0);

// A space is no bars lit, which is a real letter and not a gap in the array.
const SPACE = 0;

/** A to Z, then space. Anything else is drawn as a space rather than dropped. */
export const LETTERS = [
  on(0, 1, 2, 3, 6, 7, 8, 9),          // A
  on(0, 1, 2, 3, 4, 5, 9, 11, 14),     // B
  on(0, 1, 4, 5, 6, 7),                // C
  on(0, 1, 2, 3, 4, 5, 11, 14),        // D
  on(0, 1, 4, 5, 6, 7, 8),             // E
  on(0, 1, 6, 7, 8),                   // F
  on(0, 1, 3, 4, 5, 6, 7, 9),          // G
  on(2, 3, 6, 7, 8, 9),                // H
  on(0, 1, 4, 5, 11, 14),              // I
  on(2, 3, 4, 5, 6),                   // J
  on(6, 7, 8, 12, 15),                 // K
  on(4, 5, 6, 7),                      // L
  on(2, 3, 6, 7, 10, 12),              // M
  on(2, 3, 6, 7, 10, 15),              // N
  on(0, 1, 2, 3, 4, 5, 6, 7),          // O
  on(0, 1, 2, 6, 7, 8, 9),             // P
  on(0, 1, 2, 3, 4, 5, 6, 7, 15),      // Q
  on(0, 1, 2, 6, 7, 8, 9, 15),         // R
  on(0, 1, 3, 4, 5, 7, 8, 9),          // S
  on(0, 1, 11, 14),                    // T
  on(2, 3, 4, 5, 6, 7),                // U
  on(6, 7, 12, 13),                    // V
  on(2, 3, 6, 7, 13, 15),              // W
  on(10, 12, 13, 15),                  // X
  on(10, 12, 14),                      // Y
  on(0, 1, 4, 5, 12, 13),              // Z
  SPACE,
];

/** The index of the space letter, which is what anything unreadable becomes. */
export const BLANK = LETTERS.length - 1;

/** How many letters a sign will carry. Past this a name is simply cut. */
export const MAX_LETTERS = 14;

/**
 * A name as letter indexes, upper cased, trimmed and cut to length.
 * Anything that is not a letter or a space is dropped rather than boxed, so a
 * name with punctuation in it still reads.
 */
export function encode(name, into) {
  const out = into && into.length >= MAX_LETTERS ? into : new Int32Array(MAX_LETTERS);
  const s = typeof name === 'string' ? name.toUpperCase() : '';
  let n = 0;
  for (let i = 0; i < s.length && n < MAX_LETTERS; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) out[n++] = c - 65;
    else if (c === 32 && n > 0) out[n++] = BLANK;
  }
  // A trailing space is a gap on the sign nobody asked for.
  while (n > 0 && out[n - 1] === BLANK) n--;
  for (let i = n; i < MAX_LETTERS; i++) out[i] = BLANK;
  return { codes: out, length: n };
}

/**
 * The alphabet as GLSL: the bar endpoints as one constant array and the
 * letters as one array of masks, generated from the table above so a bar moved
 * here moves on the sign too and the two can never drift apart.
 */
export function marqueeGlsl() {
  const bars = BARS.map(([a, b]) => `vec4(${f(a[0])},${f(a[1])},${f(b[0])},${f(b[1])})`).join(',');
  return `
const int BAR_N = ${BARS.length};
const int LETTER_N = ${LETTERS.length};
const float BAR_W = ${f(BAR_WEIGHT)};
const vec4 BARS[BAR_N] = vec4[BAR_N](${bars});
const int LETTERS[LETTER_N] = int[LETTER_N](${LETTERS.join(',')});

// Distance from a point to a bar, measured as a capsule so the ends are round
// the way a moulded tube is.
float barDistance(vec4 seg, vec2 p) {
  vec2 a = seg.xy;
  vec2 ab = seg.zw - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t)) - BAR_W;
}

// The nearest lit bar of one letter, and separately the nearest unlit one, so
// a sign can show its dark tubes as well as its lit ones. That is what makes
// it read as a sign rather than as floating shapes.
vec2 letterDistance(int code, vec2 p) {
  int mask = LETTERS[clamp(code, 0, LETTER_N - 1)];
  float lit = 1e9;
  float off = 1e9;
  for (int i = 0; i < BAR_N; i++) {
    float d = barDistance(BARS[i], p);
    if ((mask & (1 << i)) != 0) lit = min(lit, d);
    else off = min(off, d);
  }
  return vec2(lit, off);
}
`;
}

const f = (v) => (Math.round(v * 10000) / 10000).toFixed(4);
