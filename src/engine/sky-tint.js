import { AdditiveBlending, BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

/**
 * The colour of the sky from inside something luminous.
 *
 * Out between the stars the background is black, but from inside a nebula
 * every direction looks through glowing gas, from inside a globular cluster
 * through the summed light of a million stars, and from the heart of a galaxy
 * through its bulge. The ray-marched cloud draws its own structure; this is
 * the unresolved light under it, so the sky never drops back to black there.
 *
 * Drawn first, behind everything, as a sphere that moves with the camera.
 */
const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform vec3 uCentre;
  uniform float uStrength;
  uniform float uSeed;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
      a += w * noise(p);
      p = p * 2.03 + 0.7;
      w *= 0.5;
    }
    return a;
  }

  void main() {
    vec3 d = normalize(vDir);
    float n = fbm(d * 2.6 + uSeed);
    float m = fbm(d * 5.1 - uSeed * 0.7);
    float toward = 0.5 + 0.5 * dot(d, uCentre);
    vec3 c = mix(uColB, uColA, smoothstep(0.25, 0.75, n + (toward - 0.5) * 0.5));
    c = mix(c, uColC, smoothstep(0.55, 0.85, m) * 0.7);
    c *= (0.35 + 1.1 * n * n) * (0.45 + 0.8 * toward * toward);
    gl_FragColor = vec4(c * uStrength, 1.0);
  }
`;

export class SkyTint {
  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColA: { value: new Vector3() },
        uColB: { value: new Vector3() },
        uColC: { value: new Vector3() },
        uCentre: { value: new Vector3(0, 0, 1) },
        uStrength: { value: 0 },
        uSeed: { value: 0 },
      },
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 32, 16), this.material);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * @param {{strength: number, colours: number[][], centre: Vector3, seed: number} | null} look
   */
  set(look) {
    const u = this.material.uniforms;
    // Eased, so crossing the edge of a cloud does not switch the sky on.
    const target = look?.strength ?? 0;
    u.uStrength.value += (target - u.uStrength.value) * 0.08;
    if (Math.abs(target - u.uStrength.value) < 1e-5) u.uStrength.value = target;
    this.mesh.visible = u.uStrength.value > 1e-4;
    if (!look) return;
    u.uColA.value.set(...look.colours[0]);
    u.uColB.value.set(...look.colours[1]);
    u.uColC.value.set(...look.colours[2]);
    u.uCentre.value.copy(look.centre);
    u.uSeed.value = look.seed;
  }
}
