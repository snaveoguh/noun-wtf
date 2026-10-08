"""Shared helpers for the Nouns World v2 Blender pipeline.

Everything here is deterministic: no randomness without a fixed seed, no
reliance on UI context. Import from scripts run with Blender's Python
(`bpy` module build).
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from pathlib import Path

import bpy  # must be imported before bmesh in the bpy module build
import bmesh
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
REPO_ROOT = BLENDER_DIR.parents[2]
OUT_DIR = REPO_ROOT / "packages" / "nouns-webapp" / "public" / "world2"
ASSETS_JSON = REPO_ROOT / "packages" / "nouns-assets" / "src" / "image-data.json"
TEX_DIR = Path(tempfile.gettempdir()) / "nouns_world2_textures"
PREVIEW_DIR = Path(os.environ.get("NOUNS_PREVIEW_DIR", "/tmp/claude-0/previews"))

FPS = 30


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = FPS
    scn.render.fps_base = 1.0
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0
    return scn


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


# --------------------------------------------------------------------------
# Colors / images
# --------------------------------------------------------------------------
def hex_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def save_png(name: str, rgba_u8_top_first: np.ndarray) -> bpy.types.Image:
    """Create a packed Blender image from an (H, W, 4) uint8 array whose first
    row is the TOP of the image (canvas / glTF convention)."""
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    arr = np.ascontiguousarray(rgba_u8_top_first, dtype=np.uint8)
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    # Blender stores rows bottom-up.
    flt = arr[::-1].astype(np.float32) / 255.0
    img.pixels.foreach_set(flt.ravel())
    path = TEX_DIR / f"{name}.png"
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    img.reload()
    img.pack()
    img.colorspace_settings.name = "sRGB"
    return img


# --------------------------------------------------------------------------
# Nouns pixel art (decoded from the canonical RLE in nouns-assets)
# --------------------------------------------------------------------------
_IMAGE_DATA = None


def image_data():
    global _IMAGE_DATA
    if _IMAGE_DATA is None:
        _IMAGE_DATA = json.loads(ASSETS_JSON.read_text())
    return _IMAGE_DATA


def noun_part(filename: str) -> np.ndarray:
    """Decode a Nouns RLE part into a (32, 32, 4) uint8 RGBA array (row 0 = top)."""
    d = image_data()
    pal = d["palette"]
    entry = None
    for group in d["images"].values():
        for e in group:
            if e["filename"] == filename:
                entry = e
    if entry is None:
        raise KeyError(filename)
    s = entry["data"][2:]
    top, right, bottom, left = (int(s[i:i + 2], 16) for i in (2, 4, 6, 8))
    out = np.zeros((32, 32, 4), np.uint8)
    x, y = left, top
    rects = s[10:]
    for k in range(0, len(rects), 4):
        length = int(rects[k:k + 2], 16)
        ci = int(rects[k + 2:k + 4], 16)
        while length > 0:
            n = min(length, right - x)
            if ci != 0:
                col = pal[ci]
                rgb = [int(col[i:i + 2], 16) for i in (0, 2, 4)]
                out[y, x:x + n, :3] = rgb
                out[y, x:x + n, 3] = 255
            x += n
            length -= n
            if x == right:
                x = left
                y += 1
    return out


def blit(dst: np.ndarray, src: np.ndarray, x0: int, y0: int, scale: int = 1):
    """Alpha-blit src (h,w,4 uint8) into dst at (x0,y0) with nearest scaling."""
    if scale != 1:
        src = np.repeat(np.repeat(src, scale, axis=0), scale, axis=1)
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    xs0, ys0 = max(0, -x0), max(0, -y0)
    xs1, ys1 = min(w, W - x0), min(h, H - y0)
    if xs1 <= xs0 or ys1 <= ys0:
        return
    s = src[ys0:ys1, xs0:xs1].astype(np.float32)
    d = dst[y0 + ys0:y0 + ys1, x0 + xs0:x0 + xs1].astype(np.float32)
    a = s[..., 3:4] / 255.0
    d[..., :3] = s[..., :3] * a + d[..., :3] * (1 - a)
    d[..., 3:4] = np.maximum(d[..., 3:4], s[..., 3:4])
    dst[y0 + ys0:y0 + ys1, x0 + xs0:x0 + xs1] = d.astype(np.uint8)


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
def make_material(name, color=(0.8, 0.8, 0.8), roughness=0.8, metallic=0.0,
                  image: bpy.types.Image | None = None, emission=None, tint=False):
    """With an image, `color` only feeds the viewport colour unless tint=True,
    which multiplies the map by `color` (exported as glTF baseColorFactor)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    lin = srgb_to_linear(color)
    bsdf.inputs["Base Color"].default_value = (lin[0], lin[1], lin[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest" if image.size[0] <= 64 else "Linear"
        tex.location = (-400, 200)
        if tint and any(abs(x - 1.0) > 1e-4 for x in lin):
            # texture x colour factor (exported as baseColorFactor, tintable at runtime)
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            mix.location = (-200, 200)
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = (lin[0], lin[1], lin[2], 1.0)
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.diffuse_color = (lin[0], lin[1], lin[2], 1.0)  # workbench preview colour
    return mat


def set_material_image(mat, image):
    nt = mat.node_tree
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
    if tex is None:
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = nt.nodes.new("ShaderNodeTexImage")
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    tex.image = image


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------
def grid_box(bm, xs, ys, zs, deform=None):
    """Add the SURFACE of an axis-aligned box subdivided at the given sorted
    coordinate lists to `bm`. Returns the list of new faces. `deform(v)` may
    move vertices (receives/returns a Vector)."""
    vmap = {}

    def vert(i, j, k):
        key = (i, j, k)
        if key not in vmap:
            co = Vector((xs[i], ys[j], zs[k]))
            if deform:
                co = deform(co, (i, j, k), (len(xs), len(ys), len(zs)))
            vmap[key] = bm.verts.new(co)
        return vmap[key]

    nx, ny, nz = len(xs) - 1, len(ys) - 1, len(zs) - 1
    faces = []

    def quad(a, b, c, d):
        faces.append(bm.faces.new((vert(*a), vert(*b), vert(*c), vert(*d))))

    for j in range(ny):
        for k in range(nz):
            quad((0, j, k), (0, j, k + 1), (0, j + 1, k + 1), (0, j + 1, k))      # -X
            quad((nx, j, k), (nx, j + 1, k), (nx, j + 1, k + 1), (nx, j, k + 1))  # +X
    for i in range(nx):
        for k in range(nz):
            quad((i, 0, k), (i + 1, 0, k), (i + 1, 0, k + 1), (i, 0, k + 1))      # -Y
            quad((i, ny, k), (i, ny, k + 1), (i + 1, ny, k + 1), (i + 1, ny, k))  # +Y
    for i in range(nx):
        for j in range(ny):
            quad((i, j, 0), (i, j + 1, 0), (i + 1, j + 1, 0), (i + 1, j, 0))      # -Z
            quad((i, j, nz), (i + 1, j, nz), (i + 1, j + 1, nz), (i, j + 1, nz))  # +Z
    return faces


def bevel_sharp(bm, faces, width, segments=2, angle_deg=50.0):
    """Bevel the sharp (box-corner) edges of the given faces only."""
    fset = set(faces)
    bmesh.ops.recalc_face_normals(bm, faces=list(fset))
    for f in fset:
        f.normal_update()
    edges = set()
    for f in faces:
        for e in f.edges:
            if len(e.link_faces) == 2 and all(lf in fset for lf in e.link_faces):
                if e.calc_face_angle(0.0) > math.radians(angle_deg):
                    edges.add(e)
    if not edges:
        return faces
    res = bmesh.ops.bevel(bm, geom=list(edges), offset=width, offset_type="OFFSET",
                          segments=segments, profile=0.5, affect="EDGES",
                          clamp_overlap=True)
    return [f for f in (fset | set(res["faces"])) if f.is_valid]


def lathe(bm, profile, segments, axis="X", center=(0, 0, 0), cap=False):
    """Revolve a (radius, axial) profile around an axis. Returns faces."""
    cx, cy, cz = center
    rings = []
    for (r, a) in profile:
        ring = []
        for s in range(segments):
            t = 2 * math.pi * s / segments
            c, sn = math.cos(t) * r, math.sin(t) * r
            if axis == "X":
                co = (cx + a, cy + c, cz + sn)
            elif axis == "Y":
                co = (cx + sn, cy + a, cz + c)
            else:
                co = (cx + c, cy + sn, cz + a)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    faces = []
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(segments):
            s1 = (s + 1) % segments
            faces.append(bm.faces.new((r0[s], r0[s1], r1[s1], r1[s])))
    if cap:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
        faces.append(bm.faces.new(rings[-1]))
    return faces


def finalize_mesh(bm, me, smooth_angle_deg=35.0):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(smooth_angle_deg))


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


# --------------------------------------------------------------------------
# Skateboard dimensions shared by the board model and the character rig.
# Rig frame (l, f, u): l = +X (character/board left), f = forward = nose
# direction (= -Y in Blender, +Z in three.js), u = up.
# --------------------------------------------------------------------------
DECK = dict(
    length=0.80,        # nose tip to tail tip (horizontal)
    width=0.21,
    thickness=0.012,
    wheel_radius=0.027,
    wheel_width=0.032,
    deck_bottom=0.088,  # underside of the flat centre section
    kick_start=0.255,   # |f| where nose/tail kick begins
    kick_radius=0.09,
    kick_angle=20.0,    # degrees
    concave=0.006,      # rail height above centre line
    truck_f=0.178,      # |f| of truck axles (wheelbase 0.356)
    wheel_x=0.088,      # |l| of wheel centres
    axle_half=0.104,
)
DECK["deck_top"] = DECK["deck_bottom"] + DECK["thickness"]


def kick_rise(d):
    """Height gained by the kick at distance d beyond kick_start."""
    if d <= 0:
        return 0.0
    R = DECK["kick_radius"]
    th = math.radians(DECK["kick_angle"])
    d0 = R * math.sin(th)
    if d <= d0:
        return R - math.sqrt(R * R - d * d)
    z0 = R - math.sqrt(R * R - d0 * d0)
    return z0 + (d - d0) * math.tan(th)


def kick_slope_deg(d):
    if d <= 0:
        return 0.0
    R = DECK["kick_radius"]
    th = math.radians(DECK["kick_angle"])
    if d <= R * math.sin(th):
        return math.degrees(math.asin(d / R))
    return DECK["kick_angle"]


def deck_top_z(f, l=0.0):
    """Height of the grip surface at rig-frame (f along board, l across)."""
    hw = DECK["width"] / 2
    conc = DECK["concave"] * min(1.0, (l / hw) ** 2)
    return DECK["deck_top"] + kick_rise(abs(f) - DECK["kick_start"]) + conc


def deck_half_width(f):
    L, W = DECK["length"], DECK["width"]
    r = W / 2
    c = L / 2 - r
    a = abs(f)
    if a <= c:
        return W / 2
    t = min(1.0, (a - c) / r)
    # superellipse end (a little squarer than a semicircle, like a real popsicle deck)
    return W / 2 * (1 - t ** 2.2) ** (1 / 2.2)
