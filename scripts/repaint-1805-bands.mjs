// The 1805 navies' painted gun-strake cell (red_paint) as clean long painted planks: the generated cells had gun ports
// painted in, which tiled along every strake beside the modelled ports and read as brickwork. The cell keeps its navy's
// own paint colour and takes the plank grain, seams, normal and roughness of the British deck cell.
//   node scripts/repaint-1805-bands.mjs   (rewrites public/textures/ships/{britain,france,spain1805}_{albedo,normal,rough}{,_1k}.webp)
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import layout from '../src/ships/build/atlasLayout.json' with { type: 'json' };

const DIR = 'public/textures/ships';
// Strake paint: the British and French yellow ochre of 1805, the Spanish red (the Santisima Trinidad's bands).
const COPY = { france: ['black_paint'], spain1805: ['black_paint', 'hull_plank'] };
const PAINT = { britain: [192, 146, 70], france: [182, 140, 74], spain1805: [142, 54, 40] };
const cellRect = (faction, name, size) => {
  const i = layout.factions[faction].findIndex((s) => s.name === name);
  const c = size / layout.grid;
  return { left: (i % layout.grid) * c, top: Math.floor(i / layout.grid) * c, width: c, height: c };
};

for (const sfx of ['', '_1k']) {
  const size = sfx ? 1024 : 2048;
  const src = (f, map) => `${DIR}/${f}_${map}${sfx}.webp`;
  // Grain from the British deck: long planks with seams; luminance normalised to mean 1.
  const deck = cellRect('britain', 'deck_plank', size);
  const g = await sharp(readFileSync(src('britain', 'albedo'))).extract(deck).greyscale().raw().toBuffer();
  const mean = g.reduce((a, v) => a + v, 0) / g.length;
  // Normal and roughness maps are smaller than the albedo: each cell is taken at its own map's size.
  const sizeOf = async (file) => (await sharp(readFileSync(file)).metadata()).width;
  const deckCell = async (map) => {
    const n = await sizeOf(src('britain', map));
    return sharp(readFileSync(src('britain', map))).extract(cellRect('britain', 'deck_plank', n)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const deckNormal = await deckCell('normal');
  const deckRough = await deckCell('rough');
  for (const f of ['britain', 'france', 'spain1805']) {
    const band = cellRect(f, 'red_paint', size);
    const med = PAINT[f];
    const out = Buffer.alloc(g.length * 3);
    for (let i = 0; i < g.length; i++) {
      const l = Math.pow(g[i] / mean, 1.15);
      for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.max(0, Math.min(255, Math.round(med[k] * l)));
    }
    const cell = await sharp(out, { raw: { width: band.width, height: band.height, channels: 3 } }).png().toBuffer();
    const put = async (map, input, raw) => {
      const file = src(f, map);
      const at = cellRect(f, 'red_paint', await sizeOf(file));
      const img = sharp(readFileSync(file));
      const buf = await img.composite([{ input, raw, left: at.left, top: at.top }]).webp({ quality: 80 }).toBuffer();
      writeFileSync(file, buf);
    };
    await put('albedo', cell);
    await put('normal', deckNormal.data, deckNormal.info);
    await put('rough', deckRough.data, deckRough.info);
    // The Spanish and French black strakes and the Spanish hull planks were short boards that tiled into a brick
    // pattern: they take the British cells (long planks, the same black paint), every map.
    for (const name of COPY[f] ?? []) {
      for (const map of ['albedo', 'normal', 'rough']) {
        const from = src('britain', map);
        const n = await sizeOf(from);
        const c = await sharp(readFileSync(from)).extract(cellRect('britain', name, n)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const file = src(f, map);
        const at = cellRect(f, name, n);
        writeFileSync(file, await sharp(readFileSync(file)).composite([{ input: c.data, raw: c.info, left: at.left, top: at.top }]).webp({ quality: 80 }).toBuffer());
      }
    }
    console.log(f, sfx || '2k', 'paint', med.join(','));
  }
}
