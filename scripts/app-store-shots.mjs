/**
 * The iPhone and iPad screenshots for the App Store listing.
 *
 * Version 1.0 was rejected under guideline 2.3.3 because most of its
 * screenshots did not show the app in use: they were captioned scenery with
 * the interface hidden, which is what store-shots.mjs makes on purpose for
 * the Mac. Apple reads that as marketing art. So every frame here is the app
 * as someone holding the device sees it — interface on, a panel open where
 * that is what is being shown — and none carry a caption.
 *
 * Shot from the iOS build (dist-ios), which is what the app bundles and
 * serves to its web view, at each store size's exact pixels:
 *
 *   iphone-6.5   1284 x 2778   (428 x 926 points at 3x)
 *   ipad-13      2064 x 2752   (1032 x 1376 points at 2x)
 *
 * Usage: node scripts/app-store-shots.mjs [device ...]
 *        (serve dist-ios first: npm run build:ios && npm run preview:ios)
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const URL = process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5181/';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve('shots/app-store');

const DEVICES = {
  'iphone-6.5': {
    viewport: { width: 428, height: 926, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    pixels: [1284, 2778],
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  'iphone-6.3': {
    viewport: { width: 402, height: 874, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    pixels: [1206, 2622],
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  'ipad-13': {
    viewport: { width: 1032, height: 1376, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    pixels: [2064, 2752],
    // What iPadOS really sends: desktop Safari. Touch points tell it apart.
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    touchPoints: 5,
  },
};

/**
 * Each frame is a place to be and the panel a person would have open there.
 * `setup` runs in the page with the app's own API; `tap` names interface
 * buttons by their accessible label, pressed the way a finger presses them.
 * `open` names panels that must end up open: a rail button toggles, and an
 * iPad already has some panels open, where tapping would close them.
 */
const SHOTS = [
  {
    name: '1-saturn',
    setup: (api) => api.lookFromSun('saturn', 3.4, 38, 22),
  },
  {
    name: '2-search',
    setup: (api) => api.lookFromSun('jupiter', 3.2, 40, 14),
    tap: ['Search'],
    type: 'Saturn',
  },
  {
    name: '3-moon-object',
    setup: (api) => api.lookFromSun('moon', 2.2, 70, 12),
    open: ['inspector'],
  },
  {
    name: '4-system',
    setup: (api) => api.lookFromSun('earth', 3.0, 35, 16),
    open: ['system'],
  },
  {
    name: '5-black-hole',
    setup: (api) => api.lookAtBlackHole('bh:sgr-a', 30),
    wait: 6000,
    open: ['inspector'],
  },
  {
    name: '6-catalog',
    setup: (api) => api.lookFromSun('mars', 2.6, 40, 18),
    tap: ['Catalog'],
  },
];

const wanted = process.argv.slice(2);
const devices = Object.entries(DEVICES).filter(([name]) => !wanted.length || wanted.includes(name));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle', '--hide-scrollbars'],
});

for (const [deviceName, device] of devices) {
  const dir = path.join(OUT, deviceName);
  fs.mkdirSync(dir, { recursive: true });

  for (const shot of SHOTS) {
    // A fresh page per frame, so a panel left open by one frame cannot leak
    // into the next.
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setUserAgent(device.ua);
    if (device.touchPoints) {
      await page.evaluateOnNewDocument((n) => {
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => n });
      }, device.touchPoints);
    }
    // The welcome card is onboarding, which Apple does not count as the app in
    // use, so every frame is shot as a returning user who has dismissed it —
    // the same flag the card itself saves.
    await page.evaluateOnNewDocument(() => {
      // Also runs on the blank page a tab opens with, which has no storage.
      if (location.protocol !== 'http:') return;
      const KEY = 'skyview.ui.v1';
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      localStorage.setItem(KEY, JSON.stringify({ ...saved, seenIntro: true }));
    });
    await page.setViewport(device.viewport);
    await page.goto(`${URL}?home=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.cosminova?.ready === true, { timeout: 180000 });
    await page.evaluate(() => window.cosminova.setRate(0));

    await page.evaluate(`(${shot.setup.toString()})(window.cosminova)`);
    await new Promise((r) => setTimeout(r, shot.wait ?? 4500));

    for (const id of shot.open ?? []) {
      await page.evaluate((panel) => window.cosminova.ui.togglePanel(panel, true), id);
      await new Promise((r) => setTimeout(r, 900));
    }
    for (const label of shot.tap ?? []) {
      await tapLabel(page, label);
      await new Promise((r) => setTimeout(r, 900));
    }
    if (shot.type) {
      await page.keyboard.type(shot.type, { delay: 40 });
      await new Promise((r) => setTimeout(r, 1500));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const introShowing = await page.evaluate(() => [...document.querySelectorAll('button')]
      .some((el) => el.textContent.trim() === 'I know my way' && el.getBoundingClientRect().width > 0));
    if (introShowing) errors.push('the welcome card is covering the frame');

    const file = path.join(dir, `${shot.name}.png`);
    await page.screenshot({ path: file });
    const { width, height } = await sharp(file).metadata();
    const [w, h] = device.pixels;
    const sized = width === w && height === h;
    console.log(
      `${sized ? 'ok  ' : 'FAIL'}  ${deviceName}/${shot.name}.png  ${width}x${height}`
        + (errors.length ? `  page errors: ${errors.slice(0, 2).join(' | ')}` : ''),
    );
    if (!sized || errors.length) process.exitCode = 1;
    await page.close();
  }
}

await browser.close();

/** Presses the visible control with this accessible label or text. */
async function tapLabel(page, label) {
  const box = await page.evaluate((wanted) => {
    const match = [...document.querySelectorAll('button, [role=button]')].find((el) => {
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
      return r.width > 0 && r.height > 0 && name === wanted;
    });
    if (!match) return null;
    const r = match.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!box) throw new Error(`no visible control labelled "${label}"`);
  await page.touchscreen.tap(box.x, box.y);
}
