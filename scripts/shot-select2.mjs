// Screenshots the battle select screen, optionally after clicking a mode tab by its label.
import { chromium } from 'playwright-core';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(args.url ?? 'http://127.0.0.1:5291/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.select-top', { timeout: 60000 });
await page.waitForTimeout(6000);
if (args.tab) await page.click(`.mode-switch button:nth-child(${args.tab})`);
if (args.side) await page.click(`.side-btn:nth-child(${args.side})`);
await page.waitForTimeout(1500);
await page.screenshot({ path: args.out ?? 'shots/select.png' });
console.log('ok', errors.slice(-5));
await browser.close();
