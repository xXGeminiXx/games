// ---------------------------------------------------------------------------
// The carrier, as geometry.
//
// It is meant to read as a machine people live and work aboard, not as a
// shape: frames and stringers band a bone envelope, a keel runs its length
// with a lit gallery of windows, a bridge with dark glass sits at the bow,
// four engine pods hang on outriggers with cowls and turning discs, and a
// hangar mouth opens at the stern where the drones dock.
//
// Local axes: +Z is the bow, +Y is up, +X is starboard. The hull's long axis
// is Z, which is the direction the carrier travels, so the nose leads.
//
// parts() is plain data and can be read without a GPU. bake() flattens the
// parts into one indexed mesh with a colour per vertex, so the whole ship is
// a single draw call however many pieces it is made of.
// ---------------------------------------------------------------------------
import { shapes } from './gl.js?v=2';
import { hexToRgb } from './palette.js?v=2';

// A part is { shape, off, size, rot, col, lit }. rot is radians about x, y, z
// applied in that order. lit is how much the piece glows from inside: 0 is
// lit by the sun alone, 1 is a window with the lamps on behind it.
const part = (shape, off, size, col, { rot = [0, 0, 0], lit = 0 } = {}) => ({ shape, off, size, rot, col, lit });

export function parts() {
  const P = [];
  const push = (...p) => P.push(...p);

  // ---- the envelope: the bone hull the whole ship hangs from --------------
  push(part('sphere', [0, 0, 0], [17, 14, 44], 'hull'));

  // rings around it at even stations: the frames the fabric is stretched on.
  // The diameter follows the envelope so each ring sits proud of the skin.
  for (const z of [-17, -11, -5, 1, 7, 13, 18]) {
    const t = z / 22;
    const d = Math.sqrt(Math.max(0.04, 1 - t * t));
    push(part('ring', [0, 0, z], [17.6 * d, 0.55, 14.6 * d], 'hullTrim', { rot: [Math.PI / 2, 0, 0] }));
  }
  // stringers: the long lines from nose to tail
  push(part('box', [0, 7.1, -2], [0.5, 0.5, 34], 'hullTrim'));
  push(part('box', [8.6, 1.2, -2], [0.5, 0.5, 33], 'hullTrim'));
  push(part('box', [-8.6, 1.2, -2], [0.5, 0.5, 33], 'hullTrim'));
  push(part('box', [8.5, -2.2, -2], [0.4, 0.4, 31], 'hullTrim'));
  push(part('box', [-8.5, -2.2, -2], [0.4, 0.4, 31], 'hullTrim'));
  // the mooring cone on the nose, and one thin flash of the ship's colour on
  // each bow: enough to tell two carriers apart, not a livery
  push(part('ring', [0, 0, 21.4], [3.2, 1.2, 3.2], 'hullTrim', { rot: [Math.PI / 2, 0, 0] }));
  push(part('box', [7.7, 2.6, 14.5], [0.3, 0.45, 4.5], 'accent'));
  push(part('box', [-7.7, 2.6, 14.5], [0.3, 0.45, 4.5], 'accent'));
  // a tail cone so the fins grow out of the hull instead of floating behind it
  push(part('sphere', [0, 0, -18.5], [11, 9.5, 14], 'hull'));

  // ---- the keel: quarters, running the length of the ship ----------------
  push(part('box', [0, -7.0, -1], [5.0, 3.0, 32], 'hullDark'));
  push(part('box', [0, -8.6, -1], [4.2, 0.5, 32], 'hullTrim'));
  // ribs across the keel, and a gallery of small windows down each side with
  // the lamps on behind them: the plainest way to say people are aboard
  for (let i = 0; i < 6; i++) push(part('box', [0, -7.0, -12 + i * 4.6], [5.3, 3.2, 0.35], 'hullTrim'));
  for (let i = 0; i < 11; i++) {
    const z = -12.6 + i * 2.6;
    push(part('box', [2.58, -6.6, z], [0.3, 0.55, 1.0], 'lit', { lit: 1 }));
    push(part('box', [-2.58, -6.6, z], [0.3, 0.55, 1.0], 'lit', { lit: 1 }));
  }

  // ---- the bridge at the bow of the keel ---------------------------------
  push(part('box', [0, -6.4, 15.4], [5.4, 3.4, 6.0], 'hullDark'));
  push(part('box', [0, -5.9, 18.5], [4.6, 1.7, 0.4], 'glazing'));            // windscreen
  push(part('box', [2.75, -5.9, 15.6], [0.3, 1.5, 4.4], 'glazing'));          // bridge wings
  push(part('box', [-2.75, -5.9, 15.6], [0.3, 1.5, 4.4], 'glazing'));
  push(part('box', [0, -4.5, 15.4], [5.6, 0.4, 6.2], 'hullTrim'));            // bridge roof
  push(part('cyl', [0, -2.6, 14.6], [0.3, 4.2, 0.3], 'hullTrim'));            // mast
  push(part('cyl', [0, -0.6, 14.6], [2.4, 0.25, 2.4], 'hullTrim', { rot: [0.45, 0, 0] })); // dish

  // ---- four engines, hung outboard where they can be seen ----------------
  for (const sx of [1, -1]) {
    for (const z of [-8.5, 5.5]) {
      const x = sx * 11.4;
      push(part('box', [sx * 7.6, -2.8, z], [4.4, 0.5, 1.5], 'hullTrim'));    // outrigger
      push(part('cyl', [x, -2.8, z], [2.4, 5.2, 2.4], 'hullDark', { rot: [Math.PI / 2, 0, 0] }));      // nacelle
      push(part('ring', [x, -2.8, z + 2.7], [2.8, 0.7, 2.8], 'hullTrim', { rot: [Math.PI / 2, 0, 0] })); // cowl
      push(part('cyl', [x, -2.8, z + 3.0], [0.8, 0.6, 0.8], 'hullTrim', { rot: [Math.PI / 2, 0, 0] })); // hub
      push(part('cyl', [x, -2.8, z + 2.8], [2.3, 0.14, 2.3], 'glazing', { rot: [Math.PI / 2, 0, 0] })); // the turning disc
      push(part('cyl', [x, -2.8, z - 2.8], [1.4, 0.5, 1.4], 'glazing', { rot: [Math.PI / 2, 0, 0] }));  // exhaust
      push(part('box', [x, 0.4, z], [0.4, 1.4, 0.4], 'hullTrim'));            // pylon to the hull
    }
  }

  // ---- the hangar at the stern: where the drones come home ---------------
  push(part('box', [0, -6.8, -17.0], [6.6, 3.4, 7.0], 'hullDark'));
  push(part('box', [0, -6.9, -20.6], [4.8, 2.2, 0.4], 'glazing'));            // the open mouth
  push(part('box', [2.9, -5.1, -20.5], [0.5, 0.5, 0.5], 'lit', { lit: 1 })); // approach lamps
  push(part('box', [-2.9, -5.1, -20.5], [0.5, 0.5, 0.5], 'lit', { lit: 1 }));
  push(part('box', [0, -8.6, -17.0], [5.6, 0.4, 7.2], 'hullTrim'));           // the deck floor

  // ---- the tail ----------------------------------------------------------
  push(part('box', [0, 6.0, -17.8], [0.5, 6.4, 7.0], 'hullTrim'));            // upper fin
  push(part('box', [0, -3.2, -17.8], [0.5, 4.2, 6.0], 'hullTrim'));           // lower fin
  push(part('box', [0, 0.6, -17.8], [14.0, 0.5, 6.0], 'hullTrim'));           // stabiliser
  push(part('cyl', [0, 7.6, -6], [0.2, 2.4, 0.2], 'hullTrim'));               // aerials
  push(part('cyl', [0, 7.6, 6], [0.2, 2.4, 0.2], 'hullTrim'));

  return P;
}

