import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CustomBlending,
  CylinderGeometry,
  Data3DTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { equatorialToVector } from '../astro.js';
import { colorIndexToLinearRgb } from '../color.js';
import { equatorialToEcliptic, PC_KM } from './units.js';

/**
 * Nebulae, star clusters and neutron stars: the deep-sky objects you can fly
 * to, at their measured positions and sizes.
 *
 * Positions are J2000 right ascension and declination in degrees and distances
 * in parsecs; radii are physical, in parsecs, roughly half the extent the
 * object is usually quoted at. The look of each is procedural, set by its type
 * and a few colours, so these are recognisable kinds rather than portraits.
 */

const HA = [1.0, 0.16, 0.24];
const OIII = [0.12, 0.85, 0.78];
const SII = [1.0, 0.42, 0.18];
const BLUE = [0.35, 0.55, 1.0];

export const NEBULAE = [
  { key: 'm42', name: 'Orion Nebula', type: 'emission', ra: 83.822, dec: -5.391, distPc: 412, radiusPc: 4, colours: [HA, OIII, BLUE], cavity: 0.6 },
  { key: 'm16', name: 'Eagle Nebula', type: 'emission', ra: 274.7, dec: -13.807, distPc: 1740, radiusPc: 9, colours: [HA, [0.95, 0.75, 0.35], SII], cavity: 0.4 },
  { key: 'm8', name: 'Lagoon Nebula', type: 'emission', ra: 270.904, dec: -24.387, distPc: 1250, radiusPc: 12, colours: [HA, [1.0, 0.45, 0.6], OIII], cavity: 0.3 },
  { key: 'm20', name: 'Trifid Nebula', type: 'emission', ra: 270.6, dec: -23.03, distPc: 1560, radiusPc: 6, colours: [HA, BLUE, OIII], cavity: 0.5 },
  { key: 'ngc3372', name: 'Carina Nebula', type: 'emission', ra: 161.265, dec: -59.867, distPc: 2300, radiusPc: 40, colours: [HA, OIII, SII], cavity: 0.3 },
  { key: 'ngc2237', name: 'Rosette Nebula', type: 'emission', ra: 97.98, dec: 4.95, distPc: 1600, radiusPc: 20, colours: [HA, [1.0, 0.5, 0.4], OIII], cavity: 1 },
  { key: 'ngc7000', name: 'North America Nebula', type: 'emission', ra: 314.7, dec: 44.3, distPc: 590, radiusPc: 15, colours: [HA, SII, OIII], cavity: 0.1 },
  { key: '30dor', name: 'Tarantula Nebula', type: 'emission', ra: 84.676, dec: -69.101, distPc: 49970, radiusPc: 100, colours: [HA, OIII, [0.9, 0.5, 1.0]], cavity: 0.7 },
  { key: 'm57', name: 'Ring Nebula', type: 'planetary', ra: 283.396, dec: 33.029, distPc: 790, radiusPc: 0.25, colours: [HA, OIII, [0.95, 0.85, 0.3]] },
  { key: 'ngc7293', name: 'Helix Nebula', type: 'planetary', ra: 337.411, dec: -20.837, distPc: 200, radiusPc: 0.45, colours: [HA, OIII, [1.0, 0.6, 0.3]] },
  { key: 'm27', name: 'Dumbbell Nebula', type: 'planetary', ra: 299.902, dec: 22.721, distPc: 417, radiusPc: 0.7, colours: [HA, OIII, [0.6, 1.0, 0.5]], bipolar: 1 },
  { key: 'ngc6543', name: "Cat's Eye Nebula", type: 'planetary', ra: 269.639, dec: 66.633, distPc: 1000, radiusPc: 0.12, colours: [HA, OIII, BLUE], bipolar: 0.6 },
  { key: 'm1', name: 'Crab Nebula', type: 'plerion', ra: 83.633, dec: 22.0145, distPc: 2000, radiusPc: 1.7, colours: [SII, [0.45, 0.6, 1.0], HA] },
  { key: 'veil', name: 'Veil Nebula', type: 'remnant', ra: 312.75, dec: 30.7, distPc: 735, radiusPc: 18, colours: [HA, OIII, BLUE] },
  { key: 'cas-a', name: 'Cassiopeia A', type: 'remnant', ra: 350.85, dec: 58.815, distPc: 3400, radiusPc: 1.6, colours: [[0.4, 1.0, 0.5], HA, BLUE] },
  { key: 'vela-snr', name: 'Vela Supernova Remnant', type: 'remnant', ra: 128.5, dec: -45.5, distPc: 287, radiusPc: 18, colours: [HA, OIII, BLUE] },
  { key: 'ic2118', name: 'Witch Head Nebula', type: 'reflection', ra: 76.5, dec: -7.2, distPc: 270, radiusPc: 7, colours: [BLUE, [0.6, 0.75, 1.0], BLUE] },
  { key: 'm45-neb', name: 'Pleiades Nebulosity', type: 'reflection', ra: 56.75, dec: 24.1167, distPc: 136, radiusPc: 2.5, colours: [BLUE, [0.7, 0.8, 1.0], BLUE] },
  { key: 'b33', name: 'Horsehead Nebula', type: 'dark', ra: 85.24, dec: -2.46, distPc: 422, radiusPc: 1.2, colours: [[0.5, 0.25, 0.2], HA, HA] },
  { key: 'coalsack', name: 'Coalsack Nebula', type: 'dark', ra: 191.0, dec: -62.9, distPc: 180, radiusPc: 6, colours: [[0.3, 0.22, 0.2], HA, HA] },
];

