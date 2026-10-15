# Menu title lettering

The menu's title lockup (`src/ui/menu-cinematic.css`) uses three subset fonts, and the loading page and the link cards a fourth, each under the SIL Open Font License included beside it. None of the families has reserved font names.

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
