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


def load_head(texture=None):
    """noun_head_base.glb (optionally re-textured, e.g. with the labelled debug
    grid from head_debug_grid.py); falls back to the box proxy."""
    path = C.OUT_DIR / "noun_head_base.glb"
    if not path.exists():
        return proxy_head()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    head = next(o for o in set(bpy.data.objects) - before if o.type == "MESH")
    if texture:
        img = bpy.data.images.load(str(texture))
        for m in head.data.materials:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    n.image = img
    return head


def head_offset_bl():
    try:
        m = json.loads((C.OUT_DIR / "character_manifest.json").read_text())
        x, y, z = m.get("head", {}).get("offset", [0, 0, 0])
        return Vector((x, -z, y))
    except (OSError, ValueError):
        return Vector((0, 0, 0))


def setup_scene(head_texture=None):
    C.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(C.OUT_DIR / "noun_character.glb"))
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    head = load_head(head_texture)
    parent_to_bone(head, rig, "head")
    head.matrix_basis = Matrix.Translation(head_offset_bl())
    morph = arg("--morph")          # e.g. weight_heavy=1
    if morph:
        name, val = morph.split("=")
        for o in bpy.data.objects:
            if o.type == "MESH" and o.data.shape_keys and name in o.data.shape_keys.key_blocks:
                o.data.shape_keys.key_blocks[name].value = float(val)
    bpy.ops.import_scene.gltf(filepath=str(C.OUT_DIR / "skateboard.glb"))
    board = bpy.data.objects["Skateboard"]
    parent_to_bone(board, rig, "board")
    return rig, head, board


def toonify(outline=0.009):
    """Quick cel-shaded preview in Cycles: Toon BSDF (2-tone ramp) + flat
    ambient emission, and inverted-hull black outlines (Solidify, flipped
    normals, back-facing parts transparent). Standard view transform so flat
    albedo colours stay flat."""
    ol = bpy.data.materials.new("PreviewOutline")
    ol.use_nodes = True
    nt = ol.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.01, 0.01, 0.012, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    done = set()
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith("Preview"):
            continue
        for m in ob.data.materials:
            if m is None or m.name in done or not m.use_nodes:
                continue
            done.add(m.name)
            t = m.node_tree
            bsdf = next((n for n in t.nodes if n.type == "BSDF_PRINCIPLED"), None)
            mo = next((n for n in t.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if bsdf is None or mo is None:
                continue
            bc = bsdf.inputs["Base Color"]
            src = bc.links[0].from_socket if bc.links else None
            toon = t.nodes.new("ShaderNodeBsdfToon")
            toon.inputs["Size"].default_value = 0.62
            toon.inputs["Smooth"].default_value = 0.0
            amb = t.nodes.new("ShaderNodeEmission")
            amb.inputs["Strength"].default_value = 0.38
            add = t.nodes.new("ShaderNodeAddShader")
            for sock in (toon.inputs["Color"], amb.inputs["Color"]):
                if src is not None:
                    t.links.new(src, sock)
                else:
                    sock.default_value = bc.default_value
            t.links.new(toon.outputs[0], add.inputs[0])
            t.links.new(amb.outputs[0], add.inputs[1])
            t.links.new(add.outputs[0], mo.inputs["Surface"])
        n = len(ob.data.materials)
        ob.data.materials.append(ol)
        sol = ob.modifiers.new("Outline", "SOLIDIFY")
        sol.thickness = outline
        sol.offset = 1.0
        sol.use_flip_normals = True
        sol.use_rim = False
        sol.material_offset = n
        sol.use_quality_normals = True
    scn = bpy.context.scene
    scn.view_settings.view_transform = "Standard"
    scn.cycles.diffuse_bounces = 0
    scn.cycles.glossy_bounces = 0
    scn.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35


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
    if "--turnaround" in sys.argv:
        return turnaround(out, size, samples)
    manifest = json.loads((C.OUT_DIR / "character_manifest.json").read_text())
    clip_meta = {c["name"]: c for c in manifest["clips"]}
    names = clips_arg.split(",") if clips_arg else list(clip_meta)
    rig, head, board = setup_scene(arg("--head-texture"))
    print("bones:", len(rig.data.bones), "actions:", len(bpy.data.actions))
    R.setup("CYCLES", (size, size), samples=samples, fast=not hero)
    if "--toon" in sys.argv:
        toonify()
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
            R.camera((-4.1, -2.8, 1.75), (0, 0.0, 1.0), lens=50)
        elif name in ("skate_bail", "skate_getup"):
            R.camera((-1.9, -5.2, 2.3), (0.1, 0, 0.6), lens=45)
        else:
            R.camera((2.4, -4.4, 1.7), (0, 0, 1.02), lens=50)
        n = nframes
        for i in range(n):
            if meta["loop"]:
                fr = f0 + (f1 - f0) * i / n
            else:
                fr = f0 + (f1 - f0) * i / (n - 1)
            scn.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
            R.render(frames_dir / f"{name}_{i}.png")
    print("done")


def turnaround(out, size, samples):
    """Character turnaround (8 views around + close-ups) in a given clip frame
    (default: idle frame 0). --head-texture swaps the head map (debug grid)."""
    rig, head, board = setup_scene(arg("--head-texture"))
    clip = arg("--clip", "idle")
    set_clip(rig, clip)
    fr = arg("--frame", 0.0, float)
    scn = bpy.context.scene
    scn.frame_set(int(fr), subframe=fr - int(fr))
    skate = clip.startswith("skate_") and clip not in ("skate_bail", "skate_getup")
    for o in [board] + list(board.children_recursive):
        o.hide_render = not skate
    if "--no-head" in sys.argv:
        head.hide_render = True
    R.setup("CYCLES", (size, int(size * 1.25)), samples=samples, fast=False)
    if "--toon" in sys.argv:
        toonify()
    R.add_sun()
    R.add_ground(size=12)
    tag = arg("--tag", clip)
    dist, h, tgt = arg("--dist", 3.4, float), arg("--height", 1.0, float), arg("--target", 0.82, float)
    views = arg("--views", "0,45,90,135,180,225,270,315")
    paths = []
    for a in [float(x) for x in views.split(",")]:
        # a = 0: camera in front of the character (Blender -Y), counter-clockwise from above
        th = math.radians(a)
        loc = (math.sin(th) * dist, -math.cos(th) * dist, h)
        R.camera(loc, (0, 0, tgt), lens=arg("--lens", 50, float))
        paths.append(R.render(out / "turn" / f"{tag}_{int(a)}.png"))
    print("turnaround:", *paths)


if __name__ == "__main__":
    main()
