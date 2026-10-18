// The generals as parts, the way the 장수 screen dresses them: one body per general on a shared eight-and-a-half-head
// build, and per faction a set of armors and a weapon, each made the same way so any armor fits any body of its faction:
//   1. a T-pose front, side and back from the OpenAI Images API (the body from the general's casting photo; an armor by
//      dressing that body's own three views, so the armor is drawn on exactly the same build and pose);
//   2. Meshy multi-image-to-3D from the three views;
//   3. Meshy auto-rigging of the T-pose, then Meshy library motions on the body's rig (the armor follows that skeleton).
// Every file made gets a <file>.json beside it with its request, prompt and cost; a rerun skips what is there.
//
//   node scripts/generals-parts.mjs body --who=yi
//   node scripts/generals-parts.mjs armor --who=yi --armor=yi_tongjesa
//   node scripts/generals-parts.mjs weapon --weapon=hwando
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const [step, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const PKG = join(ROOT, 'assets-src', 'generals-parts-2026-10-17');
mkdirSync(PKG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const recordOf = (f) => (existsSync(`${f}.json`) ? JSON.parse(readFileSync(`${f}.json`, 'utf8')) : {});
const record = (f, r) => writeFileSync(`${f}.json`, JSON.stringify(r, null, 2) + '\n');

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

/** Each general's casting photo (his face) and who he is. */
const CAST = {
  yi: { face: 'assets-src/generals-hero-2026-10-17/yi_joseon_dujeong_cast_a.png', who: 'Yi Sun-sin, the Joseon admiral, in his late forties, a long oval face, high cheekbones, a thin moustache and a long narrow chin beard' },
};

const IMAGE = { model: 'gpt-image-2.5-sunburst', size: '2880x2880', quality: 'high', background: 'opaque', output_format: 'png' };

async function http(method, url, headers, body, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(5000 * (i + 1)); continue; }
      throw new Error(`${res.status} ${text.slice(0, 400)}`);
    } catch (e) {
      if (i < tries && /fetch failed|ECONNRESET|socket|network|timeout|terminated/i.test(`${e} ${e?.cause?.code ?? ''}`)) { await sleep(4000 * (i + 1)); continue; }
      throw e;
    }
  }
}

// References go up as high-quality WebP: multi-megabyte PNG uploads get their connection reset.
const ref = async (file) => new Blob([await sharp(file).webp({ quality: 94 }).toBuffer()], { type: 'image/webp' });

/** One picture from the Images API edits endpoint, the references in order; kept with its prompt and usage. */
async function edit(file, prompt, refs) {
  if (existsSync(file) && !args.redo) return;
  const form = new FormData();
  for (const [k, v] of Object.entries(IMAGE)) form.set(k, String(v));
  form.set('n', '1');
  form.set('prompt', prompt);
  for (const [i, r] of refs.entries()) form.append('image[]', await ref(r), `ref${i}.webp`);
  const j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form);
  writeFileSync(file, Buffer.from(j.data[0].b64_json, 'base64'));
  record(file, { at: new Date().toISOString(), image: IMAGE, prompt, refs: refs.map((r) => r.replace(ROOT, '').replaceAll('\\', '/')), usage: j.usage ?? null });
  log('made', file.slice(PKG.length + 1));
}

/** How every reference is shot, so the three views of every part line up with the body's. */
const STUDIO =
  'A character reference photograph for image-to-3D reconstruction and auto-rigging, live-action and photographic. Exactly one man in a strict T-pose: both arms straight out to the sides at shoulder height, ' +
  'perfectly level, both hands clenched into compact fists, legs straight, feet a little apart and flat, the spine straight, the neck vertical, the head level and stacked above the shoulders. ' +
  'Seen at chest height through a long telephoto lens with no perspective distortion; the whole figure inside the square frame with a clear margin all round, its height filling about nine tenths of the frame. ' +
  'Soft, even, flat studio light from every side, no hard shadows; a plain seamless very light grey background, no floor line, no cast shadow, nothing else in the picture. ' +
  'No text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look.';

