"""Noggle Plaza -- level layout (all geometry, rails, spawns, landmarks).

Blender coords (Z-up, meters). +Y = north, +X = east. Plaza floor z=0, street z=-0.15.

Zones (plaza block is |x|,|y| <= 54):
  center      Noggles Fountain (octagonal basin, giant noggles sculpture)
  NW          Terrace (+0.96 m) with the "Big Six" 6-stair, center handrail, two hubbas, banks
  NE          Platform (+0.48 m) with 3-stair, center handrail, kinked rail, mini ramp, manual pad
  E           QP Bay: two 2 m quarter pipes facing each other across 24 m of flat
  SE          Pyramid funbox with ledge, two kickers
  SW          Ledge garden: ledges 0.30-0.60, manual pads, flat bar, angled ledge
  W           Planters (grindable) with trees, benches
  S           South bank (bank to deck)
  ring        sidewalk + curb + 12 m street + outer sidewalk, buildings at |c| = 76
"""
import math
import random
import numpy as np

from level_common import Level

TAU = math.tau

# ---- global dimensions
PLAZA = 54.0         # plaza block half-size
CURB_IN = 58.0       # inner curb line (sidewalk -> street)
CURB_OUT = 70.0      # outer curb line
FACADE = 76.0        # building facade line == playable bound
STREET_Z = -0.15

# stairs
RISER = 0.16
TREAD = 0.38
SLOPE = RISER / TREAD


# ======================================================================================
# helpers
# ======================================================================================
def _n(pts):
    p = np.array(pts, float)
    n = np.zeros(3)
    for i in range(len(p)):
        n += np.cross(p[i], p[(i + 1) % len(p)])
    return n


def facing(pts, want):
    """Return polygon with winding such that its normal points along ``want``."""
    if np.dot(_n(pts), np.array(want, float)) < 0:
        return list(reversed(pts))
    return list(pts)


def edge_cap(L, p0, p1, out, group="Obstacles", w=0.05, e=0.004, mat="metal_cap"):
    """Metal angle along a ledge top edge. p0,p1: edge (3D), out: outward horizontal unit (2D)."""
    p0 = np.array(p0, float)
    p1 = np.array(p1, float)
    o = np.array([out[0], out[1], 0.0])
    up = np.array([0, 0, 1.0])
    d = p1 - p0
    # vector across the top surface, pointing inward, lying in the top plane
    inward = -o
    # top surface may be sloped along the edge only, so inward stays horizontal
    top = [p0 + inward * w + up * e, p1 + inward * w + up * e, p1 + o * e + up * e, p0 + o * e + up * e]
    side = [p0 + o * e + up * e, p1 + o * e + up * e, p1 + o * e - up * w, p0 + o * e - up * w]
    L.polys(group, [facing([tuple(v) for v in top], up), facing([tuple(v) for v in side], o)], mat, col=False)
    # tiny end caps not needed (3 mm)
    _ = d


def ledge(L, cx, cy, length, width, h, ang=0.0, mat="granite", cap=True, name="ledge", z0=0.0,
          group="Obstacles", rails="both"):
    """Granite ledge with waxed top and metal-capped long edges (registered as rails)."""
    hx, hy = length / 2, width / 2
    uv_top = [(-hx / 2.0, 0.0), (hx / 2.0, 0.0), (hx / 2.0, 1.0), (-hx / 2.0, 1.0)]
    L.box(group, mat, (cx, cy, z0), (length, width, h), ang=ang, mat_top="ledge_top", uv_top=uv_top)
    c, s = math.cos(ang), math.sin(ang)

    def W(x, y, z):
        return (cx + c * x - s * y, cy + s * x + c * y, z)

    zt = z0 + h
    edges = []
    if rails in ("both", "south"):
        edges.append(((-hx, -hy), (hx, -hy), (s, -c)))       # local -y side
    if rails in ("both", "north"):
        edges.append(((-hx, hy), (hx, hy), (-s, c)))         # local +y side
    for (a, b, out) in edges:
        p0, p1 = W(a[0], a[1], zt), W(b[0], b[1], zt)
        if cap:
            edge_cap(L, p0, p1, out, group=group)
        L.rail("ledge", [p0, p1], name=name)


def octagon(apothem, cx=0.0, cy=0.0):
    r = apothem / math.cos(math.pi / 8)
    return [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), cy + r * math.sin(math.pi / 8 + k * math.pi / 4))
            for k in range(8)]


def qp_profile(R, H, deck, n=14):
    """Quarter-pipe transition (from flat, rising) + deck. Returns (curve_pts, deck_pts, lip_s)."""
    d = math.sqrt(R * R - (R - H) ** 2)
    pts = []
    th_max = math.asin(d / R)
    for i in range(n + 1):
        th = th_max * i / n
        s = R * math.sin(th)
        z = R - R * math.cos(th)
        pts.append((s, z))
    pts[-1] = (d, H)
    deck_pts = [(d, H), (d + deck, H)]
    return pts, deck_pts, d


def quarter_pipe(L, origin, ang, width, R, H, deck, name, mat="concrete_ramp", z0=0.0, coping=True):
    curve, deck_pts, lip = qp_profile(R, H, deck)
    L.profile_extrude("Obstacles", [(curve, mat, True), (deck_pts, mat, False)], width,
                      (origin[0], origin[1], z0), ang, mat)
    c, s = math.cos(ang), math.sin(ang)
    hw = width / 2

    def W(x, y, z):
        return (origin[0] + c * x - s * y, origin[1] + s * x + c * y, z)

    if coping:
        r = 0.032
        a = W(lip - 0.012, -hw, z0 + H - 0.006)
        b = W(lip - 0.012, hw, z0 + H - 0.006)
        L.cylinder("Obstacles", a, b, r, "coping", seg=10, caps=True, col="COL_Rails")
        L.rail("coping", [W(lip, -hw, z0 + H), W(lip, hw, z0 + H)], name=name)


def stairs(L, x0, x1, y_top, n_risers, direction=-1, z_base=0.0, mat="granite"):
    """Stair set descending from a landing edge at y_top (height n*RISER) toward y_top + direction*..."""
    for k in range(1, n_risers):
        # tread k (height k*RISER) spans [y_top - (n-k)*TREAD, y_top - (n-k-1)*TREAD] for direction=-1
        a = y_top + direction * (n_risers - k) * TREAD
        b = y_top + direction * (n_risers - k - 1) * TREAD
        y0, y1 = min(a, b), max(a, b)
        L.boxmm("Obstacles", mat, (x0, y0, z_base), (x1, y1, z_base + k * RISER), sides="sewn")
    # nosing line ground intersection
    return y_top + direction * n_risers * TREAD


def handrail(L, pts, name="rail", posts=(), post_bottoms=None, r=0.024, rtype="rail"):
    L.tube("Obstacles", pts, r, "rail_paint", seg=8, col="COL_Rails")
    for i, p in enumerate(posts):
        zb = post_bottoms[i] if post_bottoms else 0.0
        L.cylinder("Obstacles", (p[0], p[1], zb), p, 0.022, "rail_paint", seg=8, col="COL_Rails")
    return L.rail(rtype, pts, name=name)


def bench(L, cx, cy, ang, length=2.6, name="bench", group="Obstacles"):
    """Granite block bench with a wooden seat slab (grindable both edges)."""
    L.box(group, "granite_dark", (cx, cy, 0.0), (length, 0.62, 0.42), ang=ang)
    # wooden slab (slightly inset); slats are in the wood texture
    L.box(group, "wood", (cx, cy, 0.42), (length - 0.08, 0.58, 0.05), ang=ang)
    c, s = math.cos(ang), math.sin(ang)
    hx, hy = (length - 0.08) / 2, 0.29
    for sy in (-1, 1):
        p0 = (cx + c * -hx - s * sy * hy, cy + s * -hx + c * sy * hy, 0.47)
        p1 = (cx + c * hx - s * sy * hy, cy + s * hx + c * sy * hy, 0.47)
        L.rail("ledge", [p0, p1], name=name)


