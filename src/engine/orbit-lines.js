import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineLoop, Vector3 } from 'three';
import { dateToJulianDay, J2000 } from '../astro.js';
import { heliocentric, PLANETS } from '../solar.js';
import { exoOrbit, moonOrbit, orbitPath } from './kepler.js';

const AU_KM = 149597870.7;
const SEGMENTS = 360;

/**
 * Orbit paths, drawn as loops relative to whatever each body goes round.
 *
 * Solar System planets are traced through their own osculating elements over
 * one period, so the ellipses are the real ones, eccentric and inclined; moons
 * and the planets of other stars are drawn from the same Kepler ellipses they
 * are moved along.
 * Each loop is positioned on its parent every frame, by the same floating
 * origin as the bodies, and stays in single precision only relative to it.
 */
export function createOrbitLines() {
  const group = new Group();
  group.name = 'orbit-lines';
  group.visible = false;
  const planetMaterial = new LineBasicMaterial({
    color: 0x5a8fd8, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false,
  });
  const moonMaterial = new LineBasicMaterial({
    color: 0x4f7a9a, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false,
  });
  /** @type {{line: LineLoop, parentKey: string, frameKey: string | null, world: () => Vector3}[]} */
  let solar = [];
  let exo = [];
  let solarBuiltAt = -Infinity;
  let exoFor = null;

  const loop = (points, material) => {
    const array = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      array[i * 3] = p.x;
      array[i * 3 + 1] = p.y;
      array[i * 3 + 2] = p.z;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(array, 3));
    const line = new LineLoop(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 3;
    group.add(line);
    return line;
  };
  const ellipse = (orbit, tilt = null) => {
    const points = orbitPath(orbit, SEGMENTS, () => new Vector3());
    if (tilt) for (const p of points) p.applyQuaternion(tilt);
    return points;
  };
  const clear = (list) => {
    for (const item of list) {
      item.line.geometry.dispose();
      item.line.removeFromParent();
    }
  };

  function buildSolar(universe, date) {
    clear(solar);
    solar = [];
    const T = (dateToJulianDay(date) - J2000) / 36525;
    for (const [key, planet] of Object.entries(PLANETS)) {
      if (!universe.get(key)) continue;
      const periodCenturies = 360 / Math.max(planet.rates[3], 1e-6);
      const points = [];
      for (let k = 0; k < SEGMENTS; k++) {
        const h = heliocentric(planet, T + (k / SEGMENTS) * periodCenturies);
        points.push(new Vector3(h.x * AU_KM, h.z * AU_KM, -h.y * AU_KM));
      }
      solar.push({ line: loop(points, planetMaterial), parentKey: 'sun', frameKey: null });
    }
    for (const state of universe.states.values()) {
      const spec = state.spec;
      if (!spec.orbitKm || spec.parent === 'sun') continue;
      const parent = universe.get(spec.parent);
      if (!parent) continue;
      solar.push({
        line: loop(ellipse(moonOrbit(spec), parent.tilt), moonMaterial),
        parentKey: spec.parent,
        frameKey: spec.parent,
      });
    }
  }

  function buildExo(system) {
    clear(exo);
    exo = [];
    exoFor = system;
    if (!system) return;
    for (const item of system.planets) {
      exo.push({
        line: loop(ellipse(exoOrbit(item.spec)), planetMaterial),
        body: null,
        frameKey: system.key,
      });
      for (const moon of item.moons) {
        exo.push({
          line: loop(ellipse(moonOrbit(moon.spec)), moonMaterial),
          body: item,
          frameKey: item.spec.key,
        });
      }
    }
  }

  return {
    group,
    /**
     * @param {object} o
     * @param {boolean} o.visible
     * @param {(object: object, world: Vector3, key?: string) => void} o.place floating-origin placement
     */
    update({ visible, universe, date, exoSystem, place, nearHome }) {
      group.visible = visible;
      if (!visible) return;
      // Elements drift over centuries; a rebuild every simulated decade is plenty.
      if (Math.abs(date.getTime() - solarBuiltAt) > 3.15e11) {
        buildSolar(universe, date);
        solarBuiltAt = date.getTime();
      }
      if (exoFor !== exoSystem) buildExo(exoSystem);
      for (const item of solar) {
        item.line.visible = nearHome;
        if (nearHome) place(item.line, universe.get(item.parentKey).position, item.frameKey);
      }
      for (const item of exo) {
        const world = item.body ? item.body.world : exoSystem.position;
        item.line.visible = Boolean(world);
        if (world) place(item.line, world, item.frameKey);
      }
    },
  };
}