/** The three views; the side and the back are drawn from the front (and, for an armor, from the body's own view). */
const VIEWS = {
  front: 'Seen straight from the front.',
  side:
    'Seen exactly from his left side in strict profile: he faces the right edge of the picture; his left arm points straight at the camera and is seen end-on, foreshortened to the fist in front of his shoulder, ' +
    'his right arm hidden behind his body; both arms still level at shoulder height, still straight out to his sides, NOT reaching forward.',
  back: 'Seen from directly behind; nothing of his face shows.',
};

const BUILD =
  'Heroic film-lead proportions, the same for every general: eight and a half heads tall, long legs with the crotch at half his height, broad square shoulders, a deep chest, a narrow waist, a strong neck; lean and powerful.';

async function body() {
  const who = args.who;
  const cast = CAST[who];
  const f = (v) => join(PKG, `body_${who}_${v}.png`);
  const brief = (v) =>
    `${STUDIO} ${VIEWS[v]} ${BUILD} He is ${cast.who}; the attached casting photograph is his face: keep it exactly. ` +
    'He wears only close-fitting plain white cotton underclothes (a thin long-sleeved undershirt and ankle-length under-trousers, snug to the body so its shape reads), plain white cotton socks, no shoes; ' +
    'his hair is drawn up into a small tight topknot held by a fine black horsehair headband (manggeon) close to the skull, nothing else on his head. No armour, no weapon, no belt, no jewellery.';
  await edit(f('front'), brief('front'), [join(ROOT, cast.face)]);
  await Promise.all(['side', 'back'].map((v, i) => sleep(i * 5000).then(() => edit(f(v), `${brief(v)} The first attached picture is his front view: the same man, build and underclothes exactly.`, [f('front'), join(ROOT, cast.face)]))));
}

async function armor() {
  const who = args.who;
  const id = args.armor;
  const b = (v) => join(PKG, `body_${who}_${v}.png`);
  const f = (v) => join(PKG, `armor_${id}_${v}.png`);
  const brief = (v) =>
    `${STUDIO} ${VIEWS[v]} The attached picture is this man in his underclothes, ${VIEWS[v].toLowerCase()} Dress exactly this man, in exactly this pose, scale and position in the frame, in the full armour below, ` +
    'with its helmet, boots and every piece, fitted to his body: the body underneath does not change size or shape. The armour hangs close to the body: coat skirts split and hanging straight, no cape, no loose ribbons, cords or tassels away from the body, the plume close behind the helmet. ' +
    `The armour: ${look(id)} No weapon, nothing held, no scabbard.`;
  await edit(f('front'), brief('front'), [b('front')]);
  await Promise.all(['side', 'back'].map((v, i) => sleep(i * 5000).then(() => edit(f(v), `${brief(v)} The second attached picture is the same armour from the front: match it exactly.`, [b(v), f('front')]))));
}

const meshy = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
const dataUri = async (f) => `data:image/webp;base64,${(await sharp(f).webp({ quality: 94 }).toBuffer()).toString('base64')}`;
async function poll(path, what) {
  for (let last = -1; ; ) {
    const t = await http('GET', `https://api.meshy.ai/openapi/v1/${path}`, meshy);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${what} ${t.status}: ${JSON.stringify(t.task_error ?? {})}`);
    if (t.progress !== last) log(what, `${t.progress}%`);
    last = t.progress;
    await sleep(12_000);
  }
}

/**
 * Meshy's model from the three views, remeshed by Meshy under the 300k faces its rigging takes; its rig; and for a body
 * the library motions on that rig: Idle 1, Sword Shout (the command), Right-hand Sword Slash.
 */
const MODEL = { ai_model: 'meshy-7.1', geometry_resolution: '2k', should_texture: true, enable_pbr: true, texture_resolution: '4k', should_remesh: true, topology: 'triangle', target_polycount: 280000, image_enhancement: false, remove_lighting: true, target_formats: ['glb'] };
const ACTIONS = [11, 101, 219];

async function task(out, endpoint, request, what) {
  const r = recordOf(out);
  if (!r.task) {
    const res = await http('POST', `https://api.meshy.ai/openapi/v1/${endpoint}`, meshy, JSON.stringify(request));
    Object.assign(r, { task: res.result, endpoint, at: new Date().toISOString(), request: { ...request, image_urls: request.image_urls && `${request.image_urls.length} views` } });
    record(out, r);
    log(what, 'task', r.task);
  }
  const t = await poll(`${endpoint}/${r.task}`, what);
  r.credits = t.consumed_credits ?? null;
  record(out, r);
  return { r, t };
}