def planter(L, cx, cy, sx, sy, h=0.5, tree=None, name="planter", z0=0.0, group="Obstacles"):
    """Concrete planter box (grindable rim) with soil and an optional tree."""
    t = 0.25
    x0, x1, y0, y1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2
    L.boxmm(group, "granite", (x0, y0, z0), (x1, y0 + t, z0 + h), mat_top="ledge_top_plain")
    L.boxmm(group, "granite", (x0, y1 - t, z0), (x1, y1, z0 + h), mat_top="ledge_top_plain")
    L.boxmm(group, "granite", (x0, y0 + t, z0), (x0 + t, y1 - t, z0 + h), mat_top="ledge_top_plain")
    L.boxmm(group, "granite", (x1 - t, y0 + t, z0), (x1, y1 - t, z0 + h), mat_top="ledge_top_plain")
    L.boxmm(group, "soil", (x0 + t, y0 + t, z0), (x1 - t, y1 - t, z0 + h - 0.08), sides="")
    ring = [(x0, y0, z0 + h), (x1, y0, z0 + h), (x1, y1, z0 + h), (x0, y1, z0 + h), (x0, y0, z0 + h)]
    L.rail("ledge", ring, name=name)
    if tree:
        tree(L, cx, cy, z0 + h - 0.08)


# ======================================================================================
# vegetation & props
# ======================================================================================
def palm(L, x, y, z0=0.0, height=9.0, seed=0):
    rng = random.Random(seed)
    lean = rng.uniform(0, TAU)
    lean_amt = rng.uniform(0.3, 0.9)
    n = 6
    pts = []
    for i in range(n + 1):
        t = i / n
        off = lean_amt * t * t
        pts.append((x + math.cos(lean) * off, y + math.sin(lean) * off, z0 + height * t))
    for i in range(n):
        r0 = 0.24 - 0.09 * (i / n)
        r1 = 0.24 - 0.09 * ((i + 1) / n)
        L.cylinder("Props", pts[i], pts[i + 1], r0, "palm_bark", seg=7, caps=(i == n - 1), r1=r1,
                   col=(True if i < 2 else False))
    top = np.array(pts[-1])
    # crown bulb
    L.cylinder("Foliage", tuple(top - [0, 0, 0.3]), tuple(top + [0, 0, 0.35]), 0.3, "palm_bark", seg=7, r1=0.12, col=False)
    # fronds: arched, slightly folded strips
    nf = 11
    for k in range(nf):
        a = TAU * k / nf + rng.uniform(-0.15, 0.15)
        length = rng.uniform(3.2, 4.2)
        rise = rng.uniform(0.4, 1.0)
        droop = rng.uniform(1.6, 2.6)
        d = np.array([math.cos(a), math.sin(a), 0.0])
        side = np.array([-math.sin(a), math.cos(a), 0.0])
        seg = 6
        verts, faces = [], []
        for i in range(seg + 1):
            t = i / seg
            w = 0.55 * math.sin(math.pi * min(1.0, t * 1.15)) + 0.05
            c = top + d * (length * t) + np.array([0, 0, rise * 4 * t * (1 - t) - droop * t * t])
            fold = np.array([0, 0, 0.18 * w])
            verts += [tuple(c - side * w - fold * 0.0), tuple(c + fold), tuple(c + side * w)]
        for i in range(seg):
            b = 3 * i
            faces.append([b, b + 3, b + 4, b + 1])
            faces.append([b + 1, b + 4, b + 5, b + 2])
        L.emit("Foliage", verts, faces, "palm_leaf", smooth=True, col=False)


def broadleaf(L, x, y, z0=0.0, seed=0, scale=1.0):
    rng = random.Random(seed)
    h = 2.6 * scale
    L.cylinder("Props", (x, y, z0), (x, y, z0 + h), 0.16 * scale, "bark", seg=7, r1=0.11 * scale)
    # a few branches
    for k in range(3):
        a = TAU * k / 3 + rng.uniform(-0.3, 0.3)
        L.cylinder("Props", (x, y, z0 + h * 0.8),
                   (x + math.cos(a) * 1.0 * scale, y + math.sin(a) * 1.0 * scale, z0 + h + 0.9 * scale),
                   0.07 * scale, "bark", seg=5, col=False, r1=0.04 * scale)
    # canopy = a few low-poly blobs
    for k in range(5):
        a = TAU * k / 5 + rng.uniform(-0.4, 0.4)
        rr = rng.uniform(0.6, 1.3) * scale
        cx = x + math.cos(a) * rr
        cy = y + math.sin(a) * rr
        cz = z0 + h + rng.uniform(0.9, 2.0) * scale
        blob(L, (cx, cy, cz), rng.uniform(1.2, 1.8) * scale, seed=seed * 7 + k)
    blob(L, (x, y, z0 + h + 2.2 * scale), 1.9 * scale, seed=seed * 13 + 99)


def blob(L, c, r, seed=0, mat="tree_leaf", group="Foliage"):
    """Low-poly icosphere-ish blob, randomly displaced (flat shaded)."""
    rng = random.Random(seed)
    t = (1 + 5 ** 0.5) / 2
    V = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
         (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7),
         (9, 8, 1)]
    # one subdivision
    V = [np.array(v, float) / np.linalg.norm(v) for v in V]
    cache = {}

    def mid(a, b):
        k = (min(a, b), max(a, b))
        if k not in cache:
            m = V[a] + V[b]
            V.append(m / np.linalg.norm(m))
            cache[k] = len(V) - 1
        return cache[k]

    F2 = []
    for a, b, cc in F:
        ab, bc, ca = mid(a, b), mid(b, cc), mid(cc, a)
        F2 += [(a, ab, ca), (b, bc, ab), (cc, ca, bc), (ab, bc, ca)]
    verts = []
    for v in V:
        k = r * rng.uniform(0.82, 1.12)
        verts.append((c[0] + v[0] * k, c[1] + v[1] * k, c[2] + v[2] * k * 0.8))
    L.emit(group, verts, [list(f) for f in F2], mat, smooth=False, col=False)


def tree_pit(L, x, y, seed=0, size=2.2):
    """Flush tree pit: soil square with a granite frame and a broadleaf tree."""
    h = size / 2
    L.polys("Ground", [[(x - h, y - h, 0.005), (x + h, y - h, 0.005), (x + h, y + h, 0.005), (x - h, y + h, 0.005)]],
            "soil", col=False)
    fr = 0.12
    for (x0, y0, x1, y1) in ((x - h - fr, y - h - fr, x + h + fr, y - h), (x - h - fr, y + h, x + h + fr, y + h + fr),
                             (x - h - fr, y - h, x - h, y + h), (x + h, y - h, x + h + fr, y + h)):
        L.polys("Ground", [[(x0, y0, 0.006), (x1, y0, 0.006), (x1, y1, 0.006), (x0, y1, 0.006)]], "granite_dark",
                col=False)
    broadleaf(L, x, y, 0.0, seed=seed, scale=1.35)


def street_lamp(L, x, y, ang, seed=0):
    """Barcelona-ish dark green lamp post; arm points along ang (toward street)."""
    h = 6.5
    L.cylinder("Props", (x, y, 0), (x, y, 0.6), 0.14, "lamp_paint", seg=8, r1=0.11)
    L.cylinder("Props", (x, y, 0.6), (x, y, h), 0.075, "lamp_paint", seg=8, r1=0.06)
    ax, ay = math.cos(ang), math.sin(ang)
    end = (x + ax * 1.6, y + ay * 1.6, h + 0.25)
    L.cylinder("Props", (x, y, h - 0.15), end, 0.04, "lamp_paint", seg=6, col=False)
    # head (render only)
    L.box("Props", "lamp_paint", (end[0], end[1], end[2] - 0.22), (0.7, 0.36, 0.2), ang=ang, col=False)
    L.box("Props", "lamp_glass", (end[0], end[1], end[2] - 0.3), (0.6, 0.3, 0.08), ang=ang, col=False, top=False,
          bottom=True)


def plaza_lamp(L, x, y):
    """Tall plaza mast with 3 heads."""
    h = 8.0
    L.cylinder("Props", (x, y, 0), (x, y, 0.8), 0.2, "lamp_paint", seg=8, r1=0.15)
    L.cylinder("Props", (x, y, 0.8), (x, y, h), 0.1, "lamp_paint", seg=8, r1=0.07)
    for k in range(3):
        a = TAU * k / 3 + 0.4
        e = (x + math.cos(a) * 0.7, y + math.sin(a) * 0.7, h - 0.2)
        L.cylinder("Props", (x, y, h - 0.4), e, 0.035, "lamp_paint", seg=6, col=False)
        L.cylinder("Props", (e[0], e[1], e[2] - 0.35), (e[0], e[1], e[2] + 0.05), 0.22, "lamp_paint", seg=8,
                   r1=0.12, col=False)
        L.cylinder("Props", (e[0], e[1], e[2] - 0.37), (e[0], e[1], e[2] - 0.34), 0.2, "lamp_glass", seg=8, col=False)


