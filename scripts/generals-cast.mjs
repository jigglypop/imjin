// The generals' cast: one complete figure per general for the 장수 screen, his own armor and helmet built in and his
// signature sword in his right hand. No parts, no armor or weapon swapping.
//   concept  front T-pose from the OpenAI Images API (his portrait and his armor card as references), then his left
//            side and his back as edits of that front so the three views agree;
//   model    Tripo multiview_to_model from front / left / back (Meshy multi-image-to-3d with --provider=meshy);
//   rig      decimated (scripts/lib/hero-prep.py) and auto-rigged by Meshy: one humanoid skeleton for every general;
//   motion   Meshy library motions on that rig: idle, Sword Shout (the command), right-hand sword slash, walk;
//   pack     public/models/generals/<id>__<armor>.glb, _lod1, _lod2 (meshopt, webp); live adds it to index.json after review.
// Each output has a <file>.json beside it (prompt, task id, credits); a rerun skips what is done and resumes a
// provider task that was still running instead of creating a new one. Credits go to ledger.json.
//
//   node scripts/generals-cast.mjs <concept|model|rig|motion|pack|live|review|all> --id=yi[,wakisaka] [--redo] [--only=front,left,back]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ERA, ERA_CAST } from './generals-cast-eras.mjs';
import { geminiImage, geminiModel } from './gemini-image.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const [step, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
// GENERALS_PKG points a worktree at the main checkout's sources (generation binaries live there, archived to S3).
const PKG = process.env.GENERALS_PKG ?? join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';

/** The weapons, as the concept describes them in his right fist. */
const SWORD = {
  hwando: 'a Joseon hwando sabre: a slender, slightly curved single-edged steel blade, a round brass guard, a dark red cord-wrapped grip',
  ungeom: 'a Joseon ungeom ceremonial sabre: a long gently curved blade, gilded fittings, a red-lacquered grip with gold bands',
  katana: 'a Japanese katana: a gently curved single-edged steel blade with a visible hamon, a round black iron tsuba, a black silk-wrapped hilt',
  tachi: 'a Japanese tachi: a long deeply curved steel blade, a gold-trimmed tsuba, a white-ray-skin hilt wrapped in black silk',
  nodachi: 'a long Japanese odachi: a very long curved steel blade, a plain iron tsuba, a long black-wrapped two-hand hilt',
  dao: 'a Ming liuyedao sabre: a single-edged steel blade with a gentle curve widening toward the tip, a brass disc guard, a red cord-wrapped grip with a brass pommel',
  jian: 'a Ming straight double-edged jian: a long straight steel blade with a ridge, a bronze guard and pommel, a dark cord-wrapped grip with a red tassel close to the pommel',
  zhanmadao: 'a Ming heavy two-hand sabre (zhanmadao-style): a long, broad, slightly curved steel blade, a brass guard, a long red cord-wrapped grip',
};

const JOSEON = 'Faction look: Joseon Korean commander, as in the films Myeongryang (2014), Hansan: Rising Dragon (2022) and Noryang: Deadly Sea (2023) and the KBS drama Immortal Admiral Yi Sun-sin (2004). ';
const JAPAN = 'Faction look: a Sengoku-period Japanese daimyo commander as in big-budget Japanese taiga dramas and the Korean Yi Sun-sin films: lacquered tosei-gusoku, silk lacing, an ornate kabuto. ';
const MING = 'Faction look: a late-Ming Chinese general as in big-budget Chinese historical epics: gold and red, polished mountain-pattern (shanwenjia) or mail armor, a tall Ming helmet with a spike and red tassel and phoenix-wing flaps. ';

/**
 * The cast in the order they are made. `armor` is the card in public/ui/armor that the front takes his armor from
 * (his signature armor where he has one), `look` the film costume brief, `sword` the blade in his right fist.
 */
