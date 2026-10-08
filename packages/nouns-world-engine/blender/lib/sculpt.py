"""Angular low-poly street body (Jet Set Radio style) built from lofted sections.

Every part is a LOFT: a stack of 6-10 sided chamfered cross-sections
("rings"). Sections are low-exponent superellipses (p < 2 = chamfered
diamonds/octagons) and the mesh is flat-shaded at a low crease angle, so
the body reads as crisp planes for a cel-shaded (toon ramp + outline) look:

* cropped boxy jacket with shoulder pads, rib hem band and a funnel collar
  that hides the neck (the head sits straight on it);
* long, lanky arms in puffy jacket sleeves with rib cuffs, mitten hands with
  a big thumb wedge;
* baggy cargo pants with hard twisted folds (alternate rings are rotated
  half a facet) and thigh cargo pockets, stacking over
* chunky sneakers with thick flat soles and a big toe box.

All authoring is in the RIG FRAME (x = character left, f = forward, z = up);
Blender space is (x, -f, z). Every builder reads the module-level weight
`WT` (-1 = thin, 0 = base, +1 = heavy) through `M()`, and nothing else
depends on it, so building the mesh at WT = -1 / 0 / +1 yields identical
topology -> the weight_thin / weight_heavy shape keys (glTF morph targets).
"""
from __future__ import annotations

import math

import bpy  # noqa: F401  (must be imported before bmesh)
import bmesh
from mathutils import Vector

import common as C

BODY, SKIN, PANTS, SHOE, SOLE = range(5)
WT = 0.0
FLAT_ANGLE = 28.0   # degrees: edges sharper than this are hard (flat planes)

# ---------------------------------------------------------------------------
# Texture layouts (image space, v DOWN = glTF convention)
# NounPants (pants.png): legs u 0..0.5 around (0 / 0.5 inseam, 0.125 back,
#   0.25 outer seam, 0.375 front), v 0 (thigh top) .. 1 (hem);
#   pelvis u 0.5..1, v 0..0.5; cargo pockets u 0.55..0.95, v 0.6..0.9.
# NounShoe + NounSole share shoe.png: upper v 0..0.6, sole v 0.62..0.98.
# NounBody: torso uses rig.UV_REGIONS; sleeves/collar -> "sleeves" rect.
# ---------------------------------------------------------------------------
LEG_TOP, LEG_BOT = 0.60, 0.085
PELVIS_TOP, PELVIS_BOT = 0.79, 0.48
UPPER_N, SOLE_N = 8, 6
SHOE_V0, SHOE_V1 = 0.0, 0.6
SOLE_V0, SOLE_V1 = 0.62, 0.98
POCKET_UV = (0.55, 0.6, 0.95, 0.9)


def M(base, thin, heavy):
    """Value for the current weight WT (-1 thin .. 0 base .. +1 heavy)."""
    if WT < 0:
        return base + (thin - base) * (-WT)
    return base + (heavy - base) * WT


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def interp_w(z, table):
    if z <= table[0][0]:
        return dict(table[0][1])
    for (za, wa), (zb, wb) in zip(table, table[1:]):
        if z <= zb:
            t = (z - za) / (zb - za)
            return {k: wa.get(k, 0) * (1 - t) + wb.get(k, 0) * t for k in set(wa) | set(wb)}
    return dict(table[-1][1])


# ---------------------------------------------------------------------------
# Mesh accumulator + loft
# ---------------------------------------------------------------------------
class MeshData:
    def __init__(self):
        self.co, self.w = [], []
        self.faces = []  # (vids, uvs(image space) or None, mat)

    def vert(self, co, w):
        self.co.append(Vector(co))
        self.w.append(w)
        return len(self.co) - 1

    def face(self, vids, uvs, mat):
        self.faces.append((list(vids), list(uvs), mat))


