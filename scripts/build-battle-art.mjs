// Real scenes of the nine historical battles for their link cards and loading pictures, made in the game's own
// renderer: each battle is played in headless Edge (WebGPU) to its signature moment, framed relative to its ships, and
// kept as a wide and a tall still; the cards and the loading pictures are composed from those stills.
//   node scripts/build-battle-art.mjs --capture=<dir> [--only=hansan,noryang] [--url=http://127.0.0.1:5291/]
//       plays the battles against a running server and writes every framing at every moment of each plan to
//       <dir>/<id>/ with contact sheets to choose from (--only=front recaptures the front card's turtle ship at sunset
//       into assets-src instead).
//   node scripts/build-battle-art.mjs --keep=<dir> --pick="hansan:w-0-1,t-2-0;okpo:w-1-0"
//       keeps the chosen candidates as the stills in assets-src/battle-art-2026-10-15/, recorded in provenance.json.
//   node scripts/build-battle-art.mjs [--only=...]
//       composes the 1200x600 link cards (public/og/, names from src/routes.ts cardFile) and the loading pictures
//       (public/ui/art/loading_<id>.webp 1920x1080, _sm 960x540, _tall 828x1792) from the stills; needs no GPU.
//   node scripts/build-battle-art.mjs --sheet=<dir>
//       contact sheets of every card at full size and at a 300 px KakaoTalk bubble, for review.
// The moments are found by what happens in the battle (ships sunk, a ship within reach of another), never by the clock:
// the same address plays a slightly different battle on every load. Every ship is drawn at full detail for the stills.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCE_DIR = join(ROOT, 'assets-src', 'battle-art-2026-10-15');
const FRONT_DIR = join(ROOT, 'assets-src', 'og-geobukseon-2026-10-14');
const FRONT_STILL = join(FRONT_DIR, 'geobukseon-sunset.jpg');
const FONTS = join(ROOT, 'public', 'ui', 'fonts');
const ART = join(ROOT, 'public', 'ui', 'art');

// These modules take no imports, so stripping their types is all it takes to run them here (as route-pages.mjs does).
const load = async (file) => {
  const code = transformSync(readFileSync(join(ROOT, file), 'utf8'), { loader: 'ts', format: 'esm' }).code;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const { BATTLE_SLUGS, CARD_SIZE, cardFile } = await load('src/routes.ts');
const { SCENARIO_TEXT } = await load('src/sim/scenarioText.ts');
const { EN_SIM } = await load('src/i18n/en/sim.ts');
const { EN_MENUS } = await load('src/i18n/en/menus.ts');

/** The stills: a wide one for the cards and the desktop loading picture, a tall one for phones. Rendered at twice the size. */
const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 621, height: 1344 };
/** While the battle plays to its moment the page is small, so the GPU spends its time on the battle, not on pixels. */
const RUN = { width: 960, height: 540 };
/** What is kept in assets-src: one and a half times the loading pictures, enough to compose every size again. */
const KEEP_WIDE = { width: 2880, height: 1620 };

const launch = () =>
  chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
  });

/**
 * What the shot plans can use, installed in the page beside the engine (window.__capture). Poses are the RTS camera's:
 * a look-at point on the water, the bearing from it to the camera, the pitch and the distance.
 */
function installCapture() {
  const e = window.__engine;
  const live = (s) => s.alive && s.sinking <= 0;
  const team = (t) => e.battle.ships.filter((s) => s.team === t && live(s));
  const kind = (k) => e.battle.ships.filter((s) => s.spec.kind === k && live(s));
  const cen = (l) => ({ x: l.reduce((a, s) => a + s.x, 0) / l.length, z: l.reduce((a, s) => a + s.z, 0) / l.length });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const near = (p, list, r) => list.filter((s) => dist(s, p) < r);
  const nearest = (p, list) => list.reduce((a, s) => (!a || dist(s, p) < dist(a, p) ? s : a), null);
  const toward = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const burning = (t) => e.battle.ships.filter((s) => live(s) && s.team === t && s.fire > 0.08);
  /** The middle of up to n burning ships of `t` (the ones nearest `from`, if given), or of the whole side when none burns. */
  const fires = (t, n = 4, from) => {
    const f = burning(t);
    if (from) f.sort((a, b) => dist(a, from) - dist(b, from));
    return cen(f.length ? f.slice(0, n) : team(t));
  };
  /** The middle of the ships of `foes` within r of S, or of all of them. */
  const around = (S, foes, r) => cen(near(S, foes, r).length ? near(S, foes, r) : foes);
  const flagship = (t) => team(t).find((s) => s.flagship) ?? team(t)[0];
  /** The middle of the n Japanese ships nearest S. */
  const swarm = (S, n) => cen(team('japan').sort((a, b) => dist(a, S) - dist(b, S)).slice(0, n));
  /** Hansan's crane wing: the middle between the panokseon and the fleet inside the wing, and the bearing of its open side. */
  const wing = () => {
    const J = cen(team('japan'));
    const A = cen(team('joseon').filter((s) => s.spec.kind === 'panokseon'));
    return { mid: { x: (J.x + A.x) / 2, z: (J.z + A.z) / 2 }, open: toward(A, J) };
  };
  /** The ship of `t` with the most enemies close by, burning or a turtle ship counting for more. */
  const hottest = (t, foes, r = 260) => {
    let best = null;
    let score = -1;
    for (const s of team(t)) {
      const sc = near(s, foes, r).length + (s.fire > 0.3 ? 2 : 0) + (s.spec.kind === 'geobukseon' ? 1.5 : 0) + (s.flagship ? 0.5 : 0);
      if (sc > score) {
        score = sc;
        best = s;
      }
    }
    return best;
  };
  const sun = () => {
    const p = e.sun.position;
    const a = e.sun.target.position;
    return Math.atan2(p.z - a.z, p.x - a.x);
  };
  /** Of two bearings to stand at, the one with the sun behind the camera, so the side it sees is lit. */
  const lit = (a, b) => (Math.cos(a - sun()) >= Math.cos(b - sun()) ? a : b);
  /** The bearing from S with the most land within a few kilometres: the shore an anchorage lies under. */
  const landward = (S) => {
    let best = -1;
    let bearing = 0;
    for (let k = 0; k < 48; k += 1) {
      const a = (k / 48) * Math.PI * 2;
      let land = 0;
      for (let r = 500; r <= 3000; r += 250) if (e.terrain.heightAt(S.x + Math.cos(a) * r, S.z + Math.sin(a) * r) > 2) land += 1;
      if (land > best) {
        best = land;
        bearing = a;
      }
    }
    return bearing;
  };
  /**
   * A camera standing at bearing `az` and ground distance `d` from S, `h` metres above the water, turned so S lands at
   * screen x = sx (-1 the left edge, 1 the right) and pitched so it lands at screen y = sy (-1 bottom, 1 top).
   */
  const place = (S, az, d, h, fov, sx, sy, lift = 0) => {
    const half = (fov * Math.PI) / 360;
    const p = Math.max(0.02, Math.atan2(h, d) + Math.atan(sy * Math.tan(half)));
    const cx = S.x + Math.cos(az) * d;
    const cz = S.z + Math.sin(az) * d;
    const beta = Math.atan2(S.z - cz, S.x - cx);
    const hf = Math.atan(Math.tan(half) * (innerWidth / innerHeight));
    const theta = beta - Math.atan(sx * Math.tan(hf));
    const distance = h / Math.sin(p);
    const ground = distance * Math.cos(p);
    return { tx: cx + Math.cos(theta) * ground, tz: cz + Math.sin(theta) * ground, yaw: theta + Math.PI, pitch: p, distance, fov, lift };
  };
  const summary = () => {
    const ships = e.battle.ships;
    return {
      time: +e.battle.time.toFixed(1),
      afloat: { joseon: team('joseon').length, japan: team('japan').length },
      sunk: { joseon: ships.filter((s) => s.team === 'joseon' && !live(s)).length, japan: ships.filter((s) => s.team === 'japan' && !live(s)).length },
      burning: ships.filter((s) => live(s) && s.fire > 0.08).length,
    };
  };
  window.__capture = { e, live, team, kind, cen, dist, near, nearest, toward, burning, fires, around, flagship, swarm, wing, hottest, sun, lit, landward, place, summary };
  e.paused = true;
  e.autoFast = false;
  e.fastForward = false;
  e.showLabels = false;
  e.rts.cinematic = false;
  e.rts.followId = 0;
  e.director.setSlowMo(false);
  // Every ship at full detail: the detail distances far out, and room for all of them in the nearest-ships list
  // (ShipViews sizes it from maxLod0 when it is built, so it is replaced along with the limit).
  const v = e.views;
  if (!v?.lod || !v.nearest) throw new Error('ShipViews no longer has lod and nearest: update installCapture');
  v.lod.near = 1e5;
  v.lod.mid = 2e5;
  v.lod.maxLod0 = 4096;
  v.nearest = new Float64Array(4096);
}