def bin_(L, x, y):
    L.cylinder("Props", (x, y, 0), (x, y, 0.9), 0.27, "lamp_paint", seg=10)
    L.cylinder("Props", (x, y, 0.9), (x, y, 0.95), 0.29, "metal_cap", seg=10, col=False)


def car(L, x, y, ang, color, seed=0):
    rng = random.Random(seed)
    lng = rng.uniform(4.1, 4.7)
    wid = 1.8
    zb = STREET_Z
    paint = f"car_{color}"
    # body (profile along local x)
    body = [(-lng / 2, 0.30), (-lng / 2, 0.85), (-lng / 2 + 0.25, 0.98), (lng / 2 - 0.2, 0.98), (lng / 2, 0.82),
            (lng / 2, 0.30)]
    _car_profile(L, x, y, zb, ang, body, wid, paint)
    # cabin: trapezoid with glass sides
    cl = lng * rng.uniform(0.48, 0.56)
    off = rng.uniform(-0.35, -0.1)
    cab = [(off - cl / 2, 0.98), (off - cl / 2 + 0.45, 1.45), (off + cl / 2 - 0.35, 1.45), (off + cl / 2, 0.98)]
    _car_profile(L, x, y, zb, ang, cab, wid - 0.16, "car_glass", roof_mat=paint)
    c, s = math.cos(ang), math.sin(ang)
    for wx in (-lng / 2 + 0.75, lng / 2 - 0.8):
        for wy in (-wid / 2 + 0.12, wid / 2 - 0.12):
            px, py = x + c * wx - s * wy, y + s * wx + c * wy
            sy = 1 if wy > 0 else -1
            a = (px - s * sy * 0.11, py + c * sy * 0.11, zb + 0.32)
            b = (px + s * sy * 0.02, py - c * sy * 0.02, zb + 0.32)
            L.cylinder("Props", b, a, 0.32, "tire", seg=10, col=False)
    # collision proxy: simple box
    L.box("Props", "car_glass", (x, y, zb), (lng, wid, 1.45), ang=ang, col="only")


def _car_profile(L, x, y, zb, ang, prof, wid, mat_side, roof_mat=None):
    # extrude polygon prof (local x,z) across local y
    hw = wid / 2
    n = len(prof)
    polys, mats = [], []
    left = [(px, -hw, pz) for px, pz in prof]
    right = [(px, hw, pz) for px, pz in prof]
    polys.append(facing(left, (0, -1, 0)))
    mats.append(mat_side)
    polys.append(facing(right, (0, 1, 0)))
    mats.append(mat_side)
    for i in range(n - 1):
        q = [left[i], left[i + 1], right[i + 1], right[i]]
        nrm = np.cross(np.array(left[i + 1]) - np.array(left[i]), [0, 1, 0])
        # outward = away from centroid
        cx = sum(p[0] for p in prof) / n
        cz = sum(p[1] for p in prof) / n
        mid = ((left[i][0] + left[i + 1][0]) / 2 - cx, 0, (left[i][2] + left[i + 1][2]) / 2 - cz)
        polys.append(facing(q, mid))
        horiz = abs(prof[i][1] - prof[i + 1][1]) < 1e-3
        mats.append(roof_mat if (roof_mat and horiz) else (mat_side if roof_mat else mat_side))
        _ = nrm
    # bottom/close
    q = [left[-1], left[0], right[0], right[-1]]
    polys.append(facing(q, (0, 0, -1)) if prof[0][1] < 0.5 else facing(q, (0, 0, -1)))
    mats.append(mat_side)
    out = []
    for p in polys:
        out.append([(x + math.cos(ang) * v[0] - math.sin(ang) * v[1],
                     y + math.sin(ang) * v[0] + math.cos(ang) * v[1], zb + v[2]) for v in p])
    L.polys("Props", out, mats, col=False)


# ======================================================================================
# zones
# ======================================================================================
def build_ground(L):
    # --- plaza floor: 2 m grid cells, skipping raised terrace/platform footprints
    holes = [(-52, 22, -12, 52), (12, 22, 52, 52)]
    cells = []
    mats = []
    step = 2.0
    n = int(2 * PLAZA / step)
    for i in range(n):
        for j in range(n):
            x0 = -PLAZA + i * step
            y0 = -PLAZA + j * step
            x1, y1 = x0 + step, y0 + step
            if any(x0 >= h[0] and x1 <= h[2] and y0 >= h[1] and y1 <= h[3] for h in holes):
                continue
            cells.append([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)])
            cxx, cyy = (x0 + x1) / 2, (y0 + y1) / 2
            band = any(abs(c - b) < 1.01 for c in (cxx, cyy) for b in (-37.0, -19.0, 19.0, 37.0))
            mats.append("pavers" if (max(abs(cxx), abs(cyy)) < 14 or band) else "plaza_concrete")
    L.polys("Ground", cells, mats)

    # --- inner sidewalk ring (z=0) up to the inner curb
    def ring(r0, r1, z, mat, group="Ground"):
        rects = [(-r1, -r1, r1, -r0), (-r1, r0, r1, r1), (-r1, -r0, -r0, r0), (r0, -r0, r1, r0)]
        polys = []
        for (x0, y0, x1, y1) in rects:
            polys.append([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)])
        L.polys(group, polys, mat)

    ring(PLAZA, CURB_IN - 0.3, 0.0, "sidewalk")
    ring(CURB_IN - 0.3, CURB_IN, 0.0, "curb")
    ring(CURB_IN, CURB_OUT, STREET_Z, "asphalt")
    ring(CURB_OUT, CURB_OUT + 0.3, 0.0, "curb")
    ring(CURB_OUT + 0.3, FACADE, 0.0, "sidewalk")

    # curb faces
    def curb_faces(r, outward):
        polys = []
        z0, z1 = STREET_Z, 0.0
        sq = [(-r, -r), (r, -r), (r, r), (-r, r)]
        for k in range(4):
            a, b = sq[k], sq[(k + 1) % 4]
            q = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)
            want = (mid[0] * outward, mid[1] * outward, 0)
            polys.append(facing(q, want))
        L.polys("Ground", polys, "curb")

    curb_faces(CURB_IN, +1)
    curb_faces(CURB_OUT, -1)
    for r in (CURB_IN, CURB_OUT):
        sq = [(-r, -r, 0.0), (r, -r, 0.0), (r, r, 0.0), (-r, r, 0.0), (-r, -r, 0.0)]
        L.rail("curb", sq, name="curb_inner" if r == CURB_IN else "curb_outer")

    # --- road markings (decals, render only)
    zd = STREET_Z + 0.006
    mid = (CURB_IN + CURB_OUT) / 2
    lines = []
    for off in (-0.09, 0.09):
        r = mid + off
        w = 0.06
        lines += _square_ring_strips(r - w, r + w, zd)
    L.polys("Decals", lines, "paint_yellow", col=False)
    # parking lane lines (white, dashed)
    dashes = []
    for r in (CURB_IN + 2.3, CURB_OUT - 2.3):
        for k in range(-30, 31):
            t0 = k * 4.0
            for side in range(4):
                dashes.append(_dash(side, r, t0, t0 + 2.0, 0.06, zd))
    L.polys("Decals", [d for d in dashes if d], "paint_white", col=False)
    # zebra crossings at the middle of each side
    zebra = []
    for side in range(4):
        for k in range(12):
            r0 = CURB_IN + 0.5 + k * 0.95
            r1 = r0 + 0.5
            for t0, t1 in ((-2.2, 2.2),):
                zebra.append(_zebra_bar(side, r0, r1, t0, t1, zd))
    L.polys("Decals", zebra, "paint_white", col=False)


def _square_ring_strips(r0, r1, z):
    rects = [(-r1, -r1, r1, -r0), (-r1, r0, r1, r1), (-r1, -r0, -r0, r0), (r0, -r0, r1, r0)]
    return [[(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)] for (x0, y0, x1, y1) in rects]


