import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { cosmicWeb, gaussian, hashCell, mulberry, poisson } from './galaxy-model.js';
import { MPC_KM } from './units.js';

/**
 * Every galaxy too small on screen for a billboard, as a point of light, out
 * to the edge of what could be seen from wherever the camera is.
 *
 * A galaxy a few pixels across is a billboard; one smaller than that was
 * simply not drawn, and the generated cells only reach a couple of dozen
 * megaparsecs. So past a megaparsec or so from home the screen went black —
 * the universe ended. It does not: from anywhere at all there are galaxies
 * in every direction, thinning into the distance until redshift takes them.
 *
 * Nested cell levels, each eight times the size of the last, centred on the
 * camera like the star cells are. A level only holds what is bright enough to
 * see from beyond the level inside it, so each keeps a few tens of thousands
 * of points however far it reaches:
 *
 * - near: the catalogue, the Milky Way, and the generated galaxies around the
 *   camera, one point each, handed over to their billboards as they resolve.
 * - galaxies: the giants in 40 Mpc cells out to a hundred and more.
 * - clusters: rich groups in 320 Mpc cells, soft knots of light out to a
 *   gigaparsec.
 * - superclusters: in 2.5 Gpc cells, out to where redshift fades everything.
 *
 * Each level hides what lies inside the region the level within it covers,
 * so nothing is drawn twice. Positions are kept in megaparsecs relative to an
 * anchor near the level's block, so they stay precise in float32 however far
 * the camera is from the Sun.
 */

/** Hubble distance, c / H0 at 70 km/s/Mpc, in Mpc. */
const HUBBLE_MPC = 4283;
/** Apparent width in CSS pixels across which a galaxy's billboard takes over from its point. */
export const POINT_HANDOVER_PX = [2, 6];
/** Where the near level's generated cells and the catalogue give way (Mpc from the Sun). */
const CATALOGUE_FADE_MPC = [45, 90];

