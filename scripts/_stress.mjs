/**
 * Flies the ship at warp in changing directions and records what the app is
 * holding: JS heap, GPU geometries and textures, loaded cells and systems.
 * Anything that only climbs is a leak; the run should plateau.
 *
 * Usage: node scripts/_stress.mjs [url] [seconds]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://127.0.0.1:5179/index.html?home=0';
const SECONDS = Number(process.argv[3] ?? 120);
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--use-gl=angle', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  defaultViewport: { width: 1280, height: 800 },
});
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(URL);
await p.waitForFunction(() => window.cosminova?.ready === true, { timeout: 180000 });
await p.evaluate(() => document.querySelectorAll('.intro, .home').forEach((e) => e.remove()));
await p.waitForFunction(() => window.cosminova.gaia, { timeout: 30000 }).catch(() => {});
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const sample = () => p.evaluate(() => {
  globalThis.gc?.();
  const c = window.cosminova;
  const info = c.renderer.info;
  let nodes = 0;
  c.scene.traverse(() => nodes++);
  return {
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    geo: info.memory.geometries,
    tex: info.memory.textures,
    progs: info.programs?.length ?? 0,
    nodes,
    live: c.liveDests?.length ?? 0,
    cells: c.cosmos?.starCells?.size ?? c.cosmos?._cells?.size ?? null,
    gals: c.cosmos?.generatedGalaxies?.size ?? null,
    fromSunPc: +(c.controls.worldPosition.distanceTo(c.universe.get('sun').position) / 3.0857e13).toPrecision(3),
    fps: Math.round(c.stats?.().fps ?? 0),
  };
});

await p.keyboard.press('KeyP');
await w(500);
console.log('t=0', JSON.stringify(await sample()));
const start = Date.now();
let leg = 0;
while ((Date.now() - start) / 1000 < SECONDS) {
  // A new heading every leg, warp on for most of it, and the odd stop near
  // whatever is there so systems get activated and dropped.
  await p.evaluate((n) => {
    const s = window.cosminova.ship;
    const q = s.attitude.clone();
    const a = (n * 2.399963) % (Math.PI * 2);
    const tilt = Math.sin(n * 1.7) * 0.9;
    q.setFromEuler(new (window.cosminova.camera.rotation.constructor)(tilt, a, 0));
    s.attitude.copy(q);
    s.cameraAttitude.copy(q);
    s.throttle = 1;
    s.warp = n % 3 !== 2;
  }, leg);
  await w(5000);
  if (leg % 3 === 2) {
    await p.keyboard.press('KeyX');
    await w(1500);
  }
  leg++;
  console.log(`t=${Math.round((Date.now() - start) / 1000)}`, JSON.stringify(await sample()));
}
console.log(errors.length ? `errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : 'no errors');
await b.close();
