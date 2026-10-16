// Armor art for the armory (갑옷): every armor of src/meta/catalog.ts on its stand, and each famous general's portrait
// in every armor he can wear but his faction's basic one, which is his plain portrait (gpt-image 2.5). Resumable: an
// item whose raw webp exists in assets-src/armor-2026-10-16/src/ is not generated again unless --force.
//
//   node scripts/generate-armor-art.mjs                        generate what is missing, convert, write provenance
//   node scripts/generate-armor-art.mjs --only japan_oyoroi,yi_joseon_eorin
//                                                              some items: a card is its armor id, a portrait
//                                                              <general>_<armor>, the empty stand `stand`
//   node scripts/generate-armor-art.mjs --force                regenerate the chosen items (the old raw moves to rejected/)
//   node scripts/generate-armor-art.mjs --convert              only (re)cut the webp files from the raws
//   node scripts/generate-armor-art.mjs --note "why"           stored with the request (use when redoing one)
//   node scripts/generate-armor-art.mjs --dry                  print the prompts, send nothing
//   node scripts/generate-armor-art.mjs --sheets <dir>         contact sheets of the exports, for review
//   node scripts/generate-armor-art.mjs --jobs 2               requests in flight
//
// The cards all edit one generated picture of the empty stand (ref/stand.webp), so they share its room, camera and
// light; a portrait edits the general's raw portrait (assets-src/commanders-2026-10-16/src) so his face stays his.
// Every request is counted in the provenance, failed ones too, and none is sent past --max-requests (default 160).
// Output: public/ui/armor/<armor>.webp (768x1152) and _sm (192x288), public/ui/portraits/armored/<general>_<armor>.webp
// (768) and _sm (192), the paths armorCardUrl and armoredPortraitUrl in catalog.ts give.
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import { ARMORS, GENERALS, armorsFor, basicArmor } from '../src/meta/catalog.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const SRC = join(ROOT, 'assets-src', 'armor-2026-10-16');
const RAW = join(SRC, 'src');
const REJECTED = join(SRC, 'rejected');
const PROV = join(SRC, 'provenance.json');
const FACES = join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src');
const OUT_CARD = join(ROOT, 'public', 'ui', 'armor');
const OUT_PORTRAIT = join(ROOT, 'public', 'ui', 'portraits', 'armored');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FORCE = args.includes('--force');
const CONVERT_ONLY = args.includes('--convert');
const DRY = args.includes('--dry');
const ONLY = opt('only', '').split(',').filter(Boolean);
const NOTE = opt('note', '');
const JOBS = Number(opt('jobs', 2));
const SHEETS = opt('sheets', '');
const MAX_REQUESTS = Number(opt('max-requests', 160));
const MODEL = 'gpt-image-2.5-sunburst';
const QUALITY = 'high';
// USD per million tokens, the gpt-image-2 list prices; the 2.5 preview is not priced publicly, so totals are estimates.
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 };

// ---------- art direction ----------

const MATERIALS =
  'Museum-grade practical film-prop materials worn by real use at sea: rubbed iron, chipped and crazed lacquer, salt-stained cloth and cord, ' +
  'every rivet, plate edge, lace and lacquer chip readable, nothing that looks new, plastic or like a costume. ';
const BANS =
  'No painting or illustration look, no plastic CGI, no fantasy ornament, no modern items, no text, no letters, no numbers, no logo, no watermark, no border, no frame. ' +
  'No clan crest, emblem or symbol on the armor or the helmet unless one is described. ' +
  'No rising sun flag, no sunburst or radiating rays and no red sun disc anywhere. ';
const FILM = 'Shallow depth of field, desaturated filmic grade, subtle 35mm grain. ';

