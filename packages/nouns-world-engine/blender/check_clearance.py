"""Report arm-vs-head interpenetration (and the head sinking into the floor) for every clip.

Run:  <blender-python> check_clearance.py [--clips a,b] [--verbose]
The head is the manifest head box (noun_head_base, build_head.W/H/D at the
head bone + head.offset). Arms are sampled as capsules along the
upperarm / forearm / hand bones (radius ~ the sleeve / mitten radius).
Prints the worst penetration depth (m) per clip and the time it happens.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402,F401
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
import rig as RG  # noqa: E402
import posekit as PK  # noqa: E402
import build_character as BC  # noqa: E402
import build_head as BH  # noqa: E402

SEGS = [("upperarm", 0.07), ("forearm", 0.05), ("hand", 0.06)]
HEAVY_EXTRA = 0.035   # --heavy: sleeves ~1.5x thicker + pushed out


def box_pen(p, lo, hi, r):
    """Penetration depth of a sphere (p, r) into an AABB (0 = clear)."""
    q = Vector((min(max(p.x, lo.x), hi.x), min(max(p.y, lo.y), hi.y), min(max(p.z, lo.z), hi.z)))
    d = (p - q).length
    if d > 0:
        return max(0.0, r - d)
    inside = min(p.x - lo.x, hi.x - p.x, p.y - lo.y, hi.y - p.y, p.z - lo.z, hi.z - p.z)
    return r + inside


def main():
    C.reset_scene()
    rig = RG.build_armature()
    solver = PK.RigSolver(rig, RG.BONE_ORDER)
    names = sys.argv[sys.argv.index("--clips") + 1].split(",") if "--clips" in sys.argv else None
    clips = [c for c in BC.all_clips() if not names or c.name in names]
    off = BC.HEAD_OFFSET
    hb_lo = Vector((-BH.W / 2, -BH.D / 2, RG.NECK_TOP_Z + off[1]))
    hb_hi = Vector((BH.W / 2, BH.D / 2, RG.NECK_TOP_Z + off[1] + BH.H))
    rest_head_inv = solver.M["head"].inverted()
    corners = [Vector((x, y, z)) for x in (hb_lo.x, hb_hi.x) for y in (hb_lo.y, hb_hi.y) for z in (hb_lo.z, hb_hi.z)]
    worst_all = []
    for clip in clips:
        worst = (0.0, 0.0, "")
        ground = (9.0, 0.0)
        for i in range(clip.frames + 1):
            t = i / 30.0
            _, W = solver.solve(PK.eval_controls(clip, t))
            head_d = W["head"] @ rest_head_inv
            gz = min((head_d @ k).z for k in corners)
            if gz < ground[0]:
                ground = (gz, t)
            to_rest = head_d.inverted()    # world -> head rest space
            for s in ("L", "R"):
                for seg, r in SEGS:
                    r += HEAVY_EXTRA if "--heavy" in sys.argv else 0.0
                    b = f"{seg}.{s}"
                    h = W[b].translation
                    tail = W[b] @ Vector((0, solver.length[b], 0, 1))
                    for k in range(5):
                        p = h.lerp(tail.to_3d(), k / 4)
                        pen = box_pen(to_rest @ p, hb_lo, hb_hi, r)
                        if pen > worst[0]:
                            worst = (pen, t, f"{b}@{k / 4:.2f}")
        worst_all.append((clip.name, worst))
        flag = "  <-- intersects head" if worst[0] > 0.02 else ""
        print(f"{clip.name:18s} head penetration {worst[0]:.3f} m at t={worst[1]:.2f}s ({worst[2]}){flag}")
        if ground[0] < -0.02:
            print(f"{clip.name:18s} head below ground by {-ground[0]:.3f} m at t={ground[1]:.2f}s  <-- head in the floor")
    return worst_all


if __name__ == "__main__":
    main()
