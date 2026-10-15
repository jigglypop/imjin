// Portraits of the campaign's officers (진영 전역 인물) that the first eighteen did not cover: the named figures of the
// three navies and a set of shared faces per navy for the officers raised from the ranks or hired. The prompts follow
// the art direction of scripts/portrait-art-direction.json (square live-action film stills, helmet to upper chest,
// nation-correct armour) so the new faces sit with the old ones. Raw PNGs are cached in assets-src/ui-art/portraits
// (gitignored); output is public/ui/portraits/<id>.jpg, 768 px, quality 88, progressive, and each asset's prompt and
// hashes are written into portrait-art-direction.json.
//
//   node scripts/generate-portraits.mjs                       every missing portrait
//   node scripts/generate-portraits.mjs --only=portrait_so    some portraits
//   node scripts/generate-portraits.mjs --force --only=...    regenerate even if cached
//   node scripts/generate-portraits.mjs --convert             skip the API, only re-encode cached raws and rewrite the provenance
//   node scripts/generate-portraits.mjs --quality=high --jobs=4
// The key is OPENAI_API_KEY from .env (or the environment: node --env-file=<path> scripts/generate-portraits.mjs).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const RAW = join(ROOT, 'assets-src', 'ui-art', 'portraits');
const OUT = join(ROOT, 'public', 'ui', 'portraits');
const PROVENANCE = join(ROOT, 'scripts', 'portrait-art-direction.json');
const MODEL = 'gpt-image-2';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = '1'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const ONLY = args.only ? args.only.split(',') : null;
const QUALITY = args.quality ?? 'medium';
const JOBS = Number(args.jobs ?? 4);

// The shared tail of every prompt, per nation, from the existing portraits (portrait_admiral, portrait_japan, portrait_deng).
const KOREA = (who) =>
  'Use case: historical-scene. Asset type: square photographic commander portrait for a naval strategy game set in 1592, maximum detailed square output. ' +
  `ORIGINAL live-action casting portrait of ${who}. ` +
  'Helmet-to-upper-chest framing, centered large face readable at 60 pixels, complete helmet or hat with a little margin. Serious period Korean sea-battle film production still, mood evocative of Myeongnyang, Hansan and Noryang. ' +
  'Grounded human proportions, actual imperfect sun-weathered skin and pores, salt-stained fabric, rubbed metal, subtle uneven whiskers, understated natural expression. Real late-sixteenth-century practical materials, no luxurious fantasy ornament. ' +
  'Desaturated blue-gray cannon haze and a very soft timber-warship background, natural cool overcast side daylight and a faint warm practical fire rim, subtle 35mm film grain, believable cinematic color grade, photographic skin tones and shallow depth of field. ' +
  'Clothing and helmet silhouette must clearly identify Joseon Korea: Korean cloth brigandine (dujeonggap) with rows of rivets, low pointed Korean iron tugu helmet with a plume and cloth neck curtain, or the wide black Korean jeollip military hat; never a Japanese kabuto or a Chinese tasselled helmet. ' +
  'Original cast face, no contemporary actor copying. No painting, illustration, CGI-plastic skin, over-sharpening, glossy fantasy armor, giant decorative dragons, modern items, text, letters, logo or border. Opaque background.';

const JAPAN = (who) =>
  'A square live-action Japanese Sengoku naval war film still on a timber warship, full scenic background of blurred dark rigging, wooden rails, blue-gray sea and cannon haze. ' +
  `Foreground: ${who}. ` +
  'Strong unmistakable Japanese armor silhouette: lacquered layered tosei-gusoku plates, cord-laced shoulder guards, wide segmented shikoro neck guard, practical period kabuto helmet or broad jingasa; never Korean or Chinese costume. ' +
  'Head and upper chest visible, full helmet with a little margin, large centered face and eyes in upper third. Original mature cast face, imperfect sun-weathered human skin, serious natural expression, salt-worn matte armor, natural cool overcast side lighting and faint warm fire rim, restrained desaturated epic cinema grade, subtle 35mm grain, shallow depth of field. ' +
  'No family crest symbols, no rising sun, no text, letters or border. Realistic photograph with a scenic background occupying the entire frame.';

