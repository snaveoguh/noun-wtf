"""Flat-albedo textures for the cel-shaded street look (numpy only).

No gradients, no noise: each material is one flat colour plus a couple of
hard-edged graphic panels / stripes (the toon ramp + outlines do the
shading). Layouts match sculpt.py. Arrays are (H, W, 4) uint8, row 0 = TOP.
"""
from __future__ import annotations

import numpy as np

import common as C
import sculpt as S

PANTS_HEX = "#5d6b3c"          # olive cargo
PANTS_STRIPE = "#f2c12e"       # yellow outer-seam stripe
PANTS_POCKET = "#4d5a30"
SHOE_HEX = "#e8473a"           # red upper
SHOE_PANEL = "#f4f1e8"         # white side panel / laces
SOLE_HEX = "#f4f1e8"
SOLE_BAND = "#1d1d22"
TREAD_HEX = "#3a3c42"


def rgb8(h):
    return np.array([int(round(c * 255)) for c in C.hex_rgb(h)], np.uint8)


class Flat:
    def __init__(self, size, color):
        self.s = size
        self.img = np.zeros((size, size, 4), np.uint8)
        self.img[..., :3] = rgb8(color)
        self.img[..., 3] = 255
        yy, xx = np.mgrid[0:size, 0:size]
        self.u, self.v = (xx + 0.5) / size, (yy + 0.5) / size

    def fill(self, mask, color):
        self.img[mask, :3] = rgb8(color)


def pants_texture(size=128):
    t = Flat(size, PANTS_HEX)
    u, v = t.u, t.v
    leg = u < 0.5
    lu = (u % 0.5) / 0.5                      # 0 inseam, .25 back, .5 outer, .75 front
    t.fill(leg & (np.abs(lu - 0.5) < 0.045), PANTS_STRIPE)          # outer-seam racing stripe
    pu0, pv0, pu1, pv1 = S.POCKET_UV
    pocket = (u >= pu0) & (u <= pu1) & (v >= pv0) & (v <= pv1)
    t.fill(pocket, PANTS_POCKET)
    return t.img


def shoe_texture(size=128):
    t = Flat(size, SHOE_HEX)
    u, v = t.u, t.v
    up = v < 0.61
    s = np.clip((v - S.SHOE_V0) / (S.SHOE_V1 - S.SHOE_V0), 0, 1)     # 0 heel .. 1 toe
    top_c = 3.5 / S.UPPER_N
    du = u - top_c
    # white side panels (both sides): a band from the heel to mid-foot
    side = (np.abs(np.abs(du) - 0.30) < 0.075) & (s > 0.12) & (s < 0.62)
    t.fill(up & side, SHOE_PANEL)
    # chunky white laces block on the instep
    t.fill(up & (np.abs(du) < 0.06) & (s > 0.38) & (s < 0.6), SHOE_PANEL)
    # sole: off-white, black band round the wall, dark tread underneath
    so = v >= 0.61
    t.fill(so, SOLE_HEX)
    wall_t = np.where(u < 1 / 3, u * 3, (u - 0.5) * 3)
    wall = (u < 1 / 3) | ((u > 0.5) & (u < 5 / 6))
    t.fill(so & wall & (np.abs(wall_t - 0.55) < 0.12), SOLE_BAND)
    t.fill(so & (u >= 1 / 3) & (u <= 0.5), TREAD_HEX)
    return t.img


def body_texture(body_hex="#5a65fa", accessory="accessory-txt-noun-multicolor", size=512):
    """Default NounBody (the runtime replaces it): flat jacket colour with the
    accessory art in the front rect."""
    import rig as RG
    img = Flat(size, body_hex).img
    acc = C.noun_part(accessory)
    region = acc[21:32, 9:23]
    u0, v0, u1, v1 = RG.UV_REGIONS["front"]
    C.blit(img, region, int(u0 * size), int(v0 * size), scale=size // 32)
    return img