def _dash(side, r, t0, t1, w, z):
    lim = r - 1.0
    if t1 < -lim or t0 > lim:
        return None
    t0, t1 = max(t0, -lim), min(t1, lim)
    if abs((t0 + t1) / 2) < 3.5:  # keep zebra area clear
        return None
    if side == 0:
        q = [(t0, -r - w, z), (t1, -r - w, z), (t1, -r + w, z), (t0, -r + w, z)]
    elif side == 1:
        q = [(t0, r - w, z), (t1, r - w, z), (t1, r + w, z), (t0, r + w, z)]
    elif side == 2:
        q = [(-r - w, t0, z), (-r + w, t0, z), (-r + w, t1, z), (-r - w, t1, z)]
    else:
        q = [(r - w, t0, z), (r + w, t0, z), (r + w, t1, z), (r - w, t1, z)]
    return facing(q, (0, 0, 1))


def _zebra_bar(side, r0, r1, t0, t1, z):
    if side == 0:
        q = [(t0, -r1, z), (t1, -r1, z), (t1, -r0, z), (t0, -r0, z)]
    elif side == 1:
        q = [(t0, r0, z), (t1, r0, z), (t1, r1, z), (t0, r1, z)]
    elif side == 2:
        q = [(-r1, t0, z), (-r0, t0, z), (-r0, t1, z), (-r1, t1, z)]
    else:
        q = [(r0, t0, z), (r1, t0, z), (r1, t1, z), (r0, t1, z)]
    return facing(q, (0, 0, 1))


NOGGLES = [
    "...RRRRRR.RRRRRR",
    "...RWWBBR.RWWBBR",
    "RRRRWWBBRRRWWBBR",
    "R..RWWBBR.RWWBBR",
    "R..RWWBBR.RWWBBR",
    "...RRRRRR.RRRRRR",
]


