/**
 * The camera must never end up under the drawn ground: from below, the terrain
 * is back faces and only the patch skirts show, as a grid.
 *
 * Zooms all the way in with the wheel at a few bodies and flies low in roam,
 * then checks the camera's height over the terrain as the shader draws it.
 *
 * Usage: node scripts/_floor-check.mjs [outDir]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = process.argv[2] ?? '/tmp/floor';
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--use-gl=angle'],
  defaultViewport: { width: 1024, height: 640 },
});
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(process.env.URL ?? 'http://127.0.0.1:5179/index.html?home=0');
await p.waitForFunction(() => window.cosminova?.ready === true, { timeout: 180000 });
await p.evaluate(() => {
  document.querySelectorAll('.intro').forEach((e) => e.remove());
  window.cosminova.setRate(0);
});
const w = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};

/** Camera height over the drawn ground, from the terrain shader. */
const clearance = (key) => p.evaluate((k) => {
  const c = window.cosminova;
  const body = c.universe.get(k);
  const planet = c.planets?.get?.(k);
  const rel = c.controls.worldPosition.clone().sub(body.position);
  const distance = rel.length();
  const local = rel.normalize().applyQuaternion(body.orientation.clone().invert());
  const ground = planet.groundHeightsKm(c.renderer, [local])[0];
  return { altitudeM: (distance - body.spec.radiusKm - ground) * 1000, groundKm: ground, near: c.camera.near * 1000 };
}, key);

for (const key of ['moon', 'mars', 'mercury']) {
  await p.evaluate((k) => window.cosminova.lookFromSun(k, 1.05, 40, 18), key);
  await w(2500);
  await p.mouse.move(512, 320);
  for (let i = 0; i < 40; i++) {
    await p.mouse.wheel({ deltaY: -120 });
    await w(40);
  }
  await w(2500);
  const c = await clearance(key);
  check(c.altitudeM > 0, `${key}: zoomed all the way in, still above the ground`, `${c.altitudeM.toFixed(1)} m over ground at ${c.groundKm.toFixed(2)} km, near plane ${c.near.toFixed(2)} m`);
  check(c.near < Math.max(c.altitudeM, 1) * 0.5, `${key}: near plane well inside the gap to the ground`);
  await p.screenshot({ path: `${OUT}/${key}-zoomed.png` });
}

// Roam straight down into the Moon.
await p.evaluate(() => window.cosminova.lookFromSun('moon', 1.01, 40, 18));
await w(2000);
await p.evaluate(() => {
  const c = window.cosminova;
  c.ui?.setCameraMode?.('roam');
});
await p.keyboard.press('KeyR').catch(() => {});
await w(300);
const mode = await p.evaluate(() => window.cosminova.controls.mode);
if (mode !== 'roam') {
  await p.evaluate(() => { window.cosminova.controls.startRoam?.(); });
}
await p.evaluate(() => {
  const c = window.cosminova;
  const body = c.universe.get('moon');
  const down = body.position.clone().sub(c.controls.worldPosition).normalize();
  c.controls.yaw = Math.atan2(down.x, down.z);
  c.controls.pitch = Math.asin(Math.max(-1, Math.min(1, down.y)));
});
await p.keyboard.down('KeyW');
await w(6000);
await p.keyboard.up('KeyW');
await w(500);
const roam = await clearance('moon');
check(roam.altitudeM > 0, 'moon: roaming into the ground stops above it', `${roam.altitudeM.toFixed(1)} m, mode ${await p.evaluate(() => window.cosminova.controls.mode)}`);
await p.screenshot({ path: `${OUT}/moon-roam.png` });

check(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} failed` : '\nall passed');
await b.close();
process.exitCode = failed ? 1 : 0;