/**
 * The shot plans. Each battle loads with `warm` seconds already simulated (no smoke or fire from them), then runs its
 * steps: `stage` gives orders as the player or stages the history, `run` plays the battle at a speed until something
 * has happened. From there the battle plays on through `moments` (seconds after the first), and at each of them every
 * `wide` and `tall` framing is taken: the candidates the kept stills are chosen from (--keep). Framings are relative to
 * the ships. `grade` is the exposure the renderer is set to (a lift for night and overcast before the picture is
 * quantised) and the gamma and saturation applied when composing; `card` is where the 2:1 card sits in the 16:9 still
 * (0 top, 1 bottom). The framings keep their subject right of centre: the cards and the desktop loading page set their
 * text on the left.
 */
const SHOTS = {
  okpo: {
    // The burning anchorage: Japanese ships ablaze in Okpo bay under the wooded shore, the Joseon line firing into it.
    warm: 280,
    steps: [{ run: 1.5, until: (c) => c.summary().sunk.japan >= 16 || c.e.battle.time > 360 }],
    moments: [0, 10, 20],
    wide: [
      (c) => { const S = c.fires('japan'); return c.place(S, c.toward(c.nearest(S, c.team('joseon')), S) + Math.PI + 0.4, 330, 70, 34, 0.3, -0.05); },
      (c) => { const S = c.fires('japan'); return c.place(S, c.toward(c.nearest(S, c.team('joseon')), S) + Math.PI + 0.15, 280, 45, 34, 0.32, -0.02); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.45, 150, 18, 38, 0.35, -0.08, 4); },
    ],
    tall: [
      (c) => { const S = c.fires('japan'); return c.place(S, c.toward(c.nearest(S, c.team('joseon')), S) + Math.PI + 0.4, 300, 60, 56, 0, 0.32); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.45, 170, 22, 52, 0.05, 0.25, 4); },
    ],
    grade: { exposure: 1, gamma: 1, saturation: 1.04 },
    card: 0.5,
  },
  sacheon: {
    // The turtle ship's first sortie: out ahead of the fleet, dragon head first, at the ships drawn out from the quay.
    warm: 180,
    steps: [{ run: 1.5, until: (c) => c.burning('japan').length >= 1 || c.e.battle.time > 250 }],
    moments: [0, 8, 16],
    wide: [
      (c) => { const T = c.kind('geobukseon')[0]; return c.place(T, T.heading - 0.6, 82, 8, 36, 0.42, -0.1, 3); },
      (c) => { const T = c.kind('geobukseon')[0]; return c.place(T, T.heading - 0.95, 100, 11, 34, 0.4, -0.08, 3); },
      (c) => { const T = c.kind('geobukseon')[0]; return c.place(T, c.lit(T.heading - 0.6, T.heading + 0.6), 82, 8, 36, 0.42, -0.1, 3); },
    ],
    tall: [
      (c) => { const T = c.kind('geobukseon')[0]; return c.place(T, T.heading - 0.6, 118, 12, 54, 0.05, 0.26, 3); },
      (c) => { const T = c.kind('geobukseon')[0]; return c.place(T, T.heading - 0.95, 130, 14, 52, 0.05, 0.26, 3); },
    ],
    grade: { exposure: 1.08, gamma: 1, saturation: 1.03 },
    card: 0.5,
  },
  dangpo: {
    // A turtle ship charging the tall Japanese flagship at its moorings, as the player orders it.
    warm: 150,
    steps: [
      {
        stage: (c) => {
          const flag = c.team('japan').find((s) => s.flagship);
          const turtle = c.nearest(flag, c.kind('geobukseon'));
          window.__subject = { turtle: turtle.id, flag: flag.id };
          c.e.issue({ type: 'configure', ids: [turtle.id], patch: { stance: 'ram' } });
          return c.e.issue({ type: 'order', ids: [turtle.id], order: { type: 'attack', targetId: flag.id } });
        },
      },
      // Stopped while the turtle ship is still whole: the battle went the other way at Dangpo.
      { run: 2, until: (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); return !c.live(F) || c.dist(T, F) < 120 || T.fire > 0.04 || T.hull < T.spec.hull * 0.85 || c.e.battle.time > 300; } },
    ],
    moments: [0, 4, 8],
    wide: [
      // The flagship right of centre, the turtle ship nearer the camera and further right, closing on it.
      (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); return c.place(F, c.toward(F, T) - 0.3, c.dist(T, F) + 100, 12, 40, 0.12, -0.04, 6); },
      (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); return c.place(F, c.toward(F, T) + 0.3, c.dist(T, F) + 100, 12, 40, 0.12, -0.04, 6); },
      (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); const back = c.toward(F, T); return c.place(T, c.lit(back - 0.55, back + 0.55), 85, 10, 38, 0.4, -0.12, 4); },
    ],
    tall: [
      (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); return c.place(F, c.toward(F, T) - 0.2, c.dist(T, F) + 120, 14, 54, 0, 0.26, 6); },
      (c) => { const T = c.e.battle.get(window.__subject.turtle); const F = c.e.battle.get(window.__subject.flag); return c.place(F, c.toward(F, T) + 0.2, c.dist(T, F) + 120, 14, 54, 0, 0.26, 6); },
    ],
    grade: { exposure: 1, gamma: 1, saturation: 1.03 },
    card: 0.5,
  },
  hansan: {
    // The crane wing closed round the Japanese fleet off Hansando, seen from the open side of the cup. The fleet is
    // lured into the wing as it was in 1592; a player who waits would meet it at the wing's mouth instead.
    warm: 100,
    steps: [
      {
        stage: (c) => {
          // Fit the wing's circle to the panokseon (x² + z² + Dx + Ez + F = 0) and send the Japanese into it.
          const arc = c.team('joseon').filter((s) => s.spec.kind === 'panokseon');
          let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sxr = 0, szr = 0, sr = 0;
          for (const s of arc) {
            const r = s.x * s.x + s.z * s.z;
            sxx += s.x * s.x; sxz += s.x * s.z; szz += s.z * s.z; sx += s.x; sz += s.z; sxr += s.x * r; szr += s.z * r; sr += r;
          }
          const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, arc.length]];
          const B = [-sxr, -szr, -sr];
          const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
          const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)));
          const d0 = det(A);
          const cx = -det(col(0)) / d0 / 2;
          const cz = -det(col(1)) / d0 / 2;
          const back = c.cen(arc);
          const ja = c.team('japan');
          const J = c.cen(ja);
          const tx = cx + (back.x - cx) * 0.15;
          const tz = cz + (back.z - cz) * 0.15;
          for (const s of ja) c.e.battle.setOrder([s.id], { type: 'move', x: tx + (s.x - J.x) * 0.8, z: tz + (s.z - J.z) * 0.8 });
          return { wing: { x: Math.round(cx), z: Math.round(cz) } };
        },
      },
      { run: 3, until: (c) => c.summary().sunk.japan >= 18 || c.e.battle.time > 460 },
    ],
    moments: [0, 12, 24],
    // `c.wing()`: the middle between the wing and the fleet inside it, and the bearing of the wing's open side. From
    // two kilometres the whole cup fits but the air between turns it to haze, so the camera stands in the open side
    // instead, low enough that the wing curves round the horizon behind the burning fleet.
    wide: [
      (c) => { const w = c.wing(); return c.place(w.mid, c.lit(w.open + 0.12, w.open - 0.12), 1500, 300, 30, 0.12, 0.04); },
      (c) => { const w = c.wing(); return c.place(w.mid, c.lit(w.open + 0.1, w.open - 0.1), 950, 150, 40, 0.1, 0.02); },
      (c) => { const w = c.wing(); const S = c.fires('japan', 3, w.mid); return c.place(S, c.lit(w.open + 0.25, w.open - 0.25), 320, 45, 36, 0.28, -0.04, 4); },
    ],
    tall: [
      (c) => { const w = c.wing(); return c.place(w.mid, c.lit(w.open + 0.1, w.open - 0.1), 900, 260, 50, 0, 0.3); },
      (c) => { const w = c.wing(); const S = c.fires('japan', 3, w.mid); return c.place(S, c.lit(w.open + 0.25, w.open - 0.25), 300, 50, 50, 0, 0.26, 4); },
    ],
    grade: { exposure: 1, gamma: 1, saturation: 1.05 },
    card: 0.48,
  },
  angolpo: {
    // Burning ships packed in the narrow cove under the wooded hills, seen from the sea the panokseon fire in from.
    warm: 250,
    steps: [{ run: 1.5, until: (c) => c.summary().sunk.japan >= 16 || c.e.battle.time > 330 }],
    moments: [0, 10, 20],
    wide: [
      (c) => { const S = c.fires('japan', 3); return c.place(S, c.landward(S) + Math.PI + 0.35, 320, 55, 34, 0.25, -0.03); },
      (c) => { const S = c.fires('japan', 3); return c.place(S, c.landward(S) + Math.PI - 0.3, 380, 70, 32, 0.25, -0.05); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.45, 150, 18, 38, 0.35, -0.08, 4); },
    ],
    tall: [
      (c) => { const S = c.fires('japan', 3); return c.place(S, c.landward(S) + Math.PI + 0.35, 290, 55, 54, 0, 0.28); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.45, 170, 22, 52, 0.05, 0.25, 4); },
    ],
    grade: { exposure: 1.15, gamma: 1.1, saturation: 1.02 },
    card: 0.5,
  },
  busan: {
    // The raid on the enemy's base: turtle ships and panokseon breaking into the rows of anchored ships.
    warm: 230,
    steps: [{ run: 1.5, until: (c) => c.summary().sunk.japan >= 45 || c.e.battle.time > 300 }],
    moments: [0, 8, 16],
    wide: [
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI - 0.35, 260, 50, 36, 0.28, -0.1); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI - 0.35, 260, 50, 36, 0.42, -0.1); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.35, 260, 50, 36, 0.4, -0.1); },
    ],
    tall: [
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI - 0.35, 240, 46, 56, 0, 0.28); },
      (c) => { const H = c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 420)) + Math.PI + 0.35, 240, 46, 56, 0, 0.28); },
    ],
    grade: { exposure: 1, gamma: 1, saturation: 1.03 },
    card: 0.5,
  },
  chilcheon: {
    // The night the Joseon navy was destroyed: its anchored fleet ablaze as the Japanese close in from the dark.
    warm: 500,
    steps: [{ run: 2, until: (c) => c.burning('joseon').length >= 4 || c.e.battle.time > 640 }],
    moments: [0, 12, 24],
    // `H` is a burning Joseon ship (or the one in the thick of it), the Japanese around it beyond.
    wide: [
      (c) => { const H = c.burning('joseon')[0] ?? c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 500)) - 0.35, 260, 24, 34, 0.15, -0.04, 4); },
      (c) => { const H = c.burning('joseon')[0] ?? c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 500)) + 0.35, 260, 24, 34, 0.25, -0.04, 4); },
      (c) => { const H = c.burning('joseon')[0] ?? c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 500)) - Math.PI / 2, 520, 150, 34, 0.15, -0.02); },
    ],
    tall: [
      (c) => { const H = c.burning('joseon')[0] ?? c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 500)) - 0.35, 260, 26, 52, 0.12, 0.28, 4); },
      (c) => { const H = c.burning('joseon')[0] ?? c.hottest('joseon', c.team('japan')); return c.place(H, c.toward(H, c.around(H, c.team('japan'), 500)) + 0.35, 260, 26, 52, -0.05, 0.28, 4); },
    ],
    grade: { exposure: 1.6, gamma: 1.12, saturation: 1 },
    card: 0.52,
  },
  myeongnyang: {
    // Thirteen against 133: the flagship alone in the narrows opens fire on the swarm (the player's volley).
    warm: 150,
    steps: [
      { run: 1, until: (c) => { const F = c.flagship('joseon'); return c.dist(F, c.nearest(F, c.team('japan'))) < 170 || c.e.battle.time > 200; } },
      {
        stage: (c) => {
          window.__volley = c.e.battle.time;
          return c.e.issue({ type: 'volley', ids: [c.flagship('joseon').id], side: 3 });
        },
      },
      // The guns go off within half a second; a little more lets the smoke roll out.
      { run: 1, until: (c) => c.e.battle.time >= window.__volley + 1.2 },
    ],
    moments: [0, 1.5, 4],
    // `away`: the bearing from the swarm's nearest forty ships to the flagship.
    wide: [
      (c) => { const F = c.flagship('joseon'); return c.place(F, c.toward(c.swarm(F, 40), F) - 0.35, 260, 26, 24, 0.15, 0.02, 4); },
      (c) => { const F = c.flagship('joseon'); return c.place(F, c.toward(c.swarm(F, 40), F) - 0.35, 210, 22, 26, 0.18, 0.03, 4); },
      (c) => { const F = c.flagship('joseon'); return c.place(F, c.toward(c.swarm(F, 40), F) - 0.6, 240, 24, 26, 0.12, 0.02, 4); },
    ],
    tall: [
      (c) => { const F = c.flagship('joseon'); return c.place(F, c.toward(c.swarm(F, 40), F) - 0.2, 230, 28, 46, 0, 0.22, 4); },
      (c) => { const F = c.flagship('joseon'); return c.place(F, c.toward(c.swarm(F, 40), F) - 0.35, 190, 24, 44, 0.05, 0.22, 4); },
    ],
    grade: { exposure: 1.9, gamma: 1.06, saturation: 1.05 },
    card: 0.52,
  },
  noryang: {
    // The war's last battle at night: the allied line, Joseon and Ming, against the burning Japanese column. `B` is
    // where the Japanese burn nearest the allies, `P` the allied ship closest to them.
    warm: 420,
    steps: [{ run: 1.5, until: (c) => c.burning('japan').length >= 4 || c.e.battle.time > 520 }],
    moments: [0, 10, 20],
    wide: [
      (c) => { const B = c.fires('japan', 4, c.cen(c.team('joseon'))); const P = c.nearest(B, c.team('joseon')); return c.place(P, c.toward(P, B) + Math.PI + 0.25, 220, 30, 32, 0.3, -0.06, 4); },
      (c) => { const B = c.fires('japan', 4, c.cen(c.team('joseon'))); const P = c.nearest(B, c.team('joseon')); return c.place(P, c.toward(P, B) + Math.PI + 0.45, 170, 20, 34, 0.32, -0.04, 4); },
      (c) => { const B = c.fires('japan', 4, c.cen(c.team('joseon'))); const P = c.nearest(B, c.team('joseon')); return c.place(B, c.toward(B, P) + 0.7, 480, 90, 32, 0.15, -0.05); },
    ],
    tall: [
      (c) => { const B = c.fires('japan', 4, c.cen(c.team('joseon'))); const P = c.nearest(B, c.team('joseon')); return c.place(P, c.toward(P, B) + Math.PI + 0.25, 220, 32, 54, 0, 0.3, 4); },
      (c) => { const B = c.fires('japan', 4, c.cen(c.team('joseon'))); const P = c.nearest(B, c.team('joseon')); return c.place(B, c.toward(B, P) + 0.7, 420, 80, 50, 0, 0.26); },
    ],
    grade: { exposure: 1.5, gamma: 1.1, saturation: 1 },
    card: 0.5,
  },
};

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const round = (pose) => Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, +v.toFixed(3)]));

