// The 18 catalog weapons remade: an ornate, historically grounded concept from the OpenAI Images API, Meshy
// image-to-3D at its highest quality, then normalised for the generals' hands (metres, +Y along the blade or shaft,
// the grip at the origin; a bow's belly toward +Z) and packed as weapon_<id>.glb (LOD0, graphics high) and _lod1
// (medium and low), plus the 512 px icon in public/ui/weapons. Every output keeps a <file>.json (prompt, task,
// credits) beside it; reruns skip what is done and resume a running provider task. Credits go to the cast ledger.
//
//   node scripts/weapons-cast.mjs <concept|model|pack|sheet|all> --id=joseon_hwando[,..|all] [--redo]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const [step, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
// GENERALS_ASSETS points a worktree at the main checkout's assets-src (generation sources live there, archived to S3).
const SRC = process.env.GENERALS_ASSETS ?? join(ROOT, 'assets-src');
const PKG = join(SRC, 'generals-weapons-cast-2026-10-17');
const LEDGER = join(SRC, 'generals-cast-2026-10-17', 'ledger.json');
const OUT = args.stage ? join(ROOT, 'public', 'models', 'generals', '_stage') : join(ROOT, 'public', 'models', 'generals', 'parts');
const ICONS = args.stage ? join(ROOT, 'public', 'models', 'generals', '_stage') : join(ROOT, 'public', 'ui', 'weapons');
mkdirSync(OUT, { recursive: true });

