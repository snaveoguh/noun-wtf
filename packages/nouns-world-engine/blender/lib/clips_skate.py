"""Skateboarding clips. Regular stance: left foot toward the nose (+f).

Rig frame (l, f, u): +f = nose = +Z in three.js. Standing sideways with the
nose on his left, a regular rider's chest faces -l (-X in three.js / the
toe-side edge), heels on the +X rail. Feet are authored in BOARD space and
follow the `board` bone, which the runtime should parent the skateboard to.
"""
from __future__ import annotations

import math

from mathutils import Vector

from clips_foot import ANKLE_H, STAND, look_total, P, S, Cc, plant
from common import DECK, deck_top_z, kick_slope_deg
from posekit import Clip, PoseSeq, Track, q_eul, rig2bl, vadd, smoothstep

SHOE_C = 0.0575     # shoe centre is this far in front of the ankle
DECK_TOP = DECK["deck_top"]

FRONT_F, BACK_F = 0.165, -0.205      # idle foot centres (front bolts / back bolts-tail)
FRONT_YAW, BACK_YAW = -66.0, -96.0
OLLIE_FRONT_F, OLLIE_BACK_F = 0.05, -0.31


def deck_foot(f_center, yaw, l_center=0.0, lift=0.0, rot=(0.0, 0.0, 0.0)):
    """Ankle target + foot rotation that put the shoe sole flat on the grip
    (including the nose/tail kick) with the shoe centred at (l_center, f_center)."""
    sy, cy = math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
    al = l_center - SHOE_C * sy
    af = f_center - SHOE_C * cy
    slope = kick_slope_deg(abs(f_center) - DECK["kick_start"])
    sgn = 1.0 if f_center > 0 else -1.0
    side = slope * sgn * sy
    pitch = -slope * sgn * cy
    u = deck_top_z(f_center) + 0.004 + ANKLE_H / math.cos(math.radians(slope)) + lift
    return (al, af, u), (pitch + rot[0], side + rot[1], yaw + rot[2])


def feet(front=(FRONT_F, FRONT_YAW), back=(BACK_F, BACK_YAW), lift_f=0.0, lift_b=0.0,
         rot_f=(0, 0, 0), rot_b=(0, 0, 0), l_f=0.0, l_b=0.0, toe_f=0.0, toe_b=0.0):
    pf, rf = deck_foot(front[0], front[1], l_f, lift_f, rot_f)
    pb, rb = deck_foot(back[0], back[1], l_b, lift_b, rot_b)
    return {"leg.L.pos": pf, "leg.L.rot": rf, "leg.R.pos": pb, "leg.R.rot": rb,
            "leg.L.toe": toe_f, "leg.R.toe": toe_b}


def arms2(l_dir, r_dir, l_el=25.0, r_el=20.0, l_clav=(2, 3), r_clav=(1, 0), l_tw=-10.0, r_tw=-10.0,
          l_wr=(-8, 0, 0), r_wr=(-8, 0, 0)):
    return {"arm.L.dir": l_dir, "arm.R.dir": r_dir, "arm.L.elbow": l_el, "arm.R.elbow": r_el,
            "arm.L.clav": l_clav, "arm.R.clav": r_clav, "arm.L.twist": l_tw, "arm.R.twist": r_tw,
            "arm.L.wrist": l_wr, "arm.R.wrist": r_wr}


def board_about(pitch=0.0, pivot_f=-DECK["truck_f"], pivot_u=0.0, side=0.0, lift=0.0, yaw=0.0):
    """board.pos/board.rot for a rotation about a pivot point on the board's
    centre line (e.g. the back wheels' ground contact)."""
    q = q_eul((pitch, side, yaw))
    pv = rig2bl((0.0, pivot_f, pivot_u))
    off = pv - q @ pv
    return {"board.pos": (off.x, -off.y, off.z + lift), "board.rot": (pitch, side, yaw)}


def _resolve_board(c):
    """Controls may carry 'x.board' = (pitch, pivot_f, side, lift, yaw)."""
    if "x.board" in c:
        p, pf, sd, lf, yw = c.pop("x.board")
        c.update(board_about(p, pf, 0.0, sd, lf, yw))
    return c


SKATE = {
    **STAND,
    "hips.pos": (0.04, -0.02, -0.005), "hips.rot": (12.0, 0.0, -82.0),
    "spine.rot": (6.0, -1.0, 4.0), "chest.rot": (4.0, -1.0, 9.0), "neck.rot": (-5.0, 0.0, 10.0),
    "head.rot": (0.0, 0.0, 0.0),
    "leg.L.pole": (0.32, 1.0, 0.0), "leg.R.pole": (-0.36, 1.0, 0.0),
    **feet(),
    **arms2((0.55, 0.32, -0.8), (0.48, -0.05, -0.88), 28.0, 22.0),
    "x.board": (0.0, -DECK["truck_f"], 0.0, 0.0, 0.0),
}


