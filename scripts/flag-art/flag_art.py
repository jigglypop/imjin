"""
The pictures of the flags that carry lettering or a crest, drawn instead of generated: an image model letters hanja
wrongly (白 came out 自, 黑 and 黃 in their Japanese forms) and squashes a crest drawn for one shape of cloth into
another. Every flag with a `draw` entry in src/ships/build/atlasLayout.json or src/ui/grand/buildingAtlas.json is drawn
here at its own aspect: woven cloth in its dye, a border of trim, the character in Yuji Boku (a brush face, OFL, the
subset beside this file) or a crest from crests/ (masks lifted from the first generated banners and rounded again).

    python scripts/flag-art/flag_art.py [--set=ships|buildings|all] [--recover]

writes assets-src/textures-<set>/<faction>/<sheet>__<flag>_drawn.png (and <slot>_drawn.png for a picture cell), which
scripts/ship-textures.mjs composes in place of a generated picture:

    node scripts/ship-textures.mjs patch --faction=joseon --only=flags_a,flags_b

--recover first lifts the sheets' other, generated flags out of the published atlas into the cache when their raw
pictures are not there (a checkout without the gitignored raw images), so a patch can recompose the whole sheet.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
FONT = HERE / 'yujiboku-flags.ttf'
SETS = {
    'ships': (ROOT / 'src/ships/build/atlasLayout.json', ROOT / 'assets-src/textures-ships', ROOT / 'public/textures/ships'),
    'buildings': (ROOT / 'src/ui/grand/buildingAtlas.json', ROOT / 'assets-src/textures-buildings', ROOT / 'public/textures/buildings'),
}
# Long side of a drawn picture: twice the largest slot it fills in a 2048 px atlas, so the compose only shrinks it.
LONG = 1024


def rgb(hex_):
    hex_ = hex_.lstrip('#')
    return np.array([int(hex_[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def blur(a, r):
    return gaussian_filter(np.asarray(a, np.float32), r)


def weave(w, h, rng, coarse=1.0):
    """Brightness of woven cloth around 1: threads across and down, slub, a fine tooth and the slow blotches of fading."""
    rows = rng.normal(0, 0.035, h).astype(np.float32)
    cols = rng.normal(0, 0.035, w).astype(np.float32)
    # Thread runs: the same yarn for a few threads before the next bobbin.
    rows = np.convolve(rows, np.ones(3) / 3, 'same') + rng.normal(0, 0.012, h)
    cols = np.convolve(cols, np.ones(3) / 3, 'same') + rng.normal(0, 0.012, w)
    tooth = blur(rng.normal(0, 0.05, (h, w)), 0.6)
    slub = blur(rng.normal(0, 1, (h, w)), 3) * 0.05
    fade = blur(rng.normal(0, 1, (h, w)), max(w, h) / 14) * 0.9 * coarse
    fade = fade / (np.abs(fade).max() + 1e-6) * 0.07
    return 1 + rows[:, None] + cols[None, :] + tooth + slub + fade


def ink_mask(spec, w, h, rng):
    """Coverage 0..1 of the lettering or crest, with the dry-brush breaks a cloth takes paint with."""
    m = np.zeros((h, w), np.float32)
    if 'text' in spec:
        text = spec['text']
        vertical = len(text) > 1
        img = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(img)
        if vertical:
            # A column of characters down the fly below the crest, as a war banner's invocation is written.
            top, bottom = spec.get('textBox', [0.36, 0.95])
            span = (bottom - top) * h
            size = int(min(w * 0.62, span / len(text) * 0.94))
            font = ImageFont.truetype(str(FONT), size)
            step = span / len(text)
            for i, ch in enumerate(text):
                l, t, r, b = d.textbbox((0, 0), ch, font=font)
                d.text((w / 2 - (l + r) / 2, top * h + step * (i + 0.5) - (t + b) / 2), ch, fill=255, font=font)
        else:
            size = int(min(w, h) * spec.get('scale', 0.66))
            font = ImageFont.truetype(str(FONT), size)
            l, t, r, b = d.textbbox((0, 0), text, font=font)
            # Centred on the ink, not the font's box, and a touch high as a painter sets a single character.
            d.text((w / 2 - (l + r) / 2, h * 0.485 - (t + b) / 2), text, fill=255, font=font)
        m = np.maximum(m, np.asarray(img, np.float32) / 255)
    if 'crest' in spec:
        c = spec['crest']
        crest = Image.open(HERE / 'crests' / f"{c['name']}.png").convert('L')
        size = int(w * c.get('size', 0.78))
        crest = crest.resize((size, size), Image.LANCZOS)
        layer = Image.new('L', (w, h), 0)
        layer.paste(crest, (int(w / 2 - size / 2), int(h * c.get('y', 0.2) - size / 2)))
        m = np.maximum(m, np.asarray(layer, np.float32) / 255)
    # Paint soaks along the threads and skips where the brush ran dry.
    dry = blur(rng.normal(0, 1, (h, w)), 1.4)
    dry = np.clip(0.9 + dry * 0.5, 0.55, 1)
    soft = blur(m, max(0.6, w / 900))
    return np.clip(soft * dry, 0, 1)


def draw_flag(spec, aspect, seed):
    w, h = (LONG, int(round(LONG / aspect))) if aspect >= 1 else (int(round(LONG * aspect)), LONG)
    rng = np.random.default_rng(seed)
    cloth = rgb(spec['cloth'])
    img = np.ones((h, w, 3), np.float32) * cloth
    # Sun-bleached towards the fly and the top, where the cloth meets the weather first.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    bleach = 1 + 0.05 * (1 - yy / h) + 0.03 * (xx / w)
    img *= bleach[..., None]
    # Bands: a border all round (square flags) or bands across the top and bottom (nobori, maku).
    band = np.zeros((h, w), np.float32)
    if 'trim' in spec:
        t = int(min(w, h) * spec.get('trimWidth', 0.045))
        band[:t, :] = band[-t:, :] = band[:, :t] = band[:, -t:] = 1
        line = max(2, t // 6)
        stitch = np.zeros_like(band)
        stitch[t:t + line, t:-t] = stitch[-t - line:-t, t:-t] = stitch[t:-t, t:t + line] = stitch[t:-t, -t - line:-t] = 1
        img = img * (1 - stitch[..., None] * 0.18)
        img = img * (1 - band[..., None]) + rgb(spec['trim']) * bleach[..., None] * band[..., None]
    for b in spec.get('bands', []):
        y0, y1 = int(b[0] * h), int(b[1] * h)
        img[y0:y1] = rgb(spec['bandColor']) * bleach[y0:y1, :, None]
    ink = rgb(spec['ink'])
    m = ink_mask(spec, w, h, rng)[..., None]
    img = img * (1 - m) + ink * (0.94 + 0.06 * bleach[..., None]) * m
    img *= weave(w, h, rng)[..., None]
    # The edge frays a little darker, as handled cloth does.
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / min(w, h)
    img *= (0.9 + 0.1 * np.clip(edge / 0.02, 0, 1))[..., None]
    return Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')


def recover(layout, published, faction, index, slot, cache):
    """A generated flag of a sheet lifted out of the published atlas, for a checkout without the raw pictures."""
    grid, cellpx, pad = layout['grid'], layout['cell'], layout['pad']
    atlas = Image.open(published / f'{faction}_albedo.webp').convert('RGB')
    k = atlas.width / (grid * cellpx)
    x0 = (index % grid) * cellpx + pad
    y0 = (index // grid) * cellpx + pad
    inner = cellpx - 2 * pad
    cols, rows = slot['sheet']['cols'], slot['sheet']['rows']
    sw, sh = inner // cols, inner // rows
    for i, f in enumerate(slot['flags']):
        if 'draw' in f:
            continue
        out = cache / faction / f"{slot['name']}__{f['name']}_1.png"
        if out.exists():
            continue
        box = [(x0 + (i % cols) * sw) * k, (y0 + (i // cols) * sh) * k, (x0 + (i % cols + 1) * sw) * k, (y0 + (i // cols + 1) * sh) * k]
        out.parent.mkdir(parents=True, exist_ok=True)
        atlas.crop(tuple(int(round(v)) for v in box)).resize((1024, 1024), Image.LANCZOS).save(out)
        print('recovered', out.relative_to(ROOT))


def main():
    args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), 'true') for a in sys.argv[1:])
    which = ['ships', 'buildings'] if args.get('set', 'all') == 'all' else [args['set']]
    for name in which:
        path, cache, published = SETS[name]
        layout = json.loads(path.read_text(encoding='utf-8'))
        for faction, slots in layout['factions'].items():
            for index, slot in enumerate(slots):
                items = [(f"{slot['name']}__{f['name']}", f) for f in slot.get('flags', [])] if slot.get('sheet') else [(slot['name'], slot)]
                for n, (key, item) in enumerate(items):
                    if 'draw' not in item:
                        continue
                    out = cache / faction / f'{key}_drawn.png'
                    out.parent.mkdir(parents=True, exist_ok=True)
                    seed = sum(ord(c) for c in f'{faction}/{key}')
                    draw_flag(item['draw'], item.get('aspect', 1), seed).save(out)
                    print('drew', out.relative_to(ROOT))
                if args.get('recover') and slot.get('sheet'):
                    recover(layout, published, faction, index, slot, cache)


if __name__ == '__main__':
    main()