/** length in metres, grip = fraction of the length from the butt/pommel (bows: from the lower tip). */
const WEAPONS = {
  joseon_hwando: { kind: 'sword', length: 0.96, grip: 0.09, brief: 'a Joseon Korean hwando sabre of a naval commander (1590s): a slender, slightly curved single-edged polished steel blade with a fine fuller, a round pierced brass guard (dongdari), a dark red ray-skin grip wrapped in red silk cord, gilt brass collar and pommel cap' },
  joseon_ungeom: { kind: 'sword', length: 1.12, grip: 0.18, brief: 'a Joseon Korean ungeom, the royal guard\'s ceremonial sabre: a long gently curved polished steel blade, gilt-bronze cloud-pattern fittings, a red-lacquered grip with gold bands, a red silk tassel at the pommel' },
  joseon_jangchang: { kind: 'spear', length: 3.0, grip: 0.42, brief: 'a Joseon Korean jangchang long spear: a slender leaf-shaped polished steel head with a central ridge, a brass socket, a bright red horsehair tassel below the head, a long straight dark red-lacquered wooden shaft with brass bands and an iron butt cap' },
  joseon_dangpa: { kind: 'spear', length: 2.4, grip: 0.42, brief: 'a Joseon Korean dangpa trident: a long central steel spike and two upturned curved side prongs forged as one steel fork, a brass socket, a long dark lacquered wooden shaft with brass bands and an iron butt cap' },
  joseon_gakgung: { kind: 'bow', length: 1.25, grip: 0.5, brief: 'a Joseon Korean gakgung horn composite recurve bow, unstrung-shape shown STRUNG: a short, deeply recurved black water-buffalo-horn and birch-bark body with sharply reflexed tips, a leather-wrapped grip in the middle, a thin twisted silk bowstring' },
  joseon_janggunbow: { kind: 'bow', length: 1.3, grip: 0.5, brief: 'a Joseon Korean commander\'s gakgung composite recurve bow, STRUNG: a short deeply recurved body lacquered deep red with gold painted bands and gilt tip ornaments, a red leather-wrapped grip, a thin silk bowstring' },
  japan_katana: { kind: 'sword', length: 1.0, grip: 0.12, brief: 'a Japanese katana of a Sengoku daimyo: a gently curved single-edged polished steel blade with a visible wavy hamon, a round black iron tsuba with gold inlay, a black silk-wrapped hilt over white ray skin with gold menuki' },
  japan_tachi: { kind: 'sword', length: 1.08, grip: 0.12, brief: 'a Japanese tachi of a Sengoku lord: a long deeply curved polished steel blade with a hamon, a gilt-rimmed shitogi tsuba, a white ray-skin hilt wrapped in black silk, gilt fittings' },
  japan_yari: { kind: 'spear', length: 2.7, grip: 0.42, brief: 'a Japanese su-yari spear: a straight double-edged triangular-section polished steel head, a black lacquered wooden shaft with a brass collar and inlaid mother-of-pearl bands, an iron ishizuki butt cap' },
  japan_jumonjiyari: { kind: 'spear', length: 2.6, grip: 0.42, brief: 'a Japanese jumonji-yari cross spear: a straight polished steel blade with two curved side blades forming a cross, a brass collar, a black lacquered wooden shaft with gold bands, an iron butt cap' },
  japan_yumi: { kind: 'bow', length: 2.2, grip: 0.36, brief: 'a Japanese yumi longbow, STRUNG: a very tall asymmetric laminated bamboo bow, the grip one third from the bottom, black lacquer with rattan bindings, a leather grip, a thin hemp bowstring' },
  japan_shigeto: { kind: 'bow', length: 2.2, grip: 0.36, brief: 'a Japanese shigeto-yumi, STRUNG: a very tall asymmetric bamboo bow densely bound with red-lacquered rattan bands all along it, the grip one third from the bottom wrapped in leather, a thin hemp bowstring' },
  ming_dao: { kind: 'sword', length: 1.05, grip: 0.19, brief: 'a Ming Chinese liuyedao willow-leaf sabre of a general: a single-edged polished steel blade gently curved and widening toward the tip, a gilt-bronze disc guard, a red silk cord-wrapped grip, a gilt pommel with a red tassel' },
  ming_jian: { kind: 'sword', length: 1.1, grip: 0.19, brief: 'a Ming Chinese straight double-edged jian of a general: a long straight polished steel blade with a central ridge, a gilt-bronze guard with cloud scrolls, a dark cord-wrapped grip, a gilt pommel with a red tassel' },
  ming_qiang: { kind: 'spear', length: 2.7, grip: 0.42, brief: 'a Ming Chinese hongyingqiang spear: a leaf-shaped polished steel head with a ridge, a gilt socket, a thick bright red horsehair tassel below the head, a long red-lacquered wooden shaft, an iron butt cap' },
  ming_guandao: { kind: 'spear', length: 2.4, grip: 0.4, brief: 'a Ming Chinese guandao (yanyuedao) glaive: a broad crescent-curved polished steel blade with a dragon-head gilt bronze collar and a back spike, a red tassel, a long dark red-lacquered wooden shaft with gilt bands and an iron butt spike' },
  ming_gong: { kind: 'bow', length: 1.5, grip: 0.5, brief: 'a Ming Chinese composite recurve bow, STRUNG: a brown horn-and-sinew body covered in birch bark with long rigid ears (siyahs) bent forward at both ends, bone string bridges, a leather-wrapped grip, a thin silk bowstring' },
  // The other chapters (Armada 1588, Lepanto 1571, Trafalgar 1797-1805); `era` replaces the 1590s craftsmanship line.
  rapier: { kind: 'sword', length: 1.12, grip: 0.12, era: 'late-sixteenth-century European', brief: 'a European swept-hilt rapier of a sea commander (1570-1590): a long slender straight double-edged polished steel blade with a narrow fuller, a blackened-steel swept hilt of curving bars and a ring guard with straight quillons, a wire-wrapped grip, a round pommel' },
  kilij: { kind: 'sword', length: 0.98, grip: 0.13, era: 'sixteenth-century Ottoman', brief: 'an Ottoman kilij sabre of a pasha (1570s): a strongly curved single-edged polished steel blade widening near the tip into a false-edged yelman, gold-inlaid near the hilt, a gilt straight cross-guard with round ends, a black horn grip with a pistol-shaped pommel cap' },
  naval_sword: { kind: 'sword', length: 0.95, grip: 0.13, era: 'Napoleonic-era British', brief: 'a Royal Navy officer\'s sword of the 1805 pattern: a straight single-edged polished steel blade with a blued and gilt etched panel near the hilt, a gilt brass stirrup hilt with a fouled-anchor oval in the side ring, a white ivory grip bound with gilt wire, a gilt lion-head pommel' },
  sabre_fr: { kind: 'sword', length: 0.95, grip: 0.13, era: 'Napoleonic-era French', brief: 'a French naval officer\'s sabre of 1805: a gently curved single-edged polished steel blade with a blued and gilt etched panel near the hilt, a gilt brass stirrup guard with an anchor emblem, a black horn grip bound with gilt wire, a gilt pommel cap' },
  espada: { kind: 'sword', length: 0.96, grip: 0.13, era: 'Napoleonic-era Spanish', brief: 'a Spanish Real Armada officer\'s sword of 1800: a straight narrow double-edged polished steel blade, a gilt brass hilt with a single knuckle bow and a small anchor-engraved shell guard, a dark wood grip bound with gilt wire, a gilt urn pommel' },
  ming_shaogong: { kind: 'bow', length: 1.6, grip: 0.5, brief: 'a Ming Chinese long-eared composite bow (changshaogong), STRUNG: very long straight rigid ears at both ends, a dark red lacquered horn body with gold painted dragon bands and gilt tip caps, a leather grip, a thin silk bowstring' },
};

