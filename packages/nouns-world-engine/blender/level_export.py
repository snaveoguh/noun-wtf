"""Export plaza.glb (render), collision.glb (physics) and level.json (gameplay + lighting metadata)."""
import json
import math
import os
import struct

import bpy

import level_scene as LS
from level_common import to_three

RENDER_ONLY = ["Foliage", "Decals", "Water", "Backdrop"]
COLLISION_ONLY_IN_RENDER_GLB = ["COL_Boundary"]


def _srgb_hex(c):
    def enc(x):
        x = max(0.0, min(1.0, x))
        return x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return "#" + "".join(f"{int(round(enc(v) * 255)):02x}" for v in c)


def _strip_bake_nodes(objs):
    for ob in objs:
        for slot in ob.material_slots:
            nt = slot.material.node_tree
            n = nt.nodes.get("LM_BAKE")
            if n:
                nt.nodes.remove(n)


def _select(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_all(scene, objs, col_objs, L, lm, out_dir, log=print):
    os.makedirs(out_dir, exist_ok=True)
    render = list(objs.values())
    _strip_bake_nodes(render)
    # ---------------------------------------------------------------- plaza.glb
    _select(render)
    p = os.path.join(out_dir, "plaza.glb")
    bpy.ops.export_scene.gltf(filepath=p, export_format="GLB", use_selection=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_materials="EXPORT", export_image_format="AUTO", export_image_quality=85,
                              export_jpeg_quality=85, export_draco_mesh_compression_enable=False,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_vertex_color="NONE", export_animations=False)
    log(f"  wrote {p} ({os.path.getsize(p) / 1e6:.2f} MB)")
    # ---------------------------------------------------------------- collision.glb
    cols = list(col_objs.values())
    _select(cols)
    p2 = os.path.join(out_dir, "collision.glb")
    bpy.ops.export_scene.gltf(filepath=p2, export_format="GLB", use_selection=True, export_apply=False,
                              export_texcoords=False, export_normals=False, export_materials="NONE",
                              export_draco_mesh_compression_enable=False, export_yup=True, export_cameras=False,
                              export_lights=False, export_extras=False, export_vertex_color="NONE",
                              export_animations=False)
    log(f"  wrote {p2} ({os.path.getsize(p2) / 1e6:.2f} MB)")
    # ---------------------------------------------------------------- level.json
    sv = LS.sun_vector()
    sun_dir = to_three((-sv.x, -sv.y, -sv.z))
    n = math.sqrt(sum(c * c for c in sun_dir))
    sun_dir = [round(c / n, 4) for c in sun_dir]
    stats = lm["stats"]
    e_up = stats["ground_median"]
    e_sun_h = LS.SUN_STRENGTH * math.sin(math.radians(LS.SUN_ELEVATION_DEG))
    sky_rgb = LS.SKY_ZENITH
    sky_max = max(sky_rgb)
    ground_bounce = [0.28 * (e_sun_h + e_up) * c for c in (1.0, 0.95, 0.88)]
    data = {
        # ---- keys consumed by the runtime (src/miniapps/world2/world/Level.ts) ----
        "glb": "plaza.glb",
        "collisionGlb": "collision.glb",
        "rails": [{"id": r["id"], "type": r["type"], "points": r["points"]} for r in L.rails],
        "spawns": L.spawns,
        "sun": {
            "direction": sun_dir,
            "color": _srgb_hex(LS.SUN_COLOR),
            "intensity": LS.SUN_STRENGTH,
            "elevationDeg": LS.SUN_ELEVATION_DEG,
            "angularDiameterDeg": LS.SUN_ANGLE_DEG,
        },
        "sky": {"zenith": _srgb_hex(LS.SKY_ZENITH), "horizon": _srgb_hex(LS.SKY_HORIZON),
                "ground": _srgb_hex(LS.SKY_GROUND)},
        "fog": {"color": _srgb_hex(LS.SKY_HORIZON), "density": 0.0035},
        "lightmaps": lm["meshes"],
        "lightMapIntensity": lm["range"],
        "bounds": {"min": [-76.0, -0.5, -76.0], "max": [76.0, 30.0, 76.0]},
        "landmarks": L.landmarks,
        # ---- informational ----
        "meta": {
            "name": "Noggle Plaza",
            "version": 2,
            "units": "meters",
            "coordinateSystem": "three.js Y-up (Blender (x,y,z) -> (x,z,-y)); origin = plaza centre, floor y=0",
            "sunDirection": "unit vector FROM the sun TOWARD the scene",
            "spawnYaw": "radians about +Y, 0 = facing +Z; forward = (sin yaw, 0, cos yaw)",
            "lightmapEncoding": "LINEAR 8-bit (irradiance / lightMapIntensity), uv1 (TEXCOORD_1), flipY=false; "
                                "contains sky light + all bounce light + AO, NO direct sun (runtime sun is live)",
            "lightmapGroundMedian": round(stats["ground_median"], 3),
            "hemisphereSuggestion": {"sky": _srgb_hex([c / sky_max for c in sky_rgb]),
                                     "ground": _srgb_hex([c / max(ground_bounce) for c in ground_bounce]),
                                     "intensity": round(e_up, 3),
                                     "note": "for non-lightmapped dynamic objects (character)"},
            "collisionMeshes": sorted(col_objs.keys()),
            "renderOnlyMeshes": [n for n in RENDER_ONLY if n in [o.name for o in render]],
            "railCounts": {t: sum(1 for r in L.rails if r["type"] == t) for t in ("ledge", "rail", "coping", "curb")},
        },
    }
    p3 = os.path.join(out_dir, "level.json")
    with open(p3, "w") as f:
        json.dump(data, f, indent=1)
    log(f"  wrote {p3} ({os.path.getsize(p3) / 1e3:.1f} kB, {len(L.rails)} rails)")
    return data


def glb_json(path):
    with open(path, "rb") as f:
        magic, ver, length = struct.unpack("<4sII", f.read(12))
        clen, ctype = struct.unpack("<I4s", f.read(8))
        return json.loads(f.read(clen))
