import { chromium } from 'playwright-core';

const url = process.argv[2];
const code = process.argv[3];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => logs.push('timeout'));
await page.waitForTimeout(2000);
const result = await page.evaluate(code).catch((e) => `EVAL ERROR: ${e.message}`);
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
console.log(logs.filter((l) => !l.includes('Clock') && !l.includes('powerPreference')).slice(-15).join('\n'));
await browser.close();
