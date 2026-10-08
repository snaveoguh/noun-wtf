"""Art-direction pass: "Jet Set Radio street style" (cel-shaded runtime, bold outlines).

The procedural recipes in level_materials bake fairly photoreal tiling textures. For the
cel-shaded look we post-process those albedo textures into flat, punchy colour fields while
keeping the graphic structure (tile seams, window grids, plank lines):

    1. blur away sub-centimetre noise (box blur x2)
    2. k-means palette quantisation -> K flat colour fields
    3. re-draw the strong dark lines of the source (seams, joints, frames) as crisp ink lines
    4. grade: saturation / value boost and an optional colourise toward a target hue
Special materials (painted hazard curbs) are generated directly. Normal maps are dropped
(they fight the toon ramp); ORM (roughness/metal) maps are kept.

Constant-colour materials (cars, awnings, paint, noggles...) get a saturated palette via
``apply_const_palette``. Everything is cached by source-hash in <cache>/jsr/.
"""
import colorsys
import hashlib
import inspect
import os

import bpy
import numpy as np

import level_materials as LMAT


def _hex(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


# name: dict(k, blur, sat, val, tint=(hex, strength), lines, special)
STYLE = {
    "plaza_concrete": dict(k=3, sat=1.0, val=1.25, tint=("#e9dcc6", 0.55), lines=0.75),
    "pavers": dict(k=5, sat=2.4, val=1.2, tint=("#ff8a5c", 0.25), lines=0.7),
    "sidewalk": dict(k=3, sat=1.0, val=1.2, tint=("#f2b8c6", 0.5), lines=0.7),
    "asphalt": dict(k=3, sat=1.0, val=1.25, tint=("#3b3f6b", 0.75), lines=0.4),
    "curb": dict(special="hazard"),
    "concrete_ramp": dict(k=3, sat=1.0, val=1.3, tint=("#9fd3f0", 0.6), lines=0.6),
    "granite": dict(k=2, sat=1.0, val=1.35, tint=("#ff6b8b", 0.7), lines=0.0),
    "granite_dark": dict(k=2, sat=1.0, val=2.6, tint=("#6a4bc4", 0.85), lines=0.0),
    "ledge_top": dict(k=3, sat=1.0, val=1.3, tint=("#ffd1dc", 0.55), lines=0.15),
    "ledge_top_plain": dict(k=3, sat=1.0, val=1.3, tint=("#ffd1dc", 0.55), lines=0.15),
    "metal_cap": dict(k=3, sat=1.0, val=1.25, lines=0.3),
    "rail_paint": dict(k=2, sat=1.0, val=8.0, tint=("#ffd23f", 0.95), lines=0.0),
    "kicker_steel": dict(k=3, sat=1.0, val=1.4, tint=("#c7d3e0", 0.3), lines=0.6),
    "wood": dict(k=4, sat=1.8, val=1.6, tint=("#ff9a3c", 0.5), lines=0.7),
    "palm_bark": dict(k=3, sat=1.6, val=1.5, tint=("#b0703a", 0.4), lines=0.5),
    "bark": dict(k=3, sat=1.6, val=1.8, tint=("#8a4f2a", 0.4), lines=0.5),
    "palm_leaf": dict(k=3, sat=1.0, val=2.2, tint=("#3fcf5a", 0.8), lines=0.3),
    "tree_leaf": dict(k=3, sat=1.0, val=2.4, tint=("#4cc95a", 0.75), lines=0.3),
    "soil": dict(k=2, sat=1.5, val=1.6, lines=0.2),
    "pool_tile": dict(k=3, sat=1.0, val=1.6, tint=("#2fd6e0", 0.7), lines=0.8),
    "roof": dict(k=3, sat=1.0, val=1.3, tint=("#8c8fb8", 0.35), lines=0.5),
    "trim": dict(k=3, sat=1.0, val=1.3, tint=("#fff3e0", 0.4), lines=0.6),
    "facade_a_cream": dict(k=6, sat=1.6, val=1.3, tint=("#ffe08a", 0.35), lines=0.7),
    "facade_a_terracotta": dict(k=6, sat=1.7, val=1.35, tint=("#ff7a45", 0.35), lines=0.7),
    "facade_a_salmon": dict(k=6, sat=1.6, val=1.3, tint=("#ff8fa3", 0.35), lines=0.7),
    "facade_a_ochre": dict(k=6, sat=1.7, val=1.3, tint=("#ffb627", 0.35), lines=0.7),
    "facade_b_white": dict(k=6, sat=1.0, val=1.25, tint=("#e8f0ff", 0.25), lines=0.7),
    "facade_b_mint": dict(k=6, sat=1.8, val=1.3, tint=("#5ff2b0", 0.4), lines=0.7),
    "facade_b_sky": dict(k=6, sat=1.8, val=1.3, tint=("#5fb8ff", 0.4), lines=0.7),
    "facade_b_sand": dict(k=6, sat=1.6, val=1.3, tint=("#ffcf8a", 0.35), lines=0.7),
    "facade_c_brick": dict(k=6, sat=1.6, val=1.35, tint=("#e8503a", 0.35), lines=0.7),
    "plaster_cream": dict(k=3, sat=1.4, val=1.3, tint=("#fff0c2", 0.4), lines=0.6),
    "shopfront": dict(k=6, sat=2.0, val=1.4, lines=0.6),
    "shopfront_dark": dict(k=6, sat=2.0, val=1.4, lines=0.6),
}

# saturated flat palette for constant materials (sRGB hex)
CONST = {
    "car_red": "#e8262f", "car_blue": "#2457e6", "car_cream": "#ffe3a3", "car_teal": "#16c2b5",
    "car_black": "#1c1c28", "car_white": "#f4f4f8", "car_yellow": "#ffc400", "car_silver": "#b7c0cf",
    "car_glass": "#1d2a44", "tire": "#141418",
    "noggle_red": "#ff2e2e", "noggle_white": "#ffffff", "noggle_black": "#0a0a0a",
    "lamp_paint": "#24b38a", "lamp_glass": "#fff6c9",
    "paint_white": "#fafafa", "paint_yellow": "#ffd000",
    "awning_red": "#ff3b4e", "awning_green": "#27d17f", "awning_blue": "#2f7bff", "awning_cream": "#ffe6a8",
    "railing": "#232336", "water": "#1aa8c9",
}


def _srgb_to_lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def apply_const_palette():
    for name, hx in CONST.items():
        if name in LMAT.SPECS:
            LMAT.SPECS[name]["color"] = tuple(float(x) for x in _srgb_to_lin(_hex(hx)))
            if name.startswith("car_") and name != "car_silver":
                LMAT.SPECS[name]["metal"] = 0.0


# ------------------------------------------------------------------------------ image ops
def _load(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"  # raw sRGB-encoded bytes
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[..., :3]


def _box(a, r):
    """Periodic box blur (textures tile) along both axes, radius r px."""
    if r < 1:
        return a
    out = a
    for ax in (0, 1):
        c = np.cumsum(np.concatenate([np.take(out, range(-r - 1, 0), axis=ax), out,
                                      np.take(out, range(0, r), axis=ax)], axis=ax), axis=ax)
        n = out.shape[ax]
        hi = np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=ax)
        lo = np.take(c, range(0, n), axis=ax)
        out = (hi - lo) / (2 * r + 1)
    return out


def _lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _kmeans(px, k, rng, iters=10):
    sample = px[rng.choice(len(px), min(len(px), 20000), replace=False)]
    # init: luminance quantiles (deterministic, spreads clusters across the value range)
    order = np.argsort(_lum(sample))
    cen = sample[order[((np.arange(k) + 0.5) / k * len(order)).astype(int)]].copy()
    for _ in range(iters):
        d = ((sample[:, None, :] - cen[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for j in range(k):
            m = lab == j
            if m.any():
                cen[j] = sample[m].mean(0)
    return cen


def _assign(px, cen):
    out = np.empty(len(px), np.int32)
    for s in range(0, len(px), 1 << 18):
        d = ((px[s:s + (1 << 18), None, :] - cen[None]) ** 2).sum(-1)
        out[s:s + (1 << 18)] = d.argmin(1)
    return out


def _grade(c, sat, val, tint):
    """c: (...,3) sRGB 0..1 colours."""
    flat = c.reshape(-1, 3)
    out = np.empty_like(flat)
    th = None
    if tint:
        tr, tg, tb = _hex(tint[0])
        th, ts, tv = colorsys.rgb_to_hsv(tr, tg, tb)
    for i, (r, g, b) in enumerate(flat):
        h, s, v = colorsys.rgb_to_hsv(float(r), float(g), float(b))
        s = min(1.0, s * sat)
        v = min(1.0, v * val)
        if tint:
            st = tint[1]
            # colourise: pull hue + saturation toward the target, keep the field's value structure
            dh = ((th - h + 0.5) % 1.0) - 0.5
            h = (h + dh * st) % 1.0
            s = s * (1 - st) + ts * st
            v = min(1.0, v * (1 - st * 0.35) + tv * st * 0.35)
        out[i] = colorsys.hsv_to_rgb(h, s, v)
    return out.reshape(c.shape)


def stylize(src, p, res_hint=None, seed=0):
    a = _load(src)
    H, W, _ = a.shape
    if p.get("special") == "hazard":
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        band = np.floor((xx / W + yy / H) * 4.0) % 2
        yel, blk = _hex("#ffcc1a"), _hex("#1e1e26")
        return np.where(band[..., None] > 0.5, yel, blk).astype(np.float32)
    r = max(1, W // 160)
    soft = _box(_box(a, r), r)
    rng = np.random.default_rng(seed)
    cen = _kmeans(soft.reshape(-1, 3), p.get("k", 4), rng)
    lab = _assign(soft.reshape(-1, 3), cen)
    # grade palette (k colours only -> cheap)
    gc = _grade(cen, p.get("sat", 1.3), p.get("val", 1.2), p.get("tint"))
    flat = gc[lab].reshape(H, W, 3)
    # ink lines: strong local darkening in the (lightly smoothed) source
    if p.get("lines", 0) > 0:
        fine = _box(a, max(1, r // 3))
        base = _box(_box(fine, r * 3), r * 3)
        dark = _lum(base) - _lum(fine)
        thr = max(0.05, float(np.percentile(dark, 97)) * 0.6)
        m = np.clip((dark - thr) / (thr * 0.6), 0, 1)[..., None] * p["lines"]
        ink = flat * 0.35
        flat = flat * (1 - m) + ink * m
    return np.clip(flat, 0, 1).astype(np.float32)


def _save(arr, path):
    LMAT._save_rgb(arr, path, srgb=False, quality=90)


def stylize_textures(tex_files, cache_dir, log=print):
    """tex_files: {name: {color, normal?, orm?}} -> same dict with stylised colour maps, no normals."""
    os.makedirs(cache_dir, exist_ok=True)
    code = hashlib.sha1(inspect.getsource(inspect.getmodule(stylize)).encode()).hexdigest()[:10]
    out = {}
    for i, (name, files) in enumerate(sorted(tex_files.items())):
        p = STYLE.get(name)
        nf = {k: v for k, v in files.items() if k != "normal"}
        if p is None:
            out[name] = nf
            continue
        src = files["color"]
        h = hashlib.sha1(open(src, "rb").read()).hexdigest()[:10] + code + repr(sorted(p.items()))
        h = hashlib.sha1(h.encode()).hexdigest()[:12]
        dst = os.path.join(cache_dir, f"{name}.jpg")
        stamp = os.path.join(cache_dir, f".{name}.hash")
        if not (os.path.exists(dst) and os.path.exists(stamp) and open(stamp).read() == h):
            _save(stylize(src, p, seed=i), dst)
            open(stamp, "w").write(h)
            log(f"  stylized {name}")
        nf["color"] = dst
        out[name] = nf
    return out
