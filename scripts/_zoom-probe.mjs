import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://127.0.0.1:5179/index.html';
const viaHome = process.argv[3] === 'home';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--use-gl=angle'],
  defaultViewport: { width: 1280, height: 800 },
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(URL);
await p.waitForFunction(() => window.cosminova?.ready === true, { timeout: 180000 });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => p.evaluate(() => {
  const c = window.cosminova.controls;
  return { mode: c.mode, d: +c.distanceRadii.toPrecision(4), target: window.cosminova.state?.target, earth: c.earthView, riding: c.riding, fov: +c.fov.toFixed(1), zv: c.zoomVelocity };
});
await w(1500);
if (viaHome) {
  await w(5000);
  console.log('on the start screen', JSON.stringify(await state()));
  await p.click('#home-start');
  await w(2500);
  await p.evaluate(() => document.querySelectorAll('.intro').forEach((e) => e.remove()));
} else {
  await p.evaluate(() => document.querySelectorAll('.intro, .home').forEach((e) => e.remove()));
}
await w(300);
console.log('start', JSON.stringify(await state()));
console.log('under centre:', await p.evaluate(() => { const e = document.elementFromPoint(640, 400); return `${e.tagName}.${e.className}`; }));
await p.mouse.move(640, 400);
for (let i = 0; i < 10; i++) { await p.mouse.wheel({ deltaY: -4 }); await w(30); }
await w(800);
console.log('after zoom in', JSON.stringify(await state()));
for (let i = 0; i < 10; i++) { await p.mouse.wheel({ deltaY: 6 }); await w(30); }
await w(800);
console.log('after zoom out', JSON.stringify(await state()));
await b.close();