async function build(name, animate) {
  const views = ['front', 'side', 'back'].map((v) => join(PKG, `${name}_${v}.png`));
  const model = join(PKG, `${name}_model.glb`);
  const { r: m } = await task(model, 'multi-image-to-3d', { ...MODEL, image_urls: await Promise.all(views.map(dataUri)) }, `${name} model`);
  const rig = join(PKG, `${name}_rig.glb`);
  const { r: g, t: rt } = await task(rig, 'rigging', { input_task_id: m.task, height_meters: 1.85 }, `${name} rig`);
  if (!existsSync(rig)) writeFileSync(rig, Buffer.from(await (await fetch(rt.result.rigged_character_glb_url)).arrayBuffer()));
  if (!animate) return log(name, 'rigged');
  const anim = join(PKG, `${name}_anim.glb`);
  const { t: at } = await task(anim, 'animations', { rig_task_id: g.task, action_ids: ACTIONS }, `${name} motions`);
  if (!existsSync(anim)) writeFileSync(anim, Buffer.from(await (await fetch(at.result.animation_glb_url)).arrayBuffer()));
  log(name, 'rigged and animated');
}

/** The weapon: one product photograph, then Meshy image-to-3D, small enough to hang on a hand bone. */
const WEAPONS = {
  hwando:
    'A Joseon Korean hwando sabre of the Imjin War, drawn, without its scabbard: a slim single-edged steel blade about 75 cm long with a gentle curve and a polished edge bevel, ' +
    'a round flat brass guard, a dark brown cord-wrapped grip about 18 cm long, a brass pommel cap.',
};

async function weapon() {
  const id = args.weapon;
  const img = join(PKG, `weapon_${id}.png`);
  if (!existsSync(img)) {
    const r = await http('POST', 'https://api.openai.com/v1/images/generations', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, JSON.stringify({
      ...IMAGE, size: '2880x1280', n: 1,
      prompt: `A product reference photograph for image-to-3D reconstruction: ${WEAPONS[id]} It lies perfectly horizontal across the frame, the point to the right, the edge down, seen exactly side-on, the whole sword inside the frame with a margin. ` +
        'Soft, even, flat studio light, a plain seamless very light grey background, no shadow, nothing else. Photographic and sharp, believable sixteenth-century materials. No text, no hands, no stand.',
    }));
    writeFileSync(img, Buffer.from(r.data[0].b64_json, 'base64'));
    record(img, { at: new Date().toISOString(), usage: r.usage ?? null });
  }
  const out = join(PKG, `weapon_${id}.glb`);
  const { t } = await task(out, 'image-to-3d', { ai_model: 'meshy-7.1', image_url: await dataUri(img), should_texture: true, enable_pbr: true, texture_resolution: '2k', should_remesh: true, topology: 'triangle', target_polycount: 12000, target_formats: ['glb'] }, `${id} model`);
  if (!existsSync(out)) writeFileSync(out, Buffer.from(await (await fetch(t.model_urls.glb)).arrayBuffer()));
  log(id, 'made');
}

/**
 * The parts as the 장수 screen loads them, public/models/generals/parts/<name>.glb and _lod1.glb:
 *   body_<general>  his head on the shared skeleton with the clips (Meshy's library motions, renamed idle, command and
 *                   slash): the rest of the body is always under an armor, where it would only poke through;
 *   armor_<id>      the armor with its helmet, its own face cut out so the wearer's head shows in it; the screen binds
 *                   it to the body's skeleton by joint name;
 *   weapon_<id>     the weapon, held in the right hand.
 * Faces and joints are found from the skin: a vertex belongs to the head when most of its weight is on the head joints.
 */
const HEAD = new Set(['Head', 'neck', 'head_end', 'headfront']);
const CLIP_NAMES = { Idle: 'idle', Sword_Shout: 'command', Right_Hand_Sword_Slash: 'slash' };

