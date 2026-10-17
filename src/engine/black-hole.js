import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three';
import { AU_KM, equatorialToEcliptic, PC_KM } from './units.js';
import { equatorialToVector } from '../astro.js';
import { platform } from './platform.js';
import { pointGlare, pointVisibility } from './star.js';
import { starColour, starPointsMaterial } from './deep-objects.js';

/** Schwarzschild radius of one solar mass, km. */
export const RS_KM_PER_SOL = 2.953;

/** The render layer hole volumes live on, so the main pass leaves them out. */
export const BLACK_HOLE_LAYER = 2;

/** Comoving distance to redshift z in parsecs, flat, H0 = 70, Omega_m = 0.3. */
export function comovingPc(z) {
  const steps = 600;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const zi = ((i + 0.5) / steps) * z;
    sum += 1 / Math.sqrt(0.3 * (1 + zi) ** 3 + 0.7);
  }
  return (299792.458 / 70) * sum * (z / steps) * 1e6;
}

/*
 * Disk palettes. A disk's true colour is a blackbody, which for every real
 * hole is somewhere between amber and blue-white; these are the looks the
 * renders of them are known by — a dusty red torus round a quasar, the
 * violet of a hot corona, the gold of the EHT's M87* — laid over that.
 * `tint` is how far over: 0 leaves the physics alone.
 */
export const HOLE_PALETTES = {
  thermal: { inner: [1, 0.9, 0.75], outer: [1, 0.55, 0.2], tint: 0 },
  ember: { inner: [1.0, 0.82, 0.55], outer: [0.95, 0.12, 0.05], tint: 0.85, torus: [0.8, 0.12, 0.05] },
  gold: { inner: [1.0, 0.95, 0.75], outer: [1.0, 0.55, 0.12], tint: 0.8 },
  violet: { inner: [0.85, 0.9, 1.0], outer: [0.55, 0.2, 1.0], tint: 0.85, torus: [0.4, 0.15, 0.8] },
  magenta: { inner: [1.0, 0.85, 0.95], outer: [0.95, 0.15, 0.6], tint: 0.85 },
  cyan: { inner: [0.9, 1.0, 1.0], outer: [0.15, 0.6, 1.0], tint: 0.85, torus: [0.1, 0.35, 0.8] },
  sunset: { inner: [1.0, 0.95, 0.8], outer: [1.0, 0.3, 0.45], tint: 0.8, torus: [0.7, 0.15, 0.3] },
};

/**
 * Catalogued holes at measured sky positions. Masses set the event-horizon
 * size; the same mesh shader is used for a stellar-mass binary and for M87*.
 *
 * Distances to the quasars are comoving, where they are now, from their
 * redshift. `host` names the galaxy a supermassive hole sits at the heart of,
 * and puts it exactly at that galaxy's catalogued centre. `jetPc` is how far
 * its jets reach; `companion` is the star feeding (or simply orbiting) a
 * stellar-mass hole, from the measured orbit.
 */
