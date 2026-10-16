import {
  AddEquation,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  Points,
  ShaderMaterial,
  SrcColorFactor,
  Vector3,
  ZeroFactor,
} from 'three';
import { armPhase, densityAt, discSurface, gaussian, makeModel, mulberry, spheroid } from './galaxy-model.js';
import { platform } from './platform.js';
import { PC_KM } from './units.js';

/**
 * Galaxies as clouds of light and dust, the way SpaceEngine draws them.
 *
 * A billboard is a picture of a galaxy, and close up it reads as one: flat, the
 * same from every side, and grainy where it was painted with dots. What a
 * galaxy actually is, at any distance where you can see its shape, is the
 * summed light of stars too many and too faint to make out, with dust in
 * front of some of it. So each galaxy near enough to fill part of the screen
 * becomes three layers in its own three-dimensional frame:
 *
 * - glow: soft sprites placed by the galaxy's density model, each standing for
 *   a region of unresolved stars, sized to the spacing between them so they
 *   overlap into continuous light. Old and yellow in the bulge, young and blue
 *   on the arms, with pink star-forming knots along them.
 * - dust: absorbing sprites in the midplane along the inner edge of each arm,
 *   which is where shocked gas piles up. They multiply what is behind them, a
 *   little more in blue than in red, so the lanes redden as well as darken,
 *   and seen edge-on they make the dark band through the middle.
 * - stars: the brightest individual stars, whose light falls off with the
 *   square of distance like any star, so they come out of the glow as you
 *   approach rather than being painted on at every distance.
 *
 * Only a few galaxies at a time are built, the ones largest on screen; the
 * rest stay billboards, which is all a galaxy a few dozen pixels across needs.
 * Building is spread over frames under a time budget.
 */

const COUNTS = {
  phone: { slots: 2, glow: 3200, dust: 1400, stars: 2500 },
  tablet: { slots: 3, glow: 6000, dust: 2600, stars: 5000 },
  desktop: { slots: 5, glow: 9000, dust: 4000, stars: 9000 },
};

/** Apparent radius, in CSS pixels, over which a galaxy hands over from its billboard. */
export const HANDOVER_PX = [36, 90];
/** Summed glow, per square parsec of a galaxy's radius, that matches the billboard. */
const GLOW_FLUX = 0.12;
const MAX_POINT_PX = 240;