def noggles_sculpture(L, cx, cy, z0, px=0.46, depth=0.46):
    """Voxel ⌐◨-◨ (16x6 px) standing upright, facing -y (south)."""
    rows = NOGGLES
    H = len(rows)
    W = len(rows[0])
    matmap = {"R": "noggle_red", "W": "noggle_white", "B": "noggle_black"}

    def filled(i, j):
        return 0 <= j < H and 0 <= i < W and rows[j][i] != "."

    x_off = cx - W * px / 2
    polys, mats = [], []
    for j in range(H):
        for i in range(W):
            ch = rows[j][i]
            if ch == ".":
                continue
            x0 = x_off + i * px
            x1 = x0 + px
            z1 = z0 + (H - j) * px
            zz0 = z1 - px
            y0, y1 = cy - depth / 2, cy + depth / 2
            m = matmap[ch]
            # front (-y) and back (+y): lens colours on both faces
            polys.append(facing([(x0, y0, zz0), (x1, y0, zz0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)))
            mats.append(m)
            polys.append(facing([(x0, y1, zz0), (x1, y1, zz0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)))
            mats.append(m)
            side_m = "noggle_red" if ch == "R" else m
            if not filled(i - 1, j):
                polys.append(facing([(x0, y0, zz0), (x0, y1, zz0), (x0, y1, z1), (x0, y0, z1)], (-1, 0, 0)))
                mats.append(side_m)
            if not filled(i + 1, j):
                polys.append(facing([(x1, y0, zz0), (x1, y1, zz0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)))
                mats.append(side_m)
            if not filled(i, j - 1):
                polys.append(facing([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)))
                mats.append(side_m)
            if not filled(i, j + 1):
                polys.append(facing([(x0, y0, zz0), (x1, y0, zz0), (x1, y1, zz0), (x0, y1, zz0)], (0, 0, -1)))
                mats.append(side_m)
    # NOTE: lenses W/B are flat painted faces; within-lens faces between W and B pixels are never exposed.
    L.polys("Props", polys, mats, col=True)
    return z0 + H * px


def build_fountain(L):
    ao, ai = 7.4, 6.8
    h = 0.45
    O = octagon(ao)
    I = octagon(ai)
    polys, mats, uvs = [], [], []
    # rim tops (waxed ledge texture: v across width)
    for k in range(8):
        a, b = O[k], O[(k + 1) % 8]
        c, d = I[(k + 1) % 8], I[k]
        q = [(a[0], a[1], h), (b[0], b[1], h), (c[0], c[1], h), (d[0], d[1], h)]
        seg_len = math.dist(a, b)
        polys.append(q)
        mats.append("ledge_top")
        uvs.append([(0, 0), (seg_len / 2.0, 0), (seg_len / 2.0 * ai / ao, 1), (0, 1)])
        # outer wall
        polys.append(facing([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], h), (a[0], a[1], h)],
                            ((a[0] + b[0]), (a[1] + b[1]), 0)))
        mats.append("granite_dark")
        uvs.append(None)
        # inner wall
        polys.append(facing([(d[0], d[1], 0), (c[0], c[1], 0), (c[0], c[1], h), (d[0], d[1], h)],
                            (-(c[0] + d[0]), -(c[1] + d[1]), 0)))
        mats.append("pool_tile")
        uvs.append(None)
    L.emit("Obstacles", *_flat(polys), mats, uvs=uvs)
    # caps on the outer edge
    for k in range(8):
        a, b = O[k], O[(k + 1) % 8]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        ln = math.hypot(mx, my)
        edge_cap(L, (a[0], a[1], h), (b[0], b[1], h), (mx / ln, my / ln))
    L.rail("ledge", [(p[0], p[1], h) for p in O + [O[0]]], name="fountain_outer")
    L.rail("ledge", [(p[0], p[1], h) for p in I + [I[0]]], name="fountain_inner")
    # pool floor
    L.polys("Obstacles", [[(p[0], p[1], 0.02) for p in I]], "pool_tile")
    # water (render only)
    L.polys("Water", [[(p[0], p[1], 0.30) for p in I]], "water", col=False)
    # plinth
    P = octagon(1.5)
    L.prism("Obstacles", P, 0.0, 1.7, "granite_dark", mat_top="granite")
    top = noggles_sculpture(L, 0.0, 0.0, 1.7, px=0.6, depth=0.6)
    L.landmark("Noggles Fountain", (0, 0, 0), "landmark")
    return top


def _flat(polys):
    verts, faces = [], []
    for p in polys:
        b = len(verts)
        verts.extend(p)
        faces.append(list(range(b, b + len(p))))
    return verts, faces


def build_terrace(L):
    """NW terrace (+0.96): Big Six, handrail, hubbas, banks, long ledge, planters."""
    H = 6 * RISER  # 0.96
    x0, x1, y0, y1 = -52.0, -12.0, 22.0, 52.0
    L.boxmm("Obstacles", "granite", (x0, y0, 0), (x1, y1, H), mat_top="pavers")
    # metal-capped drop edges (south wall split around the stairs and SW bank)
    for a, b in ((-42.0, -36.6), (-27.4, -12.0)):
        edge_cap(L, (a, y0, H), (b, y0, H), (0, -1))
        L.rail("ledge", [(a, y0, H), (b, y0, H)], name="terrace_edge")
    for a, b in ((22.0, 28.0), (46.0, 52.0)):
        edge_cap(L, (x1, a, H), (x1, b, H), (1, 0))
        L.rail("ledge", [(x1, a, H), (x1, b, H)], name="terrace_edge")
    # --- Big Six
    sx0, sx1 = -36.0, -28.0
    y_ground = stairs(L, sx0, sx1, y0, 6)          # nosing line hits ground here
    # center handrail
    def zr(y, above):
        return above + SLOPE * (y - y_ground)
    rp = [(-32.0, 22.5, zr(22.5, 0.82)), (-32.0, 19.55, zr(19.55, 0.82))]
    handrail(L, rp, name="bigsix_handrail",
             posts=[(-32.0, 22.3, zr(22.3, 0.82)), (-32.0, 19.8, zr(19.8, 0.82))], post_bottoms=[H, 0.0])
    # hubbas (east 0.45 above nosing, west 0.30)
    for (xc, above, nm) in ((-27.7, 0.45, "bigsix_hubba"), (-36.3, 0.30, "bigsix_lowhubba")):
        ztop0 = above
        ztop1 = above + H
        prof = [((y_ground - 0.0, ztop0), (y0, ztop1)), ((y0, ztop1), (y0 + 1.4, ztop1))]
        pieces = [(list(prof[0]), "granite", False), (list(prof[1]), "granite", False)]
        L.profile_extrude("Obstacles", pieces, 0.6, (xc, 0, 0), math.pi / 2, "granite")
        out = 1 if xc > -32 else -1
        for side in (-1, 1):
            xe = xc + side * 0.3
            pts = [(xe, y_ground, ztop0), (xe, y0, ztop1), (xe, y0 + 1.4, ztop1)]
            edge_cap(L, pts[0], pts[1], (side, 0))
            edge_cap(L, pts[1], pts[2], (side, 0))
            L.rail("ledge", pts, name=nm)
        _ = out
    # banks up onto the terrace
    L.profile_extrude("Obstacles", [([(0, H), (3.2, 0)], "concrete_ramp", False)], 18.0, (x1, 37.0, 0), 0.0,
                      "granite")
    L.profile_extrude("Obstacles", [([(0, H), (3.2, 0)], "concrete_ramp", False)], 8.0, (-46.0, y0, 0),
                      -math.pi / 2, "granite")
    # terrace furniture
    ledge(L, -35.0, 40.0, 22.0, 0.5, 0.45, z0=H, name="terrace_long_ledge")
    ledge(L, -39.0, 30.5, 10.0, 0.55, 0.30, z0=H, name="terrace_low_ledge")
    for i, xx in enumerate((-46.0, -34.0, -22.0)):
        planter(L, xx, 48.5, 4.0, 2.4, h=0.5, z0=H, tree=lambda L_, x, y, z, s=i: broadleaf(L_, x, y, z, seed=40 + s),
                name="terrace_planter")
    bench(L, -20.0, 31.0, math.pi / 2)
    L.landmark("Big Six", (-32.0, 20.5, 0.0), "spot")
    L.landmark("Terrace", (-35.0, 36.0, H), "area")
    L.spawn("Big Six Top", (-32.0, 30.0, H), (0, -1))


def build_platform(L):
    """NE platform (+0.48): 3-stair, center handrail, kinked rail, mini ramp, manual pad, ledge."""
    H = 3 * RISER
    x0, x1, y0, y1 = 12.0, 52.0, 22.0, 52.0
    L.boxmm("Obstacles", "granite", (x0, y0, 0), (x1, y1, H), mat_top="plaza_concrete")
    caps = [((x0, y0), (24.0, y0), (0, -1)), ((32.0, y0), (40.0, y0), (0, -1)),
            ((x0, y0), (x0, 30.0), (-1, 0)), ((x0, 46.0), (x0, y1), (-1, 0)),
            ((x1, y0), (x1, y1), (1, 0)), ((x0, y1), (x1, y1), (0, 1))]
    for a, b, o in caps:
        edge_cap(L, (a[0], a[1], H), (b[0], b[1], H), o)
        L.rail("ledge", [(a[0], a[1], H), (b[0], b[1], H)], name="platform_edge")
    y_ground = stairs(L, 24.0, 32.0, y0, 3)
    zr = lambda y, above: above + SLOPE * (y - y_ground)
    handrail(L, [(28.0, 22.7, zr(22.7, 0.8)), (28.0, 20.4, zr(20.4, 0.8))], name="three_handrail",
             posts=[(28.0, 22.5, zr(22.5, 0.8)), (28.0, 20.6, zr(20.6, 0.8))], post_bottoms=[H, 0.0])
    # kinked rail (flat - down - flat) on the west side of the stairs
    kx = 23.3
    k_top = H + 0.72
    ya = y0 + 0.1
    yb = y_ground + 0.05
    pts = [(kx, 25.5, k_top), (kx, ya, k_top), (kx, yb, 0.72 + SLOPE * (yb - y_ground) * 0), (kx, 17.5, 0.72)]
    # make the down section follow the nosing slope exactly
    pts[2] = (kx, yb, k_top - SLOPE * (ya - yb))
    pts[3] = (kx, 17.5, pts[2][2])
    handrail(L, pts, name="kinked_rail", rtype="rail",
             posts=[(kx, 25.2, k_top), (kx, 22.4, k_top), (kx, pts[2][1] - 0.2, pts[2][2]), (kx, 17.8, pts[3][2])],
             post_bottoms=[H, H, 0.0, 0.0])
    # banks
    L.profile_extrude("Obstacles", [([(0, 0), (3.0, H)], "concrete_ramp", False)], 16.0, (9.0, 38.0, 0), 0.0,
                      "granite", back=False)
    L.profile_extrude("Obstacles", [([(0, H), (2.2, 0)], "concrete_ramp", False)], 10.0, (45.0, y0, 0),
                      -math.pi / 2, "granite")
    # mini ramp (two facing transitions on the platform)
    R, Hm, deck = 1.6, 1.2, 1.3
    d = math.sqrt(R * R - (R - Hm) ** 2)
    flat = 2.8
    cx, cy, w = 42.0, 42.0, 7.0
    quarter_pipe(L, (cx + flat / 2, cy), 0.0, w, R, Hm, deck, "miniramp_coping", z0=H)
    quarter_pipe(L, (cx - flat / 2, cy), math.pi, w, R, Hm, deck, "miniramp_coping", z0=H)
    # manual pad + ledge on the platform
    manual_pad(L, 22.0, 44.0, 6.0, 2.4, 0.2, z0=H, name="platform_manual")
    ledge(L, 23.0, 31.0, 14.0, 0.5, 0.40, z0=H, name="platform_ledge")
    L.landmark("Three Stair & Kink", (28.0, 20.5, 0.0), "spot")
    L.landmark("Mini Ramp", (cx, cy, H), "spot")
    L.spawn("Mini Ramp Deck", (cx + flat / 2 + d + 0.6, cy, H + Hm), (-1, 0))
    _ = x1 + d


def manual_pad(L, cx, cy, sx, sy, h, z0=0.0, name="manual", ang=0.0):
    L.box("Obstacles", "granite", (cx, cy, z0), (sx, sy, h), ang=ang, mat_top="ledge_top_plain")
    c, s = math.cos(ang), math.sin(ang)
    hx, hy = sx / 2, sy / 2
    for sy_ in (-1, 1):
        p0 = (cx + c * -hx - s * sy_ * hy, cy + s * -hx + c * sy_ * hy, z0 + h)
        p1 = (cx + c * hx - s * sy_ * hy, cy + s * hx + c * sy_ * hy, z0 + h)
        edge_cap(L, p0, p1, (-s * sy_, c * sy_))
        L.rail("ledge", [p0, p1], name=name)


QP_R, QP_H, QP_DECK = 2.4, 2.0, 1.6
QP_D = math.sqrt(QP_R ** 2 - (QP_R - QP_H) ** 2)
QP_E_X, QP_W_X = 50.0, 26.0
QP_E_BACK = QP_E_X + QP_D + QP_DECK
QP_W_BACK = QP_W_X - QP_D - QP_DECK


def build_qp_bay(L):
    quarter_pipe(L, (QP_E_X, 0.0), 0.0, 12.0, QP_R, QP_H, QP_DECK, "qp_east_coping")
    quarter_pipe(L, (QP_W_X, 0.0), math.pi, 12.0, QP_R, QP_H, QP_DECK, "qp_west_coping")
    L.landmark("QP Bay", (38.0, 0.0, 0.0), "spot")
    L.spawn("QP Bay", (32.0, -3.0, 0.0), (1, 0))


def build_funbox(L):
    H = 0.55
    top = (28.0, -36.0, 36.0, -32.0)
    bot = (25.6, -38.0, 38.4, -30.0)
    L.frustum("Obstacles", bot, top, 0.0, H, "concrete_ramp", mat_top="plaza_concrete")
    ledge(L, 32.0, -34.0, 5.0, 0.5, 0.35, z0=H, name="funbox_ledge")
    # flat bar down the east bank (rail)
    # kickers
    kicker(L, 14.5, -44.0, 0.0)
    kicker(L, 47.0, -19.5, -math.pi / 2)
    L.landmark("Pyramid", (32.0, -34.0, 0.0), "spot")


def kicker(L, x, y, ang, length=1.6, h=0.5, w=1.5):
    R = (length ** 2 + h ** 2) / (2 * h)
    pts = []
    n = 8
    th_max = math.asin(length / R)
    for i in range(n + 1):
        th = th_max * i / n
        pts.append((R * math.sin(th), R - R * math.cos(th)))
    L.profile_extrude("Obstacles", [(pts, "kicker_steel", True)], w, (x, y, 0), ang, "kicker_steel")


def build_ledge_garden(L):
    ledge(L, -41.0, -22.0, 10.0, 0.5, 0.45, name="sw_ledge")
    ledge(L, -26.0, -30.0, 12.0, 0.5, 0.30, name="sw_low_ledge")
    ledge(L, -44.5, -42.0, 7.0, 0.6, 0.60, mat="granite_dark", name="sw_tall_ledge")
    ledge(L, -15.0, -40.0, 12.0, 0.5, 0.38, ang=math.pi / 2, name="sw_long_ledge")
    ledge(L, -27.0, -46.5, 7.0, 0.5, 0.40, ang=math.radians(25), mat="granite_dark", name="sw_angled_ledge")
    manual_pad(L, -38.0, -34.0, 4.0, 2.4, 0.15, name="manual_low")
    manual_pad(L, -24.0, -38.5, 5.0, 2.0, 0.25, name="manual_high")
    # flat bar
    zb = 0.33
    pts = [(-44.0, -50.5, zb), (-36.0, -50.5, zb)]
    L.cylinder("Obstacles", pts[0], pts[1], 0.036, "rail_paint", seg=4, col="COL_Rails", phase=math.pi / 4,
               smooth=False)
    for xx in (-43.6, -36.4):
        L.box("Obstacles", "rail_paint", (xx, -50.5, 0.0), (0.05, 0.05, zb), col="COL_Rails")
        L.box("Obstacles", "rail_paint", (xx, -50.5, 0.0), (0.06, 0.6, 0.02), col=False)
    L.rail("rail", pts, name="flat_bar")
    L.landmark("Ledge Garden", (-32.0, -34.0, 0.0), "spot")
    L.spawn("Ledge Garden", (-30.0, -15.0, 0.0), (0, -1))


def build_west(L):
    planter(L, -44.0, 8.0, 6.0, 3.0, tree=lambda L_, x, y, z: broadleaf(L_, x, y, z, seed=3, scale=1.15),
            name="west_planter")
    planter(L, -30.0, -4.0, 6.0, 3.0, tree=lambda L_, x, y, z: broadleaf(L_, x, y, z, seed=5), name="west_planter")
    planter(L, -46.0, -8.0, 4.0, 4.0, tree=lambda L_, x, y, z: palm(L_, x, y, z, height=8.0, seed=8),
            name="west_planter")
    bench(L, -22.0, 12.0, 0.0)
    bench(L, -36.0, 14.0, 0.0)
    L.landmark("Planters", (-38.0, 2.0, 0.0), "area")


def build_south_bank(L):
    H = 1.0
    L.profile_extrude("Obstacles", [([(0, 0), (2.6, H)], "concrete_ramp", False),
                                    ([(2.6, H), (4.0, H)], "plaza_concrete", False)],
                      18.0, (0.0, -50.0, 0), -math.pi / 2, "granite")
    a, b = (-9.0, -52.6, H), (9.0, -52.6, H)
    L.cylinder("Obstacles", (a[0], a[1], H - 0.01), (b[0], b[1], H - 0.01), 0.03, "coping", seg=10, col="COL_Rails")
    L.rail("coping", [a, b], name="south_bank_lip")
    L.landmark("South Bank", (0.0, -51.0, 0.0), "spot")


def build_plaza_furniture(L):
    for (x, y) in ((-10.5, 10.5), (10.5, 10.5), (-10.5, -10.5), (10.5, -10.5)):
        bench(L, x, y, math.atan2(y, x) + math.pi / 2, name="fountain_bench")
    for (x, y) in ((-15.0, -15.0), (15.0, -15.0), (-15.0, 15.0), (15.0, 15.0)):
        plaza_lamp(L, x, y)
    # flush tree pits (shade + density, trunk is collidable)
    for i, (x, y) in enumerate(((-19.0, 13.0), (-19.0, -15.0), (19.0, -15.0), (17.0, 12.0), (-51.0, -30.0),
                                (51.0, -42.0), (-51.0, 0.0), (51.0, 18.0), (-8.0, 51.0), (8.0, 51.0))):
        tree_pit(L, x, y, seed=80 + i)
    # stepped double ledge between fountain and south bank
    ledge(L, 0.0, -35.6, 9.0, 0.6, 0.45, name="double_ledge_low", rails="south")
    ledge(L, 0.0, -35.0, 9.0, 0.6, 0.62, mat="granite_dark", name="double_ledge_high")
    # long bench row along the west edge, benches by the east edge
    bench(L, 50.5, -30.0, math.pi / 2, length=3.0)
    bench(L, -8.0, -24.0, 0.0, length=3.0)
    bench(L, 8.0, -24.0, 0.0, length=3.0)
    # tree pits on the NE platform corners, palms along plaza edge
    for i, (x, y) in enumerate(((48.0, 48.0), (16.0, 49.0))):
        planter(L, x, y, 2.4, 2.4, h=0.45, z0=0.48, tree=lambda L_, xx, yy, z, s=i: broadleaf(L_, xx, yy, z, seed=70 + s),
                name="platform_planter")
    for (x, y) in ((-50.0, -12.0), (-50.0, 18.0)):
        bin_(L, x, y)


def build_street_props(L):
    rng = random.Random(11)
    # inner sidewalk: lamps + palms alternating, arm pointing to street
    for side in range(4):
        for k, t in enumerate(range(-48, 49, 12)):
            if abs(t) < 4:
                continue
            r = CURB_IN - 0.9
            if side == 0:
                x, y, a = float(t), -r, -math.pi / 2
            elif side == 1:
                x, y, a = float(t), r, math.pi / 2
            elif side == 2:
                x, y, a = -r, float(t), math.pi
            else:
                x, y, a = r, float(t), 0.0
            if k % 2 == 0:
                street_lamp(L, x, y, a)
            else:
                palm(L, x, y, 0.0, height=rng.uniform(8.5, 11.5), seed=100 + side * 20 + k)
    # outer sidewalk palms (taller)
    for side in range(4):
        for k, t in enumerate(range(-66, 67, 12)):
            if abs(t) < 4:
                continue
            r = CURB_OUT + 1.3
            if side == 0:
                x, y = float(t), -r
            elif side == 1:
                x, y = float(t), r
            elif side == 2:
                x, y = -r, float(t)
            else:
                x, y = r, float(t)
            if k % 2:
                palm(L, x, y, 0.0, height=rng.uniform(10.0, 13.5), seed=300 + side * 20 + k)
            else:
                street_lamp(L, x, y, [-math.pi / 2 + math.pi, math.pi / 2 + math.pi, 0.0, math.pi][side] + 0.0)
    # parked cars
    colors = ["red", "blue", "cream", "teal", "black", "white", "yellow", "silver"]
    spots = []
    for side in range(4):
        for t in (-44.0, -30.0, 18.0, 34.0, 50.0):
            spots.append((side, t + rng.uniform(-3, 3), rng.random() < 0.5))
    for i, (side, t, outer) in enumerate(spots):
        if rng.random() < 0.35:
            continue
        r = (CURB_OUT - 1.15) if outer else (CURB_IN + 1.15)
        if side == 0:
            x, y, a = t, -r, 0.0 if outer else math.pi
        elif side == 1:
            x, y, a = t, r, math.pi if outer else 0.0
        elif side == 2:
            x, y, a = -r, t, math.pi / 2
        else:
            x, y, a = r, t, -math.pi / 2
        car(L, x, y, a, colors[i % len(colors)], seed=500 + i)
    L.spawn("Street", (0.0, -61.0, STREET_Z), (1, 0))


# ======================================================================================
# buildings
# ======================================================================================
FLOOR = 3.4
BAY = 3.6
FACADE_STYLES = [
    ("facade_a", ["cream", "terracotta", "salmon", "ochre"]),
    ("facade_b", ["white", "mint", "sky", "sand"]),
    ("facade_c", ["brick"]),
]


def building(L, side, t0, t1, depth, floors, style, tint, rng, mural=False, setback=0.0, shops=True):
    """Block building whose street facade lies on the boundary line.

    side: 0=south (facade faces +y), 1=north (faces -y), 2=west (faces +x), 3=east (faces -x)
    t0,t1: extent along the facade (world x for N/S, world y for E/W)
    """
    hgt = floors * FLOOR
    par = 0.9
    # local frame: u along facade, n = inward normal toward plaza
    F = FACADE + setback
    if side == 0:
        P = lambda u, d, z: (u, -F - d, z)
    elif side == 1:
        P = lambda u, d, z: (-u, F + d, z)
    elif side == 2:
        P = lambda u, d, z: (-F - d, -u, z)
    else:
        P = lambda u, d, z: (F + d, u, z)
    # in local coords facade is d=0, building extends to d=depth. u from a to b (CCW seen from plaza)
    if side in (1, 2):
        a, b = -t1, -t0
    else:
        a, b = t0, t1
    mat = f"{style}_{tint}" if not mural else "plaster_" + tint
    w = b - a
    nb = max(1, round(w / BAY))
    ub = nb / w  # facade texture repeats per bay

    def wall(p0u, p0d, p1u, p1d, z0, z1, m, uv=True, u_off=0.0):
        q = [P(p0u, p0d, z0), P(p1u, p1d, z0), P(p1u, p1d, z1), P(p0u, p0d, z1)]
        ln = math.hypot(p1u - p0u, p1d - p0d)
        if uv:
            uvq = [(u_off, z0 / FLOOR), (u_off + ln * ub, z0 / FLOOR), (u_off + ln * ub, z1 / FLOOR),
                   (u_off, z1 / FLOOR)]
        else:
            uvq = None
        return q, uvq

    polys, mats, uvs = [], [], []
    # facade (faces the plaza: from P definitions, d=0 plane, normal -d direction)
    for (q, uvq, m) in [
        (*wall(a, 0, b, 0, 0.0, hgt, None), mat),
        (*wall(b, 0, b, depth, 0.0, hgt, None, u_off=0.0), mat),
        (*wall(a, depth, a, 0, 0.0, hgt, None), mat),
    ]:
        polys.append(q)
        mats.append(m)
        uvs.append(uvq)
    # roof
    polys.append([P(a, 0, hgt), P(a, depth, hgt), P(b, depth, hgt), P(b, 0, hgt)])
    mats.append("roof")
    uvs.append(None)
    # parapet (thin, flat-top) around front + sides
    pt = 0.25
    for (u0, d0, u1, d1) in ((a, 0, b, 0), (b, 0, b, depth), (a, depth, a, 0)):
        q, uvq = wall(u0, d0, u1, d1, hgt, hgt + par, None)
        polys.append(q)
        mats.append(mat)
        uvs.append(uvq)
    # parapet top + inner face
    polys.append([P(a, 0, hgt + par), P(b, 0, hgt + par), P(b, pt, hgt + par), P(a, pt, hgt + par)])
    mats.append("trim")
    uvs.append(None)
    polys.append([P(b, pt, hgt + par), P(b, pt, hgt), P(a, pt, hgt), P(a, pt, hgt + par)])
    mats.append("trim")
    uvs.append(None)
    # orient all polys outward: compute centroid of building, flip if needed
    cen = np.array(P((a + b) / 2, depth / 2, hgt / 2))
    fixed = []
    for q, m, uvq in zip(polys, mats, uvs):
        c = np.mean(np.array(q), axis=0)
        n = _n(q)
        out = c - cen
        if m == "roof" or (m == "trim" and abs(n[2]) > 0.5):
            want = (0, 0, 1)
        elif m == "trim":
            want = tuple(-out)
        else:
            want = tuple(out)
        if np.dot(n, want) < 0:
            q = list(reversed(q))
            uvq = list(reversed(uvq)) if uvq else None
        fixed.append((q, m, uvq))
    verts, faces = _flat([f[0] for f in fixed])
    L.emit("Buildings", verts, faces, [f[1] for f in fixed], uvs=[f[2] for f in fixed])

    # ground floor shopfront strip + awnings
    shop = "shopfront" if style != "facade_c" else "shopfront_dark"
    if not mural and shops:
        q = [P(a + 0.3, -0.04, 0.0), P(b - 0.3, -0.04, 0.0), P(b - 0.3, -0.04, FLOOR - 0.2), P(a + 0.3, -0.04, FLOOR - 0.2)]
        ln = (b - a) - 0.6
        nsh = max(1, round(ln / 4.0))
        uvq = [(0, 0), (nsh, 0), (nsh, 1), (0, 1)]
        want = np.array(P(0, -1, 0)) - np.array(P(0, 0, 0))
        if np.dot(_n(q), want) < 0:
            q = list(reversed(q))
            uvq = list(reversed(uvq))
        L.emit("Buildings", *_flat([q]), shop, uvs=[uvq], col=False)
        awn = rng.choice(["awning_red", "awning_green", "awning_blue", "awning_cream"])
        # awning: sloped slab over the shopfront
        zA = FLOOR - 0.15
        q1 = [P(a + 0.5, 0.0, zA + 0.05), P(b - 0.5, 0.0, zA + 0.05), P(b - 0.5, -1.4, zA - 0.45), P(a + 0.5, -1.4, zA - 0.45)]
        q1 = facing(q1, (0, 0, 1))
        q2 = [P(a + 0.5, -1.4, zA - 0.45), P(b - 0.5, -1.4, zA - 0.45), P(b - 0.5, -1.4, zA - 0.75), P(a + 0.5, -1.4, zA - 0.75)]
        q2 = facing(q2, tuple(want))
        q3 = facing(list(reversed(q1)), (0, 0, -1))
        L.polys("Buildings", [q1, q2, q3], awn, col=False)
    # balconies on facade_a
    if style == "facade_a" and floors >= 2 and not mural:
        for f in range(1, floors):
            for k in range(nb):
                if (k + f) % 2:
                    continue
                uc = a + (k + 0.5) / ub
                z = f * FLOOR + 0.05
                corners = [(uc - 0.75, 0.0), (uc + 0.75, 0.0), (uc + 0.75, -0.9), (uc - 0.75, -0.9)]
                topq = [P(u, d, z + 0.12) for (u, d) in corners]
                botq = [P(u, d, z) for (u, d) in corners]
                polys2 = [facing(topq, (0, 0, 1)), facing(botq, (0, 0, -1))]
                for i in range(4):
                    j = (i + 1) % 4
                    q = [botq[i], botq[j], topq[j], topq[i]]
                    c = np.mean(np.array(q), axis=0) - np.mean(np.array(botq), axis=0)
                    polys2.append(facing(q, tuple(c)))
                L.polys("Buildings", polys2, "trim", col=False)
                # railing: dark metal panel (front + sides)
                rq = [P(uc - 0.72, -0.88, z + 0.12), P(uc + 0.72, -0.88, z + 0.12), P(uc + 0.72, -0.88, z + 1.05),
                      P(uc - 0.72, -0.88, z + 1.05)]
                want = np.array(P(0, -1, 0)) - np.array(P(0, 0, 0))
                L.polys("Buildings", [facing(rq, tuple(want)), facing(list(rq), tuple(-want))], "railing", col=False)
    # rooftop clutter
    for k in range(rng.randint(0, 3)):
        uc = rng.uniform(a + 2, b - 2)
        dc = rng.uniform(3, depth - 3)
        p = P(uc, dc, hgt)
        L.box("Buildings", "trim", (p[0], p[1], hgt), (rng.uniform(1.2, 2.5), rng.uniform(1.2, 2.5), rng.uniform(0.8, 1.6)),
              col=False)
    # collision: simple box (whole footprint)
    q0 = P(a, 0, 0)
    q1 = P(b, depth, 0)
    mn = (min(q0[0], q1[0]), min(q0[1], q1[1]), 0.0)
    mx = (max(q0[0], q1[0]), max(q0[1], q1[1]), hgt + par)
    L.boxmm("Buildings", "collision", mn, mx, col="only", top=True)
    return P


def _alley_ground(L, side, t0, t1, depth):
    F = FACADE
    if side == 0:
        q = [(t0, -F - depth, 0), (t1, -F - depth, 0), (t1, -F, 0), (t0, -F, 0)]
    elif side == 1:
        q = [(t0, F, 0), (t1, F, 0), (t1, F + depth, 0), (t0, F + depth, 0)]
    elif side == 2:
        q = [(-F - depth, t0, 0), (-F, t0, 0), (-F, t1, 0), (-F - depth, t1, 0)]
    else:
        q = [(F, t0, 0), (F + depth, t0, 0), (F + depth, t1, 0), (F, t1, 0)]
    L.polys("Ground", [facing(q, (0, 0, 1))], "sidewalk")


def build_buildings(L):
    rng = random.Random(2026)
    murals = []
    for side in range(4):
        # along-facade extent: corners belong to sides 0/1 (extend to +-FACADE-18)
        lo, hi = -FACADE - 18.0, FACADE + 18.0
        if side >= 2:
            lo, hi = -FACADE, FACADE
        t = lo
        idx = 0
        while t < hi - 1:
            w = rng.uniform(10.0, 20.0)
            if hi - (t + w) < 8.0:
                w = hi - t
            # leave an alley on each side
            if idx == 3:
                # alley: ground + a set-back back building closing the view
                aw = 4.5
                building(L, side, t, t + aw, 8.0, 3, "facade_c", "brick", rng, setback=9.0, shops=False)
                _alley_ground(L, side, t, t + aw, 9.0)
                t += aw
                idx += 1
                continue
            style, tints = FACADE_STYLES[rng.choices([0, 1, 2], [0.5, 0.35, 0.15])[0]]
            tint = rng.choice(tints)
            floors = rng.choice([2, 3, 3, 4, 4, 5, 6])
            depth = 18.0 if side < 2 else 16.0
            mural = (side == 1 and idx == 2)
            if mural:
                floors = 4
                tint = "cream"
            building(L, side, t, t + w, depth, floors, style, tint, rng, mural=mural)
            if mural:
                murals.append((side, t, t + w, floors))
            t += w
            idx += 1
    # alley back walls (dark) so you never look into the void
    return murals


def build_backdrop(L):
    """Distant, render-only city blocks + ground so the skyline never shows the void."""
    rng = random.Random(77)
    styles = ([f"facade_a_{t}" for t in ("cream", "terracotta", "salmon", "ochre")] +
              [f"facade_b_{t}" for t in ("white", "mint", "sky", "sand")] + ["facade_c_brick"])
    # ground ring
    r0, r1 = 92.0, 240.0
    rects = [(-r1, -r1, r1, -r0), (-r1, r0, r1, r1), (-r1, -r0, -r0, r0), (r0, -r0, r1, r0)]
    L.polys("Backdrop", [[(a, b, -0.02), (c, b, -0.02), (c, d, -0.02), (a, d, -0.02)] for (a, b, c, d) in rects],
            "asphalt", col=False)
    for side in range(4):
        for row, (d0, d1) in enumerate(((104.0, 128.0), (140.0, 175.0))):
            t = -190.0
            while t < 190.0:
                w = rng.uniform(16.0, 32.0)
                if rng.random() < 0.15:
                    t += w * 0.5
                    continue
                dd0 = d0 + rng.uniform(0, 4)
                dd1 = d1 - rng.uniform(0, 4)
                h = rng.uniform(10.0, 26.0) + row * rng.uniform(4.0, 24.0)
                h = round(h / 3.4) * 3.4 + 0.6
                if side == 0:
                    mn, mx = (t, -dd1), (t + w, -dd0)
                elif side == 1:
                    mn, mx = (t, dd0), (t + w, dd1)
                elif side == 2:
                    mn, mx = (-dd1, t), (-dd0, t + w)
                else:
                    mn, mx = (dd0, t), (dd1, t + w)
                st = rng.choice(styles)
                L.boxmm("Backdrop", st, (mn[0], mn[1], 0.0), (mx[0], mx[1], h), mat_top="roof", col=False)
                t += w + rng.uniform(0.0, 6.0)


def build_boundary(L):
    """Invisible collision walls around the playable area (exported in both glbs)."""
    t = 0.5
    r = FACADE
    for (mn, mx) in (((-r - t, -r - t, -2.0), (r + t, -r, 30.0)), ((-r - t, r, -2.0), (r + t, r + t, 30.0)),
                     ((-r - t, -r, -2.0), (-r, r, 30.0)), ((r, -r, -2.0), (r + t, r, 30.0))):
        lo = [(mn[0], mn[1], mn[2]), (mx[0], mn[1], mn[2]), (mx[0], mx[1], mn[2]), (mn[0], mx[1], mn[2])]
        hi = [(p[0], p[1], mx[2]) for p in lo]
        polys = [hi, lo[::-1]] + [[lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]] for i in range(4)]
        v, f = _flat(polys)
        L.col_only("COL_Boundary", v, f)


