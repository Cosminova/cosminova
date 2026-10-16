/**
 * Close views of stars across the temperature range, as a contact sheet.
 *
 * Usage: node scripts/_star-faces.mjs [outDir] [radii]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const outDir = process.argv[2] ?? '/tmp/star-faces';
const radii = Number(process.argv[3] ?? 2.6);
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle', '--hide-scrollbars'],
  defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5179/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.cosminova && window.cosminova.ready', { timeout: 180000 });
await page.evaluate(() => {
  const c = window.cosminova;
  c.setRate(0);
  document.querySelector('.home')?.remove();
  document.querySelector('.intro')?.remove();
  c.setUiVisible?.(false);
});

const STARS = [
  ['betelgeuse', /^Betelgeuse$/],
  ['rigel', /^Rigel$/],
  ['proxima', /Proxima/],
  ['sirius', /^Sirius$/],
  ['sun', /^Sun$/],
  ['trappist', /TRAPPIST-1$/],
];
for (const [name, pattern] of STARS) {
  const found = await page.evaluate((source, radii) => {
    const c = window.cosminova;
    const re = new RegExp(source);
    const d = c.destinations.find((x) => (x.kind === 'star' || x.key === 'sun') && re.test(x.name));
    if (!d) return null;
    c.target(d.key, radii);
    return d.name;
  }, pattern.source, radii);
  if (!found) {
    console.log(name, 'not found');
    continue;
  }
  await new Promise((r) => setTimeout(r, 6000));
  console.log(name, found);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}
await browser.close();
