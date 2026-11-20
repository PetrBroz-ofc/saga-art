"""Vygeneruje náhledový obrázek pro sdílení (public/img/og.jpg, 1200x630) z fotky a značky.
  python scripts/make-og-image.py
Potřebuje Pillow a písma Times New Roman a Arial (Windows)."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'img', 'og.jpg')
PHOTO = os.path.join(HERE, '..', 'public', 'img', 'hero-charlotte.jpg')
F = r'C:\Windows\Fonts'
W, H = 1200, 630
INK, ACCENT, BG1, BG2 = (62, 58, 82), (131, 99, 159), (248, 247, 251), (239, 233, 247)

img = Image.new('RGB', (W, H), BG1)
d = ImageDraw.Draw(img)
for x in range(W):  # jemný přechod zleva doprava
    t = x / W
    d.line([(x, 0), (x, H)], fill=tuple(round(BG1[i] * (1 - t) + BG2[i] * t) for i in range(3)))

photo = Image.open(PHOTO).convert('RGB')
pw = 470
ratio = max(pw / photo.width, H / photo.height)
photo = photo.resize((round(photo.width * ratio), round(photo.height * ratio)), Image.LANCZOS)
left = (photo.width - pw) // 2
photo = photo.crop((left, 0, left + pw, H))
img.paste(photo, (W - pw, 0))

serif = ImageFont.truetype(os.path.join(F, 'times.ttf'), 118)
serif_i = ImageFont.truetype(os.path.join(F, 'timesi.ttf'), 118)
sans = ImageFont.truetype(os.path.join(F, 'arial.ttf'), 34)
x, y = 70, 190
d.text((x, y), 'Sága ', font=serif, fill=INK)
d.text((x + d.textlength('Sága ', font=serif), y), 'Art', font=serif_i, fill=ACCENT)
d.line([(x, y + 150), (x + 300, y + 150)], fill=ACCENT, width=3)
d.text((x, y + 178), 'Ručně vyráběné šperky', font=sans, fill=INK)
d.text((x, y + 222), 'z pravých perel a minerálů', font=sans, fill=INK)
d.text((x, H - 70), 'sagaart.cz', font=ImageFont.truetype(os.path.join(F, 'arial.ttf'), 28), fill=ACCENT)
img.save(OUT, quality=88, optimize=True, progressive=True)
print('hotovo:', OUT, os.path.getsize(OUT) // 1024, 'kB')
