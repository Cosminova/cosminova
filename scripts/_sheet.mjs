import sharp from 'sharp';
import fs from 'node:fs';
const [dir, out, cols = 5, width = 400] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/.test(f)).sort();
const tiles = await Promise.all(files.map((f) => sharp(`${dir}/${f}`).resize(+width).png().toBuffer({ resolveWithObject: true })));
const h = tiles[0].info.height;
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * width, height: rows * h, channels: 3, background: '#222' } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: (i % cols) * width, top: Math.floor(i / cols) * h })))
  .png().toFile(out);
console.log(files.join(' '));
