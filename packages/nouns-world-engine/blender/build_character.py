"""Build the rigged Noun body, bake every animation clip and export
noun_character.glb + character_manifest.json.

Run:  <blender-python> packages/nouns-world-engine/blender/build_character.py
(build_skateboard.py and build_head.py run first; build_character_assets.sh does all + validation.)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

import common as C  # noqa: E402
import rig as RG  # noqa: E402
import posekit as PK  # noqa: E402
import clips_foot  # noqa: E402
import clips_skate  # noqa: E402
from build_skateboard import board_info  # noqa: E402
import build_head as BH  # noqa: E402

HEAD_OFFSET = [0.0, -0.02, 0.0]   # three.js, head-bone space: head bottom at y 1.13 sits on the funnel collar


def bl2three(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def three_name(n):
    """Mirror of three.js PropertyBinding.sanitizeNodeName."""
    import re
    return re.sub(r"[\[\]\.:/]", "", re.sub(r"\s", "_", n))


def all_clips():
    return clips_foot.clips() + clips_skate.clips()


def build(only=None):
    C.reset_scene()
    rig, body, mats = RG.build_character()
    solver = PK.RigSolver(rig, RG.BONE_ORDER)
    clips = all_clips()
    if only:
        clips = [c for c in clips if c.name in only]
    for clip in clips:
        PK.bake(solver, clip)
    # leave the rig in rest pose with the idle clip active
    rig.animation_data.action = bpy.data.actions.get("idle") or rig.animation_data.action
    print(f"[character] body triangles: {C.tri_count(body.data)}, clips: {len(clips)}")
    return rig, body, solver, clips


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", export_yup=True, export_apply=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_anim_single_armature=True,
        export_def_bones=False, export_leaf_bone=False, export_reset_pose_bones=True,
        export_rest_position_armature=True, export_anim_slide_to_zero=True, export_bake_animation=False,
        export_skins=True, export_morph=True, export_morph_normal=True, export_lights=False, export_cameras=False,
        export_draco_mesh_compression_enable=False, export_image_format="AUTO",
        export_vertex_color="NONE",
    )
    print(f"[character] wrote {path} ({Path(path).stat().st_size} bytes)")


def glb_triangles(path):
    import struct
    b = Path(path).read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    tot = 0
    for m in j["meshes"]:
        for p in m["primitives"]:
            acc = j["accessors"][p["indices"]] if "indices" in p else j["accessors"][p["attributes"]["POSITION"]]
            tot += acc["count"] // 3
    return tot


def manifest(rig, body, solver, clips):
    # world positions (three.js frame) in the skate idle pose
    skate = next((c for c in clips if c.name == "skate_idle"), None)
    feet = {}
    if skate:
        _, W = solver.solve(PK.eval_controls(skate, 0.0))
        for s, nm in (("L", "front (left foot, toward nose)"), ("R", "back (right foot, tail side)")):
            ank = W[f"foot.{s}"].translation
            toe = W[f"toe.{s}"] @ PK.Vector((0, rig.data.bones[f"toe.{s}"].length, 0, 1))
            feet[s] = {"role": nm, "ankle": bl2three(ank), "toeTip": bl2three(toe.to_3d())}
    _, Wr = solver.solve(PK.default_controls())
    neck_top = bl2three(Wr["head"].translation)
    bones = [b.name for b in rig.data.bones]
    clip_info = []
    for c in clips:
        e = {"name": c.name, "duration": round(c.frames / 30.0, 4), "frames": c.frames + 1, "loop": c.loop}
        e.update(c.meta)
        clip_info.append(e)
    uv = {k: list(v) for k, v in RG.UV_REGIONS.items()}
    m = {
        "version": 1,
        "generator": "packages/nouns-world-engine/blender/build_character.py",
        "units": "meters",
        "fps": 30,
        "files": {"character": "noun_character.glb", "skateboard": "skateboard.glb", "head": "noun_head_base.glb"},
        "coordinateSystem": {
            "up": "+Y", "forward": "+Z", "left": "+X",
            "note": "Character origin = ground point between the soles. In three.js the character faces +Z "
                    "with its LEFT side toward +X (glTF convention).",
        },
        "character": {
            "rootNode": "NounRig",
            "skinnedMesh": "NounBody",
            "triangles": C.tri_count(body.data),
            "heightWithoutHead": RG.NECK_TOP_Z,
            "approxHeightWithHead": round(RG.NECK_TOP_Z + HEAD_OFFSET[1] + BH.H, 3),
            "style": "Jet Set Radio-style angular low poly for cel shading: chamfered 6-10 sided lofted "
                     "sections, flat-shaded planes (crease angle 28 deg), flat albedo per material, "
                     "smooth multi-bone weights. Designed for a 2-3 tone toon ramp + black outlines.",
            "morphTargets": list(RG.MORPHS),
        },
        "head": {
            "bone": "head",
            "offset": HEAD_OFFSET,
            "width": BH.W,
            "model": "noun_head_base.glb",
            "note": "Runtime attach: add the head (origin = bottom centre, facing +Z) as a child of the "
                    "`head` bone at `offset` (head-bone space = character axes at rest, origin at the neck "
                    "top). noun_head_base.glb is already `width` m wide, so no scaling is needed; a voxel "
                    "head should be normalised to `width` with its bbox bottom at y = 0.",
        },
        "headModel": dict(BH.head_info(glb_triangles(C.OUT_DIR / "noun_head_base.glb")
                                       if (C.OUT_DIR / "noun_head_base.glb").exists() else None)),
        "headUv": {**{k: v for k, v in BH.HEAD_UV.items()}, "notes": BH.HEAD_UV_NOTES},
        "uvRegions": uv,
        "morphTargets": list(RG.MORPHS),
        "morphNotes": {
            "weight_thin": "skinny: everything ~15-25 % slimmer.",
            "weight_heavy": "clinically obese: round belly pushing the jacket out, double-wide waist and seat, "
                            "thick thighs/arms (sleeves and hands are pushed outward so hanging arms clear the "
                            "belly).",
            "usage": "Both targets are on every primitive of the skinned body (glTF morph targets with "
                     "normals; three.js applies morphs before skinning). Drive "
                     "mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]] in 0..1 on every "
                     "primitive (the GLB body is a Group of 5 SkinnedMeshes, one per material). For one "
                     "slider s in -1..1: thin = max(0, -s), heavy = max(0, s).",
        },
        "bones": {b: three_name(b) for b in bones},
        "boneNamesThree": [three_name(b) for b in bones],
        "boneNotes": {
            "root": "Ground-level root at the origin. Never animated (all clips are in place).",
            "board": "Extra non-deforming bone (child of root). In skate clips it carries the deck pose that the "
                     "feet are planted on (ollie pop pitch, manual nose-up, grab lift, carve tilt). Parent the "
                     "skateboard model to this bone while riding so the feet stay glued; identity in on-foot clips.",
            "hips": "Only bone besides `board` with translation keys (crouches, jumps, bail).",
            "nameSanitising": "The GLB keeps Blender's names (e.g. 'hand.R'), but three.js GLTFLoader runs "
                              "PropertyBinding.sanitizeNodeName on every node, which strips '.', so at runtime the "
                              "bone is called 'handR'. `bones` maps canonical name -> three.js name; animation "
                              "tracks are sanitised the same way, so clips bind without any renaming. Look bones "
                              "up with the three.js name: skeleton.getBoneByName(manifest.bones['hand.R']).",
        },
        "headAttach": {
            "bone": "head",
            "neckTop": neck_top,
            "boneLocalFrame": "head bone local axes at rest equal the character axes (+Y up, +Z forward, +X left); "
                              "its origin is the neck top.",
            "recommended": {
                "fitWidth": BH.W,
                "placement": "Scale the head model uniformly so its bounding-box width (X) is `head.width` m, "
                             "centre it on X/Z, and offset it so the bbox bottom sits at y = head.offset[1] in "
                             "head-bone space (noun_head_base.glb already satisfies this at scale 1). Add it as "
                             "a child of the head bone; its bottom then rests on the hood roll. A small +Z "
                             "nudge (0.0-0.03 m) reads well for heads with long snouts.",
            },
        },
        "materials": {
            "NounBody": "cropped jacket (torso, funnel collar, puffy sleeves); base colour map replaced at "
                        "runtime by a canvas texture (see nounBodyTexture) - keep it flat colour.",
            "NounSkin": "mitten hands, no map: flat baseColorFactor (default #e3b48f); set material.color to "
                        "the head's skin tone. There is no neck (the collar hides it).",
            "NounPants": "baggy cargo pants: flat olive #5d6b3c map with a yellow outer-seam stripe and darker "
                         "cargo pocket panels; baseColorFactor white.",
            "NounShoe": "chunky sneaker uppers: flat red #e8473a with white side panels + lace block; shares "
                        "shoe.png with NounSole. Recolour by replacing the map.",
            "NounSole": "thick sole: off-white with a black band and dark tread.",
        },
        "nounBodyTexture": {
            "uvConvention": "glTF / three.js (texture.flipY = false, as GLTFLoader sets): (u, v) with v = 0 at "
                            "the TOP row of the image, i.e. canvas pixel = (u * width, v * height). Rects are "
                            "[u0, v0, u1, v1] in that convention (u0,v0 = top-left corner).",
            "canvasSize": 512,
            "uvRegions": uv,
            "regionNotes": {
                "front": "torso front, orthographic projection, NOT mirrored: image left = character's right "
                         "side (viewer's left when facing the character). 0.42 x 0.42 m.",
                "back": "torso back seen from behind (image left = character's left). 0.42 x 0.42 m.",
                "left": "character's left side (+X), image left = front. 0.24 x 0.42 m.",
                "right": "character's right side (-X), image left = back. 0.24 x 0.42 m.",
                "top": "shoulder top, image top = back. 0.42 x 0.24 m.",
                "sleeves": "arms + torso underside, overlapping islands: fill with the flat body colour.",
            },
            "texelDensity": "16 canvas px per Nouns pixel at 512 px (one Nouns pixel = 0.03 m on the body).",
            "accessoryMapping": "Draw the Nouns 32x32 sprite region cols 9..22, rows 21..31 (the body + "
                                "accessory area, 14 x 11 px) into the front rect at 16 px per sprite pixel, "
                                "starting at the rect's top-left: canvas x = (col - 9) * 16, y = (row - 21) * 16. "
                                "This fills the top 11/14 of the front rect; the bottom 3 rows (48 px) are "
                                "shirt hem - fill with body colour (or repeat row 31). Fill the whole canvas "
                                "with the body colour first.",
        },
        "clips": clip_info,
        "locomotion": {
            "note": "Clips are in place. Scale playback so feet don't slide: "
                    "action.timeScale = groundSpeed / clip.speed (speed in m/s).",
        },
        "skate": {
            "stance": "regular",
            "description": "Board long axis along +Z (nose = +Z). Left foot toward the nose, right foot on the "
                           "tail side. Hips are yawed -90 deg about +Y, so in all skate clips the rider's chest "
                           "faces -X (toward the board's toe-side rail, which is the -X rail); heels are on "
                           "the +X rail. Head is turned to look toward the nose (+Z).",
            "chestFacing": [-1, 0, 0],
            "toeSideRail": "-X",
            "heelSideRail": "+X",
            "turnLeft": "skate_turn_left carves toward +X (heel side) = turning left when rolling toward +Z",
            "turnRight": "skate_turn_right carves toward -X (toe side)",
            "attach": "Parent skateboard.glb's `Skateboard` node to the `board` bone (identity offset) during "
                      "skate clips. Runtime flip/spin rotations go on the Skateboard node (local to the bone). "
                      "skate_bail/skate_getup: detach the board (it keeps the identity board bone).",
            "feetOnDeck_skate_idle": feet,
            "frontFootDeckZ": clips_skate.FRONT_F,
            "backFootDeckZ": clips_skate.BACK_F,
            "ollieFootDeckZ": {"front": clips_skate.OLLIE_FRONT_F, "back": clips_skate.OLLIE_BACK_F},
            "bailEnd": "skate_bail ends on the back, reclined ~45 deg against the giant head, which rests flat "
                       "on the ground (head toward +X), still centred near the origin; skate_getup starts from "
                       "that exact pose and ends in the on-foot idle stance facing +Z.",
        },
        "skateboard": board_info(),
    }
    return m


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    rig, body, solver, clips = build(only)
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    if "--no-export" not in sys.argv:
        export(C.OUT_DIR / "noun_character.glb")
        m = manifest(rig, body, solver, clips)
        (C.OUT_DIR / "character_manifest.json").write_text(json.dumps(m, indent=2) + "\n")
        print(f"[character] wrote {C.OUT_DIR / 'character_manifest.json'}")
    if "--save-blend" in sys.argv:
        bpy.ops.wm.save_as_mainfile(filepath=str(C.TEX_DIR / "noun_character.blend"))
