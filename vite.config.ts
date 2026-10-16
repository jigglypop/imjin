import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { EN_BRIEFING } from './src/i18n/en/briefing.js';
import { EN_COMMON } from './src/i18n/en/common.js';
import { EN_SIM } from './src/i18n/en/sim.js';
import { SCENARIO_TEXT } from './src/sim/scenarioText.js';
import { CARD_SIZE, SITE_NAME, cardFile, routeName, routePages, routePath, type BattleSlug, type Edition, type RoutePage, type RouteScreen } from './src/routes.js';

const SITE = 'https://imjin1592.com';

/**
 * Folders the dev server does not watch: the agents' worktrees (.claude) and the screenshots (shots) hold tens of
 * gigabytes, and crawling them slowed every module load to tens of seconds. The game imports nothing from any of them.
 * The patterns are absolute so that a dev server started inside a worktree, which itself lives under .claude, still
 * watches its own files.
 */
const UNWATCHED = ['.claude', 'shots', 'assets-src', 'dist', 'server/dist'].map((dir) => `${normalizePath(join(import.meta.dirname, dir))}/**`);

/**
 * Each checkout keeps its own optimized-dependency cache. Worktrees reach node_modules through a symlink, so the default
 * node_modules/.vite was one cache for every dev server: one server re-optimizing replaced the files another server's
 * open page still asked for, and that page failed with "504 Outdated Optimize Dep".
 */
const CACHE_DIR = join(import.meta.dirname, '.vite');

/** What search results and link previews say about each screen's page. Korean is the source. */
const DESCRIPTIONS: Record<Exclude<RouteScreen, 'menu'>, Record<Edition, string>> = {
  faction: {
    ko: '조선, 명, 일본 중 한 나라를 골라 남해안의 포구를 차례로 차지하는 턴제 캠페인입니다. 함대가 만나면 3D 해전으로 직접 싸울 수 있습니다.',
    en: "A turn-based campaign: lead Joseon, Ming or Japan and take the ports of Korea's south coast one by one. When fleets meet, you can fight the battle yourself in 3D.",
  },
  skirmish: {
    ko: '거점을 차지해 적의 기세를 꺾는 3D 해전입니다. 조선, 명, 일본 중 한 진영의 함대를 꾸려 컴퓨터와 겨룹니다.',
    en: 'A 3D naval battle over capture points: hold them to wear the enemy down. Muster a fleet for Joseon, Ming or Japan and fight the computer.',
  },
  select: {
    ko: '옥포, 한산도, 명량, 노량 등 임진왜란의 해전 아홉 곳을 3D로 직접 지휘합니다.',
    en: 'Command nine naval battles of the Imjin War in 3D, from Okpo and Hansando to Myeongnyang and Noryang.',
  },
  online: {
    ko: '다른 플레이어와 실시간으로 겨룹니다. 쟁탈전과 역사 전투 대전, 빠른 대전, 랭크전이 있습니다.',
    en: 'Play other people in real time: conquest and historical battle matches, quick match and ranked play.',
  },
  settings: {
    ko: '표시 언어, 소리, 기기 등급, 카메라 흔들림 설정과 조작 안내입니다.',
    en: 'Language, sound, device tier and camera shake settings, and the controls.',
  },
  codex: {
    ko: '판옥선과 거북선, 아타케부네와 명의 복선까지 임진왜란의 함선을 3D로 돌려 보고 갑판에 올라 봅니다. 제원, 사료, 실제 크기 비교가 함께 있습니다.',
    en: 'Turn the ships of the Imjin War around in 3D and step aboard, from the panokseon and the turtle ship to the atakebune and the Ming war junk, with their specifications, sources and a true-scale comparison.',
  },
};

/** The English front page (imjin1592.com/en). The Korean one is index.html as written. */
const ENGLISH_FRONT = {
  title: 'MOONWAKE: The Imjin War',
  description: 'A 3D naval strategy game about the Imjin War (1592–1598): nine historical battles, a three-faction campaign and online play, free in your browser.',
  preview: 'Thirteen ships against 133 at Myeongnyang. Command the naval battles of the Imjin War in 3D, free in your browser.',
  alt: 'MOONWAKE: The Imjin War · a dragon-headed turtle ship ploughing through rough seas at sunset',
};

/** The English for a page's text, from the game's own dictionaries, so a page's title matches the tab title in the game. */
function english(ko: string): string {
  const text = EN_COMMON[ko] ?? EN_SIM[ko] ?? EN_BRIEFING[ko];
  if (!text) throw new Error(`route pages: no English for ${ko}`);
  return text;
}

/** How many characters of a link preview's description KakaoTalk shows in its two lines. */
const PREVIEW_LIMIT: Record<Edition, number> = { ko: 48, en: 100 };

/**
 * A battle's page: its name, the date and place with its one line for search results, the one line alone for the link
 * preview (KakaoTalk shows two lines of it under the picture), and its own card.
 */