export const BLACK_HOLES = [
  { key: 'sgr-a', name: 'Sagittarius A*', ra: 266.41684, dec: -29.00781, distPc: 8178, massSol: 4.3e6, spin: 0.94, inclinationDeg: 74, jet: 0, palette: 'thermal', activity: 'Quiescent' },
  { key: 'cygnus-x1', name: 'Cygnus X-1', ra: 299.5903, dec: 35.20173, distPc: 2240, massSol: 21.2, spin: 0.97, inclinationDeg: 27, jet: 1, jetPc: 0.05, palette: 'cyan', activity: 'X-ray binary', companion: { name: 'HDE 226868', sepAu: 0.2, teff: 31000, lum: 3.5e5 } },
  { key: 'm87-star', name: 'M87*', host: 'NGC 4486', ra: 187.70593, dec: 12.39112, distPc: 16.8e6, massSol: 6.5e9, spin: 0.9, inclinationDeg: 17, jet: 1, jetPc: 1500, palette: 'gold', activity: 'Radio galaxy' },

  // The largest and the brightest.
  { key: 'ton618', name: 'TON 618', ra: 187.1046, dec: 31.4772, z: 2.219, massSol: 4.07e10, spin: 0.95, inclinationDeg: 28, jet: 1, jetPc: 8000, palette: 'ember', activity: 'Quasar', brightness: 1.4, diskOuterRs: 27 },
  { key: 's5-0014', name: 'S5 0014+81', ra: 4.2854, dec: 81.5856, z: 3.366, massSol: 4e10, spin: 0.9, inclinationDeg: 12, jet: 1, jetPc: 6000, palette: 'cyan', activity: 'Quasar', brightness: 1.4 },
  { key: 'apm08279', name: 'APM 08279+5255', ra: 127.924, dec: 52.7548, z: 3.911, massSol: 1e10, spin: 0.9, inclinationDeg: 35, jet: 0, palette: 'gold', activity: 'Quasar', brightness: 1.3 },
  { key: 'sdss-j0100', name: 'SDSS J0100+2802', ra: 15.0543, dec: 28.0405, z: 6.3, massSol: 1.2e10, spin: 0.9, inclinationDeg: 40, jet: 0, palette: 'violet', activity: 'Quasar', brightness: 1.3 },
  { key: 'ulas-j1342', name: 'ULAS J1342+0928', ra: 205.5338, dec: 9.4774, z: 7.54, massSol: 8e8, spin: 0.8, inclinationDeg: 50, jet: 0, palette: 'sunset', activity: 'Quasar' },
  { key: 'j0313', name: 'J0313\u22121806', ra: 48.4327, dec: -18.1031, z: 7.64, massSol: 1.6e9, spin: 0.8, inclinationDeg: 45, jet: 0, palette: 'magenta', activity: 'Quasar' },
  { key: '3c273', name: '3C 273', ra: 187.2779, dec: 2.0524, z: 0.158, massSol: 8.9e8, spin: 0.9, inclinationDeg: 20, jet: 1, jetPc: 40000, palette: 'violet', activity: 'Quasar', brightness: 1.2 },
  { key: 'oj287', name: 'OJ 287', ra: 133.7036, dec: 20.1085, z: 0.306, massSol: 1.8e10, spin: 0.38, inclinationDeg: 8, jet: 1, jetPc: 5000, palette: 'magenta', activity: 'Blazar' },
  { key: 'phoenix-a', name: 'Phoenix A', host: 'Phoenix Cluster BCG', ra: 356.183, dec: -42.7203, z: 0.597, massSol: 1e11, spin: 0.8, inclinationDeg: 60, jet: 1, jetPc: 20000, palette: 'ember', activity: 'Active' },
  { key: 'holm15a', name: 'Holmberg 15A*', host: 'Holmberg 15A', ra: 10.46, dec: -9.3031, distPc: 2.34e8, massSol: 4e10, spin: 0.7, inclinationDeg: 55, jet: 0, palette: 'sunset', activity: 'Quiescent', brightness: 0.35 },
  { key: 'ic1101', name: 'IC 1101*', host: 'IC 1101', ra: 227.7004, dec: 5.7334, distPc: 3.36e8, massSol: 4e10, spin: 0.7, inclinationDeg: 65, jet: 0, palette: 'ember', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc4889', name: 'NGC 4889*', host: 'NGC 4884', ra: 195.0338, dec: 27.977, distPc: 1.05e8, massSol: 2.1e10, spin: 0.7, inclinationDeg: 40, jet: 0, palette: 'violet', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc1600', name: 'NGC 1600*', host: 'NGC 1600', ra: 67.9162, dec: -5.0878, distPc: 6.64e7, massSol: 1.7e10, spin: 0.7, inclinationDeg: 70, jet: 0, palette: 'gold', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc1277', name: 'NGC 1277*', host: 'NGC 1277', ra: 49.9661, dec: 41.5736, distPc: 6.89e7, massSol: 4.9e9, spin: 0.7, inclinationDeg: 50, jet: 0, palette: 'magenta', activity: 'Quiescent', brightness: 0.3 },
  { key: 'cyg-a', name: 'Cygnus A*', host: 'Cygnus A', ra: 299.8682, dec: 40.7339, distPc: 2.37e8, massSol: 2.5e9, spin: 0.9, inclinationDeg: 80, jet: 1, jetPc: 70000, palette: 'sunset', activity: 'Radio galaxy' },

  // Nearby galaxies' own.
  { key: 'm31-star', name: 'M31*', host: 'NGC 224', ra: 10.6847, dec: 41.2692, distPc: 7.7e5, massSol: 1.4e8, spin: 0.6, inclinationDeg: 77, jet: 0, palette: 'thermal', activity: 'Quiescent', brightness: 0.4 },
  { key: 'm104-star', name: 'Sombrero Galaxy*', host: 'NGC 4594', ra: 189.9976, dec: -11.6231, distPc: 9.3e6, massSol: 1e9, spin: 0.7, inclinationDeg: 84, jet: 0, palette: 'gold', activity: 'LINER', brightness: 0.6 },
  { key: 'cen-a-star', name: 'Centaurus A*', host: 'NGC 5128', ra: 201.3654, dec: -43.0191, distPc: 3.75e6, massSol: 5.5e7, spin: 0.8, inclinationDeg: 60, jet: 1, jetPc: 4000, palette: 'ember', activity: 'Radio galaxy' },
  { key: 'm106-star', name: 'M106*', host: 'NGC 4258', ra: 184.7396, dec: 47.3039, distPc: 7.83e6, massSol: 3.9e7, spin: 0.7, inclinationDeg: 82, jet: 1, jetPc: 300, palette: 'cyan', activity: 'Seyfert' },
  { key: 'm81-star', name: 'M81*', host: 'NGC 3031', ra: 148.8882, dec: 69.0653, distPc: 3.63e6, massSol: 7e7, spin: 0.6, inclinationDeg: 30, jet: 0, palette: 'sunset', activity: 'LINER', brightness: 0.6 },
  { key: 'ngc4151-star', name: 'NGC 4151*', host: 'NGC 4151', ra: 182.6357, dec: 39.4057, distPc: 1.58e7, massSol: 4.5e7, spin: 0.8, inclinationDeg: 45, jet: 0, palette: 'violet', activity: 'Seyfert' },

  // Stellar-mass: X-ray binaries, microquasars, and the dormant ones Gaia
  // found only by the wobble of the star going round them.
  { key: 'v404-cyg', name: 'V404 Cygni', ra: 306.0159, dec: 33.8672, distPc: 2390, massSol: 9, spin: 0.9, inclinationDeg: 67, jet: 1, jetPc: 0.02, palette: 'ember', activity: 'X-ray binary', companion: { name: 'V404 Cygni companion', sepAu: 0.15, teff: 4300, lum: 8 } },
  { key: 'gro-j1655', name: 'GRO J1655\u221240', ra: 253.5005, dec: -39.8458, distPc: 3200, massSol: 6.3, spin: 0.7, inclinationDeg: 70, jet: 1, jetPc: 0.03, palette: 'violet', activity: 'Microquasar', companion: { name: 'V1033 Scorpii', sepAu: 0.08, teff: 6300, lum: 30 } },
  { key: 'a0620', name: 'A0620\u221200', ra: 95.6855, dec: -0.3456, distPc: 1060, massSol: 6.6, spin: 0.12, inclinationDeg: 51, jet: 0, palette: 'sunset', activity: 'X-ray binary', brightness: 0.4, companion: { name: 'V616 Monocerotis', sepAu: 0.02, teff: 4400, lum: 0.3 } },
  { key: 'grs1915', name: 'GRS 1915+105', ra: 288.7983, dec: 10.9458, distPc: 8600, massSol: 12.4, spin: 0.98, inclinationDeg: 60, jet: 1, jetPc: 0.08, palette: 'cyan', activity: 'Microquasar', companion: { name: 'V1487 Aquilae', sepAu: 0.5, teff: 4800, lum: 20 } },
  { key: 'ss433', name: 'SS 433', ra: 287.9565, dec: 4.9827, distPc: 5500, massSol: 10, spin: 0.8, inclinationDeg: 78, jet: 1, jetPc: 0.3, palette: 'magenta', activity: 'Microquasar', companion: { name: 'SS 433 A', sepAu: 0.3, teff: 8500, lum: 4e4 } },
  { key: 'maxi-j1820', name: 'MAXI J1820+070', ra: 275.0914, dec: 7.1854, distPc: 2960, massSol: 8.5, spin: 0.2, inclinationDeg: 64, jet: 1, jetPc: 0.03, palette: 'gold', activity: 'X-ray binary', companion: { name: 'MAXI J1820+070 companion', sepAu: 0.03, teff: 4200, lum: 0.4 } },
  { key: 'gx339', name: 'GX 339\u22124', ra: 255.7058, dec: -48.7897, distPc: 8000, massSol: 6, spin: 0.9, inclinationDeg: 40, jet: 1, jetPc: 0.03, palette: 'violet', activity: 'Microquasar' },
  { key: 'xte-j1118', name: 'XTE J1118+480', ra: 169.5452, dec: 48.0367, distPc: 1700, massSol: 7.3, spin: 0.3, inclinationDeg: 68, jet: 0, palette: 'ember', activity: 'X-ray binary', brightness: 0.5, companion: { name: 'KV Ursae Majoris', sepAu: 0.012, teff: 4300, lum: 0.2 } },
  { key: 'lmc-x1', name: 'LMC X-1', ra: 84.9113, dec: -69.7433, distPc: 49970, massSol: 10.9, spin: 0.92, inclinationDeg: 36, jet: 0, palette: 'cyan', activity: 'X-ray binary', companion: { name: 'LMC X-1 companion', sepAu: 0.17, teff: 33000, lum: 2e5 } },
  { key: 'm33-x7', name: 'M33 X-7', ra: 23.392, dec: 30.5366, distPc: 8.4e5, massSol: 15.65, spin: 0.84, inclinationDeg: 75, jet: 0, palette: 'violet', activity: 'X-ray binary', companion: { name: 'M33 X-7 companion', sepAu: 0.2, teff: 35000, lum: 4e5 } },
  { key: 'gaia-bh1', name: 'Gaia BH1', ra: 262.1712, dec: -0.5808, distPc: 480, massSol: 9.6, spin: 0.5, inclinationDeg: 60, jet: 0, palette: 'thermal', activity: 'Dormant', brightness: 0.05, companion: { name: 'Gaia BH1 star', sepAu: 1.4, teff: 5850, lum: 1.1 } },
  { key: 'gaia-bh2', name: 'Gaia BH2', ra: 207.5704, dec: -59.2399, distPc: 1160, massSol: 8.9, spin: 0.5, inclinationDeg: 35, jet: 0, palette: 'thermal', activity: 'Dormant', brightness: 0.05, companion: { name: 'Gaia BH2 star', sepAu: 4.96, teff: 4600, lum: 25 } },
  { key: 'gaia-bh3', name: 'Gaia BH3', ra: 294.8268, dec: 14.9306, distPc: 590, massSol: 33, spin: 0.5, inclinationDeg: 80, jet: 0, palette: 'thermal', activity: 'Dormant', brightness: 0.05, companion: { name: 'Gaia BH3 star', sepAu: 16, teff: 5200, lum: 15 } },
  { key: '4u1543', name: '4U 1543\u221247', ra: 236.7854, dec: -47.6697, distPc: 7500, massSol: 9.4, spin: 0.67, inclinationDeg: 21, jet: 0, palette: 'cyan', activity: 'X-ray binary', companion: { name: 'IL Lupi', sepAu: 0.12, teff: 9000, lum: 30 } },
  { key: 'nova-mus-1991', name: 'GRS 1124\u221268 (Nova Muscae 1991)', ra: 171.6104, dec: -68.6744, distPc: 5000, massSol: 11, spin: 0.63, inclinationDeg: 43, jet: 0, palette: 'sunset', activity: 'X-ray binary', brightness: 0.5, companion: { name: 'GU Muscae', sepAu: 0.03, teff: 4500, lum: 0.4 } },
  { key: 'v4641-sgr', name: 'V4641 Sagittarii', ra: 274.8403, dec: -25.4072, distPc: 6200, massSol: 6.4, spin: 0.5, inclinationDeg: 72, jet: 1, jetPc: 0.05, palette: 'violet', activity: 'Microquasar', companion: { name: 'V4641 Sgr B9 giant', sepAu: 0.2, teff: 10500, lum: 100 } },
  { key: 'xte-j1550', name: 'XTE J1550\u2212564', ra: 237.7446, dec: -56.4767, distPc: 4400, massSol: 9.1, spin: 0.5, inclinationDeg: 75, jet: 1, jetPc: 0.1, palette: 'ember', activity: 'Microquasar', companion: { name: 'V381 Normae', sepAu: 0.07, teff: 4600, lum: 1.5 } },
  { key: 'gs2000', name: 'GS 2000+25', ra: 300.7104, dec: 25.2355, distPc: 2700, massSol: 7.2, spin: 0.3, inclinationDeg: 65, jet: 0, palette: 'gold', activity: 'X-ray binary', brightness: 0.4, companion: { name: 'QZ Vulpeculae', sepAu: 0.015, teff: 4000, lum: 0.15 } },
  { key: 'grs1009', name: 'GRS 1009\u221245', ra: 152.4433, dec: -45.0758, distPc: 3800, massSol: 8.5, spin: 0.4, inclinationDeg: 59, jet: 0, palette: 'thermal', activity: 'X-ray binary', brightness: 0.4, companion: { name: 'MM Velorum', sepAu: 0.02, teff: 5500, lum: 0.6 } },
  { key: 'h1705', name: 'H1705\u2212250 (Nova Ophiuchi 1977)', ra: 257.0533, dec: -25.0919, distPc: 8600, massSol: 6.4, spin: 0.4, inclinationDeg: 70, jet: 0, palette: 'sunset', activity: 'X-ray binary', brightness: 0.4 },
  { key: 'gs1354', name: 'GS 1354\u221264', ra: 209.5413, dec: -64.735, distPc: 25000, massSol: 7.6, spin: 0.98, inclinationDeg: 75, jet: 0, palette: 'magenta', activity: 'X-ray binary' },
  { key: 'xte-j1650', name: 'XTE J1650\u2212500', ra: 252.5038, dec: -49.9572, distPc: 2600, massSol: 5, spin: 0.8, inclinationDeg: 50, jet: 1, jetPc: 0.02, palette: 'cyan', activity: 'Microquasar' },
  { key: 'swift-j1753', name: 'Swift J1753.5\u22120127', ra: 268.3679, dec: -1.4519, distPc: 6000, massSol: 5, spin: 0.76, inclinationDeg: 40, jet: 1, jetPc: 0.02, palette: 'gold', activity: 'X-ray binary' },
  { key: 'lmc-x3', name: 'LMC X-3', ra: 84.7342, dec: -64.0839, distPc: 49970, massSol: 7, spin: 0.25, inclinationDeg: 69, jet: 0, palette: 'cyan', activity: 'X-ray binary', companion: { name: 'LMC X-3 B star', sepAu: 0.11, teff: 16000, lum: 6000 } },
  { key: 'ic10-x1', name: 'IC 10 X-1', ra: 5.0331, dec: 59.2939, distPc: 7.5e5, massSol: 23, spin: 0.85, inclinationDeg: 60, jet: 0, palette: 'violet', activity: 'X-ray binary', companion: { name: 'IC 10 X-1 Wolf\u2013Rayet star', sepAu: 0.08, teff: 65000, lum: 3e5 } },
  { key: 'ngc300-x1', name: 'NGC 300 X-1', ra: 13.7896, dec: -37.6969, distPc: 1.88e6, massSol: 17, spin: 0.7, inclinationDeg: 60, jet: 0, palette: 'magenta', activity: 'X-ray binary', companion: { name: 'NGC 300 X-1 Wolf\u2013Rayet star', sepAu: 0.1, teff: 65000, lum: 2e5 } },
  { key: 'cyg-x3', name: 'Cygnus X-3', ra: 308.1074, dec: 40.9578, distPc: 9700, massSol: 4.5, spin: 0.6, inclinationDeg: 30, jet: 1, jetPc: 0.1, palette: 'ember', activity: 'Microquasar', companion: { name: 'Cygnus X-3 Wolf\u2013Rayet star', sepAu: 0.02, teff: 90000, lum: 2e5 } },

  // Gravitational-wave mergers. The sky positions are the centres of wide
  // error regions, so these are where the remnants probably are.
  { key: 'gw150914', name: 'GW150914 remnant', ra: 120.0, dec: -70.0, distPc: 4.4e8, massSol: 62, spin: 0.67, inclinationDeg: 30, jet: 0, palette: 'thermal', activity: 'Merger remnant', brightness: 0.05 },
  { key: 'gw190521', name: 'GW190521 remnant', ra: 192.0, dec: -34.8, z: 0.82, massSol: 142, spin: 0.72, inclinationDeg: 40, jet: 0, palette: 'violet', activity: 'Merger remnant', brightness: 0.05 },
  { key: 'gw170104', name: 'GW170104 remnant', ra: 130.0, dec: 30.0, distPc: 8.8e8, massSol: 49, spin: 0.64, inclinationDeg: 30, jet: 0, palette: 'thermal', activity: 'Merger remnant', brightness: 0.05 },
  { key: 'gw231123', name: 'GW231123 remnant', ra: 192.0, dec: 15.0, distPc: 2.2e9, massSol: 225, spin: 0.9, inclinationDeg: 30, jet: 0, palette: 'cyan', activity: 'Merger remnant', brightness: 0.05 },

  // Intermediate-mass: the missing middle, a handful of good cases.
  { key: 'omega-cen-imbh', name: 'Omega Centauri IMBH', ra: 201.6967, dec: -47.4795, distPc: 5430, massSol: 8200, spin: 0.5, inclinationDeg: 40, jet: 0, palette: 'gold', activity: 'Dormant', brightness: 0.05 },
  { key: '47tuc-imbh', name: '47 Tucanae IMBH (candidate)', ra: 6.0236, dec: -72.0813, distPc: 4450, massSol: 2200, spin: 0.5, inclinationDeg: 40, jet: 0, palette: 'thermal', activity: 'Dormant', brightness: 0.05 },
  { key: 'hlx1', name: 'HLX-1', ra: 17.6179, dec: -46.0728, distPc: 9.5e7, massSol: 2e4, spin: 0.7, inclinationDeg: 60, jet: 1, jetPc: 0.5, palette: 'cyan', activity: 'Ultraluminous X-ray source' },
  { key: 'm82-x1', name: 'M82 X-1', ra: 148.9583, dec: 69.6794, distPc: 3.6e6, massSol: 400, spin: 0.6, inclinationDeg: 50, jet: 0, palette: 'magenta', activity: 'Ultraluminous X-ray source' },
  { key: 'ngc1313-x1', name: 'NGC 1313 X-1', ra: 49.5825, dec: -66.4864, distPc: 4.25e6, massSol: 1000, spin: 0.6, inclinationDeg: 40, jet: 0, palette: 'violet', activity: 'Ultraluminous X-ray source' },
  { key: 'ngc4395-star', name: 'NGC 4395*', host: 'NGC 4395', ra: 186.4537, dec: 33.5469, distPc: 4.3e6, massSol: 3.6e5, spin: 0.6, inclinationDeg: 35, jet: 0, palette: 'cyan', activity: 'Seyfert' },
  { key: 'm32-star', name: 'M32*', host: 'NGC 221', ra: 10.6743, dec: 40.8652, distPc: 7.6e5, massSol: 2.5e6, spin: 0.5, inclinationDeg: 50, jet: 0, palette: 'thermal', activity: 'Quiescent', brightness: 0.3 },

  // More galaxies' own, weighed by the stars and gas going round them.
  { key: 'ngc3115-star', name: 'NGC 3115*', host: 'NGC 3115', ra: 151.3083, dec: -7.7186, distPc: 9.7e6, massSol: 9.6e8, spin: 0.6, inclinationDeg: 86, jet: 0, palette: 'gold', activity: 'Quiescent', brightness: 0.3 },
  { key: 'm49-star', name: 'M49*', host: 'NGC 4472', ra: 187.445, dec: 7.9998, distPc: 1.71e7, massSol: 2.5e9, spin: 0.7, inclinationDeg: 40, jet: 0, palette: 'sunset', activity: 'Quiescent', brightness: 0.3 },
  { key: 'm60-star', name: 'M60*', host: 'NGC 4649', ra: 190.9167, dec: 11.5526, distPc: 1.65e7, massSol: 4.5e9, spin: 0.7, inclinationDeg: 50, jet: 0, palette: 'ember', activity: 'Quiescent', brightness: 0.3 },
  { key: 'm84-star', name: 'M84*', host: 'NGC 4374', ra: 186.2654, dec: 12.887, distPc: 1.84e7, massSol: 9e8, spin: 0.8, inclinationDeg: 60, jet: 1, jetPc: 3000, palette: 'magenta', activity: 'Radio galaxy' },
  { key: 'm105-star', name: 'M105*', host: 'NGC 3379', ra: 161.9567, dec: 12.5817, distPc: 1.03e7, massSol: 4e8, spin: 0.6, inclinationDeg: 45, jet: 0, palette: 'thermal', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc1332-star', name: 'NGC 1332*', host: 'NGC 1332', ra: 52.0828, dec: -21.3353, distPc: 2.23e7, massSol: 6.6e8, spin: 0.6, inclinationDeg: 84, jet: 0, palette: 'gold', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc3377-star', name: 'NGC 3377*', host: 'NGC 3377', ra: 161.9264, dec: 13.9858, distPc: 1.1e7, massSol: 1.8e8, spin: 0.6, inclinationDeg: 60, jet: 0, palette: 'violet', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc1399-star', name: 'NGC 1399*', host: 'NGC 1399', ra: 54.6212, dec: -35.4507, distPc: 2.0e7, massSol: 8.8e8, spin: 0.7, inclinationDeg: 50, jet: 1, jetPc: 2000, palette: 'sunset', activity: 'Radio galaxy' },
  { key: 'ngc3842-star', name: 'NGC 3842*', host: 'NGC 3842', ra: 176.009, dec: 19.9497, distPc: 9.8e7, massSol: 9.7e9, spin: 0.7, inclinationDeg: 45, jet: 0, palette: 'ember', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc1271-star', name: 'NGC 1271*', ra: 49.8008, dec: 41.3533, distPc: 8.0e7, massSol: 3e9, spin: 0.7, inclinationDeg: 75, jet: 0, palette: 'magenta', activity: 'Quiescent', brightness: 0.3 },
  { key: 'm77-star', name: 'M77*', ra: 40.6696, dec: -0.0133, distPc: 1.44e7, massSol: 1.5e7, spin: 0.8, inclinationDeg: 70, jet: 1, jetPc: 300, palette: 'cyan', activity: 'Seyfert' },
  { key: 'circinus-star', name: 'Circinus Galaxy*', ra: 213.2913, dec: -65.3392, distPc: 4.2e6, massSol: 1.7e6, spin: 0.7, inclinationDeg: 65, jet: 0, palette: 'violet', activity: 'Seyfert' },
  { key: 'ngc6240', name: 'NGC 6240 (binary nucleus)', host: 'NGC 6240', ra: 253.2454, dec: 2.4009, z: 0.0245, massSol: 1e9, spin: 0.7, inclinationDeg: 50, jet: 0, palette: 'sunset', activity: 'Merging pair' },
  { key: 'arp220', name: 'Arp 220*', ra: 233.7384, dec: 23.5032, z: 0.018, massSol: 7e8, spin: 0.6, inclinationDeg: 55, jet: 0, palette: 'ember', activity: 'Merging pair', brightness: 0.5 },
  { key: 'mrk231', name: 'Markarian 231', ra: 194.0593, dec: 56.8737, z: 0.0422, massSol: 1.5e8, spin: 0.8, inclinationDeg: 30, jet: 1, jetPc: 50, palette: 'gold', activity: 'Quasar' },
  { key: 'abell1201', name: 'Abell 1201 BCG*', ra: 168.2271, dec: 13.4358, z: 0.169, massSol: 3.3e10, spin: 0.7, inclinationDeg: 50, jet: 0, palette: 'ember', activity: 'Quiescent', brightness: 0.3 },
  { key: 'ngc6166', name: 'NGC 6166*', host: 'NGC 6166', ra: 247.1597, dec: 39.5513, z: 0.031, massSol: 3e9, spin: 0.7, inclinationDeg: 60, jet: 1, jetPc: 10000, palette: 'sunset', activity: 'Radio galaxy' },

  // Blazars and quasars: a jet pointed nearly at us, or a disc outshining
  // its whole galaxy.
  { key: '3c279', name: '3C 279', ra: 194.0465, dec: -5.7893, z: 0.536, massSol: 8e8, spin: 0.9, inclinationDeg: 3, jet: 1, jetPc: 20000, palette: 'magenta', activity: 'Blazar' },
  { key: '3c454', name: '3C 454.3', ra: 343.4906, dec: 16.1482, z: 0.859, massSol: 2.3e9, spin: 0.9, inclinationDeg: 2, jet: 1, jetPc: 20000, palette: 'cyan', activity: 'Blazar' },
  { key: '3c48', name: '3C 48', ra: 24.4221, dec: 33.1598, z: 0.367, massSol: 3e8, spin: 0.8, inclinationDeg: 30, jet: 1, jetPc: 5000, palette: 'gold', activity: 'Quasar' },
  { key: 'pks2155', name: 'PKS 2155\u2212304', ra: 329.7169, dec: -30.2256, z: 0.116, massSol: 1e9, spin: 0.9, inclinationDeg: 4, jet: 1, jetPc: 8000, palette: 'violet', activity: 'Blazar' },
  { key: 'mrk421', name: 'Markarian 421', ra: 166.1138, dec: 38.2088, z: 0.031, massSol: 2e8, spin: 0.9, inclinationDeg: 4, jet: 1, jetPc: 5000, palette: 'cyan', activity: 'Blazar' },
  { key: 'mrk501', name: 'Markarian 501', ra: 253.4676, dec: 39.7602, z: 0.034, massSol: 1e9, spin: 0.9, inclinationDeg: 5, jet: 1, jetPc: 5000, palette: 'magenta', activity: 'Blazar' },
  { key: 'bl-lac', name: 'BL Lacertae', ra: 330.6804, dec: 42.2778, z: 0.069, massSol: 1.7e8, spin: 0.9, inclinationDeg: 6, jet: 1, jetPc: 3000, palette: 'ember', activity: 'Blazar' },
  { key: 'h1821', name: 'H1821+643', ra: 275.4888, dec: 64.3434, z: 0.297, massSol: 3e10, spin: 0.8, inclinationDeg: 40, jet: 1, jetPc: 30000, palette: 'gold', activity: 'Quasar' },
  { key: 'pg1302', name: 'PG 1302\u2212102 (binary candidate)', ra: 196.3876, dec: -10.5554, z: 0.2784, massSol: 3e8, spin: 0.7, inclinationDeg: 40, jet: 1, jetPc: 2000, palette: 'sunset', activity: 'Quasar' },
  { key: 'twin-qso', name: 'Twin Quasar (Q0957+561)', ra: 150.336, dec: 55.8971, z: 1.41, massSol: 1e9, spin: 0.8, inclinationDeg: 30, jet: 1, jetPc: 10000, palette: 'cyan', activity: 'Quasar' },
  { key: 'j0529', name: 'J0529\u22124351', ra: 82.3163, dec: -43.8586, z: 3.962, massSol: 1.7e10, spin: 0.95, inclinationDeg: 20, jet: 0, palette: 'thermal', activity: 'Quasar' },
  { key: 'j2157', name: 'SMSS J2157\u22123602', ra: 329.3675, dec: -36.0375, z: 4.692, massSol: 3.4e10, spin: 0.95, inclinationDeg: 25, jet: 0, palette: 'gold', activity: 'Quasar' },
  { key: 'j1148', name: 'SDSS J1148+5251', ra: 177.0694, dec: 52.8639, z: 6.42, massSol: 3e9, spin: 0.9, inclinationDeg: 30, jet: 0, palette: 'violet', activity: 'Quasar' },
  { key: 'j1120', name: 'ULAS J1120+0641', ra: 170.0062, dec: 6.6901, z: 7.085, massSol: 2e9, spin: 0.9, inclinationDeg: 35, jet: 0, palette: 'cyan', activity: 'Quasar' },
  { key: 'ceers1019', name: 'CEERS 1019*', ra: 215.0354, dec: 52.8907, z: 8.68, massSol: 9e6, spin: 0.7, inclinationDeg: 40, jet: 0, palette: 'magenta', activity: 'Active' },
  { key: 'gnz11-star', name: 'GN-z11*', host: 'GN-z11', ra: 189.1060, dec: 62.2420, z: 10.6, massSol: 1.6e6, spin: 0.7, inclinationDeg: 40, jet: 0, palette: 'violet', activity: 'Active' },
  { key: 'uhz1', name: 'UHZ1', ra: 3.567, dec: -30.378, z: 10.1, massSol: 4e7, spin: 0.7, inclinationDeg: 40, jet: 0, palette: 'cyan', activity: 'Active' },
];
for (const spec of BLACK_HOLES) if (spec.z && !spec.distPc) spec.distPc = comovingPc(spec.z);

export function schwarzschildKm(massSol) {
  return RS_KM_PER_SOL * massSol;
}

export function blackHoleWorld(spec, out = new Vector3()) {
  equatorialToVector(spec.ra, spec.dec, out);
  equatorialToEcliptic(out);
  return out.multiplyScalar(spec.distPc * PC_KM);
}

const VOLUME_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/**
 * The hole itself, ray-marched through the bounding sphere.
 *
 * The thing that makes a black hole look like a black hole is not the disk but
 * what the light bending does to it: the far side of the disk is lifted over
 * the top of the shadow and the near underside is folded up beneath it, so a
 * flat ring seen nearly edge-on reads as a bright arc wrapping a dark sphere.
 * That only appears if the rays are actually integrated, so they are — each one
 * followed as a null geodesic rather than pushed sideways by a fudge factor.
 *
 * For a Schwarzschild metric the shape of a photon path in Cartesian
 * coordinates obeys
 *
 *   a = -3/2 · h² · p / r⁵      with h = |p × v| conserved along the ray
 *
 * which is cheap — one cross product per ray, then two multiplies per step —
 * and correct enough to produce the photon ring at 1.5 rs without it having to
 * be drawn in by hand.
 */
const VOLUME_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uCameraLocal;
  uniform float uRs;
  uniform float uTime;
  uniform float uSpin;
  uniform float uJet;
  uniform float uBrightness;
  uniform float uCoreTempK;
  uniform float uRimTempK;
  uniform float uDiskOut;  // rs, outer edge of the disk
  uniform vec3 uInner;     // palette, inner edge
  uniform vec3 uOuter;     // palette, rim
  uniform float uTint;     // how far the palette replaces the blackbody
  uniform vec3 uTorus;     // a dusty ring past the disk's edge, black for none
  uniform vec3 uJetColour;
  uniform sampler2D tBehind;   // the frame as drawn before any hole, linear HDR
  uniform float uLens;
  uniform mat3 uLocalToView;
  uniform mat4 uProjection;

  varying vec3 vLocal;

  /**
   * What lies behind the hole along a bent ray, read back from the frame
   * already drawn: the escaped direction is projected to the screen, so the
   * stars, galaxies and planets behind are smeared into arcs and an Einstein
   * ring by the same geodesics that draw the disk.
   */
  vec3 behind(vec3 dirLocal) {
    vec3 v = uLocalToView * dirLocal;
    vec4 clip = uProjection * vec4(v, 0.0);
    clip.w = abs(clip.w) < 1e-6 ? 1e-6 : clip.w;
    // Strongly bent rays leave the frame, and from close up most of them do.
    // A starfield is much the same in every direction, so the frame is read
    // mirrored back into itself there: wrong in detail, but it keeps stars in
    // the arcs around the shadow instead of a black annulus where the copy
    // ran out.
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    uv = 1.0 - abs(1.0 - mod(uv, 2.0));
    return texture2D(tBehind, clamp(uv, 0.001, 0.999)).rgb;
  }

  const float R_IN = 2.6;      // rs, inner edge of the disk
  const float BOUND = 55.0;    // rs, the mesh this is drawn on

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }

  /**
   * The same, repeating every "period" cells across x.
   *
   * The disk's structure is sampled in azimuth, and azimuth wraps: where atan
   * comes back round it jumps from +pi to -pi, and an ordinary lattice returns
   * a different cell either side of a line that is not there. It showed as a
   * seam running straight out from the shadow across every ring, the one place
   * the disk did not look like one piece. Wrapping the lattice instead of the
   * coordinate keeps the bands continuous all the way round, and leaves the
   * pattern free to shear with the orbital motion.
   */
  float ringNoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x0 = mod(i.x, period);
    float x1 = mod(i.x + 1.0, period);
    return mix(
      mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), f.x),
      mix(hash(vec2(x0, i.y + 1.0)), hash(vec2(x1, i.y + 1.0)), f.x),
      f.y);
  }

  /**
   * Colour of a blackbody at a given temperature. Helland's fit to the
   * Planckian locus, which holds from about 1000 K to 40000 K.
   */
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 255.0 : 329.7 * pow(t - 60.0, -0.1332);
    float g = t <= 66.0 ? 99.47 * log(t) - 161.1 : 288.1 * pow(t - 60.0, -0.0755);
    float b = t >= 66.0 ? 255.0 : (t <= 19.0 ? 0.0 : 138.5 * log(t - 10.0) - 305.0);
    return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  }

  /**
   * Disk emission at one crossing.
   *
   * Temperature follows the standard thin-disk profile, falling off as the
   * three-quarter power of radius. Where that profile starts is set by the
   * hole's mass, and it is the only reason two holes look different from each
   * other: a stellar-mass disk runs hot enough to be blue-white from its inner
   * edge to its rim, while a supermassive one is cool enough to keep amber at
   * the outside. See the temperatures worked out in the constructor.
   */
  vec3 diskColour(float rho, float shift) {
    float ramp = pow(clamp(R_IN / max(rho, R_IN), 0.0, 1.0), 0.75);
    float kelvin = mix(uRimTempK, uCoreTempK, pow(ramp, 1.6)) * shift;
    vec3 c = blackbody(kelvin);
    // The tone curve pulls bright colours towards white; this puts back what
    // it takes, so a 4000 K rim still reads as amber once it is exposed.
    c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.45), 0.0);
    if (uTint > 0.0) {
      // The palette, still shifted bluer where the gas comes towards you and
      // redder where it goes away, so the beaming reads the same.
      vec3 pal = mix(uOuter, uInner, pow(ramp, 1.3));
      vec3 dop = blackbody(6500.0 * shift) / vec3(1.0, 0.97, 0.94);
      c = mix(c, pal * mix(vec3(1.0), dop, 0.55), uTint);
    }
    // Hotter annuli are brighter too. Stefan-Boltzmann's fourth power would
    // leave nothing visible but the innermost ring, so this is much gentler.
    return c * (0.22 + 1.6 * ramp * ramp * ramp);
  }

  void main() {
    float rs = uRs;
    vec3 ro = uCameraLocal / rs;         // everything in units of rs
    vec3 rd = normalize(vLocal - uCameraLocal);

    // Start at the camera when it is already inside the bounding sphere, and at
    // the near intersection when it is outside. Getting this wrong is invisible
    // from a distance and hides the entire disk from close up, because the ray
    // begins on the far side and marches away.
    float bDot = dot(ro, rd);
    float disc = bDot * bDot - (dot(ro, ro) - BOUND * BOUND);
    if (disc < 0.0) discard;
    float root = sqrt(disc);
    float tStart = max(-bDot - root, 0.0);
    vec3 p = ro + rd * tStart;
    vec3 rd0 = rd;

    // Conserved along the geodesic, so it is computed once rather than per step.
    float h2 = dot(cross(p, rd), cross(p, rd));

    vec3 colour = vec3(0.0);
    float alpha = 0.0;
    bool captured = false;

    for (int i = 0; i < ${platform.blackHoleSteps}; i++) {
      float r = length(p);
      if (r < 1.0) { captured = true; break; }
      if (r > BOUND * 1.2 && dot(p, rd) > 0.0) break;

      // Short steps where the path curves, long ones where it does not. A fixed
      // step either misses the photon ring or spends a hundred iterations
      // crossing empty space to reach it.
      float step = clamp(0.055 * r * r / max(r - 0.9, 0.35), 0.035, 1.6);
      vec3 next = p + rd * step;
      rd = normalize(rd - 1.5 * h2 * p / pow(dot(p, p), 2.5) * step);

      // Disk crossing, found by the sign change of the height above its plane.
      if (p.y * next.y < 0.0) {
        vec3 hit = mix(p, next, p.y / (p.y - next.y));
        float rho = length(hit.xz);
        if (rho > R_IN && rho < uDiskOut) {
          float phi = atan(hit.z, hit.x);
          // Keplerian shear: the inner disk laps the outer one, which is what
          // stops the pattern from turning as a rigid wheel.
          float omega = 0.7 / pow(rho, 1.5);
          float u = phi / 6.2831853 + uTime * omega;
          // Turbulence in log-radius, wound into trailing spirals by the same
          // shear: long thin filaments rather than the concentric grooves of a
          // record, which is what a disk looks like when its structure is
          // drawn as rings.
          float lr = log(rho);
          float wind = lr * 5.5;
          float fil = ringNoise(vec2(u * 12.0 + wind * 2.0, lr * 6.0), 12.0) * 0.5
                    + ringNoise(vec2(u * 28.0 + wind * 4.7, lr * 15.0), 28.0) * 0.3
                    + ringNoise(vec2(u * 64.0 + wind * 10.8, lr * 34.0), 64.0) * 0.2;
          fil = smoothstep(0.15, 0.95, fil);
          float dens = smoothstep(uDiskOut, uDiskOut * 0.35, rho)
                     * smoothstep(R_IN * 0.92, R_IN * 1.25, rho)
                     * (0.45 + 0.85 * fil);

          // Orbital speed as a fraction of c for a circular orbit, and the
          // beaming it produces. This is the asymmetry that makes one side of
          // the ring far brighter than the other, and it is the single most
          // recognisable thing about the picture.
          float beta = min(sqrt(0.5 / rho), 0.72);
          vec3 vhat = normalize(vec3(-hit.z, 0.0, hit.x)) * sign(uSpin + 0.001);
          float mu = dot(vhat, -rd);
          float boost = 1.0 / pow(max(1.0 - beta * mu, 0.12), 3.0);
          // Light climbing out of the well arrives redder and fainter.
          float grav = sqrt(max(1.0 - 1.0 / rho, 0.02));
          float g = clamp(boost * grav, 0.05, 5.5);
          // The observed temperature is the emitted one times the frequency
          // shift, so the approaching side is bluer as well as brighter and
          // the receding side goes amber.
          float shift = clamp(pow(boost, 1.0 / 3.0) * grav, 0.35, 2.2);

          // The beamed inner edge runs well past one and blooms; the rim stays
          // under it, so the temperature gradient survives the tone curve
          // instead of the whole annulus saturating to one white smear.
          vec3 emit = diskColour(rho, shift) * dens * g * uBrightness * 0.6;
          colour += emit * (1.0 - alpha);
          alpha += clamp(dens * 0.7, 0.0, 1.0) * (1.0 - alpha);
        }
        // The torus: cool dust and gas beyond the disk, glowing dull red or
        // violet in the light of the hot centre, clumped rather than smooth.
        float edge = rho / uDiskOut;
        if (edge > 0.75 && edge < 1.9 && dot(uTorus, uTorus) > 0.0) {
          float phi = atan(hit.z, hit.x);
          float u = phi / 6.2831853 + uTime * 0.7 / pow(rho, 1.5);
          float clump = ringNoise(vec2(u * 18.0 + log(rho) * 6.0, log(rho) * 9.0), 18.0) * 0.6
                      + ringNoise(vec2(u * 44.0, log(rho) * 22.0), 44.0) * 0.4;
          float band = smoothstep(0.75, 1.05, edge) * smoothstep(1.9, 1.25, edge) * smoothstep(0.25, 0.85, clump);
          colour += uTorus * band * 0.35 * uBrightness * (1.0 - alpha);
          alpha += band * 0.25 * (1.0 - alpha);
        }
      }

      // Bipolar jet. Drawn as a hollow cone rather than a filled one: a real
      // jet is a sheath around a faster spine, so it is brightest at its walls,
      // and drawing it solid gives two searchlight beams instead.
      if (uJet > 0.5) {
        float height = abs(p.y);
        float rho = length(p.xz);
        // Opening angle of about four degrees, widening slowly with height.
        float wall = 0.055 * height + 0.5;
        float across = rho / max(wall, 1e-4);
        float sheath = exp(-pow((across - 0.72) * 2.6, 2.0)) + 0.35 * exp(-pow(across * 2.2, 2.0));
        float along = smoothstep(1.2, 4.0, height) * exp(-height / 26.0);
        float flicker = 0.7 + 0.3 * noise(vec2(height * 0.5 - uTime * 1.1, rho * 0.8));
        float jet = sheath * along * flicker;
        if (jet > 0.001) {
          colour += uJetColour * jet * 0.28 * sqrt(uBrightness) * step * (1.0 - alpha);
          alpha += jet * step * 0.02 * (1.0 - alpha);
        }
      }

      p = next;
    }

    // The march stops at the bounding sphere, where a real ray is still bent by
    // a couple of degrees; easing the bend to nothing towards the edge keeps the
    // lensed image continuous with the unlensed sky around it.
    float lensing = uLens * smoothstep(BOUND * 0.92, BOUND * 0.45, sqrt(h2));

    if (captured) {
      // Anything in front of the hole is still seen; the horizon behind it is
      // not, so this is opaque black plus whatever the ray picked up on the way.
      gl_FragColor = vec4(colour, 1.0);
    } else if (lensing > 0.001) {
      vec3 bg = behind(normalize(mix(rd0, rd, lensing)));
      gl_FragColor = vec4(colour + bg * (1.0 - clamp(alpha, 0.0, 1.0)), 1.0);
    } else {
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
    }
    #include <logdepthbuf_fragment>
  }
