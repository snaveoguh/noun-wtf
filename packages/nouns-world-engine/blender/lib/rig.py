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
import paint as PT
import sculpt as SC

SKIN_HEX = "#e3b48f"
MORPHS = {"weight_thin": -1.0, "weight_heavy": 1.0}

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
TORSO = dict(x=0.21, y=0.13, z0=0.64, z1=1.06)
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


def sleeve_uv(a, b):
    """Arm sleeves -> the 'sleeves' rect (overlapping islands, runtime fills flat)."""
    return _rect_uv_img("sleeves", 0.05 + 0.9 * min(max(a, 0), 1), 0.05 + 0.9 * min(max(b, 0), 1))


def _rect_uv_img(region, a, b):
    u0, v0, u1, v1 = UV_REGIONS[region]
    return (u0 + (u1 - u0) * a, v0 + (v1 - v0) * b)


def build_body(mats):
    md = SC.build_meshdata(sleeve_uv, 0.0)
    ob = SC.to_mesh(md, "NounBody", mats, torso_uv)
    SC.apply_weights(ob, md, [b for b, v in BONES.items() if v[3]])
    SC.add_shape_keys(ob, {name: SC.build_meshdata(sleeve_uv, w) for name, w in MORPHS.items()})
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
    tex_body = C.save_png("noun_body_default", PT.body_texture())
    tex_pants = C.save_png("noun_pants", PT.pants_texture(256))
    tex_shoe = C.save_png("noun_shoe", PT.shoe_texture(256))
    mats = [
        C.make_material("NounBody", (1, 1, 1), roughness=0.9, image=tex_body),
        C.make_material("NounSkin", C.hex_rgb(SKIN_HEX), roughness=0.8),
        C.make_material("NounPants", (1, 1, 1), roughness=0.92, image=tex_pants),
        C.make_material("NounShoe", (1, 1, 1), roughness=0.85, image=tex_shoe),
        C.make_material("NounSole", (1, 1, 1), roughness=0.9, image=tex_shoe),
    ]
    rig = build_armature()
    body = build_body(mats)
    body.parent = rig
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return rig, body, mats
