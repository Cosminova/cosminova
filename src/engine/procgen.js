import { hashName } from './classify.js';

/**
 * Mulberry32: the generator the cosmos cells use too. A star's colour is drawn
 * when its cell is filled and drawn again when its system is built, and the two
 * only agree if they come out of the same generator from the same seed.
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The physics of invented stars and their planets.
 *
 * Everything the procedural universe makes comes out of here, so a star found
 * by flying into an empty patch of a galaxy and a star the catalogue lists
 * without planets are built by the same rules. Each function takes the
 * caller's random stream and draws from it in a fixed order, which is what
 * makes a place you fly back to the same place.
 */

const SUN_ABS_MAG = 4.83;
const SUN_TEFF = 5772;

/**
 * Stars per cubic parsec per magnitude in the solar neighbourhood, as log10,
 * from M_V = -8 to +18. Bahcall-Soneira and Reid's later counts, rounded: the
 * shape is what matters here — a steep bright end, a plateau of K and M dwarfs,
 * and a fall-off at the bottom of the main sequence.
 */
const LF_MIN = -8;
const LOG_LF = [
  -9.2, -8.6, -7.9, -7.1, -6.4, -5.7, -5.0, -4.4, -3.8, -3.3,
  -3.0, -2.75, -2.55, -2.4, -2.3, -2.2, -2.1, -2.0, -1.95, -1.9,
  -1.9, -1.95, -2.0, -2.15, -2.4, -2.7, -3.0,
];

/** Stars per pc³ per magnitude at absolute magnitude `m`. */
export function luminosityFunction(m) {
  const x = Math.min(Math.max(m - LF_MIN, 0), LOG_LF.length - 1.0001);
  const i = Math.floor(x);
  const f = x - i;
  return 10 ** (LOG_LF[i] * (1 - f) + LOG_LF[i + 1] * f);
}

/** Stars per pc³ with absolute magnitude in [lo, hi). */
export function starsInBand(lo, hi) {
  let sum = 0;
  const steps = Math.max(4, Math.ceil((hi - lo) * 4));
  const h = (hi - lo) / steps;
  for (let s = 0; s < steps; s++) sum += luminosityFunction(lo + (s + 0.5) * h) * h;
  return sum;
}

/** An absolute magnitude in [lo, hi), drawn in proportion to how common it is. */
export function sampleMagnitude(random, lo, hi) {
  const peak = Math.max(luminosityFunction(lo), luminosityFunction(hi), luminosityFunction((lo + hi) / 2));
  for (let tries = 0; tries < 24; tries++) {
    const m = lo + random() * (hi - lo);
    if (random() * peak <= luminosityFunction(m)) return m;
  }
  return (lo + hi) / 2;
}

// The main sequence: M_V, B-V, effective temperature, mass and radius in
// solar units. Interpolated, it is the star a given brightness most often is.
const MAIN_SEQUENCE = [
  [-5.8, -0.32, 38000, 40, 10],
  [-4.5, -0.30, 30000, 18, 7.4],
  [-3.2, -0.25, 22000, 10, 5.5],
  [-1.5, -0.17, 15000, 5.0, 3.5],
  [0.0, -0.05, 11000, 3.0, 2.5],
  [0.6, 0.0, 9600, 2.4, 2.0],
  [1.5, 0.15, 8200, 1.9, 1.7],
  [2.5, 0.3, 7200, 1.6, 1.5],
  [3.5, 0.45, 6400, 1.25, 1.2],
  [4.4, 0.58, 5900, 1.05, 1.05],
  [4.83, 0.65, 5772, 1.0, 1.0],
  [5.9, 0.82, 5200, 0.88, 0.85],
  [7.0, 1.1, 4500, 0.73, 0.72],
  [8.2, 1.35, 3900, 0.6, 0.6],
  [9.5, 1.45, 3600, 0.47, 0.47],
  [11.5, 1.55, 3300, 0.3, 0.3],
  [13.5, 1.7, 3100, 0.18, 0.2],
  [16.0, 1.9, 2800, 0.1, 0.12],
  [18.5, 2.0, 2500, 0.08, 0.1],
];