/** Sets the pose and the exposure, waits for the frames to settle and screenshots the page at its current size. */
async function still(page, frame, exposure) {
  const pose = await page.evaluate(
    ([src, exposure]) => {
      const c = window.__capture;
      const p = (0, eval)(`(${src})`)(c);
      c.e.rts.setPose({ tx: p.tx, tz: p.tz, yaw: p.yaw, pitch: p.pitch, distance: p.distance }, true);
      c.e.rts.lookLift = p.lift ?? 0;
      c.e.camera.fov = p.fov;
      c.e.camera.updateProjectionMatrix();
      c.base ??= c.e.renderer.toneMappingExposure;
      c.e.renderer.toneMappingExposure = c.base * exposure;
      return p;
    },
    [frame.toString(), exposure],
  );
  await page.waitForTimeout(1800);
  return { png: await page.screenshot({ type: 'png' }), pose: round(pose) };
}

/** Share of pixels at or above 250 in every channel: blown-out highlights. */
async function clipped(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let hot = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) hot += 1;
  return +((100 * hot) / (data.length / info.channels)).toFixed(2);
}

/** Plays the battle on at its own pace (and the effects with it) until `seconds` of battle time have passed. */
async function play(page, seconds) {
  await page.evaluate(() => {
    const e = window.__engine;
    window.__until = e.battle.time;
    e.speed = 1;
    e.paused = false;
  });
  await page.waitForFunction((s) => window.__engine.battle.time >= window.__until + s, seconds, { timeout: 300000, polling: 50 });
  await page.evaluate(() => {
    window.__engine.paused = true;
  });
}

