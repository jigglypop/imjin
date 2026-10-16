// Renders the battle voices (src/audio/voices.ts) and a whole scripted battle through the game's own sound code
// (src/audio/battlefield.ts with the recorded samples) offline, and writes WAV files to listen to.
//   node scripts/render-sounds.mjs [--url=http://127.0.0.1:5291] [--out=<dir>] [--only=cannon_near,sinking,battle] [--prefix=after_]
// `--only=inventory` renders every voice alone (v_*), the music bed and UI sounds (music_*, ui_*) and the retired
// references (legacy_*), one file each, for scripts/audio/analyze.py to go through.
// Needs a running dev server: the modules are loaded through Vite, then rendered in an OfflineAudioContext in Chrome.
// `battle` writes audio2_battle.wav; the others are the synthesised voices alone.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const base = (args.url ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const out = args.out ?? join(ROOT, 'shots', 'progress');
const only = args.only ? args.only.split(',') : null;
const prefix = args.prefix ?? '';
const RATE = 44100;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
// Any page on the dev server's origin will do for importing its modules.
await page.goto(`${base}/src/audio/voices.ts`, { waitUntil: 'domcontentloaded' });

const scenes = {
  // Each gun fired alone, close: heaviest first.
  cannon_near: { secs: 17, play: `
    const shots = [['cheonja', 40, -0.25], ['jija', 60, 0.2], ['hyeonja', 70, -0.1], ['hwangja', 70, 0.15], ['seungja', 70, 0], ['folangji', 70, 0.1]];
    shots.forEach(([gun, d, pan], i) => { const s = ranged(d, pan); v.cannon(0.4 + i * 2.7 + s.delay, s, GUN_CLASS[gun], 'full'); });` },
  // The same heavy gun at growing range: crack and body fall away first, then the thump, and the shore echo comes late.
  cannon_far: { secs: 30, play: `
    [350, 700, 1200, 2000].forEach((d, i) => { const s = ranged(d, 0.3); v.cannon(0.4 + i * 6 + s.delay, s, GUN_CLASS.cheonja, d > 900 ? 'lite' : 'mid'); });` },
  // A broadside answered by a more distant one, then both together.
  broadside: { secs: 20, play: `
    const guns = ['cheonja', 'jija', 'jija', 'hyeonja', 'hyeonja', 'hwangja', 'hwangja', 'hwangja'];
    const volley = (t, d, pan, n, swell) => {
      const s = ranged(d, pan);
      v.cannon(t + s.delay, { ...s, gain: s.gain * swell }, GUN_CLASS[guns[0]], d > 350 ? 'mid' : 'full');
      for (let i = 1; i < n; i += 1) v.cannon(t + s.delay + Math.random() * 0.15, { ...s, gain: s.gain * 0.75, pan: s.pan + (Math.random() - 0.5) * 0.4 }, GUN_CLASS[guns[i % guns.length]], d > 350 ? 'lite' : 'mid');
    };
    volley(0.4, 120, -0.4, 8, 1.6);
    volley(6, 450, 0.5, 6, 1.5);
    volley(11, 140, -0.3, 8, 1.6); volley(11.4, 520, 0.6, 6, 1.4); volley(12.2, 350, 0.1, 5, 1.3);` },
  explosion: { secs: 16, play: `
    v.explosion(0.4, ranged(150, 0.2), 1.3);
    const far = ranged(900, -0.3); v.explosion(8 + far.delay, far, 1.3);` },
  // A ship going down over 30 s, played from the same plan the game's effects follow.
  sinking: { secs: 40, play: `
    const D = 30, spot = ranged(110, 0.25);
    const at = (p) => 0.3 + p * D;
    const blast = (t, size) => v.explosion(t, spot, 0.5 + size * 0.5);
    for (const c of planSinking(3, 2, 38)) {
      const t = at(c.at);
      if (c.kind === 'groan') v.groan(t, spot, c.size);
      else if (c.kind === 'crack' || c.kind === 'wreck') v.planks(t, spot, c.kind === 'wreck' ? c.size * 0.6 : c.size);
      else if (c.kind === 'mast') v.mast(t, spot);
      else if (c.kind === 'blast') blast(t, c.size);
      else if (c.kind === 'bubbles') v.bubbles(t, spot, 1.6 + c.size * 1.6, c.size);
      else if (c.kind === 'plunge') { v.bubbles(t, spot, 2.8, 1); v.splash(t, spot, 1.6); }
    }
    v.gurgle(at(1) + 0.2, spot, 1);` },
  // A scripted battle (about 48 s) played through Battlefield with the sample bank: a distant barrage, single heavy
  // guns, broadsides from both fleets, musketry, near misses, a magazine going up, a sinking and a ram.
  battle: { field: true, mix: true, secs: 50, file: 'audio2_battle.wav', script: `
    const joseon = [1, 2, 3, 4, 5].map((id, i) => ship(id, -210 + i * 24, -170 - i * 55));
    const japan = [11, 12, 13, 14, 15, 16].map((id, i) => ship(id, 240 + i * 38, -320 - i * 45));
    const horizon = [21, 22, 23].map((id, i) => ship(id, -500 + i * 500, -1900 - i * 300));
    const heavyGuns = ['cheonja', 'jija', 'jija', 'hyeonja', 'hyeonja', 'hwangja', 'hwangja', 'seungja'];
    const lightGuns = ['hyeonja', 'hwangja', 'hwangja', 'seungja', 'seungja', 'folangji', 'hudun', 'hudun'];
    const fireAt = (t, from, gun, to, spread = 0) => {
      const ox = (rng() - 0.5) * 18, oz = (rng() - 0.5) * 18;
      const x = from.x + ox, z = from.z + oz;
      const tx = to.x + (rng() - 0.5) * 60, tz = to.z + (rng() - 0.5) * 60;
      const d = Math.hypot(tx - x, tz - z), nx = (tx - x) / d, nz = (tz - z) / d;
      const when = t + rng() * spread;
      at(when, { type: 'gun', ship: from.id, gun, x, y: 6, z, dx: nx, dy: 0.05, dz: nz, big: gun === 'cheonja' || gun === 'jija' });
      const speed = 190;
      at(when + 0.02, { type: 'shot', id: nextId(), team: 'joseon', gun, ammo: 'ball', x, y: 6, z, vx: nx * speed, vy: 12, vz: nz * speed });
      const fly = d / speed + 0.05;
      if (rng() < 0.45) at(when + fly, { type: 'hit', ship: to.id, proj: 0, x: tx, y: 4, z: tz, damage: 4 + rng() * 14, ammo: rng() < 0.12 ? 'grape' : 'ball' });
      else at(when + fly, { type: 'splash', proj: 0, x: tx, z: tz, size: rng() < 0.15 ? 1.2 : rng() < 0.2 ? 0.6 : 1 });
    };
    const broadside = (t, from, to, guns, n) => { for (let i = 0; i < n; i += 1) fireAt(t, from, guns[i % guns.length], to, 0.35); };
    // 0-9 s: a battle on the horizon only
    for (let t = 0.5; t < 9; t += 0.55 + rng() * 0.7) fireAt(t, horizon[Math.floor(rng() * 3)], 'jija', joseon[0]);
    // 5-11 s: the first single heavy guns, close
    [5, 7.2, 9.6].forEach((t, i) => fireAt(t, joseon[i % 2], 'cheonja', japan[i]));
    // 11-41 s: the fleets trade broadsides
    for (let t = 11; t < 41; t += 1.1 + rng() * 1.3) {
      const mine = rng() < 0.55;
      const from = mine ? joseon[Math.floor(rng() * joseon.length)] : japan[Math.floor(rng() * japan.length)];
      const to = mine ? japan[Math.floor(rng() * japan.length)] : joseon[Math.floor(rng() * joseon.length)];
      broadside(t, from, to, mine ? heavyGuns : lightGuns, 5 + Math.floor(rng() * 5));
      if (rng() < 0.5) fireAt(t + 0.4 + rng(), from, mine ? 'cheonja' : 'hyeonja', to);
    }
    for (let t = 13; t < 38; t += 2.6 + rng() * 2) { const from = japan[Math.floor(rng() * japan.length)]; const x = from.x - 160, z = from.z + 120; at(t, { type: 'musket', ship: from.id, x, y: 5, z, dx: -1, dz: 0, count: 8 + Math.floor(rng() * 14), arms: 'arquebus' }); }
    // near misses: rounds that pass within a few tens of metres of the camera
    [[15.5, 25], [23.2, -32], [29.8, 14]].forEach(([t, side]) => {
      const dx = side - 260, dy = 27, dz = 330, d = Math.hypot(dx, dy, dz), speed = 180;
      at(t, { type: 'shot', id: nextId(), team: 'japan', gun: 'hyeonja', ammo: 'ball', x: 260, y: 8, z: -330, vx: (dx / d) * speed, vy: (dy / d) * speed, vz: (dz / d) * speed });
    });
    [10, 22].forEach((t) => at(t, { type: 'volley', ship: 1, side: 1, count: 6 }));
    // 31-48 s: the end of it
    at(31.5, { type: 'explode', ship: 13, x: 316, y: 4, z: -410 });
    at(33.5, { type: 'sinking', ship: 12 });
    at(36.5, { type: 'ram', a: 3, b: 12, x: -100, z: -120, power: 1 });
    for (let t = 41; t < 48; t += 0.9 + rng() * 1.2) fireAt(t, horizon[Math.floor(rng() * 3)], 'jija', joseon[0]);
    // fire, a boarding fight with men falling every few frames, and the cues the effects raise as a ship sinks
    at(20, { type: 'ignite', ship: 13 });
    at(35, { type: 'board', a: 3, b: 12 });
    for (let t = 35.2; t < 44; t += 0.1) at(t, { type: 'casualty', ship: 3, count: 1, melee: true });
    [[33.6, 'groan'], [34.5, 'crack'], [35.5, 'bubbles'], [36.5, 'mast'], [38, 'groan'], [39, 'bubbles'], [41, 'plunge'], [43, 'gone']].forEach(([t, kind]) => at(t, { cue: [kind, -100, 3, -110, 1] }));
  ` },
};

