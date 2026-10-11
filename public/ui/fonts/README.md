# Menu lettering fallback

`imjin-menu-brush.woff2` contains only the four glyphs in `임진왜란`. It is a renamed subset of [Nanum Brush Script](https://github.com/google/fonts/tree/main/ofl/nanumbrushscript), distributed under the included SIL Open Font License. The subset's internal family is `ImjinMenuBrush`; it does not use the reserved font names.

Source: `NanumBrushScript-Regular.ttf`, SHA-256 `27ceaf578c96f594cdf07fe0181b251790acbb746a164e45c1f6473f89911a31`.

Reproduction: use FontTools `subset` with `--text=임진왜란 --flavor=woff2`, then set name IDs 1, 2, 3, 4, and 6 to the new family and `Regular` before saving. Keep the original copyright and license entries. The generated bitmap wordmark is the main menu's primary title; this small font remains its readable fallback.
