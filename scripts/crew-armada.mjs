// Crews of the Armada navies (England and Spain, 1588), made to fit the rigs and clips of the shipped crews:
// gpt-image draws each man in the exact bind pose of the shipped figure whose clips his role uses (a render of that
// figure is the pose reference), Tripo turns the picture into a textured mesh, and the mesh takes the skeleton, skin
// weights, hand weapons and baked clips of that figure (weights carried over from the nearest points of its bind pose).
// Meshy (the original crews' rigger) is reserved for commanders, so nothing is rigged again: the clips are the same.
//   node scripts/crew-armada.mjs concept [names]   picture per character (assets-src/crew-armada-2026-10-17/<name>/concept.png)
//   node scripts/crew-armada.mjs model [names]     Tripo image to model (raw.glb)
//   node scripts/crew-armada.mjs bake [names]      skin transfer and levels of detail into public/models/crew/<name>.bin/.webp
//   node scripts/crew-armada.mjs review [names]    front/side renders of the baked figure (review_*.png)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadTexture, readCrew, renderLod, writeCrew } from './lib/crew-file.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
// CREW_SET=lepanto (or trafalgar) makes another chapter's crews the same way, into its own source folder.
const SET = process.env.CREW_SET ?? 'armada';
const DIR = join(ROOT, 'assets-src', `crew-${SET}-2026-10-17`);
const OUT = join(ROOT, 'public', 'models', 'crew');
const PROV = join(DIR, 'provenance.json');

const ARMADA_POSE =
  'A full-body costume reference photograph of one man for image-to-3D reconstruction, in the look of a live-action costume fitting for a cinematic historical war film about the Spanish Armada of 1588. ' +
  'The attached grey figure is the exact pose, proportions and framing to match: he stands straight facing the camera in the same T-pose, both arms stretched out sideways a little below shoulder height with open empty hands, legs straight and slightly apart, ' +
  'the same size and position in the frame, the whole figure from hat to feet visible. Front orthographic look, soft even flat studio light, no shadows, plain seamless light grey background. ' +
  'Weathered, salt-stained, believable late-sixteenth-century materials, muted film colours, crisp detail. Nothing in the hands, no weapons, no sword or scabbard, no cape, no text, no logo, no border. Exactly two arms, two legs.';

/** Each character: the shipped figure whose rig, clips and hand weapons he takes, and his costume. */
const ARMADA = {
  england_shot: {
    base: 'japan_ashigaru',
    look: 'An English Elizabethan caliver-man (musketeer) of 1588 aboard a royal galleon: a plain steel morion helmet with a tall comb and a curved brim, a buff leather jerkin over a russet wool doublet, a leather bandolier of small wooden powder charges across the chest, full grey-brown venetian breeches to the knee, wool stockings and low leather shoes. Short brown beard.',
  },
  england_soldier: {
    base: 'joseon_marine',
    look: 'An English Elizabethan soldier of 1588 who fights boarders on deck: a polished steel combed morion helmet, a steel breastplate and short tassets over a faded red wool doublet with a St George red cross badge on white at the shoulder, dark padded trunk hose, wool stockings, leather shoes. Reddish beard.',
  },
  england_officer: {
    base: 'ming_officer',
    look: 'An English Elizabethan sea captain of 1588 like Drake or Hawkins: a black velvet doublet with gold buttons and a small white lace ruff, a gilded steel gorget, a short black cloak-less jerkin, puffed paned black and gold trunk hose, high dark leather boots, a black tall-crowned hat with a short white feather. Pointed grey-brown beard.',
  },
  england_sailor: {
    base: 'rower',
    look: 'An English Tudor sailor and gunner of 1588: a knitted brown wool Monmouth cap, a loose off-white linen shirt with sleeves rolled to the elbow, a sleeveless brown canvas waistcoat, wide knee-length canvas slops (sailor breeches) of grey-blue, bare shins and simple leather shoes. Stubble.',
  },
  spain_shot: {
    base: 'japan_ashigaru',
    look: 'A Spanish tercio arquebusier of 1588 aboard an Armada galleon: a blackened steel morion helmet with a tall comb and upturned brim, an ochre-yellow slashed doublet, a red silk sash tied across the body (the Spanish field sign), a leather bandolier of wooden powder charges, dark brown full breeches to the knee, wool stockings, leather shoes. Black moustache and short beard.',
  },
  spain_soldier: {
    base: 'joseon_marine',
    look: 'A veteran Spanish tercio soldier of 1588 who fights at the rail: a steel combed morion helmet, a steel breastplate with tassets over a dark green doublet, a broad red sash across the breastplate, black slashed trunk hose, wool stockings, leather shoes. Black beard.',
  },
  spain_officer: {
    base: 'ming_officer',
    look: 'A Spanish Armada captain of 1588, a noble: a black doublet with a white lace ruff, an ornate etched and gilded steel half armour breastplate, a crimson sash across it, black and gold puffed trunk hose, high black boots, a steel morion with a red plume. Pointed black beard and moustache.',
  },
  spain_sailor: {
    base: 'rower',
    look: 'A Spanish sailor and gunner of the Armada of 1588: a red wool stocking cap, a loose off-white linen shirt with rolled sleeves, a short brown leather jerkin open at the front, wide knee-length faded blue canvas breeches, bare shins and rope-soled shoes. Dark stubble.',
  },
};

