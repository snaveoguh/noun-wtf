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
    b = col_objs.get("COL_Boundary")
    sel = render + ([b] if b else [])
    _select(sel)
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
        "name": "Noggle Plaza",
        "version": 1,
        "units": "meters",
        "coordinateSystem": "three.js Y-up (Blender (x,y,z) -> (x,z,-y)); origin = plaza centre, plaza floor y=0",
        "files": {"render": "plaza.glb", "collision": "collision.glb"},
        "bounds": {"min": [-76.0, -0.5, -76.0], "max": [76.0, 30.0, 76.0],
                   "note": "playable AABB; invisible walls (COL_Boundary) sit just outside x/z = +-76"},
        "sun": {
            "direction": sun_dir,
            "directionNote": "unit vector pointing FROM the sun TOWARD the scene (light travels along it); "
                             "place a DirectionalLight at target - direction * distance",
            "elevationDeg": LS.SUN_ELEVATION_DEG,
            "colorLinear": [round(c, 4) for c in LS.SUN_COLOR],
            "colorHex": _srgb_hex(LS.SUN_COLOR),
            "intensity": LS.SUN_STRENGTH,
            "angularDiameterDeg": LS.SUN_ANGLE_DEG,
        },
        "sky": {
            "zenithLinear": [round(c, 4) for c in LS.SKY_ZENITH],
            "horizonLinear": [round(c, 4) for c in LS.SKY_HORIZON],
            "groundLinear": [round(c, 4) for c in LS.SKY_GROUND],
            "zenithHex": _srgb_hex(LS.SKY_ZENITH),
            "horizonHex": _srgb_hex(LS.SKY_HORIZON),
            "blendExponent": LS.SKY_GAMMA,
            "note": "radiance(dir) = mix(horizon, zenith, max(dir.y,0)^blendExponent); below horizon = ground. "
                    "Linear values are the exact radiance used for the bake (render the dome with them and the "
                    "same tone mapping to match)",
        },
        "fog": {"type": "FogExp2", "colorHex": _srgb_hex(LS.SKY_HORIZON), "density": 0.0035},
        "renderer": {"toneMapping": "AgX", "toneMappingExposure": 1.0, "outputColorSpace": "srgb",
                     "note": "Blender previews use AgX, exposure 0 (== three exposure 1.0)"},
        "ambientForDynamicObjects": {
            "type": "HemisphereLight",
            "skyColorLinear": [round(c / sky_max, 4) for c in sky_rgb],
            "groundColorLinear": [round(c / max(ground_bounce), 4) for c in ground_bounce],
            "intensity": round(e_up, 3),
            "groundIntensityRatio": round(max(ground_bounce) / max(e_up, 1e-3), 3),
            "note": "for the character/props that have no lightmap. Lightmapped level meshes must NOT also receive "
                    "this ambient (their lightmap already contains sky + bounce)",
        },
        "lightmaps": {
            "uvChannel": 1,
            "uvAttribute": "uv1 (glTF TEXCOORD_1, Blender UV map 'lightmap')",
            "lightMapIntensity": lm["range"],
            "colorSpace": "srgb",
            "flipY": False,
            "encoding": "sRGB-encoded (irradiance / lightMapIntensity), 8-bit; decoded value * lightMapIntensity = "
                        "irradiance in three.js light units (W/m^2, same scale as sun.intensity)",
            "contains": "sky light + all bounce light (sun and sky) + short-range AO; NO direct sun",
            "meshes": lm["meshes"],
            "files": sorted(set(lm["files"].values())),
            "howTo": "tex = new TextureLoader().load(file); tex.channel = 1; tex.flipY = false; "
                     "tex.colorSpace = SRGBColorSpace; for each mesh under node <name>: "
                     "material.lightMap = tex; material.lightMapIntensity = lightMapIntensity. Materials are already "
                     "unique per lightmapped node (suffix __<Node>), so no cloning is needed.",
        },
        "meshes": {
            "lightmapped": sorted(lm["meshes"].keys()),
            "renderOnly": [n for n in RENDER_ONLY if n in [o.name for o in render]],
            "collisionOnly": COLLISION_ONLY_IN_RENDER_GLB,
            "collisionOnlyNote": "present in plaza.glb with material 'invisible': set visible=false but keep for raycasts",
            "raycastAgainst": [o.name for o in render if o.name not in RENDER_ONLY] + COLLISION_ONLY_IN_RENDER_GLB,
            "multiPrimitiveNote": "each node holds one primitive per material; GLTFLoader turns it into a Group whose "
                                  "child meshes share the node's lightmap",
        },
        "collision": COLLISION_ONLY_IN_RENDER_GLB,
        "collisionGlb": {
            "file": "collision.glb",
            "meshes": sorted(col_objs.keys()),
            "note": "merged low-poly physics geometry (positions only). COL_Rails holds handrails/coping/flat bar "
                    "tubes -- include it if you want to bonk/collide with rails, grinding should use 'rails'. "
                    "Foliage, lamp heads, decals, awnings and building details are excluded.",
        },
        "rails": L.rails,
        "railTypes": ["ledge", "rail", "coping", "curb"],
        "spawns": L.spawns,
        "spawnNote": "yaw radians about +Y, 0 = facing +Z; forward = (sin yaw, 0, cos yaw)",
        "landmarks": L.landmarks,
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
