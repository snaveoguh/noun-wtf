"""Re-import the exported GLBs (round-trip check) and render pose contact
sheets / hero shots with Cycles CPU.

Run:  <blender-python> render_previews.py [--clips a,b,c] [--frames 6] [--size 220]
                                           [--samples 8] [--hero] [--out DIR]
Frames are written to <out>/frames/<clip>_<i>.png; assemble them into labelled
sheets with `python3 contact_sheet.py` (needs Pillow) or let this script do a
plain grid via Blender's image API.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402
import render as R  # noqa: E402


def arg(name, default=None, cast=str):
    if name in sys.argv:
        return cast(sys.argv[sys.argv.index(name) + 1])
    return default


def proxy_head():
    """Stand-in Noun head: 0.55 m wide box with pixel noggles on the front."""
    me = bpy.data.meshes.new("ProxyHead")
    bm = bmesh.new()
    head_mat = C.make_material("ProxyHeadMat", C.hex_rgb("#f3c454"), roughness=0.7)
    red = C.make_material("ProxyNoggles", C.hex_rgb("#e94a35"), roughness=0.5)
    white = C.make_material("ProxyWhite", (0.97, 0.97, 0.97), roughness=0.5)
    black = C.make_material("ProxyBlack", (0.05, 0.05, 0.05), roughness=0.5)
    px = 0.034  # one Nouns pixel

    def box(x0, x1, y0, y1, z0, z1, mi):
        fs = C.grid_box(bm, [x0, x1], [y0, y1], [z0, z1])
        for f in fs:
            f.material_index = mi
    box(-0.275, 0.275, -0.17, 0.17, 0.0, 0.52, 0)
    # noggles (front = -Y): frames + lenses, sprite cols 7..22 -> x
    def nx(col):
        return (col - 15) * px
    zt = 0.36
    yf = -0.17 - 0.012
    for c0 in (10, 17):  # two lens frames 6 px wide
        box(nx(c0), nx(c0 + 6), yf - 0.02, yf + 0.03, zt - 6 * px, zt, 1)
        box(nx(c0 + 1), nx(c0 + 3), yf - 0.03, yf, zt - 5 * px, zt - px, 2)
        box(nx(c0 + 3), nx(c0 + 5), yf - 0.03, yf, zt - 5 * px, zt - px, 3)
    box(nx(16), nx(17), yf - 0.02, yf + 0.03, zt - 3 * px, zt - 2 * px, 1)   # bridge
    box(nx(7), nx(10), yf - 0.02, yf + 0.03, zt - 3 * px, zt - 2 * px, 1)    # temple
    box(nx(7), nx(8), yf - 0.02, yf + 0.03, zt - 5 * px, zt - 2 * px, 1)
    bm.to_mesh(me)
    for m in (head_mat, red, white, black):
        me.materials.append(m)
    ob = bpy.data.objects.new("ProxyHead", me)
    C.link(ob)
    return ob


def parent_to_bone(ob, rig, bone):
    """Attach `ob` (modelled in rig space at rest) so it rides on `bone` and
    sits where its rest-space origin coincides with the bone head."""
    b = rig.data.bones[bone]
    ob.parent = rig
    ob.parent_type = "BONE"
    ob.parent_bone = bone
    # Blender parents to the bone TAIL; undo that and the bone's rest rotation.
    ob.matrix_parent_inverse = Matrix.Translation((0, -b.length, 0)) @ b.matrix_local.to_3x3().inverted().to_4x4()
    ob.matrix_basis = Matrix()


def setup_scene():
    C.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(C.OUT_DIR / "noun_character.glb"))
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    head = proxy_head()
    parent_to_bone(head, rig, "head")
    bpy.ops.import_scene.gltf(filepath=str(C.OUT_DIR / "skateboard.glb"))
    board = bpy.data.objects["Skateboard"]
    parent_to_bone(board, rig, "board")
    return rig, head, board


def set_clip(rig, name):
    act = bpy.data.actions.get(name)
    if act is None:
        cands = [a for a in bpy.data.actions if a.name.startswith(name)]
        act = cands[0]
    ad = rig.animation_data or rig.animation_data_create()
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    ad.action = act
    if len(act.slots):
        ad.action_slot = act.slots[0]
    return act


def main():
    clips_arg = arg("--clips")
    nframes = arg("--frames", 6, int)
    size = arg("--size", 220, int)
    samples = arg("--samples", 8, int)
    out = Path(arg("--out", str(C.PREVIEW_DIR)))
    hero = "--hero" in sys.argv
    manifest = json.loads((C.OUT_DIR / "character_manifest.json").read_text())
    clip_meta = {c["name"]: c for c in manifest["clips"]}
    names = clips_arg.split(",") if clips_arg else list(clip_meta)
    rig, head, board = setup_scene()
    print("bones:", len(rig.data.bones), "actions:", len(bpy.data.actions))
    R.setup("CYCLES", (size, size), samples=samples, fast=not hero)
    R.add_sun()
    R.add_ground(size=12)
    scn = bpy.context.scene
    frames_dir = out / "frames"
    for name in names:
        meta = clip_meta[name]
        act = set_clip(rig, name)
        f0, f1 = act.frame_range
        skate = name.startswith("skate_")
        for o in [board] + list(board.children_recursive):
            o.hide_render = not skate or name in ("skate_bail", "skate_getup")
        cam = arg("--cam")
        if cam:
            presets = {"side": ((3.6, 0.0, 0.75), (0, 0, 0.62)), "front": ((0.0, -3.6, 0.8), (0, 0, 0.62)),
                       "toe": ((-3.6, 0.0, 0.8), (0, 0, 0.62)), "back": ((0.0, 3.6, 0.8), (0, 0, 0.62)),
                       "top": ((0.01, 0.0, 4.0), (0, 0, 0.0)), "heel": ((3.6, 0.0, 0.8), (0, 0, 0.62))}
            R.camera(presets[cam][0], presets[cam][1], lens=arg("--lens", 50, float))
        elif skate and name not in ("skate_bail", "skate_getup"):
            R.camera((-2.5, -1.7, 1.15), (0, 0.0, 0.62), lens=50)
        elif name in ("skate_bail", "skate_getup"):
            R.camera((-1.2, -3.4, 1.6), (0.1, 0, 0.45), lens=45)
        else:
            R.camera((1.5, -2.7, 1.15), (0, 0, 0.72), lens=50)
        n = nframes
        for i in range(n):
            if meta["loop"]:
                fr = f0 + (f1 - f0) * i / n
            else:
                fr = f0 + (f1 - f0) * i / (n - 1)
            scn.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
            R.render(frames_dir / f"{name}_{i}.png")
    print("done")


if __name__ == "__main__":
    main()
