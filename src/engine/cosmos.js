import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { equatorialToVector, galacticToEquatorial } from '../astro.js';
import { hashName } from './classify.js';
import { STAR_FRAGMENT, STAR_VERTEX, morphCode, morphColour } from './deep-field.js';
import { platform } from './platform.js';
import { properName, sampleMagnitude, starFromMagnitude, starsInBand } from './procgen.js';
import { equatorialToEcliptic, KPC_KM, MPC_KM, PC_KM } from './units.js';

/**
 * The universe past the catalogues: an endless, seeded cosmos generated around
 * the camera and thrown away behind it.
 *
 * Space is cut into cells at many scales, and only the cells around the camera
 * exist. Each is filled from a seed made of its coordinates, so flying away
 * and coming back finds the same stars in the same places — the same trick a
 * voxel game uses for terrain, done in three dimensions and across fourteen
 * orders of magnitude.
 *
 * Two kinds of cell:
 *
 * - Star cells, inside whichever galaxy the camera is in. A level holds one
 *   band of absolute magnitude, sized so the stars in it are only visible from
 *   within about one cell: faint dwarfs in cells a parsec or two across near
 *   the camera, supergiants in cells kiloparsecs across that span the galaxy.
 *   That is what keeps a galaxy of a hundred billion stars down to the tens of
 *   thousands that could actually be seen from where you are.
 * - Galaxy cells, megaparsecs across, filled with galaxies whose density
 *   follows a cosmic web of filaments and voids. Near the Sun they give way to
 *   the real galaxy catalogue, fading in from 45 Mpc out where it thins.
 *
 * Stars are counted with the solar-neighbourhood luminosity function and
 * placed in each galaxy by a density model of its type: an exponential disc
 * with spiral arms and a bulge, a bar for the barred ones, a de Vaucouleurs
 * ellipsoid, or clumpy irregular light. Each star unfolds into a planetary
 * system when you reach it; see procgen.js.
 */

/** The faintest a star is meant to look from the edge of its cell. */
const DESIGN_LIMIT_MAG = 7.4;
const STAR_CELL_BASE_PC = 1.6;
/** Cells along each axis loaded per level, centred on the camera. */
const BLOCK = 4;
const MAX_PER_CELL = 1400;

const GALAXY_CELL_MPC = 5;
const GALAXY_BLOCK_RADIUS = 3;
/** Galaxies brighter than a fiftieth of L* per cubic megaparsec. */
const GALAXY_DENSITY = 0.016;
const CATALOGUE_FADE_MPC = [45, 90];

const SUN_GC_PC = 8178;
const SUN_Z_PC = 20;

