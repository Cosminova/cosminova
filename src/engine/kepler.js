/**
 * Two-body orbits for the bodies that have no ephemeris of their own: moons
 * and the planets of other stars.
 *
 * Coordinates follow the convention the circular orbits used before, so an
 * orbit with no eccentricity lands exactly where it always did: the orbital
 * plane is x and (sin i, cos i) in y-z, and mean anomaly zero is on +x.
 */

/** Eccentric anomaly for a mean anomaly, by Newton's method. */
export function eccentricAnomaly(meanAnomaly, e) {
  let E = e < 0.8 ? meanAnomaly : Math.PI;
  for (let i = 0; i < 10; i++) {
    const step = (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}

function place(out, a, e, peri, incl, E) {
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const u = x * Math.cos(peri) - y * Math.sin(peri);
  const v = x * Math.sin(peri) + y * Math.cos(peri);
  return out.set(u, v * Math.sin(incl), v * Math.cos(incl));
}

/**
 * Offset from the focus at a mean anomaly.
 * @param {import('three').Vector3} out
 * @param {{a: number, e?: number, peri?: number, incl?: number}} orbit km and radians
 */
export function orbitOffset(out, { a, e = 0, peri = 0, incl = 0 }, meanAnomaly) {
  const ecc = Math.min(Math.max(e, 0), 0.97);
  const E = ecc > 1e-6 ? eccentricAnomaly(meanAnomaly, ecc) : meanAnomaly;
  return place(out, a, ecc, peri, incl, E);
}

/**
 * Points round the whole ellipse, spaced evenly in eccentric anomaly so the
 * tight end of an eccentric orbit is not drawn as a corner.
 */
export function orbitPath({ a, e = 0, peri = 0, incl = 0 }, segments, makeVector) {
  const ecc = Math.min(Math.max(e, 0), 0.97);
  const points = [];
  for (let k = 0; k < segments; k++) {
    points.push(place(makeVector(), a, ecc, peri, incl, (k / segments) * Math.PI * 2));
  }
  return points;
}

/** Measured eccentricities of the Solar System's moons, where they matter. */
const MOON_ECCENTRICITY = {
  moon: 0.0549, phobos: 0.0151, deimos: 0.0003,
  io: 0.0041, europa: 0.009, ganymede: 0.0013, callisto: 0.0074, amalthea: 0.0032, himalia: 0.16,
  mimas: 0.0196, enceladus: 0.0047, tethys: 0.0001, dione: 0.0022, rhea: 0.001, titan: 0.0288,
  hyperion: 0.1230, iapetus: 0.0286, phoebe: 0.1562,
  miranda: 0.0013, ariel: 0.0012, umbriel: 0.0039, titania: 0.0011, oberon: 0.0014,
  triton: 0.000016, nereid: 0.7507, proteus: 0.0005,
  charon: 0.0002, nix: 0.002, hydra: 0.0059,
};

/** The orbit of a moon given by the data files' fields. */
export function moonOrbit(spec) {
  return {
    a: spec.orbitKm,
    // Tides circularise most moons; the few left eccentric are captured ones.
    e: spec.eccentricity ?? MOON_ECCENTRICITY[spec.key] ?? (periFor(`${spec.key}e`) / (Math.PI * 2)) ** 3 * 0.08,
    peri: periFor(spec.key),
    incl: ((spec.orbitInclDeg ?? spec.inclinationDeg ?? 0) * Math.PI) / 180,
  };
}

/** The orbit of a planet of another star. */
export function exoOrbit(spec) {
  return {
    a: spec.orbitKm,
    e: spec.eccentricity ?? 0,
    peri: periFor(spec.key),
    incl: ((spec.tiltDeg * Math.PI) / 180) * 0.15,
  };
}

/** A stable argument of periapsis for a body that has none on record. */
export function periFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}
