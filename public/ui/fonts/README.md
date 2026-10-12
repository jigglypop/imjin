# Menu title lettering

`imjin-title-dohyeon.woff2` contains only the four glyphs in `임진왜란`. It is a subset of [Do Hyeon](https://github.com/google/fonts/tree/main/ofl/dohyeon) (BM DOHYEON by Woowa Brothers), distributed under the included SIL Open Font License (`OFL-DoHyeon.txt`). The family has no reserved font names and a single weight; the menu thickens it with a text stroke of its own colour.

Source: `DoHyeon-Regular.ttf` from google/fonts, SHA-256 `35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653`.

Reproduction: `python -m fontTools.subset DoHyeon-Regular.ttf --text=임진왜란 --flavor=woff2 --layout-features='*' --name-IDs='*' --name-languages='*' --output-file=imjin-title-dohyeon.woff2`. The copyright and license name entries are kept.
