"""Noggle Plaza -- level build entry point (Blender as a Python module, headless).

Usage (from repo root):
    /tmp/claude-0/bvenv/bin/python packages/nouns-world-engine/blender/build_level.py [options]

Options:
    --out DIR            output dir (default packages/nouns-webapp/public/world2/level)
    --cache DIR          texture cache dir (default /tmp/claude-0/level_cache)
    --previews DIR       render preview PNGs there (default: none)
    --preview-only       skip lightmap bake + export (layout/material iteration)
    --views a,b,c        subset of preview cameras
    --lm-samples N       lightmap bake samples (default 64)
    --lm-scale F         lightmap resolution multiplier (default 1.0)
    --preview-samples N  (default 48)
    --save-blend PATH    save the final .blend for inspection

See LEVEL_README.md for the full pipeline description.
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import bpy  # noqa: E402

import level_layout  # noqa: E402
import level_materials as LMAT  # noqa: E402
import level_scene as LS  # noqa: E402
import level_textures  # noqa: E402
from level_common import RENDER_GROUPS, COLLISION_GROUPS  # noqa: E402

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "packages/nouns-webapp/public/world2/level"))
    ap.add_argument("--cache", default="/tmp/claude-0/level_cache")
    ap.add_argument("--previews", default=None)
    ap.add_argument("--preview-only", action="store_true")
    ap.add_argument("--views", default=None)
    ap.add_argument("--lm-samples", type=int, default=64)
    ap.add_argument("--lm-scale", type=float, default=1.0)
    ap.add_argument("--preview-samples", type=int, default=48)
    ap.add_argument("--save-blend", default=None)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    return ap.parse_args(argv)


def main():
    args = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.unit_settings.system = "METRIC"

    # 1. textures --------------------------------------------------------------------
    log("baking tiling textures (cached)")
    tex = LMAT.bake_textures(os.path.join(args.cache, "tex"), log=log)
    decals = level_textures.make_decals(os.path.join(args.cache, "decals"))

    # 2. geometry --------------------------------------------------------------------
    log("building layout")
    L = level_layout.build_all()
    for n, p in sorted(L.parts.items()):
        log(f"  part {n:14s} {len(p.verts):7d} verts {len(p.faces):6d} faces")

    # per-group material copies so each lightmapped mesh owns its materials
    def mat_factory(group):
        def f(name):
            if name in ("collision", "invisible"):
                return LMAT.build_material(name, tex, decals)
            return LMAT.build_material(name, tex, decals, suffix=f"__{group}")
        return f

    objs = {}
    for g in RENDER_GROUPS:
        if g in L.parts:
            objs[g] = LS.part_to_object(L.parts[g], scene, mat_factory(g))
    col_objs = {}
    col_coll = bpy.data.collections.new("Collision")
    scene.collection.children.link(col_coll)
    for g in COLLISION_GROUPS + ["COL_Rails"]:
        if g in L.parts:
            col_objs[g] = LS.part_to_object(L.parts[g], scene, mat_factory("col"), collection=col_coll)
            col_objs[g].hide_render = True
    for ob in list(objs.values()) + list(col_objs.values()):
        LS.weld(ob)

    LS.setup_world(scene)
    LS.setup_sun(scene)

    if args.preview_only:
        if args.previews:
            views = args.views.split(",") if args.views else None
            LS.render_previews(scene, args.previews, views, samples=args.preview_samples)
        if args.save_blend:
            bpy.ops.wm.save_as_mainfile(filepath=args.save_blend)
        log("done (preview only)")
        return

    import level_lightmap
    import level_export

    # 3. lightmaps -------------------------------------------------------------------
    os.makedirs(args.out, exist_ok=True)
    lm = level_lightmap.bake_all(scene, objs, args.out, samples=args.lm_samples, scale=args.lm_scale, log=log)

    # 4. export ----------------------------------------------------------------------
    level_export.export_all(scene, objs, col_objs, L, lm, args.out, log=log)

    # 5. previews --------------------------------------------------------------------
    if args.previews:
        views = args.views.split(",") if args.views else None
        LS.setup_sun(scene, indirect_only=False)
        LS.render_previews(scene, args.previews, views, samples=args.preview_samples)
        level_lightmap.preview_lightmaps(scene, objs, lm, args.previews, log=log)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.save_blend)
    log("done")


if __name__ == "__main__":
    main()
