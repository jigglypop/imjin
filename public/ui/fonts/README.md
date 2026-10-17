# MOONWAKE fonts

Three roles and a hanja fallback, nothing else (owner decision 2026-10-17, `.claude/skills/typography/SKILL.md`). The CSS variables are in `src/ui/styles.css`; canvas text reads the same stacks from `src/ui/fonts.ts`.

| Role | Variable | File | Font | License |
|---|---|---|---|---|
| Title | `--font-title` | `jeongmukbawi-regular.woff` | 정묵바위체 (SangSang Rock), 상상토끼 | 상상토끼 free-font terms (below) |
| Latin title fallback | in `--font-title` (first on `/en`) | `imjin-title-cinzel.woff2` | Cinzel | OFL, `OFL-Cinzel.txt` |
| Subtitles, dialogue, briefing, logs | `--font-cine` | `moonwake-cine-hahmlet.woff2` | 함렛 Hahmlet | OFL, `OFL-Hahmlet.txt` |
| UI, HUD | `--font-ui` | `moonwake-ui-sans.woff2` (family `MW UI Sans`) | Pretendard, renamed subset | OFL with Reserved Font Name, `OFL-Pretendard.txt` |
| Hanja | `--font-hanja` | `moonwake-hanja-notoserifkr.woff2` | Noto Serif KR | OFL, `OFL-NotoSerifKR.txt` |

The OFL subsets cover KS X 1001's 2,350 Hangul syllables, printable ASCII and every other mark the game's source sets (the Hanja file: the 477 hanja in `src/`). Text with a syllable or hanja outside them falls to the next face in the stack: cut again with the new text.

## 정묵바위체: `jeongmukbawi-regular.woff`

By 상상토끼 (SangSang Tokki) from the calligraphy of 정묵 김덕수. Official page: https://sangsangfont.com/21/?idx=122 (free, "개인/기업/상업적인 모든 분야에서 사용을 허락합니다", "폰트 임베딩 지원"). The official download is a TTF/OTF pack behind a 0-won checkout with a log-in, which an automated session cannot do. The file here is the web font the noonnu catalogue serves for it, `https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/SangSangRockOTF.woff` (https://noonnu.cc/font_page/395), byte for byte, SHA-256 `c3f288d4b30ae94b668fe13e7ce1ca7c7aee2b082ab56b2be8e19d83bd8c046f`.

License as listed (noonnu, quoting 상상토끼): print, web, packaging, video, embedding (web sites, apps, e-books) and BI/CI allowed; "재배포는 가능하나 상업적 재판매와 폰트 파일의 수정은 절대 금지" (redistribution allowed; reselling and modifying the font file forbidden). 상상토끼 may use part of a work made with its free fonts to promote them. Because modifying the file is forbidden, it is **not** subset and not converted to WOFF2: it is served as distributed, 3.3 MB (2,350 + 129 Hangul, Latin, marks; no hanja, which fall to Noto Serif KR). It is preloaded only on wide screens (`index.html`); phones load it with `font-display: swap`.

Owner to do: download the official pack from the 상상토끼 page while logged in, keep its license file here, and replace this file with the officially distributed one if it differs; ask 상상토끼 whether a subset is allowed, which would cut the file to a few KB.

## Hahmlet: `moonwake-cine-hahmlet.woff2`

[Hahmlet](https://github.com/hyper-type/hahmlet) by Hypertype, from google/fonts `ofl/hahmlet/Hahmlet[wght].ttf`, SHA-256 `892bffe530255770a7435226154a02f519055ff6bedf64254f37f21d15a59279`. No Reserved Font Name. Weight axis limited to 500-800 (subtitles never go lighter than 500).

## Pretendard: `moonwake-ui-sans.woff2`

[Pretendard](https://github.com/orioncactus/pretendard) v1.3.9 by Kil Hyung-jin, `public/variable/PretendardVariable.ttf` from the release zip (https://github.com/orioncactus/pretendard/releases/tag/v1.3.9), SHA-256 `3090ccde0442bb347aa7685d9ba8b17436a60682df6e8f92a9a670de14056e22`. "Pretendard" is a Reserved Font Name, so the subset is renamed `MW UI Sans` in its name table (family, full, PostScript and unique names; the copyright, trademark and license entries are kept). Weight axis limited to 400-800; `tnum` kept for the HUD's tabular figures.

## Noto Serif KR: `moonwake-hanja-notoserifkr.woff2`

[Noto Serif KR](https://github.com/google/fonts/tree/main/ofl/notoserifkr) by Google, `NotoSerifKR[wght].ttf` from google/fonts, SHA-256 `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3`. Only the hanja, weight axis 200-900.

## Cinzel: `imjin-title-cinzel.woff2`

[Cinzel](https://github.com/google/fonts/tree/main/ofl/cinzel) by Natanael Gama, `Cinzel[wght].ttf` from google/fonts, SHA-256 `f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34`: printable ASCII plus U+00A0, U+00B7, Ō/ō, dashes, curly quotes, ellipsis, weight axis 400-900.

## Reproduction

`text.txt` is the 2,350 KS X 1001 syllables (every EUC-KR code B0A1-C8FE) plus every non-ASCII, non-hanja character in `src/`, `server/` and `index.html`; `hanja.txt` the hanja there (U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF).

```
O="--flavor=woff2 --layout-features=* --name-IDs=* --name-languages=*"
python -m fontTools.subset "Hahmlet[wght].ttf" --text-file=text.txt --unicodes=U+0020-007E,U+00A0 $O --output-file=h.woff2
python -m fontTools.varLib.instancer h.woff2 wght=500:800 -o moonwake-cine-hahmlet.woff2
python -m fontTools.subset PretendardVariable.ttf --text-file=text.txt --unicodes=U+0020-007E,U+00A0 $O --output-file=p.woff2
python -m fontTools.varLib.instancer p.woff2 wght=400:800 -o p2.woff2
# then rename: every name record except IDs 0, 7, 13, 14: "Pretendard Variable"/"Pretendard" -> "MW UI Sans", "PretendardVariable" -> "MWUISans"
python -m fontTools.subset "NotoSerifKR[wght].ttf" --text-file=hanja.txt $O --output-file=moonwake-hanja-notoserifkr.woff2
python -m fontTools.subset "Cinzel[wght].ttf" --unicodes=U+0020-007E,U+00A0,U+00B7,U+014C,U+014D,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026 $O --output-file=imjin-title-cinzel.woff2
```

Removed 2026-10-17: Do Hyeon (`imjin-title-dohyeon`, `imjin-battle-dohyeon`), the old Noto Serif KR lockup cut (`imjin-serif-notoserifkr`) and Asan City's 이순신체/이순신돋움체 (`imjin-yisunshin-*`).