const CAST = [
  { id: 'yi', armor: 'yi_tongjesa', sword: 'hwando', face: 'Yi Sun-sin, the Joseon admiral, about fifty: a lean, sun-weathered Korean face with real skin texture and fine lines, deep-set sharp intense dark eyes with clearly defined irises, a thin black moustache and a long, narrow, neat black chin beard (a few grey threads) falling straight down in front of the collar, separate from the armour', look: JOSEON + 'The supreme naval commander as in the films Myeongryang, Hansan and Noryang, on a lean athletic body (flat stomach, V-taper, broad natural shoulders): a FITTED deep-red dujeong-gap brigandine coat to the knee, CLOSED in front and tailored to the torso (matte studded cloth all over, NO glossy or smooth front panel, no breastplate, no robe look), its red cloth covered with even rows of small round polished BRASS rivet heads (gold-coloured metal, never white or cream), black trims edged with thin gold, a smooth plain collar (no fur, no fur ruff, nothing hairy on the armour), red shoulder guards with brass rivets, a broad black belt with a gilt buckle; a black-lacquered Korean tugu helmet with a gilded brow band, a tall gilded spike finial and a short red tassel, and a red neck curtain with brass rivets.' },
  { id: 'wakisaka', armor: 'wakisaka_shichihon', sword: 'katana', face: 'Wakisaka Yasuharu, Japanese samurai commander, late thirties: a lean hard Japanese face, thin moustache, intense proud eyes', look: JAPAN + 'A smooth, glossy, plain black-lacquered cuirass (okegawa-do) with no white or pale marks or patterns on it, dark blue silk lacing, large sode shoulder guards, kusazuri tassets, black haidate, a black menpo-less face open; a black lacquered kabuto with a wide gold crescent maedate and a black neck guard (shikoro); a black jinbaori surcoat is NOT worn.' },
  { id: 'chenlin', armor: 'chenlin_dudok', sword: 'jian', face: 'Chen Lin, the Ming admiral, fifties: a broad commanding Han Chinese face, a long black moustache and a full beard, stern proud eyes', look: MING + 'The fleet commander-in-chief: gilded shanwenjia mountain-pattern lamellar over a red silk robe, gold lion-head shoulder guards, a gilded round chest mirror (hujingxin), a jade-and-gold belt, red skirt panels edged with gold; a tall gilded Ming helmet with a long spike, a red horsehair tassel and upturned phoenix-wing side flaps.' },
  { id: 'won', armor: 'won_heukcheol', sword: 'hwando', face: 'Won Gyun, Joseon admiral, fifties: a heavy broad Korean face, thick moustache and a short full beard, a stubborn fierce glare, a big bull-like build', look: JOSEON + 'A blackened-iron lamellar coat over a dark red dujeong-gap, heavy black iron shoulder guards and arm guards, black and dark red with iron rivets; a black iron tugu helmet with a spike and a black horsehair plume, riveted black neck curtain.' },
  { id: 'eokgi', armor: 'eokgi_cheonggap', sword: 'hwando', face: 'Yi Eok-gi, young Joseon admiral, early thirties: a handsome youthful Korean face, a thin moustache, bright resolute eyes', look: JOSEON + 'A deep blue silk dujeong-gap coat to mid-shin with rows of gilded rivets and red trims, gold-embroidered shoulder guards, a red belt; a dark iron tugu helmet with a gilded spike and a blue-and-red tassel, a blue riveted neck curtain.' },
  { id: 'kato', armor: 'kato_teppo', sword: 'tachi', face: 'Kato Yoshiaki, Japanese naval commander, thirties: a sharp angular Japanese face, a small moustache, cold watchful eyes', look: JAPAN + 'Brown-lacquered lamellar tosei-gusoku laced with dark green and gold silk, broad sode, kusazuri; a very tall black eboshi-nari kabuto shaped like a tall court cap, with a small gold mon; dark neck guard.' },
  { id: 'kuki', armor: 'kuki_tetsu', sword: 'tachi', face: 'Kuki Yoshitaka, Japanese naval lord, fifties: a weathered strong Japanese face, a grey moustache and short beard, a seafarer\'s squint', look: JAPAN + 'Dark iron-plated tosei-gusoku with indigo (kon) silk lacing and iron studs, heavy sode, kusazuri; a black iron multi-plate suji-bachi kabuto with tall gilded kuwagata horns and a deep neck guard.' },
  { id: 'todo', armor: 'todo_tokan', sword: 'katana', face: 'Todo Takatora, Japanese commander, late thirties: a very tall man with a long stern Japanese face, a short moustache', look: JAPAN + 'Black-lacquered tosei-gusoku with white and black silk lacing, large sode, kusazuri; the famous tokan-nari kabuto: a black Chinese-court-cap helmet with two long flat wings sweeping straight back and outwards.' },
  { id: 'konishi', armor: 'konishi_gin', sword: 'tachi', face: 'Konishi Yukinaga, Japanese vanguard commander and Christian daimyo, thirties: a refined intelligent Japanese face, a neat moustache', look: JAPAN + 'Silver-lacquered tosei-gusoku with white silk lacing, a European-style polished steel breastplate (nanban-do) with a small gold cross engraved on it, silver sode and kusazuri; a silver momonari kabuto with a gold cross-shaped maedate and a silver neck guard; a short white silk scarf.' },
  { id: 'shimazu', armor: 'shimazu_oni', sword: 'nodachi', face: 'Shimazu Yoshihiro, Japanese warlord, sixties: a fierce lean old Japanese face with a grey moustache and short grey beard, the eyes of a demon fighter', look: JAPAN + 'Black-lacquered tosei-gusoku with bright red silk lacing, red sode and kusazuri; a black kabuto with a gold maedate in the shape of the Shimazu mon (a cross inside a ring) and a red neck guard.' },
  { id: 'deng', armor: 'deng_nojang', sword: 'zhanmadao', face: 'Deng Zilong, the seventy-year-old Ming veteran admiral: a lean, fierce old Han Chinese face, a long white beard and white moustache, unbroken pride', look: MING + 'Clearly readable lamellar of distinct, evenly spaced small plates in warm dark bronze and blued iron with a soft matte satin finish (no mirror shine, no grime streaks), laced with bright red cords, over a dark red robe; bronze lion-head shoulder guards; a dark red skirt; a bronze-and-iron Ming helmet with a spike, a red tassel and phoenix-wing flaps, red cloth cheek and neck guards with clean, crisp edges.' },
  { id: 'kwon', armor: 'joseon_gyeongbeon', sword: 'hwando', face: 'Gwon Jun, an older scholar-official commander about fifty-five: a dignified long pale face with soft wrinkles, gentle heavy-lidded eyes, a long thin grey-streaked moustache and a long grey wispy chin beard, the bearing of a scholar', look: JOSEON + 'A gyeongbeon-gap: iron mail set with polished small steel plates over a dark blue robe, red trims, a red belt; an iron tugu helmet with a small spike and red tassel, mail neck guard.' },
  { id: 'eo', armor: 'joseon_dujeong', sword: 'hwando', face: 'Eo Yeong-dam, Joseon magistrate and veteran navigator, fifties: a sea-weathered Korean face, grey-shot moustache and beard', look: JOSEON + 'A dark green cotton dujeong-gap coat with brass rivets and red trims, a black belt; a dark iron tugu helmet with a spike and red plume and a green riveted neck curtain.' },
  { id: 'jeongun', armor: 'joseon_dujeong', sword: 'hwando', face: 'Jeong Un, stern Joseon naval commander about forty-nine: a long, hard, sun-darkened face with a high forehead, heavy straight brows, deep creases beside the mouth, and a FULL thick black beard with a long moustache, greying at the edges', look: JOSEON + 'A bright red dujeong-gap coat with brass rivets, black trims, iron arm guards; an iron tugu helmet with a spike and a large red plume, a red riveted neck curtain.' },
  { id: 'kimwan', armor: 'joseon_pigap', sword: 'hwando', face: 'Kim Wan, a Joseon officer about forty-five: a narrow lean face with high cheekbones, sunken cheeks, a hooked nose, a thin drooping moustache and a sparse wispy chin beard, tired determined eyes', look: JOSEON + 'A black lacquered leather lamellar coat (pigap) laced with red cords, red shoulder trims; a black leather and iron helmet with a small spike and black plume.' },
  { id: 'nadaeyong', armor: 'joseon_dujeong', sword: 'hwando', face: 'Na Dae-yong, the turtle-ship builder, about thirty-six: a deeply sun-weathered, ruddy-brown practical shipwright face, squinting crow-feet wrinkles, a broad flat nose, a short rough stubbly beard and a short moustache, a small scar on the cheek', look: JOSEON + 'A dark brown dujeong-gap coat with brass rivets and dark teal trims, a leather belt with tools; a dark iron tugu helmet with a spike and a brown plume.' },
  { id: 'songhuirip', armor: 'joseon_swaeja', sword: 'hwando', face: 'Song Hui-rip, a fierce broad-faced Joseon officer about forty: a wide round heavy-jawed face, thick bushy brows drawn together in a scowl, flared nostrils, a thick bristling black moustache and a short full jaw beard', look: JOSEON + 'Iron chain mail (swaeja-gap) to the knees over a crimson robe, iron arm guards, a red belt; an iron tugu helmet with a spike and red tassel and a mail neck curtain.' },
  { id: 'iyeongnam', armor: 'joseon_dujeong', sword: 'hwando', face: 'Yi Yeong-nam, a Joseon officer in his early thirties: a slim angular face, a pointed chin, sharp alert eyes, smooth skin, a thin pencil moustache only and no beard', look: JOSEON + 'An indigo blue dujeong-gap coat with brass rivets, red trims, a red belt; a dark iron tugu helmet with a spike and red tassel, a blue riveted neck curtain.' },
  { id: 'baeseol', armor: 'joseon_gyeongbeon', sword: 'hwando', face: 'Bae Seol, a gaunt nervous Joseon commander about fifty: a thin hollow-cheeked bony face, worried brows raised in the middle, anxious eyes with bags beneath, a thin greying moustache and a scraggly short grey beard', look: JOSEON + 'A grey steel gyeongbeon-gap of mail and polished plates over a dark grey robe, black trims; an iron tugu helmet with a spike and a grey-black plume.' },
  { id: 'anwi', armor: 'joseon_eorin', sword: 'ungeom', face: 'An Wi, a square-jawed Joseon officer about forty: a broad square blocky face, a strong heavy jaw and chin, a straight wide nose, level steady eyes, a neat short boxed black beard along the jaw and a trimmed moustache', look: JOSEON + 'A gilt-bronze fish-scale lamellar (eorin-gap) coat over a red robe, red trims; a gilded tugu helmet with a spike and red plume.' },
  { id: 'iwan', armor: 'yi_tongjesa', sword: 'hwando', face: 'Yi Wan, nephew of Yi Sun-sin, young officer in his mid twenties: a fresh, smooth CLEAN-SHAVEN youthful Korean face with no beard and no moustache, an oval face, a slim straight nose, bright eager eyes, resembling his uncle', look: JOSEON + 'A crimson dujeong-gap coat with brass rivets and black trims, black shoulder guards; a black iron tugu helmet with a spike and red plume, a red riveted neck curtain.' },
  { id: 'kurushima', armor: 'japan_oyoroi', sword: 'tachi', face: 'Kurushima Michifusa, Murakami pirate-clan commander, thirties: a wild handsome Japanese face, a rough moustache, reckless eyes', look: JAPAN + 'A red-lacquered tosei-gusoku with red and gold silk lacing, large red sode, kusazuri; a red-lacquered kabuto with tall gold kuwagata horns and a wave-crest mon.' },
  { id: 'michiyuki', armor: 'japan_haramaki', sword: 'katana', face: 'Kurushima Michiyuki, a young Japanese pirate-lord about thirty: a wild sharp-featured face, a lean wolfish grin, a narrow jaw, bold thick brows, a clean-shaven chin with only faint stubble, tanned sea-roughened skin', look: JAPAN + 'A dark green-laced haramaki-style tosei-gusoku with dark iron plates, small sode, kusazuri; an iron kabuto with a small wave-crest maedate and a sea-blue neck guard.' },
  { id: 'tachibana', armor: 'japan_nimaido', sword: 'tachi', face: 'Tachibana Muneshige, a handsome noble young samurai lord about twenty-five: a refined, symmetrical, CLEAN-SHAVEN fair face, a slender elegant nose, calm composed eyes, smooth unlined skin, no beard and no moustache', look: JAPAN + 'A black-lacquered two-piece (nimai-do) cuirass with gold silk lacing, black sode and kusazuri; a black kabuto with a large gold sunburst-free wheel-shaped (kuruma) halo crest of gilded spokes behind it and gold kuwagata horns.' },
  { id: 'lirusong', armor: 'ming_sanmun', sword: 'zhanmadao', face: 'Li Rusong, Ming commander-in-chief of the Korean expedition, forties: a powerful, proud Han Chinese face with Liaodong toughness, a full black moustache and beard', look: MING + 'Gilded shanwenjia lamellar over a scarlet robe, gold lion-head pauldrons, a gilded chest mirror, red skirt panels; a tall gilded Ming helmet with spike, big red tassel and phoenix wings.' },
  { id: 'magui', armor: 'ming_yuyeop', sword: 'dao', face: 'Ma Gui, Ming general of Hui descent, fifties: a hard square face, thick beard, a cavalryman\'s scowl', look: MING + 'Willow-leaf (liuye) steel lamellar with red lacing over a dark red robe, steel shoulder guards, red skirts; a steel Ming helmet with spike, red tassel and phoenix-wing flaps.' },
  { id: 'liuting', armor: 'ming_dingjia', sword: 'zhanmadao', face: 'Liu Ting, the Ming general famed for his huge strength, forties: a massive powerful Han Chinese man, a full black beard, a ferocious grin', look: MING + 'A red brigandine (dingjia) studded with brass nails, heavy gilded shoulder guards, a gilded chest mirror; a red-and-gold Ming helmet with spike, red tassel and phoenix wings.' },
  { id: 'jijin', armor: 'ming_swaeja', sword: 'dao', face: 'Ji Jin, a rugged sea-hardened Ming naval officer about forty-five: a broad weather-beaten dark tanned face with a flattened broken nose, deep wind wrinkles, a heavy shaggy black beard and moustache', look: MING + 'Steel chain mail over a blue-and-red robe, small gilded shoulder guards, a red belt; a steel Ming helmet with spike, red tassel and phoenix-wing flaps, a blue silk neck guard.' },
  { id: 'yanghao', armor: 'ming_myeongap', sword: 'jian', face: 'Yang Hao, Ming supreme commissioner (a civil official commanding the army), fifties: a scholarly stern Han Chinese face, a long thin moustache and long beard', look: MING + 'A padded red-and-gold quilted mianjia armor coat studded with gilt nails, gold embroidered cloud collar, a jade belt; a gilded Ming helmet with spike, red tassel and phoenix wings.' },
  { id: 'wuweizhong', armor: 'ming_dingjia', sword: 'dao', face: 'Wu Weizhong, a Zhejiang veteran Ming commander about fifty: a hard lean southern Han Chinese face with a long diagonal SCAR across the left cheek and brow, narrow piercing eyes, a long thin drooping moustache and a short pointed grey beard', look: MING + 'A dark red nail-studded brigandine (dingjia) over a black robe, iron shoulder guards; an iron Ming helmet with spike, red tassel and phoenix-wing flaps.' },
];
CAST.push(...ERA_CAST);
const BY = Object.fromEntries(CAST.map((c) => [c.id, c]));
const NEW_MING = new Set(['lirusong', 'magui', 'liuting', 'jijin', 'yanghao', 'wuweizhong']);

// The armor briefs the armor cards were painted from (scripts/generate-armor-art.mjs), for armors other than a general's own.
const armorArt = readFileSync(join(ROOT, 'scripts', 'generate-armor-art.mjs'), 'utf8');
const LOOK = (() => {
  const start = armorArt.indexOf('const LOOK = {');
  let depth = 0;
  for (let i = armorArt.indexOf('{', start); i < armorArt.length; i++) {
    if (armorArt[i] === '{') depth++;
    else if (armorArt[i] === '}' && --depth === 0) return new Function(`return ${armorArt.slice(armorArt.indexOf('{', start), i + 1)};`)();
  }
})();
const FACTION_LOOK = { joseon: JOSEON, japan: JAPAN, ming: MING };
/** One figure: a general in one armor, `<general>__<armor>`. His own armor uses his film brief, another its card's brief. */
function jobOf(c, armor = c.armor) {
  const card = LOOK[armor];
  const brief = typeof card === 'string' ? card : card ? card.armor.replace('%MASK%', '') : '';
  return { ...c, armor, key: `${c.id}__${armor}`, look: armor === c.armor ? c.look : FACTION_LOOK[c.look.startsWith(JAPAN) ? 'japan' : c.look.startsWith(MING) ? 'ming' : 'joseon'] + brief };
}

const IMAGE = { size: '2880x2880', quality: 'high', background: args.transparent ? 'transparent' : 'opaque', output_format: 'png' };
const IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2'];

