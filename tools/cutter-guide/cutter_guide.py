#!/usr/bin/env python3
"""
Sticker cutter-guide generator.

Takes sticker artwork (PNG with transparency, or Noun seeds rendered from
nouns-assets) and produces a print-ready sheet:

  * <name>.svg  - artwork layer + CutContour layer (magenta hairline), mm units
  * <name>.pdf  - same, with the cut line as a real spot colour named
                  "CutContour" (what kiss-cut printers look for)
  * <name>-preview.png - raster proof: artwork, cut line, and node dots

The cut line is a smooth, low-node offset of the artwork silhouette:

  silhouette -> union of pixel squares
             -> buffer(+offset + round)  (round joins: no spikes)
             -> buffer(-round)           (fills concave notches < round)
             -> Douglas-Peucker simplify
             -> Catmull-Rom -> cubic Bezier (one smooth closed path)

Usage:
  python3 cutter_guide.py --pngs art/*.png --width 50 --out sheet
  python3 cutter_guide.py --seeds 0:1:2:3:4 0:5:6:7:8 --width 50 --out sheet
  python3 cutter_guide.py --random 12 --width 45 --out demo

Seeds are background:body:accessory:head:glasses (indices into image-data.json).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import random
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
IMAGE_DATA = REPO / "packages" / "nouns-assets" / "src" / "image-data.json"

MM_PER_IN = 25.4
PT_PER_MM = 72 / MM_PER_IN


# --------------------------------------------------------------------------- #
# Noun rendering (RLE decode from nouns-assets image-data.json)
# --------------------------------------------------------------------------- #
def _load_image_data():
    return json.load(open(IMAGE_DATA))


def decode_rle(hexstr: str, palette: list[str]) -> Image.Image:
    """Decode one Noun part into a 32x32 RGBA image."""
    b = bytes.fromhex(hexstr[2:])
    top, right, bottom, left = b[1], b[2], b[3], b[4]
    width = right - left
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = img.load()
    x, y = left, top
    for i in range(5, len(b), 2):
        length, color = b[i], b[i + 1]
        for _ in range(length):
            if color != 0:
                hx = palette[color]
                px[x, y] = (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16), 255)
            x += 1
            if x >= right:
                x = left
                y += 1
    return img


def render_noun(seed: tuple[int, int, int, int, int], data=None, with_bg=False) -> Image.Image:
    """seed = (background, body, accessory, head, glasses). Transparent bg by default."""
    data = data or _load_image_data()
    bg, body, acc, head, glasses = seed
    pal = data["palette"]
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    if with_bg:
        hx = data["bgcolors"][bg]
        img = Image.new("RGBA", (32, 32), (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16), 255))
    for part, idx in (("bodies", body), ("accessories", acc), ("heads", head), ("glasses", glasses)):
        layer = decode_rle(data["images"][part][idx]["data"], pal)
        img.alpha_composite(layer)
    return img


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
@dataclass
class Sticker:
    name: str
    art: Image.Image          # RGBA artwork
    width_mm: float           # printed width of the artwork bbox
    cut: list[tuple[float, float]]   # polyline points in mm, relative to art origin
    bezier: list[tuple]       # cubic bezier segments in mm
    art_box_mm: tuple[float, float, float, float]  # x0,y0,x1,y1 of art within sticker
    cut_box_mm: tuple[float, float, float, float]  # bbox of cut path
    clearance_mm: float = 0.0  # measured min distance art -> cut line


def silhouette_polygon(alpha: np.ndarray, threshold=8) -> Polygon | MultiPolygon:
    """Union of opaque pixel squares (pixel coords)."""
    ys, xs = np.nonzero(alpha > threshold)
    squares = [box(x, y, x + 1, y + 1) for x, y in zip(xs, ys)]
    return unary_union(squares)


def biggest_polygon(geom) -> Polygon:
    if isinstance(geom, Polygon):
        return geom
    return max(geom.geoms, key=lambda g: g.area)


def smooth_offset(poly, offset_px: float, round_px: float, tol_px: float, convex_px: float = 0.0) -> list[tuple[float, float]]:
    """Offset outward and round off concavities; returns a dense, smooth closed ring.

    closing (buffer +, then -) fills concave notches narrower than `round_px`;
    opening (buffer -, then +) rounds convex corners to `convex_px` and shaves
    off protrusions thinner than 2*convex_px. Opening can move the line inward
    by up to ~0.41*(convex-offset) at a square corner, so the caller guards
    clearance and bumps the offset if needed.
    """
    g = poly.buffer(offset_px + round_px, join_style="round", quad_segs=32)
    g = g.buffer(-round_px, join_style="round", quad_segs=32)
    if convex_px > 0:
        g = g.buffer(-convex_px, join_style="round", quad_segs=32)
        g = g.buffer(convex_px, join_style="round", quad_segs=32)
    g = biggest_polygon(g)
    g = Polygon(g.exterior)              # drop any holes: one closed cut per sticker
    g = g.simplify(tol_px * 0.05, preserve_topology=True)   # only drop collinear junk
    pts = list(g.exterior.coords)[:-1]
    # ensure clockwise for consistent cutter direction
    if Polygon(pts).exterior.is_ccw:
        pts.reverse()
    return pts


def catmull_rom_to_bezier(pts: list[tuple[float, float]], tension=0.5):
    """Closed Catmull-Rom spline through pts -> list of cubic Bezier segments."""
    n = len(pts)
    segs = []
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 3, p1[1] + (p2[1] - p0[1]) * tension / 3)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 3, p2[1] - (p3[1] - p1[1]) * tension / 3)
        segs.append((p1, c1, c2, p2))
    return segs


# ---- Schneider (1990) cubic Bezier fitting ---------------------------------- #
def _v(a, b): return (b[0] - a[0], b[1] - a[1])
def _add(a, b): return (a[0] + b[0], a[1] + b[1])
def _mul(a, k): return (a[0] * k, a[1] * k)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1]
def _len(a): return math.hypot(a[0], a[1])
def _norm(a):
    l = _len(a)
    return (a[0] / l, a[1] / l) if l else (0.0, 0.0)

def _bez(ctrl, t):
    p0, p1, p2, p3 = ctrl
    mt = 1 - t
    return (mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
            mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1])

def _chord_params(pts):
    u = [0.0]
    for i in range(1, len(pts)):
        u.append(u[-1] + _len(_v(pts[i - 1], pts[i])))
    return [x / u[-1] for x in u] if u[-1] else [i / (len(pts) - 1) for i in range(len(pts))]

def _generate(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    C = [[0.0, 0.0], [0.0, 0.0]]
    X = [0.0, 0.0]
    for p, t in zip(pts, u):
        mt = 1 - t
        b1, b2 = 3 * mt * mt * t, 3 * mt * t * t
        a1, a2 = _mul(t1, b1), _mul(t2, b2)
        C[0][0] += _dot(a1, a1); C[0][1] += _dot(a1, a2)
        C[1][0] += _dot(a1, a2); C[1][1] += _dot(a2, a2)
        tmp = _v(_add(_mul(p0, mt**3 + b1), _mul(p3, b2 + t**3)), p)
        X[0] += _dot(a1, tmp); X[1] += _dot(a2, tmp)
    det = C[0][0] * C[1][1] - C[1][0] * C[0][1]
    a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det if det else 0.0
    a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det if det else 0.0
    seg = _len(_v(p0, p3))
    eps = 1e-6 * seg
    if a1 < eps or a2 < eps:
        a1 = a2 = seg / 3
    return (p0, _add(p0, _mul(t1, a1)), _add(p3, _mul(t2, a2)), p3)

def _reparam(pts, u, ctrl):
    out = []
    for p, t in zip(pts, u):
        for _ in range(3):   # a few Newton steps
            q = _bez(ctrl, t)
            d = _v(p, q)
            p0, p1, p2, p3 = ctrl
            d1 = [( (p1[0]-p0[0])*3, (p1[1]-p0[1])*3 ), ((p2[0]-p1[0])*3, (p2[1]-p1[1])*3), ((p3[0]-p2[0])*3, (p3[1]-p2[1])*3)]
            mt = 1 - t
            q1 = (mt*mt*d1[0][0] + 2*mt*t*d1[1][0] + t*t*d1[2][0], mt*mt*d1[0][1] + 2*mt*t*d1[1][1] + t*t*d1[2][1])
            d2 = [(d1[1][0]-d1[0][0])*2, (d1[1][1]-d1[0][1])*2], [(d1[2][0]-d1[1][0])*2, (d1[2][1]-d1[1][1])*2]
            q2 = (mt*d2[0][0] + t*d2[1][0], mt*d2[0][1] + t*d2[1][1])
            num = _dot(d, q1)
            den = _dot(q1, q1) + _dot(d, q2)
            if den == 0: break
            t = min(1.0, max(0.0, t - num / den))
        out.append(t)
    return out

def _max_err(pts, u, ctrl):
    worst, idx = 0.0, len(pts) // 2
    for i, (p, t) in enumerate(zip(pts, u)):
        e = _len(_v(p, _bez(ctrl, t)))
        if e > worst:
            worst, idx = e, i
    return worst, idx

def fit_cubic(pts, t1, t2, err, depth=0):
    if len(pts) == 2:
        d = _len(_v(pts[0], pts[1])) / 3
        return [(pts[0], _add(pts[0], _mul(t1, d)), _add(pts[1], _mul(t2, d)), pts[1])]
    u = _chord_params(pts)
    ctrl = _generate(pts, u, t1, t2)
    worst, idx = _max_err(pts, u, ctrl)
    if worst < err:
        return [ctrl]
    if worst < err * 4:
        for _ in range(8):
            u = _reparam(pts, u, ctrl)
            ctrl = _generate(pts, u, t1, t2)
            worst, idx = _max_err(pts, u, ctrl)
            if worst < err:
                return [ctrl]
    idx = max(1, min(len(pts) - 2, idx))
    tc = _norm(_v(pts[idx + 1], pts[idx - 1]))
    return fit_cubic(pts[:idx + 1], t1, tc, err, depth + 1) + fit_cubic(pts[idx:], _mul(tc, -1), t2, err, depth + 1)

def fit_closed(ring, err):
    """Fit a closed dense ring with cubic Beziers, max deviation `err`.

    Starts at the point of highest curvature so the seam lands on a corner-ish
    spot, and uses a shared tangent at the seam so the join is smooth.
    """
    n = len(ring)
    # start at the lowest point (deterministic, usually a flat run -> smooth seam)
    start = max(range(n), key=lambda i: (ring[i][1], ring[i][0]))
    pts = ring[start:] + ring[:start] + [ring[start]]
    t = _norm(_v(pts[-2], pts[1]))
    return fit_cubic(pts, t, _mul(t, -1), err)


def bezier_to_polyline(segs, steps=12):
    out = []
    for (p1, c1, c2, p2) in segs:
        for k in range(steps):
            t = k / steps
            mt = 1 - t
            x = mt**3 * p1[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * p2[0]
            y = mt**3 * p1[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * p2[1]
            out.append((x, y))
    return out


def build_sticker(name: str, art: Image.Image, width_mm: float, offset_mm: float,
                  round_mm: float, tol_mm: float, min_clearance_mm: float,
                  convex_mm: float = 0.0) -> Sticker:
    art = art.convert("RGBA")
    # crop to opaque bbox so width_mm refers to the visible artwork
    bbox = art.getbbox()
    art = art.crop(bbox)
    w_px, h_px = art.size
    mm_per_px = width_mm / w_px

    alpha = np.array(art)[:, :, 3]
    poly = biggest_polygon(silhouette_polygon(alpha))

    # Work in artwork pixel units, then scale to mm. Low-res pixel art would make
    # the rounding coarse, so upsample the geometry via scale factor.
    offset_px = offset_mm / mm_per_px
    round_px = round_mm / mm_per_px
    tol_px = tol_mm / mm_per_px
    convex_px = convex_mm / mm_per_px
    ring = smooth_offset(poly, offset_px, round_px, tol_px, convex_px)
    segs = fit_closed(ring, tol_px)

    # Safety: the smoothed curve must not cut into the artwork + clearance.
    guard = poly.buffer(min_clearance_mm / mm_per_px, join_style="mitre")
    curve_poly = Polygon(bezier_to_polyline(segs, 16))
    if not curve_poly.contains(guard):
        # fall back: bump the offset until it does
        bump = 0
        while not curve_poly.contains(guard) and bump < 10:
            bump += 1
            ring = smooth_offset(poly, offset_px + bump * 0.25 / mm_per_px, round_px, tol_px, convex_px)
            segs = fit_closed(ring, tol_px)
            curve_poly = Polygon(bezier_to_polyline(segs, 16))

    to_mm = lambda p: (p[0] * mm_per_px, p[1] * mm_per_px)
    segs_mm = [tuple(to_mm(p) for p in s) for s in segs]
    ring_mm = [sg[0] for sg in segs_mm]
    dense = bezier_to_polyline(segs_mm, 16)
    xs = [p[0] for p in dense]
    ys = [p[1] for p in dense]
    from shapely.geometry import LineString
    from shapely.affinity import scale as _scale
    art_mm = _scale(poly, mm_per_px, mm_per_px, origin=(0, 0))
    clearance = art_mm.exterior.distance(LineString(dense + [dense[0]]))
    if not Polygon(dense).contains(art_mm):
        clearance = -clearance
    return Sticker(
        name=name, art=art, width_mm=width_mm, cut=ring_mm, bezier=segs_mm,
        art_box_mm=(0, 0, w_px * mm_per_px, h_px * mm_per_px),
        cut_box_mm=(min(xs), min(ys), max(xs), max(ys)),
        clearance_mm=clearance,
    )


# --------------------------------------------------------------------------- #
# Layout
# --------------------------------------------------------------------------- #
@dataclass
class Placed:
    sticker: Sticker
    x: float  # mm, sheet coords of sticker's art origin
    y: float


def layout(stickers: list[Sticker], sheet_w: float, sheet_h: float, margin: float, gap: float):
    """Simple shelf packing, left-to-right, top-to-bottom. Returns list of pages."""
    pages, page = [], []
    x = margin
    y = margin
    row_h = 0.0
    for s in stickers:
        cx0, cy0, cx1, cy1 = s.cut_box_mm
        cw, ch = cx1 - cx0, cy1 - cy0
        if x + cw > sheet_w - margin and page:
            x = margin
            y += row_h + gap
            row_h = 0
        if y + ch > sheet_h - margin and page:
            pages.append(page)
            page = []
            x, y, row_h = margin, margin, 0
        page.append(Placed(s, x - cx0, y - cy0))
        x += cw + gap
        row_h = max(row_h, ch)
    if page:
        pages.append(page)
    return pages


# --------------------------------------------------------------------------- #
# Exporters
# --------------------------------------------------------------------------- #
def bezier_path_d(segs, ox, oy):
    d = [f"M {segs[0][0][0] + ox:.3f} {segs[0][0][1] + oy:.3f}"]
    for (_, c1, c2, p2) in segs:
        d.append(f"C {c1[0] + ox:.3f} {c1[1] + oy:.3f} {c2[0] + ox:.3f} {c2[1] + oy:.3f} {p2[0] + ox:.3f} {p2[1] + oy:.3f}")
    d.append("Z")
    return " ".join(d)


def png_data_uri(img: Image.Image, scale: int) -> str:
    import base64
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    buf = io.BytesIO()
    big.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def write_svg(pages, sheet_w, sheet_h, out: Path, stroke_mm=0.1, art_scale=16):
    files = []
    for pi, page in enumerate(pages, 1):
        parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{sheet_w}mm" height="{sheet_h}mm" viewBox="0 0 {sheet_w} {sheet_h}">',
            f'<rect width="{sheet_w}" height="{sheet_h}" fill="#ffffff"/>',
            '<g id="Artwork" style="image-rendering:pixelated;image-rendering:crisp-edges">',
        ]
        for p in page:
            s = p.sticker
            x0, y0, x1, y1 = s.art_box_mm
            parts.append(
                f'<image x="{p.x + x0:.3f}" y="{p.y + y0:.3f}" width="{x1 - x0:.3f}" height="{y1 - y0:.3f}" '
                f'preserveAspectRatio="none" xlink:href="{png_data_uri(s.art, art_scale)}"/>'
            )
        parts.append("</g>")
        parts.append(f'<g id="CutContour" fill="none" stroke="#ff00ff" stroke-width="{stroke_mm}">')
        for p in page:
            parts.append(f'<path id="cut-{p.sticker.name}" d="{bezier_path_d(p.sticker.bezier, p.x, p.y)}"/>')
        parts.append("</g></svg>")
        f = out.with_name(f"{out.name}-p{pi}.svg") if len(pages) > 1 else out.with_suffix(".svg")
        f.write_text("\n".join(parts))
        files.append(f)
    return files


def write_pdf(pages, sheet_w, sheet_h, out: Path, stroke_mm=0.1, art_scale=16):
    from reportlab.lib.colors import PCMYKColorSep
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    cut_colour = PCMYKColorSep(0, 100, 0, 0, spotName="CutContour", density=100)
    f = out.with_suffix(".pdf")
    c = canvas.Canvas(str(f), pagesize=(sheet_w * PT_PER_MM, sheet_h * PT_PER_MM))
    c.setTitle(out.name)
    for page in pages:
        # artwork
        for p in page:
            s = p.sticker
            x0, y0, x1, y1 = s.art_box_mm
            big = s.art.resize((s.art.width * art_scale, s.art.height * art_scale), Image.NEAREST)
            w, h = (x1 - x0) * PT_PER_MM, (y1 - y0) * PT_PER_MM
            px = (p.x + x0) * PT_PER_MM
            py = (sheet_h - (p.y + y1)) * PT_PER_MM
            c.drawImage(ImageReader(big), px, py, w, h, mask="auto")
        # cut contour, spot colour, hairline
        c.setStrokeColor(cut_colour)
        c.setLineWidth(stroke_mm * PT_PER_MM)
        c.setLineJoin(1)
        for p in page:
            path = c.beginPath()
            segs = p.sticker.bezier
            tx = lambda pt: ((pt[0] + p.x) * PT_PER_MM, (sheet_h - (pt[1] + p.y)) * PT_PER_MM)
            path.moveTo(*tx(segs[0][0]))
            for (_, c1, c2, p2) in segs:
                path.curveTo(*tx(c1), *tx(c2), *tx(p2))
            path.close()
            c.drawPath(path, stroke=1, fill=0)
        c.showPage()
    c.save()
    return f


def write_preview(pages, sheet_w, sheet_h, out: Path, dpi=150):
    files = []
    scale = dpi / MM_PER_IN
    for pi, page in enumerate(pages, 1):
        W, H = int(sheet_w * scale), int(sheet_h * scale)
        img = Image.new("RGBA", (W, H), (255, 255, 255, 255))
        for p in page:
            s = p.sticker
            x0, y0, x1, y1 = s.art_box_mm
            art = s.art.resize((max(1, int((x1 - x0) * scale)), max(1, int((y1 - y0) * scale))), Image.NEAREST)
            img.alpha_composite(art, (int((p.x + x0) * scale), int((p.y + y0) * scale)))
        draw = ImageDraw.Draw(img)
        for p in page:
            pts = [((x + p.x) * scale, (y + p.y) * scale) for x, y in bezier_to_polyline(p.sticker.bezier, 10)]
            draw.line(pts + [pts[0]], fill=(255, 0, 255, 255), width=2)
            for (x, y) in p.sticker.cut:
                cx, cy = (x + p.x) * scale, (y + p.y) * scale
                draw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(0, 120, 255, 255))
        f = out.with_name(f"{out.name}-preview-p{pi}.png") if len(pages) > 1 else out.with_name(f"{out.name}-preview.png")
        img.convert("RGB").save(f)
        files.append(f)
    return files


# --------------------------------------------------------------------------- #
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pngs", nargs="+", help="artwork PNGs with transparency")
    src.add_argument("--seeds", nargs="+", help="noun seeds bg:body:acc:head:glasses")
    src.add_argument("--random", type=int, metavar="N", help="render N random nouns (demo)")
    ap.add_argument("--width", type=float, default=50, help="artwork width in mm (default 50)")
    ap.add_argument("--offset", type=float, default=3.5, help="cut line distance from artwork, mm (default 3.5)")
    ap.add_argument("--round", dest="round_", type=float, default=12, help="concave rounding radius, mm (default 12)")
    ap.add_argument("--convex", type=float, default=5, help="convex corner rounding radius, mm (default 5)")
    ap.add_argument("--tolerance", type=float, default=0.35, help="max curve-fit deviation, mm (default 0.35)")
    ap.add_argument("--clearance", type=float, default=2, help="min art-to-cut clearance guard, mm (default 2)")
    ap.add_argument("--sheet", default="A4", help="A4, A3, SRA3 or WxH in mm (default A4)")
    ap.add_argument("--margin", type=float, default=10, help="sheet margin mm (default 10)")
    ap.add_argument("--gap", type=float, default=4, help="gap between cut lines mm (default 4)")
    ap.add_argument("--stroke", type=float, default=0.1, help="cut hairline width mm (default 0.1)")
    ap.add_argument("--out", default="cutter-guide", help="output basename (no extension)")
    ap.add_argument("--seed", type=int, default=67, help="random seed for --random")
    a = ap.parse_args(argv)

    sheets = {"A4": (210, 297), "A3": (297, 420), "SRA3": (320, 450), "A5": (148, 210)}
    if a.sheet.upper() in sheets:
        sheet_w, sheet_h = sheets[a.sheet.upper()]
    else:
        sheet_w, sheet_h = (float(v) for v in a.sheet.lower().split("x"))

    arts: list[tuple[str, Image.Image]] = []
    if a.pngs:
        for p in a.pngs:
            arts.append((Path(p).stem, Image.open(p)))
    else:
        data = _load_image_data()
        if a.seeds:
            seeds = [tuple(int(v) for v in s.split(":")) for s in a.seeds]
        else:
            rng = random.Random(a.seed)
            n = {k: len(v) for k, v in data["images"].items()}
            seeds = [(rng.randrange(2), rng.randrange(n["bodies"]), rng.randrange(n["accessories"]),
                      rng.randrange(n["heads"]), rng.randrange(n["glasses"])) for _ in range(a.random)]
        for s in seeds:
            arts.append(("noun-" + "-".join(map(str, s)), render_noun(s, data)))

    stickers = [build_sticker(n, im, a.width, a.offset, a.round_, a.tolerance, a.clearance, a.convex) for n, im in arts]
    pages = layout(stickers, sheet_w, sheet_h, a.margin, a.gap)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    svgs = write_svg(pages, sheet_w, sheet_h, out, a.stroke)
    pdf = write_pdf(pages, sheet_w, sheet_h, out, a.stroke)
    pngs = write_preview(pages, sheet_w, sheet_h, out)

    print(f"sheet {sheet_w}x{sheet_h}mm, {len(pages)} page(s), {len(stickers)} stickers")
    print(f"{'sticker':<28}{'nodes':>6}  {'cut size (mm)':<16}{'min gap (mm)':>12}")
    bad = 0
    for s in stickers:
        x0, y0, x1, y1 = s.cut_box_mm
        flag = "" if s.clearance_mm >= a.clearance else "  <-- TOO TIGHT"
        bad += bool(flag)
        print(f"{s.name:<28}{len(s.cut):>6}  {x1 - x0:5.1f} x {y1 - y0:5.1f}    {s.clearance_mm:12.2f}{flag}")
    if bad:
        print(f"WARNING: {bad} sticker(s) under the {a.clearance}mm clearance guard", file=sys.stderr)
    for f in svgs + [pdf] + pngs:
        print("wrote", f)


if __name__ == "__main__":
    main()