def finish(c, yaw_total=-14.0, pitch_total=6.0):
    _resolve_board(c)
    look_total(c, yaw_total, pitch_total)
    return c


# ---------------------------------------------------------------------------
def skate_idle():
    T = 3.0

    def fn(t):
        x = t / T
        c = dict(SKATE)
        bob = S(2 * x)
        c["hips.pos"] = vadd(SKATE["hips.pos"], (0.006 * S(x + 0.1), 0.008 * S(x), -0.007 + 0.006 * bob))
        c["hips.rot"] = vadd(SKATE["hips.rot"], (1.5 * bob, 1.5 * S(x + 0.2), 2.0 * S(x)))
        c["spine.rot"] = vadd(SKATE["spine.rot"], (-0.8 * bob, -1.0 * S(x + 0.25), -1.0 * S(x + 0.1)))
        c["chest.rot"] = vadd(SKATE["chest.rot"], (-1.0 * S(2 * x + 0.1), -1.0 * S(x + 0.3), -1.5 * S(x + 0.15)))
        for s_, base, ph in (("L", SKATE["arm.L.dir"], 0.0), ("R", SKATE["arm.R.dir"], 0.37)):
            c[f"arm.{s_}.dir"] = vadd(base, (0.05 * S(x + ph), 0.04 * S(x + ph + 0.2), 0.03 * S(2 * x + ph)))
            c[f"arm.{s_}.elbow"] = c[f"arm.{s_}.elbow"] + 4 * S(x + ph + 0.1)
        return finish(c, -14.0 + 6.0 * S(x + 0.3), 6.0 + 2.0 * S(2 * x + 0.4))

    return Clip("skate_idle", T, fn, True)


# Push: body turns to face the nose, back foot pushes on the toe side.
def skate_push():
    T = 0.9
    turned = {
        "hips.rot": (12.0, 0.0, -28.0), "spine.rot": (8.0, 0.0, 6.0), "chest.rot": (4.0, 0.0, 8.0),
        "neck.rot": (-6.0, 0.0, 4.0), "hips.pos": (-0.04, 0.03, -0.01),
        "leg.L.pole": (0.05, 1.0, 0.0), "leg.R.pole": (-0.1, 1.0, 0.0),
    }
    fpos, frot = deck_foot(FRONT_F, -18.0)
    plant_f = {"leg.L.pos": fpos, "leg.L.rot": frot}
    k0 = dict(SKATE)
    k1 = P(SKATE, **turned, **plant_f, **{
        "leg.R.pos": (-0.12, -0.12, DECK_TOP + ANKLE_H + 0.07), "leg.R.rot": (10.0, 0.0, -40.0),
        **arms2((0.25, -0.4, -0.85), (0.3, 0.5, -0.8), 25, 30)})
    # foot reaches the ground ahead (toe side = rider's right when facing the nose)
    k2 = P(k1, **{"hips.pos": (-0.06, 0.05, -0.085), "hips.rot": (16.0, 0.0, -24.0),
                  "leg.R.pos": plant(0.12, -0.21, -10.0, -8.0), "leg.R.rot": (-8.0, 0.0, -10.0),
                  **arms2((0.3, -0.55, -0.75), (0.3, 0.6, -0.7), 22, 35)})
    # end of push: foot far behind, heel up
    k3 = P(k2, **{"hips.pos": (-0.05, 0.04, -0.05), "hips.rot": (14.0, 0.0, -26.0),
                  "leg.R.pos": plant(-0.30, -0.22, -12.0, 32.0), "leg.R.rot": (32.0, 0.0, -12.0),
                  "leg.R.toe": 30.0, **arms2((0.3, 0.45, -0.8), (0.3, -0.55, -0.75), 30, 20)})
    k4 = P(k3, **{"leg.R.pos": (-0.17, -0.36, 0.20), "leg.R.rot": (40.0, 0.0, -30.0), "leg.R.toe": 10.0,
                  "hips.pos": (-0.03, 0.02, -0.02)})
    k5 = P(SKATE, **{"leg.R.pos": vadd(SKATE["leg.R.pos"], (-0.02, -0.03, 0.06)),
                     "leg.R.rot": vadd(SKATE["leg.R.rot"], (8, 0, 6)), "hips.rot": (11.0, 0.0, -70.0),
                     "hips.pos": (0.02, -0.01, 0.005)})
    seq = PoseSeq([(0.0, k0), (0.16, k1), (0.28, k2), (0.52, k3), (0.64, k4), (0.79, k5), (0.9, k0)],
                  period=T, lag={"arm": 0.05, "chest": 0.02, "neck": 0.04})

    def fn(t):
        c = seq(t)
        c["x.board"] = SKATE["x.board"]
        return finish(c, -6.0 + 4 * S(t / T + 0.2), 5.0)

    return Clip("skate_push", T, fn, True)


