/**
 * Visits one body after another, close in, and totals the texture memory the
 * scene holds afterwards. Near imagery for bodies left behind should be let go.
 *
 * Usage: node scripts/_tour-mem.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://127.0.0.1:5179/index.html?home=0';
const TOUR = ['moon', 'earth', 'mercury', 'mars', 'europa', 'ganymede', 'io', 'callisto', 'titan', 'enceladus', 'dione', 'venus', 'ceres', 'pluto', 'moon'];
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--use-gl=angle', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  defaultViewport: { width: 1280, height: 800 },
});
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.cosminova?.ready === true, { timeout: 180000 });
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const sample = () => p.evaluate(() => {
  globalThis.gc?.();
  const c = window.cosminova;
  const seen = new Set();
  let bytes = 0;
  const big = [];
  const visit = (tex) => {
    if (!tex || seen.has(tex) || !tex.isTexture) return;
    seen.add(tex);
    const img = tex.image;
    const wdt = img?.width ?? 0;
    const hgt = img?.height ?? 0;
    const per = tex.isDataTexture ? (img?.data?.BYTES_PER_ELEMENT ?? 1) * 4 : 4;
    const n = wdt * hgt * per * (tex.generateMipmaps || tex.mipmaps?.length ? 1.33 : 1);
    bytes += n;
    if (n > 16 * 1048576) big.push(`${tex.name || '?'} ${wdt}x${hgt}`);
  };
  c.scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) visit(v);
      for (const u of Object.values(m.uniforms ?? {})) {
        if (u?.value?.isTexture) visit(u.value);
        if (Array.isArray(u?.value)) u.value.forEach(visit);
      }
    }
  });
  return {
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    sceneTexMB: Math.round(bytes / 1048576),
    gpuTex: c.renderer.info.memory.textures,
    big: big.slice(0, 6),
  };
});

console.log('start', JSON.stringify(await sample()));
for (const key of TOUR) {
  await p.evaluate((k) => window.cosminova.lookFromSun(k, 1.01, 40, 18), key);
  await w(5000);
  console.log(key.padEnd(10), JSON.stringify(await sample()));
}
console.log(errors.length ? `errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : 'no errors');
await b.close();
