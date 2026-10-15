# Menu title lettering

The menu's title lockup (`src/ui/menu-cinematic.css`) uses three subset fonts, each under the SIL Open Font License included beside it. None of the families has reserved font names.

## Do Hyeon: `imjin-title-dohyeon.woff2`

Only the four glyphs in `임진왜란`. A subset of [Do Hyeon](https://github.com/google/fonts/tree/main/ofl/dohyeon) (BM DOHYEON by Woowa Brothers), `OFL-DoHyeon.txt`. The family has a single weight; the menu thickens it with a text stroke of its own colour.

Source: `DoHyeon-Regular.ttf` from google/fonts, SHA-256 `35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653`.

Reproduction: `python -m fontTools.subset DoHyeon-Regular.ttf --text=임진왜란 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-title-dohyeon.woff2`. The copyright and license name entries are kept.

## Cinzel: `imjin-title-cinzel.woff2`

The English title, the years and the English billing. Printable ASCII plus a few marks (no-break space, middle dot, Ō/ō, dashes, curly quotes, ellipsis), with the weight axis (400-900) kept. [Cinzel](https://github.com/google/fonts/tree/main/ofl/cinzel) by Natanael Gama, `OFL-Cinzel.txt`.

Source: `Cinzel[wght].ttf` from google/fonts, SHA-256 `f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34`.

Reproduction: `python -m fontTools.subset "Cinzel[wght].ttf" --unicodes=U+0020-007E,U+00A0,U+00B7,U+014C,U+014D,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-title-cinzel.woff2`.

## Noto Serif KR: `imjin-serif-notoserifkr.woff2`

The Korean tagline, the hanja and the seal: only `나라를지킨바다壬辰倭亂海戰朝鮮明日本`, with the weight axis (200-900) kept. [Noto Serif KR](https://github.com/google/fonts/tree/main/ofl/notoserifkr) by Google, `OFL-NotoSerifKR.txt`. Changing the tagline (`나라를 지킨 바다` in `src/ui/Screens.tsx`) means cutting the subset again with the new text.

Source: `NotoSerifKR[wght].ttf` from google/fonts, SHA-256 `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3`.

Reproduction: `python -m fontTools.subset "NotoSerifKR[wght].ttf" --text=나라를지킨바다壬辰倭亂海戰朝鮮明日本 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-serif-notoserifkr.woff2`.

## Do Hyeon: `imjin-routes-dohyeon.woff2`

The screens' names on the loading screens (`index.html`, `src/ui/routeLoading.ts`), set in the title's face: only the glyphs of `캠페인 쟁탈전 역사 전투 온라인 대전 설정` (src/routes.ts) beyond the four in `임진왜란`, 2.6 KB. Same source and licence as `imjin-title-dohyeon.woff2`. Renaming a screen means cutting the subset again with the new name.

Reproduction: `python -m fontTools.subset DoHyeon-Regular.ttf --text=캠페인쟁탈전역사투온라대설정 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-routes-dohyeon.woff2`.
