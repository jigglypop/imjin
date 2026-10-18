// Every ready chapter is a whole chapter: its battles build with both its navies, its flagship and every ship of its
// navies build inside the LOD budgets, each navy maps back to the chapter and has a competitive price, and the
// chapter's player text has its English. The rules are in .claude/skills/chapters/SKILL.md.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-chapters-'));
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`ok - ${name}`); };
try {
  const bundled = await build({
    stdin: {
      contents: `export { CHAPTERS, chapterOfFaction } from './src/chapters/index.ts'; export { battlesOf } from './src/routes.ts'; export { SCENARIOS, buildScenario } from './src/sim/scenarios.ts'; export { SHIP_SPECS } from './src/sim/catalog.ts'; export { COMPETITIVE_UNITS } from './src/sim/competitive.ts'; export { buildShip } from './src/ships/build/ShipBuilder.ts'; export { modelKind } from './src/ships/anchors.ts'; export { EN } from './src/i18n/en/index.ts'; export { teamOf } from './src/sim/types.ts';`,
      resolveDir: root,
    },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'chapters.mjs');
  await writeFile(path, bundled.outputFiles[0].contents);
  const { CHAPTERS, chapterOfFaction, battlesOf, SCENARIOS, buildScenario, SHIP_SPECS, COMPETITIVE_UNITS, buildShip, modelKind, EN, teamOf } = await import(pathToFileURL(path).href);
  const ready = CHAPTERS.filter((c) => c.ready);
  const kindsOf = (navies) => Object.keys(SHIP_SPECS).filter((k) => navies.includes(SHIP_SPECS[k].faction));

  for (const c of ready) {
    const navies = c.navies.flat();
    check(`${c.id}: its navies belong to it and sail on opposite sides`, () => {
      assert.ok(c.navies[0].length && c.navies[1].length);
      for (const f of navies) assert.equal(chapterOfFaction(f), c.id, f);
      assert.notEqual(teamOf(c.navies[0][0]), teamOf(c.navies[1][0]));
    });
    check(`${c.id}: at least four historical battles, each building with both sides`, () => {
      const slugs = battlesOf(c.id);
      assert.ok(slugs.length >= 4, `${slugs.length} battles`);
      for (const id of slugs) {
        assert.ok(SCENARIOS[id], `${id} has a scenario`);
        const b = buildScenario(id, 0);
        const factions = new Set(b.ships.map((s) => s.spec.faction));
        assert.ok(b.ships.some((s) => s.team === 'joseon') && b.ships.some((s) => s.team === 'japan'), `${id} has two fleets`);
        for (const f of factions) assert.ok(navies.includes(f), `${id}: ${f} is not a navy of ${c.id}`);
      }
    });
    check(`${c.id}: the flagship and every ship build, far level <= 900 triangles, near level a full model`, () => {
      assert.ok(SHIP_SPECS[c.hero.kind], `hero ${c.hero.kind}`);
      assert.ok(navies.includes(SHIP_SPECS[c.hero.kind].faction), 'the hero sails for this chapter');
      for (const kind of kindsOf(navies)) {
        const lods = buildShip(modelKind(kind), 0).lods;
        const tris = lods.map((l) => l.index.length / 3);
        assert.ok(tris[2] > 0 && tris[2] <= 900, `${kind} far ${tris[2]}`);
        assert.ok(tris[0] >= 3000, `${kind} near ${tris[0]}`);
        assert.ok(tris[0] > tris[1] && tris[1] > tris[2], `${kind} levels ${tris}`);
      }
    });
    check(`${c.id}: every ship has a competitive price`, () => {
      for (const kind of kindsOf(navies)) assert.ok(COMPETITIVE_UNITS[kind]?.spec?.cost > 0, kind);
    });
    if (c.id !== 'imjin') {
      check(`${c.id}: the poster, campaign and history lines have their English`, () => {
        for (const s of [c.title, c.campaign, c.history, ...c.billing.flatMap((b) => [b.side, ...b.names])]) assert.ok(EN[s], `no English for ${s}`);
        for (const id of battlesOf(c.id)) for (const s of [SCENARIOS[id].title, SCENARIOS[id].summary, SCENARIOS[id].result]) assert.ok(EN[s], `no English for ${s}`);
      });
    }
  }
  console.log(`${passed} chapter checks passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