const STAND =
  'Vertical live-action period film still: the inside of a dim timber armory at a sixteenth-century East Asian naval base. ' +
  'In the middle of the floor stands one plain empty armor stand of dark oiled wood, seen in a three-quarter front view: a heavy square foot on the floor, ' +
  "one upright post, a horizontal shoulder bar at the height of a man's shoulders and, above it, a short neck post ending in a smooth rounded wooden knob where a helmet would rest. " +
  'The stand is as tall as a tall man and fills about three quarters of the frame height, centred, with clear empty space above the knob and the floor visible all round its foot. ' +
  'Dark weathered plank walls and heavy timber posts, a worn plank floor, a few closed wooden armor chests far behind in deep shadow and out of focus. ' +
  'A small high window on the left lets a shaft of cool grey sea daylight fall across the stand; on the right an unseen oil lantern lays a warm rim of light along its edge. ' +
  'Fine dust floats in the light. Camera at chest height, 50 mm lens. ' + FILM +
  'No person, no armor, no clothing, no weapons, no flags or banners, no text, no letters, no logo, no border.';

const CARD =
  'Edit this vertical film still. Keep the armory, the place of the stand, the camera, the lens, the light and the grade exactly as they are, ' +
  'and dress the empty stand in one complete armor with its helmet, displayed the way a museum displays a suit of armor: the body armor hangs from the shoulder bar ' +
  'and falls to its full length as if worn, the shoulder guards sit on the ends of the bar, the helmet rests on the knob on top with its neck guard hanging round it. ' +
  'The stand has no face and no head: inside the helmet and the open neck of the armor there is only deep shadow, the collar, throat guard and neck guard closing over the top of the stand, ' +
  'so its shoulder bar and post are hidden there and no cross of bare wood shows between them. No leg armor, no boots, no gloves. ' +
  'The whole armor and helmet, plume or crest included, stays entirely inside the frame with a clear margin above, below and on both sides, ' +
  'and fills most of the frame height so that it reads at a small size. ';
const CARD_BANS = 'No person, no mannequin, no hands, no weapons, no flags or banners. ';

const PORTRAIT = (who) =>
  `Edit this square film still of ${who}. Keep the man exactly as he is: the same face and identity, age, skin, wrinkles, beard and moustache, ` +
  'the same expression and gaze, the same head size, angle and position in the frame (helmet to upper chest, face centred and large), ' +
  'and the same background, light, colour grade, depth of field and grain. Change only what he wears: replace his armor and his headgear completely ' +
  'with the armor described here, fitted to him the way real armor is worn, the new helmet sitting on his head at the same height and framing his face as before; ' +
  'the whole helmet with its plume or crest stays inside the frame with a little margin above it. ';

const WHO = {
  yi: 'Yi Sun-sin, the Joseon admiral, about fifty',
  won: 'Won Gyun, a heavyset Joseon admiral in his early fifties',
  eokgi: 'Yi Eok-gi, a young Joseon admiral of about thirty',
  wakisaka: 'Wakisaka Yasuharu, a Japanese naval lord in his late thirties',
  kuki: 'Kuki Yoshitaka, a Japanese pirate-navy lord in his fifties',
  kato: 'Kato Yoshiaki, a clean-shaven Japanese naval commander of about thirty',
  todo: 'Todo Takatora, a tall Japanese commander of about forty',
  konishi: 'Konishi Yukinaga, a Japanese commander of about forty',
  shimazu: 'Shimazu Yoshihiro, the Satsuma lord in his late fifties',
  chenlin: 'Chen Lin, the Ming admiral in his fifties',
  deng: 'Deng Zilong, the Ming commander over seventy',
};
// What a general keeps or loses from his plain portrait whatever armor he wears: a surcoat or cloak would hide the
// armor that the picture is for.
const KEEP = {
  konishi: 'Keep the small plain wooden cross hanging at his collar. ',
  shimazu: 'He no longer wears the white surcoat: the armor is seen whole. ',
  chenlin: 'He no longer wears his red cloak, only a cape if the armor described has one: the armor is seen whole. ',
};