async function pack() {
  const { io, simplify, LODS } = await import('./lib/figure.mjs');
  const { dedup, meshopt, prune, quantize, textureCompress } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const { Matrix4, Vector3 } = await import('three');
  const name = args.name;
  const dir = join(ROOT, 'public', 'models', 'generals', 'parts');
  mkdirSync(dir, { recursive: true });
  const kind = name.split('_')[0];
  const src = kind === 'weapon' ? join(PKG, `${name}.glb`) : join(PKG, `${name}_rig.glb`);
  // Where each joint is in the bind pose, from the inverse bind matrices.
  const jointsAt = (doc) => {
    const skin = doc.getRoot().listSkins()[0];
    const ibm = skin.getInverseBindMatrices().getArray();
    return new Map(skin.listJoints().map((j, i) => [j.getName(), new Vector3().setFromMatrixPosition(new Matrix4().fromArray(ibm, i * 16).invert())]));
  };
  // Keeps the triangles whose three corners pass `keep`.
  const cut = (doc, keep) => {
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const pos = prim.getAttribute('POSITION');
    const joints = prim.getAttribute('JOINTS_0');
    const weights = prim.getAttribute('WEIGHTS_0');
    const names = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    const n = pos.getCount();
    const ok = new Uint8Array(n);
    const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let v = 0; v < n; v++) {
      joints.getElement(v, j);
      weights.getElement(v, w);
      const head = j.reduce((s, x, k) => s + (HEAD.has(names[x]) ? w[k] : 0), 0);
      ok[v] = keep(new Vector3(...pos.getElement(v, p)), head) ? 1 : 0;
    }
    const index = prim.getIndices().getArray();
    const kept = [];
    for (let t = 0; t < index.length; t += 3) if (ok[index[t]] && ok[index[t + 1]] && ok[index[t + 2]]) kept.push(index[t], index[t + 1], index[t + 2]);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(doc.getRoot().listBuffers()[0]));
    return kept.length / 3;
  };
  for (const lod of LODS) {
    const doc = await io.read(src);
    if (kind !== 'weapon') {
      for (const a of doc.getRoot().listAnimations()) a.dispose();
      const at = jointsAt(doc);
      const head = at.get('Head');
      // The bind pose stands in glTF's frame: up is +Y, he faces +Z, metres once the armature's scale is applied.
      const unit = head.y > 10 ? 0.01 : 1;
      const y = (v) => v.y * unit;
      const hy = head.y * unit;
      const hz = head.z * unit;
      if (kind === 'body') {
        // His face and beard only: the rest of his head is inside the helmet.
        cut(doc, (v, h) => h > 0.5 && v.z * unit > hz + 0.01 && y(v) > hy - 0.18 && y(v) < hy + 0.18);
        // The clips, from Meshy's animation file, onto the joints of the same names.
        const anim = await io.read(join(PKG, `${name}_anim.glb`));
        const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
        const buffer = doc.getRoot().listBuffers()[0];
        for (const a of anim.getRoot().listAnimations()) {
          const clip = Object.entries(CLIP_NAMES).find(([k]) => a.getName().startsWith(k))?.[1];
          if (!clip) continue;
          const copy = doc.createAnimation(clip);
          for (const c of a.listChannels()) {
            const target = byName.get(c.getTargetNode().getName());
            if (!target) continue;
            const s = c.getSampler();
            const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
            const sampler = doc.createAnimationSampler().setInput(acc(s.getInput())).setOutput(acc(s.getOutput())).setInterpolation(s.getInterpolation());
            copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(c.getTargetPath()).setSampler(sampler));
          }
        }
      } else {
        // The armor's own face and beard, below the helmet's brim: the wearer's face goes there.
        cut(doc, (v, h) => !(h > 0.5 && v.z * unit > hz + 0.03 && y(v) > hy - 0.16 && y(v) < hy + 0.16));
      }
    }
    const triangles = simplify(doc, lod.triangles * (kind === 'body' ? 0.25 : kind === 'weapon' ? 0.05 : 1), lod.error, lod.flags, lod.uv);
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: kind === 'armor' ? [lod.base, lod.base] : [lod.other, lod.other], quality: 90 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: kind === 'armor' ? [lod.other, lod.other] : [1024, 1024], quality: 90 }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = join(dir, `${name}${lod.suffix}.glb`);
    await io.write(out, doc);
    log(name, lod.suffix || 'lod0', Math.round(triangles), 'triangles', readFileSync(out).length, 'bytes');
  }
}

