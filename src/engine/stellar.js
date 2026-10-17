import { colorIndexToLinearRgb } from '../color.js';

/**
 * How big a star is, and what colour, worked out from the catalogue.
 *
 * The star catalogue carries a position, a magnitude, a colour index and a
 * spectral type. It does not carry a radius, and until this existed every star
 * you could fly to was given one solar radius and a warm-white tint. That makes
 * Betelgeuse the same size as the Sun, which is wrong by a factor of seven
 * hundred: it is the difference between a bright dot and something that would
 * swallow the orbit of Mars.
 *
 * The radius is not measured for most stars anyway — it is derived, and the
 * derivation is old and standard:
 *
 *   1. the spectral type gives the effective temperature,
 *   2. the temperature gives a bolometric correction, which turns the
 *      catalogue's visual luminosity into a total one,
 *   3. Stefan-Boltzmann turns luminosity and temperature into an area.
 *
 * Checked against thirty stars with interferometric or eclipsing-binary radii,
 * the median comes out at 0.97 of the accepted value and 26 of the 30 are
 * within a factor of 1.6. What is left is dominated by the catalogue's own
 * parallaxes rather than by any of this: Deneb comes out at half its accepted
 * radius because the luminosity it is given here is a third of the modern one.
 */

/** IAU nominal solar effective temperature. The radius lives in units.js. */
export const SOLAR_TEFF = 5772;

/**
 * Bolometric correction of the Sun on the same scale as the polynomial below,
 * so a star's correction is only ever used as a difference against it and the
 * zero point of the catalogue's luminosity cancels out.
 */
const SOLAR_BC = -0.09;

// Temperature against position along the spectral sequence, where O0 is 0, B0
// is 10 and M0 is 60. Three sequences, because a spectral type without its
// luminosity class does not determine a temperature: K5 is 4400 K on the main
// sequence and 3850 K as a supergiant, and the supergiants are exactly the
// stars this is wanted for.
const SEQUENCE = { O: 0, B: 10, A: 20, F: 30, G: 40, K: 50, M: 60 };

const MAIN_SEQUENCE = [
  [0, 50000], [5, 42000], [9, 34000], [10, 30000], [12, 20900], [15, 15200],
  [18, 11400], [20, 9600], [22, 8900], [25, 8200], [30, 7200], [35, 6400],
  [38, 6100], [40, 5900], [42, 5800], [45, 5700], [48, 5500], [50, 5300],
  [52, 5000], [55, 4400], [58, 4000], [60, 3800], [62, 3500], [65, 3000],
  [68, 2700], [70, 2500],
];

const GIANTS = [
  [0, 45000], [10, 29000], [15, 15000], [20, 9500], [25, 8300], [30, 7100],
  [40, 5400], [45, 5050], [50, 4700], [52, 4400], [55, 3950], [60, 3750],
  [62, 3550], [65, 3350], [70, 3100],
];

const SUPERGIANTS = [
  [0, 40000], [9, 32000], [10, 26000], [12, 18500], [15, 13600], [18, 11000],
  [20, 9800], [22, 9000], [25, 8500], [30, 7700], [35, 6900], [40, 5500],
  [45, 4850], [50, 4420], [55, 3850], [60, 3650], [62, 3600], [65, 3400],
  [70, 3200],
];

function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [a, ta] = table[i - 1];
    const [b, tb] = table[i];
    if (x <= b) return ta + ((tb - ta) * (x - a)) / (b - a);
  }
  return table[table.length - 1][1];
}

// The luminosity class, which is a roman numeral somewhere after the
// temperature class. It has to survive the peculiarity codes the catalogue
// appends — `K2IIIp`, `A0Vvar`, `B0.5Iavar`, `F7:Ib-IIv SB` — so the numeral
// may be followed by lower-case letters but not by another capital, which is
// what separates `III` from the `I` of a composite spectrum like `M1Ib + B2.5V`.
// Longest alternatives first, or `III` matches as `II` and `IV` as `I`.
const LUMINOSITY_CLASS = /(?:^|[^A-Za-z])(III|II|IV|VI|V|Iab|Ia|Ib|I)(?![A-HJ-UW-Z])/;
const TEMPERATURE_CLASS = /^\s*([OBAFGKM])\s*(\d(?:\.\d)?)?/;

/**
 * Effective temperature from an MK spectral type, or null if the string is not
 * one. A type with no subclass digit is taken as the middle of its class, which
 * is the convention and is worth about one subclass of error.
 */