`;

const GLARE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uScale;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centre.xy += position.xy * uScale;
    gl_Position = projectionMatrix * centre;

    #include <logdepthbuf_vertex>
  }
`;

const GLARE_FRAGMENT = /* glsl */ `
  precision highp float;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColour;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    float d = length(vUv);
    if (d >= 1.0) discard;

    #include <logdepthbuf_fragment>

    // A saturated core inside a broad faint halo: the shape a bright point
    // takes in any real optic.
    float glow = exp(-d * 7.0) * 0.9 + exp(-d * 1.7) * 0.2;
    glow *= pow(1.0 - d, 1.5);
    gl_FragColor = vec4(uColour * uIntensity * glow, 1.0);
  }
`;

const JET_VERTEX = /* glsl */ `
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

const JET_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColour;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uSeed;
  varying float vAlong;
  varying float vFacing;
  float hash(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
  float noise(float x) {
    float i = floor(x), f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  void main() {
    // Brightest at the base, knotted along its length where shocks run out
    // through it, and a hot spot where it ends against the gas outside.
    float fall = pow(1.0 - vAlong, 1.6) * 0.8 + 0.2 * exp(-pow((vAlong - 0.97) * 30.0, 2.0)) * 6.0;
    float knots = 0.55 + 0.9 * pow(noise(vAlong * 38.0 - uTime * 0.05), 3.0);
    float sheath = 0.3 + 0.7 * pow(1.0 - vFacing, 2.0);
    float fade = smoothstep(0.0, 0.003, vAlong) * smoothstep(1.0, 0.985, vAlong);
    gl_FragColor = vec4(uColour * fall * knots * sheath * fade * uIntensity * 0.6, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

/** Stars in the swarm round a supermassive hole. */
export const ORBITING_STARS = 120;

/** G times a solar mass, km³ s⁻². */
const GM_SUN_KM3S2 = 1.32712440018e11;

const PALETTE_NAMES = Object.keys(HOLE_PALETTES);

function hashKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Orbit axes in the disk's plane, which is the hole frame's xz. */
function discBasis() {
  return [[1, 0, 0], [0, 0, 1]];
}

/** Two perpendicular unit vectors in a random plane. */
function randomBasis(rnd) {
  const z = rnd() * 2 - 1;
  const phi = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  const n = new Vector3(s * Math.cos(phi), z, s * Math.sin(phi));
  const p = new Vector3(1, 0, 0).cross(n);
  if (p.lengthSq() < 1e-6) p.set(0, 1, 0).cross(n);
  p.normalize().applyAxisAngle(n, rnd() * Math.PI * 2);
  const q = new Vector3().crossVectors(n, p);
  return [p.toArray(), q.toArray()];
}

const mixColour = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Solar luminosities a hole of this mass puts out accreting at its limit. */
function eddingtonLuminositySol(massSol) {
  return 3.2e4 * massSol;
}

export class BlackHole {
  constructor(spec) {
    this.spec = spec;
    this.rs = schwarzschildKm(spec.massSol);
    this.radius = this.rs;
    // Thin-disk temperature at the inner edge goes as the inverse fourth root
    // of mass for an Eddington-fed hole: around ten million kelvin for a
    // stellar-mass one, tens of thousands for the largest. All of that is past
    // blue-white and off the end of what a screen can show, so what is kept
    // here is the ordering rather than the absolute value — the smallest holes
    // come out blue-white throughout, the largest keep an amber rim.
    const hot = Math.pow(21 / Math.max(spec.massSol, 1), 0.25) ** 0.55 * (spec.tempScale ?? 1);
    this.coreTempK = 4600 + 6500 * hot;
    this.rimTempK = 1700 + 1700 * hot;
    this.outerKm = this.rs * 55;
    this.world = blackHoleWorld(spec);
    this.group = new Group();
    this.group.rotateX(((spec.inclinationDeg ?? 70) * Math.PI) / 180);
    this.group.updateMatrix();

    // A generated hole picks a look of its own from its key, so the holes of
    // invented galaxies are not all the one amber.
    const paletteName = spec.palette ?? PALETTE_NAMES[hashKey(spec.key ?? '') % PALETTE_NAMES.length];
    const palette = HOLE_PALETTES[paletteName] ?? HOLE_PALETTES.thermal;
    // Synchrotron blue, with a little of the disk's colour in it.
    const jetColour = palette.tint > 0 ? mixColour(palette.outer, [0.45, 0.7, 1.4], 0.8) : [0.55, 0.78, 1.3];

    const geometry = new SphereGeometry(this.outerKm, 48, 32);
    geometry.boundingSphere = new Sphere(new Vector3(), this.outerKm);
    this.material = new ShaderMaterial({
      uniforms: {
        uCameraLocal: { value: new Vector3(0, 0, this.rs * 20) },
        uRs: { value: this.rs },
        uTime: { value: 0 },
        uSpin: { value: spec.spin ?? 0.8 },
        uJet: { value: spec.jet ?? 0 },
        uBrightness: { value: spec.brightness ?? 1 },
        uCoreTempK: { value: this.coreTempK },
        uRimTempK: { value: this.rimTempK },
        uDiskOut: { value: spec.diskOuterRs ?? 24 },
        uInner: { value: new Vector3(...palette.inner) },
        uOuter: { value: new Vector3(...palette.outer) },
        uTint: { value: palette.tint },
        uTorus: { value: new Vector3(...(palette.torus ?? [0, 0, 0])) },
        uJetColour: { value: new Vector3(...jetColour) },
        tBehind: { value: null },
        uLens: { value: 0 },
        uLocalToView: { value: new Matrix3() },
        uProjection: { value: new Matrix4() },
      },
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    // Drawn in a pass of its own after everything else, from a copy of the
    // frame without it; see the lensing pass in space.js.
    this.mesh.layers.set(BLACK_HOLE_LAYER);
    const modelView = new Matrix4();
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      const u = this.material.uniforms;
      modelView.multiplyMatrices(camera.matrixWorldInverse, this.mesh.matrixWorld);
      u.uLocalToView.value.setFromMatrix4(modelView);
      u.uProjection.value.copy(camera.projectionMatrix);
    };
    this.group.add(this.mesh);

    /*
     * What the hole looks like from far enough away to be a point.
     *
     * The ray-marched volume stops at 55 Schwarzschild radii, which for a
     * stellar-mass hole is a few thousand kilometres: from the worlds put in
     * orbit around Cygnus X-1, a couple of hundred au out, it covers a
     * ten-millionth of a pixel and nothing is drawn at all. But an accreting
     * hole is one of the brightest things there is, so at that range it should
     * be the brightest point in their sky, not an absence.
     */
    this.glareMaterial = new ShaderMaterial({
      uniforms: {
        uColour: { value: new Color(1, 0.93, 0.86) },
        uIntensity: { value: 0 },
        uScale: { value: this.outerKm },
      },
      vertexShader: GLARE_VERTEX,
      fragmentShader: GLARE_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.glare = new Mesh(new PlaneGeometry(2, 2), this.glareMaterial);
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 20;
    this.group.add(this.glare);
    // A quasar outshines its whole galaxy; a starved hole puts out next to
    // nothing and is found only by its lensing.
    this.luminositySol = eddingtonLuminositySol(spec.massSol) * (spec.brightness ?? 1) ** 2
      * (spec.activity === 'Quasar' ? 40 : 1);

    this.jets = spec.jet && spec.jetPc ? this._buildJets(spec, jetColour) : null;
    this.orbiters = this._buildOrbiters(spec);
  }

  /**
   * The jets past the volume's edge, out to the lobes: a quasar's run for
   * thousands of parsecs, a microquasar's for a fraction of one. They carry
   * on from where the ray-marched sheath stops, at the same width.
   */
  _buildJets(spec, colour) {
    const startKm = this.rs * 40;
    const lengthKm = Math.max(spec.jetPc * PC_KM, startKm * 4);
    const baseKm = this.rs * 2.7;
    const endKm = baseKm + lengthKm * 0.012;
    const geometry = new CylinderGeometry(endKm, baseKm, lengthKm, 24, 1, true);
    geometry.translate(0, startKm + lengthKm / 2, 0);
    const material = new ShaderMaterial({
      vertexShader: JET_VERTEX,
      fragmentShader: JET_FRAGMENT,
      uniforms: {
        uColour: { value: new Vector3(...colour) },
        uIntensity: { value: 1 },
        uTime: { value: 0 },
        uSeed: { value: (hashKey(spec.key) % 997) / 97 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const group = new Group();
    for (const sign of [1, -1]) {
      const jet = new Mesh(geometry, material);
      if (sign < 0) jet.rotation.x = Math.PI;
      jet.frustumCulled = false;
      jet.renderOrder = 5;
      group.add(jet);
    }
    this.group.add(group);
    return { group, material, lengthKm };
  }

  /**
   * What goes round it. A supermassive hole has a swarm of stars on steep
   * eccentric orbits, the way the S-stars go round Sagittarius A*; a
   * stellar-mass one has the star it was found by. Kepler orbits, followed in
   * the simulation's time, so speeding the clock up sets them going.
   */
  _buildOrbiters(spec) {
    const rnd = seeded(hashKey(spec.key ?? 'hole'));
    const orbits = [];
    const gm = spec.massSol * GM_SUN_KM3S2;
    if (spec.companion) {
      const c = spec.companion;
      const a = c.sepAu * AU_KM;
      orbits.push({ a, e: 0.02, M0: rnd() * 6.283, n: Math.sqrt(gm / a ** 3), basis: discBasis(), teff: c.teff, lum: c.lum });
    } else if (spec.massSol > 1e5) {
      for (let i = 0; i < ORBITING_STARS; i++) {
        // A few hundred to forty thousand horizon radii, log-uniform, and as
        // eccentric as the S-stars, with no orbit diving inside the disk.
        const a = this.rs * 400 * 100 ** rnd();
        const e = Math.min(Math.sqrt(rnd()) * 0.97, 1 - (this.rs * 60) / a);
        const early = rnd() < 0.7;
        orbits.push({
          a,
          e: Math.max(e, 0),
          M0: rnd() * 6.283,
          n: Math.sqrt(gm / a ** 3),
          basis: randomBasis(rnd),
          teff: early ? 14000 + rnd() * 16000 : 3800 + rnd() * 1200,
          lum: early ? 10 ** (3 + rnd() * 1.5) : 10 ** (2 + rnd()),
        });
      }
    }
    if (!orbits.length) return null;
    const n = orbits.length;
    const positions = new Float32Array(n * 3);
    const colours = new Float32Array(n * 3);
    const lum = new Float32Array(n);
    orbits.forEach((o, i) => {
      const [r, g, b] = starColour(o.teff);
      colours.set([r, g, b], i * 3);
      lum[i] = o.lum;
    });
    const geometry = new BufferGeometry();
    const position = new Float32BufferAttribute(positions, 3);
    position.setUsage(35048);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    geometry.setAttribute('lum', new Float32BufferAttribute(lum, 1));
    // A lone companion is the brightest thing in its sky and keeps its glare.
    const material = spec.companion ? starPointsMaterial() : starPointsMaterial({ maxFlux: 60, maxSize: 11 });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 3;
    // In the hole's own frame, scaled so the positions stay small numbers.
    const holder = new Group();
    holder.scale.setScalar(this.rs);
    holder.add(points);
    this.group.add(holder);
    const reach = Math.max(...orbits.map((o) => o.a * (1 + o.e)));
    return { orbits, points, position, material, reach };
  }

  _placeOrbiters(simSeconds) {
    const { orbits, position } = this.orbiters;
    const arr = position.array;
    const inv = 1 / this.rs;
    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i];
      // Mean anomaly wrapped before it reaches a float, then Kepler's
      // equation by Newton's method.
      const M = (o.M0 + ((o.n * simSeconds) % 6.283185307179586)) % 6.283185307179586;
      let E = o.e < 0.8 ? M : Math.PI;
      for (let k = 0; k < 8; k++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
      const x = o.a * (Math.cos(E) - o.e) * inv;
      const y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E) * inv;
      const [P, Q] = o.basis;
      arr[i * 3] = P[0] * x + Q[0] * y;
      arr[i * 3 + 1] = P[1] * x + Q[1] * y;
      arr[i * 3 + 2] = P[2] * x + Q[2] * y;
    }
    position.needsUpdate = true;
  }

  /** Hands the shader the frame drawn before it, to bend. */
  setBehind(texture) {
    this.material.uniforms.tBehind.value = texture;
    this.material.uniforms.uLens.value = texture ? 1 : 0;
  }

  /**
   * A world-frame direction to approach from: twelve degrees above the disk,
   * which is where the lensed arc over the shadow is widest.
   */
  viewDirection(out = new Vector3()) {
    const tilt = (12 * Math.PI) / 180;
    return out
      .set(Math.cos(tilt), Math.sin(tilt), 0.35 * Math.cos(tilt))
      .applyQuaternion(this.group.quaternion)
      .normalize();
  }

  update({ cameraLocal, time, simSeconds = 0, visible = true, pixelsPerRadian = 0, pixelRatio = 1, exposure = 1 }) {
    this.material.uniforms.uCameraLocal.value.copy(cameraLocal);
    this.material.uniforms.uTime.value = time;
    this.group.visible = visible;

    const distanceKm = Math.max(cameraLocal.length(), 1);
    if (this.jets) {
      // Out of sight once the whole jet is under a pixel long.
      this.jets.group.visible = (this.jets.lengthKm / distanceKm) * pixelsPerRadian > 1;
      this.jets.material.uniforms.uTime.value = time;
      this.jets.material.uniforms.uIntensity.value = Math.sqrt(this.spec.brightness ?? 1);
    }
    if (this.orbiters) {
      const near = distanceKm < this.orbiters.reach * 400;
      this.orbiters.points.visible = near;
      if (near && visible) {
        this._placeOrbiters(simSeconds);
        this.orbiters.material.uniforms.uGain.value = 1.17 * 4 * exposure;
        this.orbiters.material.uniforms.uPixelRatio.value = pixelRatio;
      }
    }
    const volumePixels = pixelsPerRadian ? (this.outerKm / distanceKm) * pixelsPerRadian * 2 : Infinity;
    // Handed over between four and fourteen pixels, so the point does not sit
    // on top of a disk that has become big enough to draw itself.
    // Under a pixel the volume is nothing but a smear the size of its own
    // glow halo, which from another galaxy put a lamp where Sagittarius A* is.
    this.mesh.visible = volumePixels > 0.5;
    const point = (1 - clamp((volumePixels - 4) / 10, 0, 1)) * pointVisibility(this.luminositySol, distanceKm);
    this.glare.visible = point > 0.01;
    if (!this.glare.visible) return;
    const au = distanceKm / AU_KM;
    const glare = pointGlare((this.luminositySol / Math.max(au * au, 1e-9)) * exposure);
    // Twice a star's glare: an accreting hole is the brightest thing in any
    // sky it is in, and from its own system's planets it should read so.
    this.glareMaterial.uniforms.uScale.value = (glare.pixels * 2 * distanceKm) / (2 * pixelsPerRadian);
    this.glareMaterial.uniforms.uIntensity.value = glare.intensity * point;
  }
}