// --------------------------------------------------------------- randomness

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashCell(seed, level, i, j, k) {
  let h = mix32(seed ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul(level + 17, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(i | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(j | 0, 0x2545f491));
  h = mix32(h ^ Math.imul(k | 0, 0x6c8e9cf5));
  return h || 1;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(random, mean) {
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

function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Smooth value noise in three dimensions, for the cosmic web. */
function valueNoise3(x, y, z, seed) {
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
function cosmicWeb(xMpc, yMpc, zMpc) {
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

const sech2 = (t) => {
  const c = Math.cosh(Math.min(Math.abs(t), 30));
  return 1 / (c * c);
};

/** The shape families the density model knows, from the catalogue morph code. */
function familyOf(code) {
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
function makeModel(galaxy) {
  const radiusPc = galaxy.radiusKm / PC_KM;
  const f = Math.max(radiusPc / 15000, 0.02);
  const family = familyOf(galaxy.morph);
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
    barLength: family === 'barred' ? 3200 * f : 0,
    ellipticalScale: radiusPc * 0.22,
    flattening: 0.55 + ((galaxy.seed >>> 7) % 40) / 100,
    seed: galaxy.seed,
  };
  // Small galaxies are thinner in surface density as well as smaller.
  model.discPeak *= Math.min(1, f ** 0.4);
  return model;
}

/** Spiral arm modulation at disc position (x, y): 1 on an arm, low between. */
function armFactor(m, x, y) {
  if (!m.armContrast) return 1;
  const R = Math.hypot(x, y) + 1;
  const theta = Math.atan2(y, x);
  const phase = m.arms * (theta - Math.log(R / 1000) / m.pitch) + m.phase;
  const ridge = Math.exp(-((1 - Math.cos(phase)) * 2.6));
  return 0.42 + 1.75 * ridge;
}

/** Disc surface term (without the vertical profile), per pc³ at the midplane. */
function discSurface(m, x, y) {
  const R = Math.hypot(x, y);
  if (m.family === 'elliptical') return 0;
  const truncation = 1 / (1 + Math.exp((R - m.radiusPc) / (m.radiusPc * 0.06)));
  let d = m.discPeak * Math.exp(-R / m.discScale) * truncation;
  if (m.family === 'irregular') {
    const clump = valueNoise3(x / 900, y / 900, 0, m.seed) * valueNoise3(x / 2600, y / 2600, 1, m.seed);
    d *= 0.2 + 3.2 * clump;
  }
  return d * armFactor(m, x, y);
}

/** Everything that is not the thin disc: bulge, bar, or the whole elliptical. */
function spheroid(m, x, y, z) {
  if (m.family === 'elliptical') {
    const r = Math.hypot(x, y, z / m.flattening);
    return 40 * Math.exp(-7.67 * ((r / m.ellipticalScale) ** 0.25 - 1)) * 1e-4;
  }
  let d = 0;
  if (m.bulgePeak) {
    const r = Math.hypot(x, y, z * 1.6);
    d += m.bulgePeak * Math.exp(-((r / m.bulgeScale) ** 0.9));
  }
  if (m.barLength) {
    const bx = x * Math.cos(m.phase) + y * Math.sin(m.phase);
    const by = -x * Math.sin(m.phase) + y * Math.cos(m.phase);
    const q = Math.hypot(bx / m.barLength, by / (m.barLength * 0.3), z / (m.barLength * 0.12));
    d += 0.9 * Math.exp(-q * 3);
  }
  return d;
}

function densityAt(m, x, y, z) {
  return discSurface(m, x, y) * sech2(z / m.discHeight) + spheroid(m, x, y, z);
}

/**
 * Expected stars of every magnitude in an axis-aligned box of the galaxy
 * frame. The disc is integrated through its thickness exactly — a kiloparsec
 * cell is mostly empty space above and below a disc a few hundred parsecs
 * thick, and sampling it at points either misses the disc or hits its
 * midplane — and everything else is sampled at eight points.
 */
function expectedInBox(m, x0, y0, z0, s) {
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

// -------------------------------------------------------------- star levels

const TOTAL_DENSITY = starsInBand(-10, 19);

function buildLevels() {
  const levels = [];
  let s = STAR_CELL_BASE_PC;
  let hi = 19;
  for (let L = 0; L < 18; L++) {
    const nextS = s * 2;
    let lo = DESIGN_LIMIT_MAG + 5 - 5 * Math.log10(nextS);
    if (lo < -9.5) lo = -10;
    levels.push({ L, sizePc: s, lo, hi, fraction: starsInBand(lo, hi) / TOTAL_DENSITY });
    if (lo <= -10) break;
    hi = lo;
    s = nextS;
  }
  return levels;
}

// ------------------------------------------------------------------ shaders

const GEN_STAR_VERTEX = STAR_VERTEX
  .replace('attribute vec3 starColor;', 'attribute vec3 starColor;\n  attribute float aSoft;\n  uniform float uSoftFade;')
  .replace('intensity *= visibility;', 'intensity *= visibility * mix(1.0, uSoftFade, aSoft);');

const CLOUD_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 starColor;
  uniform vec3 uCenter;
  uniform vec3 uU;
  uniform vec3 uW;
  uniform vec3 uN;
  uniform float uOpacity;
  uniform float uPixelRatio;
  uniform float uNearKm;
  uniform float uPointKm;
  varying vec3 vColor;
  void main() {
    vec3 pos = uCenter + uU * position.x + uW * position.y + uN * position.z;
    float dist = max(length(pos), 1.0);
    // Each point stands for a cloud of stars about uPointKm across. Close to,
    // it is resolved into the real stars of the cell layer, so it bows out
    // before it can read as one enormous star.
    float near = smoothstep(uNearKm, uNearKm * 3.0, dist);
    float size = clamp(uPointKm / dist * 900.0, 1.0, 3.2);
    vColor = starColor * uOpacity * near;
    gl_PointSize = size * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    vec2 pc = (gl_PointCoord - 0.5) * 2.0;
    float d2 = dot(pc, pc);
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-d2 * 3.5), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

// --------------------------------------------------------------------- core

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

export class Cosmos {
  /**
   * @param {object} options
   * @param {import('./deep-field.js').DeepField} options.deepField
   * @param {{sample(bv:number, out:Float32Array, offset:number):void}} options.colorLookup
   */
  constructor({ deepField, colorLookup }) {
    this.deepField = deepField;
    this.colorLookup = colorLookup;
    this.levels = buildLevels();
    this.capacity = platform.deviceClass === 'phone' ? 70000 : platform.deviceClass === 'tablet' ? 110000 : 170000;

    this.milkyWay = this._milkyWayFrame();
    this.catalogFrames = new Map();
    this.generatedGalaxies = new Map();
    this.galaxyCells = new Map();
    this.starCells = new Map();
    this.active = null;
    this.focus = null;
    this._dirty = false;
    this._lastPlanKey = '';
    this._hideSeed = 0;
    this.stats = { stars: 0, cells: 0, galaxies: 0 };

    this._buildStarLayer();
    this._buildGalaxyLayer();
    this._buildCloudLayer();
    this.showClouds = true;
    this.objects = [this.galaxyMesh, this.starPoints, this.cloudPoints];
  }

  // ----------------------------------------------------------------- frames

  _milkyWayFrame() {
    const toWorld = (l, b) => {
      const { ra, dec } = galacticToEquatorial(l, b);
      const v = equatorialToVector(ra, dec);
      equatorialToEcliptic(v);
      return v.normalize();
    };
    const toCentre = toWorld(0, 0);
    const n = toWorld(0, 90);
    const center = toCentre.clone().multiplyScalar(SUN_GC_PC * PC_KM);
    center.addScaledVector(n, -SUN_Z_PC * PC_KM);
    const u = toCentre.clone().negate();
    u.addScaledVector(n, -u.dot(n)).normalize();
    const w = new Vector3().crossVectors(n, u).normalize();
    return {
      id: 'milky-way',
      key: 'gal:milky-way',
      name: 'Milky Way',
      kind: 'milky-way',
      center,
      u,
      w,
      n,
      radiusKm: 15000 * PC_KM,
      morph: 4.2,
      seed: 0x4d57,
      holeKey: 'bh:sgr-a',
    };
  }

  _catalogFrame(index) {
    let frame = this.catalogFrames.get(index);
    if (frame) return frame;
    const df = this.deepField;
    const g = df.galaxyRecords[index];
    const i3 = index * 3;
    const center = new Vector3(df.galaxyWorld[i3], df.galaxyWorld[i3 + 1], df.galaxyWorld[i3 + 2]);
    const uRaw = new Vector3(df.galaxyAxisU[i3], df.galaxyAxisU[i3 + 1], df.galaxyAxisU[i3 + 2]);
    const vRaw = new Vector3(df.galaxyAxisV[i3], df.galaxyAxisV[i3 + 1], df.galaxyAxisV[i3 + 2]);
    // The billboard is the disc as projected on our sky: its short axis is the
    // long one foreshortened by the inclination. Undo that, so the disc in
    // three dimensions is tipped away along the line of sight by exactly the
    // angle that makes it look, from Earth, like the photograph.
    const ratio = Math.min(1, Math.max(0.05, vRaw.length() / Math.max(uRaw.length(), 1)));
    const u = uRaw.normalize();
    const vHat = vRaw.normalize();
    const depth = center.clone().normalize();
    depth.addScaledVector(u, -depth.dot(u)).addScaledVector(vHat, -depth.dot(vHat)).normalize();
    const w = vHat.clone().multiplyScalar(ratio).addScaledVector(depth, Math.sqrt(1 - ratio * ratio)).normalize();
    const n = new Vector3().crossVectors(u, w).normalize();
    frame = {
      id: g.id,
      key: `gal:${g.id}`,
      name: g.name || g.id,
      kind: 'catalog',
      catalogIndex: index,
      center,
      u,
      w,
      n,
      radiusKm: Math.max(df.galaxySizeKm[index] * 0.5, 300 * PC_KM),
      morph: morphCode(g.morph),
      seed: hashName(g.id),
    };
    this.catalogFrames.set(index, frame);
    return frame;
  }

  /** The galaxy whose stars are being generated around the camera, if any. */
  _pickGalaxy(cam, reach) {
    let best = null;
    let bestScore = reach;
    const consider = (frame) => {
      const d = cam.distanceTo(frame.center) / frame.radiusKm;
      if (d < bestScore) {
        bestScore = d;
        best = frame;
      }
    };
    consider(this.milkyWay);
    const df = this.deepField;
    for (let i = 0; i < df.galaxies.count; i++) {
      const i3 = i * 3;
      const dx = df.galaxyWorld[i3] - cam.x;
      const dy = df.galaxyWorld[i3 + 1] - cam.y;
      const dz = df.galaxyWorld[i3 + 2] - cam.z;
      const radius = Math.max(df.galaxySizeKm[i] * 0.5, 300 * PC_KM);
      if (Math.hypot(dx, dy, dz) < radius * bestScore) consider(this._catalogFrame(i));
    }
    for (const g of this.generatedGalaxies.values()) consider(g);
    return best;
  }

  // ------------------------------------------------------------ star layer

  _buildStarLayer() {
    const n = this.capacity;
    this.world = new Float64Array(n * 3);
    this.relative = new Float32Array(n * 3);
    this.absMag = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.soft = new Float32Array(n);
    this.seeds = new Uint32Array(n);
    this.count = 0;
    const base = this.deepField.starMaterial;
    this.starMaterial = new ShaderMaterial({
      uniforms: { ...base.uniforms, uSoftFade: { value: 1 } },
      vertexShader: GEN_STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });
    const geometry = new BufferGeometry();
    this.relAttr = new BufferAttribute(this.relative, 3).setUsage(35048);
    this.magAttr = new BufferAttribute(this.absMag, 1).setUsage(35048);
    this.colorAttr = new BufferAttribute(this.colors, 3).setUsage(35048);
    this.softAttr = new BufferAttribute(this.soft, 1).setUsage(35048);
    geometry.setAttribute('position', this.relAttr);
    geometry.setAttribute('absMag', this.magAttr);
    geometry.setAttribute('starColor', this.colorAttr);
    geometry.setAttribute('aSoft', this.softAttr);
    geometry.setDrawRange(0, 0);
    geometry.computeBoundingSphere = () => {};
    this.starGeometry = geometry;
    this.starPoints = new Points(geometry, this.starMaterial);
    this.starPoints.frustumCulled = false;
    this.starPoints.renderOrder = 2;
  }

  /** The cells each level wants around the camera, keyed so reuse is a lookup. */
  _wantedStarCells(galaxy, cam) {
    const local = this._toLocal(galaxy, cam, _v);
    const m = galaxy.model;
    const wanted = [];
    for (const level of this.levels) {
      const s = level.sizePc;
      // Nothing at this level could be seen from here: its cells sit inside a
      // galaxy the camera is far outside of, and its stars are too faint.
      const reach = s * BLOCK;
      if (Math.abs(local.x) > m.boundPc + reach || Math.abs(local.y) > m.boundPc + reach
        || Math.abs(local.z) > m.boundPc * 0.6 + reach) continue;
      const bi = Math.floor(local.x / s - (BLOCK - 1) / 2 - 0.5);
      const bj = Math.floor(local.y / s - (BLOCK - 1) / 2 - 0.5);
      const bk = Math.floor(local.z / s - (BLOCK - 1) / 2 - 0.5);
      for (let i = bi; i < bi + BLOCK; i++) {
        for (let j = bj; j < bj + BLOCK; j++) {
          for (let k = bk; k < bk + BLOCK; k++) {
            wanted.push({ level, i, j, k, key: `${galaxy.id}|${level.L}|${i}|${j}|${k}` });
          }
        }
      }
    }
    return wanted;
  }

  _toLocal(galaxy, world, out) {
    _a.subVectors(world, galaxy.center);
    return out.set(_a.dot(galaxy.u) / PC_KM, _a.dot(galaxy.w) / PC_KM, _a.dot(galaxy.n) / PC_KM);
  }

  _generateStarCell(galaxy, cell) {
    const { level, i, j, k } = cell;
    const m = galaxy.model;
    const s = level.sizePc;
    const x0 = i * s;
    const y0 = j * s;
    const z0 = k * s;
    const seed = hashCell(galaxy.seed, level.L, i, j, k);
    const random = mulberry(seed);
    // Cells clear of the galaxy entirely are empty, and cheap to say so.
    const cx = x0 + s / 2;
    const cy = y0 + s / 2;
    const cz = z0 + s / 2;
    const nearest = Math.hypot(Math.max(Math.abs(cx) - s, 0), Math.max(Math.abs(cy) - s, 0));
    if (nearest > m.boundPc || Math.abs(cz) - s > m.boundPc * 0.6) return emptyCell(cell.key);

    const expected = expectedInBox(m, x0, y0, z0, s) * level.fraction;
    let count = Math.min(poisson(random, expected), MAX_PER_CELL);
    if (!count) return emptyCell(cell.key);

    // Split between disc and spheroid in proportion to what each contributes.
    const discShare = (() => {
      const total = expectedInBox(m, x0, y0, z0, s);
      if (!(total > 0)) return 0;
      const flatOnly = { ...m, bulgePeak: 0, barLength: 0, family: m.family === 'elliptical' ? 'none' : m.family };
      return m.family === 'elliptical' ? 0 : Math.min(1, expectedInBox(flatOnly, x0, y0, z0, s) / total);
    })();

    const isMilkyWay = galaxy.kind === 'milky-way';
    const sunLocal = isMilkyWay ? { x: SUN_GC_PC, y: 0, z: SUN_Z_PC } : null;
    const positions = new Float64Array(count * 3);
    const mags = new Float32Array(count);
    const bvs = new Float32Array(count);
    const softs = new Float32Array(count);
    const seeds = new Uint32Array(count);
    const zd = m.discHeight;
    const t0 = Math.tanh(z0 / zd);
    const t1 = Math.tanh((z0 + s) / zd);
    let peakDisc = 0;
    let peakSph = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        peakDisc = Math.max(peakDisc, discSurface(m, x0 + (a / 2) * s, y0 + (b / 2) * s));
        for (let c = 0; c < 3; c++) peakSph = Math.max(peakSph, spheroid(m, x0 + (a / 2) * s, y0 + (b / 2) * s, z0 + (c / 2) * s));
      }
    }
    peakDisc *= 1.6;
    peakSph *= 1.6;

    let n = 0;
    for (let q = 0; q < count; q++) {
      let x;
      let y;
      let z;
      let placed = false;
      const inDisc = random() < discShare;
      for (let tries = 0; tries < 12 && !placed; tries++) {
        x = x0 + random() * s;
        y = y0 + random() * s;
        if (inDisc) {
          const t = t0 + (t1 - t0) * random();
          z = zd * Math.atanh(Math.max(-0.999999, Math.min(0.999999, t)));
          placed = random() * peakDisc <= discSurface(m, x, y);
        } else {
          z = z0 + random() * s;
          placed = random() * peakSph <= spheroid(m, x, y, z);
        }
      }
      // Draws after this point happen whether or not the star survives, so a
      // star that is dropped below does not reshuffle the ones after it.
      const starSeed = mix32(seed + Math.imul(q + 1, 0x9e3779b1));
      const absMag = sampleMagnitude(random, level.lo, level.hi);
      if (!placed) continue;
      let softFlag = 0;
      if (sunLocal) {
        // Where the real catalogue already has this star, the real one wins.
        const dPc = Math.hypot(x - sunLocal.x, y - sunLocal.y, z - sunLocal.z);
        const apparent = absMag + 5 * Math.log10(Math.max(dPc, 0.1)) - 5;
        if (dPc < 4000 && apparent < 11) continue;
        // Further out, it would be hidden from Earth by dust that this
        // renderer does not draw, so it is only shown once you leave home.
        if (apparent < 11 + 1.4 * (dPc / 1000)) softFlag = 1;
      }
      const star = starFromMagnitude(mulberry32Like(starSeed), absMag);
      positions[n * 3] = x;
      positions[n * 3 + 1] = y;
      positions[n * 3 + 2] = z;
      mags[n] = absMag;
      bvs[n] = star.bv;
      softs[n] = softFlag;
      seeds[n] = starSeed;
      n++;
    }
    return {
      key: cell.key,
      level: level.L,
      count: n,
      local: positions.subarray(0, n * 3),
      mags: mags.subarray(0, n),
      bvs: bvs.subarray(0, n),
      softs: softs.subarray(0, n),
      seeds: seeds.subarray(0, n),
      galaxy,
    };
  }

  _repackStars() {
    let n = 0;
    const cap = this.capacity;
    const g = this.active;
    for (const cell of this.starCells.values()) {
      for (let q = 0; q < cell.count && n < cap; q++) {
        const lx = cell.local[q * 3] * PC_KM;
        const ly = cell.local[q * 3 + 1] * PC_KM;
        const lz = cell.local[q * 3 + 2] * PC_KM;
        const frame = cell.galaxy;
        this.world[n * 3] = frame.center.x + frame.u.x * lx + frame.w.x * ly + frame.n.x * lz;
        this.world[n * 3 + 1] = frame.center.y + frame.u.y * lx + frame.w.y * ly + frame.n.y * lz;
        this.world[n * 3 + 2] = frame.center.z + frame.u.z * lx + frame.w.z * ly + frame.n.z * lz;
        this.absMag[n] = cell.seeds[q] === this._hideSeed ? 99 : cell.mags[q];
        this.colorLookup.sample(cell.bvs[q], this.colors, n * 3);
        this.soft[n] = cell.softs[q];
        this.seeds[n] = cell.seeds[q];
        n++;
      }
    }
    void g;
    this.count = n;
    this.starGeometry.setDrawRange(0, n);
    this.magAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.softAttr.needsUpdate = true;
    this.stats.stars = n;
    this.stats.cells = this.starCells.size;
  }

  // ---------------------------------------------------------- galaxy layer

  _buildGalaxyLayer() {
    const cap = 4096;
    this.galaxyCap = cap;
    const plane = new PlaneGeometry(2, 2);
    const geometry = new InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    const attr = (size) => new InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(35048);
    this.gOffset = attr(3);
    this.gAxisU = attr(3);
    this.gAxisV = attr(3);
    this.gSize = attr(2);
    this.gColor = attr(3);
    this.gParams = attr(3);
    geometry.setAttribute('iOffset', this.gOffset);
    geometry.setAttribute('iAxisU', this.gAxisU);
    geometry.setAttribute('iAxisV', this.gAxisV);
    geometry.setAttribute('iSize', this.gSize);
    geometry.setAttribute('iColor', this.gColor);
    geometry.setAttribute('iParams', this.gParams);
    geometry.instanceCount = 0;
    this.galaxyGeometry = geometry;
    this.galaxyList = [];
    // The catalogue's own material, so a generated galaxy and a real one are
    // drawn by the same shader under the same zoom.
    this.galaxyMesh = new Mesh(geometry, this.deepField.galaxyMaterial);
    this.galaxyMesh.frustumCulled = false;
    this.galaxyMesh.renderOrder = 1;
    this.galaxyMesh.material.side = DoubleSide;
  }

  _generateGalaxyCell(i, j, k) {
    const key = `${i}|${j}|${k}`;
    const s = GALAXY_CELL_MPC;
    const cx = (i + 0.5) * s;
    const cy = (j + 0.5) * s;
    const cz = (k + 0.5) * s;
    const fromSun = Math.hypot(cx, cy, cz);
    const [fadeIn, fadeOut] = CATALOGUE_FADE_MPC;
    const beyond = Math.min(1, Math.max(0, (fromSun - fadeIn) / (fadeOut - fadeIn)));
    const web = cosmicWeb(cx, cy, cz);
    const random = mulberry(hashCell(0xc05a05, 1, i, j, k));
    const count = Math.min(poisson(random, GALAXY_DENSITY * s * s * s * web * beyond), 60);
    const galaxies = [];
    // Galaxies gather: most of a cell's are drawn towards one or two centres of
    // their own, which is what makes groups and clusters on top of the web.
    const centres = [0, 1].map(() => [cx + (random() - 0.5) * s, cy + (random() - 0.5) * s, cz + (random() - 0.5) * s]);
    for (let q = 0; q < count; q++) {
      const grouped = random() < 0.6;
      const c = centres[q & 1];
      const px = grouped ? c[0] + gaussian(random) * 0.9 : cx + (random() - 0.5) * s;
      const py = grouped ? c[1] + gaussian(random) * 0.9 : cy + (random() - 0.5) * s;
      const pz = grouped ? c[2] + gaussian(random) * 0.9 : cz + (random() - 0.5) * s;
      // Schechter luminosity with a faint-end slope of -1.2, from a fiftieth
      // of L* up: mostly dwarfs, a few giants.
      let lum = 0.02;
      for (let tries = 0; tries < 40; tries++) {
        const x = 0.02 * 250 ** random();
        if (random() < x ** -0.2 * Math.exp(-x) / (0.02 ** -0.2)) {
          lum = x;
          break;
        }
      }
      const dense = web > 2.4;
      const roll = random();
      let morph;
      if (lum < 0.08) morph = roll < 0.55 ? 'Irr' : roll < 0.85 ? 'E' : 'Sm';
      else if (dense) morph = roll < 0.35 ? 'E' : roll < 0.6 ? 'S0' : roll < 0.85 ? 'Sb' : 'SBb';
      else morph = roll < 0.12 ? 'E' : roll < 0.22 ? 'S0' : roll < 0.48 ? 'Sc' : roll < 0.68 ? 'Sb' : roll < 0.88 ? 'SBc' : 'Irr';
      const radiusPc = 15000 * lum ** 0.42 * (0.75 + random() * 0.5);
      const n = new Vector3(gaussian(random), gaussian(random), gaussian(random)).normalize();
      const u = new Vector3(gaussian(random), gaussian(random), gaussian(random));
      u.addScaledVector(n, -u.dot(n)).normalize();
      const w = new Vector3().crossVectors(n, u).normalize();
      const seed = hashCell(0x6a1a, q, i, j, k);
      const designation = `CGX ${String(Math.abs(i) % 1000).padStart(3, '0')}${i < 0 ? 'w' : 'e'}-${String(Math.abs(j * 31 + k) % 10000).padStart(4, '0')}${String.fromCharCode(97 + (q % 26))}`;
      const named = lum > 0.35 ? `${properName(mulberry(seed))} Galaxy` : designation;
      const code = morphCode(morph);
      galaxies.push({
        id: `cgx:${i}:${j}:${k}:${q}`,
        key: `cgx:${i}:${j}:${k}:${q}`,
        name: named,
        designation,
        kind: 'generated',
        morphLabel: morph,
        center: new Vector3(px * MPC_KM, py * MPC_KM, pz * MPC_KM),
        u,
        w,
        n,
        radiusKm: radiusPc * PC_KM,
        luminosity: lum,
        morph: code,
        colour: morphColour(morph),
        seed,
        holeMassSol: (code < 1.5 ? 2e8 : 1.2e7) * lum ** 1.3,
      });
    }
    return { key, galaxies };
  }

  _repackGalaxies() {
    const list = [];
    for (const cell of this.galaxyCells.values()) {
      for (const g of cell.galaxies) {
        if (list.length >= this.galaxyCap) break;
        list.push(g);
      }
    }
    this.galaxyList = list;
    this.generatedGalaxies.clear();
    for (const g of list) this.generatedGalaxies.set(g.key, g);
    for (let q = 0; q < list.length; q++) {
      const g = list[q];
      const r = g.radiusKm;
      this.gSize.array[q * 2] = r * 0.82;
      this.gSize.array[q * 2 + 1] = r * 0.82;
      this.gColor.array.set(g.colour, q * 3);
      this.gParams.array[q * 3] = g.morph;
      this.gParams.array[q * 3 + 1] = (g.seed % 100000) / 100000;
      this.gParams.array[q * 3 + 2] = Math.max(0.12, Math.min(0.3, 0.16 + 0.05 * Math.log10(g.luminosity + 0.01)));
    }
    this.galaxyGeometry.instanceCount = list.length;
    this.gSize.needsUpdate = true;
    this.gColor.needsUpdate = true;
    this.gParams.needsUpdate = true;
    this.stats.galaxies = list.length;
  }

  // ------------------------------------------------------------ cloud layer

  /**
   * The galaxy you are near, as a three-dimensional cloud of star clusters
   * shaped by its own model, in place of the painted disc. Built for one
   * galaxy at a time, which is the only one close enough for its depth to show.
   */
  _buildCloudLayer() {
    this.cloudCount = platform.deviceClass === 'phone' ? 26000 : 60000;
    const geometry = new BufferGeometry();
    this.cloudLocal = new Float32Array(this.cloudCount * 3);
    this.cloudColors = new Float32Array(this.cloudCount * 3);
    this.cloudPosAttr = new BufferAttribute(this.cloudLocal, 3);
    this.cloudColAttr = new BufferAttribute(this.cloudColors, 3);
    geometry.setAttribute('position', this.cloudPosAttr);
    geometry.setAttribute('starColor', this.cloudColAttr);
    geometry.computeBoundingSphere = () => {};
    this.cloudMaterial = new ShaderMaterial({
      uniforms: {
        uCenter: { value: new Vector3() },
        uU: { value: new Vector3() },
        uW: { value: new Vector3() },
        uN: { value: new Vector3() },
        uOpacity: { value: 0 },
        uPixelRatio: { value: 1 },
        uNearKm: { value: 1 },
        uPointKm: { value: 1 },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });
    this.cloudPoints = new Points(geometry, this.cloudMaterial);
    this.cloudPoints.frustumCulled = false;
    this.cloudPoints.renderOrder = 3;
    this.cloudPoints.visible = false;
    this.cloudFor = null;
  }

  _fillCloud(galaxy) {
    const m = galaxy.model;
    const random = mulberry(galaxy.seed ^ 0xc10d);
    const n = this.cloudCount;
    const bound = m.boundPc;
    const zBound = m.family === 'elliptical' ? bound * m.flattening : Math.max(m.discHeight * 6, m.bulgeScale * 2.5);
    // A peak for rejection, from a coarse scan of the model.
    let peak = 0;
    for (let a = -8; a <= 8; a++) {
      for (let b = -8; b <= 8; b++) {
        peak = Math.max(peak, densityAt(m, (a / 8) * bound * 0.5, (b / 8) * bound * 0.5, 0));
      }
    }
    peak = Math.max(peak, densityAt(m, 0, 0, 0)) * 1.2;
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 400; tries++) {
      // Drawn from a density raised to a power below one, so the outskirts and
      // the arms between them still get points; brightness is then put back.
      const x = (random() * 2 - 1) * bound;
      const y = (random() * 2 - 1) * bound;
      const z = (random() * 2 - 1) * zBound;
      const rho = densityAt(m, x, y, z);
      if (random() * peak ** 0.55 > rho ** 0.55) continue;
      this.cloudLocal[placed * 3] = x;
      this.cloudLocal[placed * 3 + 1] = y;
      this.cloudLocal[placed * 3 + 2] = z;
      const sph = spheroid(m, x, y, z);
      const disc = rho - sph;
      const arm = m.armContrast ? Math.max(0, armFactor(m, x, y) - 1) : 0;
      const young = disc > 0 ? Math.min(1, (disc / Math.max(rho, 1e-12)) * (0.25 + arm * 0.6)) : 0;
      let r = 1.0;
      let g = 0.82;
      let b = 0.6;
      if (m.family === 'irregular' || young > 0.3) {
        r = 0.62; g = 0.76; b = 1.0;
      }
      if (young > 0.45 && random() < 0.08) {
        r = 1.0; g = 0.42; b = 0.56;
      }
      const lift = (rho / peak) ** 0.45 * (0.55 + random() * 0.9);
      this.cloudColors[placed * 3] = r * lift;
      this.cloudColors[placed * 3 + 1] = g * lift;
      this.cloudColors[placed * 3 + 2] = b * lift;
      placed++;
    }
    this.cloudPoints.geometry.setDrawRange(0, placed);
    this.cloudPosAttr.needsUpdate = true;
    this.cloudColAttr.needsUpdate = true;
    this.cloudFor = galaxy.key;
  }

  // ---------------------------------------------------------------- update

  /**
   * Called every frame. Cell bookkeeping runs when the camera has crossed into
   * a new cell at some level; generation is spread over frames under a time
   * budget, so crossing many boundaries at warp does not stall a frame.
   */
  update({ cameraWorld, pixelRatio, sunDistanceKm, cameraDistanceToSunKm, budgetMs = 5 }) {
    const cam = cameraWorld;
    const t0 = performance.now();

    // Galaxy cells around the camera, in megaparsecs from the Sun.
    const gs = GALAXY_CELL_MPC;
    const gi = Math.floor(cam.x / MPC_KM / gs);
    const gj = Math.floor(cam.y / MPC_KM / gs);
    const gk = Math.floor(cam.z / MPC_KM / gs);
    const galaxyKey = `${gi}|${gj}|${gk}`;
    if (galaxyKey !== this._galaxyPlan) {
      this._galaxyPlan = galaxyKey;
      this._wantedGalaxyCells = [];
      const R = GALAXY_BLOCK_RADIUS;
      for (let i = gi - R; i <= gi + R; i++) {
        for (let j = gj - R; j <= gj + R; j++) {
          for (let k = gk - R; k <= gk + R; k++) this._wantedGalaxyCells.push([i, j, k]);
        }
      }
      const keep = new Set(this._wantedGalaxyCells.map((c) => c.join('|')));
      for (const key of this.galaxyCells.keys()) if (!keep.has(key)) this.galaxyCells.delete(key);
      this._galaxyDirty = true;
    }
    let generatedGalaxies = false;
    for (const [i, j, k] of this._wantedGalaxyCells) {
      const key = `${i}|${j}|${k}`;
      if (this.galaxyCells.has(key)) continue;
      this.galaxyCells.set(key, this._generateGalaxyCell(i, j, k));
      generatedGalaxies = true;
      if (performance.now() - t0 > budgetMs) break;
    }
    if (generatedGalaxies || this._galaxyDirty) {
      this._galaxyDirty = false;
      this._repackGalaxies();
    }

    // Which galaxy the camera is in, and its stars.
    const galaxy = this._pickGalaxy(cam, 2.4);
    if (galaxy && !galaxy.model) galaxy.model = makeModel(galaxy);
    if (galaxy !== this.active) {
      this.active = galaxy;
      this.starCells.clear();
      this._starPlan = '';
      this._dirty = true;
    }
    if (galaxy) {
      const local = this._toLocal(galaxy, cam, _b);
      const planKey = this.levels
        .map((l) => `${Math.floor(local.x / l.sizePc)},${Math.floor(local.y / l.sizePc)},${Math.floor(local.z / l.sizePc)}`)
        .join(';');
      if (planKey !== this._starPlan) {
        this._starPlan = planKey;
        this._wantedStars = this._wantedStarCells(galaxy, cam);
        const keep = new Set(this._wantedStars.map((c) => c.key));
        for (const key of this.starCells.keys()) {
          if (!keep.has(key)) {
            this.starCells.delete(key);
            this._dirty = true;
          }
        }
      }
      for (const cell of this._wantedStars) {
        if (this.starCells.has(cell.key)) continue;
        if (performance.now() - t0 > budgetMs) break;
        this.starCells.set(cell.key, this._generateStarCell(galaxy, cell));
        this._dirty = true;
      }
    }
    if (this._dirty) {
      this._dirty = false;
      this._repackStars();
    }

    // Camera-relative positions, exactly as the catalogue stars do it.
    const rel = this.relative;
    const world = this.world;
    for (let q = 0, n = this.count; q < n; q++) {
      const q3 = q * 3;
      rel[q3] = world[q3] - cam.x;
      rel[q3 + 1] = world[q3 + 1] - cam.y;
      rel[q3 + 2] = world[q3 + 2] - cam.z;
    }
    this.relAttr.needsUpdate = true;
    // Generated Milky Way stars the dust would hide from Earth stay hidden
    // until you have travelled far enough from it for that to stop mattering.
    const homePc = (cameraDistanceToSunKm ?? sunDistanceKm) / PC_KM;
    this.starMaterial.uniforms.uSoftFade.value = Math.min(1, Math.max(0, (homePc - 900) / 1800));

    // Generated galaxies, camera-relative; ellipticals turned to face you.
    const list = this.galaxyList;
    for (let q = 0; q < list.length; q++) {
      const g = list[q];
      const ox = g.center.x - cam.x;
      const oy = g.center.y - cam.y;
      const oz = g.center.z - cam.z;
      this.gOffset.array[q * 3] = ox;
      this.gOffset.array[q * 3 + 1] = oy;
      this.gOffset.array[q * 3 + 2] = oz;
      let ux = g.u.x;
      let uy = g.u.y;
      let uz = g.u.z;
      let vx = g.w.x;
      let vy = g.w.y;
      let vz = g.w.z;
      if (g.morph < 0.6) {
        _a.set(ox, oy, oz).normalize();
        _b.set(0, 1, 0).cross(_a);
        if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0);
        _b.normalize();
        _v.crossVectors(_a, _b).normalize();
        ux = _b.x; uy = _b.y; uz = _b.z;
        vx = _v.x; vy = _v.y; vz = _v.z;
      }
      const dim = this.focus === g ? 1 - this._cloudFade : 1;
      const r = g.radiusKm * 0.82;
      this.gAxisU.array[q * 3] = ux * r;
      this.gAxisU.array[q * 3 + 1] = uy * r;
      this.gAxisU.array[q * 3 + 2] = uz * r;
      const flat = g.morph < 0.6 ? 0.6 + (g.seed % 30) / 100 : 1;
      this.gAxisV.array[q * 3] = vx * r * flat;
      this.gAxisV.array[q * 3 + 1] = vy * r * flat;
      this.gAxisV.array[q * 3 + 2] = vz * r * flat;
      this.gParams.array[q * 3 + 2] = Math.max(0.12, Math.min(0.3, 0.16 + 0.05 * Math.log10(g.luminosity + 0.01))) * dim;
    }
    this.gOffset.needsUpdate = true;
    this.gAxisU.needsUpdate = true;
    this.gAxisV.needsUpdate = true;
    this.gParams.needsUpdate = true;

    this._updateCloud(cam, pixelRatio);
  }

  _updateCloud(cam, pixelRatio) {
    // The nearest galaxy in units of its own size, out to twelve radii. The
    // Milky Way has a particle disc and a panorama of its own already.
    const focus = this._pickGalaxy(cam, 12);
    const df = this.deepField;
    // The Milky Way is drawn as a cloud too, but only from outside: from
    // inside the disc it is the real stars and the panorama.
    const insideHome = focus?.kind === 'milky-way' && cam.distanceTo(focus.center) < focus.radiusKm * 1.25;
    if (!focus || insideHome) {
      if (this.focus?.kind === 'catalog') df.setGalaxyDim(this.focus.catalogIndex, 1);
      this.focus = null;
      this._cloudFade = 0;
      this.cloudPoints.visible = false;
      return;
    }
    if (!focus.model) focus.model = makeModel(focus);
    if (this.focus && this.focus !== focus && this.focus.kind === 'catalog') df.setGalaxyDim(this.focus.catalogIndex, 1);
    this.focus = focus;
    if (this.cloudFor !== focus.key) this._fillCloud(focus);
    const d = cam.distanceTo(focus.center) / focus.radiusKm;
    // In over the last few radii, completely by two.
    this._cloudFade = Math.min(1, Math.max(0, (11 - d) / 8));
    if (focus.kind === 'catalog') df.setGalaxyDim(focus.catalogIndex, 1 - this._cloudFade);
    const u = this.cloudMaterial.uniforms;
    u.uCenter.value.subVectors(focus.center, cam);
    u.uU.value.copy(focus.u).multiplyScalar(PC_KM);
    u.uW.value.copy(focus.w).multiplyScalar(PC_KM);
    u.uN.value.copy(focus.n).multiplyScalar(PC_KM);
    u.uOpacity.value = this._cloudFade * 0.55 * Math.min(1, 60000 / this.cloudCount) ** 0.3;
    u.uPixelRatio.value = pixelRatio;
    // Points stand in for regions a few hundred parsecs across; inside one,
    // the star cells are drawing it properly.
    u.uNearKm.value = focus.radiusKm * 0.05;
    u.uPointKm.value = focus.radiusKm * 0.01;
    hostStarsOff(df, this._cloudFade);
    if (focus.kind === 'milky-way' && this._cloudFade > 0.05) df.milkyWay.points.visible = false;
    this.cloudPoints.visible = this.showClouds && this._cloudFade > 0.01;
  }

  // ---------------------------------------------------------------- queries

  /** The nearest generated star to a world position, from what is loaded. */
  nearestStar(world, maxKm = Infinity) {
    let best = -1;
    let bestD2 = maxKm * maxKm;
    const w = this.world;
    for (let q = 0; q < this.count; q++) {
      const dx = w[q * 3] - world.x;
      const dy = w[q * 3 + 1] - world.y;
      const dz = w[q * 3 + 2] - world.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = q;
      }
    }
    if (best < 0) return null;
    return {
      seed: this.seeds[best],
      absMag: this.absMag[best] > 90 ? null : this.absMag[best],
      world: new Vector3(w[best * 3], w[best * 3 + 1], w[best * 3 + 2]),
      distanceKm: Math.sqrt(bestD2),
      galaxy: this.active,
    };
  }

  /** The star with this seed, if its cell is loaded. */
  starBySeed(seed) {
    for (const cell of this.starCells.values()) {
      for (let q = 0; q < cell.count; q++) {
        if (cell.seeds[q] !== seed) continue;
        const f = cell.galaxy;
        const lx = cell.local[q * 3] * PC_KM;
        const ly = cell.local[q * 3 + 1] * PC_KM;
        const lz = cell.local[q * 3 + 2] * PC_KM;
        return {
          seed,
          absMag: cell.mags[q],
          bv: cell.bvs[q],
          world: new Vector3(
            f.center.x + f.u.x * lx + f.w.x * ly + f.n.x * lz,
            f.center.y + f.u.y * lx + f.w.y * ly + f.n.y * lz,
            f.center.z + f.u.z * lx + f.w.z * ly + f.n.z * lz,
          ),
          galaxy: f,
        };
      }
    }
    return null;
  }

  /** Stop drawing one star as a point, because its system is drawing it. */
  hideStar(seed) {
    if (this._hideSeed === seed) return;
    this._hideSeed = seed;
    this._dirty = true;
  }

  /** Generated galaxies near the camera, nearest first. */
  nearbyGalaxies(world, limit = 12) {
    return [...this.generatedGalaxies.values()]
      .map((g) => ({ g, d: g.center.distanceTo(world) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((item) => item.g);
  }

  /** A galaxy's supermassive hole, as the spec the BlackHole renderer takes. */
  holeSpecFor(galaxy) {
    if (!galaxy || galaxy.kind === 'milky-way' || galaxy.holeKey) return null;
    const massSol = galaxy.holeMassSol ?? 4e6 * (galaxy.radiusKm / (15000 * PC_KM)) ** 4;
    return {
      key: `${galaxy.key}:core`,
      name: `${galaxy.name} core`,
      massSol: Math.max(massSol, 2e5),
      spin: 0.5 + (galaxy.seed % 50) / 100,
      inclinationDeg: 20 + (galaxy.seed % 60),
      jet: galaxy.morph < 0.6 && massSol > 5e8 ? 1 : 0,
      world: galaxy.center.clone(),
      generated: true,
    };
  }

  /**
   * Black hole binaries in the galaxy being flown through: about one for every
   * cubic kiloparsec of disc, which is the right order for X-ray binaries and
   * what makes one a thing you can find by flying around.
   */
  nearbyHoles(cam, maxPc = 400) {
    const g = this.active;
    if (!g?.model) return [];
    const s = 700;
    const local = this._toLocal(g, cam, _b);
    const holes = [];
    const ci = Math.floor(local.x / s);
    const cj = Math.floor(local.y / s);
    const ck = Math.floor(local.z / s);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let k = ck - 1; k <= ck + 1; k++) {
          const seed = hashCell(g.seed ^ 0xb1ac, 30, i, j, k);
          const random = mulberry(seed);
          const expected = (expectedInBox(g.model, i * s, j * s, k * s, s) / (s ** 3 * 0.1)) * 0.35;
          if (random() > Math.min(expected, 0.9)) continue;
          const x = (i + random()) * s;
          const y = (j + random()) * s;
          const zd = g.model.discHeight;
          const z = Math.max(k * s, Math.min((k + 1) * s, gaussian(random) * zd * 0.6));
          if (Math.hypot(x - local.x, y - local.y, z - local.z) > maxPc) continue;
          const world = g.center.clone()
            .addScaledVector(g.u, x * PC_KM)
            .addScaledVector(g.w, y * PC_KM)
            .addScaledVector(g.n, z * PC_KM);
          const massSol = 5 + random() ** 2 * 30;
          holes.push({
            key: `bhx:${g.id}:${i}:${j}:${k}`,
            name: `${properName(random)} X-${1 + Math.floor(random() * 9)}`,
            massSol,
            spin: 0.3 + random() * 0.69,
            inclinationDeg: 10 + random() * 70,
            jet: random() < 0.25 ? 1 : 0,
            world,
            generated: true,
          });
        }
      }
    }
    return holes;
  }
}

function emptyCell(key) {
  return { key, count: 0, local: new Float64Array(0), mags: new Float32Array(0), bvs: new Float32Array(0), softs: new Float32Array(0), seeds: new Uint32Array(0) };
}

/** procgen's generator takes an rng(); a seed-driven one in the same shape. */
function mulberry32Like(seed) {
  return mulberry(seed);
}

/** The deep field's generic host-galaxy particles give way to the real model. */
function hostStarsOff(df, fade) {
  if (fade > 0.05 && df.hostStars?.points) df.hostStars.points.visible = false;
}

export { KPC_KM };