CROUCH_S = P(SKATE, **{
    "hips.pos": (0.05, -0.04, -0.10), "hips.rot": (22.0, 0.0, -80.0), "spine.rot": (10.0, -1.0, 4.0),
    "chest.rot": (7.0, -1.0, 8.0), "neck.rot": (-12.0, 0.0, 8.0),
    **feet((OLLIE_FRONT_F, -74.0), (OLLIE_BACK_F, -94.0), toe_b=8.0),
    **arms2((0.5, 0.45, -0.75), (0.4, 0.3, -0.85), 32, 30, (0, 6), (0, 6)),
    "leg.L.pole": (0.35, 1.0, 0.0), "leg.R.pole": (-0.38, 1.0, 0.0),
})


def skate_crouch():
    T = 1.0

    def fn(t):
        x = t / T
        c = dict(CROUCH_S)
        c["hips.pos"] = vadd(CROUCH_S["hips.pos"], (0, 0.004 * S(x), 0.008 * S(x)))
        c["hips.rot"] = vadd(CROUCH_S["hips.rot"], (1.5 * S(x + 0.05), 0, 0))
        c["chest.rot"] = vadd(CROUCH_S["chest.rot"], (-1.5 * S(x + 0.15), 0, 1.0 * S(x)))
        for s_, ph in (("L", 0.0), ("R", 0.3)):
            c[f"arm.{s_}.dir"] = vadd(CROUCH_S[f"arm.{s_}.dir"], (0.03 * S(x + ph), 0.04 * S(x + ph + 0.2), 0))
        return finish(c, -10.0, 2.0 + 2 * S(x + 0.3))

    return Clip("skate_crouch", T, fn, True)


AIR_S = P(SKATE, **{
    "hips.pos": (0.04, -0.02, -0.07), "hips.rot": (20.0, 0.0, -82.0), "spine.rot": (8.0, -1.0, 4.0),
    "chest.rot": (5.0, -1.0, 8.0), "neck.rot": (-8.0, 0.0, 8.0),
    **feet((FRONT_F, -70.0), (BACK_F, -96.0)),
    **arms2((0.8, 0.3, -0.25), (0.75, 0.05, -0.35), 38, 32, (1, 4), (3, 0)),
    "leg.L.pole": (0.4, 1.0, 0.1), "leg.R.pole": (-0.42, 1.0, 0.1),
    "x.board": (0.0, -DECK["truck_f"], 0.0, 0.06, 0.0),
})


def _ollie_keys(flip=False):
    pop = P(CROUCH_S, **{
        "hips.pos": (0.03, -0.03, 0.03), "hips.rot": (12.0, 0.0, -82.0), "spine.rot": (3.0, -1.0, 4.0),
        "chest.rot": (0.0, -1.0, 8.0),
        **feet((0.11, -72.0), (OLLIE_BACK_F, -94.0), rot_f=(0, -12, 0), toe_b=12.0),
        **arms2((0.6, 0.35, 0.05), (0.55, -0.1, -0.25), 40, 30, (3, 2), (5, 0)),
        "x.board": (-24.0, -DECK["truck_f"], 0.0, 0.0, 0.0),
    })
    slide = P(pop, **{
        "hips.pos": (0.035, -0.02, 0.0), "hips.rot": (14.0, 0.0, -82.0),
        **feet((0.235, -72.0), (OLLIE_BACK_F + 0.02, -94.0), lift_f=0.025, lift_b=0.035, rot_f=(-10, -18, 0)),
        **arms2((0.75, 0.35, 0.0), (0.65, 0.0, -0.2), 40, 32, (3, 3), (5, 0)),
        "x.board": (-22.0, -DECK["truck_f"], 0.0, 0.03, 0.0),
    })
    level = P(AIR_S, **{
        "hips.pos": (0.04, -0.02, -0.06),
        **feet((0.23, -70.0), (-0.24, -95.0), lift_f=0.0, lift_b=0.01),
        "x.board": (-4.0, -DECK["truck_f"], 0.0, 0.06, 0.0),
    })
    if not flip:
        return [(0.0, CROUCH_S), (0.07, pop), (0.17, slide), (0.30, level), (0.5, AIR_S, "h")]
    flick = P(slide, **{
        "hips.pos": (0.04, -0.02, -0.02), "hips.rot": (16.0, 0.0, -80.0),
        "leg.L.pos": (-0.22, 0.30, DECK_TOP + ANKLE_H + 0.12), "leg.L.rot": (-20.0, -25.0, -40.0),
        "leg.R.pos": (0.02, -0.33, DECK_TOP + ANKLE_H + 0.13), "leg.R.rot": (10.0, 10.0, -100.0),
        "leg.L.pole": (0.6, 1.0, 0.3), "leg.R.pole": (-0.6, 1.0, 0.3),
        **arms2((0.85, 0.35, -0.05), (0.8, 0.0, -0.1), 40, 35, (1, 3), (2, 0)),
        "x.board": (-6.0, -DECK["truck_f"], 0.0, 0.08, 0.0),
    })
    catch = P(AIR_S, **{"x.board": (0.0, -DECK["truck_f"], 0.0, 0.06, 0.0),
                        **feet((FRONT_F, -70.0), (BACK_F, -96.0), lift_f=0.03, lift_b=0.03)})
    return [(0.0, CROUCH_S), (0.06, pop), (0.13, P(slide, **{"x.board": (-14.0, -DECK["truck_f"], 0, 0.05, 0)})),
            (0.23, flick), (0.37, catch), (0.45, AIR_S, "h")]