// Flatten a parts list into one indexed mesh. Colours are baked per vertex as
// rgb plus how lit the piece is, so one draw call paints the whole ship.
export function bake(list, palette) {
  const mesh = {
    sphere: shapes.sphere(18),
    box: shapes.cube(),
    cyl: shapes.cylinder(16, true),
    ring: shapes.cylinder(20, false),
  };
  const pos = [], nrm = [], col = [], idx = [];
  for (const p of list) {
    const g = mesh[p.shape];
    if (!g) continue;
    const [rx, ry, rz] = p.rot;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    const spin = (v) => {
      let [x, y, z] = v;
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      return [x, y, z];
    };
    const c = hexToRgb(palette[p.col] || palette.hull);
    const base = pos.length / 3;
    for (let i = 0; i < g.positions.length; i += 3) {
      const v = spin([g.positions[i] * p.size[0], g.positions[i + 1] * p.size[1], g.positions[i + 2] * p.size[2]]);
      pos.push(v[0] + p.off[0], v[1] + p.off[1], v[2] + p.off[2]);
      // normals rotate with the part; the non-uniform scale is close enough
      // to uniform per axis that renormalising in the shader is sufficient
      const n = spin([g.normals[i] / p.size[0], g.normals[i + 1] / p.size[1], g.normals[i + 2] / p.size[2]]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      nrm.push(n[0] / l, n[1] / l, n[2] / l);
      col.push(c[0], c[1], c[2], p.lit);
    }
    for (let i = 0; i < g.indices.length; i++) idx.push(base + g.indices[i]);
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    indices: idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    partCount: list.length,
    triangles: idx.length / 3,
  };
}

export function carrierMesh(palette) { return bake(parts(), palette); }
