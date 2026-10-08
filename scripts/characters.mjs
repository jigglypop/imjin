// Soldier and officer models: Gemini draws a T-pose concept, Meshy turns it into a low-poly textured mesh, rigs it and
// applies library animations. Blender (scripts/blender/vat.py) then bakes the clips into vertex animation textures.
//   node scripts/characters.mjs concepts [names]        two concept variants per character
//   node scripts/characters.mjs model <name> <concept>  image to 3D from assets-src/characters/concepts/<concept>
//   node scripts/characters.mjs rig <name>              auto-rig the finished model
//   node scripts/characters.mjs animate <name>          bake the role's clips onto the rig
//   node scripts/characters.mjs poll [wait]             advance every task and download what finished
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
process.loadEnvFile(join(ROOT, '.env'));

const DIR = join(ROOT, 'assets-src', 'characters');
const CONCEPTS = join(DIR, 'concepts');
const MODELS = join(DIR, 'models');
const STATE = join(DIR, 'state.json');

const POSE =
  'Full-body 3D character model render in a strict T-pose for a game character reference: the figure stands straight and faces the camera directly in a front orthographic view, ' +
  'both arms stretched straight out sideways at shoulder height with open hands and palms down, legs straight and slightly apart, feet flat on the ground. ' +
  'The entire body from the top of the helmet to the feet is visible and centered with a margin around it. Plain pure white background, soft even studio lighting without cast shadows, ' +
  'physically based materials, highly detailed realistic textures, realistic adult proportions, nothing held in the hands, no weapons, no cape, no text, no watermark.';

const FILM = 'Original costume design in the spirit of an epic Korean historical war film about the last sea battle of the Imjin War: gritty, weathered, salt-stained and battle-worn, muted cinematic colors.';

export const CHARACTERS = {
  joseon_soldier: {
    clips: 'archer',
    prompt:
      'A battle-hardened Joseon Korean naval soldier of 1598. He wears a knee-length dujeonggap studded brigandine armor coat of deep crimson red fabric covered with neat rows of round brass rivets, ' +
      'studded shoulder guards and a black leather belt; a dark indigo under-robe shows at the collar and cuffs; black cloth trousers with white gaiters wrapped below the knees; black leather boots; ' +
      'a dark iron bowl helmet with a short spike finial, a small red tassel and studded crimson brigandine ear and neck flaps.',
  },
  joseon_marine: {
    clips: 'melee',
    prompt:
      'A tough Joseon Korean naval marine of 1598 who fights boarders on deck. He wears a knee-length dujeonggap studded brigandine armor coat of deep indigo blue fabric covered with rows of round brass rivets and edged in dark red, ' +
      'studded shoulder guards, padded armored sleeves and a black leather belt; dark trousers with white gaiters wrapped below the knees; black leather boots; ' +
      'a black-lacquered iron helmet with a pointed finial, a short red horsehair tassel and studded blue brigandine ear and neck flaps.',
  },
  joseon_officer: {
    clips: 'officer',
    prompt:
      'A commanding Joseon Korean naval general of 1598 with a stern weathered face, a thin moustache and a short beard. He wears an imposing knee-length dujeonggap brigandine armor coat of very dark navy-black silk ' +
      'with rows of gilded rivets and dark crimson edging, ornate studded shoulder guards with embossed gilded dragon heads, armored sleeves, a wide black leather belt with a gilded buckle, black leather boots, ' +
      'and a tall Joseon iron general helmet with a gilded spike, a red horsehair plume and studded ear and neck flaps.',
  },
  japan_ashigaru: {
    clips: 'gunner',
    prompt:
      'A Japanese Sengoku-period ashigaru arquebusier of 1598, lean and fierce. He wears a black-lacquered iron okegawa-do cuirass laced with dark red silk cords with a small gold crest on the chest, ' +
      'kusazuri armored skirt tassets, chain-mail kote sleeves over a dark indigo kimono, haidate thigh guards, suneate shin guards, tabi socks and straw sandals, ' +
      'and a wide conical black-lacquered jingasa hat with a small gold circular crest.',
  },
  japan_samurai: {
    clips: 'melee',
    prompt:
      'A fearsome Japanese samurai boarding warrior of 1598. He wears black and dark crimson lacquered tosei-gusoku armor with silk lacing, large rectangular sode shoulder guards, ' +
      'a kabuto helmet with a wide flared neck guard and a golden crescent maedate crest, a black iron menpo face mask with a bristling moustache, kote armored sleeves, haidate thigh guards, suneate greaves, tabi and straw sandals.',
  },
  japan_officer: {
    clips: 'officer',
    prompt:
      'A proud Japanese daimyo naval commander of 1598. He wears ornate black lacquered armor with gold lacing, a sleeveless dark brocade jinbaori surcoat with a large white family crest on the chest, ' +
      'a magnificent kabuto helmet with two tall golden horn-like crests, a black menpo half mask, armored sleeves, haidate thigh guards and greaves.',
  },
  ming_soldier: {
    clips: 'archer',
    prompt:
      'A disciplined Ming dynasty Chinese marine soldier of 1598. He wears a long bright red quilted cotton armor coat studded all over with brass rivets, studded shoulder guards and a dark leather belt, ' +
      'dark trousers tucked into black leather boots, and a rounded Ming iron helmet with a tall spike, a red horsehair tassel and a studded neck flap.',
  },
  ming_officer: {
    clips: 'officer',
    prompt:
      'A majestic Ming dynasty Chinese admiral of 1598 with a severe face and a long black beard. He wears gilded mountain-pattern lamellar armor over a dark red robe, ornate lion-head shoulder guards, ' +
      'a lion-head belt buckle, a red knee-length armored skirt, black leather boots, and an ornate gilded Ming general helmet with a tall spike, a red plume and small phoenix-wing side ornaments.',
  },
  rower: {
    clips: 'rower',
    prompt:
      'A 16th-century East Asian sailor oarsman with a lean muscular sunburnt build. Bare-headed with black hair tied in a topknot and a white cloth headband, ' +
      'wearing a plain off-white hemp jacket with rolled-up sleeves, loose hemp trousers tied with straps at the calves, a cloth belt and straw sandals.',
  },
};

