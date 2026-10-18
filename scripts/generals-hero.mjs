// The generals as film-lead 3D figures for the 장수 screen, built a step at a time so every step can be looked at:
//   concept  a front and a back T-pose reference, 2880 px, from the OpenAI Images API, the general's portrait and the
//            armor's card as references, recast with a film hero's eight-and-a-half-head proportions;
//   model    Meshy image-to-3D from both views (multi-image, the front as the primary view);
// Every file made gets a <file>.json beside it with its request, prompt and cost; a rerun skips what is there and
// picks up a Meshy task that was still running.
//
//   node scripts/generals-hero.mjs <step> --job=yi_yi_tongjesa[,yi_joseon_dujeong] [--redo]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const [step, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const PKG = join(ROOT, 'assets-src', 'generals-hero-2026-10-17');
mkdirSync(PKG, { recursive: true });

// The armor briefs the armor art was painted from (scripts/generate-armor-art.mjs), read from that file.
const armorArt = readFileSync(join(ROOT, 'scripts', 'generate-armor-art.mjs'), 'utf8');
const block = (name) => {
  const start = armorArt.indexOf(`const ${name} = {`);
  let depth = 0;
  for (let i = armorArt.indexOf('{', start); i < armorArt.length; i++) {
    if (armorArt[i] === '{') depth++;
    else if (armorArt[i] === '}' && --depth === 0) return armorArt.slice(armorArt.indexOf('{', start), i + 1);
  }
  throw new Error(`no ${name} in generate-armor-art.mjs`);
};
const LOOK = new Function(`return ${block('LOOK')};`)();
const look = (id) => (typeof LOOK[id] === 'string' ? LOOK[id] : LOOK[id].armor.replace('%MASK%', LOOK[id].portrait ?? ''));

/** Who each general is, as the film's casting brief: his identity kept from his portrait, his looks a leading man's. */
const HERO = {
  yi:
    'He is Yi Sun-sin, the Joseon admiral, in his late forties. Keep who the attached portrait shows: a long oval Korean face with high cheekbones, ' +
    'a thin moustache and a long, narrow, well-kept chin beard falling to his collar. Recast him as the strikingly handsome, charismatic leading man of a big-budget ' +
    'historical war film: calm, noble and fearless, piercing dark eyes under strong level brows, a straight nose, a sharp clean jaw line, healthy sun-weathered skin with ' +
    'fine natural texture, the beard black with a few threads of grey. An original face, not any real actor.',
};

/** The chosen casting photo per general: one face for him in every armor. */
const FACE = { yi: 'yi_joseon_dujeong_cast_a.png' };

const IMAGE = { model: 'gpt-image-2.5-sunburst', size: '2880x2880', quality: 'high', background: 'opaque', output_format: 'png' };

const FRAME =
  'A full-body character reference photograph made for image-to-3D reconstruction and auto-rigging, in the look of a live-action costume fitting for a big-budget historical film. ' +
  'Exactly one man standing alone in a strict T-pose: both arms stretched straight out to the sides at shoulder height, perfectly level; both hands clenched into firm, compact fists, ' +
  'the backs of the hands up and the thumbs folded over the fingers; legs straight, feet a little apart and flat, toes forward; head level. ' +
  'Heroic film-lead proportions: tall, lean and powerful, eight and a half heads tall from the soles of his boots to the crown of his head (the helmet not counted), long legs with the crotch at half his height, ' +
  'broad square shoulders, a deep chest, a narrow belted waist, a strong neck. A movie-poster hero, never stocky or squat. ' +
  'Seen at the height of his chest through a long telephoto lens, so there is no perspective distortion. The whole figure fits inside the frame with a clear margin above the top of the helmet and its plume, ' +
  'below the soles of the boots and beyond both fists. Soft, even, flat studio light from every side, no hard shadows, no rim light, no dramatic highlights; ' +
  'a plain seamless very light grey background, no floor line, no cast shadow, nothing else in the picture. ' +
  'Crisp, sharply focused detail everywhere: every plate, rivet, lacing cord, buckle and seam clearly separated, in believable late-sixteenth-century materials (rubbed iron, worn lacquer, silk, leather, brass). ';

const RULES =
  'His fists are empty: no weapon, no sword, nothing held, no scabbard. No cape or cloak, no long ribbons, cords or tassels hanging away from the body; the plume falls close behind the helmet. ' +
  'The coat skirts hang straight and close to the legs, split at the front and the sides, ending at mid-shin so the tall boots show. ' +
  'No text, no letters, no logo, no border, no emblem, crest or mon unless named above. No rising sun flag, no sunburst or radiating rays, no red sun disc. ' +
  'No painting or illustration look, no cartoon, no plastic CGI look, no modern items.';

