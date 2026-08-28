/**
 * deaths.js - what a dying star looks like at each moment of its death.
 *
 * Pure functions of (stage, progress). The renderer asks these what to draw
 * and draws it; nothing here touches a canvas, so the whole choreography can
 * be checked without one. Progress u runs 0..1 over the sequence; the
 * simulation owns the clock and the mass, this owns only the look.
 *
 * THE DIRECT COLLAPSE is the sequence the whole file exists for. A star too
 * massive to explode does not flash: its core gives way and the darkness
 * spreads outward from the centre, the surface it swallows going red as the
 * last light climbs out against gravity. What is left at the limb is a thin
 * bright halo - the photons that were on their way out - which hangs for a
 * moment and fades, and then there is nothing where the star was. No shell,
 * no ring, no burst. The renderer punches the darkness out of everything
 * behind it so the shadow is a real absence and not a dark paint.
 *
 * THE SUPERNOVA begins the same way, faster - the core collapses - and then
 * bounces: the one moment in the whole game that deserves a flash. The shell
 * that follows is drawn as an expanding front by the effects layer; what
 * this file describes is the body itself, which is briefly brighter than
 * anything else and then shrinks to the point that is left.
 *
 * THE PLANETARY NEBULA is slow and gentle: the envelope lifts off around a
 * core that is exposed, hotter and hotter, as it goes. THE DETONATION is a
 * white dwarf fed past its limit: it brightens, and then it is a shell with
 * nothing inside. THE QUIET collapse is a neutron star fed past its own: it
 * simply winks out into a shadow.
 */

/** Stage codes, matching the simulation's STAGE. */
export const STAGE = Object.freeze({
  NONE: 0, COLLAPSE: 1, SUPERNOVA: 2, NEBULA: 3, DETONATION: 4, QUIET: 5,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The look of a dying body at progress u.
 *
 * @param {number} stage   STAGE code
 * @param {number} u       0..1 through the sequence
 * @param {number} T       the body's temperature before it started dying, K
 * @returns {{
 *   dark: number,      radius of the dark core as a share of the body's radius (0 = none)
 *   punch: boolean,    whether the dark core must be cut out of everything behind it
 *   rim: number,       radius of the bright rim as a share of the body's radius (0 = none)
 *   rimAlpha: number,  brightness of that rim, 0..1
 *   rimT: number,      colour temperature of the rim, K
 *   rimWidth: number,  rim thickness as a share of the body's radius
 *   light: number,     multiplier on the body's ordinary light (halo, core, disc)
 *   T: number,         the temperature to draw the body at
 *   boost: number,     an extra central glare, 0 = none, in units of the ordinary core
 *   alpha: number,     overall opacity of the body
 * }}
 */
export function look(stage, u, T) {
  u = clamp(u, 0, 1);
  const base = { dark: 0, punch: false, rim: 0, rimAlpha: 0, rimT: T, rimWidth: 0.06, light: 1, T, boost: 0, alpha: 1 };
  switch (stage) {
    case STAGE.COLLAPSE: {
      // The shadow spreads from the centre to the limb over the first ~60%.
      const spread = smooth(0.02, 0.62, u);
      const dark = spread;
      // The last light reddens as it climbs out. Rim brightness rises as the
      // shadow grows (more of the star's light is being squeezed into the
      // remaining annulus), peaks as it reaches the limb, then hangs and fades.
      let rim, rimAlpha;
      if (u < 0.62) {
        rim = Math.max(dark, 0.04);
        rimAlpha = 0.35 + 0.65 * spread;
      } else {
        // The halo: at the limb, contracting slightly, fading to nothing by 0.88.
        const f = smooth(0.62, 0.88, u);
        rim = lerp(1.0, 0.86, f);
        rimAlpha = (1 - f) * (1 - f);
      }
      const rimT = lerp(T, Math.min(T, 2600), 0.25 + 0.75 * spread);
      // The star's own light goes out with its surface. What is not yet
      // swallowed dims and reddens; past the limb there is no star to draw.
      const light = u < 0.62 ? (1 - spread) * (1 - 0.35 * spread) : 0;
      return Object.assign(base, {
        dark, punch: dark > 0.01, rim, rimAlpha, rimT, rimWidth: 0.05 + 0.03 * spread,
        light, T: lerp(T, Math.min(T, 3200), spread * 0.8), alpha: u < 0.9 ? 1 : 1 - smooth(0.9, 1, u),
      });
    }
    case STAGE.SUPERNOVA: {
      if (u < 0.32) {
        // Core collapse. The core gives way in an instant and the surface
        // does not know yet: what shows is a darkening at the centre and the
        // whole star dimming and reddening as it falls inward - subtle, and
        // nothing like the direct collapse, which reaches the limb. Then the
        // bounce.
        const spread = smooth(0.0, 0.30, u);
        return Object.assign(base, {
          dark: 0.38 * spread, punch: spread > 0.05, rim: Math.max(0.38 * spread, 0.04),
          rimAlpha: 0.18 + 0.25 * spread, rimT: lerp(T, 2800, spread), rimWidth: 0.04,
          light: 1 - 0.35 * spread, T: lerp(T, 3000, spread * 0.7),
        });
      }
      if (u < 0.55) {
        // The bounce. Brighter than anything else on screen: the aperture will
        // stop down and the rest of the field sink, which is the truth of it.
        const f = smooth(0.32, 0.36, u) * (1 - smooth(0.40, 0.55, u));
        return Object.assign(base, { light: 1 + 2 * f, T: lerp(T, 26000, f), boost: 3.5 * f });
      }
      // What is left shrinks to a point. Hot, and getting hotter as it is exposed.
      const f = smooth(0.55, 1, u);
      return Object.assign(base, { light: lerp(1.6, 1, f), T: lerp(18000, 46000, f) });
    }
    case STAGE.NEBULA: {
      // The envelope lifts off slowly; the exposed core climbs from a giant's
      // red to a white dwarf's blue-white as more of it is uncovered.
      const f = smooth(0.06, 0.9, u);
      return Object.assign(base, { light: lerp(1, 0.7, f), T: lerp(T, 40000, f * f) });
    }
    case STAGE.DETONATION: {
      if (u < 0.30) {
        const f = smooth(0, 0.3, u);
        return Object.assign(base, { light: 1 + 3 * f, T: lerp(T, 22000, f), boost: 2.5 * f });
      }
      // After the flash there is nothing inside the shell.
      const f = smooth(0.30, 0.6, u);
      return Object.assign(base, { light: 1 - f, alpha: 1 - f, T: 22000 });
    }
    case STAGE.QUIET: {
      // It winks out. The dark core crosses it in a beat and there is a hole.
      const spread = smooth(0, 0.7, u);
      return Object.assign(base, {
        dark: spread, punch: spread > 0.02, rim: Math.max(spread, 0.05), rimAlpha: 0.8 * (1 - spread),
        rimT: T, light: 1 - spread, alpha: 1 - smooth(0.7, 1, u),
      });
    }
    default:
      return base;
  }
}

/** Human-readable name for a stage, for a caption. */
export const STAGE_CAPTION = Object.freeze([
  '', 'collapse', 'supernova', 'planetary nebula', 'detonation', 'collapse',
]);

export default { STAGE, STAGE_CAPTION, look };