/**
 * Plays one battle to its moment and takes every framing of its plan at each of its moments: the candidates, kept in
 * <out>/<id>/ with their record (candidates.json) and contact sheets to choose from. A candidate is named for its
 * format, moment and framing: w-1-0 is the first wide framing at the second moment.
 */
async function captureBattle(browser, id, base, out) {
  const plan = SHOTS[id];
  const url = `${base}?scenario=${id}&hud=0&lv=4&q=high&dpr=2&paused=1&warm=${plan.warm}`;
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: RUN, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
    await page.evaluate(installCapture);
    const steps = [];
    for (const step of plan.steps) {
      if (step.stage) {
        steps.push({ stage: await page.evaluate((src) => (0, eval)(`(${src})`)(window.__capture), step.stage.toString()) });
        continue;
      }
      await page.evaluate((speed) => {
        window.__engine.speed = speed;
        window.__engine.paused = false;
      }, step.run);
      await page.waitForFunction((src) => (0, eval)(`(${src})`)(window.__capture), step.until.toString(), { timeout: 900000, polling: 100 });
      steps.push({ run: step.run, ...(await page.evaluate(() => {
        window.__engine.paused = true;
        return window.__capture.summary();
      })) });
    }
    console.log(`${id}: ${((Date.now() - t0) / 1000).toFixed(0)} s to the moment`, JSON.stringify(steps.at(-1)));
    const record = { captured: new Date().toISOString(), url, steps, engine: await page.evaluate(() => window.__engine.info()), candidates: {} };
    let played = 0;
    for (const [m, after] of plan.moments.entries()) {
      await play(page, after - played);
      played = after;
      const at = await page.evaluate(() => window.__capture.summary());
      for (const [format, view, frames] of [['w', WIDE, plan.wide], ['t', TALL, plan.tall]]) {
        await page.setViewportSize(view);
        await page.waitForTimeout(2500);
        for (const [v, frame] of frames.entries()) {
          const { png, pose } = await still(page, frame, plan.grade.exposure);
          const name = `${format}-${m}-${v}`;
          const kept = format === 'w' ? sharp(png).resize(KEEP_WIDE.width, KEEP_WIDE.height, { kernel: 'lanczos3' }) : sharp(png);
          await kept.jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(dir, `${name}.jpg`));
          record.candidates[name] = { at, pose, rendered: [view.width * 2, view.height * 2], clipped: await clipped(png) };
        }
      }
      await page.setViewportSize(RUN);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    writeFileSync(join(dir, 'candidates.json'), `${JSON.stringify(record, null, 2)}\n`);
    const names = Object.keys(record.candidates);
    await contact(names.filter((n) => n.startsWith('w')).map((n) => join(dir, `${n}.jpg`)), plan.wide.length, 640, join(dir, 'sheet-wide.jpg'));
    await contact(names.filter((n) => n.startsWith('t')).map((n) => join(dir, `${n}.jpg`)), plan.tall.length * plan.moments.length, 300, join(dir, 'sheet-tall.jpg'));
    console.log(`  ${names.length} candidates in ${dir}`);
  } finally {
    await page.close();
  }
}

