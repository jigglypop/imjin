// PILOT (2026-10-17, not settled): a commander as an unarmoured body plus rigid armour pieces, each generated on its
// own and hung on one bone like a weapon, instead of one fused armoured body whose plates crumple when skinned.
//   concept  gpt-image cutouts, front/left/back/right: the body in his under-robe (bareheaded, hair bound), and each
//            piece alone (helmet, cuirass with shoulder guards, lower armour) on an invisible mannequin, with the
//            general's approved figure (<key>_t4) and face as references so they match;
//   model    Tripo multiview_to_model (detailed) of each piece; the body goes through generals-cast.mjs --cand=pb.
// Sources: assets-src/generals-cast-2026-10-17/<key>_pb/ (body views) and <key>_pb/pieces/<part>/.
//   node scripts/generals-pieces.mjs <concept|model> --id=yi[,wakisaka,chenlin] [--part=helmet,cuirass,lower,body] [--only=front,left] [--redo]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const [step, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const PKG = join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const rel = (f) => f.slice(ROOT.length).replaceAll('\\', '/');
const recordOf = (f) => (existsSync(`${f}.json`) ? JSON.parse(readFileSync(`${f}.json`, 'utf8')) : {});
const record = (f, r) => writeFileSync(`${f}.json`, JSON.stringify(r, null, 2) + '\n');

/** The three pilot generals: his approved figure's folder, the under-robe body and the three rigid pieces. */
const G = {
  yi: {
    key: 'yi__yi_tongjesa', face: 'Yi Sun-sin, the Joseon admiral, about fifty: the exact face of the attached face picture (lean sun-weathered face, deep-set sharp dark eyes, thin black moustache, long narrow black chin beard)',
    body: 'a FITTED deep-red quilted cotton under-coat (cheollik-style) closed in front, its skirt falling to just below the knee in soft cloth folds, red sleeves to the wrist, a plain black cloth sash at the waist, dark trousers tucked into tall black leather boots. His hair is bound tightly in a small topknot (sangtu) under a snug black horsehair headband (manggeon), the head otherwise bare, so a helmet fits over it',
    helmet: 'his black-lacquered Korean tugu helmet: a rounded iron bowl with a gilded brow band, a tall gilded spike finial and a short red tassel, and its red neck-and-cheek curtain studded with brass rivets hanging to the shoulders, open at the face',
    cuirass: 'the upper part of his red dujeong-gap brigandine: a closed riveted red vest from the collar to the waist covered with rows of small round brass rivet heads, black trims edged with thin gold, a smooth plain collar, and the two riveted red shoulder guards attached at the shoulders, angled 45 degrees down as on an A-pose wearer, the broad black belt with a gilt buckle at its lower edge; no sleeves, no skirt',
    lower: 'the lower part of his red dujeong-gap brigandine: the riveted armour skirt, a front-split wrap of thick red riveted panels with black gold-edged trims hanging from the waist to just above the knee, open at the front centre and at the sides for the legs; no belt, no torso',
  },
  wakisaka: {
    key: 'wakisaka__wakisaka_shichihon', face: 'Wakisaka Yasuharu, Japanese samurai commander, late thirties: the exact face of the attached face picture (lean hard face, thin moustache, intense proud eyes)',
    body: 'a dark navy silk armour under-robe (yoroi-hitatare) with close-fitting sleeves, black lacquered iron arm guards (kote) of mail and small plates over the forearms, dark navy hakama trousers bloused at the shin into black lacquered shin guards (suneate) with dark blue lacing and black straw sandals. His hair is tied in a short tight topknot bound under a black hachimaki headband, the head otherwise bare, so a helmet fits over it',
    helmet: 'his black lacquered kabuto: a ribbed black bowl with a wide gold crescent maedate crest on the front, small black fukigaeshi turnbacks, and the black lacquered neck guard (shikoro) of laced plates with dark blue silk lacing flaring down to the shoulders, open at the face',
    cuirass: 'his smooth glossy plain black-lacquered okegawa-do cuirass (front and back plates) with dark blue silk lacing at the top, the laced black gorget (nodowa) and the two large laced sode shoulder guards hanging from the shoulders, angled 45 degrees down as on an A-pose wearer, a dark navy cord belt at its lower edge; no sleeves, no tassets',
    lower: 'his kusazuri tassets: seven hanging panels of black lacquered plates laced with dark blue silk, hanging from the waist to mid-thigh all round, with gaps between the panels for the legs; no cuirass',
  },
  chenlin: {
    key: 'chenlin__chenlin_dudok', face: 'Chen Lin, the Ming admiral, fifties: the exact face of the attached face picture (broad commanding face, long black moustache and full beard, stern proud eyes)',
    body: 'a crimson silk robe with a long skirt to mid-shin in soft folds and close sleeves, gilded bracers on the forearms, a plain red cloth sash at the waist, and tall brown-and-gold Ming boots. His hair is gathered in a small topknot under a snug black cloth cap (wangjin net), the head otherwise bare, so a helmet fits over it',
    helmet: 'his tall gilded Ming helmet: a pointed gilded bowl with a long gilded spike and a long red horsehair tassel, upturned gilded phoenix-wing flaps at the sides, and its red-and-gold embroidered neck-and-cheek guards hanging to the shoulders, open at the face',
    cuirass: 'his gilded shanwenjia mountain-pattern lamellar cuirass from the collar to the waist with a gilded round chest mirror (hujingxin) on the breast, the two gold lion-head shoulder guards with their gilded lamellar flaps attached at the shoulders, angled 45 degrees down as on an A-pose wearer, the jade-and-gold belt at its lower edge; no sleeves, no skirt',
    lower: 'his armour skirt: two broad gilded mountain-pattern lamellar thigh panels (left and right) edged in red, hanging from the waist to the knee over the front and sides of the legs, split at the front centre, with a small gilded belly plate between them; no cuirass',
  },
};
const PARTS = ['body', 'helmet', 'cuirass', 'lower'];

