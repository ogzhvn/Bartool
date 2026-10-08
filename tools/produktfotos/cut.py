import sys, os
from PIL import Image
from rembg import remove, new_session
src, dst = sys.argv[1], sys.argv[2]
sess = new_session('u2net')
for f in sorted(os.listdir(src)):
    im = Image.open(os.path.join(src, f)).convert('RGBA')
    cut = remove(im, session=sess)
    bb = cut.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()
    cut = cut.crop(bb)
    w, h = cut.size
    sc = min(800 / w, 1100 / h)
    cut = cut.resize((max(1, round(w * sc)), max(1, round(h * sc))), Image.LANCZOS)
    canvas = Image.new('RGBA', (900, 1200), (0, 0, 0, 0))
    canvas.paste(cut, ((900 - cut.width) // 2, (1200 - cut.height) // 2), cut)
    out = os.path.join(dst, os.path.splitext(f)[0] + '.webp')
    canvas.save(out, 'WEBP', quality=85)
    print(f, im.size, bb, os.path.getsize(out))
