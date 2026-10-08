"""Noun body mesh + NounRig armature.

Blender space: character faces -Y, +X is the character's LEFT, Z up, feet
origin at (0,0,0). The glTF exporter (+Y up) maps Blender (x, y, z) to
three.js (x, z, -y), so in three.js the character faces +Z, left = +X.
"""
from __future__ import annotations

import bpy  # noqa: F401  (must be imported before bmesh)
import bmesh
import numpy as np
from mathutils import Vector

import common as C

# ---------------------------------------------------------------------------
# Skeleton (Blender armature space). name: (head, tail, parent, deform)
# ---------------------------------------------------------------------------
NECK_TOP_Z = 1.15
BONES = {
    "root": ((0, 0, 0), (0, 0, 0.15), None, False),
    "board": ((0, 0, 0), (0, -0.30, 0), "root", False),
    "hips": ((0, 0, 0.56), (0, 0, 0.68), "root", True),
    "spine": ((0, 0, 0.68), (0, 0, 0.86), "hips", True),
    "chest": ((0, 0, 0.86), (0, 0, 1.04), "spine", True),
    "neck": ((0, 0, 1.04), (0, 0, NECK_TOP_Z), "chest", True),
    "head": ((0, 0, NECK_TOP_Z), (0, 0, NECK_TOP_Z + 0.30), "neck", True),
}
_SIDE = {
    "shoulder": ((0.05, 0, 1.0), (0.27, 0, 1.0), "chest"),
    "upperarm": ((0.27, 0, 1.0), (0.27, 0, 0.775), "shoulder"),
    "forearm": ((0.27, 0, 0.775), (0.27, 0, 0.585), "upperarm"),
    "hand": ((0.27, 0, 0.585), (0.27, 0, 0.47), "forearm"),
    "thigh": ((0.09, 0, 0.52), (0.09, 0, 0.30), "hips"),
    "shin": ((0.09, 0, 0.30), (0.09, 0, 0.085), "thigh"),
    "foot": ((0.09, 0, 0.085), (0.09, -0.10, 0.028), "shin"),
    "toe": ((0.09, -0.10, 0.028), (0.09, -0.19, 0.028), "foot"),
}
for side, sx in (("L", 1), ("R", -1)):
    for nm, (h, t, par) in _SIDE.items():
        parent = par if par in ("chest", "hips") else f"{par}.{side}"
        BONES[f"{nm}.{side}"] = ((h[0] * sx, h[1], h[2]), (t[0] * sx, t[1], t[2]), parent, True)

BONE_ORDER = list(BONES.keys())

# ---------------------------------------------------------------------------
# NounBody texture atlas (image space: u right, v DOWN from the top-left,
# i.e. the glTF / three.js / canvas convention). 512px canvas = 16 px per
# Nouns pixel; torso front is 14 x 14 Nouns pixels (0.42 m, 0.03 m / px).
# ---------------------------------------------------------------------------
TORSO = dict(x=0.21, y=0.12, z0=0.64, z1=1.06)
UV_REGIONS = {
    "front": (0.0, 0.0, 0.4375, 0.4375),
    "back": (0.5, 0.0, 0.9375, 0.4375),
    "left": (0.0, 0.5, 0.25, 0.9375),    # character's left side (+X in three.js)
    "right": (0.25, 0.5, 0.5, 0.9375),   # character's right side (-X)
    "top": (0.5, 0.5, 0.9375, 0.75),     # shoulders/top of torso
    "sleeves": (0.5, 0.78125, 1.0, 1.0),  # arms, torso underside (overlapping islands: flat fill)
}

MAT_NAMES = ["NounBody", "NounSkin", "NounPants", "NounShoe", "NounSole"]
BODY, SKIN, PANTS, SHOE, SOLE = range(5)


def _img_to_bl(u, v):
    """image-space (v down) -> Blender UV (v up)."""
    return (u, 1.0 - v)


def _rect_uv(region, a, b):
    """a, b in 0..1 within region (a -> u, b -> v downwards)."""
    u0, v0, u1, v1 = UV_REGIONS[region]
    return _img_to_bl(u0 + (u1 - u0) * a, v0 + (v1 - v0) * b)


def torso_uv(co, normal):
    X, Y, z0, z1 = TORSO["x"], TORSO["y"], TORSO["z0"], TORSO["z1"]
    ax = max(range(3), key=lambda i: abs(normal[i]))
    hgt = (z1 - co.z) / (z1 - z0)
    if ax == 1 and normal.y < 0:   # front (-Y): viewer's left = character's right (-X)
        return _rect_uv("front", (co.x + X) / (2 * X), hgt)
    if ax == 1:                    # back: viewer's left = character's left (+X)
        return _rect_uv("back", (X - co.x) / (2 * X), hgt)
    if ax == 0 and normal.x > 0:   # left side seen from +X: viewer's left = front (-Y)
        return _rect_uv("left", (co.y + Y) / (2 * Y), hgt)
    if ax == 0:                    # right side seen from -X: viewer's left = back (+Y)
        return _rect_uv("right", (Y - co.y) / (2 * Y), hgt)
    if normal.z > 0:               # top, seen from above with the back at the image top
        return _rect_uv("top", (co.x + X) / (2 * X), (Y - co.y) / (2 * Y))
    return _rect_uv("sleeves", (co.x + X) / (2 * X), (co.y + Y) / (2 * Y))


