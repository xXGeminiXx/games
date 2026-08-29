// ---------------------------------------------------------------------------
// The drone, as geometry.
//
// A drone is a few world units across at most and there can be tens of
// thousands of them, so this stays small: about twenty triangles that read as
// a machine rather than a triangle. A tapered body with a nose, two swept
// wings, a dark rotor disc at each tip, a dark canopy and a tail fin.
//
// Local axes: +Z is the nose, +Y is up. Each vertex carries a shade: 0 takes
// the fleet colour (orange, darker when loaded) and 1 takes the dark trim, so
// the canopy and the rotors read against the body at any distance.
// ---------------------------------------------------------------------------

export function dart() {
  const pos = [], nrm = [], shade = [];
  const tri = (a, b, c, s) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nrm.push(n[0] / l, n[1] / l, n[2] / l); shade.push(s); }
  };
  const quad = (a, b, c, d, s) => { tri(a, b, c, s); tri(a, c, d, s); };

  // ---- the body: a nose, a four-sided waist, a tail ----------------------
  const nose = [0, 0.02, 1.35], tail = [0, 0, -0.8];
  const w = [[0.3, 0, 0.2], [0, 0.24, 0.2], [-0.3, 0, 0.2], [0, -0.2, 0.2]];
  for (let i = 0; i < 4; i++) {
    const a = w[i], b = w[(i + 1) % 4];
    tri(nose, a, b, 0);
    tri(tail, b, a, 0);
  }

  // ---- wings, swept back, with a rotor disc at each tip -------------------
  for (const sx of [1, -1]) {
    const root0 = [sx * 0.24, 0.02, 0.42], root1 = [sx * 0.24, 0.02, -0.28];
    const tip0 = [sx * 1.0, 0.06, 0.05], tip1 = [sx * 1.0, 0.06, -0.4];
    quad(root0, tip0, tip1, root1, 0);
    // the rotor: a flat disc standing in for the blades, dark so it reads
    const cx = sx * 1.0, cy = 0.1, cz = -0.16, r = 0.34;
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      tri([cx, cy, cz], [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r], 1);
    }
  }

  // ---- a canopy over the front and a fin at the back ---------------------
  quad([0.16, 0.2, 0.62], [-0.16, 0.2, 0.62], [-0.13, 0.12, 0.05], [0.13, 0.12, 0.05], 1);
  quad([0, 0.16, -0.34], [0, 0.5, -0.7], [0, 0.5, -0.86], [0, 0.05, -0.8], 1);

  const indices = new Uint16Array(pos.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    shades: new Float32Array(shade),
    indices,
    triangles: indices.length / 3,
  };
}