// One look per armor, shared by its card and the portraits; `stand` and `worn` replace a part that differs on the stand.
const LOOK = {
  joseon_dujeong:
    'Joseon Korean dujeong-gap, the brigandine of the Joseon army: a long coat of thick oxblood-red cotton reaching below the knee, lined inside with overlapping iron plates, ' +
    'its whole face set with even rows of round brass rivet heads, a plain dark cloth belt, the cloth faded and salt-stained at the hem and the brass dulled with verdigris. ' +
    'Helmet: a low rounded Korean iron tugu helmet with a small spike finial and a red horsehair plume, and a long oxblood cloth neck curtain set with the same brass rivets.',
  joseon_pigap:
    'Joseon Korean pigap, leather lamellar: a knee-length coat of hundreds of small rawhide plates lacquered black and laced in tight horizontal rows with dark brown leather cord, ' +
    'the lacquer rubbed through to brown leather on the edges and creases, plain leather shoulder guards of larger lacquered plates, a leather belt; dark, matte and practical, ' +
    "a soldier's armor rather than a lord's. Helmet: a plain dark iron bowl helmet with riveted bands and a neck guard of black-lacquered leather strips, no plume.",
  joseon_swaeja:
    'Joseon Korean swaeja-gap, mail armor: a knee-length coat of riveted iron mail, thousands of small tight rings with a dull grey sheen and spots of rust, ' +
    'worn over a padded dark navy cotton coat whose quilted collar and cuffs show, a dark leather belt; the whole armor reads silver-grey with a fine ring texture. ' +
    'Helmet: an iron tugu helmet with a short red tassel and a mail aventail of the same rings hanging from its rim over the neck and shoulders.',
  joseon_gyeongbeon:
    "Joseon Korean gyeongbeon-gap, a commander's mail-and-plate armor: a knee-length coat of iron mail set front and back with rows of small polished rectangular iron plates joined by the rings, " +
    'and a large round polished iron mirror plate on the chest; the polished plates catch the light like small mirrors against the darker mail, red cloth trim at the hem and collar. ' +
    'Helmet: a polished iron tugu helmet with a tall red horsehair plume and a mail aventail.',
  joseon_eorin:
    "Joseon Korean eorin-gap, a high general's fish-scale armor: a long coat covered in small rounded overlapping gilt-bronze scales laid like the scales of a fish, " +
    'on a deep crimson silk ground that shows at the edges and the collar, gilded scale shoulder guards; the gilding rubbed back to warm bronze on the raised edges, restrained and real. ' +
    'Helmet: an iron tugu helmet banded with gilt bronze, with a red horsehair plume and a neck guard of the same gilt scales.',

  japan_tosei:
    'Sengoku Japanese tosei gusoku: a black-lacquered iron okegawa-do cuirass of riveted horizontal plates, a skirt of kusazuri tassets of lacquered plates laced in dark blue cord, ' +
    'black sode shoulder guards, kote sleeves of mail and small plates on dark cloth. ' +
    'Helmet: a black suji-bachi kabuto with raised ribs, a wide flaring shikoro neck guard laced in dark blue and small turned-back fukigaeshi, no crest.',
  japan_haramaki:
    'Sengoku Japanese haramaki, a light lamellar armor: small black-lacquered scales laced closely in rows with dark green silk cord, wrapped round the body and closing at the back, ' +
    'a short skirt of tassets of the same green-laced scales, small shoulder guards; light and modest, its green lacing is its colour. ' +
    'Helmet: a simple smooth black zunari kabuto, a plain rounded iron bowl with a short shikoro laced in dark green, no crest.',
  japan_nimaido:
    'Sengoku Japanese nimai-do gusoku: a two-piece hinged iron cuirass of broad smooth plates in austere glossy black lacquer with almost no decoration, black-laced tassets, ' +
    'plain black sode shoulder guards; severe and spare. Helmet: a smooth black zunari kabuto with one plain gilt fore-plate on its front, a small smooth gold shield with no design on it.',
  japan_nanbando:
    'Sengoku Japanese nanban-do gusoku: a European steel peascod breastplate with a sharp central ridge, bright polished steel with rust freckles and one round dent where a test bullet struck it, ' +
    'worn with Japanese black-lacquered kusazuri tassets laced in dark blue, mail-and-plate kote sleeves and lacquered sode shoulder guards. ' +
    'Helmet: a European steel morion with a ridged crown and a curved brim, adapted the Japanese way with a black-lacquered shikoro neck guard laced to its rim.',
  japan_oyoroi:
    'Japanese o-yoroi, the old great armor and a treasured heirloom: a box-like cuirass of small vermilion-lacquered scales laced in dense rows of scarlet silk cord with bands of white silk lacing, ' +
    'large flat rectangular o-sode shoulder boards of the same scales, a plain dark leather panel on the breast, the vermilion softened and crazed by age, the gilt fittings worn. ' +
    'Helmet: a hoshi-kabuto of riveted plates with prominent rivet heads, large flaring fukigaeshi and a deep shikoro laced in scarlet, no emblem.',

  ming_dingjia:
    'Late-Ming Chinese dingjia brigandine: a long coat of brick-red cotton reaching below the knee, lined with iron plates and studded with rows of round brass studs, a round collar, ' +
    'broad studded shoulder pieces, a dark belt; faded and salt-stained. ' +
    'Helmet: a rounded Ming steel helmet with a spike finial carrying a thick red horsehair tassel, and a brick-red cloth neck curtain studded with brass.',
  ming_myeongap:
    'Late-Ming Chinese mianjia, cotton armor: a thick padded coat of quilted cotton in faded ochre-red, quilted in close horizontal channels with heavy stitching and a few brass studs along the seams, ' +
    'soft and bulky, frayed at the hems and collar, no metal plates showing. ' +
    'Helmet: a padded quilted cloth helmet of the same ochre cotton with ear flaps and a short red tassel, no metal.',
  ming_swaeja:
    'Late-Ming Chinese mail armor: a riveted mail coat of small steel rings, grey with a dull sheen and spots of rust, worn over a long red robe whose skirts and sleeves show below it, a leather belt. ' +
    'Helmet: a round Ming steel helmet with a red tassel and a mail aventail.',
  ming_yuyeop:
    'Late-Ming Chinese willow-leaf lamellar, liuye-jia: long narrow steel plates pointed like willow leaves, laced in overlapping rows with red cord and worn over a red robe, ' +
    'the polished steel catching the light, broad lamellar shoulder guards of the same leaves. ' +
    'Helmet: a tall pointed Ming steel helmet with a red tassel and a neck guard of willow-leaf plates.',
  ming_sanmun:
    "Late-Ming Chinese shanwen-jia, a high general's armor: bright steel plates each shaped like a three-peaked mountain, interlocking in a dense woven pattern, their edges lined with gilt, " +
    'a round gilt-rimmed steel mirror on the chest, broad gilt-edged shoulder guards, a short dark-red cape over the shoulders; silver steel with gold trim. ' +
    'Helmet: a steel helmet with gilt bands and rim and a tall red tassel.',

  yi_tongjesa:
    'The personal armor of Yi Sun-sin, Supreme Naval Commander of the Three Provinces of Joseon: a long dujeong-gap coat of deep crimson silk, a darker and richer red than any soldier\'s coat, ' +
    'with a soft sheen in its folds, faced with dense close rows of bright gilt rivet heads so that the whole coat glints gold; a thick dark brown fur collar and fur-trimmed cuffs, ' +
    'a broad belt of gilt lacquer with gilt plaques across the waist, wide shoulder flaps edged in gilt; the silk darkened and frayed by salt and smoke, the gilt rubbed, dignified and war-worn. ' +
    'Helmet: a black-lacquered iron tugu helmet with bright gilt bands and a gilt finial, a long full crimson horsehair plume falling to the shoulder, and a crimson neck curtain set with gilt rivets.',
  won_heukcheol:
    'The personal armor of Won Gyun: a heavy coat of broad blackened iron lames, each as wide as a palm and riveted in overlapping rows, far heavier than leather lamellar, ' +
    'their raised edges catching a cold grey iron sheen, laced with dark blue cord over a dark blue cloth coat whose collar and sleeves show; dented, scraped and rusted in the seams, ' +
    'heavy riveted iron shoulder guards standing out from the shoulders, dark blue cloth skirts below; dark, massive and menacing. ' +
    'Helmet: a heavy black iron tugu helmet with a riveted iron brow band, a neck guard of broad overlapping iron lames and a tall black horsehair plume.',
  eokgi_cheonggap:
    'The personal armor of Yi Eok-gi: a dujeong-gap coat of deep lapis-blue silk with a soft sheen, faced with neat rows of bright silver rivets, the collar and hems edged in silver-grey silk, ' +
    "a slim dark belt with silver fittings; refined and well kept, a young admiral's armor. " +
    'Helmet: a dark iron tugu helmet with silver bands and a red horsehair plume, and a blue silk neck curtain with silver rivets.',
  wakisaka_shichihon:
    'The personal armor of Wakisaka Yasuharu: a black-lacquered tosei gusoku with every plate edge lined in gold lacquer, laced throughout in deep purple silk cord, purple-laced tassets and sode shoulder guards. ' +
    'Helmet: a black kabuto with a purple-laced shikoro and a tall plain upright fore-crest of gold leaf, a simple tapering blade with no emblem.',
  kuki_tetsu:
    'The personal armor of Kuki Yoshitaka, master of the iron-clad ships: a gusoku of dark iron plates overlapping like the iron plating of his ships, set with rows of heavy rivet heads, ' +
    'the iron blackened and salt-rusted, laced in indigo cord. Helmet: a black kabuto with a wide shikoro laced in indigo and a restrained crest of a thin gilt crescent moon on its front.',
  kato_teppo:
    'The personal armor of Kato Yoshiaki, a gunner captain: a practical gusoku lacquered in brown persimmon lacquer, the brown worn and scratched through to the iron, laced in leather-coloured cord, ' +
    'plain brown sode shoulder guards; a working armor. Helmet: a brown-lacquered kabuto with a long curved horn-like crest sweeping out to both sides.',
  todo_tokan:
    "The personal armor of Todo Takatora: his famous tokan-nari kabuto, modelled on the hat of a Chinese court official: a smooth rounded black-lacquered bowl rising at the back " +
    'into a taller rounded crown, the whole a soft rounded cap shape, not a cylinder and not a top hat; from the back of the crown two very long, narrow, flat black-lacquered wings ' +
    'stand straight out to the left and right like thin blades widening a little at the tips, each longer than the helmet is wide; a black shikoro neck guard laced in dark blue below. ' +
    'Worn over a black-lacquered gusoku laced in dark blue with black sode shoulder guards.',
  konishi_gin:
    'The personal armor of Konishi Yukinaga: a lamellar gusoku of silver-lacquered plates laced in white silk cord, the silver leaf rubbed to dark iron at the edges, white-laced tassets and sode shoulder guards; bright and cool. ' +
    'Helmet: a silvered kabuto with a white-laced shikoro, no crest.',
  shimazu_oni: {
    armor:
      'The personal armor of Shimazu Yoshihiro, the demon Shimazu of Satsuma: a black-lacquered gusoku laced in scarlet silk cord, black plates and scarlet lacing in hard contrast, ' +
      'scarlet-laced tassets and sode shoulder guards; fierce. An iron menpo face mask with a bristling moustache %MASK%. Helmet: a black kabuto with a scarlet-laced shikoro, no emblem.',
    stand: 'is fitted under the brim of the helmet where a face would be, empty behind its eye holes',
    worn: 'hangs by its cords at his chest, his face uncovered',
  },
  chenlin_dudok:
    'The personal armor of Chen Lin, admiral of the Ming fleet: gilded shanwen armor, the whole armor of interlocking mountain-pattern plates finished in gold, gilt shoulder guards and a gilt chest mirror, ' +
    'and a sweeping crimson cape wrapped over the shoulders and falling behind; gold and crimson. Helmet: a gilt helmet with a thick red tassel and a gilt-studded red neck curtain.',
  deng_nojang:
    'The personal armor of Deng Zilong, a commander of over seventy: old steel lamellar blackened by soot and gunpowder smoke, the plate edges scorched and heat-tinted blue and bronze, ' +
    'the lacing frayed and patched; plain and battle-old. Helmet: a plain steel helmet with a faded red tassel.',
};
// Framing that one armor needs beyond the rest.
const FRAME = {
  todo_tokan: {
    stand: 'Both wings of the helmet, tip to tip, are entirely inside the frame with a margin on each side. ',
    worn: 'Both long wings of the helmet, tip to tip, are entirely inside the frame with a clear margin on each side. ',
  },
};
// Asked to pull the camera back, the edit keeps the head size anyway, so a portrait whose crest ran out of the frame
// at the plain portrait's scale (the tokan wings, Wakisaka's gold blade, the morion comb over Shimazu's high-set head)
// is shrunk first and the edit fills the new margin.
const ZOOM = { todo_todo_tokan: 0.8, wakisaka_wakisaka_shichihon: 0.85, shimazu_japan_nanbando: 0.88 };
const ZOOMED =
  'The picture has been zoomed out so that the whole helmet, its crest, comb or wings to their tips, fits inside the frame with a clear margin above and at the sides: ' +
  'its blurred border is only a placeholder, continue the deck, rigging, sea and sky naturally into it. ';

