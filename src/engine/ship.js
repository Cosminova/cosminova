import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { PC_KM } from './units.js';

/**
 * A ship to fly the universe in.
 *
 * Built in metres and scaled to the kilometres the scene works in. Thirty
 * metres nose to tail: big enough to read as a vessel against a planet,
 * small enough that a moon still dwarfs it.
 *
 * The flight model is a game's, not Newton's. Real ships at real speeds would
 * take forty thousand years to reach the nearest star, so the top speed is
 * tied to how far away the nearest thing is — slow over a surface, a parsec a
 * second between the stars, megaparsecs between galaxies — the way Elite's
 * frame-shift drive does it. What is held to physics is everything else: the
 * star lighting the hull is the star you are near, at its colour, and the
 * speed readout is honest about how many times light speed you are going.
 */

const M = 0.001;
export const SHIP_LENGTH_KM = 30 * M;
const C_KM_S = 299792.458;
const AU_KM = 149597870.7;

const _q = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

function buildModel() {
  const root = new Group();
  const hull = new MeshStandardMaterial({ color: 0xc4c9d1, metalness: 0.55, roughness: 0.38 });
  const dark = new MeshStandardMaterial({ color: 0x2b3038, metalness: 0.4, roughness: 0.6 });
  const accent = new MeshStandardMaterial({ color: 0xd5582b, metalness: 0.3, roughness: 0.5 });
  const glass = new MeshStandardMaterial({
    color: 0x0b1622, metalness: 0.9, roughness: 0.08, emissive: 0x0a2434, emissiveIntensity: 0.6,
  });

  // Fuselage: a lathe from nose (+z) to tail (−z).
  const profile = [
    [0, 15], [0.55, 14.2], [1.3, 11.5], [2.0, 7.5], [2.35, 2.5], [2.45, -5], [2.25, -11.5], [1.85, -14.4], [0, -14.5],
  ].map(([r, z]) => new Vector2(r, z));
  const bodyGeo = new LatheGeometry(profile, 28);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.scale(1, 0.78, -1);
  const body = new Mesh(bodyGeo, hull);
  root.add(body);

  // A dorsal spine and a stripe give the eye something to read the roll by.
  const spine = new Mesh(new BoxGeometry(0.7, 0.6, 14), dark);
  spine.position.set(0, 1.85, -5);
  root.add(spine);
  const stripe = new Mesh(new BoxGeometry(0.25, 0.08, 9), accent);
  stripe.position.set(0, 2.17, -5);
  root.add(stripe);

  const canopy = new Mesh(new SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(1.25, 0.9, 3.2);
  canopy.position.set(0, 1.25, 7);
  root.add(canopy);

  // Swept wings, extruded from a planform.
  const wing = (side) => {
    const s = new Shape();
    const pts = [[1.6, 3.5], [11.5, -6], [11.5, -8.6], [1.6, -10]];
    const ordered = side > 0 ? pts : [...pts].reverse();
    ordered.forEach(([x, z], i) => (i ? s.lineTo(x * side, z) : s.moveTo(x * side, z)));
    const geo = new ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 1 });
    geo.rotateX(Math.PI / 2);
    const mesh = new Mesh(geo, hull);
    mesh.position.y = -0.2;
    return mesh;
  };
  root.add(wing(1), wing(-1));
  const tipMat = (hex) => new MeshBasicMaterial({ color: hex, toneMapped: false });
  const navRed = new Mesh(new SphereGeometry(0.22, 8, 6), tipMat(0xff2a2a));
  navRed.position.set(-11.5, -0.35, -7.3);
  const navGreen = new Mesh(new SphereGeometry(0.22, 8, 6), tipMat(0x2aff5a));
  navGreen.position.set(11.5, -0.35, -7.3);
  root.add(navRed, navGreen);

  // Twin fins, drawn as (chord along z, height) and turned upright.
  for (const side of [1, -1]) {
    const s = new Shape();
    s.moveTo(-7, 0);
    s.lineTo(-13.8, 0);
    s.lineTo(-14.6, 4.4);
    s.lineTo(-12.2, 4.2);
    s.closePath();
    const geo = new ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);
    const fin = new Mesh(geo, dark);
    fin.rotation.z = side * -0.32;
    fin.position.set(side * 1.3, 1.1, 0);
    root.add(fin);
  }

  // Engines: two nacelles with a nozzle each, and a plume that the throttle
  // stretches.
  const plumeMat = new MeshBasicMaterial({
    color: new Color(0.45, 0.8, 1.6), transparent: true, opacity: 0.55, blending: AdditiveBlending,
    depthWrite: false, toneMapped: false, side: DoubleSide,
  });
  const glowMat = new MeshBasicMaterial({ color: new Color(1.4, 2.2, 3.2), toneMapped: false });
  const plumes = [];
  const flare = new Group();
  for (const side of [1, -1]) {
    const nacelle = new Mesh(new CylinderGeometry(1.05, 1.25, 9, 20), dark);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 3.5, -0.4, -9.8);
    root.add(nacelle);
    const ring = new Mesh(new CylinderGeometry(1.3, 1.3, 0.5, 20), hull);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(side * 3.5, -0.4, -6);
    root.add(ring);
    const glow = new Mesh(new CircleGeometry(0.9, 20), glowMat);
    glow.rotation.y = Math.PI;
    glow.position.set(side * 3.5, -0.4, -14.32);
    root.add(glow);
    const plumeGeo = new ConeGeometry(0.85, 1, 16, 1, true);
    plumeGeo.translate(0, -0.5, 0);
    plumeGeo.rotateX(Math.PI / 2);
    const plume = new Mesh(plumeGeo, plumeMat);
    plume.position.set(side * 3.5, -0.4, -14.35);
    flare.add(plume);
    plumes.push(plume);
  }
  root.add(flare);

  // Cockpit interior, only drawn from inside.
  const cockpit = new Group();
  const panel = new MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.85 });
  const dash = new Mesh(new BoxGeometry(2.4, 0.4, 0.8), panel);
  dash.position.set(0, 1.0, 10.0);
  dash.rotation.x = -0.25;
  cockpit.add(dash);
  const screenMat = new MeshBasicMaterial({ color: 0x06090c, toneMapped: false, side: DoubleSide });
  const traceMat = new MeshBasicMaterial({ color: 0x1d5a6e, toneMapped: false, side: DoubleSide });
  for (const x of [-0.62, 0, 0.62]) {
    const screen = new Mesh(new PlaneGeometry(0.42, 0.22), screenMat);
    screen.position.set(x, 1.22, 9.62);
    screen.rotation.x = 0.55;
    cockpit.add(screen);
    for (const [dy, w] of [[0.05, 0.3], [0, 0.22], [-0.05, 0.14]]) {
      const trace = new Mesh(new PlaneGeometry(w, 0.008), traceMat);
      trace.position.set(x - (0.3 - w) / 2, 1.222 + dy * Math.cos(0.55), 9.615 - dy * Math.sin(0.55));
      trace.rotation.x = 0.55;
      cockpit.add(trace);
    }
  }
  // The dash edge catches a little light so it reads as a surface against black space.
  const lip = new Mesh(new BoxGeometry(2.4, 0.015, 0.015), new MeshBasicMaterial({ color: 0x1b2128, toneMapped: false }));
  lip.position.set(0, 1.2, 9.62);
  cockpit.add(lip);
  // A hoop overhead is most of what a pilot sees of their own ship.
  const strut = new MeshStandardMaterial({ color: 0x23272e, metalness: 0.5, roughness: 0.5 });
  const hoop = new Mesh(new BoxGeometry(2.1, 0.08, 0.1), strut);
  hoop.position.set(0, 2.5, 8.9);
  cockpit.add(hoop);
  cockpit.visible = false;
  root.add(cockpit);

  root.scale.setScalar(M);
  return { root, plumes, flare, plumeMat, canopy, cockpit, exterior: [body, spine, stripe, canopy] };
}

