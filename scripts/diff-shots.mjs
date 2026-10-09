// Compares two screenshots of the same view: mean absolute difference per channel and the share of pixels that differ
// by more than 12/255, and writes an amplified difference image.
//   node scripts/diff-shots.mjs <before.png> <after.png> [diff.png]
import sharp from 'sharp';
const [a, b, out] = process.argv.slice(2);
const left = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const right = await sharp(b).removeAlpha().resize(left.info.width, left.info.height).raw().toBuffer({ resolveWithObject: true });
const n = left.data.length;
const diff = Buffer.alloc(n);
let sum = 0;
let big = 0;
for (let i = 0; i < n; i += 3) {
  let px = 0;
  for (let c = 0; c < 3; c += 1) {
    const d = Math.abs(left.data[i + c] - right.data[i + c]);
    sum += d;
    px = Math.max(px, d);
    diff[i + c] = Math.min(255, d * 6);
  }
  if (px > 12) big += 1;
}
console.log(`mean abs diff ${(sum / n).toFixed(2)}/255, ${((big / (n / 3)) * 100).toFixed(2)}% of pixels differ by more than 12`);
if (out) await sharp(diff, { raw: { width: left.info.width, height: left.info.height, channels: 3 } }).png().toFile(out);