def skate_ollie():
    seq = PoseSeq(_ollie_keys(False), lag={"arm": 0.03, "neck": 0.02, "chest": 0.015})
    return Clip("skate_ollie", 0.5, lambda t: finish(seq(t), -12.0, 8.0), False)


def skate_flip():
    seq = PoseSeq(_ollie_keys(True), lag={"arm": 0.025, "chest": 0.015})
    return Clip("skate_flip", 0.45, lambda t: finish(seq(t), -10.0, 12.0), False)


def skate_air():
    T = 1.0

    def fn(t):
        x = t / T
        c = dict(AIR_S)
        c["hips.pos"] = vadd(AIR_S["hips.pos"], (0.005 * S(x), 0.008 * S(x + 0.25), 0.008 * S(x)))
        c["hips.rot"] = vadd(AIR_S["hips.rot"], (2 * S(x + 0.1), 2.5 * S(x + 0.3), 2 * S(x)))
        c["chest.rot"] = vadd(AIR_S["chest.rot"], (-2 * S(x + 0.2), -2 * S(x + 0.35), -2 * S(x + 0.1)))
        for s_, ph in (("L", 0.0), ("R", 0.45)):
            c[f"arm.{s_}.dir"] = vadd(AIR_S[f"arm.{s_}.dir"], (0.06 * S(x + ph), 0.08 * S(x + ph + 0.2),
                                                              0.1 * S(x + ph + 0.1)))
            c[f"arm.{s_}.elbow"] = AIR_S[f"arm.{s_}.elbow"] + 8 * S(x + ph + 0.3)
        c["x.board"] = (1.5 * S(x + 0.1), -DECK["truck_f"], 1.5 * S(x + 0.3), 0.06, 0.0)
        return finish(c, -12.0, 14.0 + 3 * S(x))

    return Clip("skate_air", T, fn, True)


def skate_land():
    impact = P(SKATE, **{
        "hips.pos": (0.05, -0.03, -0.12), "hips.rot": (26.0, 0.0, -82.0), "spine.rot": (12.0, -1.0, 4.0),
        "chest.rot": (8.0, -1.0, 8.0), "neck.rot": (-14.0, 0.0, 10.0),
        **arms2((0.75, 0.2, -0.5), (0.7, 0.0, -0.55), 34, 28, (-3, 4), (-3, 0)),
        "leg.L.pole": (0.42, 1.0, 0.0), "leg.R.pole": (-0.45, 1.0, 0.0),
    })
    seq = PoseSeq([(0.0, AIR_S), (0.08, impact, "h"), (0.2, P(SKATE, **{"hips.pos": (0.04, -0.02, -0.02)})),
                   (0.35, SKATE, "h")], lag={"arm": 0.035, "chest": 0.02, "neck": 0.03})
    return Clip("skate_land", 0.35, lambda t: finish(seq(t), -14.0, 8.0), False)