const FRAME =
  'A full-body character reference photograph for image-to-3D reconstruction and auto-rigging, in the look of a live-action costume fitting for a cinematic big-budget historical war film (the hero costume of a film lead in Myeongryang, Hansan, Noryang, Immortal Admiral Yi Sun-sin, a Japanese NHK taiga drama or a Ming-dynasty epic). ' +
  'Exactly one man standing alone in a relaxed 45-degree A-pose for rigging: both arms straight and spread out to the sides, each arm angled exactly 45 degrees below horizontal (halfway between a T-pose and hanging down), so the fists are well away from the body, about one forearm length outside the hips, with wide open sky between each arm and the torso and skirts; shoulders relaxed and low (not shrugged); legs straight and apart, the feet planted wider than the shoulders (an inverted V between the legs), toes forward; head level, facing the camera. ' +
  'BOTH hands are empty, relaxed loosely closed fists, the backs of the hands facing outward, holding nothing at all (the weapon is fitted later): no sword, no weapon, no scabbard on the body, nothing in the hands. ' +
  'Heroic athletic film-lead build: tall, eight heads tall, broad square shoulders, a deep chest, a FLAT stomach and a narrow, tightly cinched waist (a clear V-taper; from the side the belly never pushes out past the chest), the armour tailored and fitted close to the body, never a barrel-shaped robe; a movie-poster hero, never stocky, pot-bellied or chibi. ' +
  'Seen at chest height through a long telephoto lens, orthographic-looking, no perspective distortion. The whole figure fits in the frame with a clear margin above the helmet crest, below the boots and beyond both fists. ' +
  'Soft, even, flat studio light from every side, no hard shadows, no rim light; a plain seamless light grey background, no floor line, no ground shadow, nothing else in the picture. ' +
  'Crisp, sharply focused detail everywhere: every plate, rivet, lacing cord and seam clearly separated, believable late-sixteenth-century materials with a soft matte or satin finish: no mirror reflections, no glare, no grime streaks, every surface pattern crisp and readable. ';
const RULES =
  'No cape or cloak, no long ribbons or banners flying away from the body, no sashimono back flag; skirts and tassets hang straight close to the legs. ' +
  'No text, no letters, no logo, no border, no watermark. No rising sun flag, no red sun disc. No painting or illustration look, no cartoon, no plastic CGI look, no modern items. Exactly two arms, two legs, two empty fists.';

const frontPrompt = (c) =>
  FRAME +
  (args.hero ? 'His face is the most important part: a striking, heroic, cinematic leading-man face ready for close-ups in film cutscenes: sharp defined bone structure, strong brow and jaw, intense clear eyes with defined irises and catchlights, natural skin with real pores and fine lines (never waxy or plastic), a clean well-groomed beard and hair with crisp strands. ' : '') +
  `He is ${c.face}. Recast him as the charismatic, handsome leading man of a historical war film, an original face (not a real actor). ` +
  `${c.look} ` +
  'The first attached picture is the style reference sheet of this film costume department: match its photographic rendering, its soft frontal light, its material treatment and its level of historical accuracy (but not its man, costume or pose). ' +
  'The second attached picture shows his armour on its stand: take its colours and materials where they agree with the description. His face is a new design, not copied from any painted portrait. ' +
  RULES;

const VIEW = {
  left: 'seen exactly from HIS LEFT SIDE in strict profile (he faces the LEFT edge of the picture, the camera standing at his left): his left arm hangs angled down at his side in the A-pose, slightly away from the body, the empty relaxed fist by his thigh; his right arm hidden behind his body',
  right: 'seen exactly from HIS RIGHT SIDE in strict profile (he faces the RIGHT edge of the picture, the camera standing at his right): his right arm hangs angled down at his side in the A-pose, slightly away from the body, the empty relaxed fist by his thigh; his left arm hidden behind his body',
  back: 'seen from directly behind: the back of the helmet and its neck guard, the back of the armour, the belt, the skirts and the boots; both arms still angled 45 degrees down, clear of the body, with empty relaxed fists; nothing of his face',
};
const viewPrompt = (which) =>
  'The attached picture is the front view of a character reference for image-to-3D reconstruction. Make the matching view of the exact same man in the exact same costume and the exact same 45-degree A-pose with both fists empty and relaxed, ' +
  VIEW[which] + '. Same scale, same height in the frame, same orthographic look, same soft flat studio light, same plain light grey background, no floor line, no shadow. ' +
  'Everything consistent with the front view: colours, materials, trims, helmet, lengths, proportions. No text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look. Exactly two arms, two legs.';

