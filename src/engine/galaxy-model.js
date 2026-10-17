import { PC_KM } from './units.js';

/**
 * Galaxy density models and the seeded randomness they are built with, shared
 * by the star cells in cosmos.js and the sprite galaxies in galaxy-sprites.js.
 *
 * Densities are stars per cubic parsec in the galaxy's own frame: x and y in
 * the disc, z along its axis, all in parsecs.
 */

export const SUN_GC_PC = 8178;

// --------------------------------------------------------------- randomness

export function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashCell(seed, level, i, j, k) {
  let h = mix32(seed ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul(level + 17, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(i | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(j | 0, 0x2545f491));
  h = mix32(h ^ Math.imul(k | 0, 0x6c8e9cf5));
  return h || 1;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function poisson(random, mean) {
  if (mean <= 0) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(random)));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = random();
  while (p > limit && k < 200) {
    k++;
    p *= random();
  }
  return k;
}

export function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Smooth value noise in three dimensions, for the cosmic web. */
export function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const h = (a, b, c) => mix32(hashCell(seed, 99, a, b, c)) / 4294967296;
  const ux = s(fx);
  const uy = s(fy);
  const uz = s(fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), ux), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux), uy),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux), uy),
    uz,
  );
}

/**
 * Overdensity of the cosmic web at a point, in Mpc. Ridged noise makes sheets
 * and filaments with voids between them rather than evenly spread blobs; the
 * exponent is what turns the ridges into clusters.
 */
export function cosmicWeb(xMpc, yMpc, zMpc) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1 / 38;
  for (let o = 0; o < 3; o++) {
    const n = valueNoise3(xMpc * frequency, yMpc * frequency, zMpc * frequency, 0x51ab + o);
    total += (1 - Math.abs(n * 2 - 1)) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.3;
  }
  return Math.exp((total / 1.75 - 0.55) * 4.2);
}

// ----------------------------------------------------------- galaxy models

export const sech2 = (t) => {
  const c = Math.cosh(Math.min(Math.abs(t), 30));
  return 1 / (c * c);
};

/** The shape families the density model knows, from the catalogue morph code. */
export function familyOf(code) {
  if (code < 0.6) return 'elliptical';
  if (code < 1.6) return 'lenticular';
  if (code > 5.5) return 'irregular';
  return code >= 3.5 ? 'barred' : 'spiral';
}

/**
 * A galaxy's model, in its own frame: x and y in the disc, z along its axis,
 * all in parsecs. Densities are stars per cubic parsec, normalised to the
 * Milky Way's 0.1 at the Sun.
 */
export function makeModel(galaxy) {
  const radiusPc = galaxy.radiusKm / PC_KM;
  const f = Math.max(radiusPc / 15000, 0.02);
  const family = familyOf(galaxy.morph);
  const magellanicBar = family === 'irregular' && galaxy.morph < 5.8;
  const seedPhase = (galaxy.seed % 10000) / 10000 * Math.PI * 2;
  const model = {
    family,
    radiusPc,
    boundPc: radiusPc * (family === 'elliptical' ? 1.6 : 1.35),
    discScale: 2600 * f,
    discHeight: Math.max(300 * f ** 0.6, 25),
    bulgeScale: (family === 'lenticular' ? 900 : 550) * f,
    discPeak: family === 'irregular' ? 0.04 : 0.1 * Math.exp(SUN_GC_PC / 2600),
    bulgePeak: family === 'irregular' ? 0 : family === 'lenticular' ? 3.5 : 2.2,
    armContrast: family === 'spiral' || family === 'barred' ? 1.0 : 0,
    arms: family === 'barred' ? 2 : 2 + ((galaxy.seed >>> 3) & 1) * 2,
    pitch: Math.tan((family === 'barred' ? 13 : 11 + (galaxy.seed % 7)) * Math.PI / 180),
    phase: seedPhase,
    // The Magellanic barred ones carry a bar too, off-centre and fat, which
    // is the brightest thing in the Large Cloud.
    barLength: family === 'barred' ? 3200 * f : magellanicBar ? 4600 * f : 0,
    barPeak: family === 'barred' ? 0.9 : 0,
    barOffset: magellanicBar ? radiusPc * 0.12 : 0,
    ellipticalScale: radiusPc * 0.22,
    flattening: 0.55 + ((galaxy.seed >>> 7) % 40) / 100,
    seed: galaxy.seed,
  };
  // Small galaxies are thinner in surface density as well as smaller.
  model.discPeak *= Math.min(1, f ** 0.4);
  if (magellanicBar) model.barPeak = model.discPeak * 5;
  if (galaxy.kind === 'generated' || galaxy.pinned) vary(model, galaxy.seed >>> 0);
  return model;
}