const frontPrompt = (job) =>
  FRAME +
  'He faces the camera straight on and looks straight into the lens. ' +
  'The first attached picture is his portrait: ' + HERO[job.general] + ' ' +
  `The armour he wears, with its helmet: ${look(job.armor)} The second attached picture shows this armour on its stand: match its colours, its rivet pattern, its collar and its helmet. ` +
  RULES;

const backPrompt = () =>
  'The attached picture is the front view of a character reference for image-to-3D reconstruction. Make the matching back view: the exact same man in the exact same costume, ' +
  'seen from directly behind, in the same strict T-pose with the arms level and the fists clenched, at exactly the same scale, height and position in the frame, ' +
  'with the same soft flat studio light and the same plain very light grey background. Show the back of the helmet and its neck curtain, the plume falling close behind the helmet, ' +
  'the back of the coat with the same rivet pattern continuing around, the back of the belt, the coat skirts split at the back, the backs of the boots, and the backs of his fists. ' +
  'Nothing of his face is visible. Everything that was on the front view is consistent: colours, materials, trims, lengths and proportions. ' +
  'No text, no letters, no logo, no border, no weapon, nothing held, no cape. No painting or illustration look, no plastic CGI look.';

/** The record beside a file: what made it. */
const recordOf = (f) => (existsSync(`${f}.json`) ? JSON.parse(readFileSync(`${f}.json`, 'utf8')) : {});
const record = (f, r) => writeFileSync(`${f}.json`, JSON.stringify(r, null, 2) + '\n');
const jobs = (args.job ?? 'yi_yi_tongjesa').split(',').map((key) => {
  const general = key.split('_')[0];
  return { key, general, armor: key.slice(general.length + 1) };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (job, ...m) => console.log(new Date().toISOString().slice(11, 19), job.key.padEnd(24), ...m);

async function http(method, url, headers, body, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(5000 * (i + 1)); continue; }
      throw new Error(`${res.status} ${text.slice(0, 400)}`);
    } catch (e) {
      if (i === 0) console.error("http error:", e?.cause?.code ?? e?.cause?.message ?? e?.message);
      if (i < tries && /fetch failed|ECONNRESET|socket|network|timeout|terminated/i.test(`${e} ${e?.cause ?? ''}`)) { await sleep(4000 * (i + 1)); continue; }
      throw e;
    }
  }
}

const png = async (file) => new Blob([await sharp(file).png().toBuffer()], { type: 'image/png' });

/** One picture from the Images API edits endpoint, the references in order; kept with its prompt and usage. */
async function edit(file, prompt, refs, options = {}) {
  const image = { ...IMAGE, ...options };
  const form = new FormData();
  for (const [k, v] of Object.entries(image)) form.set(k, String(v));
  form.set('n', '1');
  form.set('prompt', prompt);
  for (const [i, ref] of refs.entries()) form.append('image[]', await png(ref), `ref${i}.png`);
  const j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form);
  writeFileSync(file, Buffer.from(j.data[0].b64_json, 'base64'));
  record(file, { at: new Date().toISOString(), image, prompt, refs: refs.map((r) => r.slice(ROOT.length).replaceAll('\\', '/')), usage: j.usage ?? null });
}

const file = (job, what) => join(PKG, `${job.key}_${what}`);

/** The casting: his face as the film's star, the reference the T-pose takes his face from. */
const castPrompt = (job) =>
  'A new casting photograph of the man in the first attached picture, for the lead role of a big-budget historical war film; the picture that goes on the film poster. ' +
  HERO[job.general] + ' ' +
  'Head and shoulders, straight on, looking into the lens with a calm, fierce, magnetic gaze; catchlights in the eyes. He is the film\'s star: a face people remember, ' +
  'well groomed, clean healthy skin with fine natural texture (no grime, no scars, no sunburn, no deep wrinkles), the beard neat and full. ' +
  `He wears the helmet and collar of this armour, matching the second attached picture: ${look(job.armor)} ` +
  'Soft, even, frontal studio light with gentle modelling, no harsh shadows; a plain light grey background. Photographic, sharp, 85 mm lens. ' +
  'No text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look.';

