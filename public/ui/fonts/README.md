# Title and hanja lettering

The menu's title lockup (`src/ui/menu-cinematic.css`) uses three subset fonts, the loading page and the link cards a fourth, and the hanja of captions, titles and names a fifth and sixth, each under the SIL Open Font License included beside it. None of the families has reserved font names.

## Do Hyeon: `imjin-title-dohyeon.woff2`

Only the four glyphs in `임진왜란`. A subset of [Do Hyeon](https://github.com/google/fonts/tree/main/ofl/dohyeon) (BM DOHYEON by Woowa Brothers), `OFL-DoHyeon.txt`. The family has a single weight; the menu thickens it with a text stroke of its own colour.

Source: `DoHyeon-Regular.ttf` from google/fonts, SHA-256 `35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653`.

Reproduction: `python -m fontTools.subset DoHyeon-Regular.ttf --text=임진왜란 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-title-dohyeon.woff2`. The copyright and license name entries are kept.

## Do Hyeon, battle titles: `imjin-battle-dohyeon.woff2`

The loading page's poster title and the link cards (`scripts/build-battle-art.mjs`): the glyphs of every battle name they set, which are the nine historical battles (`src/sim/scenarioText.ts`), every campaign region's battle (`<region> 해전`, the region names in `src/sim/grand/regions.ts`), the conquest maps (`src/sim/maps.ts`) and 임진왜란, 80 glyphs with the middle dot. Same source file and license as above. A new region or map name means cutting it again with the new text; a missing syllable would fall back to the page's other faces.

Reproduction: `python -m fontTools.subset DoHyeon-Regular.ttf --text=가거견고골교금기김나남내노녹다답당대덕도동둥등란량려령리마명목문미발방배부사산생서선성소수순시쓰아안야어여영오옥왜요울율이임장쟁전제조죽진천첩칠탈포한합항해회· --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-battle-dohyeon.woff2`.

## Cinzel: `imjin-title-cinzel.woff2`

The English title, the years and the English billing. Printable ASCII plus a few marks (no-break space, middle dot, Ō/ō, dashes, curly quotes, ellipsis), with the weight axis (400-900) kept. [Cinzel](https://github.com/google/fonts/tree/main/ofl/cinzel) by Natanael Gama, `OFL-Cinzel.txt`.

Source: `Cinzel[wght].ttf` from google/fonts, SHA-256 `f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34`.

Reproduction: `python -m fontTools.subset "Cinzel[wght].ttf" --unicodes=U+0020-007E,U+00A0,U+00B7,U+014C,U+014D,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-title-cinzel.woff2`.

## Noto Serif KR: `imjin-serif-notoserifkr.woff2`

The Korean tagline, the hanja and the seal: only `나라를지킨바다壬辰倭亂海戰朝鮮明日本`, with the weight axis (200-900) kept. [Noto Serif KR](https://github.com/google/fonts/tree/main/ofl/notoserifkr) by Google, `OFL-NotoSerifKR.txt`. Changing the tagline (`나라를 지킨 바다` in `src/ui/Screens.tsx`) means cutting the subset again with the new text.

Source: `NotoSerifKR[wght].ttf` from google/fonts, SHA-256 `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3`.

Reproduction: `python -m fontTools.subset "NotoSerifKR[wght].ttf" --text=나라를지킨바다壬辰倭亂海戰朝鮮明日本 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-serif-notoserifkr.woff2`.

## Shippori Mincho B1, the hanja face: `imjin-hanja-shippori-400.woff2`, `imjin-hanja-shippori-600.woff2`

The hanja the game sets apart from its Korean: the cinema's captions, quotes and titles (`src/ui/cinema.css`), the loading page's kicker, the codex's native names, the campaign's region names and the battle brief (`var(--hanja)` in `src/ui/styles.css`), and the link cards' kicker (`scripts/build-battle-art.mjs`). [Shippori Mincho B1](https://github.com/google/fonts/tree/main/ofl/shipporiminchob1) by FONTDASU, `OFL-ShipporiMinchoB1.txt`: a mincho whose ink pools at the ends of the strokes as in a woodblock print, with the traditional forms the records use (靑, 黃, 黑, 將, 戰, 愼). It was chosen over Yuji Syuku, Yuji Boku and Yuji Mai (brush faces that lack 卧 唬 尙 旣 璘 翎), Zen Antique (lacks 黃 卽 狀 among others), Noto Serif TC and KR (each lacks four or five, Noto Serif KR among them 卧 and 皷 of the Noryang caption) and LXGW WenKai TC (complete, but a handwritten regular script that reads informal in a title); Ma Shan Zheng and Zhi Mang Xing cover simplified Chinese only and lack 142 of the characters. Only 唬 (唬船, the codex's Hu boat) is missing, and comes from the face below.

Sources: `ShipporiMinchoB1-Regular.ttf`, SHA-256 `89403e4b2a9ca0db9f832b893cfbfd90506c7c674cd640ba8a0ee128c34de7a4`, and `ShipporiMinchoB1-SemiBold.ttf`, SHA-256 `2d0dfceb662d522c9dd643f6822e9af2def6b0a0186ed5cb303463d2ed8f5c06`, from google/fonts.

## Noto Serif TC, what Shippori Mincho B1 lacks: `imjin-hanja-notoseriftc.woff2`

Listed after the hanja face as `'Imjin Hanja TC'`, so the browser takes from it only what the first face lacks. [Noto Serif TC](https://github.com/google/fonts/tree/main/ofl/notoseriftc) by Google, `OFL-NotoSerifTC.txt`, with the weight axis kept.

Source: `NotoSerifTC[wght].ttf` from google/fonts, SHA-256 `0077e18f57c6908f4a000969880940bdb0dad057c0e8d98b49dc364c3d1b09c6`.

Reproduction of both: `node scripts/hanja-fonts.mjs --src=<folder with the three source files>` (Python with fontTools and brotli). It gathers every hanja of the `hanja:` and `native:` fields across `src/` and the navies' seals (275 characters), cuts the two Shippori weights, asks fontTools which of them Shippori lacks and cuts those from Noto Serif TC. Rerun it after a new caption, region or ship name with a new character.

## Yuji Boku, the flags' brush (not served)

The characters painted on the ships' flags (帥 將 赤 靑 黃 白 黑 明 and 八幡大菩薩) are drawn into the ship atlases by `scripts/flag-art/flag_art.py` from `scripts/flag-art/yujiboku-flags.ttf`, a subset of [Yuji Boku](https://github.com/google/fonts/tree/main/ofl/yujiboku) by the Yuji Project Authors (`scripts/flag-art/OFL-YujiBoku.txt`): a heavy brush face that holds its shape on a flag seen from across the water. Source `YujiBoku-Regular.ttf` from google/fonts, SHA-256 `94fda16384f3bdac24376a000c57e99abfa314961bd89ef27badfb7410322003`; `python -m fontTools.subset YujiBoku-Regular.ttf --text=帥將赤靑黃白黑明八幡大菩薩 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=yujiboku-flags.ttf`.
