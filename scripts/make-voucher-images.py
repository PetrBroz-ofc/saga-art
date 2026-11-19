"""Vygeneruje obrázky dárkových poukazů podle návrhu klientky (scripts/voucher-design/original.jpg).

  python scripts/make-voucher-images.py

Výstup do public/img/:
  poukaz-base.jpg      pozadí bez textu (pro e-mail, text se píše do HTML)
  poukaz-500.jpg, poukaz-1000.jpg, poukaz-1500.jpg   celé karty s hodnotou (web, košík)
  poukaz-logo.png      logo v kruhu (jen pro případné další použití)
Potřebuje Pillow a numpy. Písma Times New Roman a Arial (Windows).
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'voucher-design', 'original.jpg')
OUT = os.path.join(HERE, '..', 'public', 'img')
FONTS = r'C:\Windows\Fonts'
W, H = 1800, 1000
NAVY = (38, 53, 88)

src = Image.open(SRC).convert('RGB')
assert src.size == (W, H), src.size

# ── 1) logo v kruhu (vystřižené z návrhu) ──
CX, CY, R = 1472, 508, 243
logo = src.crop((CX - R, CY - R, CX + R + 1, CY + R + 1)).convert('RGBA')
mask = Image.new('L', logo.size, 0)
ImageDraw.Draw(mask).ellipse((1, 1, logo.size[0] - 2, logo.size[1] - 2), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.2))
logo.putalpha(mask)
logo.save(os.path.join(OUT, 'poukaz-logo.png'), optimize=True)

# ── 2) hladké pozadí: z návrhu se vyřežou text, kruh s logem, vločky a jiskry, zbytek se rozmaže ──
a = np.asarray(src).astype(np.float32)
lum = a.mean(axis=2)
text = lum < 140                                   # tmavý text
bright = lum > 238                                 # bílé vločky, jiskry, čáry
m = Image.fromarray(((text | bright) * 255).astype(np.uint8))
m = m.filter(ImageFilter.MaxFilter(21))            # rozšířit o ~10 px
mk = np.asarray(m) > 0
yy, xx = np.mgrid[0:H, 0:W]
mk |= (xx - CX) ** 2 + (yy - CY) ** 2 < (R + 16) ** 2
good = (~mk).astype(np.float32)

C = 20                                             # velikost buňky
gh, gw = H // C, W // C
cell = np.zeros((gh, gw, 3), np.float32)
wt = np.zeros((gh, gw), np.float32)
for gy in range(gh):
    for gx in range(gw):
        g = good[gy * C:(gy + 1) * C, gx * C:(gx + 1) * C]
        s = g.sum()
        if s > 40:
            cell[gy, gx] = (a[gy * C:(gy + 1) * C, gx * C:(gx + 1) * C] * g[..., None]).sum(axis=(0, 1)) / s
            wt[gy, gx] = 1
# prázdné buňky se doplní průměrem sousedů (opakovaně)
for _ in range(400):
    if wt.min() == 1:
        break
    pad = np.pad(cell * wt[..., None], ((1, 1), (1, 1), (0, 0)))
    pw = np.pad(wt, 1)
    ssum = sum(pad[1 + dy:1 + dy + gh, 1 + dx:1 + dx + gw] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    wsum = sum(pw[1 + dy:1 + dy + gh, 1 + dx:1 + dx + gw] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    new = (wt == 0) & (wsum > 0)
    cell[new] = ssum[new] / wsum[new][:, None]
    wt[new] = 1
bg = Image.fromarray(np.clip(cell, 0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(24))

# ── 3) ozdoby: bublinky, jiskry, vločky, rámeček, dělicí čára, logo ──
S = 2  # nadvzorkování pro hladké hrany
deco = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(deco)
sc = lambda v: int(round(v * S))

def circle(x, y, r, fill=None, outline=None, width=1):
    d.ellipse((sc(x - r), sc(y - r), sc(x + r), sc(y + r)), fill=fill, outline=outline, width=sc(width))

for x, y, r in [(95, 320, 12), (638, 85, 8), (635, 102, 7), (800, 72, 6), (950, 84, 6), (1050, 122, 13), (1195, 120, 7), (1205, 228, 20),
                (1416, 222, 20), (1466, 94, 8), (1520, 60, 8), (1250, 62, 6), (1722, 290, 6), (1750, 390, 6), (1500, 810, 10),
                (1424, 872, 20), (1623, 945, 8), (1235, 918, 6), (1025, 913, 7), (188, 940, 6), (60, 445, 8), (1175, 795, 8)]:
    circle(x, y, r, fill=(255, 255, 255, 46), outline=(255, 255, 255, 90), width=1.5)

def sparkle(x, y, r):
    pts = []
    import math
    for i in range(8):
        ang = math.pi / 4 * i - math.pi / 2
        rad = r if i % 2 == 0 else r * 0.22
        pts.append((sc(x + rad * math.cos(ang)), sc(y + rad * math.sin(ang))))
    d.polygon(pts, fill=(255, 255, 255, 240))

for x, y, r in [(95, 130, 17), (1000, 110, 14), (1690, 367, 15), (1210, 592, 17), (1544, 830, 15)]:
    sparkle(x, y, r)

def snowflake(x, y, r):
    import math
    for i in range(6):
        ang = math.pi / 3 * i
        ex, ey = x + r * math.cos(ang), y + r * math.sin(ang)
        d.line((sc(x), sc(y), sc(ex), sc(ey)), fill=(255, 255, 255, 245), width=sc(2.6))
        for t in (0.55,):
            bx, by = x + r * t * math.cos(ang), y + r * t * math.sin(ang)
            for s in (-1, 1):
                a2 = ang + s * math.pi / 4
                d.line((sc(bx), sc(by), sc(bx + r * 0.38 * math.cos(a2)), sc(by + r * 0.38 * math.sin(a2))), fill=(255, 255, 255, 245), width=sc(2.2))

for x, y, r in [(1247, 206, 36), (1665, 183, 27), (1663, 757, 36), (1305, 793, 21)]:
    snowflake(x, y, r)

# rámeček a dělicí čára
d.rounded_rectangle((sc(35), sc(35), sc(W - 35), sc(H - 35)), radius=sc(46), outline=(255, 255, 255, 215), width=sc(2.5))
d.rounded_rectangle((sc(46), sc(46), sc(W - 46), sc(H - 46)), radius=sc(38), outline=(255, 255, 255, 120), width=sc(1.5))
d.line((sc(1165), sc(100), sc(1165), sc(900)), fill=(255, 255, 255, 150), width=sc(2))
deco = deco.resize((W, H), Image.LANCZOS)

base = bg.convert('RGBA')
base.alpha_composite(deco)
# perleťový okraj kolem loga (jemná záře) a logo
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((CX - R - 14, CY - R - 14, CX + R + 14, CY + R + 14), fill=(255, 255, 255, 120))
base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(8)))
base.alpha_composite(logo, (CX - R, CY - R))
base = base.convert('RGB')
base.save(os.path.join(OUT, 'poukaz-base.jpg'), quality=88, optimize=True, progressive=True)

# ── 4) text ──
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

def spaced_width(txt, f, tracking):
    return sum(f.getlength(c) for c in txt) + tracking * (len(txt) - 1)

def fit(name, txt, width, tracking=0, lo=8, hi=400):
    for size in range(hi, lo, -1):
        if spaced_width(txt, font(name, size), tracking) <= width:
            return size
    return lo

def text_at(dr, x, base_y, txt, f, tracking=0, fill=NAVY):
    for c in txt:
        dr.text((x, base_y), c, font=f, fill=fill, anchor='ls')
        x += f.getlength(c) + tracking
    return x

SZ_BRAND = fit('arial.ttf', 'SÁGA ART', 385 - 125, tracking=14)
SZ_TITLE = fit('times.ttf', 'Dárkový poukaz', 890 - 120)
SZ_SUB = fit('timesi.ttf', 'Na šperk podle vlastního výběru', 664 - 125)
SZ_HODN = fit('arial.ttf', 'HODNOTA POUKAZU', 438 - 128, tracking=5)
SZ_LBL = fit('arial.ttf', 'Kód poukazu', 287 - 125)
SZ_FOOT = fit('arial.ttf', 'Uplatnění přes zprávu na @sagaart.cz', 583 - 125)
SZ_VAL = 152
SZ_KC = 66


def card(value_txt, path):
    im = base.copy()
    dr = ImageDraw.Draw(im)
    text_at(dr, 125, 167, 'SÁGA ART', font('arial.ttf', SZ_BRAND), 14)
    dr.line((124, 210, 516, 210), fill=(255, 255, 255, 255), width=2)
    dr.text((120, 355), 'Dárkový poukaz', font=font('times.ttf', SZ_TITLE), fill=NAVY, anchor='ls')
    dr.text((125, 430), 'Na šperk podle vlastního výběru', font=font('timesi.ttf', SZ_SUB), fill=NAVY, anchor='ls')
    text_at(dr, 128, 536, 'HODNOTA POUKAZU', font('arial.ttf', SZ_HODN), 5)
    fv = font('times.ttf', SZ_VAL)
    dr.text((120, 680), value_txt, font=fv, fill=NAVY, anchor='ls')
    xe = 120 + fv.getlength(value_txt) + 32
    dr.text((xe, 668), 'Kč', font=font('times.ttf', SZ_KC), fill=NAVY, anchor='ls')
    fl = font('arial.ttf', SZ_LBL)
    dr.text((125, 765), 'Kód poukazu', font=fl, fill=NAVY, anchor='ls')
    dr.text((655, 765), 'Platí do', font=fl, fill=NAVY, anchor='ls')
    dr.line((125, 824, 564, 824), fill=NAVY, width=2)
    dr.line((655, 824, 1006, 824), fill=NAVY, width=2)
    dr.text((125, 906), 'Uplatnění v pokladně na sagaart.cz', font=font('arial.ttf', SZ_FOOT), fill=NAVY, anchor='ls')
    im.resize((1200, 667), Image.LANCZOS).save(path, quality=88, optimize=True, progressive=True)

for v, txt in [(500, '500'), (1000, '1 000'), (1500, '1 500')]:
    card(txt, os.path.join(OUT, f'poukaz-{v}.jpg'))
print('font sizes', dict(brand=SZ_BRAND, title=SZ_TITLE, sub=SZ_SUB, hodn=SZ_HODN, lbl=SZ_LBL, foot=SZ_FOOT))
print('hotovo:', sorted(f for f in os.listdir(OUT) if f.startswith('poukaz')))
