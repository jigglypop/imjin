// Texture atlases of the ships and of the campaign map's buildings: generate per-cell textures with the OpenAI image API
// (gpt-image), composite one atlas per faction with sharp, derive normal and roughness maps from the albedo, write
// public/textures/ships/* or, with --set=buildings, public/textures/buildings/*.
//
//   node scripts/ship-textures.mjs generate [--provider=gemini] [--set=buildings] [--faction=joseon,japan,ming] [--only=slot,slot] [--n=1] [--model=gpt-image-2] [--jobs=8]
//   node scripts/ship-textures.mjs compose  [--set=buildings] [--faction=...] [--pick=joseon/hull_plank:2,...]
//   node scripts/ship-textures.mjs patch    [--set=buildings] --faction=joseon --only=slot,slot   (recompose just those cells into the published atlas)
//   node scripts/ship-textures.mjs all      [--set=buildings] (generate then compose)
//   node scripts/ship-textures.mjs kinds    [--provider=gemini] [--kind=firstrate,...]   (per-ship atlases: the navy's
//        published atlas with the cells of src/ships/build/kindAtlas.json swapped for the ship's own images, written to
//        public/textures/ships/kinds/<kind>_*.webp; generates the missing images first)
//
// Layout, prompts and per-cell material hints live in src/ships/build/atlasLayout.json and src/ui/grand/buildingAtlas.json
// (shared with the game code). Raw API output is cached in assets-src/textures-<set>/<faction>/<slot>[__<flag>]_<n>.png
// (gitignored); existing files are skipped.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// No file cache: a patch reads the published atlas and writes it back, which Windows refuses while sharp holds it open.
sharp.cache(false);

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV_FILES = [join(ROOT, '.env'), '/Users/yeomdonghwan/Desktop/imjin/.env'];
for (const f of ENV_FILES) {
  try {
    process.loadEnvFile(f);
    break;
  } catch {
    // try the next candidate
  }
}