async function cast(job) {
  const variant = args.variant ? `_${args.variant}` : '';
  const out = file(job, `cast${variant}.png`);
  if (existsSync(out) && !args.redo) return log(job, 'cast there');
  log(job, 'cast…');
  const refs = [join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src', `${job.general}.webp`), join(ROOT, 'public', 'ui', 'armor', `${job.armor}.webp`)];
  await edit(out, castPrompt(job), refs, { size: '2048x2048' });
  log(job, 'cast ready');
}

async function concept(job) {
  const front = file(job, 'front.png');
  const back = file(job, 'back.png');
  const variant = args.variant ? `_${args.variant}` : '';
  const frontOut = variant ? file(job, `front${variant}.png`) : front;
  if (!existsSync(frontOut) || args.redo) {
    log(job, 'front…');
    const refs = [FACE[job.general] ? join(PKG, FACE[job.general]) : join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src', `${job.general}.webp`), join(ROOT, 'public', 'ui', 'armor', `${job.armor}.webp`)];
    await edit(frontOut, frontPrompt(job), refs);
    log(job, 'front ready');
  }
  if (variant || args.front) return;
  if (!existsSync(back) || args.redo) {
    log(job, 'back…');
    await edit(back, backPrompt(job), [front]);
    log(job, 'back ready');
  }
}

const meshy = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
const dataUri = async (f) => `data:image/png;base64,${(await sharp(f).png().toBuffer()).toString('base64')}`;
async function poll(path, job, what) {
  for (let last = -1; ; ) {
    const t = await http('GET', `https://api.meshy.ai/openapi/v1/${path}`, meshy);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${what} ${t.status}: ${JSON.stringify(t.task_error ?? {})}`);
    if (t.progress !== last) log(job, what, `${t.progress}%`);
    last = t.progress;
    await sleep(15_000);
  }
}

/**
 * The raw model at Meshy's best: Ultra geometry, 8k PBR textures, no remesh (the finish decimates it, steered by its
 * UVs), the T-pose kept. The input picture is used as it is: Meshy's own enhancement repaints the face.
 */
const MESHY = { ai_model: 'meshy-7.1', should_texture: true, enable_pbr: true, texture_resolution: '8k', should_remesh: false, image_enhancement: false, remove_lighting: true, target_formats: ['glb'] };

async function model(job) {
  const variant = args.variant ?? 'main';
  const out = file(job, `raw_${variant}.glb`);
  if (existsSync(out) && !args.redo) return log(job, 'raw model there');
  const m = recordOf(out);
  if (!m.task || args.redo) {
    const front = file(job, variant === 'main' ? 'front.png' : `front_${variant}.png`);
    const others = ['side', 'back'].map((w) => file(job, variant === 'main' ? `${w}.png` : `${w}_${variant}.png`)).filter(existsSync);
    const multi = args.views !== 'front' && others.length > 0;
    const request = multi
      ? { ...MESHY, geometry_resolution: '2k', image_urls: [await dataUri(front), ...(await Promise.all(others.map(dataUri)))] }
      : { ...MESHY, geometry_resolution: '4k', image_url: await dataUri(front) };
    const r = await http('POST', `https://api.meshy.ai/openapi/v1/${multi ? 'multi-image-to-3d' : 'image-to-3d'}`, meshy, JSON.stringify(request));
    Object.assign(m, { task: r.result, endpoint: multi ? 'multi-image-to-3d' : 'image-to-3d', at: new Date().toISOString(), inputs: ['front', ...others.map((f) => f.slice(PKG.length + 1))], request: { ...request, image_url: undefined, image_urls: undefined } });
    record(out, m);
    log(job, 'model task', m.task, m.endpoint);
  }
  const t = await poll(`${m.endpoint}/${m.task}`, job, 'model');
  m.credits = t.consumed_credits ?? null;
  record(out, m);
  const res = await fetch(t.model_urls.glb);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  log(job, 'raw model saved', out);
}

/**
 * Meshy auto-rigging of the prepared model (scripts/lib/hero-prep.py cut it to 280k triangles and 4k textures), so the
 * skeleton has the joints the shared motions were made on; then the usual finish (scripts/lib/figure.mjs).
 */
async function rig(job) {
  const prep = file(job, 'prep.glb');
  const out = file(job, 'rig.glb');
  if (!existsSync(out) || args.redo) {
    const r = recordOf(out);
    if (!r.task || args.redo) {
      const model = `data:model/gltf-binary;base64,${readFileSync(prep).toString('base64')}`;
      const res = await http('POST', 'https://api.meshy.ai/openapi/v1/rigging', meshy, JSON.stringify({ model_url: model, height_meters: 1.85 }));
      Object.assign(r, { task: res.result, at: new Date().toISOString() });
      record(out, r);
      log(job, 'rig task', r.task);
    }
    const t = await poll(`rigging/${r.task}`, job, 'rig');
    r.credits = t.consumed_credits ?? null;
    record(out, r);
    writeFileSync(out, Buffer.from(await (await fetch(t.result.rigged_character_glb_url)).arrayBuffer()));
    log(job, 'rig ready');
  }
  // Meshy's library motions on this rig, used as they come: idle, Sword Shout (the command) and the right-hand slash.
  const anim = file(job, 'anim.glb');
  if (!existsSync(anim)) {
    const r = recordOf(out);
    const res = await http('POST', 'https://api.meshy.ai/openapi/v1/animations', meshy, JSON.stringify({ rig_task_id: r.task, action_ids: ACTIONS }));
    const t = await poll(`animations/${res.result}`, job, 'motions');
    writeFileSync(anim, Buffer.from(await (await fetch(t.result.animation_glb_url)).arrayBuffer()));
    record(anim, { task: res.result, rig_task: r.task, action_ids: ACTIONS, credits: t.consumed_credits ?? null });
  }
  await web(job, anim);
}

/** Meshy animation library ids: Idle 1, Sword Shout, Right-hand Sword Slash. */
const ACTIONS = [11, 101, 219];

/**
 * A figure as the web loads it, public/models/generals/<key>.glb and _lod1.glb: the body cut to each level's triangle
 * budget along its UVs, textures sized to the level, meshopt-compressed.
 */
async function web(job, src) {
  const { io, simplify, LODS } = await import('./lib/figure.mjs');
  const { dedup, meshopt, prune, quantize, resample, textureCompress } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const dir = join(ROOT, 'public', 'models', 'generals');
  const levels = {};
  for (const lod of LODS) {
    const doc = await io.read(src);
    const meshes = doc.getRoot().listMeshes();
    const body = meshes.reduce((a, m) => (m.listPrimitives()[0].getAttribute('POSITION').getCount() > a.listPrimitives()[0].getAttribute('POSITION').getCount() ? m : a));
    dropCrumbs(doc, body);
    const triangles = simplify(doc, lod.triangles, lod.error, lod.flags, lod.uv, body);
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }),
      resample(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 90 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [lod.other, lod.other], quality: 90 }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = join(dir, `${job.key}${lod.suffix}.glb`);
    await io.write(out, doc);
    levels[lod.suffix || '_lod0'] = { triangles: Math.round(triangles), bytes: readFileSync(out).length };
  }
  const { readdirSync } = await import('node:fs');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(readdirSync(dir).filter((f) => f.endsWith('.glb') && !f.endsWith('_lod1.glb')).map((f) => f.slice(0, -4)).sort()) + '\n');
  log(job, 'DONE', JSON.stringify(levels));
}

