// Builds the smaller sky files phones and tablets load: every public/hdri/*_4k.hdr gets a *_2k.hdr (and *_1k.hdr with --sizes=2k,1k)
// by a 2x2 box filter in linear light, written as run-length encoded RGBE. A 4k file is about 19 MB and parses into a 67 MB
// half-float array. A phone screen is about 400 CSS px wide, so the 2k file (about 5 MB, 17 MB parsed) shows the same sky.
//   node scripts/build-hdri.mjs [--sizes=2k] [--dir=public/hdri]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const dir = join(ROOT, args.dir ?? 'public/hdri');
const sizes = (args.sizes ?? '2k').split(',');
const DIV = { '2k': 2, '1k': 4 };

/** Reads a Radiance .hdr (flat or run-length encoded scanlines) into linear float RGB. */
function parseHdr(buf) {
  let pos = 0;
  const line = () => {
    let s = '';
    while (pos < buf.length && buf[pos] !== 10) s += String.fromCharCode(buf[pos++]);
    pos += 1;
    return s;
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance file');
  while (line() !== '') { /* header lines up to the blank one */ }
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!m) throw new Error('unsupported resolution line');
  const height = Number(m[1]);
  const width = Number(m[2]);
  const rgbe = new Uint8Array(width * 4);
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    if (buf[pos] === 2 && buf[pos + 1] === 2 && ((buf[pos + 2] << 8) | buf[pos + 3]) === width) {
      pos += 4;
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        while (x < width) {
          let n = buf[pos++];
          if (n > 128) {
            n -= 128;
            const v = buf[pos++];
            while (n-- > 0) rgbe[(x++) * 4 + c] = v;
          } else {
            while (n-- > 0) rgbe[(x++) * 4 + c] = buf[pos++];
          }
        }
      }
    } else {
      for (let x = 0; x < width * 4; x += 1) rgbe[x] = buf[pos++];
    }
    for (let x = 0; x < width; x += 1) {
      const e = rgbe[x * 4 + 3];
      const k = e === 0 ? 0 : Math.pow(2, e - 136);
      const o = (y * width + x) * 3;
      out[o] = rgbe[x * 4] * k;
      out[o + 1] = rgbe[x * 4 + 1] * k;
      out[o + 2] = rgbe[x * 4 + 2] * k;
    }
  }
  return { width, height, data: out };
}

function boxDown(img, factor) {
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const out = new Float32Array(w * h * 3);
  const inv = 1 / (factor * factor);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = y * factor; sy < (y + 1) * factor; sy += 1) {
        for (let sx = x * factor; sx < (x + 1) * factor; sx += 1) {
          const i = (sy * img.width + sx) * 3;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r * inv;
      out[o + 1] = g * inv;
      out[o + 2] = b * inv;
    }
  }
  return { width: w, height: h, data: out };
}

function encodeRle(channel, width, out) {
  let x = 0;
  while (x < width) {
    let run = 1;
    while (x + run < width && run < 127 && channel[x + run] === channel[x]) run += 1;
    if (run >= 4) {
      out.push(128 + run, channel[x]);
      x += run;
      continue;
    }
    // Literal stretch: stop where a run of four or more starts.
    let n = 0;
    while (x + n < width && n < 128) {
      let r = 1;
      while (x + n + r < width && r < 4 && channel[x + n + r] === channel[x + n]) r += 1;
      if (r >= 4) break;
      n += 1;
    }
    if (n === 0) n = 1;
    out.push(n);
    for (let i = 0; i < n; i += 1) out.push(channel[x + i]);
    x += n;
  }
}

function writeHdr(img) {
  const { width, height, data } = img;
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1');
  const bytes = [];
  const ch = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const m = Math.max(r, g, b);
      if (m < 1e-32) {
        ch[0][x] = ch[1][x] = ch[2][x] = ch[3][x] = 0;
        continue;
      }
      const e = Math.ceil(Math.log2(m) + 1e-9);
      const scale = 256 / Math.pow(2, e);
      ch[0][x] = Math.min(255, Math.round(r * scale));
      ch[1][x] = Math.min(255, Math.round(g * scale));
      ch[2][x] = Math.min(255, Math.round(b * scale));
      ch[3][x] = e + 128;
    }
    bytes.push(2, 2, width >> 8, width & 255);
    for (let c = 0; c < 4; c += 1) encodeRle(ch[c], width, bytes);
  }
  return Buffer.concat([head, Buffer.from(bytes)]);
}

const files = (await readdir(dir)).filter((f) => f.endsWith('_4k.hdr'));
for (const f of files) {
  const src = parseHdr(await readFile(join(dir, f)));
  for (const size of sizes) {
    const small = boxDown(src, DIV[size]);
    const name = f.replace('_4k.hdr', `_${size}.hdr`);
    const buf = writeHdr(small);
    await writeFile(join(dir, name), buf);
    console.log(`${name}: ${small.width}x${small.height}, ${(buf.length / 1e6).toFixed(1)} MB`);
  }
}
