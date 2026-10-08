"""Assemble rendered clip frames into labelled contact sheets (system python3 + Pillow).

Usage: python3 contact_sheet.py <frames_dir> <out.png> clipA,clipB,... [frames_per_clip]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    frames_dir, out, names = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].split(",")
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    first = Image.open(frames_dir / f"{names[0]}_0.png")
    w, h = first.size
    label_w = 120
    sheet = Image.new("RGB", (label_w + n * w, len(names) * h), (30, 30, 34))
    d = ImageDraw.Draw(sheet)
    for r, name in enumerate(names):
        d.text((6, r * h + h // 2 - 6), name, fill=(240, 240, 240))
        for i in range(n):
            p = frames_dir / f"{name}_{i}.png"
            if p.exists():
                sheet.paste(Image.open(p).convert("RGB"), (label_w + i * w, r * h))
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