export const CLUSTERS = [
  { key: 'm45', name: 'Pleiades', type: 'open', ra: 56.75, dec: 24.1167, distPc: 136, radiusPc: 4, stars: 1000, ageMyr: 110 },
  { key: 'hyades', name: 'Hyades', type: 'open', ra: 66.75, dec: 15.87, distPc: 47, radiusPc: 5, stars: 450, ageMyr: 625 },
  { key: 'm44', name: 'Beehive Cluster', type: 'open', ra: 130.1, dec: 19.67, distPc: 187, radiusPc: 3.5, stars: 1000, ageMyr: 600 },
  { key: 'ngc869', name: 'Double Cluster (h Persei)', type: 'open', ra: 34.75, dec: 57.13, distPc: 2300, radiusPc: 10, stars: 2500, ageMyr: 13 },
  { key: 'ngc884', name: 'Double Cluster (\u03c7 Persei)', type: 'open', ra: 35.6, dec: 57.15, distPc: 2300, radiusPc: 10, stars: 2500, ageMyr: 13 },
  { key: 'ngc4755', name: 'Jewel Box', type: 'open', ra: 193.4, dec: -60.33, distPc: 1976, radiusPc: 3, stars: 900, ageMyr: 14 },
  { key: 'm11', name: 'Wild Duck Cluster', type: 'open', ra: 282.77, dec: -6.27, distPc: 1900, radiusPc: 3, stars: 2900, ageMyr: 250 },
  { key: 'wd1', name: 'Westerlund 1', type: 'open', ra: 251.77, dec: -45.85, distPc: 3900, radiusPc: 1.5, stars: 4000, ageMyr: 4 },
  { key: 'r136', name: 'R136', type: 'open', ra: 84.676, dec: -69.101, distPc: 49970, radiusPc: 2.5, stars: 5000, ageMyr: 1.5 },
  { key: 'ngc5139', name: 'Omega Centauri', type: 'globular', ra: 201.697, dec: -47.479, distPc: 5430, radiusPc: 25, stars: 90000, core: 0.24 },
  { key: 'ngc104', name: '47 Tucanae', type: 'globular', ra: 6.024, dec: -72.081, distPc: 4450, radiusPc: 20, stars: 70000, core: 0.15 },
  { key: 'm13', name: 'Hercules Cluster (M13)', type: 'globular', ra: 250.42, dec: 36.46, distPc: 6800, radiusPc: 20, stars: 60000, core: 0.12 },
  { key: 'm15', name: 'M15', type: 'globular', ra: 322.493, dec: 12.167, distPc: 10400, radiusPc: 18, stars: 50000, core: 0.09 },
  { key: 'm3', name: 'M3', type: 'globular', ra: 205.548, dec: 28.377, distPc: 10200, radiusPc: 27, stars: 50000, core: 0.1 },
  { key: 'm4', name: 'M4', type: 'globular', ra: 245.897, dec: -26.526, distPc: 2200, radiusPc: 11, stars: 30000, core: 0.22 },
  { key: 'm22', name: 'M22', type: 'globular', ra: 279.1, dec: -23.9, distPc: 3200, radiusPc: 15, stars: 45000, core: 0.18 },
];

