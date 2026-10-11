// Mechanical image export only. Semantic portrait changes are generated with imagegen.
// node scripts/install-cinematic-portraits.mjs <local imagegen receipt.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const receipt = process.argv[2];
if (!receipt) throw new Error('Pass a local receipt containing id, faction, prompt and source for all 18 portraits.');
const expected = ['admiral', 'yi', 'won', 'eokgi', 'jeongun', 'eo', 'kwon', 'anwi', 'japan', 'wakisaka', 'todo', 'kuki', 'kato', 'kurushima', 'shimazu', 'konishi', 'chenlin', 'deng'].map(id => `portrait_${id}`);
const rows = JSON.parse(await fs.readFile(receipt, 'utf8'));
const selected = new Map(rows.map(row => [row.id, row]));
if (selected.size !== expected.length || expected.some(id => !selected.has(id))) throw new Error('The receipt must cover exactly the 18 existing commanders.');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const manifest = {
  provider: 'OpenAI imagegen tool',
  generatedAt: '2026-10-11',
  artDirection: 'Original live-action naval film casting; weathered skin, cloth and metal; distinct Joseon, Sengoku Japan and late-Ming costumes. Artistic interpretations of historical commanders.',
  export: { width: 768, height: 768, format: 'jpeg', quality: 88, progressive: true },
  assets: [],
};
await fs.mkdir('public/ui/portraits', { recursive: true });
await fs.mkdir('shots/portraits-2026-10-11', { recursive: true });
const tiles = [];
for (const [index, id] of expected.entries()) {
  const row = selected.get(id);
  const source = await fs.readFile(row.source);
  const meta = await sharp(source).metadata();
  if (meta.width < 768 || meta.height < 768) throw new Error(`${id}: generated source is too small`);
  const output = await sharp(source).resize(768, 768, { fit: 'cover' }).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
  const file = `public/ui/portraits/${id}.jpg`;
  await fs.writeFile(file, output);
  manifest.assets.push({ id, faction: row.faction, file, sourceFile: path.basename(row.source), sourceSha256: sha(source), sha256: sha(output), bytes: output.length, prompt: row.prompt });
  tiles.push({ input: await sharp(output).resize(256, 256).toBuffer(), left: index % 6 * 256, top: Math.floor(index / 6) * 288 });
  const label = `<svg width="256" height="32"><rect width="256" height="32" fill="#151b22"/><text x="10" y="22" font-family="sans-serif" font-size="15" fill="white">${id} / ${row.faction}</text></svg>`;
  tiles.push({ input: Buffer.from(label), left: index % 6 * 256, top: Math.floor(index / 6) * 288 + 256 });
}
await fs.writeFile('scripts/portrait-art-direction.json', JSON.stringify(manifest, null, 2) + '\n');
await sharp({ create: { width: 1536, height: 864, channels: 3, background: '#151b22' } }).composite(tiles).png().toFile('shots/portraits-2026-10-11/cinematic-contact-sheet.png');
console.log(JSON.stringify({ portraits: manifest.assets.length, bytes: manifest.assets.reduce((sum, a) => sum + a.bytes, 0), largest: Math.max(...manifest.assets.map(a => a.bytes)) }));
