// What a battle leaves behind in the JS heap (Chrome CDP heap snapshots, WebGL2 path with the phone tier so it matches the
// WebKit probe): a snapshot after the first battle and after each further one, the objects by constructor that grew between
// the last two snapshots, and the heap size after a forced GC. Then the objects that were born during battle --born (the
// second by default) and are still in the last snapshot are listed by size with their shortest path from the GC root:
// that path is what keeps a finished battle alive. --min=<bytes> (default 200000) picks native buffers by size,
// --label=<constructor> picks objects by name instead, --paths=<n> how many, --retainers=<constructor> lists holders,
// --big prints every native buffer over 1 MB of the last snapshot.
//   node scripts/probe-heap.mjs [url] [--then=hansan,hansan,hansan] [--top=25] [--born=1] [--min=] [--label=] [--paths=12]
import { chromium } from 'playwright-core';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = positional[0] ?? 'http://127.0.0.1:5351/?scenario=hansan&webgl=1&q=low';
const then = (flags.then ?? 'hansan,hansan,hansan').split(',');
const top = Number(flags.top ?? 25);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 659 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

async function snapshot() {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const on = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  const snap = JSON.parse(chunks.join(''));
  const { node_fields: nf, node_types: nt } = snap.snapshot.meta;
  const n = nf.length;
  const typeOf = nt[0];
  const rows = new Map();
  let total = 0;
  for (let i = 0; i < snap.nodes.length; i += n) {
    const type = typeOf[snap.nodes[i]];
    const name = snap.strings[snap.nodes[i + 1]];
    const size = snap.nodes[i + 3];
    total += size;
    const key = type === 'string' || type === 'concatenated string' || type === 'sliced string' ? 'string' : type === 'object' || type === 'native' || type === 'closure' ? `${type} ${name}` : type === 'array' ? `array ${name}` : type;
    const r = rows.get(key) ?? { count: 0, size: 0 };
    r.count += 1;
    r.size += size;
    rows.set(key, r);
  }
  const ids = new Set();
  for (let i = 0; i < snap.nodes.length; i += n) ids.add(snap.nodes[i + 2]);
  return { rows, total, snap, ids };
}
const info = async () => page.evaluate(() => {
  const e = window.__engine;
  const m = e.renderer.info.memory;
  return { geometries: m.geometries, textures: m.textures, programs: m.programs, gpuMB: Math.round(m.total / 1e6), sceneChildren: e.scene.children.length, domNodes: document.getElementsByTagName('*').length };
});
const snaps = [];
const take = async (label) => {
  const s = await snapshot();
  snaps.push(s);
  if (snaps.length > 2) delete snaps[snaps.length - 2].snap;
  console.log(label, `heap ${(s.total / 1048576).toFixed(1)} MB`, JSON.stringify(await info()));
};
await page.waitForTimeout(2000);
await take('battle 1');
for (const id of then) {
  await page.evaluate((scenario) => { void window.__engine.setScenario(scenario); }, id);
  await page.waitForFunction(() => window.__engine.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await take(`battle ${snaps.length + 1} ${id}`);
}
const a = snaps[snaps.length - 2];
const b = snaps[snaps.length - 1];
const diff = [];
for (const [k, r] of b.rows) {
  const p = a.rows.get(k) ?? { count: 0, size: 0 };
  if (r.size - p.size > 20000 || r.count - p.count > 200) diff.push({ k, dc: r.count - p.count, ds: r.size - p.size, size: r.size });
}
diff.sort((x, y) => y.ds - x.ds);
console.log(`growth of the last battle over the one before (top ${top}):`);
for (const d of diff.slice(0, top)) console.log(`${(d.ds / 1024).toFixed(0).padStart(8)} KB ${String(d.dc).padStart(7)} objs  (now ${(d.size / 1024).toFixed(0)} KB) ${d.k}`);

// Where the new big buffers hang: nodes of the last snapshot that the one before did not have, with the shortest path from the GC root.
const paths = async () => {
  const { snap } = b;
  // Objects born during battle `born` (default the second) that the last snapshot still holds: what a finished battle left behind.
  const born = Number(flags.born ?? 1);
  const nf = snap.snapshot.meta.node_fields.length;
  const ef = snap.snapshot.meta.edge_fields.length;
  const nodeTypes = snap.snapshot.meta.node_types[0];
  const edgeTypes = snap.snapshot.meta.edge_types[0];
  const count = snap.nodes.length / nf;
  const first = new Uint32Array(count + 1);
  for (let i = 0; i < count; i += 1) first[i + 1] = first[i] + snap.nodes[i * nf + 4];
  const parent = new Int32Array(count).fill(-1);
  const via = new Array(count);
  const queue = [0];
  parent[0] = 0;
  for (let q = 0; q < queue.length; q += 1) {
    const from = queue[q];
    for (let e = first[from]; e < first[from + 1]; e += 1) {
      const type = edgeTypes[snap.edges[e * ef]];
      if (type === 'weak' || type === 'shortcut') continue;
      const to = snap.edges[e * ef + 2] / nf;
      if (parent[to] !== -1) continue;
      parent[to] = from;
      via[to] = type === 'element' || type === 'hidden' ? `[${snap.edges[e * ef + 1]}]` : snap.strings[snap.edges[e * ef + 1]];
      queue.push(to);
    }
  }
  const label = (i) => `${snap.strings[snap.nodes[i * nf + 1]]}`.slice(0, 40);
  const fresh = [];
  for (let i = 0; i < count; i += 1) {
    const id = snap.nodes[i * nf + 2];
    if (!snaps[born].ids.has(id) || snaps[born - 1].ids.has(id)) continue;
    const size = snap.nodes[i * nf + 3];
    if (flags.label ? label(i) === flags.label : size >= Number(flags.min ?? 200000) && nodeTypes[snap.nodes[i * nf]] === 'native') fresh.push({ i, size });
  }
  if (flags.retainers) {
    // Every holder of the objects named --retainers (a constructor), with the holders' own holders one level up.
    const into = new Map();
    for (let from = 0; from < count; from += 1) {
      for (let e = first[from]; e < first[from + 1]; e += 1) {
        const type = edgeTypes[snap.edges[e * ef]];
        if (type === 'weak') continue;
        const to = snap.edges[e * ef + 2] / nf;
        if (!into.has(to)) into.set(to, []);
        into.get(to).push({ from, name: type === 'element' || type === 'hidden' ? `[${snap.edges[e * ef + 1]}]` : snap.strings[snap.edges[e * ef + 1]] });
      }
    }
    for (let i = 0; i < count; i += 1) {
      const id = snap.nodes[i * nf + 2];
      if (!snaps[born].ids.has(id) || snaps[born - 1].ids.has(id) || label(i) !== flags.retainers) continue;
      console.log(`${label(i)} @${id}`);
      for (const r of into.get(i) ?? []) console.log(`   <- ${r.name} of ${label(r.from)} ${nodeTypes[snap.nodes[r.from * nf]]}`);
    }
  }
  if (flags.dump) {
    // Out edges, two levels deep, of every new object whose path (shortest from the root) contains a node labelled --dump.
    const show = (i, depth, indent) => {
      for (let e = first[i]; e < first[i + 1]; e += 1) {
        const type = edgeTypes[snap.edges[e * ef]];
        if (type === 'weak') continue;
        const to = snap.edges[e * ef + 2] / nf;
        const name = type === 'element' || type === 'hidden' ? `[${snap.edges[e * ef + 1]}]` : snap.strings[snap.edges[e * ef + 1]];
        const tt = nodeTypes[snap.nodes[to * nf]];
        console.log(`${indent}${name}: ${tt === 'string' ? JSON.stringify(label(to)) : tt === 'number' ? 'num' : label(to)}`);
        if (depth > 0 && (tt === 'object' || tt === 'array') && !['_value', 'texture', 'textureNode', 'source', 'data'].includes(name)) show(to, depth - 1, indent + '  ');
      }
    };
    for (let i = 0; i < count; i += 1) {
      const id = snap.nodes[i * nf + 2];
      if (!snaps[born].ids.has(id) || snaps[born - 1].ids.has(id) || label(i) !== 'NodeSampledTexture') continue;
      let holdsHeight = false;
      for (let e = first[i]; e < first[i + 1]; e += 1) {
        const to = snap.edges[e * ef + 2] / nf;
        if (snap.strings[snap.edges[e * ef + 1]] === 'textureNode') {
          for (let e2 = first[to]; e2 < first[to + 1]; e2 += 1) {
            const t2 = snap.edges[e2 * ef + 2] / nf;
            if (snap.strings[snap.edges[e2 * ef + 1]] === '_value' && label(t2) === 'DataTexture') holdsHeight = true;
          }
        }
      }
      if (holdsHeight) { console.log('NodeSampledTexture holding a big texture'); show(i, 1, '  '); }
    }
  }
  if (flags.big) {
    const sizes = {};
    for (let i = 0; i < count; i += 1) if (nodeTypes[snap.nodes[i * nf]] === 'native' && snap.nodes[i * nf + 3] >= 1000000) sizes[`${Math.round(snap.nodes[i * nf + 3] / 1024)}KB ${label(i)}`] = (sizes[`${Math.round(snap.nodes[i * nf + 3] / 1024)}KB ${label(i)}`] ?? 0) + 1;
    console.log('buffers over 1 MB in the last snapshot:', JSON.stringify(sizes));
  }
  fresh.sort((x, y) => y.size - x.size);
  for (const { i, size } of fresh.slice(0, Number(flags.paths ?? 12))) {
    const chain = [];
    for (let n = i, depth = 0; n !== 0 && depth < 14; n = parent[n], depth += 1) chain.push(`${via[n]}(${label(n)})`);
    console.log(`${(size / 1024).toFixed(0)} KB new: ${chain.reverse().join(' > ')}`);
  }
};
await paths();
await browser.close();