const MING = (who) =>
  'A square live-action late-sixteenth-century naval war film still on a timber warship. Entire frame filled by the scenic background: blurred dark rigging, wooden rails, distant blue-gray sea and cannon haze. ' +
  `Foreground: ${who}. ` +
  'Very distinctive Chinese Ming costume: rounded high steel Ming helmet bowl with a thick short red tassel and segmented neck guard, brick-red cloth brigandine with straight organized rows of plain rivets and steel lamellar shoulder sections; visibly Chinese Ming rather than Japanese kabuto or Korean tugu. ' +
  'Full helmet and upper chest visible, large centered face, eyes upper third. Original cast face, imperfect sun-weathered human skin, natural serious expression, weathered practical matte period materials, cool overcast side lighting with subtle warm fire rim, desaturated historical naval epic cinema grade, slight 35mm film grain, shallow depth of field. ' +
  'Realistic full scenic photograph, no writing, letters or border.';

const NATION = { joseon: KOREA, japan: JAPAN, ming: MING };

// Each figure: the file id (src/sim/grand/officerData.ts portrait field), the navy and the casting description.
const FIGURES = [
  // Joseon
  ['portrait_sunsin_b', 'joseon', 'a Korean Joseon naval commander Yi Sun-sin of Bangdap, about forty, square determined face, short trimmed black beard and steady level eyes; worn dark-indigo cloth brigandine, low iron Korean tugu helmet with a short red plume'],
  ['portrait_baeheungnip', 'joseon', 'a Korean county magistrate and ship captain Bae Heung-rip in his mid-forties, round weathered face, thick moustache and calm firm gaze; faded blue cloth brigandine, low iron Korean tugu helmet with a dark plume'],
  ['portrait_kimwan', 'joseon', 'a Korean naval captain Kim Wan in his mid-forties, gaunt face with high cheekbones, a sparse beard and alert eyes; wide black Korean jeollip military hat with a small feather, dark brown cloth brigandine'],
  ['portrait_jeonggeol', 'joseon', 'an elderly Korean naval veteran Jeong Geol nearly eighty, deeply lined face, long thin white beard, wise tired eyes; wide black Korean jeollip military hat, faded dark-green robe over an old cloth brigandine'],
  ['portrait_nadaeyong', 'joseon', 'a Korean military officer and shipwright Na Dae-yong in his mid-thirties, practical intelligent face, short black beard, a smear of tar on his collar; plain dark cotton military coat over a light brigandine, wide black Korean jeollip hat'],
  ['portrait_songhuirip', 'joseon', 'a Korean military officer Song Hui-rip about forty, strong jaw, short black beard, loyal steady eyes; dark red cloth brigandine, low iron Korean tugu helmet with a red plume'],
  ['portrait_yiyeongnam', 'joseon', 'a young Korean naval captain Yi Yeong-nam about thirty, lean earnest face, thin moustache; worn navy-blue cloth brigandine, low iron Korean tugu helmet with a small plume'],
  ['portrait_uchijeok', 'joseon', 'a Korean naval captain U Chi-jeok about thirty, broad face, short coarse beard and bold eyes; brown and indigo cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_yiunryong', 'joseon', 'a Korean naval captain Yi Un-ryong about thirty, sharp narrow face, small moustache, resolute expression; dark-blue cloth brigandine, low iron Korean tugu helmet with a red plume'],
  ['portrait_kimeokchu', 'joseon', 'a Korean naval commander Kim Eok-chu in his late forties, heavy brow, thick black beard, stern face; oxblood cloth brigandine, low iron Korean tugu helmet with a dark-red plume'],
  ['portrait_baeseol', 'joseon', 'a Korean naval commander Bae Seol in his mid-forties, fleshy uneasy face, thin beard and guarded eyes; dark teal cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_choiho', 'joseon', 'a Korean naval commander Choe Ho in his late fifties, gray beard, dignified tired face; dark blue cloth brigandine, low iron Korean tugu helmet with a plume'],
  ['portrait_songyeojong', 'joseon', 'a Korean naval captain Song Yeo-jong about forty, compact face, short beard, determined eyes; charcoal cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_sinho', 'joseon', 'a Korean county governor and officer Sin Ho in his mid-fifties, lean scholarly face, gray-streaked beard; wide black Korean jeollip hat, deep-green robe over a cloth brigandine'],
  ['portrait_ryuhyeong', 'joseon', 'a young Korean officer Ryu Hyeong in his late twenties, clean intense face, thin moustache, a cloth bandage at the temple; dark blue cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_yieonryang', 'joseon', 'a Korean turtle-ship captain Yi Eon-ryang in his late thirties, rugged sun-darkened face, a small scar on the chin, fierce eyes; smoke-darkened red cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_byeonjonseo', 'joseon', 'a Korean military officer Byeon Jon-seo in his late thirties, gentle oval face, neat short beard; dark gray cotton military coat, wide black Korean jeollip hat'],
  ['portrait_jeongsajun', 'joseon', 'a Korean military officer and gunsmith Jeong Sa-jun about forty, thoughtful craftsman face, short beard, a gunpowder smudge on one cheek; wide black Korean jeollip hat, plain indigo military coat'],
  ['portrait_kiminyeong', 'joseon', 'a Korean garrison officer Kim In-yeong in his mid-thirties, square face, short beard; dark green cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_yimonggu', 'joseon', 'a Korean naval deputy commander Yi Mong-gu about forty, long face, moustache and small goatee; dark-blue robe over a cloth brigandine, wide black Korean jeollip hat'],
  // Japan
  ['portrait_kan', 'japan', 'an older Japanese naval captain Kan Michinaga about sixty, weathered creased face, sparse gray beard, shrewd eyes; worn black lacquer tosei-gusoku and a broad black jingasa hat'],
  ['portrait_so', 'japan', 'a young Japanese lord of Tsushima So Yoshitoshi about twenty-four, smooth narrow clean-shaven face, composed careful eyes; dark green lacquered tosei-gusoku, black kabuto with a small plain crest'],
  ['portrait_hachisuka', 'japan', 'a Japanese daimyo Hachisuka Iemasa in his mid-thirties, broad face, short moustache, steady eyes; black lacquer tosei-gusoku with dark blue lacing, black kabuto with a simple gilded crest'],
  ['portrait_chosokabe', 'japan', 'a Japanese daimyo Chosokabe Motochika in his early fifties, long dignified face, moustache and a long thin beard; black lacquer tosei-gusoku, kabuto with a tall plain crest'],
  ['portrait_nabeshima', 'japan', 'a Japanese daimyo Nabeshima Naoshige in his fifties, hard angular face, gray moustache, severe eyes; dark brown lacquer tosei-gusoku, black kabuto'],
  ['portrait_kiyomasa', 'japan', 'a Japanese general Kato Kiyomasa about thirty, tall imposing build, a full black beard around the jaw, fierce eyes; very tall black-lacquered nagaeboshi kabuto shaped like a court cap, black lacquer tosei-gusoku'],
  ['portrait_kuroda', 'japan', 'a Japanese general Kuroda Nagamasa in his mid-twenties, keen youthful face, thin moustache; black lacquer tosei-gusoku, black kabuto with a tall flat black crest'],
  ['portrait_kobayakawa', 'japan', 'an elderly Japanese general Kobayakawa Takakage around sixty, wise lined face, thin white beard; dark crimson lacquer tosei-gusoku, black kabuto with a restrained crest'],
  ['portrait_ukita', 'japan', 'a young Japanese commander Ukita Hideie about twenty, smooth proud face; fine dark-blue lacquer tosei-gusoku with small gold details, kabuto with a gilded crest'],
  ['portrait_mori', 'japan', 'a Japanese daimyo Mori Terumoto about forty, round full face, small moustache, calm reserved eyes; deep-red lacquer tosei-gusoku, black kabuto'],
  ['portrait_manabe', 'japan', 'a Japanese sea captain Manabe Samanojo in his forties, rough weathered face with stubble, hard eyes; plain black lacquer plates, broad black jingasa hat'],
  ['portrait_horiuchi', 'japan', 'a Japanese naval lord of Kumano Horiuchi Ujiyoshi in his early forties, salt-weathered face, short beard; dark indigo lacquered tosei-gusoku plates, broad jingasa hat'],
  ['portrait_terazawa', 'japan', 'a Japanese commissioner Terazawa Masanari about thirty, lean careful face, small moustache; black lacquered tosei-gusoku, kabuto with a modest crest'],
  ['portrait_moritakamasa', 'japan', 'a Japanese naval captain Mori Takamasa in his early thirties, lean face, short beard, wary eyes; black lacquer tosei-gusoku with muted green lacing, black kabuto'],
  // Ming
  ['portrait_chencan', 'ming', 'a late-Ming Chinese naval commander Chen Can in his fifties, stern face, long black beard'],
  ['portrait_jijin', 'ming', 'a late-Ming Chinese naval officer Ji Jin in his forties, broad weathered face, thick short beard, blunt eyes'],
  ['portrait_liuting', 'ming', 'a late-Ming Chinese general Liu Ting about forty, powerful heavy-set face, a bristling black beard, fierce eyes'],
  ['portrait_magui', 'ming', 'a late-Ming Chinese general Ma Gui in his fifties, a long gray beard, hard northern frontier face'],
  ['portrait_yanghao', 'ming', 'a late-Ming Chinese military commissioner Yang Hao in his fifties, a scholar-official face, thin long beard, cautious eyes'],
  ['portrait_lirusong', 'ming', 'a late-Ming Chinese commander-in-chief Li Rusong in his mid-forties, commanding face, a full black beard, proud eyes, slightly finer gilded rivets on his brigandine'],
  ['portrait_luoshangzhi', 'ming', 'a late-Ming Chinese infantry officer Luo Shangzhi in his forties, big powerful frame, thick neck, short beard, cheerful hard eyes'],
  ['portrait_wuweizhong', 'ming', 'a late-Ming Chinese officer Wu Weizhong in his fifties, lean disciplined face, gray-streaked beard'],
  ['portrait_zhangliang', 'ming', 'a late-Ming Chinese naval officer Zhang Liangxiang in his forties, alert narrow face, short moustache and beard'],
  ['portrait_wangyuanzhou', 'ming', 'a late-Ming Chinese naval officer Wang Yuanzhou in his forties, square calm face, moustache'],
  // Shared faces for officers raised from the ranks or hired (src/sim/grand/officerData.ts GENERIC_PORTRAITS)
  ['portrait_gen_joseon_1', 'joseon', 'a young Korean naval officer in his twenties, eager weathered face, faint moustache; plain blue cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_gen_joseon_2', 'joseon', 'a grizzled Korean naval sergeant in his fifties, broken nose, gray stubble; salt-worn brown cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_gen_joseon_3', 'joseon', 'a Korean scholar-officer in his forties, refined face, neat beard; wide black Korean jeollip hat, dark green coat over a brigandine'],
  ['portrait_gen_joseon_4', 'joseon', 'a stocky Korean archer officer in his thirties, wide face, short beard; red cloth brigandine, low iron Korean tugu helmet with a red plume'],
  ['portrait_gen_joseon_5', 'joseon', 'a Korean fisherman turned naval officer in his thirties, deeply sunburnt face, squinting eyes, sparse beard; patched indigo cloth brigandine, wide black jeollip hat'],
  ['portrait_gen_joseon_6', 'joseon', 'a lean Korean naval captain in his forties, hollow cheeks, long moustache; charcoal cloth brigandine, low iron Korean tugu helmet'],
  ['portrait_gen_japan_1', 'japan', 'a young Japanese ashigaru captain in his twenties, sharp lean face, clean-shaven; simple black lacquer cuirass, black jingasa hat'],
  ['portrait_gen_japan_2', 'japan', 'a veteran Japanese samurai in his fifties, scarred cheek, gray moustache; worn dark-red lacquer tosei-gusoku, black kabuto'],
  ['portrait_gen_japan_3', 'japan', 'a Japanese sea-raider captain in his thirties, wind-burnt face, short rough beard, a cloth headband under the helmet; dark indigo lacquer plates, broad jingasa'],
  ['portrait_gen_japan_4', 'japan', 'a Japanese samurai officer in his forties, heavy face, thick moustache; black lacquer tosei-gusoku with brown lacing, black kabuto with a small crest'],
  ['portrait_gen_japan_5', 'japan', 'a Japanese arquebus captain in his thirties, narrow intent face, thin moustache; dark green lacquer plates, black jingasa hat'],
  ['portrait_gen_japan_6', 'japan', 'a Japanese samurai in his late twenties, round earnest face; dark blue lacquer tosei-gusoku, kabuto'],
  ['portrait_gen_ming_1', 'ming', 'a young late-Ming Chinese naval officer in his twenties, eager face, thin moustache'],
  ['portrait_gen_ming_2', 'ming', 'a veteran late-Ming Chinese naval sergeant in his fifties, heavy lined face, gray beard'],
  ['portrait_gen_ming_3', 'ming', 'a late-Ming Chinese officer from the southern coast in his thirties, sun-darkened face, short beard'],
  ['portrait_gen_ming_4', 'ming', 'a burly late-Ming Chinese officer in his forties, broad face, full black beard'],
  ['portrait_gen_ming_5', 'ming', 'a lean late-Ming Chinese officer in his forties, sharp face, long moustache'],
  ['portrait_gen_ming_6', 'ming', 'a late-Ming Chinese gunnery officer in his thirties, calm face, small beard, soot on his brigandine'],
].map(([id, faction, who]) => ({ id, faction, who, prompt: NATION[faction](who) }));

