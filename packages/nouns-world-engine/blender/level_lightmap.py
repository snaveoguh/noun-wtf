"""Lightmaps: second UV set ("lightmap"), Cycles bake of sky + bounce irradiance (NO direct sun), AO,
OIDN denoise, LDR encode.

What is baked (per texel, in W/m^2 irradiance units == three.js light units):
    E = pi * DIFFUSE(direct+indirect, no colour)   with the sun lamp contributing only after
                                                   >= 1 diffuse bounce (light-path trick)
      = sky light (occluded) + sun bounce light + sky bounce light
    final = E * lerp(1, AO(0.6 m), AO_MIX)            (extra contact darkening)
Stored: LINEAR (final / LM_RANGE), dithered 8-bit -> runtime: texture.colorSpace = LinearSRGBColorSpace,
material.lightMapIntensity = LM_RANGE, texture.channel = 1 (uv1), texture.flipY = false.
"""
import ctypes
import math
import os
import time

import bpy
import numpy as np

import level_scene as LS

# atlas name -> (objects, base resolution)
ATLASES = [
    ("ground", ["Ground"], 2048),
    ("obstacles", ["Obstacles"], 2048),
    ("buildings", ["Buildings"], 1024),   # big flat facades: soft sky/bounce, 1k is plenty
    ("props", ["Props"], 2048),
    ("detail", ["Foliage", "Decals", "Water"], 1024),
    ("backdrop", ["Backdrop"], 512),
]
AO_DISTANCE = 0.6
AO_MIX = 0.45
LM_EXT = ".webp"


# ---------------------------------------------------------------------------- UVs
def unwrap(objs, log=print):
    """Create the 'lightmap' UV map (index 1) and pack each atlas."""
    for atlas, names, res in ATLASES:
        group = [objs[n] for n in names if n in objs]
        if not group:
            continue
        t = time.time()
        for ob in group:
            me = ob.data
            if "lightmap" not in me.uv_layers:
                me.uv_layers.new(name="lightmap")
            me.uv_layers["lightmap"].active = True
            me.uv_layers["UVMap"].active_render = True
        bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
        bpy.ops.object.select_all(action="DESELECT")
        for ob in group:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        margin = 6.0 / res
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
        bpy.ops.object.mode_set(mode="OBJECT")
        for ob in group:
            ob.data.uv_layers["UVMap"].active = True
            ob.data.uv_layers["UVMap"].active_render = True
        log(f"  lightmap uv {atlas}: {', '.join(n.name for n in group)} ({time.time() - t:.1f}s)")


# ---------------------------------------------------------------------------- OIDN
class OIDN:
    def __init__(self):
        d = os.path.dirname(bpy.__file__)
        libdir = None
        while d and d != os.path.dirname(d):
            if os.path.isdir(os.path.join(d, "lib")) and any(
                    f.startswith("libOpenImageDenoise.so") for f in os.listdir(os.path.join(d, "lib"))):
                libdir = os.path.join(d, "lib")
                break
            d = os.path.dirname(d)
        if libdir is None:
            raise RuntimeError("libOpenImageDenoise not found next to bpy")
        cand = [os.path.join(libdir, f) for f in os.listdir(libdir) if f.startswith("libOpenImageDenoise.so")]
        cand.sort(key=len)
        self.lib = ctypes.CDLL(cand[0])
        V = ctypes.c_void_p
        L_ = self.lib
        L_.oidnNewDevice.restype = V
        L_.oidnNewDevice.argtypes = [ctypes.c_int]
        L_.oidnCommitDevice.argtypes = [V]
        L_.oidnNewFilter.restype = V
        L_.oidnNewFilter.argtypes = [V, ctypes.c_char_p]
        L_.oidnSetSharedFilterImage.argtypes = [V, ctypes.c_char_p, V, ctypes.c_int, ctypes.c_size_t, ctypes.c_size_t,
                                                ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
        L_.oidnSetFilterBool.argtypes = [V, ctypes.c_char_p, ctypes.c_bool]
        L_.oidnCommitFilter.argtypes = [V]
        L_.oidnExecuteFilter.argtypes = [V]
        L_.oidnReleaseFilter.argtypes = [V]
        L_.oidnGetDeviceError.argtypes = [V, ctypes.POINTER(ctypes.c_char_p)]
        L_.oidnGetDeviceError.restype = ctypes.c_int
        self.dev = L_.oidnNewDevice(0)
        L_.oidnCommitDevice(self.dev)

    def denoise(self, color, normal=None, albedo=None):
        h, w, _ = color.shape
        color = np.ascontiguousarray(color, np.float32)
        out = np.zeros_like(color)
        f = self.lib.oidnNewFilter(self.dev, b"RT")
        F3 = 3  # OIDN_FORMAT_FLOAT3
        self.lib.oidnSetSharedFilterImage(f, b"color", color.ctypes.data, F3, w, h, 0, 0, 0)
        keep = [color, out]
        if albedo is not None:
            albedo = np.ascontiguousarray(albedo, np.float32)
            keep.append(albedo)
            self.lib.oidnSetSharedFilterImage(f, b"albedo", albedo.ctypes.data, F3, w, h, 0, 0, 0)
            if normal is not None:
                normal = np.ascontiguousarray(normal, np.float32)
                keep.append(normal)
                self.lib.oidnSetSharedFilterImage(f, b"normal", normal.ctypes.data, F3, w, h, 0, 0, 0)
        self.lib.oidnSetSharedFilterImage(f, b"output", out.ctypes.data, F3, w, h, 0, 0, 0)
        self.lib.oidnSetFilterBool(f, b"hdr", True)
        self.lib.oidnCommitFilter(f)
        self.lib.oidnExecuteFilter(f)
        err = ctypes.c_char_p()
        if self.lib.oidnGetDeviceError(self.dev, ctypes.byref(err)):
            raise RuntimeError(f"OIDN: {err.value}")
        self.lib.oidnReleaseFilter(f)
        return out


# ---------------------------------------------------------------------------- bake
def _target_image(name, res):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, res, res, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    return img


def _set_active_image(objs, img):
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            nt = m.node_tree
            n = nt.nodes.get("LM_BAKE")
            if n is None:
                n = nt.nodes.new("ShaderNodeTexImage")
                n.name = "LM_BAKE"
            n.image = img
            for o in nt.nodes:
                o.select = False
            n.select = True
            nt.nodes.active = n


def _pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _bake(objs, img, btype, **kw):
    _set_active_image(objs, img)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type=btype, uv_layer="lightmap", margin=8, margin_type="EXTEND", use_clear=True,
                        target="IMAGE_TEXTURES", **kw)
    return _pixels(img)