def _newell(pts):
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def loft(md, rings, mat, wfn, uvfn, cap0=None, cap1=None, cap_uv=(None, None), inward=False):
    """Skin a stack of closed rings (lists of rig-frame Vectors, equal length).
    wfn(co) -> {bone: w}; uvfn(i, j) -> (u, v) (j = 0..N, N = wrap);
    cap0 / cap1: None | 'flat' | Vector tip. Faces point away from the ring
    centroids (inward=True flips). Orientation is decided on the geometry of
    the current weight, which never flips a face between morphs."""
    N = len(rings[0])
    ids = [[md.vert(co, wfn(co)) for co in rg] for rg in rings]
    cents = [sum(r, Vector()) / len(r) for r in rings]
    for i in range(len(rings) - 1):
        axis_c = (cents[i] + cents[i + 1]) / 2
        for j in range(N):
            j1 = (j + 1) % N
            q = [ids[i][j], ids[i][j1], ids[i + 1][j1], ids[i + 1][j]]
            uv = [uvfn(i, j), uvfn(i, j + 1), uvfn(i + 1, j + 1), uvfn(i + 1, j)]
            pts = [md.co[k] for k in q]
            if (_newell(pts).dot(sum(pts, Vector()) / 4 - axis_c) < 0) != inward:
                q.reverse()
                uv.reverse()
            md.face(q, uv, mat)
    for which, cap in ((0, cap0), (1, cap1)):
        if cap is None:
            continue
        ri = 0 if which == 0 else len(rings) - 1
        rn = 1 if which == 0 else len(rings) - 2
        out = (cents[ri] - cents[rn]).normalized()
        tip = cents[ri] if cap == "flat" else Vector(cap)
        tid = md.vert(tip, wfn(tip))
        cuv = cap_uv[which] or uvfn(ri, 0)
        for j in range(N):
            j1 = (j + 1) % N
            tri = [tid, ids[ri][j], ids[ri][j1]]
            uv = [cuv, uvfn(ri, j), uvfn(ri, j + 1)]
            if (_newell([md.co[k] for k in tri]).dot(out) < 0) != inward:
                tri = [tri[0], tri[2], tri[1]]
                uv = [uv[0], uv[2], uv[1]]
            md.face(tri, uv, mat)
    return ids


def ring(c, e1, e2, r1p, r1n, r2p, r2n, n, start_deg=180.0, p=1.7):
    """Closed chamfered ring around c in the plane (e1, e2); per-side radii."""
    pts = []
    ex = 2.0 / p
    for k in range(n):
        th = math.radians(start_deg) + 2 * math.pi * k / n
        ct, st = math.cos(th), math.sin(th)
        a = math.copysign(abs(ct) ** ex, ct)
        b = math.copysign(abs(st) ** ex, st)
        a *= r1p if a > 0 else r1n
        b *= r2p if b > 0 else r2n
        pts.append(c + e1 * a + e2 * b)
    return pts


def V(x, f, z):
    return Vector((x, f, z))


X_AX, F_AX = V(1, 0, 0), V(0, 1, 0)

# ---------------------------------------------------------------------------
# Cropped jacket (NounBody) with funnel collar
# ---------------------------------------------------------------------------
TORSO_N = 10
TORSO_START = 108.0      # flat front/back panels (vertices at +-18 deg off the front)


def torso_table():
    """(z, half width, front depth, back depth). Heavy: round belly pushing the
    jacket forward + a much wider waist; thin: everything ~15 % slimmer."""
    rows = []
    for z, w, df, db in [
        (0.718, 0.206, 0.130, 0.124),   # rib hem band (cropped)
        (0.762, 0.204, 0.128, 0.122),
        (0.774, 0.192, 0.120, 0.115),   # crease above the band
        (0.845, 0.206, 0.130, 0.118),
        (0.920, 0.224, 0.136, 0.124),   # chest
        (0.990, 0.240, 0.128, 0.126),   # shoulder pads
        (1.035, 0.226, 0.108, 0.114),
        (1.062, 0.140, 0.092, 0.100),   # shoulder top -> collar
        (1.090, 0.112, 0.086, 0.094),   # funnel collar
        (1.165, 0.118, 0.090, 0.098),   # collar top (inside the head)
    ]:
        b = smooth(1 - abs(z - 0.80) / 0.20)         # belly: 0..1, peak at z 0.80
        trunk = 1.0 if z < 1.05 else 0.3
        hw = M(w, w * 0.86, w * (1.0 + 0.45 * b + 0.14 * trunk))
        hdf = M(df, df * 0.82, df + 0.26 * b + 0.04 * trunk)
        hdb = M(db, db * 0.86, db + 0.07 * b + 0.03 * trunk)
        rows.append((z, hw, hdf, hdb))
    return rows


