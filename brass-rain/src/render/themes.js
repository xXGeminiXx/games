// ---------------------------------------------------------------------------
// The skins.
//
// One machine gets built and then it gets painted. That is how a floor is
// stocked: the same cabinet, the same nail lattice, the same screen, shipped
// in a row of colors so a player picks theirs from the door. Geometry lives
// in the board config and color lives here, and swapping a skin changes
// nothing a ball can hit.
//
// The one finding that governs every palette below, because it is mechanical
// rather than a matter of taste: THE FACE HAS TO BE LIGHT. sRGB cannot hold a
// saturated cyan or a saturated gold at low lightness - at L 0.40 hue 215 runs
// out of chroma at 0.071, so a dark turquoise board is a grey board with a
// hint of blue in it, every time. Faces here sit between L 0.52 and L 0.80 at
// the full chroma their hue allows. The room behind the machine stays dark, at
// L 0.12 to 0.16, so the cabinet is the only lit thing in the frame.
//
// Faces are also spread across lightness on purpose, so the six separate in a
// grayscale screenshot as well as in color. Primary hues sit at 10, 40, 90,
// 140, 205 and 295 degrees; the tightest neighbouring gap is 30 degrees and
// those two are pulled apart by their motifs instead.
//
// Eleven roles, every one a material somebody could point at:
//
//   lacquer  the painted face the nails are driven into
//   lamp     the light over the machine, near white
//   brass    the nail heads and the trim, warm near neutral in every skin
//   chrome   the balls and the rails
//   enamel   the common pressed plaque, and the drum faces
//   jade     the rare mouth, always in the accent hue family
//   oxblood  the lettering pressed into enamel
//   room     the dark the cabinet stands in
//   screen   the field the show plays on
//   glow     the hot accent the machine escalates with
//   shell    the moulded cabinet the face is set into
//
// Nails do not take the skin's hue. They are brass, they stay brass, and only
// their lightness moves to stay legible against the face. They are the one
// constant that says all six came out of the same factory.
//
// Nothing here is loaded and nothing here is an image.
// ---------------------------------------------------------------------------

import { hexToOklch, oklch } from '../palette.js?v=29';

/**
 * A skin from the colors that were actually chosen, plus the three that are
 * pure consequence.
 *
 * `chrome`, `screen` and `shell` are derived rather than picked because they
 * are not design decisions: a ball is polished steel under this machine's
 * lamp, the show plays on a panel a little lifted out of the room behind it,
 * and the cabinet moulding is the face's own hue in plastic. Deriving them
 * means a retuned face drags them with it instead of leaving them stranded.
 */
function skin(t) {
  const [faceL, , faceH] = hexToOklch(t.lacquer);
  const [roomL, roomC, roomH] = hexToOklch(t.room);
  return Object.assign({
    // Polished steel, cooled away from the face so a ball never disappears
    // into the paint it is falling across.
    chrome: oklch(0.845, 0.014, (faceH + 200) % 360),
    // The panel sits just out of the room it is set into, and holds a little
    // more of the skin's color than the room does.
    screen: oklch(Math.min(0.34, roomL + 0.115), roomC + 0.055, roomH),
    // Moulded plastic: the face's hue, most of the color taken out of it, and
    // light enough to read as a body around the glass rather than as more
    // shadow.
    shell: oklch(Math.max(0.30, faceL - 0.24), 0.038, faceH),
  }, t);
}