const lookOf = (id, where) => {
  const l = LOOK[id];
  if (!l) throw new Error(`no look for armor ${id}`);
  return (typeof l === 'string' ? l : l.armor.replace('%MASK%', l[where])) + ' ' + (FRAME[id]?.[where] ?? '');
};

// ---------- items ----------

const standRaw = join(SRC, 'ref', 'stand.webp');
const ITEMS = [
  { kind: 'stand', id: 'stand', size: '1024x1536', raw: standRaw, prompt: STAND },
  ...ARMORS.map((a) => ({
    kind: 'card', id: a.id, size: '1024x1536', raw: join(RAW, 'cards', `${a.id}.webp`), ref: standRaw, out: join(OUT_CARD, a.id),
    prompt: CARD + 'The armor: ' + lookOf(a.id, 'stand') + MATERIALS + BANS + CARD_BANS,
  })),
  ...GENERALS.filter((g) => g.famous).flatMap((g) =>
    armorsFor(g).filter((a) => a.tier !== 'basic').map((a) => ({
      kind: 'portrait', id: `${g.id}_${a.id}`, general: g.id, armor: a.id, size: '1024x1024', raw: join(RAW, 'portraits', `${g.id}_${a.id}.webp`),
      ref: join(FACES, `${g.id}.webp`), zoom: ZOOM[`${g.id}_${a.id}`], out: join(OUT_PORTRAIT, `${g.id}_${a.id}`),
      prompt: PORTRAIT(WHO[g.id]) + 'The armor: ' + lookOf(a.id, 'worn') + (ZOOM[`${g.id}_${a.id}`] ? ZOOMED : '') + (KEEP[g.id] ?? '') + MATERIALS + BANS,
    }))),
];

