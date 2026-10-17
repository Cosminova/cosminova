/**
 * Piano scores for the soundtrack, engraved from the same note data the app
 * plays (src/engine/ambient.js), so the sheet music cannot drift from the
 * music.
 *
 * Writes site/music/<piece>.musicxml (opens in MuseScore, Finale, Sibelius,
 * Dorico) and site/music/<piece>.pdf, plus one book of all of them.
 *
 * The score is the written version: the app also varies the tempo by place,
 * sometimes takes the last statement up an octave, and adds a pad or celesta
 * out in space. None of that is notated.
 *
 * Usage: node scripts/build-sheet-music.mjs
 *   needs `verovio` resolvable (VEROVIO_DIR=/path/to/node_modules to point at
 *   a copy installed outside the project) and puppeteer-core with Chrome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { PIECES, FIGURES, leftHand, parseChord, parseBar, noteNumber } from '../src/engine/ambient.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'music');
const require = createRequire(process.env.VEROVIO_DIR ? path.join(process.env.VEROVIO_DIR, 'x.js') : import.meta.url);

const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Ab: -4 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SHARP_NAMES = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const DIV = 2; // divisions per quarter: an eighth is 1
const TYPES = { 1: ['eighth', 0], 2: ['quarter', 0], 3: ['quarter', 1], 4: ['half', 0], 6: ['half', 1], 8: ['whole', 0] };

function keyOf(scale) {
  const [tonic, mode] = scale.split(' ');
  // Lydian and aeolian are written in the key signature they share notes
  // with most naturally: A lydian as A major plus D sharps, A aeolian as A minor.
  const fifths = FIFTHS[tonic] ?? 0;
  const alters = {};
  for (const s of SHARP_ORDER) alters[s] = 0;
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((s) => (alters[s] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((s) => (alters[s] = -1));
  return { fifths, alters, mode: mode === 'aeolian' ? 'minor' : 'major' };
}

function spell(midi, key) {
  const [step, alter] = (key.fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[midi % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One staff's worth of a measure, with accidentals as a reader would expect them. */
class Staff {
  constructor(key, staff, voice) {
    this.key = key;
    this.staff = staff;
    this.voice = voice;
  }
  start() {
    this.seen = new Map();
  }
  pitch(midi) {
    const p = spell(midi, this.key);
    const id = p.step + p.octave;
    const current = this.seen.has(id) ? this.seen.get(id) : this.key.alters[p.step];
    let acc = '';
    if (current !== p.alter) {
      acc = p.alter === 1 ? 'sharp' : p.alter === -1 ? 'flat' : 'natural';
      this.seen.set(id, p.alter);
    }
    return { p, acc };
  }
  note(midis, divs, { beam = null, extra = '', notations = '' } = {}) {
    const [type, dot] = TYPES[divs] ?? ['quarter', 0];
    return midis.map((m, k) => {
      const { p, acc } = this.pitch(m);
      return `<note>${k ? '<chord/>' : ''}<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`
        + `<duration>${divs}</duration><voice>${this.voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}`
        + `${acc ? `<accidental>${acc}</accidental>` : ''}<staff>${this.staff}</staff>`
        + `${beam && !k ? `<beam number="1">${beam}</beam>` : ''}${notations ? `<notations>${notations}</notations>` : ''}${extra}</note>`;
    }).join('');
  }
  rest(divs, whole = false) {
    const [type, dot] = TYPES[divs] ?? ['quarter', 0];
    return `<note><rest${whole ? ' measure="yes"' : ''}/><duration>${divs}</duration><voice>${this.voice}</voice>`
      + `${whole ? '' : `<type>${type}</type>${dot ? '<dot/>' : ''}`}<staff>${this.staff}</staff></note>`;
  }
}

function measures(piece) {
  const out = [];
  const a = piece.sections.A;
  const count = piece.intro ?? a.chords.length;
  for (let i = 0; i < count; i++) out.push({ chord: a.chords[i % a.chords.length], melody: null, label: i === 0 ? 'Intro' : null });
  for (const name of piece.form) {
    if (name === 'intro') continue;
    const s = piece.sections[name];
    s.chords.forEach((chord, i) => out.push({ chord, melody: parseBar(s.melody[i]).notes, label: i === 0 ? name.replace('2', '′') : null }));
  }
  out.push({ chord: piece.ending.chord, ending: noteNumber(piece.ending.note), label: null });
  return out;
}