const GLOW_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  attribute vec3 aColor;
  uniform vec3 uCenter;
  uniform vec3 uU;
  uniform vec3 uW;
  uniform vec3 uN;
  uniform float uPxPerRad;
  uniform float uOpacity;
  uniform float uMaxPx;
  varying vec3 vColor;
  void main() {
    vec3 pos = uCenter + uU * position.x + uW * position.y + uN * position.z;
    float dist = max(length(pos), 1.0);
    float sizeKm = aSize * ${PC_KM.toExponential(6)};
    float px = 2.0 * sizeKm / dist * uPxPerRad;
    // A sprite smaller than a couple of pixels keeps its light and loses its size.
    float gain = px < 2.0 ? px * px * 0.25 : 1.0;
    // From inside one, a sprite would be a wall of light; the star cells are
    // drawing those stars by then. Nor can a point outgrow what the GPU allows.
    float near = smoothstep(sizeKm * 1.5, sizeKm * 5.0, dist);
    float big = 1.0 - smoothstep(uMaxPx * 0.55, uMaxPx, px);
    vColor = aColor * uOpacity * gain * near * big;
    gl_PointSize = clamp(px, 2.0, uMaxPx);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    if (dot(vColor, vec3(1.0)) < 1e-6) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    vec2 pc = (gl_PointCoord - 0.5) * 2.0;
    float d2 = dot(pc, pc);
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(vColor * (exp(-d2 * 3.2) - 0.04), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

const DUST_VERTEX = GLOW_VERTEX
  .replace('attribute vec3 aColor;', 'attribute float aTau;')
  .replace('varying vec3 vColor;', 'varying float vTau;')
  .replace('vColor = aColor * uOpacity * gain * near * big;', 'vTau = aTau * uOpacity * gain * near * big;')
  .replace('if (dot(vColor, vec3(1.0)) < 1e-6)', 'if (vTau < 1e-4)');

const DUST_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying float vTau;
  void main() {
    vec2 pc = (gl_PointCoord - 0.5) * 2.0;
    float d2 = dot(pc, pc);
    if (d2 > 1.0) discard;
    float tau = vTau * (exp(-d2 * 2.6) - 0.07);
    // Transmission, multiplied into whatever is already drawn behind.
    gl_FragColor = vec4(exp(-max(tau, 0.0) * vec3(0.62, 0.82, 1.0)), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

const STAR_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aColor;
  uniform vec3 uCenter;
  uniform vec3 uU;
  uniform vec3 uW;
  uniform vec3 uN;
  uniform float uOpacity;
  uniform float uPixelRatio;
  uniform float uNearKm;
  uniform float uGain;
  varying vec3 vColor;
  void main() {
    vec3 pos = uCenter + uU * position.x + uW * position.y + uN * position.z;
    float dist = max(length(pos), 1.0);
    float pc = dist / ${PC_KM.toExponential(6)};
    vec3 flux = aColor * uGain / (pc * pc);
    float peak = max(flux.r, max(flux.g, flux.b));
    // The star cells take over inside the galaxy you are in.
    float near = smoothstep(uNearKm, uNearKm * 3.0, dist);
    float shown = smoothstep(0.006, 0.03, peak) * near * uOpacity;
    vColor = flux / max(peak, 1.0) * shown;
    gl_PointSize = clamp(1.3 + 1.6 * log2(1.0 + peak), 1.3, 4.5) * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    if (shown < 1e-3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    vec2 pc = (gl_PointCoord - 0.5) * 2.0;
    float d2 = dot(pc, pc);
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-d2 * 4.5), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

function frameUniforms() {
  return {
    uCenter: { value: new Vector3() },
    uU: { value: new Vector3() },
    uW: { value: new Vector3() },
    uN: { value: new Vector3() },
    uPxPerRad: { value: 1000 },
    uOpacity: { value: 0 },
    uMaxPx: { value: MAX_POINT_PX },
  };
}

function layer(count, attrs, material) {
  const geometry = new BufferGeometry();
  const arrays = {};
  for (const [name, size] of Object.entries(attrs)) {
    arrays[name] = new Float32Array(count * size);
    geometry.setAttribute(name, new BufferAttribute(arrays[name], size));
  }
  geometry.setDrawRange(0, 0);
  geometry.computeBoundingSphere = () => {};
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return { points, arrays, count };
}

const OLD = [1.0, 0.8, 0.58];
const DISC = [0.94, 0.88, 0.8];
const YOUNG = [0.6, 0.74, 1.0];
const HII = [1.0, 0.42, 0.58];

function mixColour(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** How strongly a disc point is on the dust lane trailing each arm's inner edge. */
function dustLane(m, x, y) {
  if (!m.armContrast) return 0;
  return Math.exp(-(1 - Math.cos(armPhase(m, x, y) - 0.5)) * 7);
}

/** On an arm ridge, 0-1. */
function armRidge(m, x, y) {
  if (!m.armContrast) return 0;
  return Math.exp(-(1 - Math.cos(armPhase(m, x, y))) * 2.6);
}

/**
 * Fills one slot's three layers from a galaxy's model. A generator, so the
 * caller can stop it whenever its frame budget is spent and carry on next frame.
 */
function* build(slot, frame) {
  const m = frame.model ?? (frame.model = makeModel(frame));
  const random = mulberry((frame.seed ^ 0x5b17e) >>> 0);
  const R = m.radiusPc;
  const bound = m.boundPc;
  const elliptical = m.family === 'elliptical';
  const zBound = elliptical ? bound * m.flattening : Math.max(m.discHeight * 5, m.bulgeScale * 2.5);
  let peak = 0;
  for (let a = -10; a <= 10; a++) {
    for (let b = -10; b <= 10; b++) peak = Math.max(peak, densityAt(m, (a / 10) * bound * 0.6, (b / 10) * bound * 0.6, 0));
  }
  peak = Math.max(peak, densityAt(m, 0, 0, 0)) * 1.15;
  // Sampling against the bulge's peak would throw away nearly every disc
  // point, so the acceptance saturates at a disc-like density instead, and
  // each sprite's size and weight are worked out from the chance it had.
  const cap = elliptical ? peak * 0.08 : Math.min(peak, Math.max(densityAt(m, R * 0.25, 0, 0), peak * 0.01));

  // Glow. Sprites are spaced as the cube root of their acceptance, and
  // weighted so the summed light follows the density itself.
  const glow = slot.glow;
  const gp = glow.arrays.position;
  const gs = glow.arrays.aSize;
  const gc = glow.arrays.aColor;
  let placed = 0;
  let flux = 0;
  for (let tries = 0; placed < glow.count && tries < glow.count * 300; tries++) {
    if ((tries & 1023) === 0) yield;
    const x = (random() * 2 - 1) * bound;
    const y = (random() * 2 - 1) * bound;
    const z = (random() * 2 - 1) * zBound;
    const rho = densityAt(m, x, y, z);
    const chance = Math.min(1, rho / cap) ** 0.6;
    if (random() > chance) continue;
    const sph = spheroid(m, x, y, z);
    const disc = Math.max(rho - sph, 0);
    const discShare = disc / Math.max(rho, 1e-30);
    const ridge = armRidge(m, x, y);
    let young = m.family === 'irregular' ? 0.75 : discShare * (0.2 + ridge * 0.8);
    if (elliptical) young = 0;
    const knot = young > 0.55 && random() < 0.05;
    let colour = mixColour(mixColour(OLD, DISC, discShare), YOUNG, Math.min(young * 1.2, 1));
    // Two scales: wide sprites that overlap into smooth light and carry most
    // of it, and smaller ones that keep the arms and knots sharp.
    const smooth = placed % 3 === 0;
    const base = smooth ? R * 0.075 : R * 0.03;
    let size = base * chance ** (-1 / 3);
    size = Math.min(Math.max(size, R * 0.008), R * 0.22);
    let weight = ((rho / cap) / (chance * (size / base) ** 2)) * (smooth ? 0.3 : 0.57);
    if (knot) {
      colour = random() < 0.6 ? HII : YOUNG;
      weight *= (size / (R * 0.007)) ** 2 * 0.25;
      size = R * (0.004 + random() * 0.006);
    }
    const jitter = 0.85 + random() * 0.3;
    gp[placed * 3] = x;
    gp[placed * 3 + 1] = y;
    gp[placed * 3 + 2] = z;
    gs[placed] = size;
    gc[placed * 3] = colour[0] * weight * jitter;
    gc[placed * 3 + 1] = colour[1] * weight * jitter;
    gc[placed * 3 + 2] = colour[2] * weight * jitter;
    flux += weight * size * size;
    placed++;
  }
  // The same summed light for every galaxy of a given size, however many
  // sprites a device could afford to spend on it.
  const scale = (GLOW_FLUX * R * R) / Math.max(flux, 1e-9);
  for (let i = 0; i < placed * 3; i++) gc[i] *= scale;
  glow.points.geometry.setDrawRange(0, placed);
  for (const attr of Object.values(glow.points.geometry.attributes)) attr.needsUpdate = true;

  // Dust: in the midplane, along the inner edges of the arms, thinning out
  // past the optical disc. Lenticulars get a ring; ellipticals almost none.
  const dust = slot.dust;
  const dp = dust.arrays.position;
  const ds = dust.arrays.aSize;
  const dt = dust.arrays.aTau;
  let dusty = 0;
  const wantDust = elliptical ? 0 : m.family === 'irregular' ? Math.floor(dust.count * 0.35) : dust.count;
  for (let tries = 0; dusty < wantDust && tries < dust.count * 400; tries++) {
    if ((tries & 1023) === 0) yield;
    const r = R * Math.sqrt(random()) * 1.05;
    const th = random() * Math.PI * 2;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th);
    // A third of it a smooth thin disc, which is what makes the dark band
    // through an edge-on spiral; the rest in the lanes.
    const diffuse = dusty % 3 === 0;
    let p;
    if (diffuse) p = Math.exp(-r / (R * 0.38)) * (1 - Math.exp(-r / (m.bulgeScale * 2)));
    else if (m.family === 'lenticular') p = Math.exp(-((((r / R) - 0.5) / 0.09) ** 2));
    else if (m.family === 'irregular') p = 0.3 * discSurface(m, x, y) / Math.max(discSurface(m, 0, 0), 1e-12);
    else p = dustLane(m, x, y) * (1 - Math.exp(-r / (m.bulgeScale * 1.4)));
    p *= 1 / (1 + Math.exp((r - R * 0.92) / (R * 0.05)));
    if (random() > p) continue;
    dp[dusty * 3] = x;
    dp[dusty * 3 + 1] = y;
    dp[dusty * 3 + 2] = gaussian(random) * m.discHeight * (diffuse ? 0.25 : 0.35);
    ds[dusty] = diffuse ? R * (0.04 + random() * 0.04) : R * (0.018 + random() * 0.03);
    dt[dusty] = diffuse ? 0.025 + random() * 0.04 : 0.07 + random() * 0.14;
    dusty++;
  }
  dust.points.geometry.setDrawRange(0, dusty);
  for (const attr of Object.values(dust.points.geometry.attributes)) attr.needsUpdate = true;

  // The brightest stars, placed by density itself: supergiants and the like,
  // luminosity from a steep power law so a few dominate.
  const stars = slot.stars;
  const sp = stars.arrays.position;
  const sc = stars.arrays.aColor;
  let shone = 0;
  for (let tries = 0; shone < stars.count && tries < stars.count * 300; tries++) {
    if ((tries & 1023) === 0) yield;
    const x = (random() * 2 - 1) * bound;
    const y = (random() * 2 - 1) * bound;
    const z = (random() * 2 - 1) * zBound;
    const rho = densityAt(m, x, y, z);
    if (random() > Math.min(1, rho / cap)) continue;
    const ridge = armRidge(m, x, y);
    const disc = Math.max(rho - spheroid(m, x, y, z), 0) / Math.max(rho, 1e-30);
    const blue = !elliptical && random() < disc * (0.35 + ridge * 0.6);
    const tint = blue ? [0.62, 0.74, 1.0] : random() < 0.3 ? [1.0, 0.62, 0.4] : [1.0, 0.86, 0.68];
    const lum = 0.08 * random() ** -1.6;
    sp[shone * 3] = x;
    sp[shone * 3 + 1] = y;
    sp[shone * 3 + 2] = z;
    sc[shone * 3] = tint[0] * lum;
    sc[shone * 3 + 1] = tint[1] * lum;
    sc[shone * 3 + 2] = tint[2] * lum;
    shone++;
  }
  stars.points.geometry.setDrawRange(0, shone);
  for (const attr of Object.values(stars.points.geometry.attributes)) attr.needsUpdate = true;
}

export class GalaxySprites {
  constructor() {
    const counts = COUNTS[platform.deviceClass] ?? COUNTS.desktop;
    this.slots = [];
    this.glowObjects = [];
    this.dustObjects = [];
    this.starObjects = [];
    for (let i = 0; i < counts.slots; i++) {
      const glowMaterial = new ShaderMaterial({
        uniforms: frameUniforms(),
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        blending: AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
      const dustMaterial = new ShaderMaterial({
        uniforms: frameUniforms(),
        vertexShader: DUST_VERTEX,
        fragmentShader: DUST_FRAGMENT,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: ZeroFactor,
        blendDst: SrcColorFactor,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
      const starMaterial = new ShaderMaterial({
        uniforms: {
          ...frameUniforms(),
          uPixelRatio: { value: 1 },
          uNearKm: { value: 1 },
          uGain: { value: 1.5e5 },
        },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        blending: AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
      const slot = {
        frame: null,
        gen: null,
        ready: false,
        fade: 0,
        glow: layer(counts.glow, { position: 3, aSize: 1, aColor: 3 }, glowMaterial),
        dust: layer(counts.dust, { position: 3, aSize: 1, aTau: 1 }, dustMaterial),
        stars: layer(counts.stars, { position: 3, aColor: 3 }, starMaterial),
      };
      this.slots.push(slot);
      this.glowObjects.push(slot.glow.points);
      this.dustObjects.push(slot.dust.points);
      this.starObjects.push(slot.stars.points);
    }
    /** All glow first, then all dust, so dust darkens every galaxy's light behind it. */
    this.objects = [...this.glowObjects, ...this.dustObjects, ...this.starObjects];
    this.visible = true;
  }

  /** Billboard brightness for a galaxy: 1 when no slot draws it, less while one does. */
  dimFor(key) {
    for (const slot of this.slots) if (slot.frame?.key === key) return 1 - slot.fade;
    return 1;
  }

  /** Fade of the slot drawing this galaxy, 0 when none is. */
  fadeFor(key) {
    for (const slot of this.slots) if (slot.frame?.key === key) return slot.fade;
    return 0;
  }

  /**
   * @param {object} o
   * @param {Vector3} o.cameraWorld
   * @param {{frame: object, px: number}[]} o.wanted galaxies by apparent radius, largest first
   * @param {number} o.pxPerRad device pixels per radian
   * @param {number} o.pixelRatio
   * @param {number} o.dt seconds
   * @param {number} o.budgetMs
   */
  update({ cameraWorld, wanted, pxPerRad, pixelRatio, dt, budgetMs = 3 }) {
    const keep = new Set(wanted.slice(0, this.slots.length).map((w) => w.frame.key));
    // Free the slots whose galaxy is no longer among the largest, once faded.
    for (const slot of this.slots) {
      if (slot.frame && !keep.has(slot.frame.key) && slot.fade < 0.01) {
        slot.frame = null;
        slot.gen = null;
        slot.ready = false;
      }
    }
    for (const w of wanted.slice(0, this.slots.length)) {
      if (this.slots.some((s) => s.frame?.key === w.frame.key)) continue;
      const free = this.slots.find((s) => !s.frame);
      if (!free) break;
      free.frame = w.frame;
      free.ready = false;
      free.gen = build(free, w.frame);
    }

    const t0 = performance.now();
    for (const slot of this.slots) {
      if (!slot.gen) continue;
      while (performance.now() - t0 < budgetMs) {
        if (slot.gen.next().done) {
          slot.gen = null;
          slot.ready = true;
          break;
        }
      }
    }

    const pxOf = new Map(wanted.map((w) => [w.frame.key, w.px]));
    const step = 1 - Math.exp(-dt * 3);
    for (const slot of this.slots) {
      const f = slot.frame;
      const px = f ? pxOf.get(f.key) ?? 0 : 0;
      const target = f && slot.ready && this.visible
        ? Math.min(1, Math.max(0, (px - HANDOVER_PX[0]) / (HANDOVER_PX[1] - HANDOVER_PX[0])))
        : 0;
      slot.fade += (target - slot.fade) * step;
      if (Math.abs(target - slot.fade) < 0.002) slot.fade = target;
      const on = Boolean(f) && slot.ready && slot.fade > 0.003;
      slot.glow.points.visible = on;
      slot.dust.points.visible = on;
      slot.stars.points.visible = on;
      if (!on) continue;
      for (const layerObject of [slot.glow, slot.dust, slot.stars]) {
        const u = layerObject.points.material.uniforms;
        u.uCenter.value.subVectors(f.center, cameraWorld);
        u.uU.value.copy(f.u).multiplyScalar(PC_KM);
        u.uW.value.copy(f.w).multiplyScalar(PC_KM);
        u.uN.value.copy(f.n).multiplyScalar(PC_KM);
        u.uPxPerRad.value = pxPerRad;
        u.uOpacity.value = slot.fade;
        if (u.uPixelRatio) u.uPixelRatio.value = pixelRatio;
        if (u.uNearKm) u.uNearKm.value = f.radiusKm * 0.04;
      }
    }
  }
}