// One file per sound: every synthesised voice alone, the music bed and the UI sounds (once they exist), and the
// legacy_* references, the retired flute music and sine click, kept so before and after can be heard side by side.
const single = (secs, play) => ({ secs, play });
Object.assign(scenes, {
  v_cannon_heavy: single(5, `v.cannon(0.3, ranged(40, 0), GUN_CLASS.cheonja, 'full');`),
  v_cannon_medium: single(4, `v.cannon(0.3, ranged(70, 0), GUN_CLASS.hyeonja, 'full');`),
  v_cannon_small: single(3, `v.cannon(0.3, ranged(70, 0), GUN_CLASS.seungja, 'full');`),
  v_cannon_far: single(6, `v.cannon(0.3, ranged(1200, 0.2), GUN_CLASS.jija, 'lite');`),
  v_drum: single(3, `v.drum(0.3); v.drum(1.2);`),
  v_explosion: single(8, `v.explosion(0.3, ranged(150, 0), 1);`),
  v_hit: single(2, `v.hit(0.3, ranged(60, 0), 10);`),
  v_splash: single(3, `v.splash(0.3, ranged(60, 0), 1);`),
  v_ground: single(3, `v.ground(0.3, ranged(60, 0));`),
  v_ignite: single(4, `v.ignite(0.3, ranged(60, 0));`),
  v_whiz: single(2, `v.whiz(0.3, { gain: 0.5, pan: 0, muffle: 9000, dist: 0 }, 0.5);`),
  v_groan: single(5, `v.groan(0.3, ranged(60, 0), 1);`),
  v_planks: single(3, `v.planks(0.3, ranged(60, 0), 1);`),
  v_mast: single(4, `v.mast(0.3, ranged(60, 0));`),
  v_bubbles: single(6, `v.bubbles(0.3, ranged(60, 0), 3, 1);`),
  v_gurgle: single(8, `v.gurgle(0.3, ranged(60, 0), 1);`),
  // The bursts of a melee casualty (the board and casualty events) as they were: three resonant chirps per man down.
  ui_click: single(2, `const n = M.ambience.makeNoise(ctx); [0.2, 0.7, 1.1, 1.3].forEach((t) => M.ui.woodTap(ctx, bus.sfx, n, t));`),
  ambience_select: single(30, `const n = M.ambience.makeNoise(ctx); const g = ctx.createGain(); g.gain.value = M.mix.LEVELS.select.ambience; g.connect(bus.master); new M.ambience.Ambience(ctx, n, g, bus.sfx);`),
  ambience_battle: single(30, `const n = M.ambience.makeNoise(ctx); const g = ctx.createGain(); g.gain.value = M.mix.LEVELS.battle.ambience; g.connect(bus.master); new M.ambience.Ambience(ctx, n, g, bus.sfx);`),
  ambience_hot: single(30, `const n = M.ambience.makeNoise(ctx); const g = ctx.createGain(); g.gain.value = M.mix.LEVELS.battle.ambience; g.connect(bus.master); const a = new M.ambience.Ambience(ctx, n, g, bus.sfx); a.setRumble(1); a.setRoar(1);`),
  music_bed_select: single(45, `const n = M.ambience.makeNoise(ctx); const m = ctx.createGain(); m.gain.value = M.mix.LEVELS.select.music; m.connect(bus.master); m.connect(bus.reverb); const bed = new M.music.Bed(ctx, m, bus.reverb, n); bed.start(); bed.schedule(45, 'select');`),
  music_bed_battle: single(45, `const n = M.ambience.makeNoise(ctx); const m = ctx.createGain(); m.gain.value = M.mix.LEVELS.battle.music; m.connect(bus.master); m.connect(bus.reverb); const bed = new M.music.Bed(ctx, m, bus.reverb, n); bed.start(); bed.schedule(45, 'battle');`),
  v_clack: single(2, `[0.2, 0.5, 0.75, 1.1].forEach((t) => v.clack(t, 0.4, 0));`),
  legacy_melee: single(6, `for (let k = 0; k < 8; k += 1) for (let i = 0; i < 3; i += 1) v.burst(0.3 + k * 0.5 + Math.random() * 0.3, 0.3, 0, 'bandpass', 3200 + Math.random() * 1800, 8, 0.05);`),
  legacy_click: single(1, `
    const t = 0.1, osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(780, t); osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(bus.sfx); osc.start(t); osc.stop(t + 0.15);
    v.burst(t, 0.18, 0, 'bandpass', 2400, 3, 0.05);`),
  // Notes of the old procedural flute as Sound.ts scheduled them: a random walk over a pentatonic scale.
  legacy_music: single(24, `
    const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22], ROOT = 146.83;
    const music = ctx.createGain(); music.gain.value = 0.42; music.connect(bus.master);
    const flute = (t, freq, dur, gain) => {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.985, t); osc.frequency.exponentialRampToValueAtTime(freq, t + 0.18);
      const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.6); vib.connect(vg).connect(osc.frequency);
      const over = ctx.createOscillator(); over.type = 'triangle'; over.frequency.value = freq * 2; const og = ctx.createGain(); og.gain.value = 0.12;
      const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(gain, t + 0.22);
      env.gain.setTargetAtTime(gain * 0.7, t + 0.3, dur * 0.4); env.gain.setTargetAtTime(0.0001, t + dur, 0.25);
      osc.connect(env); over.connect(og).connect(env); env.connect(music);
      for (const n of [osc, vib, over]) { n.start(t); n.stop(t + dur + 1.4); }
    };
    let t = 0.5, deg = 4, seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    while (t < 22) {
      const step = r() < 0.6 ? (r() < 0.5 ? -1 : 1) : r() < 0.5 ? -2 : 2;
      deg = Math.max(1, Math.min(8, deg + step));
      const dur = [0.9, 1.4, 1.9, 2.6][Math.floor(r() * 4)];
      if (r() >= 0.22) flute(t, ROOT * 2 * Math.pow(2, SCALE[deg] / 12), dur, 0.12);
      t += dur + 0.15;
    }`),
});

