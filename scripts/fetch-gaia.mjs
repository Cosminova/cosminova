/**
 * Builds public/data/stars-gaia.bin: a million-odd real stars from Gaia DR3,
 * fainter than the HYG catalogue that stars.bin is built from.
 *
 * HYG stops at about the Hipparcos limit, so the sky it gives is the sky to
 * the naked eye and a little beyond. Gaia measured parallaxes for over a
 * billion stars; everything to G 11 with a parallax better than five sigma
 * is about 1.2 million of them, which is what a pair of binoculars shows and
 * still small enough to ship.
 *
 * Stars HYG already has are dropped by matching position and brightness
 * against stars.bin, so the two files together are one catalogue rather than
 * a bright sky drawn twice.
 *
 * Each star is eight bytes, little-endian:
 *   u16 u16  direction, octahedral-encoded unit vector (about 6 arcseconds)
 *   u16      distance, log10(parsec) mapped from [LOG_MIN, LOG_MAX]
 *   u8       V magnitude, (V - MAG_MIN) * MAG_STEPS
 *   u8       B-V colour index, (bv - BV_MIN) * BV_STEPS
 * in the same equatorial frame as stars.bin, brightest first.
 *
 * Run: node scripts/fetch-gaia.mjs [--refetch]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data-src', 'gaia-dr3-g11.csv');
const OUT = path.join(ROOT, 'public', 'data', 'stars-gaia.bin');
const META = path.join(ROOT, 'public', 'data', 'stars-gaia.meta.json');
const HYG = path.join(ROOT, 'public', 'data', 'stars.bin');
const HYG_META = path.join(ROOT, 'public', 'data', 'stars.meta.json');

const G_LIMIT = 11;
const QUERY = `Gaia DR3 (CDS I/355/gaiadr3), Gmag < ${G_LIMIT}, Plx/e_Plx > 5`;
// The CDS mirror of the Gaia catalogue, which streams a large result where
// ESA's own archive gives an anonymous query sixty seconds. One request per
// band of brightness keeps each response to a few hundred thousand rows.
const VIZIER = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';
const BANDS = [[-5, 8], [8, 9], [9, 9.6], [9.6, 10.1], [10.1, 10.6], [10.6, 10.8], [10.8, G_LIMIT]];
// Each band is kept as it arrives, so a request that times out costs that band.
const BAND_DIR = path.join(ROOT, 'data-src', 'gaia-bands');

export const ENCODING = {
  LOG_MIN: -1, LOG_MAX: 5,
  MAG_MIN: -2, MAG_STEPS: 20,
  BV_MIN: -0.5, BV_STEPS: 80,
};

const DEG = Math.PI / 180;

async function fetchCsv() {
  console.log(`gaia: fetching ${BANDS.length} bands of brightness from CDS ...`);
  const rows = ['ra,dec,parallax,phot_g_mean_mag,bp_rp'];
  for (const [lo, hi] of BANDS) {
    const url = `${VIZIER}?-source=I/355/gaiadr3&-out=RA_ICRS,DE_ICRS,Plx,Gmag,BP-RP`
      + `&-out.max=unlimited&Gmag=${encodeURIComponent(`${lo}..${hi}`)}&RPlx=${encodeURIComponent('>5')}`;
    // curl rather than fetch: Node's fetch stalls on a response this long and
    // this slow to start, where curl just waits for it.
    const cache = path.join(BAND_DIR, `G${lo}-${hi}.tsv`);
    if (!fs.existsSync(cache)) {
      fs.mkdirSync(BAND_DIR, { recursive: true });
      execFileSync('curl', ['-sf', '--retry', '2', '--max-time', '2400', '-o', `${cache}.part`, url]);
      fs.renameSync(`${cache}.part`, cache);
    }
    const text = fs.readFileSync(cache, 'utf8');
    let n = 0;
    for (const line of text.split('\n')) {
      // Comments, the header, its units row and the dashed rule all start
      // with something that is not a digit.
      if (!/^\d/.test(line)) continue;
      const [ra, dec, plx, g, c] = line.split('\t').map((f) => f.trim());
      // A row on the upper edge of one band is the lower edge of the next.
      if (!(+g >= lo && +g < hi)) continue;
      rows.push(`${ra},${dec},${plx},${g},${c}`);
      n++;
    }
    console.log(`  G ${lo}..${hi}: ${n} stars`);
  }
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, `${rows.join('\n')}\n`);
  console.log(`  saved ${path.relative(ROOT, SRC)}`);
}

/** Same frame as build-data.mjs: Y to the north celestial pole. */
function equatorialToVec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), Math.sin(dec), -cd * Math.sin(ra)];
}

/** Gaia DR3 documentation, section 5.5.1: G - V as a cubic in BP - RP. */
function vFromG(g, c) {
  return g - (-0.02704 + 0.01424 * c - 0.2156 * c * c + 0.01426 * c * c * c);
}

