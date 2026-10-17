/**
 * Builds public/data/deep-sky.json — the star clusters, planetary nebulae and
 * H II regions that have measured distances — and widens galaxies.json with
 * the rest of RC3. Run after fetch-galaxies.mjs, which it extends rather than
 * replaces:
 *
 *   - Cantat-Gaudin+ 2020, open clusters from Gaia DR2 (J/A+A/640/A1)
 *   - Harris 2010, Milky Way globular clusters (VII/202)
 *   - Gonzalez-Santamaria+ 2021, planetary nebulae in Gaia EDR3 (J/A+A/656/A51)
 *   - Anderson+ 2014, the WISE catalogue of Galactic H II regions (J/ApJS/212/1)
 *   - RC3 (VII/155) at every magnitude, where fetch-galaxies stops at B = 14;
 *     IC 1101, the largest galaxy known, is B = 14.7 and was left out by it.
 *
 * Uses VizieR's ASU interface rather than TAP, with a mirror to fall back on:
 * the TAP service is the one that goes down.
 *
 * Run: node scripts/fetch-deep-sky.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'deep-sky.json');
const GALAXIES = path.join(ROOT, 'public', 'data', 'galaxies.json');
const MIRRORS = ['https://vizier.cds.unistra.fr', 'https://vizier.cfa.harvard.edu'];
const DEG = Math.PI / 180;
const H0 = 70;

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
const sig3 = (v) => {
  const scale = 10 ** (3 - Math.ceil(Math.log10(Math.abs(v) || 1)));
  return Math.round(v * scale) / scale;
};
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/** Equatorial J2000 -> three.js world vector, as fetch-galaxies writes it. */
function equatorialToVec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), Math.sin(dec), -cd * Math.sin(ra)];
}