/**
 * The film-poster stance the figure is modelled in, unrigged: a skinned long coat deforms badly, a statue does not.
 * Made from the T-pose front so the face, armor and proportions carry over.
 */
const posePrompt = () =>
  'The attached picture is a full-body costume reference of this man. Make the same man, same face, same armour and helmet, same heroic tall proportions, ' +
  'now standing in the commanding pose of a historical war film poster: standing tall, perfectly upright and still like a soldier at attention, feet a shoulder width apart, ' +
  'the spine straight, the shoulders drawn back and down, the chest out, the neck long and vertical with the head stacked straight above the shoulders (never pushed forward, no stoop, no hunch), chin level, ' +
  'looking straight ahead into the lens with calm, fierce resolve; ' +
  'a Joseon hwando sabre in its black lacquered scabbard stands point-down on the ground in front of him, upright on his centre line, and both his hands rest one over the other on top of its hilt, elbows slightly out. ' +
  'The sword is slender, slightly curved, with a round brass guard and a dark cord-wrapped grip, its scabbard tip touching the ground between his boots. ' +
  'Seen straight from the front at chest height through a long telephoto lens, no perspective distortion; the whole figure in the frame with a clear margin above the plume and below the boots. ' +
  'Soft, even, flat studio light from every side, no hard shadows, no rim light; a plain seamless very light grey background, no floor line, no cast shadow, nothing else in the picture. ' +
  'Crisp, sharply focused detail everywhere. The coat skirts hang straight and still. No cape, no flying ribbons. No text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look.';