// ---------------------------------------------------------------- plumbing
const recordOf = (f) => (existsSync(`${f}.json`) ? JSON.parse(readFileSync(`${f}.json`, 'utf8')) : {});
const record = (f, r) => writeFileSync(`${f}.json`, JSON.stringify(r, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, ...m) => console.log(new Date().toISOString().slice(11, 19), id.padEnd(11), ...m);
const dirOf = (c) => { const d = join(PKG, c.key + (args.cand ? `_${args.cand}` : '')); mkdirSync(d, { recursive: true }); return d; };
const rel = (f) => f.slice(ROOT.length).replaceAll('\\', '/');

function ledger(entry) {
  const f = join(PKG, 'ledger.json');
  const l = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { entries: [] };
  l.entries.push({ at: new Date().toISOString(), ...entry });
  l.totals = {};
  for (const e of l.entries) l.totals[e.provider] = (l.totals[e.provider] ?? 0) + (e.credits ?? 0);
  writeFileSync(f, JSON.stringify(l, null, 2) + '\n');
}

async function download(url) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(900_000) }); if (!r.ok) throw new Error(`download ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i >= 8) throw e; console.error('download retry', i, String(e)); await sleep(5000 * (i + 1)); }
  }
}

async function http(method, url, headers, body, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(5000 * (i + 1)); continue; }
      const e = new Error(`${res.status} ${text.slice(0, 400)}`); e.status = res.status; throw e;
    } catch (e) {
      if (!e.status) console.error('http', i, String(e), String(e?.cause ?? ''));
      if (!e.status && i < tries && /fetch failed|ECONNRESET|socket|network|timeout|terminated/i.test(`${e} ${e?.cause ?? ''}`)) { await sleep(4000 * (i + 1)); continue; }
      throw e;
    }
  }
}

// ---------------------------------------------------------------- concept
// References go up at 1536 px: full-size 10 MB uploads get their connection reset.
const png = async (file) => new Blob([await sharp(file).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#cfd0d2' }).jpeg({ quality: 92 }).toBuffer()], { type: 'image/jpeg' });
async function edit(file, prompt, refs, size) {
  let last;
  for (const model of IMAGE_MODELS) {
    const image = { model, ...IMAGE, ...(size ? { size } : {}) };
    const form = new FormData();
    for (const [k, v] of Object.entries(image)) form.set(k, String(v));
    form.set('n', '1');
    form.set('prompt', args.transparent ? prompt.replace(/(a |the )?(same )?plain (seamless )?light grey background/g, 'a fully transparent background (a clean cutout, no ground shadow)') : prompt);
    for (const [i, ref] of refs.entries()) form.append('image[]', await png(ref), `ref${i}.jpg`);
    try {
      let j;
      // Long image jobs drop the connection now and then; the same request is sent again (a fresh one each time).
      for (let k = 0; ; k++) {
        try { j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form, 0); break; }
        catch (e) { if (e.status || k >= 8) throw e; log('openai', 'dropped, again', k + 1); await sleep(15000 * (k + 1)); }
      }
      writeFileSync(file, Buffer.from(j.data[0].b64_json, 'base64'));
      record(file, { at: new Date().toISOString(), image, prompt, refs: refs.map(rel), usage: j.usage ?? null });
      ledger({ provider: 'openai', what: rel(file), model, credits: 0, usage: j.usage ?? null });
      return;
    } catch (e) {
      last = e;
      if (!(e.status === 400 || e.status === 404) || !/model|size/i.test(String(e))) throw e;
      log('openai', model, 'refused, next model:', String(e).slice(0, 160));
    }
  }
  throw last;
}

/** One sheet that fixes the tone for every general: rendering, light, materials, accuracy. Made once. */
const STYLE_PROMPT =
  'A costume-department style reference sheet for a big-budget live-action historical war film about the Imjin War (1592-1598), in the visual language of the Korean films Myeongryang, Hansan: Rising Dragon and Noryang: Deadly Sea. ' +
  'Three mannequin torsos on stands in a row against a plain seamless light grey studio backdrop: a Joseon red dujeong-gap brigandine with brass rivets and a tugu helmet; a Japanese black-lacquered tosei-gusoku with silk lacing and a kabuto; a Ming gilded mountain-pattern lamellar with a phoenix-wing helmet. ' +
  'Photographic, sharp, 85 mm lens, soft even frontal key light from slightly above-left with gentle fill, no hard shadows; materials rendered truthfully: rubbed iron, worn lacquer, faded silk, dulled brass with verdigris, leather with wear; museum-grade historical accuracy, lived-in, no fantasy elements. ' +
  'No people, no text, no letters, no logo, no border. No illustration look, no plastic CGI look.';
const STYLE = join(PKG, 'style-sheet.png');
async function styleSheet() {
  if (existsSync(STYLE)) return;
  log('style', 'sheet…');
  for (const model of IMAGE_MODELS) {
    const image = { model, size: '2880x1632', quality: 'high', background: 'opaque', output_format: 'png' };
    try {
      const j = await http('POST', 'https://api.openai.com/v1/images/generations', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, JSON.stringify({ ...image, prompt: STYLE_PROMPT, n: 1 }));
      writeFileSync(STYLE, Buffer.from(j.data[0].b64_json, 'base64'));
      record(STYLE, { at: new Date().toISOString(), image, prompt: STYLE_PROMPT, usage: j.usage ?? null });
      ledger({ provider: 'openai', what: rel(STYLE), model, credits: 0, usage: j.usage ?? null });
      return log('style', 'sheet ready');
    } catch (e) { if (!(e.status === 400 || e.status === 404)) throw e; log('style', model, String(e).slice(0, 160)); }
  }
}

const SHEETS = {
  face: 'The attached picture is the front view of a costume reference. Make a close-up front portrait of the same man\'s face in the same helmet: head and shoulders, straight on, the face filling the frame, the same face, beard, age and helmet, same soft flat studio light and plain light grey background. Photographic, sharp. No text, no border.',
  detail: 'The attached picture is the front view of a costume reference. Make a costume-department detail sheet of the same costume on a plain light grey background: the helmet alone from the front and the side, a close-up of the armour\'s chest and shoulder construction (plates, rivets, lacing), and the sword alone laid flat horizontally with its hilt and guard. Same materials and colours, photographic, sharp, even studio light. No people, no text, no letters, no labels, no border.',
};

/** An approved front with a weapon in hand, re-made with both fists empty (the weapon is attached at runtime). */
const EMPTY_FISTS =
  'The attached picture is an approved full-body costume reference. Make exactly the same picture, the same man, face, armour, helmet, colours, pose, scale, framing, light and background, ' +
  'with one change only: he holds nothing. Both hands are empty, firmly closed fists, backs of the hands up, thumbs over the fingers, the arms still angled 45 degrees down in the A-pose, clear of the body. ' +
  'Remove the sword, its tassel and anything held completely. No text, no border. Photographic, no illustration look.';

/** Appends one line to progress.md, the owner's live log. */
function progress(c, stage, extra = '') {
  const f = join(PKG, 'progress.md');
  if (!existsSync(f)) writeFileSync(f, '# Generals cast progress\n\n| time | general | stage | files |\n|---|---|---|---|\n');
  writeFileSync(f, readFileSync(f, 'utf8') + `| ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${c.key}${args.cand ? ` (${args.cand})` : ''} | ${stage} | ${extra} |\n`);
}

/**
 * --turnaround: the armour first, then the man in it. armor.png is the armour alone on a ghost mannequin from the
 * front, back, left and right in one row; the four character views (front, left, back, right) are then each made
 * with that sheet and his face close-up (--faceref=<file>, default face.png beside them) as references, so the
 * armour agrees exactly in every view Tripo's multiview gets.
 */
const ARMOR_SHEET = (c) =>
  'A costume-department armour turnaround sheet for a big-budget live-action historical war film: ONE complete suit of armour with its helmet, shown four times side by side in one row at the same scale and the same height, from left to right: seen from the FRONT, from the BACK, from ITS LEFT SIDE in strict profile, from ITS RIGHT SIDE in strict profile. ' +
  'Each time the armour is worn by an invisible ghost mannequin: it keeps the shape it has on a tall athletic man with broad shoulders, a deep chest and a narrow cinched waist, the sleeves and shoulder guards angled 45 degrees down and away from the body as in an A-pose, the skirts hanging straight, the boots standing apart; empty inside, no person, no head, no hands, no mannequin, no stand. ' +
  `The armour: ${c.look} ` +
  'The first attached picture is the style reference of this costume department (rendering, light, materials, accuracy only). The second attached picture shows this armour on its stand: take its colours, materials and construction where they agree with the description. ' +
  'All four views show exactly the same armour: identical colours, plates, rivets, lacing, trims, lengths and helmet. Photographic, crisp detail, soft even flat studio light, a fully transparent background (clean cutouts, no ground shadow). No sword, no weapon, no scabbard. No text, no letters, no labels, no border, no watermark. No illustration look, no plastic CGI look.';
const TURN_FRONT = (c) =>
  FRAME +
  (args.hero ? 'His face is the most important part: a striking, heroic, cinematic leading-man face ready for close-ups in film cutscenes: sharp defined bone structure, intense clear eyes with defined irises, natural skin with real pores and fine lines (never waxy or plastic), crisp beard and hair strands. ' : '') +
  `He is ${c.face}. ${c.look} ` +
  'The FIRST attached picture is the turnaround of his armour (front, back, left, right): he wears EXACTLY this armour and helmet, every plate, rivet, lacing cord, colour, trim and length as in its front view, filled out by his athletic body (full broad chest, the cuirass at its full width). ' +
  'The SECOND attached picture is a close-up of his face: keep exactly this face, its features, beard, age and skin, photographic. ' +
  RULES;
const TURN_VIEW = (w) =>
  viewPrompt(w) +
  ' The SECOND attached picture is the turnaround of his armour (front, back, left, right): from this side the armour and helmet must look exactly as in its matching view of that sheet. The THIRD attached picture is a close-up of his face' + (w === 'back' ? ' (not visible from behind).' : ': the same face in profile.');

async function turnaround(c) {
  await styleSheet();
  const d = dirOf(c);
  const only = (args.only ?? 'armor,front,left,back,right').split(',');
  const sheet = join(d, 'armor.png');
  const face = args.faceref ? join(ROOT, args.faceref) : join(d, 'face.png');
  if (!existsSync(face)) throw new Error(`no face reference ${face}`);
  if (only.includes('armor') && (!existsSync(sheet) || args.redo)) {
    log(c.id, 'armor sheet…');
    await edit(sheet, ARMOR_SHEET(c), [STYLE, join(ROOT, 'public', 'ui', 'armor', `${c.armor}.webp`)], '2880x1632');
    log(c.id, 'armor sheet ready');
  }
  const front = join(d, 'front.png');
  if (only.includes('front') && (!existsSync(front) || args.redo)) {
    log(c.id, 'front…');
    await edit(front, TURN_FRONT(c), [sheet, face]);
    log(c.id, 'front ready');
  }
  await Promise.all(['left', 'back', 'right'].filter((w) => only.includes(w)).map(async (w, i) => {
    const out = join(d, `${w}.png`);
    if (existsSync(out) && !args.redo) return;
    await sleep(i * 3000);
    log(c.id, `${w}…`);
    await edit(out, TURN_VIEW(w), [front, sheet, face]);
    log(c.id, `${w} ready`);
  }));
  if (['armor', 'front', 'left', 'back', 'right'].every((w) => existsSync(join(d, `${w}.png`)))) progress(c, 'concept (armor turnaround → front/left/back/right)', rel(d));
}

// ---------------------------------------------------------------- concept, other chapters (Gemini)
// The settled turnaround (armor sheet → front → left/back/right) with Gemini's image model: it has no transparent
// output, so each view is made on light grey (<view>_grey.png) and cut out (scripts/lib/cutout.py, BiRefNet) to
// <view>.png. The face reference is a photographic recast of his chapter portrait (face.png).
const eraFrame = (c) =>
  `A full-body character reference photograph for image-to-3D reconstruction and auto-rigging, in the look of a live-action costume fitting for ${ERA[c.era].films}: the hero costume of a film lead. ` +
  'Exactly one man standing alone in a relaxed 45-degree A-pose for rigging: ' +
  (c.arms ?? 'both arms straight and spread out to the sides, each arm angled exactly 45 degrees below horizontal (halfway between a T-pose and hanging down), the arms point steeply DOWN-and-out (NOT horizontal, NOT a T-pose): each fist hangs at the height of the crotch, about one forearm length outside the hip, with a clear gap between each arm and the torso; shoulders relaxed and low (not shrugged); legs straight and apart, the feet planted wider than the shoulders (an inverted V between the legs), toes forward; head level, facing the camera. ') +
  (c.hands ?? 'BOTH hands are empty firmly closed fists, the right fist with a hollow channel through it as if around a sword grip, the backs of the hands facing outward, holding nothing at all (the weapon is fitted later): no sword, no weapon, no scabbard, no hat in the hand. ') +
  'Heroic athletic film-lead build: tall, broad square shoulders, a deep chest, a FLAT stomach and a narrow cinched waist (a clear V-taper; from the side the belly never pushes out past the chest), the clothes and armour tailored close to the body; never stocky or pot-bellied. ' +
  'Seen at chest height through a long telephoto lens, orthographic-looking, no perspective distortion. The whole figure fits in the frame with a clear margin above the head, below the boots and beyond both arms. ' +
  'Soft, even, flat studio light from every side, no hard shadows, no rim light; a plain seamless light grey background, no floor line, no ground shadow, nothing else in the picture. ' +
  `Crisp, sharply focused detail everywhere, ${ERA[c.era].materials}, soft matte or satin finish, no glare. `;
const ERA_RULES =
  'No cape, no cloak, no long coat-tails flying, no ribbons or banners; nothing hangs away from the body. No scabbard. ' +
  'No text, no letters, no logo, no border, no watermark. No painting or illustration look, no cartoon, no plastic CGI look, no modern items. ';
const ERA_FACE = (c) =>
  `The attached picture is a painted portrait of ${c.face.split(':')[0]}. Make a photographic close-up portrait of the same man as a live-action film lead: head and shoulders, straight on, the face filling the frame, keeping exactly his face shape, nose, brows, eyes, hair, beard and age from the portrait (${c.face}), in the costume of: ${c.look} ` +
  'Real skin texture with pores and fine lines, natural colour, soft flat studio light, a plain light grey background. Photographic, sharp, 85 mm lens. No painting look, no text, no border.';
const ERA_ARMOR = (c) =>
  `A costume-department turnaround sheet for ${ERA[c.era].films}: ONE complete costume (with its armour where it has one, and its headwear) shown four times side by side in one row at the same scale and height, from left to right: from the FRONT, from the BACK, from ITS LEFT SIDE in strict profile, from ITS RIGHT SIDE in strict profile. ` +
  'Each time the costume is worn by an invisible ghost mannequin: it keeps the shape it has on a tall athletic man with broad shoulders, a deep chest and a narrow cinched waist, ' +
  (c.hand === 'left' ? 'the LEFT sleeve angled 45 degrees down and away from the body, the RIGHT sleeve empty, folded and pinned flat to the chest, ' : 'the sleeves angled 45 degrees down and away from the body as in an A-pose, ') +
  'the legs standing apart; empty inside, no person, no head, no hands, no mannequin, no stand. ' +
  `The costume: ${c.look} ` +
  'The attached picture is his portrait: take the colours and the construction of his dress where they agree with the description. ' +
  `All four views show exactly the same costume: identical colours, plates, buttons, lace, trims and lengths. Photographic, crisp detail, ${ERA[c.era].materials}, soft even flat studio light, a plain light grey background, no ground shadow. No sword, no weapon, no scabbard. No text, no letters, no labels, no border. No illustration look.`;
const ERA_FRONT = (c) =>
  eraFrame(c) +
  `He is ${c.face}. ${c.look} ` +
  'The FIRST attached picture is the turnaround of his costume (front, back, left, right): he wears EXACTLY this costume and headwear, every plate, button, lace, colour, trim and length as in its front view, filled out by his athletic body. ' +
  'The SECOND attached picture is a close-up of his face: keep exactly this face, its features, hair, beard, age and skin, photographic. ' +
  ERA_RULES + (c.hand === 'left' ? 'Exactly ONE arm (the left), two legs, one empty fist.' : 'Exactly two arms, two legs, two empty fists.');
const ERA_VIEW = (c, w) =>
  'The FIRST attached picture is the front view of a character reference for image-to-3D reconstruction. Make the matching view of the exact same man in the exact same costume and the exact same 45-degree A-pose' +
  (c.hand === 'left' ? ' (his right arm is missing, the empty right sleeve pinned flat to the chest; only the left arm angled down with an empty fist), ' : ' with both fists empty, ') +
  (c.hand === 'left' && w === 'right' ? 'seen exactly from HIS RIGHT SIDE in strict profile (he faces the RIGHT edge of the picture, the camera standing at his right): the pinned empty right sleeve flat against his chest, nothing hanging from the right shoulder, his left arm hidden behind his body' : VIEW[w]) +
  '. Same scale, same height in the frame, same orthographic look, same soft flat studio light, same plain light grey background, no floor line, no shadow. Everything consistent with the front view: colours, materials, trims, headwear, lengths, proportions. ' +
  'The SECOND attached picture is the turnaround of his costume: from this side it must look exactly as in its matching view of that sheet. The THIRD attached picture is a close-up of his face' + (w === 'back' ? ' (not visible from behind).' : ': the same face in profile.') +
  ' No text, no border. No painting or illustration look. ' + (c.hand === 'left' ? 'Exactly one arm, two legs.' : 'Exactly two arms, two legs.');

async function gemini(file, prompt, refs, aspect) {
  if (existsSync(file) && !args.redo) return false;
  const images = await Promise.all(refs.map((f) => sharp(f).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#cfd0d2' }).png().toBuffer()));
  for (let k = 0; ; k++) {
    try { writeFileSync(file, await geminiImage(prompt, { aspect, images })); break; }
    catch (e) { if (k >= 4) throw e; log('gemini', 'retry', k + 1, String(e).slice(0, 160)); await sleep(10000 * (k + 1)); }
  }
  record(file, { at: new Date().toISOString(), tool: 'gemini image', model: geminiModel(), aspect, prompt, refs: refs.map(rel), estimatedUsd: 0.04 });
  ledger({ provider: 'gemini', what: rel(file), model: geminiModel(), credits: 0, usd: 0.04 });
  return true;
}
const cutout = (grey, out) => { if (!existsSync(out) || args.redo) execFileSync('python', ['-E', '-P', join(ROOT, 'scripts', 'lib', 'cutout.py'), grey, out], { stdio: 'inherit' }); };

async function eraTurnaround(c) {
  const d = dirOf(c);
  const only = (args.only ?? 'face,armor,front,left,back,right').split(',');
  const portrait = join(ROOT, 'public', 'ui', 'portraits', `portrait_${c.id}.webp`);
  const face = join(d, 'face.png');
  const sheet = join(d, 'armor_grey.png');
  const front = join(d, 'front_grey.png');
  if (only.includes('face')) { log(c.id, 'face…'); await gemini(face, ERA_FACE(c), [portrait], '1:1'); }
  if (only.includes('armor')) { log(c.id, 'armor sheet…'); await gemini(sheet, ERA_ARMOR(c), [portrait], '16:9'); cutout(sheet, join(d, 'armor.png')); }
  if (only.includes('front')) { log(c.id, 'front…'); await gemini(front, ERA_FRONT(c), [sheet, face], '1:1'); cutout(front, join(d, 'front.png')); }
  await Promise.all(['left', 'back', 'right'].filter((v) => only.includes(v)).map(async (w) => {
    log(c.id, `${w}…`);
    await gemini(join(d, `${w}_grey.png`), ERA_VIEW(c, w), [front, sheet, face], '1:1');
  }));
  for (const w of ['left', 'back', 'right'].filter((v) => only.includes(v))) cutout(join(d, `${w}_grey.png`), join(d, `${w}.png`));
  if (['armor', 'front', 'left', 'back', 'right'].every((w) => existsSync(join(d, `${w}.png`)))) progress(c, 'concept (Gemini: face → costume turnaround → front/left/back/right, cut out)', rel(d));
  log(c.id, 'concept done');
}

async function concept(c) {
  if (c.era) return eraTurnaround(c);
  if (args.turnaround) return turnaround(c);
  await styleSheet();
  const d = dirOf(c);
  const only = (args.only ?? (args.views4 ? 'front,left,back,right,face' : 'front,left,back,face,detail')).split(',');
  const front = join(d, 'front.png');
  if (only.includes('front') && (!existsSync(front) || args.redo)) {
    log(c.id, 'front…');
    if (args.from) await edit(front, EMPTY_FISTS, [join(ROOT, args.from)]);
    else {
      // The six Ming generals added later have only their new portraits: the face is taken from it (a third reference).
      const portrait = join(ROOT, 'public', 'ui', 'portraits', `portrait_${c.id}.webp`);
      const face = NEW_MING.has(c.id) && existsSync(portrait);
      await edit(front, frontPrompt(c) + (face ? ' The third attached picture is his portrait: keep his face, beard and age, recast photographically.' : ''), [STYLE, join(ROOT, 'public', 'ui', 'armor', `${c.armor}.webp`), ...(face ? [portrait] : [])]);
    }
    log(c.id, 'front ready');
  }
  await Promise.all(['left', 'back', 'right', 'face', 'detail'].filter((w) => only.includes(w)).map(async (w, i) => {
    const out = join(d, `${w}.png`);
    if (existsSync(out) && !args.redo) return;
    await sleep(i * 3000);
    log(c.id, `${w}…`);
    await edit(out, SHEETS[w] ?? viewPrompt(w), [front]);
    log(c.id, `${w} ready`);
  }));
  if (['front', 'left', 'back'].every((w) => existsSync(join(d, `${w}.png`)))) progress(c, 'concept (front/left/back/face/detail)', rel(d));
}

// ---------------------------------------------------------------- model
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const tripoAuth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` };
async function tripoUpload(f) {
  const form = new FormData();
  // Cutout views go up as PNG with their alpha; a JPEG would fill the background.
  form.set('file', new Blob([await sharp(f).resize(2048, 2048, { fit: 'inside' }).png().toBuffer()], { type: 'image/png' }), 'view.png');
  const j = await http('POST', `${TRIPO}/upload`, tripoAuth, form);
  return j.data.image_token ?? j.data.file_token;
}
/** Tripo's v3.1 at the quality chosen per run (--quality=detailed|standard), a face budget Meshy can rig. */
const tripoRequest = (tokens) => ({
  type: 'multiview_to_model', model_version: 'v3.1-20260211',
  // Tripo's order: front, left, back, right.
  files: [0, 1, 2, 3].map((i) => (tokens[i] ? { type: 'png', file_token: tokens[i] } : {})),
  texture: true, pbr: true, texture_quality: args.texture ?? 'detailed', geometry_quality: args.geometry ?? 'detailed', face_limit: Number(args.faces ?? 300000), orientation: 'default',
});

