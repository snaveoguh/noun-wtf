"""Preview rendering helpers (Workbench for contact sheets, Cycles for hero shots)."""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


def setup(engine="CYCLES", res=(512, 512), samples=16, transparent=False, fast=False):
    """Workbench/EEVEE need an OpenGL/EGL context which headless bpy lacks, so
    previews use Cycles CPU (fast=True: few bounces, for contact sheets)."""
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = transparent
    scn.render.image_settings.file_format = "PNG"
    if engine == "WORKBENCH":
        scn.render.engine = "BLENDER_WORKBENCH"
        sh = scn.display.shading
        sh.light = "STUDIO"
        sh.color_type = "TEXTURE"
        sh.show_cavity = False
        sh.show_shadows = True
        sh.show_object_outline = False
        sh.show_specular_highlight = True
        scn.display.shadow_shift = 0.1
        scn.display.light_direction = (0.4, -0.5, 0.8)
        try:
            scn.display.render_aa = "8"
        except TypeError:
            pass
    else:
        scn.render.engine = "CYCLES"
        scn.cycles.device = "CPU"
        scn.cycles.samples = samples
        scn.cycles.use_denoising = True
        try:
            scn.cycles.denoiser = "OPENIMAGEDENOISE"
        except TypeError:
            pass
        scn.view_settings.view_transform = "AgX"
        if fast:
            scn.cycles.max_bounces = 3
            scn.cycles.diffuse_bounces = 2
            scn.cycles.glossy_bounces = 1
            scn.cycles.transmission_bounces = 0
            scn.cycles.use_adaptive_sampling = True
    world = bpy.data.worlds.get("PreviewWorld") or bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.62, 0.66, 0.74, 1)
    bg.inputs[1].default_value = 0.8
    scn.world = world
    return scn


def add_sun(strength=3.5, rot=(math.radians(50), math.radians(10), math.radians(-35))):
    d = bpy.data.lights.new("PreviewSun", "SUN")
    d.energy = strength
    d.angle = math.radians(5)
    o = bpy.data.objects.new("PreviewSun", d)
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)
    return o


def add_ground(size=8, color=(0.55, 0.56, 0.58)):
    me = bpy.data.meshes.new("PreviewGround")
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.new("PreviewGroundMat")
    mat.use_nodes = True
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.9
    mat.diffuse_color = (*color, 1)
    me.materials.append(mat)
    o = bpy.data.objects.new("PreviewGround", me)
    bpy.context.scene.collection.objects.link(o)
    return o


def camera(loc, target, lens=50, ortho_scale=None, name="PreviewCam"):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if ortho_scale:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho_scale
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    cam.data.clip_start = 0.01
    cam.data.clip_end = 100
    bpy.context.scene.camera = cam
    return cam


def render(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path


def contact_sheet(paths, out, cols, labels=None, cell=None):
    """Assemble PNGs into a grid using Blender's image API (no PIL needed)."""
    import numpy as np
    imgs = []
    for p in paths:
        im = bpy.data.images.load(str(p))
        w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
        imgs.append(a)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), np.float32)
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
    out_img = bpy.data.images.new("sheet", cols * w, rows * h, alpha=True)
    out_img.pixels.foreach_set(sheet[::-1].ravel())
    out_img.filepath_raw = str(out)
    out_img.file_format = "PNG"
    out_img.save()
    bpy.data.images.remove(out_img)
    return out