def _diffuse_override(objs):
    """Swap every Principled BSDF for a plain white-irradiance-friendly Diffuse BSDF (same base colour,
    normal and alpha) while baking. Metallic surfaces have no diffuse lobe, so a DIFFUSE bake of the real
    material comes out black/noisy; the lightmap must hold irradiance regardless of the surface BRDF.
    Returns an undo list for _restore_override."""
    undo = []
    seen = set()
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            if m is None or m.name in seen:
                continue
            seen.add(m.name)
            nt = m.node_tree
            outn = [n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"][0]
            if not outn.inputs["Surface"].links:
                continue
            old = outn.inputs["Surface"].links[0].from_socket
            bsdf = old.node
            if bsdf.bl_idname != "ShaderNodeBsdfPrincipled":
                continue
            new = []
            dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
            new.append(dif)
            for src, dst in (("Base Color", "Color"), ("Normal", "Normal")):
                inp = bsdf.inputs[src]
                if inp.links:
                    nt.links.new(inp.links[0].from_socket, dif.inputs[dst])
                elif src == "Base Color":
                    dif.inputs[dst].default_value = inp.default_value
            surf = dif.outputs[0]
            a = bsdf.inputs["Alpha"]
            if a.links or a.default_value < 0.999:
                tr = nt.nodes.new("ShaderNodeBsdfTransparent")
                mix = nt.nodes.new("ShaderNodeMixShader")
                new += [tr, mix]
                if a.links:
                    nt.links.new(a.links[0].from_socket, mix.inputs[0])
                else:
                    mix.inputs[0].default_value = a.default_value
                nt.links.new(tr.outputs[0], mix.inputs[1])
                nt.links.new(dif.outputs[0], mix.inputs[2])
                surf = mix.outputs[0]
            nt.links.new(surf, outn.inputs["Surface"])
            undo.append((nt, outn, old, new))
    return undo


def _restore_override(undo):
    for nt, outn, old, new in undo:
        nt.links.new(old, outn.inputs["Surface"])
        for n in new:
            nt.nodes.remove(n)


def _ray_visible(ob, on):
    ob.visible_diffuse = on
    ob.visible_shadow = on
    ob.visible_glossy = on
    ob.visible_transmission = on


def bake_all(scene, objs, out_dir, samples=64, scale=1.0, log=print):
    unwrap(objs, log=log)
    undo = _diffuse_override(list(objs.values()))
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = os.cpu_count() or 4
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.use_denoising = False
    scene.world.light_settings.distance = AO_DISTANCE
    sun = LS.setup_sun(scene, indirect_only=True)
    oidn = OIDN()
    raw = {}
    for atlas, names, base in ATLASES:
        group = [objs[n] for n in names if n in objs]
        if not group:
            continue
        res = int(base * scale)
        t = time.time()
        # decals float 1-2 cm in front of walls/floors: keep them from occluding the surface behind them
        # (except while baking their own atlas)
        if "Decals" in objs:
            _ray_visible(objs["Decals"], "Decals" in names)
        scene.cycles.samples = samples
        img = _target_image(f"LM_{atlas}", res)
        d = _bake(group, img, "DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
        mask = d[..., 3] > 0.5
        E = math.pi * d[..., :3]
        scene.cycles.samples = max(16, samples // 2)
        ao = _bake(group, img, "AO")[..., 0]
        scene.cycles.samples = 1
        nrm = _bake(group, img, "NORMAL", normal_space="OBJECT")[..., :3] * 2.0 - 1.0
        bpy.data.images.remove(img)
        final = E * (1.0 - AO_MIX + AO_MIX * ao)[..., None]
        den = oidn.denoise(final, normal=nrm, albedo=np.ones_like(final))
        den = np.where(mask[..., None], np.maximum(den, 0.0), 0.0)
        raw[atlas] = (den, mask)
        log(f"  baked lightmap {atlas} {res}px ({time.time() - t:.1f}s) "
            f"mean {den[mask].mean():.3f} p99 {np.percentile(den[mask], 99):.3f}")
    LS.set_sun_indirect_only(sun.data, False)
    _restore_override(undo)
    if "Decals" in objs:
        _ray_visible(objs["Decals"], True)
    # global range
    allv = np.concatenate([v[0][v[1]].ravel() for v in raw.values()])
    p = float(np.percentile(allv, 99.7))
    lm_range = max(1.0, math.ceil(p * 2.0) / 2.0)
    files = {}
    rng = np.random.default_rng(7)
    for atlas, (den, mask) in raw.items():
        # LINEAR encoding (runtime loads lightmaps as LinearSRGBColorSpace); triangular dither
        # of +-1 LSB hides 8-bit banding in the dark AO corners.
        lin = np.clip(den / lm_range, 0.0, 1.0)
        dither = (rng.random(lin.shape[:2]) - rng.random(lin.shape[:2]))[..., None] / 255.0
        enc = np.clip(lin + dither, 0.0, 1.0)
        path = os.path.join(out_dir, f"lightmap_{atlas}{LM_EXT}")
        _save(enc, path)
        files[atlas] = os.path.basename(path)
    mesh_map = {}
    for atlas, names, _ in ATLASES:
        for n in names:
            if n in objs and atlas in files:
                mesh_map[n] = files[atlas]
    # sample typical irradiance values for the runtime's dynamic-object ambient
    g_den, g_mask = raw["ground"]
    stats = {"ground_mean": float(g_den[g_mask].mean()), "ground_median": float(np.median(g_den[g_mask]))}
    log(f"  lightmap range {lm_range} (p99.7={p:.3f}); ground median {stats['ground_median']:.3f}")
    return {"range": lm_range, "files": files, "meshes": mesh_map, "stats": stats, "raw": raw}


def _srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def _save(arr, path, quality=92):
    h, w, _ = arr.shape
    img = bpy.data.images.new("__lm_save", w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.concatenate([arr, np.ones((h, w, 1))], -1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    ext = os.path.splitext(path)[1].lower()
    img.file_format = {".webp": "WEBP", ".png": "PNG", ".jpg": "JPEG"}[ext]
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


# ---------------------------------------------------------------------------- debug view
def preview_lightmaps(scene, objs, lm, out_dir, log=print):
    """Render the overview + fountain views with ONLY the lightmap shown (emission), to sanity-check."""
    saved = []
    imgs = {}
    for atlas, (den, mask) in lm["raw"].items():
        h, w, _ = den.shape
        im = bpy.data.images.new(f"LMV_{atlas}", w, h, alpha=False, float_buffer=True)
        im.colorspace_settings.name = "Linear Rec.709"
        im.pixels.foreach_set(np.concatenate([den / math.pi, np.ones((h, w, 1))], -1).astype(np.float32).ravel())
        imgs[atlas] = im
    for atlas, names, _ in ATLASES:
        for n in names:
            ob = objs.get(n)
            if not ob or atlas not in imgs:
                continue
            for slot in ob.material_slots:
                m = slot.material
                nt = m.node_tree
                outn = [x for x in nt.nodes if x.bl_idname == "ShaderNodeOutputMaterial"][0]
                old = outn.inputs["Surface"].links[0].from_socket if outn.inputs["Surface"].links else None
                uvn = nt.nodes.new("ShaderNodeUVMap")
                uvn.uv_map = "lightmap"
                ti = nt.nodes.new("ShaderNodeTexImage")
                ti.image = imgs[atlas]
                em = nt.nodes.new("ShaderNodeEmission")
                nt.links.new(uvn.outputs[0], ti.inputs[0])
                nt.links.new(ti.outputs[0], em.inputs[0])
                nt.links.new(em.outputs[0], outn.inputs["Surface"])
                saved.append((nt, outn, old, [uvn, ti, em]))
    sun = bpy.data.objects.get("Sun")
    sun.hide_render = True
    world_strength = scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    try:
        LS.render_previews(scene, out_dir, ["overview", "bigsix"], samples=8, prefix="level_lightmap_only_")
    finally:
        sun.hide_render = False
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = world_strength
        for nt, outn, old, nodes in saved:
            if old is not None:
                nt.links.new(old, outn.inputs["Surface"])
            for n in nodes:
                nt.nodes.remove(n)