GRIND = P(SKATE, **{
    "hips.pos": (0.035, -0.01, -0.03), "hips.rot": (14.0, 0.0, -84.0), "spine.rot": (6.0, 0.0, 3.0),
    "chest.rot": (3.0, 0.0, 6.0),
    **feet((0.17, -72.0), (-0.18, -98.0)),
    **arms2((0.95, 0.2, -0.38), (0.95, 0.0, -0.18), 22, 18, (0, 2), (2, 0), -20, -20, (0, 0, 0), (0, 0, 0)),
})


def skate_grind():
    T = 1.2

    def fn(t):
        x = t / T
        c = dict(GRIND)
        w = S(x) + 0.35 * S(3 * x + 0.2)
        c["hips.rot"] = vadd(GRIND["hips.rot"], (1.5 * S(2 * x), 4.0 * w, 2 * S(x + 0.2)))
        c["hips.pos"] = vadd(GRIND["hips.pos"], (0.006 * S(x + 0.1), 0.012 * w, 0.005 * S(2 * x)))
        c["spine.rot"] = vadd(GRIND["spine.rot"], (0, -2.5 * S(x - 0.06), 0))
        c["chest.rot"] = vadd(GRIND["chest.rot"], (0, -3.0 * S(x - 0.1), 1.5 * S(x + 0.3)))
        lagw = S(x - 0.1) + 0.35 * S(3 * x + 0.05)
        c["arm.L.dir"] = vadd(GRIND["arm.L.dir"], (0, 0.05 * S(x + 0.3), -0.35 * lagw))
        c["arm.R.dir"] = vadd(GRIND["arm.R.dir"], (0, 0.05 * S(x + 0.1), 0.35 * lagw))
        c["arm.L.elbow"] = 22 + 8 * S(x + 0.2)
        c["arm.R.elbow"] = 18 + 8 * S(x + 0.45)
        c["x.board"] = (0.0, -DECK["truck_f"], 0.0, 0.0, 0.0)
        return finish(c, -16.0 + 4 * S(x + 0.4), 14.0)

    return Clip("skate_grind", T, fn, True)


MANUAL = P(SKATE, **{
    "hips.pos": (0.03, -0.085, 0.03), "hips.rot": (8.0, -3.0, -84.0), "spine.rot": (6.0, 2.0, 3.0),
    "chest.rot": (5.0, 2.0, 6.0), "neck.rot": (-6.0, 0.0, 8.0),
    **feet((0.15, -70.0), (-0.24, -96.0)),
    **arms2((0.85, 0.3, -0.15), (0.8, -0.05, -0.25), 32, 26, (6, 3), (5, 0), -25, -20),
    "leg.L.pole": (0.25, 1.0, 0.0), "leg.R.pole": (-0.42, 1.0, 0.0),
})


def skate_manual():
    T = 1.6

    def fn(t):
        x = t / T
        c = dict(MANUAL)
        w = S(x) + 0.3 * S(2 * x + 0.3)
        c["x.board"] = (-10.0 - 2.5 * w, -DECK["truck_f"], 0.0, 0.0, 0.0)
        c["hips.pos"] = vadd(MANUAL["hips.pos"], (0.0, -0.012 * S(x - 0.08), 0.004 * S(2 * x)))
        c["hips.rot"] = vadd(MANUAL["hips.rot"], (0, 2.0 * S(x + 0.2), 0))
        c["chest.rot"] = vadd(MANUAL["chest.rot"], (0, -2.0 * S(x - 0.05), 1.0 * S(x)))
        lagw = S(x - 0.12)
        c["arm.L.dir"] = vadd(MANUAL["arm.L.dir"], (0, 0.08 * lagw, -0.2 * lagw))
        c["arm.R.dir"] = vadd(MANUAL["arm.R.dir"], (0, -0.06 * lagw, 0.2 * lagw))
        return finish(c, -12.0, 6.0)

    return Clip("skate_manual", T, fn, True)


GRAB = P(AIR_S, **{
    "hips.pos": (0.06, -0.03, -0.11), "hips.rot": (26.0, 0.0, -78.0), "spine.rot": (12.0, -2.0, 0.0),
    "chest.rot": (10.0, -4.0, 2.0), "neck.rot": (-10.0, 0.0, 6.0),
    "x.board": (4.0, -0.0, -6.0, 0.22, 0.0),
    "arm.R.ik": 1.0, "arm.R.target": (-0.105, -0.03, DECK_TOP + 0.07), "arm.R.pole": (0.9, -0.6, 0.2),
    "arm.R.wrist": (40.0, 0.0, 0.0),
    "arm.L.dir": (0.95, 0.25, -0.1), "arm.L.elbow": 35.0, "arm.L.clav": (0, 2), "arm.L.twist": -30.0,
    "leg.L.pole": (0.55, 1.0, 0.25), "leg.R.pole": (-0.25, 1.0, 0.25),
})