/**
 * The front card's still: Hansan at sunset, paused before the first shot, the three turtle ships turned so the low sun
 * falls on the side the camera sees; the camera just above the waves off the port bow with a 32 degree lens.
 */
const FRONT_POSE = { stage: 2.4, yaw: -0.6, pitch: 0.05, distance: 60, ahead: 10, shift: -9, fov: 32 };

async function captureFront(browser, base) {
  const url = `${base}?scenario=hansan&hud=0&lv=4&q=high&dpr=2&paused=1&sky=sunset&clouds=0`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
    const scene = await page.evaluate((p) => {
      const e = window.__engine;
      e.paused = true;
      e.autoFast = false;
      e.showLabels = false;
      const sun = e.sun.position;
      const aim = e.sun.target.position;
      const sunAz = Math.atan2(sun.z - aim.z, sun.x - aim.x);
      const turtles = e.battle.ships.filter((s) => s.spec.kind === 'geobukseon');
      for (const t of turtles) t.heading = sunAz + p.stage;
      const s = turtles[0];
      const az = s.heading + p.yaw;
      // The look-at point moves along the camera's right-hand axis; a negative shift puts the ship right of centre.
      const tx = s.x + p.ahead * Math.cos(s.heading) + p.shift * Math.sin(az);
      const tz = s.z + p.ahead * Math.sin(s.heading) - p.shift * Math.cos(az);
      e.rts.setPose({ tx, tz, yaw: az, pitch: p.pitch, distance: p.distance }, true);
      e.camera.fov = p.fov;
      e.camera.updateProjectionMatrix();
      return { ship: s.id, x: s.x, z: s.z, heading: s.heading, sunAz, backend: e.info().backend };
    }, FRONT_POSE);
    await page.waitForTimeout(1500);
    await sharp(await page.screenshot()).jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(FRONT_STILL);
    const provenance = { created: new Date().toISOString(), renderer: 'the game itself (src/game/Engine.ts), no image generation or painting', url, pose: FRONT_POSE, scene, size: [2400, 1260], sha256: sha(FRONT_STILL) };
    writeFileSync(join(FRONT_DIR, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    console.log(`front: ${FRONT_STILL}`);
  } finally {
    await page.close();
  }
}

async function capture() {
  const base = args.url ?? 'http://127.0.0.1:5291/';
  const only = args.only ? args.only.split(',') : BATTLE_SLUGS;
  const browser = await launch();
  try {
    for (const id of only) {
      if (id === 'front') await captureFront(browser, base);
      else await captureBattle(browser, id, base, args.capture);
    }
  } finally {
    await browser.close();
  }
}

/**
 * Keeps the chosen candidates of each battle (--pick=hansan:w-0-1,t-2-0;okpo:...) as its stills in assets-src, with
 * where they came from in provenance.json.
 */
async function keep() {
  const provFile = join(SOURCE_DIR, 'provenance.json');
  const provenance = existsSync(provFile)
    ? JSON.parse(readFileSync(provFile, 'utf8'))
    : { renderer: 'the game itself (src/game/Engine.ts) in headless Edge with WebGPU, no image generation or painting', script: 'scripts/build-battle-art.mjs', battles: {} };
  mkdirSync(SOURCE_DIR, { recursive: true });
  for (const pick of args.pick.split(';')) {
    const [id, names] = pick.split(':');
    if (!SHOTS[id]) throw new Error(`no battle ${id}`);
    const record = JSON.parse(readFileSync(join(args.keep, id, 'candidates.json'), 'utf8'));
    const battle = { ...provenance.battles[id], grade: SHOTS[id].grade };
    for (const name of names.split(',')) {
      const format = name.startsWith('w') ? 'wide' : 'tall';
      const file = join(SOURCE_DIR, `${id}-${format}.jpg`);
      copyFileSync(join(args.keep, id, `${name}.jpg`), file);
      const meta = await sharp(file).metadata();
      const { captured, url, steps, engine } = record;
      battle[format] = { file: `${id}-${format}.jpg`, candidate: name, captured, url, steps, engine, ...record.candidates[name], kept: [meta.width, meta.height], sha256: sha(file) };
      console.log(`kept ${id} ${format} from ${name}`);
    }
    provenance.battles[id] = battle;
  }
  provenance.battles = Object.fromEntries(BATTLE_SLUGS.filter((b) => provenance.battles[b]).map((b) => [b, provenance.battles[b]]));
  writeFileSync(provFile, `${JSON.stringify(provenance, null, 2)}\n`);
}

/** A still with its battle's grade: a gamma lift for the dark ones and a touch of saturation. */
async function graded(file, grade) {
  let img = sharp(file);
  if (grade.gamma !== 1) {
    // sharp's gamma() darkens on the way in and brightens on the way out; a lift is a curve on the levels.
    const curve = Buffer.from(Array.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** (1 / grade.gamma))));
    const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 1) data[i] = curve[data[i]];
    img = sharp(data, { raw: info });
  }
  return img.modulate({ saturation: grade.saturation });
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const english = (ko) => {
  const text = EN_SIM[ko] ?? EN_MENUS[ko];
  if (!text) throw new Error(`no English for ${ko}`);
  return text;
};