const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

async function readProv() {
  try { return JSON.parse(await readFile(PROV, 'utf8')); } catch { return { requests: [] }; }
}
const costOf = (u) => {
  if (!u) return null;
  const d = u.input_tokens_details ?? {};
  const imgIn = d.image_tokens ?? 0;
  const txtIn = d.text_tokens ?? (u.input_tokens ?? 0) - imgIn;
  return +((txtIn * PRICE.textIn + imgIn * PRICE.imageIn + (u.output_tokens ?? 0) * PRICE.imageOut) / 1e6).toFixed(4);
};

function finish(prov) {
  const made = prov.requests.filter((r) => !r.error);
  const sum = (rs) => +rs.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0).toFixed(3);
  prov.model = MODEL;
  prov.script = 'scripts/generate-armor-art.mjs';
  prov.pricingNote = `Estimated from returned token usage at gpt-image-2 list prices per million tokens (${JSON.stringify(PRICE)}); the 2.5 preview has no public price. Failed requests return no usage and are counted at 0.`;
  prov.failureNote = 'A request whose error is "fetch failed" had its connection reset before the API answered: no usage, no image and nothing billed, but it is counted in requestCount all the same.';
  prov.requestCount = prov.requests.length;
  prov.imagesMade = made.length;
  prov.byKind = Object.fromEntries(['stand', 'card', 'portrait'].map((k) => {
    const rs = prov.requests.filter((r) => r.kind === k);
    return [k, { requests: rs.length, regenerated: rs.filter((r) => r.note && !r.error).length, estimatedCostUsd: sum(rs) }];
  }));
  prov.totalEstimatedCostUsd = sum(prov.requests);
  return prov;
}