/** Streaks that rush past in warp, which is the only way speed is visible in a void. */
function buildStreaks(count = 160) {
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.05 + Math.random() * 0.25;
    seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: (Math.random() * 2 - 1) * 0.6 });
    colors.set([0.55, 0.8, 1, 0.05, 0.08, 0.12], i * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return { lines, seeds, positions, geometry, material };
}

export function formatSpeed(kmS) {
  const v = Math.abs(kmS);
  if (v < 1) return `${(v * 1000).toFixed(0)} m/s`;
  if (v < 1e4) return `${v < 100 ? v.toFixed(1) : v.toFixed(0)} km/s`;
  const c = v / C_KM_S;
  if (c < 1e4) return `${c < 10 ? c.toFixed(2) : c.toFixed(0)} c`;
  const pc = v / PC_KM;
  if (pc < 1e3) return `${pc < 10 ? pc.toFixed(2) : pc.toFixed(0)} pc/s`;
  if (pc < 1e6) return `${(pc / 1e3).toFixed(pc < 1e4 ? 2 : 0)} kpc/s`;
  return `${(pc / 1e6).toFixed(2)} Mpc/s`;
}

export function formatDistance(km) {
  if (km < 1e6) return `${km < 100 ? km.toFixed(1) : km.toFixed(0)} km`;
  if (km < 0.05 * PC_KM) return `${(km / AU_KM).toFixed(km < 10 * AU_KM ? 2 : 0)} au`;
  const pc = km / PC_KM;
  if (pc < 1e3) return `${pc.toFixed(pc < 10 ? 2 : 0)} pc`;
  if (pc < 1e6) return `${(pc / 1e3).toFixed(2)} kpc`;
  return `${(pc / 1e6).toFixed(2)} Mpc`;
}