function battlePage(id: BattleSlug, edition: Edition) {
  const text = SCENARIO_TEXT[id];
  const say = (ko: string) => (edition === 'en' ? english(ko) : ko);
  const name = say(text.title);
  const preview = say(text.hook);
  if ([...preview].length > PREVIEW_LIMIT[edition]) throw new Error(`route pages: ${id}'s line is longer than KakaoTalk's two lines: ${preview}`);
  return {
    name,
    description: `${say(text.date)}, ${say(text.place)}. ${preview}`,
    preview,
    alt: edition === 'en' ? `${name}, ${say(text.date)}: a scene from the game` : `${name} · ${text.date} · 게임 속 장면`,
  };
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** index.html (the Korean front page) rewritten for another page: its language, address, preview texts and card. */
function pageHtml(base: string, { screen, edition, path, battle }: RoutePage): string {
  let html = base;
  const swap = (from: RegExp, to: (...groups: string[]) => string) => {
    const next = html.replace(from, (_, ...groups: string[]) => to(...groups));
    if (next === html && !from.test(html)) throw new Error(`route pages: ${String(from)} not found in index.html`);
    html = next;
  };
  const meta = (attr: 'name' | 'property', key: string, value: string) => swap(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), (a, b) => a + escapeHtml(value) + b);
  const link = (rel: string, value: string) => swap(new RegExp(`(<link rel="${rel}" href=")[^"]*(")`), (a, b) => a + value + b);

  const en = edition === 'en';
  const front = screen === 'menu';
  const own = battle ? battlePage(battle, edition) : null;
  const name = routeName(screen);
  const site = en ? english(SITE_NAME) : SITE_NAME;
  const title = own ? `${own.name} · ${site}` : front ? ENGLISH_FRONT.title : `${en ? english(name) : name} · ${site}`;
  const description = own ? own.description : front ? ENGLISH_FRONT.description : DESCRIPTIONS[screen][edition];
  const preview = own ? own.preview : front ? ENGLISH_FRONT.preview : description;
  const url = SITE + path;
  const card = `${SITE}/${cardFile(battle ?? null, edition)}`;

  swap(/<html lang="ko">/, () => `<html lang="${edition}">`);
  swap(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  meta('name', 'description', description);
  link('canonical', url);
  for (const alt of ['ko', 'en', 'x-default']) {
    const href = SITE + routePath(screen, alt === 'en' ? 'en' : 'ko', battle);
    swap(new RegExp(`(<link rel="alternate" hreflang="${alt}" href=")[^"]*(")`), (a, b) => a + href + b);
  }
  meta('property', 'og:title', title);
  meta('property', 'og:description', preview);
  meta('property', 'og:url', url);
  meta('property', 'og:locale', en ? 'en_US' : 'ko_KR');
  meta('property', 'og:locale:alternate', en ? 'ko_KR' : 'en_US');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', preview);
  // A battle's page shows its own scene; every other English page the English front card. A Korean screen page keeps
  // index.html's card.
  if (own || en) {
    meta('property', 'og:image', card);
    meta('property', 'og:image:secure_url', card);
    meta('property', 'og:image:alt', own ? own.alt : ENGLISH_FRONT.alt);
    meta('name', 'twitter:image', card);
  }
  if (en) meta('name', 'apple-mobile-web-app-title', 'MOONWAKE');
  return html;
}

/** The Korean front page names the front card at the size every card is made in, so the other pages can swap in theirs. */
function checkFront(base: string) {
  const expect = [`content="${SITE}/${cardFile(null, 'ko')}"`, `"og:image:width" content="${CARD_SIZE.width}"`, `"og:image:height" content="${CARD_SIZE.height}"`];
  for (const text of expect) if (!base.includes(text)) throw new Error(`route pages: index.html should say ${text}`);
}

/**
 * One page per address (src/routes.ts): /campaign, /en/conquest, /battles/hansan and the rest are the same app with
 * that page's language and link-preview tags, so a shared link previews in its own language with its own picture and
 * the app opens on that screen. The deploy uploads each page under the keys scripts/route-pages.mjs lists.
 */
function routePagesPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'route-pages',
    apply: 'build',
    configResolved(config) {
      // --outDir may be absolute; resolve() keeps it so where join() glued it onto the root.
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const base = readFileSync(join(outDir, 'index.html'), 'utf8');
      checkFront(base);
      for (const page of routePages()) {
        if (page.file === 'index.html') continue;
        const file = join(outDir, page.file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, pageHtml(base, page));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), routePagesPlugin()],
  cacheDir: CACHE_DIR,
  server: { port: 5291, host: '127.0.0.1', strictPort: true, watch: { ignored: UNWATCHED } },
  build: { target: ['es2022', 'safari16'], chunkSizeWarningLimit: 4000 },
});