/**
 * Tripo: the model from the three views (front, his left, back), and for a body its rig and preset motions. Tripo's
 * v3.1 model at detailed geometry and texture; its v3.0 humanoid rig.
 */
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const tripoAuth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` };
async function tripoUpload(f) {
  const form = new FormData();
  form.set('file', new Blob([await sharp(f).jpeg({ quality: 95 }).toBuffer()], { type: 'image/jpeg' }), 'view.jpg');
  const j = await http('POST', `${TRIPO}/upload`, tripoAuth, form);
  return j.data.image_token ?? j.data.file_token;
}
async function tripoTask(out, body, what) {
  const r = recordOf(out);
  if (!r.task) {
    const j = await http('POST', `${TRIPO}/task`, { ...tripoAuth, 'Content-Type': 'application/json' }, JSON.stringify(body));
    if (j.code !== 0) throw new Error(`${what}: ${JSON.stringify(j)}`);
    Object.assign(r, { task: j.data.task_id, at: new Date().toISOString(), request: body });
    record(out, r);
    log(what, 'task', r.task);
  }
  for (let last = -1; ; ) {
    const j = await http('GET', `${TRIPO}/task/${r.task}`, tripoAuth);
    const d = j.data;
    if (d.status === 'success') {
      r.credits = d.consumed_credit ?? d.credits_consumed ?? null;
      record(out, r);
      const url = d.output.pbr_model ?? d.output.model ?? d.output.base_model;
      if (!existsSync(out)) writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
      return r;
    }
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d.status)) throw new Error(`${what} ${d.status}: ${JSON.stringify(d).slice(0, 300)}`);
    if (d.progress !== last) log(what, `${d.progress}%`);
    last = d.progress;
    await sleep(10_000);
  }
}

async function tripo() {
  const name = args.name;
  const views = ['front', 'side', 'back'].map((v) => join(PKG, `${name}_${v}.png`));
  const tokens = [];
  for (const v of views) tokens.push(await tripoUpload(v));
  const model = join(PKG, `${name}_tripo.glb`);
  const m = await tripoTask(model, {
    type: 'multiview_to_model', model_version: 'v3.1-20260211',
    files: [{ type: 'jpg', file_token: tokens[0] }, { type: 'jpg', file_token: tokens[1] }, { type: 'jpg', file_token: tokens[2] }, {}],
    texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', face_limit: 200000,
  }, `${name} model`);
  if (!name.startsWith('body_')) return log(name, 'made');
  const rig = join(PKG, `${name}_tripo_rig.glb`);
  const g = await tripoTask(rig, { type: 'animate_rig', original_model_task_id: m.task, out_format: 'glb', rig_type: 'biped', spec: 'tripo', ...(args.rig && { model_version: args.rig }) }, `${name} rig`);
  for (const preset of ['idle', 'slash']) {
    await tripoTask(join(PKG, `${name}_tripo_${preset}.glb`), { type: 'animate_retarget', original_model_task_id: g.task, out_format: 'glb', animation: `preset:biped:${preset}`, animate_in_place: true }, `${name} ${preset}`);
  }
  log(name, 'rigged and animated');
}

/**
 * The Tripo parts as the 장수 screen loads them, public/models/generals/parts/<name>.glb and _lod1.glb. Only the body is
 * rigged (by Tripo); an armor is Tripo's unrigged mesh put on that body's skeleton by taking the body's skin weights:
 * each armor vertex averages the weights of the body vertices nearest it, and the coat skirt, below the hips and away
 * from the legs, hangs from the hips so it does not split into trouser legs.
 *   body_<general>   his head and hands on the skeleton, with the clips (Tripo presets: idle, slash)
 *   armor_<id>       the armor alone (shell), for that body's skeleton
 */
const TRIPO_HEAD = new Set(['Head', 'NeckTwist01', 'NeckTwist02']);

async function packTripo() {
  // Yi's reviewed assets use the local Blender refit and coherent Meshy head.
  // Do not restore the rejected fist-span fit, Janus head or malformed preset idle on a rebuild.
  if ((args.who ?? 'yi') === 'yi' && ['body_yi', 'armor_joseon_dujeong', 'armor_yi_tongjesa'].includes(args.name)) {
    const body = args.name === 'body_yi';
    const script = body ? 'refit-general-head.mjs' : 'refit-general-parts.mjs';
    const flags = body ? [] : [`--only=${args.name.replace(/^armor_/, '')}`];
    execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...flags], { cwd: ROOT, stdio: 'inherit' });
    return;
  }
  const { io, simplify, LODS } = await import('./lib/figure.mjs');
  const { dedup, meshopt, prune, quantize, textureCompress, mergeDocuments } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const name = args.name;
  const who = args.who ?? 'yi';
  const dir = join(ROOT, 'public', 'models', 'generals', 'parts');
  mkdirSync(dir, { recursive: true });
  const kind = name.split('_')[0];
  const rigFile = join(PKG, `body_${who}_tripo_rig.glb`);
  const geometry = (doc) => doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const jointShare = (doc, prim, pattern) => {
    const names = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    const joints = prim.getAttribute('JOINTS_0');
    const weights = prim.getAttribute('WEIGHTS_0');
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    return (v) => {
      joints.getElement(v, j);
      weights.getElement(v, w);
      return j.reduce((s, x, k) => s + (pattern.test(names[x]) ? w[k] : 0), 0);
    };
  };
  const headShare = (doc, prim) => {
    const names = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    const joints = prim.getAttribute('JOINTS_0');
    const weights = prim.getAttribute('WEIGHTS_0');
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    return (v) => {
      joints.getElement(v, j);
      weights.getElement(v, w);
      return j.reduce((s, x, k) => s + (TRIPO_HEAD.has(names[x]) ? w[k] : 0), 0);
    };
  };
  const keepTriangles = (doc, prim, ok) => {
    const index = prim.getIndices().getArray();
    const kept = [];
    for (let t = 0; t < index.length; t += 3) if (ok(index[t]) && ok(index[t + 1]) && ok(index[t + 2])) kept.push(index[t], index[t + 1], index[t + 2]);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(doc.getRoot().listBuffers()[0]));
  };
  // The head joint in the bind pose; the figure stands up +Y and faces +X (Tripo's way), the face toward +X.
  const headAt = (doc) => {
    const skin = doc.getRoot().listSkins()[0];
    const i = skin.listJoints().findIndex((j) => j.getName() === 'Head');
    const m = skin.getInverseBindMatrices().getElement(i, new Array(16).fill(0));
    // The inverse of a rigid bind matrix: its position is -Rᵀt.
    const t = [m[12], m[13], m[14]];
    return [0, 1, 2].map((c) => -(m[c * 4] * t[0] + m[c * 4 + 1] * t[1] + m[c * 4 + 2] * t[2]));
  };
  for (const lod of LODS) {
    let doc;
    if (kind === 'body') {
      doc = await io.read(rigFile);
      const prim = geometry(doc);
      const pos = prim.getAttribute('POSITION');
      const share = headShare(doc, prim);
      const [hx, hy] = headAt(doc);
      const p = [0, 0, 0];
      // What shows from an armor: his head and his hands. The rest is inside it, where it would only poke through.
      const hands = jointShare(doc, prim, /^[LR]_Hand$/);
      keepTriangles(doc, prim, (v) => share(v) > 0.5 || hands(v) > 0.5);
      const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
      const buffer = doc.getRoot().listBuffers()[0];
      for (const clip of ['idle', 'slash']) {
        const anim = await io.read(join(PKG, `body_${who}_tripo_${clip}.glb`));
        for (const a of anim.getRoot().listAnimations()) {
          const copy = doc.createAnimation(clip);
          for (const c of a.listChannels()) {
            const target = byName.get(c.getTargetNode().getName());
            if (!target) continue;
            const s = c.getSampler();
            const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
            const sampler = doc.createAnimationSampler().setInput(acc(s.getInput())).setOutput(acc(s.getOutput())).setInterpolation(s.getInterpolation());
            copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(c.getTargetPath()).setSampler(sampler));
          }
        }
      }
    } else {
      doc = await io.read(join(PKG, `${name}_shell_tripo.glb`));
      const body = await io.read(rigFile);
      const bodyPrim = geometry(body);
      const bpos = bodyPrim.getAttribute('POSITION');
      const [bmin, bmax] = [bpos.getMin([]), bpos.getMax([])];
      const prim = geometry(doc);
      const pos = prim.getAttribute('POSITION');
      const [amin, amax] = [pos.getMin([]), pos.getMax([])];
      // Onto the body: centred on it, at its size measured fist to fist (the helmet and its plume
      // make the armor taller than the man in it, so its height is no measure).
      const k = (bmax[2] - bmin[2]) / (amax[2] - amin[2]);
      const arr = pos.getArray();
      // Up and down, the sleeves on his arms: in the T-pose both lie level, and the soles of boots are no measure of
      // where his feet are. The arms are what lies beyond 70% of the half span.
      const armHeight = (a, reach) => {
        let sum = 0, n = 0;
        for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i + 2]) > reach) { sum += a[i + 1]; n++; }
        return sum / n;
      };
      const lift = armHeight(bpos.getArray(), bmax[2] * 0.7) - armHeight(arr, amax[2] * 0.7) * k;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = (arr[i] - (amin[0] + amax[0]) / 2) * k + (bmin[0] + bmax[0]) / 2;
        arr[i + 1] = arr[i + 1] * k + lift;
        arr[i + 2] = (arr[i + 2] - (amin[2] + amax[2]) / 2) * k + (bmin[2] + bmax[2]) / 2;
      }
      pos.setArray(arr);
      // The body's vertices in 3 cm cells for the nearest-vertex search.
      const cell = 0.03;
      const grid = new Map();
      const bp = bpos.getArray();
      const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      for (let v = 0; v < bp.length / 3; v++) {
        const kk = key(bp[v * 3], bp[v * 3 + 1], bp[v * 3 + 2]);
        (grid.get(kk) ?? grid.set(kk, []).get(kk)).push(v);
      }
      const bj = bodyPrim.getAttribute('JOINTS_0');
      const bw = bodyPrim.getAttribute('WEIGHTS_0');
      const names = body.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
      const jointOf = new Map(names.map((n, i) => [n, i]));
      const hips = jointOf.get('Hip') ?? jointOf.get('Pelvis');
      const legOf = (n) => /^[LR]_(Thigh|Calf)/.test(n);
      const waist = (() => { const s = body.getRoot().listSkins()[0]; const i = names.indexOf('Hip'); const m = s.getInverseBindMatrices().getElement(i, new Array(16).fill(0)); return -(m[1] * m[12] + m[5] * m[13] + m[9] * m[14]); })();
      const n = pos.getCount();
      const J = new Uint16Array(n * 4);
      const Wt = new Float32Array(n * 4);
      const j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
      for (let v = 0; v < n; v++) {
        const x = arr[v * 3], y = arr[v * 3 + 1], z = arr[v * 3 + 2];
        const near = [];
        for (let r = 1; near.length < 8 && r <= 6; r++) {
          near.length = 0;
          const [cx, cy, cz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
          for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const u of grid.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
            const d = (bp[u * 3] - x) ** 2 + (bp[u * 3 + 1] - y) ** 2 + (bp[u * 3 + 2] - z) ** 2;
            near.push([d, u]);
          }
        }
        near.sort((p, q) => p[0] - q[0]);
        const sum = new Map();
        const take = near.slice(0, 8);
        let legs = 0;
        for (const [d, u] of take) {
          bj.getElement(u, j4);
          bw.getElement(u, w4);
          const f = 1 / (Math.sqrt(d) + 0.005);
          for (let c = 0; c < 4; c++) if (w4[c] > 0) {
            sum.set(j4[c], (sum.get(j4[c]) ?? 0) + w4[c] * f);
            if (legOf(names[j4[c]])) legs += w4[c] * f;
          }
        }
        // The skirt: below the waist and off the leg's surface, it hangs mostly from the hips.
        const off = take.length ? Math.sqrt(take[0][0]) : 0;
        if (y < waist && off > 0.025 && hips !== undefined) {
          const total = [...sum.values()].reduce((s, x) => s + x, 0);
          const keep = 0.35 * Math.max(0, 1 - (off - 0.025) / 0.1);
          for (const [jn, ww] of sum) if (legOf(names[jn])) sum.set(jn, ww * keep);
          sum.set(hips, (sum.get(hips) ?? 0) + legs * (1 - keep) + total * 0.0);
        }
        const top = [...sum].sort((p, q) => q[1] - p[1]).slice(0, 4);
        const t = top.reduce((s, [, ww]) => s + ww, 0) || 1;
        top.forEach(([jn, ww], c) => { J[v * 4 + c] = jn; Wt[v * 4 + c] = ww / t; });
      }
      // The body's skeleton comes into the armor's document; the armor mesh is skinned to it and the body mesh dropped.
      const armorNode = doc.getRoot().listNodes().find((x) => x.getMesh());
      const before = new Set(doc.getRoot().listNodes());
      mergeDocuments(doc, body);
      const added = doc.getRoot().listNodes().filter((x) => !before.has(x));
      const bodyNode = added.find((x) => x.getMesh());
      const skin = doc.getRoot().listSkins()[0];
      const buffer = doc.getRoot().listBuffers()[0];
      for (const x of doc.getRoot().listAccessors()) x.setBuffer(buffer);
      for (const b of doc.getRoot().listBuffers().slice(1)) b.dispose();
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt).setBuffer(buffer));
      bodyNode.getParentNode().addChild(armorNode);
      armorNode.setSkin(skin);
      const bodyMesh = bodyNode.getMesh();
      bodyNode.dispose();
      bodyMesh.dispose();
      const scenes = doc.getRoot().listScenes();
      const keep = scenes.find((s) => s.listChildren().some((c) => added.includes(c)));
      for (const s of scenes) if (s !== keep) s.dispose();
      doc.getRoot().setDefaultScene(keep);
      for (const a of doc.getRoot().listAnimations()) a.dispose();
    }
    const count = geometry(doc).getIndices().getCount() / 3;
    log(name, 'triangles before', count);
    const triangles = count > lod.triangles ? simplify(doc, lod.triangles, lod.error, lod.flags, lod.uv) : count;
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 90 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [lod.other, lod.other], quality: 90 }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = join(dir, `${name}${lod.suffix}.glb`);
    await io.write(out, doc);
    log(name, lod.suffix || 'lod0', Math.round(triangles), 'triangles', readFileSync(out).length, 'bytes');
  }
}

/**
 * The armor alone, as Tripo models it: its three views redrawn from the dressed ones with the man taken out, as if worn
 * by an invisible man, so the mesh is the armor and nothing of a person; the body's own head and hands show from it.
 */
async function shell() {
  const id = args.armor;
  const f = (v) => join(PKG, `armor_${id}_${v}.png`);
  const g = (v) => join(PKG, `armor_${id}_shell_${v}.png`);
  const brief = (v) =>
    `The attached picture is a full suit of armour worn in a strict T-pose, ${VIEWS[v].toLowerCase()} Redraw exactly the same armour, every piece, colour, rivet, trim and the helmet, in exactly the same pose, scale and position in the frame, ` +
    'but worn by an invisible man: there is no person at all. No head, no face, no beard, no hair, no neck, no hands, no skin anywhere: the helmet floats empty in its place with dark empty space under its brim and inside its neck curtain, ' +
    'the collar and the sleeve cuffs are open and empty and dark inside, the boots stand empty. The armour keeps the full shape of the body inside it, arms straight out level at the shoulders. ' +
    'Same soft, even, flat studio light and the same plain seamless very light grey background, no floor, no shadow. No text, no border. Photographic, no illustration look.';
  await Promise.all(['front', 'side', 'back'].map((v, i) => sleep(i * 5000).then(() => edit(g(v), brief(v), [f(v)]))));
}

const STEPS = { body, armor, shell, weapon, pack, packTripo, tripo, build: () => build(args.name, args.name.startsWith('body_')) };
if (!STEPS[step]) throw new Error(`step: ${Object.keys(STEPS).join(' | ')}`);
await STEPS[step]();
