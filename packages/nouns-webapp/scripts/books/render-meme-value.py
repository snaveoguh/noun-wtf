"""Render "MEME VALUE" (LIL 67) into the flipbook's page set.

    python3 scripts/books/render-meme-value.py <memevalue.pdf> [out=public/books/meme-value]

Get the PDF from https://memevalue.pinit.eth.limo/ (88 MB; we don't host it).
Needs poppler (pdftoppm, pdftotext, pdfinfo) and Pillow.

The PDF is a square front cover, 125 two-page spreads and a square back cover,
all with a 21 pt slug around the 648 pt trim. Each page is cropped to the trim
and split, so the book is 252 square pages:
  p001.webp ... p252.webp   1400 px (quality 74, 82 for text-heavy pages,
                            stepped down until <= 300 KB)
  sm/p001.webp ...          700 px for phones (<= 110 KB)
  pages.json                {pageCount, width, height, pages: [{n, text}]}
"""
import json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

PDF = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '../../public/books/meme-value')
PX = 1400
TRIM_PT, SLUG_PT = 648, 21
DPI = PX / TRIM_PT * 72
SLUG = round(SLUG_PT * DPI / 72)
QL, QS = 74, 70


def pdf_pages():
    out = subprocess.run(['pdfinfo', PDF], capture_output=True, text=True).stdout
    return int(re.search(r'Pages:\s+(\d+)', out).group(1))


def page_width_pt(i):
    out = subprocess.run(['pdfinfo', '-f', str(i), '-l', str(i), PDF], capture_output=True, text=True).stdout
    return float(re.search(rf'Page\s+{i} size:\s+([\d.]+)', out).group(1))


def render(i, tmp):
    w = PX if page_width_pt(i) < 1000 else PX * 2
    base = os.path.join(tmp, f'raw-{i:03d}')
    subprocess.run(['pdftoppm', '-f', str(i), '-l', str(i), '-r', f'{DPI:.4f}', '-x', str(SLUG), '-y', str(SLUG),
                    '-W', str(w), '-H', str(PX), '-png', '-singlefile', PDF, base], check=True, capture_output=True)
    return base + '.png'


def text(i, x):
    r = subprocess.run(['pdftotext', '-f', str(i), '-l', str(i), '-r', f'{DPI:.4f}', '-x', str(x), '-y', str(SLUG),
                        '-W', str(PX), '-H', str(PX), PDF, '-'], capture_output=True, text=True)
    t = re.sub('[​‌‍﻿­\f]', '', r.stdout)
    return '\n'.join(l for l in (' '.join(l.split()) for l in t.splitlines()) if l).strip()


def save(im, path, q, cap):
    # heavy photo/scribble pages step down in quality until they fit the cap
    while True:
        im.save(path, 'WEBP', quality=q, method=6)
        if os.path.getsize(path) <= cap or q <= 58:
            return
        q -= 6


def main():
    os.makedirs(os.path.join(OUT, 'sm'), exist_ok=True)
    n_pdf = pdf_pages()
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(4) as ex:
        raws = list(ex.map(lambda i: render(i, tmp), range(1, n_pdf + 1)))
        pages, n = [], 0
        for i, raw in enumerate(raws, 1):
            im = Image.open(raw).convert('RGB')
            halves = [(im, SLUG)] if im.width == PX else [
                (im.crop((0, 0, PX, PX)), SLUG), (im.crop((PX, 0, PX * 2, PX)), SLUG + PX)]
            for half, x in halves:
                n += 1
                t = text(i, x)
                dense = len(t) > 900  # small type: a little more quality
                save(half, os.path.join(OUT, f'p{n:03d}.webp'), QL + 8 if dense else QL, 300_000)
                save(half.resize((PX // 2, PX // 2), Image.LANCZOS), os.path.join(OUT, 'sm', f'p{n:03d}.webp'),
                     QS + 8 if dense else QS, 110_000)
                pages.append({'n': n, 'text': t})
            print(f'pdf page {i} -> book page {n}', flush=True)
    meta = {'title': 'MEME VALUE', 'author': 'LIL 67', 'pageCount': n, 'width': PX, 'height': PX,
            'smWidth': PX // 2, 'smHeight': PX // 2, 'pages': pages}
    with open(os.path.join(OUT, 'pages.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    print('pages', n)


main()
