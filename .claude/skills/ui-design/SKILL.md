---
name: ui-design
description: MOONWAKE UI design system — glass panels, spacing, type scale, faction accents, layout rules for menus, briefings, /generals, HUD, battle ship labels and phones. Use before adding or restyling any screen, panel, HUD element or label.
---

# UI design system (owner 2026-10-18: "너무 난잡함, 깔끔하게. 글래스모피즘, 프리텐다드 통일")

## Surfaces — glass
- Panel: `background: var(--glass-fill)` = `rgba(12,16,24,.55)`; `backdrop-filter: blur(var(--glass-blur))` (16–24px, 20 default; drop to 12px or none on `?q=low` / phones if it costs frames); `border: 1px solid var(--glass-line)` = `rgba(255,255,255,.12)`; `box-shadow: var(--glass-shadow)` = `0 8px 32px rgba(0,0,0,.35)`; radius `var(--r-panel)` 14–16px, controls `var(--r-ctl)` 10px, pills 999px.
- Use the shared `.glass` class / tokens in `src/ui/styles.css`; never re-invent a panel look per screen.
- No gradients-on-gradients, no ornamental borders, frames, paper textures or brush strokes on panels.

## Spacing — 4 / 8 / 12 / 16 / 24 / 32 only (`--s1`..`--s6`)
Panel padding 16 (phone 12) – 24; gap between groups 24; inside a group 8–12.

## Type — Pretendard only (see `typography` skill)
| role | size | weight |
|---|---|---|
| display (menu title) | 40–56 | 800 |
| screen title | 24–28 | 700 |
| section heading | 15–16 | 600 |
| body | 14 | 400 |
| label / meta | 12 | 500, `--text-dim` |
| HUD numbers | 12–14 | 600, tabular-nums |
Text colors: `--text` #eef2f7, `--text-dim` rgba(238,242,247,.62). Uppercase letter-spaced eyebrows only for short meta (date/place), never as flavor.

## Color
- Neutral glass + white text. ONE accent per faction (`--accent` set on the screen/side): Joseon `#5aa9ff`, Japan `#ff6b5a`, Spain `#e8b44a`, England `#6fc3ff`, Holy League `#c9a2ff`, Ottoman `#4fd08a`, Britain `#7fb2ff`, France-Spain `#ff8a6a`. Accent goes on the active tab, primary button, faction dot — not on everything.
- Health: green→amber→red only on bars.

## Structure
- Max 2 levels of nesting (screen → panel → rows). No cards inside cards inside cards.
- No decorative taglines/slogans ("나라를 지킨 바다" etc.). Titles are factual: name, date, place.
- Dense info → progressive disclosure: show the 3–5 facts that decide a choice; the rest behind a "자세히" `<details>`/toggle.
- Never show the same fact twice on one screen.
- Briefings (해전사): date · place · forces (side A vs side B) · outcome, then collapsible detail.
- Icons: simple line icons; no emoji in UI.

## Battle ship labels
Small glass pill above each ship: faction dot + name (Pretendard 600, 11–12px) + 2px health bar under it. Fade with camera distance; when crowded, keep flagship/selected/damaged and hide the rest. No boxes, no emoji, no squadron numbers (squadron assignment was removed 2026-10-18).

## Phones (≤ 640px or `useCompactLayout`)
- One column, panels full-width with 12px gutters, bottom sheets instead of side panels, tap targets ≥ 40px, safe-area insets.
- Hide secondary meta first; never shrink body text below 13px.

## Verify
Screenshot 1920×1080, 1366×768 and 390×844 (`scripts/shot.mjs`) of every touched screen and look at them critically before committing.