# ======================================================================================
# decals: posters, graffiti, murals
# ======================================================================================
def decal_quad(L, center, normal_xy, width, height, mat, z0, off=0.02):
    """Upright decal quad in front of a wall. normal_xy = wall outward normal (unit, 2D)."""
    nx, ny = normal_xy
    cx, cy = center[0] + nx * off, center[1] + ny * off
    rx, ry = -ny, nx  # viewer's right when looking at the wall
    hw = width / 2
    q = [(cx - rx * hw, cy - ry * hw, z0), (cx + rx * hw, cy + ry * hw, z0),
         (cx + rx * hw, cy + ry * hw, z0 + height), (cx - rx * hw, cy - ry * hw, z0 + height)]
    L.emit("Decals", *_flat([q]), mat, uvs=[[(0, 0), (1, 0), (1, 1), (0, 1)]], col=False)


def build_decals(L, murals):
    # QP west back wall (faces -x toward the fountain): big noggles graffiti piece
    decal_quad(L, (QP_W_BACK, 0.0), (-1, 0), 9.0, 1.85, "graffiti_0", 0.08)
    # QP east back wall (faces +x toward the street)
    decal_quad(L, (QP_E_BACK, 0.0), (1, 0), 9.5, 1.85, "graffiti_1", 0.08)
    # south bank back wall (faces -y)
    decal_quad(L, (-3.0, -54.0), (0, -1), 9.0, 0.95, "graffiti_2", 0.02)
    # posters on the terrace front wall (faces -y), east of the stairs
    for i, x in enumerate((-24.5, -23.6, -22.7, -21.8, -17.0, -16.1)):
        decal_quad(L, (x, 22.0), (0, -1), 0.8, 0.66, f"poster_{i % 4}", 0.16, off=0.012)
    # posters on the platform front wall (faces -y), west part
    for i, x in enumerate((14.0, 14.9, 15.8, 19.5, 20.4)):
        decal_quad(L, (x, 22.0), (0, -1), 0.8, 0.36, f"poster_{(i + 2) % 4}", 0.06, off=0.012)
    # mini ramp sides: tags
    decal_quad(L, (39.0, 38.5), (0, -1), 2.6, 1.0, "graffiti_2", 0.55)
    # terrace west bank side + funbox: a few tags
    decal_quad(L, (-12.0, 25.0), (1, 0), 4.0, 0.85, "graffiti_1", 0.05)
    # murals on the designated buildings
    for (side, t0, t1, floors) in murals:
        if side == 1:
            cx = -(t0 + t1) / 2 * -1
            # side 1 facade at y=+FACADE facing -y; u runs -x so the world center is (-(-t1-t0)/2)
            cx = (t0 + t1) / 2
            w = min(14.0, (t1 - t0) - 2.0)
            decal_quad(L, (cx, FACADE), (0, -1), w, w * 0.62, "mural", 3.8)
    # posters on building fronts at street level are in the shopfront texture.


def build_all():
    L = Level()
    build_ground(L)
    build_fountain(L)
    build_terrace(L)
    build_platform(L)
    build_qp_bay(L)
    build_funbox(L)
    build_ledge_garden(L)
    build_west(L)
    build_south_bank(L)
    build_plaza_furniture(L)
    build_street_props(L)
    murals = build_buildings(L)
    build_decals(L, murals)
    build_backdrop(L)
    build_boundary(L)
    L.spawn("Plaza South", (0.0, -28.0, 0.0), (0, 1))
    L.spawn("Fountain", (0.0, -11.0, 0.0), (0, 1))
    return L
