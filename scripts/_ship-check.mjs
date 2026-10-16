/**
 * Drives the ship from the keyboard, then on a phone-sized touch screen.
 * Usage: node scripts/_ship-check.mjs [url]
 */
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] ?? 'http://127.0.0.1:5179/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--headless=new','--no-sandbox','--use-gl=angle'] });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(viewport, touch) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport(viewport);
  if (touch) await page.emulate({ viewport, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.cosminova && window.cosminova.ready', { timeout: 180000 });
  await page.evaluate(() => {
    window.cosminova.setRate(0);
    document.querySelector('.home')?.remove();
    document.querySelector('.intro')?.remove();
  });
  // The Gaia catalogue decodes a few seconds in; timing checks wait it out.
  await page.waitForFunction('window.cosminova.gaia', { timeout: 30000 });
  await wait(800);
  return { page, errors };
}

{
  const { page, errors } = await open({ width: 1280, height: 800 });
  await page.keyboard.press('KeyP');
  await wait(500);
  const s0 = await page.evaluate(() => ({ active: window.cosminova.ship.active, mode: window.cosminova.controls.mode, hud: !document.querySelector('.ship-hud').hidden }));
  check('P takes the ship', s0.active && s0.mode === 'roam' && s0.hud, JSON.stringify(s0));
  const from = await page.evaluate(() => window.cosminova.controls.worldPosition.toArray());
  await page.keyboard.down('KeyW');
  await wait(1500);
  await page.keyboard.up('KeyW');
  await wait(1500);
  const s1 = await page.evaluate((from) => {
    const c = window.cosminova; const p = c.controls.worldPosition;
    return { throttle: c.ship.throttle, speed: c.ship.speed, moved: Math.hypot(p.x - from[0], p.y - from[1], p.z - from[2]) };
  }, from);
  check('W opens the throttle and the ship moves', s1.throttle > 0.3 && s1.moved > 1, JSON.stringify(s1));
  const before = await page.evaluate(() => window.cosminova.ship.attitude.toArray());
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyE');
  await wait(800);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyE');
  const after = await page.evaluate(() => window.cosminova.ship.attitude.toArray());
  const turned = 1 - Math.abs(before.reduce((a, v, i) => a + v * after[i], 0));
  check('D and E turn and roll the ship', turned > 1e-3, `1-|q·q'| = ${turned.toExponential(2)}`);
  await page.keyboard.press('KeyV');
  await wait(300);
  check('V switches to the cockpit', await page.evaluate(() => window.cosminova.ship.view === 'cockpit'));
  await page.keyboard.press('KeyJ');
  await wait(2500);
  const s2 = await page.evaluate(() => ({ warp: window.cosminova.ship.warpLevel, on: window.cosminova.ship.warp, speed: window.cosminova.ship.speed, frames: window.cosminova.renderer.info.render.frame }));
  check('J spools the warp drive', s2.warp > 0.6, JSON.stringify(s2));
  await page.screenshot({ path: '/tmp/universe/ship-desktop.png' });
  await page.keyboard.press('KeyX');
  await wait(1500);
  const s3 = await page.evaluate(() => ({ speed: window.cosminova.ship.speed, warp: window.cosminova.ship.warp }));
  check('X brakes', !s3.warp && Math.abs(s3.speed) < s2.speed * 0.1, JSON.stringify(s3));
  // Straight at the Moon at full warp: the ground has to win.
  await page.evaluate(() => {
    const c = window.cosminova;
    const moon = c.universe.get('moon');
    const ship = c.ship;
    const fwd = moon.position.clone().sub(c.controls.worldPosition).normalize();
    const m = new c.camera.constructor();
    m.up.set(0, 1, 0);
    m.lookAt(fwd);
    // A camera looks down -z and the ship flies along +z.
    ship.attitude.copy(m.quaternion).multiply(new m.quaternion.constructor().setFromAxisAngle(m.up.clone().set(0, 1, 0), Math.PI));
    ship.cameraAttitude.copy(ship.attitude);
    ship.view = 'chase';
    ship.throttle = 1;
    ship.warp = true;
  });
  let lowest = Infinity;
  for (let i = 0; i < 16; i++) {
    await wait(250);
    const alt = await page.evaluate(() => {
      const c = window.cosminova;
      const moon = c.universe.get('moon');
      return c.ship.worldPosition(c.controls, c.controls.worldPosition.clone()).distanceTo(moon.position) - moon.spec.radiusKm;
    });
    lowest = Math.min(lowest, alt);
  }
  check('flying into the Moon at warp stops at the ground', lowest > -10, `lowest ${lowest.toFixed(3)} km above the mean radius`);
  await page.keyboard.press('KeyP');
  await wait(400);
  const s4 = await page.evaluate(() => ({ active: window.cosminova.ship.active, mode: window.cosminova.controls.mode, pilot: !!window.cosminova.controls.pilot, hud: document.querySelector('.ship-hud').hidden }));
  check('P again leaves the ship and returns to orbit', !s4.active && s4.mode === 'orbit' && !s4.pilot && s4.hud, JSON.stringify(s4));
  check('no page errors on desktop', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true);
  await page.evaluate(() => window.cosminova.ui?.togglePanel?.('navigation', true));
  await wait(400);
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button, [role="radio"]')].find((b) => b.textContent.trim() === 'Ship');
    button?.click();
    return Boolean(button);
  });
  await wait(600);
  await page.evaluate(() => window.cosminova.ui?.togglePanel?.('navigation', false));
  await wait(300);
  check('the Ship button exists on a phone', clicked);
  check('it takes the ship', await page.evaluate(() => window.cosminova.ship.active));
  const pad = await page.evaluate(() => {
    const w = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'W' && b.offsetParent);
    const r = w?.getBoundingClientRect();
    const panel = document.querySelector('.ship-hud .panel').getBoundingClientRect();
    const buttons = document.querySelector('.ship-hud .buttons').getBoundingClientRect();
    return { w: r && [r.left, r.top, r.right, r.bottom], panel: [panel.left, panel.top, panel.right, panel.bottom], buttons: [buttons.left, buttons.top, buttons.right, buttons.bottom] };
  });
  const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  check('the HUD does not sit on the flight pad', !overlap(pad.w, pad.panel) && !overlap(pad.w, pad.buttons), JSON.stringify(pad));
  const warp = await page.$('.ship-hud [data-act="warp"]');
  await warp.tap();
  await wait(300);
  check('tapping Warp engages it', await page.evaluate(() => window.cosminova.ship.warp));
  await page.screenshot({ path: '/tmp/universe/ship-phone.png' });
  check('no page errors on a phone', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
