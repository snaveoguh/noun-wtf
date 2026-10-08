"""Noun head base: a big, slightly chamfered low-poly box the runtime paints a
2D Noun head image onto. Exports noun_head_base.glb.

Run:  <blender-python> packages/nouns-world-engine/blender/build_head.py [--texture debug.png]

Contract (also written to character_manifest.json -> headUv / headModel):
  * 1.10 m wide (X), 1.00 m tall (Y), 0.85 m deep (Z) in three.js (Nouns proportions:
    about as tall as the whole body below it); origin at
    the bottom centre; faces +Z.
  * one mesh "NounHead", one material "NounHead" (base colour map = the
    painted head canvas; flipY = false like every glTF texture).
  * UV rects [u0, v0, u1, v1] in glTF convention (v = 0 at the TOP of the
    image), see HEAD_UV below. Each face is an orthographic projection of the
    whole box face (including its rounded edge), so a canvas painted per rect
    wraps continuously over the chamfers.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402

import common as C  # noqa: E402

W, H, D = 1.10, 1.00, 0.85
BEVEL, BEVEL_SEGS = 0.07, 1     # one chamfer: crisp planes for toon shading + outlines
HEAD_UV = {
    "front": [0.0, 0.0, 0.5, 0.5],
    "left": [0.5, 0.0, 0.75, 0.5],
    "right": [0.75, 0.0, 1.0, 0.5],
    "top": [0.0, 0.5, 0.5, 1.0],
    "back": [0.5, 0.5, 1.0, 1.0],
    "bottom": [0.24, 0.49, 0.26, 0.5],
}
HEAD_UV_NOTES = {
    "convention": "glTF / three.js UVs (texture.flipY = false): canvas pixel = (u * width, v * height), "
                  "v = 0 at the TOP row. Rects are [u0, v0, u1, v1] (u0, v0 = top-left).",
    "front": "face toward +Z, NOT mirrored: image left = the character's right (-X), image top = top of "
             "the head. 1.10 x 1.00 m -> paint the Noun's head sprite here (glasses included).",
    "left": "character's left side (+X), image left = front. 0.85 x 1.00 m.",
    "right": "character's right side (-X), image left = back. 0.85 x 1.00 m.",
    "top": "seen from above, image top = back of the head, image left = character's right. 1.10 x 0.85 m.",
    "back": "seen from behind, image left = character's left (+X). 1.10 x 1.00 m.",
    "bottom": "bottom face (sits on the neck) samples a tiny strip at the bottom-centre of the front rect.",
    "bevels": "each chamfer belongs to the nearer box face and is projected with that face's rect, so "
              "a rect's outer ~0.07 m wraps around the edge.",
}


def _uv_for(co, n):
    ax = max(range(3), key=lambda i: abs(n[i]))
    x, y, z = co
    hz = (H - z) / H
    if ax == 1 and n.y < 0:                       # front (-Y in Blender = +Z three.js)
        r, a, b = "front", (x + W / 2) / W, hz
    elif ax == 1:
        r, a, b = "back", (W / 2 - x) / W, hz
    elif ax == 0 and n.x > 0:
        r, a, b = "left", (y + D / 2) / D, hz
    elif ax == 0:
        r, a, b = "right", (D / 2 - y) / D, hz
    elif n.z > 0:
        r, a, b = "top", (x + W / 2) / W, (D / 2 - y) / D
    else:
        r, a, b = "bottom", 0.5, 0.5
    u0, v0, u1, v1 = HEAD_UV[r]
    a, b = min(max(a, 0.0), 1.0), min(max(b, 0.0), 1.0)
    return (u0 + (u1 - u0) * a, 1.0 - (v0 + (v1 - v0) * b))   # Blender UV (v up)


def build_mesh(mat):
    me = bpy.data.meshes.new("NounHeadMesh")
    bm = bmesh.new()
    # split the big faces once so vertex lighting / shadows have something to work with
    xs = [-W / 2, -W / 6, W / 6, W / 2]
    ys = [-D / 2, 0.0, D / 2]
    zs = [0.0, H / 2, H]
    faces = C.grid_box(bm, xs, ys, zs)
    faces = C.bevel_sharp(bm, faces, BEVEL, segments=BEVEL_SEGS, angle_deg=60)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.normal_update()
        for lp in f.loops:
            lp[uvl].uv = _uv_for(lp.vert.co, f.normal)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=0.5)   # ~29 deg: flat faces + hard 45 deg chamfers
    me.materials.append(mat)
    ob = bpy.data.objects.new("NounHead", me)
    C.link(ob)
    return ob


def default_texture(head="head-crt-bsod", glasses="glasses-square-red", size=512):
    """Reference painter (what the runtime is expected to do with a Noun seed):
    head sprite bbox -> front rect, glasses on top; sides/top/back extrude the
    sprite's edge pixels so the silhouette colours wrap around the box."""
    hd = C.noun_part(head)
    gl = C.noun_part(glasses)
    nz = np.argwhere(hd[..., 3] > 0)
    r0, c0 = nz.min(0)
    r1, c1 = nz.max(0) + 1
    vals = hd[hd[..., 3] > 0][:, :3]
    cols, counts = np.unique(vals, axis=0, return_counts=True)
    dom = cols[counts.argmax()]
    sprite = np.zeros((32, 32, 4), np.uint8)
    sprite[...] = (*dom, 255)
    C.blit(sprite, hd, 0, 0)
    C.blit(sprite, gl, 0, 0)
    crop = sprite[r0:r1, c0:c1]
    ch, cw = crop.shape[:2]
    img = np.zeros((size, size, 4), np.uint8)
    img[...] = (*dom, 255)

    def put(rect, src):
        u0, v0, u1, v1 = rect
        x0, y0, x1, y1 = int(u0 * size), int(v0 * size), int(u1 * size), int(v1 * size)
        hh, ww = y1 - y0, x1 - x0
        ry = (np.arange(hh) * src.shape[0] // hh)
        rx = (np.arange(ww) * src.shape[1] // ww)
        img[y0:y1, x0:x1] = src[ry][:, rx]

    put(HEAD_UV["front"], crop)
    # character's left (+X) = image right column of the front; extrude it with a little shading
    put(HEAD_UV["left"], np.repeat(crop[:, -1:], 4, axis=1))
    put(HEAD_UV["right"], np.repeat(crop[:, :1], 4, axis=1))
    put(HEAD_UV["top"], np.repeat(crop[:1], 4, axis=0))
    put(HEAD_UV["back"], np.array([[[*dom, 255]]], np.uint8))
    return img


def build(texture=None):
    C.reset_scene()
    if texture:
        img = bpy.data.images.load(str(texture))
        img.pack()
    else:
        img = C.save_png("noun_head_default", default_texture())
    mat = C.make_material("NounHead", (1, 1, 1), roughness=0.6, image=img)
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    tex.interpolation = "Closest"
    ob = build_mesh(mat)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f"[head] triangles: {tris}")
    return ob, tris


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", export_yup=True, export_apply=True,
        export_animations=False, export_skins=False, export_morph=False, export_lights=False,
        export_cameras=False, export_draco_mesh_compression_enable=False, export_image_format="AUTO",
        export_vertex_color="NONE",
    )
    print(f"[head] wrote {path} ({Path(path).stat().st_size} bytes)")


def head_info(tris):
    return {
        "file": "noun_head_base.glb",
        "mesh": "NounHead",
        "material": "NounHead",
        "size": {"width": W, "height": H, "depth": D},
        "origin": "bottom centre; faces +Z; +Y up",
        "chamfer": BEVEL,
        "triangles": tris,
        "canvasSize": 512,
        "defaultTexture": "head-crt-bsod + glasses-square-red (reference painter: build_head.default_texture)",
    }


if __name__ == "__main__":
    tex = sys.argv[sys.argv.index("--texture") + 1] if "--texture" in sys.argv else None
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else C.OUT_DIR / "noun_head_base.glb"
    ob, tris = build(tex)
    export(out)
