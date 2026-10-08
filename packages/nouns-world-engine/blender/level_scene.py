"""Scene assembly: Parts -> Blender objects, sky/sun lighting, preview renders."""
import math

import bpy
import numpy as np
from mathutils import Vector

from level_common import box_uv
import level_materials as LMAT

# ---------------------------------------------------------------- lighting constants
SUN_ELEVATION_DEG = 50.0
SUN_AZ_XY = (0.5, -0.6)              # horizontal direction TO the sun (Blender XY): south-east
SUN_STRENGTH = 3.2                   # W/m^2 ~= three.js DirectionalLight intensity
SUN_COLOR = (1.0, 0.94, 0.84)        # linear
SUN_ANGLE_DEG = 0.6
# gradient sky (linear radiance)
SKY_ZENITH = (0.085, 0.19, 0.46)
SKY_HORIZON = (0.36, 0.45, 0.56)
SKY_GROUND = (0.10, 0.095, 0.09)     # below-horizon radiance (stands in for distant ground)
SKY_GAMMA = 0.45                     # horizon->zenith blend exponent on sin(elevation)


def sun_vector():
    """Unit vector pointing TO the sun (Blender coords)."""
    hx, hy = SUN_AZ_XY
    n = math.hypot(hx, hy)
    e = math.radians(SUN_ELEVATION_DEG)
    return Vector((math.cos(e) * hx / n, math.cos(e) * hy / n, math.sin(e)))


def setup_world(scene):
    w = bpy.data.worlds.new("Sky")
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])  # direction for world
    # elevation factor t = clamp(z,0,1)^gamma
    cl = nt.nodes.new("ShaderNodeMath")
    cl.operation = "MAXIMUM"
    cl.inputs[1].default_value = 0.0
    nt.links.new(sep.outputs[2], cl.inputs[0])
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = SKY_GAMMA
    nt.links.new(cl.outputs[0], pw.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(pw.outputs[0], mix.inputs["Factor"])
    mix.inputs[6].default_value = SKY_HORIZON + (1.0,)
    mix.inputs[7].default_value = SKY_ZENITH + (1.0,)
    # below horizon -> ground colour
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "LESS_THAN"
    gt.inputs[1].default_value = -0.02
    nt.links.new(sep.outputs[2], gt.inputs[0])
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    nt.links.new(gt.outputs[0], mix2.inputs["Factor"])
    nt.links.new(mix.outputs[2], mix2.inputs[6])
    mix2.inputs[7].default_value = SKY_GROUND + (1.0,)
    nt.links.new(mix2.outputs[2], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return w


def setup_sun(scene, indirect_only=False):
    ld = bpy.data.lights.get("Sun") or bpy.data.lights.new("Sun", "SUN")
    ld.energy = SUN_STRENGTH
    ld.color = SUN_COLOR
    ld.angle = math.radians(SUN_ANGLE_DEG)
    ob = bpy.data.objects.get("Sun")
    if ob is None:
        ob = bpy.data.objects.new("Sun", ld)
        scene.collection.objects.link(ob)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = sun_vector().to_track_quat("Z", "Y")
    set_sun_indirect_only(ld, indirect_only)
    return ob


def set_sun_indirect_only(ld, on):
    """Light-path trick: the sun only contributes after >=1 diffuse bounce (no direct sun)."""
    ld.use_nodes = True
    nt = ld.node_tree
    em = [n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission"][0]
    for l_ in list(em.inputs["Strength"].links):
        nt.links.remove(l_)
    if on:
        lp = nt.nodes.get("LP") or nt.nodes.new("ShaderNodeLightPath")
        lp.name = "LP"
        gt = nt.nodes.get("GT") or nt.nodes.new("ShaderNodeMath")
        gt.name = "GT"
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = 0.5
        nt.links.new(lp.outputs["Diffuse Depth"], gt.inputs[0])
        nt.links.new(gt.outputs[0], em.inputs["Strength"])
    else:
        em.inputs["Strength"].default_value = 1.0


# ---------------------------------------------------------------- objects
def part_to_object(part, scene, materials_for, collection=None):
    """Create a mesh object from a level_common.Part. materials_for(name) -> bpy material."""
    me = bpy.data.meshes.new(part.name)
    me.from_pydata(part.verts, [], part.faces)
    uniq = []
    for m in part.mats:
        if m not in uniq:
            uniq.append(m)
    for m in uniq:
        me.materials.append(materials_for(m))
    idx = {m: i for i, m in enumerate(uniq)}
    me.polygons.foreach_set("material_index", [idx[m] for m in part.mats])
    me.polygons.foreach_set("use_smooth", [bool(s) for s in part.smooth])
    uv = me.uv_layers.new(name="UVMap")
    uvs = []
    for f, m, explicit in zip(part.faces, part.mats, part.uvs):
        if explicit is not None:
            uvs.extend(explicit)
        else:
            uvs.extend(box_uv([part.verts[i] for i in f], LMAT.tile_of(m)))
    uv.data.foreach_set("uv", np.array(uvs, np.float32).ravel())
    me.update()
    ob = bpy.data.objects.new(part.name, me)
    (collection or scene.collection).objects.link(ob)
    return ob


def weld(ob, dist=0.0005):
    """Merge coincident vertices (needed so lightmap islands are not one-face-each)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


# ---------------------------------------------------------------- previews
PREVIEW_CAMS = {
    # name: (location, look_at, lens)
    "overview": ((-72.0, -88.0, 62.0), (4.0, 2.0, 0.0), 30.0),
    "fountain": ((-4.0, -24.0, 2.1), (0.0, 0.0, 2.6), 26.0),
    "bigsix": ((-24.0, 8.0, 1.6), (-32.0, 21.0, 1.0), 22.0),
    "qpbay": ((34.0, -14.0, 1.7), (44.0, 2.0, 1.0), 20.0),
    "ledges": ((-12.0, -18.0, 1.5), (-34.0, -38.0, 0.0), 24.0),
    "street": ((22.0, -64.0, 1.5), (-10.0, -60.0, 2.5), 24.0),
    "platform": ((18.0, 8.0, 2.2), (34.0, 32.0, 0.8), 22.0),
}


def add_camera(scene, name, loc, look, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_end = 600
    cam = bpy.data.objects.new("CAM_" + name, cd)
    scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(look) - Vector(loc)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return cam


def render_previews(scene, out_dir, names=None, samples=48, res=(960, 540), prefix="level_"):
    import os
    import time
    os.makedirs(out_dir, exist_ok=True)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.threads_mode = "FIXED"
    scene.render.threads = os.cpu_count() or 4
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 4
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast" if _has_look(scene, "AgX - Medium High Contrast") else "None"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "PNG"
    out = []
    for name, (loc, look, lens) in PREVIEW_CAMS.items():
        if names and name not in names:
            continue
        cam = bpy.data.objects.get("CAM_" + name) or add_camera(scene, name, loc, look, lens)
        scene.camera = cam
        p = os.path.join(out_dir, f"{prefix}{name}.png")
        scene.render.filepath = p
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"  preview {p} ({time.time() - t:.1f}s)")
        out.append(p)
    return out


def _has_look(scene, look):
    try:
        items = [i.identifier for i in scene.view_settings.bl_rna.properties["look"].enum_items_static]
        return look in items or True
    except Exception:
        return False