def _interp_weights(z, table):
    """table: list of (z, {bone: w}) sorted by z; linear blend."""
    if z <= table[0][0]:
        return dict(table[0][1])
    for (za, wa), (zb, wb) in zip(table, table[1:]):
        if z <= zb:
            t = (z - za) / (zb - za)
            out = {}
            for k in set(wa) | set(wb):
                out[k] = wa.get(k, 0) * (1 - t) + wb.get(k, 0) * t
            return out
    return dict(table[-1][1])


TORSO_W = [
    (0.645, {"hips": 0.65, "spine": 0.35}),
    (0.70, {"hips": 0.3, "spine": 0.7}),
    (0.78, {"spine": 1.0}),
    (0.86, {"spine": 0.5, "chest": 0.5}),
    (0.95, {"chest": 1.0}),
]


class Part:
    def __init__(self, name, mat, xs, ys, zs, weights, bevel=0.018, segs=2, deform=None, uv="box"):
        self.name, self.mat, self.xs, self.ys, self.zs = name, mat, xs, ys, zs
        self.weights, self.bevel, self.segs, self.deform, self.uv = weights, bevel, segs, deform, uv


def body_parts():
    T = TORSO
    parts = [
        Part("torso", BODY, [-T["x"], -0.07, 0.07, T["x"]], [-T["y"], T["y"]],
             [T["z0"], 0.70, 0.78, 0.86, 0.95, T["z1"]],
             lambda co: _torso_weights(co), bevel=0.022, uv="torso"),
        Part("pelvis", PANTS, [-0.19, 0.19], [-0.11, 0.11], [0.45, 0.67], lambda co: {"hips": 1.0}, bevel=0.02),
        Part("neck", SKIN, [-0.075, 0.075], [-0.065, 0.065], [1.02, 1.09, NECK_TOP_Z + 0.005],
             lambda co: _interp_weights(co.z, [(1.045, {"chest": 0.5, "neck": 0.5}), (1.09, {"neck": 1.0})]),
             bevel=0.015),
    ]
    for side, sx in (("L", 1), ("R", -1)):
        def X(a, b, sx=sx):
            return sorted([a * sx, b * sx])
        parts += [
            Part(f"upperarm.{side}", BODY, X(0.215, 0.325), [-0.055, 0.055], [0.75, 0.90, 1.045],
                 lambda co, s=side: _interp_weights(co.z, [(1.0, {f"upperarm.{s}": 1.0}),
                                                          (1.045, {f"upperarm.{s}": 0.8, f"shoulder.{s}": 0.2})]),
                 bevel=0.018, uv="sleeve"),
            Part(f"forearm.{side}", BODY, X(0.22, 0.32), [-0.05, 0.05], [0.585, 0.70, 0.80],
                 lambda co, s=side: {f"forearm.{s}": 1.0}, bevel=0.016, uv="sleeve"),
            Part(f"hand.{side}", SKIN, X(0.228, 0.312), [-0.05, 0.045], [0.465, 0.60],
                 lambda co, s=side: {f"hand.{s}": 1.0}, bevel=0.016),
            Part(f"thumb.{side}", SKIN, X(0.236, 0.268), [-0.078, -0.03], [0.50, 0.565],
                 lambda co, s=side: {f"hand.{s}": 1.0}, bevel=0.01, segs=1),
            Part(f"thigh.{side}", PANTS, X(0.02, 0.16), [-0.075, 0.075], [0.265, 0.40, 0.555],
                 lambda co, s=side: {f"thigh.{s}": 1.0}, bevel=0.02),
            Part(f"shin.{side}", PANTS, X(0.0275, 0.1525), [-0.068, 0.068], [0.09, 0.20, 0.33],
                 lambda co, s=side: {f"shin.{s}": 1.0}, bevel=0.018),
            Part(f"shoe.{side}", SHOE, X(0.025, 0.155), [-0.185, -0.13, -0.10, -0.07, 0.0, 0.075], [0.026, 0.12],
                 lambda co, s=side: _foot_weights(co, s), bevel=0.016, deform=_shoe_deform),
            Part(f"sole.{side}", SOLE, X(0.019, 0.161), [-0.193, -0.13, -0.10, -0.07, 0.0, 0.082], [0.0, 0.03],
                 lambda co, s=side: _foot_weights(co, s), bevel=0.007, segs=1),
            Part(f"tongue.{side}", SHOE, X(0.05, 0.13), [-0.06, 0.02], [0.10, 0.135],
                 lambda co, s=side: {f"foot.{s}": 1.0}, bevel=0.008, segs=1),
        ]
    return parts


