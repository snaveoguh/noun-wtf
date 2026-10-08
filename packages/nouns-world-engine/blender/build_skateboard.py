"""Build the Nouns World v2 skateboard and export skateboard.glb.

Run:  <blender-python> packages/nouns-world-engine/blender/build_skateboard.py

Blender axes: X = board left (+X), -Y = nose / forward, Z = up.
Exported glTF (Y-up): +X left, +Z nose, +Y up. Ground contact plane y = 0.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

import bpy  # noqa: E402  (must precede bmesh in the bpy module build)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
from common import DECK  # noqa: E402

AXLE_Z = DECK["wheel_radius"]


# --------------------------------------------------------------------------
# Textures
# --------------------------------------------------------------------------
def grip_texture():
    rng = np.random.default_rng(1337)
    n = 128
    base = np.full((n, n), 34.0)
    base += rng.normal(0, 7, (n, n))
    # coarse grit
    coarse = rng.normal(0, 1, (n // 4, n // 4))
    base += np.kron(coarse, np.ones((4, 4))) * 3
    flecks = rng.random((n, n)) > 0.985
    base[flecks] += 40
    v = np.clip(base, 10, 120).astype(np.uint8)
    img = np.stack([v, v, (v * 1.04).clip(0, 255).astype(np.uint8), np.full_like(v, 255)], -1)
    return C.save_png("grip_noise", img)


def ply_texture():
    plies = ["#e9c58f", "#d9a868", "#e8c48c", "#e94a35", "#e8c48c", "#d9a868",
             "#2f63c9", "#e9c58f"]  # top -> bottom; two dyed Nouns plies
    h = 32
    img = np.zeros((h, 8, 4), np.uint8)
    for y in range(h):
        c = C.hex_rgb(plies[min(len(plies) - 1, y * len(plies) // h)])
        img[y, :, :3] = [int(x * 255) for x in c]
        img[y, :, 3] = 255
    return C.save_png("deck_ply", img)


def deck_graphic_texture():
    W, H = 256, 1024
    img = np.zeros((H, W, 4), np.uint8)
    bg = [int(x * 255) for x in C.hex_rgb("#ffc110")]
    img[..., :3] = bg
    img[..., 3] = 255
    # Nouns-colour stripes toward nose and tail
    stripes = ["#e94a35", "#2f63c9", "#1fb36b", "#fafafa"]
    for i, col in enumerate(stripes):
        c = [int(x * 255) for x in C.hex_rgb(col)]
        img[120 + i * 26:120 + i * 26 + 18, :, :3] = c
        img[H - 138 - i * 26:H - 120 - i * 26, :, :3] = c
    nog = C.noun_part("glasses-square-red")[11:17, 7:23]  # 6 x 16 crop
    # big centred noggles
    C.blit(img, nog, (W - 16 * 15) // 2, H // 2 - 3 * 15, scale=15)
    # small noggles near nose and tail
    C.blit(img, nog, (W - 16 * 6) // 2, 40, scale=6)
    C.blit(img, nog, (W - 16 * 6) // 2, H - 40 - 36, scale=6)
    return C.save_png("deck_graphic_default", img)


# --------------------------------------------------------------------------
# Deck mesh
# --------------------------------------------------------------------------
def deck_f_samples():
    L, W = DECK["length"], DECK["width"]
    r = W / 2
    c = L / 2 - r
    mid = list(np.linspace(-DECK["kick_start"], DECK["kick_start"], 11))
    kick = [0.27, 0.284]
    tips = [c + t * r for t in (0.0, 0.25, 0.45, 0.62, 0.76, 0.87, 0.94, 0.98, 0.997)]
    pos = sorted(set([round(v, 5) for v in mid + kick + [-k for k in kick] + tips + [-t for t in tips]]))
    return pos


def build_deck(mats):
    me = bpy.data.meshes.new("DeckMesh")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    fs = deck_f_samples()
    wn = [-1, -0.94, -0.75, -0.42, 0, 0.42, 0.75, 0.94, 1]
    th = DECK["thickness"]
    L, W = DECK["length"], DECK["width"]

    def top_co(f, w):
        hw = C.deck_half_width(f)
        x = w * hw
        # round the rail slightly: outermost row dips 1.5mm
        z = C.deck_top_z(f, x) - (0.0015 if abs(w) == 1 else 0.0)
        return Vector((x, -f, z))

    def normal_fu(f):
        e = 1e-4
        dz = (C.deck_top_z(f + e) - C.deck_top_z(f - e)) / (2 * e)
        # Blender y = -f, so dz/dy = -dz/df and the surface normal is (0, dz/df, 1)
        n = Vector((0.0, dz, 1.0))
        return n.normalized()

    T = [[None] * len(wn) for _ in fs]
    B = [[None] * len(wn) for _ in fs]
    for i, f in enumerate(fs):
        n = normal_fu(f)
        for j, w in enumerate(wn):
            t = top_co(f, w)
            T[i][j] = bm.verts.new(t)
            b = t - n * th
            if abs(w) == 1:
                b.z += 0.0015
            B[i][j] = bm.verts.new(b)

    def set_uv(face, fn):
        for lp in face.loops:
            lp[uv].uv = fn(lp.vert.co)

    grip_uv = lambda co: (co.x / 0.15 + 0.5, co.y / 0.15)
    # bottom graphic: u across width (-X..+X), glTF v: 0 at nose -> 1 at tail
    graphic_uv = lambda co: ((co.x + W / 2) / W, 1.0 - (co.y + L / 2) / L)

    for i in range(len(fs) - 1):
        for j in range(len(wn) - 1):
            ft = bm.faces.new((T[i][j], T[i][j + 1], T[i + 1][j + 1], T[i + 1][j]))
            ft.material_index = 0
            set_uv(ft, grip_uv)
            fb = bm.faces.new((B[i][j], B[i + 1][j], B[i + 1][j + 1], B[i][j + 1]))
            fb.material_index = 1
            set_uv(fb, graphic_uv)

    # outline loop for the ply walls
    nI, nJ = len(fs), len(wn)
    loop = [(i, 0) for i in range(nI)] + [(nI - 1, j) for j in range(1, nJ)] + \
           [(i, nJ - 1) for i in range(nI - 2, -1, -1)] + [(0, j) for j in range(nJ - 2, 0, -1)]
    acc = 0.0
    prev = None
    for k in range(len(loop)):
        a = loop[k]
        b = loop[(k + 1) % len(loop)]
        ta, tb, ba, bb = T[a[0]][a[1]], T[b[0]][b[1]], B[a[0]][a[1]], B[b[0]][b[1]]
        seg = (tb.co - ta.co).length
        u0, u1 = acc / 0.05, (acc + seg) / 0.05
        acc += seg
        fw = bm.faces.new((ta, ba, bb, tb))
        fw.material_index = 2
        for lp in fw.loops:
            vv = 1.0 if lp.vert in (ta, tb) else 0.0
            uu = u0 if lp.vert in (ta, ba) else u1
            lp[uv].uv = (uu, vv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    C.finalize_mesh(bm, me, smooth_angle_deg=40)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new("Deck", me)
    return ob


# --------------------------------------------------------------------------
# Trucks / wheels
# --------------------------------------------------------------------------
def build_truck(name, f_axle, mats):
    """Truck mesh with its origin on the axle centre."""
    me = bpy.data.meshes.new(name + "Mesh")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    inward = 1.0 if f_axle > 0 else -1.0  # Blender +Y is toward the tail
    # in local coords: Blender y offset toward board centre = +inward * ...
    ybase = inward * 0.006
    top = DECK["deck_bottom"] - AXLE_Z
    # baseplate
    faces = C.grid_box(bm, [-0.033, 0.033], [ybase - 0.032, ybase + 0.032], [top - 0.009, top - 0.0005])
    C.bevel_sharp(bm, faces, 0.003, segments=1)
    # riser-ish pivot block + kingpin boss
    faces = C.grid_box(bm, [-0.014, 0.014], [ybase + inward * 0.004 - 0.012, ybase + inward * 0.004 + 0.012],
                       [0.018, top - 0.008])
    C.bevel_sharp(bm, faces, 0.003, segments=1)
    # hanger: tapered bar
    def taper(co, idx, n):
        i, j, k = idx
        if k == n[2] - 1:  # top row narrower in y and lower toward the ends
            co.y *= 0.7
            co.z -= 0.010 * (abs(co.x) / 0.072) ** 2
        return co
    xs = [-0.072, -0.03, 0.03, 0.072]
    faces = C.grid_box(bm, xs, [-0.011, 0.011], [-0.009, 0.020], deform=taper)
    C.bevel_sharp(bm, faces, 0.004, segments=1)
    # axle (along X) + nuts
    C.lathe(bm, [(0.004, -DECK["axle_half"]), (0.004, DECK["axle_half"])], 8, axis="X", cap=True)
    for sx in (-1, 1):
        a = sx * (DECK["axle_half"] + 0.001)
        C.lathe(bm, [(0.0065, a - 0.003), (0.0065, a + 0.003)], 6, axis="X", cap=True)
    metal_faces = list(bm.faces)
    # bushings (coloured urethane) around the kingpin
    ky = ybase + inward * 0.012
    C.lathe(bm, [(0.0125, 0.020), (0.0135, 0.026), (0.0125, 0.034)], 10, axis="Z", center=(0, ky, 0), cap=True)
    for f in bm.faces:
        f.material_index = 0 if f in set(metal_faces) else 1
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x * 4 + 0.5, lp.vert.co.z * 4 + 0.5)
    C.finalize_mesh(bm, me, smooth_angle_deg=40)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.location = (0, -f_axle, AXLE_Z)
    return ob


def build_wheel(name, x, f, mats):
    me = bpy.data.meshes.new(name + "Mesh")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    R, hwid = DECK["wheel_radius"], DECK["wheel_width"] / 2
    prof = [(0.0115, -hwid + 0.001), (0.0235, -hwid), (R - 0.0008, -hwid + 0.005),
            (R, -0.006), (R, 0.006), (R - 0.0008, hwid - 0.005), (0.0235, hwid), (0.0115, hwid - 0.001)]
    ure = C.lathe(bm, prof, 14, axis="X")
    # bearing shields / core (metal) closing the hole: a short tube with flat faces
    core = C.lathe(bm, [(0.0118, -hwid + 0.0015), (0.0118, hwid - 0.0015)], 10, axis="X", cap=True)
    # flip core normals inward->outward handled by recalc
    for fc in bm.faces:
        fc.material_index = 0 if fc in set(ure) else 1
        for lp in fc.loops:
            lp[uv].uv = (lp.vert.co.y * 10 + 0.5, lp.vert.co.z * 10 + 0.5)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    C.finalize_mesh(bm, me, smooth_angle_deg=50)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.location = (x, -f, AXLE_Z)
    return ob


def build():
    C.reset_scene()
    grip = C.make_material("Grip", (0.13, 0.13, 0.14), roughness=0.95, image=grip_texture())
    graphic = C.make_material("DeckGraphic", (1, 1, 1), roughness=0.55, image=deck_graphic_texture())
    wood = C.make_material("DeckWood", (0.9, 0.75, 0.55), roughness=0.7, image=ply_texture())
    truck = C.make_material("Truck", (0.80, 0.81, 0.84), roughness=0.32, metallic=1.0)
    bushing = C.make_material("Bushing", C.hex_rgb("#e94a35"), roughness=0.6)
    wheel = C.make_material("Wheel", C.hex_rgb("#f3efe2"), roughness=0.55)

    root = C.link(bpy.data.objects.new("Skateboard", None))
    root.empty_display_size = 0.3
    deck = C.link(build_deck([grip, graphic, wood]))
    deck.parent = root
    objs = [deck]
    tf = C.link(build_truck("TruckFront", DECK["truck_f"], [truck, bushing]))
    tb = C.link(build_truck("TruckBack", -DECK["truck_f"], [truck, bushing]))
    for t in (tf, tb):
        t.parent = root
        objs.append(t)
    wx, wf = DECK["wheel_x"], DECK["truck_f"]
    for nm, x, f in (("WheelFL", wx, wf), ("WheelFR", -wx, wf), ("WheelBL", wx, -wf), ("WheelBR", -wx, -wf)):
        w = C.link(build_wheel(nm, x, f, [wheel, truck]))
        w.parent = root
        objs.append(w)
    tris = sum(C.tri_count(o.data) for o in objs)
    print(f"[skateboard] triangles: {tris}")
    return root, tris


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", export_yup=True, export_apply=True,
        export_animations=False, export_lights=False, export_cameras=False,
        export_draco_mesh_compression_enable=False, export_image_format="AUTO",
        export_skins=False, export_morph=False,
    )
    print(f"[skateboard] wrote {path} ({Path(path).stat().st_size} bytes)")


def board_info():
    wx, wf = DECK["wheel_x"], DECK["truck_f"]
    return {
        "file": "skateboard.glb",
        "nodes": ["Skateboard", "Deck", "TruckFront", "TruckBack", "WheelFL", "WheelFR", "WheelBL", "WheelBR"],
        "frame": "three.js: +Z = nose (forward), +X = board left (toe side for a regular rider is -X), +Y up; "
                 "y = 0 is the wheel/ground contact plane; Skateboard origin = board centre on the ground.",
        "deckLength": DECK["length"],
        "deckWidth": DECK["width"],
        "deckThickness": DECK["thickness"],
        "deckTopHeight": round(DECK["deck_top"], 4),
        "deckTopHeightAtRails": round(DECK["deck_top"] + DECK["concave"], 4),
        "noseZ": DECK["length"] / 2,
        "tailZ": -DECK["length"] / 2,
        "kickStartAbsZ": DECK["kick_start"],
        "kickAngleDeg": DECK["kick_angle"],
        "noseTailTipHeight": round(C.deck_top_z(0.3995), 4),
        "trucks": {"TruckFront": [0, AXLE_Z, wf], "TruckBack": [0, AXLE_Z, -wf],
                   "pivot": "node origin = axle centre"},
        "wheels": {
            "radius": DECK["wheel_radius"], "width": DECK["wheel_width"],
            "WheelFL": [wx, AXLE_Z, wf], "WheelFR": [-wx, AXLE_Z, wf],
            "WheelBL": [wx, AXLE_Z, -wf], "WheelBR": [-wx, AXLE_Z, -wf],
            "axleAxis": [1, 0, 0],
            "spin": "rolling toward +Z (nose first) at speed v: wheel.rotation.x += (v / radius) * dt",
        },
        "materials": ["Grip", "DeckGraphic", "DeckWood", "Truck", "Bushing", "Wheel"],
        "deckGraphicUV": "DeckGraphic covers the deck underside with UV 0..1 (glTF/three convention, "
                         "v = 0 is the image TOP). Image top (v=0) = nose, bottom (v=1) = tail; u=0 is the board's "
                         "-X rail, u=1 the +X rail, so the image reads un-mirrored when you look up at the deck "
                         "with the nose pointing up. Image aspect should be ~1:3.8 (default 256x1024). The deck "
                         "outline is a rounded popsicle so the corners of the image are clipped.",
    }


if __name__ == "__main__":
    build()
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    export(C.OUT_DIR / "skateboard.glb")