const LEPANTO_POSE = ARMADA_POSE.replace('the Spanish Armada of 1588', 'the battle of Lepanto of 1571').replace('late-sixteenth-century', 'mid-sixteenth-century Mediterranean');
/** The Lepanto crews (sources: Capponi 2006; Konstam, Lepanto 1571, Osprey 2003, plates of Spanish, Venetian and Ottoman troops; Nicolle, Armies of the Ottoman Empire 1300-1774, Osprey 1983). */
const LEPANTO = {
  holyleague_shot: {
    base: 'japan_ashigaru',
    look: 'A Spanish tercio arquebusier of 1571 serving aboard a Holy League galley: a plain steel morion helmet with a comb, a faded red wool doublet, a leather bandolier of wooden powder charges across the chest, full brown breeches to the knee, wool stockings, leather shoes. Black moustache and short beard.',
  },
  holyleague_soldier: {
    base: 'joseon_marine',
    look: 'A Venetian infantryman (fante da mar) of 1571 on a war galley: an open steel burgonet helmet, a steel breastplate over a faded blue-grey wool doublet, a crimson sash, dark trunk hose, wool stockings, leather shoes. Brown beard.',
  },
  holyleague_officer: {
    base: 'ming_officer',
    look: 'A Venetian galley captain (sopracomito) of 1571, a patrician: an etched steel cuirass over a dark crimson velvet doublet, a small white ruff, a short crimson cloak-less coat with fur trim at the collar, black trunk hose, dark boots, bareheaded with short grey hair. Grey beard.',
  },
  holyleague_oarsman: {
    base: 'rower',
    look: 'A Mediterranean galley oarsman (galeotto, a convict rower) of 1571: shaved head with a short beard stubble, bare chest and arms, sun-browned skin, coarse undyed linen knee breeches, an iron ankle ring, barefoot.',
  },
  ottoman_archer: {
    base: 'joseon_soldier',
    look: 'An Ottoman azap marine archer of 1571 aboard a kadirga galley: a red felt conical cap wrapped with a white turban cloth, a long belted dark red wool kaftan to the knee with sleeves, a leather quiver belt, loose blue-grey trousers, soft red leather boots. Black moustache.',
  },
  ottoman_janissary: {
    base: 'japan_samurai',
    look: 'An Ottoman janissary of 1571: the tall white felt börk cap falling behind the head with a brass spoon-holder at the front, a long dark blue wool dolama coat tucked into a red sash, loose white trousers, red leather boots. Long moustache, shaven chin.',
  },
  ottoman_officer: {
    base: 'ming_officer',
    look: 'An Ottoman galley captain (reis) of 1571: a large white turban, a long green brocade kaftan over a mail shirt, a broad red sash, loose dark trousers, yellow leather boots. Full dark beard.',
  },
  ottoman_oarsman: {
    base: 'rower',
    look: 'A galley slave oarsman of an Ottoman galley in 1571, a Christian captive: shaved head, a thin beard, bare chest and arms, coarse undyed linen breeches to the knee, an iron ankle ring, barefoot.',
  },
};
const SETS = { armada: { pose: ARMADA_POSE, characters: ARMADA }, lepanto: { pose: LEPANTO_POSE, characters: LEPANTO } };
const POSE = SETS[SET].pose;
/** Each character: the shipped figure whose rig, clips and hand weapons he takes, and his costume. */
export const CHARACTERS = SETS[SET].characters;
/** Command flag cloth by navy: St George's white for England, Burgundy saltire red for Spain. */
// The officer's command flag: England white, Spain red, the Holy League blue (its standard), the Ottomans green (the Kapudan Pasha's).
const FLAG = { england: [0.78, 0.76, 0.7], spain: [0.62, 0.16, 0.12], holyleague: [0.2, 0.3, 0.55], ottoman: [0.18, 0.4, 0.22] };
const FLAG_ID = 7;

