/**
 * Flies the camera (or the ship) to a list of places and screenshots each, with
 * what the procedural universe has loaded there.
 *
 * Usage: node scripts/_universe-probe.mjs [outDir] [sceneNames,...]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const outDir = process.argv[2] ?? '/tmp/universe';
const only = process.argv[3]?.split(',');
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`console.${m.type()}:`, m.text().slice(0, 300));
});
await page.goto(process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5179/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.cosminova && window.cosminova.ready', { timeout: 180000 });
await page.evaluate(() => {
  window.cosminova.setRate(0);
  document.querySelector('.home')?.remove();
  window.cosminova.ui?.setUiVisible?.(false);
  window.cosminova.setUiVisible?.(false);
});
await page.waitForFunction('window.cosminova.gaia', { timeout: 30000 }).catch(() => console.log('no gaia'));

const PC = 3.0856775814913673e13;
// Each scene: an expression run in the page, then a wait.
const scenes = {
  earth: `void 0`,
  shipEarth: `(() => {
    const c = window.cosminova;
    c.setShip(true);
  })()`,
  cockpit: `(() => { const c = window.cosminova; c.setShip(true); c.ship.view = 'cockpit'; })()`,
  interstellar: `(() => {
    const c = window.cosminova;
    c.setShip(true);
    c.ship.view = 'chase';
    const k = c.controls;
    k.roamOffset.set(120 * ${PC}, 30 * ${PC}, -200 * ${PC}).sub(k.roamOriginPosition);
  })()`,
  aboveDisc: `(() => {
    const c = window.cosminova;
    c.setShip(false);
    c.ui?.setCameraMode?.('roam');
    const k = c.controls;
    k.startRoam();
    const mw = c.cosmos.milkyWay;
    const p = mw.center.clone().addScaledVector(mw.n, 32000 * ${PC}).addScaledVector(mw.u, 14000 * ${PC});
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = mw.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
  })()`,
  inDisc: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    k.startRoam();
    const mw = c.cosmos.milkyWay;
    const p = mw.center.clone().addScaledVector(mw.u, 3000 * ${PC}).addScaledVector(mw.w, 2000 * ${PC}).addScaledVector(mw.n, 300 * ${PC});
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = mw.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
  })()`,
  andromeda: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    k.startRoam();
    const d = c.destinations.find((x) => x.kind === 'galaxy' && /Andromeda|M31|NGC 0?224/.test(x.name));
    const g = c.cosmos._catalogFrame(d.galaxyIndex);
    const p = g.center.clone().addScaledVector(g.n, g.radiusKm * 2.2).addScaledVector(g.u, g.radiusKm * 1.2);
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = g.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
    window.__probe = d.name;
  })()`,
  deepSpace: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    k.startRoam();
    const p = new k.worldPosition.constructor(150e6 * ${PC}, 20e6 * ${PC}, -90e6 * ${PC});
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
  })()`,
  genGalaxy: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    const gs = c.cosmos.nearbyGalaxies(k.worldPosition, 30).filter((g) => g.luminosity > 0.4);
    const g = gs[0];
    const p = g.center.clone().addScaledVector(g.n, g.radiusKm * 1.6).addScaledVector(g.u, g.radiusKm * 1.4);
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = g.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
    window.__probe = g.name + ' morph ' + g.morph.toFixed(2);
  })()`,
  insideGen: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    const g = c.cosmos.focus ?? c.cosmos.active;
    const p = g.center.clone().addScaledVector(g.u, g.radiusKm * 0.45).addScaledVector(g.n, g.radiusKm * 0.01);
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = g.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
    window.__probe = g.name;
  })()`,
  genStar: `(() => {
    const c = window.cosminova;
    const k = c.controls;
    const s = c.cosmos.nearestStar(k.worldPosition, 1e30);
    const p = s.world.clone().add(new s.world.constructor(1, 0.3, 0.2).normalize().multiplyScalar(6 * 1.496e8));
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = s.world.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z); k.pitch = Math.asin(f.y);
    c.setShip(true);
    window.__probe = 'star seed ' + s.seed;
  })()`,
  warp: `(() => {
    const c = window.cosminova;
    c.setShip(true);
    c.ship.view = 'chase';
    c.ship.throttle = 1;
    c.ship.warp = true;
    window.__from = c.controls.worldPosition.clone();
    window.__probe = 'warp';
  })()`,
  warpResult: `(() => {
    const c = window.cosminova;
    window.__probe = 'moved pc ' + (c.controls.worldPosition.distanceTo(window.__from) / ${PC}).toFixed(1) + ' speed ' + c.ship.speed.toExponential(2);
  })()`,
};

for (const [name, script] of Object.entries(scenes)) {
  if (only && !only.includes(name)) continue;
  const t0 = Date.now();
  try {
    await page.evaluate(script);
  } catch (e) {
    console.log(name, 'SCRIPT ERROR', e.message);
    continue;
  }
  await new Promise((r) => setTimeout(r, name === 'genStar' ? 5000 : 3500));
  const info = await page.evaluate(() => {
    const c = window.cosminova;
    const k = c.controls;
    const cos = c.cosmos;
    return {
      probe: window.__probe,
      mode: k.mode,
      ship: c.ship.active,
      fromSunPc: (k.worldPosition.length() / 3.0856775814913673e13).toExponential(3),
      cosmosStars: cos.count,
      starCells: cos.starCells.size,
      galaxies: cos.generatedGalaxies.size,
      active: cos.active?.name ?? null,
      focus: cos.focus?.name ?? null,
      gaia: c.gaia?.count ?? 0,
      exo: c.exoSystem?.system.host ?? null,
      exoPlanets: c.exoSystem?.planets.length ?? 0,
      nearest: c.ship.nearestName,
      live: c.liveDests.length,
      fps: c.stats?.().fps,
    };
  });
  console.log(name, `${Date.now() - t0}ms`, JSON.stringify(info));
  await page.screenshot({ path: `${outDir}/${name}.png` });
}
await browser.close();