TORSO_W = [
    (0.70, {"hips": 0.6, "spine": 0.4}),
    (0.76, {"hips": 0.2, "spine": 0.8}),
    (0.82, {"spine": 1.0}),
    (0.88, {"spine": 0.5, "chest": 0.5}),
    (0.95, {"chest": 1.0}),
    (1.07, {"chest": 1.0}),
    (1.17, {"chest": 0.4, "neck": 0.6}),
]


def torso_weights(co):
    w = interp_w(co.z, TORSO_W)
    ax = abs(co.x)
    if co.z > 0.93 and ax > 0.13:
        side = "L" if co.x > 0 else "R"
        k = smooth((ax - 0.13) / 0.09) * smooth((co.z - 0.93) / 0.08) * 0.5
        w = {b: v * (1 - k) for b, v in w.items()}
        w[f"shoulder.{side}"] = w.get(f"shoulder.{side}", 0) + k
    return w


def build_torso(md, sleeve_uv):
    tab = torso_table()
    rings = [ring(V(0, 0, z), X_AX, F_AX, w, w, df, db, TORSO_N, TORSO_START, p=1.75) for z, w, df, db in tab]
    loft(md, rings, BODY, torso_weights, lambda i, j: None, cap1="flat")
    z, w, df, db = tab[0]
    lip = ring(V(0, 0, z + 0.03), X_AX, F_AX, w * 0.93, w * 0.93, df * 0.9, db * 0.9, TORSO_N, TORSO_START, p=1.75)
    loft(md, [lip, rings[0]], BODY, torso_weights, lambda i, j: None, inward=True)


# ---------------------------------------------------------------------------
# Pants seat (NounPants)
# ---------------------------------------------------------------------------
def pelvis_table():
    rows = []
    for z, w, df, db in [(0.480, 0.150, 0.088, 0.098), (0.530, 0.196, 0.108, 0.122), (0.600, 0.204, 0.112, 0.128),
                         (0.700, 0.194, 0.106, 0.116), (0.790, 0.184, 0.100, 0.106)]:
        hip = smooth((z - 0.48) / 0.12)
        rows.append((z, M(w, w * 0.88, w * (1.35 + 0.25 * hip)), M(df, df * 0.85, df * 1.4 + 0.16 * hip),
                     M(db, db * 0.88, db * 1.55)))
    return rows


def pelvis_weights(co):
    w = interp_w(co.z, [(0.70, {"hips": 1.0}), (0.79, {"hips": 0.6, "spine": 0.4})])
    ax = abs(co.x)
    if co.z < 0.57 and ax > 0.04:
        side = "L" if co.x > 0 else "R"
        k = 0.35 * smooth((0.57 - co.z) / 0.08) * smooth((ax - 0.04) / 0.08)
        w = {b: v * (1 - k) for b, v in w.items()}
        w[f"thigh.{side}"] = k
    return w


def build_pelvis(md):
    tab = pelvis_table()
    rings = [ring(V(0, 0, z), X_AX, F_AX, w, w, df, db, TORSO_N, TORSO_START, p=1.75) for z, w, df, db in tab]

    def uv(i, j):
        return (0.5 + 0.5 * j / TORSO_N, 0.5 * (PELVIS_TOP - tab[i][0]) / (PELVIS_TOP - PELVIS_BOT))

    loft(md, rings, PANTS, pelvis_weights, uv, cap0="flat", cap1="flat", cap_uv=((0.75, 0.49), (0.75, 0.0)))


# ---------------------------------------------------------------------------
# Baggy cargo legs (NounPants)
# ---------------------------------------------------------------------------
LEG_N = 8
# (z, centre x, centre f, r_out, r_in, r_front, r_back, twist)  twist = hard diagonal fold
LEG_ROWS = [
    (0.085, 0.092, 0.012, 0.098, 0.084, 0.106, 0.100, 0.0),   # hem stack over the shoe
    (0.112, 0.092, 0.010, 0.094, 0.080, 0.100, 0.096, 0.5),
    (0.140, 0.092, 0.008, 0.082, 0.070, 0.086, 0.084, 0.0),   # fold crease
    (0.190, 0.092, 0.006, 0.088, 0.072, 0.090, 0.090, 0.0),
    (0.250, 0.093, 0.006, 0.086, 0.070, 0.088, 0.088, 0.0),
    (0.290, 0.094, 0.010, 0.082, 0.066, 0.086, 0.082, 0.5),   # knee fold
    (0.320, 0.095, 0.014, 0.088, 0.070, 0.096, 0.084, 0.0),
    (0.380, 0.097, 0.008, 0.092, 0.072, 0.092, 0.090, 0.0),
    (0.450, 0.100, 0.004, 0.098, 0.076, 0.096, 0.096, 0.0),
    (0.530, 0.102, 0.000, 0.100, 0.078, 0.100, 0.102, 0.0),
    (0.600, 0.100, 0.000, 0.096, 0.076, 0.098, 0.100, 0.0),
]


