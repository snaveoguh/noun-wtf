"""Labelled debug texture for the noun_head_base.glb UV contract (system python3 + Pillow).

Usage: python3 head_debug_grid.py <out.png> [size]
Each rect gets its own colour, its name, an "image top" arrow, an L/R edge
label and a grid, so a render shows at a glance whether every face is
oriented the way the manifest says.
"""
import sys

from PIL import Image, ImageDraw, ImageFont

RECTS = {
    "FRONT": ((0.0, 0.0, 0.5, 0.5), (233, 92, 70), "L=char R", "R=char L"),
    "LEFT": ((0.5, 0.0, 0.75, 0.5), (70, 160, 90), "front", "back"),
    "RIGHT": ((0.75, 0.0, 1.0, 0.5), (70, 110, 210), "back", "front"),
    "TOP": ((0.0, 0.5, 0.5, 1.0), (230, 190, 60), "char R", "char L"),
    "BACK": ((0.5, 0.5, 1.0, 1.0), (150, 90, 190), "char L", "char R"),
}


def main():
    out = sys.argv[1]
    S = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    img = Image.new("RGB", (S, S), (40, 40, 40))
    d = ImageDraw.Draw(img)
    try:
        big = ImageFont.load_default(size=S // 18)
        small = ImageFont.load_default(size=S // 48)
    except TypeError:
        big = small = ImageFont.load_default()
    for name, ((u0, v0, u1, v1), col, ltxt, rtxt) in RECTS.items():
        x0, y0, x1, y1 = int(u0 * S), int(v0 * S), int(u1 * S), int(v1 * S)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=col)
        step = S // 32
        for x in range(x0, x1, step):
            d.line([x, y0, x, y1], fill=tuple(int(c * 0.8) for c in col), width=1)
        for y in range(y0, y1, step):
            d.line([x0, y, x1, y], fill=tuple(int(c * 0.8) for c in col), width=1)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 255, 255), width=max(2, S // 256))
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        d.text((cx, cy), name, fill=(255, 255, 255), font=big, anchor="mm")
        # "up" arrow toward the image top of the rect
        d.polygon([(cx, y0 + S // 40), (cx - S // 40, y0 + S // 15), (cx + S // 40, y0 + S // 15)], fill=(255, 255, 255))
        d.text((cx, y0 + S // 11), "TOP", fill=(255, 255, 255), font=small, anchor="mm")
        d.text((x0 + S // 100, cy + S // 14), ltxt, fill=(20, 20, 20), font=small, anchor="lm")
        d.text((x1 - S // 100, cy + S // 14), rtxt, fill=(20, 20, 20), font=small, anchor="rm")
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