async function asu(source, columns, constraints = {}) {
  const params = new URLSearchParams({
    '-source': source,
    '-out': columns.join(','),
    '-out.max': '99999',
    '-oc.form': 'dec',
    ...constraints,
  });
  let lastError;
  for (const host of MIRRORS) {
    try {
      const response = await fetch(`${host}/viz-bin/asu-tsv`, {
        method: 'POST',
        headers: { 'user-agent': 'cosminova asset fetch', 'content-type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const lines = (await response.text()).split('\n').filter((l) => l && !l.startsWith('#'));
      // Header, units, then a rule of dashes.
      const header = lines[0].split('\t').map((h) => h.trim());
      return lines.slice(3).map((line) => {
        const cells = line.split('\t');
        return Object.fromEntries(header.map((h, i) => [h, cells[i]?.trim() ?? '']));
      });
    } catch (error) {
      lastError = error;
      console.warn(`  ${host} failed for ${source}: ${error.message}`);
    }
  }
  console.error(`no mirror answered for ${source}: ${lastError?.message}`);
  process.exit(1);
}

// ------------------------------------------------------------ open clusters

console.log('open clusters (Cantat-Gaudin+ 2020)');
const ocRows = await asu('J/A+A/640/A1/table1', ['Cluster', 'RA_ICRS', 'DE_ICRS', 'r50', 'nbstars07', 'AgeNN', 'DistPc']);
const clusters = [];
for (const row of ocRows) {
  const dist = num(row.DistPc);
  const r50 = num(row.r50);
  const ra = num(row.RA_ICRS);
  const dec = num(row.DE_ICRS);
  if (!(dist > 0) || !(r50 > 0) || ra === undefined || dec === undefined) continue;
  const members = num(row.nbstars07) ?? 50;
  const logAge = num(row.AgeNN) ?? 8;
  clusters.push({
    key: `oc-${row.Cluster.toLowerCase()}`,
    name: row.Cluster.replace(/_/g, ' '),
    type: 'open',
    ra: round(ra, 4),
    dec: round(dec, 4),
    distPc: sig3(dist),
    // r50 holds half the members; the cluster's stars run out to about three times that.
    radiusPc: sig3(Math.max(Math.tan(r50 * DEG) * dist * 2.6, 0.6)),
    // Gaia sees the members down to G = 18; the full population is several times larger.
    stars: Math.round(Math.min(2400, Math.max(120, members * 4))),
    ageMyr: sig3(10 ** logAge / 1e6),
  });
}
console.log(`  ${clusters.length} open clusters`);

// -------------------------------------------------------- globular clusters

console.log('globular clusters (Harris 2010)');
const gcRows = await asu('VII/202/catalog', ['ID', 'Name', '_RAJ2000', '_DEJ2000', 'Rsun', 'Rc', 'Rh', 'MVt']);
for (const row of gcRows) {
  const dist = (num(row.Rsun) ?? 0) * 1000;
  const rh = num(row.Rh);
  if (!(dist > 0) || !(rh > 0)) continue;
  const id = clean(row.ID);
  const common = clean(row.Name);
  const rc = num(row.Rc) ?? rh * 0.3;
  const mv = num(row.MVt) ?? -7;
  // Tidal radius, where the stars stop, is typically ten to twenty half-light radii.
  const tidalArcmin = rh * 8;
  clusters.push({
    key: `gc-${id.toLowerCase().replace(/\s+/g, '')}`,
    name: common && common !== id ? `${common} (${id})` : id,
    type: 'globular',
    ra: round(num(row._RAJ2000), 4),
    dec: round(num(row._DEJ2000), 4),
    distPc: sig3(dist),
    radiusPc: sig3(Math.tan((tidalArcmin / 60) * DEG) * dist),
    // A hundred thousand stars at M_V = -8, scaled by luminosity.
    stars: Math.round(Math.min(90000, Math.max(8000, 1e5 * 10 ** (-0.4 * (mv + 8))))),
    core: round(Math.min(0.4, Math.max(0.03, rc / tidalArcmin)), 3),
  });
}
console.log(`  ${gcRows.length} globular clusters`);

// -------------------------------------------------------- planetary nebulae

console.log('planetary nebulae (Gonzalez-Santamaria+ 2021)');
const pnPos = new Map();
for (const table of ['J/A+A/656/A51/tablea1', 'J/A+A/656/A51/tablea1c']) {
  for (const row of await asu(table, ['PNG', 'OName', 'RA_ICRS', 'DE_ICRS', 'Group'])) {
    const png = clean(row.PNG);
    if (!pnPos.has(png)) pnPos.set(png, row);
  }
}
const pnRows = await asu('J/A+A/656/A51/tablea2', ['PNG', 'Dist', 'Radphys', 'Morph']);
const nebulae = [];
const MORPH = { B: 'bipolar', R: 'round', E: 'elliptical', I: 'irregular', A: 'elliptical', S: 'stellar' };
for (const row of pnRows) {
  const png = clean(row.PNG);
  const pos = pnPos.get(png);
  const dist = num(row.Dist);
  const radius = num(row.Radphys);
  if (!pos || !(dist > 0) || !(radius > 0)) continue;
  const other = clean(pos.OName).replace(/^(NGC|IC|M|Abell|Hb|Hu|Mz|Sh2-?|He|Vy|Cn|Me|Pe|Hf|K|A)(\d)/, (_, a, b) => `${a} ${b}`);
  nebulae.push({
    key: `pn-${png.replace(/^PN G/, '').toLowerCase()}`,
    name: other || png,
    alt: png,
    type: 'planetary',
    shape: MORPH[clean(row.Morph)] ?? 'elliptical',
    ra: round(num(pos.RA_ICRS), 4),
    dec: round(num(pos.DE_ICRS), 4),
    distPc: sig3(dist),
    radiusPc: sig3(Math.max(radius, 0.02)),
  });
}
console.log(`  ${nebulae.length} planetary nebulae with a distance and a size`);

// --------------------------------------------------------------- H II regions

console.log('H II regions (Anderson+ 2014)');
const hiiRows = await asu('J/ApJS/212/1/wisecat', ['WISE', 'Cl', 'Rad', 'HIIName', 'Name', 'Dist', '_RA.icrs', '_DE.icrs'], { Dist: '>0' });
let hii = 0;
for (const row of hiiRows) {
  const dist = (num(row.Dist) ?? 0) * 1000;
  const rad = num(row.Rad);
  if (!(dist > 0) || !(rad > 0) || clean(row.Cl) !== 'K') continue;
  const radiusPc = Math.tan((rad / 3600) * DEG) * dist;
  // Under half a parsec is an ultracompact region still buried in its cloud.
  if (radiusPc < 0.5) continue;
  const named = clean(row.HIIName).split(/[\s,;]+/)[0] || clean(row.Name);
  const sharpless = /^S\d+$/.test(named) ? `Sh2-${named.slice(1)}` : null;
  nebulae.push({
    key: `hii-${clean(row.WISE).toLowerCase()}`,
    name: sharpless ?? (named && !/^G\d/.test(named) ? named : `${clean(row.WISE)}`),
    alt: clean(row.WISE),
    type: 'emission',
    ra: round(num(row['_RA.icrs']), 4),
    dec: round(num(row['_DE.icrs']), 4),
    distPc: sig3(dist),
    radiusPc: sig3(radiusPc),
  });
  hii++;
}
console.log(`  ${hii} H II regions with a known distance`);

// ----------------------------------------------------------------- galaxies

console.log('galaxies (RC3, every magnitude)');
const existing = JSON.parse(fs.readFileSync(GALAXIES, 'utf8'));
const known = existing.galaxies.filter((g) => !g.rc3x);
const tolerance = 40 * (DEG / 3600);
const cosTolerance = Math.cos(tolerance);
const grid = new Map();
const cell = (v) => v.map((x) => Math.round(x / tolerance));
for (const g of known) {
  const [x, y, z] = cell(g.p);
  const k = `${x},${y},${z}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(g);
}
function alreadyHave(v) {
  const [x, y, z] = cell(v);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    for (const g of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
      if (g.p[0] * v[0] + g.p[1] * v[1] + g.p[2] * v[2] >= cosTolerance) return true;
    }
  }
  return false;
}

const LETTERS = { 0: 'a', 1: 'a', 2: 'ab', 3: 'b', 4: 'bc', 5: 'c', 6: 'cd', 7: 'd', 8: 'dm', 9: 'm' };
/** RC3's coded type, '.SBT3..' or '.E+4...', as the plain text the renderer reads. */
function morphOf(code, stage) {
  const c = code.replace(/^\./, '');
  const cls = c[0];
  const bar = c[1] === 'B';
  if (cls === 'E' || (stage ?? 0) <= -4) return 'E';
  if (cls === 'L' || (stage ?? 0) < 0) return 'S0';
  if (cls === 'I' || (stage ?? 0) >= 10) return bar ? 'IB' : 'Irr';
  const letter = LETTERS[Math.max(0, Math.min(9, Math.round(stage ?? 3)))];
  return `${bar ? 'SB' : 'S'}${letter}`;
}
const tidy = (s) => clean(s).replace(/^(NGC|IC|UGC|MCG|ESO|PGC)\s*/, '$1 ');

const rc3 = await asu('VII/155/rc3', ['_RAJ2000', '_DEJ2000', 'name', 'altname', 'PGC', 'BT', 'Bmag', "m'25", 'D25', 'R25', 'PA', 'V3K', 'T', 'type'], { V3K: '>1400', D25: '>0' });
const added = [];
const knownIds = new Set(known.map((g) => g.id));
/** RC3 files a few famous galaxies under a duplicate NGC number. */
const BETTER_KNOWN_AS = { 'NGC 4884': 'NGC 4889' };
for (const g of known) if (BETTER_KNOWN_AS[g.id] && !g.name) g.name = BETTER_KNOWN_AS[g.id];
for (const row of rc3) {
  const ra = num(row._RAJ2000);
  const dec = num(row._DEJ2000);
  const v = num(row.V3K);
  const d25 = num(row.D25);
  if (ra === undefined || dec === undefined || !(v > 0) || d25 === undefined) continue;
  const p = equatorialToVec(ra, dec);
  if (alreadyHave(p)) continue;
  const majArcmin = 10 ** d25 / 10;
  const minArcmin = 10 ** (d25 - (num(row.R25) ?? 0)) / 10;
  // A total magnitude, or one rebuilt from the mean surface brightness inside the
  // 25th-magnitude isophote, or failing both what a galaxy that size usually is.
  const sb = num(row["m'25"]);
  const mag = num(row.BT) ?? num(row.Bmag) ?? (sb !== undefined ? sb - 2.5 * Math.log10((Math.PI / 4) * majArcmin * minArcmin) : 15.6);
  const id = tidy(row.name) || tidy(row.altname) || clean(row.PGC).replace(/^PGC\s*/, 'PGC ');
  if (!id || knownIds.has(id)) continue;
  knownIds.add(id);
  const stage = num(row.T);
  added.push({
    id,
    ...(BETTER_KNOWN_AS[id] ? { name: BETTER_KNOWN_AS[id] } : {}),
    ra: round(ra, 5),
    dec: round(dec, 5),
    d: sig3(v / H0),
    dm: 'z',
    mag: round(mag, 2),
    aMaj: round(majArcmin / 60, 5),
    aMin: round(minArcmin / 60, 5),
    ...(num(row.PA) !== undefined ? { pa: num(row.PA) } : {}),
    morph: morphOf(clean(row.type), stage),
    p: p.map((x) => round(x, 6)),
    rc3x: 1,
  });
}
console.log(`  ${added.length} more galaxies, ${known.length} already in galaxies.json`);

/**
 * Comoving distance in Mpc for a flat universe with Omega_m = 0.3: where the
 * object is now, which is what a map you can fly through has to use. Its
 * light left when it was much closer.
 */
function comovingMpc(z) {
  const steps = 2000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const zi = ((i + 0.5) / steps) * z;
    sum += 1 / Math.sqrt(0.3 * (1 + zi) ** 3 + 0.7);
  }
  return (299792.458 / H0) * (sum * (z / steps));
}

/**
 * Galaxies that matter but are in none of the catalogues above: too far for
 * RC3, too faint for a magnitude cut, or found by JWST. Positions to the
 * arcsecond, sizes as published.
 */
const LANDMARKS = [
  { id: 'NGC 4151', ra: 182.6357, dec: 39.4057, d: 15.8, mag: 11.5, aMaj: 0.105, aMin: 0.075, morph: 'SABab', note: 'the nearest bright Seyfert galaxy, its nucleus flickering as its black hole feeds' },
  { id: 'Malin 1', ra: 189.2471, dec: 14.3303, z: 0.0827, mag: 16.0, aMaj: 0.044, aMin: 0.035, morph: 'Sa', note: 'giant low-surface-brightness spiral, a disc 650 000 light years across' },
  { id: "Hoag's Object", ra: 229.3100, dec: 21.5856, z: 0.0425, mag: 16.0, aMaj: 0.0075, aMin: 0.0072, morph: 'Ring', note: 'a ring galaxy, a near-perfect circle of young stars round an old core' },
  { id: 'Cartwheel Galaxy', ra: 9.4213, dec: -33.7164, z: 0.0300, mag: 15.2, aMaj: 0.0183, aMin: 0.0133, morph: 'S', note: 'a ring galaxy made by a collision 200 million years ago' },
  { id: 'Tadpole Galaxy', ra: 241.5163, dec: 55.4256, z: 0.0310, mag: 14.4, aMaj: 0.0583, aMin: 0.0167, morph: 'SBc', note: 'a barred spiral trailing a 280 000 light-year tidal tail' },
  { id: 'Phoenix Cluster BCG', ra: 356.1830, dec: -42.7203, z: 0.597, mag: 19.6, aMaj: 0.003, aMin: 0.0025, morph: 'E', note: 'the central galaxy of the Phoenix Cluster, forming 500 stars a year round Phoenix A' },
  { id: 'Holmberg 15A', ra: 10.4600, dec: -9.3031, z: 0.0554, mag: 15.0, aMaj: 0.02, aMin: 0.015, morph: 'E', note: 'the central galaxy of Abell 85, with a 40 billion solar-mass black hole' },
  { id: 'Cygnus A', ra: 299.8682, dec: 40.7339, z: 0.0561, mag: 15.1, aMaj: 0.012, aMin: 0.008, morph: 'E', note: 'the brightest radio galaxy in the sky, its jets 500 000 light years long' },
  { id: 'Arp 273', ra: 35.3788, dec: 39.3664, z: 0.0251, mag: 14.5, aMaj: 0.0167, aMin: 0.008, morph: 'SBc', note: 'a pair of interacting spirals drawn into a rose' },
  { id: 'GN-z11', ra: 189.1060, dec: 62.2421, z: 10.6, mag: 26.0, aMaj: 0.00002, aMin: 0.00002, morph: 'Irr', note: 'seen 400 million years after the Big Bang' },
  { id: 'MACS0647-JD', ra: 101.9822, dec: 70.2433, z: 10.17, mag: 26.0, aMaj: 0.00002, aMin: 0.00002, morph: 'Irr', note: 'a young galaxy lensed into three images by the cluster in front of it' },
  { id: 'JADES-GS-z13-0', ra: 53.1490, dec: -27.7765, z: 13.2, mag: 28.0, aMaj: 0.00001, aMin: 0.00001, morph: 'Irr', note: 'seen 320 million years after the Big Bang' },
  { id: 'JADES-GS-z14-0', ra: 53.0829, dec: -27.8556, z: 14.32, mag: 28.0, aMaj: 0.00002, aMin: 0.00002, morph: 'Irr', note: 'the most distant galaxy confirmed, seen 290 million years after the Big Bang' },
];
const landmarks = [];
for (const g of LANDMARKS) {
  if (knownIds.has(g.id)) continue;
  const p = equatorialToVec(g.ra, g.dec);
  landmarks.push({
    id: g.id,
    ra: g.ra,
    dec: g.dec,
    d: g.d ?? sig3(comovingMpc(g.z)),
    dm: g.d ? 'lit' : 'z',
    ...(g.z ? { z: g.z } : {}),
    mag: g.mag,
    aMaj: g.aMaj,
    aMin: g.aMin,
    morph: g.morph,
    note: g.note,
    p: p.map((x) => round(x, 6)),
    rc3x: 1,
  });
}
console.log(`  ${landmarks.length} landmark galaxies from the literature, out to ${landmarks.at(-1)?.d} Mpc`);
existing.galaxies = [...known, ...added, ...landmarks].sort((a, b) => a.d - b.d);
if (!existing.sources.some((s) => s.includes('every magnitude'))) {
  existing.sources.push('de Vaucouleurs+ 1991, RC3 (VizieR VII/155), every magnitude');
}
fs.writeFileSync(GALAXIES, JSON.stringify(existing));
const ic1101 = existing.galaxies.find((g) => g.id === 'IC 1101');
console.log(`  IC 1101: ${ic1101 ? `${ic1101.d} Mpc, B = ${ic1101.mag}` : 'MISSING'}`);

// ------------------------------------------------------------------ write

const payload = {
  sources: [
    'Cantat-Gaudin+ 2020, open clusters (VizieR J/A+A/640/A1)',
    'Harris 2010, globular clusters (VizieR VII/202)',
    'Gonzalez-Santamaria+ 2021, planetary nebulae (VizieR J/A+A/656/A51)',
    'Anderson+ 2014, WISE H II regions (VizieR J/ApJS/212/1)',
  ],
  retrieved: new Date().toISOString().slice(0, 10),
  clusters,
  nebulae,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`wrote ${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, galaxies.json ${(fs.statSync(GALAXIES).size / 1024).toFixed(0)} KB`);