const HUD_CSS = `
.ship-hud { position: fixed; inset: 0; pointer-events: none; z-index: 5; font: 500 12px/1.3 var(--font-mono, ui-monospace, monospace); color: #bfe6ff; text-shadow: 0 0 6px rgba(0,0,0,.8); }
.ship-hud[hidden] { display: none; }
.ship-hud .reticle { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px; border: 1.5px solid rgba(160,220,255,.55); border-radius: 50%; }
.ship-hud .reticle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: rgba(190,235,255,.85); }
.ship-hud .panel { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 150px); transform: translateX(-50%); display: flex; gap: 18px; align-items: flex-end; padding: 8px 14px; border-radius: 10px; background: rgba(6,12,20,.55); border: 1px solid rgba(140,200,255,.18); backdrop-filter: blur(6px); }
.ship-hud .speed { font-size: 20px; font-weight: 600; min-width: 9ch; text-align: right; color: #e6f6ff; }
.ship-hud .label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .65; }
.ship-hud .throttle { width: 10px; height: 46px; border-radius: 3px; background: rgba(255,255,255,.08); position: relative; overflow: hidden; }
.ship-hud .throttle > i { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(#7fd8ff, #2a7fff); }
.ship-hud .throttle.reverse > i { background: #ff9a5a; }
.ship-hud .warp { color: #7fd8ff; }
.ship-hud .warp.on { color: #fff; text-shadow: 0 0 10px #4fc3ff; }
.ship-hud .near { max-width: 26ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ship-hud .buttons { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 14px); bottom: calc(env(safe-area-inset-bottom, 0px) + 150px); display: flex; flex-direction: column; gap: 8px; pointer-events: auto; }
.ship-hud button { font: inherit; color: inherit; min-width: 64px; min-height: 36px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(140,200,255,.3); background: rgba(6,12,20,.6); cursor: pointer; }
.ship-hud button.on { background: rgba(60,150,255,.35); color: #fff; }
@media (max-width: 680px) {
  .ship-hud .panel { left: auto; right: calc(env(safe-area-inset-right, 0px) + 10px); transform: none; bottom: calc(env(safe-area-inset-bottom, 0px) + 212px); gap: 10px; padding: 6px 10px; }
  .ship-hud .speed { font-size: 16px; min-width: 8ch; }
  .ship-hud .panel .drive { display: none; }
  .ship-hud .near { max-width: 13ch; }
  .ship-hud .buttons { bottom: calc(env(safe-area-inset-bottom, 0px) + 284px); right: calc(env(safe-area-inset-right, 0px) + 10px); }
  .ship-hud button { min-width: 56px; min-height: 32px; padding: 4px 8px; }
}
`;

