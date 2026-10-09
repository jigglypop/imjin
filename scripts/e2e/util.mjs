// Shared helpers for the e2e suite: argument parsing, browser launch, page sessions with error collection.
import { chromium, webkit, devices } from 'playwright-core';

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.join('=') || 'true'];
    }),
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rejects when `promise` takes longer than `ms`, so one hung check cannot stall the whole suite. */
export function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Lazily launches and caches one browser per engine, so --only runs never start browsers they do not use. */
export class Browsers {
  constructor(args) {
    this.args = args;
    this.open = new Map();
  }

  async get(kind) {
    if (this.open.has(kind)) return this.open.get(kind);
    const launching = this.launch(kind);
    this.open.set(kind, launching);
    try {
      return await launching;
    } catch (e) {
      this.open.delete(kind);
      throw e;
    }
  }

  async launch(kind) {
    const headless = this.args.headed !== 'true';
    if (kind === 'chrome') {
      const win = process.platform === 'win32';
      return chromium.launch({
        channel: this.args.channel ?? (win ? 'msedge' : 'chrome'),
        headless,
        args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', win ? '--use-angle=d3d11' : '--use-angle=metal'],
      });
    }
    return webkit.launch({ headless });
  }

  async closeAll() {
    for (const p of this.open.values()) {
      try {
        await (await p).close();
      } catch {
        // already gone
      }
    }
    this.open.clear();
  }
}

export const IPHONE = 'iPhone 15 Pro';

/** Context options for a named viewport: desktop sizes for Chrome, iPhone emulation for WebKit. */
export function contextOptions(kind, viewport, orient) {
  if (kind === 'chrome') return { viewport, deviceScaleFactor: 1 };
  const base = devices[IPHONE];
  if (!base) throw new Error(`playwright has no device "${IPHONE}"`);
  // Playwright's descriptor viewport (393x659) leaves room for Safari's toolbar; the suite checks the full 393x852 screen.
  const vp = orient === 'landscape' ? { width: 852, height: 393 } : { width: 393, height: 852 };
  return { ...base, viewport: vp, screen: vp };
}

const MODULE_URL = /\.(m?[jt]sx?|css)(\?|$)|\/@(vite|react-refresh|fs|id)\/|\/node_modules\/|\/src\//;

/**
 * A page plus everything that went wrong on it: uncaught page errors, crashes, module/script requests that failed,
 * and console errors (kept as soft warnings, since the game logs recoverable problems there).
 */
export async function openPage(browsers, kind, viewport, orient, url) {
  const browser = await browsers.get(kind);
  const ctx = await browser.newContext(contextOptions(kind, viewport, orient));
  const page = await ctx.newPage();
  const problems = { pageErrors: [], crashes: [], failedModules: [], consoleErrors: [] };
  page.on('pageerror', (e) => problems.pageErrors.push(String(e.message ?? e).slice(0, 300)));
  page.on('crash', () => problems.crashes.push('page crashed'));
  page.on('requestfailed', (r) => {
    const u = r.url();
    const why = r.failure()?.errorText ?? 'failed';
    // Aborts happen when a page navigates away or a request is superseded; they are not load failures.
    if (/ABORTED|cancel/i.test(why)) return;
    if (r.resourceType() === 'script' || MODULE_URL.test(u)) problems.failedModules.push(`${why} ${u}`.slice(0, 300));
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && (r.request().resourceType() === 'script' || MODULE_URL.test(u))) problems.failedModules.push(`HTTP ${r.status()} ${u}`.slice(0, 300));
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to (fetch dynamically imported|load module script)|error loading dynamically imported module/i.test(t)) problems.failedModules.push(t.slice(0, 300));
    else problems.consoleErrors.push(t.slice(0, 200));
  });
  const t0 = Date.now();
  const close = async () => {
    await ctx.close().catch(() => {});
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    problems.pageErrors.push(`navigation: ${String(e.message).split('\n')[0]}`);
  }
  return { page, ctx, problems, close, t0 };
}

/** Fatal problems as human-readable lines; empty when the page is healthy. */
export function fatalProblems(problems) {
  const out = [];
  for (const e of problems.pageErrors) out.push(`pageerror: ${e}`);
  for (const e of problems.crashes) out.push(e);
  for (const e of problems.failedModules) out.push(`module load failed: ${e}`);
  return out;
}

/** Generic "something rendered" probe: a canvas or a non-empty React root, and no visible fatal message. */
export async function screenState(page) {
  return page
    .evaluate(() => {
      const root = document.getElementById('root') ?? document.body;
      const text = (document.body.innerText || '').trim();
      const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.clientWidth > 0 && c.clientHeight > 0);
      return {
        canvas: canvases.length,
        rootChildren: root.children.length,
        textLength: text.length,
        fatalText: /초기화 실패|Something went wrong|Uncaught|Failed to fetch dynamically/i.test(text) ? text.slice(0, 160) : null,
        scrollWidth: (document.scrollingElement ?? document.documentElement).scrollWidth,
        innerWidth: window.innerWidth,
      };
    })
    .catch((e) => ({ error: String(e) }));
}

/** Waits until a canvas or a populated root is on screen. */
export async function waitForScreen(page, timeout) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await screenState(page);
    if (!last.error && (last.canvas > 0 || (last.rootChildren > 0 && last.textLength > 0))) return last;
    await sleep(500);
  }
  return last;
}

export async function waitReady(page, timeout) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout, polling: 500 });
    return Date.now() - t0;
  } catch {
    return null;
  }
}

/** Battle liveness: renderer frame counter and the engine's own fps, sampled over `ms`. */
export async function sampleFrames(page, ms) {
  const read = () =>
    page.evaluate(() => {
      const e = window.__engine;
      return { frame: e?.renderer?.info?.render?.frame ?? null, fps: e?.fps ?? 0, raf: performance.now() };
    });
  const a = await read();
  await sleep(ms);
  const b = await read();
  const frames = a.frame != null && b.frame != null ? b.frame - a.frame : null;
  return { frames, seconds: (b.raf - a.raf) / 1000, engineFps: b.fps };
}

export async function backendOf(page) {
  return page
    .evaluate(() => {
      try {
        const b = window.__info?.().backend;
        if (b) return b;
      } catch {}
      const be = window.__engine?.renderer?.backend;
      if (be && typeof be.isWebGPUBackend === 'boolean') return be.isWebGPUBackend ? 'webgpu' : 'webgl2';
      return null;
    })
    .catch(() => null);
}