// Six machines in six hue families, drawn from six unrelated worlds so no two
// share a drawing vocabulary either: reef, greenhouse, river claim, steel
// mill, diner, deep space.
export const THEMES = {
  // 1. A shallow reef at noon. The genre's home color and the default skin.
  tide: skin({
    id: 'tide', doors: 3, title: 'Tide Pool', hue: 205, accentHue: 55, summon: 'A manta ray',
    room: '#040a12', lacquer: '#00bac9', brass: '#f0e8cb',
    enamel: '#00eeef', pocketMid: '#007dd6', jade: '#ffa658',
    glow: '#e36b00', lamp: '#e9f9f9', oxblood: '#042428',
  }),
  // 2. A glass greenhouse gone feral, and something in it is carnivorous.
  hothouse: skin({
    id: 'hothouse', doors: 4, title: 'Hot House', hue: 140, accentHue: 335, summon: 'A flytrap',
    room: '#050e08', lacquer: '#38b600', brass: '#eaedb6',
    enamel: '#bcf600', pocketMid: '#009f68', jade: '#ed00e6',
    glow: '#ff9dea', lamp: '#eefae4', oxblood: '#092703',
  }),
  // 3. A claim on a dry river. The money colored machine.
  goldrush: skin({
    id: 'goldrush', doors: 5, title: 'Gold Rush', hue: 90, accentHue: 255, summon: 'A sluice',
    room: '#150b05', lacquer: '#e6b700', brass: '#f3efdd',
    enamel: '#fcdf00', pocketMid: '#e68100', jade: '#006fd7',
    glow: '#005bb4', lamp: '#f9f5ea', oxblood: '#271e03',
  }),
  // 4. A steel mill at pour. The machine is made of the same stuff as a ball.
  furnace: skin({
    id: 'furnace', doors: 3, title: 'Blast Furnace', hue: 40, accentHue: 195, summon: 'A ladle',
    room: '#120303', lacquer: '#eb5200', brass: '#eee3d6',
    enamel: '#ffbb69', pocketMid: '#e50026', jade: '#00d1d2',
    glow: '#00e0e0', lamp: '#f9f4f1', oxblood: '#391103',
  }),
  // 5. A chrome diner at two in the morning, and the jukebox is the machine.
  cherry: skin({
    id: 'cherry', doors: 4, title: 'Cherry Bomb', hue: 10, accentHue: 180, summon: 'A pair of cherries',
    room: '#13040c', lacquer: '#f50063', brass: '#f1e9e8',
    enamel: '#f0c2d6', pocketMid: '#d7008e', jade: '#00dbc1',
    glow: '#00eace', lamp: '#f9f4f4', oxblood: '#3e0516',
  }),
  // 6. A window into deep space. The one dark face, and the odd one on the
  // row on purpose. Its lettering is the lamp rather than the ink, because
  // ink on a face this dark is not lettering, it is absence.
  stardust: skin({
    id: 'stardust', doors: 6, title: 'Stardust', hue: 295, accentHue: 150, darkFace: true, summon: 'A black hole',
    room: '#060314', lacquer: '#7e00f6', brass: '#e6e2ee',
    enamel: '#e29fff', pocketMid: '#6772ff', jade: '#00f890',
    glow: '#00f272', lamp: '#f2f0f7', oxblood: '#f2f0f7',
  }),
};

export const THEME_IDS = Object.keys(THEMES);

/** The skin the machine wears when nothing has asked for one. */
export const DEFAULT_THEME = 'tide';

/**
 * Which skin a cabinet is painted in.
 *
 * A cabinet keeps its color: the same machine is the same machine every time
 * it is sat at, so the mapping is by name and never by draw. A name nobody has
 * a skin for is folded onto one deterministically rather than dropped, so a
 * cabinet added later still arrives painted.
 */
const CABINET_SKINS = {
  sea: 'tide', tower: 'furnace', shelf: 'hothouse',
  twin: 'cherry', well: 'goldrush', ladder: 'stardust',
};

export function themeForCabinet(id) {
  if (typeof id !== 'string' || !id) return DEFAULT_THEME;
  if (THEMES[id]) return id;
  if (CABINET_SKINS[id]) return CABINET_SKINS[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return THEME_IDS[h % THEME_IDS.length];
}

/**
 * A skin by name, with anything the config wants to say about it laid over the
 * top. Never throws and never returns nothing: an unknown name is the default
 * machine rather than a black canvas.
 */
export function resolveTheme(id, cfg) {
  const base = THEMES[id] || THEMES[DEFAULT_THEME];
  const over = cfg && cfg.themes && typeof cfg.themes === 'object' ? cfg.themes[base.id] : null;
  if (!over || typeof over !== 'object') return base;
  return Object.assign({}, base, over, { id: base.id, title: over.title || base.title });
}

/** The skin a cabinet wears, resolved, with the config's own say laid over it. */
export function skinForCabinet(id, cfg) {
  return resolveTheme(themeForCabinet(id), cfg);
}

/**
 * What this machine sends out onto the board, as a sentence can name it.
 *
 * Every one of them is singular, because it starts a sentence the game builds
 * around it and a pair of cherries has to take the same verb a manta ray does.
 */
/** How many doors this cabinet's row lights: its own count, three when unsaid. */
export function doorsFor(id, cfg) {
  const skin = resolveTheme(themeForCabinet(id), cfg);
  const n = Number(skin && skin.doors);
  return Number.isFinite(n) ? Math.max(2, Math.min(8, Math.floor(n))) : 3;
}

export function summonFor(id, cfg) {
  const s = skinForCabinet(id, cfg).summon;
  return typeof s === 'string' && s ? s : 'Something';
}

/** The index the screen shader uses to pick a skin's motif. */
export function themeIndex(id) {
  const i = THEME_IDS.indexOf(id);
  return i < 0 ? 0 : i;
}