const CONCEPT = (w) =>
  `A museum product photograph of a single weapon for image-to-3D reconstruction: ${w.brief}. ` +
  (w.kind === 'bow'
    ? 'The bow stands perfectly upright and centred, its tips at the top and bottom of the picture, its belly facing left, the string on the right, the whole bow in frame with a margin. '
    : 'The weapon stands perfectly upright and centred, the point/blade at the TOP and the hilt/butt at the BOTTOM, seen straight from the side, the whole weapon in frame with a margin; the bare weapon alone, no scabbard anywhere in the picture. ') +
  `Ornate but historically grounded ${w.era ?? 'late-sixteenth-century'} craftsmanship as in the hero props of big-budget historical war films; crisp, sharply focused detail of every fitting, wrap and engraving; truthful materials: polished steel, gilt bronze, lacquer, silk, leather. ` +
  'Plain seamless light grey studio background, soft even light, no shadows, no reflections of a room, nothing else in the picture. No hands, no people, no text, no letters, no logo, no border, no illustration look.';

const recordOf = (f) => (existsSync(`${f}.json`) ? JSON.parse(readFileSync(`${f}.json`, 'utf8')) : {});
const record = (f, r) => writeFileSync(`${f}.json`, JSON.stringify(r, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, ...m) => console.log(new Date().toISOString().slice(11, 19), id.padEnd(18), ...m);
function ledger(entry) {
  const l = JSON.parse(readFileSync(LEDGER, 'utf8'));
  l.entries.push({ at: new Date().toISOString(), ...entry });
  l.totals = {};
  for (const e of l.entries) l.totals[e.provider] = (l.totals[e.provider] ?? 0) + (e.credits ?? 0);
  writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n');
}
/** Retries resets, TLS drops and 5xx with a growing pause; a 4xx is final. */
async function http(method, url, headers, body, tries = 10) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : {};
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(8000 * (i + 1)); continue; }
      throw Object.assign(new Error(`${res.status} ${text.slice(0, 400)}`), { status: res.status });
    } catch (e) {
      if (e.status || i >= tries) throw e;
      console.error('http retry', i, String(e), String(e?.cause ?? ''));
      await sleep(8000 * (i + 1));
    }
  }
}
async function download(url) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(900_000) }); if (!r.ok) throw new Error(`download ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i >= 8) throw e; await sleep(5000 * (i + 1)); }
  }
}

async function concept(id, w) {
  const d = join(PKG, id); mkdirSync(d, { recursive: true });
  const out = join(d, 'concept.png');
  if (existsSync(out) && !args.redo) return log(id, 'concept there');
  const prompt = CONCEPT(w);
  if (args.images === 'gemini') {
    const { geminiImage, geminiModel } = await import('./gemini-image.mjs');
    writeFileSync(out, await geminiImage(prompt, { aspect: '9:16' }));
    record(out, { at: new Date().toISOString(), tool: 'gemini image', model: geminiModel(), prompt, estimatedUsd: 0.04 });
    ledger({ provider: 'gemini', what: `weapon ${id} concept`, model: geminiModel(), credits: 0, usd: 0.04 });
    return log(id, 'concept ready');
  }
  for (const model of ['gpt-image-2.5-flare', 'gpt-image-2']) {
    try {
      const image = { model, size: '1632x2880', quality: 'high', background: 'opaque', output_format: 'png' };
      const j = await http('POST', 'https://api.openai.com/v1/images/generations', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, JSON.stringify({ ...image, prompt, n: 1 }));
      writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64'));
      record(out, { at: new Date().toISOString(), image, prompt, usage: j.usage ?? null });
      ledger({ provider: 'openai', what: `weapon ${id} concept`, model, credits: 0, usage: j.usage ?? null });
      return log(id, 'concept ready');
    } catch (e) { if (!(e.status === 400 || e.status === 404)) throw e; log(id, model, String(e).slice(0, 160)); }
  }
}

const meshy = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
async function model(id) {
  const d = join(PKG, id);
  const out = join(d, 'raw.glb');
  if (existsSync(out) && !args.redo) return log(id, 'raw there');
  const r = recordOf(out);
  if (!r.task) {
    const img = `data:image/png;base64,${(await sharp(join(d, 'concept.png')).resize(2048, 2048, { fit: 'inside' }).png().toBuffer()).toString('base64')}`;
    const body = { ai_model: 'meshy-7.1', should_texture: true, enable_pbr: true, texture_resolution: '4k', geometry_resolution: '2k', should_remesh: false, image_enhancement: false, remove_lighting: true, target_formats: ['glb'] };
    const j = await http('POST', 'https://api.meshy.ai/openapi/v1/image-to-3d', meshy, JSON.stringify({ ...body, image_url: img }), 3);
    Object.assign(r, { task: j.result, at: new Date().toISOString(), request: body });
    record(out, r);
    log(id, 'model task', r.task);
  }
  let t;
  for (let last = -1; ; ) {
    t = await http('GET', `https://api.meshy.ai/openapi/v1/image-to-3d/${r.task}`, meshy);
    if (t.status === 'SUCCEEDED') break;
    if (['FAILED', 'CANCELED'].includes(t.status)) throw new Error(`model ${t.status} ${JSON.stringify(t.task_error ?? {})}`);
    if (t.progress !== last) log(id, `${t.progress}%`);
    last = t.progress;
    await sleep(15000);
  }
  writeFileSync(out, await download(t.model_urls.glb));
  r.credits = t.consumed_credits ?? null;
  record(out, r);
  ledger({ provider: 'meshy', what: `weapon ${id} model`, task: r.task, credits: r.credits });
  log(id, 'raw saved', r.credits, 'credits');
}