function mainSequence(m) {
  const t = MAIN_SEQUENCE;
  if (m <= t[0][0]) return t[0];
  for (let i = 1; i < t.length; i++) {
    if (m <= t[i][0]) {
      const a = t[i - 1];
      const b = t[i];
      const f = (m - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => v + (b[k] - v) * f);
    }
  }
  return t[t.length - 1];
}

/**
 * What fraction of stars at this brightness are evolved rather than on the
 * main sequence. Near M_V 0 to +1 the red clump giants outnumber dwarfs of
 * the same brightness; above that the sky is supergiants and hot dwarfs in
 * roughly equal measure; fainter than +3 almost everything is a dwarf, apart
 * from the white dwarfs that make up a few percent of the faint end.
 */
function evolvedFraction(m) {
  if (m < -4) return 0.45;
  if (m < -1) return 0.4;
  if (m < 2) return 0.55;
  if (m < 3.5) return 0.15;
  return 0;
}

const SPECTRAL = [
  [30000, 'O'], [10000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [0, 'M'],
];

function spectralType(teff, cls) {
  if (cls === 'white-dwarf') return teff > 12000 ? 'DA2' : teff > 8000 ? 'DA5' : 'DC8';
  let i = 0;
  while (teff < SPECTRAL[i][0]) i++;
  const hi = i === 0 ? 50000 : SPECTRAL[i - 1][0];
  const lo = SPECTRAL[i][0] || 2400;
  const sub = Math.max(0, Math.min(9, Math.floor((1 - (teff - lo) / Math.max(hi - lo, 1)) * 10)));
  const lum = cls === 'supergiant' ? 'Ia' : cls === 'giant' ? 'III' : 'V';
  return `${SPECTRAL[i][1]}${sub}${lum}`;
}

/** B-V from temperature, the same fit the system renderer inverts. */
export function teffToBv(teff) {
  return Math.max(-0.33, Math.min(2.0, 5601 / teff - 0.47));
}

/**
 * A whole star, from its absolute visual magnitude.
 *
 * Radius follows from luminosity and temperature rather than being looked up,
 * so a giant and a dwarf of the same brightness come out the right sizes.
 */
export function starFromMagnitude(random, absMag) {
  let cls = 'dwarf';
  let teff;
  let massSol;
  const roll = random();
  if (absMag > 10 && roll < 0.06) {
    cls = 'white-dwarf';
    teff = 5000 + random() * 20000;
    massSol = 0.55 + random() * 0.3;
  } else if (roll < evolvedFraction(absMag)) {
    if (absMag < -3) {
      cls = 'supergiant';
      // Blue and red supergiants, with the yellow ones rare in between: a star
      // crosses that gap fast.
      teff = random() < 0.55 ? 3400 + random() * 1200 : 9000 + random() * 22000;
      massSol = 12 + random() * 25;
    } else {
      cls = 'giant';
      teff = absMag < -1 ? 3500 + random() * 1300 : 4300 + random() * 900;
      massSol = 1 + random() * 3.5;
    }
  } else {
    const ms = mainSequence(absMag + (random() - 0.5) * 0.4);
    teff = ms[2];
    massSol = ms[3];
  }
  const lumSol = 10 ** ((SUN_ABS_MAG - absMag) / 2.5);
  const radiusSol = cls === 'white-dwarf'
    ? 0.009 + random() * 0.006
    : Math.sqrt(lumSol) * (SUN_TEFF / teff) ** 2;
  return {
    absMag,
    bv: teffToBv(teff),
    teff: Math.round(teff),
    massSol,
    radiusSol,
    lumSol,
    cls,
    spect: spectralType(teff, cls),
  };
}

// ------------------------------------------------------------------ planets

const LETTERS = 'bcdefghijk';

/**
 * Moons, by the same two processes the invented galaxy systems use: a few
 * regular moons from the circumplanetary disc and a tail of captured ones,
 * with giants getting both and small rocky worlds usually neither.
 */
function inventMoons(random, name, radiusEarth) {
  const giant = radiusEarth > 3;
  const regular = giant
    ? 1 + Math.floor(random() * 5)
    : radiusEarth > 1.2
      ? (random() > 0.5 ? 1 + Math.floor(random() * 2) : 0)
      : random() > 0.86 ? 1 : 0;
  const moonlets = giant ? Math.floor(random() ** 2 * 18) : Math.floor(random() ** 3 * 4);
  const moons = [];
  for (let m = 0; m < regular + moonlets; m++) {
    const isRegular = m < regular;
    moons.push({
      name: `${name}${m + 1}`,
      radiusEarth: isRegular ? 0.02 + 0.4 * random() ** 3 : 0.0004 + 0.02 * random() ** 3,
      aAu: (0.0008 + random() * (isRegular ? 0.004 : 0.02)) * (m + 1),
      periodDays: 1.2 + random() * (isRegular ? 18 : 300),
      inclinationDeg: isRegular ? random() * 2 : random() * 180,
    });
  }
  return moons;
}

/** Mass from radius, along the observed mass-radius relation. */
function massFromRadius(random, r) {
  if (r < 1.5) return r ** 3.6 * (0.8 + random() * 0.4);
  if (r < 4) return 2.7 * r ** 1.3 * (0.7 + random() * 0.6);
  if (r < 7) return 15 + random() * 30;
  return 50 + random() ** 1.5 * 1500;
}

/**
 * The planets of one star, physically: where they can form and what they are
 * likely to be there.
 *
 * - How many: M dwarfs carry the most small planets, A stars few, the hottest
 *   stars and evolved ones fewer still.
 * - Where: spaced in period ratio the way compact Kepler systems are, starting
 *   near the dust sublimation radius.
 * - What: rocky worlds and sub-Neptunes inside the snow line (with the radius
 *   valley between them), giants beyond it with a frequency that rises with
 *   stellar mass, and the occasional hot Jupiter that migrated in.
 */
export function inventPlanetsFor(random, host, star) {
  const L = Math.max(star.lumSol, 1e-5);
  const sqrtL = Math.sqrt(L);
  let mean;
  if (star.cls === 'white-dwarf') mean = 0.25;
  else if (star.cls === 'supergiant') mean = 0.15;
  else if (star.cls === 'giant') mean = 0.8;
  else if (star.teff > 10000) mean = 0.4;
  else if (star.teff > 7500) mean = 1.2;
  else if (star.teff > 3900) mean = 3.2;
  else mean = 3.8;
  // Kepler's counts are a floor, not the truth: it only sees planets whose
  // orbits happen to line up with us and are short enough to repeat.
  mean *= 1.6;
  // Poisson by inversion, capped at what a renderer can carry.
  let count = 0;
  let p = Math.exp(-mean);
  let cumulative = p;
  const u = random();
  while (u > cumulative && count < 10) {
    count++;
    p *= mean / count;
    cumulative += p;
  }
  if (!count && star.cls === 'dwarf' && random() < 0.6) count = 1 + Math.floor(random() * 3);
  if (!count) return [];

  const snowLine = 2.7 * sqrtL * Math.min(star.massSol, 3) ** 0.2;
  const giantRate = Math.min(0.55, 0.12 * star.massSol ** 1.1);
  const starRadiusAu = star.radiusSol * 0.00465047;
  let aAu = Math.max(0.04 * sqrtL, starRadiusAu * 4, 0.012) * (1 + random() * 2.5);
  if (star.cls !== 'dwarf') aAu = Math.max(aAu, starRadiusAu * 6, 0.4 * sqrtL);

  // Somewhere temperate, more often than not, around a star that lives long
  // enough for it to matter. One orbit is nudged into the habitable zone and
  // given a rocky size rather than added, so the spacing stays a real system's.
  const temperateSlot = star.cls === 'dwarf' && star.teff > 2600 && star.teff < 7600 && random() < 0.5
    ? Math.floor(random() * count) : -1;
  const planets = [];
  for (let k = 0; k < count; k++) {
    if (k > 0) aAu *= (1.35 + random() * 1.4) ** (2 / 3) * (aAu < snowLine ? 1 : 1.25);
    if (k === temperateSlot) aAu = Math.max(aAu, sqrtL * (1.0 + random() * 0.5));
    let radiusEarth;
    const hot = aAu < 0.1;
    if (hot && random() < 0.012 * star.massSol) {
      radiusEarth = 11 + random() * 6;
    } else if (aAu > snowLine * 0.85 && random() < giantRate) {
      radiusEarth = random() < 0.65 ? 8 + random() * 5 : 3.4 + random() * 1.4;
    } else if (aAu > snowLine * 2.5 && random() < 0.35) {
      radiusEarth = 3.4 + random() * 1.4;
    } else {
      const roll = random();
      radiusEarth = roll < 0.45 ? 0.45 + random() * 1.15 : roll < 0.85 ? 1.9 + random() * 1.6 : 1.55 + random() * 0.4;
    }
    if (k === temperateSlot) radiusEarth = 0.6 + random() * 1.0;
    const massEarth = massFromRadius(random, radiusEarth);
    const name = `${host} ${LETTERS[k]}`;
    planets.push({
      name,
      aAu,
      periodDays: 365.25 * Math.sqrt(aAu ** 3 / Math.max(star.massSol, 0.08)),
      radiusEarth,
      massEarth,
      equilibriumK: star.teff * Math.sqrt(starRadiusAu / (2 * aAu)) * 0.88,
      eccentricity: random() ** 3 * 0.3,
      habitable: aAu > 0.95 * sqrtL && aAu < 1.67 * sqrtL && radiusEarth < 1.7,
      moons: inventMoons(random, name, radiusEarth),
    });
  }
  return planets;
}

// -------------------------------------------------------------------- names

const ONSETS = ['k', 'v', 's', 't', 'r', 'n', 'm', 'd', 'l', 'th', 'kr', 'z', 'h', 'b', 'p', 'sh', 'g', 'f', 'c', 'dr', 'st', 'br', 'qu'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ae', 'ia', 'y'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'x', 'th', 'm', 'nd', 'k'];

/** A pronounceable proper name, two or three syllables. */
export function properName(random) {
  const syllables = 2 + (random() < 0.3 ? 1 : 0);
  let name = '';
  for (let s = 0; s < syllables; s++) {
    // Only the first syllable may open on a vowel; after that every syllable
    // starts with a consonant, so vowels never pile up across the joins.
    if (s > 0 || random() > 0.2) name += ONSETS[Math.floor(random() * ONSETS.length)];
    name += VOWELS[Math.floor(random() * VOWELS.length)];
    if (s === syllables - 1 || random() < 0.3) name += CODAS[Math.floor(random() * CODAS.length)];
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * A star of the procedural universe, in the shape the system renderer takes.
 * `seed` is the star's identity — its cell and index — so the same point of
 * light always unfolds into the same planets.
 */
export function inventStarSystem(seed, { absMag, name, world, region, bv }) {
  const random = seededRandom(seed || 1);
  const star = starFromMagnitude(random, absMag);
  // A catalogue star has a measured colour, and the star you arrive at has to
  // be the colour of the point you flew towards.
  if (Number.isFinite(bv) && star.cls !== 'white-dwarf') {
    star.teff = Math.round(5601 / (Math.max(bv, -0.32) + 0.47));
    star.bv = bv;
    star.radiusSol = Math.sqrt(star.lumSol) * (SUN_TEFF / star.teff) ** 2;
    star.cls = star.radiusSol > 30 ? 'supergiant' : star.radiusSol > 4 && star.teff < 6000 ? 'giant' : star.cls;
    star.spect = spectralType(star.teff, star.cls);
  }
  const host = name ?? properName(random);
  return {
    host,
    teff: star.teff,
    radiusSol: star.radiusSol,
    massSol: star.massSol,
    lumSol: star.lumSol,
    spect: star.spect,
    starClass: star.cls,
    world,
    generated: true,
    region,
    planets: inventPlanetsFor(random, host, star),
  };
}

/** A catalogue star the archive lists no planets for, given some. */
export function inventForCatalogStar(catalogKey, { name, absMag, world, bv }) {
  return inventStarSystem(hashName(String(catalogKey)), { absMag, name, world, bv, region: 'Milky Way' });
}
