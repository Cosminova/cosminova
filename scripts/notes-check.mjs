/**
 * Reads the score as notes rather than as a level.
 *
 * The audition renders audio and measures it, which will tell you the score is
 * loud enough and does not clip, and will happily pass a piece with a wrong
 * note in it. This arranges every piece the way the player would hear it and
 * checks what was written: that each bar adds up to its metre, that every note
 * is in the key, that the left hand only plays the chord, that no note of the
 * tune lands a semitone above the harmony under it on a strong beat, and that
 * each tune has enough different pitches in it to be a tune.
 *
 * Usage: node scripts/notes-check.mjs [piece ...]
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5179/';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const spell = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (r.url() === `${URL}notes` && r.resourceType() === 'document') {
    r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>n</title>' });
    return;
  }
  r.continue();
});
await page.goto(`${URL}notes`, { waitUntil: 'domcontentloaded', timeout: 60000 });

const { errors, plans } = await page.evaluate(async (base) => {
  const mod = await import(`${base}src/engine/ambient.js`);
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const ambient = mod.createAmbient({ context: ctx, autoResume: false, schedule: false });
  await ambient.start();
  const inner = ambient._internals;
  const plans = [];
  for (const [mood, names] of Object.entries(inner.moods)) {
    for (const name of names) plans.push(inner.planPiece(name, mood));
  }
  return { errors: inner.errors, plans };
}, URL);

const wanted = process.argv.slice(2);
const failures = [...errors.map((e) => `notation: ${e}`)];
const seen = new Set();

for (const plan of plans) {
  if (wanted.length && !wanted.includes(plan.name)) continue;
  const tag = `${plan.name} (${plan.mood})`;
  const scale = new Set(plan.scale);
  const melodyPitches = new Set();
  let clashes = 0;
  let run = 0;
  let longestRun = 0;
  let prev = null;

  for (const [i, bar] of plan.bars.entries()) {
    const chord = new Set(bar.pcs);
    for (const e of bar.events) {
      const pc = ((e.note % 12) + 12) % 12;
      if (!scale.has(pc) && !chord.has(pc)) {
        failures.push(`${tag} bar ${i + 1}: ${spell(e.note)} is outside the key and the chord`);
      }
      if (e.part === 'lh' && !chord.has(pc)) {
        failures.push(`${tag} bar ${i + 1}: left hand plays ${spell(e.note)} over ${bar.chord}`);
      }
      if (e.part !== 'melody') continue;
      melodyPitches.add(e.note);
      // A note of the tune a semitone above a chord tone, and not itself in
      // the chord, is a minor ninth: fine in passing, wrong on a downbeat or
      // held. A major seventh — a semitone below — is the colour of half the
      // chords in here and is left alone.
      const strong = e.b === 0 || (e.dur ?? 0) >= 2;
      if (strong && !chord.has(pc) && [...chord].some((c) => (pc - c + 12) % 12 === 1)) {
        clashes++;
        failures.push(`${tag} bar ${i + 1}: ${spell(e.note)} rubs against ${bar.chord}`);
      }
      run = e.note === prev ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
      prev = e.note;
    }
  }

  if (melodyPitches.size < 7) failures.push(`${tag}: only ${melodyPitches.size} distinct pitches in the tune`);
  if (longestRun > 3) failures.push(`${tag}: one pitch struck ${longestRun} times running`);
  if (plan.duration < 45 || plan.duration > 200) {
    failures.push(`${tag}: ${plan.duration.toFixed(0)}s long`);
  }

  if (seen.has(plan.name)) continue;
  seen.add(plan.name);
  const first = plan.bars.find((b) => b.events.some((e) => e.part === 'melody'));
  const opening = plan.bars
    .slice(plan.bars.indexOf(first), plan.bars.indexOf(first) + 2)
    .flatMap((b) => b.events.filter((e) => e.part === 'melody').map((e) => spell(e.note)))
    .join(' ');
  console.log(
    `${plan.name.padEnd(18)} ${String(plan.bars.length).padStart(3)} bars  ` +
    `${plan.duration.toFixed(0).padStart(4)}s  ${String(melodyPitches.size).padStart(2)} pitches  ` +
    `${clashes} clashes   ${opening}`,
  );
}

await browser.close();

if (failures.length) {
  console.log('\nfailures:');
  for (const f of [...new Set(failures)]) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nnotes look musical');