async function pack(id, w) {
  const { io, simplify } = await import('./lib/figure.mjs');
  const { dedup, prune, quantize, meshopt, textureCompress, flatten, join: joinMeshes, weld } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  const d = join(PKG, id);
  const levels = {};
  for (const lod of [{ s: '', tris: 40_000, base: 2048, other: 1024 }, { s: '_lod1', tris: 5_000, base: 512, other: 512 }]) {
    const doc = await io.read(join(d, 'raw.glb'));
    await doc.transform(flatten(), joinMeshes(), weld());
    // Bake every node transform into the vertices, then put the long axis on +Y and the bow's depth on Z.
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
    const pts = [];
    for (const n of nodes) {
      const m = n.getWorldMatrix();
      for (const p of n.getMesh().listPrimitives()) {
        const pos = p.getAttribute('POSITION'); const a = pos.getArray().slice(); const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          a.set([x, y, z], i * 3); pts.push(x, y, z);
        }
        pos.setArray(a);
        const nm = p.getAttribute('NORMAL');
        if (nm) { const b = nm.getArray().slice(); for (let i = 0; i < nm.getCount(); i++) { nm.getElement(i, v); const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2]; const l = Math.hypot(x, y, z) || 1; b.set([x / l, y / l, z / l], i * 3); } nm.setArray(b); }
      }
      n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pts[i + k]); max[k] = Math.max(max[k], pts[i + k]); }
    const ext = max.map((v, k) => v - min[k]);
    const longAxis = ext.indexOf(Math.max(...ext));
    const others = [0, 1, 2].filter((k) => k !== longAxis).sort((a, b) => ext[b] - ext[a]);
    // New axes: Y = long, Z = the wider of the other two for a bow (its curve), X = the rest.
    // Blades and heads: the width measured on the upper part only (guards and tassels would mislead), edge along Z.
    let wide = others[0];
    if (w.kind !== 'bow') {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      const from = args[`flip_${id}`] ? min[longAxis] : min[longAxis] + 0.55 * ext[longAxis], to = args[`flip_${id}`] ? min[longAxis] + 0.45 * ext[longAxis] : max[longAxis];
      for (let i = 0; i < pts.length; i += 3) if (pts[i + longAxis] >= from && pts[i + longAxis] <= to) for (const k of others) { lo[k] = Math.min(lo[k], pts[i + k]); hi[k] = Math.max(hi[k], pts[i + k]); }
      wide = hi[others[0]] - lo[others[0]] >= hi[others[1]] - lo[others[1]] ? others[0] : others[1];
    }
    const thin = others.find((k) => k !== wide);
    const axes = w.kind === 'bow' ? { x: thin, y: longAxis, z: wide } : { x: wide, y: longAxis, z: thin }; // blade width across the fist (X): from the front the flat reads, not a needle-thin edge
    const flip = args[`flip_${id}`] ? -1 : 1; // set after the review sheet if Meshy left it upside down
    const scale = w.length / ext[longAxis];
    const yGrip = flip > 0 ? min[longAxis] + w.grip * ext[longAxis] : max[longAxis] - w.grip * ext[longAxis];
    // The grip's centre across: the middle of the vertices within 4 cm of the grip height.
    const near = [0, 0, 0]; let cnt = 0;
    for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i + longAxis] - yGrip) < 0.04 / scale) { for (let k = 0; k < 3; k++) near[k] += pts[i + k]; cnt++; }
    const c = cnt ? near.map((v) => v / cnt) : max.map((v, k) => (v + min[k]) / 2);
    c[longAxis] = yGrip;
    // An odd axis permutation would turn the mesh inside out: X is mirrored back so the winding stays outward.
    const odd = ['0,1,2', '1,2,0', '2,0,1'].includes([axes.x, axes.y, axes.z].join()) ? 1 : -1;
    for (const p of prims) {
      for (const sem of ['POSITION', 'NORMAL']) {
        const acc = p.getAttribute(sem); if (!acc) continue;
        const a = acc.getArray().slice(); const v = [0, 0, 0];
        for (let i = 0; i < acc.getCount(); i++) {
          acc.getElement(i, v);
          const o = sem === 'POSITION' ? v.map((x, k) => (x - c[k]) * scale) : v;
          a.set([o[axes.x] * flip * odd, o[axes.y] * flip, o[axes.z]], i * 3);
        }
        acc.setArray(a);
      }
    }
    const mesh = doc.getRoot().listMeshes()[0];
    const have = mesh.listPrimitives()[0].getIndices().getCount() / 3;
    const tris = have > lod.tris ? simplify(doc, lod.tris, lod.s ? 1 : 0.01, lod.s ? ['Permissive'] : [], 1, mesh) : have;
    await doc.transform(
      dedup(), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 90 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness|occlusion|emissive)/, resize: [lod.other, lod.other], quality: 88 }),
      quantize({ quantizeTexcoord: 16, quantizePosition: 16 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const file = join(OUT, `weapon_${id}${lod.s}.glb`);
    await io.write(file, doc);
    levels[lod.s || '_lod0'] = { triangles: Math.round(tris), bytes: readFileSync(file).length, length: w.length, grip: w.grip };
  }
  record(join(d, 'pack'), { at: new Date().toISOString(), levels });
  await icon(id);
  log(id, 'packed', JSON.stringify(levels));
}

