import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
process.loadEnvFile(join(ROOT, '.env'));

const CONCEPT_DIR = join(ROOT, 'assets-src', 'concepts');
const MODEL_DIR = join(ROOT, 'assets-src', 'models');
const TASKS_FILE = join(ROOT, 'assets-src', 'tasks.json');

const STYLE =
  'Highly detailed realistic 3D game asset render, physically based materials, soft studio lighting, ' +
  'isolated on a plain pure white background, the entire object fully visible and centered, ' +
  'three-quarter view from slightly above, no water, no people, no text, no watermark.';

const CONCEPTS = {
  panokseon:
    'A 16th-century Joseon Korean panokseon warship. Broad flat-bottomed wooden hull of weathered brown pine planks, ' +
    'two-level design: the lower hull has about ten long wooden oars per side protruding from oar ports; ' +
    'the raised upper deck is enclosed by a continuous wall of vertical wooden shield planks with square cannon ports and bronze cannon muzzles; ' +
    'a small two-storey command pavilion with a dark grey Korean giwa tiled hip-and-gable roof with gently upturned eaves stands near the stern; ' +
    'two tall wooden masts carrying rectangular tan hemp sails with horizontal battens; ' +
    'colorful Joseon military banners in blue, red, yellow, white and black on bamboo poles along the deck. ' +
    STYLE,
  geobukseon:
    'A Korean turtle ship (geobukseon) from the Imjin War, 1592. Long wooden hull with about ten oars per side, ' +
    'the whole deck covered by a low curved armored roof made of hexagonal turtle-shell shaped wooden plates studded with rows of short iron spikes, ' +
    'a narrow cross-shaped walkway along the roof ridge, a fierce carved dragon head figurehead at the bow painted red with white teeth and smoke vents, ' +
    'cannon ports along both sides with dark iron cannon muzzles, decorative painted geometric patterns in red, blue and white along the upper hull, ' +
    'one short lowered mast. ' +
    STYLE,
  atakebune:
    'A large Japanese Sengoku-period atakebune warship from 1592. Massive box-like wooden hull with many oars along both sides, ' +
    'a multi-level wooden fortress superstructure with black lacquered walls, white plaster panels and rows of small rectangular loopholes for matchlock guns, ' +
    'a small castle-style tower on top with dark curved Japanese tiled roofs, ' +
    'a single large mast with a furled square straw-colored sail, tall white nobori banners with a simple black circular crest. ' +
    STYLE,
  sekibune:
    'A Japanese sekibune medium warship from the late 16th century. Long slender wooden hull with a sharp bow, many oars on each side, ' +
    'protective vertical wooden bulwark panels along the sides with small gun ports, a small covered deck cabin with a light wooden roof, ' +
    'a single mast with a square woven straw sail, two tall white nobori banners. ' +
    STYLE,
  panokseon_grand:
    'A colossal 16th-century Joseon Korean panokseon flagship that looks like a floating wooden fortress-palace. ' +
    'Very broad flat-bottomed hull of dark weathered pine planks with iron bands and about twelve long oars per side. ' +
    'Above the hull rises an enormous fully enclosed two-storey battle house (panok): its tall outer walls are thick vertical wooden shield boards with two rows of square cannon ports and bronze cannon muzzles, crowned by a parapet. ' +
    'On the top deck stands a grand two-storey command pavilion (jangdae) with red lacquered pillars, ornate dancheong painted brackets in green, red and blue, and a sweeping dark grey giwa tiled hip-and-gable roof with dramatically upturned eaves, plus a smaller roofed tower at the bow. ' +
    'Two very tall masts with large tan battened sails, dozens of colorful Joseon military banners and one huge commander banner. Massive, imposing, architectural, like a building on the sea. ' +
    STYLE,
  card_panokseon: {
    aspect: '3:4',
    prompt:
      'Painterly East Asian concept art card illustration: a mighty Joseon Korean panokseon warship with a tiled-roof pavilion and many banners, sailing through dark waves under cannon smoke, seen from a low dramatic angle. ' +
      'Muted ink-wash palette of deep teal, charcoal and ochre with gold and vermilion accents, visible brush strokes, aged silk texture, cinematic lighting, no text, no border, no frame.',
  },
  card_geobukseon: {
    aspect: '3:4',
    prompt:
      'Painterly East Asian concept art card illustration: a Korean turtle ship geobukseon with a spiked armored roof and a fierce red dragon head breathing smoke, charging through waves, low dramatic angle. ' +
      'Muted ink-wash palette of deep teal, charcoal and ochre with gold and vermilion accents, visible brush strokes, aged silk texture, cinematic lighting, no text, no border, no frame.',
  },
  card_atakebune: {
    aspect: '3:4',
    prompt:
      'Painterly East Asian concept art card illustration: a huge Japanese atakebune warship like a floating black-and-white castle with tall white nobori banners, advancing through misty sea, low dramatic angle. ' +
      'Muted ink-wash palette of charcoal, bone white and dark red with gold accents, visible brush strokes, aged silk texture, cinematic lighting, no text, no border, no frame.',
  },
  card_sekibune: {
    aspect: '3:4',
    prompt:
      'Painterly East Asian concept art card illustration: a fast Japanese sekibune warship with oars and a square straw sail and white banners, rowing aggressively across choppy water, low dramatic angle. ' +
      'Muted ink-wash palette of charcoal, bone white and dark red with gold accents, visible brush strokes, aged silk texture, cinematic lighting, no text, no border, no frame.',
  },
  portrait_yi: {
    aspect: '1:1',
    prompt:
      'Painterly portrait of a stern, dignified Joseon dynasty Korean naval admiral in his late forties around 1592, wearing a black gat hat with red military robes and lamellar armor, thin moustache and beard, calm resolute gaze, three-quarter view, chest-up. ' +
      'Traditional Korean portrait painting blended with cinematic concept art, muted ink-wash palette with gold accents, aged silk texture, dark background, no text, no frame.',
  },
  portrait_admiral: {
    aspect: '1:1',
    prompt:
      'Painterly portrait of a Joseon dynasty Korean naval commander around 1592 in blue military robes, lamellar armor and a black wide-brimmed gat hat, determined expression, three-quarter view, chest-up. ' +
      'Traditional Korean portrait painting blended with cinematic concept art, muted ink-wash palette with gold accents, aged silk texture, dark background, no text, no frame.',
  },
  portrait_japan: {
    aspect: '1:1',
    prompt:
      'Painterly portrait of a Sengoku-period Japanese samurai naval commander around 1592 in dark lacquered armor with a crested kabuto helmet, fierce expression, three-quarter view, chest-up. ' +
      'Japanese ink painting blended with cinematic concept art, muted palette of charcoal and dark red with gold accents, aged paper texture, dark background, no text, no frame.',
  },
  emblem_joseon: {
    aspect: '1:1',
    prompt:
      'A circular faction emblem for the Joseon Korean navy for a strategy game UI: a stylized turtle ship silhouette with a dragon head inside a ring of traditional Korean cloud patterns, deep blue and vermilion enamel with polished gold rims, ornate, symmetrical, centered on a plain black background, no text.',
  },
  emblem_japan: {
    aspect: '1:1',
    prompt:
      'A circular faction emblem for a Sengoku-era Japanese navy for a strategy game UI: a stylized wave crest with a black and white family-crest style design and a tall banner, black lacquer and deep red enamel with polished gold rims, ornate, symmetrical, centered on a plain black background, no text.',
  },
  panel_texture: {
    aspect: '1:1',
    prompt:
      'Seamless tileable texture of very dark brown-black lacquered wood with extremely subtle faint gold traditional East Asian cloud pattern and fine grain, low contrast, flat even lighting, top-down, no objects, no text.',
  },
  map_south_coast: {
    aspect: '16:9',
    prompt:
      'Antique East Asian ink-wash painted map on aged off-white paper of the southern coast of the Korean peninsula: a long jagged coastline with deep bays and peninsulas, countless small islands scattered in the sea, one large island in the east-center, mountain ranges inland drawn with expressive brush strokes and light grey washes, faint rivers, pale empty sea with very subtle wave line texture, top-down cartographic view, muted grey and sepia tones, no text, no labels, no compass, no border.',
  },
  fig_yi: { aspect: '9:16', prompt: 'Admiral Yi Sun-sin of Joseon Korea in 1592, a calm stern man in his late forties with a thin moustache and beard, wearing a black gat hat with a red plume and a crimson military robe under dark lamellar armor, holding a sword at his side. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_yi2: {
    aspect: '9:16',
    prompt:
      'Heroic full-body character art of Admiral Yi Sun-sin (1545-1598), the legendary Korean admiral of the Joseon navy, about fifty years old, at the moment before battle. ' +
      'Tall, lean and commanding; a long oval face with high cheekbones, deep-set piercing eyes full of calm resolve, a thin drooping black moustache and a long thin goatee beard streaked with grey, weathered skin. ' +
      'He wears authentic late 16th-century Joseon general armor: a long knee-length deep crimson dujeonggap brigandine coat covered in rows of polished brass rivets, wide studded shoulder guards, armored arm guards, a dark navy under-robe, black leather boots; ' +
      'on his head a Joseon iron general helmet (tugu) with a tall gilded spike, a flowing red horsehair plume and studded brigandine ear and neck flaps. ' +
      'A long dark crimson war cloak billows behind him in the sea wind. Both of his hands rest on the pommel of a long straight Joseon sword planted point-down in front of him. ' +
      'Epic, dignified, legendary, cinematic rim light, extremely detailed painterly digital illustration in the style of Total War: Three Kingdoms hero character art, realistic proportions, full body from helmet plume to boots, ' +
      'isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.',
  },
  portrait_yi2: {
    aspect: '1:1',
    prompt:
      'Epic chest-up portrait of Admiral Yi Sun-sin (1545-1598), the legendary Korean admiral of the Joseon navy, about fifty years old. ' +
      'A long oval face with high cheekbones, deep-set piercing eyes full of calm unbreakable resolve, a thin drooping black moustache and a long thin goatee beard streaked with grey, weathered skin. ' +
      'He wears a Joseon iron general helmet (tugu) with a gilded spike, a flowing red horsehair plume and studded ear flaps, and a deep crimson dujeonggap brigandine armor covered in brass rivets with a dark crimson cloak. ' +
      'Behind him, dark stormy sky with drifting cannon smoke and the faint silhouette of panokseon warship banners. ' +
      'Dramatic cinematic side lighting, extremely detailed painterly digital illustration in the style of Total War: Three Kingdoms character portraits, muted ink-wash palette with crimson and gold accents, no text, no frame.',
  },
  ...Object.fromEntries(
    [
      ['portrait_won', 'Won Gyun (1540-1597), a heavyset Joseon Korean naval commander in his fifties with a thick black beard and a proud stubborn scowl, wearing a Joseon iron helmet with a red horsehair plume and a dark blue dujeonggap brigandine armor with brass rivets'],
      ['portrait_eokgi', 'Yi Eok-gi (1561-1597), a young Joseon Korean naval commander about thirty with a handsome refined face, a thin moustache, noble royal-clan bearing and determined eyes, wearing a Joseon iron helmet with a dark blue plume and a deep teal brigandine armor with brass rivets'],
      ['portrait_jeongun', 'Jeong Un (1543-1592), a fierce Joseon Korean naval captain in his late forties with blazing eyes, a short black beard and a scar on his cheek, wearing an iron helmet with a red plume and worn crimson brigandine armor'],
      ['portrait_eo', 'Eo Yeong-dam, a weathered veteran Joseon Korean navigator and ship captain in his sixties with a grey beard and wise sharp eyes, wearing a black military jeollip hat with a peacock feather and a dark blue military robe with leather lamellar armor'],
      ['portrait_kwon', 'Gwon Jun, a scholarly Joseon Korean officer in his forties with a neat black beard and calm intelligent eyes, wearing a black military jeollip hat with a peacock feather and dark green brigandine armor'],
      ['portrait_anwi', 'An Wi, a brave Joseon Korean ship captain in his forties with an intense determined expression and a short beard, wearing an iron helmet with a red plume and dark crimson brigandine armor, face lit by fire'],
      ['portrait_admiral2', 'a Joseon Korean naval officer in his forties with a black beard and stern eyes, wearing a Joseon iron helmet with a red plume and dark blue dujeonggap brigandine armor with brass rivets'],
      ['portrait_wakisaka', 'Wakisaka Yasuharu (1554-1626), a Sengoku-period Japanese daimyo naval commander in his late thirties with a sharp confident face and a thin moustache, wearing dark blue lacquered armor with gold trim and a kabuto helmet with a tall golden crest'],
      ['portrait_todo', 'Todo Takatora (1556-1630), a very tall imposing Sengoku-period Japanese general in his early forties with a stern face and a short beard, wearing black lacquered armor and a kabuto helmet with a distinctive tall pointed Tang-style crest'],
      ['portrait_kuki', 'Kuki Yoshitaka (1542-1600), a seasoned Japanese pirate lord turned admiral in his fifties with a weathered face and a grey beard, wearing dark red lacquered armor and a black kabuto helmet with a crescent crest'],
      ['portrait_kato', 'Kato Yoshiaki (1563-1631), a stern Japanese samurai naval commander about thirty, clean-shaven with a hard gaze, wearing blue-black lacquered armor and a kabuto helmet with a long horn-like crest'],
      ['portrait_kurushima', 'Kurushima Michifusa (1561-1597), a fierce Japanese sea lord in his thirties with an aggressive expression, wearing dark green and black lacquered armor with wave motifs and a kabuto helmet with antler crests'],
      ['portrait_shimazu', 'Shimazu Yoshihiro (1535-1619), an aged formidable Japanese daimyo general in his sixties with a white moustache and beard, wearing black lacquered armor and a white surcoat with a cross-in-circle crest, and a kabuto helmet with a black crest'],
      ['portrait_konishi', 'Konishi Yukinaga (1555-1600), a shrewd Japanese daimyo commander in his forties with an intelligent face and a thin moustache, wearing dark purple lacquered armor and a kabuto helmet with a silver crescent crest'],
      ['portrait_japan2', 'a Sengoku-period Japanese samurai ship captain in his thirties with a hard determined face, wearing simple dark lacquered armor and a black jingasa war hat'],
      ['portrait_chenlin', 'Chen Lin (1543-1607), a Ming Chinese admiral in his fifties with a long black beard and a severe face, wearing ornate Ming general armor with a red cape and a helmet with a red tassel'],
      ['portrait_deng', 'Deng Zilong (1528-1598), an elderly Ming Chinese general in his seventies with a long white beard and fierce eyes, wearing Ming armor with gold dragon motifs and a helmet with a red tassel'],
    ].map(([key, who]) => [
      key,
      {
        aspect: '1:1',
        prompt:
          `Epic chest-up character portrait of ${who}. ` +
          'Dramatic cinematic side lighting; behind him a dark stormy sky with drifting cannon smoke and faint warship silhouettes. ' +
          'Extremely detailed painterly digital illustration in the style of Total War: Three Kingdoms character portraits, muted ink-wash palette with gold accents, no text, no frame.',
      },
    ]),
  ),
  bust_yi: {
    aspect: '1:1',
    prompt:
      'Highly detailed realistic 3D character sculpture reference of Admiral Yi Sun-sin (1545-1598) of Joseon Korea, upper body from the waist up, facing slightly to the left in a three-quarter view, arms at his sides, calm resolute expression. ' +
      'Long oval face with high cheekbones, deep-set eyes, thin drooping black moustache and a long thin goatee beard streaked with grey. ' +
      'He wears a Joseon iron general helmet (tugu) with a gilded spike, a red horsehair plume and studded brigandine ear and neck flaps, a deep crimson dujeonggap brigandine armor covered in rows of brass rivets with studded shoulder guards, a dark navy under-robe collar, and a crimson cloak over the shoulders. ' +
      'Physically based materials, realistic skin, soft even studio lighting, isolated on a plain pure white background, the whole upper body visible and centered, no text, no watermark.',
  },
  bust_yi_hero: {
    aspect: '1:1',
    prompt:
      'Highly detailed realistic 3D character sculpture of the legendary Korean Admiral Yi Sun-sin in 1597, heroic and charismatic, upper body from the waist up, standing tall and facing the viewer almost frontally with the head turned very slightly, both hands resting on the pommel of a long straight Joseon sword held vertically in front of his chest. ' +
      'Intense commanding expression: furrowed brows, piercing deep-set eyes staring straight ahead, firm set jaw, lean weathered face with high cheekbones, a thin drooping black moustache and a long thin goatee beard streaked with grey. ' +
      'He wears a Joseon iron general helmet (tugu) with a gilded spike and a large flowing red horsehair plume, studded brigandine ear and neck flaps, a deep crimson dujeonggap brigandine armor covered in rows of polished brass rivets with heavy studded shoulder guards, a dark navy collar, and a dark crimson cloak hanging from the shoulders. ' +
      'Physically based materials, realistic skin pores, crisp sculpted details, soft even studio lighting, isolated on a plain pure white background, the whole upper body and sword hilt visible and centered, no text, no watermark.',
  },
  bust_daimyo: {
    aspect: '1:1',
    prompt:
      'Highly detailed realistic 3D character sculpture reference of a Sengoku-period Japanese samurai general of 1592, upper body from the waist up, facing slightly to the right in a three-quarter view, arms at his sides, stern fierce expression with a short moustache. ' +
      'He wears black lacquered o-yoroi armor laced with dark red silk cords, large shoulder guards, and a black kabuto helmet with a wide neck guard and a tall golden crescent crest, a white surcoat with a black family crest over the armor. ' +
      'Physically based materials, realistic skin, soft even studio lighting, isolated on a plain pure white background, the whole upper body visible and centered, no text, no watermark.',
  },
  mingship:
    'A large late 16th-century Ming dynasty Chinese war junk (fuchuan): a tall wooden hull with a high raised stern castle and a raised bow, large painted eyes on both sides of the bow, dark red and black lacquered upper works with gilded trim, ' +
    'three masts with reddish-brown battened junk sails, a row of small bronze cannon ports along the side, tall red and yellow Ming military banners. ' +
    STYLE,
  mingship_small:
    'A small late 16th-century Ming dynasty Chinese war boat (shachuan): a flat-bottomed wooden junk about fifteen meters long with low bulwarks and a square stern, painted eyes at the bow, two masts with reddish-brown battened sails, oars along the sides, red Ming banners. ' +
    STYLE,
  fig_won: { aspect: '9:16', prompt: 'A heavyset Joseon Korean naval commander in 1597 with a thick beard and a proud expression, wearing a black gat hat and a blue military robe under brown lamellar armor, hand on his sword hilt. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_chenlin: { aspect: '9:16', prompt: 'A Ming Chinese admiral in 1598 with a long black beard and a severe face, wearing ornate Ming dynasty general armor with a red cape and a helmet with a red tassel, holding a halberd. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_wakisaka: { aspect: '9:16', prompt: 'A young Sengoku-period Japanese samurai naval commander in 1592 with a sharp confident face, wearing dark blue lacquered armor with gold trim and a kabuto helmet with a tall golden crest, holding a war fan. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_todo: { aspect: '9:16', prompt: 'A very tall powerfully built Sengoku-period Japanese samurai general in 1592 wearing black lacquered armor and a kabuto helmet with distinctive tall pointed crests, stern face with a short beard, holding a spear. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_kuki: { aspect: '9:16', prompt: 'A seasoned Sengoku-period Japanese pirate-turned-admiral in 1592 with a weathered face and grey beard, wearing dark red lacquered armor and a black kabuto helmet with a crescent crest, one hand on a katana. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_kurushima: { aspect: '9:16', prompt: 'A fierce Sengoku-period Japanese sea lord samurai in 1597 with an aggressive expression, wearing dark green and black lacquered armor with a wave-motif surcoat and a kabuto helmet with antler crests, gripping a naginata. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_shimazu: { aspect: '9:16', prompt: 'An aged but formidable Sengoku-period Japanese daimyo general in 1598 with a white moustache, wearing black lacquered armor with a white surcoat bearing a simple cross-in-circle crest and a kabuto helmet with a black crest, holding a tessen fan. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  fig_japan: { aspect: '9:16', prompt: 'A Sengoku-period Japanese samurai fleet captain in 1592 wearing simple dark lacquered armor and a jingasa war hat, determined face, holding a matchlock arquebus. Highly detailed painterly digital illustration in the style of a historical strategy game character art, standing full-body portrait from head to boots, realistic proportions, historically accurate late 16th century armor and robes, dignified pose, soft even studio lighting, isolated on a plain light off-white parchment background with only a faint ink-wash shadow at the feet, no text, no border, no frame.' },
  hyeopseon:
    'A small 16th-century Joseon Korean auxiliary warship called hyeopseon: a simple open wooden boat about twelve meters long with a flat bottom, low wooden bulwarks, a single mast with a small rectangular tan hemp sail, six oars per side and one small blue Joseon banner at the stern. ' +
    STYLE,
  kobaya:
    'A small Japanese kobaya fast assault boat from 1592: a narrow open wooden boat about twelve meters long with a sharp upswept bow, low wooden shield panels along the sides, eight oars per side, no sail, one tall white nobori banner with a black crest. ' +
    STYLE,
  ink_banner: {
    aspect: '21:9',
    prompt: 'A single bold horizontal East Asian calligraphy ink brush stroke, pure white ink on a pure black background, wide dry-brush stroke with rough frayed ends and fine bristle texture, centered, filling most of the width, no text, no other marks.',
  },
  ink_frame: {
    aspect: '4:3',
    prompt: 'A rectangular frame drawn with East Asian ink brush strokes: white ink on a pure black background, uneven dry-brush edges forming a loose rectangular border with the center completely empty and black, no text.',
  },
  hanji_texture: {
    aspect: '1:1',
    prompt: 'Seamless tileable texture of traditional Korean hanji mulberry rice paper, warm off-white cream color with visible long fibers and subtle uneven thickness, very soft flat lighting, top-down, no objects, no text.',
  },
  ink_wash_texture: {
    aspect: '1:1',
    prompt: 'Seamless tileable texture of dark charcoal black East Asian ink wash on paper, very subtle cloudy ink gradients and paper fiber texture, low contrast, flat lighting, no objects, no text.',
  },
  choga:
    'A traditional Joseon-era Korean thatched-roof farmhouse (choga) from the 16th century: a low single-storey L-shaped house with pale clay-and-straw walls on a low fieldstone base, exposed dark wooden posts and lintels, small paper-covered lattice doors, ' +
    'a thick rounded golden-brown rice straw thatched roof tied down with a net of straw ropes, a small low stone wall and a stack of firewood beside it. ' +
    STYLE.replace('no people, ', 'no people, no ground plane, '),
  giwa:
    'A traditional Joseon-era Korean tiled-roof house (giwa-jip) from the 16th century: a single-storey wooden house on a raised granite stone platform, dark brown wooden pillars, white plaster walls between timber frames, paper lattice doors, ' +
    'a heavy dark grey clay-tile hip-and-gable roof with gracefully upturned eave corners and white mortar ridge lines. ' +
    STYLE.replace('no people, ', 'no people, no ground plane, '),
  fortgate:
    'A Joseon dynasty Korean coastal fortress gate from the 16th century: a thick wall of large fitted grey granite blocks with crenellated parapet, a single arched stone gateway with heavy wooden doors, ' +
    'and on top a two-storey wooden gate pavilion with red pillars, green-and-red dancheong painted brackets and a dark grey tiled hip-and-gable roof with upturned eaves, short stretches of stone wall extending to both sides. ' +
    STYLE.replace('no people, ', 'no people, no ground plane, '),
  bongsu:
    'A Joseon dynasty Korean beacon fire station (bongsudae) on a hilltop: five short round chimney-like towers built of rough stacked grey stone in a row on a low stone platform, each with a dark sooty opening at the top, a small storage hut with a thatched roof at the side. ' +
    STYLE.replace('no people, ', 'no people, no ground plane, '),
  dragonhead:
    'A carved wooden dragon head figurehead from a Korean turtle ship (geobukseon), Joseon dynasty style. ' +
    'Fierce wide open mouth with white teeth, curled horns, flowing carved mane, bulging eyes, ' +
    'painted in red lacquer with green and gold accents, the neck ends in a flat mounting base. ' +
    STYLE,
};

async function readTasks() {
  if (!existsSync(TASKS_FILE)) return {};
  return JSON.parse(await readFile(TASKS_FILE, 'utf8'));
}

async function writeTasks(tasks) {
  await mkdir(join(ROOT, 'assets-src'), { recursive: true });
  await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

async function generateConcept(name, variant) {
  const entry = CONCEPTS[name];
  if (!entry) throw new Error(`unknown concept ${name}`);
  const prompt = typeof entry === 'string' ? entry : entry.prompt;
  const aspect = typeof entry === 'string' ? '4:3' : entry.aspect;
  const base = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
  const model = process.env.GEMINI_IMAGE_MODEL;
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image) throw new Error(`no image for ${name}: ${JSON.stringify(json).slice(0, 400)}`);
  await mkdir(CONCEPT_DIR, { recursive: true });
  const ext = image.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const out = join(CONCEPT_DIR, `${name}_${variant}.${ext}`);
  await writeFile(out, Buffer.from(image.inlineData.data, 'base64'));
  console.log('concept', out);
}

async function tripoUpload(file) {
  const form = new FormData();
  const buf = await readFile(file);
  const type = extname(file).slice(1) === 'jpg' ? 'image/jpeg' : 'image/png';
  form.append('file', new Blob([buf], { type }), basename(file));
  const res = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` },
    body: form,
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`tripo upload: ${JSON.stringify(json)}`);
  return json.data.image_token ?? json.data.file_token;
}

async function tripoSubmit(file, faceLimit) {
  const token = await tripoUpload(file);
  const ext = extname(file).slice(1) === 'jpg' ? 'jpg' : 'png';
  const body = {
    type: 'image_to_model',
    file: { type: ext, file_token: token },
    texture: true,
    pbr: true,
    texture_quality: 'detailed',
    face_limit: faceLimit,
    model_version: process.env.TRIPO_MODEL_VERSION ?? 'v3.1-20260211',
    geometry_quality: process.env.TRIPO_GEOMETRY ?? 'detailed',
  };
  const res = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`tripo task: ${JSON.stringify(json)}`);
  return json.data.task_id;
}

async function tripoStatus(id) {
  const res = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${id}`, {
    headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` },
  });
  const json = await res.json();
  const data = json.data ?? {};
  const out = data.output ?? {};
  return {
    status: data.status,
    progress: data.progress,
    url: out.pbr_model ?? out.model ?? out.base_model,
    preview: out.rendered_image,
  };
}

async function meshySubmit(file, polycount) {
  const buf = await readFile(file);
  const mime = extname(file).slice(1) === 'jpg' ? 'image/jpeg' : 'image/png';
  const res = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:${mime};base64,${buf.toString('base64')}`,
      ai_model: process.env.MESHY_AI_MODEL ?? 'latest',
      topology: 'triangle',
      target_polycount: polycount,
      should_remesh: true,
      should_texture: true,
      enable_pbr: true,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`meshy ${res.status}: ${JSON.stringify(json)}`);
  return json.result;
}

async function meshyStatus(id) {
  const res = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${id}`, {
    headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` },
  });
  const json = await res.json();
  return {
    status: json.status === 'SUCCEEDED' ? 'success' : json.status?.toLowerCase(),
    progress: json.progress,
    url: json.model_urls?.glb,
    preview: json.thumbnail_url,
    error: json.task_error?.message,
  };
}

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await mkdir(MODEL_DIR, { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

async function submit(provider, files, polycount) {
  const tasks = await readTasks();
  for (const file of files) {
    const path = join(CONCEPT_DIR, file);
    const key = `${provider}:${basename(file, extname(file))}${process.env.TAG ? '_' + process.env.TAG : ''}`;
    if (tasks[key]) {
      console.log('skip existing', key);
      continue;
    }
    const id = provider === 'tripo' ? await tripoSubmit(path, polycount) : await meshySubmit(path, polycount);
    tasks[key] = { provider, id, file, status: 'queued' };
    console.log('submitted', key, id);
    await writeTasks(tasks);
  }
}

async function poll() {
  const tasks = await readTasks();
  let pending = 0;
  for (const [key, task] of Object.entries(tasks)) {
    if (task.status === 'downloaded' || task.status === 'failed') continue;
    const info = task.provider === 'tripo' ? await tripoStatus(task.id) : await meshyStatus(task.id);
    task.status = info.status ?? task.status;
    task.progress = info.progress;
    if (info.status === 'success' && info.url) {
      const name = key.replace(':', '_');
      await download(info.url, join(MODEL_DIR, `${name}.glb`));
      if (info.preview) await download(info.preview, join(MODEL_DIR, `${name}_preview${extname(new URL(info.preview).pathname) || '.webp'}`));
      task.status = 'downloaded';
    } else if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(info.status)) {
      task.status = 'failed';
      task.error = info.error;
    } else {
      pending += 1;
    }
    console.log(key, task.status, task.progress ?? '', task.error ?? '');
  }
  await writeTasks(tasks);
  return pending;
}

const [command, ...args] = process.argv.slice(2);

if (command === 'concepts') {
  const names = args.length ? args : Object.keys(CONCEPTS);
  const variants = Number(process.env.VARIANTS ?? 2);
  await Promise.all(
    names.flatMap((name) =>
      Array.from({ length: variants }, (_, i) =>
        generateConcept(name, i + 1).catch((e) => console.error('fail', name, i + 1, e.message)),
      ),
    ),
  );
} else if (command === 'submit') {
  const [provider, polycount, ...files] = args;
  await submit(provider, files, Number(polycount));
} else if (command === 'poll') {
  const wait = args[0] === 'wait';
  for (;;) {
    const pending = await poll();
    if (!wait || pending === 0) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
} else if (command === 'list') {
  console.log((await readdir(CONCEPT_DIR)).join('\n'));
} else {
  console.log('usage: node scripts/ai-assets.mjs concepts [names] | submit <tripo|meshy> <polycount> <files...> | poll [wait]');
}