// Meshy animation library ids (GET /openapi/v1/animations/library). Up to ten per request.
const CLIPS = {
  archer: { idle: 0, ready: 89, shoot: 224, melee: 240, hit: 178, die: 189, run: 14, cheer: 59 },
  gunner: { idle: 0, ready: 89, shoot: 104, reload: 170, melee: 240, hit: 178, die: 184, run: 510, cheer: 59 },
  melee: { idle: 0, ready: 89, melee: 97, thrust: 240, hit: 178, die: 189, run: 510, cheer: 59 },
  officer: { idle: 0, ready: 89, command: 101, melee: 219, hit: 178, die: 189, cheer: 59 },
  rower: { idle: 0, row: 259, haul: 276, carry: 550, hit: 178, die: 184, run: 14, cheer: 59 },
};

async function readState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(await readFile(STATE, 'utf8'));
}

async function writeState(state) {
  await mkdir(DIR, { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 2));
}

async function concept(name, variant) {
  const c = CHARACTERS[name];
  if (!c) throw new Error(`unknown character ${name}`);
  const prompt = `${POSE} ${c.prompt} ${FILM}`;
  const base = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
  const res = await fetch(`${base}/models/${process.env.GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  const image = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!image) throw new Error(`no image for ${name}: ${JSON.stringify(json).slice(0, 300)}`);
  await mkdir(CONCEPTS, { recursive: true });
  const ext = image.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const out = join(CONCEPTS, `${name}_${variant}.${ext}`);
  await writeFile(out, Buffer.from(image.inlineData.data, 'base64'));
  console.log('concept', out);
}

const meshy = async (path, init = {}) => {
  const res = await fetch(`https://api.meshy.ai/openapi/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`meshy ${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
};

async function model(name, file) {
  const buf = await readFile(join(CONCEPTS, file));
  const mime = file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const body = {
    image_url: `data:${mime};base64,${buf.toString('base64')}`,
    model_type: 'smart-topology',
    ai_model: 'meshy-t2',
    target_polycount: Number(process.env.POLY ?? 4000),
    topology: 'triangle',
    pose_mode: 't-pose',
    should_texture: true,
    enable_pbr: false,
    texture_resolution: '2k',
  };
  let json;
  try {
    json = await meshy('image-to-3d', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    console.warn('smart topology refused, falling back to remesh:', e.message);
    delete body.model_type;
    body.ai_model = 'latest';
    body.should_remesh = true;
    body.remove_lighting = true;
    json = await meshy('image-to-3d', { method: 'POST', body: JSON.stringify(body) });
  }
  const state = await readState();
  state[name] = { concept: file, model: { id: json.result, status: 'pending' } };
  await writeState(state);
  console.log('model task', name, json.result);
}

async function rig(name) {
  const state = await readState();
  const s = state[name];
  if (s?.model?.status !== 'done') throw new Error(`${name}: model not finished`);
  const json = await meshy('rigging', { method: 'POST', body: JSON.stringify({ input_task_id: s.model.id, height_meters: 1.7 }) });
  s.rig = { id: json.result, status: 'pending' };
  await writeState(state);
  console.log('rig task', name, json.result);
}

async function animate(name) {
  const state = await readState();
  const s = state[name];
  if (s?.rig?.status !== 'done') throw new Error(`${name}: rig not finished`);
  const clips = CLIPS[CHARACTERS[name].clips];
  const json = await meshy('animations', { method: 'POST', body: JSON.stringify({ rig_task_id: s.rig.id, action_ids: Object.values(clips), post_process: { operation_type: 'change_fps', fps: 24 } }) });
  s.anim = { id: json.result, status: 'pending', clips };
  await writeState(state);
  console.log('animation task', name, json.result);
}

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await mkdir(MODELS, { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log('saved', out);
}

const DONE = 'SUCCEEDED';
const FAILED = ['FAILED', 'CANCELED', 'EXPIRED'];

async function poll() {
  const state = await readState();
  let pending = 0;
  for (const [name, s] of Object.entries(state)) {
    const steps = [
      ['model', 'image-to-3d', async (j) => {
        await download(j.model_urls.glb, join(MODELS, `${name}.glb`));
        if (j.thumbnail_url) await download(j.thumbnail_url, join(MODELS, `${name}_preview.png`));
      }],
      ['rig', 'rigging', async (j) => download(j.result.rigged_character_glb_url, join(MODELS, `${name}_rigged.glb`))],
      ['anim', 'animations', async (j) => download(j.result.animation_glb_url, join(MODELS, `${name}_anim.glb`))],
    ];
    for (const [key, path, save] of steps) {
      const task = s[key];
      if (!task || task.status === 'done' || task.status === 'failed') continue;
      const j = await meshy(`${path}/${task.id}`);
      if (j.status === DONE) {
        try {
          await save(j);
          task.status = 'done';
          if (j.consumed_credits !== undefined) task.credits = j.consumed_credits;
        } catch (e) {
          console.error(name, key, e.message);
          pending += 1;
        }
      } else if (FAILED.includes(j.status)) {
        task.status = 'failed';
        task.error = j.task_error?.message;
      } else pending += 1;
      console.log(name, key, j.status, j.progress ?? '', task.error ?? '');
    }
  }
  await writeState(state);
  return pending;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'concepts') {
  const names = args.length ? args : Object.keys(CHARACTERS);
  const variants = Number(process.env.VARIANTS ?? 2);
  await Promise.all(names.flatMap((n) => Array.from({ length: variants }, (_, i) => concept(n, i + 1 + Number(process.env.OFFSET ?? 0)).catch((e) => console.error('fail', n, e.message)))));
} else if (command === 'model') {
  await model(args[0], args[1]);
} else if (command === 'rig') {
  for (const n of args) await rig(n).catch((e) => console.error(n, e.message));
} else if (command === 'animate') {
  for (const n of args) await animate(n).catch((e) => console.error(n, e.message));
} else if (command === 'poll') {
  for (;;) {
    const pending = await poll();
    if (args[0] !== 'wait' || pending === 0) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
} else if (command === 'balance') {
  console.log(await meshy('balance'));
} else {
  console.log('usage: node scripts/characters.mjs concepts [names] | model <name> <file> | rig <names> | animate <names> | poll [wait] | balance');
}