def skate_grab():
    T = 1.0

    def fn(t):
        x = t / T
        c = dict(GRAB)
        c["hips.rot"] = vadd(GRAB["hips.rot"], (1.5 * S(x), 2 * S(x + 0.25), 1.5 * S(x + 0.1)))
        c["x.board"] = (4.0 + 1.5 * S(x + 0.15), -0.0, -6.0 + 2 * S(x + 0.4), 0.22, 0.0)
        c["arm.L.dir"] = vadd(GRAB["arm.L.dir"], (0.05 * S(x + 0.3), 0.08 * S(x + 0.1), 0.08 * S(x + 0.45)))
        c["arm.L.elbow"] = 35 + 8 * S(x + 0.35)
        # the grabbing hand rides with the deck edge
        b = board_about(c["x.board"][0], 0.0, 0.0, c["x.board"][2], c["x.board"][3])
        q = q_eul(b["board.rot"])
        tgt = q @ rig2bl(GRAB["arm.R.target"]) + rig2bl(b["board.pos"])
        c["arm.R.target"] = (tgt.x, -tgt.y, tgt.z)
        return finish(c, -18.0, 9.0)

    return Clip("skate_grab", T, fn, True)


def _turn(name, sign):
    """sign +1: carve toward the heel side (+X = left of travel), -1: toe side."""
    T = 1.0
    if sign > 0:
        base = P(SKATE, **{
            "hips.pos": (0.075, -0.02, 0.0), "hips.rot": (2.0, 0.0, -78.0), "spine.rot": (4.0, -2.0, 6.0),
            "chest.rot": (6.0, -2.0, 12.0), "neck.rot": (-4.0, 0.0, 10.0),
            **arms2((0.4, 0.6, -0.6), (0.35, 0.45, -0.75), 35, 30, (2, 8), (1, 6)),
            "x.board": (0.0, -DECK["truck_f"], 7.0, 0.0, 0.0),
        })
        yaw_tot = 4.0
    else:
        base = P(SKATE, **{
            "hips.pos": (-0.01, -0.02, -0.05), "hips.rot": (26.0, 0.0, -86.0), "spine.rot": (10.0, 2.0, 0.0),
            "chest.rot": (6.0, 2.0, 4.0), "neck.rot": (-14.0, 0.0, 6.0),
            **arms2((0.6, -0.25, -0.65), (0.55, -0.35, -0.7), 22, 20, (4, -4), (3, -4)),
            "x.board": (0.0, -DECK["truck_f"], -7.0, 0.0, 0.0),
            "leg.L.pole": (0.25, 1.0, 0.0), "leg.R.pole": (-0.3, 1.0, 0.0),
        })
        yaw_tot = -30.0

    def fn(t):
        x = t / T
        c = dict(base)
        c["hips.pos"] = vadd(base["hips.pos"], (0.004 * S(x), 0.0, 0.005 * S(x + 0.2)))
        c["chest.rot"] = vadd(base["chest.rot"], (-1.0 * S(x + 0.1), 0.0, 1.5 * S(x + 0.3)))
        for s_, ph in (("L", 0.0), ("R", 0.35)):
            c[f"arm.{s_}.dir"] = vadd(base[f"arm.{s_}.dir"], (0.03 * S(x + ph), 0.03 * S(x + ph + 0.2), 0))
        return finish(c, yaw_tot, 8.0)

    return Clip(name, T, fn, True)


# ---------------------------------------------------------------------------
# Bail + get up
# ---------------------------------------------------------------------------
LYING = {
    **STAND,
    # reclined ~30 deg against the giant head, which lies flat on its back face
    "hips.pos": (-0.02, 0.0, -0.44), "hips.rot": (-45.0, 0.0, -90.0),
    "spine.rot": (-2.0, 0.0, 0.0), "chest.rot": (-2.0, 0.0, 0.0), "neck.rot": (-30.0, 0.0, 0.0),
    "head.rot": (-30.0, 0.0, 4.0), "head.swing_max": 40.0,
    "leg.L.pos": (-0.45, 0.14, 0.085), "leg.R.pos": (-0.43, -0.10, 0.075),
    "leg.L.rot": (-75.0, -10.0, -90.0), "leg.R.rot": (-80.0, 10.0, -90.0),
    "leg.L.pole": (0.2, 1.0, 0.0), "leg.R.pole": (-0.2, 1.0, 0.0),
    "arm.L.dir": (0.8, -0.3, -0.55), "arm.R.dir": (0.75, -0.3, -0.6), "arm.L.elbow": 25.0, "arm.R.elbow": 20.0,
    "arm.L.clav": (4.0, 0.0), "arm.R.clav": (2.0, 0.0), "arm.L.twist": -60.0, "arm.R.twist": -50.0,
    "arm.L.wrist": (0, 0, 0), "arm.R.wrist": (0, 0, 0),
}