export const NEUTRON_STARS = [
  { key: 'crab-pulsar', name: 'Crab Pulsar', type: 'pulsar', ra: 83.633, dec: 22.0145, distPc: 2000, periodS: 0.0337 },
  { key: 'vela-pulsar', name: 'Vela Pulsar', type: 'pulsar', ra: 128.836, dec: -45.176, distPc: 287, periodS: 0.0893 },
  { key: 'geminga', name: 'Geminga', type: 'pulsar', ra: 98.476, dec: 17.77, distPc: 250, periodS: 0.237 },
  { key: 'psr-b1919', name: 'PSR B1919+21', type: 'pulsar', ra: 290.4375, dec: 21.8836, distPc: 300, periodS: 1.337 },
  { key: 'psr-b1913', name: 'Hulse\u2013Taylor Pulsar', type: 'pulsar', ra: 288.867, dec: 16.107, distPc: 6400, periodS: 0.059 },
  { key: 'psr-j0437', name: 'PSR J0437\u22124715', type: 'millisecond', ra: 69.316, dec: -47.252, distPc: 156.3, periodS: 0.005757 },
  { key: 'psr-j1748', name: 'PSR J1748\u22122446ad', type: 'millisecond', ra: 267.02, dec: -24.78, distPc: 5900, periodS: 0.001396 },
  { key: 'rxj1856', name: 'RX J1856.5\u22123754', type: 'isolated', ra: 284.15, dec: -37.91, distPc: 123, periodS: 7.06 },
  { key: 'sgr1806', name: 'SGR 1806\u221220', type: 'magnetar', ra: 272.164, dec: -20.411, distPc: 8700, periodS: 7.6 },
  { key: 'sgr1900', name: 'SGR 1900+14', type: 'magnetar', ra: 286.81, dec: 9.32, distPc: 12500, periodS: 5.2 },
  { key: 'xte1810', name: 'XTE J1810\u2212197', type: 'magnetar', ra: 272.46, dec: -19.73, distPc: 3500, periodS: 5.54 },
];

export const NEUTRON_STAR_RADIUS_KM = 12;

export const NEBULA_LABELS = {
  emission: 'Emission nebula',
  planetary: 'Planetary nebula',
  remnant: 'Supernova remnant',
  plerion: 'Pulsar wind nebula',
  reflection: 'Reflection nebula',
  dark: 'Dark nebula',
};
export const CLUSTER_LABELS = { open: 'Open cluster', globular: 'Globular cluster' };
export const NEUTRON_LABELS = {
  pulsar: 'Pulsar',
  millisecond: 'Millisecond pulsar',
  magnetar: 'Magnetar',
  isolated: 'Isolated neutron star',
};

export function deepObjectWorld(spec, out = new Vector3()) {
  equatorialToVector(spec.ra, spec.dec, out);
  equatorialToEcliptic(out);
  return out.multiplyScalar(spec.distPc * PC_KM);
}

function hashKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random orientation, fixed per object. */
function orientation(rnd) {
  const u1 = rnd(), u2 = rnd(), u3 = rnd();
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return new Quaternion(a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3));
}

// ------------------------------------------------------------------ nebulae

/**
 * Tileable value noise, four independent channels, 64³. Sampled in hardware a
 * whole octave costs one fetch, which is what makes ray-marching a cloud at
 * full resolution affordable.
 */