function buildHud(onView, onWarp, onBrake, touch) {
  const style = document.createElement('style');
  style.textContent = HUD_CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'ship-hud';
  root.hidden = true;
  root.innerHTML = `
    <div class="reticle"></div>
    <div class="panel">
      <div class="throttle"><i></i></div>
      <div><div class="label">Speed</div><div class="speed">0 m/s</div></div>
      <div class="drive"><div class="label">Drive</div><div class="warp">Impulse</div></div>
      <div><div class="label">Nearest</div><div class="near">—</div></div>
    </div>
    <div class="buttons">
      <button type="button" data-act="warp">Warp</button>
      <button type="button" data-act="view">Cockpit</button>
      ${touch ? '<button type="button" data-act="brake">Brake</button>' : ''}
    </div>`;
  document.body.append(root);
  root.querySelector('[data-act="warp"]').addEventListener('click', onWarp);
  root.querySelector('[data-act="view"]').addEventListener('click', onView);
  root.querySelector('[data-act="brake"]')?.addEventListener('click', onBrake);
  return {
    root,
    speed: root.querySelector('.speed'),
    warp: root.querySelector('.warp'),
    near: root.querySelector('.near'),
    bar: root.querySelector('.throttle > i'),
    barBox: root.querySelector('.throttle'),
    warpButton: root.querySelector('[data-act="warp"]'),
    viewButton: root.querySelector('[data-act="view"]'),
  };
}

export class Ship {
  constructor({ touch = false } = {}) {
    const model = buildModel();
    this.model = model;
    this.group = new Group();
    this.group.add(model.root);
    this.group.visible = false;
    this.group.renderOrder = 6;

    this.sunLight = new DirectionalLight(0xffffff, 2.4);
    this.sunLight.target = new Object3D();
    this.group.add(this.sunLight, this.sunLight.target);
    this.fill = new AmbientLight(0x6688aa, 0.16);
    this.group.add(this.fill);

    this.streaks = buildStreaks();
    this.group.add(this.streaks.lines);

    this.hud = buildHud(() => this.toggleView(), () => this.toggleWarp(), () => this.brake(), touch);

    this.active = false;
    this.view = 'chase';
    this.attitude = new Quaternion();
    this.cameraAttitude = new Quaternion();
    this.velocity = new Vector3();
    this.speed = 0;
    this.throttle = 0;
    this.warp = false;
    this.warpLevel = 0;
    this.rates = new Vector3();
    this._steer = new Vector2();
    this._braking = 0;
    this._camRel = new Vector3();
    this._shipOff = new Vector3();
    /** Ship relative to the camera, which is where the model is drawn. */
    this.shipRel = new Vector3();
    this.viewForward = new Vector3(0, 0, 1);
    this.viewUp = new Vector3(0, 1, 0);
    /** Set by the app each frame: distance to the nearest surface, and the interstellar scale. */
    this.surfaceKm = Infinity;
    this.spaceKm = PC_KM;
    this.nearestName = '';
    this.nearestKm = 0;
  }

  /** Take the helm where the camera is, pointing where it points. */
  enter(controls) {
    this.active = true;
    this.group.visible = true;
    this.hud.root.hidden = false;
    const forward = controls._forward.clone().normalize();
    const up = controls._up.clone().normalize();
    const right = new Vector3().crossVectors(up, forward).normalize();
    up.crossVectors(forward, right).normalize();
    // Basis with +z forward, +y up, +x right.
    const m = new Object3D();
    m.up.copy(up);
    m.lookAt(forward);
    this.attitude.copy(m.quaternion);
    this.cameraAttitude.copy(this.attitude);
    this.speed = 0;
    this.throttle = 0;
    this.warp = false;
    this.warpLevel = 0;
    this.velocity.set(0, 0, 0);
    this.rates.set(0, 0, 0);
    // The ship appears ahead of the camera, so the first frame is the chase view
    // with the camera already in place behind it.
    this._camRel.copy(this._chaseOffset(this.attitude, _v));
    this._shipOff.copy(controls.roamOffset).sub(this._camRel);
    this._syncButtons();
  }

  exit() {
    this.active = false;
    this.group.visible = false;
    this.hud.root.hidden = true;
  }

  toggleView() {
    this.view = this.view === 'chase' ? 'cockpit' : 'chase';
    this._syncButtons();
  }

  toggleWarp() {
    this.warp = !this.warp;
    if (this.warp && this.throttle < 0.4) this.throttle = 1;
    this._syncButtons();
  }

  brake() {
    this._braking = 0.6;
    this.throttle = 0;
    this.warp = false;
    this._syncButtons();
  }