/**
 * Within a family, invented galaxies differ the way real ones do: arm count
 * and winding, grand-design or flocculent, big bulge or none, rings, lopsided
 * discs, shells round ellipticals, starbursts and quenched red discs. Catalogue
 * galaxies keep the plain model, which is fitted to what they are.
 */
function vary(m, seed) {
  const random = mulberry((seed ^ 0x9e3779b9) >>> 0);
  const pick = (list) => list[Math.floor(random() * list.length)];
  m.youngBias = 0;
  m.knotRate = 1;
  if (m.family === 'spiral' || m.family === 'barred') {
    m.arms = m.family === 'barred' ? pick([2, 2, 2, 3, 4]) : pick([2, 2, 3, 4, 4, 5, 6]);
    m.pitch = Math.tan((7 + random() * 23) * Math.PI / 180);
    // Flocculent below one, grand design above.
    m.armContrast = pick([0.45, 0.7, 1, 1, 1.25, 1.45]);
    const bulge = pick([0.35, 0.7, 1, 1.3, 1.8]);
    m.bulgePeak *= bulge;
    m.bulgeScale *= 0.7 + bulge * 0.35;
    if (m.family === 'barred') m.barLength *= 0.6 + random() * 0.9;
    m.lopsided = random() < 0.3 ? 0.15 + random() * 0.35 : 0;
    const roll = random();
    if (roll < 0.07) {
      // A ring galaxy: the disc swept out into one bright ring round a core.
      m.ringR = 0.55 + random() * 0.25;
      m.ringW = 0.05 + random() * 0.04;
      m.ringPeak = 25;
      m.discPeak *= 0.15;
      m.armContrast = 0;
      m.barLength = 0;
      m.knotRate = 3;
    } else if (roll < 0.22) {
      m.ringR = 0.3 + random() * 0.45;
      m.ringW = 0.04 + random() * 0.05;
      m.ringPeak = 1.5 + random() * 2;
    }
    const mood = random();
    if (mood < 0.12) {
      m.youngBias = 0.35;
      m.knotRate = Math.max(m.knotRate, 3.5);
    } else if (mood < 0.22) {
      m.youngBias = -0.6;
      m.knotRate = 0.15;
    }
  } else if (m.family === 'lenticular') {
    m.bulgePeak *= pick([0.6, 1, 1.5]);
    if (random() < 0.35) {
      m.ringR = 0.35 + random() * 0.35;
      m.ringW = 0.04 + random() * 0.04;
      m.ringPeak = 1.5 + random() * 2;
    }
  } else if (m.family === 'elliptical') {
    m.flattening = pick([0.35, 0.5, 0.65, 0.8, 0.95]) + random() * 0.05;
    m.ellipticalScale *= 0.7 + random() * 0.6;
    if (random() < 0.25) {
      m.shells = 3 + Math.floor(random() * 3);
      m.shellPhase = random() * Math.PI * 2;
    }
  } else if (m.family === 'irregular') {
    m.clumpPc = 450 + random() * 1300;
    m.youngBias = random() * 0.25;
    m.knotRate = 1.5 + random() * 2;
  }
}

/** Spiral arm modulation at disc position (x, y): 1 on an arm, low between. */
export function armFactor(m, x, y) {
  if (!m.armContrast) return 1;
  const R = Math.hypot(x, y) + 1;
  const theta = Math.atan2(y, x);
  const phase = m.arms * (theta - Math.log(R / 1000) / m.pitch) + m.phase;
  const ridge = Math.exp(-((1 - Math.cos(phase)) * 2.6));
  const c = Math.min(m.armContrast, 1.6);
  return Math.max(1 - 0.58 * c, 0.05) + 1.75 * c * ridge;
}

