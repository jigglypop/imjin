---
name: typography
description: Fonts for every player-facing text in MOONWAKE. Use before adding or changing any font, font-family, title text or subtitle style.
---

# Typography (owner decision 2026-10-18 — supersedes earlier role split)

**One family: Pretendard everywhere** — titles, menus, HUD, subtitles, dialogue, briefings, codex, battle labels. Weights carry hierarchy (400 body, 500 subtitles/UI, 600–700 headings, 800 big titles), not different families.
- CSS: `--font-title`, `--font-cine`, `--font-ui` all resolve to Pretendard (keep the variables so code stays stable). `--font-hanja` (Noto Serif KR subset) only as a glyph fallback for hanja Pretendard lacks.
- Numbers: `font-variant-numeric: tabular-nums` in HUD/stats.
- Subtitles: white, Pretendard 500, soft shadow `0 1px 3px rgba(0,0,0,.8)`.
- Licenses: Pretendard OFL (renamed subset "MW UI Sans" — OFL reserved name); Noto Serif KR OFL. License files + sources in `public/ui/fonts/README.md`.

## Rejected
- 정묵바위체 (tacky), Hahmlet serif subtitles, DoHyeon, 'Imjin Serif/Roman', 'YiSunShin' — mixing families per screen.
- Decorative taglines like "나라를 지킨 바다".