export function spectralTemperature(spect) {
  if (typeof spect !== 'string') return null;
  const type = TEMPERATURE_CLASS.exec(spect);
  if (!type) return null;
  const index = SEQUENCE[type[1]] + (type[2] === undefined ? 5 : Number(type[2]));
  const luminosity = LUMINOSITY_CLASS.exec(spect)?.[1] ?? null;
  if (luminosity === 'Ia' || luminosity === 'Iab' || luminosity === 'Ib' || luminosity === 'I' || luminosity === 'II') {
    return interpolate(SUPERGIANTS, index);
  }
  if (luminosity === 'III' || luminosity === 'IV') return interpolate(GIANTS, index);
  return interpolate(MAIN_SEQUENCE, index);
}

/**
 * Bolometric correction against effective temperature: Flower (1996) as
 * retabulated by Torres (2010), who corrected the coefficients as published.
 *
 * This is the step that matters most for the stars worth visiting. A cool
 * supergiant emits most of its light outside the visual band, so its catalogue
 * luminosity understates the total by a factor of four; a hot supergiant loses
 * its light the other way, into the ultraviolet. Skipping the correction makes
 * every star at both ends of the sequence too small.
 */
export function bolometricCorrection(teff) {
  const logT = Math.log10(Math.max(teff, 1500));
  let c;
  if (logT < 3.7) {
    c = [-1.90537291496456e4, 1.55144866764412e4, -4.21278819301717e3, 3.81476328422343e2];
  } else if (logT < 3.9) {
    c = [-3.70510203809015e4, 3.85672629965804e4, -1.50651486316025e4, 2.61724637119416e3, -1.70623810323864e2];
  } else {
    c = [
      -1.18115450538963e5, 1.37145973583929e5, -6.36233812100225e4,
      1.47412923562646e4, -1.70587278406872e3, 7.8873172180499e1,
    ];
  }
  let bc = 0;
  for (let i = c.length - 1; i >= 0; i--) bc = bc * logT + c[i];
  return bc;
}