const BODY_FRONT = (g) =>
  'A full-body character reference photograph for image-to-3D reconstruction and auto-rigging, in the look of a live-action costume fitting for a big-budget historical war film. ' +
  'Exactly one man standing alone in a relaxed 45-degree A-pose: both arms straight and spread out to the sides, each arm angled exactly 45 degrees below horizontal, the fists about one forearm length outside the hips with open sky between arm and body; shoulders relaxed and low; legs straight and apart, feet wider than the shoulders, toes forward; head level, facing the camera. ' +
  'The RIGHT hand is a firmly closed fist with a hollow grip channel through it (as if around an invisible sword hilt), the LEFT hand a relaxed loosely closed fist; both hands empty, holding nothing: no weapon, no scabbard. ' +
  'Heroic athletic film-lead build: tall, broad square shoulders, a deep chest, a FLAT stomach and a narrow cinched waist (from the side the belly never pushes out past the chest). ' +
  `He is ${g.face}. ` +
  `He is dressed ONLY in what he wears UNDER his armour: ${g.body}. NO helmet, NO cuirass, NO breastplate, NO shoulder guards, NO armour plates or riveted panels on the torso, NO armoured skirt: the armour is fitted later as separate pieces, so the garments stay close to the body and thin. ` +
  'The FIRST attached picture is this man in his full armour (for his build, proportions, colours and pose only: leave all of that armour off). The SECOND attached picture is his face: keep exactly this face, features, beard, age and skin. ' +
  'Seen at chest height through a long telephoto lens, orthographic-looking. The whole figure fits in the frame with a clear margin. Soft, even, flat studio light, no hard shadows; a fully transparent background (a clean cutout, no ground shadow). ' +
  'Crisp, photographic, believable late-sixteenth-century materials, matte or satin. No cape, no ribbons, no text, no letters, no logo, no border. No painting or illustration look, no plastic CGI look. Exactly two arms, two legs.';

