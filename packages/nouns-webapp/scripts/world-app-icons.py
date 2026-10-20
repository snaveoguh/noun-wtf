"""Noun World app icons + splash, cut from the game cover (CC0 Nouns art).

usage (from packages/nouns-webapp): python3 scripts/world-app-icons.py
writes public/world-app/icons/*.png and ../noun-world-app/resources/{icon,splash}.png
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COVER = os.path.join(ROOT, 'public/world2/cover.jpg')
OUT = os.path.join(ROOT, 'public/world-app/icons')
APP = os.path.join(ROOT, '..', 'noun-world-app', 'resources')
# The shark-head Noun's face, square (cover is 1600x2000)
FACE = (520, 585, 1120, 1185)
LIME = (200, 236, 64)
NIGHT = (24, 18, 48)


def face(size: int) -> Image.Image:
    return Image.open(COVER).convert('RGB').crop(FACE).resize((size, size), Image.LANCZOS)


def maskable(size: int) -> Image.Image:
    # Android masks can cut anything outside the centre 80% circle: pad the art
    bg = Image.new('RGB', (size, size), LIME)
    inner = round(size * 0.78)
    off = (size - inner) // 2
    bg.paste(face(inner), (off, off))
    return bg


def save(im: Image.Image, path: str) -> None:
    # 256-colour palette: the halftone dots make full-colour PNGs heavy
    im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for s in (48, 72, 96, 128, 144, 152, 192, 256, 384, 512):
        save(face(s), os.path.join(OUT, f'icon-{s}.png'))
    save(face(180), os.path.join(OUT, 'apple-touch-icon.png'))
    for s in (192, 512):
        save(maskable(s), os.path.join(OUT, f'maskable-{s}.png'))
    os.makedirs(APP, exist_ok=True)
    # Capacitor assets: 1024 icon (no transparency, App Store rule) + 2732 splash
    face(1024).save(os.path.join(APP, 'icon.png'), optimize=True)
    save(maskable(1024), os.path.join(APP, 'icon-foreground.png'))
    splash = Image.new('RGB', (2732, 2732), NIGHT)
    cover = Image.open(COVER).convert('RGB')
    h = 1600
    w = round(cover.width * h / cover.height)
    splash.paste(cover.resize((w, h), Image.LANCZOS), ((2732 - w) // 2, (2732 - h) // 2))
    save(splash, os.path.join(APP, 'splash.png'))
    save(splash, os.path.join(APP, 'splash-dark.png'))


if __name__ == '__main__':
    main()