function noiseTexture(size = 64, cells = 8) {
  const rnd = random(1234567);
  const lattice = new Float32Array(cells * cells * cells * 4);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const data = new Uint8Array(size * size * size * 4);
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const at = (x, y, z, c) => lattice[(((z % cells) * cells + (y % cells)) * cells + (x % cells)) * 4 + c];
  let o = 0;
  for (let z = 0; z < size; z++) {
    const fz = (z / size) * cells, iz = Math.floor(fz), tz = smooth(fz - iz);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, iy = Math.floor(fy), ty = smooth(fy - iy);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, ix = Math.floor(fx), tx = smooth(fx - ix);
        for (let c = 0; c < 4; c++) {
          const a = at(ix, iy, iz, c) + (at(ix + 1, iy, iz, c) - at(ix, iy, iz, c)) * tx;
          const b = at(ix, iy + 1, iz, c) + (at(ix + 1, iy + 1, iz, c) - at(ix, iy + 1, iz, c)) * tx;
          const d = at(ix, iy, iz + 1, c) + (at(ix + 1, iy, iz + 1, c) - at(ix, iy, iz + 1, c)) * tx;
          const e = at(ix, iy + 1, iz + 1, c) + (at(ix + 1, iy + 1, iz + 1, c) - at(ix, iy + 1, iz + 1, c)) * tx;
          const lower = a + (b - a) * ty;
          const upper = d + (e - d) * ty;
          data[o++] = Math.round((lower + (upper - lower) * tz) * 255);
        }
      }
    }
  }
  const texture = new Data3DTexture(data, size, size, size);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const NEBULA_TYPES = { emission: 0, planetary: 1, remnant: 2, plerion: 3, reflection: 4, dark: 5 };