const args = process.argv.slice(2);
const stage = args[0];
const names = args.slice(1).length ? args.slice(1) : Object.keys(CHARACTERS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (name, k, v) => {
  // Read again each time: several stages may run at once.
  const prov = existsSync(PROV) ? JSON.parse(readFileSync(PROV, 'utf8')) : { date: '2026-10-17', pipeline: `CREW_SET=${SET} scripts/crew-armada.mjs`, characters: {} };
  prov.characters[name] = { ...(prov.characters[name] ?? {}), base: CHARACTERS[name].base, [k]: v };
  writeFileSync(PROV, JSON.stringify(prov, null, 2) + '\n');
};

async function http(method, url, headers, body) {
  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(5000 * (i + 1)); continue; }
      const e = new Error(`${res.status} ${text.slice(0, 400)}`); e.status = res.status; throw e;
    } catch (e) {
      if (!e.status && i < 5) { await sleep(4000 * (i + 1)); continue; }
      throw e;
    }
  }
}

const sourceOf = (base) => readCrew(readFileSync(join(OUT, `${base}.bin`)));

async function concept(name) {
  const c = CHARACTERS[name];
  const d = join(DIR, name);
  mkdirSync(d, { recursive: true });
  const ref = join(d, 'pose-ref.png');
  writeFileSync(ref, await renderLod(sourceOf(c.base).lods[0], null, { view: 'front', size: 1024 }));
  const prompt = `${POSE} ${c.look}`;
  for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1']) {
    const form = new FormData();
    form.set('model', model);
    form.set('size', '1024x1024');
    form.set('quality', 'high');
    form.set('n', '1');
    form.set('prompt', prompt);
    form.append('image[]', new Blob([readFileSync(ref)], { type: 'image/png' }), 'pose.png');
    try {
      const j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form);
      writeFileSync(join(d, 'concept.png'), Buffer.from(j.data[0].b64_json, 'base64'));
      // gpt-image-2 list prices, USD per million tokens: text in 5, image in 8, image out 30 (2.5 previews unpriced: estimate).
      const u = j.usage ?? {};
      const usd = ((u.input_tokens_details?.text_tokens ?? 0) * 5 + (u.input_tokens_details?.image_tokens ?? 0) * 8 + (u.output_tokens ?? 0) * 30) / 1e6;
      record(name, 'concept', { tool: 'openai images/edits', model, prompt, poseReference: `render of ${c.base} bind pose`, usage: u, estimatedUsd: Number(usd.toFixed(3)) });
      console.log(name, 'concept', model, usd.toFixed(3));
      return;
    } catch (e) {
      if (!(e.status === 400 || e.status === 404)) throw e;
      console.log(name, model, 'refused', String(e).slice(0, 160));
    }
  }
}