/** The card's text in one edition: the poster title, its date and hanja, its place. */
function battleText(id, lang) {
  const t = SCENARIO_TEXT[id];
  if (lang === 'ko') return { title: t.title, date: t.date, hanja: t.hanja, place: t.place };
  const title = english(t.title);
  const m = /^Battle of (.+)$/.exec(title);
  return { pre: m ? 'Battle of' : '', title: m ? m[1] : title, date: english(t.date), hanja: t.hanja, place: english(t.place) };
}

/**
 * The card page: the menu's poster lettering at card size (src/ui/menu-cinematic.css). Every line that matters is at
 * least 34 px on the 1200 px card, so it still reads when KakaoTalk shrinks the card to a 300 px bubble; the title
 * is 150 px. Content stays 48 px inside the edges, which some apps trim.
 */
const CARD_STYLE = `
@font-face { font-family:'Imjin Title'; src:url('/fonts/imjin-title-dohyeon.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Imjin Battle'; src:url('/fonts/imjin-battle-dohyeon.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Imjin Roman'; src:url('/fonts/imjin-title-cinzel.woff2') format('woff2'); font-weight:400 900; font-display:block; }
@font-face { font-family:'Imjin Serif'; src:url('/fonts/imjin-serif-notoserifkr.woff2') format('woff2'); font-weight:200 900; font-display:block; }
html,body { margin:0; width:${CARD_SIZE.width}px; height:${CARD_SIZE.height}px; overflow:hidden; background:#07121b; }
body { position:relative; font-family:'Pretendard Variable',Pretendard,sans-serif; color:#f4eedc; }
.still { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.shade { position:absolute; inset:0; background:
  linear-gradient(90deg, rgba(4,9,15,.82) 0%, rgba(4,9,15,.62) 30%, rgba(4,9,15,.18) 55%, rgba(4,9,15,0) 70%),
  linear-gradient(0deg, rgba(4,9,15,.7) 0%, rgba(4,9,15,.22) 34%, rgba(4,9,15,0) 55%),
  linear-gradient(180deg, rgba(4,9,15,.45) 0%, rgba(4,9,15,0) 22%); }
.brand { position:absolute; left:56px; top:44px; display:flex; align-items:center; gap:14px; }
.brand b { font-family:'Imjin Title'; font-weight:400; font-size:44px; line-height:1; letter-spacing:-.03em; -webkit-text-stroke:.02em #f4eedc; }
.seal { display:grid; place-content:center; background:#863a30; color:#e8cfb2; font-family:'Imjin Serif',serif; font-weight:600; line-height:1.15; text-align:center; transform:rotate(5deg); clip-path:polygon(3% 2%,94% 0,100% 7%,97% 96%,6% 100%,0 94%); }
.brand .seal { width:30px; height:42px; font-size:13px; }
.brand i { font-style:normal; font-family:'Imjin Roman'; font-weight:600; font-size:30px; letter-spacing:.22em; }
.block { position:absolute; left:56px; bottom:48px; display:flex; flex-direction:column; align-items:flex-start; }
.kicker { font-family:'Noto Serif KR',serif; font-weight:700; font-size:34px; letter-spacing:.06em; line-height:1.1; color:#d8c69c; text-shadow:0 2px 14px rgba(3,8,13,.9); white-space:nowrap; }
.kicker small { font-weight:500; font-size:30px; letter-spacing:.24em; margin-left:.4em; }
.title { margin:10px 0 0 -4px; font-family:'Imjin Battle'; font-weight:400; font-size:150px; line-height:.95; letter-spacing:-.035em; white-space:nowrap; -webkit-text-stroke:.026em #f4eedc; paint-order:stroke fill; filter:drop-shadow(0 3px 0 rgba(8,18,26,.8)) drop-shadow(0 10px 28px rgba(3,8,13,.85)); }
.place { margin-top:14px; font-size:40px; font-weight:600; letter-spacing:-.01em; color:#f4efe2; text-shadow:0 2px 14px rgba(3,8,13,.95); white-space:nowrap; }
.en .kicker { font-family:'Imjin Roman'; font-weight:600; font-size:30px; letter-spacing:.14em; }
.pre { display:flex; align-items:center; gap:18px; margin-top:16px; font-family:'Imjin Roman'; font-weight:500; font-size:30px; letter-spacing:.42em; text-transform:uppercase; }
.pre::after { content:''; width:90px; height:2px; background:currentColor; opacity:.7; }
.name { margin:4px 0 0 -3px; font-family:'Imjin Roman'; font-weight:700; font-size:118px; line-height:1; letter-spacing:.02em; text-transform:uppercase; white-space:nowrap; filter:drop-shadow(0 3px 0 rgba(8,18,26,.8)) drop-shadow(0 10px 28px rgba(3,8,13,.85)); }
.site { position:absolute; right:52px; bottom:44px; font-size:26px; font-weight:600; letter-spacing:.02em; color:rgba(244,239,226,.92); text-shadow:0 2px 12px rgba(3,8,13,.95); }
/* The front card: the menu's lockup, the tagline above, the hanja running down beside the title, the seal, the years. */
.front .shade { background:linear-gradient(90deg,rgba(4,9,15,.8) 0%,rgba(4,9,15,.62) 30%,rgba(4,9,15,.2) 52%,rgba(4,9,15,0) 66%),linear-gradient(180deg,rgba(4,9,15,.2) 0%,rgba(4,9,15,0) 30%,rgba(4,9,15,0) 66%,rgba(4,9,15,.42) 100%); }
.lockup { position:absolute; left:56px; top:0; bottom:0; width:520px; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.tagline { font-family:'Imjin Serif',serif; font-weight:300; font-size:30px; line-height:1; letter-spacing:.5em; margin-right:-.5em; white-space:nowrap; color:rgba(255,255,255,.86); text-shadow:0 1px 14px rgba(3,8,13,.85); }
.front.en .tagline { font-family:'Imjin Roman'; font-weight:500; font-size:22px; letter-spacing:.32em; margin-right:-.32em; text-transform:uppercase; }
.mark { position:relative; margin-top:26px; }
.mark .hanja { position:absolute; right:100%; top:50%; margin-right:26px; transform:translateY(-50%); writing-mode:vertical-rl; font-family:'Imjin Serif',serif; font-weight:400; font-size:24px; line-height:1; letter-spacing:.34em; color:rgba(255,255,255,.78); text-shadow:0 1px 12px rgba(3,8,13,.8); }
.mark h1 { margin:0; font-family:'Imjin Title'; font-weight:400; font-size:168px; line-height:.9; letter-spacing:-.04em; padding-right:.04em; white-space:nowrap; -webkit-text-stroke:.026em #f4eedc; paint-order:stroke fill; filter:drop-shadow(0 3px 0 #08121a) drop-shadow(0 12px 30px rgba(3,8,13,.8)); }
.mark .seal { position:absolute; right:-44px; bottom:22px; width:34px; height:48px; font-size:15px; box-shadow:0 0 0 2px #863a30; }
.the { display:flex; align-items:center; gap:.9em; font-family:'Imjin Roman'; font-weight:500; font-size:34px; letter-spacing:.62em; margin-right:-.62em; margin-top:22px; }
.the::before, .the::after { content:''; width:2.2em; height:2px; background:currentColor; opacity:.7; }
.the::after { margin-left:-.62em; }
.roman { margin-top:6px; font-family:'Imjin Roman'; font-weight:600; font-size:96px; line-height:1; letter-spacing:.07em; margin-right:-.07em; white-space:nowrap; filter:drop-shadow(0 3px 0 #08121a) drop-shadow(0 12px 30px rgba(3,8,13,.8)); }
.years { display:flex; align-items:center; gap:22px; margin-top:26px; font-family:'Imjin Roman'; font-weight:600; font-size:30px; color:#d8c69c; white-space:nowrap; }
.years span { letter-spacing:.32em; margin-right:-.32em; }
.years i { width:84px; height:2px; background:linear-gradient(90deg,transparent,rgba(216,198,156,.85)); }
.years i:last-child { transform:scaleX(-1); }
.line { margin-top:26px; padding:10px 22px; border-top:1px solid rgba(214,196,154,.5); border-bottom:1px solid rgba(214,196,154,.35); font-size:34px; font-weight:600; letter-spacing:.01em; white-space:nowrap; color:#f4efe2; text-shadow:0 1px 12px rgba(3,8,13,.95); }
`;