def leg_row(row):
    z, cx, cf, ro, ri, rf, rb, tw = row
    thigh = smooth((z - 0.30) / 0.22)                 # 1 at the hip, 0 below the knee
    k = M(1.0, 0.72, 1.25 + 0.45 * thigh) * 1.14   # x1.14: baggy
    cx = cx + M(0.0, -0.004, 0.05 * thigh + 0.01)
    return z, cx, cf, ro * k, ri * M(1.0, 0.72, 1.1 + 0.2 * thigh) * 1.08, rf * k, rb * k, tw


def leg_weights(side):
    tab = [
        (0.0, {f"shin.{side}": 1.0}), (0.25, {f"shin.{side}": 1.0}),
        (0.30, {f"shin.{side}": 0.5, f"thigh.{side}": 0.5}),
        (0.35, {f"thigh.{side}": 1.0}), (0.50, {f"thigh.{side}": 1.0}),
        (0.56, {f"thigh.{side}": 0.8, "hips": 0.2}), (0.61, {f"thigh.{side}": 0.45, "hips": 0.55}),
    ]
    return lambda co: interp_w(co.z, tab)


def build_leg(md, side, sx):
    rows = [leg_row(r) for r in LEG_ROWS]
    step = 360.0 / LEG_N
    rings = [ring(V(cx * sx, cf, z), V(sx, 0, 0), F_AX, ro, ri, rf, rb, LEG_N, 180.0 + tw * step * sx, p=1.6)
             for z, cx, cf, ro, ri, rf, rb, tw in rows]

    def uv(i, j):
        return (0.5 * j / LEG_N, (LEG_TOP - rows[i][0]) / (LEG_TOP - LEG_BOT))

    wf = leg_weights(side)
    loft(md, rings, PANTS, wf, uv, cap1="flat", cap_uv=(None, (0.25, 0.0)))
    z, cx, cf, ro, ri, rf, rb, tw = rows[0]
    lip = ring(V(cx * sx, cf, z + 0.035), V(sx, 0, 0), F_AX, ro * 0.8, ri * 0.8, rf * 0.8, rb * 0.8, LEG_N, 180.0,
               p=1.6)
    loft(md, [lip, rings[0]], PANTS, wf, lambda i, j: (0.5 * j / LEG_N, 0.99), cap0="flat", inward=True,
         cap_uv=((0.25, 0.99), None))
    # cargo pocket on the outer thigh: a flat box standing off the leg
    row = leg_row(min(LEG_ROWS, key=lambda r: abs(r[0] - 0.40)))
    pcx, pcf, pro = row[1], row[2], row[3]
    x_in, x_out = pcx + pro * 0.72, pcx + pro * 0.72 + 0.035
    pu0, pv0, pu1, pv1 = POCKET_UV
    rings_p = []
    for x, s in ((x_in, 1.0), (x_out, 0.9)):
        rings_p.append([V(x * sx, pcf - 0.065 * s, 0.335), V(x * sx, pcf + 0.065 * s, 0.335),
                        V(x * sx, pcf + 0.07 * s, 0.455), V(x * sx, pcf - 0.07 * s, 0.455)])
    loft(md, rings_p, PANTS, wf, lambda i, j: (pu0 + (pu1 - pu0) * (j % 4) / 4, pv0 + (pv1 - pv0) * 0.5 * i),
         cap1="flat", cap_uv=(None, ((pu0 + pu1) / 2, (pv0 + pv1) / 2)))


