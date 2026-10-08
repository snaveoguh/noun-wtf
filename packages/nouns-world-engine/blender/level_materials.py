"""Noggle Plaza materials: procedural recipes -> baked tiling textures -> glTF-friendly materials.

Every textured material has a physical tile size (meters per texture repeat). UV map 0
("UVMap") is world-space box projected with that tile size (or explicit per-face UVs for
ledge tops, facades, benches, decals), so texel density is consistent across the level.

Baking: each recipe is evaluated on a plane whose UVs span [0,1] and whose size equals the
tile size; Cycles EMIT bakes give albedo (sRGB JPG) and roughness/metal (packed into a glTF
ORM JPG: G=roughness, B=metal), and a NORMAL bake of a Bump node gives a tangent-space
(OpenGL, +Y) normal map. Results are cached by recipe hash so re-runs are fast.
"""
import hashlib
import inspect
import os

import bpy

from level_nodes import G

# --------------------------------------------------------------------------------------
# small colour helpers (all colours are LINEAR)
# --------------------------------------------------------------------------------------


def lin(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def tone(g, col, f):
    return g.mulc(g.rgb(col) if isinstance(col, tuple) else col, f)


def var(g, scale, amt, seed, detail=3.0, stretch=(1.0, 1.0)):
    """Multiplicative brightness variation 1±amt."""
    n = g.noise(scale, detail, 0.55, seed, stretch)
    return g.mapr(n, 0.25, 0.75, 1.0 - amt, 1.0 + amt, smooth=False, clamp=False)


def speckle(g, scale, radius, seed):
    d = g.voronoi(scale, "F1", seed)
    return g.mapr(d, radius, radius * 0.4)


def blotch(g, scale, lo, hi, seed, detail=3.0, stretch=(1.0, 1.0)):
    return g.mapr(g.noise(scale, detail, 0.6, seed, stretch), lo, hi)


def cracks(g, scale, width, seed, amount=0.55):
    warp = g.noise(scale * 4, 2.0, 0.5, seed + 50)
    d = g.voronoi(scale, "DISTANCE_TO_EDGE", seed)
    d = g.add(d, g.mul(g.sub(warp, 0.5), 0.05))
    line = g.mapr(d, width, 0.0)
    keep = g.mapr(g.noise(scale * 0.7, 2.0, 0.5, seed + 77), amount, amount + 0.08)
    return g.mul(line, keep)


def granite_color(g, base, seed=0, dark=False):
    c = tone(g, base, var(g, 4.0, 0.06, seed))
    c = tone(g, c, var(g, 40.0, 0.07, seed + 1, detail=1.0))
    mica = speckle(g, 70.0, 0.32, seed + 2)
    feld = speckle(g, 45.0, 0.26, seed + 3)
    if dark:
        c = g.mixc(g.mul(feld, 0.7), c, g.rgb((0.32, 0.31, 0.30)))
        c = g.mixc(g.mul(mica, 0.8), c, g.rgb((0.01, 0.01, 0.012)))
    else:
        c = g.mixc(g.mul(mica, 0.85), c, g.rgb((0.035, 0.032, 0.03)))
        c = g.mixc(g.mul(feld, 0.6), c, g.rgb((0.62, 0.58, 0.55)))
    return c, g.add(g.mul(mica, -0.0003), g.mul(feld, 0.0002))


def wax(g, mask_band, seed):
    """Streaky wax/grind marks (mask in 0..1)."""
    s1 = g.noise(14.0, 4.0, 0.6, seed, stretch=(0.06, 1.0))
    s2 = g.noise(3.0, 2.0, 0.5, seed + 1)
    m = g.mul(g.mapr(s1, 0.42, 0.7), g.mapr(s2, 0.3, 0.6))
    return g.mul(m, mask_band)


# --------------------------------------------------------------------------------------
# recipes: f(g, **params) -> dict(color, height, rough, metal)
# --------------------------------------------------------------------------------------


def r_plaza_concrete(g):
    gr = g.grid(2, 2, seed=1)
    c = tone(g, (0.255, 0.245, 0.225), g.mapr(gr["r"], 0, 1, 0.92, 1.08, smooth=False))
    c = tone(g, c, var(g, 0.5, 0.08, 1))
    c = tone(g, c, var(g, 2.5, 0.06, 2, detail=6.0))
    c = tone(g, c, var(g, 160.0, 0.06, 3, detail=1.0))
    agg = speckle(g, 110.0, 0.22, 11)
    c = g.mixc(g.mul(agg, 0.5), c, g.rgb((0.10, 0.095, 0.09)))
    agg2 = speckle(g, 80.0, 0.18, 12)
    c = g.mixc(g.mul(agg2, 0.4), c, g.rgb((0.42, 0.40, 0.37)))
    stains = blotch(g, 1.1, 0.58, 0.75, 4)
    c = g.mixc(g.mul(stains, 0.25), c, g.rgb((0.12, 0.105, 0.085)))
    skid = g.mul(blotch(g, 7.0, 0.6, 0.72, 5, stretch=(0.07, 1.0)), blotch(g, 0.9, 0.45, 0.6, 6))
    c = g.mixc(g.mul(skid, 0.35), c, g.rgb((0.04, 0.04, 0.04)))
    gum = g.mul(speckle(g, 2.5, 0.05, 7), blotch(g, 1.5, 0.5, 0.6, 8))
    c = g.mixc(g.mul(gum, 0.7), c, g.rgb((0.05, 0.05, 0.048)))
    seam = g.mapr(gr["d"], 0.005, 0.002)
    near = g.mapr(gr["d"], 0.05, 0.0)
    c = tone(g, c, g.sub(1.0, g.mul(near, 0.15)))
    cr = cracks(g, 0.7, 0.005, 9, amount=0.72)
    c = g.mixc(g.mul(cr, 0.6), c, g.rgb((0.04, 0.035, 0.03)))
    c = g.mixc(seam, c, g.rgb((0.035, 0.032, 0.03)))
    h = g.add(g.mul(seam, -0.004), g.mul(cr, -0.001))
    h = g.add(h, g.mul(g.noise(80.0, 2.0, 0.5, 10), 0.0004))
    return {"color": c, "height": h}


def r_pavers(g):
    gr = g.grid(8, 8, row_offset=0.0, seed=2)
    r = gr["r"]
    warm = g.rgb((0.36, 0.29, 0.25))
    cool = g.rgb((0.27, 0.27, 0.27))
    base = g.mixc(g.mapr(gr["r2"], 0.55, 0.75), cool, warm)
    c = tone(g, base, g.mapr(r, 0, 1, 0.85, 1.12, smooth=False))
    gcol, gh = granite_color(g, (0.5, 0.5, 0.5), seed=20)
    c = g.mixc(1.0, c, gcol, "MULTIPLY")
    c = tone(g, c, 2.0)
    c = tone(g, c, var(g, 0.4, 0.08, 21))
    dirt = g.mapr(gr["d"], 0.05, 0.0)
    c = tone(g, c, g.sub(1.0, g.mul(dirt, 0.25)))
    seam = g.mapr(gr["d"], 0.007, 0.003)
    c = g.mixc(seam, c, g.rgb((0.05, 0.045, 0.04)))
    bevel = g.mapr(gr["d"], 0.012, 0.0, 0.0, 1.0)
    h = g.add(g.mul(bevel, -0.004), gh)
    return {"color": c, "height": h}


def r_sidewalk(g):
    gr = g.grid(2, 2, seed=3)
    c = tone(g, (0.24, 0.235, 0.22), g.mapr(gr["r"], 0, 1, 0.92, 1.06, smooth=False))
    c = tone(g, c, var(g, 0.6, 0.08, 30))
    broom = g.noise(70.0, 2.0, 0.5, 31, stretch=(1.0, 0.02))
    c = tone(g, c, g.mapr(broom, 0.3, 0.7, 0.94, 1.06, smooth=False))
    c = tone(g, c, var(g, 140.0, 0.05, 32, detail=1.0))
    gum = g.mul(speckle(g, 3.0, 0.06, 33), blotch(g, 2.0, 0.45, 0.55, 34))
    c = g.mixc(g.mul(gum, 0.8), c, g.rgb((0.06, 0.06, 0.055)))
    st = blotch(g, 1.4, 0.6, 0.78, 35)
    c = g.mixc(g.mul(st, 0.3), c, g.rgb((0.12, 0.1, 0.08)))
    seam = g.mapr(gr["d"], 0.006, 0.0025)
    c = g.mixc(seam, c, g.rgb((0.05, 0.05, 0.045)))
    cr = cracks(g, 0.9, 0.01, 36, amount=0.6)
    c = g.mixc(g.mul(cr, 0.7), c, g.rgb((0.05, 0.05, 0.05)))
    h = g.add(g.mul(seam, -0.004), g.mul(g.sub(broom, 0.5), 0.0008))
    h = g.add(h, g.mul(cr, -0.0015))
    return {"color": c, "height": h}


def r_asphalt(g):
    c = tone(g, (0.06, 0.06, 0.062), var(g, 0.25, 0.12, 40))
    c = tone(g, c, var(g, 3.0, 0.08, 41))
    stones = speckle(g, 90.0, 0.3, 42)
    c = g.mixc(g.mul(stones, 0.75), c, g.rgb((0.17, 0.165, 0.16)))
    fine = g.voronoi(220.0, "F1", 43, out="Color")
    fl = g.m("POWER", g.m("ADD", g.mul(g.add(fine, 0.0), 1.0), 0.0), 1.0)
    c = tone(g, c, g.mapr(fl, 0.0, 1.0, 0.75, 1.25, smooth=False))
    patch = blotch(g, 0.35, 0.6, 0.62, 44, detail=1.0)
    c = tone(g, c, g.sub(1.0, g.mul(patch, 0.3)))
    oil = blotch(g, 1.3, 0.66, 0.8, 45)
    c = g.mixc(g.mul(oil, 0.6), c, g.rgb((0.012, 0.012, 0.012)))
    cr = cracks(g, 0.45, 0.012, 46, amount=0.5)
    c = g.mixc(g.mul(cr, 0.9), c, g.rgb((0.015, 0.015, 0.015)))
    h = g.add(g.mul(stones, 0.0012), g.mul(cr, -0.003))
    h = g.add(h, g.mul(g.noise(60.0, 3.0, 0.6, 47), 0.0012))
    return {"color": c, "height": h}


def r_curb(g):
    gr = g.grid(2, 2, seed=5)
    c, gh = granite_color(g, (0.40, 0.39, 0.37), seed=50)
    c = tone(g, c, g.mapr(gr["r"], 0, 1, 0.9, 1.05, smooth=False))
    sc = g.mul(blotch(g, 5.0, 0.6, 0.72, 51, stretch=(0.1, 1.0)), blotch(g, 0.8, 0.4, 0.6, 52))
    c = g.mixc(g.mul(sc, 0.6), c, g.rgb((0.03, 0.03, 0.03)))
    dirt = blotch(g, 1.0, 0.5, 0.75, 53)
    c = g.mixc(g.mul(dirt, 0.3), c, g.rgb((0.12, 0.1, 0.08)))
    seam = g.mapr(gr["d"], 0.006, 0.002)
    c = g.mixc(seam, c, g.rgb((0.05, 0.05, 0.05)))
    return {"color": c, "height": g.add(gh, g.mul(seam, -0.003))}


def r_concrete_ramp(g):
    c = tone(g, (0.25, 0.245, 0.235), var(g, 0.35, 0.1, 60))
    c = tone(g, c, var(g, 3.0, 0.06, 67, detail=6.0))
    c = g.mixc(g.mul(speckle(g, 100.0, 0.2, 68), 0.4), c, g.rgb((0.09, 0.09, 0.085)))
    trowel = g.noise(1.6, 6.0, 0.65, 61, dist=1.5)
    c = tone(g, c, g.mapr(trowel, 0.3, 0.7, 0.93, 1.07, smooth=False))
    c = tone(g, c, var(g, 120.0, 0.04, 62, detail=1.0))
    marks = g.mul(blotch(g, 5.0, 0.6, 0.7, 63, stretch=(0.06, 1.0)), blotch(g, 0.8, 0.45, 0.6, 64))
    c = g.mixc(g.mul(marks, 0.4), c, g.rgb((0.04, 0.04, 0.04)))
    st = blotch(g, 0.9, 0.62, 0.8, 65)
    c = g.mixc(g.mul(st, 0.25), c, g.rgb((0.14, 0.12, 0.1)))
    cr = cracks(g, 0.5, 0.01, 66, amount=0.6)
    c = g.mixc(g.mul(cr, 0.8), c, g.rgb((0.05, 0.05, 0.05)))
    h = g.add(g.mul(trowel, 0.0006), g.mul(cr, -0.0015))
    return {"color": c, "height": h}


def r_granite(g):
    c, gh = granite_color(g, (0.44, 0.42, 0.41), seed=70)
    dirt = blotch(g, 1.5, 0.6, 0.8, 71)
    c = g.mixc(g.mul(dirt, 0.18), c, g.rgb((0.13, 0.11, 0.09)))
    return {"color": c, "height": gh}


def r_granite_dark(g):
    c, gh = granite_color(g, (0.075, 0.075, 0.08), seed=75, dark=True)
    return {"color": c, "height": gh}


def r_ledge_top(g):
    """Ledge top: v runs across the ledge width (0..1), u along it (2 m per repeat)."""
    c, gh = granite_color(g, (0.44, 0.42, 0.41), seed=80)
    band = g.add(g.mul(g.mapr(g.v, 0.02, 0.1), g.mapr(g.v, 0.36, 0.22)),
                 g.mul(g.mapr(g.v, 0.98, 0.9), g.mapr(g.v, 0.64, 0.78)))
    w = wax(g, band, 81)
    w2 = g.mul(g.mul(blotch(g, 2.0, 0.55, 0.75, 82), 0.5), band)
    w = g.mx(w, w2)
    c = g.mixc(g.mul(w, 0.75), c, g.rgb((0.10, 0.085, 0.06)))
    scuff = g.mul(blotch(g, 10.0, 0.66, 0.74, 83, stretch=(0.05, 1.0)), band)
    c = g.mixc(g.mul(scuff, 0.8), c, g.rgb((0.02, 0.02, 0.02)))
    rough = g.mapr(w, 0.0, 1.0, 0.55, 0.22, smooth=False)
    return {"color": c, "height": gh, "rough": rough}


def r_ledge_top_plain(g):
    c, gh = granite_color(g, (0.44, 0.42, 0.41), seed=85)
    m = blotch(g, 1.6, 0.55, 0.75, 86)
    w = wax(g, m, 87)
    c = g.mixc(g.mul(w, 0.7), c, g.rgb((0.10, 0.085, 0.06)))
    rough = g.mapr(w, 0.0, 1.0, 0.55, 0.25, smooth=False)
    return {"color": c, "height": gh, "rough": rough}


def r_metal_cap(g):
    brushed = g.noise(60.0, 2.0, 0.5, 90, stretch=(0.02, 1.0))
    c = tone(g, (0.50, 0.50, 0.50), g.mapr(brushed, 0.3, 0.7, 0.85, 1.12, smooth=False))
    grime = blotch(g, 3.0, 0.55, 0.75, 91)
    c = g.mixc(g.mul(grime, 0.55), c, g.rgb((0.08, 0.07, 0.06)))
    polish = blotch(g, 4.0, 0.45, 0.65, 92, stretch=(0.08, 1.0))
    rough = g.mapr(polish, 0.0, 1.0, 0.5, 0.22, smooth=False)
    rough = g.add(rough, g.mul(grime, 0.3))
    return {"color": c, "rough": rough, "metal": g.sub(1.0, g.mul(grime, 0.6))}


def r_rail_paint(g):
    chip = g.mapr(g.noise(9.0, 4.0, 0.6, 95), 0.64, 0.68)
    grind = g.mapr(g.noise(5.0, 3.0, 0.5, 96, stretch=(0.05, 1.0)), 0.55, 0.62)
    bare = g.mx(chip, grind)
    paint = tone(g, (0.022, 0.03, 0.045), var(g, 6.0, 0.15, 97))
    c = g.mixc(bare, paint, g.rgb((0.45, 0.44, 0.42)))
    rough = g.mapr(bare, 0.0, 1.0, 0.45, 0.3, smooth=False)
    return {"color": c, "rough": rough, "metal": bare}


def r_kicker_steel(g):
    sp = g.voronoi(14.0, "F1", 100, out="Color")
    c = tone(g, (0.36, 0.37, 0.38), g.mapr(sp, 0.0, 1.0, 0.85, 1.12, smooth=False))
    sc = blotch(g, 6.0, 0.6, 0.7, 101, stretch=(0.06, 1.0))
    c = g.mixc(g.mul(sc, 0.6), c, g.rgb((0.05, 0.05, 0.05)))
    # diamond plate studs: alternating diagonal lozenges
    gr = g.grid(10, 10)
    par = g.m("MODULO", g.add(gr["row"], gr["col"]), 2.0)
    fu = g.sub(gr["fu"], 0.5)
    fv = g.sub(gr["fv"], 0.5)
    a = g.add(g.mul(fu, 0.7071), g.mul(fv, 0.7071))
    b = g.sub(g.mul(fu, 0.7071), g.mul(fv, 0.7071))
    a2 = g.add(g.mul(g.m("ABSOLUTE", a), g.sub(1.0, par)), g.mul(g.m("ABSOLUTE", b), par))
    b2 = g.add(g.mul(g.m("ABSOLUTE", b), g.sub(1.0, par)), g.mul(g.m("ABSOLUTE", a), par))
    stud = g.mul(g.mapr(a2, 0.32, 0.22), g.mapr(b2, 0.08, 0.04))
    c = tone(g, c, g.add(1.0, g.mul(stud, 0.12)))
    return {"color": c, "height": g.mul(stud, 0.0015), "rough": g.mapr(sc, 0, 1, 0.45, 0.6, smooth=False),
            "metal": 1.0}


def r_wood(g):
    """Bench slats along u, 5 slats across v (bench top uses explicit UVs)."""
    gr = g.grid(1, 5, seed=110)
    grain = g.noise(3.0, 6.0, 0.7, 111, stretch=(0.04, 1.0), dist=0.8)
    c = tone(g, (0.20, 0.13, 0.075), g.mapr(grain, 0.3, 0.7, 0.75, 1.2, smooth=False))
    c = tone(g, c, g.mapr(gr["r"], 0, 1, 0.85, 1.1, smooth=False))
    grey = blotch(g, 1.5, 0.45, 0.7, 112)
    c = g.mixc(g.mul(grey, 0.45), c, g.rgb((0.16, 0.15, 0.14)))
    wx = wax(g, g.mapr(gr["dv"], 0.03, 0.0), 113)
    c = g.mixc(g.mul(wx, 0.7), c, g.rgb((0.03, 0.025, 0.02)))
    gap = g.mapr(gr["dv"], 0.006, 0.002)
    c = g.mixc(gap, c, g.rgb((0.01, 0.008, 0.006)))
    h = g.add(g.mul(gap, -0.006), g.mul(grain, 0.0006))
    return {"color": c, "height": h}


def r_palm_bark(g):
    rings = g.m("FRACT", g.mul(g.v, 9.0))
    ring = g.mapr(g.m("ABSOLUTE", g.sub(rings, 0.5)), 0.3, 0.5)
    c = tone(g, (0.16, 0.13, 0.095), var(g, 5.0, 0.15, 120))
    c = g.mixc(g.mul(ring, 0.6), c, g.rgb((0.06, 0.05, 0.035)))
    fib = g.noise(30.0, 3.0, 0.6, 121, stretch=(1.0, 0.1))
    c = tone(g, c, g.mapr(fib, 0.3, 0.7, 0.85, 1.15, smooth=False))
    return {"color": c, "height": g.add(g.mul(ring, -0.01), g.mul(fib, 0.003))}


def r_bark(g):
    st = g.noise(12.0, 5.0, 0.65, 125, stretch=(1.0, 0.12))
    c = tone(g, (0.09, 0.07, 0.055), g.mapr(st, 0.3, 0.7, 0.6, 1.3, smooth=False))
    moss = blotch(g, 2.0, 0.6, 0.75, 126)
    c = g.mixc(g.mul(moss, 0.35), c, g.rgb((0.06, 0.08, 0.03)))
    return {"color": c, "height": g.mul(st, 0.01)}


def r_palm_leaf(g):
    c = tone(g, (0.06, 0.13, 0.03), var(g, 2.0, 0.2, 130))
    stripes = g.noise(20.0, 2.0, 0.5, 131, stretch=(1.0, 0.05))
    c = tone(g, c, g.mapr(stripes, 0.3, 0.7, 0.75, 1.2, smooth=False))
    dry = blotch(g, 1.2, 0.62, 0.75, 132)
    c = g.mixc(g.mul(dry, 0.5), c, g.rgb((0.22, 0.17, 0.06)))
    return {"color": c}


def r_tree_leaf(g):
    cells = g.voronoi(6.0, "F1", 135, out="Color")
    c = g.mixc(g.m("ADD", cells, 0.0), g.rgb((0.035, 0.08, 0.02)), g.rgb((0.10, 0.17, 0.035)))
    c = tone(g, c, var(g, 20.0, 0.2, 136))
    edge = g.voronoi(6.0, "DISTANCE_TO_EDGE", 135)
    c = tone(g, c, g.mapr(edge, 0.0, 0.15, 0.6, 1.0))
    return {"color": c}


def r_soil(g):
    c = tone(g, (0.05, 0.035, 0.022), var(g, 3.0, 0.2, 140))
    leaves = speckle(g, 12.0, 0.25, 141)
    c = g.mixc(g.mul(leaves, 0.7), c, g.rgb((0.16, 0.10, 0.04)))
    pebbles = speckle(g, 30.0, 0.3, 142)
    c = g.mixc(g.mul(pebbles, 0.6), c, g.rgb((0.2, 0.19, 0.17)))
    return {"color": c, "height": g.add(g.mul(pebbles, 0.004), g.mul(leaves, 0.002))}


def r_pool_tile(g):
    gr = g.grid(10, 10, seed=150)
    c = g.mixc(g.mapr(gr["r"], 0.2, 0.9), g.rgb((0.02, 0.16, 0.24)), g.rgb((0.05, 0.28, 0.36)))
    grout = g.mapr(gr["d"], 0.004, 0.0015)
    c = g.mixc(grout, c, g.rgb((0.5, 0.52, 0.5)))
    algae = blotch(g, 1.5, 0.55, 0.75, 151)
    c = g.mixc(g.mul(algae, 0.4), c, g.rgb((0.05, 0.1, 0.05)))
    return {"color": c, "height": g.mul(grout, -0.002)}


def r_roof(g):
    c = tone(g, (0.18, 0.175, 0.17), var(g, 0.5, 0.12, 160))
    grav = g.voronoi(60.0, "F1", 161, out="Color")
    c = tone(g, c, g.mapr(grav, 0.0, 1.0, 0.7, 1.3, smooth=False))
    st = blotch(g, 0.8, 0.6, 0.8, 162)
    c = g.mixc(g.mul(st, 0.3), c, g.rgb((0.08, 0.075, 0.07)))
    return {"color": c}


def r_trim(g):
    c = tone(g, (0.55, 0.52, 0.47), var(g, 1.0, 0.08, 165))
    c = tone(g, c, var(g, 50.0, 0.05, 166, detail=1.0))
    d = blotch(g, 1.4, 0.6, 0.8, 167, stretch=(1.0, 0.15))
    c = g.mixc(g.mul(d, 0.3), c, g.rgb((0.2, 0.18, 0.15)))
    return {"color": c}


# ------------------------------------------------------------------- facades
def _stucco(g, wall, seed):
    c = tone(g, wall, var(g, 1.2, 0.07, seed))
    c = tone(g, c, var(g, 25.0, 0.05, seed + 1, detail=2.0))
    return c


def _window_glass(g, Yl, y0, y1, seed):
    grad = g.mapr(Yl, y0, y1, 0.0, 1.0, smooth=False)
    glass = g.mixc(grad, g.rgb((0.012, 0.018, 0.03)), g.rgb((0.10, 0.14, 0.2)))
    refl = blotch(g, 1.3, 0.55, 0.7, seed, stretch=(1.0, 0.4))
    glass = g.mixc(g.mul(refl, 0.35), glass, g.rgb((0.35, 0.4, 0.45)))
    return glass


def _local(g, gr, w, h):
    return g.mul(gr["fu"], w), g.mul(gr["fv"], h)


def _box(g, X, Y, x0, x1, y0, y1, s=0.004):
    a = g.mul(g.mapr(X, x0 - s, x0 + s), g.mapr(X, x1 + s, x1 - s))
    b = g.mul(g.mapr(Y, y0 - s, y0 + s), g.mapr(Y, y1 + s, y1 - s))
    return g.mul(a, b)


def r_facade_a(g, wall=(0.6, 0.55, 0.45), shutter=(0.03, 0.11, 0.06)):
    """Mediterranean: shuttered windows, cornice band. Tile = 2 bays x 2 floors."""
    gr = g.grid(2, 2, seed=170)
    X, Y = _local(g, gr, 3.6, 3.4)
    c = _stucco(g, wall, 171)
    band = _box(g, X, Y, -1, 5, 0.0, 0.2)
    c = g.mixc(band, c, tone(g, wall, 1.25))
    # streaks under the sills
    streak = g.mul(_box(g, X, Y, 1.1, 2.5, 0.25, 0.9, s=0.08), blotch(g, 6.0, 0.45, 0.7, 172, stretch=(1.0, 0.08)))
    c = g.mixc(g.mul(streak, 0.3), c, g.rgb((0.12, 0.1, 0.08)))
    win = _box(g, X, Y, 1.15, 2.45, 0.9, 2.85)
    frame = g.sub(win, _box(g, X, Y, 1.22, 2.38, 0.97, 2.78))
    glass = _window_glass(g, Y, 0.97, 2.78, 173)
    mull = g.mx(_box(g, X, Y, 1.78, 1.82, 0.97, 2.78), _box(g, X, Y, 1.22, 2.38, 2.15, 2.19))
    c = g.mixc(win, c, glass)
    c = g.mixc(g.mx(frame, g.mul(mull, win)), c, g.rgb((0.62, 0.6, 0.55)))
    # sill
    sill = _box(g, X, Y, 1.05, 2.55, 0.82, 0.92)
    c = g.mixc(sill, c, g.rgb((0.55, 0.52, 0.47)))
    # shutters: open (both sides) or closed (over window) per bay
    slats = g.mapr(g.m("FRACT", g.mul(Y, 12.0)), 0.0, 0.5, 0.75, 1.15, smooth=False)
    sh_col = tone(g, shutter, slats)
    closed = g.mapr(gr["r"], 0.30, 0.31)  # 1 = open
    open_l = _box(g, X, Y, 0.5, 1.12, 0.9, 2.85)
    open_r = _box(g, X, Y, 2.48, 3.1, 0.9, 2.85)
    sh_open = g.mul(g.mx(open_l, open_r), closed)
    sh_closed = g.mul(win, g.sub(1.0, closed))
    half = g.mul(_box(g, X, Y, 1.15, 1.8, 0.9, 2.85), g.mul(g.mapr(gr["r"], 0.55, 0.56), g.mapr(gr["r"], 0.75, 0.74)))
    sh = g.mx(g.mx(sh_open, sh_closed), half)
    c = g.mixc(sh, c, sh_col)
    # curtain behind glass on some windows
    cur = g.mul(g.mul(win, g.sub(1.0, g.mx(frame, mull))), g.mapr(gr["r2"], 0.6, 0.61))
    c = g.mixc(g.mul(cur, g.mul(_box(g, X, Y, 1.2, 1.6, 0.97, 2.78), 0.85)), c, g.rgb((0.6, 0.55, 0.45)))
    rough = g.mapr(g.mul(win, g.sub(1.0, g.mx(frame, sh))), 0.0, 1.0, 0.9, 0.08, smooth=False)
    h = g.add(g.mul(win, -0.03), g.mul(band, 0.02))
    return {"color": c, "rough": rough, "height": h}


def r_facade_b(g, wall=(0.7, 0.7, 0.68)):
    """LA modern: wide windows, slab band, blinds on some."""
    gr = g.grid(2, 2, seed=180)
    X, Y = _local(g, gr, 3.6, 3.4)
    c = _stucco(g, wall, 181)
    slab = _box(g, X, Y, -1, 5, 0.0, 0.32)
    c = g.mixc(slab, c, g.rgb((0.32, 0.31, 0.3)))
    win = _box(g, X, Y, 0.25, 3.35, 0.75, 2.95)
    inner = _box(g, X, Y, 0.3, 3.3, 0.8, 2.9)
    frame = g.sub(win, inner)
    mull = g.mul(_box(g, X, Y, 1.77, 1.83, 0.8, 2.9), inner)
    glass = _window_glass(g, Y, 0.8, 2.9, 182)
    blinds = g.mapr(g.m("FRACT", g.mul(Y, 22.0)), 0.0, 0.6, 0.85, 1.1, smooth=False)
    bl_on = g.mul(g.mapr(gr["r"], 0.5, 0.51), _box(g, X, Y, 0.3, 3.3, 1.6, 2.9))
    glass = g.mixc(bl_on, glass, tone(g, (0.5, 0.48, 0.44), blinds))
    c = g.mixc(win, c, glass)
    c = g.mixc(g.mx(frame, mull), c, g.rgb((0.02, 0.02, 0.022)))
    streak = g.mul(_box(g, X, Y, 0.2, 3.4, 0.32, 0.75, s=0.05), blotch(g, 6.0, 0.5, 0.75, 183, stretch=(1.0, 0.08)))
    c = g.mixc(g.mul(streak, 0.2), c, g.rgb((0.15, 0.13, 0.11)))
    glassm = g.mul(inner, g.sub(1.0, g.mx(mull, bl_on)))
    rough = g.mapr(glassm, 0.0, 1.0, 0.85, 0.06, smooth=False)
    return {"color": c, "rough": rough, "height": g.mul(win, -0.03)}


def r_facade_c(g):
    """Brick warehouse with steel windows."""
    gb = g.grid(32, 92, row_offset=0.5, seed=190)
    bcol = g.mixc(g.mapr(gb["r"], 0.1, 0.9), g.rgb((0.20, 0.06, 0.035)), g.rgb((0.36, 0.13, 0.07)))
    bcol = tone(g, bcol, g.mapr(gb["r2"], 0, 1, 0.75, 1.15, smooth=False))
    bcol = tone(g, bcol, var(g, 30.0, 0.1, 191))
    mortar = g.mapr(gb["d"], 0.007, 0.003)
    c = g.mixc(mortar, bcol, g.rgb((0.3, 0.29, 0.27)))
    gr = g.grid(2, 2, seed=192)
    X, Y = _local(g, gr, 3.6, 3.4)
    win = _box(g, X, Y, 0.6, 3.0, 0.75, 2.85)
    lintel = _box(g, X, Y, 0.5, 3.1, 2.85, 3.05)
    sill = _box(g, X, Y, 0.5, 3.1, 0.65, 0.75)
    c = g.mixc(g.mx(lintel, sill), c, g.rgb((0.42, 0.41, 0.39)))
    glass = _window_glass(g, Y, 0.75, 2.85, 193)
    pu = g.m("FRACT", g.mul(g.sub(X, 0.6), 4.0 / 2.4))
    pv = g.m("FRACT", g.mul(g.sub(Y, 0.75), 4.0 / 2.1))
    bars = g.mx(g.mapr(g.mn(pu, g.inv(pu)), 0.03, 0.015), g.mapr(g.mn(pv, g.inv(pv)), 0.03, 0.015))
    c = g.mixc(win, c, glass)
    c = g.mixc(g.mul(win, bars), c, g.rgb((0.03, 0.035, 0.035)))
    soot = blotch(g, 0.8, 0.5, 0.8, 194, stretch=(1.0, 0.3))
    c = g.mixc(g.mul(soot, 0.25), c, g.rgb((0.05, 0.04, 0.035)))
    rough = g.mapr(g.mul(win, g.sub(1.0, bars)), 0.0, 1.0, 0.9, 0.1, smooth=False)
    h = g.add(g.mul(mortar, -0.006), g.mul(win, -0.03))
    return {"color": c, "rough": rough, "height": h}


def r_plaster(g, wall=(0.6, 0.55, 0.45)):
    c = _stucco(g, wall, 200)
    d = blotch(g, 0.6, 0.55, 0.8, 201, stretch=(1.0, 0.25))
    c = g.mixc(g.mul(d, 0.25), c, g.rgb((0.15, 0.13, 0.1)))
    return {"color": c}


def r_shopfront(g, sign=(0.02, 0.2, 0.2), frame=(0.015, 0.015, 0.017)):
    X, Y = g.X(), g.Y()  # 4.0 x 3.2 m
    c = g.rgb(frame)
    glass_r = _box(g, X, Y, 0.12, 2.55, 0.4, 2.5)
    glass = _window_glass(g, Y, 0.4, 2.5, 210)
    # hint of interior shelves / goods
    shelf = g.mul(g.mapr(g.m("FRACT", g.mul(Y, 2.2)), 0.0, 0.12, 1.0, 0.0), blotch(g, 3.0, 0.4, 0.6, 211))
    glass = g.mixc(g.mul(shelf, 0.6), glass, g.rgb((0.25, 0.18, 0.1)))
    c = g.mixc(glass_r, c, glass)
    door = _box(g, X, Y, 2.75, 3.75, 0.02, 2.5)
    door_in = _box(g, X, Y, 2.85, 3.65, 0.1, 2.4)
    c = g.mixc(door_in, c, _window_glass(g, Y, 0.1, 2.4, 212))
    _ = door
    kick = _box(g, X, Y, 0.0, 2.65, 0.0, 0.38)
    c = g.mixc(kick, c, g.rgb((0.3, 0.29, 0.27)))
    signb = _box(g, X, Y, 0.0, 4.0, 2.62, 3.2)
    c = g.mixc(signb, c, g.rgb(sign))
    # fake lettering
    letters = g.mul(_box(g, X, Y, 0.4, 3.6, 2.78, 3.02),
                    g.mapr(g.m("FRACT", g.mul(X, 3.3)), 0.15, 0.2, 0.0, 1.0))
    letters = g.mul(letters, g.mapr(g.m("FRACT", g.mul(X, 3.3)), 0.75, 0.7, 0.0, 1.0))
    c = g.mixc(letters, c, g.rgb((0.85, 0.8, 0.65)))
    # posters stuck on the glass
    p1 = _box(g, X, Y, 0.3, 0.75, 1.0, 1.6)
    c = g.mixc(p1, c, g.rgb((0.7, 0.05, 0.03)))
    p2 = _box(g, X, Y, 0.85, 1.25, 1.05, 1.55)
    c = g.mixc(p2, c, g.rgb((0.85, 0.75, 0.1)))
    rough = g.mapr(g.mx(g.mul(glass_r, g.sub(1, g.mx(p1, p2))), door_in), 0.0, 1.0, 0.6, 0.06, smooth=False)
    return {"color": c, "rough": rough}


# --------------------------------------------------------------------------------------
# material table
# --------------------------------------------------------------------------------------
# kind: proc (recipe baked), const (factors only), decal (image from level_textures)
# tile: meters per repeat (u, v); res: bake resolution; normal: bake normal map;
# rough/metal: constants (used unless recipe returns a map -> ORM texture)

FACADE_A_TINTS = {
    "cream": ((0.62, 0.55, 0.40), (0.03, 0.11, 0.06)),
    "terracotta": ((0.52, 0.22, 0.12), (0.30, 0.25, 0.18)),
    "salmon": ((0.66, 0.36, 0.27), (0.02, 0.07, 0.16)),
    "ochre": ((0.60, 0.40, 0.14), (0.02, 0.09, 0.05)),
}
FACADE_B_TINTS = {
    "white": (0.72, 0.72, 0.70),
    "mint": (0.42, 0.62, 0.50),
    "sky": (0.40, 0.55, 0.68),
    "sand": (0.62, 0.52, 0.38),
}

SPECS = {}


def _spec(name, **kw):
    d = dict(kind="proc", tile=(2.0, 2.0), res=1024, normal=False, rough=0.8, metal=0.0, color=(0.5, 0.5, 0.5),
             recipe=None, params={}, tex=None, alpha=None, double=False, emit=None)
    d.update(kw)
    SPECS[name] = d


_spec("plaza_concrete", recipe=r_plaza_concrete, tile=(4.0, 4.0), normal=True, rough=0.8, color=(0.40, 0.38, 0.35))
_spec("pavers", recipe=r_pavers, tile=(3.2, 3.2), normal=True, rough=0.7, color=(0.3, 0.27, 0.25))
_spec("sidewalk", recipe=r_sidewalk, tile=(2.4, 2.4), normal=True, rough=0.85, color=(0.3, 0.3, 0.28))
_spec("asphalt", recipe=r_asphalt, tile=(6.0, 6.0), normal=True, rough=0.88, color=(0.06, 0.06, 0.06))
_spec("curb", recipe=r_curb, tile=(2.0, 2.0), normal=False, rough=0.7, color=(0.4, 0.39, 0.37))
_spec("concrete_ramp", recipe=r_concrete_ramp, tile=(4.0, 4.0), normal=True, rough=0.65, color=(0.33, 0.32, 0.31))
_spec("granite", recipe=r_granite, tile=(2.0, 2.0), rough=0.5, color=(0.44, 0.42, 0.41))
_spec("granite_dark", recipe=r_granite_dark, tile=(2.0, 2.0), rough=0.4, color=(0.08, 0.08, 0.085))
_spec("ledge_top", recipe=r_ledge_top, tile=(2.0, 1.0), color=(0.44, 0.42, 0.41))
_spec("ledge_top_plain", recipe=r_ledge_top_plain, tile=(2.0, 2.0), color=(0.44, 0.42, 0.41))
_spec("metal_cap", recipe=r_metal_cap, tile=(1.0, 1.0), res=512, metal=1.0, rough=0.35, color=(0.5, 0.5, 0.5))
_spec("coping", tex="metal_cap", tile=(1.0, 1.0), metal=1.0, rough=0.35, color=(0.5, 0.5, 0.5))
_spec("rail_paint", recipe=r_rail_paint, tile=(1.0, 1.0), res=512, rough=0.45, color=(0.03, 0.035, 0.05))
_spec("kicker_steel", recipe=r_kicker_steel, tile=(1.0, 1.0), res=512, normal=True, metal=1.0, color=(0.36, 0.37, 0.38))
_spec("wood", recipe=r_wood, tile=(2.0, 1.0), res=512, normal=True, rough=0.75, color=(0.2, 0.13, 0.08))
_spec("palm_bark", recipe=r_palm_bark, tile=(1.0, 1.0), res=512, normal=True, rough=0.9, color=(0.16, 0.13, 0.1))
_spec("bark", recipe=r_bark, tile=(1.0, 1.0), res=512, normal=True, rough=0.9, color=(0.09, 0.07, 0.055))
_spec("palm_leaf", recipe=r_palm_leaf, tile=(1.0, 1.0), res=512, rough=0.7, color=(0.06, 0.13, 0.03), double=True)
_spec("tree_leaf", recipe=r_tree_leaf, tile=(2.0, 2.0), res=512, rough=0.75, color=(0.06, 0.12, 0.03))
_spec("soil", recipe=r_soil, tile=(2.0, 2.0), res=512, rough=0.95, color=(0.05, 0.035, 0.022))
_spec("pool_tile", recipe=r_pool_tile, tile=(1.0, 1.0), res=512, rough=0.3, color=(0.04, 0.22, 0.3))
_spec("roof", recipe=r_roof, tile=(4.0, 4.0), res=512, rough=0.95, color=(0.18, 0.175, 0.17))
_spec("trim", recipe=r_trim, tile=(2.0, 2.0), res=512, rough=0.85, color=(0.55, 0.52, 0.47))
for tint, (wall, sh) in FACADE_A_TINTS.items():
    _spec(f"facade_a_{tint}", recipe=r_facade_a, params={"wall": wall, "shutter": sh}, tile=(7.2, 6.8), normal=True,
          color=wall)
for tint, wall in FACADE_B_TINTS.items():
    _spec(f"facade_b_{tint}", recipe=r_facade_b, params={"wall": wall}, tile=(7.2, 6.8), normal=True, color=wall)
_spec("facade_c_brick", recipe=r_facade_c, tile=(7.2, 6.8), normal=True, color=(0.3, 0.1, 0.06))
_spec("plaster_cream", recipe=r_plaster, params={"wall": (0.62, 0.55, 0.40)}, tile=(4.0, 4.0), res=512,
      color=(0.62, 0.55, 0.4))
_spec("shopfront", recipe=r_shopfront, tile=(4.0, 3.2), res=512, color=(0.05, 0.05, 0.05))
_spec("shopfront_dark", recipe=r_shopfront, params={"sign": (0.25, 0.02, 0.02), "frame": (0.08, 0.05, 0.03)},
      tile=(4.0, 3.2), res=512, color=(0.05, 0.05, 0.05))

for nm, col, rgh, mtl in [
    ("car_red", (0.42, 0.025, 0.02), 0.3, 0.0), ("car_blue", (0.03, 0.08, 0.28), 0.3, 0.0),
    ("car_cream", (0.62, 0.55, 0.40), 0.35, 0.0), ("car_teal", (0.02, 0.22, 0.22), 0.3, 0.0),
    ("car_black", (0.015, 0.015, 0.015), 0.25, 0.0), ("car_white", (0.68, 0.68, 0.66), 0.3, 0.0),
    ("car_yellow", (0.75, 0.42, 0.02), 0.3, 0.0), ("car_silver", (0.42, 0.42, 0.44), 0.3, 0.7),
    ("car_glass", (0.01, 0.012, 0.016), 0.05, 0.0), ("tire", (0.02, 0.02, 0.02), 0.9, 0.0),
    ("noggle_red", lin("#e8382c"), 0.32, 0.0), ("noggle_white", (0.85, 0.85, 0.85), 0.3, 0.0),
    ("noggle_black", (0.008, 0.008, 0.008), 0.2, 0.0),
    ("lamp_paint", (0.02, 0.045, 0.03), 0.45, 0.3), ("lamp_glass", (0.85, 0.82, 0.72), 0.25, 0.0),
    ("paint_white", (0.72, 0.72, 0.68), 0.75, 0.0), ("paint_yellow", (0.75, 0.45, 0.03), 0.75, 0.0),
    ("awning_red", (0.40, 0.035, 0.03), 0.9, 0.0), ("awning_green", (0.03, 0.18, 0.07), 0.9, 0.0),
    ("awning_blue", (0.03, 0.09, 0.32), 0.9, 0.0), ("awning_cream", (0.66, 0.58, 0.42), 0.9, 0.0),
    ("railing", (0.025, 0.025, 0.028), 0.5, 0.5),
    ("water", (0.01, 0.05, 0.06), 0.04, 0.0),
    ("invisible", (1.0, 0.0, 1.0), 1.0, 0.0), ("collision", (1.0, 0.0, 1.0), 1.0, 0.0),
]:
    _spec(nm, kind="const", color=col, rough=rgh, metal=mtl)

for i in range(4):
    _spec(f"poster_{i}", kind="decal", rough=0.8, color=(0.6, 0.6, 0.6), alpha="MASK")
for i in range(3):
    _spec(f"graffiti_{i}", kind="decal", rough=0.6, color=(0.6, 0.6, 0.6), alpha="MASK")
_spec("mural", kind="decal", rough=0.85, color=(0.6, 0.6, 0.6), alpha="MASK")


def tile_of(mat_name):
    s = SPECS.get(mat_name)
    if not s:
        return (2.0, 2.0)
    return s["tile"]


# --------------------------------------------------------------------------------------
# baking
# --------------------------------------------------------------------------------------
def _recipe_hash(spec):
    src = inspect.getsource(spec["recipe"])
    helpers = "".join(inspect.getsource(f) for f in (granite_color, wax, speckle, blotch, cracks, var, tone, _stucco,
                                                     _window_glass, _box, _local))
    import level_nodes
    h = hashlib.sha1((src + helpers + repr(sorted(spec["params"].items())) + repr(spec["tile"]) + repr(spec["res"])
                      + inspect.getsource(level_nodes)).encode()).hexdigest()[:12]
    return h


def _bake_plane(tile):
    me = bpy.data.meshes.new("bake_plane")
    tu, tv = tile
    me.from_pydata([(0, 0, 0), (tu, 0, 0), (tu, tv, 0), (0, tv, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for i, (u, v) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = (u, v)
    ob = bpy.data.objects.new("bake_plane", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def bake_textures(tex_dir, only=None, log=print):
    """Bake every 'proc' material to tex_dir/<name>.jpg (+ _n.jpg normal, _orm.jpg). Cached."""
    import numpy as np

    os.makedirs(tex_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    results = {}
    for name, spec in SPECS.items():
        if spec["kind"] != "proc" or spec["tex"]:
            continue
        if only and name not in only:
            continue
        h = _recipe_hash(spec)
        stamp = os.path.join(tex_dir, f".{name}.hash")
        files = {"color": os.path.join(tex_dir, f"{name}.jpg")}
        if spec["normal"]:
            files["normal"] = os.path.join(tex_dir, f"{name}_n.jpg")
        cached = os.path.exists(stamp) and open(stamp).read().strip() == h and all(os.path.exists(f) for f in files.values())
        orm_path = os.path.join(tex_dir, f"{name}_orm.jpg")
        if cached:
            if os.path.exists(orm_path):
                files["orm"] = orm_path
            results[name] = files
            continue
        log(f"  bake texture {name} ({spec['res']}px, tile {spec['tile']})")
        ob = _bake_plane(spec["tile"])
        mat = bpy.data.materials.new(f"__bake_{name}")
        g = G(mat, spec["tile"])
        outs = spec["recipe"](g, **spec["params"])
        out = g.N.new("ShaderNodeOutputMaterial")
        em = g.N.new("ShaderNodeEmission")
        g.Lk.new(em.outputs[0], out.inputs["Surface"])
        ob.data.materials.append(mat)
        res = spec["res"]
        img_node = g.N.new("ShaderNodeTexImage")
        g.N.active = img_node
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob

        def bake_emit(sock, colorspace="sRGB", is_value=False):
            img = bpy.data.images.new(f"__b_{name}", res, res, alpha=False, float_buffer=True)
            img.colorspace_settings.name = "Linear Rec.709"
            img_node.image = img
            if is_value:
                if isinstance(sock, (int, float)):
                    em.inputs["Color"].default_value = (sock, sock, sock, 1)
                else:
                    comb = g.N.new("ShaderNodeCombineXYZ")
                    for i in range(3):
                        g.Lk.new(sock, comb.inputs[i])
                    g.Lk.new(comb.outputs[0], em.inputs["Color"])
            else:
                g.Lk.new(sock, em.inputs["Color"])
            bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
            a = np.empty(res * res * 4, np.float32)
            img.pixels.foreach_get(a)
            bpy.data.images.remove(img)
            return a.reshape(res, res, 4)[..., :3]

        col = bake_emit(outs["color"])
        _save_rgb(col, files["color"], srgb=True)
        rough = outs.get("rough")
        metal = outs.get("metal")
        if rough is not None or (metal is not None and not isinstance(metal, (int, float))):
            r = bake_emit(rough if rough is not None else spec["rough"], is_value=True)[..., 0]
            if metal is not None and not isinstance(metal, (int, float)):
                m_ = bake_emit(metal, is_value=True)[..., 0]
            else:
                m_ = np.full_like(r, float(metal if metal is not None else spec["metal"]))
            orm = np.stack([np.ones_like(r), np.clip(r, 0, 1), np.clip(m_, 0, 1)], -1)
            _save_rgb(orm, orm_path, srgb=False)
            files["orm"] = orm_path
        elif os.path.exists(orm_path):
            os.remove(orm_path)
        if spec["normal"] and outs.get("height") is not None:
            for l_ in list(em.inputs["Color"].links):
                g.Lk.remove(l_)
            bsdf = g.N.new("ShaderNodeBsdfPrincipled")
            bump = g.N.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 1.0
            bump.inputs["Distance"].default_value = 1.0
            g.Lk.new(outs["height"], bump.inputs["Height"])
            g.Lk.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
            g.Lk.new(bsdf.outputs[0], out.inputs["Surface"])
            img = bpy.data.images.new(f"__n_{name}", res, res, alpha=False, float_buffer=True)
            img.colorspace_settings.name = "Non-Color"
            img_node.image = img
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=0, use_clear=True)
            a = np.empty(res * res * 4, np.float32)
            img.pixels.foreach_get(a)
            bpy.data.images.remove(img)
            _save_rgb(a.reshape(res, res, 4)[..., :3], files["normal"], srgb=False)
        bpy.data.objects.remove(ob)
        bpy.data.materials.remove(mat)
        open(stamp, "w").write(h)
        results[name] = files
    return results


def _save_rgb(arr, path, srgb=True, quality=88):
    import numpy as np
    h, w, _ = arr.shape
    a = np.clip(arr, 0, None)
    if srgb:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    a = np.clip(a, 0, 1)
    img = bpy.data.images.new("__save", w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"  # we already encoded; store bytes as-is
    rgba = np.concatenate([a, np.ones((h, w, 1), np.float32)], -1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    ext = os.path.splitext(path)[1].lower()
    img.file_format = "JPEG" if ext in (".jpg", ".jpeg") else ("WEBP" if ext == ".webp" else "PNG")
    scene = bpy.context.scene
    scene.render.image_settings.quality = quality
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


# --------------------------------------------------------------------------------------
# final (exportable) materials
# --------------------------------------------------------------------------------------
_IMG_CACHE = {}


def _load_img(path, colorspace):
    key = (path, colorspace)
    if key in _IMG_CACHE:
        return _IMG_CACHE[key]
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    _IMG_CACHE[key] = img
    return img


def build_material(name, tex_files, decal_files, suffix=""):
    """Create the glTF-exportable Principled material for ``name`` (optionally suffixed)."""
    spec = SPECS[name]
    mname = name + suffix
    mat = bpy.data.materials.get(mname) or bpy.data.materials.new(mname)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = tuple(spec["color"]) + (1.0,)
    bsdf.inputs["Roughness"].default_value = spec["rough"]
    bsdf.inputs["Metallic"].default_value = spec["metal"]
    mat.diffuse_color = tuple(spec["color"]) + (1.0,)
    mat.use_backface_culling = not spec["double"]
    files = None
    if spec["kind"] == "proc":
        files = tex_files.get(spec["tex"] or name)
    elif spec["kind"] == "decal":
        files = decal_files.get(name)
    if files:
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "UVMap"
        ti = nt.nodes.new("ShaderNodeTexImage")
        ti.image = _load_img(files["color"], "sRGB")
        nt.links.new(uvn.outputs[0], ti.inputs[0])
        nt.links.new(ti.outputs["Color"], bsdf.inputs["Base Color"])
        if spec["alpha"]:
            nt.links.new(ti.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "CLIP" if hasattr(mat, "blend_method") else None
            try:
                mat.surface_render_method = "DITHERED"
            except Exception:
                pass
        if files.get("orm"):
            to = nt.nodes.new("ShaderNodeTexImage")
            to.image = _load_img(files["orm"], "Non-Color")
            nt.links.new(uvn.outputs[0], to.inputs[0])
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(to.outputs["Color"], sep.inputs[0])
            nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
        if files.get("normal"):
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = _load_img(files["normal"], "Non-Color")
            nt.links.new(uvn.outputs[0], tn.inputs[0])
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.uv_map = "UVMap"
            nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    return mat