/** Icon: the concept keyed off its plain studio grey (sampled at the corners), laid diagonally on the screen's dark ground. */
async function icon(id) {
  const { data, info } = await sharp(join(PKG, id, 'concept.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const bg = [0, 0, 0];
  for (const [x, y] of [[4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5]]) for (let c = 0; c < 3; c++) bg[c] += data[(y * W + x) * 3 + c] / 4;
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const d = Math.hypot(data[i * 3] - bg[0], data[i * 3 + 1] - bg[1], data[i * 3 + 2] - bg[2]);
    rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = Math.max(0, Math.min(255, (d - 30) * 10));
  }
  const cut = await sharp(await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).median(3).png().toBuffer()).trim({ threshold: 1 }).png().toBuffer();
  const turned = await sharp(cut).resize(500, 500, { fit: 'inside' }).rotate(45, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp(turned).resize(500, 500, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: '#1b1a19' }).resize(512, 512).webp({ quality: 90 }).toFile(join(ICONS, `${id}.webp`));
}

const STEPS = { concept, model, pack, icon, all: async (id, w) => { await concept(id, w); await model(id, w); await pack(id, w); } };
const ids = args.id === 'all' ? Object.keys(WEAPONS) : (args.id ?? '').split(',');
let failed = 0;
await Promise.all(ids.map(async (id, i) => {
  if (!WEAPONS[id]) throw new Error(`no weapon ${id}`);
  await sleep(i * 4000);
  return STEPS[step](id, WEAPONS[id]).catch((e) => { failed++; log(id, 'FAILED', String(e).slice(0, 400)); });
}));
process.exitCode = failed ? 1 : 0;
