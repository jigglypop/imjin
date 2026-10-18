---
name: ui-design
description: MOONWAKE UI design system — glass panels, spacing, type scale, faction accents, layout rules for menus, briefings, /generals, HUD, battle ship labels and phones. Use before adding or restyling any screen, panel, HUD element or label.
---

# UI design system (owner 2026-10-18: "너무 난잡함, 깔끔하게. 글래스모피즘, 프리텐다드 통일")

## Surfaces — glass
- Panel = the shared `.glass` class in `src/ui/styles.css`: `--glass` `rgba(12,16,24,.55)`, `--glass-blur` `blur(20px)` (16–24px; touch devices swap blur for near-opaque fill, `.app--touch`), `--glass-line` 1px `rgba(255,255,255,.12)`, `--shadow`, radius `--r` 16px / `--r-sm` 12px, pills 999px. Denser variants: `--glass-hi`, `--glass-sheet`, `--glass-solid`.
- Never re-invent a panel look per screen; use the class and tokens.
- No gradients-on-gradients, no ornamental borders, frames, paper textures or brush strokes on panels.

## Spacing — 4 / 8 / 12 / 16 / 24 / 32 only (`--sp-1`..`--sp-6`)
Panel padding 16 (phone 12) – 24; gap between groups 24; inside a group 8–12.

## Type — Pretendard only (see `typography` skill)
| role | size | weight |
|---|---|---|
| display (menu title) | 40–56 | 800 |
| screen title | 24–28 | 700 |
| section heading | 15–16 | 600 |
| body | 14 | 400 |
| label / meta | 12 | 500, `--ink-3` |
| HUD numbers | 12–14 | 600, tabular-nums |
Text colors: `--ink`, `--ink-2`, `--ink-3` (dimmer meta). Uppercase letter-spaced eyebrows only for short meta (date/place), never as flavor.

## Color
- Neutral glass + white text. ONE muted accent per faction: the `--joseon`, `--japan`, `--ming`, `--england`, `--spain`, `--holyleague`, `--ottoman`, `--britain`, `--france`, `--spain1805` tokens (and `.f-<faction>` classes). Accent goes on the active tab, the faction dot, a side rule — not on everything. Keep saturation under ~45%.
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