# ---------------------------------------------------------------------------
# Arms: puffy jacket sleeves (NounBody), lanky forearms, rib cuffs
# ---------------------------------------------------------------------------
ARM_N = 8
# (z, centre x, centre f, r_out, r_in, r_front, r_back)
ARM_ROWS = [
    (1.088, 0.250, -0.004, 0.040, 0.034, 0.040, 0.042),
    (1.068, 0.262, -0.004, 0.066, 0.056, 0.064, 0.066),
    (1.025, 0.272, -0.002, 0.076, 0.064, 0.070, 0.072),   # shoulder puff
    (0.960, 0.274, 0.000, 0.072, 0.062, 0.068, 0.068),
    (0.890, 0.273, 0.002, 0.064, 0.056, 0.062, 0.060),
    (0.820, 0.271, 0.000, 0.058, 0.052, 0.057, 0.056),
    (0.785, 0.270, -0.004, 0.056, 0.050, 0.054, 0.062),   # elbow (point at the back)
    (0.750, 0.270, 0.000, 0.055, 0.049, 0.055, 0.054),
    (0.690, 0.270, 0.000, 0.049, 0.045, 0.049, 0.048),
    (0.640, 0.270, 0.000, 0.043, 0.040, 0.043, 0.042),    # lanky forearm
    (0.625, 0.270, 0.000, 0.051, 0.048, 0.051, 0.051),    # rib cuff
    (0.582, 0.270, 0.000, 0.051, 0.048, 0.051, 0.051),
]


def arm_row(row):
    z, cx, cf, ro, ri, rf, rb = row
    up = smooth((z - 0.62) / 0.35)                  # 1 upper arm .. 0 wrist
    k = M(1.0, 0.8, 1.32 + 0.3 * up)
    cx = cx + M(0.0, -0.006, 0.07 + 0.03 * up)
    return z, cx, cf, ro * k, ri * k, rf * k, rb * k


def arm_weights(side):
    s = side
    tab = [
        (0.585, {f"forearm.{s}": 0.8, f"hand.{s}": 0.2}),
        (0.62, {f"forearm.{s}": 1.0}),
        (0.755, {f"forearm.{s}": 1.0}),
        (0.785, {f"forearm.{s}": 0.5, f"upperarm.{s}": 0.5}),
        (0.82, {f"upperarm.{s}": 1.0}),
        (0.98, {f"upperarm.{s}": 1.0}),
        (1.03, {f"upperarm.{s}": 0.8, f"shoulder.{s}": 0.2}),
        (1.09, {f"upperarm.{s}": 0.45, f"shoulder.{s}": 0.55}),
    ]
    return lambda co: interp_w(co.z, tab)


def build_arm(md, side, sx, sleeve_uv):
    rows = [arm_row(r) for r in ARM_ROWS]
    rings = [ring(V(cx * sx, cf, z), V(sx, 0, 0), F_AX, ro, ri, rf, rb, ARM_N, 180.0, p=1.7)
             for z, cx, cf, ro, ri, rf, rb in rows]
    zs = [r[0] for r in rows]

    def uv(i, j):
        return sleeve_uv(j / ARM_N, (zs[0] - zs[i]) / (zs[0] - zs[-1]))

    wf = arm_weights(side)
    tip = V((rows[0][1] - 0.008) * sx, -0.004, 1.098)
    loft(md, rings, BODY, wf, uv, cap0=tip)
    z, cx, cf, ro, ri, rf, rb = rows[-1]
    inner = ring(V(cx * sx, cf, z + 0.025), V(sx, 0, 0), F_AX, ro * 0.72, ri * 0.72, rf * 0.72, rb * 0.72,
                 ARM_N, 180.0, p=1.7)
    loft(md, [inner, rings[-1]], BODY, wf, lambda i, j: sleeve_uv(j / ARM_N, 1.0), cap0="flat", inward=True)


# ---------------------------------------------------------------------------
# Mitten hands (NounSkin) with a clear thumb
# ---------------------------------------------------------------------------
HAND_N = 6
HAND_SCALE = 1.32
# (z, centre x, centre f, half thickness out, in, half width front, back)
HAND_ROWS = [
    (0.605, 0.270, 0.000, 0.026, 0.026, 0.033, 0.033),
    (0.578, 0.270, 0.000, 0.025, 0.024, 0.035, 0.034),   # wrist
    (0.545, 0.272, 0.002, 0.030, 0.029, 0.047, 0.044),   # palm
    (0.505, 0.272, 0.003, 0.028, 0.027, 0.050, 0.046),   # knuckles
    (0.472, 0.262, 0.003, 0.022, 0.022, 0.044, 0.041),   # fingers curl toward the palm
]