function cardPage(lang, id) {
  const en = lang === 'en';
  if (!id) {
    const site = en ? 'imjin1592.com/en' : 'imjin1592.com';
    const mark = en
      ? `<div class="tagline">${escapeHtml(english('나라를 지킨 바다'))}</div><div class="the">The</div><div class="roman">IMJIN WAR</div>`
      : `<div class="tagline">나라를 지킨 바다</div><div class="mark"><span class="hanja">壬辰倭亂</span><h1>임진왜란</h1><span class="seal">海<br>戰</span></div>`;
    return `<body class="front ${lang}"><img class="still" src="/still.jpg" alt=""><div class="shade"></div>
      <div class="lockup">${mark}<div class="years"><i></i><span>1592 — 1598</span><i></i></div><div class="line">${site}</div></div></body>`;
  }
  const t = battleText(id, lang);
  const brand = en ? '<div class="brand"><i>THE IMJIN WAR</i></div>' : '<div class="brand"><b>임진왜란</b><span class="seal">海<br>戰</span></div>';
  const title = en ? `${t.pre ? `<div class="pre">${t.pre}</div>` : ''}<div class="name" id="fit">${escapeHtml(t.title)}</div>` : `<div class="title" id="fit">${t.title}</div>`;
  return `<body class="${lang}"><img class="still" src="/still.jpg" alt=""><div class="shade"></div>${brand}
    <div class="block"><div class="kicker">${escapeHtml(t.date)}<small>${t.hanja}</small></div>${title}<div class="place">${escapeHtml(t.place)}</div></div>
    <div class="site">${en ? 'imjin1592.com/en' : 'imjin1592.com'}</div></body>`;
}

