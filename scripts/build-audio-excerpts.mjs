/**
 * Renders the soundtrack excerpts on the About page from the app's own
 * synthesiser: the same notes, instruments and rooms the app plays in each
 * kind of place, written through an OfflineAudioContext and encoded to MP3.
 *
 * Usage: node scripts/build-audio-excerpts.mjs   (expects the dev server on COSMINOVA_URL)
 * Writes site/music/excerpt-*.mp3.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';

const URL = process.env.COSMINOVA_URL ?? 'http://127.0.0.1:5179/';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve('site/music');
const SECONDS = 62;
const FADE = 5;

const EXCERPTS = [
  { file: 'excerpt-near-earth', piece: 'Hearth', mix: { home: 1 } },
  { file: 'excerpt-deep-space', piece: 'Drift', mix: { deep: 1 } },
  { file: 'excerpt-alien-world', piece: 'Glass Garden', mix: { alien: 1, land: 0.4 } },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(new globalThis.URL('src/engine/ambient.js', URL).href, { waitUntil: 'domcontentloaded' });

for (const { file, piece, mix } of EXCERPTS) {
  const wav = await page.evaluate(
    async ({ piece, mix, seconds, fade }) => {
      const { createAmbient } = await import('/src/engine/ambient.js');
      const rate = 44100;
      const ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const ambient = createAmbient({ context: ctx, autoResume: false, schedule: false });
      await ambient.start();
      ambient._internals.setGlideScale(0.001);
      ambient._internals.snap(mix);
      const played = ambient._internals.renderPiece(piece, 0.4);
      const buffer = await ctx.startRendering();

      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      let peak = 0;
      for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
      const gain = peak > 0 ? 0.89 / peak : 1;
      const fadeFrom = (seconds - fade) * rate;
      const frames = buffer.length;
      const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
      const text = (at, s) => [...s].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)));
      text(0, 'RIFF'); bytes.setUint32(4, 36 + frames * 4, true); text(8, 'WAVEfmt ');
      bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
      bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 4, true);
      bytes.setUint16(32, 4, true); bytes.setUint16(34, 16, true);
      text(36, 'data'); bytes.setUint32(40, frames * 4, true);
      for (let i = 0; i < frames; i++) {
        const envelope = i < fadeFrom ? 1 : Math.max(0, 1 - (i - fadeFrom) / (fade * rate));
        for (let c = 0; c < 2; c++) {
          const v = Math.max(-1, Math.min(1, channels[c][i] * gain * envelope));
          bytes.setInt16(44 + (i * 2 + c) * 2, v * 32767, true);
        }
      }
      let binary = '';
      const raw = new Uint8Array(bytes.buffer);
      for (let i = 0; i < raw.length; i += 0x8000) binary += String.fromCharCode(...raw.subarray(i, i + 0x8000));
      return { data: btoa(binary), played, peak };
    },
    { piece, mix, seconds: SECONDS, fade: FADE },
  );

  const tmp = path.join(OUT, `${file}.wav`);
  fs.writeFileSync(tmp, Buffer.from(wav.data, 'base64'));
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(OUT, `${file}.mp3`)]);
  fs.unlinkSync(tmp);
  console.log(
    `${file}.mp3  ${wav.played.name} as ${wav.played.mood}, piece ${wav.played.duration.toFixed(0)} s, ` +
      `excerpt ${SECONDS} s, raw peak ${wav.peak.toFixed(2)}`,
  );
}

await browser.close();