const [mode = 'all', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(
  rest.map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const MODEL = args.model ?? process.env.SHIP_TEX_MODEL ?? 'gpt-image-2';
const QUALITY = args.quality ?? 'high';
const N = Number(args.n ?? 1);
const JOBS = Number(args.jobs ?? 8);
/**
 * The two atlas sets. A ship is seen at every distance in a battle and gets a 2048 px set plus a 1k one for phones; the
 * campaign map's buildings are never more than a few hundred pixels across, so 1024 px is their only size, and their
 * matte material needs no roughness map. `sizes`: albedo, normal and roughness widths (0: not published) and the file
 * suffix of each published set.
 */
const SETS = {
  ships: { layout: 'src/ships/build/atlasLayout.json', cache: process.env.SHIP_TEX_CACHE ?? join(ROOT, 'assets-src', 'textures-ships'), out: 'ships', sizes: [[2048, 1024, 512, ''], [1024, 512, 256, '_1k']] },
  buildings: { layout: 'src/ui/grand/buildingAtlas.json', cache: join(ROOT, 'assets-src', 'textures-buildings'), out: 'buildings', sizes: [[1024, 512, 0, '']] },
};
const SET = SETS[args.set ?? 'ships'];
if (!SET) throw new Error(`no texture set ${args.set} (ships, buildings)`);
const CACHE = SET.cache;
const OUT = join(ROOT, 'public', 'textures', SET.out);
const layout = JSON.parse(await readFile(join(ROOT, SET.layout), 'utf8'));
const factions = (args.faction ?? Object.keys(layout.factions).join(',')).split(',');
let only = args.only ? new Set(args.only.split(',')) : null;
const picks = Object.fromEntries((args.pick ?? '').split(',').filter(Boolean).map((p) => p.split(':')));

const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KINDS = JSON.parse(await readFile(join(ROOT, 'src/ships/build/kindAtlas.json'), 'utf8')).kinds;
const kindList = (args.kind ?? Object.keys(KINDS).join(',')).split(',');
/** What every swapped cell must obey: a tile repeats every few metres up and along the hull, a stern fills its quad. */
const KIND_SUFFIX = {
  tile: 'The same even paint and wear over the whole image: no band, stripe or patch of another colour across it, no copper, no waterline, nothing that would show as a repeating stripe when tiled.',
  stern_panel: 'The carved and painted stern face cropped tight so it fills the frame completely to all four edges: no sky, no background, no sea, no outline of the hull, no rudder, symmetric left to right.',
};
/** Raw images that stand in for a navy's own while composing a ship's atlas: cell id to file. */
let rawOverride = null;

/** Tasks: one image per tile or flag. Sheets expand into one task per flag. In kinds mode, one per swapped cell of each ship. */
function tasks() {
  const list = [];
  if (mode === 'kinds') {
    for (const kind of kindList) {
      for (const [slot, prompt] of Object.entries(KINDS[kind].slots)) {
        for (let n = 1; n <= N; n += 1) list.push({ faction: kind, id: slot, size: '1024x1024', prompt: `${prompt} ${KIND_SUFFIX[slot] ?? KIND_SUFFIX.tile}`, n, file: join(CACHE, 'kinds', kind, `${slot}_${n}.png`) });
      }
    }
    return list;
  }
  for (const faction of factions) {
    for (const slot of layout.factions[faction]) {
      if (only && !only.has(slot.name)) continue;
      const items = slot.sheet ? slot.flags.map((f) => ({ id: `${slot.name}__${f.name}`, size: f.size, prompt: f.prompt })) : [{ id: slot.name, size: '1024x1024', prompt: slot.prompt }];
      for (const it of items) for (let n = 1; n <= N; n += 1) list.push({ faction, ...it, n, file: join(CACHE, faction, `${it.id}_${n}.png`) });
    }
  }
  return list;
}

const PROVIDER = args.provider ?? 'openai';

async function generate(task) {
  const prompt = `${task.prompt} ${layout.style}`;
  if (PROVIDER === 'gemini') {
    // Gemini's image model (scripts/gemini-image.mjs) for when the OpenAI images API is out of reach; the ratio follows the slot's size.
    const { geminiImage } = await import('./gemini-image.mjs');
    const [w, h] = (task.size ?? '1024x1024').split('x').map(Number);
    const aspect = w === h ? '1:1' : w > h ? '3:2' : '2:3';
    await mkdir(join(task.file, '..'), { recursive: true });
    await writeFile(task.file, await geminiImage(prompt, { aspect }));
    return;
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: task.size, quality: QUALITY, n: 1 }),
    });
    if (res.ok) {
      const json = await res.json();
      await mkdir(join(task.file, '..'), { recursive: true });
      await writeFile(task.file, Buffer.from(json.data[0].b64_json, 'base64'));
      return;
    }
    const text = await res.text();
    if (res.status < 500 && res.status !== 429) throw new Error(`${task.faction}/${task.id}: HTTP ${res.status} ${text.slice(0, 300)}`);
    console.log(`retry ${task.faction}/${task.id} (${res.status})`);
    await sleep(8000 * attempt);
  }
  throw new Error(`${task.faction}/${task.id}: gave up`);
}