  _syncButtons() {
    this.hud.warpButton.classList.toggle('on', this.warp);
    this.hud.viewButton.textContent = this.view === 'chase' ? 'Cockpit' : 'Chase';
  }

  steer(dx, dy) {
    this._steer.x += dx;
    this._steer.y += dy;
  }

  wheel(amount) {
    this.throttle = Math.max(-0.25, Math.min(1, this.throttle - amount * 0.25));
  }

  _chaseOffset(q, out) {
    const L = SHIP_LENGTH_KM;
    return out.set(0, L * 0.62, -L * 2.35).applyQuaternion(q);
  }

  _cockpitOffset(q, out) {
    return out.set(0, 1.95 * M, 7.4 * M).applyQuaternion(q);
  }

  /** How fast full throttle is here, before boost and warp. */
  cruiseSpeed() {
    const ref = Math.min(this.surfaceKm, this.spaceKm);
    return Math.max(ref * 0.75, 0.12);
  }

  /** The camera-controls pilot hook: runs in place of the roam keys. */
  step(dt, controls) {
    dt = Math.min(dt, 0.1);
    const key = (code) => controls.isInputDown(code);
    // The camera is authoritative between frames — the roam anchor can be
    // swapped under it — so the ship is re-derived from where the camera is.
    this._shipOff.copy(controls.roamOffset).sub(this._camRel);

    const yawIn = (key('KeyD') || key('ArrowRight') ? 1 : 0) - (key('KeyA') || key('ArrowLeft') ? 1 : 0);
    const pitchIn = (key('ArrowUp') ? 1 : 0) - (key('ArrowDown') ? 1 : 0);
    const rollIn = (key('KeyE') ? 1 : 0) - (key('KeyQ') ? 1 : 0);
    const agility = this.view === 'cockpit' ? 1.0 : 0.85;
    const k = 1 - Math.exp(-dt * 5);
    this.rates.x += (pitchIn * agility - this.rates.x) * k;
    this.rates.y += (yawIn * agility * 0.8 - this.rates.y) * k;
    this.rates.z += (rollIn * agility * 1.6 - this.rates.z) * k;
    const steerScale = 0.0032;
    const yaw = this.rates.y * dt + this._steer.x * steerScale;
    const pitch = this.rates.x * dt + this._steer.y * steerScale;
    this._steer.set(0, 0);
    if (yaw) this.attitude.multiply(_q.setFromAxisAngle(Y, yaw));
    if (pitch) this.attitude.multiply(_q.setFromAxisAngle(X, -pitch));
    if (this.rates.z) this.attitude.multiply(_q.setFromAxisAngle(Z, -this.rates.z * dt));
    this.attitude.normalize();

    if (key('KeyW')) this.throttle = Math.min(1, this.throttle + dt * 0.8);
    if (key('KeyS')) this.throttle = Math.max(-0.25, this.throttle - dt * 0.8);
    const boost = key('ShiftLeft') || key('ShiftRight') ? 5 : 1;
    this.warpLevel += ((this.warp ? 1 : 0) - this.warpLevel) * (1 - Math.exp(-dt * (this.warp ? 0.9 : 3)));

    const cruise = this.cruiseSpeed();
    const factor = boost * (1 + this.warpLevel * this.warpLevel * 600);
    let target = this.throttle >= 0
      ? this.throttle * this.throttle * cruise * factor
      : this.throttle * cruise * 0.4;
    target = Math.max(-1e21, Math.min(target, 1e21));
    if (this._braking > 0) {
      this._braking -= dt;
      target = 0;
    }
    const rate = Math.abs(target) < Math.abs(this.speed) ? (this._braking > 0 ? 8 : 4) : 1.6;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * rate));
    if (Math.abs(this.speed) < 1e-4 && target === 0) this.speed = 0;

    // Never further in one frame than most of the way to the ground: whatever
    // the drive is doing, a planet is not something to pass through.
    let stepKm = this.speed * dt;
    const guard = Math.max(this.surfaceKm * 0.45, SHIP_LENGTH_KM * 0.02);
    if (Math.abs(stepKm) > guard) {
      stepKm = Math.sign(stepKm) * guard;
      this.speed = stepKm / dt;
    }
    const forward = _w.copy(Z).applyQuaternion(this.attitude);
    // A little slip, so a hard turn carries the old heading for a moment.
    this.velocity.lerp(forward.multiplyScalar(stepKm / Math.max(dt, 1e-6)), 1 - Math.exp(-dt * 5));
    if (this.velocity.length() * dt > guard) this.velocity.setLength(guard / dt);
    this._shipOff.addScaledVector(this.velocity, dt);

    const cockpit = this.view === 'cockpit';
    this.cameraAttitude.slerp(this.attitude, 1 - Math.exp(-dt * (cockpit ? 40 : 4.5)));
    if (cockpit) this._cockpitOffset(this.attitude, this._camRel);
    else this._chaseOffset(this.cameraAttitude, this._camRel);
    controls.roamOffset.copy(this._shipOff).add(this._camRel);
    this.shipRel.copy(this._camRel).negate();

    if (cockpit) {
      this.viewForward.copy(Z).applyQuaternion(this.attitude);
      this.viewUp.copy(Y).applyQuaternion(this.attitude);
    } else {
      // Aim past the ship at a point ahead of it, so the ship sits in the lower
      // third and the reticle is where it is going.
      this.viewForward.copy(Z).applyQuaternion(this.attitude).multiplyScalar(SHIP_LENGTH_KM * 7).sub(this._camRel).normalize();
      this.viewUp.copy(Y).applyQuaternion(this.cameraAttitude);
    }
  }

  /**
   * Per-frame after the controls have run: put the model where the ship is,
   * light it by the star it is near, and update the readouts.
   * @param {Vector3} starRel the lighting star relative to the camera
   */
  frame({ starRel, starColour, starFlux = 1, time }) {
    if (!this.active) return;
    const g = this.group;
    g.position.copy(this.shipRel);
    g.quaternion.copy(this.attitude);
    const cockpit = this.view === 'cockpit';
    for (const part of this.model.exterior) part.visible = !cockpit;
    this.model.cockpit.visible = cockpit;

    if (starRel) {
      _v.copy(starRel).sub(this.shipRel).normalize().applyQuaternion(_q.copy(this.attitude).invert());
      this.sunLight.position.copy(_v);
      this.sunLight.target.position.set(0, 0, 0);
    }
    if (starColour) this.sunLight.color.copy(starColour);
    this.sunLight.intensity = 0.25 + 2.4 * Math.min(starFlux, 1);

    const thrust = Math.max(this.throttle, 0);
    const len = 1.2 + thrust * 6 + this.warpLevel * 7 + (Math.sin(time * 37) * 0.25 + 0.25) * thrust;
    for (const plume of this.model.plumes) plume.scale.set(1, 1, len);
    this.model.plumeMat.opacity = 0.2 + 0.45 * thrust + 0.3 * this.warpLevel;

    const { seeds, positions, geometry, material } = this.streaks;
    const fast = Math.max(this.warpLevel, Math.min(Math.abs(this.speed) / Math.max(this.cruiseSpeed() * 4, 1e-9), 1) * 0.5);
    material.opacity = Math.min(fast * 0.8, 0.55);
    this.streaks.lines.visible = material.opacity > 0.02;
    if (this.streaks.lines.visible) {
      const flow = 0.6 + this.warpLevel * 3;
      const stretch = 0.01 + this.warpLevel * 0.09;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        s.z -= flow * 0.016;
        if (s.z < -0.6) s.z += 1.2;
        positions.set([s.x, s.y, s.z, s.x, s.y, s.z - stretch], i * 6);
      }
      geometry.attributes.position.needsUpdate = true;
    }

    const hud = this.hud;
    hud.speed.textContent = formatSpeed(this.speed);
    hud.bar.style.height = `${Math.abs(this.throttle) * 100}%`;
    hud.barBox.classList.toggle('reverse', this.throttle < 0);
    const drive = this.warpLevel > 0.9 ? 'Warp' : this.warpLevel > 0.05 ? 'Spooling' : 'Impulse';
    hud.warp.textContent = drive;
    hud.warp.classList.toggle('on', this.warpLevel > 0.9);
    hud.near.textContent = this.nearestName ? `${this.nearestName} · ${formatDistance(this.nearestKm)}` : '—';
  }

  /** Where the ship is in the world, for the app's nearest-object queries. */
  worldPosition(controls, out) {
    return out.copy(controls.worldPosition).add(this.shipRel);
  }
}