def build_hand(md, side, sx):
    shift = M(0.0, -0.006, 0.07)
    k = M(1.0, 0.95, 1.12)
    wrist = V((0.27 + shift) * sx, 0.0, 0.592)

    def sc(p):
        p = p + V(shift * sx, 0, 0)
        return wrist + (p - wrist) * HAND_SCALE * k

    rings = [[sc(p) for p in ring(V(cx * sx, cf, z), V(sx, 0, 0), F_AX, to, ti, wf_, wb, HAND_N, 180.0, p=1.6)]
             for z, cx, cf, to, ti, wf_, wb in HAND_ROWS]
    rings[0] = [wrist + (p - wrist) * (1.0 / (HAND_SCALE * k)) * 1.05 for p in rings[0]]
    wfn = lambda co: interp_w(co.z, [(0.585, {f"hand.{side}": 1.0}),
                                     (0.605, {f"hand.{side}": 0.7, f"forearm.{side}": 0.3})])
    tip = sc(V(0.252 * sx, 0.002, 0.452))
    loft(md, rings, SKIN, wfn, lambda i, j: (0.5, 0.5), cap0="flat", cap1=tip)
    # thumb: a chunky wedge off the palm's front edge, pointing forward-down
    base = sc(V(0.262 * sx, 0.030, 0.566))
    tipc = sc(V(0.248 * sx, 0.080, 0.506))
    ax = (tipc - base).normalized()
    Xs = V(sx, 0, 0)
    e1 = (Xs - ax * Xs.dot(ax)).normalized()
    e2 = ax.cross(e1).normalized()
    trs = []
    for t, r1, r2 in ((0.0, 0.019, 0.022), (0.5, 0.017, 0.020), (0.9, 0.012, 0.014)):
        c = base.lerp(tipc, t)
        r1, r2 = r1 * HAND_SCALE * k, r2 * HAND_SCALE * k
        trs.append(ring(c, e1, e2, r1, r1, r2, r2, 5, 0.0, p=1.6))
    loft(md, trs, SKIN, wfn, lambda i, j: (0.5, 0.5), cap0="flat", cap1=tipc + ax * 0.018)


# ---------------------------------------------------------------------------
# Chunky sneakers (NounShoe upper + NounSole)
# ---------------------------------------------------------------------------
# stations along f (ankle at f = 0): (f, half width, sole bottom, sole top, upper top, x shift out)
SHOE_ST = [
    (-0.100, 0.050, 0.014, 0.052, 0.128, 0.000),
    (-0.088, 0.068, 0.000, 0.052, 0.150, 0.000),   # heel
    (-0.040, 0.074, 0.000, 0.052, 0.158, 0.000),   # padded collar
    (0.020, 0.076, 0.000, 0.051, 0.142, 0.003),    # tongue
    (0.080, 0.082, 0.000, 0.050, 0.118, 0.006),    # ball (wide)
    (0.140, 0.080, 0.000, 0.051, 0.104, 0.006),
    (0.180, 0.071, 0.004, 0.055, 0.094, 0.004),    # toe box
    (0.205, 0.056, 0.012, 0.059, 0.084, 0.003),
    (0.220, 0.034, 0.022, 0.061, 0.072, 0.002),    # tip (toe spring)
]
SHOE_F0, SHOE_F1 = SHOE_ST[0][0], SHOE_ST[-1][0]


def foot_weights(side):
    return lambda co: interp_w(co.y, [(0.08, {f"foot.{side}": 1.0}),
                                      (0.11, {f"foot.{side}": 0.5, f"toe.{side}": 0.5}),
                                      (0.14, {f"toe.{side}": 1.0})])


def _station_param(i):
    return (SHOE_ST[i][0] - SHOE_F0) / (SHOE_F1 - SHOE_F0)


def upper_section(hw, zt, zu):
    return [(-hw + 0.004, zt - 0.008), (-hw, zt + 0.022), (-hw * 0.9, zu - 0.03), (-hw * 0.45, zu),
            (hw * 0.45, zu), (hw * 0.9, zu - 0.03), (hw, zt + 0.022), (hw - 0.004, zt - 0.008)]


