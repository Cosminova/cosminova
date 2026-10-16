/**
 * Trackpad pinch (ctrl+wheel in Chrome) zooms, and the app survives the GPU
 * dropping its context: the frame keeps drawing once it is handed back.
 *
 * Usage: node scripts/_robust-check.mjs
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

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
await p.evaluate(() => document.querySelectorAll('.intro').forEach((e) => e.remove()));
const w = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};

await p.evaluate(() => window.cosminova.lookFromSun('earth', 4, 40, 18));
await w(2500);
const d0 = await p.evaluate(() => window.cosminova.controls.distanceRadii);
await p.mouse.move(512, 320);
await p.keyboard.down('Control');
for (let i = 0; i < 12; i++) {
  await p.mouse.wheel({ deltaY: -8 });
  await w(20);
}
await p.keyboard.up('Control');
await w(400);
const d1 = await p.evaluate(() => window.cosminova.controls.distanceRadii);
check(d1 < d0 * 0.8, 'a trackpad pinch (ctrl+wheel) zooms in', `${d0.toFixed(2)} -> ${d1.toFixed(2)} radii`);

const brightness = async () => {
  const { data } = await sharp(await p.screenshot({ type: 'png' })).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  return sum / data.length;
};
const before = await brightness();
const restored = await p.evaluate(() => new Promise((resolve) => {
  const gl = window.cosminova.renderer.getContext();
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) return resolve('no extension');
  const canvas = window.cosminova.renderer.domElement;
  canvas.addEventListener('webglcontextrestored', () => resolve('restored'), { once: true });
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), 800);
  setTimeout(() => resolve('timeout'), 6000);
}));
await w(3000);
const after = await brightness();
check(restored === 'restored', 'the context comes back after the GPU drops it', restored);
check(after > before * 0.5 && after > 2, 'and the scene is drawn again', `mean ${before.toFixed(1)} before, ${after.toFixed(1)} after`);
const frames = await p.evaluate(() => new Promise((r) => { let n = 0; const t = () => { if (++n < 30) requestAnimationFrame(t); else r(n); }; requestAnimationFrame(t); }));
check(frames === 30, 'the frame loop is still running');
check(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} failed` : '\nall passed');
await b.close();
process.exitCode = failed ? 1 : 0;