const PIECE_FRONT = (g, part) =>
  'A costume-department prop photograph for image-to-3D reconstruction: ONE single armour piece alone, ' + g[part] + '. ' +
  'It is worn by an invisible ghost mannequin of a tall athletic man (broad shoulders, deep chest, narrow waist) standing straight and seen exactly from the FRONT: the piece keeps the exact shape, size and position it has on him, empty inside: no person, no head, no face, no neck, no hands, no arms, no legs, no mannequin, no stand, nothing else. ' +
  'The FIRST attached picture shows this man wearing this armour: copy the piece EXACTLY from it (every plate, rivet, lacing cord, colour, trim, shape and proportion). The SECOND attached picture is a close-up of him (for the helmet and collar detail). ' +
  'Centred, the piece fills most of the frame with a clear margin. Photographic, crisp detail, soft even flat studio light, no hard shadows, a fully transparent background (a clean cutout, no ground shadow). No sword, no other armour pieces. No text, no letters, no labels, no border. No illustration look, no plastic CGI look.';
const PIECE_VIEW = {
  left: 'seen exactly from ITS LEFT SIDE (the wearer\'s left) in strict profile: the front of the piece faces the LEFT edge of the picture',
  right: 'seen exactly from ITS RIGHT SIDE (the wearer\'s right) in strict profile: the front of the piece faces the RIGHT edge of the picture',
  back: 'seen from directly behind: its back',
};
const PIECE_VIEW_PROMPT = (g, part, w) =>
  'The FIRST attached picture is the front view of one armour piece for image-to-3D reconstruction, worn by an invisible ghost mannequin. Make the matching view of exactly the same piece, ' + PIECE_VIEW[w] + '. ' +
  `The piece: ${g[part]}. The SECOND attached picture shows the man wearing it from this same side: the piece must look exactly as there. ` +
  'Same scale, same height in the frame, same orthographic look, same soft flat studio light, a fully transparent background (a clean cutout, no ground shadow). Empty inside: no person, no head, no hands, no mannequin, no stand. ' +
  'Everything consistent with the front view: colours, materials, trims, lengths, proportions. No text, no letters, no border. No illustration look, no plastic CGI look.';
const BODY_VIEW = {
  left: 'seen exactly from HIS LEFT SIDE in strict profile (he faces the LEFT edge of the picture, the camera standing at his left): his left arm hangs angled down at his side in the A-pose, slightly away from the body; his right arm hidden behind his body',
  right: 'seen exactly from HIS RIGHT SIDE in strict profile (he faces the RIGHT edge of the picture, the camera standing at his right): his right arm hangs angled down at his side in the A-pose, slightly away from the body; his left arm hidden behind his body',
  back: 'seen from directly behind: the back of his head and bound hair, the back of the robe, the boots; both arms still angled 45 degrees down, clear of the body; nothing of his face',
};
const BODY_VIEW_PROMPT = (w) =>
  'The FIRST attached picture is the front view of a character reference for image-to-3D reconstruction. Make the matching view of the exact same man in the exact same clothes and the exact same 45-degree A-pose, ' + BODY_VIEW[w] + '. ' +
  'The SECOND attached picture is the same man in armour from this same side (for his proportions only: he wears no armour here). The THIRD is his face. ' +
  'Same scale, same height in the frame, same orthographic look, same soft flat studio light, a fully transparent background (a clean cutout, no ground shadow). Everything consistent with the front view. No helmet, no armour. No text, no border. No illustration look, no plastic CGI look. Exactly two arms, two legs.';

