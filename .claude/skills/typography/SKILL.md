---
name: typography
description: Fonts for every player-facing text in MOONWAKE — titles, cinematic subtitles/dialogue, UI/HUD. Use before adding or changing any font, font-family, title art text or subtitle style.
---

# Typography (owner decision 2026-10-17)

Three roles only. Every `font-family` in `src/ui/**/*.css`, `index.html` and canvas text goes through these CSS variables. No other font names anywhere.

| Role | Variable | Font | Use |
|---|---|---|---|
| Title | `--font-title` | **정묵바위체** (Jeongmuk Bawi) | game/chapter titles, battle title cards, big headings |
| Subtitle / dialogue | `--font-cine` | **함렛 Hahmlet** (variable, Medium 500+) | cutscene subtitles, commander dialogue, battle log, briefing body |
| UI / HUD | `--font-ui` | **Pretendard** (variable, tabular numbers) | menus, buttons, HUD, numbers, scoreboards |
| Hanja fallback | `--font-hanja` | **Noto Serif KR** | 黑 蛟 and other hanja mixed into dialogue or titles |

## Rules
- Subtitles look like film subtitles: white, soft shadow (`text-shadow: 0 1px 3px rgba(0,0,0,.8)`), weight ≥ 500. Thin serifs vanish over the night sea.
- Numbers in the HUD use `font-variant-numeric: tabular-nums`.
- English (`/en`): Title uses the same variable with a Latin fallback chosen to match (Cinzel stays as the Latin title fallback). Body uses Hahmlet/Pretendard Latin glyphs.
- Licenses:
  - 정묵바위체 and EBS 주시경체 forbid modifying glyphs. Use the files as distributed: subsetting/woff2 conversion only if the license allows it (check and record in `public/ui/fonts/README.md`); never retouch glyphs. A custom logo needs KCC 은영체 or a commissioned calligrapher.
  - Hahmlet, Pretendard and Noto Serif KR are OFL.
  - Every font file has its license text and source URL beside it in `public/ui/fonts/`.
- Phones: preload only the title subset used on the first screen. Load the rest with `font-display: swap`. Keep total font bytes small: subset Korean to the glyphs used where the license allows.

## Rejected
- Mixing DoHyeon, 'Imjin Serif', 'Imjin Roman', 'YiSunShin', 'YiSunShin Dotum' or system fonts per screen. Those are removed.
- Thin serif subtitles.
- Glyph-edited 정묵바위체.