const LEVELS = [
  // S: cell size; R: block radius in cells; hide: the finer level covers
  // everything nearer than this (Mpc); lMin/lMax: luminosity range in L*;
  // perCell: mean objects per cell at average web density.
  { name: 'galaxies', S: 40, R: 3, hide: 15, perCell: 34, lMin: 1.6, lMax: 12, radiusMpc: 0.02, cap: 90 },
  { name: 'clusters', S: 320, R: 2, hide: 118, perCell: 44, lMin: 30, lMax: 900, radiusMpc: 0.7, cap: 120 },
  { name: 'superclusters', S: 2560, R: 2, hide: 630, perCell: 70, lMin: 600, lMax: 2e4, radiusMpc: 4, cap: 160 },
];

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aAbsMag;
  attribute float aRadius;
  attribute vec3 aColor;
  uniform vec3 uAnchor;
  uniform float uCssPerRad;
  uniform float uPixelRatio;
  uniform float uRefMag;
  uniform float uGain;
  uniform vec2 uHide;
  uniform vec2 uReach;
  uniform vec2 uResolved;
  uniform vec2 uSunFade;
  uniform vec3 uAnchorWorld;
  uniform float uFarKm;
  varying vec3 vColor;
  void main() {
    vec3 rel = position + uAnchor;
    float d = max(length(rel), 1e-7);
    float m = aAbsMag + 5.0 * log2(d * 1e6) / log2(10.0) - 5.0;
    float z = d / ${HUBBLE_MPC.toFixed(1)};
    float flux = exp2((uRefMag - m) * 0.4 * log2(10.0)) / ((1.0 + z) * (1.0 + z));

    float px = 2.0 * aRadius / d * uCssPerRad;
    float shown = smoothstep(uHide.x, uHide.y, d) * (1.0 - smoothstep(uResolved.x, uResolved.y, px))
      * (1.0 - smoothstep(uReach.x, uReach.y, d));
    // The catalogue stands for the real sky near home; generated light fades
    // in only beyond where it thins out.
    float fromSun = length(position + uAnchorWorld);
    shown *= mix(1.0, smoothstep(uSunFade.x, uSunFade.y, fromSun), step(0.5, uSunFade.y));

    float minPx = 2.6;
    float sizeCss = clamp(px, minPx, 96.0);
    float spread = (minPx * minPx) / (sizeCss * sizeCss);
    // A gentle response: the real range of galaxy brightness would leave all
    // but a few dozen invisible, where the eye at a telescope sees a field.
    float level = uGain * pow(flux, 0.5) * spread;
    float reddening = clamp(z * 1.6, 0.0, 1.0);
    vec3 tint = aColor * vec3(1.0, 1.0 - 0.28 * reddening, 1.0 - 0.55 * reddening);
    vColor = tint * min(level, 1.6) * shown;

    gl_PointSize = sizeCss * uPixelRatio;
    // The far plane is a few hundred megaparsecs; anything past it is drawn on
    // the same ray, closer, at the size it really has.
    float km = d * ${MPC_KM.toExponential(8)};
    vec3 posKm = rel / d * min(km, uFarKm);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(posKm, 1.0);
    if (dot(vColor, vec3(1.0)) < 0.0015) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    vec2 pc = (gl_PointCoord - 0.5) * 2.0;
    float d2 = dot(pc, pc);
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(vColor * (exp(-d2 * 3.4) - 0.033), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

function makeLayer(capacity, { refMag, gain, resolved = [1e9, 2e9], sunFade = [0, 0], reach = [1e9, 2e9] }) {
  const geometry = new BufferGeometry();
  const arrays = {
    position: new Float32Array(capacity * 3),
    aAbsMag: new Float32Array(capacity),
    aRadius: new Float32Array(capacity),
    aColor: new Float32Array(capacity * 3),
  };
  for (const [name, array] of Object.entries(arrays)) {
    geometry.setAttribute(name, new BufferAttribute(array, array.length / capacity));
  }
  geometry.setDrawRange(0, 0);
  geometry.computeBoundingSphere = () => {};
  const material = new ShaderMaterial({
    uniforms: {
      uAnchor: { value: new Vector3() },
      uCssPerRad: { value: 600 },
      uPixelRatio: { value: 1 },
      uRefMag: { value: refMag },
      uGain: { value: gain },
      uHide: { value: new Vector2(-2, -1) },
      uReach: { value: new Vector2(reach[0], reach[1]) },
      uResolved: { value: new Vector2(resolved[0], resolved[1]) },
      uSunFade: { value: new Vector2(sunFade[0], sunFade[1]) },
      uAnchorWorld: { value: new Vector3() },
      uFarKm: { value: 3e21 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 0;
  return {
    points,
    arrays,
    capacity,
    count: 0,
    /** Anchor in Mpc, world frame, float64. */
    anchor: new Vector3(),
    commit(n) {
      this.count = n;
      geometry.setDrawRange(0, n);
      for (const attr of Object.values(geometry.attributes)) attr.needsUpdate = true;
    },
  };
}

/** The apparent magnitude drawn at full brightness; fainter falls off as the square root of flux. */
const REF_MAG = 10;

/** L* in absolute magnitude, B band. */
const M_STAR = -20.6;

function absMagOf(luminosity) {
  return M_STAR - 2.5 * Math.log10(Math.max(luminosity, 1e-6));
}

/** A luminosity from N(>L) ∝ 1/L between lo and hi. */
function powerLaw(random, lo, hi) {
  const u = random();
  return 1 / (1 / lo - u * (1 / lo - 1 / hi));
}

const OLD = [1.0, 0.84, 0.62];
const YOUNG = [0.74, 0.82, 1.0];
const MIXED = [0.9, 0.86, 0.8];

export class GalaxyField {
  constructor() {
    // The catalogue holds dwarfs as well as giants, so seen from much past
    // the galaxies level's reach it would stand out as a ball of light around
    // home; there the clusters level is what is drawn, as it is everywhere.
    this.near = makeLayer(12000, {
      refMag: REF_MAG, gain: 1, resolved: POINT_HANDOVER_PX, reach: [LEVELS[1].hide * 0.82, LEVELS[1].hide],
    });
    this.levels = LEVELS.map((spec, i) => ({
      ...spec,
      index: i,
      layer: makeLayer(
        spec.cap * (2 * spec.R + 1) ** 3,
        { refMag: REF_MAG, gain: [1, 0.9, 0.8][i], sunFade: i === 0 ? CATALOGUE_FADE_MPC : [0, 0] },
      ),
      cells: new Map(),
      plan: '',
      wanted: [],
      dirty: false,
    }));
    for (const level of this.levels) {
      level.layer.points.material.uniforms.uHide.value.set(level.hide * 0.82, level.hide);
    }
    this.objects = [this.near.points, ...this.levels.map((l) => l.layer.points)];
    this._cam = new Vector3();
    this.visible = true;
  }

  /**
   * The near level: catalogue galaxies, the Milky Way and the generated
   * galaxies around the camera, each a point until its billboard resolves.
   * @param {{x:number,y:number,z:number,absMag:number,radiusMpc:number,colour:number[]}[]} list world Mpc
   * @param {Vector3} anchorMpc
   */
  setNear(list, anchorMpc) {
    const layer = this.near;
    layer.anchor.copy(anchorMpc);
    const a = layer.arrays;
    const n = Math.min(list.length, layer.capacity);
    for (let q = 0; q < n; q++) {
      const g = list[q];
      a.position[q * 3] = g.x - anchorMpc.x;
      a.position[q * 3 + 1] = g.y - anchorMpc.y;
      a.position[q * 3 + 2] = g.z - anchorMpc.z;
      a.aAbsMag[q] = g.absMag;
      a.aRadius[q] = g.radiusMpc;
      a.aColor[q * 3] = g.colour[0];
      a.aColor[q * 3 + 1] = g.colour[1];
      a.aColor[q * 3 + 2] = g.colour[2];
    }
    layer.commit(n);
  }

  _generateCell(level, i, j, k) {
    const s = level.S;
    const x0 = i * s;
    const y0 = j * s;
    const z0 = k * s;
    const random = mulberry(hashCell(0x9a1f, 40 + level.index, i, j, k));
    // The web is drawn at its own scale whatever the cell size, so a level
    // much larger than a filament samples it rather than averaging it away.
    let web = 0;
    for (let q = 0; q < 6; q++) web += cosmicWeb(x0 + random() * s, y0 + random() * s, z0 + random() * s);
    web /= 6;
    const count = Math.min(poisson(random, level.perCell * Math.min(web, 3)), level.cap);
    const out = [];
    const clumps = level.index === 0 ? 0 : 3;
    const centres = [];
    for (let c = 0; c < clumps; c++) centres.push([x0 + random() * s, y0 + random() * s, z0 + random() * s]);
    for (let q = 0; q < count; q++) {
      let x;
      let y;
      let z;
      let accepted = false;
      for (let tries = 0; tries < 10; tries++) {
        if (clumps && random() < 0.35) {
          const c = centres[(random() * clumps) | 0];
          const spread = s * 0.08;
          x = c[0] + gaussian(random) * spread;
          y = c[1] + gaussian(random) * spread;
          z = c[2] + gaussian(random) * spread;
        } else {
          x = x0 + random() * s;
          y = y0 + random() * s;
          z = z0 + random() * s;
        }
        if (random() * 4.5 < cosmicWeb(x, y, z)) {
          accepted = true;
          break;
        }
      }
      if (!accepted) continue;
      const lum = powerLaw(random, level.lMin, level.lMax);
      const kind = random();
      const colour = level.index === 0
        ? (kind < 0.25 ? OLD : kind < 0.75 ? MIXED : YOUNG)
        : (kind < 0.6 ? OLD : MIXED);
      const jitter = 0.85 + random() * 0.3;
      out.push(
        x, y, z,
        absMagOf(lum),
        level.radiusMpc * (lum / level.lMin) ** 0.33 * jitter,
        colour[0], colour[1], colour[2],
      );
    }
    return new Float64Array(out);
  }

  _repack(level) {
    const layer = level.layer;
    const a = layer.arrays;
    const anchor = layer.anchor;
    let n = 0;
    for (const cell of level.cells.values()) {
      for (let p = 0; p < cell.length && n < layer.capacity; p += 8, n++) {
        a.position[n * 3] = cell[p] - anchor.x;
        a.position[n * 3 + 1] = cell[p + 1] - anchor.y;
        a.position[n * 3 + 2] = cell[p + 2] - anchor.z;
        a.aAbsMag[n] = cell[p + 3];
        a.aRadius[n] = cell[p + 4];
        a.aColor[n * 3] = cell[p + 5];
        a.aColor[n * 3 + 1] = cell[p + 6];
        a.aColor[n * 3 + 2] = cell[p + 7];
      }
    }
    layer.commit(n);
  }

  /**
   * @param {object} o
   * @param {Vector3} o.cameraWorld km
   * @param {number} o.cssPerRad CSS pixels per radian
   * @param {number} o.pixelRatio
   * @param {number} o.farKm the camera's far plane
   * @param {number} [o.budgetMs]
   */
  update({ cameraWorld, cssPerRad, pixelRatio, farKm, budgetMs = 3 }) {
    const t0 = performance.now();
    const cam = this._cam.copy(cameraWorld).multiplyScalar(1 / MPC_KM);
    for (const level of this.levels) {
      const s = level.S;
      const ci = Math.floor(cam.x / s);
      const cj = Math.floor(cam.y / s);
      const ck = Math.floor(cam.z / s);
      const plan = `${ci}|${cj}|${ck}`;
      if (plan !== level.plan) {
        level.plan = plan;
        level.wanted = [];
        const R = level.R;
        for (let i = ci - R; i <= ci + R; i++) {
          for (let j = cj - R; j <= cj + R; j++) {
            for (let k = ck - R; k <= ck + R; k++) level.wanted.push([i, j, k]);
          }
        }
        // Nearest first, so what fills in last is the faint edge.
        level.wanted.sort((p, q) => (Math.abs(p[0] - ci) + Math.abs(p[1] - cj) + Math.abs(p[2] - ck))
          - (Math.abs(q[0] - ci) + Math.abs(q[1] - cj) + Math.abs(q[2] - ck)));
        const keep = new Set(level.wanted.map((c) => c.join('|')));
        for (const key of level.cells.keys()) if (!keep.has(key)) level.cells.delete(key);
        level.layer.anchor.set((ci + 0.5) * s, (cj + 0.5) * s, (ck + 0.5) * s);
        level.dirty = true;
      }
      for (const [i, j, k] of level.wanted) {
        const key = `${i}|${j}|${k}`;
        if (level.cells.has(key)) continue;
        if (performance.now() - t0 > budgetMs) break;
        level.cells.set(key, this._generateCell(level, i, j, k));
        level.dirty = true;
      }
      if (level.dirty) {
        level.dirty = false;
        this._repack(level);
      }
    }

    for (const layer of [this.near, ...this.levels.map((l) => l.layer)]) {
      const u = layer.points.material.uniforms;
      u.uAnchor.value.copy(layer.anchor).sub(cam);
      u.uAnchorWorld.value.copy(layer.anchor);
      u.uCssPerRad.value = cssPerRad;
      u.uPixelRatio.value = pixelRatio;
      u.uFarKm.value = farKm * 0.3;
      layer.points.visible = this.visible && layer.count > 0;
    }
  }

  get stats() {
    return {
      near: this.near.count,
      ...Object.fromEntries(this.levels.map((l) => [l.name, l.layer.count])),
    };
  }
}