def skate_bail():
    T = 1.2
    wobble = P(SKATE, **{
        "hips.pos": (0.0, -0.01, 0.0), "hips.rot": (24.0, 6.0, -78.0), "chest.rot": (10.0, 6.0, 14.0),
        "spine.rot": (8.0, 4.0, 6.0),
        **arms2((0.9, 0.6, 0.0), (0.8, -0.3, -0.05), 30, 25, (2, 0), (2, 0)),
    })
    slip = P(wobble, **{
        "hips.pos": (0.14, 0.02, -0.14), "hips.rot": (-40.0, -4.0, -86.0), "spine.rot": (-10.0, 0.0, 2.0),
        "chest.rot": (-8.0, 0.0, 4.0), "neck.rot": (16.0, 0.0, 4.0),
        "leg.L.pos": (-0.20, 0.30, 0.34), "leg.R.pos": (-0.22, -0.02, 0.26),
        "leg.L.rot": (-40.0, 0.0, -80.0), "leg.R.rot": (-30.0, 0.0, -96.0),
        **arms2((0.95, 0.5, -0.05), (0.95, 0.5, -0.15), 30, 25, (2, 4), (2, 4)),
    })
    hit = P(LYING, **{
        "hips.pos": (0.08, 0.02, -0.43), "hips.rot": (-38.0, -6.0, -88.0), "spine.rot": (-6.0, 0, 0),
        "chest.rot": (-4.0, 0, 0), "neck.rot": (-24.0, 0, 0), "head.rot": (-24.0, 0, 0),
        "leg.L.pos": (-0.40, 0.20, 0.36), "leg.R.pos": (-0.38, -0.06, 0.28),
        "leg.L.rot": (-60.0, 0.0, -90.0), "leg.R.rot": (-50.0, 0.0, -90.0),
        "arm.L.dir": (0.85, -0.25, -0.5), "arm.R.dir": (0.85, -0.3, -0.55), "arm.L.elbow": 20.0, "arm.R.elbow": 20.0,
    })
    slam = P(LYING, **{"hips.pos": (0.0, 0.0, -0.445), "neck.rot": (-34.0, 0, 0),
                       "leg.L.pos": (-0.43, 0.15, 0.16), "leg.R.pos": (-0.42, -0.10, 0.12)})
    seq = PoseSeq([(0.0, SKATE), (0.14, wobble), (0.34, slip), (0.52, hit), (0.66, slam),
                   (0.82, P(LYING, **{"hips.pos": (-0.03, 0.0, -0.44), "neck.rot": (-27.0, 0, 0)})),
                   (1.2, LYING, "h")],
                  lag={"arm": 0.05, "neck": 0.04, "head": 0.06, "leg": 0.02})

    def fn(t):
        c = seq(t)
        c["x.board"] = (0.0, -DECK["truck_f"], 0.0, 0.0, 0.0)
        _resolve_board(c)
        return look_total(c, -10.0, 4.0, aim=1.0 - smoothstep((t - 0.1) / 0.25))

    return Clip("skate_bail", T, fn, False)