// ---------------------------------------------------------------- plumbing (as scripts/generals-cast.mjs)
function ledger(entry) {
  const f = join(PKG, 'ledger.json');
  const l = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { entries: [] };
  l.entries.push({ at: new Date().toISOString(), ...entry });
  l.totals = {};
  for (const e of l.entries) l.totals[e.provider] = (l.totals[e.provider] ?? 0) + (e.credits ?? 0);
  writeFileSync(f, JSON.stringify(l, null, 2) + '\n');
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
      if (!e.status && i < tries && /fetch failed|ECONNRESET|socket|network|timeout|terminated/i.test(`${e} ${e?.cause ?? ''}`)) { await sleep(4000 * (i + 1)); continue; }
      throw e;
    }
  }
}
async function download(url) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(900_000) }); if (!r.ok) throw new Error(`download ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i >= 8) throw e; await sleep(5000 * (i + 1)); }
  }
}
const jpg = async (file) => new Blob([await sharp(file).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#cfd0d2' }).jpeg({ quality: 92 }).toBuffer()], { type: 'image/jpeg' });
async function edit(file, prompt, refs) {
  let last;
  for (const model of IMAGE_MODELS) {
    const image = { model, size: '2880x2880', quality: 'high', background: 'transparent', output_format: 'png' };
    const form = new FormData();
    for (const [k, v] of Object.entries(image)) form.set(k, String(v));
    form.set('n', '1'); form.set('prompt', prompt);
    for (const [i, ref] of refs.entries()) form.append('image[]', await jpg(ref), `ref${i}.jpg`);
    try {
      let j;
      for (let k = 0; ; k++) {
        try { j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form, 0); break; }
        catch (e) { if (e.status || k >= 8) throw e; log('openai dropped, again', k + 1); await sleep(15000 * (k + 1)); }
      }
      writeFileSync(file, Buffer.from(j.data[0].b64_json, 'base64'));
      record(file, { at: new Date().toISOString(), image, prompt, refs: refs.map(rel), usage: j.usage ?? null });
      ledger({ provider: 'openai', what: rel(file), model, credits: 0, usage: j.usage ?? null });
      return;
    } catch (e) {
      last = e;
      if (!(e.status === 400 || e.status === 404) || !/model|size/i.test(String(e))) throw e;
    }
  }
  throw last;
}

const ref = (g) => join(PKG, `${g.key}_t4`);
const dirOf = (g, part) => { const d = part === 'body' ? join(PKG, `${g.key}_pb`) : join(PKG, `${g.key}_pb`, 'pieces', part); mkdirSync(d, { recursive: true }); return d; };

async function concept(id, part) {
  const g = G[id], d = dirOf(g, part), only = (args.only ?? 'front,left,back,right').split(',');
  const front = join(d, 'front.png');
  if (only.includes('front') && (!existsSync(front) || args.redo)) {
    log(id, part, 'front…');
    await edit(front, part === 'body' ? BODY_FRONT(g) : PIECE_FRONT(g, part), [join(ref(g), 'front.png'), join(ref(g), 'face.png')]);
    log(id, part, 'front ready');
  }
  await Promise.all(['left', 'back', 'right'].filter((w) => only.includes(w)).map(async (w, i) => {
    const out = join(d, `${w}.png`);
    if (existsSync(out) && !args.redo) return;
    await sleep(i * 3000);
    log(id, part, `${w}…`);
    if (part === 'body') await edit(out, BODY_VIEW_PROMPT(w), [front, join(ref(g), `${w}.png`), join(ref(g), 'face.png')]);
    else await edit(out, PIECE_VIEW_PROMPT(g, part, w), [front, join(ref(g), `${w}.png`)]);
    log(id, part, `${w} ready`);
  }));
}

// ---------------------------------------------------------------- Tripo (pieces; the body goes through generals-cast.mjs)
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const tripoAuth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` };
async function tripoUpload(f) {
  const form = new FormData();
  form.set('file', new Blob([await sharp(f).resize(2048, 2048, { fit: 'inside' }).png().toBuffer()], { type: 'image/png' }), 'view.png');
  const j = await http('POST', `${TRIPO}/upload`, tripoAuth, form);
  return j.data.image_token ?? j.data.file_token;
}
async function model(id, part) {
  if (part === 'body') return log(id, 'body: node scripts/generals-cast.mjs model --id=' + id + ' --cand=pb --views4 --provider=tripo');
  const g = G[id], d = dirOf(g, part), out = join(d, 'raw.glb');
  if (existsSync(out) && !args.redo) return log(id, part, 'raw there');
  const r = recordOf(out);
  if (!r.task) {
    const tokens = [];
    for (const w of ['front', 'left', 'back', 'right']) tokens.push(await tripoUpload(join(d, `${w}.png`)));
    const body = {
      type: 'multiview_to_model', model_version: 'v3.1-20260211', files: tokens.map((t) => ({ type: 'png', file_token: t })),
      texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', face_limit: Number(args.faces ?? 100000), orientation: 'default',
    };
    const j = await http('POST', `${TRIPO}/task`, { ...tripoAuth, 'Content-Type': 'application/json' }, JSON.stringify(body));
    if (j.code !== 0) throw new Error(JSON.stringify(j));
    Object.assign(r, { provider: 'tripo', task: j.data.task_id, at: new Date().toISOString(), request: body });
    record(out, r);
    log(id, part, 'tripo task', r.task);
  }
  let url;
  for (let last = -1; ; ) {
    const t = (await http('GET', `${TRIPO}/task/${r.task}`, tripoAuth)).data;
    if (t.status === 'success') { r.credits = t.consumed_credit ?? t.credits_consumed ?? null; url = t.output.pbr_model ?? t.output.model ?? t.output.base_model; break; }
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(t.status)) throw new Error(`tripo ${t.status}: ${JSON.stringify(t).slice(0, 300)}`);
    if (t.progress !== last) log(id, part, `${t.progress}%`);
    last = t.progress;
    await sleep(10_000);
  }
  writeFileSync(out, await download(url));
  record(out, r);
  ledger({ provider: 'tripo', what: `${g.key}_pb ${part} model`, task: r.task, credits: r.credits });
  log(id, part, 'raw saved', r.credits, 'credits');
}

