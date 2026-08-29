// ---------------------------------------------------------------------------
// Ten numerals, made of strokes, with no font and no image.
//
// The counter drums carry figures, and figures are the one thing on this face
// that a font would normally supply. A downloaded font is out, and so is a
// pixel grid: a bitmap small enough to build in code reads as 8-bit the
// moment the window grows, which is a look this machine is not.
//
// So each digit is a short run of strokes - straight segments with round
// ends, the way a stencil or a stamped die makes one - and the fragment
// shader measures its distance to the nearest of them. That stays crisp at
// any size, needs nothing loaded, and gives condensed tabular figures with
// the even weight a mechanical till has.
//
// The table below is the only description of the numerals. The GLSL constant
// arrays are generated from it at import, so a stroke moved here moves in the
// shader too and the two can never drift apart.
//
// Every digit lives in the same box - roughly 0.48 wide by 0.88 tall in em
// units, centred on the origin, y upward - which is what makes the figures
// tabular: a 1 takes exactly as much room as an 8.
// ---------------------------------------------------------------------------

/** Half the width of a stroke, in em units. The weight of the figures. */
export const STROKE_WEIGHT = 0.072;

/** The box every digit is drawn inside, as half extents in em units. */
export const EM = { hw: 0.24, hh: 0.44 };

/** A closed ring of points around an ellipse, for the round digits. */
function ring(cx, cy, rx, ry, n, phase = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** A polyline turned end for end and top for bottom. */
const turn = (paths) => paths.map((p) => p.map(([x, y]) => [-x, -y]));

// Each digit is a list of polylines. Curves are cut into enough segments that
// a round end never shows a corner at reel size.
const SIX = [[
  [0.14, 0.40], [0.00, 0.44], [-0.14, 0.34], [-0.20, 0.10], [-0.21, -0.14],
  [-0.12, -0.38], [0.04, -0.44], [0.17, -0.36], [0.21, -0.19], [0.13, -0.03],
  [-0.01, 0.01], [-0.14, -0.03], [-0.20, -0.14],
]];

export const DIGIT_PATHS = [
  // 0
  [ring(0, 0, 0.205, 0.405, 14)],
  // 1
  [[[-0.14, 0.27], [0.01, 0.44], [0.01, -0.44]], [[-0.17, -0.44], [0.18, -0.44]]],
  // 2
  [[[-0.20, 0.26], [-0.13, 0.40], [0.02, 0.44], [0.16, 0.38], [0.20, 0.22],
    [0.12, 0.04], [-0.20, -0.44], [0.21, -0.44]]],
  // 3
  [[[-0.19, 0.30], [-0.08, 0.42], [0.08, 0.44], [0.18, 0.32], [0.14, 0.14], [0.00, 0.05]],
   [[-0.03, 0.05], [0.12, 0.00], [0.20, -0.16], [0.14, -0.36], [-0.02, -0.44], [-0.18, -0.35]]],
  // 4
  [[[0.09, 0.44], [-0.21, -0.08], [0.21, -0.08]], [[0.09, 0.11], [0.09, -0.44]]],
  // 5
  [[[0.19, 0.44], [-0.16, 0.44], [-0.18, 0.08], [-0.04, 0.14], [0.10, 0.11],
    [0.19, -0.06], [0.16, -0.30], [0.02, -0.43], [-0.15, -0.37]]],
  // 6
  SIX,
  // 7
  [[[-0.20, 0.44], [0.21, 0.44], [-0.01, -0.44]]],
  // 8
  [ring(0, 0.215, 0.175, 0.205, 10), ring(0, -0.21, 0.203, 0.225, 12)],
  // 9
  turn(SIX),
];

/**
 * Every stroke of every digit as [x0, y0, x1, y1], laid end to end, with the
 * offset and length of each digit's run. This is what the shader indexes.
 */
export function buildStrokes(paths = DIGIT_PATHS) {
  const strokes = [];
  const offset = [];
  const length = [];
  paths.forEach((digit) => {
    offset.push(strokes.length);
    let n = 0;
    digit.forEach((line) => {
      for (let i = 0; i + 1 < line.length; i++) {
        strokes.push([line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]]);
        n++;
      }
    });
    length.push(n);
  });
  return { strokes, offset, length, max: Math.max(...length) };
}

export const DIGIT_STROKES = buildStrokes();

/** Distance from a point to the nearest stroke of a digit. Matches the GLSL. */
export function digitDistance(digit, x, y, table = DIGIT_STROKES) {
  const d = ((Math.floor(digit) % 10) + 10) % 10;
  const off = table.offset[d];
  let best = Infinity;
  for (let i = 0; i < table.length[d]; i++) {
    const [x0, y0, x1, y1] = table.strokes[off + i];
    const px = x - x0, py = y - y0;
    const bx = x1 - x0, by = y1 - y0;
    const bb = bx * bx + by * by;
    const h = bb < 1e-12 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / bb));
    best = Math.min(best, Math.hypot(px - bx * h, py - by * h));
  }
  return best - STROKE_WEIGHT;
}

const f = (v) => (Math.round(v * 10000) / 10000).toFixed(4);

/**
 * The same table as GLSL constants plus the function that reads them, ready
 * to paste into a fragment shader.
 */
export function digitGlsl(table = DIGIT_STROKES) {
  const strokes = table.strokes
    .map((s) => `vec4(${f(s[0])},${f(s[1])},${f(s[2])},${f(s[3])})`)
    .join(',\n  ');
  return `
const int DIGIT_STROKE_COUNT = ${table.strokes.length};
const int DIGIT_MAX = ${table.max};
const float DIGIT_WEIGHT = ${f(STROKE_WEIGHT)};
const vec4 DIGIT_STROKES[DIGIT_STROKE_COUNT] = vec4[DIGIT_STROKE_COUNT](
  ${strokes});
const int DIGIT_OFF[10] = int[10](${table.offset.join(',')});
const int DIGIT_LEN[10] = int[10](${table.length.join(',')});

// Signed distance to a numeral, negative inside the strokes.
float digitDistance(int digit, vec2 p) {
  int d = digit - 10 * (digit / 10);
  int off = DIGIT_OFF[d];
  int len = DIGIT_LEN[d];
  float best = 1e9;
  for (int i = 0; i < DIGIT_MAX; i++) {
    if (i >= len) break;
    vec4 s = DIGIT_STROKES[off + i];
    vec2 pa = p - s.xy;
    vec2 ba = s.zw - s.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    best = min(best, length(pa - ba * h));
  }
  return best - DIGIT_WEIGHT;
}
`;
}
