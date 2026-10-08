"""Procedurally generated decal images (posters, graffiti, mural) -- numpy only, deterministic.

Images are written as PNG (RGBA, alpha used as glTF alphaMode MASK).
"""
import math
import os

import numpy as np

# Nouns-ish palette (sRGB 0..1)
PAL = {
    "red": (0.91, 0.22, 0.17), "black": (0.05, 0.05, 0.06), "white": (0.96, 0.95, 0.92),
    "cool": (0.835, 0.843, 0.882), "warm": (0.882, 0.843, 0.835), "yellow": (0.98, 0.78, 0.13),
    "blue": (0.15, 0.36, 0.85), "green": (0.18, 0.62, 0.35), "pink": (0.96, 0.52, 0.66),
    "orange": (0.98, 0.5, 0.1), "teal": (0.1, 0.65, 0.65), "purple": (0.5, 0.3, 0.75),
}

NOGGLES = [
    "...RRRRRR.RRRRRR",
    "...RWWBBR.RWWBBR",
    "RRRRWWBBRRRWWBBR",
    "R..RWWBBR.RWWBBR",
    "R..RWWBBR.RWWBBR",
    "...RRRRRR.RRRRRR",
]


def _rng(seed):
    return np.random.default_rng(seed)


def _smooth_noise(h, w, scale, rng, octaves=4):
    """Periodic value noise via FFT-filtered white noise (0..1)."""
    out = np.zeros((h, w))
    amp = 1.0
    for o in range(octaves):
        n = rng.standard_normal((h, w))
        fy = np.fft.fftfreq(h)[:, None]
        fx = np.fft.fftfreq(w)[None, :]
        f = np.sqrt(fx * fx + fy * fy)
        cut = (2 ** o) / scale
        filt = np.exp(-(f / cut) ** 2)
        out += amp * np.real(np.fft.ifft2(np.fft.fft2(n) * filt))
        amp *= 0.5
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def _blit_pixels(img, rows, x0, y0, px, colors):
    """Draw a pixel-art pattern (rows of chars) into img (H,W,4) top-left at x0,y0."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in colors:
                ys, ye = int(round(y0 + j * px)), int(round(y0 + (j + 1) * px))
                xs, xe = int(round(x0 + i * px)), int(round(x0 + (i + 1) * px))
                img[ys:ye, xs:xe, :3] = colors[ch]
                img[ys:ye, xs:xe, 3] = 1.0


def _text_bars(img, x0, y0, w, h, rng, color, lines=3):
    """Fake lettering: rows of blocky glyph-ish bars."""
    lh = h / lines
    for l_ in range(lines):
        x = x0
        while x < x0 + w * rng.uniform(0.7, 1.0):
            gw = rng.integers(2, 5) * lh * 0.18
            img[int(y0 + l_ * lh + lh * 0.15):int(y0 + l_ * lh + lh * 0.8), int(x):int(x + gw), :3] = color
            x += gw + lh * 0.12


def poster(i, size=(512, 420)):
    rng = _rng(100 + i)
    H, W = size
    bgs = ["cool", "warm", "yellow", "teal"]
    heads = ["pink", "blue", "orange", "green"]
    img = np.ones((H, W, 4))
    img[..., :3] = PAL[bgs[i % 4]]
    # noun head block + noggles
    hc = PAL[heads[i % 4]]
    px = W / 26
    hx0, hy0 = round(W * 0.22), round(H * 0.18)
    img[int(hy0):int(round(hy0 + 9 * px)), int(hx0):int(round(hx0 + 13 * px)), :3] = hc
    _blit_pixels(img, NOGGLES, hx0 - 2 * px, hy0 + 1.5 * px, px,
                 {"R": PAL["red"], "W": PAL["white"], "B": PAL["black"]})
    # body
    img[int(hy0 + 9 * px):int(hy0 + 14 * px), int(hx0 + 2 * px):int(hx0 + 11 * px), :3] = PAL[heads[(i + 1) % 4]]
    # title/caption
    _text_bars(img, W * 0.08, H * 0.80, W * 0.84, H * 0.14, rng, PAL["black"], lines=2)
    big = PAL["red"] if i % 2 else PAL["black"]
    img[int(H * 0.04):int(H * 0.12), int(W * 0.08):int(W * 0.92), :3] = big
    # print grain + weathering + torn edges
    g = _smooth_noise(H, W, 40, rng, 3)
    img[..., :3] *= (0.86 + 0.18 * g[..., None])
    fade = _smooth_noise(H, W, 120, rng, 2)
    img[..., :3] = img[..., :3] * (0.75 + 0.25 * fade[..., None]) + 0.12 * (1 - fade[..., None])
    edge = _smooth_noise(H, W, 25, rng, 3)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)) / min(H, W)
    img[..., 3] = (d + 0.03 * edge > 0.025).astype(float)
    return np.clip(img, 0, 1)


FONT = {
    "N": ["X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X", "X...X"],
    "O": [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
    "U": ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
    "S": [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
    "W": ["X...X", "X...X", "X...X", "X.X.X", "X.X.X", "XX.XX", "X...X"],
    "T": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
    "F": ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "X...."],
    "K": ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
    "8": [".XXX.", "X...X", "X...X", ".XXX.", "X...X", "X...X", ".XXX."],
    "!": ["..X..", "..X..", "..X..", "..X..", "..X..", ".....", "..X.."],
}


def _gauss_blur(a, sigma):
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    filt = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * filt))


def _word_mask(word, H, W, rng, cell):
    m = np.zeros((H, W))
    n = len(word)
    total_w = n * 6 * cell
    x = (W - total_w) / 2
    for ch in word:
        g = FONT[ch]
        dy = rng.uniform(-0.6, 0.6) * cell
        y0 = (H - 7 * cell) / 2 + dy
        for j, row in enumerate(g):
            for i, c in enumerate(row):
                if c == "X":
                    ys, xs = int(y0 + j * cell), int(x + i * cell)
                    m[max(0, ys):ys + int(cell) + 1, max(0, xs):xs + int(cell) + 1] = 1.0
        x += 6 * cell
    return m


WORDS = ["NOUNS", "WTF!", "SK8", "TOKO", "FUN!", "NOWS", "KOOK", "STUNT"]
N_GRAFFITI = len(WORDS)
FILLS = [("pink", "yellow"), ("teal", "blue"), ("orange", "red"), ("yellow", "green"),
         ("purple", "pink"), ("blue", "teal"), ("green", "yellow"), ("red", "purple")]


def graffiti(i, size=(384, 1536)):
    rng = _rng(200 + i)
    H, W = size
    img = np.zeros((H, W, 4))
    fills = tuple(PAL[c] for c in FILLS[i % len(FILLS)])
    word = WORDS[i % len(WORDS)]
    cell = min(H / 9.5, W / (len(word) * 6 + 1))
    m = _word_mask(word, H, W, rng, cell)
    field = _gauss_blur(m, cell * 0.55)
    inside = field > 0.42
    outline = field > 0.16
    shadow = np.roll(np.roll(outline, int(cell * 0.35), 0), int(cell * 0.45), 1)
    yy = np.mgrid[0:H, 0:W][0] / H
    grad = np.clip((yy - 0.25) / 0.55, 0, 1)[..., None]
    fill = np.array(fills[0]) * (1 - grad) + np.array(fills[1]) * grad
    img[shadow] = (*PAL["black"], 1.0)
    img[outline] = (*PAL["white"], 1.0)
    img[inside, :3] = fill[inside]
    # 3D-ish inner highlight
    hl = (field > 0.75) & (np.roll(field, -int(cell * 0.2), 0) < field)
    img[hl, :3] = np.clip(img[hl, :3] * 0.6 + 0.4, 0, 1)
    # drips
    for k in range(14):
        x = int(rng.uniform(0.1, 0.9) * W)
        col = np.where(inside[:, x])[0]
        if len(col) == 0:
            continue
        y0 = col.max()
        ln = int(rng.uniform(0.04, 0.18) * H)
        c = img[max(0, y0 - 2), x, :3].copy()
        img[y0:min(H, y0 + ln), x:x + 4, :3] = c
        img[y0:min(H, y0 + ln), x:x + 4, 3] = 1.0
    # overspray halo + wear
    halo = (_gauss_blur(outline.astype(float), cell * 0.3) > 0.05) & (img[..., 3] < 0.5)
    sp = _smooth_noise(H, W, 3, rng, 1) > 0.6
    img[halo & sp] = (*PAL["black"], 1.0)
    n = _smooth_noise(H, W, 6, rng, 2)
    img[..., 3] *= (n > 0.12)
    img[..., :3] *= (0.88 + 0.16 * _smooth_noise(H, W, 30, rng, 3)[..., None])
    return np.clip(img, 0, 1)


def mural(size=(1024, 1024 * 16 // 10)):
    """Big wall mural: a noun head with noggles over a sunset gradient."""
    H, W = size
    rng = _rng(300)
    img = np.zeros((H, W, 4))
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    t = yy / H
    sky = np.array(PAL["yellow"]) * (1 - t[..., None]) + np.array(PAL["pink"]) * t[..., None]
    img[..., :3] = sky
    img[..., 3] = 1.0
    # sun stripes
    cx, cy, r = W * 0.5, H * 0.62, H * 0.38
    disc = (xx - cx) ** 2 + (yy - cy) ** 2 < r * r
    stripes = (np.floor(yy / (H * 0.05)) % 2 == 0) | (yy < cy)
    img[disc & stripes, :3] = PAL["orange"]
    # noun head (pixel art, scale)
    px = H / 22
    head_rows = ["." * 2 + "H" * 12 + "." * 2] * 9
    hx0, hy0 = W * 0.5 - 8 * px, H * 0.18
    _blit_pixels(img, head_rows, hx0, hy0, px, {"H": PAL["teal"]})
    _blit_pixels(img, NOGGLES, hx0 - 1 * px, hy0 + 2 * px, px, {"R": PAL["red"], "W": PAL["white"], "B": PAL["black"]})
    body = ["...BBBBBBBBBB..."] * 6
    _blit_pixels(img, body, hx0, hy0 + 9 * px, px, {"B": PAL["purple"]})
    # paint wear + border
    n = _smooth_noise(H, W, 50, rng, 3)
    img[..., :3] *= (0.85 + 0.2 * n[..., None])
    e = _smooth_noise(H, W, 20, rng, 3)
    d = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)) / min(H, W)
    img[..., 3] = (d + 0.04 * e > 0.03).astype(float)
    return np.clip(img, 0, 1)


def write_png(arr, path):
    import bpy
    H, W, _ = arr.shape
    img = bpy.data.images.new("__decal", W, H, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    # our arrays are top-down; Blender pixels are bottom-up
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def make_decals(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    files = {}
    for i in range(4):
        p = os.path.join(out_dir, f"poster_{i}.png")
        write_png(poster(i), p)
        files[f"poster_{i}"] = {"color": p}
    for i in range(N_GRAFFITI):
        p = os.path.join(out_dir, f"graffiti_{i}.png")
        write_png(graffiti(i), p)
        files[f"graffiti_{i}"] = {"color": p}
    p = os.path.join(out_dir, "mural.png")
    write_png(mural(), p)
    files["mural"] = {"color": p}
    return files
