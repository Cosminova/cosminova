/**
 * Screenshots galaxies at several distances and angles, with the sprite
 * clouds on and (suffix -bb) off, to compare against the billboards.
 *
 * Usage: node scripts/_galaxy-shots.mjs [outDir] [shotNames,...]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const outDir = process.argv[2] ?? '/tmp/galaxy-shots';
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
  if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 300));
});
await page.goto(process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5179/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.cosminova && window.cosminova.ready', { timeout: 180000 });
await page.evaluate(() => {
  window.cosminova.setRate(0);
  document.querySelector('.home')?.remove();
  document.querySelector('.intro')?.remove();
  window.cosminova.setUiVisible?.(false);
  window.cosminova.controls.startRoam();
});

// [name, galaxy, distance in radii, direction mix (n, u) from the centre]
const shots = [
  ['m31-12r', 'andromeda', 12, [1, 0.5]],
  ['m31-5r', 'andromeda', 5, [1, 0.5]],
  ['m31-2r', 'andromeda', 2.2, [1, 0.55]],
  ['m31-edge', 'andromeda', 2.6, [0.08, 1]],
  ['m31-inside', 'andromeda', 0.5, [0.15, 1]],
  ['mw-outside', 'milkyway', 3, [1, 0.6]],
  ['mw-edge', 'milkyway', 3, [0.1, 1]],
  ['gen-3r', 'generated', 3, [1, 0.7]],
  ['gen-edge', 'generated', 3, [0.12, 1]],
];

for (const [name, which, radii, [an, au]] of shots) {
  if (only && !only.includes(name)) continue;
  if (which === 'generated' && !(await page.evaluate(() => Boolean(window.__gen)))) {
    await page.evaluate(() => {
      const k = window.cosminova.controls;
      const PC = 3.0856775814913673e13;
      k.roamOffset.set(150e6 * PC, 20e6 * PC, -90e6 * PC).sub(k.roamOriginPosition);
    });
    await new Promise((r) => setTimeout(r, 4000));
  }
  const info = await page.evaluate(({ which, radii, an, au }) => {
    const c = window.cosminova;
    const k = c.controls;
    let g;
    if (which === 'andromeda') {
      const d = c.destinations.find((x) => x.kind === 'galaxy' && /Andromeda|M31|NGC 0?224/.test(x.name));
      g = c.cosmos._catalogFrame(d.galaxyIndex);
    } else if (which === 'milkyway') {
      g = c.cosmos.milkyWay;
    } else {
      g = window.__gen ?? (window.__gen = c.cosmos.nearbyGalaxies(k.worldPosition, 80).filter((x) => x.morph > 1.5 && x.morph < 5).sort((a, b) => b.luminosity - a.luminosity)[0]);
      if (!g) return { name: `none of ${c.cosmos.generatedGalaxies.size}`, key: '', morph: 0 };
    }
    const dir = g.n.clone().multiplyScalar(an).addScaledVector(g.u, au).normalize();
    const p = g.center.clone().addScaledVector(dir, g.radiusKm * radii);
    k.roamOffset.copy(p).sub(k.roamOriginPosition);
    const f = g.center.clone().sub(p).normalize();
    k.yaw = Math.atan2(f.x, f.z);
    k.pitch = Math.asin(f.y);
    c.cosmos.showClouds = true;
    return { name: g.name, key: g.key, morph: g.morph };
  }, { which, radii, an, au });
  // The generated-galaxy cells load where the camera arrives, then sprites build and fade in.
  await new Promise((r) => setTimeout(r, 5000));
  const state = await page.evaluate((key) => {
    const s = window.cosminova.cosmos.sprites;
    return {
      fade: s.fadeFor(key).toFixed(2),
      fps: window.cosminova.stats?.().fps,
      slots: s.slots.map((x) => `${x.frame?.name ?? '-'}:${x.ready ? 'R' : 'b'}:${x.fade.toFixed(2)}`).join(' '),
    };
  }, info.key);
  console.log(name, info.name, `morph ${info.morph.toFixed?.(2)}`, JSON.stringify(state));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.evaluate(() => { window.cosminova.cosmos.showClouds = false; });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${outDir}/${name}-bb.png` });
}
await browser.close();