def skate_getup():
    T = 1.0
    sit = {
        **LYING,
        "hips.pos": (-0.04, 0.0, -0.43), "hips.rot": (-30.0, 0.0, -88.0), "spine.rot": (6.0, 0, 0),
        "chest.rot": (6.0, 0, 0), "neck.rot": (-4.0, 0, 0), "head.rot": (-6.0, 0, 0),
        "leg.L.pos": (-0.34, 0.12, ANKLE_H), "leg.R.pos": (-0.30, -0.12, ANKLE_H),
        "leg.L.rot": (0.0, 0.0, -80.0), "leg.R.rot": (0.0, 0.0, -100.0),
        "leg.L.pole": (0.3, 1.0, 0.5), "leg.R.pole": (-0.3, 1.0, 0.5),
        "arm.L.dir": (0.35, -0.75, -0.6), "arm.R.dir": (0.35, -0.75, -0.6),
        "arm.L.elbow": 8.0, "arm.R.elbow": 8.0, "arm.L.twist": 0.0, "arm.R.twist": 0.0,
    }
    squat = {
        **STAND,
        "hips.pos": (-0.17, 0.0, -0.30), "hips.rot": (34.0, 0.0, -55.0), "spine.rot": (14.0, 0, 4.0),
        "chest.rot": (8.0, 0, 4.0), "neck.rot": (-14.0, 0, 0.0), "head.rot": (-10.0, 0, 0),
        "leg.L.pos": (-0.25, 0.12, ANKLE_H), "leg.R.pos": (-0.20, -0.12, ANKLE_H),
        "leg.L.rot": (0.0, 0.0, -55.0), "leg.R.rot": (0.0, 0.0, -75.0),
        "leg.L.pole": (0.35, 1.0, 0.0), "leg.R.pole": (-0.35, 1.0, 0.0),
        "arm.L.dir": (0.15, 0.85, -0.5), "arm.R.dir": (0.15, 0.85, -0.5),
        "arm.L.elbow": 50.0, "arm.R.elbow": 50.0, "arm.L.twist": -20.0, "arm.R.twist": -20.0,
    }
    rise = {
        **STAND,
        "hips.pos": (-0.07, 0.0, -0.10), "hips.rot": (14.0, 0.0, -22.0), "spine.rot": (6.0, 0, 3.0),
        "chest.rot": (2.0, 0, 3.0), "neck.rot": (-3.0, 0, 0.0),
        "leg.L.pos": (0.02, 0.11, ANKLE_H), "leg.R.pos": (-0.12, -0.04, ANKLE_H + 0.035),
        "leg.L.rot": (0.0, 0.0, -15.0), "leg.R.rot": (25.0, 0.0, -30.0), "leg.R.toe": 20.0,
        "arm.L.dir": (0.25, 0.35, -0.9), "arm.R.dir": (0.25, 0.2, -0.95),
        "arm.L.elbow": 25.0, "arm.R.elbow": 22.0,
    }
    step = P(STAND, **{"leg.L.pos": (0.10, 0.0, ANKLE_H + 0.03), "leg.L.rot": (10.0, 0.0, 0.0),
                       "hips.pos": (-0.02, 0.0, -0.035), "hips.rot": (5.0, 0.0, -4.0)})
    seq = PoseSeq([(0.0, LYING), (0.26, sit), (0.52, squat), (0.74, rise), (0.86, step), (1.0, STAND, "h")],
                  lag={"arm": 0.04, "neck": 0.03, "head": 0.05})

    def fn(t):
        c = seq(t)
        return look_total(c, 0.0, 0.0, aim=smoothstep((t - 0.45) / 0.4))

    return Clip("skate_getup", T, fn, False)


def skate_powerslide():
    T = 0.8
    base = P(SKATE, **{
        "hips.pos": (0.10, -0.02, -0.06), "hips.rot": (-6.0, 0.0, -66.0), "spine.rot": (6.0, -3.0, 8.0),
        "chest.rot": (8.0, -3.0, 14.0), "neck.rot": (-4.0, 0.0, 10.0),
        **feet((0.17, -70.0), (-0.20, -98.0)),
        **arms2((0.45, 0.8, -0.2), (0.4, 0.55, -0.55), 30, 40, (6, 10), (2, 8)),
        "leg.L.pole": (0.3, 1.0, 0.0), "leg.R.pole": (-0.35, 1.0, 0.0),
    })

    def fn(t):
        x = t / T
        c = dict(base)
        chatter = 0.6 * S(8 * x) + 0.4 * S(12 * x + 0.3)
        c["hips.pos"] = vadd(base["hips.pos"], (0.006 * S(x), 0.0, 0.004 * chatter))
        c["hips.rot"] = vadd(base["hips.rot"], (1.5 * S(x + 0.1), 0.8 * chatter, 1.0 * S(x)))
        c["chest.rot"] = vadd(base["chest.rot"], (-1.0 * S(x + 0.2), 0, 1.5 * S(x + 0.3)))
        c["arm.L.dir"] = vadd(base["arm.L.dir"], (0.0, 0.05 * S(x + 0.3), 0.05 * S(x + 0.1)))
        c["arm.R.dir"] = vadd(base["arm.R.dir"], (0.03 * S(x + 0.2), 0.04 * S(x + 0.5), 0.0))
        c["x.board"] = (0.0, -DECK["truck_f"], 9.0 + 1.0 * chatter, 0.0, 0.0)
        return finish(c, 6.0, 8.0)

    return Clip("skate_powerslide", T, fn, True)


def clips():
    return [skate_idle(), skate_push(), skate_crouch(), skate_ollie(), skate_air(), skate_flip(), skate_land(),
            skate_grind(), skate_manual(), skate_grab(), _turn("skate_turn_left", +1),
            _turn("skate_turn_right", -1), skate_bail(), skate_getup(), skate_powerslide()]