// ---------------------------------------------------------------- fit: pieces onto the packed body, scale/offset only
/** Which bone carries each piece, which body vertices it must cover at bind, which it must leave free. */
const MOUNT = {
  helmet: { bone: 'Head', cover: (n, y, L) => (n === 'Head' || n === 'head_end') && y > L.head + 0.55 * (L.top - L.head), free: /^(Left|Right)(Arm|ForeArm|Hand)$/ },
  cuirass: { bone: 'Spine', cover: (n, y, L) => !/Arm|Hand|Head|head/.test(n) && y > L.hips + 0.3 * (L.neck - L.hips) && y < L.neck - 0.05 * (L.neck - L.hips), free: /^(Left|Right)(ForeArm|Hand)$|^Head$/ },
  lower: { bone: 'Hips', cover: (n, y, L) => !/Arm|Hand/.test(n) && y < L.hips + 0.1 * (L.neck - L.hips) && y > L.hips - 0.3 * (L.neck - L.hips), free: /^(Left|Right)(ForeArm|Hand)$|^(Left|Right)(Leg|Foot)$/ },
};
const stageDir = join(ROOT, 'public', 'models', 'generals', '_stage', 'pb');
const bodyFile = (g) => join(stageDir, `${g.key}.glb`);
const pieceFile = (g, part, suffix = '') => join(stageDir, `${g.key}__${part}${suffix}.glb`);