// BP - RP against B - V along the main sequence, read off Gaia's own
// photometric calibration. Linear between the points is well inside the
// scatter a single colour can carry.
const BV_TABLE = [
  [-0.4, -0.3], [0, 0], [0.5, 0.38], [0.82, 0.65], [1, 0.8],
  [1.5, 1.15], [2, 1.45], [2.5, 1.55], [3.5, 1.8], [5, 2.1],
];
function bvFromBpRp(c) {
  if (!Number.isFinite(c)) return 0.65;
  if (c <= BV_TABLE[0][0]) return BV_TABLE[0][1];
  for (let i = 1; i < BV_TABLE.length; i++) {
    const [x1, y1] = BV_TABLE[i];
    if (c <= x1) {
      const [x0, y0] = BV_TABLE[i - 1];
      return y0 + ((c - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return BV_TABLE[BV_TABLE.length - 1][1];
}

/** Octahedral encoding: a unit vector in two numbers in [0, 65535]. */
function octEncode(x, y, z) {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = x / l1;
  let v = z / l1;
  if (y < 0) {
    const pu = (1 - Math.abs(v)) * Math.sign(u || 1);
    const pv = (1 - Math.abs(u)) * Math.sign(v || 1);
    u = pu;
    v = pv;
  }
  const q = (t) => Math.round(((t + 1) / 2) * 65535);
  return [q(u), q(v)];
}

/** Bright-star index over stars.bin, bucketed by direction, for the cross-match. */
function loadHyg() {
  const count = JSON.parse(fs.readFileSync(HYG_META, 'utf8')).count;
  const buf = fs.readFileSync(HYG);
  const pos = new Float32Array(buf.buffer, buf.byteOffset, count * 3);
  const mag = new Float32Array(buf.buffer, buf.byteOffset + count * 12, count);
  const cells = new Map();
  for (let i = 0; i < count; i++) {
    const key = cellKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(i);
  }
  return { pos, mag, cells };
}

const CELL = 0.004; // about 14 arcminutes of direction per cell
function cellKey(x, y, z) {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
}

// 6 arcseconds, generous because HYG positions are epoch J2000 and Gaia's are
// 2016: a high proper motion star moves several arcseconds in sixteen years.
const MATCH_COS = Math.cos((6 / 3600) * DEG);

function inHyg(hyg, x, y, z, v) {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = hyg.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const dot = x * hyg.pos[i * 3] + y * hyg.pos[i * 3 + 1] + z * hyg.pos[i * 3 + 2];
          if (dot > MATCH_COS && Math.abs(hyg.mag[i] - v) < 1.2) return true;
        }
      }
    }
  }
  return false;
}

function build() {
  console.log('gaia: cross-matching against stars.bin and packing ...');
  const hyg = loadHyg();
  const lines = fs.readFileSync(SRC, 'utf8').split('\n');
  const header = lines[0].split(',');
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rows = [];
  let duplicates = 0;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (f.length < header.length) continue;
    const ra = +f[col.ra];
    const dec = +f[col.dec];
    const plx = +f[col.parallax];
    const g = +f[col.phot_g_mean_mag];
    const c = f[col.bp_rp] === '' ? NaN : +f[col.bp_rp];
    if (!(plx > 0) || !Number.isFinite(g)) continue;
    const v = vFromG(g, Number.isFinite(c) ? c : 0.82);
    const [x, y, z] = equatorialToVec(ra, dec);
    // HYG is complete well past this, so anything brighter is already there.
    if (v < 6.5 || inHyg(hyg, x, y, z, v)) {
      duplicates++;
      continue;
    }
    rows.push({ x, y, z, pc: 1000 / plx, v, bv: bvFromBpRp(c) });
  }
  rows.sort((a, b) => a.v - b.v);

  const { LOG_MIN, LOG_MAX, MAG_MIN, MAG_STEPS, BV_MIN, BV_STEPS } = ENCODING;
  const out = Buffer.alloc(rows.length * 8);
  rows.forEach((s, i) => {
    const [u, w] = octEncode(s.x, s.y, s.z);
    const logPc = Math.min(LOG_MAX, Math.max(LOG_MIN, Math.log10(s.pc)));
    out.writeUInt16LE(u, i * 8);
    out.writeUInt16LE(w, i * 8 + 2);
    out.writeUInt16LE(Math.round(((logPc - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 65535), i * 8 + 4);
    out.writeUInt8(Math.max(0, Math.min(255, Math.round((s.v - MAG_MIN) * MAG_STEPS))), i * 8 + 6);
    out.writeUInt8(Math.max(0, Math.min(255, Math.round((s.bv - BV_MIN) * BV_STEPS))), i * 8 + 7);
  });
  fs.writeFileSync(OUT, out);
  fs.writeFileSync(META, JSON.stringify({
    source: 'ESA Gaia DR3 (gaiadr3.gaia_source)',
    query: QUERY.replace(/\s+/g, ' '),
    count: rows.length,
    magMin: rows[0].v,
    magMax: rows[rows.length - 1].v,
    encoding: ENCODING,
  }));
  console.log(`  ${rows.length} stars kept, ${duplicates} already in HYG`);
  console.log(`  ${path.relative(ROOT, OUT)} ${(out.length / 1048576).toFixed(1)} MB`);
}

if (process.argv.includes('--refetch') || !fs.existsSync(SRC)) await fetchCsv();
build();
