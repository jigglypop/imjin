// Loot icons for the 장수 screen (src/meta/loot.ts bases other than weapons), made with Gemini's image model in the
// style of the weapon cards (public/ui/weapons): one object, studio-lit, on flat charcoal. Originals and provenance in
// assets-src/item-icons-2026-10-17/, 128 px webp in public/ui/items/.
// node --env-file=.env scripts/item-icons.mjs [id ...]   (no ids: every icon missing its original)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { geminiImage, geminiModel } from './gemini-image.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'assets-src', 'item-icons-2026-10-17');
const OUT = join(ROOT, 'public', 'ui', 'items');
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });

const ITEMS = {
  a_cheomju: 'a Joseon dynasty 16th-century iron helmet (cheomju) with a flat brim, riveted bowl, small finial on top, and a lacquered neck guard of overlapping plates',
  a_gyeoncheol: 'a pair of 16th-century East Asian iron shoulder guards (pauldrons) made of overlapping lacquered iron scales laced with red silk cord',
  a_hwan: 'a pair of 16th-century Korean archer bracers (hohwan): dark leather arm guards reinforced with small brass-riveted iron splints, tied with cords',
  a_gapsang: 'a 16th-century East Asian armored skirt (tassets): rows of small lacquered iron lamellae laced with red cord hanging from a cloth belt',
  t_deungchae: 'a Joseon general\'s command whip (deungchae): a slender rattan rod wrapped with red cord, with a tassel and a metal cap at the grip',
  t_jihwibong: 'a Joseon general\'s command baton: a short polished black lacquered staff with gilt bronze ends and a long red silk tassel',
  t_gunseon: 'a Japanese warrior\'s iron war fan (tessen), half open, black lacquered ribs and a red sun disc on a gold leaf',
  t_nagak: 'a conch shell signal horn (nagak) with a bronze mouthpiece and a braided red cord sling',
  t_sinjeon: 'a Joseon command arrow (sinjeon): a single arrow with a small red pennant tied to the shaft and a tag, black fletching',
  b_sonja: 'an old Chinese bound book of Sun Tzu\'s Art of War, thread-bound, faded indigo cover with a paper title label, slightly worn',
  b_ojak: 'an old thread-bound East Asian military treatise, brown cover with a paper title label, some loose bamboo slips beside it',
  b_gihyo: 'an old thread-bound Ming military manual with an ochre cover, opened slightly to show woodblock-printed diagrams of soldiers',
  b_yukdo: 'a bundle of ancient bamboo strip scrolls tied with cord, a classic Chinese strategy text',
  b_byeonghak: 'an old Joseon thread-bound drill manual with a dark green cover and a paper title label, corners worn',
  s_byeongbu: 'a Joseon military tally (byeongbu): a round wooden token cut into two separate halves lying side by side, slightly apart, each half carved with characters, a red cord',
  s_janggunin: 'a bronze general\'s seal with a turtle-shaped handle, square base, red seal paste on the face',
  s_mapae: 'a Joseon round bronze horse tablet (mapae) with embossed horses on its face and a short cord loop',
  s_gyoseo: 'a royal Joseon square jade seal with a dragon handle, a gold cord tassel, beside a small red-sealed document',
};

const STYLE = 'Game inventory icon in exactly the style of the reference image: a single realistic object, photographed like a museum product shot, soft studio light, centered and filling about 80% of the frame, diagonal or three-quarter view, on a flat plain charcoal background (#1b1b1b) with no shadow pattern, no text, no frame, no border, no other objects unless stated. The object: ';
const ref = await sharp(join(ROOT, 'public', 'ui', 'weapons', 'joseon_hwando.webp')).png().toBuffer();
const provFile = join(SRC, 'provenance.json');
const prov = existsSync(provFile) ? JSON.parse(readFileSync(provFile, 'utf8')) : { note: 'Loot icons, Gemini image edit with the hwando weapon card as the style reference (OpenAI images out of credit 2026-10-17).', items: {} };

/** Crops a thin edge (the model sometimes draws a light frame) and writes the 128 px icon. */
async function toIcon(png, id) {
  const { width, height } = await sharp(png).metadata();
  const m = Math.round(width * 0.035);
  await sharp(png).extract({ left: m, top: m, width: width - 2 * m, height: height - 2 * m }).resize(128, 128).webp({ quality: 86 }).toFile(join(OUT, `${id}.webp`));
}
if (process.argv.includes('--icons-only')) {
  for (const id of Object.keys(ITEMS)) await toIcon(readFileSync(join(SRC, `${id}.png`)), id);
  process.exit(0);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ITEMS).filter((id) => !existsSync(join(SRC, `${id}.png`)));
for (const id of ids) {
  const prompt = STYLE + ITEMS[id];
  const png = await geminiImage(prompt, { aspect: '1:1', image: ref });
  writeFileSync(join(SRC, `${id}.png`), png);
  await toIcon(png, id);
  prov.items[id] = { tool: 'gemini image edit', model: geminiModel(), prompt, styleReference: 'public/ui/weapons/joseon_hwando.webp', date: '2026-10-17', estimatedUsd: 0.04, takes: (prov.items[id]?.takes ?? 0) + 1 };
  writeFileSync(provFile, JSON.stringify(prov, null, 2) + '\n');
  console.log(id);
}
