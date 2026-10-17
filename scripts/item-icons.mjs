// Loot icons for the 장수 screen (src/meta/loot.ts and lootEras.ts bases, except the 1592 weapons that have cards), made with Gemini's image model in the
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
  // The other chapters' pieces (src/meta/lootEras.ts).
  w_rapier: 'a late 16th-century European rapier with a long straight double-edged blade and a swept steel hilt with wire-wrapped grip',
  w_pike16: 'a 16th-century naval boarding pike: a long ash shaft with a narrow leaf-shaped iron head and iron langets',
  a_morion: 'a 16th-century Spanish morion helmet: polished steel comb, upturned brim pointed front and back, brass rivets',
  a_cabasset: 'a 16th-century cabasset helmet: almond-shaped steel bowl with a small stalk at the top and a narrow flat brim, brass rivets',
  a_breastplate: 'a 16th-century steel breastplate (peto) with a central ridge and a small dent from a musket ball proof mark, leather straps',
  a_gorget: 'a 16th-century steel gorget: articulated neck plates of an officer, etched and gilt edges',
  t_astrolabe: 'a 16th-century brass mariner\'s astrolabe: a heavy open-spoked ring with degree scale and a pivoting sighting alidade',
  b_vegetius: 'a leather-bound 16th-century printed book of Vegetius De re militari, worn brown calfskin with blind tooling and brass clasps',
  w_ropera: 'a 16th-century Spanish espada ropera: slender straight sword with a cup-and-ring hilt and a twisted wire grip',
  w_hanger: 'a 16th-century English hanger: short curved single-edged seaman\'s sword with a shell guard and wooden grip',
  t_fleece: 'the collar of the Order of the Golden Fleece: a gold chain of flint-and-steel links with a pendant golden ram fleece',
  t_chart: 'a rolled 16th-century hand-drawn portolan sea chart of the English Channel on vellum, partly unrolled, compass rose visible',
  b_arte: 'a 16th-century Spanish printed navigation book (Arte de navegar), vellum binding, open to a woodcut of a compass rose',
  b_mirror: 'a large 1588 atlas of sea charts (The Mariner\'s Mirror), leather binding, open to an engraved coastal chart',
  s_marque: 'an Elizabethan parchment letter of marque, folded, with a large red wax royal seal hanging on a ribbon',
  s_cedula: 'a 16th-century Spanish royal decree (real cédula) on paper, folded, with a paper-covered wax seal and a flourished signature',
  w_kilij: 'a 16th-century Ottoman kilij: a deeply curved sabre whose blade widens near the tip (yelman), gilt cross guard, dark grip',
  w_yatagan: 'an Ottoman yatagan: forward-curving single-edged short sword with an ivory eared grip and silver fittings',
  a_zirh: 'an Ottoman mail-and-plate shirt (zırh gömlek): fine riveted mail with small steel plates on the chest, laid flat',
  a_kaftan: 'a 16th-century Ottoman ceremonial kaftan of red and gold brocade silk with tulip patterns, folded',
  t_banner: 'the Holy League banner of Lepanto: blue damask standard with a crucifix, on a short gilded staff, folded softly',
  t_tug: 'an Ottoman tuğ standard: a short staff topped with a gilt finial and a long hanging horsetail plume',
  b_bahriye: 'an Ottoman illuminated manuscript of the Kitab-ı Bahriye, red leather binding with gold tooling, open to a painted map of an island',
  s_firman: 'an Ottoman imperial firman scroll partly unrolled showing a large gilded tughra calligraphic monogram',
  s_bull: 'a 16th-century papal bull: folded parchment with a round lead seal hanging from red and yellow silk cords',
  s_doge: 'a Venetian bronze seal matrix with the winged lion of Saint Mark, beside a red wax impression',
  w_naval_sword: 'a British naval officer\'s sword of 1805: slim slightly curved blade, gilt brass lion-head pommel, ivory grip, fouled-anchor guard',
  w_sabre_fr: 'a French Napoleonic naval officer\'s sabre: curved blade, gilt brass hilt with anchor emblem, black grip',
  w_espada: 'a Spanish 1800s naval officer\'s sword: straight blade with a gilt shell guard and a wire-bound grip',
  w_smallsword: 'an 18th-century officer\'s smallsword: thin triangular blade, ornate gilt shell hilt',
  w_axe: 'a Royal Navy boarding axe of 1805: a small iron axe head with a back spike on a wooden haft',
  w_pike: 'a short Royal Navy boarding pike of 1805: wooden shaft with a plain iron spike head',
  a_frockcoat: 'a 1805 naval officer\'s dark navy-blue frock coat with white facings and gold buttons, folded neatly',
  a_bicorne: 'a black felt 1805 naval officer\'s bicorne hat with a gold-laced cockade',
  a_epaulettes: 'a pair of 1805 admiral\'s gold bullion epaulettes with heavy fringe',
  a_sash: 'a folded red silk officer\'s waist sash with tasseled ends',
  t_trumpet: 'an 1805 brass ship\'s speaking trumpet, long conical and slightly dented',
  t_telescope: 'an 1805 brass and mahogany naval telescope, partly extended',
  t_sextant: 'a late 18th-century brass sextant with ebony handle, mirrors and arc scale',
  b_signals: 'a small bound naval signal book of 1805 with blue cloth boards, open to a printed table of colored signal flags',
  b_clerk: 'an 18th-century book "An Essay on Naval Tactics", calf binding, open to a printed diagram of two fleets in line',
  b_hoste: 'an old French book on naval tactics, calf binding with gilt spine, open to an engraving of ships in formation',
  b_ordenanzas: 'a Spanish 1793 navy ordinances book, vellum binding with a red title label, slightly worn',
  s_admiralty: 'an 18th-century Admiralty commission on parchment, folded, with three red wax seals and the anchor emblem',
  s_legion: 'the Légion d\'honneur medal of Napoleon\'s era: a white enamel five-armed star with a red ribbon',
  s_carlos3: 'the Order of Charles III cross: white and blue enamel cross with a gold image, on a light blue and white ribbon',
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
