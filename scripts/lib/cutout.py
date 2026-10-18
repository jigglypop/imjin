# Background cutout for concept images that come back opaque (Gemini has no transparent output):
# rembg with BiRefNet, alpha matting off (it leaves halos on armour edges). Writes an RGBA PNG.
#   python -E -P scripts/lib/cutout.py <in.png> <out.png>
import sys

from PIL import Image
from rembg import new_session, remove

src, dst = sys.argv[1], sys.argv[2]
session = new_session('birefnet-general')
out = remove(Image.open(src).convert('RGB'), session=session, post_process_mask=True)
# Hard-ish edge: soft alpha below 0.12 goes, the rest stays (keeps hair and lacing, drops grey fringe).
r, g, b, a = out.split()
a = a.point(lambda v: 0 if v < 30 else v)
Image.merge('RGBA', (r, g, b, a)).save(dst)