function musicXml(piece) {
  const key = keyOf(piece.scale);
  const bar = piece.meter * DIV;
  const rh = new Staff(key, 1, 1);
  const lh = new Staff(key, 2, 5);
  const figure = FIGURES[piece.lh][piece.meter];
  const list = measures(piece);
  const body = list.map((m, index) => {
    rh.start();
    lh.start();
    const chord = parseChord(m.chord);
    const tones = leftHand(chord, piece.lhLow ?? 36);
    let x = `<measure number="${index + 1}">`;
    if (index === 0) {
      x += `<attributes><divisions>${DIV}</divisions><key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`
        + `<time><beats>${piece.meter}</beats><beat-type>4</beat-type></time><staves>2</staves>`
        + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        + `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.bpm}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${piece.bpm}"/></direction>`
        + '<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>'
        + '<direction placement="below"><direction-type><words font-style="italic">con pedale, changing with each chord</words></direction-type><staff>2</staff></direction>';
    }
    if (m.label) x += `<direction placement="above"><direction-type><rehearsal>${esc(m.label)}</rehearsal></direction-type><staff>1</staff></direction>`;
    const symbol = chord.name.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');
    x += `<direction placement="above"><direction-type><words font-weight="bold">${esc(symbol)}</words></direction-type><staff>1</staff></direction>`;

    // Right hand.
    if (m.ending != null) {
      x += rh.note([m.ending], bar, { notations: '<fermata type="upright"/>' });
    } else if (!m.melody) {
      x += rh.rest(bar, true);
    } else {
      let at = 0;
      for (const n of m.melody) {
        const start = Math.round(n.beat * DIV);
        if (start > at) x += rh.rest(start - at);
        x += rh.note([n.note], Math.round(n.dur * DIV));
        at = start + Math.round(n.dur * DIV);
      }
      if (at < bar) x += rh.rest(bar - at);
    }
    x += `<backup><duration>${bar}</duration></backup>`;

    // Left hand: the figure, each step held until the next under the pedal.
    if (m.ending != null) {
      x += lh.note(tones, bar, { notations: '<arpeggiate/><fermata type="inverted"/>' });
    } else {
      const eighthRun = figure.every((s) => !Array.isArray(s.i)) && figure.length === piece.meter * 2;
      const group = piece.meter === 4 ? 4 : 6;
      figure.forEach((step, k) => {
        const start = Math.round(step.b * DIV);
        const next = k + 1 < figure.length ? Math.round(figure[k + 1].b * DIV) : bar;
        const notes = [].concat(step.i).map((i) => tones[Math.min(i, tones.length - 1)]);
        let beam = null;
        if (eighthRun) beam = k % group === 0 ? 'begin' : k % group === group - 1 ? 'end' : 'continue';
        x += lh.note(notes, next - start, { beam, notations: step.roll ? '<arpeggiate/>' : '' });
      });
    }
    x += index === list.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    return x + '</measure>';
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${esc(piece.name)}</work-title></work>
<movement-title>${esc(piece.name)}</movement-title>
<identification><creator type="composer">from the Cosminova soundtrack</creator><encoding><software>Cosminova build-sheet-music</software></encoding></identification>
<credit page="1"><credit-type>title</credit-type><credit-words default-x="1080" default-y="2650" justify="center" valign="top" font-size="22">${esc(piece.name)}</credit-words></credit>
<credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="1080" default-y="2560" justify="center" valign="top" font-size="11">${esc(piece.scale)} · from the Cosminova soundtrack</credit-words></credit>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${body}
</part>
</score-partwise>
`;
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const verovioDir = path.resolve(path.dirname(require.resolve('verovio')), '..');
const { default: createModule } = await import(path.join(verovioDir, 'dist/verovio-module.mjs'));
const { VerovioToolkit } = await import(path.join(verovioDir, 'dist/verovio.mjs'));
const tk = new VerovioToolkit(await createModule());
tk.setOptions({
  pageWidth: 2159,
  pageHeight: 2794,
  pageMarginTop: 120,
  pageMarginBottom: 120,
  pageMarginLeft: 130,
  pageMarginRight: 130,
  scale: 42,
  header: 'encoded',
  footer: 'none',
  breaks: 'auto',
  spacingSystem: 14,
});

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--no-sandbox'],
});
const page = await browser.newPage();
const sheet = (svgs) => `<!doctype html><html><head><style>
  @page { size: Letter; margin: 0 }
  body { margin: 0 }
  .p { width: 8.5in; height: 11in; page-break-after: always; overflow: hidden }
  .p:last-child { page-break-after: auto }
  .p svg { width: 100%; height: 100% }
</style></head><body>${svgs.map((s) => `<div class="p">${s}</div>`).join('')}</body></html>`;

const book = [];
for (const piece of PIECES) {
  const xml = musicXml(piece);
  fs.writeFileSync(path.join(OUT, `${slug(piece.name)}.musicxml`), xml);
  if (!tk.loadData(xml)) throw new Error(`verovio rejected ${piece.name}`);
  const svgs = [];
  for (let p = 1; p <= tk.getPageCount(); p++) svgs.push(tk.renderToSVG(p));
  book.push(...svgs);
  await page.setContent(sheet(svgs), { waitUntil: 'load' });
  await page.pdf({ path: path.join(OUT, `${slug(piece.name)}.pdf`), format: 'Letter', printBackground: true });
  console.log(`${piece.name}: ${svgs.length} page(s)`);
}
await page.setContent(sheet(book), { waitUntil: 'load' });
await page.pdf({ path: path.join(OUT, 'cosminova-piano-book.pdf'), format: 'Letter', printBackground: true });
await page.setViewport({ width: 850, height: 1100 });
await page.setContent(sheet(book.slice(0, 1)), { waitUntil: 'load' });
await page.screenshot({ path: path.join(OUT, 'preview.png') });
await browser.close();
console.log(`book: ${book.length} pages → site/music/`);
