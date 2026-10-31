#!/usr/bin/env python3
"""MEME VALUE's 252 pages as one contact sheet (NOUNS CAMP's floor poster).

Run from packages/nouns-webapp after re-rendering the book:
    python3 scripts/books/meme-value-sheet.py
Writes public/world2/camp/meme-value-sheet.webp (28 x 9 pages, 72 px each).
"""
from pathlib import Path

from PIL import Image

COLS, ROWS, CELL, GAP = 28, 9, 72, 1
src = Path('public/books/meme-value/sm')
out = Path('public/world2/camp/meme-value-sheet.webp')
sheet = Image.new('RGB', (COLS * CELL, ROWS * CELL), (246, 244, 238))
for n in range(1, COLS * ROWS + 1):
    p = src / f'p{n:03d}.webp'
    if not p.exists():
        continue
    i = n - 1
    page = Image.open(p).convert('RGB').resize((CELL - GAP, CELL - GAP), Image.LANCZOS)
    sheet.paste(page, ((i % COLS) * CELL, (i // COLS) * CELL))
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, 'WEBP', quality=82, method=6)
print(out, sheet.size, out.stat().st_size // 1024, 'KB')
