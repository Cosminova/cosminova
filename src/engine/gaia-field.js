import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import { STAR_FRAGMENT, STAR_VERTEX } from './deep-field.js';
import { equatorialToEcliptic, PC_KM } from './units.js';

/**
 * A million-odd real stars from Gaia DR3, fainter than the HYG catalogue the
 * deep field draws. See scripts/fetch-gaia.mjs for what is in the file.
 *
 * The deep field rewrites camera-relative positions on the CPU every frame,
 * which is fine for a hundred thousand stars and not for a million. Here the
 * positions live on the GPU, relative to the Sun, and the vertex shader takes
 * the camera off them. A float32 position at a few hundred parsecs is good to
 * a few astronomical units, which at the distance any of these is ever seen
 * from is far below a pixel.
 */

const GAIA_VERTEX = STAR_VERTEX
  .replace('uniform float hideInsideKm;', 'uniform float hideInsideKm;\n  uniform vec3 uCameraWorld;')
  .replace('void main() {', 'void main() {\n    vec3 fromCamera = position - uCameraWorld;')
  .replace('float dist = length(position);', 'float dist = length(fromCamera);')
  .replace('vec4(position, 1.0)', 'vec4(fromCamera, 1.0)');

const INDEX_CELL_PC = 25;

export async function loadGaiaCatalog(base = './data') {
  try {
    const [meta, buffer] = await Promise.all([
      fetch(`${base}/stars-gaia.meta.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/stars-gaia.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
    ]);
    if (!meta || !buffer || buffer.byteLength < meta.count * 8) return null;
    return { meta, buffer };
  } catch {
    return null;
  }
}

function octDecode(u, v, out) {
  let x = (u / 65535) * 2 - 1;
  let z = (v / 65535) * 2 - 1;
  let y = 1 - Math.abs(x) - Math.abs(z);
  if (y < 0) {
    const ox = (1 - Math.abs(z)) * Math.sign(x || 1);
    const oz = (1 - Math.abs(x)) * Math.sign(z || 1);
    x = ox;
    z = oz;
  }
  return out.set(x, y, z).normalize();
}

export class GaiaField {
  constructor({ meta, buffer }, { colorLookup, starMaterial, limit }) {
    const view = new DataView(buffer);
    const { LOG_MIN, LOG_MAX, MAG_MIN, MAG_STEPS, BV_MIN, BV_STEPS } = meta.encoding;
    // Brightest first in the file, so a device that cannot afford all of them
    // keeps the ones that matter.
    const count = Math.min(meta.count, limit ?? meta.count);
    this.count = count;
    this.position = new Float32Array(count * 3);
    this.absMag = new Float32Array(count);
    this.bv = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const dir = new Vector3();
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      octDecode(view.getUint16(o, true), view.getUint16(o + 2, true), dir);
      equatorialToEcliptic(dir);
      const logPc = LOG_MIN + (view.getUint16(o + 4, true) / 65535) * (LOG_MAX - LOG_MIN);
      const pc = 10 ** logPc;
      const v = MAG_MIN + view.getUint8(o + 6) / MAG_STEPS;
      const bv = BV_MIN + view.getUint8(o + 7) / BV_STEPS;
      const km = pc * PC_KM;
      this.position[i * 3] = dir.x * km;
      this.position[i * 3 + 1] = dir.y * km;
      this.position[i * 3 + 2] = dir.z * km;
      this.absMag[i] = v - 5 * Math.log10(pc) + 5;
      this.bv[i] = bv;
      colorLookup.sample(bv, colors, i * 3);
    }

    this.material = new ShaderMaterial({
      uniforms: { ...starMaterial.uniforms, uCameraWorld: { value: new Vector3() } },
      vertexShader: GAIA_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    this.magAttr = new BufferAttribute(this.absMag, 1);
    geometry.setAttribute('absMag', this.magAttr);
    geometry.setAttribute('starColor', new BufferAttribute(colors, 3));
    geometry.computeBoundingSphere = () => {};
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this._index = null;
    this._hidden = -1;
  }

  update(cameraWorld) {
    this.material.uniforms.uCameraWorld.value.copy(cameraWorld);
  }

  /**
   * Cell index for nearest-star lookups, built on first use: stars bucketed by
   * a hash of their 25-parsec cell with a counting sort, which is linear in the
   * star count. A comparison sort of a million entries took a third of a
   * second, and a map of a million small arrays is a lot of garbage for a
   * lookup that runs four times a second.
   */
  _buildIndex() {
    const n = this.count;
    const buckets = 1 << 20;
    const mask = buckets - 1;
    const s = INDEX_CELL_PC * PC_KM;
    const bucket = new Uint32Array(n);
    const start = new Uint32Array(buckets + 1);
    for (let i = 0; i < n; i++) {
      const b = cellHash(this.position[i * 3] / s, this.position[i * 3 + 1] / s, this.position[i * 3 + 2] / s) & mask;
      bucket[i] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < buckets; b++) start[b + 1] += start[b];
    const fill = start.slice(0, buckets);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[fill[bucket[i]]++] = i;
    this._index = { start, order, mask };
  }

  nearest(world, maxKm = 5 * PC_KM) {
    if (!this.count) return null;
    if (!this._index) this._buildIndex();
    const { start, order, mask } = this._index;
    const s = INDEX_CELL_PC * PC_KM;
    const ci = Math.floor(world.x / s);
    const cj = Math.floor(world.y / s);
    const ck = Math.floor(world.z / s);
    let best = -1;
    let bestD2 = maxKm * maxKm;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let k = ck - 1; k <= ck + 1; k++) {
          // Hash collisions only add candidates; the distance test sorts them out.
          const b = cellHash(i, j, k) & mask;
          for (let p = start[b], end = start[b + 1]; p < end; p++) {
            const q = order[p];
            const dx = this.position[q * 3] - world.x;
            const dy = this.position[q * 3 + 1] - world.y;
            const dz = this.position[q * 3 + 2] - world.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = q;
            }
          }
        }
      }
    }
    if (best < 0) return null;
    return {
      index: best,
      absMag: this.absMag[best],
      bv: this.bv[best],
      world: new Vector3(this.position[best * 3], this.position[best * 3 + 1], this.position[best * 3 + 2]),
      distanceKm: Math.sqrt(bestD2),
    };
  }

  /** Stop drawing one star as a point while its system is drawing it. */
  hide(index) {
    if (index === this._hidden) return;
    if (this._hidden >= 0) this.absMag[this._hidden] = this._hiddenMag;
    this._hidden = index;
    if (index >= 0) {
      this._hiddenMag = this.absMag[index];
      this.absMag[index] = 99;
    }
    this.magAttr.needsUpdate = true;
  }
}

function cellHash(x, y, z) {
  return (Math.imul(Math.floor(x), 73856093) ^ Math.imul(Math.floor(y), 19349663) ^ Math.imul(Math.floor(z), 83492791)) >>> 0;
}