/** The other views of the stance for multi-image reconstruction: what one front picture leaves the depth to guess. */
const VIEW = {
  side:
    'seen exactly from his left side in strict profile, at the same height and scale and position in the frame. The profile shows a perfectly upright man: the neck vertical, the ear above the shoulder, ' +
    'the head stacked over the spine with no forward lean, the back straight and flat with no hump, the chest out; the beard hangs straight DOWN along the front of the throat and chest, it never juts forward; ' +
    'his arms and fists exactly as in the front view.',
  back:
    'seen from directly behind, at the same height and scale and position in the frame: the back of the helmet, its neck curtain and plume, the straight flat back of the coat with its rivet pattern, ' +
    'the belt, the coat skirts and the boots; the elbows show at his sides; nothing of his face.',
};
const viewPrompt = (which) =>
  'The attached picture is the front view of a character reference for image-to-3D reconstruction. Make the matching view of the exact same man in the exact same costume and the exact same pose, ' +
  VIEW[which] + ' Same soft, even, flat studio light and the same plain seamless very light grey background, no floor line, no shadow. ' +
  'Everything consistent with the front view: colours, materials, trims, lengths, proportions. No text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look.';

async function views(job) {
  const v = args.variant ?? 'pose';
  await Promise.all((args.only ?? 'side,back').split(',').map(async (which, i) => {
    const out = file(job, `${which}_${v}.png`);
    if (existsSync(out) && !args.redo) return;
    await sleep(i * 4000);
    await edit(out, viewPrompt(which), [file(job, `front_${v}.png`)], { size: args.size ?? '2048x2880' });
    log(job, which, 'ready');
  }));
}

async function pose(job) {
  const out = file(job, `pose${args.variant ? `_${args.variant}` : ''}.png`);
  if (existsSync(out) && !args.redo) return log(job, 'pose there');
  log(job, 'pose…');
  await edit(out, posePrompt(job), [file(job, 'front.png'), join(PKG, FACE[job.general])], { size: '2048x2880' });
  log(job, 'pose ready');
}

/**
 * Removes the loose crumbs image-to-3D leaves on the ground beside the boots: pieces of the mesh not joined to the rest,
 * small, and down at the feet. The eyes and the plume are up high.
 */
function dropCrumbs(doc, mesh = doc.getRoot().listMeshes()[0]) {
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const index = prim.getIndices().getArray();
  const n = pos.getCount();
  // Vertices at the same place are one (UV seams split them), then triangles join their corners.
  const key = new Map();
  const same = new Int32Array(n);
  const p = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    pos.getElement(v, p);
    const k = p.map((c) => Math.round(c * 1e5)).join(',');
    if (!key.has(k)) key.set(k, v);
    same[v] = key.get(k);
  }
  const up = Int32Array.from({ length: n }, (_, i) => i);
  const root = (v) => { while (up[v] !== v) v = up[v] = up[up[v]]; return v; };
  const join = (a, b) => { a = root(a); b = root(b); if (a !== b) up[a] = b; };
  for (let t = 0; t < index.length; t += 3) { join(same[index[t]], same[index[t + 1]]); join(same[index[t]], same[index[t + 2]]); }
  const [lo, hi] = [pos.getMin([]), pos.getMax([])];
  const feet = lo[1] + (hi[1] - lo[1]) * 0.15;
  const pieces = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const r = root(same[index[t]]);
    const c = pieces.get(r) ?? { tris: 0, top: -Infinity };
    c.tris++;
    c.top = Math.max(c.top, pos.getElement(index[t], p)[1]);
    pieces.set(r, c);
  }
  const total = index.length / 3;
  const drop = new Set([...pieces].filter(([, c]) => c.tris < total * 0.01 && c.top < feet).map(([r]) => r));
  if (!drop.size) return;
  const kept = [];
  for (let t = 0; t < index.length; t += 3) if (!drop.has(root(same[index[t]]))) kept.push(index[t], index[t + 1], index[t + 2]);
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(doc.getRoot().listBuffers()[0]));
}

const STEPS = { cast, concept, pose, views, model, rig };
if (!STEPS[step]) throw new Error(`step: ${Object.keys(STEPS).join(' | ')}`);
await Promise.all(jobs.map((j) => STEPS[step](j).catch((e) => log(j, 'FAILED', String(e).slice(0, 400)))));