/** Disc surface term (without the vertical profile), per pc³ at the midplane. */
export function discSurface(m, x, y) {
  const R = Math.hypot(x, y);
  if (m.family === 'elliptical') return 0;
  const truncation = 1 / (1 + Math.exp((R - m.radiusPc) / (m.radiusPc * 0.06)));
  let d = m.discPeak * Math.exp(-R / m.discScale) * truncation;
  if (m.family === 'irregular') {
    const s = m.clumpPc ?? 900;
    const clump = valueNoise3(x / s, y / s, 0, m.seed) * valueNoise3(x / (s * 2.9), y / (s * 2.9), 1, m.seed);
    d *= 0.2 + 3.2 * clump;
  }
  if (m.lopsided) d *= 1 + m.lopsided * Math.cos(Math.atan2(y, x) - m.phase * 1.7) * Math.min((2 * R) / m.radiusPc, 1);
  d *= armFactor(m, x, y);
  if (m.ringPeak) {
    const t = (R / m.radiusPc - m.ringR) / m.ringW;
    // Against the disc's own density at the ring's radius.
    d += m.discPeak * m.ringPeak * Math.exp(-t * t - (m.radiusPc * m.ringR) / m.discScale) * truncation;
  }
  return d;
}

/** Everything that is not the thin disc: bulge, bar, or the whole elliptical. */
export function spheroid(m, x, y, z) {
  if (m.family === 'elliptical') {
    const r = Math.hypot(x, y, z / m.flattening);
    let d = 40 * Math.exp(-7.67 * ((r / m.ellipticalScale) ** 0.25 - 1)) * 1e-4;
    if (m.shells) {
      // Faint arcs on alternating sides, left by a small galaxy it swallowed.
      const theta = Math.atan2(y, x);
      let shell = 0;
      for (let k = 0; k < m.shells; k++) {
        const rk = m.ellipticalScale * (1.2 + k * 0.9);
        const t = (r - rk) / (rk * 0.05);
        shell += Math.exp(-t * t) * Math.max(Math.cos(theta - m.shellPhase - k * Math.PI), 0);
      }
      d *= 1 + 2.5 * shell;
    }
    return d;
  }
  let d = 0;
  if (m.bulgePeak) {
    const r = Math.hypot(x, y, z * 1.6);
    d += m.bulgePeak * Math.exp(-((r / m.bulgeScale) ** 0.9));
  }
  if (m.barLength) {
    const ox = x - m.barOffset * Math.cos(m.phase + 1.9);
    const oy = y - m.barOffset * Math.sin(m.phase + 1.9);
    const bx = ox * Math.cos(m.phase) + oy * Math.sin(m.phase);
    const by = -ox * Math.sin(m.phase) + oy * Math.cos(m.phase);
    const q = Math.hypot(bx / m.barLength, by / (m.barLength * 0.3), z / (m.barLength * 0.12));
    d += m.barPeak * Math.exp(-q * 3);
  }
  return d;
}

export function densityAt(m, x, y, z) {
  return discSurface(m, x, y) * sech2(z / m.discHeight) + spheroid(m, x, y, z);
}

/**
 * Expected stars of every magnitude in an axis-aligned box of the galaxy
 * frame. The disc is integrated through its thickness exactly — a kiloparsec
 * cell is mostly empty space above and below a disc a few hundred parsecs
 * thick, and sampling it at points either misses the disc or hits its
 * midplane — and everything else is sampled at eight points.
 */
export function expectedInBox(m, x0, y0, z0, s) {
  const zd = m.discHeight;
  const vertical = zd * (Math.tanh((z0 + s) / zd) - Math.tanh(z0 / zd));
  let disc = 0;
  let sph = 0;
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      const x = x0 + (a + 0.5) * s * 0.5;
      const y = y0 + (b + 0.5) * s * 0.5;
      disc += discSurface(m, x, y);
      for (let c = 0; c < 2; c++) sph += spheroid(m, x, y, z0 + (c + 0.5) * s * 0.5);
    }
  }
  return (disc / 4) * vertical * s * s + (sph / 8) * s * s * s;
}


/** Phase of the spiral pattern at (x, y): an arm ridge sits where cos(phase) = 1. */
export function armPhase(m, x, y) {
  const R = Math.hypot(x, y) + 1;
  return m.arms * (Math.atan2(y, x) - Math.log(R / 1000) / m.pitch) + m.phase;
}

