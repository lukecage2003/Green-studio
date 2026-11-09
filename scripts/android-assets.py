# Icônes et écran de démarrage Android à partir des icônes de l'app (python3 scripts/android-assets.py, après make-icons.cjs).
from PIL import Image, ImageDraw
import glob, os
R = "android/app/src/main/res"
icon, mask = Image.open("public/icons/icon-512.png").convert("RGBA"), Image.open("public/icons/maskable-512.png").convert("RGBA")
fg, bg = Image.open("scripts/out/fg-432.png").convert("RGBA"), Image.open("scripts/out/bg-432.png").convert("RGBA")
for d, s in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    icon.resize((s, s), Image.LANCZOS).save(f"{R}/mipmap-{d}/ic_launcher.png")
    m = Image.new("L", (s * 4, s * 4), 0); ImageDraw.Draw(m).ellipse((0, 0, s * 4, s * 4), fill=255)
    r = mask.resize((s, s), Image.LANCZOS); r.putalpha(m.resize((s, s), Image.LANCZOS)); r.save(f"{R}/mipmap-{d}/ic_launcher_round.png")
    f = round(s * 108 / 48)
    fg.resize((f, f), Image.LANCZOS).save(f"{R}/mipmap-{d}/ic_launcher_foreground.png")
    bg.resize((f, f), Image.LANCZOS).save(f"{R}/mipmap-{d}/ic_launcher_background.png")
for x in glob.glob(f"{R}/mipmap-anydpi-v26/*.xml"):
    open(x, "w").write('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n')
for p in glob.glob(f"{R}/drawable*/splash.png"):  # écran de démarrage : fond de l'app + icône centrée
    w, h = Image.open(p).size; im = Image.new("RGB", (w, h), (7, 11, 9)); s = int(min(w, h) * 0.28)
    im.paste(icon.resize((s, s), Image.LANCZOS), ((w - s) // 2, (h - s) // 2), icon.resize((s, s), Image.LANCZOS)); im.save(p)
print("ok")