def _torso_weights(co):
    w = _interp_weights(co.z, TORSO_W)
    if co.z > 0.98 and abs(co.x) > 0.15:
        side = "L" if co.x > 0 else "R"
        k = min(1.0, (abs(co.x) - 0.15) / 0.06) * min(1.0, (co.z - 0.98) / 0.06) * 0.3
        w = {b: v * (1 - k) for b, v in w.items()}
        w[f"shoulder.{side}"] = w.get(f"shoulder.{side}", 0) + k
    return w


def _foot_weights(co, side):
    return _interp_weights(-co.y, [(0.07, {f"foot.{side}": 1.0}), (0.10, {f"foot.{side}": 0.5, f"toe.{side}": 0.5}),
                                   (0.13, {f"toe.{side}": 1.0})])


def _shoe_deform(co, idx, n):
    if idx[2] == n[2] - 1:  # top row: lower toward the toe (sneaker toe box)
        f = -co.y
        if f > 0.0:
            co.z = 0.12 - min(1.0, f / 0.13) * 0.045
            if f > 0.13:
                co.z -= (f - 0.13) / 0.055 * 0.012
    return co


# ---------------------------------------------------------------------------
def default_body_texture(body_hex="#5a65fa", accessory="accessory-txt-noun-multicolor"):
    S = 512
    img = np.zeros((S, S, 4), np.uint8)
    body = [int(c * 255) for c in C.hex_rgb(body_hex)]
    img[..., :3] = body
    img[..., 3] = 255
    acc = C.noun_part(accessory)
    # sprite region cols 9..22, rows 21..31 -> front rect at 16 canvas px / noun px
    region = acc[21:32, 9:23]
    C.blit(img, region, 0, 0, scale=16)
    return img


def build_body(mats, tex_rgba=None):
    me = bpy.data.meshes.new("NounBodyMesh")
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    part_layer = bm.faces.layers.int.new("part")
    parts = body_parts()
    for pi, part in enumerate(parts):
        faces = C.grid_box(bm, part.xs, part.ys, part.zs, deform=part.deform)
        for f in faces:
            f.material_index = part.mat
            f[part_layer] = pi
        if part.bevel > 0:
            faces = C.bevel_sharp(bm, faces, part.bevel, segments=part.segs)
        for f in faces:
            f.material_index = part.mat
            f[part_layer] = pi
    bm.normal_update()
    # UVs
    for f in bm.faces:
        part = parts[f[part_layer]]
        n = f.normal
        for lp in f.loops:
            co = lp.vert.co
            if part.uv == "torso":
                lp[uvl].uv = torso_uv(co, n)
            elif part.uv == "sleeve":
                bx = (min(part.xs), max(part.xs))
                ax = max(range(3), key=lambda i: abs(n[i]))
                a = (co.y + 0.06) / 0.12 if ax == 0 else (co.x - bx[0]) / (bx[1] - bx[0])
                b = (1.06 - co.z) / 0.62 if ax != 2 else (co.y + 0.06) / 0.12
                lp[uvl].uv = _rect_uv("sleeves", min(max(a, 0), 1) * 0.9 + 0.05, min(max(b, 0), 1) * 0.9 + 0.05)
            else:
                ax = max(range(3), key=lambda i: abs(n[i]))
                pa = [c for i, c in enumerate(co) if i != ax]
                lp[uvl].uv = (pa[0] * 2 + 0.5, pa[1] * 2 + 0.5)
    # vertex weights
    bm.verts.index_update()
    vweights = {}
    for v in bm.verts:
        part = parts[min(lf[part_layer] for lf in v.link_faces)]
        vweights[v.index] = part.weights(v.co)
    C.finalize_mesh(bm, me, smooth_angle_deg=35)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new("NounBody", me)
    C.link(ob)
    groups = {}
    for b, (_, _, _, deform) in BONES.items():
        if deform:
            groups[b] = ob.vertex_groups.new(name=b)
    for vi, w in vweights.items():
        tot = sum(w.values())
        for b, val in w.items():
            if val > 1e-4:
                groups[b].add([vi], val / tot, "REPLACE")
    return ob


def build_armature():
    arm = bpy.data.armatures.new("NounRigData")
    ob = bpy.data.objects.new("NounRig", arm)
    C.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in BONE_ORDER:
        h, t, par, deform = BONES[name]
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = Vector(h), Vector(t)
        eb.roll = 0.0
        eb.use_deform = deform
        if par:
            eb.parent = arm.edit_bones[par]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def build_character():
    tex = C.save_png("noun_body_default", default_body_texture())
    mats = [
        C.make_material("NounBody", (1, 1, 1), roughness=0.85, image=tex),
        C.make_material("NounSkin", C.hex_rgb("#e3b48f"), roughness=0.7),
        C.make_material("NounPants", C.hex_rgb("#2e3d5c"), roughness=0.9),
        C.make_material("NounShoe", C.hex_rgb("#e8473a"), roughness=0.75),
        C.make_material("NounSole", C.hex_rgb("#f4f1e8"), roughness=0.8),
    ]
    rig = build_armature()
    body = build_body(mats)
    body.parent = rig
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return rig, body, mats