const NEBULA_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const NEBULA_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler3D uNoise;
  uniform vec3 uCamera;
  uniform float uType;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform vec3 uSeed;
  uniform vec3 uAxis;
  uniform float uBright;
  uniform float uCavity;
  uniform float uBipolar;
  uniform float uSteps;
  varying vec3 vLocal;

  float fbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * texture(uNoise, p).r;
      p = p * 2.03 + 0.171;
      amp *= 0.5;
    }
    return sum / 0.97;
  }

  // Thin bright walls where a noise field crosses its midpoint: filaments.
  float ridged(vec3 p) {
    float r = 1.0 - abs(fbm(p) * 2.0 - 1.0);
    return r * r * r * r * r;
  }

  // Emission (rgb) and extinction (a) per unit length, radius units.
  vec4 sampleCloudInner(vec3 p) {
    vec3 q = p * 0.5 + uSeed;
    vec3 warp = texture(uNoise, q * 0.6).gba - 0.5;
    vec3 pw = p + warp * 0.5;
    float rw = length(pw);
    float body = smoothstep(1.0, 0.3, rw);
    float f = fbm(q + warp * 0.35);

    if (uType < 0.5) {
      // H II region: ionised gas lit from within, a hollow blown by the young
      // stars at its heart, the doubly ionised oxygen nearest them, and dark
      // lanes of dust crossing it all.
      float gas = smoothstep(0.42, 0.78, f) * body;
      gas *= mix(1.0, smoothstep(0.08, 0.42, rw), uCavity);
      float inner = smoothstep(0.75, 0.1, rw);
      vec3 colour = mix(uColA, uColB, inner * smoothstep(0.5, 0.85, f));
      colour = mix(colour, uColC, smoothstep(0.6, 0.9, texture(uNoise, q * 2.3 + 5.0).r) * 0.5);
      float dust = smoothstep(0.52, 0.8, fbm(q * 1.7 + 11.3 + warp)) * body;
      vec3 starlight = uColB * exp(-rw * rw * 40.0) * 2.5;
      return vec4(colour * gas * 2.4 + starlight, dust * 5.0 + gas * 0.4);
    }
    if (uType < 1.5) {
      // A dying star's shell: hot oxygen inside, hydrogen at the rim, drawn
      // out along an axis into lobes when the star had a companion.
      float along = dot(p, uAxis);
      vec3 across = p - uAxis * along;
      float shellR = length(vec2(length(across), along * mix(1.0, 0.55, uBipolar)));
      float waist = mix(1.0, smoothstep(0.0, 0.5, abs(along)) * 0.8 + 0.2, uBipolar);
      float shell = exp(-pow((shellR - 0.55) / 0.14, 2.0)) * waist;
      float knots = 0.5 + fbm(q * 2.0 + warp) * 0.9;
      float gas = shell * knots + exp(-shellR * shellR * 14.0) * 0.12;
      vec3 colour = mix(uColB, uColA, smoothstep(0.42, 0.72, shellR));
      colour = mix(colour, uColC, smoothstep(0.65, 0.8, shellR) * 0.5);
      vec3 dwarf = vec3(0.8, 0.9, 1.0) * exp(-dot(p, p) * 2500.0) * 25.0;
      return vec4(colour * gas * 0.9 + dwarf, gas * 0.25);
    }
    if (uType < 2.5) {
      // Supernova shell: a thin, torn front of glowing filaments.
      float shell = smoothstep(0.55, 0.86, rw) * smoothstep(1.02, 0.86, rw);
      float strands = ridged(q * 1.4 + warp * 0.8);
      strands *= strands;
      float gas = strands * shell;
      vec3 colour = mix(uColA, uColB, smoothstep(0.42, 0.58, texture(uNoise, q * 1.7 + 3.0).r));
      return vec4(colour * gas * 2.2, 0.0);
    }
    if (uType < 3.5) {
      // Pulsar wind nebula: the pulsar's blue synchrotron haze, laced through
      // with the orange filaments of the star that made it.
      float strands = ridged(q * 1.6 + warp);
      strands *= strands;
      float fill = smoothstep(1.0, 0.4, rw);
      vec3 haze = uColB * exp(-rw * rw * 2.5) * 0.45;
      return vec4(haze + uColA * strands * fill * 2.4, strands * fill * 1.2);
    }
    if (uType < 4.5) {
      // Dust lit by nearby stars: blue, soft, brightest closest to them.
      float dust = smoothstep(0.38, 0.8, f) * body;
      float lit = 1.0 / (1.0 + dot(p, p) * 5.0);
      return vec4(uColA * dust * lit * 2.2, dust * 0.6);
    }
    // Dark nebula: cold dust and nothing to light it but a faint glow at the edge.
    float dust = smoothstep(0.36, 0.62, f) * body;
    float rim = smoothstep(0.4, 0.62, f) - smoothstep(0.62, 0.8, f);
    return vec4(uColB * rim * body * 0.12, dust * 9.0);
  }

  vec4 sampleCloud(vec3 p) {
    // Nothing reaches the bounding sphere, or its outline shows.
    return sampleCloudInner(p) * smoothstep(1.0, 0.82, length(p));
  }

  void main() {
    vec3 rd = normalize(vLocal - uCamera);
    float b = dot(uCamera, rd);
    float c = dot(uCamera, uCamera) - 1.0;
    float h = b * b - c;
    if (h <= 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    if (t1 <= t0) discard;
    float dt = (t1 - t0) / uSteps;
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 colour = vec3(0.0);
    float transmit = 1.0;
    for (int i = 0; i < 72; i++) {
      if (float(i) >= uSteps) break;
      vec3 p = uCamera + rd * (t0 + (float(i) + jitter) * dt);
      vec4 s = sampleCloud(p);
      colour += transmit * s.rgb * dt * uBright;
      transmit *= exp(-s.a * dt);
      if (transmit < 0.01) break;
    }
    gl_FragColor = vec4(colour, 1.0 - transmit);
    #include <logdepthbuf_fragment>
  }
`;

class Nebula {
  constructor(spec, noise, geometry) {
    this.spec = spec;
    this.world = deepObjectWorld(spec);
    this.radiusKm = spec.radiusPc * PC_KM;
    const rnd = random(hashKey(spec.key));
    const [a, b, c] = spec.colours;
    const axis = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    this.material = new ShaderMaterial({
      vertexShader: NEBULA_VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      uniforms: {
        uNoise: { value: noise },
        uCamera: { value: new Vector3() },
        uType: { value: NEBULA_TYPES[spec.type] ?? 0 },
        uColA: { value: new Vector3(...a) },
        uColB: { value: new Vector3(...b) },
        uColC: { value: new Vector3(...c) },
        uSeed: { value: new Vector3(rnd() * 8, rnd() * 8, rnd() * 8) },
        uAxis: { value: axis },
        uBright: { value: 1 },
        uCavity: { value: spec.cavity ?? 0.4 },
        uBipolar: { value: spec.bipolar ?? 0 },
        uSteps: { value: 48 },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.group = new Group();
    this.group.add(this.mesh);
    this.group.scale.setScalar(this.radiusKm);
  }

  update(cameraLocal, distanceKm, pixelsPerRadian, steps) {
    const u = this.material.uniforms;
    u.uCamera.value.copy(cameraLocal).multiplyScalar(1 / this.radiusKm);
    // A cloud is the same surface brightness from any distance, and a real
    // one is faint: Orion from Earth is a smudge. Up close the eye adapts to
    // it, so the drawn brightness follows the apparent size, not the distance.
    const apparent = this.radiusKm / Math.max(distanceKm, this.radiusKm);
    u.uBright.value = 0.25 + 0.75 * Math.min(1, Math.max(0, (apparent - 0.004) / 0.25));
    u.uSteps.value = steps;
    // Too small to see: below a couple of pixels there is nothing to march.
    this.group.visible = apparent * pixelsPerRadian > 1.5;
  }
}

// ----------------------------------------------------------------- clusters

const bvOf = (teff) => Math.max(-0.33, Math.min(2.0, 5601 / teff - 0.47));
const COLOUR_TABLE = Array.from({ length: 96 }, (_, i) => colorIndexToLinearRgb(-0.33 + (i / 95) * 2.33, 1.5));
function colourOf(teff) {
  const i = Math.round(((bvOf(teff) + 0.33) / 2.33) * 95);
  return COLOUR_TABLE[Math.max(0, Math.min(95, i))];
}

/**
 * The stars of a cluster: where they are and what they are.
 *
 * A globular cluster is old, so its main sequence has burned down to stars
 * cooler than the Sun, and the brightest things in it are red giants and a
 * scatter of hot horizontal-branch stars. An open cluster is young: its
 * brightest members are blue, and only the older ones have any giants. The
 * age sets the main-sequence turnoff, and the turnoff sets everything else.
 */
function buildCluster(spec) {
  const rnd = random(hashKey(spec.key));
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
  const n = spec.stars;
  const positions = new Float32Array(n * 3);
  const colours = new Float32Array(n * 3);
  const lum = new Float32Array(n);
  const globular = spec.type === 'globular';
  const turnoff = globular ? 0.85 : Math.min(60, (10000 / Math.max(spec.ageMyr, 0.5)) ** (1 / 2.5));
  const lo = 0.3 ** -1.35;
  const hi = Math.min(turnoff, 60) ** -1.35;
  for (let i = 0; i < n; i++) {
    let r;
    if (globular) {
      // Plummer sphere, truncated at the tidal radius.
      const a = spec.core ?? 0.08;
      do {
        r = a / Math.sqrt(Math.max(rnd(), 1e-9) ** (-2 / 3) - 1);
      } while (r > 1);
    } else {
      r = Math.min(1, Math.abs(gauss()) * 0.42);
    }
    const z = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    positions[i * 3] = r * s * Math.cos(phi);
    positions[i * 3 + 1] = r * z;
    positions[i * 3 + 2] = r * s * Math.sin(phi);

    let teff;
    let L;
    const x = rnd();
    if (globular && x < 0.012) {
      teff = 3900 + rnd() * 900;
      L = 10 ** (1.4 + rnd() * 1.5);
    } else if (globular && x < 0.02) {
      teff = 7500 + rnd() * 4000;
      L = 40 + rnd() * 25;
    } else if (!globular && spec.ageMyr > 40 && x < 0.008) {
      teff = 4100 + rnd() * 900;
      L = 10 ** (1.7 + rnd() * 1.0);
    } else {
      const m = globular ? 0.2 + 0.65 * rnd() ** 1.8 : (lo - rnd() * (lo - hi)) ** (-1 / 1.35);
      L = m < 0.43 ? 0.23 * m ** 2.3 : m < 2 ? m ** 4 : 1.4 * m ** 3.5;
      teff = Math.min(42000, 5772 * m ** 0.58);
    }
    const [cr, cg, cb] = colourOf(teff);
    colours[i * 3] = cr;
    colours[i * 3 + 1] = cg;
    colours[i * 3 + 2] = cb;
    lum[i] = L;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setAttribute('lum', new Float32BufferAttribute(lum, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const CLUSTER_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 color;
  attribute float lum;
  uniform float uGain;
  uniform float uPixelRatio;
  varying vec3 vColour;
  varying float vEnergy;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pc = max(length(mv.xyz) / ${PC_KM.toExponential(8)}, 1e-6);
    // Flux in units of a zeroth-magnitude star.
    float flux = min(lum / (pc * pc) * uGain, 3000.0);
    float size = clamp(2.0 + 2.4 * log2(1.0 + flux), 2.0, 30.0);
    // The same light spread over the sprite: a faint star is a dim two-pixel
    // dot, and ten thousand of them overlapping are the glow of the cluster.
    vEnergy = flux / (0.09 * size * size);
    vColour = color;
    gl_PointSize = size * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const CLUSTER_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColour;
  varying float vEnergy;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float profile = exp(-r2 * 9.0) + exp(-r2 * 2.5) * 0.06;
    gl_FragColor = vec4(vColour * vEnergy * profile, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

class Cluster {
  constructor(spec, material) {
    this.spec = spec;
    this.world = deepObjectWorld(spec);
    this.radiusKm = spec.radiusPc * PC_KM;
    this.points = new Points(buildCluster(spec), material);
    this.points.renderOrder = 3;
    this.group = new Group();
    this.group.add(this.points);
    this.group.scale.setScalar(this.radiusKm);
  }
}

// ------------------------------------------------------------ neutron stars

const SURFACE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vViewNormal;
  void main() {
    vNormal = normalize(position);
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uMagAxis;
  uniform vec3 uColour;
  uniform float uSpots;
  varying vec3 vNormal;
  varying vec3 vViewNormal;
  void main() {
    // A million degrees: white-hot with a blue cast, hottest where the field
    // lines come down onto the poles.
    float mu = max(vViewNormal.z, 0.0);
    float spot = pow(abs(dot(vNormal, uMagAxis)), 60.0) * uSpots;
    vec3 colour = uColour * (0.55 + 0.45 * mu) * 2.2 + vec3(0.8, 0.9, 1.0) * spot * 8.0;
    gl_FragColor = vec4(colour, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

const BEAM_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying float vAlong;
  varying float vFacing;
  void main() {
    vAlong = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColour;
  uniform float uIntensity;
  varying float vAlong;
  varying float vFacing;
  void main() {
    // Looking through the middle of the cone crosses more of it than grazing
    // its edge, which is all the volume a surface can fake.
    float fall = pow(1.0 - vAlong, 2.2);
    float core = 0.15 + 0.85 * pow(vFacing, 2.5);
    gl_FragColor = vec4(uColour * fall * core * uIntensity, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColour;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float glow = exp(-r * 9.0) * 1.4 + exp(-r * 3.0) * 0.12;
    gl_FragColor = vec4(uColour * glow * uIntensity * smoothstep(1.0, 0.8, r), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

const GLOW_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const additive = (vertexShader, fragmentShader, uniforms) => new ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
});

/** Dipole field lines, r = L sin²θ, about +y, from one pole to the other. */
function fieldLines(shells, azimuths) {
  const points = [];
  for (const L of shells) {
    const theta0 = Math.asin(Math.sqrt(1 / L));
    for (let k = 0; k < azimuths; k++) {
      const phi = (k / azimuths) * Math.PI * 2;
      let prev = null;
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const theta = theta0 + (Math.PI - 2 * theta0) * (i / steps);
        const r = L * Math.sin(theta) ** 2;
        const p = [r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi)];
        if (prev) points.push(...prev, ...p);
        prev = p;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

class NeutronStar {
  constructor(spec) {
    this.spec = spec;
    this.world = deepObjectWorld(spec);
    this.radiusKm = NEUTRON_STAR_RADIUS_KM;
    const rnd = random(hashKey(spec.key));
    const magnetar = spec.type === 'magnetar';
    const beams = spec.type !== 'isolated';
    // Magnetic axis tilted off the spin axis, which is what makes a pulsar
    // a lighthouse rather than a steady pair of searchlights.
    const tilt = 0.45 + rnd() * 0.5;
    const magAxis = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
    const magQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), magAxis);
    const colour = magnetar ? new Vector3(0.85, 0.8, 1.0) : new Vector3(0.7, 0.82, 1.0);

    this.group = new Group();
    this.group.quaternion.copy(orientation(rnd));
    this.spinner = new Group();
    this.group.add(this.spinner);
    this.group.scale.setScalar(this.radiusKm);

    const surface = new Mesh(new SphereGeometry(1, 48, 32), new ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: {
        uMagAxis: { value: magAxis },
        uColour: { value: colour },
        uSpots: { value: beams ? 1 : 0.3 },
      },
    }));
    this.spinner.add(surface);

    if (beams) {
      const length = 600;
      const width = length * Math.tan((magnetar ? 6 : 9) * (Math.PI / 180));
      const geometry = new CylinderGeometry(width, 0.3, length, 40, 1, true);
      geometry.translate(0, length / 2, 0);
      this.beamMaterial = additive(BEAM_VERTEX, BEAM_FRAGMENT, {
        uColour: { value: magnetar ? new Vector3(0.75, 0.55, 1.0) : new Vector3(0.55, 0.7, 1.0) },
        uIntensity: { value: 0.9 },
      });
      for (const sign of [1, -1]) {
        const beam = new Mesh(geometry, this.beamMaterial);
        beam.quaternion.copy(magQuat);
        if (sign < 0) beam.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI));
        beam.renderOrder = 5;
        this.spinner.add(beam);
      }
    }

    const lines = new LineSegments(
      fieldLines(magnetar ? [2, 3, 4.5, 7, 11, 17] : [2.5, 4, 7], magnetar ? 10 : 6),
      new LineBasicMaterial({
        color: magnetar ? 0xb08cff : 0x6fa8ff,
        transparent: true,
        opacity: magnetar ? 0.55 : 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    lines.quaternion.copy(magQuat);
    this.spinner.add(lines);

    this.glowMaterial = additive(GLOW_VERTEX, GLOW_FRAGMENT, {
      uColour: { value: colour },
      uIntensity: { value: 1 },
    });
    this.glow = new Mesh(new PlaneGeometry(80, 80), this.glowMaterial);
    this.glow.renderOrder = 6;
    this.group.add(this.glow);

    // Spun as seen, not as it is: the Crab turns thirty times a second, which
    // a sixty-hertz display can only alias. Slow ones keep their real period.
    this.visualPeriod = Math.max(spec.periodS, 0.7);
  }

  update(time, distanceKm, cameraQuaternion) {
    this.group.visible = distanceKm < 5e6;
    if (!this.group.visible) return;
    this.spinner.rotation.y = (time / this.visualPeriod) * Math.PI * 2;
    // Facing the camera, in the group's own frame.
    this.glow.quaternion.copy(this.group.quaternion).invert().multiply(cameraQuaternion);
  }
}

// --------------------------------------------------------------------- all

export function createDeepObjects() {
  const group = new Group();
  const noise = noiseTexture();
  const sphere = new SphereGeometry(1, 48, 24);
  const nebulae = new Map(NEBULAE.map((spec) => [`neb:${spec.key}`, new Nebula(spec, noise, sphere)]));
  const clusterMaterial = new ShaderMaterial({
    vertexShader: CLUSTER_VERTEX,
    fragmentShader: CLUSTER_FRAGMENT,
    uniforms: { uGain: { value: 1.17 }, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const clusters = new Map(CLUSTERS.map((spec) => [`cl:${spec.key}`, new Cluster(spec, clusterMaterial)]));
  const neutronStars = new Map(NEUTRON_STARS.map((spec) => [`ns:${spec.key}`, new NeutronStar(spec)]));
  for (const item of [...nebulae.values(), ...clusters.values(), ...neutronStars.values()]) group.add(item.group);

  const local = new Vector3();
  return {
    group,
    nebulae,
    clusters,
    neutronStars,
    get(key) {
      return nebulae.get(key) ?? clusters.get(key) ?? neutronStars.get(key) ?? null;
    },
    /**
     * @param {object} o
     * @param {(group: Group, world: Vector3) => void} o.place floating-origin placement
     */
    update({ cameraWorld, cameraQuaternion, place, time, pixelsPerRadian, pixelRatio, exposure = 1, steps = 48, visible = true }) {
      group.visible = visible;
      if (!visible) return;
      clusterMaterial.uniforms.uPixelRatio.value = pixelRatio;
      // A zeroth-magnitude star is 1.17 Suns at a parsec; the rest is the same
      // headroom the star field is drawn with.
      clusterMaterial.uniforms.uGain.value = 1.17 * 4 * exposure;
      for (const nebula of nebulae.values()) {
        place(nebula.group, nebula.world);
        local.copy(cameraWorld).sub(nebula.world);
        nebula.update(local, local.length(), pixelsPerRadian, steps);
      }
      for (const cluster of clusters.values()) place(cluster.group, cluster.world);
      for (const star of neutronStars.values()) {
        place(star.group, star.world);
        star.update(time, cameraWorld.distanceTo(star.world), cameraQuaternion);
      }
    },
  };
}
