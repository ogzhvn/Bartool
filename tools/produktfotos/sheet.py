import sys, io, base64, html
sys.path.insert(0, sys.argv[1]); from manifest import R
from PIL import Image
S=sys.argv[2]
def b64(im, fmt, **kw):
    b=io.BytesIO(); im.save(b, fmt, **kw); return base64.b64encode(b.getvalue()).decode()
cards=[]
for slug,name,uid,page,img,conf,note in R:
    o=Image.open(f"{S}/orig/{slug}.jpg").convert("RGB"); o.thumbnail((260,260))
    c=Image.open(f"{S}/out/{slug}.webp").convert("RGBA")
    big=c.resize((225,300)); th=c.resize((24,32))
    src=(page or img).replace("https://","")
    cards.append(f'''<div class=c><div class=r><img src="data:image/jpeg;base64,{b64(o,"JPEG",quality=80)}"><img src="data:image/webp;base64,{b64(big,"WEBP",quality=85)}"><img class=t src="data:image/webp;base64,{b64(th,"WEBP",quality=85)}"></div>
<b>{html.escape(name)}</b><br><small>{html.escape(src[:70])}<br>Konfidenz: <span class={conf}>{conf}</span> {html.escape(note)}</small></div>''')
open(f"{S}/contactsheet.html","w").write(f'''<!doctype html><meta charset=utf-8><title>Whisky Contact Sheet</title><style>
body{{background:#0c0c0e;color:#ddd;font:13px system-ui;margin:16px}}.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px}}
.c{{background:#16161a;padding:10px;border-radius:8px}}.r{{display:flex;gap:8px;align-items:flex-end;margin-bottom:6px}}.r img{{max-height:300px;max-width:45%;object-fit:contain}}
small{{color:#999;word-break:break-all}}.hoch{{color:#6c6}}.mittel{{color:#eb5}}</style><h2>Whisky-Pilot: {len(R)} Produkte</h2><div class=g>{"".join(cards)}</div>''')