/** A Tripo piece as one triangle soup: world transforms baked, turned from Tripo's +X facing to the body's +Z. */
async function pieceMesh(file) {
  const { io } = await import('./lib/figure.mjs');
  const { transformMesh } = await import('@gltf-transform/functions');
  const { Matrix4 } = await import('three');
  const doc = await io.read(file);
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) transformMesh(node.getMesh(), node.getWorldMatrix());
  for (const node of doc.getRoot().listNodes()) node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const turn = new Matrix4().makeRotationY(-Math.PI / 2 + (Number(args.yaw ?? 0) * Math.PI) / 180);
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, turn.toArray());
  const pos = [], idx = [];
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION'), base = pos.length / 3, e = [];
    for (let i = 0; i < P.getCount(); i++) pos.push(...P.getElement(i, e));
    const I = p.getIndices().getArray(); for (const i of I) idx.push(base + i);
  }
  return { doc, pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

async function fit(id, part) {
  if (part === 'body') return;
  const g = G[id];
  const { loadFigure, pose, voxelize } = await import('./lib/deform.mjs');
  const { Matrix4, Vector3 } = await import('three');
  const F = await loadFigure(bodyFile(g));
  const bind = pose(F, null, 0);
  const jw = (n) => new Vector3().setFromMatrixPosition(bind.jointWorld[F.jointNames.indexOf(n)]);
  let top = -Infinity; for (const V of bind.verts) for (let i = 1; i < V.length; i += 3) top = Math.max(top, V[i]);
  const L = { top, head: jw('Head').y, neck: jw('neck').y, hips: jw('Hips').y };
  const M = MOUNT[part];
  const cover = [], free = [];
  F.prims.forEach((p, pi) => {
    const V = bind.verts[pi];
    for (let v = 0; v < p.pos.length / 3; v++) {
      let b = 0; for (let q = 1; q < 4; q++) if (p.w[v * 4 + q] > p.w[v * 4 + b]) b = q;
      const n = F.jointNames[p.j[v * 4 + b]], y = V[v * 3 + 1];
      if (M.cover(n, y, L)) cover.push(V[v * 3], y, V[v * 3 + 2]);
      else if (M.free.test(n)) free.push(V[v * 3], y, V[v * 3 + 2]);
    }
  });
  const piece = await pieceMesh(join(dirOf(g, part), 'raw.glb'));
  const vox = voxelize(piece.pos, piece.idx, 72, Number(args.enclose ?? 15));
  // starting guess: the piece's box onto the covered vertices' box
  const box = (a) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); } return { lo, hi, c: lo.map((x, k) => (x + hi[k]) / 2), s: hi.map((x, k) => x - lo[k]) }; };
  const cb = box(cover), pb = box(piece.pos);
  const s0 = cb.s[0] / pb.s[0];
  const C = new Float32Array(cover), Fr = new Float32Array(free);
  const unitM = 1.8 / (top - Math.min(...bind.verts.map((V) => { let m = Infinity; for (let i = 1; i < V.length; i += 3) m = Math.min(m, V[i]); return m; })));
  const margin = 0.006 / unitM; // covered vertices sit at least 6 mm inside
  const evalAt = (s, tx, ty, tz, sz = s, sx = s) => {
    // piece point p -> world: (s, s, sz) * p + t ; world w -> piece: (w - t) / scale
    let inC = 0, inF = 0;
    for (let i = 0; i < C.length; i += 3) if (vox.sdf((C[i] - tx) / sx, (C[i + 1] - ty) / s, (C[i + 2] - tz) / sz) * s < -margin) inC++;
    for (let i = 0; i < Fr.length; i += 3) if (vox.sdf((Fr[i] - tx) / sx, (Fr[i + 1] - ty) / s, (Fr[i + 2] - tz) / sz) < 0) inF++;
    return { cov: inC / (C.length / 3), foreign: Fr.length ? inF / (Fr.length / 3) : 0 };
  };
  let best = null;
  const span = Math.max(...cb.s);
  for (let si = 0; si <= 36; si++) {
    const s = s0 * (0.7 + si * 0.05);
    const tx = cb.c[0] - s * pb.c[0];
    for (let yi = -8; yi <= 8; yi++) for (let zi = -6; zi <= 6; zi++) {
      const ty = cb.c[1] - s * pb.c[1] + yi * span * 0.04, tz = cb.c[2] - s * pb.c[2] + zi * span * 0.03;
      const r = evalAt(s, tx, ty, tz);
      const score = r.cov - 2 * r.foreign;
      if (!best || score > best.score + 0.003 || (Math.abs(score - best.score) <= 0.003 && s < best.s)) best = { s, tx, ty, tz, score, ...r };
    }
  }
  // Cuirass and lower armour: their height is anchored on landmarks (coverage alone lets a shell slide up or down the
  // torso): the cuirass from the waist to just above the neck joint, the lower armour from the waist to its hem (the
  // knee, or mid-thigh for kusazuri); centred on the covered vertices in x and z.
  if (part !== 'helmet') {
    const T = L.neck - L.hips, waist = L.hips + 0.12 * T;
    const knee = jw('LeftLeg').y;
    const top = part === 'cuirass' ? L.neck + 0.1 * T : waist + 0.04 * T;
    // depth gets its own scale (sz): a generated shell is often shallower front-to-back than the robed body under it
    const hem = id === 'wakisaka' ? (L.hips + knee) / 2 : knee + 0.02 * T;
    const fixed = part === 'lower' ? (top - hem) / pb.s[1] : null;
    best = null;
    for (let si = 0; si <= 60 && !(best && best.cov >= 0.95); si++) {
      const s = fixed ?? s0 * (0.6 + si * 0.03);
      for (let k = 0; k <= (fixed ? 14 : 8); k++) for (let zi = -6; zi <= 6; zi++) {
        const sz = s * (1 + k * 0.1), sx = fixed ? sz : s; // the lower armour's height is fixed by its hem: it widens in x and z together
        const c = { s, sz, sx, tx: cb.c[0] - sx * pb.c[0], ty: top - s * pb.hi[1], tz: cb.c[2] - sz * pb.c[2] + zi * span * 0.02 };
        Object.assign(c, evalAt(c.s, c.tx, c.ty, c.tz, c.sz, c.sx));
        if (!best || c.cov - 2 * c.foreign > best.cov - 2 * best.foreign + 0.002) best = c;
      }
      if (fixed) break;
    }
  }
  const place = new Matrix4().makeScale(best.sx ?? best.s, best.s, best.sz ?? best.s).setPosition(best.tx, best.ty, best.tz);
  const fitRec = { at: new Date().toISOString(), part, bone: M.bone, scale: best.s, depthScale: best.sz ?? best.s, offset: [best.tx, best.ty, best.tz], coverage: best.cov, foreignInside: best.foreign, covered: C.length / 3, free: Fr.length / 3, startScale: s0, landmarks: L, voxFilled: vox.filled, place: place.toArray() };
  writeFileSync(join(dirOf(g, part), 'fit.json'), JSON.stringify(fitRec, null, 2) + '\n');
  log(id, part, 'fit', `scale ${(best.s / s0).toFixed(2)}x start, coverage ${(best.cov * 100).toFixed(1)}%, foreign inside ${(best.foreign * 100).toFixed(1)}%, solid ${(vox.filled * 100).toFixed(1)}% of its box`);
}