const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const tripoAuth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` };
async function model(name) {
  const d = join(DIR, name);
  const form = new FormData();
  form.set('file', new Blob([await sharp(join(d, 'concept.png')).png().toBuffer()], { type: 'image/png' }), 'concept.png');
  const up = await http('POST', `${TRIPO}/upload`, tripoAuth, form);
  const token = up.data.image_token ?? up.data.file_token;
  const body = { type: 'image_to_model', model_version: 'v2.5-20250123', file: { type: 'png', file_token: token }, texture: true, pbr: false, texture_quality: 'standard', face_limit: 12000, orientation: 'default' };
  const t = await http('POST', `${TRIPO}/task`, { ...tripoAuth, 'Content-Type': 'application/json' }, JSON.stringify(body));
  const task = t.data.task_id;
  console.log(name, 'tripo task', task);
  for (;;) {
    const s = (await http('GET', `${TRIPO}/task/${task}`, tripoAuth)).data;
    if (s.status === 'success') {
      const url = s.output.model ?? s.output.pbr_model ?? s.output.base_model;
      writeFileSync(join(d, 'raw.glb'), Buffer.from(await (await fetch(url)).arrayBuffer()));
      record(name, 'model', { tool: 'Tripo image_to_model', request: body, task, credits: s.consumed_credit ?? s.credits_consumed ?? null });
      console.log(name, 'model saved', s.consumed_credit ?? '');
      return;
    }
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(s.status)) throw new Error(`${name} tripo ${s.status}`);
    await sleep(8000);
  }
}

/** The raw mesh as flat arrays, placed over the base figure's bind pose: feet on its floor, same height, same span. */
async function loadRaw(name, src) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(DIR, name, 'raw.glb'));
  await doc.transform(weld());
  const pos = [], uv = [], idx = [];
  let texture = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute('POSITION'), T = p.getAttribute('TEXCOORD_0');
      const base = pos.length / 3;
      for (let i = 0; i < P.getCount(); i += 1) {
        const [x, y, z] = P.getElement(i, []);
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        const t = T ? T.getElement(i, []) : [0, 0];
        uv.push(t[0], t[1]);
      }
      const I = p.getIndices().getArray();
      for (const k of I) idx.push(base + k);
      texture ??= p.getMaterial()?.getBaseColorTexture()?.getImage();
    }
  }
  // Tripo faces its figures down +X with the arms along Z: turned a quarter about Y to face +Z like the crews.
  let ex = [Infinity, -Infinity], ez = [Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) { ex = [Math.min(ex[0], pos[i]), Math.max(ex[1], pos[i])]; ez = [Math.min(ez[0], pos[i + 2]), Math.max(ez[1], pos[i + 2])]; }
  if (ez[1] - ez[0] > ex[1] - ex[0])
    for (let i = 0; i < pos.length; i += 3) { const x = pos[i]; pos[i] = -pos[i + 2]; pos[i + 2] = x; }
  // Fit: the base figure's body bounds (hand weapons left out).
  const body = src.lods[0];
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < body.pos.length / 3; i += 1) {
    if (body.nor[i * 4 + 3]) continue;
    for (let k = 0; k < 3; k += 1) { bmin[k] = Math.min(bmin[k], body.pos[i * 3 + k]); bmax[k] = Math.max(bmax[k], body.pos[i * 3 + k]); }
  }
  const rmin = [Infinity, Infinity, Infinity], rmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length / 3; i += 1) for (let k = 0; k < 3; k += 1) { rmin[k] = Math.min(rmin[k], pos[i * 3 + k]); rmax[k] = Math.max(rmax[k], pos[i * 3 + k]); }
  const sy = (bmax[1] - bmin[1]) / (rmax[1] - rmin[1]);
  const sx = (bmax[0] - bmin[0]) / (rmax[0] - rmin[0]);
  const cx = (rmin[0] + rmax[0]) / 2, cz = (rmin[2] + rmax[2]) / 2;
  const bcx = (bmin[0] + bmax[0]) / 2, bcz = (bmin[2] + bmax[2]) / 2;
  for (let i = 0; i < pos.length / 3; i += 1) {
    pos[i * 3] = (pos[i * 3] - cx) * sx + bcx;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - rmin[1]) * sy + bmin[1];
    pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * sy + bcz;
  }
  return { pos: Float32Array.from(pos), uv: Float32Array.from(uv), idx: Uint32Array.from(idx), texture, fit: { sx, sy } };
}

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k += 1) n[v * 3 + k] += f[k];
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Skin weights for a point: the inverse-distance blend of the base figure's eight nearest body vertices, top four joints. */
function makeSkinner(lod) {
  const pts = [];
  for (let i = 0; i < lod.pos.length / 3; i += 1) if (!lod.nor[i * 4 + 3]) pts.push(i);
  // A coarse grid keeps the search local.
  const cell = 0.06;
  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const i of pts) {
    const k = keyOf(lod.pos[i * 3], lod.pos[i * 3 + 1], lod.pos[i * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return (x, y, z) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
    let found = [];
    for (let r = 1; found.length < 8 && r < 30; r += 1) {
      found = [];
      for (let a = -r; a <= r; a += 1) for (let b = -r; b <= r; b += 1) for (let c = -r; c <= r; c += 1) {
        const list = grid.get(`${gx + a},${gy + b},${gz + c}`);
        if (list) found.push(...list);
      }
    }
    const near = found
      .map((i) => ({ i, d: Math.hypot(lod.pos[i * 3] - x, lod.pos[i * 3 + 1] - y, lod.pos[i * 3 + 2] - z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 8);
    const acc = new Map();
    const d0 = near[0].d;
    for (const { i, d } of near) {
      // Only points about as close as the nearest vote, so a hand is not pulled by the hip beside it.
      if (d > d0 * 1.6 + 0.01) continue;
      const w = 1 / (d + 0.004) ** 2;
      for (let k = 0; k < 4; k += 1) {
        const j = lod.jw[i * 8 + k], jw = lod.jw[i * 8 + 4 + k] / 255;
        if (jw > 0) acc.set(j, (acc.get(j) ?? 0) + jw * w);
      }
    }
    const top = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    top.forEach(([jj, ww], k) => { j[k] = jj; w[k] = ww / sum; });
    return { j, w };
  };
}

async function bake(name) {
  const c = CHARACTERS[name];
  const navy = name.split('_')[0];
  const src = sourceOf(c.base);
  const raw = await loadRaw(name, src);
  const nrm = normals(raw.pos, raw.idx);
  const skin = makeSkinner(src.lods[0]);
  await MeshoptSimplifier.ready;
  const attrs = new Float32Array((raw.pos.length / 3) * 5);
  for (let i = 0; i < raw.pos.length / 3; i += 1) attrs.set([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], raw.uv[i * 2], raw.uv[i * 2 + 1]], i * 5);
  const lods = src.lods.map((sl, level) => {
    // Same body triangle budget per level as the base figure.
    let bodyTris = 0;
    for (let t = 0; t < sl.index.length; t += 3) if (!sl.nor[sl.index[t] * 4 + 3]) bodyTris += 1;
    const target = Math.min(raw.idx.length, bodyTris * 3);
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(raw.idx, raw.pos, 3, attrs, 5, [0.25, 0.25, 0.25, 1, 1], null, target, level === 2 ? 1 : 0.2, ['Permissive']);
    const remap = new Map();
    const P = [], N = [], U = [], JW = [], TI = [], I = [];
    for (const old of simplified) {
      let k = remap.get(old);
      if (k === undefined) {
        k = P.length / 3;
        remap.set(old, k);
        const [x, y, z] = [raw.pos[old * 3], raw.pos[old * 3 + 1], raw.pos[old * 3 + 2]];
        P.push(x, y, z);
        N.push(...[0, 1, 2].map((q) => Math.round(nrm[old * 3 + q] * 127)), 0);
        U.push(raw.uv[old * 2], raw.uv[old * 2 + 1]);
        const s = skin(x, y, z);
        const q = s.w.map((v) => Math.round(v * 255));
        q[0] += 255 - (q[0] + q[1] + q[2] + q[3]);
        JW.push(...s.j, ...q);
        TI.push(255, 255, 255, 0);
      }
      I.push(k);
    }
    // The base figure's hand weapons, as they were, the officer's flag in this navy's colour.
    const wmap = new Map();
    for (let t = 0; t < sl.index.length; t += 3) {
      if (!sl.nor[sl.index[t] * 4 + 3]) continue;
      for (let e = 0; e < 3; e += 1) {
        const v = sl.index[t + e];
        let k = wmap.get(v);
        if (k === undefined) {
          k = P.length / 3;
          wmap.set(v, k);
          P.push(sl.pos[v * 3], sl.pos[v * 3 + 1], sl.pos[v * 3 + 2]);
          N.push(sl.nor[v * 4], sl.nor[v * 4 + 1], sl.nor[v * 4 + 2], sl.nor[v * 4 + 3]);
          U.push(0, 0);
          JW.push(...sl.jw.subarray(v * 8, v * 8 + 8));
          const isFlag = sl.nor[v * 4 + 3] === FLAG_ID && sl.tint[v * 4] + sl.tint[v * 4 + 1] + sl.tint[v * 4 + 2] > 200;
          TI.push(...(isFlag ? FLAG[navy].map((x) => Math.round(x * 255)) : sl.tint.subarray(v * 4, v * 4 + 3)), sl.tint[v * 4 + 3]);
        }
        I.push(k);
      }
    }
    if (P.length / 3 > 65535) throw new Error('too many vertices');
    console.log(name, 'lod', level, 'verts', P.length / 3, 'tris', I.length / 3, 'base', sl.index.length / 3);
    return { pos: Float32Array.from(P), nor: Int8Array.from(N), uv: Float32Array.from(U), jw: Uint8Array.from(JW), tint: Uint8Array.from(TI), index: Uint16Array.from(I) };
  });
  writeFileSync(join(OUT, `${name}.bin`), writeCrew({ header: src.header, lods, anim: src.anim }));
  if (!raw.texture) throw new Error(`${name}: raw model has no colour texture`);
  await sharp(Buffer.from(raw.texture)).resize(512, 512).webp({ quality: 82 }).toFile(join(OUT, `${name}.webp`));
  record(name, 'bake', { fit: raw.fit, lods: lods.map((l) => ({ verts: l.pos.length / 3, tris: l.index.length / 3 })), clips: Object.keys(src.header.clips) });
}

async function review(name) {
  const c = readCrew(readFileSync(join(OUT, `${name}.bin`)));
  const tex = await loadTexture(join(OUT, `${name}.webp`));
  for (const view of ['front', 'side']) writeFileSync(join(DIR, name, `review_${view}.png`), await renderLod(c.lods[0], tex, { view, size: 512, weapons: true }));
  writeFileSync(join(DIR, name, 'review_far.png'), await renderLod(c.lods[2], tex, { view: 'front', size: 256 }));
}

const run = { concept, model, bake, review }[stage];
if (!run) throw new Error('stage: concept | model | bake | review');
for (const n of names) {
  if (!CHARACTERS[n]) throw new Error(`unknown ${n}`);
  if (stage === 'concept' || stage === 'model') await run(n).catch((e) => console.error(n, String(e)));
  else await run(n);
}
