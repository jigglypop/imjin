import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5291/?scenario=busan');
for (const [i, t] of [1200, 2600, 4200].entries()) {
  await page.waitForTimeout(i === 0 ? t : t - [1200, 2600, 4200][i - 1]);
  await page.screenshot({ path: `shots/loading_${i}.png` });
}
await browser.close();