/**
 * attach: the pieces as their own GLBs (LOD0/1/2) beside the body, and on the body a node per piece under its bone
 * (`piece_<part>`, extras { piece: <file> }) whose matrix is the fit: the runtime loads the file and parents it there.
 */
async function attach(id) {
  const g = G[id];
  const { io, simplify } = await import('./lib/figure.mjs');
  const { dedup, meshopt, prune, quantize, textureCompress, transformMesh } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const { Matrix4 } = await import('three');
  for (const part of ['helmet', 'cuirass', 'lower']) {
    if (!existsSync(join(dirOf(g, part), 'fit.json'))) continue;
    for (const [suffix, tris, tex] of [['', 60_000, 2048], ['_lod1', 8_000, 1024], ['_lod2', 3_000, 512]]) {
      const { doc } = await pieceMesh(join(dirOf(g, part), 'raw.glb'));
      const mesh = doc.getRoot().listMeshes()[0];
      const have = mesh.listPrimitives()[0].getIndices().getCount() / 3;
      if (have > tris) simplify(doc, tris, suffix ? 1 : 0.02, suffix ? ['Permissive'] : [], 1, mesh);
      await doc.transform(dedup(), prune(),
        textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [tex, tex], quality: 88 }),
        textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness|occlusion|emissive)/, resize: [tex / 2, tex / 2], quality: 88 }),
        quantize({ quantizeTexcoord: 16, quantizePosition: 16 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      await io.write(pieceFile(g, part, suffix), doc);
    }
  }
  for (const suffix of ['', '_lod1', '_lod2']) {
    const file = join(stageDir, `${g.key}${suffix}.glb`);
    const doc = await io.read(file);
    const nodes = doc.getRoot().listNodes();
    for (const part of ['helmet', 'cuirass', 'lower']) {
      const f = join(dirOf(g, part), 'fit.json');
      for (const n of nodes) if (n.getName() === `piece_${part}`) n.dispose();
      if (!existsSync(f) || (args.without ?? '').split(',').includes(part)) continue;
      const fr = JSON.parse(readFileSync(f, 'utf8'));
      const bone = doc.getRoot().listNodes().find((n) => n.getName() === fr.bone);
      const local = new Matrix4().fromArray(bone.getWorldMatrix()).invert().multiply(new Matrix4().fromArray(fr.place));
      const node = doc.createNode(`piece_${part}`).setMatrix(local.toArray()).setExtras({ piece: `_stage/pb/${g.key}__${part}${suffix}` });
      bone.addChild(node);
    }
    await io.write(file, doc);
  }
  log(id, 'pieces attached');
}