const meshyAuth = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
const dataUri = async (f) => `data:image/png;base64,${(await sharp(f).resize(2048, 2048, { fit: 'inside' }).png().toBuffer()).toString('base64')}`;
async function meshyPoll(path, id, what) {
  for (let last = -1; ; ) {
    const t = await http('GET', `https://api.meshy.ai/openapi/v1/${path}`, meshyAuth);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${what} ${t.status}: ${JSON.stringify(t.task_error ?? {})}`);
    if (t.progress !== last) log(id, what, `${t.progress}%`);
    last = t.progress;
    await sleep(15_000);
  }
}

async function model(c) {
  const d = dirOf(c);
  const out = join(d, 'raw.glb');
  if (existsSync(out) && !args.redo) return log(c.id, 'raw model there');
  // --swaplr: views made before the profile wording was fixed (left.png showed his right side).
  const views = (args.views4 ? (args.swaplr ? ['front', 'right', 'back', 'left'] : ['front', 'left', 'back', 'right']) : ['front', 'left', 'back']).map((w) => join(d, `${w}.png`));
  const r = recordOf(out);
  // A task already made is fetched again without its views (they may have been cleared for disk space).
  if (!r.task) for (const v of views) if (!existsSync(v)) throw new Error(`missing ${rel(v)}`);
  // Tripo while its balance covers a model (40 credits at standard geometry), then Meshy (30), keeping 5 per remaining rig.
  let provider = r.provider ?? args.provider ?? 'meshy';
  if (!provider) {
    const tripoLeft = (await http('GET', `${TRIPO}/user/balance`, tripoAuth)).data.balance;
    provider = tripoLeft >= 40 ? 'tripo' : 'meshy';
    if (provider === 'meshy') {
      const meshyLeft = (await http('GET', 'https://api.meshy.ai/openapi/v1/balance', meshyAuth)).balance;
      if (meshyLeft < 30 + 5 * 8) throw new Error(`credits exhausted: tripo ${tripoLeft}, meshy ${meshyLeft} (rigs reserved)`);
    }
  }
  if (!r.task) {
    if (provider === 'tripo') {
      const tokens = [];
      for (const v of views) tokens.push(await tripoUpload(v));
      const body = tripoRequest(tokens);
      const j = await http('POST', `${TRIPO}/task`, { ...tripoAuth, 'Content-Type': 'application/json' }, JSON.stringify(body));
      if (j.code !== 0) throw new Error(JSON.stringify(j));
      Object.assign(r, { provider, task: j.data.task_id, at: new Date().toISOString(), request: body });
    } else {
      const body = { ai_model: 'meshy-7.1', should_texture: true, enable_pbr: true, texture_resolution: '4k', geometry_resolution: '2k', should_remesh: false, pose_mode: 'a-pose', image_enhancement: false, remove_lighting: true, target_formats: ['glb'] };
      const j = await http('POST', 'https://api.meshy.ai/openapi/v1/multi-image-to-3d', meshyAuth, JSON.stringify({ ...body, image_urls: await Promise.all(views.map(dataUri)) }));
      Object.assign(r, { provider, task: j.result, at: new Date().toISOString(), request: body });
    }
    record(out, r);
    log(c.id, 'model task', provider, r.task);
  }
  let url;
  if (provider === 'tripo') {
    for (let last = -1; ; ) {
      const d2 = (await http('GET', `${TRIPO}/task/${r.task}`, tripoAuth)).data;
      if (d2.status === 'success') { r.credits = d2.consumed_credit ?? d2.credits_consumed ?? null; url = d2.output.pbr_model ?? d2.output.model ?? d2.output.base_model; break; }
      if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d2.status)) throw new Error(`tripo ${d2.status}: ${JSON.stringify(d2).slice(0, 300)}`);
      if (d2.progress !== last) log(c.id, 'model', `${d2.progress}%`);
      last = d2.progress;
      await sleep(10_000);
    }
  } else {
    const t = await meshyPoll(`multi-image-to-3d/${r.task}`, c.id, 'model');
    r.credits = t.consumed_credits ?? null;
    url = t.model_urls.glb;
  }
  writeFileSync(out, await download(url));
  record(out, r);
  ledger({ provider, what: `${c.id} model`, task: r.task, credits: r.credits });
  log(c.id, 'raw model saved', r.credits, 'credits');
}

// ---------------------------------------------------------------- rig + motion (Meshy: one skeleton for all)
const blender = (script, ...a) => execFileSync(BLENDER, ['-b', '--python', join(ROOT, 'scripts', 'lib', script), '--', ...a], { stdio: 'ignore' });

/**
 * The upload for rigging from a Meshy model (already facing +Z on the ground): cut to 120k triangles by meshoptimizer,
 * which never collapses across a UV seam (Blender's decimate does and cracks the face's texture), colour map at 2k.
 */
async function uploadPrep(src, out) {
  const { io, simplify } = await import('./lib/figure.mjs');
  const { dedup, prune, textureCompress, weld } = await import('@gltf-transform/functions');
  const doc = await io.read(src);
  const { transformMesh } = await import('@gltf-transform/functions');
  const { Matrix4 } = await import('three');
  // Every mesh into world space, then a Tripo figure (facing +X) turned to face +Z, centred, feet at y = 0.
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) transformMesh(node.getMesh(), node.getWorldMatrix());
  }
  for (const node of doc.getRoot().listNodes()) node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const box = () => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const a = p.getAttribute('POSITION'); const mn = a.getMin([]), mx = a.getMax([]);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], mn[i]); hi[i] = Math.max(hi[i], mx[i]); }
    }
    return [lo, hi];
  };
  let [lo, hi] = box();
  const turn = hi[2] - lo[2] > (hi[0] - lo[0]) * 1.3;
  const m = new Matrix4();
  if (turn) m.makeRotationY(-Math.PI / 2);
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m.toArray());
  [lo, hi] = box();
  const t = new Matrix4().makeTranslation(-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2);
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, t.toArray());
  if (turn) log('prep', 'turned a quarter to face +Z');
  await doc.transform(weld());
  const mesh = doc.getRoot().listMeshes().reduce((a, m) => (m.listPrimitives()[0].getAttribute('POSITION').getCount() > a.listPrimitives()[0].getAttribute('POSITION').getCount() ? m : a));
  const have = mesh.listPrimitives()[0].getIndices().getCount() / 3;
  const tris = have > 126_000 ? simplify(doc, 120_000, 0.02, [], 1, mesh) : have;
  await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [2048, 2048], quality: 92 }));
  await io.write(out, doc);
  log('prep', rel(out), Math.round(tris), 'triangles');
  if (tris > 300_000) throw new Error(`upload still ${tris} triangles: seams stop the cut`);
}

/**
 * Meshy auto-rigging of a 120k-triangle upload of the figure (scripts/lib/cast-prep.py: faced to +Z, feet at the
 * origin, textures 2k). Rig and motions are Meshy's alone: nothing is retargeted or re-weighted here.
 */
async function rig(c) {
  const d = dirOf(c);
  const out = join(d, 'rig.glb');
  if (existsSync(out) && !args.redo) return log(c.id, 'rig there');
  const up = join(d, 'prep_upload.glb');
  if (!existsSync(up)) {
    await uploadPrep(join(d, existsSync(join(d, 'retex.glb')) ? 'retex.glb' : 'raw.glb'), up);
  }
  const r = recordOf(out);
  if (!r.task) {
    const j = await http('POST', 'https://api.meshy.ai/openapi/v1/rigging', meshyAuth, JSON.stringify({ model_url: `data:model/gltf-binary;base64,${readFileSync(up).toString('base64')}`, height_meters: 1.85 }));
    Object.assign(r, { task: j.result, at: new Date().toISOString(), height_meters: 1.85 });
    record(out, r);
    log(c.id, 'rig task', r.task);
  }
  const t = await meshyPoll(`rigging/${r.task}`, c.id, 'rig');
  r.credits = t.consumed_credits ?? 5;
  writeFileSync(out, await download(t.result.rigged_character_glb_url));
  record(out, r);
  ledger({ provider: 'meshy', what: `${c.key} rig`, task: r.task, credits: r.credits });
  log(c.id, 'rig ready');
}

/**
 * Meshy library actions on the rig (GET /openapi/v1/animations/library), each clip played as Meshy made it.
 * Override with --actions=idle:11,command:101,slash:97,walk:30.
 */
// Per weapon kind (chosen on yi's rig, review/motion_candidates_*.png): sword idle 246 Idle 6 (owner's pick: planted wide stance, sword low),
// command 240 Thrust Slash (the arm thrust forward), attack 97 Left Slash; spear idle 335 Axe Breathe, attack 214 Punch
// Forward with Both Fists (two-hand thrust), command shares the sword's; bow idle 244 Idle 4, command 29 Call Gesture
// (free right arm sent forward), attack 227 Archery Shot 3. Unedited Meshy library clips.
// Lead's picks 2026-10-17: idle 252 Idle 12 (with --posture), attack 241 Weapon Combo 2 (92 Double Combo Attack for
// long-skirted generals via --actions), archery 227.
// Owner 2026-10-17: standing only — the one clip is 251 Idle 11 (command and attack clips removed).
const KIND_ACTIONS = 'idle_sword:251';
const MESHY_CLIP = { sword_judgment: 'command_sword', sword_shout: 'command_sword', charged_slash: 'command_sword', idle_12: 'idle_sword', idle_11: 'idle_sword', weapon_combo_2: 'attack_sword', double_combo_attack: 'attack_sword', idle_6: 'idle_sword', thrust_slash: 'command_sword', left_slash: 'attack_sword', axe_breathe_and_look_around: 'idle_spear', punch_forward_with_both_fists: 'attack_spear', idle_4: 'idle_bow', call_gesture: 'command_bow', archery_shot_3: 'attack_bow' };
const ACTIONS = Object.fromEntries((args.actions ?? KIND_ACTIONS).split(',').map((p) => p.split(':')).map(([n, id]) => [Number(id), n]));
async function motion(c) {
  const d = dirOf(c);
  const out = join(d, 'anim.glb');
  if (existsSync(out) && !args.redo) return log(c.id, 'motions there');
  const r = recordOf(out);
  if (!r.task) {
    const ids = Object.keys(ACTIONS).map(Number);
    const j = await http('POST', 'https://api.meshy.ai/openapi/v1/animations', meshyAuth, JSON.stringify({ rig_task_id: recordOf(join(d, 'rig.glb')).task, action_ids: ids }));
    Object.assign(r, { task: j.result, action_ids: ids, names: ACTIONS, at: new Date().toISOString() });
    record(out, r);
  }
  const t = await meshyPoll(`animations/${r.task}`, c.id, 'motions');
  r.credits = t.consumed_credits ?? null;
  writeFileSync(out, await download(t.result.animation_glb_url));
  record(out, r);
  ledger({ provider: 'meshy', what: `${c.key} motions`, task: r.task, credits: r.credits });
  log(c.id, 'motions ready');
}

// ---------------------------------------------------------------- pack
/** The clip names the screen plays (src/ui/generals/GeneralModel.tsx): idle, command, slash, walk. */
function clipName(name) {
  // --clipmap=<Meshy clip>:<our clip>,… names clips outside MESHY_CLIP (the armour-pieces pilot's Idle_9, victory, …).
  const map = Object.fromEntries((args.clipmap ?? '').split(',').filter(Boolean).map((p) => p.split(':')));
  if (map[name]) return map[name];
  const n = name.toLowerCase();
  const k = n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (MESHY_CLIP[k]) return MESHY_CLIP[k];
  if (n.includes('shout')) return 'command';
  if (n.includes('slash')) return 'slash';
  if (n.includes('idle')) return 'idle';
  if (n.includes('walk')) return 'walk';
  return name;
}

async function pack(c) {
  const d = dirOf(c);
  const { io, simplify } = await import('./lib/figure.mjs');
  const { dedup, meshopt, prune, quantize, resample, textureCompress } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const dir = join(ROOT, 'public', 'models', 'generals');
  const LODS = [
    // LOD0 graphics high (PC, close-up), LOD1 tablet, LOD2 phone; KTX2 has no loader in this project, so webp.
    // LOD0 keeps Meshy's rigged mesh as it is (~120k): cutting it smears the small face.
    { suffix: '', triangles: 125_000, base: 4096, other: 2048, error: 0.02, flags: [] },
    { suffix: '_lod1', triangles: 10_000, base: 1024, other: 1024, error: 1, flags: ['Permissive'] },
    { suffix: '_lod2', triangles: 5_000, base: 512, other: 512, error: 1, flags: ['Permissive'] },
  ];
  const levels = {};
  for (const lod of LODS) {
    const doc = await io.read(join(d, 'anim.glb'));
    for (const a of doc.getRoot().listAnimations()) a.setName(clipName(a.getName()));
    // --idle=<clip>: a calmer Meshy idle from anim_idles.glb (more library actions on the same rig task) replaces the
    // first one; copied channel for channel by joint name, unchanged.
    if (args.idle) {
      const src = await io.read(join(d, 'anim_idles.glb'));
      const clip = src.getRoot().listAnimations().find((a) => a.getName() === args.idle);
      if (!clip) throw new Error(`anim_idles.glb has no ${args.idle}`);
      for (const a of doc.getRoot().listAnimations()) if (a.getName() === 'idle') a.dispose();
      const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
      const buffer = doc.getRoot().listBuffers()[0];
      const copy = doc.createAnimation('idle');
      for (const ch of clip.listChannels()) {
        const target = byName.get(ch.getTargetNode().getName());
        if (!target) continue;
        const sm = ch.getSampler();
        const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(acc(sm.getInput())).setOutput(acc(sm.getOutput())).setInterpolation(sm.getInterpolation());
        copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
      }
    }
    // --slim=<depth>[,<width>]: a V-taper at bind pose, positions only (weights, joints, UVs, vertex count and order
    // kept): between chest and hips the front of the body is drawn back toward the spine and the waist sides inward,
    // with a smooth bump falloff, so the belly no longer pushes out over the belt. Arms (far from the midline) untouched.
    if (args.slim) {
      const [depth, width = String(Number(args.slim) * 0.5)] = args.slim.split(',').map(String);
      for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
        const P = prim.getAttribute('POSITION'); const a = P.getArray().slice(); const n = P.getCount();
        let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { y0 = Math.min(y0, a[i * 3 + 1]); y1 = Math.max(y1, a[i * 3 + 1]); }
        const H = y1 - y0; if (H <= 0) continue;
        // the spine line: mean x/z of the vertices in the waist band
        let sx = 0, sz = 0, c = 0; for (let i = 0; i < n; i++) { const t = (a[i * 3 + 1] - y0) / H; if (t > 0.6 && t < 0.67 && Math.abs(a[i * 3]) < 0.12 * H) { sx += a[i * 3]; sz += a[i * 3 + 2]; c++; } }
        if (!c) continue; const xc = sx / c, zc = sz / c;
        for (let i = 0; i < n; i++) {
          const t = (a[i * 3 + 1] - y0) / H; const dx = a[i * 3] - xc; if (Math.abs(dx) > 0.13 * H) continue;
          const u = (t - Number(args.slimat ?? 0.645)) / 0.065; if (Math.abs(u) >= 1) continue;
          const w = Math.cos((u * Math.PI) / 2) ** 2 * (1 - Math.max(0, (Math.abs(dx) - 0.09 * H) / (0.04 * H)));
          const dz = a[i * 3 + 2] - zc;
          if (dz > 0) a[i * 3 + 2] = zc + dz * (1 - Number(depth) * w);
          a[i * 3] = xc + dx * (1 - Number(width) * w);
        }
        P.setArray(a);
      }
    }
    // --robe: long-robe figures take a narrow-stance sword set (Sword Shout 101 as command, Right-hand Sword Slash
    // 219 as attack), Meshy clips made on the same rig (motion-candidates/robe.glb), copied by joint name, unedited.
    if (args.robe) {
      const src = await io.read(join(d, 'motion-candidates', 'robe.glb'));
      const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
      const buffer = doc.getRoot().listBuffers()[0];
      for (const [name, from] of [['command_sword', 'Sword_Shout'], ['attack_sword', 'Right_Hand_Sword_Slash']]) {
        const clip = src.getRoot().listAnimations().find((a) => a.getName().split('|').includes(from) || a.getName() === from);
        if (!clip) throw new Error(`robe.glb has no ${from}`);
        for (const a of doc.getRoot().listAnimations()) if (a.getName() === name) a.dispose();
        const copy = doc.createAnimation(name);
        for (const ch of clip.listChannels()) {
          const target = byName.get(ch.getTargetNode().getName());
          if (!target) continue;
          const sm = ch.getSampler();
          const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
          const sampler = doc.createAnimationSampler().setInput(acc(sm.getInput())).setOutput(acc(sm.getOutput())).setInterpolation(sm.getInterpolation());
          copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
        }
      }
    }
    // --commandfrom=<clip>: command_sword becomes a copy of that clip of the same rig (lead 2026-10-17: command_bow,
    // Meshy 29 Call Gesture, the sword arm sent straight forward), unedited.
    if (args.commandfrom) {
      const from = doc.getRoot().listAnimations().find((a) => a.getName() === args.commandfrom);
      if (!from) throw new Error(`no clip ${args.commandfrom}`);
      const buffer = doc.getRoot().listBuffers()[0];
      for (const a of doc.getRoot().listAnimations()) if (a.getName() === 'command_sword') a.dispose();
      const copy = doc.createAnimation('command_sword');
      for (const ch of from.listChannels()) {
        const sm = ch.getSampler();
        const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(acc(sm.getInput())).setOutput(acc(sm.getOutput())).setInterpolation(sm.getInterpolation());
        copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(sampler));
      }
    }
    // --headup=<deg>[:clip,clip]: a constant pitch-up of the head in those clips (default idle_sword), taken in the
    // neck's bind frame about the body's left-right axis, so a library idle that looks at the ground faces forward.
    // --posture=<Bone>:<deg>[:x|y|z],…[;clip,clip]: the same constant turn on other bones (x pitch-up by default, y yaw, z roll, body axes) (spine straight,
    // chest out, chin up), each about the body's left-right axis in its own parent frame.
    const pitches = [];
    if (args.headup) { const [deg, which] = args.headup.split(':'); pitches.push(['Head', deg, which]); }
    if (args.posture) { const [list, which] = args.posture.split(';'); for (const p of list.split(',')) { const [b, deg, axis] = p.split(':'); pitches.push([b, deg, which, axis]); } }
    for (const [bone, deg, which, axis = 'x'] of pitches) {
      const clips = (which ?? 'idle_sword').split(',');
      const nodes = doc.getRoot().listNodes();
      const parentOf = new Map(); for (const n of nodes) for (const ch of n.listChildren()) parentOf.set(ch, n);
      const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
      const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
      const head = nodes.find((n) => n.getName() === bone);
      if (!head) throw new Error(`no bone ${bone}`);
      let P = [0, 0, 0, 1]; for (let n = parentOf.get(head); n; n = parentOf.get(n)) P = mul(n.getRotation(), P);
      const t = (-Number(deg) * Math.PI) / 180;
      const e = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis]; const Q = mul(mul(inv(P), [e[0] * Math.sin(t / 2), e[1] * Math.sin(t / 2), e[2] * Math.sin(t / 2), Math.cos(t / 2)]), P);
      for (const a of doc.getRoot().listAnimations()) {
        if (!clips.includes(a.getName())) continue;
        for (const ch of a.listChannels()) {
          if (ch.getTargetNode() !== head || ch.getTargetPath() !== 'rotation') continue;
          const acc = ch.getSampler().getOutput(); const arr = acc.getArray().slice();
          for (let i = 0; i < arr.length; i += 4) { const q = mul(Q, [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]]); const l = Math.hypot(...q); arr.set(q.map((x) => x / l), i); }
          acc.setArray(arr);
        }
      }
    }
    // Grip sockets from the fist itself (bind pose): the centre of the vertices the hand bone carries, the grip axis
    // along the knuckle line (the widest direction of the fist across the forearm), pointing to the thumb side
    // (forward in the A-pose). socket_grip_right / socket_grip_left are children of the hand bones.
    {
      const { Matrix4, Vector3 } = await import('three');
      const skin = doc.getRoot().listSkins()[0];
      const joints = skin.listJoints();
      for (const [hand, fore, name] of [['RightHand', 'RightForeArm', 'socket_grip_right'], ['LeftHand', 'LeftForeArm', 'socket_grip_left']]) {
        const hj = joints.findIndex((j) => j.getName() === hand);
        const handNode = joints[hj]; const foreNode = joints.find((j) => j.getName() === fore);
        if (hj < 0 || !foreNode) continue;
        for (const old of handNode.listChildren()) if (old.getName() === name) old.dispose();
        const pts = [];
        for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
          const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
          if (!J || !W) continue;
          const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
          for (let i = 0; i < P.getCount(); i++) { J.getElement(i, j); W.getElement(i, w); let h = 0; for (let k = 0; k < 4; k++) if (j[k] === hj) h += w[k]; if (h > 0.6) pts.push(P.getElement(i, v).slice()); }
        }
        if (pts.length < 20) continue;
        const mid = pts.reduce((a, p) => a.map((x, k) => x + p[k] / pts.length), [0, 0, 0]);
        const wrist = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(handNode.getWorldMatrix()));
        const elbow = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(foreNode.getWorldMatrix()));
        const along = wrist.clone().sub(elbow).normalize();
        // covariance → the widest axis across the forearm (power iteration on the covariance with `along` projected out)
        const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const p of pts) { const d = new Vector3(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]); d.addScaledVector(along, -d.dot(along)); const a = d.toArray(); for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[r][q] += a[r] * a[q]; }
        let k = new Vector3(0, 0, 1);
        for (let it = 0; it < 50; it++) { const a = k.toArray(); k = new Vector3(...[0, 1, 2].map((r) => C[r][0] * a[0] + C[r][1] * a[1] + C[r][2] * a[2])); k.addScaledVector(along, -k.dot(along)).normalize(); }
        if (k.z < 0) k.negate();
        const x = along.clone().addScaledVector(k, -along.dot(k)).normalize();
        const z = x.clone().cross(k).normalize();
        const world = new Matrix4().makeBasis(x, k, z).setPosition(new Vector3(...mid));
        const local = new Matrix4().fromArray(handNode.getWorldMatrix()).invert().multiply(world);
        const socket = doc.createNode(name).setMatrix(local.toArray());
        handNode.addChild(socket);
        if (lod.suffix === '') log(c.id, name, pts.length, 'fist vertices');
      }
      // A one-armed figure (Nelson) carries a `left_handed` marker: GeneralModel holds his weapon in the left fist.
      if (c.hand === 'left') skin.listJoints().find((j) => j.getName() === 'Hips')?.addChild(doc.createNode('left_handed'));
    }
    // Meshy's rigged output keeps only a 2k colour map (from the 2k upload); the raw model's own full-size colour,
    // normal and metal/roughness maps go back on (the UVs are the raw model's), sized per level below.
    const raw = await io.read(join(d, existsSync(join(d, 'retex.glb')) ? 'retex.glb' : 'raw.glb'));
    const from = raw.getRoot().listMaterials()[0];
    for (const m of args.keeptex ? [] : doc.getRoot().listMaterials()) {
      for (const slot of ['BaseColor', 'Normal', ...(args.nomr ? [] : ['MetallicRoughness'])]) {
        const src = from[`get${slot}Texture`]();
        if (!src) continue;
        let image = src.getImage();
        // Meshy de-lights its colour map toward cream; --grade=<saturation> brings brass and lacquer back to the concept.
        if (slot === 'BaseColor' && args.studs) {
          const { brassStuds } = await import('./lib/cast-studs.mjs');
          const r = await brassStuds(image);
          image = r.png;
          if (lod.suffix === '') log(c.id, 'studs tinted', r.tinted, 'px', (r.share * 100).toFixed(2) + '%');
        }
        if (slot === 'BaseColor' && args.skin) {
          const { warmSkin } = await import('./lib/cast-studs.mjs');
          image = (await warmSkin(image)).png;
        }
        for (const fix of ['deblue', 'lacquer']) {
          if (slot !== 'BaseColor' || !args[fix]) continue;
          const lib = await import('./lib/cast-studs.mjs');
          const r = await lib[fix === 'deblue' ? 'deBlue' : 'lacquer'](image);
          image = r.png;
          if (lod.suffix === '') log(c.id, fix, r.tinted, 'px');
        }
        if (slot === 'BaseColor' && args.grade) image = new Uint8Array(await sharp(Buffer.from(image)).modulate({ saturation: Number(args.grade) }).linear(1.08, -6).png().toBuffer());
        const tex = doc.createTexture(`${slot}`).setImage(image).setMimeType(slot === 'BaseColor' && (args.grade || args.studs || args.skin || args.deblue || args.lacquer) ? 'image/png' : src.getMimeType());
        m[`set${slot}Texture`](tex);
      }
      // --eyes=x,y,w,h@size: the eyes' texel box on the raw colour map (found from the face's UVs): sclera and iris
      // toned to the concept, the box made non-metal and rough so the eyes stop mirroring the sky.
      if (args.eyes && m.getBaseColorTexture()) {
        const [boxes, size] = args.eyes.split('@');
        const { fixEyes } = await import('./lib/cast-studs.mjs');
        for (const xywh of boxes.split(';')) {
          const [x, y, w, h] = xywh.split(',').map(Number);
          const r = await fixEyes(m.getBaseColorTexture().getImage(), { x, y, w, h, size: Number(size) }, m.getMetallicRoughnessTexture()?.getImage());
          m.getBaseColorTexture().setImage(r.color).setMimeType('image/png');
          if (r.mr) m.getMetallicRoughnessTexture().setImage(r.mr).setMimeType('image/png');
          if (lod.suffix === '') log(c.id, 'eyes', xywh, r.sclera, 'sclera px', r.iris, 'iris px');
        }
      }
      // --torso: the chest plate alone (by its bind-pose place) gets lacquer colour and gloss; the rest keeps Meshy's maps.
      if (args.torso && m.getBaseColorTexture() && m.getMetallicRoughnessTexture()) {
        const { regionMask, lacquerRegion } = await import('./lib/cast-studs.mjs');
        const body0 = doc.getRoot().listMeshes().reduce((a, x) => (x.listPrimitives()[0].getAttribute('POSITION').getCount() > a.listPrimitives()[0].getAttribute('POSITION').getCount() ? x : a));
        const size = m.getBaseColorTexture().getSize()[0];
        const mask = regionMask(body0.listPrimitives()[0], size, { x: 0.13, y0: 0.5, y1: 0.76, z: -0.02 });
        const r = await lacquerRegion(m.getBaseColorTexture().getImage(), m.getMetallicRoughnessTexture().getImage(), mask, size, m.getNormalTexture()?.getImage());
        if (r.normal) m.getNormalTexture().setImage(r.normal).setMimeType('image/png');
        m.getBaseColorTexture().setImage(r.color).setMimeType('image/png');
        m.getMetallicRoughnessTexture().setImage(r.mr).setMimeType('image/png');
        if (lod.suffix === '') log(c.id, 'torso lacquer', r.tinted, 'px');
      }
      m.setMetallicFactor(args.nomr ? 0 : from.getMetallicFactor()).setRoughnessFactor(args.nomr ? Number(args.rough ?? 0.7) : from.getRoughnessFactor());
    }
    const meshes = doc.getRoot().listMeshes();
    const body = meshes.reduce((a, m) => (m.listPrimitives()[0].getAttribute('POSITION').getCount() > a.listPrimitives()[0].getAttribute('POSITION').getCount() ? m : a));
    // LOD0 never across UV seams (collapsing them tears the face's texture); the small levels must, to reach budget.
    const have = body.listPrimitives()[0].getIndices().getCount() / 3;
    const triangles = have > lod.triangles ? simplify(doc, lod.triangles, lod.error, lod.flags, 1, body) : have;
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }),
      resample(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 88 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness|occlusion|emissive)/, resize: [lod.other, lod.other], quality: 88 }),
      quantize({ quantizeTexcoord: 16, quantizePosition: 16 }), // 12-bit UVs crack the generated atlas at its seams
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    // A candidate (--cand) is packed beside the live files, under _stage/<cand>/, until `live` puts it in place.
    const stage = args.cand ? join(dir, '_stage', args.cand) : dir;
    mkdirSync(stage, { recursive: true });
    const out = join(stage, `${c.key}${lod.suffix}.glb`);
    await io.write(out, doc);
    levels[lod.suffix || '_lod0'] = { triangles: Math.round(triangles), bytes: readFileSync(out).length, clips: doc.getRoot().listAnimations().map((a) => a.getName()) };
    levels[lod.suffix || '_lod0'].check = await staticCheck(out, lod);
  }
  const bad = Object.entries(levels).filter(([, l]) => !l.check.ok);
  if (bad.length) throw new Error(`static check failed: ${JSON.stringify(bad)}`);
  record(join(d, 'pack'), { at: new Date().toISOString(), args: rest, levels });
  progress(c, 'packed (not live): provider → bytes → static check ok (LOD0/1/2) → Meshy rig → Meshy motions', `public/models/generals/${c.key}.glb`);
  log(c.id, 'DONE', JSON.stringify(levels));
}

/**
 * The GLB as written, read back from its bytes: the glTF magic, one skin with the Meshy joints, the clips the screen
 * plays, the triangle and texture budgets of its level, a standing human's bounds.
 */
async function staticCheck(file, lod) {
  const { io } = await import('./lib/figure.mjs');
  const bytes = readFileSync(file);
  const problems = [];
  if (bytes.readUInt32LE(0) !== 0x46546c67) problems.push('not glb');
  const doc = await io.read(file);
  const root = doc.getRoot();
  const skins = root.listSkins();
  const joints = skins[0]?.listJoints().map((j) => j.getName()) ?? [];
  for (const j of ['Hips', 'Head', 'RightHand', 'LeftHand']) if (!joints.includes(j)) problems.push(`no joint ${j}`);
  const clips = root.listAnimations().map((a) => a.getName());
  // Owner 2026-10-17: standing only, one clip (idle_sword = Meshy 251 Idle 11); scripts/generals-idle-only.mjs reduces a pack to it.
  if (!clips.includes('idle_sword')) problems.push('no clip idle_sword');
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  if (tris > lod.triangles * (lod.suffix === '_lod2' ? 2.1 : 1.5)) problems.push(`triangles ${tris}`);
  const textures = root.listTextures().map((t) => t.getSize());
  if (textures.some((s) => s && Math.max(...s) > lod.base)) problems.push(`texture over ${lod.base}`);
  const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  return { ok: problems.length === 0, problems, bytes: bytes.length, sha256, triangles: tris, joints: joints.length, clips, textures };
}

/** Puts a packed figure on the 장수 screen: only after its renders were looked at (--checked=<what was reviewed>). */
async function live(c) {
  if (!args.checked) throw new Error('live needs --checked=<renders reviewed>');
  const dir = join(ROOT, 'public', 'models', 'generals');
  if (args.cand) {
    const { copyFileSync } = await import('node:fs');
    for (const s of ['', '_lod1', '_lod2']) copyFileSync(join(dir, '_stage', args.cand, `${c.key}${s}.glb`), join(dir, `${c.key}${s}.glb`));
  }
  for (const s of ['', '_lod1', '_lod2']) if (!existsSync(join(dir, `${c.key}${s}.glb`))) throw new Error(`not packed: ${c.key}${s}`);
  const f = join(dir, 'index.json');
  const list = new Set(JSON.parse(readFileSync(f, 'utf8')));
  list.add(c.key);
  writeFileSync(f, JSON.stringify([...list].sort()) + '\n');
  progress(c, `LIVE (checked: ${args.checked})`, `public/models/generals/${c.key}.glb`);
  log(c.id, 'live');
}

/**
 * Meshy Retexture of another provider's geometry (Tripo's) from the three concept views: Meshy's textures, the face
 * above all, on Tripo's shape. The upload is the 120k cut; its output replaces raw.glb for rigging and packing.
 */
async function retexture(c) {
  const d = dirOf(c);
  const out = join(d, 'retex.glb');
  if (existsSync(out) && !args.redo) return log(c.id, 'retexture there');
  const up = join(d, 'retex_input.glb');
  if (!existsSync(up)) await uploadPrep(join(d, 'raw.glb'), up);
  const r = recordOf(out);
  if (!r.task) {
    const body = { ai_model: 'meshy-7', enable_pbr: true, texture_resolution: '4k', enable_original_uv: false, target_formats: ['glb'] };
    const j = await http('POST', 'https://api.meshy.ai/openapi/v1/retexture', meshyAuth, JSON.stringify({ ...body, model_url: `data:model/gltf-binary;base64,${readFileSync(up).toString('base64')}`, multiview_image_urls: await Promise.all(['front', 'left', 'back'].map((w) => dataUri(join(d, `${w}.png`)))) }));
    Object.assign(r, { task: j.result, at: new Date().toISOString(), request: body, views: ['front', 'left', 'back'] });
    record(out, r);
    log(c.id, 'retexture task', r.task);
  }
  const t = await meshyPoll(`retexture/${r.task}`, c.id, 'retexture');
  r.credits = t.consumed_credits ?? null;
  writeFileSync(out, await download(t.model_urls.glb));
  record(out, r);
  ledger({ provider: 'meshy', what: `${c.key} retexture`, task: r.task, credits: r.credits });
  log(c.id, 'retexture ready', r.credits, 'credits');
}

async function all(c) { await concept(c); await model(c); await rig(c); await motion(c); await pack(c); }

/**
 * review: prints the review gate for one figure from .claude/skills/generals-cast/SKILL.md (the owner's settled
 * rules: step 6, the weapon rules and the rejected list), with what exists for it: sources, pack args, sheets.
 */
async function review(c) {
  const skill = readFileSync(join(ROOT, '.claude', 'skills', 'generals-cast', 'SKILL.md'), 'utf8');
  const section = (h) => { const i = skill.indexOf(h); if (i < 0) return ''; const j = skill.indexOf('\n## ', i + h.length); return skill.slice(i, j < 0 ? undefined : j).trim(); };
  const g0 = skill.indexOf('6. **Review gate**');
  const gate = skill.slice(g0, skill.indexOf('\n## ', g0)).trim();
  const d = dirOf(c);
  const packed = existsSync(join(d, 'pack.json')) ? JSON.parse(readFileSync(join(d, 'pack.json'), 'utf8')) : null;
  const sheets = existsSync(join(PKG, 'review')) ? readdirSync(join(PKG, 'review')).filter((f) => f.startsWith(c.key)) : [];
  const live = JSON.parse(readFileSync(join(ROOT, 'public', 'models', 'generals', 'index.json'), 'utf8')).includes(c.key);
  console.log(`# Review gate: ${c.key}${args.cand ? ` (${args.cand})` : ''}  ${live ? '[LIVE]' : '[not live]'}`);
  console.log(`sources: ${rel(d)}  views: ${['armor', 'front', 'left', 'back', 'right', 'face'].filter((w) => existsSync(join(d, `${w}.png`))).join(',') || '-'}  raw:${existsSync(join(d, 'raw.glb'))} rig:${existsSync(join(d, 'rig.glb'))} anim:${existsSync(join(d, 'anim.glb'))}`);
  console.log(`pack: ${packed ? `${packed.at} args ${JSON.stringify(packed.args ?? '(not recorded)')}` : 'not packed'}`);
  console.log(`sheets: ${sheets.join(', ') || 'none'}\n`);
  for (const t of [gate, section('## Weapon rules'), section('## Rejected')]) console.log(`${t}\n`);
  console.log('Tick every item above against the sheets; any flaw means redo that step. Live only after the lead approves.');
}

/**
 * deform: the per-frame deformation metric (scripts/lib/deform.mjs) of a packed figure, every clip (or --clip=a,b),
 * worst frames first; --file=<glb> scores any skinned GLB. Exit 1 when a clip is over the 0.3 promotion threshold.
 */
async function deform(c) {
  const { loadFigure, prepare, scoreClip, stance } = await import('./lib/deform.mjs');
  const file = args.file ?? join(ROOT, 'public', 'models', 'generals', `${c.key}.glb`);
  const F = await loadFigure(file); const s = prepare(F);
  let over = 0;
  for (const clip of args.clip ? args.clip.split(',') : Object.keys(F.clips)) {
    const r = scoreClip(F, s, clip);
    const worst = r.worst.filter((x, i, a) => a.findIndex((y) => Math.abs(y.time - x.time) < 0.25) === i).slice(0, 4);
    const st = /idle/.test(clip) ? stance(F, clip) : null;
    if (r.score > 0.3) over++;
    log(c.id, `${clip.padEnd(14)} ${r.score.toFixed(2)}${r.score > 0.3 ? ' OVER' : ''}  worst ${worst.map((w) => `t${w.time.toFixed(2)}(${w.score.toFixed(2)} crush ${w.crush.toFixed(3)} col ${w.collapse.toFixed(3)} pierce ${w.pierce.toFixed(3)})`).join(' ')}${st ? `  stance tilt ${st.tilt.toFixed(1)} shift ${st.shift.toFixed(2)}` : ''}`);
  }
  if (over) throw new Error(`${over} clip(s) over 0.3`);
}

const STEPS = { concept, model, retexture, rig, motion, pack, live, review, all, deform };
if (!STEPS[step]) throw new Error(`step: ${Object.keys(STEPS).join(' | ')}`);
mkdirSync(PKG, { recursive: true });
const ids = args.id === 'all' ? CAST.map((c) => c.id) : (args.id ?? 'yi').split(',');
let failed = 0;
await Promise.all(ids.map(async (id, i) => {
  if (!BY[id]) throw new Error(`no general ${id}`);
  await sleep(i * 2500);
  return STEPS[step](jobOf(BY[id], args.armor)).catch((e) => { failed++; log(id, 'FAILED', String(e).slice(0, 400)); });
}));
process.exitCode = failed ? 1 : 0;