// The edit endpoint takes the raw webp as it is: a PNG of it is eight times the size, and those uploads were mostly reset
// before the API answered (the requests of 2026-10-16 10:49-11:11 in the provenance). A zoomed reference is the picture
// shrunk to the bottom centre over a blurred mirror of its own edges, the seam feathered, so the edit has a plausible
// border to repaint.
async function referenceWebp(item) {
  if (!item.zoom) return readFile(item.ref);
  const { width, height } = await sharp(item.ref).metadata();
  const w = Math.round(width * item.zoom), h = Math.round(height * item.zoom);
  const left = Math.round((width - w) / 2), top = height - h, f = 24;
  const inner = await sharp(item.ref).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  const ground = await sharp(inner).extend({ top, left, right: width - w - left, extendWith: 'mirror' }).blur(24).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><filter id="b"><feGaussianBlur stdDeviation="${f / 2}"/></filter><rect x="${f}" y="${f}" width="${w - 2 * f}" height="${h}" fill="#fff" filter="url(#b)"/></svg>`);
  const soft = await sharp(inner).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(ground).composite([{ input: soft, left, top }]).webp({ quality: 95, effort: 5 }).toBuffer();
}

// Every attempt counts against the ceiling, so one counter is shared by the workers and the provenance keeps them all.
let sent = 0;

async function generate(item, prov) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (sent >= MAX_REQUESTS) throw new Error(`${item.id}: not sent, ${MAX_REQUESTS} requests already made`);
    sent++;
    const entry = {
      id: item.id, kind: item.kind, endpoint: item.ref ? 'images/edits' : 'images/generations', model: MODEL, prompt: item.prompt,
      reference: item.ref ? rel(item.ref) : null, referenceFormat: item.ref ? 'webp' : undefined, referenceZoom: item.zoom, size: item.size, quality: QUALITY, requestedAt: new Date().toISOString(), note: NOTE || undefined,
    };
    const fail = async (msg) => {
      lastErr = msg;
      prov.requests.push({ ...entry, finishedAt: new Date().toISOString(), error: msg, estimatedCostUsd: 0 });
      await writeFile(PROV, JSON.stringify(finish(prov), null, 2));
    };
    try {
      let res;
      if (item.ref) {
        const form = new FormData();
        // The 2.5 preview refuses `input_fidelity` (a 400 on record in the provenance), so the face is held by the prompt alone.
        form.set('model', MODEL); form.set('prompt', item.prompt); form.set('size', item.size); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
        form.set('image', new Blob([await referenceWebp(item)], { type: 'image/webp' }), 'reference.webp');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: headers(), body: form });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, prompt: item.prompt, size: item.size, quality: QUALITY, n: 1, output_format: 'png' }),
        });
      }
      const j = await res.json();
      if (!res.ok) {
        const msg = `${res.status} ${j.error?.message}`;
        await fail(msg);
        if (res.status === 429 || res.status >= 500) { await sleep(8000 * (attempt + 1)); continue; }
        break;
      }
      if (existsSync(item.raw)) {
        await mkdir(REJECTED, { recursive: true });
        await rename(item.raw, join(REJECTED, `${item.id}.${Date.now()}.webp`));
      }
      await sharp(Buffer.from(j.data[0].b64_json, 'base64')).webp({ quality: 94, effort: 5 }).toFile(item.raw);
      prov.requests.push({ ...entry, raw: rel(item.raw), finishedAt: new Date().toISOString(), usage: j.usage ?? null, estimatedCostUsd: costOf(j.usage) });
      await writeFile(PROV, JSON.stringify(finish(prov), null, 2));
      return;
    } catch (e) { await fail(`${e}${e.cause ? ` (${e.cause.code ?? ''} ${e.cause.message ?? ''})` : ''}`); await sleep(15_000 * (attempt + 1)); }
  }
  throw new Error(`${item.id}: ${lastErr}`);
}

async function convert(item) {
  const raw = await readFile(item.raw);
  const card = item.kind === 'card';
  const [w, h] = card ? [768, 1152] : [768, 768];
  // Busy armor can push a file past its budget: step the quality down until it fits.
  const budget = card ? 160_000 : 120_000;
  const full = sharp(raw).resize(w, h, { fit: 'cover', kernel: 'lanczos3' });
  let buf;
  for (let q = 84; q >= 66; q -= 2) { buf = await full.clone().webp({ quality: q, effort: 6 }).toBuffer(); if (buf.length < budget) break; }
  await writeFile(`${item.out}.webp`, buf);
  await sharp(raw).resize(w / 4, h / 4, { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: 82, effort: 6 }).toFile(`${item.out}_sm.webp`);
}

// Review sheets: the cards six to a row (also at their small size), and per faction one row per famous general that
// starts with his plain portrait.
async function sheets(dir) {
  await mkdir(dir, { recursive: true });
  const label = (text, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24"><text x="4" y="17" font-size="15" fill="#d8d8d8" font-family="sans-serif">${text}</text></svg>`);
  const sheet = async (rows, w, h, file) => {
    const cols = Math.max(...rows.map((r) => r.length));
    const tiles = [];
    for (const [y, row] of rows.entries()) {
      for (const [x, cell] of row.entries()) {
        const left = x * (w + 6), top = y * (h + 30);
        tiles.push({ input: label(cell.label, w), left, top });
        if (existsSync(cell.file)) tiles.push({ input: await sharp(cell.file).resize(w, h).toBuffer(), left, top: top + 24 });
      }
    }
    await sharp({ create: { width: cols * (w + 6), height: rows.length * (h + 30), channels: 3, background: '#151b22' } }).composite(tiles).jpeg({ quality: 90 }).toFile(join(dir, file));
    console.log('sheet', join(dir, file));
  };
  const cards = ARMORS.map((a) => ({ label: `${a.id} (${a.tier})`, file: join(OUT_CARD, `${a.id}.webp`) }));
  const rows = [];
  for (let i = 0; i < cards.length; i += 6) rows.push(cards.slice(i, i + 6));
  await sheet(rows, 256, 384, 'cards.jpg');
  await sheet(rows.map((r) => r.map((c) => ({ ...c, file: c.file.replace(/\.webp$/, '_sm.webp') }))), 192, 288, 'cards_sm.jpg');
  for (const f of ['joseon', 'japan', 'ming']) {
    const generals = GENERALS.filter((g) => g.famous && g.faction === f).map((g) => [
      { label: `${g.id} / ${basicArmor(g.faction).id}`, file: join(ROOT, 'public', 'ui', 'portraits', `portrait_${g.id}.webp`) },
      ...armorsFor(g).filter((a) => a.tier !== 'basic').map((a) => ({ label: a.id, file: join(OUT_PORTRAIT, `${g.id}_${a.id}.webp`) })),
    ]);
    await sheet(generals, 256, 256, `portraits_${f}.jpg`);
  }
}