async function runGenerate() {
  if (PROVIDER !== 'gemini' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
  const todo = [];
  for (const t of tasks()) if (!(await exists(t.file))) todo.push(t);
  console.log(`${todo.length} images to generate with ${MODEL} (${QUALITY}), ${JOBS} at a time`);
  let next = 0;
  let done = 0;
  const failures = [];
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++];
      const started = Date.now();
      try {
        await generate(t);
        done += 1;
        console.log(`[${done}/${todo.length}] ${t.faction}/${t.id}_${t.n} ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (err) {
        failures.push(String(err));
        console.error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  if (failures.length) {
    console.error(`${failures.length} failed`);
    process.exitCode = 1;
  }
}

// ---------- compose ----------

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Make a square RGB tile wrap by cross-fading each edge with the half-shifted copy of the image. */
function makeSeamless(buf, size) {
  const out = Buffer.from(buf);
  const ramp = 0.14;
  const w = (i) => smooth(0, ramp, Math.min(i, size - 1 - i) / size);
  const tmp = Buffer.alloc(buf.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const wx = w(x);
      const sx = (x + (size >> 1)) % size;
      for (let c = 0; c < 3; c += 1) tmp[(y * size + x) * 3 + c] = buf[(y * size + sx) * 3 + c] * (1 - wx) + buf[(y * size + x) * 3 + c] * wx;
    }
  }
  for (let y = 0; y < size; y += 1) {
    const wy = w(y);
    const sy = (y + (size >> 1)) % size;
    for (let x = 0; x < size; x += 1) {
      for (let c = 0; c < 3; c += 1) out[(y * size + x) * 3 + c] = tmp[(sy * size + x) * 3 + c] * (1 - wy) + tmp[(y * size + x) * 3 + c] * wy;
    }
  }
  return out;
}

const lumOf = (buf, i) => (buf[i * 3] * 0.2126 + buf[i * 3 + 1] * 0.7152 + buf[i * 3 + 2] * 0.0722) / 255;

/** Normal (tangent space, +Y up in the image) and roughness derived from albedo luminance. wrap: sample across the tile edge. */
function deriveMaps(rgb, size, bump, rough, wrap) {
  const lum = new Float32Array(size * size);
  for (let i = 0; i < lum.length; i += 1) lum[i] = lumOf(rgb, i);
  const blur = new Float32Array(lum.length);
  const at = (a, x, y) => {
    if (wrap) return a[((y + size) % size) * size + ((x + size) % size)];
    return a[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      blur[y * size + x] = (at(lum, x - 1, y) + at(lum, x + 1, y) + at(lum, x, y - 1) + at(lum, x, y + 1) + at(lum, x, y) * 4) / 8;
    }
  }
  const normal = Buffer.alloc(size * size * 3);
  const rg = Buffer.alloc(size * size * 3);
  const k = bump * 2.2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = (at(blur, x + 1, y - 1) + 2 * at(blur, x + 1, y) + at(blur, x + 1, y + 1) - at(blur, x - 1, y - 1) - 2 * at(blur, x - 1, y) - at(blur, x - 1, y + 1)) / 8;
      const gy = (at(blur, x - 1, y + 1) + 2 * at(blur, x, y + 1) + at(blur, x + 1, y + 1) - at(blur, x - 1, y - 1) - 2 * at(blur, x, y - 1) - at(blur, x + 1, y - 1)) / 8;
      let nx = -gx * k * 4;
      let ny = gy * k * 4;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv;
      ny *= inv;
      const nz = inv;
      const o = (y * size + x) * 3;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      const r = Math.min(1, Math.max(0.12, rough + (0.5 - lum[y * size + x]) * 0.35));
      rg[o] = rg[o + 1] = rg[o + 2] = Math.round(r * 255);
    }
  }
  return { normal, rough: rg };
}

/** Put a size x size tile in the middle of a cell with a gutter: wrapped copy for tiles, edge clamp otherwise. */
function padCell(tile, size, cell, pad, wrap) {
  const out = Buffer.alloc(cell * cell * 3);
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      let sx = x - pad;
      let sy = y - pad;
      if (wrap) {
        sx = ((sx % size) + size) % size;
        sy = ((sy % size) + size) % size;
      } else {
        sx = Math.min(size - 1, Math.max(0, sx));
        sy = Math.min(size - 1, Math.max(0, sy));
      }
      const si = (sy * size + sx) * 3;
      const di = (y * cell + x) * 3;
      out[di] = tile[si];
      out[di + 1] = tile[si + 1];
      out[di + 2] = tile[si + 2];
    }
  }
  return out;
}

async function loadRaw(faction, id, pickKey) {
  const n = picks[pickKey] ?? '1';
  const file = rawOverride?.[id] ?? join(CACHE, faction, `${id}_${n}.png`);
  if (!(await exists(file))) throw new Error(`missing ${file}`);
  return file;
}

const rgbBuffer = (img) => img.removeAlpha().raw().toBuffer();

async function composeCell(faction, slot, cell, pad) {
  const size = cell - pad * 2;
  if (slot.sheet) {
    const { cols, rows } = slot.sheet;
    const sw = Math.floor(size / cols);
    const sh = Math.floor(size / rows);
    const sheet = await sharp({ create: { width: size, height: size, channels: 3, background: '#808080' } })
      .composite(
        await Promise.all(
          slot.flags.map(async (f, i) => {
            const file = await loadRaw(faction, `${slot.name}__${f.name}`, `${faction}/${slot.name}__${f.name}`);
            const input = await sharp(file).resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().png().toBuffer();
            return { input, left: (i % cols) * sw, top: Math.floor(i / cols) * sh };
          }),
        ),
      )
      .removeAlpha()
      .raw()
      .toBuffer();
    return { sheet, size, wrap: false };
  }
  const file = await loadRaw(faction, slot.name, `${faction}/${slot.name}`);
  // Grain (and plank rows) must run along the image's horizontal axis, which is the u axis of beams and boards in the game.
  let src = slot.rot ? sharp(file).rotate(slot.rot) : sharp(file);
  if (rawOverride && slot.name === 'stern_panel') {
    // A ship's own stern: trim the margins where the image model leaves a strip of background around the carving.
    const { width, height } = await sharp(file).metadata();
    src = sharp(await sharp(file).extract({ left: Math.round(width * 0.07), top: Math.round(height * 0.06), width: Math.round(width * 0.86), height: Math.round(height * 0.9) }).toBuffer());
  }
  if (slot.modulate) src = src.modulate(slot.modulate);
  let big = await rgbBuffer(src.resize(1024, 1024, { fit: 'fill' }));
  if (slot.tile) big = makeSeamless(big, 1024);
  const rgb = await sharp(big, { raw: { width: 1024, height: 1024, channels: 3 } }).resize(size, size, { kernel: 'lanczos3' }).raw().toBuffer();
  return { sheet: rgb, size, wrap: !!slot.tile };
}

async function writeWebp(raw, width, file, opts) {
  await sharp(raw, { raw: { width, height: width, channels: 3 } }).webp(opts).toFile(file);
}

/** The published atlas of a faction as full-size raw planes, so single cells can be swapped without the other raw images. */
async function loadPublished(faction, dim) {
  const plane = (kind) => sharp(join(OUT, `${faction}_${kind}.webp`)).resize(dim, dim, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const published = SET.sizes[0][2] > 0;
  return { albedo: await plane('albedo'), normal: await plane('normal'), rough: published ? await plane('rough') : Buffer.alloc(dim * dim * 3) };
}

async function compose(faction, patch = false, name = faction) {
  const { grid, cell, pad } = layout;
  const dim = grid * cell;
  const slots = layout.factions[faction];
  const { albedo, normal, rough } = patch
    ? await loadPublished(faction, dim)
    : { albedo: Buffer.alloc(dim * dim * 3), normal: Buffer.alloc(dim * dim * 3), rough: Buffer.alloc(dim * dim * 3) };
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (patch && !only?.has(slot.name)) continue;
    const cx = i % grid;
    const cy = Math.floor(i / grid);
    const { sheet, size, wrap } = await composeCell(faction, slot, cell, pad);
    const maps = deriveMaps(sheet, size, slot.bump ?? 1.5, slot.rough ?? 0.8, wrap);
    const planes = [
      [albedo, sheet],
      [normal, maps.normal],
      [rough, maps.rough],
    ];
    for (const [dst, src] of planes) {
      const padded = padCell(src, size, cell, pad, wrap);
      for (let y = 0; y < cell; y += 1) padded.copy(dst, ((cy * cell + y) * dim + cx * cell) * 3, y * cell * 3, (y + 1) * cell * 3);
    }
    console.log(`${faction} cell ${i} ${slot.name}`);
  }
  await mkdir(OUT, { recursive: true });
  // Payload budget: albedo carries the detail; normal and roughness are smooth and survive at lower resolution.
  const resized = (buf, w) => (w === dim ? buf : sharp(buf, { raw: { width: dim, height: dim, channels: 3 } }).resize(w, w, { kernel: 'lanczos3' }).raw().toBuffer());
  const outputs = SET.sizes.flatMap(([a, n, r, sfx]) => [
    ['albedo', albedo, a, a > 1024 ? 74 : 72, sfx],
    ['normal', normal, n, n > 512 ? 70 : 66, sfx],
    ['rough', rough, r, r > 256 ? 55 : 50, sfx],
  ]).filter(([, , w]) => w > 0);
  for (const [kind, buf, w, quality, sfx] of outputs) await writeWebp(await resized(buf, w), w, join(OUT, `${name}_${kind}${sfx}.webp`), { quality });
  // Contact sheet for review.
  await sharp(albedo, { raw: { width: dim, height: dim, channels: 3 } })
    .resize(1024, 1024)
    .jpeg({ quality: 85 })
    .toFile(join(CACHE, `${name.replace('/', '_')}_atlas_preview.jpg`));
}

if (mode === 'generate' || mode === 'all' || mode === 'patch' || mode === 'kinds') await runGenerate();
if (mode === 'kinds') {
  await mkdir(join(OUT, 'kinds'), { recursive: true });
  for (const kind of kindList) {
    const slots = Object.keys(KINDS[kind].slots);
    rawOverride = Object.fromEntries(slots.map((s) => [s, join(CACHE, 'kinds', kind, `${s}_${picks[`${kind}/${s}`] ?? '1'}.png`)]));
    only = new Set(slots);
    await compose(KINDS[kind].faction, true, `kinds/${kind}`);
  }
}
if (mode === 'compose' || mode === 'all') {
  for (const f of factions) await compose(f);
}
if (mode === 'patch') {
  if (!only) throw new Error('patch needs --only=slot,slot');
  for (const f of factions) await compose(f, true);
}