def sole_section(hw, zb, zt):
    return [(-hw - 0.004, zt), (-hw - 0.006, zb + 0.016), (-hw + 0.004, zb), (hw - 0.004, zb),
            (hw + 0.006, zb + 0.016), (hw + 0.004, zt)]


def build_shoe(md, side, sx):
    cx = 0.09 * sx
    wf = foot_weights(side)
    up_rings, so_rings = [], []
    for f, hw, zb, zt, zu, xs in SHOE_ST:
        c = cx + xs * sx
        up_rings.append([V(c + o * sx, f, z) for o, z in upper_section(hw, zt, zu)])
        so_rings.append([V(c + o * sx, f, z) for o, z in sole_section(hw, zb, zt)])

    def up_uv(i, j):
        return (j / UPPER_N, SHOE_V0 + (SHOE_V1 - SHOE_V0) * _station_param(i))

    def so_uv(i, j):
        return (j / SOLE_N, SOLE_V0 + (SOLE_V1 - SOLE_V0) * _station_param(i))

    hf = SHOE_ST[0]
    heel_tip = V(cx, hf[0] - 0.006, (hf[3] + hf[4]) / 2)
    toe_tip = V(cx, SHOE_ST[-1][0] + 0.008, SHOE_ST[-1][3] + 0.004)
    loft(md, up_rings, SHOE, wf, up_uv, cap0=heel_tip, cap1=toe_tip,
         cap_uv=((3.5 / UPPER_N, SHOE_V0), (3.5 / UPPER_N, SHOE_V1)))
    sb0 = V(cx, SHOE_ST[0][0] - 0.005, (SHOE_ST[0][2] + SHOE_ST[0][3]) / 2)
    sb1 = V(cx, SHOE_ST[-1][0] + 0.007, (SHOE_ST[-1][2] + SHOE_ST[-1][3]) / 2)
    loft(md, so_rings, SOLE, wf, so_uv, cap0=sb0, cap1=sb1,
         cap_uv=((2.5 / SOLE_N, SOLE_V0), (2.5 / SOLE_N, SOLE_V1)))


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
def build_meshdata(sleeve_uv, weight=0.0):
    global WT
    WT = weight
    try:
        md = MeshData()
        build_torso(md, sleeve_uv)
        build_pelvis(md)
        for side, sx in (("L", 1), ("R", -1)):
            build_leg(md, side, sx)
            build_arm(md, side, sx, sleeve_uv)
            build_hand(md, side, sx)
            build_shoe(md, side, sx)
    finally:
        WT = 0.0
    return md


def to_mesh(md, name, mats, torso_uv):
    """Create the Blender mesh object (Blender space = (x, -f, z))."""
    me = bpy.data.meshes.new(name + "Mesh")
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    verts = [bm.verts.new((c.x, -c.y, c.z)) for c in md.co]
    bm.verts.index_update()
    for vids, uvs, mat in md.faces:
        # rig frame -> Blender flips handedness (f -> -y): reverse the winding
        vids, uvs = vids[::-1], uvs[::-1]
        try:
            f = bm.faces.new([verts[k] for k in vids])
        except ValueError:
            continue  # duplicate (degenerate) face
        f.material_index = mat
        f.normal_update()
        if mat == BODY and uvs[0] is None:
            for lp in f.loops:
                lp[uvl].uv = torso_uv(lp.vert.co, f.normal)
        else:
            for lp, (u, v) in zip(f.loops, uvs):
                lp[uvl].uv = (u, 1.0 - v)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(FLAT_ANGLE))
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    return ob


def add_shape_keys(ob, morphs):
    """morphs: {name: MeshData with identical topology} -> shape keys (glTF morph targets)."""
    ob.shape_key_add(name="Basis", from_mix=False)
    for name, md in morphs.items():
        assert len(md.co) == len(ob.data.vertices), name
        sk = ob.shape_key_add(name=name, from_mix=False)
        flat = []
        for c in md.co:
            flat += (c.x, -c.y, c.z)
        sk.data.foreach_set("co", flat)
        sk.value = 0.0


def apply_weights(ob, md, deform_bones):
    groups = {b: ob.vertex_groups.new(name=b) for b in deform_bones}
    for vi, w in enumerate(md.w):
        tot = sum(v for v in w.values() if v > 1e-4)
        for b, val in w.items():
            if val > 1e-4:
                groups[b].add([vi], val / tot, "REPLACE")