if (SHEETS) { await sheets(SHEETS); process.exit(0); }
const items = ITEMS.filter((it) => (ONLY.length ? ONLY.includes(it.id) : true));
if (DRY) { for (const it of items) console.log(`--- ${it.id} (${it.kind}, ${it.size}${it.ref ? `, edits ${rel(it.ref)}` : ''})\n${it.prompt}\n`); process.exit(0); }
await Promise.all([join(RAW, 'cards'), join(RAW, 'portraits'), join(SRC, 'ref'), OUT_CARD, OUT_PORTRAIT].map((d) => mkdir(d, { recursive: true })));
if (!CONVERT_ONLY) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
  const prov = await readProv();
  sent = prov.requests.length;
  const queue = items.filter((it) => FORCE || !existsSync(it.raw));
  // The cards edit the stand, so it is made first.
  const stand = queue.findIndex((it) => it.kind === 'stand');
  if (stand >= 0) { await generate(queue[stand], prov); console.log('made stand'); queue.splice(stand, 1); }
  if (queue.some((it) => it.kind === 'card') && !existsSync(standRaw)) throw new Error('the stand (ref/stand.webp) is missing: make it first');
  // Most failed requests on record are connections reset before the API answered, and they came in clusters: the
  // workers start 20 s apart, and a reset is retried after 15 s, then 30 s.
  const worker = async (n) => {
    await sleep(n * 20_000);
    for (let it; (it = queue.shift()); ) {
      try { await generate(it, prov); console.log('made', it.id); } catch (e) { console.error(String(e)); }
    }
  };
  await Promise.all(Array.from({ length: JOBS }, (_, n) => worker(n)));
  console.log(`requests so far: ${prov.requests.length}, estimated $${finish(prov).totalEstimatedCostUsd}`);
}
for (const it of items) if (it.out && existsSync(it.raw)) await convert(it);
console.log('done');