/** Ballesteros (2012), the same relation the star field uses for its colours. */
export function colorIndexTemperature(bv) {
  const x = Math.max(-0.4, Math.min(2.5, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

/**
 * Everything derivable about a catalogued star.
 *
 * `lum` is the catalogue's luminosity in solar units, computed from its
 * absolute visual magnitude and so a visual-band figure. `spect` is preferred
 * over `colorIndex` for the temperature because the colour index of a distant
 * star carries interstellar reddening it cannot be separated from, and because
 * B-V barely changes across the hot end of the sequence: a hundredth of a
 * magnitude of error moves a B star by a thousand kelvin.
 *
 * @param {object} star
 * @param {number} star.lum visual luminosity, solar units
 * @param {string} [star.spect] MK spectral type
 * @param {number} [star.colorIndex] B-V, used when there is no spectral type
 * @returns {{ teff: number, radiusSol: number, luminositySol: number }}
 */
export function describeStar({ lum, spect, colorIndex }) {
  const teff =
    spectralTemperature(spect) ??
    (Number.isFinite(colorIndex) ? colorIndexTemperature(colorIndex) : SOLAR_TEFF);
  const visual = Number.isFinite(lum) && lum > 0 ? lum : 1;
  // Visual luminosity to total, as a magnitude difference against the Sun's own
  // correction so the catalogue's zero point drops out.
  const luminositySol = visual * 10 ** (-(bolometricCorrection(teff) - SOLAR_BC) / 2.5);
  const radiusSol = Math.sqrt(luminositySol) * (SOLAR_TEFF / teff) ** 2;
  return { teff, radiusSol, luminositySol };
}

/**
 * How bright to draw a star's surface, relative to the Sun's.
 *
 * Surface brightness goes as the fourth power of temperature, which is true and
 * unusable: Rigel would be thirteen times the Sun and clip to white over its
 * whole disc, losing the limb darkening and granulation that make it read as a
 * sphere, while Betelgeuse would come out at a seventh and read as brown. The
 * square root of the ratio keeps the ordering for cool stars, and hot ones
 * stop below the Sun, whose own disc is already at the edge: any brighter and the disc clips to white
 * whatever its tint, so a B star looks exactly like an A star. Their extra
 * light is in the corona and the point glare instead.
 */
export function surfaceBrightness(teff) {
  return Math.max(0.22, Math.min(1, (teff / SOLAR_TEFF) ** 2)) * (teff > 7000 ? 0.75 : 1);
}

/**
 * The colour to draw a star's disc, linear RGB around a mean of one.
 *
 * Saturated past the blackbody chromaticity on purpose, and more so the
 * cooler the star: the tone curve compresses the brightest channel hardest,
 * so a 3000 K disc whose red is twice its green comes out amber, not the
 * orange-red that a red dwarf is drawn as everywhere from SpaceEngine to
 * every textbook figure. Measured with scripts/_star-faces.mjs.
 */
export function starTint(teff) {
  const bv = Math.max(-0.33, Math.min(2.0, 5601 / teff - 0.47));
  const cool = Math.min(1, Math.max(0, (4600 - teff) / 1800));
  const hot = Math.min(1, Math.max(0, (teff - 8000) / 8000));
  return colorIndexToLinearRgb(bv, 2.2 + 1.3 * cool + 0.6 * hot);
}

/**
 * What a star's photosphere looks like, from its temperature and size, for the
 * Star renderer: the things that make an M dwarf, the Sun, a blue giant and a
 * red supergiant different objects rather than one ball in four tints.
 *
 * - Convection cells scale with the pressure scale height, which grows as
 *   surface gravity falls: a dwarf is covered in millions of fine granules, a
 *   red supergiant like Betelgeuse in a handful of cells each larger than the
 *   Sun. Hot stars above about 8000 K have radiative envelopes and almost no
 *   granulation at all.
 * - Spots come with deep convection and fast rotation: M dwarfs are heavily
 *   spotted, the Sun lightly, hot stars not at all.
 * - Limb darkening is strongest in cool atmospheres and weakest in hot ones;
 *   quadratic-law coefficients follow Claret's visual-band tables loosely.
 *
 * @param {number} teff kelvin
 * @param {number} radiusSol
 * @param {number} [seed] per-star variety in spot pattern
 */
export function starLook(teff, radiusSol = 1, seed = 0) {
  const t = Math.max(2200, Math.min(teff, 50000));
  const gravity = Math.log10(Math.max(radiusSol, 0.05));
  const convective = 1 - Math.min(1, Math.max(0, (t - 6800) / 2200));
  const cool = Math.min(1, Math.max(0, (5200 - t) / 2200));
  // Stars of one type still differ: some are near the quiet end of their
  // cycle, some young and covered in spots. Seed 0 is the plain model.
  const h = seed ? ((Math.imul(seed >>> 0, 2654435761) >>> 0) % 10007) / 10007 : 0.5;
  const activity = [0.15, 0.45, 0.8, 1, 1, 1.3, 1.8, 2.6][Math.floor(h * 8)];
  const grain = seed ? 0.7 + ((seed >>> 0) % 61) / 100 : 1;
  // A second independent draw for the giants' shapes.
  const h2 = seed ? ((Math.imul((seed >>> 0) ^ 0x5bd1e995, 2246822519) >>> 0) % 10009) / 10009 : 0.5;
  // A red supergiant has a handful of convection cells the size of the Sun's
  // orbit of the Earth, which push its limb in and out by a few per cent and
  // break its disc into bright and dark blotches; it sheds dust as it does,
  // in shells and arcs. Giants a little of the same; dwarfs none of it.
  const huge = Math.min(1, Math.max(0, (gravity - 1.2) / 1.3));
  const lumpy = huge * (0.025 + 0.07 * h2) * (0.4 + 0.6 * cool) + Math.min(1, Math.max(0, gravity - 0.8)) * 0.008;
  const shell = huge > 0.3 && h2 > 0.25 ? (0.35 + 0.65 * h) * (0.5 + 0.5 * cool) : 0;
  return {
    granScale: Math.max(huge > 0.3 ? 2.2 + 3 * h2 : 6, (420 * grain) / 10 ** (Math.max(gravity, 0) * 0.85)),
    granContrast: (0.15 + 0.31 * convective + 0.1 * cool * Math.min(1, Math.max(gravity, 0))) * (0.85 + 0.3 * h) * (1 + huge * 0.9),
    spots: Math.min(0.85, (0.12 + 0.6 * cool) * convective * (gravity > 1.5 ? 0.4 : 1) * activity),
    limb: [0.3 + 0.45 * cool + 0.02 * convective, 0.12 + 0.11 * convective],
    seed: (seed % 997) / 97,
    lumpy,
    shell,
    glow: 1 + huge * (1.2 + 1.5 * h2),
  };
}
