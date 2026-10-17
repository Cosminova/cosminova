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
import { GalaxySprites, HANDOVER_PX } from './galaxy-sprites.js';
import { GalaxyField } from './galaxy-field.js';
import {
  SUN_GC_PC, cosmicWeb, discSurface, expectedInBox, gaussian, hashCell, makeModel, mix32, mulberry, poisson, spheroid,
} from './galaxy-model.js';
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

const SUN_Z_PC = 20;

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
    /** Galaxies taken from the far field to be visited; see pinFieldGalaxy. */
    this.pinned = new Map();
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
    this.sprites = new GalaxySprites();
    this._spriteWanted = [];
    this._spritePlanAt = -Infinity;
    this._spriteAt = performance.now();
    this._dimmedCatalog = new Set();
    this.field = new GalaxyField();
    this._catalogPoints = this._catalogPointList();
    this._nearAnchor = new Vector3();
    /** Drawn before the catalogue stars, so galaxy dust never darkens a star in front of it. */
    this.underlay = [...this.field.objects, ...this.sprites.objects];
    this.objects = [this.galaxyMesh, this.starPoints];
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
      luminosity: 1.2,
      colour: [0.9, 0.85, 0.78],
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

  /**
   * The real galaxies as the far field draws them once they are too small
   * for a billboard: world position in Mpc, absolute magnitude, and the
   * half-width the billboard is sized by.
   */
  _catalogPointList() {
    const df = this.deepField;
    const list = [];
    for (let i = 0; i < df.galaxies.count; i++) {
      const g = df.galaxyRecords[i];
      const i3 = i * 3;
      const dPc = Math.max((g.d ?? 10) * 1e6, 1e4);
      list.push({
        x: df.galaxyWorld[i3] / MPC_KM,
        y: df.galaxyWorld[i3 + 1] / MPC_KM,
        z: df.galaxyWorld[i3 + 2] / MPC_KM,
        absMag: (g.mag ?? 12) - 5 * Math.log10(dPc) + 5,
        radiusMpc: (df.galaxySizeKm[i] * 0.82) / MPC_KM,
        colour: morphColour(g.morph),
      });
    }
    return list;
  }

  _repackNearPoints(cam) {
    const s = GALAXY_CELL_MPC;
    const anchor = this._nearAnchor.set(
      (Math.floor(cam.x / MPC_KM / s) + 0.5) * s,
      (Math.floor(cam.y / MPC_KM / s) + 0.5) * s,
      (Math.floor(cam.z / MPC_KM / s) + 0.5) * s,
    );
    const list = this._catalogPoints.slice();
    for (const g of this.galaxyList) {
      if (g.pinned) continue;
      list.push({
        x: g.center.x / MPC_KM,
        y: g.center.y / MPC_KM,
        z: g.center.z / MPC_KM,
        absMag: -20.6 - 2.5 * Math.log10(Math.max(g.luminosity, 1e-4)),
        radiusMpc: (g.radiusKm * 0.82) / MPC_KM,
        colour: g.colour,
      });
    }
    this.field.setNear(list, anchor);
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

  /**
   * Makes a galaxy out of a point of the far field, so it can be visited.
   *
   * The field is only light: a level's points stand for galaxies too far off
   * to need any more than that, and on the way in the level hands over to
   * finer ones that never had this galaxy in them. A pinned galaxy is real
   * from then on — a billboard, sprite clouds, stars, a black hole — wherever
   * the camera is, and the field point it came from is no longer drawn.
   *
   * @param {string} id the field's id for the point
   * @param {number} level which field level it came from
   * @param {{x:number,y:number,z:number}} worldMpc
   * @param {{absMag:number, colour:number[]}} record
   */
  pinFieldGalaxy(id, level, worldMpc, record) {
    const key = `fgx:${id}`;
    const existing = this.pinned.get(key);
    if (existing) return existing;
    const seed = hashName(key);
    const random = mulberry(seed);
    // A point of the cluster levels is the light of a whole group; what you
    // arrive at is the giant elliptical at its heart.
    const lum = Math.min(10 ** ((-20.6 - record.absMag) / 2.5), 12);
    const [r, , b] = record.colour;
    const roll = random();
    let morph;
    if (level > 0 || r - b > 0.3) morph = roll < 0.75 ? 'E' : 'S0';
    else if (r - b > 0.05) morph = roll < 0.55 ? 'Sb' : 'SBb';
    else morph = roll < 0.45 ? 'Sc' : roll < 0.85 ? 'SBc' : 'Irr';
    const radiusPc = 15000 * lum ** 0.42 * (0.85 + random() * 0.3);
    const n = new Vector3(gaussian(random), gaussian(random), gaussian(random)).normalize();
    const u = new Vector3(gaussian(random), gaussian(random), gaussian(random));
    u.addScaledVector(n, -u.dot(n)).normalize();
    const w = new Vector3().crossVectors(n, u).normalize();
    const code = morphCode(morph);
    const frame = {
      id: key,
      key,
      name: `${properName(mulberry(seed ^ 0x3c1))} Galaxy`,
      kind: 'generated',
      pinned: true,
      morphLabel: morph,
      center: new Vector3(worldMpc.x * MPC_KM, worldMpc.y * MPC_KM, worldMpc.z * MPC_KM),
      u,
      w,
      n,
      radiusKm: radiusPc * PC_KM,
      luminosity: lum,
      morph: code,
      colour: morphColour(morph),
      seed,
      holeMassSol: (code < 1.5 ? 2e8 : 1.2e7) * lum ** 1.3,
    };
    this.pinned.set(key, frame);
    // A galaxy point is that galaxy, and goes; a cluster's glow stays, since
    // the rest of the cluster is still there.
    if (level === 0) this.field.hidePoint(id);
    this.field.setPinned([...this.pinned.values()].map((g) => ({
      x: g.center.x / MPC_KM,
      y: g.center.y / MPC_KM,
      z: g.center.z / MPC_KM,
      absMag: -20.6 - 2.5 * Math.log10(g.luminosity),
      radiusMpc: (g.radiusKm * 0.82) / MPC_KM,
      colour: g.colour,
    })));
    this._galaxyDirty = true;
    return frame;
  }

  _repackGalaxies() {
    // The Milky Way had no billboard of its own, only its sprites and the
    // particle cloud, so between those giving out and its point taking over
    // home was simply missing from the sky.
    const list = [this.milkyWay, ...this.pinned.values()];
    for (const cell of this.galaxyCells.values()) {
      for (const g of cell.galaxies) {
        if (list.length >= this.galaxyCap) break;
        list.push(g);
      }
    }
    this.galaxyList = list;
    this.generatedGalaxies.clear();
    for (const g of list) if (g.kind === 'generated') this.generatedGalaxies.set(g.key, g);
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

  // ---------------------------------------------------------------- update

  /**
   * Called every frame. Cell bookkeeping runs when the camera has crossed into
   * a new cell at some level; generation is spread over frames under a time
   * budget, so crossing many boundaries at warp does not stall a frame.
   */
  get showClouds() {
    return this.sprites.visible;
  }

  set showClouds(value) {
    this.sprites.visible = value;
  }

  update({ cameraWorld, pixelRatio, pxPerRad = 1000, sunDistanceKm, cameraDistanceToSunKm, farKm = 1e22, budgetMs = 5 }) {
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
      this._repackNearPoints(cam);
    }
    this.field.update({
      cameraWorld: cam,
      cssPerRad: pxPerRad / Math.max(pixelRatio, 1),
      pixelRatio,
      farKm,
    });

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
      let dim = this.sprites.dimFor(g.key);
      // From inside or near it, home is the panorama and the real stars.
      if (g.kind === 'milky-way') dim *= Math.min(1, Math.max(0, (Math.hypot(ox, oy, oz) / g.radiusKm - 5) / 5));
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

    this._updateSprites(cam, pixelRatio, pxPerRad);
  }

  /**
   * Which galaxies are drawn as sprite clouds: the few largest on screen,
   * re-chosen a few times a second, the rest left as billboards.
   */
  _updateSprites(cam, pixelRatio, pxPerRad) {
    const df = this.deepField;
    const now = performance.now();
    const dt = Math.min((now - this._spriteAt) / 1000, 0.25);
    this._spriteAt = now;
    const cssPerRad = pxPerRad / Math.max(pixelRatio, 1);
    const pxOf = (frame) => (frame.radiusKm / Math.max(cam.distanceTo(frame.center), 1)) * cssPerRad;
    if (now - this._spritePlanAt > 250) {
      this._spritePlanAt = now;
      const floor = HANDOVER_PX[0] * 0.8;
      const wanted = [];
      // The Milky Way only from outside; from inside the disc it is the real
      // stars and the panorama.
      if (cam.distanceTo(this.milkyWay.center) > this.milkyWay.radiusKm * 1.25) {
        const px = pxOf(this.milkyWay);
        if (px > floor) wanted.push({ frame: this.milkyWay, px });
      }
      for (let i = 0; i < df.galaxies.count; i++) {
        const i3 = i * 3;
        const d = Math.hypot(df.galaxyWorld[i3] - cam.x, df.galaxyWorld[i3 + 1] - cam.y, df.galaxyWorld[i3 + 2] - cam.z);
        const radius = Math.max(df.galaxySizeKm[i] * 0.5, 300 * PC_KM);
        if ((radius / Math.max(d, 1)) * cssPerRad > floor) {
          const frame = this._catalogFrame(i);
          wanted.push({ frame, px: pxOf(frame) });
        }
      }
      for (const g of this.generatedGalaxies.values()) {
        const px = pxOf(g);
        if (px > floor) wanted.push({ frame: g, px });
      }
      wanted.sort((a, b) => b.px - a.px);
      this._spriteWanted = wanted;
    }
    const wanted = this._spriteWanted.map((w) => ({ frame: w.frame, px: pxOf(w.frame) }));
    this.sprites.update({ cameraWorld: cam, wanted, pxPerRad, pixelRatio, dt });

    // Each galaxy's billboard gives way as its sprites come in.
    const dimmed = new Set();
    for (const slot of this.sprites.slots) {
      const f = slot.frame;
      if (f?.kind === 'catalog' && slot.fade > 0) {
        df.setGalaxyDim(f.catalogIndex, 1 - slot.fade);
        dimmed.add(f.catalogIndex);
      }
      if (f?.kind === 'milky-way' && slot.fade > 0.05) df.milkyWay.points.visible = false;
    }
    for (const index of this._dimmedCatalog) if (!dimmed.has(index)) df.setGalaxyDim(index, 1);
    this._dimmedCatalog = dimmed;

    const focus = this._pickGalaxy(cam, 12);
    const insideHome = focus?.kind === 'milky-way' && cam.distanceTo(focus.center) < focus.radiusKm * 1.25;
    this.focus = insideHome ? null : focus;
    // The sprite clouds draw a nearby galaxy's stars; the deep field's older
    // particle stand-in for them would only double them up.
    if (df.hostStars?.points) df.hostStars.points.visible = false;
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
      ...holeLook(mulberry((galaxy.seed ^ 0x4b1d) >>> 0)),
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
            ...holeLook(random),
            world,
            generated: true,
          });
        }
      }
    }
    return holes;
  }
}

/**
 * How an invented hole is fed: a compact hot disc or a wide cool one, a
 * bright quasar-like glare, or a starved one that is almost only its shadow
 * and the stars it bends.
 */
function holeLook(random) {
  const roll = random();
  const brightness = roll < 0.12 ? 0.08 + random() * 0.1 : roll < 0.3 ? 1.5 + random() * 0.8 : 0.5 + random() * 0.9;
  return {
    brightness,
    diskOuterRs: 9 + random() * 17,
    tempScale: 0.45 + random() * 1.3,
  };
}

function emptyCell(key) {
  return { key, count: 0, local: new Float64Array(0), mags: new Float32Array(0), bvs: new Float32Array(0), softs: new Float32Array(0), seeds: new Uint32Array(0) };
}

/** procgen's generator takes an rng(); a seed-driven one in the same shape. */
function mulberry32Like(seed) {
  return mulberry(seed);
}

/** The deep field's generic host-galaxy particles give way to the real model. */

export { KPC_KM };