/** Renders one card at twice its size and keeps it as a JPEG of the card size. */
async function renderCard(browser, lang, id, still, out) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700&display=block">
<style>${CARD_STYLE}</style></head>${cardPage(lang, id)}
<script>
  // A long name shrinks to the room left of the picture's subject.
  document.fonts.ready.then(() => {
    const t = document.getElementById('fit');
    if (t) for (let s = parseFloat(getComputedStyle(t).fontSize); t.scrollWidth > 700 && s > 60; s -= 2) t.style.fontSize = s + 'px';
    document.body.dataset.ready = '1';
  });
</script></html>`;
  const tab = await browser.newPage({ viewport: { width: CARD_SIZE.width, height: CARD_SIZE.height }, deviceScaleFactor: 2 });
  try {
    // A made-up origin serves the card and its local files; Pretendard and Noto Serif KR come from their CDNs.
    await tab.route('https://og.card/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      if (path === '/still.jpg') return route.fulfill({ body: still, contentType: 'image/jpeg' });
      const font = path.startsWith('/fonts/') && join(FONTS, path.slice(7));
      return font && existsSync(font) ? route.fulfill({ body: readFileSync(font), contentType: 'font/woff2' }) : route.fulfill({ status: 404 });
    });
    await tab.goto('https://og.card/', { waitUntil: 'networkidle' });
    await tab.waitForFunction(() => document.body.dataset.ready === '1');
    const png = await tab.screenshot();
    await sharp(png).resize(CARD_SIZE.width, CARD_SIZE.height, { kernel: 'lanczos3' }).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
    console.log(`wrote ${out}`);
  } finally {
    await tab.close();
  }
}

/** The 2:1 window of a wide still, at twice the card size, `at` from its top (0) to its bottom (1). */
async function cardStill(img, at) {
  const meta = await img.metadata();
  const height = Math.round(meta.width / 2);
  const top = Math.round((meta.height - height) * at);
  return img.extract({ left: 0, top, width: meta.width, height }).resize(CARD_SIZE.width * 2, CARD_SIZE.height * 2, { kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer();
}

async function compose() {
  const only = args.only ? args.only.split(',') : ['front', ...BATTLE_SLUGS];
  mkdirSync(join(ROOT, 'public', 'og'), { recursive: true });
  const browser = await launch();
  try {
    for (const id of only) {
      if (id === 'front') {
        const still = await cardStill(sharp(FRONT_STILL), 0.5);
        for (const lang of ['ko', 'en']) await renderCard(browser, lang, null, still, join(ROOT, 'public', cardFile(null, lang)));
        continue;
      }
      const plan = SHOTS[id];
      const wide = join(SOURCE_DIR, `${id}-wide.jpg`);
      const tall = join(SOURCE_DIR, `${id}-tall.jpg`);
      if (!existsSync(wide) || !existsSync(tall)) throw new Error(`${id}: no stills in ${SOURCE_DIR} (--capture first)`);
      const wideBuf = await (await graded(wide, plan.grade)).png().toBuffer();
      const still = await cardStill(sharp(wideBuf), plan.card);
      for (const lang of ['ko', 'en']) await renderCard(browser, lang, id, still, join(ROOT, 'public', cardFile(id, lang)));
      // The loading pictures carry no text: the page sets it, translated and selectable.
      const out = (name, buf) => {
        writeFileSync(join(ART, name), buf);
        console.log(`wrote ${name} ${(buf.length / 1024).toFixed(0)} KB`);
      };
      out(`loading_${id}.webp`, await sharp(wideBuf).resize(1920, 1080, { kernel: 'lanczos3' }).webp({ quality: 70, effort: 6 }).toBuffer());
      out(`loading_${id}_sm.webp`, await sharp(wideBuf).resize(960, 540, { kernel: 'lanczos3' }).webp({ quality: 72, effort: 6 }).toBuffer());
      const tallBuf = await (await graded(tall, plan.grade)).png().toBuffer();
      out(`loading_${id}_tall.webp`, await sharp(tallBuf).resize(828, 1792, { kernel: 'lanczos3' }).webp({ quality: 70, effort: 6 }).toBuffer());
    }
  } finally {
    await browser.close();
  }
}

/** A contact sheet: the pictures `width` wide in `cols` columns, each under its file name, on KakaoTalk's chat blue. */
async function contact(files, cols, width, out) {
  const cells = await Promise.all(files.map(async (file) => sharp(file).resize({ width, kernel: 'lanczos3' }).toBuffer({ resolveWithObject: true })));
  const label = 22;
  const gap = 12;
  const rowHeight = Math.max(...cells.map((c) => c.info.height)) + label;
  const rows = Math.ceil(files.length / cols);
  const tiles = cells.flatMap((c, i) => {
    const left = gap + (i % cols) * (width + gap);
    const top = gap + Math.floor(i / cols) * (rowHeight + gap);
    const name = basename(files[i]);
    const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${label}"><text x="2" y="16" font-family="Segoe UI, sans-serif" font-size="14" fill="#1b2733">${name}</text></svg>`);
    return [{ input: text, left, top }, { input: c.data, left, top: top + label }];
  });
  await sharp({ create: { width: gap + cols * (width + gap), height: gap + rows * (rowHeight + gap), channels: 3, background: '#b6c4d4' } }).composite(tiles).jpeg({ quality: 88 }).toFile(out);
  console.log(`wrote ${out}`);
}

/** Every card at full size, then every card at the 300 px a KakaoTalk bubble shows, one sheet each. */
async function sheet(dir) {
  mkdirSync(dir, { recursive: true });
  const cards = ['front', ...BATTLE_SLUGS].flatMap((id) => ['ko', 'en'].map((lang) => join(ROOT, 'public', cardFile(id === 'front' ? null : id, lang))));
  await contact(cards, 2, CARD_SIZE.width, join(dir, 'cards-full.jpg'));
  await contact(cards, 4, 300, join(dir, 'cards-300.jpg'));
}

if (args.capture) await capture();
else if (args.keep) await keep();
else if (args.sheet) await sheet(args.sheet);
else await compose();
