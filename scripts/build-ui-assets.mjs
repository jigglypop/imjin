import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'assets-src', 'concepts');
const OUT = join(ROOT, 'public', 'ui');

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function jpg(src, out, width, height, quality = 84) {
  await sharp(join(SRC, src)).resize(width, height, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toFile(join(OUT, out));
}

async function webp(src, out, width, height, quality = 82) {
  await sharp(join(SRC, src)).resize(width, height, { fit: 'cover' }).webp({ quality }).toFile(join(OUT, out));
}

async function lumaMask(src, out, width) {
  const { data, info } = await sharp(join(SRC, src)).resize(width).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i += 1) {
    const v = data[i];
    const a = Math.max(0, Math.min(255, Math.round((v - 18) * 1.25)));
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = a;
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(OUT, out));
}

async function emblem(src, out, size) {
  const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="#fff"/></svg>`);
  await sharp(join(SRC, src))
    .resize(Math.round(size * 1.12), Math.round(size * 1.12), { fit: 'cover' })
    .extract({ left: Math.round(size * 0.06), top: Math.round(size * 0.06), width: size, height: size })
    .composite([{ input: circle, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, out));
}

async function figure(src, out, height) {
  const { data, info } = await sharp(join(SRC, src)).resize({ height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const border = [];
  for (let x = 0; x < w; x += 4) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 4) border.push(y * w, y * w + w - 1);
  const median = (c) => border.map((i) => data[i * 4 + c]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [median(0), median(1), median(2)];
  const paperLike = (i) => {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const diff = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    return (r + g + b) / 3 > 170 && diff < 80;
  };
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x += 1) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 1) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || !paperLike(i)) continue;
    outside[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < w * h; i += 1) {
    if (!outside[i]) continue;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const diff = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    data[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (diff - 30) / 50)));
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(join(OUT, out));
}

await ensure(OUT);
for (const d of ['figures', 'portraits', 'cards', 'emblems']) await ensure(join(OUT, d));

await jpg('hanji_texture_1.jpg', 'hanji.jpg', 1024, 1024, 82);
await jpg('hanji_texture_2.jpg', 'hanji_fiber.jpg', 1024, 1024, 82);
await jpg('ink_wash_texture_2.jpg', 'ink_wash.jpg', 1024, 1024, 82);
await jpg('ink_wash_texture_1.jpg', 'ink_cloud.jpg', 1024, 1024, 80);
await jpg('map_south_coast_1.jpg', 'map.jpg', 2048, 1152, 86);
await lumaMask('ink_banner_1.jpg', 'brush_banner.png', 1400);
await lumaMask('ink_banner_2.jpg', 'brush_banner2.png', 1400);
await lumaMask('ink_frame_1.jpg', 'brush_frame.png', 1200);
await emblem('emblem_joseon_1.jpg', 'emblems/joseon.png', 256);
await emblem('emblem_japan_1.jpg', 'emblems/japan.png', 256);

const PORTRAITS = [
  ['portrait_yi2_2', 'portrait_yi'],
  ['portrait_admiral2_1', 'portrait_admiral'],
  ['portrait_japan2_1', 'portrait_japan'],
  ['portrait_won_2', 'portrait_won'],
  ['portrait_eokgi_1', 'portrait_eokgi'],
  ['portrait_jeongun_1', 'portrait_jeongun'],
  ['portrait_eo_1', 'portrait_eo'],
  ['portrait_kwon_2', 'portrait_kwon'],
  ['portrait_anwi_1', 'portrait_anwi'],
  ['portrait_wakisaka_1', 'portrait_wakisaka'],
  ['portrait_todo_2', 'portrait_todo'],
  ['portrait_kuki_1', 'portrait_kuki'],
  ['portrait_kato_2', 'portrait_kato'],
  ['portrait_kurushima_1', 'portrait_kurushima'],
  ['portrait_shimazu_1', 'portrait_shimazu'],
  ['portrait_konishi_2', 'portrait_konishi'],
  ['portrait_chenlin_1', 'portrait_chenlin'],
  ['portrait_deng_1', 'portrait_deng'],
];
for (const [src, name] of PORTRAITS) {
  await jpg(`${src}.jpg`, `portraits/${name}.jpg`, 384, 384, 86);
}
for (const name of ['card_panokseon_1', 'card_geobukseon_2', 'card_atakebune_2', 'card_sekibune_1']) {
  await jpg(`${name}.jpg`, `cards/${name.replace(/_\d$/, '')}.jpg`, 240, 320, 82);
}
await figure('fig_yi2_1.jpg', 'figures/fig_yi.webp', 1100);
for (const name of ['fig_won', 'fig_chenlin', 'fig_wakisaka', 'fig_todo', 'fig_kuki', 'fig_kurushima', 'fig_shimazu', 'fig_japan']) {
  await figure(`${name}_1.jpg`, `figures/${name}.webp`, 900);
}
console.log('ui assets built');
