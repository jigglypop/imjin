import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * imjin1592.com/en: the same page with lang="en" and English link-preview tags, so a link posted for English speakers
 * opens in English and previews in English. Written next to the built index.html; the deploy uploads it under `en`.
 * The app starts in English from the path (src/i18n/index.ts).
 */
function englishEdition(): Plugin {
  let outDir = 'dist';
  const swap = (html: string, from: string | RegExp, to: string) => {
    const next = html.replace(from, to);
    if (next === html) throw new Error(`english edition: ${String(from)} not found in index.html`);
    return next;
  };
  const meta = (html: string, attr: 'name' | 'property', key: string, value: string) => swap(html, new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), `$1${value}$2`);
  return {
    name: 'english-edition',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const title = 'The Imjin War · 임진왜란';
      const description = 'Thirteen ships against 133 at Myeongnyang. Command the naval battles of the Imjin War in 3D, free in your browser.';
      let html = readFileSync(join(outDir, 'index.html'), 'utf8');
      html = swap(html, '<html lang="ko">', '<html lang="en">');
      html = swap(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
      html = meta(html, 'name', 'description', 'A 3D naval strategy game about the Imjin War (1592–1598): nine historical battles, a three-faction campaign and online play, free in your browser.');
      html = swap(html, '<link rel="canonical" href="https://imjin1592.com/" />', '<link rel="canonical" href="https://imjin1592.com/en" />');
      html = meta(html, 'property', 'og:title', title);
      html = meta(html, 'property', 'og:description', description);
      html = meta(html, 'property', 'og:url', 'https://imjin1592.com/en');
      html = meta(html, 'property', 'og:image', 'https://imjin1592.com/og-en.jpg');
      html = meta(html, 'property', 'og:image:secure_url', 'https://imjin1592.com/og-en.jpg');
      html = meta(html, 'property', 'og:image:alt', 'The Imjin War · panokseon and a turtle ship sailing through the mist');
      html = meta(html, 'property', 'og:locale', 'en_US');
      html = meta(html, 'property', 'og:locale:alternate', 'ko_KR');
      html = meta(html, 'name', 'twitter:title', title);
      html = meta(html, 'name', 'twitter:description', description);
      html = meta(html, 'name', 'twitter:image', 'https://imjin1592.com/og-en.jpg');
      html = meta(html, 'name', 'apple-mobile-web-app-title', 'The Imjin War');
      mkdirSync(join(outDir, 'en'), { recursive: true });
      writeFileSync(join(outDir, 'en', 'index.html'), html);
    },
  };
}

export default defineConfig({
  plugins: [react(), englishEdition()],
  server: { port: 5291, host: '127.0.0.1', strictPort: true },
  build: { target: ['es2022', 'safari16'], chunkSizeWarningLimit: 4000 },
});