const wanted = (name) => !only || only.includes(name) || (only.includes('inventory') && /^(v|ui|music|ambience|legacy)_/.test(name));
for (const [name, scene] of Object.entries(scenes)) {
  if (!wanted(name)) continue;
  const b64 = await page.evaluate(
    async ({ rate, secs, play, field, base, mix }) => {
      const { buildBus, Voices, ranged } = await import('/src/audio/voices.ts');
      const { GUN_CLASS } = await import('/src/fx/gunClass.ts');
      const { planSinking } = await import('/src/fx/sinkPlan.ts');
      const ctx = new OfflineAudioContext(2, Math.floor(rate * secs), rate);
      const bus = buildBus(ctx);
      // The music bed, sea and UI sounds are loaded when the checkout has them, so the same script renders before and after.
      const M = {};
      for (const [key, path] of [['music', '/src/audio/music.ts'], ['ui', '/src/audio/ui.ts'], ['ambience', '/src/audio/ambience.ts'], ['mix', '/src/audio/mix.ts']]) M[key] = await import(/* @vite-ignore */ path).catch(() => null);
      if (field) {
        const { Battlefield } = await import('/src/audio/battlefield.ts');
        const counts = {};
        window.__counts = counts;
        // With `mix` the sea, the rumble and the bed play under the guns exactly as Sound.ts wires them.
        let weather = null;
        const ducks = [];
        if (mix && M.ambience) {
          const noise = M.ambience.makeNoise(ctx);
          const sea = ctx.createGain();
          sea.gain.value = M.mix.LEVELS.battle.ambience;
          const duck = ctx.createGain();
          sea.connect(duck).connect(bus.master);
          ducks.push({ node: duck, depth: 0.35 });
          weather = new M.ambience.Ambience(ctx, noise, sea, bus.sfx);
          const music = ctx.createGain();
          music.gain.value = M.mix.LEVELS.battle.music;
          music.connect(bus.master);
          music.connect(bus.reverb);
          const bed = new M.music.Bed(ctx, music, bus.reverb, noise);
          bed.start();
          bed.schedule(secs, 'battle');
        }
        const bf = new Battlefield(ctx, bus.sfx, bus.reverb, ducks);
        await bf.load(`${base}/`);
        // Count what is played by wrapping the bank's own instance (a second import of the module would be another copy).
        const original = bf.samples.play.bind(bf.samples);
        bf.samples.play = (kind, t, o) => { counts[kind] = (counts[kind] ?? 0) + 1; return original(kind, t, o); };
        // Facing -z, so +x is to the right. Only x, y, z (and w) are read from these.
        const camera = { position: { x: 0, y: 35, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        // Seeded, so every render of the script is the same battle.
        let seed = 1592;
        const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const ships = new Map();
        const timeline = [];
        let id = 1000;
        const ship = (shipId, x, z) => { const s = { id: shipId, x, z, spec: { deck: 6 } }; ships.set(shipId, s); return s; };
        const at = (t, e) => timeline.push({ t, e });
        new Function('ship', 'at', 'rng', 'nextId', play)(ship, at, rng, () => (id += 1));
        timeline.sort((a, b) => a.t - b.t);
        const battle = { get: (shipId) => ships.get(shipId) };
        const STEP = 0.05;
        let next = 0;
        const step = (t) => {
          const events = [];
          while (next < timeline.length && timeline[next].t <= t) {
            const e = timeline[next++].e;
            if (e.cue) bf.cue(...e.cue);
            else events.push(e);
          }
          bf.tick(camera, STEP, t * 1000);
          weather?.setRumble(bf.intensity);
          if (events.length) bf.update(events, battle, camera);
          if (t + STEP < secs - 0.1) ctx.suspend(t + STEP).then(() => step(t + STEP));
          ctx.resume();
        };
        ctx.suspend(STEP).then(() => step(STEP));
        var buf = await ctx.startRendering();
      } else {
        const v = new Voices(ctx, bus.sfx, bus.reverb);
        new Function('v', 'ranged', 'GUN_CLASS', 'planSinking', 'ctx', 'bus', 'M', play)(v, ranged, GUN_CLASS, planSinking, ctx, bus, M);
        var buf = await ctx.startRendering();
      }
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      const pcm = new Int16Array(l.length * 2);
      let peak = 0;
      for (let i = 0; i < l.length; i += 1) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      const k = peak > 0.98 ? 0.98 / peak : 1;
      for (let i = 0; i < l.length; i += 1) {
        pcm[i * 2] = Math.max(-1, Math.min(1, l[i] * k)) * 32767;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i] * k)) * 32767;
      }
      let bin = '';
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { data: btoa(bin), peak };
    },
    { rate: RATE, secs: scene.secs, play: scene.script ?? scene.play, field: !!scene.field, base, mix: !!scene.mix },
  );
  if (scene.field) console.log('samples played', JSON.stringify(await page.evaluate(() => window.__counts)));
  const pcm = Buffer.from(b64.data, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const file = join(out, prefix + (scene.file ?? `${name}.wav`));
  await writeFile(file, Buffer.concat([header, pcm]));
  console.log('wrote', file, `${scene.secs}s`, 'peak', b64.peak.toFixed(2));
}
await browser.close();
