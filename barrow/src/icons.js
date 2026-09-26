// ---------------------------------------------------------------------------
// Small pictures, drawn from pixels.
//
// Each one is a nine by nine grid: '#' is filled, '+' is filled faintly, '.'
// is empty. The same grid is drawn two ways: into the hill's canvas, pixel
// by pixel, and into the page as an SVG, so a lord's mark on his door is the
// same mark beside his name in the list of what he handed over. Nothing here
// is a file, so there is nothing to load and nothing to go missing.
// ---------------------------------------------------------------------------

export const ICONS = {
  // What the top line counts.
  coin: [
    '..#####..',
    '.##+++##.',
    '##+###+##',
    '##+#+++##',
    '##+###+##',
    '##+++#+##',
    '##+###+##',
    '.##+++##.',
    '..#####..',
  ],
  bone: [
    '.........',
    '.##...##.',
    '###...###',
    '.#######.',
    '..#####..',
    '.#######.',
    '###...###',
    '.##...##.',
    '.........',
  ],
  skull: [
    '..#####..',
    '.#######.',
    '#########',
    '##..#..##',
    '##..#..##',
    '####.####',
    '.#######.',
    '..#.#.#..',
    '..#####..',
  ],
  depth: [
    '....#....',
    '....#....',
    '....#....',
    '.#..#..#.',
    '..#.#.#..',
    '...###...',
    '....#....',
    '#########',
    '+.+.+.+.+',
  ],
  relic: [
    '...###...',
    '..#...#..',
    '..#...#..',
    '...###...',
    '.#######.',
    '....#....',
    '....#....',
    '....#....',
    '...###...',
  ],
  rank: [
    '....#....',
    '...###...',
    '..##.##..',
    '.##...##.',
    '##..#..##',
    '...###...',
    '..##.##..',
    '.##...##.',
    '##.....##',
  ],
  // Each lord's mark.
  rex: [
    '.........',
    '#...#...#',
    '##.###.##',
    '#########',
    '#+#+#+#+#',
    '#########',
    '#########',
    '.........',
    '.........',
  ],
  pater: [
    '....#....',
    '.#######.',
    '#...#...#',
    '.#######.',
    '#...#...#',
    '.#######.',
    '#...#...#',
    '.#######.',
    '....#....',
  ],
  rey: [
    '....#....',
    '...#+#...',
    '....#....',
    '...###...',
    '.#######.',
    '#########',
    '....#....',
    '...###...',
    '.#######.',
  ],
  dona: [
    '....#....',
    '...#+#...',
    '....#....',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '..#####..',
    '.#######.',
  ],
  sepulturero: [
    '.......##',
    '......##.',
    '.....##..',
    '....##...',
    '..###....',
    '.#####...',
    '######...',
    '.####....',
    '..##.....',
  ],
  neb: [
    '....#....',
    '#########',
    '#...#...#',
    '#...#...#',
    '###.#.###',
    '....#....',
    '....#....',
    '....#....',
    '..#####..',
  ],
  natron: [
    '..#####..',
    '...###...',
    '..#####..',
    '.#######.',
    '.##+++##.',
    '.#######.',
    '.#######.',
    '..#####..',
    '...###...',
  ],
  mortifer: [
    '#.......#',
    '##.....##',
    '.#######.',
    '#########',
    '##..#..##',
    '#########',
    '.###.###.',
    '..#.#.#..',
    '..#####..',
  ],
};

/** The size of every grid, in cells. */
export const GRID = 9;

/**
 * An icon as an SVG string for the page, `size` pixels square, in `color`.
 * Faint cells are drawn at a third of the strength. Unknown names give an
 * empty string, so a missing icon costs a gap, never an error.
 */
export function svg(name, color, size) {
  const rows = ICONS[name];
  if (!rows) return '';
  const s = size || 12;
  let rects = '';
  for (let y = 0; y < GRID; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < GRID; x++) {
      const ch = row[x];
      if (ch === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      else if (ch === '+') rects += `<rect x="${x}" y="${y}" width="1" height="1" opacity=".35"/>`;
    }
  }
  return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 ${GRID} ${GRID}" fill="${color || 'currentColor'}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/**
 * An icon drawn into a canvas with its top left at (x, y), each cell `px`
 * pixels square. `alpha` scales the whole thing.
 */
export function paint(ctx, name, x, y, px, color, alpha) {
  const rows = ICONS[name];
  if (!rows || !(px > 0)) return;
  const a = alpha === undefined ? 1 : alpha;
  const was = ctx.globalAlpha;
  ctx.fillStyle = color;
  for (let r = 0; r < GRID; r++) {
    const row = rows[r] || '';
    for (let c = 0; c < GRID; c++) {
      const ch = row[c];
      if (ch !== '#' && ch !== '+') continue;
      ctx.globalAlpha = was * a * (ch === '+' ? 0.35 : 1);
      ctx.fillRect(x + c * px, y + r * px, px, px);
    }
  }
  ctx.globalAlpha = was;
}