/** deform: the body metric and each piece's interpenetration (deform.mjs preparePiece) on every frame of every clip. */
async function deform(id) {
  const g = G[id];
  const { loadFigure, prepare, preparePiece, scoreClip, voxelize } = await import('./lib/deform.mjs');
  const { Matrix4 } = await import('three');
  const F = await loadFigure(bodyFile(g));
  const body = prepare(F);
  const pieces = {};
  for (const part of ['helmet', 'cuirass', 'lower']) {
    const fr = JSON.parse(readFileSync(join(dirOf(g, part), 'fit.json'), 'utf8'));
    const pm = await pieceMesh(join(dirOf(g, part), 'raw.glb'));
    pieces[part] = preparePiece(F, { vox: voxelize(pm.pos, pm.idx, 72, 15), bone: fr.bone, place: new Matrix4().fromArray(fr.place) });
  }
  const out = {};
  for (const clip of (args.clip ?? 'idle_sword,command_sword,attack_sword,attack_bow').split(',')) {
    const r = scoreClip(F, (c, t) => {
      const b = body(c, t);
      const p = Object.fromEntries(Object.entries(pieces).map(([k, f]) => [k, f(c, t)]));
      return { ...b, bodyScore: b.score, pieces: p, score: Math.max(b.score, ...Object.values(p).map((x) => x.score)) };
    }, clip);
    const worst = r.worst.filter((x, i, a) => a.findIndex((y) => Math.abs(y.time - x.time) < 0.25) === i).slice(0, 4);
    const max = (k) => Math.max(...r.worst.map((f) => (k === 'body' ? f.bodyScore : f.pieces[k].score)));
    out[clip] = { score: r.score, body: max('body'), helmet: max('helmet'), cuirass: max('cuirass'), lower: max('lower'), worst: worst.map((w) => ({ time: w.time, score: w.score, body: w.bodyScore, ...Object.fromEntries(Object.entries(w.pieces).map(([k, v]) => [k, { score: v.score, pokeOut: v.pokeOut, intrude: v.intrude }])) })) };
    log(id, clip.padEnd(14), `all ${r.score.toFixed(2)} body ${out[clip].body.toFixed(2)} helmet ${out[clip].helmet.toFixed(2)} cuirass ${out[clip].cuirass.toFixed(2)} lower ${out[clip].lower.toFixed(2)}  worst ${worst.map((w) => `t${w.time.toFixed(2)}`).join(' ')}`);
  }
  writeFileSync(join(dirOf(g, 'body'), 'deform_pieces.json'), JSON.stringify(out, null, 2) + '\n');
}

const STEPS = { concept, model, fit, deform: (id, part) => (part === 'helmet' ? deform(id) : null), attach: (id, part) => (part === 'helmet' ? attach(id) : null) };
if (!STEPS[step]) throw new Error(`step: ${Object.keys(STEPS).join(' | ')}`);
const ids = (args.id ?? 'yi').split(','), parts = (args.part ?? PARTS.join(',')).split(',');
let failed = 0;
await Promise.all(ids.flatMap((id, i) => parts.map(async (part, k) => {
  await sleep((i * parts.length + k) * 2500);
  return STEPS[step](id, part).catch((e) => { failed++; log(id, part, 'FAILED', String(e).slice(0, 400)); });
})));
process.exitCode = failed ? 1 : 0;