const rawPath = (f) => join(RAW, `${f.id}.png`);
const outPath = (f) => join(OUT, `${f.id}.jpg`);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function generate(f) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: f.prompt, size: '1024x1024', quality: QUALITY, n: 1, output_format: 'png' }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${f.id}: ${res.status} ${j.error?.message}`);
  await writeFile(rawPath(f), Buffer.from(j.data[0].b64_json, 'base64'));
}

async function convert(f) {
  await sharp(await readFile(rawPath(f))).resize(768, 768, { kernel: 'lanczos3' }).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toFile(outPath(f));
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const figures = FIGURES.filter((f) => !ONLY || ONLY.includes(f.id));
  if (!args.convert) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
    const queue = figures.filter((f) => args.force || !existsSync(rawPath(f)));
    const worker = async () => {
      for (let f; (f = queue.shift()); ) {
        for (let attempt = 1; ; attempt++) {
          try { await generate(f); break; } catch (e) { if (attempt >= 5) throw e; console.warn(String(e.message), e.cause?.code); await new Promise((r) => setTimeout(r, 5000)); }
        }
        await convert(f);
        console.log(`generated ${f.id}`);
      }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
  }
  for (const f of figures) if (existsSync(rawPath(f))) await convert(f);
  // The provenance keeps the eighteen original entries and adds or replaces one per generated portrait.
  const doc = JSON.parse(await readFile(PROVENANCE, 'utf8'));
  for (const f of FIGURES) {
    if (!existsSync(rawPath(f)) || !existsSync(outPath(f))) continue;
    const raw = await readFile(rawPath(f));
    const out = await readFile(outPath(f));
    const entry = { id: f.id, faction: f.faction, file: `public/ui/portraits/${f.id}.jpg`, sourceFile: `assets-src/ui-art/portraits/${f.id}.png`, sourceSha256: sha(raw), sha256: sha(out), bytes: out.length, provider: `OpenAI Images API ${MODEL} (${QUALITY}, 1024x1024)`, generatedBy: 'scripts/generate-portraits.mjs', prompt: f.prompt };
    const at = doc.assets.findIndex((a) => a.id === f.id);
    if (at >= 0) doc.assets[at] = entry;
    else doc.assets.push(entry);
  }
  await writeFile(PROVENANCE, JSON.stringify(doc, null, 2) + '\n');
  console.log('done');
}
await main();
